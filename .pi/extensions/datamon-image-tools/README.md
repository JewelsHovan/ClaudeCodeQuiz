# DATAMON image tools (project Pi extension)

Project-local image generation and walk-cycle integration for DATAMON.

## Tools

- `image_generate` — generates one image and returns the saved path plus an inline preview.
  - Default: OpenAI `gpt-image-2-2026-04-21` (latest quality route), with image-compass fallback to `gpt-image-2`, `gpt-image-1.5`, then mini when access requires it.
  - Optional: Gemini Nano Banana 2 (`gemini-3.1-flash-image-preview`) or Nano Banana Pro (`gemini-3-pro-image-preview`).
  - Reference images must be inside this project.
- `datamon_walk_review` — returns a character's current 4×4 walk-cycle contact sheet.
- `datamon_walk_bake` — backs up and installs three approved raw sheets, then runs the existing deterministic magenta-key/slice/bake pipeline.
- `/datamon-image-status` — reports model routes, key availability, and image-compass discovery without exposing key values.

## Setup

The current environment already has `OPENAI_API_KEY` and `GEMINI_API_KEY`. The extension discovers image-compass from `IMAGE_COMPASS_DIR` or the existing checkout at:

```text
~/Desktop/Internals/claude-compass-superpowers/image-compass
```

After adding or editing this extension, run `/reload` in Pi. Project-local extensions load only for trusted projects.

## Recommended leg-fix workflow

1. Call `datamon_walk_review` for the affected character.
2. Generate **three separate sheets** with `image_generate`: down/front, up/back, and right-facing side.
3. Each sheet must contain exactly four full-body frames in one horizontal row on solid `#ff00ff` magenta:
   - left-foot contact
   - left-foot passing / right leg advancing
   - right-foot contact
   - right-foot passing / left leg advancing
4. Use the existing `datamon/sprites/<slug>.png` and `datamon/headshots/<slug>.png` as references.
5. Visually inspect every returned sheet. Reject duplicate stride poses, bent/crossed anatomy, drifting scale, cropped feet, shadows, grid lines, or a changing baseline.
6. Only then call `datamon_walk_bake` with all three approved sheets.
7. Inspect the returned 4×4 review sheet before testing in game.

`datamon_walk_bake` stores prior raw sheets under `datamon/.walk-gen-cache/history/<slug>/<timestamp>/`.

## Notes

- OpenAI's newest model does not provide native transparent output; magenta keying is intentional for this pipeline.
- Gemini outputs contain an invisible SynthID watermark.
- Generation is billable. The tools never start a batch automatically and produce one image per call.
