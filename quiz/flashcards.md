# Flashcards — Claude Certified Architect Foundations

Study these as rapid-fire Q&A. Cover the answer, test yourself, then reveal.

---

## Agentic Architecture & Agent SDK

**Q: What is the correct loop termination signal in the Agent SDK?**
A: `ResultMessage` — NOT stop_reason text parsing, NOT iteration counting, NOT assistant message content.

**Q: What drives agentic loop termination?**
A: `stop_reason` — continue on `"tool_use"`, stop on `"end_turn"`

**Q: Name 3 anti-patterns for loop termination.**
A: (1) Parsing natural language signals, (2) Arbitrary iteration caps as primary mechanism, (3) Checking for assistant text content

**Q: Do subagents inherit the coordinator's conversation history?**
A: NO. Context must be explicitly provided in the subagent's prompt.

**Q: How do you spawn parallel subagents?**
A: Emit multiple Task tool calls in a SINGLE coordinator response.

**Q: What must be in coordinator's allowedTools to spawn subagents?**
A: `"Task"`

**Q: Hooks vs prompt instructions — when to use hooks?**
A: When compliance must be guaranteed (financial, identity, security). Hooks = deterministic. Prompts = probabilistic.

**Q: What is PostToolUse hook used for?**
A: Data normalization — intercepting tool results AFTER execution but BEFORE the model processes them.

**Q: What is a pre-tool-call hook used for?**
A: Compliance enforcement — blocking tool calls that violate business rules BEFORE they execute.

**Q: Prompt chaining vs dynamic decomposition?**
A: Prompt chaining = predictable multi-step reviews. Dynamic = open-ended investigation where subtasks emerge from discoveries.

**Q: When to use fork_session?**
A: To explore divergent approaches from a shared analysis baseline (e.g., comparing two strategies).

**Q: What are the 3 session continuation modes in the SDK?**
A: `resume="id"` (specific session), `continue_conversation=True` (most recent), `resume + fork_session=True` (branch with new ID).

**Q: What does pause_turn stop_reason mean?**
A: Server-side agent loop hit its iteration limit (default 10). Re-submit empty query to continue.

**Q: Name the key hook events in the Agent SDK.**
A: PreToolUse (block/modify before), PostToolUse (normalize after), SubagentStart (inject context), Stop (cleanup), UserPromptSubmit (input validation).

**Q: What does `updatedMCPToolOutput` do in a PostToolUse hook?**
A: Replaces the raw tool output that Claude sees with normalized data.

**Q: What does `continue_: False` do in a hook return?**
A: Halts execution. The agent stops. Use with `stopReason` to explain why.

**Q: What field name quirk exists in Python SDK hooks?**
A: Use `continue_` (trailing underscore) in Python. SDK converts to `continue` for the CLI.

**Q: How do you set a spending cap on an agent?**
A: `max_budget_usd=5.0` in `ClaudeAgentOptions`.

**Q: What are the permission_mode options?**
A: `"default"`, `"acceptEdits"`, `"plan"`, `"bypassPermissions"`

---

## MCP

**Q: Resources vs Tools — what's the control model?**
A: Resources = application-controlled (read-only data). Tools = model-controlled (actions with side effects).

**Q: Where does isError go — the error field or the result field?**
A: The `result` field with `isError: true`. Protocol errors go in `error`. Tool execution errors go in `result`.

**Q: Name the 3 error categories and their retryability.**
A: transient (retryable), validation (not retryable), permission (not retryable)

**Q: What are the default values for destructiveHint and openWorldHint?**
A: Both default to `true` (assume worst case).

**Q: What's the max recommended tools per agent?**
A: 4-5 tools. 18+ degrades selection reliability significantly.

**Q: .mcp.json vs ~/.claude.json — which is shared with the team?**
A: `.mcp.json` (project scope, git-tracked). `~/.claude.json` is personal.

**Q: What's the env var syntax for default values in .mcp.json?**
A: `${VAR:-default}` — uses default if VAR is unset.

