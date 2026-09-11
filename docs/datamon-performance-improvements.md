# Datamon performance improvements

All six findings in [the original audit](datamon-performance-audit.md) are addressed. Gameplay rules, accepted art sources, dialogue/accessibility and the audio engine are unchanged. No deployment was performed. Unrelated release-skill work in this shared checkout was left untouched.

## Measured result

Same committed `scripts/perf-audit.mjs`, local Chromium, fresh contexts, DPR2, 1.6 Mbps/150 ms/4× CPU for simulated mobile; 8× CPU for rendering stress. The comparator and historical audit JSON were not edited.

| Measurement | Before | Final | Change |
|---|---:|---:|---:|
| Simulated mobile first title draw (3 runs) | 14.192–14.220 s | **10.320–10.328 s** | **~27% faster** |
| DPR2 settled startup requests, incl. document | 133 | **98** | 35 fewer |
| DPR2 startup response-body bytes | 2,367,953 | **1,608,965** | ~32% less |
| Browsing the other 36 characters | 751 requests / 17,088,020 bytes | **0 requests / 0 bytes** | Prefetch eliminated |
| Movement slugs retained after browsing / confirmation | 37 / 37 | **0 / 1** | Player-only |
| Title p95 frame interval, DPR2/8× CPU | 75.3 ms | **10.1 ms** | ~87% lower |
| Agent battle p95 frame interval, DPR2/8× CPU | 50.8 ms | **17.5 ms** | ~66% lower |
| Agent answer effects p95 frame interval, DPR2/8× CPU | 58.5 ms | **17.9 ms** | ~69% lower |
| Retained DPR2 floor scratch | 13.5 MiB | **0** | Released after baking |
| Covered-world drawing while Question Hub is open | Every frame | **None** | Simulation/rendering frozen |

Normal desktop scene p95 remains under 20 ms. Local first-title drawing is 59–63 ms at DPR1 and 85–87 ms at DPR2; the extra one-time cached-background rasterization does not make local startup meaningfully faster, but removes repeated expensive rendering.

The expanded resource gate sees up to **79.65 MiB** of RGBA-equivalent retained image/canvas data in its representative DPR2 journey, including the atlas, renderer caches, map surfaces, classic presentation, and alpha-scan scratch. It enforces **80 MiB** for that workload, **8 MiB** for renderer caches, the existing **28 MiB** world-map budget (now including floor scratch), and the separate existing 4 MiB audio bound. These estimates are neither RSS/GPU residency nor a universal memory ceiling for every possible play history. The original audit probe's private inventory omits newly introduced atlas/background caches, so its raw memory total is **not** used to claim a total-memory reduction.

## Implementation and regression coverage

1. **Truthful startup measurement.** `state` starts as `loading`; explicit boot-ready, first-title-draw and first-playable-draw milestones are available through `DatamonPerformance`. The cold gate waits for drawing, observes runtime/network failures through resource settlement, and includes document bytes. It tests DPR1, DPR2, a returning save and simulated slow mobile: 12 runs, not just three unthrottled snapshots. The existing local 2.5 s limit remains; the new slow-network limit is 11 s. Request/byte ceilings were tightened to 110/1,750,000, not raised.
2. **Smaller initial loading path.** A deterministic 782,932-byte lossless WebP atlas replaces 37 eager trainer PNGs for the title, selection and small world sprites. It preserves source resolution, alpha and visible RGB; only RGB of fully transparent pixels is canonicalized. It includes validated alpha bounds so trainers retain their exact framing even before their optional original PNG arrives. Original trainer PNGs remain available lazily for gameplay and source-art checks. Generic boot image/manifest dependencies have bounded timeouts and fallback behavior.
3. **Bounded movement loading.** Selection uses the atlas and requests no movement art. Confirmation/resume loads exactly the chosen player. Changing the movement subject aborts obsolete requests and removes old frames, pilot art, metadata, promises and derived mini canvases. Generation identity checks prevent late callbacks from refilling evicted stores. Completed promises retain no image-array results. The accepted four-frame fallback remains available alongside the selected pilot's authored animation.
4. **Cached static rendering.** The title's office/veil/scanlines/dossier and Agent's immutable wall/table are rasterized once at backing resolution. Title save/map changes, optional Agent layer changes and backing-size changes invalidate correctly; leaving those scenes releases their cache. Actors, questions, status, input feedback, boss phases and effects stay live. The world gate now includes animated title, Agent battle and answer effects at DPR1/DPR2 and 1×/4×/8× CPU; frame budgets remain 20 ms normal and 40 ms stressed.
5. **Complete resource accounting.** The floor surface is discarded immediately after the office map is baked. Read-only diagnostics inventory retained image/canvas families, including atlas, mini caches, portraits, world art, presentation buffers and alpha-scan scratch, with audio reported separately. Tests measure baked floor detail rather than requiring a persistent scratch allocation.
6. **No redundant covered-world rendering.** While the native Question Hub modal is open, the simulation clock and canvas drawing pause; the independent audio scheduler retains its focused music/ambience behavior. Frame timestamps still advance internally so closing the modal cannot produce catch-up movement. Dock visibility is assigned only on change. Input, focus and gameplay resume normally.

