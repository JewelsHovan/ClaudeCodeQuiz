#!/usr/bin/env node

// Verify DATAMON's intentional public-release contract:
//   1. an unauthenticated client must receive the public HTML with HTTP 200;
//   2. metadata and runtime bytes must match the exact deployed artifact;
//   3. the actual public page must boot and accept immediate one-tap movement.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const DIST = path.resolve(import.meta.dirname, "..", "dist");
const wayfindingManifest = JSON.parse(fs.readFileSync(path.join(DIST, "props-wayfinding/manifest.json"), "utf8"));
const sittingManifest = JSON.parse(fs.readFileSync(path.join(DIST, "sprites-sit/manifest.json"), "utf8"));
const WAYFINDING_FILES = ["props-wayfinding/manifest.json", ...wayfindingManifest.entries.map(entry => `props-wayfinding/${entry.file}`)];
const EXPANDED_ROSTER = ["andrea-vreugdenhil", "elina-gu", "jewoo-lee", "milen-thomas", "minh-ngoc-do", "oyku-cildir", "saransh-padhy", "wild-guevera"];
const CHARACTER_RELEASE_FILES = [
  ...sittingManifest.entries.map(entry => `portraits/${entry.slug}.png`),
  ...EXPANDED_ROSTER.flatMap(slug => [
    `headshots/${slug}.png`, `sprites/${slug}.png`,
    ...["down", "left", "right", "up"].flatMap(direction => [0,1,2,3].map(frame => `sprites-walk/${slug}/${direction}_${frame}.png`)),
    `sprites-sit/${slug}/idle_0.png`, `sprites-sit/${slug}/idle_1.png`,
  ]),
];
const RUNTIME_FILES = [
  "index.html", "state.js", "attributes.js", "battle-ops.js", "agent-arena.js", "questions.js",
  "progress.js", "dialogue.js", "world-art.js", "music.js", "game.js",
  ...WAYFINDING_FILES, ...CHARACTER_RELEASE_FILES,
];

const baseUrl = process.argv[2];
const expectedCommit = process.argv[3] || null;
if (!baseUrl) throw new Error("Usage: node scripts/smoke-remote.mjs <url> [expected-commit]");
const url = new URL(baseUrl).href;
async function verifyPublicBoundary() {
  const response = await fetch(url, { redirect: "manual", cache: "no-store" });
  const type = response.headers.get("content-type") || "";
  if (response.status !== 200 || !type.includes("text/html")) {
    const location = response.headers.get("location") || "";
    throw new Error(`PUBLIC ACCESS: unauthenticated ${url} returned HTTP ${response.status} ${type || "unknown content type"}${location ? ` → ${location}` : ""}`);
  }
  console.log(`Public boundary passed: unauthenticated HTTP 200 (${type})`);
}

