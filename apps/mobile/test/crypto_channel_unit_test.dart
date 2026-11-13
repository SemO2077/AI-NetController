import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:ai_netcontroller/ai_netcontroller.dart';


void main() {
  group('CST Mobile Cryptographic Channel & AEAD Unit Tests', () {
    test('Curve25519 Ephemeral Key Agreement Parity (Diffie-Hellman)', () {
      final alicePriv = Curve25519.generatePrivateKey();
      final alicePub = Curve25519.getPublicKey(alicePriv);

      final bobPriv = Curve25519.generatePrivateKey();
      final bobPub = Curve25519.getPublicKey(bobPriv);

      final aliceSecret = Curve25519.scalarMult(alicePriv, bobPub);
      final bobSecret = Curve25519.scalarMult(bobPriv, alicePub);

      expect(aliceSecret.length, equals(32));
      expect(bobSecret.length, equals(32));
      expect(aliceSecret, equals(bobSecret));
    });

    test('ChaCha20-Poly1305 Roundtrip Encryption and Decryption', () {
      final key = Uint8List.fromList(List.generate(32, (i) => i * 7 % 256));
      final nonce = Uint8List.fromList(List.generate(12, (i) => (i * 13 + 1) % 256));
      final plaintext = Uint8List.fromList(utf8.encode('Top Secret Command Payload'));
      final aad = Uint8List.fromList(utf8.encode('Associated Authenticated Header Data'));

      final ciphertextAndTag = ChaCha20Poly1305.encrypt(key, nonce, plaintext, aad: aad);
      expect(ciphertextAndTag.length, equals(plaintext.length + 16));

      final decrypted = ChaCha20Poly1305.decrypt(key, nonce, ciphertextAndTag, aad: aad);
      expect(decrypted, equals(plaintext));
    });

    test('ChaCha20-Poly1305 Rejects Tampered Ciphertext or AAD', () {
      final key = Uint8List.fromList(List.generate(32, (i) => i + 10));
      final nonce = Uint8List.fromList(List.generate(12, (i) => i + 20));
      final plaintext = Uint8List.fromList(utf8.encode('Integrity Protected'));
      final aad = Uint8List.fromList(utf8.encode('AAD'));

      final ciphertextAndTag = ChaCha20Poly1305.encrypt(key, nonce, plaintext, aad: aad);

      // Tamper 1 bit in ciphertext
      final tamperedCiphertext = Uint8List.fromList(ciphertextAndTag);
      tamperedCiphertext[0] ^= 0x01;

      expect(
        () => ChaCha20Poly1305.decrypt(key, nonce, tamperedCiphertext, aad: aad),
        throwsA(isA<FormatException>()),
      );

      // Tamper 1 bit in AAD
      final tamperedAad = Uint8List.fromList(utf8.encode('BAD'));
      expect(
        () => ChaCha20Poly1305.decrypt(key, nonce, ciphertextAndTag, aad: tamperedAad),
        throwsA(isA<FormatException>()),
      );
    });

    test('ProcessHandshakeChallenge and Replay Prevention', () {
      final channel = CryptoChannel(preSharedKey: 'cst_test_secret_key');
      expect(channel.isEstablished, isFalse);

      // Construct a mock Host Challenge with fresh big-endian Unix timestamp
      final hostPriv = Curve25519.generatePrivateKey();
      final hostPub = Curve25519.getPublicKey(hostPriv);
      final salt = Uint8List.fromList(List.generate(16, (i) => i + 5));
      final tsSec = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      final timestamp = Uint8List(8);
      ByteData.sublistView(timestamp).setUint64(0, tsSec, Endian.big);

      final challenge = Uint8List.fromList([
        ...kHandshakeMagic,
        ...hostPub,
        ...salt,
        ...timestamp,
      ]);

      final clientReply = channel.processHandshakeChallenge(challenge);
      expect(channel.isEstablished, isTrue);
      expect(clientReply.length, equals(64)); // 32B PubKey + 32B HMAC Tag

      // Client TX packet cannot be reflected back into client RX
      final outgoing = channel.encryptPacket(
        BinaryOpcode.shell,
        Uint8List.fromList(utf8.encode('whoami')),
        seq: 1,
      );
      expect(outgoing.length, greaterThan(kHeaderSize + kNonceSize + kTagSize));
      expect(
        () => channel.decryptPacket(outgoing),
        throwsA(isA<FormatException>()),
      );

      // Simulate Host TX using host-derived directional keys
      final clientPub = clientReply.sublist(0, 32);
      final hostShared = Curve25519.scalarMult(hostPriv, clientPub);
      final hostTxKey = HkdfSha256.deriveKey(hostShared, salt, "$kInfoString-host-tx");
      final hostRxKey = HkdfSha256.deriveKey(hostShared, salt, "$kInfoString-client-tx");

      // Host decrypts Client TX packet
      final clientHdr = outgoing.sublist(0, kHeaderSize);
      final clientNonce = outgoing.sublist(kHeaderSize, kHeaderSize + kNonceSize);
      final clientCt = outgoing.sublist(kHeaderSize + kNonceSize);
      final hostDec = ChaCha20Poly1305.decrypt(hostRxKey, clientNonce, clientCt, aad: clientHdr);
      expect(utf8.decode(hostDec), equals('whoami'));

      // Host sends directional frame ('HOST' tag 0x484F5354) to client
      final hostPlain = Uint8List.fromList(utf8.encode('telemetry_ok'));
      final hostNonce = Uint8List(kNonceSize);
      final hostNonceBd = ByteData.sublistView(hostNonce);
      hostNonceBd.setUint64(0, 1, Endian.big);
      hostNonceBd.setUint32(8, 0x484F5354, Endian.big);
      final hostWireLen = kNonceSize + hostPlain.length + kTagSize;
      final hostHdr = Uint8List(kHeaderSize);
      final hostHdrBd = ByteData.sublistView(hostHdr);
      hostHdrBd.setUint8(0, kMagicByte0);
      hostHdrBd.setUint8(1, kMagicByte1);
      hostHdrBd.setUint8(2, BinaryOpcode.telemetry);
      hostHdrBd.setUint8(3, kFlagEncrypted);
      hostHdrBd.setUint32(4, 1, Endian.big);
      hostHdrBd.setUint32(8, hostWireLen, Endian.big);
      final hostCt = ChaCha20Poly1305.encrypt(hostTxKey, hostNonce, hostPlain, aad: hostHdr);
      final hostPacket = Uint8List.fromList([...hostHdr, ...hostNonce, ...hostCt]);

      final decryptedPacket = channel.decryptPacket(hostPacket);
      expect(decryptedPacket.opcode, equals(BinaryOpcode.telemetry));
      expect(utf8.decode(decryptedPacket.payload), equals('telemetry_ok'));

      // Replaying the exact same Host packet must throw replay attack FormatException
      expect(
        () => channel.decryptPacket(hostPacket),
        throwsA(isA<FormatException>()),
      );
      channel.dispose();
    });
  });
}
