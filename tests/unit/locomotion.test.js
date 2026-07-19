import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let api;
before(() => {
  const source = fs.readFileSync("datamon/locomotion.js", "utf8");
  const sandbox = { window: {}, console, Math, Number, Object, Array };
  vm.runInNewContext(source, sandbox, { filename: "datamon/locomotion.js" });
  api = sandbox.window.DatamonLocomotion;
});

describe("DatamonLocomotion phase contract", () => {
  it("normalizes modulo boundaries and invalid values", () => {
    assert.equal(api.positiveModulo(1, 1), 0);
    assert.equal(api.positiveModulo(-0.25, 1), 0.75);
    assert.equal(api.positiveModulo(8 / 2, 1), 0);
    assert.equal(api.positiveModulo(NaN, 1), 0);
  });

  it("maps the four authored gait poses to quarter-cycle phases", () => {
    assert.deepEqual([0, 0.249, 0.25, 0.499, 0.5, 0.749, 0.75, 0.999].map(p => api.frameIndex(p, 4)), [0, 0, 1, 1, 2, 2, 3, 3]);
    assert.equal(api.contactAtPhase(0), "left");
    assert.equal(api.contactAtPhase(0.5), "right");
    assert.equal(api.contactAtPhase(0.25), null);
  });

  it("reports each crossed contact exactly once", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(api.advancePhase(0.49, 0.04, 2))), {
      phase: 0.51, contacts: [{ phase: 0.5, foot: "right" }],
    });
    assert.deepEqual(JSON.parse(JSON.stringify(api.advancePhase(0.99, 0.04, 2))), {
      phase: 0.010000000000000009, contacts: [{ phase: 0, foot: "left" }],
    });
    assert.equal(api.advancePhase(0.5, 0.01, 2).contacts.length, 0);
  });

  it("converges to equal distance and phase at 30/60/120Hz", () => {
    for (const hz of [30, 60, 120]) {
      let phase = 0, distance = 0;
      for (let i = 0; i < hz * 2; i++) {
        const delta = 4 / hz;
        distance += delta;
        phase = api.advancePhase(phase, delta, 2).phase;
      }
      assert.ok(Math.abs(distance - 8) < 1e-9, `${hz}Hz distance`);
      assert.equal(phase, 0, `${hz}Hz phase`);
    }
  });

  it("advances linear position, phase, frames, and contacts identically at 30/60/120Hz", () => {
    function simulate(hz, multiplier) {
      let tile=0, state={startX:0,startY:3,targetX:1,targetY:3,stepT:0,phase:0};
      let x=0,phase=0,contacts=0,frame=0;
      for(let tick=0;tick<hz*2;tick++) {
        let budget=5*multiplier/hz,guard=0;
        while(budget>1e-12&&guard++<4) {
          const result=api.advanceTile(state,budget,2,8);
          x=result.x;phase=result.phase;frame=result.frameIndex;contacts+=result.contacts.length;
          budget=result.remainingBudget;
          if(result.complete) {
            tile++;state={startX:tile,startY:3,targetX:tile+1,targetY:3,stepT:0,phase};
          } else state={...state,stepT:result.stepT,phase};
        }
      }
      return{x,phase,frame,contacts,tile};
    }
    for(const multiplier of [0.85,1,1.1]) {
      const expectedDistance=10*multiplier,expectedPhase=api.phaseForDistance(expectedDistance,2);
      const results=[30,60,120].map(hz=>simulate(hz,multiplier));
      for(const result of results) {
        assert.ok(Math.abs(result.x-expectedDistance)<1e-9);
        assert.ok(Math.abs(result.phase-expectedPhase)<1e-9);
        assert.equal(result.frame,api.frameIndex(expectedPhase,8));
        assert.equal(result.contacts,Math.floor(expectedDistance+1e-9));
      }
    }
  });

  it("returns defensive named profiles and defaults to balanced", () => {
    const balanced = api.profile("balanced"), fallback = api.profile("nope");
    assert.deepEqual(JSON.parse(JSON.stringify(balanced)), {
      name: "balanced", walkTilesPerSecond: 5, runTilesPerSecond: 8.5,
      walkCycleTiles: 2, runCycleTiles: 2,
    });
    assert.deepEqual(fallback, balanced);
    balanced.walkTilesPerSecond = 99;
    assert.equal(api.profile("balanced").walkTilesPerSecond, 5);
  });
});

