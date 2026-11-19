/**
 * AI NetController - Zero-Dependency Cryptographic Vault Engine (Browser / Worker / Node)
 * ----------------------------------------------------------------------------------------
 * Matches `agent/crypto_vault.py` (`CST_ECDH_V2`) and `apps/mobile/lib/security/crypto_engine.dart` bit-for-bit:
 * - RFC 7748 X25519 (Curve25519) Ephemeral ECDH
 * - RFC 5869 HKDF-SHA256 Twin Directional Key Derivation ("cst-client-tx" / "cst-host-tx")
 * - RFC 8439 ChaCha20-Poly1305 AEAD Encryption / Authentication
 * - RFC 6479 128-bit Sliding Window Anti-Replay Guard
 * - CST-PAIR-X25519-V1 Encrypted PIN Onboarding Helpers
 */

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

export const MAGIC_BYTE_0 = 0xc5;
export const MAGIC_BYTE_1 = 0x71;
export const HEADER_SIZE = 12;
export const KEY_SIZE = 32;
export const NONCE_SIZE = 12;
export const TAG_SIZE = 16;
export const SALT_SIZE = 16;

const PROTOCOL_MAGIC = UTF8_ENCODER.encode('CST_ECDH_V2');
const CTX_CLIENT_TX = UTF8_ENCODER.encode('cst-client-tx');
const CTX_HOST_TX = UTF8_ENCODER.encode('cst-host-tx');
const MUTUAL_INIT_PREFIX = UTF8_ENCODER.encode('INIT_ECDH_VAULT_M:');
const MUTUAL_CHAL_TAG = UTF8_ENCODER.encode('CST_HOST_CHAL_M:');

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(out);
    return out;
  }
  throw new Error('CSPRNG (crypto.getRandomValues) is required for WebCryptoVault.');
}

export function zeroize(buf?: Uint8Array | null): void {
  if (!buf) return;
  buf.fill(0);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (let i = 0; i < chunks.length; i++) {
    total += chunks[i].length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    out.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const clean = (b64 || '').trim();
  if (!clean) return new Uint8Array(0);
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(clean, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i) & 0xff;
  }
  return out;
}

// =====================================================================
// SHA-256 & HMAC-SHA256 & RFC 5869 HKDF-SHA256 (Synchronous Pure-TS)
// =====================================================================
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(data: Uint8Array): Uint8Array<ArrayBuffer> {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const bitLen = data.length * 8;
  const padLen = (data.length + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 4, bitLen >>> 0, false);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, h0, false);
  outDv.setUint32(4, h1, false);
  outDv.setUint32(8, h2, false);
  outDv.setUint32(12, h3, false);
  outDv.setUint32(16, h4, false);
  outDv.setUint32(20, h5, false);
  outDv.setUint32(24, h6, false);
  outDv.setUint32(28, h7, false);
  return out;
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array<ArrayBuffer> {
  const blockSize = 64;
  const k = key.length > blockSize ? sha256(key) : key;
  const oKeyPad = new Uint8Array(blockSize + 32);
  const iKeyPad = new Uint8Array(blockSize + message.length);
  for (let i = 0; i < blockSize; i++) {
    const kb = i < k.length ? k[i] : 0;
    oKeyPad[i] = kb ^ 0x5c;
    iKeyPad[i] = kb ^ 0x36;
  }
  iKeyPad.set(message, blockSize);
  const innerHash = sha256(iKeyPad);
  oKeyPad.set(innerHash, blockSize);
  const mac = sha256(oKeyPad);
  zeroize(oKeyPad);
  zeroize(iKeyPad);
  zeroize(innerHash);
  return mac;
}

