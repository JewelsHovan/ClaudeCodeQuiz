# Tips From Passers — How to Pass the Claude Certified Architect (Foundations)

> Practical "how to pass" guide distilled from research on people who took the exam, plus a
> concrete, repo-keyed study plan. Grounded in `docs/exam-research-2026.md` (compiled 2026-06-08).
> Read that report for citations and confidence levels. **Public first-hand passer accounts are
> limited** — much of "what passers say" below rests on one verified account (Kishor Kukreja,
> 893/1000) plus strong cross-source consensus. Re-verify currency before you sit.

---

## 1. Snapshot — the confirmed blueprint

| Fact | Value |
|------|-------|
| Questions | **60**, single-select multiple choice (1 correct + 3 distractors) |
| Time | **120 minutes** (~**2 min/question**) |
| Passing score | **720 / 1000** — scaled score, *not* a percentage |
| Structure | Questions wrapped in **4 scenarios drawn at random from a pool of 6** |
| Delivery | Online-proctored, **closed-book**, via Skilljar |
| Launched | March 12, 2026 |
| Cost / validity / prerequisites | **Unconfirmed** — see Caveats (§7) |

**Domain weights (study-time priority follows the weights):**

| # | Domain | Weight | Priority |
|---|--------|--------|----------|
| 1 | Agentic Architecture & Orchestration | **27%** | Heaviest — study first, study hard |
| 2 | Claude Code Configuration & Workflows | **20%** | |
| 3 | Prompt Engineering & Structured Output | **20%** | |
| 4 | Tool Design & MCP Integration | **18%** | |
| 5 | Context Management & Reliability | **15%** | Smallest, still ~9 questions |

> ~720/1000 scaled ≈ you cannot afford to punt a whole domain. Even the 15% domain is roughly
> 9 questions — enough to fail you if you skip it.

---

## 2. What people who passed say

Distilled, actionable takeaways. Where a point comes from the one verified first-hand account,
it's attributed to **Kishor Kukreja (893/1000)**; the rest is cross-source consensus.

- **Trust the published weights — they hold on the real exam.** Kukreja's first-hand account
  confirms exam emphasis tracks the 27/20/20/18/15 blueprint. So **front-load Agentic
  Architecture (27%)**; it's the single biggest lever on your score.
- **Prepare for all 6 scenario themes — you can't predict your 4.** You get a random 4-of-6:
  *Customer Support Resolution Agent, Code Generation with Claude Code, Multi-Agent Research
  System, Developer Productivity, Claude Code for CI, Structured Data Extraction.* A theme you
  skipped could be one of your four. Drill every theme to baseline.
- **Expect "best answer among plausible options," not trick recall.** Several options will be
  *reasonable*; one is *best practice* for the stated constraints. The skill is ranking good vs.
  better, not spotting an obviously wrong answer.
- **Read the scenario constraints, not just the question.** The deciding detail is usually in the
  scenario framing: "must never violate policy," "results aren't blocking," "data is sometimes
  absent." The right answer changes with the constraint.
- **Know the commonly-confused distinctions cold.** These are where the suboptimal distractors
  live:
  | You'll be tested on telling apart… | The discriminator |
  |---|---|
  | **Slash commands vs. Skills** | Commands = user-invoked prompt shortcuts; Skills = model-invoked capabilities (frontmatter: `context: fork`, `allowed-tools`) |
  | **`tool_use` vs. few-shot examples** | `tool_use` = structured, machine-parseable, deterministic schema; few-shot = probabilistic shaping of free text |
  | **Explicit vs. implicit escalation** | Explicit = defined rules/prerequisite gates; implicit = sentiment/confidence guesses (an anti-pattern) |
  | **MCP Resources vs. Tools** | Resource = model READS data (static/semi-static); Tool = model PERFORMS an action (side effects) |
- **It's closed-book.** No docs, no this cheat sheet during the exam. Internalize the numbers and
  decision trees in `docs/exam-cheat-sheet.md` until they're reflexes.
- **Honesty check:** beyond Kukreja, public write-ups are thin. Treat secondhand "tips" blogs as
  directional, not gospel — the blueprint and the verified passer are the solid ground.

---

## 3. Time management

You have **120 minutes for 60 questions = ~2 minutes each.** That's comfortable *if* you don't
stall.

