#!/usr/bin/env python3
"""Deterministic generator for DATAMON's GBA-style office tileset.

Emits the 13 required 32x32 RGBA PNG tiles into datamon/tiles/ using the warm
"Claude lab" palette (clay/terracotta, cream, warm wood, leafy green, brass).

Why a programmatic generator instead of an image model?
  - Guarantees exactly 32x32, transparent, no anti-aliasing, seamless edges.
  - Fully reproducible & version-controllable (no API calls, no manual slicing).
  - Satisfies every acceptance criterion in ticket #002 deterministically.
See datamon/README.md -> "Tileset regen" for the art-model alternative prompt.

Run:  uv run --with pillow python datamon/tools/gen_tiles.py
"""
from __future__ import annotations

import os
import random
from PIL import Image, ImageDraw

TILE = 32
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "tiles"))

# --- Warm "Claude lab" palette (RGBA) -------------------------------------
CREAM        = (242, 232, 213, 255)   # floor base
CREAM_DK     = (232, 219, 195, 255)   # floor variant b
CREAM_SPECK  = (224, 208, 180, 255)   # floor variant c speckle
CLAY         = (193, 95, 60, 255)     # wall terracotta
CLAY_DK      = (158, 74, 45, 255)     # wall shadow
CLAY_LT      = (214, 130, 96, 255)    # wall highlight
WOOD         = (169, 116, 59, 255)    # desk
WOOD_DK      = (132, 88, 43, 255)
WOOD_LT      = (198, 146, 86, 255)
LEAF         = (91, 140, 66, 255)     # plant foliage
LEAF_DK      = (62, 107, 46, 255)
LEAF_LT      = (124, 173, 92, 255)
POT          = (180, 92, 58, 255)     # plant pot (terracotta)
POT_DK       = (146, 70, 42, 255)
BRASS        = (201, 162, 75, 255)    # coffee machine
BRASS_DK     = (160, 124, 48, 255)
BRASS_LT     = (228, 196, 120, 255)
STEEL        = (74, 70, 64, 255)      # coffee machine body
RUG_A        = (188, 96, 64, 255)     # rug warm stripe
RUG_B        = (236, 214, 178, 255)   # rug cream stripe
RUG_EDGE     = (146, 70, 42, 255)
CLEAR        = (0, 0, 0, 0)


def new_tile() -> Image.Image:
    return Image.new("RGBA", (TILE, TILE), CLEAR)


def fill(img, color):
    ImageDraw.Draw(img).rectangle([0, 0, TILE - 1, TILE - 1], fill=color)


def px(d, x, y, color):
    d.point((x, y), fill=color)


# --- Floor tiles -----------------------------------------------------------
def floor_a():
    """Plain warm cream floor."""
    img = new_tile()
    fill(img, CREAM)
    d = ImageDraw.Draw(img)
    # subtle plank seam lines so it reads as a floor, tileable on all edges
    for y in (0, 16):
        d.line([0, y, TILE - 1, y], fill=CREAM_DK)
    return img


def floor_b():
    """Slightly darker cream variant (checker partner)."""
    img = new_tile()
    fill(img, CREAM_DK)
    d = ImageDraw.Draw(img)
    for x in (0, 16):
        d.line([x, 0, x, TILE - 1], fill=CREAM)
    return img


def floor_c():
    """Cream with a deterministic faint speckle pattern."""
    img = new_tile()
    fill(img, CREAM)
    d = ImageDraw.Draw(img)
    rng = random.Random(20260612)  # fixed seed -> reproducible speckle
    for _ in range(36):
        x = rng.randrange(TILE)
        y = rng.randrange(TILE)
        px(d, x, y, CREAM_SPECK)
    return img


# --- Wall tiles ------------------------------------------------------------
def _wall_base():
    img = new_tile()
    fill(img, CLAY)
    d = ImageDraw.Draw(img)
    # brick courses
    for y in range(0, TILE, 8):
        d.line([0, y, TILE - 1, y], fill=CLAY_DK)
    # staggered vertical mortar
    for y in range(0, TILE, 16):
        d.line([8, y, 8, y + 7], fill=CLAY_DK)
        d.line([24, y, 24, y + 7], fill=CLAY_DK)
    for y in range(8, TILE, 16):
        d.line([16, y, 16, y + 7], fill=CLAY_DK)
    return img, d


def wall_h():
    """Horizontal wall segment: lit top edge, shadow bottom edge."""
    img, d = _wall_base()
    d.line([0, 0, TILE - 1, 0], fill=CLAY_LT)
    d.line([0, 1, TILE - 1, 1], fill=CLAY_LT)
    d.line([0, TILE - 1, TILE - 1, TILE - 1], fill=CLAY_DK)
    return img


