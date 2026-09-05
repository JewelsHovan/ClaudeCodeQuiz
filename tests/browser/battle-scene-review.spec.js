// @ts-check
// Visual contracts: framing, readable controls, and presentation-only scene polish.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const coreJs = fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/core.js"), "utf8");

async function boot(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "assert"].includes(message.type())) errors.push(message.text()); });
  page.on("requestfailed", request => errors.push(request.url()));
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.addInitScript(coreJs);
  await page.goto("/");
  await page.waitForFunction(() => { try { return (0, eval)("state") === "title"; } catch { return false; } });
  return errors;
}

async function start(page, domain = "CONFIG") {
  await page.evaluate(async domain => {
    const ge = (0, eval), p = ge("player");
    window.__DATAMON_TEST__.seedRNG(5300);
    window.TEXT_SPEED_OVERRIDE = 10000;
    p.slug = ge("ROSTER").find(slug => slug.startsWith("victor-"));
    ge("restorePlayerHp")(true);
    ge("startBattle")({ slug: "tyler-nagano", type: domain === "AGENT" ? "MIX" : domain, defeated: false });
    const b = ge("battle"), presentation = window.DatamonBattlePresentation;
    // AGENT's classic theater is used by mixed encounters, not Incident Command.
    if (domain === "AGENT") {
      b.mons.forEach((mon, i) => {
        mon.domain = domain; mon.name = presentation.CANONICAL_NAMES.AGENT[i];
        mon.id = presentation.battlemonId(domain, mon.name);
      });
      presentation.setActiveEncounter(b.mons.map(mon => mon.id));
    }
    await Promise.all([window.DatamonBattleArena.requestArena(domain), ...b.mons.map(mon => presentation.requestSheet(mon.id))]);
    ge("advanceBattle")(); ge("advanceBattle")();
  }, domain);
}

