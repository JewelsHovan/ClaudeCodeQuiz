// @ts-check
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const coreJs = fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/core.js"), "utf8");

async function boot(page) {
  const errors = [], failures = [];
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => { if (["error", "assert"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
  page.on("requestfailed", request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", response => { if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`); });
  await page.addInitScript(coreJs);
  await page.goto("/");
  await page.waitForFunction(() => { try { return (0,eval)("state") === "title" && (0,eval)("officeMapCv") !== null; } catch { return false; } });
  return { errors, failures };
}

async function startFreshPrologue(page) {
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (0,eval)("state") === "select");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (0,eval)("state") === "dialogue");
}

async function skipFreshPrologue(page) {
  await startFreshPrologue(page);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (0,eval)("state") === "overworld");
}

async function progressDialogue(page, choice = 0, terminalState = "overworld") {
  for (let guard = 0; guard < 24; guard++) {
    const snapshot = await page.evaluate(() => {
      const ge=(0,eval), state=ge("state");
      if (state !== "dialogue") return { state };
      const session=ge("dialogueSession");
      return { state, phase:session.phase, staging:!!ge("dialogueStaging") };
    });
    if (snapshot.state !== "dialogue") break;
    if (snapshot.staging) { await page.waitForTimeout(35); continue; }
    await page.keyboard.press(snapshot.phase === "choice" ? String(choice + 1) : "Enter");
    await page.waitForTimeout(20);
  }
  if (terminalState) await page.waitForFunction(expected => (0,eval)("state") === expected, terminalState);
}

async function logicalPoint(page, expression) {
  return page.evaluate(expr => {
    const ge=(0,eval), rect=ge(expr), canvas=document.getElementById("game"), bounds=canvas.getBoundingClientRect();
    return { x:bounds.left+(rect.x+rect.w/2)/ge("CANVAS_W")*bounds.width,
      y:bounds.top+(rect.y+rect.h/2)/ge("CANVAS_H")*bounds.height };
  }, expression);
}

async function positionAtSeatedNonAgent(page) {
  return page.evaluate(() => {
    const ge=(0,eval), target=ge("npcs").find(npc=>npc._seated && npc.type!=="AGENT"), p=ge("player");
    if(!target) throw new Error("No seated non-Agent colleague");
    const candidates=[{x:target.x,y:target.y+1,dir:"up"},{x:target.x,y:target.y-1,dir:"down"},
      {x:target.x+1,y:target.y,dir:"left"},{x:target.x-1,y:target.y,dir:"right"}];
    const spot=candidates.find(candidate=>ge("walkable")(candidate.x,candidate.y));
    if(!spot) throw new Error("No reachable seated-colleague interaction cell");
    p.x=p.fx=spot.x;p.y=p.fy=spot.y;p.dir=spot.dir;p.moving=false;ge("camFx = null");ge("camFy = null");
    return {slug:target.slug,type:target.type,seat:[target.x,target.y],start:[spot.x,spot.y],dir:spot.dir};
  });
}

test.describe("Portrait dialogue, certification prologue, and seated challenge staging", () => {
  test("keyboard prologue branches, announces complete beats, persists quest, and replays without objective drift", async ({ page }) => {
    const observed = await boot(page);
    await startFreshPrologue(page);
    const opened = await page.evaluate(() => {
      const ge=(0,eval), session=ge("dialogueSession"), quest=ge("_progression.quests")[ge("DatamonState.CERTIFICATION_QUEST_ID")], p=ge("player");
      return {state:ge("state"),script:session.script.id,beat:session.beatId,phase:session.phase,consumed:session.consumedTokens.length,
        quest:{...quest},position:[p.x,p.y],announcement:document.getElementById("datamon-announcer").textContent};
    });
    expect(opened).toMatchObject({state:"dialogue",script:"certification-prologue-v1",beat:"link",phase:"typing",consumed:0,
      quest:{status:"active",objective:"Report to the Certification Console",prologueSeen:false}});
    expect(opened.announcement).toContain("Certification Command");
    expect(opened.announcement).toContain("Candidate link established");

    // One held physical key reveals only; a synthetic repeat:false duplicate cannot cross the beat.
    await page.keyboard.down("Enter");
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter",code:"Enter",repeat:false,bubbles:true})));
    const held = await page.evaluate(() => {const s=(0,eval)("dialogueSession");return{beat:s.beatId,phase:s.phase,consumed:s.consumedTokens.length};});
    expect(held).toEqual({beat:"link",phase:"ready",consumed:1});
    await page.keyboard.up("Enter");
    await page.keyboard.press("Enter"); // purpose
    const beforeMove = await page.evaluate(() => {const p=(0,eval)("player");return[p.x,p.y];});
    await page.keyboard.press("ArrowLeft"); // invalid while typing; world must remain frozen
    expect(await page.evaluate(() => {const p=(0,eval)("player");return[p.x,p.y];})).toEqual(beforeMove);
    await page.keyboard.press("Enter"); // reveal purpose
    await page.keyboard.press("Enter"); // commit
    await page.keyboard.press("Enter"); // reveal choices
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => (0,eval)("dialogueSession.choice"))).toBe(1);
    expect(await page.locator("#datamon-announcer").textContent()).toContain("Choice 2 of 2");
    await page.keyboard.press("Enter"); // standard branch
    await progressDialogue(page, 0, "overworld");

    const completed = await page.evaluate(() => {
      const ge=(0,eval), q=ge("_progression.quests")[ge("DatamonState.CERTIFICATION_QUEST_ID")];
      return {quest:{...q},stored:JSON.parse(localStorage.getItem(ge("DatamonState.SAVE_KEY"))).progression.quests[ge("DatamonState.CERTIFICATION_QUEST_ID")],
        announcement:document.getElementById("datamon-announcer").textContent};
    });
    expect(completed.quest).toEqual({status:"active",objective:"Report to the Certification Console",prologueSeen:true});
    expect(completed.stored).toEqual(completed.quest);
    expect(completed.announcement).toContain("Certification quest active");

    // Reporting to the real Console advances once. P replays briefing and Escape preserves that objective.
    await page.evaluate(() => {const ge=(0,eval),p=ge("player");p.x=p.fx=17;p.y=p.fy=5;p.dir="up";p.moving=false;ge("interact")();});
    expect(await page.evaluate(() => ({state:(0,eval)("state"),script:(0,eval)("dialogueSession.script.id"),open:(0,eval)("certConsoleOpen"),objective:(0,eval)("certificationQuestRecord")().objective})))
      .toEqual({state:"dialogue",script:"certification-console-arrival-v1",open:false,objective:"Challenge colleagues across all five domains"});
    await progressDialogue(page, 0, "overworld");
    expect(await page.evaluate(() => (0,eval)("certConsoleOpen"))).toBe(true);
    await page.keyboard.press("p");
    await page.waitForFunction(() => (0,eval)("state") === "dialogue");
    expect(await page.evaluate(() => (0,eval)("dialogueContext.replay"))).toBe(true);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => ({state:(0,eval)("state"),objective:(0,eval)("certificationQuestRecord")().objective})))
      .toEqual({state:"overworld",objective:"Challenge colleagues across all five domains"});
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("pointer activation is exact-once and the visible skip control safely activates the quest", async ({ page }) => {
    const observed = await boot(page);
    await startFreshPrologue(page);
    const advance = await logicalPoint(page, "dialogueHitGeometry().advance");
    await page.mouse.click(advance.x, advance.y);
    expect(await page.evaluate(() => {const s=(0,eval)("dialogueSession");return{beat:s.beatId,phase:s.phase,consumed:s.consumedTokens.length};}))
      .toEqual({beat:"link",phase:"ready",consumed:1});
    await page.mouse.click(advance.x, advance.y);
    expect(await page.evaluate(() => {const s=(0,eval)("dialogueSession");return{beat:s.beatId,phase:s.phase,consumed:s.consumedTokens.length};}))
      .toEqual({beat:"purpose",phase:"typing",consumed:2});
    await page.mouse.click(advance.x, advance.y); // reveal purpose
    await page.mouse.click(advance.x, advance.y); // advance to commit
    await page.mouse.click(advance.x, advance.y); // reveal commit choices
    const secondChoice = await logicalPoint(page, "dialogueHitGeometry().choices[1]");
    await page.mouse.click(secondChoice.x, secondChoice.y);
    expect(await page.locator("#datamon-announcer").textContent()).toContain("Selected choice: Brief me on the standard first");
    const skip = await logicalPoint(page, "dialogueHitGeometry().skip");
    await page.mouse.click(skip.x, skip.y);
    await page.waitForFunction(() => (0,eval)("state") === "overworld");
    expect(await page.locator("#datamon-announcer").textContent()).toContain("Scene skipped");
    expect(await page.evaluate(() => (0,eval)("certificationQuestRecord")().prologueSeen)).toBe(true);
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("seated colleague stands, displaces safely before dialogue, battles, and restores the chair after loss", async ({ page }) => {
    const observed = await boot(page);
    await skipFreshPrologue(page);
    const target = await positionAtSeatedNonAgent(page);
    await page.keyboard.press("Space");
    const staged = await page.evaluate(slug => {
      const ge=(0,eval), npc=ge("npcs").find(n=>n.slug===slug),p=ge("player"),restore=ge("encounterSeatRestore"),grid=ge("map"),solid=ge("SOLID");
      return {state:ge("state"),kind:ge("dialogueContext.kind"),beat:ge("dialogueSession.beatId"),consumed:ge("dialogueSession.consumedTokens.length"),
        seated:npc._seated,seat:[restore.x,restore.y],player:[p.x,p.y],visual:[p.fx,p.fy],staging:!!ge("dialogueStaging"),
        valid:!solid.has(grid[p.y][p.x])&&!ge("OFFICE_SEATS").has(`${p.x},${p.y}`)&&!ge("npcs").some(n=>n!==npc&&n.x===p.x&&n.y===p.y),
        overlap:p.x===npc.x&&p.y===npc.y};
    }, target.slug);
    expect(staged).toMatchObject({state:"dialogue",kind:"challenge",beat:"challenge",consumed:0,seated:false,seat:target.seat,staging:true,valid:true,overlap:false});
    expect(staged.player).not.toEqual(target.start);
    await page.keyboard.press("Enter"); // staging owns input; no spoken beat may advance yet
    expect(await page.evaluate(() => (0,eval)("dialogueSession.consumedTokens.length"))).toBe(0);
    await page.waitForFunction(() => !(0,eval)("dialogueStaging"));
    expect(await page.evaluate(() => {const p=(0,eval)("player");return[p.fx,p.fy,p.x,p.y];})).toEqual([staged.player[0],staged.player[1],staged.player[0],staged.player[1]]);
    expect(await page.evaluate(slug => {const ge=(0,eval),frame=ge("challengeFacingFrame"),npc=ge("npcs").find(n=>n.slug===slug);return{slug:frame&&frame.slug,facing:!!frame&&frame.dir===npc.dir,image:!!(frame&&frame.image),resident:Object.keys(ge("walkMiniCache")).filter(key=>key.startsWith("challenge:")).length};}, target.slug))
      .toEqual({slug:target.slug,facing:true,image:true,resident:1});

    await progressDialogue(page, 0, null);
    await page.waitForFunction(() => (0,eval)("state") === "battle");
    expect(await page.evaluate(slug => {const ge=(0,eval),npc=ge("npcs").find(n=>n.slug===slug);return{seated:npc._seated,restore:!!ge("encounterSeatRestore"),battle:ge("battle.npc.slug")};}, target.slug))
      .toEqual({seated:false,restore:true,battle:target.slug});
    await page.evaluate(() => {const b=(0,eval)("battle");b.agentOps=null;b.phase="lose";b.msg="Simulation loss.";b.msgAt=-1e9;});
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "dialogue");
    expect(await page.evaluate(slug => ({script:(0,eval)("dialogueSession.script.id"),npc:(0,eval)("dialogueContext.npc.slug"),battle:(0,eval)("battle")} ), target.slug))
      .toEqual({script:`campaign-outcome:${target.slug}:loss`,npc:target.slug,battle:null});
    await progressDialogue(page, 0, "overworld");
    expect(await page.evaluate(({slug,seat}) => {const ge=(0,eval),npc=ge("npcs").find(n=>n.slug===slug);return{seated:npc._seated,pos:[npc.x,npc.y],restore:ge("encounterSeatRestore"),facing:ge("challengeFacingFrame"),cache:Object.keys(ge("walkMiniCache")).filter(key=>key.startsWith("challenge:")).length};}, target))
      .toEqual({seated:true,pos:target.seat,restore:null,facing:null,cache:0});
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("seated encounter restores after flee, reload, and campaign win", async ({ page }) => {
    const observed = await boot(page);
    await skipFreshPrologue(page);
    let target = await positionAtSeatedNonAgent(page);
    await page.keyboard.press("Space");
    await progressDialogue(page, 0, null);
    await page.waitForFunction(() => (0,eval)("state") === "battle");
    await page.evaluate(() => {const ge=(0,eval),b=ge("battle");b.phase="question";Math.random=()=>0;ge("attemptRun")();});
    expect(await page.evaluate(slug => {const ge=(0,eval),npc=ge("npcs").find(n=>n.slug===slug);return{state:ge("state"),seated:npc._seated,restore:ge("encounterSeatRestore")};}, target.slug))
      .toEqual({state:"overworld",seated:true,restore:null});

    target = await positionAtSeatedNonAgent(page);
    await page.keyboard.press("Space");
    await page.waitForFunction(() => (0,eval)("state") === "dialogue" && !!(0,eval)("encounterSeatRestore"));
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.waitForFunction(() => (0,eval)("state") === "title");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "overworld");
    expect(await page.evaluate(slug => {const ge=(0,eval),npc=ge("npcs").find(n=>n.slug===slug);return{seated:npc._seated,dialogue:ge("dialogueSession"),restore:ge("encounterSeatRestore")};}, target.slug))
      .toEqual({seated:true,dialogue:null,restore:null});

    target = await positionAtSeatedNonAgent(page);
    await page.keyboard.press("Space");
    await progressDialogue(page, 0, null);
    await page.waitForFunction(() => (0,eval)("state") === "battle");
    await page.evaluate(() => {const b=(0,eval)("battle");b.phase="win";b.msg="Victory.";b.msgAt=-1e9;});
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "dialogue");
    expect(await page.evaluate(slug => {const ge=(0,eval),npc=ge("npcs").find(n=>n.slug===slug);return{script:ge("dialogueSession.script.id"),seated:npc._seated,defeated:npc.defeated,restore:ge("encounterSeatRestore")};}, target.slug))
      .toEqual({script:`campaign-outcome:${target.slug}:win`,seated:true,defeated:true,restore:null});
    await progressDialogue(page, 0, "overworld");
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("final portrait-led campaign debrief completes the quest before the victory screen", async ({ page }) => {
    const observed = await boot(page);
    await skipFreshPrologue(page);
    const target = await page.evaluate(() => {
      const ge=(0,eval),list=ge("npcs"),npc=list.find(n=>!n._seated&&n.type!=="AGENT"),p=ge("player");
      for(const rival of list){if(rival!==npc){rival.defeated=true;ge("defeated").add(rival.slug);}}
      const spots=[[npc.x,npc.y+1,"up"],[npc.x,npc.y-1,"down"],[npc.x+1,npc.y,"left"],[npc.x-1,npc.y,"right"]];
      const spot=spots.find(value=>ge("walkable")(value[0],value[1]));p.x=p.fx=spot[0];p.y=p.fy=spot[1];p.dir=spot[2];p.moving=false;
      ge("beginNpcDialogue")(npc);return{slug:npc.slug};
    });
    await progressDialogue(page, 0, null);
    await page.waitForFunction(() => (0,eval)("state") === "battle");
    await page.evaluate(() => {const b=(0,eval)("battle");b.phase="win";b.msg="Final victory.";b.msgAt=-1e9;});
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "dialogue");
    expect(await page.evaluate(slug => ({script:(0,eval)("dialogueSession.script.id"),quest:(0,eval)("certificationQuestRecord")(),defeated:(0,eval)("npcs").find(n=>n.slug===slug).defeated}), target.slug))
      .toEqual({script:`campaign-outcome:${target.slug}:win`,quest:{status:"completed",objective:"Claude Code certification complete",prologueSeen:true},defeated:true});
    await progressDialogue(page, 0, "victory");
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("portrait-led seated Agent defeat restores its chair before the outcome debrief", async ({ page }) => {
    const observed = await boot(page);
    await skipFreshPrologue(page);
    const target = await positionAtSeatedNonAgent(page);
    await page.evaluate(slug => { (0,eval)("npcs").find(n=>n.slug===slug).type="AGENT"; }, target.slug);
    await page.keyboard.press("Space");
    await progressDialogue(page, 0, null);
    await page.waitForFunction(() => (0,eval)("state") === "battle" && !!(0,eval)("battle.agentOps"));
    await page.evaluate(() => {const b=(0,eval)("battle");b.agentOps.phase="defeat";b.phase="defeat";b._agentDefeatConsumed=true;b.msg="Agent defeat.";b.msgAt=-1e9;});
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "dialogue");
    expect(await page.evaluate(slug => {const ge=(0,eval),npc=ge("npcs").find(n=>n.slug===slug);return{script:ge("dialogueSession.script.id"),seated:npc._seated,restore:ge("encounterSeatRestore"),battle:ge("battle")};}, target.slug))
      .toEqual({script:`campaign-outcome:${target.slug}:loss`,seated:true,restore:null,battle:null});
    await progressDialogue(page, 0, "overworld");
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("fully blocked seated handoff falls back in place and declining restores the seat without battle", async ({ page }) => {
    const observed = await boot(page);
    await skipFreshPrologue(page);
    const target = await positionAtSeatedNonAgent(page);
    const blocked = await page.evaluate(slug => {
      const ge=(0,eval),npc=ge("npcs").find(n=>n.slug===slug),p=ge("player"),dx=Math.sign(p.x-npc.x),dy=Math.sign(p.y-npc.y);
      const cells=[[p.x+dx,p.y+dy],[p.x+(dy||0),p.y+(-dx||0)],[p.x-(dy||0),p.y-(-dx||0)]];
      const blockers=ge("npcs").filter(n=>n!==npc&&!n._seated).slice(0,3);
      blockers.forEach((blocker,index)=>{blocker.x=cells[index][0];blocker.y=cells[index][1];});
      const before=[p.x,p.y];ge("beginNpcDialogue")(npc);
      return {before,after:[p.x,p.y],staging:ge("dialogueStaging"),standing:!npc._seated,restore:!!ge("encounterSeatRestore")};
    }, target.slug);
    expect(blocked).toEqual({before:target.start,after:target.start,staging:null,standing:true,restore:true});
    await page.keyboard.press("Enter"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter"); // challenge reveal, response, response reveal
    expect(await page.evaluate(() => (0,eval)("dialogueSession.phase"))).toBe("choice");
    await page.keyboard.press("2");
    expect(await page.evaluate(slug => {const ge=(0,eval),npc=ge("npcs").find(n=>n.slug===slug);return{state:ge("state"),battle:ge("battle"),seated:npc._seated,restore:ge("encounterSeatRestore")};}, target.slug))
      .toEqual({state:"overworld",battle:null,seated:true,restore:null});
    expect(await page.locator("#datamon-announcer").textContent()).toContain("Selected choice: Not yet");
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("reduced motion reveals complete text and converges seated staging instantly", async ({ page }) => {
    await page.emulateMedia({ reducedMotion:"reduce" });
    const observed = await boot(page);
    await startFreshPrologue(page);
    await page.waitForFunction(() => (0,eval)("dialogueSession.phase") === "ready");
    const prologue = await page.evaluate(() => {const ge=(0,eval),s=ge("dialogueSession"),b=ge("DatamonDialogueRuntime.currentBeat")(s);return{visible:s.visibleChars,total:b.text.length};});
    expect(prologue.visible).toBe(prologue.total);
    await page.keyboard.press("Escape");
    const target = await positionAtSeatedNonAgent(page);
    await page.evaluate(slug => {const ge=(0,eval),npc=ge("npcs").find(n=>n.slug===slug);ge("beginNpcDialogue")(npc);}, target.slug);
    expect(await page.evaluate(() => {const ge=(0,eval),p=ge("player");return{staging:ge("dialogueStaging"),coords:[p.fx,p.fy,p.x,p.y],phase:ge("dialogueSession.phase")};}))
      .toMatchObject({staging:null,coords:expect.any(Array)});
    const coords = await page.evaluate(() => {const p=(0,eval)("player");return[p.fx,p.fy,p.x,p.y];});
    expect(coords.slice(0,2)).toEqual(coords.slice(2));
    await page.keyboard.press("Escape");
    expect(await page.evaluate(slug => (0,eval)("npcs").find(n=>n.slug===slug)._seated, target.slug)).toBe(true);
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("missing packaged portrait falls back to initials without a page crash", async ({ page }) => {
    const pageErrors = [], expected404 = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("response", response => { if (response.url().includes("/portraits/alex-andrianavalontsalama.png")) expected404.push(response.status()); });
    await page.route("**/portraits/alex-andrianavalontsalama.png", route => route.fulfill({status:404,contentType:"image/png",body:""}));
    await page.addInitScript(coreJs);
    await page.goto("/");
    await page.waitForFunction(() => (0,eval)("state") === "title" && (0,eval)("officeMapCv") !== null);
    await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "dialogue");
    await page.waitForTimeout(80);
    const fallback = await page.evaluate(() => {
      const ge=(0,eval),canvas=ge("pixelHead")("alex-andrianavalontsalama",64),data=canvas.getContext("2d").getImageData(0,0,64,64).data;
      let opaque=0;for(let i=3;i<data.length;i+=4)if(data[i]>0)opaque++;
      return{opaque,portrait:ge("DatamonWorldArt.getPortrait")("alex-andrianavalontsalama")};
    });
    expect(fallback.opaque).toBeGreaterThan(100); expect(fallback.portrait).toBe(null);
    expect(expected404).toEqual([404]); expect(pageErrors).toEqual([]);
  });

  test("existing schema-v2 character without quest resumes without entering the prologue", async ({ page }) => {
    const raw = JSON.stringify({schemaVersion:2,player:"alex-andrianavalontsalama",defeated:["ethan-pirso"],questionStats:{},seenCounter:0,coffeeUses:2,
      difficulty:"normal",libraryProgress:{},minigameScores:{},progression:{badges:["legacy"],quests:{mentor:"active"},activities:{},npcDomains:{}}});
    await page.addInitScript(value => localStorage.setItem("datamon-save-v1", value), raw);
    const observed = await boot(page);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "overworld");
    expect(await page.evaluate(() => ({dialogue:(0,eval)("dialogueSession"),quest:(0,eval)("certificationQuestRecord")(),raw:localStorage.getItem("datamon-save-v1")})))
      .toEqual({dialogue:null,quest:{status:"active",objective:"Report to the Certification Console",prologueSeen:true},raw});
    await page.evaluate(() => (0,eval)("save")());
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("datamon-save-v1")));
    expect(saved.progression.badges).toEqual(["legacy"]); expect(saved.progression.quests.mentor).toBe("active");
    expect(saved.progression.quests["claude-code-certification"].prologueSeen).toBe(true);
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });

  test("all-defeated legacy-compatible save reaches victory without rewriting raw storage on resume", async ({ page }) => {
    const observed = await boot(page);
    await page.waitForLoadState("networkidle");
    const raw = await page.evaluate(() => {
      const ge=(0,eval),roster=ge("ROSTER");
      const value=JSON.stringify({schemaVersion:2,player:roster[0],defeated:roster.slice(1),questionStats:{},seenCounter:0,coffeeUses:3,
        difficulty:"normal",libraryProgress:{},minigameScores:{},progression:{badges:[],quests:{},activities:{},npcDomains:{}}});
      localStorage.setItem("datamon-save-v1",value);return value;
    });
    await page.reload();
    await page.waitForFunction(() => (0,eval)("state") === "title");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (0,eval)("state") === "victory");
    expect(await page.evaluate(() => ({raw:localStorage.getItem("datamon-save-v1"),dialogue:(0,eval)("dialogueSession"),quest:(0,eval)("certificationQuestRecord")()})))
      .toEqual({raw,dialogue:null,quest:{status:"active",objective:"Report to the Certification Console",prologueSeen:true}});
    expect(observed.errors).toEqual([]); expect(observed.failures).toEqual([]);
  });
});
