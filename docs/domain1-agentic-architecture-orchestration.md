# Domain 1: Agentic Architecture & Orchestration (27%)

**This is the biggest domain — over a quarter of the exam.**

---

## Task 1.1: The Agentic Loop Lifecycle

### How It Works
```
1. Send request to Claude (with tools defined)
2. Check response stop_reason
   ├── "tool_use" → Execute requested tools → Append results → Go to step 1
   └── "end_turn" → Done! Return final response to user
```

### The JSON Exchange

**Step 1 — Initial request:**
```json
{
  "model": "claude-opus-4-5",
  "tools": [...],
  "messages": [{"role": "user", "content": "Do X"}]
}
```

**Step 2 — Claude responds with tool call (stop_reason: "tool_use"):**
```json
{
  "stop_reason": "tool_use",
  "content": [{
    "type": "tool_use",
    "id": "toolu_01xyz",
    "name": "search_db",
    "input": {"query": "..."}
  }]
}
```

**Step 3 — You execute the tool and send results back:**
```json
{
  "messages": [
    {"role": "user", "content": "Do X"},
    {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_01xyz", ...}]},
    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_01xyz", "content": "results..."}]}
  ]
}
```

**Key detail**: `tool_result` messages are sent as `role: "user"` and must include `tool_use_id` matching the original tool call.

**Step 4 — Claude either calls another tool (loop continues) or returns `stop_reason: "end_turn"` (loop ends).**

### Model-Driven vs Pre-Configured
- **Model-driven** (correct): Claude reasons about which tool to call next based on context
- **Pre-configured** (anti-pattern for agentic): Fixed decision trees or tool sequences

### Anti-Patterns (MEMORIZE THESE)
1. **Parsing natural language** to determine loop termination ("I'm done", "task complete")
2. **Arbitrary iteration caps** as the PRIMARY stopping mechanism
3. **Checking for assistant text content** as a completion indicator (Claude can include text alongside tool calls)

---

## Task 1.2: Multi-Agent Coordinator-Subagent Patterns

### Hub-and-Spoke Architecture
```
              ┌──────────────┐
              │  Coordinator  │
              │               │
              │ - Decomposes  │
              │ - Delegates   │
              │ - Aggregates  │
              └───┬───┬───┬──┘
                  │   │   │
            ┌─────┘   │   └─────┐
            ▼         ▼         ▼
        ┌───────┐ ┌───────┐ ┌───────┐
        │Search │ │Analyze│ │Synth  │
        │Agent  │ │Agent  │ │Agent  │
        └───────┘ └───────┘ └───────┘
```

### Key Principles
1. **Coordinator manages ALL inter-subagent communication** — subagents don't talk to each other
2. **Subagents have isolated context** — they do NOT inherit coordinator's conversation history
3. **Coordinator role**: task decomposition, delegation, result aggregation, deciding which subagents to invoke
4. **Dynamic routing**: Coordinator analyzes query requirements and selects which subagents to invoke (not always the full pipeline)

### Risks
- **Overly narrow decomposition**: Coordinator splits "AI in creative industries" into only visual arts subtasks, missing music, writing, film
- **Over-provisioned subagents**: Giving synthesis agent web search tools → cross-specialization misuse

### Iterative Refinement Loop
```
Coordinator evaluates synthesis output for gaps
  → Re-delegates to search/analysis with targeted queries
  → Re-invokes synthesis until coverage is sufficient
```

---

## Task 1.3: Subagent Invocation and Context Passing

### Task Tool for Spawning
- The **Task tool** is the mechanism for spawning subagents
- Coordinator's `allowedTools` must include `"Task"`
- Subagent context is explicitly provided in the prompt

### Context Passing Rules
1. **Include complete findings from prior agents** in the subagent's prompt
2. **Use structured data formats** separating content from metadata (source URLs, document names, page numbers)
3. **Parallel execution**: Emit multiple Task tool calls in a single coordinator response
4. **Specify goals, not procedures**: Coordinator prompts should state research goals and quality criteria, not step-by-step instructions

### AgentDefinition Configuration
Each subagent type has:
- `description`: What the subagent does
- System prompt: Detailed instructions
- Tool restrictions: Only tools needed for its role

