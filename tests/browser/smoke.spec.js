// @ts-check
// DATAMON browser smoke test — title → select → overworld → battle.
// Serves from dist/ (the packaged artifact). Fails on page errors,
// console errors/asserts, request failures, and HTTP >=400.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Read core.js for injection before page scripts load.
const coreJs = fs.readFileSync(
  path.resolve(import.meta.dirname, "../../datamon/core.js"),
  "utf-8"
);

const EXPECTED_ROSTER = [
  "alex-andrianavalontsalama", "andrea-vreugdenhil", "antonia-nistor",
  "aurelien-bouffanais", "dana-domanko", "duc-an-nguyen", "elina-gu",
  "emile-moffatt", "ethan-pirso", "felicia-gorgacheva", "francesco-finn",
  "guillaume-delmas-frenette", "guillaume-pregent", "jerry-zhu", "jewoo-lee",
  "jonah-lee", "jonathan-kim", "julien-hovan", "logan-labossiere",
  "megane-darnaud", "milen-thomas", "minh-ngoc-do", "oyku-cildir",
  "pentcho-tchomakov", "philippe-miranda-jean", "richard-el-chaar",
  "sarah-kotb", "saransh-padhy", "scott-carr", "stephanie-fontaine",
  "tabarek-al-khalidi", "tyler-nagano", "veronica-marallag",
  "victor-desautels", "vincent-anctil", "wild-guevera", "william-chan",
];

/**
 * Helper: inject the test seam, set up error/request collectors,
 * navigate to the app, and wait for the title screen.
 */
async function setupPage(page, { signal } = {}) {
  const errors = [];
  const failedRequests = [];

  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    // console.assert with a falsy first arg fires as type "assert"
    if (msg.type() === "assert") errors.push(`console.assert: ${msg.text()}`);
  });
  page.on("requestfailed", (req) => {
    failedRequests.push(`requestfailed: ${req.url()} (${req.failure()?.errorText || "unknown"})`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      failedRequests.push(`HTTP ${res.status}: ${res.url()}`);
    }
  });

  await page.addInitScript(coreJs);
  await page.goto("/");

  return { errors, failedRequests };
}

/**
 * Helper: read the current game state via indirect eval.
 */
async function getState(page) {
  return page.evaluate(() => {
    try { return eval("state"); } catch (_) { return null; }
  });
}

/**
 * Helper: inspect full game state via the test seam.
 */
async function inspectState(page) {
  return page.evaluate(() => {
    return window.__DATAMON_TEST__?.inspectState() || null;
  });
}

async function skipFreshPrologue(page) {
  await page.waitForFunction(() => { try { return eval("state") === "dialogue"; } catch (_) { return false; } });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => { try { return eval("state") === "overworld"; } catch (_) { return false; } });
}

async function acceptCurrentChallenge(page) {
  for (let guard = 0; guard < 12; guard++) {
    const snapshot = await page.evaluate(() => {
      const ge = (0, eval);
      if (ge("state") !== "dialogue") return { state: ge("state") };
      const session = ge("dialogueSession");
      return { state: "dialogue", phase: session.phase, staging: !!ge("dialogueStaging") };
    });
    if (snapshot.state !== "dialogue") return;
    if (snapshot.staging) { await page.waitForTimeout(40); continue; }
    await page.keyboard.press(snapshot.phase === "choice" ? "1" : "Enter");
    await page.waitForTimeout(25);
  }
  throw new Error("Challenge dialogue did not reach its battle effect");
}

async function startDirectBattle(page, { type, boss = false, difficulty = "normal" }) {
  await page.waitForFunction(() => { try { return eval("state") === "title"; } catch (_) { return false; } });
  return page.evaluate(({ requestedType, makeBoss, requestedDifficulty }) => {
    const ge = (0, eval);
    const roster = ge("ROSTER");
    const playerObj = ge("player");
    playerObj.slug = roster[0];
    playerObj.hp = ge("MAX_HP");
    ge(`difficulty = ${JSON.stringify(requestedDifficulty)}`);
    ge("defeated = new Set()");
    ge("_progression = { badges: [], quests: {}, activities: {}, npcDomains: {} }");
    ge("_npcDomains = _progression.npcDomains");
    ge("placeNPCs")();

    const list = ge("npcs");
    const candidates = list.filter(npc => npc.type === requestedType);
    if (!candidates.length) throw new Error(`No ${requestedType} NPC available`);
    const target = candidates[0];
    if (makeBoss) {
      for (const npc of list) {
        if (npc.type === "AGENT" && npc !== target) {
          npc.defeated = true;
          ge("defeated").add(npc.slug);
        }
      }
    }
    window.TEXT_SPEED_OVERRIDE = 10000;
    ge("startBattle")(target);
    return { slug: target.slug, sameObject: ge("npcs").includes(target) };
  }, { requestedType: type, makeBoss: boss, requestedDifficulty: difficulty });
}

