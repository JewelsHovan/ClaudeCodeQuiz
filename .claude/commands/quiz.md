Quiz me on the Claude Certified Architect - Foundations exam.

**FIRST**: Read `profile/learner.md` — especially the **Concept Mastery & Spaced Repetition** table and the **Mistake Log**. Prioritize concepts that are **due/overdue** (Next Due ≤ today) and those in **Box 1–2**, then fill in with weak domains. Still sample some strengths so the session stays mixed.

Also read `profile/session-log.md` to avoid repeating concepts I've already mastered, and to re-test concepts I previously got wrong.

Read the study materials from `docs/` and `quiz/` in this project to understand the exam content. The structured question bank lives in `quiz/bank/*.json` (100+ tagged questions) — prefer pulling from there (filter by `domain`, `tags`, `scenario`, `difficulty`) so you can target my exact weak concepts.

Then run an interactive quiz session:

1. Ask me which domain to focus on (or "all" for mixed):
   - Domain 1: Agentic Architecture & Orchestration (27%)
   - Domain 2: Tool Design & MCP Integration (18%)
   - Domain 3: Claude Code Configuration & Workflows (20%)
   - Domain 4: Prompt Engineering & Structured Output (20%)
   - Domain 5: Context Management & Reliability (15%)

2. Present ONE scenario-based multiple choice question at a time (4 options A-D)

3. Wait for my answer before revealing:
   - Whether I got it right
   - The correct answer with a concise explanation
   - Why the wrong answers are wrong (the distractors)

4. Track my score as we go (show running tally: "3/5 correct")

5. After each answer, ask if I want another question or to stop

Draw questions from `quiz/bank/*.json` (the canonical tagged bank), plus `quiz/practice-questions.md` and `quiz/scenario-questions.md`, AND generate new original questions based on the domain study guides in `docs/`. Prioritize concepts that are due in the spaced-repetition table and ones I've previously missed. Generate NEW questions I haven't seen where possible.

For wrong answers, note the specific concept I missed so I can review it — these feed the spaced-repetition box demotions and Mistake Log when I run `/save-progress`.

When I'm ready for a full timed simulation rather than a drill, point me to `/mock-exam`.

**IMPORTANT**: When the session ends (user says stop, or after 10+ questions), remind the user to run `/save-progress` to update their learner profile.
