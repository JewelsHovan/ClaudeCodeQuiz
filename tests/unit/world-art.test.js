import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let api = null;

before(() => {
  const source = fs.readFileSync("datamon/world-art.js", "utf8");
  const sandbox = {
    window: {},
    console,
    Math,
    performance: { now: () => 12345 },
    Image: function () { this.onload = null; this.onerror = null; this.src = ""; },
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve([]) }),
    document: {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({}), toDataURL: () => "" }),
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "datamon/world-art.js" });
  api = sandbox.window.DatamonWorldArt;
});

describe("DatamonWorldArt — detailScale", () => {
  it("returns 1 for DPR <= 1", () => {
    assert.equal(api.detailScale(0.5), 1);
    assert.equal(api.detailScale(1), 1);
  });

  it("returns 2 for DPR >= 2", () => {
    assert.equal(api.detailScale(2), 2);
    assert.equal(api.detailScale(3), 2);
    assert.equal(api.detailScale(4), 2);
  });

  it("preserves fractional DPR between 1 and 2", () => {
    assert.equal(api.detailScale(1.5), 1.5);
    assert.equal(api.detailScale(1.99), 1.99);
  });

  it("defaults to 1 for invalid/negative/falsy DPR", () => {
    assert.equal(api.detailScale(0), 1);
    assert.equal(api.detailScale(-1), 1);
    assert.equal(api.detailScale(NaN), 1);
    assert.equal(api.detailScale(undefined), 1);
    assert.equal(api.detailScale(null), 1);
  });
});

describe("DatamonWorldArt — cacheMetrics", () => {
  it("returns 6.75 MiB for two 1× 36×24×32 caches", () => {
    const m = api.cacheMetrics(36, 24, 32, 1, 2);
    // mapWidth = 36*32*1 = 1152, mapHeight = 24*32*1 = 768
    assert.equal(m.mapWidth, 1152);
    assert.equal(m.mapHeight, 768);
    assert.equal(m.mapPixels, 1152 * 768); // 884736
    assert.equal(m.singleCacheBytes, 1152 * 768 * 4);
    assert.equal(m.totalBytes, 1152 * 768 * 4 * 2);
    assert.ok(m.totalMiB > 6.7 && m.totalMiB < 6.8);
  });

  it("returns ~27 MiB for two 2× 36×24×32 caches", () => {
    const m = api.cacheMetrics(36, 24, 32, 2, 2);
    // mapWidth = 36*32*2 = 2304, mapHeight = 24*32*2 = 1536
    assert.equal(m.mapWidth, 2304);
    assert.equal(m.mapHeight, 1536);
    assert.equal(m.mapPixels, 2304 * 1536);
    assert.equal(m.singleCacheBytes, 2304 * 1536 * 4);
    assert.equal(m.totalBytes, 2304 * 1536 * 4 * 2);
    // 27.00 MiB exactly
    assert.ok(m.totalMiB > 26.9 && m.totalMiB <= 32);
  });

  it("uses integer backing dimensions", () => {
    const m = api.cacheMetrics(36, 24, 32, 2, 1);
    assert.equal(m.mapWidth, 2304);
    assert.equal(m.mapHeight, 1536);
    assert.ok(Number.isInteger(m.mapWidth));
    assert.ok(Number.isInteger(m.mapHeight));
  });
});

describe("DatamonWorldArt — cameraSourceRect", () => {
  it("matches the required example: (5.25, 3.5) at DPR2", () => {
    const r = api.cameraSourceRect(5.25, 3.5, 32, 800, 608, 2);
    assert.equal(r.sx, 336);
    assert.equal(r.sy, 224);
    assert.equal(r.sw, 1600);
    assert.equal(r.sh, 1216);
  });

  it("at DPR1 produces logical 800×608 source", () => {
    const r = api.cameraSourceRect(5.25, 3.5, 32, 800, 608, 1);
    assert.equal(r.sx, 168);
    assert.equal(r.sy, 112);
    assert.equal(r.sw, 800);
    assert.equal(r.sh, 608);
  });

  it("preserves negative top pad for HUD overscroll", () => {
    const r = api.cameraSourceRect(0, -2.25, 32, 800, 608, 2);
    assert.equal(r.sy, -144);
  });
});

