# Datamon performance audit

**Audited:** 2026-09-05 · commit `5af9fa9` · Chromium `149.0.7827.55`

## Verdict

**Fast on this desktop, but the green performance checks hide meaningful loading, memory, and slow-device rendering problems.** Prioritize truthful startup measurement, bounded character prefetch, and the title's critical asset path before micro-optimizing gameplay JavaScript.

No gameplay code, assets, performance budgets, or deployment were changed. This audit adds a repeatable browser probe and this report/evidence.

## Scope and method

- Rebuilt and verified the exact deterministic artifact: **1,386 files, 33,052,793 bytes**; SHA-256 `a062e1fcb42c799ae44790901e63e280d5d2c6cb8a6fa9132acbfdda1b3a5be6`. This is the full package, **not** the initial download.
- Apple M4 Max, 64 GB, macOS 26.5; headless Chromium; local Python HTTP server. Each loading run used a fresh browser context with no saved game.
- Nine cold runs: three each at DPR1 desktop, DPR2 desktop, and simulated mobile (390×844 viewport, DPR2, 4× CPU slowdown, 1.6 Mbps download, 150 ms configured latency).
- Existing four-configuration world benchmark; additional 3-second steady-state samples, a ~6-second keyboard movement sample, character browsing, room switching, Question Hub, classic battle, and animated Agent battle/answer feedback.
- Separate DPR2 title/Agent confirmation samples at 4× and twice at 8× CPU slowdown, without the audit's game-callback wrapper. A 2-second Agent trace distinguishes script work from deferred rendering work.
- Memory figures below are **RGBA-equivalent estimates** (`width × height × 4`) for explicitly retained image/canvas objects after forced JS GC. They are not process RSS, actual GPU residency, or proof of allocation failure. Audio/closed-module arena storage is reported separately.

**Limits:** no production/CDN measurement, HTTP compression, HTTP/2, real phone, Safari/Firefox, long-duration soak, or exhaustive minigame profiling. CPU slowdown does not emulate a phone GPU. First-title timing measures completion of the initial game draw callback, **not** pixels presented by the compositor; it is a lower bound on visible readiness. Browser first contentful paint can be the loading message, so it is not a substitute.

## Results at a glance

### Cold startup

| Profile | First game draw, 3 runs | Settled requests, incl. document | Response bodies, incl. document |
|---|---:|---:|---:|
| DPR1, local/unthrottled | 63–68 ms | 113 | 2.347 MB |
| DPR2, local/unthrottled | 77–81 ms | 133 | 2.368 MB |
| Simulated mobile/slow network | **14.192–14.220 s** | 133 | 2.368 MB |

MB means decimal bytes; MiB below means binary bytes. The local server does not compress JavaScript. CDN compression and HTTP/2 could improve loading; these are not claims about deployed latency.

### Runtime frame pacing

P95 is the 95th-percentile interval between animation-frame callbacks, **not** JavaScript draw duration. This host schedules roughly 120 Hz when unconstrained.

| Scene | DPR2 normal | DPR2, 8× CPU |
|---|---:|---:|
| Title | 8.9 ms | **75.3 ms** |
| Character selection | 8.9 ms | 9.2 ms |
| Office, stationary | 9.0 ms | 17.4 ms |
| Office, keyboard movement | 9.0 ms | 16.5 ms |
| Question Hub open | 9.3 ms | 16.7 ms |
| Library | 9.3 ms | 17.4 ms |
| Classic MCP battle | 9.3 ms | 15.9 ms |
| Agent battle | 9.3 ms | **50.8 ms** |
| Agent answer effects | 9.2 ms | **58.5 ms** |

The independently repeated title/Agent samples confirm the distinction: at 4× CPU, p95 **41.9/25.9 ms**; at 8×, **75.1/50.5 ms** and **75.9/50.8 ms**. The classic stress sample also had a 99.7 ms maximum gap despite its acceptable p95. Averages or callback-only timings would miss these pauses.

## Prioritized findings

### 1. P1 — The cold-title gate does not measure a rendered title

**Evidence:** `scripts/perf-baseline.mjs:62–93`; `datamon/game.js:904`, `7823–7869`.

`state` is initialized to `"title"` synchronously. The performance script waits for that variable, snapshots requests/response headers, then closes the context. The game loop only starts after the boot asset `Promise.all` and office-map construction finish.

The existing gate reports **31–37 ms**, while the instrumented first draw is **63–81 ms** locally. In the simulated mobile runs, `state` is observable around **3.91 s**, but drawing does not begin until **14.21 s**. The existing test uses only unthrottled DPR1; it also omits runtime errors and stops collecting network failures early. Its byte total is received `Content-Length` headers at a race-dependent cutoff, not completed transfer volume.

