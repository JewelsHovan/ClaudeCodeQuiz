#!/usr/bin/env python3
"""
Ticket #047: Deterministic $0 study-life environment batch.
Generates: Certification Console, Readiness Wall, Desk Study Kit, Task Lamp,
and restrained screen ambient. Local Pillow only.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]  # datamon/
OUT_DIR = ROOT / "props-study"
S = 2  # design at 2x scale for clean edges

# Palette
C = {
    "ink": "#111827",
    "steel": "#334155",
    "wood": "#9a5f2d",
    "wood2": "#d08a42",
    "cream": "#f3e7cd",
    "amber": "#fbbf24",
    "blue": "#3b82f6",
    "cyan": "#22d3ee",
    "purple": "#a855f7",
    "green": "#22c55e",
    "orange": "#f97316",
    "red": "#ef4444",
}
DOMAINS = [C["blue"], C["purple"], C["green"], C["orange"], "#06b6d4"]


def canvas(w, h):
    return Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))


def rect(d, box, fill, outline=None, w=1):
    b = tuple(v * S for v in box)
    d.rectangle(b, fill=fill, outline=outline, width=w * S)


def line(d, pts, fill, w=1):
    d.line([(x * S, y * S) for x, y in pts], fill=fill, width=w * S)


def certification_console():
    """2x tile Certification Console with five domain channels."""
    im = canvas(64, 32)
    d = ImageDraw.Draw(im)
    rect(d, (1, 14, 63, 28), C["wood"], C["ink"], 1)
    rect(d, (3, 15, 61, 20), C["wood2"])
    rect(d, (5, 4, 37, 18), C["ink"], C["steel"])
    rect(d, (8, 7, 34, 15), "#071a2d")
    for i, col in enumerate(DOMAINS):
        rect(d, (10 + i * 5, 9, 12 + i * 5, 14), col)
    rect(d, (42, 8, 57, 20), C["steel"], C["ink"])
    rect(d, (45, 11, 54, 13), C["amber"])
    rect(d, (45, 15, 52, 17), C["cyan"])
    rect(d, (5, 28, 9, 32), C["ink"])
    rect(d, (55, 28, 59, 32), C["ink"])
    return im


def readiness_board():
    """3x tile readiness wall board with weighted domain columns."""
    im = canvas(96, 32)
    d = ImageDraw.Draw(im)
    rect(d, (1, 2, 95, 30), C["ink"], C["cream"], 1)
    rect(d, (4, 5, 92, 27), "#17243b")
    rect(d, (7, 8, 30, 11), C["amber"])
    rect(d, (7, 14, 23, 16), C["steel"])
    rect(d, (7, 19, 27, 21), C["steel"])
    for i, col in enumerate(DOMAINS):
        x = 37 + i * 10
        rect(d, (x, 8, x + 5, 24), "#0b1324", col)
        rect(d, (x + 1, 22 - i * 3, x + 4, 23), col)
    rect(d, (88, 7, 90, 9), C["green"])
    rect(d, (88, 12, 90, 14), C["amber"])
    rect(d, (88, 17, 90, 19), C["red"])
    return im


def desk_kit():
    """Reusable transparent desk study kit (monitor, notes, mug)."""
    im = canvas(64, 32)
    d = ImageDraw.Draw(im)
    rect(d, (4, 3, 24, 20), C["ink"], C["steel"])
    rect(d, (7, 6, 21, 16), "#08243b")
    rect(d, (9, 8, 18, 10), C["cyan"])
    rect(d, (30, 9, 46, 21), C["cream"], C["ink"])
    line(d, [(32, 12), (43, 12)], C["orange"])
    line(d, [(32, 15), (41, 15)], C["steel"])
    rect(d, (50, 13, 58, 22), C["amber"], C["ink"])
    rect(d, (57, 15, 61, 20), None, C["ink"])
    return im


def task_lamp():
    """1x1 task lamp with restrained practical-light pool."""
    im = canvas(32, 32)
    d = ImageDraw.Draw(im)
    rect(d, (14, 22, 19, 29), C["ink"])
    rect(d, (10, 28, 23, 31), C["steel"], C["ink"])
    line(d, [(17, 23), (22, 12), (17, 8)], C["steel"], 2)
    rect(d, (11, 5, 20, 10), C["amber"], C["ink"])
    for i, a in enumerate((34, 26, 18, 10)):
        rect(d, (7 - i, 10 + i * 4, 24 + i, 14 + i * 4), (251, 191, 36, a))
    return im


def screen_ambient():
    """Four-frame restrained console telemetry strip (horizontal layout)."""
    im = canvas(64 * 4, 8)
    d = ImageDraw.Draw(im)
    for frame in range(4):
        ox = frame * 64
        for x in range(0, 64, 4):
            active = ((x // 4) + frame) % 4 == 0
            col = (34, 211, 238, 62 if active else 18)
            rect(d, (ox + x, 0, ox + x + 2, 7), col)
        rect(d, (ox + 4 + frame * 9, 2, ox + 18 + frame * 9, 4), C["amber"])
    return im


# slug, generator, logical frame width/height, tile footprint, description, animation
ASSETS = [
    ("certification-console", certification_console, 64, 32, 2, 1, "Solid console with five domain channels", None),
    ("readiness-board", readiness_board, 96, 32, 3, 1, "Wall readiness board with weighted domain columns", None),
    ("desk-study-kit", desk_kit, 64, 32, 2, 1, "Transparent desk kit overlay: monitor, notes, mug", None),
    ("task-lamp", task_lamp, 32, 32, 1, 1, "Task lamp with restrained warm-light pool", None),
    ("screen-ambient", screen_ambient, 64, 8, 2, 1, "Low-FPS console ambient strip", {"frames": 4, "fps": 2, "layout": "horizontal"}),
]


def generate_study_assets():
    """Generate all study-life assets and manifest."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "batch": "batch-study-life", "format": "RGBA", "reviewState": "accepted",
        "provenance": "pillow-primitives:study-life-v1", "sourceScale": S, "entries": [],
    }
    digest = hashlib.sha256()

    for slug, gen_fn, w_px, h_px, tile_w, tile_h, desc, animation in ASSETS:
        img = gen_fn()  # Keep true 2× source pixels; runtime maps them to logical dimensions.
        out_path = OUT_DIR / f"{slug}.png"
        img.save(out_path, optimize=False, compress_level=9)

        file_hash = hashlib.sha256(out_path.read_bytes()).hexdigest()
        digest.update(out_path.read_bytes())
        entry = {
            "slug": slug,
            "file": f"{slug}.png",
            "widthPx": w_px,
            "heightPx": h_px,
            "sourceWidthPx": img.width,
            "sourceHeightPx": img.height,
            "sourceScale": S,
            "tileW": tile_w,
            "tileH": tile_h,
            "anchorX": 0,
            "anchorY": 0,
            "alphaMode": "soft",
            "reviewState": "accepted",
            "provenance": "pillow-primitives:study-life-v1",
            "description": desc,
            "sha256": file_hash,
        }
        if animation:
            entry["animation"] = animation
        manifest["entries"].append(entry)

    manifest["batch_sha256"] = digest.hexdigest()
    manifest["asset_count"] = len(ASSETS)

    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"Generated {manifest['asset_count']} study-life assets")
    print(f"Batch SHA-256: {manifest['batch_sha256']}")
    print(f"Manifest: {manifest_path}")
    return manifest


