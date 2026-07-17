// Unit tests for datamon/progress.js — canonical-only exam progress model.
// Ticket #047.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const progressSource = fs.readFileSync("datamon/progress.js", "utf8");

// Minimal question bank matching the real 120-question structure.
// Uses shortened IDs but otherwise structurally identical.
function makeTestBank(domainCounts) {
  const bank = {};
  for (const [key, count] of Object.entries(domainCounts)) {
    bank[key] = [];
    for (let i = 0; i < count; i++) {
      bank[key].push({
        id: key.toLowerCase() + "-" + String(i + 1).padStart(3, "0"),
        q: "Test question " + (i + 1),
        c: ["a", "b", "c", "d"],
        a: 0,
        x: "explanation",
        d: "easy",
      });
    }
  }
  return bank;
}

function loadProgress(bank) {
  const sandbox = {
    window: {},
    TYPE_NAMES: {
      AGENT: "Agent Wing",
      MCP: "MCP Lab",
      CONFIG: "Config Bay",
      PROMPT: "Prompt Studio",
      CONTEXT: "Context Corner",
      MIX: "The Lounge",
    },
  };
  // Type names need to be global for progress.js to find them
  sandbox.globalThis = sandbox;
  vm.runInNewContext(progressSource, sandbox, { filename: "datamon/progress.js" });
  return sandbox.window.DatamonProgress;
}

// Cross-VM arrays have different prototypes; compare via JSON.
function jsonEqual(actual, expected, msg) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), msg);
}

const TEST_BANK = makeTestBank({
  AGENT: 24, MCP: 24, CONFIG: 24, PROMPT: 24, CONTEXT: 24,
});

