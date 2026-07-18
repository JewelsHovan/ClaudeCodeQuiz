#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { inflateSync } from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");
const fromRoot = rel => path.join(ROOT, rel);
const readJson = rel => JSON.parse(fs.readFileSync(fromRoot(rel), "utf8"));
const unique = (values, label) => assert.equal(new Set(values).size, values.length, `${label} must be unique`);
const domain = (value, label, allowGeneral = false) => assert.ok(
  Number.isInteger(value) && value >= (allowGeneral ? 0 : 1) && value <= 5,
  `${label} domain must be ${allowGeneral ? "0-5" : "1-5"}`,
);

function loadQuestionBank() {
  const source = fs.readFileSync(fromRoot("datamon/questions.js"), "utf8");
  const context = {};
  vm.runInNewContext(`${source}\nglobalThis.__QUESTION_BANK__ = QUESTION_BANK;`, context, {
    filename: "datamon/questions.js",
  });
  return context.__QUESTION_BANK__;
}

function loadWorldArtValidator() {
  const source = fs.readFileSync(fromRoot("datamon/world-art.js"), "utf8");
  const context = { window: {}, console, Math, Uint8ClampedArray };
  vm.runInNewContext(source, context, { filename: "datamon/world-art.js" });
  return context.window.DatamonWorldArt;
}

function loadBattlePresentationValidator() {
  const source = fs.readFileSync(fromRoot("datamon/battle-presentation.js"), "utf8");
  const context = { window: {}, console };
  vm.runInNewContext(source, context, { filename: "datamon/battle-presentation.js" });
  return context.window.DatamonBattlePresentation;
}

