// Unit tests for datamon/dialogue.js — deterministic domain-aware
// colleague dialogue. Ticket #047.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const dialogueSource = fs.readFileSync("datamon/dialogue.js", "utf8");

function loadDialogue() {
  const sandbox = { window: {}, globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(dialogueSource, sandbox, { filename: "datamon/dialogue.js" });
  return sandbox.window.DatamonDialogue;
}

// Stub displayName for testing.
function displayName(slug) {
  return slug.split("-").map(s => s[0].toUpperCase() + s.slice(1)).join(" ");
}

describe("DatamonDialogue", () => {
  let api;

  before(() => {
    api = loadDialogue();
  });

  describe("PHASES", () => {
    it("exposes all five required phases", () => {
      assert.equal(JSON.stringify(api.PHASES), JSON.stringify([
        "intro", "opponent-lose", "opponent-win", "training-rematch", "campaign-follow-up",
      ]));
    });
  });

  describe("getLine — deterministic output", () => {
    it("returns the same line for the same slug, phase, and domain across calls", () => {
      const a = api.getLine("julien-hovan", "intro", "AGENT");
      const b = api.getLine("julien-hovan", "intro", "AGENT");
      assert.equal(a, b);
    });

    it("returns different lines for different slugs", () => {
      const a = api.getLine("julien-hovan", "intro", "AGENT");
      const b = api.getLine("veronica-marallag", "intro", "AGENT");
      assert.notEqual(a, b);
    });

    it("returns different lines for different phases with the same slug", () => {
      const a = api.getLine("julien-hovan", "intro", "AGENT");
      const b = api.getLine("julien-hovan", "opponent-lose", "AGENT");
      assert.notEqual(a, b);
    });
  });

  describe("getLine — covers all domain × phase combinations", () => {
    const domains = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT", "MIX"];
    const phases = ["intro", "opponent-lose", "opponent-win", "training-rematch", "campaign-follow-up"];

    for (const domain of domains) {
      for (const phase of phases) {
        it(`returns a non-empty string for ${domain} × ${phase}`, () => {
          const line = api.getLine("test-slug", phase, domain);
          assert.ok(typeof line === "string");
          assert.ok(line.length > 0);
        });
      }
    }
  });

  describe("getLine — fallback for invalid inputs", () => {
    it("returns fallback for unknown phase", () => {
      const line = api.getLine("test-slug", "nonexistent", "AGENT");
      assert.ok(typeof line === "string");
      assert.ok(line.length > 0);
    });

    it("returns fallback for unknown domain (falls back to MIX)", () => {
      const line = api.getLine("test-slug", "intro", "UNKNOWN");
      assert.ok(typeof line === "string");
    });

    it("returns fallback for null/undefined domain (falls back to MIX)", () => {
      const line = api.getLine("test-slug", "intro", null);
      assert.ok(typeof line === "string");
    });

    it("returns fallback for null slug", () => {
      const line = api.getLine(null, "intro", "AGENT");
      assert.ok(typeof line === "string");
    });
  });

  describe("battleIntro", () => {
    it("formats intro with display name", () => {
      const msg = api.battleIntro("julien-hovan", "AGENT", displayName);
      assert.ok(msg.startsWith("Julien Hovan "));
      assert.ok(msg.length > "Julien Hovan ".length);
    });

    it("works without displayName function", () => {
      const msg = api.battleIntro("test-slug", "AGENT", null);
      assert.ok(msg.startsWith("test-slug "));
    });

    it("is deterministic", () => {
      const a = api.battleIntro("julien-hovan", "AGENT", displayName);
      const b = api.battleIntro("julien-hovan", "AGENT", displayName);
      assert.equal(a, b);
    });
  });

  describe("opponentLoss", () => {
    it("returns a non-empty defeat message for the NPC", () => {
      const msg = api.opponentLoss("julien-hovan", "AGENT", displayName);
      assert.ok(typeof msg === "string");
      assert.ok(msg.length > 0);
    });

    it("is deterministic", () => {
      const a = api.opponentLoss("julien-hovan", "AGENT", displayName);
      const b = api.opponentLoss("julien-hovan", "AGENT", displayName);
      assert.equal(a, b);
    });
  });

  describe("opponentWin", () => {
    it("returns a non-empty loss message", () => {
      const msg = api.opponentWin("julien-hovan", "AGENT", displayName);
      assert.ok(typeof msg === "string");
      assert.ok(msg.length > 0);
    });

    it("is deterministic", () => {
      const a = api.opponentWin("julien-hovan", "AGENT", displayName);
      const b = api.opponentWin("julien-hovan", "AGENT", displayName);
      assert.equal(a, b);
    });
  });

  describe("trainingRematch", () => {
    it("formats training rematch intro with display name", () => {
      const msg = api.trainingRematch("julien-hovan", "AGENT", displayName);
      assert.ok(msg.startsWith("Julien Hovan "));
    });

    it("is deterministic", () => {
      const a = api.trainingRematch("julien-hovan", "AGENT", displayName);
      const b = api.trainingRematch("julien-hovan", "AGENT", displayName);
      assert.equal(a, b);
    });
  });

  describe("campaignFollowUp", () => {
    it("formats follow-up with quotes around the dialogue", () => {
      const msg = api.campaignFollowUp("julien-hovan", "AGENT", displayName);
      assert.ok(msg.includes(': "'));
      assert.ok(msg.endsWith('"'));
    });

    it("is deterministic", () => {
      const a = api.campaignFollowUp("julien-hovan", "AGENT", displayName);
      const b = api.campaignFollowUp("julien-hovan", "AGENT", displayName);
      assert.equal(a, b);
    });

    it("returns different content for different domains", () => {
      const ag = api.campaignFollowUp("julien-hovan", "AGENT", displayName);
      const mc = api.campaignFollowUp("julien-hovan", "MCP", displayName);
      assert.notEqual(ag, mc);
    });

    it("can point to actual due or unseen study evidence without mutating it", () => {
      const due = { attempted: 3, due: 2, unseen: 21 };
      const msg = api.campaignFollowUp("julien-hovan", "AGENT", displayName, due);
      assert.match(msg, /2 concepts due here/);
      assert.deepEqual(due, { attempted: 3, due: 2, unseen: 21 });
      assert.match(api.campaignFollowUp("julien-hovan", "AGENT", displayName,
        { attempted: 3, due: 0, unseen: 4 }), /4 unseen questions/);
    });
  });

  describe("Dialogue diversity", () => {
    it("intro pools have multiple entries across domains", () => {
      const lines = new Set();
      for (const domain of ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT", "MIX"]) {
        for (let i = 0; i < 20; i++) {
          lines.add(api.getLine("slug-" + i, "intro", domain));
        }
      }
      // With 6 domains × 4 entries each, at least 10 unique lines expected
      assert.ok(lines.size >= 10, "Expected at least 10 unique intro lines, got " + lines.size);
    });
  });
});
