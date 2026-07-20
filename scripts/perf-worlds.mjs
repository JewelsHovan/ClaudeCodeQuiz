#!/usr/bin/env node

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const OUTPUT = path.join(ROOT, "test-results", "world-performance.json");
const PORT = 8746;
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const MATRIX = [
  { dpr: 1, cpu: 1 },
  { dpr: 2, cpu: 1 },
  { dpr: 2, cpu: 4 },
  { dpr: 2, cpu: 8 },
];
const CACHE_BUDGET_MIB = 28;
const BATTLE_PRESENTATION_BUDGET_MIB = 8;
const CLASSIC_FIRST_AUTHORED_PAINT_BUDGET_MS = 2500;
const NORMAL_FRAME_P95_BUDGET_MS = 20;
const STRESS_FRAME_P95_BUDGET_MS = 40;

if (!fs.existsSync(path.join(DIST, "artifact-metadata.json"))) throw new Error("Missing packaged artifact; run `just package`");

async function startServer() {
  const child = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: DIST, stdio: "ignore" });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error(`Artifact server exited with ${child.exitCode}`);
    try { if ((await fetch(BASE_URL)).ok) return child; } catch (_) { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error("Artifact server did not become ready");
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] || 0;
}

async function frameSample(page, durationMs = 900) {
  return page.evaluate(duration => new Promise(resolve => {
    const values = [];
    let first = null, previous = null;
    function tick(now) {
      if (first === null) first = now;
      if (previous !== null) values.push(now - previous);
      previous = now;
      if (now - first >= duration) {
        const ordered = values.slice().sort((a, b) => a - b);
        resolve({
          samples: values.length,
          median: ordered[Math.floor(ordered.length / 2)] || 0,
          p95: ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)] || 0,
          max: ordered[ordered.length - 1] || 0,
        });
      } else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }), durationMs);
}

async function moveOnce(page, key = "w") {
  const before = await page.evaluate(() => { const p = (0, eval)("player"); return { x: p.x, y: p.y }; });
  await page.keyboard.press(key);
  await page.waitForFunction(start => {
    try {
      const p = (0, eval)("player");
      return !p.moving && Math.abs(p.x - start.x) + Math.abs(p.y - start.y) === 1;
    } catch (_) { return false; }
  }, before, { timeout: 10000 });
  return page.evaluate(() => { const p = (0, eval)("player"); return { x: p.x, y: p.y }; });
}

async function dialogueMetrics(page) {
  const before = await page.evaluate(() => ({
    frame: (0,eval)("frame"), script: (0,eval)("dialogueSession.script.id"),
  }));
  const timing = await frameSample(page);
  const after = await page.evaluate(() => ({
    frame: (0,eval)("frame"), state: (0,eval)("state"), session: !!(0,eval)("dialogueSession"),
  }));
  return { timing, script: before.script, loopAdvanced: after.frame > before.frame,
    stayedOpen: after.state === "dialogue" && after.session };
}

async function seatedHandoffMetrics(page) {
  const before = await page.evaluate(() => {
    const ge=(0,eval),npc=ge("npcs").find(value=>value._seated&&value.type!=="AGENT"),p=ge("player");
    const spots=[[npc.x,npc.y+1,"up"],[npc.x,npc.y-1,"down"],[npc.x+1,npc.y,"left"],[npc.x-1,npc.y,"right"]];
    const spot=spots.find(value=>ge("walkable")(value[0],value[1]));
    p.x=p.fx=spot[0];p.y=p.fy=spot[1];p.dir=spot[2];p.moving=false;ge("beginNpcDialogue")(npc);
    return {frame:ge("frame"),slug:npc.slug};
  });
  const timing = await frameSample(page);
  const after = await page.evaluate(slug => {
    const ge=(0,eval),p=ge("player"),npc=ge("npcs").find(value=>value.slug===slug),frame=ge("challengeFacingFrame");
    const result={frame:ge("frame"),state:ge("state"),staging:!!ge("dialogueStaging"),safe:p.x!==npc.x||p.y!==npc.y,
      facing:!!frame&&frame.slug===slug&&frame.dir===npc.dir,resident:frame?1:0};
    ge("closeDialogue")(true);
    result.cleaned=ge("challengeFacingFrame")===null&&ge("encounterSeatRestore")===null&&npc._seated===true;
    return result;
  }, before.slug);
  return {timing, loopAdvanced:after.frame>before.frame, converged:after.state==="dialogue"&&!after.staging&&after.safe,
    facing:after.facing,resident:after.resident,cleaned:after.cleaned};
}