export function hkdfSha256(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Uint8Array<ArrayBuffer> {
  const actualSalt = salt.length > 0 ? salt : new Uint8Array(32);
  const prk = hmacSha256(actualSalt, ikm);
  const blocks = Math.ceil(length / 32);
  const okm = new Uint8Array(blocks * 32);
  let prev: Uint8Array = new Uint8Array(0);

  for (let i = 1; i <= blocks; i++) {
    const input = new Uint8Array(prev.length + info.length + 1);
    input.set(prev, 0);
    input.set(info, prev.length);
    input[prev.length + info.length] = i & 0xff;
    prev = hmacSha256(prk, input);
    okm.set(prev, (i - 1) * 32);
    zeroize(input);
  }
  zeroize(prk);
  return okm.slice(0, length);
}

// =====================================================================
// RFC 7748 CURVE25519 / X25519 (Montgomery Ladder via BigInt mod 2^255-19)
// =====================================================================
const CURVE_P = (1n << 255n) - 19n;
const CURVE_A24 = 121665n;
const MASK_255 = (1n << 255n) - 1n;

export function clampX25519Scalar(scalar: Uint8Array): Uint8Array {
  if (scalar.length !== 32) {
    throw new RangeError(`X25519 scalar must be 32 bytes, got ${scalar.length}`);
  }
  const out = scalar.slice();
  out[0] &= 248;
  out[31] &= 127;
  out[31] |= 64;
  return out;
}

function bytesLeToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

function bigIntToBytesLe(val: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = val;
  for (let i = 0; i < length; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function modP(n: bigint): bigint {
  const r = n % CURVE_P;
  return r >= 0n ? r : r + CURVE_P;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  if (b < 0n) b += mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % mod;
    }
    e >>= 1n;
    if (e > 0n) {
      b = (b * b) % mod;
    }
  }
  return result;
}

export function x25519(kBytes: Uint8Array, uBytes: Uint8Array): Uint8Array {
  if (kBytes.length !== 32 || uBytes.length !== 32) {
    throw new RangeError('X25519 expects 32-byte scalar and u-coordinate.');
  }
  const clamped = clampX25519Scalar(kBytes);
  const k = bytesLeToBigInt(clamped);
  const u = (bytesLeToBigInt(uBytes) & MASK_255) % CURVE_P;
  zeroize(clamped);

  const x1 = u;
  let x2 = 1n;
  let z2 = 0n;
  let x3 = u;
  let z3 = 1n;
  let swap = 0n;

  for (let t = 254n; t >= 0n; t--) {
    const kt = (k >> t) & 1n;
    swap ^= kt;
    if (swap !== 0n) {
      let tmp = x2;
      x2 = x3;
      x3 = tmp;
      tmp = z2;
      z2 = z3;
      z3 = tmp;
    }
    swap = kt;

    const A = modP(x2 + z2);
    const AA = modP(A * A);
    const B = modP(x2 - z2);
    const BB = modP(B * B);
    const E = modP(AA - BB);
    const C = modP(x3 + z3);
    const D = modP(x3 - z3);
    const DA = modP(D * A);
    const CB = modP(C * B);
    const sumDaCb = modP(DA + CB);
    const diffDaCb = modP(DA - CB);
    x3 = modP(sumDaCb * sumDaCb);
    z3 = modP(x1 * modP(diffDaCb * diffDaCb));
    x2 = modP(AA * BB);
    z2 = modP(E * modP(AA + CURVE_A24 * E));
  }

  if (swap !== 0n) {
    const tx = x2;
    x2 = x3;
    x3 = tx;
    const tz = z2;
    z2 = z3;
    z3 = tz;
  }

  const res = modP(x2 * modPow(z2, CURVE_P - 2n, CURVE_P));
  return bigIntToBytesLe(res, 32);
}

export function generateX25519Keypair(): { priv: Uint8Array; pub: Uint8Array } {
  const priv = randomBytes(32);
  const basePoint = new Uint8Array(32);
  basePoint[0] = 9;
  const pub = x25519(priv, basePoint);
  return { priv, pub };
}

// =====================================================================
// RFC 8439 ChaCha20-Poly1305 AEAD
// =====================================================================
const POLY1305_P = (1n << 130n) - 5n;
const POLY1305_R_CLAMP = 0x0ffffffc0ffffffc0ffffffc0fffffffn;
const POLY1305_MASK_128 = (1n << 128n) - 1n;

function le32(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

function chacha20BlockInto(key: Uint8Array, counter: number, nonce: Uint8Array, out64: Uint8Array): void {
  const s0 = 0x61707865;
  const s1 = 0x3320646e;
  const s2 = 0x79622d32;
  const s3 = 0x6b206574;
  const s4 = le32(key, 0);
  const s5 = le32(key, 4);
  const s6 = le32(key, 8);
  const s7 = le32(key, 12);
  const s8 = le32(key, 16);
  const s9 = le32(key, 20);
  const s10 = le32(key, 24);
  const s11 = le32(key, 28);
  const s12 = counter >>> 0;
  const s13 = le32(nonce, 0);
  const s14 = le32(nonce, 4);
  const s15 = le32(nonce, 8);

  let x0 = s0, x1 = s1, x2 = s2, x3 = s3;
  let x4 = s4, x5 = s5, x6 = s6, x7 = s7;
  let x8 = s8, x9 = s9, x10 = s10, x11 = s11;
  let x12 = s12, x13 = s13, x14 = s14, x15 = s15;

  for (let i = 0; i < 10; i++) {
    // Column rounds
    x0 = (x0 + x4) >>> 0; x12 ^= x0; x12 = ((x12 << 16) | (x12 >>> 16)) >>> 0;
    x8 = (x8 + x12) >>> 0; x4 ^= x8; x4 = ((x4 << 12) | (x4 >>> 20)) >>> 0;
    x0 = (x0 + x4) >>> 0; x12 ^= x0; x12 = ((x12 << 8) | (x12 >>> 24)) >>> 0;
    x8 = (x8 + x12) >>> 0; x4 ^= x8; x4 = ((x4 << 7) | (x4 >>> 25)) >>> 0;

    x1 = (x1 + x5) >>> 0; x13 ^= x1; x13 = ((x13 << 16) | (x13 >>> 16)) >>> 0;
    x9 = (x9 + x13) >>> 0; x5 ^= x9; x5 = ((x5 << 12) | (x5 >>> 20)) >>> 0;
    x1 = (x1 + x5) >>> 0; x13 ^= x1; x13 = ((x13 << 8) | (x13 >>> 24)) >>> 0;
    x9 = (x9 + x13) >>> 0; x5 ^= x9; x5 = ((x5 << 7) | (x5 >>> 25)) >>> 0;

    x2 = (x2 + x6) >>> 0; x14 ^= x2; x14 = ((x14 << 16) | (x14 >>> 16)) >>> 0;
    x10 = (x10 + x14) >>> 0; x6 ^= x10; x6 = ((x6 << 12) | (x6 >>> 20)) >>> 0;
    x2 = (x2 + x6) >>> 0; x14 ^= x2; x14 = ((x14 << 8) | (x14 >>> 24)) >>> 0;
    x10 = (x10 + x14) >>> 0; x6 ^= x10; x6 = ((x6 << 7) | (x6 >>> 25)) >>> 0;

    x3 = (x3 + x7) >>> 0; x15 ^= x3; x15 = ((x15 << 16) | (x15 >>> 16)) >>> 0;
    x11 = (x11 + x15) >>> 0; x7 ^= x11; x7 = ((x7 << 12) | (x7 >>> 20)) >>> 0;
    x3 = (x3 + x7) >>> 0; x15 ^= x3; x15 = ((x15 << 8) | (x15 >>> 24)) >>> 0;
    x11 = (x11 + x15) >>> 0; x7 ^= x11; x7 = ((x7 << 7) | (x7 >>> 25)) >>> 0;

    // Diagonal rounds
    x0 = (x0 + x5) >>> 0; x15 ^= x0; x15 = ((x15 << 16) | (x15 >>> 16)) >>> 0;
    x10 = (x10 + x15) >>> 0; x5 ^= x10; x5 = ((x5 << 12) | (x5 >>> 20)) >>> 0;
    x0 = (x0 + x5) >>> 0; x15 ^= x0; x15 = ((x15 << 8) | (x15 >>> 24)) >>> 0;
    x10 = (x10 + x15) >>> 0; x5 ^= x10; x5 = ((x5 << 7) | (x5 >>> 25)) >>> 0;

    x1 = (x1 + x6) >>> 0; x12 ^= x1; x12 = ((x12 << 16) | (x12 >>> 16)) >>> 0;
    x11 = (x11 + x12) >>> 0; x6 ^= x11; x6 = ((x6 << 12) | (x6 >>> 20)) >>> 0;
    x1 = (x1 + x6) >>> 0; x12 ^= x1; x12 = ((x12 << 8) | (x12 >>> 24)) >>> 0;
    x11 = (x11 + x12) >>> 0; x6 ^= x11; x6 = ((x6 << 7) | (x6 >>> 25)) >>> 0;

    x2 = (x2 + x7) >>> 0; x13 ^= x2; x13 = ((x13 << 16) | (x13 >>> 16)) >>> 0;
    x8 = (x8 + x13) >>> 0; x7 ^= x8; x7 = ((x7 << 12) | (x7 >>> 20)) >>> 0;
    x2 = (x2 + x7) >>> 0; x13 ^= x2; x13 = ((x13 << 8) | (x13 >>> 24)) >>> 0;
    x8 = (x8 + x13) >>> 0; x7 ^= x8; x7 = ((x7 << 7) | (x7 >>> 25)) >>> 0;

    x3 = (x3 + x4) >>> 0; x14 ^= x3; x14 = ((x14 << 16) | (x14 >>> 16)) >>> 0;
    x9 = (x9 + x14) >>> 0; x4 ^= x9; x4 = ((x4 << 12) | (x4 >>> 20)) >>> 0;
    x3 = (x3 + x4) >>> 0; x14 ^= x3; x14 = ((x14 << 8) | (x14 >>> 24)) >>> 0;
    x9 = (x9 + x14) >>> 0; x4 ^= x9; x4 = ((x4 << 7) | (x4 >>> 25)) >>> 0;
  }

  const dv = new DataView(out64.buffer, out64.byteOffset, 64);
  dv.setUint32(0, (x0 + s0) >>> 0, true);
  dv.setUint32(4, (x1 + s1) >>> 0, true);
  dv.setUint32(8, (x2 + s2) >>> 0, true);
  dv.setUint32(12, (x3 + s3) >>> 0, true);
  dv.setUint32(16, (x4 + s4) >>> 0, true);
  dv.setUint32(20, (x5 + s5) >>> 0, true);
  dv.setUint32(24, (x6 + s6) >>> 0, true);
  dv.setUint32(28, (x7 + s7) >>> 0, true);
  dv.setUint32(32, (x8 + s8) >>> 0, true);
  dv.setUint32(36, (x9 + s9) >>> 0, true);
  dv.setUint32(40, (x10 + s10) >>> 0, true);
  dv.setUint32(44, (x11 + s11) >>> 0, true);
  dv.setUint32(48, (x12 + s12) >>> 0, true);
  dv.setUint32(52, (x13 + s13) >>> 0, true);
  dv.setUint32(56, (x14 + s14) >>> 0, true);
  dv.setUint32(60, (x15 + s15) >>> 0, true);
}

function chacha20XorInto(
  key: Uint8Array,
  nonce: Uint8Array,
  src: Uint8Array,
  srcOff: number,
  dst: Uint8Array,
  dstOff: number,
  len: number
): void {
  const block = new Uint8Array(64);
  let ctr = 1;
  let offset = 0;
  while (offset < len) {
    chacha20BlockInto(key, ctr, nonce, block);
    const take = Math.min(64, len - offset);
    for (let i = 0; i < take; i++) {
      dst[dstOff + offset + i] = src[srcOff + offset + i] ^ block[i];
    }
    offset += take;
    ctr++;
  }
  zeroize(block);
}

function poly1305AeadTag(polyKey32: Uint8Array, aad: Uint8Array, ct: Uint8Array, ctOff: number, ctLen: number): Uint8Array {
  const r = bytesLeToBigInt(polyKey32.subarray(0, 16)) & POLY1305_R_CLAMP;
  const s = bytesLeToBigInt(polyKey32.subarray(16, 32));
  let acc = 0n;

  const feedChunk = (chunk: Uint8Array) => {
    // RFC 8439 §2.8 zero-pads aad & ciphertext to 16-byte blocks, so every block sets bit 128.
    const val = bytesLeToBigInt(chunk) + (1n << 128n);
    acc = ((acc + val) * r) % POLY1305_P;
  };

  for (let i = 0; i < aad.length; i += 16) {
    feedChunk(aad.subarray(i, Math.min(i + 16, aad.length)));
  }
  for (let i = 0; i < ctLen; i += 16) {
    feedChunk(ct.subarray(ctOff + i, ctOff + Math.min(i + 16, ctLen)));
  }

  const lenBlock = new Uint8Array(16);
  const lenDv = new DataView(lenBlock.buffer);
  lenDv.setBigUint64(0, BigInt(aad.length), true);
  lenDv.setBigUint64(8, BigInt(ctLen), true);
  feedChunk(lenBlock);

  const tagInt = (acc + s) & POLY1305_MASK_128;
  return bigIntToBytesLe(tagInt, 16);
}

export function chacha20Poly1305Encrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array = new Uint8Array(0)
): Uint8Array {
  if (key.length !== KEY_SIZE || nonce.length !== NONCE_SIZE) {
    throw new RangeError('ChaCha20-Poly1305 requires 32-byte key and 12-byte nonce.');
  }
  const polyBlock = new Uint8Array(64);
  chacha20BlockInto(key, 0, nonce, polyBlock);
  const polyKey = polyBlock.subarray(0, 32);

  const out = new Uint8Array(plaintext.length + TAG_SIZE);
  chacha20XorInto(key, nonce, plaintext, 0, out, 0, plaintext.length);
  const tag = poly1305AeadTag(polyKey, aad, out, 0, plaintext.length);
  out.set(tag, plaintext.length);
  zeroize(polyBlock);
  zeroize(tag);
  return out;
}

export function chacha20Poly1305Decrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertextAndTag: Uint8Array,
  aad: Uint8Array = new Uint8Array(0)
): Uint8Array | null {
  if (key.length !== KEY_SIZE || nonce.length !== NONCE_SIZE || ciphertextAndTag.length < TAG_SIZE) {
    return null;
  }
  const ctLen = ciphertextAndTag.length - TAG_SIZE;
  const polyBlock = new Uint8Array(64);
  chacha20BlockInto(key, 0, nonce, polyBlock);
  const polyKey = polyBlock.subarray(0, 32);
  const computedTag = poly1305AeadTag(polyKey, aad, ciphertextAndTag, 0, ctLen);
  const expectedTag = ciphertextAndTag.subarray(ctLen, ciphertextAndTag.length);
  zeroize(polyBlock);

  const ok = constantTimeEqual(computedTag, expectedTag);
  zeroize(computedTag);
  if (!ok) {
    return null;
  }
  const pt = new Uint8Array(ctLen);
  chacha20XorInto(key, nonce, ciphertextAndTag, 0, pt, 0, ctLen);
  return pt;
}

