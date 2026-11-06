import 'dart:math';
import 'dart:typed_data';
import 'package:crypto/crypto.dart' as crypto_pkg;

// Add for compute()

/// Zero-Trust Hardened Cryptographic Engine (Mobile / Flutter Client)
/// ============================================================================
/// RFC 7748 (Curve25519 / X25519 Ephemeral ECDH Key Exchange)
/// RFC 5869 (HKDF-SHA256 Key Derivation for Twin Directional Session Keys)
/// RFC 8439 (ChaCha20-Poly1305 AEAD Authenticated Encryption with Associated Data)
/// RFC 6479 (128-bit Sliding Window Anti-Replay Engine)
/// Constant-Time Byte Verification & Secure Memory Zeroization
/// ============================================================================

const String kProtocolMagic = "CST_ECDH_V2";
const List<int> kMagicBytes = [0x43, 0x53, 0x54, 0x5F, 0x45, 0x43, 0x44, 0x48, 0x5F, 0x56, 0x32];
const String kCtxClientTx = "cst-client-tx";
const String kCtxHostTx = "cst-host-tx";
const int kKeySize = 32;
const int kNonceSize = 12;
const int kTagSize = 16;
const int kSaltSize = 16;
const int kWindowSize = 128;

/// Secure in-place buffer zeroization helper
void zeroize(Uint8List buffer) {
  for (int i = 0; i < buffer.length; i++) {
    buffer[i] = 0;
  }
}

