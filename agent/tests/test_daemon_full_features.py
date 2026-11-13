"""
Comprehensive End-to-End PC Daemon Feature Verification Suite
========================================================================
Exercises every subsystem of the live PC daemon (`agent.py`, `daemon_config.py`,
`agent_gui.py`, `agent_daemon.py`, `crypto_vault.py`, `host_file_writer.py`,
`command_ast_firewall.py`, `multi_monitor_streamer.py`) over real loopback
WebSockets without mutating Windows Registry, user Shortcuts, Downloads, or %APPDATA%.
"""

import asyncio
import hashlib
import hmac
import http.server
import io
import json
import os
import platform
import secrets
import shutil
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_AGENT_DIR = os.path.dirname(_TEST_DIR)
_REPO_ROOT = os.path.dirname(_AGENT_DIR)
if _AGENT_DIR not in sys.path:
    sys.path.append(_AGENT_DIR)
if _REPO_ROOT in sys.path:
    sys.path.remove(_REPO_ROOT)
sys.path.insert(0, _REPO_ROOT)

_existing_agent = sys.modules.get("agent")
if _existing_agent is not None and not hasattr(_existing_agent, "__path__"):
    agent_mod = _existing_agent
else:
    import agent.agent as agent_mod

import agent_daemon as agent_daemon_mod
import agent_gui as agent_gui_mod
import daemon_config as daemon_config_mod
from crypto_vault import (
    CTX_CLIENT_TX,
    CTX_HOST_TX,
    FallbackChaCha20Poly1305,
    FallbackCurve25519,
    PROTOCOL_MAGIC,
    SlidingWindowReplayProtector,
    hkdf_extract_and_expand,
)
from host_file_writer import (
    CMD_CHUNK,
    CMD_FINISH,
    CMD_INIT,
    HostFileWriter,
    STATUS_COMPLETED,
    STATUS_ERR_TRAVERSAL,
    STATUS_OK,
    STATUS_PROGRESS,
)

import websockets
from PIL import Image


def _free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _make_fake_jpeg_bytes(width: int = 320, height: int = 180) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=(18, 92, 164))
    img.save(buf, format="JPEG", quality=70)
    return buf.getvalue()


class _ClientVaultSession:
    """Minimal client-side twin of HostCryptoVault using crypto_vault primitives."""

    def __init__(self, psk: bytes):
        self.psk = psk
        self.priv, self.pub = FallbackCurve25519.generate_keypair()
        self.client_n1 = secrets.token_bytes(16)
        self.tx_seq = 0
        self.rx_window = SlidingWindowReplayProtector(128)
        self.k_send: bytes = b""
        self.k_recv: bytes = b""

    def build_handshake_response(self, challenge: bytes) -> bytes:
        assert challenge[:11] == PROTOCOL_MAGIC
        host_pub = challenge[11:43]
        host_n2 = challenge[43:59]
        proof_data = PROTOCOL_MAGIC + host_pub + self.pub + self.client_n1 + host_n2
        client_hmac = hmac.new(self.psk, proof_data, hashlib.sha256).digest()
        shared = FallbackCurve25519.compute_shared_secret(self.priv, host_pub)
        salt = self.client_n1 + host_n2
        self.k_recv = hkdf_extract_and_expand(salt, shared, CTX_HOST_TX, 32)
        self.k_send = hkdf_extract_and_expand(salt, shared, CTX_CLIENT_TX, 32)
        return self.pub + self.client_n1 + client_hmac

    def encrypt_packet(self, opcode: int, payload: bytes, seq: int) -> bytes:
        wire_len = len(payload) + 28
        aad = agent_mod._HEADER_STRUCT.pack(agent_mod.MAGIC, opcode, 0x02, seq, wire_len)
        nonce = struct.pack(">IQ", 0, seq)
        ct = FallbackChaCha20Poly1305.encrypt(self.k_send, nonce, payload, aad)
        return agent_mod.pack_packet(opcode, nonce + ct, seq=seq, flags=0x02)

    def decrypt_packet(self, raw_frame: bytes):
        parsed = agent_mod.unpack_packet(raw_frame)
        if not parsed:
            raise AssertionError("Failed to unpack binary packet")
        _, opcode, flags, seq, _, payload = parsed
        if flags & 0x02:
            aad = raw_frame[:agent_mod.HEADER_SIZE]
            nonce = payload[:12]
            ct = payload[12:]
            plain = FallbackChaCha20Poly1305.decrypt(self.k_recv, nonce, ct, aad)
            assert plain is not None, f"AEAD tag failed on opcode 0x{opcode:02X} seq={seq}"
            _, nonce_seq = struct.unpack(">IQ", nonce)
            assert self.rx_window.validate_and_update(nonce_seq), f"AEAD replay failed nonce_seq={nonce_seq}"
            return opcode, flags, seq, plain
        return opcode, flags, seq, payload


