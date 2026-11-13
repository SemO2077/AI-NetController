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

    # Fallback: create dynamic in-memory icon matching mobile CyberColors design language
    img = Image.new("RGBA", (size, size), (4, 8, 18, 255))
    from PIL import ImageDraw
    draw = ImageDraw.Draw(img)
    s = size / 64.0
    # Outer Neon Cyan orbital ring + Electric Violet inner highlight arc
    draw.ellipse([3 * s, 3 * s, 61 * s, 61 * s], fill=(10, 22, 40, 255), outline=(0, 240, 255, 255), width=int(max(1, 3 * s)))
    draw.arc([9 * s, 9 * s, 55 * s, 55 * s], start=120, end=310, fill=(138, 43, 226, 230), width=int(max(1, 2.5 * s)))
    # Power stem and arc
    draw.arc([17 * s, 17 * s, 47 * s, 47 * s], start=-48, end=228, fill=(0, 240, 255, 255), width=int(max(1, 4 * s)))
    draw.line([(32 * s, 15 * s), (32 * s, 32 * s)], fill=(0, 255, 157, 255), width=int(max(1, 4 * s)))
    draw.ellipse([29 * s, 29 * s, 35 * s, 35 * s], fill=(0, 240, 255, 255))
    return img


def apply_window_icon(window) -> None:
    """Applies the AI NetController icon to a Tkinter root or Toplevel window."""
    if window is None:
        return

    # 1. Try native Windows .ico via iconbitmap
    ico_path = get_icon_ico_path()
    if ico_path and os.path.isfile(ico_path):
        try:
            window.iconbitmap(ico_path)
            return
        except Exception as e:
            logger.debug(f"iconbitmap notice: {e}")

    # 2. Try PhotoImage via iconphoto (with dynamic in-memory fallback icon when PNG asset is absent)
    try:
        from PIL import ImageTk
        img = get_icon_image(64)
        if img:
            photo = ImageTk.PhotoImage(img)
            window.iconphoto(False, photo)
            # Keep reference to prevent GC
            window._icon_photo_ref = photo
    except Exception as e:
        logger.debug(f"iconphoto notice: {e}")
