# Battle scene review

Baseline: `937138f`. Worktree branch: `feat/battle-scene-refinement`.

## Direction

Keep the existing detailed, domain-specific certification theaters and front-facing roster
identities. The stage's three platforms are the signature, not extra HUD decoration. Give the
far trainer headroom, attach information to the subject it describes, and keep the quiz calm.

Classic console palette: ink `#09121f`, panel `#182536`, steel `#435366`, warm text `#e8dfcc`,
muted text `#aab9cc`, focus amber `#f2ca63`. Existing domain accents still identify affiliations
and creatures. Retain the game's native monospace: bold 12–14px identity/question text,
12–13px answer text, 9–11px utility labels. No new fonts, requests, or generated assets.

```
 rival / affiliation / team                        far trainer
                                 Battlemon
 near trainer                    target readout
                                               player / HP
 question                                          run / time
 [key] answer                    [key] answer
 [key] answer                    [key] answer
```

## Findings and refinements

| Finding | Change |
|---|---|
| Far trainer was 156px tall at y=158: just 2px of idle headroom, with clipping during poses. | Preserve the calibrated feet at (151,340)/(683,158); reduce both heights to 146/132. All 37 identities × six poses × both sides clear a 12px frame inset at DPR1/2. |
| Creature identity lived in the opposite corner, with tiny unlabeled team marks. | Move name/domain/level directly below the creature's platform. Replace marks with numbered active/reserve slots and a dash for fainted members. Correct feedback previews the faint without mutating combat. |
| Large yellow selection and saturated red Run competed with both scene and question. | Warm neutral question/answer text, small amber number keycap plus outline/rail for focus, quiet secondary Run. All four hit rectangles and Run remain unchanged. |
| Hard timer crossed the player HP panel; damage appeared over empty floor. | Place seconds/bar beneath Run in the reserved question-header column. Damage originates above the player, with no travel under reduced motion. |
| Incident Command's far trainer was larger than its near operator (180 vs 144), and bobbed. | Share classic 146/132 proportions; plant both trainers with tighter foot shadows. Keep topology, phase cards, actions, economy and reducer untouched. |
| Procedural fallback decks still used obsolete contacts; CONFIG's fallback shell was clipped across cells. | Align fallback surfaces to current foot anchors; use actual canvas ellipse center/radii so every CONFIG fallback pose fits its cell. |
| Layout editor duplicated trainer sizes and HUD rectangles. | Read sizes and all three plate rectangles from production geometry. Drag drafts remain position-only. |

The five accepted arena PNGs, 35 species sheets, manifests, generation receipts, and packaging
budgets are unchanged. No save, question-selection, damage, healing, timing, or battle reducer
rules changed.

## Asset opportunities — not generated in this pass

1. **Incident Command scenery:** the procedural theater looks sparse beside classic arenas.
   The highest-value art pilot is a background-only operations-room wall and command table,
   with quiet space for the existing topology, phase cards, status and actions. Never bake
   labels, questions, counters, portraits or combat state into it.
2. **Actual trainer command/hit poses:** current semantic poses transform the same front-facing
   source. A small identity-preserving pilot would help more than regenerating every arena.
   Keep the reviewed front-facing resting identity and alpha/feet contract.
3. **Selective creature cleanup:** review individual silhouettes and pixel density alongside the
   high-detail backgrounds before replacing a batch. The current domain theaters and species
   identities are good enough to retain; more detail alone is not an improvement.
4. **Phone layout:** the existing canvas scales to fit and pointer targets still align, but text
   remains tiny at 390px. A genuinely readable touch layout needs a separate layout/accessibility
   pass, not new art or a claim that desktop scaling solves mobile usability.

Billable generation needs a fresh explicit estimate/approval and the project's existing
provenance, candidate review and acceptance gates. Historical generation budgets are not a
new authorization.

## Verification

```sh
npm test
npm run validate
npm run package
npx playwright test tests/browser/battle-scene-review.spec.js \
  tests/browser/battle-presentation.spec.js tests/browser/battle-arena.spec.js \
  tests/browser/agent-arena.spec.js --project=chromium
```

`battle-scene-review.spec.js` checks actual transformed trainer corners, complete rendered text
for all 120 questions and 480 choices, timer/damage ownership, desktop/narrow pointer and keyboard
parity, all five theaters' residency budgets, and read-only Incident trainer presentation.
Existing suites cover semantic frames, MIX RNG, malformed assets, accessibility, mute/reduced
motion, regular outcomes and all three boss phases. The fallback unit tests verify foot contacts
inside deck polygons and shell bounds including attack/faint offsets.

Focused browser tests write screenshots to ignored `test-results/`. The original review's
DPR2 before/after captures, contact sheets, comparison and run logs are retained locally in
`.claude-plans/battle-review/` in this worktree (not shipped or tracked).

### Verified result

- **362 unit tests and 100 Chromium browser tests passed** (full suites).
- Content and packaged-artifact validation passed; accepted arena/Battlemon asset validators passed.
- Three cold-title runs and all four DPR/CPU world-performance configurations passed unchanged budgets.
  Classic frame p95 was 10.2–16.2ms; tested classic presentation residency stayed below 8MiB.
- Visually inspected all five classic theaters, intro/sendout/question/wrong/win/fallback states,
  Incident Command regular/boss views, narrow controls and the live layout editor.
- At review handoff, main was untouched. No deployment, paid generation, or save migration was performed.