**Recommendation:** expose explicit boot-ready/first-title-drawn milestones. Separately record completed initial resources and navigation bytes; observe errors through readiness and a bounded settle window. Add DPR2 and a defined slow-network profile. Include returning saves, since saved-player animation prewarming deliberately changes the cold resource contract. Keep initial title, selected-character readiness, and first playable world as separate metrics.

**Verification target:** a delayed office asset must keep the readiness gate pending; DPR2 request/byte accounting must include the HD assets. Report actual network-profile results rather than widening the existing budget.

### 2. P1 — Eager roster assets dominate the title's loading path

**Evidence:** `datamon/game.js:380–396`, `7839–7869`; `datamon/index.html:129–145`.

All **37 full-size trainer sprites** must finish loading before the loop begins. They account for **1,562,288 bytes: 66% of settled DPR2 startup body bytes**. The 17 script responses add **681,849 bytes** uncompressed. Although HD art adds 20 DPR2 requests, its image bytes total only about 21 KB: it is not the main byte bottleneck.

At 1.6 Mbps, roster image bytes alone represent about **7.8 seconds of bandwidth** before considering contention and latency. The complete observed first draw takes 14.2 seconds. The generic image/fetch boot path also has no application-level timeout: graceful `onerror` handling does not bound a stalled response.

**Recommendation:** make the first screen independent of full-resolution roster completion. Use a compact title/selection thumbnail atlas or prioritized thumbnails, preload only likely visible/selected content, and progressively fill the rest. Evaluate lossless WebP/PNG optimization against the accepted pixel-art appearance. Verify CDN Brotli/gzip and caching before adding a bundler. Give nonessential boot assets bounded fallback behavior.

**Verification target:** record first-title and first-playable timings on the same slow-network profile, plus image-quality comparisons and timeout/fallback checks. Do not move an equally long unexplained stall to the next screen.

### 3. P1 — Browsing characters retains every character's movement assets

**Evidence:** `datamon/game.js:400–476`, `5633–5639`, `5804–5876`.

Every highlight change calls `loadWalkAnim()`. Neither `walkAnim`, `walkAnimLoads`, nor `locomotionPilot` has selection-lifecycle eviction. Pilot characters load four accepted walk frames per direction **and** 68 pilot idle/walk/run images. The selection showcase itself draws `sprites[...]`, not these movement frames.

Reproduction through the real keyboard selection path:

- Opening selection preloads the first character.
- Browsing the remaining 36 adds **751 requests and 17,088,020 response-body bytes** (750 movement-related requests plus one audio asset).
- All **37 walk slugs** remain retained after GC and into gameplay: **592 accepted walk images + 204 pilot images**, approximately **77.95 MiB** RGBA-equivalent source data.
- Explicit retained image/canvas estimates grow from **57.55 MiB** for the initial selection to **127.01 MiB** after browsing. They remain around **146.46 MiB** after visiting rooms/battles, excluding audio and classic arena storage.

This is bounded by the roster, not an infinite leak, but violates the intended practical advantage of player-only lazy loading. The zero-walk-assets title test cannot detect it.

**Recommendation:** preload on confirmation, or debounce selection prefetch and retain only the selected player plus a small explicit LRU. Clear obsolete decoded frames, derived minis, metadata, and resolved promise references together; discard stale in-flight completions safely. Reconsider loading both pilot and accepted sets eagerly for the same selection while preserving a working fallback.

**Verification target:** sweep the full roster, confirm a character, then assert a defined residency cap and repeat the sweep/confirmation after GC. Check movement fallback, rapid switching, pilot characters, and saved-game resume.

### 4. P2 — Deferred canvas rendering, not the measured JS callback, limits title/Agent stress performance

**Evidence:** `datamon/game.js:5515–5611`, `7734–7810`; `datamon/agent-arena.js:1059–1101`; `tests/browser/agent-arena.spec.js:350–444`.

Under 8× CPU slowdown, title/Agent cadence falls to roughly **15/20 FPS by median intervals**, while measured game-callback p95 remains only **2.5/2.6 ms**. A separate Agent trace records **1,846.9 ms across 41 `Commit` events** in approximately two seconds, versus **66.3 ms across 42 `FireAnimationFrame` events**. These are inclusive trace totals, not additive CPU categories.

The title and Agent scene redraw extensive static content every frame. The Agent diagnostic times only its draw function, excluding deferred browser rendering. Its current deterministic screenshot/performance test also uses reduced motion and no CPU slowdown. The world performance script exercises classic battle, not Agent battle or the title's steady-state loop.

**Recommendation:** extend the frame-pacing gate to animated title/Agent scenes at 4×/8×. Trace on real devices before choosing a renderer rewrite. Investigate cached static title/arena layers, state-keyed question/HUD layers, avoiding redundant full-surface compositing, and limiting decorative redraw cadence. Preserve dynamic effects and accessibility; a worker/OffscreenCanvas migration is not yet justified by this audit.

