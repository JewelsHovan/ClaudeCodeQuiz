import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("datamon/battle-presentation.js", "utf8");
const productManifest = JSON.parse(fs.readFileSync("datamon/battlemons/manifest.json", "utf8"));

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function loadModule(options = {}) {
  const requests = [];
  const drawCalls = [];
  const alphaWidth = options.alphaWidth || 4, alphaHeight = options.alphaHeight || 4;
  const alphaPixels = new Uint8ClampedArray(alphaWidth * alphaHeight * 4);
  for (const [x, y] of options.alphaPoints || [[1, 1], [2, 1], [1, 2], [2, 2], [1, 3], [2, 3]]) {
    alphaPixels[(y * alphaWidth + x) * 4 + 3] = 255;
  }
  function fakeContext() {
    return {
      imageSmoothingEnabled: false,
      clearRect() {}, save() {}, restore() {}, translate() {}, fill() {}, stroke() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, rect() {}, ellipse() {},
      fillRect() {}, strokeRect() {},
      drawImage(...args) { drawCalls.push(args); },
      getImageData() { return { data: alphaPixels }; },
      set fillStyle(_) {}, set strokeStyle(_) {}, set lineWidth(_) {},
    };
  }
  let timeoutCalls = 0;
  const sandbox = {
    window: {}, console: { warn() {} }, Object, Map, Set, WeakMap, Promise, Math, Number,
    Uint8ClampedArray, Error,
    document: {
      createElement(tag) {
        if (tag !== "canvas") return {};
        return { width: 0, height: 0, getContext: fakeContext };
      },
    },
    setTimeout(callback, delay) {
      timeoutCalls++;
      if (options.instantTimeoutAt === timeoutCalls) { queueMicrotask(callback); return { instant: true }; }
      return setTimeout(callback, delay);
    },
    clearTimeout(handle) { if (!handle?.instant) clearTimeout(handle); },
    fetch(url) {
      requests.push(String(url));
      if (options.fetchNever) return new Promise(() => {});
      if (options.fetchError) return Promise.reject(new Error(options.fetchError));
      const manifest = options.manifest === undefined ? productManifest : options.manifest;
      return Promise.resolve({ ok: options.fetchOk !== false, status: options.fetchOk === false ? 500 : 200, json: async () => clone(manifest) });
    },
    Image: function FakeImage() {
      this.complete = false;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.onload = null;
      this.onerror = null;
      Object.defineProperty(this, "src", {
        set: value => {
          requests.push(String(value));
          if (options.imageNever) return;
          queueMicrotask(() => {
            if (options.imageError) return this.onerror && this.onerror(new Error("image failed"));
            this.complete = true;
            this.naturalWidth = options.imageWidth || 768;
            this.naturalHeight = options.imageHeight || 128;
            if (this.onload) this.onload();
          });
        },
      });
    },
    queueMicrotask,
  };
  vm.runInNewContext(source, sandbox, { filename: "datamon/battle-presentation.js" });
  return { api: sandbox.window.DatamonBattlePresentation, requests, drawCalls };
}

const { api } = loadModule();

