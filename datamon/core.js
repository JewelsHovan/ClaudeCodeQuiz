// DATAMON deterministic browser-test seam.
// Tests inject this classic script before game.js. It activates only on loopback hosts
// and is deliberately excluded from deployment artifacts.

"use strict";

(function () {
  const isLoopback = typeof window !== "undefined" && [
    "localhost", "127.0.0.1", "[::1]",
  ].includes(window.location.hostname);
  if (!isLoopback) return;

  const originalRandom = Math.random;
  const originalDateNow = Date.now;
  let seededRng = null;
  let mockNow = null;

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  window.__DATAMON_TEST__ = {
    seedRNG(seed) {
      seededRng = mulberry32(seed);
      Math.random = seededRng;
    },

    unseedRNG() {
      seededRng = null;
      Math.random = originalRandom;
    },

    getRNGState() {
      return { seeded: seededRng !== null };
    },

    // Mock only wall-clock time. requestAnimationFrame and performance.now remain real,
    // so the render loop cannot receive incompatible/negative frame deltas.
    mockClock(timestamp) {
      mockNow = Number(timestamp);
      Date.now = () => mockNow;
    },

    advanceClock(milliseconds) {
      if (mockNow === null) throw new Error("Clock is not mocked");
      mockNow += Number(milliseconds);
      return mockNow;
    },

    unmockClock() {
      mockNow = null;
      Date.now = originalDateNow;
    },

    getClockState() {
      return mockNow === null
        ? { mocked: false }
        : { mocked: true, timestamp: mockNow };
    },

    inspectState() {
      const globalEval = (0, eval);
      const result = {};
      try { result.state = globalEval("typeof state !== 'undefined' ? state : null"); } catch (_) { result.state = null; }
      try {
        const p = globalEval("player");
        result.player = p ? { hp: p.hp, slug: p.slug, x: p.x, y: p.y, seated: !!p.seated } : null;
      } catch (_) { result.player = null; }
      try {
        const list = globalEval("npcs");
        result.npcs = list ? list.map(npc => ({
          slug: npc.slug,
          defeated: npc.defeated,
          x: npc.x,
          y: npc.y,
          seated: !!npc._seated,
        })) : null;
      } catch (_) { result.npcs = null; }
      try {
        const b = globalEval("battle");
        if (b) {
          result.battle = {
            phase: b.phase,
            npc: b.npc && b.npc.slug,
            timerMs: typeof b.timerMs === "number" ? b.timerMs : null,
            message: b.msg || "",
            shake: b.shake || 0,
            attackAt: b.attackAt || 0,
            damageAt: b.dmgAt || 0,
          };
          // Agent Operations telemetry: expose reducer state only on loopback hosts.
          if (b.agentOps) {
            result.agentOps = {
              phase: b.agentOps.phase,
              boss: b.agentOps.boss,
              bossPhase: b.agentOps.bossPhase,
              bossPhases: b.agentOps.bossPhases,
              stability: b.agentOps.stability,
              maxStability: b.agentOps.maxStability,
              momentum: b.agentOps.momentum,
              guardrail: b.agentOps.guardrail,
              playerHp: b.agentOps.playerHp,
              selectedAction: b.agentOps.selectedAction,
              choiceCursor: b.agentOpsChoiceSel,
              outcome: b.agentOps.outcome ? { ...b.agentOps.outcome } : null,
              eliminated: b.agentOps.eliminated ? b.agentOps.eliminated.slice() : [],
            };
          }
        } else {
          result.battle = null;
        }
      } catch (_) { result.battle = null; }
      try { result.difficulty = globalEval("typeof difficulty !== 'undefined' ? difficulty : null"); } catch (_) { result.difficulty = null; }
      try {
        const anim = globalEval("walkAnim");
        result.walkSlugs = Object.keys(anim || {});
        result.walkFrames = Object.values(anim || {}).reduce(
          (sum, dirs) => sum + Object.values(dirs).flat().filter(Boolean).length,
          0,
        );
      } catch (_) {
        result.walkSlugs = [];
        result.walkFrames = 0;
      }
      return result;
    },

    waitForState(targetState, timeoutMs = 10000) {
      const globalEval = (0, eval);
      const startedAt = originalDateNow();
      return new Promise((resolve, reject) => {
        const check = () => {
          try {
            const current = globalEval("typeof state !== 'undefined' ? state : null");
            if (current === targetState) return resolve(current);
            if (originalDateNow() - startedAt > timeoutMs) {
              return reject(new Error(`Timeout waiting for state "${targetState}". Current: "${current}"`));
            }
            requestAnimationFrame(check);
          } catch (error) {
            reject(error);
          }
        };
        check();
      });
    },

    isActive() {
      return true;
    },
  };
})();
