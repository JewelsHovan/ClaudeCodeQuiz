// Unit tests for datamon/battle-ops.js — Agent Operations pure reducer
// Tests: action economy, deterministic Inspect, Guardrail, duplicate-input
// rejection, boss phase gates, victory/defeat/escape, and all spec behaviors.
//
// Note: Since the reducer runs in a separate VM context, returned objects/arrays
// have different prototypes. Use jsonEqual (JSON round-trip) for structural
// comparisons across contexts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("datamon/battle-ops.js", "utf8");
const questionsSource = fs.readFileSync("datamon/questions.js", "utf8");

function loadHarness() {
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: "datamon/battle-ops.js" });
  return sandbox.window.DatamonBattleOps;
}

// Cross-context structural comparison
function jsonEqual(actual, expected, msg) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), msg);
}

// Helper question fixture — 4 choices, correct is index 2 ("C")
const Q = { id: "agent-001", q: "Test question?", c: ["A", "B", "C", "D"], correct: 2, a: 2, x: "Explanation", d: "easy" };

// Another fixture with a different correct answer for variety
const Q2 = { id: "agent-002", q: "Another question?", c: ["W", "X", "Y", "Z"], correct: 0, a: 0, x: "Ex2", d: "medium" };

function loadProductionAgentQuestions() {
  const sandbox = { window: {} };
  vm.runInNewContext(`${questionsSource}\nwindow.__AGENT_QUESTIONS__ = QUESTION_BANK.AGENT;`, sandbox, {
    filename: "datamon/questions.js",
  });
  return sandbox.window.__AGENT_QUESTIONS__;
}

describe("DatamonBattleOps — createEncounter defaults", () => {
  let api;
  it("loads the harness", () => { api = loadHarness(); assert.ok(api); });

  it("creates a regular (non-boss) encounter with defaults", () => {
    const enc = api.createEncounter();
    assert.equal(enc.phase, "action");
    assert.equal(enc.boss, false);
    assert.equal(enc.bossPhase, 0);
    assert.equal(enc.bossPhases, 1);
    assert.equal(enc.stability, 3);
    assert.equal(enc.maxStability, 3);
    assert.equal(enc.playerHp, 100);
    assert.equal(enc.momentum, 0);
    assert.equal(enc.guardrail, 0);
    assert.equal(enc.question, null);
    jsonEqual(enc.eliminated, []);
    assert.equal(enc.selectedAction, null);
  });

  it("creates a boss encounter when boss:true", () => {
    const enc = api.createEncounter({ boss: true });
    assert.equal(enc.boss, true);
    assert.equal(enc.bossPhases, 3);
    assert.equal(enc.stability, 3); // first phase cap = 3
    assert.equal(enc.maxStability, 3);
  });

  it("auto-detects boss: last undefeated AGENT npc", () => {
    const npcs = [
      { slug: "a", type: "AGENT", defeated: true },
      { slug: "b", type: "MCP", defeated: false },
      { slug: "c", type: "AGENT", defeated: false },
    ];
    const npc = npcs[2]; // "c" — the only undefeated AGENT
    const enc = api.createEncounter({ npc, npcs });
    assert.equal(enc.boss, true);
    assert.equal(enc.bossPhases, 3);
  });

  it("does NOT auto-detect boss when multiple undefeated AGENTs", () => {
    const npcs = [
      { slug: "a", type: "AGENT", defeated: false },
      { slug: "b", type: "AGENT", defeated: false },
    ];
    const enc = api.createEncounter({ npc: npcs[0], npcs });
    assert.equal(enc.boss, false);
    assert.equal(enc.bossPhases, 1);
  });

  it("respects explicit playerHp", () => {
    const enc = api.createEncounter({ playerHp: 50 });
    assert.equal(enc.playerHp, 50);
  });

  it("clamps negative playerHp to 0", () => {
    const enc = api.createEncounter({ playerHp: -10 });
    assert.equal(enc.playerHp, 0);
  });

  it("accepts bounded attribute-derived HP, miss damage, and correct healing", () => {
    const enc = api.createEncounter({ maxHp: 110, playerHp: 999, wrongDamage: 21, correctHeal: 8 });
    assert.equal(enc.maxHp, 110);
    assert.equal(enc.playerHp, 110);
    assert.equal(enc.wrongDamage, 21);
    assert.equal(enc.correctHeal, 8);
  });
});

