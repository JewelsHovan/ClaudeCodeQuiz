// DATAMON authored classic-domain arena contract.
// Strict manifest validation plus one-resident, encounter-lazy, fail-closed background loading.
"use strict";

(function () {
  var DOMAINS = Object.freeze(["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT"]);
  var WIDTH = 1600, HEIGHT = 864, TIMEOUT_MS = 5000;
  var BATCH = "classic-domain-arenas-v1";
  var MODEL = "openai/gpt-5.4-image-2";
  var PROVENANCE = "openrouter:openai/gpt-5.4-image-2+deterministic-pillow-arena-v1";
  var ACCEPTED_BATCH_SHA = "e5115a1545f9554bc0465c167da8d0c02f46787ff09cc97652bdef3519a05837";
  var ACCEPTED_COLOR_REVIEW_SHA = "d0ae7e26a4408e97c1419f7214e4bae1fb84616cecc64b50c64a0729c6706aee";
  var ACCEPTED_GRAYSCALE_REVIEW_SHA = "81b5fc61d8f2dd8571f3e5a877c7b9ed2d6bf108ca24030149bb14e5cada670a";
  var ACCEPTED_RECEIPTS = Object.freeze({
    AGENT: Object.freeze({ promptVersion: 2, costUsd: 0.178344, promptSha256: "3483ddaeabd106962831e3bf0798db9507a2ab1b1c5ec734b83f0731eb0b8b72", referenceSha256: "5f3bd5d12429d0844690adec6553973be8125b8600666df679d36c7819d0fd16", rawSha256: "c2c5d41d451a4fc670f481eb7bc13c030f368a7256f19ce033ae103b6afc1a16", sha256: "4ee9fecdad95275f848c78f772118f68fb567114c5fbec3d41493526a6857002" }),
    MCP: Object.freeze({ promptVersion: 1, costUsd: 0.180256, promptSha256: "e9111f2fe56a68b35ab392cf50f4aecb5cc3c003a0c386b06998a7b9df5be3d3", referenceSha256: "1012e391f2d42ef1dd160427cd62f12964b6d7a6747f2e57679abce2f00cf8d6", rawSha256: "5f3bd5d12429d0844690adec6553973be8125b8600666df679d36c7819d0fd16", sha256: "4456b708ddc1ec09eb25b6a6e4334721db6380233ef9315ad703557ad7292434" }),
    CONFIG: Object.freeze({ promptVersion: 2, costUsd: 0.17836, promptSha256: "60027a7f5a9a46c60680a6cf70e914b08b99e8eb41a4a2c63b26838591f1fa19", referenceSha256: "5f3bd5d12429d0844690adec6553973be8125b8600666df679d36c7819d0fd16", rawSha256: "0753f68c501d7470302ffbd03a2b32c94c79450e1b3e42e68734ef7d8c00668e", sha256: "cdff01a5f03d30113b49ffec90158bff4a750ad7fde34e3b65025ed7db13046a" }),
    PROMPT: Object.freeze({ promptVersion: 2, costUsd: 0.178376, promptSha256: "ab5e074a799d1a0d1640e1dc8c7d6f2db2b15fb19ec8ed2fcc4e29b10aa17beb", referenceSha256: "5f3bd5d12429d0844690adec6553973be8125b8600666df679d36c7819d0fd16", rawSha256: "991448508c5a795f409cb62f64b1912edc5c919e809d59d6ea2fc235b6d1413b", sha256: "399dcd1e2ad5d6b87519a0540261b4c88ebbede53e35753047a8fa740fa7d105" }),
    CONTEXT: Object.freeze({ promptVersion: 2, costUsd: 0.178368, promptSha256: "ebe83fb0ad0bba1cccf048c14be549cce4160a96cc8bebb6b1f58d9c4daf68d5", referenceSha256: "5f3bd5d12429d0844690adec6553973be8125b8600666df679d36c7819d0fd16", rawSha256: "d63b16e7fc514e5df37600db6f86bfd988e7609ac9a018f9d46055f80f1cb6a5", sha256: "d28bc538462f230854e76626880306deedc09f8628212ae3f142645d9de4d0f9" }),
  });
  var ROOT_KEYS = Object.freeze([
    "assetCount", "authorizationCapUsd", "authorizationSpendUsd", "batch", "batchSha256", "domains",
    "entries", "format", "generationCostUsd", "height", "model", "paletteMax", "priorArtSpendUsd",
    "provenance", "provider", "review", "reviewState", "schemaVersion", "width",
  ]);
  var ENTRY_KEYS = Object.freeze([
    "costUsd", "domain", "file", "height", "id", "promptSha256", "promptVersion", "rawSha256",
    "referenceSha256", "sha256", "width",
  ]);

  function exactKeys(value, expected) {
    return value && typeof value === "object" && !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
  }
  function safeFile(value, expected) { return value === expected && /^[a-z]+\.png$/.test(value); }
  function exactArray(value, expected) {
    return Array.isArray(value) && value.length === expected.length && value.every(function(item, i) { return item === expected[i]; });
  }
  function normalizeManifest(manifest) {
    if (!exactKeys(manifest, ROOT_KEYS) || manifest.schemaVersion !== 1 || manifest.batch !== BATCH ||
        manifest.reviewState !== "accepted" || manifest.provider !== "openrouter" || manifest.model !== MODEL ||
        manifest.provenance !== PROVENANCE || manifest.width !== WIDTH || manifest.height !== HEIGHT ||
        manifest.format !== "RGB" || manifest.paletteMax !== 256 || manifest.assetCount !== 5 ||
        manifest.authorizationCapUsd !== 50 || manifest.priorArtSpendUsd !== 5.917484 ||
        manifest.generationCostUsd !== 0.893704 || manifest.authorizationSpendUsd !== 6.811188 ||
        !exactArray(manifest.domains, DOMAINS) || manifest.batchSha256 !== ACCEPTED_BATCH_SHA ||
        !exactKeys(manifest.review, ["contactSheetSha256", "grayscaleContactSheetSha256", "reviewed"]) ||
        manifest.review.reviewed !== true || manifest.review.contactSheetSha256 !== ACCEPTED_COLOR_REVIEW_SHA ||
        manifest.review.grayscaleContactSheetSha256 !== ACCEPTED_GRAYSCALE_REVIEW_SHA ||
        !Array.isArray(manifest.entries) || manifest.entries.length !== 5) return null;
    var accepted = new Map();
    for (var i = 0; i < DOMAINS.length; i++) {
      var domain = DOMAINS[i], id = domain.toLowerCase(), entry = manifest.entries[i], receipt = ACCEPTED_RECEIPTS[domain];
      if (!exactKeys(entry, ENTRY_KEYS) || entry.id !== id || entry.domain !== domain ||
          !safeFile(entry.file, id + ".png") || entry.width !== WIDTH || entry.height !== HEIGHT ||
          !receipt || entry.promptVersion !== receipt.promptVersion || entry.costUsd !== receipt.costUsd ||
          entry.promptSha256 !== receipt.promptSha256 || entry.referenceSha256 !== receipt.referenceSha256 ||
          entry.rawSha256 !== receipt.rawSha256 || entry.sha256 !== receipt.sha256) return null;
      accepted.set(domain, Object.freeze({
        id: id, domain: domain, file: id + ".png", width: WIDTH, height: HEIGHT,
        promptVersion: entry.promptVersion, promptSha256: entry.promptSha256,
        referenceSha256: entry.referenceSha256, rawSha256: entry.rawSha256,
        costUsd: entry.costUsd, sha256: entry.sha256,
      }));
    }
    return accepted.size === 5 ? accepted : null;
  }

  var manifest = null, manifestStatus = "unloaded", manifestPromise = null;
  var activeDomain = null, activeImage = null, inFlight = null;
  var failed = Object.create(null), fallbackCanvas = null, fallbackDomain = null;

  function basePath(value) {
    if (typeof value !== "string" || !value) return "battle-arenas/";
    return value.charAt(value.length - 1) === "/" ? value : value + "/";
  }
  function loadManifest(path) {
    if (manifestStatus === "accepted") return Promise.resolve(manifest);
    if (manifestStatus === "rejected") return Promise.resolve(null);
    if (manifestPromise) return manifestPromise;
    manifestStatus = "loading";
    manifestPromise = new Promise(function(resolve) {
      var settled = false;
      var timer = setTimeout(function() { finish(null, new Error("timeout")); }, TIMEOUT_MS);
      function finish(value, error) {
        if (settled) return;
        settled = true; clearTimeout(timer); manifest = value; manifestStatus = value ? "accepted" : "rejected";
        if (error) console.warn("Battle arena manifest unavailable; using procedural command deck (" + error.message + ")");
        resolve(value);
      }
      fetch(basePath(path) + "manifest.json")
        .then(function(response) { if (!response.ok) throw new Error("HTTP " + response.status); return response.json(); })
        .then(function(value) { var normalized = normalizeManifest(value); if (!normalized) throw new Error("schema rejected"); finish(normalized, null); })
        .catch(function(error) { finish(null, error); });
    });
    return manifestPromise;
  }

  function cancelInFlight() {
    if (!inFlight) return;
    var request = inFlight; inFlight = null;
    request.image.onload = null; request.image.onerror = null;
    try { if (typeof request.image.removeAttribute === "function") request.image.removeAttribute("src"); } catch (_) {}
    clearTimeout(request.timer); request.resolve(null);
  }
  function requestAccepted(domain, path) {
    var entry = manifest && manifest.get(domain);
    if (!entry || failed[domain]) return Promise.resolve(null);
    if (activeDomain === domain && activeImage) return Promise.resolve(activeImage);
    if (inFlight && inFlight.domain === domain) return inFlight.promise;
    if (inFlight) cancelInFlight();
    var image = new Image(), resolver;
    var promise = new Promise(function(resolve) { resolver = resolve; });
    var request = { domain: domain, image: image, promise: promise, resolve: resolver, timer: null, settled: false };
    inFlight = request;
    function finish(value, didFail) {
      if (request.settled) return;
      request.settled = true; clearTimeout(request.timer);
      if (inFlight === request) inFlight = null;
      if (didFail) failed[domain] = true;
      if (value) { activeDomain = domain; activeImage = value; }
      request.resolve(value);
    }
    request.timer = setTimeout(function() {
      image.onload = null; image.onerror = null;
      try { if (typeof image.removeAttribute === "function") image.removeAttribute("src"); } catch (_) {}
      finish(null, true);
    }, TIMEOUT_MS);
    image.onload = function() {
      var valid = image.naturalWidth === WIDTH && image.naturalHeight === HEIGHT;
      finish(valid ? image : null, !valid);
    };
    image.onerror = function() { finish(null, true); };
    image.src = basePath(path) + entry.file;
    return promise;
  }
  function requestArena(domain, path) {
    if (DOMAINS.indexOf(domain) < 0) return Promise.resolve(null);
    if (manifestStatus === "accepted") return requestAccepted(domain, path);
    if (manifestStatus === "rejected") return Promise.resolve(null);
    return loadManifest(path).then(function(value) { return value ? requestAccepted(domain, path) : null; });
  }

  function fallback(domain) {
    var normalized = DOMAINS.indexOf(domain) >= 0 ? domain : "MCP";
    if (fallbackCanvas && fallbackDomain === normalized) return fallbackCanvas;
    var canvas = document.createElement("canvas"); canvas.width = 800; canvas.height = 432;
    var c = canvas.getContext("2d"), colors = {
      AGENT: ["#08182a", "#2596e8"], MCP: ["#111226", "#a855f7"], CONFIG: ["#101b16", "#34b56d"],
      PROMPT: ["#24140f", "#f17345"], CONTEXT: ["#091a25", "#35b8d6"],
    }, palette = colors[normalized];
    c.fillStyle = palette[0]; c.fillRect(0, 0, 800, 432);
    c.fillStyle = "#162338"; c.fillRect(0, 0, 800, 152);
    c.fillStyle = "#0b1322"; c.fillRect(0, 152, 800, 280);
    c.strokeStyle = "rgba(156,177,207,0.22)"; c.lineWidth = 2;
    for (var x = 40; x < 800; x += 78) { c.strokeRect(x, 28, 58, 78); c.fillStyle = x % 156 ? "#1c2d43" : palette[1]; c.fillRect(x + 8, 40, 42, 4); }
    c.strokeStyle = palette[1]; c.lineWidth = 4;
    c.beginPath(); c.moveTo(130, 390); c.lineTo(500, 255); c.lineTo(668, 198); c.stroke();
    c.fillStyle = "#172234"; c.strokeStyle = palette[1]; c.lineWidth = 3;
    function deck(points) {
      c.beginPath(); c.moveTo(points[0][0], points[0][1]);
      for (var point = 1; point < points.length; point++) c.lineTo(points[point][0], points[point][1]);
      c.closePath(); c.fill(); c.stroke();
    }
    deck([[48,382],[100,350],[222,350],[272,382],[218,422],[98,422]]);
    deck([[576,194],[616,174],[702,174],[738,194],[696,222],[614,222]]);
    deck([[412,266],[458,234],[548,234],[592,266],[548,302],[456,302]]);
    fallbackCanvas = canvas; fallbackDomain = normalized; return canvas;
  }
  function drawArena(context, domain, dx, dy, dw, dh) {
    if (!context || typeof context.drawImage !== "function") return false;
    var accepted = activeDomain === domain && !!activeImage;
    var source = accepted ? activeImage : fallback(domain);
    context.drawImage(source, 0, 0, source.width || WIDTH, source.height || HEIGHT, dx, dy, dw, dh);
    return accepted;
  }
  function getManifestEntry(domain) { return manifest && manifest.get(domain) || null; }
  function diagnostics() {
    return Object.freeze({
      manifestStatus: manifestStatus, manifestEntryCount: manifest ? manifest.size : 0,
      activeDomain: activeDomain, residentArenaCount: activeImage ? 1 : 0,
      inFlightArenaCount: inFlight ? 1 : 0, failedArenaCount: Object.keys(failed).length,
      fallbackDomain: fallbackDomain, residentDecodedBytes: activeImage ? WIDTH * HEIGHT * 4 : 0,
      fallbackDecodedBytes: fallbackCanvas ? 800 * 432 * 4 : 0,
    });
  }

  window.DatamonBattleArena = Object.freeze({
    DOMAINS: DOMAINS, WIDTH: WIDTH, HEIGHT: HEIGHT,
    normalizeManifest: normalizeManifest, loadManifest: loadManifest, requestArena: requestArena,
    drawArena: drawArena, getManifestEntry: getManifestEntry, getDiagnostics: diagnostics,
  });
})();
