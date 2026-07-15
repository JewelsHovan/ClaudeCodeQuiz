#!/usr/bin/env python3
"""Validator for DATAMON office prop assets (ticket #020 testing checklist).

Asserts the committed prop package satisfies the contract child #021 consumes:
  - datamon/props/manifest.json is valid JSON with exactly the 15 required slugs.
  - Each NON-missing entry has widthPx/heightPx/tileW/tileH/anchorX/anchorY and a
    corresponding RGBA PNG file that is <=96px per side with a non-empty alpha bbox.
  - Each missing entry carries "missing": true (gap fallback for the renderer).

Run: uv run --with pillow python datamon/tools/check_props.py
Exit 0 = all checks pass; exit 1 = one or more failures (details on stderr).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
PROPS_DIR = HERE.parent / "props"
MANIFEST = PROPS_DIR / "manifest.json"

REQUIRED = {
    "couch", "kallax", "arc-lamp", "tv", "rug", "bar", "stool", "fridge",
    "coffee-counter", "starry-painting", "compass-sign", "radiator",
    "glass-wall", "desk", "office-chair",
}
FIELDS = ("widthPx", "heightPx", "tileW", "tileH", "anchorX", "anchorY")


def main() -> int:
    errs: list[str] = []

    if not MANIFEST.exists():
        print(f"FAIL: {MANIFEST} does not exist", file=sys.stderr)
        return 1
    try:
        entries = json.loads(MANIFEST.read_text())
    except json.JSONDecodeError as e:
        print(f"FAIL: manifest is not valid JSON: {e}", file=sys.stderr)
        return 1

    slugs = {e.get("slug") for e in entries}
    missing_slugs = REQUIRED - slugs
    extra_slugs = slugs - REQUIRED
    if missing_slugs:
        errs.append(f"manifest missing required slugs: {sorted(missing_slugs)}")
    if extra_slugs:
        errs.append(f"manifest has unexpected slugs: {sorted(extra_slugs)}")
    if len(entries) != len(REQUIRED):
        errs.append(f"manifest has {len(entries)} entries, expected {len(REQUIRED)}")

    present = 0
    for e in entries:
        slug = e.get("slug", "<no-slug>")
        if e.get("missing"):
            continue  # gap entry is valid by design
        present += 1
        for f in FIELDS:
            if f not in e:
                errs.append(f"{slug}: missing field '{f}'")
        png = PROPS_DIR / e.get("file", f"{slug}.png")
        if not png.exists():
            errs.append(f"{slug}: file {png.name} referenced but not found")
            continue
        with Image.open(png) as im:
            if im.mode != "RGBA":
                errs.append(f"{slug}: {png.name} is {im.mode}, expected RGBA")
            w, h = im.size
            if w > 96 or h > 96:
                errs.append(f"{slug}: {png.name} is {w}x{h}, exceeds 96px")
            if im.getbbox() is None:
                errs.append(f"{slug}: {png.name} is fully transparent (empty bbox)")
            if "widthPx" in e and (e["widthPx"], e["heightPx"]) != (w, h):
                errs.append(f"{slug}: manifest size {e['widthPx']}x{e['heightPx']} "
                            f"!= file {w}x{h}")

    if errs:
        print(f"FAIL: {len(errs)} problem(s):", file=sys.stderr)
        for m in errs:
            print(f"  - {m}", file=sys.stderr)
        return 1

    gaps = len(entries) - present
    print(f"PASS: {len(entries)} slugs, {present} props present, {gaps} gap entries.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
