# MCP and the JSON-RPC Layer — Research Notes

Scope: exam-era MCP model (spec revision **2025-06-18** — the last revision before the
2026-07-28 rewrite). Anthropic-specific guidance drawn from platform.claude.com,
code.claude.com, and anthropic.com/engineering. A closing section lists 2026-07-28 terms
that are **NOT examined**, so they can be recognized as distractors.

Research date: 2026-09-07.

---

## 1. JSON-RPC 2.0 envelopes as MCP uses them

Source: [modelcontextprotocol.io/specification/2025-06-18/basic](https://modelcontextprotocol.io/specification/2025-06-18/basic)

MCP is JSON-RPC 2.0 with a few tightenings. Three message shapes:

**Request** (either side can initiate; client→server and server→client both use this shape):
```typescript
{
  jsonrpc: "2.0";
  id: string | number;      // MUST be present, MUST NOT be null (stricter than base JSON-RPC)
  method: string;
  params?: {
    [key: string]: unknown;
  };
}
```
Rules, verbatim from the spec:
- Requests **MUST** include a string or integer ID.
- Unlike base JSON-RPC, the ID **MUST NOT** be `null`.
- The request ID **MUST NOT** have been previously used by the requestor within the same session.

Gotcha: IDs are scoped **per-session, per-sender** — not a single global pool shared by both directions of the connection.

**Response:**
```typescript
{
  jsonrpc: "2.0";
  id: string | number;
  result?: {
    [key: string]: unknown;
  }
  error?: {
    code: number;
    message: string;
    data?: unknown;
  }
}
```
Rules, verbatim:
- Responses **MUST** include the same ID as the request they correspond to.
- Responses are sub-categorized as **successful results** or **errors**. Either `result` or `error` **MUST** be set. A response **MUST NOT** set both.
- Results **MAY** follow any JSON object structure, while errors **MUST** include an error code and message at minimum.
- Error codes **MUST** be integers.

**Notification** (one-way, no reply):
```typescript
{
  jsonrpc: "2.0";
  method: string;
  params?: {
    [key: string]: unknown;
  };
}
```
- Notifications **MUST NOT** include an ID.
- The receiver **MUST NOT** send a response.

### Batching — removed

Source: [modelcontextprotocol.io/specification/2025-06-18/changelog](https://modelcontextprotocol.io/specification/2025-06-18/changelog),
corroborated by search results referencing PR [#416](https://github.com/modelcontextprotocol/specification/pull/416).

> Remove support for JSON-RPC **batching** (PR #416)

Maintainers' stated reason (per secondary sources summarizing the PR discussion): "no compelling
use case for batching." This is a breaking change vs. the prior 2025-03-26 revision, which did
support batching. **Exam trap:** JSON-RPC 2.0 itself supports batch arrays (`[{...},{...}]`);
MCP (2025-06-18 and the exam-era model generally) explicitly does not.

### Standard `ErrorCode` constants

Source: raw `schema.ts` for 2025-06-18, GitHub —
[modelcontextprotocol/modelcontextprotocol](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2025-06-18/schema.ts)

```typescript
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;
```

These are the raw JSON-RPC 2.0 codes, unmodified by MCP. The fetched schema.ts does **not**
define an enum of additional MCP-specific codes beyond these five constants. MCP-specific
server errors (e.g., "Resource not found") use ordinary integers servers pick themselves,
within the range JSON-RPC 2.0 itself reserves for implementation-defined server errors
(-32000 to -32099). Concrete example from the spec's Resources page
([modelcontextprotocol.io/specification/2025-06-18/server/resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)):

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "error": {
    "code": -32002,
    "message": "Resource not found",
    "data": { "uri": "file:///nonexistent.txt" }
  }
}
```
(`-32002` = Resource not found; `-32603` = Internal errors, per the same page.)

**NOT VERIFIED FROM A PRIMARY SOURCE:** some third-party blog posts claim a formal
sub-partition of the -32000..-32099 range for MCP (e.g., "-32000 to -32019 = legacy").
I could not confirm this against modelcontextprotocol.io or the schema — treat it as
unconfirmed, not exam material.

### `_meta` field rules

Source: [modelcontextprotocol.io/specification/2025-06-18/basic](https://modelcontextprotocol.io/specification/2025-06-18/basic)

> The `_meta` property/parameter is reserved by MCP to allow clients and servers to attach
> additional metadata to their interactions. Certain key names are reserved by MCP for
> protocol-level metadata... implementations MUST NOT make assumptions about values at
> these keys.

Key name format — two segments, an optional **prefix** and a **name**:
- **Prefix**, if specified, **MUST** be a series of dot-separated labels followed by a slash
  (`/`). Labels **MUST** start with a letter and end with a letter or digit; interior
  characters can be letters, digits, or hyphens.
- Any prefix beginning with zero or more valid labels, followed by `modelcontextprotocol`
  or `mcp`, followed by any valid label, is **reserved** for MCP use. Examples given as
  reserved: `modelcontextprotocol.io/`, `mcp.dev/`, `api.modelcontextprotocol.org/`,
  `tools.mcp.com/`.
- **Name**: unless empty, **MUST** begin and end with an alphanumeric character
  (`[a-z0-9A-Z]`). **MAY** contain hyphens, underscores, dots, and alphanumerics in between.

---

## 2. The `initialize` handshake, capability table, version negotiation

Source: [modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)

Three lifecycle phases: **Initialization** → **Operation** → **Shutdown**. Initialization
**MUST** be the first interaction.

### Step 1 — client sends `initialize` (a request, gets an `id`)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "roots": {
        "listChanged": true
      },
      "sampling": {},
      "elicitation": {}
    },
    "clientInfo": {
      "name": "ExampleClient",
      "title": "Example Client Display Name",
      "version": "1.0.0"
    }
  }
}
```

### Step 2 — server responds with its own capabilities + info

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "logging": {},
      "prompts": {
        "listChanged": true
      },
      "resources": {
        "subscribe": true,
        "listChanged": true
      },
      "tools": {
        "listChanged": true
      }
    },
    "serverInfo": {
      "name": "ExampleServer",
      "title": "Example Server Display Name",
      "version": "1.0.0"
    },
    "instructions": "Optional instructions for the client"
  }
}
```

### Step 3 — client sends `initialized` (a **notification** — no `id`, no reply)

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

Ordering rules, verbatim:
- The client **SHOULD NOT** send requests other than pings before the server has responded
  to the `initialize` request.
- The server **SHOULD NOT** send requests other than pings and logging before receiving the
  `initialized` notification.

### Capability table

| Category | Capability     | Description                                                                             |
| -------- | -------------- | ---------------------------------------------------------------------------------------- |
| Client   | `roots`        | Ability to provide filesystem roots                                                      |
| Client   | `sampling`     | Support for LLM sampling requests                                                        |
| Client   | `elicitation`  | Support for server elicitation requests                                                  |
| Client   | `experimental` | Describes support for non-standard experimental features                                |
| Server   | `prompts`      | Offers prompt templates                                                                  |
| Server   | `resources`    | Provides readable resources                                                              |
| Server   | `tools`        | Exposes callable tools                                                                   |
| Server   | `logging`      | Emits structured log messages                                                            |
| Server   | `completions`  | Supports argument autocompletion                                                         |
| Server   | `experimental` | Describes support for non-standard experimental features                                |

Sub-capability flags:
- **`listChanged`** — prompts, resources, and tools capabilities. "I will emit a
  `notifications/<x>/list_changed` message if my available set changes."
- **`subscribe`** — resources only. "You can call `resources/subscribe` on individual
  resource URIs and I'll push `notifications/resources/updated` when that one changes."

These are independent — a server can support neither, either, or both for resources:
```json
{ "capabilities": { "resources": {} } }
```
```json
{ "capabilities": { "resources": { "subscribe": true } } }
```
```json
{ "capabilities": { "resources": { "listChanged": true } } }
```

Both parties **MUST** respect the negotiated protocol version and **MUST** only use
capabilities that were successfully negotiated.

### Version negotiation — a soft-fail protocol, not exact-match

> In the `initialize` request, the client **MUST** send a protocol version it supports.
> This **SHOULD** be the latest version supported by the client. If the server supports the
> requested protocol version, it **MUST** respond with the same version. Otherwise, the
> server **MUST** respond with another protocol version it supports. This **SHOULD** be the
> latest version supported by the server. If the client does not support the version in the
> server's response, it **SHOULD** disconnect.

If using HTTP, the client **MUST** include `MCP-Protocol-Version: <protocol-version>` on all
subsequent requests (see §5 below for the HTTP-specific fallback default).

Example initialization error (hard failure case — version genuinely incompatible):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Unsupported protocol version",
    "data": {
      "supported": ["2024-11-05"],
      "requested": "1.0.0"
    }
  }
}
```

