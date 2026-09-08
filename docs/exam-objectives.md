# Exam objectives — the real, objective-level blueprint

> **Provenance.** Transcribed from the official Pearson VUE score report of an exam sat and passed on
> **2026-09-07** (scaled 887). This is the exam's own objective list, in its own wording — considerably
> more granular than the five-domain weighting, and the best available guide to what is actually asked.
> Domain assignments below are our mapping, not the report's.

## How to read the percentages

The report gives a percent-correct per objective. With **~60 questions across 37 objectives that is
about 1.6 questions each**, so a percentage is one to three items:

| Reported | Actually means |
|---|---|
| 0% | missed the only question (or both of two) |
| 50% | 1 of 2 |
| 67% | 2 of 3 |
| 80% | 4 of 5 |
| 100% | all of 1–3 |

**Do not read a 0% as a knowledge hole.** The 2026-09-07 attempt scored 30 of 37 objectives at 100%
with seven single-item misses spread across seven different objectives — which is what an 887 looks
like. The value of this list is the *objective wording and coverage*, not one person's per-item luck.

## Scenarios drawn on 2026-09-07

Four of the six themes appeared: **Claude Code for Continuous Integration** · **Multi-Agent Research
System** · **Developer Productivity / Code Generation with Claude Code** · **Structured Data
Extraction**. Customer Support Resolution Agent did not appear — worth noting, since it is this
repo's single most-covered theme.

## The 37 objectives

`Bank` is a keyword-probe count of related questions in `quiz/bank/*.json` — a rough coverage signal,
not a precise mapping. `Score` is the 2026-09-07 result.

### Domain 1 — Agentic Architecture & Orchestration (27%)

| # | Objective | Score | Bank |
|---|---|---|---|
| 1 | Configure agentic loops to emit multiple tool calls within a single response turn, enabling parallel execution of independent subtasks and reducing total round-trip latency. | 100% | 21 |
| 2 | Apply session resumption techniques — including targeted re-analysis of changed files and context injection — to restore agent state accurately without repeating prior work. | 100% | 13 |
| 3 | Construct subagent prompts that include all findings, structured data, and source metadata required for task completion without returning to the coordinator for missing context. | 100% | 8 |
| 4 | Evaluate subagent delegation strategies — goal-oriented versus procedural instructions — and select the approach that enables adaptive behavior while maintaining coordinator visibility and control. | 100% | 8 |
| 5 | Configure subagent invocations with appropriate tool restrictions, context scoping, and system prompts that constrain each agent to its designated role. | 100% | 3 |
| 6 | Diagnose misconfigured subagent spawning by identifying missing tool permissions, incorrect AgentDefinition parameters, or absent coordinator-to-subagent wiring. | 100% | 13 |
| 7 | Decompose complex tasks into dynamically generated subtasks that adapt as new information is discovered, rather than executing a fixed sequence regardless of intermediate findings. | 100% | 20 |
| 8 | Select the appropriate agentic review architecture — plan mode, direct execution, or multi-phase workflow — based on task scope, risk level, and human approval requirements. | 100% | 5 |
| 9 | Design state persistence strategies for multi-agent pipelines that enable reliable resumption after interruption without repeating completed work or losing prior findings. | 100% | 25 |
| 10 | Evaluate multi-agent orchestration patterns — coordinator-worker, parallel execution, and sequential pipelines — to select the structure best satisfying research coverage, latency, and reliability requirements. | 100% | 60 |
| 18 | Design subagent output schemas that render structured data, prose summaries, and citation metadata in the format best suited to downstream synthesis and reporting. | 0% | 9 |

### Domain 2 — Tool Design & MCP Integration (18%)

| # | Objective | Score | Bank |
|---|---|---|---|
| 33 | Configure tool distribution in multi-agent systems by assigning each subagent only the tools required for its designated role, reducing decision complexity and preventing out-of-role tool invocations. | 50% | 2 ⚠️ |
| 34 | Distinguish between MCP resources and tools, and expose server content as resources to reduce exploratory tool calls and improve agent efficiency in cross-system queries. | 100% | 37 |
| 35 | Integrate MCP servers into Claude Code and agent applications by selecting the correct server scope, configuring authentication via environment variable expansion, and verifying tool discovery. | 100% | 6 |
| 36 | Write MCP tool descriptions that clearly distinguish each tool's purpose, input formats, use-case boundaries, and relationships to semantically similar tools, reducing misrouting and incorrect tool selection. | 100% | 6 |
| 37 | Configure the `tool_choice` parameter to guarantee tool invocation when structured output is required, and sequence multi-tool workflows so prerequisite data is obtained before dependent tools are called. | 100% | 14 |

### Domain 3 — Claude Code Configuration & Workflows (20%)

