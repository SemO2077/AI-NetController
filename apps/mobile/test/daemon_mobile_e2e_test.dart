import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ai_netcontroller/ai_netcontroller.dart';
import 'package:ai_netcontroller/main.dart' as app;

class _DaemonHarness {
  final Process process;
  final int port;
  final String psk;
  final String pin;
  final Stream<String> stdoutLines;
  final StringBuffer stderrBuffer;

  _DaemonHarness({
    required this.process,
    required this.port,
    required this.psk,
    required this.pin,
    required this.stdoutLines,
    required this.stderrBuffer,
  });

  String get stderrText => stderrBuffer.toString();

  static Directory _findRepoRoot() {
    var dir = Directory.current;
    for (int i = 0; i < 5; i++) {
      final agentFile = File('${dir.path}${Platform.pathSeparator}agent${Platform.pathSeparator}agent.py');
      if (agentFile.existsSync()) {
        return dir;
      }
      final parent = dir.parent;
      if (parent.path == dir.path) break;
      dir = parent;
    }
    throw StateError('Could not locate repo root containing agent/agent.py from ${Directory.current.path}');
  }

  static Future<_DaemonHarness> start({
    String psk = 'flutter_e2e_test_secret_1234',
    String pin = '482910',
  }) async {
    final root = _findRepoRoot();
    final script = '''
import asyncio, io, json, os, socket, sys, tempfile, time
from pathlib import Path
from PIL import Image
sys.path.insert(0, os.getcwd())
os.environ['AI_AGENT_SECRET'] = ${jsonEncode(psk)}
os.environ['CST_AGENT_SECRET'] = ${jsonEncode(psk)}
os.environ['AI_SUBNET_GEOFENCE'] = '0'
from agent import agent as mod
tmpdir = tempfile.TemporaryDirectory()
mod.load_config = lambda: {}
mod.DOWNLOADS_DIR = Path(tmpdir.name) / 'downloads'
mod.DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
sock = socket.socket()
sock.bind(('127.0.0.1', 0))
port = sock.getsockname()[1]
sock.close()

img = Image.new('RGB', (160, 90), color=(0, 212, 255))
buf = io.BytesIO()
img.save(buf, format='JPEG', quality=80)
jpeg_bytes = buf.getvalue()

async def main():
    daemon = mod.HostAgentDaemon(host='127.0.0.1', port=port, enable_tray=False, enable_mdns=False)
    daemon.is_running = True
    daemon.pairing_pin = ${jsonEncode(pin)}
    daemon.pin_issued_at = time.time() + 3600.0
    daemon.pairing_token = 'ainet_mobile_e2e_paired_token'
    daemon.screen_pipeline._grab_and_compress = lambda: (jpeg_bytes, False)
    async with mod.websockets.serve(daemon.handle_connection, '127.0.0.1', port, max_size=mod.MAX_PAYLOAD_SIZE + 4096):
        t1 = asyncio.create_task(daemon._screen_stream_loop())
        t2 = asyncio.create_task(daemon._telemetry_heartbeat_loop())
        print(json.dumps({'ready': True, 'port': port}), flush=True)
        try:
            await asyncio.Future()
        finally:
            daemon.is_running = False
            t1.cancel()
            t2.cancel()
            daemon.screen_pipeline.close()
            tmpdir.cleanup()

asyncio.run(main())
''';

    final pythonExe = Platform.isWindows ? 'python' : 'python3';
    final proc = await Process.start(
      pythonExe,
      ['-c', script],
      workingDirectory: root.path,
    );

    final linesController = StreamController<String>.broadcast();
    final errBuffer = StringBuffer();
    proc.stdout.transform(utf8.decoder).transform(const LineSplitter()).listen(
      linesController.add,
      onError: linesController.addError,
      onDone: linesController.close,
    );
    proc.stderr.transform(utf8.decoder).listen(errBuffer.write);

    String readyLine;
    try {
      readyLine = await linesController.stream
          .firstWhere((line) => line.contains('"ready"'))
          .timeout(const Duration(seconds: 15));
    } catch (e) {
      proc.kill();
      throw StateError('Daemon subprocess failed to become ready: $e\nstderr:\n$errBuffer');
    }
    final parsed = jsonDecode(readyLine) as Map<String, dynamic>;
    final port = (parsed['port'] as num).toInt();

    return _DaemonHarness(
      process: proc,
      port: port,
      psk: psk,
      pin: pin,
      stdoutLines: linesController.stream,
      stderrBuffer: errBuffer,
    );
  }

