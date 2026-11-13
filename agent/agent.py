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
import os
import platform
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
from typing import Dict, List, Optional, Set, Tuple, Any, Callable

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
    from turbojpeg import TurboJPEG
except ImportError:
    TurboJPEG = None

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
    from crypto_vault import HostCryptoVault, SlidingWindowReplayProtector
except ImportError:
    try:
        from agent.crypto_vault import HostCryptoVault, SlidingWindowReplayProtector
    except ImportError:
        HostCryptoVault = None
        SlidingWindowReplayProtector = None

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
        show_uninstall_dialog,
        show_install_dialog,
        perform_full_uninstall,
        register_windows_uninstaller,
    )
except ImportError:
    try:
        from agent.windows_integration import (
            SingleInstanceGuard,
            check_port_available,
            create_desktop_shortcut,
            create_start_menu_shortcut,
            show_uninstall_dialog,
            show_install_dialog,
            perform_full_uninstall,
            register_windows_uninstaller,
        )
    except ImportError:
        SingleInstanceGuard = None
        check_port_available = None
        create_desktop_shortcut = None
        create_start_menu_shortcut = None
        show_uninstall_dialog = None
        show_install_dialog = None
        perform_full_uninstall = None
        register_windows_uninstaller = None

try:
    from icon_assets import get_icon_image
except ImportError:
    try:
        from agent.icon_assets import get_icon_image
    except ImportError:
        get_icon_image = lambda size=64: None

try:
    from daemon_config import (
        ensure_fresh_pin,
        get_config_path,
        get_config_revision,
        load_config,
        regenerate_pin,
        rotate_token,
        save_config,
    )
