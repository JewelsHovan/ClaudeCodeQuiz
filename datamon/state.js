// ============================================================
// DATAMON save-state v2 — pure normalisation, migration,
// telemetry aliasing, backup & write-protection helpers.
// Classic script (no ESM). Exposes window.DatamonState.
// Load BEFORE questions.js/game.js. Executable under Node VM.
// ============================================================

"use strict";

(function () {
  var SAVE_KEY = "datamon-save-v1";
  var BACKUP_KEY = "datamon-save-v1-backup";
  var CURRENT_SCHEMA = 2;

  // Configuration set by the game after question bank & roster load.
  var _roster = [];
  var _idMap = null; // "CAT:index" -> canonical ID, e.g. "AGENT:0" -> "agent-001"
  var _reverseIdMap = null; // canonical ID -> "CAT:index"
  var VALID_DOMAINS = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT", "MIX"];
  var BATTLE_ROOM_DEFAULTS = Object.freeze({ currentStreak: 0, bestStreak: 0, wins: 0 });

  function configure(opts) {
    if (opts.roster) _roster = opts.roster.slice();
    if (opts.idMap) {
      _idMap = {};
      _reverseIdMap = {};
      for (var key in opts.idMap) {
        if (Object.prototype.hasOwnProperty.call(opts.idMap, key)) {
          _idMap[key] = opts.idMap[key];
          _reverseIdMap[opts.idMap[key]] = key;
        }
      }
    }
  }

  function roster() { return _roster; }
  function idMap() { return _idMap; }

  function legacyToCanonical(legacyKey) {
    return (_idMap && _idMap[legacyKey]) || null;
  }

  function canonicalToLegacy(canonId) {
    return (_reverseIdMap && _reverseIdMap[canonId]) || null;
  }

  // ---- safe deep clone (JSON round-trip) ----
  function safeClone(obj) {
    if (obj === null || obj === undefined) return obj;
    try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return null; }
  }

  // ---- defaults ----
  function defaults() {
    return {
      schemaVersion: CURRENT_SCHEMA,
      player: null,
      defeated: [],
      questionStats: {},
      seenCounter: 0,
      coffeeUses: 3,
      difficulty: "normal",
      libraryProgress: {},
      minigameScores: {},
      progression: {
        badges: [],
        quests: {},
        activities: {
          battleRoom: { currentStreak: 0, bestStreak: 0, wins: 0 }
        },
        npcDomains: {}
      }
    };
  }

  // ---- stat normalisation ----
  function normaliseStatEntry(val) {
    if (!val || typeof val !== "object") return { seen: 0, correct: 0, wrong: 0, lastSeen: 0 };
    return {
      seen: typeof val.seen === "number" && !isNaN(val.seen) ? Math.max(0, Math.floor(val.seen)) : 0,
      correct: typeof val.correct === "number" && !isNaN(val.correct) ? Math.max(0, Math.floor(val.correct)) : 0,
      wrong: typeof val.wrong === "number" && !isNaN(val.wrong) ? Math.max(0, Math.floor(val.wrong)) : 0,
      lastSeen: typeof val.lastSeen === "number" && !isNaN(val.lastSeen) ? Math.floor(val.lastSeen) : 0
    };
  }

  function normaliseStats(rawStats) {
    var out = {};
    if (!rawStats || typeof rawStats !== "object") return out;

    // Copy every valid stat key as-is (preserves legacy aliases and unknown keys).
    for (var key in rawStats) {
      if (Object.prototype.hasOwnProperty.call(rawStats, key)) {
        out[key] = normaliseStatEntry(rawStats[key]);
      }
    }

    // Reconcile every known canonical/legacy pair without summing. Field-wise maxima
    // preserve the strongest observation from either app version and are idempotent.
    if (_idMap) {
      for (var legacyKey in _idMap) {
        if (!Object.prototype.hasOwnProperty.call(_idMap, legacyKey)) continue;
        var canonId = _idMap[legacyKey];
        var legacy = out[legacyKey];
        var canonical = out[canonId];
        if (!legacy && !canonical) continue;
        legacy = normaliseStatEntry(legacy);
        canonical = normaliseStatEntry(canonical);
        var merged = {
          seen: Math.max(legacy.seen, canonical.seen),
          correct: Math.max(legacy.correct, canonical.correct),
          wrong: Math.max(legacy.wrong, canonical.wrong),
          lastSeen: Math.max(legacy.lastSeen, canonical.lastSeen)
        };
        out[legacyKey] = normaliseStatEntry(merged);
        out[canonId] = normaliseStatEntry(merged);
      }
    }

    return out;
  }

  // ---- full normalise ----
  function normalise(parsed) {
    if (!parsed || typeof parsed !== "object") return defaults();

    var version = parsed.schemaVersion;
    if (typeof version === "number" && version > CURRENT_SCHEMA) {
      // Future-version save — write-protected marker, fresh state underneath.
      var d = defaults();
      d._writeProtected = true;
      d._futureVersion = version;
      return d;
    }

    var out = defaults();

    // Player slug
    if (typeof parsed.player === "string" && _roster.indexOf(parsed.player) >= 0) {
      out.player = parsed.player;
    } else {
      out.player = null;
    }

    // Defeated — filter to valid roster slugs, deduplicate, keep order, exclude player.
    if (Array.isArray(parsed.defeated)) {
      var seen = {};
      var deduped = [];
      for (var i = 0; i < parsed.defeated.length; i++) {
        var slug = parsed.defeated[i];
        if (typeof slug === "string" && _roster.indexOf(slug) >= 0 && slug !== out.player && !seen[slug]) {
          seen[slug] = true;
          deduped.push(slug);
        }
      }
      out.defeated = deduped;
    }

    // Numeric fields
    out.seenCounter = typeof parsed.seenCounter === "number"
      ? Math.max(0, Math.floor(parsed.seenCounter))
      : 0;

    // coffeeUses: default 3 when absent, preserve explicit 0.
    if ("coffeeUses" in parsed) {
      var cu = Number(parsed.coffeeUses);
      out.coffeeUses = Number.isFinite(cu) ? Math.max(0, Math.min(3, Math.floor(cu))) : 3;
    } else {
      out.coffeeUses = 3;
    }

    // Difficulty
    out.difficulty = (parsed.difficulty === "easy" || parsed.difficulty === "hard")
      ? parsed.difficulty
      : "normal";

    // Library & minigame
    out.libraryProgress = (parsed.libraryProgress && typeof parsed.libraryProgress === "object" && !Array.isArray(parsed.libraryProgress))
      ? safeClone(parsed.libraryProgress) : {};
    out.minigameScores = (parsed.minigameScores && typeof parsed.minigameScores === "object" && !Array.isArray(parsed.minigameScores))
      ? safeClone(parsed.minigameScores) : {};

    // Progression — preserve any existing values, default empty.
    if (parsed.progression && typeof parsed.progression === "object" && !Array.isArray(parsed.progression)) {
      out.progression.badges = Array.isArray(parsed.progression.badges)
        ? parsed.progression.badges.slice() : [];
      out.progression.quests = (parsed.progression.quests && typeof parsed.progression.quests === "object" && !Array.isArray(parsed.progression.quests))
        ? safeClone(parsed.progression.quests) : {};
      out.progression.activities = (parsed.progression.activities && typeof parsed.progression.activities === "object" && !Array.isArray(parsed.progression.activities))
        ? safeClone(parsed.progression.activities) : {};

      // Sanitise battleRoom activity record (#046). Always populated for v2 saves.
      out.progression.activities.battleRoom = _normaliseBattleRoomActivity(out.progression.activities.battleRoom);

      // Validate npcDomains: keys must be in roster, values in VALID_DOMAINS.
      var rawDomains = parsed.progression.npcDomains;
      if (rawDomains && typeof rawDomains === "object" && !Array.isArray(rawDomains)) {
        var cleanDomains = {};
        for (var dk in rawDomains) {
          if (Object.prototype.hasOwnProperty.call(rawDomains, dk)) {
            if (_roster.indexOf(dk) >= 0 && VALID_DOMAINS.indexOf(rawDomains[dk]) >= 0) {
              cleanDomains[dk] = rawDomains[dk];
            }
          }
        }
        out.progression.npcDomains = cleanDomains;
      }
    }

    // Telemetry stats
    out.questionStats = normaliseStats(parsed.questionStats || {});

    return out;
  }

  // ---- battleRoom activity normalisation (#046) ----
  function _normaliseBattleRoomActivity(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { currentStreak: 0, bestStreak: 0, wins: 0 };
    }
    function safeNonNegInt(val) {
      return (typeof val === "number" && isFinite(val)) ? Math.max(0, Math.floor(val)) : 0;
    }
    var currentStreak = safeNonNegInt(raw.currentStreak);
    var bestStreak = safeNonNegInt(raw.bestStreak);
    var wins = safeNonNegInt(raw.wins);
    // bestStreak cannot trail currentStreak
    if (bestStreak < currentStreak) bestStreak = currentStreak;
    // Preserve unknown activity keys on the source object.
    var result = {};
    for (var key in raw) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) result[key] = raw[key];
    }
    result.currentStreak = currentStreak;
    result.bestStreak = bestStreak;
    result.wins = wins;
    return result;
  }

  // ---- localStorage I/O ----
  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (raw === null || raw === undefined) return null;
      var parsed = JSON.parse(raw);
      // Before normalising, back up raw legacy/malformed data once.
      _backupOnce(raw, parsed);
      return normalise(parsed);
    } catch (_e) {
      // Malformed JSON — back up the raw string once, treat as empty.
      try {
        var rawFallback = localStorage.getItem(SAVE_KEY);
        if (rawFallback && !localStorage.getItem(BACKUP_KEY)) {
          localStorage.setItem(BACKUP_KEY, rawFallback);
        }
      } catch (_ignored) {}
      return null;
    }
  }

  function _backupOnce(raw, parsed) {
    try {
      if (localStorage.getItem(BACKUP_KEY)) return; // already backed up
      var version = (parsed && typeof parsed === "object") ? parsed.schemaVersion : undefined;
      // Back up if legacy (no version or < CURRENT_SCHEMA)
      if (version === undefined || (typeof version === "number" && version < CURRENT_SCHEMA)) {
        localStorage.setItem(BACKUP_KEY, raw);
      }
    } catch (_ignored) {}
  }

  function saveToStorage(state) {
    if (state && state._writeProtected) return false;

    // Before writing v2, back up any existing legacy raw save once.
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (raw && !localStorage.getItem(BACKUP_KEY)) {
        var parsed = JSON.parse(raw);
        var version = (parsed && typeof parsed === "object") ? parsed.schemaVersion : undefined;
        if (version === undefined || (typeof version === "number" && version < CURRENT_SCHEMA)) {
          localStorage.setItem(BACKUP_KEY, raw);
        }
      }
    } catch (_ignored) {}

    try {
      // Strip internal-only flags before serialising.
      var clean = {};
      for (var key in state) {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
          if (key !== "_writeProtected" && key !== "_futureVersion") {
            clean[key] = state[key];
          }
        }
      }
      localStorage.setItem(SAVE_KEY, JSON.stringify(clean));
      return true;
    } catch (_e) {
      return false;
    }
  }

  function isWriteProtected(state) {
    return !!(state && state._writeProtected);
  }

  function resetSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(BACKUP_KEY);
    } catch (_ignored) {}
    return defaults();
  }

  // ---- build ID map from question bank ----
  function buildIdMapFromBank(questionBank) {
    var map = {};
    var cats = Object.keys(questionBank);
    for (var ci = 0; ci < cats.length; ci++) {
      var cat = cats[ci];
      var questions = questionBank[cat];
      if (!Array.isArray(questions)) continue;
      for (var i = 0; i < questions.length; i++) {
        var q = questions[i];
        if (q && typeof q.id === "string") {
          map[cat + ":" + i] = q.id;
        }
      }
    }
    return map;
  }

  window.DatamonState = {
    SAVE_KEY: SAVE_KEY,
    BACKUP_KEY: BACKUP_KEY,
    CURRENT_SCHEMA: CURRENT_SCHEMA,
    BATTLE_ROOM_DEFAULTS: BATTLE_ROOM_DEFAULTS,
    configure: configure,
    roster: roster,
    idMap: idMap,
    legacyToCanonical: legacyToCanonical,
    canonicalToLegacy: canonicalToLegacy,
    defaults: defaults,
    normalise: normalise,
    normaliseStats: normaliseStats,
    loadFromStorage: loadFromStorage,
    saveToStorage: saveToStorage,
    isWriteProtected: isWriteProtected,
    resetSave: resetSave,
    safeClone: safeClone,
    buildIdMapFromBank: buildIdMapFromBank
  };
})();