describe("DatamonBattleOps — isLastUndefeatedAgent", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("returns false for non-AGENT npc", () => {
    assert.equal(api.isLastUndefeatedAgent({ type: "MCP" }, []), false);
  });

  it("returns true when only one undefeated AGENT", () => {
    const npcs = [
      { type: "AGENT", defeated: true },
      { type: "AGENT", defeated: false },
      { type: "MCP", defeated: false },
    ];
    assert.equal(api.isLastUndefeatedAgent(npcs[1], npcs), true);
  });

  it("returns false when multiple undefeated AGENTs", () => {
    const npcs = [
      { type: "AGENT", defeated: false },
      { type: "AGENT", defeated: false },
    ];
    assert.equal(api.isLastUndefeatedAgent(npcs[0], npcs), false);
  });

  it("requires the current undefeated AGENT to be present in the NPC list", () => {
    const current = { slug: "current", type: "AGENT", defeated: false };
    assert.equal(api.isLastUndefeatedAgent(current, null), false);
    assert.equal(api.isLastUndefeatedAgent(current, []), false);
    assert.equal(api.isLastUndefeatedAgent(current, [
      { slug: "copy", type: "AGENT", defeated: false },
    ]), false);
  });

  it("rejects a defeated current AGENT even when it is the only AGENT", () => {
    const current = { type: "AGENT", defeated: true };
    assert.equal(api.isLastUndefeatedAgent(current, [current]), false);
  });
});

describe("DatamonBattleOps — reduce: START_TURN", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("transitions from action to action with a new question", () => {
    const enc = api.createEncounter();
    const r = api.reduce(enc, { type: "START_TURN", question: Q });
    assert.equal(r.state.phase, "action");
    assert.equal(r.state.question.id, Q.id);
    jsonEqual(r.state.eliminated, []);
    assert.equal(r.state.selectedAction, null);
    jsonEqual(r.effects, []);
  });

  it("transitions from feedback to action for the next turn", () => {
    let s = api.createEncounter();
    s.phase = "feedback";
    s.momentum = 2;
    s.question = Q;
    const r = api.reduce(s, { type: "START_TURN", question: Q2 });
    assert.equal(r.state.phase, "action");
    assert.equal(r.state.question.id, Q2.id);
    // momentum preserved across turns
    assert.equal(r.state.momentum, 2);
  });

  it("transitions from phase-shift to action", () => {
    let s = api.createEncounter({ boss: true });
    s.phase = "phase-shift";
    const r = api.reduce(s, { type: "START_TURN", question: Q });
    assert.equal(r.state.phase, "action");
  });

  it("does NOT start turn during choice/resolve/victory/defeat", () => {
    for (const blockedPhase of ["choice", "resolve", "victory", "defeat", "escaped"]) {
      let s = api.createEncounter();
      s.phase = blockedPhase;
      const r = api.reduce(s, { type: "START_TURN", question: Q });
      // State should be structurally unchanged (structural compare via JSON)
      jsonEqual(r.state, s, `START_TURN should be rejected in ${blockedPhase}`);
    }
  });
});

