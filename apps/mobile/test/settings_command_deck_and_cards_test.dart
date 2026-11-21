import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:ai_netcontroller/ai_netcontroller.dart';
import 'package:ai_netcontroller/main.dart' as app;
import 'package:crypto/crypto.dart' as crypto_pkg;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';

const String _kSampleJpegBase64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9'
    'PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhC'
    'Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAAR'
    'CAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA'
    'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK'
    'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG'
    'h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl'
    '5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA'
    'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk'
    'NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE'
    'hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk'
    '5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDMooor6I8c/9k=';

class _DecryptedFrame {
  final int opcode;
  final int seq;
  final Uint8List payload;

  const _DecryptedFrame({
    required this.opcode,
    required this.seq,
    required this.payload,
  });
}

/// Loopback WebSocket mock host implementing `OP_AUTH`, Mutual ECDH vault,
/// ChaCha20-Poly1305 AEAD framing, snapshot response, and `OP_FRAME_ACK`.
class _MockPipelineServer {
  final HttpServer _server;
  final String psk;
  final StreamController<_DecryptedFrame> _rxCtrl =
      StreamController<_DecryptedFrame>.broadcast();
  final Completer<void> _vaultReady = Completer<void>();

  WebSocket? _activeSocket;
  Uint8List? _kRxFromClient;
  Uint8List? _kTxToClient;
  int _txSeq = 0;

  _MockPipelineServer._(this._server, this.psk) {
    _server.listen((HttpRequest req) async {
      if (!WebSocketTransformer.isUpgradeRequest(req)) {
        req.response.statusCode = HttpStatus.badRequest;
        await req.response.close();
        return;
      }
      final ws = await WebSocketTransformer.upgrade(req);
      _activeSocket = ws;
      _handleSocket(ws);
    });
  }

  int get port => _server.port;
  Stream<_DecryptedFrame> get receivedFrames => _rxCtrl.stream;
  Future<void> get vaultEstablished => _vaultReady.future;

  static Future<_MockPipelineServer> start({
    String psk = 'stage3_mock_secret_99',
  }) async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    return _MockPipelineServer._(server, psk);
  }

  Uint8List _encryptHostFrame(int opcode, Uint8List plaintext, {int? seq}) {
    _txSeq++;
    final int wireLen = kNonceSize + plaintext.length + kTagSize;
    final Uint8List out = Uint8List(kHeaderSize + wireLen);
    out[0] = kMagicByte0;
    out[1] = kMagicByte1;
    out[2] = opcode & 0xFF;
    out[3] = ProtocolFlags.encrypted;
    final bd = ByteData.sublistView(out);
    bd.setUint32(4, (seq ?? _txSeq) & 0xFFFFFFFF, Endian.big);
    bd.setUint32(8, wireLen, Endian.big);
    bd.setUint32(12, 0, Endian.big);
    bd.setUint64(16, _txSeq, Endian.big);
    final aad = Uint8List.sublistView(out, 0, kHeaderSize);
    final nonce = Uint8List.sublistView(out, 12, 24);
    ChaCha20Poly1305Cipher().encryptInto(
      _kTxToClient!,
      nonce,
      plaintext,
      out,
      24,
      aad: aad,
    );
    return out;
  }

  void sendEncryptedFrameBytes(Uint8List jpegBytes, {int? seq}) {
    final ws = _activeSocket;
    if (ws == null || ws.readyState != WebSocket.open || _kTxToClient == null) {
      return;
    }
    ws.add(_encryptHostFrame(BinaryOpcode.frame, jpegBytes, seq: seq));
  }

  void _handleSocket(WebSocket ws) {
    final authNonce = Uint8List.fromList(
      List<int>.generate(16, (i) => (i * 11 + 5) & 0xFF),
    );
    bool authed = false;
    bool vaultUp = false;
    Uint8List? hostPriv;
    Uint8List? hostPub;
    Uint8List? hostN2;

    void safeSend(Uint8List data) {
      if (ws.readyState != WebSocket.open) return;
      try {
        ws.add(data);
      } catch (_) {}
    }

    safeSend(packPacket(BinaryOpcode.auth, authNonce, seq: 1));

    ws.listen((dynamic msg) {
      if (msg is! List<int>) return;
      final raw = msg is Uint8List ? msg : Uint8List.fromList(msg);
      final pkt = parsePacket(raw);
      if (pkt == null) return;

      if (!authed) {
        if (pkt.opcode != BinaryOpcode.auth) return;
        final expected = crypto_pkg.Hmac(
          crypto_pkg.sha256,
          utf8.encode(psk),
        ).convert(authNonce).bytes;
        if (!constantTimeEquals(pkt.payload, Uint8List.fromList(expected))) {
          safeSend(
            packPacket(
              BinaryOpcode.auth,
              utf8.encode('ERR_AUTH_REJECTED'),
              seq: 2,
            ),
          );
          unawaited(ws.close().catchError((_) {}));
          return;
        }
        authed = true;
        safeSend(
          packPacket(
            BinaryOpcode.auth,
            utf8.encode('OK_AUTHENTICATED'),
            seq: 2,
          ),
        );
        return;
      }

      if (!vaultUp) {
        if (pkt.opcode != BinaryOpcode.auth) return;
        final text = utf8.decode(pkt.payload, allowMalformed: true);
        if (text.startsWith('INIT_ECDH_VAULT_M:') && pkt.payload.length == 34) {
          final clientChal = Uint8List.sublistView(pkt.payload, 18, 34);
          hostPriv = X25519.generatePrivateKey();
          hostPub = X25519.publicFromPrivate(hostPriv!);
          hostN2 = Uint8List.fromList(
            List<int>.generate(16, (i) => (i * 9 + 13) & 0xFF),
          );
          final core59 = Uint8List.fromList(<int>[
            ...kMagicBytes,
            ...hostPub!,
            ...hostN2!,
          ]);
          final proofInput = <int>[
            ...utf8.encode('CST_HOST_CHAL_M:'),
            ...clientChal,
            ...core59,
          ];
          final hostMac = crypto_pkg.Hmac(
            crypto_pkg.sha256,
            utf8.encode(psk),
          ).convert(proofInput).bytes;
          safeSend(
            packPacket(
              BinaryOpcode.auth,
              Uint8List.fromList(<int>[...core59, ...hostMac]),
              flags: ProtocolFlags.compressed,
              seq: 3,
            ),
          );
        } else if (pkt.payload.length == 80 && hostPriv != null) {
          final cliPub = Uint8List.sublistView(pkt.payload, 0, 32);
          final cliN1 = Uint8List.sublistView(pkt.payload, 32, 48);
          final shared = X25519.scalarMult(hostPriv!, cliPub);
          final salt = Uint8List(32)
            ..setRange(0, 16, cliN1)
            ..setRange(16, 32, hostN2!);
          _kRxFromClient = hkdfExpandAndExtract(
            salt,
            shared,
            Uint8List.fromList(utf8.encode(kCtxClientTx)),
            kKeySize,
          );
          _kTxToClient = hkdfExpandAndExtract(
            salt,
            shared,
            Uint8List.fromList(utf8.encode(kCtxHostTx)),
            kKeySize,
          );
          vaultUp = true;
          safeSend(
            packPacket(
              BinaryOpcode.auth,
              utf8.encode('OK_ECDH_VAULT'),
              seq: 4,
            ),
          );
          if (!_vaultReady.isCompleted) {
            _vaultReady.complete();
          }
        }
        return;
      }

      if ((pkt.flags & ProtocolFlags.encrypted) == 0 ||
          pkt.payload.length < kNonceSize + kTagSize) {
        return;
      }
      final aad = Uint8List.sublistView(raw, 0, kHeaderSize);
      final nonce = Uint8List.sublistView(pkt.payload, 0, kNonceSize);
      final ctAndTag = Uint8List.sublistView(pkt.payload, kNonceSize);
      final plain = ChaCha20Poly1305Cipher().decrypt(
        _kRxFromClient!,
        nonce,
        ctAndTag,
        aad: aad,
      );
      if (plain == null) return;

      if (!_rxCtrl.isClosed) {
        _rxCtrl.add(
          _DecryptedFrame(opcode: pkt.opcode, seq: pkt.seq, payload: plain),
        );
      }

      if (pkt.opcode == BinaryOpcode.ping) {
        safeSend(
          _encryptHostFrame(BinaryOpcode.ping, Uint8List(0), seq: pkt.seq),
        );
      } else if (pkt.opcode == BinaryOpcode.viewportResize) {
        try {
          final decoded = jsonDecode(utf8.decode(plain));
          if (decoded is Map && decoded['snapshot'] == true) {
            sendEncryptedFrameBytes(base64Decode(_kSampleJpegBase64));
          }
        } catch (_) {}
      }
    });
  }

  Future<void> close() async {
    try {
      await _activeSocket?.close();
    } catch (_) {}
    await _rxCtrl.close();
    await _server.close(force: true);
  }
}

