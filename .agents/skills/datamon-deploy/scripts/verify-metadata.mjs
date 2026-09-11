#!/usr/bin/env node

// Read-only supplement to just remote-smoke: compare remote metadata with the
// already-verified local artifact, never with a commit inferred from the server.
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const FIELDS = ["schemaVersion", "branch", "commit", "clean", "payloadSha256", "fileCount", "totalBytes"];

export async function verifyMetadata({ target, expectedCommit, local, fetchImpl = fetch }) {
  assert.match(expectedCommit ?? "", /^[0-9a-f]{40}$/, "Expected a full checked Git commit SHA");
  const url = new URL(target);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.port &&
    url.pathname === "/" && !url.search && !url.hash &&
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)?datamon\.pages\.dev$/.test(url.hostname),
  "Target must be an HTTPS Datamon Pages root URL without credentials");
  assert.ok(local && typeof local === "object", "Missing checked local metadata");
  assert.equal(local.schemaVersion, 1, "Unsupported local metadata schema");
  assert.ok(["main", "dev"].includes(local.branch), "Local artifact must be from main/dev");
  assert.equal(local.commit, expectedCommit, "Local artifact is not the expected checked commit");
  assert.equal(local.clean, true, "Local artifact was packaged from dirty state");
  assert.match(local.payloadSha256 ?? "", /^[0-9a-f]{64}$/, "Invalid local payload SHA");
  assert.ok(Number.isSafeInteger(local.fileCount) && local.fileCount > 0, "Invalid local file count");
  assert.ok(Number.isSafeInteger(local.totalBytes) && local.totalBytes > 0, "Invalid local byte count");
  const aliasBranch = { "datamon.pages.dev": "main", "dev.datamon.pages.dev": "dev" }[url.hostname];
  if (aliasBranch) assert.equal(local.branch, aliasBranch, "Artifact branch does not match target alias");

  const metadataUrl = new URL("artifact-metadata.json", url);
  metadataUrl.searchParams.set("artifact", local.payloadSha256);
  const response = await fetchImpl(metadataUrl, {
    redirect: "manual", cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, 200, `Public metadata HTTP ${response.status}`);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json(?:\s*;|$)/i,
    "Public metadata must be JSON, not a login/challenge page");
  const remote = await response.json();
  for (const field of FIELDS) {
    assert.equal(remote?.[field], local[field], `Remote ${field} differs from checked artifact`);
  }
  return { target: url.href, ...Object.fromEntries(FIELDS.map(field => [field, local[field]])) };
}

if (process.argv[1] && fs.existsSync(process.argv[1]) &&
    fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    assert.equal(process.argv.length, 4,
      "Usage: node verify-metadata.mjs <datamon-pages-url> <full-checked-commit>");
    const local = JSON.parse(fs.readFileSync(new URL("../../../../dist/artifact-metadata.json", import.meta.url), "utf8"));
    const receipt = await verifyMetadata({ target: process.argv[2], expectedCommit: process.argv[3], local });
    console.log(`Public metadata matches checked artifact: ${JSON.stringify(receipt)}`);
  } catch (error) {
    console.error(`Metadata verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
