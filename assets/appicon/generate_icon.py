#!/usr/bin/env python3
"""Generate the Token Island app icon (pixel art, macOS .icns + PNGs).

The art is authored on a 128x128 pixel grid and upscaled with nearest-neighbour
so every "pixel" stays a crisp square at any size — the same law as the UI.

Layout: a dark 8-bit "island" pill floating over a dithered wallpaper, with a
mini token bar chart inside, an amber live dot and a few loose data pixels.
Everything is drawn with opaque rectangles only (no alpha tricks), so the icon
looks identical in Finder, the Dock and the snapshot previews.

Outputs:
  assets/appicon/icon-1024.png
  assets/appicon/AppIcon.icns          (copied into the app bundle by build-app.sh)
  assets/appicon/icon-128.png          (README / docs)

Usage: python3 assets/appicon/generate_icon.py
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets/appicon"
GRID = 128
UPSCALE = 8  # 128 * 8 = 1024

BG = (11, 11, 18, 255)
BG_CHECK = (16, 16, 28, 255)
SURFACE = (20, 18, 29, 255)
SURFACE_HI = (34, 31, 51, 255)
BORDER = (87, 80, 122, 255)
BORDER_HI = (120, 112, 160, 255)
TEAL = (59, 232, 176, 255)
TEAL_DIM = (31, 111, 91, 255)
BLUE = (91, 157, 255, 255)
PURPLE = (179, 136, 255, 255)
INK = (244, 242, 255, 255)
AMBER = (255, 200, 87, 255)
SHADOW = (5, 5, 9, 255)


def chamfer_rect(draw: ImageDraw.ImageDraw, box, fill, corner: int = 4) -> None:
    """Filled rectangle with staircase pixel corners (no curves).

    `corner` is the number of staircase steps; 2 gives the classic 8-bit
    "cut corner" (1px, then 2px), 4 a softer one.
    """
    x0, y0, x1, y1 = box
    corner = max(0, min(corner, (x1 - x0) // 3, (y1 - y0) // 3))
    for step in range(corner):
        inset = corner - step
        draw.rectangle([x0 + inset, y0 + step, x1 - inset, y0 + step], fill=fill)
        draw.rectangle([x0 + inset, y1 - step, x1 - inset, y1 - step], fill=fill)
    draw.rectangle([x0, y0 + corner, x1, y1 - corner], fill=fill)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (GRID, GRID), BG)
    draw = ImageDraw.Draw(image)

    # 1. Dithered wallpaper: 2px checker tiles + darker frame pixels.
    for y in range(0, GRID, 2):
        for x in range(0, GRID, 2):
            if (x // 2 + y // 2) % 2 == 0:
                draw.rectangle([x, y, x + 1, y + 1], fill=BG_CHECK)

    # 2. Island pill: hard shadow, 2px lavender border, dark glass fill.
    pill = (11, 38, 116, 90)
    chamfer_rect(draw, (pill[0] + 3, pill[1] + 5, pill[2] + 3, pill[3] + 5), SHADOW, 4)
    chamfer_rect(draw, pill, BORDER, 4)
    chamfer_rect(draw, (pill[0] + 2, pill[1] + 2, pill[2] - 2, pill[3] - 2), SURFACE, 2)
    # 1px highlight along the top inner edge (the "glass" reflection).
    draw.rectangle([pill[0] + 4, pill[1] + 2, pill[2] - 4, pill[1] + 2], fill=BORDER_HI)
    draw.rectangle([pill[0] + 2, pill[1] + 3, pill[0] + 2, pill[3] - 3], fill=BORDER_HI)

    # 3. Token bars: 4 chunky bars with 1px pixel notches, bottom aligned.
    bars = [(18, TEAL_DIM), (30, TEAL), (42, TEAL), (26, TEAL_DIM)]
    bar_x = 28
    for height, color in bars:
        bottom = 82
        draw.rectangle([bar_x, bottom - height, bar_x + 7, bottom], fill=color)
        # 1px lighter cap + 2px darker base = cheap pixel shading.
        draw.rectangle([bar_x, bottom - height, bar_x + 7, bottom - height], fill=INK if color == TEAL else (63, 177, 143, 255))
        draw.rectangle([bar_x, bottom - 1, bar_x + 7, bottom], fill=(15, 61, 50, 255))
        bar_x += 11

    # 4. Live indicator: amber dot with pulse rays (reads as "live" at 32px).
    draw.rectangle([96, 48, 103, 55], fill=AMBER)
    draw.rectangle([99, 50, 100, 51], fill=BG)
    draw.rectangle([94, 50, 94, 53], fill=AMBER)
    draw.rectangle([105, 50, 105, 53], fill=AMBER)
    draw.rectangle([98, 58, 101, 58], fill=AMBER)

    # 5. Three orbit pixels above-right of the island (subtle 8-bit twinkle).
    for (px, py), color in (((96, 24), TEAL), ((106, 30), BLUE), ((116, 22), PURPLE)):
        draw.rectangle([px, py, px + 2, py + 2], fill=color)

    # 6. Baseline sea line under the island (dashed, 2px tall).
    draw.rectangle([16, 100, 111, 101], fill=BORDER)
    for offset in range(0, 96, 8):
        draw.rectangle([16 + offset, 100, 20 + offset, 101], fill=TEAL_DIM)

    icon_1024 = image.resize((GRID * UPSCALE, GRID * UPSCALE), Image.NEAREST)
    icon_1024.save(OUT / "icon-1024.png")
    image.resize((128, 128), Image.NEAREST).save(OUT / "icon-128.png")

    # 7. Build .icns via iconset (works without Xcode: sips + iconutil).
    iconset = OUT / "AppIcon.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir()
    sizes = [
        (16, "16x16"),
        (32, "16x16@2x"),
        (32, "32x32"),
        (64, "32x32@2x"),
        (128, "128x128"),
        (256, "128x128@2x"),
        (256, "256x256"),
        (512, "256x256@2x"),
        (512, "512x512"),
        (1024, "512x512@2x"),
    ]
    for pixels, name in sizes:
        target = iconset / f"icon_{name}.png"
        subprocess.run(
            ["sips", "-z", str(pixels), str(pixels), str(OUT / "icon-1024.png"), "--out", str(target)],
            check=True,
            stdout=subprocess.DEVNULL,
        )
    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(OUT / "AppIcon.icns")],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    shutil.rmtree(iconset)
    print(f"icon: {OUT / 'AppIcon.icns'} ({(OUT / 'AppIcon.icns').stat().st_size} bytes)")
    print(f"png:  {OUT / 'icon-1024.png'} / {OUT / 'icon-128.png'}")


if __name__ == "__main__":
    main()
