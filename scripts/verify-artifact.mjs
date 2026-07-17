#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const META_FILES = new Set(["artifact-metadata.json", "file-manifest.txt"]);
const RUNTIME_SCRIPTS = ["state.js", "attributes.js", "battle-ops.js", "agent-arena.js", "questions.js", "progress.js", "dialogue.js", "world-art.js", "music.js", "game.js"];

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
const requiredRuntime = ["index.html", "state.js", "attributes.js", "battle-ops.js", "agent-arena.js", "questions.js", "progress.js", "dialogue.js", "world-art.js", "music.js", "game.js", "sprites-sit/manifest.json", "props-study/manifest.json", "props-wayfinding/manifest.json"];
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

// The accepted public roster is fixed independently of runtime declarations. Trainer,
// portrait, walk, and sitting sets must all match it exactly so coordinated drift cannot
// bless a teammate as initials, a static fallback, or an undeclared extra.
const EXPECTED_ROSTER = [
  "alex-andrianavalontsalama", "andrea-vreugdenhil", "antonia-nistor",
  "aurelien-bouffanais", "dana-domanko", "duc-an-nguyen", "elina-gu",
  "emile-moffatt", "ethan-pirso", "felicia-gorgacheva", "francesco-finn",
  "guillaume-delmas-frenette", "guillaume-pregent", "jerry-zhu", "jewoo-lee",
  "jonah-lee", "jonathan-kim", "julien-hovan", "logan-labossiere",
  "megane-darnaud", "milen-thomas", "minh-ngoc-do", "oyku-cildir",
  "pentcho-tchomakov", "philippe-miranda-jean", "richard-el-chaar",
  "sarah-kotb", "saransh-padhy", "scott-carr", "stephanie-fontaine",
  "tabarek-al-khalidi", "tyler-nagano", "veronica-marallag",
  "victor-desautels", "vincent-anctil", "wild-guevera", "william-chan",
];
const packagedGame = fs.readFileSync(path.join(DIST, "game.js"), "utf8");
const rosterMatch = packagedGame.match(/const ROSTER\s*=\s*\[([\s\S]*?)\];/);
if (!rosterMatch) throw new Error("Packaged game.js has no parseable ROSTER declaration");
const rosterSlugs = [...rosterMatch[1].matchAll(/"([a-z0-9-]+)"/g)].map(match => match[1]);
const rosterResidue = rosterMatch[1].replace(/"[a-z0-9-]+"/g, "").replace(/[\s,]/g, "");
if (rosterResidue || !rosterSlugs.length || new Set(rosterSlugs).size !== rosterSlugs.length ||
    JSON.stringify(rosterSlugs) !== JSON.stringify([...rosterSlugs].sort())) {
  throw new Error("Packaged ROSTER must be a nonempty, unique, sorted slug list");
}
if (JSON.stringify(rosterSlugs) !== JSON.stringify(EXPECTED_ROSTER)) {
  throw new Error("Packaged ROSTER must exactly match the accepted 37-person roster");
}
const canonicalRosterSlugs = [...EXPECTED_ROSTER];
if (JSON.stringify(portraitSlugs) !== JSON.stringify(canonicalRosterSlugs)) {
  throw new Error("Packaged portrait slugs must exactly match ROSTER");
}
for (const slug of canonicalRosterSlugs) {
  const portraitPath = `portraits/${slug}.png`;
  const data = fs.readFileSync(path.join(DIST, portraitPath));
  const isPng = data.length >= 26 && data.subarray(1, 4).toString("ascii") === "PNG";
  const width = isPng ? data.readUInt32BE(16) : 0;
  const height = isPng ? data.readUInt32BE(20) : 0;
  const bitDepth = isPng ? data[24] : 0;
  const colorType = isPng ? data[25] : -1;
  if (!isPng || width < 64 || width > 128 || height !== 96 || bitDepth !== 8 || colorType !== 6) {
    throw new Error(`Packaged Fire Emblem portrait contract mismatch: ${portraitPath}`);
  }
}
const trainerSlugs = payload.filter(file => /^sprites\/[^/]+\.png$/.test(file.path))
  .map(file => path.basename(file.path, ".png")).sort();
