#!/usr/bin/env python3
"""
QOL Refinement & Hardening Verification Suite
================================================================================
Covers under-the-hood performance/bug hardening, backward-compatible additive
diagnostics/telemetry, and desktop GUI ergonomics/cleanup across `agent/`.
"""

import asyncio
import concurrent.futures
import hashlib
import hmac
import importlib
import json
import os
import platform
import shutil
import socket
import struct
import sys
import tempfile
import threading
import time
import types
import unittest
import warnings
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np
import websockets

AGENT_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = AGENT_DIR.parent
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

try:
    import agent as _maybe_agent  # noqa: E402
    agent_mod = _maybe_agent if hasattr(_maybe_agent, "HostAgentDaemon") else importlib.import_module("agent.agent")
except ImportError:
    agent_mod = importlib.import_module("agent.agent")

import agent_gui as gui_mod  # noqa: E402
import cyber_ui_theme as ui_mod  # noqa: E402
import daemon_config as cfg_mod  # noqa: E402
import host_file_writer as writer_mod  # noqa: E402
import multi_monitor_streamer as mms_mod  # noqa: E402
import network_fuzzer_shield as shield_mod  # noqa: E402
import tls_manager as tls_mod  # noqa: E402


def _free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


class _ScriptedWs:
    def __init__(self, incoming=None, remote_address=("127.0.0.1", 55444)):
        self._incoming = list(incoming or [])
        self.remote_address = remote_address
        self.request_headers = {}
        self.sent = []
        self.closed = []
        self.transport = mock.MagicMock()

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


