// DATAMON classic-battle presentation contract.
// Pure taxonomy/state helpers plus a bounded, fail-closed Battlemon asset loader.
"use strict";

(function () {
  var CANONICAL_DOMAINS = Object.freeze(["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT"]);
  var CANONICAL_NAMES = Object.freeze({
    AGENT: Object.freeze(["Rogue Subagent", "Infinite Loop", "Stop Reason", "Task Spawner", "Orphan Process", "Stale Coordinator", "Fork Bomb"]),
    MCP: Object.freeze(["Schema Mismatch", "Tool Sprawl", "Stdio Zombie", "JSON-RPC Gremlin", "Deprecated SSE", "Scope Creep Server", "isError Imp"]),
    CONFIG: Object.freeze(["Hook Loop", "Permission Prompt", "CLAUDE.md Bloat", "Settings Drift", "Deny Rule", "Headless Hang", "Exit Code 2"]),
    PROMPT: Object.freeze(["Prompt Injector", "XML Tag Soup", "Vague Modifier", "Hallucinator", "Malformed JSON", "Chatty Preamble", "Forced Enum"]),
    CONTEXT: Object.freeze(["Context Rot", "Lost Middle", "Token Gobbler", "Cache Miss", "Compaction Crash", "Rate Limiter", "Stale Summary"]),
  });
  var BATTLEMON_FRAMES = Object.freeze(["idle-a", "idle-b", "sendout", "attack", "hit", "faint"]);
  var FRAME_INDEX = Object.freeze({ "idle-a": 0, "idle-b": 1, sendout: 2, attack: 3, hit: 4, faint: 5 });
  var SHEET_WIDTH = 768, SHEET_HEIGHT = 128, FRAME_SIZE = 128;
  var MANIFEST_TIMEOUT_MS = 5000, SHEET_TIMEOUT_MS = 5000;
  var BATCH_ID = "classic-battlemon-v2";
  var PROVENANCE = "reviewed-openrouter-gemini3pro+pillow-animation-v1";
  var SOURCE_BATCH = "battlemon-ai-sources-v1";
  var SOURCE_MODEL = "google/gemini-3-pro-image";
  var ROOT_KEYS = Object.freeze([
    "assetCount", "batch", "batchSha256", "entries", "format", "frameCount",
    "frameHeight", "frameWidth", "layout", "provenance", "reviewState",
    "schemaVersion", "sourceBatch", "sourceModel", "sourceReviewSha256", "states",
  ]);
  var ENTRY_KEYS = Object.freeze([
    "domain", "file", "frameHeight", "frameWidth", "frames", "id", "name",
    "sha256", "silhouetteFamily", "sourceSha256", "variant",
  ]);

  var GEOMETRY = Object.freeze({
    PLAYER_ANCHOR: Object.freeze([160, 408]),
    OPPONENT_ANCHOR: Object.freeze([657, 208]),
    PLAYER_VISIBLE_HEIGHT: 172,
    OPPONENT_VISIBLE_HEIGHT: 156,
    BATTLEMON_CENTER_X: 502,
    BATTLEMON_CENTER_Y: 246,
    BATTLEMON_DRAW_SIZE: 128,
    STAGE_BOTTOM: 432,
    OPPONENT_PLATE: Object.freeze([18, 16, 310, 86]),
    PLAYER_PLATE: Object.freeze([500, 340, 782, 412]),
  });
  // Vertical scale stays exactly 1 in every pose so the reviewed 172px/156px visible-height
  // contract remains true at semantic endpoints and the far trainer can never dominate.
  var POSE_PARAMS = Object.freeze({
    idle: Object.freeze({ dx: 0, dy: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 255 }),
    challenge: Object.freeze({ dx: 8, dy: -2, rotation: -3, scaleX: 1.01, scaleY: 1, alpha: 255 }),
    command: Object.freeze({ dx: 12, dy: -3, rotation: -4, scaleX: 1.02, scaleY: 1, alpha: 255 }),
    hit: Object.freeze({ dx: -10, dy: 2, rotation: 6, scaleX: 1.04, scaleY: 1, alpha: 255 }),
    win: Object.freeze({ dx: 0, dy: -10, rotation: -2, scaleX: 1.03, scaleY: 1, alpha: 255 }),
    loss: Object.freeze({ dx: -4, dy: 7, rotation: 5, scaleX: 1.04, scaleY: 1, alpha: 205 }),
  });

  var _nameToDomain = Object.create(null);
  var _canonicalEntries = [];
  for (var domainIndex = 0; domainIndex < CANONICAL_DOMAINS.length; domainIndex++) {
    var canonicalDomain = CANONICAL_DOMAINS[domainIndex];
    for (var nameIndex = 0; nameIndex < CANONICAL_NAMES[canonicalDomain].length; nameIndex++) {
      var canonicalName = CANONICAL_NAMES[canonicalDomain][nameIndex];
      _nameToDomain[canonicalName.toLowerCase()] = canonicalDomain;
      _canonicalEntries.push(Object.freeze({ domain: canonicalDomain, name: canonicalName, variant: nameIndex }));
    }
  }
  Object.freeze(_canonicalEntries);

  function battlemonId(domain, name) {
    if (typeof domain !== "string" || typeof name !== "string" || !domain || !name) return null;
    var normalizedDomain = domain.toUpperCase();
    var normalizedName = name.toLowerCase();
    if (!CANONICAL_NAMES[normalizedDomain] || _nameToDomain[normalizedName] !== normalizedDomain) return null;
    var slug = normalizedName.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return normalizedDomain.toLowerCase() + "-" + slug;
  }

  function _exactKeys(value, expected) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    var keys = Object.keys(value).sort();
    if (keys.length !== expected.length) return false;
    for (var index = 0; index < expected.length; index++) if (keys[index] !== expected[index]) return false;
    return true;
  }

  function _exactArray(value, expected) {
    if (!Array.isArray(value) || value.length !== expected.length) return false;
    for (var index = 0; index < expected.length; index++) if (value[index] !== expected[index]) return false;
    return true;
  }

  function _sha256(value) {
    return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  }

  function normalizeManifest(manifest) {
    if (!_exactKeys(manifest, ROOT_KEYS) || manifest.schemaVersion !== 1 ||
        manifest.batch !== BATCH_ID || manifest.reviewState !== "accepted" ||
        manifest.provenance !== PROVENANCE || manifest.sourceBatch !== SOURCE_BATCH ||
        manifest.sourceModel !== SOURCE_MODEL || !_sha256(manifest.sourceReviewSha256) ||
        manifest.format !== "RGBA" || manifest.layout !== "horizontal" || manifest.frameCount !== 6 ||
        manifest.frameWidth !== FRAME_SIZE || manifest.frameHeight !== FRAME_SIZE ||
        manifest.assetCount !== 35 || !_sha256(manifest.batchSha256) ||
        !_exactArray(manifest.states, BATTLEMON_FRAMES) ||
        !Array.isArray(manifest.entries) || manifest.entries.length !== 35) return null;

    var accepted = new Map();
    for (var index = 0; index < _canonicalEntries.length; index++) {
      var expected = _canonicalEntries[index];
      var entry = manifest.entries[index];
      var expectedId = battlemonId(expected.domain, expected.name);
      if (!_exactKeys(entry, ENTRY_KEYS) || entry.id !== expectedId ||
          entry.name !== expected.name || entry.domain !== expected.domain ||
          entry.variant !== expected.variant || entry.file !== expectedId + ".png" ||
          entry.frameWidth !== FRAME_SIZE || entry.frameHeight !== FRAME_SIZE ||
          !_exactArray(entry.frames, BATTLEMON_FRAMES) || !_sha256(entry.sourceSha256) ||
          !_sha256(entry.sha256) || entry.silhouetteFamily !== expected.domain.toLowerCase()) return null;
      accepted.set(expectedId, Object.freeze({
        id: expectedId,
        name: expected.name,
        domain: expected.domain,
        variant: expected.variant,
        file: expectedId + ".png",
        frameWidth: FRAME_SIZE,
        frameHeight: FRAME_SIZE,
        frames: BATTLEMON_FRAMES,
        sourceSha256: entry.sourceSha256,
        sha256: entry.sha256,
        silhouetteFamily: expected.domain.toLowerCase(),
      }));
    }
    return accepted.size === 35 ? accepted : null;
  }

  function resolveTrainerPose(who, phase, feedback, impactActive) {
    var playerSide = who === "player";
    if (impactActive && phase === "question") return playerSide ? "hit" : "command";
    if (phase === "intro") return playerSide ? "idle" : "challenge";
    if (phase === "sendout") return playerSide ? "idle" : "command";
    if (phase === "feedback") {
      var correct = !!(feedback && feedback.correct === true);
      return correct ? (playerSide ? "command" : "hit") : (playerSide ? "hit" : "command");
    }
    if (phase === "win") return playerSide ? "win" : "loss";
    if (phase === "lose") return playerSide ? "loss" : "win";
    return "idle";
  }

  function resolveBattlemonState(phase, now, attackAt, faintAt, reducedMotion) {
    var current = Number.isFinite(now) ? now : 0;
    if (phase === "intro" || phase === "sendout") return "sendout";
    if (Number.isFinite(faintAt) && faintAt > 0 && current >= faintAt) {
      return current - faintAt < 8 ? "hit" : "faint";
    }
    if (Number.isFinite(attackAt) && attackAt > 0 && current >= attackAt && current - attackAt < 16) {
      return "attack";
    }
    if (reducedMotion) return "idle-a";
    return Math.floor(current / 30) % 2 === 0 ? "idle-a" : "idle-b";
  }

  var _alphaBounds = new WeakMap();
  var _alphaBoundsCount = 0;
  var _alphaScanCanvas = null;
  function computeAlphaBounds(image) {
    if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) return null;
    if (_alphaBounds.has(image)) {
      var cached = _alphaBounds.get(image);
      return cached === false ? null : cached;
    }
    try {
      _alphaScanCanvas = _alphaScanCanvas || document.createElement("canvas");
      _alphaScanCanvas.width = image.naturalWidth;
      _alphaScanCanvas.height = image.naturalHeight;
      var scan = _alphaScanCanvas.getContext("2d", { willReadFrequently: true });
      scan.clearRect(0, 0, _alphaScanCanvas.width, _alphaScanCanvas.height);
      scan.drawImage(image, 0, 0);
      var pixels = scan.getImageData(0, 0, _alphaScanCanvas.width, _alphaScanCanvas.height).data;
      var minX = _alphaScanCanvas.width, minY = _alphaScanCanvas.height, maxX = -1, maxY = -1;
      for (var y = 0; y < _alphaScanCanvas.height; y++) {
        for (var x = 0; x < _alphaScanCanvas.width; x++) {
          if (pixels[(y * _alphaScanCanvas.width + x) * 4 + 3] > 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      var bounds = maxX < minX ? false : Object.freeze({
        x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
      });
      _alphaBounds.set(image, bounds);
      _alphaBoundsCount++;
      return bounds === false ? null : bounds;
    } catch (_) {
      _alphaBounds.set(image, false);
      _alphaBoundsCount++;
      return null;
    }
  }

  var _acceptedManifest = null;
  var _manifestStatus = "unloaded";
  var _manifestPromise = null;
  var _sheetImages = Object.create(null);
  var _sheetPromises = Object.create(null);
  var _failedSheets = Object.create(null);
  var _fallbackSheets = Object.create(null);
  var _activeSheetIds = null;

  function setActiveEncounter(ids) {
    var next = Object.create(null);
    if (Array.isArray(ids)) {
      for (var index = 0; index < ids.length; index++) {
        if (typeof ids[index] === "string" && ids[index]) next[ids[index]] = true;
      }
    }
    _activeSheetIds = next;
    var resident = Object.keys(_sheetImages);
    for (var residentIndex = 0; residentIndex < resident.length; residentIndex++) {
      if (!next[resident[residentIndex]]) delete _sheetImages[resident[residentIndex]];
    }
    _fallbackSheets = Object.create(null);
    return Object.keys(next).length;
  }

  function _basePath(value) {
    if (typeof value !== "string" || !value) return "battlemons/";
    return value.charAt(value.length - 1) === "/" ? value : value + "/";
  }

  function loadManifest(basePath) {
    if (_manifestStatus === "accepted") return Promise.resolve(_acceptedManifest);
    if (_manifestStatus === "rejected") return Promise.resolve(null);
    if (_manifestPromise) return _manifestPromise;
    _manifestStatus = "loading";
    _manifestPromise = new Promise(function(resolve) {
      var settled = false;
      var timeout = setTimeout(function() {
        finish(null, new Error("timeout"));
      }, MANIFEST_TIMEOUT_MS);
      function finish(normalized, error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        _acceptedManifest = normalized;
        _manifestStatus = normalized ? "accepted" : "rejected";
        if (error) console.warn("Battlemon manifest unavailable; using bounded domain fallbacks (" + error.message + ")");
        resolve(normalized);
      }
      fetch(_basePath(basePath) + "manifest.json")
        .then(function(response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(function(manifest) {
          var normalized = normalizeManifest(manifest);
          if (!normalized) throw new Error("schema rejected");
          finish(normalized, null);
        })
        .catch(function(error) { finish(null, error); });
    });
    return _manifestPromise;
  }

  function _requestAcceptedSheet(id, basePath) {
    var entry = _acceptedManifest && _acceptedManifest.get(id);
    if (!entry || _failedSheets[id]) return Promise.resolve(null);
    if (_sheetImages[id]) return Promise.resolve(_sheetImages[id]);
    if (_sheetPromises[id]) return _sheetPromises[id];
    _sheetPromises[id] = new Promise(function(resolve) {
      var image = new Image();
      var settled = false;
      var timeout = setTimeout(function() {
        image.onload = null; image.onerror = null;
        try { if (typeof image.removeAttribute === "function") image.removeAttribute("src"); } catch (_) {}
        finish(null, true);
      }, SHEET_TIMEOUT_MS);
      function finish(value, failed) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        delete _sheetPromises[id];
        if (failed) _failedSheets[id] = true;
        if (value && (_activeSheetIds === null || _activeSheetIds[id])) {
          _sheetImages[id] = value;
          // A fallback may have been painted while this sheet decoded. It is cheap to recreate
          // on a later failure, so do not retain it alongside accepted art.
          delete _fallbackSheets[entry.domain];
        }
        resolve(value);
      }
      image.onload = function() {
        finish(image.naturalWidth === SHEET_WIDTH && image.naturalHeight === SHEET_HEIGHT ? image : null,
          image.naturalWidth !== SHEET_WIDTH || image.naturalHeight !== SHEET_HEIGHT);
      };
      image.onerror = function() { finish(null, true); };
      image.src = _basePath(basePath) + entry.file;
    });
    return _sheetPromises[id];
  }

  function requestSheet(id, basePath) {
    if (typeof id !== "string") return Promise.resolve(null);
    if (_manifestStatus === "accepted") return _requestAcceptedSheet(id, basePath);
    if (_manifestStatus === "rejected") return Promise.resolve(null);
    return loadManifest(basePath).then(function(manifest) {
      return manifest ? _requestAcceptedSheet(id, basePath) : null;
    });
  }

  function _fallbackSheet(domain) {
    var normalized = CANONICAL_NAMES[domain] ? domain : "AGENT";
    if (_fallbackSheets[normalized]) return _fallbackSheets[normalized];
    var canvas = document.createElement("canvas");
    canvas.width = SHEET_WIDTH;
    canvas.height = SHEET_HEIGHT;
    var context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    var colors = { AGENT: "#3b82f6", MCP: "#a855f7", CONFIG: "#22c55e", PROMPT: "#f97316", CONTEXT: "#06b6d4" };
    var color = colors[normalized];
    for (var frame = 0; frame < 6; frame++) {
      var origin = frame * 128;
      var yOffset = frame === 1 ? -2 : frame === 2 ? 6 : frame === 5 ? 18 : 0;
      context.save();
      context.translate(origin, yOffset);
      if (frame === 3) context.translate(-8, 0);
      if (frame === 4) context.translate(7, 0);
      context.fillStyle = color;
      context.strokeStyle = "#111827";
      context.lineWidth = 5;
      context.beginPath();
      if (normalized === "AGENT") {
        context.moveTo(25, 66); context.lineTo(43, 28); context.lineTo(61, 47);
        context.lineTo(91, 42); context.lineTo(108, 65); context.lineTo(88, 95);
        context.lineTo(43, 94); context.closePath();
      } else if (normalized === "MCP") {
        context.rect(31, 35, 62, 62);
      } else if (normalized === "CONFIG") {
        context.ellipse(22, 43, 94, 49, 0, 0, Math.PI * 2);
      } else if (normalized === "PROMPT") {
        context.moveTo(64, 24); context.lineTo(78, 54); context.lineTo(113, 37);
        context.lineTo(94, 74); context.lineTo(109, 96); context.lineTo(66, 83);
        context.lineTo(50, 105); context.lineTo(45, 80); context.lineTo(15, 94);
        context.lineTo(32, 66); context.lineTo(14, 45); context.lineTo(49, 55); context.closePath();
      } else {
        context.moveTo(15, 58); context.lineTo(40, 34); context.lineTo(65, 48);
        context.lineTo(91, 33); context.lineTo(113, 60); context.lineTo(91, 89);
        context.lineTo(69, 80); context.lineTo(62, 108); context.lineTo(52, 80);
        context.lineTo(31, 89); context.closePath();
      }
      context.fill(); context.stroke();
      context.fillStyle = "#f8fafc";
      if (frame === 5) {
        context.fillRect(47, 61, 12, 5); context.fillRect(70, 61, 12, 5);
      } else {
        context.fillRect(48, 58, 8, 10); context.fillRect(72, 58, 8, 10);
      }
      context.restore();
    }
    _fallbackSheets[normalized] = canvas;
    return canvas;
  }

  function drawBattlemonFrame(context, domain, id, frameLabel, dx, dy, dw, dh) {
    var index = FRAME_INDEX[frameLabel];
    if (index === undefined || !context || typeof context.drawImage !== "function") return false;
    var accepted = !!_sheetImages[id];
    var source = _sheetImages[id] || _fallbackSheet(domain);
    context.drawImage(source, index * FRAME_SIZE, 0, FRAME_SIZE, FRAME_SIZE, dx, dy, dw, dh);
    return accepted;
  }

  function getManifestEntry(id) {
    return _acceptedManifest && _acceptedManifest.get(id) || null;
  }

  function getDiagnostics() {
    return Object.freeze({
      manifestStatus: _manifestStatus,
      manifestEntryCount: _acceptedManifest ? _acceptedManifest.size : 0,
      loadedSheetCount: Object.keys(_sheetImages).length,
      inFlightSheetCount: Object.keys(_sheetPromises).length,
      failedSheetCount: Object.keys(_failedSheets).length,
      fallbackDomainCount: Object.keys(_fallbackSheets).length,
      activeSheetCount: _activeSheetIds === null ? 0 : Object.keys(_activeSheetIds).length,
      loadedSheetDecodedBytes: Object.keys(_sheetImages).length * SHEET_WIDTH * SHEET_HEIGHT * 4,
      fallbackDecodedBytes: Object.keys(_fallbackSheets).length * SHEET_WIDTH * SHEET_HEIGHT * 4,
      alphaCacheSize: _alphaBoundsCount,
    });
  }

  window.DatamonBattlePresentation = Object.freeze({
    CANONICAL_DOMAINS: CANONICAL_DOMAINS,
    CANONICAL_NAMES: CANONICAL_NAMES,
    BATTLEMON_FRAMES: BATTLEMON_FRAMES,
    BATTLEMON_SHEET_WIDTH: SHEET_WIDTH,
    BATTLEMON_SHEET_HEIGHT: SHEET_HEIGHT,
    BATTLEMON_FRAME_SIZE: FRAME_SIZE,
    GEOMETRY: GEOMETRY,
    POSE_PARAMS: POSE_PARAMS,
    battlemonId: battlemonId,
    normalizeManifest: normalizeManifest,
    resolveTrainerPose: resolveTrainerPose,
    resolveBattlemonState: resolveBattlemonState,
    computeAlphaBounds: computeAlphaBounds,
    loadManifest: loadManifest,
    setActiveEncounter: setActiveEncounter,
    requestSheet: requestSheet,
    drawBattlemonFrame: drawBattlemonFrame,
    getManifestEntry: getManifestEntry,
    getDiagnostics: getDiagnostics,
  });
})();
