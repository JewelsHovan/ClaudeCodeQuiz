# Scenario-Based Practice Questions

These mirror the actual exam format: each scenario presents a realistic production context with multiple questions.

---

## Scenario A: Customer Support Resolution Agent

You are building a customer support resolution agent using the Claude Agent SDK. The agent has access to MCP tools: `get_customer`, `lookup_order`, `process_refund`, `escalate_to_human`. Target: 80%+ first-contact resolution.

### A1.
Your MCP tools return data in inconsistent formats: `get_customer` returns Unix timestamps, `lookup_order` returns ISO 8601 dates, and `process_refund` returns numeric status codes. The agent sometimes misinterprets these formats. What's the best approach?

A) Add explicit format conversion instructions to the system prompt for each of the tools
B) Add PostToolUse hooks that normalize every tool result before the model sees it
C) Modify each of the MCP servers so all three return their data in one unified format
D) Add few-shot examples showing correct interpretation of each of the three formats

**Answer: B** — PostToolUse hooks intercept tool results for transformation before the model processes them. This is deterministic and doesn't require modifying MCP servers. Option A is probabilistic. Option C requires changing all servers. Option D adds token overhead.

---

### A2.
A customer writes: "I need help with my order #5678 AND I want to update my shipping address." The agent handles the order inquiry but forgets to address the shipping address change. How should you improve this?

A) Add an instruction to the system prompt to always address every customer concern
B) Decompose the request into distinct concerns, handle each, then synthesize one reply
C) Require customers to raise one concern per message and open a second ticket for the rest
D) Add a post-response check that compares the drafted response against the original request

**Answer: B** — Multi-concern decomposition is the exam-tested pattern. The agent should identify distinct items, handle each (potentially in parallel using shared context), then synthesize. Option D is reasonable but doesn't fix the root cause.

---

### A3.
The `lookup_order` tool returns 42 fields per order, but the agent only needs 5 fields for return processing. Over a multi-turn conversation, these verbose results consume significant context. What should you do?

A) Increase max_tokens so the conversation can accommodate the extra context
B) Trim each tool result down to the fields the task needs before it enters context
C) Ask the customer to read out the order details so the lookup call becomes unnecessary
D) Switch to a model with a larger context window to absorb the verbose results

**Answer: B** — Trimming tool outputs to relevant fields prevents context bloat. This is a core context management pattern. Options A and D don't address the fundamental waste.

---

## Scenario B: Multi-Agent Research System

You are building a multi-agent research system. A coordinator delegates to: web search agent, document analysis agent, synthesis agent, and report generation agent.

### B1.
The synthesis agent needs to verify a specific statistic while combining findings. Currently this requires a round-trip through the coordinator to the web search agent, adding 40% latency. 85% of verifications are simple fact-checks. What's the most effective approach?

A) Give the synthesis agent direct access to the full web search tool set
B) Give the synthesis agent a scoped `verify_fact` tool; complex checks stay with the coordinator
C) Have the synthesis agent batch its verification needs and send them to the coordinator at the end
D) Have the initial research phase pre-cache extra context that verification might later need

**Answer: B** — A scoped cross-role tool covers the 85% of verifications that are simple lookups, while the coordinator still owns the complex ones, so separation of concerns survives. Option A over-provisions (violates least privilege). Option C creates blocking dependencies. Option D can't predict which facts will need checking.

---

### B2.
Your research system produces a report on "renewable energy costs" that states "Solar panel costs decreased by 89% since 2010" without any source attribution. The web search agent found this statistic from two sources with slightly different numbers (87% and 89%). What's the correct design?

A) Have the synthesis agent report the figure published by the more recent of the two sources
B) Average the two conflicting figures and report 88% as the single number
C) Require subagents to emit claim-source mappings and annotate conflicts with their sources
D) Have the synthesis agent verify which number is correct using the web search tool

**Answer: C** — Structured claim-source mappings preserve provenance: each figure travels with the source that produced it. Conflicting values should be annotated with both sources, not arbitrarily resolved, so the report distinguishes well-established findings from contested ones. Option A silently privileges recency, Option B invents a number no source published, and Option D treats a genuine source disagreement as a fact to be looked up again.

---

### B3.
The web search subagent times out on 2 of 5 queries. It returns: `{"status": "error", "message": "search unavailable"}`. The coordinator retries the same queries, which time out again. What's wrong with the error reporting?

A) The subagent should retry internally before reporting the failure to the coordinator
B) The error lacks structured context: failure type, attempted queries, partial results, and alternatives
C) The coordinator should reformulate the queries instead of retrying the identical ones
D) Both A and B — retry transient failures locally, and report structured context when propagating

