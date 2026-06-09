Set up a fresh learner profile for the Claude Certified Architect exam prep.

Check if `profile/learner.md` already exists.

**If it already exists**: Tell the user their profile is already set up and show a summary of their current state (confidence levels, session count). Ask if they want to reset it (copy fresh from template) or keep it.

**If it doesn't exist**:
1. Copy `profile-template/learner.md` to `profile/learner.md`
2. Copy `profile-template/session-log.md` to `profile/session-log.md`
3. Ask the user a few quick questions to personalize their profile:
   - What's your role? (e.g., solution architect, backend engineer, full-stack dev)
   - How long have you been building with Claude?
   - What are you already strong at? (Claude Code config, API design, prompt engineering, etc.)
   - What do you need to study most? (MCP, Agent SDK, structured output, etc.)
4. Update `profile/learner.md` with their answers
5. Show them the available commands:
   - `/quiz` — Interactive quiz (adapts to your weak areas + spaced-repetition due list)
   - `/study [topic]` — Tutoring mode (e.g., `/study mcp`)
   - `/flashcards` — Rapid-fire drill
   - `/weak-spots` — Diagnostic assessment + readiness report
   - `/mock-exam` — **Timed, interactive HTML exam** (60 Q / 120 min, scored vs 720/1000 with pass estimate)
   - `/cheat-sheet` — Quick reference
   - `/save-progress` — Save session learnings (run at end of every session!)

Tell them: "Your profile evolves as you study. It tracks each concept in a **spaced-repetition** box system (miss it → it resurfaces next session; nail it repeatedly → it fades out) and keeps a **mistake log** of *why* you missed things. Run `/save-progress` at the end of each session — or after a `/mock-exam` (paste the results JSON) — and your next session targets exactly what you're weak on. When you feel ready, take a full timed `/mock-exam` to calibrate against the real 720/1000 bar."
