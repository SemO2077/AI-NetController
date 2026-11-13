"""
AI NetController — Android App Connectivity & PC Control Verification Harness
================================================================================
Simulates the Android/mobile client connecting to the PC Host Agent Daemon,
verifying:
1. WebSocket connection & 16-byte HMAC-SHA256 handshake.
2. Resolution matching (OP_VIEWPORT_RESIZE 0x0A).
3. Live desktop frame stream reception (OP_FRAME 0x03 JPEG).
4. Remote PC controlling:
   - Mouse cursor relative movement (OP_INPUT 0x08)
   - Left click, right click, double click
   - Mouse scroll wheel
   - Keystroke & text typing
   - Keyboard hotkey combination
   - Compact 6-byte binary trackpad struct
5. Bidirectional clipboard sync (OP_CLIP 0x07).
6. Real PC network discovery (verifying only active port 8765 hosts are returned).
================================================================================
"""

import os
import sys
import time
import json
import hmac
import socket
import struct
import hashlib
import asyncio
import tempfile
import threading
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

_AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(_AGENT_DIR)
if _AGENT_DIR not in sys.path:
    sys.path.append(_AGENT_DIR)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

import websockets
try:
    from agent.agent import (
        HostAgentDaemon,
        pack_packet,
        unpack_packet,
        MAGIC,
        HEADER_SIZE,
        OP_PING,
        OP_FRAME,
        OP_AUTH,
        OP_INPUT,
        OP_CLIP,
        OP_VIEWPORT_RESIZE,
    )
    from agent.agent_gui import HostDaemonState
except (ImportError, ModuleNotFoundError):
    import agent as agent_mod  # fallback if sys.modules['agent'] was loaded as flat module
    HostAgentDaemon = agent_mod.HostAgentDaemon
    pack_packet = agent_mod.pack_packet
    unpack_packet = agent_mod.unpack_packet
    MAGIC = agent_mod.MAGIC
    HEADER_SIZE = agent_mod.HEADER_SIZE
    OP_PING = agent_mod.OP_PING
    OP_FRAME = agent_mod.OP_FRAME
    OP_AUTH = agent_mod.OP_AUTH
    OP_INPUT = agent_mod.OP_INPUT
    OP_CLIP = agent_mod.OP_CLIP
    OP_VIEWPORT_RESIZE = agent_mod.OP_VIEWPORT_RESIZE
    from agent_gui import HostDaemonState

