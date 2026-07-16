// ============================================================
// DATAMON Agent Operations battle reducer — pure state machine
// for AGENT-type encounters. Load BEFORE game.js as a classic
// script. Exposes window.DatamonBattleOps. Non-AGENT encounters
// continue through the classic battle unchanged.
// ============================================================

"use strict";

(function () {
  // ---- Constants ----
  var PHASES = [
    "action", "choice", "resolve", "feedback",
    "phase-shift", "victory", "defeat", "escaped",
  ];

  var ACTIONS = {
    query:    { cost: 0, damage: 1, label: "Query",    desc: "0 Momentum · -1 Stability" },
    inspect:  { cost: 1, damage: 1, label: "Inspect",  desc: "1 Momentum · disable 2 wrong" },
    patch:    { cost: 2, damage: 1, label: "Patch",    desc: "2 Momentum · +Guardrail" },
    escalate: { cost: 3, damage: 2, label: "Escalate", desc: "3 Momentum · -2 Stability" },
  };

  var ACTION_KEYS = Object.keys(ACTIONS);

  var MAX_MOMENTUM = 3;
  var GUARDRAIL_MAX = 1;
  var WRONG_DAMAGE = 25;

  var REGULAR_STABILITY = 3;
  var BOSS_PHASE_CAPS = [3, 4, 5]; // three-phase boss stability per phase

  // ---- Helpers ----

  /**
   * Deterministic Inspect: given a question with 4 choices and a correct index,
   * derive two wrong indexes that will be eliminated. The seed is derived from
   * the question id so the same two wrongs are always eliminated, but the
   * correct choice is NEVER in the eliminated set.
   */
  function elimIndexes(question) {
    if (!question || !Array.isArray(question.c) || question.c.length !== 4) return [];
    var correct = question.correct != null ? question.correct : question.a;
    var wrong = [];
    for (var i = 0; i < 4; i++) {
      if (i !== correct) wrong.push(i);
    }
    // Deterministic shuffle using question id as seed
    var id = question.id || "";
    var seed = 0;
    for (var si = 0; si < id.length; si++) {
      seed = ((seed * 31 + id.charCodeAt(si)) >>> 0);
    }
    // Sort wrong indexes by a seeded comparison
    wrong.sort(function (a, b) {
      return ((a + seed) % 4) - ((b + seed) % 4);
    });
    return wrong.slice(0, 2);
  }

  /**
   * Determine if an NPC is the last undefeated AGENT rival.
   * Returns true only when this NPC is AGENT-type and there are no other
   * undefeated AGENT npcs.
   */
  function isLastUndefeatedAgent(npc, npcs) {
    if (!npc || npc.type !== "AGENT" || npc.defeated) return false;
    if (!Array.isArray(npcs) || npcs.indexOf(npc) < 0) return false;
    var soleUndefeatedAgent = null;
    for (var i = 0; i < npcs.length; i++) {
      var n = npcs[i];
      if (n && n.type === "AGENT" && !n.defeated) {
        if (soleUndefeatedAgent) return false;
        soleUndefeatedAgent = n;
      }
    }
    return soleUndefeatedAgent === npc;
  }

  // ---- Encounter Factory ----

  /**
   * createEncounter({ boss, playerHp, npc, npcs })
   *   boss: force boss mode (overrides auto-detection)
   *   playerHp: current player HP (default 100)
   *   npc: the NPC being battled (used for boss detection)
   *   npcs: all NPCs (used to determine last undefeated AGENT)
   */
  function createEncounter(config) {
    config = config || {};
    var isBoss = false;
    if (config.boss === true) {
      isBoss = true;
    } else if (config.npc && config.npcs) {
      isBoss = isLastUndefeatedAgent(config.npc, config.npcs);
    }
    var caps = isBoss ? BOSS_PHASE_CAPS : [REGULAR_STABILITY];
    return {
      phase: "action",
      boss: isBoss,
      bossPhase: 0,
      bossPhases: isBoss ? 3 : 1,
      stability: caps[0],
      maxStability: caps[0],
      playerHp: typeof config.playerHp === "number" ? Math.max(0, config.playerHp) : 100,
      momentum: 0,
      guardrail: 0,
      question: null,
      eliminated: [],
      selectedAction: null,
      outcome: null,
    };
  }

  // ---- Pure Reducer ----

  /**
   * reduce(state, event) -> { state, effects }
   *
   * Events:
   *   { type: "START_TURN", question }          — begin a new turn with a question
   *   { type: "SELECT_ACTION", action }          — player chooses Query|Inspect|Patch|Escalate
   *   { type: "SUBMIT_ANSWER", index }           — player submits an answer choice
   *   { type: "TIMEOUT" }                        — hard-mode timer expired
   *   { type: "RESOLUTION_COMPLETE" }            — player/UI acknowledges resolve
   *   { type: "RUN" }                            — player flees the encounter
   *
   * Effects (semantic, one-shot):
   *   { type: "ACTION_REJECTED", reason }        — invalid action (e.g. insufficient momentum)
   *   { type: "INSPECT_ELIMINATED", indexes }    — two wrong choices disabled
   *   { type: "PATCH_APPLIED" }                  — guardrail charge granted
   *   { type: "RECORD_OUTCOME", questionId, correct, reason }
   *   { type: "STABILITY_DAMAGE", amount }
   *   { type: "PLAYER_DAMAGE", amount }
   *   { type: "GUARDRAIL_BLOCK" }                — guardrail consumed instead of HP damage
   *   { type: "ESCAPED" }
   *   { type: "PHASE_SHIFT", bossPhase, newStability }
   *   { type: "VICTORY" }
   *   { type: "DEFEAT" }
   */
  function reduce(state, event) {
    if (!state || !event) return { state: state, effects: [] };

    // Clone state immutably for pure reduction
    var s = {
      phase: state.phase,
      boss: state.boss,
      bossPhase: state.bossPhase,
      bossPhases: state.bossPhases,
      stability: state.stability,
      maxStability: state.maxStability,
      playerHp: state.playerHp,
      momentum: state.momentum,
      guardrail: state.guardrail,
      question: state.question ? shallowCloneQuestion(state.question) : null,
      eliminated: state.eliminated ? state.eliminated.slice() : [],
      selectedAction: state.selectedAction,
      outcome: state.outcome ? {
        correct: state.outcome.correct,
        index: state.outcome.index,
        reason: state.outcome.reason,
        blocked: !!state.outcome.blocked,
      } : null,
    };
    var effects = [];

    switch (event.type) {
      // ---- START_TURN ----
      case "START_TURN":
        if (s.phase !== "action" && s.phase !== "feedback" && s.phase !== "phase-shift") {
          // Cannot start a turn outside valid phases
          return { state: state, effects: effects };
        }
        s.phase = "action";
        s.question = event.question ? shallowCloneQuestion(event.question) : null;
        s.eliminated = [];
        s.selectedAction = null;
        s.outcome = null;
        break;

      // ---- SELECT_ACTION ----
      case "SELECT_ACTION":
        if (s.phase !== "action") {
          return { state: state, effects: effects };
        }
        var actionName = event.action;
        var spec = ACTIONS[actionName];
        if (!spec) {
          effects.push({ type: "ACTION_REJECTED", reason: "unknown_action", action: actionName });
          return { state: state, effects: effects };
        }
        if (s.momentum < spec.cost) {
          effects.push({ type: "ACTION_REJECTED", reason: "insufficient_momentum", needed: spec.cost, available: s.momentum });
          return { state: state, effects: effects };
        }
        // Spend momentum
        s.momentum = Math.max(0, s.momentum - spec.cost);
        s.selectedAction = actionName;
        s.phase = "choice";

        // Side effects of specific actions
        if (actionName === "inspect") {
          s.eliminated = elimIndexes(s.question);
          effects.push({ type: "INSPECT_ELIMINATED", indexes: s.eliminated.slice() });
        }
        if (actionName === "patch") {
          s.guardrail = GUARDRAIL_MAX;
          effects.push({ type: "PATCH_APPLIED" });
        }
        break;

      // ---- SUBMIT_ANSWER ----
      case "SUBMIT_ANSWER":
        if (s.phase !== "choice") {
          return { state: state, effects: effects };
        }
        var chosenIndex = event.index;
        var choiceCount = s.question && Array.isArray(s.question.c) ? s.question.c.length : 0;
        if (!Number.isInteger(chosenIndex) || chosenIndex < 0 || chosenIndex >= choiceCount ||
            s.eliminated.indexOf(chosenIndex) >= 0) {
          return { state: state, effects: effects };
        }
        var correctIndex = s.question ? (s.question.correct != null ? s.question.correct : s.question.a) : -1;
        var isCorrect = chosenIndex === correctIndex;
        var blocked = !isCorrect && s.guardrail > 0;
        s.phase = "resolve";
        s.outcome = { correct: isCorrect, index: chosenIndex, reason: "answer", blocked: blocked };

        // Always record the outcome exactly once
        effects.push({
          type: "RECORD_OUTCOME",
          questionId: s.question ? s.question.id : null,
          correct: isCorrect,
          reason: "answer",
        });

        if (isCorrect) {
          var damage = ACTIONS[s.selectedAction] ? ACTIONS[s.selectedAction].damage : 1;
          s.stability = Math.max(0, s.stability - damage);
          s.momentum = Math.min(MAX_MOMENTUM, s.momentum + 1);
          effects.push({ type: "STABILITY_DAMAGE", amount: damage });
        } else {
          // Wrong answer: reset momentum
          s.momentum = 0;
          if (s.guardrail > 0) {
            s.guardrail = 0;
            effects.push({ type: "GUARDRAIL_BLOCK" });
          } else {
            s.playerHp = Math.max(0, s.playerHp - WRONG_DAMAGE);
            effects.push({ type: "PLAYER_DAMAGE", amount: WRONG_DAMAGE });
          }
        }
        break;

      // ---- TIMEOUT ----
      case "TIMEOUT":
        if (s.phase !== "choice") {
          return { state: state, effects: effects };
        }
        s.phase = "resolve";
        s.outcome = { correct: false, index: -1, reason: "timeout", blocked: s.guardrail > 0 };

        effects.push({
          type: "RECORD_OUTCOME",
          questionId: s.question ? s.question.id : null,
          correct: false,
          reason: "timeout",
        });

        s.momentum = 0;
        if (s.guardrail > 0) {
          s.guardrail = 0;
          effects.push({ type: "GUARDRAIL_BLOCK" });
        } else {
          s.playerHp = Math.max(0, s.playerHp - WRONG_DAMAGE);
          effects.push({ type: "PLAYER_DAMAGE", amount: WRONG_DAMAGE });
        }
        break;

      // ---- RESOLUTION_COMPLETE ----
      case "RESOLUTION_COMPLETE":
        if (s.phase !== "resolve") {
          return { state: state, effects: effects };
        }
        if (s.playerHp <= 0) {
          s.phase = "defeat";
          effects.push({ type: "DEFEAT" });
        } else if (s.stability <= 0 && s.boss && s.bossPhase + 1 < s.bossPhases) {
          // Boss phase shift: advance to next phase, reset stability
          s.bossPhase++;
          var newCap = BOSS_PHASE_CAPS[s.bossPhase];
          s.stability = newCap;
          s.maxStability = newCap;
          s.phase = "phase-shift";
          effects.push({ type: "PHASE_SHIFT", bossPhase: s.bossPhase, newStability: newCap });
        } else if (s.stability <= 0) {
          s.phase = "victory";
          effects.push({ type: "VICTORY" });
        } else {
          s.phase = "feedback";
        }
        break;

      // ---- RUN ----
      case "RUN":
        if (s.phase !== "action" && s.phase !== "choice") {
          return { state: state, effects: effects };
        }
        s.phase = "escaped";
        effects.push({ type: "ESCAPED" });
        break;

      default:
        // Unknown event type — no-op
        break;
    }

    return { state: s, effects: effects };
  }

  // Shallow clone a question object preserving id, c array, correct/a index.
  function shallowCloneQuestion(q) {
    if (!q) return null;
    return {
      id: q.id,
      q: q.q,
      c: q.c ? q.c.slice() : [],
      correct: q.correct != null ? q.correct : q.a,
      a: q.a,
      x: q.x,
      d: q.d,
      cat: q.cat,
    };
  }

  // ---- Public API ----
  window.DatamonBattleOps = {
    PHASES: PHASES,
    ACTIONS: ACTIONS,
    ACTION_KEYS: ACTION_KEYS,
    MAX_MOMENTUM: MAX_MOMENTUM,
    GUARDRAIL_MAX: GUARDRAIL_MAX,
    WRONG_DAMAGE: WRONG_DAMAGE,
    REGULAR_STABILITY: REGULAR_STABILITY,
    BOSS_PHASE_CAPS: BOSS_PHASE_CAPS,
    elimIndexes: elimIndexes,
    isLastUndefeatedAgent: isLastUndefeatedAgent,
    createEncounter: createEncounter,
    reduce: reduce,
  };
})();
