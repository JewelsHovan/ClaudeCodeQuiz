# Agent SDK Deep Dive — Code-Level Reference

The exam tests practical SDK knowledge. This doc covers the code patterns you need to know.

---

## 1. SDK Architecture

The Claude Agent SDK wraps the Claude CLI binary as a subprocess — it is NOT a raw Anthropic API client.

```
User Code → query() / ClaudeSDKClient → SubprocessCLITransport → Claude CLI → Anthropic API
```

---

## 2. The Agentic Loop — Correct Implementation

### Message Types

| Message Type | Meaning |
|---|---|
| `SystemMessage` | Session metadata at loop start |
| `AssistantMessage` | Claude's text + tool call requests |
| `ResultMessage` | Loop complete — carries stop_reason, session_id, cost |

### Correct Loop Pattern

```python
import anyio
from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, ResultMessage, TextBlock, ToolUseBlock

async def main():
    options = ClaudeAgentOptions(
        system_prompt="You are a helpful coding assistant",
        allowed_tools=["Read", "Write", "Bash"],
        permission_mode="acceptEdits",
        max_turns=10,
        max_budget_usd=2.0,
    )

    async for message in query(prompt="Create a hello.py file", options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    print(f"Claude: {block.text}")
                elif isinstance(block, ToolUseBlock):
                    print(f"Tool call: {block.name}")
        elif isinstance(message, ResultMessage):
            print(f"Done. stop_reason={message.stop_reason}")
            print(f"Cost: ${message.total_cost_usd:.4f}")
            # ResultMessage IS the termination signal — stop here

anyio.run(main)
```

### ResultMessage stop_reason Values

| Value | Meaning | Action |
|---|---|---|
| `end_turn` | Model finished normally | Stop — happy path |
| `max_tokens` | Hit output token limit | Handle truncation or retry |
| `refusal` | Model declined the request | Handle gracefully |
| `pause_turn` | Server loop hit iteration limit (default 10) | Re-submit to continue |

### Handling pause_turn

```python
elif isinstance(message, ResultMessage):
    if message.stop_reason == "pause_turn":
        # Re-submit to continue from where Claude left off
        await client.query("")  # Empty query resumes
    else:
        break  # Actual termination
```

### The Three Anti-Patterns (MEMORIZE)

**1. Parsing natural language for termination:**
```python
# WRONG
if "task complete" in block.text.lower():
    break
```

**2. Arbitrary iteration caps:**
```python
# WRONG — why 5? What if task needs 6?
for i in range(5):
    await client.query(prompt)
```
Use `max_turns` in `ClaudeAgentOptions` instead — it counts tool-use turns semantically.

**3. Checking assistant text as completion:**
```python
# WRONG
if message.content[-1].text.endswith("Done!"):
    break
```

**Correct termination signals**: `ResultMessage` (SDK level) or hooks returning `continue_: False`.

---

## 3. Multi-Agent — Subagent Configuration

### AgentDefinition

```python
from claude_agent_sdk import ClaudeAgentOptions, AgentDefinition

options = ClaudeAgentOptions(
    model="claude-sonnet-4-5",
    agents={
        "research-agent": AgentDefinition(
            description="Searches and summarizes information from docs and web.",
            prompt="You are a research specialist. Provide citation-backed summaries.",
            tools=["Read", "Glob", "Grep"],
            model="sonnet",
        ),
        "coding-agent": AgentDefinition(
            description="Writes and refactors Python code following project conventions.",
            prompt="You are a senior Python engineer. Write clean, typed, tested code.",
            tools=["Read", "Write", "Edit", "Bash"],
            model="opus",
        ),
    }
)
```

### Custom Subagent Files (`.claude/agents/` directory)

```yaml
---
name: code-reviewer
description: Reviews code for quality, bugs, and security vulnerabilities.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Task          # Required if this subagent needs to spawn its own subagents
model: opus
---
You are an expert code reviewer specializing in security and correctness.
Review the provided code changes and identify issues with specific line references.
```

### Key Rules
- `"Task"` must be in `allowed-tools` for any agent that spawns subagents
- Subagents have ISOLATED context — fresh conversation, no inherited history
- Only the subagent's final response returns to the coordinator as a tool result
- Multiple Task calls in single response = parallel execution (up to 10 concurrent)

### Context Passing Pattern

```python
# Coordinator builds rich prompt with all needed context
subagent_prompt = f"""
PR Title: {pr_title}
PR Description: {pr_description}
Files changed: {files_changed}

Diff:
{diff_text}

Review for security vulnerabilities. Return JSON with:
{{"severity": "critical|high|medium|low", "issues": [...]}}
"""
```

---

## 4. Hooks — Complete Reference

### All Hook Events

| Hook Event | Fires When | Primary Use |
|---|---|---|
| `PreToolUse` | Before tool executes | Block, modify input, enforce compliance |
| `PostToolUse` | After tool succeeds | Normalize output, log, inject context |
| `PostToolUseFailure` | After tool fails | Error handling, retry logic |
| `UserPromptSubmit` | User submits prompt | Input validation, context injection |
| `Stop` | Agent stops | Cleanup, state persistence |
| `SubagentStart` | Subagent spawns | Additional context injection |
| `SubagentStop` | Subagent completes | Track results, aggregate outputs |
| `PreCompact` | Before context compaction | Control compaction behavior |

### Hook Callback Signature

```python
async def my_hook(
    input_data: HookInput,       # tool_name, tool_input, session_id, etc.
    tool_use_id: str | None,     # Present for tool-related hooks
    context: HookContext,        # Future abort signal support
) -> HookJSONOutput:
    ...
```

