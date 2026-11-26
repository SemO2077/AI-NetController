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
from dataclasses import dataclass
from functools import lru_cache
import math
import sys
from typing import Dict, List, Optional, Tuple

try:
    from PIL import Image, ImageDraw, ImageFilter
    HAS_PIL = True
except ImportError:
    Image = None
    ImageDraw = None
    ImageFilter = None
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

    # 3D Bevel & Specular Depth Tokens (parity with mobile 3D glassmorphic refresh)
    SPECULAR_TOP = "#3CF5FF"
    SPECULAR_VIOLET = "#B366FF"
    SHADOW_DEEP = "#02050B"
    SURFACE_HEADER_STRIP = "#0E1E36"
    SURFACE_HOVER = "#132642"


# ==============================================================================
# APPLE LIQUID GLASS DUAL-POLARITY PALETTE (1:1 parity with Web & Mobile)
# Default: Bright Daylight Glass ("light") + Iridescent Violet ("violet")
# ==============================================================================
LIQUID_ACCENT_PRESETS: Dict[str, Dict[str, str]] = {
    "violet": {
        "label": "Iridescent Violet",
        "light_primary": "#7C3AED",
        "light_secondary": "#EC4899",
        "light_tertiary": "#0EA5E9",
        "dark_primary": "#C084FC",
        "dark_secondary": "#F472B6",
        "dark_tertiary": "#38BDF8",
    },
    "cobalt": {
        "label": "Electric Azure",
        "light_primary": "#2563EB",
        "light_secondary": "#0EA5E9",
        "light_tertiary": "#7C3AED",
        "dark_primary": "#60A5FA",
        "dark_secondary": "#38BDF8",
        "dark_tertiary": "#A78BFA",
    },
    "cyan": {
        "label": "Aqua Cyan",
        "light_primary": "#0891B2",
        "light_secondary": "#6366F1",
        "light_tertiary": "#10B981",
        "dark_primary": "#22D3EE",
        "dark_secondary": "#818CF8",
        "dark_tertiary": "#34D399",
    },
    "emerald": {
        "label": "Bio Mint",
        "light_primary": "#059669",
        "light_secondary": "#06B6D4",
        "light_tertiary": "#84CC16",
        "dark_primary": "#34D399",
        "dark_secondary": "#22D3EE",
        "dark_tertiary": "#A3E635",
    },
    "rose": {
        "label": "Coral Rose",
        "light_primary": "#E11D48",
        "light_secondary": "#F97316",
        "light_tertiary": "#A855F7",
        "dark_primary": "#FB7185",
        "dark_secondary": "#FB923C",
        "dark_tertiary": "#C084FC",
    },
    "amber": {
        "label": "Solar Amber",
        "light_primary": "#D97706",
        "light_secondary": "#F97316",
        "light_tertiary": "#0EA5E9",
        "dark_primary": "#FBBF24",
        "dark_secondary": "#FB923C",
        "dark_tertiary": "#38BDF8",
    },
}


@dataclass(frozen=True)
class LiquidThemePalette:
    theme_mode: str
    accent_id: str
    is_daylight: bool
    BACKGROUND: str
    SURFACE: str
    SURFACE_ELEVATED: str
    SURFACE_CARD: str
    SURFACE_DOCK: str
    TERMINAL_BG: str
    PRIMARY: str
    PRIMARY_DIM: str
    PRIMARY_SOFT: str
    ON_PRIMARY: str
    SECONDARY: str
    SECONDARY_SOFT: str
    TERTIARY: str
    ACCENT: str
    ACCENT_SOFT: str
    SUCCESS: str
    SUCCESS_SOFT: str
    WARNING: str
    WARNING_SOFT: str
    TEXT_PRIMARY: str
    TEXT_SECONDARY: str
    TEXT_TERTIARY: str
    GLASS_BORDER: str
    GLASS_BORDER_IDLE: str
    GLASS_BORDER_BRIGHT: str
    GLASS_BORDER_CRITICAL: str
    GLASS_HIGHLIGHT: str
    SPECULAR_TOP: str
    SPECULAR_VIOLET: str
    SHADOW_DEEP: str
    SURFACE_HEADER_STRIP: str
    SURFACE_HOVER: str


