# MCP Deep Dive — Your Focus Area

This is your targeted study material for MCP. The exam tests MCP across Domain 2 (18%) and it appears in scenarios 1, 3, 4, and 6.

---

## 1. The Mental Model

**MCP = a standard way to give Claude access to external data and actions.**

Think of it as USB-C for AI tools — a universal connector protocol. Instead of building custom integrations for every data source, you plug in MCP servers.

### The Control Model (EXAM CRITICAL)
```
Resources = APPLICATION-controlled (read-only data for the model to reason from)
Tools     = MODEL-controlled (actions the model decides to invoke)
```

If you get one thing from MCP, it's this distinction.

---

## 2. Architecture in 60 Seconds

```
Host (Claude Code)
  └── Client 1 ←→ Server A (GitHub - stdio subprocess)
  └── Client 2 ←→ Server B (Database - HTTP)
  └── Client 3 ←→ Server C (Custom API - HTTP)
```

- **Host**: Your app (Claude Code). Manages everything.
- **Client**: 1:1 with each server. Handles protocol negotiation.
- **Server**: Provides tools/resources. Isolated — can't see other servers.

**Key**: Servers are isolated from each other. A server cannot see the conversation or other servers' tools. The Host enforces security boundaries.

---

## 3. Transport: When to Use What

| Transport | When | How |
|-----------|------|-----|
| **stdio** | Local tools, CLI tools, direct system access | Server = subprocess, reads stdin, writes stdout |
| **Streamable HTTP** | Remote/network servers, multi-user | Single endpoint, POST + GET, supports SSE |
| ~~Legacy SSE~~ | **NEVER for new code** | Deprecated since 2025-11-25 spec |

---

## 4. Tool Definitions — What the Exam Tests

### Structure
```json
{
  "name": "search_github_issues",
  "description": "Search GitHub issues by query string. Returns issue titles, numbers, and labels. Use when the user asks to find issues, bugs, or feature requests. NOT for PR reviews — use review_pull_request instead.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query" },
      "repo": { "type": "string", "description": "owner/repo format" },
      "state": { "type": "string", "enum": ["open", "closed", "all"], "default": "open" }
    },
    "required": ["query", "repo"]
  }
}
```

### Description Best Practices (High-Yield)
1. **Be specific**: "Search GitHub issues by query" not just "Search"
2. **Explain when to use AND when NOT to use**: "Use for X. NOT for Y — use Z instead."
3. **Include input formats**: "repo should be in owner/repo format"
4. **Differentiate from similar tools**: If you have `analyze_content` and `analyze_document`, rename one to `extract_web_results`

### Tool Annotations
| Annotation | Default | Note |
|---|---|---|
| `readOnlyHint` | **false** | |
| `destructiveHint` | **true** | Defaults assume worst case! |
| `idempotentHint` | **false** | |
| `openWorldHint` | **true** | |

The defaults are "assume dangerous" — this is counterintuitive and testable.

---

## 5. The Two-Layer Error System (HIGH YIELD)

This is probably the most exam-tested MCP concept.

### Layer 1: Protocol Errors
```json
{
  "jsonrpc": "2.0", "id": 3,
  "error": { "code": -32602, "message": "Unknown tool" }
}
```
- For: unknown tools, invalid arguments, server crashes
- The model CANNOT see these
- Standard JSON-RPC error codes

### Layer 2: Tool Execution Errors
```json
{
  "jsonrpc": "2.0", "id": 4,
  "result": {
    "content": [{ "type": "text", "text": "Database timeout. Retry in 60s or try cached_results." }],
    "isError": true
  }
}
```
- For: business logic failures, API errors, permission issues
- The model CAN see these and reason about recovery
- Go in `result` with `isError: true`, NOT in the `error` field

### Structured Error Metadata
```json
{
  "isError": true,
  "errorCategory": "transient",    // transient | validation | permission
  "isRetryable": true,
  "content": [{
    "type": "text",
    "text": "Connection timeout. Retry in 60s."
  }]
}
```

**Error category cheat sheet:**
- `transient` → retryable (timeout, rate limit, temp unavailability)
- `validation` → NOT retryable (bad input, need different input)
- `permission` → NOT retryable (access denied, need different credentials)

