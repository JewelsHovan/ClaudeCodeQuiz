#!/usr/bin/env node

// Fixed locomotion evaluator: candidates may change runtime profiles, never this workload or
// scoring policy. Correctness gates first; ties prefer the balanced traversal profile.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(ROOT, "test-results", "locomotion-evaluation");
const PORT = 8751, URL = `http://127.0.0.1:${PORT}/`;
const PROFILES = ["gba", "balanced", "fast"];
const PILOT_SLUGS = ["julien-hovan", "veronica-marallag", "alex-andrianavalontsalama"];
const MAX_CV = 0.05, MAX_PHASE_ERROR = 0.01, MAX_REQUESTS = 340;

function percentile(values, fraction) {
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*fraction)-1))]||0;
}
function stats(values) {
  const mean=values.reduce((a,b)=>a+b,0)/Math.max(1,values.length);
  const variance=values.reduce((sum,value)=>sum+(value-mean)**2,0)/Math.max(1,values.length);
  return {samples:values.length,mean,cv:mean?Math.sqrt(variance)/mean:0,p95:percentile(values,.95),max:Math.max(0,...values)};
}
async function startServer() {
  const child=spawn("python3",["-m","http.server",String(PORT),"--bind","127.0.0.1"],{cwd:DIST,stdio:"ignore"});
  for(let attempt=0;attempt<40;attempt++){
    if(child.exitCode!==null)throw new Error(`server exited ${child.exitCode}`);
    try{if((await fetch(URL)).ok)return child;}catch(_){/* starting */}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  child.kill();throw new Error("locomotion evaluator server timeout");
}
async function setup(page, profile, slug="julien-hovan") {
  await page.goto(URL);
  await page.waitForFunction(()=>{try{return(0,eval)("state")==="title"&&(0,eval)("officeMapCv")!==null;}catch(_){return false;}});
  await page.keyboard.press("Enter");await page.keyboard.press("Enter");
  await page.waitForFunction(()=>(0,eval)("state")==="dialogue");await page.keyboard.press("Escape");
  await page.waitForFunction(()=>(0,eval)("state")==="overworld");
  await page.evaluate(async ({profileName,slug})=>{
    const ge=(0,eval),p=ge("player");p.slug=slug;p.moving=false;p.seated=null;p.running=false;
    ge("npcs.length=0");ge("locomotionPhase=0");ge("locomotionContactCount=0");
    ge(`locomotionProfile=DatamonLocomotion.profile('${profileName}')`);
    await ge("loadWalkAnim")(slug);
    let start=null;
    for(let y=2;y<22&&!start;y++)for(let x=2;x<27&&!start;x++){
      let ok=true;for(let dx=0;dx<=8;dx++)if(!ge("walkable")(x+dx,y)){ok=false;break;}
      if(ok)start=[x,y];
    }
    if(!start)throw new Error("No clear evaluator lane");
    p.x=p.fx=start[0];p.y=p.fy=start[1];p.dir="right";ge("camFx=null");ge("camFy=null");
    window.__LOCOMOTION_EVAL_START__=start;
  },{profileName:profile,slug});
}
async function rootJitter(page, mode="pilot-walk") {
  return page.evaluate(modeName=>{
    const ge=(0,eval),p=ge("player"),pilot=ge("locomotionPilot")[p.slug];
    const pilotMode=modeName!=="legacy-walk"&&pilot;
    const motion=modeName==="pilot-run"?"run":"walk";
    const anim=pilotMode?pilot.motions[motion]:ge("walkAnim")[p.slug];
    const metadata=pilotMode?pilot.manifest.motions[motion]:ge("walkAnimMeta")[p.slug];
    const count=pilotMode?pilot.manifest.frameCount:4;
    if(!anim||!metadata)return null;
    let headMax=0,torsoMax=0;
    for(const direction of ["down","up","left","right"]){
      const head=[],torso=[];
      for(let index=0;index<count;index++){
        const image=anim[direction][index],anchor=metadata.frames[`${direction}_${index}`];
        const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;
        const context=canvas.getContext("2d",{willReadFrequently:true});context.drawImage(image,0,0);
        const data=context.getImageData(0,0,image.width,image.height).data;
        let y0=image.height,y1=-1;
        for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(data[(y*image.width+x)*4+3]>=128){y0=Math.min(y0,y);y1=Math.max(y1,y);}
        const visible=y1-y0+1;
        function weighted(start,end){
          const sy=Math.max(0,Math.floor(y0+start*visible)),ey=Math.min(image.height,Math.floor(y0+end*visible)+1);
          let sum=0,weightedX=0;
          for(let y=sy;y<ey;y++)for(let x=0;x<image.width;x++){const alpha=data[(y*image.width+x)*4+3]/255;sum+=alpha;weightedX+=alpha*x;}
          return weightedX/Math.max(sum,1);
        }
        const runtimeScale=window.DatamonLocomotion.authoredFrameScale(image.height,56);
        head.push((weighted(0,.27)-anchor.bodyX)*runtimeScale);
        torso.push((weighted(.27,.58)-anchor.bodyX)*runtimeScale);
      }
      headMax=Math.max(headMax,Math.max(...head)-Math.min(...head));
      torsoMax=Math.max(torsoMax,Math.max(...torso)-Math.min(...torso));
    }
    return{headMax,torsoMax,max:Math.max(headMax,torsoMax)};
  },mode);
}

async function evaluateProfile(browser, profile, dpr=1) {
  const context=await browser.newContext({viewport:{width:800,height:608},deviceScaleFactor:dpr,
    recordVideo:{dir:OUT,size:{width:800,height:608}}});
  const page=await context.newPage(),errors=[],failed=[],requests=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("requestfailed",request=>failed.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response",response=>{if(response.url().startsWith(URL))requests.push(response.url());});
  await setup(page,profile);
  const video=page.video();
  const samplePromise=page.evaluate(()=>new Promise((resolve,reject)=>{
    const ge=(0,eval),start=window.__LOCOMOTION_EVAL_START__[0],samples=[];let deadline=performance.now()+6000;
    function tick(now){
      const p=ge("player");samples.push({t:now,x:p.fx,phase:ge("locomotionPhase")});
      if(p.fx-start>=6)return resolve(samples);
      if(now>deadline)return reject(new Error("evaluator movement timeout"));
      requestAnimationFrame(tick);
    }requestAnimationFrame(tick);
  }));
  await page.keyboard.down("ArrowRight");const samples=await samplePromise;await page.keyboard.up("ArrowRight");
  await page.waitForFunction(()=>!(0,eval)("player").moving);
  await page.waitForTimeout(250);
  const runtime=await page.evaluate(()=>{const ge=(0,eval),p=ge("player"),start=window.__LOCOMOTION_EVAL_START__[0];
    return{distance:p.fx-start,phase:ge("locomotionPhase"),contacts:ge("locomotionContactCount"),
      multiplier:ge("currentMovementMultiplier")(),profile:ge("locomotionProfile"),metadata:!!ge("walkAnimMeta")[p.slug],
      dust:ge("dustParticles.length"),cache:Object.keys(ge("walkMiniCache")).length};});
  runtime.rootJitter=await rootJitter(page,"pilot-walk");
  runtime.requestCount=requests.length;
  await page.screenshot({path:path.join(OUT,`${profile}-dpr${dpr}-final.png`)});
  const velocities=[],frameTimes=[];
  for(let i=1;i<samples.length;i++){
    const dt=(samples[i].t-samples[i-1].t)/1000,dx=samples[i].x-samples[i-1].x;
    if(dt>0)frameTimes.push(dt*1000);
    if(dt>0&&dx>.005)velocities.push(dx/dt);
  }
  const stable=velocities.slice(2,-2),velocity=stats(stable),frames=stats(frameTimes);
  const expected=((runtime.distance/(runtime.profile.walkCycleTiles))%1+1)%1;
  const phaseError=Math.min(Math.abs(runtime.phase-expected),1-Math.abs(runtime.phase-expected));
  const result={candidate:profile,dpr,durationMs:samples.at(-1).t-samples[0].t,velocity,frames,phaseError,...runtime,errors,failed};
  result.valid=errors.length===0&&failed.length===0&&runtime.metadata&&velocity.cv<=MAX_CV&&phaseError<=MAX_PHASE_ERROR&&
    runtime.contacts>=6&&runtime.rootJitter&&runtime.rootJitter.max<=.75&&runtime.requestCount<=MAX_REQUESTS&&frames.p95<=20;
  await context.close();
  const videoPath=await video.path(),target=path.join(OUT,`${profile}-dpr${dpr}.webm`);
  fs.renameSync(videoPath,target);result.video=path.relative(ROOT,target);
  return result;
}

async function evaluateArtMode(browser, slug, mode) {
  const context=await browser.newContext({viewport:{width:800,height:608},deviceScaleFactor:1,
    recordVideo:{dir:OUT,size:{width:800,height:608}}});
  const page=await context.newPage(),errors=[],failed=[],requests=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("requestfailed",request=>failed.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response",response=>{if(response.url().startsWith(URL))requests.push(response.url());});
  await setup(page,"balanced",slug);
  if(mode==="legacy-walk")await page.evaluate(slug=>{delete (0,eval)("locomotionPilot")[slug];},slug);
  const video=page.video(),samplesPromise=page.evaluate(()=>new Promise((resolve,reject)=>{
    const ge=(0,eval),start=window.__LOCOMOTION_EVAL_START__[0],samples=[],deadline=performance.now()+6000;
    function tick(now){
      const p=ge("player");samples.push({t:now,x:p.fx,phase:ge("locomotionPhase")});
      if(p.fx-start>=5)return resolve(samples);
      if(now>deadline)return reject(new Error("art comparison movement timeout"));
      requestAnimationFrame(tick);
    }requestAnimationFrame(tick);
  }));
  if(mode==="pilot-run")await page.keyboard.down("Shift");
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(()=>{const ge=(0,eval);return ge("player.fx")-window.__LOCOMOTION_EVAL_START__[0]>=2;});
  await page.screenshot({path:path.join(OUT,`art-${slug}-${mode}.png`)});
  const samples=await samplesPromise;
  await page.keyboard.up("ArrowRight");
  if(mode==="pilot-run")await page.keyboard.up("Shift");
  await page.waitForFunction(()=>!(0,eval)("player").moving);
  const runtime=await page.evaluate(({slug,mode})=>{const ge=(0,eval),pilot=ge("locomotionPilot")[slug];
    const motion=mode==="pilot-run"?"run":"walk";
    return{pilotResident:!!pilot,frameCount:pilot?pilot.manifest.frameCount:4,motion,
      contacts:ge("locomotionContactCount"),cacheKeys:Object.keys(ge("walkMiniCache")).filter(key=>key.includes(slug)).length};
  },{slug,mode});
  runtime.rootJitter=await rootJitter(page,mode);
  runtime.requestCount=requests.length;
  const artFrameTimes=[];
  for(let i=1;i<samples.length;i++)artFrameTimes.push(samples[i].t-samples[i-1].t);
  runtime.frames=stats(artFrameTimes);
  await context.close();
  const videoPath=await video.path(),target=path.join(OUT,`art-${slug}-${mode}.webm`);
  fs.renameSync(videoPath,target);
  const rootBudget=mode==="pilot-run"?1.25:.75;
  return{slug,mode,durationMs:samples.at(-1).t-samples[0].t,...runtime,errors,failed,
    valid:errors.length===0&&failed.length===0&&runtime.frameCount===(mode==="legacy-walk"?4:8)&&
      runtime.rootJitter&&runtime.rootJitter.max<=rootBudget&&runtime.requestCount<=MAX_REQUESTS&&runtime.frames.p95<=20,
    video:path.relative(ROOT,target)};
}

if(!fs.existsSync(path.join(DIST,"artifact-metadata.json")))throw new Error("Run npm run package first");
fs.rmSync(OUT,{recursive:true,force:true});fs.mkdirSync(OUT,{recursive:true});
const server=await startServer();
try{
  const browser=await chromium.launch({headless:true}),trials=[],artTrials=[];
  try{
    for(const profile of PROFILES)trials.push(await evaluateProfile(browser,profile,1));
    trials.push(await evaluateProfile(browser,"balanced",2));
    for(const slug of PILOT_SLUGS)for(const mode of ["legacy-walk","pilot-walk","pilot-run"])
      artTrials.push(await evaluateArtMode(browser,slug,mode));
  }finally{await browser.close();}
  const valid=trials.filter(trial=>trial.valid&&trial.dpr===1);
  const preference=["balanced","gba","fast"];
  valid.sort((a,b)=>{
    const cvDelta=a.velocity.cv-b.velocity.cv;
    if(Math.abs(cvDelta)>1e-4)return cvDelta;
    const phaseDelta=a.phaseError-b.phaseError;
    if(Math.abs(phaseDelta)>1e-6)return phaseDelta;
    return preference.indexOf(a.candidate)-preference.indexOf(b.candidate);
  });
  const selected=valid[0]?.candidate||null;
  const ledger={schemaVersion:1,evaluator:"distance-phase-v1",constraints:{maxVelocityCv:MAX_CV,maxPhaseError:MAX_PHASE_ERROR,maxWalkRootJitterPx:.75,maxRunRootJitterPx:1.25,maxRequests:MAX_REQUESTS,maxFrameP95Ms:20},
    selectionPolicy:"correctness -> velocity CV -> phase error -> balanced/gba/fast tie preference",selected,trials,
    artComparison:{policy:"three fixed representative identities × legacy walk / 8-frame walk / distinct run",trials:artTrials}};
  fs.writeFileSync(path.join(OUT,"ledger.json"),JSON.stringify(ledger,null,2)+"\n");
  console.log(JSON.stringify({selected,trials:trials.map(({candidate,dpr,valid,velocity,phaseError,durationMs,contacts})=>({candidate,dpr,valid,cv:velocity.cv,phaseError,durationMs,contacts})),
    artTrials:artTrials.map(({slug,mode,valid,frameCount,durationMs})=>({slug,mode,valid,frameCount,durationMs}))},null,2));
  if(!selected||artTrials.some(trial=>!trial.valid))process.exitCode=1;
}finally{server.kill();}