class TestConfigTlsFileWriterShieldStreamerQOL(unittest.TestCase):
    def test_daemon_config_preserves_discovery_fps_caches_acl_and_backs_up_corrupt(self):
        with tempfile.TemporaryDirectory(prefix="ainet_qol_cfg_") as tmp:
            with mock.patch.dict(os.environ, {"AI_CONFIG_DIR": tmp}, clear=False):
                cfg_mod._HARDENED_DIRS.clear()
                with mock.patch.object(cfg_mod, "_restrict_file_permissions") as acl_spy:
                    p1 = cfg_mod.get_config_path()
                    p2 = cfg_mod.get_config_path()
                    p3 = cfg_mod.get_config_path()
                    self.assertEqual(p1, p2)
                    self.assertEqual(p2, p3)
                    # Directory ACL restriction must only run once per directory, not every poll
                    self.assertEqual(acl_spy.call_count, 1)

                cfg = cfg_mod.load_config()
                cfg["udp_discovery_enabled"] = False
                cfg["discovery_port"] = 9911
                cfg["target_fps"] = 45
                self.assertTrue(cfg_mod.save_config(cfg))

                reloaded = cfg_mod.load_config()
                self.assertFalse(reloaded["udp_discovery_enabled"])
                self.assertEqual(reloaded["discovery_port"], 9911)
                self.assertEqual(reloaded["target_fps"], 45)

                # Corrupt JSON gets backed up before clean re-initialization
                with open(p1, "w", encoding="utf-8") as fh:
                    fh.write("{corrupt-json")
                recovered = cfg_mod.load_config()
                self.assertIsInstance(recovered, dict)
                backups = [f for f in os.listdir(tmp) if f.startswith("config.json.corrupt.")]
                self.assertGreaterEqual(len(backups), 1)

    def test_tls_manager_thread_safe_generation_and_cert_info(self):
        with tempfile.TemporaryDirectory(prefix="ainet_qol_tls_") as tmp:
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                futs = [
                    pool.submit(tls_mod.ensure_tls_certificate, tmp, ["127.0.0.1"])
                    for _ in range(4)
                ]
                results = [f.result() for f in futs]

            fps = {fp for _, _, fp in results}
            self.assertEqual(len(fps), 1, "Concurrent ensure_tls_certificate calls must yield one consistent cert/key pair")
            cert_path, key_path, fp = results[0]
            self.assertTrue(tls_mod._is_cert_valid_and_fresh(cert_path, required_ips=["127.0.0.1"], key_path=key_path))

            info = tls_mod.get_certificate_info(cert_path)
            self.assertTrue(info["valid"])
            self.assertEqual(info["fingerprint"], fp)
            self.assertGreater(info["days_remaining"], 300)
            self.assertIn("127.0.0.1", info["san_ips"])
            self.assertFalse(tls_mod.get_certificate_info(os.path.join(tmp, "missing.pem"))["valid"])

    def test_host_file_writer_reserved_disk_space_descriptive_error_and_summary(self):
        with tempfile.TemporaryDirectory(prefix="ainet_qol_fw_") as tmp:
            fw = writer_mod.HostFileWriter(download_dir=tmp)
            digest = hashlib.sha256(b"hello world").hexdigest().encode("ascii")

            # Disk check accounts for remaining bytes of already-active transfers
            free_space = writer_mod.MIN_DISK_RESERVE_BYTES + 1500
            fake_usage = shutil._ntuple_diskusage(free_space * 2, free_space, free_space)
            with mock.patch("shutil.disk_usage", return_value=fake_usage):
                p1 = struct.pack("!BIQ", writer_mod.CMD_INIT, 1, 1000) + digest + b"a.txt"
                a1 = fw.handle_packet(p1)
                self.assertEqual(struct.unpack("!IBQ", a1[12:25])[1], writer_mod.STATUS_OK)

                # Second 1000-byte transfer exceeds remaining 500-byte headroom above reserve
                p2 = struct.pack("!BIQ", writer_mod.CMD_INIT, 2, 1000) + digest + b"b.txt"
                a2 = fw.handle_packet(p2)
                self.assertEqual(struct.unpack("!IBQ", a2[12:25])[1], writer_mod.STATUS_ERR_SIZE_LIMIT)

            summary = fw.get_active_transfers_summary()
            self.assertEqual(summary["active_count"], 1)
            self.assertEqual(summary["bytes_expected"], 1000)

            # Incomplete transfer produces descriptive size-mismatch error message
            fin = struct.pack("!BI", writer_mod.CMD_FINISH, 1)
            ack_fin = fw.handle_packet(fin)
            _, status_fin, _ = struct.unpack("!IBQ", ack_fin[12:25])
            msg_fin = ack_fin[25:].decode("utf-8")
            self.assertEqual(status_fin, writer_mod.STATUS_ERR_CHECKSUM)
            self.assertIn("Incomplete transfer", msg_fin)

            # Aborting before finalize prevents saving the file
            t_ab = writer_mod.ActiveTransfer(9, "aborted.txt", 5, hashlib.sha256(b"12345").hexdigest(), Path(tmp) / "aborted.txt")
            t_ab.open(truncate=True)
            t_ab.write_chunk(0, b"12345")
            t_ab._aborted.set()
            self.assertFalse(t_ab.finalize())
            self.assertFalse((Path(tmp) / "aborted.txt").exists())

    def test_network_fuzzer_shield_zero_jitter_aba_watchdog_and_shutdown(self):
        profile = shield_mod.ChaosProfile(enabled=True, max_jitter_ms=0.0)
        self.assertEqual(profile.get_jitter_delay_seconds(), 0.0)

        profile_small = shield_mod.ChaosProfile(enabled=True, max_jitter_ms=5.0)
        for _ in range(20):
            delay = profile_small.get_jitter_delay_seconds()
            self.assertGreaterEqual(delay, 0.0)
            self.assertLessEqual(delay, 0.005)

        async def _run():
            shield = shield_mod.NetworkFuzzerShield(
                shield_mod.ChaosProfile(enabled=False, handshake_timeout_sec=0.05)
            )
            closed = []
            shield.register_client("peer-1", lambda: closed.append("first"))
            shield.store_ephemeral_key("peer-1", b"k" * 32)
            # Re-registering cancels prior watchdog; shutdown cleans everything cleanly
            shield.register_client("peer-1", lambda: closed.append("second"))
            await shield.cleanup_and_scrub("peer-1")
            term_len_1 = len(shield._terminated_order)
            await shield.cleanup_and_scrub("peer-1")
            self.assertEqual(len(shield._terminated_order), term_len_1)

            shield.register_client("peer-2", lambda: closed.append("p2"))
            shield.store_ephemeral_key("peer-2", b"x" * 32)
            await shield.shutdown()
            self.assertEqual(len(shield.watchdogs), 0)
            self.assertEqual(len(shield.ephemeral_keys), 0)

        asyncio.run(_run())

    def test_multi_monitor_streamer_primary_active_flags_and_dxgi_lock(self):
        fake_sct = mock.MagicMock()
        fake_sct.monitors = [
            {"left": 0, "top": 0, "width": 3840, "height": 1080},
            {"left": 0, "top": 0, "width": 1920, "height": 1080},
            {"left": 1920, "top": 0, "width": 1920, "height": 1080},
        ]
        fake_sct._monitors = list(fake_sct.monitors)
        fake_sct.__class__.__module__ = "mss.windows"
        fake_mss_mod = types.ModuleType("mss")
        fake_mss_mod.MSS = mock.MagicMock(return_value=fake_sct)

        with mock.patch.object(mms_mod, "mss", fake_mss_mod):
            streamer = mms_mod.MultiMonitorStreamer()
            try:
                mons = streamer.enumerate_monitors()
                self.assertEqual(len(mons), 2)
                self.assertTrue(mons[0]["is_primary"])
                self.assertTrue(mons[0]["is_active"])
                self.assertFalse(mons[1]["is_primary"])
                self.assertFalse(mons[1]["is_active"])
                self.assertIsNone(fake_sct._monitors)

                self.assertTrue(streamer.switch_monitor(2))
                mons2 = streamer.enumerate_monitors()
                self.assertFalse(mons2[0]["is_active"])
                self.assertTrue(mons2[1]["is_active"])
            finally:
                streamer.close()
                self.assertEqual(streamer._current_bbox, {})