---

## 3. The three primitives — methods, payloads, and how a host chooses

| Primitive | Control model (spec's own term) | List method | Fetch/invoke method | Extra methods |
|---|---|---|---|---|
| Tools | **model-controlled** | `tools/list` | `tools/call` | `notifications/tools/list_changed` |
| Resources | **application-driven** | `resources/list` | `resources/read` | `resources/templates/list`, `resources/subscribe`, `notifications/resources/updated`, `notifications/resources/list_changed` |
| Prompts | **user-controlled** | `prompts/list` | `prompts/get` | `notifications/prompts/list_changed` |

Sources:
[server/tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools),
[server/resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources),
[server/prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts)

Mental model, from the spec's own wording:
- **Tools** — "the language model can discover and invoke tools automatically based on its
  contextual understanding and the user's prompts."
- **Resources** — "application-driven, with host applications determining how to incorporate
  context based on their needs" — e.g. a tree/list picker UI, search+filter, or automatic
  inclusion by heuristic. (Claude Code surfaces these as `@`-mentions.)
- **Prompts** — "designed to be user-controlled... exposed from servers to clients with the
  intention of the user being able to explicitly select them," typically as slash commands.
  (Claude Code surfaces these literally as slash commands.)

### Tools capability declaration

```json
{
  "capabilities": {
    "tools": {
      "listChanged": true
    }
  }
}
```

### `tools/list`

Request:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {
    "cursor": "optional-cursor-value"
  }
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "get_weather",
        "title": "Weather Information Provider",
        "description": "Get current weather information for a location",
        "inputSchema": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "City name or zip code"
            }
          },
          "required": ["location"]
        }
      }
    ],
    "nextCursor": "next-page-cursor"
  }
}
```

### `tools/call`

Request:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": {
      "location": "New York"
    }
  }
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Current weather in New York:\nTemperature: 72°F\nConditions: Partly cloudy"
      }
    ],
    "isError": false
  }
}
```