/// Constant-Time Byte Array Equality Checker (Mitigates timing side-channels)
bool constantTimeEquals(Uint8List a, Uint8List b) {
  if (a.length != b.length) return false;
  int result = 0;
  for (int i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result == 0;
}

/// RFC 6479 Sliding-Window Anti-Replay Engine (128-bit capacity)
class SlidingWindowReplayGuard {
  final int windowSize;
  int _maxSeq = 0;
  BigInt _bitmap = BigInt.zero;
  bool _initialized = false;

  SlidingWindowReplayGuard({this.windowSize = kWindowSize});

  bool validateAndUpdate(int seq) {
    if (!_initialized) {
      _maxSeq = seq;
      _bitmap = BigInt.one;
      _initialized = true;
      return true;
    }

    final int diff = seq - _maxSeq;
    if (diff > 0) {
      if (diff < windowSize) {
        _bitmap = (_bitmap << diff) | BigInt.one;
      } else {
        _bitmap = BigInt.one;
      }
      _maxSeq = seq;
      final BigInt mask = (BigInt.one << windowSize) - BigInt.one;
      _bitmap = _bitmap & mask;
      return true;
    } else {
      final int absDiff = -diff;
      if (absDiff >= windowSize) {
        return false; // Packet fallen outside sliding window
      }
      final BigInt bitMask = BigInt.one << absDiff;
      if ((_bitmap & bitMask) != BigInt.zero) {
        return false; // Duplicate packet detected
      }
      _bitmap = _bitmap | bitMask;
      return true;
    }
  }
}

/// Pure Dart RFC 7748 Curve25519 Engine
class X25519 {
  static final BigInt _p = (BigInt.one << 255) - BigInt.from(19);
  static final BigInt _a24 = BigInt.from(121665);

  static Uint8List clampScalar(Uint8List k) {
    final Uint8List res = Uint8List.fromList(k);
    res[0] &= 248;
    res[31] &= 127;
    res[31] |= 64;
    return res;
  }

  static Uint8List generatePrivateKey() {
    final Random rnd = Random.secure();
    final Uint8List priv = Uint8List(32);
    for (int i = 0; i < 32; i++) {
      priv[i] = rnd.nextInt(256);
    }
    return priv;
  }

  static BigInt _bytesToBigInt(Uint8List bytes) {
    BigInt result = BigInt.zero;
    for (int i = bytes.length - 1; i >= 0; i--) {
      result = (result << 8) | BigInt.from(bytes[i]);
    }
    return result;
  }

  static Uint8List _bigIntToBytes(BigInt value, int length) {
    final Uint8List result = Uint8List(length);
    BigInt temp = value;
    for (int i = 0; i < length; i++) {
      result[i] = (temp & BigInt.from(0xFF)).toInt();
      temp = temp >> 8;
    }
    return result;
  }

  static BigInt _modInverse(BigInt a, BigInt m) {
    return a.modPow(m - BigInt.two, m);
  }

  static Uint8List scalarMult(Uint8List kBytes, Uint8List uBytes) {
    final Uint8List clamped = clampScalar(kBytes);
    final BigInt k = _bytesToBigInt(clamped);
    final BigInt u = _bytesToBigInt(uBytes);

    BigInt x1 = u;
    BigInt x2 = BigInt.one;
    BigInt z2 = BigInt.zero;
    BigInt x3 = u;
    BigInt z3 = BigInt.one;
    int swap = 0;

    for (int t = 254; t >= 0; t--) {
      final int kt = (k >> t & BigInt.one).toInt();
      swap ^= kt;
      if (swap != 0) {
        final BigInt tx = x2; x2 = x3; x3 = tx;
        final BigInt tz = z2; z2 = z3; z3 = tz;
      }
      swap = kt;

      final BigInt a = (x2 + z2) % _p;
      final BigInt aa = (a * a) % _p;
      final BigInt b = (x2 - z2) % _p;
      final BigInt bb = (b * b) % _p;
      final BigInt e = (aa - bb) % _p;
      final BigInt c = (x3 + z3) % _p;
      final BigInt d = (x3 - z3) % _p;
      final BigInt da = (d * a) % _p;
      final BigInt cb = (c * b) % _p;
      x3 = ((da + cb) * (da + cb)) % _p;
      z3 = (x1 * ((da - cb) * (da - cb))) % _p;
      x2 = (aa * bb) % _p;
      z2 = (e * (aa + _a24 * e)) % _p;
    }

    if (swap != 0) {
      final BigInt tx = x2; x2 = x3; x3 = tx;
      final BigInt tz = z2; z2 = z3; z3 = tz;
    }

    final BigInt result = (x2 * _modInverse(z2, _p)) % _p;
    zeroize(clamped);
    return _bigIntToBytes(result, 32);
  }

  static Uint8List publicFromPrivate(Uint8List privateKey) {
    final Uint8List basePoint = Uint8List(32);
    basePoint[0] = 9;
    return scalarMult(privateKey, basePoint);
  }
}

/// RFC 8439 ChaCha20-Poly1305 Implementation
class ChaCha20Poly1305 {
  static int _rotl32(int v, int c) => ((v << c) & 0xFFFFFFFF) | (v >> (32 - c));

  static void _quarterRound(List<int> x, int a, int b, int c, int d) {
    x[a] = (x[a] + x[b]) & 0xFFFFFFFF; x[d] = _rotl32(x[d] ^ x[a], 16);
    x[c] = (x[c] + x[d]) & 0xFFFFFFFF; x[b] = _rotl32(x[b] ^ x[c], 12);
    x[a] = (x[a] + x[b]) & 0xFFFFFFFF; x[d] = _rotl32(x[d] ^ x[a], 8);
    x[c] = (x[c] + x[d]) & 0xFFFFFFFF; x[b] = _rotl32(x[b] ^ x[c], 7);
  }

  static Uint8List _chachaBlock(Uint8List key, int counter, Uint8List nonce) {
    final ByteData keyBd = ByteData.sublistView(key);
    final ByteData nonceBd = ByteData.sublistView(nonce);

    final List<int> state = [
      0x61707865, 0x3320646e, 0x79622d32, 0x6b206574,
      keyBd.getUint32(0, Endian.little), keyBd.getUint32(4, Endian.little),
      keyBd.getUint32(8, Endian.little), keyBd.getUint32(12, Endian.little),
      keyBd.getUint32(16, Endian.little), keyBd.getUint32(20, Endian.little),
      keyBd.getUint32(24, Endian.little), keyBd.getUint32(28, Endian.little),
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
      outBd.setUint32(i * 4, (working[i] + state[i]) & 0xFFFFFFFF, Endian.little);
    }
    return out;
  }

  static Uint8List _poly1305(Uint8List msg, Uint8List key) {
    final Uint8List rBytes = key.sublist(0, 16);
    final Uint8List sBytes = key.sublist(16, 32);

    BigInt r = BigInt.zero;
    for (int i = 15; i >= 0; i--) r = (r << 8) | BigInt.from(rBytes[i]);
    r &= BigInt.parse("0ffffffc0fffffff0ffffffc0fffffff", radix: 16);

    BigInt s = BigInt.zero;
    for (int i = 15; i >= 0; i--) s = (s << 8) | BigInt.from(sBytes[i]);

    final BigInt p = (BigInt.one << 130) - BigInt.from(5);
    BigInt acc = BigInt.zero;

    for (int i = 0; i < msg.length; i += 16) {
      final int len = min(16, msg.length - i);
      final Uint8List chunk = msg.sublist(i, i + len);
      BigInt n = BigInt.zero;
      for (int j = chunk.length - 1; j >= 0; j--) n = (n << 8) | BigInt.from(chunk[j]);
      n += (BigInt.one << (len * 8));
      acc = ((acc + n) * r) % p;
    }

    acc = (acc + s) % (BigInt.one << 128);
    final Uint8List tag = Uint8List(16);
    BigInt temp = acc;
    for (int i = 0; i < 16; i++) {
      tag[i] = (temp & BigInt.from(0xFF)).toInt();
      temp = temp >> 8;
    }
    return tag;
  }

  static Uint8List encrypt(Uint8List key, Uint8List nonce, Uint8List plaintext, {Uint8List? aad}) {
    aad ??= Uint8List(0);
    final Uint8List polyKeyBlock = _chachaBlock(key, 0, nonce);
    final Uint8List polyKey = polyKeyBlock.sublist(0, 32);

    final Uint8List ciphertext = Uint8List(plaintext.length);
    int ctr = 1;
    int offset = 0;
    while (offset < plaintext.length) {
      final Uint8List stream = _chachaBlock(key, ctr, nonce);
      final int take = min(64, plaintext.length - offset);
      for (int i = 0; i < take; i++) {
        ciphertext[offset + i] = plaintext[offset + i] ^ stream[i];
      }
      offset += take;
      ctr++;
    }

    // Build MAC data
    final BytesBuilder macData = BytesBuilder();
    macData.add(aad);
    if (aad.length % 16 != 0) macData.add(Uint8List(16 - (aad.length % 16)));
    macData.add(ciphertext);
    if (ciphertext.length % 16 != 0) macData.add(Uint8List(16 - (ciphertext.length % 16)));

    final Uint8List lens = Uint8List(16);
    final ByteData lensBd = ByteData.sublistView(lens);
    lensBd.setUint64(0, aad.length, Endian.little);
    lensBd.setUint64(8, ciphertext.length, Endian.little);
    macData.add(lens);

    final Uint8List tag = _poly1305(macData.toBytes(), polyKey);
    zeroize(polyKey);

    final BytesBuilder result = BytesBuilder();
    result.add(ciphertext);
    result.add(tag);
    return result.toBytes();
  }

  static Uint8List? decrypt(Uint8List key, Uint8List nonce, Uint8List ciphertextAndTag, {Uint8List? aad}) {
    if (ciphertextAndTag.length < 16) return null;
    aad ??= Uint8List(0);

    final Uint8List ciphertext = ciphertextAndTag.sublist(0, ciphertextAndTag.length - 16);
    final Uint8List expectedTag = ciphertextAndTag.sublist(ciphertextAndTag.length - 16);

    final Uint8List polyKeyBlock = _chachaBlock(key, 0, nonce);
    final Uint8List polyKey = polyKeyBlock.sublist(0, 32);

    final BytesBuilder macData = BytesBuilder();
    macData.add(aad);
    if (aad.length % 16 != 0) macData.add(Uint8List(16 - (aad.length % 16)));
    macData.add(ciphertext);
    if (ciphertext.length % 16 != 0) macData.add(Uint8List(16 - (ciphertext.length % 16)));

    final Uint8List lens = Uint8List(16);
    final ByteData lensBd = ByteData.sublistView(lens);
    lensBd.setUint64(0, aad.length, Endian.little);
    lensBd.setUint64(8, ciphertext.length, Endian.little);
    macData.add(lens);

    final Uint8List computedTag = _poly1305(macData.toBytes(), polyKey);
    zeroize(polyKey);

    if (!constantTimeEquals(computedTag, expectedTag)) {
      return null;
    }

    final Uint8List plaintext = Uint8List(ciphertext.length);
    int ctr = 1;
    int offset = 0;
    while (offset < ciphertext.length) {
      final Uint8List stream = _chachaBlock(key, ctr, nonce);
      final int take = min(64, ciphertext.length - offset);
      for (int i = 0; i < take; i++) {
        plaintext[offset + i] = ciphertext[offset + i] ^ stream[i];
      }
      offset += take;
      ctr++;
    }
    return plaintext;
  }
}

/// RFC 5869 HKDF-SHA256 Implementation
Uint8List hkdfExpandAndExtract(Uint8List salt, Uint8List ikm, Uint8List info, int length) {
  final crypto_pkg.Hmac hmacPrk = crypto_pkg.Hmac(crypto_pkg.sha256, salt.isEmpty ? Uint8List(32) : salt);
  final List<int> prk = hmacPrk.convert(ikm).bytes;

  final crypto_pkg.Hmac hmacOkm = crypto_pkg.Hmac(crypto_pkg.sha256, prk);
  final BytesBuilder okm = BytesBuilder();
  List<int> t = [];
  final int blocks = ((length + 31) ~/ 32);

  for (int i = 1; i <= blocks; i++) {
    final BytesBuilder input = BytesBuilder();
    input.add(t);
    input.add(info);
    input.addByte(i);
    t = hmacOkm.convert(input.toBytes()).bytes;
    okm.add(t);
  }

  return Uint8List.fromList(okm.toBytes().sublist(0, length));
}

/// Client-Side Cryptographic Session Manager
class CryptoEngine {
  final String preSharedKey;
  Uint8List? _kSend; // Client Tx Key (Host Rx)
  Uint8List? _kRecv; // Client Rx Key (Host Tx)
  bool _isEstablished = false;
  int _txSeq = 0;
  final SlidingWindowReplayGuard _replayGuard = SlidingWindowReplayGuard();

  late final Uint8List _clientPrivKey;
  late final Uint8List _clientPubKey;
  late final Uint8List _clientNonceN1;

  bool get isEstablished => _isEstablished;

  CryptoEngine({required this.preSharedKey}) {
    _clientPrivKey = X25519.generatePrivateKey();
    _clientPubKey = X25519.publicFromPrivate(_clientPrivKey);

    final Random rnd = Random.secure();
    _clientNonceN1 = Uint8List(kSaltSize);
    for (int i = 0; i < kSaltSize; i++) _clientNonceN1[i] = rnd.nextInt(256);
  }

  /// Evaluates Host Handshake Challenge (Opcode 0x06):
  /// Expects: [11B MAGIC] [32B HOST_PUBKEY] [16B HOST_NONCE_N2]
  /// Returns response payload to send to Host:
  /// [32B CLIENT_PUBKEY] [16B CLIENT_NONCE_N1] [32B HMAC_PROOF]
  Uint8List? processHostChallenge(Uint8List hostChallengePayload) {
    if (hostChallengePayload.length < 59) return null;

    final Uint8List magic = hostChallengePayload.sublist(0, 11);
    if (!constantTimeEquals(magic, Uint8List.fromList(kMagicBytes))) {
      return null;
    }

    final Uint8List hostPub = hostChallengePayload.sublist(11, 43);
    final Uint8List hostNonceN2 = hostChallengePayload.sublist(43, 59);

    // Compute Shared Secret via Curve25519
    final Uint8List sharedSecret = X25519.scalarMult(_clientPrivKey, hostPub);

    // Compute HMAC Proof with PSK
    final BytesBuilder proofData = BytesBuilder();
    proofData.add(kMagicBytes);
    proofData.add(hostPub);
    proofData.add(_clientPubKey);
    proofData.add(_clientNonceN1);
    proofData.add(hostNonceN2);

    final List<int> pskBytes = preSharedKey.codeUnits;
    final crypto_pkg.Hmac hmac = crypto_pkg.Hmac(crypto_pkg.sha256, pskBytes);
    final List<int> hmacDigest = hmac.convert(proofData.toBytes()).bytes;

    // Derive Twin Keys via HKDF-SHA256
    final BytesBuilder saltBuilder = BytesBuilder();
    saltBuilder.add(_clientNonceN1);
    saltBuilder.add(hostNonceN2);
    final Uint8List salt = saltBuilder.toBytes();

    // Client TX key = Host RX key
    _kSend = hkdfExpandAndExtract(salt, sharedSecret, Uint8List.fromList(kCtxClientTx.codeUnits), kKeySize);
    // Client RX key = Host TX key
    _kRecv = hkdfExpandAndExtract(salt, sharedSecret, Uint8List.fromList(kCtxHostTx.codeUnits), kKeySize);

    _isEstablished = true;
    zeroize(sharedSecret);
    zeroize(_clientPrivKey);

    // Assemble response
    final BytesBuilder resp = BytesBuilder();
    resp.add(_clientPubKey);
    resp.add(_clientNonceN1);
    resp.add(hmacDigest);
    return resp.toBytes();
  }

  /// Encrypts an outgoing packet payload.
  /// Returns [12B IV (Nonce)] + [Ciphertext] + [16B Tag]
  Uint8List encryptPacket(Uint8List plaintext, {Uint8List? aad, int? forcedSeq}) {
    if (!_isEstablished || _kSend == null) {
      throw StateError("CryptoEngine is not established.");
    }
    _txSeq = forcedSeq ?? (_txSeq + 1);

    final Uint8List nonce = Uint8List(kNonceSize);
    final ByteData nonceBd = ByteData.sublistView(nonce);
    nonceBd.setUint32(0, 0, Endian.big);
    nonceBd.setUint64(4, _txSeq, Endian.big);

    final Uint8List ctAndTag = ChaCha20Poly1305.encrypt(_kSend!, nonce, plaintext, aad: aad);
    final BytesBuilder out = BytesBuilder();
    out.add(nonce);
    out.add(ctAndTag);
    return out.toBytes();
  }

  /// Decrypts an incoming packet with replay window verification.
  /// Expects payload: [12B Nonce] + [Ciphertext] + [16B Tag]
  Uint8List? decryptPacket(Uint8List framedPayload, {Uint8List? aad}) {
    if (!_isEstablished || _kRecv == null || framedPayload.length < 28) {
      return null;
    }

    final Uint8List nonce = framedPayload.sublist(0, kNonceSize);
    final Uint8List ctAndTag = framedPayload.sublist(kNonceSize);

    final ByteData nonceBd = ByteData.sublistView(nonce);
    final int seq = nonceBd.getUint64(4, Endian.big);

    if (!_replayGuard.validateAndUpdate(seq)) {
      return null; // Replay attack or out-of-bounds sequence
    }

    return ChaCha20Poly1305.decrypt(_kRecv!, nonce, ctAndTag, aad: aad);
  }

  void dispose() {
    if (_kSend != null) zeroize(_kSend!);
    if (_kRecv != null) zeroize(_kRecv!);
    _isEstablished = false;
  }
}