### Fork-Based Session Management
`fork_session` creates independent branches from a shared analysis baseline for exploring divergent approaches (e.g., comparing two testing strategies).

---

## Task 1.4: Multi-Step Workflows with Enforcement

### Programmatic vs Prompt-Based
| Approach | Guarantee | Use When |
|----------|-----------|----------|
| Programmatic (hooks, gates) | Deterministic (100%) | Financial, identity, security-critical |
| Prompt-based | Probabilistic (<100%) | Nice-to-have ordering, style guidance |

**Key principle**: When deterministic compliance is required, prompt instructions alone have a non-zero failure rate.

### Programmatic Prerequisites
Block downstream tool calls until prerequisite steps complete:
```
get_customer → verified ID required → THEN lookup_order/process_refund allowed
```

### Structured Handoff Protocol
When escalating to a human:
- Customer ID
- Root cause analysis
- Refund amount
- Recommended action
- Full context (human may lack conversation transcript access)

### Multi-Concern Requests
When a customer has multiple issues:
1. Decompose into distinct items
2. Investigate each in parallel using shared context
3. Synthesize a unified resolution

---

## Task 1.5: Agent SDK Hooks

### PostToolUse Hooks (Data Normalization)
Intercept tool RESULTS before the model processes them:
- Normalize Unix timestamps → ISO 8601
- Convert numeric status codes → human-readable strings
- Standardize date formats across different MCP tools

### Pre-Tool-Call Hooks (Compliance Enforcement)
Intercept OUTGOING tool calls to enforce rules:
- Block refunds > $500 → redirect to human escalation
- Require customer verification before financial operations
- Block destructive operations without approval

### Hooks vs Prompts Decision
```
Must it work 100% of the time?
├── YES → Hook (deterministic guarantee)
└── NO → Prompt instruction (simpler, probabilistic)
```

Hooks provide **guaranteed compliance**. Prompt instructions provide **best-effort compliance**.

---

## Task 1.6: Task Decomposition Strategies

### Two Main Patterns

**Prompt Chaining (Fixed Sequential)**
- Predictable, multi-aspect reviews
- Example: Analyze each file individually → cross-file integration pass
- Use when: structure of work is known in advance

**Dynamic Adaptive Decomposition**
- Open-ended investigation tasks
- Generate subtasks based on what is discovered at each step
- Use when: "add comprehensive tests to legacy codebase" — need to first map structure, identify high-impact areas, then create prioritized plan

### Code Review Decomposition
```
Step 1: Per-file local analysis (consistent depth per file)
Step 2: Cross-file integration pass (data flow, API contracts, consistency)
```
This avoids attention dilution from processing all files at once.

### Large Task Decomposition
```
1. Map structure (explore the codebase)
2. Identify high-impact areas
3. Create prioritized plan
4. Adapt as dependencies are discovered
```

---

## Task 1.7: Session State, Resumption, and Forking

### Named Session Resumption
```bash
claude --resume investigation-session-1
```
- Continue a specific prior conversation by name
- Use when prior context is mostly valid

### fork_session
- Creates independent branches from a shared analysis baseline
- Use for comparing approaches (two testing strategies, two refactoring approaches)
- Each fork explores independently without polluting the other

### When to Resume vs Start Fresh
| Scenario | Approach |
|----------|----------|
| Prior context mostly valid, few files changed | Resume + inform about changes |
| Prior tool results extensively stale | New session + structured summary |
| Want to compare approaches | fork_session |

### Informing Resumed Sessions
When resuming after code changes:
- Tell the agent specifically WHICH files changed
- Request targeted re-analysis (not full re-exploration)
- This is more efficient than starting from scratch

---

## Key Exam Scenarios for Domain 1

### Scenario 1: Customer Support Agent
- Programmatic prerequisites (verify customer before refund)
- Hooks for compliance (block refunds > threshold)
- Escalation patterns (explicit customer request → immediate)
- Multi-concern decomposition

### Scenario 3: Multi-Agent Research
- Coordinator decomposition quality (not too narrow)
- Parallel subagent execution (multiple Task calls in one response)
- Context isolation (subagents don't inherit history)
- Iterative refinement (coordinator checks for gaps)

### Scenario 4: Developer Productivity
- Subagent delegation for codebase exploration
- Scoped tool access per subagent
- Session management for long investigations
