# Scenario-Based Practice Questions

These mirror the actual exam format: each scenario presents a realistic production context with multiple questions.

---

## Scenario A: Customer Support Resolution Agent

You are building a customer support resolution agent using the Claude Agent SDK. The agent has access to MCP tools: `get_customer`, `lookup_order`, `process_refund`, `escalate_to_human`. Target: 80%+ first-contact resolution.

### A1.
Your MCP tools return data in inconsistent formats: `get_customer` returns Unix timestamps, `lookup_order` returns ISO 8601 dates, and `process_refund` returns numeric status codes. The agent sometimes misinterprets these formats. What's the best approach?

A) Add format conversion instructions to the system prompt for each tool
B) Implement PostToolUse hooks to normalize all tool outputs to consistent formats before the model processes them
C) Modify each MCP server to return data in a unified format
D) Add few-shot examples showing correct interpretation of each format

**Answer: B** — PostToolUse hooks intercept tool results for transformation before the model processes them. This is deterministic and doesn't require modifying MCP servers. Option A is probabilistic. Option C requires changing all servers. Option D adds token overhead.

---

### A2.
A customer writes: "I need help with my order #5678 AND I want to update my shipping address." The agent handles the order inquiry but forgets to address the shipping address change. How should you improve this?

A) Add "always address all customer concerns" to the system prompt
B) Decompose multi-concern requests into distinct items, investigate each, then synthesize a unified response
C) Require customers to submit one request at a time
D) Add a post-response check that compares the response against the original request

**Answer: B** — Multi-concern decomposition is the exam-tested pattern. The agent should identify distinct items, handle each (potentially in parallel using shared context), then synthesize. Option D is reasonable but doesn't fix the root cause.

---

### A3.
The `lookup_order` tool returns 42 fields per order, but the agent only needs 5 fields for return processing. Over a multi-turn conversation, these verbose results consume significant context. What should you do?

A) Increase max_tokens to accommodate the extra context
B) Trim verbose tool outputs to only relevant fields before they accumulate in context
C) Ask the customer to provide order details verbally to avoid tool calls
D) Switch to a model with a larger context window

**Answer: B** — Trimming tool outputs to relevant fields prevents context bloat. This is a core context management pattern. Options A and D don't address the fundamental waste.

---

## Scenario B: Multi-Agent Research System

You are building a multi-agent research system. A coordinator delegates to: web search agent, document analysis agent, synthesis agent, and report generation agent.

### B1.
The synthesis agent needs to verify a specific statistic while combining findings. Currently this requires a round-trip through the coordinator to the web search agent, adding 40% latency. 85% of verifications are simple fact-checks. What's the most effective approach?

A) Give the synthesis agent access to all web search tools
B) Give the synthesis agent a scoped `verify_fact` tool for simple lookups; complex verifications still route through coordinator
C) Have the synthesis agent batch all verification needs and send them to coordinator at the end
D) Pre-cache extra context during initial research

**Answer: B** — Scoped cross-role tool for the 85% common case. Preserves separation of concerns for complex cases. Option A over-provisions (violates least privilege). Option C creates blocking dependencies. Option D can't predict needs.

---

### B2.
Your research system produces a report on "renewable energy costs" that states "Solar panel costs decreased by 89% since 2010" without any source attribution. The web search agent found this statistic from two sources with slightly different numbers (87% and 89%). What's the correct design?

A) Have the synthesis agent pick the most recent source's number
B) Average the two numbers and report 88%
C) Require subagents to output structured claim-source mappings; annotate conflicting values with source attribution
D) Have the synthesis agent verify which number is correct using the web search tool

**Answer: C** — Structured claim-source mappings preserve provenance. Conflicting values should be annotated with sources, not arbitrarily resolved. The report should distinguish well-established from contested findings.

---

### B3.
The web search subagent times out on 2 of 5 queries. It returns: `{"status": "error", "message": "search unavailable"}`. The coordinator retries the same queries, which time out again. What's wrong with the error reporting?

A) The subagent should retry internally before reporting to coordinator
B) The error lacks structured context: failure type, attempted queries, partial results, alternative approaches
C) The coordinator should try different queries instead of retrying the same ones
D) Both A and B

