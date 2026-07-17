// @ts-check
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const coreJs = fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/core.js"), "utf8");

async function setup(page) {
  const errors = [], failedRequests = [];
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => { if (["error", "assert"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
  page.on("requestfailed", request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", response => { if (response.status() >= 400) failedRequests.push(`${response.status()}: ${response.url()}`); });
  await page.addInitScript(coreJs);
  await page.goto("/");
  await page.waitForFunction(() => { try { return (0,eval)("state") === "title" && (0,eval)("officeMapCv") !== null; } catch { return false; } });
  await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => (0,eval)("state") === "dialogue");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (0,eval)("state") === "overworld");
  return { errors, failedRequests };
}

test.describe("High-detail campus layout and readable instrumentation", () => {
  test("all 37 selections get deterministic semantic spacing with six seated colleagues", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1407, height: 853 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const { errors, failedRequests } = await setup(page);
    const result = await page.evaluate(() => {
      const ge=(0,eval), roster=ge("ROSTER"), map=ge("OFFICE_MAP"), solid=ge("SOLID"), seats=ge("OFFICE_SEATS"), mask=ge("OFFICE_PATH_MASK");
      function staticBlocked(x,y){return x<0||y<0||x>=36||y>=24||solid.has(map[y][x])||seats.has(`${x},${y}`);}
      const runs=[];
      for(const slug of roster){
        const p=ge("player");p.slug=slug;p.x=p.fx=18;p.y=p.fy=16;p.moving=false;
        ge("_npcDomains={}");ge("defeated=new Set()");ge("placeNPCs")();
        const list=ge("npcs"),standing=list.filter(n=>!n._seated),occupied=new Set(list.map(n=>`${n.x},${n.y}`));
        const seen=new Set(["18,16"]),queue=[[18,16]];
        while(queue.length){const [x,y]=queue.shift();for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,k=`${nx},${ny}`;if(!seen.has(k)&&!staticBlocked(nx,ny)&&!occupied.has(k)){seen.add(k);queue.push([nx,ny]);}}}
        const reachable=n=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>seen.has(`${n.x+dx},${n.y+dy}`));
        const maxNearby=Math.max(...standing.map(n=>standing.filter(o=>o!==n&&Math.abs(o.x-n.x)+Math.abs(o.y-n.y)<=3).length));
        const zoneCounts={};for(const n of standing)(zoneCounts[n.type]??=new Set()).add(n._layoutZone);
        const snapshot=JSON.stringify(list.map(n=>[n.slug,n.x,n.y,n.type,!!n._seated,n._layoutZone,n._layoutSource]));
        ge("placeNPCs")();
        const repeated=JSON.stringify(ge("npcs").map(n=>[n.slug,n.x,n.y,n.type,!!n._seated,n._layoutZone,n._layoutSource]));
        runs.push({count:list.length,unique:new Set(list.map(n=>`${n.x},${n.y}`)).size,seated:list.filter(n=>n._seated).length,
          standing:standing.length,pathHits:standing.filter(n=>mask.has(`${n.x},${n.y}`)).length,
          fallback:standing.filter(n=>n._layoutSource!=="anchor").length,maxNearby,allReachable:list.every(reachable),
          zones:Object.fromEntries(Object.entries(zoneCounts).map(([domain,zones])=>[domain,zones.size])),deterministic:snapshot===repeated});
      }
      return {runs,moduleDomains:[...window.DatamonWorldLayout.DOMAINS],anchorCounts:Object.fromEntries([...window.DatamonWorldLayout.DOMAINS].map(d=>[d,window.DatamonWorldLayout.officeAnchors(d).length]))};
    });
    expect(result.runs).toHaveLength(37);
    for(const run of result.runs){
      expect(run).toMatchObject({count:36,unique:36,seated:6,standing:30,pathHits:0,allReachable:true,deterministic:true});
      expect(run.maxNearby).toBeLessThanOrEqual(2);
      expect(run.fallback).toBeLessThanOrEqual(3);
      for(const count of Object.values(run.zones)) expect(count).toBeGreaterThanOrEqual(2);
    }
    expect(result.moduleDomains).toEqual(["AGENT","MCP","CONFIG","PROMPT","CONTEXT","MIX"]);
    for(const count of Object.values(result.anchorCounts)) expect(count).toBeGreaterThanOrEqual(8);
    expect(errors).toEqual([]); expect(failedRequests).toEqual([]);
    await context.close();
  });

  test("equal character height, stat value lane, training HUD, and DPR2 floors are measurable", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1407, height: 853 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const { errors, failedRequests } = await setup(page);
    const office = await page.evaluate(() => {
      const ge=(0,eval), c=ge("ctx"), originalDraw=c.drawImage, drawCalls=[];
      c.drawImage=function(...args){if(args.length===5)drawCalls.push([args[3],args[4]]);};
      try{
        const playerSlug=ge("player.slug"),npcSlug=ge("npcs").find(n=>!n._seated).slug;
        ge("defeated=new Set()");ge("drawCharacter")(160,180,playerSlug,"down",true,false,false,false);
        ge("defeated=new Set(ROSTER)");ge("drawCharacter")(240,180,playerSlug,"down",true,false,false,false);
        ge("drawCharacter")(320,180,npcSlug,"down",false,false,false,false);
      }finally{c.drawImage=originalDraw;}
      const stat=ge("selectStatGeometry")(),hud=ge("overworldHudGeometry")("battleRoom");
      const logicalDetail=canvas=>{
        const cc=canvas.getContext("2d",{willReadFrequently:true}),data=cc.getImageData(0,0,canvas.width,canvas.height).data;
        let detailed=0,sampled=0;
        for(let y=40;y<Math.min(canvas.height-2,520);y+=2){for(let x=40;x<Math.min(canvas.width-2,760);x+=2){
          const i=(y*canvas.width+x)*4,j=i+4,k=i+canvas.width*4,l=k+4;sampled++;
          if(data[i]!==data[j]||data[i+1]!==data[j+1]||data[i]!==data[k]||data[i+2]!==data[l+2])detailed++;
        }}return{detailed,sampled};
      };
      return {height:ge("STANDING_CHARACTER_HEIGHT"),drawCalls,stat,hud,officeDetail:logicalDetail(ge("floorTex"))};
    });
    expect(office.height).toBe(56);
    expect(office.drawCalls.filter(([,height])=>Math.abs(height-56)<0.01).length).toBeGreaterThanOrEqual(3);
    expect(office.stat.trackX+office.stat.trackWidth).toBeLessThan(office.stat.valueLeft);
    expect(office.stat.valueRight).toBeLessThanOrEqual(774-18);
    expect(office.hud.hpY+10+6).toBeLessThanOrEqual(office.hud.primaryBaseline);
    expect(office.hud.primaryBaseline+7).toBeLessThan(office.hud.secondaryBaseline);
    expect(office.hud.secondaryBaseline).toBeLessThan(office.hud.y+office.hud.height);
    expect(office.officeDetail.detailed).toBeGreaterThan(25);

    await page.evaluate(() => (0,eval)("enterBattleRoom")());
    await page.waitForFunction(() => (0,eval)("currentMap")==="battleRoom" && (0,eval)("battleRoomMapCv")!==null);
    const battleRoom = await page.evaluate(() => {
      const ge=(0,eval),slots=window.DatamonWorldLayout.battleRoomSlots(),list=ge("npcs"),entry=ge("BATTLE_ROOM_ENTRY");
      const camera={x:Math.max(0,Math.min(36-25,entry[0]-25/2+0.5)),y:Math.max(-ge("CAM_PAD_TOP"),Math.min(24-19,entry[1]-19/2+0.5))};
      const visible=list.filter(n=>n.x>=camera.x-1&&n.x<=camera.x+26&&n.y>=camera.y-1&&n.y<=camera.y+20).length;
      const cv=ge("battleRoomMapCv"),cc=cv.getContext("2d",{willReadFrequently:true}),data=cc.getImageData(0,0,cv.width,cv.height).data;
      let detailed=0;
      for(let y=80;y<Math.min(cv.height-2,900);y+=2)for(let x=80;x<Math.min(cv.width-2,1400);x+=2){const i=(y*cv.width+x)*4,j=i+4,k=i+cv.width*4;if(data[i]!==data[j]||data[i+1]!==data[j+1]||data[i]!==data[k]||data[i+2]!==data[k+2])detailed++;}
      return {slots:slots.length,unique:new Set(slots.map(s=>`${s.x},${s.y}`)).size,lane:slots.filter(s=>s.x>=17&&s.x<=19&&s.y>=9).length,visible,detailed};
    });
    expect(battleRoom).toMatchObject({slots:36,unique:36,lane:0});
    expect(battleRoom.visible).toBeGreaterThanOrEqual(20);
    expect(battleRoom.detailed).toBeGreaterThan(100);
    expect(errors).toEqual([]); expect(failedRequests).toEqual([]);
    await context.close();
  });
});
