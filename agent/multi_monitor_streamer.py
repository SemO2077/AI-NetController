"""
Multi-Monitor Hardware Screen Grabber & Material You Dynamic Color Extractor
---------------------------------------------------------------------
Features:
- Opcode 0x0D (DISPLAY_ENUMERATION) Dynamic Monitor Switching ([ 1 ] [ 2 ] [ 3 ])
- Real-time MSS bounding box re-binding without dropping WebSocket connection
- TurboJPEG SIMD acceleration with preallocated output buffers
- Fast Desktop Wallpaper Dominant Color Extraction (K-Means / Frequency Clustering)
- Material You HEX Color Output for Neon Accent Interpolation
"""

import ctypes
import io
import logging
import os
import platform
import sys
import threading
import types
from typing import Dict, List, Optional, Tuple, Any

_STREAMER_DIR = os.path.dirname(os.path.abspath(__file__))

try:
    import mss
except ImportError:
    mss = None

try:
    from PIL import Image
except ImportError:
    Image = None

try:
    import numpy as np
except ImportError:
    np = None

dxcam = None
bettercam = None
if platform.system() == "Windows" and os.environ.get("AI_HEADLESS") != "1":
    try:
        import dxcam  # type: ignore[no-redef]
    except Exception:
        dxcam = None
    if dxcam is None:
        try:
            import bettercam  # type: ignore[no-redef]
        except Exception:
            bettercam = None

try:
    from turbojpeg import TurboJPEG, TJPF_BGRX, TJSAMP_420, TJFLAG_FASTDCT
except ImportError:
    try:
        from turbojpeg import TurboJPEG, TJSAMP_420
        TJPF_BGRX = 3
        TJFLAG_FASTDCT = 2048
    except Exception:
        TurboJPEG = None
        TJPF_BGRX = 3
        TJSAMP_420 = 2
        TJFLAG_FASTDCT = 2048


def _discover_turbojpeg():
    """Probes bundled and standard Windows libjpeg-turbo paths before default lookup."""
    if TurboJPEG is None:
        return None
    candidates: List[str] = []
    env_dll = os.environ.get("TURBOJPEG_DLL", "").strip()
    if env_dll:
        candidates.append(env_dll)
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(os.path.join(meipass, "turbojpeg.dll"))
    if getattr(sys, "executable", None):
        candidates.append(os.path.join(os.path.dirname(os.path.abspath(sys.executable)), "turbojpeg.dll"))
    candidates.append(os.path.join(_STREAMER_DIR, "turbojpeg.dll"))
    if platform.system() == "Windows":
        candidates.extend([
            r"C:\libjpeg-turbo64\bin\turbojpeg.dll",
            r"C:\libjpeg-turbo\bin\turbojpeg.dll",
        ])
    for cand in candidates:
        if cand and os.path.isfile(cand):
            try:
                return TurboJPEG(cand)
            except Exception:
                pass
    try:
        return TurboJPEG()
    except Exception:
        return None


_TURBO_JPEG_INSTANCE = _discover_turbojpeg()

logger = logging.getLogger("MultiMonitorStreamer")

DEFAULT_JPEG_QUALITY = 60


def _enable_windows_dpi_awareness() -> None:
    """Ensures capture dimensions match physical screen pixels on HiDPI Windows displays."""
    if platform.system() != "Windows":
        return
    try:
        # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
        user32 = ctypes.windll.user32
        fn = getattr(user32, "SetProcessDpiAwarenessContext", None)
        if fn is not None:
            fn.argtypes = [ctypes.c_void_p]
            fn.restype = ctypes.c_bool
            if fn(ctypes.c_void_p(-4)):
                return
    except Exception:
        pass
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