// =====================================================================
// RFC 6479 128-bit Sliding Window Replay Guard
// =====================================================================
export class SlidingWindowReplayGuard {
  private readonly windowSize: bigint;
  private maxSeq = 0n;
  private bitmap = 0n;
  private initialized = false;

  constructor(windowSize = 128) {
    this.windowSize = BigInt(windowSize);
  }

  canAccept(seq: number): boolean {
    if (!Number.isInteger(seq) || seq <= 0) return false;
    const s = BigInt(seq);
    if (!this.initialized) return true;
    const diff = s - this.maxSeq;
    if (diff > 0n) return true;
    const absDiff = -diff;
    if (absDiff >= this.windowSize) return false;
    return (this.bitmap & (1n << absDiff)) === 0n;
  }

  validateAndUpdate(seq: number): boolean {
    if (!this.canAccept(seq)) return false;
    const s = BigInt(seq);
    if (!this.initialized) {
      this.maxSeq = s;
      this.bitmap = 1n;
      this.initialized = true;
      return true;
    }
    const diff = s - this.maxSeq;
    if (diff > 0n) {
      this.bitmap = diff < this.windowSize ? (this.bitmap << diff) | 1n : 1n;
      this.maxSeq = s;
      this.bitmap &= (1n << this.windowSize) - 1n;
    } else {
      this.bitmap |= 1n << -diff;
    }
    return true;
  }
}

