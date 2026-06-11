# Exam Cheat Sheet — Quick Reference

## Numbers to Memorize
| Fact | Value |
|------|-------|
| Questions | **60** (single-select MC: 1 correct + 3 distractors) |
| Time limit | **120 min** (~2 min/question) |
| Passing score | **720 / 1000** (scaled, not a percentage) |
| Scenarios per exam | **4 drawn at random** from a pool of **6 confirmed** (possibly 8 — see below) |
| Delivery | Online-proctored, closed-book (Skilljar) |
| Max tools per agent for reliable selection | **4-5** |
| Batch API cost savings | **50%** |
| Batch API max processing time | **24 hours** |
| Batch API max requests per batch | **10,000** |
| Batch API result retention | **29 days** |

> Blueprint is community-confirmed, not Anthropic-published. Cost/validity/prerequisites unconfirmed.
> See `exam-research-2026.md`. The 6 confirmed scenario themes: Customer Support Resolution Agent · Code
> Generation with Claude Code · Multi-Agent Research System · Developer Productivity · Claude Code for CI ·
> Structured Data Extraction. A single community source (2026-06-10) reports the pool grew to **8**, adding
> Conversational AI Architecture Patterns + a candidate-reported "Agentic AI Tools" theme.

---

## Domain Weight at a Glance
| Domain | % | Focus |
|--------|---|------------|
| 1. Agentic Architecture & Orchestration | **27%** | Biggest domain — weight study time here |
| 2. Tool Design & MCP Integration | **18%** | Tool descriptions, MCP errors, scoping |
| 3. Claude Code Config & Workflows | **20%** | Commands vs skills, hooks, plugins, CI |
| 4. Prompt Eng & Structured Output | **20%** | tool_use vs few-shot, schemas, tool_choice |
| 5. Context & Reliability | **15%** | Escalation, degradation, stratified validation |

---

## 2026 Currency (don't get caught on stale facts)
| Topic | Current state |
|-------|---------------|
| Flagship model | **Claude Opus 4.8** (Opus 4.7 also active; Opus 4.1 retires **Aug 5, 2026**) |
| Claude Code plugins | `claude plugin init <name>` scaffolds a plugin; skills in `.claude/skills` **auto-load** (no marketplace/install) |
| Stop / SubagentStop hooks | can return `hookSpecificOutput.additionalContext` (≤10k chars) to feed context **without** a hook error (v2.1.163) |

> Model/tooling facts are time-sensitive — re-verify on `platform.claude.com/docs` and
> `code.claude.com/docs/en/changelog` before sitting.

---

## Decision Trees

### "How to enforce business rules?"
```
Is compliance failure acceptable? (even 1% of the time)
├── NO → Programmatic hooks / prerequisite gates
└── YES → Prompt instructions + few-shot examples
```

### "Hook or prompt?"
```
Financial/identity/security consequence?
├── YES → Hook (deterministic guarantee)
└── NO → Prompt instruction (probabilistic, lower effort)
```

### "Plan mode or direct execution?"
```
Multiple files? Architectural decisions? Multiple valid approaches?
├── YES to any → Plan mode
└── NO to all → Direct execution
```

### "Batch API or synchronous?"
```
Is the workflow blocking? (someone waiting for results)
├── YES → Synchronous Messages API
└── NO → Message Batches API (50% savings)
```

### "MCP Resource or Tool?"
```
Does the model need to READ data or PERFORM an action?
├── READ (static/semi-static data) → Resource
└── ACTION (side effects, computation) → Tool
```

### "Path-specific rules or directory CLAUDE.md?"
```
Do the files span multiple directories?
├── YES → .claude/rules/ with glob patterns
└── NO → Directory CLAUDE.md
```

### "Community MCP server or custom?"
```
Standard integration (GitHub, Jira, Slack, PostgreSQL)?
├── YES → Community server
└── NO → Custom server (proprietary/niche/regulated)
```

