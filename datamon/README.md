# DATAMON — Gotta Cert 'Em All (Claude Code Foundations Edition)

A Pokemon-style pixel game for the team — and a study tool for the
**Claude Certified Architect Foundations** exam. Walk around the office,
challenge your colleagues to battle, and answer exam questions across the five
official domains to win. Every teammate headshot in `headshots/` is pixelated
at runtime into a sprite — pick yourself as the player and everyone else
becomes a rival trainer.

The 120-question bank was sourced from this repo's study materials
(domain docs, practice questions, scenario questions, and flashcards),
24 per domain. Every answer — right or wrong — shows a one-line
explanation, so battles double as flashcard reps.

## Run it

```bash
./datamon/play.sh        # from the repo root (or ./play.sh from this folder)
```

That starts a local server and opens the game in your browser.

Manual equivalent:

```bash
cd datamon
python3 -m http.server 8741
# then open http://localhost:8741/
```

No build step, no dependencies — plain HTML/JS/canvas. Progress autosaves to
localStorage (per browser + port, so stick with one way of serving it).

## How to play

| Input | Action |
|---|---|
| Arrows / WASD | Move |
| SPACE / ENTER / E | Interact, battle, advance dialog |
| 1–4 or arrows + ENTER | Answer battle questions |
| Mouse | Also works everywhere |
| M | Mute |
| R (title screen) | Reset save |

- The office has six zones mapped to the exam domains:
  | Zone | Exam domain | Weight |
  |---|---|---|
  | **Agent Wing** | 1 — Agentic Architecture & Orchestration | 27% |
  | **MCP Lab** | 2 — Tool Design & MCP Integration | 18% |
  | **Config Bay** | 3 — Claude Code Configuration & Workflows | 20% |
  | **Prompt Studio** | 4 — Prompt Engineering & Structured Output | 20% |
  | **Context Corner** | 5 — Context Management & Reliability | 15% |
  | **The Lounge** | Mixed, weighted by the real exam percentages | — |
- A trainer's zone decides their question domain.
- Each rival throws 2 "mons" at you (Rogue Subagent, Schema Mismatch, Context
  Rot...) — procedurally generated pixel beasts that poof in on send-out, lunge
  at you when you miss, and faint when you're right. A correct answer faints the
  mon; a wrong answer costs you 25 HP — and both outcomes show a one-line
  explanation of the right answer (typewriter text; ENTER skips, ENTER again
  advances).
- HP at 0 = blackout from imposter syndrome; you respawn in the lounge.
- The **coffee machines** (bottom corners) fully restore HP.
- Defeat all 28 rivals to become a **Claude Certified Architect**.
- Progress autosaves to localStorage.

## Files

- `index.html` — page shell
- `game.js` — engine: overworld, character select, battles, pixelation, save
- `questions.js` — 120-question bank (AGENT / MCP / CONFIG / PROMPT / CONTEXT,
  24 per exam domain, each with an explanation), mon names, battle quotes
- `sprites/` — generated GBA-style pixel trainer sprites (transparent 256px PNGs)
- `headshots/` — 128px teammate headshots, pixelated at runtime (sprite fallback
  + character-select portraits)
