import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart' as crypto_pkg;
import '../protocol/binary_protocol.dart';
import 'crypto_engine.dart' as ce;

/// Zero-Trust Cryptographic Channel (Mobile Client)
/// Implements:
/// - RFC 7748 Curve25519 (X25519) Ephemeral Key Agreement
/// - RFC 5869 HKDF-SHA256 Key Derivation
/// - RFC 8439 ChaCha20-Poly1305 Authenticated Encryption with Associated Data (AEAD)
/// - Monotonic Nonce Sequencing & Anti-Replay Guard

const List<int> kHandshakeMagic = [
  0x43, 0x53, 0x54, 0x5F, 0x45, 0x43, 0x44, 0x48, 0x5F, 0x56, 0x31 // 'CST_ECDH_V1'
];
const String kInfoString = "cst-autonomous-lan-session-key-v1";
const int kKeySize = ce.kKeySize;
const int kNonceSize = ce.kNonceSize;
const int kTagSize = ce.kTagSize;

// Flag bit 1: Is Encrypted with ChaCha20-Poly1305
const int kFlagEncrypted = ProtocolFlags.encrypted;

// =====================================================================
// RFC 7748 CURVE25519 / X25519 ARITHMETIC (DELEGATES TO ZEROIZED ENGINE)
// =====================================================================
class Curve25519 {
  static Uint8List clampScalar(Uint8List kBytes) =>
      ce.X25519.clampScalar(kBytes);

  static Uint8List scalarMult(Uint8List scalar, Uint8List uCoordinate) =>
      ce.X25519.scalarMult(scalar, uCoordinate);

  static Uint8List generatePrivateKey() => ce.X25519.generatePrivateKey();

  static Uint8List getPublicKey(Uint8List privateKey) =>
      ce.X25519.publicFromPrivate(privateKey);
}

// =====================================================================
// RFC 5869 HKDF-SHA256 (DELEGATES TO ZEROIZED ENGINE)
// =====================================================================
class HkdfSha256 {
  static Uint8List extract(Uint8List salt, Uint8List ikm) =>
      ce.hkdfExtract(salt, ikm);

  static Uint8List expand(Uint8List prk, List<int> info, int length) =>
      ce.hkdfExpand(prk, info, length);

  static Uint8List deriveKey(
      Uint8List sharedSecret, Uint8List salt, String infoStr) {
    return ce.hkdfExpandAndExtract(
      salt,
      sharedSecret,
      Uint8List.fromList(utf8.encode(infoStr)),
      kKeySize,
    );
  }
}

// =====================================================================
// RFC 8439 CHACHA20-POLY1305 (DELEGATES TO ZERO-ALLOC 26-BIT LIMB ENGINE)
// =====================================================================
class ChaCha20Poly1305 {
  static Uint8List encrypt(
    Uint8List key,
    Uint8List nonce,
    Uint8List plaintext, {
    Uint8List? aad,
  }) {
    if (key.length != kKeySize) {
      throw ArgumentError("ChaCha20-Poly1305 key must be 32 bytes");
    }
    if (nonce.length != kNonceSize) {
      throw ArgumentError("ChaCha20-Poly1305 nonce must be 12 bytes");
    }
    return ce.ChaCha20Poly1305.encrypt(key, nonce, plaintext, aad: aad);
  }

  static Uint8List decrypt(
    Uint8List key,
    Uint8List nonce,
    Uint8List ciphertextAndTag, {
    Uint8List? aad,
  }) {
    if (key.length != kKeySize) {
      throw ArgumentError("ChaCha20-Poly1305 key must be 32 bytes");
    }
    if (nonce.length != kNonceSize) {
      throw ArgumentError("ChaCha20-Poly1305 nonce must be 12 bytes");
    }
    if (ciphertextAndTag.length < kTagSize) {
      throw const FormatException(
        "Ciphertext too short to contain 16-byte Poly1305 tag",
      );
    }

    final Uint8List? plaintext = ce.ChaCha20Poly1305.decrypt(
      key,
      nonce,
      ciphertextAndTag,
      aad: aad,
    );
    if (plaintext == null) {
      throw const FormatException(
        "Poly1305 MAC tag mismatch! Ciphertext was tampered or corrupted.",
      );
    }
    return plaintext;
  }
}

