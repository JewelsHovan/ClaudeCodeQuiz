#!/usr/bin/env python3
"""Reproducible generator for DATAMON's office prop cutouts (ticket #020, PRD 005).

Unlike the surface tiles (gen_office_tiles.py / gen_tiles.py — pure Pillow), props
are multi-tile objects too visually complex for primitives, so they are AI-generated
pixel-art cutouts photo-referenced from the real office, then deterministically
post-processed (downscale NEAREST + palette-quantize + hard-alpha cleanup) to a
grid-appropriate size and committed as transparent-background RGBA PNGs.

Pipeline per prop:
  1. AI generate via image-compass `generate_openai.py --background transparent`,
     passing the approved concept (datamon/.design/office-concept-topdown.png) as a
     --ref to every call for palette cohesion, plus the relevant real-office photo
     (datamon/.design/refs/*.png) where one applies.
  2. Open raw output RGBA, optional chroma-key (only if the bg came back opaque),
     autocrop to the alpha bbox.
  3. resize(target, NEAREST) -> exact tile-footprint pixel size (<=96px per side).
  4. quantize(64, FASTOCTREE) -> palette-cohesive with the #019 tile set.
  5. Hard-alpha cleanup: alpha<128 -> 0, else 255 (no semi-transparent halo).
     glass-wall keeps soft alpha (it is transparent glass by design).
  6. Save to datamon/props/<slug>.png.
After all props, build datamon/props/manifest.json: one entry per required slug,
with widthPx/heightPx/tileW/tileH/anchorX/anchorY. Any slug without a clean PNG
gets a {"missing": true} gap entry so child #021 can render a fallback box.

Reproducibility note: AI generation is NON-DETERMINISTIC. The committed PNGs in
datamon/props/ are the curated outputs of a run of this script. Re-running --gen
will produce visually-similar-but-not-identical props; the post-processing pipeline
(steps 2-6) IS deterministic for a given raw input. Each prop records which --ref
photo it used so the recipe is reproducible for anyone with the (gitignored) photos.

Usage:
  # Rebuild the manifest from whatever PNGs are already committed (deterministic, no API):
  uv run --with pillow python datamon/tools/gen_props.py --no-gen

  # (Re)generate specific props via the OpenAI image API (needs OPENAI_API_KEY):
  uv run --with pillow python datamon/tools/gen_props.py --only couch,fridge

  # (Re)generate everything:
  uv run --with pillow python datamon/tools/gen_props.py --gen

Env:
  OPENAI_API_KEY        required for --gen
  IMAGE_COMPASS_DIR     optional override for the image-compass checkout root
                        (default: auto-discovered near this repo)
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent                      # ClaudeCodeQuiz/
DATAMON = HERE.parent                          # datamon/
PROPS_DIR = DATAMON / "props"
DESIGN = DATAMON / ".design"
CONCEPT = DESIGN / "office-concept-topdown.png"
REFS = DESIGN / "refs"

# ---------------------------------------------------------------------------
# Required prop set (ticket #020 AC) -- slug -> generation + footprint spec.
#   target: (widthPx, heightPx) committed pixel size (<=96 per side).
#   tiles:  (tileW, tileH) footprint on the 32px grid.
#   photo:  real-office reference filename in datamon/.design/refs/ (or None).
#   keep_alpha: True only for glass (intentionally semi-transparent).
# Every prompt is prefixed with STYLE for top-down palette-cohesive pixel art.
# ---------------------------------------------------------------------------
STYLE = (
    "Top-down orthographic 2D pixel-art game asset for a cozy JRPG office overworld, "
    "viewed from above at a slight forward tilt to match the reference office scene. "
    "Warm industrial-loft palette: warm-orange hardwood, red and white exposed brick, "
    "dark steel, cream upholstery, silver ducting. Single object only, centered, "
    "fully transparent background, NO ground shadow, NO floor, crisp hard pixel edges, "
    "no anti-aliasing, limited palette. Object: "
)

PROPS = [
    # slug,            target,    tiles,  photo,                       prompt-tail
    ("couch",          (64, 32),  (2, 1), "office-lounge",            "a cream two-seater office lounge sofa, plump cushions, top-down."),
    ("kallax",         (64, 64),  (2, 2), "office-lounge",            "a white square cube bookshelf / Kallax shelving unit, 2x2 open cubes with a few books, top-down."),
    ("arc-lamp",       (32, 64),  (1, 2), None,                       "a black arc floor lamp with a curved chrome arm and dome shade over a round base, top-down."),
    ("tv",             (64, 32),  (2, 1), None,                       "a wide flat-screen wall TV in a thin black bezel showing a dark screen, top-down."),
    ("rug",            (96, 64),  (3, 2), None,                       "a rectangular area rug with horizontal cream-and-warm-brown stripes, top-down flat."),
    ("bar",            (96, 32),  (3, 1), "office-kitchen-bar",       "a long wooden kitchen bar counter with a chevron-pattern wood top, top-down."),
    ("stool",          (32, 32),  (1, 1), "office-kitchen-bar",       "a single black metal bar stool with a round seat, top-down."),
    ("fridge",         (32, 64),  (1, 2), "office-kitchen-bar",       "a tall black retro-style refrigerator with a chrome handle, top-down."),
    ("coffee-counter", (32, 32),  (1, 1), "office-kitchen-bar",       "a small white kitchen counter cabinet with a black coffee machine on top, top-down."),
    ("starry-painting",(64, 32),  (2, 1), None,                       "a framed pixel-art painting of Van Gogh's Starry Night in a thin dark frame, hung flat, top-down."),
    ("compass-sign",   (64, 32),  (2, 1), None,                       "a dark rectangular wall sign reading 'COMPASS' in clean white letters, top-down."),
    ("radiator",       (32, 32),  (1, 1), "office-brick-radiator",    "a grey cast-iron vertical-slat radiator, top-down."),
    ("glass-wall",     (32, 96),  (1, 3), None,                       "a tall glass meeting-room wall segment: only thin dark steel frame mullions, the glass area fully transparent, top-down."),
    ("desk",           (64, 32),  (2, 1), "office-open-floor",        "a wooden office desk with a thin top and a small monitor, top-down."),
    ("office-chair",   (32, 32),  (1, 1), "office-open-floor",        "a single white office swivel chair with armrests, top-down."),
]

REQUIRED_SLUGS = {p[0] for p in PROPS}
SPEC = {p[0]: {"target": p[1], "tiles": p[2], "photo": p[3], "prompt": STYLE + p[4],
               "keep_alpha": (p[0] == "glass-wall")} for p in PROPS}


def discover_image_compass() -> Path | None:
    """Locate the image-compass checkout (holds the generator scripts)."""
    env = os.environ.get("IMAGE_COMPASS_DIR")
    cands = []
    if env:
        cands.append(Path(env))
    # Common sibling / Desktop locations relative to this machine.
    home = Path.home()
    cands += [
        home / "Desktop/Internals/claude-compass-superpowers/image-compass",
        REPO.parent / "claude-compass-superpowers/image-compass",
        REPO.parent / "image-compass",
    ]
    for c in cands:
        if (c / "scripts" / "generate_openai.py").exists():
            return c
    # Last resort: shallow glob under home.
    for hit in home.glob("**/image-compass/scripts/generate_openai.py"):
        return hit.parent.parent
    return None


def gen_size_for(target: tuple[int, int]) -> str:
    """Pick the closest gpt-image canvas to the target aspect."""
    w, h = target
    if w > h:
        return "1536x1024"
    if h > w:
        return "1024x1536"
    return "1024x1024"


def ai_generate(slug: str, ic_dir: Path) -> Path | None:
    """Call generate_openai.py for one prop; return the raw PNG path or None."""
    spec = SPEC[slug]
    gen = ic_dir / "scripts" / "generate_openai.py"
    refs: list[str] = []
    if CONCEPT.exists():
        refs.append(str(CONCEPT))
    if spec["photo"]:
        photo = REFS / f"{spec['photo']}.png"
        if photo.exists():
            refs.append(str(photo))
    cmd = ["uv", "run", "--script", str(gen),
           "--prompt", spec["prompt"],
           "--background", "transparent",
           "--size", gen_size_for(spec["target"]),
           "--quality", "high",
           "--variant", f"prop-{slug}",
           "--json"]
    for r in refs:
        cmd += ["--ref", r]
    sys.stderr.write(f"[gen] {slug}: {gen_size_for(spec['target'])} refs={len(refs)}\n")
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        sys.stderr.write(f"[gen] {slug}: TIMEOUT\n")
        return None
    if res.returncode != 0:
        sys.stderr.write(f"[gen] {slug}: rc={res.returncode}\n{res.stderr[-800:]}\n")
        return None
    # Find the JSON {"paths":[...]} line in stdout.
    for line in reversed(res.stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith("{") and "paths" in line:
            try:
                paths = json.loads(line).get("paths", [])
            except json.JSONDecodeError:
                continue
            if paths:
                return Path(paths[0])
    sys.stderr.write(f"[gen] {slug}: no paths in stdout\n{res.stdout[-400:]}\n")
    return None


# ---------------------------------------------------------------------------
# Deterministic post-processing (steps 2-6).
# ---------------------------------------------------------------------------
def _maybe_chroma_key(img: Image.Image) -> Image.Image:
    """If the bg came back opaque (transparency failed), key out a near-uniform
    light corner background. Conservative: only fires when >60% of border pixels
    are opaque AND near-white/near-grey."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    border = []
    for x in range(w):
        border += [px[x, 0], px[x, h - 1]]
    for y in range(h):
        border += [px[0, y], px[w - 1, y]]
    opaque_light = [p for p in border if p[3] > 200 and min(p[0], p[1], p[2]) > 180]
    if len(opaque_light) < 0.6 * len(border):
        return img  # transparency already present -> leave alone
    # Key out near-white/light-grey opaque pixels.
    bg = opaque_light[len(opaque_light) // 2]
    out = img.copy()
    opx = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = opx[x, y]
            if a > 200 and abs(r - bg[0]) < 28 and abs(g - bg[1]) < 28 and abs(b - bg[2]) < 28:
                opx[x, y] = (r, g, b, 0)
    return out


def _kill_faint(img: Image.Image, thresh: int = 90) -> Image.Image:
    """Zero faint alpha (soft drop-shadow / halo) at full res so the subsequent
    autocrop trims to the actual solid object, not the fringe."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < thresh:
                px[x, y] = (r, g, b, 0)
    return img


def _autocrop(img: Image.Image) -> Image.Image:
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def _hard_alpha(img: Image.Image, keep_alpha: bool) -> Image.Image:
    """Remove semi-transparent fringe. Hard threshold unless keep_alpha (glass)."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if keep_alpha:
                if a < 40:
                    px[x, y] = (r, g, b, 0)        # kill faint fringe only
            else:
                px[x, y] = (r, g, b, 255 if a >= 128 else 0)
    return img


def postprocess(raw: Path, slug: str) -> Image.Image:
    spec = SPEC[slug]
    img = Image.open(raw).convert("RGBA")
    img = _maybe_chroma_key(img)
    # Kill faint halo/shadow at full res BEFORE autocrop so the object fills its
    # footprint (glass keeps soft alpha -> only a low fringe threshold).
    img = _kill_faint(img, thresh=25 if spec["keep_alpha"] else 90)
    img = _autocrop(img)
    img = img.resize(spec["target"], Image.NEAREST)
    # Palette-quantize the RGB while preserving the (already-resized) alpha.
    alpha = img.getchannel("A")
    rgb_q = img.convert("RGB").quantize(colors=64, method=Image.Quantize.FASTOCTREE).convert("RGB")
    img = rgb_q.convert("RGBA")
    img.putalpha(alpha)
    img = _hard_alpha(img, spec["keep_alpha"])
    return img


# ---------------------------------------------------------------------------
# Manifest.
# ---------------------------------------------------------------------------
def build_manifest() -> list[dict]:
    entries = []
    for slug, target, tiles, *_ in PROPS:
        png = PROPS_DIR / f"{slug}.png"
        if not png.exists():
            entries.append({"slug": slug, "file": f"{slug}.png", "missing": True})
            continue
        with Image.open(png) as im:
            w, h = im.size
        entries.append({
            "slug": slug,
            "file": f"{slug}.png",
            "widthPx": w,
            "heightPx": h,
            "tileW": math.ceil(w / 32),
            "tileH": math.ceil(h / 32),
            "anchorX": 0,
            "anchorY": max(0, h - 32),   # feet at the bottom tile row
        })
    return entries


def write_manifest(entries: list[dict]) -> None:
    PROPS_DIR.mkdir(parents=True, exist_ok=True)
    (PROPS_DIR / "manifest.json").write_text(json.dumps(entries, indent=2) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate DATAMON office prop cutouts + manifest.")
    ap.add_argument("--gen", action="store_true", help="(re)generate via the OpenAI image API")
    ap.add_argument("--no-gen", action="store_true", help="skip generation; rebuild manifest from existing PNGs")
    ap.add_argument("--only", default="", help="comma-separated slugs to (re)generate")
    args = ap.parse_args()

    PROPS_DIR.mkdir(parents=True, exist_ok=True)
    do_gen = args.gen or bool(args.only)
    if args.no_gen:
        do_gen = False

    if do_gen:
        ic = discover_image_compass()
        if not ic:
            sys.stderr.write("ERROR: image-compass not found; set IMAGE_COMPASS_DIR.\n")
            return 2
        only = {s.strip() for s in args.only.split(",") if s.strip()} or REQUIRED_SLUGS
        for slug in [p[0] for p in PROPS if p[0] in only]:
            raw = ai_generate(slug, ic)
            if not raw or not raw.exists():
                sys.stderr.write(f"[skip] {slug}: generation failed -> will be a gap entry\n")
                continue
            out = postprocess(raw, slug)
            out.save(PROPS_DIR / f"{slug}.png")
            sys.stderr.write(f"[ok]  {slug}: {out.size[0]}x{out.size[1]} saved\n")

    entries = build_manifest()
    write_manifest(entries)
    present = sum(1 for e in entries if not e.get("missing"))
    sys.stderr.write(f"[manifest] {present}/{len(entries)} props present, "
                     f"{len(entries) - present} gap entries\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