- `tiles/` — GBA-style office tileset: 13 committed 32×32 RGBA PNGs (floor variants,
  walls + corners, desk, plant, coffee, rug). Loaded into `tileStore` via `loadTiles()`
  for the tile-based renderer (ticket #003). The game runs fine without them — see regen below.
- `tools/` — `gen_tiles.py` (regenerates the tileset) and `check_tiles.py` (validates it)
- `play.sh` — one-command launcher (serve + open browser)

Adding questions: append to `QUESTION_BANK` in `questions.js` (`q`, 4 choices `c`,
correct index `a`, one-line explanation `x`). Keep `q` ≤ 150 chars, choices ≤ 65,
`x` ≤ 110 so nothing clips in the battle UI.

## Adding a new teammate

1. Drop a square-ish photo at `headshots/<slug>.png` (128px is plenty) and add
   the slug to `ROSTER` in `game.js`.
2. Optionally add a 256px transparent pixel-art sprite at `sprites/<slug>.png`.
   If it's missing, the game falls back to the pixelated headshot automatically.

The sprite-generation tooling (Gemini green-screen pipeline) lives in the
original `ai-gen-playground` repo (`gen-sprite.sh` + `process_sprites.py`).

## Tileset regen

The office tileset in `tiles/` (13 × 32×32 RGBA PNGs) feeds `tileStore` for the
tile-based renderer. Tiles are intentionally generated **deterministically** so they
are exactly 32×32, fully transparent, free of anti-aliasing, and seamless — properties
an image model can't reliably hit, and which matter for a pixel-art tile renderer.

**Primary recipe — the committed generator (reproducible, no API, no manual slicing):**

```bash
uv run --with pillow python datamon/tools/gen_tiles.py    # (re)writes datamon/tiles/*.png
uv run --with pillow python datamon/tools/check_tiles.py  # asserts all 13 are 32×32 RGBA
```

Edit the palette constants or the per-tile draw functions at the top of
`datamon/tools/gen_tiles.py` to restyle. The required slugs (consumed by `loadTiles()`
in `game.js`) are: `floor-a`, `floor-b`, `floor-c`, `wall-h`, `wall-v`,
`wall-corner-tl/-tr/-bl/-br`, `desk`, `plant`, `coffee`, `rug`.

**Alternative — hand-authored art via the `image-compass:image` skill:**

If you want richer, hand-drawn tiles, generate art and slice it down to 32px yourself,
then drop the PNGs into `datamon/tiles/` under the same slugs. Suggested prompt:

> GBA-style pixel art office tiles, warm clay/terracotta walls, cream/off-white floor,
> warm wood desk, leafy green plant, brass coffee machine, transparent background,
> 256×256px each, no anti-aliasing, tileable seamless edges.

The skill usually returns a single large image — open it in any editor, crop each tile,
and downscale to 32×32 with **nearest-neighbor** (not bilinear) to keep crisp pixels.

**Fallback safety:** if `tiles/` is missing or any PNG 404s, `loadTiles()` stores `null`
for that slug and the game renders with flat `tileColor()` colors — no crash, no error.

## Character animation frames

The overworld characters use a **shared generic body rig** — a single GBA-style indigo jacket /
dark trouser figure — with each character's `pixelHead` composited on top at runtime.  This
keeps art assets small (8 sheets instead of per-character sprite sets) while still showing
every teammate's face.

The title parade and character-select screen continue to use the per-character `spriteMini`
art (intentional — those surfaces want the full, individual sprites).

**Output layout:** 8 sprite sheets in `datamon/sprites/anim/`, each `128×44` RGBA PNG.
Format: 4 frames × 32px wide at constant height 44px.

| Sheet | Frames |
|---|---|
| `walk_{down,up,left,right}.png` | 4-frame walk cycle (f0 = idle/contact) |
| `run_{down,up,left,right}.png` | 4-frame run cycle — wider stride + 1px lean |

Head anchor: frame-local `y = 18` (the neckline).  The head zone `y ∈ [0, 18)` is left
transparent so the game can composite `pixelHead(slug)` directly at the frame's top edge.
The neckline is held at a **constant** y across all 4 frames of every sheet so the head
never drifts vertically during animation.

**Regen + validate:**

```bash
uv run --with pillow python datamon/tools/gen_anim.py    # (re)writes datamon/sprites/anim/*.png
uv run --with pillow python datamon/tools/check_anim.py  # asserts all 8 are 128×44 RGBA
```

**Hold R (or Shift) to run.** While R is held the game selects the `run_*` sheets and
advances the animation at 12.5 tiles/sec instead of 7.5, giving a visually distinct faster
gait.

**Graceful fallback:** if `sprites/anim/` is absent or any of the 8 sheets 404, `loadAnim()`
stores `null` for that key (same `loadOne` null-fallback used by tiles).  `animReady()`
detects the gap and `drawCharacter` falls back silently to the round-2 procedural walk cycle
— no JS error, no visible glitch.

**DevTools test** (procedural fallback): open the browser console, run
`window._forceProcedural = true` then reload — `animReady()` returns `false` and the
original procedural path runs byte-identically.
