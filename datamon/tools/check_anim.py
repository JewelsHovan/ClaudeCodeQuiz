#!/usr/bin/env python3
"""Verify the DATAMON animation sprite sheets: all 8 required sheets exist as 128×44 RGBA PNGs.

Run:  uv run --with pillow python datamon/tools/check_anim.py
Exit 0 = all good; exit 1 = a sheet is missing or wrong size / mode.
"""
from __future__ import annotations

import os
import sys
from PIL import Image

HERE  = os.path.dirname(os.path.abspath(__file__))
ANIM  = os.path.normpath(os.path.join(HERE, "..", "sprites", "anim"))

GAITS = ["walk", "run"]
DIRS  = ["down", "up", "left", "right"]
REQUIRED = [f"{g}_{d}" for g in GAITS for d in DIRS]  # 8 sheets

EXPECTED_SIZE = (128, 44)
EXPECTED_MODE = "RGBA"


def main() -> int:
    errors = []
    for slug in REQUIRED:
        path = os.path.join(ANIM, f"{slug}.png")
        if not os.path.exists(path):
            errors.append(f"MISSING: {slug}.png")
            continue
        with Image.open(path) as im:
            if im.size != EXPECTED_SIZE:
                errors.append(f"WRONG SIZE: {slug}.png is {im.size}, expected {EXPECTED_SIZE}")
            elif im.mode != EXPECTED_MODE:
                errors.append(f"NOT RGBA: {slug}.png is mode {im.mode}")
    if errors:
        print("\n".join(errors))
        print(f"FAIL: {len(errors)} problem(s)")
        return 1
    print(f"OK: all {len(REQUIRED)} anim sheets present, {EXPECTED_SIZE[0]}×{EXPECTED_SIZE[1]} RGBA")
    return 0


if __name__ == "__main__":
    sys.exit(main())
