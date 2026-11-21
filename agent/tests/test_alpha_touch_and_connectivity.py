"""
Alpha-Testing Release Suite: Direct Touchscreen Input, Visible Cursor & LAN Connectivity
=========================================================================================
Verifies:
1. Extended OP_INPUT (0x08) binary types 4 (abs move), 5 (abs click), 6 (abs button
   down/up for drag-and-drop), 7 (2D scroll) + 100% backwards compatibility with 1/2/3.
2. Normalized JSON OP_INPUT (`nx`/`ny` in 0..1 across primary, secondary, and negative-offset
   monitors), `mouse_down`, `mouse_up`, `hscroll`, primary screen fallback when
   `last_capture_rect` is missing, and View-Only Mode gating.
3. CursorOverlayCompositor safety (headless/Linux/mocked ctypes, read-only numpy buffers,
   edge clipping, Pillow & numpy arrow compositing, static-frame motion wakeup on cursor move).
4. Lightweight LAN UDP Discovery Responder (`CST_DISCOVER_V1` -> strict zero-secret JSON,
   invalid probe drop, graceful skip when UDP port is busy, clean shutdown).
5. Viewport resize (`width/height/quality/fps/stream_enabled`) resilience, fast keyframe
   delivery right after `OK_ECDH_VAULT` on static desktop, and transient frame timeout handling.
"""

import asyncio
import hashlib
import hmac
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
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
from PIL import Image
import websockets

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

import daemon_config as daemon_config_mod
from crypto_vault import (
    CTX_CLIENT_TX,
    CTX_HOST_TX,
    FallbackChaCha20Poly1305,
    FallbackCurve25519,
    PROTOCOL_MAGIC,
    hkdf_extract_and_expand,
)


def _free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _make_bgra_frame(width: int = 160, height: int = 120, b: int = 90, g: int = 90, r: int = 90) -> bytearray:
    arr = np.empty((height, width, 4), dtype=np.uint8)
    arr[:, :, 0] = b
    arr[:, :, 1] = g
    arr[:, :, 2] = r
    arr[:, :, 3] = 255
    return bytearray(arr.tobytes())


def _make_shot(buf: bytes, width: int = 160, height: int = 120):
    raw_bytes = bytes(buf)
    return SimpleNamespace(
        width=width,
        height=height,
        size=(width, height),
        bgra=raw_bytes,
        raw=raw_bytes,
    )


