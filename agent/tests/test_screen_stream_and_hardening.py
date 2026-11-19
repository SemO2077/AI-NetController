"""
Focused Regression Tests for Screen Streaming, Crypto Hardening & Input Control
=============================================================================
Covers AdaptiveScreenPipeline motion detection / settling / MSS recovery / TurboJPEG flags,
HostAgentDaemon AEAD gating / keyframe sync / input & size guards, and CommandASTFirewall rules.
"""

import asyncio
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

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
if _existing_agent is not None and not hasattr(_existing_agent, "__path__"):
    agent_mod = _existing_agent
else:
    import agent.agent as agent_mod

import daemon_config as daemon_config_mod
from command_ast_firewall import CommandASTFirewall


def _make_bgra_frame(width: int = 320, height: int = 180, b: int = 100, g: int = 100, r: int = 100) -> bytearray:
    arr = np.empty((height, width, 4), dtype=np.uint8)
    arr[:, :, 0] = b
    arr[:, :, 1] = g
    arr[:, :, 2] = r
    arr[:, :, 3] = 255
    return bytearray(arr.tobytes())


def _make_shot(buf: bytes, width: int = 320, height: int = 180):
    raw_bytes = bytes(buf)
    return SimpleNamespace(
        width=width,
        height=height,
        size=(width, height),
        bgra=raw_bytes,
        raw=raw_bytes,
    )


