// @ts-check
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const coreJs = fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/core.js"), "utf8");

async function setup(page) {
  const errors = [], failures = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "assert"].includes(message.type())) errors.push(message.text()); });
  page.on("requestfailed", request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", response => { if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`); });
  await page.addInitScript(coreJs);
  await page.goto("/");
  await page.waitForFunction(() => { try { return (0,eval)("state") === "title" && (0,eval)("officeMapCv") !== null; } catch { return false; } });
  await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => (0,eval)("state") === "dialogue");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (0,eval)("state") === "overworld");
  await page.evaluate(async () => {
    const ge=(0,eval),p=ge("player");
    p.slug="julien-hovan";p.moving=false;p.seated=null;p.running=false;
    ge("npcs.length=0");ge("bufferedDir=null");ge("locomotionPhase=0");ge("locomotionContactCount=0");
    ge("locomotionProfile=DatamonLocomotion.profile('balanced')");
    await Promise.all([
      ge("loadWalkAnim")("julien-hovan"),
      ge("primePlayerIdleDirections")("julien-hovan"),
    ]);
    // Find a clear eastbound lane long enough to measure a continuous five-tile hold.
    let start=null;
    for(let y=2;y<22&&!start;y++)for(let x=2;x<28&&!start;x++){
      let ok=true;for(let dx=0;dx<=7;dx++)if(!ge("walkable")(x+dx,y)){ok=false;break;}
      if(ok)start=[x,y];
    }
    if(!start)throw new Error("No clear locomotion test lane");
    p.x=p.fx=start[0];p.y=p.fy=start[1];p.dir="right";ge("camFx=null");ge("camFy=null");
    window.__LOCOMOTION_START__=start;
  });
  return { errors, failures };
}

