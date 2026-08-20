// @ts-check
import { test, expect } from "@playwright/test";
import fs from "node:fs";

const budgets = JSON.parse(fs.readFileSync("scripts/performance-budgets.json", "utf8"));

const fakeUnifiedAudio = `
(() => {
  window.__audioLog={contexts:0,starts:0,stops:0,resumes:0,suspends:0,closes:0,decodes:0,ramps:[]};
  class Param{constructor(value=0){this.value=value;}setValueAtTime(v,t){this.value=v;__audioLog.ramps.push(['set',v,t]);}linearRampToValueAtTime(v,t){this.value=v;__audioLog.ramps.push(['linear',v,t]);}exponentialRampToValueAtTime(v,t){this.value=v;__audioLog.ramps.push(['exp',v,t]);}cancelScheduledValues(){}}
  class Node{constructor(){this.connections=[];}connect(node){this.connections.push(node);return node;}disconnect(){this.connections=[];}}
  class Source extends Node{constructor(){super();this.frequency={value:0};this.type='sine';this.onended=null;this.buffer=null;this.loop=false;this.ended=false;}start(){__audioLog.starts++;}stop(){if(this.ended)return;this.ended=true;__audioLog.stops++;this.onended&&this.onended();}}
  class FakeAudioContext{
    constructor(){__audioLog.contexts++;this.currentTime=0;this.sampleRate=22050;this.state='running';this.destination=new Node();}
    createGain(){const n=new Node();n.gain=new Param(1);return n;}
    createDynamicsCompressor(){return new Node();}
    createBiquadFilter(){const n=new Node();n.frequency={value:0};return n;}
    createOscillator(){return new Source();}
    createBufferSource(){return new Source();}
    createBuffer(_channels,length){const data=new Float32Array(length);return{getChannelData(){return data;}};}
    decodeAudioData(bytes,success){__audioLog.decodes++;const buffer={length:22050,duration:1,numberOfChannels:1,sampleRate:22050};queueMicrotask(()=>success&&success(buffer));return Promise.resolve(buffer);}
    resume(){this.state='running';__audioLog.resumes++;return Promise.resolve();}
    suspend(){this.state='suspended';__audioLog.suspends++;return Promise.resolve();}
    close(){this.state='closed';__audioLog.closes++;return Promise.resolve();}
  }
  window.AudioContext=FakeAudioContext;window.webkitAudioContext=undefined;
})();`;

async function boot(page, options = {}) {
  const errors = [], failures = [], audioRequests = [];
  if (options.audio !== false) await page.addInitScript({ content: fakeUnifiedAudio });
  else await page.addInitScript(() => {
    Object.defineProperty(window,"AudioContext",{value:undefined,configurable:true});
    Object.defineProperty(window,"webkitAudioContext",{value:undefined,configurable:true});
  });
  if (options.blockAssets) await page.route("**/audio/**", route => route.abort("blockedbyclient"));
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (["error","assert"].includes(message.type()) && !(options.blockAssets && message.text().includes("ERR_BLOCKED_BY_CLIENT"))) errors.push(message.text());
  });
  page.on("request", request => { if (/\/audio\/(?:manifest|.*\.(?:mp3|wav))/.test(request.url())) audioRequests.push(request.url()); });
  page.on("requestfailed", request => { if (!options.blockAssets) failures.push(request.url()); });
  page.on("response", response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto("/");
  await page.waitForFunction(() => { try { return (0,eval)("state") === "title"; } catch { return false; } });
  return { errors, failures, audioRequests };
}

async function enterOffice(page) {
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (0,eval)("state") === "dialogue");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (0,eval)("state") === "overworld");
}

