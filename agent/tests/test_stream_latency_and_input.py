"""
Host-Side Low-Latency Screen Streaming & Input Overhaul Tests
=============================================================
Covers:
1. OP_FRAME_ACK (0x0E) credit pacing, 350ms stall recovery, AEAD replay safety, and disconnect cleanup.
2. OP_VIEWPORT_RESIZE (0x0A) frame_ack capability, max_width/max_height caps, and non-mutating snapshot response.
3. AdaptiveScreenPipeline zero-copy BGRX downscale, reusable _work_bgra cursor buffer, DXGI/TurboJPEG probing, and capture_snapshot.
4. Progressive static-frame backoff in _screen_stream_loop (max 160ms, <1ms wake, never 450ms).
5. Off-loop AEAD encryption on _crypto_executor for OP_FRAME >= 16384 bytes and clean shutdown.
6. Coalesced non-blocking binary event_type == 4 moves (with non-None ws), move->click flush ordering, and Win32 SendInput helpers & test guard.
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
import types
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
    HostCryptoVault,
    PROTOCOL_MAGIC,
    hkdf_extract_and_expand,
)


def _free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _make_bgra_frame(width: int = 320, height: int = 180, b: int = 40, g: int = 120, r: int = 200) -> bytearray:
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


def _establish_vault_pair(psk: bytes):
    vault = HostCryptoVault(psk)
    chal = vault.create_handshake_challenge()
    host_pub = chal[11:43]
    host_n2 = chal[43:59]
    cli_priv, cli_pub = FallbackCurve25519.generate_keypair()
    cli_n1 = secrets.token_bytes(16)
    mac = hmac.new(psk, PROTOCOL_MAGIC + host_pub + cli_pub + cli_n1 + host_n2, hashlib.sha256).digest()
    assert vault.complete_handshake(cli_pub + cli_n1 + mac)
    ss = FallbackCurve25519.compute_shared_secret(cli_priv, host_pub)
    host_tx_key = hkdf_extract_and_expand(cli_n1 + host_n2, ss, CTX_HOST_TX, 32)
    client_tx_key = hkdf_extract_and_expand(cli_n1 + host_n2, ss, CTX_CLIENT_TX, 32)
    return vault, host_tx_key, client_tx_key


class _FakeWebSocket:
    def __init__(self, incoming=None, remote_address=("127.0.0.1", 55432)):
        self.incoming = list(incoming or [])
        self.remote_address = remote_address
        self.sent = []
        self.closed = False
        self.request_headers = {}
        self.transport = MagicMock()
        self.transport.get_write_buffer_size.return_value = 0

    def __aiter__(self):
        self._iter = iter(self.incoming)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration

    async def send(self, data):
        self.sent.append(data)

    async def close(self, code=1000, reason=""):
        self.closed = True


class TestFrameAckAndViewportSnapshot(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="ai_net_ack_snap_")
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
        self.daemons = []

    async def asyncTearDown(self):
        for d in reversed(self.daemons):
            try:
                await asyncio.wait_for(d.async_stop(), timeout=4.0)
            except Exception:
                pass
        self.daemons.clear()
        self.agent_cfg_patch.stop()
        self.cfg_patch.stop()
        self._env_patch.stop()
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _make_daemon(self, port: int = 0):
        d = agent_mod.HostAgentDaemon(
            host="127.0.0.1",
            port=port,
            enable_tray=False,
            enable_mdns=False,
            enable_udp_discovery=False,
        )
        self.daemons.append(d)
        return d

    async def test_01_op_frame_ack_credit_pacing_and_350ms_stall_recovery(self):
        daemon = self._make_daemon()
        ws = _FakeWebSocket()
        daemon._ws_write_locks[ws] = asyncio.Lock()
        daemon.authenticated_clients.add(ws)
        daemon._send_frame_guarded = AsyncMock()
        daemon._client_ack_capable.add(ws)

        # Tighten write buffer threshold to 131_072 (128 KiB)
        ws.transport.get_write_buffer_size.return_value = 131_073
        self.assertEqual(daemon._dispatch_frame_to_clients([ws], b"f0"), 0)

        ws.transport.get_write_buffer_size.return_value = 131_072
        fake_now = [100.0]
        with patch.object(agent_mod.time, "monotonic", side_effect=lambda: fake_now[0]):
            # Frame 1 & 2 consume the 2-frame credit window
            self.assertEqual(daemon._dispatch_frame_to_clients([ws], b"f1"), 1)
            self.assertEqual(daemon._client_unacked_frames[ws], 1)
            self.assertEqual(daemon._dispatch_frame_to_clients([ws], b"f2"), 1)
            self.assertEqual(daemon._client_unacked_frames[ws], 2)

            # Frame 3 within <0.35s is skipped due to backpressure credit limit
            fake_now[0] = 100.20
            self.assertEqual(daemon._dispatch_frame_to_clients([ws], b"f3"), 0)
            self.assertIn(ws, daemon._client_credit_waiting)

            # Binary OP_FRAME_ACK releases credit and wakes stream immediately
            daemon.loop = asyncio.get_running_loop()
            daemon._loop_thread_id = threading.get_ident()
            daemon._stream_wake_event = asyncio.Event()
            daemon.screen_pipeline.consecutive_static = 8
            await daemon._process_frame_ack(ws, struct.pack("!I", 12))
            self.assertEqual(daemon._client_unacked_frames[ws], 1)
            self.assertTrue(daemon._stream_wake_event.is_set())
            self.assertEqual(daemon.screen_pipeline.consecutive_static, 0)

            # Refill to 2 unacked frames and advance >=0.35s without ACK -> stall recovery resets unacked
            self.assertEqual(daemon._dispatch_frame_to_clients([ws], b"f4"), 1)
            self.assertEqual(daemon._client_unacked_frames[ws], 2)
            fake_now[0] = 100.25
            self.assertEqual(daemon._dispatch_frame_to_clients([ws], b"f5_blocked"), 0)
            fake_now[0] = 100.62  # >= 0.35s since 100.20
            self.assertEqual(daemon._dispatch_frame_to_clients([ws], b"f5_recovered"), 1)
            self.assertEqual(daemon._client_unacked_frames[ws], 1)

            # JSON {"ack_seq": N} clamps unacked >= 0
            await daemon._process_frame_ack(ws, json.dumps({"ack_seq": 99}).encode("utf-8"))
            await daemon._process_frame_ack(ws, json.dumps({"ack_seq": 100}).encode("utf-8"))
            self.assertEqual(daemon._client_unacked_frames[ws], 0)

    async def test_02_encrypted_op_frame_ack_replay_and_disconnect_cleanup(self):
        self.assertEqual(agent_mod.OP_FRAME_ACK, 0x0E)
        ws_port = _free_tcp_port()
        daemon = self._make_daemon(port=ws_port)
        daemon.screen_pipeline.consecutive_static = 5
        daemon.screen_pipeline._grab_and_compress = lambda: (None, True)
        await daemon.start()

        psk = daemon.pairing_token.encode("utf-8")
        async with websockets.connect(f"ws://127.0.0.1:{ws_port}") as ws:
            chal = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
            auth_sig = hmac.new(psk, chal[5], hashlib.sha256).digest()
            await ws.send(agent_mod.pack_packet(agent_mod.OP_AUTH, auth_sig, seq=1))
            ack = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
            self.assertEqual(ack[5], b"OK_AUTHENTICATED")

            cli_chal = secrets.token_bytes(16)
            await ws.send(agent_mod.pack_packet(agent_mod.OP_AUTH, b"INIT_ECDH_VAULT_M:" + cli_chal, seq=2))
            host_chal_pkt = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
            chal_59 = host_chal_pkt[5][:59]
            host_pub = chal_59[11:43]
            host_n2 = chal_59[43:59]
            cli_priv, cli_pub = FallbackCurve25519.generate_keypair()
            cli_n1 = secrets.token_bytes(16)
            cli_mac = hmac.new(psk, PROTOCOL_MAGIC + host_pub + cli_pub + cli_n1 + host_n2, hashlib.sha256).digest()
            await ws.send(agent_mod.pack_packet(agent_mod.OP_AUTH, cli_pub + cli_n1 + cli_mac, seq=3))
            ok_vault = agent_mod.unpack_packet(await asyncio.wait_for(ws.recv(), timeout=3.0))
            self.assertEqual(ok_vault[5], b"OK_ECDH_VAULT")

            ss = FallbackCurve25519.compute_shared_secret(cli_priv, host_pub)
            cli_tx_key = hkdf_extract_and_expand(cli_n1 + host_n2, ss, CTX_CLIENT_TX, 32)

            server_ws = next(iter(daemon.authenticated_clients))
            daemon._client_unacked_frames[server_ws] = 2

            def _make_enc_ack(wire_seq: int, acked_frame_seq: int) -> bytes:
                plain = struct.pack("!I", acked_frame_seq)
                aad = agent_mod._HEADER_STRUCT.pack(agent_mod.MAGIC, agent_mod.OP_FRAME_ACK, 0x02, wire_seq, len(plain) + 28)
                nonce = struct.pack(">IQ", 0, wire_seq)
                ct = FallbackChaCha20Poly1305.encrypt(cli_tx_key, nonce, plain, aad)
                return agent_mod.pack_packet(agent_mod.OP_FRAME_ACK, nonce + ct, seq=wire_seq, flags=0x02)

            # Valid encrypted OP_FRAME_ACK (wire_seq=1)
            await ws.send(_make_enc_ack(wire_seq=1, acked_frame_seq=7))
            await asyncio.sleep(0.05)
            self.assertIn(server_ws, daemon._client_ack_capable)
            self.assertEqual(daemon._client_unacked_frames.get(server_ws), 1)

            # Replayed wire_seq=1 must be rejected cleanly without decrementing again
            await ws.send(_make_enc_ack(wire_seq=1, acked_frame_seq=7))
            await asyncio.sleep(0.05)
            self.assertEqual(daemon._client_unacked_frames.get(server_ws), 1)

        # Disconnect cleanup removes tracking state
        await asyncio.sleep(0.05)
        self.assertNotIn(server_ws, daemon._client_ack_capable)
        self.assertNotIn(server_ws, daemon._client_unacked_frames)
        self.assertNotIn(server_ws, daemon._client_last_frame_sent_ts)

    async def test_03_viewport_resize_caps_frame_ack_and_non_mutating_snapshot(self):
        daemon = self._make_daemon()
        daemon.screen_pipeline.turbo = None
        daemon.screen_pipeline.set_target_resolution(1920, 1080)
        daemon.screen_pipeline.set_quality(82)
        daemon.screen_pipeline.force_keyframe = False
        daemon.screen_pipeline.last_frame_hash = 123456
        daemon.screen_pipeline.consecutive_static = 9

        src = _make_bgra_frame(1280, 720, b=20, g=90, r=210)
        fake_sct = MagicMock()
        fake_sct.monitors = [{}, {"left": 0, "top": 0, "width": 1280, "height": 720}]
        fake_sct.grab.return_value = _make_shot(src, 1280, 720)
        daemon.screen_pipeline._get_mss = lambda: fake_sct

        ws = _FakeWebSocket()
        daemon._ws_write_locks[ws] = asyncio.Lock()
        daemon.authenticated_clients.add(ws)

        # Snapshot request matching mobile payload (includes width/height/quality + stream_enabled: false)
        snap_req = json.dumps({
            "snapshot": True,
            "stream_enabled": False,
            "width": 320,
            "height": 180,
            "quality": 40,
            "frame_ack": True,
        }).encode("utf-8")
        await daemon._process_viewport_resize(snap_req, ws=ws)

        self.assertIn(ws, daemon._client_ack_capable)
        self.assertIn(ws, daemon._stream_paused_clients)
        self.assertFalse(daemon._is_client_ready_for_stream(ws))
        self.assertEqual(daemon.screen_pipeline.target_res, (1920, 1080))
        self.assertEqual(daemon.screen_pipeline.jpeg_quality, 82)
        self.assertEqual(daemon.screen_pipeline.last_frame_hash, 123456)
        self.assertEqual(daemon.screen_pipeline.consecutive_static, 9)
        self.assertFalse(daemon.screen_pipeline.force_keyframe)

        self.assertEqual(len(ws.sent), 1)
        pkt = agent_mod.unpack_packet(ws.sent[0])
        self.assertIsNotNone(pkt)
        self.assertEqual(pkt[1], agent_mod.OP_FRAME)
        decoded = Image.open(io.BytesIO(pkt[5]))
        self.assertEqual(decoded.size, (320, 180))

        # max_width / max_height caps clamp target_res cleanly
        await daemon._process_viewport_resize(
            json.dumps({
                "width": 2560,
                "height": 1440,
                "max_width": 1280,
                "max_height": 720,
                "stream_enabled": True,
            }).encode("utf-8"),
            ws=ws,
        )
        self.assertEqual(daemon.screen_pipeline.target_res, (1280, 720))
        self.assertNotIn(ws, daemon._stream_paused_clients)


class TestFastCaptureAndBackoff(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.pipeline = agent_mod.AdaptiveScreenPipeline(target_resolution=(640, 360))
        self.pipeline.turbo = None

    def tearDown(self):
        self.pipeline.close()

    def test_01_reusable_buffers_bgrx_downscale_and_1to1_cursor(self):
        # 1:1 path with cursor reuses _work_bgra across frames without mutating source
        frame_320 = _make_bgra_frame(320, 180, b=50, g=100, r=150)
        snap_before = bytes(frame_320)
        self.pipeline.set_target_resolution(320, 180)
        self.pipeline.turbo = MagicMock()
        self.pipeline.turbo.encode.return_value = b"\xff\xd8\xff\xe0\xff\xd9"
        fake_sct = MagicMock()
        fake_sct.monitors = [{"left": 0, "top": 0, "width": 320, "height": 180}]
        fake_sct.grab.side_effect = lambda _m: _make_shot(frame_320, 320, 180)
        self.pipeline._local.sct = fake_sct

        with patch.object(self.pipeline.cursor_compositor, "get_monitor_cursor", return_value=(40, 40, 0)):
            self.pipeline.force_keyframe = True
            self.pipeline._grab_and_compress()
            work1 = self.pipeline._work_bgra
            self.assertIsNotNone(work1)
            self.assertEqual(work1.shape, (180, 320, 4))

            self.pipeline.force_keyframe = True
            self.pipeline._grab_and_compress()
            self.assertIs(self.pipeline._work_bgra, work1, "_work_bgra must be reused without reallocation")
            args, kwargs = self.pipeline.turbo.encode.call_args
            self.assertEqual(kwargs["pixel_format"], agent_mod.TJPF_BGRX)
        self.assertEqual(bytes(frame_320), snap_before)

        # Downscale path reuses _scaled_bgrx and passes TJPF_BGRX
        frame_640 = _make_bgra_frame(640, 360, b=10, g=20, r=240)
        self.pipeline.set_target_resolution(320, 180)
        fake_sct.grab.side_effect = lambda _m: _make_shot(frame_640, 640, 360)
        self.pipeline.turbo.encode.reset_mock()

        self.pipeline.force_keyframe = True
        self.pipeline._grab_and_compress()
        scaled1 = self.pipeline._scaled_bgrx
        self.assertIsNotNone(scaled1)
        self.assertEqual(scaled1.shape, (180, 320, 4))
        self.assertTrue(scaled1.flags.c_contiguous)
        args, kwargs = self.pipeline.turbo.encode.call_args
        self.assertIs(args[0], scaled1)
        self.assertEqual(kwargs["pixel_format"], agent_mod.TJPF_BGRX)

        self.pipeline.force_keyframe = True
        self.pipeline._grab_and_compress()
        self.assertIs(self.pipeline._scaled_bgrx, scaled1, "_scaled_bgrx must be reused across frames")

        # Pillow BGRX fallback preserves exact R/G/B colors
        self.pipeline.turbo = None
        self.pipeline.force_keyframe = True
        with patch.object(self.pipeline.cursor_compositor, "get_monitor_cursor", return_value=None):
            jpg_bytes, _ = self.pipeline._grab_and_compress()
        im = Image.open(io.BytesIO(jpg_bytes))
        self.assertEqual(im.size, (320, 180))
        r, g, b = im.getpixel((10, 10))
        self.assertGreater(r, 200)
        self.assertLess(b, 50)

    def test_02_capture_snapshot_isolates_stream_state(self):
        src = _make_bgra_frame(1280, 720, b=30, g=140, r=60)
        fake_sct = MagicMock()
        fake_sct.monitors = [{"left": 0, "top": 0, "width": 1280, "height": 720}]
        fake_sct.grab.return_value = _make_shot(src, 1280, 720)
        self.pipeline._local.sct = fake_sct

        self.pipeline.target_res = (1280, 720)
        self.pipeline.jpeg_quality = 77
        self.pipeline.last_frame_hash = 9999
        self.pipeline._last_diff_sample = b"sentinel"
        self.pipeline.consecutive_static = 14
        self.pipeline.force_keyframe = False
        self.pipeline._last_encoded_frame = b"prev_frame"
        self.pipeline.last_stream_size = (1280, 720)

        snap = self.pipeline.capture_snapshot(max_width=480, max_height=270, quality=45)
        self.assertIsNotNone(snap)
        decoded = Image.open(io.BytesIO(snap))
        self.assertEqual(decoded.size, (480, 270))

        self.assertEqual(self.pipeline.target_res, (1280, 720))
        self.assertEqual(self.pipeline.jpeg_quality, 77)
        self.assertEqual(self.pipeline.last_frame_hash, 9999)
        self.assertEqual(self.pipeline._last_diff_sample, b"sentinel")
        self.assertEqual(self.pipeline.consecutive_static, 14)
        self.assertFalse(self.pipeline.force_keyframe)
        self.assertEqual(self.pipeline._last_encoded_frame, b"prev_frame")
        self.assertEqual(self.pipeline.last_stream_size, (1280, 720))

    def test_03_dxgi_detection_fallback_and_turbojpeg_probe(self):
        # _discover_turbojpeg probes standard path when file exists
        fake_tj_cls = MagicMock(return_value="TJ_INST")
        with patch.object(agent_mod, "TurboJPEG", fake_tj_cls), \
             patch.object(agent_mod.os.path, "isfile", side_effect=lambda p: p == r"C:\libjpeg-turbo64\bin\turbojpeg.dll"):
            res = agent_mod._discover_turbojpeg()
        self.assertEqual(res, "TJ_INST")
        fake_tj_cls.assert_called_once_with(r"C:\libjpeg-turbo64\bin\turbojpeg.dll")

        # DXGI auto-detect when real mss module and AI_HEADLESS != "1", with fallback on failure
        frame_arr = np.full((180, 320, 4), 120, dtype=np.uint8)
        fake_cam = MagicMock()
        fake_cam.grab.return_value = frame_arr
        fake_dxcam = MagicMock()
        fake_dxcam.create.return_value = fake_cam

        fake_real_mss = types.ModuleType("mss")
        fake_sct = MagicMock()
        fake_sct.monitors = [{}, {"left": 0, "top": 0, "width": 320, "height": 180}]
        fake_sct.__class__.__module__ = "mss.windows"
        fake_real_mss.MSS = MagicMock(return_value=fake_sct)

        with patch.object(agent_mod.platform, "system", return_value="Windows"), \
             patch.dict(os.environ, {"AI_HEADLESS": "0"}, clear=False), \
             patch.object(agent_mod, "dxcam", fake_dxcam), \
             patch.object(agent_mod, "mss", fake_real_mss):
            self.assertTrue(self.pipeline._can_use_dxgi())
            jpg, _ = self.pipeline._grab_and_compress()
            self.assertIsNotNone(jpg)
            fake_cam.grab.assert_called_once()
            fake_sct.grab.assert_not_called()

            # Simulate DXGI grab failure -> self-heals to MSS fallback
            fake_cam.grab.side_effect = RuntimeError("DXGI access lost")
            fake_sct.grab.return_value = _make_shot(_make_bgra_frame(320, 180), 320, 180)
            self.pipeline.force_keyframe = True
            jpg2, _ = self.pipeline._grab_and_compress()
            self.assertIsNotNone(jpg2)
            self.assertTrue(self.pipeline._dxgi_disabled)
            fake_sct.grab.assert_called_once()

        # MultiMonitorStreamer TurboJPEG probe + DXGI detection & clean close
        import multi_monitor_streamer as mms_mod
        with patch.object(mms_mod, "TurboJPEG", fake_tj_cls), \
             patch.object(mms_mod.os.path, "isfile", side_effect=lambda p: p == r"C:\libjpeg-turbo64\bin\turbojpeg.dll"):
            self.assertEqual(mms_mod._discover_turbojpeg(), "TJ_INST")

        fake_cam2 = MagicMock()
        fake_cam2.grab.return_value = frame_arr
        fake_dxcam2 = MagicMock()
        fake_dxcam2.create.return_value = fake_cam2
        fake_sct2 = MagicMock()
        fake_sct2.monitors = [{}, {"left": 0, "top": 0, "width": 320, "height": 180}]
        fake_sct2.__class__.__module__ = "mss.windows"
        fake_real_mss2 = types.ModuleType("mss")
        fake_real_mss2.MSS = MagicMock(return_value=fake_sct2)

        with patch.object(mms_mod.platform, "system", return_value="Windows"), \
             patch.dict(os.environ, {"AI_HEADLESS": "0"}, clear=False), \
             patch.object(mms_mod, "dxcam", fake_dxcam2), \
             patch.object(mms_mod, "mss", fake_real_mss2):
            streamer = mms_mod.MultiMonitorStreamer()
            try:
                res = streamer.capture_frame(quality=60)
                self.assertIsNotNone(res)
                self.assertEqual(res[1:], (320, 180))
                fake_cam2.grab.assert_called_once()
                fake_sct2.grab.assert_not_called()
            finally:
                streamer.close()
                fake_cam2.stop.assert_called()

    async def test_04_progressive_static_frame_backoff_never_450ms(self):
        compute = agent_mod.HostAgentDaemon._compute_stream_sleep_dt
        self.assertLess(compute(0, 60, 0.0), 0.02)
        self.assertLess(compute(9, 60, 0.0), 0.02)
        self.assertAlmostEqual(compute(10, 60, 0.0), 0.04, places=4)
        self.assertAlmostEqual(compute(20, 60, 0.0), 0.04, places=4)
        self.assertAlmostEqual(compute(21, 60, 0.0), 0.08, places=4)
        self.assertAlmostEqual(compute(40, 60, 0.0), 0.08, places=4)
        self.assertAlmostEqual(compute(41, 60, 0.0), 0.16, places=4)
        self.assertAlmostEqual(compute(500, 60, 0.0), 0.16, places=4)

        # Verify _screen_stream_loop wakes immediately (<50ms) when _wake_stream is triggered
        with tempfile.TemporaryDirectory(prefix="ai_net_backoff_") as tmp:
            cfg_path = os.path.join(tmp, "config.json")
            with patch.object(daemon_config_mod, "get_config_path", return_value=cfg_path), \
                 patch.object(agent_mod, "get_config_path", return_value=cfg_path):
                daemon = agent_mod.HostAgentDaemon(
                    host="127.0.0.1",
                    port=0,
                    enable_tray=False,
                    enable_mdns=False,
                    enable_udp_discovery=False,
                )
                try:
                    daemon.loop = asyncio.get_running_loop()
                    daemon._loop_thread_id = threading.get_ident()
                    daemon._stream_wake_event = asyncio.Event()
                    ws = _FakeWebSocket()
                    daemon.authenticated_clients.add(ws)
                    daemon.screen_pipeline.consecutive_static = 60
                    grab_times = []

                    async def _fake_next():
                        grab_times.append(time.perf_counter())
                        daemon.screen_pipeline.consecutive_static += 1
                        return None

                    daemon.screen_pipeline.get_next_frame = _fake_next
                    task = asyncio.create_task(daemon._screen_stream_loop())
                    await asyncio.sleep(0.05)
                    t_wake = time.perf_counter()
                    daemon._wake_stream()
                    await asyncio.sleep(0.05)
                    daemon.is_running = False
                    daemon._wake_stream()
                    await asyncio.wait_for(task, timeout=1.0)

                    # Should have woken up rapidly after _wake_stream without 450ms stall
                    woken = [t - t_wake for t in grab_times if t >= t_wake]
                    self.assertTrue(woken and min(woken) < 0.05, f"Expected <50ms wakeup, got {woken}")
                finally:
                    await daemon.async_stop()


class TestOffLoopCryptoAndCoalescedInput(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="ai_net_crypto_input_")
        self.cfg_path = os.path.join(self.tmpdir, "config.json")
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
        await self.daemon.async_stop()
        self.agent_cfg_patch.stop()
        self.cfg_patch.stop()
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    async def test_01_off_loop_crypto_executor_for_large_op_frame_and_shutdown(self):
        psk = secrets.token_bytes(32)
        vault, host_tx_key, _ = _establish_vault_pair(psk)
        ws = _FakeWebSocket()
        self.daemon._ws_write_locks[ws] = asyncio.Lock()
        self.daemon._client_vaults[ws] = vault

        seen_threads = []
        orig_encrypt = vault.encrypt_frame

        def _spy_encrypt(pt, aad=b"", seq=None):
            seen_threads.append(threading.current_thread().name)
            return orig_encrypt(pt, aad=aad, seq=seq)

        vault.encrypt_frame = _spy_encrypt

        large_frame = b"\xff\xd8" + (b"A" * 20_000) + b"\xff\xd9"
        await self.daemon._send_encrypted_or_plain(ws, agent_mod.OP_FRAME, large_frame, seq=1)
        self.assertEqual(len(seen_threads), 1)
        self.assertTrue(seen_threads[0].startswith("CryptoTx"))

        # Verify AEAD decryption matches host TX key
        wire = ws.sent[0]
        dec = FallbackChaCha20Poly1305.decrypt(
            host_tx_key,
            wire[12:24],
            wire[24:],
            aad=wire[:12],
        )
        self.assertEqual(dec, large_frame)

        # Small payload (<16384) encrypts on event-loop thread directly
        seen_threads.clear()
        main_name = threading.current_thread().name
        await self.daemon._send_encrypted_or_plain(ws, agent_mod.OP_FRAME, b"\xff\xd8small\xff\xd9", seq=2)
        self.assertEqual(seen_threads, [main_name])

        # Stop cleanly shuts down both _crypto_executor and _input_executor
        self.daemon.stop()
        self.assertIsNone(self.daemon._crypto_executor)
        self.assertIsNone(self.daemon._input_executor)
        vault.close()

    async def test_02_coalesced_binary_move_execution_and_click_flush(self):
        fake_gui = MagicMock()
        seen_threads = []

        def _spy_move(tx, ty, _pause=False):
            seen_threads.append(threading.current_thread().name)

        fake_gui.moveTo.side_effect = _spy_move
        self.daemon.screen_pipeline.last_capture_rect = (0, 0, 1920, 1080)
        ws = _FakeWebSocket()

        with patch.object(agent_mod, "pyautogui", fake_gui):
            # Fire rapid burst of 20 binary event_type == 4 moves with non-None ws
            for i in range(20):
                ux = int(round((i / 19.0) * 65535))
                uy = int(round((i / 19.0) * 65535))
                await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, ux, uy, 0), ws=ws)

            # Should NOT have blocked or executed all 20 moves inline
            self.assertEqual(fake_gui.moveTo.call_count, 0)
            self.assertEqual(self.daemon._latest_abs_move, (1919, 1079))

            await asyncio.sleep(0.05)
            # Burst coalesced to a single final move on InputInject executor
            fake_gui.moveTo.assert_called_once_with(1919, 1079, _pause=False)
            self.assertTrue(seen_threads and seen_threads[0].startswith("InputInject"))

            # Move followed immediately by binary click (type 5) flushes move BEFORE click
            fake_gui.reset_mock()
            order = []
            fake_gui.moveTo.side_effect = lambda tx, ty, _pause=False: order.append(("move", tx, ty))
            fake_gui.click.side_effect = lambda x, y, button="left", _pause=False: order.append(("click", x, y, button))

            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 0, 0, 0), ws=ws)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 4, 32768, 32768, 0), ws=ws)
            await self.daemon._process_virtual_input(struct.pack("!BHHB", 5, 65535, 65535, 1), ws=ws)
            self.assertEqual(order, [("move", 960, 540), ("click", 1919, 1079, "left")])

    def test_03_win32_sendinput_test_guard_and_virtual_desktop_helpers(self):
        # Guard must reject mocks (including spec=types.ModuleType) and headless mode
        with patch.object(agent_mod, "pyautogui", MagicMock()):
            self.assertFalse(agent_mod._should_use_win32_sendinput())
        with patch.object(agent_mod, "pyautogui", MagicMock(spec=types.ModuleType)):
            self.assertFalse(agent_mod._should_use_win32_sendinput())
        with patch.dict(os.environ, {"AI_HEADLESS": "1"}, clear=False):
            self.assertFalse(agent_mod._should_use_win32_sendinput())
        with patch.object(agent_mod.platform, "system", return_value="Linux"):
            self.assertFalse(agent_mod._should_use_win32_sendinput())

        if platform.system() != "Windows":
            return

        # Test virtual desktop coordinate mapping & SendInput struct payloads across multi-monitor offsets
        metrics = {76: -1920, 77: 0, 78: 3840, 79: 1080}
        sent_calls = []

        def _fake_send_input(count, ptr, size):
            sent_calls.append((count, size))
            return count

        fake_u32 = MagicMock()
        fake_u32.GetSystemMetrics.side_effect = lambda idx: metrics.get(idx, 0)
        fake_u32.SendInput.side_effect = _fake_send_input

        with patch.object(agent_mod, "_WIN_USER32_INPUT_BOUND", True), \
             patch.object(agent_mod.ctypes, "windll", SimpleNamespace(user32=fake_u32)):
            nx, ny = agent_mod._win32_virtual_desktop_coords(-1920, 0)
            self.assertEqual((nx, ny), (0, 0))
            nx2, ny2 = agent_mod._win32_virtual_desktop_coords(1919, 1079)
            self.assertGreater(nx2, 65000)
            self.assertGreater(ny2, 65000)

            self.assertTrue(agent_mod._win32_mouse_move_abs(0, 540))
            self.assertTrue(agent_mod._win32_mouse_click_abs(0, 540, button="left", double=True))
            self.assertTrue(agent_mod._win32_mouse_button_abs(0, 540, button="right", down=True))
            self.assertTrue(agent_mod._win32_mouse_move_rel(15, -20))
            self.assertTrue(agent_mod._win32_mouse_scroll(-120, dx=60, x=0, y=540))
            self.assertEqual([c[0] for c in sent_calls], [1, 4, 1, 1, 3])


if __name__ == "__main__":
    unittest.main()
