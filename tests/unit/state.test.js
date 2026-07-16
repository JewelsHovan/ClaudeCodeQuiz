// Unit tests for datamon/state.js — v2 save normalisation, migration,
// telemetry aliasing, backup policy, future-version write protection,
// idempotency, and explicit-zero handling.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("datamon/state.js", "utf8");

// VM sandbox objects have different prototypes than the test context,
// so deepStrictEqual fails on structurally-identical objects. Compare
// via JSON round-trip for cross-context data.
function jsonEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert.equal(a, b, msg || `expected ${b}, got ${a}`);
}

// Minimal question bank with IDs for testing.
const TEST_BANK = {
  AGENT: [
    { id: "agent-001", q: "Q1", c: ["a","b","c","d"], a: 0, x: "ex", d: "easy" },
    { id: "agent-002", q: "Q2", c: ["a","b","c","d"], a: 1, x: "ex", d: "medium" },
    { id: "agent-003", q: "Q3", c: ["a","b","c","d"], a: 2, x: "ex", d: "hard" },
  ],
  MCP: [
    { id: "mcp-001", q: "Q4", c: ["a","b","c","d"], a: 0, x: "ex", d: "easy" },
  ],
};

const TEST_ROSTER = ["alice", "bob", "carol"];

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    snapshot: () => Object.fromEntries(values),
  };
}

function loadHarness(storage = createStorage()) {
  const sandbox = { window: {}, localStorage: storage };
  vm.runInNewContext(source, sandbox, { filename: "datamon/state.js" });
  const api = sandbox.window.DatamonState;
  api.configure({ roster: TEST_ROSTER, idMap: api.buildIdMapFromBank(TEST_BANK) });
  return { api, storage };
}

function loadApi() {
  return loadHarness().api;
}

describe("DatamonState — defaults", () => {
  let api;
  before(() => { api = loadApi(); });

  it("produces a v2 default object with all expected fields", () => {
    const d = api.defaults();
    assert.equal(d.schemaVersion, 2);
    assert.equal(d.player, null);
    jsonEqual(d.defeated, []);
    jsonEqual(d.questionStats, {});
    assert.equal(d.seenCounter, 0);
    assert.equal(d.coffeeUses, 3);
    assert.equal(d.difficulty, "normal");
    jsonEqual(d.libraryProgress, {});
    jsonEqual(d.minigameScores, {});
    jsonEqual(d.progression, {
      badges: [],
      quests: {},
      activities: {},
      npcDomains: {},
    });
    assert.equal(d._writeProtected, undefined);
  });

  it("CURRENT_SCHEMA is 2", () => {
    assert.equal(api.CURRENT_SCHEMA, 2);
  });

  it("SAVE_KEY and BACKUP_KEY are correct", () => {
    assert.equal(api.SAVE_KEY, "datamon-save-v1");
    assert.equal(api.BACKUP_KEY, "datamon-save-v1-backup");
  });
});

