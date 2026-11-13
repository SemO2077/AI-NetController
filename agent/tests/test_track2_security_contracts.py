"""
Track 2 Regression Tests: Security, Protocol, Crypto & Agent Hardening Contracts
================================================================================
Exercises the real implementations in agent/ without mutating Windows Registry,
user Desktop/Start Menu shortcuts, or host executables.
"""

import asyncio
import hashlib
import hmac
import json
import os
import secrets
import struct
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_AGENT_DIR = os.path.dirname(_TEST_DIR)
_REPO_ROOT = os.path.dirname(_AGENT_DIR)
if _AGENT_DIR not in sys.path:
    sys.path.append(_AGENT_DIR)
if _REPO_ROOT in sys.path:
    sys.path.remove(_REPO_ROOT)
sys.path.insert(0, _REPO_ROOT)

import agent.agent as agent_mod
from command_ast_firewall import CommandASTFirewall
from crypto_handshake import (
    HANDSHAKE_MAGIC,
    HostCryptoSession,
    PurePythonX25519,
)
from crypto_vault import (
    CTX_HOST_TX,
    PROTOCOL_MAGIC,
    FallbackChaCha20Poly1305,
    FallbackCurve25519,
    HostCryptoVault,
    SlidingWindowReplayProtector,
    hkdf_extract_and_expand,
)
from host_file_writer import (
    CMD_CHUNK,
    CMD_FINISH,
    CMD_INIT,
    HostFileWriter,
    STATUS_COMPLETED,
    STATUS_PROGRESS,
)
from network_fuzzer_shield import (
    ConnectionState,
    MAX_PAYLOAD_SIZE,
    NetworkFuzzerShield,
    OP_FRAME_SYNC,
    OP_TELEMETRY,
)


class _FakeWebSocket:
    def __init__(self, incoming_messages, remote_address=("127.0.0.1", 55123)):
        self._incoming = list(incoming_messages)
        self.remote_address = remote_address
        self.sent = []
        self.closed = []

    async def send(self, data):
        self.sent.append(data)

    async def close(self, code=1000, reason=""):
        self.closed.append((code, reason))

    def __aiter__(self):
        self._idx = 0
        return self

    async def __anext__(self):
        if self._idx >= len(self._incoming):
            raise StopAsyncIteration
        item = self._incoming[self._idx]
        self._idx += 1
        return item


class TestCryptoVaultContracts(unittest.TestCase):
    def test_sliding_window_rejects_non_positive_size(self):
        with self.assertRaises(ValueError):
            SlidingWindowReplayProtector(0)
        with self.assertRaises(ValueError):
            SlidingWindowReplayProtector(-8)

    def test_vault_handshake_exact_length_epoch_zero_and_wire_aad(self):
        psk = secrets.token_bytes(32)
        vault = HostCryptoVault(psk)
        try:
            challenge = vault.create_handshake_challenge()
            # 11B magic + 32B pub + 16B N2 = 59 bytes
            self.assertEqual(len(challenge), 59)
            self.assertTrue(challenge.startswith(PROTOCOL_MAGIC))
            host_pub = challenge[11:43]
            host_n2 = challenge[43:59]

            cli_priv, cli_pub = FallbackCurve25519.generate_keypair()
            cli_n1 = secrets.token_bytes(16)
            proof_data = PROTOCOL_MAGIC + host_pub + cli_pub + cli_n1 + host_n2
            mac = hmac.new(psk, proof_data, hashlib.sha256).digest()
            valid_payload = cli_pub + cli_n1 + mac
            self.assertEqual(len(valid_payload), 80)

            # Trailing bytes rejected (must be exact 80B)
            self.assertFalse(vault.complete_handshake(valid_payload + b"\x00"))
            # Truncated payload rejected
            self.assertFalse(vault.complete_handshake(valid_payload[:-1]))
            # Bad MAC rejected
            self.assertFalse(vault.complete_handshake(cli_pub + cli_n1 + (b"\x00" * 32)))
            # Valid 80B handshake succeeds once
            self.assertTrue(vault.complete_handshake(valid_payload))
            self.assertFalse(vault.complete_handshake(valid_payload))

            # Non-zero nonce epoch (upper 32 bits != 0) must fail decryption
            plaintext = b'{"cpu": 12.5}'
            aad = struct.pack(">2sBBII", b"\xC5\x71", OP_TELEMETRY, 0x02, 1, len(plaintext) + 28)
            enc_frame, seq = vault.encrypt_frame(plaintext, aad=aad)
            self.assertEqual(seq, 1)

            bad_epoch_nonce = struct.pack(">IQ", 1, 1) + enc_frame[12:]
            self.assertIsNone(vault.decrypt_frame(bad_epoch_nonce, aad=aad))

            # Derive client RX key (= host TX) and verify client decrypts host's wire packet
            ss = FallbackCurve25519.compute_shared_secret(cli_priv, host_pub)
            client_rx = hkdf_extract_and_expand(cli_n1 + host_n2, ss, CTX_HOST_TX, 32)
            dec = FallbackChaCha20Poly1305.decrypt(client_rx, enc_frame[:12], enc_frame[12:], aad=aad)
            self.assertEqual(dec, plaintext)
        finally:
            vault.close()


