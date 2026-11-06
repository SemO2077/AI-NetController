import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:crypto/crypto.dart' as crypto_pkg;
import '../protocol/binary_protocol.dart';

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
const int kKeySize = 32;
const int kNonceSize = 12;
const int kTagSize = 16;

// Flag bit 1: Is Encrypted with ChaCha20-Poly1305
const int kFlagEncrypted = 0x02;

// =====================================================================
// RFC 7748 CURVE25519 / X25519 ARITHMETIC (DART BIGINT)
// =====================================================================
class Curve25519 {
  static final BigInt _p = (BigInt.one << 255) - BigInt.from(19);
  static final BigInt _a24 = BigInt.from(121665);

  static Uint8List clampScalar(Uint8List kBytes) {
    final Uint8List a = Uint8List.fromList(kBytes);
    a[0] &= 248;
    a[31] &= 127;
    a[31] |= 64;
    return a;
  }

  static BigInt _decodeLittleEndian(List<int> bytes) {
    BigInt res = BigInt.zero;
    for (int i = bytes.length - 1; i >= 0; i--) {
      res = (res << 8) | BigInt.from(bytes[i]);
    }
    return res;
  }

  static Uint8List _encodeLittleEndian(BigInt n, int length) {
    final Uint8List out = Uint8List(length);
    BigInt cur = n;
    for (int i = 0; i < length; i++) {
      out[i] = (cur & BigInt.from(0xFF)).toInt();
      cur = cur >> 8;
    }
    return out;
  }

  static BigInt _modInverse(BigInt a, BigInt m) {
    return a.modPow(m - BigInt.two, m);
  }

  static Uint8List scalarMult(Uint8List scalar, Uint8List uCoordinate) {
    final Uint8List clamped = clampScalar(scalar);
    final BigInt k = _decodeLittleEndian(clamped);
    final BigInt u = _decodeLittleEndian(uCoordinate) % _p;

    BigInt x1 = u;
    BigInt x2 = BigInt.one;
    BigInt z2 = BigInt.zero;
    BigInt x3 = u;
    BigInt z3 = BigInt.one;
    int swap = 0;

    for (int t = 254; t >= 0; t--) {
      final int kt = ((k >> t) & BigInt.one).toInt();
      swap ^= kt;
      if (swap == 1) {
        BigInt temp = x2; x2 = x3; x3 = temp;
        temp = z2; z2 = z3; z3 = temp;
      }
      swap = kt;

      final BigInt A = (x2 + z2) % _p;
      final BigInt AA = (A * A) % _p;
      final BigInt B = (x2 - z2) % _p;
      final BigInt BB = (B * B) % _p;
      final BigInt E = (AA - BB) % _p;
      final BigInt C = (x3 + z3) % _p;
      final BigInt D = (x3 - z3) % _p;
      final BigInt DA = (D * A) % _p;
      final BigInt CB = (C * B) % _p;

      x3 = ((DA + CB) * (DA + CB)) % _p;
      z3 = (x1 * ((DA - CB) * (DA - CB))) % _p;
      x2 = (AA * BB) % _p;
      z2 = (E * (AA + _a24 * E)) % _p;
    }

    if (swap == 1) {
      BigInt temp = x2; x2 = x3; x3 = temp;
      temp = z2; z2 = z3; z3 = temp;
    }

    final BigInt result = (x2 * _modInverse(z2, _p)) % _p;
    return _encodeLittleEndian(result, 32);
  }

  static Uint8List generatePrivateKey() {
    final Random rnd = Random.secure();
    final Uint8List priv = Uint8List(32);
    for (int i = 0; i < 32; i++) {
      priv[i] = rnd.nextInt(256);
    }
    return priv;
  }

  static Uint8List getPublicKey(Uint8List privateKey) {
    final Uint8List basePoint = Uint8List(32);
    basePoint[0] = 9;
    return scalarMult(privateKey, basePoint);
  }
}

