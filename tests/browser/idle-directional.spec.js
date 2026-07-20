// @ts-check
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const coreJs = fs.readFileSync(path.resolve(import.meta.dirname, "../../datamon/core.js"), "utf8");

async function boot(page) {
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "assert"].includes(message.type())) errors.push(message.text()); });
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  page.on("requestfailed", request => errors.push(`${request.url()}: ${request.failure()?.errorText || "failed"}`));
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
  await page.addInitScript(coreJs);
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");
  await page.waitForFunction(() => { try { return (0,eval)("state") === "title" && (0,eval)("officeMapCv") !== null; } catch { return false; } });
  return { errors, requests };
}

async function enterGameplay(page) {
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (0,eval)("state") === "dialogue");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (0,eval)("state") === "overworld");
  await page.waitForTimeout(400);
}

function duplicatePaths(paths) {
  return [...new Set(paths)].filter(path => paths.filter(value => value === path).length > 1);
}

test.describe("directional idle runtime", () => {
  test("stays off the title screen, then lazily loads the manifest, player quartet, and only standing NPC current directions", async ({ page }) => {
    const observed = await boot(page);
    expect(observed.requests.filter(path => path.startsWith("/sprites-idle/"))).toEqual([]);

    await enterGameplay(page);

    const stats = await page.evaluate(() => {
      const ge=(0,eval),standingCurrent=new Set(), seated=new Set();
      for (const npc of ge("npcs")) {
        const current = `/sprites-idle/${npc.slug}/idle_${npc.dir || "down"}.png`;
        if (npc._seated) seated.add(`/sprites-idle/${npc.slug}/`);
        else standingCurrent.add(current);
      }
      const loaded=[...ge("idleImageState").values()].filter(record => record.status === "loaded");
      return {
        playerSlug: ge("player.slug"),
        manifestLoaded: !!ge("idleManifestState.manifest"),
        loadedCount: loaded.length,
        playerLoaded: loaded.filter(record => record.slug === ge("player.slug")).map(record => record.dir).sort(),
        standingCurrent: [...standingCurrent].sort(),
        seatedPrefixes: [...seated].sort(),
      };
    });
    const idleRequests = observed.requests.filter(path => path.startsWith("/sprites-idle/"));
    const manifestRequests = idleRequests.filter(path => path === "/sprites-idle/manifest.json");
    const playerRequests = idleRequests.filter(path => path.startsWith(`/sprites-idle/${stats.playerSlug}/idle_`)).sort();
    const npcRequests = idleRequests.filter(path => path !== "/sprites-idle/manifest.json" && !path.startsWith(`/sprites-idle/${stats.playerSlug}/idle_`));

    expect(stats.manifestLoaded).toBe(true);
    expect(manifestRequests).toEqual(["/sprites-idle/manifest.json"]);
    expect(playerRequests).toEqual([
      `/sprites-idle/${stats.playerSlug}/idle_down.png`,
      `/sprites-idle/${stats.playerSlug}/idle_left.png`,
      `/sprites-idle/${stats.playerSlug}/idle_right.png`,
      `/sprites-idle/${stats.playerSlug}/idle_up.png`,
    ]);
    expect(duplicatePaths(idleRequests)).toEqual([]);
    expect(stats.playerLoaded).toEqual(["down", "left", "right", "up"]);
    expect(stats.loadedCount).toBeLessThanOrEqual(40);
    expect(npcRequests.every(path => stats.standingCurrent.includes(path))).toBe(true);
    expect(stats.seatedPrefixes.every(prefix => idleRequests.every(path => !path.startsWith(prefix)))).toBe(true);
    expect(observed.errors).toEqual([]);
  });

  test("failed idle images fall back to the front-facing trainer without request storms", async ({ page }) => {
    const playerSlug = "alex-andrianavalontsalama";
    const failed = [];
    await page.route(`**/sprites-idle/${playerSlug}/idle_left.png`, async route => {
      failed.push(new URL(route.request().url()).pathname);
      await route.abort("failed");
    });
    const observed = await boot(page);
    await enterGameplay(page);

    const result = await page.evaluate(slug => {
      const ge=(0,eval),ctx=ge("ctx"),original=ctx.drawImage,calls=[],player=ge("player");
      player.slug = slug; player.moving = false; player.running = false; player.seated = null; player.dir = "left";
      for (let i = 0; i < 3; i++) ge("drawCharacter")(320, 240, player.slug, player.dir, true, false, false, false);
      ctx.drawImage = function(...args) { calls.push(args); return original.apply(this, args); };
      try { ge("drawCharacter")(320, 240, player.slug, player.dir, true, false, false, false); }
      finally { ctx.drawImage = original; }
      const record = ge("idleImageState").get(`${slug}:left`);
      const draw = calls.at(-1);
      return { status: record && record.status, draw: draw && [draw[3], draw[4]] };
    }, playerSlug);

    expect(failed).toEqual([`/sprites-idle/${playerSlug}/idle_left.png`]);
    expect(result.status).toBe("failed");
    expect(result.draw).toEqual([56, 56]);
    expect(observed.requests.filter(path => path === `/sprites-idle/${playerSlug}/idle_left.png`)).toHaveLength(1);
    expect(observed.errors.filter(value => value.includes(`/sprites-idle/${playerSlug}/idle_left.png`)).length).toBeGreaterThanOrEqual(1);
  });

  test("loaded directional idles draw for all four directions at DPR1/DPR2 and the resident cache stays bounded", async ({ browser }) => {
    for (const dpr of [1, 2]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: dpr });
      const page = await context.newPage();
      const observed = await boot(page);
      await enterGameplay(page);

      const result = await page.evaluate(async () => {
        const ge=(0,eval),dirs=["down","up","left","right"],player=ge("player"),npc=ge("npcs").find(value => !value._seated);
        await Promise.all(dirs.map(dir => ge("loadIdleDirection")(player.slug, dir, true)));
        await Promise.all(dirs.map(dir => ge("loadIdleDirection")(npc.slug, dir, false)));
        function sample(slug, dir, isPlayer) {
          const ctx=ge("ctx"),original=ctx.drawImage,calls=[];
          ctx.drawImage=function(...args){calls.push(args);};
          try { ge("drawCharacter")(320, 240, slug, dir, isPlayer, false, false, false); }
          finally { ctx.drawImage = original; }
          const draw = calls.at(-1);
          return draw && [draw[3], draw[4]];
        }
        const playerSamples = Object.fromEntries(dirs.map(dir => [dir, sample(player.slug, dir, true)]));
        const npcSamples = Object.fromEntries(dirs.map(dir => [dir, sample(npc.slug, dir, false)]));
        await Promise.all(ge("npcs").filter(value => !value._seated)
          .flatMap(value => dirs.map(dir => ge("loadIdleDirection")(value.slug, dir, false))));
        const loaded=[...ge("idleImageState").values()].filter(record => record.status === "loaded");
        return {
          player: playerSamples,
          npc: npcSamples,
          loadedCount: loaded.length,
          pinnedCount: loaded.filter(record => record.pinned).length,
          playerPinned: dirs.every(dir => {
            const record = ge("idleImageState").get(`${player.slug}:${dir}`);
            return !!record && record.pinned === true;
          }),
        };
      });

      for (const record of [...Object.values(result.player), ...Object.values(result.npc)]) {
        expect(record?.[0]).toBeGreaterThan(12);
        expect(record?.[0]).toBeLessThan(32);
        expect(record?.[1]).toBe(60);
      }
      expect(result.loadedCount).toBeLessThanOrEqual(40);
      expect(result.pinnedCount).toBe(4);
      expect(result.playerPinned).toBe(true);
      expect(observed.errors).toEqual([]);
      await context.close();
    }
  });
});
