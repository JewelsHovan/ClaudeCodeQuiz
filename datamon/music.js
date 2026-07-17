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

  function resolveScene(snapshot) {
    snapshot = snapshot || {};
    var state = snapshot.state || "title";
    if (state === "victory") return "victory";
    if (state === "minigame") return "minigame";
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
      return "classic-battle";
    }
    if (state === "transition" && snapshot.transitionType === "AGENT") return "agent-battle";
    if (state === "transition") return "classic-battle";
    if (state === "overworld" || state === "search" || state === "dialogue") {
      return snapshot.currentMap === "library" ? "library" : "office";
    }
    return "title";
  }

  function midiToHz(note) { return 440 * Math.pow(2, (note - 69) / 12); }

  // Web Audio shims and privacy-hardened browsers sometimes expose only part of
  // AudioParam. Fall back to direct assignment so audio can always fail silent.
  function paramSet(param, value, time) {
    if (!param) return;
    if (typeof param.setValueAtTime === "function") param.setValueAtTime(value, time);
    else param.value = value;
  }
  function paramLinear(param, value, time) {
    if (!param) return;
    if (typeof param.linearRampToValueAtTime === "function") param.linearRampToValueAtTime(value, time);
    else param.value = value;
  }
  function paramExponential(param, value, time) {
    if (!param) return;
    if (typeof param.exponentialRampToValueAtTime === "function") param.exponentialRampToValueAtTime(value, time);
    else param.value = value;
  }
  function paramCancel(param, time) {
    if (param && typeof param.cancelScheduledValues === "function") param.cancelScheduledValues(time);
  }

  var audioContext = null;
  var masterGain = null;
  var unlocked = false;
  var muted = false;
  var currentScene = null;
  var currentScore = null;
  var currentBus = null;
  var retiringBuses = [];
  var activeVoices = [];
  var schedulerId = null;
  var schedulerStarts = 0;
  var generation = 0;
  var stepIndex = 0;
  var nextStepTime = 0;
  var completedOneShot = false;
  var noiseBuffer = null;
  var transitions = [];
  var available = true;
  var contextCreations = 0;

  function failSilent() {
    available = false;
    generation++;
    stopScheduler();
    stopVoices();
    if (currentBus) disposeBus(currentBus);
    for (var i = 0; i < retiringBuses.length; i++) disposeBus(retiringBuses[i]);
    retiringBuses = [];
    currentBus = null;
    currentScore = null;
    noiseBuffer = null;
    var failedContext = audioContext;
    audioContext = null;
    masterGain = null;
    unlocked = false;
    if (failedContext && typeof failedContext.close === "function") {
      try {
        var result = failedContext.close();
        if (result && result.catch) result.catch(function () {});
      } catch (_) {}
    }
    return false;
  }

  function createContext() {
    if (!available) return false;
    if (audioContext && audioContext.state !== "closed") return true;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return failSilent();
      audioContext = new Ctx();
      contextCreations++;
      if (typeof audioContext.createGain !== "function") return failSilent();
      masterGain = audioContext.createGain();
      if (!masterGain || !masterGain.gain || typeof masterGain.connect !== "function") return failSilent();
      masterGain.gain.value = muted ? 0 : 0.72;
      masterGain.connect(audioContext.destination);
      return true;
    } catch (_) {
      return failSilent();
    }
  }

  function makeNoiseBuffer() {
    if (noiseBuffer || !audioContext || !audioContext.createBuffer) return noiseBuffer;
    var length = Math.max(1, Math.floor((audioContext.sampleRate || 44100) * 0.25));
    noiseBuffer = audioContext.createBuffer(1, length, audioContext.sampleRate || 44100);
    var data = noiseBuffer.getChannelData(0);
    var seed = 0xDA7A2026;
    for (var i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = ((seed / 4294967296) * 2 - 1) * (1 - i / length);
    }
    return noiseBuffer;
  }

  function pruneVoices() {
    activeVoices = activeVoices.filter(function (voice) { return !voice.ended; });
    while (activeVoices.length > MAX_VOICES) {
      var oldest = activeVoices.shift();
      try { oldest.source.stop(); } catch (_) {}
      oldest.ended = true;
    }
  }

  function scheduleVoice(instrument, note, when, duration, gainAmount, bus, token) {
    if (!audioContext || !bus || token !== generation || muted) return;
    if (instrument === "hat" && typeof audioContext.createBufferSource !== "function") return;
    if (instrument !== "hat" && typeof audioContext.createOscillator !== "function") {
      throw new Error("Web Audio oscillator unavailable");
    }
    pruneVoices();
    if (activeVoices.length >= MAX_VOICES) return;
    var source;
    var gain = audioContext.createGain();
    var filter = audioContext.createBiquadFilter ? audioContext.createBiquadFilter() : null;
    var attack = 0.006;
    var release = Math.max(0.03, duration * 0.45);
    paramSet(gain.gain, 0.0001, when);
    paramExponential(gain.gain, Math.max(0.0002, gainAmount), when + attack);
    paramExponential(gain.gain, 0.0001, when + duration + release);

    if (instrument === "hat") {
      source = audioContext.createBufferSource();
      source.buffer = makeNoiseBuffer();
      if (filter) { filter.type = "highpass"; filter.frequency.value = 4500; }
    } else {
      source = audioContext.createOscillator();
      source.type = instrument === "pad" || instrument === "bass" ? "triangle"
        : instrument === "bell" ? "sine" : instrument === "drive" ? "square" : "square";
      source.frequency.value = midiToHz(note);
      if (filter) {
        filter.type = "lowpass";
        filter.frequency.value = instrument === "drive" ? 1200 : instrument === "pad" ? 900 : 2600;
      }
    }
    if (filter) { source.connect(filter); filter.connect(gain); }
    else source.connect(gain);
    gain.connect(bus);
    var voice = { source: source, gain: gain, ended: false, generation: token };
    activeVoices.push(voice);
    source.onended = function () { voice.ended = true; };
    try { source.start(when); source.stop(when + duration + release + 0.02); } catch (_) { voice.ended = true; }
  }

  function disposeBus(record) {
    if (!record) return;
    try { if (record.gain && record.gain.disconnect) record.gain.disconnect(); } catch (_) {}
    record.disposed = true;
  }

  function cleanupBuses(now) {
    for (var i = retiringBuses.length - 1; i >= 0; i--) {
      if (now >= retiringBuses[i].disposeAt) {
        disposeBus(retiringBuses[i]);
        retiringBuses.splice(i, 1);
      }
    }
    while (retiringBuses.length + (currentBus ? 1 : 0) > MAX_BUSES) {
      disposeBus(retiringBuses.shift());
    }
  }

  function scheduleStep(score, step, when, token) {
    var scheduled = 0;
    var sixteenth = 60 / score.tempo / 4;
    for (var i = 0; i < score.layers.length && scheduled < MAX_EVENTS_PER_TICK; i++) {
      var layer = score.layers[i];
      if (step % layer.division !== 0) continue;
      var patternStep = Math.floor(step / layer.division) % layer.pattern.length;
      var offset = layer.pattern[patternStep];
      if (offset === null || offset === undefined) continue;
      scheduleVoice(layer.instrument, score.root + offset, when,
        Math.max(0.025, layer.duration), layer.gain, currentBus && currentBus.gain, token);
      scheduled++;
    }
    return sixteenth;
  }

  function schedulerTick() {
    if (!audioContext || !unlocked || muted || !currentScore || !currentBus) return;
    var now = audioContext.currentTime;
    cleanupBuses(now);
    var horizon = now + LOOKAHEAD_S;
    var guard = 0;
    while (nextStepTime < horizon && guard < MAX_EVENTS_PER_TICK) {
      var duration = scheduleStep(currentScore, stepIndex, nextStepTime, generation);
      stepIndex++;
      if (stepIndex >= currentScore.steps) {
        if (currentScore.loop) stepIndex = 0;
        else { completedOneShot = true; currentScore = null; break; }
      }
      nextStepTime += duration;
      guard++;
    }
    pruneVoices();
    if (completedOneShot) stopScheduler();
  }

  function ensureScheduler() {
    if (schedulerId !== null || !audioContext || !currentScore || !currentBus || !unlocked || muted) return;
    schedulerId = setInterval(function () {
      try { schedulerTick(); } catch (_) { failSilent(); }
    }, TICK_MS);
    schedulerStarts++;
  }

  function stopScheduler() {
    if (schedulerId !== null) clearInterval(schedulerId);
    schedulerId = null;
  }

  function stopVoices() {
    for (var i = 0; i < activeVoices.length; i++) {
      try { activeVoices[i].source.stop(); } catch (_) {}
      activeVoices[i].ended = true;
    }
    activeVoices = [];
  }

  function setScene(scene) {
    if (!SCORES[scene]) scene = "title";
    if (scene === currentScene) return false;
    currentScene = scene;
    currentScore = SCORES[scene];
    generation++;
    stepIndex = 0;
    completedOneShot = false;
    transitions.push(scene);
    if (transitions.length > MAX_DIAGNOSTIC_TRANSITIONS) transitions.shift();

    if (!audioContext || !masterGain) return true;
    try {
      var now = audioContext.currentTime;
      if (currentBus) {
        var old = currentBus;
        paramCancel(old.gain.gain, now);
        paramSet(old.gain.gain, Math.max(0.0001, old.gain.gain.value || 0.0001), now);
        paramLinear(old.gain.gain, 0.0001, now + CROSSFADE_S);
        old.disposeAt = now + CROSSFADE_S + 0.05;
        retiringBuses.push(old);
      }
      if (typeof audioContext.createGain !== "function") return failSilent();
      var node = audioContext.createGain();
      if (!node || !node.gain || typeof node.connect !== "function") return failSilent();
      paramSet(node.gain, 0.0001, now);
      paramLinear(node.gain, currentScore.volume, now + CROSSFADE_S);
      node.connect(masterGain);
      currentBus = { gain: node, scene: scene, disposeAt: Infinity, disposed: false };
      nextStepTime = now + 0.025;
      cleanupBuses(now);
      ensureScheduler();
      return true;
    } catch (_) {
      return failSilent();
    }
  }

  function unlock() {
    try {
      if (!createContext()) return false;
      unlocked = true;
      var resumed = audioContext.state === "suspended" && audioContext.resume ? audioContext.resume() : null;
      if (resumed && resumed.catch) resumed.catch(function () { failSilent(); });
      if (!currentScene) setScene("title");
      else if (!currentBus) {
        var remembered = currentScene;
        currentScene = null;
        setScene(remembered);
      }
      ensureScheduler();
      return available;
    } catch (_) {
      return failSilent();
    }
  }

  function setMuted(value) {
    muted = !!value;
    if (masterGain && audioContext) {
      var now = audioContext.currentTime;
      try {
        paramCancel(masterGain.gain, now);
        paramSet(masterGain.gain, masterGain.gain.value || 0.0001, now);
        paramLinear(masterGain.gain, muted ? 0.0001 : 0.72, now + 0.08);
      } catch (_) { masterGain.gain.value = muted ? 0 : 0.72; }
    }
    if (muted) { stopScheduler(); stopVoices(); }
    else if (unlocked) {
      nextStepTime = audioContext ? audioContext.currentTime + 0.03 : 0;
      ensureScheduler();
    }
  }

  function suspend() {
    stopScheduler();
    stopVoices();
    if (audioContext && audioContext.suspend) {
      try { var result = audioContext.suspend(); if (result && result.catch) result.catch(function () {}); } catch (_) {}
    }
  }

  function resume() {
    if (!unlocked || muted || !audioContext) return;
    try {
      var result = audioContext.resume && audioContext.resume();
      if (result && result.catch) result.catch(function () { failSilent(); });
    } catch (_) { failSilent(); return; }
    nextStepTime = audioContext.currentTime + 0.03;
    ensureScheduler();
  }

  function reset() {
    generation++;
    stopScheduler();
    stopVoices();
    if (currentBus) disposeBus(currentBus);
    for (var i = 0; i < retiringBuses.length; i++) disposeBus(retiringBuses[i]);
    retiringBuses = [];
    currentBus = null;
    currentScene = null;
    currentScore = null;
    stepIndex = 0;
    completedOneShot = false;
  }

  function getDiagnostics() {
    pruneVoices();
    return {
      available: available,
      contextCreations: contextCreations,
      unlocked: unlocked,
      muted: muted,
      scene: currentScene,
      tempo: currentScene && SCORES[currentScene] ? SCORES[currentScene].tempo : null,
      schedulerActive: schedulerId !== null,
      schedulerStarts: schedulerStarts,
      activeVoices: activeVoices.length,
      buses: retiringBuses.length + (currentBus ? 1 : 0),
      retiringBuses: retiringBuses.length,
      generation: generation,
      step: stepIndex,
      oneShotComplete: completedOneShot,
      transitions: transitions.slice(),
      noiseBuffers: noiseBuffer ? 1 : 0,
      limits: {
        voices: MAX_VOICES, eventsPerTick: MAX_EVENTS_PER_TICK,
        buses: MAX_BUSES, transitions: MAX_DIAGNOSTIC_TRANSITIONS,
      },
    };
  }

  function init(options) {
    options = options || {};
    muted = !!options.muted;
    if (options.scene) setScene(options.scene);
  }

  var API = {
    MOTIF: MOTIF,
    SCORES: SCORES,
    resolveScene: resolveScene,
    midiToHz: midiToHz,
    init: init,
    unlock: unlock,
    setScene: setScene,
    setMuted: setMuted,
    suspend: suspend,
    resume: resume,
    reset: reset,
    getDiagnostics: getDiagnostics,
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) suspend(); else resume();
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", suspend);
    window.DatamonMusic = API;
  }
})();