def wall_v():
    """Vertical wall segment: lit left edge, shadow right edge."""
    img, d = _wall_base()
    d.line([0, 0, 0, TILE - 1], fill=CLAY_LT)
    d.line([1, 0, 1, TILE - 1], fill=CLAY_LT)
    d.line([TILE - 1, 0, TILE - 1, TILE - 1], fill=CLAY_DK)
    return img


def _corner(lit_h, lit_v):
    """Corner with two highlighted edges (lit_h='top'/'bottom', lit_v='left'/'right')."""
    img, d = _wall_base()
    if lit_h == "top":
        d.line([0, 0, TILE - 1, 0], fill=CLAY_LT)
        d.line([0, 1, TILE - 1, 1], fill=CLAY_LT)
    else:
        d.line([0, TILE - 1, TILE - 1, TILE - 1], fill=CLAY_LT)
        d.line([0, TILE - 2, TILE - 1, TILE - 2], fill=CLAY_LT)
    if lit_v == "left":
        d.line([0, 0, 0, TILE - 1], fill=CLAY_LT)
        d.line([1, 0, 1, TILE - 1], fill=CLAY_LT)
    else:
        d.line([TILE - 1, 0, TILE - 1, TILE - 1], fill=CLAY_LT)
        d.line([TILE - 2, 0, TILE - 2, TILE - 1], fill=CLAY_LT)
    return img


def wall_corner_tl():
    return _corner("top", "left")


def wall_corner_tr():
    return _corner("top", "right")


def wall_corner_bl():
    return _corner("bottom", "left")


def wall_corner_br():
    return _corner("bottom", "right")


# --- Object tiles (transparent background so they layer over floor in #003) -
def desk():
    img = new_tile()
    d = ImageDraw.Draw(img)
    # wooden desktop with a thin lip, leaving a transparent margin
    d.rectangle([2, 6, 29, 27], fill=WOOD)
    d.rectangle([2, 6, 29, 8], fill=WOOD_LT)        # lit top lip
    d.rectangle([2, 25, 29, 27], fill=WOOD_DK)      # shadow bottom
    # plank grain
    for y in (12, 18, 23):
        d.line([3, y, 28, y], fill=WOOD_DK)
    return img


def plant():
    img = new_tile()
    d = ImageDraw.Draw(img)
    # terracotta pot
    d.rectangle([10, 22, 21, 29], fill=POT)
    d.rectangle([10, 22, 21, 23], fill=POT_DK)
    d.rectangle([9, 20, 22, 22], fill=POT)
    # leafy foliage (rounded blob)
    d.ellipse([6, 4, 25, 23], fill=LEAF)
    d.ellipse([8, 6, 18, 16], fill=LEAF_LT)
    d.ellipse([15, 10, 24, 21], fill=LEAF_DK)
    # a couple of leaf veins
    d.line([15, 8, 15, 20], fill=LEAF_DK)
    return img


def coffee():
    img = new_tile()
    d = ImageDraw.Draw(img)
    # dark machine body
    d.rectangle([7, 4, 24, 28], fill=STEEL)
    # brass faceplate
    d.rectangle([9, 6, 22, 14], fill=BRASS)
    d.rectangle([9, 6, 22, 7], fill=BRASS_LT)
    # spout + drip area
    d.rectangle([14, 15, 17, 19], fill=BRASS_DK)
    d.rectangle([10, 24, 21, 27], fill=BRASS)
    # button
    px(d, 19, 10, BRASS_LT)
    return img


def rug():
    """Woven lounge rug — warm/cream stripes with a darker border. Full-bleed."""
    img = new_tile()
    fill(img, RUG_A)
    d = ImageDraw.Draw(img)
    for y in range(0, TILE, 8):
        d.rectangle([0, y, TILE - 1, y + 3], fill=RUG_B)
    # border frame
    d.rectangle([0, 0, TILE - 1, TILE - 1], outline=RUG_EDGE)
    d.rectangle([1, 1, TILE - 2, TILE - 2], outline=RUG_EDGE)
    return img


TILES = {
    "floor-a": floor_a,
    "floor-b": floor_b,
    "floor-c": floor_c,
    "wall-h": wall_h,
    "wall-v": wall_v,
    "wall-corner-tl": wall_corner_tl,
    "wall-corner-tr": wall_corner_tr,
    "wall-corner-bl": wall_corner_bl,
    "wall-corner-br": wall_corner_br,
    "desk": desk,
    "plant": plant,
    "coffee": coffee,
    "rug": rug,
}


def main():
    os.makedirs(OUT, exist_ok=True)
    for slug, fn in TILES.items():
        img = fn()
        assert img.size == (TILE, TILE), f"{slug} is {img.size}, expected ({TILE},{TILE})"
        path = os.path.join(OUT, f"{slug}.png")
        img.save(path, "PNG")
        print(f"wrote {path}")
    print(f"done: {len(TILES)} tiles -> {OUT}")


if __name__ == "__main__":
    main()