---

## stop_reason Quick Reference
| Value | Meaning | Loop Action |
|-------|---------|-------------|
| `"tool_use"` | Model wants to call tools | Execute tools → continue loop |
| `"end_turn"` | Model is finished | Stop loop → return response |
| `"max_tokens"` | Hit token limit mid-response | Handle truncation |
| `"pause_turn"` | Server-side agent loop limit | Re-send to continue |

---

## tool_choice Quick Reference
| Mode | JSON | Guarantees |
|------|------|------------|
| `auto` | `{"type": "auto"}` | Nothing — model may skip tools |
| `any` | `{"type": "any"}` | Must call A tool (picks which) |
| Forced | `{"type": "tool", "name": "X"}` | Must call tool X |
| `none` | `{"type": "none"}` | No tools allowed |

**Trap**: `any` and forced are incompatible with extended thinking.

---

## Error Categories
| Category | Retryable? | Examples |
|----------|-----------|----------|
| `transient` | Yes | Timeout, rate limit, service down |
| `validation` | No | Bad input, missing field |
| `permission` | No | Access denied, auth failure |
| `business` | No | Policy violation |

---

## MCP Server Scopes
| Scope | File | Shared? | Use |
|-------|------|---------|-----|
| `project` | `.mcp.json` | Yes (git) | Team servers |
| `local` | `~/.claude.json` (project-scoped) | No | Personal/sensitive |
| `user` | `~/.claude.json` (global) | No | Personal across projects |

**Precedence**: local > project > user

---

## CLAUDE.md Hierarchy
| Level | Location | Shared? |
|-------|----------|---------|
| User | `~/.claude/CLAUDE.md` | No |
| Project | `.claude/CLAUDE.md` or root `CLAUDE.md` | Yes |
| Directory | Subdirectory `CLAUDE.md` | Yes |

**Modular options**: `@import` syntax, `.claude/rules/` directory

---

## Skills Frontmatter
| Option | Purpose |
|--------|---------|
| `context: fork` | Isolate output from main session |
| `allowed-tools` | Restrict tool access |
| `argument-hint` | Prompt for required parameters |

---

## Commands Scoping
| Scope | Location | Shared? |
|-------|----------|---------|
| Project | `.claude/commands/` | Yes (version control) |
| User | `~/.claude/commands/` | No |

---

## Anti-Patterns to Remember
1. Parsing natural language for loop termination
2. Arbitrary iteration caps as PRIMARY stopping mechanism
3. Checking for assistant text content as completion indicator
4. Generic "Operation failed" error messages
5. Silently suppressing errors (empty results as success)
6. Terminating entire workflow on single subagent failure
7. Self-reported confidence scores for escalation (poorly calibrated)
8. Sentiment analysis for escalation (doesn't correlate with complexity)
9. Giving agents 18+ tools (degrades selection reliability)
10. Requiring non-nullable fields when data is sometimes absent (hallucination driver)

---

## Key Patterns to Remember
1. Programmatic prerequisites for critical business logic (not prompts)
2. Structured claim-source mappings for provenance
3. Case facts block for transactional data (outside summarized history)
4. Position-aware ordering (key info at beginning, not middle)
5. Per-file analysis + cross-file integration pass for large reviews
6. Independent review instance > self-review in same session
7. Retry-with-error-feedback for extraction failures
8. Scratchpad files for long codebase exploration sessions
9. `/compact` to reduce context in extended sessions
10. Subagent delegation to manage context window limits

---

## CI/CD Integration
```bash
# Non-interactive mode (the -p flag)
claude -p "Review this PR"

# Structured output for automation
claude -p "Review" --output-format json --json-schema schema.json
```

- Same session that generated code is LESS effective at reviewing it
- Include prior findings on re-runs, instruct to report only NEW issues
- Document testing standards in CLAUDE.md for CI-invoked Claude