- **Budget per scenario, not just per question.** 4 scenarios × ~15 questions ≈ **~30 min per
  scenario**. Glance at the clock at each scenario boundary; if you've burned 35+ min on one,
  speed up.
- **Flag and return.** If a question isn't obvious in ~90 seconds, pick your best guess, flag it,
  and move on. Unanswered questions score zero — never leave a flag unanswered at the end. Bank
  the easy points first, then spend leftover time on flags.
- **Don't overthink the scenario framing.** The narrative ("the team is frustrated…") is dressing.
  Extract the *constraint* (determinism required? non-blocking? least privilege?) and answer to
  that. Don't invent requirements the scenario didn't state.
- **First instinct on best-practice questions.** When you've studied the pattern, your first read
  is usually right. Re-reading invites talking yourself into a plausible distractor.
- **Reserve the last ~10 minutes** to clear flags and confirm nothing is blank.

---

## 4. Common gotchas / traps

The exam is built on **reasonable-but-suboptimal distractors.** Internalize these patterns and
most traps collapse:

- **Deterministic over probabilistic when determinism is required.** If the scenario says a rule
  must *never* be violated (financial, identity, security, compliance), the answer is a
  **deterministic mechanism — hooks, prerequisite gates, structured output / `tool_use` schema —
  not** "add an instruction to the system prompt" or "give a few-shot example." Prompt
  instructions are probabilistic; they're the trap option here.
  - Inverse trap: if there's *no* hard guarantee needed, the heavyweight hook is over-engineering —
    a prompt instruction is the better (lower-effort) answer.
- **Least privilege.** Prefer the option that grants the **narrowest** tool access / scope /
  permission that still does the job. "Give the agent admin / all tools" is almost always the
  distractor. (Also: 4–5 tools max for reliable selection; 18+ degrades it.)
- **Nullable fields for extraction.** For structured data extraction, **make fields that may be
  absent nullable / optional.** Requiring a non-nullable field when data is sometimes missing
  *drives hallucination* — the model invents a value. That's a classic wrong answer dressed up as
  "strict schema = good."
- **Graceful degradation over hard-fail.** In multi-agent / pipeline scenarios, prefer **isolate
  the failure and continue** (partial results, retry-with-feedback, fallback) over **terminate the
  whole workflow on one subagent's failure.** Silently swallowing errors (empty result = success)
  is *also* wrong — degrade gracefully *and* surface the error.
- **Explicit escalation over inferred signals.** Escalate on **defined rules / prerequisite
  checks**, not **self-reported confidence** or **sentiment analysis** (poorly calibrated, don't
  correlate with complexity).
- **Provenance & position.** Prefer structured claim→source mappings over "the model will cite
  sources"; put key info at the **beginning** of context, not buried in the middle.

> Pattern to memorize: when two options both "work," pick the one that is **deterministic,
> least-privilege, fails gracefully, and matches the scenario's stated constraint.**

---

## 5. A study plan (keyed to this repo)

Weighted by domain importance. Repo resources: `docs/domainN-*.md`, the deep-dives
(`mcp-deep-dive.md`, `agent-sdk-deep-dive.md`), `docs/exam-cheat-sheet.md`, the quiz banks
(`quiz/practice-questions.md`, `quiz/scenario-questions.md`, `quiz/flashcards.md`,
`quiz/bank/*.json`), and the slash commands `/study`, `/quiz`, `/weak-spots`, `/flashcards`,
`/cheat-sheet`, `/save-progress`.

### Ordering by weight (spend study time roughly in proportion)

| Order | Focus | Repo resource | Why |
|-------|-------|---------------|-----|
| 1 | **Agentic Architecture (27%)** | `docs/domain1-*.md` + `agent-sdk-deep-dive.md` | Biggest domain; orchestration, loops, escalation, multi-agent |
| 2 | **Claude Code Config (20%)** | `docs/domain3-*.md` | Commands vs skills, hooks, CLAUDE.md hierarchy, CI (`-p`) |
| 3 | **Prompt Eng & Structured Output (20%)** | `docs/domain4-*.md` | `tool_use`, nullable schemas, position-aware prompting |
| 4 | **Tool Design & MCP (18%)** | `docs/domain2-*.md` + `mcp-deep-dive.md` | Resources vs tools, scopes, least privilege, community vs custom |
| 5 | **Context & Reliability (15%)** | `docs/domain5-*.md` | Compaction, scratchpads, error categories, graceful degradation |