async function fetchMetadata() {
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const response = await fetch(new URL("artifact-metadata.json", url), { cache: "no-store" });
      if (!response.ok) throw new Error(`public metadata HTTP ${response.status}`);
      const type = response.headers.get("content-type") || "";
      if (!type.includes("json")) throw new Error(`public metadata returned ${type || "unknown content type"}`);
      const metadata = await response.json();
      if (expectedCommit && metadata.commit !== expectedCommit) {
        throw new Error(`remote commit ${metadata.commit} != ${expectedCommit}`);
      }
      return metadata;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function verifyRuntimeBytes(metadata) {
  for (const file of RUNTIME_FILES) {
    if (!fs.existsSync(path.join(DIST, file))) throw new Error(`checked artifact is missing dist/${file}`);
  }
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      for (const file of RUNTIME_FILES) {
        const remoteUrl = new URL(file, url);
        // A unique probe avoids one edge response masking convergence elsewhere.
        remoteUrl.searchParams.set("artifact", `${metadata.payloadSha256}-${attempt}`);
        const response = await fetch(remoteUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`public runtime ${file} returned HTTP ${response.status}`);
        const remote = Buffer.from(await response.arrayBuffer());
        const local = fs.readFileSync(path.join(DIST, file));
        if (!remote.equals(local)) throw new Error(`public runtime ${file} does not match checked dist/${file}`);
      }
      console.log(`Runtime bytes passed: ${RUNTIME_FILES.length} public files match checked dist/`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 8) await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

await verifyPublicBoundary();
const metadata = await fetchMetadata();
await verifyRuntimeBytes(metadata);
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  // Match a Retina desktop viewport: DPR2 activates accepted HD detail entities and
  // guards the production-only depth-sort/render path as well as ordinary movement.
  const page = await browser.newPage({
    viewport: { width: 1407, height: 853 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => {
    if (["error", "assert"].includes(message.type())) errors.push(`console.${message.type()}: ${message.text()}`);
  });
  page.on("requestfailed", request => errors.push(`requestfailed: ${request.url()}`));
  page.on("response", response => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error(`public root HTTP ${response?.status()}`);
  await page.waitForFunction(() => {
    try { return eval("state") === "title"; } catch (_) { return false; }
  }, null, { timeout: 15000 });

  // Use quick presses, not held keys: this guards the real tap path that regressed.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    try { return eval("state") === "overworld"; } catch (_) { return false; }
  }, null, { timeout: 15000 });
  const start = await page.evaluate(() => {
    const current = eval("player");
    return { x: current.x, y: current.y };
  });
  const movementPath = [
    ["w", { x: start.x, y: start.y - 1 }],
    ["a", { x: start.x - 1, y: start.y - 1 }],
    ["s", { x: start.x - 1, y: start.y }],
    ["d", start],
  ];
  for (const [key, expected] of movementPath) {
    await page.keyboard.press(key);
    await page.waitForFunction(target => {
      try {
        const current = eval("player");
        return !current.moving && current.x === target.x && current.y === target.y;
      } catch (_) { return false; }
    }, expected, { timeout: 5000 });
  }
  console.log(`Public movement passed: W/A/S/D quick taps returned to (${start.x}, ${start.y})`);

  // Exercise explicit seating and the evidence console on the real public runtime.
  await page.evaluate(() => {
    const ge = (0, eval), player = ge("player");
    player.x = player.fx = 14; player.y = player.fy = 21; player.dir = "up"; player.moving = false;
    ge("interact")();
  });
  await page.waitForFunction(() => {
    try {
      const ge = (0, eval), player = ge("player"), frames = ge("getSitFrames")(player.slug);
      return !!player.seated && !!frames && !!frames.idle_0;
    } catch (_) { return false; }
  }, null, { timeout: 10000 });
  await page.keyboard.press("Space");
  const stood = await page.evaluate(() => {
    const player = (0, eval)("player");
    return { x: player.x, y: player.y, seated: player.seated };
  });
  if (stood.x !== 14 || stood.y !== 21 || stood.seated !== null) {
    throw new Error(`public sit/stand contract mismatch: ${JSON.stringify(stood)}`);
  }
  await page.evaluate(() => {
    const ge = (0, eval), player = ge("player");
    player.x = player.fx = 17; player.y = player.fy = 5; player.dir = "up"; player.moving = false;
    ge("interact")();
  });
  const consoleState = await page.evaluate(() => {
    const ge = (0, eval), summary = ge("_getEvidenceSummary")();
    return { open: ge("certConsoleOpen"), evidence: summary.evidencePct, next: summary.recommendationKey };
  });
  if (!consoleState.open || consoleState.evidence !== 0 || consoleState.next !== "AGENT") {
    throw new Error(`public Certification Console mismatch: ${JSON.stringify(consoleState)}`);
  }
  await page.keyboard.press("Escape");
  console.log("Public study office passed: sit/stand assets and Certification Console");

  const spine = await page.evaluate(() => {
    const ge=(0,eval),p=ge("player");
    function preview(x,y,dir){p.x=p.fx=x;p.y=p.fy=y;p.dir=dir;p.moving=false;return ge("officeDestinationPreview")();}
    return {assets:Object.values(ge("wayfindingStore")).filter(Boolean).length,manifest:ge("wayfindingManifest").length,
      pathCells:ge("OFFICE_PATH_MASK").size,
      labels:[preview(7,14,"down").label,preview(11,22,"down").label,preview(24,22,"down").label]};
  });
  if (spine.assets !== 9 || spine.manifest !== 9 || spine.pathCells !== 189 ||
      JSON.stringify(spine.labels) !== JSON.stringify(["Reliability Triage","Battle Room","The Library"])) {
    throw new Error(`public Certification Spine mismatch: ${JSON.stringify(spine)}`);
  }
  const reviewOpen = await page.evaluate(() => {
    const ge=(0,eval),npc=ge("npcs").find(value=>!value.training),p=ge("player");npc.defeated=true;
    const dirs=[[0,1,"up"],[0,-1,"down"],[1,0,"left"],[-1,0,"right"]];
    const spot=dirs.map(([dx,dy,dir])=>({x:npc.x+dx,y:npc.y+dy,dir})).find(pos=>ge("walkable")(pos.x,pos.y));
    p.x=p.fx=spot.x;p.y=p.fy=spot.y;p.dir=spot.dir;p.moving=false;ge("interact")();
    const mr=ge("mentorReview");
    return mr ? {open:true,correct:mr.question.a,id:mr.question.id,alias:`${mr.review.domain}:${mr.review.index}`} : {open:false};
  });
  if (!reviewOpen.open) throw new Error("public mentor review did not open");
  await page.keyboard.press(String(reviewOpen.correct+1));
  const reviewFeedback=await page.evaluate(({id,alias})=>{const ge=(0,eval),mr=ge("mentorReview"),stats=ge("questionStats");return{phase:mr&&mr.phase,correct:mr&&mr.feedback&&mr.feedback.correct,canonical:stats[id],aliasStats:stats[alias]};},{id:reviewOpen.id,alias:reviewOpen.alias});
  if (reviewFeedback.phase !== "feedback" || reviewFeedback.correct !== true ||
      JSON.stringify(reviewFeedback.canonical) !== JSON.stringify(reviewFeedback.aliasStats)) {
    throw new Error(`public mentor review mismatch: ${JSON.stringify(reviewFeedback)}`);
  }
  await page.keyboard.press("Enter");
  console.log("Public Certification Spine passed: wayfinding, destination previews, and mentor review");

  const attributeContract = await page.evaluate(() => {
    const ge=(0,eval),a=ge("DatamonAttributes").derive(ge("CURATED_STATS")["julien-hovan"],ge("CURATED_STATS")["alex-andrianavalontsalama"],"hard");
    return{roster:ge("ROSTER").length,maxHp:a.maxHp,damage:a.wrongDamage,timer:a.hardTimerMs,heal:a.correctHeal,mons:a.opponentMonCount,movement:a.movementMultiplier};
  });
  if (JSON.stringify(attributeContract) !== JSON.stringify({roster:37,maxHp:110,damage:21,timer:35000,heal:8,mons:2,movement:1.1})) {
    throw new Error(`public attribute contract mismatch: ${JSON.stringify(attributeContract)}`);
  }
  console.log("Public character attributes passed: accepted 37-person bounded matchup contract");

  // Exercise the lazy DPR2 architecture path on the public edge, not only office boot.
  await page.evaluate(() => eval("enterBattleRoom")());
  await page.waitForFunction(() => {
    try { return eval("currentMap") === "battleRoom" && eval("battleRoomMapCv") !== null; }
    catch (_) { return false; }
  }, null, { timeout: 15000 });
  const training = await page.evaluate(() => ({
    rivals: eval("npcs").length,
    expectedRivals: eval("ROSTER").length - 1,
    label: eval("locationHudLabel")(),
    start: { x: eval("player").x, y: eval("player").y },
  }));
  if (training.rivals !== training.expectedRivals || training.label !== "Battle Room") {
    throw new Error(`public Battle Room contract mismatch: ${JSON.stringify(training)}`);
  }
  await page.keyboard.press("w");
  await page.waitForFunction(start => {
    try {
      const current = eval("player");
      return !current.moving && current.x === start.x && current.y === start.y - 1;
    } catch (_) { return false; }
  }, training.start, { timeout: 5000 });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Public Battle Room passed: ${training.rivals} repeatable rivals and DPR2 movement`);
} finally {
  await browser.close();
}
console.log(`Public smoke passed: ${url} commit=${metadata.commitShort} payload=${metadata.payloadSha256}`);
