#!/usr/bin/env python3
"""
Generate a self-contained, timed HTML mock exam for the
Claude Certified Architect — Foundations certification.

Reads the structured question bank in quiz/bank/*.json, samples a
domain-weighted set that mirrors the real exam blueprint, and emits a single
standalone .html file (no external dependencies) with:
  - an in-page countdown timer (auto-submits at 0)
  - one-question-at-a-time navigation + a question palette + flag-for-review
  - questions grouped under their scenario theme (mirrors the real exam)
  - auto-scoring on a 0-1000 scaled estimate against the 720 pass line
  - per-domain breakdown + an honest pass-likelihood estimate
  - full answer review with explanations and distractor rationales
  - "Copy / Download results JSON" so a score can be fed into /save-progress

Usage (via uv):
  uv run python mock-exams/generate_exam.py                 # full 60-Q, 120 min
  uv run python mock-exams/generate_exam.py --count 20      # quick 20-Q drill
  uv run python mock-exams/generate_exam.py --domain 1      # single-domain focus
  uv run python mock-exams/generate_exam.py --seed 7        # reproducible set
  uv run python mock-exams/generate_exam.py -o /tmp/x.html  # custom output path

The blueprint (~60 Q / 120 min / 720-of-1000 / weights 27/18/20/20/15) is confirmed
via the official Exam Guide v1.0. Scaled scoring here is a LINEAR APPROXIMATION of
raw %; the real exam's scaling differs. See docs/exam-research-2026.md.

--adaptive RESULTS.json biases sampling toward weak domains + missed concepts from a
prior result (Exam Center download or a mock result JSON).
"""
from __future__ import annotations
import argparse
import datetime as _dt
import glob
import json
import os
import random
import re
import sys

# Exam blueprint (see docs/exam-research-2026.md) -----------------------------
DOMAIN_WEIGHTS = {1: 27, 2: 18, 3: 20, 4: 20, 5: 15}  # percentages, sum=100
DOMAIN_NAMES = {
    1: "Agentic Architecture & Orchestration",
    2: "Tool Design & MCP Integration",
    3: "Claude Code Configuration & Workflows",
    4: "Prompt Engineering & Structured Output",
    5: "Context Management & Reliability",
}
PASS_SCALED = 720          # out of 1000
SCALE_MAX = 1000
DEFAULT_COUNT = 60
DEFAULT_MINUTES = 120

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK_GLOB = os.path.join(REPO_ROOT, "quiz", "bank", "*.json")


def load_bank() -> list[dict]:
    files = sorted(glob.glob(BANK_GLOB))
    if not files:
        sys.exit(f"No question bank found at {BANK_GLOB}. "
                 "Run the question-bank agents or add quiz/bank/*.json files.")
    questions: list[dict] = []
    for f in files:
        try:
            questions.extend(json.load(open(f, encoding="utf-8")))
        except json.JSONDecodeError as e:
            sys.exit(f"Invalid JSON in {f}: {e}")
    return questions


