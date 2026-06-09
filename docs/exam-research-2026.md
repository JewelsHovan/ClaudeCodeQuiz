# Claude Certified Architect — Foundations: Exam Research (mid-2026)

> Cited research snapshot compiled **2026-06-08** via a multi-source, adversarially-verified
> research pass (18 sources fetched, 71 claims extracted, 25 verified, 22 confirmed, 3 refuted).
> **Read the caveats** — Anthropic publishes no public blueprint; figures below are
> community-consensus + one hosted copy of the gated official guide, not a citable Anthropic URL.

## TL;DR — what changed since this env was built (March 2026)

| Area | Status | Action taken |
|------|--------|--------------|
| Domains & weights (27/20/20/18/15) | ✅ **Confirmed unchanged** | None needed |
| 60 Q / 120 min / 720-1000 pass | ✅ **Confirmed** | None needed |
| "60 scenario questions" framing | ⚠️ **Imprecise** | Reframed: MC questions wrapped in **4-of-6 random scenarios** |
| 6 official scenario themes | 🆕 **Newly documented** | Quiz/mock-exam now cover all 6 |
| Model currency (was Opus 4.x early-2026) | 🔄 **Opus 4.8 now flagship** | Cheat sheet + docs updated |
| Claude Code features | 🔄 **New: `plugin init`, Stop hook `additionalContext`** | Domain 3 + Agent SDK docs noted |
| Cost / validity / prerequisites | ❌ **Unconfirmed (claims refuted)** | Deliberately NOT stated as fact |

## Confirmed exam blueprint

- **Launched:** March 12, 2026
- **Format:** 60 **multiple-choice** questions — each has **one correct response + three distractors**. Single-select (multi-select claim was refuted).
- **Structure:** Questions are wrapped in **scenarios**. A candidate is presented **4 scenarios drawn at random from a pool of 6**.
- **Time limit:** 120 minutes (~2 min/question)
- **Passing score:** **720 / 1000** — a **scaled score, not a percentage** (a verified passer scored 893/1000, a non-round number only possible on a scaled system)
- **Delivery:** Online-proctored, **closed-book**, via Anthropic's Skilljar platform
- **Confidence:** High (≈10 independent sources + one verified passer + a hosted copy of the gated official PDF)

### The 6 official scenario themes (pool — you get 4 at random)
1. **Customer Support Resolution Agent**
2. **Code Generation with Claude Code**
3. **Multi-Agent Research System**
4. **Developer Productivity**
5. **Claude Code for CI**
6. **Structured Data Extraction**

> Study implication: prepare for all 6; you can't predict which 4 you'll see. The env's
> scenario bank is organized around these themes.

## Domains & weights (CONFIRMED — match this env exactly)

| # | Domain | Weight |
|---|--------|--------|
| 1 | Agentic Architecture & Orchestration | **27%** |
| 2 | Claude Code Configuration & Workflows | **20%** |
| 3 | Prompt Engineering & Structured Output | **20%** |
| 4 | Tool Design & MCP Integration | **18%** |
| 5 | Context Management & Reliability | **15%** |

> Note: this env historically ordered them 1/2/3/4/5 = AgenticArch / MCP / ClaudeCode / Prompt / Context.
> The **weights are identical** regardless of ordering. Study-time priority should track the
> weights: **Agentic Architecture (27%) is the single heaviest domain** — a verified passer
> confirmed real-exam emphasis tracks the published weights.

## Content currency (study to 2026 reality)

### Models
- **Claude Opus 4.8** — current flagship (launched May 28, 2026; on Claude API, Bedrock, Vertex, Foundry)
- **Claude Opus 4.7** — active (April 16, 2026)
- **Claude Opus 4.1** — **deprecated June 5, 2026, retires August 5, 2026**; migrate to Opus 4.8
- Source: `platform.claude.com/docs/en/about-claude/model-deprecations` (primary)

### Claude Code (primary-sourced, but time-sensitive — changelog moves weekly)
- **Skill/plugin auto-loading:** `claude plugin init <name>` scaffolds a plugin; skills in
  `.claude/skills` dirs auto-load as `<name>@skills-dir` with **no marketplace or install step** (May 2026).
  Source: `code.claude.com/docs/en/plugins`
