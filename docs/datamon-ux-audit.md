# Datamon UX, map, and learning-loop audit

## Player problem and conclusion

> “Where can I work on questions I missed? Can I see all questions and who owns what?”

The missing link was **an explicit recovery destination**, not a shortage of rooms or questions. Battles already saved canonical per-question counts, but finding an exact question required another random encounter. Office mentor review was gated behind besting a colleague and chose a question for the player. The Certification Console offered aggregate evidence; Enter only announced details. Person search offered a temporary camera scout, not walking guidance.

“Ownership” means **in-game colleagues covering a topic**, as confirmed with the player. Questions belong to shared domain pools. Neither exclusive per-colleague questions nor real-world author ownership exists in the data.

## Implemented in this pass

- **Question Hub**, opened with Q or its visible world button in all three maps. Available immediately; no battle, mentor unlock, or travel requirement. The button shows the number of distinct previously missed questions.
- All **120 canonical questions**, searchable by question text, ID, domain, difficulty text, and assigned colleague name. Topic and **Missed before / Due for review / Not yet answered / All questions** filters; 12 results per page.
- Exact-question practice or bounded sessions of up to five filtered questions. No timer, HP loss, coffee use, campaign victory, or difficulty restriction. Explanations appear after submission; session results offer a retry of only that session’s misses.
- Answer/reveal telemetry reuses the existing exact-once canonical/rollback-alias reducer. Browsing never counts as answering or seeing a practice question. Closing unanswered practice records the exposure but does not invent an incorrect answer. Existing future-version write protection remains intact, with an explicit notice.
- **Timed Recall recovery fixed:** it used the same bank but discarded canonical identity and kept only a station score. Newly submitted answers now update the same question history; question reveals are recorded once. The whole-session timer ending is not treated as a submitted incorrect answer. Historical station-only scores cannot reconstruct old misses.
- Actual saved topic assignments and mentor/battle availability, with “Find [colleague]” controls. MIX colleagues are explicitly described as mixed-domain battles and recommendation-led mentor reviews, not exclusive owners.
- **Map & colleagues** directory: six office zones in their real north/south order, destination purposes, and current location. Directions to colleagues, Console, Library, Battle Room, coffee, Library books/stations, and room exits.
- Optional persistent gold walking trail, remaining steps, and arrival/facing instructions. Routes stop at a valid interaction approach, avoid solid tiles/NPCs/chairs, and recalculate on committed tile changes. They do not teleport or auto-walk. Escape clears; a map change clears stale guidance.
- Console Enter now opens the selected domain’s questions. Its Q action opens missed history. Closing the hub preserves the console; selecting a route returns to the world.
- Post-battle dialogue points to the Question Hub. Library shelves, stations, and return doors have facing-action hints.
- Native scrollable dialog, full untruncated choices, visible focus, explicit Tab wrapping, Escape close, touch targets, and focus return to the canvas. Hub typing does not mute or move the player. Physical WASD takes precedence over the printed Q shortcut on alternate layouts.

## Current map and activity inventory

The office, Library, and Battle Room are each **36 × 24 tiles**. The roster has **37 characters**, yielding **36 colleagues** per selected character.

| Area | Actual role | Question relationship | Navigation finding |
|---|---|---|---|
| Agent Wing, northwest | AGENT campaign and mentor encounters | 24 shared questions; 27% exam weighting | Open area, reserved cross/spine routes |
| MCP Lab, north | MCP encounters; Console nearby | 24 shared questions; 18% weighting | Console at (17–18, 4), approaches at row 5 |
| Config Bay, northeast | CONFIG encounters and coffee | 24 shared questions; 20% weighting | Coffee at (31, 2); limited uses, not a study gate |
| Context Corner, southwest | CONTEXT encounters | 24 shared questions; 15% weighting | Glass-room doorway at (7, 15); walk through, unlike warp doors |
| Prompt Studio, south | PROMPT encounters and seats | 24 shared questions; 20% weighting | Seated NPCs and free seats require interaction approaches |
| The Lounge, southeast | MIX encounters | No sixth question bank; weighted domain draw | Mentor review resolves to the evidence recommendation |
| Library, office south door (24, 23) | Reading and four study stations | 10 books, 227 pairs, 191 cloze prompts, 10 diagrams; Timed Recall uses the canonical bank | Return at (18, 23); all shelves/stations have reachable approaches |
| Battle Room, office south door (11, 23) | Unlimited training rematches | Same pools; separate streak/win activity | All 36 training colleagues are approachable; return at (18, 23) |

