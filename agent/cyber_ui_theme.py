"""
AI NetController — Cyber Glassmorphic Desktop Theme & Vector Compositor
================================================================================
Mirrors the exact visual design language of the Mobile Companion (`fluid_theme.dart`):
  - Deep Abyssal Void (#040812) backdrop with top-right Cyan (#00F0FF) and
    bottom-left Electric Violet (#8A2BE2) ambient radial glows
  - Frosted glassmorphic card layers (#0A1628 / #102038) with specular rim borders
  - Supersampled vector CyberNodeBadge rings & glowing progress gauges
  - Pure-Python ISO/IEC 18004 QR Code matrix generator & vector renderer
  - Zero extra third-party native DLL dependencies (Pillow + stdlib tkinter)
================================================================================
"""

from __future__ import annotations

import ctypes
import math
import os
import sys
from typing import Dict, List, Optional, Tuple

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageTk
    HAS_PIL = True
except ImportError:
    Image = None
    ImageDraw = None
    ImageFilter = None
    ImageTk = None
    HAS_PIL = False

try:
    import tkinter as tk
    from tkinter import font as tkfont
    HAS_TK = True
except Exception:
    tk = None
    tkfont = None
    HAS_TK = False


# ==============================================================================
# CANONICAL CYBER COLOR TOKENS (1:1 parity with apps/mobile/lib/theme/fluid_theme.dart)
# ==============================================================================
class CyberColors:
    BACKGROUND = "#040812"
    SURFACE = "#0A1628"
    SURFACE_ELEVATED = "#102038"
    SURFACE_CARD = "#081326"
    SURFACE_DOCK = "#0C192F"
    TERMINAL_BG = "#060B16"

    PRIMARY = "#00F0FF"         # Neon Cyan
    PRIMARY_DIM = "#009DB0"
    PRIMARY_SOFT = "#0A2A3B"

    SECONDARY = "#8A2BE2"       # Electric Violet
    SECONDARY_SOFT = "#241442"

    ACCENT = "#FF0055"          # Neon Coral / Critical / HITL
    ACCENT_SOFT = "#3B0D24"

    SUCCESS = "#00FF9D"         # Cyber Emerald
    SUCCESS_SOFT = "#083327"

    WARNING = "#FFB800"         # Amber Alert
    WARNING_SOFT = "#332609"

    TEXT_PRIMARY = "#E2F1FF"
    TEXT_SECONDARY = "#7A93B2"
    TEXT_TERTIARY = "#4A607A"

    # Pre-composited subtle glass borders on dark slate
    GLASS_BORDER = "#13526A"         # ~0x3300F0FF on #0A1628
    GLASS_BORDER_IDLE = "#1D2C42"    # ~0x1AFFFFFF on #0A1628
    GLASS_BORDER_BRIGHT = "#1FC4DA"
    GLASS_BORDER_CRITICAL = "#8F1843"
    GLASS_HIGHLIGHT = "#0D2B3E"


def hex_to_rgba(hex_str: str, alpha: int = 255) -> Tuple[int, int, int, int]:
    """Converts '#RRGGBB' hex strings into an (R, G, B, A) tuple."""
    h = hex_str.lstrip("#")
    if len(h) == 6:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)
    if len(h) == 8:
        return (int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16), int(h[0:2], 16))
    return (10, 22, 40, alpha)


def mix_hex(c1: str, c2: str, t: float) -> str:
    """Linearly interpolates between two RGB hex colors (t in 0.0..1.0)."""
    t = max(0.0, min(1.0, float(t)))
    r1, g1, b1, _ = hex_to_rgba(c1)
    r2, g2, b2, _ = hex_to_rgba(c2)
    r = int(r1 + (r2 - r1) * t)
    g = int(g1 + (g2 - g1) * t)
    b = int(b1 + (b2 - b1) * t)
    return f"#{r:02X}{g:02X}{b:02X}"