// =====================================================================
// HIGH-LEVEL CRYPTO CHANNEL (CLIENT CONTROLLER)
// =====================================================================
class CryptoChannel {
  static const int _hostSenderTag = 0x484F5354; // 'HOST'
  static const int _mobileSenderTag = 0x4D4F424C; // 'MOBL'
  static const int _maxHandshakeAgeSec = 120;

  final String preSharedKey;
  Uint8List? _txKey;
  Uint8List? _rxKey;
  bool _isEstablished = false;
  bool _isClosed = false;

  int _txNonceCounter = 0;
  int _rxLastNonceCounter = 0;

  late final Uint8List _clientPrivateKey;
  late final Uint8List _clientPublicKey;

  bool get isEstablished => _isEstablished && !_isClosed;

  CryptoChannel({required this.preSharedKey}) {
    if (preSharedKey.trim().isEmpty) {
      throw ArgumentError("preSharedKey cannot be empty");
    }
    _clientPrivateKey = Curve25519.generatePrivateKey();
    _clientPublicKey = Curve25519.getPublicKey(_clientPrivateKey);
  }

  /// Evaluates Opcode 0x06 Host Challenge and produces the Client Response.
  Uint8List processHandshakeChallenge(Uint8List challengePayload) {
    if (_isClosed || _isEstablished) {
      throw StateError(
          "CryptoChannel handshake already completed or channel closed");
    }
    // Challenge structure: [11-byte Magic] + [32-byte Host PubKey] + [16-byte Salt] + [8-byte Timestamp]
    if (challengePayload.length != 11 + 32 + 16 + 8) {
      throw const FormatException("Malformed ECDH challenge payload");
    }

    for (int i = 0; i < kHandshakeMagic.length; i++) {
      if (challengePayload[i] != kHandshakeMagic[i]) {
        throw const FormatException("Invalid ECDH handshake magic");
      }
    }

    final Uint8List hostPubKey = Uint8List.sublistView(challengePayload, 11, 43);
    final Uint8List salt = Uint8List.sublistView(challengePayload, 43, 59);
    final Uint8List tsBytes = Uint8List.sublistView(challengePayload, 59, 67);
    final int challengeTs =
        ByteData.sublistView(tsBytes).getUint64(0, Endian.big);
    final int nowSec = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    if (challengeTs <= 0 || (nowSec - challengeTs).abs() > _maxHandshakeAgeSec) {
      throw const FormatException("Expired or invalid ECDH challenge timestamp");
    }

    // Compute shared secret via Curve25519 and reject all-zero small-subgroup outputs
    final Uint8List sharedSecret =
        Curve25519.scalarMult(_clientPrivateKey, hostPubKey);
    int nonZero = 0;
    for (int i = 0; i < sharedSecret.length; i++) {
      nonZero |= sharedSecret[i];
    }
    if (nonZero == 0) {
      ce.zeroize(sharedSecret);
      throw const FormatException("Invalid low-order ECDH peer public key");
    }

    // Derive twin directional session keys matching HostCryptoSession (crypto_handshake.py)
    _txKey =
        HkdfSha256.deriveKey(sharedSecret, salt, "$kInfoString-client-tx");
    _rxKey = HkdfSha256.deriveKey(sharedSecret, salt, "$kInfoString-host-tx");
    ce.zeroize(sharedSecret);
    ce.zeroize(_clientPrivateKey);
    _isEstablished = true;

    // Create client proof HMAC over [Magic + HostPub + ClientPub + Salt + Timestamp]
    final hmac = crypto_pkg.Hmac(crypto_pkg.sha256, utf8.encode(preSharedKey));
    final List<int> hmacInput = [
      ...kHandshakeMagic,
      ...hostPubKey,
      ..._clientPublicKey,
      ...salt,
      ...tsBytes,
    ];
    final List<int> clientAuthTag = hmac.convert(hmacInput).bytes;

    // Build Response: [32 bytes Client PubKey] + [32 bytes HMAC Auth Tag]
    final Uint8List response = Uint8List(32 + clientAuthTag.length);
    response.setRange(0, 32, _clientPublicKey);
    response.setRange(32, response.length, clientAuthTag);
    return response;
  }