class TestAdaptiveScreenPipeline(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.pipeline = agent_mod.AdaptiveScreenPipeline(target_resolution=(320, 180))
        self.pipeline.turbo = None  # Use deterministic Pillow path unless explicitly mocked

    def tearDown(self):
        self.pipeline.close()

    def test_red_green_patch_motion_detected_without_blue_change(self):
        frame1 = _make_bgra_frame(320, 180, b=100, g=100, r=100)
        frame2 = bytearray(frame1)
        # Mutate a 16x16 patch covering [8:24, 16:32] ONLY in Green & Red channels (Blue untouched at 100)
        view = np.frombuffer(frame2, dtype=np.uint8).reshape((180, 320, 4))
        view[8:24, 16:32, 1] = 220
        view[8:24, 16:32, 2] = 45

        fake_sct = MagicMock()
        fake_sct.monitors = [{"left": 0, "top": 0, "width": 320, "height": 180}]
        fake_sct.grab.side_effect = [_make_shot(frame1), _make_shot(frame2)]
        self.pipeline._local.sct = fake_sct

        jpg1, static1 = self.pipeline._grab_and_compress()
        self.assertIsNotNone(jpg1)
        self.assertFalse(static1)

        jpg2, static2 = self.pipeline._grab_and_compress()
        self.assertIsNotNone(jpg2)
        self.assertFalse(static2, "Red/Green-only patch change must be detected as motion")

    async def test_settling_frame_emitted_once_then_short_circuits_idle(self):
        frame = _make_bgra_frame(320, 180, b=40, g=80, r=120)
        fake_sct = MagicMock()
        fake_sct.monitors = [{"left": 0, "top": 0, "width": 320, "height": 180}]
        fake_sct.grab.side_effect = lambda _mon: _make_shot(frame)

        with patch.object(self.pipeline, "_get_mss", return_value=fake_sct):
            first = await self.pipeline.get_next_frame()
            self.assertIsNotNone(first)
            self.assertEqual(self.pipeline.consecutive_static, 0)

            settling = await self.pipeline.get_next_frame()
            self.assertIsNotNone(settling, "First static frame should emit a crisp settling frame")
            self.assertEqual(self.pipeline.consecutive_static, 1)

            idle = await self.pipeline.get_next_frame()
            self.assertIsNone(idle, "Subsequent identical static frames must short-circuit")
            self.assertEqual(self.pipeline.consecutive_static, 2)

    def test_mss_self_healing_after_grab_exception(self):
        good_frame = _make_bgra_frame(320, 180, b=10, g=20, r=30)

        bad_sct = MagicMock()
        bad_sct.monitors = [{"left": 0, "top": 0, "width": 320, "height": 180}]
        bad_sct.grab.side_effect = RuntimeError("DXGI/GDI handle lost")
        self.pipeline._local.sct = bad_sct

        jpg_err, static_err = self.pipeline._grab_and_compress()
        self.assertIsNone(jpg_err)
        self.assertFalse(static_err)
        self.assertEqual(self.pipeline._consecutive_grab_errors, 1)
        self.assertIsNone(getattr(self.pipeline._local, "sct", None))
        bad_sct.close.assert_called_once()

        healed_sct = MagicMock()
        healed_sct.monitors = [{"left": 0, "top": 0, "width": 320, "height": 180}]
        healed_sct.grab.return_value = _make_shot(good_frame)
        with patch.object(self.pipeline, "_get_mss", return_value=healed_sct):
            jpg_ok, _ = self.pipeline._grab_and_compress()
        self.assertIsNotNone(jpg_ok)
        self.assertEqual(self.pipeline._consecutive_grab_errors, 0)

    def test_turbojpeg_resize_passes_rgb_and_fastdct_flags(self):
        frame = _make_bgra_frame(640, 480, b=30, g=60, r=90)
        self.pipeline.set_target_resolution(320, 240)
        self.pipeline.turbo = MagicMock()
        self.pipeline.turbo.encode.return_value = b"\xff\xd8\xff\xe0\xff\xd9"

        fake_sct = MagicMock()
        fake_sct.monitors = [{"left": 0, "top": 0, "width": 640, "height": 480}]
        fake_sct.grab.return_value = _make_shot(frame, 640, 480)
        self.pipeline._local.sct = fake_sct

        jpg, _ = self.pipeline._grab_and_compress()
        self.assertEqual(jpg, b"\xff\xd8\xff\xe0\xff\xd9")
        self.pipeline.turbo.encode.assert_called_once()
        args, kwargs = self.pipeline.turbo.encode.call_args
        self.assertEqual(args[0].shape, (240, 320, 3))
        self.assertEqual(kwargs["pixel_format"], agent_mod.TJPF_RGB)
        self.assertEqual(kwargs["jpeg_subsample"], agent_mod.TJSAMP_420)
        self.assertEqual(kwargs["flags"], agent_mod.TJFLAG_FASTDCT)
        self.assertEqual(agent_mod.TJFLAG_FASTDCT, 2048)

    def test_set_target_fps_clamps_bounds(self):
        self.pipeline.set_target_fps(1)
        self.assertEqual(self.pipeline.target_fps, 5)
        self.pipeline.set_target_fps(120)
        self.assertEqual(self.pipeline.target_fps, 60)
        self.pipeline.set_target_fps(30)
        self.assertEqual(self.pipeline.target_fps, 30)


class TestHostAgentHardening(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="ai_net_hardening_")
        self.cfg_path = os.path.join(self.tmpdir, "config.json")
        self.cfg_patch = patch.object(daemon_config_mod, "get_config_path", return_value=self.cfg_path)
        self.agent_cfg_patch = patch.object(agent_mod, "get_config_path", return_value=self.cfg_path)
        self._saved_env = {
            k: os.environ.pop(k, None)
            for k in ("AI_AGENT_SECRET", "CST_AGENT_SECRET")
        }
        self.cfg_patch.start()
        self.agent_cfg_patch.start()
        self.daemon = agent_mod.HostAgentDaemon(
            host="127.0.0.1",
            port=0,
            enable_tray=False,
            enable_mdns=False,
        )

    async def asyncTearDown(self):
        self.daemon.screen_pipeline.close()
        self.agent_cfg_patch.stop()
        self.cfg_patch.stop()
        for k, v in self._saved_env.items():
            if v is not None:
                os.environ[k] = v
            else:
                os.environ.pop(k, None)
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    async def test_trigger_keyframe_resync_wakes_stream_and_marks_explicit_sync(self):
        fake_ws = MagicMock()
        self.daemon.loop = asyncio.get_running_loop()
        self.daemon._loop_thread_id = threading.get_ident()
        self.daemon._stream_wake_event = asyncio.Event()
        self.daemon.screen_pipeline.force_keyframe = False

        self.daemon._trigger_keyframe_resync(fake_ws)
        self.assertTrue(self.daemon._stream_wake_event.is_set())
        self.assertIn(fake_ws, self.daemon._clients_need_keyframe)
        self.assertIn(fake_ws, self.daemon._clients_explicit_sync)
        self.assertTrue(self.daemon.screen_pipeline.force_keyframe)

    def test_aead_required_and_stream_readiness_gating(self):
        fake_ws = MagicMock()

        self.daemon.require_aead = False
        self.daemon.security_profile = "balanced"
        self.assertFalse(self.daemon._aead_required())
        self.assertTrue(self.daemon._is_client_ready_for_stream(fake_ws))

        for profile in ("zero_trust", "strict"):
            self.daemon.security_profile = profile
            self.assertTrue(self.daemon._aead_required())
            self.assertFalse(self.daemon._is_client_ready_for_stream(fake_ws))

        pending_vault = MagicMock(is_established=False)
        self.daemon._client_vaults[fake_ws] = pending_vault
        self.assertFalse(self.daemon._is_client_ready_for_stream(fake_ws))

        pending_vault.is_established = True
        self.assertTrue(self.daemon._is_client_ready_for_stream(fake_ws))

    async def test_shell_and_clipboard_payload_size_bounds(self):
        fake_ws = MagicMock()
        self.daemon.authenticated_clients.add(fake_ws)
        self.daemon.view_only_mode = False
        self.daemon._send_encrypted_or_plain = AsyncMock()
        self.daemon._send_error = AsyncMock()

        await self.daemon._process_shell_command(fake_ws, b"A" * 9000, seq=42)
        self.daemon._send_encrypted_or_plain.assert_awaited_once()
        _ws_arg, opcode_arg, body_arg = self.daemon._send_encrypted_or_plain.call_args.args
        self.assertEqual(opcode_arg, agent_mod.OP_SHELL)
        parsed = json.loads(body_arg.decode("utf-8"))
        self.assertEqual(parsed["status"], "rejected")
        self.assertIn("8192", parsed["output"])

        await self.daemon._process_clipboard(fake_ws, b"B" * (1_048_576 + 1))
        self.daemon._send_error.assert_awaited_once()
        self.assertIn("1 MiB", self.daemon._send_error.call_args.args[1])

    async def test_virtual_input_dblclick_and_absolute_move(self):
        mock_pyautogui = MagicMock()
        self.daemon.view_only_mode = False
        self.daemon.screen_pipeline.last_capture_rect = (0, 0, 1920, 1080)
        self.daemon.screen_pipeline.last_stream_size = (1920, 1080)

        with patch.object(agent_mod, "pyautogui", mock_pyautogui):
            await self.daemon._process_virtual_input(
                json.dumps({"action": "INPUT_EVENT", "kind": "dblclick", "x": 100, "y": 200}).encode("utf-8"),
                ws=None,
            )
            await self.daemon._process_virtual_input(
                json.dumps({"action": "INPUT_EVENT", "kind": "move", "x": 300, "y": 400}).encode("utf-8"),
                ws=None,
            )

        mock_pyautogui.doubleClick.assert_called_once_with(x=100, y=200, _pause=False)
        mock_pyautogui.moveTo.assert_called_once_with(300, 400, _pause=False)

    async def test_encrypted_hitl_panic_and_disconnect_client(self):
        fake_ws = MagicMock()
        self.daemon.authenticated_clients.add(fake_ws)
        self.daemon._send_encrypted_or_plain = AsyncMock()
        self.daemon.kill_all_tasks = MagicMock()
        self.daemon.force_disconnect_client = MagicMock()

        await self.daemon._process_hitl_response(
            json.dumps({"action": "PANIC_KILL_ALL"}).encode("utf-8"),
            fake_ws,
        )
        self.daemon.kill_all_tasks.assert_called_once()
        panic_args = self.daemon._send_encrypted_or_plain.call_args.args
        self.assertEqual(panic_args[1], agent_mod.OP_HITL)
        self.assertEqual(json.loads(panic_args[2].decode("utf-8"))["event"], "PANIC_ACK")

        self.daemon._send_encrypted_or_plain.reset_mock()
        await self.daemon._process_hitl_response(
            json.dumps({"action": "DISCONNECT_CLIENT", "clientId": "192.168.1.9:5555"}).encode("utf-8"),
            fake_ws,
        )
        self.daemon.force_disconnect_client.assert_called_once_with("192.168.1.9:5555")
        disc_args = self.daemon._send_encrypted_or_plain.call_args.args
        self.assertEqual(disc_args[1], agent_mod.OP_HITL)
        disc_json = json.loads(disc_args[2].decode("utf-8"))
        self.assertEqual(disc_json["event"], "DISCONNECT_ACK")
        self.assertEqual(disc_json["clientId"], "192.168.1.9:5555")

    def test_build_pairing_uri_keeps_full_64_char_fingerprint(self):
        fp = "a1b2c3d4" * 8
        self.assertEqual(len(fp), 64)
        uri = daemon_config_mod.build_pairing_uri("192.168.1.10", 8765, "654321", tls=True, tls_fingerprint=fp)
        self.assertIn(f"&fp={fp}", uri)
        self.assertTrue(uri.startswith("wss://") or "proto=wss" in uri)

    def test_command_ast_firewall_flags_newly_added_critical_cmdlets(self):
        for dangerous in (
            "Set-MpPreference -DisableRealtimeMonitoring $true",
            "Invoke-CimMethod -ClassName Win32_Process -MethodName Create",
            "Clear-EventLog Security",
        ):
            allowed, risk, _norm, _reason = CommandASTFirewall.inspect_and_sanitize(dangerous)
            self.assertTrue(allowed)
            self.assertEqual(risk, "REQUIRES_BIOMETRIC", f"Expected REQUIRES_BIOMETRIC risk for: {dangerous}")
            is_dangerous, _ = agent_mod.AstCommandInspector.inspect(dangerous)
            self.assertTrue(is_dangerous, f"Expected AstCommandInspector to flag: {dangerous}")


if __name__ == "__main__":
    unittest.main()
