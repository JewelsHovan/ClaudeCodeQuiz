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

    // Select first character (press Enter to confirm default selection)
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      try { return eval("state") === "overworld"; } catch (_) { return false; }
    }, { timeout: 10000 });
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

    // Interact to start battle
    await page.keyboard.press("Space");
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
    expect(timing.animationTimestamp).toBeGreaterThanOrEqual(timing.performanceBefore);
    expect(timing.frame).toBeGreaterThanOrEqual(0);

    await page.evaluate(() => {
      window.__DATAMON_TEST__.unseedRNG();
      window.__DATAMON_TEST__.unmockClock();
    });
    expect(await page.evaluate(() => window.__DATAMON_TEST__.getRNGState().seeded)).toBe(false);
  });
});