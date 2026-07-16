// @ts-check
// Ticket #036 — packaged Agent Operations presentation/accessibility/audio contract.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const coreJs = fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/core.js"), "utf8");

async function boot(page, { captureDraw = false } = {}) {
  const errors = [];
  const failures = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || message.type() === "assert") errors.push(message.text());
  });
  page.on("requestfailed", request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", response => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript(coreJs);
  if (captureDraw) {
    await page.addInitScript(() => {
      window.__arenaText = [];
      window.__arenaFullFlashes = [];
      const originalText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        window.__arenaText.push(String(text));
        if (window.__arenaText.length > 400) window.__arenaText.shift();
        return originalText.call(this, text, ...args);
      };
      const originalFill = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
        const style = String(this.fillStyle).replaceAll(" ", "").toLowerCase();
        if (width >= 780 && height >= 590 && (style.includes("255,255,255") || style.includes("239,68,68"))) {
          window.__arenaFullFlashes.push(style);
        }
        return originalFill.call(this, x, y, width, height);
      };
    });
  }
  await page.goto("/");
  await page.waitForFunction(() => { try { return (0, eval)("state") === "title"; } catch (_) { return false; } });
  return { errors, failures };
}

async function startAgent(page, { boss = false, difficulty = "normal" } = {}) {
  return page.evaluate(({ makeBoss, requestedDifficulty }) => {
    const ge = (0, eval);
    const roster = ge("ROSTER");
    const player = ge("player");
    player.slug = roster[0];
    player.hp = ge("MAX_HP");
    ge(`difficulty = ${JSON.stringify(requestedDifficulty)}`);
    ge("defeated = new Set()");
    ge("_progression = { badges: [], quests: {}, activities: {}, npcDomains: {} }");
    ge("_npcDomains = _progression.npcDomains");
    ge("placeNPCs")();
    const npcs = ge("npcs");
    const target = npcs.find(npc => npc.type === "AGENT");
    if (!target) throw new Error("No AGENT target");
    if (makeBoss) {
      for (const npc of npcs) {
        if (npc.type === "AGENT" && npc !== target) {
          npc.defeated = true;
          ge("defeated").add(npc.slug);
        }
      }
    }
    window.TEXT_SPEED_OVERRIDE = 10000;
    ge("startBattle")(target);
    window.__arenaAnnouncements = [];
    const region = document.getElementById("datamon-announcer");
    if (region.textContent) window.__arenaAnnouncements.push(region.textContent);
    new MutationObserver(() => {
      if (region.textContent) window.__arenaAnnouncements.push(region.textContent);
    }).observe(region, { childList: true, characterData: true, subtree: true });
    return { player: player.slug, target: target.slug };
  }, { makeBoss: boss, requestedDifficulty: difficulty });
}

async function correctIndex(page) {
  return page.evaluate(() => {
    const question = (0, eval)("battle.agentOps.question");
    return question.correct != null ? question.correct : question.a;
  });
}

async function finishMessage(page) {
  await page.evaluate(() => { (0, eval)("battle").msgAt = -1e9; });
  await page.keyboard.press("Enter");
}

async function playCorrectQuery(page) {
  await page.keyboard.press("1");
  await page.keyboard.press(String((await correctIndex(page)) + 1));
}

async function diagnostics(page) {
  return page.evaluate(() => window.AgentArena.getDiagnostics());
}