def validate_study_assets():
    """Validate all generated study-life assets."""
    errors = []
    manifest_path = OUT_DIR / "manifest.json"
    if not manifest_path.exists():
        errors.append("manifest.json missing — run generation first")
        return errors

    manifest = json.loads(manifest_path.read_text())

    for entry in manifest["entries"]:
        path = OUT_DIR / entry["file"]
        if not path.exists():
            errors.append(f"Missing: {path}")
            continue
        img = Image.open(path)
        frames = entry.get("animation", {}).get("frames", 1)
        expected = (entry["widthPx"] * entry["sourceScale"] * frames,
                    entry["heightPx"] * entry["sourceScale"])
        if img.size != expected:
            errors.append(f"Wrong source size {img.size} vs {expected} for {entry['slug']}")
        if img.mode != "RGBA":
            errors.append(f"Wrong mode {img.mode} for {entry['slug']}")
        if img.getchannel("A").getbbox() is None:
            errors.append(f"Empty alpha for {entry['slug']}")
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_hash != entry["sha256"]:
            errors.append(f"Hash mismatch for {entry['slug']}")

    return errors


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Generate and validate study-life assets")
    parser.add_argument("--validate", action="store_true", help="Validate existing assets")
    parser.add_argument("--validate-twice", action="store_true",
                        help="Generate twice, validate both are identical")
    args = parser.parse_args()

    if args.validate:
        errs = validate_study_assets()
        if errs:
            for e in errs:
                print(f"FAIL: {e}", file=sys.stderr)
            sys.exit(1)
        print("All study-life assets valid.")
        sys.exit(0)

    if args.validate_twice:
        manifest1 = generate_study_assets()
        manifest2 = generate_study_assets()
        if manifest1["batch_sha256"] != manifest2["batch_sha256"]:
            print("FAIL: Two generations produced different hashes!", file=sys.stderr)
            sys.exit(1)
        print("Two generations match byte-for-byte.")
        errs = validate_study_assets()
        if errs:
            for e in errs:
                print(f"FAIL: {e}", file=sys.stderr)
            sys.exit(1)
        print("All validations passed.")
        sys.exit(0)

    # Default: generate
    generate_study_assets()
    errs = validate_study_assets()
    if errs:
        for e in errs:
            print(f"WARNING: {e}", file=sys.stderr)
    else:
        print("Validation passed.")