describe("DatamonBattleOps — reduce: SELECT_ACTION (action economy)", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("Query costs 0 momentum and transitions to choice", () => {
    let s = api.createEncounter();
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    const r = api.reduce(s, { type: "SELECT_ACTION", action: "query" });
    assert.equal(r.state.phase, "choice");
    assert.equal(r.state.selectedAction, "query");
    assert.equal(r.state.momentum, 0); // 0 - 0 = 0
  });

  it("Inspect costs 1 momentum", () => {
    let s = api.createEncounter();
    s.momentum = 2;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    const r = api.reduce(s, { type: "SELECT_ACTION", action: "inspect" });
    assert.equal(r.state.phase, "choice");
    assert.equal(r.state.selectedAction, "inspect");
    assert.equal(r.state.momentum, 1); // 2 - 1 = 1
  });

  it("Patch costs 2 momentum", () => {
    let s = api.createEncounter();
    s.momentum = 3;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    const r = api.reduce(s, { type: "SELECT_ACTION", action: "patch" });
    assert.equal(r.state.phase, "choice");
    assert.equal(r.state.selectedAction, "patch");
    assert.equal(r.state.momentum, 1); // 3 - 2 = 1
    assert.equal(r.state.guardrail, 1);
  });

  it("Escalate costs 3 momentum", () => {
    let s = api.createEncounter();
    s.momentum = 3;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    const r = api.reduce(s, { type: "SELECT_ACTION", action: "escalate" });
    assert.equal(r.state.phase, "choice");
    assert.equal(r.state.selectedAction, "escalate");
    assert.equal(r.state.momentum, 0); // 3 - 3 = 0
  });

  it("rejects action with insufficient momentum", () => {
    let s = api.createEncounter();
    s.momentum = 0;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    const r = api.reduce(s, { type: "SELECT_ACTION", action: "inspect" });
    jsonEqual(r.state, s, "state should be unchanged when action rejected");
    assert.equal(r.effects[0].type, "ACTION_REJECTED");
  });

  it("rejects unknown action", () => {
    let s = api.createEncounter();
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    const r = api.reduce(s, { type: "SELECT_ACTION", action: "nonexistent" });
    jsonEqual(r.state, s);
    assert.equal(r.effects[0].type, "ACTION_REJECTED");
  });

  it("rejects SELECT_ACTION outside action phase", () => {
    let s = api.createEncounter();
    s.phase = "choice";
    const r = api.reduce(s, { type: "SELECT_ACTION", action: "query" });
    jsonEqual(r.state, s);
  });
});

describe("DatamonBattleOps — reduce: deterministic Inspect elimination", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("elimIndexes returns exactly 2 indexes for a 4-choice question", () => {
    const eliminated = api.elimIndexes(Q);
    assert.equal(eliminated.length, 2);
    assert.ok(eliminated.every(i => i >= 0 && i < 4));
  });

  it("elimIndexes NEVER includes the correct index", () => {
    const fixtures = [
      { id: "test-001", c: ["a", "b", "c", "d"], correct: 0 },
      { id: "test-002", c: ["w", "x", "y", "z"], correct: 1 },
      { id: "test-003", c: ["1", "2", "3", "4"], correct: 2 },
      { id: "test-004", c: ["!", "@", "#", "$"], correct: 3 },
    ];
    for (const q of fixtures) {
      for (let trial = 0; trial < 5; trial++) {
        const eliminated = api.elimIndexes(q);
        assert.ok(!eliminated.includes(q.correct),
          `elimIndexes must not include correct=${q.correct}, got [${eliminated}] for ${q.id}`);
      }
    }
  });

  it("elimIndexes is deterministic for a given question id", () => {
    const e1 = api.elimIndexes(Q);
    const e2 = api.elimIndexes(Q);
    jsonEqual(e1, e2);
  });

  it("Inspect action sets eliminated indexes and emits INSPECT_ELIMINATED effect", () => {
    let s = api.createEncounter();
    s.momentum = 2;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    const r = api.reduce(s, { type: "SELECT_ACTION", action: "inspect" });
    assert.equal(r.state.eliminated.length, 2);
    assert.ok(!r.state.eliminated.includes(Q.correct));
    assert.equal(r.effects.some(e => e.type === "INSPECT_ELIMINATED"), true);
  });

  it("validates deterministic Inspect elimination against all 24 production AGENT questions", () => {
    const questions = loadProductionAgentQuestions();
    assert.equal(questions.length, 24);
    for (const question of questions) {
      assert.equal(question.c.length, 4, `${question.id} must have four choices`);
      assert.ok(Number.isInteger(question.a) && question.a >= 0 && question.a < question.c.length,
        `${question.id} must have an in-range answer`);
      const eliminated = api.elimIndexes(question);
      assert.equal(eliminated.length, 2, `${question.id} must eliminate exactly two choices`);
      assert.equal(new Set(eliminated).size, 2, `${question.id} eliminations must be unique`);
      assert.ok(eliminated.every(index => Number.isInteger(index) && index >= 0 && index < question.c.length));
      assert.ok(!eliminated.includes(question.a), `${question.id} must preserve its correct answer`);
    }
  });
});

