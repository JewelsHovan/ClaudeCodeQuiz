#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const META_FILES = new Set(["artifact-metadata.json", "file-manifest.txt"]);
const RUNTIME_SCRIPTS = ["state.js", "battle-ops.js", "agent-arena.js", "questions.js", "world-art.js", "music.js", "game.js"];

function walk(dir, sub = "", result = []) {
  const current = path.join(dir, sub);
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const rel = sub ? `${sub}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(dir, rel, result);
    else result.push({ path: rel, size: fs.statSync(path.join(dir, rel)).size });
  }
  return result;
}

function payloadDigest(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(DIST, file.path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

for (const name of META_FILES) {
  if (!fs.existsSync(path.join(DIST, name))) throw new Error(`Missing dist/${name}`);
}
const metadata = JSON.parse(fs.readFileSync(path.join(DIST, "artifact-metadata.json"), "utf8"));
const payload = walk(DIST).filter(file => !META_FILES.has(file.path)).sort((a, b) => a.path.localeCompare(b.path));
const digest = payloadDigest(payload);
const bytes = payload.reduce((sum, file) => sum + file.size, 0);
const expectedManifest = payload.map(file => `${file.path}\t${file.size}`).join("\n") + "\n";
const actualManifest = fs.readFileSync(path.join(DIST, "file-manifest.txt"), "utf8");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const payloadPaths = new Set(payload.map(file => file.path));
const requiredRuntime = ["index.html", "state.js", "battle-ops.js", "agent-arena.js", "questions.js", "world-art.js", "music.js", "game.js"];
for (const runtimeFile of requiredRuntime) {
  if (!payloadPaths.has(runtimeFile)) throw new Error(`Missing packaged runtime file: dist/${runtimeFile}`);
}
const packagedHtml = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
for (const script of RUNTIME_SCRIPTS) {
  const version = createHash("sha256").update(fs.readFileSync(path.join(DIST, script))).digest("hex").slice(0, 16);
  const declaration = `src="${script}?v=${version}"`;
  if (!packagedHtml.includes(declaration)) {
    throw new Error(`dist/index.html does not declare content-addressed ${declaration}`);
  }
  if (packagedHtml.includes(`src="${script}"`)) {
    throw new Error(`dist/index.html contains unsafe unversioned runtime reference: ${script}`);
  }
}
// Old public headshot URLs intentionally receive one exact transparent 1×1 PNG so
// Cloudflare evicts stale photos. Any other bytes, dimensions, slug set, or nested path fail.
const HEADSHOT_TOMBSTONE_SHA256 = "f2bb5bbaca678ecad746b1fa5ecfa2c8a81dd18817be19f0187c036d25326317";
const portraitSlugs = payload.filter(file => /^portraits\/[^/]+\.png$/.test(file.path))
  .map(file => path.basename(file.path, ".png")).sort();
const headshotTombstones = payload.filter(file => /^headshots\/[^/]+\.png$/.test(file.path));
const tombstoneSlugs = headshotTombstones.map(file => path.basename(file.path, ".png")).sort();
if (JSON.stringify(tombstoneSlugs) !== JSON.stringify(portraitSlugs)) {
  throw new Error("Headshot tombstone slugs must exactly match packaged portrait slugs");
}
for (const file of headshotTombstones) {
  const data = fs.readFileSync(path.join(DIST, file.path));
  const hash = createHash("sha256").update(data).digest("hex");
  const isOneByOnePng = data.length >= 24 && data.subarray(1, 4).toString("ascii") === "PNG" &&
    data.readUInt32BE(16) === 1 && data.readUInt32BE(20) === 1;
  if (hash !== HEADSHOT_TOMBSTONE_SHA256 || !isOneByOnePng) {
    throw new Error(`Unsafe headshot payload (only exact 1×1 tombstone allowed): dist/${file.path}`);
  }
}

const forbiddenSegments = [
  ".headshots-offline/", ".environment-work/", ".gba-gen-cache/", ".walk-gen-cache/",
  ".design/refs/", "/raw/", "/review/", "/history/", "contact-sheet",
];
for (const file of payload) {
  const probe = `/${file.path.toLowerCase()}`;
  if (forbiddenSegments.some(segment => probe.includes(segment))) {
    throw new Error(`Forbidden private/review path packaged: dist/${file.path}`);
  }
}

if (digest !== metadata.payloadSha256) throw new Error(`Payload SHA mismatch: ${digest} != ${metadata.payloadSha256}`);
if (payload.length !== metadata.fileCount) throw new Error(`Payload file count mismatch: ${payload.length} != ${metadata.fileCount}`);
if (bytes !== metadata.totalBytes) throw new Error(`Payload byte count mismatch: ${bytes} != ${metadata.totalBytes}`);
if (actualManifest !== expectedManifest) throw new Error("Payload file manifest does not match dist contents");
if (metadata.commit !== head) throw new Error(`Artifact commit ${metadata.commit} does not match HEAD ${head}`);

console.log(`Artifact verified: ${payload.length} payload files, ${bytes} bytes, SHA-256 ${digest}`);
