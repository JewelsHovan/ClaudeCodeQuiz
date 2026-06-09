# Claude Certified Architect — Foundations Exam Prep

Interactive study environment for the Claude Certified Architect - Foundations certification. Uses Claude Code as a personalized tutor that adapts to your strengths and weaknesses over time.

## Quick Start

```bash
# 1. Clone the repo
git clone <repo-url>
cd ClaudeCodeQuiz

# 2. Open Claude Code
claude

# 3. Set up your learner profile
/setup
```

That's it. The `/setup` command creates your personal profile and walks you through the rest.

## Commands

| Command | What It Does |
|---------|-------------|
| `/setup` | Create your learner profile (run once) |
| `/quiz` | Interactive quiz — adapts to weak areas + your spaced-repetition due list |
| `/study [topic]` | Tutoring mode — e.g., `/study mcp`, `/study hooks`, `/study batch api` |
| `/flashcards` | Rapid-fire Q&A drill |
| `/weak-spots` | Diagnostic: hard questions per domain + readiness report |
| `/mock-exam` | **Timed interactive HTML exam** — 60 Q / 120 min, scored vs 720/1000 + pass estimate |
| `/cheat-sheet` | Quick reference of key numbers, decision trees, anti-patterns |
| `/save-progress` | **Run at end of every session** — persists what you learned |

`/mock-exam` accepts arguments: `/mock-exam quick` (20 Q), `/mock-exam domain 1` (single-domain),
`/mock-exam 40`, `/mock-exam seed 7`. It writes a self-contained HTML file you take in your browser
(in-page timer, auto-scoring, per-domain breakdown, full answer review), then feeds the result back
into your profile via `/save-progress`.

## How the Adaptive System Works

```
/setup → creates profile/learner.md (strengths, weaknesses, spaced-repetition memory, mistake log)
   ↓
/quiz · /study · /flashcards · /mock-exam → read your profile → personalize to your weak spots
   ↓
/save-progress → updates Domain Confidence, moves each concept up/down its Leitner box,
                 logs WHY you missed things, records mock-exam scores
   ↓
Next session → surfaces overdue + low-box concepts first → drills exactly what you're weak on
```

**Spaced repetition + mistake log:** every concept lives in a Leitner box (1–5). Miss it and it
drops to Box 1 (resurfaces next session); answer it right repeatedly and it fades out. The mistake
log captures the *root cause* of each miss, not just the score.

Your `profile/` directory is gitignored — each person on the team gets their own. The question banks,
docs, mock exam, and commands are shared.

## Exam Overview

| Domain | Weight |
|--------|--------|
| 1. Agentic Architecture & Orchestration | 27% |
| 2. Tool Design & MCP Integration | 18% |
| 3. Claude Code Configuration & Workflows | 20% |
| 4. Prompt Engineering & Structured Output | 20% |
| 5. Context Management & Reliability | 15% |

- **Format**: 60 single-select multiple choice (1 correct + 3 distractors), 120 minutes
- **Passing score**: 720 / 1000 (scaled, not a percentage)
- **Scenarios**: questions are wrapped in scenarios — you get **4 of 6** drawn at random per exam
  (Customer Support Resolution Agent · Code Generation with Claude Code · Multi-Agent Research System ·
  Developer Productivity · Claude Code for CI · Structured Data Extraction)
- **Delivery**: online-proctored, closed-book (Skilljar)

> ℹ️ The blueprint is **community-confirmed, not Anthropic-published**, and cost/validity/prerequisites
> are unconfirmed. See `docs/exam-research-2026.md` for the full cited research and `docs/tips-from-passers.md`
> for how to pass. Re-verify currency before booking.

## Study Materials

All in `docs/`:
- **Domain guides** — one per exam domain with key concepts, patterns, and exam traps
- **`exam-cheat-sheet.md`** — all key numbers, decision trees, anti-patterns on one page
- **`mcp-deep-dive.md`** — deep dive on MCP architecture, tools, resources, error handling
- **`agent-sdk-deep-dive.md`** — Agent SDK code patterns, hooks, sessions
- **`exam-research-2026.md`** — cited research: confirmed blueprint, what changed, resources
- **`tips-from-passers.md`** — how-to-pass guide, gotchas, time management, study plan

Practice in `quiz/`:
- **`bank/*.json`** — 100+ tagged, exam-accurate questions (domain / scenario / difficulty) — powers `/mock-exam`
- **`practice-questions.md`** — questions across all domains with explanations
- **`scenario-questions.md`** — scenario-based questions matching exam format
- **`flashcards.md`** — rapid-fire Q&A flashcards

## Recommended Study Order

1. `/weak-spots` — find out where you stand
2. `/study` on your weakest domain (start with Agentic Architecture — it's 27%)
3. `/quiz` to test retention (hits your spaced-repetition due list)
4. `/flashcards` for rapid review
5. `/mock-exam` — full timed simulation to calibrate against 720/1000
6. `/cheat-sheet` + `docs/tips-from-passers.md` before the exam
