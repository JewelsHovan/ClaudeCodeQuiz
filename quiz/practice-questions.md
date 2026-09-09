# Practice Questions — Claude Certified Architect Foundations

## Instructions
For each question, select the single best answer. Answers and explanations are at the bottom of each section.

---

## Domain 1: Agentic Architecture & Orchestration (27%)

### Q1. Agentic Loop Termination
Your agentic loop implementation checks if the assistant's response contains text content to determine when to stop looping. During testing, the agent sometimes stops prematurely when Claude provides a thinking-out-loud message alongside a tool call. What is the correct approach?

A) Treat the absence of tool_use content blocks in the response as the termination signal
B) Terminate on `stop_reason == "end_turn"`, continue on `stop_reason == "tool_use"`
C) Set a maximum iteration count and terminate the loop as soon as that count is reached
D) Parse the assistant's text to look for phrases like "I'm done" or "task complete"

**Answer: B**
The agentic loop should be driven by `stop_reason`. When `stop_reason` is `"tool_use"`, execute the requested tools and continue. When `stop_reason` is `"end_turn"`, the model has decided it's finished. Options A, C, and D are all listed anti-patterns in the exam guide: parsing text content, arbitrary iteration caps, and natural language signal detection.

---

### Q2. Subagent Context Isolation
Your coordinator agent delegates a research task to a subagent. The subagent needs findings from a previous web search subagent to perform synthesis. How should these findings reach the synthesis subagent?

A) The synthesis subagent inherits the coordinator's conversation history, which already holds the search results
B) Include the web search findings directly in the synthesis subagent's prompt when spawning it
C) Store findings in a shared memory space that both subagents read from and write to
D) Have the web search subagent write to a shared database that the synthesis subagent queries

**Answer: B**
Subagents operate with ISOLATED context — they do NOT inherit the coordinator's conversation history automatically. Context must be explicitly provided in the subagent's prompt when it is spawned. Option A contradicts the fundamental isolation principle. Options C and D add shared infrastructure, and its consistency problems, when direct prompt injection already works.

---

### Q3. Parallel Subagent Execution
You want to speed up your multi-agent research system by running the web search and document analysis subagents in parallel. How should the coordinator spawn them?

A) Emit two separate Task tool calls in consecutive turns
B) Emit multiple Task tool calls in a single coordinator response
C) Create two separate coordinator instances, each managing one subagent
D) Use threading primitives to spawn both subagents simultaneously

**Answer: B**
Parallel subagent execution is achieved by having the coordinator emit multiple Task tool calls in a SINGLE response, not across separate turns. Option A is sequential. Options C and D are unnecessary architectural complexity.

---

### Q4. Hooks vs Prompt-Based Enforcement
Your customer support agent must verify customer identity before processing any refund. In production, 8% of cases skip verification. What approach provides the strongest guarantee?

A) Add emphatic instructions to the system prompt: "You MUST ALWAYS verify customer identity before refunds"
B) Implement a PostToolUse hook that blocks `process_refund` unless `get_customer` has returned a verified ID
C) Add 5-6 few-shot examples showing the agent calling `get_customer` before every refund
D) Implement a pre-tool-call hook that blocks `process_refund` unless `get_customer` has already been called

**Answer: D**
When business rules require guaranteed compliance, hooks provide deterministic enforcement that prompt instructions cannot. A pre-tool-call hook (intercepting outgoing calls) is the correct pattern for blocking a tool call before it executes. Option B (PostToolUse) fires AFTER the tool runs, which is too late to block execution. Options A and C are probabilistic — they reduce but don't eliminate the failure rate.

---

### Q5. Task Decomposition Strategy
You need to review a large pull request spanning 20 files. Your single-pass review produces inconsistent depth across files and contradictory findings. Which decomposition is most appropriate?

