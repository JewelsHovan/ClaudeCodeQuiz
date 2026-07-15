#!/usr/bin/env python3
"""Verify the DATAMON tileset: every required slug exists as a 32x32 PNG.

Run:  uv run --with pillow python datamon/tools/check_tiles.py
Exit 0 = all good; exit 1 = a tile is missing or wrong size.
"""
from __future__ import annotations

import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TILES = os.path.normpath(os.path.join(HERE, "..", "tiles"))

REQUIRED = [
    "floor-a", "floor-b", "floor-c",
    "wall-h", "wall-v",
    "wall-corner-tl", "wall-corner-tr", "wall-corner-bl", "wall-corner-br",
    "desk", "plant", "coffee", "rug",
]


def main() -> int:
    errors = []
    for slug in REQUIRED:
        path = os.path.join(TILES, f"{slug}.png")
        if not os.path.exists(path):
            errors.append(f"MISSING: {slug}.png")
            continue
        with Image.open(path) as im:
            if im.size != (32, 32):
                errors.append(f"WRONG SIZE: {slug}.png is {im.size}, expected (32, 32)")
            elif im.mode != "RGBA":
                errors.append(f"NOT RGBA: {slug}.png is mode {im.mode}")
    if errors:
        print("\n".join(errors))
        print(f"FAIL: {len(errors)} problem(s)")
        return 1
    print(f"OK: all {len(REQUIRED)} tiles present, 32x32 RGBA")
    return 0


if __name__ == "__main__":
    sys.exit(main())
