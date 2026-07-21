#!/usr/bin/env python3
"""Generate SANDBOX-themed NSIS installer bitmap assets (24-bit BMP)."""

from __future__ import annotations

import io
import math
import struct
from functools import lru_cache
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - optional at runtime
    Image = ImageDraw = ImageFont = None  # type: ignore[misc, assignment]

try:
    import cairosvg
except (ImportError, OSError):  # pragma: no cover - cairo DLL often missing on Windows
    cairosvg = None  # type: ignore[misc, assignment]

# Dark installer void + burnt-orange accent (matches icon-desktop.svg / index.css)
INSTALLER_VOID = (12, 4, 14)  # #0C040E
ICON_TILE_FILL = (13, 10, 13)  # #0D0A0D — onboarding tile interior
ACCENT_ORANGE = (216, 89, 10)  # #D8590A — icon S, installer highlights
ACCENT_ORANGE_DEEP = (184, 71, 8)  # #B84708 — app-outline, tile border depth

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "src-tauri" / "nsis"
ICON_SVG = ROOT / "public" / "icon-desktop.svg"
ICON_PNG_CANDIDATES = (
    ROOT / "src-tauri" / "icons" / "128x128@2x.png",
    ROOT / "src-tauri" / "icons" / "icon.png",
    ROOT / "src-tauri" / "icons" / "Square310x310Logo.png",
)

# S glyph path from public/icon-desktop.svg (512 viewBox)
ICON_S_PATH = (
    "M318.921142578125 294.57177734375Q318.921142578125 309.76220703125 "
    "313.261962890625 321.2294921875Q307.602783203125 332.69677734375 "
    "297.922607421875 340.366455078125Q288.242431640625 348.0361328125 "
    "275.285888671875 351.908203125Q262.329345703125 355.7802734375 "
    "247.585693359375 355.7802734375Q237.607666015625 355.7802734375 "
    "229.04443359375 354.14208984375Q220.481201171875 352.50390625 "
    "213.928466796875 350.195556640625Q207.375732421875 347.88720703125 "
    "202.982421875 345.35546875Q198.589111328125 342.82373046875 "
    "196.653076171875 340.8876953125Q194.717041015625 338.95166015625 "
    "193.89794921875 335.302978515625Q193.078857421875 331.654296875 "
    "193.078857421875 324.8037109375Q193.078857421875 320.18701171875 "
    "193.376708984375 317.0595703125Q193.674560546875 313.93212890625 "
    "194.3447265625 311.99609375Q195.014892578125 310.06005859375 "
    "196.1318359375 309.240966796875Q197.248779296875 308.421875 "
    "198.738037109375 308.421875Q200.822998046875 308.421875 "
    "204.62060546875 310.879150390625Q208.418212890625 313.33642578125 "
    "214.375244140625 316.31494140625Q220.332275390625 319.29345703125 "
    "228.59765625 321.750732421875Q236.863037109375 324.2080078125 "
    "247.734619140625 324.2080078125Q254.883056640625 324.2080078125 "
    "260.542236328125 322.495361328125Q266.201416015625 320.78271484375 "
    "270.14794921875 317.6552734375Q274.094482421875 314.52783203125 "
    "276.179443359375 309.9111328125Q278.264404296875 305.29443359375 "
    "278.264404296875 299.63525390625Q278.264404296875 293.08251953125 "
    "274.690185546875 288.391357421875Q271.115966796875 283.7001953125 "
    "265.38232421875 280.051513671875Q259.648681640625 276.40283203125 "
    "252.351318359375 273.200927734375Q245.053955078125 269.9990234375 "
    "237.309814453125 266.4248046875Q229.565673828125 262.8505859375 "
    "222.268310546875 258.308349609375Q214.970947265625 253.76611328125 "
    "209.2373046875 247.436767578125Q203.503662109375 241.107421875 "
    "199.929443359375 232.4697265625Q196.355224609375 223.83203125 "
    "196.355224609375 211.76904296875Q196.355224609375 197.9189453125 "
    "201.4931640625 187.419677734375Q206.631103515625 176.92041015625 "
    "215.34326171875 169.995361328125Q224.055419921875 163.0703125 "
    "235.89501953125 159.64501953125Q247.734619140625 156.2197265625 "
    "260.989013671875 156.2197265625Q267.839599609375 156.2197265625 "
    "274.690185546875 157.26220703125Q281.540771484375 158.3046875 "
    "287.497802734375 160.091796875Q293.454833984375 161.87890625 "
    "298.071533203125 164.11279296875Q302.688232421875 166.3466796875 "
    "304.177490234375 167.8359375Q305.666748046875 169.3251953125 "
    "306.18798828125 170.36767578125Q306.709228515625 171.41015625 "
    "307.08154296875 173.122802734375Q307.453857421875 174.83544921875 "
    "307.602783203125 177.441650390625Q307.751708984375 180.0478515625 "
    "307.751708984375 183.919921875Q307.751708984375 188.23876953125 "
    "307.5283203125 191.21728515625Q307.304931640625 194.19580078125 "
    "306.78369140625 196.1318359375Q306.262451171875 198.06787109375 "
    "305.29443359375 198.96142578125Q304.326416015625 199.85498046875 "
    "302.688232421875 199.85498046875Q301.050048828125 199.85498046875 "
    "297.475830078125 197.77001953125Q293.901611328125 195.68505859375 "
    "288.689208984375 193.227783203125Q283.476806640625 190.7705078125 "
    "276.626220703125 188.760009765625Q269.775634765625 186.74951171875 "
    "261.584716796875 186.74951171875Q255.180908203125 186.74951171875 "
    "250.415283203125 188.313232421875Q245.649658203125 189.876953125 "
    "242.44775390625 192.632080078125Q239.245849609375 195.38720703125 "
    "237.68212890625 199.25927734375Q236.118408203125 203.13134765625 "
    "236.118408203125 207.4501953125Q236.118408203125 213.85400390625 "
    "239.6181640625 218.545166015625Q243.117919921875 223.236328125 "
    "249.00048828125 226.885009765625Q254.883056640625 230.53369140625 "
    "262.329345703125 233.735595703125Q269.775634765625 236.9375 "
    "277.519775390625 240.51171875Q285.263916015625 244.0859375 "
    "292.710205078125 248.628173828125Q300.156494140625 253.17041015625 "
    "305.964599609375 259.499755859375Q311.772705078125 265.8291015625 "
    "315.346923828125 274.392333984375Q318.921142578125 282.95556640625 "
    "318.921142578125 294.57177734375Z"
)

