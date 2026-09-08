# Community Question Banks & Study Resources — CCA Foundations (CCAR-F)

Research date: 2026-09-07. Scope: GitHub, GitLab, Hugging Face, Reddit, Discord/forums, dev.to, Medium, dedicated exam-prep sites. Goal: topic intelligence for writing **our own original questions** — not a source to copy from.

**Bottom line up front:** No GitLab, Hugging Face, Reddit, or Discord presence was found worth citing — this ecosystem lives almost entirely on **GitHub** (a few dozen community repos, wildly variable quality) plus a **cottage industry of paid "dump" sites** that mostly repackage the same community content. Two GitHub repos (`dnacenta/claude-certified-architect` and `Amey-Thakur/CLAUDE-CERTIFICATIONS`) stand out as genuinely well-researched and current; everything else ranges from decent-but-thin to outright SEO chum.

---

## Ranked Shortlist

### Tier 1 — genuinely worth reading for topic intelligence

**1. [dnacenta/claude-certified-architect](https://github.com/dnacenta/claude-certified-architect)** — study guide (no question bank)
- Format: 5 domain markdown files (`domains/d1-…d5-…`) + `claude-certified-architect.md` overview, plus a static site build. ~482 KB.
- Quality: **The best content found.** Deeply technical, cites exact API mechanics (full `stop_reason` table including `pause_turn`, `model_context_window_exceeded`, `refusal`; `stop_details` object on refusals; server-side refusal-fallback beta headers), current model names (Claude Opus 5, Sonnet 5, Fable 5, Haiku 4.5), the Task→Agent tool rename, hook types including the new 2026 `mcp_tool` type, and a full CI/CD flag table (`-p`, `--output-format`, `--json-schema`, `--max-budget-usd`, `--bare`, `--permission-prompt-tool`, etc.) with a working GitHub Actions YAML snippet. Explicitly notes version drift ("older material — including the exam guide's wording — calls this the Task tool").
- License: **None declared** (no LICENSE file, API reports `license: null`). Treat as all-rights-reserved for copying; fine to read for topic coverage, cite facts, don't reproduce prose.
- Freshness: pushed 2026-08-25 — most recently updated of any repo checked.
- Red flags: none found; internally consistent with our own verified blueprint (6 official scenarios, 720/1000, etc.).
- **Use for:** CI/CD flag reference, context-window/1M-token caveats, subagent isolation & decomposition-risk framing, hook lifecycle diagram, Batch API details.

**2. [Amey-Thakur/CLAUDE-CERTIFICATIONS](https://github.com/Amey-Thakur/CLAUDE-CERTIFICATIONS)** — full 4-cert program (guide + notes + questions + mocks + flashcards)
- Format: per-cert folders, each with study guide, official exam-guide PDF, maintainer notes, 320 total original practice questions (60ish per Architect-Foundations), 3 mock exams per cert, cheat sheet, plus a 110-card flashcard deck (`flashcards.tsv`, Anki/Quizlet/RemNote-importable), a `.claude` skill (`exam-coach`) and slash commands for drilling. 22,972 KB (large — PDFs/images included).
- Quality: High. Uniquely, the maintainer **links verifiable completion badges** for all official Anthropic Academy courses (verify URLs on `academy.claude.com`), so the claim "I worked through the curriculum" is checkable rather than asserted. Domain-weight table matches ours exactly per-cert (CCAO-F 60q/$99, CCDV-F 53q/$125, CCAR-F 60q/$125, CCAR-P 63q/$175).
- License: **MIT**.
- Freshness: pushed 2026-09-06 — updated yesterday relative to today.
- Red flags: none found. Only 19 stars despite quality/recency — likely just new/undiscovered, not a quality signal here.
- **Use for:** flashcard-style atomic facts (domain weights, policy numbers), cross-cert comparison context, mock-exam structure ideas.

### Tier 2 — solid, narrower, worth a skim

**3. [ankitrahejagatech/claude-certified-architect-prep](https://github.com/ankitrahejagatech/claude-certified-architect-prep)**
- Format: single-page interactive HTML exam + 5 domain cheat sheets + `sample-questions.md`.
- Quality: Very exam-focused, terse "symptom → root cause → fix" tables (esp. good for CI/CD, see below). Domain breakdowns read like they were built by someone who actually sat the exam.
- License: none declared.
- Freshness: pushed 2026-06-23.
- Red flag: `sample-questions.md` claims all 12 questions are "reproduced verbatim from the Claude Certified Architect – Foundations Certification Exam Guide (**Version 0.1, Feb 10 2025**)." That version/date **does not match** our confirmed "Exam Guide v1.0, effective July 2026" and predates the exam's public March 2026 launch by over a year — likely either a leaked partner-beta draft, a misremembered date, or a fabricated citation. Content itself is plausible and well-reasoned, but don't take the "verbatim/official" claim at face value.
- **Use for:** the CI/CD failure-pattern table (below), general domain framing.

**4. [avidevelops/claude-architect-exam-prep](https://github.com/avidevelops/claude-architect-exam-prep)** — 33 Q&A, CC BY 4.0
- Format: single README with 33 detailed Q&A (each with full per-distractor reasoning) + a community-contributed `contrib/expanded-counter-explanations.json` that restructures the same content into machine-readable form, itself CC BY 4.0 with clear attribution/provenance metadata.
- Quality: High — genuinely scenario-based (invoice-total reconciliation, Batch API SLA math, schema design for conflicting sources, tool-chaining identifiers), with worked math for SLA scheduling questions.
- License: **CC BY 4.0** — the most permissively-licensed original content found (attribution required, reuse for any purpose including questions "informed by" it is clean).
- Freshness: pushed 2026-06-19.
- Red flag: 576 GitHub stars on a 4-file repo is disproportionate — can't confirm organic vs. inflated, but the content quality doesn't depend on the star count either way.

**5. [daronyondem/claude-architect-exam-guide](https://github.com/daronyondem/claude-architect-exam-guide)** — teaching guide, explicitly *not* a question bank
- Format: single long `exam-preparation-guide.md`, CC BY 4.0, with EPUB/PDF build pipeline.
- Quality: High — real API depth (tool_choice semantics, structured outputs vs. tool use, prefill deprecation on current-gen models, token cost of tool schemas). States up front: "This guide avoids exam-question content... original teaching examples."
- License: **CC BY 4.0**.
- Freshness: pushed 2026-06-10.
- Red flag: **contradicts our verified blueprint** — its exam-format table lists "Scenarios: 4 out of **8** possible" and enumerates *eight* scenarios, including a "Scenario 7: Conversational AI Architecture Patterns" and a "Scenario 8: Agentic AI Tools" explicitly marked *"content missing — help us fill it in"*. This is the exact debunked "themes 7/8" claim our own [[cca-exam-blueprint]] memory already flags as having no official backing. Good content otherwise, but shows how the wrong scenario-count rumor propagated into an otherwise credible repo. 1,099 stars (high; likely genuine organic reach given author appears to be a known MS-ecosystem practitioner, but unverified).

**6. [timothywarner-org/claude-architect](https://github.com/timothywarner-org/claude-architect)** — study materials + a full custom app
- Format: MIT-licensed; includes `cca-cert-buddy/`, a TypeScript app with its own MCP server, an LLM-based question-generation agent (`server/agent/generate.ts`, `subagent-validator.ts`), and a seed `question-bank.json`.
- Quality: The seed questions are well-constructed multi-agent-research and CI/CD scenario items (matching our canonical scenario names exactly, e.g. "Multi-agent Research System"). The app's approach — dynamically generating *new* questions via an agent rather than a fixed bank — is an interesting architectural idea, not content to copy.
- License: **MIT**.
- Freshness: pushed 2026-07-14.
- Red flag: none major; note the "conflicting sources: 40% vs 12% growth stat" and "creative-industries decomposition misses music/writing/film" scenarios in its bank are **near-verbatim identical** to examples independently appearing in `hamzafarooq/claude-certified-architect`'s question set (see convergence note below).

**7. [OlivierAlter/Claude-Certified-Architect-Foundations-Certification-Exam](https://github.com/OlivierAlter/Claude-Certified-Architect-Foundations-Certification-Exam)** — 77 questions + Claude Code skill
- Format: single markdown file mapping all 77 questions to the 30 official task statements (e.g. "1.5 Agent SDK hooks for tool call interception → Q23–25"), plus a `cert-exam.skill` for interactive practice inside Claude Code.
- Quality: The domain→task→question index is the most rigorously mapped-to-the-blueprint structure of anything found; useful as a checklist of *which task statements* a study bank should cover, independent of its actual question text.
- License: none declared.
- Freshness: pushed 2026-03-15 (created and last touched same day — a one-shot drop, not iterated on since).
- Red flag: none beyond age/staleness (created within days of the exam's March 2026 launch, so it reflects the earliest post-launch understanding, not any subsequent corrections).

**8. [hamzafarooq/claude-certified-architect](https://github.com/hamzafarooq/claude-certified-architect)**
- Nearly identical structure to `ankitrahejagatech` (same `cheat-sheet/domain{1-5}.md` + `sample-questions.md` + `practice-exam.html` layout) and its multi-agent-research/CI-CD questions overlap heavily with `timothywarner-org`'s bank (see convergence note). MIT license. Pushed 2026-06-03. Not bad, just redundant with #3 and #6 above — read one of the three, not all.

### Tier 3 — thin, skip unless desperate

- **Neerajkr7/cca-foundations-exam-practice** — 200-question React PWA, MIT, pushed 2026-07-30 (most recently active of the small repos). Real weakness: `src/data.js`'s `DOMAINS` array mixes our confirmed 5 Foundations domains (27/20/20/18/15) with extra domains ("Solution Design & Architecture" 17%, "Models, Prompting & Context Engineering" 13%, "Integration") that don't belong to Foundations — looks like Professional-tier or another cert's domains got merged in by mistake. Verify any specific fact before reuse; the app shell/UX pattern (bookmarks, missed-question log, streak tracker) is worth borrowing as a *feature* idea for our own mock-exam generator.
- **paullarionov/claude-certified-architect** — huge repo (91 MB) that looks impressive at 4,748 stars but is actually a **single study-guide manuscript machine-translated into 15 languages** plus auto-generated Anki/EPUB/PDF builds — not an original or expanded question bank. No LICENSE file (all-rights-reserved by default). It also repeats the **debunked "4 of 8 scenarios"** claim (lists Scenario 7 "Conversational AI Architecture Patterns" and an admittedly-incomplete Scenario 8), same error as `daronyondem`. Given no license and a factual error, treat as low-priority.
- **carolinacherry/claude-certified-architect** — a thin Claude Code plugin wrapper (`.claude-plugin/marketplace.json` + one command file), MIT. No real content of its own beyond a slash command; not worth reading for content.
- **hegdesumanth/claude-certified-architect-guide**, **GovindaPaliwal/Anthropic-Claude-Certified-Architect-Guide** — tiny (13–21 KB) single-file guides, essentially README-only, low depth, safe to skip.

### Paid / SEO sites — treat with active suspicion

- **claudecertified.io, claudecertificationguide.com, claudearchitectcertification.com, ccaf-exam.guide** (previously flagged as low-quality): confirmed still problematic on re-check.
  - `claudearchitectcertification.com` states the exam has a **"13-scenario pool"** — directly contradicts the confirmed **6-scenario** pool (our own blueprint memory + multiple independent GitHub sources agree on 6). Concrete, checkable hallucination.
  - `claudecertificationguide.com` advertises "7 domains" for the Professional tier (CCAR-P) while other sources describe 5 domains for Foundations — plausibly a different exam tier, but the site conflates tiers enough that it reads as confused/unreliable rather than merely different.
  - `claudecertified.io` claims **1,374 practice questions** with no visible authorship, sourcing, or licensing — classic volume-over-quality content-farm signal.
- **dumpsbase.com, exams4sure.com, certsafari.com, skillcertpro.com, neodumps.com** — paid "exam dumps" sites (152–720 "questions" depending on vendor). Spot-checked `dumpsbase`'s free demo: its sample questions (e.g. "Test files are spread throughout the codebase... how do you ensure Claude automatically applies correct testing conventions") are **near-identical in framing to questions already documented for free** in `ankitrahejagatech`'s "official sample questions" and other community repos — strong indication these paid sites are repackaging freely-available community/leaked-guide content and reselling it, sometimes without attribution. No independent value; skip entirely.
- **claudecertifiedarchitects.com** — notably, this one (not on the originally-flagged list) checked out accurately against our confirmed blueprint on every verifiable fact (CCAR-F code, v1.0/July 2026, 60q/120min, 720/1000, 4-of-6 scenarios, $125, 12-month validity, and an oddly specific but plausible retake-cooldown policy: 14/30/90 days, max 4 attempts/12 months). Still a paid-product site with a "not affiliated with Anthropic" disclaimer and no visible sample content or license — can't vouch for its paid question bank, but its free blueprint page is at least not hallucinated.
- **rare-books.library.sites.carleton.edu/asessment/...** — a university library subdomain hosting exam-dump SEO content ("Actual! CCAR-F Exam Questions [2026] Elegantly Achieve Success"). This is very likely a **compromised/hacked CMS page** being used to host SEO spam (the URL path and title phrasing are typical of link-farm injection attacks on university sites) — do not treat as a real source, and flag defensively rather than visit further.

### Official Anthropic material

No official Anthropic-published sample-question PDF or repo was found via search. The only "official" artifacts referenced anywhere are (a) the Exam Guide itself (task statements + domain weights, which we already have verified) and (b) the free Anthropic Academy / Claude Academy courses, which multiple community repos (esp. Amey-Thakur's, with verifiable badge links) confirm are the actual source material the exam draws from. Treat any "verbatim official sample questions" claim (see `ankitrahejagatech` above) as unverified.

### Reddit / Discord / Hugging Face / GitLab

No substantive Reddit threads, Discord/forum archives, or GitLab repos were found. Hugging Face has no CCA-related dataset — only unrelated Claude-Code-usage-trace datasets. Medium/dev.to have several first-person "I passed" narrative posts (e.g. Ihor Sasovets, Balaji Ashok Kumar, the dev.to "5 Domains, 6 Scenarios" post) that corroborate the confirmed blueprint numbers but add no question content; one Medium post with promising "real code" framing (Sathish Raju) was inaccessible (403). Not worth further chasing.

---

## Topic Intelligence: What a Good Study Bank Should Cover

Synthesized from the Tier 1/2 sources above — these are *topics/patterns*, not questions to copy:

**Domain 1 — Agentic Architecture (27%)**
- Full `stop_reason` handling, including newer values (`pause_turn`, `model_context_window_exceeded`, `refusal` + `stop_details.category`), and that a refusal is HTTP 200 (code that reads `content` without checking `stop_reason` silently mishandles it).
- The Agent tool (renamed from Task — exam wording may still say "Task"); subagents have **isolated context**, nothing inherits automatically.
- Decomposition-too-narrow failure pattern (the "creative industries → only visual arts" example recurs across multiple independent sources — a strong signal this class of question is real/likely).
- Coordinator-as-central-hub vs. peer-to-peer subagent communication; when to route errors up vs. handle locally (handle at the lowest level capable of resolving them, escalate with attempted-steps + partial results otherwise).
- Full hook lifecycle (`SessionStart` → `UserPromptSubmit` → `PreToolUse`/`PermissionRequest`/`PostToolUse` → `SubagentStart/Stop` → `Stop` → `PreCompact/PostCompact` → `SessionEnd`), and the new `mcp_tool` hook type.
- Hooks (deterministic) vs. prompts (probabilistic) as the single most-repeated exam framing across sources — "when a single failure causes financial/security/compliance harm, use hooks, regardless of prompt quality."

**Domain 2 — Tool Design & MCP (18%)**
- Tool *descriptions* are the primary routing signal; two similarly-named/described tools cause systematic misrouting (recurs verbatim across 3+ independent repos — `analyze_content` vs `analyze_document` example).
- `tool_choice`: `auto` vs `any` vs named-tool vs `none`, and why `auto` doesn't guarantee tool use.
- Structured error responses (`isError: true` vs `false` for zero-results-is-not-an-error cases).
- Scoped tool access per subagent (4–5 tools, not the full toolset) — recurring "don't give every agent every tool" theme.
- `.mcp.json` (project) vs `~/.claude.json` (personal).

**Domain 3 — Claude Code Config & Workflows (20%) — CI/CD is confirmed as thin in our own material and heavily tested elsewhere**
- The `-p`/`--print` flag as "the single most-tested CI detail" — omitting it hangs the job waiting for input. This exact framing appears independently in at least 3 sources.
- `--output-format json` / `--json-schema` for structured, machine-parseable output so findings can become inline PR comments (file/line/severity/fix) instead of narrative prose requiring manual copy-paste.
- Preventing duplicate PR comments across re-runs (give the model prior findings + "report only new/unaddressed issues").
- Avoiding low-value/duplicate generated tests (give it the existing test files as context).
- Using an **independent review session/instance** rather than reviewing with the same session that wrote the code (session retains its own reasoning and is less likely to self-critique).
- The full non-interactive flag surface: `--max-turns`, `--max-budget-usd`, `--bare`, `--no-session-persistence`, `--fallback-model`, `--permission-mode`, `--permission-prompt-tool` (delegate approvals to an MCP tool headlessly), `--setting-sources`, `--agent`/`--agents` for CI-specific subagent personas.
- Managed integrations beyond hand-rolled CLI calls: GitHub Actions (`claude-code-action`), GitLab CI/CD, "GitHub Code Review" (zero-workflow-file automatic review), Routines (cloud-scheduled, event- or API-triggered).
- Choosing sync review (pre-merge, blocking) vs. Batch API (overnight/deep analysis, 50% cheaper, up to 24h, no multi-turn, results keyed by `custom_id` not order).
- CLAUDE.md hierarchy/scoping, path-specific rule files under `.claude/rules/` with glob-pattern YAML frontmatter (vs. relying on a monolithic CLAUDE.md or skills for automatic, path-based application), project- vs. user-level command/config placement, plan mode triggers (large/ambiguous/multi-file architectural changes).

**Domain 4 — Prompt Engineering & Structured Output (20%)**
- `tool_use`/schema constraints eliminate *syntax* errors but not *semantic* ones (e.g., line items not summing to a stated total) — pattern: extract both a stated and a calculated value, flag mismatches for human review rather than silently "fixing" data.
- Structured outputs (`output_config.format` + JSON Schema) vs. tool use for structured output — when to use which, and that legacy prefill is rejected outright on current-gen models when it's the final message.
- Few-shot for genuinely ambiguous/borderline cases, not obvious ones (recurring distractor: "just add more few-shot examples" is wrong when the real problem is a missing deterministic check or an under-specified tool description).
- Batch API cost/latency math (50% savings, up to 24h, SLA-interval-plus-processing-time worst-case scheduling problems), and refining prompts on a representative sample *before* scaling to full batch volume.
- Escalation calibration: explicit criteria + few-shot beats self-reported confidence (poorly calibrated) or sentiment analysis (sentiment ≠ complexity) or a separately-trained classifier (over-engineered first response).

**Domain 5 — Context Management & Reliability (15%) — confirmed thin in our own material, several good angles found**
- Current context-window sizes and their traps: 1M-token windows are "not free" (cost scales, lost-in-the-middle gets *worse* with length), and the ~30% tokenizer shift starting at Opus 4.7 means budgets/thresholds must be re-baselined with `messages.count_tokens`, not `tiktoken` or a stale prior calibration.
- **Case Facts Block** pattern: pull exact transactional values (IDs, dates, dollar amounts) into a structured, non-summarized block that survives `/compact`, since progressive summarization is exactly where "$149.99" silently becomes "about $150."
- **Lost-in-the-middle**: mitigate by front-loading key findings, using explicit section headers, bookending important content — recurs identically across independent sources as a "where in the input should critical info go" question type.
- Conflicting-sources handling: annotate both values with source attribution and defer reconciliation to the coordinator/human — never silently pick one via a heuristic (the "40% government report vs. 12% industry analysis" scenario recurs near-verbatim across 3 independent repos, suggesting it may echo something close to a real exam item or a very well-converged synthetic one).
- Subagent output schema / synthesis design: when a synthesis step needs to verify claims mid-flight, batching "simple fact-check" verifications locally vs. round-tripping every one through the coordinator (round-trip overhead vs. reliability trade-off) — this is the closest any source gets to "citation metadata / structured vs. prose for downstream synthesis," and it's thin everywhere, including in our own material. Treat as a genuine gap worth originating our own questions around: how a subagent should structure its output (e.g., tagged claims with source + confidence) so a downstream synthesis/coordinator agent can programmatically reconcile rather than re-reading prose.
- Multi-agent error propagation: partial success across sources (some tool calls return results, others time out or return zero) — structure the failure report so the coordinator can tell "no results because none exist" apart from "no results because it errored," and decide retry/skip/degrade per-source rather than failing the whole task.

---

## Notable Cross-Repo Convergence (useful signal, also a caution)

Several *independently created* repos (`avidevelops`, `timothywarner-org`, `hamzafarooq`, `dnacenta`'s prose) converge on nearly identical illustrative scenarios: the 40%-vs-12%-growth conflicting-statistics example, the "creative industries decomposed into only visual arts" example, the PDF-parsing-failure (corrupted/password-protected/timeout) example, and the `analyze_content`/`analyze_document` tool-naming-collision example. This is either evidence these are close to real leaked/remembered exam items, or (more likely) evidence that independent LLM-assisted authors converge on the same "canonical" illustrative failure modes for these well-known architectural anti-patterns. Either way: **these specific scenarios are now too widely circulated to originate questions around without risk of looking derivative** — good as topic markers ("test conflicting-source reconciliation," "test decomposition coverage gaps"), bad as templates to lightly reskin.

## Licensing Summary (for our own question-writing hygiene)

| Repo | License | Safe to read for topics? | Safe to reuse text? |
|---|---|---|---|
| dnacenta/claude-certified-architect | none declared | Yes | No |
| Amey-Thakur/CLAUDE-CERTIFICATIONS | MIT | Yes | Yes (with attribution good practice) |
| ankitrahejagatech/claude-certified-architect-prep | none declared | Yes | No |
| avidevelops/claude-architect-exam-prep | CC BY 4.0 | Yes | Yes, with attribution |
| daronyondem/claude-architect-exam-guide | CC BY 4.0 | Yes (mind the 4-of-8 error) | Yes, with attribution |
| timothywarner-org/claude-architect | MIT | Yes | Yes |
| hamzafarooq/claude-certified-architect | MIT | Yes | Yes |
| OlivierAlter/...Certification-Exam | none declared | Yes (task-mapping structure) | No |
| Neerajkr7/cca-foundations-exam-practice | MIT | Yes (verify facts first) | Yes |
| paullarionov/claude-certified-architect | none declared | Low priority | No |
| Paid dump sites (dumpsbase, exams4sure, etc.) | none / ToS-restricted | Skip | No |

Given we're writing **original** questions, the practical takeaway is: read `dnacenta` and `Amey-Thakur` closely for technical accuracy and coverage gaps (esp. CI/CD flags and context-window tokenizer/case-facts details our own material is thin on), skim the CC BY/MIT repos freely, and treat every paid "dumps" site as noise to ignore rather than verify.