describe("DatamonBattlePresentation taxonomy and immutable geometry", () => {
  it("maps all 35 canonical pairs to unique stable IDs", () => {
    const ids = [];
    for (const domain of api.CANONICAL_DOMAINS) {
      for (const name of api.CANONICAL_NAMES[domain]) ids.push(api.battlemonId(domain, name));
    }
    assert.equal(ids.length, 35);
    assert.equal(new Set(ids).size, 35);
    assert.ok(ids.every(id => /^[a-z]+-[a-z0-9-]+$/.test(id)));
    assert.equal(api.battlemonId("MCP", "Schema Mismatch"), "mcp-schema-mismatch");
  });

  it("rejects unknown, mismatched, empty, and non-string identities", () => {
    assert.equal(api.battlemonId("MIX", "Schema Mismatch"), null);
    assert.equal(api.battlemonId("AGENT", "Schema Mismatch"), null);
    assert.equal(api.battlemonId("AGENT", ""), null);
    assert.equal(api.battlemonId(null, "Rogue Subagent"), null);
  });

  it("pins the reviewed stage and modest 1.11-or-less perspective ratio", () => {
    const geometry = api.GEOMETRY;
    assert.deepEqual(Array.from(geometry.PLAYER_ANCHOR), [160, 408]);
    assert.deepEqual(Array.from(geometry.OPPONENT_ANCHOR), [657, 208]);
    assert.equal(geometry.PLAYER_VISIBLE_HEIGHT, 172);
    assert.equal(geometry.OPPONENT_VISIBLE_HEIGHT, 156);
    assert.ok(geometry.PLAYER_VISIBLE_HEIGHT / geometry.OPPONENT_VISIBLE_HEIGHT <= 1.11);
    assert.equal(geometry.STAGE_BOTTOM, 432);
    assert.ok(Object.isFrozen(geometry));
  });

  it("keeps every semantic pose at the exact vertical scale so the far trainer never dominates", () => {
    for (const [pose, params] of Object.entries(api.POSE_PARAMS)) {
      assert.equal(params.scaleY, 1, pose);
      assert.ok(Object.isFrozen(params));
    }
    const phases = ["intro", "sendout", "question", "feedback-correct", "feedback-wrong", "win", "lose"];
    for (const phaseName of phases) {
      const phase = phaseName.startsWith("feedback") ? "feedback" : phaseName;
      const feedback = phaseName === "feedback-correct" ? { correct: true }
        : phaseName === "feedback-wrong" ? { correct: false } : null;
      const playerPose = api.resolveTrainerPose("player", phase, feedback, false);
      const opponentPose = api.resolveTrainerPose("opponent", phase, feedback, false);
      const playerHeight = api.GEOMETRY.PLAYER_VISIBLE_HEIGHT * api.POSE_PARAMS[playerPose].scaleY;
      const opponentHeight = api.GEOMETRY.OPPONENT_VISIBLE_HEIGHT * api.POSE_PARAMS[opponentPose].scaleY;
      assert.equal(playerHeight, 172, phaseName);
      assert.equal(opponentHeight, 156, phaseName);
      assert.ok(playerHeight > opponentHeight, phaseName);
    }
  });
});

describe("strict Battlemon manifest", () => {
  it("accepts the exact product manifest and freezes canonical entries", () => {
    const normalized = api.normalizeManifest(productManifest);
    assert.equal(normalized.size, 35);
    const entry = normalized.get("context-context-rot");
    assert.deepEqual({ id: entry.id, domain: entry.domain, variant: entry.variant },
      { id: "context-context-rot", domain: "CONTEXT", variant: 0 });
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.frames));
  });

  it("rejects extra keys, reordered states/entries, unsafe files, and taxonomy drift", () => {
    const extra = clone(productManifest); extra.unexpected = true;
    assert.equal(api.normalizeManifest(extra), null);
    const states = clone(productManifest); [states.states[0], states.states[1]] = [states.states[1], states.states[0]];
    assert.equal(api.normalizeManifest(states), null);
    const order = clone(productManifest); [order.entries[0], order.entries[1]] = [order.entries[1], order.entries[0]];
    assert.equal(api.normalizeManifest(order), null);
    const file = clone(productManifest); file.entries[0].file = "../arbitrary.png";
    assert.equal(api.normalizeManifest(file), null);
    const drift = clone(productManifest); drift.entries[0].name = "Coordinated Drift";
    assert.equal(api.normalizeManifest(drift), null);
    const variant = clone(productManifest); variant.entries[0].variant = true;
    assert.equal(api.normalizeManifest(variant), null);
  });

  it("rejects malformed hashes, geometry, frame order, and missing entries", () => {
    const hash = clone(productManifest); hash.entries[0].sha256 = "A".repeat(64);
    assert.equal(api.normalizeManifest(hash), null);
    const geometry = clone(productManifest); geometry.frameWidth = 64;
    assert.equal(api.normalizeManifest(geometry), null);
    const frames = clone(productManifest); frames.entries[0].frames.reverse();
    assert.equal(api.normalizeManifest(frames), null);
    const missing = clone(productManifest); missing.entries.pop(); missing.assetCount = 34;
    assert.equal(api.normalizeManifest(missing), null);
  });
});