  Future<void> dispose() async {
    process.kill();
    await process.exitCode.timeout(const Duration(seconds: 3), onTimeout: () => -1);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  HttpOverrides? previousHttpOverrides;
  _DaemonHarness? daemon;

  setUpAll(() async {
    previousHttpOverrides = HttpOverrides.current;
    HttpOverrides.global = null;
    daemon = await _DaemonHarness.start();
  });

  tearDownAll(() async {
    await daemon?.dispose();
    HttpOverrides.global = previousHttpOverrides;
  });

  group('Mobile <-> Live PC Daemon End-to-End Integration', () {
    test('PIN PAIR exchange returns pairingToken and executes real OP_SHELL command', () async {
      final liveDaemon = daemon!;
      final ws = await WebSocket.connect('ws://127.0.0.1:${liveDaemon.port}');
      final completer = Completer<String>();
      final shellCompleter = Completer<String>();
      String? pairedToken;
      var challengeReceived = false;

      late StreamSubscription sub;
      sub = ws.listen((msg) {
        if (msg is String) {
          final decoded = jsonDecode(msg) as Map<String, dynamic>;
          if (decoded['event'] == 'AUTHENTICATED' && decoded['pairingToken'] is String) {
            pairedToken = decoded['pairingToken'] as String;
            if (!completer.isCompleted) completer.complete(pairedToken!);
          }
        } else if (msg is List<int>) {
          final pkt = StreamBinaryPacket.parse(Uint8List.fromList(msg));
          if (pkt == null) return;
          if (pkt.opcode == StreamOpcode.auth && pkt.payload.length == 16) {
            challengeReceived = true;
          } else if (pkt.opcode == StreamOpcode.shell && !shellCompleter.isCompleted) {
            shellCompleter.complete(utf8.decode(pkt.payload, allowMalformed: true));
          }
        }
      });

      // Exchange 6-digit PIN for persistent pairing token
      ws.add(jsonEncode({
        'action': 'PAIR',
        'pin': liveDaemon.pin,
        'device': 'Flutter Test Mobile',
      }));

      final token = await completer.future.timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw TimeoutException('PAIR timed out. stderr:\n${liveDaemon.stderrText}'),
      );
      expect(challengeReceived, isTrue);
      expect(token, equals('ainet_mobile_e2e_paired_token'));

      // Now open a second WebSocket and authenticate binaries via paired token HMAC
      await sub.cancel();
      await ws.close();

      final ws2 = await WebSocket.connect('ws://127.0.0.1:${liveDaemon.port}');
      final authOk = Completer<bool>();
      final cmdOut = Completer<Map<String, dynamic>>();
      var sentShell = false;

      final sub2 = ws2.listen((msg) {
        if (msg is List<int>) {
          final pkt = StreamBinaryPacket.parse(Uint8List.fromList(msg));
          if (pkt == null) return;
          if (pkt.opcode == StreamOpcode.auth) {
            final status = utf8.decode(pkt.payload, allowMalformed: true).trim();
            if (status == 'OK_AUTHENTICATED' || status == 'AUTH_OK') {
              if (!authOk.isCompleted) authOk.complete(true);
              if (!sentShell) {
                sentShell = true;
                ws2.add(StreamBinaryPacket.pack(
                  StreamOpcode.shell,
                  1,
                  Uint8List.fromList(utf8.encode('echo MOBILE_DAEMON_E2E_OK')),
                ));
              }
            } else if (pkt.payload.length == 16) {
              final digest = Hmac(sha256, utf8.encode(token)).convert(pkt.payload);
              ws2.add(StreamBinaryPacket.pack(
                StreamOpcode.auth,
                pkt.seqId,
                Uint8List.fromList(digest.bytes),
              ));
            }
          } else if (pkt.opcode == StreamOpcode.shell && !cmdOut.isCompleted) {
            cmdOut.complete(jsonDecode(utf8.decode(pkt.payload)) as Map<String, dynamic>);
          }
        }
      });

      expect(
        await authOk.future.timeout(
          const Duration(seconds: 5),
          onTimeout: () => throw TimeoutException('ws2 OP_AUTH timed out. stderr:\n${liveDaemon.stderrText}'),
        ),
        isTrue,
      );
      final shellJson = await cmdOut.future.timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw TimeoutException('ws2 OP_SHELL timed out. stderr:\n${liveDaemon.stderrText}'),
      );
      expect(shellJson['output'].toString(), contains('MOBILE_DAEMON_E2E_OK'));

      await sub2.cancel();
      await ws2.close();
    });

    testWidgets(
      'ViewportStreamWidget connects, authenticates, renders stream & hydrates FleetNotifier telemetry',
      (WidgetTester tester) async {
        // Test at a compact 390x844 phone viewport size to catch overflow issues too.
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });

        final container = ProviderContainer();
        addTearDown(container.dispose);

        final liveDaemon = daemon!;
        container.read(app.fleetProvider.notifier).addHost(
              app.HostState(
                id: 'PC-127-0-0-1',
                name: 'Host PC (Local)',
                ip: '127.0.0.1',
                wsPort: liveDaemon.port,
                mac: '00:00:00:00:00:00',
                isOnline: true,
                sharedSecret: liveDaemon.psk,
              ),
            );

        final receivedTelemetry = <Map<String, dynamic>>[];

        await tester.runAsync(() async {
          await tester.pumpWidget(
            UncontrolledProviderScope(
              container: container,
              child: MaterialApp(
                home: Scaffold(
                  body: Consumer(
                    builder: (context, ref, _) {
                      final hosts = ref.watch(app.fleetProvider);
                      final host = hosts.first;
                      return Column(
                        children: [
                          ResponsiveDeviceCard(
                            id: host.id,
                            name: host.name,
                            ip: host.ip,
                            mac: host.mac,
                            isOnline: host.isOnline,
                            cpuUsage: host.cpuUsage,
                            ramUsage: host.ramUsage,
                          ),
                          SizedBox(
                            height: 240,
                            child: ViewportStreamWidget(
                              hostIp: host.ip,
                              hostName: host.name,
                              wsPort: host.wsPort,
                              sharedSecret: host.sharedSecret,
                              onTelemetry: (data) {
                                receivedTelemetry.add(data);
                                ref
                                    .read(app.fleetProvider.notifier)
                                    .updateTelemetryByIp(host.ip, data);
                              },
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                ),
              ),
            ),
          );

          // Allow WebSocket handshake, JPEG frame, and OP_TELEMETRY arrival (telemetry interval = 2.0s)
          final deadline = DateTime.now().add(const Duration(seconds: 7));
          while (receivedTelemetry.isEmpty && DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 100));
            await tester.pump();
          }

          // Scroll dock if needed and tap ESC to verify OP_INPUT dispatch to the live daemon
          final escButton = find.text('ESC');
          if (escButton.evaluate().isNotEmpty) {
            await tester.ensureVisible(escButton);
            await tester.pump();
            await tester.tap(escButton);
            await tester.pump();
          }

          // Also verify didUpdateWidget reconnects cleanly when sharedSecret changes
          container
              .read(app.fleetProvider.notifier)
              .setHostSecret('127.0.0.1', 'ainet_mobile_e2e_paired_token');
          await tester.pump();
          final reauthDeadline = DateTime.now().add(const Duration(seconds: 4));
          while (DateTime.now().isBefore(reauthDeadline) &&
              find.text('L-CLICK').evaluate().isEmpty) {
            await Future<void>.delayed(const Duration(milliseconds: 100));
            await tester.pump();
          }
        });

        await tester.pump();

        expect(receivedTelemetry, isNotEmpty, reason: 'Expected live OP_TELEMETRY from Python daemon');
        final updatedHost = container.read(app.fleetProvider).first;
        expect(updatedHost.name, isNot(equals('Host PC (Local)')));
        expect(updatedHost.osName, isNotEmpty);
        expect(updatedHost.ramTotalGb, greaterThan(0));
        expect(updatedHost.cpuCores, greaterThan(0));
        expect(find.text('L-CLICK'), findsOneWidget);
        expect(find.text(updatedHost.name), findsAtLeastNWidgets(1));
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'Full AINetControllerApp expanded dashboard shows live telemetry and runs OP_SHELL via Run button',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(1100, 820);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });

        final liveDaemon = daemon!;
        final container = ProviderContainer();
        addTearDown(container.dispose);

        container.read(app.fleetProvider.notifier).addHost(
              app.HostState(
                id: 'PC-127-0-0-1',
                name: 'Host PC (Local)',
                ip: '127.0.0.1',
                wsPort: liveDaemon.port,
                mac: '00:00:00:00:00:00',
                isOnline: true,
                sharedSecret: liveDaemon.psk,
              ),
            );
        container.read(app.selectedHostIdProvider.notifier).state = 'PC-127-0-0-1';

        await tester.runAsync(() async {
          await tester.pumpWidget(
            UncontrolledProviderScope(
              container: container,
              child: const app.AINetControllerApp(),
            ),
          );

          // Wait for inline ViewportStreamWidget to connect and populate live OS/RAM telemetry
          final deadline = DateTime.now().add(const Duration(seconds: 7));
          while (container.read(app.fleetProvider).first.ramTotalGb <= 0 &&
              DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 100));
            await tester.pump();
          }

          // Enter a real command and tap Run in the embedded terminal pane
          final cmdField = find.byType(TextField).first;
          await tester.enterText(cmdField, 'echo FULL_APP_UI_OK');
          await tester.pump();

          final runButton = find.text('Run');
          await tester.ensureVisible(runButton);
          await tester.tap(runButton);
          await tester.pump();

          final cmdDeadline = DateTime.now().add(const Duration(seconds: 6));
          while (find.textContaining('FULL_APP_UI_OK').evaluate().isEmpty &&
              DateTime.now().isBefore(cmdDeadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 100));
            await tester.pump();
          }
        });

        await tester.pump();
        final hydrated = container.read(app.fleetProvider).first;
        expect(hydrated.name, isNot(equals('Host PC (Local)')));
        expect(find.textContaining('OS: '), findsOneWidget);
        expect(find.textContaining('RAM: '), findsOneWidget);
        expect(find.text('Mode: Interactive'), findsOneWidget);
        expect(find.textContaining('FULL_APP_UI_OK'), findsAtLeastNWidgets(1));
        expect(tester.takeException(), isNull);
      },
    );
  });
}