**Answer: D** — The subagent should implement local recovery for transient failures (A). When propagating, it should include structured error context enabling intelligent coordinator decisions (B). Option C is something the coordinator could do, but only if it receives enough context to make that decision.

---

## Scenario C: Claude Code for CI/CD

You are integrating Claude Code into your CI/CD pipeline for automated code reviews and test generation.

### C1.
Your CI pipeline runs `claude "Review this PR for bugs"` and the job hangs indefinitely. What's the fix?

A) Add a `--batch` flag: `claude --batch "Review this PR for bugs"` in the CI step
B) Add the `-p` flag: `claude -p "Review this PR for bugs"` in the CI step
C) Set `CLAUDE_NONINTERACTIVE=true` in the job's environment before the step
D) Redirect stdin in the CI step: `claude "Review this PR" < /dev/null`

**Answer: B** — The `-p` (or `--print`) flag runs Claude Code in non-interactive mode. Options A, C are non-existent features. Option D is a Unix workaround that doesn't properly address Claude Code's CLI.

---

### C2.
Your automated review runs after each push. After a developer fixes issues from the first review and pushes again, the second review flags the same issues (now fixed) AND new issues. How should you handle re-reviews?

A) Clear the previous review context so each run starts from a clean slate
B) Include prior review findings in context and ask for only new or unaddressed issues
C) Run a diff between the two review outputs and post only the new findings
D) Restrict each re-review to the files changed by the most recent commit

**Answer: B** — Include prior findings in context with instructions to report only new/unaddressed issues. This prevents duplicate comments. Option D misses cross-file integration issues from the changes.

---

### C3.
The CI generates test cases, but many duplicate existing tests or test trivial getter/setter methods. How should you improve quality?

A) Add `--temperature 0` to the CI invocation to reduce randomness in the output
B) Provide the existing test files in context and document testing standards in CLAUDE.md
C) Filter the generated tests by the incremental code coverage each one adds
D) Only generate tests for functions above a measured cyclomatic-complexity threshold

**Answer: B** — Providing existing tests prevents duplicates. Documenting testing standards and valuable test criteria in CLAUDE.md improves quality. Option A doesn't address the knowledge gap about existing tests.

---

## Scenario D: Structured Data Extraction

You're extracting structured data from unstructured documents using Claude with JSON schema enforcement.

### D1.
Your extraction schema requires a `contract_expiry_date` field, but 30% of documents don't include an expiry date. Claude fabricates plausible dates for these documents. What's the root cause and fix?

A) Add "do not fabricate dates" to the prompt → root cause is unclear instructions
B) Make `contract_expiry_date` nullable → root cause is a required field for sometimes-absent data
C) Add a validation step that checks dates against a contract database → root cause is missing validation
D) Remove the field from the schema → root cause is collecting data you don't need

**Answer: B** — Requiring a non-nullable field when data is sometimes absent is the single greatest driver of hallucination in extraction. Declaring the field `"type": ["string", "null"]` lets Claude return `null` when no date exists instead of inventing one. Option A is probabilistic. Option C catches only dates a database already knows. Option D loses valuable data when the date IS present.

---

### D2.
Your extraction fails Pydantic validation because line items don't sum to the total. The schema is syntactically valid. What type of error is this and how do you handle it?

A) Schema syntax error — fix it by setting `strict: true` on the extraction tool schema
B) Semantic validation error — retry with the error and failed extraction fed back
C) Transient error — retry the identical request and expect it to pass next time
D) Schema design error — add a `calculated_total` field alongside the line-item array

**Answer: B** — Tool use eliminates syntax errors but NOT semantic errors (values don't sum). Retry-with-error-feedback resends the original document, the failed extraction, and the specific validation message so Claude can self-correct against the evidence. Option A misdiagnoses a valid schema. Option C retries an input that will fail identically. Option D is a useful detection pattern but doesn't fix it alone.

---

### D3.
You need to process 5,000 contracts overnight. Some are 100+ pages and may exceed context limits. You want 50% cost savings. What's your approach?

A) Use the synchronous API with a thread pool for parallelism across the 5,000 files
B) Use the Message Batches API, track failures by `custom_id`, and chunk oversized documents
C) Submit all 5,000 documents to the Message Batches API at once and accept some failures
D) Process the contracts sequentially with retry logic around each document

**Answer: B** — Batch API for 50% savings (overnight = latency-tolerant). Use `custom_id` to correlate results and identify failures. Chunk oversized documents and resubmit only failed ones. Option C doesn't handle failures. Option A misses cost savings.