except ImportError:
    try:
        from agent.daemon_config import (
            ensure_fresh_pin,
            get_config_path,
            get_config_revision,
            load_config,
            regenerate_pin,
            rotate_token,
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
        rotate_token = lambda: f"ainet_{secrets.token_hex(24)}"
        regenerate_pin = lambda: f"{secrets.randbelow(900000) + 100000}"
        ensure_fresh_pin = lambda cfg=None: (regenerate_pin(), int(time.time()), True)

try:
    from tls_manager import build_server_ssl_context
except ImportError:
    try:
        from agent.tls_manager import build_server_ssl_context
    except ImportError:
        build_server_ssl_context = None  # type: ignore[assignment]

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
MAX_NONCE_AGE_SECONDS = 10.0  # Nonce expiry time for auth handshake
PIN_TTL_SECONDS = 900.0  # Pairing PIN expires after 15 minutes unless regenerated

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
        self.is_windows = platform.system() == "Windows"
        self.job_handle = None
        self.kernel32 = None

        if not self.is_windows:
            return

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
        if not self.is_windows or not self.kernel32:
            return
        if self.job_handle:
            try:
                self.kernel32.TerminateJobObject(self.job_handle, 1)
            except Exception as e:
                logger.error("Error terminating job object: %s", e)
            self.close()
        self.__init__(memory_limit_mb=getattr(self, "memory_limit_mb", 256))

    def close(self):
        """Clean up the job object handle upon agent termination."""
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
                ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
            except Exception:
                try:
                    ctypes.windll.user32.SetProcessDPIAware()
                except Exception:
                    pass
        self.target_res = target_resolution
        self.last_frame_hash = 0
        self.grid_hashes: List[int] = []
        self.consecutive_static = 0
        self.jpeg_quality = 50
        self.monitor_index = 1
        self.force_keyframe = False
        self.last_capture_rect: Optional[Tuple[int, int, int, int]] = None
        self.last_stream_size: Optional[Tuple[int, int]] = None
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ScreenEncoder")
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

    def set_target_resolution(self, width: int, height: int):
        """Dynamically adjusts target capture resolution matching mobile viewport (VIEWPORT_RESIZE)."""
        w = max(320, min(3840, width))
        h = max(240, min(2160, height))
        self.target_res = (w, h)
        self.last_stream_size = None
        self.force_keyframe = True
        logger.info(f"Screen grabber resolution dynamically matched to {w}x{h}")

    def set_quality(self, quality: int):
        """Clamps and updates JPEG stream compression quality (15..95)."""
        self.jpeg_quality = max(15, min(95, int(quality)))
        self.force_keyframe = True

    def _grab_and_compress(self) -> Tuple[Optional[bytes], bool]:
        """Worker function running inside ThreadPoolExecutor."""
        sct = self._get_mss()
        if not sct or not getattr(sct, "monitors", None):
            return None, False

        try:
            idx = self.monitor_index if 1 <= self.monitor_index < len(sct.monitors) else (1 if len(sct.monitors) > 1 else 0)
            monitor = sct.monitors[idx]
            raw_shot = sct.grab(monitor)
            raw_mv = memoryview(raw_shot.raw)

            force_send = self.force_keyframe
            if force_send:
                self.force_keyframe = False
                self.consecutive_static = 0

            # Fast Adler-32 sample hash using direct memoryview slice (zero whole-frame copy)
            current_hash = zlib.adler32(raw_mv[::2048].tobytes())
            is_static = (not force_send) and (current_hash == self.last_frame_hash)
            self.last_frame_hash = current_hash

            # Short-circuit idle static frames without recomputing 64-block CRC32 grid
            if is_static and self.consecutive_static > 3:
                return None, True

            w_shot, h_shot = int(raw_shot.width), int(raw_shot.height)
            self.last_capture_rect = (
                int(monitor.get("left", 0)),
                int(monitor.get("top", 0)),
                w_shot,
                h_shot,
            )

            # Compute 8x8 block grid CRC32 hashes directly over memoryview slices
            grid_rows, grid_cols = 8, 8
            block_h, block_w = max(1, h_shot // grid_rows), max(1, w_shot // grid_cols)
            new_grid = []
            for r in range(grid_rows):
                row_base = r * block_h * w_shot
                span = block_w * 4
                for c in range(grid_cols):
                    sample_offset = (row_base + c * block_w) * 4
                    new_grid.append(zlib.crc32(raw_mv[sample_offset:sample_offset + span]))

            grid_changed_count = sum(1 for o, n in zip(self.grid_hashes, new_grid) if o != n) if self.grid_hashes else 64
            self.grid_hashes = new_grid

            if (is_static or grid_changed_count == 0) and self.consecutive_static > 3:
                return None, True  # Screen hasn't changed; drop frame to save network bandwidth

            # Dynamic aspect-preserving downsampling + TurboJPEG SIMD acceleration
            if Image and (w_shot > self.target_res[0] or h_shot > self.target_res[1] or w_shot != self.target_res[0] or h_shot != self.target_res[1]):
                scale = min(self.target_res[0] / max(1, w_shot), self.target_res[1] / max(1, h_shot))
                out_w = max(1, int(round(w_shot * scale)))
                out_h = max(1, int(round(h_shot * scale)))
                if out_w != w_shot or out_h != h_shot:
                    img = Image.frombytes("RGB", raw_shot.size, raw_shot.bgra, "raw", "BGRX")
                    img = img.resize((out_w, out_h), Image.Resampling.BILINEAR)
                    self.last_stream_size = (out_w, out_h)
                    if self.turbo:
                        try:
                            import numpy as np
                            rgb_arr = np.asarray(img, dtype=np.uint8)
                            # pixel_format=0 (TJPF_RGB), jpeg_subsample=2 (TJSAMP_420), flags=1 (TJFLAG_FASTDCT)
                            return self.turbo.encode(
                                rgb_arr,
                                quality=self.jpeg_quality,
                                pixel_format=0,
                                jpeg_subsample=2,
                                flags=1,
                            ), False
                        except Exception:
                            pass
                    buf = getattr(self._local, 'bio_buf', None)
                    if buf is None:
                        buf = io.BytesIO()
                        self._local.bio_buf = buf
                    else:
                        buf.seek(0)
                        buf.truncate(0)
                    img.save(buf, format="JPEG", quality=self.jpeg_quality, optimize=False)
                    return buf.getvalue(), False

            self.last_stream_size = (w_shot, h_shot)

            # Zero-copy encode for 1:1 desktop resolution via libjpeg-turbo SIMD
            if self.turbo:
                try:
                    import numpy as np
                    bgra_arr = np.frombuffer(raw_shot.raw, dtype=np.uint8).reshape((raw_shot.height, raw_shot.width, 4))
                    encoded = self.turbo.encode(
                        bgra_arr,
                        quality=self.jpeg_quality,
                        pixel_format=3,  # TJPF_BGRX
                        jpeg_subsample=2,
                        flags=1,
                    )
                    return encoded, False
                except Exception as tj_err:
                    logger.debug(f"TurboJPEG encode fallback to Pillow: {tj_err}")
            if Image:
                # Optimized Pillow fallback with reusable thread-local BytesIO
                img = Image.frombytes("RGB", raw_shot.size, raw_shot.bgra, "raw", "BGRX")
                buf = getattr(self._local, 'bio_buf', None)
                if buf is None:
                    buf = io.BytesIO()
                    self._local.bio_buf = buf
                else:
                    buf.seek(0)
                    buf.truncate(0)
                img.save(buf, format="JPEG", quality=self.jpeg_quality, optimize=False)
                return buf.getvalue(), False
            return None, False
        except Exception as e:
            logger.debug(f"Frame capture error: {e}")
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
        """Shuts down executor and releases thread-local resources cleanly."""
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
        host: str = "0.0.0.0",
        port: int = 8765,
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
        self._background_tasks: List[asyncio.Task] = []
        self._background_task_set: Set[asyncio.Task] = set()
        self._owns_loop: bool = False
        self._start_time: float = time.time()
        self._pin_fail_count: int = 0
        self._pin_lockout_until_val: float = 0.0
        self._pin_failures_by_ip: Dict[str, List[float]] = {}
        self._pin_lockout_by_ip: Dict[str, float] = {}
        self._initial_env_secret: str = (
            os.environ.get("AI_AGENT_SECRET") or os.environ.get("CST_AGENT_SECRET") or ""
        ).strip()
        self._secret_rotated: bool = False
        self._last_cfg_mtime: float = self._safe_cfg_mtime()
        self._last_cfg_rev: int = int(get_config_revision())
        self._last_cfg_stat_ts: float = 0.0
        self.tls_fingerprint: str = ""

        # Persistent credentials & policies (CSPRNG only, never hardcoded fallbacks)
        self.pairing_pin: str = str(self.config.get("pairing_pin") or f"{secrets.randbelow(900000) + 100000}")
        self.pairing_token: str = str(self.config.get("pairing_token") or f"ainet_{secrets.token_hex(24)}")
        self.pin_issued_at: float = float(self.config.get("pin_issued_at") or time.time())
        self.view_only_mode: bool = bool(self.config.get("view_only_mode", False))
        self.require_hitl_approval: bool = bool(self.config.get("require_hitl_approval", True))
        self.clipboard_sync_allowed: bool = bool(self.config.get("clipboard_sync_allowed", True))
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
        self.is_paused: bool = False
        self.blacklisted_ips: Set[str] = self._extract_blacklisted_ips(self.config.get("blacklisted_devices"))
        if self.gui_state is not None:
            self._sync_gui_state_on_attach()

        # Per-connection nonce tracking: ws -> (nonce_bytes, timestamp)
        self.active_nonces: Dict[WebSocketServerProtocol, Tuple[bytes, float]] = {}
        self.screen_pipeline = AdaptiveScreenPipeline()
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
                os.environ.get("AI_DISABLE_TRAY") != "1" and _has_desktop_display()
            )
        else:
            self._enable_tray = bool(enable_tray)
        if enable_mdns is None:
            self._enable_mdns = os.environ.get("AI_DISABLE_MDNS") != "1"
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

    def _next_outbound_seq(self, ws: WebSocketServerProtocol) -> int:
        """Allocates a strictly monotonic 32-bit sequence number (>= 1) per client connection."""
        nxt = ((self._client_outbound_seq.get(ws, 0) + 1) & 0xFFFFFFFF) or 1
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
                    self.require_hitl_approval = bool(cfg.get("require_hitl_approval", self.require_hitl_approval))
                    self.clipboard_sync_allowed = bool(cfg.get("clipboard_sync_allowed", self.clipboard_sync_allowed))
                    self.auto_ban_intrusion = bool(cfg.get("auto_ban_intrusion", self.auto_ban_intrusion))
                    self.subnet_geofence_only = bool(cfg.get("subnet_geofence_only", self.subnet_geofence_only))
                    self.require_hmac_auth = bool(cfg.get("require_hmac_auth", self.require_hmac_auth))
                    self.require_aead = bool(cfg.get("require_aead", self.require_aead))
                    self.require_tls = bool(cfg.get("require_tls", self.require_tls))
                    self.security_profile = str(cfg.get("security_profile", self.security_profile))
                    if isinstance(cfg.get("allowed_origins"), list):
                        self.allowed_origins = {str(o).strip().lower() for o in cfg["allowed_origins"] if str(o).strip()}
                    if "blacklisted_devices" in cfg:
                        self.blacklisted_ips = self._extract_blacklisted_ips(cfg.get("blacklisted_devices"))
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
            self.auto_ban_intrusion = bool(getattr(self.gui_state, "auto_ban_intrusion", self.auto_ban_intrusion))
            self.subnet_geofence_only = bool(getattr(self.gui_state, "subnet_geofence_only", self.subnet_geofence_only))
            self.require_hmac_auth = bool(getattr(self.gui_state, "require_hmac_auth", self.require_hmac_auth))
            self.require_aead = bool(getattr(self.gui_state, "require_aead", self.require_aead))
            self.is_paused = bool(getattr(self.gui_state, "is_paused", False))
            gui_bl = getattr(self.gui_state, "blacklisted_devices", None)
            if gui_bl is not None:
                self.blacklisted_ips.update(self._extract_blacklisted_ips(gui_bl))
            unbanned = getattr(self.gui_state, "_unbanned_ips", None)
            if unbanned:
                with self.gui_state.lock:
                    to_unban = list(unbanned)
                    unbanned.clear()
                for uip in to_unban:
                    self.blacklisted_ips.discard(uip)
                    self._failed_auth_attempts.pop(uip, None)
            if hasattr(self.gui_state, "tls_fingerprint"):
                self.gui_state.tls_fingerprint = self.tls_fingerprint
            if hasattr(self.gui_state, "tls_enabled"):
                self.gui_state.tls_enabled = bool(self.tls_fingerprint)

    @property
    def _pin_lockout_until(self) -> float:
        return self._pin_lockout_until_val

    @_pin_lockout_until.setter
    def _pin_lockout_until(self, value: float) -> None:
        self._pin_lockout_until_val = float(value)
        if self._pin_lockout_until_val <= 0.0:
            self._pin_failures_by_ip.clear()
            self._pin_lockout_by_ip.clear()

    def _is_client_blacklisted(self, client_ip: str) -> bool:
        if client_ip in self.blacklisted_ips:
            return True
        if self.gui_state is not None and hasattr(self.gui_state, "is_ip_blacklisted"):
            return bool(self.gui_state.is_ip_blacklisted(client_ip))
        return False

    async def _ws_send(self, ws: WebSocketServerProtocol, data: Any) -> None:
        """Serializes concurrent writes onto a WebSocket transport cleanly."""
        lock = self._ws_write_locks.setdefault(ws, asyncio.Lock())
        async with lock:
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
            logger.warning("AUTO-BAN TRIGGERED: Blacklisted %s due to 3+ failed auth attempts.", client_ip)

    def _get_current_secret(self) -> bytes:
        """Returns configured persistent/env strong token (never a static hardcoded string)."""
        self._refresh_runtime_policies()
        env_sec = (os.environ.get("AI_AGENT_SECRET") or os.environ.get("CST_AGENT_SECRET") or "").strip()
        if env_sec:
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
        """Bootstraps mDNS advertisement, system tray icon, and WebSocket server."""
        self.loop = asyncio.get_running_loop()
        self._loop_thread_id = threading.get_ident()
        logger.info("Initializing AI NetController Host Agent & OS Bridge (v0.51.0)...")
        await self._start_mdns()
        self._start_system_tray()

        ssl_ctx = None
        cert_file = os.environ.get("AI_TLS_CERT") or os.environ.get("SSL_CERT_FILE")
        key_file = os.environ.get("AI_TLS_KEY") or os.environ.get("SSL_KEY_FILE")
        auto_tls = self.require_tls or (os.environ.get("AI_TLS_AUTO") == "1")
        if cert_file and key_file and os.path.isfile(cert_file) and os.path.isfile(key_file):
            import ssl
            ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ssl_ctx.minimum_version = ssl.TLSVersion.TLSv1_2
            ssl_ctx.load_cert_chain(cert_file, key_file)
            logger.info("TLS enabled for WebSocket transport (%s)", cert_file)
        elif auto_tls and build_server_ssl_context is not None:
            try:
                ssl_ctx, fp = build_server_ssl_context()
                self.tls_fingerprint = fp
                if self.gui_state is not None:
                    self.gui_state.tls_fingerprint = fp
                    self.gui_state.tls_enabled = True
                logger.info("Auto-generated ECDSA SAN TLS context active (fp=%s...)", fp[:16])
            except Exception as tls_err:
                logger.warning("Failed to initialize auto-TLS context, falling back cleanly: %s", tls_err)

        if websockets is not None:
            self.server = await websockets.serve(
                self.handle_connection,
                self.host,
                self.port,
                ssl=ssl_ctx,
                max_size=MAX_PAYLOAD_SIZE,
                ping_interval=20,
                ping_timeout=15
            )
            proto = "wss" if ssl_ctx else "ws"
            logger.info(f"Binary WebSocket Listener active on {proto}://{self.host}:{self.port}")
        else:
            self.server = await asyncio.start_server(
                self._handle_stdlib_ws_client,
                self.host,
                self.port,
                ssl=ssl_ctx,
            )
            logger.info(f"Stdlib RFC-6455 WebSocket Listener active on ws://{self.host}:{self.port}")

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
            if origin_hdr and not self._is_origin_allowed(origin_hdr):
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
                    while not self._closed:
                        try:
                            head = await reader.readexactly(2)
                            b1, b2 = head[0], head[1]
                            opcode = b1 & 0x0F
                            is_masked = (b2 & 0x80) != 0
                            length = b2 & 0x7F
                            if length == 126:
                                length = struct.unpack("!H", await reader.readexactly(2))[0]
                            elif length == 127:
                                length = struct.unpack("!Q", await reader.readexactly(8))[0]
                            if length > MAX_PAYLOAD_SIZE:
                                raise ValueError(f"Frame payload length {length} exceeds MAX_PAYLOAD_SIZE")
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
                            if opcode == 0x01:
                                return raw_payload.decode('utf-8', errors='replace')
                            return raw_payload
                        except Exception:
                            raise StopAsyncIteration
                    raise StopAsyncIteration

            adapter = _StdlibWsAdapter()
            await self.handle_connection(adapter)
        except Exception:
            try:
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
                'version': '0.51.0',
                'ai': 'ollama-bridge',
                'hostname': hostname,
                'tls': '1' if self.tls_fingerprint else '0',
                'fp': self.tls_fingerprint[:16] if self.tls_fingerprint else '',
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
        """Determines primary non-loopback LAN IPv4 passively (no external 8.8.8.8 probe)."""
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
                    return preferred[0]
                if secondary:
                    return secondary[0]
        except Exception:
            pass
        try:
            for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                ip = info[4][0]
                if ip and not ip.startswith("127.") and not ip.startswith("169.254."):
                    return ip
        except Exception:
            pass
        return "127.0.0.1"

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

            def _add_desktop_shortcut():
                if create_desktop_shortcut:
                    ok1, msg1 = create_desktop_shortcut()
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
                pystray.MenuItem("Install AI NetController to PC...", _install),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("AI NetController Beta 0.51.00", lambda: None, enabled=False),
                pystray.MenuItem(lambda text: f"Active Clients: {len(self.authenticated_clients)}", lambda: None, enabled=False),
                pystray.MenuItem(lambda text: f"Port: {self.port} (WebSocket)", lambda: None, enabled=False),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem(lambda text: "Resume Daemon" if self.is_paused else "Pause Daemon", _toggle_pause),
                pystray.MenuItem(lambda text: "Allow Remote Input" if self.view_only_mode else "Lock Input (View-Only)", _toggle_view_only),
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
            for approval_id, entry in list(self.pending_approvals.items()):
                fut = entry.get("future") if isinstance(entry, dict) else entry
                if fut and not fut.done():
                    fut.set_result(False)
            self.pending_approvals.clear()

            for ws in list(self.clients):
                try:
                    asyncio.create_task(ws.close(code=1008, reason="Emergency panic disconnect"))
                except Exception:
                    pass
            self.authenticated_clients.clear()
            for v in self._client_vaults.values():
                try:
                    v.close()
                except Exception:
                    pass
            self._client_vaults.clear()
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
                    (c for c in self.gui_state.connected_clients if c.get("id") == cid or c.get("ip") == p_ip),
                    None,
                )
                if client_entry and not client_entry.get("inputAllowed", True):
                    return False
        return True

    def _register_authenticated_client(self, ws: WebSocketServerProtocol, client_ip: str, resolved_client_id: str, label: str) -> None:
        self.authenticated_clients.add(ws)
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
                        "inputAllowed": not self.view_only_mode,
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

        self.clients.add(ws)
        self._ws_write_locks[ws] = asyncio.Lock()
        logger.info("Client connected from %s", client_id)

        if self.chaos_shield:
            self.chaos_shield.register_client(client_id, lambda: asyncio.create_task(ws.close(code=1008)))
            self.chaos_shield.transition_state(client_id, ConnectionState.AUTH_PENDING)

        nonce = secrets.token_bytes(16)
        self.active_nonces[ws] = (nonce, time.time())
        await self._ws_send(ws, pack_packet(OP_AUTH, nonce, seq=0))

        try:
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
                    try:
                        text_data = json.loads(message)
                        action = str(text_data.get("action") or text_data.get("event") or "").upper()
                        if action == "PING":
                            await self._ws_send(ws, json.dumps({
                                "event": "PONG",
                                "action": "PONG",
                                "timestamp": time.time(),
                                "seq": text_data.get("seq", 0)
                            }))
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
                            elif not (self.require_hmac_auth and action != "PAIR"):
                                matched_token = next(
                                    (vt for vt in valid_tokens if candidate_token and hmac.compare_digest(candidate_token, vt)),
                                    None,
                                )
                            token_ok = matched_token is not None

                            # Allow 6-digit PIN strictly for explicit PAIR flow within PIN TTL & per-IP/global lockout guard
                            pin_ok = False
                            if action == "PAIR" and not token_ok:
                                ip_fails = [t for t in self._pin_failures_by_ip.get(client_ip, []) if now_ts - t < 60.0]
                                self._pin_failures_by_ip[client_ip] = ip_fails
                                ip_locked = now_ts < self._pin_lockout_by_ip.get(client_ip, 0.0)
                                if now_ts < self._pin_lockout_until_val or ip_locked or len(ip_fails) >= 5:
                                    pin_ok = False
                                else:
                                    pin_ok = self._is_valid_pairing_pin(candidate_token)
                                    if pin_ok:
                                        self._pin_fail_count = 0
                                        self._pin_failures_by_ip.pop(client_ip, None)
                                        self._pin_lockout_by_ip.pop(client_ip, None)
                                    else:
                                        self._pin_fail_count += 1
                                        ip_fails.append(now_ts)
                                        self._pin_failures_by_ip[client_ip] = ip_fails
                                        if len(ip_fails) >= 5:
                                            self._pin_lockout_by_ip[client_ip] = now_ts + 60.0
                                            logger.warning("PAIR PIN rate-limit lockout triggered for 60s (%s)", client_ip)

                            if token_ok or pin_ok:
                                label = str(text_data.get("device") or f"Remote Client ({client_ip})")
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
                            if action == "EXECUTE_PROMPT":
                                cmd_str = str(text_data.get("prompt") or text_data.get("command") or "").strip()
                                cmd_id = str(text_data.get("command_id") or f"cmd-{int(time.time() * 1000)}")
                                if cmd_str:
                                    self._track_task(self._process_json_shell_command(ws, cmd_str, cmd_id))
                                continue
                            elif action == "APPROVAL_RESPONSE":
                                await self._process_hitl_response(message.encode("utf-8"), ws)
                                continue
                            elif action in ("PANIC_KILL_ALL", "PANIC"):
                                self.kill_all_tasks()
                                await self._ws_send(ws, json.dumps({
                                    "event": "PANIC_ACK",
                                    "status": "terminated",
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
                    filtered = await self.chaos_shield.filter_incoming_packet(
                        client_id,
                        message,
                        on_keyframe_request=lambda _cid: self._trigger_keyframe_resync(),
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
                    elif opcode not in (OP_AUTH, OP_PING):
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

                if opcode not in (OP_PING, OP_AUTH, OP_ERR) and (self.require_aead or self.security_profile == "strict"):
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
                    await self._ws_send(ws, pack_packet(OP_PING, b'PONG', seq=seq))

                elif opcode == OP_AUTH:
                    vault = self._client_vaults.get(ws)
                    if vault is None and HostCryptoVault is not None and payload == b"INIT_ECDH_VAULT":
                        secrets_list = self._get_valid_secrets()
                        vault_psk = self._client_secrets.get(ws) or (secrets_list[0] if secrets_list else None)
                        if vault_psk:
                            vault = HostCryptoVault(vault_psk)
                            self._client_vaults[ws] = vault
                            await self._ws_send(ws, pack_packet(OP_AUTH, vault.create_handshake_challenge(), seq=seq, flags=0x01))
                            continue
                    if vault is not None and not vault.is_established and len(payload) >= 80:
                        if vault.complete_handshake(payload):
                            await self._ws_send(ws, pack_packet(OP_AUTH, b'OK_ECDH_VAULT', seq=seq, flags=0x01))
                        else:
                            vault.close()
                            self._client_vaults.pop(ws, None)
                            await self._send_error(ws, "ECDH vault handshake verification failed")
                        continue
                    await self._ws_send(ws, pack_packet(OP_AUTH, b'OK_AUTHENTICATED', seq=seq))

                elif opcode == OP_SHELL:
                    self._track_task(self._process_shell_command(ws, payload, seq))

                elif opcode == OP_HITL:
                    await self._process_hitl_response(payload, ws)

                elif opcode == OP_CLIP:
                    await self._process_clipboard(ws, payload)

                elif opcode == OP_INPUT:
                    await self._process_virtual_input(payload, ws)

                elif opcode == OP_AUDIO:
                    await self._process_audio_control(payload, ws)

                elif opcode == OP_VIEWPORT_RESIZE:
                    await self._process_viewport_resize(payload)

                elif opcode == OP_LLM_STREAM:
                    self._track_task(self._process_ollama_query(ws, payload, seq))

                elif opcode == OP_FILE_TRANSFER:
                    if not self._is_client_input_allowed(ws):
                        await self._send_error(ws, "File upload blocked while View-Only Mode or input lock is active")
                    elif self.file_writer:
                        ack_packet = await self.file_writer.handle_packet_async(payload)
                        unpacked_ack = unpack_packet(ack_packet)
                        ack_payload = unpacked_ack[5] if unpacked_ack else ack_packet[HEADER_SIZE:]
                        await self._send_encrypted_or_plain(
                            ws, OP_FILE_TRANSFER, ack_payload, seq=self._next_outbound_seq(ws)
                        )
                    else:
                        await self._send_error(ws, "File transfer service inactive")

                elif opcode == OP_DISPLAY_ENUM:
                    await self._process_display_enum(ws, payload, seq)

                elif opcode == OP_FRAME_SYNC:
                    self._trigger_keyframe_resync()

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
            if self.auto_lock_on_disconnect and not self.authenticated_clients and platform.system() == "Windows":
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

    def _trigger_keyframe_resync(self) -> None:
        self.screen_pipeline.force_keyframe = True
        self.screen_pipeline.consecutive_static = 0

    async def _send_encrypted_or_plain(self, ws: WebSocketServerProtocol, opcode: int, payload: bytes, seq: int = 0) -> None:
        if seq <= 0 and opcode not in (OP_AUTH, OP_PING):
            seq = self._next_outbound_seq(ws)
        vault = self._client_vaults.get(ws)
        if vault is not None and vault.is_established:
            # AAD binds the exact outer 12-byte wire header (wire_len = len(payload) + 12B nonce + 16B Poly1305 tag)
            wire_len = len(payload) + 28
            aad = _HEADER_STRUCT.pack(MAGIC, opcode, 0x02, seq, wire_len)
            enc_payload, _ = vault.encrypt_frame(payload, aad=aad)
            await self._ws_send(ws, pack_packet(opcode, enc_payload, seq=seq, flags=0x02))
            return
        await self._ws_send(ws, pack_packet(opcode, payload, seq=seq))

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
            await self._ws_send(ws, json.dumps({
                "event": "EXECUTION_RESULT",
                "command_id": command_id,
                "status": "success" if exec_res["success"] else "error",
                "exit_code": exec_res["exit_code"],
                "output": exec_res["stdout"] if exec_res["stdout"] else exec_res["stderr"],
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
            await self._send_encrypted_or_plain(ws, OP_SHELL, resp, seq=self._next_outbound_seq(ws))
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
                await self._send_encrypted_or_plain(ws, OP_SHELL, resp, seq=self._next_outbound_seq(ws))
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
                await self._send_encrypted_or_plain(ws, OP_SHELL, resp, seq=self._next_outbound_seq(ws))
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
            result = {
                "event": "EXECUTION_RESULT",
                "command_id": f"cmd-{seq or int(time.time() * 1000)}",
                "status": "success" if exec_res["success"] else "error",
                "exit_code": exec_res["exit_code"],
                "output": exec_res["stdout"] if exec_res["stdout"] else exec_res["stderr"],
                "command": cmd_str,
                "risk_level": exec_res.get("risk_level", "SAFE"),
                "is_terminal": True,
                "timestamp": int(time.time())
            }
            await self._send_encrypted_or_plain(
                ws, OP_SHELL, json.dumps(result).encode('utf-8'), seq=self._next_outbound_seq(ws)
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
            await self._send_encrypted_or_plain(ws, OP_SHELL, err_msg, seq=self._next_outbound_seq(ws))

    async def _process_hitl_response(self, payload: bytes, ws: Optional[WebSocketServerProtocol] = None):
        """Handles HITL challenge responses with session binding and secret HMAC proof."""
        try:
            data = json.loads(payload.decode('utf-8'))
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
            if host_clip:
                await self._send_encrypted_or_plain(
                    ws, OP_CLIP, host_clip.encode('utf-8'), seq=self._next_outbound_seq(ws)
                )
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

            if len(payload) == 6 and not payload.startswith(b'{'):
                event_type, dx, dy, btn_code = struct.unpack("!BhhB", payload)
                btn = "right" if btn_code == 2 else "left"
                def _exec_bin_input():
                    if event_type == 1:
                        pyautogui.moveRel(dx, dy, _pause=False)
                    elif event_type == 2:
                        pyautogui.click(button=btn, _pause=False)
                    elif event_type == 3:
                        pyautogui.scroll(dy, _pause=False)
                await loop.run_in_executor(None, _exec_bin_input)
                return

            data = json.loads(payload.decode('utf-8'))
            raw_action = str(data.get("action") or "").lower()
            if raw_action in ("", "input_event", "pc_control", "remote_input"):
                action = str(data.get("kind") or data.get("type") or raw_action).lower()
            else:
                action = raw_action

            def _map_xy(raw_x: Any, raw_y: Any) -> Tuple[int, int]:
                rx, ry = float(raw_x), float(raw_y)
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

            def _exec_json_input():
                if action == "media":
                    media_cmd = str(data.get("command") or "").lower()
                    if media_cmd:
                        self._execute_media_command(media_cmd, steps=1)
                    return
                if action == "move":
                    dx = float(data.get("dx", 0))
                    dy = float(data.get("dy", 0))
                    pyautogui.moveRel(dx, dy, _pause=False)
                elif action in ("move_to", "mouse_move"):
                    x, y = _map_xy(data.get("x", 0), data.get("y", 0))
                    pyautogui.moveTo(x, y, _pause=False)
                elif action in ("click", "mouse_click"):
                    btn = str(data.get("button", "left")).lower()
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
                    btn = str(data.get("button", "left")).lower()
                    pyautogui.click(x=x, y=y, button=btn, _pause=False)
                elif action in ("double_click", "mouse_double_click"):
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
                    dy = int(data.get("dy", 0))
                    x = data.get("x")
                    y = data.get("y")
                    if x is not None and y is not None:
                        tx, ty = _map_xy(x, y)
                        pyautogui.scroll(dy, x=tx, y=ty, _pause=False)
                    else:
                        pyautogui.scroll(dy, _pause=False)
                elif action == "scroll_at":
                    x, y = _map_xy(data.get("x", 0), data.get("y", 0))
                    dy = int(data.get("dy", 0))
                    pyautogui.scroll(dy, x=x, y=y, _pause=False)
                elif action in ("type", "type_text", "keyboard_type"):
                    raw_text = str(data.get("text", ""))[:2048]
                    text = "".join(ch for ch in raw_text if ord(ch) >= 32 or ch in ("\n", "\t"))
                    press_enter = bool(data.get("press_enter", data.get("pressEnter", False)))
                    if text:
                        pyautogui.write(text, _pause=False)
                    if press_enter:
                        pyautogui.press('enter', _pause=False)
                elif action in ("key", "key_press"):
                    key = str(data.get("key", "")).lower().strip()
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
                    key_set = set(keys)
                    blocked_combos = (
                        {"ctrl", "alt", "del"},
                        {"ctrl", "alt", "delete"},
                        {"ctrl", "shift", "esc"},
                    )
                    if key_set in blocked_combos:
                        return
                    valid_keyset = set(getattr(pyautogui, "KEYBOARD_KEYS", []))
                    if keys and (not valid_keyset or all(k in valid_keyset for k in keys)):
                        pyautogui.hotkey(*keys, _pause=False)

            await loop.run_in_executor(None, _exec_json_input)
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
        if self.multi_monitor:
            self.multi_monitor.switch_monitor(clamped)

    async def _process_viewport_resize(self, payload: bytes):
        """
        Handles 0x0A (VIEWPORT_RESIZE) control packet cleanly for both JSON and 8-byte binary structs.
        """
        try:
            stripped = payload.lstrip()
            if stripped.startswith(b'{'):
                data = json.loads(stripped.decode('utf-8'))
                if "width" in data and "height" in data:
                    self.screen_pipeline.set_target_resolution(int(data["width"]), int(data["height"]))
                if "quality" in data:
                    self.screen_pipeline.set_quality(int(data["quality"]))
                if "monitor" in data:
                    self._switch_active_monitor(int(data["monitor"]))
            elif len(payload) == 8:
                width, height = struct.unpack('!II', payload)
                self.screen_pipeline.set_target_resolution(width, height)
        except Exception as e:
            logger.debug("Viewport resize decode error: %s", e)

    async def _process_display_enum(self, ws: WebSocketServerProtocol, payload: bytes, seq: int):
        """Opcode 0x0D: Enumerates monitors or switches active capture monitor."""
        try:
            if payload:
                stripped = payload.lstrip()
                if stripped.startswith(b'{'):
                    data = json.loads(stripped.decode('utf-8'))
                    if "monitor" in data:
                        self._switch_active_monitor(int(data["monitor"]))
                elif len(payload) == 1:
                    self._switch_active_monitor(payload[0])
            monitors = self.multi_monitor.enumerate_monitors() if self.multi_monitor else [
                {"index": 1, "width": self.screen_pipeline.target_res[0], "height": self.screen_pipeline.target_res[1], "left": 0, "top": 0, "label": "Display 1"}
            ]
            resp = json.dumps({"monitors": monitors, "active": self.screen_pipeline.monitor_index}).encode("utf-8")
            await self._send_encrypted_or_plain(
                ws, OP_DISPLAY_ENUM, resp, seq=self._next_outbound_seq(ws)
            )
        except Exception as exc:
            await self._send_error(ws, f"Display enumeration error: {exc}")

    # =================================================================
    # LOCAL OLLAMA AI STREAMING BRIDGE
    # =================================================================
    async def _process_ollama_query(self, ws: WebSocketServerProtocol, payload: bytes, seq: int):
        """Connects to local Ollama server and streams chunks back cleanly."""
        import urllib.request
        from urllib.parse import urlparse
        try:
            req_data = json.loads(payload.decode('utf-8'))
            model = str(req_data.get("model") or "qwen2.5-coder:latest").strip()
            prompt = str(req_data.get("prompt") or "")

            base_url = (os.environ.get("OLLAMA_HOST") or "http://127.0.0.1:11434").rstrip("/")
            parsed_url = urlparse(base_url)
            if parsed_url.scheme not in ("http", "https") or (parsed_url.hostname or "").lower() not in ("127.0.0.1", "localhost", "::1"):
                base_url = "http://127.0.0.1:11434"
            url = f"{base_url}/api/generate"
            body = json.dumps({"model": model, "prompt": prompt, "stream": True}).encode('utf-8')
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})

            loop = asyncio.get_running_loop()

            def sync_stream():
                with urllib.request.urlopen(req, timeout=10.0) as resp:
                    for line in resp:
                        if not self.is_running:
                            break
                        if line:
                            chunk = json.loads(line.decode('utf-8'))
                            token = chunk.get("response", "")
                            if token:
                                send_fut = asyncio.run_coroutine_threadsafe(
                                    self._send_encrypted_or_plain(
                                        ws, OP_LLM_STREAM, token.encode('utf-8'), seq=self._next_outbound_seq(ws)
                                    ),
                                    loop
                                )
                                send_fut.result(timeout=5.0)
                            if chunk.get("done", False):
                                break

            await loop.run_in_executor(None, sync_stream)
        except Exception as e:
            err_json = json.dumps({"error": f"Ollama local bridge error: {e}"}).encode('utf-8')
            await self._send_encrypted_or_plain(
                ws, OP_LLM_STREAM, err_json, seq=self._next_outbound_seq(ws)
            )

    # =================================================================
    # STREAMING & HEARTBEAT BACKGROUND LOOPS
    # =================================================================
    @staticmethod
    def _is_workstation_locked() -> bool:
        """Fast Win32 desktop lock check so idle capture skips locked consoles."""
        if platform.system() != "Windows":
            return False
        try:
            u32 = ctypes.windll.user32
            h_desk = u32.OpenInputDesktop(0, False, 0x0001)
            if not h_desk:
                return True
            u32.CloseDesktop(h_desk)
            return False
        except Exception:
            return False

    async def _screen_stream_loop(self):
        """Streams desktop frames at adaptive framerates with transport backpressure & lock-pause."""
        fps_window_start = time.perf_counter()
        fps_frame_count = 0
        while self.is_running:
            if not self.authenticated_clients:
                self.capture_fps = 0.0
                if self.gui_state is not None:
                    self.gui_state.capture_fps = 0.0
                fps_window_start = time.perf_counter()
                fps_frame_count = 0
                await asyncio.sleep(0.5)
                continue

            if self._is_workstation_locked():
                self.capture_fps = 0.0
                if self.gui_state is not None:
                    self.gui_state.capture_fps = 0.0
                await asyncio.sleep(0.6)
                continue

            frame = await self.screen_pipeline.get_next_frame()
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

                clients_snapshot = []
                for ws in list(self.authenticated_clients):
                    transport = getattr(ws, "transport", None)
                    if transport is not None and hasattr(transport, "get_write_buffer_size"):
                        try:
                            if transport.get_write_buffer_size() > (2 * 1024 * 1024):
                                continue
                        except Exception:
                            pass
                    clients_snapshot.append(ws)
                if clients_snapshot:
                    results = await asyncio.gather(
                        *(
                            self._send_encrypted_or_plain(
                                ws, OP_FRAME, frame, seq=self._next_outbound_seq(ws)
                            )
                            for ws in clients_snapshot
                        ),
                        return_exceptions=True
                    )
                    for ws, res in zip(clients_snapshot, results):
                        if isinstance(res, Exception):
                            self.authenticated_clients.discard(ws)

            if self.screen_pipeline.consecutive_static > 2:
                await asyncio.sleep(0.5)
            else:
                await asyncio.sleep(0.016)  # ~60 FPS cap under active motion

    def _get_primary_mac(self) -> str:
        cached = getattr(self, "_cached_mac", None)
        if cached is not None:
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
                    try:
                        root_disk = os.path.abspath(os.sep)
                        disk_pct = round(float(psutil.disk_usage(root_disk).percent), 1)
                    except Exception:
                        disk_pct = 0.0
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
                    "version": "0.51.0",
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
        self._client_secrets.clear()
        self._client_replay.clear()
        self._client_outbound_seq.clear()
        self._ws_write_locks.clear()

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
            if self.server:
                try:
                    self.server.close()
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

    # CLI Command Flags: Uninstaller & Shortcut creation
    if "--uninstall" in sys.argv:
        if show_uninstall_dialog:
            show_uninstall_dialog()
        elif perform_full_uninstall:
            res = perform_full_uninstall(interactive=False)
            print(res.get("message", "Uninstalled successfully."))
        sys.exit(0)

    if "--create-shortcut" in sys.argv:
        if create_desktop_shortcut:
            ok1, msg1 = create_desktop_shortcut()
            ok2, msg2 = create_start_menu_shortcut() if create_start_menu_shortcut else (False, "")
            print(f"Desktop shortcut: {msg1}")
            print(f"Start Menu shortcut: {msg2}")
        sys.exit(0)

    guard = None
    if SingleInstanceGuard:
        guard = SingleInstanceGuard()
        if not guard.acquire():
            logger.warning("Another instance of AI NetController Host Agent is already running. Existing window activated.")
            sys.exit(0)

    daemon = HostAgentDaemon()

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
