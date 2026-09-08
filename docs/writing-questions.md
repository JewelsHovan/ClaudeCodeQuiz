# Writing questions that behave like the real exam

Feedback from someone who sat and passed the exam on 2026-09-07, having practised extensively against
this bank:

> "A lot of it was asking **how to do it** — effectively, efficiently — not that I know the concept."

That is the single most useful note we have, and most of this repo's questions do not meet it. This
guide is how to close that gap.

---

## The core principle

**The exam tests judgment under constraints, not recall.**

Look at how the official objectives are phrased. They almost never say *know* or *describe*. They say
**select**, **evaluate**, **design**, **diagnose**, **apply**, **configure** — and then they name the
tradeoff:

> "Evaluate multi-agent orchestration patterns — coordinator-worker, parallel execution, and
> sequential pipelines — to **select the structure best satisfying research coverage, latency, and
> reliability requirements**."

> "Select the appropriate API processing mode — synchronous Messages API or asynchronous Message
> Batches API — **based on latency requirements, workflow blocking behavior, and acceptable
> processing windows**."

The candidate is assumed to know what all the options *are*. What is being scored is whether they
pick the right one **for the stated situation**. Write to that.

---

## What this means for distractors

The failure mode in a weak bank is one obviously-correct answer beside three obviously-wrong ones.
Anyone who knows the concept scores it without reading the stem.

**Every option should be something a competent engineer might actually do.** The discriminator is not
*correct vs incorrect* — it is **more effective vs less effective, given the constraint in the stem**.

Useful distractor archetypes, all of which are defensible in isolation:

| Archetype | Why it is tempting | Why it loses |
|---|---|---|
| **The heavier fix** | Genuinely more robust | Over-engineered for what the stem diagnosed |
| **The adjacent fix** | Solves a real problem | Not *this* problem |
| **The right idea, wrong layer** | Correct mechanism | Applied where it does not reach |
| **The premise-violator** | Standard best practice | The stem explicitly excluded it |
| **The yesterday's-answer** | Was correct historically | Superseded by a current capability |

Avoid entirely: options that are factually invented (a parameter that does not exist), or that no
practitioner would propose. Those make the item a vocabulary check.

---

## Length parity — the rule that matters most

An audit of this bank in September 2026 found the correct answer was **the longest option in 83% of
questions**, averaging **54 characters longer** than its distractors. Chance is 25%.

**A candidate who always picks the longest option, without reading a single stem, scores 83% here.**
The pass mark is around 72%. The bank was gameable, and every score it produced was inflated.

The cause is mechanical, not conceptual. It is easy to explain the reasoning *inside* the correct
option — "…because X, so do Y" — and leave the distractors terse. Do that consistently and the key
becomes visually identifiable, which trains pattern-matching instead of judgment.

**The rule: every option gets the same treatment.** Reasoning belongs in `explanation` and
`distractors`, never inside the option text. If the key needs a clause to be correct, give the
distractors the same kind of clause.

### Before — the key argues its own case

> A. Use the more specific glob
> B. Both rule files load and are concatenated into context. There is no documented override between
>    matching rules, so contradictory guidance may be resolved arbitrarily — keeping matching rules
>    consistent is the author's job.
> C. Neither loads
> D. The first glob to match wins