def get_liquid_palette(theme_mode: str = "light", accent: str = "violet") -> LiquidThemePalette:
    """Returns canonical Apple Liquid Glass tokens for Daylight ('light') or Vibrant Dark ('dark')."""
    mode = "dark" if str(theme_mode).lower() == "dark" else "light"
    acc_key = accent if accent in LIQUID_ACCENT_PRESETS else "violet"
    spec = LIQUID_ACCENT_PRESETS[acc_key]

    if mode == "light":
        primary = spec["light_primary"]
        secondary = spec["light_secondary"]
        tertiary = spec["light_tertiary"]
        return LiquidThemePalette(
            theme_mode="light",
            accent_id=acc_key,
            is_daylight=True,
            BACKGROUND="#EEF2FF",
            SURFACE="#F8F9FF",
            SURFACE_ELEVATED="#FFFFFF",
            SURFACE_CARD="#F3F5FF",
            SURFACE_DOCK="#FFFFFF",
            TERMINAL_BG="#FFFFFF",
            PRIMARY=primary,
            PRIMARY_DIM=mix_hex(primary, "#141530", 0.22),
            PRIMARY_SOFT=mix_hex("#FFFFFF", primary, 0.13),
            ON_PRIMARY="#FFFFFF",
            SECONDARY=secondary,
            SECONDARY_SOFT=mix_hex("#FFFFFF", secondary, 0.13),
            TERTIARY=tertiary,
            ACCENT="#E11D48",
            ACCENT_SOFT="#FFE4E6",
            SUCCESS="#059669",
            SUCCESS_SOFT="#D1FAE5",
            WARNING="#D97706",
            WARNING_SOFT="#FEF3C7",
            TEXT_PRIMARY="#141530",
            TEXT_SECONDARY="#4B4F75",
            TEXT_TERTIARY="#5E648C",
            GLASS_BORDER=mix_hex("#FFFFFF", primary, 0.34),
            GLASS_BORDER_IDLE="#DCE2FA",
            GLASS_BORDER_BRIGHT=mix_hex("#FFFFFF", primary, 0.50),
            GLASS_BORDER_CRITICAL="#FDA4AF",
            GLASS_HIGHLIGHT=mix_hex("#FFFFFF", primary, 0.16),
            SPECULAR_TOP="#FFFFFF",
            SPECULAR_VIOLET=mix_hex("#FFFFFF", secondary, 0.55),
            SHADOW_DEEP="#D8DFF7",
            SURFACE_HEADER_STRIP="#F4F6FF",
            SURFACE_HOVER=mix_hex("#FFFFFF", primary, 0.10),
        )

    primary = spec["dark_primary"]
    secondary = spec["dark_secondary"]
    tertiary = spec["dark_tertiary"]
    return LiquidThemePalette(
        theme_mode="dark",
        accent_id=acc_key,
        is_daylight=False,
        BACKGROUND="#090B1D",
        SURFACE="#141838",
        SURFACE_ELEVATED="#1C214A",
        SURFACE_CARD="#111532",
        SURFACE_DOCK="#171C42",
        TERMINAL_BG="#0D112B",
        PRIMARY=primary,
        PRIMARY_DIM=mix_hex(primary, "#090B1D", 0.30),
        PRIMARY_SOFT=mix_hex("#141838", primary, 0.20),
        ON_PRIMARY="#090B1D",
        SECONDARY=secondary,
        SECONDARY_SOFT=mix_hex("#141838", secondary, 0.22),
        TERTIARY=tertiary,
        ACCENT="#FB7185",
        ACCENT_SOFT="#3A1228",
        SUCCESS="#34D399",
        SUCCESS_SOFT="#0C3128",
        WARNING="#FBBF24",
        WARNING_SOFT="#36280E",
        TEXT_PRIMARY="#F7F9FF",
        TEXT_SECONDARY="#B5BFE0",
        TEXT_TERTIARY="#8B96C4",
        GLASS_BORDER=mix_hex("#1C214A", primary, 0.42),
        GLASS_BORDER_IDLE="#2A3160",
        GLASS_BORDER_BRIGHT=mix_hex("#FFFFFF", primary, 0.65),
        GLASS_BORDER_CRITICAL="#BE123C",
        GLASS_HIGHLIGHT=mix_hex("#141838", primary, 0.26),
        SPECULAR_TOP=mix_hex("#FFFFFF", primary, 0.45),
        SPECULAR_VIOLET=secondary,
        SHADOW_DEEP="#050612",
        SURFACE_HEADER_STRIP="#1A1F46",
        SURFACE_HOVER="#222857",
    )


