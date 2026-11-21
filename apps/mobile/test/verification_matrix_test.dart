import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ai_netcontroller/ai_netcontroller.dart';

import '../integration_test/app_verification_test.dart' as verification_matrix;

void main() {
  verification_matrix.main();

  group('Newly Wired Protocol & UI Capabilities', () {
    test('parseHeader, writeHeader, and FragmentAssemblySession coalesce overlapping chunks safely', () {
      final buf = Uint8List(kHeaderSize + 4);
      writeHeader(
        buf,
        opcode: BinaryOpcode.llmStream,
        payloadLength: 4,
        flags: ProtocolFlags.encrypted,
        seq: 42,
      );
      buf.setRange(kHeaderSize, kHeaderSize + 4, [1, 2, 3, 4]);

      final header = parseHeader(buf);
      expect(header, isNotNull);
      expect(header!.opcode, equals(BinaryOpcode.llmStream));
      expect(header.flags, equals(ProtocolFlags.encrypted));
      expect(header.seq, equals(42));
      expect(header.payloadLength, equals(4));
      expect(parseHeader(Uint8List(kHeaderSize - 1)), isNull);

      final session = FragmentAssemblySession(
        messageId: 7,
        opcode: BinaryOpcode.frame,
        totalLength: 10,
        baseFlags: ProtocolFlags.compressed,
        baseSeq: 9,
      );
      // Deliver out-of-order + overlapping chunk: [5,10) then [0,6) overlap then remaining? [0,6) U [5,10) == [0,10)!
      expect(session.addChunk(5, Uint8List.fromList([5, 6, 7, 8, 9])), isTrue);
      expect(session.isComplete, isFalse);
      expect(session.bytesAccumulated, equals(5));

      // Duplicate identical chunk should add 0 net new bytes
      expect(session.addChunk(5, Uint8List.fromList([5, 6, 7, 8, 9])), isFalse);
      expect(session.bytesAccumulated, equals(5));

      // Overlapping chunk [0, 6) coalesces into full contiguous [0, 10)
      expect(session.addChunk(0, Uint8List.fromList([0, 1, 2, 3, 4, 5])), isTrue);
      expect(session.bytesAccumulated, equals(10));
      expect(session.isComplete, isTrue);
      expect(session.buffer, equals(Uint8List.fromList([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])));
    });

    test('HostConnectionClient new opcodes fail closed cleanly before vault handshake & ARP builder validates', () {
      final client = HostConnectionClient(
        hostIp: '127.0.0.1',
        sharedSecret: 'secret-token',
      );
      expect(client.activeMonitorIndex, equals(1));
      expect(client.sendClipboard('hello'), isFalse);
      expect(client.requestClipboard(), isFalse);
      expect(client.sendAudioCommand('play_pause'), isFalse);
      expect(client.requestDisplayEnum(switchMonitorIndex: 2), isFalse);
      expect(client.sendOllamaPrompt('explain this error'), isFalse);
      expect(client.sendRawEncryptedPacket(Uint8List(12)), isFalse);
      client.dispose();

      final arp = OsIntegrationsManager.instance.buildGratuitousArpPacket(
        targetMac: 'AA:BB:CC:DD:EE:FF',
        targetIp: '192.168.1.50',
        routerIp: '192.168.1.1',
      );
      expect(arp.length, equals(28));
      expect(arp[7], equals(2)); // ARP Reply opcode low byte

      // Pool must never hand back an externally disposed client
      final pooled1 = HostConnectionPool.instance.acquire(
        hostIp: '127.0.0.1',
        port: 18765,
        sharedSecret: 'pool_secret',
        certFingerprint: 'AA:BB',
      );
      final pooledSame = HostConnectionPool.instance.acquire(
        hostIp: '127.0.0.1',
        port: 18765,
        sharedSecret: 'pool_secret',
        certFingerprint: 'aabb',
      );
      expect(identical(pooled1, pooledSame), isTrue);
      pooled1.dispose();
      final pooledFresh = HostConnectionPool.instance.acquire(
        hostIp: '127.0.0.1',
        port: 18765,
        sharedSecret: 'pool_secret',
        certFingerprint: 'aabb',
      );
      expect(identical(pooled1, pooledFresh), isFalse);
      HostConnectionPool.instance.disposeAll();

      // ShellResult.fromJson accepts numeric double exit_code safely
      final parsedShell = ShellResult.fromJson({
        'status': 'success',
        'exit_code': 0.0,
        'output': 'ok',
        'command': 'echo ok',
      });
      expect(parsedShell.exitCode, equals(0));
      expect(parsedShell.isSuccess, isTrue);
    });

    testWidgets('ViewportStreamWidget preserves targetFps, toggles keepScreenAwake cleanly, and renders ValueListenable HUD', (tester) async {
      const widget = ViewportStreamWidget(
        hostIp: '127.0.0.1',
        hostName: 'Test-Workstation',
        sharedSecret: '',
        targetFps: 15,
        keepScreenAwake: true,
      );
      expect(widget.targetFps, equals(15));

      final resizeBytes = StreamBinaryPacket.packViewportResize(1920, 1080, seqId: 77);
      final parsedResize = StreamBinaryPacket.parse(resizeBytes);
      expect(parsedResize, isNotNull);
      expect(parsedResize!.opcode, equals(StreamOpcode.viewportResize));
      expect(parsedResize.seqId, equals(77));
      expect(parsedResize.payload.length, equals(8));

      await tester.pumpWidget(
        MaterialApp(
          theme: CyberTheme.themeData,
          home: const Scaffold(
            body: SizedBox(
              width: 640,
              height: 360,
              child: widget,
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Test-Workstation'), findsOneWidget);
      expect(find.text('0 FPS'), findsOneWidget);
      expect(find.text('--ms'), findsOneWidget);

      // Toggle keepScreenAwake via didUpdateWidget without refcount leak or error
      await tester.pumpWidget(
        MaterialApp(
          theme: CyberTheme.themeData,
          home: const Scaffold(
            body: SizedBox(
              width: 640,
              height: 360,
              child: ViewportStreamWidget(
                hostIp: '127.0.0.1',
                hostName: 'Test-Workstation',
                sharedSecret: '',
                targetFps: 30,
                keepScreenAwake: false,
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  });
}
