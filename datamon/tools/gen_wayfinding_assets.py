#!/usr/bin/env python3
"""Deterministic true-2x wayfinding asset batch generator for ticket #049.
Generates 6 domain friezes (96x16 logical) and 3 destination surrounds
(96x64 logical) as static RGBA PNGs under datamon/props-wayfinding/.
Source-scale 2, binary alpha, collision-free, transparent openings.
Run: uv run --with pillow python datamon/tools/gen_wayfinding_assets.py [--validate-twice]
"""

import hashlib
import json
import shutil
import sys
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("ERROR: Pillow is required. Install with: uv run --with pillow python ...")
    sys.exit(1)

# ---- Constants ----
HERE = Path(__file__).resolve().parent
DATAMON = HERE.parent
OUT_DIR = DATAMON / "props-wayfinding"
SCALE = 2

CLEAR = (0, 0, 0, 0)
INK = (8, 20, 38, 255)
BONE = (232, 223, 200, 255)
WALNUT = (91, 61, 38, 255)
STEEL = (45, 55, 72, 255)
BRASS = (242, 179, 93, 255)

DOMAIN_COLORS = {
    "agent": (59, 130, 246, 255),
    "mcp": (168, 85, 247, 255),
    "config": (34, 197, 94, 255),
    "prompt": (249, 115, 22, 255),
    "context": (6, 182, 212, 255),
    "mix": (245, 158, 11, 255),
}


# ---- Drawing helpers ----
def canvas(w, h):
    return Image.new("RGBA", (w * SCALE, h * SCALE), CLEAR)


def rect(draw, box, fill, outline=None, width=1):
    draw.rectangle(
        tuple(v * SCALE for v in box),
        fill=fill,
        outline=outline,
        width=width * SCALE,
    )


def line(draw, pts, fill, width=1):
    draw.line(
        [(x * SCALE, y * SCALE) for x, y in pts],
        fill=fill,
        width=width * SCALE,
        joint="curve",
    )


def dot(draw, x, y, color):
    draw.point((x * SCALE + 1, y * SCALE), fill=color)


# ---- Domain frieze generators ----
# Each frieze is 96x16 logical (192x32 source). Shape-distinct, no text dependence.
def frieze_agent():
    im = canvas(96, 16)
    d = ImageDraw.Draw(im)
    c = DOMAIN_COLORS["agent"]
    rect(d, (1, 2, 95, 14), INK, STEEL)
    line(d, [(4, 13), (92, 13)], c)
    # Three stacked-block nodes (agent dispatch architecture)
    for x in (14, 42, 70):
        rect(d, (x, 5, x + 8, 11), STEEL, c)
    line(d, [(22, 8), (42, 8), (38, 5)], c)
    dot(d, 8, 4, BONE)
    return im


def frieze_mcp():
    im = canvas(96, 16)
    d = ImageDraw.Draw(im)
    c = DOMAIN_COLORS["mcp"]
    rect(d, (1, 2, 95, 14), INK, STEEL)
    line(d, [(4, 13), (92, 13)], c)
    # Zigzag routed tool bus with terminal nodes
    line(d, [(12, 8), (28, 8), (28, 5), (44, 5), (44, 11), (60, 11), (60, 8), (78, 8)], c)
    for x, y in ((12, 8), (28, 5), (44, 11), (60, 8), (78, 8)):
        rect(d, (x - 1, y - 1, x + 1, y + 1), BONE, c)
    dot(d, 8, 4, BONE)
    return im


def frieze_config():
    im = canvas(96, 16)
    d = ImageDraw.Draw(im)
    c = DOMAIN_COLORS["config"]
    rect(d, (1, 2, 95, 14), INK, STEEL)
    line(d, [(4, 13), (92, 13)], c)
    # Calibration rail with verified-position dots
    line(d, [(8, 10), (90, 10)], BRASS)
    for i in range(20):
        x = 8 + i * 4
        marker = c if i % 4 == 0 else BONE
        line(d, [(x, 6), (x, 14)], marker)
        if i % 4 == 0:
            rect(d, (x - 1, 6, x + 1, 8), c, INK)
    rect(d, (38, 7, 56, 9), INK, c)
    return im


