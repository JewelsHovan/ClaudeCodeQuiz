# Claude Certified Architect — Foundations Exam Prep

A study environment for the **Claude Certified Architect – Foundations** certification (exam code
`CCAR-F`). You use Claude Code as a tutor that adapts to your weak spots, generates timed practice
exams as standalone HTML, and reads your results back to tell you *why* you missed things.

> **Someone passed using this.** 2026-09-07, scaled **887** against a 720 pass line, after seven
> timed mocks in a day. Their firsthand report — including what the exam covered that this repo did
> not — is in [`docs/tips-from-passers.md`](docs/tips-from-passers.md) §1b.

## Quick start

```bash
git clone <repo-url> && cd ClaudeCodeQuiz
claude
/setup
```

`/setup` creates your personal profile and walks you through the rest. Read
[`docs/practice-workflow.md`](docs/practice-workflow.md) for the loop this repo is built around.

## The loop

```
Ask for an exam  →  take it in your browser  →  paste the results JSON back into the chat
      ↑                                                        ↓
  a set that re-tests    ←   /save-progress   ←   "walk me through my errors"
  exactly what you missed
```

Re-testing your own misses later the same day is the highest-yield move here — in one session it
converted 12 of 13 previously-missed items.

## Commands

| Command | What it does |
|---|---|
| `/setup` | Create your learner profile (run once) |
| `/quiz` | Interactive quiz — adapts to weak areas and your spaced-repetition due list |
| `/study [topic]` | Tutoring mode, e.g. `/study mcp`, `/study hooks` |
| `/flashcards` | Rapid-fire drill |
| `/weak-spots` | Diagnostic: where you stand, per domain |
| `/learn-doc [topic]` | Generate a shareable HTML study guide |
| `/mock-exam` | Timed HTML exam, scored against 720/1000 with a pass estimate |
| `/cheat-sheet` | Key numbers, decision trees, anti-patterns |
| `/save-progress` | **Run after every session** — persists what you learned |

### Generating exams directly

```bash
uv run python mock-exams/generate_exam.py --count 60 --time 120 --unseen
```

| Flag | Effect |
|---|---|
| `--count` / `--time` | Size and time limit |
| `--domain 1-5` | Single-domain focus |
| `--difficulty medium,hard` | Skip easy questions |
| `--include IDS` | Force specific questions in — or pass a results JSON to re-test its `wrong[]` |
| `--unseen` / `--unseen-since` | Draw only from questions you have not seen |
| `--adaptive RESULTS.json` | Weight toward weak domains and missed concepts |
| `--seed N` | Reproducible set |

Output is a self-contained HTML file — in-page timer, per-domain breakdown, full answer review, and a
results JSON to paste back into Claude Code.

## DATAMON — study by playing 🎮

A Pokémon-style pixel game where you walk around an office and battle teammates by answering exam
questions. Defeat all rivals to become a Claude Certified Architect.

```bash
./datamon/play.sh
```

No build, no dependencies. See [datamon/README.md](datamon/README.md).

## How progress is tracked

Every concept lives in a **Leitner box** (1–5). Miss it and it drops to Box 1 and resurfaces next
session; answer it right repeatedly and it fades out. Alongside it, a **mistake log** records the
*root cause* of each miss — which is what surfaces patterns like reaching past the minimum fix, or
answering a "why" question with a remedy. Those are worth more than the raw score.

Your `profile/` directory is gitignored, as are `mock-exams/attempts/` and `mock-exams/results/`, so
everyone on the team keeps their own progress in the same repo.

## Exam overview

Verified against the official **Exam Guide v1.0, effective July 2026** (re-checked 2026-09-07 — no
v2.0 exists) and confirmed by a completed sitting.

| Domain | Weight |
|---|---|
| 1. Agentic Architecture & Orchestration | 27% |
| 2. Tool Design & MCP Integration | 18% |
| 3. Claude Code Configuration & Workflows | 20% |
| 4. Prompt Engineering & Structured Output | 20% |
| 5. Context Management & Reliability | 15% |

- **Format** — ~60 questions, **multiple-choice *and* scenario-based multiple-response** ("Select N";
  a partial selection scores zero)
- **Time** — 120 minutes (~135 min seat time)
- **Passing score** — 720 / 1000 scaled. Unanswered counts as incorrect; no guessing penalty
- **Scenarios** — **4 of 6** drawn at random: Customer Support Resolution Agent · Code Generation with
  Claude Code · Multi-Agent Research System · Developer Productivity with Claude · Claude Code for
  Continuous Integration · Structured Data Extraction
- **Delivery** — Pearson VUE proctored (OnVUE online or a test centre); registration via Skilljar
- **Cost** — $125 · **Validity** — 12 months, free non-proctored renewal
- **Prerequisite** — none formal, but you need a Claude Partner Network org and a company email

The exam is pinned to the July 2026 guide, so several things that are true of the platform *today*
are wrong answers on it. The cheat sheet marks those explicitly.

## Study materials

**Start here**
- [`docs/practice-workflow.md`](docs/practice-workflow.md) — how to use this repo
- [`docs/exam-objectives.md`](docs/exam-objectives.md) — the exam's own **37 objectives**, from a real
  score report, with per-objective bank coverage
- [`docs/exam-cheat-sheet.md`](docs/exam-cheat-sheet.md) — numbers, decision trees, anti-patterns
- [`docs/tips-from-passers.md`](docs/tips-from-passers.md) — firsthand report and how to pass

**Reference**
- `docs/domain{1..5}-*.md` — one guide per domain
- `docs/mcp-deep-dive.md`, `docs/agent-sdk-deep-dive.md`
- `docs/exam-research-2026.md` — cited blueprint research with dated re-verification
- `docs/research/` — sourced research from Anthropic primary sources, each with an explicit
  **verification-gaps** section listing what could not be confirmed

**Contributing**
- [`docs/writing-questions.md`](docs/writing-questions.md) — how to author items that behave like the
  real exam
- [`docs/bank-backlog.md`](docs/bank-backlog.md) — prioritised list of what to write next

## Practice bank

`quiz/bank/*.json` — **191 questions**, tagged by domain, scenario and difficulty, powering
`/mock-exam`. Also `quiz/practice-questions.md`, `scenario-questions.md` and `flashcards.md` as
readable sets.

Two scripts guard it:

```bash
uv run python scripts/validate_bank.py   # invariants: schema, ids, answers, coverage
uv run python scripts/audit_bank.py      # quality: length bias, filler, scenario balance
```

> ⚠️ **Known issue.** The September 2026 audit found the correct answer is the longest option in
> **83%** of questions — meaning a candidate who always picks the longest scores 83% without reading
> the stem. Practice scores from this bank are inflated until that is fixed. See the length-parity
> rule in `docs/writing-questions.md`; `audit_bank.py --worst 20` lists what to fix first.

## Recommended order

1. `/weak-spots` — establish a baseline
2. `/study` your weakest domain (start with Agentic Architecture, it is 27%)
3. `/quiz` for retention, hitting your due list
4. `/mock-exam` — full timed simulation, then paste the JSON back for a walkthrough
5. Re-test your misses with `--include` before moving on
6. `/cheat-sheet` and `docs/tips-from-passers.md` in the last hour
