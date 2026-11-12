"""
AI NetController — Icon & Branding Asset Resolver
Provides reliable access to application icons across source runs and
PyInstaller frozen bundles (_MEIPASS / onedir / standalone).
"""

import os
import sys
import logging
from typing import Optional

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

logger = logging.getLogger("AI-NetController-Icons")


def _get_search_roots():
    roots = []
    # 1. PyInstaller temp directory
    if hasattr(sys, "_MEIPASS"):
        roots.append(sys._MEIPASS)
    # 2. Directory of running executable or script
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        roots.append(exe_dir)
        roots.append(os.path.join(exe_dir, "_internal"))
    # 3. Directory of this source file
    src_dir = os.path.dirname(os.path.abspath(__file__))
    roots.append(src_dir)
    roots.append(os.path.dirname(src_dir))
    return roots


def get_icon_ico_path() -> Optional[str]:
    """Returns the absolute path to icon.ico, if found."""
    for root in _get_search_roots():
        for cand in [
            os.path.join(root, "assets", "icon.ico"),
            os.path.join(root, "icon.ico"),
            os.path.join(root, "agent", "assets", "icon.ico"),
            os.path.join(root, "agent", "icon.ico"),
        ]:
            if os.path.isfile(cand) and os.path.getsize(cand) > 0:
                return os.path.abspath(cand)
    return None


def get_icon_png_path(size: int = 512) -> Optional[str]:
    """Returns the absolute path to icon.png or icon_64.png / icon_32.png."""
    fname = f"icon_{size}.png" if size in (32, 64) else "icon.png"
    for root in _get_search_roots():
        for cand in [
            os.path.join(root, "assets", fname),
            os.path.join(root, fname),
            os.path.join(root, "agent", "assets", fname),
            os.path.join(root, "agent", fname),
            os.path.join(root, "assets", "icon.png"),
            os.path.join(root, "icon.png"),
        ]:
            if os.path.isfile(cand) and os.path.getsize(cand) > 0:
                return os.path.abspath(cand)
    return None


def get_icon_image(size: int = 64):
    """Returns an RGBA PIL Image of the AI NetController icon, or creates one dynamically."""
    if not HAS_PIL:
        return None

    png_path = get_icon_png_path(size)
    if png_path:
        try:
            with Image.open(png_path) as src_im:
                im = src_im.convert("RGBA") if src_im.mode != "RGBA" else src_im.copy()
            if im.size != (size, size):
                im = im.resize((size, size), Image.Resampling.LANCZOS)
            return im
        except Exception as e:
            logger.debug(f"Could not load icon from {png_path}: {e}")

    # Fallback: create dynamic in-memory icon matching app brand
    img = Image.new("RGBA", (size, size), (7, 12, 24, 255))
    from PIL import ImageDraw
    draw = ImageDraw.Draw(img)
    s = size / 64.0
    # Cyber boundary ring
    draw.ellipse([4 * s, 4 * s, 60 * s, 60 * s], outline=(34, 211, 238, 255), width=int(max(1, 3 * s)))
    # Power stem and arc
    draw.arc([16 * s, 16 * s, 48 * s, 48 * s], start=-48, end=228, fill=(34, 211, 238, 255), width=int(max(1, 4 * s)))
    draw.line([(32 * s, 16 * s), (32 * s, 32 * s)], fill=(56, 189, 248, 255), width=int(max(1, 4 * s)))
    draw.ellipse([30 * s, 30 * s, 34 * s, 34 * s], fill=(56, 189, 248, 255))
    return img


def apply_window_icon(window) -> None:
    """Applies the AI NetController icon to a Tkinter root or Toplevel window."""
    if window is None:
        return

    # 1. Try native Windows .ico via iconbitmap
    ico_path = get_icon_ico_path()
    if ico_path and os.path.isfile(ico_path):
        try:
            window.iconbitmap(default=ico_path)
            return
        except Exception as e:
            logger.debug(f"iconbitmap notice: {e}")

    # 2. Try PhotoImage via iconphoto
    png_path = get_icon_png_path(64) or get_icon_png_path(512)
    if png_path and os.path.isfile(png_path):
        try:
            import tkinter as tk
            from PIL import ImageTk
            img = get_icon_image(64)
            if img:
                photo = ImageTk.PhotoImage(img)
                window.iconphoto(True, photo)
                # Keep reference to prevent GC
                window._icon_photo_ref = photo
        except Exception as e:
            logger.debug(f"iconphoto notice: {e}")
