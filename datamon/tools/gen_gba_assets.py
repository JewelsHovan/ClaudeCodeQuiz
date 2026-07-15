#!/usr/bin/env python3
"""Reproducible generator for DATAMON's GBA-style character assets (deep-think: datamon-gba-aesthetic).

Two assets per roster member, mirroring the gen_props.py recipe (AI generate -> deterministic
post-process -> committed PNG). Validated end-to-end in Phase 0 on veronica-marallag.

  - PORTRAIT  (datamon/portraits/<slug>.png): Fire-Emblem-style dialogue bust, ~80px tall.
              Model = Nano Banana 2 (best identity preservation). Magenta chroma-key bg.
  - OVERWORLD (datamon/sprites-gba/<slug>.png): chibi south-facing walker, ~48px tall.
              Model = gpt-image-1.5 (true transparent alpha — robust vs light-coloured clothing).

Pipeline per asset (steps 2-5 are DETERMINISTIC for a given raw input):
  1. AI generate via image-compass, passing the headshot (and, for overworld, the existing
     sprite) as --ref for identity/outfit. Raw cached to datamon/.gba-gen-cache/.
  2. Resolve background -> hard alpha: gpt transparent => kill faint halo; NB2 JPEG => chroma-key.
  3. Autocrop to the alpha bbox.
  4. Lanczos downscale to the target height; per-asset 16-colour quantize (dither NONE).
  5. Add a 1px dark outline (dilated-alpha mask); hard 1-bit alpha.

Reproducibility: AI generation is NON-DETERMINISTIC; committed PNGs are curated outputs of a run.
Re-running --gen produces visually-similar-but-not-identical art; steps 2-5 are deterministic.

Usage:
  # Re-run the deterministic pipeline on whatever raw art is already cached (no API):
  uv run --with pillow python datamon/tools/gen_gba_assets.py --pipeline-only

  # Generate a small validation set (a few diverse faces), portraits + overworld:
  uv run --with pillow python datamon/tools/gen_gba_assets.py --only tabarek-al-khalidi,scott-carr

  # Generate everything (58 calls — needs OPENAI_API_KEY + GEMINI_API_KEY):
  uv run --with pillow python datamon/tools/gen_gba_assets.py --gen

Flags: --only a,b  --limit N  --kind portrait|overworld|both  --force  --pipeline-only  --gen/--no-gen
Env:   OPENAI_API_KEY, GEMINI_API_KEY (for --gen); IMAGE_COMPASS_DIR (optional override).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
DATAMON = HERE.parent                     # ClaudeCodeQuiz/datamon
REPO = DATAMON.parent
HEADSHOTS = DATAMON / "headshots"
SPRITES = DATAMON / "sprites"
PORTRAITS_OUT = DATAMON / "portraits"
OVERWORLD_OUT = DATAMON / "sprites-gba"
CACHE = DATAMON / ".gba-gen-cache"

OUTLINE = (24, 16, 40, 255)               # near-black GBA outline (#181028)
MAGENTA = (255, 0, 255)                   # portrait chroma-key bg

# Asset class config -------------------------------------------------------
KINDS = {
    "portrait": {
        "model": "gemini",
        "out": PORTRAITS_OUT,
        "target_h": 80,
        "ncolors": 16,
        "refs": ["headshot"],
        "bg": "magenta",                  # NB2 returns opaque JPEG -> key this
        "prompt": (
            "Game Boy Advance / Fire Emblem style RPG dialogue PORTRAIT bust of the SAME person "
            "in the reference photo — preserve their face, hairstyle, skin tone and identity closely. "
            "Head-and-shoulders bust, facing slightly toward the viewer, calm confident expression. "
            "Flat cel shading with crisp tone bands, bold dark outline, limited retro palette, hard "
            "clean pixel edges, NO anti-aliasing, NO photographic gradients, NO realism — hand-drawn "
            "16-bit portrait art. Plain flat solid magenta (#ff00ff) background, no shadow."
        ),
    },
    "overworld": {
        "model": "gemini",
        "out": OVERWORLD_OUT,
        "target_h": 46,
        "ncolors": 16,
        "refs": ["headshot"],
        "bg": "magenta",
        "prompt": (
            "A single ADORABLE chibi overworld character sprite in the style of a cozy modern pixel-art RPG "
            "(Pokemon HeartGold NPC crossed with Stardew Valley cuteness). Very large ROUND head about 45 "
            "percent of total height; tiny rounded body about 1.5 heads tall; short stubby arms and legs; "
            "big simple friendly eyes; soft rounded silhouette. CLEAN minimal pixel art: one smooth bold "
            "dark outline, flat 2-3 tone cel shading, limited BRIGHT cheerful palette, NO anti-aliasing, "
            "NO noisy detail, NO photorealism, NO gradients. Based on the reference photo: same hair, same "
            "skin tone, same face, wearing a dark shirt with a small pop of color. Front-facing, standing, "
            "centered, full body. Plain solid flat magenta (#ff00ff) background, no shadow."
        ),
    },
}


def roster() -> list[str]:
    return sorted(p.stem for p in HEADSHOTS.glob("*.png"))


def discover_image_compass() -> Path | None:
    env = os.environ.get("IMAGE_COMPASS_DIR")
    cands = []
    if env:
        cands.append(Path(env))
    home = Path.home()
    cands += [
        home / "Desktop/Internals/claude-compass-superpowers/image-compass",
        REPO.parent / "claude-compass-superpowers/image-compass",
        REPO.parent / "image-compass",
    ]
    for c in cands:
        if (c / "scripts" / "generate_openai.py").exists():
            return c
    for hit in home.glob("**/image-compass/scripts/generate_openai.py"):
        return hit.parent.parent
    return None


def _refs_for(kind: str, slug: str) -> list[str]:
    out = []
    for r in KINDS[kind]["refs"]:
        p = (HEADSHOTS if r == "headshot" else SPRITES) / f"{slug}.png"
        if p.exists():
            out.append(str(p))
    return out


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


def ai_generate(kind: str, slug: str, ic_dir: Path) -> Path | None:
    """Generate one raw asset; copy into the raw cache; return the cached path."""
    cfg = KINDS[kind]
    refs = _refs_for(kind, slug)
    variant = f"gba-{kind}-{slug}"
    if cfg["model"] == "openai":
        gen = ic_dir / "scripts" / "generate_openai.py"
        cmd = ["uv", "run", "--script", str(gen), "--model", "gpt-image-1.5",
               "--prompt", cfg["prompt"], "--background", "transparent",
               "--size", "1024x1024", "--quality", "high", "--variant", variant, "--json"]
    else:
        gen = ic_dir / "scripts" / "generate_gemini.py"
        cmd = ["uv", "run", "--script", str(gen), "--model", "gemini-3.1-flash-image-preview",
               "--intent", "quality", "--resolution", "1K", "--aspect-ratio", "1:1",
               "--prompt", cfg["prompt"], "--variant", variant, "--json"]
    for r in refs:
        cmd += ["--ref", r]
    sys.stderr.write(f"[gen] {kind}/{slug}: {cfg['model']} refs={len(refs)}\n")
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        sys.stderr.write(f"[gen] {kind}/{slug}: TIMEOUT\n")
        return None
    if res.returncode != 0:
        sys.stderr.write(f"[gen] {kind}/{slug}: rc={res.returncode}\n{res.stderr[-800:]}\n")
        return None
    raw = _parse_paths(res.stdout)
    if not raw or not raw.exists():
        sys.stderr.write(f"[gen] {kind}/{slug}: no paths\n{res.stdout[-400:]}\n")
        return None
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / f"{slug}-{kind}.png"
    Image.open(raw).save(dest)
    return dest


# --- deterministic post-process ------------------------------------------
def _chroma_key(img: Image.Image, key_rgb, tol: int) -> Image.Image:
    """Key out a flat bg. For magenta (#ff00ff) use a robust hue test (JPEG shifts the
    exact value), else nearest-distance."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    kr, kg, kb = key_rgb
    magenta = tuple(key_rgb) == (255, 0, 255)
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            hit = (r > 150 and b > 150 and g < 120) if magenta else (abs(r - kr) + abs(g - kg) + abs(b - kb) < tol)
            if hit:
                px[x, y] = (r, g, b, 0)
    return img