**Verification target:** measure full-frame intervals and long tasks alongside callback cost, both with normal and reduced motion. Meet an explicit frame target without hiding failures behind reduced-motion-only tests. Confirm on hardware-accelerated desktop and a real phone because headless deferred-rendering behavior may differ.

### 5. P2 — The 28 MiB map-cache gate omits a persistent map-sized floor texture

**Evidence:** `scripts/perf-worlds.mjs:200–217`; `datamon/game.js:6020–6098`, `3927–4003`.

The gate sums only `officeMapCv`, `libraryMapCv`, and `battleRoomMapCv`. At DPR2 it correctly sees at most two maps (**27 MiB**), but `floorTex` separately retains another **13.5 MiB**. Those three map-sized surfaces therefore represent **40.5 MiB**, before the **7.42 MiB** main canvas, sprites, mini caches, portraits, or audio.

Even without browsing the roster, this audit's single-player journey reaches approximately **76–77 MiB** in explicitly referenced image/canvas estimates. This is not a violation of the narrowly defined map budget; it shows that budget is not a total-memory ceiling.

**Recommendation:** inventory all retained canvas/image families under a broader resource budget. Release the floor texture after baking if rebuilding it on subsequent destination changes is acceptable, or explicitly budget its persistence. Keep image-equivalent estimates separate from JS heap, audio decoded bytes, and measured browser/GPU memory.

**Verification target:** inventory title, selection, both destination maps, battle, and repeated room cycles. Check plateauing residency, not only a two-map count.

### 6. P3 — Full world redraw continues behind the Question Hub

**Evidence:** `datamon/game.js:7734–7810`; `datamon/question-hub.js:267–273`.

The modal pauses movement but leaves the game loop drawing the obscured overworld. In a 3-second unthrottled sample, **360 game callbacks** ran behind the open hub. The dock's `hidden` property is also assigned on every frame, even when unchanged. No visible responsiveness failure occurred; this is an avoidable rendering/battery cost while users read.

**Recommendation:** freeze/cache the covered scene or reduce its update cadence while the DOM modal is open. Synchronize dock visibility on transitions instead of every frame. Preserve music behavior and do not accidentally advance paused gameplay timers.

## What is already working

- `npm run test:performance` **passes**: deterministic packaging, three current cold-gate runs, and all four world/DPR/CPU configurations.
- Normal desktop gameplay, movement, classic battles, and Agent effects are smooth in these samples. Their game-callback p95 is roughly **0.2–0.3 ms**; optimizing tiny JS allocations is not the first priority.
- Office is built once at boot; destination maps are lazy. Explicit map-cache count stays at two. Three extra Library/Battle Room cycles show no growth in the probe's explicit retained-image/canvas inventory.
- Classic presentation stays within its **8 MiB** decoded budget in the existing matrix; measured first authored arena drawing is **5.5–85.8 ms** locally.
- No request or page errors occurred in the audit journeys. Audio stays at one context, and sampled decoded audio remains below the 4 MiB limit. The targeted browser checks verify voice limits, mute, unavailable audio, and visibility cleanup.
- **362 unit tests and 26 targeted Chromium tests passed.** This was not a full `just check` run.

## Suggested implementation order

1. Repair readiness/network/frame-pacing observability so future changes cannot win by ending measurement early.
2. Bound character movement prefetch/residency; this has a clear 17 MB browsing regression reproduction.
3. Shorten the initial title asset path and verify deployed compression/caching.
4. Cache/limit expensive title and Agent scene redraws, guided by full rendering traces.
5. Expand the memory budget and remove unnecessary retained surfaces/modal redraws.

## Reproduce and evidence

```sh
npm run test:performance
npm test
npx playwright test tests/browser/agent-arena.spec.js tests/browser/audio.spec.js \
  tests/browser/music.spec.js tests/browser/question-hub.spec.js --project=chromium
node scripts/perf-audit.mjs
```

Run browser tests **before** collecting audit evidence: Playwright can clear `test-results/`. Performance sampling should run without other browser suites competing for resources. The audit command is observational, not a new threshold gate; it exits nonzero for loading/runtime errors, not for the performance findings above. It uses isolated browser saves and closes its server/browser on exit.

- Repeatable probe: [`scripts/perf-audit.mjs`](../scripts/perf-audit.mjs).
- Durable summarized measurements, including independent confirmations: [`datamon-performance-audit.json`](datamon-performance-audit.json).
- Full local outputs: `test-results/performance-audit.json`, `test-results/performance.json`, `test-results/world-performance.json`.
- Additional local confirmation/trace: `test-results/datamon-audit-confirm.cjs`, `test-results/datamon-audit-confirm.json`, `test-results/datamon-agent-cpu8-trace.json`. These are ignored session artifacts; headline measurements are retained in the durable JSON.
