# Learning Docs

Beautiful, self-contained **HTML study guides** for the Claude Certified Architect — Foundations cert —
diagrams, callouts, exam-trap boxes, and self-check questions. Great for studying *and* for sharing.

## Make one

Run **`/learn-doc <topic>`** in Claude Code. Examples:

```
/learn-doc Domain 1: Agentic Architecture
/learn-doc MCP error handling
/learn-doc commands vs skills
/learn-doc tool_choice
```

Claude reads the matching `docs/` material (and `quiz/bank/` for real exam traps), fills the shared theme
in `template.html`, and writes a standalone page — then opens it. If your `profile/learner.md` shows the
topic is a weak spot, it leans the guide into that confusion.

## What's here
- `template.html` — the reusable themed shell (dark/light, sticky TOC, reading-progress, Mermaid, print-to-PDF).
  Authoring contract + component classes are documented at the top of the file.
- `agentic-orchestration.html` — a **finished sample** (Domain 1) you can open or share right now.
- `generated/` — where `/learn-doc` writes by default (gitignored, so it won't clutter the repo).
  Say "sample" / "share" and it saves to the committed root instead.

## Sharing
Each guide is one self-contained `.html` file — send it and people just open it in a browser.
Diagrams (Mermaid) and fonts load from a CDN, so the **diagrams need internet on first view**; all the
text/layout works offline. Content is original study material, not real (NDA) exam content.