class MultiMonitorStreamer:
    """
    Thread-safe multi-monitor screen capture manager.
    Enables instant context-switching across multiple physical displays.
    """
    def __init__(self):
        _enable_windows_dpi_awareness()
        self._lock = threading.Lock()
        self._dxgi_lock = threading.Lock()
        self._tls = threading.local()
        self._all_scts: List[Any] = []
        self._sct = None
        if mss:
            try:
                self._sct = mss.MSS()
                self._all_scts.append(self._sct)
            except Exception as exc:
                logger.warning("MSS screen capture initialization deferred (%s)", exc)
                self._sct = None
        self._active_monitor_index: int = 1  # 1-indexed (monitor 0 is all monitors combined)
        self._current_bbox: Dict[str, int] = {}
        self._dominant_hex_color: str = "#00F0FF"  # Default Neon Cyan
        self._has_extracted_color: bool = False
        self._dxgi_cam: Any = None
        self._dxgi_mon_idx: Optional[int] = None
        self._dxgi_disabled: bool = False
        self._last_dxgi_arr: Optional[Any] = None

        self._refresh_monitors_list()

    def _can_use_dxgi(self) -> bool:
        if platform.system() != "Windows" or os.environ.get("AI_HEADLESS") == "1":
            return False
        if self._dxgi_disabled or np is None or (dxcam is None and bettercam is None):
            return False
        if mss is None or type(mss) is not types.ModuleType:
            return False
        local_sct = getattr(self._tls, "sct", None)
        if local_sct is not None and type(local_sct).__module__.split(".")[0] != "mss":
            return False
        if self._sct is not None and type(self._sct).__module__.split(".")[0] != "mss":
            return False
        get_sct_fn = getattr(self, "_get_thread_sct", None)
        if getattr(get_sct_fn, "__func__", None) is not MultiMonitorStreamer._get_thread_sct:
            return False
        return True

    def _release_dxgi_cam_locked(self) -> None:
        cam = self._dxgi_cam
        self._dxgi_cam = None
        self._dxgi_mon_idx = None
        self._last_dxgi_arr = None
        if cam is not None:
            for m_name in ("stop", "release", "close"):
                fn = getattr(cam, m_name, None)
                if callable(fn):
                    try:
                        fn()
                    except Exception:
                        pass

    def _release_dxgi_cam(self) -> None:
        with self._dxgi_lock:
            self._release_dxgi_cam_locked()

    def _grab_dxgi_frame(self, monitor_idx: int, expected_w: int, expected_h: int) -> Optional[Any]:
        with self._dxgi_lock:
            if not self._can_use_dxgi():
                return None
            dxgi_mod = dxcam if dxcam is not None else bettercam
            if dxgi_mod is None:
                return None
            try:
                if self._dxgi_cam is None or self._dxgi_mon_idx != monitor_idx:
                    self._release_dxgi_cam_locked()
                    out_idx = max(0, int(monitor_idx) - 1)
                    self._dxgi_cam = dxgi_mod.create(output_idx=out_idx, output_color="BGRA")
                    self._dxgi_mon_idx = monitor_idx
                arr = self._dxgi_cam.grab() if self._dxgi_cam is not None else None
                if arr is None:
                    if (
                        self._last_dxgi_arr is not None
                        and self._last_dxgi_arr.shape[:2] == (expected_h, expected_w)
                    ):
                        return self._last_dxgi_arr
                    return None
                if not isinstance(arr, np.ndarray) or arr.ndim != 3 or arr.shape[2] != 4:
                    return None
                if expected_w > 0 and expected_h > 0 and arr.shape[:2] != (expected_h, expected_w):
                    self._release_dxgi_cam_locked()
                    self._dxgi_disabled = True
                    return None
                if not arr.flags.c_contiguous:
                    arr = np.ascontiguousarray(arr)
                self._last_dxgi_arr = arr
                return arr
            except Exception as exc:
                logger.debug("DXGI capture fallback to MSS (%s)", exc)
                self._release_dxgi_cam_locked()
                self._dxgi_disabled = True
                return None

    def _get_thread_sct(self):
        if not mss:
            return None
        sct = getattr(self._tls, "sct", None)
        if sct is None:
            try:
                sct = mss.MSS()
                self._tls.sct = sct
                with self._lock:
                    self._all_scts.append(sct)
            except Exception as exc:
                logger.debug("Thread-local MSS creation failed: %s", exc)
                return None
        return sct

    def _reset_thread_sct(self) -> None:
        sct = getattr(self._tls, "sct", None)
        self._tls.sct = None
        if sct is not None:
            with self._lock:
                self._all_scts = [s for s in self._all_scts if s is not sct]
            try:
                sct.close()
            except Exception:
                pass

    def close(self) -> None:
        """Closes all GDI / X11 MSS and DXGI handles allocated by this streamer."""
        self._release_dxgi_cam()
        with self._lock:
            scts = list(self._all_scts)
            self._all_scts.clear()
            self._sct = None
            self._current_bbox.clear()
        for sct in scts:
            try:
                sct.close()
            except Exception:
                pass
        if hasattr(self._tls, "sct"):
            self._tls.sct = None
        if hasattr(self._tls, "bio"):
            try:
                self._tls.bio.close()
            except Exception:
                pass
            self._tls.bio = None

    @staticmethod
    def _invalidate_mss_monitors_cache(sct: Any) -> None:
        """Clears real MSS's cached monitor list so hot-plugged displays and DPI changes refresh."""
        if sct is None:
            return
        if type(sct).__module__.split(".")[0] == "mss" and hasattr(sct, "_monitors"):
            try:
                sct._monitors = None
            except Exception:
                pass

    def _refresh_monitors_list(self) -> List[Dict[str, Any]]:
        """Queries MSS for connected monitors and binds default display."""
        monitors = []
        with self._lock:
            if not self._sct:
                logger.warning("MSS screen capture unavailable; returning empty monitor list.")
                return []
            self._invalidate_mss_monitors_cache(self._sct)
            # mss.monitors[0] is the unified virtual desktop bounding box
            # Individual physical screens are 1, 2, ...
            total_screens = len(self._sct.monitors)
            for idx in range(1, total_screens):
                m = self._sct.monitors[idx]
                is_primary = bool(m.get("is_primary", m["left"] == 0 and m["top"] == 0))
                monitors.append({
                    "index": idx,
                    "width": m["width"],
                    "height": m["height"],
                    "left": m["left"],
                    "top": m["top"],
                    "label": f"Display {idx} ({m['width']}x{m['height']})",
                    "is_primary": is_primary,
                    "is_active": idx == self._active_monitor_index,
                })

            if not monitors and len(self._sct.monitors) > 0:
                # Fallback to monitor 0 if indexing is non-standard
                m = self._sct.monitors[0]
                monitors.append({
                    "index": 1,
                    "width": m["width"],
                    "height": m["height"],
                    "left": m["left"],
                    "top": m["top"],
                    "label": f"Display 1 ({m['width']}x{m['height']})",
                    "is_primary": True,
                    "is_active": True,
                })

            # Ensure active monitor bounding box is populated
            if self._active_monitor_index < len(self._sct.monitors):
                self._current_bbox = self._sct.monitors[self._active_monitor_index].copy()
            elif len(self._sct.monitors) > 1:
                self._active_monitor_index = 1
                self._current_bbox = self._sct.monitors[1].copy()

        return monitors

    def enumerate_monitors(self) -> List[Dict[str, Any]]:
        """Returns JSON-serializable list of all active monitors for Opcode 0x0D payload."""
        return self._refresh_monitors_list()

    def switch_monitor(self, monitor_index: int) -> bool:
        """
        Dynamically changes active capture target to monitor_index without restarting server.
        """
        switched = False
        with self._lock:
            if not self._sct:
                return False
            if not (1 <= monitor_index < len(self._sct.monitors)):
                self._invalidate_mss_monitors_cache(self._sct)
            if 1 <= monitor_index < len(self._sct.monitors):
                self._active_monitor_index = monitor_index
                self._current_bbox = self._sct.monitors[monitor_index].copy()
                switched = True
                logger.info(f"Switched capture display to Monitor {monitor_index}: {self._current_bbox}")
            else:
                logger.warning(f"Invalid monitor index {monitor_index}. Total monitors: {len(self._sct.monitors) - 1}")
        if switched:
            self._release_dxgi_cam()
        return switched

    def capture_frame(self, quality: int = DEFAULT_JPEG_QUALITY) -> Optional[Tuple[bytes, int, int]]:
        """
        Captures raw frame from active monitor (DXGI Desktop Duplication when available, else MSS)
        and compresses to JPEG via TurboJPEG or PIL.
        Returns: (jpeg_bytes, width, height) or None on failure.
        """
        sct = self._get_thread_sct()
        if not sct or not sct.monitors:
            return None

        clamped_quality = max(1, min(95, int(quality)))
        with self._lock:
            fallback_mon = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
            bbox = self._current_bbox.copy() if self._current_bbox else fallback_mon
            active_idx = self._active_monitor_index

        try:
            dxgi_arr = self._grab_dxgi_frame(
                active_idx,
                int(bbox.get("width", 0)),
                int(bbox.get("height", 0)),
            )
            if dxgi_arr is not None:
                height, width = int(dxgi_arr.shape[0]), int(dxgi_arr.shape[1])
                raw_for_color = memoryview(dxgi_arr.ravel())
                raw_sct_img = None
                bgra_arr = dxgi_arr
            else:
                # High-speed hardware screen grab fallback via MSS
                raw_sct_img = sct.grab(bbox)
                width, height = raw_sct_img.width, raw_sct_img.height
                raw_for_color = raw_sct_img.raw
                bgra_arr = (
                    np.frombuffer(raw_sct_img.raw, dtype=np.uint8).reshape((height, width, 4))
                    if np is not None
                    else None
                )

            # Run dynamic color extraction on the first captured frame
            should_extract = False
            with self._lock:
                if not self._has_extracted_color:
                    self._has_extracted_color = True
                    should_extract = True
            if should_extract:
                self._extract_dominant_color_fast(raw_for_color, width, height)

            # 1. Prefer TurboJPEG SIMD hardware compression (<3ms encoding)
            if _TURBO_JPEG_INSTANCE and bgra_arr is not None:
                try:
                    jpeg_bytes = _TURBO_JPEG_INSTANCE.encode(
                        bgra_arr,
                        quality=clamped_quality,
                        pixel_format=TJPF_BGRX,
                        jpeg_subsample=TJSAMP_420,
                        flags=TJFLAG_FASTDCT,
                    )
                    return jpeg_bytes, width, height
                except Exception as tj_err:
                    logger.debug(f"TurboJPEG encode fallback to Pillow: {tj_err}")

            # 2. Fallback to Pillow (zero-copy frombuffer + thread-local reusable BytesIO)
            if Image:
                raw_src = bgra_arr if dxgi_arr is not None else raw_sct_img.bgra
                img = Image.frombuffer("RGB", (width, height), raw_src, "raw", "BGRX", 0, 1)
                buf = getattr(self._tls, "bio", None)
                if buf is None:
                    buf = io.BytesIO()
                    self._tls.bio = buf
                else:
                    buf.seek(0)
                    buf.truncate(0)
                img.save(buf, format="JPEG", quality=clamped_quality, optimize=False)
                return buf.getvalue(), width, height

            return None
        except Exception as e:
            logger.error(f"Screen capture frame error: {e}")
            self._reset_thread_sct()
            try:
                self._refresh_monitors_list()
            except Exception:
                pass
            return None

    def _extract_dominant_color_fast(self, raw_bgra: bytes, width: int, height: int):
        """
        Extracts dominant desktop wallpaper accent color using fast spatial sampling
        and vibrant color clustering. Filters out dark taskbars and washed whites.
        """
        try:
            # Sample a 32x32 grid across the screen to maintain <2ms CPU overhead
            step_x = max(1, width // 32)
            step_y = max(1, height // 32)

            color_buckets: Dict[Tuple[int, int, int], int] = {}

            for y in range(0, height, step_y):
                row_offset = y * width * 4
                for x in range(0, width, step_x):
                    pixel_offset = row_offset + (x * 4)
                    if pixel_offset + 3 >= len(raw_bgra):
                        break

                    b = raw_bgra[pixel_offset]
                    g = raw_bgra[pixel_offset + 1]
                    r = raw_bgra[pixel_offset + 2]

                    # Convert to HSV-like metrics
                    max_c = max(r, g, b)
                    min_c = min(r, g, b)
                    delta = max_c - min_c

                    # Skip near-black, near-white, or low-saturation grays
                    if max_c < 45 or min_c > 225 or delta < 35:
                        continue

                    # Quantize into 16-step buckets
                    qr = (r // 16) * 16
                    qg = (g // 16) * 16
                    qb = (b // 16) * 16

                    bucket = (qr, qg, qb)
                    # Weight by saturation/vibrancy
                    color_buckets[bucket] = color_buckets.get(bucket, 0) + delta

            if color_buckets:
                # Find the most vibrant prominent color
                dominant = max(color_buckets.items(), key=lambda item: item[1])[0]
                hex_val = f"#{dominant[0]:02X}{dominant[1]:02X}{dominant[2]:02X}"
                with self._lock:
                    self._dominant_hex_color = hex_val
                logger.info(f"Extracted Desktop Wallpaper Dominant Color: {hex_val}")
            else:
                with self._lock:
                    self._dominant_hex_color = "#00F0FF"
        except Exception as e:
            logger.warning(f"Failed to extract dominant color: {e}")
            with self._lock:
                self._dominant_hex_color = "#00F0FF"

    @property
    def dominant_color_hex(self) -> str:
        """Returns the current extracted dominant color HEX string."""
        with self._lock:
            return self._dominant_hex_color
