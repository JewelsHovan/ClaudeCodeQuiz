# Vertical walking repair (#060)

## Finding

The renderer was correctly playing malformed source poses. In affected legacy four-frame
cycles, passing frames turned sideways or crossed the legs, frequently repeating the same
lead leg twice. This made straight north/south travel look like diagonal stepping.

The audit covered all 37 legacy characters and the three active eight-frame walk/run pilots.
Only the following **21 views across 15 characters** were changed:

| Character | Down | Up |
| --- | --- | --- |
| Duc An Nguyen | repaired | repaired |
| Emile Moffatt | repaired | repaired |
| Ethan Pirso | unchanged | repaired |
| Guillaume Delmas Frenette | unchanged | repaired |
| Guillaume Pregent | repaired | unchanged |
| Jerry Zhu | unchanged | repaired |
| Jonah Lee | unchanged | repaired |
| Jonathan Kim | repaired | repaired |
| Logan Labossiere | repaired | repaired |
| Pentcho Tchomakov | unchanged | repaired |
| Saransh Padhy | unchanged | repaired |
| Scott Carr | unchanged | repaired |
| Stephanie Fontaine | unchanged | repaired |
| Tyler Nagano | repaired | repaired |
| Victor Desautels | repaired | repaired |

## Repair contract

- Regenerated narrow, front/rear-facing poses using the existing public directional idles
  as identity references. The batch used **21 successful image calls**, below its 24-call cap.
- Selected two visually reviewed poses for each half-cycle. Baked opposite **leg** phases
  below the upper thigh, with a four-source-pixel premultiplied blend at the shading join.
  Faces, hair parts, buttons, sleeves and the rest of the upper body are not mirrored.
- Kept the established four-frame, two-tile cycle and canonical body/visible-foot anchors.
  There is no runtime warping, body scaling change, new animation framework or frame timer.
- Corrected lower-body silhouettes are bounded; opposite phases cannot repeat the same
  leg; contact feet must be distinguishable; visible-height variation is at most one
  logical pixel. Existing head-scale and anchor-jitter limits still pass.
- The recipe, raw-sheet hashes and selected half-cycle indices are frozen in
  `datamon/tools/vertical_walk_repairs.json`. `gen_vertical_walk_repair.py` rebuilds into
  staging only. Local raw sheets remain in the ignored `.walk-gen-cache/vertical-v1/`.
- The existing 95-call art-generation history remains unchanged. The movement-art manifest
  records this correction separately and now verifies 696 declared movement files.

## Preserving seated art

Packaging exposed an existing dependency: seated art was derived from each walk `up_0.png`.
Changing those inputs would otherwise change seated identities or invalidate provenance.
The 14 superseded public rear source frames are therefore retained in
`datamon/sprites-sit-sources/`; the sitting generator and artifact verifier reference their
original hashes. **All 74 seated PNGs remain byte-identical.** These frozen sources are
packaged provenance only, not runtime walking frames or additional image requests.

A baseline hash guard covers **960 unchanged files**, including all horizontal walking,
healthy vertical directions, directional idles, pilots and seated art. Neither `game.js`
nor `locomotion.js` changed; movement speed, collision, camera, diagonal policy, saves,
Question Hub and campaign progress remain untouched.

## Verification

- `PATH="$PWD/.venv/bin:$PATH" just check`: passed.
- 60 Python asset tests, 360 JavaScript unit tests, 93 Chromium browser tests.
- New browser coverage checks 336 actual renderer phase/anchor combinations across all
  repaired views, walk/run modes and DPR1/DPR2; real keyboard journeys exercise both
  vertical directions at both speeds and preserve the distance-matched phase.
- Reviewed source before/after sheets and native renderer contact sheets at both densities.
- Deterministic package: 1,386 files, 33,049,499 bytes; payload SHA-256
  `d3d03be5488612aafb8d23029a67164ba3c974184a9175e57a66abead09fa1a2`.
- Bounded locomotion evaluator retained `balanced`; all ten art trials passed.
- Three cold-title and all four device/CPU performance configurations passed. Title loading
  remained at zero walking slugs; frozen sitting sources add no runtime requests.

Local review evidence: `.tdd/analysis/060/` and `test-results/vertical-walk/`.
No deployment was performed.
