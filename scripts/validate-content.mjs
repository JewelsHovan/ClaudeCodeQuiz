#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

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

console.log(`Content valid: ${questions.length} questions, ${books.length} books, ${pairs.length} pairs, ${cloze.length} cloze prompts, ${diagrams.length} diagrams.`);