- **Stop / SubagentStop hooks** can now return `hookSpecificOutput.additionalContext` to feed
  Claude context and keep the turn going **without being labeled a hook error** (v2.1.163, June 2026;
  `additionalContext` capped at 10,000 chars). Source: `code.claude.com/docs/en/changelog`

## Practice questions & sample material

> ⚠️ **NDA:** Real exam questions are confidential. Everything below is **community practice
> material** — useful for drilling concepts, but never assume any item is an actual exam question.
> The questions in this repo's `quiz/` are **original, exam-accurate practice** written to match
> the blueprint, not reproductions of real items.

- **No official Anthropic public sample questions** were found outside the gated Skilljar portal.
- **daronyondem/claude-architect-exam-guide** (GitHub) — strongest community study guide;
  explicitly NDA-clean ("No exam questions are included, paraphrased, or hinted at"); teaches
  11 interconnected knowledge areas that map onto the 5 domains.
- **claudecertifications.com/claude-certified-architect/practice-questions** — community practice
  bank with domain filters.
- **pub.towardsai.net** — a "60-question practice exam with explanations" (community blog).
- Other community repos: `OlivierAlter/...`, `jamesbuckett/ccaf-...`, `dnacenta/claude-certified-architect`.

### daronyondem's 11 knowledge areas (useful cross-check against the 5 domains)
API fundamentals/output control · tool interface design · error handling in agent tools ·
structured data extraction · conversation context management · system prompt engineering · MCP ·
agentic patterns/multi-agent · customer service workflows · Claude Code & Agent SDK ·
evaluation/batch processing.

## Tips from people who passed

- **Kishor Kukreja** (Medium) — passed **893/1000**; first-hand account confirms the full
  blueprint (5 domains, 27/20/20/18/15, 720/1000) and that **real emphasis tracks the published
  weights** → weight study time toward the 27% Agentic Architecture domain.
- See `docs/tips-from-passers.md` for the distilled, actionable tips + study plan.

## Canonical study resources (primary first)

- **Anthropic docs** (primary): `platform.claude.com/docs` (Claude Developer Platform, prompt
  engineering, models), `code.claude.com/docs` (Claude Code — config, plugins, hooks, changelog),
  Agent SDK docs, Model Context Protocol spec.
- **Anthropic learning:** `anthropic.com/learn` (courses + certificates of completion).
  Note: `anthropic.com/academy` returns 404; the live page is `/learn`.
- **Official exam guide:** gated at
  `anthropic.skilljar.com/claude-certified-architect-foundations-access-request`.

## Caveats & open questions

- **No public Anthropic primary source** for the blueprint — established by strong cross-source
  consensus + one hosted copy of the Confidential exam-guide PDF. Treat percentages as
  authoritative-by-consensus.
- **Cost UNRESOLVED** — "$99" and "free for first 5,000 partners" both **refuted (0-3)**. Do not
  state a price.
- **Validity period UNRESOLVED** — "2 years" **refuted**.
- **Prerequisites UNRESOLVED** — "6 months production experience" **refuted**; whether any
  prerequisite exists is unknown.
- Model/tooling currency claims are primary-sourced but **time-sensitive** (Opus 4.1 retires
  Aug 5 2026; Claude Code changelog moves weekly). Re-verify before each exam sitting.

## Sources (selected)
- https://www.claudecertifiedarchitects.com/cca-exam-guide/
- https://dev.to/aws-builders/the-claude-certified-architect-exam-5-domains-6-scenarios-and-everything-you-need-to-know-4le3
- https://medium.com/@kishorkukreja/i-passed-anthropics-claude-certified-architect-foundations-exam-with-a-score-of-893-1000-2206c27efd6c
- https://github.com/daronyondem/claude-architect-exam-guide
- https://platform.claude.com/docs/en/about-claude/model-deprecations
- https://code.claude.com/docs/en/plugins
- https://code.claude.com/docs/en/changelog
- https://www.anthropic.com/learn
- https://claudecertifications.com/claude-certified-architect/practice-questions
- https://www.lowcode.agency/blog/how-to-become-claude-certified-architect