class TestCryptoHandshakeContracts(unittest.TestCase):
    def test_session_exact_length_ttl_low_order_and_reflection_guard(self):
        psk = secrets.token_bytes(32)
        session = HostCryptoSession(psk)
        try:
            challenge = session.create_handshake_challenge()
            # 11B MAGIC + 32B pub + 16B salt + 8B !Q timestamp = 67B
            self.assertEqual(len(challenge), 67)
            self.assertTrue(challenge.startswith(HANDSHAKE_MAGIC))
            host_pub = challenge[11:43]
            salt = challenge[43:59]
            ts_bytes = challenge[59:67]

            cli_priv = PurePythonX25519.generate_private_key()
            cli_pub = PurePythonX25519.public_key_from_private(cli_priv)
            auth_tag = hmac.new(
                psk,
                HANDSHAKE_MAGIC + host_pub + cli_pub + salt + ts_bytes,
                hashlib.sha256,
            ).digest()
            valid_resp = cli_pub + auth_tag
            self.assertEqual(len(valid_resp), 64)

            # Trailing bytes rejected (must be exact 64B)
            self.assertFalse(session.process_handshake_response(valid_resp + b"\x00"))

            # Low-order point (all-zero public key) even with valid HMAC rejected
            low_order_pub = b"\x00" * 32
            low_order_tag = hmac.new(
                psk,
                HANDSHAKE_MAGIC + host_pub + low_order_pub + salt + ts_bytes,
                hashlib.sha256,
            ).digest()
            self.assertFalse(session.process_handshake_response(low_order_pub + low_order_tag))

            # Expired timestamp (>120s) rejected
            with patch.object(session, "handshake_timestamp", int(time.time()) - 300):
                self.assertFalse(session.process_handshake_response(valid_resp))

            # Valid handshake succeeds
            self.assertTrue(session.process_handshake_response(valid_resp))

            # Reflection attack: packet encrypted by host uses 'HOST' sender tag & tx_key -> decrypt_frame rejects
            header_aad = struct.pack(">2sBBII", b"\xC5\x71", 0x04, 0x02, 1, 5)
            host_nonce, host_ct = session.encrypt_frame(header_aad, b"hello")
            with self.assertRaises(ValueError):
                session.decrypt_frame(header_aad, host_nonce, host_ct)
        finally:
            session.close()