describe("DatamonWorldArt — normalizeManifest", () => {
  function validEntry(id) {
    return {
      id, kind: "tile", slug: "test-" + id, file: id + ".png",
      widthPx: 32, heightPx: 32, sourceScale: 2,
      sourceWidthPx: 64, sourceHeightPx: 64,
      alphaMode: "opaque", scene: "office",
      fallback: "legacy", provenance: "pilot",
      reviewState: "pending", batchId: "batch-1",
    };
  }

  it("returns empty array for non-array input", () => {
    assert.equal(api.normalizeManifest(null).length, 0);
    assert.equal(api.normalizeManifest(undefined).length, 0);
    assert.equal(api.normalizeManifest("string").length, 0);
    assert.equal(api.normalizeManifest(42).length, 0);
  });

  it("rejects entries with duplicate IDs", () => {
    assert.equal(api.normalizeManifest([validEntry("a"), validEntry("a")]).length, 0);
  });

  it("rejects entries with missing required fields", () => {
    assert.equal(api.normalizeManifest([{ id: "a" }]).length, 0);
    assert.equal(api.normalizeManifest([{ id: "a", kind: "tile" }]).length, 0);
  });

  it("rejects invalid kind values", () => {
    const e = validEntry("a");
    e.kind = "invalid";
    assert.equal(api.normalizeManifest([e]).length, 0);
  });

  it("rejects invalid alphaMode", () => {
    const e = validEntry("a");
    e.alphaMode = "gradient";
    assert.equal(api.normalizeManifest([e]).length, 0);
  });

  it("rejects invalid reviewState", () => {
    const e = validEntry("a");
    e.reviewState = "unknown";
    assert.equal(api.normalizeManifest([e]).length, 0);
  });

  it("rejects empty scene string", () => {
    const e = validEntry("a");
    e.scene = "";
    assert.equal(api.normalizeManifest([e]).length, 0);
  });

  it("rejects non-integer sourceScale", () => {
    const e = validEntry("a");
    e.sourceScale = 1.5;
    assert.equal(api.normalizeManifest([e]).length, 0);
  });

  it("rejects non-integer dimensions", () => {
    const e = validEntry("a");
    e.widthPx = 32.5;
    assert.equal(api.normalizeManifest([e]).length, 0);
  });

  it("rejects invalid animation frames", () => {
    const e = validEntry("a");
    e.animation = { frames: 1, fps: 8, layout: "horizontal" }; // min 2
    assert.equal(api.normalizeManifest([e]).length, 0);
  });

  it("rejects animation fps > 12", () => {
    const e = validEntry("a");
    e.animation = { frames: 4, fps: 15, layout: "horizontal" };
    assert.equal(api.normalizeManifest([e]).length, 0);
  });

  it("rejects non-horizontal animation layout", () => {
    const e = validEntry("a");
    e.animation = { frames: 4, fps: 8, layout: "vertical" };
    assert.equal(api.normalizeManifest([e]).length, 0);
  });

  it("accepts valid entries", () => {
    const result = api.normalizeManifest([validEntry("a"), validEntry("b")]);
    assert.equal(result.length, 2);
  });

  it("accepts valid entries with optional animation", () => {
    const e = validEntry("anim");
    e.kind = "ambient";
    e.animation = { frames: 8, fps: 8, layout: "horizontal" };
    const result = api.normalizeManifest([e]);
    assert.equal(result.length, 1);
    assert.equal(result[0].animation.frames, 8);
  });

  it("rejects static sourceScale-2 width or height mismatches", () => {
    const wrongWidth = validEntry("wrong-width");
    wrongWidth.sourceWidthPx = 32;
    assert.equal(api.normalizeManifest([wrongWidth]).length, 0);

    const wrongHeight = validEntry("wrong-height");
    wrongHeight.sourceHeightPx = 32;
    assert.equal(api.normalizeManifest([wrongHeight]).length, 0);
  });

  it("rejects horizontal ambient per-frame dimension mismatches", () => {
    const e = validEntry("windows");
    e.kind = "ambient";
    e.widthPx = 160;
    e.heightPx = 32;
    e.sourceWidthPx = 160; // must be 320 per frame at sourceScale 2
    e.sourceHeightPx = 64;
    e.animation = { frames: 8, fps: 8, layout: "horizontal" };
    assert.equal(api.normalizeManifest([e]).length, 0);
  });
});

describe("DatamonWorldArt — expectedSourceSize", () => {
  it("returns declared source dimensions for static entries", () => {
    const s = api.expectedSourceSize({ sourceWidthPx: 64, sourceHeightPx: 64 });
    assert.equal(s.w, 64);
    assert.equal(s.h, 64);
  });

  it("multiplies width by frames for horizontal animation", () => {
    const s = api.expectedSourceSize({
      sourceWidthPx: 320, sourceHeightPx: 64,
      animation: { frames: 8, fps: 8, layout: "horizontal" },
    });
    assert.equal(s.w, 2560);
    assert.equal(s.h, 64);
  });
});