describe("DatamonState — normalise empty/legacy", () => {
  let api;
  before(() => { api = loadApi(); });

  it("returns defaults for null/undefined/non-object input", () => {
    jsonEqual(api.normalise(null), api.defaults());
    jsonEqual(api.normalise(undefined), api.defaults());
    jsonEqual(api.normalise("nope"), api.defaults());
  });

  it("normalises a true empty object with schema defaults", () => {
    const out = api.normalise({});
    assert.equal(out.schemaVersion, 2);
    assert.equal(out.player, null);
    assert.equal(out.coffeeUses, 3);
    assert.equal(out.difficulty, "normal");
  });

  it("preserves a valid player slug", () => {
    assert.equal(api.normalise({ player: "alice" }).player, "alice");
  });

  it("rejects an invalid player slug not in roster", () => {
    assert.equal(api.normalise({ player: "unknown" }).player, null);
  });

  it("deduplicates defeated while preserving order, filters to roster only", () => {
    const out = api.normalise({ defeated: ["alice", "bob", "alice", "carol", "bob", "unknown", "nope"] });
    jsonEqual(out.defeated, ["alice", "bob", "carol"]);
  });

  it("excludes player from defeated if present", () => {
    const out = api.normalise({ player: "alice", defeated: ["alice", "bob", "carol"] });
    jsonEqual(out.defeated, ["bob", "carol"]);
  });

  it("defaults absent defeated to empty array", () => {
    jsonEqual(api.normalise({}).defeated, []);
  });

  it("preserves explicit coffeeUses=0", () => {
    assert.equal(api.normalise({ coffeeUses: 0 }).coffeeUses, 0);
  });

  it("defaults coffeeUses to 3 when absent", () => {
    assert.equal(api.normalise({}).coffeeUses, 3);
  });

  it("clamps coffeeUses to 0-3 range and coerces strings", () => {
    assert.equal(api.normalise({ coffeeUses: 5 }).coffeeUses, 3);
    assert.equal(api.normalise({ coffeeUses: -1 }).coffeeUses, 0);
    assert.equal(api.normalise({ coffeeUses: "2" }).coffeeUses, 2);
  });

  it("only accepts easy/hard as difficulty", () => {
    assert.equal(api.normalise({ difficulty: "easy" }).difficulty, "easy");
    assert.equal(api.normalise({ difficulty: "hard" }).difficulty, "hard");
    assert.equal(api.normalise({ difficulty: "normal" }).difficulty, "normal");
    assert.equal(api.normalise({ difficulty: "nonsense" }).difficulty, "normal");
    assert.equal(api.normalise({}).difficulty, "normal");
  });

  it("preserves seenCounter and floors negatives", () => {
    assert.equal(api.normalise({ seenCounter: 42 }).seenCounter, 42);
    assert.equal(api.normalise({ seenCounter: -5 }).seenCounter, 0);
    assert.equal(api.normalise({}).seenCounter, 0);
  });

  it("preserves libraryProgress and minigameScores", () => {
    const out = api.normalise({
      libraryProgress: { "book1": 5 },
      minigameScores: { "recall": 200 },
    });
    jsonEqual(out.libraryProgress, { "book1": 5 });
    jsonEqual(out.minigameScores, { "recall": 200 });
  });

  it("defaults libraryProgress/minigameScores when missing or malformed", () => {
    jsonEqual(api.normalise({}).libraryProgress, {});
    jsonEqual(api.normalise({ libraryProgress: "bad" }).libraryProgress, {});
    jsonEqual(api.normalise({ minigameScores: [] }).minigameScores, {});
  });
});

describe("DatamonState — future-version write protection", () => {
  let api;
  before(() => { api = loadApi(); });

  it("marks future schema as write-protected", () => {
    const out = api.normalise({ schemaVersion: 99 });
    assert.equal(out._writeProtected, true);
    assert.equal(out._futureVersion, 99);
    assert.equal(api.isWriteProtected(out), true);
  });

  it("does not write-protect current v2", () => {
    const out = api.normalise({ schemaVersion: 2 });
    assert.equal(out._writeProtected, undefined);
    assert.equal(api.isWriteProtected(out), false);
  });

  it("does not write-protect legacy (no version)", () => {
    const out = api.normalise({ player: "alice" });
    assert.equal(out._writeProtected, undefined);
    assert.equal(api.isWriteProtected(out), false);
  });

  it("isWriteProtected returns true for write-protected state", () => {
    assert.equal(api.isWriteProtected({ _writeProtected: true }), true);
    assert.equal(api.isWriteProtected({}), false);
  });
});

