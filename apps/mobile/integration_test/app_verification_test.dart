// ==============================================================================
// CST CAPSTONE PROJECT: MOBILE CLIENT AUTOMATED INTEGRATION & VERIFICATION HARNESS
// Target: Flutter Mobile Application & Binary Protocol Engine
// File: integration_test/app_verification_test.dart
// ==============================================================================

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ai_netcontroller/ai_netcontroller.dart';







void main() {
  group('CST Mobile Client Verification Matrix', () {
    // =========================================================================
    // TC-03: BINARY WIRE PROTOCOL FRAMING & SERIALIZATION (ALL OPCODES)
    // =========================================================================
    group('TC-03: Binary Protocol Framing & ByteData Serialization', () {
      test(
          'Packs and unpacks 12-byte CST header with 0xC5, 0x71 across all opcodes',
          () {
        final List<int> allOpcodes = [
          BinaryOpcode.ping, // 0x01
          BinaryOpcode.telemetry, // 0x02
          BinaryOpcode.frame, // 0x03
          BinaryOpcode.shell, // 0x04
          BinaryOpcode.hitl, // 0x05
          BinaryOpcode.auth, // 0x06
          BinaryOpcode.clip, // 0x07
          BinaryOpcode.input, // 0x08
          BinaryOpcode.audio, // 0x09
          BinaryOpcode.viewportResize, // 0x0A
          BinaryOpcode.displayEnum, // 0x0B
          BinaryOpcode.fileTransfer, // 0x0C
          BinaryOpcode.frameSync, // 0xEE
        ];

        for (final opcode in allOpcodes) {
          final payload =
              utf8.encode('Payload for Opcode 0x${opcode.toRadixString(16)}');
          const int seq = 1024;
          const int flags = ProtocolFlags.compressed | ProtocolFlags.encrypted;

          final packed = packPacket(opcode, payload, seq: seq, flags: flags);

          // Assert Header Size
          expect(packed.length, equals(kHeaderSize + payload.length));

          // Assert Magic Identifier via ByteData
          final ByteData bd = ByteData.sublistView(packed);
          expect(bd.getUint8(0), equals(0xC5));
          expect(bd.getUint8(1), equals(0x71));
          expect(bd.getUint8(2), equals(opcode));
          expect(bd.getUint8(3), equals(flags));

          // Sequence number and length in Big Endian (4 bytes each)
          expect(bd.getUint32(4, Endian.big), equals(seq));
          expect(bd.getUint32(8, Endian.big), equals(payload.length));

          // Roundtrip Deserialization
          final parsed = parsePacket(packed);
          expect(parsed, isNotNull);
          expect(parsed!.opcode, equals(opcode));
          expect(parsed.flags, equals(flags));
          expect(parsed.seq, equals(seq));
          expect(parsed.payload, equals(payload));
        }
      });

      test('Rejects malformed packets with invalid magic signature', () {
        final corrupt = Uint8List.fromList(
            [0xAA, 0xBB, 0x01, 0x00, 0, 0, 0, 1, 0, 0, 0, 0]);
        final parsed = parsePacket(corrupt);
        expect(parsed, isNull);
      });

      test('Rejects truncated binary packets less than 12 bytes', () {
        final truncated = Uint8List.fromList([0xC5, 0x71, 0x01, 0x00, 0, 0, 0]);
        final parsed = parsePacket(truncated);
        expect(parsed, isNull);
      });

      test('Handles zero-length payload correctly (e.g. Heartbeat Ping)', () {
        final pingPkt = packPacket(BinaryOpcode.ping, const [], seq: 100);
        expect(pingPkt.length, equals(kHeaderSize));
        final parsed = parsePacket(pingPkt);
        expect(parsed, isNotNull);
        expect(parsed!.opcode, equals(BinaryOpcode.ping));
        expect(parsed.payload.length, equals(0));
      });

      test('Rejects trailing bytes outside the declared packet payload', () {
        final packet = StreamBinaryPacket.pack(
          StreamOpcode.ping,
          1,
          Uint8List(0),
        );
        final packetWithTrailingByte = Uint8List(packet.length + 1)
          ..setRange(0, packet.length, packet);

        expect(StreamBinaryPacket.parse(packet), isNotNull);
        expect(StreamBinaryPacket.parse(packetWithTrailingByte), isNull);
      });
    });

    // =========================================================================
    // SUB-MTU PACKET FRAGMENTATION & OUT-OF-ORDER REASSEMBLY
    // =========================================================================
    group('Sub-MTU Fragmentation Engine & Edge-Case Reassembly', () {
      test(
          'Slices 192KB oversized payload into 64KB chunks and reassembles out-of-order',
          () async {
        final reassembler = PacketReassembler();
        final completer = Completer<ProtocolPacket>();

        final sub = reassembler.onPacketReassembled.listen((packet) {
          if (!completer.isCompleted) {
            completer.complete(packet);
          }
        });

        // Generate 192 KB pseudo-random test payload
        final int payloadSize = 192 * 1024;
        final Uint8List sourcePayload = Uint8List(payloadSize);
        for (int i = 0; i < payloadSize; i++) {
          sourcePayload[i] = i % 256;
        }

        // Slice using PacketFragmenter
        final List<Uint8List> fragments = PacketFragmenter.slice(
          opcode: BinaryOpcode.frame,
          payload: sourcePayload,
          maxChunkSize: 64 * 1024,
          flags: ProtocolFlags.compressed,
          seq: 50,
        );

        expect(fragments.length, equals(3)); // 192KB / 64KB = 3 chunks

        // Deliver chunks in OUT-OF-ORDER sequence: Chunk 1, Chunk 0, Chunk 2
        reassembler.ingestBytes(fragments[1]);
        reassembler.ingestBytes(fragments[0]);
        reassembler.ingestBytes(fragments[2]);

        final reassembled =
            await completer.future.timeout(const Duration(seconds: 2));
        await sub.cancel();
        reassembler.dispose();

        expect(reassembled.opcode, equals(BinaryOpcode.frame));
        expect(reassembled.payload.length, equals(payloadSize));
        expect(reassembled.payload, equals(sourcePayload));
      });

      test('Emits frameSync request on damaged / incomplete video frames',
          () async {
        final reassembler = PacketReassembler();
        final completer = Completer<int>();

        final sub = reassembler.onFrameSyncRequested.listen((messageId) {
          if (!completer.isCompleted) {
            completer.complete(messageId);
          }
        });

        // Trigger an intentional out-of-order or aborted session
        final dummyPayload = Uint8List(128 * 1024);
        final chunks = PacketFragmenter.slice(
          opcode: BinaryOpcode.frame,
          payload: dummyPayload,
          maxChunkSize: 64 * 1024,
        );

        // Feed only chunk 0 of frame A
        reassembler.ingestBytes(chunks[0]);

        // Skip one frame ID to simulate a dropped frame between transmissions.
        PacketFragmenter.slice(
          opcode: BinaryOpcode.frame,
          payload: Uint8List(128 * 1024),
          maxChunkSize: 64 * 1024,
        );
        final dummyPayloadB = Uint8List(128 * 1024);
        dummyPayloadB[0] = 0xFF;
        final chunksB = PacketFragmenter.slice(
          opcode: BinaryOpcode.frame,
          payload: dummyPayloadB,
          maxChunkSize: 64 * 1024,
        );
        reassembler.ingestBytes(chunksB[0]);
        await expectLater(completer.future, completion(BinaryOpcode.frameSync));

        await sub.cancel();
        reassembler.dispose();
      });
    });

    // =========================================================================
    // TC-07: SAMSUNG PILL NAVIGATION BAR & 120HZ SPRING PHYSICS
    // =========================================================================
    group('TC-07: Pill Navigation & Spring Physics', () {
      testWidgets(
          'Programmatically taps each navigation tab (Устройства, Команди, Настройки) at 120Hz',
          (WidgetTester tester) async {
        int selectedTab = 0;
        final items = const [
          PillNavItem(
              icon: Icons.devices_rounded,
              activeIcon: Icons.devices_rounded,
              label: 'Устройства'),
          PillNavItem(
              icon: Icons.terminal_rounded,
              activeIcon: Icons.terminal_rounded,
              label: 'Команди'),
          PillNavItem(
              icon: Icons.tune_rounded,
              activeIcon: Icons.tune_rounded,
              label: 'Настройки'),
        ];

        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData.dark(),
            home: Scaffold(
              body: StatefulBuilder(
                builder: (context, setState) {
                  return Stack(
                    children: [
                      Center(child: Text('Current Tab: $selectedTab')),
                      Align(
                        alignment: Alignment.bottomCenter,
                        child: SamsungPillNavBar(
                          selectedIndex: selectedTab,
                          items: items,
                          accentColor: CyberColors.primary,
                          onTabSelected: (index) {
                            setState(() {
                              selectedTab = index;
                            });
                          },
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        // Verify initial state
        expect(find.text('Устройства'), findsOneWidget);
        expect(find.text('Команди'), findsOneWidget);
        expect(find.text('Настройки'), findsOneWidget);
        expect(find.text('Current Tab: 0'), findsOneWidget);

        // 1. Tap on 'Команди' tab (index 1)
        await tester.tap(find.text('Команди'));
        // Simulate 120Hz frame pumping (8.33ms per frame)
        for (int frame = 0; frame < 12; frame++) {
          await tester.pump(const Duration(milliseconds: 8));
        }
        await tester.pumpAndSettle();
        expect(selectedTab, equals(1));
        expect(find.text('Current Tab: 1'), findsOneWidget);

        // 2. Tap on 'Настройки' tab (index 2)
        await tester.tap(find.text('Настройки'));
        for (int frame = 0; frame < 12; frame++) {
          await tester.pump(const Duration(milliseconds: 8));
        }
        await tester.pumpAndSettle();
        expect(selectedTab, equals(2));
        expect(find.text('Current Tab: 2'), findsOneWidget);

        // 3. Tap back to 'Устройства' tab (index 0)
        await tester.tap(find.text('Устройства'));
        for (int frame = 0; frame < 12; frame++) {
          await tester.pump(const Duration(milliseconds: 8));
        }
        await tester.pumpAndSettle();
        expect(selectedTab, equals(0));
        expect(find.text('Current Tab: 0'), findsOneWidget);
      });

      test('Validates FluidTheme neon cyber palette constants', () {
        expect(CyberColors.primary, equals(const Color(0xFF00F0FF)));
        expect(CyberColors.warning, equals(const Color(0xFFFFB800)));
        expect(CyberColors.success, equals(const Color(0xFF00FF9D)));
        expect(CyberColors.accent, equals(const Color(0xFFFF0055)));
      });
    });

    // =========================================================================
    // TC-09: BIOMETRIC SECURITY GATE DATA TYPES & STATE
    // =========================================================================
    group('TC-09: Biometric Security Gate', () {
      test('Constructs and verifies BiometricAuthResult lifecycle', () {
        final result = BiometricAuthResult(
          isApproved: true,
          message: 'Biometric authorization granted for operator.',
          timestamp: DateTime.now(),
        );
        expect(result.isApproved, isTrue);
        expect(result.message, contains('granted'));
        expect(result.errorCode, isNull);
      });
    });

    // =========================================================================
    // TC-14: PRESENTATION FAIL-SAFE DEMO MODE ACTIVATION
    // =========================================================================
    group('TC-14: Fail-Safe Demo Mode Activation', () {
      late DemoSandboxEngine engine;

      setUp(() {
        engine = DemoSandboxEngine();
      });

      tearDown(() {
        engine.stop();
      });

      test(
          'Toggles sandbox and streams synthetic telemetry graphs without sockets',
          () async {
        final completer = Completer<TelemetryData>();
        final sub = engine.telemetryStream.listen((data) {
          if (!completer.isCompleted) {
            completer.complete(data);
          }
        });

        // Activate offline sandbox
        engine.start();

        final data = await completer.future.timeout(const Duration(seconds: 4));
        await sub.cancel();

        expect(data.hostname, equals('LAB-WORKSTATION-01'));
        expect(data.cpuPercent, inInclusiveRange(0.0, 100.0));
        expect(data.ramPercent, inInclusiveRange(0.0, 100.0));
        expect(data.status, equals('autonomous_ready'));
      });

      test('Executes safe command in sandbox without network connectivity',
          () async {
        final completer = Completer<ShellResult>();
        final sub = engine.shellStream.listen((res) {
          if (!completer.isCompleted) {
            completer.complete(res);
          }
        });

        await engine.executeCommand('ipconfig /all');
        final res = await completer.future.timeout(const Duration(seconds: 2));
        await sub.cancel();

        expect(res.isSuccess, isTrue);
        expect(res.command, equals('ipconfig /all'));
        expect(res.output.length, greaterThan(0));
      });

      test(
          'Intercepts high-risk command and emits HitlApprovalEvent in sandbox',
          () async {
        final completer = Completer<HitlApprovalEvent>();
        final sub = engine.hitlStream.listen((event) {
          if (!completer.isCompleted) {
            completer.complete(event);
          }
        });

        await engine.executeCommand('del /f confidential.db');
        final event =
            await completer.future.timeout(const Duration(seconds: 2));
        await sub.cancel();

        expect(event.command, equals('del /f confidential.db'));
        expect(event.requiresBiometric, isTrue);
        expect(event.approvalId.length, greaterThan(0));
      });
    });
  });
}