class TestASTFirewallContracts(unittest.TestCase):
    def test_evasion_vectors_blocked_and_safe_pipe_allowed(self):
        ok, risk, _, _ = CommandASTFirewall.inspect_and_sanitize("cat$IFS/etc/passwd")
        self.assertFalse(ok)
        self.assertEqual(risk, "BLOCKED")

        ok_m, risk_m, _, _ = CommandASTFirewall.inspect_and_sanitize("python -m http.server")
        self.assertTrue(ok_m)
        self.assertEqual(risk_m, "REQUIRES_BIOMETRIC")

        ok_e, risk_e, _, _ = CommandASTFirewall.inspect_and_sanitize("powershell -e SQBFAFgA")
        self.assertFalse(ok_e)
        self.assertEqual(risk_e, "BLOCKED")

        ok_chain, risk_chain, _, _ = CommandASTFirewall.inspect_and_sanitize("echo hello&&powershell -c id")
        self.assertTrue(ok_chain)
        self.assertEqual(risk_chain, "REQUIRES_BIOMETRIC")

        ok_safe, risk_safe, _, _ = CommandASTFirewall.inspect_and_sanitize("Get-Process | Select-Object -First 10")
        self.assertTrue(ok_safe)
        self.assertEqual(risk_safe, "SAFE")


class TestFuzzerShieldContracts(unittest.TestCase):
    def test_exact_length_max_payload_and_flush_reorder(self):
        shield = NetworkFuzzerShield()

        oversized_hdr = struct.pack("!2sBBII", b"\xC5\x71", 0x01, 0, 1, MAX_PAYLOAD_SIZE + 1)
        trailing_pkt = struct.pack("!2sBBII", b"\xC5\x71", 0x01, 0, 2, 2) + b"hiTRAILING"
        sync_pkt = struct.pack("!2sBBII", b"\xC5\x71", OP_FRAME_SYNC, 0, 3, 0)

        called = []

        async def _async_sync_cb(cid):
            called.append(cid)

        async def _run():
            shield.register_client("c1", lambda: None)
            shield.transition_state("c1", ConnectionState.AUTH_PENDING)
            shield.transition_state("c1", ConnectionState.AUTHENTICATED_STREAMING)
            try:
                self.assertIsNone(await shield.filter_incoming_packet("c1", oversized_hdr))
                self.assertIsNone(await shield.filter_incoming_packet("c1", trailing_pkt))
                await shield.filter_incoming_packet("c1", sync_pkt, on_keyframe_request=_async_sync_cb)
            finally:
                await shield.cleanup_and_scrub("c1")

        asyncio.run(_run())
        self.assertEqual(called, ["c1"])

        shield._reorder_buffer["c1"] = [b"pkt1", b"pkt2"]
        drained = shield.flush_reorder_buffer("c1")
        self.assertEqual(drained, [b"pkt1", b"pkt2"])
        self.assertEqual(shield.flush_reorder_buffer("c1"), [])


class TestHostFileWriterContracts(unittest.TestCase):
    def test_reserved_names_255_cap_duplicate_chunk_accounting_and_abort_all(self):
        with tempfile.TemporaryDirectory(prefix="ainet_fw_test_") as tmp_dir:
            writer = HostFileWriter(download_dir=Path(tmp_dir))

            sanitized_conin = writer._sanitize_filename("CONIN$.txt")
            sanitized_conout = writer._sanitize_filename("conout$")
            self.assertTrue(sanitized_conin.startswith("cst_received_"))
            self.assertTrue(sanitized_conout.startswith("cst_received_"))

            long_name = ("あ" * 120) + ".txt"
            capped = writer._sanitize_filename(long_name)
            self.assertLessEqual(len(capped.encode("utf-8")), 255)
            self.assertTrue(capped.endswith(".txt"))

            data = b"HelloWorld"
            digest = hashlib.sha256(data).hexdigest().encode("ascii")
            tid = 77
            init_pkt = struct.pack("!BIQ", CMD_INIT, tid, len(data)) + digest + b"sample.txt"
            ack_init = writer.handle_packet(init_pkt)
            _, _, seq_init, _ = agent_mod.parse_header(ack_init)
            self.assertEqual(seq_init, 0)

            chunk_pkt = struct.pack("!BIQ", CMD_CHUNK, tid, 0) + data
            ack1 = writer.handle_packet(chunk_pkt)
            ack2 = writer.handle_packet(chunk_pkt)  # Duplicate write of same offset range
            _, status1, bytes1 = struct.unpack("!IBQ", ack1[12:25])
            _, status2, bytes2 = struct.unpack("!IBQ", ack2[12:25])
            self.assertEqual(status1, STATUS_PROGRESS)
            self.assertEqual(status2, STATUS_PROGRESS)
            self.assertEqual(bytes1, len(data))
            self.assertEqual(bytes2, len(data))  # No double counting

            finish_pkt = struct.pack("!BI", CMD_FINISH, tid)
            ack_fin = writer.handle_packet(finish_pkt)
            _, status_fin, bytes_fin = struct.unpack("!IBQ", ack_fin[12:25])
            self.assertEqual(status_fin, STATUS_COMPLETED)
            self.assertEqual(bytes_fin, len(data))

            # Test abort_all cleans active transfer temp file
            init_pkt2 = struct.pack("!BIQ", CMD_INIT, 88, 4) + hashlib.sha256(b"abcd").hexdigest().encode("ascii") + b"b.txt"
            writer.handle_packet(init_pkt2)
            self.assertEqual(writer.abort_all(), 1)
            self.assertEqual(writer.abort_all(), 0)


