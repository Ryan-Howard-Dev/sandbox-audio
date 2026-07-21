#!/usr/bin/env python3
"""Regenerate Android mipmap launcher PNGs — single-layer dark bg + orange S (no vinyl rings)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"

BG = (7, 8, 12)  # #07080C
ORANGE = (194, 65, 12)  # #C2410C

DENSITIES = {
    "mipmap-ldpi": 81,
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}

FONT_CANDIDATES = [
    Path(r"C:\Windows\Fonts\segoeuib.ttf"),
    Path(r"C:\Windows\Fonts\arialbd.ttf"),
]


def pick_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    raise RuntimeError("No bold system font found for launcher S glyph")


def draw_foreground(size: int) -> Image.Image:
    """Transparent adaptive foreground: large orange S only."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font_size = round(size * 0.46)
    font = pick_font(font_size)
    bbox = font.getbbox("S")
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1]
    draw.text((x, y), "S", font=font, fill=ORANGE)
    return img


def draw_background(size: int) -> Image.Image:
    return Image.new("RGB", (size, size), BG)


def composite_launcher(size: int, foreground: Image.Image, background: Image.Image) -> Image.Image:
    out = background.copy().convert("RGBA")
    out.alpha_composite(foreground)
    return out


def write_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if image.mode == "RGBA":
        image.save(path, "PNG")
    else:
        image.convert("RGB").save(path, "PNG")


def main() -> int:
    for folder, size in DENSITIES.items():
        out_dir = RES / folder
        fg = draw_foreground(size)
        bg = draw_background(size)
        full = composite_launcher(size, fg, bg)

        write_png(out_dir / "ic_launcher_foreground.png", fg)
        write_png(out_dir / "ic_launcher_background.png", bg)
        write_png(out_dir / "ic_launcher.png", full)
        write_png(out_dir / "ic_launcher_round.png", full)
        print(f"Wrote {folder} ({size}px)")

    print("Android launcher PNGs regenerated (S only, no rings).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