(Note: no `resultType` wrapper in the exam-era spec — that's a 2026-07-28 addition, see §8.)

### Structured tool output (added in 2025-06-18, so IS exam-era)

Tool with `outputSchema`:
```json
{
  "name": "get_weather_data",
  "title": "Weather Data Retriever",
  "description": "Get current weather data for a location",
  "inputSchema": {
    "type": "object",
    "properties": {
      "location": { "type": "string", "description": "City name or zip code" }
    },
    "required": ["location"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "temperature": { "type": "number", "description": "Temperature in celsius" },
      "conditions": { "type": "string", "description": "Weather conditions description" },
      "humidity": { "type": "number", "description": "Humidity percentage" }
    },
    "required": ["temperature", "conditions", "humidity"]
  }
}
```

Matching response — `structuredContent` alongside a backward-compatible serialized
`TextContent` block:
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "content": [
      { "type": "text", "text": "{\"temperature\": 22.5, \"conditions\": \"Partly cloudy\", \"humidity\": 65}" }
    ],
    "structuredContent": {
      "temperature": 22.5,
      "conditions": "Partly cloudy",
      "humidity": 65
    }
  }
}
```
Note: `structuredContent` is server-produced result data — unrelated to LLM "structured
outputs" (schema-constrained generation). Rule: if `outputSchema` is provided, servers
**MUST** provide structured results conforming to it; clients **SHOULD** validate.

### Tool result content block types

Text:
```json
{ "type": "text", "text": "Tool result text" }
```
Image (shows annotation usage):
```json
{
  "type": "image",
  "data": "base64-encoded-data",
  "mimeType": "image/png",
  "annotations": { "audience": ["user"], "priority": 0.9 }
}
```
Audio:
```json
{ "type": "audio", "data": "base64-encoded-audio-data", "mimeType": "audio/wav" }
```
Resource link (tool points at a resource rather than embedding it):
```json
{
  "type": "resource_link",
  "uri": "file:///project/src/main.rs",
  "name": "main.rs",
  "description": "Primary application entry point",
  "mimeType": "text/x-rust",
  "annotations": { "audience": ["assistant"], "priority": 0.9 }
}
```
(Resource links returned by tools are **not guaranteed** to appear in `resources/list`
results.)

Embedded resource:
```json
{
  "type": "resource",
  "resource": {
    "uri": "file:///project/src/main.rs",
    "mimeType": "text/x-rust",
    "text": "fn main() {\n    println!(\"Hello world!\");\n}",
    "annotations": {
      "audience": ["user", "assistant"],
      "priority": 0.7,
      "lastModified": "2025-05-03T14:30:00Z"
    }
  }
}
```

### List-changed notification (tools)

```json
{ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" }
```

### Resources

Capability:
```json
{ "capabilities": { "resources": { "subscribe": true, "listChanged": true } } }
```

`resources/list` request:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/list",
  "params": { "cursor": "optional-cursor-value" }
}
```
Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "resources": [
      {
        "uri": "file:///project/src/main.rs",
        "name": "main.rs",
        "title": "Rust Software Application Main File",
        "description": "Primary application entry point",
        "mimeType": "text/x-rust"
      }
    ],
    "nextCursor": "next-page-cursor"
  }
}
```

`resources/read` request:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": { "uri": "file:///project/src/main.rs" }
}
```
Response:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "contents": [
      {
        "uri": "file:///project/src/main.rs",
        "mimeType": "text/x-rust",
        "text": "fn main() {\n    println!(\"Hello world!\");\n}"
      }
    ]
  }
}
```

Binary resource content:
```json
{ "uri": "file:///example.png", "mimeType": "image/png", "blob": "base64-encoded-data" }
```

`resources/templates/list` — RFC 6570 URI templates, args auto-completable via the
completion API:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "resources/templates/list",
  "params": { "cursor": "optional-cursor-value" }
}
```
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "resourceTemplates": [
      {
        "uriTemplate": "file:///{path}",
        "name": "Project Files",
        "title": "📁 Project Files",
        "description": "Access files in the project directory",
        "mimeType": "application/octet-stream"
      }
    ],
    "nextCursor": "next-page-cursor"
  }
}
```

List-changed notification:
```json
{ "jsonrpc": "2.0", "method": "notifications/resources/list_changed" }
```

Subscribe request:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "resources/subscribe",
  "params": { "uri": "file:///project/src/main.rs" }
}
```
Update push notification (server → client, after subscribing):
```json
{
  "jsonrpc": "2.0",
  "method": "notifications/resources/updated",
  "params": { "uri": "file:///project/src/main.rs" }
}
```