describe("pure semantic state resolution", () => {
  it("maps every classic trainer beat without mutating feedback", () => {
    const feedback = Object.freeze({ correct: true });
    const rows = [
      ["player", "intro", null, false, "idle"], ["opponent", "intro", null, false, "challenge"],
      ["player", "sendout", null, false, "idle"], ["opponent", "sendout", null, false, "command"],
      ["player", "question", null, false, "idle"], ["opponent", "question", null, false, "idle"],
      ["player", "feedback", feedback, false, "command"], ["opponent", "feedback", feedback, false, "hit"],
      ["player", "feedback", { correct: false }, false, "hit"], ["opponent", "feedback", { correct: false }, false, "command"],
      ["player", "win", null, false, "win"], ["opponent", "win", null, false, "loss"],
      ["player", "lose", null, false, "loss"], ["opponent", "lose", null, false, "win"],
      ["player", "question", null, true, "hit"], ["opponent", "question", null, true, "command"],
    ];
    for (const [who, phase, outcome, impact, expected] of rows) {
      assert.equal(api.resolveTrainerPose(who, phase, outcome, impact), expected);
    }
    assert.deepEqual(feedback, { correct: true });
  });

  it("maps capped sendout, idle, attack, hit, and faint states", () => {
    assert.equal(api.resolveBattlemonState("intro", 10, 0, 0, false), "sendout");
    assert.equal(api.resolveBattlemonState("sendout", 10, 0, 0, false), "sendout");
    assert.equal(api.resolveBattlemonState("question", 0, 0, 0, false), "idle-a");
    assert.equal(api.resolveBattlemonState("question", 30, 0, 0, false), "idle-b");
    assert.equal(api.resolveBattlemonState("question", 110, 100, 0, false), "attack");
    assert.equal(api.resolveBattlemonState("feedback", 106, 0, 100, false), "hit");
    assert.equal(api.resolveBattlemonState("feedback", 108, 0, 100, false), "faint");
  });

  it("pins only ambient idle under reduced motion and retains semantic endpoints", () => {
    assert.equal(api.resolveBattlemonState("question", 30, 0, 0, true), "idle-a");
    assert.equal(api.resolveBattlemonState("question", 110, 100, 0, true), "attack");
    assert.equal(api.resolveBattlemonState("feedback", 108, 0, 100, true), "faint");
  });
});

