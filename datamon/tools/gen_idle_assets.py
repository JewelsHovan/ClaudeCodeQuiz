#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy"]
# ///
"""Generate DATAMON's full-roster four-direction neutral idle package.

Public runtime output:
  datamon/sprites-idle/manifest.json
  datamon/sprites-idle/<slug>/idle_{down,up,left,right}.png

Private cached generation/review output:
  datamon/.idle-gen-cache/

The three accepted locomotion-pilot idles are copied byte-for-byte. All other slugs are
produced from one true four-view OpenAI sheet per attempt, cached, sliced deterministically,
reviewed via contact sheets, and promoted only as a complete strict batch.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
DATAMON = HERE.parent
REPO = DATAMON.parent
SPRITES = DATAMON / "sprites"
WALK = DATAMON / "sprites-walk"
PILOT = DATAMON / "sprites-locomotion-pilot"
PUBLIC = DATAMON / "sprites-idle"
CACHE = DATAMON / ".idle-gen-cache"
RAW = CACHE / "raw"
REFS = CACHE / "refs"
REVIEWS = CACHE / "reviews"
STAGING = CACHE / "staging"
LEDGER = CACHE / "call-ledger.jsonl"
OPENAI_MODEL = "gpt-image-2-2026-04-21"
PROVENANCE = "openai:gpt-image-2-2026-04-21+deterministic-four-view-idle-v1"
PROMPT_VERSION = 1
GENERATE_CAP = 50
BASELINE_CALLS = 34
MAX_RETRIES = 16
OUT_H = 240
GROUND_Y = 228
DIRECTIONS = ("down", "up", "left", "right")
PILOT_SLUGS = ("alex-andrianavalontsalama", "julien-hovan", "veronica-marallag")
RUNTIME_FRAME_SCALE = 56 / 224

_spec = importlib.util.spec_from_file_location("walk_base", HERE / "gen_walk_assets.py")
base = importlib.util.module_from_spec(_spec)
assert _spec.loader
_spec.loader.exec_module(base)

COMMON = (
    "Create a production-ready 2D pixel-art video-game neutral idle sprite sheet using the "
    "attached standing trainer sprite, existing walk strip, and offline headshot only as exact "
    "references for identity, face, hair, adult anatomy, outfit, palette, lighting, pixel density, "
    "and rendering style. EXACTLY FOUR full-body neutral IDLE views of the SAME character in ONE "
    "strictly horizontal row, read left-to-right: FRAME 1 directly FRONT, FRAME 2 directly BACK, "
    "FRAME 3 strict PROFILE facing LEFT, FRAME 4 strict PROFILE facing RIGHT. Four equal-width "
    "invisible cells, generous perfectly solid chroma-magenta #ff00ff gutters, no overlap. Keep "
    "identity, outfit details, body proportions, head size, and camera angle identical in all "
    "frames. Crisp detailed realistic pixel art at the reference scale; NOT chibi, not super-"
    "deformed, not a cartoon redesign. Anatomically valid hips, knees, ankles, shoulders and "
    "elbows; no fused, detached, shortened, twisted, duplicated, or extra limbs. Background "
    "entirely opaque #ff00ff including between limbs. No shadow, ground line, scenery, grid, "
    "divider, labels, text, arrows, or border. Motion: completely still neutral standing idle. "
    "Weight balanced evenly between both feet, feet comfortably close but not fused, knees "
    "unlocked, shoulders level, arms relaxed at sides, hands open. No stride, no leading foot, "
    "no arm swing, no contact pose, and no running lean. All four views use one identical body "
    "scale and visible foot baseline. The back view shows no face. Both profiles are true "
    "separately authored opposite camera views, not mirrored duplicates, and neither turns toward "
    "camera. Preserve directional placement of asymmetric hair, accessories, jewelry, clothing "
    "closures, badges, watches, bags, and colored accents instead of blindly mirroring them."
)

_call_lock = threading.Lock()
_ledger_lock = threading.Lock()
_last_call = 0.0


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def append_jsonl(path: Path, row: dict) -> None:
    with _ledger_lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")


def reserve_call(row: dict) -> int:
    with _ledger_lock:
        current = call_count()
        if current >= GENERATE_CAP:
            raise RuntimeError(f"OpenAI call cap reached ({current}/{GENERATE_CAP}); stop for review")
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        with LEDGER.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
        return current + 1


def roster() -> list[str]:
    return sorted(path.stem for path in SPRITES.glob("*.png"))


def discover_headshots() -> Path:
    candidates = [DATAMON / ".headshots-offline"]
    for ancestor in HERE.parents:
        candidates.append(ancestor / "datamon" / ".headshots-offline")
    seen = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if candidate.exists() and len(list(candidate.glob("*.png"))) >= len(roster()):
            return candidate
    raise RuntimeError("offline headshots not found; expected datamon/.headshots-offline in this or a sibling checkout")


HEADSHOTS = discover_headshots()


def image_compass() -> Path:
    found = base.discover_image_compass()
    if not found:
        raise RuntimeError("image-compass generator not found; set IMAGE_COMPASS_DIR")
    return found


def wait_slot() -> None:
    global _last_call
    with _call_lock:
        delay = 13.0 - (time.monotonic() - _last_call)
        if delay > 0:
            time.sleep(delay)
        _last_call = time.monotonic()


def call_count() -> int:
    return sum(1 for row in read_jsonl(LEDGER) if row.get("provider") == "openai" and row.get("event") == "call")


def reference_strip(slug: str) -> Path:
    REFS.mkdir(parents=True, exist_ok=True)
    path = REFS / f"walk-strip-{slug}.png"
    if path.exists():
        return path
    frames = []
    for direction in DIRECTIONS:
        for index in range(4):
            frames.append(Image.open(WALK / slug / f"{direction}_{index}.png").convert("RGBA"))
    thumb_h = 120
    resized = [frame.resize((round(frame.width * thumb_h / frame.height), thumb_h), Image.Resampling.LANCZOS) for frame in frames]
    cell_w = max(frame.width for frame in resized) + 20
    sheet = Image.new("RGBA", (cell_w * 4, (thumb_h + 20) * 4), (255, 0, 255, 255))
    draw = ImageDraw.Draw(sheet)
    for row, direction in enumerate(DIRECTIONS):
        draw.text((6, row * (thumb_h + 20) + 2), direction, fill=(255, 255, 255, 255))
        for col in range(4):
            frame = resized[row * 4 + col]
            x = col * cell_w + (cell_w - frame.width) // 2
            y = row * (thumb_h + 20) + 18
            sheet.alpha_composite(frame, (x, y))
    sheet.convert("RGB").save(path)
    return path


def prompt_sha() -> str:
    return sha256_bytes(COMMON.encode("utf-8"))


def reference_hashes(slug: str) -> dict[str, str]:
    trainer = SPRITES / f"{slug}.png"
    walk_strip = reference_strip(slug)
    headshot = HEADSHOTS / f"{slug}.png"
    return {
        "trainerSha256": sha256_file(trainer),
        "walkStripSha256": sha256_file(walk_strip),
        "headshotSha256": sha256_file(headshot),
    }


def generate(slug: str, refresh: bool) -> Path:
    slug_dir = RAW / slug
    slug_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(slug_dir.glob("attempt-*.png"))
    if existing and not refresh:
        return existing[-1]
    attempt = len(existing) + 1
    ic = image_compass()
    cmd = [
        "uv", "run", "--script", str(ic / "scripts" / "generate_openai.py"),
        "--model", OPENAI_MODEL, "--size", "1536x1024", "--quality", "high",
        "--background", "opaque", "--prompt", COMMON,
        "--variant", f"idle-{slug}-attempt-{attempt}", "--json",
        "--ref", str(SPRITES / f"{slug}.png"),
        "--ref", str(reference_strip(slug)),
        "--ref", str(HEADSHOTS / f"{slug}.png"),
    ]
    ledger_base = {
        "attempt": attempt,
        "cap": GENERATE_CAP,
        "model": OPENAI_MODEL,
        "promptSha256": prompt_sha(),
        "provider": "openai",
        "references": reference_hashes(slug),
        "slug": slug,
    }
    reserve_call({**ledger_base, "event": "call", "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    wait_slot()
    for api_attempt in range(1, 4):
        sys.stderr.write(f"[idle:openai] {slug} attempt {attempt} apiTry {api_attempt}/3\n")
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            append_jsonl(LEDGER, {**ledger_base, "apiTry": api_attempt, "event": "timeout"})
            continue
        if result.returncode == 0:
            generated = base._parse_paths(result.stdout)
            if generated and generated.exists():
                dest = slug_dir / f"attempt-{attempt:02d}.png"
                with Image.open(generated) as image:
                    image.load()
                    image.save(dest)
                append_jsonl(LEDGER, {
                    **ledger_base,
                    "apiTry": api_attempt,
                    "event": "success",
                    "rawSha256": sha256_file(dest),
                    "rawPath": str(dest.relative_to(DATAMON)),
                })
                return dest
        retryable = "429" in result.stderr or "rate" in result.stderr.lower()
        append_jsonl(LEDGER, {
            **ledger_base,
            "apiTry": api_attempt,
            "event": "error",
            "retryable": retryable,
            "stderrTail": result.stderr[-1000:],
        })
        if not retryable:
            break
        time.sleep(30 * api_attempt)
    raise RuntimeError(f"generation failed for {slug}")


def slice_figures(path: Path, tag: str) -> list[Image.Image]:
    array = base.strip_ground_line(base.key_magenta(Image.open(path)), tag)
    labels, comps = base.label_components(array[:, :, 3])
    bodies = sorted(comps, key=lambda value: value["size"], reverse=True)[:4]
    if len(bodies) != 4:
        raise ValueError(f"{tag}: found {len(bodies)} bodies, expected 4")
    sheet_w = array.shape[1]
    if any(body["bbox"][2] - body["bbox"][0] > sheet_w * 0.32 for body in bodies):
        raise ValueError(f"{tag}: merged or over-wide body")
    bodies.sort(key=lambda body: (body["bbox"][0] + body["bbox"][2]) / 2)
    crops: list[tuple[Image.Image, int]] = []
    for body in bodies:
        x0, y0, x1, y1 = body["bbox"]
        figure = array[y0:y1, x0:x1].copy()
        figure[:, :, 3] = np.where(labels[y0:y1, x0:x1] == body["lab"], figure[:, :, 3], 0)
        crops.append((Image.fromarray(figure, "RGBA"), y0))
    width = max(image.width for image, _ in crops)
    content_h = max(image.height for image, _ in crops)
    pad = max(8, round(content_h * 0.05))
    canvas_w = width + pad * 2
    canvas_h = content_h + pad * 2
    scale = OUT_H / canvas_h
    output_w = max(1, round(canvas_w * scale))
    frames = []
    for image, _y0 in crops:
        cell = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        cell.alpha_composite(image, ((canvas_w - image.width) // 2, canvas_h - pad - image.height))
        frame = cell.resize((output_w, OUT_H), Image.Resampling.LANCZOS)
        frames.append(pin_ground(frame, GROUND_Y))
    return frames


def pin_ground(frame: Image.Image, ground_y: int) -> Image.Image:
    rgba = np.asarray(frame)
    ys, _xs = np.where(rgba[:, :, 3] >= base.ANCHOR_ALPHA_THRESHOLD)
    if not len(ys):
        raise ValueError("frame has no visible alpha")
    delta = ground_y - int(ys.max())
    if delta == 0:
        return frame
    shifted = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    shifted.alpha_composite(frame, (0, delta))
    return shifted


def idle_anchor(frame: Image.Image) -> dict:
    rgba = np.asarray(frame)
    alpha = rgba[:, :, 3]
    ys, _ = np.where(alpha >= base.ANCHOR_ALPHA_THRESHOLD)
    if not len(ys):
        raise ValueError("idle frame has no visible alpha")
    y0, y1 = int(ys.min()), int(ys.max())
    root = base.frame_anchor(frame, 1)
    root["contactFoot"] = None
    root["phase"] = 0
    root["rootY"] = round(y0 + 0.58 * (y1 - y0 + 1), 4)
    return root


def visible_height(frame: Image.Image) -> int:
    alpha = np.asarray(frame)[:, :, 3]
    ys, _ = np.where(alpha >= base.ANCHOR_ALPHA_THRESHOLD)
    return int(ys.max() - ys.min() + 1)


def neutrality_ok(frame: Image.Image) -> bool:
    alpha = np.asarray(frame)[:, :, 3]
    ys, xs = np.where(alpha >= base.ANCHOR_ALPHA_THRESHOLD)
    return int(xs.max() - xs.min() + 1) <= int((ys.max() - ys.min() + 1) * 0.66)


def copy_pilot_idle(slug: str, output_root: Path) -> dict:
    out = output_root / slug
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((PILOT / slug / "manifest.json").read_text(encoding="utf-8"))
    pilot_frames = manifest["motions"]["idle"]["frames"]
    directions = {}
    for direction in DIRECTIONS:
        # The accepted pilot's side-view filenames were authored with left/right labels
        # reversed. Remap only those legacy copies so the public idle direction matches
        # movement semantics without regenerating or mutating the pilot package.
        source_direction = {"left": "right", "right": "left"}.get(direction, direction)
        src = PILOT / slug / f"idle_{source_direction}.png"
        dest = out / f"idle_{direction}.png"
        shutil.copyfile(src, dest)
        anchor = pilot_frames[f"{source_direction}_0"]
        directions[direction] = {
            "file": f"{slug}/idle_{direction}.png",
            "sha256": sha256_file(dest),
            "width": anchor["width"],
            "height": anchor["height"],
            "bodyX": anchor["bodyX"],
            "footY": anchor["footY"],
            "rootY": anchor["rootY"],
            "phase": 0,
            "contactFoot": None,
        }
    return {
        "slug": slug,
        "reviewState": "accepted",
        "source": {
            "kind": "pilot-copy",
            "model": OPENAI_MODEL,
            "provenance": "sprites-locomotion-pilot",
            "promptVersion": None,
            "promptSha256": None,
            "rawSha256": None,
            "references": {},
        },
        "directions": directions,
    }


def generate_entry(slug: str, refresh: bool, output_root: Path) -> dict:
    raw = generate(slug, refresh)
    frames = slice_figures(raw, f"idle/{slug}")
    out = output_root / slug
    out.mkdir(parents=True, exist_ok=True)
    directions = {}
    for direction, frame in zip(DIRECTIONS, frames):
        path = out / f"idle_{direction}.png"
        frame.save(path)
        anchor = idle_anchor(frame)
        runtime_visible = visible_height(frame) * RUNTIME_FRAME_SCALE
        if runtime_visible < 53 or runtime_visible > 56:
            raise ValueError(f"{slug}/{direction}: runtime visible height {runtime_visible:.2f} out of bounds")
        if anchor["footY"] != GROUND_Y:
            raise ValueError(f"{slug}/{direction}: footY {anchor['footY']} != {GROUND_Y}")
        if not neutrality_ok(frame):
            raise ValueError(f"{slug}/{direction}: silhouette too wide for neutral idle")
        directions[direction] = {
            "file": f"{slug}/idle_{direction}.png",
            "sha256": sha256_file(path),
            "width": anchor["width"],
            "height": anchor["height"],
            "bodyX": anchor["bodyX"],
            "footY": anchor["footY"],
            "rootY": anchor["rootY"],
            "phase": 0,
            "contactFoot": None,
        }
    return {
        "slug": slug,
        "reviewState": "accepted",
        "source": {
            "kind": "openai-four-view-sheet",
            "model": OPENAI_MODEL,
            "provenance": PROVENANCE,
            "promptVersion": PROMPT_VERSION,
            "promptSha256": prompt_sha(),
            "rawSha256": sha256_file(raw),
            "references": reference_hashes(slug),
        },
        "directions": directions,
    }


def build_contact_sheets(entries: list[dict], output_root: Path) -> dict[str, str]:
    REVIEWS.mkdir(parents=True, exist_ok=True)
    source_sheet = build_sheet(entries, output_root, runtime=False)
    runtime_sheet = build_sheet(entries, output_root, runtime=True)
    source_path = REVIEWS / "source-contact-sheet.png"
    runtime_path = REVIEWS / "runtime-contact-sheet.png"
    source_sheet.save(source_path)
    runtime_sheet.save(runtime_path)
    return {
        "sourceContactSheetSha256": sha256_file(source_path),
        "runtimeContactSheetSha256": sha256_file(runtime_path),
        "sourceContactSheet": str(source_path.relative_to(REPO)),
        "runtimeContactSheet": str(runtime_path.relative_to(REPO)),
    }


def build_sheet(entries: list[dict], output_root: Path, runtime: bool) -> Image.Image:
    bg = (26, 32, 44, 255)
    row_h = 90 if runtime else 260
    label_w = 220
    thumb_h = 56 if runtime else 240
    max_w = 110 if runtime else max(
        direction["width"] for entry in entries for direction in entry["directions"].values()
    )
    cell_w = max_w + 20
    width = label_w + cell_w * 5
    height = row_h * len(entries)
    sheet = Image.new("RGBA", (width, height), bg)
    draw = ImageDraw.Draw(sheet)
    for row, entry in enumerate(entries):
        y = row * row_h
        if row % 2:
            draw.rectangle((0, y, width, y + row_h), fill=(31, 39, 54, 255))
        draw.text((8, y + 6), entry["slug"], fill=(236, 241, 245, 255))
        trainer = Image.open(SPRITES / f"{entry['slug']}.png").convert("RGBA")
        frames = [("trainer", trainer)] + [
            (direction, Image.open(output_root / entry["slug"] / f"idle_{direction}.png").convert("RGBA"))
            for direction in DIRECTIONS
        ]
        foot_line = y + (78 if runtime else 246)
        for col, (label, image) in enumerate(frames):
            x = label_w + col * cell_w
            draw.text((x + 4, y + 6), label, fill=(158, 177, 196, 255))
            alpha = np.asarray(image)[:, :, 3]
            ys, xs = np.where(alpha >= base.ANCHOR_ALPHA_THRESHOLD)
            crop = image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
            target_h = thumb_h
            target_w = max(1, round(crop.width * target_h / crop.height))
            resized = crop.resize((target_w, target_h), Image.Resampling.NEAREST if runtime else Image.Resampling.LANCZOS)
            sheet.alpha_composite(resized, (x + (cell_w - target_w) // 2, foot_line - target_h))
            draw.line((x + 8, foot_line, x + cell_w - 8, foot_line), fill=(67, 219, 190, 255), width=1)
    return sheet


def batch_sha(entries: list[dict], output_root: Path) -> str:
    h = hashlib.sha256()
    for entry in entries:
        for direction in DIRECTIONS:
            rel = entry["directions"][direction]["file"]
            h.update(rel.encode("utf-8"))
            h.update(b"\0")
            h.update((output_root / rel).read_bytes())
            h.update(b"\0")
    return h.hexdigest()


def manifest(entries: list[dict], review: dict[str, str], output_root: Path) -> dict:
    total_calls = call_count()
    return {
        "schemaVersion": 1,
        "batch": "full-roster-idles-v1",
        "reviewState": "accepted",
        "slugCount": len(entries),
        "assetCount": len(entries) * len(DIRECTIONS),
        "roster": [entry["slug"] for entry in entries],
        "directions": list(DIRECTIONS),
        "canvas": {
            "height": OUT_H,
            "groundY": GROUND_Y,
            "runtimeModelVisibleHeight": 56,
            "runtimeVisibleRatio": 14 / 15,
        },
        "generation": {
            "baselineTarget": BASELINE_CALLS,
            "callCap": GENERATE_CAP,
            "retryAllowance": MAX_RETRIES,
            "totalCalls": total_calls,
            "model": OPENAI_MODEL,
            "promptVersion": PROMPT_VERSION,
            "provenance": PROVENANCE,
        },
        "review": {
            "reviewed": True,
            **review,
        },
        "batchSha256": batch_sha(entries, output_root),
        "entries": entries,
    }


def write_manifest(entries: list[dict], review: dict[str, str], output_root: Path) -> Path:
    path = output_root / "manifest.json"
    payload = json.dumps(manifest(entries, review, output_root), sort_keys=True, separators=(",", ":")) + "\n"
    path.write_text(payload, encoding="utf-8")
    return path


def stage_root() -> Path:
    return STAGING / "sprites-idle.next"


def promote_stage(output_root: Path) -> None:
    backup = STAGING / "sprites-idle.prev"
    if backup.exists():
        shutil.rmtree(backup)
    if PUBLIC.exists():
        PUBLIC.rename(backup)
    try:
        output_root.rename(PUBLIC)
    except Exception:
        if backup.exists() and not PUBLIC.exists():
            backup.rename(PUBLIC)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def run(slugs: list[str], refresh: bool, retry_slugs: set[str]) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    STAGING.mkdir(parents=True, exist_ok=True)
    output_root = stage_root()
    if output_root.exists():
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    entries = [copy_pilot_idle(slug, output_root) for slug in slugs if slug in PILOT_SLUGS]
    generated_slugs = [slug for slug in slugs if slug not in PILOT_SLUGS]
    # Image generation is latency-bound. Start at most four calls concurrently while wait_slot()
    # preserves the provider's 13-second launch spacing and reserve_call() enforces the global cap.
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(generate_entry, slug, refresh or slug in retry_slugs, output_root): slug
            for slug in generated_slugs
        }
        for future in as_completed(futures):
            slug = futures[future]
            entry = future.result()
            entries.append(entry)
            print(f"accepted idle sheet: {slug}", flush=True)
    entries.sort(key=lambda entry: entry["slug"])
    review = build_contact_sheets(entries, output_root)
    write_manifest(entries, review, output_root)
    promote_stage(output_root)
    print(PUBLIC / "manifest.json")
    print(review["sourceContactSheet"])
    print(review["runtimeContactSheet"])
    print(f"OpenAI calls recorded: {call_count()}/{GENERATE_CAP}")


def needs_openai_key(slugs: list[str], refresh: bool, retry_slugs: set[str]) -> bool:
    for slug in slugs:
        if slug in PILOT_SLUGS:
            continue
        if refresh or slug in retry_slugs:
            return True
        if not sorted((RAW / slug).glob("attempt-*.png")):
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default=",".join(roster()), help="comma-separated roster subset to promote (default: full roster)")
    parser.add_argument("--retry", default="", help="comma-separated non-pilot slugs to regenerate while still promoting the selected roster")
    parser.add_argument("--refresh", action="store_true", help="ignore cached raw sheets and make a fresh attempt for every selected non-pilot slug")
    args = parser.parse_args()
    slugs = [value.strip() for value in args.only.split(",") if value.strip()]
    retry_slugs = {value.strip() for value in args.retry.split(",") if value.strip()}
    known = set(roster())
    unknown = sorted((set(slugs) | retry_slugs) - known)
    if unknown:
        sys.stderr.write(f"unknown slugs: {unknown}\n")
        return 2
    if needs_openai_key(slugs, args.refresh, retry_slugs) and not os.environ.get("OPENAI_API_KEY"):
        sys.stderr.write("OPENAI_API_KEY not set\n")
        return 2
    try:
        run(sorted(slugs), args.refresh, retry_slugs)
    except Exception as exc:  # pragma: no cover - CLI surface
        sys.stderr.write(f"idle generation failed: {exc}\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