**Annotations** (shared format reused across resources, resource templates, and all
tool/prompt content blocks):
- `audience`: array of `"user"` and/or `"assistant"`.
- `priority`: 0.0 (least important / optional) to 1.0 (most important / effectively
  required).
- `lastModified`: ISO 8601 timestamp, e.g. `"2025-01-12T15:00:58Z"`.

```json
{
  "uri": "file:///project/README.md",
  "name": "README.md",
  "title": "Project Documentation",
  "mimeType": "text/markdown",
  "annotations": {
    "audience": ["user"],
    "priority": 0.8,
    "lastModified": "2025-01-12T15:00:58Z"
  }
}
```

**Common URI schemes** (non-exhaustive, per spec):
- `https://` — only when the *client* can fetch/load it directly itself; otherwise prefer
  another scheme even if the server itself downloads over the internet.
- `file://` — filesystem-like resources; need not map to a real filesystem. May use XDG
  MIME types (e.g. `inode/directory`) for non-regular files like directories.
- `git://` — git version control integration.
- Custom schemes — **MUST** follow RFC 3986.

Resource error handling:
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "error": {
    "code": -32002,
    "message": "Resource not found",
    "data": { "uri": "file:///nonexistent.txt" }
  }
}
```
(`-32002` Resource not found, `-32603` Internal errors.)

### Prompts

Capability:
```json
{ "capabilities": { "prompts": { "listChanged": true } } }
```

`prompts/list` request:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "prompts/list",
  "params": { "cursor": "optional-cursor-value" }
}
```
Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "prompts": [
      {
        "name": "code_review",
        "title": "Request Code Review",
        "description": "Asks the LLM to analyze code quality and suggest improvements",
        "arguments": [
          { "name": "code", "description": "The code to review", "required": true }
        ]
      }
    ],
    "nextCursor": "next-page-cursor"
  }
}
```

`prompts/get` request (arguments auto-completable via completion API):
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "prompts/get",
  "params": {
    "name": "code_review",
    "arguments": { "code": "def hello():\n    print('world')" }
  }
}
```
Response:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "description": "Code review prompt",
    "messages": [
      {
        "role": "user",
        "content": {
          "type": "text",
          "text": "Please review this Python code:\ndef hello():\n    print('world')"
        }
      }
    ]
  }
}
```

Gotcha: `PromptMessage.role` is only `"user"` or `"assistant"` — narrower than the general
Anthropic Messages API. Content types mirror tool-result content types (text, image, audio,
embedded resource), all supporting the same annotations.

Embedded resource in a prompt message:
```json
{
  "type": "resource",
  "resource": {
    "uri": "resource://example",
    "mimeType": "text/plain",
    "text": "Resource content"
  }
}
```

List-changed notification:
```json
{ "jsonrpc": "2.0", "method": "notifications/prompts/list_changed" }
```

Prompt error handling (per spec): invalid prompt name → `-32602`; missing required
arguments → `-32602`; internal errors → `-32603`.

---

## 4. The two-layer error model

Source: [modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

Two mechanisms, deliberately separated by whether the *model* can plausibly self-correct:

> Tools use two error reporting mechanisms:
>
> 1. **Protocol Errors**: Standard JSON-RPC errors for issues like:
>    - Unknown tools
>    - Invalid arguments
>    - Server errors
>
> 2. **Tool Execution Errors**: Reported in tool results with `isError: true`:
>    - API failures
>    - Invalid input data
>    - Business logic errors

**Layer 1 — protocol error** (a real JSON-RPC `error`, standard codes):
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32602,
    "message": "Unknown tool: invalid_tool_name"
  }
}
```