function loadBattleArenaValidator() {
  const source = fs.readFileSync(fromRoot("datamon/battle-arena.js"), "utf8");
  const context = { window: {}, console };
  vm.runInNewContext(source, context, { filename: "datamon/battle-arena.js" });
  return context.window.DatamonBattleArena;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

// Decode the deliberately constrained accepted HD PNG contract (8-bit RGBA, non-interlaced)
// so the JS validator independently enforces alpha and non-trivial source detail.
function decodeRgbaPng(file) {
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${file} is not PNG`);
  let offset = 8, width = 0, height = 0, bitDepth = 0, colorType = -1, interlace = -1;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset); offset += 4;
    const type = bytes.toString("ascii", offset, offset + 4); offset += 4;
    const data = bytes.subarray(offset, offset + length); offset += length + 4; // skip CRC
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  assert.equal(bitDepth, 8, `${file} must be 8-bit PNG`);
  assert.equal(colorType, 6, `${file} must be RGBA PNG`);
  assert.equal(interlace, 0, `${file} must be non-interlaced PNG`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  assert.equal(raw.length, (stride + 1) * height, `${file} scanline length mismatch`);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter >= 0 && filter <= 4, `${file} invalid PNG filter ${filter}`);
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const at = y * stride + x;
      const left = x >= 4 ? pixels[at - 4] : 0;
      const up = y > 0 ? pixels[at - stride] : 0;
      const upLeft = y > 0 && x >= 4 ? pixels[at - stride - 4] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upLeft);
      pixels[at] = (value + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

const bank = loadQuestionBank();
const expectedDomains = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT"];
assert.deepEqual(Object.keys(bank), expectedDomains);
const questions = expectedDomains.flatMap(category => {
  assert.equal(bank[category].length, 24, `${category} must contain 24 questions`);
  return bank[category].map((question, index) => ({ ...question, category, index }));
});
assert.equal(questions.length, 120);
const ids = questions.map(q => q.id);
assert.equal(ids.filter(Boolean).length, 120, "all 120 questions must have an explicit id");
unique(ids, "question IDs");
for (const q of questions) {
  const at = `${q.category}[${q.index}]`;
  assert.ok(typeof q.id === "string" && /^[a-z]+-\d{3}$/.test(q.id), `${at}.id must match category-NNN pattern`);
  assert.ok(typeof q.q === "string" && q.q.trim(), `${at}.q is required`);
  assert.ok(Array.isArray(q.c) && q.c.length === 4, `${at}.c must contain four choices`);
  assert.ok(q.c.every(choice => typeof choice === "string" && choice.trim()), `${at}.c choices must be text`);
  assert.ok(Number.isInteger(q.a) && q.a >= 0 && q.a < q.c.length, `${at}.a must index a choice`);
  assert.ok(typeof q.x === "string" && q.x.trim(), `${at}.x explanation is required`);
  assert.ok(["easy", "medium", "normal", "hard"].includes(q.d), `${at}.d must be easy/medium/normal/hard`);
}

const books = readJson("datamon/library/books.json");
const pairs = readJson("datamon/library/pairs.json");
const cloze = readJson("datamon/library/cloze.json");
const diagrams = readJson("datamon/library/diagrams.json");
const propManifest = readJson("datamon/props/manifest.json");
const libraryManifest = readJson("datamon/library/assets/manifest.json");
const battlemonManifest = readJson("datamon/battlemons/manifest.json");
const battlemonSourceManifest = readJson("datamon/battlemons-source/manifest.json");
const battleArenaManifest = readJson("datamon/battle-arenas/manifest.json");
let envManifest = [];
try { envManifest = readJson("datamon/environment/manifest.json"); } catch (_) { /* optional */ }

for (const [label, items] of [["books", books], ["pairs", pairs], ["cloze", cloze], ["diagrams", diagrams]]) {
  assert.ok(Array.isArray(items) && items.length > 0, `${label} must be a non-empty array`);
  unique(items.map(item => item.id), `${label} IDs`);
  items.forEach((item, index) => domain(item.domain, `${label}[${index}]`, label === "books" || label === "diagrams"));
}
for (const [index, book] of books.entries()) {
  assert.ok(typeof book.title === "string" && book.title.trim(), `books[${index}].title is required`);
  assert.ok(Array.isArray(book.pages) && book.pages.length > 0, `books[${index}].pages is required`);
  assert.ok(book.pages.every(page =>
    (Array.isArray(page.lines) && page.lines.every(line => typeof line === "string")) ||
    (page.type === "diagram_anchor" && typeof page.slug === "string" && typeof page.fallback_text === "string")
  ), `books[${index}] pages require text lines or a diagram fallback`);
}
for (const [index, item] of pairs.entries()) {
  assert.ok(item.term?.trim() && item.definition?.trim(), `pairs[${index}] requires term/definition`);
}
for (const [index, item] of cloze.entries()) {
  assert.ok(item.template?.trim() && item.answer?.trim(), `cloze[${index}] requires template/answer`);
}
for (const [index, item] of diagrams.entries()) {
  assert.ok(Array.isArray(item.pieces) && item.pieces.length > 0, `diagrams[${index}].pieces is required`);
  assert.ok(Array.isArray(item.correct_layout) && item.correct_layout.length > 0, `diagrams[${index}].correct_layout is required`);
  const pieceIds = new Set(item.pieces.map(piece => piece.id));
  assert.ok(item.correct_layout.every(id => pieceIds.has(id)), `diagrams[${index}] layout references unknown piece`);
}

for (const [label, manifest, dir] of [
  ["props", propManifest, "datamon/props"],
  ["library assets", libraryManifest, "datamon/library/assets"],
]) {
  assert.ok(Array.isArray(manifest) && manifest.length > 0, `${label} manifest must be non-empty`);
  unique(manifest.map(item => item.slug), `${label} slugs`);
  for (const item of manifest) {
    assert.ok(item.slug && item.file, `${label} entries require slug/file`);
    assert.ok(fs.existsSync(fromRoot(path.join(dir, item.file))), `${label} missing file: ${item.file}`);
  }
}
const librarySlugs = new Set(libraryManifest.map(item => item.slug));
for (const book of books) assert.ok(librarySlugs.has(book.cover_slug), `missing cover slug: ${book.cover_slug}`);
for (const diagram of diagrams) {
  if (diagram.sprite_slug) assert.ok(librarySlugs.has(diagram.sprite_slug), `missing diagram sprite: ${diagram.sprite_slug}`);
}

const battlePresentation = loadBattlePresentationValidator();
const acceptedBattlemonManifest = battlePresentation.normalizeManifest(battlemonManifest);
assert.ok(acceptedBattlemonManifest && acceptedBattlemonManifest.size === 35,
  "Battlemon manifest must pass the strict runtime taxonomy/schema contract");
let battlemonBytes = 0;
assert.equal(battlemonSourceManifest.reviewState, "accepted", "Battlemon AI source batch must be reviewed");
assert.equal(battlemonSourceManifest.model, "google/gemini-3-pro-image", "Battlemon source model drift");
assert.equal(battlemonSourceManifest.review?.contactSheetSha256, battlemonManifest.sourceReviewSha256,
  "Battlemon runtime/source review receipts must match");
const battlemonSources = new Map(battlemonSourceManifest.entries.map(entry => [entry.id, entry]));
for (const entry of battlemonManifest.entries) {
  const file = fromRoot(`datamon/battlemons/${entry.file}`);
  const source = fromRoot(`datamon/battlemons-source/${entry.id}.png`);
  assert.ok(fs.existsSync(file), `missing Battlemon sheet: ${entry.file}`);
  assert.ok(fs.existsSync(source), `missing reviewed Battlemon source: ${entry.id}`);
  const data = fs.readFileSync(file); battlemonBytes += data.length;
  assert.equal(createHash("sha256").update(data).digest("hex"), entry.sha256,
    `Battlemon hash mismatch: ${entry.file}`);
  assert.equal(createHash("sha256").update(fs.readFileSync(source)).digest("hex"), entry.sourceSha256,
    `Battlemon source hash mismatch: ${entry.id}`);
  assert.equal(battlemonSources.get(entry.id)?.sourceSha256, entry.sourceSha256,
    `Battlemon source declaration mismatch: ${entry.id}`);
}
assert.ok(battlemonBytes <= 2 * 1024 * 1024, "Battlemon PNG byte budget exceeded");

const battleArena = loadBattleArenaValidator();
const acceptedArenaManifest = battleArena.normalizeManifest(battleArenaManifest);
assert.ok(acceptedArenaManifest && acceptedArenaManifest.size === 5,
  "Battle arena manifest must pass the strict runtime contract");
let arenaBytes = 0; const arenaAggregate = createHash("sha256");
for (const entry of battleArenaManifest.entries) {
  const file = fromRoot(`datamon/battle-arenas/${entry.file}`);
  assert.ok(fs.existsSync(file), `missing battle arena: ${entry.file}`);
  const data = fs.readFileSync(file); arenaBytes += data.length; arenaAggregate.update(data);
  assert.equal(createHash("sha256").update(data).digest("hex"), entry.sha256,
    `battle arena hash mismatch: ${entry.file}`);
  assert.ok(data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
    data.readUInt32BE(16) === 1600 && data.readUInt32BE(20) === 864 && data[24] === 8 && data[25] === 2,
  `battle arena PNG geometry/mode mismatch: ${entry.file}`);
}
assert.equal(arenaAggregate.digest("hex"), battleArenaManifest.batchSha256, "battle arena aggregate mismatch");
assert.ok(arenaBytes <= 8 * 1024 * 1024, "battle arena PNG byte budget exceeded");

// The additive manifest may be empty before G1, but any active member must pass the same
// exact sourceScale/frame/alpha/detail contract in JavaScript as it does in Python.
assert.ok(Array.isArray(envManifest), "environment manifest must be an array");
if (envManifest.length > 0) {
  const worldArt = loadWorldArtValidator();
  const normalized = worldArt.normalizeManifest(envManifest);
  assert.equal(normalized.length, envManifest.length, "environment manifest schema/dimensions are invalid");
  for (const item of normalized) {
    assert.equal(item.reviewState, "accepted", `active environment member ${item.id} is not accepted`);
    const envFile = fromRoot(`datamon/environment/accepted/${item.batchId}/${item.file}`);
    assert.ok(fs.existsSync(envFile), `environment missing accepted file: ${envFile}`);
    const decoded = decodeRgbaPng(envFile);
    const result = worldArt.validatePixels(item, decoded.pixels, decoded.width, decoded.height);
    assert.ok(result.valid, `environment member ${item.id} failed pixel validation: ${result.reason}`);
  }
  console.log(`Environment manifest: ${envManifest.length} accepted entries.`);
}

console.log(`Content valid: ${questions.length} questions, ${books.length} books, ${pairs.length} pairs, ${cloze.length} cloze prompts, ${diagrams.length} diagrams.`);
