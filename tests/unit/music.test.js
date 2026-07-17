import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("datamon/music.js", "utf8");

function loadMusic(overrides = {}) {
  const listeners = {};
  const sandbox = {
    window: {
      AudioContext: undefined,
      webkitAudioContext: undefined,
      addEventListener(type, fn) { listeners[`window:${type}`] = fn; },
    },
    document: {
      hidden: false,
      addEventListener(type, fn) { listeners[`document:${type}`] = fn; },
    },
    setInterval: overrides.setInterval || (() => 1),
    clearInterval: overrides.clearInterval || (() => {}),
    Math,
    Object,
    Number,
    Array,
    JSON,
    isFinite,
    console,
  };
  Object.assign(sandbox.window, overrides.window || {});
  vm.runInNewContext(source, sandbox, { filename: "datamon/music.js" });
  return { api: sandbox.window.DatamonMusic, sandbox, listeners };
}

describe("DatamonMusic — original deterministic score", () => {
  it("exports the six-interval DATAMON motif", () => {
    const { api } = loadMusic();
    assert.deepEqual(Array.from(api.MOTIF), [0, 3, 7, 10, 7, 5]);
    assert.equal(Object.isFrozen(api.MOTIF), true);
  });

  it("defines every required arrangement with distinct musical metadata", () => {
    const { api } = loadMusic();
    const required = [
      "title", "office", "library", "classic-battle", "agent-battle",
      "agent-boss-1", "agent-boss-2", "agent-boss-3", "minigame", "victory", "defeat",
    ];
    assert.deepEqual(Object.keys(api.SCORES), required);
    for (const name of required) {
      const score = api.SCORES[name];
      assert.ok(Number.isFinite(score.tempo) && score.tempo > 0, name);
      assert.ok(score.roles.length > 8, name);
      assert.ok(score.layers.length >= 2, name);
      for (const layer of score.layers) {
        assert.ok(layer.pattern.length > 0, `${name}/${layer.instrument}`);
        for (const note of layer.pattern) assert.ok(note === null || Number.isFinite(note));
      }
    }
    assert.deepEqual(required.map(name => api.SCORES[name].tempo),
      [82, 96, 72, 126, 132, 148, 148, 148, 112, 118, 68]);
    assert.equal(api.SCORES.victory.loop, false);
    assert.equal(api.SCORES.defeat.loop, false);
  });

  it("contains no gameplay/random dependency", () => {
    assert.doesNotMatch(source, /Math\.random|localStorage|QUESTION_BANK|DatamonBattleOps|\bsave\s*\(/);
  });

  it("maps game snapshots to the expected adaptive scene", () => {
    const { api } = loadMusic();
    const cases = [
      [{ state: "title" }, "title"],
      [{ state: "select" }, "title"],
      [{ state: "overworld", currentMap: "office" }, "office"],
      [{ state: "dialogue", currentMap: "office" }, "office"],
      [{ state: "dialogue", currentMap: "library" }, "library"],
      [{ state: "search", currentMap: "library" }, "library"],
      [{ state: "minigame" }, "minigame"],
      [{ state: "transition", transitionType: "AGENT" }, "agent-battle"],
      [{ state: "battle", battle: { phase: "question", agentOps: null } }, "classic-battle"],
      [{ state: "battle", battle: { phase: "action", agentOps: { boss: false } } }, "agent-battle"],
      [{ state: "battle", battle: { phase: "action", agentOps: { boss: true, bossPhase: 0 } } }, "agent-boss-1"],
      [{ state: "battle", battle: { phase: "action", agentOps: { boss: true, bossPhase: 1 } } }, "agent-boss-2"],
      [{ state: "battle", battle: { phase: "action", agentOps: { boss: true, bossPhase: 2 } } }, "agent-boss-3"],
      [{ state: "battle", battle: { phase: "defeat", agentOps: {} } }, "defeat"],
      [{ state: "battle", battle: { phase: "victory", agentOps: {} } }, "victory"],
      [{ state: "victory" }, "victory"],
    ];
    for (const [snapshot, expected] of cases) assert.equal(api.resolveScene(snapshot), expected);
  });

  it("converts MIDI notes deterministically", () => {
    const { api } = loadMusic();
    assert.equal(api.midiToHz(69), 440);
    assert.ok(Math.abs(api.midiToHz(60) - 261.625565) < 0.0001);
  });
});

describe("DatamonMusic — silent fallback", () => {
  it("stays safe when Web Audio is unavailable", () => {
    const { api, listeners } = loadMusic();
    api.init({ muted: false, scene: "office" });
    assert.equal(api.unlock(), false);
    assert.equal(api.setScene("agent-battle"), true);
    api.setMuted(true);
    api.suspend();
    api.resume();
    api.reset();
    assert.equal(api.getDiagnostics().available, false);
    assert.doesNotThrow(() => listeners["document:visibilitychange"]());
    assert.doesNotThrow(() => listeners["window:pagehide"]());
  });

  it("does not restart an unchanged scene", () => {
    const { api } = loadMusic();
    api.init({ scene: "office" });
    const before = api.getDiagnostics().generation;
    assert.equal(api.setScene("office"), false);
    assert.equal(api.getDiagnostics().generation, before);
  });
});
