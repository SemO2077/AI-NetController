/**
 * Pure TypeScript RFC 7748 (X25519) + RFC 5869 (HKDF-SHA256) + RFC 8439 (ChaCha20-Poly1305)
 * Works identically across secure HTTPS/localhost and LAN HTTP contexts (zero crypto.subtle dependency).
 */

const P25519 = (1n << 255n) - 19n;
const A24 = 121665n;

function mod(a: bigint, m: bigint = P25519): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = mod(base, modulus);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let res = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    res = (res << 8n) | BigInt(bytes[i]);
  }
  return res;
}

function bigIntToBytesLE(val: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  let v = val;
  for (let i = 0; i < len; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function randomBytes(len: number): Uint8Array {
  const buf = new Uint8Array(len);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(buf);
  } else {
    throw new Error('CSPRNG crypto.getRandomValues is unavailable');
  }
  return buf;
}

export function zeroize(buf: Uint8Array): void {
  buf.fill(0);
}

export function x25519ScalarMult(scalar: Uint8Array, uBytes: Uint8Array): Uint8Array {
  if (scalar.length !== 32 || uBytes.length !== 32) {
    throw new Error('X25519 inputs must be 32 bytes');
  }
  const clamped = new Uint8Array(scalar);
  clamped[0] &= 248;
  clamped[31] &= 127;
  clamped[31] |= 64;

  const k = bytesToBigIntLE(clamped);
  const mask255 = (1n << 255n) - 1n;
  const u = mod(bytesToBigIntLE(uBytes) & mask255, P25519);

  let x1 = u;
  let x2 = 1n;
  let z2 = 0n;
  let x3 = u;
  let z3 = 1n;
  let swap = 0n;

  for (let t = 254n; t >= 0n; t--) {
    const kt = (k >> t) & 1n;
    swap ^= kt;
    if (swap !== 0n) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }
    swap = kt;

    const a = mod(x2 + z2);
    const aa = mod(a * a);
    const b = mod(x2 - z2);
    const bb = mod(b * b);
    const e = mod(aa - bb);
    const c = mod(x3 + z3);
    const d = mod(x3 - z3);
    const da = mod(d * a);
    const cb = mod(c * b);
    x3 = mod((da + cb) * (da + cb));
    z3 = mod(x1 * mod((da - cb) * (da - cb)));
    x2 = mod(aa * bb);
    z2 = mod(e * mod(aa + A24 * e));
  }

  if (swap !== 0n) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }

  const res = mod(x2 * modPow(z2, P25519 - 2n, P25519));
  zeroize(clamped);
  return bigIntToBytesLE(res, 32);
}

export function x25519GenerateKeypair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = randomBytes(32);
  const basePoint = new Uint8Array(32);
  basePoint[0] = 9;
  const publicKey = x25519ScalarMult(privateKey, basePoint);
  return { privateKey, publicKey };
}

// ============================================================================
// Pure TypeScript SHA-256 + HMAC-SHA256 + HKDF-SHA256
// ============================================================================
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

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256(data: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const bitLen = data.length * 8;
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(off + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, h0, false); outDv.setUint32(4, h1, false);
  outDv.setUint32(8, h2, false); outDv.setUint32(12, h3, false);
  outDv.setUint32(16, h4, false); outDv.setUint32(20, h5, false);
  outDv.setUint32(24, h6, false); outDv.setUint32(28, h7, false);
  return out;
}

export function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const blockSize = 64;
  const k = new Uint8Array(blockSize);
  if (key.length > blockSize) {
    k.set(sha256(key));
  } else {
    k.set(key);
  }
  const oPad = new Uint8Array(blockSize + 32);
  const iPad = new Uint8Array(blockSize + msg.length);
  for (let i = 0; i < blockSize; i++) {
    oPad[i] = k[i] ^ 0x5c;
    iPad[i] = k[i] ^ 0x36;
  }
  iPad.set(msg, blockSize);
  const inner = sha256(iPad);
  oPad.set(inner, blockSize);
  return sha256(oPad);
}

export function hkdfSha256(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  const actualSalt = salt.length > 0 ? salt : new Uint8Array(32);
  const prk = hmacSha256(actualSalt, ikm);
  const blocks = Math.ceil(length / 32);
  const okm = new Uint8Array(blocks * 32);
  let prev: Uint8Array = new Uint8Array(0);
  for (let i = 1; i <= blocks; i++) {
    const inp = new Uint8Array(prev.length + info.length + 1);
    inp.set(prev, 0);
    inp.set(info, prev.length);
    inp[prev.length + info.length] = i;
    prev = hmacSha256(prk, inp);
    okm.set(prev, (i - 1) * 32);
  }
  zeroize(prk);
  return okm.slice(0, length);
}

// ============================================================================
// Pure TypeScript RFC 8439 ChaCha20-Poly1305 AEAD
// ============================================================================
function rotl32(v: number, c: number): number {
  return ((v << c) | (v >>> (32 - c))) >>> 0;
}

