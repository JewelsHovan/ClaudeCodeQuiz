#!/usr/bin/env python3
"""
build_exam_center.py — bundle the whole question bank into ONE standalone HTML
"Exam Center" that generates fresh practice exams entirely client-side.

Unlike generate_exam.py (which samples in Python and emits a single fixed exam),
this embeds the ENTIRE quiz/bank/*.json and ports the sampler to JS, so the
output file lets you re-roll unlimited exams — full 60-Q readiness sitting,
20-Q quick drill, or a single-domain drill — with no Python and no terminal.

Same engine as generate_exam.py: blueprint-weighted domain allocation,
render-time option shuffle, multiple-response support, scaled scoring vs 720,
per-domain breakdown, and a full answer review. Adds a home screen, a readiness
verdict, seedable reproducibility, and a localStorage attempt history.

Usage:
  uv run python mock-exams/build_exam_center.py           # -> mock-exams/exam-center.html
  uv run python mock-exams/build_exam_center.py -o out.html

Rebuild whenever quiz/bank/*.json changes so the embedded bank stays current.
"""
import argparse
import datetime as _dt
import glob
import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK_GLOB = os.path.join(REPO_ROOT, "quiz", "bank", "*.json")

# Kept identical to generate_exam.py so the two stay in lockstep.
DOMAIN_WEIGHTS = {1: 27, 2: 18, 3: 20, 4: 20, 5: 15}
DOMAIN_NAMES = {
    1: "Agentic Architecture & Orchestration",
    2: "Tool Design & MCP Integration",
    3: "Claude Code Configuration & Workflows",
    4: "Prompt Engineering & Structured Output",
    5: "Context Management & Reliability",
}
PASS_SCALED = 720
SCALE_MAX = 1000


def load_bank():
    files = sorted(glob.glob(BANK_GLOB))
    if not files:
        sys.exit(f"No question bank found at {BANK_GLOB}.")
    out = []
    for f in files:
        try:
            out.extend(json.load(open(f, encoding="utf-8")))
        except json.JSONDecodeError as e:
            sys.exit(f"Invalid JSON in {f}: {e}")
    # Only the fields the client needs (keeps the file lean; drops _file etc.)
    keep = ("id", "domain", "domain_name", "scenario", "difficulty", "stem",
            "options", "answer", "explanation", "distractors", "tags")
    return [{k: q[k] for k in keep if k in q} for q in out]


def main():
    ap = argparse.ArgumentParser(description="Build the standalone CCA Exam Center HTML.")
    ap.add_argument("-o", "--output",
                    default=os.path.join(REPO_ROOT, "mock-exams", "exam-center.html"))
    args = ap.parse_args()

    bank = load_bank()
    meta = {
        "weights": DOMAIN_WEIGHTS,
        "domainNames": DOMAIN_NAMES,
        "passScaled": PASS_SCALED,
        "scaleMax": SCALE_MAX,
        "built": _dt.datetime.now().strftime("%Y-%m-%d"),
        "bankSize": len(bank),
    }
    html = (_TEMPLATE
            .replace("/*__BANK__*/", json.dumps(bank, ensure_ascii=False))
            .replace("/*__CFG__*/", json.dumps(meta, ensure_ascii=False)))
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(html)

    from collections import Counter
    dom = Counter(q["domain"] for q in bank)
    print(f"✓ Built Exam Center ({len(bank)} questions embedded) → {args.output}")
    print("  Domain mix in bank: " + ", ".join(f"D{d}={dom[d]}" for d in sorted(dom)))
    print(f"  Open it in a browser:  open \"{args.output}\"")


