import { test, expect } from "@playwright/test";
import fs from "node:fs";

async function boot(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.DatamonPerformance?.getDiagnostics().firstTitleDrawMs > 0);
}
async function play(page) {
  await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => (0,eval)("state") === "dialogue");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (0,eval)("state") === "overworld");
  await page.waitForLoadState("networkidle");
}

test("title readiness waits for assets and a real game draw, not initial state", async ({ page }) => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await page.route("**/props/manifest.json", async route => { await hold; await route.continue(); });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.DatamonPerformance?.getDiagnostics().firstTitleDrawMs)).toBeNull();
  release();
  await page.waitForFunction(() => window.DatamonPerformance.getDiagnostics().firstTitleDrawMs > 0);
  expect(await page.evaluate(() => window.DatamonPerformance.getDiagnostics().bootReadyMs)).toBeGreaterThan(150);
});

test("selection browsing downloads no movement frames; confirmation retains one player", async ({ page }) => {
  const requests=[]; page.on("request", r=>requests.push(new URL(r.url()).pathname));
  await boot(page);
  expect(requests.filter(p=>p.startsWith("/sprites/"))).toEqual([]);
  await page.keyboard.press("Enter");
  for(let i=1;i<37;i++) await page.keyboard.press("ArrowRight");
  await page.waitForLoadState("networkidle");
  expect(requests.filter(p=>p.startsWith("/sprites-walk/") || p.startsWith("/sprites-locomotion-pilot/"))).toEqual([]);
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");
  const result=await page.evaluate(async()=>{
    const ge=(0,eval); await ge("loadWalkAnim")(ge("player.slug"));
    await ge("loadWalkAnim")("julien-hovan");
    await ge("loadWalkAnim")("duc-an-nguyen");
    return { slugs:Object.keys(ge("walkAnim")), pilots:Object.keys(ge("locomotionPilot")), loads:Object.keys(ge("walkAnimLoads")) };
  });
  expect(result).toEqual({slugs:["duc-an-nguyen"],pilots:[],loads:["duc-an-nguyen"]});
});

test("floor scratch is released and renderer memory is included", async ({ page }) => {
  await boot(page); await play(page);
  const result=await page.evaluate(()=>({floor:(0,eval)("floorTex"),memory:window.DatamonPerformance.getDiagnostics().memory}));
  expect(result.floor).toBeNull();
  expect(result.memory.mapBytes).toBeGreaterThan(0);
  expect(result.memory.floorBytes).toBe(0);
  expect(result.memory.rendererBytes).toBeGreaterThanOrEqual(0);
});

test("Question Hub freezes covered gameplay and avoids repeated dock mutations", async ({ page }) => {
  await boot(page); await play(page);
  await page.keyboard.press("q");
  const before=await page.evaluate(()=>{
    window.__dockMutations=0;
    new MutationObserver(list=>window.__dockMutations+=list.length).observe(document.getElementById("question-hub-toggle"),{attributes:true,childList:true});
    return {frame:(0,eval)("frame"),draws:window.DatamonPerformance.getDiagnostics().worldDraws};
  });
  await page.waitForTimeout(400);
  const after=await page.evaluate(()=>({frame:(0,eval)("frame"),draws:window.DatamonPerformance.getDiagnostics().worldDraws,mutations:window.__dockMutations}));
  expect(after.frame).toBe(before.frame); expect(after.draws).toBe(before.draws); expect(after.mutations).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect.poll(()=>page.evaluate(()=>window.DatamonPerformance.getDiagnostics().worldDraws)).toBeGreaterThan(before.draws);
});

for (const dpr of [1,2]) test(`DPR${dpr} cached title/Agent backgrounds match direct painting and invalidate safely`, async ({ browser }) => {
  const context=await browser.newContext({deviceScaleFactor:dpr,viewport:{width:1280,height:960}});
  try {
    const page=await context.newPage(); await boot(page);
    const result=await page.evaluate(()=>{
      const ge=(0,eval),width=ge("canvas").width,height=ge("canvas").height;
      function surface(){const cv=document.createElement("canvas");cv.width=width;cv.height=height;
        const c=cv.getContext("2d",{willReadFrequently:true});c.scale(width/800,height/608);c.imageSmoothingEnabled=false;return{cv,c};}
      function difference(a,b){const x=a.c.getImageData(0,0,width,height).data,y=b.c.getImageData(0,0,width,height).data;
        let channels=0,max=0;for(let i=0;i<x.length;i++){const delta=Math.abs(x[i]-y[i]);if(delta)channels++;max=Math.max(max,delta);}return{channels,max};}
      const titleDirect=surface(),titleCached=surface();ge("drawTitleBase")(titleDirect.c);
      titleCached.c.drawImage(ge("titleBackdropCv"),0,0,800,608);
      const title=difference(titleDirect,titleCached),agentDirect=surface(),agentCached=surface(),api=AgentArena;
      api.drawBackground(agentDirect.c,false);api.drawBackground(agentCached.c);
      const agent=difference(agentDirect,agentCached),before=api.getDiagnostics();
      api.drawBackground(agentCached.c);const stable=api.getDiagnostics().backgroundBuilds===before.backgroundBuilds;
      const optional=surface();optional.c.fillStyle="#123456";optional.c.fillRect(0,0,800,608);
      api.setOptionalLayers({backWall:optional.cv});api.drawBackground(agentCached.c);
      const invalidated=api.getDiagnostics().backgroundBuilds===before.backgroundBuilds+1;
      agentCached.cv.width=width===800?1600:800;agentCached.cv.height=height===608?1216:608;
      api.drawBackground(agentCached.c);
      const resized=api.getDiagnostics().backgroundBuilds===before.backgroundBuilds+2;
      api.reset();
      return{title,agent,stable,invalidated,resized,released:api.getDiagnostics().backgroundBytes};
    });
    expect(result.title).toEqual({channels:0,max:0});expect(result.agent).toEqual({channels:0,max:0});
    expect(result.stable).toBe(true);expect(result.invalidated).toBe(true);expect(result.resized).toBe(true);expect(result.released).toBe(0);
    await page.screenshot({path:`test-results/performance-title-dpr${dpr}.png`});
  } finally {await context.close();}
});

