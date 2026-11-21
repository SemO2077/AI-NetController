"""
Autonomous AI NetController Host Agent & OS Bridge
Ultra-Low Latency Binary Daemon (Windows & Linux)
---------------------------------------------------------------------
Security & Architecture Hardening:
- Constant-Time HMAC-SHA256 Auth (hmac.compare_digest) & Nonce Replay Guards
- Strict Pre-Authentication Firewall (Unauthenticated frames dropped instantly)
- Windows Kernel Job Object Isolation (256MB Hard RAM Ceiling & KILL_ON_JOB_CLOSE)
- Process Handle Leak Prevention (CloseHandle called immediately on injection)
- Command Subprocess Execution Timeouts (15s auto-kill preventing hung processes)
- Thread-Safe Screen Frame Grabber with Reusable Preallocated Buffers
- Graceful Shutdown & Zero-Resource Leak Cleanup (mDNS, WebSockets, Executor, Tray)
"""

import asyncio
import ctypes
from ctypes import wintypes
import hashlib
import hmac
import io
import json
import logging
import math
import os
import platform
import re
import secrets
import shlex
import socket
import struct
import sys
import threading
import time
import zlib
import base64
import ipaddress
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional, Set, Tuple, Any

try:
    import numpy as np
except ImportError:
    np = None

def is_local_or_private_ip(ip_str: str) -> bool:
    """Returns True if IP is localhost, link-local, or private RFC1918 LAN address."""
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_loopback or ip.is_private or ip.is_link_local
    except ValueError:
        return False

# Ensure sibling modules in agent/ directory are always importable
_AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
if _AGENT_DIR not in sys.path:
    sys.path.insert(0, _AGENT_DIR)

# Third-party dependencies (with graceful stdlib fallbacks)
try:
    import websockets
except ImportError:
    websockets = None

WebSocketServerProtocol = Any

try:
    import psutil
except ImportError:
    psutil = None

try:
    import mss
except ImportError:
    mss = None

try:
    from PIL import Image
except ImportError:
    Image = None

try:
    from turbojpeg import TurboJPEG, TJPF_RGB, TJPF_BGRX, TJSAMP_420, TJFLAG_FASTDCT
except ImportError:
    TurboJPEG = None
    TJPF_RGB = 0
    TJPF_BGRX = 3
    TJSAMP_420 = 2
    TJFLAG_FASTDCT = 2048

try:
    from zeroconf import IPVersion, ServiceInfo
    from zeroconf.asyncio import AsyncZeroconf
except ImportError:
    AsyncZeroconf = None
    ServiceInfo = None
    IPVersion = None

def _has_desktop_display() -> bool:
    """Returns True if an interactive GUI display is available (avoids X11 errors on headless Linux)."""
    if os.environ.get("AI_HEADLESS") == "1":
        return False
    if platform.system() in ("Windows", "Darwin"):
        return True
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


try:
    if _has_desktop_display():
        import pystray
    else:
        pystray = None
except Exception:
    pystray = None

try:
    if _has_desktop_display():
        import pyautogui
        pyautogui.FAILSAFE = False  # Avoid exceptions when trackpad coordinates reach edge
    else:
        pyautogui = None
except Exception:
    pyautogui = None

try:
    from host_file_writer import HostFileWriter
except ImportError:
    try:
        from agent.host_file_writer import HostFileWriter
    except ImportError:
        HostFileWriter = None

try:
    from command_ast_firewall import CommandASTFirewall
except ImportError:
    try:
        from agent.command_ast_firewall import CommandASTFirewall
    except ImportError:
        CommandASTFirewall = None

try:
    from network_fuzzer_shield import NetworkFuzzerShield, ChaosProfile, ConnectionState
except ImportError:
    try:
        from agent.network_fuzzer_shield import NetworkFuzzerShield, ChaosProfile, ConnectionState
    except ImportError:
        NetworkFuzzerShield = None
        ChaosProfile = None
        ConnectionState = None

try:
    from multi_monitor_streamer import MultiMonitorStreamer
except ImportError:
    try:
        from agent.multi_monitor_streamer import MultiMonitorStreamer
    except ImportError:
        MultiMonitorStreamer = None

try:
    from crypto_vault import (
        HostCryptoVault,
        SlidingWindowReplayProtector,
        FallbackCurve25519,
        FallbackChaCha20Poly1305,
        fast_x25519_generate_keypair,
        fast_x25519_shared_secret,
        fast_chacha20_encrypt,
        fast_chacha20_decrypt,
        hkdf_extract_and_expand,
        scrub_memory,
    )
except ImportError:
    try:
        from agent.crypto_vault import (
            HostCryptoVault,
            SlidingWindowReplayProtector,
            FallbackCurve25519,
            FallbackChaCha20Poly1305,
            fast_x25519_generate_keypair,
            fast_x25519_shared_secret,
            fast_chacha20_encrypt,
            fast_chacha20_decrypt,
            hkdf_extract_and_expand,
            scrub_memory,
        )
    except ImportError:
        HostCryptoVault = None
        SlidingWindowReplayProtector = None
        FallbackCurve25519 = None
        FallbackChaCha20Poly1305 = None
        fast_x25519_generate_keypair = None
        fast_x25519_shared_secret = None
        fast_chacha20_encrypt = None
        fast_chacha20_decrypt = None
        hkdf_extract_and_expand = None
        scrub_memory = None

try:
    import pyperclip
except Exception:
    pyperclip = None

try:
    from windows_integration import (
        SingleInstanceGuard,
        check_port_available,
        create_desktop_shortcut,
        create_start_menu_shortcut,
        get_windows_autostart_enabled,
        set_windows_autostart,
        show_uninstall_dialog,
        show_install_dialog,
        perform_full_uninstall,
    )
except ImportError:
    try:
        from agent.windows_integration import (
            SingleInstanceGuard,
            check_port_available,
            create_desktop_shortcut,
            create_start_menu_shortcut,
            get_windows_autostart_enabled,
            set_windows_autostart,
            show_uninstall_dialog,
            show_install_dialog,
            perform_full_uninstall,
        )
    except ImportError:
        SingleInstanceGuard = None
        check_port_available = None
        create_desktop_shortcut = None
        create_start_menu_shortcut = None
        get_windows_autostart_enabled = None
        set_windows_autostart = None
        show_uninstall_dialog = None
        show_install_dialog = None
        perform_full_uninstall = None

try:
    from icon_assets import get_icon_image
except ImportError:
    try:
        from agent.icon_assets import get_icon_image
    except ImportError:
        get_icon_image = lambda size=64: None

try:
    from daemon_config import (
        get_config_path,
        get_config_revision,
        load_config,
        save_config,
    )
except ImportError:
    try:
        from agent.daemon_config import (
            get_config_path,
            get_config_revision,
            load_config,
            save_config,
        )
    except ImportError:
        def _ephemeral_config():
            return {
                "pairing_pin": f"{secrets.randbelow(900000) + 100000}",
                "pairing_token": f"ainet_{secrets.token_hex(24)}",
                "pin_issued_at": int(time.time()),
            }
        load_config = _ephemeral_config
        save_config = lambda cfg: False
        get_config_path = lambda: ""
        get_config_revision = lambda: 0

try:
    from tls_manager import build_server_ssl_context, compute_cert_fingerprint
except ImportError:
    try:
        from agent.tls_manager import build_server_ssl_context, compute_cert_fingerprint
    except ImportError:
        build_server_ssl_context = None  # type: ignore[assignment]
        compute_cert_fingerprint = None  # type: ignore[assignment]

# Configure logging with high-performance minimal formatter
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] [%(name)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("AI-NetController-Agent")

# =====================================================================
# PROTOCOL DEFINITION & CONSTANTS
# =====================================================================
MAGIC = b'\xC5\x71'  # 2-byte magic identifier
_HEADER_STRUCT = struct.Struct('!2sBBII')  # Total: 12 bytes
HEADER_SIZE = _HEADER_STRUCT.size
MAX_PAYLOAD_SIZE = 10 * 1024 * 1024  # 10 MB maximum allowed payload
MAX_WIRE_FRAME_SIZE = MAX_PAYLOAD_SIZE + HEADER_SIZE + 64
MAX_NONCE_AGE_SECONDS = 10.0  # Nonce expiry time for auth handshake
PIN_TTL_SECONDS = 900.0  # Pairing PIN expires after 15 minutes unless regenerated
MAX_CONCURRENT_CLIENTS = 32
MAX_CONNECTIONS_PER_IP = 8

# Canonical Binary Opcodes
OP_PING = 0x01            # 1: Ping / Heartbeat
OP_TELEMETRY = 0x02       # 2: Telemetry Frame (CPU, RAM, Disks, GPU, Active Process)
OP_FRAME = 0x03           # 3: Screen Frame (Compressed JPEG Payload)
OP_SHELL = 0x04           # 4: Shell Output Stream Chunk (stdout/stderr)
OP_HITL = 0x05            # 5: Human-in-the-Loop Security Interrupt
OP_AUTH = 0x06            # 6: Auth Handshake & Nonce Challenge
OP_CLIP = 0x07            # 7: Bidirectional Clipboard Sync
OP_INPUT = 0x08           # 8: Remote Virtual Input (Trackpad & Keystrokes)
OP_AUDIO = 0x09           # 9: Remote Audio & Media Session Control
OP_VIEWPORT_RESIZE = 0x0A # 10: Viewport Bounds Negotiation
OP_LLM_STREAM = 0x0B      # 11: Local LLM Chunk Stream
OP_FILE_TRANSFER = 0x0C   # 12: Chunked Zero-Trust File Transfer
OP_DISPLAY_ENUM = 0x0D    # 13: Multi-Monitor Display Enumeration & Switching
OP_FRAME_SYNC = 0xED      # 237: Keyframe / Stream Resynchronization Request
OP_ERR = 0xEE             # 238: Structured Error Packet

# Explicit environment secret override (optional, never hardcoded)
_env_secret_raw = os.environ.get("AI_AGENT_SECRET") or os.environ.get("CST_AGENT_SECRET") or ""
SHARED_SECRET = _env_secret_raw.strip().encode("utf-8")

# High-risk command keywords requiring Human-In-The-Loop confirmation
CRITICAL_COMMAND_PATTERNS = {
    "rmdir", "del /f", "format", "diskpart", "shutdown", "reboot",
    "stop-service", "drop table", "mkfs", "dd if=", "chmod 777",
    "rm -rf", "taskkill", "stop-process", "remove-item"
}

# Windows SendInput & Desktop Lock ctypes bindings (defined once at module level)
_WIN_USER32_LOCK_BOUND = False
if platform.system() == "Windows":
    class _WIN_KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", wintypes.WORD),
            ("wScan", wintypes.WORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ctypes.c_size_t),
        ]

    class _WIN_MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ("dx", wintypes.LONG),
            ("dy", wintypes.LONG),
            ("mouseData", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ctypes.c_size_t),
        ]

    class _WIN_INPUT_UNION(ctypes.Union):
        _fields_ = [("ki", _WIN_KEYBDINPUT), ("mi", _WIN_MOUSEINPUT)]

    class _WIN_INPUT(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("u", _WIN_INPUT_UNION)]


# =====================================================================
# WINDOWS KERNEL JOB OBJECT SUPERVISOR (RESOURCE CONTAINMENT)
# =====================================================================
class WindowsJobSupervisor:
    """
    Manages a single Windows Kernel Job Object for the entire agent process tree.
    Enforces a strict 256MB hard RAM limit and KILL_ON_JOB_CLOSE behavior.
    Guarantees kernel handles are closed immediately to prevent handle leaks.
    """
    def __init__(self, memory_limit_mb: int = 256):
        self._lock = threading.RLock()
        self.memory_limit_mb = int(memory_limit_mb)
        self.is_windows = platform.system() == "Windows"
        self.job_handle = None
        self.kernel32 = None
        self._init_job_object()

    def _init_job_object(self) -> None:
        if not self.is_windows:
            return
        memory_limit_mb = self.memory_limit_mb
        try:
            self.kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
            self.kernel32.CreateJobObjectW.restype = wintypes.HANDLE
            self.kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
            self.kernel32.OpenProcess.restype = wintypes.HANDLE
            self.kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            self.kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
            self.kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
            self.kernel32.CloseHandle.restype = wintypes.BOOL
            self.kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            self.kernel32.SetInformationJobObject.restype = wintypes.BOOL
            self.kernel32.SetInformationJobObject.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD]
            self.kernel32.TerminateJobObject.restype = wintypes.BOOL
            self.kernel32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]

            # Create a single persistent job object for this agent
            self.job_handle = self.kernel32.CreateJobObjectW(None, f"AI_Sandbox_Job_{os.getpid()}")
            if not self.job_handle:
                logger.warning("Failed to create Windows Job Object")
                return

            # JOBOBJECT_EXTENDED_LIMIT_INFORMATION setup
            # 0x2000 = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            # 0x0200 = JOB_OBJECT_LIMIT_JOB_MEMORY
            # 0x0100 = JOB_OBJECT_LIMIT_PROCESS_MEMORY
            job_object_limit_kill_on_job_close = 0x2000
            job_object_limit_job_memory = 0x0200
            job_object_limit_process_memory = 0x0100

            class IoCounters(ctypes.Structure):
                _fields_ = [
                    ('ReadOperationCount', ctypes.c_uint64),
                    ('WriteOperationCount', ctypes.c_uint64),
                    ('OtherOperationCount', ctypes.c_uint64),
                    ('ReadTransferCount', ctypes.c_uint64),
                    ('WriteTransferCount', ctypes.c_uint64),
                    ('OtherTransferCount', ctypes.c_uint64),
                ]

            class JobObjectBasicLimitInformation(ctypes.Structure):
                _fields_ = [
                    ('PerProcessUserTimeLimit', ctypes.c_int64),
                    ('PerJobUserTimeLimit', ctypes.c_int64),
                    ('LimitFlags', wintypes.DWORD),
                    ('MinimumWorkingSetSize', ctypes.c_size_t),
                    ('MaximumWorkingSetSize', ctypes.c_size_t),
                    ('ActiveProcessLimit', wintypes.DWORD),
                    ('Affinity', ctypes.c_size_t),
                    ('PriorityClass', wintypes.DWORD),
                    ('SchedulingClass', wintypes.DWORD),
                ]

            class JobObjectExtendedLimitInformation(ctypes.Structure):
                _fields_ = [
                    ('BasicLimitInformation', JobObjectBasicLimitInformation),
                    ('IoInfo', IoCounters),
                    ('ProcessMemoryLimit', ctypes.c_size_t),
                    ('JobMemoryLimit', ctypes.c_size_t),
                    ('PeakProcessMemoryLimit', ctypes.c_size_t),
                    ('PeakJobMemoryLimit', ctypes.c_size_t),
                ]

            info = JobObjectExtendedLimitInformation()
            info.BasicLimitInformation.LimitFlags = (
                job_object_limit_kill_on_job_close | job_object_limit_job_memory | job_object_limit_process_memory
            )
            info.JobMemoryLimit = memory_limit_mb * 1024 * 1024  # Enforce hard job memory limit
            info.ProcessMemoryLimit = memory_limit_mb * 1024 * 1024  # Enforce hard process memory limit

            res = self.kernel32.SetInformationJobObject(
                self.job_handle,
                9,  # JobObjectExtendedLimitInformation
                ctypes.byref(info),
                ctypes.sizeof(info)
            )
            if res:
                logger.info(f"Windows Job Object initialized with {memory_limit_mb}MB RAM limit & KILL_ON_JOB_CLOSE")
            else:
                logger.warning("Could not set extended limit info on Job Object")
        except Exception as e:
            logger.warning(f"Windows Job Object configuration warning: {e}")

    def assign_process(self, pid: int) -> bool:
        """Assigns child process to sandbox Job Object and immediately closes process handle."""
        with self._lock:
            if not self.is_windows or not self.job_handle or not self.kernel32:
                return False

            proc_handle = None
            try:
                # PROCESS_SET_QUOTA (0x0100) | PROCESS_TERMINATE (0x0001)
                proc_handle = self.kernel32.OpenProcess(0x0101, False, pid)
                if proc_handle:
                    success = bool(self.kernel32.AssignProcessToJobObject(self.job_handle, proc_handle))
                    return success
            except Exception as e:
                logger.debug(f"Assign process {pid} error: {e}")
                return False
            finally:
                if proc_handle:
                    # Crucial: Close process handle immediately to prevent handle leaks
                    self.kernel32.CloseHandle(proc_handle)
            return False

    def reset(self):
        """Terminates active child processes inside Job Object and opens a fresh supervisor handle."""
        with self._lock:
            if not self.is_windows or not self.kernel32:
                return
            if self.job_handle:
                try:
                    self.kernel32.TerminateJobObject(self.job_handle, 1)
                except Exception as e:
                    logger.error("Error terminating job object: %s", e)
                self.close()
            self._init_job_object()

    def close(self):
        """Clean up the job object handle upon agent termination."""
        with self._lock:
            if self.job_handle and self.kernel32:
                try:
                    self.kernel32.CloseHandle(self.job_handle)
                    self.job_handle = None
                    logger.info("Windows Job Object handle closed cleanly.")
                except Exception as e:
                    logger.debug(f"Job Object close error: {e}")

# Global Job Object Supervisor instance
JOB_SUPERVISOR = WindowsJobSupervisor(memory_limit_mb=256)

# =====================================================================
# PROTOCOL SERIALIZATION UTILITIES
# =====================================================================
def pack_packet(opcode: int, payload: bytes, seq: int = 0, flags: int = 0) -> bytes:
    """Encapsulates payload in a rigid 12-byte header."""
    header = _HEADER_STRUCT.pack(MAGIC, opcode, flags, seq, len(payload))
    return header + payload

def unpack_packet(raw: bytes) -> Optional[Tuple[bytes, int, int, int, int, bytes]]:
    """Unpacks a raw 12-byte framed binary packet into (magic, opcode, flags, seq, length, payload)."""
    if len(raw) < HEADER_SIZE:
        return None
    magic, opcode, flags, seq, length = _HEADER_STRUCT.unpack_from(raw, 0)
    if magic != MAGIC or length > MAX_PAYLOAD_SIZE or len(raw) != HEADER_SIZE + length:
        return None
    payload = raw[HEADER_SIZE:HEADER_SIZE + length]
    return magic, opcode, flags, seq, length, payload

def parse_header(raw: bytes) -> Optional[Tuple[int, int, int, int]]:
    """Validates magic bytes and extracts opcode, flags, seq, and payload length."""
    if len(raw) < HEADER_SIZE:
        return None
    magic, opcode, flags, seq, length = _HEADER_STRUCT.unpack_from(raw, 0)
    if magic != MAGIC or length > MAX_PAYLOAD_SIZE:
        return None
    return opcode, flags, seq, length

