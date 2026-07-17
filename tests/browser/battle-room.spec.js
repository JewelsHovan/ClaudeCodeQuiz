// @ts-check
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const coreJs = fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/core.js"), "utf8");

async function setup(page) {
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error" || message.type() === "assert") errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("requestfailed", request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", response => { if (response.status() >= 400) failedRequests.push(`${response.status()}: ${response.url()}`); });
  await page.addInitScript(coreJs);
  await page.goto("/");
  await page.waitForFunction(() => {
    try { return (0, eval)("state") === "title" && (0, eval)("officeMapCv") !== null; }
    catch (_) { return false; }
  });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => { try { return (0, eval)("state") === "overworld"; } catch (_) { return false; } });
  return { errors, failedRequests };
}

async function enterBattleRoom(page) {
  await page.evaluate(() => (0, eval)("enterBattleRoom")());
  await page.waitForFunction(() => {
    try { return (0, eval)("currentMap") === "battleRoom" && (0, eval)("battleRoomMapCv") !== null; }
    catch (_) { return false; }
  });
}

async function currentCorrectIndex(page) {
  return page.evaluate(() => {
    const q = (0, eval)("battle.agentOps.question");
    return q.correct != null ? q.correct : q.a;
  });
}

async function acknowledgeAgent(page) {
  await page.evaluate(() => { (0, eval)("battle").msgAt = -1e9; });
  await page.keyboard.press("Enter");
}

async function playAgentQuery(page) {
  await page.keyboard.press("Enter");
  await page.keyboard.press(String((await currentCorrectIndex(page)) + 1));
}