def frieze_prompt():
    im = canvas(96, 16)
    d = ImageDraw.Draw(im)
    c = DOMAIN_COLORS["prompt"]
    rect(d, (1, 2, 95, 14), INK, STEEL)
    line(d, [(4, 13), (92, 13)], c)
    # Editorial frame brackets around a central text-registration line
    line(d, [(20, 5), (15, 5), (15, 11), (20, 11)], c, 2)
    line(d, [(76, 5), (81, 5), (81, 11), (76, 11)], c, 2)
    line(d, [(31, 6), (65, 6), (31, 10), (57, 10)], BONE)
    rect(d, (40, 7, 52, 9), c, INK)
    dot(d, 28, 8, BONE)
    dot(d, 70, 8, BONE)
    return im


def frieze_context():
    im = canvas(96, 16)
    d = ImageDraw.Draw(im)
    c = DOMAIN_COLORS["context"]
    rect(d, (1, 2, 95, 14), INK, STEEL)
    line(d, [(4, 13), (92, 13)], c)
    # Nested context window frames decreasing in size
    for i in range(3):
        rect(d, (22 + i * 7, 4 + i, 58 + i * 7, 11 + i), None, c)
    line(d, [(30, 7), (67, 7)], BONE)
    dot(d, 8, 4, BONE)
    return im


def frieze_mix():
    im = canvas(96, 16)
    d = ImageDraw.Draw(im)
    c = DOMAIN_COLORS["mix"]
    rect(d, (1, 2, 95, 14), INK, STEEL)
    line(d, [(4, 13), (92, 13)], c)
    # Compass diamond connecting five domain-color nodes
    rect(d, (43, 4, 53, 12), None, c)
    line(d, [(48, 4), (52, 8), (48, 12), (44, 8), (48, 4)], BONE)
    colors = list(DOMAIN_COLORS.values())
    for i, col in enumerate(colors[:5]):
        rect(d, (22 + i * 11, 6, 25 + i * 11, 9), col)
    return im


FRIEZE_GENERATORS = {
    "agent": frieze_agent,
    "mcp": frieze_mcp,
    "config": frieze_config,
    "prompt": frieze_prompt,
    "context": frieze_context,
    "mix": frieze_mix,
}


# ---- Destination surround generators ----
# Each surround is 96x64 logical (192x128 source). Binary alpha, transparent
# central opening at x=32..64, y=23..64 so the existing door/portal art shows through.
def surround_context():
    im = canvas(96, 64)
    d = ImageDraw.Draw(im)
    c = DOMAIN_COLORS["context"]
    # Side posts + lintel; center x32..64 below y23 is transparent by contract
    rect(d, (3, 3, 93, 20), (24, 49, 64, 255), c)
    rect(d, (5, 22, 28, 63), (35, 67, 78, 255), c)
    rect(d, (68, 22, 91, 63), (35, 67, 78, 255), c)
    # Vertical window mullions on posts
    for x in (10, 20, 75, 85):
        line(d, [(x, 25), (x, 59)], BONE)
    # Lintel stripe
    line(d, [(8, 14), (88, 14)], c)
    # Nested context windows in lintel
    for i in range(3):
        rect(d, (39 + i * 6, 6 + i, 55 + i * 6, 13 + i), None, c)
    return im


def surround_battle():
    im = canvas(96, 64)
    d = ImageDraw.Draw(im)
    c = (239, 68, 68, 255)  # battle red
    # Side posts + lintel
    rect(d, (2, 5, 94, 22), INK, c)
    rect(d, (5, 22, 29, 63), STEEL, c)
    rect(d, (67, 22, 91, 63), STEEL, c)
    # Shield-like vertical ribs in posts
    for x in (10, 18, 76, 84):
        rect(d, (x, 28, x + 4, 58), INK, c)
    # Central shield emblem in lintel
    line(d, [(42, 8), (54, 8), (58, 13), (48, 19), (38, 13), (42, 8)], c, 2)
    rect(d, (46, 10, 50, 16), c)
    return im