def enable_hidpi_awareness() -> None:
    """Enables Per-Monitor V2 DPI awareness on Windows safely before creating UI."""
    if sys.platform != "win32":
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
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def apply_dark_titlebar(window, caption_hex: str = CyberColors.BACKGROUND) -> None:
    """Applies Windows 10/11 DWM immersive dark mode & deep abyssal caption bar."""
    if sys.platform != "win32" or window is None:
        return
    try:
        window.update_idletasks()
        hwnd = int(window.winfo_id())
        parent = ctypes.windll.user32.GetParent(hwnd)
        target_hwnd = parent if parent else hwnd
        dwmapi = ctypes.windll.dwmapi

        # DWMWA_USE_IMMERSIVE_DARK_MODE (20 and legacy 19)
        dark_val = ctypes.c_int(1)
        for attr in (20, 19):
            dwmapi.DwmSetWindowAttribute(
                ctypes.c_void_p(target_hwnd),
                ctypes.c_uint(attr),
                ctypes.byref(dark_val),
                ctypes.sizeof(dark_val),
            )

        # DWMWA_CAPTION_COLOR = 35, DWMWA_TEXT_COLOR = 36 (COLORREF is 0x00BBGGRR)
        r, g, b, _ = hex_to_rgba(caption_hex)
        colorref = ctypes.c_uint((b << 16) | (g << 8) | r)
        dwmapi.DwmSetWindowAttribute(
            ctypes.c_void_p(target_hwnd),
            ctypes.c_uint(35),
            ctypes.byref(colorref),
            ctypes.sizeof(colorref),
        )
        tr, tg, tb, _ = hex_to_rgba(CyberColors.TEXT_PRIMARY)
        text_ref = ctypes.c_uint((tb << 16) | (tg << 8) | tr)
        dwmapi.DwmSetWindowAttribute(
            ctypes.c_void_p(target_hwnd),
            ctypes.c_uint(36),
            ctypes.byref(text_ref),
            ctypes.sizeof(text_ref),
        )
    except Exception:
        pass


def resolve_font_families(root: Optional["tk.Tk"] = None) -> Tuple[str, str]:
    """Selects crisp UI & monospace fonts installed on the current OS."""
    ui_candidates = ("Segoe UI Variable Display", "Segoe UI Variable Text", "Segoe UI", "Inter", "Helvetica")
    mono_candidates = ("Cascadia Mono", "Consolas", "JetBrains Mono", "DejaVu Sans Mono", "Courier New")
    available: set[str] = set()
    if HAS_TK and tkfont is not None and root is not None:
        try:
            available = set(tkfont.families(root))
        except Exception:
            available = set()
    ui_font = next((f for f in ui_candidates if not available or f in available), "Segoe UI" if sys.platform == "win32" else "Sans")
    mono_font = next((f for f in mono_candidates if not available or f in available), "Consolas" if sys.platform == "win32" else "Monospace")
    return ui_font, mono_font