// =====================================================================
// WEB CRYPTO VAULT (CST_ECDH_V2 + Mutual ECDH + AEAD Framing)
// =====================================================================
export class WebCryptoVault {
  private psk: Uint8Array;
  private cliPriv: Uint8Array;
  private cliPub: Uint8Array;
  private cliNonceN1: Uint8Array;
  private mutualChallenge: Uint8Array;
  private kSend: Uint8Array | null = null;
  private kRecv: Uint8Array | null = null;
  private txSeq = 0;
  private replayGuard = new SlidingWindowReplayGuard(128);
  private _keysReady = false;
  private _established = false;
  private _closed = false;

  constructor(preSharedKey: string | Uint8Array) {
    const raw = typeof preSharedKey === 'string' ? UTF8_ENCODER.encode(preSharedKey.trim()) : preSharedKey.slice();
    if (raw.length === 0) {
      throw new Error('Pre-shared key (PSK) cannot be empty.');
    }
    this.psk = raw;
    const kp = generateX25519Keypair();
    this.cliPriv = kp.priv;
    this.cliPub = kp.pub;
    this.cliNonceN1 = randomBytes(SALT_SIZE);
    this.mutualChallenge = randomBytes(SALT_SIZE);
  }

  get isKeysReady(): boolean {
    return this._keysReady && !this._closed;
  }