describe("DatamonState — telemetry migration", () => {
  let api;
  before(() => { api = loadApi(); });

  it("builds correct ID map from question bank", () => {
    const map = api.buildIdMapFromBank(TEST_BANK);
    jsonEqual(map, {
      "AGENT:0": "agent-001",
      "AGENT:1": "agent-002",
      "AGENT:2": "agent-003",
      "MCP:0": "mcp-001",
    });
  });

  it("legacyToCanonical and canonicalToLegacy resolve", () => {
    assert.equal(api.legacyToCanonical("AGENT:0"), "agent-001");
    assert.equal(api.legacyToCanonical("MCP:0"), "mcp-001");
    assert.equal(api.legacyToCanonical("UNKNOWN:5"), null);
    assert.equal(api.canonicalToLegacy("agent-001"), "AGENT:0");
    assert.equal(api.canonicalToLegacy("mcp-001"), "MCP:0");
    assert.equal(api.canonicalToLegacy("nobody"), null);
  });

  it("migrates legacy stats to canonical IDs", () => {
    const out = api.normalise({
      player: "alice",
      questionStats: { "AGENT:0": { seen: 5, correct: 3, wrong: 2, lastSeen: 10 } },
    });
    jsonEqual(out.questionStats["AGENT:0"], { seen: 5, correct: 3, wrong: 2, lastSeen: 10 });
    jsonEqual(out.questionStats["agent-001"], { seen: 5, correct: 3, wrong: 2, lastSeen: 10 });
  });

  it("reconciles a stronger canonical record into both aliases", () => {
    const out = api.normalise({
      player: "alice",
      questionStats: {
        "AGENT:0": { seen: 1, correct: 0, wrong: 1, lastSeen: 2 },
        "agent-001": { seen: 10, correct: 8, wrong: 2, lastSeen: 15 },
      },
    });
    jsonEqual(out.questionStats["agent-001"], { seen: 10, correct: 8, wrong: 2, lastSeen: 15 });
    jsonEqual(out.questionStats["AGENT:0"], { seen: 10, correct: 8, wrong: 2, lastSeen: 15 });
  });

  it("preserves unknown keys during migration", () => {
    const out = api.normalise({
      player: "alice",
      questionStats: { "MYSTERY:7": { seen: 3, correct: 1, wrong: 2, lastSeen: 5 } },
    });
    jsonEqual(out.questionStats["MYSTERY:7"], { seen: 3, correct: 1, wrong: 2, lastSeen: 5 });
  });

  it("mirrors canonical IDs to legacy aliases for rollback", () => {
    const out = api.normalise({
      player: "alice",
      questionStats: { "agent-001": { seen: 7, correct: 5, wrong: 2, lastSeen: 20 } },
    });
    // Canonical stays
    jsonEqual(out.questionStats["agent-001"], { seen: 7, correct: 5, wrong: 2, lastSeen: 20 });
    // Legacy alias is created from canonical
    jsonEqual(out.questionStats["AGENT:0"], { seen: 7, correct: 5, wrong: 2, lastSeen: 20 });
  });

  it("reconciles a stronger legacy record into both aliases", () => {
    const out = api.normalise({
      player: "alice",
      questionStats: {
        "agent-001": { seen: 7, correct: 5, wrong: 2, lastSeen: 20 },
        "AGENT:0": { seen: 10, correct: 8, wrong: 2, lastSeen: 25 },
      },
    });
    jsonEqual(out.questionStats["AGENT:0"], { seen: 10, correct: 8, wrong: 2, lastSeen: 25 });
    jsonEqual(out.questionStats["agent-001"], { seen: 10, correct: 8, wrong: 2, lastSeen: 25 });
  });

  it("normalisation is idempotent", () => {
    const input = {
      player: "alice",
      defeated: ["bob", "bob", "carol"],
      questionStats: { "AGENT:0": { seen: 5, correct: 3, wrong: 2, lastSeen: 10 } },
      seenCounter: 7,
      coffeeUses: 1,
      difficulty: "hard",
      libraryProgress: { b1: 3 },
      minigameScores: { m1: 100 },
    };
    const first = api.normalise(input);
    const second = api.normalise(first);
    jsonEqual(second, first);
  });

  it("normalises malformed stat entries to safe defaults", () => {
    const out = api.normalise({
      player: "alice",
      questionStats: {
        "AGENT:0": null,
        "AGENT:1": "not-an-object",
        "AGENT:2": { seen: -5, correct: "x", wrong: null, lastSeen: NaN },
      },
    });
    jsonEqual(out.questionStats["AGENT:0"], { seen: 0, correct: 0, wrong: 0, lastSeen: 0 });
    jsonEqual(out.questionStats["AGENT:1"], { seen: 0, correct: 0, wrong: 0, lastSeen: 0 });
    jsonEqual(out.questionStats["AGENT:2"], { seen: 0, correct: 0, wrong: 0, lastSeen: 0 });
  });
});

