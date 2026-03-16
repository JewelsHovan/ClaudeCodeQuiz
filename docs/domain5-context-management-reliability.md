# Domain 5: Context Management & Reliability (15%)

## Task 5.1: Manage Conversation Context

### Key Risks
- **Progressive summarization**: Condensing numbers, dates, percentages into vague summaries loses critical data
- **"Lost in the middle" effect**: Models reliably process beginning and end of long inputs, may omit findings from middle sections
- **Tool result bloat**: Tool outputs accumulate tokens (e.g., 40+ fields per order lookup when only 5 matter)
- **Conversation history**: Must pass complete history in subsequent API requests for coherence

### Solutions

**Case Facts Block**
Extract transactional facts (amounts, dates, order numbers, statuses) into a persistent "case facts" block included in each prompt, OUTSIDE summarized history.

**Trim Verbose Tool Outputs**
Keep only relevant fields before they accumulate in context (e.g., only return-relevant fields from order lookups).

**Position-Aware Ordering**
Place key findings summaries at BEGINNING of aggregated inputs. Use explicit section headers for detailed results. This mitigates "lost in the middle."

**Structured Subagent Outputs**
- Require metadata (dates, source locations, methodological context)
- Return structured data (key facts, citations, relevance scores) instead of verbose content and reasoning chains
- Especially important when downstream agents have limited context budgets

---

## Task 5.2: Escalation and Ambiguity Resolution

### When to Escalate
- Customer explicitly requests a human → **escalate immediately**, no investigation first
- Policy exceptions/gaps (e.g., competitor price matching when policy only covers own-site)
- Inability to make meaningful progress
- NOT just "complex cases" — some complex cases are still resolvable

### When NOT to Escalate
- Straightforward issues within agent's capability (even if customer is frustrated)
- Offer resolution first, escalate only if customer reiterates preference for human

### Unreliable Escalation Signals
- **Self-reported confidence scores**: LLMs are poorly calibrated (confidently wrong on hard cases)
- **Sentiment analysis**: Frustration doesn't correlate with case complexity

### Multiple Matches
When tool results return multiple customer matches → ask for additional identifiers, DON'T select based on heuristics.

---

## Task 5.3: Error Propagation in Multi-Agent Systems

### Anti-Patterns
- Silently suppressing errors (returning empty results as success)
- Terminating entire workflow on single failure
- Generic error statuses ("search unavailable") that hide context

### Correct Pattern: Structured Error Context
Return to coordinator:
- **Failure type** (transient, validation, permission, business)
- **What was attempted** (the query, parameters)
- **Partial results** (what succeeded before failure)
- **Potential alternatives** (other approaches to try)

### Access Failures vs Valid Empty Results
- **Access failure**: Timeout, service down → needs retry decision
- **Valid empty result**: Successful query, no matches → no error, just empty data
- These MUST be distinguishable in error reporting

### Local Recovery First
Subagents should:
1. Attempt local recovery for transient failures
2. Only propagate errors they cannot resolve
3. Include what was attempted and partial results when propagating

### Coverage Annotations
Synthesis output should annotate which findings are well-supported vs which topic areas have gaps due to unavailable sources.

---

## Task 5.4: Large Codebase Exploration

### Context Degradation
In extended sessions, models start:
- Giving inconsistent answers
- Referencing "typical patterns" instead of specific classes discovered earlier

### Solutions

**Scratchpad Files**
Persist key findings across context boundaries. Reference them for subsequent questions.

**Subagent Delegation**
Spawn subagents for specific questions ("find all test files", "trace refund flow dependencies") while main agent coordinates.

**Phase Summaries**
Summarize key findings from one exploration phase BEFORE spawning subagents for the next phase. Inject summaries into initial context.

**Crash Recovery**
- Each agent exports state to a known location (structured manifests)
- Coordinator loads manifest on resume and injects into agent prompts

**`/compact`**
Use during extended exploration sessions when context fills with verbose discovery output.

---

## Task 5.5: Human Review Workflows

### Aggregate Metrics Are Deceptive
97% overall accuracy may mask poor performance on specific document types or fields.

### Stratified Random Sampling
Sample high-confidence extractions to:
- Measure actual error rates
- Detect novel error patterns
- Validate before automating

### Field-Level Confidence Scores
- Have model output confidence per field
- Calibrate thresholds using labeled validation sets
- Route low-confidence extractions to human review
- Analyze accuracy by document type AND by field

### Before Reducing Human Review
Validate accuracy by document type and field segment to verify consistent performance across ALL segments.

---

## Task 5.6: Information Provenance

### The Problem
Source attribution is lost during summarization when findings are compressed without preserving claim-source mappings.

### Solutions

**Claim-Source Mappings**
Require subagents to output structured mappings:
- Source URLs / document names
- Relevant excerpts
- Publication or data collection dates

**Conflicting Sources**
- Annotate conflicts with source attribution rather than arbitrarily selecting one value
- Complete analysis with conflicting values included and explicitly annotated
- Let coordinator decide how to reconcile

**Temporal Data**
Require publication/collection dates to prevent temporal differences from being misinterpreted as contradictions.

**Output Formatting**
Render different content types appropriately:
- Financial data → tables
- News → prose
- Technical findings → structured lists
Don't convert everything to a uniform format.

**Report Structure**
Explicitly distinguish:
- Well-established findings
- Contested findings
- Findings with gaps due to unavailable sources
