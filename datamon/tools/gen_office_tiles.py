#!/usr/bin/env python3
"""Deterministic generator for DATAMON's warm industrial-loft office surface tiles.

Emits seamless 32x32 RGBA PNG tiles into datamon/tiles/, matching the approved
top-down concept (datamon/.design/office-concept-topdown.png): warm-orange
hardwood plank floor, red + white exposed-brick walls (full autotile set),
industrial window with blinds, wood support column, and overhead silver ducting.

Why a programmatic generator instead of an image model? (same rationale as gen_tiles.py)
  - Guarantees exactly 32x32, no anti-aliasing, and edges that wrap seamlessly.
  - Fully reproducible & version-controllable (no API calls, no manual slicing).
  - Re-runnable offline: `uv run --with pillow python datamon/tools/gen_office_tiles.py`

Seamlessness contract (ticket #019 Must-Not: "no visible seam when tiled 2x2"):
  - Hardwood = vertical boards with edges at x in {0,8,16,24} (period 8 | 32) and
    full-height grain streaks -> wraps on all four edges.
  - Brick = horizontal courses every 8px (period 8 | 32) in running bond with
    head-joints whose pattern period (16) divides 32 -> wraps on all four edges.
Window / column / duct are placed objects (not floor fill); they read cleanly at
32px but are not required to tile 2x2.

Run:  uv run --with pillow python datamon/tools/gen_office_tiles.py
"""
from __future__ import annotations

import os
import random
from PIL import Image, ImageDraw

TILE = 32
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "tiles"))

# --- Warm industrial-loft palette (RGBA), grounded in office-concept-topdown.png ---
# Hardwood (warm orange planks)
HW       = (200, 112, 47, 255)   # board face
HW_LT    = (216, 130, 64, 255)   # lit grain / highlight board
HW_DK    = (150, 80, 32, 255)    # board-edge seam (between planks)
HW_GR    = (178, 96, 40, 255)    # subtle grain streak
HW_B     = (208, 122, 55, 255)   # variant-b board face (slightly lighter)
HW_C     = (190, 104, 42, 255)   # variant-c board face (slightly darker)
HW_KNOT  = (138, 72, 28, 255)    # variant-c knot accent

# Red exposed brick
BR       = (170, 86, 58, 255)    # brick face
BR_LT    = (196, 112, 80, 255)   # lit brick / edge highlight
BR_DK    = (138, 64, 42, 255)    # brick shade
BR_MORT  = (96, 52, 40, 255)     # dark mortar

# White-painted brick
BW       = (206, 194, 178, 255)  # painted brick face
BW_LT    = (224, 214, 200, 255)  # highlight
BW_DK    = (176, 162, 144, 255)  # shade
BW_MORT  = (150, 138, 122, 255)  # mortar

# Wood support column
WD       = (140, 90, 48, 255)
WD_LT    = (170, 116, 66, 255)
WD_DK    = (104, 64, 32, 255)

# Industrial window
WIN_FR   = (52, 44, 40, 255)     # dark steel frame
WIN_FR_LT= (84, 74, 66, 255)
WIN_BL   = (176, 184, 190, 255)  # blind slat (cool light grey)
WIN_BL_DK= (138, 148, 156, 255)  # slat shadow line
WIN_GLASS= (108, 122, 132, 255)  # glimpse of glass behind blinds

# Overhead silver ducting + red pipe accent
DUCT     = (180, 174, 162, 255)  # warm silver
DUCT_LT  = (208, 204, 194, 255)
DUCT_DK  = (140, 134, 124, 255)
PIPE_RED = (190, 72, 52, 255)    # red pipe accent
PIPE_RED_DK = (150, 52, 38, 255)

CLEAR    = (0, 0, 0, 0)


def new_tile() -> Image.Image:
    return Image.new("RGBA", (TILE, TILE), CLEAR)


def fill(img, color):
    ImageDraw.Draw(img).rectangle([0, 0, TILE - 1, TILE - 1], fill=color)


