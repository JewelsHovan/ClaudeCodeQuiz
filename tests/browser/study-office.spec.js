// @ts-check
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const coreJs = fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/core.js"), "utf8");

async function setup(page) {
  const errors = [], failedRequests = [], requests = [];
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => {
    if (["error", "assert"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  page.on("requestfailed", request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", response => { if (response.status() >= 400) failedRequests.push(`${response.status()}: ${response.url()}`); });
  await page.addInitScript(coreJs);
  await page.goto("/");
  await page.waitForFunction(() => { try { return (0, eval)("state") === "title" && (0, eval)("officeMapCv") !== null; } catch { return false; } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (0, eval)("state") === "overworld");
  return { errors, failedRequests, requests };
}

function countPaths(paths, prefix) {
  return paths.filter(value => value.startsWith(prefix));
}

test.describe("Sittable study office and Certification Console", () => {
  test("explicit seats, seated colleagues, and true-2x study assets preserve navigation", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1407, height: 853 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const { errors, failedRequests, requests } = await setup(page);
    await page.waitForFunction(() => (0, eval)("_sittingLoaded").size >= 6);
    const result = await page.evaluate(() => {
      const ge = (0, eval), list = ge("npcs"), seats = ge("OFFICE_SEATS"), assignments = ge("NPC_SEAT_ASSIGNMENTS");
      const seated = list.filter(npc => npc._seated);
      const seatedKeys = new Set(seated.map(npc => `${npc.x},${npc.y}`));
      const standingChairCollisions = list.filter(npc => !npc._seated && seats.has(`${npc.x},${npc.y}`));
      const grid = ge("OFFICE_MAP"), solid = ge("SOLID");
      const occupied = new Set(list.map(npc => `${npc.x},${npc.y}`));
      const blocked = (x, y) => solid.has(grid[y][x]) || seats.has(`${x},${y}`) || occupied.has(`${x},${y}`);
      const start = ge("OFFICE_ENTRY"), seen = new Set([start.join(",")]), queue = [start];
      while (queue.length) {
        const [x, y] = queue.shift();
        for (const [nx, ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]) {
          const key = `${nx},${ny}`;
          if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[ny].length || blocked(nx, ny) || seen.has(key)) continue;
          seen.add(key); queue.push([nx, ny]);
        }
      }
      const interactable = ({x,y}) => [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => seen.has(`${x+dx},${y+dy}`));
      window.__studyOfficeSaved = { currentMap: ge("currentMap"), map: ge("map"), npcs: ge("npcs") };
      ge('currentMap = "library"'); ge("map = LIBRARY_MAP"); ge("npcs = []");
      const noCrossMapLeak = ge("walkable")(14, 20);
      ge("currentMap = window.__studyOfficeSaved.currentMap");
      ge("map = window.__studyOfficeSaved.map");
      ge("npcs = window.__studyOfficeSaved.npcs");
      delete window.__studyOfficeSaved;
      return {
        seatCount: seats.size,
        assignedCount: assignments.size,
        seatedCount: seated.length,
        uniqueSeated: seatedKeys.size,
        matchingDomains: seated.every(npc => assignments.get(`${npc.x},${npc.y}`) === npc.type),
        standingChairCollisions: standingChairCollisions.length,
        freePlayerSeats: ge("PLAYER_SEAT_KEYS").filter(key => !occupied.has(key)).length,
        allNpcsInteractable: list.every(interactable),
        allSeatsInteractable: [...seats.values()].every(seat => interactable({ x: seat.col, y: seat.row })),
        consoleApproach: seen.has("17,5") || seen.has("18,5"),
        noCrossMapLeak,
        manifest: ge("studyPropManifest").map(entry => [entry.slug, entry.sourceScale, entry.sourceWidthPx, entry.widthPx]),
        loadedStudyProps: Object.values(ge("studyPropStore")).filter(Boolean).length,
        sittingRequests: ge("_sittingLoaded").size,
      };
    });
    expect(result).toMatchObject({
      seatCount: 10, assignedCount: 6, seatedCount: 6, uniqueSeated: 6,
      matchingDomains: true, standingChairCollisions: 0, freePlayerSeats: 4,
      allNpcsInteractable: true, allSeatsInteractable: true, consoleApproach: true,
      noCrossMapLeak: true, loadedStudyProps: 5, sittingRequests: 6,
    });
    expect(result.manifest).toEqual([
      ["certification-console", 2, 128, 64], ["readiness-board", 2, 192, 96],
      ["desk-study-kit", 2, 128, 64], ["task-lamp", 2, 64, 32],
      ["screen-ambient", 2, 512, 64],
    ]);
    const studyRequests = countPaths(requests, "/props-study/");
    expect(studyRequests).toHaveLength(6); // manifest + five accepted assets
    expect(new Set(studyRequests).size).toBe(studyRequests.length);
    expect(countPaths(requests, "/sprites-sit/")).toHaveLength(12);
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
    await context.close();
  });

  test("keyboard/pointer seating restores the approach tile and console reports real evidence", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1407, height: 853 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const { errors, failedRequests } = await setup(page);

    await page.evaluate(() => {
      const ge=(0,eval), p=ge("player");
      p.x=p.fx=14; p.y=p.fy=21; p.dir="up"; p.moving=false;
      ge("camFx = null"); ge("camFy = null");
    });
    await page.keyboard.press("Space");
    await page.waitForFunction(() => !!(0,eval)("player.seated") && !!(0,eval)("getSitFrames")( (0,eval)("player.slug") ).idle_0);
    expect(await page.evaluate(() => { const p=(0,eval)("player"); return {x:p.x,y:p.y,dir:p.dir,seated:{...p.seated}}; })).toEqual({
      x:14, y:20, dir:"up", seated:{seatX:14,seatY:20,returnX:14,returnY:21},
    });
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => { const p=(0,eval)("player"); return {x:p.x,y:p.y,seated:p.seated}; }))
      .toEqual({ x:14, y:21, seated:null });

    // Pointer face-and-interact parity on the second free Prompt Studio chair.
    await page.evaluate(() => {
      const ge=(0,eval), p=ge("player"); p.x=p.fx=20; p.y=p.fy=21; p.dir="up"; p.moving=false;
      ge("camFx = null"); ge("camFy = null");
    });
    await page.waitForTimeout(50);
    const point = await page.evaluate(() => {
      const ge=(0,eval), p=ge("player"), canvas=document.getElementById("game"), r=canvas.getBoundingClientRect();
      const sx=(p.fx-ge("camFx"))*ge("TILE")+ge("TILE")/2;
      const sy=(p.fy-ge("camFy"))*ge("TILE")+ge("TILE")/2-60;
      return {x:r.left+sx/ge("CANVAS_W")*r.width,y:r.top+sy/ge("CANVAS_H")*r.height};
    });
    await page.mouse.click(point.x, point.y);
    expect(await page.evaluate(() => ({ x:(0,eval)("player").x, y:(0,eval)("player").y, seated:!!(0,eval)("player").seated })))
      .toEqual({ x:20, y:20, seated:true });
    await page.keyboard.press("Space");
    expect(await page.evaluate(() => ({ x:(0,eval)("player").x, y:(0,eval)("player").y, seated:(0,eval)("player").seated })))
      .toEqual({ x:20, y:21, seated:null });

    // Seed canonical evidence: every domain is strong except MCP, then open the real console.
    await page.evaluate(() => {
      const ge=(0,eval), bank=ge("QUESTION_BANK"), stats=ge("questionStats");
      for (const key of ["AGENT","CONFIG","PROMPT","CONTEXT"]) for (const q of bank[key]) {
        stats[q.id]={seen:1,correct:1,wrong:0,lastSeen:100};
      }
      for (const q of bank.MCP) stats[q.id]={seen:1,correct:0,wrong:1,lastSeen:100};
      ge("seenCounter = 100"); ge("_evidenceRevision++");
      const p=ge("player"); p.x=p.fx=17; p.y=p.fy=5; p.dir="up"; p.moving=false;
      ge("interact")();
    });
    expect(await page.evaluate(() => {
      const ge=(0,eval), summary=ge("_getEvidenceSummary")(), p=ge("player");
      return {open:ge("certConsoleOpen"), evidence:summary.evidencePct, next:summary.recommendationKey, pos:[p.x,p.y]};
    })).toEqual({open:true,evidence:82,next:"MCP",pos:[17,5]});
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => ({sel:(0,eval)("certConsoleSel"),pos:[(0,eval)("player").x,(0,eval)("player").y]})))
      .toEqual({sel:1,pos:[17,5]});

    // Click the CONFIG row, then the explicit close label.
    const canvasBox = await page.locator("#game").boundingBox();
    if (!canvasBox) throw new Error("canvas missing");
    const logicalToPage = (x,y) => ({x:canvasBox.x+x/800*canvasBox.width,y:canvasBox.y+y/608*canvasBox.height});
    const configPoint = logicalToPage(250, 166 + 2*40 + 18);
    await page.mouse.click(configPoint.x, configPoint.y);
    expect(await page.evaluate(() => (0,eval)("certConsoleSel"))).toBe(2);
    expect(await page.locator("#datamon-announcer").textContent()).toContain("Config Bay");
    const closePoint = logicalToPage(700, 70);
    await page.mouse.click(closePoint.x, closePoint.y);
    expect(await page.evaluate(() => (0,eval)("certConsoleOpen"))).toBe(false);

    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
    await context.close();
  });

  test("contextual dialogue covers campaign, training, and evidence-aware follow-up", async ({ page }) => {
    const { errors, failedRequests } = await setup(page);
    const messages = await page.evaluate(() => {
      const ge=(0,eval), classic=ge("npcs").find(n=>n.type!=="AGENT"), expectedIntro=window.DatamonDialogue.battleIntro(classic.slug,classic.type,ge("displayName"));
      ge("startBattle")(classic); const intro=ge("battle").msg; ge("battle = null"); ge('state = "overworld"');
      ge('currentMap = "battleRoom"');
      const trainingNpc={...classic,training:true,defeated:false}; ge("startBattle")(trainingNpc); const training=ge("battle").msg;
      const expectedTraining=window.DatamonDialogue.trainingRematch(trainingNpc.slug,trainingNpc.type,ge("displayName"));
      ge("battle = null"); ge('state = "overworld"'); ge('currentMap = "office"'); ge("map = OFFICE_MAP");
      const q=ge("QUESTION_BANK")[classic.type][0]; ge("questionStats")[q.id]={seen:1,correct:0,wrong:1,lastSeen:0}; ge("seenCounter = 20"); ge("_evidenceRevision++");
      const follow=window.DatamonDialogue.campaignFollowUp(classic.slug,classic.type,ge("displayName"),window.DatamonProgress.domainSummary(ge("QUESTION_BANK"),ge("questionStats"),20,classic.type));
      return {intro,expectedIntro,training,expectedTraining,follow};
    });
    expect(messages.intro).toBe(messages.expectedIntro);
    expect(messages.training).toBe(messages.expectedTraining);
    expect(messages.follow).toContain("due here");
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});
