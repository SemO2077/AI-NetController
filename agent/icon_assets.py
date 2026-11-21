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


def render_cyber_icon_image(size: int = 512, circular_mask: bool = False):
    """
    Renders a high-definition 3D Beveled Cyber-Glass icon with:
    - Deep obsidian squircle/circle chassis
    - Top-left specular glass bevel & inner violet orbital ring
    - Neon cyan outer telemetry ring & emerald power vector core
    """
    if not HAS_PIL:
        return None
    from PIL import ImageDraw

    # Supersample at 2x for crisp anti-aliased vector-grade edges
    ss = max(128, min(1024, size * 2))
    img = Image.new("RGBA", (ss, ss), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = ss / 512.0

    pad = int(16 * s)
    if circular_mask:
        draw.ellipse([pad, pad, ss - pad, ss - pad], fill=(5, 10, 20, 255), outline=(26, 48, 82, 255), width=max(2, int(6 * s)))
        draw.arc([pad + int(6 * s), pad + int(6 * s), ss - pad - int(6 * s), ss - pad - int(6 * s)],
                 start=195, end=345, fill=(255, 255, 255, 95), width=max(2, int(5 * s)))
    else:
        radius = int(108 * s)
        draw.rounded_rectangle([pad, pad, ss - pad, ss - pad], radius=radius, fill=(5, 10, 20, 255), outline=(26, 48, 82, 255), width=max(2, int(6 * s)))
        # Inner 3D glassmorphic bevel frame
        b_pad = int(28 * s)
        draw.rounded_rectangle([b_pad, b_pad, ss - b_pad, ss - b_pad], radius=int(92 * s), fill=(9, 17, 32, 255), outline=(0, 240, 255, 75), width=max(1, int(4 * s)))
        # Top specular highlight edge
        draw.line([(int(96 * s), int(30 * s)), (int(416 * s), int(30 * s))], fill=(255, 255, 255, 130), width=max(1, int(4 * s)))

    # Outer ambient neon cyan ring
    r1 = int(68 * s)
    draw.ellipse([r1, r1, ss - r1, ss - r1], fill=(7, 14, 26, 255), outline=(0, 240, 255, 235), width=max(2, int(14 * s)))

    # Secondary electric violet orbital telemetry arcs
    r2 = int(102 * s)
    draw.arc([r2, r2, ss - r2, ss - r2], start=125, end=305, fill=(138, 43, 226, 240), width=max(2, int(12 * s)))
    draw.arc([r2, r2, ss - r2, ss - r2], start=-40, end=75, fill=(0, 255, 157, 210), width=max(2, int(10 * s)))

    # Inner power ring (broken at top for power stem)
    r3 = int(148 * s)
    draw.arc([r3, r3, ss - r3, ss - r3], start=-52, end=232, fill=(0, 240, 255, 255), width=max(3, int(26 * s)))

    # Central power stem with emerald-to-cyan core
    cx = ss // 2
    draw.line([(cx, int(112 * s)), (cx, int(256 * s))], fill=(0, 255, 157, 255), width=max(3, int(28 * s)))
    draw.line([(cx, int(118 * s)), (cx, int(250 * s))], fill=(210, 255, 245, 255), width=max(1, int(10 * s)))

    # Center nexus node
    nr = int(22 * s)
    draw.ellipse([cx - nr, cx - nr, cx + nr, cx + nr], fill=(0, 240, 255, 255), outline=(255, 255, 255, 220), width=max(1, int(4 * s)))

    if ss != size:
        img = img.resize((size, size), Image.Resampling.LANCZOS)
    return img


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

    return render_cyber_icon_image(size=size)


def apply_window_icon(window) -> None:
    """Applies the AI NetController icon and Windows AppUserModelID to a Tkinter root or Toplevel window."""
    if window is None:
        return

    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
                "AINetController.HostAgent.Daemon.0.90"
            )
        except Exception:
            pass

    # 1. Try native Windows .ico via iconbitmap
    ico_path = get_icon_ico_path()
    if ico_path and os.path.isfile(ico_path):
        try:
            window.iconbitmap(ico_path)
        except Exception as e:
            logger.debug(f"iconbitmap notice: {e}")

    # 2. Also bind high-DPI PhotoImage via iconphoto so titlebar & Alt+Tab use crisp 32/64px RGBA layers
    try:
        from PIL import ImageTk
        img64 = get_icon_image(64)
        img32 = get_icon_image(32)
        if img64 and img32:
            photo64 = ImageTk.PhotoImage(img64)
            photo32 = ImageTk.PhotoImage(img32)
            window.iconphoto(False, photo64, photo32)
            window._icon_photo_ref = (photo64, photo32)
    except Exception as e:
        logger.debug(f"iconphoto notice: {e}")


def generate_all_brand_icons(repo_root: Optional[str] = None) -> dict:
    """
    Generates all PC EXE (.ico & .png) and Android APK (mipmap-*dpi) icon assets
    from the canonical 3D Cyber-Glass vector renderer.
    """
    if not HAS_PIL:
        return {"ok": False, "error": "Pillow not available"}

    if not repo_root:
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    agent_dir = os.path.join(repo_root, "agent")
    assets_dir = os.path.join(agent_dir, "assets")
    os.makedirs(assets_dir, exist_ok=True)

    master_512 = render_cyber_icon_image(512, circular_mask=False)
    master_round_512 = render_cyber_icon_image(512, circular_mask=True)
    img_64 = render_cyber_icon_image(64, circular_mask=False)
    img_32 = render_cyber_icon_image(32, circular_mask=False)

    written = []

    # 1. PC PNGs
    for p in (os.path.join(agent_dir, "icon.png"), os.path.join(assets_dir, "icon.png")):
        master_512.save(p, format="PNG")
        written.append(p)

    p64 = os.path.join(assets_dir, "icon_64.png")
    img_64.save(p64, format="PNG")
    written.append(p64)

    p32 = os.path.join(assets_dir, "icon_32.png")
    img_32.save(p32, format="PNG")
    written.append(p32)

    # 2. Multi-resolution Windows .ico (16, 24, 32, 48, 64, 128, 256)
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    for ico_path in (os.path.join(agent_dir, "icon.ico"), os.path.join(assets_dir, "icon.ico")):
        master_512.save(ico_path, format="ICO", sizes=ico_sizes)
        written.append(ico_path)

    # 3. Android APK mipmap raster icons (square & round)
    android_res = os.path.join(repo_root, "apps", "mobile", "android", "app", "src", "main", "res")
    if os.path.isdir(android_res):
        mipmap_specs = {
            "mipmap-mdpi": 48,
            "mipmap-hdpi": 72,
            "mipmap-xhdpi": 96,
            "mipmap-xxhdpi": 144,
            "mipmap-xxxhdpi": 192,
        }
        for folder, px in mipmap_specs.items():
            target_dir = os.path.join(android_res, folder)
            os.makedirs(target_dir, exist_ok=True)
            sq_path = os.path.join(target_dir, "ic_launcher.png")
            rd_path = os.path.join(target_dir, "ic_launcher_round.png")
            master_512.resize((px, px), Image.Resampling.LANCZOS).save(sq_path, format="PNG")
            master_round_512.resize((px, px), Image.Resampling.LANCZOS).save(rd_path, format="PNG")
            written.extend([sq_path, rd_path])

    return {"ok": True, "count": len(written), "files": written}


if __name__ == "__main__":
    res = generate_all_brand_icons()
    print(f"Generated {res.get('count', 0)} brand icon assets.")