A) Dynamic adaptive decomposition that generates subtasks based on what is discovered at each step
B) Prompt chaining: analyze each file individually, then run a cross-file integration pass
C) Have three independent reviewers check the full PR and only flag consensus issues
D) Require the PR author to split the change into smaller PRs before review begins

**Answer: B**
This is a predictable multi-aspect review — prompt chaining with per-file analysis plus cross-file integration is the right pattern. Option A (dynamic decomposition) is for open-ended investigation, not structured reviews. Option C would suppress detection of real bugs. Option D shifts burden without improving the system.

---

### Q6. Session Management
You explored a large codebase in a session yesterday. Since then, three files were modified. You want to continue the investigation. What's the best approach?

A) Start a completely new session and re-explore the whole codebase from scratch
B) Resume with `--resume` and tell the agent which three files have changed
C) Resume the session with `--resume` and let the agent discover changes naturally
D) Start a new session with a structured summary of prior findings injected into context

**Answer: B**
When prior context is mostly valid but some files changed, resume with `--resume` AND explicitly name the changed files so the agent re-analyses those and trusts the rest. Option C risks the agent working with stale tool results without knowing. Option D is better when prior tool results are extensively stale. Option A wastes work already done.

---

## Domain 2: Tool Design & MCP Integration (18%)

### Q7. MCP Error Handling Layers
Your MCP tool encounters a database timeout while processing a request. How should this error be communicated back to the agent?

A) Return a JSON-RPC error with code `-32603` (internal error) so the protocol layer reports it
B) Return a result with `isError: true` describing the failure type and whether a retry may help
C) Throw an unhandled exception and let the MCP framework decide how to surface it
D) Return an empty result set marked as successful and let the agent infer the failure

**Answer: B**
Tool execution errors should use the `isError: true` flag in the result, NOT JSON-RPC protocol errors. This allows the LLM to see the error and reason about recovery. The message should name the failure type and say whether a retry is worth attempting. Option A uses protocol-level errors, which the model typically can't see. Option C leaves the framework to invent a surface. Option D silently suppresses the error.

---

### Q8. Tool Count and Agent Performance
Your agent has access to 18 tools and frequently selects the wrong tool for ambiguous requests. What's the most effective architectural change?

A) Rewrite all 18 tool descriptions with more detail about when each one applies
B) Partition the tools across specialized subagents that each hold only 4-5 of them
C) Implement a keyword-based routing layer that picks the tool before the agent runs
D) Fine-tune the model on labelled examples of correct tool selection for this tool set

**Answer: B**
Giving an agent too many tools (18 vs 4-5) degrades selection reliability by increasing decision complexity. The solution is scoped tool access through subagent delegation. Option A helps but doesn't solve the fundamental scaling problem. Option C bypasses the LLM's understanding. Option D is out of scope.

---

### Q9. MCP Server Scoping
Your team wants to share a GitHub MCP server configuration that uses a personal access token. The server should be available to all team members when they clone the repo, but tokens should not be committed. How should you configure this?

A) Add to `~/.claude.json` and tell each developer to add the same entry on their machine
B) Add to `.mcp.json` with the token supplied by `${GITHUB_TOKEN}` variable expansion
C) Document the server configuration in `.claude/CLAUDE.md` beside the project instructions
D) Add to `.mcp.json` with the token value written directly into the committed `env` block

**Answer: B**
Project-scoped `.mcp.json` is version-controlled and supports `${VAR}` environment variable expansion. Each developer sets `GITHUB_TOKEN` in their environment. Option A is user-scoped and not shared. Option C is for instructions, not server config. Option D commits secrets.

---

### Q10. Resources vs Tools
Your MCP server provides access to a product catalog database. The agent needs to look up product details and also place orders. How should you design the MCP interface?

A) Expose both product lookups and order placement as MCP tools the model calls
B) Expose the product catalog as MCP resources and order placement as an MCP tool
C) Expose both as MCP resources since they both involve database interaction
D) Expose product lookups as an MCP tool and order placement as an MCP resource

