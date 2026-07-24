#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy"]
# ///
"""Batch generator for DATAMON's 4-direction walk-cycle frames (PRD: real walk/run animation).

Pipeline per character — validated end-to-end on veronica-marallag (deep-think
datamon-gba-aesthetic round-4-walkcycle, learnings #S249-#S255):

  1. GENERATE 3 sprite-sheets with GPT Image 2 or Nano Banana 2 (one API call per sheet):
     down (front), up (back), side (profile walking RIGHT). All 4 frames are rendered in a
     SINGLE image — that is the consistency trick: every frame shares identity/lighting/
     palette by construction (separate generations drift). Refs = the existing realistic
     sprite (style+outfit) + headshot (face). Solid magenta bg for keying.
     Raw sheets cached to datamon/.walk-gen-cache/<slug>-<view>.png.
  2. SLICE (deterministic): hue-based magenta key (also catches pink/purple ground lines)
     -> find the 4 largest complete character components across the whole sheet -> sort them
     left-to-right -> uniform cell with margin, anchored BOTTOM-CENTER (feet planted, no
     bounce) -> LANCZOS to a 240px-tall frame. Whole-sheet detection avoids clipping a wide
     stride when a shoe crosses an invisible quarter boundary.
  3. BAKE directions: down/up from their own sheets; RIGHT = raw side frames (the sheet
     walks right); LEFT = horizontally mirrored side frames. L/R ship pre-baked because
     game.js loads explicit per-direction files (no runtime mirroring, #S253).
     Output: datamon/sprites-walk/<slug>/{down,up,left,right}_{0..3}.png
  4. REVIEW: a 4x4 contact sheet per character at .walk-gen-cache/<slug>-review.png.

Reproducibility: AI generation is non-deterministic; steps 2-4 are deterministic for a
given cached raw sheet (re-run them free with --pipeline-only).

Usage:
  # One character with GPT Image 2 (3 API calls), then eyeball the review image:
  uv run --script datamon/tools/gen_walk_assets.py --only julien-hovan --force --refresh --provider openai

  # Everyone not yet in sprites-walk/ (3 calls each), 3 sheets generating in parallel:
  uv run --script datamon/tools/gen_walk_assets.py --gen

  # Re-slice/bake from cached raw sheets only (no API):
  uv run --script datamon/tools/gen_walk_assets.py --pipeline-only

  # A character whose side sheet came out walking LEFT (bake flipped):
  uv run --script datamon/tools/gen_walk_assets.py --pipeline-only --only bad-slug --mirror-side bad-slug

Flags: --only a,b  --limit N  --force  --refresh  --provider openai|gemini  --gen
       --pipeline-only  --workers N  --mirror-side a,b
Env:   OPENAI_API_KEY or GEMINI_API_KEY; IMAGE_COMPASS_DIR (optional override).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
DATAMON = HERE.parent
REPO = DATAMON.parent
HEADSHOTS = DATAMON / ".headshots-offline"
SPRITES = DATAMON / "sprites"
IDLES = DATAMON / "sprites-idle"
OUT_ROOT = DATAMON / "sprites-walk"
CACHE = DATAMON / ".walk-gen-cache"

NFRAMES = 4
OUT_H = 240          # matches the veronica frames committed in sprites-walk/

# Direction-specific accepted idles are the authoritative body-scale references. Earlier
# prompts used only the front trainer and produced correct height but 18–62% wider heads and
# lunge-like side silhouettes, making characters appear to grow as movement began.
BASE = (
    "Create a production-ready 2D pixel-art video-game walk-cycle sprite sheet. Use the "
    "attached accepted neutral directional idle as the EXACT authoritative reference for "
    "character height, head size, hair volume, torso width, adult anatomy, outfit, palette, "
    "camera angle, pixel density, and foot scale. Use the trainer sprite and headshot only for "
    "identity details. EXACTLY FOUR DISTINCT full-body frames of the SAME character in ONE "
    "strictly horizontal row, read left-to-right. Each frame occupies one equal-width invisible "
    "cell with generous solid-magenta gutters and no overlap, grid, or dividers. Keep the same "
    "head/body scale and one common foot baseline in every frame. Crisp detailed realistic pixel "
    "art; NOT chibi and NOT super-deformed. Motion is a restrained compact workplace WALK, not "
    "a lunge, march, runway stride, split stance, or run. Frames: compact left-foot contact; "
    "passing pose with the right foot advancing beneath the body; compact right-foot contact; "
    "passing pose with the left foot advancing beneath the body. Contacts clearly alternate, "
    "but each shoe stays within roughly one shoe-length ahead of or behind the hips. Knees flex "
    "naturally beneath the torso and subtle opposite arm swing stays close to the body. Keep all "
    "limbs anatomically connected with no fused, twisted, detached, shortened, duplicated, or "
    "extra anatomy. Entire canvas background perfectly flat opaque chroma magenta #ff00ff, "
    "including between limbs. No transparency, shadow, ground line, scenery, labels, text, "
    "arrows, or border."
)
VIEWS = {
    "down": BASE + " Camera/view: directly from the FRONT, walking toward the viewer. Make left/right alternation readable through foot placement, knee bend, trouser shading, and opposite arm swing while the torso stays front-facing.",
    "up":   BASE + " Camera/view: directly from BEHIND, walking away. Show only the back of the head and outfit, no face. Make left/right alternation readable through heel placement, knee bend, trouser shading, and opposite arm swing while the torso stays back-facing.",
    "side": BASE + " Camera/view: strict full PROFILE, all four frames facing and walking RIGHT. Near and far legs visibly exchange front/back positions with stable subtle shading. Keep the maximum full silhouette near twice the supplied neutral profile or less. Do not turn the torso toward camera.",
}

OPENAI_MODEL = "gpt-image-2-2026-04-21"
PRODUCTION_CALL_CAP = 100
_OPENAI_CALL_LOCK = threading.Lock()
_OPENAI_LAST_CALL = 0.0
_GENERATION_CALL_COUNT = 0
_GENERATION_CALL_CAP = PRODUCTION_CALL_CAP


def roster() -> list[str]:
    return sorted(p.stem for p in SPRITES.glob("*.png"))


def discover_image_compass() -> Path | None:
    env = os.environ.get("IMAGE_COMPASS_DIR")
    cands = [Path(env)] if env else []
    home = Path.home()
    cands += [
        home / "Desktop/Internals/claude-compass-superpowers/image-compass",
        REPO.parent / "claude-compass-superpowers/image-compass",
        REPO.parent / "image-compass",
    ]
    for c in cands:
        if (c / "scripts" / "generate_gemini.py").exists():
            return c
    return None


def _parse_paths(stdout: str) -> Path | None:
    for line in reversed(stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith("{") and "paths" in line:
            try:
                paths = json.loads(line).get("paths", [])
            except json.JSONDecodeError:
                continue
            if paths:
                return Path(paths[0])
    return None


def _wait_for_openai_slot() -> None:
    """Keep starts below the documented Tier-1 limit of five image calls/minute."""
    global _OPENAI_LAST_CALL
    with _OPENAI_CALL_LOCK:
        wait = 13.0 - (time.monotonic() - _OPENAI_LAST_CALL)
        if wait > 0:
            time.sleep(wait)
        _OPENAI_LAST_CALL = time.monotonic()


def idle_reference(slug: str, view: str) -> Path:
    direction = "right" if view == "side" else view
    return IDLES / slug / f"idle_{direction}.png"


def ai_generate(slug: str, view: str, ic_dir: Path, provider: str) -> Path | None:
    """Generate one raw walk sheet; replace its cache entry only after a valid response."""
    if provider == "openai":
        gen = ic_dir / "scripts" / "generate_openai.py"
        cmd = ["uv", "run", "--script", str(gen), "--model", OPENAI_MODEL,
               "--size", "1536x1024", "--quality", "high", "--background", "opaque"]
    else:
        gen = ic_dir / "scripts" / "generate_gemini.py"
        cmd = ["uv", "run", "--script", str(gen), "--model", "gemini-3.1-flash-image-preview",
               "--intent", "fast", "--resolution", "2K", "--aspect-ratio", "16:9"]
    cmd += ["--prompt", VIEWS[view], "--variant", f"walk-{slug}-{view}", "--json",
            "--ref", str(idle_reference(slug, view)), "--ref", str(SPRITES / f"{slug}.png")]
    headshot = HEADSHOTS / f"{slug}.png"
    if headshot.exists():
        cmd += ["--ref", str(headshot)]

    sys.stderr.write(f"[gen:{provider}] {slug}/{view}\n")
    global _GENERATION_CALL_COUNT
    for attempt in range(1, 4):
        with _OPENAI_CALL_LOCK:
            if _GENERATION_CALL_COUNT >= _GENERATION_CALL_CAP:
                sys.stderr.write(f"[gen:{provider}] hard call cap {_GENERATION_CALL_CAP} reached\n")
                return None
            _GENERATION_CALL_COUNT += 1
        if provider == "openai":
            _wait_for_openai_slot()
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            sys.stderr.write(f"[gen:{provider}] {slug}/{view}: TIMEOUT attempt {attempt}/3\n")
            continue
        if res.returncode == 0:
            break
        retryable = "429" in res.stderr or "rate" in res.stderr.lower()
        sys.stderr.write(
            f"[gen:{provider}] {slug}/{view}: rc={res.returncode} attempt {attempt}/3\n"
            f"{res.stderr[-800:]}\n"
        )
        if not retryable:
            return None
        time.sleep(30 * attempt)
    else:
        return None

    raw = _parse_paths(res.stdout)
    if not raw or not raw.exists():
        sys.stderr.write(f"[gen:{provider}] {slug}/{view}: no paths\n{res.stdout[-400:]}\n")
        return None
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / f"{slug}-{view}.png"
    # Decode before replacing the cached source, so a truncated response cannot destroy the
    # previous known-good sheet during a refresh run.
    with Image.open(raw) as generated:
        generated.load()
        generated.save(dest)
    return dest


# --- deterministic slice (ported verbatim from validated slice_walk.py) ----
def key_magenta(im: Image.Image) -> np.ndarray:
    """Hue-based magenta key: green much lower than both red and blue. Catches the bright
    #ff00ff bg AND the darker pink/purple ground-shadow line, without eating skin/hair."""
    a = np.array(im.convert("RGBA"))
    r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
    mag = (r > 90) & (b > 90) & (g < 0.6 * np.minimum(r, b))
    a[:, :, 3] = np.where(mag, 0, 255)
    return a


