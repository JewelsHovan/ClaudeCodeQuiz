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
   - `/quiz` — Interactive quiz (adapts to your weak areas)
   - `/study [topic]` — Tutoring mode (e.g., `/study mcp`)
   - `/flashcards` — Rapid-fire drill
   - `/weak-spots` — Diagnostic assessment
   - `/cheat-sheet` — Quick reference
   - `/save-progress` — Save session learnings (run at end of every session!)

Tell them: "Your profile will evolve as you study. Run `/save-progress` at the end of each session and your next session will be smarter about what to drill you on."
