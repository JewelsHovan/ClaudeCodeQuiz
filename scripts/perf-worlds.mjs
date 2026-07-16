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
    await page.waitForFunction(() => (0, eval)("state") === "overworld");

    const scenes = [await sceneMetrics(page, "office")];
    await page.evaluate(() => (0, eval)("enterLibrary")());
    await page.waitForFunction(() => (0, eval)("currentMap") === "library", null, { timeout: 15000 });
    scenes.push(await sceneMetrics(page, "library"));
    await page.evaluate(() => (0, eval)("returnToOffice")());
    await page.evaluate(() => (0, eval)("enterBattleRoom")());
    await page.waitForFunction(() => (0, eval)("currentMap") === "battleRoom", null, { timeout: 15000 });
    scenes.push(await sceneMetrics(page, "battleRoom"));

    const architectureRequests = requests.filter(value => value.includes("/environment/accepted/batch-architecture/"));
    const duplicateArchitectureRequests = [...new Set(architectureRequests)].filter(value => architectureRequests.filter(item => item === value).length > 1);
    const run = { ...config, scenes, errors, requestCount: requests.length, architectureRequests, duplicateArchitectureRequests };
    runs.push(run);
    console.log(`DPR${config.dpr} CPU${config.cpu}x: ` + scenes.map(item => `${item.scene} p95=${item.timing.p95.toFixed(1)}ms cache=${item.caches.mib.toFixed(1)}MiB`).join(" | "));
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
  normalFrameP95BudgetMs: NORMAL_FRAME_P95_BUDGET_MS,
  stressFrameP95BudgetMs: STRESS_FRAME_P95_BUDGET_MS,
  matrix: MATRIX,
  runs,
  normalDpr2: (() => {
    const run = runs.find(item => item.dpr === 2 && item.cpu === 1);
    return Object.fromEntries(run.scenes.map(scene => [scene.scene, { p95: scene.timing.p95, max: scene.timing.max, cacheMiB: scene.caches.mib }]));
  })(),
  allFrameP95: percentile(runs.flatMap(run => run.scenes.map(scene => scene.timing.p95)), 0.95),
};
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(summary, null, 2) + "\n");
if (violations.length) {
  console.error("World performance contract failed:\n- " + violations.join("\n- "));
  process.exit(1);
}
console.log(`World performance contract passed (${runs.length} device/CPU configurations).`);
