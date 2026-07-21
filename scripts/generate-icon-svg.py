#!/usr/bin/env python3
"""Generate public/icon-desktop.svg from SANDBOX reference palette.

public/icon.svg (void #07080c app favicon) is maintained separately — do not overwrite.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
REF = Path(
    r"C:\Users\RH\.cursor\projects\c-Users-RH-Downloads-sovereign-music-console\assets"
    r"\c__Users_RH_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-ffb749c9-f2c8-4228-bb24-8f2427ae2f3c.png"
)
OUT_DESKTOP = ROOT / "public" / "icon-desktop.svg"

# SANDBOX brand palette (reference theme)
BG_GREY_HEX = "#282829"
BG_EDGE_HEX = "#050505"
BG_CENTER_HEX = "#1A0B16"
ORANGE_HEX = "#D8590A"
ORANGE_RGB = (216, 89, 10)
SIZE = 512

FONT_CANDIDATES = [
    ("segoeuib", Path(r"C:\Windows\Fonts\segoeuib.ttf")),
    ("arialbd", Path(r"C:\Windows\Fonts\arialbd.ttf")),
    ("calibrib", Path(r"C:\Windows\Fonts\calibrib.ttf")),
]


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def is_orange(rgb: tuple[int, int, int]) -> bool:
    r, g, b = rgb
    return r > 150 and g < 140 and b < 80


def glyph_path(font_path: Path, font_size: int) -> str:
    font = TTFont(font_path)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    glyph_name = cmap[ord("S")]

    units_per_em = font["head"].unitsPerEm
    scale = font_size / units_per_em

    bounds_pen = BoundsPen(glyph_set)
    glyph_set[glyph_name].draw(TransformPen(bounds_pen, (scale, 0, 0, -scale, 0, 0)))
    xmin, ymin, xmax, ymax = bounds_pen.bounds
    glyph_w = xmax - xmin
    glyph_h = ymax - ymin

    tx = (SIZE - glyph_w) / 2 - xmin
    ty = (SIZE + glyph_h) / 2 - ymax

    path_pen = SVGPathPen(glyph_set)
    glyph_set[glyph_name].draw(
        TransformPen(path_pen, (scale, 0, 0, -scale, tx, ty))
    )
    return path_pen.getCommands()


def render_preview(font_path: Path, font_size: int) -> Image.Image:
    bg = hex_to_rgb(BG_GREY_HEX)
    img = Image.new("RGB", (SIZE, SIZE), bg)
    draw = ImageDraw.Draw(img)
    pil_font = ImageFont.truetype(str(font_path), font_size)
    bbox = pil_font.getbbox("S")
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (SIZE - tw) // 2 - bbox[0]
    y = (SIZE - th) // 2 - bbox[1]
    draw.text((x, y), "S", font=pil_font, fill=ORANGE_RGB)
    return img


def diff_orange_mask(reference: Image.Image, candidate: Image.Image) -> int:
    mismatch = 0
    for y in range(SIZE):
        for x in range(SIZE):
            if is_orange(reference.getpixel((x, y))) != is_orange(candidate.getpixel((x, y))):
                mismatch += 1
    return mismatch


def pick_best_font(reference: Image.Image) -> tuple[Path, int, str]:
    best: tuple[int, Path, int, str] | None = None
    for name, font_path in FONT_CANDIDATES:
        if not font_path.exists():
            continue
        for font_size in range(260, 401, 5):
            preview = render_preview(font_path, font_size)
            score = diff_orange_mask(reference, preview)
            if best is None or score < best[0]:
                best = (score, font_path, font_size, name)
    if best is None:
        raise RuntimeError("No usable system font found for icon S")
    return best[1], best[2], best[3]


def write_desktop_svg(path_d: str) -> None:
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" role="img" aria-label="Sandbox Music">
  <defs>
    <linearGradient id="sandbox-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="{BG_EDGE_HEX}"/>
      <stop offset="50%" stop-color="{BG_CENTER_HEX}"/>
      <stop offset="100%" stop-color="{BG_EDGE_HEX}"/>
    </linearGradient>
  </defs>
  <rect width="{SIZE}" height="{SIZE}" fill="url(#sandbox-bg)"/>
  <path fill="{ORANGE_HEX}" d="{path_d}"/>
</svg>
"""
    OUT_DESKTOP.write_text(svg, encoding="utf-8")


def main() -> int:
    if not REF.exists():
        print(f"Reference image not found: {REF}", file=sys.stderr)
        return 1

    reference = Image.open(REF).convert("RGB").resize((SIZE, SIZE), Image.NEAREST)
    font_path, font_size, font_name = pick_best_font(reference)
    path_d = glyph_path(font_path, font_size)
    write_desktop_svg(path_d)
    print(f"Wrote {OUT_DESKTOP} (gradient + orange S)")
    print(
        f"  orange={ORANGE_HEX} edge={BG_EDGE_HEX} center={BG_CENTER_HEX} "
        f"grey={BG_GREY_HEX} font={font_name} size={font_size}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
