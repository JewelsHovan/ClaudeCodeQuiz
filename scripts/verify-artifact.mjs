#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const META_FILES = new Set(["artifact-metadata.json", "file-manifest.txt"]);
const RUNTIME_SCRIPTS = ["state.js", "battle-presentation.js", "battle-arena.js", "attributes.js", "battle-ops.js", "agent-arena.js", "questions.js", "progress.js", "dialogue-runtime.js", "dialogue.js", "world-art.js", "world-layout.js", "music.js", "game.js"];

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
const requiredRuntime = ["index.html", "state.js", "battle-presentation.js", "battle-arena.js", "attributes.js", "battle-ops.js", "agent-arena.js", "questions.js", "progress.js", "dialogue-runtime.js", "dialogue.js", "world-art.js", "world-layout.js", "music.js", "game.js", "sprites-sit/manifest.json", "props-study/manifest.json", "props-wayfinding/manifest.json", "battlemons/manifest.json", "battle-arenas/manifest.json"];
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

// Classic Battlemon art is independently pinned: questions.js, the pure presentation
// taxonomy, the strict manifest, and the exact public PNG set must all agree with this
// release contract. Runtime declarations cannot bless coordinated species drift.
const EXPECTED_BATTLEMONS = {
  AGENT: ["Rogue Subagent", "Infinite Loop", "Stop Reason", "Task Spawner", "Orphan Process", "Stale Coordinator", "Fork Bomb"],
  MCP: ["Schema Mismatch", "Tool Sprawl", "Stdio Zombie", "JSON-RPC Gremlin", "Deprecated SSE", "Scope Creep Server", "isError Imp"],
  CONFIG: ["Hook Loop", "Permission Prompt", "CLAUDE.md Bloat", "Settings Drift", "Deny Rule", "Headless Hang", "Exit Code 2"],
  PROMPT: ["Prompt Injector", "XML Tag Soup", "Vague Modifier", "Hallucinator", "Malformed JSON", "Chatty Preamble", "Forced Enum"],
  CONTEXT: ["Context Rot", "Lost Middle", "Token Gobbler", "Cache Miss", "Compaction Crash", "Rate Limiter", "Stale Summary"],
};
const BATTLEMON_DOMAINS = Object.keys(EXPECTED_BATTLEMONS);
const BATTLEMON_STATES = ["idle-a", "idle-b", "sendout", "attack", "hit", "faint"];
const battlemonId = (domain, name) => `${domain.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
const expectedBattlemonEntries = BATTLEMON_DOMAINS.flatMap(domain =>
  EXPECTED_BATTLEMONS[domain].map((name, variant) => ({ domain, name, variant, id: battlemonId(domain, name) }))
);
const questionContext = {};
vm.runInNewContext(`${fs.readFileSync(path.join(DIST, "questions.js"), "utf8")}\nglobalThis.__MON_NAMES__ = MON_NAMES;`, questionContext);
if (JSON.stringify(questionContext.__MON_NAMES__) !== JSON.stringify(EXPECTED_BATTLEMONS)) {
  throw new Error("Packaged MON_NAMES taxonomy does not match the accepted 35 Battlemon species");
}
const presentationContext = { window: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(DIST, "battle-presentation.js"), "utf8"), presentationContext);
const packagedPresentation = presentationContext.window.DatamonBattlePresentation;
const packagedPresentationNames = Object.fromEntries(BATTLEMON_DOMAINS.map(domain => [domain, Array.from(packagedPresentation.CANONICAL_NAMES[domain] || [])]));
if (JSON.stringify(packagedPresentationNames) !== JSON.stringify(EXPECTED_BATTLEMONS) ||
    expectedBattlemonEntries.some(entry => packagedPresentation.battlemonId(entry.domain, entry.name) !== entry.id)) {
  throw new Error("Packaged battle-presentation taxonomy/IDs are not canonical");
}
const battlemonManifestPath = path.join(DIST, "battlemons/manifest.json");
const battlemonManifestBytes = fs.readFileSync(battlemonManifestPath);
const battlemonManifest = JSON.parse(battlemonManifestBytes);
const BATTLEMON_ROOT_KEYS = ["assetCount", "batch", "batchSha256", "entries", "format", "frameCount", "frameHeight", "frameWidth", "layout", "provenance", "reviewState", "schemaVersion", "sourceBatch", "sourceModel", "sourceReviewSha256", "states"];
const BATTLEMON_ENTRY_KEYS = ["domain", "file", "frameHeight", "frameWidth", "frames", "id", "name", "sha256", "silhouetteFamily", "sourceSha256", "variant"];
const EXPECTED_BATTLEMON_SOURCE_REVIEW_SHA256 = "e1c6f919d5a8a0cd43c6ca9e4159f9370712324cc4d3225197881a2fb58dcb30";
const EXPECTED_BATTLEMON_BATCH_SHA256 = "8a55786fb9fd46dfddd887954355fec2a497c1fe6e3190468f228f5640702f1b";
if (JSON.stringify(Object.keys(battlemonManifest).sort()) !== JSON.stringify(BATTLEMON_ROOT_KEYS) ||
    battlemonManifest.schemaVersion !== 1 || battlemonManifest.batch !== "classic-battlemon-v2" ||
    battlemonManifest.reviewState !== "accepted" || battlemonManifest.provenance !== "reviewed-openrouter-gemini3pro+pillow-animation-v1" ||
    battlemonManifest.sourceBatch !== "battlemon-ai-sources-v1" || battlemonManifest.sourceModel !== "google/gemini-3-pro-image" ||
    battlemonManifest.sourceReviewSha256 !== EXPECTED_BATTLEMON_SOURCE_REVIEW_SHA256 ||
    battlemonManifest.batchSha256 !== EXPECTED_BATTLEMON_BATCH_SHA256 ||
    battlemonManifest.format !== "RGBA" || battlemonManifest.layout !== "horizontal" ||
    battlemonManifest.frameCount !== 6 || battlemonManifest.frameWidth !== 128 || battlemonManifest.frameHeight !== 128 ||
    battlemonManifest.assetCount !== 35 || JSON.stringify(battlemonManifest.states) !== JSON.stringify(BATTLEMON_STATES) ||
    !/^[0-9a-f]{64}$/.test(battlemonManifest.batchSha256 || "") || !Array.isArray(battlemonManifest.entries) ||
    battlemonManifest.entries.length !== 35) {
  throw new Error("Packaged Battlemon manifest identity/schema is not canonical");
}
const reviewedSourceManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "datamon/battlemons-source/manifest.json"), "utf8"));
const BATTLEMON_SOURCE_ROOT_KEYS = ["batch", "entries", "model", "provenance", "provider", "review", "reviewState", "schemaVersion", "sourceSize"];
const BATTLEMON_SOURCE_ENTRY_KEYS = ["domain", "file", "height", "id", "name", "promptSha256", "rawSha256", "sourceSha256", "width"];
if (JSON.stringify(Object.keys(reviewedSourceManifest).sort()) !== JSON.stringify(BATTLEMON_SOURCE_ROOT_KEYS) ||
    reviewedSourceManifest.schemaVersion !== 1 || reviewedSourceManifest.batch !== "battlemon-ai-sources-v1" ||
    reviewedSourceManifest.reviewState !== "accepted" || reviewedSourceManifest.provider !== "openrouter" ||
    reviewedSourceManifest.model !== "google/gemini-3-pro-image" ||
    reviewedSourceManifest.provenance !== "openrouter:google/gemini-3-pro-image+deterministic-pillow-v1" ||
    reviewedSourceManifest.sourceSize !== 128 || reviewedSourceManifest.review?.contactSheetSha256 !== battlemonManifest.sourceReviewSha256 ||
    !Array.isArray(reviewedSourceManifest.entries) || reviewedSourceManifest.entries.length !== 35) {
  throw new Error("Reviewed Battlemon AI source manifest is not canonical");
}
const reviewedSourcesById = new Map();
for (let index = 0; index < expectedBattlemonEntries.length; index++) {
  const expected = expectedBattlemonEntries[index], entry = reviewedSourceManifest.entries[index];
  if (!entry || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(BATTLEMON_SOURCE_ENTRY_KEYS) ||
      entry.id !== expected.id || entry.name !== expected.name || entry.domain !== expected.domain ||
      entry.file !== `${expected.id}.png` || entry.width !== 128 || entry.height !== 128 ||
      !/^[0-9a-f]{64}$/.test(entry.promptSha256 || "") || !/^[0-9a-f]{64}$/.test(entry.rawSha256 || "") ||
      !/^[0-9a-f]{64}$/.test(entry.sourceSha256 || "")) {
    throw new Error(`Reviewed Battlemon source declaration is not canonical at index ${index}`);
  }
  reviewedSourcesById.set(entry.id, entry);
}
const reviewedSourceRoot = path.join(ROOT, "datamon/battlemons-source");
const reviewedSourceFiles = walk(reviewedSourceRoot).map(file => file.path).sort();
const expectedReviewedSourceFiles = ["manifest.json", ...expectedBattlemonEntries.map(entry => `${entry.id}.png`)].sort();
if (JSON.stringify(reviewedSourceFiles) !== JSON.stringify(expectedReviewedSourceFiles) ||
    payload.some(file => file.path.startsWith("battlemons-source/"))) {
  throw new Error("Reviewed Battlemon sources must be exact and excluded from the public artifact");
}

const declaredBattlemonFiles = [];
const battlemonAggregate = createHash("sha256");
const battlemonHashesByDomain = Object.fromEntries(BATTLEMON_DOMAINS.map(domain => [domain, new Set()]));
let battlemonBytes = 0;
for (let index = 0; index < expectedBattlemonEntries.length; index++) {
  const expected = expectedBattlemonEntries[index], entry = battlemonManifest.entries[index];
  const expectedPath = `battlemons/${expected.id}.png`;
  if (!entry || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(BATTLEMON_ENTRY_KEYS) ||
      entry.id !== expected.id || entry.name !== expected.name || entry.domain !== expected.domain ||
      entry.variant !== expected.variant || entry.file !== `${expected.id}.png` ||
      entry.frameWidth !== 128 || entry.frameHeight !== 128 ||
      JSON.stringify(entry.frames) !== JSON.stringify(BATTLEMON_STATES) ||
      entry.silhouetteFamily !== expected.domain.toLowerCase() ||
      !/^[0-9a-f]{64}$/.test(entry.sourceSha256 || "") || !/^[0-9a-f]{64}$/.test(entry.sha256 || "")) {
    throw new Error(`Noncanonical packaged Battlemon declaration at index ${index}`);
  }
  if (!payloadPaths.has(expectedPath)) throw new Error(`Missing packaged Battlemon sheet: ${expectedPath}`);
  const reviewedSource = path.join(ROOT, "datamon/battlemons-source", `${expected.id}.png`);
  if (reviewedSourcesById.get(expected.id)?.sourceSha256 !== entry.sourceSha256 || !fs.existsSync(reviewedSource) ||
      createHash("sha256").update(fs.readFileSync(reviewedSource)).digest("hex") !== entry.sourceSha256) {
    throw new Error(`Reviewed Battlemon source hash mismatch: ${expected.id}`);
  }
  const data = fs.readFileSync(path.join(DIST, expectedPath));
  const hash = createHash("sha256").update(data).digest("hex");
  const png = data.length >= 26 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (hash !== entry.sha256 || !png || data.readUInt32BE(16) !== 768 || data.readUInt32BE(20) !== 128 ||
      data[24] !== 8 || data[25] !== 6) {
    throw new Error(`Packaged Battlemon bytes/dimensions mismatch: ${expectedPath}`);
  }
  battlemonAggregate.update(data); battlemonBytes += data.length;
  battlemonHashesByDomain[expected.domain].add(hash);
  declaredBattlemonFiles.push(expectedPath);
}
if (battlemonManifest.batchSha256 !== battlemonAggregate.digest("hex")) throw new Error("Packaged Battlemon aggregate hash mismatch");
if (battlemonBytes > 2 * 1024 * 1024) throw new Error("Packaged Battlemon PNG byte budget exceeded");
for (const domain of BATTLEMON_DOMAINS) {
  if (battlemonHashesByDomain[domain].size !== 7) throw new Error(`Packaged ${domain} species sheets are not individually distinct`);
}
const packagedBattlemonFiles = payload.filter(file => /^battlemons\/.*\.png$/.test(file.path)).map(file => file.path).sort();
if (JSON.stringify(packagedBattlemonFiles) !== JSON.stringify(declaredBattlemonFiles.sort())) {
  throw new Error("Packaged Battlemon PNG set must exactly match the 35 canonical sheets");
}
if (battlemonManifestBytes.toString("utf8") !== JSON.stringify(battlemonManifest, null, 2) + "\n") {
  throw new Error("Packaged Battlemon manifest serialization is not canonical");
}

// The generated domain theaters are independently pinned rather than trusted through their
// own manifest: exact model/review/batch, taxonomy, files, RGB dimensions, bytes, and aggregate.
const ARENA_DOMAINS = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT"];
const arenaContext = { window: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(DIST, "battle-arena.js"), "utf8"), arenaContext);
const packagedArenaApi = arenaContext.window.DatamonBattleArena;
if (!packagedArenaApi || JSON.stringify(Array.from(packagedArenaApi.DOMAINS)) !== JSON.stringify(ARENA_DOMAINS)) {
  throw new Error("Packaged battle-arena taxonomy is not canonical");
}
const arenaManifestPath = path.join(DIST, "battle-arenas/manifest.json");
const arenaManifestBytes = fs.readFileSync(arenaManifestPath);
const arenaManifest = JSON.parse(arenaManifestBytes);
const ARENA_ROOT_KEYS = ["assetCount", "authorizationCapUsd", "authorizationSpendUsd", "batch", "batchSha256", "domains", "entries", "format", "generationCostUsd", "height", "model", "paletteMax", "priorArtSpendUsd", "provenance", "provider", "review", "reviewState", "schemaVersion", "width"];
const ARENA_ENTRY_KEYS = ["costUsd", "domain", "file", "height", "id", "promptSha256", "promptVersion", "rawSha256", "referenceSha256", "sha256", "width"];
const EXPECTED_ARENA_REVIEW_SHA256 = "d0ae7e26a4408e97c1419f7214e4bae1fb84616cecc64b50c64a0729c6706aee";
const EXPECTED_ARENA_GRAYSCALE_SHA256 = "81b5fc61d8f2dd8571f3e5a877c7b9ed2d6bf108ca24030149bb14e5cada670a";
const EXPECTED_ARENA_BATCH_SHA256 = "e5115a1545f9554bc0465c167da8d0c02f46787ff09cc97652bdef3519a05837";
const EXPECTED_ARENA_COSTS = [0.178344, 0.180256, 0.17836, 0.178376, 0.178368];
const EXPECTED_ARENA_PROMPT_VERSIONS = [2, 1, 2, 2, 2];
const EXPECTED_ARENA_PROMPT_HASHES = [
  "3483ddaeabd106962831e3bf0798db9507a2ab1b1c5ec734b83f0731eb0b8b72", "e9111f2fe56a68b35ab392cf50f4aecb5cc3c003a0c386b06998a7b9df5be3d3",
  "60027a7f5a9a46c60680a6cf70e914b08b99e8eb41a4a2c63b26838591f1fa19", "ab5e074a799d1a0d1640e1dc8c7d6f2db2b15fb19ec8ed2fcc4e29b10aa17beb",
  "ebe83fb0ad0bba1cccf048c14be549cce4160a96cc8bebb6b1f58d9c4daf68d5",
];
const EXPECTED_ARENA_REFERENCE_HASHES = [
  "5f3bd5d12429d0844690adec6553973be8125b8600666df679d36c7819d0fd16", "1012e391f2d42ef1dd160427cd62f12964b6d7a6747f2e57679abce2f00cf8d6",
  "5f3bd5d12429d0844690adec6553973be8125b8600666df679d36c7819d0fd16", "5f3bd5d12429d0844690adec6553973be8125b8600666df679d36c7819d0fd16",
  "5f3bd5d12429d0844690adec6553973be8125b8600666df679d36c7819d0fd16",
];
const EXPECTED_ARENA_RAW_HASHES = [
  "c2c5d41d451a4fc670f481eb7bc13c030f368a7256f19ce033ae103b6afc1a16", "5f3bd5d12429d0844690adec6553973be8125b8600666df679d36c7819d0fd16",
  "0753f68c501d7470302ffbd03a2b32c94c79450e1b3e42e68734ef7d8c00668e", "991448508c5a795f409cb62f64b1912edc5c919e809d59d6ea2fc235b6d1413b",
  "d63b16e7fc514e5df37600db6f86bfd988e7609ac9a018f9d46055f80f1cb6a5",
];
const EXPECTED_ARENA_IMAGE_HASHES = [
  "4ee9fecdad95275f848c78f772118f68fb567114c5fbec3d41493526a6857002", "4456b708ddc1ec09eb25b6a6e4334721db6380233ef9315ad703557ad7292434",
  "cdff01a5f03d30113b49ffec90158bff4a750ad7fde34e3b65025ed7db13046a", "399dcd1e2ad5d6b87519a0540261b4c88ebbede53e35753047a8fa740fa7d105",
  "d28bc538462f230854e76626880306deedc09f8628212ae3f142645d9de4d0f9",
];
if (JSON.stringify(Object.keys(arenaManifest).sort()) !== JSON.stringify(ARENA_ROOT_KEYS) ||
    arenaManifest.schemaVersion !== 1 || arenaManifest.batch !== "classic-domain-arenas-v1" ||
    arenaManifest.reviewState !== "accepted" || arenaManifest.provider !== "openrouter" ||
    arenaManifest.model !== "openai/gpt-5.4-image-2" ||
    arenaManifest.provenance !== "openrouter:openai/gpt-5.4-image-2+deterministic-pillow-arena-v1" ||
    arenaManifest.width !== 1600 || arenaManifest.height !== 864 || arenaManifest.format !== "RGB" ||
    arenaManifest.paletteMax !== 256 || arenaManifest.assetCount !== 5 ||
    arenaManifest.authorizationCapUsd !== 50 || arenaManifest.priorArtSpendUsd !== 5.917484 ||
    arenaManifest.generationCostUsd !== 0.893704 || arenaManifest.authorizationSpendUsd !== 6.811188 ||
    JSON.stringify(arenaManifest.domains) !== JSON.stringify(ARENA_DOMAINS) ||
    arenaManifest.review?.reviewed !== true || arenaManifest.review?.contactSheetSha256 !== EXPECTED_ARENA_REVIEW_SHA256 ||
    arenaManifest.review?.grayscaleContactSheetSha256 !== EXPECTED_ARENA_GRAYSCALE_SHA256 ||
    JSON.stringify(Object.keys(arenaManifest.review || {}).sort()) !== JSON.stringify(["contactSheetSha256", "grayscaleContactSheetSha256", "reviewed"]) ||
    arenaManifest.batchSha256 !== EXPECTED_ARENA_BATCH_SHA256 || !Array.isArray(arenaManifest.entries) || arenaManifest.entries.length !== 5 ||
    !packagedArenaApi.normalizeManifest(arenaManifest)) {
  throw new Error("Packaged battle arena manifest identity/schema is not canonical");
}
const arenaAggregate = createHash("sha256"), arenaHashes = new Set(), declaredArenaFiles = [];
let arenaBytes = 0;
for (let index = 0; index < ARENA_DOMAINS.length; index++) {
  const domain = ARENA_DOMAINS[index], id = domain.toLowerCase(), entry = arenaManifest.entries[index];
  const expectedPath = `battle-arenas/${id}.png`;
  if (!entry || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(ARENA_ENTRY_KEYS) ||
      entry.id !== id || entry.domain !== domain || entry.file !== `${id}.png` ||
      entry.width !== 1600 || entry.height !== 864 || entry.costUsd !== EXPECTED_ARENA_COSTS[index] ||
      entry.promptVersion !== EXPECTED_ARENA_PROMPT_VERSIONS[index] ||
      entry.promptSha256 !== EXPECTED_ARENA_PROMPT_HASHES[index] ||
      entry.referenceSha256 !== EXPECTED_ARENA_REFERENCE_HASHES[index] ||
      entry.rawSha256 !== EXPECTED_ARENA_RAW_HASHES[index] || entry.sha256 !== EXPECTED_ARENA_IMAGE_HASHES[index]) {
    throw new Error(`Noncanonical packaged arena declaration at index ${index}`);
  }
  if (!payloadPaths.has(expectedPath)) throw new Error(`Missing packaged arena: ${expectedPath}`);
  const data = fs.readFileSync(path.join(DIST, expectedPath)); const hash = createHash("sha256").update(data).digest("hex");
  const png = data.length >= 26 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (hash !== entry.sha256 || !png || data.readUInt32BE(16) !== 1600 || data.readUInt32BE(20) !== 864 || data[24] !== 8 || data[25] !== 2) {
    throw new Error(`Packaged arena bytes/dimensions mismatch: ${expectedPath}`);
  }
  arenaAggregate.update(data); arenaHashes.add(hash); arenaBytes += data.length; declaredArenaFiles.push(expectedPath);
}
if (arenaAggregate.digest("hex") !== EXPECTED_ARENA_BATCH_SHA256 || arenaHashes.size !== 5 || arenaBytes > 8 * 1024 * 1024) {
  throw new Error("Packaged arena aggregate/distinctness/byte budget mismatch");
}
const packagedArenaFiles = payload.filter(file => /^battle-arenas\/.*\.png$/.test(file.path)).map(file => file.path).sort();
if (JSON.stringify(packagedArenaFiles) !== JSON.stringify(declaredArenaFiles.sort()) ||
    payload.some(file => file.path.startsWith("battle-arenas-source/") || file.path.startsWith(".battle-arena-ai-raw/"))) {
  throw new Error("Packaged arena file set or private-source exclusion mismatch");
}
if (arenaManifestBytes.toString("utf8") !== JSON.stringify(arenaManifest, null, 2) + "\n") {
  throw new Error("Packaged arena manifest serialization is not canonical");
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
  ".battlemon-ai-raw/", ".battle-arena-ai-raw/", "battle-arenas-source/",
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