test.describe("DATAMON Battle Room and location instrument", () => {
  test("DPR2 architecture, room identities, roster ring, and adjacent pointer entry are complete", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1407, height: 853 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const { errors, failedRequests } = await setup(page);

    const officeLocations = await page.evaluate(() => {
      const ge = (0, eval);
      const p = ge("player");
      return [[2,2],[14,2],[26,2],[2,14],[14,14],[26,14]].map(([x,y]) => {
        p.x = p.fx = x; p.y = p.fy = y;
        return [ge("locationHudLabel")(), ge("locationHudPurpose")()];
      });
    });
    expect(officeLocations).toEqual([
      ["Agent Wing", "Debrief agent strategy with mentors"],
      ["MCP Lab", "Review tool interfaces with mentors"],
      ["Config Bay", "Audit settings and deployment with mentors"],
      ["Context Corner", "Triage context reliability with mentors"],
      ["Prompt Studio", "Critique prompts with mentors"],
      ["The Lounge", "Review your recommended weak domain"],
    ]);

    await enterBattleRoom(page);
    const room = await page.evaluate(() => {
      const ge = (0, eval), list = ge("npcs"), grid = ge("BATTLE_ROOM_MAP"), solid = ge("SOLID");
      const occupied = new Set(list.map(n => `${n.x},${n.y}`));
      const entry = ge("BATTLE_ROOM_ENTRY");
      const seen = new Set([entry.join(",")]), queue = [entry];
      while (queue.length) {
        const [x,y] = queue.shift();
        for (const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]) {
          const key = `${nx},${ny}`;
          if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[ny].length || solid.has(grid[ny][nx]) || occupied.has(key) || seen.has(key)) continue;
          seen.add(key); queue.push([nx,ny]);
        }
      }
      const unreachable = list.filter(n => ![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => seen.has(`${n.x+dx},${n.y+dy}`)));
      const diagnostics = window.DatamonWorldArt.getDiagnostics();
      return {
        label: ge("locationHudLabel")(), purpose: ge("locationHudPurpose")(),
        count: list.length, unique: new Set(list.map(n => n.slug)).size,
        selectedAbsent: !list.some(n => n.slug === ge("player").slug),
        allTraining: list.every(n => n.training && !n.defeated),
        domains: [...new Set(list.map(n => n.type))].sort(), unreachable: unreachable.length,
        entryClear: !occupied.has(entry.join(",")), mapScale: ge("battleRoomMapCv").detailScale,
        mapSize: [ge("battleRoomMapCv").width, ge("battleRoomMapCv").height],
        battleWallLoaded: diagnostics.loadedAssetIds.includes("hd-architecture-battle-wall"),
        libraryCold: ge("libraryMapCv") === null,
        noFloorLabels: (() => { try { ge("OVERWORLD_LABELS"); return false; } catch (_) { return true; } })(),
        noDiagonalReflection: !ge("drawLivingWorldAmbient").toString().includes("glassX"),
      };
    });
    expect(room).toMatchObject({
      label: "Battle Room", purpose: "Test due concepts in safe rematches", count: 36, unique: 36,
      selectedAbsent: true, allTraining: true, unreachable: 0, entryClear: true,
      mapScale: 2, mapSize: [2304, 1536], battleWallLoaded: true, libraryCold: true,
      noFloorLabels: true, noDiagonalReflection: true,
    });
    expect(room.domains).toEqual(["AGENT", "CONFIG", "CONTEXT", "MCP", "MIX", "PROMPT"]);

    // Put the player immediately west of a colleague, let one frame settle the camera,
    // then click east of the player. Pointer input must face-and-interact, not stall on collision.
    const target = await page.evaluate(() => {
      const ge = (0, eval), target = ge("npcs")[0], p = ge("player");
      p.x = p.fx = target.x - 1; p.y = p.fy = target.y; p.dir = "right"; p.moving = false;
      ge("camFx = null"); ge("camFy = null");
      return { slug: target.slug };
    });
    await page.waitForTimeout(50);
    const point = await page.evaluate(() => {
      const ge = (0, eval), p = ge("player"), canvas = document.getElementById("game"), r = canvas.getBoundingClientRect();
      const sx = (p.fx - ge("camFx")) * ge("TILE") + ge("TILE") / 2 + 70;
      const sy = (p.fy - ge("camFy")) * ge("TILE") + ge("TILE") / 2;
      return { x: r.left + sx / ge("CANVAS_W") * r.width, y: r.top + sy / ge("CANVAS_H") * r.height };
    });
    await page.mouse.click(point.x, point.y);
    expect(await page.evaluate(slug => {
      const ge = (0, eval);
      return ge("state") === "transition" && ge("battleTransition").npc.slug === slug;
    }, target.slug)).toBe(true);
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
    await context.close();
  });

  test("competing lazy warps cancel stale caches and preserve the active scene", async ({ browser }) => {
    async function runRace(staleScene) {
      const context = await browser.newContext({ viewport: { width: 1407, height: 853 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      const slowFile = staleScene === "library"
        ? "hd-architecture-library-wall.png" : "hd-architecture-battle-wall.png";
      await page.route(`**/${slowFile}`, async route => {
        await new Promise(resolve => setTimeout(resolve, 180));
        await route.continue();
      });
      const { errors, failedRequests } = await setup(page);
      if (staleScene === "library") {
        await page.evaluate(() => {
          const ge = (0, eval); ge("enterLibrary")(); window.__staleLoad = ge("libraryLoadPromise"); ge("enterBattleRoom")();
        });
        await page.waitForFunction(() => (0, eval)("currentMap") === "battleRoom");
      } else {
        await page.evaluate(() => {
          const ge = (0, eval); ge("enterBattleRoom")(); window.__staleLoad = ge("battleRoomLoadPromise"); ge("enterLibrary")();
        });
        await page.waitForFunction(() => (0, eval)("currentMap") === "library");
      }
      await page.evaluate(() => window.__staleLoad);
      await page.waitForTimeout(50);
      const result = await page.evaluate(() => {
        const ge = (0, eval);
        return {
          map: ge("currentMap"), library: !!ge("libraryMapCv"), battleRoom: !!ge("battleRoomMapCv"),
          caches: [ge("officeMapCv"), ge("libraryMapCv"), ge("battleRoomMapCv")].filter(Boolean).length,
          ambientInstances: window.DatamonWorldArt.getDiagnostics().ambientInstances,
        };
      });
      expect(errors).toEqual([]);
      expect(failedRequests).toEqual([]);
      await context.close();
      return result;
    }

    expect(await runRace("library")).toEqual({ map: "battleRoom", library: false, battleRoom: true, caches: 2, ambientInstances: 0 });
    expect(await runRace("battleRoom")).toEqual({ map: "library", library: true, battleRoom: false, caches: 2, ambientInstances: 2 });
  });

  test("classic training rematches persist telemetry/streaks without campaign mutation", async ({ page }) => {
    const { errors, failedRequests } = await setup(page);
    const campaignSlug = await page.evaluate(() => {
      const ge = (0, eval), office = ge("npcs"), slug = office[0].slug;
      office[0].defeated = true; ge("defeated").add(slug); ge("save")(); return slug;
    });
    await enterBattleRoom(page);
    const target = await page.evaluate(() => {
      const ge = (0, eval), target = ge("npcs").find(n => n.type !== "AGENT");
      ge("player").hp = 5; ge("startBattle")(target); return target.slug;
    });
    expect(await page.evaluate(() => ({
      training: (0, eval)("battle.training"), hp: (0, eval)("player.hp"), maxHp: (0, eval)("currentPlayerMaxHp")(),
    }))).toEqual({ training: true, hp: 96, maxHp: 96 });

    // Reach one real question so canonical/legacy learning telemetry still records.
    await page.evaluate(() => { const ge = (0, eval); ge("advanceBattle")(); ge("advanceBattle")(); });
    const correct = await page.evaluate(() => (0, eval)("currentMon").call(null).q.a);
    await page.evaluate(index => (0, eval)("answerQuestion")(index), correct);
    await page.evaluate(() => { const ge = (0, eval), b = ge("battle"); b.phase = "win"; ge("advanceBattle")(); });

    let result = await page.evaluate(({ targetSlug, campaign }) => {
      const ge = (0, eval), br = ge("_progression").activities.battleRoom;
      return { map: ge("currentMap"), streak: { ...br }, campaign: [...ge("defeated")], targetDefeated: ge("npcs").find(n => n.slug === targetSlug).defeated,
        correct: Object.values(ge("questionStats")).reduce((sum, stat) => sum + stat.correct, 0), campaignStill: ge("defeated").has(campaign) };
    }, { targetSlug: target, campaign: campaignSlug });
    expect(result).toMatchObject({ map: "battleRoom", streak: { currentStreak: 1, bestStreak: 1, wins: 1 }, targetDefeated: false, campaignStill: true });
    expect(result.campaign).toEqual([campaignSlug]);
    expect(result.correct).toBeGreaterThan(0);

    // Same colleague is immediately rematchable; a loss resets current but preserves best/wins.
    await page.evaluate(slug => { const ge = (0, eval), npc = ge("npcs").find(n => n.slug === slug); ge("startBattle")(npc); ge("battle").phase = "win"; ge("advanceBattle")(); }, target);
    await page.evaluate(slug => { const ge = (0, eval), npc = ge("npcs").find(n => n.slug === slug); ge("startBattle")(npc); ge("battle").phase = "lose"; ge("advanceBattle")(); }, target);
    result = await page.evaluate(() => {
      const ge = (0, eval), br = ge("_progression").activities.battleRoom;
      return { streak: { ...br }, hp: ge("player").hp, maxHp: ge("currentPlayerMaxHp")(), map: ge("currentMap"), saved: JSON.parse(localStorage.getItem("datamon-save-v1")).progression.activities.battleRoom };
    });
    expect(result).toEqual({ streak: { currentStreak: 0, bestStreak: 2, wins: 2 }, hp: 96, maxHp: 96, map: "battleRoom", saved: { currentStreak: 0, bestStreak: 2, wins: 2 } });
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("Agent Operations training wins once and returns to the Battle Room", async ({ page }) => {
    const { errors, failedRequests } = await setup(page);
    await enterBattleRoom(page);
    const target = await page.evaluate(() => {
      const ge = (0, eval), npc = ge("npcs").find(n => n.type === "AGENT");
      window.TEXT_SPEED_OVERRIDE = 10000; ge("startBattle")(npc); return npc.slug;
    });
    expect(await page.evaluate(() => (0, eval)("battle.agentOps.boss"))).toBe(false);

    for (let turn = 0; turn < 3; turn++) {
      await playAgentQuery(page);
      await acknowledgeAgent(page);
      if (turn < 2) await acknowledgeAgent(page);
    }
    const victory = await page.evaluate(slug => {
      const ge = (0, eval), br = ge("_progression").activities.battleRoom;
      return { phase: ge("battle.agentOps.phase"), defeated: ge("defeated").has(slug), npcDefeated: ge("npcs").find(n => n.slug === slug).defeated, streak: { ...br } };
    }, target);
    expect(victory).toEqual({ phase: "victory", defeated: false, npcDefeated: false, streak: { currentStreak: 1, bestStreak: 1, wins: 1 } });
    await acknowledgeAgent(page);
    expect(await page.evaluate(() => ({ state: (0, eval)("state"), map: (0, eval)("currentMap") })))
      .toEqual({ state: "overworld", map: "battleRoom" });
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});