class TestHostAgentDaemonContracts(unittest.TestCase):
    def _make_daemon(self, tmp_dir, env_extra=None):
        env_patch = {
            "LOCALAPPDATA": os.path.join(tmp_dir, "Local"),
            "APPDATA": os.path.join(tmp_dir, "Roaming"),
            "USERPROFILE": tmp_dir,
        }
        if env_extra:
            env_patch.update(env_extra)
        with patch.dict(os.environ, env_patch, clear=False):
            daemon = agent_mod.HostAgentDaemon(host="127.0.0.1", port=0)
            return daemon

    def _cleanup_daemon(self, daemon):
        try:
            daemon.screen_pipeline.close()
        except Exception:
            pass
        if daemon.file_writer:
            daemon.file_writer.abort_all()
        if getattr(agent_mod, "job_supervisor", None):
            try:
                agent_mod.job_supervisor.reset()
            except Exception:
                pass

    def test_unpack_packet_rejects_trailing_and_oversized(self):
        valid = agent_mod.pack_packet(agent_mod.OP_PING, b"PING", seq=1)
        self.assertIsNotNone(agent_mod.unpack_packet(valid))
        self.assertIsNone(agent_mod.unpack_packet(valid + b"X"))
        oversized = struct.pack("!2sBBII", agent_mod.MAGIC, agent_mod.OP_PING, 0, 1, MAX_PAYLOAD_SIZE + 1)
        self.assertIsNone(agent_mod.unpack_packet(oversized))

    def test_secret_rotation_evicts_initial_env_secret(self):
        with tempfile.TemporaryDirectory(prefix="ainet_daemon_sec_") as tmp_dir:
            with patch.dict(os.environ, {"AI_AGENT_SECRET": "legacy_env_secret_123"}, clear=False):
                daemon = self._make_daemon(tmp_dir)
                try:
                    self.assertIn(b"legacy_env_secret_123", daemon._get_valid_secrets())
                    daemon._secret_rotated = True
                    daemon.pairing_token = "ainet_new_rotated_token_xyz"
                    valid_after = daemon._get_valid_secrets()
                    self.assertNotIn(b"legacy_env_secret_123", valid_after)
                    self.assertIn(b"ainet_new_rotated_token_xyz", valid_after)
                finally:
                    self._cleanup_daemon(daemon)

    def test_pin_lockout_authenticate_omits_token_and_audio_cannot_resize(self):
        with tempfile.TemporaryDirectory(prefix="ainet_daemon_ws_") as tmp_dir:
            env_patch = {
                "LOCALAPPDATA": os.path.join(tmp_dir, "Local"),
                "APPDATA": os.path.join(tmp_dir, "Roaming"),
                "USERPROFILE": tmp_dir,
            }
            with patch.dict(os.environ, env_patch, clear=False):
                daemon = self._make_daemon(tmp_dir)
                try:
                    daemon.pairing_pin = "654321"
                    daemon.pin_issued_at = time.time()
                    daemon.pairing_token = "ainet_strong_secret_token_test"

                    # 1. Authenticate using long-lived token -> must NOT echo pairingToken back
                    ws_auth = _FakeWebSocket([
                        json.dumps({"action": "AUTHENTICATE", "token": daemon.pairing_token}),
                        agent_mod.pack_packet(
                            agent_mod.OP_AUDIO,
                            json.dumps({"width": 320, "height": 200}).encode("utf-8"),
                            seq=1,
                        ),
                    ])
                    orig_res = daemon.screen_pipeline.target_res
                    asyncio.run(daemon.handle_connection(ws_auth))
                    text_msgs = [json.loads(m) for m in ws_auth.sent if isinstance(m, str)]
                    auth_acks = [m for m in text_msgs if m.get("event") == "AUTHENTICATED"]
                    self.assertEqual(len(auth_acks), 1)
                    self.assertNotIn("pairingToken", auth_acks[0])
                    # OP_AUDIO must NOT hijack screen pipeline resolution
                    self.assertEqual(daemon.screen_pipeline.target_res, orig_res)

                    # 2. 5 wrong PAIR attempts trigger 60s lockout blocking even the right PIN on the 6th attempt
                    wrong_pair_msgs = [json.dumps({"action": "PAIR", "pin": "000000"}) for _ in range(5)]
                    wrong_pair_msgs.append(json.dumps({"action": "PAIR", "pin": "654321"}))
                    ws_pair = _FakeWebSocket(wrong_pair_msgs)
                    daemon.auto_ban_intrusion = False
                    asyncio.run(daemon.handle_connection(ws_pair))
                    pair_texts = [json.loads(m) for m in ws_pair.sent if isinstance(m, str)]
                    self.assertFalse(any(m.get("event") == "AUTHENTICATED" for m in pair_texts))
                finally:
                    self._cleanup_daemon(daemon)

    def test_send_encrypted_or_plain_aad_decrypts_cleanly(self):
        with tempfile.TemporaryDirectory(prefix="ainet_daemon_aead_") as tmp_dir:
            daemon = self._make_daemon(tmp_dir)
            try:
                psk = secrets.token_bytes(32)
                vault = HostCryptoVault(psk)
                challenge = vault.create_handshake_challenge()
                host_pub = challenge[11:43]
                host_n2 = challenge[43:59]

                cli_priv, cli_pub = FallbackCurve25519.generate_keypair()
                cli_n1 = secrets.token_bytes(16)
                mac = hmac.new(psk, PROTOCOL_MAGIC + host_pub + cli_pub + cli_n1 + host_n2, hashlib.sha256).digest()
                self.assertTrue(vault.complete_handshake(cli_pub + cli_n1 + mac))

                ss = FallbackCurve25519.compute_shared_secret(cli_priv, host_pub)
                client_rx = hkdf_extract_and_expand(cli_n1 + host_n2, ss, CTX_HOST_TX, 32)

                ws = _FakeWebSocket([])
                daemon._ws_write_locks[ws] = asyncio.Lock()
                daemon._client_vaults[ws] = vault

                plaintext = b'{"event":"test_telemetry","fps":60}'
                asyncio.run(daemon._send_encrypted_or_plain(ws, OP_TELEMETRY, plaintext, seq=42))
                self.assertEqual(len(ws.sent), 1)
                wire_pkt = ws.sent[0]
                magic, opcode, flags, seq, length = agent_mod._HEADER_STRUCT.unpack_from(wire_pkt, 0)
                self.assertEqual(magic, b"\xC5\x71")
                self.assertEqual(opcode, OP_TELEMETRY)
                self.assertEqual(flags, 0x02)
                self.assertEqual(seq, 42)
                self.assertEqual(length, len(plaintext) + 28)

                enc_payload = wire_pkt[12:]
                dec = FallbackChaCha20Poly1305.decrypt(client_rx, enc_payload[:12], enc_payload[12:], aad=wire_pkt[:12])
                self.assertEqual(dec, plaintext)
                vault.close()
            finally:
                self._cleanup_daemon(daemon)


if __name__ == "__main__":
    unittest.main()