test("packed roster preserves source alpha, bounds and rendered trainer colors", async ({ page }) => {
  await boot(page);
  const result=await page.evaluate(async()=>{
    const ge=(0,eval),atlas=ge("rosterAtlasStore").roster,entries=ge("rosterAtlasEntries");
    await ge("loadImages")();
    const cv=document.createElement("canvas");cv.width=cv.height=256;
    const c=cv.getContext("2d",{willReadFrequently:true}),rows=[];
    for(const slug of ge("ROSTER")) {
      const e=entries.get(slug),original=ge("sprites")[slug];
      c.clearRect(0,0,256,256);c.drawImage(original,0,0);const a=c.getImageData(0,0,256,256).data;
      c.clearRect(0,0,256,256);c.drawImage(atlas,e.x,e.y,256,256,0,0,256,256);const b=c.getImageData(0,0,256,256).data;
      let max=0,alphaMismatch=0;
      for(let i=0;i<a.length;i+=4) {
        if(a[i+3]!==b[i+3])alphaMismatch++;
        // getImageData unpremultiplies low-alpha colors: a one-byte decoder rounding
        // difference can look like a large RGB error on an almost transparent edge.
        for(let channel=0;channel<3;channel++)max=Math.max(max,Math.abs(
          Math.round(a[i+channel]*a[i+3]/255)-Math.round(b[i+channel]*b[i+3]/255)));
      }
      const bounds=DatamonBattlePresentation.computeAlphaBounds(original);
      rows.push({slug,max,alphaMismatch,boundsMatch:JSON.stringify(bounds)===JSON.stringify(e.bounds)});
    }
    return rows;
  });
  expect(result).toHaveLength(37);
  expect(result.filter(r=>r.max>1||r.alphaMismatch!==0||!r.boundsMatch)).toEqual([]);
});

test("stale movement loads cannot repopulate an evicted character", async ({ page }) => {
  await boot(page);
  let release;const hold=new Promise(resolve=>release=resolve);
  await page.route("**/sprites-walk/julien-hovan/manifest.json",async route=>{await hold;await route.continue();});
  await page.evaluate(()=>{window.__oldWalk=(0,eval)("loadWalkAnim")("julien-hovan");});
  await page.evaluate(()=>(0,eval)("loadWalkAnim")("duc-an-nguyen"));
  release();await page.evaluate(()=>window.__oldWalk);
  await page.waitForTimeout(150);
  const result=await page.evaluate(()=>{const ge=(0,eval);return{walk:Object.keys(ge("walkAnim")),meta:Object.keys(ge("walkAnimMeta")),pilots:Object.keys(ge("locomotionPilot")),pending:ge("walkLoadRecord").cancelImages.size};});
  expect(result).toEqual({walk:["duc-an-nguyen"],meta:["duc-an-nguyen"],pilots:[],pending:0});
});

test("a stalled optional boot manifest times out into a drawable fallback", async ({ page }) => {
  test.setTimeout(25000);
  let release;const hold=new Promise(resolve=>release=resolve);
  await page.route("**/props/manifest.json",async route=>{await hold;await route.continue();});
  try {
    await boot(page);
    const d=await page.evaluate(()=>DatamonPerformance.getDiagnostics());
    expect(d.bootReadyMs).toBeGreaterThanOrEqual(12000);
    expect(d.firstTitleDrawMs).toBeGreaterThanOrEqual(d.bootReadyMs);
    await play(page);
  } finally {release();}
});

test("missing packed roster degrades once without blocking gameplay", async ({ page }) => {
  let attempts=0;
  await page.route("**/roster-atlas.webp",async route=>{attempts++;await route.fulfill({status:404,body:"missing"});});
  await boot(page);await play(page);
  expect(attempts).toBe(1);
  expect(await page.evaluate(()=>(0,eval)("sprites")[(0,eval)("player.slug")]?.naturalWidth)).toBe(256);
});

test("saved-player title stays movement-free and resume remains playable", async ({ page }) => {
  const source=fs.readFileSync("datamon/state.js","utf8");
  await page.addInitScript(source + '\n;{ const save=DatamonState.defaults();save.player="julien-hovan";localStorage.setItem("datamon-save-v1",JSON.stringify(save)); }');
  const requests=[];page.on("request",r=>requests.push(new URL(r.url()).pathname));
  await boot(page);
  expect(requests.filter(p=>p.startsWith("/sprites-walk/")||p.startsWith("/sprites-locomotion-pilot/"))).toEqual([]);
  await page.keyboard.press("Enter");
  await page.waitForFunction(()=>["overworld","dialogue"].includes((0,eval)("state")));
  await page.evaluate(()=>(0,eval)("loadWalkAnim")("julien-hovan"));
  expect(await page.evaluate(()=>Object.keys((0,eval)("walkAnim")))).toEqual(["julien-hovan"]);
});
