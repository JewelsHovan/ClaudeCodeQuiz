#!/usr/bin/env node

import { chromium } from "playwright";

const baseUrl = process.argv[2];
const expectedCommit = process.argv[3] || null;
if (!baseUrl) throw new Error("Usage: node scripts/smoke-remote.mjs <url> [expected-commit]");
const url = new URL(baseUrl).href;

async function fetchMetadata() {
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const response = await fetch(new URL("artifact-metadata.json", url), { cache: "no-store" });
      if (!response.ok) throw new Error(`metadata HTTP ${response.status}`);
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
  if (!response?.ok()) throw new Error(`root HTTP ${response?.status()}`);
  await page.waitForFunction(() => {
    try { return eval("state") === "title"; } catch (_) { return false; }
  }, { timeout: 15000 });
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
console.log(`Remote smoke passed: ${url} commit=${metadata.commitShort} payload=${metadata.payloadSha256}`);
