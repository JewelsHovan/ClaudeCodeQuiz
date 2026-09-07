# Research: Prompt Engineering, Structured Output, Batch API, Claude Code Config

Compiled 2026-09-07 for the Claude Certified Architect — Foundations study guide. All claims are
sourced inline with URL + fetch date. Primary sources used: `platform.claude.com/docs`,
`code.claude.com/docs`, `anthropics/claude-cookbooks` and `anthropics/courses` on GitHub. Where a
claim could **not** be verified against a primary source, it is marked ⚠️ **UNVERIFIED** with an
explanation of what was checked.

Context note: as of this research date, the model lineup includes the Claude 5 generation (Opus 5,
Sonnet 5, Fable 5.1, Mythos 5.1) alongside 4.6/4.7/4.8. Several mechanics below changed with this
generation (adaptive thinking replacing manual extended thinking, prefill deprecation, commands/skills
unification) — noted explicitly where relevant, since an exam version written against an earlier
model generation may test the older behavior.

---

## A. STRUCTURED OUTPUT

### A1. Tool use / Structured Outputs — the exact boundary of the guarantee

Source: https://platform.claude.com/docs/en/build-with-claude/structured-outputs (fetched 2026-09-07)

**Mechanism:** Structured Outputs uses **constrained decoding** — Anthropic compiles a grammar from
your JSON Schema that constrains token generation itself, not post-hoc validation-and-retry.

Quoted guarantee:
> "Always valid: No more `JSON.parse()` errors. Type safe: Guaranteed field types and required
> fields. Reliable: No retries needed for schema violations."

**Error classes ELIMINATED (guaranteed by the grammar):**
- Malformed JSON syntax
- Missing required fields
- Wrong data types (e.g. string where number expected)
- Out-of-enum values
- Extra properties, when `additionalProperties: false` is set

**Error classes NOT eliminated (explicitly out of scope of the guarantee):**
- Hallucinated *values* — the schema constrains shape, not truthfulness
- Misclassification — Claude can put a wrong-but-schema-valid value in an enum field
- Correct type, wrong field — logically inconsistent but syntactically valid output

The docs are careful never to claim structured output improves *what* Claude says, only *how* it's
shaped. One documented caveat that punches through the guarantee: if Claude refuses a request for
safety reasons, the refusal text overrides schema conformance — a refusal response will not match
your schema.

**Two related-but-distinct features that compose:**
1. **Structured Outputs** (`output_config.format`) — controls the shape of the final text response.
2. **Strict tool use** (`strict: true` on a tool definition) — guarantees a *tool call's arguments*
   match that tool's `input_schema`.

