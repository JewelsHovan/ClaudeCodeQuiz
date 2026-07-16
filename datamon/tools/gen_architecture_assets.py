#!/usr/bin/env python3
"""Generate DATAMON's deterministic 2× architecture review batch.

The generator is local-only: it uses Pillow primitives, writes exclusively to the
ignored staging/review roots, validates against the production art contract, and
never promotes into ``environment/accepted``. Promotion remains an explicit,
atomic review step.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
DATAMON = HERE.parent
BATCH_ID = "batch-architecture"
BATCH_DIR = DATAMON / ".environment-work" / "staging" / BATCH_ID
REVIEW_DIR = DATAMON / ".environment-work" / "review"
CLEAR = (0, 0, 0, 0)
BONE = (232, 223, 200, 255)
WALNUT = (91, 61, 38, 255)
STEEL = (45, 55, 72, 255)
MIDNIGHT = (8, 20, 38, 255)
CYAN = (69, 215, 232, 255)
RED = (239, 68, 68, 255)
BRICK = (123, 70, 56, 255)
SLATE = (112, 119, 130, 255)
NAVY = (36, 53, 75, 255)


def canvas(size, fill=CLEAR):
    return Image.new("RGBA", size, fill)


def wall(base, stone=False):
    """64×64 horizontal wall face with cap, reveal, courses, and true 2× detail."""
    image = canvas((64, 64), base)
    draw = ImageDraw.Draw(image)
    mortar = (52, 58, 68, 255) if stone else (58, 40, 31, 255)
    for y in range(0, 64, 16):
        offset = -16 if (y // 16) % 2 else 0
        for x in range(offset, 96, 32):
            delta = -(y // 16) * 4
            body = tuple(max(0, channel + delta) for channel in base[:3]) + (255,)
            light = tuple(min(255, channel + 18) for channel in base[:3]) + (255,)
            draw.rectangle((x + 2, y + 2, x + 30, y + 14), fill=body)
            draw.line((x + 2, y + 2, x + 30, y + 2), fill=light)
            # One-source-pixel material marks prove this is not a nearest-neighbour upscale.
            draw.point((x + 8 + (y // 16) * 2, y + 8), fill=tuple(max(0, c - 11) for c in body[:3]) + (255,))
            draw.point((x + 21, y + 11), fill=tuple(min(255, c + 9) for c in body[:3]) + (255,))
    for y in (0, 16, 32, 48):
        draw.line((0, y, 63, y), fill=mortar)
    cap = STEEL if not stone else (94, 101, 112, 255)
    draw.rectangle((0, 0, 63, 7), fill=cap)
    draw.line((0, 1, 63, 1), fill=BONE)
    draw.line((0, 7, 63, 7), fill=(20, 25, 34, 255))
    draw.rectangle((2, 8, 5, 63), fill=(35, 40, 49, 255))
    draw.line((6, 9, 6, 63), fill=(112, 103, 86, 255))
    return image


def portal(accent, glyph, library=False):
    """64×96 source for a logical 32×48 framed portal and threshold."""
    image = canvas((64, 96))
    draw = ImageDraw.Draw(image)
    draw.rectangle((5, 2, 58, 95), fill=(20, 25, 34, 255))
    draw.rectangle((8, 5, 55, 93), fill=WALNUT if library else STEEL)
    draw.line((9, 6, 54, 6), fill=BONE)
    draw.rectangle((13, 23, 50, 92), fill=(31, 24, 25, 255) if library else MIDNIGHT)
    draw.rectangle((17, 28, 46, 91), fill=(69, 43, 32, 255) if library else (15, 34, 54, 255))
    draw.rectangle((12, 12, 51, 24), fill=(20, 25, 34, 255))
    draw.line((15, 23, 48, 23), fill=accent, width=2)
    if glyph == "book":
        draw.line((23, 16, 31, 14, 31, 21, 23, 19, 23, 16), fill=accent, width=2)
        draw.line((31, 14, 39, 16, 39, 19, 31, 21), fill=accent, width=2)
    else:
        draw.rectangle((29, 13, 34, 22), outline=accent)
        draw.rectangle((30, 14, 33, 21), fill=accent)
        draw.line((25, 17, 38, 17), fill=accent, width=2)
    draw.rectangle((27, 70, 35, 76), fill=accent)
    draw.point((31, 73), fill=BONE)
    draw.rectangle((10, 90, 53, 95), fill=(21, 27, 37, 255))
    draw.line((12, 89, 51, 89), fill=accent)
    return image


GENERATORS = [
    ("hd-architecture-office-wall.png", lambda: wall(BRICK)),
    ("hd-architecture-library-wall.png", lambda: wall(SLATE, True)),
    ("hd-architecture-battle-wall.png", lambda: wall(NAVY, True)),
    ("hd-architecture-library-portal.png", lambda: portal(CYAN, "book", True)),
    ("hd-architecture-battle-portal.png", lambda: portal(RED, "arena")),
]


def manifest():
    provenance = "pillow-primitives:architecture-v1"

    def tile(identifier, slug, filename, scene, fallback):
        return {
            "id": identifier, "kind": "tile", "slug": slug, "file": filename,
            "widthPx": 32, "heightPx": 32, "sourceScale": 2,
            "sourceWidthPx": 64, "sourceHeightPx": 64, "alphaMode": "opaque",
            "scene": scene, "fallback": fallback, "provenance": provenance,
            "reviewState": "pending", "batchId": BATCH_ID, "maxColors": 64,
        }

    def prop(identifier, slug, filename, scene, fallback):
        return {
            "id": identifier, "kind": "prop", "slug": slug, "file": filename,
            "widthPx": 32, "heightPx": 48, "sourceScale": 2,
            "sourceWidthPx": 64, "sourceHeightPx": 96, "alphaMode": "binary",
            "scene": scene, "fallback": fallback, "provenance": provenance,
            "reviewState": "pending", "batchId": BATCH_ID, "maxColors": 64,
            "tileW": 1, "tileH": 2, "anchorX": 0, "anchorY": 16,
        }

    return [
        tile("hd-architecture-office-wall", "architecture-office-wall", GENERATORS[0][0], "office", "legacy:brick-red"),
        tile("hd-architecture-library-wall", "architecture-library-wall", GENERATORS[1][0], "library", "procedural:slate-wall"),
        tile("hd-architecture-battle-wall", "architecture-battle-wall", GENERATORS[2][0], "battleRoom", "procedural:navy-wall"),
        prop("hd-architecture-library-portal", "architecture-library-portal", GENERATORS[3][0], "office", "legacy:lib-door"),
        prop("hd-architecture-battle-portal", "architecture-battle-portal", GENERATORS[4][0], "office", "procedural:battle-portal"),
    ]


def hashes(directory):
    return {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(directory.glob("*")) if path.is_file() and path.name != "SHA256SUMS"
    }


def build_once():
    if BATCH_DIR.exists():
        shutil.rmtree(BATCH_DIR)
    BATCH_DIR.mkdir(parents=True)
    images = []
    for filename, generator in GENERATORS:
        image = generator()
        image.save(BATCH_DIR / filename, "PNG", optimize=False, compress_level=9)
        images.append((filename.removeprefix("hd-architecture-").removesuffix(".png"), image))
    entries = manifest()
    (BATCH_DIR / "manifest.json").write_text(json.dumps(entries, indent=2) + "\n")
    sys.path.insert(0, str(HERE))
    from art_pipeline import validate_batch
    errors = validate_batch(BATCH_DIR, entries)
    if errors:
        raise RuntimeError("Architecture batch is invalid:\n" + "\n".join(errors))
    sums = hashes(BATCH_DIR)
    (BATCH_DIR / "SHA256SUMS").write_text("".join(f"{digest}  {name}\n" for name, digest in sorted(sums.items())))

    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    sheet = canvas((len(images) * 150 + 22, 180), (5, 10, 18, 255))
    draw = ImageDraw.Draw(sheet)
    for index, (name, image) in enumerate(images):
        height = 128 if image.height == 64 else 144
        preview = image.resize((128, height), Image.Resampling.NEAREST)
        x = index * 150 + 11
        sheet.alpha_composite(preview, (x, 8))
        draw.text((x, 158), name, fill=BONE)
    sheet.save(REVIEW_DIR / "contact-sheet-batch-architecture.png", "PNG", optimize=False, compress_level=9)
    return hashes(BATCH_DIR)


def main(argv):
    first = build_once()
    if "--validate-twice" in argv:
        backup = BATCH_DIR.parent / ".batch-architecture-first"
        if backup.exists():
            shutil.rmtree(backup)
        shutil.move(BATCH_DIR, backup)
        second = build_once()
        if first != second:
            raise RuntimeError("Architecture generation is not byte-identical across clean runs")
        shutil.rmtree(backup)
        print(f"Deterministic identity: {len(second)} staged files match across two clean runs.")
    else:
        print(f"Generated {len(GENERATORS)} staged PNGs at {BATCH_DIR}")
    print(f"Review: {REVIEW_DIR / 'contact-sheet-batch-architecture.png'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
