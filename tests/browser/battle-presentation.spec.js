// @ts-check
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const coreJs = fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/core.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/battlemons/manifest.json"), "utf8"));

async function boot(page, options = {}) {
  const errors = [], failures = [], requests = [];
  if (options.reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  if (options.manifest) {
    await page.route("**/battlemons/manifest.json", route => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(options.manifest),
    }));
  }
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => {
    if (["error", "assert"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("requestfailed", request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", response => { if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`); });
  await page.addInitScript(coreJs);
  await page.goto("/");
  await page.waitForFunction(() => { try { return (0, eval)("state") === "title"; } catch { return false; } });
  return { errors, failures, requests };
}

async function startClassic(page, type = "MCP") {
  return page.evaluate(domain => {
    const ge=(0,eval),p=ge("player");
    p.slug="julien-hovan";ge("restorePlayerHp")(true);
    ge("startBattle")({slug:"veronica-marallag",type:domain,defeated:false});
    const b=ge("battle");
    return {ids:b.mons.map(mon=>mon.id),domains:b.mons.map(mon=>mon.domain),names:b.mons.map(mon=>mon.name),unique:new Set(b.mons.map(mon=>mon.id)).size};
  }, type);
}

test.describe("Classic certification-stage presentation and Battlemon art", () => {
  test("title loads only the strict manifest and a classic encounter lazily loads its declared sheets", async ({ page }) => {
    const observed = await boot(page);
    expect(observed.requests.filter(path => path === "/battlemons/manifest.json")).toHaveLength(1);
    expect(observed.requests.filter(path => /^\/battlemons\/.*\.png$/.test(path))).toEqual([]);
    expect(await page.evaluate(() => window.DatamonBattlePresentation.getDiagnostics())).toEqual({
      manifestStatus:"accepted",manifestEntryCount:35,loadedSheetCount:0,inFlightSheetCount:0,
      failedSheetCount:0,fallbackDomainCount:0,activeSheetCount:0,loadedSheetDecodedBytes:0,fallbackDecodedBytes:0,alphaCacheSize:0,
    });

    const battle = await startClassic(page, "MCP");
    expect(battle.ids.every(Boolean)).toBe(true);
    expect(battle.domains.every(domain => domain === "MCP")).toBe(true);
    await page.waitForFunction(count => {
      const d=window.DatamonBattlePresentation.getDiagnostics();
      return d.loadedSheetCount===count&&d.inFlightSheetCount===0;
    }, battle.unique);
    const pngRequests = observed.requests.filter(path => /^\/battlemons\/.*\.png$/.test(path));
    expect(pngRequests.sort()).toEqual([...new Set(battle.ids)].map(id => `/battlemons/${id}.png`).sort());
    const diagnostics=await page.evaluate(()=>window.DatamonBattlePresentation.getDiagnostics());
    expect(diagnostics.activeSheetCount).toBe(battle.unique);
    expect(diagnostics.loadedSheetDecodedBytes).toBe(battle.unique*768*128*4);
    expect(diagnostics.fallbackDecodedBytes).toBe(0);
    expect(await page.evaluate(() => {
      const ge=(0,eval),b=ge("battle");
      return b.mons.every(mon=>window.DatamonBattlePresentation.getManifestEntry(mon.id)?.name===mon.name);
    })).toBe(true);
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("all 37 trainer sources normalize to exact visible height and the reviewed stage geometry", async ({ page }) => {
    const observed = await boot(page);
    const result = await page.evaluate(() => {
      const ge=(0,eval),context=ge("ctx"),originalDraw=context.drawImage,calls=[];
      context.drawImage=function(...args){calls.push(args);};
      try { for(const slug of ge("ROSTER")) ge("drawTrainer")(slug,160,408,172,0,null,false); }
      finally { context.drawImage=originalDraw; }
      const rows=calls.map((args,index)=>({slug:ge("ROSTER")[index],source:args.slice(1,5),dest:args.slice(5,9)}));
      let rotated=0,scaled=0;const originalRotate=context.rotate,originalScale=context.scale;
      context.rotate=function(value){if(Math.abs(value)>0.001)rotated++;return originalRotate.call(this,value);};
      context.scale=function(x,y){if(Math.abs(x-1)>0.001||Math.abs(y-1)>0.001)scaled++;return originalScale.call(this,x,y);};
      try { ge("drawTrainer")("julien-hovan",160,408,172,0,window.DatamonBattlePresentation.POSE_PARAMS.command,false); }
      finally { context.rotate=originalRotate;context.scale=originalScale; }
      return{rows,rotated,scaled,geometry:window.DatamonBattlePresentation.GEOMETRY};
    });
    expect(result.rows).toHaveLength(37);
    expect(result.rows.every(row => row.dest[3] === 172)).toBe(true);
    expect(result.rows.find(row => row.slug === "jonathan-kim")?.source).toEqual([87,8,83,240]);
    expect(result.rotated).toBe(1); expect(result.scaled).toBe(1);
    expect(result.geometry.PLAYER_ANCHOR).toEqual([160,408]);
    expect(result.geometry.OPPONENT_ANCHOR).toEqual([657,208]);
    expect(result.geometry.PLAYER_VISIBLE_HEIGHT/result.geometry.OPPONENT_VISIBLE_HEIGHT).toBeLessThanOrEqual(1.11);
    expect(result.geometry.PLAYER_PLATE[3]).toBeLessThan(result.geometry.STAGE_BOTTOM);
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("MIX chooses one species domain without presentation RNG or telemetry drift", async ({ page }) => {
    const observed = await boot(page);
    const result = await page.evaluate(() => {
      const ge=(0,eval),p=ge("player"),original=Math.random,before=JSON.stringify(ge("questionStats"));
      p.slug="julien-hovan";let calls=0;Math.random=()=>{calls++;return 0.1;};
      try { ge("startBattle")({slug:"veronica-marallag",type:"MIX",defeated:false}); }
      finally { Math.random=original; }
      const b=ge("battle");
      return{calls,domains:b.mons.map(mon=>mon.domain),ids:b.mons.map(mon=>mon.id),before,after:JSON.stringify(ge("questionStats"))};
    });
    expect(result.calls).toBe(2); // one weighted domain + one seed; Fisher-Yates uses the seeded local RNG
    expect(new Set(result.domains).size).toBe(1);
    expect(result.domains[0]).toBe("AGENT");
    expect(result.ids.every(id => id?.startsWith("agent-"))).toBe(true);
    expect(result.after).toBe(result.before);
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("reduced motion removes shake, flashes, particles, lunge/fade while retaining faint and pose signals", async ({ page }) => {
    const observed = await boot(page, { reducedMotion: true });
    const battle = await startClassic(page, "CONFIG");
    await page.waitForFunction(count => window.DatamonBattlePresentation.getDiagnostics().loadedSheetCount===count, battle.unique);
    const result = await page.evaluate(() => {
      const ge=(0,eval),b=ge("battle"),context=ge("ctx"),originalRandom=Math.random;
      ge("advanceBattle")(); // sendout
      ge("frame = 100");
      b.phase="feedback";b.feedback={correct:true};b.faintAt=70;b.attackAt=100;b.shake=14;
      b.poof=[{x:0,y:0,vx:1,vy:1,life:10}];
      const originalFillRect=context.fillRect,originalDraw=context.drawImage;
      const flashes=[],monFrames=[];let signalFills=0;
      context.fillRect=function(x,y,w,h){const style=String(context.fillStyle);if(w>=800&&(/rgba\(239/.test(style)||/rgba\(255/.test(style)))flashes.push(style);if(w<=30&&h<=25&&["#fbbf24","#22c55e","#fb7185"].includes(style))signalFills++;return originalFillRect.call(this,x,y,w,h);};
      context.drawImage=function(...args){if(args[0]?.naturalWidth===768)monFrames.push({sx:args[1],alpha:context.globalAlpha});return originalDraw.call(this,...args);};
      Math.random=()=>{throw new Error("reduced-motion draw consumed random shake");};
      try { ge("drawBattle")(); }
      finally { Math.random=originalRandom;context.fillRect=originalFillRect;context.drawImage=originalDraw; }
      return{shake:b.shake,poof:b.poof.length,flashes,monFrames,signalFills,
        states:[window.DatamonBattlePresentation.resolveTrainerPose("player",b.phase,b.feedback,false),window.DatamonBattlePresentation.resolveTrainerPose("opponent",b.phase,b.feedback,false)]};
    });
    expect(result.shake).toBe(0); expect(result.poof).toBe(0); expect(result.flashes).toEqual([]);
    expect(result.monFrames).toContainEqual({sx:5*128,alpha:1});
    expect(result.signalFills).toBeGreaterThan(0);
    expect(result.states).toEqual(["command","hit"]);
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("malformed metadata fails closed once to a playable domain fallback", async ({ page }) => {
    const malformed = structuredClone(manifest);
    malformed.entries[0].file = "https://example.com/arbitrary.png";
    const observed = await boot(page, { manifest: malformed });
    expect(await page.evaluate(() => window.DatamonBattlePresentation.getDiagnostics().manifestStatus)).toBe("rejected");
    const battle = await startClassic(page, "MCP");
    await page.evaluate(() => {const ge=(0,eval);ge("advanceBattle")();ge("drawBattle")();ge("advanceBattle")();});
    const result = await page.evaluate(() => ({state:(0,eval)("state"),phase:(0,eval)("battle.phase"),diagnostics:window.DatamonBattlePresentation.getDiagnostics()}));
    expect(result.state).toBe("battle"); expect(result.phase).toBe("question");
    expect(result.diagnostics.manifestEntryCount).toBe(0);
    expect(result.diagnostics.loadedSheetCount).toBe(0);
    expect(result.diagnostics.fallbackDomainCount).toBe(1);
    expect(observed.requests.filter(path => path === "/battlemons/manifest.json")).toHaveLength(1);
    expect(observed.requests.filter(path => /^\/battlemons\/.*\.png$/.test(path))).toEqual([]);
    expect(observed.requests.some(path => path.includes("arbitrary"))).toBe(false);
    expect(battle.ids.every(Boolean)).toBe(true);
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });
});