### What NOT to Do
- Generic "Operation failed" — prevents recovery decisions
- Uniform error responses — model can't distinguish retry-worthy from permanent
- Return empty results as success for failures — suppresses error handling
- Return `isRetryable: true` for business rule violations

---

## 6. Server Configuration in Claude Code (HIGH YIELD)

### .mcp.json (Project Scope — Git Tracked)
```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    },
    "my-db": {
      "command": "npx",
      "args": ["-y", "@bytebase/dbhub", "--dsn", "${DB_CONNECTION_STRING}"],
      "env": { "TIMEOUT": "30000" }
    },
    "custom-api": {
      "type": "http",
      "url": "${API_URL:-https://default.example.com}/mcp",
      "headers": {
        "Authorization": "Bearer ${API_KEY}"
      }
    }
  }
}
```

### Environment Variable Syntax
```
${VAR}           → expands to value, FAILS if unset
${VAR:-default}  → uses default if VAR is unset
```

Works in: `command`, `args`, `env`, `url`, `headers`

### Scope System
| Scope | Location | Shared? | Use Case |
|-------|----------|---------|----------|
| `project` | `.mcp.json` | Yes (git) | Team servers |
| `local` (default) | `~/.claude.json` (project-scoped) | No | Personal/sensitive |
| `user` | `~/.claude.json` (global) | No | Personal, all projects |

**Precedence**: local > project > user

### CLI
```bash
claude mcp add --transport http --scope project github https://api.githubcopilot.com/mcp/
claude mcp add --transport stdio --env API_KEY=xxx myserver -- npx -y my-mcp-server
claude mcp list
claude mcp get github
claude mcp remove github
```

---

## 7. Resources — The Other Half

### When to Use Resources
- **Content catalogs**: Product SKUs, return policies, company handbooks
- **Documentation hierarchies**: API docs, schema references
- **Database schemas**: Expose schema as resource, query capability as tool
- **Reducing tool calls**: Give agent visibility into available data without exploratory calls

### Resource Structure
```json
{
  "uri": "file:///project/schema.sql",
  "name": "Database Schema",
  "mimeType": "text/plain",
  "annotations": {
    "audience": ["assistant"],
    "priority": 0.8
  }
}
```

### Resources vs Tools Decision
```
Q: Does the model need this to REASON from? (read-only reference data)
   → RESOURCE

Q: Does the model need to DO something? (execute, create, modify)
   → TOOL
```

---

## 8. Tool Distribution (Cross-Cuts with Domain 1)

### The Rule
**4-5 tools per agent maximum for reliable selection.**

18 tools → degraded accuracy, 3+ second decisions, ~23k tokens wasted
3 tools (pre-filtered) → correct in 392ms, ~800 tokens, doubled accuracy

### The Pattern
```
Coordinator:    [delegate_search, delegate_analysis, delegate_synthesis]
Search Agent:   [web_search, fetch_url, search_papers]
Analysis Agent: [extract_data, summarize_doc, verify_claim]
Synthesis Agent:[compile_report, verify_fact]  ← scoped cross-role tool
```

### Scoped Cross-Role Tools
Instead of giving synthesis agent all web search tools, give it a scoped `verify_fact` tool for the 85% common case (simple lookups). Route complex verifications through coordinator.

---

## 9. Community vs Custom MCP Servers

### Use Community When
- Standard platform integration (GitHub, Jira, Slack, PostgreSQL, Stripe)
- Your needs match the common case
- Speed to deployment matters

### Build Custom When
- Proprietary internal systems
- Regulated industries (healthcare, finance)
- Custom business logic, audit requirements
- Security requires in-house control

### Always
- Code-review community servers before production use
- Be aware of prompt injection risk with servers that fetch untrusted content

---

## 10. Exam Traps for MCP

1. **"isError goes in the error field"** — NO. `isError: true` goes in the `result`. Protocol errors go in `error`.
2. **"Community MCP server vs custom"** — Community first for standard integrations. Custom for niche/regulated.
3. **"MCP resources are like tools"** — NO. Resources = app-controlled read data. Tools = model-controlled actions.
4. **"Add more tools for more capability"** — NO. More tools = worse selection. Partition into subagents.
5. **"Environment variables are insecure in .mcp.json"** — NO. `${VAR}` expansion means secrets aren't committed.
6. **"Put server config in CLAUDE.md"** — NO. Server config goes in `.mcp.json` or `~/.claude.json`.