def load_adaptive(path: str) -> dict:
    """Read a prior results JSON (Exam Center download or a mock result) and derive
    weakness-adaptive sampling inputs: amplified per-domain weights, the set of
    previously-missed question ids, and the tags of missed concepts."""
    try:
        r = json.load(open(path, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"--adaptive: cannot read results JSON {path}: {e}")
    acc = {}
    for d, v in (r.get("perDomain") or {}).items():
        tot = v.get("total", 0)
        acc[int(d)] = (v.get("correct", 0) / tot) if tot else None
    weights = {}
    for d in DOMAIN_WEIGHTS:
        a = acc.get(d)
        deficit = 0.0 if a is None else max(0.0, 0.8 - a)   # below the 80% target
        weights[d] = DOMAIN_WEIGHTS[d] * (1 + deficit * 3)
    missed_ids, weak_tags = set(), set()
    for w in (r.get("wrong") or []):
        if w.get("id"):
            missed_ids.add(w["id"])
        weak_tags.update(w.get("tags") or [])
    return {"weights": weights, "missed_ids": missed_ids, "weak_tags": weak_tags, "acc": acc}


def allocate(count: int, domains: list[int], weights: dict | None = None) -> dict[int, int]:
    """Largest-remainder apportionment of `count` across `domains` by weight."""
    src = weights or DOMAIN_WEIGHTS
    weights = {d: src[d] for d in domains}
    tot = sum(weights.values())
    raw = {d: count * w / tot for d, w in weights.items()}
    alloc = {d: int(v) for d, v in raw.items()}
    rem = count - sum(alloc.values())
    # hand out leftover seats to the largest fractional remainders
    for d in sorted(domains, key=lambda d: raw[d] - alloc[d], reverse=True)[:rem]:
        alloc[d] += 1
    return alloc


def _stem_tokens(s: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", s.lower()))


def _near_duplicate(q: dict, chosen: list[dict], thr: float = 0.6) -> bool:
    """True if q's stem overlaps an already-chosen stem above the Jaccard threshold."""
    tq = _stem_tokens(q["stem"])
    if not tq:
        return False
    for c in chosen:
        tc = _stem_tokens(c["stem"])
        if tc and len(tq & tc) / len(tq | tc) >= thr:
            return True
    return False


def _take(pool: list[dict], n: int, chosen: list[dict]) -> list[dict]:
    """Greedily take up to n from pool, skipping near-duplicates of `chosen` + already taken.
    Sampling is already without-replacement (unique ids); this also blocks semantic twins.
    If skipping would leave us short, relax and backfill from the skipped items."""
    out: list[dict] = []
    skipped: list[dict] = []
    for q in pool:
        if len(out) >= n:
            break
        if _near_duplicate(q, chosen + out):
            skipped.append(q)
        else:
            out.append(q)
    i = 0
    while len(out) < n and i < len(skipped):
        out.append(skipped[i])
        i += 1
    return out


def _order(pool: list[dict], rng: random.Random, adaptive: dict | None) -> list[dict]:
    """Shuffle a domain pool; when adaptive, float previously-missed questions and
    weak-tag concepts to the front (stable sort preserves the shuffle as a tiebreak)."""
    rng.shuffle(pool)
    if adaptive:
        def pri(q):
            s = 3 if q["id"] in adaptive["missed_ids"] else 0
            s += sum(1 for t in q.get("tags", []) if t in adaptive["weak_tags"])
            return s
        pool.sort(key=pri, reverse=True)
    return pool


def sample(questions: list[dict], count: int, domain: int | None,
           rng: random.Random, adaptive: dict | None = None) -> list[dict]:
    by_dom: dict[int, list[dict]] = {}
    for q in questions:
        by_dom.setdefault(q["domain"], []).append(q)

    if domain is not None:
        pool = by_dom.get(domain, [])
        if not pool:
            sys.exit(f"No questions for domain {domain}.")
        return _take(_order(pool, rng, adaptive), count, [])

    domains = sorted(by_dom)
    alloc = allocate(count, domains, adaptive["weights"] if adaptive else None)
    picked: list[dict] = []
    shortfall = 0
    for d in domains:
        pool = _order(by_dom[d][:], rng, adaptive)
        take = alloc[d]
        chosen = _take(pool, take, picked)        # skip semantic twins across the whole exam
        picked.extend(chosen)
        shortfall += max(0, take - len(chosen))
    # backfill if any domain was short on questions
    if shortfall:
        chosen_ids = {q["id"] for q in picked}
        leftovers = [q for q in questions if q["id"] not in chosen_ids]
        rng.shuffle(leftovers)
        picked.extend(_take(leftovers, shortfall, picked))

    # Group by scenario theme (mirrors the real exam's scenario structure),
    # but keep the group order shuffled so two attempts differ.
    groups: dict[str, list[dict]] = {}
    for q in picked:
        groups.setdefault(q.get("scenario") or "General (no scenario)", []).append(q)
    group_names = list(groups)
    rng.shuffle(group_names)
    ordered: list[dict] = []
    for name in group_names:
        qs = groups[name]
        rng.shuffle(qs)
        ordered.extend(qs)
    return ordered


def _shuffle_options(q: dict, rng: random.Random) -> tuple[dict, "str | list[str]", dict]:
    """Randomize option order and remap the answer key + distractor rationales.

    Neutralizes any answer-position bias in the authored bank (the correct letter
    lands anywhere with equal probability). Handles both single-select (`answer`
    is a letter) and multiple-response (`answer` is a list of letters)."""
    letters = ["A", "B", "C", "D"]
    items = [(L, q["options"][L]) for L in letters if L in q["options"]]
    rng.shuffle(items)
    new_options: dict[str, str] = {}
    remap: dict[str, str] = {}  # old letter -> new letter
    for i, (old_letter, text) in enumerate(items):
        new_letter = letters[i]
        new_options[new_letter] = text
        remap[old_letter] = new_letter
    ans = q["answer"]
    if isinstance(ans, list):
        new_answer: "str | list[str]" = sorted(remap[a] for a in ans)
    else:
        new_answer = remap[ans]
    new_distractors = {remap[k]: v for k, v in q.get("distractors", {}).items() if k in remap}
    return new_options, new_answer, new_distractors


def build_client_questions(picked: list[dict], rng: random.Random) -> list[dict]:
    """Strip to what the browser needs (answer included — it's a local file)."""
    out = []
    for i, q in enumerate(picked):
        options, answer, distractors = _shuffle_options(q, rng)
        multi = isinstance(answer, list)
        out.append({
            "n": i + 1,
            "id": q["id"],
            "domain": q["domain"],
            "domainName": q.get("domain_name", DOMAIN_NAMES.get(q["domain"], "")),
            "scenario": q.get("scenario") or "General",
            "difficulty": q.get("difficulty", "medium"),
            "stem": q["stem"],
            "options": options,
            "answer": answer,
            "selectCount": len(answer) if multi else 1,
            "explanation": q.get("explanation", ""),
            "distractors": distractors,
            "tags": q.get("tags", []),
        })
    return out


def render_html(picked: list[dict], minutes: int, title_suffix: str, rng: random.Random) -> str:
    qjson = json.dumps(build_client_questions(picked, rng), ensure_ascii=False)
    meta = {
        "count": len(picked),
        "minutes": minutes,
        "passScaled": PASS_SCALED,
        "scaleMax": SCALE_MAX,
        "weights": DOMAIN_WEIGHTS,
        "domainNames": DOMAIN_NAMES,
        "generated": _dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "titleSuffix": title_suffix,
    }
    metajson = json.dumps(meta, ensure_ascii=False)
    return _TEMPLATE.replace("/*__META__*/", metajson).replace("/*__QUESTIONS__*/", qjson)


# --- HTML/CSS/JS template; data injected at the two markers -------------------
_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Claude Certified Architect — Foundations · Mock Exam</title>
<style>
  :root{
    --bg:#0f1115; --panel:#171a21; --panel2:#1e222b; --ink:#e7e9ee; --muted:#9aa3b2;
    --line:#2a2f3a; --accent:#cc785c; --accent2:#d4a27f; --good:#46b873;
    --bad:#e2606b; --warn:#e0b341; --pick:#2d3340;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  a{color:var(--accent2)}
  .wrap{max-width:920px;margin:0 auto;padding:24px 18px 80px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px;margin:14px 0}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:17px;margin:0 0 10px}
  .muted{color:var(--muted)} .small{font-size:13px}
  .badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--line);background:var(--panel2);color:var(--muted)}
  .badge.dom{color:var(--accent2);border-color:#3a2f2a}
  .badge.easy{color:#7bd88f}.badge.medium{color:var(--warn)}.badge.hard{color:var(--bad)}
  .badge.multi{color:var(--accent);border-color:var(--accent)}
  .opt.multi .L{border-radius:4px;border:1px solid var(--line);padding:0 5px}
  .opt.multi.sel .L{background:var(--accent);color:#000;border-color:var(--accent)}
  button{font:inherit;cursor:pointer;border-radius:10px;border:1px solid var(--line);
    background:var(--panel2);color:var(--ink);padding:9px 16px}
  button:hover{border-color:var(--accent)}
  button.primary{background:var(--accent);border-color:var(--accent);color:#1a1206;font-weight:600}
  button.primary:hover{filter:brightness(1.06)}
  button:disabled{opacity:.4;cursor:not-allowed}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .spread{justify-content:space-between}
  /* sticky bar */
  #bar{position:sticky;top:0;z-index:5;background:rgba(15,17,21,.92);backdrop-filter:blur(6px);
    border-bottom:1px solid var(--line);padding:10px 18px;display:none}
  #bar .inner{max-width:920px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:12px}
  #timer{font-variant-numeric:tabular-nums;font-weight:700;font-size:18px}
  #timer.warn{color:var(--warn)} #timer.crit{color:var(--bad)}
  .scenario{margin:6px 0 14px;padding:10px 14px;border-left:3px solid var(--accent);
    background:var(--panel2);border-radius:0 10px 10px 0}
  .opt{display:block;width:100%;text-align:left;margin:8px 0;padding:12px 14px;border-radius:10px;
    border:1px solid var(--line);background:var(--panel2)}
  .opt:hover{border-color:var(--accent2)}
  .opt.sel{border-color:var(--accent);background:var(--pick)}
  .opt .L{font-weight:700;color:var(--accent2);margin-right:8px}
  .opt.correct{border-color:var(--good);background:#13261b}
  .opt.wrong{border-color:var(--bad);background:#2a1518}
  .palette{display:grid;grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:7px}
  .pal{padding:8px 0;text-align:center;border-radius:8px;border:1px solid var(--line);background:var(--panel2);font-size:13px}
  .pal.answered{border-color:var(--accent2);color:var(--accent2)}
  .pal.flagged{box-shadow:inset 0 0 0 2px var(--warn)}
  .pal.cur{outline:2px solid var(--ink)}
  .barmeter{height:10px;background:var(--panel2);border-radius:999px;overflow:hidden;border:1px solid var(--line)}
  .barmeter > i{display:block;height:100%;background:var(--accent)}
  table{width:100%;border-collapse:collapse} td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left}
  .pill{font-size:30px;font-weight:800} .pass{color:var(--good)} .fail{color:var(--bad)}
  .rev{border-top:1px dashed var(--line);margin-top:14px;padding-top:12px}
  .hide{display:none}
  code{background:#0c0e12;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:13px}
  .note{font-size:13px;color:var(--muted);margin-top:6px}
</style>
</head>
<body>
<div id="bar"><div class="inner">
  <div class="row"><strong>CCA Mock</strong><span class="muted small" id="barprog"></span></div>
  <div class="row"><span id="timer">--:--</span>
    <button id="btnSubmit" class="primary">Submit exam</button></div>
</div></div>

<div class="wrap">
  <!-- START -->
  <div id="start" class="card">
    <h1>Claude Certified Architect — Foundations</h1>
    <div class="muted" id="startSuffix"></div>
    <p>This is a <strong>timed mock exam</strong>. Once you start, the clock runs and
    auto-submits at zero. Answers and explanations are hidden until you submit.</p>
    <table>
      <tr><td>Questions</td><td id="sCount"></td></tr>
      <tr><td>Time limit</td><td id="sTime"></td></tr>
      <tr><td>Pass mark</td><td id="sPass"></td></tr>
      <tr><td>Format</td><td>Multiple choice + scenario-based multiple-response (a "Select N" badge marks multi-answer items), grouped by scenario</td></tr>
    </table>
    <p class="note">Scaled scoring shown is a <strong>linear approximation</strong> of raw %
      (real exam scaling differs). Blueprint is confirmed via the official Exam Guide v1.0 —
      see <code>docs/exam-research-2026.md</code>.</p>
    <div class="row"><button class="primary" id="btnStart">Start exam</button>
      <label class="row small muted"><input type="checkbox" id="optReveal"/> reveal answer after each question (practice mode, untimed feel)</label></div>
  </div>

  <!-- EXAM -->
  <div id="exam" class="hide">
    <div class="card">
      <div id="scenarioBox" class="scenario hide"></div>
      <div class="row spread small muted">
        <span id="qmeta"></span><span id="qid" class="muted"></span>
      </div>
      <h2 id="stem"></h2>
      <div id="opts"></div>
      <div class="row spread" style="margin-top:14px">
        <button id="btnPrev">← Prev</button>
        <button id="btnFlag">⚑ Flag for review</button>
        <button id="btnNext" class="primary">Next →</button>
      </div>
      <div id="inlineReveal" class="rev hide"></div>
    </div>
    <div class="card">
      <div class="row spread"><strong>Question navigator</strong>
        <span class="small muted">answered <span id="answeredN">0</span>/<span id="totalN">0</span> · flagged <span id="flaggedN">0</span></span></div>
      <div class="palette" id="palette" style="margin-top:10px"></div>
    </div>
  </div>

  <!-- RESULTS -->
  <div id="results" class="hide"></div>
</div>

<script>
const META = /*__META__*/;
const QUESTIONS = /*__QUESTIONS__*/;
const $ = s => document.querySelector(s);
const fmt = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

let cur = 0, reveal = false, submitted = false;
let remaining = META.minutes*60, timerId = null, startedAt = null;
const isMulti = q => Array.isArray(q.answer);
const state = QUESTIONS.map(q=>({pick: isMulti(q)?[]:null, flag:false}));
const answered = (q,s) => isMulti(q) ? (Array.isArray(s.pick)&&s.pick.length>0) : s.pick!=null;
function isCorrect(q,s){
  if(isMulti(q)){
    if(!Array.isArray(s.pick)) return false;
    return [...q.answer].sort().join('|') === [...s.pick].sort().join('|');
  }
  return s.pick===q.answer;
}
const selected = (q,s,L) => isMulti(q) ? (Array.isArray(s.pick)&&s.pick.includes(L)) : s.pick===L;
const fmtAns = q => isMulti(q) ? q.answer.join(', ') : q.answer;
const fmtPick = (q,s) => isMulti(q) ? (Array.isArray(s.pick)?[...s.pick].sort().join(', '):'') : (s.pick||'');
function togglePick(q,s,L){
  if(isMulti(q)){ const i=s.pick.indexOf(L); if(i>=0) s.pick.splice(i,1); else s.pick.push(L); }
  else { s.pick=L; }
}

// --- start screen ---
$('#startSuffix').textContent = META.titleSuffix || '';
$('#sCount').textContent = META.count + ' questions';
$('#sTime').textContent = META.minutes + ' minutes (~' + (META.minutes*60/META.count).toFixed(0) + 's/question)';
$('#sPass').textContent = META.passScaled + ' / ' + META.scaleMax + ' (scaled)';
$('#totalN').textContent = META.count;

$('#btnStart').onclick = () => {
  reveal = $('#optReveal').checked;
  startedAt = new Date();
  $('#start').classList.add('hide');
  $('#exam').classList.remove('hide');
  $('#bar').style.display = 'block';
  buildPalette(); render(); tick(); timerId = setInterval(tick, 1000);
};

function tick(){
  $('#timer').textContent = fmt(remaining);
  const t = $('#timer');
  t.classList.toggle('warn', remaining<=600 && remaining>120);
  t.classList.toggle('crit', remaining<=120);
  if(remaining<=0){ clearInterval(timerId); doSubmit(true); return; }
  remaining--;
}

function buildPalette(){
  const p = $('#palette'); p.innerHTML='';
  QUESTIONS.forEach((q,i)=>{
    const b=document.createElement('div'); b.className='pal'; b.textContent=i+1;
    b.onclick=()=>{cur=i;render();}; p.appendChild(b);
  });
}
function refreshPalette(){
  [...$('#palette').children].forEach((b,i)=>{
    b.classList.toggle('answered', answered(QUESTIONS[i],state[i]));
    b.classList.toggle('flagged', state[i].flag);
    b.classList.toggle('cur', i===cur);
  });
  const nAns = state.filter((s,i)=>answered(QUESTIONS[i],s)).length;
  $('#answeredN').textContent = nAns;
  $('#flaggedN').textContent = state.filter(s=>s.flag).length;
  $('#barprog').textContent = `Q${cur+1} of ${META.count} · answered ${nAns}`;
}

function render(){
  const q=QUESTIONS[cur], s=state[cur];
  const prev = cur>0 ? QUESTIONS[cur-1].scenario : null;
  const sb=$('#scenarioBox');
  if(q.scenario && q.scenario!=='General'){
    sb.classList.remove('hide');
    sb.innerHTML = `<strong>Scenario:</strong> ${q.scenario}`;
  } else sb.classList.add('hide');
  const multi = isMulti(q);
  $('#qmeta').innerHTML = `<span class="badge dom">D${q.domain} · ${q.domainName}</span> `+
    `<span class="badge ${q.difficulty}">${q.difficulty}</span>`+
    (multi ? ` <span class="badge multi">Select ${q.selectCount}</span>` : '');
  $('#qid').textContent = q.id;
  $('#stem').textContent = q.stem;
  const o=$('#opts'); o.innerHTML='';
  const letters = Object.keys(q.options);
  for(const L of letters){
    const btn=document.createElement('button');
    btn.className='opt'+(selected(q,s,L)?' sel':'')+(multi?' multi':'');
    btn.innerHTML = `<span class="L">${L}</span>${q.options[L]}`;
    btn.onclick=()=>{ if(submitted) return; togglePick(q,s,L); render();
      if(reveal) showInlineReveal(); };
    if(reveal && answered(q,s)){
      const correctL = multi ? q.answer.includes(L) : L===q.answer;
      if(correctL) btn.classList.add('correct');
      else if(selected(q,s,L)) btn.classList.add('wrong');
    }
    o.appendChild(btn);
  }
  $('#btnFlag').textContent = s.flag ? '⚑ Unflag' : '⚑ Flag for review';
  $('#btnPrev').disabled = cur===0;
  $('#btnNext').textContent = cur===META.count-1 ? 'Last →' : 'Next →';
  if(reveal && answered(q,s)) showInlineReveal(); else $('#inlineReveal').classList.add('hide');
  refreshPalette();
}
function showInlineReveal(){
  const q=QUESTIONS[cur], s=state[cur], box=$('#inlineReveal');
  const ok = isCorrect(q,s);
  box.classList.remove('hide');
  box.innerHTML = `<div><strong class="${ok?'pass':'fail'}">${ok?'Correct':'Incorrect'}</strong> — correct answer: <strong>${fmtAns(q)}</strong></div>`+
    `<div class="note">${q.explanation}</div>`;
}

$('#btnPrev').onclick=()=>{ if(cur>0){cur--;render();} };
$('#btnNext').onclick=()=>{ if(cur<META.count-1){cur++;render();} else window.scrollTo(0,document.body.scrollHeight); };
$('#btnFlag').onclick=()=>{ state[cur].flag=!state[cur].flag; render(); };
document.addEventListener('keydown',e=>{
  if(submitted||$('#exam').classList.contains('hide')) return;
  if(['a','b','c','d','A','B','C','D'].includes(e.key)){ togglePick(QUESTIONS[cur],state[cur],e.key.toUpperCase()); render(); if(reveal) showInlineReveal(); }
  else if(e.key==='ArrowRight') $('#btnNext').click();
  else if(e.key==='ArrowLeft') $('#btnPrev').click();
  else if(e.key==='f') $('#btnFlag').click();
});
$('#btnSubmit').onclick=()=>doSubmit(false);

function doSubmit(auto){
  if(submitted) return;
  const unanswered = state.filter((s,i)=>!answered(QUESTIONS[i],s)).length;
  if(!auto && unanswered>0 && !confirm(`${unanswered} question(s) unanswered. Submit anyway?`)) return;
  submitted=true; clearInterval(timerId);
  const elapsed = Math.round((new Date()-startedAt)/1000);
  // score
  let correct=0; const perDom={}; const wrong=[];
  for(const d of Object.keys(META.weights)) perDom[d]={correct:0,total:0};
  QUESTIONS.forEach((q,i)=>{
    perDom[q.domain].total++;
    if(isCorrect(q,state[i])){correct++; perDom[q.domain].correct++;}
    else wrong.push({id:q.id, domain:q.domain, your:fmtPick(q,state[i]), answer:fmtAns(q), tags:q.tags});
  });
  const raw = correct/META.count;
  const scaled = Math.round(raw*META.scaleMax);
  const passed = scaled>=META.passScaled;
  // crude pass-likelihood: logistic on margin vs 72% with sample-size penalty
  const margin = raw - (META.passScaled/META.scaleMax);
  let prob = 1/(1+Math.exp(-margin*100*Math.sqrt(META.count/60)));
  prob = Math.max(0.02, Math.min(0.98, prob));

  const result = {
    type:'cca-mock-result', generated:META.generated, takenAt:new Date().toISOString(),
    count:META.count, correct, scaledEstimate:scaled, passScaled:META.passScaled,
    passed, rawPct:+(raw*100).toFixed(1), passLikelihood:+(prob*100).toFixed(0),
    timeUsedSec:elapsed, timeLimitSec:META.minutes*60,
    perDomain:Object.fromEntries(Object.entries(perDom).map(([d,v])=>[d,{...v,name:META.domainNames[d],weight:META.weights[d]}])),
    wrong
  };
  renderResults(result);
}

function renderResults(r){
  $('#exam').classList.add('hide'); $('#bar').style.display='none';
  const R=$('#results'); R.classList.remove('hide');
  const verdict = r.passed
    ? `<span class="pill pass">PASS</span>`
    : `<span class="pill fail">BELOW PASS</span>`;
  let domRows='';
  for(const [d,v] of Object.entries(r.perDomain)){
    const pct = v.total? Math.round(v.correct/v.total*100):0;
    domRows += `<tr><td>D${d} · ${v.name} <span class="muted small">(${v.weight}%)</span></td>`+
      `<td>${v.correct}/${v.total}</td>`+
      `<td style="width:42%"><div class="barmeter"><i style="width:${pct}%;background:${pct>=72?'var(--good)':pct>=60?'var(--warn)':'var(--bad)'}"></i></div></td>`+
      `<td>${pct}%</td></tr>`;
  }
  const mm=Math.floor(r.timeUsedSec/60), ss=r.timeUsedSec%60;
  R.innerHTML = `
   <div class="card">
     <div class="row spread"><h1>Results</h1>${verdict}</div>
     <div class="row" style="gap:26px;margin:8px 0 4px">
       <div><div class="pill ${r.passed?'pass':'fail'}">${r.scaledEstimate}</div><div class="muted small">scaled est. / ${META.scaleMax} · pass ${r.passScaled}</div></div>
       <div><div class="pill">${r.correct}/${r.count}</div><div class="muted small">raw ${r.rawPct}%</div></div>
       <div><div class="pill">${r.passLikelihood}%</div><div class="muted small">est. pass likelihood</div></div>
       <div><div class="pill">${mm}m${String(ss).padStart(2,'0')}s</div><div class="muted small">time used</div></div>
     </div>
     <p class="note">Scaled score is a linear estimate of raw %; the real exam uses undisclosed
       scaling, so treat this as a calibration signal, not a guarantee. Aim comfortably above
       ${r.passScaled} (≈80%+) before sitting.</p>
   </div>
   <div class="card"><h2>Per-domain breakdown</h2><table>${domRows}</table>
     <p class="note">Weakest domains are where to spend the next study block. Aim ≥72% in each.</p></div>
   <div class="card">
     <div class="row spread"><h2>Answer review</h2>
       <label class="row small muted"><input type="checkbox" id="onlyWrong"/> show incorrect only</label></div>
     <div id="reviewList"></div>
   </div>
   <div class="card">
     <h2>Save your result</h2>
     <p class="small muted">Feed this into your learner profile: run <code>/save-progress</code> and paste the JSON,
       or keep the downloaded file.</p>
     <div class="row"><button id="btnCopy" class="primary">Copy results JSON</button>
       <button id="btnDl">Download results JSON</button>
       <button id="btnRetake" onclick="location.reload()">Retake</button></div>
   </div>`;
  // review list
  const list=$('#reviewList');
  function paintReview(onlyWrong){
    list.innerHTML='';
    QUESTIONS.forEach((q,i)=>{
      const s=state[i], ok=isCorrect(q,s), multi=isMulti(q);
      if(onlyWrong && ok) return;
      let opts='';
      for(const L of Object.keys(q.options)){
        const isAns = multi ? q.answer.includes(L) : L===q.answer;
        const isPick = selected(q,s,L);
        let cls='opt'; if(isAns) cls+=' correct'; else if(isPick) cls+=' wrong';
        const tag = isAns?' ✓':(isPick?' ✗ your answer':'');
        opts += `<div class="${cls}"><span class="L">${L}</span>${q.options[L]}<span class="muted small">${tag}</span></div>`;
      }
      let dz='';
      for(const [L,why] of Object.entries(q.distractors||{})) dz+=`<div class="note"><strong>${L}:</strong> ${why}</div>`;
      const div=document.createElement('div'); div.className='rev';
      div.innerHTML = `<div class="row spread small"><span><strong>Q${i+1}</strong> `+
        `<span class="badge dom">D${q.domain}</span> <span class="badge ${q.difficulty}">${q.difficulty}</span> `+
        (multi?`<span class="badge multi">Select ${q.selectCount}</span> `:'')+
        `<span class="badge">${q.scenario}</span></span>`+
        `<span class="${ok?'pass':'fail'}">${ok?'Correct':(answered(q,s)?'Incorrect':'Skipped')}</span></div>`+
        `<p style="margin:8px 0">${q.stem}</p>${opts}`+
        `<div class="note" style="margin-top:8px"><strong>Why ${fmtAns(q)}:</strong> ${q.explanation}</div>${dz}`;
      list.appendChild(div);
    });
  }
  paintReview(false);
  $('#onlyWrong').onchange = e => paintReview(e.target.checked);
  const blob = JSON.stringify(r,null,2);
  $('#btnCopy').onclick = ()=>{ navigator.clipboard.writeText(blob).then(()=>{$('#btnCopy').textContent='Copied ✓';}); };
  $('#btnDl').onclick = ()=>{ const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([blob],{type:'application/json'}));
    a.download=`cca-mock-result-${r.takenAt.slice(0,10)}.json`; a.click(); };
  window.scrollTo(0,0);
}
// warn on accidental navigation away mid-exam
window.addEventListener('beforeunload', e=>{ if(startedAt && !submitted){ e.preventDefault(); e.returnValue=''; }});
</script>
</body>
</html>
"""


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate a timed HTML mock exam.")
    ap.add_argument("--count", type=int, default=DEFAULT_COUNT,
                    help=f"number of questions (default {DEFAULT_COUNT})")
    ap.add_argument("--time", type=int, default=None,
                    help="time limit in minutes (default: 2 min/question)")
    ap.add_argument("--domain", type=int, choices=[1, 2, 3, 4, 5], default=None,
                    help="restrict to a single domain")
    ap.add_argument("--seed", type=int, default=None, help="seed for a reproducible set")
    ap.add_argument("--adaptive", metavar="RESULTS.json", default=None,
                    help="bias sampling toward weak domains + missed concepts from a prior results JSON")
    ap.add_argument("-o", "--output", default=None, help="output HTML path")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    bank = load_bank()
    adaptive = load_adaptive(args.adaptive) if args.adaptive else None
    available = len([q for q in bank if args.domain is None or q["domain"] == args.domain])
    count = min(args.count, available)
    if count < args.count:
        print(f"⚠  Only {available} questions available; generating {count}.", file=sys.stderr)

    picked = sample(bank, count, args.domain, rng, adaptive)
    minutes = args.time if args.time else max(1, round(len(picked) * DEFAULT_MINUTES / DEFAULT_COUNT))

    if adaptive and not args.domain:
        weak = sorted((d for d in DOMAIN_WEIGHTS if adaptive["acc"].get(d) is not None
                       and adaptive["acc"][d] < 0.8), key=lambda d: adaptive["acc"][d])
        wtxt = ", ".join(f"D{d} {round(adaptive['acc'][d]*100)}%" for d in weak[:3]) or "none <80%"
        suffix = f"Adaptive mock · targets weak domains ({wtxt}) + missed concepts"
    else:
        suffix = (f"Single-domain focus: D{args.domain} · {DOMAIN_NAMES[args.domain]}"
                  if args.domain else
                  "Full domain-weighted mock · mirrors the 27/18/20/20/15 blueprint")
    html = render_html(picked, minutes, suffix, rng)

    out = args.output
    if not out:
        outdir = os.path.join(REPO_ROOT, "mock-exams", "attempts")
        os.makedirs(outdir, exist_ok=True)
        stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        tag = f"d{args.domain}" if args.domain else "full"
        out = os.path.join(outdir, f"mock-{tag}-{count}q-{stamp}.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    # summary
    from collections import Counter
    dom = Counter(q["domain"] for q in picked)
    print(f"✓ Generated {count}-question mock exam ({minutes} min) → {out}")
    print("  Domain mix: " + ", ".join(f"D{d}={dom[d]}" for d in sorted(dom)))
    print(f"  Open it in a browser:  open \"{out}\"")


if __name__ == "__main__":
    main()
