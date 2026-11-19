/**
 * AI NetController - Cryptographic Vault, Python Interop & SSRF Guard Verification Suite
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  x25519,
  chacha20Poly1305Encrypt,
  chacha20Poly1305Decrypt,
  SlidingWindowReplayGuard,
  WebCryptoVault,
  createEncryptedPairInit,
  createEncryptedPairFinish,
  decryptEncryptedPairResult,
  destroyEncryptedPairSession,
  toBase64,
  fromBase64,
} from '../utils/cryptoVault.ts';
import { validateLanAgentHost } from '../utils/networkGuard.ts';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, suite: string, detail: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${suite}: ${detail}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${suite}: ${detail}`);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function resolvePythonBin(): string {
  const repoRoot = process.cwd();
  const winVenv = path.join(repoRoot, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(winVenv)) return winVenv;
  const posixVenv = path.join(repoRoot, '.venv', 'bin', 'python');
  if (fs.existsSync(posixVenv)) return posixVenv;
  return process.platform === 'win32' ? 'python' : 'python3';
}

console.log('================================================================');
console.log('  AI NetController - Crypto Vault & Security Verification');
console.log('================================================================\n');

// 1. RFC 7748 Section 6.1 X25519 Test Vector
{
  const alicePriv = hexToBytes('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const expectedAlicePub = '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a';
  const bobPriv = hexToBytes('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  const expectedBobPub = 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f';
  const expectedShared = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';

  const basePoint = new Uint8Array(32);
  basePoint[0] = 9;
  const alicePub = x25519(alicePriv, basePoint);
  const bobPub = x25519(bobPriv, basePoint);
  const sharedA = x25519(alicePriv, bobPub);
  const sharedB = x25519(bobPriv, alicePub);

  assert(
    bytesToHex(alicePub) === expectedAlicePub &&
      bytesToHex(bobPub) === expectedBobPub &&
      bytesToHex(sharedA) === expectedShared &&
      bytesToHex(sharedB) === expectedShared,
    'RFC 7748 X25519',
    'Public key generation and shared secret derivation match RFC 7748 §6.1 bit-for-bit'
  );
}

// 2. RFC 8439 Section 2.8.2 ChaCha20-Poly1305 AEAD Vector + Tamper Rejection
{
  const key = hexToBytes('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
  const nonce = hexToBytes('070000004041424344454647');
  const aad = hexToBytes('50515253c0c1c2c3c4c5c6c7');
  const ptText = "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.";
  const pt = new TextEncoder().encode(ptText);

  const expectedCtHex =
    'd31a8d34648e60db7b86afbc53ef7ec2' +
    'a4aded51296e08fea9e2b5a736ee62d6' +
    '3dbea45e8ca9671282fafb69da92728b' +
    '1a71de0a9e060b2905d6a5b67ecd3b36' +
    '92ddbd7f2d778b8c9803aee328091b58' +
    'fab324e4fad675945585808b4831d7bc' +
    '3ff4def08e4b7a9de576d26586cec64b' +
    '6116';
  const expectedTagHex = '1ae10b594f09e26a7e902ecbd0600691';

  const ctAndTag = chacha20Poly1305Encrypt(key, nonce, pt, aad);
  const ctHex = bytesToHex(ctAndTag.subarray(0, pt.length));
  const tagHex = bytesToHex(ctAndTag.subarray(pt.length));
  const decrypted = chacha20Poly1305Decrypt(key, nonce, ctAndTag, aad);

  const tamperedCt = ctAndTag.slice();
  tamperedCt[10] ^= 0x01;
  const tamperedAad = aad.slice();
  tamperedAad[0] ^= 0x01;

  assert(
    ctHex === expectedCtHex &&
      tagHex === expectedTagHex &&
      decrypted !== null &&
      new TextDecoder().decode(decrypted) === ptText &&
      chacha20Poly1305Decrypt(key, nonce, tamperedCt, aad) === null &&
      chacha20Poly1305Decrypt(key, nonce, ctAndTag, tamperedAad) === null,
    'RFC 8439 ChaCha20-Poly1305',
    'AEAD encryption, decryption, and ciphertext/AAD tamper rejection match RFC 8439 §2.8.2'
  );
}

// 3. RFC 6479 Sliding Window Replay Guard
{
  const guard = new SlidingWindowReplayGuard(128);
  const okInit = guard.validateAndUpdate(1) && guard.validateAndUpdate(2) && guard.validateAndUpdate(5);
  const okOod = guard.canAccept(3) && guard.validateAndUpdate(3);
  const dupRejected = !guard.canAccept(3) && !guard.validateAndUpdate(3);
  const zeroRejected = !guard.validateAndUpdate(0);
  const jumpOk = guard.validateAndUpdate(200);
  const staleRejected = !guard.canAccept(50) && !guard.validateAndUpdate(50);

  assert(
    okInit && okOod && dupRejected && zeroRejected && jumpOk && staleRejected,
    'SlidingWindowReplayGuard',
    'Allows out-of-order packets in window while blocking duplicates, seq 0, and stale packets'
  );
}

// 4. Cross-Language TS WebCryptoVault <-> Python HostCryptoVault & CST-PAIR-X25519-V1 Interop
{
  const pyBin = resolvePythonBin();
  const psk = 'interop_test_psk_0123456789abcdef';
  const vault = new WebCryptoVault(psk);
  const initPayload = vault.createMutualInitPayload();

  const pairSession = createEncryptedPairInit('WebInteropHarness');
  const pin = '654321';

  const pyStep1Script = `
import base64, hashlib, hmac, json, os, secrets, struct, sys
sys.path.insert(0, os.path.join(os.getcwd(), "agent"))
from crypto_vault import (
    HostCryptoVault,
    FallbackCurve25519,
    FallbackChaCha20Poly1305,
    hkdf_extract_and_expand,
)

req = json.loads(sys.stdin.read())
psk = req["psk"].encode("utf-8")
init_bytes = base64.b64decode(req["init_b64"])
assert init_bytes[:18] == b"INIT_ECDH_VAULT_M:", "Bad mutual init prefix"
cli_chal = init_bytes[18:34]

# Save deterministic host state across step via exported priv/n2 (or complete inline using deterministic second step)
hv = HostCryptoVault(psk)
core59 = hv.create_handshake_challenge()
mac = hmac.new(psk, b"CST_HOST_CHAL_M:" + cli_chal + core59, hashlib.sha256).digest()
chal91 = core59 + mac

# Also prepare pairing state
cli_pub = base64.b64decode(req["pair_cli_pub"])
cli_n1 = base64.b64decode(req["pair_cli_nonce"])
srv_priv, srv_pub = FallbackCurve25519.generate_keypair()
srv_n2 = secrets.token_bytes(16)
shared = FallbackCurve25519.compute_shared_secret(srv_priv, cli_pub)
pair_key = hkdf_extract_and_expand(cli_n1 + srv_n2, shared, b"CST_PAIR_WRAP_V1", 32)
pair_aad = b"CST_PAIR_V1" + cli_pub + srv_pub + cli_n1 + srv_n2

# Serialize host secrets transiently to stdin-echoed hex for step 2 in this in-memory test
if hasattr(hv, "_priv_obj") and hv._priv_obj is not None:
    from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption
    hv_priv_bytes = hv._priv_obj.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
else:
    hv_priv_bytes = bytes(hv._priv_bytes)

print(json.dumps({
    "chal91_b64": base64.b64encode(chal91).decode("ascii"),
    "hv_priv_b64": base64.b64encode(hv_priv_bytes).decode("ascii"),
    "hv_pub_b64": base64.b64encode(hv._pub_bytes).decode("ascii"),
    "hv_n2_b64": base64.b64encode(hv.host_nonce_n2).decode("ascii"),
    "pair_host_pub_b64": base64.b64encode(srv_pub).decode("ascii"),
    "pair_host_nonce_b64": base64.b64encode(srv_n2).decode("ascii"),
    "pair_key_b64": base64.b64encode(pair_key).decode("ascii"),
    "pair_aad_b64": base64.b64encode(pair_aad).decode("ascii"),
}))
`;

  const step1Proc = spawnSync(pyBin, ['-c', pyStep1Script], {
    input: JSON.stringify({
      psk,
      init_b64: toBase64(initPayload),
      pair_cli_pub: pairSession.message.client_pub,
      pair_cli_nonce: pairSession.message.client_nonce,
    }),
    encoding: 'utf-8',
    timeout: 8000,
  });

  if (step1Proc.status !== 0) {
    assert(false, 'TS<->Python Interop Step 1', `Python failed: ${step1Proc.stderr || step1Proc.error}`);
  } else {
    const s1 = JSON.parse(step1Proc.stdout.trim());
    const resp80 = vault.processHostChallenge(fromBase64(s1.chal91_b64));
    assert(resp80 !== null && resp80.length === 80, 'TS<->Python ECDH', 'WebCryptoVault verified 91-byte HostCryptoVault mutual MAC and produced 80-byte response');

    if (resp80) {
      vault.confirmEstablished();
      const tsPacket = vault.encryptWirePacket(0x04, new TextEncoder().encode('echo hello-aead'), 1);

      const pairFinish = createEncryptedPairFinish(
        pairSession.session,
        s1.pair_host_pub_b64,
        s1.pair_host_nonce_b64,
        pin,
        'WebInteropHarness'
      );
      assert(pairFinish !== null, 'CST-PAIR-X25519-V1', 'Generated encrypted PAIR_FINISH payload');

      const pyStep2Script = `
import base64, json, os, struct, sys
sys.path.insert(0, os.path.join(os.getcwd(), "agent"))
import crypto_vault as cv

req = json.loads(sys.stdin.read())
psk = req["psk"].encode("utf-8")
hv = cv.HostCryptoVault(psk)
hv_priv_raw = base64.b64decode(req["hv_priv_b64"])
if cv.HAS_CRYPTOGRAPHY_ACCEL:
    from cryptography.hazmat.primitives.asymmetric import x25519
    hv._priv_obj = x25519.X25519PrivateKey.from_private_bytes(hv_priv_raw)
    hv._priv_bytes = None
else:
    hv._priv_bytes = bytearray(hv_priv_raw)
    hv._priv_obj = None
hv._pub_bytes = base64.b64decode(req["hv_pub_b64"])
hv.host_nonce_n2 = base64.b64decode(req["hv_n2_b64"])

ok = hv.complete_handshake(base64.b64decode(req["resp80_b64"]))
assert ok, "HostCryptoVault.complete_handshake failed"

# Decrypt TS packet
ts_raw = base64.b64decode(req["ts_pkt_b64"])
hdr, body = ts_raw[:12], ts_raw[12:]
pt_res = hv.decrypt_frame(body, aad=hdr)
assert pt_res is not None, "HostCryptoVault failed to decrypt TS wire packet"
pt_bytes, pt_seq = pt_res

# Encrypt host wire packet back to TS
reply_pt = b'{"event":"EXECUTION_RESULT","output":"from-python"}'
wire_len = len(reply_pt) + 28
py_seq = hv.tx_seq + 1
py_hdr = struct.pack(">2sBBII", b"\\xc5\\x71", 0x04, 0x02, py_seq, wire_len)
framed, used_seq = hv.encrypt_frame(reply_pt, aad=py_hdr)
assert used_seq == py_seq
py_pkt = py_hdr + framed

# Verify encrypted pairing finish and return encrypted result
pair_key = base64.b64decode(req["pair_key_b64"])
pair_aad = base64.b64decode(req["pair_aad_b64"])
pair_ct = base64.b64decode(req["pair_finish_ct_b64"])
pair_pt = cv.FallbackChaCha20Poly1305.decrypt(pair_key, pair_ct[:12], pair_ct[12:], aad=pair_aad)
assert pair_pt is not None, "PAIR_FINISH decryption failed"
pair_inner = json.loads(pair_pt.decode("utf-8"))
assert pair_inner["pin"] == "${pin}", "PIN mismatch"

res_obj = json.dumps({
    "event": "AUTHENTICATED",
    "pairingToken": "ainet_interop_token_xyz",
}).encode("utf-8")
res_nonce = struct.pack(">IQ", 0, 1)
pair_res_ct = res_nonce + cv.FallbackChaCha20Poly1305.encrypt(pair_key, res_nonce, res_obj, aad=pair_aad)

print(json.dumps({
    "ts_plaintext": pt_bytes.decode("utf-8"),
    "ts_seq": pt_seq,
    "py_pkt_b64": base64.b64encode(py_pkt).decode("ascii"),
    "pair_res_b64": base64.b64encode(pair_res_ct).decode("ascii"),
}))
`;

      const step2Proc = spawnSync(pyBin, ['-c', pyStep2Script], {
        input: JSON.stringify({
          psk,
          hv_priv_b64: s1.hv_priv_b64,
          hv_pub_b64: s1.hv_pub_b64,
          hv_n2_b64: s1.hv_n2_b64,
          resp80_b64: toBase64(resp80),
          ts_pkt_b64: toBase64(tsPacket),
          pair_key_b64: s1.pair_key_b64,
          pair_aad_b64: s1.pair_aad_b64,
          pair_finish_ct_b64: pairFinish?.ciphertext || '',
        }),
        encoding: 'utf-8',
        timeout: 8000,
      });

      if (step2Proc.status !== 0) {
        assert(false, 'TS<->Python Interop Step 2', `Python failed: ${step2Proc.stderr || step2Proc.error}`);
      } else {
        const s2 = JSON.parse(step2Proc.stdout.trim());
        const pyPktBytes = fromBase64(s2.py_pkt_b64);
        const decTs = vault.decryptWirePacket(pyPktBytes);
        const tamperPy = pyPktBytes.slice();
        tamperPy[tamperPy.length - 1] ^= 0x80;
        const tamperRes = vault.decryptWirePacket(tamperPy);
        const replayRes = vault.decryptWirePacket(pyPktBytes);

        const pairResult = decryptEncryptedPairResult(pairSession.session, s2.pair_res_b64);

        assert(
          s2.ts_plaintext === 'echo hello-aead' &&
            s2.ts_seq === 1 &&
            decTs !== null &&
            decTs.opcode === 0x04 &&
            new TextDecoder().decode(decTs.plaintext).includes('from-python') &&
            tamperRes === null &&
            replayRes === null,
          'TS<->Python AEAD Round-Trip',
          'Mutual WebCryptoVault <-> HostCryptoVault AEAD encryption, decryption, tamper block, and anti-replay verified'
        );

        assert(
          pairResult !== null && pairResult.pairingToken === 'ainet_interop_token_xyz',
          'CST-PAIR-X25519-V1 Interop',
          'End-to-end encrypted PIN pairing round-trip with Python daemon crypto verified'
        );
      }
    }
  }

  vault.close();
  destroyEncryptedPairSession(pairSession.session);
}

// 5. SSRF Guard Tests (validateLanAgentHost)
{
  const validHosts = [
    '127.0.0.1',
    'localhost',
    '192.168.1.50',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.254',
    '::1',
    '[::1]',
    'fd12:3456:789a::1',
    '::ffff:192.168.1.10',
  ];
  const invalidHosts = [
    '169.254.169.254',
    '0.0.0.0',
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '100.64.0.1',
    '224.0.0.1',
    'evil.com',
    '127.0.0.1@evil.com',
    '127.0.0.1/path',
    '0177.0.0.1',
    'fe80::1',
  ];

  const badValid = validHosts.filter((h) => !validateLanAgentHost(h).ok);
  const badInvalid = invalidHosts.filter((h) => validateLanAgentHost(h).ok);

  assert(
    badValid.length === 0 && badInvalid.length === 0,
    'SSRF Guard (validateLanAgentHost)',
    `Accepted all ${validHosts.length} LAN/loopback hosts and rejected all ${invalidHosts.length} non-LAN/injected targets`
  );
}

console.log('\n================================================================');
console.log(`  RESULT: ${passedTests}/${totalTests} checks passed`);
console.log('================================================================');
if (failedTests > 0) {
  process.exit(1);
}
