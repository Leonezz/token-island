#!/usr/bin/env python3
"""Extract the Silkscreen pixel font into a 1-bit glyph table.

Silkscreen is designed on an 8px grid, so rendering at exactly 8px yields clean
1-bit bitmaps (no antialiasing, no subpixel offsets).  Those bitmaps let the SVG
badges/charts — which cannot load webfonts on GitHub — share the exact same
typography as the native app and dashboard, which use the real TTF.

Glyphs are baseline-aligned: `top` is the first ink row relative to the
baseline (negative = above), `rows` are the ink rows, `advance` is the pen
advance in design pixels.  Most UI text uses cap-top placement, which is
`baseline - 5` design pixels (PIXEL_FONT_CAP_HEIGHT).

Outputs:
  packages/core/src/pixel-font.generated.ts    glyph table (ASCII 32..126)
  assets/fonts/pixel-font-preview.svg          visual sanity check

Usage: python3 assets/fonts/extract_pixel_font.py
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONT_PATH = ROOT / "assets/fonts/Silkscreen-Regular.ttf"
OUT_TS = ROOT / "packages/core/src/pixel-font.generated.ts"
OUT_PREVIEW = ROOT / "assets/fonts/pixel-font-preview.svg"

NATIVE_SIZE = 8  # Silkscreen's design grid is 8px
CANVAS = 64
BASELINE = 32
CAP_HEIGHT = 5


def render_char(ch: str, font: ImageFont.FreeTypeFont) -> tuple[list[str], int, int]:
    """Return (rows, top, advance) for one char, baseline-aligned."""
    image = Image.new("1", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(image).text((8, BASELINE), ch, font=font, fill=1, anchor="ls")
    pixels = image.load()

    points = [
        (x - 8, y - BASELINE)
        for x in range(CANVAS)
        for y in range(CANVAS)
        if pixels[x, y]
    ]
    advance = max(1, round(font.getlength(ch)))
    if not points:
        return [], 0, advance

    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    left, right = min(xs), max(xs)
    top, bottom = min(ys), max(ys)
    rows = []
    for y in range(top, bottom + 1):
        rows.append(
            "".join("#" if pixels[8 + x, y + BASELINE] else "." for x in range(left, right + 1))
        )
    return rows, top, advance


def main() -> None:
    font = ImageFont.truetype(str(FONT_PATH), NATIVE_SIZE)

    glyphs: dict[str, tuple[list[str], int, int]] = {}
    for code in range(32, 127):
        ch = chr(code)
        rows, top, advance = render_char(ch, font)
        glyphs[ch] = (rows, top, advance)

    entries = []
    for ch in sorted(glyphs, key=ord):
        rows, top, advance = glyphs[ch]
        entries.append(
            {
                "char": ch,
                "advance": advance,
                "top": top,
                "rows": rows,
            }
        )

    max_ascent = max((-e["top"] for e in entries if e["rows"]), default=CAP_HEIGHT)
    max_descent = max((e["top"] + len(e["rows"]) for e in entries if e["rows"]), default=0)

    lines = [
        "/**",
        " * GENERATED FILE — do not edit by hand.",
        " *",
        " * Silkscreen (OFL) glyphs on their native 8px grid, baseline-aligned.",
        " * `top` = first ink row relative to baseline (negative = above baseline).",
        " * Regenerate: python3 assets/fonts/extract_pixel_font.py",
        " */",
        "",
        "export interface PixelGlyph {",
        "  /** Advance width in design pixels. */",
        "  readonly advance: number;",
        "  /** First ink row relative to the baseline (negative = above). */",
        "  readonly top: number;",
        "  /** Ink rows, made of '#' and '.'. */",
        "  readonly rows: readonly string[];",
        "}",
        "",
        f"/** Height of capital letters above the baseline, in design pixels. */",
        f"export const PIXEL_FONT_CAP_HEIGHT = {CAP_HEIGHT};",
        "",
        f"/** Recommended single-line box height (cap height + baseline row). */",
        f"export const PIXEL_FONT_TEXT_HEIGHT = {CAP_HEIGHT + 1};",
        "",
        f"/** Tallest ascent in the font (some punctuation is above cap height). */",
        f"export const PIXEL_FONT_ASCENT = {max_ascent};",
        "",
        f"/** Deepest descent in the font (always 0 for Silkscreen). */",
        f"export const PIXEL_FONT_DESCENT = {max_descent};",
        "",
        "/** Design pixels per named size step (keeps typography on the pixel grid). */",
        "export const PIXEL_TYPE_SCALE = { micro: 1, tiny: 2, small: 2, body: 3, large: 4, hero: 6 } as const;",
        "",
        "export const PIXEL_GLYPHS: Readonly<Record<string, PixelGlyph>> = {",
    ]
    for entry in entries:
        rows_js = ", ".join(json.dumps(row) for row in entry["rows"])
        key = json.dumps(entry["char"])
        lines.append(
            f"  {key}: {{ advance: {entry['advance']}, top: {entry['top']}, rows: [{rows_js}] }},"
        )
    lines.append("};")
    lines.append("")
    OUT_TS.write_text("\n".join(lines), encoding="utf-8")

    # ---- preview: compare bitmap layout against the live TTF side by side ----
    def bitmap_text(text: str, x: int, baseline: int, scale: int, color: str) -> list[str]:
        out = []
        pen = x
        for ch in text:
            glyph = glyphs.get(ch)
            if glyph is None:
                continue
            rows, top, advance = glyph
            for row_index, row in enumerate(rows):
                run_start = None
                for col, cell in enumerate(row + "."):
                    if cell == "#" and run_start is None:
                        run_start = col
                    elif cell != "#" and run_start is not None:
                        out.append(
                            f'<rect x="{pen + run_start * scale}" y="{baseline + (top + row_index) * scale}" '
                            f'width="{(col - run_start) * scale}" height="{scale}" fill="{color}"/>'
                        )
                        run_start = None
            pen += advance * scale
        return out

    svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="760" height="420" viewBox="0 0 380 210">',
        '<rect width="380" height="210" fill="#0b0b12"/>',
        '<g>',
    ]
    svg += bitmap_text("TOKEN ISLAND 2.28M TODAY", 12, 26, 2, "#3be8b0")
    svg += bitmap_text("in 829k · cache 1.27m · out 104k", 12, 46, 1, "#a39fc4")
    svg += bitmap_text("CLAUDE-SONNET-4-6  792K  35%", 12, 62, 1, "#f4f2ff")
    svg += bitmap_text("9d STREAK · 58 TURNS TODAY", 12, 78, 1, "#ffc857")
    svg += bitmap_text("~$6.11  ▲ 12%", 12, 94, 1, "#b388ff")
    svg += ['</g>', "</svg>"]
    OUT_PREVIEW.write_text("\n".join(svg) + "\n", encoding="utf-8")

    print(f"wrote {OUT_TS} ({OUT_TS.stat().st_size} bytes)")
    print(f"ascent={max_ascent} descent={max_descent} cap={CAP_HEIGHT}")
    print(f"advance range: {sorted({e['advance'] for e in entries})}")
    print(f"preview: {OUT_PREVIEW}")


if __name__ == "__main__":
    main()
