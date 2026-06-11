#!/usr/bin/env -S uv run --with markdown python
"""Build the docs/ wiki: one navigable HTML page per study doc + index.

Usage:  uv run --with markdown python wiki/build_wiki.py
Re-run whenever docs/*.md change. Output is committed so the wiki is shareable.
"""
from __future__ import annotations

import html
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = ROOT / "wiki"

# (md filename, page title, one-line description) grouped by section, in nav order.
SECTIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    ("Start Here", [
        ("exam-cheat-sheet.md", "Exam Cheat Sheet",
         "Numbers, decision trees, anti-patterns — the last-pass quick reference."),
        ("tips-from-passers.md", "Tips from Passers",
         "Gotchas, time management, and a study plan from people who passed."),
        ("exam-research-2026.md", "Exam Research (2026)",
         "Cited blueprint research: what's confirmed, what's not, what changed."),
    ]),
    ("Domain Guides", [
        ("domain1-agentic-architecture-orchestration.md",
         "Domain 1 · Agentic Architecture & Orchestration (27%)",
         "Agent loops, coordinator/subagent patterns, hooks vs prompts."),
        ("domain2-tool-design-mcp-integration.md",
         "Domain 2 · Tool Design & MCP Integration (18%)",
         "Tool descriptions, resources vs tools, MCP errors, server scoping."),
        ("domain3-claude-code-config-workflows.md",
         "Domain 3 · Claude Code Configuration & Workflows (20%)",
         "CLAUDE.md hierarchy, commands vs skills, hooks, plugins, CI."),
        ("domain4-prompt-engineering-structured-output.md",
         "Domain 4 · Prompt Engineering & Structured Output (20%)",
         "tool_use vs few-shot, tool_choice, extraction schemas, Batch API."),
        ("domain5-context-management-reliability.md",
         "Domain 5 · Context Management & Reliability (15%)",
         "Context-window tactics, graceful degradation, escalation, validation."),
    ]),
    ("Deep Dives", [
        ("mcp-deep-dive.md", "MCP Deep Dive",
         "Protocol primitives, transports, server design, error contracts."),
        ("agent-sdk-deep-dive.md", "Agent SDK Deep Dive",
         "Code patterns: hooks, sessions, subagents, AgentDefinition."),
    ]),
]

