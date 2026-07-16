// ============================================================
// DATAMON World Art — high-detail presentation/cache layer
// Ticket #044: DPR-aware caches, validated additive HD assets,
// bounded ambient loops, reduced motion, and lazy portraits.
// This classic script is presentation-only: it never reads or
// writes saves, battles, quests, HP, or NPC schedules.
// ============================================================
"use strict";

(function () {
  var API = {};
  var KINDS = ["tile", "prop", "overlay", "ambient"];
  var ALPHA_MODES = ["opaque", "binary", "soft"];
  var REVIEW_STATES = ["pending", "reviewed", "accepted"];
  var REQUIRED_FIELDS = [
    "id", "kind", "slug", "file", "widthPx", "heightPx",
    "sourceScale", "sourceWidthPx", "sourceHeightPx", "alphaMode",
    "scene", "fallback", "provenance", "reviewState", "batchId",
  ];

  function nowMs() {
    return typeof performance !== "undefined" && performance && performance.now
      ? performance.now() : 0;
  }

  function positiveInt(value) {
    return Number.isInteger(value) && value > 0;
  }

  function nonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function safeRelativeFile(value) {
    if (!nonEmptyString(value) || value.indexOf("\\") !== -1 || value.charAt(0) === "/") return false;
    var parts = value.split("/");
    return parts.every(function (part) { return part && part !== "." && part !== ".."; });
  }

  // Exact visual-detail scale. Logical gameplay remains 32 px per tile; only backing
  // caches and source rectangles use this value. Fractional DPR is intentionally kept.
  API.detailScale = function (dpr) {
    var n = Number(dpr);
    if (!isFinite(n) || n < 1) return 1;
    return Math.min(2, n);
  };

  API.cacheMetrics = function (mapW, mapH, tile, detailScale, cacheCount) {
    var scale = API.detailScale(detailScale);
    var mapWidth = Math.max(1, Math.round(Number(mapW) * Number(tile) * scale));
    var mapHeight = Math.max(1, Math.round(Number(mapH) * Number(tile) * scale));
    var mapPixels = mapWidth * mapHeight;
    var singleCacheBytes = mapPixels * 4;
    var count = positiveInt(cacheCount) ? cacheCount : 1;
    var totalBytes = singleCacheBytes * count;
    return {
      mapWidth: mapWidth,
      mapHeight: mapHeight,
      mapPixels: mapPixels,
      singleCacheBytes: singleCacheBytes,
      totalBytes: totalBytes,
      totalMiB: totalBytes / (1024 * 1024),
    };
  };

  // Preserve the legacy logical rounding first, then address the physical cache.
  API.cameraSourceRect = function (camX, camY, tile, viewW, viewH, cacheScale) {
    var scale = Number(cacheScale) || 1;
    var logicalSx = -Math.round(-Number(camX) * Number(tile));
    var logicalSy = -Math.round(-Number(camY) * Number(tile));
    return {
      sx: logicalSx * scale,
      sy: logicalSy * scale,
      sw: Number(viewW) * scale,
      sh: Number(viewH) * scale,
    };
  };

  API.expectedSourceSize = function (entry) {
    var frames = entry && entry.animation && entry.animation.layout === "horizontal"
      ? entry.animation.frames : 1;
    return {
      w: Number(entry && entry.sourceWidthPx) * frames,
      h: Number(entry && entry.sourceHeightPx),
    };
  };

  // Validate the additive manifest as one atomic unit. sourceWidthPx/sourceHeightPx
  // always describe one frame and must exactly equal logical dimensions × sourceScale.
  API.normalizeManifest = function (entries) {
    if (!Array.isArray(entries)) return [];
    var ids = Object.create(null);
    var files = Object.create(null);
    var normalized = [];

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || typeof e !== "object" || Array.isArray(e)) return [];
      for (var r = 0; r < REQUIRED_FIELDS.length; r++) {
        if (!Object.prototype.hasOwnProperty.call(e, REQUIRED_FIELDS[r])) return [];
      }
      if (!nonEmptyString(e.id) || ids[e.id]) return [];
      ids[e.id] = true;
      if (KINDS.indexOf(e.kind) === -1) return [];
      if (!nonEmptyString(e.slug) || !safeRelativeFile(e.file) || files[e.file]) return [];
      files[e.file] = true;
      if (!positiveInt(e.widthPx) || !positiveInt(e.heightPx)) return [];
      if (e.sourceScale !== 1 && e.sourceScale !== 2) return [];
      if (!positiveInt(e.sourceWidthPx) || !positiveInt(e.sourceHeightPx)) return [];
      if (e.sourceWidthPx !== e.widthPx * e.sourceScale) return [];
      if (e.sourceHeightPx !== e.heightPx * e.sourceScale) return [];
      if (ALPHA_MODES.indexOf(e.alphaMode) === -1) return [];
      if (!nonEmptyString(e.scene) || !nonEmptyString(e.fallback)) return [];
      if (!nonEmptyString(e.provenance) || /(?:headshots?|\.environment-work|\/raw\/)/i.test(e.provenance)) return [];
      if (REVIEW_STATES.indexOf(e.reviewState) === -1 || !nonEmptyString(e.batchId)) return [];

      if (e.kind === "prop") {
        if (!positiveInt(e.tileW) || !positiveInt(e.tileH)) return [];
        if (!Number.isInteger(e.anchorX) || !Number.isInteger(e.anchorY)) return [];
      }

      if (e.animation !== undefined) {
        var a = e.animation;
        if (e.kind !== "ambient" || !a || typeof a !== "object") return [];
        if (!positiveInt(a.frames) || a.frames < 2) return [];
        if (!positiveInt(a.fps) || a.fps > 12 || a.layout !== "horizontal") return [];
      } else if (e.kind === "ambient") {
        return [];
      }

      if (e.placement !== undefined) {
        if (!e.placement || typeof e.placement !== "object") return [];
        if (!Number.isInteger(e.placement.col) || !Number.isInteger(e.placement.row)) return [];
      }
      if (e.id === "hd-collaboration-table") {
        if (e.collision !== "none" || !e.placement || e.placement.col !== 1 || e.placement.row !== 5) return [];
      }
      normalized.push(Object.assign({}, e));
    }
    return normalized;
  };

  // A true nearest-neighbour 2× fake has identical RGBA values throughout every
  // sourceScale×sourceScale block. Animation frames are checked independently.
  API.isTrivialNearestUpscale = function (entry, pixels, actualWidth, actualHeight) {
    if (!entry || entry.sourceScale <= 1) return false;
    var scale = entry.sourceScale;
    var frames = entry.animation ? entry.animation.frames : 1;
    var frameWidth = entry.sourceWidthPx;
    if (!pixels || pixels.length !== actualWidth * actualHeight * 4) return true;

    for (var frame = 0; frame < frames; frame++) {
      var frameX = frame * frameWidth;
      for (var ly = 0; ly < entry.heightPx; ly++) {
        for (var lx = 0; lx < entry.widthPx; lx++) {
          var baseX = frameX + lx * scale;
          var baseY = ly * scale;
          var base = (baseY * actualWidth + baseX) * 4;
          for (var oy = 0; oy < scale; oy++) {
            for (var ox = 0; ox < scale; ox++) {
              var at = ((baseY + oy) * actualWidth + baseX + ox) * 4;
              for (var channel = 0; channel < 4; channel++) {
                if (pixels[at + channel] !== pixels[base + channel]) return false;
              }
            }
          }
        }
      }
    }
    return true;
  };

  API.validatePixels = function (entry, pixels, actualWidth, actualHeight) {
    var expected = API.expectedSourceSize(entry || {});
    if (actualWidth !== expected.w || actualHeight !== expected.h) {
      return { valid: false, reason: "decoded dimension mismatch" };
    }
    if (!pixels || pixels.length !== actualWidth * actualHeight * 4) {
      return { valid: false, reason: "missing decoded RGBA pixels" };
    }

    var sawTransparent = false;
    var sawOpaque = false;
    var sawSoft = false;
    for (var i = 3; i < pixels.length; i += 4) {
      var alpha = pixels[i];
      if (alpha === 0) sawTransparent = true;
      else if (alpha === 255) sawOpaque = true;
      else sawSoft = true;
      if (entry.alphaMode === "opaque" && alpha !== 255) {
        return { valid: false, reason: "opaque asset contains transparency" };
      }
      if (entry.alphaMode === "binary" && alpha !== 0 && alpha !== 255) {
        return { valid: false, reason: "binary asset contains soft alpha" };
      }
    }
    if (entry.alphaMode === "binary" && (!sawTransparent || !sawOpaque)) {
      return { valid: false, reason: "binary cutout must use transparent and opaque pixels" };
    }
    if (entry.alphaMode === "soft" && !sawSoft) {
      return { valid: false, reason: "soft-alpha asset has no intermediate alpha" };
    }
    if (API.isTrivialNearestUpscale(entry, pixels, actualWidth, actualHeight)) {
      return { valid: false, reason: "trivial nearest-neighbour upscale" };
    }
    return { valid: true, reason: "" };
  };

  API.animationFrame = function (elapsedMs, fps, frameCount, reduced) {
    if (reduced || !positiveInt(frameCount)) return 0;
    var rate = positiveInt(fps) ? Math.min(12, fps) : 1;
    var elapsed = Math.max(0, Number(elapsedMs) || 0);
    return Math.floor(elapsed / (1000 / rate)) % frameCount;
  };

  // Smooth, deterministic phase for the seven procedural living-world loops. These
  // loops allocate no particles/assets and pin to phase zero under reduced motion.
  API.ambientPhase = function (elapsedMs, periodMs, reduced) {
    if (reduced) return 0;
    var period = Math.max(250, Number(periodMs) || 1000);
    var elapsed = Math.max(0, Number(elapsedMs) || 0);
    return (elapsed % period) / period;
  };

  // ---- Runtime state ----------------------------------------------------
  var initialized = false;
  var detailScaleActive = 1;
  var reducedMotion = false;
  var motionQuery = null;
  var ambientStartMs = 0;
  var hdManifest = null;
  var hdManifestLoaded = false;
  var hdManifestPromise = null;
  var hdStore = Object.create(null);       // entry id -> decoded image
  var hdBySlug = Object.create(null);      // kind:slug -> entry id
  var hdLoads = Object.create(null);       // entry id -> Promise
  var sceneLoads = Object.create(null);    // scene -> Promise
  var activeAmbientEntries = [];
  var visualDetailPlacements = [];
  var diagFrameSamples = [];
  var diagAmbientInstances = 0;
  var diagRejectedAssets = [];
  var PROCEDURAL_AMBIENT_COUNTS = Object.freeze({ office: 5, library: 2 });

  function setReducedMotion(matches) {
    reducedMotion = !!matches;
    // A live media-query transition starts at frame zero. While reduced, frame selection
    // remains pinned there; when motion resumes the loop starts again from frame zero.
    ambientStartMs = nowMs();
  }

  API.init = function () {
    detailScaleActive = API.detailScale(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    if (initialized) return;
    initialized = true;
    if (typeof window !== "undefined" && window.matchMedia) {
      try {
        motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        setReducedMotion(motionQuery.matches);
        var listener = function (event) { setReducedMotion(event.matches); };
        if (motionQuery.addEventListener) motionQuery.addEventListener("change", listener);
        else if (motionQuery.addListener) motionQuery.addListener(listener);
      } catch (_) {
        setReducedMotion(false);
      }
    } else {
      setReducedMotion(false);
    }
  };

  API.loadManifest = function () {
    if (hdManifestPromise) return hdManifestPromise;
    hdManifestPromise = fetch("environment/manifest.json")
      .then(function (response) { return response.ok ? response.json() : []; })
      .then(function (entries) {
        hdManifest = API.normalizeManifest(entries);
        hdManifestLoaded = true;
        return hdManifest.slice();
      })
      .catch(function () {
        hdManifest = [];
        hdManifestLoaded = true;
        return [];
      });
    return hdManifestPromise;
  };

  API.entriesForScene = function (scene, includePending) {
    if (!hdManifest) return [];
    return hdManifest.filter(function (entry) {
      var sceneMatch = entry.scene === scene || entry.scene === "shared";
      var reviewMatch = includePending || entry.reviewState === "accepted";
      return sceneMatch && reviewMatch;
    });
  };

  function decodedPixels(img, expected) {
    if (typeof document === "undefined" || !document.createElement) return null;
    var canvas = document.createElement("canvas");
    canvas.width = expected.w;
    canvas.height = expected.h;
    var context = canvas.getContext && canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !context.drawImage || !context.getImageData) return null;
    context.clearRect(0, 0, expected.w, expected.h);
    context.drawImage(img, 0, 0);
    return context.getImageData(0, 0, expected.w, expected.h).data;
  }

  API.loadHDImage = function (entry) {
    if (!entry || entry.reviewState !== "accepted" || !safeRelativeFile(entry.file)) return Promise.resolve(null);
    if (Object.prototype.hasOwnProperty.call(hdStore, entry.id)) return Promise.resolve(hdStore[entry.id]);
    if (hdLoads[entry.id]) return hdLoads[entry.id];

    hdLoads[entry.id] = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var expected = API.expectedSourceSize(entry);
        if (img.naturalWidth !== expected.w && img.width !== expected.w) {
          diagRejectedAssets.push(entry.id + ":dimensions");
          hdStore[entry.id] = null;
          resolve(null);
          return;
        }
        if (img.naturalHeight !== expected.h && img.height !== expected.h) {
          diagRejectedAssets.push(entry.id + ":dimensions");
          hdStore[entry.id] = null;
          resolve(null);
          return;
        }
        try {
          var pixels = decodedPixels(img, expected);
          if (pixels) {
            var validation = API.validatePixels(entry, pixels, expected.w, expected.h);
            if (!validation.valid) {
              diagRejectedAssets.push(entry.id + ":" + validation.reason);
              hdStore[entry.id] = null;
              resolve(null);
              return;
            }
          }
        } catch (_) {
          // A same-origin runtime asset should always be readable. Reject rather than use
          // an image whose alpha/detail contract could not be verified.
          diagRejectedAssets.push(entry.id + ":decode");
          hdStore[entry.id] = null;
          resolve(null);
          return;
        }
        hdStore[entry.id] = img;
        hdBySlug[entry.kind + ":" + entry.slug] = entry.id;
        resolve(img);
      };
      img.onerror = function () {
        hdStore[entry.id] = null;
        resolve(null);
      };
      img.src = "environment/accepted/" + encodeURIComponent(entry.batchId) + "/" + entry.file;
    });
    return hdLoads[entry.id];
  };

  API.loadScene = function (scene) {
    if (sceneLoads[scene]) return sceneLoads[scene];
    sceneLoads[scene] = API.loadManifest().then(function () {
      // A sourceScale-2 tier is only safe at DPR2. Fractional caches still retain
      // procedural detail while legacy 1× art remains the fallback.
      var entries = API.entriesForScene(scene, false).filter(function (entry) {
        return entry.sourceScale <= detailScaleActive;
      });
      return Promise.all(entries.map(API.loadHDImage)).then(function () {
        API.activateScene(scene);
        return entries;
      });
    }).catch(function () { return []; });
    return sceneLoads[scene];
  };

  API.findEntry = function (slug, kind, scene) {
    if (!hdManifest) return null;
    for (var i = 0; i < hdManifest.length; i++) {
      var entry = hdManifest[i];
      if (entry.reviewState !== "accepted" || entry.slug !== slug) continue;
      if (kind && entry.kind !== kind) continue;
      if (scene && entry.scene !== scene && entry.scene !== "shared") continue;
      return entry;
    }
    return null;
  };

  API.getHDImage = function (slug, kind) {
    var id = hdBySlug[(kind || "tile") + ":" + slug];
    if (!id && !kind) {
      for (var i = 0; i < KINDS.length; i++) {
        id = hdBySlug[KINDS[i] + ":" + slug];
        if (id) break;
      }
    }
    return id ? hdStore[id] || null : null;
  };

  API.getHDAsset = function (slug, kind, scene) {
    var entry = API.findEntry(slug, kind, scene);
    return entry && hdStore[entry.id] ? { entry: entry, image: hdStore[entry.id] } : null;
  };

  function entryPlacements(entry) {
    if (Array.isArray(entry.placements)) return entry.placements;
    return entry.placement ? [entry.placement] : [];
  }

  API.activateScene = function (scene) {
    var entries = API.entriesForScene(scene, false);
    activeAmbientEntries = entries.filter(function (entry) {
      return entry.kind === "ambient" && !!hdStore[entry.id];
    }).slice(0, 64);
    visualDetailPlacements = [];
    entries.forEach(function (entry) {
      if (entry.kind !== "prop" || entry.collision !== "none" || !hdStore[entry.id]) return;
      entryPlacements(entry).forEach(function (placement) {
        visualDetailPlacements.push({ entry: entry, image: hdStore[entry.id], placement: placement });
      });
    });
    diagAmbientInstances = activeAmbientEntries.reduce(function (count, entry) {
      return count + Math.max(1, entryPlacements(entry).length);
    }, PROCEDURAL_AMBIENT_COUNTS[scene] || 0);
    if (diagAmbientInstances > 64) diagAmbientInstances = 64;
    ambientStartMs = nowMs();
  };

  API.getAmbientFrame = function (entryId) {
    var entry = activeAmbientEntries.find(function (item) { return item.id === entryId; });
    if (!entry || !entry.animation) return 0;
    return API.animationFrame(nowMs() - ambientStartMs, entry.animation.fps,
      entry.animation.frames, reducedMotion);
  };

  API.getAmbientPhase = function (periodMs) {
    return API.ambientPhase(nowMs() - ambientStartMs, periodMs, reducedMotion);
  };

  function drawAmbientPlacement(context, entry, image, placement, camX, camY, tile) {
    var frame = API.getAmbientFrame(entry.id);
    var dx = (placement.col - camX) * tile + (placement.anchorX || 0);
    var dy = (placement.row - camY) * tile + (placement.anchorY || 0);
    context.drawImage(image,
      frame * entry.sourceWidthPx, 0, entry.sourceWidthPx, entry.sourceHeightPx,
      dx, dy, entry.widthPx, entry.heightPx);
  }

  API.drawAmbient = function (context, scene, camX, camY, tile, layer) {
    if (!context) return;
    var wantedLayer = layer || "back";
    activeAmbientEntries.forEach(function (entry) {
      if (entry.scene !== scene && entry.scene !== "shared") return;
      entryPlacements(entry).forEach(function (placement) {
        if ((placement.layer || "back") !== wantedLayer) return;
        drawAmbientPlacement(context, entry, hdStore[entry.id], placement, camX, camY, tile);
      });
    });
  };

  API.drawAmbientEntry = function (context, entryId, camX, camY, tile) {
    var entry = activeAmbientEntries.find(function (item) { return item.id === entryId; });
    if (!entry || !hdStore[entry.id]) return;
    entryPlacements(entry).forEach(function (placement) {
      drawAmbientPlacement(context, entry, hdStore[entry.id], placement, camX, camY, tile);
    });
  };

  API.getVisualDetailPlacements = function (scene) {
    return visualDetailPlacements.filter(function (item) {
      return !scene || item.entry.scene === scene || item.entry.scene === "shared";
    }).slice();
  };

  // Compatibility setters are bounded and do not create particles.
  API.setAmbientEntries = function (entries) {
    activeAmbientEntries = Array.isArray(entries) ? entries.slice(0, 64) : [];
    diagAmbientInstances = activeAmbientEntries.length;
    ambientStartMs = nowMs();
  };

  API.setVisualDetailPlacements = function (placements) {
    visualDetailPlacements = Array.isArray(placements) ? placements.slice(0, 64) : [];
  };

  API.recordFrameSample = function (durationMs) {
    var value = Number(durationMs);
    if (!isFinite(value) || value < 0) return;
    diagFrameSamples.push(value);
    if (diagFrameSamples.length > 120) diagFrameSamples.shift();
  };

  API.getDiagnostics = function () {
    var sorted = diagFrameSamples.slice().sort(function (a, b) { return a - b; });
    var length = sorted.length;
    return {
      samples: length,
      median: length ? sorted[Math.floor(length / 2)] : 0,
      p95: length ? sorted[Math.min(length - 1, Math.ceil(length * 0.95) - 1)] : 0,
      max: length ? sorted[length - 1] : 0,
      ambientInstances: diagAmbientInstances,
      particles: 0,
      detailScale: detailScaleActive,
      reducedMotion: reducedMotion,
      manifestLoaded: hdManifestLoaded,
      loadedAssetIds: Object.keys(hdStore).filter(function (id) { return !!hdStore[id]; }),
      rejectedAssets: diagRejectedAssets.slice(-20),
    };
  };

  API.isManifestLoaded = function () { return hdManifestLoaded; };
  API.getDetailScale = function () { return detailScaleActive; };
  API.isReducedMotion = function () { return reducedMotion; };

  // ---- Lazy portraits ---------------------------------------------------
  var portraitLoads = Object.create(null);
  var portraitStore = Object.create(null);
  var portraitListeners = [];

  API.onPortraitLoaded = function (listener) {
    if (typeof listener === "function") portraitListeners.push(listener);
  };

  API.loadPortrait = function (slug) {
    if (!/^[a-z0-9-]+$/.test(slug || "")) return Promise.resolve(null);
    if (Object.prototype.hasOwnProperty.call(portraitStore, slug)) return Promise.resolve(portraitStore[slug]);
    if (portraitLoads[slug]) return portraitLoads[slug];
    portraitLoads[slug] = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        portraitStore[slug] = img;
        portraitListeners.forEach(function (listener) {
          try { listener(slug, img); } catch (_) { /* presentation callback only */ }
        });
        resolve(img);
      };
      img.onerror = function () {
        portraitStore[slug] = null;
        resolve(null);
      };
      img.src = "portraits/" + slug + ".png";
    });
    return portraitLoads[slug];
  };

  API.hasPortrait = function (slug) { return !!portraitStore[slug]; };
  API.isPortraitSettled = function (slug) {
    return Object.prototype.hasOwnProperty.call(portraitStore, slug);
  };
  API.getPortrait = function (slug) { return portraitStore[slug] || null; };
  API.HEADSHOT_BLOCKED = true;

  window.DatamonWorldArt = API;
})();
