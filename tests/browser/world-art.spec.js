// @ts-check
// Ticket #044 pre-G1 runtime contracts against the packaged legacy-fallback artifact.
import { test, expect } from "@playwright/test";

async function waitForTitle(page) {
  await page.goto("/");
  await page.waitForFunction(() => {
    try { return (0, eval)("state") === "title" && (0, eval)("officeMapCv") !== null; }
    catch (_) { return false; }
  });
}

async function pageErrors(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || message.type() === "assert") errors.push(message.text());
  });
  return errors;
}

test.describe("HD world-art accepted pilot contracts", () => {
  test("DPR1/fractional/DPR2 caches keep logical geometry and Library stays cold", async ({ browser }) => {
    const acceptedIds = [
      "hd-brick-red", "hd-brick-white", "hd-window-industrial", "hd-hardwood-detail",
      "hd-agent-wing-lighting", "hd-starry-painting", "hd-tv", "hd-kallax", "hd-couch",
      "hd-arc-lamp", "hd-rug", "hd-radiator", "hd-collaboration-table",
      "hd-amb-windows", "hd-amb-tv", "hd-amb-lamp", "hd-amb-table",
      "hd-architecture-office-wall", "hd-architecture-library-portal", "hd-architecture-battle-portal",
    ].sort();
    for (const dpr of [1, 1.5, 2]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 960 },
        deviceScaleFactor: dpr,
      });
      const page = await context.newPage();
      const requests = [];
      const errors = await pageErrors(page);
      page.on("request", request => requests.push(new URL(request.url()).pathname));
      await waitForTitle(page);
      const result = await page.evaluate(() => {
        const ge = (0, eval);
        const office = ge("officeMapCv");
        const canvas = document.getElementById("game");
        return {
          mapScale: ge("MAP_DETAIL_SCALE"),
          cacheScale: office.detailScale,
          officeWidth: office.width,
          officeHeight: office.height,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          libraryCold: ge("libraryMapCv") === null,
          booksCold: ge("loadedBooks").length,
          pairsCold: ge("loadedPairs").length,
          clozeCold: ge("loadedCloze").length,
          diagramsCold: ge("loadedDiagrams").length,
          camera: window.DatamonWorldArt.cameraSourceRect(5.25, 3.5, 32, 800, 608, 2),
          budget: window.DatamonWorldArt.cacheMetrics(36, 24, 32, 2, 2).totalMiB,
          diagnostics: window.DatamonWorldArt.getDiagnostics(),
          sharedMaterialZones: ["brick-red", "brick-white", "window-h"].map(slug => {
            const entry = window.DatamonWorldArt.findEntry(slug, "tile", "office");
            return entry && entry.zone || null;
          }),
          sharedRadiatorZone: (window.DatamonWorldArt.findEntry("radiator", "prop", "office") || {}).zone || null,
          agentLightPlacement: (window.DatamonWorldArt.findEntry("agent-wing-lighting", "overlay", "office") || {}).placement,
        };
      });
      expect(result.mapScale).toBe(dpr);
      expect(result.cacheScale).toBe(dpr);
      expect(result.officeWidth).toBe(Math.round(1152 * dpr));
      expect(result.officeHeight).toBe(Math.round(768 * dpr));
      expect(result.canvasWidth).toBe(Math.round(800 * dpr));
      expect(result.canvasHeight).toBe(Math.round(608 * dpr));
      expect(result.libraryCold).toBe(true);
      expect([result.booksCold, result.pairsCold, result.clozeCold, result.diagramsCold]).toEqual([0, 0, 0, 0]);
      expect(result.camera).toEqual({ sx: 336, sy: 224, sw: 1600, sh: 1216 });
      expect(result.budget).toBeLessThanOrEqual(32);
      const expectedIds = dpr >= 2 ? acceptedIds : [];
      expect(result.diagnostics.loadedAssetIds.slice().sort()).toEqual(expectedIds);
      expect(result.diagnostics.ambientInstances).toBe(dpr >= 2 ? 9 : 5);
      expect(result.sharedMaterialZones).toEqual([null, null, null]);
      expect(result.sharedRadiatorZone).toBe(null);
      expect(result.agentLightPlacement).toEqual({ col: 1, row: 1, layer: "back" });
      const environmentRequests = requests.filter(path => path.startsWith("/environment/accepted/") && path.endsWith(".png"));
      expect(environmentRequests).toHaveLength(expectedIds.length);
      expect(new Set(environmentRequests).size).toBe(environmentRequests.length);
      expect(requests.some(path => path.startsWith("/headshots/"))).toBe(false);
      expect(requests.filter(path => path === "/library/assets/manifest.json")).toHaveLength(1);
      expect(requests.filter(path => path.startsWith("/library/assets/") && path.endsWith(".png")))
        .toEqual(["/library/assets/lib-door.png"]);
      expect(requests.some(path => /^\/library\/(books|pairs|cloze|diagrams)\.json$/.test(path))).toBe(false);

      // At DPR2, visual-detail furniture joins the character depth-sort list. Rendering
      // and a quick movement tap must not treat those presentation entries as NPCs.
      if (dpr === 2) {
        await page.keyboard.press("Enter");
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => {
          try { return (0, eval)("state") === "overworld"; } catch (_) { return false; }
        });
        const startY = await page.evaluate(() => (0, eval)("player").y);
        await page.keyboard.press("w");
        await page.waitForFunction(expectedY => {
          try {
            const player = (0, eval)("player");
            return !player.moving && player.y === expectedY;
          } catch (_) { return false; }
        }, startY - 1);
      }
      expect(errors).toEqual([]);
      await context.close();
    }
  });

  test("one Library interaction deduplicates loads, builds once, and commits one warp", async ({ page }) => {
    const requests = [];
    const errors = await pageErrors(page);
    page.on("request", request => requests.push(new URL(request.url()).pathname));
    await waitForTitle(page);

    // Repeated input while pending must reuse one Promise and cannot require a second action.
    await page.evaluate(() => {
      const ge = (0, eval);
      ge("enterLibrary")();
      window.__firstLibraryPromise = ge("libraryLoadPromise");
      ge("enterLibrary")();
      window.__sameLibraryPromise = window.__firstLibraryPromise === ge("libraryLoadPromise");
    });
    await page.waitForFunction(() => (0, eval)("currentMap") === "library");
    const first = await page.evaluate(() => {
      const ge = (0, eval);
      window.__firstLibraryCache = ge("libraryMapCv");
      return {
        samePromise: window.__sameLibraryPromise,
        currentMap: ge("currentMap"),
        cacheBuilt: !!ge("libraryMapCv"),
        books: ge("loadedBooks").length,
        pairs: ge("loadedPairs").length,
        cloze: ge("loadedCloze").length,
        diagrams: ge("loadedDiagrams").length,
      };
    });
    expect(first.samePromise).toBe(true);
    expect(first.currentMap).toBe("library");
    expect(first.cacheBuilt).toBe(true);
    expect(first.books).toBeGreaterThan(0);
    expect(first.pairs).toBeGreaterThan(0);
    expect(first.cloze).toBeGreaterThan(0);
    expect(first.diagrams).toBeGreaterThan(0);

    const requestCount = requests.length;
    const reused = await page.evaluate(() => {
      const ge = (0, eval);
      ge("returnToOffice")();
      ge("enterLibrary")(); // synchronously reuse built Library
      return ge("currentMap") === "library" && ge("libraryMapCv") === window.__firstLibraryCache;
    });
    await page.waitForTimeout(50);
    expect(reused).toBe(true);
    expect(requests.length).toBe(requestCount);
    const libraryCounts = new Map();
    for (const path of requests.filter(path => path.startsWith("/library/"))) {
      libraryCounts.set(path, (libraryCounts.get(path) || 0) + 1);
    }
    for (const [path, count] of libraryCounts) expect(count, path).toBe(1);
    expect(errors).toEqual([]);
  });

  test("accepted collision, placement, reachability, and DPR2 physical detail remain deterministic", async ({ page }) => {
    await waitForTitle(page);
    const result = await page.evaluate(async () => {
      const ge = (0, eval);
      const digest = async text => {
        const bytes = new TextEncoder().encode(text);
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
      };
      const reachable = (grid, start) => {
        const solid = ge("SOLID");
        const walkable = [];
        for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
          if (!solid.has(grid[y][x])) walkable.push(`${x},${y}`);
        }
        const seen = new Set([`${start[0]},${start[1]}`]);
        const queue = [[start[0], start[1]]];
        while (queue.length) {
          const [x, y] = queue.shift();
          for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
            const key = `${nx},${ny}`;
            if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[ny].length ||
                solid.has(grid[ny][nx]) || seen.has(key)) continue;
            seen.add(key); queue.push([nx, ny]);
          }
        }
        return { walkable: walkable.length, reached: seen.size };
      };

      // Synthetic physical stripes: a DPR2 detail cache must retain all 63 transitions.
      const source = document.createElement("canvas"); source.width = source.height = 64;
      const sc = source.getContext("2d");
      for (let x = 0; x < 64; x++) {
        sc.fillStyle = x % 2 ? "#45d7e8" : "#081426";
        sc.fillRect(x, 0, 1, 64);
      }
      const cache = document.createElement("canvas"); cache.width = cache.height = 64;
      const cc = cache.getContext("2d", { willReadFrequently: true });
      cc.imageSmoothingEnabled = false; cc.scale(2, 2); cc.drawImage(source, 0, 0, 32, 32);
      const row = cc.getImageData(0, 20, 64, 1).data;
      let transitions = 0;
      for (let x = 1; x < 64; x++) if (row[x * 4] !== row[(x - 1) * 4]) transitions++;

      const office = ge("OFFICE_MAP"), library = ge("LIBRARY_MAP"), battleRoom = ge("BATTLE_ROOM_MAP");
      return {
        officeHash: await digest(office.map(row => row.join("")).join("\n")),
        libraryHash: await digest(library.map(row => row.join("")).join("\n")),
        battleRoomHash: await digest(battleRoom.map(row => row.join("")).join("\n")),
        placementHash: await digest(JSON.stringify(ge("PROP_PLACEMENTS"))),
        libraryPlacementHash: await digest(JSON.stringify([
          ge("LIBRARY_PROP_PLACEMENTS"), ge("LIBRARY_DECOR"),
        ])),
        officeReach: reachable(office, ge("OFFICE_ENTRY")),
        libraryReach: reachable(library, ge("LIBRARY_ENTRY")),
        battleRoomReach: reachable(battleRoom, ge("BATTLE_ROOM_ENTRY")),
        placementCount: ge("PROP_PLACEMENTS").length,
        transitions,
      };
    });
    expect(result.officeHash).toBe("a07a524ff09faa749dc8936615efd2baf0f8c79f0fb7c1a1584d9a037bb29e41");
    expect(result.libraryHash).toBe("83c10ea86e53fe0a06f68f9373b40350737634ab87c41b741c8b139dc3e4908a");
    expect(result.battleRoomHash).toBe("5cce5ea29a100fdd42289607cf2b12abee9cafc37caaab62442991937eadced7");
    expect(result.placementHash).toBe("c875a85f8c8b30be76cc9b25b2762261ce5928685d6df13dd2500ab9d2148444");
    expect(result.libraryPlacementHash).toBe("10fceb41c203e7e5ec32fbb6f8e77c2b15e5be410ecc2bb7aa9ac9dd175f9651");
    expect(result.officeReach).toEqual({ walkable: 682, reached: 682 });
    expect(result.libraryReach).toEqual({ walkable: 710, reached: 710 });
    expect(result.battleRoomReach).toEqual({ walkable: 748, reached: 748 });
    expect(result.placementCount).toBe(40);
    expect(result.transitions).toBe(63);
  });

  test("live reduced-motion changes pin ambient loops to frame zero and diagnostics stay bounded", async ({ page }) => {
    await waitForTitle(page);
    await page.evaluate(() => {
      window.DatamonWorldArt.setAmbientEntries([{
        id: "test-loop", animation: { frames: 8, fps: 8, layout: "horizontal" },
      }]);
    });
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.DatamonWorldArt.getAmbientFrame("test-loop"))).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.DatamonWorldArt.getAmbientPhase(1000))).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => window.DatamonWorldArt.isReducedMotion());
    expect(await page.evaluate(() => window.DatamonWorldArt.getAmbientFrame("test-loop"))).toBe(0);
    expect(await page.evaluate(() => window.DatamonWorldArt.getAmbientPhase(1000))).toBe(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction(() => !window.DatamonWorldArt.isReducedMotion());
    expect(await page.evaluate(() => window.DatamonWorldArt.getAmbientFrame("test-loop"))).toBe(0);
    const diagnostics = await page.evaluate(() => {
      for (let i = 0; i < 200; i++) window.DatamonWorldArt.recordFrameSample(i / 10);
      return window.DatamonWorldArt.getDiagnostics();
    });
    expect(diagnostics.samples).toBe(120);
    expect(diagnostics.ambientInstances).toBeLessThanOrEqual(64);
    expect(diagnostics.particles).toBe(0);
  });
});
