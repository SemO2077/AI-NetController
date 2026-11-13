import 'dart:convert';
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

  SlidingWindowReplayGuard({this.windowSize = kWindowSize}) {
    if (windowSize <= 0) {
      throw ArgumentError.value(windowSize, 'windowSize', 'must be > 0');
    }
  }

  /// Non-mutating check to ensure replay state is not polluted before AEAD tag verification.
  bool canAccept(int seq) {
    if (seq <= 0) return false;
    if (!_initialized) return true;
    final int diff = seq - _maxSeq;
    if (diff > 0) return true;
    final int absDiff = -diff;
    if (absDiff >= windowSize) return false;
    final BigInt bitMask = BigInt.one << absDiff;
    return (_bitmap & bitMask) == BigInt.zero;
  }

  bool validateAndUpdate(int seq) {
    if (seq <= 0) return false;
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
    if (k.length != 32) {
      throw ArgumentError.value(k.length, 'k', 'X25519 scalar must be 32 bytes');
    }
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
    if (uBytes.length != 32) {
      throw ArgumentError.value(uBytes.length, 'uBytes', 'X25519 u-coordinate must be 32 bytes');
    }
    final Uint8List clamped = clampScalar(kBytes);
    final BigInt k = _bytesToBigInt(clamped);
    // RFC 7748 Section 5: mask bit 255 of u-coordinate and reduce mod p
    final BigInt mask255 = (BigInt.one << 255) - BigInt.one;
    final BigInt u = (_bytesToBigInt(uBytes) & mask255) % _p;

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

/// RFC 8439 ChaCha20-Poly1305 Implementation (Zero-Alloc 26-bit Limb Engine)
class ChaCha20Poly1305 {
  static final Uint32List _keyWords = Uint32List(8);
  static final Uint32List _state = Uint32List(16);
  static final Uint32List _working = Uint32List(16);
  static final Uint8List _blockBytes = Uint8List(64);
  static final Uint8List _polyKey = Uint8List(32);
  static final Uint8List _polyPad = Uint8List(16);
  static final Uint8List _computedTag = Uint8List(16);

  static int _le32(Uint8List b, int off) =>
      b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24);

  static void _storeLe32(Uint8List b, int off, int v) {
    b[off] = v & 0xFF;
    b[off + 1] = (v >> 8) & 0xFF;
    b[off + 2] = (v >> 16) & 0xFF;
    b[off + 3] = (v >> 24) & 0xFF;
  }

  static int _rotl32(int v, int c) =>
      ((v << c) & 0xFFFFFFFF) | ((v & 0xFFFFFFFF) >> (32 - c));

  static void _quarterRound(Uint32List x, int a, int b, int c, int d) {
    x[a] = x[a] + x[b];
    x[d] = _rotl32(x[d] ^ x[a], 16);
    x[c] = x[c] + x[d];
    x[b] = _rotl32(x[b] ^ x[c], 12);
    x[a] = x[a] + x[b];
    x[d] = _rotl32(x[d] ^ x[a], 8);
    x[c] = x[c] + x[d];
    x[b] = _rotl32(x[b] ^ x[c], 7);
  }

  static void _prepareKeyState(Uint8List key, Uint8List nonce) {
    _state[0] = 0x61707865;
    _state[1] = 0x3320646e;
    _state[2] = 0x79622d32;
    _state[3] = 0x6b206574;
    for (int i = 0; i < 8; i++) {
      final int w = _le32(key, i * 4);
      _keyWords[i] = w;
      _state[4 + i] = w;
    }
    _state[13] = _le32(nonce, 0);
    _state[14] = _le32(nonce, 4);
    _state[15] = _le32(nonce, 8);
  }

  static void _chachaBlockToScratch(int counter) {
    _state[12] = counter & 0xFFFFFFFF;
    for (int i = 0; i < 16; i++) {
      _working[i] = _state[i];
    }
    for (int i = 0; i < 10; i++) {
      _quarterRound(_working, 0, 4, 8, 12);
      _quarterRound(_working, 1, 5, 9, 13);
      _quarterRound(_working, 2, 6, 10, 14);
      _quarterRound(_working, 3, 7, 11, 15);
      _quarterRound(_working, 0, 5, 10, 15);
      _quarterRound(_working, 1, 6, 11, 12);
      _quarterRound(_working, 2, 7, 8, 13);
      _quarterRound(_working, 3, 4, 9, 14);
    }
    for (int i = 0; i < 16; i++) {
      _storeLe32(_blockBytes, i * 4, (_working[i] + _state[i]) & 0xFFFFFFFF);
    }
  }

  static void _computeAeadTagInto(
    Uint8List polyKey,
    Uint8List aad,
    Uint8List ctBuf,
    int ctOffset,
    int ctLen,
    Uint8List tagOut,
    int tagOutOffset,
  ) {
    final int t0 = _le32(polyKey, 0);
    final int t1 = _le32(polyKey, 4);
    final int t2 = _le32(polyKey, 8);
    final int t3 = _le32(polyKey, 12);

    final int r0 = t0 & 0x03FFFFFF;
    final int r1 = ((t0 >> 26) | (t1 << 6)) & 0x03FFFF03;
    final int r2 = ((t1 >> 20) | (t2 << 12)) & 0x03FFC0FF;
    final int r3 = ((t2 >> 14) | (t3 << 18)) & 0x03F03FFF;
    final int r4 = (t3 >> 8) & 0x000FFFFF;

    final int s1 = r1 * 5;
    final int s2 = r2 * 5;
    final int s3 = r3 * 5;
    final int s4 = r4 * 5;

    int h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0;

    void processBlock(Uint8List blk, int off) {
      final int b0 = _le32(blk, off);
      final int b1 = _le32(blk, off + 4);
      final int b2 = _le32(blk, off + 8);
      final int b3 = _le32(blk, off + 12);

      h0 += b0 & 0x03FFFFFF;
      h1 += ((b0 >> 26) | (b1 << 6)) & 0x03FFFFFF;
      h2 += ((b1 >> 20) | (b2 << 12)) & 0x03FFFFFF;
      h3 += ((b2 >> 14) | (b3 << 18)) & 0x03FFFFFF;
      h4 += (b3 >> 8) | (1 << 24);

      final int d0 = h0 * r0 + h1 * s4 + h2 * s3 + h3 * s2 + h4 * s1;
      int d1 = h0 * r1 + h1 * r0 + h2 * s4 + h3 * s3 + h4 * s2;
      int d2 = h0 * r2 + h1 * r1 + h2 * r0 + h3 * s4 + h4 * s3;
      int d3 = h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * s4;
      int d4 = h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;

      int c = d0 >> 26; h0 = d0 & 0x03FFFFFF; d1 += c;
      c = d1 >> 26; h1 = d1 & 0x03FFFFFF; d2 += c;
      c = d2 >> 26; h2 = d2 & 0x03FFFFFF; d3 += c;
      c = d3 >> 26; h3 = d3 & 0x03FFFFFF; d4 += c;
      c = d4 >> 26; h4 = d4 & 0x03FFFFFF; h0 += c * 5;
      c = h0 >> 26; h0 &= 0x03FFFFFF; h1 += c;
    }

    void feedPadded(Uint8List src, int baseOff, int len) {
      int pos = 0;
      while (pos + 16 <= len) {
        processBlock(src, baseOff + pos);
        pos += 16;
      }
      final int rem = len - pos;
      if (rem > 0) {
        for (int i = 0; i < rem; i++) {
          _polyPad[i] = src[baseOff + pos + i];
        }
        for (int i = rem; i < 16; i++) {
          _polyPad[i] = 0;
        }
        processBlock(_polyPad, 0);
      }
    }

    feedPadded(aad, 0, aad.length);
    feedPadded(ctBuf, ctOffset, ctLen);

    _storeLe32(_polyPad, 0, aad.length & 0xFFFFFFFF);
    _storeLe32(_polyPad, 4, (aad.length >> 32) & 0xFFFFFFFF);
    _storeLe32(_polyPad, 8, ctLen & 0xFFFFFFFF);
    _storeLe32(_polyPad, 12, (ctLen >> 32) & 0xFFFFFFFF);
    processBlock(_polyPad, 0);

    int c = h1 >> 26; h1 &= 0x03FFFFFF; h2 += c;
    c = h2 >> 26; h2 &= 0x03FFFFFF; h3 += c;
    c = h3 >> 26; h3 &= 0x03FFFFFF; h4 += c;
    c = h4 >> 26; h4 &= 0x03FFFFFF; h0 += c * 5;
    c = h0 >> 26; h0 &= 0x03FFFFFF; h1 += c;

    int g0 = h0 + 5; c = g0 >> 26; g0 &= 0x03FFFFFF;
    int g1 = h1 + c; c = g1 >> 26; g1 &= 0x03FFFFFF;
    int g2 = h2 + c; c = g2 >> 26; g2 &= 0x03FFFFFF;
    int g3 = h3 + c; c = g3 >> 26; g3 &= 0x03FFFFFF;
    final int g4 = h4 + c - (1 << 26);

    final int selectG = (((g4 >> 31) & 1) - 1) & 0x03FFFFFF;
    final int keepH = selectG ^ 0x03FFFFFF;
    h0 = (h0 & keepH) | (g0 & selectG);
    h1 = (h1 & keepH) | (g1 & selectG);
    h2 = (h2 & keepH) | (g2 & selectG);
    h3 = (h3 & keepH) | (g3 & selectG);
    h4 = (h4 & keepH) | (g4 & selectG);

    final int f0 = (h0 | (h1 << 26)) & 0xFFFFFFFF;
    final int f1 = ((h1 >> 6) | (h2 << 20)) & 0xFFFFFFFF;
    final int f2 = ((h2 >> 12) | (h3 << 14)) & 0xFFFFFFFF;
    final int f3 = ((h3 >> 18) | (h4 << 8)) & 0xFFFFFFFF;

    final int p0 = f0 + _le32(polyKey, 16);
    final int p1 = f1 + _le32(polyKey, 20) + ((p0 >> 32) & 0xFFFFFFFF);
    final int p2 = f2 + _le32(polyKey, 24) + ((p1 >> 32) & 0xFFFFFFFF);
    final int p3 = f3 + _le32(polyKey, 28) + ((p2 >> 32) & 0xFFFFFFFF);

    _storeLe32(tagOut, tagOutOffset, p0 & 0xFFFFFFFF);
    _storeLe32(tagOut, tagOutOffset + 4, p1 & 0xFFFFFFFF);
    _storeLe32(tagOut, tagOutOffset + 8, p2 & 0xFFFFFFFF);
    _storeLe32(tagOut, tagOutOffset + 12, p3 & 0xFFFFFFFF);
  }

  static void _scrubScratch() {
    for (int i = 0; i < 8; i++) _keyWords[i] = 0;
    for (int i = 0; i < 16; i++) {
      _state[i] = 0;
      _working[i] = 0;
    }
    zeroize(_blockBytes);
    zeroize(_polyKey);
    zeroize(_polyPad);
  }

  /// Encrypts [plaintext] directly into [out] at [outOffset], writing `[ciphertext][16B tag]`.
  static void encryptInto(
    Uint8List key,
    Uint8List nonce,
    Uint8List plaintext,
    Uint8List out,
    int outOffset, {
    Uint8List? aad,
  }) {
    if (key.length != 32 || nonce.length != 12) {
      throw ArgumentError('ChaCha20-Poly1305 requires a 32-byte key and 12-byte nonce');
    }
    final Uint8List aadData = aad ?? Uint8List(0);
    try {
      _prepareKeyState(key, nonce);
      _chachaBlockToScratch(0);
      for (int i = 0; i < 32; i++) {
        _polyKey[i] = _blockBytes[i];
      }

      final int ptLen = plaintext.length;
      int ctr = 1;
      int offset = 0;
      while (offset < ptLen) {
        _chachaBlockToScratch(ctr);
        final int take = min(64, ptLen - offset);
        for (int i = 0; i < take; i++) {
          out[outOffset + offset + i] = plaintext[offset + i] ^ _blockBytes[i];
        }
        offset += take;
        ctr++;
      }

      _computeAeadTagInto(_polyKey, aadData, out, outOffset, ptLen, out, outOffset + ptLen);
    } finally {
      _scrubScratch();
    }
  }

  static Uint8List encrypt(Uint8List key, Uint8List nonce, Uint8List plaintext, {Uint8List? aad}) {
    final Uint8List result = Uint8List(plaintext.length + 16);
    encryptInto(key, nonce, plaintext, result, 0, aad: aad);
    return result;
  }

  static Uint8List? decrypt(Uint8List key, Uint8List nonce, Uint8List ciphertextAndTag, {Uint8List? aad}) {
    if (key.length != 32 || nonce.length != 12 || ciphertextAndTag.length < 16) return null;
    final Uint8List aadData = aad ?? Uint8List(0);
    final int ctLen = ciphertextAndTag.length - 16;

    try {
      _prepareKeyState(key, nonce);
      _chachaBlockToScratch(0);
      for (int i = 0; i < 32; i++) {
        _polyKey[i] = _blockBytes[i];
      }

      _computeAeadTagInto(_polyKey, aadData, ciphertextAndTag, 0, ctLen, _computedTag, 0);

      int diff = 0;
      for (int i = 0; i < 16; i++) {
        diff |= _computedTag[i] ^ ciphertextAndTag[ctLen + i];
      }
      if (diff != 0) {
        return null;
      }

      final Uint8List plaintext = Uint8List(ctLen);
      int ctr = 1;
      int offset = 0;
      while (offset < ctLen) {
        _chachaBlockToScratch(ctr);
        final int take = min(64, ctLen - offset);
        for (int i = 0; i < take; i++) {
          plaintext[offset + i] = ciphertextAndTag[offset + i] ^ _blockBytes[i];
        }
        offset += take;
        ctr++;
      }
      return plaintext;
    } finally {
      _scrubScratch();
      zeroize(_computedTag);
    }
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
  bool _disposed = false;
  int _txSeq = 0;
  final SlidingWindowReplayGuard _replayGuard = SlidingWindowReplayGuard();

  late final Uint8List _clientPrivKey;
  late final Uint8List _clientPubKey;
  late final Uint8List _clientNonceN1;
  late final Uint8List _mutualClientChallenge;

  bool get isEstablished => _isEstablished;

  CryptoEngine({required this.preSharedKey}) {
    if (preSharedKey.trim().isEmpty) {
      throw ArgumentError("preSharedKey cannot be empty");
    }
    _clientPrivKey = X25519.generatePrivateKey();
    _clientPubKey = X25519.publicFromPrivate(_clientPrivKey);

    final Random rnd = Random.secure();
    _clientNonceN1 = Uint8List(kSaltSize);
    _mutualClientChallenge = Uint8List(kSaltSize);
    for (int i = 0; i < kSaltSize; i++) {
      _clientNonceN1[i] = rnd.nextInt(256);
      _mutualClientChallenge[i] = rnd.nextInt(256);
    }
  }

  /// Builds 34-byte mutual-auth vault initiation payload (`INIT_ECDH_VAULT_M:` + 16B client challenge).
  Uint8List buildMutualInitPayload() {
    final List<int> prefix = utf8.encode("INIT_ECDH_VAULT_M:");
    final Uint8List out = Uint8List(prefix.length + kSaltSize);
    out.setRange(0, prefix.length, prefix);
    out.setRange(prefix.length, out.length, _mutualClientChallenge);
    return out;
  }

  /// Verifies 91-byte mutual host challenge (`59B challenge + 32B HMAC-SHA256("CST_HOST_CHAL_M:" + clientChal + challenge59)`)
  /// before deriving keys and constructing the 80B client response.
  Uint8List? processMutualHostChallenge(Uint8List hostChallengePayload) {
    if (_disposed || _isEstablished) {
      return null;
    }
    if (hostChallengePayload.length != 91) {
      return null;
    }
    final Uint8List core59 = Uint8List.sublistView(hostChallengePayload, 0, 59);
    final Uint8List hostMac = Uint8List.sublistView(hostChallengePayload, 59, 91);

    final List<int> tagPrefix = utf8.encode("CST_HOST_CHAL_M:");
    final Uint8List msg = Uint8List(tagPrefix.length + _mutualClientChallenge.length + 59);
    msg.setRange(0, tagPrefix.length, tagPrefix);
    msg.setRange(tagPrefix.length, tagPrefix.length + _mutualClientChallenge.length, _mutualClientChallenge);
    msg.setRange(tagPrefix.length + _mutualClientChallenge.length, msg.length, core59);

    final List<int> pskBytes = utf8.encode(preSharedKey.trim());
    final crypto_pkg.Hmac hmac = crypto_pkg.Hmac(crypto_pkg.sha256, pskBytes);
    final Uint8List expectedMac = Uint8List.fromList(hmac.convert(msg).bytes);
    zeroize(msg);
    if (!constantTimeEquals(hostMac, expectedMac)) {
      return null;
    }
    return processHostChallenge(core59);
  }

  /// Evaluates Host Handshake Challenge (Opcode 0x06):
  /// Expects: [11B MAGIC] [32B HOST_PUBKEY] [16B HOST_NONCE_N2]
  /// Returns response payload to send to Host:
  /// [32B CLIENT_PUBKEY] [16B CLIENT_NONCE_N1] [32B HMAC_PROOF]
  Uint8List? processHostChallenge(Uint8List hostChallengePayload) {
    if (_disposed || _isEstablished) {
      return null;
    }
    if (hostChallengePayload.length != 59) return null;

    final Uint8List magic = Uint8List.sublistView(hostChallengePayload, 0, 11);
    if (!constantTimeEquals(magic, Uint8List.fromList(kMagicBytes))) {
      return null;
    }

    final Uint8List hostPub = Uint8List.sublistView(hostChallengePayload, 11, 43);
    final Uint8List hostNonceN2 = Uint8List.sublistView(hostChallengePayload, 43, 59);

    // Compute Shared Secret via Curve25519 and reject low-order all-zero shared secrets (RFC 7748)
    final Uint8List sharedSecret = X25519.scalarMult(_clientPrivKey, hostPub);
    int nonZero = 0;
    for (int i = 0; i < sharedSecret.length; i++) {
      nonZero |= sharedSecret[i];
    }
    if (nonZero == 0) {
      zeroize(sharedSecret);
      return null;
    }

    // Compute HMAC Proof with PSK
    final BytesBuilder proofData = BytesBuilder();
    proofData.add(kMagicBytes);
    proofData.add(hostPub);
    proofData.add(_clientPubKey);
    proofData.add(_clientNonceN1);
    proofData.add(hostNonceN2);

    final List<int> pskBytes = utf8.encode(preSharedKey.trim());
    final crypto_pkg.Hmac hmac = crypto_pkg.Hmac(crypto_pkg.sha256, pskBytes);
    final List<int> hmacDigest = hmac.convert(proofData.toBytes()).bytes;

    // Derive Twin Keys via HKDF-SHA256
    final Uint8List salt = Uint8List(_clientNonceN1.length + hostNonceN2.length);
    salt.setRange(0, _clientNonceN1.length, _clientNonceN1);
    salt.setRange(_clientNonceN1.length, salt.length, hostNonceN2);

    // Client TX key = Host RX key
    _kSend = hkdfExpandAndExtract(salt, sharedSecret, Uint8List.fromList(utf8.encode(kCtxClientTx)), kKeySize);
    // Client RX key = Host TX key
    _kRecv = hkdfExpandAndExtract(salt, sharedSecret, Uint8List.fromList(utf8.encode(kCtxHostTx)), kKeySize);

    _isEstablished = true;
    zeroize(sharedSecret);
    zeroize(_clientPrivKey);

    // Assemble response
    final Uint8List resp = Uint8List(80);
    resp.setRange(0, 32, _clientPubKey);
    resp.setRange(32, 48, _clientNonceN1);
    resp.setRange(48, 80, hmacDigest);
    return resp;
  }

  /// Encrypts an outgoing packet payload into a single allocation:
  /// `[12B IV (Nonce)] + [Ciphertext] + [16B Tag]`
  Uint8List encryptPacket(Uint8List plaintext, {Uint8List? aad, int? forcedSeq}) {
    if (_disposed || !_isEstablished || _kSend == null) {
      throw StateError("CryptoEngine is not established.");
    }
    if (forcedSeq != null) {
      if (forcedSeq <= 0 || forcedSeq <= _txSeq) {
        throw ArgumentError("forcedSeq must advance strictly beyond current _txSeq ($_txSeq).");
      }
      _txSeq = forcedSeq;
    } else {
      _txSeq++;
    }

    final Uint8List out = Uint8List(kNonceSize + plaintext.length + kTagSize);
    final ByteData nonceBd = ByteData.sublistView(out, 0, kNonceSize);
    nonceBd.setUint32(0, 0, Endian.big);
    nonceBd.setUint64(4, _txSeq, Endian.big);
    final Uint8List nonceView = Uint8List.sublistView(out, 0, kNonceSize);

    ChaCha20Poly1305.encryptInto(_kSend!, nonceView, plaintext, out, kNonceSize, aad: aad);
    return out;
  }

  /// Builds a complete 12-byte canonical wire packet with AEAD flag `0x02` in a single buffer allocation:
  /// `[0xC5, 0x71, opcode, 0x02, seq(4B BE), wireLen(4B BE), 12B nonce, ciphertext, 16B tag]`
  Uint8List encryptWirePacket(int opcode, Uint8List plaintext, {int? forcedSeq}) {
    if (_disposed || !_isEstablished || _kSend == null) {
      throw StateError("CryptoEngine is not established.");
    }
    if (forcedSeq != null) {
      if (forcedSeq <= 0 || forcedSeq <= _txSeq) {
        throw ArgumentError("forcedSeq must advance strictly beyond current _txSeq ($_txSeq).");
      }
      _txSeq = forcedSeq;
    } else {
      _txSeq++;
    }

    final int wireLen = kNonceSize + plaintext.length + kTagSize;
    final Uint8List out = Uint8List(12 + wireLen);
    out[0] = 0xC5;
    out[1] = 0x71;
    out[2] = opcode & 0xFF;
    out[3] = 0x02;
    final ByteData bd = ByteData.sublistView(out);
    bd.setUint32(4, _txSeq & 0xFFFFFFFF, Endian.big);
    bd.setUint32(8, wireLen, Endian.big);
    bd.setUint32(12, 0, Endian.big);
    bd.setUint64(16, _txSeq, Endian.big);

    final Uint8List hdrAad = Uint8List.sublistView(out, 0, 12);
    final Uint8List nonceView = Uint8List.sublistView(out, 12, 24);
    ChaCha20Poly1305.encryptInto(_kSend!, nonceView, plaintext, out, 24, aad: hdrAad);
    return out;
  }

  /// Decrypts an incoming packet with replay window verification (zero-copy view slices).
  /// Expects payload: [12B Nonce] + [Ciphertext] + [16B Tag]
  Uint8List? decryptPacket(Uint8List framedPayload, {Uint8List? aad}) {
    if (_disposed || !_isEstablished || _kRecv == null || framedPayload.length < 28) {
      return null;
    }

    final Uint8List nonce = Uint8List.sublistView(framedPayload, 0, kNonceSize);
    final Uint8List ctAndTag = Uint8List.sublistView(framedPayload, kNonceSize);

    final ByteData nonceBd = ByteData.sublistView(framedPayload, 0, kNonceSize);
    final int epoch = nonceBd.getUint32(0, Endian.big);
    if (epoch != 0) {
      return null;
    }
    final int seq = nonceBd.getUint64(4, Endian.big);

    // Check replay eligibility BEFORE committing state, then verify Poly1305 MAC first
    if (!_replayGuard.canAccept(seq)) {
      return null;
    }

    final Uint8List? plaintext = ChaCha20Poly1305.decrypt(_kRecv!, nonce, ctAndTag, aad: aad);
    if (plaintext == null) {
      return null;
    }
    if (!_replayGuard.validateAndUpdate(seq)) {
      return null;
    }
    return plaintext;
  }

  /// Decrypts a full 12-byte-prefixed binary wire frame requiring AEAD flag `0x02`.
  Uint8List? decryptWirePacket(Uint8List rawWireFrame) {
    if (rawWireFrame.length < 12 + 28) return null;
    if (rawWireFrame[0] != 0xC5 || rawWireFrame[1] != 0x71) return null;
    if ((rawWireFrame[3] & 0x02) == 0) return null;
    final int wireLen = ByteData.sublistView(rawWireFrame).getUint32(8, Endian.big);
    if (rawWireFrame.length != 12 + wireLen) return null;
    final Uint8List aad = Uint8List.sublistView(rawWireFrame, 0, 12);
    final Uint8List payload = Uint8List.sublistView(rawWireFrame, 12);
    return decryptPacket(payload, aad: aad);
  }

  void dispose() {
    _disposed = true;
    if (_kSend != null) {
      zeroize(_kSend!);
      _kSend = null;
    }
    if (_kRecv != null) {
      zeroize(_kRecv!);
      _kRecv = null;
    }
    zeroize(_clientPrivKey);
    zeroize(_clientNonceN1);
    zeroize(_mutualClientChallenge);
    _isEstablished = false;
  }
}
