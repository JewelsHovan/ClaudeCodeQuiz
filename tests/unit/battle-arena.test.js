import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("datamon/battle-arena.js", "utf8");
const productManifest = JSON.parse(fs.readFileSync("datamon/battle-arenas/manifest.json", "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));

function loadModule(options = {}) {
  const requests = [], draws = []; let timeoutCalls = 0;
  function context() {
    return { fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, ellipse() {},
      drawImage(...args) { draws.push(args); }, set fillStyle(_) {}, set strokeStyle(_) {}, set lineWidth(_) {} };
  }
  const sandbox = {
    window: {}, console: { warn() {} }, Object, Map, Promise, Math, Error,
    document: { createElement(tag) { return tag === "canvas" ? { width: 0, height: 0, getContext: context } : {}; } },
    setTimeout(callback, delay) {
      timeoutCalls++;
      if (options.instantTimeoutAt === timeoutCalls) { queueMicrotask(callback); return { instant: true }; }
      return setTimeout(callback, delay);
    },
    clearTimeout(handle) { if (!handle?.instant) clearTimeout(handle); },
    fetch(url) {
      requests.push(String(url));
      if (options.fetchNever) return new Promise(() => {});
      const manifest = options.manifest === undefined ? productManifest : options.manifest;
      return Promise.resolve({ ok: options.fetchOk !== false, status: options.fetchOk === false ? 500 : 200,
        json: async () => clone(manifest) });
    },
    Image: function FakeImage() {
      this.naturalWidth = 0; this.naturalHeight = 0; this.onload = null; this.onerror = null;
      this.removeAttribute = () => {};
      Object.defineProperty(this, "src", { set: value => {
        requests.push(String(value));
        if (options.imageNever) return;
        queueMicrotask(() => {
          if (options.imageError) return this.onerror?.(new Error("failed"));
          this.naturalWidth = options.imageWidth || 1600; this.naturalHeight = options.imageHeight || 864;
          this.onload?.();
        });
      }});
    },
    queueMicrotask,
  };
  vm.runInNewContext(source, sandbox, { filename: "datamon/battle-arena.js" });
  return { api: sandbox.window.DatamonBattleArena, requests, draws };
}

const { api } = loadModule();

describe("strict authored arena manifest", () => {
  it("accepts and freezes exactly five canonical domain entries", () => {
    const accepted = api.normalizeManifest(productManifest);
    assert.equal(accepted.size, 5);
    assert.deepEqual([...accepted.keys()], ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT"]);
    assert.equal(accepted.get("MCP").file, "mcp.png");
    assert.ok(Object.isFrozen(accepted.get("MCP")));
  });
  it("rejects extra keys, order drift, arbitrary paths, hashes, geometry, and review drift", () => {
    const variants = [];
    let value = clone(productManifest); value.extra = true; variants.push(value);
    value = clone(productManifest); value.domains.reverse(); variants.push(value);
    value = clone(productManifest); value.entries[0].file = "https://evil.test/a.png"; variants.push(value);
    value = clone(productManifest); value.entries[0].sha256 = "bad"; variants.push(value);
    value = clone(productManifest); value.width = 800; variants.push(value);
    value = clone(productManifest); value.review.reviewed = false; variants.push(value);
    value = clone(productManifest); value.review.grayscaleContactSheetSha256 = "0".repeat(64); variants.push(value);
    value = clone(productManifest); value.batchSha256 = "0".repeat(64); variants.push(value);
    value = clone(productManifest); value.entries[0].promptSha256 = "0".repeat(64); variants.push(value);
    value = clone(productManifest); value.entries[0].referenceSha256 = "0".repeat(64); variants.push(value);
    value = clone(productManifest); value.entries[0].rawSha256 = "0".repeat(64); variants.push(value);
    value = clone(productManifest); value.entries[0].costUsd = 0; variants.push(value);
    for (const variant of variants) assert.equal(api.normalizeManifest(variant), null);
  });
});

describe("one-resident lazy arena runtime", () => {
  it("loads only the manifest at boot, coalesces one domain image, and draws it", async () => {
    const loaded = loadModule();
    await loaded.api.loadManifest();
    assert.deepEqual(loaded.requests, ["battle-arenas/manifest.json"]);
    const [first, second] = await Promise.all([loaded.api.requestArena("MCP"), loaded.api.requestArena("MCP")]);
    assert.ok(first); assert.equal(first, second);
    assert.equal(loaded.requests.filter(value => value === "battle-arenas/mcp.png").length, 1);
    assert.equal(loaded.api.drawArena({ drawImage(...args) { loaded.draws.push(args); } }, "MCP", 0, 0, 800, 432), true);
    const diagnostics = loaded.api.getDiagnostics();
    assert.equal(diagnostics.activeDomain, "MCP"); assert.equal(diagnostics.residentArenaCount, 1);
    assert.equal(diagnostics.residentDecodedBytes, 1600*864*4); assert.equal(diagnostics.fallbackDecodedBytes, 0);
    assert.equal(diagnostics.inFlightArenaCount, 0); assert.equal(diagnostics.failedArenaCount, 0);
  });
  it("replaces rather than accumulates decoded arenas", async () => {
    const loaded = loadModule();
    await loaded.api.requestArena("MCP"); await loaded.api.requestArena("CONFIG");
    const diagnostics = loaded.api.getDiagnostics();
    assert.equal(diagnostics.activeDomain, "CONFIG"); assert.equal(diagnostics.residentArenaCount, 1);
    assert.equal(loaded.api.drawArena({ drawImage() {} }, "MCP", 0, 0, 800, 432), false);
  });
  it("bounds a stalled manifest and never requests an arena path", async () => {
    const loaded = loadModule({ fetchNever: true, instantTimeoutAt: 1 });
    assert.equal(await loaded.api.requestArena("MCP"), null);
    assert.equal(loaded.api.getDiagnostics().manifestStatus, "rejected");
    assert.deepEqual(loaded.requests, ["battle-arenas/manifest.json"]);
  });
  it("bounds a stalled or wrong-sized image and memoizes failure", async () => {
    const stalled = loadModule({ imageNever: true, instantTimeoutAt: 2 });
    assert.equal(await stalled.api.requestArena("MCP"), null);
    assert.equal(stalled.api.getDiagnostics().failedArenaCount, 1);
    assert.equal(await stalled.api.requestArena("MCP"), null);
    assert.equal(stalled.requests.filter(value => value === "battle-arenas/mcp.png").length, 1);
    const wrong = loadModule({ imageWidth: 800 });
    assert.equal(await wrong.api.requestArena("MCP"), null);
    assert.equal(wrong.api.getDiagnostics().failedArenaCount, 1);
  });
  it("rejects unknown domains and renders one bounded procedural fallback", async () => {
    const loaded = loadModule({ manifest: { malformed: true } });
    assert.equal(await loaded.api.requestArena("../../bad"), null);
    assert.equal(loaded.api.drawArena({ drawImage(...args) { loaded.draws.push(args); } }, "MCP", 0, 0, 800, 432), false);
    assert.equal(loaded.api.drawArena({ drawImage(...args) { loaded.draws.push(args); } }, "MCP", 0, 0, 800, 432), false);
    assert.equal(loaded.api.getDiagnostics().fallbackDomain, "MCP");
    assert.equal(loaded.api.getDiagnostics().fallbackDecodedBytes, 800*432*4);
    assert.equal(loaded.requests.some(value => value.includes("bad")), false);
  });
});
