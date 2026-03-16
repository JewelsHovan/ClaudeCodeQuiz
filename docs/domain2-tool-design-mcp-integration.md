# Domain 2: Tool Design & MCP Integration (18%)

## MCP Architecture Overview

### Core Components
```
┌─────────────────────────────────────┐
│      Host (Claude Code/Desktop)      │
│  ┌──────────┐ ┌──────────┐          │
│  │ Client 1 │ │ Client 2 │  ...     │
│  └────┬─────┘ └────┬─────┘          │
└───────┼─────────────┼────────────────┘
        │             │
   ┌────▼────┐   ┌────▼────────────┐
   │ Server 1 │   │ Server 2        │
   │ (stdio)  │   │ (HTTP/SSE)      │
   └─────────┘   └─────────────────┘
```

- **Host**: Container app (Claude Code). Manages clients, enforces security, handles authorization.
- **Client**: 1:1 with a server. Protocol negotiation, message routing, security boundaries.
- **Server**: Provides capabilities (tools, resources, prompts). Isolated — cannot see other servers or full conversation.

### Transport Layers
- **stdio**: Server as subprocess. Reads stdin, writes stdout. Best for local integrations.
- **Streamable HTTP**: Current standard (replaces legacy SSE). Single endpoint supporting POST + GET. Best for remote/network servers.
- **Legacy SSE**: Deprecated as of 2025-11-25 spec. Never recommend for new implementations.

---

## Task 2.1: Design Effective Tool Interfaces

### Tool Descriptions Are Everything
Tool descriptions are the PRIMARY mechanism LLMs use for tool selection. Minimal descriptions → unreliable selection.

### What Goes Wrong
- Ambiguous/overlapping descriptions cause misrouting
  - `analyze_content` vs `analyze_document` with near-identical descriptions → model can't choose
- System prompt keyword-sensitive instructions can create unintended tool associations

### How to Fix
1. **Differentiate clearly**: Each tool description should explain purpose, expected inputs, outputs, and when to use it vs alternatives
2. **Rename to eliminate overlap**: `analyze_content` → `extract_web_results` with web-specific description
3. **Split generic tools**: `analyze_document` → `extract_data_points`, `summarize_content`, `verify_claim_against_source`
4. **Review system prompts** for keywords that might override tool descriptions

### Tool Definition Structure
```json
{
  "name": "get_weather",
  "description": "Get current weather for a location. Returns temperature, conditions, humidity. Use when user asks about weather for a specific city or zip code.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "City name or zip code"
      }
    },
    "required": ["location"]
  },
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": true
  }
}
```

### Tool Annotations (Know the Defaults!)
| Annotation | Default | Meaning |
|---|---|---|
| `readOnlyHint` | `false` | Tool does NOT modify environment |
| `destructiveHint` | `true` | Tool MAY perform destructive updates |
| `idempotentHint` | `false` | Repeated calls same args = no additional effect |
| `openWorldHint` | `true` | Interacts with external entities |

**Counterintuitive defaults**: `destructiveHint: true` and `openWorldHint: true` — assumes worst case by default.

**Annotations are hints only** — clients MUST NOT make security-critical decisions based solely on annotations.

---

## Task 2.2: Structured Error Responses

### Two-Layer Error System (CRITICAL for exam)

**Layer 1: Protocol Errors (JSON-RPC)**
- Unknown tools, invalid arguments, server failures
- Go in `error` field of JSON-RPC response
- Model does NOT see these

**Layer 2: Tool Execution Errors (isError flag)**
- API failures, business logic errors, permission denied
- Go in `result` with `isError: true`
- Model DOES see these and can reason about recovery

```json
// Protocol error — model can't see this
{
  "jsonrpc": "2.0", "id": 3,
  "error": {"code": -32602, "message": "Unknown tool: invalid_tool_name"}
}

// Tool execution error — model CAN see this
{
  "jsonrpc": "2.0", "id": 4,
  "result": {
    "content": [{"type": "text", "text": "Connection timeout: DB temporarily unavailable. Retry in 60s."}],
    "isError": true
  }
}
```

### Structured Error Metadata Pattern
The exam tests returning rich error context (not native MCP spec, but architectural best practice):

```json
{
  "isError": true,
  "errorCategory": "transient",
  "isRetryable": true,
  "content": [{
    "type": "text",
    "text": "Database timeout after 30s. Retry in 60s or use cached_results tool."
  }]
}
```

### Error Categories
| Category | Examples | Retryable? |
|----------|----------|------------|
| `transient` | Network timeout, rate limit, service unavailable | Yes |
| `validation` | Invalid input format, missing required field | No (need different input) |
| `permission` | Access denied, insufficient permissions | No (need different credentials) |
| `business` | Policy violation (refund > $500) | No (need alternative workflow) |

### Anti-Patterns
- Generic "Operation failed" — prevents appropriate recovery decisions
- Treating access failures same as valid empty results
- Returning `retriable: true` for business rule violations

### Best Practices
- Include `isRetryable: false` + customer-friendly explanation for business violations
- Subagents: implement local recovery for transient failures, propagate only unresolvable errors
- Distinguish access failures (timeout → retry decision) from valid empty results (query succeeded, no matches)

