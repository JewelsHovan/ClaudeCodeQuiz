# DATAMON — Gotta Cert 'Em All (Claude Code Foundations Edition)

A Pokemon-style pixel game for the team — and a study tool for the
**Claude Certified Architect Foundations** exam. Walk around the office,
challenge your colleagues to battle, and answer exam questions across the five
official domains to win. Pick yourself as the player and everyone else becomes
a rival trainer. Runtime identity uses curated pixel sprites and lazily loaded pixel-art
portraits; source headshots remain offline tooling inputs and are excluded from deployments.

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
| Mouse / touch | Click once to step or hold toward a direction; select visible controls |
| Shift + arrows/WASD or R | Run while moving |
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
- **Agent Wing battles are strategic Incident Command encounters.** Choose Query,
  Inspect, Patch, or Escalate; build Momentum, deploy a Guardrail, and reduce enemy
  Stability on a service-topology board. The last undefeated Agent rival is a gated
  three-phase boss with 3/4/5 Stability.
- Other domains retain the classic two-mon flow for now: a correct answer faints the
  mon; a wrong answer costs 25 HP. Every outcome shows the expected answer and a
  one-line explanation (ENTER skips the typewriter, then advances).
- HP at 0 = blackout from imposter syndrome; you respawn in the lounge.
- The **coffee machines** (bottom corners) fully restore HP.
- Defeat all 28 rivals to become a **Claude Certified Architect**.
- Progress autosaves to localStorage.
- An original adaptive Web Audio score changes arrangement between title, office,
  Library, minigames, classic battles, Incident Command, boss phases, victory, and
  defeat. It begins only after a key/pointer activation; **M** mutes music and SFX
  everywhere, including colleague search.

## Files

- `index.html` — page shell
- `game.js` — engine: overworld, character select, battle adapters, Library, and save
- `battle-ops.js` — pure Agent Operations reducer and strategic action economy
- `agent-arena.js` — Incident Command presentation, accessibility, bounded effects/audio
- `world-art.js` — DPR-aware map caches, accepted HD asset/ambient layer, lazy portraits
- `music.js` — original deterministic score, scene routing, crossfades, and bounded Web Audio scheduler
- `questions.js` — 120-question bank (AGENT / MCP / CONFIG / PROMPT / CONTEXT,
  24 per exam domain, each with an explanation), mon names, battle quotes
- `sprites/` — generated GBA-style pixel trainer sprites (transparent 256px PNGs)
- `portraits/` — curated pixel-art busts, loaded only when first displayed
- `.headshots-offline/` — ignored local identity references for tooling; never requested, tracked, or packaged
- `headshots/` — verified transparent 1×1 tombstones only, retained to evict stale CDN photo URLs
- `environment/` — reviewed 2× environment batches plus the atomic active manifest
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

1. Add the slug to `ROSTER` in `game.js`.
2. Add a 256px transparent pixel-art trainer at `sprites/<slug>.png` and a curated
   bust at `portraits/<slug>.png`. Missing portraits fall back to initials.
3. If regeneration needs an identity reference, place it locally at
   `.headshots-offline/<slug>.png`; it remains ignored and excluded from artifacts. The
   tracked `headshots/<slug>.png` files are transparent CDN tombstones, not references.

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

## Reviewed 2× world art

`environment/manifest.json` is an additive, reviewed overlay over the legacy tile/prop
contracts. At DPR2 the office cache is 2304×1536 while collision, camera destinations,
and the 32px logical map remain unchanged. The office cache builds at boot; Library art,
content, and its cache load once on first entry. DPR1/fractional devices retain safe fallbacks.

The accepted Agent Wing pilot contains true 2× brick/window/material art, seven upgraded
props, a visual-only collaboration table, and four bounded ambient strips. Its reviewed
brick, rainy-window, and radiator materials are reused office-wide. The other five zones add
cache-baked domain instruments (tool bus, calibration rail, context frames, editorial marks,
and certification compass), while the Library uses continuous staggered slate, brass aisles,
walnut alcoves, reading pools, and an open-book medallion. Five office and two Library
procedural loops are fixed/bounded and pin to phase zero under reduced motion. Missing or
invalid HD members fall back without changing state. The existing portrait set is unchanged.

The deterministic pipeline never writes generated output directly into accepted runtime art:

```bash
# Rebuild the zero-cost pilot into ignored staging and prove deterministic identity
python3 datamon/tools/gen_world_art.py --validate-twice
# Validate and produce a review sheet
python3 datamon/tools/art_pipeline.py validate \
  datamon/.environment-work/staging/batch-agent-wing \
  datamon/.environment-work/staging/batch-agent-wing/manifest.json
python3 datamon/tools/art_pipeline.py contact-sheet \
  datamon/.environment-work/staging/batch-agent-wing \
  datamon/.environment-work/staging/batch-agent-wing/manifest.json
```

Promotion requires a review record tied to the exact contact-sheet SHA. `accept` installs
immutable assets first and swaps the active manifest last; injected-failure tests prove the
previous accepted state is restored. Raw/staging/review/history paths are ignored and excluded
from deployment artifacts. No image API is invoked by this recipe.

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

