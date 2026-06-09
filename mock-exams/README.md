# Mock Exams

A timed, interactive **HTML** mock exam for the Claude Certified Architect — Foundations cert.

## Use it

Easiest: run **`/mock-exam`** in Claude Code (accepts `quick`, `domain N`, `40`, `seed 7`, `time M`).

Or run the generator directly:

```bash
uv run python mock-exams/generate_exam.py            # full 60-Q, 120-min exam
uv run python mock-exams/generate_exam.py --count 20 # quick drill
uv run python mock-exams/generate_exam.py --domain 1 # single-domain focus
uv run python mock-exams/generate_exam.py --seed 7   # reproducible question set
```

It writes a standalone `.html` to `mock-exams/attempts/` (gitignored) and prints the path. Open it:

```bash
open mock-exams/attempts/<file>.html     # macOS  (Linux: xdg-open)
```

## What it does
- Samples `quiz/bank/*.json` by the real domain weights (27/18/20/20/15).
- Groups questions under their scenario theme; in-page countdown timer auto-submits at 0:00.
- Scores on a 0–1000 **scaled estimate** (720 to pass) with a per-domain breakdown, a pass-likelihood
  estimate, and a full answer review (explanations + distractor rationales).
- Lets you **Copy / Download results JSON** → feed it into `/save-progress` to update your profile.

## Honesty notes
- The blueprint and scaled scoring are **community-confirmed approximations**, not Anthropic-published
  (see `../docs/exam-research-2026.md`). The scaled number is a linear estimate of raw %; the real
  exam's scaling is undisclosed. **Aim comfortably above 720 (≈80%+)** before booking.
- Questions are **original practice items**, never real (NDA) exam content.

## Add questions
Append objects to the relevant `quiz/bank/domainN.json` (schema: `id, domain, domain_name, scenario,
difficulty, stem, options{A-D}, answer, explanation, distractors{wrong letters}, tags, source`).
Keep answer letters roughly balanced across A/B/C/D.
