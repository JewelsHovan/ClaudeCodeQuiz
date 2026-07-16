// @ts-check
import { test, expect } from "@playwright/test";
import fs from "node:fs";

const budgets = JSON.parse(fs.readFileSync("scripts/performance-budgets.json", "utf8"));

const fakeAudio = `
(() => {
  window.__musicLog = { starts: 0, stops: 0, contexts: 0, resumes: 0, suspends: 0, closes: 0, ramps: [] };
  class Param {
    constructor(value=0){ this.value=value; }
    setValueAtTime(value,time){ this.value=value; window.__musicLog.ramps.push({kind:'set',value,time}); }
    exponentialRampToValueAtTime(value,time){ this.value=value; window.__musicLog.ramps.push({kind:'exponential',value,time}); }
    linearRampToValueAtTime(value,time){ this.value=value; window.__musicLog.ramps.push({kind:'linear',value,time}); }
    cancelScheduledValues(){}
  }
  class Node {
    constructor(){ this.connections=[]; }
    connect(node){ this.connections.push(node); return node; }
    disconnect(){ this.connections=[]; }
  }
  class Source extends Node {
    constructor(){ super(); this.frequency={value:0}; this.type='sine'; this.onended=null; this.buffer=null; this.ended=false; this.timer=null; }
    start(){ window.__musicLog.starts++; }
    stop(when){
      if(this.ended) return;
      const finish=()=>{ if(this.ended) return; this.ended=true; window.__musicLog.stops++; this.onended&&this.onended(); };
      if(when === undefined){ if(this.timer) clearTimeout(this.timer); queueMicrotask(finish); return; }
      const delay=Math.max(0,(when-(window.__fakeAudioTime||0))*1000);
      this.timer=setTimeout(finish,Math.min(delay,1000));
    }
  }
  class FakeAudioContext {
    constructor(){ window.__musicLog.contexts++; Object.defineProperty(this,'currentTime',{get:()=>window.__fakeAudioTime||0,set:value=>{window.__fakeAudioTime=value;}}); this.sampleRate=8000; this.state=window.__startAudioSuspended?'suspended':'running'; this.destination=new Node(); window.__fakeAudio=this; }
    createGain(){ const n=new Node(); n.gain=new Param(1); return n; }
    createBiquadFilter(){ const n=new Node(); n.frequency={value:0}; n.type='lowpass'; return n; }
    createOscillator(){ return new Source(); }
    createBufferSource(){ return new Source(); }
    createBuffer(channels,length){ const data=new Float32Array(length); return {getChannelData(){return data;}}; }
    resume(){ this.state='running'; window.__musicLog.resumes++; return window.__rejectMusicResume ? Promise.reject(new Error('resume denied')) : Promise.resolve(); }
    suspend(){ this.state='suspended'; window.__musicLog.suspends++; return Promise.resolve(); }
    close(){ this.state='closed'; window.__musicLog.closes++; return Promise.resolve(); }
  }
  window.AudioContext=FakeAudioContext;
  window.webkitAudioContext=undefined;
})();`;

async function boot(page, withAudio = true) {
  const errors = [];
  const failures = [];
  if (withAudio === true) await page.addInitScript({ content: fakeAudio });
  else if (withAudio === false) await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { value: undefined, configurable: true });
    Object.defineProperty(window, "webkitAudioContext", { value: undefined, configurable: true });
  });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (["error", "assert"].includes(message.type())) errors.push(message.text());
  });
  page.on("requestfailed", request => failures.push(request.url()));
  page.on("response", response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto("/");
  await page.waitForFunction(() => { try { return (0, eval)("state") === "title"; } catch (_) { return false; } });
  return { errors, failures };
}

async function waitForMusicScene(page, scene) {
  await page.waitForFunction(expected => window.DatamonMusic.getDiagnostics().scene === expected, scene);
}