// =====================================================================
// RFC 5869 HKDF-SHA256 (EXTRACT & EXPAND)
// =====================================================================
class HkdfSha256 {
  static Uint8List extract(Uint8List salt, Uint8List ikm) {
    final Uint8List actualSalt = salt.isEmpty ? Uint8List(32) : salt;
    final hmac = crypto_pkg.Hmac(crypto_pkg.sha256, actualSalt);
    return Uint8List.fromList(hmac.convert(ikm).bytes);
  }

  static Uint8List expand(Uint8List prk, List<int> info, int length) {
    const int hashLen = 32;
    final int n = ((length + hashLen - 1) / hashLen).floor();
    final List<int> okm = [];
    List<int> t = [];

    for (int i = 1; i <= n; i++) {
      final hmac = crypto_pkg.Hmac(crypto_pkg.sha256, prk);
      final List<int> input = [...t, ...info, i];
      t = hmac.convert(input).bytes;
      okm.addAll(t);
    }
    return Uint8List.fromList(okm.sublist(0, length));
  }

  static Uint8List deriveKey(Uint8List sharedSecret, Uint8List salt, String infoStr) {
    final Uint8List prk = extract(salt, sharedSecret);
    return expand(prk, utf8.encode(infoStr), kKeySize);
  }
}

// =====================================================================
// RFC 8439 CHACHA20-POLY1305 IMPLEMENTATION
// =====================================================================
class ChaCha20Poly1305 {
  static int _rotl32(int v, int c) {
    return ((v << c) & 0xFFFFFFFF) | ((v & 0xFFFFFFFF) >> (32 - c));
  }

  static void _quarterRound(List<int> x, int a, int b, int c, int d) {
    x[a] = (x[a] + x[b]) & 0xFFFFFFFF; x[d] = _rotl32(x[d] ^ x[a], 16);
    x[c] = (x[c] + x[d]) & 0xFFFFFFFF; x[b] = _rotl32(x[b] ^ x[c], 12);
    x[a] = (x[a] + x[b]) & 0xFFFFFFFF; x[d] = _rotl32(x[d] ^ x[a], 8);
    x[c] = (x[c] + x[d]) & 0xFFFFFFFF; x[b] = _rotl32(x[b] ^ x[c], 7);
  }

  static Uint8List _chacha20Block(Uint8List key, int counter, Uint8List nonce) {
    final List<int> constants = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
    final ByteData keyBd = ByteData.sublistView(key);
    final ByteData nonceBd = ByteData.sublistView(nonce);

    final List<int> state = [
      constants[0], constants[1], constants[2], constants[3],
      keyBd.getUint32(0, Endian.little),
      keyBd.getUint32(4, Endian.little),
      keyBd.getUint32(8, Endian.little),
      keyBd.getUint32(12, Endian.little),
      keyBd.getUint32(16, Endian.little),
      keyBd.getUint32(20, Endian.little),
      keyBd.getUint32(24, Endian.little),
      keyBd.getUint32(28, Endian.little),
      counter,
      nonceBd.getUint32(0, Endian.little),
      nonceBd.getUint32(4, Endian.little),
      nonceBd.getUint32(8, Endian.little),
    ];

    final List<int> working = List<int>.from(state);
    for (int i = 0; i < 10; i++) {
      _quarterRound(working, 0, 4, 8, 12);
      _quarterRound(working, 1, 5, 9, 13);
      _quarterRound(working, 2, 6, 10, 14);
      _quarterRound(working, 3, 7, 11, 15);
      _quarterRound(working, 0, 5, 10, 15);
      _quarterRound(working, 1, 6, 11, 12);
      _quarterRound(working, 2, 7, 8, 13);
      _quarterRound(working, 3, 4, 9, 14);
    }

    final Uint8List out = Uint8List(64);
    final ByteData outBd = ByteData.sublistView(out);
    for (int i = 0; i < 16; i++) {
      final int val = (working[i] + state[i]) & 0xFFFFFFFF;
      outBd.setUint32(i * 4, val, Endian.little);
    }
    return out;
  }

