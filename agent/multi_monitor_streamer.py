"""
Multi-Monitor Hardware Screen Grabber & Material You Dynamic Color Extractor
---------------------------------------------------------------------
Features:
- Opcode 0x0B (DISPLAY_ENUMERATION) Dynamic Monitor Switching ([ 1 ] [ 2 ] [ 3 ])
- Real-time MSS bounding box re-binding without dropping WebSocket connection
- TurboJPEG SIMD acceleration with preallocated output buffers
- Fast Desktop Wallpaper Dominant Color Extraction (K-Means / Frequency Clustering)
- Material You HEX Color Output for Flutter Neon Accent Interpolation
"""

import io
import logging
import threading
from typing import Dict, List, Optional, Tuple, Any

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

try:
    from turbojpeg import TurboJPEG, TJSAMP_420
    _TURBO_JPEG_INSTANCE = TurboJPEG()
except Exception:
    _TURBO_JPEG_INSTANCE = None

logger = logging.getLogger("MultiMonitorStreamer")

DEFAULT_JPEG_QUALITY = 60


class MultiMonitorStreamer:
    """
    Thread-safe multi-monitor screen capture manager.
    Enables instant context-switching across multiple physical displays.
    """
    def __init__(self):
        self._lock = threading.Lock()
        self._tls = threading.local()
        self._sct = (mss.MSS() if hasattr(mss, "MSS") else mss.mss()) if mss else None
        self._active_monitor_index: int = 1  # 1-indexed (monitor 0 is all monitors combined)
        self._current_bbox: Dict[str, int] = {}
        self._dominant_hex_color: str = "#00F0FF"  # Default CST Neon Cyan
        self._has_extracted_color: bool = False

        self._refresh_monitors_list()

    def _get_thread_sct(self):
        if not mss:
            return None
        sct = getattr(self._tls, "sct", None)
        if sct is None:
            sct = mss.MSS() if hasattr(mss, "MSS") else mss.mss()
            self._tls.sct = sct
        return sct

    def _refresh_monitors_list(self) -> List[Dict[str, Any]]:
        """Queries MSS for connected monitors and binds default display."""
        if not self._sct:
            return [{"index": 1, "width": 1920, "height": 1080, "left": 0, "top": 0, "label": "Default Virtual Screen"}]

        monitors = []
        with self._lock:
            # mss.monitors[0] is the unified virtual desktop bounding box
            # Individual physical screens are 1, 2, ...
            total_screens = len(self._sct.monitors)
            for idx in range(1, total_screens):
                m = self._sct.monitors[idx]
                monitors.append({
                    "index": idx,
                    "width": m["width"],
                    "height": m["height"],
                    "left": m["left"],
                    "top": m["top"],
                    "label": f"Display {idx} ({m['width']}x{m['height']})"
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
                    "label": f"Display 1 ({m['width']}x{m['height']})"
                })

            # Ensure active monitor bounding box is populated
            if self._active_monitor_index < len(self._sct.monitors):
                self._current_bbox = self._sct.monitors[self._active_monitor_index].copy()
            elif len(self._sct.monitors) > 1:
                self._active_monitor_index = 1
                self._current_bbox = self._sct.monitors[1].copy()

        return monitors

    def enumerate_monitors(self) -> List[Dict[str, Any]]:
        """Returns JSON-serializable list of all active monitors for Opcode 0x0B payload."""
        return self._refresh_monitors_list()

    def switch_monitor(self, monitor_index: int) -> bool:
        """
        Dynamically changes active capture target to monitor_index without restarting server.
        """
        if not self._sct:
            return False

        with self._lock:
            if 1 <= monitor_index < len(self._sct.monitors):
                self._active_monitor_index = monitor_index
                self._current_bbox = self._sct.monitors[monitor_index].copy()
                logger.info(f"Switched capture display to Monitor {monitor_index}: {self._current_bbox}")
                return True
            else:
                logger.warning(f"Invalid monitor index {monitor_index}. Total monitors: {len(self._sct.monitors) - 1}")
                return False

    def capture_frame(self, quality: int = DEFAULT_JPEG_QUALITY) -> Optional[Tuple[bytes, int, int]]:
        """
        Captures raw frame from active monitor and compresses to JPEG via TurboJPEG or PIL.
        Returns: (jpeg_bytes, width, height) or None on failure.
        """
        sct = self._get_thread_sct()
        if not sct:
            return None

        with self._lock:
            bbox = self._current_bbox.copy() if self._current_bbox else sct.monitors[1]

        try:
            # High-speed hardware screen grab
            raw_sct_img = sct.grab(bbox)
            width, height = raw_sct_img.width, raw_sct_img.height

            # Run dynamic color extraction on the first captured frame
            if not self._has_extracted_color:
                self._extract_dominant_color_fast(raw_sct_img.raw, width, height)
                self._has_extracted_color = True

            # 1. Prefer TurboJPEG SIMD hardware compression (<3ms encoding)
            if _TURBO_JPEG_INSTANCE and np is not None:
                try:
                    bgra_arr = np.frombuffer(raw_sct_img.raw, dtype=np.uint8).reshape((height, width, 4))
                    jpeg_bytes = _TURBO_JPEG_INSTANCE.encode(
                        bgra_arr,
                        quality=quality,
                        pixel_format=3,  # TJPF_BGRX (constant 3 for 4-byte BGRA/BGRX)
                        jpeg_subsample=TJSAMP_420
                    )
                    return jpeg_bytes, width, height
                except Exception as tj_err:
                    logger.debug(f"TurboJPEG encode fallback to Pillow: {tj_err}")

            # 2. Fallback to Pillow
            if Image:
                img = Image.frombytes("RGB", raw_sct_img.size, raw_sct_img.bgra, "raw", "BGRX")
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=quality, optimize=False)
                return buf.getvalue(), width, height

            return None
        except Exception as e:
            logger.error(f"Screen capture frame error: {e}")
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
                self._dominant_hex_color = f"#{dominant[0]:02X}{dominant[1]:02X}{dominant[2]:02X}"
                logger.info(f"Extracted Desktop Wallpaper Dominant Color: {self._dominant_hex_color}")
            else:
                self._dominant_hex_color = "#00F0FF"
        except Exception as e:
            logger.warning(f"Failed to extract dominant color: {e}")
            self._dominant_hex_color = "#00F0FF"

    @property
    def dominant_color_hex(self) -> str:
        """Returns the current extracted dominant color HEX string."""
        return self._dominant_hex_color