describe("DatamonBattleOps — reduce: SUBMIT_ANSWER (correct answers)", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("Query correct: -1 stability, +1 momentum", () => {
    let s = api.createEncounter();
    s.momentum = 1;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    assert.equal(s.momentum, 1); // spent 0
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 });
    assert.equal(r.state.stability, 2); // 3 - 1
    assert.equal(r.state.momentum, 2); // 1 + 1
    assert.equal(r.effects.find(e => e.type === "STABILITY_DAMAGE").amount, 1);
  });

  it("Inspect correct: -1 stability, +1 momentum", () => {
    let s = api.createEncounter();
    s.momentum = 1;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "inspect" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 });
    assert.equal(r.state.stability, 2);
    assert.equal(r.state.momentum, 1); // spent 1, gained 1
  });

  it("Patch correct: -1 stability, +1 momentum", () => {
    let s = api.createEncounter();
    s.momentum = 2;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "patch" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 });
    assert.equal(r.state.stability, 2);
    assert.equal(r.state.momentum, 1); // spent 2, gained 1
    assert.equal(r.state.guardrail, 1); // guardrail preserved on correct
  });

  it("Escalate correct: -2 stability, +1 momentum", () => {
    let s = api.createEncounter();
    s.momentum = 3;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "escalate" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 });
    assert.equal(r.state.stability, 1); // 3 - 2
    assert.equal(r.state.momentum, 1); // spent 3, gained 1
  });

  it("momentum never exceeds MAX_MOMENTUM (3)", () => {
    let s = api.createEncounter();
    s.momentum = 3;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 });
    assert.equal(r.state.momentum, 3); // capped at 3
  });

  it("correct answer emits RECORD_OUTCOME with correct:true", () => {
    let s = api.createEncounter();
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 });
    const outcome = r.effects.find(e => e.type === "RECORD_OUTCOME");
    assert.ok(outcome);
    assert.equal(outcome.correct, true);
    assert.equal(outcome.questionId, "agent-001");
  });

  it("correct answer heals by the configured amount without exceeding max HP", () => {
    let s = api.createEncounter({ maxHp: 110, playerHp: 105, correctHeal: 8 });
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 });
    assert.equal(r.state.playerHp, 110);
    assert.equal(r.state.outcome.healed, 5);
    jsonEqual(r.effects.find(e => e.type === "PLAYER_HEAL"), { type: "PLAYER_HEAL", amount: 5 });
  });
});

