// @ts-check
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const coreJs = fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/core.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/battle-arenas/manifest.json"), "utf8"));

async function boot(page, replacement = null) {
  const requests = [], errors = [], failures = [];
  if (replacement) await page.route("**/battle-arenas/manifest.json", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(replacement) }));
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "assert"].includes(message.type())) errors.push(message.text()); });
  page.on("requestfailed", request => failures.push(request.url()));
  await page.addInitScript(coreJs); await page.goto("/");
  await page.waitForFunction(() => { try { return (0,eval)("state") === "title"; } catch { return false; } });
  return { requests, errors, failures };
}
async function start(page, domain = "MCP") {
  return page.evaluate(async type => {
    const ge=(0,eval),p=ge("player");p.slug="oyku-cildir";await ge("loadWalkAnim")("oyku-cildir");ge("restorePlayerHp")(true);
    ge("startBattle")({slug:"saransh-padhy",type,defeated:false});const b=ge("battle");
    return{domain:b.mons[0].domain,unique:new Set(b.mons.map(mon=>mon.id)).size};
  }, domain);
}

test.describe("Authored classic domain arenas", () => {
  test("title stays image-cold and an encounter loads exactly one accepted domain arena", async ({ page }) => {
    const observed = await boot(page);
    expect(observed.requests.filter(value => value === "/battle-arenas/manifest.json")).toHaveLength(1);
    expect(observed.requests.filter(value => /^\/battle-arenas\/.*\.png$/.test(value))).toEqual([]);
    const battle = await start(page, "MCP");
    await page.waitForFunction(domain => { const d=window.DatamonBattleArena.getDiagnostics(); return d.activeDomain===domain&&d.residentArenaCount===1&&d.inFlightArenaCount===0; }, battle.domain);
    expect(observed.requests.filter(value => /^\/battle-arenas\/.*\.png$/.test(value))).toEqual(["/battle-arenas/mcp.png"]);
    const diagnostics=await page.evaluate(() => window.DatamonBattleArena.getDiagnostics());
    expect(diagnostics).toMatchObject({manifestStatus:"accepted",manifestEntryCount:5,activeDomain:"MCP",residentArenaCount:1,
      inFlightArenaCount:0,failedArenaCount:0,residentDecodedBytes:1600*864*4});
    expect([0,800*432*4]).toContain(diagnostics.fallbackDecodedBytes);
    expect(diagnostics.fallbackDomain).toBe(diagnostics.fallbackDecodedBytes ? "MCP" : null);
    expect(observed.errors).toEqual([]);expect(observed.failures).toEqual([]);
  });

  test("player uses the packaged rear identity and revised authored geometry without changing lower controls", async ({ page }) => {
    const observed=await boot(page);const battle=await start(page,"MCP");
    await page.waitForFunction(domain=>window.DatamonBattleArena.getDiagnostics().activeDomain===domain,battle.domain);
    const result=await page.evaluate(()=>{
      const ge=(0,eval),context=ge("ctx"),original=context.drawImage,calls=[],rearStates=[];ge("advanceBattle")();ge("advanceBattle")();
      context.drawImage=function(...args){calls.push(args);return original.apply(this,args);};
      try{
        for(const [label,phase,feedback] of [["intro","intro",null],["sendout","sendout",null],["question","question",null],
          ["correct","feedback",{correct:true}],["wrong","feedback",{correct:false}],["win","win",{correct:true}],["lose","lose",{correct:false}]]){
          const b=ge("battle");b.phase=phase;b.feedback=feedback;calls.length=0;ge("drawBattle")();
          if(calls.some(args=>String(args[0]?.src||"").includes("sprites-walk/oyku-cildir/up_0.png")))rearStates.push(label);
        }
      }finally{context.drawImage=original;}
      const arena=calls.find(args=>args[0]?.naturalWidth===1600&&args[0]?.naturalHeight===864);ge("battle").phase="question";ge("battle").feedback=null;
      return{rearStates,arena:!!arena,geometry:window.DatamonBattlePresentation.GEOMETRY,
        choices:ge("CHOICE_RECTS").map(value=>value.slice()),run:ge("RUN_RECT").slice(),phase:ge("battle").phase};
    });
    expect(result.rearStates).toEqual(["intro","sendout","question","correct","wrong","win","lose"]);expect(result.arena).toBe(true);expect(result.phase).toBe("question");
    await page.emulateMedia({reducedMotion:"reduce"});
    expect(await page.evaluate(()=>{const ge=(0,eval),b=ge("battle"),context=ge("ctx"),original=context.drawImage,seen=[];context.drawImage=function(...args){if(String(args[0]?.src||"").includes("sprites-walk/oyku-cildir/up_0.png"))seen.push(b.phase);return original.apply(this,args);};try{for(const phase of ["feedback","win","lose"]){b.phase=phase;b.feedback={correct:phase!=="feedback"};ge("drawBattle")();}}finally{context.drawImage=original;}return seen;})).toEqual(["feedback","win","lose"]);
    expect(result.geometry.PLAYER_ANCHOR).toEqual([160,408]);expect(result.geometry.OPPONENT_ANCHOR).toEqual([657,208]);
    expect(result.geometry.OPPONENT_VISIBLE_HEIGHT).toBe(156);expect(result.geometry.PLAYER_VISIBLE_HEIGHT).toBe(172);
    expect(result.choices).toEqual([[36,490,358,42],[406,490,358,42],[36,540,358,42],[406,540,358,42]]);
    expect(result.run).toEqual([688,440,76,26]);
    expect(observed.errors).toEqual([]);expect(observed.failures).toEqual([]);
  });

  test("sequential domains replace the resident image rather than accumulating", async ({ page }) => {
    const observed=await boot(page);
    const mixed=await page.evaluate(async()=>{const ge=(0,eval),p=ge("player"),original=Math.random;p.slug="oyku-cildir";await ge("loadWalkAnim")("oyku-cildir");Math.random=()=>0;try{ge("startBattle")({slug:"saransh-padhy",type:"MIX",defeated:false});}finally{Math.random=original;}const b=ge("battle");return{type:b.npc.type,domains:b.mons.map(mon=>mon.domain),unique:new Set(b.mons.map(mon=>mon.id)).size};});
    expect(mixed.type).toBe("MIX");expect(new Set(mixed.domains)).toEqual(new Set(["AGENT"]));
    await page.waitForFunction(expected=>{const a=window.DatamonBattleArena.getDiagnostics(),d=window.DatamonBattlePresentation.getDiagnostics();return a.activeDomain==="AGENT"&&d.loadedSheetCount===expected&&d.inFlightSheetCount===0;},mixed.unique);
    const residency=[];
    for(const domain of ["MCP","CONFIG","PROMPT","CONTEXT"]){
      const battle=await start(page,domain);
      await page.waitForFunction(expected=>{const a=window.DatamonBattleArena.getDiagnostics(),d=window.DatamonBattlePresentation.getDiagnostics();return a.activeDomain===expected.domain&&a.residentArenaCount===1&&a.inFlightArenaCount===0&&d.loadedSheetCount===expected.unique&&d.inFlightSheetCount===0;},battle);
      residency.push(await page.evaluate(()=>{const a=window.DatamonBattleArena.getDiagnostics(),d=window.DatamonBattlePresentation.getDiagnostics();return{loaded:d.loadedSheetCount,active:d.activeSheetCount,fallback:d.fallbackDecodedBytes,bytes:a.residentDecodedBytes+a.fallbackDecodedBytes+d.loadedSheetDecodedBytes+d.fallbackDecodedBytes};}));
      expect(residency.at(-1).loaded).toBe(battle.unique);expect(residency.at(-1).active).toBe(battle.unique);
      expect(residency.at(-1).fallback).toBe(0);expect(residency.at(-1).bytes).toBeLessThanOrEqual(8*1024*1024);
    }
    const diagnostics=await page.evaluate(()=>window.DatamonBattleArena.getDiagnostics());
    expect(diagnostics.residentArenaCount).toBe(1);expect(diagnostics.activeDomain).toBe("CONTEXT");
    expect(observed.requests.filter(value=>/^\/battle-arenas\/.*\.png$/.test(value)).sort()).toEqual([
      "/battle-arenas/agent.png","/battle-arenas/config.png","/battle-arenas/context.png","/battle-arenas/mcp.png","/battle-arenas/prompt.png",
    ]);
    expect(observed.errors).toEqual([]);expect(observed.failures).toEqual([]);
  });

  test("malformed arena metadata never authorizes a path and classic combat uses the bounded fallback", async ({ page }) => {
    const malformed=structuredClone(manifest);malformed.entries[1].file="https://evil.test/arena.png";
    const observed=await boot(page,malformed);const battle=await start(page,"MCP");
    const result=await page.evaluate(()=>{const ge=(0,eval);ge("advanceBattle")();ge("advanceBattle")();ge("drawBattle")();return{phase:ge("battle").phase,diagnostics:window.DatamonBattleArena.getDiagnostics()};});
    expect(result.phase).toBe("question");expect(result.diagnostics.manifestStatus).toBe("rejected");
    expect(result.diagnostics.residentArenaCount).toBe(0);expect(result.diagnostics.fallbackDomain).toBe("MCP");
    expect(observed.requests.some(value=>value.includes("evil"))).toBe(false);
    expect(observed.requests.filter(value=>/^\/battle-arenas\/.*\.png$/.test(value))).toEqual([]);
    expect(battle.domain).toBe("MCP");expect(observed.errors).toEqual([]);expect(observed.failures).toEqual([]);
  });
});