async function currentCorrectIndex(page) {
  return page.evaluate(() => {
    const question = (0, eval)("battle.agentOps.question");
    return question.correct != null ? question.correct : question.a;
  });
}

async function acknowledgeAgentMessage(page) {
  await page.evaluate(() => { (0, eval)("battle").msgAt = -1e9; });
  await page.keyboard.press("Enter");
}

async function playKeyboardQueryTurn(page) {
  expect((await inspectState(page)).agentOps.phase).toBe("action");
  await page.keyboard.press("Enter");
  expect((await inspectState(page)).agentOps.phase).toBe("choice");
  await page.keyboard.press(String((await currentCorrectIndex(page)) + 1));
  expect((await inspectState(page)).agentOps.phase).toBe("resolve");
}

async function canvasClientPoint(page, rectExpression) {
  return page.evaluate(expression => {
    const ge = (0, eval);
    const rect = ge(expression);
    const canvas = document.getElementById("game");
    const bounds = canvas.getBoundingClientRect();
    return {
      x: bounds.left + ((rect[0] + rect[2] / 2) / ge("CANVAS_W")) * bounds.width,
      y: bounds.top + ((rect[1] + rect[3] / 2) / ge("CANVAS_H")) * bounds.height,
    };
  }, rectExpression);
}

