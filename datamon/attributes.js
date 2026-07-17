// ============================================================
// DATAMON character-attribute matchup rules — pure, deterministic,
// and presentation-independent. Load before game.js as a classic
// script. Exposes window.DatamonAttributes.
// ============================================================

"use strict";

(function () {
  var BASE_MAX_HP = 100;
  var BASE_WRONG_DAMAGE = 25;
  var BASE_HARD_TIMER_MS = 30000;
  var BASE_CORRECT_HEAL = 4;
  var DEFAULT_STAT = 90;
  var MIN_TIMER_MS = 25000;
  var MAX_TIMER_MS = 35000;

  var STAT_INDEX = Object.freeze({
    caffeine: 0,
    debugging: 1,
    vibes: 2,
    jargon: 3,
  });

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function boundedStat(value) {
    var number = Number(value);
    return Number.isFinite(number) ? clamp(Math.round(number), 0, 100) : DEFAULT_STAT;
  }

  function normaliseStats(stats) {
    var source = Array.isArray(stats) ? stats : [];
    return {
      caffeine: boundedStat(source[STAT_INDEX.caffeine]),
      debugging: boundedStat(source[STAT_INDEX.debugging]),
      vibes: boundedStat(source[STAT_INDEX.vibes]),
      jargon: boundedStat(source[STAT_INDEX.jargon]),
    };
  }

  // Math.round is asymmetric for negative half-values. Matchups should give the
  // same magnitude in either direction, so ties round away from zero.
  function roundSigned(value) {
    return value < 0 ? -Math.round(-value) : Math.round(value);
  }

  function movementMultiplier(stats) {
    var player = normaliseStats(stats);
    return Math.round(clamp(1 + (player.caffeine - 90) / 100, 0.9, 1.1) * 1000) / 1000;
  }

  function maxHp(stats) {
    var player = normaliseStats(stats);
    return clamp(player.vibes + 10, 90, 110);
  }

  function opponentMonCount(stats) {
    var opponent = normaliseStats(stats);
    if (opponent.vibes >= 96) return 3;
    if (opponent.vibes <= 84) return 1;
    return 2;
  }

  /**
   * derive(playerStats, opponentStats, difficulty)
   *
   * VIBES      -> player's max HP; opponent's classic-team resolve (1–3 mons)
   * DEBUGGING  -> bounded miss damage through the player/opponent differential
   * CAFFEINE   -> overworld movement and Hard-mode response time
   * JARGON     -> HP recovered after a correct answer
   *
   * Correctness, question selection, campaign rewards, and save telemetry never
   * change. Attributes modify only bounded combat resources around those answers.
   */
  function derive(playerStats, opponentStats, difficulty) {
    var player = normaliseStats(playerStats);
    var opponent = normaliseStats(opponentStats);
    var wrongDamage = clamp(
      BASE_WRONG_DAMAGE + roundSigned((opponent.debugging - player.debugging) / 5),
      15,
      35
    );
    var hardTimerMs = clamp(
      BASE_HARD_TIMER_MS + (player.caffeine - opponent.caffeine) * 200,
      MIN_TIMER_MS,
      MAX_TIMER_MS
    );
    var correctHeal = clamp(
      BASE_CORRECT_HEAL + roundSigned((player.jargon - opponent.jargon) / 10),
      0,
      8
    );

    return {
      difficulty: difficulty === "hard" ? "hard" : difficulty === "easy" ? "easy" : "normal",
      player: player,
      opponent: opponent,
      maxHp: maxHp(playerStats),
      wrongDamage: wrongDamage,
      hardTimerMs: hardTimerMs,
      correctHeal: correctHeal,
      opponentMonCount: opponentMonCount(opponentStats),
      movementMultiplier: movementMultiplier(playerStats),
    };
  }

  function describe(matchup) {
    if (!matchup) return "";
    var parts = [
      matchup.maxHp + " HP",
      "MISS -" + matchup.wrongDamage,
      "CORRECT +" + matchup.correctHeal + " HP",
    ];
    if (matchup.difficulty === "hard") {
      parts.push("TIMER " + Math.round(matchup.hardTimerMs / 1000) + "s");
    }
    return "ATTR // " + parts.join(" · ");
  }

  window.DatamonAttributes = Object.freeze({
    STAT_INDEX: STAT_INDEX,
    BASE_MAX_HP: BASE_MAX_HP,
    BASE_WRONG_DAMAGE: BASE_WRONG_DAMAGE,
    BASE_HARD_TIMER_MS: BASE_HARD_TIMER_MS,
    BASE_CORRECT_HEAL: BASE_CORRECT_HEAL,
    MIN_TIMER_MS: MIN_TIMER_MS,
    MAX_TIMER_MS: MAX_TIMER_MS,
    normaliseStats: normaliseStats,
    movementMultiplier: movementMultiplier,
    maxHp: maxHp,
    opponentMonCount: opponentMonCount,
    derive: derive,
    describe: describe,
  });
})();
