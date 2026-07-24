#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy"]
# ///
"""Generate the bounded DATAMON 8-frame walk + distinct 8-frame run art pilot.

This deliberately targets only the three approved representative characters. Raw AI output is
cached under .walk-gen-cache; accepted deterministic slices live in sprites-locomotion-pilot.
No full-roster mode exists: expansion remains a human approval gate.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
DATAMON = HERE.parent
SPRITES = DATAMON / "sprites"
IDLES = DATAMON / "sprites-idle"
HEADSHOTS = DATAMON / ".headshots-offline"
CACHE = DATAMON / ".walk-gen-cache"
OUT = DATAMON / "sprites-locomotion-pilot"
PILOT = ("julien-hovan", "veronica-marallag", "alex-andrianavalontsalama")
VIEWS = ("down", "up", "side")
MOTIONS = ("walk", "run")
NFRAMES = 8
OUT_H = 240
OPENAI_MODEL = "gpt-image-2-2026-04-21"
PRODUCTION_CALL_CAP = 100
_call_lock = threading.Lock()
_last_call = 0.0
_generation_call_count = 0
_generation_call_cap = PRODUCTION_CALL_CAP

_spec = importlib.util.spec_from_file_location("walk_base", HERE / "gen_walk_assets.py")
base = importlib.util.module_from_spec(_spec)
assert _spec.loader
_spec.loader.exec_module(base)

COMMON = (
    "Create a production-ready 2D pixel-art video-game locomotion sprite sheet. Use the attached "
    "accepted neutral directional idle as the EXACT authoritative reference for character height, "
    "head size, hair volume, torso width, adult anatomy, outfit, palette, camera, pixel density, "
    "and foot scale. Use the trainer sprite and headshot only for identity details. EXACTLY EIGHT "
    "full-body frames of the SAME character in ONE strictly horizontal row, "
    "read left-to-right. Eight equal-width invisible cells, generous perfectly solid chroma-magenta "
    "#ff00ff gutters, no overlap. Keep identity, outfit details, body proportions, head size, and "
    "camera angle identical in all frames. Crisp detailed realistic pixel art at the reference scale; "
    "NOT chibi, not super-deformed, not a cartoon redesign. Anatomically valid hips, knees, ankles, "
    "shoulders and elbows; no fused, detached, shortened, twisted, duplicated, or extra limbs. "
    "Opposite arm/leg action. Background entirely opaque #ff00ff including between limbs. No shadow, "
    "ground line, scenery, grid, divider, labels, text, arrows, or border. "
)
IDLE_PROMPT = COMMON.replace(
    "EXACTLY EIGHT full-body frames of the SAME character in ONE strictly horizontal row, read left-to-right. Eight equal-width invisible cells",
    "EXACTLY THREE full-body neutral IDLE views of the SAME character in ONE strictly horizontal row, read left-to-right: FRAME 1 directly FRONT, FRAME 2 directly BACK, FRAME 3 strict PROFILE facing RIGHT. Three equal-width invisible cells",
) + (
    "Motion: completely still neutral standing idle. Weight balanced between feet, feet comfortably "
    "close but not fused, knees unlocked, shoulders level, arms relaxed at sides, hands open. No stride, "
    "no leading foot, no arm swing, no running lean. All three views use one identical body scale and "
    "visible foot baseline. The back view shows no face; the profile does not turn toward camera."
)
WALK_PROMPT = COMMON + (
    "Motion: a restrained compact adult workplace WALK, one complete seamless cycle in eight genuinely "
    "distinct poses—not four poses duplicated or mirrored, and never a lunge, march, runway stride, "
    "split stance, or run. Frames: 1 compact left contact; 2 left loading response; 3 narrow passing "
    "pose as the right foot advances beneath the body; 4 left toe-off; 5 compact right contact; 6 "
    "right loading; 7 narrow passing as the left foot advances beneath the body; 8 right toe-off. "
    "Each shoe stays within roughly one shoe-length ahead of or behind the hips. Natural heel-to-toe "
    "roll, subtle arm swing close to the torso, stable upright head and torso, and one common baseline. "
    "Frames 1 and 5 clearly use opposite leading legs; frames 3 and 7 are the two narrowest poses."
)
RUN_PROMPT = COMMON + (
    "Motion: a true controlled athletic RUN cycle, NOT a sped-up walk, in eight genuinely distinct "
    "poses. Keep ground contacts directly beneath the body, compression compact, elbows near 90 degrees "
    "and close to the torso, and forward lean controlled. Include two unmistakable but compact flight "
    "phases where both feet are airborne; never use a superhero leap or split pose. Frames: 1 compact "
    "left contact; 2 compression; 3 push-off with knee drive; 4 tucked airborne flight; 5 compact right "
    "contact; 6 compression; 7 push-off; 8 tucked airborne flight. Preserve exact head/body scale, "
    "realistic adult anatomy, outfit, and a coherent canvas ground coordinate."
)
VIEW_PROMPTS = {
    "down": " Camera/view: directly from the FRONT, moving toward the viewer; torso remains front-facing.",
    "up": " Camera/view: directly from BEHIND, moving away; show only the back of head and outfit, no face.",
    "side": " Camera/view: strict full PROFILE, all frames facing and moving RIGHT; torso does not turn toward camera.",
}


def image_compass() -> Path:
    found = base.discover_image_compass()
    if not found:
        raise RuntimeError("image-compass generator not found; set IMAGE_COMPASS_DIR")
    return found


def idle_reference(slug: str, view: str) -> Path:
    direction = "right" if view == "side" else view
    return IDLES / slug / f"idle_{direction}.png"


def wait_slot() -> None:
    global _last_call
    with _call_lock:
        delay = 13.0 - (time.monotonic() - _last_call)
        if delay > 0:
            time.sleep(delay)
        _last_call = time.monotonic()


def generate(slug: str, motion: str, view: str, refresh: bool, provider: str) -> Path:
    dest = CACHE / (f"pilot-{slug}-idle.png" if motion == "idle" else f"pilot-{slug}-{motion}-{view}.png")
    if dest.exists() and not refresh:
        return dest
    ic = image_compass()
    prompt = IDLE_PROMPT if motion == "idle" else (WALK_PROMPT if motion == "walk" else RUN_PROMPT) + VIEW_PROMPTS[view]
    if motion == "idle":
        refs = [SPRITES / f"{slug}.png", idle_reference(slug, "down"),
                idle_reference(slug, "up"), idle_reference(slug, "side")]
    else:
        refs = [idle_reference(slug, view), SPRITES / f"{slug}.png"]
    head = HEADSHOTS / f"{slug}.png"
    if head.exists():
        refs.append(head)
    if provider == "openai":
        cmd = ["uv", "run", "--script", str(ic / "scripts/generate_openai.py"), "--model", OPENAI_MODEL,
               "--size", "1536x1024", "--quality", "high", "--background", "opaque"]
    else:
        cmd = ["uv", "run", "--script", str(ic / "scripts/generate_gemini.py"), "--model",
               "gemini-3.1-flash-image-preview", "--intent", "fast", "--resolution", "2K",
               "--aspect-ratio", "16:9"]
    cmd += ["--prompt", prompt, "--variant", f"pilot-{slug}-{motion}-{view}", "--json"]
    for ref in refs:
        cmd += ["--ref", str(ref)]
    global _generation_call_count
    for attempt in range(1, 4):
        with _call_lock:
            if _generation_call_count >= _generation_call_cap:
                raise RuntimeError(f"hard provider-call cap {_generation_call_cap} reached")
            _generation_call_count += 1
        if provider == "openai":
            wait_slot()
        sys.stderr.write(f"[pilot:{provider}] {slug}/{motion}/{view} attempt {attempt}\n")
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            continue
        if result.returncode == 0:
            generated = base._parse_paths(result.stdout)
            if generated and generated.exists():
                with Image.open(generated) as image:
                    image.load(); image.save(dest)
                return dest
        sys.stderr.write(result.stderr[-1000:] + "\n")
        if "429" not in result.stderr and "rate" not in result.stderr.lower():
            break
        time.sleep(30 * attempt)
    raise RuntimeError(f"generation failed: {slug}/{motion}/{view}")


def slice_figures(path: Path, tag: str, preserve_vertical: bool, count: int = NFRAMES) -> list[Image.Image]:
    array = base.strip_ground_line(base.key_magenta(Image.open(path)), tag)
    labels, comps = base.label_components(array[:, :, 3])
    bodies = sorted(comps, key=lambda value: value["size"], reverse=True)[:count]
    if len(bodies) != count:
        raise ValueError(f"{tag}: found {len(bodies)} bodies, expected {count}")
    sheet_w = array.shape[1]
    max_width_fraction = .22 if count == NFRAMES else .4
    if any(body["bbox"][2] - body["bbox"][0] > sheet_w * max_width_fraction for body in bodies):
        raise ValueError(f"{tag}: merged or over-wide body")
    bodies.sort(key=lambda body: (body["bbox"][0] + body["bbox"][2]) / 2)
    crops = []
    for body in bodies:
        x0, y0, x1, y1 = body["bbox"]
        figure = array[y0:y1, x0:x1].copy()
        figure[:, :, 3] = np.where(labels[y0:y1, x0:x1] == body["lab"], figure[:, :, 3], 0)
        crops.append((Image.fromarray(figure, "RGBA"), y0, y1))
    width = max(image.width for image, _, _ in crops)
    if preserve_vertical:
        global_y0, global_y1 = min(y0 for _, y0, _ in crops), max(y1 for _, _, y1 in crops)
        content_h = global_y1 - global_y0
    else:
        global_y0, content_h = 0, max(image.height for image, _, _ in crops)
    pad = max(8, round(content_h * .05)); canvas_w, canvas_h = width + pad * 2, content_h + pad * 2
    scale = OUT_H / canvas_h; output_w = max(1, round(canvas_w * scale)); frames = []
    for image, y0, _ in crops:
        cell = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        y = pad + (y0 - global_y0) if preserve_vertical else canvas_h - pad - image.height
        cell.alpha_composite(image, ((canvas_w - image.width) // 2, y))
        frames.append(cell.resize((output_w, OUT_H), Image.Resampling.LANCZOS))
    return frames


def alpha_geometry(frame: Image.Image, index: int) -> dict:
    anchor = base.frame_anchor(frame, index % 4)
    alpha = np.asarray(frame)[:, :, 3]
    ys, _ = np.where(alpha >= base.ANCHOR_ALPHA_THRESHOLD)
    y0, y1 = int(ys.min()), int(ys.max())
    anchor["phase"] = index / NFRAMES
    anchor["contactFoot"] = "left" if index == 0 else "right" if index == 4 else None
    anchor["rootY"] = round(y0 + .58 * (y1 - y0 + 1), 4)
    return anchor


def bake_slug(slug: str) -> None:
    output = OUT / slug; output.mkdir(parents=True, exist_ok=True)
    manifest = {"schemaVersion": 1, "slug": slug, "frameCount": NFRAMES, "idleFrameCount": 1,
                "cycleDistanceTiles": 2, "anchorMethod": "alpha-head-torso-root-v1", "motions": {}}
    idle_sheet = slice_figures(CACHE / f"pilot-{slug}-idle.png", f"{slug}/idle", False, 3)
    idle_frames = {"down": idle_sheet[0], "up": idle_sheet[1], "right": idle_sheet[2],
                   "left": idle_sheet[2].transpose(Image.Transpose.FLIP_LEFT_RIGHT)}
    idle_meta = {}
    for direction in ("down", "up", "left", "right"):
        frame = idle_frames[direction]; geometry = alpha_geometry(frame, 1)
        geometry["phase"] = 0; geometry["contactFoot"] = None
        frame.save(output / f"idle_{direction}.png")
        idle_meta[f"{direction}_0"] = geometry
    manifest["motions"]["idle"] = {"frames": idle_meta, "groundY": {}}
    review_rows = [("idle", direction, [idle_frames[direction]] * NFRAMES) for direction in ("down", "up", "right")]
    for motion in MOTIONS:
        motion_frames = {}
        for view in VIEWS:
            frames = slice_figures(CACHE / f"pilot-{slug}-{motion}-{view}.png", f"{slug}/{motion}/{view}", motion == "run")
            motion_frames["right" if view == "side" else view] = frames
        motion_frames["left"] = [image.transpose(Image.Transpose.FLIP_LEFT_RIGHT) for image in motion_frames["right"]]
        frame_meta = {}; ground_y = {}
        for direction in ("down", "up", "left", "right"):
            geometries = [alpha_geometry(frame, index) for index, frame in enumerate(motion_frames[direction])]
            if motion == "run":
                # Run slices retain the sheet's common vertical coordinate system. Pinning that
                # canvas ground (rather than each airborne shoe) preserves authored flight arcs.
                ground_y[direction] = max(geometry["footY"] for geometry in geometries)
            for index, (frame, geometry) in enumerate(zip(motion_frames[direction], geometries)):
                frame.save(output / f"{motion}_{direction}_{index}.png")
                frame_meta[f"{direction}_{index}"] = geometry
        manifest["motions"][motion] = {"frames": frame_meta, "groundY": ground_y}
        review_rows += [(motion, direction, motion_frames[direction]) for direction in ("down", "up", "right")]
    (output / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n")
    thumb_h = 120
    widths = [round(frame.width * thumb_h / frame.height) for _, _, row in review_rows for frame in row]
    cell_w = max(widths) + 12; label_w = 90
    review = Image.new("RGBA", (label_w + cell_w * NFRAMES, thumb_h * len(review_rows)), (28, 25, 38, 255))
    draw = ImageDraw.Draw(review)
    for row_index, (motion, direction, frames) in enumerate(review_rows):
        y = row_index * thumb_h
        draw.text((5, y + 8), f"{motion}\n{direction}", fill=(255, 230, 80, 255))
        for index, frame in enumerate(frames):
            resized = frame.resize((round(frame.width * thumb_h / frame.height), thumb_h), Image.Resampling.LANCZOS)
            review.alpha_composite(resized, (label_w + index * cell_w + (cell_w - resized.width) // 2, y))
    review.save(CACHE / f"pilot-{slug}-review.png")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default=",".join(PILOT))
    parser.add_argument("--provider", choices=("openai", "gemini"), default="openai")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--pipeline-only", action="store_true")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--call-cap", type=int, default=PRODUCTION_CALL_CAP,
                        help="hard provider-call cap for this invocation, including retries")
    args = parser.parse_args()
    global _generation_call_cap
    if args.call_cap < 1:
        raise SystemExit("--call-cap must be positive")
    _generation_call_cap = min(args.call_cap, PRODUCTION_CALL_CAP)
    slugs = tuple(value.strip() for value in args.only.split(",") if value.strip())
    invalid = set(slugs) - set(PILOT)
    if invalid:
        raise SystemExit(f"pilot is bounded; unsupported slugs: {sorted(invalid)}")
    CACHE.mkdir(parents=True, exist_ok=True)
    jobs = [(slug, motion, view) for slug in slugs for motion in MOTIONS for view in VIEWS]
    jobs += [(slug, "idle", "sheet") for slug in slugs]
    if not args.pipeline_only:
        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = [pool.submit(generate, slug, motion, view, args.refresh, args.provider) for slug, motion, view in jobs]
            for future in futures:
                future.result()
    for slug in slugs:
        bake_slug(slug)
        print(CACHE / f"pilot-{slug}-review.png")


if __name__ == "__main__":
    main()
