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
| `/quiz` | Interactive multiple-choice quiz, adapts to your weak areas |
| `/study [topic]` | Tutoring mode — e.g., `/study mcp`, `/study hooks`, `/study batch api` |
| `/flashcards` | Rapid-fire Q&A drill |
| `/weak-spots` | Diagnostic: 10 hard questions + readiness report |
| `/cheat-sheet` | Quick reference of key numbers, decision trees, anti-patterns |
| `/save-progress` | **Run at end of every session** — persists what you learned |

## How the Adaptive System Works

```
/setup → creates profile/learner.md (your strengths, weaknesses, progress)
   ↓
/quiz or /study or /flashcards → reads your profile → personalizes questions
   ↓
/save-progress → analyzes session → updates profile with scores, mastered/struggling concepts
   ↓
Next session → reads updated profile → targets your actual weak spots
```

Your `profile/` directory is gitignored — each person gets their own.

## Exam Overview

| Domain | Weight |
|--------|--------|
| 1. Agentic Architecture & Orchestration | 27% |
| 2. Tool Design & MCP Integration | 18% |
| 3. Claude Code Configuration & Workflows | 20% |
| 4. Prompt Engineering & Structured Output | 20% |
| 5. Context Management & Reliability | 15% |

- **Format**: Multiple choice, 4 options, 1 correct
- **Passing score**: 720 / 1000
- **Scenarios**: 4 of 6 randomly selected per exam

## Study Materials

All in `docs/`:
- **Domain guides** — one per exam domain with key concepts, patterns, and exam traps
- **`exam-cheat-sheet.md`** — all key numbers, decision trees, anti-patterns on one page
- **`mcp-deep-dive.md`** — deep dive on MCP architecture, tools, resources, error handling
- **`agent-sdk-deep-dive.md`** — Agent SDK code patterns, hooks, sessions

Practice in `quiz/`:
- **`practice-questions.md`** — 20 questions across all domains with explanations
- **`scenario-questions.md`** — 12 scenario-based questions matching exam format
- **`flashcards.md`** — ~50 rapid-fire Q&A flashcards

## Recommended Study Order

1. `/weak-spots` — find out where you stand
2. `/study` on your weakest domain
3. `/quiz` to test retention
4. `/flashcards` for rapid review
5. `/cheat-sheet` before the exam