# --- Hardwood floor (seamless: vertical boards, period-8 edges, full-height grain) ---
def _hardwood(face, grain_seed, knot=False):
    img = new_tile()
    fill(img, face)
    d = ImageDraw.Draw(img)
    # board-edge seams at x in {0,8,16,24} -> wraps horizontally (period 8 | 32)
    for x in (0, 8, 16, 24):
        d.line([x, 0, x, TILE - 1], fill=HW_DK)
        d.line([x + 1, 0, x + 1, TILE - 1], fill=HW_LT)  # lit edge just right of seam
    # full-height grain streaks (interior of each board) -> wrap vertically cleanly
    rng = random.Random(grain_seed)
    for board in range(4):
        cx = board * 8 + 4
        for _ in range(2):
            gx = cx + rng.choice((-1, 0, 1))
            col = HW_GR if rng.random() < 0.6 else HW_LT
            d.line([gx, 0, gx, TILE - 1], fill=col)
    if knot:
        # a small oval knot fully inside one board (does not touch any edge)
        d.ellipse([18, 11, 22, 17], fill=HW_KNOT)
        d.ellipse([19, 12, 21, 16], fill=HW_DK)
    return img


def hardwood_a():
    return _hardwood(HW, 19001)


def hardwood_b():
    return _hardwood(HW_B, 19002)


def hardwood_c():
    return _hardwood(HW_C, 19003, knot=True)


# --- Brick (seamless running bond: courses period 8, head-joints period 16) ---
def _brick_base(face, lt, dk, mort):
    """Red/white brick, running bond. Seamless on all edges."""
    img = new_tile()
    fill(img, face)
    d = ImageDraw.Draw(img)
    # horizontal mortar courses every 8px -> y in {0,8,16,24}; wraps vertically
    for y in (0, 8, 16, 24):
        d.line([0, y, TILE - 1, y], fill=mort)
    # subtle per-course shading: lit just under each course, shade just above next
    for y in (1, 9, 17, 25):
        d.line([0, y, TILE - 1, y], fill=lt)
    for y in (6, 14, 22, 30):
        d.line([0, y, TILE - 1, y], fill=dk)
    # vertical head-joints, alternating offset (running bond); period 16 | 32, x=0 wraps
    for course, y in enumerate((0, 8, 16, 24)):
        joints = (0, 16) if course % 2 == 0 else (8, 24)
        for jx in joints:
            d.line([jx, y, jx, y + 7], fill=mort)
    return img, d


def brick_red():
    img, _ = _brick_base(BR, BR_LT, BR_DK, BR_MORT)
    return img


def brick_white():
    img, _ = _brick_base(BW, BW_LT, BW_DK, BW_MORT)
    return img


def _brick_edges(d, lit_top=False, lit_bottom=False, lit_left=False, lit_right=False):
    """Directional 2px highlight on the exposed wall face(s) for autotile pieces."""
    if lit_top:
        d.line([0, 0, TILE - 1, 0], fill=BR_LT)
        d.line([0, 1, TILE - 1, 1], fill=BR_LT)
    if lit_bottom:
        d.line([0, TILE - 1, TILE - 1, TILE - 1], fill=BR_DK)
        d.line([0, TILE - 2, TILE - 1, TILE - 2], fill=BR_DK)
    if lit_left:
        d.line([0, 0, 0, TILE - 1], fill=BR_LT)
        d.line([1, 0, 1, TILE - 1], fill=BR_LT)
    if lit_right:
        d.line([TILE - 1, 0, TILE - 1, TILE - 1], fill=BR_DK)
        d.line([TILE - 2, 0, TILE - 2, TILE - 1], fill=BR_DK)
    return d


# Regenerate the round-1 wall autotile set in matching red brick so the wall
# family reads as one cohesive office brick (filenames unchanged -> still loadable).
def wall_h():
    img, d = _brick_base(BR, BR_LT, BR_DK, BR_MORT)
    _brick_edges(d, lit_top=True, lit_bottom=True)
    return img


def wall_v():
    img, d = _brick_base(BR, BR_LT, BR_DK, BR_MORT)
    _brick_edges(d, lit_left=True, lit_right=True)
    return img


def wall_corner_tl():
    img, d = _brick_base(BR, BR_LT, BR_DK, BR_MORT)
    _brick_edges(d, lit_top=True, lit_left=True)
    return img


def wall_corner_tr():
    img, d = _brick_base(BR, BR_LT, BR_DK, BR_MORT)
    _brick_edges(d, lit_top=True, lit_right=True)
    return img


def wall_corner_bl():
    img, d = _brick_base(BR, BR_LT, BR_DK, BR_MORT)
    _brick_edges(d, lit_bottom=True, lit_left=True)
    return img