**Layer 2 — tool execution error** (a *successful* JSON-RPC `result`, `isError: true` inside):
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      { "type": "text", "text": "Failed to fetch weather data: API rate limit exceeded" }
    ],
    "isError": true
  }
}
```

### The SHOULD/MAY distinction (quoted precisely)

From the current (2026-07-28) spec's Tools error-handling page, which restates and
sharpens the same exam-era two-layer model with explicit normative language (I could not
find the SHOULD/MAY wording verbatim on the archived 2025-06-18 tools page itself, but the
underlying two-mechanism split is identical across both revisions — quoting the version
where the modal verbs are explicit):

> Clients **MAY** provide protocol errors to language models, though these are less likely
> to result in successful recovery.
> Clients **SHOULD** provide tool execution errors to language models to enable
> self-correction.

Rationale given in the spec text itself:
> **Protocol Errors** indicate issues with the request structure itself that models are
> less likely to be able to fix... **Tool Execution Errors** contain actionable feedback
> that language models can use to self-correct and retry with adjusted parameters.

Practical takeaway: what the model actually "sees" for a failed tool call is whatever text
is placed in `result.content` for an `isError: true` result — this is why error-message
wording is treated as a first-class tool-design surface (see §6).

Source for this section:
[modelcontextprotocol.io/specification/2025-06-18/server/tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
(exact JSON + the two-mechanism list) and the current spec's tools error page (SHOULD/MAY
wording) surfaced via WebFetch of `modelcontextprotocol.io/docs/concepts/tools`, which
resolves to the 2026-07-28 tree.

---

## 5. Transports

Source: [modelcontextprotocol.io/specification/2025-06-18/basic/transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)

> MCP uses JSON-RPC to encode messages. JSON-RPC messages **MUST** be UTF-8 encoded.

Two standard transports: **stdio** and **Streamable HTTP**. "Clients **SHOULD** support
stdio whenever possible." Custom transports are permitted if they preserve JSON-RPC message
format and lifecycle requirements.

### stdio

- Client launches the MCP server as a subprocess.
- Server reads JSON-RPC from its `stdin`, writes to its `stdout`.
- Messages are **delimited by newlines** and **MUST NOT contain embedded newlines**.
- Server **MAY** write UTF-8 strings to `stderr` for logging; client **MAY** capture,
  forward, or ignore this.
- Server **MUST NOT** write anything to `stdout` that is not a valid MCP message.
- Client **MUST NOT** write anything to the server's `stdin` that is not a valid MCP
  message.
- Shutdown: client closes stdin → waits, sending `SIGTERM` if the server doesn't exit in a
  reasonable time → `SIGKILL` if it still doesn't exit.

### Streamable HTTP

> This replaces the HTTP+SSE transport from protocol version 2024-11-05.

- Server provides a **single** HTTP endpoint (the "MCP endpoint") supporting both POST and
  GET, e.g. `https://example.com/mcp`.
- Server can optionally use SSE to stream multiple server messages.

**Sending messages to the server:**
1. Client **MUST** use HTTP POST to the MCP endpoint for every JSON-RPC message.
2. Client **MUST** include `Accept: application/json, text/event-stream`.
3. POST body **MUST** be a single JSON-RPC request, notification, or response.
4. If input is a response/notification: server accepts → **202 Accepted, no body**; server
   can't accept → HTTP error status (e.g. 400), optionally with a JSON-RPC error response
   that has no `id`.
5. If input is a request: server **MUST** return either `Content-Type: text/event-stream`
   (opens an SSE stream) or `Content-Type: application/json` (one JSON object). Client
   **MUST** support both.
6. If SSE: the stream **SHOULD** eventually carry the JSON-RPC response for that request;
   server **MAY** send other requests/notifications first (related to the originating
   request); server **SHOULD NOT** close the stream before sending the response (unless the
   session expires); after sending the response, server **SHOULD** close the stream.
   Disconnection is not the same as cancellation — client must send an explicit
   `CancelledNotification` to cancel.

**Listening for server-initiated messages:**
- Client **MAY** GET the MCP endpoint to open a standing SSE stream for server push,
  without first POSTing.
- Client **MUST** include `Accept: text/event-stream`.
- Server **MUST** return `text/event-stream` or `405 Method Not Allowed`.
- Server **MUST NOT** send a JSON-RPC response on this GET-opened stream unless resuming a
  previous request's stream.

**Multiple connections:** client may hold several SSE streams at once; server **MUST NOT**
broadcast the same message across multiple streams — each message goes out on exactly one
stream.

**Resumability and redelivery:**
- Servers **MAY** attach a globally-unique (per session, or per client if no session) `id`
  to SSE events per the SSE spec.
- Client resumes via HTTP GET with a `Last-Event-ID` header; server **MAY** replay messages
  after that ID **on the same disconnected stream only** — never messages that would have
  gone out on a different stream.

**Session management:**
- Server **MAY** assign a session ID at initialize time via an `Mcp-Session-Id` header on
  the response carrying `InitializeResult`. Should be globally unique and cryptographically
  secure (UUID, JWT, or crypto hash); must contain only visible ASCII (0x21–0x7E).
- If assigned, client **MUST** echo `Mcp-Session-Id` on all subsequent requests. Servers
  requiring a session ID **SHOULD** respond 400 to requests missing it (other than
  initialize).
- Server **MAY** terminate a session anytime; subsequent requests with that ID get
  **404**. Client seeing 404 with a session ID **MUST** start a new session (new
  `InitializeRequest`, no session ID).
- Client no longer needing a session **SHOULD** send HTTP DELETE with `Mcp-Session-Id` to
  explicitly terminate it; server **MAY** respond 405 if it doesn't support client-initiated
  termination.

**Protocol version header:**
> If using HTTP, the client **MUST** include the `MCP-Protocol-Version: <protocol-version>`
> HTTP header on all subsequent requests to the MCP server.

Example: `MCP-Protocol-Version: 2025-06-18`. Should be the version negotiated at
initialize.

> For backwards compatibility, if the server does *not* receive an `MCP-Protocol-Version`
> header, and has no other way to identify the version... the server **SHOULD** assume
> protocol version `2025-03-26`.

If the server receives an invalid/unsupported `MCP-Protocol-Version`, it **MUST** respond
`400 Bad Request`.

### Why legacy HTTP+SSE is deprecated

