#!/usr/bin/env node

// Build a deterministic DATAMON payload from Git-tracked runtime files.
// On a dirty development tree, tracked working-tree edits are packaged so checks exercise
// the code under review. Guarded deployment requires a clean tree, where this is identical
// to tracked HEAD. Metadata/manifest attest the payload but are not part of its digest.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const DATAMON = path.join(ROOT, "datamon");
const META_FILES = new Set(["artifact-metadata.json", "file-manifest.txt"]);
const PAYLOAD_ALLOWLIST = [
  "index.html", "game.js", "battle-ops.js", "agent-arena.js", "questions.js", "state.js",
  "world-art.js", "music.js",
  "portraits/*.png", "sprites/*.png", "sprites-walk/**/*.png",
  "tiles/*.png", "props/*.png", "props/manifest.json",
  "library/*.json", "library/assets/*.png", "library/assets/manifest.json",
  "environment/manifest.json", "environment/accepted/*/*.png",
];

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function matches(relPath, pattern) {
  const expression = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp(`^${expression}$`).test(relPath);
}

function payloadFiles() {
  const output = execFileSync("git", ["ls-files", "-z", "--", "datamon"], { cwd: ROOT });
  const tracked = output.toString("utf8").split("\0").filter(Boolean)
    .map(repoPath => repoPath.replace(/^datamon\//, ""));
  // Include allowlisted untracked runtime files in a dirty review tree (notably a newly
  // promoted immutable environment batch). Private staging/review/raw paths match no pattern.
  const existing = [];
  const allowedTopDirectories = new Set([
    "portraits", "sprites", "sprites-walk", "tiles", "props", "library", "environment",
  ]);
  function walk(dir, prefix = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!prefix && entry.isDirectory() && !allowedTopDirectories.has(entry.name)) continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relPath);
      else if (PAYLOAD_ALLOWLIST.some(pattern => matches(relPath, pattern))) existing.push(relPath);
    }
  }
  walk(DATAMON);
  return [...new Set([...tracked, ...existing])]
    .filter(relPath => PAYLOAD_ALLOWLIST.some(pattern => matches(relPath, pattern)))
    .sort((a, b) => a.localeCompare(b));
}

function digest(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(DIST, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function build() {
  const branch = git(["branch", "--show-current"]);
  const commit = git(["rev-parse", "HEAD"]);
  const dirty = git(["status", "--porcelain", "--untracked-files=all"]) !== "";
  const files = payloadFiles();
  if (!files.length) throw new Error("Runtime allowlist matched no tracked files");

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  for (const relPath of files) {
    const source = path.join(DATAMON, relPath);
    if (!fs.existsSync(source)) throw new Error(`Tracked runtime file is missing: datamon/${relPath}`);
    const destination = path.join(DIST, relPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  const totalBytes = files.reduce((sum, file) => sum + fs.statSync(path.join(DIST, file)).size, 0);
  const payloadSha256 = digest(files);
  const manifest = files.map(file => `${file}\t${fs.statSync(path.join(DIST, file)).size}`).join("\n") + "\n";
  fs.writeFileSync(path.join(DIST, "file-manifest.txt"), manifest);
  fs.writeFileSync(path.join(DIST, "artifact-metadata.json"), JSON.stringify({
    schemaVersion: 1,
    branch,
    commit,
    commitShort: commit.slice(0, 7),
    clean: !dirty,
    source: "git-tracked-worktree",
    packagedAt: new Date().toISOString(),
    payloadSha256,
    fileCount: files.length,
    totalBytes,
    payloadAllowlist: PAYLOAD_ALLOWLIST,
  }, null, 2) + "\n");

  console.log(`Payload: ${files.length} files, ${totalBytes} bytes, SHA-256 ${payloadSha256}${dirty ? " (dirty tracked worktree)" : ""}`);
  return { files: files.length, bytes: totalBytes, sha: payloadSha256 };
}

console.log("=== DATAMON deterministic artifact ===");
const first = build();
const second = build();
if (first.sha !== second.sha || first.files !== second.files || first.bytes !== second.bytes) {
  throw new Error(`Non-deterministic payload: ${JSON.stringify(first)} != ${JSON.stringify(second)}`);
}
console.log(`Determinism verified across two builds: ${second.sha}`);