Future<Directory> _openAllTestHiveBoxes(String prefix) async {
  final dir = Directory.systemTemp.createTempSync(prefix);
  Hive.init(dir.path);
  await Hive.openBox('ghost_devices');
  await Hive.openBox(kAppPrefsBoxName);
  await Hive.openBox(kVaultSecretsBoxName);
  await Hive.openBox(kHistoryBoxName);
  return dir;
}

Future<void> _closeAndDeleteHiveDir(Directory dir) async {
  await Future<void>.delayed(const Duration(milliseconds: 40));
  for (final name in [
    'ghost_devices',
    kAppPrefsBoxName,
    kVaultSecretsBoxName,
    kHistoryBoxName,
  ]) {
    if (Hive.isBoxOpen(name)) {
      await Hive.box(name).flush();
    }
  }
  await Hive.close();
  if (dir.existsSync()) {
    for (int i = 0; i < 8; i++) {
      try {
        dir.deleteSync(recursive: true);
        break;
      } on FileSystemException {
        if (i == 7) rethrow;
        await Future<void>.delayed(const Duration(milliseconds: 40));
      }
    }
  }
}

Future<void> _scrollCenterAndTap(
  WidgetTester tester,
  Finder target, {
  required Finder scrollable,
  double delta = 220,
  Duration settleDuration = const Duration(milliseconds: 300),
}) async {
  await tester.scrollUntilVisible(target, delta, scrollable: scrollable);
  await tester.pump();
  await Scrollable.ensureVisible(tester.element(target), alignment: 0.35);
  await tester.pump();
  await tester.runAsync(() async {
    await tester.tap(target);
    await Future<void>.delayed(const Duration(milliseconds: 50));
  });
  await tester.pump();
  if (settleDuration > Duration.zero) {
    await tester.pump(settleDuration);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Expandable PC Cards & Responsive Fleet Integration', () {
    testWidgets(
      'single-accordion expand/collapse shows preview, full telemetry, quick actions, and switches to Terminal & Diagnostics',
      (tester) async {
        late Directory tempDir;
        await tester.runAsync(() async {
          tempDir = await _openAllTestHiveBoxes('ai_net_cards_1_');
        });
        addTearDown(() async {
          HostConnectionPool.instance.disposeAll();
          await tester.runAsync(() => _closeAndDeleteHiveDir(tempDir));
        });

        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });

        final container = ProviderContainer();
        addTearDown(container.dispose);

        await tester.runAsync(() async {
          final fleet = container.read(app.fleetProvider.notifier);
          fleet.addHost(
            app.HostState(
              id: 'PC-ONLINE',
              name: 'Alpha Studio Rig',
              ip: '192.168.1.10',
              wsPort: 8765,
              mac: 'AA:BB:CC:DD:EE:01',
              isOnline: true,
              cpuUsage: 42,
              ramUsage: 58,
              diskUsage: 62,
              cpuCores: 16,
              ramUsedGb: 18.5,
              ramTotalGb: 64.0,
              uptimeSec: 90120,
              osName: 'Windows 11 Pro',
              viewOnlyMode: false,
              useTls: true,
              latencyMs: 11,
            ),
          );
          fleet.addHost(
            app.HostState(
              id: 'PC-SLEEP',
              name: 'Render Sleep Node',
              ip: '192.168.1.11',
              wsPort: 8765,
              mac: 'AA:BB:CC:DD:EE:02',
              isOnline: false,
              osName: 'Ubuntu 24.04',
            ),
          );
          await Future<void>.delayed(const Duration(milliseconds: 30));
        });

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: const app.AINetControllerApp(),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        // Collapsed initially: expanded telemetry & sleeping card not mounted
        expect(find.text('Windows 11 Pro'), findsNothing);
        expect(find.text('Sleeping S3/S5'), findsNothing);

        // Expand online card
        await tester.tap(find.byKey(const ValueKey('device-card-expand-PC-ONLINE')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(find.text('Windows 11 Pro'), findsOneWidget);
        expect(find.text('42% • 16 cores'), findsOneWidget);
        expect(find.text('18.5/64 GB (58%)'), findsOneWidget);
        expect(find.text('62%'), findsOneWidget);
        expect(find.text('1d 1h 2m'), findsOneWidget);
        expect(find.text('192.168.1.10:8765'), findsOneWidget);
        expect(find.text('TLS+AEAD'), findsOneWidget);
        expect(find.text('Interactive'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('snapshot-refresh-PC-ONLINE')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('device-card-quick-touch-PC-ONLINE')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('device-card-quick-terminal-PC-ONLINE')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('device-card-quick-clipboard-PC-ONLINE')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('device-card-quick-mute-PC-ONLINE')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('device-card-quick-lock-PC-ONLINE')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('device-card-quick-diagnostics-PC-ONLINE')),
          findsOneWidget,
        );

        // Tap Diagnostics quick action -> opens ConnectionDiagnosticsSheet
        final diagBtn = find.byKey(
          const ValueKey('device-card-quick-diagnostics-PC-ONLINE'),
        );
        await Scrollable.ensureVisible(tester.element(diagBtn), alignment: 0.4);
        await tester.pump();
        await tester.tap(diagBtn);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.text('Connection Diagnostics'), findsOneWidget);
        await tester.tap(find.byTooltip('Close diagnostics'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        // Expand offline card -> single-accordion collapses online card automatically
        final expandSleep = find.byKey(
          const ValueKey('device-card-expand-PC-SLEEP'),
        );
        await Scrollable.ensureVisible(
          tester.element(expandSleep),
          alignment: 0.35,
        );
        await tester.pump();
        await tester.tap(expandSleep);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(find.text('Windows 11 Pro'), findsNothing);
        expect(find.text('Sleeping S3/S5'), findsOneWidget);
        expect(find.text('WoL Ready'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('snapshot-wol-cta-PC-SLEEP')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('device-card-quick-wol-PC-SLEEP')),
          findsOneWidget,
        );

        // Tap again -> collapses offline card
        await tester.tap(expandSleep);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.text('Sleeping S3/S5'), findsNothing);

        // Re-expand online card and tap Terminal quick action -> switches tab
        final expandOnline = find.byKey(
          const ValueKey('device-card-expand-PC-ONLINE'),
        );
        await Scrollable.ensureVisible(
          tester.element(expandOnline),
          alignment: 0.25,
        );
        await tester.pump();
        await tester.tap(expandOnline);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        final termBtn = find.byKey(
          const ValueKey('device-card-quick-terminal-PC-ONLINE'),
        );
        await Scrollable.ensureVisible(tester.element(termBtn), alignment: 0.35);
        await tester.pump();
        await tester.tap(termBtn);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.textContaining('Command Console'), findsOneWidget);
        expect(
          container.read(app.selectedHostIdProvider),
          equals('PC-ONLINE'),
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'expanded cards render with zero overflow on narrow (280px) & medium (700px) 2-column non-clipping layouts at 1.35x text scale',
      (tester) async {
        late Directory tempDir;
        await tester.runAsync(() async {
          tempDir = await _openAllTestHiveBoxes('ai_net_cards_2_');
        });
        addTearDown(() async {
          HostConnectionPool.instance.disposeAll();
          await tester.runAsync(() => _closeAndDeleteHiveDir(tempDir));
        });

        tester.platformDispatcher.textScaleFactorTestValue = 1.35;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
          tester.platformDispatcher.clearTextScaleFactorTestValue();
        });

        final container = ProviderContainer();
        addTearDown(container.dispose);

        await tester.runAsync(() async {
          final fleet = container.read(app.fleetProvider.notifier);
          fleet.addHost(
            app.HostState(
              id: 'PC-1',
              name: 'UltraWide-Studio-Workstation-01',
              ip: '192.168.1.40',
              mac: 'AA:BB:CC:DD:EE:11',
              isOnline: true,
              cpuUsage: 77,
              ramUsage: 64,
              diskUsage: 81,
              cpuCores: 24,
              ramUsedGb: 32.0,
              ramTotalGb: 64.0,
              uptimeSec: 7200,
              osName: 'Windows 11 Workstation',
              viewOnlyMode: true,
              latencyMs: 18,
            ),
          );
          fleet.addHost(
            app.HostState(
              id: 'PC-2',
              name: 'Sleeping-Hypervisor-Node-02',
              ip: '192.168.1.41',
              mac: '00:00:00:00:00:00',
              isOnline: false,
            ),
          );
          await Future<void>.delayed(const Duration(milliseconds: 30));
        });

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: const app.AINetControllerApp(),
          ),
        );

        // Medium 2-column viewport (700x900)
        tester.view.physicalSize = const Size(700, 900);
        tester.view.devicePixelRatio = 1.0;
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        // Expand PC-1 on Medium 2-col layout: spans full width with zero clipping
        await tester.tap(find.byKey(const ValueKey('device-card-expand-PC-1')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        final card1Rect = tester.getRect(
          find.ancestor(
            of: find.byKey(const ValueKey('device-card-expand-PC-1')),
            matching: find.byType(ResponsiveDeviceCard),
          ),
        );
        expect(card1Rect.width, greaterThan(550));
        expect(find.text('View-Only'), findsOneWidget);
        expect(tester.takeException(), isNull);

        // Expand PC-2 (offline, no MAC configured) on Medium
        final fleetScroll = find
            .descendant(
              of: find.byType(RefreshIndicator),
              matching: find.byType(Scrollable),
            )
            .first;
        final expand2 = find.byKey(const ValueKey('device-card-expand-PC-2'));
        await tester.scrollUntilVisible(expand2, 220, scrollable: fleetScroll);
        await tester.pump();
        await Scrollable.ensureVisible(tester.element(expand2), alignment: 0.4);
        await tester.pump();
        await tester.tap(expand2);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.text('MAC not configured'), findsOneWidget);
        expect(find.text('MAC Needed'), findsOneWidget);
        expect(tester.takeException(), isNull);

        // Ultra-narrow 280x653 viewport with expanded card at 1.35x font scale
        tester.view.physicalSize = const Size(280, 653);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(tester.takeException(), isNull);

        // Switch back to online card expanded on 280x653
        final expand1 = find.byKey(const ValueKey('device-card-expand-PC-1'));
        await tester.scrollUntilVisible(
          expand1,
          -220,
          scrollable: fleetScroll,
        );
        await tester.pump();
        await Scrollable.ensureVisible(tester.element(expand1), alignment: 0.25);
        await tester.pump();
        await tester.tap(expand1);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'HostSnapshotPreview fetches live snapshot JPEG over AEAD and refreshes manually',
      (tester) async {
        final prevOverrides = HttpOverrides.current;
        HttpOverrides.global = null;
        late _MockPipelineServer server;
        int snapshotRequests = 0;

        await tester.runAsync(() async {
          server = await _MockPipelineServer.start();
        });
        final sub = server.receivedFrames.listen((frame) {
          if (frame.opcode == BinaryOpcode.viewportResize) {
            final decoded = jsonDecode(utf8.decode(frame.payload));
            if (decoded is Map && decoded['snapshot'] == true) {
              snapshotRequests++;
            }
          }
        });

        addTearDown(() async {
          await sub.cancel();
          HostConnectionPool.instance.disposeAll();
          await tester.runAsync(() => server.close());
          HttpOverrides.global = prevOverrides;
        });

        await tester.runAsync(() async {
          await tester.pumpWidget(
            MaterialApp(
              theme: CyberTheme.themeData,
              home: Scaffold(
                body: SizedBox(
                  width: 360,
                  child: HostSnapshotPreview(
                    hostId: 'snap-1',
                    hostName: 'Mock-PC',
                    hostIp: '127.0.0.1',
                    wsPort: server.port,
                    sharedSecret: server.psk,
                    isOnline: true,
                    refreshIntervalSec: 0,
                    onTapFullscreen: () {},
                  ),
                ),
              ),
            ),
          );
          await server.vaultEstablished.timeout(const Duration(seconds: 4));
          final deadline = DateTime.now().add(const Duration(seconds: 3));
          while (snapshotRequests < 1 && DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 25));
            await tester.pump();
          }
          await Future<void>.delayed(const Duration(milliseconds: 80));
          await tester.pump();
        });

        expect(snapshotRequests, greaterThanOrEqualTo(1));
        expect(find.byType(Image), findsOneWidget);
        expect(find.textContaining('PREVIEW •'), findsOneWidget);

        final int beforeManual = snapshotRequests;
        await tester.tap(find.byKey(const ValueKey('snapshot-refresh-snap-1')));
        await tester.pump();
        await tester.runAsync(() async {
          final deadline = DateTime.now().add(const Duration(seconds: 2));
          while (snapshotRequests <= beforeManual &&
              DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 25));
            await tester.pump();
          }
        });
        await tester.pump();

        expect(snapshotRequests, greaterThan(beforeManual));
        expect(tester.takeException(), isNull);

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      },
    );
  });

  group('Settings Command Deck, WoL Hub & Unified Activity History', () {
    testWidgets(
      'positions Appearance Studio below Bento grid, switches hubs, searches, shows Modified badges & per-section resets, and persists Touch controls',
      (tester) async {
        late Directory tempDir;
        await tester.runAsync(() async {
          tempDir = await _openAllTestHiveBoxes('ai_net_deck_1_');
        });
        addTearDown(() async {
          await tester.runAsync(() => _closeAndDeleteHiveDir(tempDir));
        });

        tester.view.physicalSize = const Size(430, 932);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });

        final container = ProviderContainer();
        addTearDown(container.dispose);

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              theme: CyberTheme.themeData,
              home: Scaffold(
                body: SettingsCommandDeck(
                  hosts: const [
                    SettingsHostSummary(
                      id: 'PC-1',
                      name: 'Alpha-PC',
                      ip: '192.168.1.50',
                      mac: 'AA:BB:CC:DD:EE:01',
                      isOnline: true,
                    ),
                  ],
                  savedGlobalSecret: 'ainet_test_token',
                  onToast: (String _, {Color? accentColor}) {},
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        final deckScrollable = find.byType(Scrollable).first;

        // 1. Customization (Appearance Studio) is NOT at top and starts collapsed
        final streamingHub = find.byKey(const ValueKey('settings-hub-streaming'));
        expect(streamingHub, findsOneWidget);
        expect(find.byKey(const ValueKey('theme-mode-dark')), findsNothing);
        final double streamingTopY = tester.getTopLeft(streamingHub).dy;
        final double initialPixels =
            tester.state<ScrollableState>(deckScrollable).position.pixels;

        final appearanceHub = find.byKey(
          const ValueKey('settings-hub-appearance'),
        );
        await tester.scrollUntilVisible(
          appearanceHub,
          240,
          scrollable: deckScrollable,
        );
        await tester.pump();
        final double scrolledPixels =
            tester.state<ScrollableState>(deckScrollable).position.pixels;
        expect(scrolledPixels, greaterThan(initialPixels));
        expect(
          (scrolledPixels - initialPixels) + tester.getTopLeft(appearanceHub).dy,
          greaterThan(streamingTopY),
        );

        // Expand Appearance Studio inline & test polarity + reset
        await _scrollCenterAndTap(
          tester,
          appearanceHub,
          scrollable: deckScrollable,
        );
        expect(find.byKey(const ValueKey('theme-mode-dark')), findsOneWidget);
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('theme-mode-dark')),
          scrollable: deckScrollable,
        );
        expect(
          container.read(appPreferencesProvider).themeMode,
          equals(AppThemeMode.dark),
        );
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('reset-appearance-btn')),
          scrollable: deckScrollable,
        );
        expect(
          container.read(appPreferencesProvider).themeMode,
          equals(AppThemeMode.daylight),
        );

        // 2. Modified badge & per-section Reset on Streaming
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('target-fps-15')),
          scrollable: deckScrollable,
          delta: -220,
        );
        expect(container.read(appPreferencesProvider).targetFps, equals(15));
        expect(find.text('Modified'), findsAtLeastNWidgets(1));
        expect(
          find.byKey(const ValueKey('reset-section-streaming')),
          findsOneWidget,
        );
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('reset-section-streaming')),
          scrollable: deckScrollable,
          delta: -220,
        );
        expect(container.read(appPreferencesProvider).targetFps, equals(60));
        expect(
          find.byKey(const ValueKey('reset-section-streaming')),
          findsNothing,
        );

        // 3. Switch to Touch hub & mutate advanced touch preferences
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('settings-hub-touch')),
          scrollable: deckScrollable,
          delta: -220,
        );
        expect(find.text('TOUCH & CONTROLS'), findsOneWidget);

        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('instant-tap-mode-switch')),
          scrollable: deckScrollable,
        );
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('natural-scroll-switch')),
          scrollable: deckScrollable,
        );
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('pinch-zoom-switch')),
          scrollable: deckScrollable,
        );
        expect(container.read(appPreferencesProvider).instantTapMode, isFalse);
        expect(container.read(appPreferencesProvider).naturalScroll, isTrue);
        expect(container.read(appPreferencesProvider).pinchZoomEnabled, isFalse);
        expect(
          find.byKey(const ValueKey('long-press-delay-slider')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('scroll-sensitivity-slider')),
          findsOneWidget,
        );

        // Verify persistence across cold Hive restart
        final reopened = AppPreferencesNotifier(
          boxOverride: Hive.box(kAppPrefsBoxName),
        ).state;
        expect(reopened.instantTapMode, isFalse);
        expect(reopened.naturalScroll, isTrue);
        expect(reopened.pinchZoomEnabled, isFalse);

        // Reset only Touch section
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('reset-section-touch')),
          scrollable: deckScrollable,
          delta: -220,
        );
        expect(container.read(appPreferencesProvider).instantTapMode, isTrue);
        expect(container.read(appPreferencesProvider).naturalScroll, isFalse);
        expect(container.read(appPreferencesProvider).pinchZoomEnabled, isTrue);

        // 4. Instant Search filters across categories
        final searchField = find.byKey(const ValueKey('settings-search-input'));
        await tester.scrollUntilVisible(
          searchField,
          -240,
          scrollable: deckScrollable,
        );
        await tester.pump();
        await Scrollable.ensureVisible(
          tester.element(searchField),
          alignment: 0.1,
        );
        await tester.pump();
        await tester.enterText(searchField, 'pinch');
        await tester.pump();
        expect(find.textContaining('SEARCH RESULTS'), findsOneWidget);
        expect(find.text('Pinch-to-Zoom Live Stream'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('settings-hub-streaming')),
          findsNothing,
        );

        await tester.enterText(searchField, 'zz_nonexistent_zz');
        await tester.pump();
        expect(find.text('No Matching Settings Found'), findsOneWidget);

        await tester.tap(find.text('Clear'));
        await tester.pump();
        expect(
          find.byKey(const ValueKey('settings-hub-streaming')),
          findsOneWidget,
        );

        // 5. Switch to Security & Network hubs cleanly
        await tester.tap(find.byKey(const ValueKey('settings-hub-security')));
        await tester.pump();
        expect(find.text('SECURITY & VAULT'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('purge-secrets-btn')),
          findsOneWidget,
        );

        await tester.tap(find.byKey(const ValueKey('settings-hub-network')));
        await tester.pump();
        expect(find.text('NETWORK & DISCOVERY'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('network-scan-port-tile')),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'Config JSON export strips secrets and imports sanitized preferences & hosts',
      (tester) async {
        late Directory tempDir;
        await tester.runAsync(() async {
          tempDir = await _openAllTestHiveBoxes('ai_net_deck_cfg_');
        });
        addTearDown(() async {
          await tester.runAsync(() => _closeAndDeleteHiveDir(tempDir));
        });

        String? clipboardText;
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          if (call.method == 'Clipboard.setData') {
            clipboardText = (call.arguments as Map)['text'] as String?;
          } else if (call.method == 'Clipboard.getData') {
            return <String, dynamic>{'text': clipboardText ?? ''};
          }
          return null;
        });
        addTearDown(() {
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
              .setMockMethodCallHandler(SystemChannels.platform, null);
        });

        final container = ProviderContainer();
        addTearDown(container.dispose);

        // Unit check: exportConfigJson strictly omits secrets from raw host maps
        final prefsNotifier = container.read(appPreferencesProvider.notifier);
        await tester.runAsync(() async {
          await prefsNotifier.setTargetFps(30);
          await prefsNotifier.setWolPort(7);
        });
        final rawExport = prefsNotifier.exportConfigJson(
          hosts: [
            {
              'id': 'H1',
              'name': 'Work-PC',
              'ip': '192.168.1.77',
              'wsPort': 8765,
              'mac': 'aa-bb-cc-dd-ee-77',
              'osName': 'Windows 11',
              'useTls': true,
              'sharedSecret': 'ainet_TOP_SECRET_MUST_NOT_LEAK',
              'pairingToken': 'tok_secret',
              'pin': '123456',
              'certFingerprint': 'deadbeef',
            },
          ],
        );
        expect(rawExport, isNot(contains('ainet_TOP_SECRET_MUST_NOT_LEAK')));
        expect(rawExport, isNot(contains('sharedSecret')));
        expect(rawExport, isNot(contains('pairingToken')));
        expect(rawExport, isNot(contains('certFingerprint')));
        expect(rawExport, contains('192.168.1.77'));

        List<Map<String, dynamic>> importedHosts = const [];
        tester.view.physicalSize = const Size(430, 932);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              theme: CyberTheme.themeData,
              home: Scaffold(
                body: SettingsCommandDeck(
                  hosts: const [
                    SettingsHostSummary(
                      id: 'H1',
                      name: 'Work-PC',
                      ip: '192.168.1.77',
                      mac: 'AA:BB:CC:DD:EE:77',
                      useTls: true,
                    ),
                  ],
                  onImportSanitizedHosts: (list) => importedHosts = list,
                  onToast: (String _, {Color? accentColor}) {},
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        final deckScrollable = find.byType(Scrollable).first;
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('export-config-json-btn')),
          scrollable: deckScrollable,
        );
        await tester.pumpAndSettle();
        expect(find.text('Exported Config JSON'), findsOneWidget);
        expect(clipboardText, isNotNull);
        expect(clipboardText!, isNot(contains('sharedSecret')));
        expect(clipboardText!, contains('192.168.1.77'));

        await tester.tap(find.text('Close'));
        await tester.pumpAndSettle();

        // Reset prefs before importing the exported JSON backup back
        await tester.runAsync(() => prefsNotifier.resetDefaults());
        expect(container.read(appPreferencesProvider).targetFps, equals(60));
        expect(container.read(appPreferencesProvider).wolPort, equals(9));

        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('import-config-json-btn')),
          scrollable: deckScrollable,
        );
        await tester.pumpAndSettle();

        // Rejects malformed JSON cleanly
        await tester.enterText(
          find.byKey(const ValueKey('import-config-json-input')),
          '{bad json',
        );
        await tester.tap(find.byKey(const ValueKey('import-config-json-submit')));
        await tester.pump();
        expect(find.textContaining('Invalid JSON syntax'), findsOneWidget);

        // Imports valid backup JSON
        await tester.enterText(
          find.byKey(const ValueKey('import-config-json-input')),
          clipboardText!,
        );
        await tester.pump();
        await tester.runAsync(() async {
          await tester.tap(
            find.byKey(const ValueKey('import-config-json-submit')),
          );
          final deadline = DateTime.now().add(const Duration(seconds: 2));
          while (container.read(historyProvider).isEmpty &&
              DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 20));
          }
          await Future<void>.delayed(const Duration(milliseconds: 40));
        });
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 350));

        expect(container.read(appPreferencesProvider).targetFps, equals(30));
        expect(container.read(appPreferencesProvider).wolPort, equals(7));
        expect(importedHosts.length, equals(1));
        expect(importedHosts.single['ip'], equals('192.168.1.77'));
        expect(
          container.read(historyProvider).any(
                (e) =>
                    e.category == ActivityCategory.system &&
                    e.title == 'Configuration Restored',
              ),
          isTrue,
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'WoL Hub dispatches Magic Packets with tuning params, persists WoL History, and supports Re-Send',
      (tester) async {
        late Directory tempDir;
        await tester.runAsync(() async {
          tempDir = await _openAllTestHiveBoxes('ai_net_wol_hub_');
        });
        addTearDown(() async {
          await tester.runAsync(() => _closeAndDeleteHiveDir(tempDir));
        });

        final dispatchedCalls = <Map<String, Object?>>[];
        Future<WolDispatchResult> mockDispatch({
          required String targetMac,
          String targetIp = '',
          String hostName = '',
          int port = 9,
          String? customBroadcastIp,
          int burstCount = 1,
          bool sendGratuitousArp = true,
        }) async {
          dispatchedCalls.add({
            'mac': targetMac,
            'ip': targetIp,
            'hostName': hostName,
            'port': port,
            'broadcast': customBroadcastIp,
            'burstCount': burstCount,
            'garp': sendGratuitousArp,
          });
          return WolDispatchResult(
            success: true,
            mac: targetMac,
            targets: <String>[customBroadcastIp ?? '255.255.255.255'],
            port: port,
            burstCount: burstCount,
            latencyMs: 6,
          );
        }

        tester.view.physicalSize = const Size(430, 932);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });

        final container = ProviderContainer();
        addTearDown(container.dispose);

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              theme: CyberTheme.themeData,
              home: Scaffold(
                body: SettingsCommandDeck(
                  initialHub: SettingsDeckHub.wol,
                  hosts: const [
                    SettingsHostSummary(
                      id: 'SLEEP-1',
                      name: 'Sleeper-Rig',
                      ip: '192.168.1.88',
                      mac: 'AA:BB:CC:DD:EE:88',
                      isOnline: false,
                    ),
                  ],
                  onDispatchWol: mockDispatch,
                  onToast: (String _, {Color? accentColor}) {},
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        final deckScrollable = find.byType(Scrollable).first;

        // Tune UDP port -> 7 and burst -> 3x
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('wol-port-7')),
          scrollable: deckScrollable,
        );
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('wol-burst-3')),
          scrollable: deckScrollable,
        );

        // Send Magic Packet for selected sleeping host
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('wol-send-btn')),
          scrollable: deckScrollable,
          delta: -220,
          settleDuration: Duration.zero,
        );
        await tester.runAsync(() async {
          final deadline = DateTime.now().add(const Duration(seconds: 2));
          while ((dispatchedCalls.isEmpty ||
                  container.read(historyProvider).isEmpty) &&
              DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 20));
          }
          await Future<void>.delayed(const Duration(milliseconds: 40));
        });
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.text('Sending...'), findsNothing);

        expect(dispatchedCalls.length, equals(1));
        expect(dispatchedCalls.single['mac'], equals('AA:BB:CC:DD:EE:88'));
        expect(dispatchedCalls.single['port'], equals(7));
        expect(dispatchedCalls.single['burstCount'], equals(3));

        final entries = container.read(historyProvider);
        expect(entries.length, equals(1));
        expect(entries.single.category, equals(ActivityCategory.wol));
        expect(entries.single.hostName, equals('Sleeper-Rig'));

        // Verify persistence in Hive
        final reopenedHistory = HistoryNotifier(
          boxOverride: Hive.box(kHistoryBoxName),
        ).state;
        expect(reopenedHistory.length, equals(1));
        expect(reopenedHistory.single.mac, equals('AA:BB:CC:DD:EE:88'));

        // Tap Re-Send in WoL Dispatch History
        final resendBtn = find.byKey(
          ValueKey('wol-resend-${entries.single.id}'),
        );
        await _scrollCenterAndTap(
          tester,
          resendBtn,
          scrollable: deckScrollable,
          settleDuration: Duration.zero,
        );
        await tester.runAsync(() async {
          final deadline = DateTime.now().add(const Duration(seconds: 2));
          while ((dispatchedCalls.length < 2 ||
                  container.read(historyProvider).length < 2) &&
              DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 20));
          }
          await Future<void>.delayed(const Duration(milliseconds: 40));
        });
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.text('Sending...'), findsNothing);

        expect(dispatchedCalls.length, equals(2));
        expect(container.read(historyProvider).length, equals(2));
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'Unified Activity History filters, searches, re-runs commands, exports JSON/CSV, and clears',
      (tester) async {
        late Directory tempDir;
        await tester.runAsync(() async {
          tempDir = await _openAllTestHiveBoxes('ai_net_hist_');
        });
        addTearDown(() async {
          await tester.runAsync(() => _closeAndDeleteHiveDir(tempDir));
        });

        String? clipboardText;
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          if (call.method == 'Clipboard.setData') {
            clipboardText = (call.arguments as Map)['text'] as String?;
          }
          return null;
        });
        addTearDown(() {
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
              .setMockMethodCallHandler(SystemChannels.platform, null);
        });

        final container = ProviderContainer();
        addTearDown(container.dispose);

        await tester.runAsync(() async {
          final history = container.read(historyProvider.notifier);
          await history.recordCommand(
            command: 'ipconfig /all',
            hostName: 'Alpha-PC',
            hostIp: '192.168.1.50',
            success: true,
            exitCode: 0,
            latencyMs: 22,
          );
          await history.recordConnection(
            hostIp: '192.168.1.50',
            hostName: 'Alpha-PC',
            success: true,
            latencyMs: 9,
          );
          await history.recordWol(
            mac: 'AA:BB:CC:DD:EE:50',
            hostName: 'Render-PC',
            hostIp: '192.168.1.51',
            success: true,
          );
        });

        ActivityHistoryEntry? rerunEntry;
        tester.view.physicalSize = const Size(430, 932);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              theme: CyberTheme.themeData,
              home: Scaffold(
                body: SettingsCommandDeck(
                  initialHub: SettingsDeckHub.history,
                  onRerunCommand: (entry) async {
                    rerunEntry = entry;
                  },
                  onToast: (String _, {Color? accentColor}) {},
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('All (3)'), findsOneWidget);
        expect(find.text('Commands (1)'), findsOneWidget);
        expect(find.text('Connections (1)'), findsOneWidget);
        expect(find.text('WoL (1)'), findsOneWidget);

        // Filter by Commands
        final deckScrollable = find.byType(Scrollable).first;
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('history-filter-command')),
          scrollable: deckScrollable,
        );
        expect(find.text('Remote Command Executed'), findsOneWidget);
        expect(find.text('Wake-on-LAN Sent'), findsNothing);

        // Expand command entry and tap Re-run
        final cmdEntry = container.read(historyProvider).firstWhere(
              (e) => e.category == ActivityCategory.command,
            );
        await _scrollCenterAndTap(
          tester,
          find.byKey(ValueKey('history-entry-${cmdEntry.id}')),
          scrollable: deckScrollable,
        );
        await _scrollCenterAndTap(
          tester,
          find.byKey(ValueKey('history-rerun-${cmdEntry.id}')),
          scrollable: deckScrollable,
        );
        expect(rerunEntry?.id, equals(cmdEntry.id));

        // Reset filter to All & search
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('history-filter-all')),
          scrollable: deckScrollable,
          delta: -200,
        );
        await tester.enterText(
          find.byKey(const ValueKey('history-search-input')),
          'Render-PC',
        );
        await tester.pump();
        expect(find.text('Wake-on-LAN Sent'), findsOneWidget);
        expect(find.text('Remote Command Executed'), findsNothing);

        // Clear search
        await tester.enterText(
          find.byKey(const ValueKey('history-search-input')),
          '',
        );
        await tester.pump();

        // Export JSON & CSV
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('history-export-json-btn')),
          scrollable: deckScrollable,
        );
        final decodedExport = jsonDecode(clipboardText!) as Map<String, dynamic>;
        expect(decodedExport['count'], equals(3));

        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('history-export-csv-btn')),
          scrollable: deckScrollable,
        );
        expect(
          clipboardText!,
          startsWith(
            'id,timestamp_iso,timestamp_ms,category,status,host_name,host_ip,mac,title,detail,latency_ms,meta_json',
          ),
        );
        expect(clipboardText!, contains('ipconfig /all'));

        // Clear All
        await _scrollCenterAndTap(
          tester,
          find.byKey(const ValueKey('history-clear-btn')),
          scrollable: deckScrollable,
        );
        await tester.pumpAndSettle();
        final confirmClearBtn = find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('Clear'),
        );
        await tester.runAsync(() async {
          await tester.tap(confirmClearBtn);
          final deadline = DateTime.now().add(const Duration(seconds: 2));
          while (container.read(historyProvider).isNotEmpty &&
              DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 20));
          }
          await Future<void>.delayed(const Duration(milliseconds: 40));
        });
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(container.read(historyProvider), isEmpty);
        expect(find.text('No Activity History Recorded Yet'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  });

  group('Low-Latency Mobile Pipeline (frameAck, ChaCha20, Isolate, instantTapMode)', () {
    Uint8List hex(String h) => Uint8List.fromList([
          for (int i = 0; i < h.length; i += 2)
            int.parse(h.substring(i, i + 2), radix: 16),
        ]);

    test('ChaCha20Poly1305Cipher matches RFC 8439 vector and FrameDecryptIsolate handles valid, tampered, invalid-JPEG, and 1-slot drop overwrite', () async {
      // 1. ChaCha20Poly1305Cipher RFC 8439 Section 2.8.2 test vector
      final rfcKey = hex(
        '808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f',
      );
      final rfcNonce = hex('070000004041424344454647');
      final rfcAad = hex('50515253c0c1c2c3c4c5c6c7');
      final rfcPt = Uint8List.fromList(
        utf8.encode(
          "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
        ),
      );
      const expectedRfcOut =
          'd31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d6'
          '3dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b36'
          '92ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc'
          '3ff4def08e4b7a9de576d26586cec64b61161ae10b594f09e26a7e902ecbd0600691';

      final cipher = ChaCha20Poly1305Cipher();
      final ct = cipher.encrypt(rfcKey, rfcNonce, rfcPt, aad: rfcAad);
      expect(
        ct.map((b) => b.toRadixString(16).padLeft(2, '0')).join(),
        equals(expectedRfcOut),
      );
      expect(
        cipher.decrypt(rfcKey, rfcNonce, ct, aad: rfcAad),
        equals(rfcPt),
      );

      // Helper to pack canonical encrypted OP_FRAME wire packet
      final sessionKey = Uint8List.fromList(
        List<int>.generate(32, (i) => (i * 7 + 1) & 0xFF),
      );
      Uint8List buildEncryptedOpFrame(int seq, Uint8List plaintext) {
        final wireLen = kNonceSize + plaintext.length + kTagSize;
        final out = Uint8List(kHeaderSize + wireLen);
        out[0] = kMagicByte0;
        out[1] = kMagicByte1;
        out[2] = BinaryOpcode.frame;
        out[3] = ProtocolFlags.encrypted;
        final bd = ByteData.sublistView(out);
        bd.setUint32(4, seq, Endian.big);
        bd.setUint32(8, wireLen, Endian.big);
        bd.setUint32(12, 0, Endian.big);
        bd.setUint64(16, seq, Endian.big);
        final aad = Uint8List.sublistView(out, 0, kHeaderSize);
        final nonce = Uint8List.sublistView(out, 12, 24);
        cipher.encryptInto(sessionKey, nonce, plaintext, out, 24, aad: aad);
        return out;
      }

      final validJpeg = base64Decode(_kSampleJpegBase64);

      // 2. Background Isolate worker decrypt + 1-slot drop + error checks
      final decryptedSeqs = <int>[];
      final decryptedBytes = <Uint8List>[];
      final droppedSeqs = <int>[];
      final errors = <(int, String)>[];

      final isolateDecrypt = FrameDecryptIsolate(
        recvKey: sessionKey,
        enableIsolate: true,
        onFrameDecrypted: (seq, pt) {
          decryptedSeqs.add(seq);
          decryptedBytes.add(pt);
        },
        onFrameDropped: droppedSeqs.add,
        onDecryptError: (seq, reason) => errors.add((seq, reason)),
      );
      await isolateDecrypt.ready;
      expect(isolateDecrypt.isIsolateReady, isTrue);

      // Burst 3 frames synchronously: frame 1 in flight, frame 2 pending,
      // frame 3 overwrites frame 2 -> droppedSeqs contains 2!
      isolateDecrypt.enqueueEncryptedFrame(buildEncryptedOpFrame(1, validJpeg), 1);
      isolateDecrypt.enqueueEncryptedFrame(buildEncryptedOpFrame(2, validJpeg), 2);
      isolateDecrypt.enqueueEncryptedFrame(buildEncryptedOpFrame(3, validJpeg), 3);

      final deadline = DateTime.now().add(const Duration(seconds: 3));
      while (decryptedSeqs.length < 2 && DateTime.now().isBefore(deadline)) {
        await Future<void>.delayed(const Duration(milliseconds: 15));
      }
      expect(droppedSeqs, equals([2]));
      expect(decryptedSeqs, equals([1, 3]));
      expect(decryptedBytes.last, equals(validJpeg));
      expect(isolateDecrypt.lastVerifiedNonceSeq, equals(3));

      // Tampered tag -> 'aead' error; non-JPEG payload -> 'jpeg' error
      final badTag = buildEncryptedOpFrame(4, validJpeg);
      badTag[badTag.length - 1] ^= 0xFF;
      final notJpeg = buildEncryptedOpFrame(5, Uint8List.fromList([1, 2, 3, 4]));
      isolateDecrypt.enqueueEncryptedFrame(badTag, 4);
      isolateDecrypt.enqueueEncryptedFrame(notJpeg, 5);

      final errDeadline = DateTime.now().add(const Duration(seconds: 3));
      while (errors.length < 2 && DateTime.now().isBefore(errDeadline)) {
        await Future<void>.delayed(const Duration(milliseconds: 15));
      }
      expect(errors, containsAllInOrder([(4, 'aead'), (5, 'jpeg')]));
      isolateDecrypt.dispose();
      cipher.dispose();
    });

    test('BinaryOpcode.frameAck (0x0E) & sendFrameAck / sendViewportConfig / requestSnapshot over wire', () async {
      expect(BinaryOpcode.frameAck, equals(0x0E));
      final prevOverrides = HttpOverrides.current;
      HttpOverrides.global = null;
      final server = await _MockPipelineServer.start();
      final client = HostConnectionClient(
        hostIp: '127.0.0.1',
        port: server.port,
        sharedSecret: server.psk,
      );
      final received = <_DecryptedFrame>[];
      final sub = server.receivedFrames.listen(received.add);

      try {
        await client.ensureConnected(timeout: const Duration(seconds: 5));
        expect(
          client.sendViewportConfig(
            width: 1280,
            height: 720,
            quality: 78,
            fps: 60,
            maxWidth: 1440,
            maxHeight: 810,
          ),
          isTrue,
        );
        expect(client.requestSnapshot(maxWidth: 640, maxHeight: 360, quality: 55), isTrue);
        expect(client.sendFrameAck(0x12345678), isTrue);

        final deadline = DateTime.now().add(const Duration(seconds: 2));
        while ((received.where((f) => f.opcode == BinaryOpcode.frameAck).isEmpty ||
                received.where((f) => f.opcode == BinaryOpcode.viewportResize).length < 2) &&
            DateTime.now().isBefore(deadline)) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
        }

        final ackFrame = received.singleWhere((f) => f.opcode == BinaryOpcode.frameAck);
        expect(ackFrame.payload.length, equals(4));
        expect(
          ByteData.sublistView(ackFrame.payload).getUint32(0, Endian.big),
          equals(0x12345678),
        );

        final vpFrames = received
            .where((f) => f.opcode == BinaryOpcode.viewportResize)
            .map((f) => jsonDecode(utf8.decode(f.payload)) as Map<String, dynamic>)
            .toList();
        expect(vpFrames[0]['frame_ack'], isTrue);
        expect(vpFrames[0]['max_width'], equals(1440));
        expect(vpFrames[0]['max_height'], equals(810));
        expect(vpFrames[1]['snapshot'], isTrue);
        expect(vpFrames[1]['stream_enabled'], isFalse);
      } finally {
        await sub.cancel();
        client.dispose();
        await server.close();
        HttpOverrides.global = prevOverrides;
      }
    });

    testWidgets(
      'ViewportStreamWidget instantTapMode=true sends 0ms left-click immediately vs instantTapMode=false waiting for double-tap disambiguation',
      (tester) async {
        final prevOverrides = HttpOverrides.current;
        HttpOverrides.global = null;
        late _MockPipelineServer server;
        await tester.runAsync(() async {
          server = await _MockPipelineServer.start();
        });

        final inputFrames = <Uint8List>[];
        final rxSub = server.receivedFrames.listen((f) {
          if (f.opcode == BinaryOpcode.input) {
            inputFrames.add(f.payload);
          }
        });

        addTearDown(() async {
          await rxSub.cancel();
          HostConnectionPool.instance.disposeAll();
          await tester.runAsync(() => server.close());
          HttpOverrides.global = prevOverrides;
        });

        List<Uint8List> clickPackets() => inputFrames
            .where((p) => p.length == 6 && p[0] == 5)
            .toList(growable: false);

        // --- Mode A: instantTapMode = true (0ms instant click) ---
        await tester.runAsync(() async {
          await tester.pumpWidget(
            MaterialApp(
              theme: CyberTheme.themeData,
              home: Scaffold(
                body: SizedBox(
                  width: 640,
                  height: 360,
                  child: ViewportStreamWidget(
                    hostIp: '127.0.0.1',
                    hostName: 'Instant-PC',
                    wsPort: server.port,
                    sharedSecret: server.psk,
                    initialInputMode: RemoteInputMode.touchscreen,
                    instantTapMode: true,
                    hapticsEnabled: false,
                  ),
                ),
              ),
            ),
          );
          await server.vaultEstablished.timeout(const Duration(seconds: 4));
          await Future<void>.delayed(const Duration(milliseconds: 50));
          await tester.pump();
        });
        inputFrames.clear();

        final surfaceCenter = tester.getCenter(
          find.byKey(const ValueKey('viewport-touch-surface')),
        );

        // Single tap -> dispatched immediately (no 175ms timer wait)
        final g1 = await tester.startGesture(surfaceCenter);
        await tester.pump();
        await g1.up();
        await tester.pump(const Duration(milliseconds: 10));
        await tester.runAsync(() async {
          final deadline = DateTime.now().add(const Duration(seconds: 1));
          while (clickPackets().isEmpty && DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 10));
          }
        });
        expect(clickPackets().length, equals(1));
        expect(clickPackets().single[5], equals(1)); // Left click immediately

        // Second quick tap within 220ms -> still buttonCode 1 in instantTapMode
        final g2 = await tester.startGesture(surfaceCenter);
        await tester.pump();
        await g2.up();
        await tester.pump(const Duration(milliseconds: 10));
        await tester.runAsync(() async {
          final deadline = DateTime.now().add(const Duration(seconds: 1));
          while (clickPackets().length < 2 && DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 10));
          }
        });
        expect(clickPackets().length, equals(2));
        expect(clickPackets()[1][5], equals(1));

        // --- Mode B: instantTapMode = false (delayed disambiguation + buttonCode 4 double-click) ---
        await tester.pumpWidget(
          MaterialApp(
            theme: CyberTheme.themeData,
            home: Scaffold(
              body: SizedBox(
                width: 640,
                height: 360,
                child: ViewportStreamWidget(
                  hostIp: '127.0.0.1',
                  hostName: 'Instant-PC',
                  wsPort: server.port,
                  sharedSecret: server.psk,
                  initialInputMode: RemoteInputMode.touchscreen,
                  instantTapMode: false,
                  hapticsEnabled: false,
                ),
              ),
            ),
          ),
        );
        await tester.pump();
        inputFrames.clear();

        final g3 = await tester.startGesture(surfaceCenter);
        await tester.pump();
        await g3.up();
        await tester.pump(const Duration(milliseconds: 25));
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 30)),
        );
        // Must NOT have fired click yet at 25ms (< 175ms disambiguation window)
        expect(clickPackets(), isEmpty);

        // Advance virtual timer past 175ms -> single click fires
        await tester.pump(const Duration(milliseconds: 170));
        await tester.runAsync(() async {
          final deadline = DateTime.now().add(const Duration(seconds: 1));
          while (clickPackets().isEmpty && DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 10));
          }
        });
        expect(clickPackets().length, equals(1));
        expect(clickPackets().single[5], equals(1));

        // Ensure real-clock gap exceeds _doubleTapWindow (220ms) before dt1
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 250)),
        );

        // Double tap in delayed mode -> emits single buttonCode=4 packet
        inputFrames.clear();
        final dt1 = await tester.startGesture(surfaceCenter);
        await tester.pump();
        await dt1.up();
        await tester.pump(const Duration(milliseconds: 40));
        final dt2 = await tester.startGesture(surfaceCenter);
        await tester.pump();
        await dt2.up();
        await tester.pump(const Duration(milliseconds: 20));
        await tester.runAsync(() async {
          final deadline = DateTime.now().add(const Duration(seconds: 1));
          while (clickPackets().isEmpty && DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 10));
          }
        });
        expect(clickPackets().length, equals(1));
        expect(clickPackets().single[5], equals(4));

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      },
    );
  });
}