class TestAlphaBinaryAndJsonTouchInput(unittest.IsolatedAsyncioTestCase):
    """Covers binary OP_INPUT types 1..7, JSON nx/ny, mouse_down/up, hscroll, and fallback."""

    async def asyncSetUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="ai_net_alpha_input_")
        self.cfg_path = os.path.join(self.tmpdir, "config.json")
        self._env_patch = patch.dict(
            os.environ,
            {
                "HOME": self.tmpdir,
                "USERPROFILE": self.tmpdir,
                "LOCALAPPDATA": os.path.join(self.tmpdir, "Local"),
                "APPDATA": os.path.join(self.tmpdir, "Roaming"),
                "XDG_CONFIG_HOME": os.path.join(self.tmpdir, ".config"),
            },
            clear=False,
        )
        self._env_patch.start()
        self.cfg_patch = patch.object(daemon_config_mod, "get_config_path", return_value=self.cfg_path)
        self.agent_cfg_patch = patch.object(agent_mod, "get_config_path", return_value=self.cfg_path)
        self.cfg_patch.start()
        self.agent_cfg_patch.start()
        self.daemon = agent_mod.HostAgentDaemon(
            host="127.0.0.1",
            port=0,
            enable_tray=False,
            enable_mdns=False,
            enable_udp_discovery=False,
        )
        self.daemon.view_only_mode = False

    async def asyncTearDown(self):
        self.daemon.screen_pipeline.close()
        if self.daemon.multi_monitor:
            self.daemon.multi_monitor.close()
        self.agent_cfg_patch.stop()
        self.cfg_patch.stop()
        self._env_patch.stop()
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    async def test_01_binary_types_1_2_3_backwards_compatibility(self):
        fake_gui = MagicMock()
        with patch.object(agent_mod, "pyautogui", fake_gui), patch.object(self.daemon, "_wake_stream") as wake_spy:
            await self.daemon._process_virtual_input(struct.pack("!BhhB", 1, 120, -45, 0), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BhhB", 2, 0, 0, 1), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BhhB", 2, 0, 0, 2), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BhhB", 2, 0, 0, 3), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BhhB", 2, 0, 0, 4), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BhhB", 3, 0, -240, 0), ws=None)

        fake_gui.moveRel.assert_called_once_with(120, -45, _pause=False)
        self.assertEqual(fake_gui.click.call_count, 3)
        fake_gui.click.assert_any_call(button="left", _pause=False)
        fake_gui.click.assert_any_call(button="right", _pause=False)
        fake_gui.click.assert_any_call(button="middle", _pause=False)
        fake_gui.doubleClick.assert_called_once_with(_pause=False)
        fake_gui.scroll.assert_called_once_with(-240, _pause=False)
        self.assertEqual(wake_spy.call_count, 6)

    async def test_02_binary_type_4_absolute_move_multi_monitor_rects(self):
        fake_gui = MagicMock()
        with patch.object(agent_mod, "pyautogui", fake_gui), patch.object(self.daemon, "_wake_stream") as wake_spy:
            # Primary monitor 1920x1080 at (0, 0)
            self.daemon.screen_pipeline.last_capture_rect = (0, 0, 1920, 1080)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 0, 0, 0), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 65535, 65535, 0), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 32768, 32768, 0), ws=None)

            # Secondary monitor to the right (1920, 100, 2560, 1440)
            self.daemon.screen_pipeline.last_capture_rect = (1920, 100, 2560, 1440)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 0, 0, 0), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 65535, 65535, 0), ws=None)

            # Left-offset monitor with negative coordinates (-1920, 0, 1920, 1080)
            self.daemon.screen_pipeline.last_capture_rect = (-1920, 0, 1920, 1080)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 0, 0, 0), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 65535, 65535, 0), ws=None)

        calls = [c.args for c in fake_gui.moveTo.call_args_list]
        self.assertEqual(
            calls,
            [
                (0, 0),
                (1919, 1079),
                (960, 540),
                (1920, 100),
                (4479, 1539),
                (-1920, 0),
                (-1, 1079),
            ],
        )
        self.assertEqual(wake_spy.call_count, 7)

    async def test_03_binary_type_5_absolute_clicks(self):
        fake_gui = MagicMock()
        self.daemon.screen_pipeline.last_capture_rect = (100, 200, 1001, 501)
        # ux=32768/65535 ~= 0.5000076 -> 100 + 500 = 600, 200 + 250 = 450
        with patch.object(agent_mod, "pyautogui", fake_gui), patch.object(self.daemon, "_wake_stream") as wake_spy:
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 5, 32768, 32768, 1), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 5, 32768, 32768, 2), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 5, 32768, 32768, 3), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 5, 65535, 0, 4), ws=None)

        fake_gui.click.assert_any_call(x=600, y=450, button="left", _pause=False)
        fake_gui.click.assert_any_call(x=600, y=450, button="right", _pause=False)
        fake_gui.click.assert_any_call(x=600, y=450, button="middle", _pause=False)
        fake_gui.doubleClick.assert_called_once_with(x=1100, y=200, _pause=False)
        self.assertEqual(wake_spy.call_count, 4)

    async def test_04_binary_type_6_absolute_mouse_down_up_and_drag(self):
        fake_gui = MagicMock()
        self.daemon.screen_pipeline.last_capture_rect = (0, 0, 1001, 1001)
        with patch.object(agent_mod, "pyautogui", fake_gui), patch.object(self.daemon, "_wake_stream") as wake_spy:
            # Drag sequence: left_down at (0,0) -> move to center -> left_up at (1000, 1000)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 6, 0, 0, 1), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 32768, 32768, 0), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 6, 65535, 65535, 2), ws=None)
            # Right & middle down/up
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 6, 0, 65535, 3), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 6, 0, 65535, 4), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 6, 65535, 0, 5), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 6, 65535, 0, 6), ws=None)
            # Invalid btn_code -> safe no-op
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 6, 0, 0, 99), ws=None)

        fake_gui.mouseDown.assert_any_call(x=0, y=0, button="left", _pause=False)
        fake_gui.moveTo.assert_called_once_with(500, 500, _pause=False)
        fake_gui.mouseUp.assert_any_call(x=1000, y=1000, button="left", _pause=False)
        fake_gui.mouseDown.assert_any_call(x=0, y=1000, button="right", _pause=False)
        fake_gui.mouseUp.assert_any_call(x=0, y=1000, button="right", _pause=False)
        fake_gui.mouseDown.assert_any_call(x=1000, y=0, button="middle", _pause=False)
        fake_gui.mouseUp.assert_any_call(x=1000, y=0, button="middle", _pause=False)
        self.assertEqual(fake_gui.mouseDown.call_count, 3)
        self.assertEqual(fake_gui.mouseUp.call_count, 3)
        self.assertEqual(wake_spy.call_count, 8)

    async def test_05_binary_type_7_2d_scroll_and_clamping(self):
        fake_gui = MagicMock()
        with patch.object(agent_mod, "pyautogui", fake_gui), patch.object(self.daemon, "_wake_stream") as wake_spy:
            # Both horizontal & vertical
            await self.daemon._process_virtual_input(struct.pack("!BhhB", 7, 180, -320, 0), ws=None)
            # Vertical only
            await self.daemon._process_virtual_input(struct.pack("!BhhB", 7, 0, 120, 0), ws=None)
            # Horizontal only
            await self.daemon._process_virtual_input(struct.pack("!BhhB", 7, -90, 0, 0), ws=None)
            # Extreme values clamp to [-5000, 5000]
            await self.daemon._process_virtual_input(struct.pack("!BhhB", 7, 25000, -25000, 0), ws=None)

        self.assertEqual(
            [c.args for c in fake_gui.scroll.call_args_list],
            [(-320,), (120,), (-5000,)],
        )
        self.assertEqual(
            [c.args for c in fake_gui.hscroll.call_args_list],
            [(180,), (-90,), (5000,)],
        )
        self.assertEqual(wake_spy.call_count, 4)

    async def test_06_json_normalized_nx_ny_mouse_down_up_and_hscroll(self):
        fake_gui = MagicMock()
        self.daemon.screen_pipeline.last_capture_rect = (100, 200, 1001, 501)
        self.daemon.screen_pipeline.last_stream_size = (1001, 501)

        with patch.object(agent_mod, "pyautogui", fake_gui), patch.object(self.daemon, "_wake_stream") as wake_spy:
            events = [
                {"action": "move_to", "nx": 0.5, "ny": 0.5},
                {"action": "click_at", "nx": 0.0, "ny": 1.0, "button": "left"},
                {"action": "double_click_at", "nx": 1.0, "ny": 0.0},
                {"action": "right_click_at", "nx": -0.5, "ny": 2.5},  # clamped -> (0.0, 1.0)
                {"action": "scroll_at", "nx": 0.5, "ny": 0.5, "dy": -120},
                {"action": "mouse_down", "nx": 0.25, "ny": 0.5, "button": "left"},
                {"action": "mouse_up", "nx": 0.75, "ny": 0.5, "button": "left"},
                {"action": "mouse_down", "button": "right"},
                {"action": "mouse_up", "button": "right"},
                {"action": "hscroll", "dx": 240, "nx": 0.5, "ny": 0.5},
                {"action": "hscroll", "dx": -180},
                {"action": "hscroll", "dx": 99999},  # clamped to 5000
            ]
            for ev in events:
                await self.daemon._process_virtual_input(json.dumps(ev).encode("utf-8"), ws=None)

        fake_gui.moveTo.assert_called_once_with(600, 450, _pause=False)
        fake_gui.click.assert_called_once_with(x=100, y=700, button="left", _pause=False)
        fake_gui.doubleClick.assert_called_once_with(x=1100, y=200, _pause=False)
        fake_gui.rightClick.assert_called_once_with(x=100, y=700, _pause=False)
        fake_gui.scroll.assert_called_once_with(-120, x=600, y=450, _pause=False)
        fake_gui.mouseDown.assert_any_call(x=350, y=450, button="left", _pause=False)
        fake_gui.mouseUp.assert_any_call(x=850, y=450, button="left", _pause=False)
        fake_gui.mouseDown.assert_any_call(button="right", _pause=False)
        fake_gui.mouseUp.assert_any_call(button="right", _pause=False)
        fake_gui.hscroll.assert_any_call(240, x=600, y=450, _pause=False)
        fake_gui.hscroll.assert_any_call(-180, _pause=False)
        fake_gui.hscroll.assert_any_call(5000, _pause=False)
        self.assertEqual(wake_spy.call_count, len(events))

    async def test_07_capture_rect_fallback_and_view_only_enforcement(self):
        fake_gui = MagicMock()
        fake_gui.size.return_value = (1600, 900)
        self.daemon.screen_pipeline.last_capture_rect = None
        self.daemon.screen_pipeline.monitor_index = 1

        with patch.object(agent_mod, "pyautogui", fake_gui):
            # Missing last_capture_rect falls back cleanly to primary screen size (1600x900)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 65535, 65535, 0), ws=None)
            fake_gui.moveTo.assert_called_once_with(1599, 899, _pause=False)

            # Unconfigured MagicMock size() still falls back safely without raising
            fake_gui.reset_mock()
            fake_gui.size = MagicMock()
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 32768, 32768, 0), ws=None)
            fake_gui.moveTo.assert_called_once()
            tx, ty = fake_gui.moveTo.call_args.args
            self.assertGreaterEqual(tx, 0)
            self.assertGreaterEqual(ty, 0)

            # View-only mode blocks all new binary & JSON input actions
            fake_gui.reset_mock()
            self.daemon.view_only_mode = True
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 1000, 1000, 0), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 5, 1000, 1000, 1), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 6, 1000, 1000, 1), ws=None)
            await self.daemon._process_virtual_input(struct.pack("!BhhB", 7, 100, 100, 0), ws=None)
            await self.daemon._process_virtual_input(json.dumps({"action": "mouse_down", "nx": 0.5, "ny": 0.5}).encode("utf-8"), ws=None)
            await self.daemon._process_virtual_input(json.dumps({"action": "hscroll", "dx": 100}).encode("utf-8"), ws=None)
            fake_gui.moveTo.assert_not_called()
            fake_gui.click.assert_not_called()
            fake_gui.mouseDown.assert_not_called()
            fake_gui.scroll.assert_not_called()
            fake_gui.hscroll.assert_not_called()