The moving player animates with **real 4-direction walk-cycle frames** in
`sprites-walk/<slug>/{down,up,left,right}_{0..3}.png` (left contact, passing, right contact, passing),
generated per character by `tools/gen_walk_assets.py`. All 29 sets are available, but only
the selected/saved player's 16 frames are lazy-loaded (rather than blocking boot on 464 PNGs).
`drawCharacter()` picks the sheet by facing and advances it on a dedicated,
frame-rate-independent animation clock (**9 FPS walking, 13 FPS running**); idle shows frame
0, so a standing character is perfectly still. The physical `gaitPhase` remains distance-locked
for footstep dust, shadows, and the procedural fallback. Frames are HQ-downscaled once per
device size (`walkMini`) so thin legs stay crisp under the nearest-neighbour canvas.

### Regenerating walk frames

```bash
# One character with the latest configured GPT Image 2 model (3 calls; needs OPENAI_API_KEY):
uv run --script datamon/tools/gen_walk_assets.py --only <slug> --force --refresh --provider openai

# Everyone missing from sprites-walk/ using the cheaper Gemini route:
uv run --script datamon/tools/gen_walk_assets.py --gen --provider gemini

# Re-slice/bake from the cached raw sheets in .walk-gen-cache/ (no API):
uv run --script datamon/tools/gen_walk_assets.py --pipeline-only
```

Each walk cycle is generated as a **single 4-frame sprite-sheet image** (all frames share
identity/lighting by construction — separate generations drift), on a magenta bg for keying.
Three sheets cover four directions: the side sheet walks right; `left_*` is its mirror,
baked to files because the game loads explicit per-direction frames. The deterministic
slice step keys the background, strips residual ground lines, finds the four largest complete
character components across the whole sheet (so wide strides are not clipped at quarter
boundaries), sorts them left-to-right, and feet-aligns them into 240px-tall cells. Eyeball
`.walk-gen-cache/<slug>-review.png` after generating; a side sheet that came out walking left
can be re-baked with `--mirror-side <slug>`.

### Procedural fallback (any slug without frames)

Characters lacking walk frames fall back to **procedurally deforming their own
per-character `spriteMini` sprite** — no shared body rig. NPCs (integer-only positions,
never `moving`) and the idle player are rendered perfectly still (bob=0, sway=0,
scaleX=scaleY=1).

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

## Testing & Deployment

### Bootstrap a clean clone

```bash
just bootstrap   # npm ci + pinned Playwright Chromium
just check       # complete local quality gate
```

`just check` runs JavaScript syntax checks, structural validation of all question/Library
content, unit tests against the production test helper, two-build payload determinism and
integrity checks, a Chromium journey from title → select → overworld → real battle, and
three uncached performance runs. Browser checks serve `dist/`, not the source directory,
and fail on page errors, console errors/assertions, failed requests, or HTTP errors.

Useful focused commands:

```bash
just package           # build and verify dist/
npm run test:unit      # loopback/RNG/clock helper tests
npm run test:browser   # package, then browser journey
just perf-baseline     # package, then enforce three cold-title runs
just preview           # serve verified dist/ at http://localhost:8750/
```

### Deterministic test seam

Tests inject `datamon/core.js` before `game.js`. It activates only on loopback hosts and is
excluded from the deployed payload. It supplies seeded RNG, a wall-clock mock that leaves
`performance.now()`/animation timestamps untouched, and bounded state inspection. It does
not modify production gameplay or saves.

### Save compatibility

`state.js` normalizes the existing `datamon-save-v1` localStorage key into schema v2 while
retaining every previous top-level field. It adds reserved campaign progression, explicit
stable question IDs, and persisted NPC domains. Legacy `CAT:index` question telemetry is
kept alongside canonical IDs for rollback; the original legacy value is backed up once.
Unknown future schemas are write-protected until the player explicitly resets from title.

### Fixed performance contract

Budgets live in `scripts/performance-budgets.json` and are enforced by `just check`:

- cold title ready: **≤ 2500 ms**
- requests: **≤ 194**
- response payload: **≤ 3,000,000 bytes**
- resident walk sets/frames on a fresh title: **0 / 0**

Results are written to ignored `test-results/performance.json`. Re-baselining requires an
explicit reviewed edit to the committed budget file; checks never derive new limits from
the run they are judging.

### Guarded public Cloudflare deployment

```bash
just deploy
```

The command rejects detached, dirty (including untracked), unpushed, or non-`dev`/`main`
state; runs the complete check once; verifies the unchanged payload manifest/SHA; deploys
that exact `dist/`; then smoke-tests the branch alias and expected commit. No deployment is
performed by `just check`.

DATAMON is intentionally published as a public study tool. The deployed experience includes
the company roster and curated pixel-art likenesses, but never source headshots, raw generation
material, or local review/staging files. Remote smoke requires an unauthenticated HTTP 200,
then proves public metadata and the title screen match the expected commit and payload. An
Access challenge, redirect, missing metadata, or mismatched artifact fails deployment.

An existing public artifact can be checked independently:

```bash
just remote-smoke https://dev.datamon.pages.dev/ <full-commit-sha>
```

Rollback inventory:

```bash
just rollback
npx wrangler pages deployment list --project-name=datamon
```

Then select the previous deployment in Cloudflare Pages and roll it back.