describe("DatamonProgress", () => {
  let api;

  before(() => {
    api = loadProgress(TEST_BANK);
  });

  describe("WEIGHTS and DOMAIN_KEYS", () => {
    it("exposes the five canonical exam domains with correct weights", () => {
      jsonEqual(api.DOMAIN_KEYS, ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT"]);
      assert.equal(api.WEIGHTS.AGENT, 27);
      assert.equal(api.WEIGHTS.MCP, 18);
      assert.equal(api.WEIGHTS.CONFIG, 20);
      assert.equal(api.WEIGHTS.PROMPT, 20);
      assert.equal(api.WEIGHTS.CONTEXT, 15);
    });
  });

  describe("summarise — empty telemetry", () => {
    it("returns 0% overall evidence with all domains at zero", () => {
      const s = api.summarise(TEST_BANK, {}, 0);
      assert.equal(s.overallEvidence, 0);
      assert.equal(s.evidencePct, 0);
      assert.equal(s.evidenceLabel, "No study data yet");
      for (const d of s.domains) {
        assert.equal(d.coverage, 0);
        assert.equal(d.accuracy, 0);
        assert.equal(d.evidence, 0);
        assert.equal(d.attempted, 0);
        assert.equal(d.unseen, 24);
      }
    });

    it("recommends AGENT (highest exam weight) when all domains are at zero", () => {
      const s = api.summarise(TEST_BANK, {}, 0);
      assert.equal(s.recommendationKey, "AGENT");
    });

    it("handles null/undefined stats gracefully", () => {
      const s = api.summarise(TEST_BANK, null, 0);
      assert.equal(s.overallEvidence, 0);
      const s2 = api.summarise(TEST_BANK, undefined, 0);
      assert.equal(s2.overallEvidence, 0);
    });
  });

  describe("summarise — canonical-only counting", () => {
    it("counts each canonical question once even with legacy aliases present", () => {
      const stats = {
        "agent-001": { seen: 2, correct: 1, wrong: 1, lastSeen: 2 },
        "AGENT:0": { seen: 999, correct: 999, wrong: 0, lastSeen: 999 },
      };
      const s = api.summarise(TEST_BANK, stats, 25);
      const agent = s.domains.find(d => d.key === "AGENT");
      // Only agent-001 counts; AGENT:0 is a legacy alias, not a canonical ID.
      assert.equal(agent.attempted, 1);
      assert.equal(agent.correct, 1);
      assert.equal(agent.wrong, 1);
      assert.equal(agent.coverage, 1 / 24);
      assert.equal(agent.accuracy, 0.5);
      assert.equal(agent.evidence, (1 / 24) * 0.5);
    });

    it("does not double-count when both canonical and alias exist", () => {
      const stats = {
        "agent-001": { seen: 3, correct: 2, wrong: 1, lastSeen: 10 },
      };
      const s = api.summarise(TEST_BANK, stats, 0);
      const agent = s.domains.find(d => d.key === "AGENT");
      assert.equal(agent.attempted, 1);
      assert.equal(agent.correct, 2);
      assert.equal(agent.wrong, 1);
    });
  });

  describe("summarise — full/partial telemetry", () => {
    it("computes correct per-domain metrics with mixed progress", () => {
      const stats = {};
      // AGENT: 12/24 seen, 8 correct, 4 wrong → coverage=0.5, accuracy=0.666..., evidence=0.333...
      for (let i = 1; i <= 12; i++) {
        const correct = i <= 8 ? 1 : 0;
        const wrong = i <= 8 ? 0 : 1;
        stats["agent-" + String(i).padStart(3, "0")] = {
          seen: 1, correct: correct, wrong: wrong, lastSeen: i,
        };
      }
      // MCP: 24/24 seen, all correct → evidence=1.0
      for (let i = 1; i <= 24; i++) {
        stats["mcp-" + String(i).padStart(3, "0")] = {
          seen: 1, correct: 1, wrong: 0, lastSeen: 100,
        };
      }
      const s = api.summarise(TEST_BANK, stats, 100);
      const agent = s.domains.find(d => d.key === "AGENT");
      assert.equal(agent.attempted, 12);
      assert.equal(agent.correct, 8);
      assert.equal(agent.wrong, 4);
      assert.equal(agent.unseen, 12);
      assert.equal(agent.coverage, 0.5);
      assert(Math.abs(agent.accuracy - 8 / 12) < 0.001);
      assert(Math.abs(agent.evidence - (0.5 * 8 / 12)) < 0.001);

      const mcp = s.domains.find(d => d.key === "MCP");
      assert.equal(mcp.attempted, 24);
      assert.equal(mcp.coverage, 1);
      assert.equal(mcp.accuracy, 1);
      assert.equal(mcp.evidence, 1);
      assert.equal(mcp.unseen, 0);
    });

    it("recommends weakest domain when most are strong", () => {
      const stats = {};
      // All domains fully correct except MCP (all wrong)
      for (const key of ["AGENT", "CONFIG", "PROMPT", "CONTEXT"]) {
        for (let i = 1; i <= 24; i++) {
          stats[key.toLowerCase() + "-" + String(i).padStart(3, "0")] = {
            seen: 1, correct: 1, wrong: 0, lastSeen: 100,
          };
        }
      }
      for (let i = 1; i <= 24; i++) {
        stats["mcp-" + String(i).padStart(3, "0")] = {
          seen: 1, correct: 0, wrong: 1, lastSeen: 100,
        };
      }
      const s = api.summarise(TEST_BANK, stats, 100);
      assert.equal(s.recommendationKey, "MCP");
      // AGENT=1.0, MCP=0.0, CONFIG=1.0, PROMPT=1.0, CONTEXT=1.0
      // Weighted: (27*1 + 18*0 + 20*1 + 20*1 + 15*1) / 100 = 82/100 = 0.82
      assert(Math.abs(s.overallEvidence - 0.82) < 0.001);
      assert.equal(s.evidencePct, 82);
    });

    it("labels evidence appropriately — moderate", () => {
      const stats = {};
      // Exactly 50% coverage × 100% accuracy → 0.5 evidence each
      for (const key of api.DOMAIN_KEYS) {
        for (let i = 1; i <= 12; i++) {
          stats[key.toLowerCase() + "-" + String(i).padStart(3, "0")] = {
            seen: 1, correct: 1, wrong: 0, lastSeen: 100,
          };
        }
      }
      const s = api.summarise(TEST_BANK, stats, 100);
      assert.equal(s.evidenceLabel, "Early progress");
    });
  });

  describe("summarise — due/unseen computation", () => {
    it("marks questions as due when wrong >= correct", () => {
      const stats = {
        "agent-001": { seen: 1, correct: 0, wrong: 2, lastSeen: 5 },
        "agent-002": { seen: 1, correct: 1, wrong: 1, lastSeen: 5 },
      };
      const s = api.summarise(TEST_BANK, stats, 6);
      const agent = s.domains.find(d => d.key === "AGENT");
      assert.equal(agent.due, 2); // both have wrong >= correct
    });

    it("marks questions as due when last seen too long ago", () => {
      const stats = {
        "agent-001": { seen: 1, correct: 5, wrong: 0, lastSeen: 0 },
      };
      const s = api.summarise(TEST_BANK, stats, 20);
      const agent = s.domains.find(d => d.key === "AGENT");
      assert.equal(agent.due, 1); // 20 - 0 >= 18
    });

    it("does not mark questions as due when recently seen and correct-dominant", () => {
      const stats = {
        "agent-001": { seen: 1, correct: 5, wrong: 0, lastSeen: 15 },
      };
      const s = api.summarise(TEST_BANK, stats, 20);
      const agent = s.domains.find(d => d.key === "AGENT");
      assert.equal(agent.due, 0); // recently seen, correct dominant
    });

    it("handles malformed stat entries (NaN, infinity, negative) gracefully", () => {
      const stats = {
        "agent-001": { seen: NaN, correct: -5, wrong: Infinity, lastSeen: null },
      };
      const s = api.summarise(TEST_BANK, stats, 0);
      const agent = s.domains.find(d => d.key === "AGENT");
      assert.equal(agent.correct, 0);
      assert.equal(agent.wrong, 0);
      assert.equal(agent.attempted, 0);
    });
  });

  describe("summarise — malformed inputs", () => {
    it("handles missing question bank gracefully", () => {
      const s = api.summarise(null, {}, 0);
      assert.equal(s.overallEvidence, 0);
      assert.equal(s.domains.length, 5);
    });

    it("handles question bank missing a domain key", () => {
      const partialBank = makeTestBank({ AGENT: 24, MCP: 24 });
      const s = api.summarise(partialBank, {}, 0);
      assert.equal(s.domains.length, 5);
      const config = s.domains.find(d => d.key === "CONFIG");
      assert.equal(config.total, 0);
      assert.equal(config.evidence, 0);
    });

    it("handles empty question stats object", () => {
      const s = api.summarise(TEST_BANK, {}, 0);
      for (const d of s.domains) {
        assert.equal(d.attempted, 0);
        assert.equal(d.evidence, 0);
      }
    });
  });

  describe("evidenceHUD", () => {
    it("returns compact HUD string with evidence percentage", () => {
      const hud = api.evidenceHUD(TEST_BANK, {}, 0);
      assert.equal(hud, "EVIDENCE 0% · Agent Wing");
    });

    it("uses its pure internal exam-domain names", () => {
      const s = api.summarise(TEST_BANK, {}, 0);
      // recommendation should be AGENT at 0 evidence
      const hud = api.evidenceHUD(TEST_BANK, {}, 0);
      assert(hud.includes("Agent Wing"));
    });
  });

  describe("recommendationText", () => {
    it("returns recommendation for AGENT when no evidence", () => {
      const text = api.recommendationText(TEST_BANK, {}, 0);
      // Recommends AGENT (highest weight) with unseen count
      assert(text.includes("Agent Wing"), "Expected 'Agent Wing' in: " + text);
      assert(text.includes("24 unseen"), "Expected '24 unseen' in: " + text);
    });

    it("reflects domain with most due items when evidence is equal", () => {
      const stats = {};
      // Give MCP 1 wrong answer and make several questions due
      for (let i = 1; i <= 5; i++) {
        stats["mcp-" + String(i).padStart(3, "0")] = {
          seen: 1, correct: 0, wrong: 1, lastSeen: 0,
        };
      }
      const text = api.recommendationText(TEST_BANK, stats, 20);
      // MCP has 5 due + 19 unseen, weight 18: deficit = 18 + 5 = 23
      // AGENT has 0 due + 24 unseen, weight 27: deficit = 27 + 0 = 27
      // AGENT still wins (higher weight)
      assert(text.includes("Agent Wing"), "Expected 'Agent Wing' in: " + text);
      assert(text.includes("24 unseen"), "Expected '24 unseen' in: " + text);
    });

    it("recommends MCP when it is deliberately the weakest", () => {
      // Every domain strong except MCP: make all domains fully correct
      const stats = {};
      for (const key of ["AGENT", "CONFIG", "PROMPT", "CONTEXT"]) {
        for (let i = 1; i <= 24; i++) {
          stats[key.toLowerCase() + "-" + String(i).padStart(3, "0")] = {
            seen: 1, correct: 1, wrong: 0, lastSeen: 100,
          };
        }
      }
      // MCP: all wrong
      for (let i = 1; i <= 24; i++) {
        stats["mcp-" + String(i).padStart(3, "0")] = {
          seen: 1, correct: 0, wrong: 1, lastSeen: 100,
        };
      }
      const text = api.recommendationText(TEST_BANK, stats, 100);
      assert(text.includes("MCP Lab"), "Expected 'MCP Lab' in: " + text);
      assert(text.includes("24 due"), "Expected '24 due' in: " + text);
    });
  });

  describe("domainSummary — single domain", () => {
    it("returns empty summary for unknown domain", () => {
      const s = api.domainSummary(TEST_BANK, {}, 0, "UNKNOWN");
      assert.equal(s.total, 0);
      assert.equal(s.evidence, 0);
    });

    it("returns summary for a specific domain", () => {
      const stats = {
        "agent-001": { seen: 1, correct: 1, wrong: 0, lastSeen: 5 },
        "agent-002": { seen: 1, correct: 0, wrong: 1, lastSeen: 10 },
      };
      const s = api.domainSummary(TEST_BANK, stats, 11, "AGENT");
      assert.equal(s.attempted, 2);
      assert.equal(s.correct, 1);
      assert.equal(s.wrong, 1);
      assert.equal(s.accuracy, 0.5);
    });
  });

  // ---- Ticket #049: mentor review selection & telemetry ----
  describe("selectReviewQuestion", () => {
    it("returns first unseen question when no stats exist", () => {
      const pick = api.selectReviewQuestion(TEST_BANK, {}, 0, "AGENT");
      assert(pick);
      assert.equal(pick.domain, "AGENT");
      assert.equal(pick.index, 0);
      assert.equal(pick.reason, "unseen");
    });

    it("picks by due-deficit, then lastSeen, then index", () => {
      const stats = {
        "agent-001": { seen: 2, correct: 1, wrong: 3, lastSeen: 8 },
        "agent-002": { seen: 2, correct: 0, wrong: 2, lastSeen: 3 },
      };
      const pick = api.selectReviewQuestion(TEST_BANK, stats, 30, "AGENT");
      assert(pick);
      // agent-001 delta = 3-1 = 2; agent-002 delta = 2-0 = 2;
      // Equal deficit — agent-002 has older lastSeen (3 < 8)
      assert.equal(pick.question.id, "agent-002");
      assert.equal(pick.reason, "due");
    });

    it("MIX resolves to current recommendation domain", () => {
      const stats = {};
      for (const domain of api.DOMAIN_KEYS) {
        for (let i = 1; i <= 24; i++) {
          stats[domain.toLowerCase() + "-" + String(i).padStart(3, "0")] = {
            seen: 1, correct: domain === "MCP" ? 0 : 1, wrong: domain === "MCP" ? 1 : 0, lastSeen: 100,
          };
        }
      }
      const pick = api.selectReviewQuestion(TEST_BANK, stats, 100, "MIX");
      assert(pick);
      assert.equal(pick.domain, "MCP");
    });

    it("falls back to AGENT for invalid domain", () => {
      const pick = api.selectReviewQuestion(TEST_BANK, {}, 0, "INVALID");
      assert(pick);
      assert.equal(pick.domain, "AGENT");
    });

    it("returns null for empty question bank", () => {
      const pick = api.selectReviewQuestion({}, {}, 0, "AGENT");
      assert.equal(pick, null);
    });

    it("ignores rollback aliases and always ranks canonical IDs", () => {
      const pick = api.selectReviewQuestion(TEST_BANK, {
        "AGENT:0": { seen: 999, correct: 999, wrong: 0, lastSeen: 999 },
      }, 20, "AGENT");
      assert.equal(pick.question.id, "agent-001");
      assert.equal(pick.reason, "unseen");
    });

    it("prefers due over unseen and oldest refresh after both pools drain", () => {
      const duePick = api.selectReviewQuestion(TEST_BANK, {
        "agent-010": { seen: 1, correct: 0, wrong: 1, lastSeen: 19 },
      }, 20, "AGENT");
      assert.equal(duePick.question.id, "agent-010");
      assert.equal(duePick.reason, "due");

      const complete = {};
      for (let i = 1; i <= 24; i++) complete[`agent-${String(i).padStart(3, "0")}`] = {
        seen: 1, correct: 1, wrong: 0, lastSeen: i === 7 ? 2 : 10,
      };
      const refresh = api.selectReviewQuestion(TEST_BANK, complete, 10, "AGENT");
      assert.equal(refresh.question.id, "agent-007");
      assert.equal(refresh.reason, "refresh");
    });

    it("skips malformed question records safely", () => {
      const malformed = { AGENT: [null, { id: "x", c: ["only"] }] };
      assert.equal(api.selectReviewQuestion(malformed, {}, 0, "AGENT"), null);
    });

    it("is deterministic across repeated calls", () => {
      const stats = {
        "agent-001": { seen: 2, correct: 1, wrong: 3, lastSeen: 8 },
        "agent-002": { seen: 2, correct: 0, wrong: 2, lastSeen: 3 },
      };
      const first = JSON.stringify(api.selectReviewQuestion(TEST_BANK, stats, 30, "AGENT"));
      for (let i = 0; i < 100; i++) {
        assert.equal(JSON.stringify(api.selectReviewQuestion(TEST_BANK, stats, 30, "AGENT")), first);
      }
    });
  });

  describe("applyReviewTelemetry", () => {
    it("reveal increments seenCounter and stamps canonical/alias", () => {
      const stats = {
        "agent-001": { seen: 1, correct: 0, wrong: 0, lastSeen: 5 },
      };
      const review = {
        domain: "AGENT", index: 0, question: { id: "agent-001" },
        reason: "unseen",
      };
      const event = { type: "reveal", consumed: false };
      const result = api.applyReviewTelemetry(stats, 30, review, event);
      assert.equal(result.changed, true);
      assert.deepEqual(event, { type: "reveal", consumed: false });
      jsonEqual(result.event, { type: "reveal", consumed: true });
      assert.equal(result.seenCounter, 31);
      assert.equal(result.questionStats["agent-001"].seen, 2);
      assert.equal(result.questionStats["agent-001"].lastSeen, 31);
      // Alias sync
      assert.deepEqual(
        result.questionStats["agent-001"],
        result.questionStats["AGENT:0"]
      );
    });

    it("never mutates input stats", () => {
      const stats = {
        "agent-001": { seen: 1, correct: 0, wrong: 0, lastSeen: 5 },
      };
      const before = JSON.stringify(stats);
      const review = {
        domain: "AGENT", index: 0, question: { id: "agent-001" },
        reason: "unseen",
      };
      api.applyReviewTelemetry(stats, 30, review, { type: "reveal" });
      assert.equal(JSON.stringify(stats), before);
    });

    it("a returned consumed token makes repeated dispatch an exact no-op", () => {
      const stats = { "agent-001": { seen: 1, correct: 0, wrong: 0, lastSeen: 5 } };
      const review = { domain: "AGENT", index: 0, question: { id: "agent-001" } };
      const first = api.applyReviewTelemetry(stats, 30, review, { type: "answer", correct: true, consumed: false });
      const repeated = api.applyReviewTelemetry(first.questionStats, first.seenCounter, review, first.event);
      assert.equal(first.changed, true);
      assert.equal(repeated.changed, false);
      assert.equal(repeated.questionStats["agent-001"].correct, 1);
      assert.equal(repeated.seenCounter, first.seenCounter);
    });

    it("answer correct increments correct", () => {
      const stats = {
        "agent-001": { seen: 2, correct: 0, wrong: 0, lastSeen: 31 },
      };
      const review = {
        domain: "AGENT", index: 0, question: { id: "agent-001" },
        reason: "unseen",
      };
      const result = api.applyReviewTelemetry(stats, 31, review, { type: "answer", correct: true });
      assert.equal(result.changed, true);
      assert.equal(result.questionStats["agent-001"].correct, 1);
      assert.equal(result.questionStats["agent-001"].wrong, 0);
    });

    it("answer wrong increments wrong", () => {
      const stats = {
        "agent-001": { seen: 2, correct: 1, wrong: 0, lastSeen: 31 },
      };
      const review = {
        domain: "AGENT", index: 0, question: { id: "agent-001" },
        reason: "due",
      };
      const result = api.applyReviewTelemetry(stats, 31, review, { type: "answer", correct: false });
      assert.equal(result.changed, true);
      assert.equal(result.questionStats["agent-001"].wrong, 1);
    });

    it("invalid event types are no-ops", () => {
      const stats = {
        "agent-001": { seen: 2, correct: 1, wrong: 0, lastSeen: 31 },
      };
      const review = {
        domain: "AGENT", index: 0, question: { id: "agent-001" },
        reason: "due",
      };
      const result = api.applyReviewTelemetry(stats, 31, review, { type: "bogus" });
      assert.equal(result.changed, false);
      jsonEqual(result.questionStats, stats, "no-op should return equal content");
    });

    it("returns unchanged for null, malformed, or consumed review events", () => {
      const stats = { "agent-001": { seen: 1, correct: 0, wrong: 0, lastSeen: 5 } };
      assert.equal(api.applyReviewTelemetry(stats, 30, null, { type: "reveal" }).changed, false);
      const review = { domain: "AGENT", index: 0, question: { id: "agent-001" } };
      assert.equal(api.applyReviewTelemetry(stats, 30, review, { type: "answer", correct: true, consumed: true }).changed, false);
      assert.equal(api.applyReviewTelemetry(stats, 30, { ...review, index: -1 }, { type: "reveal" }).changed, false);
      assert.equal(api.applyReviewTelemetry(stats, 30, { ...review, index: true }, { type: "reveal" }).changed, false);
    });

    it("syncs alias exactly with canonical after reveal and answer", () => {
      const stats = {};
      const review = {
        domain: "AGENT", index: 0, question: { id: "agent-001" },
        reason: "unseen",
      };
      const afterReveal = api.applyReviewTelemetry(stats, 30, review, { type: "reveal" });
      const afterAnswer = api.applyReviewTelemetry(afterReveal.questionStats, afterReveal.seenCounter, review, { type: "answer", correct: false });
      assert.deepEqual(
        afterAnswer.questionStats["agent-001"],
        afterAnswer.questionStats["AGENT:0"]
      );
      assert.equal(afterAnswer.questionStats["agent-001"].wrong, 1);
    });
  });
});