  get isEstablished(): boolean {
    return this._established && !this._closed;
  }

  /** Builds 34-byte mutual-auth vault initiation payload (`INIT_ECDH_VAULT_M:` + 16B challenge). */
  createMutualInitPayload(): Uint8Array<ArrayBuffer> {
    return concatBytes(MUTUAL_INIT_PREFIX, this.mutualChallenge);
  }

  /**
   * Verifies host ECDH challenge (91-byte mutual OR 59-byte legacy) and returns 80-byte response:
   * [32B CLIENT_PUB] [16B CLIENT_NONCE_N1] [32B HMAC_PROOF].
   */
  processHostChallenge(hostChallengePayload: Uint8Array): Uint8Array<ArrayBuffer> | null {
    if (this._closed || this._keysReady) {
      return null;
    }
    let core59: Uint8Array;
    if (hostChallengePayload.length === 91) {
      core59 = hostChallengePayload.subarray(0, 59);
      const hostMac = hostChallengePayload.subarray(59, 91);
      const macInput = concatBytes(MUTUAL_CHAL_TAG, this.mutualChallenge, core59);
      const expectedMac = hmacSha256(this.psk, macInput);
      zeroize(macInput);
      const valid = constantTimeEqual(hostMac, expectedMac);
      zeroize(expectedMac);
      if (!valid) {
        return null;
      }
    } else if (hostChallengePayload.length === 59) {
      core59 = hostChallengePayload;
    } else {
      return null;
    }

    if (!constantTimeEqual(core59.subarray(0, 11), PROTOCOL_MAGIC)) {
      return null;
    }
    const hostPub = core59.subarray(11, 43);
    const hostNonceN2 = core59.subarray(43, 59);

    const shared = x25519(this.cliPriv, hostPub);
    let nonZero = 0;
    for (let i = 0; i < shared.length; i++) nonZero |= shared[i];
    if (nonZero === 0) {
      zeroize(shared);
      return null;
    }

    const proofData = concatBytes(PROTOCOL_MAGIC, hostPub, this.cliPub, this.cliNonceN1, hostNonceN2);
    const clientHmac = hmacSha256(this.psk, proofData);
    zeroize(proofData);

    const salt = concatBytes(this.cliNonceN1, hostNonceN2);
    this.kSend = hkdfSha256(salt, shared, CTX_CLIENT_TX, KEY_SIZE);
    this.kRecv = hkdfSha256(salt, shared, CTX_HOST_TX, KEY_SIZE);
    zeroize(shared);
    zeroize(salt);
    zeroize(this.cliPriv);

    this._keysReady = true;
    return concatBytes(this.cliPub, this.cliNonceN1, clientHmac);
  }

