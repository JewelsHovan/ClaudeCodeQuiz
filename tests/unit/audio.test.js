import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const musicSource = fs.readFileSync("datamon/music.js", "utf8");
const audioSource = fs.readFileSync("datamon/audio.js", "utf8");
const manifest = JSON.parse(fs.readFileSync("datamon/audio/manifest.json", "utf8"));

class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(["set", value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(["linear", value, time]); }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(["exponential", value, time]); }
  cancelScheduledValues() {}
}
class Node {
  constructor() { this.connections = []; }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
}
class Source extends Node {
  constructor() { super(); this.frequency = { value: 0 }; this.onended = null; this.buffer = null; this.type = "sine"; }
  start() {}
  stop() { if (this.onended) this.onended(); }
}
class FakeContext {
  constructor() { this.currentTime = 0; this.state = "running"; this.sampleRate = 22050; this.destination = new Node(); }
  createGain() { const node = new Node(); node.gain = new Param(1); return node; }
  createDynamicsCompressor() { return new Node(); }
  createBiquadFilter() { const node = new Node(); node.frequency = { value: 0 }; return node; }
  createOscillator() { return new Source(); }
  createBufferSource() { return new Source(); }
  createBuffer(_channels, length) { const data = new Float32Array(length); return { getChannelData() { return data; } }; }
  resume() { this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
}

function loadAudio({ withContext = true } = {}) {
  const listeners = {};
  const sandbox = {
    window: {
      AudioContext: withContext ? FakeContext : undefined,
      webkitAudioContext: undefined,
      addEventListener(type, fn) { listeners[`window:${type}`] = fn; },
    },
    document: {
      hidden: false,
      addEventListener(type, fn) { listeners[`document:${type}`] = fn; },
    },
    fetch: async () => { throw new Error("offline unit test"); },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    performance: { now: () => 1000 },
    console, Math, Object, Number, Array, JSON, Map, Set, Promise, Float32Array,
  };
  vm.runInNewContext(musicSource, sandbox, { filename: "datamon/music.js" });
  sandbox.DatamonMusic = sandbox.window.DatamonMusic;
  vm.runInNewContext(audioSource, sandbox, { filename: "datamon/audio.js" });
  sandbox.DatamonAudio = sandbox.window.DatamonAudio;
  return { api: sandbox.DatamonAudio, music: sandbox.DatamonMusic, listeners };
}

describe("DatamonAudio pure contracts", () => {
  it("accepts the exact reviewed manifest and rejects coordinated drift", () => {
    const { api } = loadAudio();
    const normalized = api.normalizeManifest(manifest);
    assert.ok(normalized);
    assert.equal(normalized.assetCount, 29);
    assert.equal(normalized.aggregateBytes, 450081);
    assert.ok(Object.isFrozen(normalized.assets));
    assert.equal(api.normalizeManifest({ ...manifest, reviewState: "draft" }), null);
    assert.equal(api.normalizeManifest({ ...manifest, aggregateBytes: manifest.aggregateBytes + 1 }), null);
    const duplicate = structuredClone(manifest);
    duplicate.assets[1].id = duplicate.assets[0].id;
    assert.equal(api.normalizeManifest(duplicate), null);
    const traversal = structuredClone(manifest);
    traversal.assets[0].file = "../outside.mp3";
    assert.equal(api.normalizeManifest(traversal), null);
  });

  it("resolves exploration, focus, training, minigame, and battle identities", () => {
    const { api } = loadAudio();
    const cases = [
      [{ state: "title", currentMap: "office" }, ["title", null, false]],
      [{ state: "select", currentMap: "office" }, ["select", null, false]],
      [{ state: "overworld", currentMap: "office", region: "PROMPT" }, ["office-prompt", "ambience.office", false]],
      [{ state: "dialogue", currentMap: "office", overlay: "dialogue" }, ["office", "ambience.office", true]],
      [{ state: "overworld", currentMap: "library", overlay: "reader" }, ["library-reader", "ambience.library", true]],
      [{ state: "overworld", currentMap: "battleRoom" }, ["battle-room", "ambience.battle-room", false]],
      [{ state: "minigame", currentMap: "library", minigameType: "timed" }, ["minigame-timed", "ambience.library", false]],
      [{ state: "battle", battle: { phase: "question", domain: "CONFIG" } }, ["classic-battle-config", null, false]],
      [{ state: "battle", battle: { phase: "action", agentOps: { boss: true, bossPhase: 2 } } }, ["agent-boss-3", null, false]],
    ];
    for (const [snapshot, expected] of cases) {
      const resolved = api.resolveAudioState(snapshot);
      assert.deepEqual([resolved.music, resolved.ambience, resolved.focus], expected);
    }
  });

  it("maps logical surfaces without inspecting or mutating movement", () => {
    const { api } = loadAudio();
    assert.equal(api.surfaceForTile(".", "office"), "wood");
    assert.equal(api.surfaceForTile("X", "office"), "tile");
    assert.equal(api.surfaceForTile(".", "library"), "carpet");
    assert.equal(api.surfaceForTile(".", "battleRoom"), "tile");
  });

  it("keeps context ownership in audio.js only", () => {
    const game = fs.readFileSync("datamon/game.js", "utf8");
    const agent = fs.readFileSync("datamon/agent-arena.js", "utf8");
    assert.match(audioSource, /context\s*=\s*new\s+Ctor\(\)/);
    assert.doesNotMatch(musicSource, /new\s+(?:AudioContext|Ctor\s*\()/);
    assert.doesNotMatch(game, /new\s+\([^\n]*AudioContext/);
    assert.doesNotMatch(agent, /new\s+(?:AudioContext|Ctor\s*\()/);
  });
});

describe("DatamonAudio lifecycle", () => {
  it("creates one graph, keeps scene sync idempotent, and hard-cleans on mute", () => {
    const { api } = loadAudio();
    api.init({ snapshot: { state: "title", currentMap: "office" } });
    assert.equal(api.getDiagnostics().contextCreations, 0);
    assert.equal(api.unlock(), true);
    assert.equal(api.unlock(), true);
    let diagnostics = api.getDiagnostics();
    assert.equal(diagnostics.contextCreations, 1);
    assert.equal(diagnostics.graphCreations, 1);
    assert.equal(diagnostics.buses, 5);
    const generation = diagnostics.generation;
    assert.equal(api.setSnapshot({ state: "title", currentMap: "office" }), false);
    assert.equal(api.getDiagnostics().generation, generation);
    api.cue("ui.confirm");
    assert.ok(api.getDiagnostics().activeVoices <= api.getDiagnostics().limits.voices);
    api.setMuted(true);
    diagnostics = api.getDiagnostics();
    assert.equal(diagnostics.schedulerActive, false);
    assert.equal(diagnostics.activeVoices, 0);
    assert.deepEqual(Array.from(diagnostics.ambience), []);
  });

  it("fails silent when Web Audio is unavailable and lifecycle listeners stay safe", () => {
    const { api, listeners } = loadAudio({ withContext: false });
    api.init({ snapshot: { state: "overworld", currentMap: "library" } });
    assert.equal(api.unlock(), false);
    assert.equal(api.getDiagnostics().available, false);
    assert.doesNotThrow(() => listeners["document:visibilitychange"]());
    assert.doesNotThrow(() => listeners["window:pagehide"]());
    assert.equal(api.cue("result.correct"), false);
  });
});
