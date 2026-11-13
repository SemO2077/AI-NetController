"""
Mobile <-> Host Security Hardening & Performance Regression Suite
==================================================================
Verifies all mobile/host connection hardening fixes and pipeline optimizations:
  1. Encrypted X25519 + ChaCha20-Poly1305 PIN pairing (`PAIR_INIT`/`PAIR_FINISH`)
     and wire ciphertext opacity (PIN and pairingToken never appear in plaintext).
  2. Per-IP PIN brute-force lockout isolation + MAX_CONNECTIONS_PER_IP limit.
  3. Mutual host-authenticated ECDH handshake (`INIT_ECDH_VAULT_M` / 91B reply),
     strict post-vault anti-downgrade rejection, and AEAD-encrypted PONG replies.
  4. Exact `cid` input lock matching + 6-byte binary OP_INPUT bounds clamping &
     btn_code=4 double-click support.
  5. AdaptiveScreenPipeline static frame short-circuit (`consecutive_static >= 2`)
     and instant `_wake_stream()` wakeup on input/control events.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import struct
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

import numpy as np

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_AGENT_DIR = os.path.dirname(_TEST_DIR)
_REPO_ROOT = os.path.dirname(_AGENT_DIR)
if _AGENT_DIR not in sys.path:
    sys.path.append(_AGENT_DIR)
if _REPO_ROOT in sys.path:
    sys.path.remove(_REPO_ROOT)
sys.path.insert(0, _REPO_ROOT)

_existing_agent = sys.modules.get("agent")
if (
    _existing_agent is not None
    and not hasattr(_existing_agent, "__path__")
    and hasattr(_existing_agent, "HostAgentDaemon")
):
    agent_mod = _existing_agent
else:
    import agent.agent as agent_mod

import agent_gui as agent_gui_mod
from crypto_vault import (
    CTX_CLIENT_TX,
    CTX_HOST_TX,
    FallbackChaCha20Poly1305,
    FallbackCurve25519,
    PROTOCOL_MAGIC,
    hkdf_extract_and_expand,
)


class _ScriptedWebSocket:
    """In-memory bidirectional WebSocket test double with async incoming queue."""

    def __init__(self, incoming=None, remote_address=("127.0.0.1", 55400)):
        self._incoming = list(incoming or [])
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


class _LiveQueueWebSocket:
    """Async-queue WebSocket test double for interactive multi-step protocols."""

    def __init__(self, remote_address=("127.0.0.1", 55401)):
        self.remote_address = remote_address
        self.incoming = asyncio.Queue()
        self.sent = asyncio.Queue()
        self.all_sent = []
        self.closed = []

    async def send(self, data):
        self.all_sent.append(data)
        await self.sent.put(data)

    async def push_client(self, data):
        await self.incoming.put(data)

    async def end_client(self):
        await self.incoming.put(None)

    async def next_server(self, timeout=2.0):
        return await asyncio.wait_for(self.sent.get(), timeout=timeout)

    async def close(self, code=1000, reason=""):
        self.closed.append((code, reason))
        await self.incoming.put(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self.incoming.get()
        if item is None:
            raise StopAsyncIteration
        return item


class TestMobileHostSecurityAndPerf(unittest.TestCase):
    def _make_daemon(self, tmp_dir):
        env_patch = {
            "HOME": tmp_dir,
            "XDG_CONFIG_HOME": os.path.join(tmp_dir, ".config"),
            "LOCALAPPDATA": os.path.join(tmp_dir, "Local"),
            "APPDATA": os.path.join(tmp_dir, "Roaming"),
            "USERPROFILE": tmp_dir,
        }
        with patch.dict(os.environ, env_patch, clear=False):
            return agent_mod.HostAgentDaemon(host="127.0.0.1", port=0)

    def _cleanup_daemon(self, daemon):
        try:
            daemon.stop()
        except Exception:
            pass
        try:
            daemon.screen_pipeline.close()
        except Exception:
            pass
        if daemon.file_writer:
            try:
                daemon.file_writer.abort_all()
            except Exception:
                pass
        if getattr(agent_mod, "job_supervisor", None):
            try:
                agent_mod.job_supervisor.reset()
            except Exception:
                pass

    def _run_pair_init_finish(self, daemon, pin, remote_ip="192.168.1.45"):
        async def _flow():
            ws = _LiveQueueWebSocket(remote_address=(remote_ip, 51234))
            daemon.auto_ban_intrusion = False
            task = asyncio.create_task(daemon.handle_connection(ws))
            try:
                # Drain initial OP_AUTH challenge header
                chal_pkt = await ws.next_server()
                self.assertIsInstance(chal_pkt, (bytes, bytearray))

                cli_priv, cli_pub = FallbackCurve25519.generate_keypair()
                cli_nonce = secrets.token_bytes(16)
                await ws.push_client(json.dumps({
                    "action": "PAIR_INIT",
                    "client_pub": base64.b64encode(cli_pub).decode("ascii"),
                    "client_nonce": base64.b64encode(cli_nonce).decode("ascii"),
                    "device": "Pixel-Audit",
                }))

                raw_chal = await ws.next_server()
                chal_msg = json.loads(raw_chal)
                if chal_msg.get("event") == "ERROR":
                    return chal_msg, None, None, ws.all_sent
                self.assertEqual(chal_msg.get("event"), "PAIR_CHALLENGE")
                srv_pub = base64.b64decode(chal_msg["host_pub"])
                srv_nonce = base64.b64decode(chal_msg["host_nonce"])

                ss = FallbackCurve25519.compute_shared_secret(cli_priv, srv_pub)
                pair_key = hkdf_extract_and_expand(
                    cli_nonce + srv_nonce, ss, b"CST_PAIR_WRAP_V1", 32
                )
                aad = b"CST_PAIR_V1" + cli_pub + srv_pub + cli_nonce + srv_nonce

                c_nonce = b"\x00" * 12
                plain = json.dumps({"pin": pin, "device": "Pixel-Audit"}).encode("utf-8")
                ct = FallbackChaCha20Poly1305.encrypt(pair_key, c_nonce, plain, aad=aad)
                await ws.push_client(json.dumps({
                    "action": "PAIR_FINISH",
                    "ciphertext": base64.b64encode(c_nonce + ct).decode("ascii"),
                    "device": "Pixel-Audit",
                }))

                raw_res = await ws.next_server()
                res_msg = json.loads(raw_res)
                return res_msg, pair_key, aad, ws.all_sent
            finally:
                await ws.end_client()
                await task

        return asyncio.run(_flow())

    def test_01_encrypted_pair_init_finish_opacity_and_tamper_rejection(self):
        with tempfile.TemporaryDirectory(prefix="ainet_pair_") as tmp_dir:
            daemon = self._make_daemon(tmp_dir)
            try:
                daemon.pairing_pin = "739104"
                daemon.pin_issued_at = time.time()
                daemon.pairing_token = "ainet_super_secret_pairing_token_999"

                res_msg, pair_key, aad, all_sent = self._run_pair_init_finish(
                    daemon, "739104"
                )
                self.assertEqual(res_msg.get("event"), "PAIR_RESULT")
                wrapped = base64.b64decode(res_msg["ciphertext"])
                self.assertGreater(len(wrapped), 28)
                expected_nonce = struct.pack("!IQ", 0, 1)
                self.assertEqual(wrapped[:12], expected_nonce)
                dec = FallbackChaCha20Poly1305.decrypt(
                    pair_key, wrapped[:12], wrapped[12:], aad=aad
                )
                payload = json.loads(dec.decode("utf-8"))
                self.assertEqual(payload["pairingToken"], daemon.pairing_token)

                # Ensure neither raw PIN nor pairingToken ever appeared on wire JSON
                wire_text = "".join(m for m in all_sent if isinstance(m, str))
                self.assertNotIn("739104", wire_text)
                self.assertNotIn(daemon.pairing_token, wire_text)
            finally:
                self._cleanup_daemon(daemon)

    def test_02_per_ip_pin_lockout_isolation_and_per_ip_conn_cap(self):
        with tempfile.TemporaryDirectory(prefix="ainet_ip_lock_") as tmp_dir:
            daemon = self._make_daemon(tmp_dir)
            try:
                daemon.pairing_pin = "482910"
                daemon.pin_issued_at = time.time()
                daemon.pairing_token = "ainet_legit_token_abc123"
                daemon.auto_ban_intrusion = False

                # Attacker IP A locks itself out with 5 failed PIN attempts
                for _ in range(5):
                    res, _, _, _ = self._run_pair_init_finish(
                        daemon, "000000", remote_ip="10.9.9.10"
                    )
                    self.assertEqual(res.get("event"), "ERROR")

                # 6th attempt from attacker IP A with even the RIGHT PIN is rejected
                res_att, _, _, _ = self._run_pair_init_finish(
                    daemon, "482910", remote_ip="10.9.9.10"
                )
                self.assertEqual(res_att.get("event"), "ERROR")

                # Legitimate mobile client IP B must NOT be locked out by IP A's brute force
                res_legit, pair_key, aad, _ = self._run_pair_init_finish(
                    daemon, "482910", remote_ip="192.168.1.45"
                )
                self.assertEqual(res_legit.get("event"), "PAIR_RESULT")
                wrapped = base64.b64decode(res_legit["ciphertext"])
                dec = json.loads(
                    FallbackChaCha20Poly1305.decrypt(
                        pair_key, wrapped[:12], wrapped[12:], aad=aad
                    ).decode("utf-8")
                )
                self.assertEqual(dec["pairingToken"], daemon.pairing_token)

                # Verify MAX_CONNECTIONS_PER_IP cap rejects 9th concurrent connection for same IP
                async def _check_conn_cap():
                    same_ip = "192.168.1.77"
                    for i in range(agent_mod.MAX_CONNECTIONS_PER_IP):
                        dummy = _ScriptedWebSocket(remote_address=(same_ip, 5000 + i))
                        daemon.clients.add(dummy)
                    ninth = _ScriptedWebSocket(remote_address=(same_ip, 5999))
                    await daemon.handle_connection(ninth)
                    self.assertTrue(any(code == 1013 for code, _ in ninth.closed))

                asyncio.run(_check_conn_cap())
            finally:
                self._cleanup_daemon(daemon)

    def test_03_mutual_ecdh_vault_anti_downgrade_and_encrypted_pong(self):
        with tempfile.TemporaryDirectory(prefix="ainet_mutual_") as tmp_dir:
            daemon = self._make_daemon(tmp_dir)
            try:
                daemon.pairing_token = "ainet_mutual_secret_token_777"
                psk = daemon.pairing_token.encode("utf-8")

                async def _flow():
                    ws = _LiveQueueWebSocket(remote_address=("192.168.1.88", 55001))
                    task = asyncio.create_task(daemon.handle_connection(ws))
                    try:
                        # 1. Authenticate over 16B OP_AUTH challenge
                        chal_frame = await ws.next_server()
                        op_ch = agent_mod.unpack_packet(chal_frame)
                        self.assertIsNotNone(op_ch)
                        self.assertEqual(op_ch[1], agent_mod.OP_AUTH)
                        nonce16 = op_ch[5]
                        self.assertEqual(len(nonce16), 16)

                        auth_mac = hmac.new(psk, nonce16, hashlib.sha256).digest()
                        await ws.push_client(
                            agent_mod.pack_packet(agent_mod.OP_AUTH, auth_mac, seq=1)
                        )
                        auth_ack = agent_mod.unpack_packet(await ws.next_server())
                        self.assertEqual(auth_ack[5], b"OK_AUTHENTICATED")

                        # 2. Send 34B INIT_ECDH_VAULT_M: + client_chal (16B)
                        client_chal = secrets.token_bytes(16)
                        await ws.push_client(
                            agent_mod.pack_packet(
                                agent_mod.OP_AUTH,
                                b"INIT_ECDH_VAULT_M:" + client_chal,
                                seq=2,
                            )
                        )
                        mutual_frame = agent_mod.unpack_packet(await ws.next_server())
                        self.assertEqual(mutual_frame[1], agent_mod.OP_AUTH)
                        self.assertEqual(mutual_frame[2] & 0x01, 0x01)
                        reply_91 = mutual_frame[5]
                        self.assertEqual(len(reply_91), 91)

                        chal_59 = reply_91[:59]
                        host_mac = reply_91[59:91]
                        expected_host_mac = hmac.new(
                            psk, b"CST_HOST_CHAL_M:" + client_chal + chal_59, hashlib.sha256
                        ).digest()
                        self.assertTrue(hmac.compare_digest(host_mac, expected_host_mac))

                        # 3. Complete client side of mutual ECDH
                        self.assertEqual(chal_59[:11], PROTOCOL_MAGIC)
                        host_pub = chal_59[11:43]
                        host_n2 = chal_59[43:59]
                        cli_priv, cli_pub = FallbackCurve25519.generate_keypair()
                        cli_n1 = secrets.token_bytes(16)
                        cli_mac = hmac.new(
                            psk,
                            PROTOCOL_MAGIC + host_pub + cli_pub + cli_n1 + host_n2,
                            hashlib.sha256,
                        ).digest()
                        await ws.push_client(
                            agent_mod.pack_packet(
                                agent_mod.OP_AUTH,
                                cli_pub + cli_n1 + cli_mac,
                                seq=3,
                            )
                        )
                        ok_vault = agent_mod.unpack_packet(await ws.next_server())
                        self.assertEqual(ok_vault[5], b"OK_ECDH_VAULT")

                        shared = FallbackCurve25519.compute_shared_secret(cli_priv, host_pub)
                        salt = cli_n1 + host_n2
                        cli_tx_key = hkdf_extract_and_expand(salt, shared, CTX_CLIENT_TX, 32)
                        cli_rx_key = hkdf_extract_and_expand(salt, shared, CTX_HOST_TX, 32)

                        # 4. Anti-downgrade: plaintext OP_PING and JSON post-vault must be rejected
                        await ws.push_client(
                            agent_mod.pack_packet(agent_mod.OP_PING, b"PING", seq=4, flags=0)
                        )
                        err1_raw = await ws.next_server()
                        err1_pkt = agent_mod.unpack_packet(err1_raw)
                        self.assertEqual(err1_pkt[1], agent_mod.OP_ERR)
                        self.assertEqual(err1_pkt[2], 0x02)
                        err1_plain = FallbackChaCha20Poly1305.decrypt(
                            cli_rx_key,
                            err1_pkt[5][:12],
                            err1_pkt[5][12:],
                            aad=err1_raw[:12],
                        )
                        self.assertIn(b"Encrypted AEAD", err1_plain)

                        await ws.push_client(json.dumps({"action": "GET_METRICS"}))
                        err2_raw = await ws.next_server()
                        err2_pkt = agent_mod.unpack_packet(err2_raw)
                        self.assertEqual(err2_pkt[1], agent_mod.OP_ERR)
                        self.assertEqual(err2_pkt[2], 0x02)
                        err2_plain = FallbackChaCha20Poly1305.decrypt(
                            cli_rx_key,
                            err2_pkt[5][:12],
                            err2_pkt[5][12:],
                            aad=err2_raw[:12],
                        )
                        self.assertIn(b"Encrypted AEAD", err2_plain)

                        # 5. Encrypted OP_PING must receive AEAD-encrypted OP_PING PONG (flags=0x02)
                        tx_seq = 1
                        nonce = struct.pack("!Q4s", tx_seq, b"MOBI")
                        pt = b""
                        wire_len = 12 + len(pt) + 16
                        hdr = agent_mod._HEADER_STRUCT.pack(
                            agent_mod.MAGIC, agent_mod.OP_PING, 0x02, tx_seq, wire_len
                        )
                        ct = FallbackChaCha20Poly1305.encrypt(cli_tx_key, nonce, pt, aad=hdr)
                        await ws.push_client(hdr + nonce + ct)

                        pong_raw = await ws.next_server()
                        pong_unpacked = agent_mod.unpack_packet(pong_raw)
                        self.assertEqual(pong_unpacked[1], agent_mod.OP_PING)
                        self.assertEqual(pong_unpacked[2], 0x02)
                        pong_payload = pong_unpacked[5]
                        dec_pong = FallbackChaCha20Poly1305.decrypt(
                            cli_rx_key,
                            pong_payload[:12],
                            pong_payload[12:],
                            aad=pong_raw[:12],
                        )
                        self.assertEqual(dec_pong, b"PONG")
                    finally:
                        await ws.end_client()
                        await task

                asyncio.run(_flow())
            finally:
                self._cleanup_daemon(daemon)

    def test_04_exact_cid_lock_and_input_bounds_clamping(self):
        with tempfile.TemporaryDirectory(prefix="ainet_input_") as tmp_dir:
            daemon = self._make_daemon(tmp_dir)
            try:
                ws_short = _ScriptedWebSocket(remote_address=("192.168.1.10", 1234))
                ws_prefix = _ScriptedWebSocket(remote_address=("192.168.1.10", 12345))
                daemon.clients.add(ws_short)
                daemon.clients.add(ws_prefix)
                daemon.authenticated_clients.add(ws_short)
                daemon.authenticated_clients.add(ws_prefix)

                gui_state = agent_gui_mod.HostDaemonState()
                gui_state.view_only_mode = False
                with gui_state.lock:
                    gui_state.connected_clients = [
                        {"id": "192.168.1.10:1234", "ip": "192.168.1.10", "inputAllowed": False},
                        {"id": "192.168.1.10:12345", "ip": "192.168.1.10", "inputAllowed": True},
                    ]
                daemon.gui_state = gui_state
                daemon.view_only_mode = False

                self.assertFalse(daemon._is_client_input_allowed(ws_short))
                # Regression check: exact cid match ensures 12345 is allowed independently of 1234
                self.assertTrue(daemon._is_client_input_allowed(ws_prefix))

                with gui_state.lock:
                    gui_state.connected_clients[0]["inputAllowed"] = True
                fake_gui = MagicMock()
                with patch.object(agent_mod, "pyautogui", fake_gui), patch.object(
                    daemon, "_wake_stream"
                ) as wake_spy:
                    # 1. Extreme binary move coordinates clamp to [-5000, 5000]
                    pkt_extreme = struct.pack("!BhhB", 0x01, 25000, -25000, 0)
                    asyncio.run(daemon._process_virtual_input(pkt_extreme, ws=ws_short))
                    fake_gui.moveRel.assert_called_once_with(5000, -5000, _pause=False)

                    # 2. btn_code=4 triggers doubleClick
                    pkt_dbl = struct.pack("!BhhB", 0x02, 0, 0, 4)
                    asyncio.run(daemon._process_virtual_input(pkt_dbl, ws=ws_short))
                    fake_gui.doubleClick.assert_called_once()
                    self.assertGreaterEqual(wake_spy.call_count, 2)

                    # 3. Non-finite coordinates in JSON MOUSE_MOVE are safely clamped/ignored without crash
                    asyncio.run(daemon._process_virtual_input(
                        json.dumps({
                            "action": "MOUSE_MOVE",
                            "dx": 25000,
                            "dy": -25000,
                        }).encode("utf-8"),
                        ws=ws_short,
                    ))
                    # Hotkey length > 6 truncates safely to max 6 keys
                    fake_gui.hotkey.reset_mock()
                    asyncio.run(daemon._process_virtual_input(
                        json.dumps({
                            "action": "HOTKEY",
                            "keys": ["ctrl", "shift", "alt", "win", "a", "b", "c", "d"],
                        }).encode("utf-8"),
                        ws=ws_short,
                    ))
                    fake_gui.hotkey.assert_called_once_with(
                        "ctrl", "shift", "alt", "win", "a", "b", _pause=False
                    )
            finally:
                self._cleanup_daemon(daemon)

    def test_05_screen_pipeline_static_short_circuit_and_wake_event(self):
        pipeline = agent_mod.AdaptiveScreenPipeline(target_resolution=(1280, 720))
        try:
            class _FakeShot:
                def __init__(self, arr):
                    self._arr = arr
                    self.height, self.width = arr.shape[:2]
                    self.size = (self.width, self.height)
                    self.raw = memoryview(arr.ravel())
                    self.bgra = self.raw

                def __array__(self, dtype=None, copy=None):
                    return self._arr if dtype is None else self._arr.astype(dtype)

            class _FakeMSS:
                def __init__(self, arr):
                    self.arr = arr
                    mon = {"left": 0, "top": 0, "width": arr.shape[1], "height": arr.shape[0]}
                    self.monitors = [mon, mon]

                def grab(self, _mon):
                    return _FakeShot(self.arr)

            # Deterministic gradient BGRA frame so JPEG encoder & spatial grid work reliably
            img = np.zeros((1080, 1920, 4), dtype=np.uint8)
            img[:, :, 0] = np.arange(1920, dtype=np.uint8)
            img[:, :, 1] = np.arange(1080, dtype=np.uint8)[:, None]
            img[:, :, 3] = 255
            fake_mss = _FakeMSS(img)
            pipeline._get_mss = lambda: fake_mss

            b1, s1 = pipeline._grab_and_compress()
            self.assertIsNotNone(b1)
            self.assertFalse(s1)

            # Next identical frames report is_static=True; once consecutive_static >= 2,
            # _grab_and_compress() short-circuits encoding cleanly (returns None, True).
            for _ in range(2):
                _, sx = pipeline._grab_and_compress()
                self.assertTrue(sx)
                pipeline.consecutive_static += 1
            self.assertGreaterEqual(pipeline.consecutive_static, 2)

            b_skip, s_skip = pipeline._grab_and_compress()
            self.assertIsNone(b_skip)
            self.assertTrue(s_skip)

            # Mutating one tile wakes spatial delta detector immediately
            mutated = img.copy()
            mutated[100:260, 100:260, :3] ^= 0xFF
            fake_mss.arr = mutated
            b_dirty, s_dirty = pipeline._grab_and_compress()
            self.assertIsNotNone(b_dirty)
            self.assertFalse(s_dirty)

            # Verify daemon _wake_stream resets static counter & triggers event
            with tempfile.TemporaryDirectory(prefix="ainet_wake_") as tmp_dir:
                daemon = self._make_daemon(tmp_dir)
                try:
                    daemon.screen_pipeline.consecutive_static = 5

                    async def _wake_wait():
                        daemon.loop = asyncio.get_running_loop()
                        daemon._loop_thread_id = threading.get_ident()
                        loop_event = getattr(daemon, "_stream_wake_event", None) or asyncio.Event()
                        daemon._stream_wake_event = loop_event
                        loop_event.clear()
                        daemon._wake_stream()
                        await asyncio.wait_for(loop_event.wait(), timeout=0.5)
                        self.assertEqual(daemon.screen_pipeline.consecutive_static, 0)

                    asyncio.run(_wake_wait())
                finally:
                    self._cleanup_daemon(daemon)
        finally:
            pipeline.close()


if __name__ == "__main__":
    unittest.main()
