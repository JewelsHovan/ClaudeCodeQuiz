import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { normalizeLayout, parseGeometrySource } from "../../scripts/battle-layout-editor.mjs";

const root = path.resolve(import.meta.dirname, "../..");

describe("battle layout editor handoff", () => {
  it("reads the current immutable stage geometry", () => {
    const source = fs.readFileSync(path.join(root, "datamon/battle-presentation.js"), "utf8");
    const geometry = parseGeometrySource(source);
    assert.deepEqual(Array.from(geometry.PLAYER_ANCHOR), [151, 340]);
    assert.deepEqual(Array.from(geometry.OPPONENT_ANCHOR), [683, 158]);
    assert.deepEqual(Array.from(geometry.BATTLEMON_CENTER), [495, 170]);
    assert.ok(Object.isFrozen(geometry));
  });

  it("accepts only bounded integer drag results", () => {
    const valid = normalizeLayout({
      geometry: {
        PLAYER_ANCHOR: [161, 362],
        OPPONENT_ANCHOR: [674, 166],
        BATTLEMON_CENTER: [489, 201],
      },
      preview: { domain: "PROMPT", phase: "sendout" },
    });
    assert.deepEqual(valid.geometry, {
      PLAYER_ANCHOR: [161, 362],
      OPPONENT_ANCHOR: [674, 166],
      BATTLEMON_CENTER: [489, 201],
    });
    assert.equal(normalizeLayout({ geometry: { ...valid.geometry, PLAYER_ANCHOR: [1.5, 2] } }), null);
    assert.equal(normalizeLayout({ geometry: { ...valid.geometry, BATTLEMON_CENTER: [2000, 2] } }), null);
  });

  it("falls back to a safe preview without changing geometry", () => {
    const valid = normalizeLayout({ geometry: {
      PLAYER_ANCHOR: [151, 340], OPPONENT_ANCHOR: [683, 158], BATTLEMON_CENTER: [495, 170],
    }, preview: { domain: "UNKNOWN", phase: "faint" } });
    assert.deepEqual(valid.preview, { domain: "PROMPT", phase: "sendout" });
  });
});
