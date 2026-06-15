#!/usr/bin/env python3
"""Generator for DATAMON's library pixel-art assets (ticket #025, PRD 006, ticket C).

The library map (#026), reader (#027) and diagram-assembly minigame (#030) all need
pixel-art assets that don't exist in datamon/tiles/ or datamon/props/:
  * library surface tiles  — bookshelf, library floor variants, library wall, rug
  * per-domain book covers  — 5 colour-coded standing book sprites
  * per-concept diagram sprites — schematic tiles used inline and as assembly pieces

Two asset classes, two generation paths (mirrors the office tiles vs props split):

  Deterministic (Pillow, fixed RNG seed)
    Surface tiles are pure primitives — guaranteed 32px-aligned, transparent where
    appropriate, no anti-aliasing, byte-identical on every rerun. They are ALWAYS
    (re)drawn by this tool; cheap and reproducible, safe to overwrite.

  AI-generated, opt-in (--gen, needs OPENAI_API_KEY + image-compass)
    Book covers and diagram sprites can be AI-generated then deterministically
    post-processed (crop -> resize NEAREST -> quantize 32 -> RGBA -> hard-alpha 128)
    exactly like datamon/tools/gen_props.py. Committed AI outputs are stable in git.
    Without --gen, each cover/diagram falls back to a deterministic Pillow placeholder
    (drawn only when the PNG is missing, so committed AI art is never clobbered).

Every asset has a drawn fallback, so `--no-gen` produces a complete, valid asset set
(>=11 deterministic files) with NO API key, and `--validate` exits 0.

Manifest (datamon/library/assets/manifest.json) follows the EXACT schema of
datamon/props/manifest.json: {slug, file, widthPx, heightPx, tileW, tileH,
anchorX, anchorY}, sorted by slug for a deterministic git diff. The game loads these
with its existing loadOne/blitTile pattern; a missing PNG yields tileStore[slug]=null
and blitTile()=false, triggering the game's drawn-box fallback (no code needed here).

Usage:
  # Deterministic-only (no API). Creates every asset + manifest:
  uv run --with pillow python datamon/tools/gen_library_assets.py --no-gen

  # Verify the committed asset set against the manifest:
  uv run --with pillow python datamon/tools/gen_library_assets.py --validate

  # (Re)generate covers + diagram sprites via the OpenAI image API:
  uv run --with pillow python datamon/tools/gen_library_assets.py --gen
  uv run --with pillow python datamon/tools/gen_library_assets.py --only book-domain1,lib-diagram-mcp-deep-dive-1

Env:
  OPENAI_API_KEY        required for --gen / --only
  IMAGE_COMPASS_DIR     optional override for the image-compass checkout root
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent                       # ClaudeCodeQuiz/
DATAMON = HERE.parent                           # datamon/
ASSETS_DIR = DATAMON / "library" / "assets"
DIAGRAMS_JSON = DATAMON / "library" / "diagrams.json"  # canonical diagram-slug source (gen_library.py)
DESIGN = DATAMON / ".design"
CONCEPT = DESIGN / "office-concept-topdown.png"

SEED = 20260614                                 # fixed -> reproducible speckle/spines
CLEAR = (0, 0, 0, 0)

# --- Library palette (RGBA) -----------------------------------------------
# Cooler / darker than the warm office "Claude lab" set, so the library reads as a
# distinct space: dark stained wood, cool stone, deep carpet, aged parchment.
WOOD_DK   = (62, 40, 24, 255)     # bookshelf frame shadow
WOOD      = (96, 62, 34, 255)     # bookshelf frame
WOOD_LT   = (132, 90, 52, 255)    # bookshelf frame highlight
SHELF     = (44, 28, 16, 255)     # recessed shelf interior
STONE     = (150, 150, 158, 255)  # library floor base (cool grey stone)
STONE_DK  = (120, 120, 130, 255)  # grout / variant
STONE_LT  = (176, 176, 184, 255)  # stone highlight
SLATE     = (96, 100, 112, 255)   # darker stone variant
SLATE_DK  = (74, 78, 90, 255)
CARPET    = (78, 38, 44, 255)     # deep red reading-room carpet
CARPET_LT = (104, 52, 58, 255)
BRICK     = (66, 70, 84, 255)     # dark stone-brick wall (distinct from office brick)
BRICK_DK  = (46, 50, 62, 255)
BRICK_LT  = (88, 92, 108, 255)
RUG_GOLD  = (176, 138, 70, 255)   # reading rug accent
RUG_NAVY  = (44, 52, 86, 255)
PARCH     = (224, 208, 168, 255)  # diagram parchment background
PARCH_DK  = (198, 180, 140, 255)
INK       = (52, 40, 28, 255)     # diagram ink
PAGE      = (238, 228, 204, 255)  # book page edge

# Domain colour coding (book covers + diagram accents), domain1..domain5.
DOMAIN_COLORS = {
    "domain1": (58, 96, 168, 255),    # blue
    "domain2": (40, 142, 140, 255),   # teal
    "domain3": (118, 74, 158, 255),   # purple
    "domain4": (206, 150, 54, 255),   # amber
    "domain5": (74, 142, 78, 255),    # green
}


def _new(w: int, h: int) -> Image.Image:
    return Image.new("RGBA", (w, h), CLEAR)


def _fill(img, color):
    ImageDraw.Draw(img).rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], fill=color)


def _shade(c, d):
    """Lighten (d>0) / darken (d<0) an RGBA colour, clamped."""
    return tuple(max(0, min(255, c[i] + d)) for i in range(3)) + (c[3],)


# ---------------------------------------------------------------------------
# Deterministic surface tiles (Pillow primitives).
# ---------------------------------------------------------------------------
def lib_floor_a() -> Image.Image:
    """Cool grey stone-tile floor, tileable on all edges."""
    img = _new(32, 32)
    _fill(img, STONE)
    d = ImageDraw.Draw(img)
    # grout seams (cross at edges so it tiles seamlessly)
    for v in (0, 16):
        d.line([0, v, 31, v], fill=STONE_DK)
        d.line([v, 0, v, 31], fill=STONE_DK)
    # subtle corner highlight on each sub-tile
    for ox in (1, 17):
        for oy in (1, 17):
            d.point((ox, oy), fill=STONE_LT)
    return img


def lib_floor_b() -> Image.Image:
    """Deep-red reading-room carpet weave, tileable."""
    img = _new(32, 32)
    _fill(img, CARPET)
    d = ImageDraw.Draw(img)
    rng = random.Random(SEED + 1)
    # woven cross-hatch
    for y in range(0, 32, 4):
        d.line([0, y, 31, y], fill=CARPET_LT)
    for _ in range(40):
        x = rng.randrange(32)
        y = rng.randrange(32)
        d.point((x, y), fill=_shade(CARPET, -18))
    return img


def lib_floor_c() -> Image.Image:
    """Darker slate stone variant for aisle accents, tileable."""
    img = _new(32, 32)
    _fill(img, SLATE)
    d = ImageDraw.Draw(img)
    for v in (0, 16):
        d.line([0, v, 31, v], fill=SLATE_DK)
        d.line([v, 0, v, 31], fill=SLATE_DK)
    rng = random.Random(SEED + 2)
    for _ in range(20):
        d.point((rng.randrange(32), rng.randrange(32)), fill=_shade(SLATE, 14))
    return img


def lib_wall() -> Image.Image:
    """Dark stone-brick wall, distinct from office brick-red/brick-white."""
    img = _new(32, 32)
    _fill(img, BRICK)
    d = ImageDraw.Draw(img)
    # brick courses
    for y in range(0, 32, 8):
        d.line([0, y, 31, y], fill=BRICK_DK)
    # staggered vertical mortar
    for y in range(0, 32, 16):
        d.line([8, y, 8, y + 7], fill=BRICK_DK)
        d.line([24, y, 24, y + 7], fill=BRICK_DK)
    for y in range(8, 32, 16):
        d.line([16, y, 16, y + 7], fill=BRICK_DK)
    # lit top edge
    d.line([0, 0, 31, 0], fill=BRICK_LT)
    return img


def lib_rug() -> Image.Image:
    """Patterned reading-nook rug — navy field, gold border + centre diamond."""
    img = _new(32, 32)
    _fill(img, RUG_NAVY)
    d = ImageDraw.Draw(img)
    # gold double border
    d.rectangle([0, 0, 31, 31], outline=RUG_GOLD)
    d.rectangle([2, 2, 29, 29], outline=RUG_GOLD)
    # centre diamond motif
    cx, cy = 16, 16
    for i in range(6):
        d.point((cx + i, cy - i), fill=RUG_GOLD)
        d.point((cx - i, cy + i), fill=RUG_GOLD)
        d.point((cx + i, cy + i), fill=RUG_GOLD)
        d.point((cx - i, cy - i), fill=RUG_GOLD)
    return img


def bookshelf() -> Image.Image:
    """32x96 (1 wide x 3 tall) dark-wood bookshelf with 3 rows of coloured spines."""
    img = _new(32, 96)
    d = ImageDraw.Draw(img)
    # outer wooden carcass (1px transparent margin on the sides)
    d.rectangle([1, 0, 30, 95], fill=WOOD)
    d.rectangle([1, 0, 30, 1], fill=WOOD_LT)        # lit top
    d.rectangle([1, 94, 30, 95], fill=WOOD_DK)      # base shadow
    d.line([1, 0, 1, 95], fill=WOOD_LT)             # lit left edge
    d.line([30, 0, 30, 95], fill=WOOD_DK)           # shadow right edge
    rng = random.Random(SEED + 10)
    spine_palette = [
        (170, 64, 58, 255), (58, 96, 168, 255), (74, 142, 78, 255),
        (206, 150, 54, 255), (118, 74, 158, 255), (40, 142, 140, 255),
        (196, 120, 60, 255), (210, 200, 180, 255),
    ]
    # three shelves at y = 4..30, 34..60, 64..90
    for row in range(3):
        top = 4 + row * 30
        bot = top + 26
        # recessed shelf interior
        d.rectangle([4, top, 27, bot], fill=SHELF)
        # row of book spines, deterministic widths/colours/heights
        x = 5
        while x < 27:
            w = rng.choice([2, 3, 3, 4])
            if x + w > 27:
                break
            h = rng.choice([20, 22, 24, 26])
            col = spine_palette[rng.randrange(len(spine_palette))]
            sb = bot - 1
            st = sb - h
            d.rectangle([x, st, x + w - 1, sb], fill=col)
            d.line([x, st, x + w - 1, st], fill=_shade(col, 28))   # lit cap
            x += w + 1
        # shelf board under the books
        d.line([4, bot, 27, bot], fill=WOOD_DK)
    return img


# ---------------------------------------------------------------------------
# Deterministic fallback art for the AI-eligible assets.
# ---------------------------------------------------------------------------
def book_cover_fallback(domain: str) -> Image.Image:
    """32x48 standing book, colour-coded by domain, with spine + title band."""
    base = DOMAIN_COLORS[domain]
    img = _new(32, 48)
    d = ImageDraw.Draw(img)
    # page block peeking on the right
    d.rectangle([6, 3, 28, 45], fill=PAGE)
    # cover
    d.rectangle([4, 2, 26, 46], fill=base)
    d.rectangle([4, 2, 26, 3], fill=_shade(base, 34))     # lit top
    d.rectangle([4, 45, 26, 46], fill=_shade(base, -34))  # bottom shadow
    # spine
    d.rectangle([4, 2, 7, 46], fill=_shade(base, -46))
    # gold title band + emboss line
    d.rectangle([10, 10, 24, 15], fill=RUG_GOLD)
    d.line([10, 22, 24, 22], fill=_shade(base, 40))
    d.line([10, 26, 22, 26], fill=_shade(base, 40))
    # domain index pips (1..5) bottom-right
    n = int(domain[-1])
    for i in range(n):
        d.rectangle([10 + i * 3, 38, 11 + i * 3, 40], fill=RUG_GOLD)
    return img


def diagram_fallback(domain: int) -> Image.Image:
    """64x64 schematic on parchment: domain-coloured boxes joined by ink arrows.

    `domain` is the int from diagrams.json (0 for reference docs like the cheat
    sheet). Any value outside 1..5 clamps to domain1 (blue) — only domain1..5
    colours exist, and the fallback is just a placeholder until AI art lands.
    """
    n = domain if 1 <= domain <= 5 else 1
    accent = DOMAIN_COLORS[f"domain{n}"]
    img = _new(64, 64)
    d = ImageDraw.Draw(img)
    # parchment card with a thin ink frame
    d.rectangle([1, 1, 62, 62], fill=PARCH)
    d.rectangle([1, 1, 62, 62], outline=INK)
    d.rectangle([2, 2, 62, 3], fill=PAGE)                 # lit top sliver
    # three nodes (top, mid-left, mid-right) wired in a little flow
    boxes = [(24, 8, 40, 20), (8, 36, 24, 50), (40, 36, 56, 50)]
    for (x0, y0, x1, y1) in boxes:
        d.rectangle([x0, y0, x1, y1], fill=accent, outline=INK)
        d.line([x0 + 1, y0 + 1, x1 - 1, y0 + 1], fill=_shade(accent, 36))
    # connectors
    d.line([32, 20, 16, 36], fill=INK)
    d.line([32, 20, 48, 36], fill=INK)
    # arrowheads
    for (ax, ay) in ((16, 36), (48, 36)):
        d.line([ax - 2, ay - 3, ax, ay], fill=INK)
        d.line([ax + 2, ay - 3, ax, ay], fill=INK)
    # baseline divider + index dots (n already clamped to 1..5 above)
    d.line([6, 56, 58, 56], fill=PARCH_DK)
    for i in range(n):
        d.rectangle([8 + i * 4, 58, 10 + i * 4, 60], fill=accent)
    return img


# ---------------------------------------------------------------------------
# Diagram-slug source of truth.
# ---------------------------------------------------------------------------
# Ink-colour word per domain for the AI prompt-tail (mirrors DOMAIN_COLORS).
_INK_WORD = {1: "blue", 2: "teal", 3: "purple", 4: "amber", 5: "green"}


def load_diagram_specs() -> list[tuple[str, int]]:
    """Return (slug, domain) for every diagram in diagrams.json — the canonical
    source shared byte-for-byte with the books.json diagram_anchor pages.

    Diagram sprites are derived from this list (gap-closure #031) so their slugs
    ALWAYS match what the in-game reader looks up; a hardcoded list drifts the
    instant docs change. Returns [] if diagrams.json is absent or unparseable —
    the caller (deterministic-only path) then simply produces no diagram sprites
    and the reader keeps its ASCII fallback (no regression).
    """
    if not DIAGRAMS_JSON.exists():
        return []
    try:
        data = json.loads(DIAGRAMS_JSON.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    specs: list[tuple[str, int]] = []
    seen: set[str] = set()
    for d in data:
        slug = d.get("slug")
        if isinstance(slug, str) and slug and slug not in seen:
            dom = d.get("domain", 0)
            specs.append((slug, dom if isinstance(dom, int) else 0))
            seen.add(slug)
    return specs


# ---------------------------------------------------------------------------
# Asset registry.  kind: "tile" (always Pillow) | "ai" (AI-eligible w/ fallback).
# prompt-tail used only by the --gen path.
# ---------------------------------------------------------------------------
ASSETS = [
    # slug,                kind,   draw fn,                         ai prompt-tail
    ("bookshelf",          "tile", bookshelf,                       None),
    ("lib-floor-a",        "tile", lib_floor_a,                     None),
    ("lib-floor-b",        "tile", lib_floor_b,                     None),
    ("lib-floor-c",        "tile", lib_floor_c,                     None),
    ("lib-wall",           "tile", lib_wall,                        None),
    ("lib-rug",            "tile", lib_rug,                         None),
    ("book-domain1",       "ai", lambda: book_cover_fallback("domain1"), "a closed hardcover book standing upright, deep blue cover with a gold title band, top-down."),
    ("book-domain2",       "ai", lambda: book_cover_fallback("domain2"), "a closed hardcover book standing upright, teal cover with a gold title band, top-down."),
    ("book-domain3",       "ai", lambda: book_cover_fallback("domain3"), "a closed hardcover book standing upright, purple cover with a gold title band, top-down."),
    ("book-domain4",       "ai", lambda: book_cover_fallback("domain4"), "a closed hardcover book standing upright, amber cover with a gold title band, top-down."),
    ("book-domain5",       "ai", lambda: book_cover_fallback("domain5"), "a closed hardcover book standing upright, green cover with a gold title band, top-down."),
]

# Diagram sprites: one per diagrams.json slug, so the manifest always covers every
# books.json diagram_anchor (gap-closure #031). The lambda binds `dom` as a default
# arg to capture the per-iteration value (classic loop-closure pitfall otherwise).
for _slug, _domain in load_diagram_specs():
    _ink = _INK_WORD.get(_domain if 1 <= _domain <= 5 else 1)
    ASSETS.append((
        _slug,
        "ai",
        (lambda dom=_domain: diagram_fallback(dom)),
        f"a tiny schematic diagram of connected boxes and arrows in {_ink} ink on parchment, top-down flat.",
    ))

DRAW = {a[0]: a[2] for a in ASSETS}
KIND = {a[0]: a[1] for a in ASSETS}
PROMPT_TAIL = {a[0]: a[3] for a in ASSETS}
AI_SLUGS = {a[0] for a in ASSETS if a[1] == "ai"}
ALL_SLUGS = [a[0] for a in ASSETS]

STYLE = (
    "Top-down orthographic 2D pixel-art game asset for a cozy JRPG library, viewed from "
    "above. Cool muted palette: dark stained wood, cool grey stone, deep-red carpet, aged "
    "parchment, gold accents. Single object only, centered, fully transparent background, "
    "NO ground shadow, NO floor, crisp hard pixel edges, no anti-aliasing, limited palette. "
    "Object: "
)


# ---------------------------------------------------------------------------
# AI generation + deterministic post-processing (mirrors gen_props.py).
# ---------------------------------------------------------------------------
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


def _gen_size_for(w: int, h: int) -> str:
    if w > h:
        return "1536x1024"
    if h > w:
        return "1024x1536"
    return "1024x1024"


def ai_generate(slug: str, target: tuple[int, int], ic_dir: Path) -> Path | None:
    gen = ic_dir / "scripts" / "generate_openai.py"
    refs = [str(CONCEPT)] if CONCEPT.exists() else []
    cmd = ["uv", "run", "--script", str(gen),
           "--prompt", STYLE + PROMPT_TAIL[slug],
           "--background", "transparent",
           "--size", _gen_size_for(*target),
           "--quality", "high",
           "--variant", f"lib-{slug}",
           "--json"]
    for r in refs:
        cmd += ["--ref", r]
    sys.stderr.write(f"[gen] {slug}: {_gen_size_for(*target)} refs={len(refs)}\n")
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        sys.stderr.write(f"[gen] {slug}: TIMEOUT\n")
        return None
    if res.returncode != 0:
        sys.stderr.write(f"[gen] {slug}: rc={res.returncode}\n{res.stderr[-800:]}\n")
        return None
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


def _autocrop(img: Image.Image) -> Image.Image:
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


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


def _hard_alpha(img: Image.Image) -> Image.Image:
    """Hard threshold at 128 -> every pixel ends 0 or 255 alpha (no fringe)."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a >= 128 else 0)
    return img


def postprocess(raw: Path, target: tuple[int, int]) -> Image.Image:
    img = Image.open(raw).convert("RGBA")
    img = _kill_faint(img, thresh=90)
    img = _autocrop(img)
    img = img.resize(target, Image.NEAREST)
    alpha = img.getchannel("A")
    rgb_q = img.convert("RGB").quantize(colors=32, method=Image.Quantize.FASTOCTREE).convert("RGB")
    img = rgb_q.convert("RGBA")
    img.putalpha(alpha)
    img = _hard_alpha(img)
    return img


# ---------------------------------------------------------------------------
# Manifest.
# ---------------------------------------------------------------------------
def build_manifest() -> list[dict]:
    entries = []
    for slug in ALL_SLUGS:
        png = ASSETS_DIR / f"{slug}.png"
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
            "anchorY": max(0, h - 32),   # base at the bottom tile row (matches props)
        })
    return entries


