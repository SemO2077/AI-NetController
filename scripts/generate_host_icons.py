#!/usr/bin/env python3
"""
AI NetController - Host Daemon Icon Generator
Generates pixel-perfect icons matching the Android application icon
in multi-resolution Windows ICO and PNG formats.
"""

import math
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AGENT_DIR = os.path.join(ROOT_DIR, "agent")
ASSETS_DIR = os.path.join(AGENT_DIR, "assets")


def generate_icons() -> None:
    os.makedirs(ASSETS_DIR, exist_ok=True)

    scale = 4
    size = 512
    W = size * scale
    H = size * scale

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    # 1. Gradient background rounded rectangle (#0e172a -> #050811)
    grad = Image.new("RGBA", (W, H))
    c1 = (14, 23, 42, 255)
    c2 = (5, 8, 17, 255)
    for y in range(H):
        for x in range(W):
            dt = (x + y) / (2.0 * W)
            dr = int(c1[0] + (c2[0] - c1[0]) * dt)
            dg = int(c1[1] + (c2[1] - c1[1]) * dt)
            db = int(c1[2] + (c2[2] - c1[2]) * dt)
            grad.putpixel((x, y), (dr, dg, db, 255))

    mask = Image.new("L", (W, H), 0)
    dmask = ImageDraw.Draw(mask)
    rad = int(112 * scale)
    dmask.rounded_rectangle([0, 0, W - 1, H - 1], radius=rad, fill=255)

    img = Image.composite(grad, img, mask)
    draw = ImageDraw.Draw(img)

    # Outer border stroke (#334155)
    draw.rounded_rectangle(
        [0, 0, W - 1, H - 1],
        radius=rad,
        outline=(51, 65, 85, 255),
        width=int(4 * scale),
    )

    cx = W / 2.0
    cy = H / 2.0
    s = float(scale)

    # 2. Dashed outer circle (r=144, #22d3ee)
    r_outer = 144 * s
    for deg in range(0, 360, 10):
        if (deg // 10) % 2 == 0:
            draw.arc(
                [cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer],
                start=deg,
                end=deg + 6,
                fill=(34, 211, 238, 75),
                width=int(6 * s),
            )

    # 3. Inner circle (r=110, #06b6d4)
    r_inner = 110 * s
    draw.ellipse(
        [cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner],
        outline=(6, 182, 212, 115),
        width=int(5 * s),
    )

    # 4. Glow layer for power symbol
    glow_img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)

    r_arc = 100 * s
    glow_draw.arc(
        [cx - r_arc, cy - r_arc, cx + r_arc, cy + r_arc],
        start=-48,
        end=228,
        fill=(34, 211, 238, 255),
        width=int(16 * s),
    )
    glow_draw.line(
        [(cx, 144 * s), (cx, 240 * s)],
        fill=(56, 189, 248, 255),
        width=int(16 * s),
    )

    # Rounded end caps for power stem and arc
    cap_r = 8 * s
    for pt in [
        (cx, 144 * s),
        (cx, 240 * s),
        (cx + 64 * s, cy - 72 * s),
        (cx - 64 * s, cy - 72 * s),
    ]:
        glow_draw.ellipse(
            [pt[0] - cap_r, pt[1] - cap_r, pt[0] + cap_r, pt[1] + cap_r],
            fill=(34, 211, 238, 255),
        )

    # Soft radial gaussian blur for glow
    blurred_glow = glow_img.filter(ImageFilter.GaussianBlur(radius=14 * s))
    img.alpha_composite(blurred_glow)
    img.alpha_composite(glow_img)

    # 5. Pulse nodes
    d = ImageDraw.Draw(img)
    # Center circle r=14 (#38bdf8)
    d.ellipse(
        [cx - 14 * s, cy - 14 * s, cx + 14 * s, cy + 14 * s],
        fill=(56, 189, 248, 255),
    )
    # Emerald node (180, 340) r=10 (#34d399)
    d.ellipse(
        [180 * s - 10 * s, 340 * s - 10 * s, 180 * s + 10 * s, 340 * s + 10 * s],
        fill=(52, 211, 153, 255),
    )
    # Cyan node (332, 340) r=10 (#38bdf8)
    d.ellipse(
        [332 * s - 10 * s, 340 * s - 10 * s, 332 * s + 10 * s, 340 * s + 10 * s],
        fill=(56, 189, 248, 255),
    )

    # Resize to standard production targets
    img_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
    img_256 = img.resize((256, 256), Image.Resampling.LANCZOS)
    img_64 = img.resize((64, 64), Image.Resampling.LANCZOS)
    img_32 = img.resize((32, 32), Image.Resampling.LANCZOS)
    img_16 = img.resize((16, 16), Image.Resampling.LANCZOS)

    # Save PNG files
    png_assets = os.path.join(ASSETS_DIR, "icon.png")
    png_root = os.path.join(AGENT_DIR, "icon.png")
    img_512.save(png_assets, "PNG")
    img_512.save(png_root, "PNG")
    img_64.save(os.path.join(ASSETS_DIR, "icon_64.png"), "PNG")
    img_32.save(os.path.join(ASSETS_DIR, "icon_32.png"), "PNG")

    # Save Windows multi-resolution ICO files
    ico_assets = os.path.join(ASSETS_DIR, "icon.ico")
    ico_root = os.path.join(AGENT_DIR, "icon.ico")
    ico_sizes = [
        (256, 256),
        (128, 128),
        (64, 64),
        (48, 48),
        (32, 32),
        (24, 24),
        (16, 16),
    ]
    img_256.save(ico_assets, format="ICO", sizes=ico_sizes)
    img_256.save(ico_root, format="ICO", sizes=ico_sizes)

    print(f"[OK] Generated Windows ICO: {ico_assets} ({os.path.getsize(ico_assets)} bytes)")
    print(f"[OK] Generated Windows ICO: {ico_root} ({os.path.getsize(ico_root)} bytes)")
    print(f"[OK] Generated PNG: {png_assets} ({os.path.getsize(png_assets)} bytes)")
    print(f"[OK] Generated PNG: {png_root} ({os.path.getsize(png_root)} bytes)")


if __name__ == "__main__":
    generate_icons()