def _keep_largest(img: Image.Image, thresh: int = 150) -> Image.Image:
    """Hard-threshold alpha then keep only the largest connected blob — removes the
    speckle/dotted-frame halo from AA edges or chroma-key residue. Pure-Pillow BFS;
    runs on the already-downscaled (small) sprite so it is fast."""
    from collections import deque
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    solid = [[px[x, y][3] >= thresh for x in range(w)] for y in range(h)]
    lab = [[0] * w for _ in range(h)]
    cur = 0
    sizes: dict[int, int] = {}
    for y in range(h):
        for x in range(w):
            if solid[y][x] and lab[y][x] == 0:
                cur += 1
                n = 0
                q = deque([(y, x)])
                lab[y][x] = cur
                while q:
                    cy, cx = q.popleft()
                    n += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and solid[ny][nx] and lab[ny][nx] == 0:
                            lab[ny][nx] = cur
                            q.append((ny, nx))
                sizes[cur] = n
    if sizes:
        keep = max(sizes, key=lambda k: sizes[k])
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 255 if lab[y][x] == keep else 0)
    return img


def _kill_faint(img: Image.Image, thresh: int = 90) -> Image.Image:
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


def _downscale(img: Image.Image, target_h: int) -> Image.Image:
    w, h = img.size
    tw = max(1, round(w * target_h / h))
    return img.resize((tw, target_h), Image.LANCZOS)