if (JSON.stringify(trainerSlugs) !== JSON.stringify(canonicalRosterSlugs)) {
  throw new Error("Packaged trainer slugs must exactly match ROSTER");
}
const expectedWalkFrames = canonicalRosterSlugs.flatMap(slug =>
  ["down", "left", "right", "up"].flatMap(direction =>
    [0, 1, 2, 3].map(frame => `sprites-walk/${slug}/${direction}_${frame}.png`)
  )
).sort();
const packagedWalkFrames = payload.filter(file => /^sprites-walk\/.*\.png$/.test(file.path))
  .map(file => file.path).sort();
if (JSON.stringify(packagedWalkFrames) !== JSON.stringify(expectedWalkFrames)) {
  throw new Error("Packaged walk frames must be the exact 16-frame set for every ROSTER slug");
}

// Sitting art is executable presentation data: package exactly two declared frames for
// every roster slug, with no nested extras and with hashes tied to stable rear source art.
const sittingManifest = JSON.parse(fs.readFileSync(path.join(DIST, "sprites-sit/manifest.json"), "utf8"));
if (!Array.isArray(sittingManifest.entries) || sittingManifest.roster_count !== portraitSlugs.length ||
    sittingManifest.frame_count !== portraitSlugs.length * 2) {
  throw new Error("Packaged sitting manifest roster/frame counts are not canonical");
}
const sittingSlugs = sittingManifest.entries.map(entry => entry && entry.slug).sort();
if (JSON.stringify(sittingSlugs) !== JSON.stringify(canonicalRosterSlugs)) {
  throw new Error("Packaged sitting slugs must exactly match ROSTER");
}
const declaredSittingFrames = [];
for (const entry of sittingManifest.entries) {
  if (!entry || typeof entry.slug !== "string" || !Array.isArray(entry.frames) || entry.frames.length !== 2) {
    throw new Error("Packaged sitting entry must declare exactly two frames");
  }
  for (let index = 0; index < 2; index++) {
    const frame = entry.frames[index];
    const expectedFile = `sprites-sit/${entry.slug}/idle_${index}.png`;
    const expectedSource = `sprites-walk/${entry.slug}/up_0.png`;
    if (!frame || frame.frame !== index || frame.file !== expectedFile || frame.source !== expectedSource) {
      throw new Error(`Noncanonical packaged sitting declaration for ${entry.slug} frame ${index}`);
    }
    for (const [declaredPath, declaredHash, label] of [
      [expectedFile, frame.sha256, "frame"], [expectedSource, frame.sourceSha256, "source"],
    ]) {
      if (!payloadPaths.has(declaredPath) || !/^[0-9a-f]{64}$/.test(declaredHash || "")) {
        throw new Error(`Missing or invalid packaged sitting ${label}: ${declaredPath}`);
      }
      const actualHash = createHash("sha256").update(fs.readFileSync(path.join(DIST, declaredPath))).digest("hex");
      if (actualHash !== declaredHash) throw new Error(`Packaged sitting ${label} hash mismatch: ${declaredPath}`);
    }
    declaredSittingFrames.push(expectedFile);
  }
}
const packagedSittingFrames = payload.filter(file => /^sprites-sit\/.*\.png$/.test(file.path))
  .map(file => file.path).sort();
if (JSON.stringify(packagedSittingFrames) !== JSON.stringify(declaredSittingFrames.sort())) {
  throw new Error(`Packaged sitting PNG set must exactly match the ${declaredSittingFrames.length} declared frames`);
}

