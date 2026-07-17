#!/usr/bin/env python3
"""
Ticket #047: Generate deterministic two-frame rear-facing seated poses
for all 29 roster members from accepted up-walk art.
$0 budget — local Pillow only, no API calls.
"""
from pathlib import Path
from PIL import Image
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]  # datamon/
OUT_DIR = ROOT / "sprites-sit"
SPRITES_WALK = ROOT / "sprites-walk"

ROSTER = [
    "alex-andrianavalontsalama", "antonia-nistor", "aurelien-bouffanais",
    "dana-domanko", "duc-an-nguyen", "emile-moffatt", "ethan-pirso",
    "felicia-gorgacheva", "francesco-finn", "guillaume-delmas-frenette",
    "guillaume-pregent", "jerry-zhu", "jonah-lee", "jonathan-kim",
    "julien-hovan", "logan-labossiere", "megane-darnaud", "pentcho-tchomakov",
    "philippe-miranda-jean", "richard-el-chaar", "sarah-kotb", "scott-carr",
    "stephanie-fontaine", "tabarek-al-khalidi", "tyler-nagano",
    "veronica-marallag", "victor-desautels", "vincent-anctil", "william-chan",
]


def seated_frame(src: Image.Image, frame: int) -> Image.Image:
    """Derive a 64x64 rear-facing seated pose from an up-walk frame."""
    src = src.convert("RGBA")
    bbox = src.getchannel("A").getbbox()
    if not bbox:
        return Image.new("RGBA", (64, 64))

    body = src.crop(bbox)
    w, h = body.size
    split = max(1, min(h - 1, round(h * 0.66)))

    upper = body.crop((0, 0, w, split))
    # Keep only the central trouser/leg silhouette. Hands and stride-extreme shoes sit
    # near the source edges and otherwise compress into implausible horizontal "wings".
    lower = body.crop((round(w * 0.24), split, round(w * 0.76), h))

    # Head/torso stays recognizable; legs fold/compress behind chair
    upper_h = 43
    upper_w = max(1, round(upper.width * upper_h / upper.height))
    upper = upper.resize((upper_w, upper_h), Image.Resampling.LANCZOS)

    lower_h = 11
    lower_w = max(1, min(18, round(lower.width * 0.62)))
    lower = lower.resize((lower_w, lower_h), Image.Resampling.LANCZOS)

    out = Image.new("RGBA", (64, 64))
    sway = 1 if frame else 0
    out.alpha_composite(upper, ((64 - upper_w) // 2 + sway, 2))
    out.alpha_composite(lower, ((64 - lower_w) // 2 - sway, 42))

    # Clear faint resampling fringe
    px = out.load()
    for y in range(64):
        for x in range(64):
            r, g, b, a = px[x, y]
            if a < 18:
                px[x, y] = (r, g, b, 0)
    return out


def generate_sitting_assets(roster_members=None):
    """Generate idle_0.png and idle_1.png for each slug. Returns manifest."""
    if roster_members is None:
        roster_members = ROSTER
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"batch": "ticket-047-sit", "format": "64x64 RGBA", "frames": 2, "entries": []}
    digest = hashlib.sha256()

    for slug in roster_members:
        slug_dir = OUT_DIR / slug
        slug_dir.mkdir(exist_ok=True)
        entry = {"slug": slug, "frames": []}

        for frame_num in (0, 1):
            src_path = SPRITES_WALK / slug / f"up_{frame_num}.png"
            if not src_path.exists():
                raise FileNotFoundError(f"Missing accepted source frame: {src_path}")
            src = Image.open(src_path)
            img = seated_frame(src, frame_num)

            out_path = slug_dir / f"idle_{frame_num}.png"
            img.save(out_path, optimize=False, compress_level=9)

            file_hash = hashlib.sha256(out_path.read_bytes()).hexdigest()
            digest.update(out_path.read_bytes())
            entry["frames"].append({
                "frame": frame_num,
                "file": f"sprites-sit/{slug}/idle_{frame_num}.png",
                "source": f"sprites-walk/{slug}/up_{frame_num}.png",
                "sourceSha256": hashlib.sha256(src_path.read_bytes()).hexdigest(),
                "sha256": file_hash,
            })

        manifest["entries"].append(entry)

    manifest["batch_sha256"] = digest.hexdigest()
    manifest["roster_count"] = len(roster_members)
    manifest["frame_count"] = len(roster_members) * 2

    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"Generated {manifest['frame_count']} sitting frames for {manifest['roster_count']} slugs")
    print(f"Batch SHA-256: {manifest['batch_sha256']}")
    print(f"Manifest: {manifest_path}")
    return manifest


def validate_sitting_assets():
    """Validate all generated sitting assets."""
    errors = []
    manifest_path = OUT_DIR / "manifest.json"
    if not manifest_path.exists():
        errors.append("manifest.json missing — run generation first")
        return errors

    manifest = json.loads(manifest_path.read_text())

    for entry in manifest["entries"]:
        slug = entry["slug"]
        for frame in entry["frames"]:
            path = ROOT / frame["file"]
            if not path.exists():
                errors.append(f"Missing: {path}")
                continue
            img = Image.open(path)
            if img.size != (64, 64):
                errors.append(f"Wrong size {img.size} for {slug} frame {frame['frame']}")
            if img.mode != "RGBA":
                errors.append(f"Wrong mode {img.mode} for {slug} frame {frame['frame']}")
            if img.getchannel("A").getbbox() is None:
                errors.append(f"Empty alpha for {slug} frame {frame['frame']}")
            source_path = ROOT / frame.get("source", "")
            if not source_path.exists() or hashlib.sha256(source_path.read_bytes()).hexdigest() != frame.get("sourceSha256"):
                errors.append(f"Source mismatch for {slug} frame {frame['frame']}")
            actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            if actual_hash != frame["sha256"]:
                errors.append(f"Hash mismatch for {slug} frame {frame['frame']}")

    if len(manifest["entries"]) != len(ROSTER):
        errors.append(f"Roster count mismatch: {len(manifest['entries'])} vs {len(ROSTER)}")

    return errors


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Generate and validate sitting assets")
    parser.add_argument("--validate", action="store_true", help="Validate existing assets")
    parser.add_argument("--validate-twice", action="store_true", help="Generate twice, validate both are identical")
    args = parser.parse_args()

    if args.validate:
        errs = validate_sitting_assets()
        if errs:
            for e in errs:
                print(f"FAIL: {e}", file=sys.stderr)
            sys.exit(1)
        print("All sitting assets valid.")
        sys.exit(0)

    if args.validate_twice:
        manifest1 = generate_sitting_assets()
        manifest2 = generate_sitting_assets()
        if manifest1["batch_sha256"] != manifest2["batch_sha256"]:
            print("FAIL: Two generations produced different hashes!", file=sys.stderr)
            sys.exit(1)
        print("Two generations match byte-for-byte.")
        errs = validate_sitting_assets()
        if errs:
            for e in errs:
                print(f"FAIL: {e}", file=sys.stderr)
            sys.exit(1)
        print("All validations passed.")
        sys.exit(0)

    # Default: generate
    generate_sitting_assets()
    errs = validate_sitting_assets()
    if errs:
        for e in errs:
            print(f"WARNING: {e}", file=sys.stderr)
    else:
        print("Validation passed.")