def surround_library():
    im = canvas(96, 64)
    d = ImageDraw.Draw(im)
    c = (242, 179, 93, 255)  # library gold
    # Peaked open-book arch
    line(d, [(3, 24), (18, 7), (48, 1), (78, 7), (93, 24)], WALNUT, 6)
    line(d, [(5, 24), (20, 10), (48, 4), (76, 10), (91, 24)], c, 2)
    # Side columns
    rect(d, (5, 24, 28, 63), WALNUT, c)
    rect(d, (68, 24, 91, 63), WALNUT, c)
    # Open-book pages in peak
    line(d, [(39, 10), (48, 8), (48, 18), (39, 15), (39, 10)], c, 2)
    line(d, [(48, 8), (57, 10), (57, 15), (48, 18)], c, 2)
    dot(d, 7, 7, BONE)
    dot(d, 88, 18, c)
    return im


SURROUND_GENERATORS = {
    "context": surround_context,
    "library": surround_library,
    "battle": surround_battle,
}


# ---- Build, validate, contact sheet ---------------------------------------
BATCH_ID = "batch-certification-spine"
PROVENANCE = "pillow-primitives:certification-spine-v1"
REVIEW_DIR = DATAMON / ".environment-work" / "review"
CANONICAL_IDS = [f"zone-{key}-frieze" for key in FRIEZE_GENERATORS] + [
    f"door-{key}-surround" for key in SURROUND_GENERATORS
]
ROOT_KEYS = {"batch", "format", "reviewState", "provenance", "sourceScale", "entries", "batch_sha256", "asset_count"}
ENTRY_KEYS = {"id", "slug", "file", "kind", "widthPx", "heightPx", "sourceWidthPx", "sourceHeightPx",
              "sourceScale", "alphaMode", "collision", "reviewState", "provenance", "description", "sha256"}
SURROUND_KEYS = ENTRY_KEYS | {"opening"}


def png_bytes(image):
    buffer = BytesIO()
    image.save(buffer, "PNG", optimize=False, compress_level=9)
    return buffer.getvalue()


