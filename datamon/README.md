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
- `tiles/` — committed 32×32 RGBA office tileset PNGs: round-1 ("Claude lab") floor
  variants, walls + corners, desk, plant, coffee, rug — plus the PRD 005 office surface
  set (hardwood, red/white brick, industrial window, wood column, silver ducting).
  Loaded into `tileStore` via `loadTiles()` for the tile-based renderer. The game runs
  fine without them (flat-color fallback) — see regen below.
- `tools/` — `gen_tiles.py` + `gen_office_tiles.py` (regenerate the tilesets) and
  `check_tiles.py` (validates round-1)
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

**Primary recipe — the committed generators (reproducible, no API, no manual slicing):**

```bash
# Round-1 "Claude lab" tileset (floors, terracotta walls, desk/plant/coffee/rug):
uv run --with pillow python datamon/tools/gen_tiles.py        # (re)writes datamon/tiles/*.png
# Office surface tileset (PRD 005): hardwood, brick walls, window, column, ducting:
uv run --with pillow python datamon/tools/gen_office_tiles.py # (re)writes datamon/tiles/*.png
uv run --with pillow python datamon/tools/check_tiles.py      # asserts round-1 are 32×32 RGBA
```

> **Order matters:** `gen_office_tiles.py` re-styles the wall autotile set
> (`wall-h`, `wall-v`, `wall-corner-*`) into red office brick, so run it **after**
> `gen_tiles.py` if you want the brick walls. Both generators are deterministic —
> a clean re-run produces byte-identical PNGs.

Edit the palette constants or the per-tile draw functions at the top of either
generator to restyle. Slugs consumed by `loadTiles()` in `game.js`:
- **Round-1** (`gen_tiles.py`): `floor-a/-b/-c`, `wall-h`, `wall-v`,
  `wall-corner-tl/-tr/-bl/-br`, `desk`, `plant`, `coffee`, `rug`.
- **Office surface** (`gen_office_tiles.py`, PRD 005): `hardwood-a/-b/-c` (warm orange
  planks), `brick-red`, `brick-white`, `window-h` (industrial blinds), `column`
  (wood beam), `duct` (silver + red pipe), plus the re-styled `wall-*` brick set.
  Palette matches `datamon/.design/office-concept-topdown.png`.

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

## Library assets regen

The library minigame area (PRD 006) has its own pixel-art set in
`library/assets/` (16 × 32px-grid RGBA PNGs + a `manifest.json`), generated by
`tools/gen_library_assets.py`. It mixes two asset classes, mirroring the office
tiles-vs-props split:

- **Surface tiles** (deterministic Pillow primitives, fixed RNG seed): `bookshelf`
  (32×96, 3 shelves of coloured spines), `lib-floor-a` (stone), `lib-floor-b`
  (carpet), `lib-floor-c` (slate), `lib-wall` (dark stone brick), `lib-rug`. Always
  (re)drawn — byte-identical on every run.
- **AI-eligible assets** (opt-in `--gen`, with deterministic Pillow fallbacks):
  five domain-coloured book covers `book-domain1`…`book-domain5` (32×48) and five
  diagram sprites `lib-diagram-domain{1..5}-1` (64×64, used inline by the reader and
  as assembly pieces). Without `--gen` they fall back to drawn placeholders.

```bash
# Deterministic-only — draws every tile + fallback, writes manifest.json (no API key):
uv run --with pillow python datamon/tools/gen_library_assets.py --no-gen
# Verify the committed set against the manifest (exits 0 when clean):
uv run --with pillow python datamon/tools/gen_library_assets.py --validate
# (Re)generate the covers + diagram sprites via the OpenAI image API (opt-in):
uv run --with pillow python datamon/tools/gen_library_assets.py --gen          # needs OPENAI_API_KEY
uv run --with pillow python datamon/tools/gen_library_assets.py --only book-domain1
```

The manifest follows the exact `props/manifest.json` schema
(`{slug, file, widthPx, heightPx, tileW, tileH, anchorX, anchorY}`, sorted by slug),
so the game loads these with the existing `loadOne`/`blitTile` pattern — a missing
PNG yields `tileStore[slug]=null` and `blitTile()=false`, triggering the drawn-box
fallback. The tool **never** writes to `tiles/` or `props/`. Diagram-sprite slugs use
the `lib-diagram-{doc_slug}-{N}` convention to match `diagrams.json` (ticket #024).

## Library minigame content banks (gen_library.py)

Four JSON content banks under `datamon/library/` power the library minigame:

| File | Min entries | Description |
|---|---|---|
| `pairs.json` | 20 | Term↔definition flash pairs |
| `cloze.json` | 20 | Fill-in-the-blank items (one `___` blank per item) |
| `diagrams.json` | 5 | ASCII decision-tree puzzle pieces |
| `books.json` | 10 | Pre-paginated study-doc pages for the in-game reader (ticket E #027) |

All content is **derived automatically** from `docs/*.md` and `quiz/bank/domain{1-5}.json`.
No manual authoring, no network access, stdlib only.

**Regenerate:**
```bash
uv run python datamon/tools/gen_library.py --pairs --cloze --diagrams
uv run python datamon/tools/gen_library.py --books
# or regenerate all four at once:
uv run python datamon/tools/gen_library.py
```

**Validate (exits 0 + prints count summary on success):**
```bash
uv run python datamon/tools/gen_library.py --validate
```

**Difficulty normalisation:** The quiz bank uses `easy`/`medium`/`hard`; the library banks
output `easy`/`normal`/`hard` (i.e. `medium` → `normal`).

> **Note:** Re-running OVERWRITES the generated output files. If you have hand-curated
> edits to `pairs.json`, `cloze.json`, `diagrams.json`, or `books.json`, apply them as a
> post-process step or re-apply them manually after regeneration.

## Overworld walk/run animation

The overworld player animates by **procedurally deforming its own per-character `spriteMini`
sprite** every frame — there is no shared/generic body rig and no extra art assets. Each
character keeps its individual pixel art; the motion comes from canvas affine transforms in
`drawCharacter()`. NPCs (integer-only positions, never `moving`) and the idle player are
rendered perfectly still (bob=0, sway=0, scaleX=scaleY=1).

Deformation (moving player only), driven by the gait phase `p = gaitPhase`:

- **Bob** — `bobOff = A * (sin(p) − 0.2·sin(2p))`, `A = 1.5px` (asymmetric vertical lift).
- **Squash/stretch** — `scaleY = 1 + sin(2p)·sq`, `scaleX = 1/scaleY` (volume-conserving,
  anchored at the feet). `sq = 0.02` walking, `0.12` running.
- **Sway** — `sway = K·stride·sin(p)` px, a whole-sprite horizontal **translate only** (no
  shear/skew). `K = 26`; `stride = 0.06` walking, `0.11` running.

**Slide-free gait:** `gaitPhase` advances from the *eased* per-frame position delta
(`gaitPhase += |Δe| · 2π`, where `e` is the smoothstep step progress), not from `speed · dt`
— so the cycle stays locked to actual tile travel and the feet never slide. It resets to 0
when idle and at each step start.

**Hold R (or Shift) to run.** While held, `player.running` switches to the punchier run
params (sq=0.12, stride=0.11) and movement speeds up from 7.5 to 12.5 tiles/sec.