describe("DatamonState — progression fields", () => {
  let api;
  before(() => { api = loadApi(); });

  it("adds default progression fields to legacy saves", () => {
    const out = api.normalise({ player: "alice" });
    jsonEqual(out.progression, { badges: [], quests: {}, activities: {}, npcDomains: {} });
  });

  it("preserves existing progression data", () => {
    const out = api.normalise({
      player: "alice",
      progression: {
        badges: ["badge-1"],
        quests: { "q1": "active" },
        activities: { "a1": 5 },
        npcDomains: { "alice": "AGENT" },
      },
    });
    jsonEqual(out.progression, {
      badges: ["badge-1"],
      quests: { "q1": "active" },
      activities: { "a1": 5 },
      npcDomains: { "alice": "AGENT" },
    });
  });

  it("sanitises malformed progression sub-fields", () => {
    const out = api.normalise({
      player: "alice",
      progression: {
        badges: "not-array",
        quests: ["not-obj"],
        activities: null,
        npcDomains: 42,
      },
    });
    jsonEqual(out.progression.badges, []);
    jsonEqual(out.progression.quests, {});
    jsonEqual(out.progression.activities, {});
    jsonEqual(out.progression.npcDomains, {});
  });

  it("filters npcDomains to valid roster keys and domain values", () => {
    const out = api.normalise({
      player: "alice",
      progression: {
        npcDomains: {
          "bob": "AGENT",
          "carol": "MCP",
          "unknown": "AGENT",     // key not in roster — dropped
          "alice": "INVALID",      // value not a valid domain — dropped
          "bob2": "MIX",           // key not in roster
        },
      },
    });
    jsonEqual(out.progression.npcDomains, { "bob": "AGENT", "carol": "MCP" });
  });

  it("preserves empty npcDomains as empty object", () => {
    const out = api.normalise({ player: "alice", progression: { npcDomains: {} } });
    jsonEqual(out.progression.npcDomains, {});
  });
});

describe("DatamonState — resetSave", () => {
  let api;
  before(() => { api = loadApi(); });

  it("returns a clean defaults object", () => {
    jsonEqual(api.resetSave(), api.defaults());
  });
});

describe("DatamonState — safeClone", () => {
  let api;
  before(() => { api = loadApi(); });

  it("deep-clones objects without shared references", () => {
    const obj = { a: 1, b: { c: 2 } };
    const clone = api.safeClone(obj);
    jsonEqual(clone, obj);
    assert.notEqual(clone, obj);
    assert.notEqual(clone.b, obj.b);
  });

  it("returns null for null", () => {
    assert.equal(api.safeClone(null), null);
  });
});

describe("DatamonState — storage migration contract", () => {
  it("backs up a legacy save once and writes normalized v2", () => {
    const raw = JSON.stringify({ player: "alice", coffeeUses: 0, questionStats: { "AGENT:0": { seen: 2, correct: 1 } } });
    const storage = createStorage({ "datamon-save-v1": raw });
    const { api } = loadHarness(storage);
    const loaded = api.loadFromStorage();
    assert.equal(storage.getItem(api.BACKUP_KEY), raw);
    assert.equal(loaded.coffeeUses, 0);
    assert.equal(api.saveToStorage(loaded), true);
    const written = JSON.parse(storage.getItem(api.SAVE_KEY));
    assert.equal(written.schemaVersion, 2);
    assert.equal(written.questionStats["agent-001"].correct, 1);
    assert.equal(storage.getItem(api.BACKUP_KEY), raw);
  });

  it("preserves an existing backup instead of replacing it", () => {
    const storage = createStorage({
      "datamon-save-v1": JSON.stringify({ player: "alice" }),
      "datamon-save-v1-backup": "original-backup",
    });
    const { api } = loadHarness(storage);
    api.loadFromStorage();
    assert.equal(storage.getItem(api.BACKUP_KEY), "original-backup");
  });

  it("backs up malformed JSON and returns an empty load", () => {
    const storage = createStorage({ "datamon-save-v1": "{not-json" });
    const { api } = loadHarness(storage);
    assert.equal(api.loadFromStorage(), null);
    assert.equal(storage.getItem(api.BACKUP_KEY), "{not-json");
  });

  it("refuses to write a future-version state", () => {
    const raw = JSON.stringify({ schemaVersion: 99, player: "alice", futureField: true });
    const storage = createStorage({ "datamon-save-v1": raw });
    const { api } = loadHarness(storage);
    const loaded = api.loadFromStorage();
    assert.equal(api.isWriteProtected(loaded), true);
    assert.equal(api.saveToStorage(loaded), false);
    assert.equal(storage.getItem(api.SAVE_KEY), raw);
  });

  it("reset clears primary and backup storage", () => {
    const storage = createStorage({
      "datamon-save-v1": "future",
      "datamon-save-v1-backup": "legacy",
    });
    const { api } = loadHarness(storage);
    const reset = api.resetSave();
    assert.equal(storage.getItem(api.SAVE_KEY), null);
    assert.equal(storage.getItem(api.BACKUP_KEY), null);
    assert.equal(api.isWriteProtected(reset), false);
  });
});
