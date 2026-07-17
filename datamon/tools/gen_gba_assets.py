#!/usr/bin/env python3
"""Reproducible generator for DATAMON's GBA-style character assets (deep-think: datamon-gba-aesthetic).

Character assets for each roster member, mirroring the gen_props.py recipe (AI generate ->
deterministic post-process -> committed PNG). Validated end-to-end in Phase 0 on
veronica-marallag.

  - TRAINER   (datamon/sprites/<slug>.png): full-body battle/roster sprite on a 256px square.
              Model = Nano Banana 2. Magenta chroma-key background.
  - PORTRAIT  (datamon/portraits/<slug>.png): Fire-Emblem-style dialogue bust, 96px tall.
              Model = Nano Banana 2 (best identity preservation). Magenta chroma-key bg.
  - OVERWORLD (datamon/sprites-gba/<slug>.png): optional chibi south-facing walker, ~48px tall.
              Model = Nano Banana 2. Magenta chroma-key background.

Pipeline per asset (steps 2-5 are DETERMINISTIC for a given raw input):
  1. AI generate via image-compass, passing the local headshot as the identity reference.
     Raw output is cached under datamon/.gba-gen-cache/.
  2. Chroma-key the flat magenta background to hard alpha.
  3. Autocrop to the alpha bbox and keep the connected character silhouette.
  4. Fit trainers bottom-centre in a 256px square with nearest-neighbour resampling.
  5. Lanczos-downscale portraits/chibi art to their target height and quantize them to 16 colours.

Reproducibility: AI generation is NON-DETERMINISTIC; committed PNGs are curated outputs of a run.
Re-running --gen produces visually-similar-but-not-identical art; steps 2-5 are deterministic.

Usage:
  # Re-run the deterministic pipeline on whatever raw art is already cached (no API):
  uv run --with pillow python datamon/tools/gen_gba_assets.py --pipeline-only

  # Generate runtime trainers and flattering Fire Emblem portraits for new teammates:
  # BILLABLE: run only after an estimate and explicit approval.
  uv run --with pillow python datamon/tools/gen_gba_assets.py --gen --only slug-a,slug-b --kind runtime \
    --style-ref datamon/.design/refs/fire-emblem-portrait-style.png

  # Restyle every portrait from local identity + style references (review before keeping):
  uv run --with pillow python datamon/tools/gen_gba_assets.py --gen --kind portrait --force \
    --style-ref datamon/.design/refs/fire-emblem-portrait-style.png

  # Generate the optional small chibi assets instead:
  uv run --with pillow python datamon/tools/gen_gba_assets.py --gen --only slug-a,slug-b --kind overworld

Flags: --only a,b  --limit N  --kind trainer|portrait|overworld|runtime|all
       --style-ref PATH  --force  --pipeline-only  --gen/--no-gen
Env:   GEMINI_API_KEY (for --gen); IMAGE_COMPASS_DIR (optional override).
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
HEADSHOTS = DATAMON / ".headshots-offline"
SPRITES = DATAMON / "sprites"
PORTRAITS_OUT = DATAMON / "portraits"
OVERWORLD_OUT = DATAMON / "sprites-gba"
CACHE = DATAMON / ".gba-gen-cache"

OUTLINE = (24, 16, 40, 255)               # near-black GBA outline (#181028)
MAGENTA = (255, 0, 255)                   # portrait chroma-key bg

# Asset class config -------------------------------------------------------
KINDS = {
    "trainer": {
        "model": "gemini",
        "out": SPRITES,
        "target_size": 256,
        "square": True,
        "ncolors": None,
        "refs": ["headshot"],
        "bg": "magenta",
        "prompt": (
            "Create one production-ready full-body 2D pixel-art character sprite in the style "
            "of Game Boy Advance-era Pokemon trainer battle sprites. The character must clearly "
            "be the SAME person as the reference photo: preserve their face, hairstyle, hair "
            "colour, skin tone, facial hair, glasses, and smart-casual office clothing. Realistic "
            "adult body proportions, standing confidently and facing the viewer, with the full "
            "body visible from head to feet and centred. Chunky visible pixels, restrained colour "
            "palette, crisp tone bands, clean dark outline, no anti-aliasing, no photorealism. "
            "Entire background perfectly flat solid chroma magenta #ff00ff, including between the "
            "arms and legs. No transparency, shadow, scenery, text, border, frame, or extra person."
        ),
    },
    "portrait": {
        "model": "gemini",
        "out": PORTRAITS_OUT,
        "target_h": 96,
        "ncolors": 16,
        "refs": ["headshot"],
        "bg": "magenta",                  # NB2 returns opaque JPEG -> key this
        "prompt": (
            "Create ONE polished Game Boy Advance Fire Emblem support-conversation PORTRAIT. "
            "The FIRST reference is the identity photo: the result must be unmistakably the SAME "
            "person. Preserve their ethnicity, skin tone, face shape, hairstyle and hair colour, "
            "eyebrows, glasses, facial hair, and other distinguishing features. Make the likeness "
            "gently flattering and heroic — warm expression, elegant proportions, clear lively eyes — "
            "without changing who they are or making them look like a generic anime character. Keep "
            "their real smart-casual clothing cues rather than copying fantasy armour. The SECOND "
            "reference, when supplied, is STYLE ONLY: match its hand-authored GBA Fire Emblem pixel "
            "clusters, warm skin highlights, selective deep-plum outline, expressive three-quarter "
            "view, crisp stepped hair shapes, and restrained 16-colour cel-shaded palette. Draw a "
            "single near-square head-and-shoulders dialogue bust, head fully visible, shoulders filling "
            "the lower edge, facing slightly toward the viewer. No extra poses, sprite sheet, repeated "
            "face, text, border, scenery, shadow, or photorealism. Entire background must be perfectly "
            "flat solid chroma magenta #ff00ff, including every gap around hair and shoulders."
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


def _refs_for(kind: str, slug: str, style_ref: Path | None = None) -> list[str]:
    out = []
    for r in KINDS[kind]["refs"]:
        p = (HEADSHOTS if r == "headshot" else SPRITES) / f"{slug}.png"
        if p.exists():
            out.append(str(p))
    if kind == "portrait" and style_ref is not None:
        out.append(str(style_ref))
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


def ai_generate(kind: str, slug: str, ic_dir: Path, style_ref: Path | None = None) -> Path | None:
    """Generate one raw asset; copy into the raw cache; return the cached path."""
    cfg = KINDS[kind]
    refs = _refs_for(kind, slug, style_ref)
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


def _fit_square(img: Image.Image, size: int) -> Image.Image:
    """Fit a full-body sprite into a transparent square, anchored at bottom-centre."""
    w, h = img.size
    scale = min(size / max(1, w), size / max(1, h))
    fitted = img.resize(
        (max(1, round(w * scale)), max(1, round(h * scale))),
        Image.Resampling.NEAREST,
    )
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(fitted, ((size - fitted.width) // 2, size - fitted.height))
    return out


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
    if cfg.get("square"):
        img = _fit_square(img, cfg["target_size"])
    else:
        img = _downscale(img, cfg["target_h"])
    img = _keep_largest(img, thresh=150)          # clean silhouette (no halo frame)
    if cfg.get("ncolors"):
        img = _quantize_keepalpha(img, cfg["ncolors"])  # art already carries its own outline
    return img


def process_one(
    kind: str,
    slug: str,
    ic_dir: Path | None,
    do_gen: bool,
    force: bool,
    style_ref: Path | None = None,
) -> str:
    cfg = KINDS[kind]
    out_path = cfg["out"] / f"{slug}.png"
    raw = CACHE / f"{slug}-{kind}.png"
    if do_gen and (force or not raw.exists()):
        if ic_dir is None:
            return f"SKIP {kind}/{slug}: image-compass not found"
        got = ai_generate(kind, slug, ic_dir, style_ref)
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
    ap.add_argument(
        "--kind",
        choices=["trainer", "portrait", "overworld", "runtime", "both", "all"],
        default="both",
    )
    ap.add_argument("--force", action="store_true", help="regenerate even if raw cached")
    ap.add_argument("--style-ref", type=Path,
                    help="portrait-only visual style reference (identity remains the teammate headshot)")
    ap.add_argument("--pipeline-only", action="store_true", help="no API; re-run pipeline from cache")
    ap.add_argument("--gen", dest="gen", action="store_true", default=False,
                    help="explicitly enable external billable generation")
    ap.add_argument("--no-gen", dest="gen", action="store_false")
    args = ap.parse_args()

    slugs = roster()
    if args.only:
        want = [s.strip() for s in args.only.split(",")]
        slugs = [s for s in slugs if s in want]
    if args.limit:
        slugs = slugs[: args.limit]
    if args.kind == "runtime":
        kinds = ["trainer", "portrait"]
    elif args.kind == "both":  # backwards-compatible alias for the original two outputs
        kinds = ["portrait", "overworld"]
    elif args.kind == "all":
        kinds = ["trainer", "portrait", "overworld"]
    else:
        kinds = [args.kind]
    if args.style_ref is not None and not args.style_ref.is_file():
        sys.stderr.write(f"ERROR: style reference not found: {args.style_ref}\n")
        return 2
    do_gen = args.gen and not args.pipeline_only
    ic_dir = discover_image_compass() if do_gen else None
    if do_gen and ic_dir is None:
        sys.stderr.write("ERROR: image-compass not found; set IMAGE_COMPASS_DIR or omit --gen for cache-only processing.\n")
        return 2

    print(f"roster={len(slugs)} kinds={kinds} gen={do_gen} ic={ic_dir}")
    for slug in slugs:
        for kind in kinds:
            print(process_one(kind, slug, ic_dir, do_gen, args.force, args.style_ref))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