**Answer: B**
Resources are application-controlled, read-only data — perfect for content catalogs. Tools are model-controlled actions with side effects — correct for order placement. Option A misses the opportunity to reduce exploratory tool calls. Option C wrongly uses resources for actions. Option D reverses the correct mapping.

---

## Domain 3: Claude Code Configuration & Workflows (20%)

### Q11. CLAUDE.md Hierarchy
A new developer joins the team and reports that Claude Code doesn't follow the team's API conventions when editing API handler files. Other developers don't have this issue. The conventions are defined in a configuration file. Where is the most likely misconfiguration?

A) The conventions are in `~/.claude/CLAUDE.md` on other developers' machines, not in the project
B) The conventions are in a `.claude/rules/` file whose globs don't match the API handlers
C) The conventions are in root `CLAUDE.md` but the new developer hasn't pulled the latest changes
D) The conventions are in a `.claude/skills/` skill that only loads when invoked by name

**Answer: A**
If the conventions work for existing developers but not a new one, the most likely cause is that instructions are in user-level `~/.claude/CLAUDE.md` (not shared via version control) rather than project-level `.claude/CLAUDE.md`. The fix is to move them to project-level.

---

### Q12. Path-Specific Rules
You want all test files to follow the same testing conventions. Test files are spread throughout the codebase (e.g., `Button.test.tsx` next to `Button.tsx`). What's the most maintainable approach?

A) Place a CLAUDE.md carrying the testing conventions in every directory holding tests
B) Create a `.claude/rules/testing.md` with `paths: ["**/*.test.*"]` frontmatter
C) Put all testing conventions in root CLAUDE.md under a "Testing" header
D) Create a skill in `.claude/skills/` that includes testing conventions

**Answer: B**
`.claude/rules/` with glob patterns applies conventions by file type regardless of directory location. Option A is unmaintainable with files spread everywhere. Option C loads conventions for ALL files, not just test files. Option D requires manual invocation.

---

### Q13. Skills Configuration
You're creating a codebase analysis skill that produces verbose output. You want to prevent this output from filling the main conversation context. What frontmatter option should you use?

A) `allowed-tools: [Read, Grep, Glob]` — limit the skill to read-only search tools
B) `context: fork` — run the skill body in its own separate context
C) `argument-hint: "directory path"` — declare the argument the skill expects
D) `output: suppress` — drop the skill's output instead of returning it

**Answer: B**
`context: fork` runs the skill in an isolated sub-agent context, preventing its outputs from polluting the main conversation. Option A restricts which tools the skill may call but leaves its output in the main transcript. Option C only supplies a completion hint for the skill's argument. Option D is not a real frontmatter key.

---

### Q14. Plan Mode vs Direct Execution
Which task is LEAST appropriate for plan mode?

A) Restructuring a monolithic application into independently deployed microservices
B) Migrating from one authentication library to another across more than 45 files
C) Adding a null check to the one function that is throwing a NullPointerException
D) Deciding between REST and GraphQL for a new public-facing API layer

**Answer: C**
A single-file bug fix with a clear cause is ideal for direct execution. Plan mode is for complex tasks with multiple approaches, architectural decisions, and multi-file changes — which describes all the other options.

---

## Domain 4: Prompt Engineering & Structured Output (20%)

### Q15. Reducing False Positives in Code Review
Your automated code review flags many false positives for "inconsistent error handling" because different modules intentionally use different error handling patterns. How should you fix this?

A) Add "be conservative" and "only report high-confidence findings" to the prompt
B) Define explicit criteria: report bugs and security, skip intentional local patterns
C) Increase the model's temperature so it produces more varied review outputs
D) Add more examples of the different error handling patterns used across the modules

**Answer: B**
Explicit criteria defining what to report vs skip is the correct approach. Option A uses vague instructions that don't improve precision. Option C is irrelevant. Option D adds context without clear guidance on which patterns are acceptable.