class TestAgentCoreQOLHardening(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="ainet_qol_agent_")
        self.cfg_path = os.path.join(self.tmpdir, "config.json")
        self._env_patch = mock.patch.dict(
            os.environ,
            {"AI_CONFIG_DIR": self.tmpdir},
            clear=False,
        )
        self._env_patch.start()
        self.daemons = []

    async def asyncTearDown(self):
        for d in reversed(self.daemons):
            try:
                await asyncio.wait_for(d.async_stop(), timeout=4.0)
            except Exception:
                pass
        self.daemons.clear()
        self._env_patch.stop()
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _make_daemon(self, **kwargs):
        defaults = dict(
            host="127.0.0.1",
            port=0,
            enable_tray=False,
            enable_mdns=False,
            enable_udp_discovery=False,
        )
        defaults.update(kwargs)
        d = agent_mod.HostAgentDaemon(**defaults)
        self.daemons.append(d)
        return d

    async def test_ipv4_mapped_ipv6_and_scoped_link_local_geofence(self):
        self.assertFalse(agent_mod.is_local_or_private_ip("::ffff:8.8.8.8"))
        self.assertFalse(agent_mod.is_local_or_private_ip("8.8.8.8"))
        self.assertTrue(agent_mod.is_local_or_private_ip("::ffff:192.168.1.42"))
        self.assertTrue(agent_mod.is_local_or_private_ip("::ffff:127.0.0.1"))
        self.assertTrue(agent_mod.is_local_or_private_ip("fe80::1%eth0"))
        self.assertFalse(agent_mod.is_local_or_private_ip("not-an-ip"))

    def test_sync_stop_emits_zero_unawaited_coroutine_warnings(self):
        daemon = self._make_daemon()
        ws = _ScriptedWs()
        daemon.clients.add(ws)
        daemon.authenticated_clients.add(ws)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", RuntimeWarning)
            daemon.stop()
        unawaited = [
            w for w in caught
            if issubclass(w.category, RuntimeWarning) and "was never awaited" in str(w.message)
        ]
        self.assertEqual(unawaited, [], f"Unexpected unawaited coroutine warnings: {unawaited}")
        ws.transport.close.assert_called()

    async def test_stuck_mouse_button_released_on_client_disconnect(self):
        daemon = self._make_daemon()
        daemon.view_only_mode = False
        fake_gui = mock.MagicMock()

        ws = _ScriptedWs([
            json.dumps({"action": "AUTHENTICATE", "token": daemon.pairing_token}),
            agent_mod.pack_packet(
                agent_mod.OP_INPUT,
                json.dumps({"action": "mouse_down", "button": "left"}).encode("utf-8"),
                seq=1,
            ),
        ])
        with mock.patch.object(agent_mod, "pyautogui", fake_gui):
            await daemon.handle_connection(ws)
            # Let input executor finish releasing held button
            await asyncio.sleep(0.05)

        fake_gui.mouseDown.assert_called_once_with(button="left", _pause=False)
        fake_gui.mouseUp.assert_called_once_with(button="left", _pause=False)
        self.assertNotIn(ws, daemon._client_pressed_buttons)

    async def test_pressed_buttons_fifo_release_and_concurrent_panic_safety(self):
        daemon = self._make_daemon()
        daemon.view_only_mode = False
        fake_gui = mock.MagicMock()
        events = []
        started = threading.Event()
        gate = threading.Event()

        def _blocked_mouse_down(**kwargs):
            started.set()
            gate.wait(timeout=2.0)
            events.append(("down", kwargs.get("button")))

        def _record_mouse_up(**kwargs):
            events.append(("up", kwargs.get("button")))

        fake_gui.mouseDown.side_effect = _blocked_mouse_down
        fake_gui.mouseUp.side_effect = _record_mouse_up

        ws = _ScriptedWs()
        daemon.clients.add(ws)
        daemon.authenticated_clients.add(ws)

        with mock.patch.object(agent_mod, "pyautogui", fake_gui):
            # Start an in-flight mouse_down on _input_executor, then immediately trigger disconnect release
            down_task = asyncio.create_task(
                daemon._process_virtual_input(
                    json.dumps({"action": "mouse_down", "button": "left"}).encode("utf-8"),
                    ws=ws,
                )
            )
            await asyncio.to_thread(started.wait, 2.0)
            # Release submitted while mouse_down is still executing on _input_executor
            daemon._release_client_held_buttons(ws)
            gate.set()
            await down_task
            # Wait for FIFO-queued release task on single-worker _input_executor
            await asyncio.to_thread(daemon._input_executor.submit(lambda: None).result, 2.0)

        self.assertEqual(events, [("down", "left"), ("up", "left")])
        self.assertNotIn(ws, daemon._client_pressed_buttons)

        # Stress concurrent mutations + kill_all_tasks() across threads (no dict-size RuntimeError)
        errors = []
        stop_flag = threading.Event()
        peers = [_ScriptedWs(remote_address=("127.0.0.1", 56000 + i)) for i in range(6)]

        def _mutator():
            try:
                while not stop_flag.is_set():
                    for p in peers:
                        daemon._record_client_button_state(p, "left", True)
                        daemon._record_client_button_state(p, "right", True)
                        daemon._record_client_button_state(p, "left", False)
            except Exception as exc:
                errors.append(exc)

        t = threading.Thread(target=_mutator, daemon=True)
        t.start()
        try:
            with mock.patch.object(agent_mod, "pyautogui", mock.MagicMock()):
                for _ in range(15):
                    daemon._drain_and_release_buttons_sync(None)
                    await asyncio.sleep(0.002)
        finally:
            stop_flag.set()
            t.join(timeout=2.0)
        daemon._drain_and_release_buttons_sync(None)
        self.assertEqual(errors, [])
        self.assertEqual(daemon._client_pressed_buttons, {})

    async def test_key_and_hotkey_aliases_normalize_and_preserve_blocked_combos(self):
        daemon = self._make_daemon()
        daemon.view_only_mode = False
        fake_gui = mock.MagicMock()
        fake_gui.KEYBOARD_KEYS = ["up", "down", "left", "right", "esc", "enter", "space", "ctrl", "alt", "del", "c", "win", "command"]

        with mock.patch.object(agent_mod, "pyautogui", fake_gui):
            await daemon._process_virtual_input(json.dumps({"action": "key_press", "key": "ArrowUp"}).encode("utf-8"))
            await daemon._process_virtual_input(json.dumps({"action": "key_press", "key": "Escape"}).encode("utf-8"))
            await daemon._process_virtual_input(json.dumps({"action": "key_press", "key": " "}).encode("utf-8"))
            await daemon._process_virtual_input(json.dumps({"action": "hotkey", "keys": ["Control", "c"]}).encode("utf-8"))
            # Blocked combo must still be rejected even with alias spelling
            await daemon._process_virtual_input(json.dumps({"action": "hotkey", "keys": ["Control", "Alt", "Delete"]}).encode("utf-8"))

        fake_gui.press.assert_any_call("up", _pause=False)
        fake_gui.press.assert_any_call("esc", _pause=False)
        fake_gui.press.assert_any_call("space", _pause=False)
        fake_gui.hotkey.assert_called_once_with("ctrl", "c", _pause=False)

    async def test_stream_pause_idle_buffer_release_status_summary_and_tray_tooltip(self):
        daemon = self._make_daemon(port=8789)
        daemon.screen_pipeline._work_bgra = np.zeros((16, 16, 4), dtype=np.uint8)
        daemon.screen_pipeline._scaled_bgrx = np.zeros((8, 8, 4), dtype=np.uint8)
        daemon.screen_pipeline._last_encoded_frame = b"\xff\xd8\xff\xd9"
        daemon.screen_pipeline.force_keyframe = False

        daemon.screen_pipeline.release_idle_buffers()
        self.assertIsNone(daemon.screen_pipeline._work_bgra)
        self.assertIsNone(daemon.screen_pipeline._scaled_bgrx)
        self.assertIsNone(daemon.screen_pipeline._last_encoded_frame)
        self.assertTrue(daemon.screen_pipeline.force_keyframe)

        # Verify paused daemon does not grab frames even with authenticated clients
        ws = _ScriptedWs()
        daemon.authenticated_clients.add(ws)
        daemon.is_paused = True
        grab_spy = mock.AsyncMock(return_value=b"\xff\xd8\xff\xd9")
        daemon.screen_pipeline.get_next_frame = grab_spy
        daemon._stream_wake_event = asyncio.Event()
        loop_task = asyncio.create_task(daemon._screen_stream_loop())
        await asyncio.sleep(0.08)
        daemon.is_running = False
        daemon._wake_stream()
        await asyncio.wait_for(loop_task, timeout=1.0)
        grab_spy.assert_not_called()

        # Verify zero-secret get_status_summary & tray tooltip
        daemon.is_running = True
        summary = daemon.get_status_summary()
        raw_summary = json.dumps(summary).lower()
        self.assertNotIn(daemon.pairing_token.lower(), raw_summary)
        self.assertNotIn("pairing_pin", raw_summary)
        self.assertEqual(summary["port"], 8789)
        self.assertIn("capture_backend", summary)
        self.assertIn("jpeg_encoder", summary)

        tip_paused = daemon._build_tray_tooltip()
        self.assertIn("PAUSED", tip_paused)
        self.assertLessEqual(len(tip_paused), 127)
        daemon.is_paused = False
        daemon.view_only_mode = True
        self.assertIn("VIEW-ONLY", daemon._build_tray_tooltip())

    async def test_telemetry_includes_backward_compatible_additive_fields(self):
        ws_port = _free_tcp_port()
        daemon = self._make_daemon(port=ws_port)
        daemon.screen_pipeline._grab_and_compress = lambda: (None, True)
        await daemon.start()
        psk = daemon.pairing_token.encode("utf-8")
        async with websockets.connect(f"ws://127.0.0.1:{ws_port}") as ws:
            chal = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
            sig = hmac.new(psk, chal[5], hashlib.sha256).digest()
            await ws.send(agent_mod.pack_packet(agent_mod.OP_AUTH, sig, seq=1))
            await asyncio.wait_for(ws.recv(), timeout=3.0)

            telem = None
            deadline = time.monotonic() + 4.5
            while time.monotonic() < deadline:
                raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
                pkt = agent_mod.unpack_packet(raw)
                if pkt and pkt[1] == agent_mod.OP_TELEMETRY:
                    telem = json.loads(pkt[5].decode("utf-8"))
                    break
            self.assertIsNotNone(telem)
            for k in (
                "target_fps", "jpeg_quality", "capture_backend", "jpeg_encoder",
                "tls_enabled", "security_profile", "monitors_count", "is_locked",
                "is_paused", "capabilities",
            ):
                self.assertIn(k, telem)
            self.assertEqual(telem["port"], ws_port)
            self.assertIn("frame_ack", telem["capabilities"])
            self.assertIn("x25519_aead", telem["capabilities"])

    async def test_udp_discovery_respects_dynamic_pause_and_releases_port_immediately(self):
        ws_port = _free_tcp_port()
        daemon = self._make_daemon(
            port=ws_port,
            enable_udp_discovery=True,
            discovery_port=0,
        )
        await daemon.start()
        udp_port = daemon._udp_discovery_port_bound
        self.assertIsNotNone(udp_port)

        # Dynamic pause via config/memory silences UDP discovery replies
        daemon.is_paused = True
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.18)
        try:
            sock.sendto(b"CST_DISCOVER_V1", ("127.0.0.1", udp_port))
            with self.assertRaises(socket.timeout):
                await asyncio.to_thread(sock.recvfrom, 1024)
        finally:
            sock.close()

        # Immediate clean port release on async_stop
        await daemon.async_stop()
        rebind = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            rebind.bind(("127.0.0.1", udp_port))
        finally:
            rebind.close()


