#!/usr/bin/env node
// Read-only browser audit of dist/. Does not alter gameplay files or real user saves.
// Run after npm run package. Timing is local Chromium evidence, not production RUM.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const OUTPUT = path.join(ROOT, "test-results", "performance-audit.json");
const PORT = 8747, URL = `http://127.0.0.1:${PORT}/`;
const metadata = JSON.parse(fs.readFileSync(path.join(DIST, "artifact-metadata.json"), "utf8"));
const configs = [
  { name: "desktop-local", dpr: 1, cpu: 1 },
  { name: "retina-local", dpr: 2, cpu: 1 },
  { name: "mobile-simulated", dpr: 2, cpu: 4, mobile: true, mbps: 1.6, latency: 150 },
];
const results = { generatedAt: new Date().toISOString(), metadata, cold: [], runtime: [] };
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: DIST, stdio: "ignore" });
let browser;

function instrument() {
  performance.setResourceTimingBufferSize(5000);
  window.__audit = { firstFrame: null, frames: [], longTasks: [] };
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) window.__audit.longTasks.push({ start: e.startTime, duration: e.duration });
  }).observe({ type: "longtask", buffered: true });
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function(callback) {
    if (callback.name !== "loop") return raf.call(window, callback);
    return raf.call(window, function(t) {
      const start = performance.now();
      callback(t);
      const end = performance.now(), a = window.__audit;
      if (a.firstFrame === null) a.firstFrame = end;
      a.frames.push({ t, work: end - start });
      if (a.frames.length > 3000) a.frames.shift();
    });
  };
}
async function open(config) {
  const context = await browser.newContext({
    viewport: config.mobile ? { width: 390, height: 844 } : { width: 1407, height: 853 },
    deviceScaleFactor: config.dpr, isMobile: !!config.mobile, hasTouch: !!config.mobile,
  });
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: config.cpu });
  if (config.mbps) await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: config.latency,
    downloadThroughput: config.mbps * 1e6 / 8, uploadThroughput: 750000 / 8,
  });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("requestfailed", r => errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  page.on("response", r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(instrument);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { try { return (0, eval)("state") === "title"; } catch { return false; } });
  const stateObservedMs = await page.evaluate(() => performance.now());
  await page.waitForFunction(() => window.__audit.firstFrame !== null, null, { timeout: 90000 });
  return { context, page, cdp, errors, stateObservedMs };
}
async function resources(page) {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType("resource").map(e => ({
      path: new URL(e.name).pathname, start: e.startTime, end: e.responseEnd,
      encodedBytes: e.encodedBodySize, transferBytes: e.transferSize,
    }));
    const groups = {};
    for (const e of entries) {
      const key = e.path.split("/")[1];
      groups[key] ||= { count: 0, encodedBytes: 0, transferBytes: 0 };
      groups[key].count++; groups[key].encodedBytes += e.encodedBytes; groups[key].transferBytes += e.transferBytes;
    }
    return { count: entries.length, encodedBytes: entries.reduce((n,e) => n + e.encodedBytes, 0),
      transferBytes: entries.reduce((n,e) => n + e.transferBytes, 0), groups,
      slowest: entries.sort((a,b) => (b.end-b.start)-(a.end-a.start)).slice(0, 10) };
  });
}
async function inventory(page, cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage");
  const memory = await page.evaluate(() => {
    const ge = (0, eval), seen = new Set(), groups = {};
    function visit(v, group) {
      if (!v || typeof v !== "object" || seen.has(v)) return;
      seen.add(v);
      if (v instanceof HTMLCanvasElement || v instanceof HTMLImageElement) {
        const width = v instanceof HTMLImageElement ? v.naturalWidth : v.width;
        const height = v instanceof HTMLImageElement ? v.naturalHeight : v.height;
        groups[group] ||= { count: 0, rgbaBytes: 0 };
        groups[group].count++; groups[group].rgbaBytes += width * height * 4;
      } else if (v instanceof Map) { for (const value of v.values()) visit(value, group); }
      else if (v instanceof Promise || v instanceof Set) { /* no promise internals */ }
      else { for (const value of Object.values(v)) visit(value, group); }
    }
    for (const name of ["canvas", "officeMapCv", "libraryMapCv", "battleRoomMapCv", "floorTex", "sprites", "tileStore",
      "propStore", "studyPropStore", "wayfindingStore", "libStore", "walkAnim", "locomotionPilot", "idleImageState",
      "_sittingAssetStore", "pixelCache", "miniCache", "walkMiniCache", "monCache"]) visit(ge(name), name);
    for (const slug of ge("ROSTER")) visit(DatamonWorldArt.getPortrait(slug), "portraits");
    for (const scene of ["office", "library", "battleRoom"]) {
      for (const entry of DatamonWorldArt.entriesForScene(scene)) visit(DatamonWorldArt.getHDAsset(entry.slug, entry.kind, scene)?.image, "hdImages");
    }
    return { groups, explicitRgbaMiB: Object.values(groups).reduce((n,g) => n+g.rgbaBytes, 0)/1048576,
      walkSlugs: Object.keys(ge("walkAnim")).length, idleRecords: ge("idleImageState").size,
      world: DatamonWorldArt.getDiagnostics(), audio: DatamonAudio.getDiagnostics(),
      arena: DatamonBattleArena.getDiagnostics(), battlemons: DatamonBattlePresentation.getDiagnostics() };
  });
  return { ...memory, heap };
}
async function sample(page, cdp, label, duration = 3000, action) {
  await page.evaluate(() => { window.__audit.frames = []; window.__audit.longTasks = []; });
  await cdp.send("Performance.enable");
  const before = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  const started = performance.now();
  if (action) await action(); else await page.waitForTimeout(duration);
  const elapsedMs = performance.now() - started;
  const after = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  const timing = await page.evaluate(() => {
    const a = window.__audit;
    function stats(values) {
      const v = values.slice().sort((a,b) => a-b);
      return { count: v.length, median: v[Math.floor(v.length/2)] || 0,
        p95: v[Math.max(0,Math.ceil(v.length*.95)-1)] || 0, max: v.at(-1) || 0,
        over16_7: v.filter(n => n>16.7).length, over33_4: v.filter(n => n>33.4).length };
    }
    return { intervals: stats(a.frames.slice(1).map((f,i) => f.t-a.frames[i].t)),
      callbackWork: stats(a.frames.map(f => f.work)), longTasks: a.longTasks,
      state: (0, eval)("state"), map: (0, eval)("currentMap"), hub: DatamonQuestionHub.isOpen() };
  });
  const cpu = {};
  for (const key of ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration"]) cpu[key + "Ms"] = (after[key]-before[key])*1000;
  console.log(`${label}: work p95=${timing.callbackWork.p95.toFixed(1)}ms, interval p95=${timing.intervals.p95.toFixed(1)}ms`);
  return { label, elapsedMs, ...timing, cpu };
}
async function warp(page, destination) {
  const start = performance.now();
  await page.evaluate(dest => { const ge = (0,eval); if (ge("currentMap") !== "office") ge("returnToOffice")(); ge(dest === "library" ? "enterLibrary" : "enterBattleRoom")(); }, destination);
  await page.waitForFunction(dest => (0,eval)("currentMap") === dest, destination);
  return { destination, elapsedMs: performance.now()-start };
}
try {
  let ready = false;
  for (let i=0;i<50;i++) {
    if (server.exitCode !== null) throw new Error("Audit server exited; port may be occupied");
    try { if ((await fetch(URL)).ok) { ready=true; break; } } catch { /* starting */ }
    await new Promise(r => setTimeout(r,100));
  }
  if (!ready) throw new Error("Audit server did not become ready");
  browser = await chromium.launch({ headless: true });
  results.browser = browser.version();
  for (const config of configs) for (let run=1;run<=3;run++) {
    const { context, page, errors, stateObservedMs } = await open(config);
    try {
      await page.waitForLoadState("networkidle", { timeout: 90000 });
      const metrics = await page.evaluate(() => ({ firstGameFrameMs: window.__audit.firstFrame,
        navigation: performance.getEntriesByType("navigation")[0].toJSON(),
        longTasks: window.__audit.longTasks,
        walkSlugs: Object.keys((0, eval)("walkAnim")).length,
      }));
      results.cold.push({ config, run, stateObservedMs, ...metrics, resources: await resources(page), errors: [...errors] });
      console.log(`${config.name} run ${run}: state=${stateObservedMs.toFixed(0)}ms actual first draw=${metrics.firstGameFrameMs.toFixed(0)}ms`);
    } finally { await context.close(); }
  }
  for (const cpu of [1,8]) {
    const config = { name: `runtime-dpr2-cpu${cpu}`, dpr: 2, cpu };
    const { context, page, cdp, errors } = await open(config);
    const run = { config, samples: [], memory: {}, warps: [] };
    try {
      run.samples.push(await sample(page, cdp, "title"));
      run.memory.title = await inventory(page, cdp);
      await page.keyboard.press("Enter"); await page.waitForLoadState("networkidle");
      run.samples.push(await sample(page, cdp, "select"));
      run.memory.select = await inventory(page, cdp);
      if (cpu === 1) {
        const before = await resources(page);
        // Real selection path; all prefetched slugs remain subject to normal loader behavior.
        const rosterSize = await page.evaluate(() => (0,eval)("ROSTER").length);
        for (let i=1; i<rosterSize; i++) await page.keyboard.press("ArrowRight");
        await page.evaluate(() => Promise.all(Object.values((0,eval)("walkAnimLoads"))));
        await page.waitForLoadState("networkidle");
        const after = await resources(page);
        run.rosterBrowse = { addedRequests: after.count-before.count, addedEncodedBytes: after.encodedBytes-before.encodedBytes };
        run.memory.browsedRoster = await inventory(page, cdp);
        await page.evaluate(() => (0,eval)("setSelect")(0));
      }
      await page.keyboard.press("Enter"); await page.waitForFunction(() => (0,eval)("state") === "dialogue");
      await page.keyboard.press("Escape"); await page.waitForFunction(() => (0,eval)("state") === "overworld");
      await page.waitForLoadState("networkidle");
      run.samples.push(await sample(page, cdp, "office-idle"));
      // Walk a verified unobstructed 5-cell corridor, using normal input/update/render paths.
      const corridor = await page.evaluate(() => {
        const ge=(0,eval),p=ge("player");
        for(let y=2;y<22;y++)for(let x=2;x<30;x++) {
          if ([0,1,2,3,4].every(dx=>ge("walkable")(x+dx,y))) {
            p.x=p.fx=x;p.y=p.fy=y;p.dir="right";p.moving=false;ge("camFx = camFy = null");
            return {x,y};
          }
        }
        throw new Error("No walking corridor");
      });
      run.corridor = corridor;
      run.samples.push(await sample(page, cdp, "office-moving", 0, async () => {
        for (let i=0;i<4;i++) for (const key of ["ArrowRight","ArrowLeft"]) {
          await page.keyboard.down(key); await page.waitForTimeout(620); await page.keyboard.up(key); await page.waitForTimeout(150);
        }
      }));
      await page.keyboard.press("q");
      run.samples.push(await sample(page, cdp, "question-hub-open"));
      await page.keyboard.press("Escape");
      run.warps.push(await warp(page,"library"));
      run.samples.push(await sample(page, cdp, "library"));
      run.memory.library = await inventory(page, cdp);
      run.warps.push(await warp(page,"battleRoom"));
      for (const domain of ["MCP","AGENT"]) {
        await page.evaluate(domain => { const ge=(0,eval); ge("startBattle")(ge("npcs").find(n=>n.type===domain)); if(domain!=="AGENT") {ge("advanceBattle")();ge("advanceBattle")();} }, domain);
        await page.waitForLoadState("networkidle");
        run.samples.push(await sample(page, cdp, `battle-${domain}`));
        if (domain === "AGENT") {
          run.samples.push(await sample(page, cdp, "agent-answer-effects", 0, async () => {
            await page.keyboard.press("1");
            const index = await page.evaluate(() => { const q=(0,eval)("battle.agentOps.question");return q.correct ?? q.a; });
            await page.keyboard.press(String(index+1)); await page.waitForTimeout(1500);
          }));
        }
        run.memory[domain] = await inventory(page, cdp);
        await page.evaluate(() => { const ge=(0,eval); if(ge("battle.agentOps")) ge("_agentDispatch")(ge("battle"),{type:"RUN"}); else {ge("battle = null");ge('state = "overworld"');} });
      }
      if(cpu===1) for(let i=0;i<3;i++) {run.warps.push(await warp(page,"library"));run.warps.push(await warp(page,"battleRoom"));}
      run.memory.end = await inventory(page, cdp);
      run.resources = await resources(page);
      run.errors = [...errors]; results.runtime.push(run);
    } finally { await context.close(); }
  }
} finally {
  if (browser) await browser.close(); server.kill();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2)+"\n");
}
console.log(`Audit evidence: ${path.relative(ROOT,OUTPUT)}`);
if ([...results.cold,...results.runtime].some(run => run.errors?.length)) process.exitCode=1;