_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>CCA Exam Center — Judge Your Readiness</title>
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
  input[type=number],select{font:inherit;background:var(--panel2);color:var(--ink);
    border:1px solid var(--line);border-radius:8px;padding:7px 10px}
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
  /* home */
  .mode{display:block;width:100%;text-align:left;padding:14px 16px;margin:8px 0;border-radius:12px;
    border:1px solid var(--line);background:var(--panel2)}
  .mode:hover{border-color:var(--accent2)}
  .mode.sel{border-color:var(--accent);background:var(--pick)}
  .mode b{font-size:16px} .mode .sub{color:var(--muted);font-size:13px;margin-top:2px}
  .verdict{font-size:34px;font-weight:800;letter-spacing:.5px}
  .vr-ready{color:var(--good)} .vr-border{color:var(--warn)} .vr-no{color:var(--bad)}
  .readbar{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
  .hist td{font-size:13px}
</style>
</head>
<body>
<div id="bar"><div class="inner">
  <div class="row"><strong>CCA Exam Center</strong><span class="muted small" id="barprog"></span></div>
  <div class="row"><span id="timer">--:--</span>
    <button id="btnSubmit" class="primary">Submit exam</button></div>
</div></div>

<div class="wrap">

  <!-- HOME -->
  <div id="home">
    <div class="card">
      <h1>Claude Certified Architect — Foundations</h1>
      <div class="muted">Exam Center · <span id="hBank"></span> questions · judge your readiness</div>
      <div id="lastBox" class="readbar" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <h2>Pick a sitting</h2>
      <button class="mode sel" data-mode="full">
        <b>▶ Full readiness exam</b>
        <div class="sub">60 questions · 120 min · blueprint-weighted (27/18/20/20/15) — mirrors the real exam</div>
      </button>
      <button class="mode" data-mode="quick">
        <b>▶ Quick drill</b>
        <div class="sub">20 questions · 40 min · weighted — a fast pulse-check</div>
      </button>
      <button class="mode" data-mode="domain">
        <b>▶ Single-domain drill</b>
        <div class="sub">15 questions · 30 min · one domain, to pressure-test a weak area</div>
      </button>

      <div id="domainPick" class="row hide" style="margin:6px 2px 4px">
        <span class="small muted">Domain:</span>
        <select id="domainSel"></select>
      </div>

      <div class="row spread" style="margin-top:16px">
        <label class="row small muted"><input type="checkbox" id="optReveal"/> practice mode (reveal answer after each question)</label>
        <label class="row small muted">seed (optional, reproducible):
          <input type="number" id="seed" placeholder="random" style="width:110px"/></label>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="primary" id="btnStart" style="font-size:16px;padding:12px 22px">Start ▶</button>
        <span class="small muted" id="startHint"></span>
      </div>
    </div>

    <div class="card">
      <div class="row spread"><h2 style="margin:0">Attempt history</h2>
        <button id="btnClearHist" class="small">Clear</button></div>
      <div id="histBox" class="small muted" style="margin-top:8px">No attempts yet — take a full readiness exam to calibrate.</div>
      <p class="note">Scores are stored locally in this browser only. Scaled scoring is a linear
        estimate of raw % (the real exam's scaling is undisclosed); aim comfortably above 720 (≈80%+)
        before booking. Questions are original practice items matched to the blueprint, never real exam content.</p>
    </div>
  </div>

  <!-- EXAM -->
  <div id="exam" class="hide">
    <div class="card">
      <div id="scenarioBox" class="scenario hide"></div>
      <div class="row spread small muted"><span id="qmeta"></span><span id="qid" class="muted"></span></div>
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
const BANK = /*__BANK__*/;
const CFG  = /*__CFG__*/;
const $ = s => document.querySelector(s);
const HKEY = 'cca-exam-center-history-v1';

/* ---------- seedable RNG (mulberry32); falls back to Math.random ---------- */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function shuffle(arr,rand){for(let i=arr.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}

/* ---------- sampler (ports generate_exam.py: allocate + sample + shuffle) ---------- */
function allocate(count,domains){
  const tot=domains.reduce((s,d)=>s+CFG.weights[d],0);
  const raw={},alloc={};let used=0;
  domains.forEach(d=>{raw[d]=count*CFG.weights[d]/tot;alloc[d]=Math.floor(raw[d]);used+=alloc[d];});
  const rem=count-used;
  domains.slice().sort((a,b)=>(raw[b]-alloc[b])-(raw[a]-alloc[a])).slice(0,rem).forEach(d=>alloc[d]++);
  return alloc;
}
function tokens(s){return new Set((s.toLowerCase().match(/[a-z0-9]+/g)||[]));}
function nearDup(q,chosen){const tq=tokens(q.stem);if(!tq.size)return false;
  for(const c of chosen){const tc=tokens(c.stem);let inter=0;tq.forEach(t=>{if(tc.has(t))inter++;});
    const uni=new Set([...tq,...tc]).size;if(uni&&inter/uni>=0.6)return true;}return false;}
function take(pool,n,chosen){const out=[],skipped=[];
  for(const q of pool){if(out.length>=n)break;if(nearDup(q,chosen.concat(out))){skipped.push(q);continue;}out.push(q);}
  for(const q of skipped){if(out.length>=n)break;out.push(q);}
  return out.slice(0,n);}
function shuffleOptions(q,rand){
  const letters=['A','B','C','D'];
  const items=letters.filter(L=>L in q.options).map(L=>[L,q.options[L]]);
  shuffle(items,rand);
  const opts={},remap={};
  items.forEach(([oldL,txt],i)=>{const nl=letters[i];opts[nl]=txt;remap[oldL]=nl;});
  const a=q.answer;
  const ans=Array.isArray(a)?a.map(x=>remap[x]).sort():remap[a];
  const dis={};for(const k in (q.distractors||{})){if(k in remap)dis[remap[k]]=q.distractors[k];}
  const multi=Array.isArray(ans);
  return {...q,options:opts,answer:ans,distractors:dis,selectCount:multi?ans.length:1};
}
function buildExam(cfg){
  const rand = cfg.seed!=null ? mulberry32(cfg.seed>>>0) : Math.random;
  const byDom={};BANK.forEach(q=>{(byDom[q.domain]=byDom[q.domain]||[]).push(q);});
  let picked=[];
  if(cfg.domain){
    const pool=shuffle((byDom[cfg.domain]||[]).slice(),rand);
    picked=take(pool,Math.min(cfg.count,pool.length),[]);
  }else{
    const domains=Object.keys(byDom).map(Number).sort();
    const alloc=allocate(cfg.count,domains);
    domains.forEach(d=>{const pool=shuffle(byDom[d].slice(),rand);picked=picked.concat(take(pool,alloc[d],picked));});
  }
  // group by scenario (mirror the real exam), shuffle groups + within
  const groups={};picked.forEach(q=>{(groups[q.scenario]=groups[q.scenario]||[]).push(q);});
  const names=shuffle(Object.keys(groups),rand);
  let ordered=[];names.forEach(n=>{ordered=ordered.concat(shuffle(groups[n],rand));});
  const qs=ordered.map((q,i)=>{const s=shuffleOptions(q,rand);return {
    n:i+1,id:s.id,domain:s.domain,domainName:s.domain_name||CFG.domainNames[s.domain],
    scenario:s.scenario||'General',difficulty:s.difficulty||'medium',stem:s.stem,
    options:s.options,answer:s.answer,selectCount:s.selectCount,explanation:s.explanation||'',
    distractors:s.distractors||{},tags:s.tags||[]};});
  const meta={count:qs.length,minutes:cfg.minutes,passScaled:CFG.passScaled,scaleMax:CFG.scaleMax,
    weights:CFG.weights,domainNames:CFG.domainNames,label:cfg.label};
  return {questions:qs,meta};
}

/* ---------- exam engine (identical grading to generate_exam.py) ---------- */
let QUESTIONS=[],META={},state=[],cur=0,reveal=false,submitted=false;
let remaining=0,timerId=null,startedAt=null;
const fmt=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const isMulti=q=>Array.isArray(q.answer);
const answered=(q,s)=>isMulti(q)?(Array.isArray(s.pick)&&s.pick.length>0):s.pick!=null;
const selected=(q,s,L)=>isMulti(q)?(Array.isArray(s.pick)&&s.pick.includes(L)):s.pick===L;
const fmtAns=q=>isMulti(q)?q.answer.join(', '):q.answer;
const fmtPick=(q,s)=>isMulti(q)?(Array.isArray(s.pick)?[...s.pick].sort().join(', '):''):(s.pick||'');
function isCorrect(q,s){if(isMulti(q)){if(!Array.isArray(s.pick))return false;
  return [...q.answer].sort().join('|')===[...s.pick].sort().join('|');}return s.pick===q.answer;}
function togglePick(q,s,L){if(isMulti(q)){const i=s.pick.indexOf(L);if(i>=0)s.pick.splice(i,1);else s.pick.push(L);}else s.pick=L;}

function startExam(built){
  QUESTIONS=built.questions;META=built.meta;
  state=QUESTIONS.map(q=>({pick:isMulti(q)?[]:null,flag:false}));
  cur=0;submitted=false;remaining=META.minutes*60;startedAt=new Date();
  reveal=$('#optReveal').checked;
  $('#home').classList.add('hide');$('#results').classList.add('hide');
  $('#exam').classList.remove('hide');$('#bar').style.display='block';
  $('#totalN').textContent=META.count;
  buildPalette();render();tick();timerId=setInterval(tick,1000);
  window.scrollTo(0,0);
}
function tick(){
  $('#timer').textContent=fmt(remaining);
  $('#timer').className=remaining<=60?'crit':remaining<=300?'warn':'';
  if(remaining<=0){clearInterval(timerId);doSubmit(true);return;}
  remaining--;
}
function buildPalette(){const p=$('#palette');p.innerHTML='';
  QUESTIONS.forEach((q,i)=>{const b=document.createElement('div');b.className='pal';b.textContent=i+1;
    b.onclick=()=>{cur=i;render();};p.appendChild(b);});}
function refreshPalette(){[...$('#palette').children].forEach((b,i)=>{
  b.classList.toggle('answered',answered(QUESTIONS[i],state[i]));
  b.classList.toggle('flagged',state[i].flag);b.classList.toggle('cur',i===cur);});
  const nAns=state.filter((s,i)=>answered(QUESTIONS[i],s)).length;
  $('#answeredN').textContent=nAns;$('#flaggedN').textContent=state.filter(s=>s.flag).length;
  $('#barprog').textContent=`Q${cur+1} of ${META.count} · answered ${nAns}`;}
function render(){
  const q=QUESTIONS[cur],s=state[cur];
  const sb=$('#scenarioBox');
  if(q.scenario&&q.scenario!=='General'){sb.classList.remove('hide');sb.innerHTML=`<strong>Scenario:</strong> ${q.scenario}`;}
  else sb.classList.add('hide');
  const multi=isMulti(q);
  $('#qmeta').innerHTML=`<span class="badge dom">D${q.domain} · ${q.domainName}</span> `+
    `<span class="badge ${q.difficulty}">${q.difficulty}</span>`+(multi?` <span class="badge multi">Select ${q.selectCount}</span>`:'');
  $('#qid').textContent=q.id;$('#stem').textContent=q.stem;
  const o=$('#opts');o.innerHTML='';
  for(const L of Object.keys(q.options)){
    const btn=document.createElement('button');
    btn.className='opt'+(selected(q,s,L)?' sel':'')+(multi?' multi':'');
    btn.innerHTML=`<span class="L">${L}</span>${q.options[L]}`;
    btn.onclick=()=>{if(submitted)return;togglePick(q,s,L);render();if(reveal)showInlineReveal();};
    if(reveal&&answered(q,s)){const correctL=multi?q.answer.includes(L):L===q.answer;
      if(correctL)btn.classList.add('correct');else if(selected(q,s,L))btn.classList.add('wrong');}
    o.appendChild(btn);
  }
  $('#btnFlag').textContent=s.flag?'⚑ Unflag':'⚑ Flag for review';
  $('#btnPrev').disabled=cur===0;
  $('#btnNext').textContent=cur===META.count-1?'Last →':'Next →';
  if(reveal&&answered(q,s))showInlineReveal();else $('#inlineReveal').classList.add('hide');
  refreshPalette();
}
function showInlineReveal(){const q=QUESTIONS[cur],s=state[cur],box=$('#inlineReveal');
  const ok=isCorrect(q,s);box.classList.remove('hide');
  box.innerHTML=`<div><strong class="${ok?'pass':'fail'}">${ok?'Correct':'Incorrect'}</strong> — correct answer: <strong>${fmtAns(q)}</strong></div><div class="note">${q.explanation}</div>`;}
$('#btnPrev').onclick=()=>{if(cur>0){cur--;render();}};
$('#btnNext').onclick=()=>{if(cur<META.count-1){cur++;render();}else window.scrollTo(0,document.body.scrollHeight);};
$('#btnFlag').onclick=()=>{state[cur].flag=!state[cur].flag;render();};
document.addEventListener('keydown',e=>{
  if(submitted||$('#exam').classList.contains('hide'))return;
  if(['a','b','c','d','A','B','C','D'].includes(e.key)){togglePick(QUESTIONS[cur],state[cur],e.key.toUpperCase());render();if(reveal)showInlineReveal();}
  else if(e.key==='ArrowRight')$('#btnNext').click();
  else if(e.key==='ArrowLeft')$('#btnPrev').click();
  else if(e.key==='f')$('#btnFlag').click();});
$('#btnSubmit').onclick=()=>doSubmit(false);

function doSubmit(auto){
  if(submitted)return;
  const un=state.filter((s,i)=>!answered(QUESTIONS[i],s)).length;
  if(!auto&&un>0&&!confirm(`${un} question(s) unanswered. Submit anyway?`))return;
  submitted=true;clearInterval(timerId);
  const elapsed=Math.round((new Date()-startedAt)/1000);
  let correct=0;const perDom={},wrong=[];
  for(const d of Object.keys(META.weights))perDom[d]={correct:0,total:0};
  QUESTIONS.forEach((q,i)=>{perDom[q.domain].total++;
    if(isCorrect(q,state[i])){correct++;perDom[q.domain].correct++;}
    else wrong.push({id:q.id,domain:q.domain,your:fmtPick(q,state[i]),answer:fmtAns(q),tags:q.tags});});
  const raw=correct/META.count,scaled=Math.round(raw*META.scaleMax),passed=scaled>=META.passScaled;
  const margin=raw-(META.passScaled/META.scaleMax);
  let prob=1/(1+Math.exp(-margin*100*Math.sqrt(META.count/60)));prob=Math.max(0.02,Math.min(0.98,prob));
  const r={label:META.label,takenAt:new Date().toISOString(),count:META.count,correct,
    scaledEstimate:scaled,passScaled:META.passScaled,passed,rawPct:+(raw*100).toFixed(1),
    passLikelihood:+(prob*100).toFixed(0),timeUsedSec:elapsed,
    perDomain:Object.fromEntries(Object.entries(perDom).map(([d,v])=>[d,{...v,name:META.domainNames[d],weight:META.weights[d]}])),wrong};
  saveAttempt(r);renderResults(r);
}

/* readiness verdict: comfortably-above-720 framing */
function verdict(scaled){
  if(scaled>=800)return {cls:'vr-ready',txt:'READY',sub:'Comfortably above the 720 pass mark. Book with confidence.'};
  if(scaled>=META.passScaled)return {cls:'vr-border',txt:'BORDERLINE',sub:'Above 720 but within the noise band — aim for 800+ before booking.'};
  return {cls:'vr-no',txt:'NOT YET',sub:'Below the 720 pass mark. Target your weakest domains and re-test.'};
}
function renderResults(r){
  $('#exam').classList.add('hide');$('#bar').style.display='none';
  const R=$('#results');R.classList.remove('hide');
  const v=verdict(r.scaledEstimate);
  let domRows='';
  for(const [d,val] of Object.entries(r.perDomain)){
    const pct=val.total?Math.round(val.correct/val.total*100):0;
    domRows+=`<tr><td>D${d} · ${val.name} <span class="muted small">(${val.weight}%)</span></td>`+
      `<td>${val.correct}/${val.total}</td>`+
      `<td style="width:42%"><div class="barmeter"><i style="width:${pct}%;background:${pct>=72?'var(--good)':pct>=60?'var(--warn)':'var(--bad)'}"></i></div></td>`+
      `<td>${pct}%</td></tr>`;}
  const mm=Math.floor(r.timeUsedSec/60),ss=r.timeUsedSec%60;
  R.innerHTML=`
   <div class="card">
     <div class="row spread"><h1 style="margin:0">${r.label}</h1>
       <span class="verdict ${v.cls}">${v.txt}</span></div>
     <div class="note" style="margin-top:2px">${v.sub}</div>
     <div class="row" style="gap:26px;margin:14px 0 4px">
       <div><div class="pill ${r.passed?'pass':'fail'}">${r.scaledEstimate}</div><div class="muted small">scaled est. / ${META.scaleMax} · pass ${r.passScaled}</div></div>
       <div><div class="pill">${r.correct}/${r.count}</div><div class="muted small">raw ${r.rawPct}%</div></div>
       <div><div class="pill">${r.passLikelihood}%</div><div class="muted small">est. pass likelihood</div></div>
       <div><div class="pill">${mm}m${String(ss).padStart(2,'0')}s</div><div class="muted small">time used</div></div>
     </div>
     <div class="row" style="margin-top:12px">
       <button class="primary" id="btnAgain">↻ New exam</button>
       <button id="btnReview2">Jump to review ↓</button>
     </div>
   </div>
   <div class="card"><h2>Per-domain breakdown</h2><table>${domRows}</table>
     <p class="note">Weakest domains are where to spend the next study block. Aim ≥72% in each; the
       27% Agentic Architecture domain is the biggest lever on your score.</p></div>
   <div class="card">
     <div class="row spread"><h2>Answer review</h2>
       <label class="row small muted"><input type="checkbox" id="onlyWrong"/> show incorrect only</label></div>
     <div id="reviewList"></div>
   </div>`;
  $('#btnAgain').onclick=goHome;
  $('#btnReview2').onclick=()=>$('#reviewList').scrollIntoView({behavior:'smooth'});
  const list=$('#reviewList');
  function paint(onlyWrong){
    list.innerHTML='';
    QUESTIONS.forEach((q,i)=>{const s=state[i],ok=isCorrect(q,s),multi=isMulti(q);
      if(onlyWrong&&ok)return;
      let opts='';
      for(const L of Object.keys(q.options)){
        const isAns=multi?q.answer.includes(L):L===q.answer,isPick=selected(q,s,L);
        let cls='opt';if(isAns)cls+=' correct';else if(isPick)cls+=' wrong';
        const tag=isAns?' ✓':(isPick?' ✗ your answer':'');
        opts+=`<div class="${cls}"><span class="L">${L}</span>${q.options[L]}<span class="muted small">${tag}</span></div>`;}
      let dz='';for(const [L,why] of Object.entries(q.distractors||{}))dz+=`<div class="note"><strong>${L}:</strong> ${why}</div>`;
      const div=document.createElement('div');div.className='rev';
      div.innerHTML=`<div class="row spread small"><span><strong>Q${i+1}</strong> `+
        `<span class="badge dom">D${q.domain}</span> <span class="badge ${q.difficulty}">${q.difficulty}</span> `+
        (multi?`<span class="badge multi">Select ${q.selectCount}</span> `:'')+
        `<span class="badge">${q.scenario}</span></span>`+
        `<span class="${ok?'pass':'fail'}">${ok?'Correct':(answered(q,s)?'Incorrect':'Skipped')}</span></div>`+
        `<p style="margin:8px 0">${q.stem}</p>${opts}`+
        `<div class="note" style="margin-top:8px"><strong>Why ${fmtAns(q)}:</strong> ${q.explanation}</div>${dz}`;
      list.appendChild(div);});}
  paint(false);$('#onlyWrong').onchange=e=>paint(e.target.checked);
  window.scrollTo(0,0);
}

/* ---------- localStorage attempt history ---------- */
function readHist(){try{return JSON.parse(localStorage.getItem(HKEY))||[];}catch(e){return [];}}
function saveAttempt(r){const h=readHist();
  h.unshift({label:r.label,scaled:r.scaledEstimate,passed:r.passed,pct:r.rawPct,
    count:r.count,at:r.takenAt});
  localStorage.setItem(HKEY,JSON.stringify(h.slice(0,25)));}
function renderHome(){
  $('#hBank').textContent=CFG.bankSize;
  const h=readHist();
  const last=h[0];
  if(last){const v=last.scaled>=800?'✓ READY':last.scaled>=CFG.passScaled?'~ BORDERLINE':'✗ NOT YET';
    const cls=last.scaled>=800?'vr-ready':last.scaled>=CFG.passScaled?'vr-border':'vr-no';
    $('#lastBox').innerHTML=`<span class="muted small">Last attempt</span>`+
      `<span class="verdict ${cls}" style="font-size:26px">${last.scaled}/${CFG.scaleMax}</span>`+
      `<span class="${cls}" style="font-weight:700">${v}</span>`+
      `<span class="muted small">${last.label} · ${last.pct}% · ${new Date(last.at).toLocaleDateString()}</span>`;
  }else{$('#lastBox').innerHTML=`<span class="muted small">No attempts yet — take a full readiness exam to calibrate.</span>`;}
  if(h.length){
    let rows=h.slice(0,10).map(a=>{const cls=a.scaled>=800?'pass':a.scaled>=CFG.passScaled?'':'fail';
      return `<tr><td>${new Date(a.at).toLocaleString()}</td><td>${a.label}</td>`+
        `<td class="${cls}">${a.scaled}/${CFG.scaleMax}</td><td>${a.pct}%</td></tr>`;}).join('');
    $('#histBox').innerHTML=`<table class="hist"><tr><th>When</th><th>Sitting</th><th>Scaled</th><th>Raw</th></tr>${rows}</table>`;
  }else{$('#histBox').innerHTML='No attempts yet — take a full readiness exam to calibrate.';}
}
$('#btnClearHist').onclick=()=>{if(confirm('Clear local attempt history?')){localStorage.removeItem(HKEY);renderHome();}};

/* ---------- home wiring ---------- */
let mode='full';
const MODES={full:{count:60,minutes:120,label:'Full readiness exam'},
             quick:{count:20,minutes:40,label:'Quick drill'},
             domain:{count:15,minutes:30,label:'Single-domain drill'}};
[...document.querySelectorAll('.mode')].forEach(b=>b.onclick=()=>{
  mode=b.dataset.mode;
  document.querySelectorAll('.mode').forEach(x=>x.classList.toggle('sel',x===b));
  $('#domainPick').classList.toggle('hide',mode!=='domain');
  updateHint();});
function updateHint(){const m=MODES[mode];
  const dm=mode==='domain'?` · D${$('#domainSel').value}`:'';
  $('#startHint').textContent=`${m.count} questions · ${m.minutes} min${dm}`;}
(function initDomains(){const sel=$('#domainSel');
  Object.keys(CFG.domainNames).forEach(d=>{const o=document.createElement('option');
    o.value=d;o.textContent=`D${d} — ${CFG.domainNames[d]}`;sel.appendChild(o);});
  sel.onchange=updateHint;})();
$('#btnStart').onclick=()=>{
  const m=MODES[mode];
  const seedRaw=$('#seed').value.trim();
  const cfg={count:m.count,minutes:m.minutes,
    label:m.label+(mode==='domain'?` · D${$('#domainSel').value}`:''),
    domain:mode==='domain'?Number($('#domainSel').value):null,
    seed:seedRaw===''?null:(parseInt(seedRaw,10)||0)};
  startExam(buildExam(cfg));
};
function goHome(){$('#results').classList.add('hide');$('#exam').classList.add('hide');
  $('#bar').style.display='none';$('#home').classList.remove('hide');renderHome();window.scrollTo(0,0);}
window.addEventListener('beforeunload',e=>{if(startedAt&&!submitted){e.preventDefault();e.returnValue='';}});

renderHome();updateHint();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