def write_manifest(entries: list[dict]) -> None:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    ordered = sorted(entries, key=lambda m: m["slug"])
    (ASSETS_DIR / "manifest.json").write_text(json.dumps(ordered, indent=2) + "\n")


# ---------------------------------------------------------------------------
# Validation.
# ---------------------------------------------------------------------------
def validate() -> int:
    mf = ASSETS_DIR / "manifest.json"
    if not mf.exists():
        sys.stderr.write(f"[validate] FAIL: {mf} does not exist\n")
        return 1
    try:
        entries = json.loads(mf.read_text())
    except json.JSONDecodeError as e:
        sys.stderr.write(f"[validate] FAIL: manifest is not valid JSON: {e}\n")
        return 1
    schema = {"slug", "file", "widthPx", "heightPx", "tileW", "tileH", "anchorX", "anchorY"}
    errors = 0
    for e in entries:
        slug = e.get("slug", "?")
        missing_keys = schema - set(e.keys())
        if missing_keys:
            sys.stderr.write(f"[validate] {slug}: missing keys {sorted(missing_keys)}\n")
            errors += 1
            continue
        png = ASSETS_DIR / e["file"]
        if not png.exists():
            sys.stderr.write(f"[validate] {slug}: PNG missing at {png}\n")
            errors += 1
            continue
        with Image.open(png) as im:
            w, h = im.size
            mode = im.mode
        if mode != "RGBA":
            sys.stderr.write(f"[validate] {slug}: mode {mode}, expected RGBA\n")
            errors += 1
        # 32px tile grid: width fills whole columns (mult of 32); height aligns to
        # the grid in half-tile (16px) steps — covers the spec's 32x48 book covers
        # (tileH=2) as well as the 32/64/96-tall tiles. See gen_props.py footprints.
        if w % 32 or h % 16:
            sys.stderr.write(f"[validate] {slug}: {w}x{h} not 32px grid-aligned "
                             f"(need width%32==0, height%16==0)\n")
            errors += 1
        if (w, h) != (e["widthPx"], e["heightPx"]):
            sys.stderr.write(f"[validate] {slug}: PNG {w}x{h} != manifest "
                             f"{e['widthPx']}x{e['heightPx']}\n")
            errors += 1
    # Floor is the 11 always-present deterministic assets (6 tiles + 5 covers);
    # the diagram-sprite count is now dynamic (derived from diagrams.json).
    if len(entries) < 11:
        sys.stderr.write(f"[validate] FAIL: {len(entries)} entries, need >=11\n")
        errors += 1
    # Cross-check (gap-closure #031): every diagram slug in diagrams.json must have a
    # manifest entry, so the book reader blits the sprite instead of ASCII fallback.
    # Skip silently when diagrams.json is absent (deterministic-only bootstrap).
    diagram_specs = load_diagram_specs()
    if diagram_specs:
        manifest_slugs = {e.get("slug") for e in entries}
        for slug, _ in diagram_specs:
            if slug not in manifest_slugs:
                sys.stderr.write(f"[validate] diagram slug {slug!r} from diagrams.json "
                                 f"missing from manifest\n")
                errors += 1
    if errors:
        sys.stderr.write(f"[validate] FAIL: {errors} error(s)\n")
        return 1
    sys.stderr.write(f"[validate] OK: {len(entries)} assets, all PNGs present, "
                     f"all dims 32px-aligned\n")
    return 0