## Correctness and visual verification

`just check` passed end to end:

- Content and syntax checks; **60 Python tests** and deterministic asset validators, including the new atlas `--check`.
- **380 unit tests** in the shared checkout: 362 Datamon tests plus 18 independently added release-skill tests, whose files are not part of this delivery.
- **111 Chromium browser tests**, including 11 new performance regressions: delayed and stalled boot assets; missing-atlas fallback; zero movement prefetch; stale-load eviction; saved-player resume; released scratch; modal clock/draw/mutation checks; DPR1/DPR2 cache parity and invalidation; roster color/alpha/bounds parity.
- Cached title and Agent background pixels match direct painting **exactly** at both DPRs. The lossless atlas round-trip is byte-exact for normalized source RGBA. Browser rendered comparison allows at most one premultiplied color byte on translucent edges because PNG/WebP decoders round differently; alpha and bounds remain exact. All 37 trainers and every semantic battle pose retain their framing.
- Full locomotion evaluation, including all three movement profiles and legacy/pilot walk/run art cases, passes unchanged scoring thresholds. Its fixture now chooses the evaluated consultant *before* confirmation rather than replacing another live player mid-load; the movement workload and scores are unchanged.
- Deterministic packaged artifact and verifier; **12 cold/profile runs**; **four expanded world/CPU configurations**; final unchanged nine-cold-run/two-runtime-configuration audit.

Two test-only adaptations preserve the actual contracts: original-art checks explicitly load lazy source PNGs; the audio hide test samples its baseline and dispatches `pagehide` in one browser task, eliminating a race between two CDP round trips without relaxing cancellation assertions.

## Bounded experiment ledger

Contract established before runtime changes: improve simulated cold-title time by at least 20%, eliminate selection movement traffic, retain one movement slug, preserve normal/stress frame budgets and visual/gameplay behavior. Up to four candidate batches, ten minutes per measurement command and 60 minutes of comparison runs; no deployment/paid generation. Timing improvements must exceed 10% or show exact resource-count reduction; an invalid functional trial is not promotable.

- **Baseline:** original audit plus its unchanged delivery rerun; no runtime diff. Historical evidence remains in `datamon-performance-audit.json`.
- **Candidate 1, provisional/invalid:** initial loader/cache/floor/modal changes showed ~9.9 s mobile startup and ~9/17 ms stressed title/Agent intervals. Functional review exposed old eager-loading fixtures and missing atlas-based trainer framing before lazy PNG arrival; full validation was not yet green. Not promoted.
- **Candidate 2, kept:** added source-derived atlas alpha bounds, adapted fixtures to intentional lazy loading, covered stale loads/fallbacks/cache invalidation, included alpha-scan storage, and repaired the atomic audio-test observation. Full checks pass. Final repeat observes 10.32 s mobile startup, zero browse traffic and ~10/18 ms stressed title/Agent p95. No runtime candidate was kept solely by changing its evaluator or increasing an existing budget.

**Experiment settlement: complete.** All six requested improvements are implemented and verified; no renderer rewrite, gameplay simplification or artwork regeneration was needed.

## Delivery revalidation

After the initial delivery-runtime interruption, the parent re-audited all six requirements against the current runtime, atlas generator, browser regressions and budget scripts, and reran `just check` end to end. All 60 Python tests, 380 shared-checkout unit tests, 111 Chromium tests, locomotion cases, 12 startup runs and four world configurations passed again. The payload remains byte-identical to the measured candidate: SHA-256 `07f00968607a84f0429eed6f6f85a15a7c3e19de5986cc040daa54c162717def`, 1,388 files / 33,856,093 bytes. Consequently the unchanged-comparator results above still describe the current runtime; the new gate runs are recorded separately in the results JSON.

The independent reviewer timed out without a verdict; it is not counted as verification. The parent completed the source/evidence review directly. No deployment, shell Git bypass, or adoption of unrelated release-skill files is part of this delivery.

## Reproduce

```sh
just check
node scripts/perf-audit.mjs
python3 datamon/tools/gen_roster_atlas.py --check
```

Run performance sampling without competing browser suites; Playwright clears `test-results/`, so collect comparison evidence after browser tests. Regenerate the atlas with `python3 datamon/tools/gen_roster_atlas.py` whenever accepted trainer sources change; packaging verifies source hashes and the packed manifest. The generator requires Pillow with WebP support (the verified environment uses Pillow 12.3.0).

Durable results: [`datamon-performance-improvements.json`](datamon-performance-improvements.json). Full local outputs: `test-results/performance-audit.json`, `test-results/performance.json`, `test-results/world-performance.json`, and `test-results/locomotion-evaluation/`.

These are local, headless-Chromium results on the audit's M4 Max host, not production RUM or a real-phone/GPU benchmark. Title timing is draw-callback completion, not compositor presentation. CDN compression/caching and real-device verification remain operational follow-ups, not claims made by this change.
