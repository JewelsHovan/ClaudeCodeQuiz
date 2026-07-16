#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const META_FILES = new Set(["artifact-metadata.json", "file-manifest.txt"]);

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

if (digest !== metadata.payloadSha256) throw new Error(`Payload SHA mismatch: ${digest} != ${metadata.payloadSha256}`);
if (payload.length !== metadata.fileCount) throw new Error(`Payload file count mismatch: ${payload.length} != ${metadata.fileCount}`);
if (bytes !== metadata.totalBytes) throw new Error(`Payload byte count mismatch: ${bytes} != ${metadata.totalBytes}`);
if (actualManifest !== expectedManifest) throw new Error("Payload file manifest does not match dist contents");
if (metadata.commit !== head) throw new Error(`Artifact commit ${metadata.commit} does not match HEAD ${head}`);

console.log(`Artifact verified: ${payload.length} payload files, ${bytes} bytes, SHA-256 ${digest}`);
