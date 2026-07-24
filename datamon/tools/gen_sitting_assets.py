#!/usr/bin/env python3
"""
Ticket #048: generate deterministic compact rear-facing seated poses for every
roster member from one accepted, non-walking up frame.

The recipe is local Pillow composition only: no network/API calls and $0 spend.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from PIL import Image
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]  # datamon/
OUT_DIR = ROOT / "sprites-sit"
SPRITES_WALK = ROOT / "sprites-walk"

ROSTER = [
    "alex-andrianavalontsalama", "andrea-vreugdenhil", "antonia-nistor",
    "aurelien-bouffanais", "dana-domanko", "duc-an-nguyen", "elina-gu",
    "emile-moffatt", "ethan-pirso", "felicia-gorgacheva", "francesco-finn",
    "guillaume-delmas-frenette", "guillaume-pregent", "jerry-zhu", "jewoo-lee",
    "jonah-lee", "jonathan-kim", "julien-hovan", "logan-labossiere",
    "megane-darnaud", "milen-thomas", "minh-ngoc-do", "oyku-cildir",
    "pentcho-tchomakov", "philippe-miranda-jean", "richard-el-chaar",
    "sarah-kotb", "saransh-padhy", "scott-carr", "stephanie-fontaine",
    "tabarek-al-khalidi", "tyler-nagano", "veronica-marallag",
    "victor-desautels", "vincent-anctil", "wild-guevera", "william-chan",
]

CANVAS_SIZE = 64
ALPHA_THRESHOLD = 18
STABLE_SOURCE_NAME = "up_0.png"

# Explicit compact composition in the fixed 64x64 runtime canvas. The source head
# keeps its aspect ratio; torso and pelvis are separately foreshortened. Source
# lower legs and shoes are never sampled.
POSE_HEAD_Y = 14
HEAD_HEIGHT = 20
TORSO_Y = 30
TORSO_HEIGHT = 16
PELVIS_Y = 43
PELVIS_HEIGHT = 6
FORBIDDEN_LEG_Y = 50

# Inclusive accepted minima/maxima for generated alpha-bbox values. Right and
# bottom are Pillow's exclusive bbox coordinates.
POSTURE_BOUNDS = {
    "left": (19, 24),
    "top": (13, 15),
    "right_exclusive": (41, 46),
    "bottom_exclusive": (48, 50),
    "width": (18, 26),
    "height": (34, 37),
}

MANIFEST_RECIPE = {
    "pose": "compact-rear-seated-v2",
    "provenance": "local-pillow-stable-up-0-$0",
    "stableSourceFrame": "up_0",
    "motion": "one-pixel-head-weight-shift",
    "alphaThreshold": ALPHA_THRESHOLD,
    "forbiddenLegY": FORBIDDEN_LEG_Y,
    "postureBounds": {key: list(value) for key, value in POSTURE_BOUNDS.items()},
}


def _bounded_fraction(value: int, fraction: float, low: int, high: int) -> int:
    return max(low, min(high, round(value * fraction)))


def _clear_alpha_fringe(image: Image.Image) -> None:
    """Canonicalize transparent pixels after high-quality resampling."""
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, alpha = pixels[x, y]
            if alpha < ALPHA_THRESHOLD:
                pixels[x, y] = (0, 0, 0, 0)


def seated_frame(src: Image.Image, frame: int) -> Image.Image:
    """Compose one compact rear-facing seated frame from stable up_0 art.

    Frame one shifts only the head/hair by one pixel. The torso, pelvis, alpha
    baseline, and all source pixels below the upper-hip crop remain stationary,
    preventing a walk-step or standing-leg silhouette.
    """
    if frame not in (0, 1):
        raise ValueError(f"Seated frame must be 0 or 1, got {frame}")

    src = src.convert("RGBA")
    bbox = src.getchannel("A").getbbox()
    out = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE))
    if not bbox:
        return out

    body = src.crop(bbox)
    width, height = body.size

    head_end = _bounded_fraction(height, 0.34, 2, height - 2)
    torso_start = _bounded_fraction(height, 0.27, 1, height - 3)
    torso_end = _bounded_fraction(height, 0.64, torso_start + 1, height - 1)
    pelvis_start = _bounded_fraction(height, 0.52, torso_start + 1, torso_end - 1)
    pelvis_end = _bounded_fraction(height, 0.62, pelvis_start + 1, torso_end)
    pelvis_left = _bounded_fraction(width, 0.16, 0, width - 2)
    pelvis_right = _bounded_fraction(width, 0.84, pelvis_left + 1, width)

    head = body.crop((0, 0, width, head_end))
    torso = body.crop((0, torso_start, width, torso_end))
    pelvis = body.crop((pelvis_left, pelvis_start, pelvis_right, pelvis_end))

    # Preserve accepted head/hair proportions, then foreshorten body sections
    # independently rather than compressing the full standing figure.
    head_scale = HEAD_HEIGHT / head.height
    head_width = max(1, round(head.width * head_scale))
    torso_width = max(1, round(width * head_scale))
    pelvis_width = max(1, min(torso_width - 2, round(pelvis.width * head_scale * 1.18)))

    head = head.resize((head_width, HEAD_HEIGHT), Image.Resampling.LANCZOS)
    torso = torso.resize((torso_width, TORSO_HEIGHT), Image.Resampling.LANCZOS)
    pelvis = pelvis.resize((pelvis_width, PELVIS_HEIGHT), Image.Resampling.LANCZOS)

    # The torso overlaps the shifted head crop, hiding its lower seam. Only the
    # visible head/hair moves; everything at and below y=34 is byte-stable.
    out.alpha_composite(head, ((CANVAS_SIZE - head_width) // 2 + frame, POSE_HEAD_Y))
    out.alpha_composite(torso, ((CANVAS_SIZE - torso_width) // 2, TORSO_Y))
    out.alpha_composite(pelvis, ((CANVAS_SIZE - pelvis_width) // 2, PELVIS_Y))
    _clear_alpha_fringe(out)
    return out


def _png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, "PNG", optimize=False, compress_level=9)
    return buffer.getvalue()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _manifest_text(manifest: dict) -> str:
    return json.dumps(manifest, indent=2) + "\n"


def _new_manifest() -> dict:
    return {
        "batch": "ticket-048-compact-rear-sit",
        "format": "64x64 RGBA",
        "frames": 2,
        "recipe": MANIFEST_RECIPE,
        "entries": [],
    }


def generate_sitting_assets(roster_members=None):
    """Generate idle_0.png and idle_1.png for each slug. Return the manifest."""
    if roster_members is None:
        roster_members = ROSTER
    roster_members = list(roster_members)
    if len(roster_members) != len(set(roster_members)):
        raise ValueError("Sitting roster contains duplicate slugs")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = _new_manifest()
    digest = hashlib.sha256()

    for slug in roster_members:
        slug_dir = OUT_DIR / slug
        slug_dir.mkdir(exist_ok=True)
        entry = {"slug": slug, "frames": []}
        source_path = SPRITES_WALK / slug / STABLE_SOURCE_NAME
        if not source_path.exists():
            raise FileNotFoundError(f"Missing accepted stable source frame: {source_path}")

        source_data = source_path.read_bytes()
        source_hash = _sha256(source_data)
        with Image.open(source_path) as source_file:
            source = source_file.convert("RGBA")

        for frame_num in (0, 1):
            image = seated_frame(source, frame_num)
            data = _png_bytes(image)
            out_path = slug_dir / f"idle_{frame_num}.png"
            out_path.write_bytes(data)
            digest.update(data)
            entry["frames"].append({
                "frame": frame_num,
                "file": f"sprites-sit/{slug}/idle_{frame_num}.png",
                "source": f"sprites-walk/{slug}/{STABLE_SOURCE_NAME}",
                "sourceSha256": source_hash,
                "sha256": _sha256(data),
            })

        manifest["entries"].append(entry)

    manifest["batch_sha256"] = digest.hexdigest()
    manifest["roster_count"] = len(roster_members)
    manifest["frame_count"] = len(roster_members) * 2

    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(_manifest_text(manifest))
    print(f"Generated {manifest['frame_count']} sitting frames for {manifest['roster_count']} slugs")
    print(f"Batch SHA-256: {manifest['batch_sha256']}")
    print(f"Manifest: {manifest_path}")
    return manifest


def _alpha_points(image: Image.Image) -> set[tuple[int, int]]:
    alpha = image.convert("RGBA").getchannel("A")
    return {
        (x, y)
        for y in range(alpha.height)
        for x in range(alpha.width)
        if alpha.getpixel((x, y)) >= ALPHA_THRESHOLD
    }


def validate_posture_frame(image: Image.Image, label: str) -> list[str]:
    """Return objective compact-posture errors for one decoded frame."""
    errors = []
    if image.size != (CANVAS_SIZE, CANVAS_SIZE) or image.mode != "RGBA":
        return errors  # dimension/mode errors are reported by the caller

    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        return [f"Empty alpha for {label}"]

    values = {
        "left": bbox[0],
        "top": bbox[1],
        "right_exclusive": bbox[2],
        "bottom_exclusive": bbox[3],
        "width": bbox[2] - bbox[0],
        "height": bbox[3] - bbox[1],
    }
    for key, value in values.items():
        low, high = POSTURE_BOUNDS[key]
        if not low <= value <= high:
            errors.append(f"Posture {key} {value} outside {low}..{high} for {label}")

    forbidden = image.crop((0, FORBIDDEN_LEG_Y, CANVAS_SIZE, CANVAS_SIZE)).getchannel("A")
    if forbidden.getbbox() is not None:
        errors.append(f"Alpha enters forbidden standing-leg zone y>={FORBIDDEN_LEG_Y} for {label}")

    points = _alpha_points(image)
    head_pixels = sum(POSE_HEAD_Y <= y < TORSO_Y for _, y in points)
    torso_pixels = sum(TORSO_Y <= y < PELVIS_Y for _, y in points)
    pelvis_pixels = sum(PELVIS_Y <= y < FORBIDDEN_LEG_Y for _, y in points)
    if head_pixels < 100:
        errors.append(f"Insufficient recognizable head/hair alpha ({head_pixels}) for {label}")
    if torso_pixels < 160:
        errors.append(f"Insufficient upper-body alpha ({torso_pixels}) for {label}")
    if pelvis_pixels < 50:
        errors.append(f"Insufficient compact pelvis alpha ({pelvis_pixels}) for {label}")
    if bbox[3] - PELVIS_Y > PELVIS_HEIGHT:
        errors.append(f"Lower silhouette is too tall for a folded seated pelvis for {label}")
    return errors


def validate_motion_pair(frame0: Image.Image, frame1: Image.Image, label: str) -> list[str]:
    """Require a nonempty, subtle upper-only shift with a stable lower body."""
    errors = []
    if frame0.size != (CANVAS_SIZE, CANVAS_SIZE) or frame1.size != (CANVAS_SIZE, CANVAS_SIZE):
        return [f"Motion pair dimensions invalid for {label}"]
    frame0 = frame0.convert("RGBA")
    frame1 = frame1.convert("RGBA")
    if frame0.tobytes() == frame1.tobytes():
        errors.append(f"Seated motion is empty for {label}")
        return errors

    stable_y = POSE_HEAD_Y + HEAD_HEIGHT
    if frame0.crop((0, stable_y, CANVAS_SIZE, CANVAS_SIZE)).tobytes() != frame1.crop(
        (0, stable_y, CANVAS_SIZE, CANVAS_SIZE)
    ).tobytes():
        errors.append(f"Seated lower body changes like a walk stride for {label}")

    mask0, mask1 = _alpha_points(frame0), _alpha_points(frame1)
    union = mask0 | mask1
    delta = mask0 ^ mask1
    ratio = len(delta) / len(union) if union else 0
    if not 0.02 <= ratio <= 0.12:
        errors.append(f"Seated alpha motion ratio {ratio:.4f} outside 0.02..0.12 for {label}")
    return errors


def _expected_asset_files() -> set[str]:
    return {
        f"sprites-sit/{slug}/idle_{frame}.png"
        for slug in ROSTER for frame in (0, 1)
    }


def validate_sitting_assets():
    """Validate completeness, provenance, hashes, recipe, posture, and motion."""
    errors = []
    manifest_path = OUT_DIR / "manifest.json"
    if not manifest_path.exists():
        return ["manifest.json missing — run generation first"]

    manifest_bytes = manifest_path.read_bytes()
    try:
        manifest = json.loads(manifest_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        return [f"Invalid manifest JSON: {exc}"]
    if not isinstance(manifest, dict):
        return ["Manifest root must be an object"]

    expected_header = _new_manifest()
    expected_manifest_keys = {
        "batch", "format", "frames", "recipe", "entries",
        "batch_sha256", "roster_count", "frame_count",
    }
    if set(manifest) != expected_manifest_keys:
        errors.append("Manifest keys do not match the canonical schema")
    for key in ("batch", "format", "frames", "recipe"):
        if manifest.get(key) != expected_header[key]:
            errors.append(f"Manifest {key} mismatch")
    if type(manifest.get("roster_count")) is not int or manifest.get("roster_count") != len(ROSTER):
        errors.append(f"Roster count mismatch: {manifest.get('roster_count')} vs {len(ROSTER)}")
    if type(manifest.get("frame_count")) is not int or manifest.get("frame_count") != len(ROSTER) * 2:
        errors.append(f"Frame count mismatch: {manifest.get('frame_count')} vs {len(ROSTER) * 2}")
    if not isinstance(manifest.get("batch_sha256"), str) or len(manifest.get("batch_sha256", "")) != 64:
        errors.append("Manifest batch_sha256 must be one 64-character digest")

    entries = manifest.get("entries")
    if not isinstance(entries, list):
        return errors + ["Manifest entries must be an array"]
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict) or set(entry) != {"slug", "frames"}:
            errors.append(f"Manifest entry {index} does not match the canonical schema")
    slugs = [entry.get("slug") if isinstance(entry, dict) else None for entry in entries]
    if slugs != ROSTER:
        errors.append("Manifest entries do not match canonical roster order")

    expected_root_files = {"manifest.json"} | {
        Path(path).relative_to("sprites-sit").as_posix()
        for path in _expected_asset_files()
    }
    actual_root_files = {
        path.relative_to(OUT_DIR).as_posix()
        for path in OUT_DIR.rglob("*") if path.is_file()
    }
    for missing in sorted(expected_root_files - actual_root_files):
        errors.append(f"Missing sitting output: {missing}")
    for extra in sorted(actual_root_files - expected_root_files):
        errors.append(f"Unexpected sitting output: {extra}")

    entries_by_slug = {
        entry.get("slug"): entry
        for entry in entries if isinstance(entry, dict) and isinstance(entry.get("slug"), str)
    }
    digest = hashlib.sha256()

    for slug in ROSTER:
        entry = entries_by_slug.get(slug)
        if entry is None:
            continue
        frames = entry.get("frames")
        if not isinstance(frames, list):
            errors.append(f"Frames must be an array for {slug}")
            continue
        expected_frame_keys = {"frame", "file", "source", "sourceSha256", "sha256"}
        for frame_index, frame in enumerate(frames):
            if not isinstance(frame, dict) or set(frame) != expected_frame_keys:
                errors.append(f"Frame {frame_index} schema mismatch for {slug}")
        frame_numbers = [
            frame.get("frame") if isinstance(frame, dict) and type(frame.get("frame")) is int else None
            for frame in frames
        ]
        if frame_numbers != [0, 1]:
            errors.append(f"Frames do not match canonical integer [0, 1] order for {slug}")

        source_path = SPRITES_WALK / slug / STABLE_SOURCE_NAME
        source_data = source_path.read_bytes() if source_path.exists() else None
        source_hash = _sha256(source_data) if source_data is not None else None
        source_image = None
        if source_data is None:
            errors.append(f"Missing accepted stable source frame: {source_path}")
        else:
            try:
                with Image.open(source_path) as opened:
                    source_image = opened.convert("RGBA")
            except (OSError, ValueError) as exc:
                errors.append(f"Unreadable stable source for {slug}: {exc}")

        decoded = {}
        frames_by_number = {
            frame.get("frame"): frame
            for frame in frames
            if isinstance(frame, dict)
            and type(frame.get("frame")) is int
            and frame.get("frame") in (0, 1)
        }
        for frame_num in (0, 1):
            frame = frames_by_number.get(frame_num)
            if frame is None:
                continue
            expected_file = f"sprites-sit/{slug}/idle_{frame_num}.png"
            expected_source = f"sprites-walk/{slug}/{STABLE_SOURCE_NAME}"
            if frame.get("file") != expected_file:
                errors.append(f"Canonical file mismatch for {slug} frame {frame_num}")
            if frame.get("source") != expected_source:
                errors.append(f"Frame {frame_num} does not use stable source up_0 for {slug}")
            if source_hash is None or frame.get("sourceSha256") != source_hash:
                errors.append(f"Source mismatch for {slug} frame {frame_num}")

            path = ROOT / expected_file
            if not path.exists():
                continue
            data = path.read_bytes()
            digest.update(data)
            actual_hash = _sha256(data)
            if frame.get("sha256") != actual_hash:
                errors.append(f"Hash mismatch for {slug} frame {frame_num}")

            try:
                with Image.open(path) as opened:
                    opened.load()
                    image = opened.copy()
            except (OSError, ValueError) as exc:
                errors.append(f"Unreadable PNG for {slug} frame {frame_num}: {exc}")
                continue
            if image.size != (CANVAS_SIZE, CANVAS_SIZE):
                errors.append(f"Wrong size {image.size} for {slug} frame {frame_num}")
            if image.mode != "RGBA":
                errors.append(f"Wrong mode {image.mode} for {slug} frame {frame_num}")
            errors.extend(validate_posture_frame(image, f"{slug} frame {frame_num}"))
            decoded[frame_num] = image.convert("RGBA")

            if source_image is not None:
                expected_image = seated_frame(source_image, frame_num)
                if image.convert("RGBA").tobytes() != expected_image.tobytes():
                    errors.append(f"Deterministic recipe mismatch for {slug} frame {frame_num}")
                if actual_hash != _sha256(_png_bytes(expected_image)):
                    errors.append(f"Deterministic PNG encoding mismatch for {slug} frame {frame_num}")

        if 0 in decoded and 1 in decoded:
            errors.extend(validate_motion_pair(decoded[0], decoded[1], slug))

    if manifest.get("batch_sha256") != digest.hexdigest():
        errors.append("Batch aggregate hash mismatch")
    if manifest_bytes != _manifest_text(manifest).encode():
        errors.append("Manifest serialization is not canonical")
    return errors


def _output_snapshot() -> dict[str, bytes]:
    if not OUT_DIR.exists():
        return {}
    return {
        path.relative_to(OUT_DIR).as_posix(): path.read_bytes()
        for path in sorted(OUT_DIR.rglob("*")) if path.is_file()
    }


def _print_errors(errors: list[str]) -> None:
    for error in errors:
        print(f"FAIL: {error}", file=sys.stderr)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate and validate compact sitting assets")
    parser.add_argument("--validate", action="store_true", help="Validate existing assets")
    parser.add_argument("--validate-twice", action="store_true", help="Generate twice and compare every output byte")
    args = parser.parse_args()

    if args.validate:
        validation_errors = validate_sitting_assets()
        if validation_errors:
            _print_errors(validation_errors)
            sys.exit(1)
        print("All sitting assets valid.")
        sys.exit(0)

    if args.validate_twice:
        generate_sitting_assets()
        first_snapshot = _output_snapshot()
        generate_sitting_assets()
        second_snapshot = _output_snapshot()
        if first_snapshot != second_snapshot:
            differing = sorted(
                key for key in first_snapshot.keys() | second_snapshot.keys()
                if first_snapshot.get(key) != second_snapshot.get(key)
            )
            _print_errors(["Repeated generation changed: " + ", ".join(differing)])
            sys.exit(1)
        print(f"Two generations match byte-for-byte ({len(second_snapshot)} files).")
        validation_errors = validate_sitting_assets()
        if validation_errors:
            _print_errors(validation_errors)
            sys.exit(1)
        print("All validations passed.")
        sys.exit(0)

    generate_sitting_assets()
    validation_errors = validate_sitting_assets()
    if validation_errors:
        _print_errors(validation_errors)
        sys.exit(1)
    print("Validation passed.")
