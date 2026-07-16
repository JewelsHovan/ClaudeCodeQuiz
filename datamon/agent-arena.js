// ============================================================
// DATAMON Agent Operations — Incident Command arena
// Presentation-only controller for AGENT encounters.
//
// This classic script consumes reducer transitions, but never writes reducer,
// save, telemetry, HP, Stability, Momentum, or Guardrail state. Optional art is
// additive; every layer has a complete procedural 2x/DPR-aware fallback.
// ============================================================

"use strict";

(function () {
  var W = 800;
  var H = 608;
  var MAX_PARTICLES = 64;
  var MAX_VOICES = 8;
  var MAX_DELAYED_TONES = 16;
  var MAX_ANNOUNCEMENT_KEYS = 64;
  var MAX_FRAME_SAMPLES = 120;

  var COLORS = {
    ink: "#030713",
    midnight: "#081426",
    cobalt: "#2f6fed",
    cyan: "#45d7e8",
    amber: "#f2b35d",
    coral: "#f36f5b",
    bone: "#e8dfc8",
    text: "#e2e8f0",
    dim: "#94a3b8",
    disabled: "#475569",
    success: "#4ade80",
    panel: "rgba(8,20,38,0.96)",
  };

  var ACTION_META = {
    query: { shape: "diamond", caption: "TRACE ROUTE" },
    inspect: { shape: "hexagon", caption: "REVEAL SIGNAL" },
    patch: { shape: "shield", caption: "RAISE GUARDRAIL" },
    escalate: { shape: "chevron", caption: "SURGE ROUTE" },
  };

  var PHASE_LABELS = ["TOOL CALL", "DELEGATED WORKFLOW", "PRODUCTION INCIDENT"];
  var OPTIONAL_LAYER_NAMES = ["backWall", "incidentBoard", "commandTable", "foreground", "effects"];

  var api = {};
  var drawTrainer = null;
  var playerSlug = null;
  var npcSlug = null;
  var particles = [];
  var cue = null;
  var caption = "INCIDENT CHANNEL OPEN";
  var cameraShake = 0;
  var arenaFrame = 0;
  var turnNumber = 0;
  var transitionNumber = 0;
  var lastResult = null;
  var hover = { kind: null, index: -1, pressed: false };
  var optionalLayers = Object.create(null);
  var frameSamples = [];
  var lastEntranceOffset = 0;

  var reducedMotion = false;
  var motionQuery = null;
  var motionListenerInstalled = false;

  var muted = false;
  var audioContext = null;
  var audioUnlocked = false;
  var audioAvailable = null;
  var voices = [];
  var delayedTones = new Set();
  var toneStarts = 0;

  var announcedKeys = [];
  var announcedKeySet = new Set();
  var lastAnnouncement = "";
  var announcementCount = 0;

  function cloneRect(rect) {
    return [rect[0], rect[1], rect[2], rect[3]];
  }

  // Action and choice geometry deliberately use separate functions and arrays.
  // Drawing and pointer hit-testing both call these exact public functions.
  api.actionRects = function () {
    return [
      [24, 466, 368, 56],
      [408, 466, 368, 56],
      [24, 532, 368, 56],
      [408, 532, 368, 56],
    ].map(cloneRect);
  };

  api.choiceRects = function () {
    return [
      [24, 478, 368, 50],
      [408, 478, 368, 50],
      [24, 538, 368, 50],
      [408, 538, 368, 50],
    ].map(cloneRect);
  };

  api.runRect = function () {
    return [700, 408, 76, 26];
  };

  function hitTest(rects, x, y) {
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]) return i;
    }
    return -1;
  }

  api.actionHitTest = function (x, y) { return hitTest(api.actionRects(), x, y); };
  api.choiceHitTest = function (x, y) { return hitTest(api.choiceRects(), x, y); };
  api.runHitTest = function (x, y) {
    var r = api.runRect();
    return x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];
  };

  function currentReducedMotion() {
    try {
      return !!window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (_) {
      return false;
    }
  }

  api.prefersReducedMotion = currentReducedMotion;
  api.isReducedMotion = function () { return reducedMotion; };

  function clearMotionState() {
    particles = [];
    cue = null;
    cameraShake = 0;
    lastEntranceOffset = 0;
  }

  function installMotionListener() {
    if (motionListenerInstalled) return;
    motionListenerInstalled = true;
    try {
      motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      reducedMotion = !!motionQuery.matches;
      var onChange = function (event) {
        reducedMotion = !!event.matches;
        if (reducedMotion) clearMotionState();
      };
      if (typeof motionQuery.addEventListener === "function") motionQuery.addEventListener("change", onChange);
      else if (typeof motionQuery.addListener === "function") motionQuery.addListener(onChange);
    } catch (_) {
      reducedMotion = false;
    }
  }

  function rememberAnnouncementKey(key) {
    if (announcedKeySet.has(key)) return false;
    announcedKeySet.add(key);
    announcedKeys.push(key);
    if (announcedKeys.length > MAX_ANNOUNCEMENT_KEYS) {
      announcedKeySet.delete(announcedKeys.shift());
    }
    return true;
  }

  api.announce = function (key, text) {
    if (!text || !rememberAnnouncementKey(String(key))) return false;
    lastAnnouncement = String(text);
    announcementCount++;
    var region = document.getElementById("datamon-announcer");
    if (region) region.textContent = lastAnnouncement;
    return true;
  };

  function humanSlug(slug) {
    if (!slug) return "rival agent";
    return String(slug).split("-").map(function (part) {
      return part ? part.charAt(0).toUpperCase() + part.slice(1) : "";
    }).join(" ");
  }

  function questionAnnouncement(question) {
    if (!question) return "Question unavailable.";
    var choices = (question.c || []).map(function (choice, index) {
      return (index + 1) + ". " + choice;
    }).join("; ");
    return "Question: " + (question.q || "") + ". Choices: " + choices + ".";
  }

  function actionLabel(name) {
    var spec = window.DatamonBattleOps && window.DatamonBattleOps.ACTIONS[name];
    return spec ? spec.label : humanSlug(name || "unknown action");
  }

  function expectedIndex(question) {
    if (!question) return -1;
    return question.correct != null ? question.correct : question.a;
  }

  function signed(delta) {
    if (delta > 0) return "+" + delta;
    return String(delta);
  }

  function predictedNext(state) {
    if (!state) return "unknown";
    if (state.playerHp <= 0) return "Defeat";
    if (state.stability <= 0 && state.boss && state.bossPhase + 1 < state.bossPhases) {
      return "Boss phase " + (state.bossPhase + 2) + " — " + PHASE_LABELS[state.bossPhase + 1];
    }
    if (state.stability <= 0) return "Victory";
    return "Feedback, then the next question";
  }

  function buildResult(previous, state, event) {
    var question = state.question || (previous && previous.question);
    var submittedIndex = event.type === "TIMEOUT" ? -1 : event.index;
    var correctIndex = expectedIndex(question);
    var choices = question && question.c ? question.c : [];
    var submitted = submittedIndex >= 0 && submittedIndex < choices.length
      ? (submittedIndex + 1) + ". " + choices[submittedIndex]
      : "No answer (timeout)";
    var expected = correctIndex >= 0 && correctIndex < choices.length
      ? (correctIndex + 1) + ". " + choices[correctIndex]
      : "Unavailable";
    var outcome = state.outcome || {};
    var resultLabel = outcome.correct ? "Correct" : outcome.blocked ? "Wrong — Guardrail blocked the hit" : "Wrong";
    return {
      result: resultLabel,
      action: actionLabel(state.selectedAction),
      submitted: submitted,
      expected: expected,
      explanation: question && question.x ? question.x : "No explanation provided.",
      stabilityBefore: previous.stability,
      stabilityAfter: state.stability,
      momentumBefore: previous.momentum,
      momentumAfter: state.momentum,
      guardrailBefore: previous.guardrail,
      guardrailAfter: state.guardrail,
      hpBefore: previous.playerHp,
      hpAfter: state.playerHp,
      blocked: !!outcome.blocked,
      correct: !!outcome.correct,
      reason: outcome.reason || event.type.toLowerCase(),
      next: predictedNext(state),
    };
  }

  function resultAnnouncement(result) {
    return "Result: " + result.result + ". Submitted answer: " + result.submitted +
      ". Expected answer: " + result.expected + ". Explanation: " + result.explanation +
      ". Stability " + result.stabilityBefore + " to " + result.stabilityAfter +
      " (" + signed(result.stabilityAfter - result.stabilityBefore) + "). Momentum " +
      result.momentumBefore + " to " + result.momentumAfter + " (" +
      signed(result.momentumAfter - result.momentumBefore) + "). Guardrail " +
      (result.guardrailBefore ? "active" : "inactive") + " to " +
      (result.guardrailAfter ? "active" : "inactive") +
      (result.blocked ? "; hit blocked" : "; no block") + ". HP " + result.hpBefore +
      " to " + result.hpAfter + " (" + signed(result.hpAfter - result.hpBefore) +
      "). Next phase: " + result.next + ".";
  }

  function visualSeed(index, salt) {
    var n = ((transitionNumber + 1) * 1103515245 + (index + 3) * 12345 + salt * 2654435761) >>> 0;
    return (n % 10000) / 10000;
  }

  function addParticle(particle) {
    if (reducedMotion) return;
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particle.life = Math.max(1, Math.min(60, particle.life || 24));
    particle.maxLife = particle.life;
    particles.push(particle);
  }

  function burst(x, y, count, color, salt, travel) {
    if (reducedMotion) return;
    count = Math.min(count, MAX_PARTICLES);
    for (var i = 0; i < count; i++) {
      var angle = visualSeed(i, salt) * Math.PI * 2;
      var speed = travel ? 1.2 + visualSeed(i, salt + 1) * 2.4 : 0;
      addParticle({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (travel ? 0.8 : 0),
        life: 18 + Math.floor(visualSeed(i, salt + 2) * 18),
        size: 2 + Math.floor(visualSeed(i, salt + 3) * 3),
        color: color,
      });
    }
  }

  function setCue(kind, text, duration) {
    caption = text;
    if (reducedMotion) {
      cue = null;
      return;
    }
    cue = { kind: kind, start: arenaFrame, end: arenaFrame + Math.min(90, duration || 36) };
  }

  function applyTransitionVisuals(previous, state, event, effects) {
    var rejected = effects.some(function (effect) { return effect.type === "ACTION_REJECTED"; });
    if (event.type === "START_TURN" && state !== previous) {
      caption = state.boss ? "PHASE " + (state.bossPhase + 1) + " // SELECT RESPONSE" : "SELECT INCIDENT RESPONSE";
      cue = null;
      particles = [];
      cameraShake = 0;
    } else if (event.type === "SELECT_ACTION" && rejected) {
      setCue("rejected", "ACTION REJECTED // INSUFFICIENT MOMENTUM", 22);
    } else if (event.type === "SELECT_ACTION" && state !== previous) {
      var selected = state.selectedAction;
      setCue(selected, ACTION_META[selected].caption, selected === "escalate" ? 52 : 38);
      if (selected === "query") burst(170, 310, 8, COLORS.cyan, 1, true);
      if (selected === "inspect") burst(400, 190, 12, COLORS.amber, 2, false);
      if (selected === "patch") burst(130, 320, 14, COLORS.success, 3, false);
      if (selected === "escalate") burst(400, 205, 24, COLORS.coral, 4, true);
    } else if ((event.type === "SUBMIT_ANSWER" || event.type === "TIMEOUT") && state !== previous) {
      if (state.outcome && state.outcome.correct) {
        setCue("correct", "ROUTE RECONFIGURED // STABILITY DOWN", 42);
        cameraShake = reducedMotion ? 0 : 3;
        burst(400, 205, 14, COLORS.cyan, 5, true);
      } else if (state.outcome && state.outcome.blocked) {
        setCue("blocked", "GUARDRAIL BLOCK // HP PRESERVED", 42);
        burst(130, 320, 16, COLORS.success, 6, false);
      } else {
        setCue("damage", "INCIDENT IMPACT // HP DOWN", 42);
        cameraShake = reducedMotion ? 0 : 6;
        burst(130, 320, 14, COLORS.coral, 7, true);
      }
    } else if (event.type === "RESOLUTION_COMPLETE" && state !== previous) {
      if (state.phase === "phase-shift") {
        setCue("phase", "BOUNDARY EXPANDED // PHASE " + (state.bossPhase + 1), 70);
        burst(400, 205, 28, COLORS.amber, 8, true);
      } else if (state.phase === "victory") {
        setCue("victory", "INCIDENT RESOLVED // VICTORY", 80);
        burst(400, 300, 40, COLORS.success, 9, true);
      } else if (state.phase === "defeat") {
        setCue("defeat", "SERVICE LOST // DEFEAT", 60);
      }
    }
  }

  function audioConstructor() {
    return window.AudioContext || window.webkitAudioContext;
  }

  function ensureAudio() {
    if (audioContext && audioContext.state !== "closed") return true;
    var Ctor = audioConstructor();
    if (typeof Ctor !== "function") {
      audioAvailable = false;
      return false;
    }
    try {
      audioContext = new Ctor();
      audioAvailable = true;
      return true;
    } catch (_) {
      audioContext = null;
      audioAvailable = false;
      return false;
    }
  }

  api.unlockAudio = function () {
    if (muted || !ensureAudio()) return false;
    audioUnlocked = true;
    try {
      if (audioContext.state === "suspended" && typeof audioContext.resume === "function") {
        var resumed = audioContext.resume();
        if (resumed && typeof resumed.catch === "function") resumed.catch(function () {});
      }
    } catch (_) {}
    return true;
  };

  function removeVoice(voice) {
    var index = voices.indexOf(voice);
    if (index >= 0) voices.splice(index, 1);
  }

  function stopVoice(voice) {
    if (!voice) return;
    try { voice.oscillator.onended = null; voice.oscillator.stop(); } catch (_) {}
    try { voice.oscillator.disconnect(); } catch (_) {}
    try { voice.gain.disconnect(); } catch (_) {}
    removeVoice(voice);
  }

  function playTone(frequency, duration, type, volume) {
    if (muted || !audioUnlocked || !ensureAudio() || !audioContext || audioContext.state === "suspended") return;
    while (voices.length >= MAX_VOICES) stopVoice(voices[0]);
    try {
      var oscillator = audioContext.createOscillator();
      var gain = audioContext.createGain();
      var now = audioContext.currentTime;
      oscillator.type = type || "square";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume || 0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      var voice = { oscillator: oscillator, gain: gain };
      voices.push(voice);
      oscillator.onended = function () { removeVoice(voice); };
      oscillator.start(now);
      oscillator.stop(now + duration);
      toneStarts++;
    } catch (_) {}
  }

  function delayedTone(delay, frequency, duration, type, volume) {
    if (muted || !audioUnlocked || delayedTones.size >= MAX_DELAYED_TONES) return;
    var timer = window.setTimeout(function () {
      delayedTones.delete(timer);
      playTone(frequency, duration, type, volume);
    }, Math.max(0, delay));
    delayedTones.add(timer);
  }

  var CUE_TONES = {
    navigate: [[0, 760, 0.045, "square", 0.025]],
    confirm: [[0, 620, 0.07, "triangle", 0.035]],
    rejected: [[0, 180, 0.14, "sawtooth", 0.035]],
    query: [[0, 520, 0.06, "square", 0.035], [55, 760, 0.08, "square", 0.035]],
    inspect: [[0, 440, 0.07, "triangle", 0.035], [65, 880, 0.09, "triangle", 0.035]],
    patch: [[0, 330, 0.08, "triangle", 0.035], [70, 520, 0.12, "triangle", 0.035]],
    escalate: [[0, 260, 0.06, "sawtooth", 0.035], [55, 440, 0.07, "sawtooth", 0.04], [110, 700, 0.12, "square", 0.045]],
    correct: [[0, 780, 0.08, "square", 0.04], [75, 1040, 0.12, "triangle", 0.045]],
    wrong: [[0, 210, 0.18, "sawtooth", 0.04]],
    blocked: [[0, 520, 0.07, "triangle", 0.04], [60, 520, 0.09, "triangle", 0.04]],
    phase: [[0, 390, 0.07, "triangle", 0.035], [70, 520, 0.08, "triangle", 0.04], [140, 660, 0.12, "triangle", 0.045]],
    victory: [[0, 520, 0.10, "triangle", 0.04], [90, 660, 0.10, "triangle", 0.04], [180, 780, 0.18, "triangle", 0.045]],
    defeat: [[0, 280, 0.20, "sawtooth", 0.035], [150, 210, 0.24, "sawtooth", 0.035]],
  };

  api.playCue = function (name) {
    var sequence = CUE_TONES[name];
    if (!sequence || muted || !audioUnlocked) return;
    for (var i = 0; i < sequence.length; i++) {
      var tone = sequence[i];
      delayedTone(tone[0], tone[1], tone[2], tone[3], tone[4]);
    }
  };

  api.stopAllAudio = function () {
    delayedTones.forEach(function (timer) { window.clearTimeout(timer); });
    delayedTones.clear();
    while (voices.length) stopVoice(voices[0]);
  };

  api.setMuted = function (value) {
    muted = !!value;
    if (muted) api.stopAllAudio();
  };

  api.suspend = function () {
    api.stopAllAudio();
    clearMotionState();
  };

  api.syncTransition = function (battle, previous, event, effects) {
    if (!battle || !battle.agentOps || !previous || !event) return;
    var state = battle.agentOps;
    effects = effects || [];
    var changed = state !== previous;
    var rejected = effects.find(function (effect) { return effect.type === "ACTION_REJECTED"; });

    if (changed || rejected) transitionNumber++;
    applyTransitionVisuals(previous, state, event, effects);

    if (event.type === "START_TURN" && changed) {
      turnNumber++;
      var encounter = turnNumber === 1
        ? "Agent Operations encounter with " + humanSlug(npcSlug || (battle.npc && battle.npc.slug)) + ". "
        : "Turn " + turnNumber + ". ";
      var phase = state.boss
        ? "Boss phase " + (state.bossPhase + 1) + " of " + state.bossPhases + ", " + PHASE_LABELS[state.bossPhase] + ". "
        : "Regular incident. ";
      api.announce("turn:" + turnNumber + ":" + (state.question && state.question.id),
        encounter + phase + "Stability " + state.stability + " of " + state.maxStability +
        ". Momentum " + state.momentum + ". Guardrail " + (state.guardrail ? "active" : "inactive") +
        ". " + questionAnnouncement(state.question) + " Choose an action: 1 Query, 2 Inspect, 3 Patch, 4 Escalate.");
      return;
    }

    if (event.type === "SELECT_ACTION") {
      if (rejected) {
        api.playCue("rejected");
        api.announce("reject:" + state.phase + ":" + event.action + ":" + state.momentum,
          "Action rejected: " + actionLabel(event.action) + ". " +
          (rejected.reason === "insufficient_momentum"
            ? "Needs " + rejected.needed + " Momentum; available " + rejected.available + "."
            : "Action is unavailable in this phase."));
      } else if (changed) {
        var selected = state.selectedAction;
        var spec = window.DatamonBattleOps.ACTIONS[selected];
        api.playCue(selected);
        var extra = selected === "inspect" && state.eliminated.length
          ? " Disabled choices: " + state.eliminated.map(function (index) { return index + 1; }).join(" and ") + "."
          : selected === "patch" ? " Guardrail active." : "";
        api.announce("action:" + turnNumber + ":" + selected,
          "Action selected: " + spec.label + ". Cost " + spec.cost + " Momentum. Momentum " +
          previous.momentum + " to " + state.momentum + "." + extra + " Answer using choices 1 through 4.");
      }
      return;
    }

    if (event.type === "SUBMIT_ANSWER" || event.type === "TIMEOUT") {
      if (changed && state.phase === "resolve" && state.outcome) {
        lastResult = buildResult(previous, state, event);
        api.playCue(lastResult.correct ? "correct" : lastResult.blocked ? "blocked" : "wrong");
        api.announce("result:" + turnNumber + ":" + state.outcome.reason + ":" + state.outcome.index,
          resultAnnouncement(lastResult));
      } else {
        var submitted = event.type === "TIMEOUT" ? "No answer" : "Choice " + (Number(event.index) + 1);
        api.announce("answer-rejected:" + state.phase + ":" + String(event.index),
          "Answer rejected: " + submitted + " is unavailable or the answer phase is locked.");
      }
      return;
    }

    if (event.type === "RESOLUTION_COMPLETE" && changed) {
      if (lastResult) lastResult.next = state.phase === "feedback"
        ? "Next question after feedback"
        : state.phase === "phase-shift"
          ? "Boss phase " + (state.bossPhase + 1) + " — " + PHASE_LABELS[state.bossPhase]
          : state.phase === "victory" ? "Victory" : "Defeat";
      if (state.phase === "phase-shift") {
        api.playCue("phase");
        api.announce("phase:" + state.bossPhase,
          "Boss phase " + (state.bossPhase + 1) + " of " + state.bossPhases + ": " +
          PHASE_LABELS[state.bossPhase] + ". Stability reset to " + state.stability +
          ". Momentum " + state.momentum + ". Guardrail " + (state.guardrail ? "active" : "inactive") + ".");
      } else if (state.phase === "victory") {
        api.playCue("victory");
        api.announce("terminal:victory", "Victory. Incident resolved. Final HP " + state.playerHp +
          ", Stability " + state.stability + ", Momentum " + state.momentum +
          ", Guardrail " + (state.guardrail ? "active" : "inactive") + ".");
      } else if (state.phase === "defeat") {
        api.playCue("defeat");
        api.announce("terminal:defeat", "Defeat. Player HP is zero. Stability " + state.stability +
          ", Momentum " + state.momentum + ", Guardrail " + (state.guardrail ? "active" : "inactive") + ".");
      } else {
        api.announce("phase:feedback:" + turnNumber,
          "Feedback phase. Review the submitted answer, expected answer, explanation, and economy changes. Press Enter for the next question.");
      }
      return;
    }

    if (event.type === "RUN" && changed && state.phase === "escaped") {
      api.playCue("confirm");
      api.announce("terminal:escaped", "Encounter ended. You fled safely; no answer was submitted.");
    }
  };

  api.announceActionFocus = function (battle) {
    if (!battle || !battle.agentOps) return;
    var index = battle.agentOpsSel || 0;
    var name = window.DatamonBattleOps.ACTION_KEYS[index];
    var spec = window.DatamonBattleOps.ACTIONS[name];
    var enabled = battle.agentOps.momentum >= spec.cost;
    api.announce("action-focus:" + turnNumber + ":" + index,
      "Action " + (index + 1) + ": " + spec.label + ". Cost " + spec.cost + " Momentum. " +
      (enabled ? "Available." : "Disabled; insufficient Momentum."));
  };

  api.announceChoiceFocus = function (battle) {
    if (!battle || !battle.agentOps || !battle.agentOps.question) return;
    var index = battle.agentOpsChoiceSel || 0;
    var choice = battle.agentOps.question.c[index];
    api.announce("choice-focus:" + turnNumber + ":" + index,
      "Choice " + (index + 1) + ": " + choice + ".");
  };

  api.setHover = function (kind, index, pressed) {
    hover = { kind: kind || null, index: Number.isInteger(index) ? index : -1, pressed: !!pressed };
  };

  api.setOptionalLayers = function (layers) {
    optionalLayers = Object.create(null);
    layers = layers || {};
    OPTIONAL_LAYER_NAMES.forEach(function (name) {
      var image = layers[name];
      if (image && typeof image === "object" && image.width > 0 && image.height > 0) optionalLayers[name] = image;
    });
  };

  api.setDrawTrainer = function (fn) { drawTrainer = typeof fn === "function" ? fn : null; };

  api.init = function (config) {
    config = config || {};
    installMotionListener();
    reducedMotion = currentReducedMotion();
    api.stopAllAudio();
    particles = [];
    cue = null;
    caption = "INCIDENT CHANNEL OPEN";
    cameraShake = 0;
    arenaFrame = 0;
    turnNumber = 0;
    transitionNumber = 0;
    lastResult = null;
    hover = { kind: null, index: -1, pressed: false };
    frameSamples = [];
    lastEntranceOffset = 0;
    announcedKeys = [];
    announcedKeySet = new Set();
    lastAnnouncement = "";
    announcementCount = 0;
    playerSlug = config.playerSlug || null;
    npcSlug = config.npcSlug || null;
    muted = !!config.muted;
  };

  api.reset = function () {
    api.stopAllAudio();
    clearMotionState();
    turnNumber = 0;
    transitionNumber = 0;
    lastResult = null;
    hover = { kind: null, index: -1, pressed: false };
    frameSamples = [];
    announcedKeys = [];
    announcedKeySet = new Set();
  };

  function drawOptional(ctx, name) {
    var image = optionalLayers[name];
    if (!image) return false;
    try {
      ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, W, H);
      return true;
    } catch (_) {
      return false;
    }
  }

  function panel(ctx, x, y, w, h, border) {
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = border || COLORS.cobalt;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  function drawBackWall(ctx) {
    if (drawOptional(ctx, "backWall")) return;
    var gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "#030b18");
    gradient.addColorStop(0.64, COLORS.midnight);
    gradient.addColorStop(1, "#050a13");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(47,111,237,0.07)";
    ctx.fillRect(0, 84, W, 4);
    ctx.fillRect(0, 340, W, 3);
    ctx.strokeStyle = "rgba(69,215,232,0.16)";
    ctx.lineWidth = 2;
    for (var i = 0; i < 8; i++) {
      var x = 28 + i * 98;
      ctx.strokeRect(x, 12, 72, 58);
      ctx.beginPath();
      ctx.moveTo(x + 36, 12); ctx.lineTo(x + 36, 70);
      ctx.moveTo(x, 41); ctx.lineTo(x + 72, 41);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(243,111,91,0.12)";
    ctx.fillRect(0, 86, W, 6);
    ctx.fillStyle = COLORS.coral;
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "left";
    ctx.fillText("INCIDENT MODE", 18, 101);
    ctx.textAlign = "right";
    ctx.fillText("AUTHORIZED OPS ONLY", W - 18, 101);
  }

  function topologyNodes(maxStability) {
    var all = [
      [400, 211, "CORE"],
      [329, 171, "TOOL"],
      [471, 171, "MODEL"],
      [315, 251, "STATE"],
      [485, 251, "OUTPUT"],
    ];
    return all.slice(0, Math.max(1, Math.min(all.length, maxStability)));
  }

  function drawNode(ctx, node, active, root) {
    var x = node[0], y = node[1];
    ctx.lineWidth = 2;
    if (active) {
      ctx.fillStyle = root ? COLORS.amber : COLORS.cyan;
      ctx.strokeStyle = COLORS.bone;
      ctx.beginPath();
      if (root) {
        ctx.moveTo(x, y - 9); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 9, y); ctx.closePath();
      } else {
        ctx.rect(x - 7, y - 7, 14, 14);
      }
      ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = "#172033";
      ctx.strokeStyle = COLORS.coral;
      ctx.beginPath(); ctx.rect(x - 7, y - 7, 14, 14); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5);
      ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5);
      ctx.stroke();
    }
    ctx.fillStyle = active ? COLORS.text : COLORS.disabled;
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(node[2], x, y + 20);
  }

  function drawBoard(ctx, state) {
    if (drawOptional(ctx, "incidentBoard")) return;
    var x = 220, y = 112, w = 360, h = 214;
    ctx.fillStyle = "rgba(5,16,31,0.91)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS.cobalt;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = "rgba(69,215,232,0.38)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);

    ctx.fillStyle = COLORS.cyan;
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SERVICE TOPOLOGY // REMAINING STABILITY", x + w / 2, y + 16);

    var nodes = topologyNodes(state.maxStability);
    ctx.strokeStyle = "rgba(69,215,232,0.34)";
    ctx.lineWidth = 2;
    for (var i = 1; i < nodes.length; i++) {
      var endpointActive = i < state.stability && state.stability > 0;
      ctx.setLineDash(endpointActive ? [] : [4, 5]);
      ctx.beginPath();
      ctx.moveTo(nodes[0][0], nodes[0][1]);
      ctx.lineTo(nodes[i][0], nodes[i][1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (var n = 0; n < nodes.length; n++) drawNode(ctx, nodes[n], n < state.stability, n === 0);

    var barX = x + 28, barY = y + h - 27, barW = w - 56;
    ctx.fillStyle = "#172033";
    ctx.fillRect(barX, barY, barW, 10);
    ctx.fillStyle = state.stability > 0 ? COLORS.amber : COLORS.disabled;
    ctx.fillRect(barX, barY, barW * (state.stability / state.maxStability), 10);
    ctx.strokeStyle = COLORS.bone;
    ctx.strokeRect(barX, barY, barW, 10);
    ctx.fillStyle = COLORS.bone;
    ctx.font = "bold 10px monospace";
    ctx.fillText("STABILITY " + state.stability + "/" + state.maxStability, x + w / 2, barY - 5);
  }

  function drawPhaseCards(ctx, state) {
    if (!state.boss) return;
    var width = 112, gap = 7, start = 225;
    for (var i = 0; i < state.bossPhases; i++) {
      var x = start + i * (width + gap);
      var active = i === state.bossPhase;
      var complete = i < state.bossPhase;
      ctx.fillStyle = active ? "rgba(243,111,91,0.22)" : complete ? "rgba(74,222,128,0.14)" : "rgba(8,20,38,0.86)";
      ctx.fillRect(x, 64, width, 37);
      ctx.strokeStyle = active ? COLORS.coral : complete ? COLORS.success : COLORS.disabled;
      ctx.lineWidth = active ? 2 : 1;
      ctx.strokeRect(x, 64, width, 37);
      ctx.fillStyle = active ? COLORS.coral : complete ? COLORS.success : COLORS.dim;
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText((complete ? "✓ " : active ? "◆ " : "○ ") + "PHASE " + (i + 1), x + width / 2, 77);
      ctx.font = "8px monospace";
      ctx.fillText(PHASE_LABELS[i], x + width / 2, 92);
    }
  }

  function drawCommandTable(ctx) {
    if (drawOptional(ctx, "commandTable")) return;
    ctx.fillStyle = "rgba(47,111,237,0.12)";
    ctx.fillRect(58, 327, W - 116, 16);
    ctx.strokeStyle = "rgba(69,215,232,0.32)";
    ctx.strokeRect(58, 327, W - 116, 16);
    ctx.fillStyle = "rgba(8,20,38,0.82)";
    ctx.beginPath();
    ctx.moveTo(88, 343); ctx.lineTo(712, 343); ctx.lineTo(756, 392); ctx.lineTo(44, 392); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(47,111,237,0.28)";
    ctx.stroke();
  }

  function drawTrainers(ctx, battle) {
    if (!drawTrainer) return;
    var progress = reducedMotion ? 1 : Math.max(0, Math.min(1, (arenaFrame - battle.startF) / 28));
    var eased = 1 - Math.pow(1 - progress, 3);
    var offset = (1 - eased) * 210;
    lastEntranceOffset = reducedMotion ? 0 : offset;
    var playerX = 126 - offset;
    var opponentX = 674 + offset;

    ctx.fillStyle = "rgba(47,111,237,0.22)";
    ctx.beginPath(); ctx.ellipse(playerX, 342, 78, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(opponentX, 318, 78, 15, 0, 0, Math.PI * 2); ctx.fill();

    drawTrainer(battle.npc.slug, opponentX, 326, 180, reducedMotion ? 0 : 2);
    drawTrainer(playerSlug, playerX, 354, 144, 0);

    ctx.fillStyle = COLORS.bone;
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(humanSlug(playerSlug).split(" ")[0] + " // OPERATOR", playerX, 374);
    ctx.fillText(humanSlug(battle.npc.slug).split(" ")[0] + " // INCIDENT LEAD", opponentX, 344);
  }

  function drawStatus(ctx, state) {
    var y = 350;
    panel(ctx, 206, y, 388, 41, COLORS.cobalt);
    ctx.textAlign = "left";
    ctx.font = "bold 9px monospace";

    ctx.fillStyle = COLORS.amber;
    ctx.beginPath(); ctx.moveTo(224, y + 28); ctx.lineTo(233, y + 10); ctx.lineTo(242, y + 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.fillText("MOMENTUM " + state.momentum + "/3", 250, y + 17);
    for (var i = 0; i < 3; i++) {
      ctx.fillStyle = i < state.momentum ? COLORS.amber : COLORS.disabled;
      ctx.fillRect(250 + i * 24, y + 23, 18, 8);
    }

    drawGlyph(ctx, "shield", 369, y + 20, 10, state.guardrail ? COLORS.success : COLORS.disabled);
    ctx.fillStyle = COLORS.text;
    ctx.fillText("GUARDRAIL " + (state.guardrail ? "ACTIVE" : "OFF"), 386, y + 23);

    ctx.fillStyle = COLORS.coral;
    ctx.fillText("♥", 503, y + 24);
    ctx.fillStyle = COLORS.text;
    ctx.fillText("HP " + state.playerHp + "/100", 520, y + 23);
  }

  function drawGlyph(ctx, shape, x, y, size, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (shape === "diamond") {
      ctx.moveTo(x, y - size); ctx.lineTo(x + size, y); ctx.lineTo(x, y + size); ctx.lineTo(x - size, y); ctx.closePath();
    } else if (shape === "hexagon") {
      for (var i = 0; i < 6; i++) {
        var angle = i * Math.PI / 3;
        var hx = x + Math.cos(angle) * size, hy = y + Math.sin(angle) * size;
        if (!i) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
    } else if (shape === "shield") {
      ctx.moveTo(x, y - size); ctx.lineTo(x + size, y - size / 2); ctx.lineTo(x + size * 0.65, y + size * 0.7);
      ctx.lineTo(x, y + size); ctx.lineTo(x - size * 0.65, y + size * 0.7); ctx.lineTo(x - size, y - size / 2); ctx.closePath();
    } else {
      ctx.moveTo(x - size, y - size); ctx.lineTo(x + size, y); ctx.lineTo(x - size, y + size);
      ctx.moveTo(x, y - size); ctx.lineTo(x + size * 2, y); ctx.lineTo(x, y + size);
    }
    if (shape === "chevron") ctx.stroke(); else { ctx.fill(); ctx.stroke(); }
  }

  var measureCanvas = null;
  var measureContext = null;
  function wrap(text, width, font) {
    if (!measureCanvas) {
      measureCanvas = document.createElement("canvas");
      measureContext = measureCanvas.getContext("2d");
    }
    measureContext.font = font;
    var words = String(text || "").split(/\s+/);
    var lines = [], line = "";
    words.forEach(function (word) {
      var candidate = line ? line + " " + word : word;
      if (line && measureContext.measureText(candidate).width > width) {
        lines.push(line); line = word;
      } else line = candidate;
    });
    if (line) lines.push(line);
    return lines;
  }

  function drawWrapped(ctx, text, x, y, width, lineHeight, maxLines, font) {
    var lines = wrap(text, width, font);
    ctx.font = font;
    for (var i = 0; i < Math.min(lines.length, maxLines); i++) {
      var value = lines[i];
      if (i === maxLines - 1 && lines.length > maxLines) value = value.replace(/[.…]*$/, "") + "…";
      ctx.fillText(value, x, y + i * lineHeight);
    }
    return Math.min(lines.length, maxLines);
  }

  function drawQuestionHeader(ctx, state, title) {
    panel(ctx, 12, 398, 776, 202, COLORS.cobalt);
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.cyan;
    ctx.font = "bold 10px monospace";
    ctx.fillText(title, 24, 415);
    ctx.fillStyle = COLORS.amber;
    drawWrapped(ctx, (state.question && state.question.q) || "Question unavailable", 24, 433, 650, 14, 3, "bold 11px monospace");
    drawRun(ctx);
  }

  function drawRun(ctx) {
    var r = api.runRect();
    ctx.fillStyle = "rgba(243,111,91,0.12)";
    ctx.fillRect(r[0], r[1], r[2], r[3]);
    ctx.strokeStyle = COLORS.coral;
    ctx.lineWidth = 1;
    ctx.strokeRect(r[0], r[1], r[2], r[3]);
    ctx.fillStyle = COLORS.coral;
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("R  RUN", r[0] + r[2] / 2, r[1] + 17);
  }

  function drawActions(ctx, state, battle) {
    drawQuestionHeader(ctx, state, "QUESTION READY // CHOOSE INCIDENT RESPONSE");
    var rects = api.actionRects();
    var names = window.DatamonBattleOps.ACTION_KEYS;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i], name = names[i], spec = window.DatamonBattleOps.ACTIONS[name];
      var enabled = state.momentum >= spec.cost;
      var selected = i === battle.agentOpsSel;
      var hovered = hover.kind === "action" && hover.index === i;
      var pressed = hovered && hover.pressed;
      ctx.fillStyle = pressed ? "rgba(242,179,93,0.30)" : selected || hovered ? "rgba(242,179,93,0.18)" : enabled ? "rgba(15,31,53,0.96)" : "rgba(8,20,38,0.70)";
      ctx.fillRect(r[0], r[1], r[2], r[3]);
      ctx.strokeStyle = selected ? COLORS.amber : hovered ? COLORS.cyan : enabled ? COLORS.cobalt : COLORS.disabled;
      ctx.lineWidth = selected ? 3 : hovered ? 2 : 1;
      if (!enabled) ctx.setLineDash([5, 4]);
      ctx.strokeRect(r[0], r[1], r[2], r[3]);
      ctx.setLineDash([]);

      drawGlyph(ctx, ACTION_META[name].shape, r[0] + 24, r[1] + 28, 11, enabled ? selected ? COLORS.amber : COLORS.cyan : COLORS.disabled);
      ctx.textAlign = "left";
      ctx.fillStyle = enabled ? COLORS.text : COLORS.disabled;
      ctx.font = "bold 12px monospace";
      ctx.fillText((i + 1) + "  " + spec.label.toUpperCase(), r[0] + 46, r[1] + 20);
      ctx.fillStyle = enabled ? COLORS.dim : COLORS.coral;
      ctx.font = "10px monospace";
      ctx.fillText(spec.desc, r[0] + 46, r[1] + 39);
      ctx.textAlign = "right";
      ctx.fillStyle = enabled ? COLORS.amber : COLORS.coral;
      ctx.font = "bold 9px monospace";
      ctx.fillText(enabled ? "AVAILABLE" : "LOCKED", r[0] + r[2] - 10, r[1] + 18);
    }
  }

  function drawChoices(ctx, state, battle) {
    drawQuestionHeader(ctx, state, "ACTION: " + actionLabel(state.selectedAction).toUpperCase() + " // CHOOSE ANSWER");
    var rects = api.choiceRects();
    var eliminated = state.eliminated || [];
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      var disabled = eliminated.indexOf(i) >= 0;
      var selected = i === battle.agentOpsChoiceSel && !disabled;
      var hovered = hover.kind === "choice" && hover.index === i;
      ctx.fillStyle = disabled ? "rgba(71,85,105,0.28)" : selected || hovered ? "rgba(242,179,93,0.17)" : "rgba(15,31,53,0.96)";
      ctx.fillRect(r[0], r[1], r[2], r[3]);
      ctx.strokeStyle = disabled ? COLORS.coral : selected ? COLORS.amber : hovered ? COLORS.cyan : COLORS.cobalt;
      ctx.lineWidth = selected ? 3 : hovered ? 2 : 1;
      if (disabled) ctx.setLineDash([4, 4]);
      ctx.strokeRect(r[0], r[1], r[2], r[3]);
      ctx.setLineDash([]);

      ctx.textAlign = "left";
      ctx.fillStyle = disabled ? COLORS.disabled : selected ? COLORS.amber : COLORS.text;
      var prefix = disabled ? "✕ " + (i + 1) + ". " : (i + 1) + ". ";
      drawWrapped(ctx, prefix + ((state.question && state.question.c[i]) || ""), r[0] + 12, r[1] + 19, r[2] - 24, 14, 2, "11px monospace");
      if (disabled) {
        ctx.textAlign = "right";
        ctx.fillStyle = COLORS.coral;
        ctx.font = "bold 8px monospace";
        ctx.fillText("DISABLED BY INSPECT", r[0] + r[2] - 8, r[1] + r[3] - 6);
      }
    }
  }

  function drawEconomyLine(ctx, label, before, after, x, y, color) {
    ctx.fillStyle = color;
    ctx.font = "bold 10px monospace";
    ctx.fillText(label + " " + before + " → " + after + " (" + signed(after - before) + ")", x, y);
  }

  function drawFeedback(ctx, state) {
    var result = lastResult;
    panel(ctx, 12, 398, 776, 202, result && result.correct ? COLORS.success : result && result.blocked ? COLORS.amber : COLORS.coral);
    ctx.textAlign = "left";
    if (!result) {
      ctx.fillStyle = COLORS.text;
      ctx.font = "bold 14px monospace";
      ctx.fillText("RESOLUTION PENDING", 28, 428);
      return;
    }

    ctx.fillStyle = result.correct ? COLORS.success : result.blocked ? COLORS.amber : COLORS.coral;
    ctx.font = "bold 13px monospace";
    ctx.fillText((result.correct ? "✓ " : result.blocked ? "◇ " : "✕ ") + result.result.toUpperCase() + " // " + result.action.toUpperCase(), 28, 420);

    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 10px monospace";
    ctx.fillText("SUBMITTED:", 28, 440);
    drawWrapped(ctx, result.submitted, 112, 440, 640, 13, 1, "10px monospace");
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 10px monospace";
    ctx.fillText("EXPECTED:", 28, 457);
    drawWrapped(ctx, result.expected, 112, 457, 640, 13, 1, "10px monospace");

    ctx.fillStyle = COLORS.cyan;
    ctx.font = "bold 10px monospace";
    ctx.fillText("WHY:", 28, 476);
    ctx.fillStyle = COLORS.dim;
    drawWrapped(ctx, result.explanation, 68, 476, 684, 13, 2, "10px monospace");

    drawEconomyLine(ctx, "STABILITY", result.stabilityBefore, result.stabilityAfter, 28, 516, COLORS.amber);
    drawEconomyLine(ctx, "MOMENTUM", result.momentumBefore, result.momentumAfter, 220, 516, COLORS.amber);
    ctx.fillStyle = result.blocked ? COLORS.success : COLORS.text;
    ctx.font = "bold 10px monospace";
    ctx.fillText("GUARDRAIL " + (result.guardrailBefore ? "ACTIVE" : "OFF") + " → " +
      (result.guardrailAfter ? "ACTIVE" : "OFF") + (result.blocked ? " (BLOCKED)" : " (NO BLOCK)"), 420, 516);
    drawEconomyLine(ctx, "HP", result.hpBefore, result.hpAfter, 28, 537, COLORS.coral);

    ctx.fillStyle = COLORS.cyan;
    ctx.font = "bold 10px monospace";
    ctx.fillText("NEXT PHASE: " + result.next.toUpperCase(), 28, 559);
    ctx.fillStyle = COLORS.dim;
    ctx.font = "9px monospace";
    ctx.fillText("ENTER / CLICK TO CONTINUE", 28, 581);
  }

  function drawStateCard(ctx, state) {
    panel(ctx, 12, 398, 776, 202, state.phase === "victory" ? COLORS.success : state.phase === "defeat" ? COLORS.coral : COLORS.amber);
    ctx.textAlign = "center";
    var title = state.phase === "phase-shift" ? "BOUNDARY EXPANDED" : state.phase === "victory" ? "INCIDENT RESOLVED" : "SERVICE LOST";
    ctx.fillStyle = state.phase === "victory" ? COLORS.success : state.phase === "defeat" ? COLORS.coral : COLORS.amber;
    ctx.font = "bold 24px monospace";
    ctx.fillText(title, W / 2, 442);
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 13px monospace";
    if (state.phase === "phase-shift") {
      ctx.fillText("PHASE " + (state.bossPhase + 1) + "/" + state.bossPhases + " // " + PHASE_LABELS[state.bossPhase], W / 2, 472);
      ctx.fillText("STABILITY RESET " + state.stability + "/" + state.maxStability + " · MOMENTUM " + state.momentum + " · GUARDRAIL " + (state.guardrail ? "ACTIVE" : "OFF"), W / 2, 500);
      ctx.fillText("ENTER TO RECEIVE THE NEXT QUESTION", W / 2, 548);
    } else {
      ctx.fillText("HP " + state.playerHp + " · STABILITY " + state.stability + " · MOMENTUM " + state.momentum + " · GUARDRAIL " + (state.guardrail ? "ACTIVE" : "OFF"), W / 2, 486);
      ctx.fillText(state.phase === "victory" ? "ENTER TO RETURN TO THE OFFICE" : "ENTER TO REBOOT IN THE LOUNGE", W / 2, 536);
    }
  }

  function drawCaption(ctx) {
    ctx.fillStyle = "rgba(3,7,19,0.90)";
    ctx.fillRect(260, 304, 280, 18);
    ctx.strokeStyle = COLORS.cobalt;
    ctx.strokeRect(260, 304, 280, 18);
    ctx.fillStyle = COLORS.cyan;
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(caption, 400, 317);
  }

  function drawCue(ctx) {
    if (!cue || reducedMotion) return;
    var progress = Math.max(0, Math.min(1, (arenaFrame - cue.start) / Math.max(1, cue.end - cue.start)));
    if (arenaFrame > cue.end) { cue = null; return; }
    ctx.save();
    if (cue.kind === "query" || cue.kind === "escalate" || cue.kind === "correct") {
      ctx.strokeStyle = cue.kind === "escalate" ? COLORS.coral : COLORS.cyan;
      ctx.lineWidth = cue.kind === "escalate" ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(175, 310);
      ctx.lineTo(175 + 225 * progress, 310 - 102 * progress);
      ctx.stroke();
    } else if (cue.kind === "inspect") {
      ctx.strokeStyle = COLORS.amber;
      ctx.lineWidth = 2;
      ctx.strokeRect(245 + progress * 55, 138 + progress * 30, 310 - progress * 110, 142 - progress * 60);
    } else if (cue.kind === "patch" || cue.kind === "blocked") {
      ctx.strokeStyle = COLORS.success;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(126, 292, 24 + progress * 10, Math.PI, Math.PI * 2); ctx.stroke();
    } else if (cue.kind === "damage") {
      ctx.strokeStyle = COLORS.coral;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(106, 274); ctx.lineTo(146, 314); ctx.moveTo(146, 274); ctx.lineTo(106, 314); ctx.stroke();
    } else if (cue.kind === "phase") {
      ctx.strokeStyle = COLORS.amber;
      ctx.lineWidth = 3;
      ctx.strokeRect(220 - progress * 8, 112 - progress * 8, 360 + progress * 16, 214 + progress * 16);
    }
    ctx.restore();
  }

  function updateParticles(deltaFrames) {
    if (reducedMotion) { particles = []; return; }
    var step = Math.max(0.2, Math.min(3, deltaFrames || 1));
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.life -= step;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles(ctx) {
    if (reducedMotion) return;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function percentile(values, fraction) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  }

  api.draw = function (battle, ctx, frame, deltaFrames) {
    if (!battle || !battle.agentOps) return;
    var started = typeof performance !== "undefined" && performance.now ? performance.now() : 0;
    arenaFrame = frame;
    reducedMotion = currentReducedMotion();
    if (reducedMotion) clearMotionState();
    updateParticles(deltaFrames);

    ctx.save();
    if (!reducedMotion && cameraShake > 0) {
      var offsetX = Math.sin(frame * 2.17) * cameraShake;
      var offsetY = Math.cos(frame * 1.73) * cameraShake * 0.45;
      ctx.translate(offsetX, offsetY);
      cameraShake = Math.max(0, cameraShake - Math.max(0.25, deltaFrames * 0.45));
    } else cameraShake = 0;

    drawBackWall(ctx);
    drawCommandTable(ctx);
    drawBoard(ctx, battle.agentOps);
    drawPhaseCards(ctx, battle.agentOps);
    drawTrainers(ctx, battle);
    drawStatus(ctx, battle.agentOps);
    drawCaption(ctx);
    drawCue(ctx);

    if (battle.agentOps.phase === "action") drawActions(ctx, battle.agentOps, battle);
    else if (battle.agentOps.phase === "choice") drawChoices(ctx, battle.agentOps, battle);
    else if (battle.agentOps.phase === "resolve" || battle.agentOps.phase === "feedback") drawFeedback(ctx, battle.agentOps);
    else drawStateCard(ctx, battle.agentOps);

    if (!drawOptional(ctx, "foreground")) {
      ctx.strokeStyle = "rgba(242,179,93,0.17)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 606); ctx.quadraticCurveTo(185, 565, 310, 608); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(800, 606); ctx.quadraticCurveTo(615, 565, 490, 608); ctx.stroke();
    }
    drawParticles(ctx);
    drawOptional(ctx, "effects");
    ctx.restore();

    if (started) {
      frameSamples.push(performance.now() - started);
      if (frameSamples.length > MAX_FRAME_SAMPLES) frameSamples.shift();
    }
  };

  api.getDiagnostics = function () {
    return {
      reducedMotion: reducedMotion,
      muted: muted,
      audioUnlocked: audioUnlocked,
      audioAvailable: audioAvailable,
      activeVoices: voices.length,
      delayedTones: delayedTones.size,
      toneStarts: toneStarts,
      particleCount: particles.length,
      particleCap: MAX_PARTICLES,
      cueSlots: cue ? 1 : 0,
      announcementKeys: announcedKeys.length,
      announcementCount: announcementCount,
      lastAnnouncement: lastAnnouncement,
      feedback: lastResult ? Object.assign({}, lastResult) : null,
      optionalLayerCount: Object.keys(optionalLayers).length,
      visualMode: Object.keys(optionalLayers).length ? "layered+procedural" : "procedural-fallback",
      entranceOffset: lastEntranceOffset,
      frameSamples: frameSamples.length,
      frameP95Ms: percentile(frameSamples, 0.95),
      playerSlug: playerSlug,
      actionRects: api.actionRects(),
      choiceRects: api.choiceRects(),
      runRect: api.runRect(),
      limits: {
        particles: MAX_PARTICLES,
        voices: MAX_VOICES,
        delayedTones: MAX_DELAYED_TONES,
        announcementKeys: MAX_ANNOUNCEMENT_KEYS,
        frameSamples: MAX_FRAME_SAMPLES,
      },
    };
  };

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) api.suspend();
  });
  window.addEventListener("pagehide", function () { api.suspend(); });

  window.AgentArena = api;
})();