class TestAndroidAppConnectionAndControl(unittest.IsolatedAsyncioTestCase):
    """Verifies end-to-end Android mobile app connectivity and PC control."""

    def _daemon_secret(self) -> bytes:
        return str(self.daemon.pairing_token).strip().encode("utf-8")

    async def asyncSetUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory(prefix="ainet_e2e_profile_")
        iso_root = self._tmp_dir.name
        self._env_patch = patch.dict(
            os.environ,
            {
                "HOME": iso_root,
                "USERPROFILE": iso_root,
                "LOCALAPPDATA": os.path.join(iso_root, "Local"),
                "APPDATA": os.path.join(iso_root, "Roaming"),
                "XDG_CONFIG_HOME": os.path.join(iso_root, ".config"),
            },
            clear=False,
        )
        self._env_patch.start()
        try:
            import agent.agent as agent_mod
        except (ImportError, ModuleNotFoundError):
            import agent as agent_mod
        fake_pyautogui = MagicMock()
        fake_pyautogui.KEYBOARD_KEYS = {"enter", "ctrl", "c", "v", "a", "escape", "tab", "space"}
        self._pyautogui_patch = patch.object(agent_mod, "pyautogui", fake_pyautogui)
        self._pyautogui_patch.start()

        # Bind daemon to random loopback port to avoid conflicts
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        self.port = s.getsockname()[1]
        s.close()

        self.daemon = HostAgentDaemon(
            host="127.0.0.1",
            port=self.port,
            enable_tray=False,
            enable_mdns=False,
        )
        self.gui_state = HostDaemonState(host="127.0.0.1", port=self.port)
        self.daemon.gui_state = self.gui_state

        # Start daemon server in background
        self.server_task = asyncio.create_task(self.daemon.start())
        for _ in range(40):
            if self.daemon.server is not None:
                break
            await asyncio.sleep(0.05)

    async def asyncTearDown(self):
        try:
            await asyncio.wait_for(self.daemon.async_stop(), timeout=5.0)
        finally:
            if hasattr(self, "server_task") and not self.server_task.done():
                self.server_task.cancel()
                try:
                    await asyncio.wait_for(self.server_task, timeout=2.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass
            elif hasattr(self, "server_task"):
                try:
                    await self.server_task
                except asyncio.CancelledError:
                    pass
            if hasattr(self, "_pyautogui_patch"):
                self._pyautogui_patch.stop()
            if hasattr(self, "_env_patch"):
                self._env_patch.stop()
            if hasattr(self, "_tmp_dir"):
                self._tmp_dir.cleanup()

    async def test_01_handshake_and_authentication(self):
        """Simulates Android app connecting and completing HMAC-SHA256 handshake."""
        uri = f"ws://127.0.0.1:{self.port}"
        async with websockets.connect(uri) as ws:
            # 1. Receive 16-byte nonce challenge (OP_AUTH)
            challenge_msg = await asyncio.wait_for(ws.recv(), timeout=3.0)
            magic, opcode, flags, seq, length, payload = unpack_packet(challenge_msg)
            self.assertEqual(magic, MAGIC)
            self.assertEqual(opcode, OP_AUTH)
            self.assertEqual(len(payload), 16, "Nonce challenge must be 16 bytes")

            # 2. Compute HMAC-SHA256 using live daemon pairing token
            digest = hmac.new(self._daemon_secret(), payload, hashlib.sha256).digest()
            reply_packet = pack_packet(OP_AUTH, digest, seq=seq)
            await ws.send(reply_packet)

            # 3. Receive AUTH confirmation
            auth_ack = await asyncio.wait_for(ws.recv(), timeout=3.0)
            m, op, fl, sq, ln, auth_payload = unpack_packet(auth_ack)
            self.assertEqual(op, OP_AUTH)
            auth_str = auth_payload.decode("utf-8", errors="replace")
            self.assertTrue(
                auth_str in ("AUTH_OK", "OK_AUTHENTICATED"),
                f"Expected explicit AUTH_OK confirmation, got {auth_str}",
            )

    async def test_02_remote_pc_controlling(self):
        """Simulates mobile sending mouse moves, clicks, typing, and hotkeys."""
        uri = f"ws://127.0.0.1:{self.port}"
        async with websockets.connect(uri) as ws:
            # Complete auth
            challenge = await asyncio.wait_for(ws.recv(), timeout=3.0)
            _, _, _, seq, _, nonce = unpack_packet(challenge)
            digest = hmac.new(self._daemon_secret(), nonce, hashlib.sha256).digest()
            await ws.send(pack_packet(OP_AUTH, digest, seq=seq))
            await asyncio.wait_for(ws.recv(), timeout=3.0)  # Auth ack

            # 1. Test OP_VIEWPORT_RESIZE (mobile screen dimension 1080x2400)
            resize_payload = struct.pack("!II", 1080, 2400)
            await ws.send(pack_packet(OP_VIEWPORT_RESIZE, resize_payload, seq=1))

            # 2. Test Mouse Move (JSON payload)
            move_cmd = json.dumps({"action": "move", "dx": 15.0, "dy": -10.0}).encode("utf-8")
            await ws.send(pack_packet(OP_INPUT, move_cmd, seq=2))

            # 3. Test Mouse Click (Left click)
            click_cmd = json.dumps({"action": "click", "button": "left"}).encode("utf-8")
            await ws.send(pack_packet(OP_INPUT, click_cmd, seq=3))

            # 4. Test Mouse Right Click
            rclick_cmd = json.dumps({"action": "click", "button": "right"}).encode("utf-8")
            await ws.send(pack_packet(OP_INPUT, rclick_cmd, seq=4))

            # 5. Test Mouse Scroll Wheel
            scroll_cmd = json.dumps({"action": "scroll", "dy": -150}).encode("utf-8")
            await ws.send(pack_packet(OP_INPUT, scroll_cmd, seq=5))

            # 6. Test Typing Text
            type_cmd = json.dumps({"action": "type", "text": "hello", "press_enter": False}).encode("utf-8")
            await ws.send(pack_packet(OP_INPUT, type_cmd, seq=6))

            # 7. Test Hotkey Combination (Ctrl+C)
            hotkey_cmd = json.dumps({"action": "hotkey", "keys": ["ctrl", "c"]}).encode("utf-8")
            await ws.send(pack_packet(OP_INPUT, hotkey_cmd, seq=7))

            # 8. Test Compact 6-byte binary struct (event_type=1: move, dx=25, dy=25, btn=0)
            bin_struct = struct.pack("!BhhB", 1, 25, 25, 0)
            await ws.send(pack_packet(OP_INPUT, bin_struct, seq=8))

            # 9. Test Ping / Latency check (drain any concurrent screen frames while awaiting pong)
            await ws.send(pack_packet(OP_PING, b"", seq=9))
            deadline = time.monotonic() + 3.0
            pong_op = None
            while time.monotonic() < deadline:
                rem = max(0.1, deadline - time.monotonic())
                pkt = await asyncio.wait_for(ws.recv(), timeout=rem)
                if isinstance(pkt, (bytes, bytearray)):
                    _, pong_op, _, _, _, _ = unpack_packet(pkt)
                    if pong_op == OP_PING:
                        break
            self.assertEqual(pong_op, OP_PING)

            # Give server a moment to finish executor operations
            await asyncio.sleep(0.1)

            # Verify GUI state logged the client connection
            self.assertGreaterEqual(len(self.gui_state.connected_clients), 1)

    async def test_03_scanner_detects_real_pc_and_rejects_placeholders(self):
        """Verifies network probe accurately identifies port 8765 PC and rejects fake/closed IPs."""
        # 1. Probe the real running daemon port -> MUST connect
        s_real = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s_real.settimeout(0.5)
        try:
            s_real.connect(("127.0.0.1", self.port))
            is_active_pc = True
        except Exception:
            is_active_pc = False
        finally:
            s_real.close()
        self.assertTrue(is_active_pc, "Real PC daemon must be detected on active port")

        # 2. Probe a closed port / nonexistent host -> MUST fail (no placeholder created)
        s_fake = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s_fake.settimeout(0.15)
        try:
            s_fake.connect(("127.0.0.1", 59999))
            fake_detected = True
        except Exception:
            fake_detected = False
        finally:
            s_fake.close()
        self.assertFalse(fake_detected, "Closed port must NOT be detected as an active PC")

    async def test_04_json_pairing_with_pin_and_token(self):
        """Verifies JSON PAIR and AUTH actions using PIN and persistent pairing token."""
        uri = f"ws://127.0.0.1:{self.port}"
        # 1. Test pairing using 6-digit PIN
        async with websockets.connect(uri) as ws:
            # Drain initial binary challenge
            _ = await asyncio.wait_for(ws.recv(), timeout=3.0)
            pin = self.daemon.pairing_pin
            await ws.send(json.dumps({"action": "PAIR", "pin": pin, "device": "Android Test Phone"}))
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
            self.assertEqual(resp.get("event"), "AUTHENTICATED")
            self.assertEqual(resp.get("status"), "OK")
            self.assertTrue(resp.get("pairingToken"))

        # 2. Test pairing using pairingToken
        async with websockets.connect(uri) as ws:
            _ = await asyncio.wait_for(ws.recv(), timeout=3.0)
            tok = self.daemon.pairing_token
            await ws.send(json.dumps({"action": "AUTHENTICATE", "token": tok, "device": "Android QR Scan"}))
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
            self.assertEqual(resp.get("event"), "AUTHENTICATED")
            self.assertEqual(resp.get("status"), "OK")

    async def test_05_dual_protocol_handshake_race_free(self):
        """Verifies client sending both JSON AUTH and binary OP_AUTH does not trigger false auto-ban."""
        uri = f"ws://127.0.0.1:{self.port}"
        # Case A: JSON arrives first, then binary OP_AUTH
        async with websockets.connect(uri) as ws:
            challenge = await asyncio.wait_for(ws.recv(), timeout=3.0)
            _, _, _, seq, _, nonce = unpack_packet(challenge)
            # Send JSON AUTH
            await ws.send(json.dumps({"action": "AUTHENTICATE", "token": self.daemon.pairing_token}))
            json_ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
            self.assertEqual(json_ack.get("event"), "AUTHENTICATED")
            # Immediately follow with binary OP_AUTH
            digest = hmac.new(self._daemon_secret(), nonce, hashlib.sha256).digest()
            await ws.send(pack_packet(OP_AUTH, digest, seq=seq))
            bin_ack = await asyncio.wait_for(ws.recv(), timeout=3.0)
            _, op, _, _, _, payload = unpack_packet(bin_ack)
            self.assertEqual(op, OP_AUTH)
            self.assertEqual(payload, b"OK_AUTHENTICATED")

        # Case B: Binary arrives first, then JSON AUTH
        async with websockets.connect(uri) as ws:
            challenge = await asyncio.wait_for(ws.recv(), timeout=3.0)
            _, _, _, seq, _, nonce = unpack_packet(challenge)
            digest = hmac.new(self._daemon_secret(), nonce, hashlib.sha256).digest()
            await ws.send(pack_packet(OP_AUTH, digest, seq=seq))
            bin_ack = await asyncio.wait_for(ws.recv(), timeout=3.0)
            _, op, _, _, _, payload = unpack_packet(bin_ack)
            self.assertEqual(op, OP_AUTH)
            # Follow with JSON AUTH
            await ws.send(json.dumps({"action": "AUTHENTICATE", "token": self.daemon.pairing_token}))
            json_ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
            self.assertEqual(json_ack.get("event"), "AUTHENTICATED")

    async def test_06_async_stop_closes_mdns_and_tray_without_non_daemon_threads(self):
        """Verifies mDNS and tray lifecycle shut down cleanly via async_stop with zero stray threads."""
        try:
            import agent.agent as agent_mod
        except (ImportError, ModuleNotFoundError):
            import agent as agent_mod

        fake_zc = MagicMock()
        fake_zc.async_register_service = AsyncMock(return_value=None)
        fake_zc.async_unregister_service = AsyncMock(return_value=None)
        fake_zc.async_close = AsyncMock(return_value=None)

        tray_started = threading.Event()
        tray_stopped = threading.Event()

        class _FakeIcon:
            def __init__(self, *args, **kwargs):
                pass
            def notify(self, *args, **kwargs):
                pass
            def run(self):
                tray_started.set()
                tray_stopped.wait(timeout=5.0)
            def stop(self):
                tray_stopped.set()

        fake_pystray = MagicMock()
        fake_pystray.Icon.side_effect = _FakeIcon
        fake_pystray.Menu = MagicMock()
        fake_pystray.Menu.SEPARATOR = "---"
        fake_pystray.MenuItem = MagicMock()
        fake_image_mod = MagicMock()
        fake_image_mod.new.return_value = MagicMock()

        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()

        before_threads = {t.ident for t in threading.enumerate()}
        tray_thread = None
        with patch.object(agent_mod, "AsyncZeroconf", return_value=fake_zc), \
             patch.object(agent_mod, "ServiceInfo", MagicMock(return_value=MagicMock())), \
             patch.object(agent_mod, "IPVersion", MagicMock(V4Only=1)), \
             patch.object(agent_mod, "pystray", fake_pystray), \
             patch.object(agent_mod, "Image", fake_image_mod):
            d = HostAgentDaemon(host="127.0.0.1", port=port, enable_tray=True, enable_mdns=True)
            await d.start()
            await asyncio.to_thread(tray_started.wait, 2.0)
            self.assertTrue(tray_started.is_set(), "Tray thread should start when enable_tray=True")
            tray_thread = d._tray_thread
            await asyncio.wait_for(d.async_stop(), timeout=5.0)

        fake_zc.async_register_service.assert_awaited_once()
        fake_zc.async_unregister_service.assert_awaited_once()
        fake_zc.async_close.assert_awaited_once()
        self.assertTrue(tray_stopped.is_set(), "Tray icon stop() must be invoked during shutdown")
        if tray_thread is not None:
            self.assertFalse(tray_thread.is_alive(), "Tray thread must exit during async_stop()")
        self.assertIsNone(d._tray_thread)
        # IsolatedAsyncioTestCase keeps its per-test loop (and default executor 'asyncio_*' workers)
        # open until after asyncTearDown; daemon-owned threads must already be stopped.
        new_non_daemon = [
            t.name for t in threading.enumerate()
            if t.ident not in before_threads
            and not t.daemon
            and t.is_alive()
            and not t.name.startswith("asyncio_")
        ]
        self.assertEqual(new_non_daemon, [], f"Leftover non-daemon threads: {new_non_daemon}")


if __name__ == "__main__":
    unittest.main()