async function consoleMetrics(page) {
  const before = await page.evaluate(() => {
    const ge = (0, eval); ge("certConsoleOpen = true");
    const first = ge("_getEvidenceSummary")(), second = ge("_getEvidenceSummary")();
    return { frame: ge("frame"), summaryCacheStable: first === second };
  });
  const timing = await frameSample(page);
  const after = await page.evaluate(() => {
    const ge = (0, eval), frame = ge("frame"); ge("certConsoleOpen = false");
    return frame;
  });
  return { timing, loopAdvanced: after > before.frame, summaryCacheStable: before.summaryCacheStable };
}

async function mentorMetrics(page) {
  const before = await page.evaluate(() => {
    const ge = (0, eval), npc = ge("npcs").find(value => !value.training);
    npc.defeated = true; ge("defeated").add(npc.slug); ge("openMentorReview")(npc);
    return { frame: ge("frame"), open: !!ge("mentorReview") };
  });
  const timing = await frameSample(page);
  const after = await page.evaluate(() => {
    const ge = (0, eval), frame = ge("frame"); ge("closeMentorReview")();
    return { frame, open: !!ge("mentorReview") };
  });
  return { timing, opened: before.open, loopAdvanced: after.frame > before.frame, closed: !after.open };
}

async function classicBattleMetrics(page) {
  const before = await page.evaluate(() => {
    const ge=(0,eval),npc=ge("npcs").find(value=>value.type!=="AGENT"),context=ge("ctx"),original=context.drawImage;
    window.__t55ArenaFirstPaint=null;window.__t55ArenaOriginalDrawImage=original;
    context.drawImage=function(...args){
      if(window.__t55ArenaFirstPaint===null&&args[0]?.naturalWidth===1600&&args[0]?.naturalHeight===864)window.__t55ArenaFirstPaint=performance.now();
      return original.apply(this,args);
    };
    const started=performance.now();ge("startBattle")(npc);ge("advanceBattle")();ge("advanceBattle")();
    const b=ge("battle");
    return{frame:ge("frame"),started,ids:b.mons.map(mon=>mon.id),unique:new Set(b.mons.map(mon=>mon.id)).size,domain:b.mons[0].domain};
  });
  await page.waitForFunction(expected => {
    const d=window.DatamonBattlePresentation.getDiagnostics(),a=window.DatamonBattleArena.getDiagnostics();
    return window.__t55ArenaFirstPaint!==null&&d.loadedSheetCount>=expected.unique&&d.inFlightSheetCount===0&&
      a.activeDomain===expected.domain&&a.residentArenaCount===1&&a.inFlightArenaCount===0;
  }, {unique:before.unique,domain:before.domain}, {timeout:10000});
  const firstAuthoredPaintMs=await page.evaluate(started=>{const ge=(0,eval),elapsed=window.__t55ArenaFirstPaint-started;
    ge("ctx").drawImage=window.__t55ArenaOriginalDrawImage;delete window.__t55ArenaOriginalDrawImage;return elapsed;},before.started);
  const timing = await frameSample(page);
  const after = await page.evaluate(() => {
    const ge=(0,eval),b=ge("battle"),d=window.DatamonBattlePresentation.getDiagnostics(),a=window.DatamonBattleArena.getDiagnostics();
    const battlemonDecodedBytes=d.loadedSheetDecodedBytes+d.fallbackDecodedBytes;
    const presentationDecodedBytes=a.residentDecodedBytes+a.fallbackDecodedBytes+battlemonDecodedBytes;
    const result={frame:ge("frame"),state:ge("state"),phase:b&&b.phase,loaded:d.loadedSheetCount,inFlight:d.inFlightSheetCount,
      arena:a.activeDomain,resident:a.residentArenaCount,arenaInFlight:a.inFlightArenaCount,
      arenaDecodedBytes:a.residentDecodedBytes,arenaFallbackDecodedBytes:a.fallbackDecodedBytes,
      battlemonDecodedBytes,battlemonFallbackDecodedBytes:d.fallbackDecodedBytes,
      presentationDecodedMiB:presentationDecodedBytes/1024/1024};
    ge("battle = null");ge('state = "overworld"');
    return result;
  });
  return{timing,firstAuthoredPaintMs,loopAdvanced:after.frame>before.frame,stayedInteractive:after.state==="battle"&&after.phase==="question",
    requested:before.unique,loaded:after.loaded,inFlight:after.inFlight,domain:before.domain,
    arena:after.arena,resident:after.resident,arenaInFlight:after.arenaInFlight,
    arenaDecodedBytes:after.arenaDecodedBytes,arenaFallbackDecodedBytes:after.arenaFallbackDecodedBytes,
    battlemonDecodedBytes:after.battlemonDecodedBytes,battlemonFallbackDecodedBytes:after.battlemonFallbackDecodedBytes,
    presentationDecodedMiB:after.presentationDecodedMiB};
}

