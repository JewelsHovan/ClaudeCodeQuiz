# Domain 4: Prompt Engineering & Structured Output (20%)

## Task 4.1: Design Prompts with Explicit Criteria

### Key Principle
Explicit criteria > vague instructions. "Flag comments only when claimed behavior contradicts actual code behavior" beats "check that comments are accurate."

### What Doesn't Work
- "Be conservative" or "only report high-confidence findings" — too vague
- General instructions don't improve precision vs specific categorical criteria
- High false positive rates in one category undermine trust in ALL categories

### What Works
- Define which issues to report (bugs, security) vs skip (minor style, local patterns)
- Temporarily disable high false-positive categories to restore trust
- Define severity criteria with concrete code examples per level

---

## Task 4.2: Few-Shot Prompting

### When to Use
- Output format is inconsistent despite detailed instructions
- Ambiguous scenarios need judgment (tool selection, edge cases)
- Extraction from varied document structures (inline citations vs bibliographies)
- Reducing hallucination in extraction tasks

### Best Practices
- 2-4 targeted examples for ambiguous scenarios
- Show reasoning for WHY one action was chosen over alternatives
- Include examples that distinguish acceptable patterns from genuine issues
- Few-shot enables generalization to novel patterns (not just matching pre-specified cases)

---

## Task 4.3: Structured Output via tool_use

### The Core Guarantee
**Tool use + JSON schemas eliminates JSON SYNTAX errors. It does NOT prevent SEMANTIC errors.**

Syntax errors eliminated:
- Malformed JSON, wrong types, missing required fields, values outside enums

Semantic errors still possible:
- Hallucinated values, misclassified categories, wrong confidence scores
- Line items that don't sum to total, values in wrong fields

### tool_choice Options

| Mode | JSON | Behavior |
|------|------|----------|
| `auto` (default) | `{"type": "auto"}` | Model may return text OR call a tool |
| `any` | `{"type": "any"}` | Model MUST call a tool, chooses which |
| Forced | `{"type": "tool", "name": "extract_metadata"}` | Model MUST call that specific tool |
| `none` | `{"type": "none"}` | No tools may be called |

**Key constraint**: `any` and forced tool are incompatible with extended thinking.

### When to Use Each

- **`auto`**: Default for most use cases, model decides if tool is needed
- **`any`**: Guarantee structured output when multiple extraction schemas exist and document type is unknown
- **Forced**: Ensure specific extraction runs first (e.g., `extract_metadata` before enrichment steps)
- **`none`**: Disable tool calling entirely

### JSON Schema Design Patterns

**Required vs Optional Fields**
```json
{
  "properties": {
    "invoice_number": {"type": "string"},      // Always present → required
    "purchase_order": {"type": "string"}        // Sometimes absent → optional
  },
  "required": ["invoice_number"]
}
```
Rule: Only require fields always present in source material. Optional fields reduce fabrication risk.

**Enum with "other" + Detail String (Escape Hatch)**
```json
{
  "category": {
    "type": "string",
    "enum": ["finance", "legal", "technical", "other"]
  },
  "category_detail": {
    "type": "string",
    "description": "Required when category is 'other'. Free-text explanation."
  }
}
```

**Nullable Fields to Prevent Fabrication**
```json
{
  "author": {
    "type": ["string", "null"],
    "description": "Author name, or null if not found"
  }
}
```
**Critical exam point**: Requiring a non-nullable field when data is sometimes absent is the biggest driver of hallucination in extraction pipelines.

---

## Task 4.4: Validation, Retry, and Feedback Loops

### Retry-with-Error-Feedback Pattern
1. Extract data with tool_use
2. Validate against schema/business rules
3. On failure: send follow-up with original document + failed extraction + specific validation errors
4. Model self-corrects based on error feedback

### When Retries Work vs Don't
- **Works**: Format mismatches, structural output errors, field placement issues
- **Doesn't work**: Information simply absent from source document (can't extract what isn't there)

### Self-Correction Validation
- Extract `calculated_total` alongside `stated_total` to flag discrepancies
- Add `conflict_detected` booleans for inconsistent source data
- Track `detected_pattern` fields to analyze false positive patterns when developers dismiss findings

---

## Task 4.5: Batch Processing (Message Batches API)

### Key Numbers
| Metric | Value |
|--------|-------|
| Cost savings | **50%** on input + output tokens |
| Max requests per batch | **10,000** |
| Processing SLA | Up to **24 hours** |
| Result retention | **29 days** |

### Critical Limitations
- No multi-turn tool calling within a single batch request
- Results NOT returned in order — use `custom_id` to correlate
- No guaranteed latency

### When to Use vs Not Use

| Use Batches | Do NOT Use Batches |
|-------------|-------------------|
| Overnight report generation | Blocking pre-merge CI/CD checks |
| Bulk document extraction | User-facing interactive features |
| Weekly technical debt audits | Real-time chat/assistant |
| Content moderation queues | Anything requiring tool call loops |

### Batch Request Structure
```json
{
  "requests": [
    {
      "custom_id": "doc-001",
      "params": {
        "model": "claude-opus-4-5",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": "..."}]
      }
    }
  ]
}
```

### Failure Handling
- Resubmit only failed documents (identified by `custom_id`)
- Chunk documents that exceeded context limits
- Refine prompts on a sample set BEFORE batch-processing large volumes

---

## Task 4.6: Multi-Instance and Multi-Pass Review

### Self-Review Limitation
A model retains reasoning context from generation — it's less likely to question its own decisions in the same session.

### Solutions
- **Independent review instance**: Second Claude instance without generator's reasoning context
- **Multi-pass review**: Per-file local analysis + separate cross-file integration pass
- **Confidence-based routing**: Model self-reports confidence alongside findings for calibrated review routing

### Key Exam Point
Independent review instances > self-review instructions > extended thinking for catching subtle issues.