class FluidDesktopScale:
    """
    Responsive viewport & aspect-ratio scaling calculator for the PC Host Control Center.
    Mirrors `FluidScale` in `apps/mobile/lib/theme/fluid_theme.dart` to guarantee zero
    clipping or overflow across compact (640x420), landscape (800x480), standard (1120x760),
    and ultra-wide / 4K desktops.
    """

    def __init__(self, width: int = 1120, height: int = 760, dpi_scale: float = 1.0):
        self.width = max(320, int(width))
        self.height = max(240, int(height))
        self.dpi_scale = max(0.75, min(2.5, float(dpi_scale)))
        self.aspect_ratio = self.width / float(max(1, self.height))

        self.is_ultra_compact_width = self.width < 740
        self.is_compact_width = self.width < 920
        self.is_ultra_short_height = self.height < 520
        self.is_short_height = self.height < 650

        # Switch 2-column grids to 1-column stacked flow when viewport is narrow
        self.columns = 1 if self.width < 860 else 2

        w_ratio = self.width / 1120.0
        h_ratio = self.height / 760.0
        raw_scale = min(w_ratio, h_ratio * 1.06)
        self.scale = max(0.76, min(1.16, raw_scale))
        self.font_scale = max(0.84, min(1.10, raw_scale))

    @classmethod
    def from_dimensions(cls, width: int, height: int, dpi_scale: float = 1.0) -> "FluidDesktopScale":
        return cls(width=width, height=height, dpi_scale=dpi_scale)

    def sp(self, base_pt: int, min_pt: int = 7) -> int:
        """Scales typography point size proportionally with safe readability floor."""
        return max(min_pt, int(round(base_pt * self.font_scale)))

    def px(self, base_px: int, min_px: int = 2) -> int:
        """Scales layout padding and spacing proportionally to window geometry."""
        return max(min_px, int(round(base_px * self.scale)))

    @property
    def shell_padx(self) -> int:
        if self.is_ultra_compact_width:
            return 8
        if self.is_compact_width:
            return 12
        return self.px(18, min_px=10)

    @property
    def shell_pady(self) -> int:
        if self.is_ultra_short_height:
            return 6
        if self.is_short_height:
            return 10
        return self.px(14, min_px=8)

    @property
    def card_padx(self) -> int:
        if self.is_ultra_compact_width:
            return 10
        if self.is_compact_width:
            return 12
        return self.px(16, min_px=10)

    @property
    def card_pady(self) -> int:
        if self.is_ultra_short_height:
            return 8
        if self.is_short_height:
            return 10
        return self.px(14, min_px=8)

    @property
    def qr_size(self) -> int:
        if self.is_ultra_compact_width or self.is_ultra_short_height:
            return 128
        if self.is_compact_width or self.is_short_height:
            return 150
        return 176

    @property
    def orb_size(self) -> int:
        if self.is_ultra_compact_width or self.is_ultra_short_height:
            return 36
        if self.is_compact_width:
            return 42
        return 46


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


