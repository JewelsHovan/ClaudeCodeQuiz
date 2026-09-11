#!/usr/bin/env node
// Readiness and completed-resource gate. Keep scripts/perf-audit.mjs as the independent comparator.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const OUTPUT = path.join(ROOT, "test-results", "performance.json");
const BUDGETS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "performance-budgets.json"), "utf8"));
const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 3;
const PORT = 8745, URL = `http://127.0.0.1:${PORT}/`;
const MATRIX = [
  { name:"desktop", dpr:1, cpu:1 },
  { name:"retina", dpr:2, cpu:1 },
  { name:"returning-retina", dpr:2, cpu:1, saved:true },
  { name:"slow-mobile", dpr:2, cpu:4, mbps:1.6, latency:150 },
];
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error("--runs must be a positive integer");
if (!fs.existsSync(path.join(DIST,"artifact-metadata.json"))) throw new Error("Run npm run package first");

async function startServer() {
  const child=spawn("python3",["-m","http.server",String(PORT),"--bind","127.0.0.1"],{cwd:DIST,stdio:"ignore"});
  for(let attempt=0;attempt<40;attempt++) {
    if(child.exitCode!==null) throw new Error(`Artifact server exited with ${child.exitCode}`);
    try {if((await fetch(URL,{signal:AbortSignal.timeout(500)})).ok)return child;}catch{/* starting */}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  child.kill();throw new Error("Artifact server did not become ready");
}
function percentile(values,fraction) {
  const sorted=values.slice().sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*fraction)-1)];
}
const server=await startServer();let browser;const results=[],violations=[];
try {
  browser=await chromium.launch({headless:true});
  for(const config of MATRIX) for(let run=1;run<=RUNS;run++) {
    const context=await browser.newContext({viewport:config.mbps?{width:390,height:844}:{width:1280,height:960},
      deviceScaleFactor:config.dpr,isMobile:!!config.mbps,hasTouch:!!config.mbps});
    try {
      const page=await context.newPage(),cdp=await context.newCDPSession(page),failures=[];
      await cdp.send("Emulation.setCPUThrottlingRate",{rate:config.cpu});
      if(config.mbps) await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:config.latency,
        downloadThroughput:config.mbps*1e6/8,uploadThroughput:750000/8});
      page.on("pageerror",e=>failures.push(`pageerror: ${e.message}`));
      page.on("console",m=>{if(["error","assert"].includes(m.type()))failures.push(`${m.type()}: ${m.text()}`);});
      page.on("requestfailed",r=>failures.push(`${r.url()}: ${r.failure()?.errorText}`));
      page.on("response",r=>{if(r.status()>=400)failures.push(`${r.status()} ${r.url()}`);});
      if(config.saved) await page.addInitScript(()=>localStorage.setItem("datamon-save-v1",JSON.stringify({
        schemaVersion:2,player:"julien-hovan",defeated:[],questionStats:{},seenCounter:0,coffeeUses:3,difficulty:"normal",
        libraryProgress:{},minigameScores:{},progression:{badges:[],quests:{},activities:{battleRoom:{currentStreak:0,bestStreak:0,wins:0}},npcDomains:{}}
      })));
      const titleBudget=config.mbps?BUDGETS.slowNetworkTitleMs:BUDGETS.coldTitleMs;
      await page.goto(URL,{waitUntil:"domcontentloaded",timeout:30000});
      await page.waitForFunction(()=>window.DatamonPerformance?.getDiagnostics().firstTitleDrawMs>0,null,{timeout:30000});
      // Observe through completed asset loading; a loading message or initial state is not readiness.
      await page.waitForLoadState("networkidle",{timeout:30000});
      const result=await page.evaluate(()=>{
        const ge=(0,eval),d=DatamonPerformance.getDiagnostics();
        const resources=[...performance.getEntriesByType("navigation"),...performance.getEntriesByType("resource")];
        return {state:ge("state"),coldTitleMs:d.firstTitleDrawMs,bootReadyMs:d.bootReadyMs,
          requestCount:resources.length,transferBytes:resources.reduce((n,e)=>n+e.transferSize,0),
          bodyBytes:resources.reduce((n,e)=>n+e.encodedBodySize,0),savedPlayer:ge("getSave")()?.player || null,
          residentWalkSlugs:Object.keys(ge("walkAnim")).length,
          residentWalkFrames:Object.values(ge("walkAnim")).reduce((n,dirs)=>n+Object.values(dirs).flat().filter(Boolean).length,0)};
      });
      results.push({config,run,titleBudget,...result,failedRequests:failures});
      const label=`${config.name} run ${run}`;
      if(result.state!=="title" || result.bootReadyMs===null || result.coldTitleMs<result.bootReadyMs) violations.push(`${label}: readiness invalid`);
      if(config.saved&&result.savedPlayer!=="julien-hovan")violations.push(`${label}: returning fixture not loaded`);
      if(result.coldTitleMs>titleBudget)violations.push(`${label}: title ${result.coldTitleMs.toFixed(0)}ms > ${titleBudget}`);
      for(const key of ["requestCount","transferBytes","residentWalkSlugs","residentWalkFrames"]) {
        if(result[key]>BUDGETS[key])violations.push(`${label}: ${key} ${result[key]} > ${BUDGETS[key]}`);
      }
      if(failures.length)violations.push(`${label}: ${failures.join("; ")}`);
      console.log(`${label}: title=${result.coldTitleMs.toFixed(0)}ms, ${result.requestCount} completed requests, ${result.transferBytes} transfer bytes, ${result.residentWalkSlugs} walk slugs`);
    } finally {await context.close();}
  }
} finally {
  if(browser)await browser.close();server.kill();
  fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});
  fs.writeFileSync(OUTPUT,JSON.stringify({generatedAt:new Date().toISOString(),budgets:BUDGETS,matrix:MATRIX,runs:results,
    p90ByProfile:Object.fromEntries(MATRIX.map(config=>[config.name,percentile(results.filter(r=>r.config.name===config.name).map(r=>r.coldTitleMs),.9)])),violations},null,2)+"\n");
}
if(violations.length){console.error("Performance contract failed:\n- "+violations.join("\n- "));process.exitCode=1;}
else console.log(`Performance contract passed (${results.length} cold/profile runs).`);