describe("DatamonBattleOps — reduce: SUBMIT_ANSWER (wrong answers)", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("wrong answer resets momentum to 0", () => {
    let s = api.createEncounter();
    s.momentum = 3;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 0 }); // wrong
    assert.equal(r.state.momentum, 0);
  });

  it("wrong answer deals PLAYER_DAMAGE when no guardrail", () => {
    let s = api.createEncounter();
    s.momentum = 1;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 0 });
    assert.equal(r.state.playerHp, 75); // 100 - 25
    assert.ok(r.effects.find(e => e.type === "PLAYER_DAMAGE"));
  });

  it("wrong answer uses configured matchup damage", () => {
    let s = api.createEncounter({ maxHp: 110, playerHp: 110, wrongDamage: 21 });
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 0 });
    assert.equal(r.state.playerHp, 89);
    jsonEqual(r.effects.find(e => e.type === "PLAYER_DAMAGE"), { type: "PLAYER_DAMAGE", amount: 21 });
  });

  it("wrong answer consumes guardrail instead of HP damage", () => {
    let s = api.createEncounter();
    s.momentum = 1;
    s.guardrail = 1;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 0 });
    assert.equal(r.state.playerHp, 100); // unchanged
    assert.equal(r.state.guardrail, 0); // consumed
    assert.ok(r.effects.find(e => e.type === "GUARDRAIL_BLOCK"));
    assert.equal(r.effects.find(e => e.type === "PLAYER_DAMAGE"), undefined);
  });

  it("wrong answer still records outcome and marks the hit blocked with guardrail", () => {
    let s = api.createEncounter();
    s.momentum = 1;
    s.guardrail = 1;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 0 });
    const outcome = r.effects.find(e => e.type === "RECORD_OUTCOME");
    assert.ok(outcome);
    assert.equal(outcome.correct, false);
    assert.equal(r.state.outcome.blocked, true);
  });

  it("rejects eliminated, negative, out-of-range, fractional, and non-numeric answers", () => {
    let s = api.createEncounter();
    s.momentum = 1;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "inspect" }).state;
    const invalid = [s.eliminated[0], -1, Q.c.length, 1.5, "2", null, undefined];
    for (const index of invalid) {
      const r = api.reduce(s, { type: "SUBMIT_ANSWER", index });
      jsonEqual(r.state, s, `answer ${String(index)} must be rejected`);
      jsonEqual(r.effects, [], `answer ${String(index)} must not emit effects`);
    }
  });
});

describe("DatamonBattleOps — reduce: TIMEOUT", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("TIMEOUT resets momentum and deals damage", () => {
    let s = api.createEncounter();
    s.momentum = 2;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "TIMEOUT" });
    assert.equal(r.state.momentum, 0);
    assert.equal(r.state.playerHp, 75);
    const outcome = r.effects.find(e => e.type === "RECORD_OUTCOME");
    assert.ok(outcome);
    assert.equal(outcome.correct, false);
    assert.equal(outcome.reason, "timeout");
  });

  it("TIMEOUT uses configured matchup damage", () => {
    let s = api.createEncounter({ maxHp: 96, playerHp: 96, wrongDamage: 29 });
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "TIMEOUT" });
    assert.equal(r.state.playerHp, 67);
    jsonEqual(r.effects.find(e => e.type === "PLAYER_DAMAGE"), { type: "PLAYER_DAMAGE", amount: 29 });
  });

  it("TIMEOUT consumes guardrail first and records that HP damage was blocked", () => {
    let s = api.createEncounter();
    s.momentum = 2;
    s.guardrail = 1;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "TIMEOUT" });
    assert.equal(r.state.playerHp, 100);
    assert.equal(r.state.guardrail, 0);
    assert.equal(r.state.outcome.blocked, true);
    assert.ok(r.effects.find(e => e.type === "GUARDRAIL_BLOCK"));
  });

  it("TIMEOUT ignored outside choice phase", () => {
    let s = api.createEncounter();
    s.phase = "action";
    const r = api.reduce(s, { type: "TIMEOUT" });
    jsonEqual(r.state, s);
    jsonEqual(r.effects, []);
  });
});

