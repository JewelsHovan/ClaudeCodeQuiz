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
  await page.waitForFunction(() => (0, eval)("state") === "dialogue");
  await page.keyboard.press("Escape");
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

  test("compact seated rendering stays lower, occluded, and non-walking at DPR1/DPR2", async ({ browser }) => {
    for (const deviceScaleFactor of [1, 2]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor });
      const page = await context.newPage();
      const { errors, failedRequests } = await setup(page);
      await page.waitForFunction(() => {
        const ge=(0,eval), npc=ge("npcs").find(value => value._seated), frames=npc && ge("getSitFrames")(npc.slug);
        return !!(frames && frames.idle_0 && frames.idle_1 && ge('propStore["office-chair"]'));
      });

      const result = await page.evaluate(() => {
        const ge=(0,eval), ctx=ge("ctx"), canvas=ge("canvas"), scale=ge("scale");
        const npc=ge("npcs").find(value => value._seated), slug=npc.slug;
        const frames=ge("getSitFrames")(slug), chair=ge('propStore["office-chair"]');
        const geometry=ge("SEATED_DRAW_GEOMETRY"), cx=320, cy=240;

        function clearCanvas() {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.restore();
        }
        function alphaBounds() {
          const pixels=ctx.getImageData(0, 0, canvas.width, canvas.height), data=pixels.data;
          let minX=canvas.width, minY=canvas.height, maxX=-1, maxY=-1;
          for (let offset=3, pixel=0; offset<data.length; offset+=4, pixel++) if (data[offset]) {
            const x=pixel%canvas.width, y=Math.floor(pixel/canvas.width);
            minX=Math.min(minX,x); minY=Math.min(minY,y); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
          }
          if (maxX < 0) return null;
          return {
            top:minY/scale-cy, bottom:(maxY+1)/scale-cy,
            height:(maxY-minY+1)/scale, width:(maxX-minX+1)/scale,
          };
        }
        function render(seated, fallback) {
          const saved0=frames.idle_0, saved1=frames.idle_1;
          if (fallback) { frames.idle_0=null; frames.idle_1=null; }
          clearCanvas();
          if (seated) ctx.drawImage(chair, cx-16, cy-16, 32, 32);
          ge("drawCharacter")(cx,cy,slug,"up",false,false,false,seated);
          const bounds=alphaBounds();
          frames.idle_0=saved0; frames.idle_1=saved1;
          return bounds;
        }
        function captureCalls(draw) {
          const calls=[], nativeDrawImage=ctx.drawImage;
          ctx.drawImage=function(...args) { calls.push(args); return nativeDrawImage.apply(this,args); };
          try { draw(); } finally { ctx.drawImage=nativeDrawImage; }
          return calls;
        }
        function sourceAlphaBounds(image) {
          const cv=document.createElement("canvas"); cv.width=64; cv.height=64;
          const c=cv.getContext("2d"); c.drawImage(image,0,0,64,64);
          const data=c.getImageData(0,0,64,64).data;
          let minX=64,minY=64,maxX=-1,maxY=-1;
          for (let offset=3,pixel=0;offset<data.length;offset+=4,pixel++) if (data[offset]) {
            const x=pixel%64,y=Math.floor(pixel/64); minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
          }
          return {left:minX,top:minY,right:maxX+1,bottom:maxY+1,width:maxX-minX+1,height:maxY-minY+1};
        }

        const standing=render(false,false), seated=render(true,false), fallback=render(true,true);
        const chairCalls=captureCalls(() => ge("drawCharacter")(cx,cy,slug,"up",false,false,false,true));
        const foreground=chairCalls.find(args => args[0]===chair && args.length===9);

        const saved0=frames.idle_0, saved1=frames.idle_1;
        ge("_sitAnimPhase = 90");
        const originalReduced=window.AgentArena.prefersReducedMotion;
        window.AgentArena.prefersReducedMotion=()=>true;
        const reducedCalls=captureCalls(() => ge("drawCharacter")(cx,cy,slug,"up",false,false,false,true));
        window.AgentArena.prefersReducedMotion=()=>false;
        frames.idle_1=null;
        const partialCalls=captureCalls(() => ge("drawCharacter")(cx,cy,slug,"up",false,false,false,true));
        frames.idle_0=null;
        const fallbackCalls=captureCalls(() => ge("drawCharacter")(cx,cy,slug,"up",false,false,false,true));
        frames.idle_0=saved0; frames.idle_1=saved1;
        window.AgentArena.prefersReducedMotion=originalReduced;

        return {
          geometry:{...geometry}, standing, seated, fallback,
          assetBounds:sourceAlphaBounds(saved0),
          foreground:foreground ? {
            source:foreground.slice(1,5), destination:[foreground[5]-cx,foreground[6]-cy,foreground[7],foreground[8]],
          } : null,
          reducedUsesFrame0:reducedCalls.some(args => args[0]===saved0),
          reducedUsesFrame1:reducedCalls.some(args => args[0]===saved1),
          partialUsesFrame0:partialCalls.some(args => args[0]===saved0),
          fallbackNonChairImageCalls:fallbackCalls.filter(args => args[0]!==chair).length,
          frameIndexes:[
            ge("seatedFrameIndex")(0,false), ge("seatedFrameIndex")(59.9,false),
            ge("seatedFrameIndex")(60,false), ge("seatedFrameIndex")(119.9,false),
            ge("seatedFrameIndex")(90,true),
          ],
        };
      });

      expect(result.geometry).toMatchObject({
        poseSize:64, feetOffsetY:16, frameHoldTicks:60,
        chairForegroundSourceY:7, chairForegroundHeight:25,
        fallbackHeadWidth:18, fallbackHeadHeight:17, fallbackHeadTopOffsetY:-34,
      });
      expect(result.assetBounds.top).toBeGreaterThanOrEqual(13);
      expect(result.assetBounds.bottom).toBeLessThanOrEqual(50);
      expect(result.assetBounds.height).toBeLessThanOrEqual(37);
      expect(result.seated.top).toBeGreaterThan(result.standing.top);
      expect(result.seated.height).toBeLessThan(result.standing.height);
      expect(result.fallback.top).toBeGreaterThan(result.standing.top);
      expect(result.fallback.height).toBeLessThan(result.standing.height);
      expect(result.seated.bottom).toBe(result.fallback.bottom); // fixed chair/seat anchor
      expect(result.foreground).toEqual({source:[0,7,32,25],destination:[-16,-9,32,25]});
      expect(result.assetBounds.bottom - 48).toBeGreaterThan(-9); // pose overlaps foreground crop
      expect(result.frameIndexes).toEqual([0,0,1,1,0]);
      expect(result.reducedUsesFrame0).toBe(true);
      expect(result.reducedUsesFrame1).toBe(false);
      expect(result.partialUsesFrame0).toBe(true);
      expect(result.fallbackNonChairImageCalls).toBe(0); // no standing mini or front-facing portrait
      expect(errors).toEqual([]);
      expect(failedRequests).toEqual([]);
      await context.close();
    }
  });

  test("pending and failed sitting requests keep the compact procedural rear fallback", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const { errors, failedRequests } = await setup(page);
    const slug = await page.evaluate(() => (0,eval)("player.slug"));
    await page.route(`**/sprites-sit/${slug}/idle_*.png`, async route => {
      await new Promise(resolve => setTimeout(resolve, 60));
      await route.abort("failed");
    });

    const pending = await page.evaluate(() => {
      const ge=(0,eval), slug=ge("player.slug"), ctx=ge("ctx"), chair=ge('propStore["office-chair"]');
      ge("_sittingLoaded").delete(slug); delete ge("_sittingAssetStore")[slug];
      ge("loadSitAsset")(slug);
      const calls=[], nativeDrawImage=ctx.drawImage;
      ctx.drawImage=function(...args) { calls.push(args); return nativeDrawImage.apply(this,args); };
      try { ge("drawCharacter")(320,240,slug,"up",true,false,false,true); }
      finally { ctx.drawImage=nativeDrawImage; }
      return {
        requested:ge("_sittingLoaded").has(slug),
        nonChairImages:calls.filter(args => args[0]!==chair).length,
        chairForeground:calls.some(args => args[0]===chair && args.length===9),
      };
    });
    expect(pending).toEqual({ requested:true, nonChairImages:0, chairForeground:true });
    await expect.poll(() => failedRequests.filter(value => value.includes(`/sprites-sit/${slug}/`)).length).toBe(2);

    const failed = await page.evaluate(() => {
      const ge=(0,eval), slug=ge("player.slug"), ctx=ge("ctx"), chair=ge('propStore["office-chair"]');
      const entry=ge("_sittingAssetStore")[slug], calls=[], nativeDrawImage=ctx.drawImage;
      ctx.drawImage=function(...args) { calls.push(args); return nativeDrawImage.apply(this,args); };
      try { ge("drawCharacter")(320,240,slug,"up",true,false,false,true); }
      finally { ctx.drawImage=nativeDrawImage; }
      return {
        pending:entry.pending,
        failedFrames:[entry.idle_0,entry.idle_1],
        nonChairImages:calls.filter(args => args[0]!==chair).length,
        chairForeground:calls.some(args => args[0]===chair && args.length===9),
      };
    });
    expect(failed).toEqual({ pending:0, failedFrames:[null,null], nonChairImages:0, chairForeground:true });
    expect(errors).toHaveLength(2);
    expect(errors.every(value => value === "error: Failed to load resource: net::ERR_FAILED")).toBe(true);
    expect(failedRequests).toHaveLength(2);
    await context.close();
  });

  test("keyboard/pointer seating restores the approach tile and console reports real evidence", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1407, height: 853 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const { errors, failedRequests, requests } = await setup(page);

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
    expect(await page.evaluate(() => ({state:(0,eval)("state"),script:(0,eval)("dialogueSession.script.id"),open:(0,eval)("certConsoleOpen")})))
      .toEqual({state:"dialogue",script:"certification-console-arrival-v1",open:false});
    await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "overworld" && (0,eval)("certConsoleOpen"));
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

    const sittingRequests = countPaths(requests, "/sprites-sit/");
    expect(sittingRequests).toHaveLength(14); // six NPC slugs + one player slug, two frames each
    expect(new Set(sittingRequests).size).toBe(sittingRequests.length);
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