def wall_corner_br():
    img, d = _brick_base(BR, BR_LT, BR_DK, BR_MORT)
    _brick_edges(d, lit_bottom=True, lit_right=True)
    return img


# --- Industrial window with horizontal blinds (placed object, full-bleed) ---
def window_h():
    img = new_tile()
    d = ImageDraw.Draw(img)
    # dark steel frame
    d.rectangle([0, 0, TILE - 1, TILE - 1], fill=WIN_FR)
    d.rectangle([0, 0, TILE - 1, 1], fill=WIN_FR_LT)  # lit top of frame
    # inner glass cavity
    d.rectangle([3, 3, TILE - 4, TILE - 4], fill=WIN_GLASS)
    # horizontal blind slats across the cavity
    for y in range(4, TILE - 4, 3):
        d.line([3, y, TILE - 4, y], fill=WIN_BL)
        d.line([3, y + 1, TILE - 4, y + 1], fill=WIN_BL_DK)
    # central mullion (steel divider)
    d.line([TILE // 2, 2, TILE // 2, TILE - 3], fill=WIN_FR)
    d.line([TILE // 2 + 1, 2, TILE // 2 + 1, TILE - 3], fill=WIN_FR_LT)
    return img


# --- Wood support column (solid vertical beam, fills tile) ---
def column():
    img = new_tile()
    fill(img, WD)
    d = ImageDraw.Draw(img)
    # lit left edge, shadow right edge (rounded-beam read)
    d.line([0, 0, 0, TILE - 1], fill=WD_LT)
    d.line([1, 0, 1, TILE - 1], fill=WD_LT)
    d.line([TILE - 1, 0, TILE - 1, TILE - 1], fill=WD_DK)
    d.line([TILE - 2, 0, TILE - 2, TILE - 1], fill=WD_DK)
    # vertical grain streaks
    rng = random.Random(19010)
    for _ in range(6):
        gx = rng.randrange(4, TILE - 4)
        col = WD_DK if rng.random() < 0.5 else WD_LT
        d.line([gx, 0, gx, TILE - 1], fill=col)
    # top & bottom cap shading (beam segment)
    d.line([0, 0, TILE - 1, 0], fill=WD_LT)
    d.line([0, TILE - 1, TILE - 1, TILE - 1], fill=WD_DK)
    return img


# --- Overhead silver ducting with red pipe accent (placed accent) ---
def duct():
    img = new_tile()
    d = ImageDraw.Draw(img)
    # silver duct body (horizontal band, leaves transparent margin top/bottom)
    d.rectangle([0, 6, TILE - 1, 25], fill=DUCT)
    d.rectangle([0, 6, TILE - 1, 7], fill=DUCT_LT)   # lit top
    d.rectangle([0, 24, TILE - 1, 25], fill=DUCT_DK)  # shade bottom
    # segment seams (vertical), so a run of ducts reads as joined sections
    for x in (10, 21):
        d.line([x, 6, x, 25], fill=DUCT_DK)
        d.line([x + 1, 6, x + 1, 25], fill=DUCT_LT)
    # red pipe accent running along the bottom
    d.rectangle([0, 27, TILE - 1, 30], fill=PIPE_RED)
    d.line([0, 27, TILE - 1, 27], fill=PIPE_RED)
    d.line([0, 30, TILE - 1, 30], fill=PIPE_RED_DK)
    return img


TILES = {
    "hardwood-a": hardwood_a,
    "hardwood-b": hardwood_b,
    "hardwood-c": hardwood_c,
    "brick-red": brick_red,
    "brick-white": brick_white,
    "wall-h": wall_h,
    "wall-v": wall_v,
    "wall-corner-tl": wall_corner_tl,
    "wall-corner-tr": wall_corner_tr,
    "wall-corner-bl": wall_corner_bl,
    "wall-corner-br": wall_corner_br,
    "window-h": window_h,
    "column": column,
    "duct": duct,
}


def main():
    os.makedirs(OUT, exist_ok=True)
    for slug, fn in TILES.items():
        img = fn()
        assert img.size == (TILE, TILE), f"{slug} is {img.size}, expected ({TILE},{TILE})"
        path = os.path.join(OUT, f"{slug}.png")
        img.save(path, "PNG")
        print(f"wrote {path}")
    print(f"done: {len(TILES)} office tiles -> {OUT}")


if __name__ == "__main__":
    main()
