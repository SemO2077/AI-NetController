import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto_pkg;
import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'package:ai_netcontroller/protocol/binary_protocol.dart';
import 'package:ai_netcontroller/protocol/fragmentation_engine.dart';
import 'package:ai_netcontroller/protocol/network_framer.dart';
import 'package:ai_netcontroller/security/crypto_engine.dart' as ce;
import 'package:ai_netcontroller/security/secure_secret_store.dart';

void main() {
  group('Hardened Mobile Security & Protocol Contract Tests', () {
    test('26-bit limb ChaCha20-Poly1305 roundtrip & tamper detection', () {
      final key = Uint8List.fromList(List<int>.generate(32, (i) => (i * 11 + 3) & 0xFF));
      final nonce = Uint8List.fromList(List<int>.generate(12, (i) => (i * 7 + 5) & 0xFF));
      final aad = Uint8List.fromList(utf8.encode('CST_AEAD_HDR_V2'));
      // Span multiple 64-byte ChaCha20 blocks + tail bytes
      final plaintext = Uint8List.fromList(
        List<int>.generate(195, (i) => (i * 19 + 1) & 0xFF),
      );

      final sealed = ce.ChaCha20Poly1305.encrypt(key, nonce, plaintext, aad: aad);
      expect(sealed.length, equals(plaintext.length + ce.kTagSize));

      final opened = ce.ChaCha20Poly1305.decrypt(key, nonce, sealed, aad: aad);
      expect(opened, isNotNull);
      expect(opened, equals(plaintext));

      // Single-bit ciphertext tamper must fail Poly1305 verification cleanly
      final tampered = Uint8List.fromList(sealed)..[40] ^= 0x80;
      expect(ce.ChaCha20Poly1305.decrypt(key, nonce, tampered, aad: aad), isNull);

      // Single-bit AAD tamper must fail verification
      final badAad = Uint8List.fromList(aad)..[0] ^= 0x01;
      expect(ce.ChaCha20Poly1305.decrypt(key, nonce, sealed, aad: badAad), isNull);
    });

    test('Mutual ECDH Challenge verification rejects spoofed host HMAC and allows genuine host', () {
      const secret = 'ainet_mutual_test_secret_token_xyz';
      final engine = ce.CryptoEngine(preSharedKey: secret);

      final initPayload = engine.buildMutualInitPayload();
      expect(initPayload.length, equals(34));
      expect(
        utf8.decode(initPayload.sublist(0, 18)),
        equals('INIT_ECDH_VAULT_M:'),
      );
      final clientChal = initPayload.sublist(18);

      // Host constructs canonical 59B ECDH challenge + 32B HMAC-SHA256 mutual proof
      final hostPriv = ce.X25519.generatePrivateKey();
      final hostPub = ce.X25519.publicFromPrivate(hostPriv);
      final hostN2 = Uint8List.fromList(List<int>.generate(16, (i) => (i + 30) & 0xFF));
      final magic = utf8.encode('CST_ECDH_1:');
      final chal59 = Uint8List.fromList(<int>[...magic, ...hostPub, ...hostN2]);

      final proofInput = <int>[
        ...utf8.encode('CST_HOST_CHAL_M:'),
        ...clientChal,
        ...chal59,
      ];
      final hostProof = crypto_pkg.Hmac(crypto_pkg.sha256, utf8.encode(secret))
          .convert(proofInput)
          .bytes;
      final chal91 = Uint8List.fromList(<int>[...chal59, ...hostProof]);
      expect(chal91.length, equals(91));

      // Tampering 1 bit in host proof must be rejected before establishing vault
      final forged91 = Uint8List.fromList(chal91)..[90] ^= 0x01;
      expect(engine.processMutualHostChallenge(forged91), isNull);
      expect(engine.isEstablished, isFalse);

      // Genuine 91B mutual challenge must verify and establish directional keys
      final cliReply = engine.processMutualHostChallenge(chal91);
      expect(cliReply, isNotNull);
      expect(cliReply!.length, equals(80)); // 32B cliPub + 16B cliN1 + 32B cliHmac
      expect(engine.isEstablished, isTrue);

      // Canonical encryptWirePacket + decryptPacket round-trip verification
      final wireOut = engine.encryptWirePacket(
        BinaryOpcode.ping,
        Uint8List.fromList(utf8.encode('PING')),
      );
      expect(wireOut[0], equals(kMagicByte0));
      expect(wireOut[1], equals(kMagicByte1));
      expect(wireOut[2], equals(BinaryOpcode.ping));
      expect(wireOut[3] & ProtocolFlags.encrypted, equals(ProtocolFlags.encrypted));

      // Reflected client->host wire frame cannot decrypt on client RX key
      expect(engine.decryptWirePacket(wireOut), isNull);

      engine.dispose();
    });

    test('PacketReassembler and NetworkFramer reject overlapping-chunk inflation attacks', () {
      // Malicious sender claims totalLength=100 but sends two overlapping 60-byte chunks
      // at offset 0 and offset 1 (120 bytes written across only bytes [0..61))
      final reassembler = PacketReassembler();
      final framer = NetworkFramer();

      Uint8List makeFrag(int msgId, int offset, int total, int fillLen) {
        final payload = Uint8List(kFragmentHeaderSize + fillLen);
        final bd = ByteData.sublistView(payload);
        bd.setUint32(0, msgId, Endian.big);
        bd.setUint32(4, offset, Endian.big);
        bd.setUint32(8, total, Endian.big);
        return packPacket(
          BinaryOpcode.frame,
          payload,
          flags: kFlagIsFragmented,
          seq: 1,
        );
      }

      // Chunk 1: [0..60)
      expect(reassembler.ingestBytes(makeFrag(99, 0, 100, 60)), isNull);
      // Overlapping Chunk 2: [1..61) -> unique coverage is still 61 < 100, MUST NOT complete!
      expect(reassembler.ingestBytes(makeFrag(99, 1, 100, 60)), isNull);
      // Completing tail Chunk 3: [60..100) -> full [0..100) covered, completes cleanly!
      final done = reassembler.ingestBytes(makeFrag(99, 60, 100, 40));
      expect(done, isNotNull);
      expect(done!.payload.length, equals(100));

      final List<WirePacket> framedDone = <WirePacket>[];
      final sub = framer.onPacket.listen(framedDone.add);
      framer.pushChunk(makeFrag(101, 0, 100, 60));
      framer.pushChunk(makeFrag(101, 1, 100, 60));
      expect(framedDone, isEmpty);
      framer.pushChunk(makeFrag(101, 60, 100, 40));
      expect(framedDone.length, equals(1));
      expect(framedDone.single.payload.length, equals(100));

      sub.cancel();
      reassembler.dispose();
      framer.dispose();
    });

    test('SecureSecretStore migrates and scrubs plaintext ghost_devices secrets', () async {
      final tmpDir = Directory.systemTemp.createTempSync('ainet_ks_test_');
      try {
        Hive.init(tmpDir.path);
        final legacyBox = await Hive.openBox('ghost_devices_test');
        await legacyBox.put('__global_pairing_secret__', 'ainet_plain_global_tok');
        await legacyBox.put('__secret_192.168.1.50', 'ainet_plain_host_tok');

        final deterministicTestKey = Uint8List.fromList(
          List<int>.generate(32, (i) => (i * 5 + 9) & 0xFF),
        );
        final store = SecureSecretStore(
          keyProvider: () async => deterministicTestKey,
        );
        await store.migrateLegacyPairingKeys(legacyBox);

        expect(
          store.getToken(SecureSecretStore.globalHostKey),
          equals('ainet_plain_global_tok'),
        );
        expect(store.getToken('192.168.1.50'), equals('ainet_plain_host_tok'));

        // Legacy box must be scrubbed with sentinel (no plaintext tokens left)
        expect(
          legacyBox.get('__global_pairing_secret__'),
          equals(SecureSecretStore.legacySentinel),
        );
        expect(
          legacyBox.get('__secret_192.168.1.50'),
          equals(SecureSecretStore.legacySentinel),
        );

        await legacyBox.close();
      } finally {
        await Hive.close();
        if (tmpDir.existsSync()) {
          tmpDir.deleteSync(recursive: true);
        }
      }
    });
  });
}