def apply_titlebar_theme(
    window,
    palette: Optional[LiquidThemePalette] = None,
    caption_hex: Optional[str] = None,
) -> None:
    """Applies Windows 10/11 DWM Daylight or Vibrant Dark caption bar matching the active palette."""
    if sys.platform != "win32" or window is None:
        return
    pal = palette or get_liquid_palette("light", "violet")
    cap = caption_hex or pal.BACKGROUND
    try:
        window.update_idletasks()
        hwnd = int(window.winfo_id())
        user32 = ctypes.windll.user32
        user32.GetParent.argtypes = [ctypes.c_void_p]
        user32.GetParent.restype = ctypes.c_void_p
        parent = user32.GetParent(ctypes.c_void_p(hwnd))
        target_hwnd = parent if parent else hwnd
        dwmapi = ctypes.windll.dwmapi
        dwmapi.DwmSetWindowAttribute.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint,
            ctypes.c_void_p,
            ctypes.c_uint,
        ]
        dwmapi.DwmSetWindowAttribute.restype = ctypes.c_long

        # DWMWA_USE_IMMERSIVE_DARK_MODE (20 and legacy 19)
        dark_val = ctypes.c_int(0 if pal.is_daylight else 1)
        for attr in (20, 19):
            dwmapi.DwmSetWindowAttribute(
                ctypes.c_void_p(target_hwnd),
                ctypes.c_uint(attr),
                ctypes.byref(dark_val),
                ctypes.sizeof(dark_val),
            )

        # DWMWA_CAPTION_COLOR = 35, DWMWA_TEXT_COLOR = 36 (COLORREF is 0x00BBGGRR)
        r, g, b, _ = hex_to_rgba(cap)
        colorref = ctypes.c_uint((b << 16) | (g << 8) | r)
        dwmapi.DwmSetWindowAttribute(
            ctypes.c_void_p(target_hwnd),
            ctypes.c_uint(35),
            ctypes.byref(colorref),
            ctypes.sizeof(colorref),
        )
        tr, tg, tb, _ = hex_to_rgba(pal.TEXT_PRIMARY)
        text_ref = ctypes.c_uint((tb << 16) | (tg << 8) | tr)
        dwmapi.DwmSetWindowAttribute(
            ctypes.c_void_p(target_hwnd),
            ctypes.c_uint(36),
            ctypes.byref(text_ref),
            ctypes.sizeof(text_ref),
        )
    except Exception:
        pass