FONT_S_CANDIDATES = [
    Path(r"C:\Windows\Fonts\segoeuib.ttf"),
    Path(r"C:\Windows\Fonts\arialbd.ttf"),
    Path("/usr/share/fonts/truetype/msttcorefonts/segoeuib.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
]

SIDEBAR_ICON_HALF = 38
HEADER_ICON_HALF = 22


def _installer_icon_svg(corner_radius: float, border_px: float) -> str:
    """Onboarding-style tile: dark interior, orange border, SVG S path (fallback)."""
    stroke_w = max(6, int(round(border_px * 512 / 76)))
    rx = int(round(corner_radius * 512 / 76))
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect x="{stroke_w // 2}" y="{stroke_w // 2}"
        width="{512 - stroke_w}" height="{512 - stroke_w}"
        rx="{rx}" ry="{rx}"
        fill="#0D0A0D" stroke="#D8590A" stroke-width="{stroke_w}"/>
  <path fill="#D8590A" d="{ICON_S_PATH}"/>
</svg>"""


def _accent_glyph_alpha(r: int, g: int, b: int, a: int) -> int:
    """Extract anti-aliased glyph alpha from Tauri-rendered icon PNG (orange S)."""
    if a < 8:
        return 0
    # Accept orange accent pixels; reject dark background
    if r + g + b < 80:
        return 0
    if g > 40 and r > g and b < 80:
        dist = (
            abs(r - ACCENT_ORANGE[0])
            + abs(g - ACCENT_ORANGE[1])
            + abs(b - ACCENT_ORANGE[2])
        )
        strength = max(0, 255 - dist * 2)
        return min(255, strength * a // 255)
    return 0


@lru_cache(maxsize=1)
def _load_s_glyph_mask() -> tuple | None:
    """S glyph alpha mask from pre-rendered Tauri icon PNG (icon-desktop.svg source)."""
    if Image is None:
        return None

    for path in ICON_PNG_CANDIDATES:
        if not path.exists():
            continue
        src = Image.open(path).convert("RGBA")
        px = src.load()
        mask = Image.new("L", src.size, 0)
        mp = mask.load()
        for y in range(src.size[1]):
            for x in range(src.size[0]):
                mp[x, y] = _accent_glyph_alpha(*px[x, y])
        bbox = mask.getbbox()
        if bbox is None:
            continue
        return mask.crop(bbox), path.name
    return None


def _draw_void_icon_tile(
    size: int,
    corner_radius: float,
    border_px: float,
    s_mask: Image.Image | None = None,
) -> Image.Image | None:
    """Onboarding-style tile: dark interior, orange border, clean sans-serif S."""
    if Image is None or ImageDraw is None:
        return None

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    inset = max(1, int(round(border_px * size / 76)))
    box = (inset, inset, size - inset - 1, size - inset - 1)
    radius = max(2, int(round(corner_radius * size / 76)))
    draw.rounded_rectangle(
        box, radius=radius, fill=ICON_TILE_FILL, outline=ACCENT_ORANGE, width=inset
    )

    if s_mask is not None:
        inner = max(8, size - inset * 6)
        scaled = s_mask.resize((inner, inner), Image.Resampling.LANCZOS)
        ox = (size - inner) // 2
        oy = (size - inner) // 2
        s_layer = Image.new("RGBA", (inner, inner), ACCENT_ORANGE + (255,))
        s_layer.putalpha(scaled)
        img.alpha_composite(s_layer, (ox, oy))
        return img

    font_path = next((p for p in FONT_S_CANDIDATES if p.exists()), None)
    if font_path is not None and ImageFont is not None:
        font = ImageFont.truetype(str(font_path), int(size * 0.52))
        bbox = draw.textbbox((0, 0), "S", font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = (size - tw) // 2 - bbox[0]
        ty = (size - th) // 2 - bbox[1]
        draw.text((tx, ty), "S", font=font, fill=ACCENT_ORANGE + (255,))

    return img


def _render_icon_tile_rgba(out_px: int, corner_radius: float, border_px: float) -> tuple | None:
    """Render HD icon tile; returns (pixels, width, height) or None."""
    if Image is None:
        return None

    render_scale = 4
    render_px = max(out_px * render_scale, 512)
    img: Image.Image | None = None
    renderer_note = "unavailable"

    # Primary: clean sans-serif S (matches onboarding hero proportions, orange accent)
    img = _draw_void_icon_tile(render_px, corner_radius, border_px)
    if img is not None:
        renderer_note = f"PIL font (Segoe Bold S) @ {render_px}px Lanczos"

    if img is None:
        glyph = _load_s_glyph_mask()
        if glyph is not None:
            s_mask, source_name = glyph
            img = _draw_void_icon_tile(render_px, corner_radius, border_px, s_mask)
            renderer_note = f"PNG mask ({source_name}) @ {render_px}px Lanczos"

    if img is None and cairosvg is not None:
        try:
            svg = _installer_icon_svg(corner_radius, border_px)
            png_bytes = cairosvg.svg2png(
                bytestring=svg.encode("utf-8"),
                output_width=render_px,
                output_height=render_px,
            )
            img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
            renderer_note = "cairosvg+SVG path (fallback)"
        except (OSError, ValueError):
            img = None

    if img is None:
        return None

    if out_px != render_px:
        img = img.resize((out_px, out_px), Image.Resampling.LANCZOS)

    pixels = img.load()
    return (
        tuple(tuple(pixels[x, y] for x in range(out_px)) for y in range(out_px)),
        out_px,
        out_px,
        renderer_note,
    )


@lru_cache(maxsize=4)
def _icon_tile_cache(out_px: int, corner_radius: float, border_px: float) -> tuple | None:
    return _render_icon_tile_rgba(out_px, corner_radius, border_px)


def _sample_icon_tile(
    lx: float,
    ly: float,
    half: float,
    corner_radius: float,
    border_px: float,
) -> tuple[int, int, int] | None:
    """Sample pre-rendered HD icon tile; None if outside tile bounds."""
    tile_px = int(math.ceil(half * 2))
    cached = _icon_tile_cache(tile_px, corner_radius, border_px)
    if cached is None:
        return None

    pixels, w, h, _renderer = cached
    if lx < -half or lx >= half or ly < -half or ly >= half:
        return None

    u = (lx + half) / (half * 2)
    v = (ly + half) / (half * 2)
    x = min(w - 1, max(0, int(u * w)))
    y = min(h - 1, max(0, int(v * h)))
    r, g, b, a = pixels[y][x]
    if a < 16:
        return None
    return (r, g, b)


def write_bmp(path: Path, width: int, height: int, pixel_fn) -> None:
    row_stride = ((width * 3 + 3) // 4) * 4
    pixel_data_size = row_stride * height
    file_size = 14 + 40 + pixel_data_size

    with path.open("wb") as f:
        f.write(b"BM")
        f.write(struct.pack("<I", file_size))
        f.write(struct.pack("<HH", 0, 0))
        f.write(struct.pack("<I", 14 + 40))

        f.write(struct.pack("<I", 40))
        f.write(struct.pack("<ii", width, height))
        f.write(struct.pack("<HHI", 1, 24, 0))
        f.write(struct.pack("<I", pixel_data_size))
        f.write(struct.pack("<iiii", 2835, 2835, 0, 0))

        row = bytearray(row_stride)
        for y in range(height - 1, -1, -1):
            for x in range(width):
                r, g, b = pixel_fn(x, y, width, height)
                offset = x * 3
                row[offset : offset + 3] = bytes((b, g, r))
            f.write(row)


def sidebar_pixel(x: int, y: int, w: int, h: int) -> tuple[int, int, int]:
    """Uniform void background with centered HD S icon tile."""
    icon_cx, icon_cy = w // 2, 118
    icon_color = _sample_icon_tile(
        x - icon_cx,
        y - icon_cy,
        SIDEBAR_ICON_HALF,
        corner_radius=16,
        border_px=1.5,
    )
    if icon_color is not None:
        return icon_color
    return INSTALLER_VOID


def header_pixel(x: int, y: int, w: int, h: int) -> tuple[int, int, int]:
    """Uniform void header with compact HD S icon."""
    icon_cx, icon_cy = 30, h // 2
    icon_color = _sample_icon_tile(
        x - icon_cx,
        y - icon_cy,
        HEADER_ICON_HALF,
        corner_radius=9,
        border_px=1.2,
    )
    if icon_color is not None:
        return icon_color
    return INSTALLER_VOID


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    probe = _icon_tile_cache(76, 16, 1.5)
    renderer = probe[3] if probe else "unavailable"
    if probe is None:
        print("Warning: icon renderer unavailable — sidebar/header S may be missing")

    write_bmp(OUT_DIR / "sidebar.bmp", 164, 314, sidebar_pixel)
    write_bmp(OUT_DIR / "header.bmp", 150, 57, header_pixel)
    write_bmp(OUT_DIR / "header-uninstall.bmp", 150, 57, header_pixel)

    print(f"Wrote NSIS assets to {OUT_DIR}")
    print(
        f"  void=#0C040E tile=#0D0A0D accent=#D8590A deep=#B84708 "
        f"icon={ICON_SVG.name} renderer={renderer}"
    )


if __name__ == "__main__":
    main()