**Geometry is healthy.** Existing Certification Spine tests verify 189 reserved path cells, no standing NPC on the reserved lanes, all colleague/seat approaches, and both portals across all 37 player selections. Console-to-Battle-Room approach distance is 24 steps; Console-to-Library approach is 23. New route tests check **1,480 office targets** (37 × 40) and **43 side-room targets** without an unreachable result. A keyboard browser journey follows generated directions to the Library and enters through the actual door.

This argues against another floor-plan rebuild. Improve reasons to travel and clarity at destinations before adding more rooms.

## Loop audit

### Discovery → choose a learning target

Previously the default was walking until an exclamation mark appeared. Console recommendations name the highest weighted evidence deficit, which is not always the topic the player just missed. The hub adds an explicit choice between recovery, unattempted questions, and broad practice. Keep the optional game exploration rather than forcing a study dashboard before every encounter.

### Encounter → feedback → recovery

Classic and Agent battles both preserve answer history, and mentor review uses the same canonical bank. The hub now makes an exact question reachable without winning first. Timed Recall’s former telemetry gap is repaired. Matching, cloze, diagram assembly, and reading remain separate content/progress systems; their activity must not be falsely counted as canonical question mastery.

### Recovery → retention

The present “due” heuristic is based on cumulative wrong-versus-correct counts and an 18-draw gap. It is **not calendar spaced repetition**, nor a latest-answer flag. “Missed before” deliberately remains historical after a correct answer. Bounded session results provide an immediate sense of completion without falsely declaring mastery.

### Campaign progress → study evidence → certification

These are three distinct concepts. Beating 36 colleagues does not establish coverage of 120 questions, and replaying a familiar answer can raise aggregate accuracy. The console correctly calls its percentage evidence, not a pass prediction. Some quest/victory language still says certification complete; that needs a dedicated copy/evidence pass rather than silently changing victory conditions here.

## Prioritized follow-up work

These are recommendations, not claims of completed implementation. Only the explicitly requested walking issue was added as a backlog ticket in this pass.