class TestCursorOverlayCompositor(unittest.TestCase):
    """Covers CursorOverlayCompositor safety across headless/Linux/edges & pipeline integration."""

    def test_01_headless_non_windows_and_mocked_ctypes_safe(self):
        comp = agent_mod.CursorOverlayCompositor()
        with patch.dict(os.environ, {"AI_HEADLESS": "1"}, clear=False):
            self.assertIsNone(comp.get_cursor_screen_state())
        with patch.object(agent_mod.platform, "system", return_value="Linux"):
            self.assertIsNone(comp.get_cursor_screen_state())
        fake_ctypes = SimpleNamespace(windll=SimpleNamespace(user32=MagicMock(), gdi32=MagicMock()))
        with patch.object(agent_mod, "ctypes", fake_ctypes):
            self.assertIsNone(comp.get_cursor_screen_state())

    def test_02_monitor_bounds_mapping(self):
        comp = agent_mod.CursorOverlayCompositor()
        with patch.object(comp, "get_cursor_screen_state", return_value=(2100, 350, 0)):
            # Outside primary monitor (0, 0, 1920, 1080)
            self.assertIsNone(comp.get_monitor_cursor(0, 0, 1920, 1080))
            # Inside secondary monitor (1920, 100, 2560, 1440)
            self.assertEqual(comp.get_monitor_cursor(1920, 100, 2560, 1440), (180, 250, 0))

    def test_03_numpy_rgb_bgra_fallback_compositing_edge_clipping_and_readonly_guard(self):
        comp = agent_mod.CursorOverlayCompositor()

        # Writable RGB frame
        rgb = np.full((64, 64, 3), 120, dtype=np.uint8)
        self.assertTrue(comp.composite_on_numpy(rgb, 20, 20, hcursor=0, is_bgr=False))
        # Hotspot (20,20) is dark arrow tip 'B'=(12,12,16), interior (21,22) is white 'W'=(255,255,255)
        self.assertEqual(tuple(rgb[20, 20]), (12, 12, 16))
        self.assertEqual(tuple(rgb[22, 21]), (255, 255, 255))
        # Distant pixel untouched
        self.assertEqual(tuple(rgb[0, 0]), (120, 120, 120))

        # Writable BGRA frame + corner clipping (bottom-right edge)
        bgra = np.full((64, 64, 4), 120, dtype=np.uint8)
        self.assertTrue(comp.composite_on_numpy(bgra, 60, 60, hcursor=0, is_bgr=True))
        # BGR channel order for 'B'=(12,12,16) -> (16,12,12)
        self.assertEqual(tuple(bgra[60, 60, :3]), (16, 12, 12))

        # Out-of-bounds coords return False safely
        self.assertFalse(comp.composite_on_numpy(rgb, -1, 10, hcursor=0))
        self.assertFalse(comp.composite_on_numpy(rgb, 64, 10, hcursor=0))

        # Read-only array never raises ValueError
        ro = np.full((32, 32, 3), 100, dtype=np.uint8)
        ro.setflags(write=False)
        self.assertFalse(comp.composite_on_numpy(ro, 5, 5, hcursor=0))

    def test_04_pillow_compositing_and_pipeline_cursor_motion_and_immutability(self):
        pipeline = agent_mod.AdaptiveScreenPipeline(target_resolution=(160, 120))
        pipeline.turbo = None
        pipeline.show_cursor = True
        try:
            source_bgra = _make_bgra_frame(160, 120, b=110, g=110, r=110)
            source_snapshot = bytes(source_bgra)
            fake_sct = MagicMock()
            fake_sct.monitors = [{"left": 0, "top": 0, "width": 160, "height": 120}]
            fake_sct.grab.side_effect = lambda _mon: _make_shot(source_bgra, 160, 120)
            pipeline._local.sct = fake_sct

            cursor_pos = [(40, 40, 0)]
            with patch.object(
                pipeline.cursor_compositor,
                "get_monitor_cursor",
                side_effect=lambda *args: cursor_pos[0],
            ):
                # Frame 1: cursor at (40, 40) -> drawn in decoded JPEG
                jpg1, static1 = pipeline._grab_and_compress()
                self.assertIsNotNone(jpg1)
                self.assertFalse(static1)
                decoded1 = Image.open(io.BytesIO(jpg1))
                tip_px = decoded1.getpixel((40, 40))
                far_px = decoded1.getpixel((5, 5))
                self.assertLess(sum(tip_px), sum(far_px) - 100, "Cursor dark tip should be visible in JPEG")

                # Frame 2: same desktop + same cursor -> static settling frame
                jpg2, static2 = pipeline._grab_and_compress()
                self.assertIsNotNone(jpg2)
                self.assertTrue(static2)
                pipeline.consecutive_static = 1

                # Frame 3: same desktop + same cursor -> short-circuits idle cleanly
                jpg3, static3 = pipeline._grab_and_compress()
                self.assertIsNone(jpg3)
                self.assertTrue(static3)

                # Frame 4: cursor moves on static desktop -> wakes up & emits fresh frame!
                cursor_pos[0] = (90, 70, 0)
                jpg4, static4 = pipeline._grab_and_compress()
                self.assertIsNotNone(jpg4)
                self.assertFalse(static4, "Cursor movement on static desktop must emit a fresh frame")
                decoded4 = Image.open(io.BytesIO(jpg4))
                new_tip_px = decoded4.getpixel((90, 70))
                new_body_px = decoded4.getpixel((92, 76))
                self.assertLess(sum(new_tip_px), sum(far_px) - 100, "Moved cursor dark tip should be visible in JPEG")
                self.assertGreater(sum(new_body_px), sum(far_px) + 150, "Moved cursor white body should be visible in JPEG")

            # Source capture bytes must never have been mutated
            self.assertEqual(bytes(source_bgra), source_snapshot)
        finally:
            pipeline.close()