def label_components(alpha: np.ndarray):
    """4-connectivity labelling -> (label map, [{lab, bbox, size}])."""
    from collections import deque
    solid = alpha >= 128
    h, w = solid.shape
    lab = np.zeros((h, w), int)
    cur = 0
    comps = []
    for y in range(h):
        for x in range(w):
            if solid[y, x] and lab[y, x] == 0:
                cur += 1
                n = 0
                x0 = x1 = x; y0 = y1 = y
                q = deque([(y, x)]); lab[y, x] = cur
                while q:
                    cy, cx = q.popleft(); n += 1
                    x0 = min(x0, cx); x1 = max(x1, cx); y0 = min(y0, cy); y1 = max(y1, cy)
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and lab[ny, nx] == 0:
                            lab[ny, nx] = cur; q.append((ny, nx))
                comps.append({"lab": cur, "bbox": (x0, y0, x1 + 1, y1 + 1), "size": n})
    return lab, comps


def strip_ground_line(a: np.ndarray, tag: str) -> np.ndarray:
    """NB2 sometimes draws a non-magenta ground line under the feet despite the prompt.
    The line is one CONTIGUOUS opaque run across the sheet, while any row through the
    figures is 4 short disjoint runs (~10-17% of sheet width each, magenta gaps between) —
    total opacity is NOT a safe test (wide figures cross it), contiguous-run length is.
    Only look at the bottom 30% (the line sits at the feet). A 1-3px trim off the foot
    bottoms where they touch the line is invisible at in-game scale."""
    h, w = a.shape[:2]
    solid = a[:, :, 3] >= 128
    stripped = 0
    for y in range(int(h * 0.7), h):
        row = solid[y]
        if not row.any():
            continue
        # longest contiguous run of opaque pixels in this row
        padded = np.diff(np.concatenate(([0], row.astype(int), [0])))
        starts, ends = np.where(padded == 1)[0], np.where(padded == -1)[0]
        if (ends - starts).max() > 0.3 * w:
            a[y, :, 3] = 0
            stripped += 1
    if stripped:
        sys.stderr.write(f"[slice] {tag}: stripped ground line ({stripped} rows)\n")
    return a