  /// Encrypts an outgoing protocol packet with ChaCha20-Poly1305 in one allocation.
  /// Frame structure: [12-byte Standard Header (AAD)] + [12-byte Nonce] + [Ciphertext + 16-byte Tag]
  Uint8List encryptPacket(int opcode, Uint8List plaintext,
      {int flags = 0, int seq = 0}) {
    if (_isClosed || !_isEstablished || _txKey == null) {
      throw StateError("CryptoChannel is not established. Handshake required.");
    }

    _txNonceCounter++;
    final int payloadLength = kNonceSize + plaintext.length + kTagSize;
    final Uint8List framedPacket = Uint8List(kHeaderSize + payloadLength);

    writeHeader(
      framedPacket,
      opcode: opcode,
      payloadLength: payloadLength,
      flags: flags | kFlagEncrypted,
      seq: seq,
    );

    final ByteData nonceBd = ByteData.sublistView(
      framedPacket,
      kHeaderSize,
      kHeaderSize + kNonceSize,
    );
    nonceBd.setUint64(0, _txNonceCounter, Endian.big);
    nonceBd.setUint32(8, _mobileSenderTag, Endian.big); // 'MOBL'

    final Uint8List headerAad =
        Uint8List.sublistView(framedPacket, 0, kHeaderSize);
    final Uint8List nonce = Uint8List.sublistView(
      framedPacket,
      kHeaderSize,
      kHeaderSize + kNonceSize,
    );

    ce.ChaCha20Poly1305.encryptInto(
      _txKey!,
      nonce,
      plaintext,
      framedPacket,
      kHeaderSize + kNonceSize,
      aad: headerAad,
    );
    return framedPacket;
  }

  /// Decrypts an incoming framed packet and validates sender tag, Poly1305 MAC & anti-replay counter.
  ProtocolPacket decryptPacket(Uint8List rawBytes) {
    if (_isClosed || !_isEstablished || _rxKey == null) {
      throw StateError("CryptoChannel is not established. Handshake required.");
    }
    if (rawBytes.length < kHeaderSize + kNonceSize + kTagSize) {
      throw const FormatException("Encrypted packet is too short");
    }

    final Uint8List headerBytes = Uint8List.sublistView(rawBytes, 0, kHeaderSize);
    final ProtocolHeader? header = parseHeader(headerBytes);
    if (header == null) {
      throw const FormatException("Invalid magic bytes or malformed encrypted frame");
    }

    if (header.payloadLength < kNonceSize + kTagSize ||
        rawBytes.length != kHeaderSize + header.payloadLength) {
      throw const FormatException("Malformed encrypted frame length");
    }

    final Uint8List nonce =
        Uint8List.sublistView(rawBytes, kHeaderSize, kHeaderSize + kNonceSize);
    final Uint8List ciphertextAndTag = Uint8List.sublistView(
      rawBytes,
      kHeaderSize + kNonceSize,
      kHeaderSize + header.payloadLength,
    );

    // Check sender tag and monotonic counter WITHOUT mutating state before AEAD verification
    final ByteData nonceBd = ByteData.sublistView(nonce);
    final int rxCounter = nonceBd.getUint64(0, Endian.big);
    final int senderTag = nonceBd.getUint32(8, Endian.big);
    if (senderTag != _hostSenderTag) {
      throw const FormatException(
        "Invalid sender identifier in nonce (possible packet reflection attack)",
      );
    }
    if (rxCounter <= 0 || rxCounter <= _rxLastNonceCounter) {
      throw FormatException(
        "Replay attack detected! Counter $rxCounter <= $_rxLastNonceCounter",
      );
    }

    final Uint8List plaintext = ChaCha20Poly1305.decrypt(
      _rxKey!,
      nonce,
      ciphertextAndTag,
      aad: headerBytes,
    );

    // Commit anti-replay watermark ONLY after Poly1305 MAC authentication succeeds
    _rxLastNonceCounter = rxCounter;

    return ProtocolPacket(
      opcode: header.opcode,
      flags: header.flags & ~kFlagEncrypted,
      seq: header.seq,
      payload: plaintext,
    );
  }

  void dispose() {
    _isClosed = true;
    _isEstablished = false;
    if (_txKey != null) ce.zeroize(_txKey!);
    if (_rxKey != null) ce.zeroize(_rxKey!);
    _txKey = null;
    _rxKey = null;
    ce.zeroize(_clientPrivateKey);
  }
}