Example combining both (adapted from the docs' worked example):
```python
tools=[
    {
        "name": "search_flights",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "destination": {"type": "string"},
                "date": {"type": "string", "format": "date"},
            },
            "required": ["destination", "date"],
            "additionalProperties": False,
        },
    }
]
```
> "When combined, Claude can call tools with guaranteed-valid parameters AND return structured JSON
> responses."

**JSON Schema support gaps** (matters for exam questions about what you *can't* rely on):
recursive schemas, complex types inside enums, external `$ref`, numeric constraints (`minimum`,
`maximum`, `multipleOf`), string length constraints (`minLength`, `maxLength`), array constraints
beyond `minItems` of 0/1, and any `additionalProperties` value other than `false` are **not
supported**. The Python/TypeScript/Ruby/PHP SDKs auto-transform your schema to strip these and fold
the constraint into the field's `description` instead (e.g. "Must be at least 100"), then validate
the response against your *original* schema client-side.

**Cache behavior:** first use of a given schema pays extra latency for grammar compilation;
compiled grammars are cached 24h. Changing the schema, or the tool set (when combined with tool use),
invalidates that cache. Changing only a tool's `name`/`description` does not.

---

### A2. `tool_choice` — exact behavior + extended-thinking interaction ⚠️ VERIFIED PRECISELY (your flagged item)

Sources:
https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools (fetched 2026-09-07)
https://platform.claude.com/docs/en/build-with-claude/thinking (fetched 2026-09-07)

**The four values, quoted directly:**
> "`auto` allows Claude to decide whether to call any provided tools or not. This is the default
> value when `tools` are provided."
> "`any` tells Claude that it must use one of the provided tools, but doesn't force a particular
> tool."
> "`tool` forces Claude to always use a particular tool."
> "`none` prevents Claude from using any tools. This is the default value when no `tools` are
> provided."

Example forcing a specific tool:
```json
{
  "model": "claude-opus-5",
  "max_tokens": 1024,
  "tools": [{
    "name": "get_weather",
    "description": "Get the current weather in a given location",
    "input_schema": {
      "type": "object",
      "properties": { "location": { "type": "string" } },
      "required": ["location"]
    }
  }],
  "tool_choice": {"type": "tool", "name": "get_weather"},
  "messages": [{"role": "user", "content": "What's the weather in San Francisco?"}]
}
```

**Side effect of `any`/`tool`:** the API prefills the assistant message to force a tool call, so
Claude **will not** emit a natural-language preamble even if explicitly asked to. Quoted: "Testing
has shown that this should not reduce performance." If you want narrated tool use, use `auto` (the
default) plus an explicit instruction in the user message instead, e.g. "Use the get_weather tool in
your response."

**Extended-thinking interaction — the exact, current rule:**

| Mode | `auto` | `none` | `any` | `{type:"tool", name}` |
|---|---|---|---|---|
| Manual extended thinking (`thinking:{type:"enabled"}`) | ✅ works | ✅ works | ❌ 400 error | ❌ 400 error |
| Adaptive thinking (`thinking:{type:"adaptive"}`) | ✅ works | ✅ works | ✅ works | ✅ works |
| Claude Fable 5.1 / Mythos 5.1 (any thinking state) | ✅ works | ✅ works | ❌ 400 error | ❌ 400 error |

Quoted directly from the `define-tools` compatibility table:
> "Manual extended thinking (`thinking: {type: "enabled"}`) ... `any` and `tool` are not supported
> and result in an error ... Adaptive thinking, including on models where thinking is on by default
> such as Claude Opus 5, supports forced tool use"

And from the `thinking` overview page, the "Response prefill and forced tool use" section (exact
quote): **"You can't prefill the assistant response while thinking is on. Forced tool use
(`tool_choice: {"type": "any"}` or `{"type": "tool", ...}`) is incompatible with manual extended
thinking but works with adaptive thinking. The exceptions are Claude Fable 5.1 and Claude Mythos 5.1,
which reject forced tool use on every request with a 400 error."**

**Why the incompatibility exists (the mechanism, not just the rule):** manual extended thinking
requires the final assistant turn to *begin* with a thinking block (quoted from the extended-thinking
page: "Manual mode adds one requirement: the final assistant turn of a thinking-enabled request must
begin with a thinking block"). `tool_choice: any`/`tool` works by having the API **prefill** the
assistant turn to force the tool call — and a prefill, by definition, injects content at the start of
the turn where the thinking block is required to be. The two mechanisms collide structurally, which
is also exactly why prefill itself is separately incompatible with thinking (see A5). Adaptive
thinking removes the "must begin with a thinking block" requirement entirely, which is why it lifts
the restriction on forced tool use.

**Prompt caching note:** changing `tool_choice` between requests invalidates cached message blocks
(tool definitions and system prompt stay cached; message content must be reprocessed).

---

### A3. Schema design that reduces fabrication

Sources:
https://code.claude.com/docs/en/agent-sdk/structured-outputs (fetched 2026-09-07)
https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations (fetched 2026-09-07)

**Documented mechanism (quoted, Agent SDK docs, "Tips for avoiding errors"):**
> "Match schema to task. If the task might not have all the information your schema requires, make
> those fields optional."

This is Anthropic's own stated defense against fabrication: a `required` field the model cannot
actually populate from the input pressures it to invent a plausible-looking value just to satisfy the
schema. Making the field **optional**, or **nullable** (JSON Schema union type
`"type": ["string", "null"]`), gives the model a legitimate way to omit or null the field instead of
fabricating.

Worked example from the Agent SDK docs (TODO-extraction agent) — note `author`/`date` are optional
because git blame info might not exist for every file:
```json
{
  "type": "object",
  "properties": {
    "todos": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "text":   { "type": "string" },
          "file":   { "type": "string" },
          "line":   { "type": "number" },
          "author": { "type": "string" },
          "date":   { "type": "string" }
        },
        "required": ["text", "file", "line"]
      }
    },
    "total_count": { "type": "number" }
  },
  "required": ["todos", "total_count"]
}
```
Docs commentary: "The schema includes optional fields (`author` and `date`) since git blame
information might not be available for all files. The agent fills in what it can find and omits the
rest."

**General hallucination-reduction guidance** (reduce-hallucinations page, quoted):
- "Allow Claude to say 'I don't know': Explicitly give Claude permission to admit uncertainty. This
  simple technique can drastically reduce false information."
- "Use direct quotes for factual grounding: For tasks involving long documents (>20k tokens), ask
  Claude to extract word-for-word quotes first before performing its task."
- "Chain-of-thought verification: Ask Claude to explain its reasoning step-by-step before giving a
  final answer. This can reveal faulty logic or assumptions."
- "External knowledge restriction: Explicitly instruct Claude to only use information from provided
  documents and not its general knowledge."

**⚠️ UNVERIFIED: the "enum + `other` + free-text detail field" escape-hatch pattern.**
I checked: the structured-outputs page, the agent-sdk/structured-outputs page, the full
claude-prompting-best-practices reference, increase-consistency, reduce-hallucinations, and two
cookbook notebooks (`tool_use/extracting_structured_json.ipynb` in
`anthropics/claude-cookbooks`, and `tool_use/03_structured_outputs.ipynb` in `anthropics/courses`).
**None of them describe an enum value literally named `"other"` paired with a companion free-text
detail field as a named/recommended pattern.** This pattern appears only on third-party exam-prep
sites (e.g. claudecertified.io, claudecertificationguide.com) that are themselves likely built for
this exact certification. It is a structurally sound idea — consistent with the documented
required/optional/nullable mechanics above, since an enum with no matching value otherwise forces a
misclassification — but present it in the study guide as a "commonly recommended engineering
pattern," not as an Anthropic-stated recommendation.

---

### A4. Chain-of-thought with strict JSON ⚠️ VERIFIED — YOUR MOST IMPORTANT FLAGGED ITEM

**Direct answer: I could NOT find "a `reasoning` property ordered first in the JSON schema" documented
or recommended anywhere in Anthropic's primary sources.**

Pages/notebooks checked specifically for this pattern (all fetched/searched 2026-09-07):
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs — no mention of field
  ordering or a reasoning property.
- https://code.claude.com/docs/en/agent-sdk/structured-outputs — no mention.
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
  — full reference, read in its entirety (all ~40 headings); the "Thinking and reasoning" section
  discusses reasoning at length but never in terms of JSON schema field order.
- https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/increase-consistency —
  no mention.
- https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations —
  discusses CoT generally, not schema-ordering.
- `anthropics/claude-cookbooks/tool_use/extracting_structured_json.ipynb` — five worked JSON-schema
  examples (summarization, NER, sentiment, classification, open-ended keys), none use a
  reasoning/thinking property.
- `anthropics/courses/tool_use/03_structured_outputs.ipynb` — same "force JSON via tool use" lesson,
  no reasoning field.

**So: treat "put a reasoning field first in the schema" as a plausible, structurally-grounded
community pattern (constrained decoding does emit object keys in the order declared in the schema,
so a leading reasoning property genuinely would generate before the answer fields) — but do NOT
attribute it to Anthropic. It shows up only on third-party exam-prep sites, which may itself be where
this exam question originates, so be careful the study guide doesn't just launder an unverified claim
back through the exam.**

**What Anthropic DOES document for combining reasoning with structured/strict output** (two real,
citable mechanisms):

1. **Extended/adaptive thinking (preferred path).** Reasoning happens in dedicated `thinking` content
   blocks that precede the response; the final answer — including any tool call or structured JSON —
   still validates normally afterward. Quoted: "adaptive thinking reliably drives better performance
   than extended thinking." This is the mechanism Anthropic wants you to use instead of manual CoT.

2. **XML-tag separation, for when thinking is off (documented fallback).** From
   claude-prompting-best-practices, "Leverage thinking & interleaved thinking capabilities" section,
   quoted exactly:
   > "Manual chain-of-thought (CoT) prompting as a fallback. When thinking is off, you can still
   > encourage step-by-step reasoning by asking Claude to think through the problem. Use structured
   > tags like `<thinking>` and `<answer>` to cleanly separate reasoning from the final output. On
   > Claude Opus 5, prefer keeping thinking enabled at a lower effort level instead: with thinking
   > disabled, the model can occasionally emit internal XML tags into its visible output..."

   Note precisely what this is: free-text XML tag separation in the *response text*, not a property
   inside a JSON Schema object. It's the right citation for "how does Anthropic recommend preserving
   CoT," but it is a different mechanism from the "reasoning field first in schema" claim.

   Also relevant, same page, on multishot + thinking: "Multishot examples work with thinking. Use
   `<thinking>` tags inside your few-shot examples to show Claude the reasoning pattern. It will
   generalize that style to its own extended thinking blocks."

---

### A5. Prefilling the assistant turn — bigger change than the exam brief implied

Sources:
https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
(section "Migrating away from prefilled responses", fetched 2026-09-07)
https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/increase-consistency (fetched 2026-09-07)
https://platform.claude.com/docs/en/build-with-claude/thinking (fetched 2026-09-07)

**Prefill is now deprecated/unsupported on the newest models.** Exact quote:
> "Starting with Claude 4.6 models and Claude Mythos Preview, prefilled responses (providing a
> partial assistant message for Claude to continue from) on the last assistant turn are no longer
> supported. Requests with prefilled assistant messages to these models return a 400 error. Model
> intelligence and instruction following have advanced such that most use cases of prefill no longer
> require it."

Earlier models (4.5 and prior) still support prefill normally, and prefilling assistant messages
*earlier* in a conversation (not the last turn) is unaffected on any model.

**What prefill does, where it still works:** you provide a partial `assistant`-role message and
Claude continues from it verbatim — "This trick bypasses Claude's friendly preamble and enforces your
structure." Classic example (from increase-consistency):
```text
User: [asks for a report, specifies an XML template]

Assistant (prefill):
<report>
    <summary>
        <metric name=
```
Claude continues generating from exactly that point, guaranteeing the response starts inside the
`<metric name=` attribute rather than with a conversational preamble.

**Exactly why prefill defeats chain-of-thought — quoted, precise:**
> "You can't prefill the assistant response while thinking is on."
(https://platform.claude.com/docs/en/build-with-claude/thinking, "Response prefill and forced tool
use" section)

The mechanism: manual extended thinking requires the assistant turn to structurally *begin* with a
`thinking` block. A prefill is, by definition, content injected at the very start of the assistant
turn. The two requirements are mutually exclusive — you cannot have a turn that both begins with a
model-generated thinking block and begins with your injected prefill text. This is the same root
cause documented for the `tool_choice: any/tool` restriction (A2) — both `any`/`tool` and prefill work
by seeding the start of the assistant turn, and both are blocked when the turn must start with
thinking instead.

**Migration guidance for common prefill use cases (quoted from claude-prompting-best-practices):**
- *Controlling output formatting* → "The Structured Outputs feature is designed specifically to
  constrain Claude's responses to follow a given schema. Try asking the model to conform to your
  output structure first, as newer models can reliably match complex schemas when told to... For
  classification tasks, use either tools with an enum field containing your valid labels or
  structured outputs."
- *Eliminating preambles* → system-prompt instruction ("Respond directly without preamble...") or
  structured outputs/tool calling; strip in post-processing as a last resort.
- *Avoiding bad refusals* → "Claude is much better at appropriate refusals now. Clear prompting
  within the user message without prefill should be sufficient."
- *Continuations* → move the continuation into the user message instead: "Your previous response
  was interrupted and ended with `[previous_response]`. Continue from where you left off."

---

## B. PROMPT ENGINEERING

### B6. Anthropic's documented techniques, in their stated order

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
(fetched 2026-09-07 — this is now the single living reference; the previously separate
"chain-of-thought"/"multishot"/"xml-tags" pages have been folded into it and now redirect here)

Document structure (its own stated order): model-specific guidance → **general principles** (be
clear and direct → add context → use examples → structure with XML tags → give Claude a role) →
output/formatting → tool use → thinking and reasoning → agentic systems → migration considerations.

**Be clear and direct** (quoted):
> "Think of Claude as a brilliant but new employee who lacks context on your norms and workflows...
> Golden rule: Show your prompt to a colleague with minimal context on the task and ask them to
> follow it. If they'd be confused, Claude will be too."

Worked example given:
- Less effective: `Create an analytics dashboard`
- More effective: `Create an analytics dashboard. Include as many relevant features and interactions
  as possible. Go beyond the basics to create a fully-featured implementation.`

**Add context to improve performance** (quoted): explaining *why* generalizes better than a bare
rule. Example given —
- Less effective: `NEVER use ellipses`
- More effective: `Your response will be read aloud by a text-to-speech engine, so never use
  ellipses since the text-to-speech engine will not know how to pronounce them.`
- "Claude is smart enough to generalize from the explanation."

**Use examples effectively (multishot/few-shot)** — quoted:
> "Examples are one of the most reliable ways to steer Claude's output format, tone, and structure.
> A few well-crafted examples (known as few-shot or multishot prompting) improve accuracy and
> consistency."

Make examples:
- **Relevant** — mirror your actual use case closely
- **Diverse** — cover edge cases, vary enough that Claude doesn't pick up unintended patterns
- **Structured** — wrap in `<example>` tags (`<examples>` for multiple) so Claude can distinguish
  them from instructions

**Exact quote on count: "Include 3–5 examples for best results."** You can also ask Claude itself to
evaluate your examples for relevance/diversity or generate more from your initial set.

**Structure prompts with XML tags** — wrap distinct content types in their own tags
(`<instructions>`, `<context>`, `<input>`) to reduce misinterpretation; use consistent tag names; nest
for natural hierarchy (e.g. `<documents>` containing `<document index="n">`).

**Give Claude a role** — even a single system-prompt sentence measurably focuses tone/behavior:
```json
{
  "model": "claude-opus-5",
  "max_tokens": 1024,
  "system": "You are a helpful coding assistant specializing in Python.",
  "messages": [{"role": "user", "content": "How do I sort a list of dictionaries by key?"}]
}
```

**Being explicit vs. vague ("specific criteria beat vague adjectives") — closest documented
instantiation.** I did not find the literal phrase "specific criteria beat 'be conservative'" — but
the documented pattern is functionally identical, in the Tool Use section, contrasting a vague ask
with an explicit one:
- Less effective (Claude will only suggest): `Can you suggest some changes to improve this
  function?`
- More effective (Claude will make the changes): `Change this function to improve its performance.`

And Anthropic gives a full concrete system-prompt block for the "conservative" end of that spectrum,
replacing a vague "be careful" instruction with specific, checkable criteria:
```text
<do_not_act_before_instructions>
Do not jump into implementation or change files unless clearly instructed to make
changes. When the user's intent is ambiguous, default to providing information, doing
research, and providing recommendations rather than taking action. Only proceed with
edits, modifications, or implementations when the user explicitly requests them.
</do_not_act_before_instructions>
```
And the mirror-image "act proactively" version:
```text
<default_to_action>
By default, implement changes rather than only suggesting them. If the user's intent is
unclear, infer the most useful likely action and proceed, using tools to discover any
missing details instead of guessing.
</default_to_action>
```
For risk/safety specifically, the docs give a concrete, checkable list rather than a vague
instruction like "be careful":
```text
Examples of actions that warrant confirmation:
- Destructive operations: deleting files or branches, dropping database tables, rm -rf
- Hard to reverse operations: git push --force, git reset --hard, amending published commits
- Operations visible to others: pushing code, commenting on PRs/issues, sending
messages, modifying shared infrastructure
```
This is the real, citable Anthropic instantiation of "specific criteria beat a vague adjective" — use
it in the study guide in place of the unverified exact wording.

**Output formatting — quoted rule:** "Tell Claude what to do instead of what not to do" — e.g.
instead of "Do not use markdown," say "Your response should be composed of smoothly flowing prose
paragraphs."

---

### B7. Extended thinking → Adaptive thinking + `effort` ⚠️ VERIFIED PRECISELY (your flagged item)

Sources:
https://platform.claude.com/docs/en/build-with-claude/extended-thinking (fetched 2026-09-07)
https://platform.claude.com/docs/en/build-with-claude/thinking (fetched 2026-09-07)

**Confirmed: `effort` has replaced `budget_tokens` as the primary depth control, but as a generational
split rather than a clean global swap.** Exact state per model tier:

| Model tier | Thinking config | Status |
|---|---|---|
| Claude Sonnet 4.5, Opus 4.5, Haiku 4.5, and earlier Claude 4 models | `thinking:{type:"enabled", budget_tokens:N}` (manual only — adaptive not available, `type:"adaptive"` returns a 400 error) | Fully supported, only mode that exists |
| Claude Opus 4.6, Sonnet 4.6 | Both manual (`budget_tokens`) and adaptive (`effort`) work | Manual is **deprecated** but functional; adaptive preferred |
| Claude 4.7 and later, and the entire 5-generation (Opus 5, Sonnet 5, Fable 5.1, Mythos 5.1, Fable 5, Mythos 5) | Only `thinking:{type:"adaptive"}` + `output_config:{effort:...}` | `thinking:{type:"enabled"}` **returns a 400 error** |
| Claude Fable 5.1, Mythos 5.1, Fable 5, Mythos 5 | Adaptive thinking only, and thinking is **always on** (no way to disable) | — |

**`budget_tokens` rules (manual mode, quoted):**
- "Minimum of 1,024 tokens. The API rejects smaller values."
- "Less than `max_tokens`." (thinking tokens count toward `max_tokens`) — except interleaved
  thinking, where `budget_tokens` can exceed `max_tokens` because the budget spans all thinking
  blocks within one assistant turn.
- "No cache pre-warming" — extended thinking can't combine with `max_tokens: 0`.
- "The budget is a target rather than a strict cap." Claude may stop reasoning before exhausting it;
  `max_tokens` remains the hard output ceiling.

**Migration mapping, quoted exactly from the docs:**
```json
// before
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 16000,
  "thinking": { "type": "enabled", "budget_tokens": 10000 }
}
```
becomes:
```json
// after
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 16000,
  "thinking": { "type": "adaptive" },
  "output_config": { "effort": "high" }
}
```
Note: `effort: "high"` is the API default, shown only to illustrate where the control now lives —
omitting it produces identical behavior.

**This is a real behavioral difference, not just a syntax change (quoted):**
> "With a fixed budget, Claude thinks on every request. With adaptive thinking, Claude decides
> whether and how much to think on each request, and at lower effort settings it may skip thinking
> entirely on easy inputs."

Anthropic's own performance claim: "In internal evaluations, adaptive thinking reliably drives better
performance than extended thinking."

**Effort levels:** `low`, `medium`, `high`, `xhigh`, `max` (also directly exposed at the Claude Code
CLI level via `/effort` and the `${CLAUDE_EFFORT}` skill substitution variable — see section D).

**Interaction with tools** (recap from A2): manual mode blocks forced tool use entirely; adaptive
mode allows it. **Interleaved thinking** (reasoning between tool calls within a single assistant
turn) requires the `interleaved-thinking-2025-05-14` beta header on 4.5-and-4.6-era models using
manual mode; it is automatic, no header needed, under adaptive thinking.

**Tuning guidance (quoted):** "Match the starting point to the task. For simple tasks, start near the
1,024-token minimum... For complex tasks, start with a larger budget of 16,000 tokens or more... For
thinking budgets above 32k, use batch processing to avoid networking issues" — pushing a synchronous
request's thinking past 32k tokens risks hitting connection/timeout limits.

---

## C. BATCH API

Source: https://platform.claude.com/docs/en/build-with-claude/batch-processing (fetched 2026-09-07)

### C8.1 — Cost, limits, SLA, retention (all directly quoted/confirmed)

- **Cost:** flat **50% off** standard API pricing, applied to input tokens, output tokens, and
  special tokens, on every supported model.
- **Size limits — current docs, and a note on the exam-relevant history:** "A Message Batch is
  limited to either **100,000** Message requests or **256 MB** in size, whichever is reached first."
  (https://platform.claude.com/docs/en/build-with-claude/batch-processing, fetched 2026-09-07 — this
  is the live number today, and has been for a long time; see the history below.)

  **On the 10,000 vs. 100,000 question specifically:** the **10,000**-requests-per-batch figure is
  real, but it is the **original public-beta** limit, not a current one. Primary source: the
  original announcement, "Introducing the Message Batches API"
  (https://claude.com/blog/message-batches-api, published **October 8, 2024**), states exactly:
  > "Developers can send batches of up to 10,000 queries per batch."

  The limit was raised to its current value at **General Availability, December 17, 2024**, when
  Anthropic increased the per-batch cap from 10,000 requests to **100,000 requests** and added the
  **256 MB** hard byte ceiling alongside it (corroborated by multiple secondary write-ups of the GA
  announcement; I was not able to load Anthropic's GA blog post itself to pull a first-party quote
  for this specific transition, so treat the *date and mechanism of the change* as secondary-sourced
  even though the *current* 100,000/256 MB figures are directly confirmed in today's primary docs
  above).

  **Direct answer for your question bank:** a **mid-2026** exam would test **100,000 requests / 256
  MB**, not 10,000 — the 100k figure has been the documented limit continuously since December 2024,
  roughly 18 months before this exam's stated Exam Guide v1.0 (July 2026, per this project's
  `CLAUDE.md`). 10,000 was only ever correct for the ~2-month beta window between the API's October
  2024 launch and its December 2024 GA. If a practice question says 10,000, it's testing stale
  pre-GA information and should be corrected to 100,000 requests or 256 MB, whichever is hit first.
- **Processing SLA:** "most batches finishing in less than 1 hour"; hard ceiling **24 hours** — "You
  can access batch results when all messages have completed or after 24 hours, whichever comes
  first. Batches expire if processing does not complete within 24 hours." Unprocessed/expired
  requests are not billed.
- **Retention:** "Batch results are available for **29 days** after creation. After that, you may
  still view the Batch, but its results will no longer be available for download." (29 days is
  measured from batch `created_at`, not from processing `ended_at`.) You can `DELETE` a batch any
  time after processing to remove data early; an in-progress batch must be canceled first.
- **`custom_id` correlation:** required per request, regex `^[a-zA-Z0-9_-]{1,64}$` (1–64 chars),
  used to match a result back to its originating request.
- **Result ordering — quoted exactly:**
  > "Batch results can be returned in any order, and may not match the ordering of requests when the
  > batch was created... To correctly match results with their corresponding requests, always use
  > the `custom_id` field."
- **Result types:** `succeeded` (billed), `errored` (not billed), `canceled` (not billed), `expired`
  (not billed, hit the 24h ceiling without completing).
- **Not supported inside a batch request** (validation error if included): `stream: true` (batch
  results come back as one file, not a stream), `speed`/Fast mode (tunes synchronous latency, doesn't
  apply async), `max_tokens: 0` (cache pre-warming — an ephemeral cache entry written mid-batch would
  likely expire before any follow-up runs).
- **Prompt caching stacks with batch discounts** — "cache hits are provided on a best-effort basis"
  since requests process concurrently/async; typical hit rates 30–98% depending on traffic pattern.
- **Extended output beta:** the `output-300k-2026-03-24` beta header raises `max_tokens` to 300,000
  for batch requests on Opus 5/4.8/4.7/4.6 and Sonnet 5/4.6 — "Extended output is available on the
  Message Batches API only, not the synchronous Messages API."

Example batch creation request:
```json
POST /v1/messages/batches
{
  "requests": [
    {
      "custom_id": "my-first-request",
      "params": {
        "model": "claude-opus-5",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": "Hello, world"}]
      }
    },
    {
      "custom_id": "my-second-request",
      "params": {
        "model": "claude-opus-5",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": "Hi again, friend"}]
      }
    }
  ]
}
```
Example result line (`.jsonl`, order not guaranteed to match request order — note second request's
result appears first):
```jsonl
{"custom_id":"my-second-request","result":{"type":"succeeded","message":{"role":"assistant","content":[{"type":"text","text":"Hello again!..."}]}}}
{"custom_id":"my-first-request","result":{"type":"succeeded","message":{"role":"assistant","content":[{"type":"text","text":"Hello! How can I assist..."}]}}}
```

### C8.2 — Precisely why an iterative multi-turn tool-calling workflow cannot run inside a batch request ⚠️ VERIFIED PRECISELY (your flagged item)

**The docs draw an explicit, sharp line between server tools and client-defined tools.** Quoted
exactly, from the "Server tools and the agentic loop" section:
> "All server tools (web search, web fetch, code execution, MCP connectors, advisor, and tool
> search) work in batch requests. The batch worker runs the same server-side agentic loop as the
> synchronous Messages API."