> Note: this repo's *file numbering* (domain2 = MCP, domain3 = Claude Code) differs from the
> blueprint *weight* order above — the weights are what matter; file names are just labels.

### Weekly rhythm (suggested ~2–3 weeks out)

1. **Read the domain doc**, then **drill its quiz bank** (`/quiz` filtered to that domain, or the
   `quiz/bank/domainN.json` items).
2. **Run `/weak-spots`** after each domain to see where you're leaking points; loop back.
3. **`/flashcards`** daily for the numbers and distinctions (closed-book = these must be reflex).
4. **`/study`** for guided, profile-aware sessions; **`/save-progress`** at the end of every
   session so the profile tracks your trend.

### Calibrate with a timed full-length run

Take a **timed, 60-question, 4-scenario mock under real conditions** — 120-minute clock, no docs
open. Use `/quiz` in a full-length, scenario-mixed mode (a `/mock-exam` mode if your env exposes
one; otherwise chain `quiz/scenario-questions.md` + `quiz/practice-questions.md` to ~60 items and
set a timer). Score it against 720/1000-equivalent, then send the misses to `/weak-spots`. Do this
at least once mid-study and once in the final week.

### Final week

- One **full timed mock**; review *every* miss until you can explain why the right answer beats the
  distractor.
- **`/weak-spots`** → spend the week's remaining time only on red domains.
- Re-read `docs/exam-cheat-sheet.md` decision trees daily; they encode the trap logic in §4.
- Confirm you can recite the **6 scenario themes** and the **4 commonly-confused distinctions**
  cold.

### Day before

- Light review only — flashcards + cheat-sheet skim. No cramming new material.
- **Re-verify currency** (model lineup, Claude Code features — see Caveats).
- Confirm **Skilljar logistics**: working webcam/mic, quiet room, ID ready, stable connection,
  proctoring requirements met. Closed-book means clear your desk.
- Sleep. ~2 min/question rewards a calm, rested read of each scenario.

---

## 6. Canonical resources (primary first)

From `docs/exam-research-2026.md`:

- **Anthropic docs (primary):**
  - `platform.claude.com/docs` — Claude Developer Platform, prompt engineering, models,
    model-deprecations.
  - `code.claude.com/docs` — Claude Code config, plugins, hooks, changelog (moves weekly).
  - **Agent SDK docs** and the **Model Context Protocol spec**.
- **Anthropic learning:** `anthropic.com/learn` (courses + certificates). *Note:*
  `anthropic.com/academy` 404s — the live page is `/learn`.
- **Official exam guide (gated):**
  `anthropic.skilljar.com/claude-certified-architect-foundations-access-request`.
- **Community study guide:** `github.com/daronyondem/claude-architect-exam-guide` — strongest
  community guide, explicitly **NDA-clean** ("no exam questions included, paraphrased, or
  hinted"); teaches 11 knowledge areas mapping onto the 5 domains.
- **Verified passer write-up:** Kishor Kukreja's Medium post (893/1000) — confirms the blueprint
  and weight emphasis.

> ⚠️ Real exam questions are under NDA. This repo's `quiz/` items are **original, exam-accurate
> practice** matched to the blueprint — never reproductions. Never assume any practice item is an
> actual exam question.

---

## 7. Caveats (read before you book)

- **No public Anthropic blueprint exists.** The weights and format are established by strong
  cross-source consensus + one hosted copy of the gated official PDF — authoritative-by-consensus,
  not a citable Anthropic URL.
- **Cost is UNCONFIRMED.** "$99" and "free for first 5,000 partners" were both *refuted*. Do not
  assume a price — check Skilljar at registration.
- **Validity period UNCONFIRMED.** "2 years" was *refuted*. Don't assume how long the cert lasts.
- **Prerequisites UNCONFIRMED.** "6 months production experience" was *refuted*; whether any
  prerequisite exists at all is unknown.
- **Content currency is time-sensitive.** As of mid-2026: **Claude Opus 4.8** is flagship; **Opus
  4.1 retires August 5, 2026** (migrate to 4.8). Claude Code's changelog moves weekly. **Re-verify
  the model lineup and current Claude Code features before each sitting** via the primary docs in
  §6.
