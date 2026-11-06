import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:cst_netcontroller/cst_netcontroller.dart';


void main() {
  group('CST Mobile Binary Protocol & Fragmentation Unit Tests', () {
    test('Header pack and parse roundtrip across all opcodes', () {
      final opcodes = [
        BinaryOpcode.ping,
        BinaryOpcode.telemetry,
        BinaryOpcode.frame,
        BinaryOpcode.shell,
        BinaryOpcode.hitl,
        BinaryOpcode.auth,
        BinaryOpcode.clip,
        BinaryOpcode.input,
        BinaryOpcode.audio,
        BinaryOpcode.viewportResize,
        BinaryOpcode.fileTransfer,
        BinaryOpcode.frameSync,
      ];

      for (final op in opcodes) {
        final payload = utf8.encode('Test payload for opcode $op');
        final packed = packPacket(op, payload, seq: 42 + op, flags: ProtocolFlags.encrypted);

        expect(packed.length, equals(kHeaderSize + payload.length));
        expect(packed[0], equals(kMagicByte0));
        expect(packed[1], equals(kMagicByte1));

        final parsed = parsePacket(packed);
        expect(parsed, isNotNull);
        expect(parsed!.opcode, equals(op));
        expect(parsed.flags, equals(ProtocolFlags.encrypted));
        expect(parsed.seq, equals(42 + op));
        expect(parsed.payload, equals(payload));
      }
    });

    test('Rejects invalid magic bytes and truncated headers', () {
      final truncated = Uint8List.fromList([0xC5, 0x71, 0x01]);
      expect(parsePacket(truncated), isNull);

      final corruptedMagic = Uint8List.fromList([0xAA, 0xBB, 0x01, 0x00, 0, 0, 0, 1, 0, 0, 0, 0]);
      expect(parsePacket(corruptedMagic), isNull);
    });

    test('Fragmentation engine splits and reassembles large payload', () {
      final largeData = Uint8List.fromList(List.generate(150000, (i) => i % 256));
      final fragments = PacketFragmenter.slice(
        opcode: BinaryOpcode.frame,
        payload: largeData,
        maxChunkSize: 32768,
      );

      expect(fragments.length, equals(5));

      final reassembler = PacketReassembler();
      ProtocolPacket? completed;

      for (final frag in fragments) {
        final res = reassembler.ingestBytes(frag);
        if (res != null) {
          completed = res;
        }
      }

      expect(completed, isNotNull);
      expect(completed!.payload.length, equals(largeData.length));
      expect(completed.payload, equals(largeData));
      reassembler.dispose();
    });

    test('High-throughput packet framing stress (25,000 packets)', () {
      final payload = Uint8List.fromList([1, 2, 3, 4, 5, 6, 7, 8]);
      final stopwatch = Stopwatch()..start();

      for (int i = 0; i < 25000; i++) {
        final packed = packPacket(BinaryOpcode.ping, payload, seq: i);
        final parsed = parsePacket(packed);
        expect(parsed?.seq, equals(i));
      }

      stopwatch.stop();
      expect(stopwatch.elapsedMilliseconds, lessThan(1000));
    });
  });
}
