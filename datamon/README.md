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