function pngDimensions(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test.describe("Agent Operations Incident Command arena", () => {
  test("packaged arena uses actual trainer identity, exact independent layouts, and complete procedural fallback", async ({ page }) => {
    const { errors, failures } = await boot(page, { captureDraw: true });
    const identities = await startAgent(page);
    await page.waitForTimeout(80);

    const result = await page.evaluate(() => {
      const ge = (0, eval);
      const before = JSON.stringify(ge("battle.agentOps"));
      window.AgentArena.setOptionalLayers({
        backWall: null,
        incidentBoard: null,
        commandTable: null,
        foreground: null,
        effects: null,
      });
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        diagnostics: window.AgentArena.getDiagnostics(),
        gameActions: ge("_agentActionRects")(),
        gameChoices: ge("_agentChoiceRects")(),
        after: JSON.stringify(ge("battle.agentOps")),
        before,
        question: ge("battle.agentOps.question.q"),
        drawnText: window.__arenaText.slice(),
      }))));
    });

    expect(result.diagnostics.playerSlug).toBe(identities.player);
    expect(result.diagnostics.playerSlug).not.toBe("player");
    expect(result.diagnostics.visualMode).toBe("procedural-fallback");
    expect(result.before).toBe(result.after);
    const stressed = await page.evaluate(() => {
      const ge = (0, eval), real = ge("battle.agentOps");
      for (let i = 0; i < 20; i++) {
        const previous = { ...real, stability: 3, momentum: 0, playerHp: 100, guardrail: 0, phase: "choice" };
        const current = { ...real, stability: 2, momentum: 1, playerHp: 100, guardrail: 0, phase: "resolve", selectedAction: "query", outcome: { correct: true, index: 0, reason: "answer", blocked: false } };
        window.AgentArena.syncTransition({ npc: ge("battle.npc"), agentOps: current }, previous, { type: "SUBMIT_ANSWER", index: 0 }, []);
      }
      return { diagnostics: window.AgentArena.getDiagnostics(), combat: JSON.stringify(ge("battle.agentOps")) };
    });
    expect(stressed.combat).toBe(result.after);
    expect(stressed.diagnostics.particleCount).toBe(64);
    expect(stressed.diagnostics.particleCount).toBeLessThanOrEqual(stressed.diagnostics.limits.particles);
    expect(result.gameActions).toEqual(result.diagnostics.actionRects);
    expect(result.gameChoices).toEqual(result.diagnostics.choiceRects);
    expect(result.gameActions).not.toEqual(result.gameChoices);
    expect(result.drawnText.join(" ")).toContain(result.question);
    for (const label of ["QUERY", "INSPECT", "PATCH", "ESCALATE", "STABILITY", "MOMENTUM", "GUARDRAIL"]) {
      expect(result.drawnText.join(" ")).toContain(label);
    }
    for (const rect of [...result.gameActions, ...result.gameChoices]) {
      expect(rect[0]).toBeGreaterThanOrEqual(0);
      expect(rect[1]).toBeGreaterThanOrEqual(0);
      expect(rect[0] + rect[2]).toBeLessThanOrEqual(800);
      expect(rect[1] + rect[3]).toBeLessThanOrEqual(608);
    }
    expect(errors).toEqual([]);
    expect(failures).toEqual([]);
  });

  test("polite live region announces each semantic transition once with complete answer economy", async ({ page }) => {
    const { errors, failures } = await boot(page);
    await startAgent(page);
    await page.waitForTimeout(0);

    // Inspect is locked at zero Momentum: announce rejection without changing phase.
    await page.keyboard.press("2");
    expect(await page.evaluate(() => (0, eval)("battle.agentOps.phase"))).toBe("action");
    await page.keyboard.press("1");
    const correct = await correctIndex(page);
    await page.keyboard.press(String(correct + 1));
    expect(await page.evaluate(() => (0, eval)("battle.agentOps.phase"))).toBe("resolve");

    // Direct duplicate dispatches exercise the locked reducer boundary. Dedupe must
    // emit one rejection, not chatter for each repeated activation.
    await page.evaluate(index => {
      const ge = (0, eval);
      ge("_agentDispatch")(ge("battle"), { type: "SUBMIT_ANSWER", index });
      ge("_agentDispatch")(ge("battle"), { type: "SUBMIT_ANSWER", index });
    }, correct);
    await page.waitForTimeout(0);

    const snapshot = await page.evaluate(() => ({
      announcements: window.__arenaAnnouncements.slice(),
      current: document.getElementById("datamon-announcer").textContent,
      diagnostics: window.AgentArena.getDiagnostics(),
    }));
    const speech = snapshot.announcements.join("\n");
    expect(speech).toMatch(/Agent Operations encounter/i);
    expect(speech).toMatch(/Question:/i);
    expect(speech).toMatch(/Choices: 1\./i);
    expect(speech).toMatch(/Action rejected: Inspect/i);
    expect(speech).toMatch(/Action selected: Query/i);
    expect(speech).toMatch(/Submitted answer:/i);
    expect(speech).toMatch(/Expected answer:/i);
    expect(speech).toMatch(/Explanation:/i);
    expect(speech).toMatch(/Stability \d+ to \d+/i);
    expect(speech).toMatch(/Momentum \d+ to \d+/i);
    expect(speech).toMatch(/Guardrail .* to /i);
    expect(speech).toMatch(/HP \d+ to \d+/i);
    expect(speech).toMatch(/Next phase:/i);
    expect(snapshot.announcements.filter(text => /Answer rejected:/.test(text))).toHaveLength(1);
    expect(snapshot.announcements).toEqual([...new Set(snapshot.announcements)]);

    const feedback = snapshot.diagnostics.feedback;
    expect(feedback.submitted).toMatch(/^\d+\./);
    expect(feedback.expected).toMatch(/^\d+\./);
    expect(feedback.explanation.length).toBeGreaterThan(10);
    for (const key of ["stabilityBefore", "stabilityAfter", "momentumBefore", "momentumAfter", "guardrailBefore", "guardrailAfter", "hpBefore", "hpAfter", "next"]) {
      expect(feedback[key]).not.toBeUndefined();
    }

    // Complete the encounter and assert the terminal announcement is exact-once.
    await finishMessage(page);
    await finishMessage(page);
    await playCorrectQuery(page);
    await finishMessage(page);
    await finishMessage(page);
    await playCorrectQuery(page);
    await finishMessage(page);
    await page.waitForTimeout(0);
    const terminal = await page.evaluate(() => window.__arenaAnnouncements.filter(text => /^Victory\./.test(text)));
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatch(/HP .* Stability .* Momentum .* Guardrail/i);
    expect(errors).toEqual([]);
    expect(failures).toEqual([]);
  });

  test("reduced motion removes entrance, flashes, shake, pulse/travel and still completes", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { errors, failures } = await boot(page, { captureDraw: true });
    await page.evaluate(() => { window.__arenaFullFlashes = []; });
    const identities = await startAgent(page);
    await page.evaluate(() => {
      const ge = (0, eval);
      const original = ge("drawTrainer");
      window.__arenaTrainerCalls = [];
      window.AgentArena.setDrawTrainer((...args) => {
        window.__arenaTrainerCalls.push(args);
        if (window.__arenaTrainerCalls.length > 80) window.__arenaTrainerCalls.shift();
        original(...args);
      });
    });
    await page.waitForTimeout(100);

    let reduced = await page.evaluate(() => ({
      diagnostics: window.AgentArena.getDiagnostics(),
      calls: window.__arenaTrainerCalls.slice(),
      flashes: window.__arenaFullFlashes.slice(),
      shake: (0, eval)("battle.shake"),
    }));
    expect(reduced.diagnostics.reducedMotion).toBe(true);
    expect(reduced.diagnostics.entranceOffset).toBe(0);
    expect(reduced.diagnostics.particleCount).toBe(0);
    expect(reduced.diagnostics.cueSlots).toBe(0);
    expect(reduced.shake).toBe(0);
    expect(reduced.flashes).toEqual([]);
    expect(new Set(reduced.calls.filter(call => call[0] === identities.player).map(call => call[1]))).toEqual(new Set([126]));
    expect(new Set(reduced.calls.map(call => call[4]))).toEqual(new Set([0]));

    for (let turn = 0; turn < 3; turn++) {
      await playCorrectQuery(page);
      reduced = { diagnostics: await diagnostics(page) };
      expect(reduced.diagnostics.particleCount).toBe(0);
      expect(reduced.diagnostics.cueSlots).toBe(0);
      await finishMessage(page);
      if (turn < 2) await finishMessage(page);
    }
    expect(await page.evaluate(() => (0, eval)("battle.agentOps.phase"))).toBe("victory");
    expect(errors).toEqual([]);
    expect(failures).toEqual([]);
  });

  test("mute, unavailable AudioContext, delayed-tone cancellation, and visibility/reset cleanup are safe", async ({ browser }) => {
    const fakeAudio = `
      window.__toneLog = [];
      class FakeAudioContext {
        constructor(){ this.currentTime=0; this.state='running'; this.destination={}; }
        resume(){ this.state='running'; return Promise.resolve(); }
        createGain(){ return { gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){} }; }
        createOscillator(){
          const o={frequency:{value:0},type:'square',onended:null,connect(){},disconnect(){},
            start(){ window.__toneLog.push({type:'start',frequency:o.frequency.value}); },
            stop(when){ window.__toneLog.push({type:when === undefined ? 'cancel' : 'scheduled',frequency:o.frequency.value}); }};
          return o;
        }
      }
      window.AudioContext=FakeAudioContext; window.webkitAudioContext=undefined;
    `;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript({ content: fakeAudio });
    const first = await boot(page);
    await startAgent(page);

    await page.keyboard.press("m");
    await playCorrectQuery(page);
    await page.waitForTimeout(220);
    expect((await diagnostics(page)).muted).toBe(true);
    expect(await page.evaluate(() => window.__toneLog.filter(item => item.type === "start"))).toEqual([]);

    await finishMessage(page);
    await finishMessage(page);
    await page.keyboard.press("m");
    await playCorrectQuery(page);
    await page.waitForTimeout(10);
    const beforeHide = await page.evaluate(() => window.__toneLog.filter(item => item.type === "start").length);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await page.waitForTimeout(220);
    const afterHide = await page.evaluate(() => ({
      starts: window.__toneLog.filter(item => item.type === "start").length,
      diagnostics: window.AgentArena.getDiagnostics(),
    }));
    expect(afterHide.starts).toBe(beforeHide);
    expect(afterHide.diagnostics.activeVoices).toBe(0);
    expect(afterHide.diagnostics.delayedTones).toBe(0);

    await page.evaluate(() => window.AgentArena.reset());
    expect((await diagnostics(page)).activeVoices).toBe(0);
    expect((await diagnostics(page)).delayedTones).toBe(0);
    expect(first.errors).toEqual([]);
    expect(first.failures).toEqual([]);
    await context.close();

    const unavailableContext = await browser.newContext();
    const unavailable = await unavailableContext.newPage();
    await unavailable.addInitScript(() => {
      Object.defineProperty(window, "AudioContext", { value: undefined, configurable: true });
      Object.defineProperty(window, "webkitAudioContext", { value: undefined, configurable: true });
    });
    const second = await boot(unavailable);
    await startAgent(unavailable);
    for (let turn = 0; turn < 3; turn++) {
      await playCorrectQuery(unavailable);
      await finishMessage(unavailable);
      if (turn < 2) await finishMessage(unavailable);
    }
    expect(await unavailable.evaluate(() => (0, eval)("battle.agentOps.phase"))).toBe("victory");
    expect((await diagnostics(unavailable)).audioAvailable).toBe(false);
    expect(second.errors).toEqual([]);
    expect(second.failures).toEqual([]);
    await unavailableContext.close();
  });

  test("DPR1/DPR2 regular states and boss phases are deterministic while performance state stays bounded", async ({ browser }, testInfo) => {
    for (const dpr of [1, 2]) {
      const context = await browser.newContext({
        viewport: { width: 1000, height: 760 },
        deviceScaleFactor: dpr,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const observations = await boot(page);
      await page.evaluate(() => window.__DATAMON_TEST__.seedRNG(3600));

      const captures = [];
      const capture = async label => {
        await page.waitForTimeout(30);
        const first = await page.locator("#game").screenshot();
        await page.waitForTimeout(30);
        const second = await page.locator("#game").screenshot();
        expect(first.equals(second), `DPR${dpr} ${label} must be static under reduced motion`).toBe(true);
        expect(pngDimensions(first).width).toBeGreaterThanOrEqual(790 * dpr);
        fs.writeFileSync(testInfo.outputPath(`agent-arena-dpr${dpr}-${label}.png`), first);
        captures.push(label);
      };

      // Regular action → choice → resolve → feedback → victory evidence.
      await startAgent(page);
      await capture("regular-action");
      await page.evaluate(() => {
        const ge = (0, eval), battle = ge("battle");
        ge("_agentDispatch")(battle, { type: "SELECT_ACTION", action: "query" });
      });
      await capture("regular-choice");
      await page.evaluate(() => {
        const ge = (0, eval), battle = ge("battle"), question = battle.agentOps.question;
        ge("_agentDispatch")(battle, { type: "SUBMIT_ANSWER", index: question.correct != null ? question.correct : question.a });
      });
      await capture("regular-resolve");
      await page.evaluate(() => {
        const ge = (0, eval); ge("_agentDispatch")(ge("battle"), { type: "RESOLUTION_COMPLETE" });
      });
      await capture("regular-feedback");
      for (let remaining = 0; remaining < 2; remaining++) {
        await page.evaluate(() => {
          const ge = (0, eval), battle = ge("battle");
          ge("_agentDispatch")(battle, { type: "START_TURN", question: ge("drawQuestion")(battle.npc.type) });
          ge("_agentDispatch")(battle, { type: "SELECT_ACTION", action: "query" });
          const question = battle.agentOps.question;
          ge("_agentDispatch")(battle, { type: "SUBMIT_ANSWER", index: question.correct != null ? question.correct : question.a });
          ge("_agentDispatch")(battle, { type: "RESOLUTION_COMPLETE" });
        });
      }
      expect(await page.evaluate(() => (0, eval)("battle.agentOps.phase"))).toBe("victory");
      await capture("regular-victory");

      // Fresh boss encounter: static cards for phases 1, 2, and 3.
      await startAgent(page, { boss: true });
      await capture("boss-phase1");
      let capturedPhase = 1;
      let turns = 0;
      while (turns < 12) {
        await page.evaluate(() => {
          const ge = (0, eval), battle = ge("battle");
          ge("_agentDispatch")(battle, { type: "SELECT_ACTION", action: "query" });
          const question = battle.agentOps.question;
          ge("_agentDispatch")(battle, { type: "SUBMIT_ANSWER", index: question.correct != null ? question.correct : question.a });
          ge("_agentDispatch")(battle, { type: "RESOLUTION_COMPLETE" });
        });
        turns++;
        const state = await page.evaluate(() => ({ ...((0, eval)("battle.agentOps")) }));
        const diag = await diagnostics(page);
        expect(diag.particleCount).toBeLessThanOrEqual(diag.limits.particles);
        expect(diag.activeVoices).toBeLessThanOrEqual(diag.limits.voices);
        expect(diag.delayedTones).toBeLessThanOrEqual(diag.limits.delayedTones);
        expect(diag.cueSlots).toBeLessThanOrEqual(1);
        expect(diag.announcementKeys).toBeLessThanOrEqual(diag.limits.announcementKeys);
        expect(diag.frameSamples).toBeLessThanOrEqual(diag.limits.frameSamples);
        if (state.phase === "phase-shift") {
          capturedPhase++;
          await capture(`boss-phase${capturedPhase}`);
        }
        if (state.phase === "victory") break;
        await page.evaluate(() => {
          const ge = (0, eval), battle = ge("battle");
          ge("_agentDispatch")(battle, { type: "START_TURN", question: ge("drawQuestion")(battle.npc.type) });
        });
      }
      expect(capturedPhase).toBe(3);
      expect(turns).toBe(12);
      expect(captures).toEqual([
        "regular-action", "regular-choice", "regular-resolve", "regular-feedback", "regular-victory",
        "boss-phase1", "boss-phase2", "boss-phase3",
      ]);
      const finalDiagnostics = await diagnostics(page);
      expect(finalDiagnostics.frameP95Ms).toBeLessThan(16.7);
      expect(finalDiagnostics.frameSamples).toBeGreaterThan(0);
      expect(observations.errors).toEqual([]);
      expect(observations.failures).toEqual([]);
      await context.close();
    }
  });
});