  static Uint8List _chacha20Crypt(Uint8List key, Uint8List nonce, Uint8List data, int initialCounter) {
    final Uint8List out = Uint8List(data.length);
    int counter = initialCounter;
    for (int i = 0; i < data.length; i += 64) {
      final Uint8List block = _chacha20Block(key, counter, nonce);
      final int chunkLen = min(64, data.length - i);
      for (int j = 0; j < chunkLen; j++) {
        out[i + j] = data[i + j] ^ block[j];
      }
      counter++;
    }
    return out;
  }

  static BigInt _poly1305Clamp(Uint8List rBytes) {
    final Uint8List r = Uint8List.fromList(rBytes);
    r[3] &= 15; r[7] &= 15; r[11] &= 15; r[15] &= 15;
    r[4] &= 252; r[8] &= 252; r[12] &= 252;
    BigInt res = BigInt.zero;
    for (int i = 15; i >= 0; i--) {
      res = (res << 8) | BigInt.from(r[i]);
    }
    return res;
  }

  static Uint8List _poly1305Mac(Uint8List msg, Uint8List key) {
    final BigInt r = _poly1305Clamp(key.sublist(0, 16));
    BigInt s = BigInt.zero;
    for (int i = 31; i >= 16; i--) {
      s = (s << 8) | BigInt.from(key[i]);
    }

    final BigInt p = (BigInt.one << 130) - BigInt.from(5);
    BigInt accumulator = BigInt.zero;

    for (int i = 0; i < msg.length; i += 16) {
      final int chunkLen = min(16, msg.length - i);
      final List<int> chunk = msg.sublist(i, i + chunkLen);
      final List<int> padded = [...chunk, 0x01];
      BigInt n = BigInt.zero;
      for (int j = padded.length - 1; j >= 0; j--) {
        n = (n << 8) | BigInt.from(padded[j]);
      }
      accumulator = ((accumulator + n) * r) % p;
    }

    final BigInt tagInt = (accumulator + s) % (BigInt.one << 128);
    final Uint8List tag = Uint8List(16);
    BigInt cur = tagInt;
    for (int i = 0; i < 16; i++) {
      tag[i] = (cur & BigInt.from(0xFF)).toInt();
      cur = cur >> 8;
    }
    return tag;
  }

  static Uint8List encrypt(Uint8List key, Uint8List nonce, Uint8List plaintext, {Uint8List? aad}) {
    final Uint8List actualAad = aad ?? Uint8List(0);
    final Uint8List otk = _chacha20Block(key, 0, nonce).sublist(0, 32);
    final Uint8List ciphertext = _chacha20Crypt(key, nonce, plaintext, 1);

    final int pad1Len = (16 - (actualAad.length % 16)) % 16;
    final int pad2Len = (16 - (ciphertext.length % 16)) % 16;

    final BytesBuilder macData = BytesBuilder();
    macData.add(actualAad);
    if (pad1Len > 0) macData.add(Uint8List(pad1Len));
    macData.add(ciphertext);
    if (pad2Len > 0) macData.add(Uint8List(pad2Len));

    final ByteData lenBd = ByteData(16);
    lenBd.setUint64(0, actualAad.length, Endian.little);
    lenBd.setUint64(8, ciphertext.length, Endian.little);
    macData.add(lenBd.buffer.asUint8List());

    final Uint8List tag = _poly1305Mac(macData.toBytes(), otk);

    final BytesBuilder result = BytesBuilder();
    result.add(ciphertext);
    result.add(tag);
    return result.toBytes();
  }