describe("DatamonBattleOps — reduce: duplicate input rejection", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("second SUBMIT_ANSWER in resolve phase is ignored", () => {
    let s = api.createEncounter();
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    let r1 = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 });
    assert.equal(r1.state.phase, "resolve");
    // Duplicate submission — should be ignored (no change, no effects)
    let r2 = api.reduce(r1.state, { type: "SUBMIT_ANSWER", index: 1 });
    jsonEqual(r2.state, r1.state, "duplicate submit should not change state");
    jsonEqual(r2.effects, [], "duplicate submit should produce no effects");
  });

  it("SUBMIT_ANSWER in action phase is ignored", () => {
    let s = api.createEncounter();
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 });
    jsonEqual(r.state, s);
    jsonEqual(r.effects, []);
  });

  it("TIMEOUT in resolve phase is ignored", () => {
    let s = api.createEncounter();
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    s = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 }).state;
    const r = api.reduce(s, { type: "TIMEOUT" });
    jsonEqual(r.state, s);
    jsonEqual(r.effects, []);
  });

  it("duplicate TIMEOUT in resolve phase is ignored", () => {
    let s = api.createEncounter();
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    // Timeout moves to resolve
    s = api.reduce(s, { type: "TIMEOUT" }).state;
    assert.equal(s.phase, "resolve");
    // Second timeout should be ignored
    const r = api.reduce(s, { type: "TIMEOUT" });
    jsonEqual(r.state, s);
    jsonEqual(r.effects, []);
  });
});

describe("DatamonBattleOps — reduce: RESOLUTION_COMPLETE and victory", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("regular encounter: 0 stability -> victory", () => {
    let s = api.createEncounter();
    s.stability = 1;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    s = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 }).state; // correct: stability -> 0
    assert.equal(s.stability, 0);
    const r = api.reduce(s, { type: "RESOLUTION_COMPLETE" });
    assert.equal(r.state.phase, "victory");
    assert.ok(r.effects.find(e => e.type === "VICTORY"));
  });

  it("regular encounter: stability > 0 -> feedback (turn continues)", () => {
    let s = api.createEncounter();
    s.stability = 2;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    s = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 }).state; // correct: stability -> 1
    const r = api.reduce(s, { type: "RESOLUTION_COMPLETE" });
    assert.equal(r.state.phase, "feedback");
    jsonEqual(r.effects, []);
  });

  it("regular encounter: playerHp <= 0 -> defeat", () => {
    let s = api.createEncounter();
    s.playerHp = 25;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    s = api.reduce(s, { type: "SUBMIT_ANSWER", index: 0 }).state; // wrong: HP 25 - 25 = 0
    const r = api.reduce(s, { type: "RESOLUTION_COMPLETE" });
    assert.equal(r.state.phase, "defeat");
    assert.ok(r.effects.find(e => e.type === "DEFEAT"));
  });

  it("RESOLUTION_COMPLETE ignored outside resolve phase", () => {
    let s = api.createEncounter();
    s.phase = "choice";
    const r = api.reduce(s, { type: "RESOLUTION_COMPLETE" });
    jsonEqual(r.state, s);
    jsonEqual(r.effects, []);
  });
});

