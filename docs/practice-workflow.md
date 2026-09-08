# How to practise: the Claude Code loop

This repo is built around one loop. You ask Claude for a practice exam, take it in your browser,
paste the result back into the chat, and Claude tells you *why* you missed what you missed and
records it. Everything else here is in service of that loop.

The generator is committed; your answers are not. `profile/`, `mock-exams/attempts/` and
`mock-exams/results/` are all gitignored, so everyone on the team keeps their own progress in the
same repo without colliding.

---

## The loop, end to end

**1. Ask for an exam.** In a Claude Code session, in plain language:

> *"Generate a full 60-question mock, questions I haven't seen."*
> *"Make me a hard Domain 2 set — 15 questions."*
> *"Short set on my weakest areas, I'm nearly ready to sit it."*

Claude picks the flags, runs the generator and opens the HTML for you. You can also run it
yourself — see the recipes below.

**2. Take it in the browser.** The HTML is fully self-contained: countdown timer, one question at a
time, a palette, flag-for-review, and auto-submit at zero. Nothing phones home.

**3. Paste the results JSON back into the chat.** When you submit, the page gives you
**Copy results JSON** and **Download**. Paste it straight into the Claude Code session. That JSON is
the whole interface — it carries your per-domain scores, every question id you missed, the option
you chose, and the concept tags.

**4. Ask for the walkthrough.** *"Walk me through my errors so I don't repeat them."* Claude maps the
shuffled answer letters back to real option text, works out the actual cause of each miss, and looks
for patterns across attempts rather than treating each miss in isolation.

**5. Let it record.** `/save-progress`, or just ask. It updates `profile/learner.md` — domain
confidence, the Leitner boxes, the mistake log with root causes — and appends a session entry to
`profile/session-log.md`.

**6. Close the loop.** Ask for a set that re-tests exactly what you got wrong. Re-testing the same
questions later the same day is the single highest-yield thing in this repo — in one session it
converted 12 of 13 previously-missed items.

---

## Generating exams directly

```bash
uv run python mock-exams/generate_exam.py [flags]
```

| Flag | What it does |
|---|---|
| `--count N` | Number of questions (default 60) |
| `--time N` | Time limit in minutes (default: 2 min/question) |
| `--domain 1-5` | Restrict to one domain |
| `--difficulty medium,hard` | Restrict by difficulty. Force-included questions are exempt |
| `--include IDS` | Force specific question ids in, comma-separated. Also accepts a **results JSON path**, in which case its `wrong[]` ids are used |
| `--unseen` | Exclude questions already delivered in `mock-exams/attempts/*.html` |
| `--unseen-since YYYY-MM-DD` | With `--unseen`, only count attempts on or after this date as seen |
| `--adaptive RESULTS.json` | Bias sampling toward weak domains and missed concepts from a prior result |
| `--seed N` | Reproducible set — same seed, same questions |
| `-o PATH` | Custom output path |

Output lands in `mock-exams/attempts/` (gitignored) with a timestamped filename.

### Recipes

**A clean full mock, nothing you've seen before**
```bash
uv run python mock-exams/generate_exam.py --count 60 --time 120 --unseen
```

**Close specific gaps.** Re-test what you missed, with tag-neighbours pulled in around them:
```bash
uv run python mock-exams/generate_exam.py --count 15 --domain 2 \
  --adaptive mock-exams/results/my-last-result.json
```

**A challenge set before the real thing.** No easy questions, your open misses guaranteed present:
```bash
uv run python mock-exams/generate_exam.py --count 60 --time 120 \
  --difficulty medium,hard \
  --include d4-025,d5-019 \
  --adaptive mock-exams/results/my-gaps.json
```

**Single-domain drill**
```bash
uv run python mock-exams/generate_exam.py --domain 4 --count 20 --time 40
```

### Two things worth knowing

**Date-scope `--unseen` or it will over-filter.** It counts *every* attempt HTML on disk, including
months-old ones drawn from a smaller bank. Left unscoped it can shrink the pool so far that it
silently excludes the exact gap question you were targeting. Use
`--unseen-since 2026-09-01` to mean "seen recently".

**`--unseen` yields to the blueprint.** Once a domain's unseen pool runs dry, a strict unseen-only
draw would skew the domain mix and make the scaled score meaningless. The generator detects this per
domain, warns, and falls back to unseen-*preferred* — repeating previously-seen questions only where
a domain has run out.

---

## Slash commands

| Command | Use |
|---|---|
| `/mock-exam` | Generate and open a timed exam |
| `/quiz [domain]` | Interactive quiz in the chat, no HTML |
| `/flashcards` | Spaced-repetition drill on your weak concepts |
| `/weak-spots` | What the profile says you should work on next |
| `/study [topic]` | Guided study on one topic |
| `/learn-doc [topic]` | Build a shareable HTML study guide |
| `/cheat-sheet` | Render `docs/exam-cheat-sheet.md` |
| `/save-progress` | Record the session into your profile |

---

## How progress is tracked

`profile/learner.md` holds a **Leitner box** table. A concept you get right moves up a box and is
scheduled further out; a miss drops it to Box 1 and it comes back next session.

| Box | Review interval |
|---|---|
| 1 | Every session |
| 2 | ~3 days |
| 3 | ~7 days |
| 4 | ~16 days |
| 5 | Mastered |

Alongside it, the **mistake log** records *why* you missed something, not just that you did. That
distinction matters: over several sessions the log is what reveals patterns like reaching past the
minimum fix, or answering a "why" question with a remedy. Those are worth far more than the raw score.

---

## Contributing questions

> **Read `docs/writing-questions.md` first.** The exam asks *how to do this effectively*, not *do you
> know the concept* — which means every distractor has to be something a competent engineer might
> actually do, and the stem has to carry a constraint that eliminates the losers. Most of this bank
> predates that insight. And anchor new questions to `docs/exam-objectives.md`, which lists the exam's
> own 37 objectives with current coverage.


The bank is `quiz/bank/domain{1..5}.json`. Each question needs `id`, `domain`, `scenario`,
`difficulty`, `stem`, `options`, `answer`, `explanation`, `distractors` and `tags`. Set `answer` to a
**list** for multiple-response items; the UI then shows a "Select N" badge and scores a partial
selection as zero, exactly like the real exam.

Validate before committing:

```bash
uv run python scripts/validate_bank.py
```

It checks schema, unique ids, answer validity, distractor coverage and task-statement coverage.
Answer-letter skew warnings are cosmetic — the generator shuffles options at render time anyway.

**Write explanations that cite options as `(A)`, `(B)`.** The generator rewrites those references
when it shuffles, so the prose stays consistent with the letters the candidate actually sees.

---

## Accuracy conventions

Study material here separates three tiers, and it is worth keeping that discipline when you add to it:

- **Verified against a primary source** — Anthropic docs, the MCP specification, the official Exam Guide.
- **Community practice** — sound and widely taught, but not documented by Anthropic. Say so explicitly.
- **Excluded** — plausible-sounding numbers nobody can source. Leave them out rather than hedging.

The exam is pinned to **Exam Guide v1.0, effective July 2026**. Several things that are true of the
platform today are wrong answers on it — the 2026-07-28 MCP revision, adaptive thinking replacing
`budget_tokens`, prefill deprecation, and the commands/skills unification. When you add material,
mark which era it belongs to.