async function sequentialClassicCacheMetrics(page, firstDomain) {
  const domains=await page.evaluate(excluded=>{
    const ge=(0,eval),seen=[];
    for(const npc of ge("npcs")){if(npc.type!=="AGENT"&&npc.type!=="MIX"&&npc.type!==excluded&&!seen.includes(npc.type))seen.push(npc.type);}
    return seen.slice(0,2);
  },firstDomain);
  if(domains.length!==2)throw new Error("Performance fixture lacks two distinct follow-up classic domains");
  const encounters=[];
  for(const domain of domains){
    const started=await page.evaluate(type=>{const ge=(0,eval),npc=ge("npcs").find(value=>value.type===type);ge("startBattle")(npc);ge("advanceBattle")();ge("advanceBattle")();const b=ge("battle");return{domain:b.mons[0].domain,unique:new Set(b.mons.map(mon=>mon.id)).size};},domain);
    await page.waitForFunction(expected=>{const a=window.DatamonBattleArena.getDiagnostics(),d=window.DatamonBattlePresentation.getDiagnostics();return a.activeDomain===expected.domain&&a.inFlightArenaCount===0&&d.loadedSheetCount===expected.unique&&d.inFlightSheetCount===0;},started,{timeout:10000});
    const metrics=await page.evaluate(()=>{const a=window.DatamonBattleArena.getDiagnostics(),d=window.DatamonBattlePresentation.getDiagnostics();return{
      loaded:d.loadedSheetCount,active:d.activeSheetCount,battlemonFallbackDecodedBytes:d.fallbackDecodedBytes,
      presentationDecodedMiB:(a.residentDecodedBytes+a.fallbackDecodedBytes+d.loadedSheetDecodedBytes+d.fallbackDecodedBytes)/1024/1024,
    };});
    encounters.push({...started,...metrics});
    await page.evaluate(()=>{const ge=(0,eval);ge("battle = null");ge('state = "overworld"');});
  }
  return{encounters,requested:encounters.reduce((sum,item)=>sum+item.unique,0),
    maxPresentationDecodedMiB:Math.max(...encounters.map(item=>item.presentationDecodedMiB))};
}