---

### Q16. Nullable Fields in Extraction
You're extracting author information from documents, but some documents don't have an author. Your current schema requires the author field, and Claude frequently fabricates author names. What's the fix?

A) Add instructions to the prompt: "Do not make up author names"
B) Make the author field nullable: `"type": ["string", "null"]`
C) Remove the author field from the schema entirely
D) Add a validation step that checks author names against a database

**Answer: B**
Making the field nullable allows Claude to return `null` when no author is found, rather than fabricating a value to satisfy a required field. Requiring non-nullable fields when data is sometimes absent is the biggest driver of hallucination in extraction. Option A is probabilistic. Option C loses the field entirely. Option D doesn't prevent initial fabrication.

---

### Q17. Batch API Appropriateness
Your team runs two workflows: (1) a pre-merge check that blocks developer merges and (2) a nightly code quality report. Which should use the Message Batches API?

A) Both — the 50% batch discount applies to any workflow regardless of latency
B) Only the nightly report — it is latency-tolerant and blocks nobody
C) Only the pre-merge check — it runs on every push and handles far more volume
D) Neither — the Batch API doesn't support the tool calling both workflows need

**Answer: B**
Batch API offers 50% savings but has up to 24-hour processing with no latency guarantee. It's perfect for overnight/non-blocking work but unsuitable for blocking pre-merge checks where developers wait. Option D is partially true (no multi-turn tool calling) but single-turn tool use works in batches.

---

## Domain 5: Context Management & Reliability (15%)

### Q18. Lost in the Middle
Your agent processes a long document but consistently misses findings from the middle sections. What's the most effective mitigation?

A) Increase max_tokens so the model has more room to work through the document
B) Summarize key findings up front and break the details into explicitly headed sections
C) Process the document in reverse order so the later sections are read first
D) Split the document into two equal halves and process each half separately

**Answer: B**
The "lost in the middle" effect means models reliably process beginning and end but may omit middle sections. Summarizing findings up front and marking every detail section with an explicit header gives the middle material structural anchors it otherwise lacks. Option C only moves which sections sit in the middle. Option D partially helps but the position effect still applies within each half. Option A doesn't address attention distribution.

---

### Q19. Escalation Triggers
A customer says "I want to speak to a human." The issue is a standard return that the agent can easily handle. What should the agent do?

A) Escalate immediately — the customer has explicitly asked to speak to a human
B) First investigate and attempt to resolve the return, escalating only if the customer insists
C) Ask the customer why they want a human to determine if escalation is necessary
D) Acknowledge the frustration and offer to resolve, escalating only if the customer insists

**Answer: A**
When a customer EXPLICITLY demands a human agent, escalate immediately without first attempting investigation. This is a direct exam principle. Option D would be correct if the customer expressed frustration without explicitly requesting a human. The distinction between explicit request (escalate now) vs implicit frustration (offer resolution) is key.

---

### Q20. Error Propagation
A web search subagent times out while researching. The coordinator receives a generic "search unavailable" status. What's wrong with this error reporting?

A) Nothing is wrong — the coordinator knows the search failed and can simply retry it
B) It hides context: what was attempted, what partly succeeded, and what alternatives exist
C) It should have been reported as a protocol-level error rather than a tool error
D) The subagent should have retried internally a few times before reporting failure

**Answer: B**
Generic error statuses hide valuable context. Structured error context should include: failure type, what was attempted (the query), partial results, and potential alternatives. Without this, the coordinator can't make intelligent recovery decisions. Option D (local retry) is good practice but orthogonal to the reporting issue.

---

## Scoring Guide
- 18-20 correct: Exam ready
- 15-17 correct: Review weak domains, do practice exercises
- 12-14 correct: Study all domain guides thoroughly
- Below 12: Focus on fundamentals, do hands-on exercises first