test.describe("DATAMON unified hybrid audio", () => {
  test("cold title is silent and first activation creates exactly one shared graph", async ({ page }) => {
    const observed = await boot(page);
    let diag = await page.evaluate(() => window.DatamonAudio.getDiagnostics());
    expect(diag.contextCreations).toBe(0);
    expect(diag.schedulerActive).toBe(false);
    expect(observed.audioRequests).toEqual([]);

    await enterOffice(page);
    await page.waitForFunction(() => {
      const d=window.DatamonAudio.getDiagnostics();
      return d.scene === "office-prompt" && d.manifestLoaded && d.ambience.includes("ambience.office");
    });
    diag = await page.evaluate(() => window.DatamonAudio.getDiagnostics());
    expect(diag.contextCreations).toBe(1);
    expect(diag.graphCreations).toBe(1);
    expect(diag.buses).toBe(5);
    expect(diag.schedulerActive).toBe(true);
    expect(diag.activeVoices).toBeLessThanOrEqual(budgets.audioMaxVoices);
    expect(diag.decodedBytes).toBeLessThanOrEqual(budgets.audioMaxDecodedBytes);
    expect(new Set(observed.audioRequests).size).toBe(observed.audioRequests.length);
    expect(observed.errors).toEqual([]);
    expect(observed.failures).toEqual([]);
  });

  test("pure snapshots expose Battle Room, four minigames, domain battles, and focus overlays", async ({ page }) => {
    const observed = await boot(page);
    await page.keyboard.press("Enter");
    const states = await page.evaluate(() => {
      const cases=[
        {state:"overworld",currentMap:"battleRoom",surface:"tile"},
        {state:"minigame",currentMap:"library",minigameType:"matching"},
        {state:"minigame",currentMap:"library",minigameType:"cloze"},
        {state:"minigame",currentMap:"library",minigameType:"assembly"},
        {state:"minigame",currentMap:"library",minigameType:"timed"},
        {state:"battle",battle:{phase:"question",domain:"MCP"}},
        {state:"battle",battle:{phase:"question",domain:"CONFIG"}},
        {state:"battle",battle:{phase:"question",domain:"PROMPT"}},
        {state:"battle",battle:{phase:"question",domain:"CONTEXT"}},
        {state:"battle",battle:{phase:"question",domain:"MIX"}},
        {state:"dialogue",currentMap:"library",overlay:"reader"},
      ];
      return cases.map(snapshot=>window.DatamonAudio.resolveAudioState(snapshot));
    });
    expect(states.map(item=>item.music)).toEqual([
      "battle-room","minigame-matching","minigame-cloze","minigame-assembly","minigame-timed",
      "classic-battle-mcp","classic-battle-config","classic-battle-prompt","classic-battle-context","classic-battle-mix","library-reader",
    ]);
    expect(states[0].ambience).toBe("ambience.battle-room");
    expect(states.at(-1).focus).toBe(true);
    expect(observed.errors).toEqual([]);
  });

  test("cue floods stay bounded and M immediately retires every source and loop", async ({ page }) => {
    const observed = await boot(page);
    await enterOffice(page);
    await page.waitForFunction(() => window.DatamonAudio.getDiagnostics().manifestLoaded);
    const before = await page.evaluate(() => {
      for(let i=0;i<120;i++){
        window.DatamonAudio.cue("ui.navigate");
        window.DatamonAudio.cue("footstep",{surface:i%3===0?"carpet":i%3===1?"wood":"tile",gait:i%2?"walk":"run"});
      }
      window.DatamonAudio.cue("result.correct");
      return window.DatamonAudio.getDiagnostics();
    });
    expect(before.activeVoices).toBeLessThanOrEqual(before.limits.voices);
    expect(before.droppedCues).toBeGreaterThan(0);
    expect(before.duckCount).toBeGreaterThan(0);

    await page.keyboard.press("m");
    let muted = await page.evaluate(() => window.DatamonAudio.getDiagnostics());
    expect(muted.muted).toBe(true);
    expect(muted.activeVoices).toBe(0);
    expect(muted.ambience).toEqual([]);
    expect(muted.schedulerActive).toBe(false);
    await page.keyboard.press("m");
    await page.waitForTimeout(50);
    const resumed = await page.evaluate(() => window.DatamonAudio.getDiagnostics());
    expect(resumed.contextCreations).toBe(1);
    expect(resumed.schedulerActive).toBe(true);
    expect(observed.errors).toEqual([]);
    expect(observed.failures).toEqual([]);
  });

  test("pagehide cleanup and unavailable/blocked assets remain gameplay-safe", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const observed = await boot(page, { blockAssets:true });
    await enterOffice(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await page.waitForTimeout(20);
    const diag = await page.evaluate(() => window.DatamonAudio.getDiagnostics());
    expect(diag.contextCreations).toBe(1);
    expect(diag.activeVoices).toBe(0);
    expect(diag.ambience).toEqual([]);
    expect(diag.schedulerActive).toBe(false);
    expect(diag.failures.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => (0,eval)("state"))).toBe("overworld");
    expect(observed.errors).toEqual([]);
    await context.close();

    const silentContext = await browser.newContext();
    const silentPage = await silentContext.newPage();
    const silent = await boot(silentPage, { audio:false });
    await enterOffice(silentPage);
    const silentDiag = await silentPage.evaluate(() => window.DatamonAudio.getDiagnostics());
    expect(silentDiag.available).toBe(false);
    expect(silentDiag.contextCreations).toBe(0);
    expect(await silentPage.evaluate(() => (0,eval)("state"))).toBe("overworld");
    expect(silent.errors).toEqual([]);
    expect(silent.failures).toEqual([]);
    await silentContext.close();
  });
});