test.describe("distance-matched overworld locomotion", () => {
  test("held movement has steady cruise, continuous phase, shared contacts, and neutral idle", async ({ page }) => {
    const observed = await setup(page);
    const samplesPromise = page.evaluate(() => new Promise((resolve, reject) => {
      const ge=(0,eval),start=window.__LOCOMOTION_START__[0],samples=[];let previous=performance.now();
      const timeout=performance.now()+4000;
      function tick(now){
        const p=ge("player");samples.push({t:now,x:p.fx,y:p.fy,phase:ge("locomotionPhase"),step:ge("stepT"),moving:p.moving});
        if(p.fx-start>=5)return resolve(samples);
        if(now>timeout)return reject(new Error("locomotion sampler timeout"));
        previous=now;requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }));
    await page.keyboard.down("ArrowRight");
    const samples = await samplesPromise;
    await page.keyboard.up("ArrowRight");
    await page.waitForFunction(() => !(0,eval)("player").moving);

    const result = await page.evaluate(samples => {
      const ge=(0,eval),start=window.__LOCOMOTION_START__[0];
      const velocities=[];
      for(let i=1;i<samples.length;i++){
        const dt=(samples[i].t-samples[i-1].t)/1000,dx=samples[i].x-samples[i-1].x;
        if(dt>0&&dx>0.005)velocities.push(dx/dt);
      }
      const stable=velocities.slice(2,-2),mean=stable.reduce((a,b)=>a+b,0)/stable.length;
      const variance=stable.reduce((sum,value)=>sum+(value-mean)**2,0)/stable.length;
      const p=ge("player"),phase=ge("locomotionPhase"),distance=p.fx-start;
      const expected=window.DatamonLocomotion.phaseForDistance(distance,2);
      const circular=Math.min(Math.abs(phase-expected),1-Math.abs(phase-expected));
      // Capture the idle draw contract after movement has genuinely stopped.
      const context=ge("ctx"),original=context.drawImage,calls=[];
      context.drawImage=function(...args){calls.push(args);};
      try{ge("drawCharacter")(320,240,p.slug,"right",true,false,false,false);}finally{context.drawImage=original;}
      const draw=calls.at(-1);
      return{cv:Math.sqrt(variance)/mean,mean,distance,phase,circular,contacts:ge("locomotionContactCount"),
        active:ge("locomotionActive"),idleDraw:draw&&[draw[3],draw[4]],profile:ge("locomotionProfile.name"),
        multiplier:ge("currentMovementMultiplier")()};
    }, samples);

    expect(result.profile).toBe("balanced");
    const expectedSpeed=5*result.multiplier;
    expect(result.mean).toBeGreaterThan(expectedSpeed-0.2); expect(result.mean).toBeLessThan(expectedSpeed+0.2);
    expect(result.cv).toBeLessThanOrEqual(0.05);
    expect(result.distance).toBeGreaterThanOrEqual(5);
    expect(result.circular).toBeLessThan(0.01);
    expect(result.contacts).toBeGreaterThanOrEqual(5);
    expect(result.active).toBe(false);
    expect(result.idleDraw[0]).toBeGreaterThan(15);
    expect(result.idleDraw[0]).toBeLessThan(56);
    expect(result.idleDraw[1]).toBe(60); // 224px visible span maps to the 56px standing model
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("reduced motion keeps essential travel but suppresses optional contact particles", async ({ browser }) => {
    const context=await browser.newContext({viewport:{width:1280,height:960},reducedMotion:"reduce"});
    const page=await context.newPage(),observed=await setup(page);
    const crossing=page.evaluate(()=>new Promise((resolve,reject)=>{
      const ge=(0,eval),start=window.__LOCOMOTION_START__[0],deadline=performance.now()+3000;
      function tick(now){
        if(ge("player.fx")-start>=1)return resolve();
        if(now>deadline)return reject(new Error("reduced-motion movement timeout"));
        requestAnimationFrame(tick);
      }requestAnimationFrame(tick);
    }));
    await page.keyboard.down("ArrowRight");await crossing;await page.keyboard.up("ArrowRight");
    await page.waitForFunction(()=>!(0,eval)("player").moving);
    const result=await page.evaluate(()=>{const ge=(0,eval);return{reduced:ge("locomotionReducedMotion")(),
      distance:ge("player.fx")-window.__LOCOMOTION_START__[0],contacts:ge("locomotionContactCount"),dust:ge("dustParticles.length")};});
    expect(result.reduced).toBe(true);expect(result.distance).toBeGreaterThanOrEqual(1);
    expect(result.contacts).toBeGreaterThanOrEqual(1);expect(result.dust).toBe(0);
    expect(observed.errors).toEqual([]);expect(observed.failures).toEqual([]);
    await context.close();
  });

  test("moving frames use manifest body and visible-foot anchors at DPR1/DPR2", async ({ browser }) => {
    for (const dpr of [1,2]) {
      const context = await browser.newContext({ viewport:{width:1280,height:960}, deviceScaleFactor:dpr });
      const page = await context.newPage();
      const observed = await setup(page);
      const result = await page.evaluate(() => {
        const ge=(0,eval),p=ge("player"),context=ge("ctx"),original=context.drawImage,calls=[];
        const pilot=ge("locomotionPilot")[p.slug];
        p.moving=true;p.running=false;ge("locomotionPhase=0");
        context.drawImage=function(...args){calls.push(args);};
        try {
          ge("drawCharacter")(320,240,p.slug,"right",true,true,false,false);
          var walkDraw=calls.at(-1),walkMeta=pilot.manifest.motions.walk.frames.right_0;
          calls.length=0;p.running=true;ge("locomotionPhase=0.375");
          ge("drawCharacter")(320,240,p.slug,"right",true,true,false,false);
          var runDraw=calls.at(-1),runMeta=pilot.manifest.motions.run.frames.right_3;
        } finally { context.drawImage=original;p.moving=false;p.running=false; }
        const walkScale=DatamonLocomotion.authoredFrameScale(walkMeta.height,56);
        const runScale=DatamonLocomotion.authoredFrameScale(runMeta.height,56);
        return{draw:[walkDraw[1],walkDraw[2],walkDraw[3],walkDraw[4]],frameCount:pilot.manifest.frameCount,
          resolvedBody:walkDraw[1]+walkMeta.bodyX*walkScale,resolvedFoot:walkDraw[2]+walkMeta.footY*walkScale,
          flightFoot:runDraw[2]+runMeta.footY*runScale,runGround:pilot.manifest.motions.run.groundY.right,
          cacheKeys:Object.keys(ge("walkMiniCache")).filter(key=>key.includes(p.slug+":walk:right:0")),
          runCacheKeys:Object.keys(ge("walkMiniCache")).filter(key=>key.includes(p.slug+":run:right:3"))};
      });
      expect(result.frameCount).toBe(8);
      expect(Math.abs(result.resolvedBody-320)).toBeLessThanOrEqual(0.55);
      expect(Math.abs(result.resolvedFoot-256)).toBeLessThanOrEqual(0.55);
      expect(result.draw[2]).toBeGreaterThan(20); expect(result.draw[3]).toBe(60);
      expect(result.cacheKeys).toHaveLength(1);
      expect(result.runCacheKeys).toHaveLength(1);
      expect(256-result.flightFoot).toBeGreaterThan(3); // authored both-feet-airborne pose
      expect(result.runGround).toBeGreaterThan(0);
      expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
      await context.close();
    }
  });
});