// Certification Spine wayfinding is one atomic accepted batch: six friezes and three
// surrounds, each sourceScale-2 and content-addressed. No undeclared nested file is public.
const WAYFINDING_IDS = [
  "zone-agent-frieze", "zone-mcp-frieze", "zone-config-frieze",
  "zone-prompt-frieze", "zone-context-frieze", "zone-mix-frieze",
  "door-context-surround", "door-library-surround", "door-battle-surround",
];
const wayfindingManifest = JSON.parse(fs.readFileSync(path.join(DIST, "props-wayfinding/manifest.json"), "utf8"));
const WAYFINDING_PROVENANCE = "pillow-primitives:certification-spine-v1";
const WAYFINDING_ROOT_KEYS = ["asset_count", "batch", "batch_sha256", "entries", "format", "provenance", "reviewState", "sourceScale"];
const WAYFINDING_ENTRY_KEYS = ["alphaMode", "collision", "description", "file", "heightPx", "id", "kind", "provenance", "reviewState", "sha256", "slug", "sourceHeightPx", "sourceScale", "sourceWidthPx", "widthPx"];
if (JSON.stringify(Object.keys(wayfindingManifest).sort()) !== JSON.stringify(WAYFINDING_ROOT_KEYS) ||
    wayfindingManifest.batch !== "batch-certification-spine" || wayfindingManifest.format !== "RGBA" ||
    wayfindingManifest.reviewState !== "accepted" || wayfindingManifest.provenance !== WAYFINDING_PROVENANCE ||
    wayfindingManifest.sourceScale !== 2 || !Number.isInteger(wayfindingManifest.asset_count) || wayfindingManifest.asset_count !== 9 ||
    !/^[0-9a-f]{64}$/.test(wayfindingManifest.batch_sha256 || "") ||
    !Array.isArray(wayfindingManifest.entries) || wayfindingManifest.entries.length !== 9) {
  throw new Error("Packaged wayfinding manifest identity/count is not canonical");
}
const declaredWayfinding = [];
const wayfindingAggregate = createHash("sha256");
for (let index = 0; index < WAYFINDING_IDS.length; index++) {
  const id = WAYFINDING_IDS[index], entry = wayfindingManifest.entries[index];
  const surround = id.startsWith("door-");
  const width = 96, height = surround ? 64 : 16;
  const expectedPath = `props-wayfinding/${id}.png`;
  const requiredKeys = surround ? [...WAYFINDING_ENTRY_KEYS, "opening"].sort() : WAYFINDING_ENTRY_KEYS;
  if (!entry || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(requiredKeys) ||
      entry.id !== id || entry.slug !== id || entry.file !== `${id}.png` ||
      entry.kind !== (surround ? "surround" : "frieze") || entry.widthPx !== width ||
      entry.heightPx !== height || entry.sourceWidthPx !== width * 2 || entry.sourceHeightPx !== height * 2 ||
      entry.sourceScale !== 2 || entry.alphaMode !== "binary" || entry.collision !== "none" ||
      entry.reviewState !== "accepted" || entry.provenance !== WAYFINDING_PROVENANCE ||
      entry.description !== (surround ? "Destination architecture surround" : "Domain architecture frieze") ||
      !/^[0-9a-f]{64}$/.test(entry.sha256 || "") ||
      (surround && JSON.stringify(entry.opening) !== "[32,23,64,64]")) {
    throw new Error(`Noncanonical packaged wayfinding declaration: ${id}`);
  }
  if (!payloadPaths.has(expectedPath)) throw new Error(`Missing packaged wayfinding file: ${expectedPath}`);
  const data = fs.readFileSync(path.join(DIST, expectedPath));
  const hash = createHash("sha256").update(data).digest("hex");
  if (hash !== entry.sha256) throw new Error(`Packaged wayfinding hash mismatch: ${expectedPath}`);
  const isPng = data.length >= 24 && data.subarray(1, 4).toString("ascii") === "PNG";
  if (!isPng || data.readUInt32BE(16) !== width * 2 || data.readUInt32BE(20) !== height * 2) {
    throw new Error(`Packaged wayfinding PNG dimensions mismatch: ${expectedPath}`);
  }
  wayfindingAggregate.update(data); declaredWayfinding.push(expectedPath);
}
if (wayfindingManifest.batch_sha256 !== wayfindingAggregate.digest("hex")) {
  throw new Error("Packaged wayfinding aggregate hash mismatch");
}
const packagedWayfinding = payload.filter(file => /^props-wayfinding\/.*\.png$/.test(file.path)).map(file => file.path).sort();
if (JSON.stringify(packagedWayfinding) !== JSON.stringify(declaredWayfinding.sort())) {
  throw new Error("Packaged wayfinding PNG set must exactly match the nine declared assets");
}

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