**Answer: D** — The subagent should implement local recovery for transient failures (A). When propagating, it should include structured error context enabling intelligent coordinator decisions (B). Option C is something the coordinator could do, but only if it receives enough context to make that decision.

---

## Scenario C: Claude Code for CI/CD

You are integrating Claude Code into your CI/CD pipeline for automated code reviews and test generation.

### C1.
Your CI pipeline runs `claude "Review this PR for bugs"` and the job hangs indefinitely. What's the fix?

A) Add `--batch` flag
B) Add `-p` flag: `claude -p "Review this PR for bugs"`
C) Set `CLAUDE_NONINTERACTIVE=true` environment variable
D) Redirect stdin: `claude "Review this PR" < /dev/null`

**Answer: B** — The `-p` (or `--print`) flag runs Claude Code in non-interactive mode. Options A, C are non-existent features. Option D is a Unix workaround that doesn't properly address Claude Code's CLI.

---

### C2.
Your automated review runs after each push. After a developer fixes issues from the first review and pushes again, the second review flags the same issues (now fixed) AND new issues. How should you handle re-reviews?

A) Clear the previous review context before each run
B) Include prior review findings in context and instruct Claude to report only new or still-unaddressed issues
C) Run a diff between the two review outputs and only post new findings
D) Only review the changed files in the new commit

**Answer: B** — Include prior findings in context with instructions to report only new/unaddressed issues. This prevents duplicate comments. Option D misses cross-file integration issues from the changes.

---

### C3.
The CI generates test cases, but many duplicate existing tests or test trivial getter/setter methods. How should you improve quality?

A) Add `--temperature 0` to reduce randomness
B) Provide existing test files in context and document testing standards in CLAUDE.md
C) Filter generated tests by code coverage percentage
D) Only generate tests for functions above a certain complexity threshold

**Answer: B** — Providing existing tests prevents duplicates. Documenting testing standards and valuable test criteria in CLAUDE.md improves quality. Option A doesn't address the knowledge gap about existing tests.

---

## Scenario D: Structured Data Extraction

You're extracting structured data from unstructured documents using Claude with JSON schema enforcement.

### D1.
Your extraction schema requires a `contract_expiry_date` field, but 30% of documents don't include an expiry date. Claude fabricates plausible dates for these documents. What's the root cause and fix?

A) Add "do not fabricate dates" to the prompt → root cause is unclear instructions
B) Make `contract_expiry_date` nullable (`"type": ["string", "null"]`) → root cause is requiring non-nullable field for sometimes-absent data
C) Add a validation step that checks dates against a database → root cause is lack of validation
D) Remove the field entirely → root cause is unnecessary data collection

**Answer: B** — Requiring a non-nullable field when data is sometimes absent is the single greatest driver of hallucination in extraction. Making it nullable lets Claude return `null` when no date exists. Option A is probabilistic. Option D loses valuable data when it IS present.

---

### D2.
Your extraction fails Pydantic validation because line items don't sum to the total. The schema is syntactically valid. What type of error is this and how do you handle it?

A) Schema syntax error — fix with `strict: true`
B) Semantic validation error — implement retry-with-error-feedback including the original document, failed extraction, and specific validation error
C) Transient error — retry the same request
D) Schema design error — add a `calculated_total` field

**Answer: B** — Tool use eliminates syntax errors but NOT semantic errors (values don't sum). Retry-with-error-feedback sends the validation error back to Claude for self-correction. Option D is a useful detection pattern but doesn't fix it alone.

---

### D3.
You need to process 5,000 contracts overnight. Some are 100+ pages and may exceed context limits. You want 50% cost savings. What's your approach?

A) Use synchronous API with threading for parallelism
B) Use Message Batches API; handle failures by custom_id; chunk oversized documents and resubmit
C) Use Message Batches API for all documents at once, accepting some failures
D) Process sequentially with retry logic for each document

**Answer: B** — Batch API for 50% savings (overnight = latency-tolerant). Use `custom_id` to correlate results and identify failures. Chunk oversized documents and resubmit only failed ones. Option C doesn't handle failures. Option A misses cost savings.