**Q: MCP server scope precedence?**
A: local > project > user

**Q: When should you use community MCP servers?**
A: Standard integrations (GitHub, Jira, Slack). Custom for proprietary/niche/regulated systems.

**Q: Give 3 examples of when to use MCP resources.**
A: Content catalogs, documentation hierarchies, database schemas (expose schema as resource, query as tool).

---

## Claude Code Configuration

**Q: CLAUDE.md hierarchy — 3 levels?**
A: User (`~/.claude/CLAUDE.md`), Project (`.claude/CLAUDE.md` or root), Directory (subdirectory CLAUDE.md)

**Q: Which CLAUDE.md level is NOT shared via version control?**
A: User-level (`~/.claude/CLAUDE.md`)

**Q: Where do project-scoped slash commands go?**
A: `.claude/commands/` (shared via git). Personal in `~/.claude/commands/`.

**Q: What does `context: fork` do in skill frontmatter?**
A: Runs skill in isolated sub-agent context, preventing output from polluting main conversation.

**Q: Path-specific rules vs directory CLAUDE.md — when to use rules?**
A: When conventions apply to files SPREAD across the codebase (e.g., test files next to source files).

**Q: What flag runs Claude Code in non-interactive mode?**
A: `-p` (or `--print`)

**Q: Structured output in CI?**
A: `--output-format json --json-schema schema.json`

**Q: Plan mode vs direct execution — one-sentence rule?**
A: Plan mode for multi-file/multi-approach/architectural decisions. Direct for single-file, clear-scope changes.

---

## Prompt Engineering & Structured Output

**Q: What does tool_use guarantee and NOT guarantee?**
A: Guarantees JSON schema compliance (syntax). Does NOT guarantee semantic correctness (values may be wrong/hallucinated).

**Q: tool_choice "any" vs "auto"?**
A: `"any"` = must call a tool (chooses which). `"auto"` = may skip tools entirely.

**Q: How to force a specific tool to be called?**
A: `tool_choice: {"type": "tool", "name": "extract_metadata"}`

**Q: How to prevent hallucination for optional fields?**
A: Make them nullable: `"type": ["string", "null"]`. Don't require fields that may be absent in source.

**Q: Batch API — 3 key numbers?**
A: 50% cost savings, 24-hour max processing, 10,000 max requests per batch.

**Q: When is Batch API inappropriate?**
A: Blocking workflows (pre-merge checks). Also doesn't support multi-turn tool calling.

**Q: Self-review vs independent review?**
A: Independent review instance (without generator's reasoning context) is MORE effective at catching issues.

**Q: Few-shot examples — when most valuable?**
A: Ambiguous scenarios, varied document structures, reducing false positives, ensuring consistent output format.

---

## Context Management & Reliability

**Q: What is the "lost in the middle" effect?**
A: Models reliably process beginning and end of long inputs but may omit findings from middle sections.

**Q: How to mitigate lost-in-the-middle?**
A: Place key summaries at BEGINNING. Use explicit section headers. Don't bury critical info in the middle.

**Q: What is a "case facts" block?**
A: Extracted transactional facts (amounts, dates, order numbers) persisted OUTSIDE summarized history, included in each prompt.

**Q: When should an agent escalate to human IMMEDIATELY?**
A: When customer EXPLICITLY requests a human. No investigation first.

**Q: Self-reported confidence scores — reliable for escalation?**
A: NO. LLMs are poorly calibrated — confidently wrong on hard cases. Use explicit criteria instead.

**Q: What's wrong with generic error statuses like "search unavailable"?**
A: Hides valuable context. Coordinator can't make intelligent recovery decisions. Include failure type, what was attempted, partial results, alternatives.

**Q: Scratchpad files — what are they for?**
A: Persisting key findings across context boundaries during long codebase exploration sessions.

**Q: /compact — when to use?**
A: Extended exploration sessions when context fills with verbose discovery output.

**Q: Claim-source mappings — why?**
A: Preserve attribution through synthesis. Without them, source information is lost when findings are summarized.