# ==============================================================================
# AMBIENT BACKDROP & GLASSMORPHIC ASSET COMPOSITOR
# ==============================================================================
def render_ambient_backdrop(width: int, height: int) -> Optional["Image.Image"]:
    """
    Renders the deep abyssal #040812 backdrop with top-right Cyan (#00F0FF)
    and bottom-left Electric Violet (#8A2BE2) radial ambient glows.
    """
    if not HAS_PIL:
        return None
    w = max(64, int(width))
    h = max(64, int(height))

    # Render smooth downscaled glow field then upsample bilinearly (<4ms total)
    sw = max(120, w // 4)
    sh = max(90, h // 4)
    base = Image.new("RGBA", (sw, sh), hex_to_rgba(CyberColors.BACKGROUND, 255))

    glow = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)

    # Top-right cyan aura (mirrors AdaptiveScaffold radial accent #00F0FF @ 14%)
    cx1, cy1, r1 = int(sw * 0.88), int(sh * 0.14), int(max(sw, sh) * 0.42)
    for step in range(8, 0, -1):
        frac = step / 8.0
        alpha = int(34 * (1.0 - frac * 0.85))
        rad = int(r1 * frac)
        draw.ellipse((cx1 - rad, cy1 - rad, cx1 + rad, cy1 + rad), fill=(0, 240, 255, alpha))

    # Bottom-left electric violet aura (mirrors AdaptiveScaffold radial accent #8A2BE2 @ 12%)
    cx2, cy2, r2 = int(sw * 0.12), int(sh * 0.88), int(max(sw, sh) * 0.44)
    for step in range(8, 0, -1):
        frac = step / 8.0
        alpha = int(32 * (1.0 - frac * 0.85))
        rad = int(r2 * frac)
        draw.ellipse((cx2 - rad, cy2 - rad, cx2 + rad, cy2 + rad), fill=(138, 43, 226, alpha))

    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(6, sw // 14)))
    composited = Image.alpha_composite(base, glow).resize((w, h), Image.Resampling.BILINEAR)

    # Subtle cyber dot grid (very low alpha so text contrast stays pristine)
    grid_draw = ImageDraw.Draw(composited)
    dot_color = (26, 48, 76, 120)
    step_px = 36
    for gx in range(24, w, step_px):
        for gy in range(24, h, step_px):
            grid_draw.point((gx, gy), fill=dot_color)

    return composited.convert("RGB")


def render_glass_card_image(
    width: int,
    height: int,
    radius: int = 18,
    fill_hex: str = CyberColors.SURFACE,
    border_hex: str = CyberColors.GLASS_BORDER,
    fill_alpha: int = 232,
    border_width: int = 1,
    highlight_top: bool = True,
) -> Optional["Image.Image"]:
    """Renders a crisp anti-aliased rounded glassmorphic panel via 2x supersampling."""
    if not HAS_PIL:
        return None
    w = max(24, int(width))
    h = max(24, int(height))
    s = 2  # 2x supersampling for clean rounded edges
    img = Image.new("RGBA", (w * s, h * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    rad = max(4, int(radius * s))
    bw = max(1, int(border_width * s))
    pad = bw
    rect = (pad, pad, w * s - pad - 1, h * s - pad - 1)
    d.rounded_rectangle(
        rect,
        radius=rad,
        fill=hex_to_rgba(fill_hex, fill_alpha),
        outline=hex_to_rgba(border_hex, 215),
        width=bw,
    )

    if highlight_top:
        sheen_pad = rad // 2 + 4
        y_line = pad + bw + 1
        if w * s - sheen_pad > sheen_pad:
            d.line(
                [(sheen_pad, y_line), (w * s - sheen_pad, y_line)],
                fill=hex_to_rgba(CyberColors.PRIMARY, 58),
                width=max(1, s // 2),
            )

    return img.resize((w, h), Image.Resampling.LANCZOS)


def render_pill_dock_image(width: int, height: int, radius: Optional[int] = None) -> Optional["Image.Image"]:
    """Renders the Samsung/OneUI-inspired floating cyber glass dock background."""
    rad = radius if radius is not None else max(16, height // 2)
    return render_glass_card_image(
        width=width,
        height=height,
        radius=rad,
        fill_hex=CyberColors.SURFACE_DOCK,
        border_hex=CyberColors.GLASS_BORDER_BRIGHT,
        fill_alpha=240,
        border_width=1,
        highlight_top=True,
    )


def render_node_orb_image(
    size: int,
    primary_hex: str = CyberColors.PRIMARY,
    secondary_hex: str = CyberColors.SECONDARY,
    pulse_phase: float = 0.0,
    is_online: bool = True,
) -> Optional["Image.Image"]:
    """
    Renders a vector orbital CyberNodeBadge matching `CyberNodeBadgePainter` in
    `apps/mobile/lib/ui/responsive_device_card.dart`.
    """
    if not HAS_PIL:
        return None
    s = max(24, int(size))
    ss = 2
    img = Image.new("RGBA", (s * ss, s * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = cy = (s * ss) / 2.0
    r = (s * ss) * 0.42

    ring_col = hex_to_rgba(primary_hex if is_online else CyberColors.TEXT_TERTIARY, 220)
    sec_col = hex_to_rgba(secondary_hex if is_online else CyberColors.SURFACE_ELEVATED, 170)

    # Outer glowing orbital halo
    pulse_scale = 0.90 + 0.12 * math.sin(pulse_phase * 2.0 * math.pi)
    halo_r = r * pulse_scale
    d.ellipse(
        (cx - halo_r, cy - halo_r, cx + halo_r, cy + halo_r),
        fill=hex_to_rgba(primary_hex if is_online else CyberColors.SURFACE, 32),
        outline=ring_col,
        width=max(2, ss * 2),
    )

    # Inner sweeping arc highlight
    arc_r = r * 0.72
    start_deg = int((pulse_phase * 360.0) % 360)
    d.arc(
        (cx - arc_r, cy - arc_r, cx + arc_r, cy + arc_r),
        start=start_deg,
        end=start_deg + 140,
        fill=sec_col,
        width=max(2, ss * 2),
    )

    # Core solid cyan/emerald node dot + ring
    core_r = r * 0.34
    d.ellipse(
        (cx - core_r, cy - core_r, cx + core_r, cy + core_r),
        fill=hex_to_rgba(primary_hex if is_online else CyberColors.WARNING, 245),
        outline=hex_to_rgba(CyberColors.TEXT_PRIMARY, 200),
        width=ss,
    )

    return img.resize((s, s), Image.Resampling.LANCZOS)


# ==============================================================================
# PURE-PYTHON ISO/IEC 18004 QR CODE GENERATOR (Byte Mode, ECC Level L, v1..v8)
# ==============================================================================
_QR_GF_EXP = [0] * 512
_QR_GF_LOG = [0] * 256


def _init_gf256() -> None:
    x = 1
    for i in range(255):
        _QR_GF_EXP[i] = x
        _QR_GF_LOG[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D
    for i in range(255, 512):
        _QR_GF_EXP[i] = _QR_GF_EXP[i - 255]


_init_gf256()


def _gf_mul(x: int, y: int) -> int:
    if x == 0 or y == 0:
        return 0
    return _QR_GF_EXP[_QR_GF_LOG[x] + _QR_GF_LOG[y]]


def _rs_generator_poly(degree: int) -> List[int]:
    g = [1]
    for i in range(degree):
        ng = [0] * (len(g) + 1)
        factor = _QR_GF_EXP[i]
        for j, coef in enumerate(g):
            ng[j] ^= coef
            ng[j + 1] ^= _gf_mul(coef, factor)
        g = ng
    return g


def _rs_remainder(data: List[int], ec_count: int) -> List[int]:
    gen = _rs_generator_poly(ec_count)
    res = list(data) + [0] * ec_count
    for i in range(len(data)):
        coef = res[i]
        if coef != 0:
            for j in range(1, len(gen)):
                res[i + j] ^= _gf_mul(gen[j], coef)
    return res[len(data):]


# (version, total_data_codewords, ec_codewords_per_block, num_blocks_g1, data_cw_g1, num_blocks_g2, data_cw_g2, align_centers)
_QR_SPECS_ECC_L = [
    (1, 19, 7, 1, 19, 0, 0, []),
    (2, 34, 10, 1, 34, 0, 0, [6, 18]),
    (3, 55, 15, 1, 55, 0, 0, [6, 22]),
    (4, 80, 20, 1, 80, 0, 0, [6, 26]),
    (5, 108, 26, 1, 108, 0, 0, [6, 30]),
    (6, 136, 18, 2, 68, 0, 0, [6, 34]),
    (7, 156, 20, 2, 78, 0, 0, [6, 22, 38]),
    (8, 194, 24, 2, 97, 0, 0, [6, 24, 42]),
]


def _append_bits(buf: List[int], val: int, length: int) -> None:
    for i in range(length - 1, -1, -1):
        buf.append((val >> i) & 1)


def _format_bits_ecc_l(mask_id: int) -> int:
    # ECC L indicator = 0b01
    data = (0b01 << 3) | (mask_id & 0x7)
    rem = data << 10
    poly = 0b10100110111
    for i in range(14, 9, -1):
        if (rem >> i) & 1:
            rem ^= poly << (i - 10)
    raw = ((data << 10) | rem) ^ 0b101010000010010
    return raw


def _version_bits(ver: int) -> int:
    rem = ver << 12
    poly = 0b1111100100101
    for i in range(17, 11, -1):
        if (rem >> i) & 1:
            rem ^= poly << (i - 12)
    return (ver << 12) | rem


def generate_qr_matrix(text: str) -> List[List[bool]]:
    """Generates a standard ISO/IEC 18004 QR code boolean matrix for UTF-8 strings up to 192 bytes."""
    payload = text.encode("utf-8")
    spec = None
    for s in _QR_SPECS_ECC_L:
        # 4 bits mode + 8 bits length (versions 1..9 Byte mode) + payload*8
        cap_bits = s[1] * 8
        if 12 + len(payload) * 8 <= cap_bits:
            spec = s
            break
    if spec is None:
        # Truncate safely only if extraordinarily oversized URI
        spec = _QR_SPECS_ECC_L[-1]
        payload = payload[: spec[1] - 2]

    ver, total_dcw, ec_per_blk, b1_cnt, b1_dcw, b2_cnt, b2_dcw, align_pos = spec
    size = ver * 4 + 17

    bits: List[int] = []
    _append_bits(bits, 0b0100, 4)  # Byte mode
    _append_bits(bits, len(payload), 8)
    for byte in payload:
        _append_bits(bits, byte, 8)

    cap_bits = total_dcw * 8
    terminator = min(4, cap_bits - len(bits))
    bits.extend([0] * terminator)
    while len(bits) % 8 != 0:
        bits.append(0)

    data_cw: List[int] = []
    for i in range(0, len(bits), 8):
        b = 0
        for k in range(8):
            b = (b << 1) | bits[i + k]
        data_cw.append(b)
    pad_bytes = (0xEC, 0x11)
    pi = 0
    while len(data_cw) < total_dcw:
        data_cw.append(pad_bytes[pi & 1])
        pi += 1

    # Split into RS blocks & interleave
    data_blocks: List[List[int]] = []
    ec_blocks: List[List[int]] = []
    idx = 0
    for cnt, dcw in ((b1_cnt, b1_dcw), (b2_cnt, b2_dcw)):
        for _ in range(cnt):
            blk = data_cw[idx : idx + dcw]
            idx += dcw
            data_blocks.append(blk)
            ec_blocks.append(_rs_remainder(blk, ec_per_blk))

    codewords: List[int] = []
    max_dcw = max(len(b) for b in data_blocks)
    for i in range(max_dcw):
        for b in data_blocks:
            if i < len(b):
                codewords.append(b[i])
    for i in range(ec_per_blk):
        for e in ec_blocks:
            codewords.append(e[i])

    stream_bits: List[int] = []
    for cw in codewords:
        _append_bits(stream_bits, cw, 8)
    stream_bits.extend([0] * 7)  # Version 2..6 remainder padding

    # Build template matrix (None = unset data module, bool = fixed function module)
    modules: List[List[Optional[bool]]] = [[None] * size for _ in range(size)]
    is_func: List[List[bool]] = [[False] * size for _ in range(size)]

    def set_func(r: int, c: int, val: bool) -> None:
        modules[r][c] = val
        is_func[r][c] = True

    def place_finder(top: int, left: int) -> None:
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                r, c = top + dr, left + dc
                if not (0 <= r < size and 0 <= c < size):
                    continue
                if 0 <= dr <= 6 and 0 <= dc <= 6:
                    dark = (
                        dr in (0, 6)
                        or dc in (0, 6)
                        or (2 <= dr <= 4 and 2 <= dc <= 4)
                    )
                    set_func(r, c, dark)
                else:
                    set_func(r, c, False)

    place_finder(0, 0)
    place_finder(0, size - 7)
    place_finder(size - 7, 0)

    # Alignment patterns
    for ar in align_pos:
        for ac in align_pos:
            if is_func[ar][ac]:
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    dark = max(abs(dr), abs(dc)) != 1
                    set_func(ar + dr, ac + dc, dark)

    # Timing patterns & dark module
    for i in range(8, size - 8):
        if not is_func[6][i]:
            set_func(6, i, i % 2 == 0)
        if not is_func[i][6]:
            set_func(i, 6, i % 2 == 0)
    set_func(size - 8, 8, True)

    # Reserve format & version info regions
    for i in range(9):
        if i != 6:
            set_func(8, i, False)
            set_func(i, 8, False)
    for i in range(8):
        set_func(8, size - 1 - i, False)
    for i in range(7):
        set_func(size - 1 - i, 8, False)
    if ver >= 7:
        vbits = _version_bits(ver)
        for i in range(18):
            bit = bool((vbits >> i) & 1)
            set_func(i // 3, size - 11 + (i % 3), bit)
            set_func(size - 11 + (i % 3), i // 3, bit)

    # Place data bits in zig-zag columns
    bit_idx = 0
    right = size - 1
    upward = True
    while right >= 1:
        if right == 6:
            right -= 1
        rows = range(size - 1, -1, -1) if upward else range(size)
        for r in rows:
            for dc in (0, -1):
                c = right + dc
                if not is_func[r][c]:
                    b = bool(stream_bits[bit_idx]) if bit_idx < len(stream_bits) else False
                    modules[r][c] = b
                    bit_idx += 1
        upward = not upward
        right -= 2

    # Choose optimal mask pattern (0..7)
    mask_fns = (
        lambda r, c: (r + c) % 2 == 0,
        lambda r, c: r % 2 == 0,
        lambda r, c: c % 3 == 0,
        lambda r, c: (r + c) % 3 == 0,
        lambda r, c: (r // 2 + c // 3) % 2 == 0,
        lambda r, c: (r * c) % 2 + (r * c) % 3 == 0,
        lambda r, c: ((r * c) % 2 + (r * c) % 3) % 2 == 0,
        lambda r, c: ((r + c) % 2 + (r * c) % 3) % 2 == 0,
    )

    def apply_mask_and_format(mask_id: int) -> List[List[bool]]:
        fn = mask_fns[mask_id]
        grid = [[False] * size for _ in range(size)]
        for r in range(size):
            for c in range(size):
                val = bool(modules[r][c])
                if not is_func[r][c] and fn(r, c):
                    val = not val
                grid[r][c] = val
        fbits = _format_bits_ecc_l(mask_id)
        for i in range(15):
            bit = bool((fbits >> i) & 1)
            # Horizontal
            if i < 8:
                grid[8][size - 1 - i] = bit
            elif i < 9:
                grid[8][7] = bit
            else:
                grid[8][14 - i] = bit
            # Vertical
            if i < 6:
                grid[i][8] = bit
            elif i < 8:
                grid[i + 1][8] = bit
            else:
                grid[size - 15 + i][8] = bit
        return grid

    def penalty_score(grid: List[List[bool]]) -> int:
        score = 0
        # Rule 1: 5+ adjacent same-color modules in rows/cols
        for r in range(size):
            run_c = 1
            for c in range(1, size):
                if grid[r][c] == grid[r][c - 1]:
                    run_c += 1
                    if run_c == 5:
                        score += 3
                    elif run_c > 5:
                        score += 1
                else:
                    run_c = 1
        for c in range(size):
            run_r = 1
            for r in range(1, size):
                if grid[r][c] == grid[r - 1][c]:
                    run_r += 1
                    if run_r == 5:
                        score += 3
                    elif run_r > 5:
                        score += 1
                else:
                    run_r = 1
        # Rule 2: 2x2 blocks
        for r in range(size - 1):
            for c in range(size - 1):
                v = grid[r][c]
                if grid[r][c + 1] == v and grid[r + 1][c] == v and grid[r + 1][c + 1] == v:
                    score += 3
        # Rule 4: dark ratio balance
        dark = sum(1 for r in range(size) for c in range(size) if grid[r][c])
        pct = (dark * 100) // (size * size)
        score += (abs(pct - 50) // 5) * 10
        return score

    best_grid = None
    best_score = 1 << 30
    for mid in range(8):
        candidate = apply_mask_and_format(mid)
        sc = penalty_score(candidate)
        if sc < best_score:
            best_score = sc
            best_grid = candidate
    return best_grid if best_grid is not None else apply_mask_and_format(0)


def render_qr_card_image(
    data: str,
    pixel_size: int = 180,
    dark_hex: str = "#040812",
    light_hex: str = "#E2F1FF",
    accent_hex: str = CyberColors.PRIMARY,
) -> Optional["Image.Image"]:
    """Renders a crisp, high-contrast scannable QR card framed in the Cyber theme."""
    if not HAS_PIL:
        return None
    matrix = generate_qr_matrix(data)
    n = len(matrix)
    quiet = 3
    total_mod = n + quiet * 2
    scale = max(3, pixel_size // total_mod)
    qr_px = total_mod * scale
    pad = 10
    card_w = qr_px + pad * 2

    card = Image.new("RGBA", (card_w, card_w), hex_to_rgba(light_hex, 255))
    d = ImageDraw.Draw(card)
    # Draw crisp dark modules inside quiet zone
    dark_rgba = hex_to_rgba(dark_hex, 255)
    for r in range(n):
        for c in range(n):
            if matrix[r][c]:
                x0 = pad + (c + quiet) * scale
                y0 = pad + (r + quiet) * scale
                d.rectangle((x0, y0, x0 + scale - 1, y0 + scale - 1), fill=dark_rgba)

    # Neon cyan outer hairline frame
    d.rectangle((0, 0, card_w - 1, card_w - 1), outline=hex_to_rgba(accent_hex, 235), width=2)
    return card.resize((pixel_size, pixel_size), Image.Resampling.NEAREST)
