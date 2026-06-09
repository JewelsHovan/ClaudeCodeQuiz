Generate and launch a timed, interactive HTML mock exam for the Claude Certified Architect — Foundations certification.

Argument: $ARGUMENTS

## How it works
The mock exam is produced by a Python generator that samples the structured question bank in
`quiz/bank/*.json` using the real exam's domain weights (27/18/20/20/15) and writes a
**self-contained HTML file** with an in-page countdown timer, scenario grouping, auto-scoring on
the 0–1000 scaled estimate (720 to pass), a per-domain breakdown, and a full answer review.

## Steps

1. **Parse `$ARGUMENTS`** into generator flags (default = full 60-question, 120-minute exam):
   - empty / `full` → `--count 60`
   - `quick` → `--count 20`
   - a bare number `N` → `--count N`
   - `domain N` or `dN` → `--domain N` (single-domain focus, uses all available in that domain)
   - `time M` → `--time M` (minutes)
   - `seed S` → `--seed S` (reproducible question set)

2. **First, read `profile/learner.md`** (the Concept Mastery / Spaced Repetition table, Mistake Log,
   and weak domains). Mention to the user which domains/concepts are overdue so they know what this
   sitting should pressure-test. (The generator samples by weight, not by weakness — so also remind
   them that `/quiz` is the better tool for targeting specific weak concepts.)

3. **Run the generator** with uv:
   ```bash
   uv run python mock-exams/generate_exam.py <flags>
   ```
   It prints the output path under `mock-exams/attempts/` and the domain mix.

4. **Open it** for the user:
   ```bash
   open "<path printed by the generator>"
   ```
   (On Linux use `xdg-open`.)

5. **Tell the user how to take it**:
   - Click **Start exam** — the timer starts and the exam auto-submits at 0:00.
   - Keyboard: `A/B/C/D` to answer, `←/→` to navigate, `f` to flag. Use the question palette to jump.
   - There's a **practice mode** checkbox on the start screen (reveals the answer after each question) —
     tell them to leave it OFF for a true timed simulation.
   - On submit they get a scaled-score estimate, pass/fail vs 720, pass-likelihood, per-domain bars,
     and a full review with explanations + distractor rationales.

6. **After they finish**, tell them to either click **Copy results JSON** / **Download results JSON**
   in the page and then run **`/save-progress`** (paste or point to the file). `/save-progress` will
   record the attempt in the Mock Exam History table, update Domain Confidence from the per-domain
   breakdown, and drop every missed concept into Box 1 of the spaced-repetition table.

## Notes to convey honestly
- The blueprint and scaled scoring are **community-confirmed approximations**, not Anthropic-published
  (see `docs/exam-research-2026.md`). The scaled number is a linear estimate of raw %; the real exam's
  scaling is undisclosed. Treat it as a calibration signal — **aim comfortably above 720 (≈80%+)** before booking.
- Questions are **original practice items** written to match the blueprint, never real (NDA) exam content.
