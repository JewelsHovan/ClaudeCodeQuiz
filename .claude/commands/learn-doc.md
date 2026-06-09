Create a beautiful, self-contained HTML learning guide for a study topic — with diagrams, callouts, exam-trap boxes, and self-check questions.

Topic: $ARGUMENTS

## What this produces
A polished standalone `.html` page (dark/light toggle, sticky table of contents, reading-progress bar,
Mermaid diagrams, print-to-PDF) that teaches one topic well. Great for studying *and* for sharing with
teammates. It's built by filling the shared theme in `learn-docs/template.html`, so every guide looks
consistent.

## Steps

1. **Pick the topic from `$ARGUMENTS`.** If empty, ask what to cover, or offer a menu:
   a full domain (e.g. "Domain 1: Agentic Architecture"), or a focused concept (e.g. "MCP error handling",
   "commands vs skills", "tool_choice", "escalation triggers", "context management patterns").

2. **Personalize (optional but encouraged).** Read `profile/learner.md` — if the topic overlaps a weak
   area / low spaced-repetition box / a Mistake-Log root cause, lean the guide into that angle and add a
   callout addressing the specific confusion.

3. **Gather grounded content.** Read the relevant source material so the guide is accurate, not invented:
   - the matching `docs/domainN-*.md`, plus `docs/mcp-deep-dive.md` / `docs/agent-sdk-deep-dive.md` / `docs/exam-cheat-sheet.md` as relevant
   - related questions in `quiz/bank/*.json` (their `explanation` + `distractors` are gold for "exam traps")
   - keep it current (Opus 4.8 era; see `docs/exam-research-2026.md`). Do NOT reproduce real exam questions.

4. **Author the page** by copying `learn-docs/template.html` and filling it in:
   - Replace `{{TITLE}}`, `{{SUBTITLE}}`, `{{DOMAIN}}` (e.g. "Domain 1 · Agentic Architecture"),
     `{{WEIGHT}}` (e.g. "27%" or "—" for a sub-topic), `{{READMINS}}` (estimate).
   - Replace the `<!--CONTENT-->` marker with the body. Wrap each major part in
     `<section id="kebab-id"><h2><span class="n">01</span> Title</h2> … </section>` — the table of
     contents and scroll-spy fill themselves from these.
   - **Use the component classes** (defined in the template — don't invent new CSS):
     - `<div class="callout key|tip|info|trap|note"><div class="h">…label…</div> …</div>` —
       use **`.trap`** for exam traps / common wrong answers, **`.key`** for must-know rules.
     - `<div class="compare"><div class="do"><div class="lab">✅ Do</div>…</div><div class="dont"><div class="lab">❌ Don't</div>…</div></div>`
     - `<div class="grid"><div class="card"><h4>…</h4>…</div>…</div>` for concept cards.
     - `<div class="terms"><div class="row"><div class="k">Term</div><div class="v">Definition</div></div>…</div>` for glossaries.
     - `<details class="selfcheck"><summary>Question?</summary><div class="a">Answer + why.</div></details>` —
       include **3–6 self-check questions** so it doubles as active recall.
     - Tables, `<pre><code>…</code></pre>` for code/config, `.badge easy|med|hard` for difficulty.
   - **Diagrams** — include at least one Mermaid diagram where it clarifies (a decision tree, an
     orchestration flow, a sequence). Put each in:
     ```
     <div class="diagram"><div class="mermaid">
     flowchart TD
       A[Need a deterministic guarantee?] -->|Yes| B[Hook / programmatic gate]
       A -->|No| C[Prompt instruction]
     </div><div class="cap">Caption explaining the diagram.</div></div>
     ```
     Use `flowchart`, `sequenceDiagram`, or `graph LR`. Keep node labels short. Validate the syntax is well-formed.

5. **Recommended section flow** (adapt to the topic): TL;DR / why it matters → core concepts →
   a decision tree or flow diagram → patterns (do/don't) → **exam traps** (the distractors people fall for)
   → a worked scenario tied to one of the 6 exam scenario themes → self-check questions → key takeaways /
   one-line summary table.

6. **Save** to `learn-docs/generated/<topic-slug>.html` (create the dir if needed; it's gitignored so it
   won't clutter the repo). If the user says "sample" or "share", save to `learn-docs/<topic-slug>.html`
   (committed/shareable) instead.

7. **Open it**: `open "<path>"` (Linux: `xdg-open`). Tell the user it's self-contained (one file, just
   open in a browser) — note Mermaid diagrams + fonts load from a CDN, so the *diagrams* need internet on
   first view; everything else works offline.

8. Offer follow-ups: a `/quiz` on the same topic, another guide for a related weak area, or
   "want this committed as a shareable sample?"

## Quality bar
Accurate (grounded in the docs, current to Opus 4.8), genuinely useful for the exam (lead with what's
tested and the traps), and visually clean (use the components, don't wall-of-text). Aim for one screen of
value before the first scroll.