# =====================================================================
# HIGH-EFFICIENCY SCREEN CAPTURE PIPELINE (TURBOJPEG + ADAPTIVE THROTTLING)
# =====================================================================
class AdaptiveScreenPipeline:
    """
    Zero-Jank desktop capture pipeline:
    - Adaptive FPS: 1-2 FPS during static screens (<1.5% CPU), surges to 60 FPS on motion.
    - Uses libjpeg-turbo (PyTurboJPEG) for sub-5ms hardware encoding.
    - Reusable pre-allocated memory buffers to avoid garbage collection spikes.
    - Thread-safe screen capture with clean resource disposal.
    """
    def __init__(self, target_resolution: Tuple[int, int] = (1280, 720)):
        if platform.system() == "Windows":
            try:
                u32 = ctypes.windll.user32
                fn = getattr(u32, "SetProcessDpiAwarenessContext", None)
                if fn is not None:
                    fn.argtypes = [ctypes.c_void_p]
                    fn.restype = ctypes.c_bool
                    fn(ctypes.c_void_p(-4))
                else:
                    u32.SetProcessDPIAware()
            except Exception:
                try:
                    ctypes.windll.user32.SetProcessDPIAware()
                except Exception:
                    pass
        self.target_res = target_resolution
        self.target_fps: int = 60
        self.last_frame_hash: Optional[int] = 0
        self._last_diff_sample: Optional[bytes] = None
        self._last_encoded_frame: Optional[bytes] = None
        self.grid_hashes: List[int] = []
        self.consecutive_static = 0
        self.jpeg_quality = 50
        self.monitor_index = 1
        self.force_keyframe = False
        self.last_capture_rect: Optional[Tuple[int, int, int, int]] = None
        self.last_stream_size: Optional[Tuple[int, int]] = None
        self._last_capture_err_log: float = 0.0
        self._consecutive_grab_errors: int = 0
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ScreenEncoder")
        self.is_running = True

        # Initialize TurboJPEG
        self.turbo = None
        if TurboJPEG:
            try:
                self.turbo = TurboJPEG()
                logger.info("Hardware TurboJPEG acceleration loaded successfully")
            except Exception as e:
                logger.info(f"TurboJPEG fallback to Pillow: {e}")

        # Thread-local storage for mss instances (mss is not thread-safe across threads)
        self._local = threading.local()
        self._worker_scts = []
        self._sct_lock = threading.Lock()
        self._resize_cache: Optional[Tuple[Tuple[int, int, int, int], Any]] = None

    def _get_mss(self):
        """Returns thread-local mss instance."""
        if not hasattr(self._local, 'sct') or self._local.sct is None:
            if mss:
                try:
                    self._local.sct = mss.MSS()
                    with self._sct_lock:
                        self._worker_scts.append(self._local.sct)
                except Exception as exc:
                    logger.debug("MSS initialization failed in worker: %s", exc)
                    self._local.sct = None
            else:
                self._local.sct = None
        return self._local.sct

    def _reset_local_mss(self) -> None:
        """Closes and clears the thread-local mss instance so the next grab self-heals."""
        sct = getattr(self._local, 'sct', None)
        self._local.sct = None
        if sct is not None:
            with self._sct_lock:
                self._worker_scts = [s for s in self._worker_scts if s is not sct]
            try:
                sct.close()
            except Exception:
                pass

    def set_target_resolution(self, width: int, height: int):
        """Dynamically adjusts target capture resolution matching mobile viewport (VIEWPORT_RESIZE)."""
        w = max(320, min(3840, width))
        h = max(240, min(2160, height))
        self.target_res = (w, h)
        self.last_stream_size = None
        self._last_encoded_frame = None
        self.force_keyframe = True
        logger.info(f"Screen grabber resolution dynamically matched to {w}x{h}")

    def set_quality(self, quality: int):
        """Clamps and updates JPEG stream compression quality (15..95)."""
        self.jpeg_quality = max(15, min(95, int(quality)))
        self._last_encoded_frame = None
        self.force_keyframe = True

    def set_target_fps(self, fps: int) -> None:
        """Clamps and updates target stream capture rate (5..60 FPS)."""
        try:
            clamped = max(5, min(60, int(fps)))
        except (TypeError, ValueError):
            return
        self.target_fps = clamped

    def _encode_jpeg_pillow(self, img: Any) -> bytes:
        buf = getattr(self._local, 'bio_buf', None)
        if buf is None:
            buf = io.BytesIO()
            self._local.bio_buf = buf
        else:
            buf.seek(0)
            buf.truncate(0)
        img.save(buf, format="JPEG", quality=self.jpeg_quality, optimize=False, subsampling=2)
        return buf.getvalue()

    def _grab_and_compress(self) -> Tuple[Optional[bytes], bool]:
        """Worker function running inside ThreadPoolExecutor."""
        sct = self._get_mss()
        if not sct or not getattr(sct, "monitors", None):
            return None, False

        force_send = self.force_keyframe
        try:
            idx = self.monitor_index if 1 <= self.monitor_index < len(sct.monitors) else (1 if len(sct.monitors) > 1 else 0)
            monitor = sct.monitors[idx]
            raw_shot = sct.grab(monitor)
            self._consecutive_grab_errors = 0

            w_shot, h_shot = int(raw_shot.width), int(raw_shot.height)
            self.last_capture_rect = (
                int(monitor.get("left", 0)),
                int(monitor.get("top", 0)),
                w_shot,
                h_shot,
            )

            if self.last_frame_hash is None:
                self._last_diff_sample = None

            if force_send:
                self.force_keyframe = False
                self.consecutive_static = 0

            # Fast 2D strided multi-channel frame delta detector (covers all 4 BGRA bytes across full viewport)
            img32 = None
            if np is not None:
                img32 = np.frombuffer(raw_shot.bgra, dtype=np.uint32).reshape((h_shot, w_shot))
                sample_bytes = img32[::8, ::16].tobytes()
                current_hash = zlib.adler32(sample_bytes)
                frame_unchanged = (
                    (not force_send)
                    and (self._last_diff_sample is not None)
                    and (sample_bytes == self._last_diff_sample)
                )
                self._last_diff_sample = sample_bytes
                self.last_frame_hash = current_hash
            else:
                raw_mv = memoryview(raw_shot.raw)
                current_hash = zlib.adler32(raw_mv[::257].tobytes())
                is_static = (not force_send) and (self.last_frame_hash is not None) and (current_hash == self.last_frame_hash)
                self.last_frame_hash = current_hash

                grid_rows, grid_cols = 8, 8
                block_h, block_w = max(1, h_shot // grid_rows), max(1, w_shot // grid_cols)
                new_grid = []
                row_fractions = (block_h // 4, block_h // 2, (block_h * 3) // 4)
                for r in range(grid_rows):
                    span = block_w * 4
                    for c in range(grid_cols):
                        cell_crc = 0
                        for r_off in row_fractions:
                            sample_offset = ((r * block_h + r_off) * w_shot + c * block_w) * 4
                            cell_crc = zlib.crc32(raw_mv[sample_offset:sample_offset + span], cell_crc)
                        new_grid.append(cell_crc)

                grid_changed_count = sum(1 for o, n in zip(self.grid_hashes, new_grid) if o != n) if self.grid_hashes else 64
                self.grid_hashes = new_grid
                frame_unchanged = (not force_send) and is_static and (grid_changed_count == 0)

            # Encode one settling frame on consecutive_static == 0, then short-circuit idle frames
            if frame_unchanged and self.consecutive_static >= 1:
                return None, True

            # Dynamic aspect-preserving downsampling (never upscale beyond native capture size)
            if w_shot > self.target_res[0] or h_shot > self.target_res[1]:
                scale = min(1.0, self.target_res[0] / max(1, w_shot), self.target_res[1] / max(1, h_shot))
                out_w = max(1, int(round(w_shot * scale)))
                out_h = max(1, int(round(h_shot * scale)))
                if out_w < w_shot or out_h < h_shot:
                    self.last_stream_size = (out_w, out_h)
                    if self.turbo is not None and np is not None and img32 is not None:
                        cache_key = (w_shot, h_shot, out_w, out_h)
                        cached = self._resize_cache
                        if cached is not None and cached[0] == cache_key and isinstance(cached[1], tuple):
                            yi_col, xi = cached[1]
                        else:
                            yi_col = ((np.arange(out_h, dtype=np.intp) * h_shot) // out_h)[:, None]
                            xi = (np.arange(out_w, dtype=np.intp) * w_shot) // out_w
                            self._resize_cache = (cache_key, (yi_col, xi))
                        sub_bgra = img32[yi_col, xi].view(np.uint8).reshape((out_h, out_w, 4))
                        scaled_rgb = np.ascontiguousarray(sub_bgra[:, :, 2::-1])
                        try:
                            encoded = self.turbo.encode(
                                scaled_rgb,
                                quality=self.jpeg_quality,
                                pixel_format=TJPF_RGB,
                                jpeg_subsample=TJSAMP_420,
                                flags=TJFLAG_FASTDCT,
                            )
                            self._last_encoded_frame = encoded
                            return encoded, frame_unchanged
                        except Exception as tj_err:
                            logger.debug(f"TurboJPEG resized encode fallback to Pillow: {tj_err}")
                    if Image is not None:
                        img = Image.frombuffer("RGB", raw_shot.size, raw_shot.bgra, "raw", "BGRX", 0, 1)
                        resample = (
                            Image.Resampling.BILINEAR
                            if (force_send or frame_unchanged)
                            else Image.Resampling.NEAREST
                        )
                        img = img.resize((out_w, out_h), resample)
                        encoded = self._encode_jpeg_pillow(img)
                        self._last_encoded_frame = encoded
                        return encoded, frame_unchanged

            self.last_stream_size = (w_shot, h_shot)

            # Zero-copy encode for 1:1 desktop resolution via libjpeg-turbo SIMD
            if self.turbo:
                try:
                    if np is not None:
                        bgra_arr = np.frombuffer(raw_shot.raw, dtype=np.uint8).reshape((h_shot, w_shot, 4))
                        encoded = self.turbo.encode(
                            bgra_arr,
                            quality=self.jpeg_quality,
                            pixel_format=TJPF_BGRX,
                            jpeg_subsample=TJSAMP_420,
                            flags=TJFLAG_FASTDCT,
                        )
                        self._last_encoded_frame = encoded
                        return encoded, frame_unchanged
                except Exception as tj_err:
                    logger.debug(f"TurboJPEG encode fallback to Pillow: {tj_err}")
            if Image is not None:
                img = Image.frombuffer("RGB", raw_shot.size, raw_shot.bgra, "raw", "BGRX", 0, 1)
                encoded = self._encode_jpeg_pillow(img)
                self._last_encoded_frame = encoded
                return encoded, frame_unchanged
            return None, False
        except Exception as e:
            self._consecutive_grab_errors += 1
            if force_send:
                self.force_keyframe = True
            self._reset_local_mss()
            now_mono = time.monotonic()
            if (now_mono - self._last_capture_err_log) >= 15.0:
                self._last_capture_err_log = now_mono
                logger.warning(f"Screen capture failed (self-healing MSS handle): {e}")
            return None, False

    async def get_next_frame(self) -> Optional[bytes]:
        """Asynchronously dispatches frame grabbing to worker thread."""
        if not self.is_running:
            return None
        loop = asyncio.get_running_loop()
        res, is_static = await loop.run_in_executor(self.executor, self._grab_and_compress)

        if is_static:
            self.consecutive_static += 1
        else:
            self.consecutive_static = 0

        return res

    def close(self):
        """Shuts down executor and releases thread-local resources cleanly (idempotent)."""
        if not self.is_running and not self._worker_scts:
            return
        self.is_running = False
        # Wait for in-flight grab tasks to finish before closing mss handles
        self.executor.shutdown(wait=True, cancel_futures=True)
        try:
            with self._sct_lock:
                for sct in self._worker_scts:
                    try:
                        sct.close()
                    except Exception:
                        pass
                self._worker_scts.clear()
        except Exception:
            pass
        logger.info("Screen grabber pipeline shut down cleanly.")

# =====================================================================
# AST SECURITY VALIDATOR FOR COMMAND EXECUTION
# =====================================================================
class AstCommandInspector:
    """Performs token analysis on shell commands to enforce HITL policies."""
    @staticmethod
    def inspect(cmd: str) -> Tuple[bool, str]:
        """Returns (is_dangerous, reason)."""
        if not isinstance(cmd, str):
            return True, "Command payload must be a string"

        normalized = cmd.strip()
        if not normalized:
            return True, "Empty command submitted for execution"

        if CommandASTFirewall is not None:
            is_allowed, risk, _, reason = CommandASTFirewall.inspect_and_sanitize(normalized)
            if not is_allowed or risk in ("BLOCKED", "REQUIRES_BIOMETRIC"):
                return True, reason

        lower_cmd = normalized.lower()
        for pattern in CRITICAL_COMMAND_PATTERNS:
            if pattern in lower_cmd:
                return True, f"Command contains restricted administrative token: '{pattern}'"

        # Normalize quoting/escaping variants that often bypass simple substring checks.
        collapsed = lower_cmd.replace("^", "").replace("'", "").replace('"', "")
        if any(hazard in collapsed for hazard in [";", "&&", "||", "| rm", "> /dev", "taskkill", "shutdown", "format", "remove-item", "stop-process", "cmd /c", "powershell -command", "rm -rf"]):
            return True, "Command contains restricted chaining or pipeline tokens"

        exact_hazards = {"taskkill", "shutdown", "format", "rm", "del", "rmdir", "remove-item", "stop-process", "reboot", "poweroff", "mkfs", "diskpart"}
        try:
            tokens = shlex.split(normalized, posix=(platform.system() != "Windows"))
            for t in tokens:
                token = os.path.basename(t.lower().strip().replace('"', '').replace("'", ""))
                base_token = token.split(".")[0]
                if token in exact_hazards or base_token in exact_hazards:
                    return True, f"Dangerous command in execution chain: '{t}'"
        except ValueError:
            return True, "Unbalanced quotation marks or invalid shell syntax"

        return False, "Command passed security policy"

# =====================================================================
# MAIN AI NETCONTROLLER HOST AGENT DAEMON
# =====================================================================
class HostAgentDaemon:
    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        gui_state: Any = None,
        enable_tray: Optional[bool] = None,
        enable_mdns: Optional[bool] = None,
    ):
        self.config = load_config() if load_config else {}
        self.host = host or self.config.get("bind_host", "0.0.0.0")
        self.port = port or int(self.config.get("port", 8765))
        self.gui_state = gui_state
        self._hostname = socket.gethostname()
        self._os_name = platform.system()
        self.clients: Set[WebSocketServerProtocol] = set()
        self.authenticated_clients: Set[WebSocketServerProtocol] = set()
        self._client_vaults: Dict[WebSocketServerProtocol, Any] = {}
        self._client_secrets: Dict[WebSocketServerProtocol, bytes] = {}
        self._client_replay: Dict[WebSocketServerProtocol, Any] = {}
        self._client_outbound_seq: Dict[WebSocketServerProtocol, int] = {}
        self._ws_write_locks: Dict[WebSocketServerProtocol, asyncio.Lock] = {}
        self._pending_pairings: Dict[WebSocketServerProtocol, Tuple[bytearray, bytes, bytes, bytes, float]] = {}
        self._clients_need_keyframe: Set[WebSocketServerProtocol] = set()
        self._clients_explicit_sync: Set[WebSocketServerProtocol] = set()
        self._client_auth_ts: Dict[WebSocketServerProtocol, float] = {}
        self._client_frame_inflight: Set[WebSocketServerProtocol] = set()
        self._pair_init_attempts: Dict[str, List[float]] = {}
        self._ollama_sem: Optional[asyncio.Semaphore] = None
        self._lock_check_cache: Tuple[float, bool] = (0.0, False)
        self._stream_wake_event: Optional[asyncio.Event] = None
        self._background_tasks: List[asyncio.Task] = []
        self._background_task_set: Set[asyncio.Task] = set()
        self._owns_loop: bool = False
        self._start_time: float = time.time()
        self._last_policy_refresh_ts: float = 0.0
        self._pin_fail_by_ip: Dict[str, Tuple[int, float]] = {}
        self._pin_fail_count_storage: int = 0
        self._pin_lockout_until_storage: float = 0.0
        self._initial_env_secret: str = (
            os.environ.get("AI_AGENT_SECRET") or os.environ.get("CST_AGENT_SECRET") or ""
        ).strip()
        self._secret_rotated: bool = False
        self._last_cfg_mtime: float = self._safe_cfg_mtime()
        self._last_cfg_rev: int = int(get_config_revision())
        self._last_cfg_stat_ts: float = 0.0
        self._local_ip_cache: Tuple[float, str] = (0.0, "")
        self._disk_pct_cache: Tuple[float, float] = (0.0, 0.0)
        self.tls_fingerprint: str = ""

        # Persistent credentials & policies (CSPRNG only, never hardcoded fallbacks)
        self.pairing_pin: str = str(self.config.get("pairing_pin") or f"{secrets.randbelow(900000) + 100000}")
        self.pairing_token: str = str(self.config.get("pairing_token") or f"ainet_{secrets.token_hex(24)}")
        self.pin_issued_at: float = float(self.config.get("pin_issued_at") or time.time())
        self.view_only_mode: bool = bool(self.config.get("view_only_mode", False))
        self.require_hitl_approval: bool = bool(self.config.get("require_hitl_approval", True))
        self.clipboard_sync_allowed: bool = bool(self.config.get("clipboard_sync_allowed", True))
        self.file_transfer_enabled: bool = bool(self.config.get("file_transfer_enabled", True))
        self.audio_control_enabled: bool = bool(self.config.get("audio_control_enabled", True))
        self.ollama_bridge_enabled: bool = bool(self.config.get("ollama_bridge_enabled", True))
        self.auto_lock_on_disconnect: bool = bool(self.config.get("auto_lock_on_disconnect", False))
        self.auto_ban_intrusion: bool = bool(self.config.get("auto_ban_intrusion", True))
        self.subnet_geofence_only: bool = bool(self.config.get("subnet_geofence_only", True))
        self.require_hmac_auth: bool = bool(self.config.get("require_hmac_auth", False))
        self.require_aead: bool = bool(self.config.get("require_aead", False))
        self.require_tls: bool = bool(self.config.get("require_tls", False))
        self.allowed_origins: Set[str] = {
            str(o).strip().lower() for o in (self.config.get("allowed_origins") or []) if str(o).strip()
        }
        self.security_profile: str = str(self.config.get("security_profile", "balanced"))
        self.target_fps: int = max(5, min(60, int(self.config.get("target_fps", 60) or 60)))
        self.is_paused: bool = bool(self.config.get("paused", False))
        self.blacklisted_ips: Set[str] = self._extract_blacklisted_ips(self.config.get("blacklisted_devices"))
        self._stream_paused_clients: Set[WebSocketServerProtocol] = set()
        if self.gui_state is not None:
            self._sync_gui_state_on_attach()

        # Per-connection nonce tracking: ws -> (nonce_bytes, timestamp)
        self.active_nonces: Dict[WebSocketServerProtocol, Tuple[bytes, float]] = {}
        self.screen_pipeline = AdaptiveScreenPipeline()
        self.screen_pipeline.set_target_fps(self.target_fps)
        self.multi_monitor = MultiMonitorStreamer() if MultiMonitorStreamer else None
        self.zeroconf: Optional[AsyncZeroconf] = None
        self.service_info: Optional[ServiceInfo] = None
        self.server = None
        self.is_running = True
        self.capture_fps: float = 0.0
        self.pending_approvals: Dict[str, Dict[str, Any]] = {}
        self.tray_icon = None
        self._tray_lock = threading.Lock()
        self._tray_stop_event = threading.Event()
        self._tray_thread: Optional[threading.Thread] = None
        if enable_tray is None:
            self._enable_tray = (
                os.environ.get("AI_DISABLE_TRAY") != "1"
                and bool(self.config.get("enable_tray_icon", True))
                and _has_desktop_display()
            )
        else:
            self._enable_tray = bool(enable_tray)
        if enable_mdns is None:
            self._enable_mdns = (
                os.environ.get("AI_DISABLE_MDNS") != "1"
                and bool(self.config.get("mdns_enabled", True))
            )
        else:
            self._enable_mdns = bool(enable_mdns)
        self.file_writer = HostFileWriter() if HostFileWriter else None
        chaos_enabled = os.environ.get("AI_CHAOS_MODE", os.environ.get("CST_CHAOS_MODE", "0")) == "1"
        self.chaos_shield = NetworkFuzzerShield(ChaosProfile(enabled=chaos_enabled)) if NetworkFuzzerShield else None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self._loop_thread_id: Optional[int] = None
        self._failed_auth_attempts: Dict[str, List[float]] = {}

    @staticmethod
    def _extract_blacklisted_ips(raw_list: Any) -> Set[str]:
        ips: Set[str] = set()
        if not isinstance(raw_list, list):
            return ips
        for item in raw_list:
            if isinstance(item, str) and item.strip():
                ips.add(item.strip())
            elif isinstance(item, dict):
                ip_val = str(item.get("ip", "")).strip()
                if ip_val:
                    ips.add(ip_val)
        return ips

    def _wake_stream(self) -> None:
        """Signals the screen stream loop immediately after input or viewport activity."""
        self.screen_pipeline.consecutive_static = 0
        ev = self._stream_wake_event
        if ev is not None and self.loop is not None and self.loop.is_running():
            if threading.get_ident() == self._loop_thread_id:
                ev.set()
            else:
                self.loop.call_soon_threadsafe(ev.set)

    @property
    def _pin_fail_count(self) -> int:
        return self._pin_fail_count_storage

    @_pin_fail_count.setter
    def _pin_fail_count(self, val: int) -> None:
        self._pin_fail_count_storage = int(val)
        if val <= 0:
            self._pin_fail_by_ip.clear()

    @property
    def _pin_lockout_until(self) -> float:
        return self._pin_lockout_until_storage

    @_pin_lockout_until.setter
    def _pin_lockout_until(self, val: float) -> None:
        self._pin_lockout_until_storage = float(val)
        if val <= 0.0:
            self._pin_fail_by_ip.clear()

    def _is_pin_locked_out(self, client_ip: str, now_ts: float) -> bool:
        _, lockout_until = self._pin_fail_by_ip.get(client_ip, (0, 0.0))
        return now_ts < lockout_until

    def _record_pin_failure(self, client_ip: str, now_ts: float) -> Tuple[int, float]:
        cnt, until = self._pin_fail_by_ip.get(client_ip, (0, 0.0))
        if now_ts >= until and cnt >= 5:
            cnt = 0
        cnt += 1
        if cnt >= 5:
            until = now_ts + 60.0
            logger.warning("PAIR PIN rate-limit lockout triggered for %s (60s)", client_ip)
        self._pin_fail_by_ip[client_ip] = (cnt, until)
        if len(self._pin_fail_by_ip) > 1024:
            self._pin_fail_by_ip.pop(next(iter(self._pin_fail_by_ip)), None)
        self._pin_fail_count_storage = cnt
        self._pin_lockout_until_storage = until
        return cnt, until

    def _reset_pin_failures(self, client_ip: str) -> None:
        self._pin_fail_by_ip.pop(client_ip, None)
        self._pin_fail_count_storage = 0
        self._pin_lockout_until_storage = 0.0

    def _next_outbound_seq(self, ws: WebSocketServerProtocol) -> int:
        """Allocates a strictly monotonic 32-bit sequence number (>= 1) per client connection."""
        nxt = ((self._client_outbound_seq.get(ws, 0) + 1) & 0xFFFFFFFF) or 1
        if ws in self.clients or ws in self._ws_write_locks:
            self._client_outbound_seq[ws] = nxt
        return nxt

    def _safe_cfg_mtime(self) -> float:
        try:
            path = get_config_path() if callable(get_config_path) else ""
            return float(os.path.getmtime(path)) if path and os.path.isfile(path) else 0.0
        except Exception:
            return 0.0

    def _track_task(self, coro: Any) -> asyncio.Task:
        """Schedules an async background task and cleans up / logs errors safely."""
        task = asyncio.create_task(coro)
        self._background_task_set.add(task)

        def _on_done(t: asyncio.Task) -> None:
            self._background_task_set.discard(t)
            if t.cancelled():
                return
            exc = t.exception()
            if exc is not None:
                logger.error("Unhandled background task exception: %s", exc)

        task.add_done_callback(_on_done)
        return task

    def _sync_gui_state_on_attach(self) -> None:
        if self.gui_state is None:
            return
        self.gui_state.pairing_pin = self.pairing_pin
        self.gui_state.pairing_token = self.pairing_token
        self.gui_state.view_only_mode = self.view_only_mode
        self.gui_state.require_hitl_approval = self.require_hitl_approval
        self.gui_state.clipboard_sync_allowed = self.clipboard_sync_allowed
        self.gui_state.auto_lock_on_disconnect = self.auto_lock_on_disconnect
        self.gui_state.auto_ban_intrusion = self.auto_ban_intrusion
        self.gui_state.subnet_geofence_only = self.subnet_geofence_only

    def _refresh_runtime_policies(self, force_disk: bool = False) -> None:
        """Synchronizes live policy toggles and credentials from gui_state or persisted config (TTL cached)."""
        now_mono = time.monotonic()
        curr_rev = int(get_config_revision()) if callable(get_config_revision) else 0
        need_disk = force_disk or (curr_rev != self._last_cfg_rev)
        if not need_disk and (now_mono - self._last_cfg_stat_ts) >= 1.0:
            self._last_cfg_stat_ts = now_mono
            cfg_mtime = self._safe_cfg_mtime()
            if cfg_mtime > self._last_cfg_mtime:
                self._last_cfg_mtime = cfg_mtime
                need_disk = True

        if need_disk and callable(load_config):
            self._last_cfg_rev = curr_rev
            self._last_cfg_stat_ts = now_mono
            self._last_cfg_mtime = self._safe_cfg_mtime()
            try:
                cfg = load_config() or {}
                if isinstance(cfg, dict):
                    disk_tok = str(cfg.get("pairing_token") or "").strip()
                    disk_pin = str(cfg.get("pairing_pin") or "").strip()
                    if disk_tok and disk_tok != self.pairing_token:
                        self.pairing_token = disk_tok
                        self._secret_rotated = True
                    if disk_pin and disk_pin != self.pairing_pin:
                        self.pairing_pin = disk_pin
                        self.pin_issued_at = float(cfg.get("pin_issued_at") or time.time())
                    self.view_only_mode = bool(cfg.get("view_only_mode", self.view_only_mode))
                    if "paused" in cfg:
                        self.is_paused = bool(cfg.get("paused", self.is_paused))
                    self.require_hitl_approval = bool(cfg.get("require_hitl_approval", self.require_hitl_approval))
                    self.clipboard_sync_allowed = bool(cfg.get("clipboard_sync_allowed", self.clipboard_sync_allowed))
                    self.file_transfer_enabled = bool(cfg.get("file_transfer_enabled", self.file_transfer_enabled))
                    self.audio_control_enabled = bool(cfg.get("audio_control_enabled", self.audio_control_enabled))
                    self.ollama_bridge_enabled = bool(cfg.get("ollama_bridge_enabled", self.ollama_bridge_enabled))
                    self.auto_lock_on_disconnect = bool(cfg.get("auto_lock_on_disconnect", self.auto_lock_on_disconnect))
                    self.auto_ban_intrusion = bool(cfg.get("auto_ban_intrusion", self.auto_ban_intrusion))
                    self.subnet_geofence_only = bool(cfg.get("subnet_geofence_only", self.subnet_geofence_only))
                    self.require_hmac_auth = bool(cfg.get("require_hmac_auth", self.require_hmac_auth))
                    self.require_aead = bool(cfg.get("require_aead", self.require_aead))
                    self.require_tls = bool(cfg.get("require_tls", self.require_tls))
                    self.security_profile = str(cfg.get("security_profile", self.security_profile))
                    raw_fps = cfg.get("target_fps")
                    if isinstance(raw_fps, int) and not isinstance(raw_fps, bool) and 5 <= raw_fps <= 60:
                        self.target_fps = raw_fps
                        self.screen_pipeline.set_target_fps(raw_fps)
                    if isinstance(cfg.get("allowed_origins"), list):
                        self.allowed_origins = {str(o).strip().lower() for o in cfg["allowed_origins"] if str(o).strip()}
                    if "blacklisted_devices" in cfg:
                        self.blacklisted_ips = self._extract_blacklisted_ips(cfg.get("blacklisted_devices"))
                    # Propagate external disk updates (e.g. Web Console changes) into attached GUI state
                    # so stale in-memory GUI fields do not immediately revert disk updates below.
                    if self.gui_state is not None and not getattr(self.gui_state, "_saving_config", False):
                        with self.gui_state.lock:
                            self.gui_state.pairing_token = self.pairing_token
                            self.gui_state.pairing_pin = self.pairing_pin
                            self.gui_state.pin_issued_at = int(self.pin_issued_at)
                            self.gui_state.view_only_mode = self.view_only_mode
                            self.gui_state.is_paused = self.is_paused
                            self.gui_state.require_hitl_approval = self.require_hitl_approval
                            self.gui_state.clipboard_sync_allowed = self.clipboard_sync_allowed
                            self.gui_state.file_transfer_enabled = self.file_transfer_enabled
                            self.gui_state.audio_control_enabled = self.audio_control_enabled
                            self.gui_state.ollama_bridge_enabled = self.ollama_bridge_enabled
                            self.gui_state.auto_lock_on_disconnect = self.auto_lock_on_disconnect
                            self.gui_state.auto_ban_intrusion = self.auto_ban_intrusion
                            self.gui_state.subnet_geofence_only = self.subnet_geofence_only
                            self.gui_state.require_hmac_auth = self.require_hmac_auth
                            self.gui_state.require_aead = self.require_aead
                            self.gui_state.require_tls = self.require_tls
                            self.gui_state.security_profile = self.security_profile
            except Exception:
                pass
        if self.gui_state is not None:
            gui_tok = getattr(self.gui_state, "pairing_token", None)
            gui_pin = getattr(self.gui_state, "pairing_pin", None)
            if gui_tok and str(gui_tok).strip() != self.pairing_token:
                self.pairing_token = str(gui_tok).strip()
                self._secret_rotated = True
            if gui_pin and str(gui_pin).strip() != self.pairing_pin:
                self.pairing_pin = str(gui_pin).strip()
                self.pin_issued_at = time.time()
            self.view_only_mode = bool(getattr(self.gui_state, "view_only_mode", self.view_only_mode))
            self.require_hitl_approval = bool(getattr(self.gui_state, "require_hitl_approval", self.require_hitl_approval))
            self.clipboard_sync_allowed = bool(getattr(self.gui_state, "clipboard_sync_allowed", self.clipboard_sync_allowed))
            self.file_transfer_enabled = bool(getattr(self.gui_state, "file_transfer_enabled", self.file_transfer_enabled))
            self.audio_control_enabled = bool(getattr(self.gui_state, "audio_control_enabled", self.audio_control_enabled))
            self.ollama_bridge_enabled = bool(getattr(self.gui_state, "ollama_bridge_enabled", self.ollama_bridge_enabled))
            self.auto_lock_on_disconnect = bool(getattr(self.gui_state, "auto_lock_on_disconnect", self.auto_lock_on_disconnect))
            self.auto_ban_intrusion = bool(getattr(self.gui_state, "auto_ban_intrusion", self.auto_ban_intrusion))
            self.subnet_geofence_only = bool(getattr(self.gui_state, "subnet_geofence_only", self.subnet_geofence_only))
            self.require_hmac_auth = bool(getattr(self.gui_state, "require_hmac_auth", self.require_hmac_auth))
            self.require_aead = bool(getattr(self.gui_state, "require_aead", self.require_aead))
            self.security_profile = str(getattr(self.gui_state, "security_profile", self.security_profile))
            self.is_paused = bool(getattr(self.gui_state, "is_paused", False))
            gui_bl = getattr(self.gui_state, "blacklisted_devices", None)
            if gui_bl:
                with self.gui_state.lock:
                    bl_copy = list(gui_bl)
                self.blacklisted_ips.update(self._extract_blacklisted_ips(bl_copy))
            unbanned = getattr(self.gui_state, "_unbanned_ips", None)
            if unbanned:
                with self.gui_state.lock:
                    to_unban = list(unbanned)
                    unbanned.clear()
                for uip in to_unban:
                    self.blacklisted_ips.discard(uip)
                    self._failed_auth_attempts.pop(uip, None)
                    self._pin_fail_by_ip.pop(uip, None)
            if hasattr(self.gui_state, "tls_fingerprint"):
                self.gui_state.tls_fingerprint = self.tls_fingerprint
            if hasattr(self.gui_state, "tls_enabled"):
                self.gui_state.tls_enabled = bool(self.tls_fingerprint)

    def _refresh_runtime_policies_throttled(self, min_interval: float = 0.25) -> None:
        """Rate-limited policy sync for high-frequency packet receive loops."""
        now_mono = time.monotonic()
        if (now_mono - self._last_policy_refresh_ts) >= min_interval:
            self._last_policy_refresh_ts = now_mono
            self._refresh_runtime_policies()

    def _aead_required(self) -> bool:
        """Returns True when host policy mandates an established ChaCha20-Poly1305 AEAD vault."""
        return bool(self.require_aead or self.security_profile in ("strict", "zero_trust"))

    def _is_client_ready_for_stream(self, ws: WebSocketServerProtocol) -> bool:
        """Returns False while a vault handshake is in progress or when AEAD is required but absent."""
        if ws in self._stream_paused_clients:
            return False
        vault = self._client_vaults.get(ws)
        if vault is not None and not vault.is_established:
            return False
        if self._aead_required() and (vault is None or not vault.is_established):
            return False
        return True

    def _is_client_blacklisted(self, client_ip: str) -> bool:
        if client_ip in self.blacklisted_ips:
            return True
        if self.gui_state is not None and hasattr(self.gui_state, "is_ip_blacklisted"):
            return bool(self.gui_state.is_ip_blacklisted(client_ip))
        return False

    def _get_ws_write_lock(self, ws: WebSocketServerProtocol) -> asyncio.Lock:
        """Returns per-socket write lock without leaking disconnected sockets into the map."""
        lock = self._ws_write_locks.get(ws)
        if lock is not None:
            return lock
        lock = asyncio.Lock()
        if ws in self.clients:
            self._ws_write_locks[ws] = lock
        return lock

    async def _ws_send(self, ws: WebSocketServerProtocol, data: Any) -> None:
        """Serializes concurrent writes onto a WebSocket transport cleanly."""
        async with self._get_ws_write_lock(ws):
            await ws.send(data)

    def force_disconnect_client(self, client_id_or_ip: str):
        """Forcefully disconnects active client socket by id or IP in real time."""
        def _close_matching():
            for ws in list(self.clients):
                peer = getattr(ws, "remote_address", None)
                peer_ip = peer[0] if peer else ""
                peer_port = str(peer[1]) if peer and len(peer) > 1 else ""
                cid = f"{peer_ip}:{peer_port}"
                if client_id_or_ip in (cid, peer_ip, f"{peer_ip}:*"):
                    try:
                        asyncio.create_task(ws.close(code=1008, reason="Disconnected by host operator"))
                    except Exception:
                        pass
        if self.loop and self.loop.is_running():
            self.loop.call_soon_threadsafe(_close_matching)
        else:
            _close_matching()

    def _record_auth_failure(self, client_ip: str, client_id: str):
        """Records authentication failure, enforcing headless & GUI auto-ban thresholds."""
        self._refresh_runtime_policies()
        now = time.time()
        failures = [t for t in self._failed_auth_attempts.get(client_ip, []) if now - t < 60.0]
        failures.append(now)
        self._failed_auth_attempts[client_ip] = failures
        if len(self._failed_auth_attempts) > 1024:
            oldest_ip = next(iter(self._failed_auth_attempts))
            self._failed_auth_attempts.pop(oldest_ip, None)

        if self.gui_state is not None:
            self.gui_state.add_log("ALERT", f"Failed authentication attempt from {client_id}")

        if len(failures) >= 3 and self.auto_ban_intrusion:
            self.blacklisted_ips.add(client_ip)
            logger.warning("AUTO-BAN TRIGGERED: Blacklisted %s due to 3+ failed auth attempts.", client_ip)
            if self.gui_state is not None and hasattr(self.gui_state, "blacklist_client"):
                try:
                    self.gui_state.blacklist_client(
                        client_id_or_ip=client_ip,
                        device_name=f"Intruder ({client_ip})",
                        reason="Auto-banned after 3 failed auth attempts",
                    )
                    return
                except Exception as exc:
                    logger.debug("GUI state auto-ban sync error for %s: %s", client_ip, exc)
            try:
                cfg = load_config() if load_config else {}
                bl = list(cfg.get("blacklisted_devices") or [])
                already_present = any(
                    (isinstance(x, str) and x.strip() == client_ip)
                    or (isinstance(x, dict) and str(x.get("ip", "")).strip() == client_ip)
                    for x in bl
                )
                if not already_present:
                    bl.append(client_ip)
                    cfg["blacklisted_devices"] = bl
                    if save_config:
                        save_config(cfg)
            except Exception as exc:
                logger.debug("Could not persist auto-ban for %s: %s", client_ip, exc)

    def _get_current_secret(self) -> bytes:
        """Returns configured persistent/env strong token (respecting rotation)."""
        self._refresh_runtime_policies()
        env_sec = (os.environ.get("AI_AGENT_SECRET") or os.environ.get("CST_AGENT_SECRET") or "").strip()
        if env_sec and (not self._secret_rotated or env_sec != self._initial_env_secret):
            return env_sec.encode("utf-8")
        return str(self.pairing_token).strip().encode("utf-8")

    def _get_valid_secrets(self) -> List[bytes]:
        """Returns active strong secrets for HMAC and token auth (excludes weak 6-digit PINs)."""
        self._refresh_runtime_policies()
        secrets_list: List[bytes] = []
        env_sec = (os.environ.get("AI_AGENT_SECRET") or os.environ.get("CST_AGENT_SECRET") or "").strip()
        if env_sec and (not self._secret_rotated or env_sec != self._initial_env_secret):
            secrets_list.append(env_sec.encode("utf-8"))
        if self.pairing_token:
            tok_b = str(self.pairing_token).strip().encode("utf-8")
            if tok_b and tok_b not in secrets_list:
                secrets_list.append(tok_b)
        if self.gui_state is not None:
            tok = getattr(self.gui_state, "pairing_token", None)
            if tok:
                tok_b = str(tok).strip().encode("utf-8")
                if tok_b and tok_b not in secrets_list:
                    secrets_list.append(tok_b)
        return secrets_list

    def _is_valid_pairing_pin(self, candidate: bytes) -> bool:
        """Verifies short-lived 6-digit pairing PIN for explicit PAIR onboarding only."""
        self._refresh_runtime_policies()
        if not self.pairing_pin:
            return False
        if (time.time() - self.pin_issued_at) > PIN_TTL_SECONDS:
            return False
        pin_b = str(self.pairing_pin).strip().encode("utf-8")
        return bool(pin_b) and hmac.compare_digest(candidate, pin_b)

    async def start(self):
        """Bootstraps TLS context, mDNS advertisement, system tray icon, and WebSocket server."""
        self.loop = asyncio.get_running_loop()
        self._loop_thread_id = threading.get_ident()
        self._stream_wake_event = asyncio.Event()
        logger.info("Initializing AI NetController Host Agent & OS Bridge (v0.80.0)...")

        # Initialize TLS BEFORE mDNS so TXT records accurately advertise tls=1 and full SHA-256 fp
        ssl_ctx = None
        cert_file = os.environ.get("AI_TLS_CERT") or os.environ.get("SSL_CERT_FILE")
        key_file = os.environ.get("AI_TLS_KEY") or os.environ.get("SSL_KEY_FILE")
        auto_tls = self.require_tls or (os.environ.get("AI_TLS_AUTO") == "1")
        if cert_file and key_file and os.path.isfile(cert_file) and os.path.isfile(key_file):
            import ssl
            ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ssl_ctx.minimum_version = ssl.TLSVersion.TLSv1_2
            ssl_ctx.options |= getattr(ssl, "OP_NO_COMPRESSION", 0)
            ssl_ctx.options |= getattr(ssl, "OP_CIPHER_SERVER_PREFERENCE", 0)
            ssl_ctx.load_cert_chain(cert_file, key_file)
            fp = compute_cert_fingerprint(cert_file) if callable(compute_cert_fingerprint) else ""
            if fp:
                self.tls_fingerprint = fp
                if self.gui_state is not None:
                    self.gui_state.tls_fingerprint = fp
                    self.gui_state.tls_enabled = True
            logger.info("TLS enabled for WebSocket transport (%s, fp=%s...)", cert_file, fp[:16] if fp else "n/a")
        elif auto_tls and build_server_ssl_context is not None:
            try:
                ssl_ctx, fp = build_server_ssl_context()
                self.tls_fingerprint = fp
                if self.gui_state is not None:
                    self.gui_state.tls_fingerprint = fp
                    self.gui_state.tls_enabled = True
                logger.info("Auto-generated ECDSA SAN TLS context active (fp=%s...)", fp[:16])
            except Exception as tls_err:
                if self.require_tls:
                    raise RuntimeError(f"require_tls=True but TLS initialization failed: {tls_err}") from tls_err
                logger.warning("Failed to initialize auto-TLS context, falling back cleanly: %s", tls_err)
        elif self.require_tls and ssl_ctx is None:
            raise RuntimeError("require_tls=True but TLS manager is unavailable; refusing plaintext ws:// downgrade.")

        proto = "wss" if ssl_ctx else "ws"
        if websockets is not None:
            self.server = await websockets.serve(
                self.handle_connection,
                self.host,
                self.port,
                ssl=ssl_ctx,
                compression=None,
                max_size=MAX_WIRE_FRAME_SIZE,
                ping_interval=20,
                ping_timeout=15
            )
            logger.info(f"Binary WebSocket Listener active on {proto}://{self.host}:{self.port}")
        else:
            self.server = await asyncio.start_server(
                self._handle_stdlib_ws_client,
                self.host,
                self.port,
                ssl=ssl_ctx,
            )
            logger.info(f"Stdlib RFC-6455 WebSocket Listener active on {proto}://{self.host}:{self.port}")

        await self._start_mdns()
        self._start_system_tray()

        self._background_tasks.append(asyncio.create_task(self._telemetry_heartbeat_loop()))
        self._background_tasks.append(asyncio.create_task(self._screen_stream_loop()))

    @staticmethod
    def _is_origin_allowed(origin_header: Optional[str]) -> bool:
        """Validates WebSocket Origin header to prevent cross-site WebSocket hijacking (CSWSH)."""
        if not origin_header:
            return True  # Native Android/Python WS clients do not send browser Origin
        try:
            from urllib.parse import urlparse
            parsed = urlparse(origin_header)
            scheme = (parsed.scheme or "").lower()
            if scheme in ("capacitor", "app", "file", "ionic", "tauri"):
                return True
            if scheme not in ("http", "https"):
                return False
            hn = (parsed.hostname or "").lower()
            env_allow = {x.strip().lower() for x in os.environ.get("AI_ALLOWED_ORIGINS", "").split(",") if x.strip()}
            if env_allow and (origin_header.strip().lower() in env_allow or hn in env_allow):
                return True
            if hn in ("localhost", "127.0.0.1", "::1") or hn.endswith(".local"):
                return True
            if is_local_or_private_ip(hn):
                port = parsed.port or (443 if scheme == "https" else 80)
                return port in (80, 443, 3000, 3001, 4173, 5173, 8080, 8443, 8765)
            return False
        except Exception:
            return False

    async def _handle_stdlib_ws_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """Zero-dependency RFC 6455 WebSocket fallback with Origin check, control frames, and write lock."""
        try:
            key = None
            origin_hdr = None
            header_lines = 0
            header_bytes = 0
            while True:
                line = await asyncio.wait_for(reader.readline(), timeout=5.0)
                if not line or line == b'\r\n':
                    break
                header_lines += 1
                header_bytes += len(line)
                if header_lines > 64 or header_bytes > 16384:
                    writer.write(b"HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n")
                    await writer.drain()
                    writer.close()
                    return
                line_str = line.decode('utf-8', errors='ignore')
                lower = line_str.lower()
                if lower.startswith('sec-websocket-key:'):
                    key = line_str.split(':', 1)[1].strip()
                elif lower.startswith('origin:'):
                    origin_hdr = line_str.split(':', 1)[1].strip()
            if origin_hdr:
                origin_low = origin_hdr.strip().lower()
                if origin_low not in self.allowed_origins and not self._is_origin_allowed(origin_hdr):
                    writer.write(b"HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
                    await writer.drain()
                    writer.close()
                    return
            if not key:
                writer.write(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
                await writer.drain()
                writer.close()
                return
            accept_val = base64.b64encode(
                hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode('utf-8')).digest()
            ).decode('ascii')
            resp = (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept_val}\r\n\r\n"
            )
            writer.write(resp.encode('utf-8'))
            await writer.drain()

            peer = writer.get_extra_info('peername') or ('127.0.0.1', 0)

            class _StdlibWsAdapter:
                def __init__(self):
                    self.remote_address = peer
                    self.request_headers = {"Origin": origin_hdr} if origin_hdr else {}
                    self._closed = False
                    self._write_lock = asyncio.Lock()

                async def _send_raw_frame(self, first_byte: int, payload: bytes):
                    async with self._write_lock:
                        if self._closed:
                            return
                        frame = bytearray([first_byte])
                        plen = len(payload)
                        if plen < 126:
                            frame.append(plen)
                        elif plen <= 0xFFFF:
                            frame.append(126)
                            frame.extend(struct.pack("!H", plen))
                        else:
                            frame.append(127)
                            frame.extend(struct.pack("!Q", plen))
                        frame.extend(payload)
                        writer.write(frame)
                        await writer.drain()

                async def send(self, data):
                    is_bin = isinstance(data, (bytes, bytearray))
                    payload = bytes(data) if is_bin else str(data).encode('utf-8')
                    await self._send_raw_frame(0x82 if is_bin else 0x81, payload)

                async def close(self, code: int = 1000, reason: str = ""):
                    if not self._closed:
                        try:
                            close_body = struct.pack("!H", code) + reason.encode("utf-8")[:120]
                            await self._send_raw_frame(0x88, close_body)
                        except Exception:
                            pass
                    self._closed = True
                    try:
                        writer.close()
                        await writer.wait_closed()
                    except Exception:
                        pass

                def __aiter__(self):
                    return self

                async def __anext__(self):
                    frag_opcode: Optional[int] = None
                    frag_buf = bytearray()
                    while not self._closed:
                        try:
                            head = await reader.readexactly(2)
                            b1, b2 = head[0], head[1]
                            is_fin = (b1 & 0x80) != 0
                            opcode = b1 & 0x0F
                            is_masked = (b2 & 0x80) != 0
                            length = b2 & 0x7F
                            if length == 126:
                                length = struct.unpack("!H", await reader.readexactly(2))[0]
                            elif length == 127:
                                length = struct.unpack("!Q", await reader.readexactly(8))[0]
                            if length > MAX_WIRE_FRAME_SIZE:
                                await self.close(code=1009, reason="Message too big")
                                raise StopAsyncIteration
                            if opcode >= 0x08 and (length > 125 or not is_fin):
                                await self.close(code=1002, reason="Invalid control frame")
                                raise StopAsyncIteration
                            mask_key = await reader.readexactly(4) if is_masked else b""
                            raw_payload = await reader.readexactly(length)
                            if is_masked and length > 0:
                                repeated_mask = (mask_key * ((length // 4) + 1))[:length]
                                raw_payload = (
                                    int.from_bytes(raw_payload, "little")
                                    ^ int.from_bytes(repeated_mask, "little")
                                ).to_bytes(length, "little")
                            if opcode == 0x08:  # CLOSE
                                raise StopAsyncIteration
                            if opcode == 0x09:  # PING -> PONG
                                await self._send_raw_frame(0x8A, raw_payload)
                                continue
                            if opcode == 0x0A:  # PONG -> ignore
                                continue
                            if opcode == 0x00:  # Continuation frame
                                if frag_opcode is None or len(frag_buf) + len(raw_payload) > MAX_WIRE_FRAME_SIZE:
                                    await self.close(code=1009 if frag_opcode is not None else 1002, reason="Invalid continuation frame")
                                    raise StopAsyncIteration
                                frag_buf.extend(raw_payload)
                                if not is_fin:
                                    continue
                                full_payload = bytes(frag_buf)
                                res_opcode = frag_opcode
                                frag_opcode = None
                                frag_buf.clear()
                                if res_opcode == 0x01:
                                    return full_payload.decode('utf-8', errors='replace')
                                return full_payload
                            if not is_fin:
                                frag_opcode = opcode
                                frag_buf.clear()
                                frag_buf.extend(raw_payload)
                                continue
                            if opcode == 0x01:
                                return raw_payload.decode('utf-8', errors='replace')
                            return raw_payload
                        except StopAsyncIteration:
                            raise
                        except Exception:
                            raise StopAsyncIteration
                    raise StopAsyncIteration

            adapter = _StdlibWsAdapter()
            await self.handle_connection(adapter)
        except Exception:
            pass
        finally:
            try:
                if not writer.is_closing():
                    writer.close()
            except Exception:
                pass

    async def _start_mdns(self):
        """Registers mDNS service RFC 6762 (_cst-agent._tcp.local)."""
        if not self._enable_mdns or not AsyncZeroconf:
            if not AsyncZeroconf:
                logger.warning("Zeroconf not installed, skipping mDNS broadcast")
            return
        zc = None
        try:
            zc = AsyncZeroconf(ip_version=IPVersion.V4Only)
            self.zeroconf = zc
            local_ip = self._get_local_ip()
            hostname = socket.gethostname()

            desc = {
                'os': platform.system(),
                'version': '0.80.0',
                'ai': 'ollama-bridge',
                'hostname': hostname,
                'tls': '1' if self.tls_fingerprint else '0',
                'fp': self.tls_fingerprint if self.tls_fingerprint else '',
            }
            info = ServiceInfo(
                "_cst-agent._tcp.local.",
                f"{hostname}._cst-agent._tcp.local.",
                addresses=[socket.inet_aton(local_ip)],
                port=self.port,
                properties=desc,
                server=f"{hostname}.local."
            )
            self.service_info = info
            await asyncio.wait_for(zc.async_register_service(info), timeout=3.0)
            if not self.is_running:
                await self._close_zeroconf_async()
                return
            logger.info(f"mDNS Registered: {hostname}._cst-agent._tcp.local at {local_ip}:{self.port}")
        except Exception as e:
            logger.warning(f"mDNS Registration error: {e}")
            if self.zeroconf is not None:
                await self._close_zeroconf_async()

    def _get_local_ip(self) -> str:
        """Determines primary non-loopback LAN IPv4 passively with 30s TTL cache (no external 8.8.8.8 probe)."""
        now_mono = time.monotonic()
        cached_ts, cached_ip = self._local_ip_cache
        if cached_ip and (now_mono - cached_ts) < 30.0:
            return cached_ip
        resolved = "127.0.0.1"
        try:
            if psutil is not None:
                stats = psutil.net_if_stats()
                addrs = psutil.net_if_addrs()
                preferred: List[str] = []
                secondary: List[str] = []
                for if_name, if_addrs in addrs.items():
                    if if_name in stats and not stats[if_name].isup:
                        continue
                    lname = if_name.lower()
                    is_virtual = any(tok in lname for tok in ("loopback", "vethernet", "wsl", "hyper-v", "docker", "vmware", "virtualbox"))
                    for addr in if_addrs:
                        if addr.family == socket.AF_INET and addr.address:
                            ip = addr.address
                            if ip.startswith("127.") or ip.startswith("169.254.") or ip == "0.0.0.0":
                                continue
                            if not is_virtual:
                                preferred.append(ip)
                            else:
                                secondary.append(ip)
                if preferred:
                    resolved = preferred[0]
                elif secondary:
                    resolved = secondary[0]
        except Exception:
            pass
        if resolved == "127.0.0.1":
            try:
                for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                    ip = info[4][0]
                    if ip and not ip.startswith("127.") and not ip.startswith("169.254."):
                        resolved = ip
                        break
            except Exception:
                pass
        self._local_ip_cache = (now_mono, resolved)
        return resolved

    def _start_system_tray(self):
        """Initializes high-visibility background Windows system tray icon with rich controls."""
        if not self._enable_tray or not pystray or not Image:
            return
        if not self.is_running or self._tray_stop_event.is_set():
            return

        def run_tray():
            img = get_icon_image(64)
            if not img:
                img = Image.new('RGBA', (64, 64), (4, 8, 18, 255))
                from PIL import ImageDraw
                draw = ImageDraw.Draw(img)
                draw.ellipse([4, 4, 60, 60], outline=(0, 240, 255, 255), width=3)
                draw.ellipse([16, 16, 48, 48], fill=(10, 22, 40, 255), outline=(138, 43, 226, 255), width=2)
                draw.ellipse([26, 26, 38, 38], fill=(0, 255, 157, 255))

            def _show_gui():
                if self.gui_state and hasattr(self.gui_state, "request_show_window"):
                    self.gui_state.request_show_window()

            def _install():
                if self.gui_state and hasattr(self.gui_state, "request_install"):
                    self.gui_state.request_install()
                elif show_install_dialog:
                    show_install_dialog()

            def _toggle_view_only():
                self.view_only_mode = not self.view_only_mode
                if self.gui_state:
                    self.gui_state.view_only_mode = self.view_only_mode
                    state_txt = "ENABLED (Remote Input Locked)" if self.view_only_mode else "DISABLED (Remote Input Allowed)"
                    self.gui_state.add_log("SECURITY", f"View-Only Mode from System Tray: {state_txt}")
                try:
                    cfg = load_config() if load_config else {}
                    cfg["view_only_mode"] = self.view_only_mode
                    if save_config:
                        save_config(cfg)
                except Exception:
                    pass

            def _toggle_pause():
                self.is_paused = not self.is_paused
                if self.gui_state:
                    self.gui_state.is_paused = self.is_paused
                    status = "PAUSED" if self.is_paused else "RESUMED"
                    self.gui_state.add_log("WARN" if self.is_paused else "INFO", f"Daemon {status} from System Tray.")

            def _toggle_autostart_tray():
                curr = bool(get_windows_autostart_enabled()) if callable(get_windows_autostart_enabled) else False
                nxt = not curr
                if callable(set_windows_autostart):
                    set_windows_autostart(nxt)
                if self.gui_state:
                    self.gui_state.autostart_on_boot = nxt
                    self.gui_state.save_policy_config()
                    self.gui_state.add_log("SYSTEM", f"Run on Windows Startup {'ENABLED' if nxt else 'DISABLED'} via System Tray.")

            def _add_desktop_shortcut():
                if create_desktop_shortcut:
                    _, msg1 = create_desktop_shortcut()
                    if create_start_menu_shortcut:
                        create_start_menu_shortcut()
                    if self.gui_state:
                        self.gui_state.add_log("SUCCESS", f"Desktop shortcut created: {msg1}")

            def _uninstall():
                if self.gui_state and hasattr(self.gui_state, "request_uninstall"):
                    self.gui_state.request_uninstall()
                elif show_uninstall_dialog:
                    show_uninstall_dialog(on_exit=self.stop)
                elif perform_full_uninstall:
                    perform_full_uninstall(interactive=False, on_complete=self.stop)

            def _exit_agent():
                if self.gui_state and hasattr(self.gui_state, "request_full_exit"):
                    self.gui_state.request_full_exit()
                self.stop()

            menu = pystray.Menu(
                pystray.MenuItem("Open Control Center", _show_gui, default=True),
                pystray.MenuItem("Install / Customize PC Features...", _install),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("AI NetController Beta 0.80.00", lambda: None, enabled=False),
                pystray.MenuItem(lambda text: f"Active Clients: {len(self.authenticated_clients)}", lambda: None, enabled=False),
                pystray.MenuItem(lambda text: f"Port: {self.port} (WebSocket)", lambda: None, enabled=False),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem(lambda text: "Resume Daemon" if self.is_paused else "Pause Daemon", _toggle_pause),
                pystray.MenuItem(lambda text: "Allow Remote Input" if self.view_only_mode else "Lock Input (View-Only)", _toggle_view_only),
                pystray.MenuItem(
                    lambda text: "Disable Run on Windows Startup"
                    if (callable(get_windows_autostart_enabled) and get_windows_autostart_enabled())
                    else "Enable Run on Windows Startup",
                    _toggle_autostart_tray,
                ),
                pystray.MenuItem("Panic: Disconnect All", lambda: self.kill_all_tasks()),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Add Desktop Shortcut", _add_desktop_shortcut),
                pystray.MenuItem("Uninstall AI NetController...", _uninstall),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Exit & Shut Down", _exit_agent)
            )
            with self._tray_lock:
                if not self.is_running or self._tray_stop_event.is_set():
                    return
                icon = pystray.Icon(
                    "AI_NetController_Agent",
                    img,
                    f"AI NetController — Port: {self.port} (Online)",
                    menu
                )
                self.tray_icon = icon
            try:
                if hasattr(icon, "notify"):
                    icon.notify(
                        "AI NetController Host Agent is active and listening for remote connections.",
                        "AI NetController"
                    )
            except Exception:
                pass
            if not self.is_running or self._tray_stop_event.is_set():
                try:
                    icon.stop()
                except Exception:
                    pass
                return

            icon.run()

        tray_thread = threading.Thread(target=run_tray, daemon=True, name="TrayThread")
        with self._tray_lock:
            if not self.is_running or self._tray_stop_event.is_set():
                return
            self._tray_thread = tray_thread
        tray_thread.start()

    def kill_all_tasks(self):
        """Emergency Panic Switch: Terminates all active child processes, approvals, vaults, and sockets."""
        logger.warning("PANIC TRIGGERED: Aborting all active tasks, approvals, and client sessions.")

        def _panic_abort_async():
            for _, entry in list(self.pending_approvals.items()):
                fut = entry.get("future") if isinstance(entry, dict) else entry
                if fut and not fut.done():
                    fut.set_result(False)
            self.pending_approvals.clear()

            for ws in list(self.clients):
                try:
                    self._track_task(ws.close(code=1008, reason="Emergency panic disconnect"))
                except Exception:
                    pass
            self.authenticated_clients.clear()
            self._clients_need_keyframe.clear()
            self._clients_explicit_sync.clear()
            self._client_auth_ts.clear()
            self._client_frame_inflight.clear()
            for v in self._client_vaults.values():
                try:
                    v.close()
                except Exception:
                    pass
            self._client_vaults.clear()
            for pending in self._pending_pairings.values():
                if scrub_memory is not None and isinstance(pending[0], bytearray):
                    scrub_memory(pending[0])
            self._pending_pairings.clear()
            if self.gui_state is not None:
                with self.gui_state.lock:
                    self.gui_state.connected_clients.clear()
                self.gui_state.add_log("ALERT", "Emergency PANIC triggered: disconnected all sessions & terminated subprocesses.")

        if self.loop and self.loop.is_running() and threading.get_ident() != self._loop_thread_id:
            self.loop.call_soon_threadsafe(_panic_abort_async)
        else:
            _panic_abort_async()

        if platform.system() == "Windows":
            JOB_SUPERVISOR.reset()

    def _is_client_input_allowed(self, ws: WebSocketServerProtocol) -> bool:
        """Checks global view-only policy and per-client inputAllowed lock."""
        self._refresh_runtime_policies()
        if self.view_only_mode:
            return False
        if self.gui_state is not None:
            peer = getattr(ws, "remote_address", None)
            p_ip = peer[0] if peer else ""
            p_port = str(peer[1]) if peer and len(peer) > 1 else ""
            cid = f"{p_ip}:{p_port}"
            with self.gui_state.lock:
                client_entry = next(
                    (c for c in self.gui_state.connected_clients if c.get("id") == cid),
                    None,
                )
                if client_entry is None and not p_port:
                    client_entry = next(
                        (c for c in self.gui_state.connected_clients if c.get("ip") == p_ip),
                        None,
                    )
                if client_entry and not client_entry.get("inputAllowed", True):
                    return False
        return True

    def _register_authenticated_client(self, ws: WebSocketServerProtocol, client_ip: str, resolved_client_id: str, label: str) -> None:
        self.authenticated_clients.add(ws)
        self._clients_need_keyframe.add(ws)
        self._client_auth_ts[ws] = time.monotonic()
        self.active_nonces.pop(ws, None)
        if SlidingWindowReplayProtector is not None:
            self._client_replay[ws] = SlidingWindowReplayProtector(128)
        if self.chaos_shield:
            self.chaos_shield.transition_state(resolved_client_id, ConnectionState.AUTHENTICATED_STREAMING)
        if self.gui_state is not None:
            with self.gui_state.lock:
                if not any(c.get("id") == resolved_client_id for c in self.gui_state.connected_clients):
                    self.gui_state.connected_clients.append({
                        "id": resolved_client_id,
                        "ip": client_ip,
                        "mac": "N/A",
                        "device": label,
                        "connectedAt": time.strftime("%H:%M:%S"),
                        "latencyMs": 1,
                        "isTrusted": True,
                        "inputAllowed": True,
                    })

    # =================================================================
    # CLIENT CONNECTION LIFECYCLE
    # =================================================================
    async def handle_connection(self, ws: WebSocketServerProtocol, path: str = ""):
        """Manages lifecycle of connected Mobile or Web clients with zero-trust gates."""
        self._refresh_runtime_policies()
        client_ip = ws.remote_address[0] if ws.remote_address else "unknown"
        client_port = ws.remote_address[1] if ws.remote_address and len(ws.remote_address) > 1 else id(ws)
        client_id = f"{client_ip}:{client_port}"

        req_headers = getattr(ws, "request_headers", None)
        if req_headers is None and getattr(ws, "request", None) is not None:
            req_headers = getattr(ws.request, "headers", None)
        origin = req_headers.get("Origin") if req_headers else None
        if origin:
            origin_low = origin.strip().lower()
            if origin_low not in self.allowed_origins and not self._is_origin_allowed(origin):
                logger.warning("Rejected untrusted WebSocket Origin '%s' from %s", origin, client_id)
                await ws.close(code=1008, reason="WebSocket Origin not permitted")
                return

        if self.is_paused:
            await ws.close(code=1013, reason="Daemon is paused by host operator")
            return
        if self._is_client_blacklisted(client_ip):
            logger.warning("Rejected connection from blacklisted IP: %s", client_ip)
            await ws.close(code=1008, reason="IP address is blacklisted")
            return
        if self.subnet_geofence_only and not is_local_or_private_ip(client_ip):
            logger.warning("Rejected non-local IP %s by Subnet Geofencing.", client_ip)
            await ws.close(code=1008, reason="Subnet geofence policy violation")
            return
        if len(self.clients) >= MAX_CONCURRENT_CLIENTS:
            logger.warning("Rejected connection from %s: max concurrent clients (%d) reached.", client_id, MAX_CONCURRENT_CLIENTS)
            await ws.close(code=1013, reason="Server busy: max concurrent clients reached")
            return
        per_ip_count = sum(
            1 for existing_ws in self.clients
            if (getattr(existing_ws, "remote_address", None) or (None,))[0] == client_ip
        )
        if per_ip_count >= MAX_CONNECTIONS_PER_IP:
            logger.warning("Rejected connection from %s: per-IP limit (%d) reached.", client_id, MAX_CONNECTIONS_PER_IP)
            await ws.close(code=1013, reason="Too many connections from this IP")
            return

        try:
            self.clients.add(ws)
            self._ws_write_locks[ws] = asyncio.Lock()
            logger.info("Client connected from %s", client_id)

            if self.chaos_shield:
                self.chaos_shield.register_client(client_id, lambda: self._track_task(ws.close(code=1008)))
                self.chaos_shield.transition_state(client_id, ConnectionState.AUTH_PENDING)

            nonce = secrets.token_bytes(16)
            self.active_nonces[ws] = (nonce, time.time())
            await self._ws_send(ws, pack_packet(OP_AUTH, nonce, seq=0))

            async for message in ws:
                self._refresh_runtime_policies()
                if self.is_paused:
                    await self._send_error(ws, "Daemon paused by host operator")
                    await ws.close(code=1013, reason="Daemon is paused by host operator")
                    break
                if self._is_client_blacklisted(client_ip):
                    await self._send_error(ws, "IP address is blacklisted")
                    await ws.close(code=1008, reason="IP address is blacklisted")
                    break

                if not isinstance(message, bytes):
                    active_vault = self._client_vaults.get(ws)
                    if active_vault is not None and active_vault.is_established:
                        await self._send_error(ws, "Encrypted AEAD transport (flag 0x02) required after vault handshake")
                        continue
                    try:
                        text_data = json.loads(message)
                        if not isinstance(text_data, dict):
                            await self._send_error(ws, "JSON control frames must be JSON objects")
                            continue
                        action = str(text_data.get("action") or text_data.get("event") or "").upper()
                        if action == "PING":
                            await self._ws_send(ws, json.dumps({
                                "event": "PONG",
                                "action": "PONG",
                                "timestamp": time.time(),
                                "seq": text_data.get("seq", 0)
                            }))
                            continue
                        elif action == "PAIR_INIT":
                            now_ts = time.time()
                            recent_inits = [
                                t for t in self._pair_init_attempts.get(client_ip, [])
                                if (now_ts - t) < 60.0
                            ]
                            if len(recent_inits) >= 15:
                                await self._ws_send(ws, json.dumps({
                                    "event": "ERROR",
                                    "error": "Too many PAIR_INIT requests; retry shortly",
                                    "code": 429,
                                }))
                                continue
                            recent_inits.append(now_ts)
                            self._pair_init_attempts[client_ip] = recent_inits
                            if len(self._pair_init_attempts) > 1024:
                                self._pair_init_attempts.pop(next(iter(self._pair_init_attempts)), None)
                            _x25519_gen = fast_x25519_generate_keypair or (FallbackCurve25519.generate_keypair if FallbackCurve25519 else None)
                            _x25519_dh = fast_x25519_shared_secret or (FallbackCurve25519.compute_shared_secret if FallbackCurve25519 else None)
                            _aead_dec = fast_chacha20_decrypt or (FallbackChaCha20Poly1305.decrypt if FallbackChaCha20Poly1305 else None)
                            if _x25519_gen is None or _x25519_dh is None or _aead_dec is None or hkdf_extract_and_expand is None:
                                await self._ws_send(ws, json.dumps({
                                    "event": "ERROR",
                                    "error": "Ephemeral encrypted pairing crypto unavailable",
                                    "code": 500,
                                }))
                                continue
                            now_ts = time.time()
                            if self._is_pin_locked_out(client_ip, now_ts):
                                await self._ws_send(ws, json.dumps({
                                    "event": "ERROR",
                                    "error": "Pairing PIN temporarily locked out due to failed attempts",
                                    "code": 429,
                                }))
                                await ws.close(code=1008, reason="Pairing locked out")
                                break
                            try:
                                cli_pub = base64.b64decode(str(text_data.get("client_pub") or ""), validate=True)
                                cli_n1 = base64.b64decode(str(text_data.get("client_nonce") or ""), validate=True)
                            except Exception:
                                cli_pub, cli_n1 = b"", b""
                            if len(cli_pub) != 32 or len(cli_n1) != 16:
                                await self._ws_send(ws, json.dumps({
                                    "event": "ERROR",
                                    "error": "Invalid PAIR_INIT key or nonce",
                                    "code": 400,
                                }))
                                continue
                            old_pending = self._pending_pairings.pop(ws, None)
                            if old_pending is not None and scrub_memory is not None and isinstance(old_pending[0], bytearray):
                                scrub_memory(old_pending[0])
                            srv_priv_raw, srv_pub = _x25519_gen()
                            srv_priv = bytearray(srv_priv_raw)
                            try:
                                srv_n2 = secrets.token_bytes(16)
                                shared = bytearray(
                                    _x25519_dh(bytes(srv_priv), cli_pub)
                                )
                                try:
                                    if bytes(shared) == (b"\x00" * 32):
                                        await self._ws_send(ws, json.dumps({
                                            "event": "ERROR",
                                            "error": "Invalid Curve25519 peer public key",
                                            "code": 400,
                                        }))
                                        continue
                                    pair_key = bytearray(
                                        hkdf_extract_and_expand(
                                            salt=cli_n1 + srv_n2,
                                            ikm=bytes(shared),
                                            info=b"CST_PAIR_WRAP_V1",
                                            length=32,
                                        )
                                    )
                                finally:
                                    if scrub_memory is not None:
                                        scrub_memory(shared)
                            finally:
                                if scrub_memory is not None:
                                    scrub_memory(srv_priv)
                            aad = b"CST_PAIR_V1" + cli_pub + srv_pub + cli_n1 + srv_n2
                            self._pending_pairings[ws] = (pair_key, aad, cli_n1, srv_n2, now_ts)
                            await self._ws_send(ws, json.dumps({
                                "event": "PAIR_CHALLENGE",
                                "host_pub": base64.b64encode(srv_pub).decode("ascii"),
                                "host_nonce": base64.b64encode(srv_n2).decode("ascii"),
                                "protocol": "CST-PAIR-X25519-V1",
                            }))
                            continue
                        elif action == "PAIR_FINISH":
                            pending = self._pending_pairings.pop(ws, None)
                            _aead_dec = fast_chacha20_decrypt or (FallbackChaCha20Poly1305.decrypt if FallbackChaCha20Poly1305 else None)
                            _aead_enc = fast_chacha20_encrypt or (FallbackChaCha20Poly1305.encrypt if FallbackChaCha20Poly1305 else None)
                            if pending is None or _aead_dec is None or _aead_enc is None:
                                await self._ws_send(ws, json.dumps({
                                    "event": "ERROR",
                                    "error": "No active PAIR_INIT challenge",
                                    "code": 400,
                                }))
                                continue
                            pair_key, aad, _cli_n1, _srv_n2, issued_ts = pending
                            try:
                                now_ts = time.time()
                                if now_ts - issued_ts > MAX_NONCE_AGE_SECONDS:
                                    await self._ws_send(ws, json.dumps({
                                        "event": "ERROR",
                                        "error": "Pairing challenge expired",
                                        "code": 401,
                                    }))
                                    await ws.close(code=1008, reason="Pairing expired")
                                    break
                                if self._is_pin_locked_out(client_ip, now_ts):
                                    self._record_auth_failure(client_ip, client_id)
                                    await self._ws_send(ws, json.dumps({
                                        "event": "ERROR",
                                        "error": "Invalid authentication token or expired PIN",
                                        "code": 401,
                                    }))
                                    await ws.close(code=1008, reason="Pairing locked out")
                                    break
                                try:
                                    raw_ct = base64.b64decode(str(text_data.get("ciphertext") or ""), validate=True)
                                except Exception:
                                    raw_ct = b""
                                if len(raw_ct) < 28 or raw_ct[:12] != (b"\x00" * 12):
                                    self._record_auth_failure(client_ip, client_id)
                                    await self._ws_send(ws, json.dumps({
                                        "event": "ERROR",
                                        "error": "Encrypted pairing verification failed",
                                        "code": 401,
                                    }))
                                    await ws.close(code=1008, reason="Authentication failed")
                                    break
                                try:
                                    pt = _aead_dec(
                                        bytes(pair_key), raw_ct[:12], raw_ct[12:], aad
                                    )
                                    if pt is None:
                                        raise ValueError("AEAD tag verification failed")
                                    inner = json.loads(pt.decode("utf-8"))
                                    if not isinstance(inner, dict):
                                        raise ValueError("PAIR_FINISH inner payload must be a JSON object")
                                except Exception:
                                    self._record_pin_failure(client_ip, now_ts)
                                    self._record_auth_failure(client_ip, client_id)
                                    await self._ws_send(ws, json.dumps({
                                        "event": "ERROR",
                                        "error": "Encrypted pairing verification failed",
                                        "code": 401,
                                    }))
                                    await ws.close(code=1008, reason="Authentication failed")
                                    break
                                candidate_pin = str(
                                    inner.get("pin") or inner.get("pair_pin") or ""
                                ).strip().encode("utf-8", errors="replace")
                                if self._is_valid_pairing_pin(candidate_pin):
                                    self._reset_pin_failures(client_ip)
                                    label = str(inner.get("device") or text_data.get("device") or f"Mobile Peer ({client_ip})")[:128]
                                    tok_bytes = str(self.pairing_token).strip().encode("utf-8")
                                    self._client_secrets[ws] = tok_bytes
                                    self._register_authenticated_client(ws, client_ip, client_id, label)
                                    if self.gui_state is not None:
                                        self.gui_state.add_log("SECURITY", f"Client {client_id} paired via encrypted X25519 PAIR_FINISH.")
                                    result_obj = {
                                        "event": "AUTHENTICATED",
                                        "status": "OK",
                                        "protocol": "AI-NET/3.0-SECURE",
                                        "pairingToken": self.pairing_token,
                                        "hostname": self._hostname,
                                        "os": platform.system(),
                                        "tlsFingerprint": self.tls_fingerprint,
                                        "timestamp": time.time(),
                                    }
                                    resp_nonce = struct.pack(">IQ", 0, 1)
                                    enc_res = resp_nonce + _aead_enc(
                                        bytes(pair_key),
                                        resp_nonce,
                                        json.dumps(result_obj).encode("utf-8"),
                                        aad,
                                    )
                                    await self._ws_send(ws, json.dumps({
                                        "event": "PAIR_RESULT",
                                        "status": "OK",
                                        "protocol": "CST-PAIR-X25519-V1",
                                        "ciphertext": base64.b64encode(enc_res).decode("ascii"),
                                    }))
                                    logger.info("Client %s authenticated via encrypted PAIR_FINISH.", client_id)
                                else:
                                    self._record_pin_failure(client_ip, now_ts)
                                    self._record_auth_failure(client_ip, client_id)
                                    await self._ws_send(ws, json.dumps({
                                        "event": "ERROR",
                                        "error": "Invalid authentication token or expired PIN",
                                        "code": 401,
                                    }))
                                    await ws.close(code=1008, reason="Authentication failed")
                                    break
                            finally:
                                if scrub_memory is not None and isinstance(pair_key, bytearray):
                                    scrub_memory(pair_key)
                            continue
                        elif action in ("AUTHENTICATE", "PAIR", "AUTH"):
                            if ws in self.authenticated_clients:
                                await self._ws_send(ws, json.dumps({
                                    "event": "AUTHENTICATED",
                                    "status": "OK",
                                    "protocol": "AI-NET/3.0-SECURE",
                                    "timestamp": time.time(),
                                }))
                                continue

                            candidate_raw = str(
                                text_data.get("token")
                                or text_data.get("pin")
                                or text_data.get("pair_pin")
                                or text_data.get("pair_token")
                                or text_data.get("secret")
                                or ""
                            ).strip()
                            candidate_token = candidate_raw.encode("utf-8", errors="replace")
                            candidate_hmac = str(text_data.get("hmac") or "").strip().lower()

                            now_ts = time.time()
                            valid_tokens = self._get_valid_secrets()
                            matched_token = None
                            if candidate_hmac:
                                nonce_info = self.active_nonces.get(ws)
                                if nonce_info and (now_ts - nonce_info[1]) <= MAX_NONCE_AGE_SECONDS:
                                    n_bytes = nonce_info[0]
                                    matched_token = next(
                                        (
                                            vt for vt in valid_tokens
                                            if hmac.compare_digest(
                                                candidate_hmac,
                                                hmac.new(vt, n_bytes, hashlib.sha256).hexdigest(),
                                            )
                                        ),
                                        None,
                                    )
                                    if matched_token is not None:
                                        self.active_nonces.pop(ws, None)
                            elif not self.require_hmac_auth:
                                matched_token = next(
                                    (vt for vt in valid_tokens if candidate_token and hmac.compare_digest(candidate_token, vt)),
                                    None,
                                )
                            token_ok = matched_token is not None

                            # Allow legacy cleartext 6-digit PAIR only when strict/AEAD policies are not enforcing PAIR_INIT
                            pin_ok = False
                            if action == "PAIR" and not token_ok:
                                if self._aead_required():
                                    await self._ws_send(ws, json.dumps({
                                        "event": "ERROR",
                                        "error": "Encrypted PAIR_INIT / PAIR_FINISH handshake required by host security policy",
                                        "code": 403,
                                    }))
                                    continue
                                if self._is_pin_locked_out(client_ip, now_ts):
                                    pin_ok = False
                                else:
                                    pin_ok = self._is_valid_pairing_pin(candidate_token)
                                    if pin_ok:
                                        self._reset_pin_failures(client_ip)
                                    else:
                                        self._record_pin_failure(client_ip, now_ts)

                            if token_ok or pin_ok:
                                label = str(text_data.get("device") or f"Remote Client ({client_ip})")[:128]
                                self._client_secrets[ws] = matched_token if matched_token is not None else str(self.pairing_token).strip().encode("utf-8")
                                self._register_authenticated_client(ws, client_ip, client_id, label)
                                if self.gui_state is not None:
                                    self.gui_state.add_log("SECURITY", f"Client {client_id} authenticated via JSON {action}.")
                                auth_ack = {
                                    "event": "AUTHENTICATED",
                                    "status": "OK",
                                    "protocol": "AI-NET/3.0-SECURE",
                                    "timestamp": time.time(),
                                }
                                # Provision long-lived pairingToken only during explicit initial PAIR exchange
                                if action == "PAIR" and pin_ok:
                                    auth_ack["pairingToken"] = self.pairing_token
                                await self._ws_send(ws, json.dumps(auth_ack))
                                logger.info("Client %s authenticated via JSON %s handshake.", client_id, action)
                            else:
                                logger.warning("JSON Authentication failed from %s", client_id)
                                self._record_auth_failure(client_ip, client_id)
                                await self._ws_send(ws, json.dumps({
                                    "event": "ERROR",
                                    "error": "Invalid authentication token or expired PIN",
                                    "code": 401
                                }))
                                await ws.close(code=1008, reason="Authentication failed")
                                break
                            continue
                        elif ws in self.authenticated_clients:
                            if self._aead_required():
                                await self._send_error(ws, "ChaCha20-Poly1305 ECDH vault handshake required by host security policy")
                                continue
                            if action == "EXECUTE_PROMPT":
                                cmd_str = str(text_data.get("prompt") or text_data.get("command") or "").strip()
                                cmd_id = str(text_data.get("command_id") or f"cmd-{int(time.time() * 1000)}")
                                if len(cmd_str.encode("utf-8", errors="replace")) > 8192:
                                    await self._ws_send(ws, json.dumps({
                                        "event": "ERROR",
                                        "error": "Command exceeds 8192 byte safety limit",
                                        "code": 413,
                                    }))
                                    continue
                                if cmd_str:
                                    self._track_task(self._process_json_shell_command(ws, cmd_str, cmd_id))
                                continue
                            elif action == "APPROVAL_RESPONSE":
                                await self._process_hitl_response(message.encode("utf-8"), ws)
                                continue
                            elif action in ("PANIC_KILL_ALL", "PANIC"):
                                if not self._is_client_input_allowed(ws):
                                    await self._send_error(ws, "Panic kill blocked while View-Only Mode or input lock is active")
                                    continue
                                await self._ws_send(ws, json.dumps({
                                    "event": "PANIC_ACK",
                                    "status": "terminated",
                                    "timestamp": time.time()
                                }))
                                self.kill_all_tasks()
                                continue
                            elif action == "DISCONNECT_CLIENT":
                                if not self._is_client_input_allowed(ws):
                                    await self._send_error(ws, "Disconnect action blocked while View-Only Mode or input lock is active")
                                    continue
                                target_cid = str(text_data.get("clientId") or text_data.get("ip") or "").strip()
                                if target_cid:
                                    self.force_disconnect_client(target_cid)
                                await self._ws_send(ws, json.dumps({
                                    "event": "DISCONNECT_ACK",
                                    "clientId": target_cid,
                                    "timestamp": time.time()
                                }))
                                continue
                            elif action in ("INPUT_EVENT", "PC_CONTROL"):
                                await self._process_virtual_input(message.encode('utf-8'), ws)
                                continue
                            elif action == "CLIPBOARD_SYNC":
                                clip_text = str(text_data.get("text") or "").encode('utf-8')
                                await self._process_clipboard(ws, clip_text)
                                continue
                    except Exception:
                        pass

                    await self._send_error(ws, "Binary protocol framing required (12-byte header)")
                    continue

                # Pass through Chaos Fuzzer Shield (state validation + keyframe sync + optional fault simulation)
                if self.chaos_shield:
                    pre_vault = self._client_vaults.get(ws)
                    allow_pre_decrypt_sync = not (pre_vault is not None and pre_vault.is_established)
                    filtered = await self.chaos_shield.filter_incoming_packet(
                        client_id,
                        message,
                        on_keyframe_request=(
                            (lambda _cid, _ws=ws: self._trigger_keyframe_resync(_ws))
                            if allow_pre_decrypt_sync
                            else None
                        ),
                    )
                    if filtered is None:
                        continue
                    message = filtered

                if len(message) < HEADER_SIZE:
                    continue

                parsed = parse_header(message)
                if not parsed:
                    continue

                opcode, flags, seq, length = parsed

                if length > MAX_PAYLOAD_SIZE or len(message) != HEADER_SIZE + length:
                    await self._send_error(ws, "Payload size exceeds limit or frame length mismatch")
                    continue

                payload = message[HEADER_SIZE:HEADER_SIZE + length]

                # Decrypt AEAD envelope if client established HostCryptoVault session (prevent downgrade)
                vault = self._client_vaults.get(ws)
                if vault is not None and vault.is_established:
                    if flags & 0x02:
                        aad = message[:HEADER_SIZE]
                        dec = vault.decrypt_frame(payload, aad=aad)
                        if dec is None:
                            await self._send_error(ws, "AEAD decryption or replay check failed")
                            continue
                        payload, _ = dec
                    else:
                        await self._send_error(ws, "Encrypted AEAD transport (flag 0x02) required after vault handshake")
                        continue

                # =====================================================
                # STRICT AUTHENTICATION FIREWALL
                # =====================================================
                if ws not in self.authenticated_clients:
                    if opcode == OP_AUTH:
                        await self._process_auth(ws, payload, client_id)
                    elif opcode == OP_PING:
                        await self._ws_send(ws, pack_packet(OP_PING, b'PONG', seq=seq))
                    else:
                        logger.warning("Unauthenticated attempt on opcode 0x%02X from %s. Dropping.", opcode, client_id)
                        await self._send_error(ws, "Authentication required. Complete OP_AUTH handshake first.")
                        await ws.close(code=1008, reason="Authentication failed")
                        break
                    continue

                if opcode not in (OP_PING, OP_AUTH, OP_ERR) and self._aead_required():
                    if vault is None or not vault.is_established:
                        await self._send_error(ws, "ChaCha20-Poly1305 ECDH vault handshake required by host security policy")
                        continue

                # Replay check on operational binary frames (seq >= 1, no duplicates)
                if opcode not in (OP_PING, OP_AUTH, OP_FRAME_SYNC):
                    replay_guard = self._client_replay.get(ws)
                    if replay_guard is not None and not replay_guard.validate_and_update(seq):
                        logger.warning("Replay or invalid zero sequence (%d) on opcode 0x%02X from %s", seq, opcode, client_id)
                        await self._send_error(ws, f"Invalid or replayed sequence number: {seq}")
                        continue

                # =====================================================
                # AUTHENTICATED OPCODES
                # =====================================================
                if opcode == OP_PING:
                    await self._send_encrypted_or_plain(ws, OP_PING, b'PONG', seq=seq)

                elif opcode == OP_AUTH:
                    vault = self._client_vaults.get(ws)
                    if vault is None and HostCryptoVault is not None and (
                        payload == b"INIT_ECDH_VAULT"
                        or (payload.startswith(b"INIT_ECDH_VAULT_M:") and len(payload) == 34)
                    ):
                        secrets_list = self._get_valid_secrets()
                        vault_psk = self._client_secrets.get(ws) or (secrets_list[0] if secrets_list else None)
                        if vault_psk:
                            vault = HostCryptoVault(vault_psk)
                            self._client_vaults[ws] = vault
                            chal = vault.create_handshake_challenge()
                            if len(payload) == 34:
                                client_chal = payload[18:]
                                host_mac = hmac.new(
                                    vault_psk,
                                    b"CST_HOST_CHAL_M:" + client_chal + chal,
                                    hashlib.sha256,
                                ).digest()
                                chal = chal + host_mac
                            await self._ws_send(ws, pack_packet(OP_AUTH, chal, seq=seq, flags=0x01))
                            continue
                    if vault is not None and not vault.is_established:
                        vault_ok = False
                        async with self._get_ws_write_lock(ws):
                            if len(payload) >= 80 and vault.complete_handshake(payload):
                                self._clients_need_keyframe.add(ws)
                                self._client_auth_ts[ws] = time.monotonic()
                                await ws.send(pack_packet(OP_AUTH, b'OK_ECDH_VAULT', seq=seq, flags=0x01))
                                vault_ok = True
                        if vault_ok:
                            continue
                        self._record_auth_failure(client_ip, client_id)
                        vault.close()
                        self._client_vaults.pop(ws, None)
                        await self._send_error(ws, "ECDH vault handshake verification failed")
                        continue
                    await self._send_encrypted_or_plain(ws, OP_AUTH, b'OK_AUTHENTICATED', seq=seq)

                elif opcode == OP_SHELL:
                    self._track_task(self._process_shell_command(ws, payload, seq))

                elif opcode == OP_HITL:
                    await self._process_hitl_response(payload, ws)

                elif opcode == OP_CLIP:
                    await self._process_clipboard(ws, payload)

                elif opcode == OP_INPUT:
                    await self._process_virtual_input(payload, ws)

                elif opcode == OP_AUDIO:
                    if not self.audio_control_enabled:
                        await self._send_error(ws, "Remote audio and media control is disabled by host policy")
                    else:
                        await self._process_audio_control(payload, ws)

                elif opcode == OP_VIEWPORT_RESIZE:
                    await self._process_viewport_resize(payload, ws)

                elif opcode == OP_LLM_STREAM:
                    if not self.ollama_bridge_enabled:
                        await self._send_error(ws, "Local Ollama AI Bridge is disabled by host policy")
                    else:
                        self._track_task(self._process_ollama_query(ws, payload, seq))

                elif opcode == OP_FILE_TRANSFER:
                    if not self.file_transfer_enabled:
                        await self._send_error(ws, "Remote file transfer is disabled by host policy")
                    elif not self._is_client_input_allowed(ws):
                        await self._send_error(ws, "File upload blocked while View-Only Mode or input lock is active")
                    elif self.file_writer:
                        ack_packet = await self.file_writer.handle_packet_async(payload)
                        unpacked_ack = unpack_packet(ack_packet)
                        ack_payload = unpacked_ack[5] if unpacked_ack else ack_packet[HEADER_SIZE:]
                        await self._send_encrypted_or_plain(
                            ws, OP_FILE_TRANSFER, ack_payload
                        )
                    else:
                        await self._send_error(ws, "File transfer service inactive")

                elif opcode == OP_DISPLAY_ENUM:
                    await self._process_display_enum(ws, payload, seq)

                elif opcode == OP_FRAME_SYNC:
                    self._trigger_keyframe_resync(ws)

                else:
                    await self._send_error(ws, f"Unknown opcode: 0x{opcode:02X}")

        except Exception as e:
            if websockets is not None and isinstance(e, websockets.exceptions.ConnectionClosed):
                pass
            else:
                logger.error("Error handling client %s: %s", client_ip, e)
        finally:
            if self.chaos_shield:
                await self.chaos_shield.cleanup_and_scrub(client_id)
            if self.gui_state is not None:
                with self.gui_state.lock:
                    self.gui_state.connected_clients = [
                        c for c in self.gui_state.connected_clients if c.get("id") != client_id
                    ]
            pending_pair = self._pending_pairings.pop(ws, None)
            if pending_pair is not None and scrub_memory is not None and isinstance(pending_pair[0], bytearray):
                scrub_memory(pending_pair[0])
            vault = self._client_vaults.pop(ws, None)
            if vault is not None:
                try:
                    vault.close()
                except Exception:
                    pass
            self._client_replay.pop(ws, None)
            self._client_secrets.pop(ws, None)
            self._client_outbound_seq.pop(ws, None)
            self._ws_write_locks.pop(ws, None)
            self._clients_need_keyframe.discard(ws)
            self._clients_explicit_sync.discard(ws)
            self._client_auth_ts.pop(ws, None)
            self._client_frame_inflight.discard(ws)
            self._stream_paused_clients.discard(ws)
            was_authenticated = ws in self.authenticated_clients
            self.clients.discard(ws)
            self.authenticated_clients.discard(ws)
            self.active_nonces.pop(ws, None)
            if self.file_writer:
                try:
                    self.file_writer.prune_stale_transfers()
                    if not self.authenticated_clients:
                        self.file_writer.abort_all()
                except Exception:
                    pass
            if was_authenticated and self.auto_lock_on_disconnect and not self.authenticated_clients and platform.system() == "Windows":
                try:
                    ctypes.windll.user32.LockWorkStation()
                except Exception:
                    pass
            logger.info("Client disconnected: %s", client_id)

    # =================================================================
    # AUTHENTICATION & HANDSHAKE
    # =================================================================
    async def _process_auth(self, ws: WebSocketServerProtocol, payload: bytes, client_id: Optional[str] = None):
        """
        Validates HMAC-SHA256 signature using constant-time comparison.
        Always resolves client identity before auth validation to prevent UnboundLocalError.
        """
        client_ip = ws.remote_address[0] if ws.remote_address else "unknown"
        client_port = ws.remote_address[1] if ws.remote_address and len(ws.remote_address) > 1 else id(ws)
        resolved_client_id = client_id or f"{client_ip}:{client_port}"

        nonce_info = self.active_nonces.pop(ws, None)
        if not nonce_info:
            await self._send_error(ws, "Handshake state invalid")
            await ws.close(code=1008)
            return

        nonce, timestamp = nonce_info
        if time.time() - timestamp > MAX_NONCE_AGE_SECONDS:
            await self._send_error(ws, "Authentication nonce expired")
            await ws.close(code=1008)
            return

        if len(payload) < 32:
            self._record_auth_failure(client_ip, resolved_client_id)
            await self._send_error(ws, "Auth payload too short (minimum 32 bytes)")
            await ws.close(code=1008)
            return

        client_hmac = payload[:32]
        valid_secrets = self._get_valid_secrets()
        matched_secret = next(
            (sec for sec in valid_secrets if hmac.compare_digest(client_hmac, hmac.new(sec, nonce, hashlib.sha256).digest())),
            None,
        )
        if matched_secret is not None:
            self._client_secrets[ws] = matched_secret
            self._register_authenticated_client(ws, client_ip, resolved_client_id, f"Binary Peer ({client_ip})")
            if self.gui_state is not None:
                self.gui_state.add_log("SECURITY", f"Client {resolved_client_id} authenticated via HMAC-SHA256.")
            await self._ws_send(ws, pack_packet(OP_AUTH, b'OK_AUTHENTICATED'))
            logger.info("Client %s authenticated successfully.", resolved_client_id)
        else:
            logger.warning("HMAC Authentication failed from %s", resolved_client_id)
            self._record_auth_failure(client_ip, resolved_client_id)
            await self._send_error(ws, "Invalid HMAC signature")
            await ws.close(code=1008, reason="Authentication failed")

    def _trigger_keyframe_resync(self, ws: Optional[WebSocketServerProtocol] = None) -> None:
        if ws is not None:
            self._clients_need_keyframe.add(ws)
            self._clients_explicit_sync.add(ws)
        else:
            for cws in list(self.authenticated_clients):
                self._clients_need_keyframe.add(cws)
                self._clients_explicit_sync.add(cws)
        self.screen_pipeline.force_keyframe = True
        self._wake_stream()

    async def _send_encrypted_or_plain(self, ws: WebSocketServerProtocol, opcode: int, payload: bytes, seq: int = 0) -> None:
        async with self._get_ws_write_lock(ws):
            if seq <= 0 and opcode not in (OP_AUTH, OP_PING):
                seq = self._next_outbound_seq(ws)
            vault = self._client_vaults.get(ws)
            if vault is not None and vault.is_established:
                # AAD binds the exact outer 12-byte wire header (wire_len = len(payload) + 12B nonce + 16B Poly1305 tag)
                wire_len = len(payload) + 28
                aad = _HEADER_STRUCT.pack(MAGIC, opcode, 0x02, seq, wire_len)
                enc_payload, _ = vault.encrypt_frame(payload, aad=aad)
                await ws.send(pack_packet(opcode, enc_payload, seq=seq, flags=0x02))
                return
            await ws.send(pack_packet(opcode, payload, seq=seq))

    # =================================================================
    # COMMAND EXECUTION & HITL CONTAINMENT
    # =================================================================
    async def _request_hitl_approval(
        self,
        ws: WebSocketServerProtocol,
        cmd_str: str,
        reason: str,
        seq: int = 0,
        is_binary: bool = False,
        client_cmd_id: Optional[str] = None,
    ) -> Tuple[bool, str]:
        """
        Generates a server-bound HITL challenge tied to this WebSocket session,
        prompts the local GUI operator if present, and awaits verification.
        """
        approval_id = secrets.token_hex(12)
        challenge_nonce = secrets.token_hex(16)
        fut = asyncio.get_running_loop().create_future()
        self.pending_approvals[approval_id] = {
            "future": fut,
            "ws": ws,
            "nonce": challenge_nonce,
            "command": cmd_str,
        }

        if self.gui_state is not None and hasattr(self.gui_state, "request_local_hitl_approval"):
            self.gui_state.request_local_hitl_approval(
                approval_id=approval_id,
                command=cmd_str,
                reason=reason,
                resolve_cb=lambda ok, aid=approval_id: self.resolve_local_hitl(aid, ok),
            )

        hitl_event = {
            "event": "APPROVAL_REQUIRED",
            "approval_id": approval_id,
            "command_id": client_cmd_id or approval_id,
            "challenge_nonce": challenge_nonce,
            "command": cmd_str,
            "proposed_command": cmd_str,
            "reason": reason,
            "explanation": reason,
            "risk_level": "HIGH",
            "requires_signature": self.security_profile in ("strict", "zero_trust"),
            "target_id": self._hostname,
            "timestamp": time.time(),
        }
        try:
            if is_binary:
                await self._send_encrypted_or_plain(
                    ws, OP_HITL, json.dumps(hitl_event).encode("utf-8"), seq=self._next_outbound_seq(ws)
                )
            else:
                await self._ws_send(ws, json.dumps(hitl_event))
            approved = await asyncio.wait_for(fut, timeout=30.0)
        except asyncio.TimeoutError:
            approved = False
        finally:
            self.pending_approvals.pop(approval_id, None)
        return bool(approved), approval_id

    def resolve_local_hitl(self, approval_id: str, approved: bool) -> None:
        """Called by trusted local host GUI operator dialog to approve or deny pending HITL request."""
        def _resolve():
            entry = self.pending_approvals.get(approval_id)
            if entry:
                fut = entry.get("future")
                if fut and not fut.done():
                    fut.set_result(bool(approved))
        if self.loop and self.loop.is_running() and threading.get_ident() != self._loop_thread_id:
            self.loop.call_soon_threadsafe(_resolve)
        else:
            _resolve()

    async def _process_json_shell_command(self, ws: WebSocketServerProtocol, cmd_str: str, command_id: str):
        """Executes JSON EXECUTE_PROMPT commands with AST + HITL safety gate."""
        if not self._is_client_input_allowed(ws):
            await self._ws_send(ws, json.dumps({
                "event": "EXECUTION_RESULT",
                "command_id": command_id,
                "status": "rejected",
                "output": "Shell execution forbidden while host is in View-Only Mode or client input is locked.",
                "exit_code": -1,
                "timestamp": int(time.time())
            }))
            return

        if CommandASTFirewall is not None:
            is_allowed, risk, normalized_cmd, fw_reason = CommandASTFirewall.inspect_and_sanitize(cmd_str)
            if not is_allowed or risk == "BLOCKED":
                await self._ws_send(ws, json.dumps({
                    "event": "EXECUTION_RESULT",
                    "command_id": command_id,
                    "status": "rejected",
                    "output": f"Security Firewall Block: {fw_reason}",
                    "exit_code": -1,
                    "risk_level": "BLOCKED",
                    "timestamp": int(time.time())
                }))
                return
        else:
            normalized_cmd = cmd_str
            risk = "SAFE"

        is_dangerous, reason = AstCommandInspector.inspect(normalized_cmd)
        biometric_approved = False
        if is_dangerous or risk == "REQUIRES_BIOMETRIC":
            approved, _ = await self._request_hitl_approval(ws, normalized_cmd, reason, is_binary=False, client_cmd_id=command_id)
            if not approved:
                await self._ws_send(ws, json.dumps({
                    "event": "EXECUTION_RESULT",
                    "command_id": command_id,
                    "status": "rejected",
                    "output": "Execution denied by operator (HITL Safety Gate).",
                    "exit_code": -1,
                    "timestamp": int(time.time())
                }))
                return
            biometric_approved = True

        try:
            t0 = time.perf_counter()
            if CommandASTFirewall is None:
                raise RuntimeError("CommandASTFirewall unavailable")
            exec_res = await CommandASTFirewall.execute_sandboxed(
                normalized_cmd,
                timeout_sec=15.0,
                biometric_approved=biometric_approved,
            )
            if self.gui_state is not None:
                with self.gui_state.lock:
                    self.gui_state.commands_executed += 1
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            out_parts = [p for p in (exec_res.get("stdout") or "", exec_res.get("stderr") or "") if p]
            combined_output = "\n".join(out_parts)
            await self._ws_send(ws, json.dumps({
                "event": "EXECUTION_RESULT",
                "command_id": command_id,
                "status": "success" if exec_res["success"] else "error",
                "exit_code": exec_res["exit_code"],
                "output": combined_output,
                "command": cmd_str,
                "execution_time_ms": elapsed_ms,
                "timestamp": int(time.time())
            }))
        except Exception as e:
            await self._ws_send(ws, json.dumps({
                "event": "EXECUTION_RESULT",
                "command_id": command_id,
                "status": "error",
                "output": str(e),
                "exit_code": -1,
                "timestamp": int(time.time())
            }))

    async def _process_shell_command(self, ws: WebSocketServerProtocol, payload: bytes, seq: int):
        """Executes shell commands inside sandbox Job Object with strict AST + HITL gates."""
        if len(payload) > 8192:
            resp = json.dumps({
                "event": "EXECUTION_RESULT",
                "command_id": f"cmd-{seq or int(time.time() * 1000)}",
                "status": "rejected",
                "output": "Security Firewall Block: Command exceeds 8192 byte safety limit.",
                "exit_code": -1,
                "risk_level": "BLOCKED",
                "is_terminal": True,
                "timestamp": int(time.time())
            }).encode("utf-8")
            await self._send_encrypted_or_plain(ws, OP_SHELL, resp)
            return

        if not self._is_client_input_allowed(ws):
            resp = json.dumps({
                "event": "EXECUTION_RESULT",
                "command_id": f"cmd-{seq or int(time.time() * 1000)}",
                "status": "rejected",
                "output": "Shell execution forbidden while host is in View-Only Mode or client input is locked.",
                "exit_code": -1,
                "is_terminal": True,
                "timestamp": int(time.time())
            }).encode('utf-8')
            await self._send_encrypted_or_plain(ws, OP_SHELL, resp)
            return

        cmd_str = payload.decode('utf-8', errors='replace').strip()
        if not cmd_str:
            return

        if CommandASTFirewall is not None:
            is_allowed, risk, normalized_cmd, fw_reason = CommandASTFirewall.inspect_and_sanitize(cmd_str)
            if not is_allowed or risk == "BLOCKED":
                resp = json.dumps({
                    "event": "EXECUTION_RESULT",
                    "command_id": f"cmd-{seq or int(time.time() * 1000)}",
                    "status": "rejected",
                    "output": f"Security Firewall Block: {fw_reason}",
                    "exit_code": -1,
                    "risk_level": "BLOCKED",
                    "is_terminal": True,
                    "timestamp": int(time.time())
                }).encode("utf-8")
                await self._send_encrypted_or_plain(ws, OP_SHELL, resp)
                return
        else:
            normalized_cmd = cmd_str
            risk = "SAFE"

        is_dangerous, reason = AstCommandInspector.inspect(normalized_cmd)
        biometric_approved = False
        if is_dangerous or risk == "REQUIRES_BIOMETRIC":
            approved, approval_id = await self._request_hitl_approval(ws, normalized_cmd, reason, seq=seq, is_binary=True)
            if not approved:
                resp = json.dumps({
                    "event": "EXECUTION_RESULT",
                    "command_id": approval_id,
                    "status": "rejected",
                    "output": "Execution denied by operator (HITL Safety Gate).",
                    "exit_code": -1,
                    "is_terminal": True,
                    "timestamp": int(time.time())
                }).encode('utf-8')
                await self._send_encrypted_or_plain(ws, OP_SHELL, resp)
                return
            biometric_approved = True

        try:
            if CommandASTFirewall is None:
                raise RuntimeError("CommandASTFirewall unavailable")
            exec_res = await CommandASTFirewall.execute_sandboxed(
                normalized_cmd,
                timeout_sec=15.0,
                biometric_approved=biometric_approved,
            )
            if self.gui_state is not None:
                with self.gui_state.lock:
                    self.gui_state.commands_executed += 1
            out_parts = [p for p in (exec_res.get("stdout") or "", exec_res.get("stderr") or "") if p]
            combined_output = "\n".join(out_parts)
            result = {
                "event": "EXECUTION_RESULT",
                "command_id": f"cmd-{seq or int(time.time() * 1000)}",
                "status": "success" if exec_res["success"] else "error",
                "exit_code": exec_res["exit_code"],
                "output": combined_output,
                "command": cmd_str,
                "risk_level": exec_res.get("risk_level", "SAFE"),
                "is_terminal": True,
                "timestamp": int(time.time())
            }
            await self._send_encrypted_or_plain(
                ws, OP_SHELL, json.dumps(result).encode('utf-8')
            )

        except Exception as e:
            err_msg = json.dumps({
                "event": "EXECUTION_RESULT",
                "command_id": f"cmd-{seq or int(time.time() * 1000)}",
                "status": "error",
                "output": str(e),
                "exit_code": -1,
                "is_terminal": True,
                "timestamp": int(time.time())
            }).encode('utf-8')
            await self._send_encrypted_or_plain(ws, OP_SHELL, err_msg)

    async def _process_hitl_response(self, payload: bytes, ws: Optional[WebSocketServerProtocol] = None):
        """Handles HITL challenge responses with session binding and secret HMAC proof."""
        try:
            data = json.loads(payload.decode('utf-8'))
            if not isinstance(data, dict):
                return
            action_upper = str(data.get("action") or "").upper()
            if action_upper in ("PANIC_KILL_ALL", "PANIC") and ws in self.authenticated_clients:
                if not self._is_client_input_allowed(ws):
                    await self._send_error(ws, "Panic kill blocked while View-Only Mode or input lock is active")
                    return
                try:
                    await self._send_encrypted_or_plain(
                        ws, OP_HITL,
                        json.dumps({"event": "PANIC_ACK", "status": "terminated", "timestamp": time.time()}).encode("utf-8"),
                    )
                except Exception:
                    pass
                self.kill_all_tasks()
                return
            if action_upper == "DISCONNECT_CLIENT" and ws in self.authenticated_clients:
                if not self._is_client_input_allowed(ws):
                    await self._send_error(ws, "Disconnect action blocked while View-Only Mode or input lock is active")
                    return
                target_cid = str(data.get("clientId") or data.get("ip") or "").strip()
                if target_cid:
                    self.force_disconnect_client(target_cid)
                try:
                    await self._send_encrypted_or_plain(
                        ws, OP_HITL,
                        json.dumps({"event": "DISCONNECT_ACK", "clientId": target_cid, "timestamp": time.time()}).encode("utf-8"),
                    )
                except Exception:
                    pass
                return
            approval_id = str(data.get("approval_id") or data.get("command_id") or "")
            approved = bool(data.get("approved", False))
            provided_sig = str(data.get("signature") or data.get("approval_hmac") or "").strip().lower()

            entry = self.pending_approvals.get(approval_id)
            if not entry:
                return
            if ws is not None and entry.get("ws") is not None and entry["ws"] is not ws:
                logger.warning("Blocked cross-session HITL approval attempt for %s", approval_id)
                return

            fut = entry.get("future")
            if not fut or fut.done():
                return

            if not approved:
                fut.set_result(False)
                return

            if self.security_profile in ("strict", "zero_trust"):
                logger.warning("Remote HITL approval ignored under %s profile (local host approval required)", self.security_profile)
                if ws is not None:
                    await self._send_error(
                        ws,
                        f"Host is in {self.security_profile} mode: approve this command directly on the PC desktop prompt.",
                    )
                return

            # Require HMAC-SHA256 signature over approval_id:nonce:command using pairing secret
            nonce = str(entry.get("nonce") or "")
            cmd = str(entry.get("command") or "")
            proof_msg = f"{approval_id}:{nonce}:{cmd}".encode("utf-8")
            sig_ok = bool(provided_sig) and any(
                hmac.compare_digest(
                    provided_sig,
                    hmac.new(sec, proof_msg, hashlib.sha256).hexdigest().lower(),
                )
                for sec in self._get_valid_secrets()
            )
            if not sig_ok:
                logger.warning("Rejected unsigned/forged remote HITL approval for %s", approval_id)
                if self.gui_state is not None:
                    self.gui_state.add_log("ALERT", f"Blocked unverified remote HITL self-approval for '{cmd[:40]}'")
                fut.set_result(False)
                return

            fut.set_result(True)
        except Exception as e:
            logger.debug("HITL response parse error: %s", e)

    async def _process_clipboard(self, ws: WebSocketServerProtocol, payload: bytes):
        """
        Opcode 0x07: Bidirectional Clipboard Synchronization (safe across non-Tk threads).
        """
        if payload and len(payload) > 1_048_576:
            await self._send_error(ws, "Clipboard payload exceeds 1 MiB limit")
            return
        self._refresh_runtime_policies()
        if not self.clipboard_sync_allowed:
            logger.info("Clipboard sync ignored: disabled by host security policy.")
            return
        try:
            loop = asyncio.get_running_loop()
            if payload:
                if not self._is_client_input_allowed(ws):
                    logger.info("Clipboard write rejected: host in View-Only Mode or client input locked.")
                    return
                text = payload.decode('utf-8', errors='replace')
                if pyperclip:
                    await loop.run_in_executor(None, pyperclip.copy, text)
                elif platform.system() == "Windows":
                    import subprocess
                    await loop.run_in_executor(
                        None,
                        lambda: subprocess.run(["clip"], input=b"\xff\xfe" + text.encode("utf-16-le"), check=False, timeout=2.0),
                    )
                elif platform.system() == "Darwin":
                    import subprocess
                    await loop.run_in_executor(
                        None,
                        lambda: subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=False, timeout=2.0),
                    )

            host_clip = ""
            if pyperclip:
                try:
                    host_clip = await loop.run_in_executor(None, pyperclip.paste)
                except Exception:
                    pass
            if host_clip or not payload:
                await self._send_encrypted_or_plain(
                    ws, OP_CLIP, (host_clip or "")[:1_048_576].encode('utf-8')
                )
            if payload:
                self._wake_stream()
        except Exception as e:
            logger.debug("Clipboard sync error: %s", e)

    async def _process_virtual_input(self, payload: bytes, ws: Optional[WebSocketServerProtocol] = None):
        """
        Opcode 0x08: Remote Virtual Input (Trackpad, Mouse & Keystroke Forwarding).
        """
        try:
            if ws is not None and not self._is_client_input_allowed(ws):
                logger.info("Remote input ignored: View-Only Mode or client input locked.")
                return
            elif ws is None and (self.view_only_mode or (self.gui_state is not None and getattr(self.gui_state, "view_only_mode", False))):
                return

            if not pyautogui:
                logger.debug("pyautogui not installed - input forwarding skipped")
                return

            loop = asyncio.get_running_loop()

            def _finite_float(val: Any, lo: float = -5000.0, hi: float = 5000.0, default: float = 0.0) -> float:
                v = float(val)
                if not math.isfinite(v):
                    return default
                return max(lo, min(hi, v))

            def _clamp_int(val: Any, lo: int = -5000, hi: int = 5000, default: int = 0) -> int:
                v = float(val)
                if not math.isfinite(v):
                    return default
                return max(lo, min(hi, int(round(v))))

            if len(payload) == 6 and not payload.startswith(b'{'):
                event_type, dx, dy, btn_code = struct.unpack("!BhhB", payload)
                dx = max(-5000, min(5000, int(dx)))
                dy = max(-5000, min(5000, int(dy)))
                btn = "right" if btn_code == 2 else ("middle" if btn_code == 3 else "left")
                def _exec_bin_input():
                    if event_type == 1:
                        pyautogui.moveRel(dx, dy, _pause=False)
                    elif event_type == 2:
                        if btn_code == 4:
                            pyautogui.doubleClick(_pause=False)
                        else:
                            pyautogui.click(button=btn, _pause=False)
                    elif event_type == 3:
                        pyautogui.scroll(dy, _pause=False)
                await loop.run_in_executor(None, _exec_bin_input)
                self._wake_stream()
                return

            data = json.loads(payload.decode('utf-8'))
            if not isinstance(data, dict):
                return
            raw_action = str(data.get("action") or "").lower()
            if raw_action in ("", "input_event", "pc_control", "remote_input"):
                action = str(data.get("kind") or data.get("type") or raw_action).lower()
            else:
                action = raw_action

            def _map_xy(raw_x: Any, raw_y: Any) -> Tuple[int, int]:
                rx = _finite_float(raw_x, -65535.0, 65535.0)
                ry = _finite_float(raw_y, -65535.0, 65535.0)
                s_size = getattr(self.screen_pipeline, "last_stream_size", None)
                c_rect = getattr(self.screen_pipeline, "last_capture_rect", None)
                if s_size and c_rect and s_size[0] > 0 and s_size[1] > 0:
                    left, top, cap_w, cap_h = c_rect
                    sw, sh = s_size
                    mx = left + int(round((rx * cap_w) / sw))
                    my = top + int(round((ry * cap_h) / sh))
                    return (
                        max(left, min(left + max(0, cap_w - 1), mx)),
                        max(top, min(top + max(0, cap_h - 1), my)),
                    )
                return int(round(rx)), int(round(ry))

            def _type_unicode_safe(text_val: str) -> None:
                if not text_val:
                    return
                if all(ord(ch) < 128 for ch in text_val):
                    pyautogui.write(text_val, _pause=False)
                    return
                if platform.system() == "Windows":
                    try:
                        # Native Win32 SendInput KEYEVENTF_UNICODE supports Cyrillic/Unicode without clobbering clipboard
                        INPUT_KEYBOARD = 1
                        KEYEVENTF_UNICODE = 0x0004
                        KEYEVENTF_KEYUP = 0x0002
                        events = []
                        for ch in text_val:
                            if ch == "\n":
                                events.append(_WIN_INPUT(type=INPUT_KEYBOARD, u=_WIN_INPUT_UNION(ki=_WIN_KEYBDINPUT(wVk=0x0D))))
                                events.append(_WIN_INPUT(type=INPUT_KEYBOARD, u=_WIN_INPUT_UNION(ki=_WIN_KEYBDINPUT(wVk=0x0D, dwFlags=KEYEVENTF_KEYUP))))
                                continue
                            utf16 = ch.encode("utf-16-le")
                            for idx in range(0, len(utf16), 2):
                                code_unit = int.from_bytes(utf16[idx:idx + 2], "little")
                                events.append(_WIN_INPUT(type=INPUT_KEYBOARD, u=_WIN_INPUT_UNION(ki=_WIN_KEYBDINPUT(wScan=code_unit, dwFlags=KEYEVENTF_UNICODE))))
                                events.append(_WIN_INPUT(type=INPUT_KEYBOARD, u=_WIN_INPUT_UNION(ki=_WIN_KEYBDINPUT(wScan=code_unit, dwFlags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP))))
                        if events:
                            arr = (_WIN_INPUT * len(events))(*events)
                            u32 = ctypes.windll.user32
                            u32.SendInput.argtypes = [wintypes.UINT, ctypes.c_void_p, ctypes.c_int]
                            u32.SendInput.restype = wintypes.UINT
                            u32.SendInput(len(events), ctypes.byref(arr), ctypes.sizeof(_WIN_INPUT))
                            return
                    except Exception:
                        pass
                if pyperclip is not None and self.clipboard_sync_allowed:
                    try:
                        prev_clip = pyperclip.paste()
                    except Exception:
                        prev_clip = None
                    try:
                        pyperclip.copy(text_val)
                        pyautogui.hotkey("ctrl", "v", _pause=False)
                        if prev_clip is not None:
                            time.sleep(0.05)
                            pyperclip.copy(prev_clip)
                        return
                    except Exception:
                        pass
                pyautogui.write(text_val, _pause=False)

            def _exec_json_input():
                if action == "media":
                    if not self.audio_control_enabled:
                        logger.info("Media command via OP_INPUT ignored: disabled by host audio policy.")
                        return
                    media_cmd = str(data.get("command") or "").lower()
                    if media_cmd:
                        self._execute_media_command(media_cmd, steps=1)
                    return
                if action == "move":
                    if "x" in data and "y" in data and "dx" not in data and "dy" not in data:
                        x, y = _map_xy(data.get("x", 0), data.get("y", 0))
                        pyautogui.moveTo(x, y, _pause=False)
                    else:
                        dx = _finite_float(data.get("dx", 0))
                        dy = _finite_float(data.get("dy", 0))
                        pyautogui.moveRel(dx, dy, _pause=False)
                elif action in ("move_to", "mouse_move"):
                    x, y = _map_xy(data.get("x", 0), data.get("y", 0))
                    pyautogui.moveTo(x, y, _pause=False)
                elif action in ("click", "mouse_click"):
                    raw_btn = str(data.get("button", "left")).lower()
                    btn = raw_btn if raw_btn in ("left", "right", "middle", "double") else "left"
                    x = data.get("x")
                    y = data.get("y")
                    if btn == "double":
                        if x is not None and y is not None:
                            tx, ty = _map_xy(x, y)
                            pyautogui.doubleClick(x=tx, y=ty, _pause=False)
                        else:
                            pyautogui.doubleClick(_pause=False)
                    elif x is not None and y is not None:
                        tx, ty = _map_xy(x, y)
                        pyautogui.click(x=tx, y=ty, button=btn, _pause=False)
                    else:
                        pyautogui.click(button=btn, _pause=False)
                elif action == "click_at":
                    x, y = _map_xy(data.get("x", 0), data.get("y", 0))
                    raw_btn = str(data.get("button", "left")).lower()
                    btn = raw_btn if raw_btn in ("left", "right", "middle") else "left"
                    pyautogui.click(x=x, y=y, button=btn, _pause=False)
                elif action in ("double_click", "mouse_double_click", "dblclick"):
                    x = data.get("x")
                    y = data.get("y")
                    if x is not None and y is not None:
                        tx, ty = _map_xy(x, y)
                        pyautogui.doubleClick(x=tx, y=ty, _pause=False)
                    else:
                        pyautogui.doubleClick(_pause=False)
                elif action == "double_click_at":
                    x, y = _map_xy(data.get("x", 0), data.get("y", 0))
                    pyautogui.doubleClick(x=x, y=y, _pause=False)
                elif action == "right_click_at":
                    x, y = _map_xy(data.get("x", 0), data.get("y", 0))
                    pyautogui.rightClick(x=x, y=y, _pause=False)
                elif action in ("scroll", "mouse_scroll"):
                    dy = _clamp_int(data.get("dy", 0))
                    x = data.get("x")
                    y = data.get("y")
                    if x is not None and y is not None:
                        tx, ty = _map_xy(x, y)
                        pyautogui.scroll(dy, x=tx, y=ty, _pause=False)
                    else:
                        pyautogui.scroll(dy, _pause=False)
                elif action == "scroll_at":
                    x, y = _map_xy(data.get("x", 0), data.get("y", 0))
                    dy = _clamp_int(data.get("dy", 0))
                    pyautogui.scroll(dy, x=x, y=y, _pause=False)
                elif action in ("type", "type_text", "keyboard_type"):
                    raw_text = str(data.get("text", ""))[:2048]
                    text = "".join(ch for ch in raw_text if ord(ch) >= 32 or ch in ("\n", "\t"))
                    press_enter = bool(data.get("press_enter", data.get("pressEnter", False)))
                    if text:
                        _type_unicode_safe(text)
                    if press_enter:
                        pyautogui.press('enter', _pause=False)
                elif action in ("key", "key_press"):
                    key = str(data.get("key", "")).strip().lower()
                    if key and len(key) <= 32 and key in getattr(pyautogui, "KEYBOARD_KEYS", {key}):
                        pyautogui.press(key, _pause=False)
                elif action in ("hotkey", "key_combo", "keyboard_hotkey"):
                    raw_keys = data.get("keys") if data.get("keys") is not None else data.get("command", [])
                    if isinstance(raw_keys, str):
                        normalized_keys = raw_keys.replace("+", ",")
                        keys = [k.strip().lower() for k in normalized_keys.split(",") if k.strip()][:6]
                    elif isinstance(raw_keys, list):
                        keys = [str(k).strip().lower() for k in raw_keys if str(k).strip()][:6]
                    else:
                        keys = []
                    _key_aliases = {
                        "ctrlleft": "ctrl",
                        "ctrlright": "ctrl",
                        "control": "ctrl",
                        "altleft": "alt",
                        "altright": "alt",
                        "shiftleft": "shift",
                        "shiftright": "shift",
                        "escape": "esc",
                        "delete": "del",
                    }
                    key_set = {_key_aliases.get(k, k) for k in keys}
                    blocked_combos = (
                        {"ctrl", "alt", "del"},
                        {"ctrl", "shift", "esc"},
                    )
                    if key_set in blocked_combos:
                        return
                    valid_keyset = set(getattr(pyautogui, "KEYBOARD_KEYS", []))
                    if keys and (not valid_keyset or all(k in valid_keyset for k in keys)):
                        pyautogui.hotkey(*keys, _pause=False)

            await loop.run_in_executor(None, _exec_json_input)
            self._wake_stream()
        except Exception as e:
            logger.debug("Virtual input injection error: %s", e)

    @staticmethod
    def _execute_media_command(action: str, steps: int = 1) -> None:
        """Executes OS-level media/audio/workstation-lock actions safely."""
        repeats = max(1, min(10, int(steps)))
        if platform.system() == "Windows":
            VK_MEDIA_NEXT_TRACK = 0xB0
            VK_MEDIA_PREV_TRACK = 0xB1
            VK_VOLUME_MUTE = 0xAD
            VK_VOLUME_DOWN = 0xAE
            VK_VOLUME_UP = 0xAF
            VK_MEDIA_PLAY_PAUSE = 0xB3
            user32 = ctypes.windll.user32
            if action in ("volume_up", "vol_up"):
                for _ in range(repeats):
                    user32.keybd_event(VK_VOLUME_UP, 0, 0, 0)
                    user32.keybd_event(VK_VOLUME_UP, 0, 2, 0)
            elif action in ("volume_down", "vol_down"):
                for _ in range(repeats):
                    user32.keybd_event(VK_VOLUME_DOWN, 0, 0, 0)
                    user32.keybd_event(VK_VOLUME_DOWN, 0, 2, 0)
            elif action in ("mute", "volume_mute"):
                user32.keybd_event(VK_VOLUME_MUTE, 0, 0, 0)
                user32.keybd_event(VK_VOLUME_MUTE, 0, 2, 0)
            elif action == "play_pause":
                user32.keybd_event(VK_MEDIA_PLAY_PAUSE, 0, 0, 0)
                user32.keybd_event(VK_MEDIA_PLAY_PAUSE, 0, 2, 0)
            elif action in ("next", "next_track"):
                user32.keybd_event(VK_MEDIA_NEXT_TRACK, 0, 0, 0)
                user32.keybd_event(VK_MEDIA_NEXT_TRACK, 0, 2, 0)
            elif action in ("prev", "previous", "prev_track", "previous_track"):
                user32.keybd_event(VK_MEDIA_PREV_TRACK, 0, 0, 0)
                user32.keybd_event(VK_MEDIA_PREV_TRACK, 0, 2, 0)
            elif action in ("lock_pc", "lock"):
                user32.LockWorkStation()
        elif platform.system() == "Linux":
            import subprocess
            if action in ("volume_up", "vol_up"):
                subprocess.run(["amixer", "-D", "pulse", "sset", "Master", f"{min(50, repeats * 5)}%+"], check=False, timeout=3.0)
            elif action in ("volume_down", "vol_down"):
                subprocess.run(["amixer", "-D", "pulse", "sset", "Master", f"{min(50, repeats * 5)}%-"], check=False, timeout=3.0)
            elif action in ("mute", "volume_mute"):
                subprocess.run(["amixer", "-D", "pulse", "sset", "Master", "toggle"], check=False, timeout=3.0)
            elif action == "play_pause":
                subprocess.run(["playerctl", "play-pause"], check=False, timeout=3.0)
            elif action in ("next", "next_track"):
                subprocess.run(["playerctl", "next"], check=False, timeout=3.0)
            elif action in ("prev", "previous", "prev_track", "previous_track"):
                subprocess.run(["playerctl", "previous"], check=False, timeout=3.0)
            elif action in ("lock_pc", "lock"):
                subprocess.run(["loginctl", "lock-session"], check=False, timeout=3.0)

    async def _process_audio_control(self, payload: bytes, ws: Optional[WebSocketServerProtocol] = None):
        """
        Opcode 0x09: Remote Audio & Media Session Control (subject to View-Only / input lock).
        """
        if ws is not None and not self._is_client_input_allowed(ws):
            logger.info("Audio/Lock control ignored: host is in View-Only Mode or client input locked.")
            return
        try:
            steps = 1
            if len(payload) == 2 and not payload.startswith(b'{'):
                action_code, vol_pct = struct.unpack("!BB", payload)
                _AUDIO_ACTION_MAP = {1: "volume_up", 2: "volume_down", 3: "mute", 4: "play_pause"}
                action = _AUDIO_ACTION_MAP.get(action_code, "")
                if vol_pct >= 10 and action in ("volume_up", "volume_down"):
                    steps = max(1, min(10, round(vol_pct / 10)))
            else:
                data = json.loads(payload.decode('utf-8'))
                if not isinstance(data, dict):
                    return
                action = str(data.get("action") or data.get("command") or data.get("type") or "").lower()
                if "steps" in data:
                    steps = max(1, min(10, int(data["steps"])))

            if not action:
                return
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self._execute_media_command, action, steps)
        except Exception as e:
            logger.debug("Audio control error: %s", e)

    def _switch_active_monitor(self, idx: int) -> None:
        monitors = self.multi_monitor.enumerate_monitors() if self.multi_monitor else []
        max_idx = max(1, len(monitors))
        clamped = max(1, min(max_idx, int(idx)))
        self.screen_pipeline.monitor_index = clamped
        self.screen_pipeline.force_keyframe = True
        self.screen_pipeline.consecutive_static = 0
        self.screen_pipeline.last_stream_size = None
        self.screen_pipeline._last_encoded_frame = None
        if self.multi_monitor:
            self.multi_monitor.switch_monitor(clamped)
        self._wake_stream()

    async def _process_viewport_resize(self, payload: bytes, ws: Optional[WebSocketServerProtocol] = None):
        """
        Handles 0x0A (VIEWPORT_RESIZE) control packet cleanly for both JSON and 8-byte binary structs.
        Supports optional per-client `stream_enabled` and `fps` tuning.
        """
        try:
            stripped = payload.lstrip()
            if stripped.startswith(b'{'):
                data = json.loads(stripped.decode('utf-8'))
                if not isinstance(data, dict):
                    return
                if "width" in data and "height" in data:
                    self.screen_pipeline.set_target_resolution(int(data["width"]), int(data["height"]))
                if "quality" in data:
                    self.screen_pipeline.set_quality(int(data["quality"]))
                if "monitor" in data:
                    self._switch_active_monitor(int(data["monitor"]))
                if "fps" in data and data["fps"] is not None:
                    req_fps = max(5, min(60, int(data["fps"])))
                    self.target_fps = req_fps
                    self.screen_pipeline.set_target_fps(req_fps)
                if ws is not None and "stream_enabled" in data:
                    if bool(data["stream_enabled"]):
                        self._stream_paused_clients.discard(ws)
                        self.screen_pipeline.force_keyframe = True
                    else:
                        self._stream_paused_clients.add(ws)
                self._wake_stream()
            elif len(payload) == 8:
                width, height = struct.unpack('!II', payload)
                self.screen_pipeline.set_target_resolution(width, height)
                self._wake_stream()
        except Exception as e:
            logger.debug("Viewport resize decode error: %s", e)

    async def _process_display_enum(self, ws: WebSocketServerProtocol, payload: bytes, seq: int):
        """Opcode 0x0D: Enumerates monitors or switches active capture monitor."""
        try:
            switched = False
            if payload:
                stripped = payload.lstrip()
                if stripped.startswith(b'{'):
                    data = json.loads(stripped.decode('utf-8'))
                    if isinstance(data, dict):
                        mon_target = data.get("monitor", data.get("switch_to"))
                        if mon_target is not None:
                            self._switch_active_monitor(int(mon_target))
                            switched = True
                elif len(payload) == 1:
                    self._switch_active_monitor(payload[0])
                    switched = True
            monitors = self.multi_monitor.enumerate_monitors() if self.multi_monitor else [
                {"index": 1, "width": self.screen_pipeline.target_res[0], "height": self.screen_pipeline.target_res[1], "left": 0, "top": 0, "label": "Display 1"}
            ]
            resp = json.dumps({"monitors": monitors, "active": self.screen_pipeline.monitor_index}).encode("utf-8")
            await self._send_encrypted_or_plain(
                ws, OP_DISPLAY_ENUM, resp
            )
            if switched:
                self._clients_need_keyframe.add(ws)
                self._clients_explicit_sync.add(ws)
                self._wake_stream()
        except Exception as exc:
            await self._send_error(ws, f"Display enumeration error: {exc}")

    # =================================================================
    # LOCAL OLLAMA AI STREAMING BRIDGE
    # =================================================================
    async def _process_ollama_query(self, ws: WebSocketServerProtocol, payload: bytes, seq: int):
        """Connects to local Ollama server and streams chunks back cleanly (bounded concurrency)."""
        import urllib.request
        from urllib.parse import urlparse
        if self._ollama_sem is None:
            self._ollama_sem = asyncio.Semaphore(2)
        try:
            async with self._ollama_sem:
                if len(payload) > 65536:
                    await self._send_encrypted_or_plain(
                        ws, OP_LLM_STREAM, json.dumps({"error": "Prompt payload exceeds 64 KiB limit"}).encode("utf-8")
                    )
                    return
                req_data = json.loads(payload.decode('utf-8'))
                if not isinstance(req_data, dict):
                    return
                model = str(req_data.get("model") or "qwen2.5-coder:latest").strip()
                if not re.fullmatch(r"[A-Za-z0-9._:/-]{1,128}", model):
                    await self._send_encrypted_or_plain(
                        ws, OP_LLM_STREAM, json.dumps({"error": "Invalid Ollama model identifier"}).encode("utf-8")
                    )
                    return
                prompt = str(req_data.get("prompt") or "")
                if len(prompt.encode("utf-8", errors="replace")) > 32768:
                    await self._send_encrypted_or_plain(
                        ws, OP_LLM_STREAM, json.dumps({"error": "Prompt exceeds 32 KiB limit"}).encode("utf-8")
                    )
                    return

                base_url = (os.environ.get("OLLAMA_HOST") or "http://127.0.0.1:11434").rstrip("/")
                parsed_url = urlparse(base_url)
                if parsed_url.scheme not in ("http", "https") or (parsed_url.hostname or "").lower() not in ("127.0.0.1", "localhost", "::1"):
                    base_url = "http://127.0.0.1:11434"
                url = f"{base_url}/api/generate"
                body = json.dumps({"model": model, "prompt": prompt, "stream": True}).encode('utf-8')
                req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})

                loop = asyncio.get_running_loop()
                was_auth = ws in self.authenticated_clients

                def sync_stream():
                    total_streamed = 0
                    max_stream_bytes = 2 * 1024 * 1024  # 2 MiB output cap
                    with urllib.request.urlopen(req, timeout=10.0) as resp:
                        for line in resp:
                            if not self.is_running or (was_auth and ws not in self.authenticated_clients):
                                break
                            if line:
                                chunk = json.loads(line.decode('utf-8'))
                                token = chunk.get("response", "")
                                if token:
                                    tok_bytes = token.encode('utf-8')
                                    if total_streamed + len(tok_bytes) > max_stream_bytes:
                                        break
                                    total_streamed += len(tok_bytes)
                                    send_fut = asyncio.run_coroutine_threadsafe(
                                        self._send_encrypted_or_plain(
                                            ws, OP_LLM_STREAM, tok_bytes
                                        ),
                                        loop
                                    )
                                    send_fut.result(timeout=5.0)
                                if chunk.get("done", False):
                                    eof_fut = asyncio.run_coroutine_threadsafe(
                                        self._send_encrypted_or_plain(
                                            ws, OP_LLM_STREAM, b'{"done":true}'
                                        ),
                                        loop
                                    )
                                    eof_fut.result(timeout=5.0)
                                    break

                await loop.run_in_executor(None, sync_stream)
        except Exception as e:
            err_json = json.dumps({"error": f"Ollama local bridge error: {e}"}).encode('utf-8')
            await self._send_encrypted_or_plain(
                ws, OP_LLM_STREAM, err_json
            )

    # =================================================================
    # STREAMING & HEARTBEAT BACKGROUND LOOPS
    # =================================================================
    @staticmethod
    def _is_workstation_locked() -> bool:
        """Fast Win32 desktop lock check with 64-bit safe HDESK bindings (zero kernel handle leaks)."""
        global _WIN_USER32_LOCK_BOUND
        if platform.system() != "Windows":
            return False
        try:
            u32 = ctypes.windll.user32
            if not _WIN_USER32_LOCK_BOUND:
                u32.OpenInputDesktop.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
                u32.OpenInputDesktop.restype = wintypes.HANDLE
                u32.CloseDesktop.argtypes = [wintypes.HANDLE]
                u32.CloseDesktop.restype = wintypes.BOOL
                _WIN_USER32_LOCK_BOUND = True
            h_desk = u32.OpenInputDesktop(0, False, 0x0001)
            if not h_desk:
                return True
            u32.CloseDesktop(h_desk)
            return False
        except Exception:
            return False

    async def _send_frame_guarded(self, ws: WebSocketServerProtocol, frame_bytes: bytes) -> None:
        """Sends a single video frame with timeout and per-client in-flight backpressure tracking."""
        self._client_frame_inflight.add(ws)
        try:
            await asyncio.wait_for(self._send_encrypted_or_plain(ws, OP_FRAME, frame_bytes), timeout=1.5)
            self._clients_need_keyframe.discard(ws)
            self._clients_explicit_sync.discard(ws)
        except Exception:
            self.authenticated_clients.discard(ws)
            self._clients_need_keyframe.discard(ws)
            self._clients_explicit_sync.discard(ws)
        finally:
            self._client_frame_inflight.discard(ws)

    def _dispatch_frame_to_clients(self, targets: List[WebSocketServerProtocol], frame_bytes: bytes) -> int:
        dispatched = 0
        for ws in targets:
            if ws in self._client_frame_inflight:
                continue
            tr = getattr(ws, "transport", None)
            if tr is not None and hasattr(tr, "get_write_buffer_size"):
                try:
                    if tr.get_write_buffer_size() > 262_144:
                        continue
                except Exception:
                    pass
            self._track_task(self._send_frame_guarded(ws, frame_bytes))
            dispatched += 1
        return dispatched

    async def _screen_stream_loop(self):
        """Streams desktop frames at deadline-paced adaptive framerates with lock-pause, backpressure, and idle wake."""
        fps_window_start = time.perf_counter()
        fps_frame_count = 0
        while self.is_running:
            frame_start = time.perf_counter()
            ready_clients = [
                ws for ws in list(self.authenticated_clients)
                if self._is_client_ready_for_stream(ws)
            ]
            if not ready_clients:
                self.capture_fps = 0.0
                if self.gui_state is not None:
                    self.gui_state.capture_fps = 0.0
                fps_window_start = frame_start
                fps_frame_count = 0
                ev = self._stream_wake_event
                if ev is not None:
                    ev.clear()
                    try:
                        await asyncio.wait_for(ev.wait(), timeout=0.5)
                    except asyncio.TimeoutError:
                        pass
                else:
                    await asyncio.sleep(0.5)
                continue

            now_mono = time.monotonic()
            if (now_mono - self._lock_check_cache[0]) >= 0.5:
                self._lock_check_cache = (now_mono, self._is_workstation_locked())
            if self._lock_check_cache[1]:
                self.capture_fps = 0.0
                if self.gui_state is not None:
                    self.gui_state.capture_fps = 0.0
                await asyncio.sleep(0.6)
                continue

            ev = self._stream_wake_event
            if ev is not None:
                ev.clear()
            frame = await self.screen_pipeline.get_next_frame()
            now_mono = time.monotonic()
            if frame:
                fps_frame_count += 1
                now = time.perf_counter()
                elapsed = now - fps_window_start
                if elapsed >= 1.0:
                    self.capture_fps = round(fps_frame_count / elapsed, 1)
                    fps_window_start = now
                    fps_frame_count = 0
                    if self.gui_state is not None:
                        self.gui_state.capture_fps = self.capture_fps

                if self.gui_state is not None:
                    with self.gui_state.lock:
                        self.gui_state.frames_broadcast += 1

                self._dispatch_frame_to_clients(ready_clients, frame)
            else:
                sync_targets = [
                    ws for ws in ready_clients
                    if ws in self._clients_need_keyframe
                    and (
                        ws in self._clients_explicit_sync
                        or (now_mono - self._client_auth_ts.get(ws, 0.0)) >= 0.15
                    )
                ]
                if sync_targets:
                    cached_frame = getattr(self.screen_pipeline, "_last_encoded_frame", None)
                    if cached_frame:
                        self._dispatch_frame_to_clients(sync_targets, cached_frame)
                    else:
                        self.screen_pipeline.force_keyframe = True
                        self.screen_pipeline.consecutive_static = 0

            if self.screen_pipeline.consecutive_static >= 1:
                ev = self._stream_wake_event
                if ev is not None:
                    if not ev.is_set():
                        try:
                            await asyncio.wait_for(ev.wait(), timeout=0.45)
                        except asyncio.TimeoutError:
                            pass
                else:
                    await asyncio.sleep(0.45)
            else:
                target_fps = max(5, min(60, int(getattr(self.screen_pipeline, "target_fps", self.target_fps) or 60)))
                work_dt = time.perf_counter() - frame_start
                sleep_dt = max(0.001, (1.0 / float(target_fps)) - work_dt)
                await asyncio.sleep(sleep_dt)

    def _get_primary_mac(self) -> str:
        cached = getattr(self, "_cached_mac", None)
        if cached:
            return cached
        mac_val = ""
        try:
            if psutil is not None:
                local_ip = self._get_local_ip()
                stats = psutil.net_if_stats()
                addrs = psutil.net_if_addrs()
                af_link = getattr(psutil, "AF_LINK", getattr(socket, "AF_PACKET", None))
                for if_name, if_addrs in addrs.items():
                    if if_name in stats and not stats[if_name].isup:
                        continue
                    has_local_ip = any(a.family == socket.AF_INET and a.address == local_ip for a in if_addrs)
                    if has_local_ip and af_link is not None:
                        for a in if_addrs:
                            if a.family == af_link and a.address:
                                cand = a.address.replace("-", ":").upper()
                                if cand not in ("00:00:00:00:00:00", "FF:FF:FF:FF:FF:FF"):
                                    mac_val = cand
                                    break
                    if mac_val:
                        break
        except Exception:
            pass
        self._cached_mac = mac_val
        return mac_val

    async def _telemetry_heartbeat_loop(self):
        """Periodically dispatches hardware CPU/RAM/Disk/FPS telemetry with monotonic seq."""
        idle_seconds = 0
        while self.is_running:
            await asyncio.sleep(2.0)
            if not self.authenticated_clients:
                try:
                    cpu_chk = psutil.cpu_percent(interval=None) if psutil else 0.0
                    if cpu_chk < 5.0:
                        idle_seconds += 2
                        if idle_seconds % 300 == 0:
                            logger.info("Smart Power Sentinel: Host idle for %ds (CPU: %.1f%%).", idle_seconds, cpu_chk)
                    else:
                        idle_seconds = 0
                except Exception:
                    pass
                continue

            idle_seconds = 0
            try:
                cpu = psutil.cpu_percent(interval=None) if psutil else 0.0
                cpu_cores = psutil.cpu_count(logical=True) if psutil else (os.cpu_count() or 1)
                if psutil:
                    vm = psutil.virtual_memory()
                    ram = round(float(vm.percent), 1)
                    ram_used_gb = round(float(vm.used) / (1024 ** 3), 2)
                    ram_total_gb = round(float(vm.total) / (1024 ** 3), 2)
                    now_disk_mono = time.monotonic()
                    if (now_disk_mono - self._disk_pct_cache[0]) >= 10.0 or self._disk_pct_cache[0] == 0.0:
                        try:
                            root_disk = os.path.abspath(os.sep)
                            disk_pct = round(float(psutil.disk_usage(root_disk).percent), 1)
                        except Exception:
                            disk_pct = 0.0
                        self._disk_pct_cache = (now_disk_mono, disk_pct)
                    else:
                        disk_pct = self._disk_pct_cache[1]
                else:
                    ram = 0.0
                    ram_used_gb = 0.0
                    ram_total_gb = 0.0
                    disk_pct = 0.0
                telemetry = {
                    "hostname": self._hostname,
                    "cpu_percent": round(float(cpu), 1),
                    "cpu_cores": int(cpu_cores or 1),
                    "ram_percent": ram,
                    "ram_used_gb": ram_used_gb,
                    "ram_total_gb": ram_total_gb,
                    "disk_percent": disk_pct,
                    "capture_fps": self.capture_fps,
                    "os": self._os_name,
                    "version": "0.80.0",
                    "protocol": "CST/3.0",
                    "local_ip": self._get_local_ip(),
                    "mac": self._get_primary_mac(),
                    "port": self.port,
                    "uptime_sec": int(max(0.0, time.time() - self._start_time)),
                    "view_only_mode": self.view_only_mode,
                    "require_hitl_approval": self.require_hitl_approval,
                    "clipboard_sync_allowed": self.clipboard_sync_allowed,
                    "active_monitor": self.screen_pipeline.monitor_index,
                    "connected_clients_count": len(self.authenticated_clients),
                    "status": "ready"
                }
                payload = json.dumps(telemetry).encode('utf-8')
                clients_snapshot = list(self.authenticated_clients)
                if clients_snapshot:
                    results = await asyncio.gather(
                        *(
                            self._send_encrypted_or_plain(
                                ws, OP_TELEMETRY, payload, seq=self._next_outbound_seq(ws)
                            )
                            for ws in clients_snapshot
                        ),
                        return_exceptions=True
                    )
                    for ws, res in zip(clients_snapshot, results):
                        if isinstance(res, Exception):
                            self.authenticated_clients.discard(ws)
            except Exception as e:
                logger.debug("Telemetry error: %s", e)

    async def _send_error(self, ws: WebSocketServerProtocol, msg: str):
        """Sends an OP_ERR frame to a client, encrypting if a vault session is established."""
        try:
            await self._send_encrypted_or_plain(
                ws, OP_ERR, msg.encode('utf-8'), seq=self._next_outbound_seq(ws)
            )
        except Exception:
            pass

    def _stop_tray_sync(self) -> None:
        """Signals system tray thread shutdown without racing icon creation."""
        self._tray_stop_event.set()
        with self._tray_lock:
            icon = self.tray_icon
            self.tray_icon = None
            tray_thread = self._tray_thread
            self._tray_thread = None
        if icon is not None:
            try:
                icon.stop()
            except Exception:
                pass
        if tray_thread is not None and tray_thread.is_alive() and threading.current_thread() is not tray_thread:
            tray_thread.join(timeout=1.0)

    def _close_vaults_and_approvals(self) -> None:
        """Resolves pending approvals and closes all client AEAD vaults safely."""
        for _, entry in list(self.pending_approvals.items()):
            fut = entry.get("future") if isinstance(entry, dict) else entry
            if fut and not fut.done():
                try:
                    fut.set_result(False)
                except Exception:
                    pass
        self.pending_approvals.clear()
        for v in list(self._client_vaults.values()):
            try:
                v.close()
            except Exception:
                pass
        self._client_vaults.clear()
        for pending in self._pending_pairings.values():
            if scrub_memory is not None and isinstance(pending[0], bytearray):
                scrub_memory(pending[0])
        self._pending_pairings.clear()
        self._client_secrets.clear()
        self._client_replay.clear()
        self._client_outbound_seq.clear()
        self._ws_write_locks.clear()
        self._clients_need_keyframe.clear()
        self._clients_explicit_sync.clear()
        self._client_auth_ts.clear()
        self._client_frame_inflight.clear()
        self._stream_paused_clients.clear()
        self.active_nonces.clear()

    def _close_sync_handles(self) -> None:
        """Releases file writers, screen encoder thread pools, monitor handles, and job objects."""
        if self.file_writer:
            try:
                self.file_writer.abort_all()
            except Exception:
                pass
        self.screen_pipeline.close()
        if self.multi_monitor:
            try:
                self.multi_monitor.close()
            except Exception:
                pass
        JOB_SUPERVISOR.close()

    async def _close_zeroconf_async(self) -> None:
        """Unregisters any active mDNS service and closes AsyncZeroconf sockets/timers."""
        zc = self.zeroconf
        info = self.service_info
        self.zeroconf = None
        self.service_info = None
        if zc is None:
            return
        if info is not None:
            try:
                await asyncio.wait_for(zc.async_unregister_service(info), timeout=2.0)
            except Exception:
                pass
        try:
            await asyncio.wait_for(zc.async_close(), timeout=2.0)
        except Exception:
            pass

    async def _cleanup_loop_resources_async(self) -> None:
        """Cancels background tasks, closes client sockets, awaits server close, and tears down mDNS."""
        tasks = [
            t for t in (list(self._background_tasks) + list(self._background_task_set))
            if not t.done()
        ]
        self._background_tasks.clear()
        self._background_task_set.clear()
        for t in tasks:
            t.cancel()
        if tasks:
            try:
                await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout=2.0)
            except Exception:
                pass

        clients = list(self.clients)
        self.clients.clear()
        self.authenticated_clients.clear()
        if clients:
            close_coros = [ws.close(code=1001, reason="Daemon shutting down") for ws in clients]
            try:
                await asyncio.wait_for(asyncio.gather(*close_coros, return_exceptions=True), timeout=1.5)
            except Exception:
                pass

        if self.chaos_shield is not None:
            for cid in list(self.chaos_shield.client_states.keys()):
                try:
                    await self.chaos_shield.cleanup_and_scrub(cid, reason="Daemon shutting down")
                except Exception:
                    pass

        self._close_vaults_and_approvals()

        server = self.server
        self.server = None
        if server is not None:
            try:
                server.close()
                await asyncio.wait_for(server.wait_closed(), timeout=2.0)
            except Exception:
                pass

        await self._close_zeroconf_async()

    async def async_stop(self) -> None:
        """Awaitable clean shutdown hook closing tasks, WebSockets, mDNS, tray, and hardware handles."""
        logger.info("Stopping AI NetController Host Agent Daemon (async)...")
        self.is_running = False
        self._stop_tray_sync()
        await self._cleanup_loop_resources_async()
        self._close_sync_handles()
        if self._owns_loop and self.loop and self.loop.is_running():
            self.loop.stop()

    def stop(self):
        """Clean shutdown hook closing background tasks, WebSockets, vaults, and hardware handles."""
        logger.info("Stopping AI NetController Host Agent Daemon...")
        self.is_running = False
        self._stop_tray_sync()

        def _cleanup_loop_resources_sync():
            for t in list(self._background_tasks) + list(self._background_task_set):
                if not t.done():
                    t.cancel()
            self._background_tasks.clear()
            self._background_task_set.clear()
            for ws in list(self.clients):
                try:
                    asyncio.create_task(ws.close(code=1001, reason="Daemon shutting down"))
                except Exception:
                    pass
            self.clients.clear()
            self.authenticated_clients.clear()
            self._close_vaults_and_approvals()
            server = self.server
            self.server = None
            if server:
                try:
                    server.close()
                except Exception:
                    pass
            if self.zeroconf is not None:
                try:
                    asyncio.create_task(self._close_zeroconf_async())
                except Exception:
                    pass
            if self._owns_loop and self.loop and self.loop.is_running():
                self.loop.stop()

        if self.loop and self.loop.is_running():
            if threading.get_ident() != self._loop_thread_id:
                try:
                    fut = asyncio.run_coroutine_threadsafe(self._cleanup_loop_resources_async(), self.loop)
                    fut.result(timeout=3.0)
                except Exception:
                    self.loop.call_soon_threadsafe(_cleanup_loop_resources_sync)
                self._close_sync_handles()
                if self._owns_loop and self.loop.is_running():
                    try:
                        self.loop.call_soon_threadsafe(self.loop.stop)
                    except Exception:
                        pass
                return
            _cleanup_loop_resources_sync()
            self._close_sync_handles()
            return

        _cleanup_loop_resources_sync()
        self._close_sync_handles()
        if self.zeroconf is not None:
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                try:
                    asyncio.run(self._close_zeroconf_async())
                except Exception:
                    pass