describe("DatamonWorldArt — decoded-pixel validation", () => {
  function pixels(width, height, rgba = [20, 30, 40, 255]) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
    return data;
  }

  function entry(overrides = {}) {
    return {
      id: "detail", kind: "tile", slug: "detail", file: "detail.png",
      widthPx: 2, heightPx: 2, sourceScale: 2,
      sourceWidthPx: 4, sourceHeightPx: 4,
      alphaMode: "opaque", scene: "office", fallback: "legacy:tile",
      provenance: "deterministic-recipe", reviewState: "accepted", batchId: "batch-test",
      ...overrides,
    };
  }

  it("rejects a trivial nearest-neighbour 2× upscale", () => {
    const data = pixels(4, 4);
    assert.equal(api.validatePixels(entry(), data, 4, 4).valid, false);
    assert.match(api.validatePixels(entry(), data, 4, 4).reason, /nearest/i);
  });

  it("accepts source detail inside a logical 2×2 pixel block", () => {
    const data = pixels(4, 4);
    data[0] = 21; // one physical-source pixel differs: not a duplicated 2× block
    assert.equal(api.validatePixels(entry(), data, 4, 4).valid, true);
  });

  it("rejects alpha-mode mismatches", () => {
    const data = pixels(4, 4);
    data[3] = 0;
    data[0] = 21;
    assert.equal(api.validatePixels(entry(), data, 4, 4).valid, false);

    const binary = entry({ alphaMode: "binary" });
    data[3] = 128;
    assert.equal(api.validatePixels(binary, data, 4, 4).valid, false);
  });
});

describe("DatamonWorldArt — animationFrame", () => {
  it("returns 0 when reduced motion is true", () => {
    assert.equal(api.animationFrame(5000, 8, 8, true), 0);
    assert.equal(api.animationFrame(0, 12, 6, true), 0);
  });

  it("cycles through frames based on elapsed time", () => {
    assert.equal(api.animationFrame(0, 8, 8, false), 0);
    assert.equal(api.animationFrame(125, 8, 8, false), 1);
    assert.equal(api.animationFrame(250, 8, 8, false), 2);
    assert.equal(api.animationFrame(1000, 8, 8, false), 0); // wraps
  });

  it("caps FPS at 12", () => {
    // fps=24 -> capped to 12; at 84ms, floor(84*12/1000) = floor(1.008) = 1
    assert.equal(api.animationFrame(84, 24, 10, false), 1);
    // at 83ms, floor(83*12/1000) = floor(0.996) = 0
    assert.equal(api.animationFrame(83, 24, 10, false), 0);
  });

  it("returns 0 for invalid frameCount", () => {
    assert.equal(api.animationFrame(100, 8, 0, false), 0);
    assert.equal(api.animationFrame(100, 8, -1, false), 0);
  });
});

describe("DatamonWorldArt — procedural ambient phase", () => {
  it("loops deterministically and pins reduced motion to zero", () => {
    assert.equal(api.ambientPhase(0, 2400, false), 0);
    assert.equal(api.ambientPhase(600, 2400, false), 0.25);
    assert.equal(api.ambientPhase(3000, 2400, false), 0.25);
    assert.equal(api.ambientPhase(1900, 2400, true), 0);
  });

  it("clamps invalid or tiny periods to a safe bounded cycle", () => {
    assert.equal(api.ambientPhase(125, 0, false), 0.125);
    assert.equal(api.ambientPhase(-10, 2400, false), 0);
  });
});

describe("DatamonWorldArt — detailScaling round-trip", () => {
  it("logical-to-physical conversion is consistent at scale 2", () => {
    const r = api.cameraSourceRect(5.25, 3.5, 32, 800, 608, 2);
    assert.equal(r.sw, 800 * 2);
    assert.equal(r.sh, 608 * 2);
  });

  it("logical-to-physical conversion is consistent at scale 1", () => {
    const r = api.cameraSourceRect(10, 10, 32, 800, 608, 1);
    assert.equal(r.sx, 320); // 10*32*1 = 320
    assert.equal(r.sy, 320);
    assert.equal(r.sw, 800);
    assert.equal(r.sh, 608);
  });
});

describe("DatamonWorldArt — init and runtime", () => {
  it("init sets detail scale and reduced motion state", () => {
    // init reads window.devicePixelRatio — in vm it's undefined, so defaults to 1
    api.init();
    assert.equal(api.getDetailScale(), 1); // default in vm without devicePixelRatio
    assert.equal(api.isReducedMotion(), false);
  });

  it("diagnostics are bounded", () => {
    for (let i = 0; i < 200; i++) api.recordFrameSample(i * 0.1);
    const d = api.getDiagnostics();
    assert.ok(d.samples <= 120);
  });
});
