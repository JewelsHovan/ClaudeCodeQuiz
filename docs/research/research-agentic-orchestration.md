# Research: Agentic Architecture, Orchestration & Context Management
*Compiled from Anthropic primary sources — 2026-09-07. For the CCA-F study guide (Domain 1: Agentic Architecture & Orchestration, 27%; Domain 5: Context Management & Reliability, 15%).*

All quotes are verbatim and under 15 words unless in a fenced block. Anything not verified against an Anthropic-owned URL (anthropic.com/engineering, claude.com/blog, platform.claude.com/docs, code.claude.com/docs) is flagged inline as **[unverified]**.

---

## 1. Workflow patterns vs. autonomous agents

**Primary source:** [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) — Anthropic engineering, Dec 2024.

The whole essay rests on one distinction, defined by **control flow**, not capability:

> Workflows: "systems where LLMs and tools are orchestrated through predefined code paths"
> Agents: "systems where LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks"

An agent *decides* its own next step at runtime; a workflow's next step is decided by your code ahead of time. This is the single most exam-relevant sentence in the domain.

### The five composable workflow patterns

| Pattern | Structure | Correct when |
|---|---|---|
| **Prompt chaining** | Sequential LLM calls, each processing the last output, with programmatic checkpoints/gates between steps | Task decomposes into fixed, known subtasks up front (e.g. generate marketing copy → translate it) |
| **Routing** | Classify the input, dispatch to one of several specialized downstream prompts/paths | Distinct input categories that are better handled by separate, non-competing optimizations (e.g. refunds vs. tech support vs. general queries) |
| **Parallelization** | Two variants: **sectioning** (independent subtasks run concurrently) and **voting** (same task run N times for consensus) | Sectioning for speed (e.g. a separate content-moderation pass); voting for confidence (e.g. N independent code-vulnerability reviews) |
| **Orchestrator-workers** | A central LLM decomposes the task *at runtime* and dispatches dynamic subtasks to worker LLMs, then synthesizes results | Subtasks can't be predicted beforehand — multi-file code changes, open-ended information gathering |
| **Evaluator-optimizer** | Generator LLM + a separate critic LLM, looping until a quality bar passes | Clear evaluation criteria exist and iteration measurably improves output (literary translation, multi-round research) |

**Composability** (explicit in the essay): a routing pattern often feeds into a prompt chain; an orchestrator-worker pattern often wraps an evaluator-optimizer at the worker layer; a parallelization pattern can sit inside any of the others.

### The explicit "don't build an agent" guidance

This is the part most secondary sources omit:

> "Finding the simplest solution possible, and only increasing complexity when needed" — which "might mean not building agentic systems at all"

Reasoning given: **"agentic systems often trade latency and cost for better task performance"** — so the tradeoff has to be earned. For many applications, "optimizing single LLM calls with retrieval and in-context examples is usually enough."

### When full agent autonomy *is* correct

"Open-ended problems with unpredictable step counts where hardcoded paths won't work" — SWE-bench-style resolution tasks, computer use automation. Agents "begin with user input, plan independently, use tools, and can pause for human judgment."