def slice_sheet(sheet_path: Path, tag: str) -> list[Image.Image] | None:
    """Sheet -> 4 keyed, feet-aligned, OUT_H-tall RGBA frames.

    Detect complete figures across the full sheet before cropping. The previous quarter-first
    algorithm clipped wide contact poses whenever a shoe crossed an invisible 1/4 boundary.
    A flat keyed background makes the four character bodies separate connected components;
    selecting the four largest and sorting by horizontal centre preserves the complete pose.
    """
    a = strip_ground_line(key_magenta(Image.open(sheet_path)), tag)
    lab, comps = label_components(a[:, :, 3])
    bodies = sorted(comps, key=lambda c: c["size"], reverse=True)[:NFRAMES]
    if len(bodies) != NFRAMES:
        sys.stderr.write(f"[slice] {tag}: got {len(bodies)} figures, expected {NFRAMES} — SKIP\n")
        return None

    # Reject a connected ground artifact or merged pair instead of silently treating it as a
    # figure. Legitimate poses occupy less than 40% of a four-frame sheet's total width.
    sheet_w = a.shape[1]
    if any(body["bbox"][2] - body["bbox"][0] > sheet_w * 0.40 for body in bodies):
        sys.stderr.write(f"[slice] {tag}: merged/over-wide figure component — SKIP\n")
        return None

    bodies.sort(key=lambda body: (body["bbox"][0] + body["bbox"][2]) / 2)
    crops = []
    for body in bodies:
        bx0, by0, bx1, by1 = body["bbox"]
        figure = a[by0:by1, bx0:bx1].copy()
        component_mask = lab[by0:by1, bx0:bx1] == body["lab"]
        figure[:, :, 3] = np.where(component_mask, figure[:, :, 3], 0)
        crops.append(Image.fromarray(figure, "RGBA"))
    cw = max(c.width for c in crops); ch = max(c.height for c in crops)
    if cw > ch:  # a merged ground line / two figures in one blob makes a wide bbox
        sys.stderr.write(f"[slice] {tag}: figure wider than tall ({cw}x{ch}) — SKIP\n")
        return None
    pad = max(8, round(ch * 0.05))
    CW, CH = cw + pad * 2, ch + pad * 2
    s = OUT_H / CH
    outW = max(1, round(CW * s))
    frames = []
    for c in crops:
        cell = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        cell.alpha_composite(c, ((CW - c.width) // 2, CH - pad - c.height))
        frames.append(cell.resize((outW, OUT_H), Image.LANCZOS))
    return frames


ANCHOR_ALPHA_THRESHOLD = 128
ANCHOR_HEAD_END = 0.27
ANCHOR_TORSO_END = 0.58
ANCHOR_METHOD = "alpha-head-torso-midpoint-v1"
CYCLE_DISTANCE_TILES = 2


def frame_anchor(frame: Image.Image, frame_index: int) -> dict:
    """Return a stable visual-body X and visible-foot Y for one accepted frame.

    Whole-silhouette centering moves the torso opposite a wide stride. The midpoint of the
    alpha-weighted head and torso centers bounds residual head/torso jitter below one logical
    pixel at the 56px runtime height across the accepted roster.
    """
    rgba = np.asarray(frame.convert("RGBA"))
    alpha = rgba[:, :, 3]
    ys, _xs = np.where(alpha >= ANCHOR_ALPHA_THRESHOLD)
    if not len(ys):
        raise ValueError("walk frame has no visible alpha")
    y0, y1 = int(ys.min()), int(ys.max())
    visible_h = y1 - y0 + 1

    def weighted_x(start: float, end: float) -> float:
        sy = max(0, int(y0 + start * visible_h))
        ey = min(frame.height, int(y0 + end * visible_h) + 1)
        weights = alpha[sy:ey].astype(np.float64) / 255.0
        if not weights.size or weights.sum() <= 0:
            raise ValueError("walk frame anchor band has no alpha")
        xs = np.arange(frame.width, dtype=np.float64)[None, :]
        return float((weights * xs).sum() / weights.sum())

    head_x = weighted_x(0.0, ANCHOR_HEAD_END)
    torso_x = weighted_x(ANCHOR_HEAD_END, ANCHOR_TORSO_END)
    return {
        "bodyX": round((head_x + torso_x) / 2.0, 4),
        "contactFoot": "left" if frame_index == 0 else "right" if frame_index == 2 else None,
        "footY": y1,
        "height": frame.height,
        "phase": frame_index / NFRAMES,
        "width": frame.width,
    }


def anchor_manifest(slug: str, dirs: dict[str, list[Image.Image]] | None = None) -> dict:
    if dirs is None:
        dirs = {
            direction: [Image.open(OUT_ROOT / slug / f"{direction}_{index}.png").convert("RGBA")
                        for index in range(NFRAMES)]
            for direction in ("down", "up", "left", "right")
        }
    frames = {
        f"{direction}_{index}": frame_anchor(dirs[direction][index], index)
        for direction in ("down", "up", "left", "right")
        for index in range(NFRAMES)
    }
    return {
        "anchorMethod": ANCHOR_METHOD,
        "cycleDistanceTiles": CYCLE_DISTANCE_TILES,
        "frameCount": NFRAMES,
        "frames": frames,
        "schemaVersion": 1,
        "slug": slug,
    }


def write_anchor_manifest(slug: str, dirs: dict[str, list[Image.Image]] | None = None) -> Path:
    out = OUT_ROOT / slug
    out.mkdir(parents=True, exist_ok=True)
    path = out / "manifest.json"
    payload = json.dumps(anchor_manifest(slug, dirs), sort_keys=True, separators=(",", ":")) + "\n"
    path.write_text(payload, encoding="utf-8")
    return path


def bake(slug: str, mirror_side: bool) -> bool:
    """Cached raw sheets -> sprites-walk/<slug>/{down,up,left,right}_{0..3}.png + anchors/review."""
    sheets = {v: CACHE / f"{slug}-{v}.png" for v in VIEWS}
    missing = [v for v, p in sheets.items() if not p.exists()]
    if missing:
        sys.stderr.write(f"[bake] {slug}: missing raw sheets {missing} — skip\n")
        return False
    maybe = {v: slice_sheet(p, f"{slug}/{v}") for v, p in sheets.items()}
    if any(f is None for f in maybe.values()):
        return False
    sliced: dict[str, list[Image.Image]] = {v: f for v, f in maybe.items() if f is not None}
    side = sliced["side"]
    if mirror_side:  # this character's side sheet came out walking LEFT
        side = [ImageOps.mirror(f) for f in side]
    dirs = {
        "down": sliced["down"],
        "up": sliced["up"],
        "right": side,                                  # raw side sheet walks RIGHT
        "left": [ImageOps.mirror(f) for f in side],
    }
    out = OUT_ROOT / slug
    out.mkdir(parents=True, exist_ok=True)
    for d, frames in dirs.items():
        for i, f in enumerate(frames):
            f.save(out / f"{d}_{i}.png")
    write_anchor_manifest(slug, dirs)
    review(slug, dirs)
    print(f"[ok] {slug}: 16 frames -> {out.relative_to(REPO)}")
    return True


def review(slug: str, dirs: dict[str, list[Image.Image]]) -> None:
    """4 rows (down/left/right/up) x 4 frames on a grey checker, for quick eyeballing."""
    order = ["down", "left", "right", "up"]
    cw = max(f.width for fr in dirs.values() for f in fr) + 8
    ch = OUT_H + 8
    sheet = Image.new("RGBA", (cw * NFRAMES, ch * len(order)), (70, 70, 70, 255))
    for y in range(0, sheet.height, 16):
        for x in range(0, sheet.width, 16):
            if (x // 16 + y // 16) % 2:
                sheet.paste((90, 90, 90, 255), (x, y, min(x + 16, sheet.width), min(y + 16, sheet.height)))
    for r, d in enumerate(order):
        for i, f in enumerate(dirs[d]):
            sheet.alpha_composite(f, (i * cw + (cw - f.width) // 2, r * ch + 4))
    CACHE.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(CACHE / f"{slug}-review.png")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated slugs")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--force", action="store_true", help="redo slugs that already have sprites-walk output")
    ap.add_argument("--gen", action="store_true", help="allow API generation for ALL selected slugs")
    ap.add_argument("--refresh", action="store_true", help="regenerate selected raw sheets even when cached")
    ap.add_argument("--provider", choices=["openai", "gemini"], default="gemini",
                    help="image provider (openai uses the latest configured GPT Image 2 snapshot)")
    ap.add_argument("--pipeline-only", action="store_true", help="never call the API; slice/bake cached sheets")
    ap.add_argument("--anchors-only", action="store_true", help="write manifests from existing accepted frames; never call an API")
    ap.add_argument("--workers", type=int, help="parallel calls (default: 1 OpenAI, 3 Gemini)")
    ap.add_argument("--mirror-side", default="", help="slugs whose side sheet walks LEFT (bake flipped)")
    ap.add_argument("--call-cap", type=int, default=PRODUCTION_CALL_CAP,
                    help="hard provider-call cap for this invocation, including retries")
    args = ap.parse_args()

    global _GENERATION_CALL_CAP
    if args.call_cap < 1:
        sys.stderr.write("--call-cap must be positive\n")
        return 2
    _GENERATION_CALL_CAP = min(args.call_cap, PRODUCTION_CALL_CAP)

    slugs = roster()
    if args.only:
        want = [s.strip() for s in args.only.split(",") if s.strip()]
        unknown = sorted(set(want) - set(slugs))
        if unknown:
            sys.stderr.write(f"unknown slugs: {unknown}\n")
            return 2
        slugs = want
    if args.limit:
        slugs = slugs[: args.limit]
    if args.anchors_only:
        failed = []
        for slug in slugs:
            try:
                path = write_anchor_manifest(slug)
                print(f"[anchors] {slug}: {path.relative_to(REPO)}")
            except (FileNotFoundError, ValueError, OSError) as exc:
                failed.append(slug)
                sys.stderr.write(f"[anchors] {slug}: {exc}\n")
        print(f"wrote anchors for {len(slugs) - len(failed)}/{len(slugs)} characters")
        return 0 if not failed else 1
    if not args.force:
        slugs = [s for s in slugs if not (OUT_ROOT / s / "down_0.png").exists()]
    if not slugs:
        print("nothing to do (all selected slugs already have sprites-walk output)")
        return 0
    mirror = {s.strip() for s in args.mirror_side.split(",") if s.strip()}

    if not args.pipeline_only:
        ic = discover_image_compass()
        if not ic:
            sys.stderr.write("image-compass not found (set IMAGE_COMPASS_DIR)\n")
            return 2
        required_key = "OPENAI_API_KEY" if args.provider == "openai" else "GEMINI_API_KEY"
        if not os.environ.get(required_key):
            sys.stderr.write(f"{required_key} not set\n")
            return 2
        jobs = [
            (s, v) for s in slugs for v in VIEWS
            if args.refresh or not (CACHE / f"{s}-{v}.png").exists()
        ]
        if len(jobs) > 3 and not (args.gen or args.only):
            sys.stderr.write(f"{len(jobs)} API calls needed — pass --gen (or --only) to confirm\n")
            return 2
        workers = args.workers or (1 if args.provider == "openai" else 3)
        print(f"generating {len(jobs)} sheets via {args.provider} ({workers} workers)…")
        with ThreadPoolExecutor(max_workers=workers) as ex:
            results = list(ex.map(lambda jv: ai_generate(jv[0], jv[1], ic, args.provider), jobs))
        failed_slugs = {slug for (slug, _view), result in zip(jobs, results) if result is None}
    else:
        failed_slugs = set()

    if failed_slugs:
        sys.stderr.write(f"generation incomplete; refusing mixed old/new bake for: {sorted(failed_slugs)}\n")
    bake_slugs = [slug for slug in slugs if slug not in failed_slugs]
    done = sum(bake(s, s in mirror) for s in bake_slugs)
    print(f"baked {done}/{len(slugs)} characters")
    return 0 if done == len(slugs) else 1


if __name__ == "__main__":
    sys.exit(main())
