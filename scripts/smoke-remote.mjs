#!/usr/bin/env node

// Verify both sides of the DATAMON security boundary:
//   1. an unauthenticated client must be challenged by Cloudflare Access;
//   2. the configured automation service token must reach the exact deployed artifact.

import { chromium } from "playwright";

const baseUrl = process.argv[2];
const expectedCommit = process.argv[3] || null;
if (!baseUrl) throw new Error("Usage: node scripts/smoke-remote.mjs <url> [expected-commit]");
const url = new URL(baseUrl).href;
const clientId = process.env.CF_ACCESS_CLIENT_ID;
const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  throw new Error("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required for internal DATAMON smoke tests");
}
const accessHeaders = {
  "CF-Access-Client-Id": clientId,
  "CF-Access-Client-Secret": clientSecret,
};

async function verifyUnauthenticatedBoundary() {
  const response = await fetch(url, { redirect: "manual", cache: "no-store" });
  const location = response.headers.get("location") || "";
  const challenged = [301, 302, 303, 307, 308, 401, 403].includes(response.status) &&
    (response.status === 401 || response.status === 403 || /cloudflareaccess|cdn-cgi\/access/i.test(location));
  if (!challenged) {
    throw new Error(`SECURITY: unauthenticated ${url} returned HTTP ${response.status} instead of a Cloudflare Access challenge`);
  }
  console.log(`Access boundary passed: unauthenticated HTTP ${response.status}`);
}

async function fetchMetadata() {
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const response = await fetch(new URL("artifact-metadata.json", url), {
        cache: "no-store",
        headers: accessHeaders,
      });
      if (!response.ok) throw new Error(`authenticated metadata HTTP ${response.status}`);
      const type = response.headers.get("content-type") || "";
      if (!type.includes("json")) throw new Error(`authenticated metadata returned ${type || "unknown content type"}`);
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

await verifyUnauthenticatedBoundary();
const metadata = await fetchMetadata();
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 960 },
    extraHTTPHeaders: accessHeaders,
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
  if (!response?.ok()) throw new Error(`authenticated root HTTP ${response?.status()}`);
  await page.waitForFunction(() => {
    try { return eval("state") === "title"; } catch (_) { return false; }
  }, { timeout: 15000 });
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
console.log(`Authenticated smoke passed: ${url} commit=${metadata.commitShort} payload=${metadata.payloadSha256}`);
