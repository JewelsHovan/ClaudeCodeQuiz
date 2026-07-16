#!/usr/bin/env node

// Verify DATAMON's intentional public-release contract:
//   1. an unauthenticated client must receive the public HTML with HTTP 200;
//   2. metadata and runtime bytes must match the exact deployed artifact;
//   3. the actual public page must boot and accept immediate one-tap movement.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const DIST = path.resolve(import.meta.dirname, "..", "dist");
const RUNTIME_FILES = [
  "index.html", "state.js", "battle-ops.js", "agent-arena.js", "questions.js",
  "world-art.js", "music.js", "game.js",
];

const baseUrl = process.argv[2];
const expectedCommit = process.argv[3] || null;
if (!baseUrl) throw new Error("Usage: node scripts/smoke-remote.mjs <url> [expected-commit]");
const url = new URL(baseUrl).href;
async function verifyPublicBoundary() {
  const response = await fetch(url, { redirect: "manual", cache: "no-store" });
  const type = response.headers.get("content-type") || "";
  if (response.status !== 200 || !type.includes("text/html")) {
    const location = response.headers.get("location") || "";
    throw new Error(`PUBLIC ACCESS: unauthenticated ${url} returned HTTP ${response.status} ${type || "unknown content type"}${location ? ` → ${location}` : ""}`);
  }
  console.log(`Public boundary passed: unauthenticated HTTP 200 (${type})`);
}

async function fetchMetadata() {
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const response = await fetch(new URL("artifact-metadata.json", url), { cache: "no-store" });
      if (!response.ok) throw new Error(`public metadata HTTP ${response.status}`);
      const type = response.headers.get("content-type") || "";
      if (!type.includes("json")) throw new Error(`public metadata returned ${type || "unknown content type"}`);
      const metadata = await response.json();
      if (expectedCommit && metadata.commit !== expectedCommit) {
        throw new Error(`remote commit ${metadata.commit} != ${expectedCommit}`);
      }
      return metadata;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function verifyRuntimeBytes(metadata) {
  for (const file of RUNTIME_FILES) {
    if (!fs.existsSync(path.join(DIST, file))) throw new Error(`checked artifact is missing dist/${file}`);
  }
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      for (const file of RUNTIME_FILES) {
        const remoteUrl = new URL(file, url);
        // A unique probe avoids one edge response masking convergence elsewhere.
        remoteUrl.searchParams.set("artifact", `${metadata.payloadSha256}-${attempt}`);
        const response = await fetch(remoteUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`public runtime ${file} returned HTTP ${response.status}`);
        const remote = Buffer.from(await response.arrayBuffer());
        const local = fs.readFileSync(path.join(DIST, file));
        if (!remote.equals(local)) throw new Error(`public runtime ${file} does not match checked dist/${file}`);
      }
      console.log(`Runtime bytes passed: ${RUNTIME_FILES.length} public files match checked dist/`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 8) await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

await verifyPublicBoundary();
const metadata = await fetchMetadata();
await verifyRuntimeBytes(metadata);
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  // Match a Retina desktop viewport: DPR2 activates accepted HD detail entities and
  // guards the production-only depth-sort/render path as well as ordinary movement.
  const page = await browser.newPage({
    viewport: { width: 1407, height: 853 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => {
    if (["error", "assert"].includes(message.type())) errors.push(`console.${message.type()}: ${message.text()}`);
  });
  page.on("requestfailed", request => errors.push(`requestfailed: ${request.url()}`));
  page.on("response", response => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error(`public root HTTP ${response?.status()}`);
  await page.waitForFunction(() => {
    try { return eval("state") === "title"; } catch (_) { return false; }
  }, null, { timeout: 15000 });

  // Use quick presses, not held keys: this guards the real tap path that regressed.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    try { return eval("state") === "overworld"; } catch (_) { return false; }
  }, null, { timeout: 15000 });
  const start = await page.evaluate(() => {
    const current = eval("player");
    return { x: current.x, y: current.y };
  });
  const movementPath = [
    ["w", { x: start.x, y: start.y - 1 }],
    ["a", { x: start.x - 1, y: start.y - 1 }],
    ["s", { x: start.x - 1, y: start.y }],
    ["d", start],
  ];
  for (const [key, expected] of movementPath) {
    await page.keyboard.press(key);
    await page.waitForFunction(target => {
      try {
        const current = eval("player");
        return !current.moving && current.x === target.x && current.y === target.y;
      } catch (_) { return false; }
    }, expected, { timeout: 5000 });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Public movement passed: W/A/S/D quick taps returned to (${start.x}, ${start.y})`);
} finally {
  await browser.close();
}
console.log(`Public smoke passed: ${url} commit=${metadata.commitShort} payload=${metadata.payloadSha256}`);