class TestUdpDiscoveryAndConnectivity(unittest.IsolatedAsyncioTestCase):
    """Covers LAN UDP discovery responder, zero-secret verification, viewport resize, and fast ECDH keyframe."""

    async def asyncSetUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="ai_net_alpha_conn_")
        self.cfg_path = os.path.join(self.tmpdir, "config.json")
        self._env_patch = patch.dict(
            os.environ,
            {
                "HOME": self.tmpdir,
                "USERPROFILE": self.tmpdir,
                "LOCALAPPDATA": os.path.join(self.tmpdir, "Local"),
                "APPDATA": os.path.join(self.tmpdir, "Roaming"),
                "XDG_CONFIG_HOME": os.path.join(self.tmpdir, ".config"),
            },
            clear=False,
        )
        self._env_patch.start()
        self.cfg_patch = patch.object(daemon_config_mod, "get_config_path", return_value=self.cfg_path)
        self.agent_cfg_patch = patch.object(agent_mod, "get_config_path", return_value=self.cfg_path)
        self._saved_env = {
            k: os.environ.pop(k, None)
            for k in ("AI_AGENT_SECRET", "CST_AGENT_SECRET", "AI_DISCOVERY_PORT", "AI_DISABLE_UDP_DISCOVERY")
        }
        self.cfg_patch.start()
        self.agent_cfg_patch.start()
        self._daemons = []

    async def asyncTearDown(self):
        for d in reversed(self._daemons):
            try:
                await asyncio.wait_for(d.async_stop(), timeout=4.0)
            except Exception:
                pass
        self._daemons.clear()
        self.agent_cfg_patch.stop()
        self.cfg_patch.stop()
        for k, v in self._saved_env.items():
            if v is not None:
                os.environ[k] = v
            else:
                os.environ.pop(k, None)
        self._env_patch.stop()
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    async def test_01_udp_discovery_responder_zero_secrets_and_clean_shutdown(self):
        ws_port = _free_tcp_port()
        daemon = agent_mod.HostAgentDaemon(
            host="127.0.0.1",
            port=ws_port,
            enable_tray=False,
            enable_mdns=False,
            enable_udp_discovery=True,
            discovery_port=0,  # ephemeral free UDP port
        )
        daemon.pairing_pin = "847291"
        daemon.pairing_token = "ainet_ultra_secret_never_leak_token_xyz"
        self._daemons.append(daemon)
        await daemon.start()

        bound_udp_port = daemon._udp_discovery_port_bound
        self.assertIsNotNone(bound_udp_port)
        self.assertGreater(bound_udp_port, 0)

        # Send valid discovery probe via real UDP socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(1.5)
        try:
            sock.sendto(b"CST_DISCOVER_V1", ("127.0.0.1", bound_udp_port))
            raw_reply, _addr = await asyncio.to_thread(sock.recvfrom, 4096)
            parsed = json.loads(raw_reply.decode("utf-8"))

            self.assertEqual(parsed["protocol"], "CST_DISCOVER_V1")
            self.assertEqual(parsed["hostname"], socket.gethostname())
            self.assertEqual(parsed["ws_port"], ws_port)
            self.assertIs(parsed["tls"], False)
            self.assertEqual(parsed["os"], platform.system())
            self.assertEqual(parsed["version"], "0.85.0-alpha")

            # Strict zero-secret verification
            self.assertEqual(set(parsed.keys()), {"protocol", "hostname", "ws_port", "tls", "os", "version"})
            raw_text = raw_reply.decode("utf-8").lower()
            self.assertNotIn("847291", raw_text)
            self.assertNotIn("ultra_secret_never_leak", raw_text)
            for forbidden in ("pin", "token", "secret", "password", "fingerprint"):
                self.assertNotIn(forbidden, raw_text)

            # Invalid probe receives no reply
            sock.settimeout(0.2)
            sock.sendto(b"NOT_A_DISCOVERY_PROBE", ("127.0.0.1", bound_udp_port))
            with self.assertRaises(socket.timeout):
                await asyncio.to_thread(sock.recvfrom, 4096)
        finally:
            sock.close()

        # Clean shutdown closes UDP transport and releases port
        await daemon.async_stop()
        self.assertIsNone(daemon._udp_discovery_transport)
        self.assertIsNone(daemon._udp_discovery_port_bound)
        rebind = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            rebind.bind(("127.0.0.1", bound_udp_port))
        finally:
            rebind.close()

    async def test_02_udp_discovery_bind_failure_gracefully_skipped(self):
        # Occupy a UDP port first
        blocker = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        blocker.bind(("127.0.0.1", 0))
        busy_udp_port = blocker.getsockname()[1]
        try:
            ws_port = _free_tcp_port()
            daemon = agent_mod.HostAgentDaemon(
                host="127.0.0.1",
                port=ws_port,
                enable_tray=False,
                enable_mdns=False,
                enable_udp_discovery=True,
                discovery_port=busy_udp_port,
            )
            self._daemons.append(daemon)
            # Must NOT raise even though UDP bind fails
            await daemon.start()
            self.assertIsNone(daemon._udp_discovery_transport)
            self.assertIsNotNone(daemon.server, "WebSocket server must still start when UDP bind fails")
        finally:
            blocker.close()

    async def test_03_viewport_resize_quality_fps_and_malformed_field_resilience(self):
        daemon = agent_mod.HostAgentDaemon(
            host="127.0.0.1",
            port=0,
            enable_tray=False,
            enable_mdns=False,
            enable_udp_discovery=False,
        )
        self._daemons.append(daemon)
        fake_ws = MagicMock()

        await daemon._process_viewport_resize(
            json.dumps({"width": 1024, "height": 600, "quality": 72, "fps": 45}).encode("utf-8"),
            ws=fake_ws,
        )
        self.assertEqual(daemon.screen_pipeline.target_res, (1024, 600))
        self.assertEqual(daemon.screen_pipeline.jpeg_quality, 72)
        self.assertEqual(daemon.screen_pipeline.target_fps, 45)
        self.assertEqual(daemon.target_fps, 45)
        self.assertIn(fake_ws, daemon._clients_need_keyframe)
        self.assertIn(fake_ws, daemon._clients_explicit_sync)

        # Malformed quality field must not prevent valid fps from applying
        await daemon._process_viewport_resize(
            json.dumps({"quality": "invalid", "fps": 30}).encode("utf-8"),
            ws=fake_ws,
        )
        self.assertEqual(daemon.screen_pipeline.jpeg_quality, 72)
        self.assertEqual(daemon.screen_pipeline.target_fps, 30)

        # Pause and resume stream_enabled cleanly
        await daemon._process_viewport_resize(json.dumps({"stream_enabled": False}).encode("utf-8"), ws=fake_ws)
        self.assertIn(fake_ws, daemon._stream_paused_clients)
        self.assertFalse(daemon._is_client_ready_for_stream(fake_ws))

        daemon._clients_need_keyframe.clear()
        daemon._clients_explicit_sync.clear()
        await daemon._process_viewport_resize(json.dumps({"stream_enabled": True}).encode("utf-8"), ws=fake_ws)
        self.assertNotIn(fake_ws, daemon._stream_paused_clients)
        self.assertTrue(daemon._is_client_ready_for_stream(fake_ws))
        self.assertIn(fake_ws, daemon._clients_need_keyframe)
        self.assertIn(fake_ws, daemon._clients_explicit_sync)

    async def test_04_fast_keyframe_delivery_after_ok_ecdh_vault_on_static_desktop(self):
        ws_port = _free_tcp_port()
        daemon = agent_mod.HostAgentDaemon(
            host="127.0.0.1",
            port=ws_port,
            enable_tray=False,
            enable_mdns=False,
            enable_udp_discovery=False,
        )
        self._daemons.append(daemon)

        buf = io.BytesIO()
        Image.new("RGB", (320, 180), color=(30, 80, 140)).save(buf, format="JPEG", quality=60)
        fake_jpeg = buf.getvalue()

        # Simulate a static desktop that only emits when force_keyframe is set!
        def _static_until_forced():
            if daemon.screen_pipeline.force_keyframe:
                daemon.screen_pipeline.force_keyframe = False
                daemon.screen_pipeline.consecutive_static = 0
                daemon.screen_pipeline._last_encoded_frame = fake_jpeg
                return fake_jpeg, False
            return None, True

        daemon.screen_pipeline.consecutive_static = 5
        daemon.screen_pipeline._grab_and_compress = _static_until_forced
        await daemon.start()
        # Let _screen_stream_loop enter its idle wait
        await asyncio.sleep(0.05)

        psk = daemon.pairing_token.encode("utf-8")
        async with websockets.connect(f"ws://127.0.0.1:{ws_port}") as ws:
            # 1. HMAC auth
            chal = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
            auth_sig = hmac.new(psk, chal[5], hashlib.sha256).digest()
            await ws.send(agent_mod.pack_packet(agent_mod.OP_AUTH, auth_sig, seq=1))
            ack = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
            self.assertEqual(ack[5], b"OK_AUTHENTICATED")

            # 2. Mutual ECDH vault handshake
            cli_chal = secrets.token_bytes(16)
            await ws.send(agent_mod.pack_packet(agent_mod.OP_AUTH, b"INIT_ECDH_VAULT_M:" + cli_chal, seq=2))
            host_chal_pkt = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
            chal_59 = host_chal_pkt[5][:59]
            host_pub = chal_59[11:43]
            host_n2 = chal_59[43:59]

            cli_priv, cli_pub = FallbackCurve25519.generate_keypair()
            cli_n1 = secrets.token_bytes(16)
            cli_mac = hmac.new(
                psk,
                PROTOCOL_MAGIC + host_pub + cli_pub + cli_n1 + host_n2,
                hashlib.sha256,
            ).digest()
            await ws.send(agent_mod.pack_packet(agent_mod.OP_AUTH, cli_pub + cli_n1 + cli_mac, seq=3))
            ok_vault = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
            self.assertEqual(ok_vault[5], b"OK_ECDH_VAULT")

            shared = FallbackCurve25519.compute_shared_secret(cli_priv, host_pub)
            cli_rx_key = hkdf_extract_and_expand(cli_n1 + host_n2, shared, CTX_HOST_TX, 32)

            # 3. Verify encrypted OP_FRAME keyframe arrives quickly (<0.35s) even on a static desktop!
            t0 = time.monotonic()
            frame_raw = await asyncio.wait_for(ws.recv(), timeout=0.35)
            elapsed = time.monotonic() - t0
            pkt = agent_mod.unpack_packet(frame_raw)
            self.assertIsNotNone(pkt)
            self.assertEqual(pkt[1], agent_mod.OP_FRAME)
            self.assertEqual(pkt[2] & 0x02, 0x02)
            plain_jpeg = FallbackChaCha20Poly1305.decrypt(
                cli_rx_key,
                pkt[5][:12],
                pkt[5][12:],
                aad=frame_raw[:agent_mod.HEADER_SIZE],
            )
            self.assertIsNotNone(plain_jpeg)
            self.assertTrue(plain_jpeg.startswith(b"\xff\xd8") and plain_jpeg.endswith(b"\xff\xd9"))
            self.assertLess(elapsed, 0.35, f"Initial keyframe after OK_ECDH_VAULT took too long ({elapsed:.3f}s)")

    async def test_05_send_frame_timeout_preserves_auth_until_strike_threshold(self):
        daemon = agent_mod.HostAgentDaemon(
            host="127.0.0.1",
            port=0,
            enable_tray=False,
            enable_mdns=False,
            enable_udp_discovery=False,
        )
        self._daemons.append(daemon)

        fake_ws = MagicMock()
        fake_ws.close = AsyncMock()
        daemon.authenticated_clients.add(fake_ws)

        with patch.object(daemon, "_send_encrypted_or_plain", side_effect=asyncio.TimeoutError()):
            # Strikes 1..3 keep auth intact and request keyframe resync
            for strike in range(1, 4):
                await daemon._send_frame_guarded(fake_ws, b"\xff\xd8\xff\xd9")
                self.assertIn(fake_ws, daemon.authenticated_clients)
                self.assertIn(fake_ws, daemon._clients_need_keyframe)
                self.assertEqual(daemon._client_frame_timeouts.get(fake_ws), strike)

            # Strike 4 evicts dead socket and closes with 1001 (not false auth error)
            await daemon._send_frame_guarded(fake_ws, b"\xff\xd8\xff\xd9")
            self.assertNotIn(fake_ws, daemon.authenticated_clients)
            await asyncio.sleep(0.01)
            fake_ws.close.assert_awaited_once_with(code=1001, reason="Video stream send timeout")

    async def test_06_env_discovery_port_tls_flag_and_monitor_switch_rect_sync(self):
        with patch.dict(os.environ, {"AI_DISCOVERY_PORT": "9876"}, clear=False):
            daemon = agent_mod.HostAgentDaemon(
                host="127.0.0.1",
                port=8765,
                enable_tray=False,
                enable_mdns=False,
                enable_udp_discovery=False,
            )
            self._daemons.append(daemon)
            self.assertEqual(daemon.discovery_port, 9876)

            daemon._tls_active = True
            disc_json = json.loads(daemon._build_discovery_response().decode("utf-8"))
            self.assertIs(disc_json["tls"], True)
            self.assertEqual(disc_json["ws_port"], 8765)
            self.assertEqual(disc_json["version"], "0.85.0-alpha")

            mock_mm = MagicMock()
            mock_mm.enumerate_monitors.return_value = [
                {"index": 1, "left": 0, "top": 0, "width": 1920, "height": 1080},
                {"index": 2, "left": 1920, "top": 50, "width": 2560, "height": 1440},
            ]
            daemon.multi_monitor = mock_mm
            daemon._switch_active_monitor(2)
            self.assertEqual(daemon.screen_pipeline.last_capture_rect, (1920, 50, 2560, 1440))
            self.assertEqual(daemon._map_normalized_xy(1.0, 1.0), (4479, 1489))


if __name__ == "__main__":
    unittest.main()
