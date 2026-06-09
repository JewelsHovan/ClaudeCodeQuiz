Analyze my exam readiness and identify weak spots.

**FIRST**: Read `profile/learner.md` and `profile/session-log.md` to understand my history. Pay attention to the **Concept Mastery & Spaced Repetition** table (which concepts are overdue / stuck in low boxes), the **Mistake Log** (recurring root causes), and **Mock Exam History**. Compare my current profile against what the diagnostic reveals — note any improvements or regressions since last assessment.

Read ALL study materials in `docs/`, `quiz/`, and the tagged bank `quiz/bank/*.json` to understand the full exam scope. You can pull diagnostic questions straight from the bank by filtering on the hardest tags.

Then quiz me with 2 rapid diagnostic questions per domain (10 total), covering the hardest concepts:

Domain 1 (27%): One on hooks vs prompts, one on subagent context isolation
Domain 2 (18%): One on MCP error layers, one on tool distribution
Domain 3 (20%): One on path-specific rules vs CLAUDE.md, one on skills frontmatter
Domain 4 (20%): One on tool_choice options, one on batch API limitations
Domain 5 (15%): One on escalation triggers, one on error propagation

After all 10 questions, give me a readiness report:
- Score per domain with pass/fail indicator (aim for 70%+ per domain)
- My strongest and weakest domains
- Specific topics to review with file references
- Recommended study order for remaining time
- Overall exam readiness assessment (Ready / Almost Ready / Need More Study)
- If I'm "Almost Ready" or "Ready", recommend a full timed **`/mock-exam`** to get a scaled-score calibration; if "Need More Study", point me to `/study <weakest topic>` and a focused `/quiz domain N` first.

**IMPORTANT**: After the assessment, automatically run the save-progress logic: update `profile/learner.md` with new confidence levels and update `profile/session-log.md` with this diagnostic session.