# =====================================================================
# ENTRY POINT
# =====================================================================
def main():
    import multiprocessing
    multiprocessing.freeze_support()

    # CLI Command Flags: Installer, Uninstaller & Shortcut creation
    if "--install" in sys.argv or "--setup" in sys.argv:
        if show_install_dialog:
            show_install_dialog()
        sys.exit(0)

    if "--uninstall" in sys.argv:
        if show_uninstall_dialog:
            show_uninstall_dialog()
        elif perform_full_uninstall:
            res = perform_full_uninstall(interactive=False)
            print(res.get("message", "Uninstalled successfully."))
        sys.exit(0)

    if "--create-shortcut" in sys.argv:
        if create_desktop_shortcut:
            _, msg1 = create_desktop_shortcut()
            _, msg2 = create_start_menu_shortcut() if create_start_menu_shortcut else (False, "")
            print(f"Desktop shortcut: {msg1}")
            print(f"Start Menu shortcut: {msg2}")
        sys.exit(0)

    cli_host: Optional[str] = None
    cli_port: Optional[int] = None
    argv = sys.argv[1:]
    for idx, arg in enumerate(argv):
        if arg == "--host" and idx + 1 < len(argv):
            cli_host = str(argv[idx + 1]).strip() or None
        elif arg == "--port" and idx + 1 < len(argv):
            try:
                p = int(argv[idx + 1])
                if 1 <= p <= 65535:
                    cli_port = p
            except ValueError:
                pass

    guard = None
    if SingleInstanceGuard:
        guard = SingleInstanceGuard()
        if not guard.acquire():
            logger.warning("Another instance of AI NetController Host Agent is already running. Existing window activated.")
            sys.exit(0)

    daemon = HostAgentDaemon(host=cli_host, port=cli_port)

    if check_port_available:
        is_avail, port_msg = check_port_available(daemon.port, daemon.host)
        if not is_avail:
            logger.warning("Port pre-flight notice: %s", port_msg)

    try:
        if "--headless" not in sys.argv:
            try:
                from agent_gui import HostDaemonState, HostDaemonDesktopGUI, HAS_TKINTER
                if HAS_TKINTER:
                    gui_state = HostDaemonState(host=daemon.host, port=daemon.port)
                    daemon.gui_state = gui_state
                    daemon._owns_loop = True
                    daemon._sync_gui_state_on_attach()
                    gui_state.on_disconnect_callback = daemon.force_disconnect_client

                    def _run_ws_daemon():
                        loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(loop)
                        try:
                            loop.run_until_complete(daemon.start())
                            loop.run_forever()
                        except Exception as exc:
                            logger.error("Async daemon loop error: %s", exc)
                        finally:
                            loop.close()

                    bg_thread = threading.Thread(target=_run_ws_daemon, daemon=True, name="AI_WsDaemonThread")
                    bg_thread.start()

                    gui = HostDaemonDesktopGUI(
                        state=gui_state,
                        on_disconnect_all=daemon.kill_all_tasks,
                        on_stop_daemon=daemon.stop,
                    )
                    gui.run()
                    return
            except Exception as e:
                logger.info("Desktop GUI fallback to console mode: %s", e)

        try:
            async def _run_headless():
                await daemon.start()
                while daemon.is_running:
                    await asyncio.sleep(1.0)
            asyncio.run(_run_headless())
        except (KeyboardInterrupt, SystemExit):
            daemon.stop()
            logger.info("Agent daemon terminated.")
    finally:
        if guard:
            guard.release()

if __name__ == "__main__":
    main()