function readLe32(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

function writeLe32(b: Uint8Array, off: number, v: number): void {
  b[off] = v & 0xff;
  b[off + 1] = (v >>> 8) & 0xff;
  b[off + 2] = (v >>> 16) & 0xff;
  b[off + 3] = (v >>> 24) & 0xff;
}

function chacha20Block(key: Uint8Array, counter: number, nonce: Uint8Array): Uint8Array {
  const state = new Uint32Array(16);
  state[0] = 0x61707865;
  state[1] = 0x3320646e;
  state[2] = 0x79622d32;
  state[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) state[4 + i] = readLe32(key, i * 4);
  state[12] = counter >>> 0;
  state[13] = readLe32(nonce, 0);
  state[14] = readLe32(nonce, 4);
  state[15] = readLe32(nonce, 8);

  const w = new Uint32Array(state);
  const qr = (a: number, b: number, c: number, d: number) => {
    w[a] = (w[a] + w[b]) >>> 0; w[d] = rotl32(w[d] ^ w[a], 16);
    w[c] = (w[c] + w[d]) >>> 0; w[b] = rotl32(w[b] ^ w[c], 12);
    w[a] = (w[a] + w[b]) >>> 0; w[d] = rotl32(w[d] ^ w[a], 8);
    w[c] = (w[c] + w[d]) >>> 0; w[b] = rotl32(w[b] ^ w[c], 7);
  };
  for (let i = 0; i < 10; i++) {
    qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
    qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    writeLe32(out, i * 4, (w[i] + state[i]) >>> 0);
  }
  return out;
}

const POLY1305_P = (1n << 130n) - 5n;

function poly1305Mac(polyKey: Uint8Array, data: Uint8Array): Uint8Array {
  const rBytes = new Uint8Array(polyKey.subarray(0, 16));
  rBytes[3] &= 15; rBytes[7] &= 15; rBytes[11] &= 15; rBytes[15] &= 15;
  rBytes[4] &= 252; rBytes[8] &= 252; rBytes[12] &= 252;
  const r = bytesToBigIntLE(rBytes);
  const s = bytesToBigIntLE(polyKey.subarray(16, 32));

  let acc = 0n;
  for (let off = 0; off < data.length; off += 16) {
    const chunk = data.subarray(off, Math.min(off + 16, data.length));
    const n = bytesToBigIntLE(chunk) + (1n << BigInt(8 * chunk.length));
    acc = ((acc + n) * r) % POLY1305_P;
  }
  const tagVal = (acc + s) & ((1n << 128n) - 1n);
  return bigIntToBytesLE(tagVal, 16);
}

function buildPoly1305AeadInput(aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const pad16 = (n: number) => (n % 16 === 0 ? 0 : 16 - (n % 16));
  const aadPad = pad16(aad.length);
  const ctPad = pad16(ciphertext.length);
  const total = aad.length + aadPad + ciphertext.length + ctPad + 16;
  const buf = new Uint8Array(total);
  let pos = 0;
  buf.set(aad, pos); pos += aad.length + aadPad;
  buf.set(ciphertext, pos); pos += ciphertext.length + ctPad;
  writeLe32(buf, pos, aad.length >>> 0);
  writeLe32(buf, pos + 4, Math.floor(aad.length / 0x100000000));
  writeLe32(buf, pos + 8, ciphertext.length >>> 0);
  writeLe32(buf, pos + 12, Math.floor(ciphertext.length / 0x100000000));
  return buf;
}

export function chacha20Poly1305Encrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array = new Uint8Array(0)
): Uint8Array {
  const polyKey = chacha20Block(key, 0, nonce).subarray(0, 32);
  const ct = new Uint8Array(plaintext.length);
  let ctr = 1;
  for (let off = 0; off < plaintext.length; off += 64) {
    const ks = chacha20Block(key, ctr++, nonce);
    const take = Math.min(64, plaintext.length - off);
    for (let i = 0; i < take; i++) {
      ct[off + i] = plaintext[off + i] ^ ks[i];
    }
  }
  const macInput = buildPoly1305AeadInput(aad, ct);
  const tag = poly1305Mac(polyKey, macInput);
  const out = new Uint8Array(ct.length + 16);
  out.set(ct, 0);
  out.set(tag, ct.length);
  return out;
}

export function chacha20Poly1305Decrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertextAndTag: Uint8Array,
  aad: Uint8Array = new Uint8Array(0)
): Uint8Array | null {
  if (ciphertextAndTag.length < 16) return null;
  const ctLen = ciphertextAndTag.length - 16;
  const ct = ciphertextAndTag.subarray(0, ctLen);
  const tag = ciphertextAndTag.subarray(ctLen);
  const polyKey = chacha20Block(key, 0, nonce).subarray(0, 32);
  const macInput = buildPoly1305AeadInput(aad, ct);
  const expectedTag = poly1305Mac(polyKey, macInput);
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= expectedTag[i] ^ tag[i];
  if (diff !== 0) return null;

  const pt = new Uint8Array(ctLen);
  let ctr = 1;
  for (let off = 0; off < ctLen; off += 64) {
    const ks = chacha20Block(key, ctr++, nonce);
    const take = Math.min(64, ctLen - off);
    for (let i = 0; i < take; i++) {
      pt[off + i] = ct[off + i] ^ ks[i];
    }
  }
  return pt;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of arrays) {
    out.set(a, pos);
    pos += a.length;
  }
  return out;
}
