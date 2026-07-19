// DATAMON overworld locomotion contract.
// Pure classic script: movement/rendering use one distance-derived phase and deterministic
// per-frame anchors. No DOM, RNG, audio, save, collision, or gameplay-state ownership.
(function (global) {
  "use strict";

  var EPSILON = 1e-9;
  // Authored 240px locomotion canvases reserve a stable 8px crown and 8px sole margin,
  // leaving 224px of upright visible character. Normalize that visible span—not the whole
  // transparent canvas—to the standing trainer height so idle and movement retain one scale.
  var AUTHORED_VISIBLE_RATIO = 14 / 15;
  var DIRECTIONS = Object.freeze(["down", "up", "left", "right"]);
  var CONTACT_MARKERS = Object.freeze([
    Object.freeze({ phase: 0, foot: "left" }),
    Object.freeze({ phase: 0.5, foot: "right" }),
  ]);
  var PROFILES = Object.freeze({
    gba: Object.freeze({ name: "gba", walkTilesPerSecond: 4, runTilesPerSecond: 7.5, walkCycleTiles: 2, runCycleTiles: 2 }),
    balanced: Object.freeze({ name: "balanced", walkTilesPerSecond: 5, runTilesPerSecond: 8.5, walkCycleTiles: 2, runCycleTiles: 2 }),
    fast: Object.freeze({ name: "fast", walkTilesPerSecond: 7.5, runTilesPerSecond: 12.5, walkCycleTiles: 2, runCycleTiles: 2 }),
  });

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function positiveModulo(value, modulus) {
    if (!finite(value) || !finite(modulus) || modulus <= 0) return 0;
    var result = ((value % modulus) + modulus) % modulus;
    if (Math.abs(result) <= EPSILON || Math.abs(result - modulus) <= EPSILON) return 0;
    return result;
  }

  function profile(name) {
    var source = PROFILES[name] || PROFILES.balanced;
    return {
      name: source.name,
      walkTilesPerSecond: source.walkTilesPerSecond,
      runTilesPerSecond: source.runTilesPerSecond,
      walkCycleTiles: source.walkCycleTiles,
      runCycleTiles: source.runCycleTiles,
    };
  }

  function phaseForDistance(distanceTiles, cycleDistanceTiles) {
    if (!finite(distanceTiles) || !finite(cycleDistanceTiles) || cycleDistanceTiles <= 0) return 0;
    return positiveModulo(distanceTiles / cycleDistanceTiles, 1);
  }

  function advancePhase(previousPhase, distanceTiles, cycleDistanceTiles) {
    var start = positiveModulo(previousPhase, 1);
    if (!finite(distanceTiles) || distanceTiles <= 0 || !finite(cycleDistanceTiles) || cycleDistanceTiles <= 0) {
      return { phase: start, contacts: [] };
    }
    var phaseAdvance = distanceTiles / cycleDistanceTiles;
    var end = start + phaseAdvance;
    var contacts = [];
    // Contact boundaries occur every half cycle. The strict lower bound prevents duplicate
    // events when an update starts exactly on a marker; movement-start owns that event.
    var firstHalf = Math.floor((start + EPSILON) * 2) + 1;
    var lastHalf = Math.floor((end + EPSILON) * 2);
    for (var half = firstHalf; half <= lastHalf && contacts.length < 8; half++) {
      var boundary = half / 2;
      if (boundary <= start + EPSILON || boundary > end + EPSILON) continue;
      contacts.push({
        phase: positiveModulo(boundary, 1),
        foot: half % 2 === 0 ? "left" : "right",
      });
    }
    return { phase: positiveModulo(end, 1), contacts: contacts };
  }

  function advanceTile(state, distanceBudget, cycleDistanceTiles, frameCount) {
    var source = state && typeof state === "object" ? state : {};
    var startX = finite(source.startX) ? source.startX : 0;
    var startY = finite(source.startY) ? source.startY : 0;
    var targetX = finite(source.targetX) ? source.targetX : startX;
    var targetY = finite(source.targetY) ? source.targetY : startY;
    var startT = finite(source.stepT) ? Math.max(0, Math.min(1, source.stepT)) : 0;
    var budget = finite(distanceBudget) ? Math.max(0, distanceBudget) : 0;
    var traveledDistance = Math.min(1 - startT, budget);
    var stepT = Math.min(1, startT + traveledDistance);
    var phaseResult = advancePhase(source.phase, traveledDistance, cycleDistanceTiles);
    return {
      x: startX + (targetX - startX) * stepT,
      y: startY + (targetY - startY) * stepT,
      stepT: stepT,
      traveledDistance: traveledDistance,
      remainingBudget: Math.max(0, budget - traveledDistance),
      complete: stepT >= 1 - EPSILON,
      phase: phaseResult.phase,
      frameIndex: frameIndex(phaseResult.phase, frameCount),
      contacts: phaseResult.contacts,
    };
  }

  function contactAtPhase(phase, tolerance) {
    var p = positiveModulo(phase, 1);
    var limit = finite(tolerance) && tolerance >= 0 ? tolerance : 1e-6;
    if (Math.min(p, 1 - p) <= limit) return "left";
    if (Math.abs(p - 0.5) <= limit) return "right";
    return null;
  }

  function frameIndex(phase, frameCount) {
    var count = Number.isInteger(frameCount) && frameCount > 0 ? frameCount : 1;
    return Math.min(count - 1, Math.floor(positiveModulo(phase, 1) * count + EPSILON));
  }

  function contactWeight(phase) {
    return Math.cos(positiveModulo(phase, 1) * Math.PI * 4);
  }

  function authoredFrameScale(sourceHeight, targetVisibleHeight) {
    if (!finite(sourceHeight) || sourceHeight <= 0 || !finite(targetVisibleHeight) || targetVisibleHeight <= 0) return 1;
    return targetVisibleHeight / (sourceHeight * AUTHORED_VISIBLE_RATIO);
  }

  function cameraFactor(dtSeconds, referencePerFrame, referenceHz) {
    if (!finite(dtSeconds) || dtSeconds <= 0) return 0;
    var perFrame = finite(referencePerFrame) && referencePerFrame > 0 && referencePerFrame < 1
      ? referencePerFrame : 0.12;
    var hz = finite(referenceHz) && referenceHz > 0 ? referenceHz : 60;
    var lambda = -Math.log(1 - perFrame) * hz;
    return Math.max(0, Math.min(1, 1 - Math.exp(-lambda * dtSeconds)));
  }

  function validFrameAnchor(value, direction, index) {
    if (!value || typeof value !== "object") return false;
    if (!DIRECTIONS.includes(direction) || !Number.isInteger(index) || index < 0 || index > 3) return false;
    if (!Number.isInteger(value.width) || value.width <= 0 || !Number.isInteger(value.height) || value.height <= 0) return false;
    if (!finite(value.bodyX) || value.bodyX < 0 || value.bodyX >= value.width) return false;
    if (!finite(value.footY) || value.footY < 0 || value.footY >= value.height) return false;
    var expectedContact = index === 0 ? "left" : index === 2 ? "right" : null;
    if ((value.contactFoot || null) !== expectedContact) return false;
    var expectedPhase = index / 4;
    if (!finite(value.phase) || Math.abs(value.phase - expectedPhase) > EPSILON) return false;
    return true;
  }

  function normalizeAnchorManifest(raw) {
    if (!raw || typeof raw !== "object" || raw.schemaVersion !== 1 || raw.frameCount !== 4 || raw.cycleDistanceTiles !== 2) return null;
    if (!raw.frames || typeof raw.frames !== "object" || Array.isArray(raw.frames)) return null;
    var frames = {};
    for (var d = 0; d < DIRECTIONS.length; d++) {
      var direction = DIRECTIONS[d];
      for (var index = 0; index < 4; index++) {
        var key = direction + "_" + index;
        var value = raw.frames[key];
        if (!validFrameAnchor(value, direction, index)) return null;
        frames[key] = Object.freeze({
          width: value.width,
          height: value.height,
          bodyX: value.bodyX,
          footY: value.footY,
          phase: value.phase,
          contactFoot: value.contactFoot || null,
        });
      }
    }
    return Object.freeze({
      schemaVersion: 1,
      frameCount: 4,
      cycleDistanceTiles: 2,
      anchorMethod: typeof raw.anchorMethod === "string" ? raw.anchorMethod : "body-center-v1",
      frames: Object.freeze(frames),
    });
  }

  function validPilotAnchor(value, index) {
    if (!value || typeof value !== "object" || !Number.isInteger(index) || index < 0 || index > 7) return false;
    if (!Number.isInteger(value.width) || value.width <= 0 || !Number.isInteger(value.height) || value.height <= 0) return false;
    if (!finite(value.bodyX) || value.bodyX < 0 || value.bodyX >= value.width) return false;
    if (!finite(value.footY) || value.footY < 0 || value.footY >= value.height) return false;
    if (!finite(value.rootY) || value.rootY < 0 || value.rootY >= value.height) return false;
    var expectedContact = index === 0 ? "left" : index === 4 ? "right" : null;
    if ((value.contactFoot || null) !== expectedContact) return false;
    return finite(value.phase) && Math.abs(value.phase - index / 8) <= EPSILON;
  }

  function normalizePilotManifest(raw) {
    if (!raw || typeof raw !== "object" || raw.schemaVersion !== 1 || raw.frameCount !== 8 || raw.idleFrameCount !== 1 || raw.cycleDistanceTiles !== 2) return null;
    if (!raw.motions || typeof raw.motions !== "object") return null;
    var motions = {};
    for (var motionIndex = 0; motionIndex < 2; motionIndex++) {
      var motionName = motionIndex === 0 ? "walk" : "run";
      var source = raw.motions[motionName];
      if (!source || !source.frames || typeof source.frames !== "object") return null;
      var frames = {}, groundY = {};
      for (var d = 0; d < DIRECTIONS.length; d++) {
        var direction = DIRECTIONS[d];
        for (var index = 0; index < 8; index++) {
          var key = direction + "_" + index;
          var value = source.frames[key];
          if (!validPilotAnchor(value, index)) return null;
          frames[key] = Object.freeze({
            width: value.width, height: value.height, bodyX: value.bodyX,
            footY: value.footY, rootY: value.rootY, phase: value.phase,
            contactFoot: value.contactFoot || null,
          });
        }
        if (motionName === "run") {
          if (!source.groundY || !finite(source.groundY[direction]) || source.groundY[direction] < 0) return null;
          groundY[direction] = source.groundY[direction];
        }
      }
      motions[motionName] = Object.freeze({ frames: Object.freeze(frames), groundY: Object.freeze(groundY) });
    }
    var idleSource = raw.motions.idle;
    if (!idleSource || !idleSource.frames || typeof idleSource.frames !== "object") return null;
    var idleFrames = {};
    for (var idleDirectionIndex = 0; idleDirectionIndex < DIRECTIONS.length; idleDirectionIndex++) {
      var idleDirection = DIRECTIONS[idleDirectionIndex], idleKey = idleDirection + "_0";
      var idleValue = idleSource.frames[idleKey];
      if (!idleValue || !Number.isInteger(idleValue.width) || idleValue.width <= 0 ||
          !Number.isInteger(idleValue.height) || idleValue.height <= 0 ||
          !finite(idleValue.bodyX) || idleValue.bodyX < 0 || idleValue.bodyX >= idleValue.width ||
          !finite(idleValue.footY) || idleValue.footY < 0 || idleValue.footY >= idleValue.height ||
          !finite(idleValue.rootY) || idleValue.rootY < 0 || idleValue.rootY >= idleValue.height ||
          idleValue.phase !== 0 || (idleValue.contactFoot || null) !== null) return null;
      idleFrames[idleKey] = Object.freeze({
        width: idleValue.width, height: idleValue.height, bodyX: idleValue.bodyX,
        footY: idleValue.footY, rootY: idleValue.rootY, phase: 0, contactFoot: null,
      });
    }
    motions.idle = Object.freeze({ frames: Object.freeze(idleFrames), groundY: Object.freeze({}) });
    return Object.freeze({
      schemaVersion: 1, frameCount: 8, idleFrameCount: 1, cycleDistanceTiles: 2,
      anchorMethod: typeof raw.anchorMethod === "string" ? raw.anchorMethod : "body-center-v1",
      motions: Object.freeze(motions),
    });
  }

  function resolveFrameAnchor(manifest, direction, index, imageWidth, imageHeight) {
    var width = finite(imageWidth) && imageWidth > 0 ? imageWidth : 1;
    var height = finite(imageHeight) && imageHeight > 0 ? imageHeight : 1;
    var fallback = { bodyX: width / 2, footY: height, rootY: null, width: width, height: height, metadata: false };
    if (!manifest || !manifest.frames || !DIRECTIONS.includes(direction) || !Number.isInteger(index)) return fallback;
    var value = manifest.frames[direction + "_" + index];
    if (!value || value.width !== width || value.height !== height) return fallback;
    return { bodyX: value.bodyX, footY: value.footY,
      rootY: finite(value.rootY) ? value.rootY : null, width: width, height: height, metadata: true };
  }

  var API = {
    EPSILON: EPSILON,
    AUTHORED_VISIBLE_RATIO: AUTHORED_VISIBLE_RATIO,
    DIRECTIONS: DIRECTIONS,
    CONTACT_MARKERS: CONTACT_MARKERS,
    PROFILES: PROFILES,
    positiveModulo: positiveModulo,
    profile: profile,
    phaseForDistance: phaseForDistance,
    advancePhase: advancePhase,
    advanceTile: advanceTile,
    contactAtPhase: contactAtPhase,
    frameIndex: frameIndex,
    contactWeight: contactWeight,
    authoredFrameScale: authoredFrameScale,
    cameraFactor: cameraFactor,
    normalizeAnchorManifest: normalizeAnchorManifest,
    normalizePilotManifest: normalizePilotManifest,
    resolveFrameAnchor: resolveFrameAnchor,
  };

  global.DatamonLocomotion = Object.freeze(API);
})(typeof window !== "undefined" ? window : globalThis);