B is visibly the answer before you have read the stem. (This example is real — it is `d3-010`, which
appears in the audit's worst-offenders list.)

### After — all four options carry the same weight

> A. Only the more specific glob loads; the narrower pattern overrides the broader one
> B. Both files load and concatenate; there is no documented override, so conflicts resolve arbitrarily
> C. Neither loads; Claude skips conflicting path rules and falls back to CLAUDE.md
> D. The first glob to match loads and later matches are ignored

Same key, same discrimination, no visual tell. The *why* moves to `explanation`, where it belongs and
where the candidate reads it after answering.

### Check before you commit

```bash
uv run python scripts/audit_bank.py            # report
uv run python scripts/audit_bank.py --worst 20 # the offenders to fix first
uv run python scripts/audit_bank.py --strict   # exit 1 on a breach, for CI
```

Targets: key is longest in **≤35%** of questions, key exceeds the mean distractor by **≤15 chars**, no
distractor under **45 characters**. A distractor shorter than that reads as filler and tells the
candidate it is not the answer.

---

## Every stem needs an eliminating clause

Good exam items contain **one sentence that rules options out**. It is what converts a "which is best
in general" question — unanswerable — into one with a defensible key.

> "Tool descriptions are **clear and unambiguous**." → kills every answer that edits descriptions.
> "Stakeholders **rejected any approach that filters findings**." → kills auto-suppression.
> "The scope of the review is **well understood up front**." → kills dynamic decomposition.
> "Useful **only when creating new endpoints — not when debugging**." → kills path-scoped rules.

When drafting, write the constraint first and the options second. If you cannot state which sentence
eliminates each wrong option, the item is not ready.

---

## Worked example

**Weak — tests recall.** Three options are simply wrong; the stem carries no constraint.

> Your agent makes sequential tool calls. How do you reduce round trips?
> A. Increase `max_tokens` · B. Prompt Claude to bundle related calls in one turn ·
> C. Lower the temperature · D. Add more tools

**Strong — tests judgment.** Every option is a real technique someone has shipped. The stem supplies
numbers that eliminate three of them.

> Your support agent averages 4+ API round trips per resolution. Logs show it requests
> `get_customer` and `lookup_order` in separate turns even when the opening message clearly needs
> both. Tool descriptions are accurate and the agent selects the right tools — it just sequences
> them. Which change most directly reduces round trips?
>
> A. Create a composite `get_customer_with_orders` tool that bundles the common lookup pair
> B. Instruct Claude in the prompt to request all needed tools in a single turn
> C. Enable speculative execution that pre-fetches likely-needed tools alongside each request
> D. Raise `max_tokens` so Claude has room to plan multi-tool sequences

A is real engineering and genuinely works — for one pair, while proliferating special cases. C is a
real pattern with a real cost. D is plausible if you believe planning is token-bound. **B wins because
parallel tool use is already native**; the capability exists and only needs to be invoked. The stem's
"it just sequences them" is the eliminating clause: the problem is not selection, so nothing that
changes the tool surface addresses it.

---

## Difficulty calibration

| Level | What separates the key from the best distractor |
|---|---|
| `easy` | A fact — a default, a file location, a parameter name |
| `medium` | Applying a rule to a scenario, where one option violates a stated constraint |
| `hard` | Two options are both defensible and the stem's constraint decides; or the best answer is the *least* intervention that treats the diagnosed cause |

Bias the bank toward `medium` and `hard`. The real exam has few pure-recall items.

---

## Multiple-response items

Set `answer` to a list. The UI shows a "Select N" badge and scores a partial selection as zero, as the
real exam does. Two rules:

- **Both keys must be independently defensible.** If one is obviously right and the other obscure, you
  are testing whether the candidate noticed the badge, not whether they know the material.
- **At least one distractor must be a near-miss** — the same idea applied wrongly, so a candidate who
  half-understands picks it.

---

## Anchor questions to an objective

`docs/exam-objectives.md` lists the exam's own 37 objectives with current bank coverage. Write against
that list rather than against a domain heading, and prefer objectives marked ⚠️ (two or fewer related
questions).

Reuse the objective's own verbs and named tradeoffs in your stem. If the objective says "based on
latency requirements, workflow blocking behavior, and acceptable processing windows", your stem should
supply concrete values for those three things and let them decide the answer.

---

## Mechanics

Required fields: `id`, `domain`, `scenario`, `difficulty`, `stem`, `options`, `answer`, `explanation`,
`distractors`, `tags`.

- `scenario` must be one of the six official themes. Check the distribution before adding — they are
  drawn 4-of-6, so parity is roughly equal coverage, and this bank has historically skewed hard toward
  Customer Support.
- `distractors` needs an entry per wrong option explaining **why it loses**, not merely that it does.
  "This is incorrect" teaches nothing; "this treats the symptom — the stem states descriptions are
  already clear" teaches the discrimination.
- Cite options as `(A)`, `(B)` in explanation prose. The generator rewrites those references when it
  shuffles options, so they stay consistent with what the candidate sees.

Validate before committing:

```bash
uv run python scripts/validate_bank.py
```

---

## A self-check before you commit an item

1. Is the key the longest option? If so, either trim it or give the distractors equal weight. Run `scripts/audit_bank.py`.
2. Could a competent engineer defend **every** option in isolation? If not, that option is filler.
3. Which sentence in the stem eliminates each wrong option? If you cannot name it, the key is arguable.
4. Is the question "do you know X" or "given these constraints, what do you do about X"? Only the
   second belongs here.
5. Would someone who knows the concept but has never *applied* it still get it right? If yes, it is
   too easy.