describe("bounded alpha scanning and lazy loading", () => {
  it("computes and caches exact decoded alpha bounds once", () => {
    const loaded = loadModule();
    const image = { complete: true, naturalWidth: 4, naturalHeight: 4 };
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.computeAlphaBounds(image))), { x: 1, y: 1, w: 2, h: 3 });
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.computeAlphaBounds(image))), { x: 1, y: 1, w: 2, h: 3 });
    assert.equal(loaded.api.getDiagnostics().alphaCacheSize, 1);
  });

  it("fetches one manifest, coalesces one accepted sheet, and draws its requested frame", async () => {
    const loaded = loadModule();
    const id = "mcp-schema-mismatch";
    const [first, second] = await Promise.all([
      loaded.api.requestSheet(id), loaded.api.requestSheet(id),
    ]);
    assert.ok(first); assert.equal(first, second);
    assert.deepEqual(loaded.requests, ["battlemons/manifest.json", `battlemons/${id}.png`]);
    const context = { drawImage(...args) { loaded.drawCalls.push(args); } };
    assert.equal(loaded.api.drawBattlemonFrame(context, "MCP", id, "attack", 1, 2, 128, 128), true);
    assert.equal(loaded.drawCalls.at(-1)[1], 3 * 128);
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.getDiagnostics())), {
      manifestStatus: "accepted", manifestEntryCount: 35, loadedSheetCount: 1,
      inFlightSheetCount: 0, failedSheetCount: 0, fallbackDomainCount: 0, activeSheetCount: 0,
      loadedSheetDecodedBytes: 768*128*4, fallbackDecodedBytes: 0, alphaCacheSize: 0,
    });
  });

  it("retains only the current encounter's accepted sheets", async () => {
    const loaded = loadModule(), first="mcp-schema-mismatch", second="config-hook-loop";
    assert.equal(loaded.api.setActiveEncounter([first]),1);await loaded.api.requestSheet(first);
    assert.equal(loaded.api.getDiagnostics().loadedSheetCount,1);
    assert.equal(loaded.api.setActiveEncounter([second]),1);
    assert.equal(loaded.api.getDiagnostics().loadedSheetCount,0);
    await loaded.api.requestSheet(second);
    const diagnostics=loaded.api.getDiagnostics();
    assert.equal(diagnostics.activeSheetCount,1);assert.equal(diagnostics.loadedSheetCount,1);
    assert.equal(diagnostics.loadedSheetDecodedBytes,768*128*4);
  });

  it("releases a transient domain fallback as soon as accepted art decodes", async () => {
    const loaded = loadModule();
    const id = "mcp-schema-mismatch", pending = loaded.api.requestSheet(id);
    assert.equal(loaded.api.drawBattlemonFrame({ drawImage() {} }, "MCP", id, "idle-a", 0, 0, 128, 128), false);
    assert.equal(loaded.api.getDiagnostics().fallbackDecodedBytes, 768*128*4);
    await pending;
    assert.equal(loaded.api.getDiagnostics().fallbackDomainCount, 0);
    assert.equal(loaded.api.getDiagnostics().fallbackDecodedBytes, 0);
  });

  it("bounds a stalled manifest and converges to rejected fallbacks", async () => {
    const loaded = loadModule({ fetchNever: true, instantTimeoutAt: 1 });
    assert.equal(await loaded.api.loadManifest(), null);
    assert.equal(loaded.api.getDiagnostics().manifestStatus, "rejected");
    assert.deepEqual(loaded.requests, ["battlemons/manifest.json"]);
  });

  it("bounds a stalled decoded sheet, clears in-flight state, and fails it once", async () => {
    const loaded = loadModule({ imageNever: true, instantTimeoutAt: 2 });
    const id = "mcp-schema-mismatch";
    assert.equal(await loaded.api.requestSheet(id), null);
    const diagnostics = loaded.api.getDiagnostics();
    assert.equal(diagnostics.manifestStatus, "accepted");
    assert.equal(diagnostics.inFlightSheetCount, 0);
    assert.equal(diagnostics.failedSheetCount, 1);
    assert.equal(await loaded.api.requestSheet(id), null);
    assert.equal(loaded.requests.filter(value => value.endsWith(id + ".png")).length, 1);
  });

  it("rejects malformed metadata once and never authorizes its arbitrary URL", async () => {
    const malformed = clone(productManifest);
    malformed.entries[0].file = "https://example.com/arbitrary.png";
    const loaded = loadModule({ manifest: malformed });
    assert.equal(await loaded.api.loadManifest(), null);
    assert.equal(await loaded.api.requestSheet("agent-rogue-subagent"), null);
    assert.deepEqual(loaded.requests, ["battlemons/manifest.json"]);
    assert.equal(loaded.api.getDiagnostics().manifestStatus, "rejected");
  });

  it("fails a wrong-sized sheet once and converges to a bounded domain fallback", async () => {
    const loaded = loadModule({ imageWidth: 64, imageHeight: 64 });
    const id = "config-settings-drift";
    assert.equal(await loaded.api.requestSheet(id), null);
    assert.equal(await loaded.api.requestSheet(id), null);
    assert.equal(loaded.requests.filter(path => path.endsWith(id + ".png")).length, 1);
    const context = { drawImage(...args) { loaded.drawCalls.push(args); } };
    assert.equal(loaded.api.drawBattlemonFrame(context, "CONFIG", id, "idle-a", 0, 0, 128, 128), false);
    const diagnostics = loaded.api.getDiagnostics();
    assert.equal(diagnostics.failedSheetCount, 1);
    assert.equal(diagnostics.fallbackDomainCount, 1);
    assert.equal(diagnostics.fallbackDecodedBytes, 768*128*4);
    assert.ok(diagnostics.loadedSheetCount <= 35);
  });
});