describe("DatamonBattleOps — reduce: boss three-phase traversal", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("boss phase 1 (3/3) -> phase 2 (4/4) on stability 0", () => {
    let s = api.createEncounter({ boss: true });
    // Setup: momentum=3 for escalate, stability=1, correct answer deals -2 via escalate
    s.momentum = 3;
    s.stability = 1;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "escalate" }).state;
    assert.equal(s.phase, "choice");
    assert.equal(s.momentum, 0); // spent 3
    s = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 }).state; // Escalate correct: -2
    assert.equal(s.stability, 0, "stability should be 0 after Escalate hit");
    const r = api.reduce(s, { type: "RESOLUTION_COMPLETE" });
    assert.equal(r.state.phase, "phase-shift");
    assert.equal(r.state.bossPhase, 1);
    assert.equal(r.state.stability, 4);
    assert.equal(r.state.maxStability, 4);
    assert.ok(r.effects.find(e => e.type === "PHASE_SHIFT"));
  });

  it("boss phase 2 (4/4) -> phase 3 (5/5)", () => {
    let s = api.createEncounter({ boss: true });
    s.bossPhase = 1;
    s.stability = 4;
    s.maxStability = 4;
    s.momentum = 3;
    // Use 4 queries, each correct: stability 4 -> 3 -> 2 -> 1 -> 0
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    s = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 }).state; // +1 momentum (now 1)
    s = api.reduce(s, { type: "RESOLUTION_COMPLETE" }).state; // feedback
    assert.equal(s.stability, 3);
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    s = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 }).state; // +1 momentum (now 2)
    s = api.reduce(s, { type: "RESOLUTION_COMPLETE" }).state; // feedback
    assert.equal(s.stability, 2);
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    s = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 }).state; // +1 momentum (now 3)
    s = api.reduce(s, { type: "RESOLUTION_COMPLETE" }).state; // feedback
    assert.equal(s.stability, 1);
    // Final hit with Escalate (costs 3, deals 2)
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "escalate" }).state;
    s = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 }).state;
    assert.equal(s.stability, 0);
    const r = api.reduce(s, { type: "RESOLUTION_COMPLETE" });
    assert.equal(r.state.phase, "phase-shift");
    assert.equal(r.state.bossPhase, 2);
    assert.equal(r.state.stability, 5);
    assert.equal(r.state.maxStability, 5);
  });

  it("boss phase 3 (5/5) -> victory (final phase)", () => {
    let s = api.createEncounter({ boss: true });
    s.bossPhase = 2;
    s.stability = 5;
    s.maxStability = 5;
    s.momentum = 3;
    // Use queries to drain: 5 -> 4 -> 3 -> 2 -> 1 -> escalate(-2) -> 0
    for (let i = 0; i < 4; i++) {
      s = api.reduce(s, { type: "START_TURN", question: Q }).state;
      s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
      s = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 }).state;
      s = api.reduce(s, { type: "RESOLUTION_COMPLETE" }).state;
    }
    assert.equal(s.stability, 1);
    assert.equal(s.momentum, 3); // capped at 3 from all those +1s
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "escalate" }).state;
    s = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 }).state;
    assert.equal(s.stability, 0);
    const r = api.reduce(s, { type: "RESOLUTION_COMPLETE" });
    assert.equal(r.state.phase, "victory");
    assert.ok(r.effects.find(e => e.type === "VICTORY"));
  });

  it("boss cannot skip phases — stability 0 in phase 1 shifts, not wins", () => {
    let s = api.createEncounter({ boss: true });
    s.stability = 0; // force stability 0
    s.phase = "resolve";
    const r = api.reduce(s, { type: "RESOLUTION_COMPLETE" });
    assert.equal(r.state.phase, "phase-shift");
    assert.notEqual(r.state.phase, "victory");
  });

  it("momentum and guardrail carry across boss phase shifts", () => {
    let s = api.createEncounter({ boss: true });
    s.momentum = 2;
    s.guardrail = 1;
    s.stability = 0;
    s.phase = "resolve";
    const r = api.reduce(s, { type: "RESOLUTION_COMPLETE" });
    assert.equal(r.state.phase, "phase-shift");
    assert.equal(r.state.momentum, 2);
    assert.equal(r.state.guardrail, 1);
  });
});

describe("DatamonBattleOps — reduce: RUN (escape)", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("RUN from action phase sets phase to escaped", () => {
    let s = api.createEncounter();
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    const r = api.reduce(s, { type: "RUN" });
    assert.equal(r.state.phase, "escaped");
    assert.ok(r.effects.find(e => e.type === "ESCAPED"));
  });

  it("RUN from choice phase sets phase to escaped", () => {
    let s = api.createEncounter();
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "RUN" });
    assert.equal(r.state.phase, "escaped");
  });

  it("RUN ignored in resolve/feedback/victory/defeat", () => {
    for (const blockedPhase of ["resolve", "feedback", "victory", "defeat", "escaped"]) {
      let s = api.createEncounter();
      s.phase = blockedPhase;
      const r = api.reduce(s, { type: "RUN" });
      jsonEqual(r.state, s, `RUN should be ignored in ${blockedPhase}`);
    }
  });
});