async def _connect_and_auth(url: str, token: bytes, origin: str = None):
    extra_headers = {"Origin": origin} if origin else None
    ws = await websockets.connect(url, additional_headers=extra_headers)
    raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
    pkt = agent_mod.unpack_packet(raw)
    assert pkt is not None and pkt[1] == agent_mod.OP_AUTH and len(pkt[5]) == 16
    sig = hmac.new(token, pkt[5], hashlib.sha256).digest()
    await ws.send(agent_mod.pack_packet(agent_mod.OP_AUTH, sig, seq=1))
    ack_raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
    ack = agent_mod.unpack_packet(ack_raw)
    assert ack is not None and ack[1] == agent_mod.OP_AUTH and ack[5] == b"OK_AUTHENTICATED"
    return ws


class TestDaemonFullFeatures(unittest.IsolatedAsyncioTestCase):
    """End-to-end verification of every PC daemon capability and mobile wire contract."""

    async def asyncSetUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="ai_net_e2e_")
        self.cfg_path = os.path.join(self.tmpdir, "config.json")
        self.dl_dir = Path(self.tmpdir) / "downloads"
        self.dl_dir.mkdir(parents=True, exist_ok=True)
        self.daemon = None
        self.daemon_task = None
        self.cfg_patch = patch.object(daemon_config_mod, "get_config_path", return_value=self.cfg_path)
        self.agent_cfg_patch = patch.object(agent_mod, "get_config_path", return_value=self.cfg_path)
        self._saved_env_secrets = {
            k: os.environ.pop(k, None)
            for k in ("AI_AGENT_SECRET", "CST_AGENT_SECRET")
        }
        self.cfg_patch.start()
        self.agent_cfg_patch.start()

    async def asyncTearDown(self):
        if self.daemon is not None:
            await self.daemon.async_stop()
        if self.daemon_task is not None and not self.daemon_task.done():
            self.daemon_task.cancel()
            await asyncio.gather(self.daemon_task, return_exceptions=True)
        self.agent_cfg_patch.stop()
        self.cfg_patch.stop()
        for k, v in self._saved_env_secrets.items():
            if v is not None:
                os.environ[k] = v
            else:
                os.environ.pop(k, None)
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    async def _start_daemon(self, gui_state=None, fake_frame: bytes = None):
        port = _free_tcp_port()
        daemon = agent_mod.HostAgentDaemon(
            host="127.0.0.1",
            port=port,
            gui_state=gui_state,
            enable_tray=False,
            enable_mdns=False,
        )
        daemon.file_writer = HostFileWriter(download_dir=str(self.dl_dir))
        daemon._start_system_tray = lambda: None

        async def _noop_mdns():
            return None

        daemon._start_mdns = _noop_mdns
        if fake_frame is not None:
            def _stub_grab():
                target_w, target_h = daemon.screen_pipeline.target_res
                cap_w, cap_h = 1920, 1080
                aspect = cap_w / float(cap_h)
                sw, sh = target_w, max(2, int(round(target_w / aspect)))
                if sh > target_h:
                    sh = target_h
                    sw = max(2, int(round(target_h * aspect)))
                daemon.screen_pipeline.last_capture_rect = (0, 0, cap_w, cap_h)
                daemon.screen_pipeline.last_stream_size = (sw, sh)
                return fake_frame, False

            daemon.screen_pipeline._grab_and_compress = _stub_grab
            daemon.screen_pipeline._grab_and_compress_raw = _stub_grab
        self.daemon = daemon
        await daemon.start()
        return daemon, f"ws://127.0.0.1:{port}"

    async def test_01_config_dpapi_blacklist_and_av_integrity(self):
        cfg = daemon_config_mod.load_config()
        self.assertTrue(os.path.isfile(self.cfg_path))
        self.assertTrue(len(cfg["pairing_pin"]) == 6 and cfg["pairing_pin"].isdigit())
        self.assertGreaterEqual(len(cfg["pairing_token"]), 20)

        cfg["blacklisted_devices"] = [
            {"id": "ban-1", "ip": "10.9.8.7", "reason": "auth_bruteforce"},
            "10.9.8.7",  # duplicate IP should deduplicate
            "10.9.8.8",
        ]
        self.assertTrue(daemon_config_mod.save_config(cfg))

        reloaded = daemon_config_mod.load_config()
        self.assertEqual(reloaded["pairing_token"], cfg["pairing_token"])
        self.assertEqual(reloaded["pairing_pin"], cfg["pairing_pin"])
        self.assertEqual(len(reloaded["blacklisted_devices"]), 2)
        self.assertEqual(reloaded["blacklisted_devices"][0]["ip"], "10.9.8.7")
        self.assertEqual(reloaded["blacklisted_devices"][1], "10.9.8.8")

        if platform.system() == "Windows" and getattr(agent_mod.JOB_SUPERVISOR, "job_handle", None) is None:
            agent_mod.JOB_SUPERVISOR.reset()
        integrity = agent_gui_mod._detect_av_integrity()
        if platform.system() == "Windows":
            self.assertTrue(integrity["sandbox_job_object"])
        self.assertTrue(integrity["manifest_as_invoker"])

    async def test_02_pair_pin_lockout_cswsh_origin_and_ban_unban(self):
        gui_state = agent_gui_mod.HostDaemonState(host="127.0.0.1", port=8765)
        daemon, url = await self._start_daemon(gui_state=gui_state, fake_frame=_make_fake_jpeg_bytes())

        # CSWSH origin guard checks
        self.assertFalse(daemon._is_origin_allowed("https://evil.example.com"))
        self.assertTrue(daemon._is_origin_allowed("http://localhost:3000"))
        self.assertTrue(daemon._is_origin_allowed("capacitor://localhost"))

        # Wrong PIN x5 triggers 60s PIN rate-limit lockout (disable IP auto-ban during lockout verification)
        gui_state.auto_ban_intrusion = False
        daemon.auto_ban_intrusion = False
        for _ in range(5):
            async with websockets.connect(url) as ws:
                _ = await ws.recv()  # auth challenge
                await ws.send(json.dumps({"action": "PAIR", "pin": "000000"}))
                err_msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
                self.assertEqual(err_msg["event"], "ERROR")

        # Even the real PIN fails while locked out
        async with websockets.connect(url) as ws:
            _ = await ws.recv()
            await ws.send(json.dumps({"action": "PAIR", "pin": daemon.pairing_pin}))
            err_msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
            self.assertEqual(err_msg["event"], "ERROR")

        # Reset lockout & pair legitimately -> returns long-lived pairingToken
        daemon._pin_lockout_until = 0.0
        daemon._pin_fail_count = 0
        gui_state.auto_ban_intrusion = True
        daemon.auto_ban_intrusion = True
        async with websockets.connect(url) as ws:
            _ = await ws.recv()
            await ws.send(json.dumps({"action": "PAIR", "pin": daemon.pairing_pin, "device": "Pixel-Test"}))
            ok_msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
            self.assertEqual(ok_msg["event"], "AUTHENTICATED")
            self.assertEqual(ok_msg["pairingToken"], daemon.pairing_token)

        # Auto-ban threshold on failed HMAC auth (simulate client IP check without banning localhost forever)
        daemon.blacklisted_ips.add("198.51.100.77")
        self.assertIn("198.51.100.77", daemon.blacklisted_ips)

        # Fail auth 3 times on 127.0.0.1 -> auto-bans, then live unban clears it immediately
        daemon._record_auth_failure("203.0.113.5", "203.0.113.5:50001")
        daemon._record_auth_failure("203.0.113.5", "203.0.113.5:50002")
        daemon._record_auth_failure("203.0.113.5", "203.0.113.5:50003")
        self.assertIn("203.0.113.5", daemon.blacklisted_ips)
        self.assertTrue(any(
            (x.get("ip") if isinstance(x, dict) else x) == "203.0.113.5"
            for x in gui_state.blacklisted_devices
        ))
        gui_state.unban_device("203.0.113.5")
        daemon._refresh_runtime_policies()
        self.assertNotIn("203.0.113.5", daemon.blacklisted_ips)

    async def test_03_ecdh_vault_antidowngrade_replay_and_monotonic_seq(self):
        daemon, url = await self._start_daemon(fake_frame=_make_fake_jpeg_bytes())
        ws = await _connect_and_auth(url, daemon.pairing_token.encode("utf-8"))
        try:
            # Upgrade to Curve25519 + ChaCha20-Poly1305 AEAD vault
            await ws.send(agent_mod.pack_packet(agent_mod.OP_AUTH, b"INIT_ECDH_VAULT", seq=2))
            chal_raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            chal_pkt = agent_mod.unpack_packet(chal_raw)
            self.assertEqual(chal_pkt[1], agent_mod.OP_AUTH)
            self.assertEqual(len(chal_pkt[5]), 59)

            client_vault = _ClientVaultSession(daemon.pairing_token.encode("utf-8"))
            hs_resp = client_vault.build_handshake_response(chal_pkt[5])
            await ws.send(agent_mod.pack_packet(agent_mod.OP_AUTH, hs_resp, seq=3))
            ok_raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            ok_pkt = agent_mod.unpack_packet(ok_raw)
            self.assertEqual(ok_pkt[5], b"OK_ECDH_VAULT")

            # Anti-downgrade guard: plaintext operational frame MUST be rejected after vault established
            await ws.send(agent_mod.pack_packet(agent_mod.OP_DISPLAY_ENUM, b"", seq=1))
            op, _, _, err_plain = client_vault.decrypt_packet(await asyncio.wait_for(ws.recv(), timeout=5.0))
            self.assertEqual(op, agent_mod.OP_ERR)
            self.assertIn(b"0x02", err_plain)

            # Encrypted OP_DISPLAY_ENUM with monotonic seq
            await ws.send(client_vault.encrypt_packet(agent_mod.OP_DISPLAY_ENUM, b"", seq=1))
            # Replay same seq=1 -> rejected
            await ws.send(client_vault.encrypt_packet(agent_mod.OP_DISPLAY_ENUM, b"", seq=1))

            seen_seqs = []
            seen_ops = set()
            deadline = time.monotonic() + 3.0
            while time.monotonic() < deadline and (
                agent_mod.OP_DISPLAY_ENUM not in seen_ops or agent_mod.OP_FRAME not in seen_ops or agent_mod.OP_ERR not in seen_ops
            ):
                raw = await asyncio.wait_for(ws.recv(), timeout=2.5)
                op, flags, seq, plain = client_vault.decrypt_packet(raw)
                seen_ops.add(op)
                if op != agent_mod.OP_PING:
                    self.assertGreaterEqual(seq, 1)
                    if seen_seqs:
                        self.assertGreater(seq, seen_seqs[-1], "Outbound sequence numbers must strictly increase across opcodes")
                    seen_seqs.append(seq)
                if op == agent_mod.OP_DISPLAY_ENUM:
                    info = json.loads(plain.decode("utf-8"))
                    self.assertIn("monitors", info)
                elif op == agent_mod.OP_FRAME:
                    self.assertTrue(plain.startswith(b"\xff\xd8") and plain.endswith(b"\xff\xd9"))

            self.assertIn(agent_mod.OP_DISPLAY_ENUM, seen_ops)
            self.assertIn(agent_mod.OP_FRAME, seen_ops)
            self.assertIn(agent_mod.OP_ERR, seen_ops)
        finally:
            await ws.close()

    async def test_04_rich_telemetry_payload(self):
        daemon, url = await self._start_daemon(fake_frame=_make_fake_jpeg_bytes())
        ws = await _connect_and_auth(url, daemon.pairing_token.encode("utf-8"))
        try:
            telem = None
            deadline = time.monotonic() + 4.5
            while time.monotonic() < deadline:
                raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
                pkt = agent_mod.unpack_packet(raw)
                self.assertIsNotNone(pkt)
                if pkt[1] == agent_mod.OP_TELEMETRY:
                    self.assertGreaterEqual(pkt[3], 1)
                    telem = json.loads(pkt[5].decode("utf-8"))
                    break
            self.assertIsNotNone(telem, "Did not receive OP_TELEMETRY packet within 4.5s")
            for key in (
                "hostname", "cpu_percent", "cpu_cores", "ram_percent", "ram_used_gb",
                "ram_total_gb", "disk_percent", "capture_fps", "os", "version",
                "protocol", "local_ip", "mac", "port", "uptime_sec", "view_only_mode",
                "require_hitl_approval", "clipboard_sync_allowed", "active_monitor",
                "connected_clients_count", "status",
            ):
                self.assertIn(key, telem)
            self.assertGreaterEqual(telem["connected_clients_count"], 1)
        finally:
            await ws.close()

    async def test_05_aspect_preserving_viewport_and_monitor_switching(self):
        # Verify real _grab_and_compress preserves 16:9 aspect ratio inside 1080x2400 portrait bounds
        pipeline = agent_mod.AdaptiveScreenPipeline()
        pipeline.turbo = None  # Force deterministic Pillow resize path
        pipeline.set_target_resolution(1080, 2400)
        bgra = bytes([0, 128, 255, 255] * (1920 * 1080))
        fake_shot = SimpleNamespace(width=1920, height=1080, size=(1920, 1080), raw=bgra, bgra=bgra)
        fake_sct = SimpleNamespace(
            monitors=[
                {"left": 0, "top": 0, "width": 1920, "height": 1080},
                {"left": 100, "top": 50, "width": 1920, "height": 1080},
            ],
            grab=lambda _m: fake_shot,
        )
        pipeline._get_mss = lambda: fake_sct
        jpeg_bytes, is_unchanged = pipeline._grab_and_compress()
        self.assertFalse(is_unchanged)
        self.assertIsNotNone(jpeg_bytes)
        self.assertTrue(jpeg_bytes.startswith(b"\xff\xd8") and jpeg_bytes.endswith(b"\xff\xd9"))
        self.assertEqual(pipeline.last_capture_rect, (100, 50, 1920, 1080))
        self.assertIsNotNone(pipeline.last_stream_size)
        sw, sh = pipeline.last_stream_size
        self.assertEqual(sw, 1080)
        self.assertLessEqual(sh, 620)  # Landscape 16:9 fits width 1080 -> 608 tall, never stretched to 2160

        # Live WS OP_VIEWPORT_RESIZE + OP_DISPLAY_ENUM monitor switch + OP_FRAME_SYNC
        daemon, url = await self._start_daemon(fake_frame=_make_fake_jpeg_bytes())
        mock_monitor_mgr = MagicMock()
        mock_monitor_mgr.enumerate_monitors.return_value = [
            {"index": 1, "width": 1920, "height": 1080, "left": 0, "top": 0, "label": "Display 1"},
            {"index": 2, "width": 2560, "height": 1440, "left": 1920, "top": 0, "label": "Display 2"},
        ]
        daemon.multi_monitor = mock_monitor_mgr
        daemon.screen_pipeline._multi_monitor = mock_monitor_mgr

        ws = await _connect_and_auth(url, daemon.pairing_token.encode("utf-8"))
        try:
            # 8-byte binary portrait resize (height clamped at MAX_H=2160)
            await ws.send(agent_mod.pack_packet(agent_mod.OP_VIEWPORT_RESIZE, struct.pack("!II", 1080, 2400), seq=1))
            await asyncio.sleep(0.05)
            self.assertEqual(daemon.screen_pipeline.target_res, (1080, 2160))

            # JSON resize with quality & monitor=2
            await ws.send(agent_mod.pack_packet(
                agent_mod.OP_VIEWPORT_RESIZE,
                json.dumps({"width": 1280, "height": 720, "quality": 55, "monitor": 2}).encode("utf-8"),
                seq=2,
            ))
            await asyncio.sleep(0.05)
            self.assertEqual(daemon.screen_pipeline.target_res, (1280, 720))
            self.assertEqual(daemon.screen_pipeline.jpeg_quality, 55)
            self.assertEqual(daemon.screen_pipeline.monitor_index, 2)
            mock_monitor_mgr.switch_monitor.assert_called_with(2)

            # 1-byte OP_DISPLAY_ENUM monitor switch -> clamped at 2 when asking for monitor 99
            await ws.send(agent_mod.pack_packet(agent_mod.OP_DISPLAY_ENUM, b"\x63", seq=3))
            while True:
                pkt = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
                if pkt[1] == agent_mod.OP_DISPLAY_ENUM:
                    enum_data = json.loads(pkt[5].decode("utf-8"))
                    self.assertEqual(enum_data["active"], 2)
                    self.assertEqual(len(enum_data["monitors"]), 2)
                    break

            # OP_FRAME_SYNC resets static counter cleanly
            daemon.screen_pipeline.consecutive_static = 9
            await ws.send(agent_mod.pack_packet(agent_mod.OP_FRAME_SYNC, b"", seq=4))
            await asyncio.sleep(0.05)
            self.assertEqual(daemon.screen_pipeline.consecutive_static, 0)
        finally:
            await ws.close()

    async def test_06_input_scaling_media_clipboard_and_view_only_gate(self):
        fake_pyautogui = MagicMock()
        fake_pyperclip = MagicMock()
        fake_pyperclip.paste.return_value = "HOST_CLIPBOARD_DATA"
        fake_user32 = MagicMock()
        fake_ctypes = SimpleNamespace(windll=SimpleNamespace(user32=fake_user32))
        gui_state = agent_gui_mod.HostDaemonState(host="127.0.0.1", port=8765)

        daemon, url = await self._start_daemon(gui_state=gui_state, fake_frame=_make_fake_jpeg_bytes())
        daemon.screen_pipeline.last_stream_size = (1280, 720)
        daemon.screen_pipeline.last_capture_rect = (100, 50, 2560, 1440)

        with patch.object(agent_mod, "pyautogui", fake_pyautogui), \
             patch.object(agent_mod, "pyperclip", fake_pyperclip), \
             patch.object(agent_mod, "ctypes", fake_ctypes):
            ws = await _connect_and_auth(url, daemon.pairing_token.encode("utf-8"))
            try:
                # 1. 6-byte binary trackpad moveRel
                await ws.send(agent_mod.pack_packet(agent_mod.OP_INPUT, struct.pack("!BhhB", 1, 15, -10, 0), seq=1))
                # 2. ScreenViewerModal mouse_click with INPUT_EVENT wrapper & stream->host scaling:
                # (640, 360) in 1280x720 -> center of capture rect (100+1280=1380, 50+720=770)
                await ws.send(json.dumps({
                    "action": "INPUT_EVENT",
                    "type": "mouse_click",
                    "x": 640,
                    "y": 360,
                    "button": "left",
                }))
                # 3. Hotkey using 'command' key & media via OP_INPUT
                await ws.send(agent_mod.pack_packet(agent_mod.OP_INPUT, json.dumps({"action": "hotkey", "command": "ctrl+c"}).encode("utf-8"), seq=2))
                await ws.send(agent_mod.pack_packet(agent_mod.OP_INPUT, json.dumps({"action": "INPUT_EVENT", "kind": "media", "command": "next_track"}).encode("utf-8"), seq=3))
                # 4. OP_AUDIO 2-byte volume_up with 20% steps -> round(20/10)=2 volumeup presses
                await ws.send(agent_mod.pack_packet(agent_mod.OP_AUDIO, bytes([1, 20]), seq=4))
                # 5. OP_CLIP bidirectional sync
                await ws.send(agent_mod.pack_packet(agent_mod.OP_CLIP, b"FROM_PHONE_CLIP", seq=5))

                clip_received = None
                deadline = time.monotonic() + 3.0
                while time.monotonic() < deadline:
                    raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
                    pkt = agent_mod.unpack_packet(raw)
                    if pkt and pkt[1] == agent_mod.OP_CLIP:
                        clip_received = pkt[5].decode("utf-8")
                        break

                self.assertEqual(clip_received, "HOST_CLIPBOARD_DATA")
                fake_pyperclip.copy.assert_any_call("FROM_PHONE_CLIP")
                fake_pyautogui.moveRel.assert_any_call(15, -10, _pause=False)
                fake_pyautogui.click.assert_any_call(x=1380, y=770, button="left", _pause=False)
                fake_pyautogui.hotkey.assert_any_call("ctrl", "c", _pause=False)
                if platform.system() == "Windows":
                    fake_user32.keybd_event.assert_any_call(0xB0, 0, 0, 0)
                    vol_up_calls = [c for c in fake_user32.keybd_event.call_args_list if c.args[:3] == (0xAF, 0, 0)]
                    self.assertGreaterEqual(len(vol_up_calls), 2)
                else:
                    fake_pyautogui.press.assert_any_call("nexttrack")
                    vol_up_calls = [c for c in fake_pyautogui.press.call_args_list if c.args == ("volumeup",)]
                    self.assertGreaterEqual(len(vol_up_calls), 2)

                # View-only mode blocks further clicks
                fake_pyautogui.click.reset_mock()
                gui_state.view_only_mode = True
                await ws.send(agent_mod.pack_packet(agent_mod.OP_INPUT, json.dumps({"action": "click", "button": "right"}).encode("utf-8"), seq=6))
                await asyncio.sleep(0.05)
                fake_pyautogui.click.assert_not_called()
            finally:
                await ws.close()

    async def test_07_ast_firewall_shell_and_hitl_gates(self):
        daemon, url = await self._start_daemon(fake_frame=_make_fake_jpeg_bytes())

        # Windows backslash path must pass AstCommandInspector on Windows cleanly
        if platform.system() == "Windows":
            is_dang, _ = agent_mod.AstCommandInspector.inspect(r'echo C:\Users\demo\notes.txt')
            self.assertFalse(is_dang)

        ws = await _connect_and_auth(url, daemon.pairing_token.encode("utf-8"))
        try:
            # Safe shell execution via OP_SHELL
            await ws.send(agent_mod.pack_packet(agent_mod.OP_SHELL, b"echo DAEMON_SHELL_OK", seq=1))
            shell_res = None
            deadline = time.monotonic() + 8.0
            while time.monotonic() < deadline:
                pkt = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=5.0))
                if pkt and pkt[1] == agent_mod.OP_SHELL:
                    shell_res = json.loads(pkt[5].decode("utf-8"))
                    break
            self.assertIsNotNone(shell_res)
            self.assertEqual(shell_res["status"], "success")
            self.assertIn("DAEMON_SHELL_OK", shell_res["output"])

            # AST Blocked command
            await ws.send(agent_mod.pack_packet(agent_mod.OP_SHELL, b"powershell -EncodedCommand ZQBjAGgAbwA=", seq=2))
            blocked_res = None
            while time.monotonic() < time.monotonic() + 3.0:
                pkt = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
                if pkt and pkt[1] == agent_mod.OP_SHELL:
                    blocked_res = json.loads(pkt[5].decode("utf-8"))
                    break
            self.assertEqual(blocked_res["status"], "rejected")
            self.assertEqual(blocked_res["risk_level"], "BLOCKED")

            # HITL Biometric Gate under strict profile ignores remote approval & resolves via local host approve/deny
            daemon.security_profile = "zero_trust"
            await ws.send(agent_mod.pack_packet(agent_mod.OP_SHELL, b"taskkill /IM nonexistent_xyz_app.exe", seq=3))
            hitl_req = None
            while time.monotonic() < time.monotonic() + 3.0:
                pkt = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
                if pkt and pkt[1] == agent_mod.OP_HITL:
                    hitl_req = json.loads(pkt[5].decode("utf-8"))
                    break
            self.assertIsNotNone(hitl_req)
            aid = hitl_req["approval_id"]
            proof = f"{aid}:{hitl_req['challenge_nonce']}:{hitl_req['command']}".encode("utf-8")
            sig = hmac.new(daemon.pairing_token.encode("utf-8"), proof, hashlib.sha256).hexdigest()

            # Under zero_trust, remote HMAC approval is ignored
            await ws.send(agent_mod.pack_packet(
                agent_mod.OP_HITL,
                json.dumps({"approval_id": aid, "approved": True, "signature": sig}).encode("utf-8"),
                seq=4,
            ))
            await asyncio.sleep(0.08)
            self.assertIn(aid, daemon.pending_approvals)
            # Local operator denies it
            daemon.resolve_local_hitl(aid, False)
            while True:
                pkt = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
                if pkt and pkt[1] == agent_mod.OP_SHELL:
                    denied_res = json.loads(pkt[5].decode("utf-8"))
                    self.assertEqual(denied_res["status"], "rejected")
                    self.assertIn("HITL", denied_res["output"])
                    break
        finally:
            await ws.close()

    async def test_08_file_transfer_aead_verified_and_traversal_blocked(self):
        daemon, url = await self._start_daemon(fake_frame=_make_fake_jpeg_bytes())
        ws = await _connect_and_auth(url, daemon.pairing_token.encode("utf-8"))
        try:
            # Upgrade to AEAD vault to verify encrypted OP_FILE_TRANSFER ACKs carry seq >= 1
            await ws.send(agent_mod.pack_packet(agent_mod.OP_AUTH, b"INIT_ECDH_VAULT", seq=1))
            chal = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))[5]
            cv = _ClientVaultSession(daemon.pairing_token.encode("utf-8"))
            await ws.send(agent_mod.pack_packet(agent_mod.OP_AUTH, cv.build_handshake_response(chal), seq=2))
            self.assertEqual(agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))[5], b"OK_ECDH_VAULT")

            data = b"AI_NET_E2E_BINARY_PAYLOAD_" * 512
            digest_hex = hashlib.sha256(data).hexdigest().encode("ascii")

            async def _recv_ft_ack():
                while True:
                    raw = await asyncio.wait_for(ws.recv(), timeout=4.0)
                    op, _, seq, plain = cv.decrypt_packet(raw)
                    if op == agent_mod.OP_FILE_TRANSFER:
                        self.assertGreaterEqual(seq, 1)
                        tid, st, written = struct.unpack_from("!IBQ", plain, 0)
                        return tid, st, written

            # Traversal / blocked extension check
            bad_init = struct.pack("!BIQ", CMD_INIT, 100, len(data)) + digest_hex + b"../../evil.exe"
            await ws.send(cv.encrypt_packet(agent_mod.OP_FILE_TRANSFER, bad_init, seq=1))
            _, bad_st, _ = await _recv_ft_ack()
            self.assertEqual(bad_st, STATUS_ERR_TRAVERSAL)

            # Valid chunked transfer
            tid = 101
            init_p = struct.pack("!BIQ", CMD_INIT, tid, len(data)) + digest_hex + b"sample_doc.txt"
            await ws.send(cv.encrypt_packet(agent_mod.OP_FILE_TRANSFER, init_p, seq=2))
            _, st1, _ = await _recv_ft_ack()
            self.assertEqual(st1, STATUS_OK)

            chunk_p = struct.pack("!BIQ", CMD_CHUNK, tid, 0) + data
            await ws.send(cv.encrypt_packet(agent_mod.OP_FILE_TRANSFER, chunk_p, seq=3))
            _, st2, written2 = await _recv_ft_ack()
            self.assertEqual(st2, STATUS_PROGRESS)
            self.assertEqual(written2, len(data))

            fin_p = struct.pack("!BI", CMD_FINISH, tid)
            await ws.send(cv.encrypt_packet(agent_mod.OP_FILE_TRANSFER, fin_p, seq=4))
            _, st3, written3 = await _recv_ft_ack()
            self.assertEqual(st3, STATUS_COMPLETED)
            self.assertEqual(written3, len(data))

            saved_path = self.dl_dir / "sample_doc.txt"
            self.assertTrue(saved_path.is_file())
            self.assertEqual(saved_path.read_bytes(), data)
        finally:
            await ws.close()

    async def test_09_ollama_loopback_streaming(self):
        class _MockOllamaHandler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                _ = self.rfile.read(length)
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson")
                self.end_headers()
                for line in (
                    b'{"response":"Ollama ","done":false}\n',
                    b'{"response":"OK","done":true}\n',
                ):
                    self.wfile.write(line)
                    self.wfile.flush()

            def log_message(self, format, *args):
                return

        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _MockOllamaHandler)
        srv_port = srv.server_address[1]
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            daemon, url = await self._start_daemon(fake_frame=_make_fake_jpeg_bytes())
            ws = await _connect_and_auth(url, daemon.pairing_token.encode("utf-8"))
            try:
                with patch.dict(os.environ, {"OLLAMA_HOST": f"http://127.0.0.1:{srv_port}"}):
                    await ws.send(agent_mod.pack_packet(
                        agent_mod.OP_LLM_STREAM,
                        json.dumps({"model": "qwen2.5-coder:latest", "prompt": "hi"}).encode("utf-8"),
                        seq=1,
                    ))
                    tokens = []
                    deadline = time.monotonic() + 4.0
                    while time.monotonic() < deadline and "".join(tokens) != "Ollama OK":
                        pkt = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
                        if pkt and pkt[1] == agent_mod.OP_LLM_STREAM:
                            self.assertGreaterEqual(pkt[3], 1)
                            tokens.append(pkt[5].decode("utf-8"))
                    self.assertEqual("".join(tokens), "Ollama OK")
            finally:
                await ws.close()
        finally:
            srv.shutdown()
            srv.server_close()

    async def test_10_panic_kill_and_resilient_service_supervision(self):
        daemon, url = await self._start_daemon(fake_frame=_make_fake_jpeg_bytes())
        ws = await _connect_and_auth(url, daemon.pairing_token.encode("utf-8"))
        try:
            await ws.send(json.dumps({"action": "PANIC_KILL_ALL"}))
            ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
            self.assertEqual(ack["event"], "PANIC_ACK")
        finally:
            await ws.close()

        # Stop previous daemon cleanly before testing _run_agent_services
        await daemon.async_stop()
        self.daemon = None
        port2 = _free_tcp_port()
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("AI_AGENT_SECRET", None)
        ws_daemon2 = agent_mod.HostAgentDaemon(
            host="127.0.0.1",
            port=port2,
            enable_tray=False,
            enable_mdns=False,
        )
        ws_daemon2.file_writer = HostFileWriter(download_dir=str(self.dl_dir))
        ws_daemon2._start_system_tray = lambda: None

        async def _noop_mdns():
            return None

        ws_daemon2._start_mdns = _noop_mdns

        fake_ipc = SimpleNamespace(running=True)

        async def _failing_ipc_run():
            fake_ipc.running = False
            raise RuntimeError("Simulated IPC port 8766 failure")

        fake_ipc.run = _failing_ipc_run
        fake_ipc.stop = lambda: setattr(fake_ipc, "running", False)

        svc_task = asyncio.create_task(agent_daemon_mod._run_agent_services(ws_daemon2, fake_ipc))
        await asyncio.sleep(0.35)
        # Even though DaemonServer failed, WebSocket HostAgentDaemon on port2 stays alive!
        self.assertTrue(ws_daemon2.is_running)
        ws2 = await _connect_and_auth(f"ws://127.0.0.1:{port2}", ws_daemon2.pairing_token.encode("utf-8"))
        await ws2.close()
        await ws_daemon2.async_stop()
        await asyncio.wait_for(svc_task, timeout=3.0)


if __name__ == "__main__":
    unittest.main()