def _quantize_keepalpha(img: Image.Image, ncolors: int) -> Image.Image:
    img = img.convert("RGBA")
    alpha = img.getchannel("A")
    rgb_q = img.convert("RGB").quantize(colors=ncolors, dither=Image.Dither.NONE).convert("RGB")
    out = rgb_q.convert("RGBA")
    out.putalpha(alpha)
    return out


def _add_outline(img: Image.Image, color=OUTLINE) -> Image.Image:
    img = img.convert("RGBA")
    alpha = img.getchannel("A").point(lambda a: 255 if a > 0 else 0)
    dilated = alpha.filter(ImageFilter.MaxFilter(3))
    # outline ring = dilated AND NOT original
    out = img.copy()
    opx = out.load()
    rpx = dilated.load()
    bpx = alpha.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            if rpx[x, y] > 0 and bpx[x, y] == 0:
                opx[x, y] = color
    return out


def _hard_alpha(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a >= 128 else 0)
    return img


def postprocess(raw: Path, kind: str) -> Image.Image:
    cfg = KINDS[kind]
    img = Image.open(raw).convert("RGBA")
    if cfg["bg"] == "magenta":
        img = _chroma_key(img, MAGENTA, tol=140)
    else:  # transparent
        img = _kill_faint(img, thresh=90)
    img = _autocrop(img)
    img = _downscale(img, cfg["target_h"])
    img = _keep_largest(img, thresh=150)          # clean silhouette (no halo frame)
    img = _quantize_keepalpha(img, cfg["ncolors"])  # AI art already carries its own outline
    return img


def process_one(kind: str, slug: str, ic_dir: Path | None, do_gen: bool, force: bool) -> str:
    cfg = KINDS[kind]
    out_path = cfg["out"] / f"{slug}.png"
    raw = CACHE / f"{slug}-{kind}.png"
    if do_gen and (force or not raw.exists()):
        if ic_dir is None:
            return f"SKIP {kind}/{slug}: image-compass not found"
        got = ai_generate(kind, slug, ic_dir)
        if got is None:
            return f"FAIL {kind}/{slug}: generation failed"
        raw = got
    if not raw.exists():
        return f"MISS {kind}/{slug}: no raw art cached (run with --gen)"
    final = postprocess(raw, kind)
    cfg["out"].mkdir(parents=True, exist_ok=True)
    final.save(out_path)
    return f"OK   {kind}/{slug}: {final.size} -> {out_path.relative_to(REPO)}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated slugs")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--kind", choices=["portrait", "overworld", "both"], default="both")
    ap.add_argument("--force", action="store_true", help="regenerate even if raw cached")
    ap.add_argument("--pipeline-only", action="store_true", help="no API; re-run pipeline from cache")
    ap.add_argument("--gen", dest="gen", action="store_true", default=True)
    ap.add_argument("--no-gen", dest="gen", action="store_false")
    args = ap.parse_args()

    slugs = roster()
    if args.only:
        want = [s.strip() for s in args.only.split(",")]
        slugs = [s for s in slugs if s in want]
    if args.limit:
        slugs = slugs[: args.limit]
    kinds = ["portrait", "overworld"] if args.kind == "both" else [args.kind]
    do_gen = args.gen and not args.pipeline_only
    ic_dir = discover_image_compass() if do_gen else None
    if do_gen and ic_dir is None:
        sys.stderr.write("ERROR: image-compass not found; set IMAGE_COMPASS_DIR or use --pipeline-only.\n")
        return 2

    print(f"roster={len(slugs)} kinds={kinds} gen={do_gen} ic={ic_dir}")
    for slug in slugs:
        for kind in kinds:
            print(process_one(kind, slug, ic_dir, do_gen, args.force))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