CSS = """
:root{--bg:#0f1115;--panel:#171a21;--panel2:#1e222b;--ink:#e7e9ee;--muted:#9aa3b2;
  --line:#2a2f3a;--accent:#cc785c;--accent2:#d4a27f;--good:#46b873;--code:#0c0e12}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.65 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:var(--accent2);text-decoration:none}
a:hover{text-decoration:underline}

/* layout */
.shell{display:flex;min-height:100vh}
.sidebar{width:290px;min-width:290px;background:var(--panel);border-right:1px solid var(--line);
  position:sticky;top:0;height:100vh;overflow-y:auto;padding:18px 0 30px}
.content{flex:1;min-width:0;padding:40px 52px 100px;max-width:880px;margin:0 auto}
@media(max-width:860px){
  .shell{flex-direction:column}
  .sidebar{position:static;width:auto;height:auto;border-right:none;border-bottom:1px solid var(--line)}
  .content{padding:26px 18px 70px}
}

/* sidebar */
.brand{display:block;padding:4px 18px 12px;color:var(--ink)}
.brand b{font-size:15px}
.brand span{display:block;font-size:11.5px;color:var(--muted);letter-spacing:.05em;text-transform:uppercase}
.search{margin:4px 14px 10px}
.search input{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:8px;
  color:var(--ink);padding:7px 11px;font:13.5px Inter,sans-serif;outline:none}
.search input:focus{border-color:var(--accent)}
.nav-section{padding:10px 18px 4px;font-size:11px;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;color:var(--muted)}
.nav-link{display:block;padding:6px 18px;font-size:13.5px;color:var(--muted);
  border-left:3px solid transparent}
.nav-link:hover{color:var(--ink);background:var(--panel2);text-decoration:none}
.nav-link.active{color:var(--accent2);border-left-color:var(--accent);background:var(--panel2)}
.nav-link.hidden{display:none}
.toc{margin:2px 0 6px;border-left:1px solid var(--line);margin-left:21px}
.toc a{display:block;padding:3px 14px;font-size:12.5px;color:var(--muted)}
.toc a:hover{color:var(--ink);text-decoration:none}

/* article */
.crumb{font-size:12.5px;color:var(--muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px}
.crumb a{color:var(--accent2)}
article h1{font-size:32px;line-height:1.15;font-weight:800;letter-spacing:-.02em;margin:6px 0 18px}
article h2{font-size:22px;font-weight:700;margin:36px 0 12px;padding-top:14px;border-top:1px solid var(--line)}
article h3{font-size:17px;font-weight:700;margin:26px 0 8px;color:var(--accent2)}
article h4{font-size:15px;margin:20px 0 6px}
article p{margin:10px 0}
article ul,article ol{padding-left:24px;margin:10px 0}
article li{margin:4px 0}
article blockquote{margin:14px 0;padding:10px 16px;border-left:3px solid var(--accent);
  background:var(--panel);border-radius:0 10px 10px 0;color:var(--muted)}
article blockquote p{margin:4px 0}
article hr{border:none;border-top:1px solid var(--line);margin:28px 0}
article code{background:var(--code);border:1px solid var(--line);border-radius:5px;
  padding:1px 5px;font-size:13.5px;font-family:"SF Mono",Menlo,Monaco,monospace}
article pre{background:var(--code);border:1px solid var(--line);border-radius:12px;
  padding:14px 16px;overflow-x:auto;font-size:13.5px;line-height:1.55}
article pre code{background:none;border:none;padding:0}
article table{border-collapse:collapse;width:100%;margin:16px 0;font-size:14px}
article th{background:var(--panel2);text-align:left;color:var(--accent2)}
article th,article td{border:1px solid var(--line);padding:8px 12px;vertical-align:top}
article tr:nth-child(even) td{background:var(--panel)}
article strong{color:var(--ink)}

/* prev / next */
.pager{display:flex;gap:14px;margin-top:54px}
.pager a{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:14px;
  padding:14px 18px;transition:.15s}
.pager a:hover{border-color:var(--accent);text-decoration:none;transform:translateY(-2px)}
.pager .dir{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}
.pager .t{display:block;color:var(--ink);font-weight:600;font-size:14.5px;margin-top:3px}
.pager .next{text-align:right}
.foot{color:var(--muted);font-size:12.5px;margin-top:40px;border-top:1px solid var(--line);padding-top:14px}

/* index page */
.hero h1{font-size:36px;font-weight:800;letter-spacing:-.02em;margin:8px 0}
.eyebrow{color:var(--accent2);font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-size:13px}
.lede{color:var(--muted);font-size:17px;max-width:640px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:15px;margin-top:14px}
.card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:15px;
  padding:18px;transition:.15s;color:var(--ink)}
.card:hover{border-color:var(--accent);transform:translateY(-2px);text-decoration:none}
.card h3{margin:0 0 6px;font-size:16.5px}
.card p{margin:0;color:var(--muted);font-size:13.5px}
.sect{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:34px 0 4px}
"""

SEARCH_JS = """
const inp=document.getElementById('navfilter');
if(inp){inp.addEventListener('input',()=>{const q=inp.value.toLowerCase();
  document.querySelectorAll('.nav-link').forEach(a=>{
    a.classList.toggle('hidden',q&&!(a.textContent+' '+(a.dataset.kw||'')).toLowerCase().includes(q));});
  document.querySelectorAll('.nav-section').forEach(s=>{
    let el=s.nextElementSibling,vis=false;
    while(el&&!el.classList.contains('nav-section')){
      if(el.classList.contains('nav-link')&&!el.classList.contains('hidden'))vis=true;
      el=el.nextElementSibling;}
    s.style.display=q&&!vis?'none':'';});});}
"""


def slug(md_name: str) -> str:
    return Path(md_name).stem + ".html"


def render_md(path: Path) -> tuple[str, list[dict]]:
    md = markdown.Markdown(extensions=["tables", "fenced_code", "toc", "sane_lists"],
                           extension_configs={"toc": {"toc_depth": "2-2"}})
    body = md.convert(path.read_text(encoding="utf-8"))
    return body, md.toc_tokens


def headings_text(toks: list[dict]) -> str:
    out = []
    for t in toks:
        out.append(t["name"])
        out.extend(headings_text(t.get("children", [])))
    return " ".join(out)