The old (2024-11-05) transport needed **two separate endpoints** — one for the SSE stream,
one for POST — versus Streamable HTTP's **single endpoint** that can respond either as
plain JSON or as an SSE stream per-request, as needed. This simplifies deployment (no need
for sticky/stateful routing across two endpoint types) while still supporting streaming and
server-initiated messages when useful.

Backwards-compat recipe given by the spec:
- **Servers** supporting old clients: keep hosting both the old SSE+POST endpoints
  alongside the new MCP endpoint (or combine old POST + new MCP endpoint, at the cost of
  added complexity).
- **Clients** supporting old servers: POST an `InitializeRequest` to the server URL with the
  required `Accept` header first. Success → assume Streamable HTTP. HTTP 4xx (405/404) →
  fall back to GET, expect an `endpoint` SSE event as the first event → assume old
  HTTP+SSE transport for all further communication.

### Security warnings for remote servers (verbatim)

> When implementing Streamable HTTP transport:
> 1. Servers **MUST** validate the `Origin` header on all incoming connections to prevent
>    DNS rebinding attacks
> 2. When running locally, servers **SHOULD** bind only to localhost (127.0.0.1) rather than
>    all network interfaces (0.0.0.0)
> 3. Servers **SHOULD** implement proper authentication for all connections
>
> Without these protections, attackers could use DNS rebinding to interact with local MCP
> servers from remote websites.

Mechanism: a malicious webpage's JavaScript could induce a victim's browser to send
requests that land on the victim's own locally-bound MCP server; without Origin validation
the server can't distinguish that from a legitimate local client request.

---

## 6. Tool description quality — "Writing effective tools for agents"

