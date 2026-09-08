# Research notes

Sourced research backing the corrections in `docs/exam-cheat-sheet.md` and the question bank.
Gathered 2026-09-07 from Anthropic primary sources — the MCP specification, platform and Claude Code
docs, and the Anthropic engineering blog.

| File | Covers |
|---|---|
| `research-mcp-jsonrpc.md` | JSON-RPC envelopes, the `initialize` handshake, capability negotiation, the three primitives with full payloads, the two-layer error model, transports, tool description quality, annotations |
| `research-agentic-orchestration.md` | Workflow patterns vs agents, `stop_reason` and the agent loop, parallel tool use, orchestrator/subagent architecture and token economics, tool distribution, context engineering, evaluation |
| `research-community-banks.md` | Survey of community question banks and study repos — licences, quality, and per-domain topic intelligence. Read for coverage, not for text |
| `research-prompt-structured-claudecode.md` | Structured output and the guarantee boundary, `tool_choice` and thinking, schema design, prefilling, prompt techniques, the Batch API, Claude Code configuration and headless CI |

Each file ends with an explicit **verification gaps** section listing what could not be confirmed
from a primary source. Read those before quoting a number. Notable exclusions we deliberately do
**not** teach: a "10–40% lower mid-context recall" figure (third-party synthesis, not Anthropic), an
"84% token reduction" memory-tool number that could not be confirmed by direct fetch, and any
quantitative tool-count-versus-accuracy curve — only the qualitative 20+ tools threshold is real.

The exam is pinned to **Exam Guide v1.0, July 2026**. These notes describe current platform behaviour
too; where the two diverge the files say so. Answer the exam with the exam-era model.