test.describe("DATAMON original adaptive soundtrack", () => {
  test("routes scenes, crossfades, and keeps one bounded scheduler", async ({ page }) => {
    const observed = await boot(page);
    let diag = await page.evaluate(() => window.DatamonMusic.getDiagnostics());
    expect(diag.scene).toBe("title");
    expect(diag.unlocked).toBe(false);
    expect(diag.schedulerActive).toBe(false);

    await page.keyboard.press("Enter"); // activation + title → select
    await page.waitForTimeout(80);
    diag = await page.evaluate(() => window.DatamonMusic.getDiagnostics());
    expect(diag.unlocked).toBe(true);
    expect(diag.schedulerActive).toBe(true);
    expect(diag.schedulerStarts).toBe(1);
    expect(diag.contextCreations).toBe(1);

    await page.keyboard.press("Enter"); // select → office
    await waitForMusicScene(page, "office");
    const startsBefore = await page.evaluate(() => window.DatamonMusic.getDiagnostics().schedulerStarts);
    await page.evaluate(() => {
      window.DatamonMusic.setScene("library");
      window.DatamonMusic.setScene("agent-battle");
      window.DatamonMusic.setScene("office");
      window.DatamonMusic.setScene("office");
      window.__fakeAudio.currentTime += 2;
    });
    await page.waitForTimeout(80);
    diag = await page.evaluate(() => window.DatamonMusic.getDiagnostics());
    expect(diag.scene).toBe("office");
    expect(diag.schedulerStarts).toBe(startsBefore);
    expect(diag.buses).toBe(1);
    expect(diag.retiringBuses).toBe(0);
    expect(diag.activeVoices).toBeGreaterThan(0);
    expect(diag.activeVoices).toBeLessThanOrEqual(diag.limits.voices);
    expect(diag.noiseBuffers).toBeLessThanOrEqual(1);
    expect(diag.transitions.slice(-3)).toEqual(["library", "agent-battle", "office"]);
    expect(await page.evaluate(() => window.__musicLog.ramps.some(r => r.kind === "linear" && r.value === 0.0001))).toBe(true);
    expect(observed.errors).toEqual([]);
    expect(observed.failures).toEqual([]);
  });

  test("real game states route exploration, battle, boss, defeat, and bounded victory music", async ({ page }) => {
    const observed = await boot(page);
    await page.keyboard.press("Enter"); // select
    await page.keyboard.press("Enter"); // overworld
    await waitForMusicScene(page, "office");

    await page.evaluate(() => { (0,eval)('currentMap = "library"'); });
    await waitForMusicScene(page, "library");
    await page.evaluate(() => { (0,eval)('currentMap = "office"'); });

    await page.evaluate(() => {
      const ge=(0,eval); const target=ge("npcs").find(npc=>npc.type!=="AGENT"); ge("startBattle")(target);
    });
    await waitForMusicScene(page, "classic-battle");
    await page.evaluate(() => { const ge=(0,eval); ge('battle = null'); ge('state = "overworld"'); });

    await page.evaluate(() => {
      const ge=(0,eval); const target=ge("npcs").find(npc=>npc.type==="AGENT"); ge("startBattle")(target);
    });
    await waitForMusicScene(page, "agent-battle");
    for (let phase=0; phase<3; phase++) {
      await page.evaluate(value => {
        const ops=(0,eval)("battle.agentOps"); ops.boss=true; ops.bossPhase=value; ops.phase="action";
      }, phase);
      await waitForMusicScene(page, `agent-boss-${phase+1}`);
    }
    await page.evaluate(() => { (0,eval)("battle.agentOps").phase="defeat"; });
    await waitForMusicScene(page, "defeat");
    await page.evaluate(() => { (0,eval)("battle.agentOps").phase="victory"; });
    await waitForMusicScene(page, "victory");
    await page.evaluate(() => { window.__fakeAudio.currentTime += 20; });
    await page.waitForTimeout(80);
    let terminal = await page.evaluate(() => window.DatamonMusic.getDiagnostics());
    expect(terminal.oneShotComplete).toBe(true);
    expect(terminal.schedulerActive).toBe(false);
    expect(terminal.activeVoices).toBeLessThanOrEqual(terminal.limits.voices);

    await page.evaluate(() => { window.DatamonMusic.setMuted(true); window.DatamonMusic.setMuted(false); });
    terminal = await page.evaluate(() => window.DatamonMusic.getDiagnostics());
    expect(terminal.schedulerActive).toBe(false);
    terminal = await page.evaluate(() => {
      window.DatamonMusic.reset(); window.DatamonMusic.resume(); return window.DatamonMusic.getDiagnostics();
    });
    expect(terminal.scene).toBe(null);
    expect(terminal.schedulerActive).toBe(false);
    expect(observed.errors).toEqual([]);
    expect(observed.failures).toEqual([]);
  });

  test("global mute works in search and visibility/pagehide clean up voices", async ({ page }) => {
    const observed = await boot(page);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await waitForMusicScene(page, "office");
    await page.keyboard.press("f");
    await page.waitForFunction(() => (0,eval)("state") === "search");
    const queryBefore = await page.evaluate(() => (0,eval)("searchQuery"));
    await page.keyboard.press("m");
    let diag = await page.evaluate(() => window.DatamonMusic.getDiagnostics());
    expect(diag.muted).toBe(true);
    expect(await page.evaluate(() => (0,eval)("muted"))).toBe(true);
    expect(await page.evaluate(() => window.AgentArena.getDiagnostics().muted)).toBe(true);
    expect(await page.evaluate(() => (0,eval)("searchQuery"))).toBe(queryBefore);
    expect(diag.schedulerActive).toBe(false);
    expect(diag.activeVoices).toBe(0);

    await page.keyboard.press("m");
    await page.waitForTimeout(50);
    diag = await page.evaluate(() => window.DatamonMusic.getDiagnostics());
    expect(diag.muted).toBe(false);
    expect(diag.schedulerActive).toBe(true);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await page.waitForTimeout(20);
    diag = await page.evaluate(() => window.DatamonMusic.getDiagnostics());
    expect(diag.schedulerActive).toBe(false);
    expect(diag.activeVoices).toBe(0);
    expect(await page.evaluate(() => window.__musicLog.suspends)).toBeGreaterThan(0);
    expect(observed.errors).toEqual([]);
    expect(observed.failures).toEqual([]);
  });

  test("scheduler activity cannot mutate game, reducer, save, or question state", async ({ page }) => {
    const observed = await boot(page);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await waitForMusicScene(page, "office");
    const before = await page.evaluate(() => {
      const ge=(0,eval);
      window.__musicReducerProbe = window.DatamonBattleOps.createEncounter({
        npc:{slug:"probe",type:"AGENT"}, question:{id:"agent-001",choices:["a","b","c","d"],correct:0}, playerHp:75,
      });
      return JSON.stringify({
        player: ge("player"), defeated: [...ge("defeated")], questionStats: ge("questionStats"),
        seenCounter: ge("seenCounter"), progression: ge("_progression"), reducer:window.__musicReducerProbe,
        storage: localStorage.getItem(window.DatamonState.SAVE_KEY),
      });
    });
    await page.evaluate(() => { window.__fakeAudio.currentTime += 8; });
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => {
      const ge=(0,eval);
      return JSON.stringify({
        player: ge("player"), defeated: [...ge("defeated")], questionStats: ge("questionStats"),
        seenCounter: ge("seenCounter"), progression: ge("_progression"), reducer:window.__musicReducerProbe,
        storage: localStorage.getItem(window.DatamonState.SAVE_KEY),
      });
    });
    expect(after).toBe(before);
    expect(observed.errors).toEqual([]);
    expect(observed.failures).toEqual([]);
  });

  test("partial AudioContext failures close once, fail silent, and never block Enter", async ({ page }) => {
    await page.addInitScript(() => {
      window.__partialAudio = { contexts:0, closes:0 };
      class Param { constructor(){this.value=1;} setValueAtTime(v){this.value=v;} linearRampToValueAtTime(v){this.value=v;} exponentialRampToValueAtTime(v){this.value=v;} cancelScheduledValues(){} }
      class Node { constructor(){this.gain=new Param();} connect(){} disconnect(){} }
      class Source extends Node { constructor(){super();this.frequency={value:0};this.onended=null;} start(){} stop(){} }
      class PartialAudioContext {
        constructor(){ this.currentTime=0; this.state="running"; this.destination={}; this.gainCalls=0; window.__partialAudio.contexts++; }
        createGain(){ this.gainCalls++; if(this.gainCalls>1) throw new Error("scene bus denied"); return new Node(); }
        createOscillator(){ return new Source(); }
        resume(){ return Promise.resolve(); }
        suspend(){ return Promise.resolve(); }
        close(){ window.__partialAudio.closes++; this.state="closed"; return Promise.resolve(); }
      }
      window.AudioContext=PartialAudioContext; window.webkitAudioContext=undefined;
    });
    const observed = await boot(page, "existing");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "select");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "overworld");
    const result = await page.evaluate(() => ({
      music:window.DatamonMusic.getDiagnostics(), partial:window.__partialAudio,
    }));
    expect(result.music.available).toBe(false);
    expect(result.music.unlocked).toBe(false);
    expect(result.music.schedulerActive).toBe(false);
    expect(result.music.contextCreations).toBe(1);
    expect(result.partial.closes).toBeGreaterThanOrEqual(1);
    expect(observed.errors).toEqual([]);
    expect(observed.failures).toEqual([]);
  });

  test("suspended and resume-rejected audio still permits normal activation", async ({ page }) => {
    await page.addInitScript(() => { window.__startAudioSuspended=true; window.__rejectMusicResume=true; });
    const observed = await boot(page);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "overworld");
    const diag = await page.evaluate(() => window.DatamonMusic.getDiagnostics());
    expect(diag.available).toBe(false);
    expect(diag.unlocked).toBe(false);
    expect(diag.schedulerActive).toBe(false);
    expect(observed.errors).toEqual([]);
    expect(observed.failures).toEqual([]);
  });

  test("unlocked office music stays inside the active-scene frame budget", async ({ page }) => {
    const observed = await boot(page);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await waitForMusicScene(page, "office");
    const samples = await page.evaluate(count => new Promise(resolve => {
      const values=[]; let previous=performance.now();
      function sample(now){ values.push(now-previous); previous=now; if(values.length>=count) resolve(values); else requestAnimationFrame(sample); }
      requestAnimationFrame(sample);
    }), budgets.musicActiveFrameSamples);
    samples.sort((a,b)=>a-b);
    const p95=samples[Math.min(samples.length-1,Math.ceil(samples.length*0.95)-1)];
    const diag=await page.evaluate(() => window.DatamonMusic.getDiagnostics());
    expect(p95).toBeLessThanOrEqual(budgets.musicActiveFrameP95Ms);
    expect(diag.schedulerActive).toBe(true);
    expect(diag.activeVoices).toBeLessThanOrEqual(budgets.musicMaxVoices);
    expect(observed.errors).toEqual([]);
    expect(observed.failures).toEqual([]);
  });

  test("Web Audio denial degrades to silence while the game remains playable", async ({ page }) => {
    const observed = await boot(page, false);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "overworld");
    const diag = await page.evaluate(() => window.DatamonMusic.getDiagnostics());
    expect(diag.available).toBe(false);
    expect(diag.unlocked).toBe(false);
    expect(diag.schedulerActive).toBe(false);
    expect(observed.errors).toEqual([]);
    expect(observed.failures).toEqual([]);
  });
});