for (const dpr of [1, 2]) {
  test(`DPR${dpr}: every roster member and semantic pose has headroom and clears the HUD`, async ({ browser }) => {
    const context = await browser.newContext({ deviceScaleFactor: dpr, reducedMotion: "reduce" });
    try {
      const page = await context.newPage(), errors = await boot(page);
      const rows = await page.evaluate(() => {
        const ge = (0, eval), ctx = ge("ctx"), p = window.DatamonBattlePresentation, rows = [];
        const original = ctx.drawImage, inverse = ctx.getTransform().inverse();
        let identity;
        ctx.drawImage = function (...args) {
          const [x, y, w, h] = args.slice(5, 9), transform = inverse.multiply(ctx.getTransform());
          const points = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]
            .map(([x, y]) => transform.transformPoint(new DOMPoint(x, y)));
          rows.push({ ...identity, left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
            top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) });
        };
        try {
          for (const slug of ge("ROSTER")) for (const [pose, params] of Object.entries(p.POSE_PARAMS)) {
            for (const side of ["PLAYER", "OPPONENT"]) {
              identity = { slug, pose, side };
              ge("drawTrainer")(slug, ...p.GEOMETRY[side + "_ANCHOR"], p.GEOMETRY[side + "_VISIBLE_HEIGHT"], 0, params, side === "OPPONENT");
            }
          }
        } finally { ctx.drawImage = original; }
        return rows;
      });
      expect(rows).toHaveLength(37 * 6 * 2);
      for (const row of rows) {
        const label = `${row.slug} ${row.side} ${row.pose}`;
        expect(row.top, label).toBeGreaterThanOrEqual(12);
        expect(row.left, label).toBeGreaterThanOrEqual(12);
        expect(row.right, label).toBeLessThanOrEqual(788);
        expect(row.bottom, label).toBeLessThan(432);
        if (row.side === "PLAYER") expect(row.top, label).toBeGreaterThan(86);
        else expect(row.left, label).toBeGreaterThan(310);
      }
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test("all canonical questions and choices fit; timer and damage stay attached to their owners", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await boot(page);
  await start(page);
  const result = await page.evaluate(() => {
    const ge = (0, eval), ctx = ge("ctx"), b = ge("battle"), originalText = ctx.fillText, calls = [], violations = [];
    const before = JSON.stringify({ stats: ge("questionStats"), hp: ge("player.hp"), mons: b.mons.map(({ q, ...m }) => m) });
    ge('difficulty = "hard"');
    ctx.fillText = function (text, x, y) {
      const metrics = ctx.measureText(text);
      calls.push({ text: String(text), x, y, width: metrics.width });
      if (y >= 432) {
        if (x < 24 || (ctx.textAlign === "left" && x + metrics.width > 766)) violations.push(String(text));
        for (const [cx, cy, cw, ch] of ge("CHOICE_RECTS")) {
          if (y >= cy && y <= cy + ch && x >= cx && x < cx + cw && x + metrics.width > cx + cw - 8) violations.push(String(text));
        }
      }
      return originalText.call(this, text, x, y);
    };
    try {
      for (const [cat, bank] of Object.entries(ge("QUESTION_BANK"))) for (const q of bank) {
        ge("currentMon")().q = { ...q, cat };
        const start = calls.length;
        ge("drawBattle")();
        const rendered = calls.slice(start);
        const prompt = rendered.filter(c => c.x === 38 && c.y >= 432 && c.y < 490).map(c => c.text).join(" ");
        if (prompt !== "[" + cat + "] " + q.q) violations.push("Truncated question: " + q.q);
        ge("CHOICE_RECTS").forEach(([x, y, w, h], i) => {
          const choice = rendered.filter(c => c.x === x + 38 && c.y >= y && c.y <= y + h).map(c => c.text).join(" ");
          if (choice !== q.c[i]) violations.push("Truncated choice: " + q.c[i]);
        });
      }
      b.dmgAt = ge("frame"); ge("drawBattle")();
    } finally { ctx.fillText = originalText; }
    const after = JSON.stringify({ stats: ge("questionStats"), hp: ge("player.hp"), mons: b.mons.map(({ q, ...m }) => m) });
    return { violations, before, after, timers: calls.filter(c => /^\d+s$/.test(c.text)),
      damage: calls.find(c => c.text === "-" + ge("battleWrongDamage")(b)),
      target: calls.find(c => c.text === ge("currentMon")().name.toUpperCase()),
      playerAnchor: window.DatamonBattlePresentation.GEOMETRY.PLAYER_ANCHOR,
      timerCount: Object.values(ge("QUESTION_BANK")).reduce((n, bank) => n + bank.length, 0) + 1 };
  });
  expect(result.violations).toEqual([]);
  expect(result.after).toBe(result.before);
  expect(result.timers).toHaveLength(result.timerCount);
  expect(result.timers.every(c => c.x >= 688 && c.y >= 467 && c.y < 490)).toBe(true);
  expect(result.target.x).toBeGreaterThan(370); expect(result.target.y).toBeGreaterThan(260);
  expect(result.target.y).toBeLessThan(330);
  expect(result.damage.x).toBe(result.playerAnchor[0]);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1000, height: 760 }, { width: 390, height: 844 }]) {
  test(`controls keep keyboard/pointer parity at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = await boot(page);
    await start(page, "MCP");
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => (0, eval)("battle.sel"))).toBe(1);
    const size = await page.locator("#game").boundingBox();
    expect(size.width).toBeLessThanOrEqual(viewport.width);
    expect(size.height).toBeLessThanOrEqual(viewport.height);
    await page.locator("#game").screenshot({ path: testInfo.outputPath(`question-${viewport.width}.png`) });
    const answer = await page.evaluate(() => {
      const ge = (0, eval), q = ge("currentMon")().q;
      return { rect: ge("CHOICE_RECTS")[q.a], hp: ge("player.hp") };
    });
    // The canvas has a 2px CSS border; hit tests operate in its content box.
    const [x, y, w, h] = answer.rect;
    await page.mouse.click(size.x + 2 + (x + w / 2) * (size.width - 4) / 800,
      size.y + 2 + (y + h / 2) * (size.height - 4) / 608);
    expect(await page.evaluate(() => (0, eval)("battle.feedback.correct"))).toBe(true);
    expect(await page.evaluate(() => (0, eval)("player.hp"))).toBeGreaterThanOrEqual(answer.hp);
    expect(errors).toEqual([]);
  });
}

test("all five authored theaters remain playable and retain their asset budgets", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await boot(page);
  for (const domain of ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT"]) {
    await start(page, domain);
    await page.locator("#game").screenshot({ path: testInfo.outputPath(`${domain.toLowerCase()}-question.png`) });
    const d = await page.evaluate(() => ({ arena: window.DatamonBattleArena.getDiagnostics(), mon: window.DatamonBattlePresentation.getDiagnostics() }));
    expect(d.arena.residentArenaCount).toBe(1);
    expect(d.arena.activeDomain).toBe(domain);
    expect(d.arena.residentDecodedBytes + d.arena.fallbackDecodedBytes + d.mon.loadedSheetDecodedBytes + d.mon.fallbackDecodedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  }
  expect(errors).toEqual([]);
});

test("Incident Command shares planted trainer proportions in both motion preferences", async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const ge = (0, eval);
    ge("player").slug = "julien-hovan"; ge("restorePlayerHp")(true); ge("placeNPCs")();
    ge("startBattle")(ge("npcs").find(npc => npc.type === "AGENT"));
  });
  for (const reducedMotion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion });
    const result = await page.evaluate(() => {
      const ge = (0, eval), b = ge("battle"), calls = [], before = JSON.stringify(b.agentOps);
      window.AgentArena.setDrawTrainer((...args) => calls.push(args));
      try { window.AgentArena.draw(b, ge("ctx"), ge("frame"), 0); }
      finally { window.AgentArena.setDrawTrainer(ge("drawTrainer")); }
      return { before, after: JSON.stringify(b.agentOps), calls: calls.map(args => ({ h: args[3], bob: args[4] })),
        geometry: window.DatamonBattlePresentation.GEOMETRY };
    });
    expect(result.calls).toEqual([
      { h: result.geometry.OPPONENT_VISIBLE_HEIGHT, bob: 0 },
      { h: result.geometry.PLAYER_VISIBLE_HEIGHT, bob: 0 },
    ]);
    expect(result.before).toBe(result.after);
  }
  expect(errors).toEqual([]);
});