  confirmEstablished(): void {
    if (!this._closed && this._keysReady) {
      this._established = true;
    }
  }

  encryptFrame(
    plaintext: Uint8Array,
    aad: Uint8Array = new Uint8Array(0),
    forcedSeq?: number
  ): { framedPayload: Uint8Array; seq: number } {
    if (this._closed || !this._keysReady || !this.kSend) {
      throw new Error('WebCryptoVault is not initialized.');
    }
    let seq: number;
    if (forcedSeq !== undefined) {
      if (!Number.isInteger(forcedSeq) || forcedSeq <= 0 || forcedSeq <= this.txSeq) {
        throw new RangeError('Sequence number must strictly advance.');
      }
      seq = forcedSeq;
      this.txSeq = seq;
    } else {
      this.txSeq += 1;
      seq = this.txSeq;
    }

    const nonce = new Uint8Array(NONCE_SIZE);
    const dv = new DataView(nonce.buffer);
    dv.setUint32(0, 0, false);
    dv.setBigUint64(4, BigInt(seq), false);

    const ctAndTag = chacha20Poly1305Encrypt(this.kSend, nonce, plaintext, aad);
    return {
      framedPayload: concatBytes(nonce, ctAndTag),
      seq,
    };
  }

  decryptFrame(
    framedPayload: Uint8Array,
    aad: Uint8Array = new Uint8Array(0)
  ): { plaintext: Uint8Array; seq: number } | null {
    if (this._closed || !this._keysReady || !this.kRecv || framedPayload.length < NONCE_SIZE + TAG_SIZE) {
      return null;
    }
    const nonce = framedPayload.subarray(0, NONCE_SIZE);
    const ctAndTag = framedPayload.subarray(NONCE_SIZE);
    const dv = new DataView(nonce.buffer, nonce.byteOffset, NONCE_SIZE);
    const epoch = dv.getUint32(0, false);
    if (epoch !== 0) {
      return null;
    }
    const seqBig = dv.getBigUint64(4, false);
    if (seqBig <= 0n || seqBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    const seq = Number(seqBig);
    if (!this.replayGuard.canAccept(seq)) {
      return null;
    }
    const pt = chacha20Poly1305Decrypt(this.kRecv, nonce, ctAndTag, aad);
    if (pt === null) {
      return null;
    }
    if (!this.replayGuard.validateAndUpdate(seq)) {
      zeroize(pt);
      return null;
    }
    return { plaintext: pt, seq };
  }

  encryptWirePacket(opcode: number, plaintext: Uint8Array, forcedSeq?: number): Uint8Array<ArrayBuffer> {
    if (this._closed || !this._keysReady || !this.kSend) {
      throw new Error('WebCryptoVault is not initialized.');
    }
    let seq: number;
    if (forcedSeq !== undefined) {
      if (!Number.isInteger(forcedSeq) || forcedSeq <= 0 || forcedSeq <= this.txSeq) {
        throw new RangeError('Sequence number must strictly advance.');
      }
      seq = forcedSeq;
      this.txSeq = seq;
    } else {
      this.txSeq += 1;
      seq = this.txSeq;
    }

    const wireLen = NONCE_SIZE + plaintext.length + TAG_SIZE;
    const out = new Uint8Array(HEADER_SIZE + wireLen);
    const dv = new DataView(out.buffer);
    out[0] = MAGIC_BYTE_0;
    out[1] = MAGIC_BYTE_1;
    out[2] = opcode & 0xff;
    out[3] = 0x02;
    dv.setUint32(4, seq >>> 0, false);
    dv.setUint32(8, wireLen >>> 0, false);
    dv.setUint32(12, 0, false);
    dv.setBigUint64(16, BigInt(seq), false);

    const aad = out.subarray(0, HEADER_SIZE);
    const nonce = out.subarray(HEADER_SIZE, HEADER_SIZE + NONCE_SIZE);
    const ctAndTag = chacha20Poly1305Encrypt(this.kSend, nonce, plaintext, aad);
    out.set(ctAndTag, HEADER_SIZE + NONCE_SIZE);
    return out;
  }

  decryptWirePacket(rawWireFrame: Uint8Array): { opcode: number; flags: number; seq: number; plaintext: Uint8Array } | null {
    if (rawWireFrame.length < HEADER_SIZE + NONCE_SIZE + TAG_SIZE) {
      return null;
    }
    if (rawWireFrame[0] !== MAGIC_BYTE_0 || rawWireFrame[1] !== MAGIC_BYTE_1) {
      return null;
    }
    const flags = rawWireFrame[3];
    if ((flags & 0x02) === 0) {
      return null;
    }
    const dv = new DataView(rawWireFrame.buffer, rawWireFrame.byteOffset, rawWireFrame.byteLength);
    const opcode = dv.getUint8(2);
    const wireSeq = dv.getUint32(4, false);
    const wireLen = dv.getUint32(8, false);
    if (rawWireFrame.length !== HEADER_SIZE + wireLen) {
      return null;
    }
    const aad = rawWireFrame.subarray(0, HEADER_SIZE);
    const payload = rawWireFrame.subarray(HEADER_SIZE);
    const dec = this.decryptFrame(payload, aad);
    if (!dec) {
      return null;
    }
    return { opcode, flags, seq: wireSeq, plaintext: dec.plaintext };
  }

  close(): void {
    this._closed = true;
    this._established = false;
    this._keysReady = false;
    zeroize(this.psk);
    zeroize(this.cliPriv);
    zeroize(this.cliNonceN1);
    zeroize(this.mutualChallenge);
    zeroize(this.kSend);
    zeroize(this.kRecv);
    this.kSend = null;
    this.kRecv = null;
  }
}

// =====================================================================
// CST-PAIR-X25519-V1 ENCRYPTED PIN ONBOARDING
// =====================================================================
export interface EncryptedPairSession {
  priv: Uint8Array;
  pub: Uint8Array;
  cliNonce: Uint8Array;
  pairKey?: Uint8Array;
  aad?: Uint8Array;
}

export function createEncryptedPairInit(deviceLabel: string): {
  session: EncryptedPairSession;
  message: { action: 'PAIR_INIT'; client_pub: string; client_nonce: string; device: string };
} {
  const { priv, pub } = generateX25519Keypair();
  const cliNonce = randomBytes(SALT_SIZE);
  return {
    session: { priv, pub, cliNonce },
    message: {
      action: 'PAIR_INIT',
      client_pub: toBase64(pub),
      client_nonce: toBase64(cliNonce),
      device: deviceLabel,
    },
  };
}

export function createEncryptedPairFinish(
  session: EncryptedPairSession,
  hostPubB64: string,
  hostNonceB64: string,
  pin: string,
  deviceLabel: string
): { action: 'PAIR_FINISH'; ciphertext: string; device: string } | null {
  const srvPub = fromBase64(hostPubB64);
  const srvNonce = fromBase64(hostNonceB64);
  if (srvPub.length !== 32 || srvNonce.length !== 16) {
    return null;
  }
  const shared = x25519(session.priv, srvPub);
  let nonZero = 0;
  for (let i = 0; i < shared.length; i++) nonZero |= shared[i];
  if (nonZero === 0) {
    zeroize(shared);
    return null;
  }
  zeroize(session.priv);

  const salt = concatBytes(session.cliNonce, srvNonce);
  const info = UTF8_ENCODER.encode('CST_PAIR_WRAP_V1');
  const pairKey = hkdfSha256(salt, shared, info, KEY_SIZE);
  zeroize(shared);
  zeroize(salt);

  const prefix = UTF8_ENCODER.encode('CST_PAIR_V1');
  const aad = concatBytes(prefix, session.pub, srvPub, session.cliNonce, srvNonce);
  session.pairKey = pairKey;
  session.aad = aad;

  const clientNonce = new Uint8Array(NONCE_SIZE); // 0x00 * 12
  const plaintext = UTF8_ENCODER.encode(JSON.stringify({ pin: pin.trim(), device: deviceLabel }));
  const ctAndTag = chacha20Poly1305Encrypt(pairKey, clientNonce, plaintext, aad);
  zeroize(plaintext);
  const wrapped = concatBytes(clientNonce, ctAndTag);

  return {
    action: 'PAIR_FINISH',
    ciphertext: toBase64(wrapped),
    device: deviceLabel,
  };
}

export function decryptEncryptedPairResult(
  session: EncryptedPairSession,
  ciphertextB64: string
): { pairingToken?: string; event?: string; [key: string]: unknown } | null {
  if (!session.pairKey || !session.aad) return null;
  const rawCt = fromBase64(ciphertextB64);
  if (rawCt.length < NONCE_SIZE + TAG_SIZE) return null;

  const expectedNonce = new Uint8Array(NONCE_SIZE);
  const ndv = new DataView(expectedNonce.buffer);
  ndv.setUint32(0, 0, false);
  ndv.setBigUint64(4, 1n, false);

  const gotNonce = rawCt.subarray(0, NONCE_SIZE);
  if (!constantTimeEqual(gotNonce, expectedNonce)) {
    return null;
  }
  const pt = chacha20Poly1305Decrypt(session.pairKey, gotNonce, rawCt.subarray(NONCE_SIZE), session.aad);
  if (pt === null) return null;

  try {
    const parsed = JSON.parse(UTF8_DECODER.decode(pt));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  } finally {
    zeroize(pt);
  }
}

export function destroyEncryptedPairSession(session?: EncryptedPairSession | null): void {
  if (!session) return;
  zeroize(session.priv);
  zeroize(session.cliNonce);
  zeroize(session.pairKey);
}