describe("DatamonLocomotion presentation helpers", () => {
  it("peaks shadow contact weight at left/right contacts", () => {
    assert.ok(Math.abs(api.contactWeight(0) - 1) < 1e-12);
    assert.ok(Math.abs(api.contactWeight(0.5) - 1) < 1e-12);
    assert.ok(Math.abs(api.contactWeight(0.25) + 1) < 1e-12);
  });

  it("normalizes authored canvas margins to the standing model scale", () => {
    assert.equal(api.AUTHORED_VISIBLE_RATIO, 14 / 15);
    assert.equal(api.authoredFrameScale(240, 56), 0.25);
    assert.equal(240 * api.authoredFrameScale(240, 56), 60);
    assert.equal(api.authoredFrameScale(0, 56), 1);
    assert.equal(api.authoredFrameScale(240, NaN), 1);
  });

  it("preserves the old 60Hz camera response and matches elapsed time at 120Hz", () => {
    assert.ok(Math.abs(api.cameraFactor(1 / 60) - 0.12) < 1e-12);
    const sixtyRetention = Math.pow(1 - api.cameraFactor(1 / 60), 60);
    const oneTwentyRetention = Math.pow(1 - api.cameraFactor(1 / 120), 120);
    assert.ok(Math.abs(sixtyRetention - oneTwentyRetention) < 1e-12);
  });

  function manifest() {
    const frames = {};
    for (const direction of ["down", "up", "left", "right"]) {
      for (let index = 0; index < 4; index++) {
        frames[`${direction}_${index}`] = {
          width: 100, height: 240, bodyX: 49.25, footY: 228,
          phase: index / 4, contactFoot: index === 0 ? "left" : index === 2 ? "right" : null,
        };
      }
    }
    return { schemaVersion: 1, frameCount: 4, cycleDistanceTiles: 2, anchorMethod: "alpha-body-midpoint-v1", frames };
  }

  it("accepts a complete anchor manifest and resolves visible-foot metadata", () => {
    const normalized = api.normalizeAnchorManifest(manifest());
    assert.ok(normalized);
    assert.ok(Object.isFrozen(normalized));
    assert.deepEqual(JSON.parse(JSON.stringify(api.resolveFrameAnchor(normalized, "right", 2, 100, 240))), {
      bodyX: 49.25, footY: 228, rootY: null, width: 100, height: 240, metadata: true,
    });
  });

  it("rejects partial or semantically wrong metadata and falls back safely", () => {
    const partial = manifest(); delete partial.frames.up_3;
    assert.equal(api.normalizeAnchorManifest(partial), null);
    const wrongContact = manifest(); wrongContact.frames.down_0.contactFoot = "right";
    assert.equal(api.normalizeAnchorManifest(wrongContact), null);
    assert.deepEqual(JSON.parse(JSON.stringify(api.resolveFrameAnchor(null, "down", 0, 120, 240))), {
      bodyX: 60, footY: 240, rootY: null, width: 120, height: 240, metadata: false,
    });
  });

  function pilotManifest() {
    const motions = {};
    for (const motion of ["walk", "run"]) {
      const frames = {}, groundY = {};
      for (const direction of ["down", "up", "left", "right"]) {
        groundY[direction] = 228;
        for (let index = 0; index < 8; index++) {
          frames[`${direction}_${index}`] = {
            width: 100, height: 240, bodyX: 49.5, footY: index === 3 || index === 7 ? 216 : 228,
            rootY: 138, phase: index / 8,
            contactFoot: index === 0 ? "left" : index === 4 ? "right" : null,
          };
        }
      }
      motions[motion] = { frames, groundY: motion === "run" ? groundY : {} };
    }
    const idleFrames={};
    for(const direction of ["down","up","left","right"])
      idleFrames[`${direction}_0`]={width:100,height:240,bodyX:49.5,footY:228,rootY:138,phase:0,contactFoot:null};
    motions.idle={frames:idleFrames,groundY:{}};
    return { schemaVersion: 1, frameCount: 8, idleFrameCount: 1, cycleDistanceTiles: 2,
      anchorMethod: "alpha-head-torso-root-v1", motions };
  }

  it("validates the bounded eight-frame walk/run pilot and exposes root anchors", () => {
    const normalized = api.normalizePilotManifest(pilotManifest());
    assert.ok(normalized);
    assert.equal(normalized.motions.run.groundY.right, 228);
    assert.equal(normalized.motions.idle.frames.left_0.contactFoot, null);
    assert.deepEqual(JSON.parse(JSON.stringify(api.resolveFrameAnchor(normalized.motions.run, "right", 7, 100, 240))), {
      bodyX: 49.5, footY: 216, rootY: 138, width: 100, height: 240, metadata: true,
    });
    const noFlightGround = pilotManifest(); delete noFlightGround.motions.run.groundY.up;
    assert.equal(api.normalizePilotManifest(noFlightGround), null);
    const duplicateContact = pilotManifest(); duplicateContact.motions.walk.frames.down_1.contactFoot = "left";
    assert.equal(api.normalizePilotManifest(duplicateContact), null);
  });
});