| Priority | Opportunity / evidence | Bounded next change and acceptance | Size |
|---|---|---|---|
| Next, requested | North/south walking legs look unnatural for some characters | **Ticket #060.** Full-roster vertical frame audit, identify asset versus renderer cause, compare before/after while preserving speed, collision, idle, and horizontal animation | Medium |
| P1 | No reliable “latest answer” or recovered-miss state in v2 telemetry (`state.js`, `progress.js`) | Design a compatible last-outcome record and separate recovery queue from historical misses. Test old saves, repeated misses, recovered answers, and future-version protection. Do not infer latest outcomes from aggregate counts | Medium |
| P1 | Title R deletes the save immediately (`handleKey`, title branch) | Confirmation defaulting to Cancel, show what will be erased, keyboard/pointer parity; cancelled or repeated activation must preserve raw save bytes | Small |
| P1 | Save failures are silently swallowed (`save`, `saveToStorage`) | Surface a quiet persistent “Progress not saved” status and an export/retry path. Test denied/quota-exhausted storage; never claim success when storage failed | Medium |
| P1 | Campaign completion language can sound like an official qualification (`completeCertificationQuest`, victory/dialogue) | Rename to campaign completion, retain evidence summary, explain remaining study coverage, and link mock-exam prep. Do not change earned campaign wins | Small |
| P1 | Repeated correct answers can inflate evidence without independent recall (`summarise`) | Show coverage and independent first-pass/retention evidence separately. Define and test the evaluator before changing recommendation weights; keep “not a pass prediction” | Medium |
| P2 | Study activity sources do not link back to a concept explanation | Add verified question-to-guide/topic metadata, then “Read this concept” links. Start with the most-missed concepts. Do not guess associations from keywords or merge station scores into mastery | Medium |
| P2 | Existing mentor modal uses fixed 36px choice rows and clips choices to two lines (`drawMentorReview`) | Reuse the scrollable practice presentation for mentor delivery, retaining mentor identity, existing selection, and exact-once telemetry. Test the longest production stem/choices/explanation | Medium |
| P2 | Legacy book picker, reader, matching and cloze input remain keyboard-heavy; whole canvas is not a semantic interface | Add native controls and touch/assistive-tech parity one activity at a time. New hub accessibility does not make the entire game accessible | Medium |
| P2 | Agent Operations adds economy/action decisions before recall; classic encounters are simpler | Observe first-time players, test a short first-encounter explanation, and measure wrong-action versus wrong-knowledge mistakes. Avoid changing the reducer or difficulty by intuition | Medium |
| P2 | Exact wrong choice, source of miss, and confidence are not persisted | Optional local mistake detail: selected distractor, source, last outcome. Keep it bounded and local; no analytics upload without a product/privacy decision | Medium |
| P2 | Person search steals M for mute and scout expires automatically (`handleSearchKey`, `drawOverworld`) | Make search accept all name characters; offer the same persistent route pin as the hub. Test names containing M and keyboard-layout handling | Small |
| P2 | Standard/Hard difficulty gates the battle deck but the office can appear cleared before question coverage is broad | Make difficulty and pool coverage visible at challenge time; offer “try all difficulties” through the hub. Measure coverage by tier rather than adding more rivals | Small |
| P3 | Cosmetic sitting consumes attention but does not currently change learning | Keep it optional. If a learning action is added, make the seat a contextual shortcut to existing practice—not a new progress system | Small |

## Suggested playtest and decision gates

Use fresh, partly completed, all-colleagues-bested, and imported old saves. Include keyboard, touch, and at least one screen-reader session.

1. After deliberately missing an answer, ask the player to find and retry that exact question **without a hint**. Target: under 20 seconds and no required battle/warp.
2. Ask “Who covers this topic?” Target: correctly identify shared coverage, select a real colleague, and arrive at an interaction approach without confusing a scout with travel.
3. Ask “What does this percentage mean?” Target: distinguish campaign wins, question evidence, and official exam readiness.
4. Complete a five-question practice set. Target: understand feedback, finish without getting trapped, and explain why a corrected question remains in historical misses.
5. Leave and resume. Target: answers persist; an abandoned question is not scored wrong; denied saves are not misrepresented (follow-up required).

Do not add remote analytics as part of this audit. These can be moderated observations; proposed timing targets are hypotheses, not measured user results.

## Verification and limits

- Unit tests cover canonical-only catalog counts, historical-miss/due semantics, malformed telemetry, real topic ownership, pure route finding, and no input mutation.
- Browser tests cover search/paging/colleague names, exact-once answers, practice abandonment, five-question completion/retry, world freeze, real walking/warping, console entry, mobile wrapping/focus/touch, all roster/map route targets, future saves, blocked gameplay layers, and Timed Recall recovery.
- Existing suites cover campaign/training isolation, saves/aliases, all-roster reachability, seated interactions, both battle types, input layouts, art, audio, and locomotion. Desktop notebook/map/world and 390px mobile feedback screenshots were inspected.
- Runtime packaging allowlists and content-addressed script verification include `question-hub.js`; no test seam is shipped.
- No save-schema version bump, roster reassignment, new room, battle rebalance, server, or external asset dependency.
- Browser verification is Chromium; it is not a completed cross-browser or assistive-technology audit. Frame/route tests cannot substitute for the requested walking-animation visual review.