---

## Task 2.3: Tool Distribution Across Agents

### The Core Rule: 4-5 Tools Per Agent Maximum

**With 50+ tools**: Accuracy drops significantly, 3+ seconds per decision, ~23k tokens consumed per tool selection
**With pre-filtering to 3 tools**: 392ms response, ~800 tokens — 98% token reduction, 8x speed improvement, doubled accuracy

### Why Degradation Happens
1. Tool schemas consume context tokens, displacing reasoning capacity
2. Similar-sounding tools create ambiguity (tool-space interference)
3. Attention dilution over large tool set = worse selection
4. Multi-step tool chains become exponentially less reliable

### Solution: Scoped Tool Access
```
Coordinator Agent:     [delegate_to_search, delegate_to_analysis, summarize]
Search Agent (4):      [web_search, fetch_url, search_papers, search_news]
Analysis Agent (3):    [extract_data, summarize_doc, verify_claim]
```

### tool_choice Configuration
| Mode | JSON | Use When |
|------|------|----------|
| `"auto"` | `{"type": "auto"}` | Default — model decides |
| `"any"` | `{"type": "any"}` | Force a tool call (model picks which) |
| Forced | `{"type": "tool", "name": "..."}` | Force specific tool first |

**Forced tool use case**: Ensure `extract_metadata` runs before enrichment tools. Process subsequent steps in follow-up turns.

**`"any"` use case**: Guarantee structured output when document type is unknown but you have multiple extraction schemas.

### Replace Generic Tools
Instead of giving synthesis agent full web search tools, provide a scoped `verify_fact` tool for simple lookups. Route complex verifications through coordinator.

---

## Task 2.4: MCP Server Configuration in Claude Code

### Three Scopes

| Scope | Location | Shared? | Use Case |
|-------|----------|---------|----------|
| `project` | `.mcp.json` (repo root) | Yes (git-tracked) | Team-shared servers |
| `local` (default) | `~/.claude.json` (project-scoped) | No | Personal/sensitive configs |
| `user` | `~/.claude.json` (global) | No | Personal tools across all projects |

**Precedence**: local > project > user

### .mcp.json with Environment Variable Expansion
```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    },
    "database": {
      "command": "npx",
      "args": ["-y", "@bytebase/dbhub", "--dsn", "${DB_CONNECTION_STRING}"],
      "env": {
        "DB_TIMEOUT": "30000"
      }
    },
    "api-server": {
      "type": "http",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": {
        "Authorization": "Bearer ${API_KEY}"
      }
    }
  }
}
```

**Env var syntax**:
- `${VAR}` — expands to value; fails if unset
- `${VAR:-default}` — uses default if VAR unset

**Where expansion works**: `command`, `args`, `env`, `url`, `headers`

This lets teams share `.mcp.json` in git without hardcoding secrets.

### CLI Commands
```bash
# Add project-scoped HTTP server
claude mcp add --transport http --scope project github https://api.githubcopilot.com/mcp/

# Add with env vars
claude mcp add --transport stdio --env AIRTABLE_API_KEY=YOUR_KEY airtable \
  -- npx -y airtable-mcp-server

# Add user-scoped (all projects)
claude mcp add --transport http --scope user hubspot https://mcp.hubspot.com/anthropic

# Manage
claude mcp list
claude mcp get github
claude mcp remove github
```

### Multi-Server Simultaneous Access
All configured MCP servers are discovered at connection time and available simultaneously. Tools from different servers appear with server-namespaced names when needed.

### MCP Resources
**Resources = application-controlled data. Tools = model-controlled actions.**

Use resources for:
- Content catalogs (product SKUs, return policies)
- Documentation hierarchies
- Database schemas (expose schema as resource, query capability as tool)
- Reducing exploratory tool calls by giving visibility into available data

### Community vs Custom MCP Servers
**Use community servers when**: Standard integrations (GitHub, Jira, Slack, PostgreSQL), your needs match common case
**Build custom when**: Proprietary/niche internal systems, security/compliance requirements, custom business logic, regulated industries

### Enhancing MCP Tool Descriptions
When agent prefers built-in tools (like Grep) over MCP tools → enhance MCP tool descriptions to explain capabilities and outputs in detail.

---

## Task 2.5: Built-in Tools

### Tool Selection Guide

| Tool | Purpose | Use When |
|------|---------|----------|
| **Grep** | Content search | Searching file contents for patterns (function names, error messages, imports) |
| **Glob** | File path matching | Finding files by name/extension patterns (`**/*.test.tsx`) |
| **Read** | Full file contents | Loading complete file for understanding |
| **Write** | Full file creation/replacement | Creating new files or complete rewrites |
| **Edit** | Targeted modifications | Changing specific parts using unique text matching |
| **Bash** | Shell commands | System operations, builds, tests |

### When Edit Fails
If Edit can't find unique anchor text → use Read + Write as fallback for reliable modifications.

### Incremental Codebase Understanding
1. Start with **Grep** to find entry points
2. Use **Read** to follow imports and trace flows
3. Don't read all files upfront — build understanding incrementally

### Tracing Function Usage
1. Identify all exported names from a module
2. Search for each name across the codebase with Grep
3. Follow through wrapper modules