def apply_dark_titlebar(window, caption_hex: str = CyberColors.BACKGROUND) -> None:
    """Applies Windows 10/11 DWM immersive dark mode & deep abyssal caption bar."""
    apply_titlebar_theme(
        window,
        palette=get_liquid_palette("dark", "cyan"),
        caption_hex=caption_hex,
    )


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
def render_ambient_backdrop(
    width: int,
    height: int,
    focal_shift: float = 0.0,
    theme_mode: str = "light",
    accent: str = "violet",
) -> Optional["Image.Image"]:
    """
    Renders a luminous Apple Liquid Glass aurora backdrop for either Bright Daylight
    ('light', pastel-prism lavender/sky/blush) or Vibrant Dark ('dark', twilight indigo)
    with subtle tab-aware focal parallax.
    """
    if not HAS_PIL:
        return None
    w = max(64, int(width))
    h = max(64, int(height))
    shift = max(-1.0, min(1.0, float(focal_shift)))
    pal = get_liquid_palette(theme_mode, accent)

    # Render smooth downscaled glow field then upsample bilinearly (<4ms total)
    sw = max(120, w // 4)
    sh = max(90, h // 4)
    base = Image.new("RGBA", (sw, sh), hex_to_rgba(pal.BACKGROUND, 255))

    glow = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)

    p_r, p_g, p_b, _ = hex_to_rgba(pal.PRIMARY)
    s_r, s_g, s_b, _ = hex_to_rgba(pal.SECONDARY)
    t_r, t_g, t_b, _ = hex_to_rgba(pal.TERTIARY)

    # Top-right Hero Accent aurora orb
    cx1 = int(sw * (0.84 - 0.08 * shift))
    cy1 = int(sh * (0.14 + 0.04 * shift))
    r1 = int(max(sw, sh) * 0.48)
    peak1 = 44 if pal.is_daylight else 48
    for step in range(9, 0, -1):
        frac = step / 9.0
        alpha = int(peak1 * (1.0 - frac * 0.85))
        rad = int(r1 * frac)
        draw.ellipse((cx1 - rad, cy1 - rad, cx1 + rad, cy1 + rad), fill=(p_r, p_g, p_b, alpha))

    # Bottom-left Secondary blush/magenta aurora orb
    cx2 = int(sw * (0.14 + 0.08 * shift))
    cy2 = int(sh * (0.86 - 0.04 * shift))
    r2 = int(max(sw, sh) * 0.50)
    peak2 = 38 if pal.is_daylight else 42
    for step in range(9, 0, -1):
        frac = step / 9.0
        alpha = int(peak2 * (1.0 - frac * 0.85))
        rad = int(r2 * frac)
        draw.ellipse((cx2 - rad, cy2 - rad, cx2 + rad, cy2 + rad), fill=(s_r, s_g, s_b, alpha))

    # Top-center luminous sky/mint horizon wash for prism glass depth
    cx3 = int(sw * (0.48 + 0.06 * shift))
    cy3 = int(sh * 0.10)
    r3x = int(sw * 0.50)
    r3y = int(sh * 0.28)
    peak3 = 34 if pal.is_daylight else 28
    for step in range(6, 0, -1):
        frac = step / 6.0
        alpha = int(peak3 * (1.0 - frac * 0.82))
        rx = int(r3x * frac)
        ry = int(r3y * frac)
        draw.ellipse((cx3 - rx, cy3 - ry, cx3 + rx, cy3 + ry), fill=(t_r, t_g, t_b, alpha))

    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(6, sw // 12)))
    composited = Image.alpha_composite(base, glow).resize((w, h), Image.Resampling.BILINEAR)
    return composited.convert("RGB")


def render_glass_card_image(
    width: int,
    height: int,
    radius: int = 18,
    fill_hex: str = CyberColors.SURFACE,
    border_hex: str = CyberColors.GLASS_BORDER,
    fill_alpha: int = 236,
    border_width: int = 1,
    highlight_top: bool = True,
) -> Optional["Image.Image"]:
    """
    Renders a crisp 3D beveled anti-aliased rounded glassmorphic panel via 2x supersampling:
      - Outer recessed shadow rim at bottom edge
      - Elevated inner surface body with subtle top-band luminosity
      - Top-edge specular cyan/white rim highlight bar
    """
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

    # 1. Subtle 3D bottom drop bevel for depth separation
    shadow_rect = (pad, pad + s, w * s - pad - 1, h * s - 1)
    d.rounded_rectangle(
        shadow_rect,
        radius=rad,
        fill=hex_to_rgba(CyberColors.SHADOW_DEEP, 180),
    )

    # 2. Main frosted glass surface body
    rect = (pad, pad, w * s - pad - 1, h * s - pad - 1 - s)
    d.rounded_rectangle(
        rect,
        radius=rad,
        fill=hex_to_rgba(fill_hex, fill_alpha),
        outline=hex_to_rgba(border_hex, 225),
        width=bw,
    )

    # 3. Inner 1px beveled rim highlight (lighter upper-left, deeper lower-right feel)
    inner_rect = (pad + bw, pad + bw, w * s - pad - bw - 1, h * s - pad - bw - 1 - s)
    if inner_rect[2] > inner_rect[0] + 8 and inner_rect[3] > inner_rect[1] + 8:
        inner_rim_hex = mix_hex(fill_hex, border_hex, 0.38)
        d.rounded_rectangle(
            inner_rect,
            radius=max(2, rad - bw),
            outline=hex_to_rgba(inner_rim_hex, 95),
            width=1,
        )

    # 4. Top-edge specular highlight bar + soft secondary glow line
    if highlight_top:
        sheen_pad = rad // 2 + 4
        y_line = pad + bw + 1
        if w * s - sheen_pad > sheen_pad:
            spec_hex = mix_hex(border_hex, "#FFFFFF", 0.42)
            d.line(
                [(sheen_pad, y_line), (w * s - sheen_pad, y_line)],
                fill=hex_to_rgba(spec_hex, 135),
                width=max(1, s),
            )
            d.line(
                [(sheen_pad + 6, y_line + s), (w * s - sheen_pad - 6, y_line + s)],
                fill=hex_to_rgba(CyberColors.PRIMARY, 48),
                width=1,
            )

    return img.resize((w, h), Image.Resampling.LANCZOS)


def render_pill_dock_image(width: int, height: int, radius: Optional[int] = None) -> Optional["Image.Image"]:
    """Renders the Samsung/OneUI-inspired 3D floating cyber glass dock background."""
    rad = radius if radius is not None else max(16, height // 2)
    return render_glass_card_image(
        width=width,
        height=height,
        radius=rad,
        fill_hex=CyberColors.SURFACE_DOCK,
        border_hex=CyberColors.GLASS_BORDER_BRIGHT,
        fill_alpha=244,
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
    Renders a 3D vector orbital CyberNodeBadge matching `CyberNodeBadgePainter` in
    `apps/mobile/lib/ui/responsive_device_card.dart`:
      - Breathing outer neon halo + 4-quadrant instrument ticks
      - Dual counter-rotating telemetry arcs (Cyan + Electric Violet)
      - 3D radial-lit core sphere with off-center specular glint
    """
    if not HAS_PIL:
        return None
    s = max(24, int(size))
    ss = 2
    img = Image.new("RGBA", (s * ss, s * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = cy = (s * ss) / 2.0
    r = (s * ss) * 0.43

    ring_col = hex_to_rgba(primary_hex if is_online else CyberColors.TEXT_TERTIARY, 225)
    sec_col = hex_to_rgba(secondary_hex if is_online else CyberColors.SURFACE_ELEVATED, 185)

    # 1. Outer breathing orbital halo
    pulse_scale = 0.90 + 0.11 * math.sin(pulse_phase * 2.0 * math.pi)
    halo_r = r * pulse_scale
    d.ellipse(
        (cx - halo_r, cy - halo_r, cx + halo_r, cy + halo_r),
        fill=hex_to_rgba(primary_hex if is_online else CyberColors.SURFACE, 34),
        outline=ring_col,
        width=max(2, ss * 2),
    )

    # 2. 4-Quadrant precision instrument ticks (0, 90, 180, 270 deg)
    tick_inner = halo_r * 0.82
    tick_outer = halo_r * 1.06
    for deg in (0, 90, 180, 270):
        rad_a = math.radians(deg + pulse_phase * 90.0)
        x0 = cx + math.cos(rad_a) * tick_inner
        y0 = cy + math.sin(rad_a) * tick_inner
        x1 = cx + math.cos(rad_a) * tick_outer
        y1 = cy + math.sin(rad_a) * tick_outer
        d.line([(x0, y0), (x1, y1)], fill=ring_col, width=max(1, ss))

    # 3. Primary & counter-rotating secondary sweeping telemetry arcs
    arc_r = r * 0.72
    start_deg = int((pulse_phase * 360.0) % 360)
    d.arc(
        (cx - arc_r, cy - arc_r, cx + arc_r, cy + arc_r),
        start=start_deg,
        end=start_deg + 135,
        fill=sec_col,
        width=max(2, ss * 2),
    )
    opp_deg = int((360.0 - pulse_phase * 360.0 + 180.0) % 360)
    inner_arc_r = r * 0.56
    d.arc(
        (cx - inner_arc_r, cy - inner_arc_r, cx + inner_arc_r, cy + inner_arc_r),
        start=opp_deg,
        end=opp_deg + 95,
        fill=hex_to_rgba(primary_hex if is_online else CyberColors.TEXT_SECONDARY, 160),
        width=max(1, ss),
    )

    # 4. 3D Core sphere with layered shading + top-left specular glint
    core_r = r * 0.35
    base_core_hex = primary_hex if is_online else CyberColors.WARNING
    deep_core_hex = mix_hex(base_core_hex, CyberColors.BACKGROUND, 0.42)
    d.ellipse(
        (cx - core_r, cy - core_r, cx + core_r, cy + core_r),
        fill=hex_to_rgba(deep_core_hex, 250),
        outline=hex_to_rgba(CyberColors.TEXT_PRIMARY, 210),
        width=ss,
    )
    mid_r = core_r * 0.76
    d.ellipse(
        (cx - mid_r, cy - mid_r, cx + mid_r, cy + mid_r),
        fill=hex_to_rgba(base_core_hex, 248),
    )
    glint_r = max(1.5, core_r * 0.28)
    gx = cx - core_r * 0.28
    gy = cy - core_r * 0.28
    d.ellipse(
        (gx - glint_r, gy - glint_r, gx + glint_r, gy + glint_r),
        fill=(255, 255, 255, 220),
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


@lru_cache(maxsize=16)
def _rs_generator_poly(degree: int) -> Tuple[int, ...]:
    g = [1]
    for i in range(degree):
        ng = [0] * (len(g) + 1)
        factor = _QR_GF_EXP[i]
        for j, coef in enumerate(g):
            ng[j] ^= coef
            ng[j + 1] ^= _gf_mul(coef, factor)
        g = ng
    return tuple(g)


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
        dark = sum(row.count(True) for row in grid)
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
    quiet = 4
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
