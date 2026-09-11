#!/usr/bin/env node
/**
 * Length-bias audit for the DATAMON battle bank (datamon/questions.js).
 *
 * The study bank (quiz/bank/*.json) has scripts/audit_bank.py. This is the same
 * check for the game's separate 120-question bank, which turned out to carry the
 * identical defect — the correct answer was the longest choice in 83% of questions
 * against a 25% chance baseline.
 *
 * Why this needs its own thresholds
 * ---------------------------------
 * These choices are battle-UI labels, averaging ~33 characters against ~137 in the
 * study bank. An absolute rule like "the key may run at most +15 chars" is nearly
 * meaningless here: +15 on a 33-character choice is 45% longer, a glaring tell,
 * while the same +15 on a 137-character option is noise. So this measures the
 * *ratio* of key length to mean distractor length, which is what actually
 * generalises across formats, and keeps a tight absolute spread on top of it.
 *
 * The layout cap is empirical: 64 characters is the longest choice the game has
 * ever rendered, so it is the width the battle box is known to survive.
 *
 * Run:
 *   node scripts/audit_datamon_bank.mjs
 *   node scripts/audit_datamon_bank.mjs --strict   # exit 1 on a breach, for CI
 *   node scripts/audit_datamon_bank.mjs --worst 15
 */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MAX_LONGEST_KEY_RATE = 0.35;  // chance is 25%
const MAX_LENGTH_RATIO = 1.10;      // key vs mean distractor
const MAX_MEAN_SPREAD = 14;         // longest minus shortest choice, per question
const MAX_CHOICE_CHARS = 64;        // widest the battle box is known to render

// There is deliberately no minimum-length rule. Some questions are legitimately terse
// at perfect parity — config-012 offers exit codes "0" / "1" / "130" / "2" and is a fine
// item. A short choice only matters when it is short *relative to its siblings*, and
// ratio and spread already measure exactly that.

const argv = process.argv.slice(2);
const strict = argv.includes("--strict");
const worstN = argv.includes("--worst") ? Number(argv[argv.indexOf("--worst") + 1] || 15) : 0;

const src = fs.readFileSync(path.join(ROOT, "datamon/questions.js"), "utf8");
const ctx = vm.createContext({});
vm.runInNewContext(`${src}\nglobalThis.__BANK__ = QUESTION_BANK;`, ctx, { filename: "questions.js" });

const all = [];
for (const [cat, qs] of Object.entries(ctx.__BANK__)) for (const q of qs) all.push({ ...q, cat });

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const rows = all.map((q) => {
  const L = q.c.map((s) => s.length);
  const key = L[q.a];
  const dis = L.filter((_, i) => i !== q.a);
  return {
    id: q.id, cat: q.cat, key, disMean: mean(dis),
    ratio: key / mean(dis),
    longest: key > Math.max(...dis),
    spread: Math.max(...L) - Math.min(...L),
    rank: [...L].sort((a, b) => b - a).indexOf(key) + 1,
    max: Math.max(...L), min: Math.min(...L),
  };
});

const n = rows.length;
const longest = rows.filter((r) => r.longest).length;
const rate = longest / n;
const ratio = mean(rows.map((r) => r.ratio));
const spread = mean(rows.map((r) => r.spread));
const rank = [1, 2, 3, 4].map((r) => rows.filter((x) => x.rank === r).length);
const over = rows.filter((r) => r.max > MAX_CHOICE_CHARS);

const problems = [];
console.log(`DATAMON battle bank: ${n} questions across ${Object.keys(ctx.__BANK__).length} categories\n`);
console.log("LENGTH BIAS  — can a player spot the key without reading the question?");
console.log(`  key is the longest choice : ${String(longest).padStart(4)} / ${n}  (${(rate * 100).toFixed(0)}%)   target <=${MAX_LONGEST_KEY_RATE * 100}%, chance 25%`);
console.log(`  key / mean distractor     : ${ratio.toFixed(2)}x                 target <=${MAX_LENGTH_RATIO}x`);
console.log(`  spread, longest - shortest: ${spread.toFixed(0)} chars (mean)      target <=${MAX_MEAN_SPREAD}`);
console.log(`  → always-pick-longest scores ${(rate * 100).toFixed(0)}%`);
console.log(`  key length-rank (1 = longest; uniform would be 25% each): ${rank.map((c, i) => `${i + 1}:${((c / n) * 100).toFixed(0)}%`).join("  ")}\n`);

if (rate > MAX_LONGEST_KEY_RATE) problems.push(`key is longest in ${(rate * 100).toFixed(0)}% of questions (target <=${MAX_LONGEST_KEY_RATE * 100}%)`);
if (ratio > MAX_LENGTH_RATIO) problems.push(`key averages ${ratio.toFixed(2)}x the distractor length (target <=${MAX_LENGTH_RATIO}x)`);
if (spread > MAX_MEAN_SPREAD) problems.push(`choice spread averages ${spread.toFixed(0)} chars (target <=${MAX_MEAN_SPREAD}) — choices are not parallel`);

console.log(`OVERSIZED CHOICES  — over ${MAX_CHOICE_CHARS} chars (battle-box layout risk): ${over.length}`);
if (over.length) { console.log("  " + over.slice(0, 12).map((r) => `${r.id}:${r.max}`).join(", ") + (over.length > 12 ? " …" : "")); problems.push(`${over.length} questions have a choice over ${MAX_CHOICE_CHARS} chars`); }
console.log();

if (worstN) {
  console.log(`Worst ${worstN} offenders (key / mean distractor):`);
  for (const r of [...rows].sort((a, b) => b.ratio - a.ratio).slice(0, worstN)) {
    console.log(`  ${r.ratio.toFixed(2)}x  spread ${String(r.spread).padStart(3)}  ${r.id}  (${r.cat})`);
  }
  console.log();
}

if (problems.length) {
  console.log("ISSUES  (blocking under --strict)");
  for (const p of problems) console.log(`  ! ${p}`);
  if (strict) process.exit(1);
} else {
  console.log("✓ no quality thresholds breached");
}