def canonical_entry(identifier, kind, data):
    logical = (96, 16) if kind == "frieze" else (96, 64)
    entry = {
        "id": identifier, "slug": identifier, "file": identifier + ".png", "kind": kind,
        "widthPx": logical[0], "heightPx": logical[1],
        "sourceWidthPx": logical[0] * SCALE, "sourceHeightPx": logical[1] * SCALE,
        "sourceScale": SCALE, "alphaMode": "binary", "collision": "none",
        "reviewState": "accepted", "provenance": PROVENANCE,
        "description": ("Domain architecture frieze" if kind == "frieze" else "Destination architecture surround"),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    if kind == "surround":
        entry["opening"] = [32, 23, 64, 64]
    return entry


def manifest_text(manifest):
    return json.dumps(manifest, indent=2) + "\n"


def build_into(target):
    """Build a complete candidate directory without touching accepted output."""
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    entries, images = [], []
    digest = hashlib.sha256()

    for key, generator in FRIEZE_GENERATORS.items():
        identifier = f"zone-{key}-frieze"
        image = generator(); data = png_bytes(image)
        (target / (identifier + ".png")).write_bytes(data)
        digest.update(data); entries.append(canonical_entry(identifier, "frieze", data)); images.append((identifier, image))
    for key, generator in SURROUND_GENERATORS.items():
        identifier = f"door-{key}-surround"
        image = generator(); data = png_bytes(image)
        (target / (identifier + ".png")).write_bytes(data)
        digest.update(data); entries.append(canonical_entry(identifier, "surround", data)); images.append((identifier, image))

    manifest = {
        "batch": BATCH_ID, "format": "RGBA", "reviewState": "accepted",
        "provenance": PROVENANCE, "sourceScale": SCALE, "entries": entries,
        "batch_sha256": digest.hexdigest(), "asset_count": len(entries),
    }
    (target / "manifest.json").write_text(manifest_text(manifest))
    return images


def build_all():
    """Validate a sibling candidate, then atomically promote with rollback backup."""
    OUT_DIR.parent.mkdir(parents=True, exist_ok=True)
    staging = OUT_DIR.parent / ("." + OUT_DIR.name + ".staging")
    backup = OUT_DIR.parent / ("." + OUT_DIR.name + ".backup")
    if staging.exists():
        shutil.rmtree(staging)
    if backup.exists():
        shutil.rmtree(backup)

    images = build_into(staging)
    errors, _ = validate(staging)
    if errors:
        shutil.rmtree(staging, ignore_errors=True)
        raise RuntimeError("Wayfinding candidate is invalid:\n" + "\n".join(errors))
    write_contact_sheet(images)

    had_output = OUT_DIR.exists()
    try:
        if had_output:
            OUT_DIR.replace(backup)
        staging.replace(OUT_DIR)
    except Exception:
        if OUT_DIR.exists():
            shutil.rmtree(OUT_DIR, ignore_errors=True)
        if backup.exists():
            backup.replace(OUT_DIR)
        raise
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
    if backup.exists():
        shutil.rmtree(backup)
    return snapshot()


def write_contact_sheet(images):
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (640, 440), (5, 10, 18, 255)); draw = ImageDraw.Draw(sheet)
    for index, (identifier, image) in enumerate(images):
        x = 12 + (index % 3) * 208; y = 12 + (index // 3) * 138
        sheet.alpha_composite(image, (x, y + 18)); draw.text((x, y), identifier, fill=BONE)
    sheet.save(REVIEW_DIR / "contact-sheet-batch-wayfinding.png", "PNG", optimize=False, compress_level=9)


def snapshot(directory=None):
    root = directory or OUT_DIR
    if not root.exists():
        return {}
    return {path.relative_to(root).as_posix(): path.read_bytes()
            for path in sorted(root.rglob("*")) if path.is_file()}


def has_true_detail(image):
    for y in range(0, image.height, SCALE):
        for x in range(0, image.width, SCALE):
            values = {image.getpixel((x + dx, y + dy)) for dx in range(SCALE) for dy in range(SCALE)}
            if len(values) > 1:
                return True
    return False


def validate(directory=None):
    output = directory or OUT_DIR
    errors = []
    manifest_path = output / "manifest.json"
    if not manifest_path.exists():
        return ["manifest.json missing"], 0
    manifest_bytes = manifest_path.read_bytes()
    try:
        manifest = json.loads(manifest_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        return [f"invalid manifest JSON: {exc}"], 0
    if not isinstance(manifest, dict) or set(manifest) != ROOT_KEYS:
        errors.append("manifest root schema mismatch")
    if manifest.get("batch") != BATCH_ID or manifest.get("format") != "RGBA" or manifest.get("reviewState") != "accepted":
        errors.append("manifest identity/review state mismatch")
    if manifest.get("provenance") != PROVENANCE or type(manifest.get("sourceScale")) is not int or manifest.get("sourceScale") != SCALE:
        errors.append("manifest provenance/source scale mismatch")
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        return errors + ["manifest entries must be an array"], 0
    if [entry.get("id") if isinstance(entry, dict) else None for entry in entries] != CANONICAL_IDS:
        errors.append("manifest IDs/order do not match the canonical batch")
    if type(manifest.get("asset_count")) is not int or manifest.get("asset_count") != 9:
        errors.append("asset_count must be 9")

    expected_files = {"manifest.json"} | {identifier + ".png" for identifier in CANONICAL_IDS}
    actual_files = {path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file()}
    for missing in sorted(expected_files - actual_files): errors.append("missing output: " + missing)
    for extra in sorted(actual_files - expected_files): errors.append("unexpected output: " + extra)

    total_bytes = 0; aggregate = hashlib.sha256()
    for index, identifier in enumerate(CANONICAL_IDS):
        if index >= len(entries) or not isinstance(entries[index], dict):
            continue
        entry = entries[index]; expected_keys = SURROUND_KEYS if identifier.startswith("door-") else ENTRY_KEYS
        if set(entry) != expected_keys:
            errors.append(identifier + ": entry schema mismatch")
        expected_kind = "surround" if identifier.startswith("door-") else "frieze"
        expected_w, expected_h = ((96, 64) if expected_kind == "surround" else (96, 16))
        if entry.get("id") != identifier or entry.get("slug") != identifier or entry.get("file") != identifier + ".png" or entry.get("kind") != expected_kind:
            errors.append(identifier + ": canonical declaration mismatch")
        if [entry.get("widthPx"), entry.get("heightPx"), entry.get("sourceWidthPx"), entry.get("sourceHeightPx")] != [expected_w, expected_h, expected_w * 2, expected_h * 2]:
            errors.append(identifier + ": dimension declaration mismatch")
        if entry.get("sourceScale") != 2 or entry.get("alphaMode") != "binary" or entry.get("collision") != "none" or entry.get("reviewState") != "accepted" or entry.get("provenance") != PROVENANCE:
            errors.append(identifier + ": presentation contract mismatch")
        if expected_kind == "surround" and entry.get("opening") != [32, 23, 64, 64]:
            errors.append(identifier + ": opening contract mismatch")
        path = output / (identifier + ".png")
        if not path.exists():
            continue
        data = path.read_bytes(); total_bytes += len(data); aggregate.update(data)
        if entry.get("sha256") != hashlib.sha256(data).hexdigest():
            errors.append(identifier + ": hash mismatch")
        try:
            with Image.open(path) as opened:
                opened.load(); image = opened.convert("RGBA")
        except (OSError, ValueError) as exc:
            errors.append(f"{identifier}: unreadable PNG: {exc}"); continue
        if image.size != (expected_w * 2, expected_h * 2): errors.append(identifier + ": decoded dimensions mismatch")
        alphas = set(image.getchannel("A").tobytes())
        if not alphas.issubset({0, 255}) or 0 not in alphas or 255 not in alphas: errors.append(identifier + ": binary alpha mismatch")
        if len(image.getcolors(maxcolors=100000) or []) > 64: errors.append(identifier + ": palette exceeds 64 colors")
        if not has_true_detail(image): errors.append(identifier + ": trivial 2x upscale")
        if expected_kind == "surround":
            x0, y0, x1, y1 = entry["opening"]
            if image.crop((x0 * 2, y0 * 2, x1 * 2, y1 * 2)).getchannel("A").getbbox() is not None:
                errors.append(identifier + ": opening is not transparent")
    if total_bytes > 128 * 1024: errors.append("PNG byte budget exceeded")
    if manifest.get("batch_sha256") != aggregate.hexdigest(): errors.append("aggregate hash mismatch")
    if manifest_bytes != manifest_text(manifest).encode(): errors.append("manifest serialization is not canonical")
    return errors, total_bytes


def print_errors(errors):
    for error in errors:
        print("FAIL: " + error, file=sys.stderr)


def main():
    validate_only = "--validate" in sys.argv
    validate_twice = "--validate-twice" in sys.argv
    if validate_only:
        errors, total = validate()
        if errors: print_errors(errors); return 1
        print(f"Wayfinding assets valid: 9 PNGs, {total} bytes."); return 0
    first = build_all(); errors, total = validate()
    if validate_twice:
        second = build_all(); second_errors, total = validate(); errors.extend(second_errors)
        if first != second: errors.append("outputs differ across clean generations")
    if errors: print_errors(errors); return 1
    manifest = json.loads((OUT_DIR / "manifest.json").read_text())
    print(f"Wayfinding assets valid twice: 9 PNGs, {total} bytes, batch SHA-256 {manifest['batch_sha256']}.")
    print("Review: " + str(REVIEW_DIR / "contact-sheet-batch-wayfinding.png"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