test.describe("DATAMON smoke test (dist/ artifact)", () => {
  test("dist/ artifact exists and serves index.html", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    const title = await page.title();
    expect(title).toContain("DATAMON");
  });

  test("title screen loads without errors from dist/", async ({ page }) => {
    const { errors, failedRequests } = await setupPage(page);

    // Verify the canvas is present
    const canvas = page.locator("#game");
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Verify test harness is active
    const isActive = await page.evaluate(() => window.__DATAMON_TEST__?.isActive());
    expect(isActive).toBe(true);

    // Wait for the game to render the title screen
    await page.waitForFunction(() => {
      try { return eval("state") === "title"; } catch (_) { return false; }
    }, { timeout: 15000 });

    const state = await getState(page);
    expect(state).toBe("title");

    // No page errors, console errors, or failed requests
    expect(errors, `Unexpected errors: ${errors.join("; ")}`).toEqual([]);
    expect(failedRequests, `Failed requests: ${failedRequests.join("; ")}`).toEqual([]);
  });

  test("expanded roster has complete trainer/portrait art and fits the select matrix", async ({ page }) => {
    const { errors, failedRequests } = await setupPage(page);
    await page.waitForFunction(() => { try { return eval("state") === "title"; } catch (_) { return false; } });

    const title = await page.evaluate(() => {
      const ge = (0, eval), roster = ge("ROSTER"), sprites = ge("sprites");
      return {
        roster,
        trainersReady: roster.every(slug => sprites[slug]?.naturalWidth === 256 && sprites[slug]?.naturalHeight === 256),
      };
    });
    expect(title.roster).toEqual(EXPECTED_ROSTER);
    expect(title.trainersReady).toBe(true);

    const portraits = await page.evaluate(async () => {
      const ge = (0, eval), roster = ge("ROSTER"), art = window.DatamonWorldArt;
      const loaded = await Promise.all(roster.map(slug => art.loadPortrait(slug)));
      return loaded.map(image => image && ({ width: image.naturalWidth, height: image.naturalHeight }));
    });
    expect(portraits).toHaveLength(EXPECTED_ROSTER.length);
    expect(portraits.every(image => image && image.height === 96 && image.width >= 64 && image.width <= 128)).toBe(true);

    const attributes = await page.evaluate(() => {
      const ge = (0, eval), roster = ge("ROSTER"), curated = ge("CURATED_STATS");
      const profiles = Object.fromEntries(roster.map(slug => [slug, ge("charProfile")(slug)]));
      const principals = ["william-chan", "scott-carr", "pentcho-tchomakov"];
      const total = slug => profiles[slug].stats.reduce((sum, value) => sum + value, 0);
      return {
        curatedSlugs: Object.keys(curated).sort(),
        allProfilesMatch: roster.every(slug => JSON.stringify(profiles[slug].stats) === JSON.stringify(curated[slug])),
        creator: profiles["julien-hovan"],
        principalTotals: principals.map(total),
        strongestNonFeatured: Math.max(...roster.filter(slug => slug !== "julien-hovan" && !principals.includes(slug)).map(total)),
        featuredTitles: [profiles["william-chan"].title, profiles["scott-carr"].title, profiles["pentcho-tchomakov"].title],
      };
    });
    expect(attributes.curatedSlugs).toEqual([...EXPECTED_ROSTER].sort());
    expect(attributes.allProfilesMatch).toBe(true);
    expect(attributes.creator.stats).toEqual([100, 100, 100, 100]);
    expect(attributes.creator.title).toBe("The Creator");
    expect(Math.min(...attributes.principalTotals)).toBeGreaterThan(attributes.strongestNonFeatured);
    expect(attributes.featuredTitles).toEqual(["The Founder", "The Managing Partner", "The Chief Architect"]);

    await page.keyboard.press("Enter");
    expect(await page.locator("#datamon-announcer").textContent()).toContain("Caffeine 72");
    await page.keyboard.press("ArrowRight");
    expect(await page.locator("#datamon-announcer").textContent()).toContain("Andrea Vreugdenhil");
    const layout = await page.evaluate(() => {
      const ge = (0, eval), roster = ge("ROSTER"), sel = ge("SEL"), panel = ge("PANEL");
      const rows = Math.ceil(roster.length / sel.cols), rects = ge("difficultyRects")();
      return {
        state: ge("state"), gridRight: sel.ox + sel.cols * sel.cell,
        gridBottom: sel.oy + rows * sel.cell, panelLeft: panel.x,
        difficultyTop: rects[0][1], difficultyBlurbBottom: rects[0][1] + rects[0][3] + 16,
        footerY: ge("CANVAS_H") - 20,
      };
    });
    expect(layout).toMatchObject({ state: "select" });
    expect(layout.gridRight).toBeLessThan(layout.panelLeft);
    expect(layout.gridBottom).toBeLessThan(layout.difficultyTop);
    expect(layout.difficultyBlurbBottom).toBeLessThan(layout.footerY);
    expect(errors, `Unexpected errors: ${errors.join("; ")}`).toEqual([]);
    expect(failedRequests, `Failed requests: ${failedRequests.join("; ")}`).toEqual([]);
  });

  test("overworld moves with Shift+WASD, physical key codes, arrows, and pointer", async ({ page }) => {
    const { errors, failedRequests } = await setupPage(page);
    await page.waitForFunction(() => { try { return eval("state") === "title"; } catch (_) { return false; } });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await skipFreshPrologue(page);

    const start = (await inspectState(page)).player;
    expect({ x: start.x, y: start.y }).toEqual({ x: 18, y: 16 });

    // A quick tap must move immediately; it must never be consumed as turn-only.
    await page.keyboard.press("w");
    await page.waitForTimeout(220);
    const afterTap = (await inspectState(page)).player;
    expect(afterTap.y).toBeLessThan(start.y);

    // Shift changes KeyboardEvent.key to uppercase in real browsers; KeyW remains stable.
    await page.keyboard.down("Shift");
    await page.keyboard.down("w");
    await page.waitForTimeout(220);
    await page.keyboard.up("w");
    await page.keyboard.up("Shift");
    await page.waitForTimeout(220);
    const afterRun = (await inspectState(page)).player;
    expect(afterRun.y).toBeLessThan(afterTap.y);

    // A physical KeyA must work even if the printable key is layout-dependent (for example Q).
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", code: "KeyA" })));
    await page.waitForTimeout(180);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "q", code: "KeyA" })));
    await page.waitForTimeout(220);
    const afterCode = (await inspectState(page)).player;
    expect(afterCode.x).toBeLessThan(afterRun.x);

    // One pointer click away from the player steps once in that direction.
    const point = await page.evaluate(() => {
      const ge=(0,eval), p=ge("player"), canvas=document.getElementById("game"), r=canvas.getBoundingClientRect();
      const sx=(p.fx-ge("camFx"))*ge("TILE")+ge("TILE")/2;
      const sy=(p.fy-ge("camFy"))*ge("TILE")+ge("TILE")/2+80;
      return { x:r.left+(sx/ge("CANVAS_W"))*r.width, y:r.top+(sy/ge("CANVAS_H"))*r.height };
    });
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(260);
    const afterPointer = (await inspectState(page)).player;
    expect(afterPointer.y).toBeGreaterThan(afterCode.y);

    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(180);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(220);
    const afterArrow = (await inspectState(page)).player;
    expect(afterArrow.x).toBeGreaterThan(afterPointer.x);

    // The same normalized input contract must survive the saved-game resume path.
    await page.reload();
    await page.waitForFunction(() => { try { return eval("state") === "title"; } catch (_) { return false; } });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => { try { return eval("state") === "overworld"; } catch (_) { return false; } });
    const resumedStart = (await inspectState(page)).player;
    await page.keyboard.press("w");
    await page.waitForTimeout(220);
    const resumedAfter = (await inspectState(page)).player;
    expect(resumedAfter.y).toBeLessThan(resumedStart.y);

    expect(errors, `Unexpected errors: ${errors.join("; ")}`).toEqual([]);
    expect(failedRequests, `Failed requests: ${failedRequests.join("; ")}`).toEqual([]);
  });

  test("title → select → overworld → battle journey", async ({ page }) => {
    const { errors, failedRequests } = await setupPage(page);

    // Wait for title screen
    await page.waitForFunction(() => {
      try { return eval("state") === "title"; } catch (_) { return false; }
    }, { timeout: 15000 });
    expect(await getState(page)).toBe("title");

    // Press ENTER to advance past title to character select
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      try { return eval("state") === "select"; } catch (_) { return false; }
    }, { timeout: 10000 });
    expect(await getState(page)).toBe("select");

    // Select first character, then explicitly skip the fresh-run certification briefing.
    await page.keyboard.press("Enter");
    await skipFreshPrologue(page);
    expect(await getState(page)).toBe("overworld");

    // Get NPC positions and find a non-defeated target
    const info = await inspectState(page);
    expect(info.player).not.toBeNull();
    expect(info.player.hp).toBeGreaterThan(0);
    expect(info.npcs).not.toBeNull();
    expect(info.npcs.length).toBeGreaterThan(0);

    const targetNpc = info.npcs.find(n => !n.defeated);
    expect(targetNpc, "No non-defeated NPC found").toBeDefined();
    console.log(`Target NPC: ${targetNpc.slug} at (${targetNpc.x}, ${targetNpc.y})`);

    // Teleport the player adjacent to the NPC and face them.
    // The game uses seeded RNG for NPC placement, so positions are deterministic
    // per boot. We walk the player via direct state manipulation to avoid fragile
    // keyboard navigation through office furniture.
    await page.evaluate(({ tx, ty }) => {
      var ge = (0, eval);
      var walkableFn = ge("walkable");
      var playerObj = ge("player");

      // Determine which side of the NPC to stand on.
      // Try each adjacent tile; prefer the one that's walkable floor.
      const candidates = [
        { x: tx, y: ty - 1, dir: "down" },   // above
        { x: tx, y: ty + 1, dir: "up" },      // below
        { x: tx - 1, y: ty, dir: "right" },    // left
        { x: tx + 1, y: ty, dir: "left" },     // right
      ];

      for (const c of candidates) {
        if (walkableFn(c.x, c.y)) {
          playerObj.x = playerObj.fx = c.x;
          playerObj.y = playerObj.fy = c.y;
          playerObj.dir = c.dir;
          playerObj.moving = false;
          return;
        }
      }
      throw new Error("No walkable tile adjacent to NPC");
    }, { tx: targetNpc.x, ty: targetNpc.y });

    await page.waitForTimeout(300);

    // Verify we're still in overworld and adjacent to the NPC
    const preInteractState = await getState(page);
    expect(preInteractState).toBe("overworld");

    const preInteractInfo = await inspectState(page);
    const px = preInteractInfo.player.x;
    const py = preInteractInfo.player.y;
    const dist = Math.abs(px - targetNpc.x) + Math.abs(py - targetNpc.y);
    console.log(`Player at (${px}, ${py}), NPC at (${targetNpc.x}, ${targetNpc.y}), distance=${dist}`);
    expect(dist).toBe(1);

    // Interact, accept the portrait-led challenge, then start battle.
    await page.keyboard.press("Space");
    await page.waitForFunction(() => { try { return eval("state") === "dialogue"; } catch (_) { return false; } });
    await acceptCurrentChallenge(page);
    await page.waitForTimeout(500);

    // Check if we entered battle or transition
    const stateAfter = await getState(page);
    console.log(`State after interaction: ${stateAfter}`);

    // The battle may be in "transition" or "battle" state
    // Wait for battle to fully start (transition plays then enters battle)
    if (stateAfter === "transition") {
      await page.waitForFunction(() => {
        try { return eval("state") === "battle"; } catch (_) { return false; }
      }, { timeout: 10000 });
    }

    const battleState = await getState(page);
    expect(battleState).toBe("battle");

    // Verify the battle has NPC and phase info
    const battleInfo = await inspectState(page);
    expect(battleInfo.battle).not.toBeNull();
    expect(battleInfo.battle.npc).toBe(targetNpc.slug);

    // No page errors or failed requests
    expect(errors, `Unexpected errors: ${errors.join("; ")}`).toEqual([]);
    expect(failedRequests, `Failed requests: ${failedRequests.join("; ")}`).toEqual([]);
  });

  test("required runtime files are served without errors", async ({ page }) => {
    const { errors, failedRequests } = await setupPage(page);

    await page.waitForFunction(() => {
      try { return eval("state") === "title"; } catch (_) { return false; }
    }, { timeout: 15000 });

    // Verify all runtime scripts declared by the packaged page loaded.
    const scriptsLoaded = await page.evaluate(() => {
      const scripts = document.querySelectorAll("script[src]");
      return Array.from(scripts).map(s => ({ src: s.getAttribute("src"), loaded: document.readyState === "complete" }));
    });
    for (const s of scriptsLoaded) {
      expect(s.src).toBeTruthy();
    }

    expect(errors, `Unexpected errors: ${errors.join("; ")}`).toEqual([]);
    expect(failedRequests, `Failed requests: ${failedRequests.join("; ")}`).toEqual([]);
  });

  test("deterministic boot: two page loads produce identical state", async ({ page: page1 }) => {
    const errors = [];
    page1.on("pageerror", (err) => errors.push(err.message));

    await page1.addInitScript(coreJs);
    await page1.goto("/");
    await page1.waitForFunction(() => {
      try { return eval("state") === "title"; } catch (_) { return false; }
    }, { timeout: 15000 });

    const state1 = await page1.evaluate(() => {
      return window.__DATAMON_TEST__?.inspectState() || null;
    });
    expect(state1).not.toBeNull();
    expect(state1.state).toBe("title");

    const canvasSize1 = await page1.evaluate(() => {
      const c = document.getElementById("game");
      return { w: c.width, h: c.height };
    });

    // Second page load — fresh context
    const page2 = await page1.context().newPage();
    page2.on("pageerror", (err) => errors.push(err.message));
    await page2.addInitScript(coreJs);
    await page2.goto("/");
    await page2.waitForFunction(() => {
      try { return eval("state") === "title"; } catch (_) { return false; }
    }, { timeout: 15000 });

    const state2 = await page2.evaluate(() => {
      return window.__DATAMON_TEST__?.inspectState() || null;
    });
    expect(state2).not.toBeNull();
    expect(state2.state).toBe("title");

    const canvasSize2 = await page2.evaluate(() => {
      const c = document.getElementById("game");
      return { w: c.width, h: c.height };
    });

    expect(canvasSize1).toEqual(canvasSize2);
    expect(errors).toEqual([]);
  });

  test("legacy save migrates to v2 without losing progress or rollback aliases", async ({ page }) => {
    const legacy = {
      player: "alex-andrianavalontsalama",
      defeated: ["ethan-pirso", "invalid-slug", "alex-andrianavalontsalama", "ethan-pirso"],
      questionStats: { "AGENT:0": { seen: 2, correct: 1, wrong: 1, lastSeen: 4 } },
      seenCounter: 4,
      coffeeUses: 0,
      difficulty: "hard",
      libraryProgress: { "agent-sdk-deep-dive": 3 },
      minigameScores: { "station-match": 70 },
      progression: {
        badges: ["agent"],
        quests: { mentor: "active" },
        activities: { study: 80 },
        npcDomains: { "ethan-pirso": "AGENT", "invalid-slug": "MCP" },
      },
    };
    const raw = JSON.stringify(legacy);
    await page.addInitScript(value => localStorage.setItem("datamon-save-v1", value), raw);
    const { errors, failedRequests } = await setupPage(page);
    await page.waitForFunction(() => { try { return eval("state") === "title"; } catch (_) { return false; } });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => { try { return eval("state") === "overworld"; } catch (_) { return false; } });
    await page.evaluate(() => eval("save()"));

    const stored = await page.evaluate(() => ({
      primary: JSON.parse(localStorage.getItem("datamon-save-v1")),
      backup: localStorage.getItem("datamon-save-v1-backup"),
      npcTypes: Object.fromEntries(eval("npcs").map(npc => [npc.slug, npc.type])),
    }));
    expect(stored.backup).toBe(raw);
    expect(stored.primary.schemaVersion).toBe(2);
    expect(stored.primary.coffeeUses).toBe(0);
    expect(stored.primary.defeated).toEqual(["ethan-pirso"]);
    expect(stored.primary.questionStats["agent-001"]).toEqual(stored.primary.questionStats["AGENT:0"]);
    expect(stored.primary.progression.badges).toEqual(["agent"]);
    expect(stored.primary.progression.quests).toEqual({
      mentor: "active",
      "claude-code-certification": {
        status: "active",
        objective: "Report to the Certification Console",
        prologueSeen: true,
      },
    });
    expect(stored.primary.progression.activities).toEqual({
      study: 80,
      battleRoom: { currentStreak: 0, bestStreak: 0, wins: 0 },
    });
    expect(stored.primary.progression.npcDomains["ethan-pirso"]).toBe("AGENT");
    expect(stored.primary.progression.npcDomains["invalid-slug"]).toBeUndefined();
    expect(stored.npcTypes["ethan-pirso"]).toBe("AGENT");
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("future save stays byte-for-byte unchanged until explicit reset", async ({ page }) => {
    const raw = JSON.stringify({ schemaVersion: 99, player: "alex-andrianavalontsalama", futureField: { keep: true } });
    await page.addInitScript(value => localStorage.setItem("datamon-save-v1", value), raw);
    const { errors, failedRequests } = await setupPage(page);
    await page.waitForFunction(() => { try { return eval("state") === "title"; } catch (_) { return false; } });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => { try { return eval("state") === "select"; } catch (_) { return false; } });
    await page.keyboard.press("Enter");
    await skipFreshPrologue(page);
    expect(await page.evaluate(() => localStorage.getItem("datamon-save-v1"))).toBe(raw);
    expect(await page.evaluate(() => eval("_writeProtectedSave"))).toBe(true);

    await page.evaluate(() => eval('state = "title"'));
    await page.keyboard.press("r");
    expect(await page.evaluate(() => ({
      primary: localStorage.getItem("datamon-save-v1"),
      backup: localStorage.getItem("datamon-save-v1-backup"),
      protected: eval("_writeProtectedSave"),
    }))).toEqual({ primary: null, backup: null, protected: false });
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("loopback test seam controls RNG and wall clock without corrupting animation time", async ({ page }) => {
    await page.addInitScript(coreJs);
    await page.goto("/");
    await page.waitForFunction(() => {
      try { return eval("state") === "title"; } catch (_) { return false; }
    }, { timeout: 15000 });

    const timing = await page.evaluate(() => new Promise(resolve => {
      const api = window.__DATAMON_TEST__;
      const performanceBefore = performance.now();
      api.seedRNG(42);
      api.mockClock(1000000);
      api.advanceClock(250);
      requestAnimationFrame(timestamp => resolve({
        active: api.isActive(),
        seeded: api.getRNGState().seeded,
        clock: api.getClockState(),
        dateNow: Date.now(),
        performanceBefore,
        animationTimestamp: timestamp,
        frame: eval("frame"),
      }));
    }));

    expect(timing.active).toBe(true);
    expect(timing.seeded).toBe(true);
    expect(timing.clock).toEqual({ mocked: true, timestamp: 1000250 });
    expect(timing.dateNow).toBe(1000250);
    // Browsers may stamp the animation frame just before this task sampled performance.now().
    // They must remain in the same real monotonic clock domain, not be exactly ordered.
    expect(timing.animationTimestamp).toBeGreaterThan(0);
    expect(Math.abs(timing.animationTimestamp - timing.performanceBefore)).toBeLessThan(100);
    expect(timing.frame).toBeGreaterThanOrEqual(0);

    await page.evaluate(() => {
      window.__DATAMON_TEST__.unseedRNG();
      window.__DATAMON_TEST__.unmockClock();
    });
    expect(await page.evaluate(() => window.__DATAMON_TEST__.getRNGState().seeded)).toBe(false);
  });

  test("regular AGENT encounter completes by keyboard and Inspect starts on an enabled choice", async ({ page }) => {
    const { errors, failedRequests } = await setupPage(page);
    const target = await startDirectBattle(page, { type: "AGENT" });
    expect(target.sameObject).toBe(true);
    expect((await inspectState(page)).agentOps).toMatchObject({ phase: "action", boss: false, stability: 3 });

    await playKeyboardQueryTurn(page);
    await acknowledgeAgentMessage(page); // resolve -> feedback
    await acknowledgeAgentMessage(page); // feedback -> fresh turn

    // Momentum 1 enables Inspect. Its cursor must skip any eliminated index.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    let info = await inspectState(page);
    expect(info.agentOps.selectedAction).toBe("inspect");
    expect(info.agentOps.eliminated).toHaveLength(2);
    expect(info.agentOps.eliminated).not.toContain(await currentCorrectIndex(page));
    expect(info.agentOps.eliminated).not.toContain(info.agentOps.choiceCursor);
    await page.keyboard.press(String((await currentCorrectIndex(page)) + 1));
    await acknowledgeAgentMessage(page);
    await acknowledgeAgentMessage(page);

    await playKeyboardQueryTurn(page);
    await acknowledgeAgentMessage(page);
    info = await inspectState(page);
    expect(info.agentOps).toMatchObject({ phase: "victory", stability: 0 });
    expect(await page.evaluate(slug => (0, eval)("defeated").has(slug), target.slug)).toBe(true);
    expect(await page.evaluate(() => Object.entries((0, eval)("questionStats"))
      .filter(([id]) => /^agent-/.test(id))
      .reduce((sum, [, stat]) => sum + stat.correct, 0))).toBe(3);

    await acknowledgeAgentMessage(page);
    expect(await getState(page)).toBe("overworld");
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("final undefeated AGENT traverses all 3 boss phases by keyboard", async ({ page }) => {
    const { errors, failedRequests } = await setupPage(page);
    const target = await startDirectBattle(page, { type: "AGENT", boss: true });
    let info = await inspectState(page);
    expect(info.agentOps).toMatchObject({ boss: true, bossPhase: 0, maxStability: 3 });

    const shifts = [];
    let hits = 0;
    while (hits < 12) {
      await playKeyboardQueryTurn(page);
      hits++;
      await acknowledgeAgentMessage(page);
      info = await inspectState(page);
      if (info.agentOps.phase === "phase-shift") {
        shifts.push([info.agentOps.bossPhase, info.agentOps.stability, info.agentOps.maxStability]);
      }
      if (info.agentOps.phase === "victory") break;
      expect(["feedback", "phase-shift"]).toContain(info.agentOps.phase);
      await acknowledgeAgentMessage(page);
      expect((await inspectState(page)).agentOps.phase).toBe("action");
    }

    expect(hits).toBe(12);
    expect(shifts).toEqual([[1, 4, 4], [2, 5, 5]]);
    info = await inspectState(page);
    expect(info.agentOps).toMatchObject({ phase: "victory", bossPhase: 2, stability: 0 });
    expect(await page.evaluate(slug => (0, eval)("defeated").has(slug), target.slug)).toBe(true);
    expect(await page.evaluate(() => Object.entries((0, eval)("questionStats"))
      .filter(([id]) => /^agent-/.test(id))
      .reduce((sum, [, stat]) => sum + stat.correct, 0))).toBe(12);

    await acknowledgeAgentMessage(page);
    expect(await getState(page)).toBe("overworld");
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("pointer journey selects actions and answers through regular AGENT victory", async ({ page }) => {
    const { errors, failedRequests } = await setupPage(page);
    await startDirectBattle(page, { type: "AGENT" });
    await page.waitForTimeout(50); // allow the first layout pass to populate hit rectangles

    for (let turn = 0; turn < 3; turn++) {
      const actionPoint = await canvasClientPoint(page, "_agentActionRects()[0]");
      await page.mouse.click(actionPoint.x, actionPoint.y);
      expect((await inspectState(page)).agentOps.phase).toBe("choice");

      const correct = await currentCorrectIndex(page);
      const choicePoint = await canvasClientPoint(page, `_agentChoiceRects()[${correct}]`);
      await page.mouse.click(choicePoint.x, choicePoint.y);
      expect((await inspectState(page)).agentOps.phase).toBe("resolve");

      await page.evaluate(() => { (0, eval)("battle").msgAt = -1e9; });
      await page.locator("#game").click({ position: { x: 5, y: 5 } });
      const phase = (await inspectState(page)).agentOps.phase;
      if (phase === "victory") break;
      expect(phase).toBe("feedback");
      await page.evaluate(() => { (0, eval)("battle").msgAt = -1e9; });
      await page.locator("#game").click({ position: { x: 5, y: 5 } });
      expect((await inspectState(page)).agentOps.phase).toBe("action");
    }

    expect((await inspectState(page)).agentOps.phase).toBe("victory");
    await page.evaluate(() => { (0, eval)("battle").msgAt = -1e9; });
    await page.locator("#game").click({ position: { x: 5, y: 5 } });
    expect(await getState(page)).toBe("overworld");
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("Hard timer resets each turn and Guardrail timeout blocks all HP hit presentation", async ({ page }) => {
    const { errors, failedRequests } = await setupPage(page);
    await startDirectBattle(page, { type: "AGENT", difficulty: "hard" });

    const matchup = (await inspectState(page)).battle.attributes;
    expect(matchup.hardTimerMs).toBeGreaterThanOrEqual(25000);
    expect(matchup.hardTimerMs).toBeLessThanOrEqual(35000);

    // Build exactly 2 Momentum with two Query hits, checking START_TURN owns the
    // attribute-derived Caffeine timer reset.
    for (let turn = 0; turn < 2; turn++) {
      expect((await inspectState(page)).battle.timerMs).toBe(matchup.hardTimerMs);
      await playKeyboardQueryTurn(page);
      await acknowledgeAgentMessage(page);
      await page.evaluate(() => { (0, eval)("battle").timerMs = 7; });
      await acknowledgeAgentMessage(page);
      expect((await inspectState(page)).battle.timerMs).toBe(matchup.hardTimerMs);
    }
    expect((await inspectState(page)).agentOps.momentum).toBe(2);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter"); // Patch
    let info = await inspectState(page);
    expect(info.agentOps).toMatchObject({ phase: "choice", selectedAction: "patch", guardrail: 1 });
    const hpBefore = info.player.hp;
    await page.evaluate(() => { (0, eval)("battle").timerMs = 1; });
    await page.waitForFunction(() => window.__DATAMON_TEST__.inspectState().agentOps?.phase === "resolve");

    info = await inspectState(page);
    expect(info.player.hp).toBe(hpBefore);
    expect(info.agentOps.playerHp).toBe(hpBefore);
    expect(info.agentOps.guardrail).toBe(0);
    expect(info.agentOps.outcome).toMatchObject({ correct: false, reason: "timeout", blocked: true });
    expect(info.battle.message).toMatch(/Guardrail blocked/i);
    expect(info.battle.message).not.toContain(String(matchup.wrongDamage));
    expect(info.battle.shake).toBe(0);
    expect(info.battle.attackAt).toBe(0);
    expect(info.battle.damageAt).toBe(0);

    const missesBeforeDuplicate = await page.evaluate(() => Object.entries((0, eval)("questionStats"))
      .filter(([id]) => /^agent-/.test(id))
      .reduce((sum, [, stat]) => sum + stat.wrong, 0));
    await page.evaluate(() => { (0, eval)("timeoutQuestion")(); (0, eval)("timeoutQuestion")(); });
    const missesAfterDuplicate = await page.evaluate(() => Object.entries((0, eval)("questionStats"))
      .filter(([id]) => /^agent-/.test(id))
      .reduce((sum, [, stat]) => sum + stat.wrong, 0));
    expect(missesBeforeDuplicate).toBe(1);
    expect(missesAfterDuplicate).toBe(1);
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("held keyboard and pointer activation cannot cross Agent phases", async ({ page }) => {
    const { errors, failedRequests } = await setupPage(page);
    await startDirectBattle(page, { type: "AGENT" });

    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect((await inspectState(page)).agentOps.phase).toBe("choice");
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true })));

    const answerKey = String((await currentCorrectIndex(page)) + 1);
    await page.evaluate(key => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key, repeat: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    }, answerKey);
    expect((await inspectState(page)).agentOps.phase).toBe("resolve");
    expect(await page.evaluate(() => Object.entries((0, eval)("questionStats"))
      .filter(([id]) => /^agent-/.test(id))
      .reduce((sum, [, stat]) => sum + stat.correct + stat.wrong, 0))).toBe(1);

    await acknowledgeAgentMessage(page);
    await acknowledgeAgentMessage(page);
    await page.waitForTimeout(20);
    await page.evaluate(() => {
      const ge = (0, eval);
      const canvas = document.getElementById("game");
      const bounds = canvas.getBoundingClientRect();
      const toClient = rect => ({
        x: bounds.left + ((rect[0] + rect[2] / 2) / ge("CANVAS_W")) * bounds.width,
        y: bounds.top + ((rect[1] + rect[3] / 2) / ge("CANVAS_H")) * bounds.height,
      });
      const action = toClient(ge("_agentActionRects")()[0]);
      const question = ge("battle.agentOps.question");
      const correct = question.correct != null ? question.correct : question.a;
      const choice = toClient(ge("_agentChoiceRects")()[correct]);
      const pointerDown = point => canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 77, clientX: point.x, clientY: point.y, bubbles: true,
      }));
      pointerDown(action);
      pointerDown(choice); // same held pointer: must be ignored
    });
    expect((await inspectState(page)).agentOps.phase).toBe("choice");
    await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 77, bubbles: true })));

    await page.evaluate(() => {
      const ge = (0, eval);
      const canvas = document.getElementById("game");
      const bounds = canvas.getBoundingClientRect();
      const question = ge("battle.agentOps.question");
      const correct = question.correct != null ? question.correct : question.a;
      const rect = ge("_agentChoiceRects")()[correct];
      const point = {
        x: bounds.left + ((rect[0] + rect[2] / 2) / ge("CANVAS_W")) * bounds.width,
        y: bounds.top + ((rect[1] + rect[3] / 2) / ge("CANVAS_H")) * bounds.height,
      };
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 78, clientX: point.x, clientY: point.y, bubbles: true,
      }));
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 78, bubbles: true }));
    });
    expect((await inspectState(page)).agentOps.phase).toBe("resolve");
    expect(await page.evaluate(() => Object.entries((0, eval)("questionStats"))
      .filter(([id]) => /^agent-/.test(id))
      .reduce((sum, [, stat]) => sum + stat.correct + stat.wrong, 0))).toBe(2);
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("non-AGENT encounter retains classic intro, sendout, question, and feedback", async ({ page }) => {
    const { errors, failedRequests } = await setupPage(page);
    await startDirectBattle(page, { type: "MCP" });
    let info = await inspectState(page);
    expect(info.battle.phase).toBe("intro");
    expect(info.agentOps).toBeUndefined();

    await page.evaluate(() => { (0, eval)("battle").msgAt = -1e9; });
    await page.keyboard.press("Enter");
    expect((await inspectState(page)).battle.phase).toBe("sendout");
    await page.evaluate(() => { (0, eval)("battle").msgAt = -1e9; });
    await page.keyboard.press("Enter");
    expect((await inspectState(page)).battle.phase).toBe("question");
    const correct = await page.evaluate(() => (0, eval)("currentMon().q.a"));
    await page.keyboard.press(String(correct + 1));
    info = await inspectState(page);
    expect(info.battle.phase).toBe("feedback");
    expect(info.agentOps).toBeUndefined();
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});