#!/usr/bin/env node

// Verify DATAMON's intentional public-release contract:
//   1. an unauthenticated client must receive the public HTML with HTTP 200;
//   2. metadata and the title screen must match the exact deployed artifact.

import { chromium } from "playwright";

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

await verifyPublicBoundary();
const metadata = await fetchMetadata();
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
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
  }, { timeout: 15000 });
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
console.log(`Public smoke passed: ${url} commit=${metadata.commitShort} payload=${metadata.payloadSha256}`);
