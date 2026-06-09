# Claude Certified Architect — Foundations Exam Prep

This project is Julien's personalized study environment for the Claude Certified Architect - Foundations certification exam.

## Project Structure
- `docs/` — Domain-by-domain study guides and reference materials
- `quiz/` — Practice questions, flashcards, and the structured question bank (`quiz/bank/*.json`)
- `mock-exams/` — Timed HTML exam generator (`generate_exam.py`); `attempts/` output is gitignored
- `profile/` — Personal learner profile (gitignored); `profile-template/` is the committed blank
- `.claude-plans/` — Implementation plans (ephemeral, gitignored)

## Key Study Files
- `docs/exam-cheat-sheet.md` — Quick reference with numbers, decision trees, anti-patterns, 2026 currency
- `docs/exam-research-2026.md` — Cited research: confirmed blueprint, what changed since launch, resources
- `docs/tips-from-passers.md` — How-to-pass guide: gotchas, time management, study plan
- `docs/mcp-deep-dive.md` — Deep dive on MCP (Julien's focus area)
- `docs/agent-sdk-deep-dive.md` — Agent SDK code patterns, hooks, sessions
- `docs/domain1-agentic-architecture-orchestration.md` — Domain 1 (27% of exam)
- `docs/domain2-tool-design-mcp-integration.md` — Domain 2 (18% of exam)
- `docs/domain3-claude-code-config-workflows.md` — Domain 3 (20% of exam)
- `docs/domain4-prompt-engineering-structured-output.md` — Domain 4 (20% of exam)
- `docs/domain5-context-management-reliability.md` — Domain 5 (15% of exam)
- `quiz/bank/*.json` — 100+ tagged, exam-accurate questions (domain/scenario/difficulty) — powers `/mock-exam`
- `quiz/practice-questions.md` / `quiz/scenario-questions.md` / `quiz/flashcards.md` — readable practice sets
- `profile/learner.md` — Persistent learner profile (now incl. spaced-repetition memory + mistake log)
- `profile/session-log.md` — Study session history with scores and coach notes

## Commands
`/setup` `/study [topic]` `/quiz` `/flashcards` `/weak-spots` `/learn-doc [topic]` `/mock-exam` `/cheat-sheet` `/save-progress`
- `/mock-exam` runs `uv run python mock-exams/generate_exam.py` → standalone timed HTML exam, then opens it.
- `/learn-doc` fills `learn-docs/template.html` with content authored from `docs/` → a shareable HTML study guide
  (diagrams via Mermaid, callouts, self-check). Writes to `learn-docs/generated/` (gitignored) or the committed root for samples.

## Learner Profile System
- `profile/learner.md` — strengths, weak areas, domain confidence, **Concept Mastery & Spaced Repetition
  (Leitner box) table**, **Mistake Log** (root causes), and **Mock Exam History**
- `profile/session-log.md` — history of all study sessions with scores and coach notes
- All slash commands read the profile first to personalize the experience
- `/save-progress` (run at end of every session, or after a `/mock-exam`) updates confidence, moves
  concepts up/down their boxes, logs why answers were missed, and records mock-exam scores
- The repo is **shareable**: `profile/` is gitignored so each teammate keeps their own progress

## Julien's Profile (Quick Reference)
- Solution architect, strong at building with Claude; expert at Claude Code configuration
- Studying MCP and Agent SDK patterns more deeply; Domain 1 (27%) is untested — needs a timed mock
- See `profile/learner.md` for full detail and current confidence levels

## Exam Blueprint (confirmed mid-2026 — community-sourced, see exam-research-2026.md)
- 60 single-select multiple-choice questions · 120 minutes · **720/1000 scaled** to pass · online-proctored
- Questions wrapped in scenarios; **4 of 6** scenario themes drawn at random per exam
- Cost / validity / prerequisites are **unconfirmed** — do not state them as fact

## Exam Domains & Weights
1. Agentic Architecture & Orchestration — 27%
2. Tool Design & MCP Integration — 18%
3. Claude Code Configuration & Workflows — 20%
4. Prompt Engineering & Structured Output — 20%
5. Context Management & Reliability — 15%