Three success principles named: **simplicity** in agent design, **transparency** (explicitly show the agent's planning steps), and a carefully engineered **"agent-computer interface"** (thorough tool documentation and testing — this foreshadows §4 below).

### Fixed vs. dynamic decomposition (mapping onto the above)

- **Scope known up front → prompt chaining.** Decomposition is fixed in your code; cheapest, most debuggable, most predictable cost.
- **Scope open-ended → orchestrator-workers / full agent.** Decomposition happens inside the model at runtime; more capable but costs real money (see token economics in §3) — justify it, don't default to it.

---

## 2. The agent loop: `stop_reason` and parallel tool use

**Primary sources:**
- [Stop reasons and fallback](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons) — Claude Platform Docs (evergreen, accessed 2026-09-07)
- [Parallel tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use) — Claude Platform Docs (evergreen, accessed 2026-09-07)

### Why parsing prose for "done" is wrong

The API returns a structured, typed field — `stop_reason` — precisely so a client never has to infer completion by reading text. Stop reasons live in the response body and mean "generation stopped normally, content is valid"; this is categorically different from an HTTP 4xx/5xx error.

### Full `stop_reason` reference

| `stop_reason` | Meaning | Loop action |
|---|---|---|
| `end_turn` | Natural completion — "the most common stop reason" | Use the response; exit the loop |
| `tool_use` | Claude is calling ≥1 tool and expects you to run it | Execute the tool(s); return `tool_result` block(s) in the next **user** message; continue the loop |
| `max_tokens` | Hit the `max_tokens` cap | Raise `max_tokens` or continue generation. **Special case:** if it truncated mid-`tool_use` block, you must retry with a higher cap to get the complete call |
| `stop_sequence` | Hit a custom stop string | Read the `stop_sequence` field to see which one fired |
| `pause_turn` | Server-side tool loop (e.g. web search) hit its iteration cap — **default 10 iterations** | Append the assistant content back into `messages` unchanged and re-send; repeat until a different `stop_reason` appears |
| `refusal` | Blocked by a content classifier before completing | Inspect `stop_details` for the policy category; consider rephrasing or a fallback model |
| `model_context_window_exceeded` | Response filled the model's context window before hitting `max_tokens` | Treat as truncated, same handling as `max_tokens` |

**Critical distinction to memorize for the exam:** a response that leaves a *client* `tool_use` block waiting on you is **always `tool_use`**, never `pause_turn`. `pause_turn` only fires for *server-side* tool loops (web search, etc.) hitting their own iteration cap.

**Gotcha:** Claude can return an empty response (2–3 tokens, no content) with `stop_reason: "end_turn"` — this typically happens right after tool results if you've inserted a stray text block after them. Fix: send `tool_result` blocks with nothing else in that user message.

```python
# Minimal production loop-control sketch (Messages API)
if response.stop_reason == "end_turn":
    return response          # done
elif response.stop_reason == "tool_use":
    results = [run_tool(b) for b in response.content if b.type == "tool_use"]
    messages += [{"role": "assistant", "content": response.content},
                 {"role": "user", "content": results}]   # ALL results, ONE message
    # loop again
elif response.stop_reason == "pause_turn":
    messages += [{"role": "assistant", "content": response.content}]
    # re-send unchanged, loop again
elif response.stop_reason == "max_tokens":
    # raise max_tokens and retry, esp. if last block is an incomplete tool_use
    ...
elif response.stop_reason == "refusal":
    # inspect response.stop_details, consider fallback model
    ...
```

### Parallel tool use

> "By default, Claude may call multiple tools in a single response." The response's `stop_reason` is `tool_use` and can contain several `tool_use` blocks in one assistant turn.

The API **does not prescribe execution order** — concurrent (`Promise.all` / `asyncio.gather`), sequential, or mixed is your client's decision:

> "Independent, read-only operations are usually safe to run in parallel... Tools with side effects, shared state, or ordering requirements might be better run sequentially."

**Formatting rule that silently kills parallelism if violated:** all `tool_result` blocks for one turn must go in a **single** user message, every result before any text content, matched by `tool_use_id`.

```json
// WRONG — separate messages teach Claude to stop batching calls
[
  {"role": "assistant", "content": [tool_use_1, tool_use_2]},
  {"role": "user", "content": [tool_result_1]},
  {"role": "user", "content": [tool_result_2]}
]

// CORRECT — single message, all results together
[
  {"role": "assistant", "content": [tool_use_1, tool_use_2]},
  {"role": "user", "content": [tool_result_1, tool_result_2]}
]
```

If you choose not to run a particular call (e.g. sequential batch, earlier call failed), still return a `tool_result` for it with `is_error: true` and a brief explanation — Claude will reissue it next turn.

**To encourage more parallel calls**, Anthropic ships an actual system-prompt snippet (docs call this "recommended if the default isn't sufficient"):

```
<use_parallel_tool_calls>
For maximum efficiency, whenever you perform multiple independent operations,
invoke all relevant tools simultaneously rather than sequentially. Prioritize
calling tools in parallel whenever possible. For example, when reading 3 files,
run 3 tool calls in parallel to read all 3 files into context at the same time.
When running multiple read-only commands like `ls` or `list_dir`, always run
all of the commands in parallel. Err on the side of maximizing parallel tool
calls rather than running too many tools sequentially.
</use_parallel_tool_calls>
```

Model-specific note flagged in the docs: **Claude Fable 5.1 may issue fewer parallel tool calls than earlier models**, most noticeably in long agent loops where the next reads are only implied (custom coding agents, bash/text-editor harnesses, computer use) — standard function calling is unaffected. Anthropic points to a Fable-5.1-specific "batch independent tool calls" prompting fix.

### `disable_parallel_tool_use`

Lives **inside `tool_choice`**, not as a top-level request parameter. Effect depends on `tool_choice.type`:

```json
// At most ONE tool call (Claude can still answer in plain text)
"tool_choice": {"type": "auto", "disable_parallel_tool_use": true}

// EXACTLY one tool call (tool_choice type "any" or "tool")
"tool_choice": {"type": "any", "disable_parallel_tool_use": true}
```

Use case per docs: simplifying loop logic when working with tools that have side effects or ordering dependencies. Note: Claude Fable 5.1 and Mythos 5.1 don't support `tool_choice` types `any`/`tool` at all.

**Troubleshooting tip from the docs:** if calls in a batch appear to depend on each other and you want fewer dependent calls batched together, add to the system prompt: *"Only batch tool calls that are independent of each other."*

---

## 3. Orchestrator/subagent architecture

**Primary sources:**
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system) — Anthropic engineering, June 2025
- [Subagents in the SDK](https://code.claude.com/docs/en/agent-sdk/subagents) — Claude Agent SDK docs (evergreen, accessed 2026-09-07)
- [When to use multi-agent systems (and when not to)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them) — Claude blog, Jan 23, 2026

### Context isolation is the *stated* reason, not just parallel speed

From the SDK docs, describing why subagents exist at all:

> "each subagent runs in its own conversation... intermediate tool calls and results stay inside the subagent; only its final message returns to the parent"

> "A `research-assistant` subagent can explore dozens of files without any of that content accumulating in the main conversation. The parent receives a concise summary, not every file the subagent read."

The research-system write-up frames the same idea at product scale as **lead agent / subagent**:

> "a lead agent coordinates the process while delegating to specialized subagents that operate in parallel," each with "their own context windows, exploring different aspects of the question simultaneously"

This isolation also prevents *path dependency* — subagents can't anchor their reasoning on each other's half-finished thoughts, because they never see them.

### How work is delegated — the concrete failure mode and its fix

Early failure named explicitly: vague task descriptions caused subagents to **"duplicate work or miss information."** The prescribed fix, worth quoting as a rule:

> "each subagent needs an objective, an output format, guidance on the tools and sources to use, and clear task boundaries"

This is the single most actionable orchestrator-prompting rule in the whole corpus — vague delegation is the #1 documented orchestrator bug.

**Effort-scaling heuristic** given as a concrete rule of thumb:

> "simple fact-finding requires just 1 agent with 3-10 tool calls, direct comparisons might need 2-4 subagents with 10-15 calls each"

### How results return to the orchestrator

Two mechanisms documented:

1. **Normal case** — only the subagent's final text message returns; per the SDK docs, the parent "may summarize it in its own response" (to preserve the subagent's output verbatim, you must explicitly instruct the parent to do so).
2. **Artifact pattern for large outputs** — subagents write directly to the filesystem instead of round-tripping large payloads through the orchestrator's context:

