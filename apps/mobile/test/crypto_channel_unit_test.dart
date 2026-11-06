import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:cst_netcontroller/cst_netcontroller.dart';


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

      // Construct a mock Host Challenge
      final hostPriv = Curve25519.generatePrivateKey();
      final hostPub = Curve25519.getPublicKey(hostPriv);
      final salt = Uint8List.fromList(List.generate(16, (i) => i + 5));
      final timestamp = Uint8List(8);

      final challenge = Uint8List.fromList([
        ...kHandshakeMagic,
        ...hostPub,
        ...salt,
        ...timestamp,
      ]);

      final clientReply = channel.processHandshakeChallenge(challenge);
      expect(channel.isEstablished, isTrue);
      expect(clientReply.length, equals(64)); // 32B PubKey + 32B HMAC Tag

      // Encrypt outgoing packet
      final outgoing = channel.encryptPacket(
        BinaryOpcode.shell,
        Uint8List.fromList(utf8.encode('whoami')),
        seq: 1,
      );

      expect(outgoing.length, greaterThan(kHeaderSize + kNonceSize + kTagSize));

      // Decrypting on the channel
      final decryptedPacket = channel.decryptPacket(outgoing);
      expect(decryptedPacket.opcode, equals(BinaryOpcode.shell));
      expect(utf8.decode(decryptedPacket.payload), equals('whoami'));

      // Replaying the exact same packet must throw replay attack FormatException
      expect(
        () => channel.decryptPacket(outgoing),
        throwsA(isA<FormatException>()),
      );
    });
  });
}