Batch actually runs it *better* than sync in one respect: "Because there is no open connection to
maintain, the batch loop runs **more iterations per turn** than a synchronous request before it
returns `stop_reason: "pause_turn"`."

**This is the key distinction the exam is testing: server tools work fine because Anthropic's own
infrastructure executes them internally, without leaving the batch worker process. The limitation is
specifically about tools *you* define and execute client-side.**

The precise mechanism (synthesized from the docs' architecture, since no single sentence states the
negative case — the docs establish it by describing what server tools uniquely get):

1. Each entry in a Message Batch is one complete Messages API request, "processed independently,"
   and returns exactly once when that request's turn is done.
2. When Claude wants to call a **client-defined** tool, it stops generation and returns a `tool_use`
   content block as part of that one response — it does not (and architecturally cannot) pause and
   wait mid-request for your application to run the tool and hand back a result. There is no open
   connection or live session to receive that `tool_result` synchronously.
3. To continue the turn, your application must execute the tool locally and then submit a **new**
   request (containing the full conversation history plus your `tool_result` block) — either back
   into a new batch, or synchronously via the regular Messages API.
4. Therefore: a **single** client-tool call inside one batch entry works fine (Claude requests the
   tool, your app sees the `tool_use` block in the result and executes it after the fact). But an
   **iterative loop** — "call tool A, see the result, decide to call tool B based on it, see that
   result, ..." — cannot happen *within one batch entry*, because each step of that loop requires a
   fresh request/response round-trip that the asynchronous, fire-and-collect batch model doesn't
   provide a channel for mid-flight. Each turn of the loop must be its own separate batch (or sync)
   submission.
