// ============================================================
// DATAMON portrait-dialogue runtime — pure immutable reducer.
// Owns script validation, typewriter/choice progression,
// exact-once event tokens, and safe stand displacement.
// Classic script (no ESM). Exposes window.DatamonDialogueRuntime.
// ============================================================

"use strict";

(function () {
  var API = {};
  var EFFECT_TYPES = ["ACTIVATE_QUEST", "START_BATTLE", "OPEN_MENTOR_REVIEW", "OPEN_CERT_CONSOLE", "CLOSE_DIALOGUE"];
  var EVENT_TYPES = ["TICK", "ACTIVATE", "MOVE_CHOICE", "CHOOSE", "SKIP"];
  var MAX_CONSUMED_TOKENS = 64;

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function validEffect(effect) {
    return !!effect && typeof effect === "object" &&
      EFFECT_TYPES.indexOf(effect.type) >= 0 &&
      Object.keys(effect).every(function (key) { return key === "type"; });
  }

  function validSpeaker(speaker) {
    return !!speaker && typeof speaker === "object" &&
      typeof speaker.name === "string" && speaker.name.trim().length > 0 && speaker.name.length <= 80 &&
      (speaker.slug === null || typeof speaker.slug === "string") &&
      ["left", "right", "system"].indexOf(speaker.side) >= 0 &&
      (speaker.domain == null || typeof speaker.domain === "string") &&
      (speaker.expression == null || typeof speaker.expression === "string");
  }

  function normalizeScript(input) {
    var script = clone(input);
    if (!script || typeof script !== "object" || typeof script.id !== "string" || !script.id ||
        typeof script.startBeat !== "string" || !script.startBeat ||
        !script.beats || typeof script.beats !== "object" || Array.isArray(script.beats) ||
        !script.beats[script.startBeat]) return null;
    var ids = Object.keys(script.beats);
    if (!ids.length || ids.length > 64) return null;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], beat = script.beats[id];
      if (!beat || beat.id !== id || !validSpeaker(beat.speaker) ||
          typeof beat.text !== "string" || beat.text.length > 1200) return null;
      if (beat.next != null && (typeof beat.next !== "string" || !script.beats[beat.next])) return null;
      if (beat.effects != null && (!Array.isArray(beat.effects) || !beat.effects.every(validEffect))) return null;
      if (beat.choices != null) {
        if (!Array.isArray(beat.choices) || beat.choices.length < 1 || beat.choices.length > 6) return null;
        for (var j = 0; j < beat.choices.length; j++) {
          var choice = beat.choices[j];
          if (!choice || typeof choice.label !== "string" || !choice.label || choice.label.length > 160 ||
              (choice.next != null && (typeof choice.next !== "string" || !script.beats[choice.next])) ||
              (choice.effects != null && (!Array.isArray(choice.effects) || !choice.effects.every(validEffect)))) return null;
        }
      }
    }
    if (script.skipEffects != null && (!Array.isArray(script.skipEffects) || !script.skipEffects.every(validEffect))) return null;
    script.skipEffects = script.skipEffects || [];
    return deepFreeze(script);
  }

  function beatFor(state) {
    return state && state.script && state.script.beats[state.beatId] || null;
  }

  function phaseFor(beat, visibleChars) {
    if (!beat) return "done";
    if (visibleChars < beat.text.length) return "typing";
    return beat.choices && beat.choices.length ? "choice" : "ready";
  }

  function enterBeat(state, beatId) {
    var next = Object.assign({}, state, { beatId: beatId, visibleChars: 0, choice: 0 });
    var beat = beatFor(next);
    next.phase = phaseFor(beat, 0);
    return next;
  }

  function consume(state, token) {
    var tokens = state.consumedTokens.slice();
    tokens.push(token);
    return Object.assign({}, state, { consumedTokens: tokens });
  }

  function finishBeat(state, choice) {
    var beat = beatFor(state);
    if (!beat) return { state: state, effects: [] };
    var effects = [];
    if (Array.isArray(beat.effects)) effects = effects.concat(beat.effects);
    if (choice && Array.isArray(choice.effects)) effects = effects.concat(choice.effects);
    var nextId = choice && choice.next != null ? choice.next : beat.next;
    if (nextId) return { state: enterBeat(state, nextId), effects: effects.map(clone) };
    return {
      state: Object.assign({}, state, { phase: "done", completed: true }),
      effects: effects.map(clone),
    };
  }

  API.validateScript = function (script) { return normalizeScript(script); };

  API.createSession = function (script) {
    var normalized = normalizeScript(script);
    if (!normalized) return null;
    var beat = normalized.beats[normalized.startBeat];
    return {
      script: normalized,
      beatId: normalized.startBeat,
      visibleChars: 0,
      choice: 0,
      phase: phaseFor(beat, 0),
      completed: false,
      consumedTokens: [],
    };
  };

  API.currentBeat = function (state) { return beatFor(state); };

  API.reduce = function (state, event) {
    if (!state || !event || EVENT_TYPES.indexOf(event.type) < 0 || state.completed ||
        !Array.isArray(state.consumedTokens) || !Number.isFinite(state.visibleChars) ||
        !Number.isInteger(state.choice) || ["typing", "choice", "ready"].indexOf(state.phase) < 0) {
      return { state: state, effects: [], consumed: false };
    }
    var beat = beatFor(state);
    if (!beat) return { state: state, effects: [], consumed: false };

    if (event.type === "TICK") {
      var amount = Number(event.amount);
      if (!Number.isFinite(amount) || amount <= 0 || state.phase !== "typing") {
        return { state: state, effects: [], consumed: false };
      }
      var visible = event.reducedMotion ? beat.text.length : Math.min(beat.text.length, state.visibleChars + amount);
      if (visible === state.visibleChars) return { state: state, effects: [], consumed: false };
      return {
        state: Object.assign({}, state, { visibleChars: visible, phase: phaseFor(beat, visible) }),
        effects: [], consumed: false,
      };
    }

    var token = typeof event.token === "string" && event.token ? event.token : null;
    if (!token || state.consumedTokens.indexOf(token) >= 0 || state.consumedTokens.length >= MAX_CONSUMED_TOKENS) {
      return { state: state, effects: [], consumed: false };
    }
    var choices = Array.isArray(beat.choices) ? beat.choices : [];
    if ((event.type === "MOVE_CHOICE" && (state.phase !== "choice" || !choices.length ||
          (event.direction !== -1 && event.direction !== 1))) ||
        (event.type === "CHOOSE" && (state.phase !== "choice" || !Number.isInteger(event.index) ||
          event.index < 0 || event.index >= choices.length)) ||
        (event.type === "ACTIVATE" && (state.phase === "choice" && !choices.length))) {
      return { state: state, effects: [], consumed: false };
    }
    var next = consume(state, token), result = { state: next, effects: [] };

    if (event.type === "SKIP") {
      result = {
        state: Object.assign({}, next, { phase: "done", completed: true }),
        effects: next.script.skipEffects.map(clone),
      };
    } else if (event.type === "MOVE_CHOICE") {
      if (next.phase === "choice" && beat.choices && beat.choices.length) {
        var direction = event.direction;
        result.state = Object.assign({}, next, {
          choice: (next.choice + direction + beat.choices.length) % beat.choices.length,
        });
      }
    } else if (event.type === "CHOOSE") {
      var index = Number(event.index);
      if (next.phase === "choice" && Number.isInteger(index) && index >= 0 && index < beat.choices.length) {
        result = finishBeat(next, beat.choices[index]);
      }
    } else if (event.type === "ACTIVATE") {
      if (next.phase === "typing") {
        result.state = Object.assign({}, next, {
          visibleChars: beat.text.length,
          phase: phaseFor(beat, beat.text.length),
        });
      } else if (next.phase === "choice") {
        result = finishBeat(next, beat.choices[next.choice]);
      } else if (next.phase === "ready") {
        result = finishBeat(next, null);
      }
    }
    return { state: result.state, effects: result.effects || [], consumed: true };
  };

  // Select a safe player destination before a seated colleague challenge. The first candidate
  // moves directly away from the NPC; orthogonal alternatives follow. Returning the original
  // cell is an explicit no-motion fallback and never depends on collision callbacks.
  API.chooseStandDisplacement = function (player, npc, isValid) {
    if (!player || !npc) return null;
    var px = Number(player.x), py = Number(player.y), nx = Number(npc.x), ny = Number(npc.y);
    if (![px, py, nx, ny].every(Number.isInteger)) return null;
    var rx = px - nx, ry = py - ny;
    var dx = Math.abs(rx) >= Math.abs(ry) ? Math.sign(rx) : 0;
    var dy = dx ? 0 : Math.sign(ry);
    if (!dx && !dy) dy = 1;
    var candidates = [
      [px + dx, py + dy],
      [px + (dy || 0), py + (-dx || 0)],
      [px - (dy || 0), py - (-dx || 0)],
    ];
    for (var i = 0; i < candidates.length; i++) {
      var x = candidates[i][0], y = candidates[i][1];
      if (typeof isValid === "function" && isValid(x, y)) return { x: x, y: y, moved: true };
    }
    return { x: px, y: py, moved: false };
  };

  API.EFFECT_TYPES = Object.freeze(EFFECT_TYPES.slice());
  API.EVENT_TYPES = Object.freeze(EVENT_TYPES.slice());
  API.MAX_CONSUMED_TOKENS = MAX_CONSUMED_TOKENS;

  window.DatamonDialogueRuntime = API;
})();