  static Uint8List decrypt(Uint8List key, Uint8List nonce, Uint8List ciphertextAndTag, {Uint8List? aad}) {
    if (ciphertextAndTag.length < kTagSize) {
      throw const FormatException("Ciphertext too short for Poly1305 MAC tag");
    }
    final Uint8List actualAad = aad ?? Uint8List(0);
    final Uint8List ciphertext = ciphertextAndTag.sublist(0, ciphertextAndTag.length - kTagSize);
    final Uint8List receivedTag = ciphertextAndTag.sublist(ciphertextAndTag.length - kTagSize);

    final Uint8List otk = _chacha20Block(key, 0, nonce).sublist(0, 32);
    final int pad1Len = (16 - (actualAad.length % 16)) % 16;
    final int pad2Len = (16 - (ciphertext.length % 16)) % 16;

    final BytesBuilder macData = BytesBuilder();
    macData.add(actualAad);
    if (pad1Len > 0) macData.add(Uint8List(pad1Len));
    macData.add(ciphertext);
    if (pad2Len > 0) macData.add(Uint8List(pad2Len));

    final ByteData lenBd = ByteData(16);
    lenBd.setUint64(0, actualAad.length, Endian.little);
    lenBd.setUint64(8, ciphertext.length, Endian.little);
    macData.add(lenBd.buffer.asUint8List());

    final Uint8List expectedTag = _poly1305Mac(macData.toBytes(), otk);

    // Constant-time tag check
    int diff = 0;
    for (int i = 0; i < 16; i++) {
      diff |= receivedTag[i] ^ expectedTag[i];
    }
    if (diff != 0) {
      throw const FormatException("Poly1305 MAC tag mismatch! Ciphertext was tampered or corrupted.");
    }

    return _chacha20Crypt(key, nonce, ciphertext, 1);
  }
}

// =====================================================================
// HIGH-LEVEL CRYPTO CHANNEL (CLIENT CONTROLLER)
// =====================================================================
class CryptoChannel {
  final String preSharedKey;
  Uint8List? _sessionKey;
  bool _isEstablished = false;

  int _txNonceCounter = 0;
  int _rxLastNonceCounter = -1;

  late final Uint8List _clientPrivateKey;
  late final Uint8List _clientPublicKey;

  bool get isEstablished => _isEstablished;

  CryptoChannel({required this.preSharedKey}) {
    _clientPrivateKey = Curve25519.generatePrivateKey();
    _clientPublicKey = Curve25519.getPublicKey(_clientPrivateKey);
  }

  /// Evaluates Opcode 0x06 Host Challenge and produces the Client Response.
  Uint8List processHandshakeChallenge(Uint8List challengePayload) {
    // Challenge structure: [11-byte Magic] + [32-byte Host PubKey] + [16-byte Salt] + [8-byte Timestamp]
    if (challengePayload.length < 11 + 32 + 16 + 8) {
      throw const FormatException("Malformed ECDH challenge payload");
    }

    final Uint8List hostPubKey = challengePayload.sublist(11, 11 + 32);
    final Uint8List salt = challengePayload.sublist(11 + 32, 11 + 32 + 16);

    // Compute shared secret via Curve25519
    final Uint8List sharedSecret = Curve25519.scalarMult(_clientPrivateKey, hostPubKey);

    // Derive symmetric session key via HKDF-SHA256
    _sessionKey = HkdfSha256.deriveKey(sharedSecret, salt, kInfoString);
    _isEstablished = true;

    // Create client proof HMAC over [Magic + HostPub + ClientPub + Salt]
    final hmac = crypto_pkg.Hmac(crypto_pkg.sha256, utf8.encode(preSharedKey));
    final List<int> hmacInput = [
      ...kHandshakeMagic,
      ...hostPubKey,
      ..._clientPublicKey,
      ...salt
    ];
    final List<int> clientAuthTag = hmac.convert(hmacInput).bytes;

    // Build Response: [32 bytes Client PubKey] + [32 bytes HMAC Auth Tag]
    final BytesBuilder response = BytesBuilder();
    response.add(_clientPublicKey);
    response.add(clientAuthTag);
    return response.toBytes();
  }