Source: [anthropic.com/engineering/writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
(Anthropic engineering blog). This is prescriptive/evaluation-backed guidance, not spec
text.

### Don't 1:1-wrap your API

> A common error we've observed is tools that merely wrap existing software functionality
> or API endpoints.

Instead, design tools around a *workflow*:
- Collapse `list_users` + `list_events` + `create_event` into a single `schedule_event`
  tool that handles availability-finding and scheduling internally.
- Replace `read_logs` with `search_logs` that returns only relevant entries with context.
- Combine `get_customer_by_id` + `list_transactions` + `list_notes` into a unified
  `get_customer_context` tool.

### Unambiguous parameter naming

> Input parameters should be unambiguously named: instead of a parameter named `user`, try
> a parameter named `user_id`.

### Namespacing for large tool surfaces

- Service-based: `asana_search`, `jira_search`.
- Resource-based: `asana_projects_search`, `asana_users_search`.

> Effects vary by LLM and we encourage you to choose a naming scheme according to your own
> evaluations.

### High-signal responses over low-level identifiers

> [avoid] low-level technical identifiers (for example: `uuid`, `256px_image_url`,
> `mime_type`) [prefer human-interpretable fields like `name`, `image_url`, `file_type`]

Resolving UUIDs to meaningful names "significantly improves Claude's precision in retrieval
tasks by reducing hallucinations."

### Token efficiency

- Pagination, filtering, sensible truncation defaults.
- Claude Code "restrict[s] tool responses to 25,000 tokens by default."
- When truncating, give steering instructions, e.g. toward "making many small and targeted
  searches instead of a single, broad search."
- `ResponseFormat` enum pattern (`DETAILED` vs `CONCISE`) — example given: a detailed Slack
  thread response at 206 tokens vs. a concise version at 72 tokens (~1/3 the tokens, same
  necessary information preserved).

### Actionable error messages

Contrast:
- **Unhelpful:** raw error codes or tracebacks.
- **Helpful:** "specific and actionable improvements" — e.g. showing the correct parameter
  formatting directly in the error text.

This directly reinforces the two-layer error model in §4: the value of `isError: true`
results depends entirely on whether the text inside is fixable guidance, not a stack trace.

### Tool description/spec engineering — "one of the most effective methods"

> [Tool description engineering emerged as] one of the most effective methods for improving
> tools.

Guidance: describe a tool as you would to a new team member — make implicit context
explicit (specialized query formats, niche terminology definitions, relationships between
underlying resources).

**SWE-bench evidence, as specifically attributable from the post:**
> Claude Sonnet 3.5 achieved state-of-the-art performance on the SWE-bench Verified
> evaluation after precise refinements to tool descriptions, dramatically reducing error
> rates and improving task completion.

No model or architecture change was involved — the improvement came from tool-description
wording alone, per the post's framing.

### Flexible response formats

`ResponseFormat` enum parameter (`DETAILED`/`CONCISE`) lets the agent control verbosity —
see the 206-vs-72-token Slack example above.

### Evaluation-driven iteration

Methodology described:
1. Build realistic eval tasks grounded in actual multi-step workflows (not toy sandbox
   tasks).
2. Run programmatic evaluations with structured agent loops.
3. Collaborate with Claude Code itself to analyze transcripts and auto-improve tool
   implementations/descriptions.
4. Use held-out test sets to avoid overfitting to the training evals.

> we could extract additional performance improvements even beyond what we achieved with
> "expert" tool implementations — whether those tools were manually written by our
> researchers or generated by Claude itself.

**Gap / not verified:** I could not extract a specific quoted numeric accuracy delta from
the internal Slack/Asana eval charts described in the post (shown as graphs, not quoted
numbers in the extracted text). No published Anthropic statistic was found specifically
titled "tool count vs. selection accuracy" — the closest primary evidence remains the
qualitative SWE-bench claim above. Treat any specific percentage claims about tool-count
degradation as unverified unless found directly in the primary post.

### Related current-product mitigation (not spec, current feature)

Anthropic's Messages API supports `defer_loading` per tool inside `mcp_toolset`, paired with
a separate "Tool search tool," letting a model search across dozens/hundreds of tools
without every schema being stuffed into context up front. Claude Code calls the equivalent
mechanism `ToolSearch`.
Sources:
[platform.claude.com/docs/en/agents-and-tools/mcp-connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector),
[code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp)

---

## 7. Tool annotations — hints, defaults, and the untrusted-hints warning

Source: raw `schema.ts` for 2025-06-18 —
[modelcontextprotocol/modelcontextprotocol on GitHub](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2025-06-18/schema.ts)

```typescript
export interface ToolAnnotations {
  /**
   * A human-readable title for the tool.
   */
  title?: string;

  /**
   * If true, the tool does not modify its environment.
   *
   * Default: false
   */
  readOnlyHint?: boolean;

  /**
   * If true, the tool may perform destructive updates to its environment.
   * If false, the tool performs only additive updates.
   *
   * (This property is meaningful only when `readOnlyHint == false`)
   *
   * Default: true
   */
  destructiveHint?: boolean;

  /**
   * If true, calling the tool repeatedly with the same arguments
   * will have no additional effect on the its environment.
   *
   * (This property is meaningful only when `readOnlyHint == false`)
   *
   * Default: false
   */
  idempotentHint?: boolean;

  /**
   * If true, this tool may interact with an "open world" of external
   * entities. If false, the tool's domain of interaction is closed.
   * For example, the world of a web search tool is open, whereas that
   * of a memory tool is not.
   *
   * Default: true
   */
  openWorldHint?: boolean;
}
```

### Defaults table

| Hint | Default | Meaning |
|---|---|---|
| `readOnlyHint` | `false` | Absent an annotation, a tool is assumed to modify its environment |
| `destructiveHint` | `true` | Absent an annotation, a (non-read-only) tool is assumed potentially destructive |
| `idempotentHint` | `false` | Absent an annotation, repeat calls are assumed to have additional effects |
| `openWorldHint` | `true` | Absent an annotation, a tool is assumed to touch an open world of external entities |

Note the skew: **every default assumes the risky case.** Annotating a tool as safe
(`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`) is an opt-in the
server must actively make. Also: `destructiveHint` and `idempotentHint` are only meaningful
when `readOnlyHint == false` (a read-only tool can't meaningfully be "destructive" in this
schema's sense).

### The untrusted-hints warning (quoted verbatim)

From the Tool data type documentation
([server/tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)):

> For trust & safety and security, clients **MUST** consider tool annotations to be
> untrusted unless they come from trusted servers.

From the `schema.ts` doc comments on `ToolAnnotations` itself (per the fetched summary of
the raw source):

> all properties in ToolAnnotations are **hints**. They are not guaranteed to provide a
> faithful description of tool behavior... Clients should never make tool use decisions
> based on ToolAnnotations received from untrusted servers.

This is a **MUST**-level normative statement. Exam framing to expect: a scenario where a
client auto-approves or skips a confirmation step for a tool call because
`readOnlyHint: true` was set by an untrusted/third-party server — that is the textbook
wrong behavior the spec is warning against, since a malicious server could label
`delete_all_records` with `destructiveHint: false` to slip past a naive client's safety
checks.

---

## 8. Current spec (2026-07-28) — terms NOT examined

The 2026-07-28 revision is a substantial rewrite. None of the following is exam material —
listed here purely so these terms are recognizable as **distractors**, not the
exam-era answer, if they appear in a question.

Sources (secondary — I did not directly WebFetch the 2026-07-28 spec pages themselves,
since this material is explicitly out of scope; summarized from search results referencing
[modelcontextprotocol.io/specification/2026-07-28/changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog),
[blog.modelcontextprotocol.io/posts/2026-07-28/](https://blog.modelcontextprotocol.io/posts/2026-07-28/),
and third-party analyses such as [noze.it](https://www.noze.it/en/insights/mcp-2026-07-28-stateless/)):

- **Stateless wire protocol.** Rewritten around per-request `_meta` instead of a persistent
  session model.
- **`server/discover` replaces `initialize`.** A new discovery RPC takes over the role of
  the exam-era `initialize` handshake.
- **MRTR (multi-round-trip requests) replaces server-initiated calls.** Instead of the
  server unilaterally issuing a Sampling or Elicitation request mid-flow, results carry a
  `resultType` field — e.g. `"resultType": "complete"` vs. `"resultType": "input_required"`
  — and the client retries the original call with `inputResponses` and a `requestState`
  token once it has gathered what's needed. Example shape observed in current docs:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 2,
    "result": {
      "resultType": "input_required",
      "inputRequests": {
        "github_login": {
          "method": "elicitation/create",
          "params": { "mode": "form", "message": "Please provide your GitHub username", "requestedSchema": { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] } }
        }
      },
      "requestState": "eyJsb2NhdGlvbiI6Ik5ldyBZb3JrIn0..."
    }
  }
  ```
- **Unified `subscriptions/listen` stream** replaces the exam-era model's free-floating
  `list_changed`/`updated` notifications as separate concerns — clients open one
  subscription stream and specify what they want to hear about (e.g.
  `toolsListChanged: true`).
- **Roots, Sampling, and Logging formally deprecated** (SEP-2577). Per the changelog
  summary: they still work and will keep working for at least twelve months from the
  revision that marked them deprecated, but new implementations shouldn't adopt them.
  Suggested migrations: pass directories/files via tool parameters, resource URIs, or
  server configuration instead of Roots; integrate directly with LLM provider APIs instead
  of Sampling; log to stderr (stdio) or use OpenTelemetry instead of Logging.
- **`tools/list` response gains `ttlMs` and `cacheScope`** for client-side caching, and
  tool results carry the new `resultType` wrapper even in the simple success case
  (`"resultType": "complete"`), which the exam-era 2025-06-18 shape does not have.
- **`x-mcp-header` tool-schema extension** — lets servers mark specific input parameters
  to be mirrored into HTTP headers (`Mcp-Param-{name}`) for the Streamable HTTP transport,
  so intermediaries can route/filter on parameter values without parsing the body.
- **Icons** (`icons` array on tools) and a `title` field pattern already existed in
  2025-06-18 but are extended further in the current spec's tool definitions.

If a question describes any of the above (`resultType`, `server/discover`, MRTR,
`subscriptions/listen`, deprecated Roots/Sampling/Logging, `x-mcp-header`), treat it as
**current-spec, not the tested model** — the exam-era answer should instead reference
`initialize`/`initialized`, free-standing `list_changed`/`updated` notifications, and the
plain `isError: true` two-layer error model documented in §3–§4 above.

---

## Appendix: Anthropic product-surface context (not MCP spec, but exam-adjacent)

### Claude Code MCP integration
Source: [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp)

- Add servers: `claude mcp add [options] <name> <url-or-command>`.
- Transports: `stdio`, `http` (recommended for remote), `sse` (deprecated but supported),
  `ws` (WebSocket, JSON-config only).
- Config scopes: **Local** (`~/.claude.json`, current project, private, default), **Project**
  (`.mcp.json` in project root, shared via git, requires interactive approval), **User**
  (`~/.claude.json`, all projects, private).
- OAuth: `claude mcp add --transport http <name> <url>` then `/mcp` for interactive
  browser login, or `claude mcp login <name>` / `--no-browser` for CLI-only flows.
- Tool naming: `mcp__<servername>__<toolname>`; plugin-bundled:
  `mcp__plugin_<plugin-name>_<server-name>__<tool-name>`. Any character outside
  `A-Z a-z 0-9 _ -` is replaced with `_`.
- Resources exposed via `@`-mentions; prompts exposed as slash commands.
- Context window impact: tool schemas are sent with every request; `ToolSearch` is the
  default mitigation for large tool sets; `MAX_MCP_OUTPUT_TOKENS` env var controls output
  cap (default 25,000); per-tool override via `_meta["anthropic/maxResultSizeChars"]`.
- Security guidance, quoted: "Verify you trust each server before connecting it. Servers
  that fetch external content can expose you to prompt injection risk."

### Anthropic MCP connector (Messages API)
Source: [platform.claude.com/docs/en/agents-and-tools/mcp-connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)

- Status: Beta. Current beta header: `mcp-client-2025-11-20` (prior `mcp-client-2025-04-04`
  is deprecated).
- **Limitation, quoted:** "Of the feature set of the MCP specification, only tool calls are
  currently supported." Resources and prompts are not supported via this connector
  directly (only via client-side SDK helpers with your own MCP client).
- **Limitation, quoted:** "The server must be publicly exposed through HTTP (supports both
  Streamable HTTP and SSE transports). Local STDIO servers cannot be connected directly."
- Config shape: `mcp_servers` array (server connection: `type: "url"`, `url`, `name`,
  `authorization_token`) + `tools` array with `{"type": "mcp_toolset", "mcp_server_name": ...}`
  entries carrying `default_config`/`configs` for enable/disable and `defer_loading` per
  tool.
- Response content blocks:
  ```json
  { "type": "mcp_tool_use", "id": "mcptoolu_...", "name": "echo", "server_name": "example-mcp", "input": { "param1": "value1" } }
  ```
  ```json
  { "type": "mcp_tool_result", "tool_use_id": "mcptoolu_...", "is_error": false, "content": [{ "type": "text", "text": "Hello" }] }
  ```
- Not ZDR-eligible; standard data retention applies to MCP tool definitions/results.