describe("DatamonBattleOps — reduce: edge cases and state integrity", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("reduce with null state returns state unchanged", () => {
    const r = api.reduce(null, { type: "START_TURN" });
    assert.equal(r.state, null);
    jsonEqual(r.effects, []);
  });

  it("reduce with null event returns state unchanged", () => {
    const s = api.createEncounter();
    const r = api.reduce(s, null);
    jsonEqual(r.state, s);
  });

  it("unknown event type is a no-op", () => {
    const s = api.createEncounter();
    const r = api.reduce(s, { type: "UNKNOWN_EVENT" });
    jsonEqual(r.state, s, "unknown event should not change state");
  });

  it("playerHp never goes below 0", () => {
    let s = api.createEncounter();
    s.playerHp = 10;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 0 }); // wrong
    assert.equal(r.state.playerHp, 0);
  });

  it("stability never goes below 0", () => {
    let s = api.createEncounter();
    s.momentum = 3;
    s.stability = 1;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "escalate" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 }); // correct Escalate: -2
    assert.equal(r.state.stability, 0);
  });

  it("guardrail cannot exceed 1 (Patch while guardrail already active)", () => {
    let s = api.createEncounter();
    s.momentum = 2;
    s.guardrail = 1; // already have one
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "patch" }).state;
    assert.equal(s.guardrail, 1); // stays at max 1
  });

  it("correct answer preserves guardrail (doesn't consume it)", () => {
    let s = api.createEncounter();
    s.momentum = 1;
    s.guardrail = 1;
    s = api.reduce(s, { type: "START_TURN", question: Q }).state;
    s = api.reduce(s, { type: "SELECT_ACTION", action: "query" }).state;
    const r = api.reduce(s, { type: "SUBMIT_ANSWER", index: 2 }); // correct
    assert.equal(r.state.guardrail, 1); // preserved
  });

  it("RESOLUTION_COMPLETE emits exactly one effect for victory/defeat/phase-shift", () => {
    // Defeat path
    let s = api.createEncounter();
    s.playerHp = 0;
    s.phase = "resolve";
    let r = api.reduce(s, { type: "RESOLUTION_COMPLETE" });
    assert.equal(r.state.phase, "defeat");
    assert.equal(r.effects.length, 1);
    assert.equal(r.effects[0].type, "DEFEAT");

    // Victory path (regular)
    s = api.createEncounter();
    s.stability = 0;
    s.phase = "resolve";
    r = api.reduce(s, { type: "RESOLUTION_COMPLETE" });
    assert.equal(r.state.phase, "victory");
    assert.equal(r.effects.length, 1);
    assert.equal(r.effects[0].type, "VICTORY");

    // Phase shift path
    s = api.createEncounter({ boss: true });
    s.stability = 0;
    s.phase = "resolve";
    r = api.reduce(s, { type: "RESOLUTION_COMPLETE" });
    assert.equal(r.state.phase, "phase-shift");
    assert.equal(r.effects.length, 1);
    assert.equal(r.effects[0].type, "PHASE_SHIFT");
  });
});

describe("DatamonBattleOps — constants export", () => {
  let api;
  it("loads", () => { api = loadHarness(); });

  it("PHASES contains all 8 phases", () => {
    jsonEqual(api.PHASES, ["action", "choice", "resolve", "feedback", "phase-shift", "victory", "defeat", "escaped"]);
  });

  it("ACTION_KEYS lists all 4 actions", () => {
    jsonEqual(api.ACTION_KEYS, ["query", "inspect", "patch", "escalate"]);
  });

  it("ACTIONS have correct costs", () => {
    assert.equal(api.ACTIONS.query.cost, 0);
    assert.equal(api.ACTIONS.inspect.cost, 1);
    assert.equal(api.ACTIONS.patch.cost, 2);
    assert.equal(api.ACTIONS.escalate.cost, 3);
    assert.equal(api.ACTIONS.escalate.damage, 2);
  });

  it("MAX_MOMENTUM is 3", () => {
    assert.equal(api.MAX_MOMENTUM, 3);
  });

  it("GUARDRAIL_MAX is 1", () => {
    assert.equal(api.GUARDRAIL_MAX, 1);
  });

  it("WRONG_DAMAGE is 25", () => {
    assert.equal(api.WRONG_DAMAGE, 25);
  });
});