| # | Objective | Score | Bank |
|---|---|---|---|
| 11 | Configure Claude Code CLI invocations for automated CI/CD pipelines using non-interactive flags, permission modes, and cost and turn limits that prevent runaway executions. | 100% | 5 |
| 12 | Structure iterative refinement workflows by providing concrete input-output examples, targeted feedback on specific failures, and batched issue descriptions for consolidated evaluation. | 100% | 17 |
| 13 | Design Claude Code review configurations that load the correct project standards, restrict unnecessary tool access, and produce structured output suitable for automated downstream processing. | 0% | 1 ⚠️ |
| 14 | Apply the `context: fork` frontmatter option to Skill and slash command configurations that should execute in an isolated subagent context, preventing cross-contamination of session state. | 100% | 11 |
| 15 | Improve automated test generation quality by providing existing test files as context, defining fixture conventions, and specifying criteria that distinguish meaningful behavioral tests from trivial assertions. | 100% | 3 |
| 16 | Select the correct Claude Code configuration mechanism — CLAUDE.md, `.claude/rules/` with glob patterns, Skills, hooks, or settings permissions — based on guidance type and when it should apply. | 100% | 37 |
| 17 | Apply systematic codebase exploration strategies using Grep, Glob, and Read tools that build incremental understanding while managing context window constraints. | 80% | 13 |
| 32 | Select the appropriate Claude Code built-in tool — Grep, Glob, Read, or Bash — based on the nature of the search or file operation required for a given codebase task. | 100% | 13 |

### Domain 4 — Prompt Engineering & Structured Output (20%)

| # | Objective | Score | Bank |
|---|---|---|---|
| 23 | Select the appropriate API processing mode — synchronous Messages API or asynchronous Message Batches API — based on latency requirements, workflow blocking behavior, and acceptable processing windows. | 100% | 15 |
| 24 | Design specialized review passes that separate concerns — security, business logic, API design — into focused prompts with dedicated few-shot examples, preventing recall trade-offs from competing concerns in a single prompt. | 100% | 1 ⚠️ |
| 25 | Select and implement the most reliable structured output method — tool use with JSON schema, prompt-based formatting, or prefilled responses — based on required schema compliance strictness. | 100% | 40 |
| 26 | Design extraction schemas with optional fields, nullable values, and appropriate enum definitions that allow the model to accurately represent missing or ambiguous information without fabricating values. | 67% | 11 |
| 27 | Implement tool use with defined JSON schemas to enforce structured output compliance, and configure `tool_choice` to guarantee tool invocation when conversational responses would cause downstream failures. | 100% | 14 |
| 28 | Resolve structured output truncation failures by splitting large review tasks into smaller scoped API calls and merging resulting data structures, rather than increasing `max_tokens` beyond practical limits. | 100% | 29 |
| 29 | Apply extraction accuracy patterns — structured schemas with optional fields, format normalization instructions, and few-shot examples — to reduce hallucination and improve consistency across varied document formats. | 100% | 32 |
| 30 | Reduce automated review false positive rates by supplying project-specific conventions, accepted patterns, and exclusion criteria as persistent context applied on every review. | 100% | 6 |
| 31 | Design prompt criteria that define explicit inclusion and exclusion boundaries, preventing the model from generating findings or extractions in categories where performance is unreliable. | 100% | 6 |

### Domain 5 — Context Management & Reliability (15%)

| # | Objective | Score | Bank |
|---|---|---|---|
| 19 | Design synthesis agent behavior that preserves source-level uncertainty, distinguishing well-established findings from contested claims rather than collapsing conflicting data into single confident statements. | 100% | 8 |
| 20 | Apply context management strategies — subagent isolation, scratchpad files, and targeted file reading — to sustain coherent codebase exploration across sessions exceeding context limits. | 100% | 3 |
| 21 | Apply context window optimization techniques — summarization, sliding windows, structured state objects, and selective retention — to maintain response quality as conversations exceed practical token limits. | 0% | 8 |
| 22 | Design human review routing strategies that direct extractions to reviewers based on confidence scores, document characteristics, and field-level ambiguity rather than random sampling. | 67% | 8 |

## Coverage gaps worth closing

Objectives with two or fewer related questions in the bank, ordered by how badly they were served:

| # | Objective | Bank | Score |
|---|---|---|---|
| 13 | Design Claude Code review configurations | 1 | 0% |
| 24 | Design specialized review passes | 1 | 100% |
| 33 | Configure tool distribution in multi-agent systems | 2 | 50% |

Two further notes from the 2026-09-07 report:

- **Objective 13 (review configurations) had zero related questions** and scored 0%. Combined with the
  firsthand report that CI/CD was heavily represented, this is the clearest single gap in the bank.
- **Objective 18 (subagent output schemas) scored 0% despite nine related questions.** That is a
  coverage-*quality* gap rather than a quantity one: the exam asked which output *format* best serves
  downstream synthesis — structured data vs prose vs citation metadata — which is a different question
  from whether citations should exist at all. Worth re-reading those nine before writing more.