# ---------------------------------------------------------------------------
def _save_deterministic(slug: str) -> None:
    img = DRAW[slug]()
    img = _hard_alpha(img)            # guarantee binary alpha (no fringe)
    img.save(ASSETS_DIR / f"{slug}.png", "PNG")


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate DATAMON library assets + manifest.")
    ap.add_argument("--gen", action="store_true",
                    help="(re)generate AI assets (covers + diagram sprites) via the OpenAI image API")
    ap.add_argument("--no-gen", action="store_true",
                    help="deterministic only: draw Pillow tiles + fallbacks, no API calls")
    ap.add_argument("--only", default="",
                    help="comma-separated AI slugs to (re)generate (implies --gen)")
    ap.add_argument("--validate", action="store_true",
                    help="validate the committed manifest + PNGs, then exit")
    args = ap.parse_args()

    if args.validate:
        return validate()

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Surface tiles: always (re)drawn — pure-deterministic, byte-identical.
    for slug in ALL_SLUGS:
        if KIND[slug] == "tile":
            _save_deterministic(slug)

    # 2. AI-eligible assets (covers + diagram sprites).
    do_gen = (args.gen or bool(args.only)) and not args.no_gen
    if do_gen:
        ic = discover_image_compass()
        if not ic:
            sys.stderr.write("ERROR: image-compass not found; set IMAGE_COMPASS_DIR.\n")
            return 2
        only = {s.strip() for s in args.only.split(",") if s.strip()} or AI_SLUGS
        for slug in [s for s in ALL_SLUGS if s in only and KIND[s] == "ai"]:
            tgt = (32, 48) if slug.startswith("book-") else (64, 64)
            raw = ai_generate(slug, tgt, ic)
            if not raw or not raw.exists():
                sys.stderr.write(f"[skip] {slug}: generation failed -> drawing fallback\n")
                _save_deterministic(slug)
                continue
            out = postprocess(raw, tgt)
            out.save(ASSETS_DIR / f"{slug}.png", "PNG")
            sys.stderr.write(f"[ok]  {slug}: {out.size[0]}x{out.size[1]} (AI) saved\n")
    else:
        # Deterministic-only path: draw a Pillow fallback for any AI slug whose PNG
        # is missing. Never clobber a committed AI PNG.
        for slug in AI_SLUGS:
            if not (ASSETS_DIR / f"{slug}.png").exists():
                _save_deterministic(slug)

    # 3. Manifest.
    entries = build_manifest()
    write_manifest(entries)
    present = sum(1 for e in entries if not e.get("missing"))
    sys.stderr.write(f"[manifest] {present}/{len(entries)} assets present "
                     f"-> {ASSETS_DIR}/manifest.json\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
