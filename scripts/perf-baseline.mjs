#!/usr/bin/env node

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const OUTPUT = path.join(ROOT, "test-results", "performance.json");
const BUDGETS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "performance-budgets.json"), "utf8"));
const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 3;
const PORT = 8745;
const URL = `http://127.0.0.1:${PORT}/`;

if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error("--runs must be a positive integer");
if (!fs.existsSync(path.join(DIST, "artifact-metadata.json"))) throw new Error("Missing packaged artifact; run `just package`");

async function startServer() {
  const child = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: DIST,
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error(`Artifact server exited with ${child.exitCode}`);
    try {
      const response = await fetch(URL);
      if (response.ok) return child;
    } catch (_) { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error("Artifact server did not become ready");
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

const server = await startServer();
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });
  for (let run = 1; run <= RUNS; run++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
    const page = await context.newPage();
    const requests = [];
    const failures = [];
    page.on("request", request => requests.push({ url: request.url(), size: 0, status: null }));
    page.on("requestfailed", request => failures.push(`${request.url()}: ${request.failure()?.errorText || "failed"}`));
    page.on("response", response => {
      const request = [...requests].reverse().find(item => item.url === response.url() && item.status === null);
      if (!request) return;
      request.status = response.status();
      request.size = Number(response.headers()["content-length"] || 0);
      if (response.status() >= 400) failures.push(`${response.url()}: HTTP ${response.status()}`);
    });

    const started = performance.now();
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      try { return eval("state") === "title"; } catch (_) { return false; }
    }, { timeout: BUDGETS.coldTitleMs });
    const coldTitleMs = performance.now() - started;
    const runtime = await page.evaluate(() => {
      try {
        const animation = eval("walkAnim");
        return {
          state: eval("state"),
          residentWalkSlugs: Object.keys(animation).length,
          residentWalkFrames: Object.values(animation).reduce(
            (sum, dirs) => sum + Object.values(dirs).flat().filter(Boolean).length,
            0,
          ),
        };
      } catch (error) {
        return { state: null, residentWalkSlugs: -1, residentWalkFrames: -1, error: String(error) };
      }
    });
    const result = {
      run,
      coldTitleMs: Math.round(coldTitleMs),
      requestCount: requests.length,
      transferBytes: requests.reduce((sum, request) => sum + request.size, 0),
      failedRequests: failures,
      ...runtime,
    };
    results.push(result);
    console.log(`Run ${run}: ${result.coldTitleMs}ms, ${result.requestCount} requests, ${result.transferBytes} bytes, ${result.residentWalkSlugs} walk slugs`);
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}

const summary = {
  generatedAt: new Date().toISOString(),
  budgets: BUDGETS,
  runs: results,
  p90: {
    coldTitleMs: percentile(results.map(result => result.coldTitleMs), 0.9),
    requestCount: percentile(results.map(result => result.requestCount), 0.9),
    transferBytes: percentile(results.map(result => result.transferBytes), 0.9),
  },
};
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(summary, null, 2) + "\n");

const violations = [];
for (const result of results) {
  if (result.state !== "title") violations.push(`run ${result.run}: state=${result.state}`);
  if (result.failedRequests.length) violations.push(`run ${result.run}: ${result.failedRequests.join(", ")}`);
  for (const key of ["coldTitleMs", "requestCount", "transferBytes", "residentWalkSlugs", "residentWalkFrames"]) {
    if (result[key] > BUDGETS[key]) violations.push(`run ${result.run}: ${key} ${result[key]} > ${BUDGETS[key]}`);
  }
}
if (violations.length) {
  console.error("Performance contract failed:\n- " + violations.join("\n- "));
  process.exit(1);
}
console.log(`Performance contract passed (${RUNS} cold runs).`);