5. Server tools sidestep this entirely because Anthropic's own batch worker executes them in-process
   as part of producing the one response — from the client's perspective it's still "one request, one
   eventual response," even though internally the model may have called a server tool many times in
   a loop before returning.

Corroborating detail: `stream: true` is explicitly disallowed in batch ("Batch results come back as a
single file, not a stream") — this is the same underlying constraint (no live channel back to the
requester mid-processing) that also blocks a client-side tool round-trip within one entry.

---

## D. CLAUDE CODE CONFIGURATION

Sources (all fetched 2026-09-07 directly from code.claude.com/docs — high confidence, primary):
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/claude-directory
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/code-review

### D9. CLAUDE.md hierarchy, `@import`, `.claude/rules/`

**Locations, in load order (broadest scope → most specific; later-loaded = appears closer to your
prompt = read last):**

| Scope | Location | Notes |
|---|---|---|
| Managed policy | macOS `/Library/Application Support/ClaudeCode/CLAUDE.md`; Linux/WSL `/etc/claude-code/CLAUDE.md`; Windows `C:\Program Files\ClaudeCode\CLAUDE.md` | Org-wide, IT-deployed, cannot be excluded by users |
| User | `~/.claude/CLAUDE.md` | Personal, all projects |
| Project | `./CLAUDE.md` or `./.claude/CLAUDE.md` | Team-shared, committed to source control |
| Local | `./CLAUDE.local.md` | Personal, project-specific, gitignored |