  Uint8List _generateTxNonce() {
    _txNonceCounter++;
    final ByteData bd = ByteData(12);
    bd.setUint64(0, _txNonceCounter, Endian.big);
    bd.setUint32(8, 0x4D4F424C, Endian.big); // 'MOBL'
    return bd.buffer.asUint8List();
  }

  /// Encrypts an outgoing protocol packet with ChaCha20-Poly1305.
  /// Frame structure: [12-byte Standard Header (AAD)] + [12-byte Nonce] + [Ciphertext + 16-byte Tag]
  Uint8List encryptPacket(int opcode, Uint8List plaintext, {int flags = 0, int seq = 0}) {
    if (!_isEstablished || _sessionKey == null) {
      throw StateError("CryptoChannel is not established. Handshake required.");
    }

    final Uint8List nonce = _generateTxNonce();

    // Prepare 12-byte unencrypted base header (used as AAD)
    final int payloadLength = nonce.length + plaintext.length + kTagSize;
    final Uint8List headerBytes = Uint8List(kHeaderSize);
    final ByteData headerBd = ByteData.sublistView(headerBytes);
    headerBd.setUint8(0, kMagicByte0);
    headerBd.setUint8(1, kMagicByte1);
    headerBd.setUint8(2, opcode);
    headerBd.setUint8(3, flags | kFlagEncrypted);
    headerBd.setUint32(4, seq, Endian.big);
    headerBd.setUint32(8, payloadLength, Endian.big);

    final Uint8List ciphertextAndTag = ChaCha20Poly1305.encrypt(
      _sessionKey!,
      nonce,
      plaintext,
      aad: headerBytes,
    );

    final BytesBuilder framedPacket = BytesBuilder();
    framedPacket.add(headerBytes);
    framedPacket.add(nonce);
    framedPacket.add(ciphertextAndTag);
    return framedPacket.toBytes();
  }

  /// Decrypts an incoming framed packet and validates the Poly1305 tag & anti-replay counter.
  ProtocolPacket decryptPacket(Uint8List rawBytes) {
    if (rawBytes.length < kHeaderSize + kNonceSize + kTagSize) {
      throw const FormatException("Encrypted packet is too short");
    }

    final Uint8List headerBytes = rawBytes.sublist(0, kHeaderSize);
    final ByteData headerBd = ByteData.sublistView(headerBytes);

    final int opcode = headerBd.getUint8(2);
    final int flags = headerBd.getUint8(3);
    final int seq = headerBd.getUint32(4, Endian.big);
    final int totalLength = headerBd.getUint32(8, Endian.big);

    if (rawBytes.length < kHeaderSize + totalLength) {
      throw const FormatException("Incomplete encrypted frame");
    }

    final Uint8List nonce = rawBytes.sublist(kHeaderSize, kHeaderSize + kNonceSize);
    final Uint8List ciphertextAndTag = rawBytes.sublist(
      kHeaderSize + kNonceSize,
      kHeaderSize + totalLength,
    );

    // Monotonic Anti-Replay Nonce Verification
    final ByteData nonceBd = ByteData.sublistView(nonce);
    final int rxCounter = nonceBd.getUint64(0, Endian.big);
    if (rxCounter <= _rxLastNonceCounter) {
      throw FormatException(
        "Replay attack detected! Counter $rxCounter <= $_rxLastNonceCounter",
      );
    }
    _rxLastNonceCounter = rxCounter;

    final Uint8List plaintext = ChaCha20Poly1305.decrypt(
      _sessionKey!,
      nonce,
      ciphertextAndTag,
      aad: headerBytes,
    );

    return ProtocolPacket(
      opcode: opcode,
      flags: flags & ~kFlagEncrypted,
      seq: seq,
      payload: plaintext,
    );
  }
}