### Hook Output Control Fields

| Field | Type | Effect |
|---|---|---|
| `continue_` | bool | `True` = proceed; `False` = halt |
| `stopReason` | str | Message when halting |
| `decision` | "block" | Alternative block signal (PreToolUse) |
| `reason` | str | Feedback injected back to Claude |
| `systemMessage` | str | Warning shown to user |
| `hookSpecificOutput` | dict | Event-specific controls |

**Python note**: Use `continue_` (trailing underscore) in Python. SDK converts to `continue` for CLI.

### Example: PreToolUse — Block Refunds Over $500

```python
async def enforce_refund_limit(input_data, tool_use_id, context):
    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    if tool_name == "process_refund":
        amount = float(tool_input.get("amount", 0))
        if amount > 500:
            return {
                "continue_": False,
                "stopReason": f"Refund of ${amount} exceeds $500 limit",
                "reason": "Refunds over $500 require human manager approval.",
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                },
            }

    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
        }
    }
```

### Example: PostToolUse — Data Normalization

```python
async def normalize_customer_data(input_data, tool_use_id, context):
    tool_response = input_data.get("tool_response", {})

    if isinstance(tool_response, dict):
        normalized = {
            **tool_response,
            "email": tool_response.get("email", "").strip().lower(),
            "phone": tool_response.get("phone", "").replace("-", ""),
        }
        return {
            "continue_": True,
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "updatedMCPToolOutput": normalized,  # Replaces raw output seen by Claude
            }
        }

    return {"continue_": True}
```

### Example: SubagentStart — Dynamic Context Injection

```python
async def inject_security_context(input_data, tool_use_id, context):
    agent_type = input_data.get("agent_type", "")
    if agent_type == "security-reviewer":
        return {
            "continue_": True,
            "hookSpecificOutput": {
                "hookEventName": "SubagentStart",
                "additionalContext": "Security policy: block all eval(); flag all network calls",
            }
        }
    return {"continue_": True}
```

### Registering Hooks

```python
from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

options = ClaudeAgentOptions(
    hooks={
        "PreToolUse": [
            HookMatcher(matcher="process_refund", hooks=[enforce_refund_limit]),
            HookMatcher(matcher="Bash", hooks=[validate_bash_commands]),
        ],
        "PostToolUse": [
            HookMatcher(matcher=None, hooks=[log_all_tools]),     # None = all tools
            HookMatcher(matcher="fetch_customer", hooks=[normalize_data]),
        ],
        "SubagentStart": [
            HookMatcher(matcher=None, hooks=[inject_security_context]),
        ],
    }
)
```

---

## 5. Session Management

### Three Session Continuation Modes

| Mode | Config | Effect |
|---|---|---|
| **Resume by ID** | `resume="session-abc-123"` | Continue specific session |
| **Continue latest** | `continue_conversation=True` | Resume most recent session |
| **Fork** | `resume="id" + fork_session=True` | Branch from session (new ID, same history) |

### Resume a Session

```python
options = ClaudeAgentOptions(resume="session-abc-123")
async for message in query("Continue where we left off.", options=options):
    ...  # Claude has FULL context from previous session
```

### Fork a Session

```python
fork_options = ClaudeAgentOptions(
    resume="session-abc-123",
    fork_session=True,  # New ID assigned; history copied; both independent
)
async for message in query("Try a different approach.", options=fork_options):
    if isinstance(message, ResultMessage):
        forked_id = message.session_id  # Different from original
```

### Session ID Retrieval

```python
async for message in query("Start a project plan."):
    if isinstance(message, ResultMessage):
        session_id = message.session_id  # Available on every ResultMessage
```

---

## 6. Full ClaudeAgentOptions Reference

```python
ClaudeAgentOptions(
    # Model
    model="claude-sonnet-4-5",
    fallback_model="claude-haiku-4",

    # System prompt
    system_prompt="You are a production assistant.",
    # OR: system_prompt={"append": "Additional instructions"}

    # Tools
    allowed_tools=["Read", "Write", "Bash", "Task"],
    disallowed_tools=["WebSearch"],

    # Subagents
    agents={"name": AgentDefinition(...)},

    # Hooks
    hooks={"PreToolUse": [...], "PostToolUse": [...]},

    # Sessions
    resume="session-id",
    fork_session=True,
    continue_conversation=False,

    # Limits
    max_turns=20,
    max_budget_usd=5.0,

    # Output
    output_format={"type": "object", "properties": {...}},

    # Permissions
    permission_mode="acceptEdits",  # "default"|"acceptEdits"|"plan"|"bypassPermissions"

    # Advanced
    thinking={"enabled": True, "budget_tokens": 5000},
    effort="high",  # "low"|"medium"|"high"|"max"
    mcp_servers={"server": config},
    cwd="/path/to/working/dir",
    env={"MY_VAR": "value"},
)
```

---

## 7. Exam Traps for Agent SDK

1. **"Check stop_reason text in the response"** — NO. Use `ResultMessage` as the termination signal.
2. **"Subagents inherit coordinator context"** — NO. Context is isolated. Must explicitly inject.
3. **"PostToolUse hook blocks tool execution"** — NO. PostToolUse fires AFTER execution. Use PreToolUse to block.
4. **"Use iteration counts to stop the loop"** — NO. Use `max_turns` in options (semantic), not arbitrary `for i in range(N)`.
5. **"Prompt instructions guarantee compliance"** — NO. Hooks are deterministic; prompts are probabilistic.
6. **"Any agent can spawn subagents"** — NO. `"Task"` must be in `allowed-tools`.