**Exact quote on how they combine:** "All discovered files are concatenated into context rather than
overriding each other." Directory-tree ordering: root-of-tree down to your working directory — e.g.
running Claude Code in `foo/bar/` loads `foo/CLAUDE.md` **before** `foo/bar/CLAUDE.md` ("instructions
closer to where you launched Claude are read last"). Within one directory, `CLAUDE.local.md` loads
**after** `CLAUDE.md` ("your personal notes are the last thing Claude reads at that level"). Nested
CLAUDE.md files in subdirectories you haven't visited are **not** loaded at launch — they load
on-demand "when Claude reads files in those directories."

**`@import` syntax** (quoted): "CLAUDE.md files can pull in other files with `@path/to/import`
syntax." Rules:
- Both relative and absolute paths allowed.
- "Relative paths resolve relative to the file containing the import, not the working directory."
- "Imported files can recursively import other files, with a **maximum depth of four hops**."
- Import parsing skips Markdown code spans and fenced code blocks — wrap a path in backticks
  (`` `@README` ``) to reference it literally without triggering an import.
- Imported files still fully load into context at launch alongside the importing file — imports
  organize content, they do **not** defer loading (that's what path-scoped rules are for).

Example:
```text
See @README for project overview and @package.json for available npm commands.

# Additional Instructions
- git workflow @docs/git-instructions.md
```

Sharing personal instructions across git worktrees (since a gitignored `CLAUDE.local.md` exists in
only one worktree):
```text
# Individual Preferences
- @~/.claude/my-project-instructions.md
```
**Security note:** an import that resolves outside the working directory ("external") triggers a
one-time approval dialog the first time Claude Code encounters it in a project — protection against
imports planted by someone else's commit. User-scope files (`~/.claude/CLAUDE.md`, `~/.claude/rules/`)
are trusted without the dialog since you wrote them yourself.

**`.claude/rules/` — path-scoped rules:**
```text
your-project/
├── .claude/
│   ├── CLAUDE.md
│   └── rules/
│       ├── code-style.md
│       ├── testing.md
│       └── security.md
```
All `.md` files under `.claude/rules/` are discovered **recursively** (subdirectories like
`frontend/`, `backend/` allowed). Quoted: "Rules without `paths` frontmatter are loaded at launch with
the same priority as `.claude/CLAUDE.md`."

Path-scoped rule, exact frontmatter field is **`paths`** (a YAML list of glob patterns):
```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Development Rules

- All API endpoints must include input validation
- Use the standard error response format
```
Quoted: "These conditional rules only apply when Claude is working with files matching the specified
patterns... Path-scoped rules trigger when Claude reads files matching the pattern, not on every tool
use." Brace expansion is supported: `src/**/*.{ts,tsx}` expands to two patterns; a whole rule's
`paths` list shares a budget of **1,000 expanded patterns and 4 MiB** (patterns without braces don't
count against it) — a pattern that would exceed the budget is used unexpanded (its literal braces
then match nothing).

**Precedence when multiple rules match the same file — explicit finding, for the question-bank
correction:**

**The docs are silent on glob specificity as a precedence mechanism. They do not say "the more
specific glob wins," and I could not find that concept — or any glob-vs-glob tie-breaking rule at
all — anywhere in the `.claude/rules/` documentation.** I checked both primary pages directly:
https://code.claude.com/docs/en/memory (the canonical rules documentation, "Organize rules with
`.claude/rules/`" section) and https://code.claude.com/docs/en/claude-directory (the `.claude`
directory explorer, rules section). Neither describes rules as competing or being ranked against
each other by pattern specificity, narrowness, or any other criterion.

What the docs **do** say, quoted directly, is that multiple matching rules simply all load together
— the same "concatenate, don't override" model used for CLAUDE.md generally:
> "All discovered files are concatenated into context rather than overriding each other."
(stated for CLAUDE.md files, and the rules section describes rule loading the same way — rules
without `paths` "loaded at launch with the same priority as `.claude/CLAUDE.md`," i.e., as more
concatenated context, not as a ranked list)

And on what happens when loaded rules disagree, quoted directly (in the CLAUDE.md troubleshooting
section, which explicitly says to also review `.claude/rules/` for the same issue):
> "Consistency: if two rules contradict each other, Claude may pick one arbitrarily. Review your
> CLAUDE.md files, nested CLAUDE.md files in subdirectories, and `.claude/rules/` periodically to
> remove outdated or conflicting instructions."

**So: the docs are simply silent on "more specific glob wins" — this is not a case of the docs
contradicting that claim, it's that the concept of glob-based precedence between rules doesn't appear
to exist in the documented system at all.** Every rule whose `paths` glob matches the current file
(or that has no `paths` at all) loads into context side by side; if two of them give conflicting
instructions, Claude Code does not resolve the conflict for you — the docs put the burden on the
author to keep rules non-contradictory, and explicitly warn that Claude "may pick one arbitrarily"
otherwise. If your practice question's answer key asserts "the more specific glob wins" as a
resolution mechanism, I'd treat that as unsupported by current documentation and recommend rewriting
the question to test the actual documented behavior (concatenation + the "keep rules non-conflicting
yourself" warning) instead.

**The one real, explicitly documented precedence rule** — which is about *scope* (user vs. project),
not glob specificity — is: **"User-level rules are loaded before project rules, giving project rules
higher priority."** That is, between `~/.claude/rules/` (personal, all projects) and `.claude/rules/`
(this project), project rules are read later in context. This is the general "later-loaded = more
salient" pattern the docs use consistently for CLAUDE.md too, but the docs never elevate it to a hard
guarantee that later content strictly "wins" — it's presented as a context-ordering fact, with actual
conflict resolution left to Claude's judgment (per the "may pick one arbitrarily" quote above).

Monorepo escape hatch: `claudeMdExcludes` (in `.claude/settings.local.json` or any settings layer)
skips specific CLAUDE.md/rules files by glob against absolute paths:
```json
{
  "claudeMdExcludes": [
    "**/monorepo/CLAUDE.md",
    "/home/user/monorepo/other-team/.claude/rules/**"
  ]
}
```

**Sizing guidance (quoted):** "target under 200 lines per CLAUDE.md file... If your instructions are
growing large, use path-scoped rules." Claude Code loads a CLAUDE.md up to 4 MiB in full and skips
anything larger.

### D10 & D11. Custom slash commands and Agent Skills — now unified

**Structural change worth flagging in the study guide:** commands and skills are documented as the
same underlying mechanism. Quoted directly from the `.claude` directory explorer docs: "Commands and
skills are now the same mechanism. For new workflows, use skills/ instead: same `/name` invocation,
plus you can bundle supporting files." And from the commands section specifically: "A file at
`commands/deploy.md` creates `/deploy` the same way a skill at `skills/deploy/SKILL.md` does, and both
can be auto-invoked by Claude... New commands should usually be skills instead; commands remain
supported." If a skill and a command share a name, **the skill takes precedence**.

**Locations/scoping:**

| Location | Scope |
|---|---|
| `.claude/commands/*.md` | Project, single-file prompts |
| `~/.claude/commands/*.md` | User, available in every project |
| `.claude/skills/<name>/SKILL.md` | Project — this project only |
| `~/.claude/skills/<name>/SKILL.md` | Personal — all your projects |
| Managed settings directory | Enterprise — all users in org |

**Skill resolution priority across levels: Enterprise > Personal > Project.** A local skill also
overrides a same-named bundled skill (built into Claude Code), but not that bundled skill's aliases.
Nested skills appear as directory-qualified commands, e.g. `/apps/web:deploy`.

**Argument substitution (applies to both commands and skills):**

| Placeholder | Meaning | Example |
|---|---|---|
| `$ARGUMENTS` | everything typed after the name | `/fix-issue 123` → `$ARGUMENTS` = `123` |
| `$ARGUMENTS[N]` / `$N` | positional | `/migrate-component SearchBar JS TS` → `$0`=`SearchBar`, `$1`=`JS`, `$2`=`TS` |
| `$name` | named, via `arguments:` frontmatter | `arguments: [issue, branch]` → `$issue`, `$branch` |

`argument-hint` frontmatter (e.g. `argument-hint: [issue-number]` or `argument-hint: <branch-or-path>`)
is **purely a display hint** shown during autocomplete — it does not validate or enforce anything
about what's actually passed.

Example command (`.claude/commands/fix-issue.md`):
```markdown
---
argument-hint: <issue-number>
---

!`gh issue view $ARGUMENTS`
```
Typing `/fix-issue 123` runs `gh issue view 123` in the shell first and splices its output into the
prompt before Claude sees it.

**Skill-only frontmatter fields** (not shared with plain commands):

| Field | Purpose |
|---|---|
| `context: fork` | Runs the skill's content as the prompt for a **forked subagent**, with no access to the parent conversation's history |
| `agent: Explore \| Plan \| general-purpose` | Which subagent type executes it, used with `context: fork` |
| `background: true` (default) / `false` | With `context: fork` — run in background (keep working) vs. wait inline for the result |
| `allowed-tools` | Tools pre-approved **for the invoking turn only** — "the grant clears when you send your next message" |
| `disallowed-tools` | Tools removed from the available pool while the skill is active |
| `disable-model-invocation: true` | User-only trigger — Claude is blocked from auto-invoking it |
| `user-invocable: false` | Inverse — hidden from the `/` menu, Claude-only background knowledge |
| `paths` | Glob patterns limiting when the skill activates |

Example skill with a forked subagent:
```yaml
---
name: deep-research
description: Research a topic thoroughly
context: fork
agent: Explore
---

Research $ARGUMENTS thoroughly:

1. Find relevant files using Glob and Grep
2. Read and analyze the code
3. Summarize findings with specific file references
```

Example skill pre-approving specific git commands only:
```yaml
---
name: commit
description: Stage and commit the current changes
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *) Bash(git status *)
---

Stage and commit all changes with an appropriate message.
```

**Dynamic context injection** — both forms execute *before* the skill content reaches Claude and
splice their output in:
```markdown
## Current changes
!`git diff HEAD`
```
```markdown
## Environment
```!
node --version
git status --short
```
```

**Progressive disclosure (how loading actually works, quoted):**
> "Skills are loaded into context so Claude knows what's available, but full skill content only
> loads when invoked." Once invoked, the rendered content "enters the conversation as a single
> message and stays there across later turns... Claude Code does not re-read the skill file on later
> turns" unless arguments changed or a dynamic-context command produced new output.

On auto-compaction: "Claude Code re-attaches the most recent invocation of each skill after the
summary, keeping the first 5,000 tokens of each. Re-attached skills share a combined budget of 25,000
tokens."

**Task-scoped vs. path-scoped vs. always-loaded — the documented decision rule:**

| Mechanism | Use when |
|---|---|
| **CLAUDE.md** | Information is true *always*, every session, every file — facts, conventions, project architecture Claude needs on every turn |
| **`.claude/rules/` with `paths:`** | Instructions should load only when Claude is *touching specific files* (e.g., Python style rules scoped to `src/**/*.py`) — triggers on file access, not invocation |
| **Skills** | A *procedure* — multi-step, invoked on-demand (typed `/name` or Claude inferring intent from `description`), progressive-disclosure loaded so it doesn't cost context until actually used |

Exact quoted triggers for "this should become a skill": "You keep pasting the same instructions,
checklist, or multi-step procedure into chat" or "A section of CLAUDE.md has grown into a procedure
rather than a fact."

### D12. Headless/CI usage

Source: https://code.claude.com/docs/en/headless (fetched 2026-09-07 — page title is now "Run
Claude Code programmatically," filed under Agent SDK docs)

**`claude -p` / `--print`:** runs non-interactively, writes to stdout, exits 0 on success / non-zero
on failure — scriptable.
```bash
claude -p "Find and fix the bug in auth.py" --allowedTools "Read,Edit,Bash"
```

**`--bare` — Anthropic's stated recommendation for CI (quoted):** "the recommended mode for scripted
and SDK calls, and will become the default for `-p` in a future release." It skips auto-discovery of
hooks, skills, custom commands, subagents, plugins, MCP servers, auto memory, and CLAUDE.md — so a
script behaves identically regardless of what's configured in the machine's `~/.claude`:
```bash
claude --bare -p "Summarize README.md" --allowedTools "Read"
```
In bare mode, credentials must come from `ANTHROPIC_API_KEY` (no OAuth/keychain access).

**`--output-format` — three values (quoted):**
- `text` (default): plain text output
- `json`: "structured JSON with result, session ID, and metadata" — text answer lives in the
  `result` field; also includes `total_cost_usd` and a per-model cost breakdown (client-side
  estimates)
- `stream-json`: newline-delimited JSON, one event per line, final line is a `result` message

**Structured output for automation — the CLI exposes the same Structured Outputs mechanism as the
API:**
```bash
claude -p "Extract the main function names from auth.py" \
  --output-format json \
  --json-schema '{"type":"object","properties":{"functions":{"type":"array","items":{"type":"string"}}},"required":["functions"]}'
```
Response metadata (session ID, usage) comes back alongside a `structured_output` field holding the
schema-validated data. Extract with `jq`:
```bash
claude -p "Extract function names from auth.py" \
  --output-format json \
  --json-schema '{...}' \
  | jq '.structured_output'
```

**Permission scoping for CI (the documented production pattern):**
- `--allowedTools "Bash,Read,Edit"`, or scoped rules like `Bash(git diff *)`, `Bash(git commit *)`
  (trailing ` *` enables prefix matching — note the space before `*` matters:
  `Bash(git diff *)` ≠ `Bash(git diff*)`, the latter would also match `git diff-index`)
- `--permission-mode dontAsk` for locked-down CI: "Claude Code denies anything not in your
  `permissions.allow` rules or the read-only command set"
- `--permission-prompts none` for fully unattended/scheduled runs: nothing waits on a human;
  anything that would have prompted is denied instead, and Claude is told not to retry it

Example: unattended dependency update run in CI —
```bash
claude -p "Update the dependency pins and run the tests" \
  --permission-mode auto --permission-prompts none
```

Example: security-focused PR review script (`review.sh`) —
```bash
gh pr diff "$1" | claude -p \
  --append-system-prompt "You are a security engineer. Review for vulnerabilities." \
  --output-format json
```

**Anthropic's own CI code-review guidance — two distinct, documented products:**

1. **Hosted GitHub-App Code Review** (Team/Enterprise, research preview). Multiple specialized agents
   analyze the PR diff and surrounding codebase in parallel on Anthropic's infrastructure, then a
   verification step checks candidates against actual code behavior to filter false positives.
   Findings are severity-tagged (🔴 Important — should fix before merge; 🟡 Nit — minor; 🟣
   Pre-existing — bug exists but wasn't introduced by this PR) and posted as inline PR comments plus
   a **non-blocking, always-neutral** check run — "Findings are tagged by severity and don't approve
   or block your PR, so existing review workflows stay intact." Tunable via:
   - The repo's own `CLAUDE.md` (read as project context; newly-introduced violations become
     nit-level findings)
   - A review-only `REVIEW.md` at repo root — freeform instructions read directly by the finding/
     verification/ranking agents; quoted: "`@` import syntax is not expanded, and referenced files
     are not read along with it. Put the rules you want enforced directly in the file."

   Example `REVIEW.md`:
   ```markdown
   # Review instructions

   ## What Important means here
   Reserve Important for findings that would break behavior, leak data,
   or block a rollback. Style, naming, and refactoring suggestions are
   Nit at most.

   ## Cap the nits
   Report at most five Nits per review. If you found more, say "plus N
   similar items" in the summary instead of posting them inline.

   ## Do not report
   - Anything CI already enforces: lint, formatting, type errors
   - Generated files under `src/gen/` and any `*.lock` file
   ```

2. **Run-it-yourself in your own CI:** `claude -p '/code-review ultra'` (launches Anthropic's cloud
   review from a script and prints a tracking link) or the `anthropics/claude-code-action` GitHub
   Action — "run Claude in your own GitHub Actions workflows for custom automation beyond code
   review."

   Local/manual equivalent for a single diff, no GitHub App needed: `/code-review` (alias of the
   older `/review`; `/simplify` is now a separate cleanup-only sibling command). Runs as a
   **background subagent** with its own context window so it doesn't fill your conversation; supports
   `--fix` (apply findings to the working tree) and `--comment` (post as inline PR comments); effort
   levels `low`/`medium` favor confidence (fewer, more certain findings) while `high`→`max` favor
   coverage (broader, may include less-certain findings).

---

## Summary of confidence levels

**High confidence — quoted directly from current primary docs, fetched 2026-09-07:**
- A2 (`tool_choice` + extended-thinking incompatibility, including the table and exact error
  conditions)
- A5 (prefill deprecation on 4.6+ and its exact incompatibility with thinking)
- B7 (`effort` vs `budget_tokens` — exact per-model-tier state and migration mapping)
- C8 (Batch API mechanics, including size/SLA/retention numbers and the ordering guarantee)
- All of Section D (CLAUDE.md hierarchy, `.claude/rules/`, skills/commands unification, headless CI)
  — fetched directly from code.claude.com/docs, which is extremely detailed and version-specific

**Explicitly flagged as unverified against any primary source, after exhaustive checking:**
- A3's "enum + `other` + detail field" escape-hatch pattern
- A4's "reasoning property ordered first in the JSON schema" pattern — **this is the one to be most
  careful with**, since it appears to originate from third-party exam-prep content rather than
  Anthropic's own docs or cookbook. Recommend citing the two mechanisms Anthropic *does* document
  instead (adaptive thinking, and `<thinking>`/`<answer>` XML-tag separation) if the study guide needs
  a "how to preserve CoT with structured output" answer.

**One process note for the study guide:** several of the mechanics above (adaptive thinking, `effort`,
prefill deprecation, commands/skills unification) are tied to the Claude 4.6+ / 5-generation model
refresh. If the official exam blueprint was written against an earlier model generation, note that
explicitly in the guide so a "what does `budget_tokens` do" question isn't answered as if it were
already fully replaced everywhere.

**Two question-bank corrections from the follow-up round:**
1. **Batch request limit is 100,000 (or 256 MB), not 10,000.** 10,000 was the original October 2024
   public-beta figure, superseded at General Availability on December 17, 2024, roughly 18 months
   before this exam's July 2026 guide. A question asserting 10,000 tests stale pre-GA information.
2. **"More specific glob wins" for `.claude/rules/` is unsupported by current docs.** The
   documentation describes matching rules as concatenating into context, not competing by
   specificity; the only documented tie-breaking behavior is that conflicts are left to Claude to
   resolve ("may pick one arbitrarily"), and the only real precedence rule stated is scope-based
   (project rules load after — and so take precedence in practice over — user-level rules), not
   glob-based. Recommend rewriting any answer key that relies on glob specificity as a resolution
   mechanism.
