// @ts-check
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const coreJs = fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/core.js"), "utf8");

async function setup(page) {
  const errors = [], failedRequests = [], requests = [];
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => { if (["error", "assert"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  page.on("requestfailed", request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", response => { if (response.status() >= 400) failedRequests.push(`${response.status()}: ${response.url()}`); });
  await page.addInitScript(coreJs);
  await page.goto("/");
  await page.waitForFunction(() => { try { return (0,eval)("state") === "title" && (0,eval)("officeMapCv") !== null; } catch { return false; } });
  await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => (0,eval)("state") === "overworld");
  return { errors, failedRequests, requests };
}

function count(paths, prefix) { return paths.filter(value => value.startsWith(prefix)); }

test.describe("Certification Spine office wayfinding and mentor reviews", () => {
  test("all roster selections preserve clear paths, destinations, and the exact wayfinding batch", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1407, height: 853 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const { errors, failedRequests, requests } = await setup(page);
    await page.waitForFunction(() => Object.values((0,eval)("wayfindingStore")).filter(Boolean).length === 9);

    const result = await page.evaluate(() => {
      const ge=(0,eval), roster=ge("ROSTER"), grid=ge("OFFICE_MAP"), solid=ge("SOLID"), seats=ge("OFFICE_SEATS"), mask=ge("OFFICE_PATH_MASK");
      const saved={slug:ge("player.slug"),domains:ge("_npcDomains"),defeated:ge("defeated")};
      const runs=[];
      function blockedStatic(x,y){return x<0||y<0||x>=36||y>=24||solid.has(grid[y][x])||seats.has(`${x},${y}`);}
      function routeDistance(occupied,from,to){const seen=new Set([from.join(",")]),q=[[...from,0]];while(q.length){const [x,y,d]=q.shift();if(x===to[0]&&y===to[1])return d;for(const [dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,k=`${nx},${ny}`;if(!seen.has(k)&&!blockedStatic(nx,ny)&&!occupied.has(k)){seen.add(k);q.push([nx,ny,d+1]);}}}return null;}
      for(const slug of roster){
        const p=ge("player");p.slug=slug;p.x=p.fx=18;p.y=p.fy=16;p.moving=false;
        ge("_npcDomains = {}");ge("defeated = new Set()");ge("placeNPCs")();
        const npcs=ge("npcs"),occupied=new Set(npcs.map(n=>`${n.x},${n.y}`));
        const reached=new Set(["18,16"]),queue=[[18,16]];
        while(queue.length){const [x,y]=queue.shift();for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,k=`${nx},${ny}`;if(!reached.has(k)&&!blockedStatic(nx,ny)&&!occupied.has(k)){reached.add(k);queue.push([nx,ny]);}}}
        const interactable=({x,y})=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>reached.has(`${x+dx},${y+dy}`));
        runs.push({slug,count:npcs.length,unique:occupied.size,seated:npcs.filter(n=>n._seated).length,
          pathHits:npcs.filter(n=>!n._seated&&mask.has(`${n.x},${n.y}`)).length,
          npcsReachable:npcs.every(interactable),seatsReachable:[...seats.values()].every(s=>interactable({x:s.col,y:s.row})),
          console:["17,5","18,5"].some(k=>reached.has(k)),doors:["7,14","11,22","24,22"].every(k=>reached.has(k)),
          battleDistance:routeDistance(occupied,[18,5],[11,22]),libraryDistance:routeDistance(occupied,[18,5],[24,22])});
      }
      const p=ge("player");p.slug=saved.slug;p.x=p.fx=18;p.y=p.fy=16;p.dir="down";
      window.__t49Domains=saved.domains;window.__t49Defeated=saved.defeated;
      ge("_npcDomains = window.__t49Domains");ge("defeated = window.__t49Defeated");ge("placeNPCs")();
      delete window.__t49Domains;delete window.__t49Defeated;
      function preview(x,y,dir){p.x=p.fx=x;p.y=p.fy=y;p.dir=dir;return ge("officeDestinationPreview")();}
      const previews={context:preview(7,14,"down"),battle:preview(11,22,"down"),library:preview(24,22,"down")};
      p.x=p.fx=18;p.y=p.fy=16;p.dir="down";
      const manifest=ge("wayfindingManifest"),store=ge("wayfindingStore");
      return {runs,pathCells:mask.size,removed:{column:grid[13][18],plantA:grid[11][11],plantB:grid[12][24]},
        removedProps:ge("PROP_PLACEMENTS").filter(item=>(item.slug==="radiator"&&item.row===22)||item.slug==="compass-sign").length,
        readinessBoards:ge("STUDY_PROP_PLACEMENTS").filter(item=>item.slug==="readiness-board").length,
        previews,manifestCount:manifest.length,loaded:Object.values(store).filter(Boolean).length,
        sourceSizes:manifest.map(entry=>[entry.id,store[entry.id].naturalWidth,store[entry.id].naturalHeight,entry.widthPx,entry.heightPx]),
        normalized:ge("normalizeWayfindingManifest")({batch:"bad",entries:[]}).length};
    });

    expect(result.pathCells).toBe(189);
    expect(result.removed).toEqual({ column:".", plantA:".", plantB:"." });
    expect(result.removedProps).toBe(0);
    expect(result.readinessBoards).toBe(0);
    expect(result.runs).toHaveLength(37);
    for (const run of result.runs) expect(run).toMatchObject({count:36,unique:36,seated:6,pathHits:0,npcsReachable:true,seatsReachable:true,console:true,doors:true,battleDistance:24,libraryDistance:23});
    expect(result.previews.context).toMatchObject({label:"Reliability Triage",purpose:"Review Context with bested mentors"});
    expect(result.previews.battle).toMatchObject({label:"Battle Room",purpose:"Test due concepts in safe rematches"});
    expect(result.previews.library).toMatchObject({label:"The Library",purpose:"Learn unseen material and rehearse"});
    expect(result.manifestCount).toBe(9); expect(result.loaded).toBe(9); expect(result.normalized).toBe(0);
    for (const [id,sw,sh,lw,lh] of result.sourceSizes) {
      expect(sw).toBe(lw*2); expect(sh).toBe(lh*2); expect(id).toMatch(/^(zone|door)-/);
    }
    const wayfindingRequests=count(requests,"/props-wayfinding/");
    expect(wayfindingRequests).toHaveLength(10); expect(new Set(wayfindingRequests).size).toBe(10);

    await page.evaluate(() => {const ge=(0,eval),p=ge("player");p.x=p.fx=11;p.y=p.fy=22;p.dir="down";ge("camFx = null");ge("camFy = null");});
    await page.waitForFunction(() => document.getElementById("datamon-announcer")?.textContent.includes("Test and retain due concepts"));
    expect(errors).toEqual([]); expect(failedRequests).toEqual([]);
    await context.close();
  });

  test("malformed wayfinding metadata fails closed to bounded navigation fallbacks", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1407, height: 853 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const malformed = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/props-wayfinding/manifest.json"), "utf8"));
    malformed.unexpected = "must fail exact schema";
    await page.route("**/props-wayfinding/manifest.json", route => route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(malformed)}));
    const {errors,failedRequests,requests}=await setup(page);
    const fallback=await page.evaluate(() => {const ge=(0,eval),p=ge("player");p.x=p.fx=11;p.y=p.fy=22;p.dir="down";return{manifest:ge("wayfindingManifest").length,store:Object.keys(ge("wayfindingStore")).length,map:[ge("officeMapCv").width,ge("officeMapCv").height],pathCells:ge("OFFICE_PATH_MASK").size,preview:ge("officeDestinationPreview")().label};});
    expect(fallback).toEqual({manifest:0,store:0,map:[2304,1536],pathCells:189,preview:"Battle Room"});
    expect(count(requests,"/props-wayfinding/")).toEqual(["/props-wayfinding/manifest.json"]);
    expect(errors).toEqual([]);expect(failedRequests).toEqual([]);
    await context.close();
  });

  test("defeated colleagues run exact-once keyboard and pointer mentor reviews without gameplay mutation", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1407, height: 853 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const { errors, failedRequests } = await setup(page);

    await page.evaluate(() => {
      const ge=(0,eval),npc=ge("npcs").find(n=>n.type==="AGENT"&&!n._seated),p=ge("player"),q=ge("QUESTION_BANK").AGENT[0];
      npc.defeated=true;ge("defeated").add(npc.slug);
      ge("questionStats = {}");ge("questionStats")[q.id]={seen:1,correct:0,wrong:2,lastSeen:1};ge("questionStats")["AGENT:0"]={seen:999,correct:999,wrong:0,lastSeen:999};ge("seenCounter = 25");ge("_evidenceRevision++");
      const dirs=[[0,1,"up"],[0,-1,"down"],[1,0,"left"],[-1,0,"right"]];
      const spot=dirs.map(([dx,dy,dir])=>({x:npc.x+dx,y:npc.y+dy,dir})).find(pos=>ge("walkable")(pos.x,pos.y));
      p.x=p.fx=spot.x;p.y=p.fy=spot.y;p.dir=spot.dir;p.moving=false;ge("camFx = null");ge("camFy = null");
      window.__mentorProtected={hp:p.hp,defeated:[...ge("defeated")].sort(),progression:JSON.stringify(ge("_progression")),library:JSON.stringify(ge("libraryProgress")),scores:JSON.stringify(ge("minigameScores")),position:[p.x,p.y]};window.__mentorNpc=npc.slug;
    });
    await page.waitForTimeout(50);
    const openPoint=await page.evaluate(() => {const ge=(0,eval),npc=ge("npcs").find(value=>value.slug===window.__mentorNpc),canvas=document.getElementById("game"),r=canvas.getBoundingClientRect();const sx=(npc.x-ge("camFx"))*ge("TILE")+ge("TILE")/2,sy=(npc.y-ge("camFy"))*ge("TILE")+ge("TILE")/2;return{x:r.left+sx/ge("CANVAS_W")*r.width,y:r.top+sy/ge("CANVAS_H")*r.height};});
    await page.mouse.click(openPoint.x,openPoint.y);
    const opened = await page.evaluate(() => {const ge=(0,eval),mr=ge("mentorReview"),p=ge("player"),canonical=ge("questionStats")[mr.question.id],alias=ge("questionStats")[`${mr.review.domain}:${mr.review.index}`];return{phase:mr.phase,answered:mr.answered,domain:mr.review.domain,reason:mr.review.reason,id:mr.question.id,seenCounter:ge("seenCounter"),canonical,alias,position:[p.x,p.y],mentorLine:mr.mentorLine,announcement:document.getElementById("datamon-announcer").textContent};});
    expect(opened).toMatchObject({phase:"question",answered:false,domain:"AGENT",reason:"due",id:"agent-001",seenCounter:26,position:expect.any(Array)});
    expect(opened.canonical).toEqual(opened.alias); expect(opened.canonical).toMatchObject({seen:2,correct:0,wrong:2,lastSeen:26});
    expect(opened.mentorLine.length).toBeGreaterThan(10);
    expect(opened.announcement).toContain("1,"); expect(opened.announcement).toContain("4,"); expect(opened.announcement).toContain("Escape to close");

    const positionBefore=opened.position;
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => {const ge=(0,eval),p=ge("player");return{sel:ge("mentorReview.sel"),position:[p.x,p.y],moving:p.moving};})).toEqual({sel:1,position:positionBefore,moving:false});
    await page.keyboard.down("Enter");
    const feedback=await page.evaluate(() => {const ge=(0,eval),mr=ge("mentorReview"),st=ge("questionStats")[mr.question.id];return{phase:mr.phase,answered:mr.answered,consumed:mr.answerEvent.consumed,sel:mr.sel,wrong:st.wrong,correct:st.correct};});
    expect(feedback).toEqual({phase:"feedback",answered:true,consumed:true,sel:1,wrong:3,correct:0});
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",repeat:true,bubbles:true})));
    expect(await page.evaluate(() => ({open:!!(0,eval)("mentorReview"),wrong:(0,eval)("questionStats")["agent-001"].wrong}))).toEqual({open:true,wrong:3});
    await page.keyboard.up("Enter"); await page.keyboard.press("Enter");
    expect(await page.evaluate(() => !!(0,eval)("mentorReview"))).toBe(false);

    const protectedAfter=await page.evaluate(() => {const ge=(0,eval),p=ge("player"),before=window.__mentorProtected;return{hp:p.hp,defeated:[...ge("defeated")].sort(),progression:JSON.stringify(ge("_progression")),library:JSON.stringify(ge("libraryProgress")),scores:JSON.stringify(ge("minigameScores")),position:[p.x,p.y],before};});
    expect({...protectedAfter,before:undefined}).toEqual({...protectedAfter.before,before:undefined});

    // Pointer path: reopen, click the canonical correct row, then click the visible close control.
    const reopened=await page.evaluate(() => {const ge=(0,eval),npc=ge("npcs").find(value=>value.slug===window.__mentorNpc);ge("openMentorReview")(npc);return{state:ge("state"),map:ge("currentMap"),npc:!!npc,training:npc&&!!npc.training,open:!!ge("mentorReview")};});
    expect(reopened).toEqual({state:"overworld",map:"office",npc:true,training:false,open:true});
    const clickTarget=await page.evaluate(() => {const ge=(0,eval),mr=ge("mentorReview"),ctx=ge("ctx"),mx=60,my=80,mw=680;ctx.font="13px monospace";const lines=ge("wrapText")(mr.question.q,mw-40);const qy=my+72+lines.length*18+12;const correct=mr.question.a;return{x:mx+100,y:qy+correct*36+17,correct};});
    const canvasBox=await page.locator("#game").boundingBox();
    await page.mouse.click(canvasBox.x+clickTarget.x*(canvasBox.width/800),canvasBox.y+clickTarget.y*(canvasBox.height/608));
    expect(await page.evaluate(() => {const mr=(0,eval)("mentorReview");return{phase:mr.phase,sel:mr.sel,correct:mr.feedback.correct};})).toEqual({phase:"feedback",sel:clickTarget.correct,correct:true});
    await page.mouse.click(canvasBox.x+(60+680-56)*(canvasBox.width/800),canvasBox.y+(80+23)*(canvasBox.height/608));
    expect(await page.evaluate(() => !!(0,eval)("mentorReview"))).toBe(false);

    // Close-before-answer records only the reveal.
    const beforeEscape=await page.evaluate(() => (0,eval)("questionStats")["agent-001"].wrong);
    await page.evaluate(() => {const ge=(0,eval),npc=ge("npcs").find(value=>value.slug===window.__mentorNpc);ge("openMentorReview")(npc);}); await page.keyboard.press("Escape");
    expect(await page.evaluate(() => ({open:!!(0,eval)("mentorReview"),wrong:(0,eval)("questionStats")["agent-001"].wrong}))).toEqual({open:false,wrong:beforeEscape});

    const persistedBeforeReload=await page.evaluate(() => {const ge=(0,eval),save=ge("getSave")();return{schemaVersion:save.schemaVersion,stats:save.questionStats["agent-001"],alias:save.questionStats["AGENT:0"],seenCounter:save.seenCounter,defeated:save.defeated,progression:save.progression,library:save.libraryProgress,scores:save.minigameScores};});
    // Let lazy portrait/sitting requests settle so navigation itself does not manufacture expected ERR_ABORTED noise.
    await page.waitForLoadState("networkidle");
    await page.reload(); await page.waitForFunction(() => (0,eval)("state") === "title");
    const persistedAfterReload=await page.evaluate(() => {const ge=(0,eval),save=ge("getSave")();return{schemaVersion:save.schemaVersion,stats:save.questionStats["agent-001"],alias:save.questionStats["AGENT:0"],seenCounter:save.seenCounter,defeated:save.defeated,progression:save.progression,library:save.libraryProgress,scores:save.minigameScores};});
    expect(persistedAfterReload).toEqual(persistedBeforeReload); expect(persistedAfterReload.schemaVersion).toBe(2); expect(persistedAfterReload.stats).toEqual(persistedAfterReload.alias);
    expect(errors).toEqual([]); expect(failedRequests).toEqual([]);
    await context.close();
  });
});
