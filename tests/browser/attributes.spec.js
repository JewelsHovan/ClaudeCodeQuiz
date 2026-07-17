// @ts-check
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const coreJs = fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/core.js"), "utf8");

async function boot(page) {
  const errors = [], failures = [];
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => {
    if (["error", "assert"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("requestfailed", request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", response => { if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`); });
  await page.addInitScript(coreJs);
  await page.goto("/");
  await page.waitForFunction(() => { try { return (0, eval)("state") === "title"; } catch { return false; } });
  return { errors, failures };
}

test.describe("Curated character attributes affect bounded gameplay", () => {
  test("all 37×37 matchups are deterministic, finite, bounded, and side-effect free", async ({ page }) => {
    const observations = await boot(page);
    const matrix = await page.evaluate(() => {
      const ge=(0,eval),roster=ge("ROSTER"),stats=ge("CURATED_STATS"),before=JSON.stringify(stats),rows=[];
      for(const playerSlug of roster){for(const opponentSlug of roster){
        const a=ge("DatamonAttributes").derive(stats[playerSlug],stats[opponentSlug],"hard");
        rows.push([a.maxHp,a.wrongDamage,a.hardTimerMs,a.correctHeal,a.opponentMonCount,a.movementMultiplier]);
      }}
      return{roster:roster.length,count:rows.length,unchanged:before===JSON.stringify(stats),finite:rows.every(row=>row.every(Number.isFinite)),
        bounded:rows.every(([hp,damage,timer,heal,mons,movement])=>hp>=90&&hp<=110&&damage>=15&&damage<=35&&timer>=25000&&timer<=35000&&heal>=0&&heal<=8&&mons>=1&&mons<=3&&movement>=0.9&&movement<=1.1),
        deterministic:JSON.stringify(rows)===JSON.stringify(rows.map((_,index)=>{const p=roster[Math.floor(index/roster.length)],o=roster[index%roster.length],a=ge("DatamonAttributes").derive(stats[p],stats[o],"hard");return[a.maxHp,a.wrongDamage,a.hardTimerMs,a.correctHeal,a.opponentMonCount,a.movementMultiplier];}))};
    });
    expect(matrix).toEqual({roster:37,count:1369,unchanged:true,finite:true,bounded:true,deterministic:true});
    expect(observations.errors).toEqual([]);expect(observations.failures).toEqual([]);
  });

  test("classic matchup applies Vibes HP/team size, Debugging damage, Caffeine timer, Jargon healing, and movement", async ({ page }) => {
    const observations = await boot(page);

    const underdog = await page.evaluate(() => {
      const ge = (0, eval), p = ge("player");
      p.slug = "alex-andrianavalontsalama";
      ge("restorePlayerHp")(true);
      ge('difficulty = "hard"');
      ge("startBattle")({ slug: "william-chan", type: "MCP", defeated: false });
      const b = ge("battle");
      ge("advanceBattle")(); // intro -> sendout
      ge("advanceBattle")(); // sendout -> question
      const timerAtQuestion = b.timerMs;
      const question = ge("currentMon")().q;
      ge("answerQuestion")((question.a + 1) % 4);
      return {
        maxHp: ge("currentPlayerMaxHp")(), hp: p.hp,
        damage: b.attributes.wrongDamage, heal: b.attributes.correctHeal,
        timerLimit: b.timerLimitMs, timerAtQuestion,
        mons: b.mons.length, movement: ge("currentMovementMultiplier")(),
        phase: b.phase, message: b.msg,
      };
    });
    expect(underdog).toEqual({
      maxHp: 96, hp: 68, damage: 28, heal: 0,
      timerLimit: 25000, timerAtQuestion: 25000,
      mons: 3, movement: 0.9, phase: "feedback",
      message: expect.stringContaining("hits you for 28"),
    });

    const creator = await page.evaluate(() => {
      const ge = (0, eval), p = ge("player");
      ge("battle = null"); ge('state = "overworld"');
      p.slug = "julien-hovan";
      ge("restorePlayerHp")(true);
      p.hp = p.dispHp = 90;
      ge('difficulty = "hard"');
      ge("startBattle")({ slug: "alex-andrianavalontsalama", type: "MCP", defeated: false });
      const b = ge("battle");
      ge("advanceBattle")(); ge("advanceBattle")();
      const question = ge("currentMon")().q;
      ge("answerQuestion")(question.a);
      const afterCorrect = {
        maxHp: ge("currentPlayerMaxHp")(), hp: p.hp,
        damage: b.attributes.wrongDamage, heal: b.attributes.correctHeal,
        timer: b.timerMs, mons: b.mons.length,
        movement: ge("currentMovementMultiplier")(), healed: b.feedback.healed,
        message: b.msg,
      };
      ge("battle = null"); ge('state = "overworld"');
      ge("coffeeUses = 1"); p.hp = 1; ge("drinkCoffee")();
      afterCorrect.coffeeHp = p.hp;
      return afterCorrect;
    });
    expect(creator).toEqual({
      maxHp: 110, hp: 98, damage: 21, heal: 8,
      timer: 35000, mons: 2, movement: 1.1, healed: 8,
      message: expect.stringContaining("Jargon restored 8 HP"),
      coffeeHp: 110,
    });

    expect(observations.errors).toEqual([]);
    expect(observations.failures).toEqual([]);
  });

  test("Agent Operations consumes the same bounded matchup damage, healing, HP, and timer", async ({ page }) => {
    const observations = await boot(page);

    const creator = await page.evaluate(() => {
      const ge = (0, eval), p = ge("player");
      p.slug = "julien-hovan"; ge("restorePlayerHp")(true); p.hp = p.dispHp = 90;
      ge('difficulty = "hard"');
      ge("startBattle")({ slug: "alex-andrianavalontsalama", type: "AGENT", defeated: false });
      const b = ge("battle");
      ge("_agentDispatch")(b, { type: "SELECT_ACTION", action: "query" });
      const question = b.agentOps.question;
      ge("_agentDispatch")(b, { type: "SUBMIT_ANSWER", index: question.correct != null ? question.correct : question.a });
      return {
        playerHp: p.hp, reducerHp: b.agentOps.playerHp, maxHp: b.agentOps.maxHp,
        wrongDamage: b.agentOps.wrongDamage, correctHeal: b.agentOps.correctHeal,
        healed: b.agentOps.outcome.healed, timer: b.timerLimitMs, message: b.msg,
      };
    });
    expect(creator).toEqual({
      playerHp: 98, reducerHp: 98, maxHp: 110,
      wrongDamage: 21, correctHeal: 8, healed: 8, timer: 35000,
      message: expect.stringContaining("Jargon restored 8 HP"),
    });

    const underdog = await page.evaluate(() => {
      const ge = (0, eval), p = ge("player");
      if (typeof AgentArena !== "undefined") AgentArena.reset();
      ge("battle = null"); ge('state = "overworld"');
      p.slug = "alex-andrianavalontsalama"; ge("restorePlayerHp")(true);
      ge('difficulty = "hard"');
      ge("startBattle")({ slug: "william-chan", type: "AGENT", defeated: false });
      const b = ge("battle");
      ge("_agentDispatch")(b, { type: "SELECT_ACTION", action: "query" });
      const question = b.agentOps.question;
      const correct = question.correct != null ? question.correct : question.a;
      ge("_agentDispatch")(b, { type: "SUBMIT_ANSWER", index: (correct + 1) % question.c.length });
      return {
        playerHp: p.hp, reducerHp: b.agentOps.playerHp, maxHp: b.agentOps.maxHp,
        wrongDamage: b.agentOps.wrongDamage, correctHeal: b.agentOps.correctHeal,
        timer: b.timerLimitMs, message: b.msg,
      };
    });
    expect(underdog).toEqual({
      playerHp: 68, reducerHp: 68, maxHp: 96,
      wrongDamage: 28, correctHeal: 0, timer: 25000,
      message: expect.stringContaining("You took 28 damage"),
    });

    expect(observations.errors).toEqual([]);
    expect(observations.failures).toEqual([]);
  });
});