> "Subagents output directly to filesystems rather than routing through lead agents, preventing information loss during multi-stage processing"

### Token economics (numbers worth memorizing)

From the multi-agent research write-up:

- Multi-agent systems use **"about 15× more tokens than chats"**
- A single (non-multi-agent) agent uses **"~4× more tokens than chat interactions"**
- Internal eval: multi-agent (Opus 4 lead + Sonnet 4 subagents) beat single-agent Opus 4 by **90.2%**
- **"token usage by itself explains 80% of the variance"** in research-quality outcomes across their internal benchmarks

Anthropic's economic framing for accepting this multiplier (from the 2026 follow-up post):

> multi-agent systems "require tasks where the value... is high enough to pay for the increased performance"

The 2026 post is explicitly a *corrective* to over-eager adoption of the pattern:

> "we've seen teams invest months building elaborate multi-agent architectures only to discover that improved prompting on a single agent achieved equivalent results"

> multi-agent implementations "typically use 3-10x more tokens than single-agent approaches for equivalent tasks" (context duplication, coordination messages, result summarization)

**Three situations where multi-agent genuinely wins** (per the 2026 post — treat as the decision framework):
1. **Context protection** — "context pollution occurs" when one subtask's accumulated context is irrelevant to the next; isolate in subagents.
2. **Parallelization** — larger search space explored simultaneously (the original research-system pattern: lead agent spawns subagents to investigate different facets in parallel).
3. **Specialization** — focused toolsets and tailored prompts per role (ties directly to §4's 20+ tools threshold).

Outside these three, "the coordination costs typically exceed the benefits."

### Failure isolation — "one subagent failing must not kill the run"

Concrete production patterns named in the research write-up:

- **Resumable execution** — resume from checkpoints rather than restarting a failed agent from scratch: "restarts are expensive."
- **Graceful degradation** — agents adapt when a tool fails rather than halting the whole run.
- **Rainbow deployments** — gradually shift traffic between agent-prompt versions so an in-flight run isn't disrupted mid-execution.
- **Production tracing** — full diagnostic logging to see *why* an agent failed, without needing to monitor conversation contents directly.
- Named cautionary failure mode (treat as a real, observed bug class, not theoretical): agents **"spawning 50 subagents for simple queries, scouring the web endlessly for nonexistent sources."**

### Guardrails now shipped at the SDK level (directly answering the "unbounded delegation" failure above)

From [Subagents in the SDK](https://code.claude.com/docs/en/agent-sdk/subagents):

| Limit | Set via | Default | Effect at limit |
|---|---|---|---|
| Depth | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (env var) | `3` layers below the main agent (`1` disables sub-spawning) | Bottom-layer subagent can't spawn further; does the work itself |
| Concurrency | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (env var) | `20` running at once | New spawn refused: `"Concurrent subagent limit reached"` until count drops |
| Spend | `maxBudgetUsd` (TS) / `max_budget_usd` (Python), a query option | No limit | Refuses further spawns, stops running background subagents, ends query with `error_max_budget_usd` |

> "Claude Opus 5 delegates to subagents more readily than earlier models, so the depth, concurrency, and spend limits matter most on queries that run Opus 5."

### Subagent context inheritance, precisely (exam-detail level)

A **non-fork** subagent's context window starts fresh. What it gets vs. doesn't:

| Receives | Does NOT receive |
|---|---|
| Its own system prompt (`AgentDefinition.prompt`) + the Agent tool's prompt string | The parent's conversation history or tool results |
| Project `CLAUDE.md` (via `settingSources`) | Preloaded skill content (unless listed in `AgentDefinition.skills`) |
| Tool definitions (inherited or the `tools` subset) | The parent's system prompt |

A **fork** is the explicit exception — it inherits the full parent conversation instead of starting clean (this is the same fork-vs-fresh-subagent distinction already used in this project's own orchestration conventions).

### `AgentDefinition` — concrete code (Python, from SDK docs)

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

async def main():
    async for message in query(
        prompt="Review the authentication module for security issues",
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Grep", "Glob", "Agent"],
            agents={
                "code-reviewer": AgentDefinition(
                    description="Expert code review specialist. Use for quality, "
                                 "security, and maintainability reviews.",
                    prompt="""You are a code review specialist with expertise in
security, performance, and best practices. Identify security vulnerabilities,
check performance, verify standards, suggest specific improvements.""",
                    tools=["Read", "Grep", "Glob"],       # read-only: cannot Edit/Write
                    model="sonnet",
                ),
                "test-runner": AgentDefinition(
                    description="Runs and analyzes test suites.",
                    prompt="You are a test execution specialist...",
                    tools=["Bash", "Read", "Grep"],
                ),
            },
        ),
    ):
        if hasattr(message, "result"):
            print(message.result)

asyncio.run(main())
```

`AgentDefinition` fields worth knowing: `description` (routing signal — Claude matches tasks to subagents by this), `prompt`, `tools`/`disallowedTools`, `model` (alias or `'inherit'`), `skills`, `memory` (`'user'|'project'|'local'`), `maxTurns` (partial-output marking on limit), `background` (non-blocking default), `effort`, `permissionMode`.

**Invocation:** automatic (Claude matches task → subagent `description`) or explicit ("Use the code-reviewer agent to..."). Subagents run **in the background by default** — an Agent tool call must set `run_in_background: false` to block for the result.

---

## 4. Tool distribution across agents

**Primary sources:**
- [Writing effective tools for AI agents—using AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents) — Anthropic engineering, 2025 **[exact publish date unverified]**
- [When to use multi-agent systems (and when not to)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them) — Claude blog, Jan 23, 2026

### The published threshold: 20+ tools

From the 2026 multi-agent post, three concrete signals for when to split a monolithic toolset into specialized subagents:

1. **Quantity** — "20+ tools create selection problems"
2. **Domain confusion** — mixing unrelated tool domains in one toolset
3. **Degraded performance from tool overload**

This is Anthropic's explicit trigger for the "specialization" case in §3 — partition by domain, give each subagent a small, coherent toolset, and keep only the delegation tools (`Agent`) on the orchestrator itself.

### Consolidation over proliferation

Core anti-pattern named in "Writing effective tools":

> "More tools don't always lead to better outcomes."

Prescribed fix: **consolidate** related operations into one purposeful tool rather than exposing raw CRUD primitives. Concrete example given: replace separate `list_users` + `list_events` + `create_event` tools with a single `schedule_event` tool that internally handles availability-finding and scheduling.

Reasoning ties directly to context economy (§5):

> "if an LLM agent uses a tool that returns ALL contacts... it's wasting its limited context space on irrelevant information"

### Namespacing is a measured reliability lever, not cosmetics

> "selecting between prefix- and suffix-based namespacing... have non-trivial effects on tool-use evaluations"

Example pattern: `asana_projects_search`, `asana_users_search` — grouping related tools under a common prefix reduces agent confusion about which tool to reach for.

### Context/token efficiency in tool design

- **High-signal responses**: prioritize "contextual relevance over flexibility"; replace cryptic identifiers (UUIDs, raw params) with semantic alternatives.
- **Response verbosity control**: a `response_format` enum (`"concise"` / `"detailed"`) let Claude request less detail when it doesn't need it — concrete measured example: **206 → 72 tokens** for a Slack-tool response.
- **Pagination, filtering, truncation with sensible defaults** — don't make the agent page through noise.
- **Actionable error messages**: "error responses [should] clearly communicate specific and actionable improvements, rather than opaque error codes or tracebacks" — this is what lets an agent self-correct instead of retrying blindly.

### The evaluation methodology for tool design (three phases)

1. **Prototype** — stand up tools locally via Claude Code / MCP servers / Desktop extensions.
2. **Evaluate** — generate realistic, multi-step eval tasks based on actual workflows; measure beyond accuracy: runtime, tool-call count, token consumption, error rates.
3. **Iterate** — analyze agent reasoning + raw transcripts for friction points; explicitly **"let agents analyze your results and improve your tools for you"** via Claude Code (paste eval transcripts back in, let Claude refactor tool descriptions/implementations for self-consistency).

Measured outcome: "Claude-optimized" tools (refined through this loop) outperformed human-written baselines on held-out Slack/Asana MCP test sets. On SWE-bench, "precise refinements to tool descriptions... dramatically reduced error rates and improved task completion."

---

## 5. Context management and degradation

**Primary sources:**
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Anthropic engineering, **Sept 29, 2025** (published alongside Claude Sonnet 4.5)
- [Explore the context window](https://code.claude.com/docs/en/context-window) — Claude Code docs (evergreen, accessed 2026-09-07)
- [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) — Claude Platform Docs (evergreen)
- [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) — Claude Platform Docs **[fetched via search summary only, not directly verified with WebFetch — treat memory-tool specifics as lower-confidence]**

### Definition: context engineering vs. prompt engineering

> Context engineering is "the set of strategies for curating and maintaining the optimal set of tokens (information) during LLM inference, including all the other information that may land there outside of the prompts."

> "context engineering is iterative and the curation phase happens each time we decide what to pass to the model" — i.e. you re-fight this every turn, not once at prompt-design time.

### Why context degrades — the actual mechanism, not just the symptom

Anthropic ties this directly to transformer architecture:

> transformers require "every token to attend to every other token across the entire context," creating n² pairwise relationships for n tokens

> "LLMs have an 'attention budget' that they draw on when parsing large volumes of context. Every new token introduced depletes this budget by some amount."

Anthropic's name for the resulting quality decay: **"context rot."** As context grows, the model's *finite* attention gets stretched across more tokens — this is a capacity-depletion mechanism, not "the model forgot."

**On "instruction drift" specifically** — the team lead's framing, not an Anthropic-native term I could verify — this is the mechanism that produces exactly that symptom: a system prompt occupies a small, fixed slice of tokens near the start of context. As assistant turns/tool calls/tool results accumulate:
1. The *proportion* of the finite attention budget effectively available per token shrinks for everyone, including the system prompt, as total token count grows.
2. Independently, **position/"lost-in-the-middle" effects** mean information in the *middle* of a long context is attended to less reliably than information at the very start or very end — and a system prompt that starts at the front increasingly finds itself relatively "mid-context" as the transcript tail grows.

Net effect: the system prompt's literal content never changes, but its *effective influence* over next-token prediction measurably weakens as the transcript grows — a mechanical, not metaphorical, claim. **[The specific "10-40% less recall for mid-context info" figure is from third-party synthesis of the lost-in-the-middle literature, NOT an Anthropic quote — do not attribute this number to Anthropic.]**

### System prompt design — the "Goldilocks zone"

- Specific enough to steer behavior, general enough to allow heuristic judgment
- **"Minimally informative"** — only essential guidance
- Structured with XML tags or Markdown headers
- Named failure mode: **"bloated tool sets that cover too much functionality or lead to ambiguous decision points"** (ties directly to §4)

### Few-shot examples

Don't enumerate every edge case — "curate a set of diverse, canonical examples that effectively portray the expected behavior of the agent." Memorable framing: **"examples are the 'pictures' worth a thousand words"** for an LLM.

### Summarization vs. retrieval — when to embed-and-retrieve instead of summarizing

The field is shifting from **pre-loading** everything up front to **"just in time"** loading:

> JIT agents "maintain lightweight identifiers (file paths, stored queries, web links, etc.) and use these references to dynamically load data"

Explicit human-cognition analogy:

> "we generally don't memorize entire corpuses of information, but rather introduce external organization and indexing systems like file systems, inboxes, and bookmarks"

**Hybrid approach**, illustrated with Claude Code itself:

> "CLAUDE.md files are naively dropped into context up front, while primitives like glob and grep allow it to navigate its environment and retrieve files just-in-time"

Hybrid suits "contexts with less dynamic content, such as legal or finance work" — a stable document set worth preloading, with the long tail retrieved on demand.

### Compaction — summarizing history to reset the window

For genuinely open-ended back-and-forth where you can't cleanly discard anything. Building a good compaction prompt:

> "Start by maximizing recall to ensure your compaction prompt captures every relevant piece of information from the trace, then iterate to improve precision"

A named **low-risk first move**: **tool result clearing** — drop raw tool outputs once Claude has processed them, since it rarely needs to re-see them verbatim.

**Claude Code's actual implementation** (from the interactive context-window doc):
- Auto-triggers at **~95% of the context limit**
- "Replaces the conversation with a structured summary" — preserves "what files you're working on, the decisions you've made, and the state of your current task" while discarding the back-and-forth that led there
- `/compact focus on X` lets you steer what's kept vs. letting the automatic pass guess
- **What does NOT survive `/compact`**: skill *descriptions* (the index) are not re-injected — only skills you actually *invoked* get their body re-injected, capped at **5,000 tokens per skill**. This is a concrete, deliberate "not everything is preserved" example worth using in a study guide.
- File reads dominate context usage in practice; the doc's own tip: "Be specific in prompts... so Claude reads fewer files. For research-heavy tasks, use a subagent" — directly connecting compaction pressure back to the subagent-isolation pattern in §3.

### Two shipped server-side primitives (distinct from client-driven `/compact`)

Both beta, header `context-management-2025-06-27`, applied **server-side before the prompt reaches Claude** — client keeps the full unmodified history and never needs to resync:

**`clear_tool_uses_20250919`** — auto-clears the *oldest* tool results (optionally tool inputs too) once input tokens cross a `trigger` threshold, keeping the last N tool-use/result pairs, replacing cleared content with a placeholder.

```python
response = client.beta.messages.create(
    model="claude-opus-5",
    max_tokens=4096,
    messages=[{"role": "user", "content": "Create a simple command line calculator app"}],
    tools=[
        {"type": "text_editor_20250728", "name": "str_replace_based_edit_tool", "max_characters": 10000},
        {"type": "web_search_20250305", "name": "web_search", "max_uses": 3},
    ],
    betas=["context-management-2025-06-27"],
    context_management={
        "edits": [{
            "type": "clear_tool_uses_20250919",
            "trigger": {"type": "input_tokens", "value": 30000},   # default: 100,000
            "keep": {"type": "tool_uses", "value": 3},              # default: keep last 3
            "clear_at_least": {"type": "input_tokens", "value": 5000},
            "exclude_tools": ["web_search"],                        # never clear this tool
        }]
    },
)
```

**`clear_thinking_20251015`** — prunes old extended-thinking blocks, with model-family-specific defaults for how many turns of thinking are retained. **Must be listed first** if combined with `clear_tool_uses_20250919`.

```python
context_management={
    "edits": [
        {"type": "clear_thinking_20251015", "keep": {"type": "thinking_turns", "value": 2}},
        {"type": "clear_tool_uses_20250919", "trigger": {"type": "input_tokens", "value": 50000}, "keep": {"type": "tool_uses", "value": 5}},
    ]
}
```

Response includes stats on what was cleared (`applied_edits` → `cleared_tool_uses`, `cleared_input_tokens`, etc.). Cache interaction: clearing tool results invalidates the cached prefix at that point (use `clear_at_least` to make the invalidation worthwhile); clearing thinking blocks similarly invalidates cache at the clearing point, while *keeping* them preserves cache hits.

### Structured note-taking / scratchpad memory

Agents maintain external files (NOTES.md-style) as **"persistent memory with minimal overhead"** across context resets. Anthropic's shipped **memory tool** on the Developer Platform "makes it easier to store and consult information outside the context window through a file-based system" — Claude creates/reads/updates/deletes files in a dedicated memory directory that persists across conversations. **[Memory-tool specifics here are from a search-result summary, not a direct primary-source fetch — verify against platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool before quoting numbers like "84% token reduction," which I could not independently confirm.]**

### Sub-agent architectures as a context-management technique (not just orchestration)

Specialized agents return **"condensed summaries (typically 1,000-2,000 tokens)"** — a concrete number worth memorizing — achieving:

> "clear separation of concerns — the detailed search context remains isolated within sub-agents"

### When to use which — Anthropic's own decision framing

- **Compaction** → tasks requiring extensive back-and-forth
- **Note-taking** → iterative development with clear milestones
- **Multi-agent architectures** → complex research/analysis needing parallel exploration

Overarching principle, worth quoting verbatim:

> **"find the smallest set of high-signal tokens that maximize the likelihood of your desired outcome"**

Meta-guidance for practitioners, echoed across multiple Anthropic sources: **"do the simplest thing that works,"** especially as models get more capable and need less prescriptive scaffolding.

---

## 6. Evaluation and reliability

**Primary source:** [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — Anthropic engineering, 2025/2026 **[exact publish date unverified]**

### Three grader types (real tradeoffs, not a false hierarchy)

| Grader | Strength | Weakness |
|---|---|---|
| Code-based | Fast, cheap, objective | Brittle to valid variations |
| Model-based (LLM-as-judge) | Flexible, scalable | Non-deterministic, expensive |
| Human | Gold-standard quality | Expensive, slow |

### The layered production model

> "The most effective teams combine these methods: automated evals for fast iteration, production monitoring for ground truth, and periodic human review for calibration."

- **Automated evals**: faster iteration, fully reproducible; more up-front build cost, ongoing maintenance burden.
- **Production monitoring**: reveals real user behavior at scale, catches issues synthetic evals miss; but "reactive — problems reach users before you know about them."
- **A/B testing**: "measures actual user outcomes" but "slow; days or weeks to reach significance."
- **Periodic human review**: calibration layer, described via a "Swiss Cheese Model" — each layer alone is imperfect, they combine to close gaps.

### LLM-as-judge specifics

- **Calibration**: "LLM-as-judge graders should be closely calibrated with human experts to gain confidence that there is little divergence between the human grading and model grading."
- **Escape hatch to suppress hallucinated verdicts**: "give the LLM a way out, like providing an instruction to return 'Unknown' when it doesn't have enough information."
- **Isolate dimensions**: "create clear, structured rubrics to grade each dimension of a task, and then grade each dimension with an isolated LLM-as-judge rather than using one to grade all dimensions."
- "Model grading often takes careful iteration to validate accuracy."

### Grade outcomes, not paths

> "it's often better to grade what the agent produced, not the path it took" — so as not to unnecessarily punish creativity when a frontier model finds a valid but unexpected solution.

Named failure mode from being too strict about path: checking "very specific steps like a sequence of tool calls in the right order" creates "overly brittle tests."

### Diagnosing a 0% pass rate

> "with frontier models, a 0% pass rate across many trials is most often a signal of a broken task, not an incapable agent"

Concrete example given: Opus 4.5 initially scored 42% on CORE-Bench due to "rigid grading that penalized '96.12' when expecting '96.124991…', ambiguous task specs, and stochastic tasks that were impossible to reproduce exactly" — i.e. suspect the eval before the model.

### Building an eval set — the roadmap

0. Start with **20-50 simple tasks drawn from real failures** — don't wait for a perfect design.
1. Convert existing manual QA checks into test cases.
2. Require that **"two domain experts would independently reach the same pass/fail verdict"** — an inter-rater-reliability bar on the *task spec itself*, not just the grading.
3. Create reference solutions proving each task is actually solvable.
4. Build robust harnesses — trials run **isolated**, from clean environments.
5. Design graders thoughtfully, incorporating partial credit where applicable.
6. **Read the transcripts regularly** — called out as non-negotiable for understanding eval behavior.
7. Monitor for **eval saturation** (agents passing everything — time to raise the bar).
8. Staff a **dedicated evals team** to own core infra, while domain experts/product teams contribute most eval tasks.

> "An eval suite is a living artifact that needs ongoing attention and clear ownership to remain useful."

**Eval-driven development**: "build evals to define planned capabilities before agents can fulfill them, then iterate until the agent performs well."

### pass@k vs. pass^k — precise distinction

- **pass@k** = probability of *at least one* success in k attempts → use when one success is enough (most tool calls).
- **pass^k** = probability that *all* k attempts succeed → use when consistency itself is the requirement (agents that must be reliable every time).

> "Both metrics are useful, and which to use depends on product requirements: pass@k for tools where one success matters, pass^k for agents where consistency is essential."

### One-sided eval sets create one-sided optimization

> "if you only test whether the agent searches when it should, you might end up with an agent that searches for almost everything" — the argument for balanced positive/negative test cases.

### Human-in-the-loop / escalation

Framed as a **designed system property**, not a fallback for model failure. From "Building Effective Agents":

> agents "can pause for human feedback at checkpoints or when encountering blockers," with "extensive sandboxed testing and appropriate guardrails" expected before autonomous workflows go live

From the evals post, manual transcript review is framed as *skill-building* for the team, not just a QA gate:

> reading transcripts "doesn't scale" but is how humans "build intuition for failure modes" that automated graders later encode

Systematic human studies remain necessary specifically **"in complex domains (legal, finance, healthcare)"** to calibrate the LLM-judge against ground truth.

---

## Verification gaps (do not present these as confirmed Anthropic claims without a follow-up check)

1. **"Instruction drift"** is not a term I found used verbatim in any Anthropic primary source. The underlying mechanism (context rot / attention budget depletion / lost-in-the-middle position effects) is well-documented and explains the symptom, but the label itself is this study guide's framing, not Anthropic's.
2. The **"10-40% less recall accuracy for mid-context information"** figure is from third-party synthesis of the lost-in-the-middle research literature, not a quoted Anthropic number.
3. Exact publish dates for **"Writing effective tools for AI agents"** and **"Demystifying evals for AI agents"** were not independently pinned — content/quotes are verified directly from the source pages, only the calendar date is uncertain.
4. **Memory tool** section (§5) numbers (e.g. an "84% token reduction" figure that surfaced in search summaries) were NOT verified via a direct fetch of `platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool` — re-fetch before citing a specific percentage.
5. Did not find a **quantitative curve** for tool-count vs. selection accuracy beyond the qualitative "20+ tools" threshold — only the Slack-tool 206→72 token example (response-verbosity control, a different metric) is a hard number from "Writing effective tools for AI agents."
6. Noted but did not use: third-party sites (claudecertificationguide.com, claudearchitectcertification.com, ccaf-exam.guide) appear to be exam-prep material built specifically around this same certification and surfaced in searches for `stop_reason`/agentic-loop terms. Nothing in this document is sourced from them — flagging only because they may be competing/derivative study material.