class TestDesktopGuiAndThemeQOL(unittest.TestCase):
    def test_host_daemon_state_accepts_none_host_port_from_cli_launcher(self):
        with tempfile.TemporaryDirectory(prefix="ainet_qol_gui_state_") as tmp:
            with mock.patch.dict(os.environ, {"AI_CONFIG_DIR": tmp}, clear=False):
                cfg = cfg_mod.load_config()
                cfg["port"] = 8899
                cfg_mod.save_config(cfg)
                state = gui_mod.HostDaemonState(host=None, port=None)
                self.assertEqual(state.bind_host, "0.0.0.0")
                self.assertEqual(state.port, 8899)

    def test_gui_quick_copy_feedback_and_zero_dangling_timers_on_destroy(self):
        day = ui_mod.get_liquid_palette("light", "violet")
        dark = ui_mod.get_liquid_palette("dark", "violet")
        self.assertEqual(day.TEXT_TERTIARY, "#5E648C")
        self.assertEqual(dark.TEXT_TERTIARY, "#8B96C4")

        if not gui_mod.HAS_TKINTER:
            self.skipTest("Tkinter unavailable")
        with tempfile.TemporaryDirectory(prefix="ainet_qol_gui_") as tmp:
            with mock.patch.dict(os.environ, {"AI_CONFIG_DIR": tmp}, clear=False):
                state = gui_mod.HostDaemonState(host="127.0.0.1", port=8765)
                state.setup_completed = True
                try:
                    gui = gui_mod.HostDaemonDesktopGUI(state=state)
                except Exception as exc:
                    self.skipTest(f"Tkinter display unavailable: {exc}")
                try:
                    gui.root.withdraw()
                    gui._copy_lan_endpoint()
                    self.assertEqual(gui._btn_copy_ip.cget("text"), "COPIED ✓")
                    self.assertEqual(gui.root.clipboard_get(), f"{state.local_ip}:8765")

                    gui._copy_pin()
                    self.assertEqual(gui._btn_copy_pin.cget("text"), "COPIED ✓")
                    self.assertEqual(gui.root.clipboard_get(), state.pairing_pin)

                    gui._copy_console_logs()
                    self.assertEqual(gui._btn_copy_logs.cget("text"), "COPIED ✓")

                    # Live theme swap + responsive scaling must cancel pending timers cleanly
                    gui.toggle_theme_mode()
                    gui._apply_responsive_scaling(640, 420)
                    gui._select_tab("system")
                    self.assertEqual(len(gui._sys_checkbuttons), 3)
                finally:
                    gui.root.destroy()
                    self.assertIsNone(gui._scroll_sync_after_id)
                    self.assertIsNone(gui._refresh_after_id)
                    self.assertEqual(gui._btn_flash_after_ids, {})


if __name__ == "__main__":
    unittest.main()
