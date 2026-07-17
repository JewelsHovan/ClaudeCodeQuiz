// Unit tests for datamon/attributes.js — deterministic bounded matchup rules.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("datamon/attributes.js", "utf8");

function loadHarness() {
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: "datamon/attributes.js" });
  return sandbox.window.DatamonAttributes;
}

function jsonEqual(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

describe("DatamonAttributes", () => {
  it("exposes the four stat indexes and legacy-neutral defaults", () => {
    const api = loadHarness();
    jsonEqual(api.STAT_INDEX, { caffeine: 0, debugging: 1, vibes: 2, jargon: 3 });
    const neutral = api.derive([90, 90, 90, 90], [90, 90, 90, 90], "normal");
    assert.equal(neutral.maxHp, 100);
    assert.equal(neutral.wrongDamage, 25);
    assert.equal(neutral.hardTimerMs, 30000);
    assert.equal(neutral.correctHeal, 4);
    assert.equal(neutral.opponentMonCount, 2);
    assert.equal(neutral.movementMultiplier, 1);
  });

  it("makes a maxed creator strong without exceeding fixed bounds", () => {
    const api = loadHarness();
    const creator = api.derive([100, 100, 100, 100], [72, 82, 86, 65], "hard");
    assert.equal(creator.maxHp, 110);
    assert.equal(creator.wrongDamage, 21);
    assert.equal(creator.hardTimerMs, 35000);
    assert.equal(creator.correctHeal, 8);
    assert.equal(creator.opponentMonCount, 2);
    assert.equal(creator.movementMultiplier, 1.1);
    assert.equal(api.describe(creator), "ATTR // 110 HP · MISS -21 · CORRECT +8 HP · TIMER 35s");
  });

  it("uses the opponent's stacked attributes symmetrically", () => {
    const api = loadHarness();
    const underdog = api.derive([72, 82, 86, 65], [100, 100, 100, 100], "hard");
    assert.equal(underdog.maxHp, 96);
    assert.equal(underdog.wrongDamage, 29);
    assert.equal(underdog.hardTimerMs, 25000);
    assert.equal(underdog.correctHeal, 0);
    assert.equal(underdog.opponentMonCount, 3);
    assert.equal(underdog.movementMultiplier, 0.9);
  });

  it("turns opponent Vibes into one, two, or three classic mons", () => {
    const api = loadHarness();
    assert.equal(api.opponentMonCount([90, 90, 84, 90]), 1);
    assert.equal(api.opponentMonCount([90, 90, 85, 90]), 2);
    assert.equal(api.opponentMonCount([90, 90, 95, 90]), 2);
    assert.equal(api.opponentMonCount([90, 90, 96, 90]), 3);
  });

  it("normalises malformed stats without mutating either input", () => {
    const api = loadHarness();
    const player = [Infinity, -20, 140, "95"];
    const opponent = [null, 87.7, undefined, NaN];
    const beforePlayer = player.slice();
    const beforeOpponent = opponent.slice();
    const result = api.derive(player, opponent, "unknown");
    jsonEqual(result.player, { caffeine: 90, debugging: 0, vibes: 100, jargon: 95 });
    jsonEqual(result.opponent, { caffeine: 0, debugging: 88, vibes: 90, jargon: 90 });
    jsonEqual(player, beforePlayer);
    jsonEqual(opponent, beforeOpponent);
    assert.equal(result.difficulty, "normal");
    assert.ok(result.maxHp >= 90 && result.maxHp <= 110);
    assert.ok(result.wrongDamage >= 15 && result.wrongDamage <= 35);
    assert.ok(result.correctHeal >= 0 && result.correctHeal <= 8);
    assert.ok(result.hardTimerMs >= 25000 && result.hardTimerMs <= 35000);
  });
});