async function sceneMetrics(page, scene) {
  const frameBefore = await page.evaluate(() => (0, eval)("frame"));
  const timing = await frameSample(page);
  const frameAfter = await page.evaluate(() => (0, eval)("frame"));
  const movedTo = await moveOnce(page, "w");
  const caches = await page.evaluate(() => {
    const ge = (0, eval);
    const values = [ge("officeMapCv"), ge("libraryMapCv"), ge("battleRoomMapCv")].filter(Boolean);
    return {
      count: values.length,
      mib: values.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0) / 1024 / 1024,
      dimensions: values.map(canvas => [canvas.width, canvas.height, canvas.detailScale]),
    };
  });
  return { scene, timing, loopAdvanced: frameAfter > frameBefore, movedTo, caches };
}

const server = await startServer();
let browser;
const runs = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const config of MATRIX) {
    const context = await browser.newContext({ viewport: { width: 1407, height: 853 }, deviceScaleFactor: config.dpr });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: config.cpu });
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
    page.on("console", message => { if (["error", "assert"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
    page.on("request", request => requests.push(new URL(request.url()).pathname));
    page.on("requestfailed", request => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ""}`));
    page.on("response", response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
    await page.addInitScript(() => localStorage.clear());
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      try { return (0, eval)("state") === "title" && (0, eval)("officeMapCv") !== null; }
      catch (_) { return false; }
    }, null, { timeout: 15000 });
    await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0, eval)("state") === "dialogue");
    const dialogue = await dialogueMetrics(page);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => (0, eval)("state") === "overworld");

    const scenes = [await sceneMetrics(page, "office")];
    const seatedHandoff = await seatedHandoffMetrics(page);
    const certificationConsole = await consoleMetrics(page);
    const mentorReview = await mentorMetrics(page);
    await page.evaluate(() => (0, eval)("enterLibrary")());
    await page.waitForFunction(() => (0, eval)("currentMap") === "library", null, { timeout: 15000 });
    scenes.push(await sceneMetrics(page, "library"));
    await page.evaluate(() => (0, eval)("returnToOffice")());
    await page.evaluate(() => (0, eval)("enterBattleRoom")());
    await page.waitForFunction(() => (0, eval)("currentMap") === "battleRoom", null, { timeout: 15000 });
    scenes.push(await sceneMetrics(page, "battleRoom"));
    const classicBattle = await classicBattleMetrics(page);
    const classicSequence = await sequentialClassicCacheMetrics(page, classicBattle.domain);

    const architectureRequests = requests.filter(value => value.includes("/environment/accepted/batch-architecture/"));
    const duplicateArchitectureRequests = [...new Set(architectureRequests)].filter(value => architectureRequests.filter(item => item === value).length > 1);
    const studyRequests = requests.filter(value => value.startsWith("/props-study/") || value.startsWith("/sprites-sit/"));
    const duplicateStudyRequests = [...new Set(studyRequests)].filter(value => studyRequests.filter(item => item === value).length > 1);
    const idleRequests = requests.filter(value => value.startsWith("/sprites-idle/"));
    const duplicateIdleRequests = [...new Set(idleRequests)].filter(value => idleRequests.filter(item => item === value).length > 1);
    const wayfindingRequests = requests.filter(value => value.startsWith("/props-wayfinding/"));
    const duplicateWayfindingRequests = [...new Set(wayfindingRequests)].filter(value => wayfindingRequests.filter(item => item === value).length > 1);
    const battlemonRequests = requests.filter(value => value.startsWith("/battlemons/"));
    const duplicateBattlemonRequests = [...new Set(battlemonRequests)].filter(value => battlemonRequests.filter(item => item === value).length > 1);
    const battleArenaRequests = requests.filter(value => value.startsWith("/battle-arenas/"));
    const duplicateBattleArenaRequests = [...new Set(battleArenaRequests)].filter(value => battleArenaRequests.filter(item => item === value).length > 1);
    const run = { ...config, scenes, dialogue, seatedHandoff, certificationConsole, mentorReview, classicBattle, classicSequence, errors, requestCount: requests.length,
      architectureRequests, duplicateArchitectureRequests, studyRequests, duplicateStudyRequests,
      idleRequests, duplicateIdleRequests,
      wayfindingRequests, duplicateWayfindingRequests, battlemonRequests, duplicateBattlemonRequests,
      battleArenaRequests, duplicateBattleArenaRequests };
    runs.push(run);
    console.log(`DPR${config.dpr} CPU${config.cpu}x: ` + scenes.map(item => `${item.scene} p95=${item.timing.p95.toFixed(1)}ms cache=${item.caches.mib.toFixed(1)}MiB`).join(" | ") +
      ` | dialogue p95=${dialogue.timing.p95.toFixed(1)}ms` +
      ` | handoff p95=${seatedHandoff.timing.p95.toFixed(1)}ms` +
      ` | console p95=${certificationConsole.timing.p95.toFixed(1)}ms` +
      ` | mentor p95=${mentorReview.timing.p95.toFixed(1)}ms` +
      ` | classic p95=${classicBattle.timing.p95.toFixed(1)}ms first=${classicBattle.firstAuthoredPaintMs.toFixed(1)}ms cache=${classicBattle.presentationDecodedMiB.toFixed(1)}MiB seqMax=${classicSequence.maxPresentationDecodedMiB.toFixed(1)}MiB`);
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}

const violations = [];
for (const run of runs) {
  if (run.errors.length) violations.push(`DPR${run.dpr}/CPU${run.cpu}: ${run.errors.join("; ")}`);
  if (run.duplicateArchitectureRequests.length) violations.push(`DPR${run.dpr}/CPU${run.cpu}: duplicate architecture requests ${run.duplicateArchitectureRequests.join(", ")}`);
  if (run.duplicateStudyRequests.length) violations.push(`DPR${run.dpr}/CPU${run.cpu}: duplicate study requests ${run.duplicateStudyRequests.join(", ")}`);
  if (run.duplicateIdleRequests.length) violations.push(`DPR${run.dpr}/CPU${run.cpu}: duplicate idle requests ${run.duplicateIdleRequests.join(", ")}`);
  if (run.duplicateWayfindingRequests.length) violations.push(`DPR${run.dpr}/CPU${run.cpu}: duplicate wayfinding requests ${run.duplicateWayfindingRequests.join(", ")}`);
  if (run.duplicateBattlemonRequests.length) violations.push(`DPR${run.dpr}/CPU${run.cpu}: duplicate Battlemon requests ${run.duplicateBattlemonRequests.join(", ")}`);
  if (run.duplicateBattleArenaRequests.length) violations.push(`DPR${run.dpr}/CPU${run.cpu}: duplicate battle arena requests ${run.duplicateBattleArenaRequests.join(", ")}`);
  if (run.idleRequests.length < 5 || run.idleRequests.length > 41) violations.push(`DPR${run.dpr}/CPU${run.cpu}: expected 5..41 idle manifest/image requests, got ${run.idleRequests.length}`);
  if (run.wayfindingRequests.length !== 10) violations.push(`DPR${run.dpr}/CPU${run.cpu}: expected 10 wayfinding requests, got ${run.wayfindingRequests.length}`);
  const expectedBattlemonRequests=1+run.classicBattle.requested+run.classicSequence.requested;
  if (run.battlemonRequests.length !== expectedBattlemonRequests) violations.push(`DPR${run.dpr}/CPU${run.cpu}: expected ${expectedBattlemonRequests} Battlemon manifest/sheet requests, got ${run.battlemonRequests.length}`);
  const expectedArenaRequests=1+1+run.classicSequence.encounters.length;
  if (run.battleArenaRequests.length !== expectedArenaRequests) violations.push(`DPR${run.dpr}/CPU${run.cpu}: expected ${expectedArenaRequests} arena manifest/background requests, got ${run.battleArenaRequests.length}`);
  const consoleBudget = run.cpu === 1 ? NORMAL_FRAME_P95_BUDGET_MS : STRESS_FRAME_P95_BUDGET_MS;
  if (!run.dialogue.loopAdvanced || !run.dialogue.stayedOpen || run.dialogue.script !== "certification-prologue-v1") violations.push(`DPR${run.dpr}/CPU${run.cpu}/dialogue: lifecycle failed`);
  if (run.dialogue.timing.p95 > consoleBudget) violations.push(`DPR${run.dpr}/CPU${run.cpu}/dialogue: frame p95 ${run.dialogue.timing.p95.toFixed(2)} ms > ${consoleBudget}`);
  if (!run.seatedHandoff.loopAdvanced || !run.seatedHandoff.converged || !run.seatedHandoff.facing || !run.seatedHandoff.cleaned || run.seatedHandoff.resident > 1) violations.push(`DPR${run.dpr}/CPU${run.cpu}/handoff: lifecycle/facing bound failed`);
  if (run.seatedHandoff.timing.p95 > consoleBudget) violations.push(`DPR${run.dpr}/CPU${run.cpu}/handoff: frame p95 ${run.seatedHandoff.timing.p95.toFixed(2)} ms > ${consoleBudget}`);
  if (!run.certificationConsole.loopAdvanced) violations.push(`DPR${run.dpr}/CPU${run.cpu}/console: game loop stopped`);
  if (!run.certificationConsole.summaryCacheStable) violations.push(`DPR${run.dpr}/CPU${run.cpu}/console: evidence summary cache churned`);
  if (run.certificationConsole.timing.p95 > consoleBudget) violations.push(`DPR${run.dpr}/CPU${run.cpu}/console: frame p95 ${run.certificationConsole.timing.p95.toFixed(2)} ms > ${consoleBudget}`);
  if (!run.mentorReview.opened || !run.mentorReview.closed) violations.push(`DPR${run.dpr}/CPU${run.cpu}/mentor: modal lifecycle failed`);
  if (!run.mentorReview.loopAdvanced) violations.push(`DPR${run.dpr}/CPU${run.cpu}/mentor: game loop stopped`);
  if (run.mentorReview.timing.p95 > consoleBudget) violations.push(`DPR${run.dpr}/CPU${run.cpu}/mentor: frame p95 ${run.mentorReview.timing.p95.toFixed(2)} ms > ${consoleBudget}`);
  if (!run.classicBattle.loopAdvanced || !run.classicBattle.stayedInteractive || run.classicBattle.inFlight !== 0 ||
      run.classicBattle.loaded < run.classicBattle.requested || run.classicBattle.arena !== run.classicBattle.domain ||
      run.classicBattle.resident !== 1 || run.classicBattle.arenaInFlight !== 0) violations.push(`DPR${run.dpr}/CPU${run.cpu}/classic: lifecycle/lazy-load/arena bound failed`);
  if (run.classicBattle.timing.p95 > consoleBudget) violations.push(`DPR${run.dpr}/CPU${run.cpu}/classic: frame p95 ${run.classicBattle.timing.p95.toFixed(2)} ms > ${consoleBudget}`);
  if (run.classicBattle.firstAuthoredPaintMs > CLASSIC_FIRST_AUTHORED_PAINT_BUDGET_MS) violations.push(`DPR${run.dpr}/CPU${run.cpu}/classic: first authored paint ${run.classicBattle.firstAuthoredPaintMs.toFixed(2)} ms > ${CLASSIC_FIRST_AUTHORED_PAINT_BUDGET_MS}`);
  if (run.classicBattle.presentationDecodedMiB > BATTLE_PRESENTATION_BUDGET_MIB) violations.push(`DPR${run.dpr}/CPU${run.cpu}/classic: decoded presentation ${run.classicBattle.presentationDecodedMiB.toFixed(2)} MiB > ${BATTLE_PRESENTATION_BUDGET_MIB}`);
  for(const encounter of run.classicSequence.encounters){
    if(encounter.loaded!==encounter.unique||encounter.active!==encounter.unique||encounter.battlemonFallbackDecodedBytes!==0)violations.push(`DPR${run.dpr}/CPU${run.cpu}/classic-sequence-${encounter.domain}: current-encounter residency failed`);
    if(encounter.presentationDecodedMiB>BATTLE_PRESENTATION_BUDGET_MIB)violations.push(`DPR${run.dpr}/CPU${run.cpu}/classic-sequence-${encounter.domain}: decoded presentation ${encounter.presentationDecodedMiB.toFixed(2)} MiB > ${BATTLE_PRESENTATION_BUDGET_MIB}`);
  }
  for (const scene of run.scenes) {
    if (!scene.loopAdvanced) violations.push(`DPR${run.dpr}/CPU${run.cpu}/${scene.scene}: game loop stopped`);
    if (scene.timing.samples < 5) violations.push(`DPR${run.dpr}/CPU${run.cpu}/${scene.scene}: insufficient frame samples`);
    if (scene.caches.count > 2) violations.push(`DPR${run.dpr}/CPU${run.cpu}/${scene.scene}: ${scene.caches.count} map caches resident`);
    if (scene.caches.mib > CACHE_BUDGET_MIB) violations.push(`DPR${run.dpr}/CPU${run.cpu}/${scene.scene}: ${scene.caches.mib.toFixed(2)} MiB > ${CACHE_BUDGET_MIB}`);
    const frameBudget = run.cpu === 1 ? NORMAL_FRAME_P95_BUDGET_MS : STRESS_FRAME_P95_BUDGET_MS;
    if (scene.timing.p95 > frameBudget) violations.push(`DPR${run.dpr}/CPU${run.cpu}/${scene.scene}: frame p95 ${scene.timing.p95.toFixed(2)} ms > ${frameBudget}`);
  }
}
const summary = {
  generatedAt: new Date().toISOString(),
  cacheBudgetMiB: CACHE_BUDGET_MIB,
  battlePresentationBudgetMiB: BATTLE_PRESENTATION_BUDGET_MIB,
  classicFirstAuthoredPaintBudgetMs: CLASSIC_FIRST_AUTHORED_PAINT_BUDGET_MS,
  normalFrameP95BudgetMs: NORMAL_FRAME_P95_BUDGET_MS,
  stressFrameP95BudgetMs: STRESS_FRAME_P95_BUDGET_MS,
  matrix: MATRIX,
  runs,
  normalDpr2: (() => {
    const run = runs.find(item => item.dpr === 2 && item.cpu === 1);
    return {
      ...Object.fromEntries(run.scenes.map(scene => [scene.scene, { p95: scene.timing.p95, max: scene.timing.max, cacheMiB: scene.caches.mib }])),
      certificationConsole: { p95: run.certificationConsole.timing.p95, max: run.certificationConsole.timing.max },
      mentorReview: { p95: run.mentorReview.timing.p95, max: run.mentorReview.timing.max },
      classicBattle: { p95: run.classicBattle.timing.p95, max: run.classicBattle.timing.max,
        firstAuthoredPaintMs: run.classicBattle.firstAuthoredPaintMs,
        presentationDecodedMiB: run.classicBattle.presentationDecodedMiB,
        sequentialMaxPresentationDecodedMiB: run.classicSequence.maxPresentationDecodedMiB },
    };
  })(),
  allFrameP95: percentile(runs.flatMap(run => [run.certificationConsole.timing.p95, run.mentorReview.timing.p95, run.classicBattle.timing.p95, ...run.scenes.map(scene => scene.timing.p95)]), 0.95),
};
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(summary, null, 2) + "\n");
if (violations.length) {
  console.error("World performance contract failed:\n- " + violations.join("\n- "));
  process.exit(1);
}
console.log(`World performance contract passed (${runs.length} device/CPU configurations).`);