def sidebar(active: str | None, toc: list[dict] | None) -> str:
    parts = ['<aside class="sidebar">',
             '<a class="brand" href="index.html"><b>CCA Foundations Wiki</b>'
             '<span>Claude Certified Architect</span></a>',
             '<div class="search"><input id="navfilter" type="search" '
             'placeholder="Filter pages &amp; topics…"></div>']
    for section, pages in SECTIONS:
        parts.append(f'<div class="nav-section">{html.escape(section)}</div>')
        for md_name, title, _desc in pages:
            href = slug(md_name)
            cls = "nav-link active" if href == active else "nav-link"
            kw = html.escape(PAGE_KEYWORDS.get(md_name, ""), quote=True)
            parts.append(f'<a class="{cls}" href="{href}" data-kw="{kw}">{html.escape(title)}</a>')
            if href == active and toc:
                parts.append('<div class="toc">')
                for t in toc:
                    parts.append(f'<a href="#{t["id"]}">{html.escape(t["name"])}</a>')
                parts.append("</div>")
    parts.append("</aside>")
    return "\n".join(parts)


def shell(title: str, active: str | None, toc: list[dict] | None, inner: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{html.escape(title)} · CCA Foundations Wiki</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
<div class="shell">
{sidebar(active, toc)}
<main class="content">
{inner}
</main>
</div>
<script>{SEARCH_JS}</script>
</body>
</html>
"""


def build() -> None:
    flat = [(md_name, title, desc) for _s, pages in SECTIONS for md_name, title, desc in pages]

    # page keywords for the nav filter = the page's own h2/h3 headings
    global PAGE_KEYWORDS
    PAGE_KEYWORDS = {}
    rendered = {}
    for md_name, title, _ in flat:
        body, toc = render_md(DOCS / md_name)
        rendered[md_name] = (body, toc)
        PAGE_KEYWORDS[md_name] = headings_text(toc)

    for i, (md_name, title, _desc) in enumerate(flat):
        body, toc = rendered[md_name]
        pager = ['<div class="pager">']
        if i > 0:
            p_md, p_title, _ = flat[i - 1]
            pager.append(f'<a href="{slug(p_md)}"><span class="dir">← Previous</span>'
                         f'<span class="t">{html.escape(p_title)}</span></a>')
        if i < len(flat) - 1:
            n_md, n_title, _ = flat[i + 1]
            pager.append(f'<a class="next" href="{slug(n_md)}"><span class="dir">Next →</span>'
                         f'<span class="t">{html.escape(n_title)}</span></a>')
        pager.append("</div>")
        inner = (f'<div class="crumb"><a href="index.html">Wiki</a> / {html.escape(title)}</div>'
                 f"<article>{body}</article>" + "\n".join(pager) +
                 '<p class="foot">Generated from <code>docs/</code> by <code>wiki/build_wiki.py</code> — '
                 'edit the markdown, not this file. Original study material, not real (NDA) exam content.</p>')
        (OUT / slug(md_name)).write_text(shell(title, slug(md_name), toc, inner), encoding="utf-8")

    # index page
    cards = []
    for section, pages in SECTIONS:
        cards.append(f'<div class="sect">{html.escape(section)}</div><div class="grid">')
        for md_name, title, desc in pages:
            cards.append(f'<a class="card" href="{slug(md_name)}">'
                         f"<h3>{html.escape(title)}</h3><p>{html.escape(desc)}</p></a>")
        cards.append("</div>")
    inner = ('<div class="hero"><div class="eyebrow">Anthropic Certification · Study Wiki</div>'
             "<h1>Claude Certified Architect — Foundations</h1>"
             '<p class="lede">Every study doc in this repo, rendered for reading: cheat sheet, '
             "research, domain guides, and deep dives. Use the sidebar filter to jump to a topic, "
             'or pair with the <a href="../learn-docs/index.html">visual study hub</a> and the '
             "timed mock exams.</p></div>" + "\n".join(cards) +
             '<p class="foot">Generated from <code>docs/</code> by <code>wiki/build_wiki.py</code>. '
             "Blueprint is community-confirmed, not Anthropic-published; verify currency before sitting.</p>")
    (OUT / "index.html").write_text(shell("Study Wiki", None, None, inner), encoding="utf-8")
    print(f"✓ Built {len(flat)} pages + index → {OUT}")


PAGE_KEYWORDS: dict[str, str] = {}

if __name__ == "__main__":
    build()
