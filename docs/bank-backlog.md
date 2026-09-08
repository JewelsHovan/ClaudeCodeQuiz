# Question bank backlog

A prioritised list of questions worth writing, keyed to `docs/exam-objectives.md` and informed by a
survey of community material (`docs/research/research-community-banks.md`).

Write to the standard in **`docs/writing-questions.md`** — the exam asks *how to do this effectively*,
not *do you know the concept*. Every distractor should be something a competent engineer might ship.

---

## Ground rules from the community survey

**Read for topic coverage, never for text.** Two repos are worth reading closely for technical
accuracy — `dnacenta/claude-certified-architect` (the best content found; **no licence declared**, so
read-only) and `Amey-Thakur/CLAUDE-CERTIFICATIONS` (MIT, updated 2026-09-06). Several others are CC BY
4.0 or MIT and safe to reuse with attribution. Every paid "dumps" site is noise — one flatly claims a
13-scenario pool against the real 6.

**Avoid the converged scenarios.** Independently-created repos keep reaching for the same four
illustrative examples: the 40%-vs-12% conflicting-statistics case, "creative industries decomposed
into only visual arts", the PDF-parsing-failure case, and the `analyze_content` / `analyze_document`
naming collision. Whether those echo real items or just reflect authors converging on canonical
anti-patterns, they are now too widely circulated to reskin. **Use them as topic markers, not
templates** — test conflicting-source reconciliation with a different scenario.

---

## Priority 1 — objectives with zero or near-zero coverage

### Objective 13 · Claude Code review configurations — **0 questions**
The clearest gap in the bank, and the area a 2026-09-07 test-taker reported as heavily represented.
Target **6–8 questions** on how Claude is *invoked* in a pipeline, not what it does once running:

- `-p` / `--print` as the single most-tested CI detail — omitting it hangs the job waiting for input.
  This framing appears independently in at least three sources.
- `--output-format json` and `--json-schema` so findings become inline PR comments with
  file/line/severity/fix, rather than prose a human must transcribe.
- The non-interactive flag surface: `--max-turns`, `--max-budget-usd`, `--bare`,
  `--no-session-persistence`, `--fallback-model`, `--permission-mode`, `--permission-prompt-tool`
  (delegating approvals to an MCP tool headlessly), `--setting-sources`, `--agent` / `--agents`.
- Restricting tool access for unattended runs rather than skipping permissions wholesale.
- Loading project standards so a review applies team conventions — and reducing false positives by
  supplying accepted patterns as persistent context.
- Managed integrations beyond hand-rolled CLI calls: the `claude-code-action` GitHub Action, GitLab
  CI/CD, zero-workflow-file GitHub Code Review, cloud-scheduled Routines.
- Avoiding duplicate PR comments across re-runs — pass prior findings, ask for new issues only.
- Sync review (pre-merge, blocking) versus Batch (overnight, 50% cheaper, no multi-turn tool loop).

### Objective 21 · Context window optimization — **2 questions**
Target **4–5 questions**. Good angles the survey surfaced:

- **1M-token windows are not free.** Cost scales, and lost-in-the-middle gets *worse* with length —
  so "use the bigger window" is a strong distractor, not an answer.
- **Re-baseline token budgets.** A tokenizer shift starting at Opus 4.7 means thresholds calibrated on
  an older model are wrong; measure with `messages.count_tokens`, not `tiktoken` or a stale figure.
- **Case Facts Block.** Pull exact transactional values — IDs, dates, dollar amounts — into a
  structured block that survives `/compact`. Progressive summarisation is exactly where "$149.99"
  silently becomes "about $150".
- **Lost-in-the-middle mitigation**: front-load key findings, explicit section headers, bookend
  critical content. A "where in the input should this go" item type.
- Sliding windows, structured state objects and selective retention as named alternatives with
  different failure modes.

### Objective 22 · Human review routing — **2 questions**
Target **3 questions**. Routing by confidence score, document characteristics and field-level
ambiguity rather than random sampling — and the calibration trap: a self-reported confidence value is
a generated token, not a probability, so the threshold must be measured against labelled outcomes
first. Explicit criteria plus few-shot beats self-reported confidence, sentiment analysis (sentiment
is not complexity), or a separately-trained classifier (over-engineered as a first response).

---

## Priority 2 — coverage exists but misses the exam's angle

### Objective 18 · Subagent output schemas — **9 questions, still scored 0%**
A quality gap, not a quantity one. The existing questions ask *whether* citations should exist; the
exam asked **which output format best serves downstream synthesis** — structured data vs prose vs
citation metadata. The survey found this thin everywhere, which makes it a genuine origination
opportunity rather than a catch-up:

- How a subagent should structure output — e.g. tagged claims carrying source and confidence — so a
  coordinator can **programmatically reconcile** rather than re-read prose.
- When a synthesis step needs mid-flight verification: batching simple fact-checks locally versus
  round-tripping each through the coordinator. Round-trip overhead against reliability.
- Multi-agent error propagation: structure a partial-failure report so the coordinator can distinguish
  **"no results because none exist"** from **"no results because it errored"**, and decide
  retry/skip/degrade per source rather than failing the whole task.
- Preserving source-level uncertainty — annotate conflicting values with attribution and defer
  reconciliation upward, never silently pick one by heuristic.

### Objective 33 · Tool distribution across subagents — **4 questions, scored 50%**
Target **2–3 more**, framed as judgment rather than the 4–5 tool rule of thumb: which tools each role
actually needs, what breaks when an agent can reach out of role, and why the fix is partitioning
rather than a longer prompt.

---

## Priority 3 — scenario rebalancing

Themes are drawn 4-of-6, so parity across 191 questions is roughly 32 each. Current spread:

| Scenario theme | Questions | vs parity |
|---|---|---|
| Customer Support Resolution Agent | 52 | +20 |
| Multi-Agent Research System | 40 | +8 |
| Code Generation with Claude Code | 36 | +4 |
| Developer Productivity with Claude | 27 | −5 |
| Structured Data Extraction | 26 | −6 |
| **Claude Code for Continuous Integration** | **10** | **−22** |

New CI/CD questions should carry the `Claude Code for Continuous Integration` scenario. Customer
Support needs no additions — and notably did not appear at all on the 2026-09-07 sitting.

---

## Priority 4 — accuracy refresh on existing questions

The survey flagged current-platform details our material predates. These are *currency* notes for
authors, not exam answers — the exam is pinned to Exam Guide v1.0, July 2026:

- The **Agent tool was renamed from Task**; older material, including the exam guide's own wording,
  may still say "Task".
- A **refusal is HTTP 200** with `stop_reason: "refusal"` and a `stop_details.category` — code that
  reads `content` without checking `stop_reason` mishandles it silently.
- The hook lifecycle now includes an **`mcp_tool` hook type**.
- Legacy **prefill is rejected outright** on current-generation models when it is the final message.

---

## Tracking

When a question is added, update the coverage counts in `docs/exam-objectives.md` (regenerate rather
than hand-edit) and run:

```bash
uv run python scripts/validate_bank.py
```
