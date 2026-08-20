// ============================================================
// DATAMON original adaptive soundtrack
// Deterministic Web Audio composition and bounded scheduler.
// Presentation-only: this module never reads or writes game state.
// ============================================================
"use strict";

(function () {
  var MOTIF = Object.freeze([0, 3, 7, 10, 7, 5]);
  var TICK_MS = 25;
  var LOOKAHEAD_S = 0.10;
  var CROSSFADE_S = 0.75;
  var MAX_VOICES = 24;
  var MAX_EVENTS_PER_TICK = 32;
  var MAX_BUSES = 3;
  var MAX_DIAGNOSTIC_TRANSITIONS = 32;

  function freezeScore(score) {
    Object.freeze(score.layers);
    for (var i = 0; i < score.layers.length; i++) {
      Object.freeze(score.layers[i].pattern);
      Object.freeze(score.layers[i]);
    }
    return Object.freeze(score);
  }

  // Notes are semitone offsets from root MIDI. null is a rest. Every arrangement
  // transforms the same six-interval DATAMON motif rather than quoting existing music.
  var SCORES = Object.freeze({
    title: freezeScore({
      label: "Command center", tempo: 82, root: 50, steps: 32, loop: true, volume: 0.115,
      roles: "bell / warm pad / data pulse",
      layers: [
        { instrument: "bell", division: 2, duration: 0.8, gain: 0.22,
          pattern: [0,null,7,null,10,null,7,null,3,null,5,null,7,null,3,null] },
        { instrument: "pad", division: 8, duration: 3.1, gain: 0.12,
          pattern: [-12,-5,-7,-2] },
        { instrument: "pulse", division: 4, duration: 0.12, gain: 0.045,
          pattern: [-24,-24,-17,-19,-24,-24,-17,-19] },
      ],
    }),
    office: freezeScore({
      label: "After-hours office", tempo: 96, root: 50, steps: 32, loop: true, volume: 0.105,
      roles: "soft pulse bass / glass pluck / brushed noise",
      layers: [
        { instrument: "bass", division: 2, duration: 0.30, gain: 0.16,
          pattern: [-12,null,-12,null,-5,null,-5,null,-7,null,-7,null,-2,null,-5,null] },
        { instrument: "pluck", division: 1, duration: 0.18, gain: 0.12,
          pattern: [0,null,3,null,7,null,10,null,7,null,5,null,3,null,7,null] },
        { instrument: "hat", division: 1, duration: 0.045, gain: 0.026,
          pattern: [0,null,0,null,0,null,0,0,0,null,0,null,0,null,0,0] },
      ],
    }),
    library: freezeScore({
      label: "Reading room", tempo: 72, root: 53, steps: 32, loop: true, volume: 0.085,
      roles: "glassy fifths / sparse triangle / room air",
      layers: [
        { instrument: "bell", division: 2, duration: 1.15, gain: 0.13,
          pattern: [0,null,7,null,14,null,7,null,5,null,12,null,7,null,3,null] },
        { instrument: "pad", division: 8, duration: 3.6, gain: 0.09,
          pattern: [-12,-7,-5,-7] },
        { instrument: "hat", division: 4, duration: 0.07, gain: 0.012,
          pattern: [0,0,0,0,0,0,0,0] },
      ],
    }),
    "classic-battle": freezeScore({
      label: "Classic challenge", tempo: 126, root: 52, steps: 32, loop: true, volume: 0.12,
      roles: "square ostinato / clipped lead / clock hats",
      layers: [
        { instrument: "drive", division: 1, duration: 0.13, gain: 0.13,
          pattern: [-12,-12,null,-12,-5,-5,null,-7,-9,-9,null,-9,-5,-5,-7,null] },
        { instrument: "pluck", division: 2, duration: 0.16, gain: 0.12,
          pattern: [0,null,3,null,7,null,10,null,7,null,5,null,12,null,10,null] },
        { instrument: "hat", division: 1, duration: 0.035, gain: 0.034,
          pattern: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] },
      ],
    }),
    "agent-battle": freezeScore({
      label: "Incident command", tempo: 132, root: 50, steps: 32, loop: true, volume: 0.115,
      roles: "syncopated data bass / topology ping / filtered ticks",
      layers: [
        { instrument: "drive", division: 1, duration: 0.12, gain: 0.12,
          pattern: [-12,null,-12,-5,null,-12,-7,null,-12,null,-5,-7,null,-9,-5,null] },
        { instrument: "bell", division: 2, duration: 0.25, gain: 0.105,
          pattern: [0,null,7,null,3,null,10,null,7,null,5,null,15,null,10,null] },
        { instrument: "hat", division: 1, duration: 0.03, gain: 0.025,
          pattern: [0,null,0,0,0,null,0,null,0,null,0,0,0,null,0,null] },
      ],
    }),
    "agent-boss-1": freezeScore({
      label: "Boundary breach I", tempo: 148, root: 50, steps: 32, loop: true, volume: 0.12,
      roles: "incident bass / phase-one signal",
      layers: [
        { instrument: "drive", division: 1, duration: 0.11, gain: 0.15,
          pattern: [-12,-12,-5,null,-12,-7,-5,null,-12,-12,-9,null,-7,-5,-2,null] },
        { instrument: "pluck", division: 2, duration: 0.14, gain: 0.11,
          pattern: [0,null,3,null,7,null,10,null,7,null,5,null,12,null,10,null] },
        { instrument: "hat", division: 1, duration: 0.03, gain: 0.035,
          pattern: [0,0,0,null,0,0,0,0,0,0,0,null,0,0,0,0] },
      ],
    }),
    "agent-boss-2": freezeScore({
      label: "Boundary breach II", tempo: 148, root: 50, steps: 32, loop: true, volume: 0.125,
      roles: "incident bass / delegated counterline / urgent ticks",
      layers: [
        { instrument: "drive", division: 1, duration: 0.11, gain: 0.15,
          pattern: [-12,-12,-5,null,-12,-7,-5,null,-12,-12,-9,null,-7,-5,-2,null] },
        { instrument: "pluck", division: 1, duration: 0.12, gain: 0.105,
          pattern: [0,null,3,7,null,10,7,null,5,null,7,12,null,10,7,null] },
        { instrument: "bell", division: 4, duration: 0.28, gain: 0.07,
          pattern: [12,null,null,null,15,null,null,null,19,null,null,null,17,null,null,null] },
        { instrument: "hat", division: 1, duration: 0.03, gain: 0.037,
          pattern: [0,0,0,null,0,0,0,0,0,0,0,null,0,0,0,0] },
      ],
    }),
    "agent-boss-3": freezeScore({
      label: "Production incident", tempo: 148, root: 50, steps: 32, loop: true, volume: 0.13,
      roles: "full incident stack / augmented motif / double-time clock",
      layers: [
        { instrument: "drive", division: 1, duration: 0.11, gain: 0.16,
          pattern: [-12,-12,-5,-12,-7,-7,-5,null,-12,-12,-9,-7,-5,-5,-2,null] },
        { instrument: "pluck", division: 1, duration: 0.12, gain: 0.11,
          pattern: [0,3,7,null,10,7,5,null,12,10,7,null,15,12,10,null] },
        { instrument: "bell", division: 2, duration: 0.22, gain: 0.075,
          pattern: [12,null,15,null,19,null,22,null,19,null,17,null,15,null,12,null] },
        { instrument: "hat", division: 1, duration: 0.025, gain: 0.04,
          pattern: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] },
      ],
    }),
    minigame: freezeScore({
      label: "Study sprint", tempo: 112, root: 60, steps: 32, loop: true, volume: 0.10,
      roles: "bright pentatonic pluck / friendly bass / light clock",
      layers: [
        { instrument: "pluck", division: 1, duration: 0.15, gain: 0.115,
          pattern: [0,null,2,null,7,null,9,null,7,null,4,null,2,null,7,null] },
        { instrument: "bass", division: 4, duration: 0.28, gain: 0.11,
          pattern: [-12,-5,-8,-7,-12,-5,-8,-7] },
        { instrument: "hat", division: 2, duration: 0.035, gain: 0.025,
          pattern: [0,null,0,null,0,null,0,null,0,null,0,null,0,null,0,null] },
      ],
    }),
    victory: freezeScore({
      label: "Certification fanfare", tempo: 118, root: 50, steps: 24, loop: false, volume: 0.14,
      roles: "motif fanfare / rising bass",
      layers: [
        { instrument: "bell", division: 1, duration: 0.30, gain: 0.17,
          pattern: [0,3,7,10,7,12,15,19,22,null,19,22,24,null,null,null] },
        { instrument: "pad", division: 4, duration: 1.4, gain: 0.11,
          pattern: [-12,-5,0,7,-5,0] },
      ],
    }),
    defeat: freezeScore({
      label: "Signal lost", tempo: 68, root: 50, steps: 16, loop: false, volume: 0.10,
      roles: "descending motif / fading pulse",
      layers: [
        { instrument: "bell", division: 2, duration: 0.55, gain: 0.13,
          pattern: [10,null,7,null,5,null,3,null,0,null,-2,null,-5,null,-12,null] },
        { instrument: "pulse", division: 4, duration: 0.20, gain: 0.06,
          pattern: [-12,-17,-19,-24] },
      ],
    }),
  });

  function deriveScore(base, options) {
    options = options || {};
    var rotate = Math.max(0, options.rotate || 0);
    var layers = base.layers.map(function (layer, index) {
      var pattern = layer.pattern.slice();
      if (rotate && pattern.length) pattern = pattern.slice(rotate % pattern.length).concat(pattern.slice(0, rotate % pattern.length));
      return {
        instrument: options.instruments && options.instruments[index] || layer.instrument,
        division: layer.division,
        duration: Math.max(0.025, layer.duration * (options.durationScale || 1)),
        gain: layer.gain * (options.gainScale || 1),
        pattern: pattern,
      };
    });
    return freezeScore({
      label: options.label || base.label,
      tempo: options.tempo || Math.round(base.tempo * (options.tempoScale || 1)),
      root: base.root + (options.rootShift || 0),
      steps: base.steps,
      loop: options.loop === undefined ? base.loop : !!options.loop,
      volume: base.volume * (options.volumeScale || 1),
      roles: options.roles || base.roles,
      layers: layers,
    });
  }

  // Variants reuse the original score grammar and motif while changing register,
  // pulse, orchestration, and density. They are data-only; audio.js owns playback.
  SCORES = Object.freeze(Object.assign({}, SCORES, {
    select: deriveScore(SCORES.title, { label: "Candidate uplink", tempo: 92, rootShift: 5, rotate: 2, gainScale: 1.05 }),
    "battle-room": deriveScore(SCORES["classic-battle"], { label: "Training grid", tempo: 118, rootShift: -2, rotate: 4, instruments: ["bass", "bell", "hat"], volumeScale: .86 }),
    "library-reader": deriveScore(SCORES.library, { label: "Deep reading", tempo: 66, rootShift: -5, durationScale: 1.2, gainScale: .78, volumeScale: .78 }),
    "minigame-matching": deriveScore(SCORES.minigame, { label: "Pair protocol", tempo: 108, rootShift: 0, rotate: 2 }),
    "minigame-cloze": deriveScore(SCORES.minigame, { label: "Missing token", tempo: 104, rootShift: -3, rotate: 4, instruments: ["bell", "bass", "hat"] }),
    "minigame-assembly": deriveScore(SCORES.minigame, { label: "System assembly", tempo: 116, rootShift: 2, rotate: 6, instruments: ["drive", "bass", "hat"] }),
    "minigame-timed": deriveScore(SCORES.minigame, { label: "Recall clock", tempo: 124, rootShift: 5, rotate: 8, gainScale: 1.06 }),
    "classic-battle-mcp": deriveScore(SCORES["classic-battle"], { label: "MCP routing duel", tempo: 124, rootShift: -2, rotate: 2, instruments: ["drive", "bell", "hat"] }),
    "classic-battle-config": deriveScore(SCORES["classic-battle"], { label: "Configuration duel", tempo: 128, rootShift: 2, rotate: 4, instruments: ["pulse", "pluck", "hat"] }),
    "classic-battle-prompt": deriveScore(SCORES["classic-battle"], { label: "Prompt duel", tempo: 130, rootShift: 5, rotate: 6, instruments: ["bass", "bell", "hat"] }),
    "classic-battle-context": deriveScore(SCORES["classic-battle"], { label: "Context duel", tempo: 122, rootShift: -5, rotate: 8, instruments: ["drive", "pad", "hat"] }),
    "classic-battle-mix": deriveScore(SCORES["classic-battle"], { label: "Mixed systems duel", tempo: 134, rootShift: 7, rotate: 10, instruments: ["drive", "pluck", "hat"] }),
    "office-agent": deriveScore(SCORES.office, { label: "Agent wing", rootShift: -2, rotate: 2, volumeScale: .96 }),
    "office-mcp": deriveScore(SCORES.office, { label: "MCP bullpen", rootShift: 0, rotate: 4 }),
    "office-config": deriveScore(SCORES.office, { label: "Config kitchen", rootShift: 2, rotate: 6 }),
    "office-context": deriveScore(SCORES.office, { label: "Context room", rootShift: -5, rotate: 8, tempo: 92 }),
    "office-prompt": deriveScore(SCORES.office, { label: "Prompt studio", rootShift: 5, rotate: 10, tempo: 100 }),
    "office-mix": deriveScore(SCORES.office, { label: "Mixed practice", rootShift: 7, rotate: 12, tempo: 102 }),
  }));

  function canonicalDomain(value) {
    value = String(value || "").toLowerCase();
    return ["agent", "mcp", "config", "prompt", "context", "mix"].indexOf(value) >= 0 ? value : "";
  }

  function resolveScene(snapshot) {
    snapshot = snapshot || {};
    var state = snapshot.state || "title";
    if (state === "victory") return "victory";
    if (state === "select") return "select";
    if (state === "minigame") {
      var minigame = String(snapshot.minigameType || "").toLowerCase();
      return SCORES["minigame-" + minigame] ? "minigame-" + minigame : "minigame";
    }
    if (state === "battle" && snapshot.battle) {
      var battle = snapshot.battle;
      var phase = battle.phase || "";
      if (phase === "defeat" || phase === "lose") return "defeat";
      if (phase === "victory" || phase === "win") return "victory";
      if (battle.agentOps) {
        if (battle.agentOps.boss) {
          return "agent-boss-" + Math.max(1, Math.min(3, (battle.agentOps.bossPhase || 0) + 1));
        }
        return "agent-battle";
      }
      var battleDomain = canonicalDomain(battle.domain);
      return battleDomain && battleDomain !== "agent" && SCORES["classic-battle-" + battleDomain]
        ? "classic-battle-" + battleDomain : "classic-battle";
    }
    if (state === "transition" && snapshot.transitionType === "AGENT") return "agent-battle";
    if (state === "transition") {
      var transitionDomain = canonicalDomain(snapshot.transitionType);
      return transitionDomain && SCORES["classic-battle-" + transitionDomain]
        ? "classic-battle-" + transitionDomain : "classic-battle";
    }
    if (state === "overworld" || state === "search" || state === "dialogue") {
      if (snapshot.currentMap === "library") return snapshot.overlay === "reader" ? "library-reader" : "library";
      if (snapshot.currentMap === "battleRoom") return "battle-room";
      var region = canonicalDomain(snapshot.region);
      return region && SCORES["office-" + region] ? "office-" + region : "office";
    }
    return "title";
  }

  function midiToHz(note) { return 440 * Math.pow(2, (note - 69) / 12); }

  var rememberedScene = "title";
  var rememberedMuted = false;
  function director() {
    return typeof window !== "undefined" && window.DatamonAudio ? window.DatamonAudio : null;
  }
  function init(options) {
    options = options || {};
    rememberedMuted = !!options.muted;
    if (options.scene && SCORES[options.scene]) rememberedScene = options.scene;
    var audio = director();
    if (audio) audio.init({ muted: rememberedMuted, scene: rememberedScene });
  }
  function unlock() { var audio = director(); return audio ? audio.unlock() : false; }
  function setScene(scene) {
    if (!SCORES[scene]) scene = "title";
    var changed = scene !== rememberedScene;
    rememberedScene = scene;
    var audio = director();
    return audio ? audio.setMusicScene(scene) : changed;
  }
  function setMuted(value) {
    rememberedMuted = !!value;
    var audio = director();
    if (audio) audio.setMuted(rememberedMuted);
  }
  function suspend() { var audio = director(); if (audio) audio.suspend(); }
  function resume() { var audio = director(); if (audio) audio.resume(); }
  function reset() { rememberedScene = null; var audio = director(); if (audio) audio.reset(); }
  function getDiagnostics() {
    var audio = director();
    if (audio) return audio.getDiagnostics();
    return {
      available: false, contextCreations: 0, unlocked: false, muted: rememberedMuted,
      scene: rememberedScene, tempo: rememberedScene && SCORES[rememberedScene] ? SCORES[rememberedScene].tempo : null,
      schedulerActive: false, schedulerStarts: 0, activeVoices: 0, buses: 0,
      retiringBuses: 0, generation: 0, step: 0, oneShotComplete: false,
      transitions: [], noiseBuffers: 0,
      limits: { voices: 32, eventsPerTick: 32, buses: 5, transitions: 32 },
    };
  }

  var API = {
    MOTIF: MOTIF,
    SCORES: SCORES,
    resolveScene: resolveScene,
    canonicalDomain: canonicalDomain,
    midiToHz: midiToHz,
    deriveScore: deriveScore,
    init: init,
    unlock: unlock,
    setScene: setScene,
    setMuted: setMuted,
    suspend: suspend,
    resume: resume,
    reset: reset,
    getDiagnostics: getDiagnostics,
  };

  if (typeof window !== "undefined") window.DatamonMusic = API;
})();
