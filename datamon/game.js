// ============================================================
// DATAMON — a data & AI consulting firm's pokemon-like.
// CLAUDE CODE FOUNDATIONS EDITION: walk the office, battle
// colleagues, answer Claude Certified Architect Foundations
// exam questions to win. Runtime identity art uses packaged
// pixel portraits or initials; raw headshots are never requested.
// ============================================================

"use strict";

// ---------- Roster (matches portraits/ and sprites/) ----------
const ROSTER = [
  "alex-andrianavalontsalama", "antonia-nistor", "aurelien-bouffanais",
  "dana-domanko", "duc-an-nguyen", "emile-moffatt", "ethan-pirso",
  "felicia-gorgacheva", "francesco-finn", "guillaume-delmas-frenette",
  "guillaume-pregent", "jerry-zhu", "jonah-lee", "jonathan-kim",
  "julien-hovan", "logan-labossiere", "megane-darnaud", "pentcho-tchomakov",
  "philippe-miranda-jean", "richard-el-chaar", "sarah-kotb", "scott-carr",
  "stephanie-fontaine", "tabarek-al-khalidi", "tyler-nagano",
  "veronica-marallag", "victor-desautels", "vincent-anctil", "william-chan",
];

function displayName(slug) {
  return slug.split("-").map(s => s[0].toUpperCase() + s.slice(1)).join(" ");
}
function firstName(slug) { return displayName(slug).split(" ")[0]; }

// ---------- Constants ----------
const TILE = 32;
const MAP_W = 36, MAP_H = 24;
const VIEW_W = 25, VIEW_H = 19;          // tiles visible
const CANVAS_W = VIEW_W * TILE;          // 800
const CANVAS_H = VIEW_H * TILE;          // 608
const HUD_BOTTOM = 72;                    // bottom of the top-left HUD box (8 + 64)
const MAP_DETAIL_SCALE = (typeof DatamonWorldArt !== "undefined")
  ? DatamonWorldArt.detailScale(window.devicePixelRatio || 1)
  : 1;
// Camera over-scroll: allow the top edge to scroll this many tiles PAST the map so the
// top row never clamps up under the opaque top-left HUD. Sized to the HUD height (in tiles)
// so map content always renders at/below the HUD's bottom edge — the exposed top strip is
// dark letterbox the HUD covers. Only the top needs it; the HUD is top-anchored.
const CAM_PAD_TOP = HUD_BOTTOM / TILE;    // 2.25 tiles
// Collision set. Office floor plan (#021): # brick wall, D desk, P plant, C coffee counter,
// W window (top wall), O wood column, G glass wall, F solid-furniture footprint, U overhead duct.
const SOLID = new Set(["#", "D", "P", "C", "W", "O", "G", "F", "U", "B", "S", "L"]);
const TYPE_COLORS = { AGENT: "#3b82f6", MCP: "#a855f7", CONFIG: "#22c55e", PROMPT: "#f97316", CONTEXT: "#06b6d4", MIX: "#f59e0b" };
const TYPE_NAMES  = { AGENT: "Agent Wing", MCP: "MCP Lab", CONFIG: "Config Bay", PROMPT: "Prompt Studio", CONTEXT: "Context Corner", MIX: "The Lounge" };
// Exam domains + their weight on the real exam (drives the MIX deck).
const DOMAIN_KEYS = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT"];
const DOMAIN_WEIGHTS = [27, 18, 20, 20, 15];
function weightedDomain() {
  let r = Math.random() * 100;
  for (let i = 0; i < DOMAIN_KEYS.length; i++) { r -= DOMAIN_WEIGHTS[i]; if (r < 0) return DOMAIN_KEYS[i]; }
  return DOMAIN_KEYS[0];
}
const MAX_HP = 100, WRONG_DMG = 25, FLEE_CHANCE = 0.5;
const HARD_TIMER_MS = 30000;   // Hard-mode per-question countdown (ms)
const TIMED_RECALL_MS = 30000; // Library Timed Recall/Boss minigame countdown (ms) (#030)
const DIFFICULTIES = ["easy", "normal", "hard"];
// Mon-level delta per tier (applied in startBattle); Easy is gentler, Hard is tougher.
const TIER_LEVEL_DELTA = { easy: -2, normal: 0, hard: 2 };
const DIFF_LABELS = { easy: "EASY", normal: "NORMAL", hard: "HARD" };
const DIFF_BLURB = {
  easy: "Easy questions · gentler mons · no timer",
  normal: "All questions · standard mons · no timer",
  hard: "Hard questions · tougher mons · 30s timer",
};
const SAVE_KEY = "datamon-save-v1";

// ---------- Seeded RNG (stable NPC layout) ----------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Map ----------
// Office floor plan (PRD 005 / #021) — mirrors datamon/.design/office-concept-topdown.png.
// Open-plan layout: lounge (top-left) · open bullpen-north (top-mid) · kitchen (top-right) ·
// glass meeting room (bottom-left) · desk bullpen (bottom-mid & bottom-right). The only
// enclosed room is the glass meeting room, so there is exactly one interior door.
// Legend: # brick wall · W window · O wood column · G glass wall · D desk · P plant ·
//         C coffee counter (heal) · F solid-furniture footprint (prop baked on top) ·
//         U overhead duct · ~ rug · . hardwood floor
const DOORS = [[7, 15], [24, 23]]; // glass meeting-room entrance + library door approach

// Baked decoration layer (#021): {slug, col, row} where (col,row) is the prop's footprint
// TOP-LEFT tile. Drawn behind characters in buildMapCanvas() (see the prop-bake loop there).
// Manifest convention (#020): anchorX=0, anchorY=heightPx-32 ("feet at bottom row") for all
// props, and heightPx = tileH*TILE — so blitting at (col*TILE + anchorX, row*TILE) at native
// widthPx×heightPx exactly fills the tileW×tileH footprint. Solid furniture (couch, kallax,
// bar, fridge, arc-lamp) has matching "F" collision cells set in buildMap().
const PROP_PLACEMENTS = [
  // Lounge — Agent Wing (top-left)
  { slug: "starry-painting", col: 1, row: 0 }, { slug: "tv", col: 6, row: 0 },
  { slug: "kallax", col: 4, row: 1 },
  { slug: "couch", col: 1, row: 4 }, { slug: "couch", col: 1, row: 6 },
  { slug: "arc-lamp", col: 7, row: 4 }, { slug: "rug", col: 1, row: 8 },
  { slug: "radiator", col: 10, row: 1 },
  // Kitchen — Config Bay (top-right)
  { slug: "fridge", col: 33, row: 2 }, { slug: "coffee-counter", col: 31, row: 2 },
  { slug: "bar", col: 28, row: 5 },
  { slug: "stool", col: 28, row: 6 }, { slug: "stool", col: 29, row: 6 }, { slug: "stool", col: 30, row: 6 },
  { slug: "radiator", col: 25, row: 1 },
  // Glass meeting room — Context Corner (bottom-left)
  { slug: "compass-sign", col: 2, row: 15 },
  { slug: "glass-wall", col: 9, row: 16 }, { slug: "glass-wall", col: 9, row: 19 },
  { slug: "desk", col: 3, row: 18 }, { slug: "desk", col: 3, row: 19 },
  { slug: "office-chair", col: 2, row: 18 }, { slug: "office-chair", col: 6, row: 18 },
  // Bullpen — Prompt Studio (bottom-center)
  { slug: "desk", col: 14, row: 16 }, { slug: "office-chair", col: 14, row: 17 },
  { slug: "desk", col: 20, row: 16 }, { slug: "office-chair", col: 20, row: 17 },
  { slug: "desk", col: 14, row: 19 }, { slug: "office-chair", col: 14, row: 20 },
  { slug: "desk", col: 20, row: 19 }, { slug: "office-chair", col: 20, row: 20 },
  // Bullpen — The Lounge/MIX (bottom-right)
  { slug: "desk", col: 26, row: 15 }, { slug: "office-chair", col: 26, row: 16 },
  { slug: "desk", col: 31, row: 15 }, { slug: "office-chair", col: 31, row: 16 },
  { slug: "desk", col: 26, row: 19 }, { slug: "office-chair", col: 26, row: 20 },
  { slug: "desk", col: 31, row: 19 }, { slug: "office-chair", col: 31, row: 20 },
  // Radiators along the bottom wall
  { slug: "radiator", col: 16, row: 22 }, { slug: "radiator", col: 29, row: 22 },
];

// Library bookshelf bake placements: 8 shelves across the top (cols 4,6,8,10 left + 26,28,30,32 right)
const LIBRARY_PROP_PLACEMENTS = [4, 6, 8, 10, 26, 28, 30, 32].map(c => ({ slug: "bookshelf", col: c, row: 1 }));
// Decor/furniture sprites (PRD 006 art overhaul) — baked bottom-anchored on their tile
// (a 48px-tall sprite extends 16px above the tile; a 64px-wide table spans 2 cols to the
// right). The warp door + 4 themed study carrels replace the old drawn-rectangle stand-ins;
// plants/lamps/tables add atmosphere. Solidity for the non-tile decor is set in buildLibraryMap.
const LIBRARY_DECOR = [
  { slug: "lib-door",            col: 18, row: 23 },   // warp door, set into the south wall
  { slug: "lib-carrel-match",    col: 7,  row: 14 },   // station sprites (type → carrel colour)
  { slug: "lib-carrel-cloze",    col: 15, row: 14 },
  { slug: "lib-carrel-assembly", col: 22, row: 14 },
  { slug: "lib-carrel-timed",    col: 30, row: 14 },
  { slug: "lib-table",           col: 13, row: 9 },    // central reading tables (64px → 2 cols)
  { slug: "lib-table",           col: 21, row: 9 },
  { slug: "lib-plant", col: 2,  row: 6 }, { slug: "lib-plant", col: 34, row: 6 },
  { slug: "lib-plant", col: 2,  row: 20 }, { slug: "lib-plant", col: 34, row: 20 },
  { slug: "lib-lamp",  col: 4,  row: 20 }, { slug: "lib-lamp",  col: 32, row: 20 },
];
// Reading-nook rug: central rectangle filled with the carpet-weave tile (borderless,
// tileable) + a single gold border drawn around the whole area, so it reads as one rug
// rather than a grid of bordered boxes. Walkable (cells stay floor in the map grid).
const LIBRARY_RUG = { x0: 12, y0: 8, x1: 23, y1: 11 };
// Library room label (single zone — CONTEXT type for cyan accent)
const LIBRARY_LABELS = [["THE LIBRARY", 18, 6.6, "CONTEXT"]];

function buildMap() {
  const g = Array.from({ length: MAP_H }, () => Array(MAP_W).fill("."));
  // Brick perimeter
  for (let x = 0; x < MAP_W; x++) { g[0][x] = "#"; g[MAP_H - 1][x] = "#"; }
  for (let y = 0; y < MAP_H; y++) { g[y][0] = "#"; g[y][MAP_W - 1] = "#"; }
  // Industrial windows along the top wall; brick pilasters every 6 tiles stay "#".
  for (let x = 1; x < MAP_W - 1; x++) if (x % 6 !== 0) g[0][x] = "W";
  // Overhead duct run above the kitchen
  g[0][26] = "U"; g[0][27] = "U";

  // Glass-walled meeting room (bottom-left): top edge row 15 (x1..9) + right edge col 9 (y16..22).
  for (let x = 1; x <= 9; x++) g[15][x] = "G";
  for (let y = 16; y <= 22; y++) g[y][9] = "G";
  g[15][7] = ".";                       // meeting-room door (matches DOORS)
  for (const [x, y] of [[3, 18], [4, 18], [3, 19], [4, 19]]) g[y][x] = "D"; // conference table

  // Wood column pillars dotting the open floor
  for (const [x, y] of [[11, 5], [23, 5], [12, 13], [18, 13], [24, 13], [30, 13]]) g[y][x] = "O";

  // Coffee counter (interact to heal) in the kitchen
  g[2][31] = "C";

  // Bullpen desk clusters (each desk prop is 2 tiles wide → pairs of "D" cells)
  const desks = [
    [14, 16], [15, 16], [20, 16], [21, 16], [14, 19], [15, 19], [20, 19], [21, 19], // Prompt Studio
    [26, 15], [27, 15], [31, 15], [32, 15], [26, 19], [27, 19], [31, 19], [32, 19], // MIX
  ];
  for (const [x, y] of desks) g[y][x] = "D";

  // Plants
  for (const [x, y] of [[11, 11], [1, 12], [24, 12], [34, 12], [34, 21], [13, 3], [22, 3]]) g[y][x] = "P";

  // Solid-furniture footprints (floor base; the matching prop bakes on top in buildMapCanvas)
  const furniture = [
    [4, 1], [5, 1], [4, 2], [5, 2],     // kallax bookshelf (2×2)
    [1, 4], [2, 4], [1, 6], [2, 6],     // two couches
    [7, 4], [7, 5],                     // arc-lamp (1×2 footprint)
    [28, 5], [29, 5], [30, 5],          // kitchen bar (3×1)
    [33, 2], [33, 3],                   // fridge (1×2)
  ];
  for (const [x, y] of furniture) g[y][x] = "F";

  g[23][24] = "L"; // library door in south wall (OFFICE_DOOR_TILE) — hardcoded to avoid TDZ

  return g;
}

function buildLibraryMap() {
  const g = Array.from({ length: MAP_H }, () => Array(MAP_W).fill("."));
  // Brick perimeter
  for (let x = 0; x < MAP_W; x++) { g[0][x] = "#"; g[MAP_H - 1][x] = "#"; }
  for (let y = 0; y < MAP_H; y++) { g[y][0] = "#"; g[y][MAP_W - 1] = "#"; }
  // South-wall warp door back to office (hardcoded to avoid TDZ — mirrors LIBRARY_DOOR_TILE [18,23])
  g[23][18] = "L";
  // Bookshelf banks: each shelf is 1 col × 3 rows (matches 32×96 asset), all 3 cells solid "B"
  for (const c of [4, 6, 8, 10, 26, 28, 30, 32]) { g[1][c] = "B"; g[2][c] = "B"; g[3][c] = "B"; }
  // Four study stations (single solid cells)
  for (const [x, y] of [[7, 14], [15, 14], [22, 14], [30, 14]]) g[y][x] = "S";
  // Solid decor footprints (plants, lamps, reading tables) — sprites baked from
  // LIBRARY_DECOR; "O" keeps the player from walking through them. Tables span 2 cols.
  for (const [x, y] of [[2, 6], [34, 6], [2, 20], [34, 20], [4, 20], [32, 20],
                        [13, 9], [14, 9], [21, 9], [22, 9]]) g[y][x] = "O";
  return g;
}

// Study-station registry (#028) — keys are "x,y" tile coords mirroring the "S" cells above.
// `type` routes to the correct minigame; G (#029) supplies matching+cloze, H (#030) assembly+timed.
// `id` is the stable per-station save key in minigameScores. `label` is shown by drawMinigame().
const STUDY_STATIONS = {
  "7,14":  { id: "match",    type: "matching", label: "Matching Pairs" },
  "15,14": { id: "cloze",    type: "cloze",    label: "Fill in the Blank" },
  "22,14": { id: "assemble", type: "assembly", label: "Diagram Assembly" },
  "30,14": { id: "recall",   type: "timed",    label: "Timed Recall" },
};
// Boot-time guard: every "S" cell must have a matching registry entry (catches coord typos early).
console.assert(["7,14", "15,14", "22,14", "30,14"].every(key => key in STUDY_STATIONS),
  "STUDY_STATIONS key mismatch — a study-station coord has no minigame mapping");

// 6 exam-domain zones mapped onto the open-plan office (3 columns × 2 rows).
// Top:    AGENT (lounge) · MCP (bullpen-north) · CONFIG (kitchen)
// Bottom: CONTEXT (meeting room) · PROMPT (bullpen-center) · MIX (bullpen-right)
function regionOf(x, y) {
  if (y < 11) { if (x < 12) return "AGENT"; if (x < 24) return "MCP"; return "CONFIG"; }
  return x < 12 ? "CONTEXT" : (x < 24 ? "PROMPT" : "MIX");
}

// ---------- Zone identity styling (#A: open-plan polish) ----------
// Cosmetic seam runners inlaid along the zone boundaries (verticals x=12 & x=24, horizontal
// y=11) with walkway GAPS — the primary "separate rooms" cue. Purely visual: NOT in SOLID,
// so movement + NPC placement are unaffected. Gap sets list the tile indices left open.
const SEAM_VGAPS = new Set([0, 9, 10, 15, 16, 23]);          // open rows on x=12 / x=24
const SEAM_HGAPS = new Set([0, 6, 7, 17, 18, 29, 30, 35]);   // open cols on y=11

// ---------- Audio (tiny synth, no assets) ----------
let audioCtx = null, muted = false;
function beep(freq, dur = 0.08, type = "square", vol = 0.04, when = 0) {
  if (muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime + when;
    const o = audioCtx.createOscillator(), gn = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    gn.gain.setValueAtTime(vol, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(audioCtx.destination);
    o.start(t); o.stop(t + dur);
  } catch (e) { /* audio unavailable */ }
}
const sfx = {
  move: () => beep(180, 0.04, "square", 0.12),
  select: () => beep(880, 0.06),
  confirm: () => { beep(660, 0.07); beep(990, 0.09, "square", 0.04, 0.07); },
  correct: () => { beep(523, 0.09); beep(659, 0.09, "square", 0.04, 0.09); beep(784, 0.14, "square", 0.04, 0.18); },
  wrong: () => { beep(220, 0.18, "sawtooth"); beep(160, 0.22, "sawtooth", 0.04, 0.12); },
  battle: () => { [392, 392, 392, 311].forEach((f, i) => beep(f, 0.12, "square", 0.05, i * 0.13)); },
  victory: () => { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.15, "square", 0.05, i * 0.14)); },
};

// ---------- Image loading & pixelation ----------
const sprites = {};     // slug -> generated pixel-art trainer sprite (or null)
const tileStore = {};   // slug -> 32px office tile HTMLImageElement (or null on error)
const pixelCache = {};  // slug+size -> canvas (initials are invalidated when portrait arrives)
const miniCache = {};   // slug+size -> downscaled sprite canvas
if (typeof DatamonWorldArt !== "undefined") {
  DatamonWorldArt.onPortraitLoaded(function(slug) {
    for (const key of Object.keys(pixelCache)) {
      if (key.startsWith(slug + ":")) delete pixelCache[key];
    }
  });
}
const walkMiniCache = {}; // walk-frame key+devicesize -> HQ-downscaled canvas

function loadOne(src, store, slug) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { store[slug] = img; resolve(); };
    img.onerror = () => { store[slug] = null; resolve(); };
    img.src = src;
  });
}

function loadImages() {
  // Headshots are never requested at runtime (privacy/package guard #044).
  // Portraits are lazy-loaded via DatamonWorldArt on first use.
  // Sprites remain eager (needed for overworld NPC rendering).
  return Promise.all(ROSTER.map(slug =>
    loadOne(`sprites/${slug}.png`, sprites, slug)
  ));
}

// AI-generated 4-direction walk-cycle frames (PRD: real walk/run animation). Each animated
// slug has sprites-walk/<slug>/<dir>_<0..3>.png (dir ∈ down/up/left/right, 4-frame cycle:
// left contact, passing, right contact, passing). L/R art is baked facing the desired way.
// Only the player uses these frames, so load one slug on demand instead of blocking boot on
// all 464 PNGs. Missing files leave gaps and drawCharacter falls back safely to spriteMini.
const walkAnim = {};      // slug -> {down:[img×4], up:[...], left:[...], right:[...]}
const walkAnimLoads = {}; // slug -> in-flight/completed Promise (deduplicates hover/preload)
const WALK_DIRS = ["down", "up", "left", "right"];
function loadWalkAnim(slug) {
  if (!slug || !ROSTER.includes(slug)) return Promise.resolve();
  if (walkAnimLoads[slug]) return walkAnimLoads[slug];
  walkAnim[slug] = { down: [], up: [], left: [], right: [] };
  walkAnimLoads[slug] = Promise.all(WALK_DIRS.flatMap(dir =>
    [0, 1, 2, 3].map(i => new Promise(resolve => {
      const img = new Image();
      img.onload = () => { walkAnim[slug][dir][i] = img; resolve(); };
      img.onerror = () => { resolve(); };
      img.src = `sprites-walk/${slug}/${dir}_${i}.png`;
    }))
  ));
  return walkAnimLoads[slug];
}

// GBA-style office tiles (32px) -> tileStore, for the tile-based renderer (ticket #003).
// loadOne already resolves with tileStore[slug] = null on any load error, so a missing
// tiles/ dir or a 404 never throws — the game falls back silently to flat tileColor().
const TILE_SLUGS = [
  "floor-a", "floor-b", "floor-c",
  "wall-h", "wall-v",
  "wall-corner-tl", "wall-corner-tr", "wall-corner-bl", "wall-corner-br",
  "desk", "plant", "coffee", "rug",
  // Office surface tileset (ticket #019, PRD 005): warm hardwood, brick walls,
  // industrial window, wood column, silver ducting. Round-1 names above remain
  // loadable; map integration (which slug renders where) is ticket #021.
  "hardwood-a", "hardwood-b", "hardwood-c",
  "brick-red", "brick-white",
  "window-h", "column", "duct",
];

function loadTiles() {
  return Promise.all(TILE_SLUGS.map(slug =>
    loadOne(`tiles/${slug}.png`, tileStore, slug)
  ));
}

// Office props (#020/#021): multi-tile anchored cutouts baked into the static map (#021).
// propManifest entries: {slug, file, widthPx, heightPx, tileW, tileH, anchorX, anchorY}.
// loadOne resolves propStore[slug] = null on any load error, and a missing/invalid
// manifest leaves propManifest = [] — either way buildMapCanvas() degrades to drawn boxes
// (or skips), never throwing. Served over http (play.sh); on file:// fetch fails → [].
const propStore = {};     // slug -> HTMLImageElement (or null on error)
let propManifest = [];    // array of manifest entries (or [] on failure)
const libStore = {};      // slug -> HTMLImageElement (or null on error) — library assets
let libManifest = [];     // library manifest entries (or [] on failure)
function loadProps() {
  return fetch("props/manifest.json")
    .then(r => (r.ok ? r.json() : []))
    .then(list => {
      propManifest = Array.isArray(list) ? list : [];
      return Promise.all(propManifest.map(m =>
        loadOne(`props/${m.file}`, propStore, m.slug)));
    })
    .catch(() => { propManifest = []; });
}

// Books (#027): load books.json for the in-game reader. Mirrors loadLibraryAssets() crash-safety.
// On missing/malformed/network error: loadedBooks stays [] — never rejects boot Promise.all.
function loadBooks() {
  return fetch("library/books.json")
    .then(r => (r.ok ? r.json() : []))
    .then(data => { if (Array.isArray(data)) loadedBooks = data; })
    .catch(() => { loadedBooks = []; });
}

// Matching pairs (#029): mirrors loadBooks() for crash-safety.
function loadPairs() {
  return fetch("library/pairs.json")
    .then(r => (r.ok ? r.json() : []))
    .then(data => { if (Array.isArray(data)) loadedPairs = data; })
    .catch(() => { loadedPairs = []; });
}

// Cloze items (#029): mirrors loadBooks() for crash-safety.
function loadCloze() {
  return fetch("library/cloze.json")
    .then(r => (r.ok ? r.json() : []))
    .then(data => { if (Array.isArray(data)) loadedCloze = data; })
    .catch(() => { loadedCloze = []; });
}

// Diagram layouts (#030): mirrors loadCloze() for crash-safety. Per-piece sprites (if present)
// load via loadLibraryAssets() into libStore; missing sprites degrade to labelled boxes downstream.
function loadDiagrams() {
  return fetch("library/diagrams.json")
    .then(r => (r.ok ? r.json() : []))
    .then(data => { if (Array.isArray(data)) loadedDiagrams = data; })
    .catch(() => { loadedDiagrams = []; });
}

// Library assets (#026): mirrored exactly from loadProps() for crash-safety.
// On file:// protocol or any network error: libManifest = [], libStore stays empty,
// buildLibraryMapCanvas() degrades to drawn-box fallbacks — never rejects the boot Promise.all.
function loadLibraryAssets() {
  return fetch("library/assets/manifest.json")
    .then(r => (r.ok ? r.json() : []))
    .then(list => {
      libManifest = Array.isArray(list) ? list : [];
      return Promise.all(libManifest.map(m => loadOne(`library/assets/${m.file}`, libStore, m.slug)));
    })
    .catch(() => { libManifest = []; });
}

// Smooth-downscaled square version of the trainer sprite for small sizes
// (NN-downscaling 256px art to ~30px gets noisy; averaging keeps it readable).
// The bitmap is cached at DEVICE resolution (size * scale): the main canvas
// transform scales logical units by `scale`, so a `size`-px bitmap drawn at
// `size` logical px would be upscaled `scale`× with smoothing off → blocky on
// retina. Rendering at size*scale here downscales the 256px source straight to
// the on-screen pixel count, so it maps ~1:1 and stays crisp. Callers still
// pass the LOGICAL size and draw at that logical size — unchanged.
function spriteMini(slug, size) {
  const dpx = Math.max(1, Math.round(size * scale));   // device pixels
  const key = slug + ":" + dpx;
  if (miniCache[key]) return miniCache[key];
  const img = sprites[slug];
  if (!img) return null;
  const cv = document.createElement("canvas");
  cv.width = dpx; cv.height = dpx;
  const c = cv.getContext("2d");
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  c.drawImage(img, 0, 0, dpx, dpx);
  miniCache[key] = cv;
  return cv;
}

// Like spriteMini but for a non-square walk frame: HQ-downscale the high-res frame to the
// target DEVICE size once, cached. The main ctx (smoothing OFF, for crisp tiles) then blits
// it at 1:1, so thin legs antialias cleanly instead of breaking up under nearest-neighbour.
function walkMini(img, key, W, H) {
  const dw = Math.max(1, Math.round(W * scale));
  const dh = Math.max(1, Math.round(H * scale));
  const ck = key + ":" + dw + "x" + dh;
  if (walkMiniCache[ck]) return walkMiniCache[ck];
  const cv = document.createElement("canvas");
  cv.width = dw; cv.height = dh;
  const c = cv.getContext("2d");
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  c.drawImage(img, 0, 0, dw, dh);
  walkMiniCache[ck] = cv;
  return cv;
}

// Square-crop a lazily requested FE-style portrait. First use may return initials; the
// WorldArt completion listener invalidates only this slug's cached initials on success.
function pixelHead(slug, n) {
  const key = slug + ":" + n;
  if (pixelCache[key]) return pixelCache[key];
  var portrait = null;
  if (typeof DatamonWorldArt !== "undefined") {
    portrait = DatamonWorldArt.getPortrait(slug);
    if (!DatamonWorldArt.isPortraitSettled(slug)) DatamonWorldArt.loadPortrait(slug);
  }

  const cv = document.createElement("canvas");
  cv.width = n; cv.height = n;
  const c = cv.getContext("2d");
  if (portrait) {
    const s = Math.min(portrait.width, portrait.height);
    const sx = (portrait.width - s) / 2;
    const sy = (portrait.height - s) * 0.02;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(portrait, sx, sy, s, s, 0, 0, n, n);
  } else {
    c.fillStyle = "#64748b"; c.fillRect(0, 0, n, n);
    c.fillStyle = "#fff"; c.font = `${Math.floor(n / 2)}px monospace`;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(slug.split("-").map(w => w[0].toUpperCase()).join("").slice(0, 2), n / 2, n / 2);
  }
  pixelCache[key] = cv;
  return cv;
}

// ---------- Game state ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
// Display backing scale: canvas physical pixels = CANVAS × scale.
// MAP_DETAIL_SCALE controls cache detail (may differ from display scale).
const scale = Math.min(2, window.devicePixelRatio || 1);
canvas.width  = CANVAS_W * scale;
canvas.height = CANVAS_H * scale;
ctx.setTransform(scale, 0, 0, scale, 0, 0);
ctx.imageSmoothingEnabled = false; // must follow resize — resize resets all context state

let map = buildMap();
const OFFICE_MAP = map;                  // stable office grid for warp-back
const LIBRARY_MAP = buildLibraryMap();   // pure data; function is hoisted
let currentMap = "office";               // "office" | "library"
let officeNpcs = [];                     // stash for office NPCs while in library
// Warp geometry — door tiles are SOLID (face-to-interact); entry cells are walkable floor.
// Hardcoded coords are the source of truth (buildMap/buildLibraryMap also use literals).
const OFFICE_DOOR_TILE  = [24, 23];      // "L" in office south wall
const OFFICE_ENTRY      = [24, 22];      // land here returning to office (must be floor)
const LIBRARY_DOOR_TILE = [18, 23];      // "L" in library south wall
const LIBRARY_ENTRY     = [18, 22];      // land here entering library (must be floor)
let state = "title";    // title | select | overworld | battle | victory | search | minigame
let selectIdx = 0;
let player = { slug: null, x: 18, y: 16, fx: 18, fy: 16, dir: "down", moving: false, hp: MAX_HP, dispHp: MAX_HP };
let battleTransition = null;   // {npc, t} — flash + iris wipe into battle
let npcs = [];          // {slug, x, y, type, defeated}
let rivalTotal = 0;     // stable denominator for HUD "Rivals bested" (set in placeNPCs)
let defeated = new Set();
let battle = null;
let toast = null;       // {msg, until}
let coffeePrompt = null; // {sel} — Yes/No confirm before drinking; sel 0=Yes 1=No (default No, anti-spam)
let loadedBooks = [];   // parsed books.json array; [] if missing/malformed
let loadedPairs = [];   // parsed pairs.json array; [] if missing/malformed (#029)
let loadedCloze = [];   // parsed cloze.json array; [] if missing/malformed (#029)
let loadedDiagrams = [];// parsed diagrams.json array; [] if missing/malformed (#030)
let bookPrompt = null;  // {sel, books} — book-picker modal
let readerState = null; // {book, page, screens, maxPage} — full-canvas reader
let questionStats = {};  // "CAT:idx" and canonical ID -> {seen, correct, wrong, lastSeen}
let seenCounter = 0;    // monotonic draw counter — drives lastSeen recency (no Date.now())
let _progression = { badges: [], quests: {}, activities: {}, npcDomains: {} };
let _npcDomains = _progression.npcDomains; // alias into _progression.npcDomains
let _writeProtectedSave = false; // true when a future-version save blocks writes
let seenThisRun = {};   // category -> Set<idx> drawn this run (within-run repeat avoidance)
let coffeeUses = 0;   // coffee heals remaining this run (cap 3); persisted in save
let difficulty = "normal";   // "easy" | "normal" | "hard" — chosen at select, persisted in save
// ---------- Library minigame harness (#028) ----------
let currentMinigame = null;  // {type, stationId, label, score, phase} while state==="minigame"; null otherwise
let libraryProgress = {};    // bookId -> pageReached; persisted now, written by the reader later (#027 follow-up)
let minigameScores = {};     // stationId -> best score (higher is better; 0 = not attempted)
let frame = 0;
let dtF = 1;           // logical 60Hz frames this tick
let mapCv = null;        // active pre-rendered map (points to officeMapCv or libraryMapCv)
let officeMapCv = null;  // pre-rendered office map — built once at boot
let libraryMapCv = null; // pre-rendered library map — built once at boot
let battleGrad = null; // battle backdrop gradient — built once at boot
let stepStartFx = 0, stepStartFy = 0, stepT = 1; // eased-step progress (0..1); 1 = idle
let gaitPhase = 0; // physical gait phase (radians); distance-locked for shadows/dust/fallback
let prevE = 0;     // previous frame's eased step progress; drives slide-free gait delta
let walkAnimPhase = 0; // sprite-frame phase in frames; time-based so 4-frame art does not flicker
const WALK_ANIM_FPS = 9, RUN_ANIM_FPS = 13;
// Footfall dust (PRD 004 / #017). World-space puffs spawned at each gait contact crossing
// while the player moves; ticked + pruned every frame so the array never grows unbounded.
// {x,y in tile coords; dx,dy drift in tiles/frame; life counts down to 0 then pruned}.
let dustParticles = [];
let camFx = null, camFy = null; // lerped camera (TILE units); null = snap-to-target next frame
// Person search (#B). state==="search" overlays a name-filter panel on the frozen overworld;
// picking someone starts a camera "scout" that pans to them, holds, then returns control.
let searchQuery = "";       // current typed filter
let searchSel = 0;          // highlighted result index (into searchResults)
let searchResults = [];     // roster slugs matching the query (player excluded)
let scout = null;           // {npc, phase:"out"|"hold"|"back", until} — camera pan-to-person
const wrapCache = new Map(); // font|maxW|text -> wrapped lines

// ---------- NPC placement ----------
function placeNPCs() {
  const rng = mulberry32(20260610);
  const others = ROSTER.filter(s => s !== player.slug);

  // "Smart" placement: rank candidate cells so NPCs stand BY the furniture (desks, couches,
  // bar…) and OUT OF the walkways, instead of stranded mid-floor blocking traffic.
  // Cells orthogonally adjacent to any baked prop footprint read as "at your station".
  const furnitureAdj = new Set();
  for (const p of PROP_PLACEMENTS) {
    const meta = propManifest.find(m => m.slug === p.slug);
    const tw = (meta && meta.tileW) || 1, th = (meta && meta.tileH) || 1;
    for (let yy = p.row; yy < p.row + th; yy++)
      for (let xx = p.col; xx < p.col + tw; xx++)
        for (const [ax, ay] of [[xx, yy + 1], [xx, yy - 1], [xx - 1, yy], [xx + 1, yy]])
          furnitureAdj.add(`${ax},${ay}`);
  }
  // Main traffic lanes to keep clear: inter-zone aisles (vertical x≈12/24, horizontal y≈11)
  // and a 2-tile margin around every door (incl. the library warp door at 24,23).
  const inAisle = (x, y) => (x >= 11 && x <= 13) || (x >= 23 && x <= 25) || (y >= 10 && y <= 12);
  const nearDoor = (x, y) => DOORS.some(([dx, dy]) => Math.abs(dx - x) + Math.abs(dy - y) <= 2);
  const score = (x, y) => (furnitureAdj.has(`${x},${y}`) ? 100 : 0)
    - (inAisle(x, y) ? 60 : 0) - (nearDoor(x, y) ? 80 : 0);

  const regions = { AGENT: [], MCP: [], CONFIG: [], PROMPT: [], CONTEXT: [], MIX: [] };
  for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
    if (SOLID.has(map[y][x])) continue;
    if (DOORS.some(([dx, dy]) => Math.abs(dx - x) + Math.abs(dy - y) <= 1)) continue;
    if (Math.abs(x - player.x) + Math.abs(y - player.y) <= 2) continue;
    regions[regionOf(x, y)].push([x, y]);
  }
  // Rank each region's cells best-first (score desc; small rng jitter varies ties so the
  // layout isn't identical every run while staying deterministic for a given seed).
  for (const k in regions) {
    regions[k] = regions[k]
      .map(([x, y]) => [x, y, score(x, y) + rng() * 5])
      .sort((a, b) => b[2] - a[2]);
  }

  const order = shuffled(others, rng);
  const perRegion = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT", "MIX"];
  npcs = [];
  order.forEach((slug, i) => {
    // Persist domain identity when a prior assignment exists; otherwise
    // use the deterministic round-robin result and record it.
    // Defensive: validate that a persisted domain is a known region;
    // malformed data cannot index an unknown key.
    const VALID_DOMAINS = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT", "MIX"];
    const freshType = perRegion[i % 6];
    const persisted = (typeof _npcDomains === "object" && _npcDomains[slug]);
    const type = (persisted && VALID_DOMAINS.indexOf(persisted) >= 0) ? persisted : freshType;
    // Record for future sessions (even if unchanged — idempotent).
    if (typeof _npcDomains === "object") _npcDomains[slug] = type;
    // Take the best-ranked spot still ≥3 tiles from every placed NPC (one per workstation).
    const idx = regions[type].findIndex(([x, y]) =>
      !npcs.some(n => Math.abs(n.x - x) + Math.abs(n.y - y) < 3));
    if (idx >= 0) {
      const [x, y] = regions[type][idx];
      npcs.push({ slug, x, y, type, defeated: defeated.has(slug) });
      regions[type].splice(idx, 1);
    }
  });
  rivalTotal = npcs.length; // stable HUD denominator — set after placement completes
}

// ---------- Save / load ----------
// Configure DatamonState once QUESTION_BANK is available.
if (typeof DatamonState !== "undefined") {
  DatamonState.configure({
    roster: ROSTER,
    idMap: DatamonState.buildIdMapFromBank(QUESTION_BANK),
  });
}

let saveCache; // undefined = not yet read; null = confirmed empty save
function save() {
  if (_writeProtectedSave) return; // future-version save blocks all writes
  try {
    // Sync npcDomains back into _progression before serialising.
    _progression.npcDomains = _npcDomains || {};
    // Build v2 state from current globals
    const st = {
      schemaVersion: typeof DatamonState !== "undefined" ? DatamonState.CURRENT_SCHEMA : 2,
      player: player.slug,
      defeated: [...defeated],
      questionStats: questionStats,
      seenCounter: seenCounter,
      coffeeUses: coffeeUses,
      difficulty: difficulty,
      libraryProgress: libraryProgress,
      minigameScores: minigameScores,
      progression: _progression,
    };
    if (typeof DatamonState !== "undefined") {
      DatamonState.saveToStorage(st);
    } else {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ player: player.slug, defeated: [...defeated], questionStats, seenCounter, coffeeUses, difficulty, libraryProgress, minigameScores }));
    }
  } catch (e) {}
  saveCache = undefined;
}
function loadSave() {
  try {
    if (typeof DatamonState !== "undefined") {
      const st = DatamonState.loadFromStorage();
      if (st) {
        // Future-version save: block writes, load what we can, force new game.
        if (DatamonState.isWriteProtected(st)) {
          _writeProtectedSave = true;
          questionStats = st.questionStats || {};
          seenCounter = st.seenCounter || 0;
          coffeeUses = st.coffeeUses;
          difficulty = st.difficulty || "normal";
          libraryProgress = st.libraryProgress || {};
          minigameScores = st.minigameScores || {};
          if (st.progression && typeof st.progression === "object") {
            _progression = st.progression;
            _npcDomains = _progression.npcDomains || {};
          }
          return null; // Don't resume; title shows new-game flow
        }
        // Normal v2 save with a valid player
        if (st.player && ROSTER.includes(st.player)) {
          questionStats = st.questionStats || {};
          seenCounter = st.seenCounter || 0;
          coffeeUses = st.coffeeUses;
          difficulty = st.difficulty || "normal";
          libraryProgress = st.libraryProgress || {};
          minigameScores = st.minigameScores || {};
          if (st.progression && typeof st.progression === "object") {
            _progression = st.progression;
            _npcDomains = _progression.npcDomains || {};
          }
          return st;
        }
      }
      return null;
    }
    // Legacy fallback: direct localStorage parse
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && ROSTER.includes(s.player)) {
      questionStats = (s.questionStats && typeof s.questionStats === "object") ? s.questionStats : {};
      seenCounter = typeof s.seenCounter === "number" ? s.seenCounter : 0;
      coffeeUses = typeof s.coffeeUses === "number" ? s.coffeeUses : 0;
      difficulty = (s.difficulty === "easy" || s.difficulty === "hard") ? s.difficulty : "normal";
      libraryProgress = (s.libraryProgress && typeof s.libraryProgress === "object") ? s.libraryProgress : {};
      minigameScores  = (s.minigameScores  && typeof s.minigameScores  === "object") ? s.minigameScores  : {};
      _progression = { badges: [], quests: {}, activities: {}, npcDomains: {} };
      _npcDomains = _progression.npcDomains;
      return s;
    }
  } catch (e) {}
  return null;
}
function getSave() {
  if (saveCache === undefined) saveCache = loadSave();
  return saveCache;
}

// ---------- Questions ----------
// Weighted spaced-repetition selection tunables.
const STAT_FLOOR = 1, NEVER_SEEN_BONUS = 8, MISS_WEIGHT = 4, RECENCY_W = 0.5, RECENCY_CAP = 20;

// Higher weight = more likely to be drawn. Never-seen and previously-missed score high;
// recently-drawn-and-correct score near the floor. Floor guarantees nothing is starved.
// Looks up stats by canonical ID first, falling back to legacy "CAT:index" key.
function questionWeight(cat, i) {
  const bank = QUESTION_BANK[cat];
  const canonId = (bank && bank[i] && bank[i].id) ? bank[i].id : null;
  // Try canonical ID first, then legacy key, then empty.
  const st = (canonId && questionStats[canonId]) || questionStats[cat + ":" + i];
  if (!st || !st.seen) return STAT_FLOOR + NEVER_SEEN_BONUS;
  const miss = Math.max(0, (st.wrong || 0) - (st.correct || 0));
  const recency = Math.min(RECENCY_CAP, seenCounter - (st.lastSeen || 0)); // larger = longer since drawn
  return STAT_FLOOR + miss * MISS_WEIGHT + recency * RECENCY_W;
}

function drawQuestion(category) {
  const cat = category === "MIX" ? weightedDomain() : category;
  const bank = QUESTION_BANK[cat];
  const n = bank.length;
  // Difficulty-allowed index set. Normal = all indices (identity no-op — keeps
  // pre-ticket behavior byte-identical, SC-2). Easy/Hard restrict to that tier,
  // falling back to the full category when the tier is empty here (AC fallback).
  let allowed = [];
  for (let i = 0; i < n; i++) allowed.push(i);
  if (difficulty === "easy" || difficulty === "hard") {
    const tiered = allowed.filter(i => bank[i].d === difficulty);
    if (tiered.length > 0) allowed = tiered;   // else keep the full-category fallback
  }
  if (!seenThisRun[cat]) seenThisRun[cat] = new Set();
  // Eligible pool = allowed indices not yet drawn this run; when drained, reset
  // (within-run repeat avoidance, scoped to the filtered tier).
  let pool = allowed.filter(i => !seenThisRun[cat].has(i));
  if (pool.length === 0) {
    for (const i of allowed) seenThisRun[cat].delete(i);
    pool = allowed.slice();
  }
  // Weighted pick from the eligible pool.
  const weights = pool.map(i => questionWeight(cat, i));
  let total = 0; for (const w of weights) total += w;
  let idx = pool[pool.length - 1];
  let r = Math.random() * total;
  for (let k = 0; k < pool.length; k++) { r -= weights[k]; if (r < 0) { idx = pool[k]; break; } }
  seenThisRun[cat].add(idx);
  // Record the draw: bump seen + stamp recency on the canonical ID.
  // Also ensure the legacy alias exists for rollback compatibility.
  const canonId = bank[idx].id;
  const legacyKey = cat + ":" + idx;
  const st = questionStats[canonId] || (questionStats[canonId] = { seen: 0, correct: 0, wrong: 0, lastSeen: 0 });
  st.seen++; st.lastSeen = ++seenCounter;
  // Keep the rollback alias exactly synchronized with the canonical record.
  const leg = questionStats[legacyKey] || (questionStats[legacyKey] = { seen: 0, correct: 0, wrong: 0, lastSeen: 0 });
  leg.seen = st.seen; leg.correct = st.correct; leg.wrong = st.wrong; leg.lastSeen = st.lastSeen;
  if (battle) battle.curKey = canonId;
  if (battle) battle.curLegacyKey = legacyKey;
  return { ...QUESTION_BANK[cat][idx], cat };   // shape unchanged (Must Not #3)
}

// ---------- Battle ----------
// Message text reveals typewriter-style; tests can override the speed.
function TEXT_SPEED() { return window.TEXT_SPEED_OVERRIDE || 2.5; }

// Procedural pixel "mon" — mirrored 8x8 invader seeded by its name.
const monCache = {};
function monSpriteCv(name, color) {
  const key = name + color;
  if (monCache[key]) return monCache[key];
  const rng = mulberry32(hashStr(name));
  const cv = document.createElement("canvas");
  cv.width = 8; cv.height = 8;
  const c = cv.getContext("2d");
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
    if (rng() < 0.42) {
      c.fillStyle = rng() < 0.22 ? "#e2e8f0" : color;
      c.fillRect(x, y, 1, 1); c.fillRect(7 - x, y, 1, 1);
    }
  }
  monCache[key] = cv;
  return cv;
}

function spawnPoof(b) {
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const sp = 2 + Math.random() * 2.5;
    b.poof.push({ x: 0, y: 0, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 16 + Math.random() * 10 });
  }
}

function startBattle(npc) {
  const monPool = shuffled(MON_NAMES[npc.type === "MIX" ? weightedDomain() : npc.type],
                           mulberry32(Math.floor(Math.random() * 1e9)));
  const level = Math.max(1, 5 + defeated.size * 2 + (TIER_LEVEL_DELTA[difficulty] || 0));
  const isAgent = npc.type === "AGENT";
  battle = {
    npc,
    mons: [0, 1].map(i => ({ name: monPool[i % monPool.length], level: level + i, q: null, alive: true })),
    idx: 0,
    phase: "intro", // Agent phase is projected from reducer state before the scene renders
    timerMs: HARD_TIMER_MS,
    msg: isAgent
      ? `${displayName(npc.slug)} challenges you to an Agent Operations duel!`
      : `${displayName(npc.slug)} ${BATTLE_INTROS[Math.floor(Math.random() * BATTLE_INTROS.length)]}`,
    sel: 0,
    feedback: null,
    shake: 0,
    startF: frame,
    msgAt: frame,
    sendoutAt: 0,
    faintAt: 0,
    attackAt: 0,
    dmgAt: 0,
    poof: [],
  };
  // Agent Operations: initialise reducer-owned encounter state, presentation arena,
  // and draw bridge, then route the initial turn through the one adapter.
  if (isAgent && typeof DatamonBattleOps !== "undefined") {
    if (typeof AgentArena !== "undefined") {
      AgentArena.init({ muted: muted, playerSlug: player.slug, npcSlug: npc.slug });
      AgentArena.setDrawTrainer(drawTrainer);
    }
    battle.agentOps = DatamonBattleOps.createEncounter({
      npc: npc,
      npcs: npcs,
      playerHp: player.hp,
    });
    battle.agentOpsSel = 0;
    battle.agentOpsChoiceSel = 0;
    battle._agentVictoryConsumed = false;
    battle._agentDefeatConsumed = false;
    _agentDispatch(battle, { type: "START_TURN", question: drawQuestion(npc.type) });
  }
  wrapCache.clear();
  state = "battle";
}

// The sole Agent Operations adapter. Reducer dispatch, state assignment, HP
// projection, one-shot semantic effects, timer reset, and presentation phase
// projection all happen here. PLAYER_DAMAGE is deliberately not additive: the
// reducer owns HP and this adapter idempotently assigns its absolute value.
function _agentDispatch(b, event) {
  if (!b || !b.agentOps || !event) return { state: b && b.agentOps, effects: [] };
  var previous = b.agentOps;
  var result = DatamonBattleOps.reduce(previous, event);
  b.agentOps = result.state;
  player.hp = b.agentOps.playerHp;

  if (event.type === "START_TURN" && b.agentOps !== previous) {
    b.timerMs = HARD_TIMER_MS;
  }

  // Present the whole semantic transition exactly once. The arena compares the
  // immutable before/after reducer snapshots, so it can narrate accepted and
  // rejected input without drawing code mutating combat state.
  var effects = result.effects || [];
  var arenaActive = typeof AgentArena !== "undefined";
  if (arenaActive) AgentArena.syncTransition(b, previous, event, effects);

  // Consume persistence/game effects once. Legacy sounds are fallback-only;
  // playing them beside arena cues would double every Agent sound.
  for (var i = 0; i < effects.length; i++) {
    var effect = effects[i];
    switch (effect.type) {
      case "RECORD_OUTCOME":
        recordOutcome(effect.correct);
        break;
      case "STABILITY_DAMAGE":
        if (!arenaActive) sfx.correct();
        break;
      case "PLAYER_DAMAGE":
        // HP was already assigned absolutely from reducer state above.
        if (!arenaActive) sfx.wrong();
        break;
      case "GUARDRAIL_BLOCK":
        if (!arenaActive) sfx.confirm();
        break;
      case "INSPECT_ELIMINATED":
        if (!arenaActive) sfx.select();
        break;
      case "PATCH_APPLIED":
        if (!arenaActive) sfx.confirm();
        break;
      case "ACTION_REJECTED":
        if (!arenaActive) sfx.wrong();
        showToast(effect.reason === "insufficient_momentum"
          ? "Not enough Momentum! (need " + effect.needed + ", have " + effect.available + ")"
          : "Invalid action!");
        break;
      case "ESCAPED":
        if (!arenaActive) sfx.confirm();
        _agentExitToOverworld(b, "Fled from the Agent Operations duel!");
        break;
      case "PHASE_SHIFT":
        if (!arenaActive) sfx.confirm();
        break;
      case "VICTORY":
        if (!b._agentVictoryConsumed) {
          b._agentVictoryConsumed = true;
          b.npc.defeated = true;
          defeated.add(b.npc.slug);
          save();
          if (!arenaActive) sfx.victory();
        }
        break;
      case "DEFEAT":
        if (!b._agentDefeatConsumed) {
          b._agentDefeatConsumed = true;
          if (!arenaActive) sfx.wrong();
        }
        break;
    }
  }

  // An escape effect removes the encounter immediately. All other accepted
  // transitions are projected from reducer state; callers never mutate b.phase.
  if (battle === b && b.agentOps !== previous) _agentSyncPhase(b);
  return result;
}

function currentMon() { return battle.mons[battle.idx]; }

function sendOutCurrentMon(b) {
  b.phase = "sendout";
  b.msg = `${firstName(b.npc.slug)} sends out ${currentMon().name.toUpperCase()} (Lv.${currentMon().level})!`;
  b.msgAt = frame;
  b.sendoutAt = frame;
  b.faintAt = 0; b.attackAt = 0; b.dmgAt = 0;
  spawnPoof(b);
}

// Advance only reducer-owned non-interactive phases. action/choice input is
// dispatched by dedicated handlers and cannot be skipped by presentation code.
function _agentAdvance(b) {
  var phase = b.agentOps.phase;
  if (phase === "resolve") {
    _agentDispatch(b, { type: "RESOLUTION_COMPLETE" });
  } else if (phase === "feedback" || phase === "phase-shift") {
    _agentDispatch(b, { type: "START_TURN", question: drawQuestion(b.npc.type) });
  } else if (phase === "victory") {
    _agentFinishVictory(b);
  } else if (phase === "defeat") {
    _agentFinishDefeat(b);
  }
}

function _agentExitToOverworld(b, toastMessage) {
  if (battle !== b) return;
  if (typeof AgentArena !== "undefined") AgentArena.reset();
  wrapCache.clear();
  battle = null;
  player.fx = player.x; player.fy = player.y; player.moving = false; stepT = 1;
  state = "overworld"; bufferedDir = null; turnStartMs = null;
  if (toastMessage) showToast(toastMessage);
}

function _agentFinishVictory(b) {
  if (battle !== b || !b._agentVictoryConsumed) return;
  if (typeof AgentArena !== "undefined") AgentArena.reset();
  wrapCache.clear();
  battle = null;
  if (npcs.every(function (n) { return n.defeated; })) {
    state = "victory";
  } else {
    player.fx = player.x; player.fy = player.y; player.moving = false; stepT = 1;
    state = "overworld"; bufferedDir = null; turnStartMs = null;
  }
}

function _agentFinishDefeat(b) {
  if (battle !== b || !b._agentDefeatConsumed) return;
  if (typeof AgentArena !== "undefined") AgentArena.reset();
  wrapCache.clear();
  battle = null;
  if (currentMap !== "office") { currentMap = "office"; map = OFFICE_MAP; mapCv = officeMapCv; npcs = officeNpcs; }
  player.hp = MAX_HP;
  player.x = player.fx = 18; player.y = player.fy = 16;
  camFx = camFy = null; stepT = 1; player.moving = false;
  state = "overworld"; bufferedDir = null; turnStartMs = null;
  showToast("You respawned in the lounge with a fresh coffee. HP restored!");
}

// Keyboard input routing for Agent Operations encounters. The global keydown
// latch rejects held/repeated keys before they reach this phase-specific router.
function _agentCue(name) {
  if (typeof AgentArena !== "undefined") AgentArena.playCue(name);
  else if (name === "navigate") sfx.select();
  else sfx.confirm();
}

function _agentHandleKey(b, k) {
  var phase = b.agentOps.phase;
  if (phase === "action") {
    if (k === "ArrowDown" || k === "ArrowRight") {
      b.agentOpsSel = (b.agentOpsSel + 1) % 4;
      _agentCue("navigate");
      if (typeof AgentArena !== "undefined") AgentArena.announceActionFocus(b);
    } else if (k === "ArrowUp" || k === "ArrowLeft") {
      b.agentOpsSel = (b.agentOpsSel + 3) % 4;
      _agentCue("navigate");
      if (typeof AgentArena !== "undefined") AgentArena.announceActionFocus(b);
    } else if (["1", "2", "3", "4"].includes(k)) {
      b.agentOpsSel = parseInt(k) - 1;
      _agentSelectAction(b, DatamonBattleOps.ACTION_KEYS[b.agentOpsSel]);
    } else if (k === "Enter" || k === " ") {
      _agentSelectAction(b, DatamonBattleOps.ACTION_KEYS[b.agentOpsSel]);
    } else if (k === "r" || k === "R" || k === "Escape") {
      attemptRun();
    }
  } else if (phase === "choice") {
    var eliminated = b.agentOps.eliminated || [];
    if (k === "ArrowRight" || k === "ArrowDown") {
      var next = b.agentOpsChoiceSel;
      for (var tries = 0; tries < 4; tries++) {
        next = (next + 1) % 4;
        if (eliminated.indexOf(next) < 0) break;
      }
      if (eliminated.indexOf(next) < 0) {
        b.agentOpsChoiceSel = next;
        _agentCue("navigate");
        if (typeof AgentArena !== "undefined") AgentArena.announceChoiceFocus(b);
      }
    } else if (k === "ArrowLeft" || k === "ArrowUp") {
      var prev = b.agentOpsChoiceSel;
      for (var tries2 = 0; tries2 < 4; tries2++) {
        prev = (prev + 3) % 4;
        if (eliminated.indexOf(prev) < 0) break;
      }
      if (eliminated.indexOf(prev) < 0) {
        b.agentOpsChoiceSel = prev;
        _agentCue("navigate");
        if (typeof AgentArena !== "undefined") AgentArena.announceChoiceFocus(b);
      }
    } else if (["1", "2", "3", "4"].includes(k)) {
      answerQuestion(parseInt(k) - 1);
    } else if (k === "Enter" || k === " ") {
      answerQuestion(b.agentOpsChoiceSel);
    } else if (k === "r" || k === "R" || k === "Escape") {
      attemptRun();
    }
  } else if (k === "Enter" || k === " ") {
    if (Math.floor((frame - b.msgAt + 1) * TEXT_SPEED()) < b.msg.length) {
      b.msgAt = frame - Math.ceil(b.msg.length / TEXT_SPEED());
    } else {
      _agentCue("confirm");
      advanceBattle();
    }
  }
}

function _agentSelectAction(b, actionName) {
  _agentDispatch(b, { type: "SELECT_ACTION", action: actionName });
}

function _agentFirstEnabledChoice(ao) {
  var count = ao.question && Array.isArray(ao.question.c) ? ao.question.c.length : 0;
  for (var i = 0; i < count; i++) {
    if ((ao.eliminated || []).indexOf(i) < 0) return i;
  }
  return 0;
}

// Project reducer state into the legacy battle rendering object. This is the
// only function allowed to assign an Agent encounter's presentation phase.
function _agentSyncPhase(b) {
  var ao = b.agentOps;
  b.phase = ao.phase;
  switch (ao.phase) {
    case "action":
      b.agentOpsSel = 0;
      b.agentOpsChoiceSel = 0;
      b.feedback = null;
      b.shake = 0;
      b.attackAt = 0;
      b.dmgAt = 0;
      break;
    case "choice":
      // Inspect can eliminate index 0, so never initialise the cursor blindly.
      b.agentOpsChoiceSel = _agentFirstEnabledChoice(ao);
      break;
    case "resolve":
      if (ao.outcome) {
        var q = ao.question;
        var correctIndex = q ? (q.correct != null ? q.correct : q.a) : -1;
        var correctAnswer = q && q.c ? q.c[correctIndex] : "?";
        if (ao.outcome.correct) {
          var action = DatamonBattleOps.ACTIONS[ao.selectedAction] || DatamonBattleOps.ACTIONS.query;
          b.feedback = { correct: true };
          b.msg = "Correct! " + action.label + " hit for " + action.damage + " Stability." + (q && q.x ? " (" + q.x + ")" : "");
          b.faintAt = frame;
          b.shake = 0; b.attackAt = 0; b.dmgAt = 0;
        } else {
          b.feedback = { correct: false, blocked: !!ao.outcome.blocked };
          b.msg = ao.outcome.reason === "timeout"
            ? "Time's up! The answer was \"" + correctAnswer + "\"."
            : "Wrong! The answer was \"" + correctAnswer + "\".";
          if (ao.outcome.blocked) {
            b.msg += " Guardrail blocked the hit — no HP damage.";
            b.shake = 0; b.attackAt = 0; b.dmgAt = 0;
          } else {
            b.msg += " You took " + WRONG_DMG + " damage!";
            // Agent presentation owns bounded impact cues; legacy shake/flash state
            // stays disabled (including under prefers-reduced-motion).
            b.shake = 0; b.attackAt = 0; b.dmgAt = 0;
          }
        }
        b.msgAt = frame;
      }
      break;
    case "feedback":
      if (ao.outcome && ao.outcome.correct) {
        b.feedback = { correct: true };
        b.msg = "Good hit! " + (ao.boss ? "Boss Stability: " + ao.stability + "/" + ao.maxStability : "Stability: " + ao.stability + "/" + ao.maxStability);
      } else if (ao.outcome && ao.outcome.blocked) {
        b.feedback = { correct: false, blocked: true };
        b.msg = "Guardrail blocked the hit. No HP damage taken.";
      } else {
        b.feedback = { correct: false };
        b.msg = "You took " + WRONG_DMG + " damage!";
      }
      b.msgAt = frame;
      break;
    case "phase-shift":
      b.msg = displayName(b.npc.slug) + " shifts stance! Phase " + (ao.bossPhase + 1) + " — Stability " + ao.stability + "/" + ao.maxStability + "!";
      b.msgAt = frame;
      break;
    case "victory":
      b.msg = "You defeated " + displayName(b.npc.slug) + "! \"" + WIN_QUOTES[Math.floor(Math.random() * WIN_QUOTES.length)] + "\"";
      b.msgAt = frame;
      break;
    case "defeat":
      b.msg = "You blacked out from imposter syndrome... \"" + LOSE_QUOTES[Math.floor(Math.random() * LOSE_QUOTES.length)] + "\"";
      b.msgAt = frame;
      break;
  }
}

function advanceBattle() {
  const b = battle;
  // Agent Operations routing
  if (b.agentOps) {
    _agentAdvance(b);
    return;
  }
  if (b.phase === "intro") {
    sendOutCurrentMon(b);
  } else if (b.phase === "sendout") {
    currentMon().q = drawQuestion(b.npc.type);
    b.phase = "question";
    b.sel = 0;
    b.timerMs = HARD_TIMER_MS;       // (re)start the Hard-mode countdown for the new question
  } else if (b.phase === "feedback") {
    if (b.feedback.correct) {
      currentMon().alive = false;
      if (b.idx + 1 < b.mons.length) {
        b.idx++;
        sendOutCurrentMon(b);
      } else {
        b.phase = "win";
        b.msg = `You defeated ${displayName(b.npc.slug)}! "${WIN_QUOTES[Math.floor(Math.random() * WIN_QUOTES.length)]}"`;
        b.msgAt = frame;
        sfx.victory();
      }
    } else if (player.hp <= 0) {
      b.phase = "lose";
      b.msg = `You blacked out from imposter syndrome... "${LOSE_QUOTES[Math.floor(Math.random() * LOSE_QUOTES.length)]}"`;
      b.msgAt = frame;
    } else {
      currentMon().q = drawQuestion(b.npc.type);
      b.phase = "question";
      b.sel = 0; b.attackAt = 0; b.dmgAt = 0;
      b.timerMs = HARD_TIMER_MS;     // (re)start the Hard-mode countdown for the next question
    }
  } else if (b.phase === "win") {
    b.npc.defeated = true;
    defeated.add(b.npc.slug);
    save();
    wrapCache.clear();
    battle = null;
    if (npcs.every(n => n.defeated)) { state = "victory"; sfx.victory(); }
    else {
      // resolve any step that was mid-slide when SPACE triggered the battle (win keeps you in place)
      player.fx = player.x; player.fy = player.y; player.moving = false; stepT = 1;
      state = "overworld"; bufferedDir = null; turnStartMs = null;
    }
  } else if (b.phase === "lose") {
    wrapCache.clear();
    battle = null;
    // Safety belt: battles can only start in the office; ensure we warp back if somehow in library
    if (currentMap !== "office") { currentMap = "office"; map = OFFICE_MAP; mapCv = officeMapCv; npcs = officeNpcs; }
    player.hp = MAX_HP;
    player.x = player.fx = 18; player.y = player.fy = 16;
    camFx = camFy = null; stepT = 1; player.moving = false;
    state = "overworld"; bufferedDir = null; turnStartMs = null;
    showToast("You respawned in the lounge with a fresh coffee. HP restored!");
  }
}

function recordOutcome(correct) {
  const canonKey = battle && battle.curKey;
  const legacyKey = battle && battle.curLegacyKey;
  if (!canonKey) return;
  // Update canonical ID stat
  const st = questionStats[canonKey] || (questionStats[canonKey] = { seen: 0, correct: 0, wrong: 0, lastSeen: seenCounter });
  if (correct) st.correct++; else st.wrong++;
  // Mirror to legacy key for rollback compatibility
  if (legacyKey) {
    const leg = questionStats[legacyKey] || (questionStats[legacyKey] = { seen: 0, correct: 0, wrong: 0, lastSeen: seenCounter });
    leg.correct = st.correct;
    leg.wrong = st.wrong;
    leg.seen = st.seen;
    leg.lastSeen = st.lastSeen;
  }
  save();   // persist immediately so a single answer lands in localStorage
}

// Shared wrong-answer outcome: WRONG_DMG + shake + mon attack/flash animation +
// feedback flag + transition to the feedback phase. Used by BOTH the wrong branch
// of answerQuestion AND the Hard-mode timeout handler so they route through the
// EXACT same code path (Must Not #4 — timeout reuses the existing wrong-answer/
// blackout flow; at 0 HP advanceBattle's feedback branch routes to lose).
function applyWrongHit(b, msg) {
  sfx.wrong();
  player.hp = Math.max(0, player.hp - WRONG_DMG);
  b.shake = 14;
  b.feedback = { correct: false };
  b.msg = msg;
  b.attackAt = frame;
  b.dmgAt = frame;
  b.msgAt = frame;
  b.phase = "feedback";
}

function answerQuestion(i) {
  const b = battle;
  // The reducer is the validation boundary for enabled, integer, in-range choices.
  if (b.agentOps) {
    _agentDispatch(b, { type: "SUBMIT_ANSWER", index: i });
    return;
  }
  // Classic battle path
  const q = currentMon().q;
  const correct = i === q.a;
  recordOutcome(correct);
  if (correct) {
    sfx.correct();
    b.feedback = { correct: true };
    b.msg = `Correct! ${currentMon().name.toUpperCase()} fainted!` + (q.x ? ` (${q.x})` : "");
    b.faintAt = frame;
    b.msgAt = frame;
    b.phase = "feedback";
  } else {
    applyWrongHit(b, `Wrong! It was "${q.c[q.a]}". ${q.x || ""} ${currentMon().name.toUpperCase()} hits you for ${WRONG_DMG}!`);
  }
}

// Hard-mode timer expiry: same outcome as a wrong answer (records a miss, applies
// the wrong-hit, shows a timeout message). Does NOT auto-advance — the player
// presses ENTER through feedback exactly as with a wrong answer; at 0 HP the
// existing advanceBattle feedback→lose branch handles blackout/respawn.
function timeoutQuestion() {
  const b = battle;
  if (!b) return;
  // Agent Operations routing; reducer phase guards make expiry exact-once.
  if (b.agentOps) {
    _agentDispatch(b, { type: "TIMEOUT" });
    return;
  }
  // Classic path
  if (b.phase !== "question") return;
  recordOutcome(false);
  applyWrongHit(b, `Time's up! It was "${currentMon().q.c[currentMon().q.a]}". ${currentMon().name.toUpperCase()} hits you for ${WRONG_DMG}!`);
}

function attemptRun() {
  const b = battle;
  if (!b) return;
  // Agent Operations routing: Run always succeeds in reducer-valid phases.
  if (b.agentOps) {
    _agentDispatch(b, { type: "RUN" });
    return;
  }
  // Classic path
  if (b.phase !== "question") return;
  if (Math.random() < FLEE_CHANCE) {
    // SUCCESS — flee to the overworld. Mirrors the advanceBattle() win-branch restore,
    // but deliberately does NOT mark the rival defeated and does NOT call save().
    sfx.confirm();
    wrapCache.clear();
    battle = null;
    player.fx = player.x; player.fy = player.y; player.moving = false; stepT = 1;
    state = "overworld"; bufferedDir = null; turnStartMs = null;
    showToast("Got away safely!");
  } else {
    // FAILURE — same attack path as a wrong answer (damage + shake + hit animation).
    sfx.wrong();
    player.hp = Math.max(0, player.hp - WRONG_DMG);
    b.shake = 14;
    b.attackAt = frame;
    b.dmgAt = frame;
    if (player.hp <= 0) {
      // route into the existing lose/blackout flow (advanceBattle() handles it on advance)
      b.feedback = { correct: false };
      b.msg = `You blacked out from imposter syndrome... "${LOSE_QUOTES[Math.floor(Math.random() * LOSE_QUOTES.length)]}"`;
      b.msgAt = frame;
      b.phase = "lose";
    } else {
      // survived — stay on the same question; the hit animation self-expires (frame-delta gated)
      b.feedback = null;
      showToast("Couldn't escape!");
    }
  }
}

// ---------- Toast ----------
function showToast(msg, ms = 2600) { toast = { msg, until: performance.now() + ms }; }

// ---------- Input ----------
const keys = {};
const agentActivationKeys = new Set();
window.addEventListener("keydown", e => {
  // Unlock audio on first user interaction (browser autoplay policy).
  if (typeof AgentArena !== "undefined") AgentArena.unlockAudio();
  if (typeof DatamonMusic !== "undefined") DatamonMusic.unlock();
  // M is a global audio control, including while the colleague search field is open.
  if (state === "search" && (e.key === "m" || e.key === "M")) {
    e.preventDefault();
    handleKey(e.key);
    return;
  }
  if (state === "search") { e.preventDefault(); handleSearchKey(e); return; }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
  if (e.key === "Tab" && state === "select") e.preventDefault();   // Tab cycles difficulty, not focus
  if (e.key === "Escape" && state === "battle" && battle && (battle.phase === "question" || (battle.agentOps && (battle.agentOps.phase === "action" || battle.agentOps.phase === "choice")))) e.preventDefault();
  const code = e.code || "";
  const alreadyDown = !!keys[e.key] || !!(code && keys[code]);
  const agentOwned = agentActivationKeys.has(e.key);
  const inAgentBattle = state === "battle" && battle && battle.agentOps;
  keys[e.key] = true;
  if (code) keys[code] = true; // physical key codes survive Shift/Caps Lock/layout changes
  const pressedDir = KEY_DIR[e.key] || KEY_DIR[code];
  if (state === "overworld" && pressedDir && !coffeePrompt && !bookPrompt && !readerState && !scout) {
    if (player.moving) bufferedDir = pressedDir;
    else {
      // A quick tap must move—not merely turn. Holding/repeat continues through the normal loop.
      player.dir = pressedDir;
      turnStartMs = null;
      tryStep(pressedDir);
    }
  }
  // Agent phases may change on a keydown. Requiring release before another event
  // prevents a held key (including synthetic repeat:false duplicates) from crossing
  // action → choice → resolve/feedback or a terminal phase back to the overworld.
  if ((agentOwned || inAgentBattle) && (e.repeat || alreadyDown)) return;
  if (inAgentBattle) agentActivationKeys.add(e.key);
  if (e.repeat && (bookPrompt || readerState || state === "minigame")) return; // prevent held-Enter blowing picker→reader or minigame
  handleKey(e.key);
}, true);
window.addEventListener("keyup", e => {
  keys[e.key] = false;
  if (e.code) keys[e.code] = false;
  agentActivationKeys.delete(e.key);
}, true);
window.addEventListener("blur", () => {
  for (const key in keys) keys[key] = false;
  agentActivationKeys.clear();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && typeof AgentArena !== "undefined") AgentArena.suspend();
});

function handleKey(k) {
  if (k === "m" || k === "M") {
    muted = !muted;
    if (typeof AgentArena !== "undefined") AgentArena.setMuted(muted);
    if (typeof DatamonMusic !== "undefined") DatamonMusic.setMuted(muted);
    showToast(muted ? "Muted" : "Sound on");
    return;
  }

  if (state === "title") {
    if (k === "Enter" || k === " ") {
      sfx.confirm();
      const s = getSave();
      if (s) {
        player.slug = s.player;
        loadWalkAnim(player.slug); // prewarmed at boot; idempotent if already complete
        defeated = new Set(s.defeated);
        placeNPCs();
        if (npcs.every(n => n.defeated)) { state = "victory"; }
        else { state = "overworld"; bufferedDir = null; turnStartMs = null; }
      } else {
        state = "select";
        loadWalkAnim(ROSTER[selectIdx]);
      }
    }
    if (k === "r" || k === "R") {
      _writeProtectedSave = false;
      if (typeof DatamonState !== "undefined") {
        DatamonState.resetSave();
      } else {
        localStorage.removeItem(SAVE_KEY);
      }
      saveCache = undefined;
      defeated = new Set();
      questionStats = {};
      seenCounter = 0;
      seenThisRun = {};
      coffeeUses = 3;
      difficulty = "normal";
      libraryProgress = {}; minigameScores = {}; currentMinigame = null;
      _progression = { badges: [], quests: {}, activities: {}, npcDomains: {} };
      _npcDomains = _progression.npcDomains;
      showToast("Save cleared!");
    }
  } else if (state === "select") {
    const cols = SEL.cols;
    if (k === "ArrowRight") setSelect(Math.min(ROSTER.length - 1, selectIdx + 1));
    if (k === "ArrowLeft")  setSelect(Math.max(0, selectIdx - 1));
    if (k === "ArrowDown")  setSelect(Math.min(ROSTER.length - 1, selectIdx + cols));
    if (k === "ArrowUp")    setSelect(Math.max(0, selectIdx - cols));
    if (k === "Tab" || k === "d" || k === "D") cycleDifficulty(1);
    if (k === "Enter" || k === " ") {
      sfx.confirm();
      player.slug = ROSTER[selectIdx];
      loadWalkAnim(player.slug);
      defeated = new Set();
      player.hp = MAX_HP;
      player.x = player.fx = 18; player.y = player.fy = 16;
      camFx = camFy = null; stepT = 1; player.moving = false;
      _progression = { badges: [], quests: {}, activities: {}, npcDomains: {} };
      _npcDomains = _progression.npcDomains;
      placeNPCs();
      coffeeUses = 3;
      libraryProgress = {}; minigameScores = {}; currentMinigame = null;  // #028 — fresh character starts clean
      save();
      state = "overworld"; bufferedDir = null; turnStartMs = null;
      showToast("Beat every colleague to become a Claude Certified Architect!", 3500);
    }
  } else if (state === "overworld") {
    if (scout) return;                                  // camera pan cinematic — ignore input
    if (coffeePrompt) {
      if (k === "ArrowLeft" || k === "ArrowRight" || k === "a" || k === "d" || k === "A" || k === "D") {
        coffeePrompt.sel ^= 1; sfx.select();
      } else if (k === "Escape") {
        coffeePrompt = null; sfx.select();
      } else if (k === "Enter" || k === " ") {
        const yes = coffeePrompt.sel === 0;
        coffeePrompt = null;
        if (yes) drinkCoffee(); else sfx.select();
      }
      return;
    }
    // Book picker — intercepts BEFORE interact() can re-fire
    if (bookPrompt) {
      const books = bookPrompt.books, n = books.length;
      if (k === "ArrowUp" || k === "w" || k === "W") { bookPrompt.sel = (bookPrompt.sel - 1 + n) % n; sfx.select(); }
      else if (k === "ArrowDown" || k === "s" || k === "S") { bookPrompt.sel = (bookPrompt.sel + 1) % n; sfx.select(); }
      else if (k === "Enter" || k === " ") {
        const book = books[bookPrompt.sel];
        bookPrompt = null;
        readerState = { book, page: 0, screens: buildReaderScreens(book), maxPage: 0 };
        readerState.maxPage = readerState.screens.length - 1;
      } else if (k === "Escape") { bookPrompt = null; sfx.select(); }
      return;
    }
    // Full-canvas reader — intercepts BEFORE interact()
    if (readerState) {
      if (k === "ArrowLeft" || k === "a" || k === "A") { readerState.page = Math.max(0, readerState.page - 1); sfx.select(); }
      else if (k === "ArrowRight" || k === "d" || k === "D") { readerState.page = Math.min(readerState.maxPage, readerState.page + 1); sfx.select(); }
      else if (k === "Escape") { closeReader(); sfx.select(); }
      return;
    }
    if (k === "/" || k === "f" || k === "F") { if (currentMap === "office") openSearch(); return; }
    if (k === " " || k === "Enter" || k === "e" || k === "E") interact();
  } else if (state === "battle") {
    const b = battle;
    if (b.agentOps) {
      _agentHandleKey(b, k);
    } else if (b.phase === "question") {
      if (k === "ArrowRight" || k === "ArrowDown") { b.sel = (b.sel + 1) % 4; sfx.select(); }
      if (k === "ArrowLeft" || k === "ArrowUp")    { b.sel = (b.sel + 3) % 4; sfx.select(); }
      if (["1", "2", "3", "4"].includes(k)) answerQuestion(parseInt(k) - 1);
      if (k === "Enter" || k === " ") answerQuestion(b.sel);
      if (k === "r" || k === "R" || k === "Escape") attemptRun();
    } else if (k === "Enter" || k === " ") {
      // first press finishes the typewriter text, second advances
      if (Math.floor((frame - b.msgAt + 1) * TEXT_SPEED()) < b.msg.length) {
        b.msgAt = frame - Math.ceil(b.msg.length / TEXT_SPEED());
      } else {
        sfx.confirm();
        advanceBattle();
      }
    }
  } else if (state === "victory") {
    if (k === "Enter" || k === " ") { state = "overworld"; bufferedDir = null; turnStartMs = null; }
  } else if (state === "minigame") {
    if (!currentMinigame) return;
    const ph = currentMinigame.phase;
    // Assembly success first shows the completed diagram; a key advances to the score screen.
    if (ph === "success") { currentMinigame.phase = "score"; sfx.select(); return; }
    // Terminal phases — any key returns to the library overworld with the final score.
    if (ph === "score" || ph === "gameover" || ph === "complete") {
      exitMinigame(currentMinigame.score); return;
    }
    if (k === "Escape") { exitMinigame(0); return; }
    if (ph === "intro") return;
    if (currentMinigame.type === "matching") handleMatchingKey(k);
    else if (currentMinigame.type === "cloze") handleClozeKey(k);
    else if (currentMinigame.type === "assembly") handleAssemblyKey(k);
    else if (currentMinigame.type === "timed") handleTimedKey(k);
  }
}

function recomputeSearch() {
  const q = searchQuery.trim().toLowerCase();
  searchResults = ROSTER.filter(s => s !== player.slug && (!q || displayName(s).toLowerCase().includes(q)));
  searchSel = 0;
}
function openSearch() { state = "search"; searchQuery = ""; recomputeSearch(); sfx.select(); }
function handleSearchKey(e) {
  const k = e.key;
  if (k === "Escape") { state = "overworld"; sfx.select(); return; }
  if (k === "Enter") {
    const slug = searchResults[searchSel];
    const npc = slug && npcs.find(n => n.slug === slug);
    if (npc) { scout = { npc, phase: "out", until: 0 }; state = "overworld"; sfx.confirm(); }
    else sfx.wrong();
    return;
  }
  if (!searchResults.length) { if (k === "Backspace") { searchQuery = searchQuery.slice(0, -1); recomputeSearch(); } else if (k.length === 1 && /[A-Za-z .'-]/.test(k)) { searchQuery += k; recomputeSearch(); } return; }
  if (k === "ArrowDown") { searchSel = (searchSel + 1) % searchResults.length; sfx.select(); return; }
  if (k === "ArrowUp")   { searchSel = (searchSel + searchResults.length - 1) % searchResults.length; sfx.select(); return; }
  if (k === "Backspace") { searchQuery = searchQuery.slice(0, -1); recomputeSearch(); return; }
  if (k.length === 1 && /[A-Za-z .'-]/.test(k)) { searchQuery += k; recomputeSearch(); }
}

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * (CANVAS_W / r.width),
          (e.clientY - r.top) * (CANVAS_H / r.height)];
}

function pointerDirection(mx, my) {
  if (camFx === null || camFy === null) return null;
  const playerSx = (player.fx - camFx) * TILE + TILE / 2;
  const playerSy = (player.fy - camFy) * TILE + TILE / 2;
  const dx = mx - playerSx, dy = my - playerSy;
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return null;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
}

function releasePointerMovement(pointerId) {
  if (pointerMoveId !== pointerId) return;
  if (bufferedDir === pointerMoveDir) bufferedDir = null;
  pointerMoveId = null;
  pointerMoveDir = null;
}

canvas.addEventListener("mousemove", e => {
  const [mx, my] = canvasPos(e);
  if (state === "select") {
    const hit = selectHitTest(mx, my);
    if (hit >= 0) setSelect(hit, true); // hover browses silently
    return;
  }
  if (state === "battle" && battle && battle.agentOps && typeof AgentArena !== "undefined") {
    const phase = battle.agentOps.phase;
    if (phase === "action") AgentArena.setHover("action", _agentActionHitTest(mx, my), false);
    else if (phase === "choice") AgentArena.setHover("choice", _agentChoiceHitTest(mx, my), false);
    else AgentArena.setHover(null, -1, false);
  }
});
canvas.addEventListener("mouseleave", () => {
  if (typeof AgentArena !== "undefined") AgentArena.setHover(null, -1, false);
});

// Agent pointer input is handled on pointerdown and latched until pointerup. The
// later synthetic click is swallowed below, so one physical press dispatches at
// most one reducer event even when that event changes the interactive phase.
const activeAgentPointers = new Set();
canvas.addEventListener("pointerdown", e => {
  try { canvas.focus({ preventScroll: true }); } catch (_) { canvas.focus(); }
  if (typeof AgentArena !== "undefined") AgentArena.unlockAudio();
  if (typeof DatamonMusic !== "undefined") DatamonMusic.unlock();
  if (state === "overworld" && !coffeePrompt && !bookPrompt && !readerState && !scout) {
    const [mx, my] = canvasPos(e);
    const dir = pointerDirection(mx, my);
    if (dir) {
      pointerMoveId = e.pointerId;
      pointerMoveDir = dir;
      player.dir = dir;
      if (player.moving) bufferedDir = dir;
      else tryStep(dir); // a click steps once; holding continues in updateOverworld()
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    }
    return;
  }
  if (state !== "battle" || !battle || !battle.agentOps) return;
  if (activeAgentPointers.has(e.pointerId)) return;
  activeAgentPointers.add(e.pointerId);
  e.preventDefault();
  const [mx, my] = canvasPos(e);
  const b = battle;
  const phase = b.agentOps.phase;
  if (phase === "action") {
    if (_agentRunHitTest(mx, my)) attemptRun();
    else {
      const actionIndex = _agentActionHitTest(mx, my);
      if (typeof AgentArena !== "undefined") AgentArena.setHover("action", actionIndex, true);
      if (actionIndex >= 0) {
        b.agentOpsSel = actionIndex;
        _agentSelectAction(b, DatamonBattleOps.ACTION_KEYS[actionIndex]);
      }
    }
  } else if (phase === "choice") {
    if (_agentRunHitTest(mx, my)) attemptRun();
    else {
      const choiceIndex = _agentChoiceHitTest(mx, my);
      if (typeof AgentArena !== "undefined") AgentArena.setHover("choice", choiceIndex, true);
      if (choiceIndex >= 0) answerQuestion(choiceIndex);
    }
  } else {
    _agentHandleKey(b, "Enter");
  }
});
window.addEventListener("pointerup", e => {
  releasePointerMovement(e.pointerId);
  activeAgentPointers.delete(e.pointerId);
  if (typeof AgentArena !== "undefined") AgentArena.setHover(null, -1, false);
});
window.addEventListener("pointercancel", e => {
  releasePointerMovement(e.pointerId);
  activeAgentPointers.delete(e.pointerId);
  if (typeof AgentArena !== "undefined") AgentArena.setHover(null, -1, false);
});
window.addEventListener("blur", () => {
  pointerMoveId = null; pointerMoveDir = null;
  activeAgentPointers.clear();
});

canvas.addEventListener("click", e => {
  const [mx, my] = canvasPos(e);
  if (bookPrompt || readerState) return; // swallow clicks behind book modal (keyboard-only UI)
  if (coffeePrompt && coffeePrompt.btns) {
    const hit = coffeePrompt.btns.findIndex(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
    if (hit >= 0) { coffeePrompt.sel = hit; handleKey("Enter"); }
    return;
  }
  if (state === "title") handleKey("Enter");
  else if (state === "select") {
    const diffHit = difficultyHitTest(mx, my);
    if (diffHit) { if (diffHit !== difficulty) { difficulty = diffHit; sfx.select(); } return; }
    const hit = selectHitTest(mx, my);
    if (hit >= 0) { setSelect(hit, true); handleKey("Enter"); }
  } else if (state === "battle") {
    const b = battle;
    if (b.agentOps) {
      return; // pointerdown already consumed this physical Agent activation
    } else if (b.phase === "question") {
      if (runHitTest(mx, my)) { attemptRun(); return; }
      const hit = choiceHitTest(mx, my);
      if (hit >= 0) answerQuestion(hit);
    } else handleKey("Enter");
  } else if (state === "victory") handleKey("Enter");
  else if (state === "minigame") {
    const mg = currentMinigame;
    if (!mg) return;
    const ph = mg.phase;
    if (ph === "success") { mg.phase = "score"; sfx.select(); return; }
    if (ph === "score" || ph === "gameover" || ph === "complete") {
      exitMinigame(mg.score); return;
    }
    if (mg.type === "assembly" && ph === "place" && mg._trayRects) {
      const hit = mg._trayRects.find(r => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
      if (hit) { mg.traySel = hit.idx; assemblyPlace(hit.idx); }
    } else if (mg.type === "timed" && ph === "question" && mg._optRects) {
      for (let i = 0; i < mg._optRects.length; i++) {
        const [ox, oy, ow, oh] = mg._optRects[i];
        if (mx >= ox && mx <= ox + ow && my >= oy && my <= oy + oh) { mg.sel = i; timedAnswer(i); break; }
      }
    }
  }
});

// ---------- Overworld logic ----------
function walkable(x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  if (SOLID.has(map[y][x])) return false;
  if (npcs.some(n => n.x === x && n.y === y)) return false;
  return true;
}

function facingTile() {
  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[player.dir];
  return [player.x + d[0], player.y + d[1]];
}

function interact() {
  const [tx, ty] = facingTile();
  const npc = npcs.find(n => n.x === tx && n.y === ty);
  if (npc) {
    if (npc.defeated) showToast(`${firstName(npc.slug)}: "Good battle earlier. Back to my Jira board..."`);
    else if (npc.type === "AGENT" && typeof AgentArena !== "undefined" && AgentArena.prefersReducedMotion()) {
      // Reduced motion skips the triple flash/iris hit-stop entirely.
      sfx.battle();
      startBattle(npc);
    } else { battleTransition = { npc, t: 0 }; state = "transition"; sfx.battle(); }
    return;
  }
  if (map[ty] && map[ty][tx] === "C") {
    if (coffeeUses > 0) {
      coffeePrompt = { sel: 1 };   // ask first (default No) so mashing the key can't drain uses
      sfx.select();
    } else {
      showToast("The machine's out of beans — no uses left!");
    }
  }
  if (map[ty] && map[ty][tx] === "D") showToast("A standing desk. Someone left 47 Chrome tabs open.");
  if (map[ty] && map[ty][tx] === "P") showToast("An office plant. It has seen things.");
  if (map[ty] && map[ty][tx] === "L") { warpToggle(); return; }
  if (map[ty] && map[ty][tx] === "B") { openBookPicker(); return; }                          // book reader — ticket #027
  if (map[ty] && map[ty][tx] === "S") {                                                       // study station → minigame (#028)
    const st = STUDY_STATIONS[`${tx},${ty}`];
    if (st) launchMinigame(st.type, st.id, st.label);
    else showToast("Study station: coming soon.");
    return;
  }
}

// ---------- Library warp (#026/#044) ----------
// Boot keeps only the manifest + shared door resident. The first interaction starts one
// deduplicated load/build Promise and that same interaction commits exactly one warp.
var libraryLoadPromise = null;
var libraryWarpRequested = false;
function ensureLibraryLoaded() {
  if (libraryMapCv) return Promise.resolve(libraryMapCv);
  if (libraryLoadPromise) return libraryLoadPromise;
  libraryLoadPromise = Promise.all([
    Promise.all(libManifest.filter(function(m) { return m.slug !== "lib-door"; }).map(function(m) {
      return loadOne("library/assets/" + m.file, libStore, m.slug);
    })),
    loadBooks(), loadPairs(), loadCloze(), loadDiagrams(),
    (typeof DatamonWorldArt !== "undefined") ? DatamonWorldArt.loadScene("library") : Promise.resolve([]),
  ]).catch(function() {
    // Every individual loader already resolves to a drawn/data fallback. This final guard
    // handles an unexpected aggregate failure and still builds a usable fallback cache.
    return [];
  }).then(function() {
    if (!libraryMapCv) libraryMapCv = buildLibraryMapCanvas();
    return libraryMapCv;
  });
  return libraryLoadPromise;
}

function commitLibraryWarp() {
  if (currentMap !== "office" || !libraryMapCv) return;
  currentMap = "library"; map = LIBRARY_MAP; mapCv = libraryMapCv;
  officeNpcs = npcs; npcs = [];
  player.x = player.fx = LIBRARY_ENTRY[0]; player.y = player.fy = LIBRARY_ENTRY[1];
  player.dir = "up";
  libraryWarpRequested = false;
  if (typeof DatamonWorldArt !== "undefined") DatamonWorldArt.activateScene("library");
  showToast("Entered the library.");
  camFx = camFy = null; bufferedDir = null; turnStartMs = null;
}

function warpToggle() {
  player.moving = false; stepT = 1;
  coffeePrompt = null; scout = null;
  bookPrompt = null; readerState = null;
  if (currentMap === "office") {
    if (libraryMapCv) {
      commitLibraryWarp();
      return;
    }
    libraryWarpRequested = true;
    showToast(libraryLoadPromise ? "Library loading..." : "Opening library...");
    ensureLibraryLoaded().then(function() {
      if (libraryWarpRequested && currentMap === "office") commitLibraryWarp();
    });
    return;
  }

  libraryWarpRequested = false;
  currentMap = "office"; map = OFFICE_MAP; mapCv = officeMapCv;
  npcs = officeNpcs;
  player.x = player.fx = OFFICE_ENTRY[0]; player.y = player.fy = OFFICE_ENTRY[1];
  player.dir = "up";
  if (typeof DatamonWorldArt !== "undefined") DatamonWorldArt.activateScene("office");
  showToast("Back to the office.");
  camFx = camFy = null; bufferedDir = null; turnStartMs = null;
}

function drinkCoffee() {
  if (coffeeUses <= 0) return;
  coffeeUses--;
  player.hp = MAX_HP;
  save();   // persist immediately so a reload can't refill the machine
  sfx.confirm();
  showToast(`Fresh coffee — HP restored! ${coffeeUses} ${coffeeUses === 1 ? "use" : "uses"} left.`);
}

const TAP_TURN_MS = 80;
const KEY_DIR = {
  ArrowUp: "up", w: "up", W: "up", KeyW: "up",
  ArrowDown: "down", s: "down", S: "down", KeyS: "down",
  ArrowLeft: "left", a: "left", A: "left", KeyA: "left",
  ArrowRight: "right", d: "right", D: "right", KeyD: "right",
};
let turnStartMs = null;  // wall-clock when tap-to-turn window opened; null when closed
let bufferedDir = null;  // direction pressed mid-slide; consumed at slide end
let pointerMoveId = null, pointerMoveDir = null; // click steps once; pointer hold walks continuously
function updateOverworld(dt) {
  // Footfall dust: drift + age every particle, then prune the dead ones. Runs every frame
  // (moving OR idle) so the array is always bounded — idle simply spawns nothing below.
  for (const d of dustParticles) { d.x += d.dx; d.y += d.dy; d.life--; }
  if (dustParticles.length) dustParticles = dustParticles.filter(d => d.life > 0);

  if (coffeePrompt) return;   // modal coffee dialog open — freeze movement input
  if (bookPrompt) return;     // book picker open — freeze movement input
  if (readerState) return;    // book reader open — freeze movement input
  if (scout) return;          // search pan-to-person cinematic — freeze movement

  const WALK_SPEED = 7.5, RUN_SPEED = 12.5; // tiles/sec
  player.running = !!(keys["r"] || keys["R"] || keys["KeyR"] ||
    keys["Shift"] || keys["ShiftLeft"] || keys["ShiftRight"]);
  if (player.moving) {
    const speed = player.running ? RUN_SPEED : WALK_SPEED;
    stepT = Math.min(1, stepT + speed * dt);              // speed=7.5/12.5 → walk/run cadence
    const e = stepT * stepT * (3 - 2 * stepT);            // smoothstep ease-in/out
    const prevGait = gaitPhase;                           // remember phase before advancing
    gaitPhase += Math.abs(e - prevE) * Math.PI * 2;       // physical effects track eased travel
    walkAnimPhase += dt * (player.running ? RUN_ANIM_FPS : WALK_ANIM_FPS);
    prevE = e;
    // Footfall contact = descending zero-crossing of sin(2*phase) (two per gait cycle = L/R
    // foot). Spawn a small dust burst there: 2 walking, 4 running. World-space, near the feet.
    if (Math.sin(2 * prevGait) > 0 && Math.sin(2 * gaitPhase) <= 0) {
      const count = player.running ? 4 : 2;
      for (let i = 0; i < count; i++) {
        dustParticles.push({
          x: player.fx + (Math.random() - 0.5) * 0.25,   // jitter around feet (tiles)
          y: player.fy + 0.34,                           // just below sprite centre
          dx: (Math.random() - 0.5) * 0.018,             // outward drift
          dy: -0.022 - Math.random() * 0.012,            // upward drift
          life: 12 + Math.floor(Math.random() * 3),      // 12–14 frames (~0.2s @ 60fps)
          maxLife: 14,
        });
      }
    }
    player.fx = stepStartFx + (player.x - stepStartFx) * e;
    player.fy = stepStartFy + (player.y - stepStartFy) * e;
    if (stepT >= 1) {
      player.fx = player.x; player.fy = player.y; player.moving = false;
      if (bufferedDir) consumeBuffered();
    }
    return;
  }
  gaitPhase = 0; walkAnimPhase = 0; prevE = 0;
  let dir = null;
  if (dirHeld("up")) dir = "up";
  else if (dirHeld("down")) dir = "down";
  else if (dirHeld("left")) dir = "left";
  else if (dirHeld("right")) dir = "right";
  else if (pointerMoveDir) dir = pointerMoveDir;
  if (!dir) { turnStartMs = null; return; }
  if (dir !== player.dir) { player.dir = dir; turnStartMs = performance.now(); return; }
  // tap window open: released before TAP_TURN_MS means turn-only
  if (turnStartMs !== null && performance.now() - turnStartMs < TAP_TURN_MS) return;
  turnStartMs = null;
  tryStep(dir);
}
function dirHeld(dir) {
  for (const k in KEY_DIR) if (KEY_DIR[k] === dir && keys[k]) return true;
  return false;
}
function tryStep(dir) {
  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  const nx = player.x + d[0], ny = player.y + d[1];
  if (walkable(nx, ny)) {
    stepStartFx = player.fx; stepStartFy = player.fy; stepT = 0; prevE = 0;   // begin eased step
    player.x = nx; player.y = ny; player.moving = true;
    if (state === "overworld") sfx.move();
  }
}
function consumeBuffered() {
  const dir = bufferedDir, wasFacing = player.dir;
  bufferedDir = null; turnStartMs = null;
  player.dir = dir;
  if (dir !== wasFacing && !dirHeld(dir)) return; // tap during slide → turn-only at stop
  tryStep(dir);
}

// ---------- Drawing helpers ----------
function px(n) { return Math.round(n); }

function wrapText(text, maxW, font) {
  ctx.font = font;
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function wrapTextMemo(text, maxW, font) {
  const key = font + "|" + maxW + "|" + text;
  if (wrapCache.has(key)) { ctx.font = font; return wrapCache.get(key); }
  const lines = wrapText(text, maxW, font); // wrapText sets ctx.font itself
  wrapCache.set(key, lines);
  return lines;
}

// ---------- Book reader helpers (#027) ----------

// Strip Markdown tokens from a line (headers, bold, inline code).
// doTrim=true for normal text lines; false for fallback_text (ASCII art must keep indentation).
function sanitizeBookText(line, doTrim) {
  let s = line.replace(/^#{1,3}\s*/, "").replace(/\*\*/g, "").replace(/`/g, "");
  return doTrim ? s.trim() : s;
}

// Wrap a single sanitized line to body pixel width, then hard-chop any run-on segments
// (e.g. long URLs with no spaces). Returns array of display strings.
function wrapAndChop(line, bodyW, font) {
  const wrapped = wrapText(line, bodyW, font);
  const result = [];
  for (const seg of wrapped) {
    ctx.font = font;
    if (ctx.measureText(seg).width <= bodyW) {
      result.push(seg);
    } else {
      // Hard char-chop: slice chars until each piece fits.
      let rem = seg;
      while (rem.length > 0) {
        let cut = rem.length;
        while (cut > 1 && ctx.measureText(rem.slice(0, cut)).width > bodyW) cut--;
        result.push(rem.slice(0, cut));
        rem = rem.slice(cut);
      }
    }
  }
  return result.length > 0 ? result : [""];
}

// Build the array of screen-pages for the reader. Called once on book open.
// Returns an array of {kind:"text", lines:[...]} or {kind:"sprite", slug} objects.
function buildReaderScreens(book) {
  const READER_W = 720, READER_H = 560;
  const PAD = 32;
  const bodyW = READER_W - PAD * 2;
  const headerH = 44; // title bar height
  const footerH = 32; // footer bar height
  const lineH = 18;
  const font = "12px monospace";
  const maxBodyLines = Math.floor((READER_H - headerH - footerH) / lineH);

  const screens = [];
  for (const page of (book.pages || [])) {
    if (page.type === "diagram_anchor") {
      if (libStore[page.slug]) {
        // Sprite available — one atomic screen
        screens.push({ kind: "sprite", slug: page.slug });
      } else {
        // Fallback: ASCII box art — preserve indentation, no trim
        const rawLines = (page.fallback_text || "").split("\n");
        const displayLines = [];
        for (const raw of rawLines) {
          const sanitized = sanitizeBookText(raw, false);
          for (const dl of wrapAndChop(sanitized, bodyW, font)) displayLines.push(dl);
        }
        // Chunk into screens
        for (let i = 0; i < displayLines.length; i += maxBodyLines) {
          screens.push({ kind: "text", lines: displayLines.slice(i, i + maxBodyLines) });
        }
      }
    } else {
      // text page
      const displayLines = [];
      for (const raw of (page.lines || [])) {
        const sanitized = sanitizeBookText(raw, true);
        if (sanitized === "") { displayLines.push(""); continue; }
        for (const dl of wrapAndChop(sanitized, bodyW, font)) displayLines.push(dl);
      }
      // Chunk into screens
      for (let i = 0; i < displayLines.length; i += maxBodyLines) {
        screens.push({ kind: "text", lines: displayLines.slice(i, i + maxBodyLines) });
      }
    }
  }
  // Guarantee at least one screen so reader never has zero pages
  if (screens.length === 0) screens.push({ kind: "text", lines: ["(No content.)"] });
  return screens;
}

// Open the book-picker modal. Guard against missing books (shows toast instead of blank overlay).
function openBookPicker() {
  if (state !== "overworld" || coffeePrompt || readerState) return;
  if (!loadedBooks.length) { showToast("No books available."); return; }
  bookPrompt = { sel: 0, books: loadedBooks };
}

// Close the reader and fully reset movement state (mirrors warpToggle's pattern).
function closeReader() {
  readerState = null;
  bookPrompt = null;
  player.moving = false;
  stepT = 1;
  player.fx = player.x;
  player.fy = player.y;
  bufferedDir = null;
  turnStartMs = null;
}

// ---------- Library minigame harness (#028) ----------
// Shared entry/exit for the 4 study-station minigames. Tickets G (#029) and H (#030) plug their
// gameplay into the "minigame" state (read currentMinigame.type/phase); this file only provides
// the harness: enter, scaffold scoring, and clean return-to-overworld.
function launchMinigame(type, stationId, label) {
  // Mid-slide guard (NOTES.md line 12) — resolve any pending step BEFORE entering the minigame,
  // matching closeReader's full canonical reset so the player can't ghost-step on exit.
  player.moving = false;
  stepT = 1;
  player.fx = player.x;
  player.fy = player.y;
  bufferedDir = null;
  turnStartMs = null;
  toast = null;                 // clear any lingering toast so it can't paint over the minigame
  currentMinigame = { type, stationId, label: label || "Study Station", score: 0, phase: "intro" };
  state = "minigame";
  sfx.select();
}

// Return to the library overworld. NOTE: there is no "library" state — the library is
// state==="overworld" with currentMap==="library", so we return to "overworld" (currentMap is
// already "library" and is left untouched). score: higher is better; 0 = not attempted.
function exitMinigame(score = 0) {
  if (currentMinigame) {
    const sid = currentMinigame.stationId;
    const s = typeof score === "number" ? score : (currentMinigame.score || 0);
    minigameScores[sid] = Math.max(minigameScores[sid] || 0, s || 0);  // best score per station
  }
  currentMinigame = null;
  state = "overworld";
  player.moving = false;
  stepT = 1;
  player.fx = player.x;
  player.fy = player.y;
  bufferedDir = null;
  turnStartMs = null;
  save();
}

// ---------- Library minigame gameplay (#029) ----------

// Build distractor options for a cloze item. Returns 4-element shuffled array [correct, ...distractors].
function buildClozeOptions(item) {
  const correct = item.answer;
  const norm = s => String(s).trim().toLowerCase();
  const normCorrect = norm(correct);
  // Prefer same-domain distractors; fall back to all others
  const candidates = shuffled([
    ...loadedCloze.filter(c => c.id !== item.id && c.domain === item.domain).map(c => c.answer),
    ...loadedCloze.filter(c => c.id !== item.id && c.domain !== item.domain).map(c => c.answer),
  ], Math.random);
  const distractors = [];
  const seen = new Set([normCorrect]);
  for (const cand of candidates) {
    if (distractors.length >= 3) break;
    const nc = norm(cand);
    if (seen.has(nc)) continue;
    seen.add(nc);
    distractors.push(cand);
  }
  // Pad if still short (last resort)
  while (distractors.length < 3) distractors.push(`Option ${distractors.length + 2}`);
  return shuffled([correct, ...distractors], Math.random);
}

// Initialize the current minigame (called once when phase==="intro").
// Mutates currentMinigame IN PLACE via Object.assign — never reassigns the local reference.
function initMinigame() {
  if (!currentMinigame || currentMinigame.phase !== "intro") return;
  const mg = currentMinigame;
  if (mg.type === "matching") {
    // Dedupe by term (keep first occurrence), then filter valid
    const seen = new Set();
    const pool = loadedPairs.filter(p => {
      if (!p || !p.term || !p.definition) return false;
      const t = p.term;
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
    if (pool.length === 0) { showToast("Content unavailable"); exitMinigame(0); return; }
    const board = shuffled(pool, Math.random).slice(0, Math.min(6, pool.length));
    const defOrder = shuffled(board.map((_, i) => i), Math.random);
    Object.assign(mg, {
      board, defOrder, total: board.length,
      matched: [], leftSel: 0, rightSel: 0, feedback: null,
      phase: "select_term", score: 0,
    });
  } else if (mg.type === "cloze") {
    const pool = loadedCloze.filter(c => c && c.template && c.answer);
    if (pool.length === 0) { showToast("Content unavailable"); exitMinigame(0); return; }
    const queue = shuffled(pool, Math.random).slice(0, Math.min(8, pool.length));
    queue.forEach(it => { it._opts = buildClozeOptions(it); });
    Object.assign(mg, {
      queue, total: queue.length, idx: 0, sel: 0, correct: 0,
      feedback: null, phase: "question", score: 0,
    });
  } else if (mg.type === "assembly") {
    // Diagram Assembly (#030): place piece sprites/boxes into the correct ordered layout.
    const pool = loadedDiagrams.filter(d =>
      d && Array.isArray(d.pieces) && d.pieces.length > 0 && Array.isArray(d.correct_layout) && d.correct_layout.length > 0);
    if (pool.length === 0) { showToast("Content unavailable"); exitMinigame(0); return; }
    const diagram = pool[Math.floor(Math.random() * pool.length)];
    const byId = {};
    for (const p of diagram.pieces) byId[p.id] = p;
    // Target slots follow correct_layout order; only include pieces that actually exist.
    const layout = diagram.correct_layout.filter(id => byId[id]);
    // Guard a malformed diagram whose layout IDs don't match any piece (avoids a 0/0 round).
    if (layout.length === 0) { showToast("Content unavailable"); exitMinigame(0); return; }
    const tray = shuffled(layout.map(id => byId[id]), Math.random);
    Object.assign(mg, {
      diagram, layout, byId,
      slots: layout.map(() => null),   // slot i expects piece layout[i]
      tray,                            // remaining unplaced pieces (shuffled)
      traySel: 0, placed: 0, mistakes: 0, total: layout.length,
      feedback: null, phase: "place", score: 0,
      title: diagram.title || "Diagram", root: diagram.root || "",
    });
  } else if (mg.type === "timed") {
    // Timed Recall/Boss (#030): rapid-fire MCQ from the in-page exam bank (QUESTION_BANK,
    // questions.js — the same content battles use, re-tagged by #014). quiz/bank/*.json is
    // outside the datamon web root so it cannot be fetched in deployment; QUESTION_BANK is the
    // robust in-page projection of it. Missing/empty → graceful "No questions available".
    const bank = (typeof QUESTION_BANK !== "undefined" && QUESTION_BANK) ? QUESTION_BANK : null;
    const DOMAIN_NAMES = {
      AGENT: "Agentic Architecture", MCP: "Tool Design & MCP", CONFIG: "Claude Code Config",
      PROMPT: "Prompt Engineering", CONTEXT: "Context & Reliability",
    };
    const cats = bank ? Object.keys(DOMAIN_NAMES).filter(c => Array.isArray(bank[c]) && bank[c].length) : [];
    if (!bank || cats.length === 0) { showToast("No questions available"); exitMinigame(0); return; }
    const TARGET = 10;
    const norm = (q, cat) => ({ stem: q.q, opts: q.c.slice(0, 4), answerIdx: q.a, domainName: DOMAIN_NAMES[cat] });
    // Pick a focus domain (boss feel); top up from other domains if it has < TARGET.
    const focus = cats[Math.floor(Math.random() * cats.length)];
    let queue = shuffled(bank[focus], Math.random).slice(0, TARGET).map(q => norm(q, focus));
    if (queue.length < TARGET) {
      const rest = shuffled(cats.filter(c => c !== focus).flatMap(c => bank[c].map(q => norm(q, c))), Math.random);
      queue = queue.concat(rest.slice(0, TARGET - queue.length));
    }
    Object.assign(mg, {
      queue, total: queue.length, idx: 0, sel: 0, correct: 0,
      feedback: null, phase: "question", score: 0,
      domainName: DOMAIN_NAMES[focus], timerEnd: Date.now() + TIMED_RECALL_MS,
    });
  }
}

// Frame-based feedback expiry
function advanceMatching() {
  const mg = currentMinigame;
  mg.feedback = null;
  if (mg.matched.length >= mg.total) {
    mg.score = Math.round(mg.matched.length / mg.total * 100);
    mg.phase = "score";
  } else {
    mg.leftSel = 0; mg.rightSel = 0;
    // skip past any already-matched rows so the cursor starts on an unmatched term
    let t = 0; while (mg.matched.includes(mg.board[mg.leftSel].id) && t <= mg.board.length) { mg.leftSel = (mg.leftSel + 1) % mg.board.length; t++; }
    mg.phase = "select_term";
  }
}

function advanceCloze() {
  const mg = currentMinigame;
  mg.feedback = null;
  mg.idx++;
  if (mg.idx >= mg.total) {
    mg.score = Math.round(mg.correct / mg.total * 100);
    mg.phase = "score";
  } else {
    mg.sel = 0;
    mg.phase = "question";
  }
}

// Timed Recall (#030): advance to the next question, or end on completion.
function advanceTimed() {
  const mg = currentMinigame;
  mg.feedback = null;
  mg.idx++;
  if (mg.idx >= mg.total) {
    mg.score = mg.correct;           // score = number correct (0..total)
    mg.phase = "complete";           // finished before time ran out
  } else {
    mg.sel = 0;
    mg.phase = "question";
  }
}

// Per-frame update for active minigame
function updateMinigame() {
  const mg = currentMinigame;
  if (!mg) return;
  if (mg.type === "cloze" && mg.phase === "feedback" && mg.feedback && frame >= mg.feedback.until) advanceCloze();
  if (mg.type === "matching" && mg.phase === "feedback" && mg.feedback && frame >= mg.feedback.until) advanceMatching();
  if (mg.type === "assembly" && mg.phase === "feedback" && mg.feedback && frame >= mg.feedback.until) {
    mg.feedback = null;
    if (mg.placed >= mg.total) {
      // Score rewards an efficient (mistake-free) assembly: 100% with no wrong attempts.
      mg.score = Math.round(mg.total / (mg.total + mg.mistakes) * 100);
      mg.phase = "success";
    } else {
      mg.phase = "place";
    }
  }
  if (mg.type === "timed") {
    // Wall-clock countdown (Date.now() delta) — interrupts question OR feedback the instant it hits 0.
    if ((mg.phase === "question" || mg.phase === "feedback") && Date.now() >= mg.timerEnd) {
      mg.feedback = null;
      mg.score = mg.correct;
      mg.phase = "gameover";         // ran out of time
    } else if (mg.phase === "feedback" && mg.feedback && frame >= mg.feedback.until) {
      advanceTimed();
    }
  }
}

// ---------- Matching gameplay ----------

function handleMatchingKey(k) {
  const mg = currentMinigame;
  if (!mg) return;
  if (mg.phase === "feedback") return;
  const { board, defOrder, matched } = mg;
  const n = board.length;
  const leftMatched  = (i) => matched.includes(board[i].id);
  const rightMatched = (i) => matched.includes(board[defOrder[i]].id);
  const stepLeft  = (d) => { let i = mg.leftSel,  t = 0; do { i = (i + d + n) % n; t++; } while (leftMatched(i)  && t <= n); mg.leftSel  = i; sfx.select(); };
  const stepRight = (d) => { let i = mg.rightSel, t = 0; do { i = (i + d + n) % n; t++; } while (rightMatched(i) && t <= n); mg.rightSel = i; sfx.select(); };
  if (mg.phase === "select_term") {
    if (k === "ArrowUp") stepLeft(-1);
    else if (k === "ArrowDown") stepLeft(1);
    else if (k === "Enter" || k === " ") {
      if (leftMatched(mg.leftSel)) { sfx.select(); return; }
      mg.phase = "select_def";
      // land rightSel on the first unmatched definition row
      mg.rightSel = 0; let t = 0; while (rightMatched(mg.rightSel) && t <= n) { mg.rightSel = (mg.rightSel + 1) % n; t++; }
      sfx.select();
    }
  } else if (mg.phase === "select_def") {
    if (k === "ArrowUp") stepRight(-1);
    else if (k === "ArrowDown") stepRight(1);
    else if (k === "Enter" || k === " ") {
      const defItem = board[defOrder[mg.rightSel]];
      if (matched.includes(defItem.id)) { sfx.select(); return; }
      const correct = board[mg.leftSel].id === defItem.id;
      if (correct) {
        mg.matched.push(board[mg.leftSel].id);
        mg.score = Math.round(mg.matched.length / mg.total * 100);
        sfx.confirm();
      } else { sfx.select(); }
      mg.feedback = { correct, termIdx: mg.leftSel, defRow: mg.rightSel, until: frame + 90 };
      mg.phase = "feedback";
    }
  }
}

function drawMatching() {
  const mg = currentMinigame;
  if (!mg) return;
  const { board, defOrder, matched, leftSel, rightSel, feedback, phase } = mg;
  const RW = 720, RH = 560;
  const rx = (CANVAS_W - RW) / 2, ry = (CANVAS_H - RH) / 2;
  const n = board.length;
  const colW = 310, rowH = 52, startY = ry + 80;
  const leftX = rx + 20, rightX = rx + RW - colW - 20;

  // Title
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#facc15"; ctx.font = "bold 15px monospace";
  ctx.fillText("Matching Pairs", CANVAS_W / 2, ry + 28);
  ctx.fillStyle = "#94a3b8"; ctx.font = "12px monospace";
  ctx.fillText(`${matched.length} / ${mg.total} matched`, CANVAS_W / 2, ry + 48);

  // Column headers
  ctx.fillStyle = "#64748b"; ctx.font = "bold 11px monospace";
  ctx.textAlign = "left";
  ctx.fillText("TERM", leftX + 8, startY - 10);
  ctx.fillText("DEFINITION", rightX + 8, startY - 10);

  for (let i = 0; i < n; i++) {
    const rowY = startY + i * rowH;
    const termId = board[i].id;
    const isMatchedTerm = matched.includes(termId);

    // Left column (terms)
    let leftBg = "rgba(30,41,59,0.6)";
    let leftFg = "#e2e8f0";
    if (isMatchedTerm) { leftBg = "#14532d"; leftFg = "#22c55e"; }
    else if (phase === "select_term" && i === leftSel) { leftBg = "#facc15"; leftFg = "#0f172a"; }
    else if (phase === "select_def" && i === leftSel) { leftBg = "#facc15"; leftFg = "#0f172a"; }
    else if (phase === "feedback" && feedback && i === feedback.termIdx) {
      leftBg = feedback.correct ? "#14532d" : "#450a0a";
      leftFg = feedback.correct ? "#22c55e" : "#f87171";
    }

    ctx.fillStyle = leftBg;
    ctx.fillRect(leftX, rowY, colW, rowH - 4);
    if ((phase === "select_term" && i === leftSel && !isMatchedTerm) ||
        (phase === "select_def" && i === leftSel && !isMatchedTerm)) {
      ctx.strokeStyle = "#fde047"; ctx.lineWidth = 2;
      ctx.strokeRect(leftX, rowY, colW, rowH - 4);
    }
    ctx.fillStyle = leftFg; ctx.font = "bold 12px monospace"; ctx.textAlign = "left";
    const termLines = wrapTextMemo(board[i].term, colW - 16, "bold 12px monospace");
    const termDisplay = termLines.slice(0, 2);
    for (let li = 0; li < termDisplay.length; li++) {
      ctx.fillText(termDisplay[li], leftX + 8, rowY + 16 + li * 16);
    }

    // Right column (definitions — permuted by defOrder)
    const defItem = board[defOrder[i]];
    const isMatchedDef = matched.includes(defItem.id);
    let rightBg = "rgba(30,41,59,0.6)";
    let rightFg = "#e2e8f0";
    if (isMatchedDef) { rightBg = "#14532d"; rightFg = "#22c55e"; }
    else if (phase === "select_def" && i === rightSel) { rightBg = "#facc15"; rightFg = "#0f172a"; }
    else if (phase === "feedback" && feedback && i === feedback.defRow) {
      rightBg = feedback.correct ? "#14532d" : "#450a0a";
      rightFg = feedback.correct ? "#22c55e" : "#f87171";
    }

    ctx.fillStyle = rightBg;
    ctx.fillRect(rightX, rowY, colW, rowH - 4);
    if (phase === "select_def" && i === rightSel && !isMatchedDef) {
      ctx.strokeStyle = "#fde047"; ctx.lineWidth = 2;
      ctx.strokeRect(rightX, rowY, colW, rowH - 4);
    }
    ctx.fillStyle = rightFg; ctx.font = "12px monospace"; ctx.textAlign = "left";
    const defLines = wrapTextMemo(defItem.definition, colW - 16, "12px monospace");
    const defDisplay = defLines.slice(0, 2);
    for (let li = 0; li < defDisplay.length; li++) {
      ctx.fillText(defDisplay[li], rightX + 8, rowY + 16 + li * 16);
    }
  }

  // Bottom bar
  const barY = ry + RH - 30;
  ctx.fillStyle = "#94a3b8"; ctx.font = "11px monospace"; ctx.textAlign = "center";
  let hint = "";
  if (phase === "select_term") hint = "↑↓ select term   Enter confirm   Esc abort";
  else if (phase === "select_def") hint = "↑↓ select definition   Enter confirm   Esc abort";
  else if (phase === "feedback") hint = feedback && feedback.correct ? "✓ Correct!" : "✗ Wrong — try again";
  ctx.fillText(hint, CANVAS_W / 2, barY);
  ctx.fillStyle = "#facc15"; ctx.font = "bold 12px monospace";
  ctx.fillText(`Score: ${mg.score | 0}%`, CANVAS_W / 2, barY + 16);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

// ---------- Cloze gameplay ----------

function handleClozeKey(k) {
  const mg = currentMinigame;
  if (!mg || mg.phase !== "question") return;
  const item = mg.queue[mg.idx];
  if (k === "ArrowUp") { mg.sel = (mg.sel - 2 + 4) % 4; sfx.select(); }
  else if (k === "ArrowDown") { mg.sel = (mg.sel + 2) % 4; sfx.select(); }
  else if (k === "ArrowLeft") { mg.sel = (mg.sel % 2 === 0) ? mg.sel : mg.sel - 1; sfx.select(); }
  else if (k === "ArrowRight") { mg.sel = (mg.sel % 2 === 1) ? mg.sel : mg.sel + 1; sfx.select(); }
  else if (k === "1") { mg.sel = 0; sfx.select(); }
  else if (k === "2") { mg.sel = 1; sfx.select(); }
  else if (k === "3") { mg.sel = 2; sfx.select(); }
  else if (k === "4") { mg.sel = 3; sfx.select(); }
  else if (k === "Enter" || k === " ") {
    const chosen = item._opts[mg.sel];
    const correct = chosen === item.answer;
    const correctIdx = item._opts.indexOf(item.answer);
    if (correct) { mg.correct++; sfx.confirm(); } else { sfx.select(); }
    mg.feedback = { correct, chosenIdx: mg.sel, correctIdx, until: frame + 90 };
    mg.phase = "feedback";
  }
}

function drawCloze() {
  const mg = currentMinigame;
  if (!mg) return;
  const { queue, idx, sel, feedback, phase, correct: correctCount } = mg;
  const item = queue[idx];
  const RW = 720, RH = 560;
  const rx = (CANVAS_W - RW) / 2, ry = (CANVAS_H - RH) / 2;

  // Title
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#facc15"; ctx.font = "bold 15px monospace";
  ctx.fillText("Fill in the Blank", CANVAS_W / 2, ry + 28);
  ctx.fillStyle = "#94a3b8"; ctx.font = "12px monospace";
  ctx.fillText(`Question ${idx + 1} / ${mg.total}`, CANVAS_W / 2, ry + 48);

  // Prompt (template with ___)
  const promptMaxW = RW - 80;
  ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 14px monospace";
  const templateLines = wrapTextMemo(item.template, promptMaxW, "bold 14px monospace");
  const clampedLines = templateLines.slice(0, 5);
  const promptStartY = ry + 80;
  for (let i = 0; i < clampedLines.length; i++) {
    ctx.textAlign = "center";
    ctx.fillText(clampedLines[i], CANVAS_W / 2, promptStartY + i * 20);
  }

  // Hint (optional dim line) — wrapped + clamped to the prompt width so a long hint
  // (cloze hints are full sentences) can't render as one centered line that bleeds
  // off both screen edges past the panel border.
  if (item.hint) {
    ctx.fillStyle = "#64748b"; ctx.font = "11px monospace"; ctx.textAlign = "center";
    const hintY = promptStartY + clampedLines.length * 20 + 12;
    const hintLines = wrapTextMemo(`Hint: ${item.hint}`, promptMaxW, "11px monospace").slice(0, 2);
    for (let i = 0; i < hintLines.length; i++) ctx.fillText(hintLines[i], CANVAS_W / 2, hintY + i * 14);
  }

  // Option boxes in 2×2 grid
  const optW = 310, optH = 48;
  const optGapX = 20, optGapY = 12;
  const gridW = optW * 2 + optGapX;
  const gridStartX = (CANVAS_W - gridW) / 2;
  const gridStartY = ry + 200;
  const optPositions = [];
  for (let i = 0; i < 4; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    optPositions.push([gridStartX + col * (optW + optGapX), gridStartY + row * (optH + optGapY), optW, optH]);
  }

  for (let i = 0; i < 4; i++) {
    const [ox, oy, ow, oh] = optPositions[i];
    let bg = "rgba(30,41,59,0.6)";
    let fg = "#e2e8f0";
    if (phase === "feedback" && feedback) {
      if (i === feedback.correctIdx) { bg = "#14532d"; fg = "#22c55e"; }
      else if (i === feedback.chosenIdx && !feedback.correct) { bg = "#450a0a"; fg = "#f87171"; }
    } else if (i === sel) { bg = "#facc15"; fg = "#0f172a"; }

    ctx.fillStyle = bg; ctx.fillRect(ox, oy, ow, oh);
    if (i === sel && phase === "question") {
      ctx.strokeStyle = "#fde047"; ctx.lineWidth = 2; ctx.strokeRect(ox, oy, ow, oh);
    }
    ctx.fillStyle = fg; ctx.font = "bold 12px monospace"; ctx.textAlign = "left";
    const label = `${i + 1}. `;
    ctx.fillText(label, ox + 8, oy + 18);
    ctx.font = "12px monospace";
    const optText = String(item._opts[i]);
    const optLines = wrapTextMemo(optText, ow - 36, "12px monospace");
    ctx.fillText(optLines[0] || optText, ox + 8 + ctx.measureText(label).width, oy + 18);
    if (optLines[1]) ctx.fillText(optLines[1], ox + 8, oy + 34);
  }

  // Bottom bar
  const barY = ry + RH - 30;
  ctx.fillStyle = "#94a3b8"; ctx.font = "11px monospace"; ctx.textAlign = "center";
  let hint = "↑↓←→ or 1-4 select   Enter confirm   Esc abort";
  if (phase === "feedback" && feedback) {
    hint = feedback.correct ? "✓ Correct!" : `✗ Wrong — correct: ${item._opts[feedback.correctIdx]}`;
  }
  ctx.fillText(hint, CANVAS_W / 2, barY);
  ctx.fillStyle = "#facc15"; ctx.font = "bold 12px monospace";
  ctx.fillText(`${correctCount} correct`, CANVAS_W / 2, barY + 16);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

// ---------- Diagram Assembly gameplay (#030) ----------

// Place the selected tray piece into the next empty slot (slots fill in order). Shared by
// keyboard (Enter/Space) and mouse (click). Correct → lock + advance; wrong → red flash, stays.
function assemblyPlace(trayIdx) {
  const mg = currentMinigame;
  if (!mg || mg.phase !== "place") return;
  if (trayIdx < 0 || trayIdx >= mg.tray.length) return;
  const slotIdx = mg.placed;                 // next empty slot
  const piece = mg.tray[trayIdx];
  const correct = piece.id === mg.layout[slotIdx];
  if (correct) {
    mg.slots[slotIdx] = piece;
    mg.tray.splice(trayIdx, 1);
    mg.placed++;
    if (mg.traySel >= mg.tray.length) mg.traySel = Math.max(0, mg.tray.length - 1);
    sfx.confirm();
    mg.feedback = { correct: true, slotIdx, until: frame + 30 };
  } else {
    mg.mistakes++;
    sfx.wrong();
    mg.feedback = { correct: false, slotIdx, trayIdx, until: frame + 45 };
  }
  mg.phase = "feedback";
}

function handleAssemblyKey(k) {
  const mg = currentMinigame;
  if (!mg || mg.phase !== "place") return;
  const n = mg.tray.length;
  if (n === 0) return;
  if (k === "ArrowLeft" || k === "ArrowUp") { mg.traySel = (mg.traySel - 1 + n) % n; sfx.select(); }
  else if (k === "ArrowRight" || k === "ArrowDown") { mg.traySel = (mg.traySel + 1) % n; sfx.select(); }
  else if (k === "Enter" || k === " ") assemblyPlace(mg.traySel);
}

// Draw one diagram piece (sprite if available in libStore, else a labelled colored box).
// Per-piece sprites are frequently absent (slug mismatch — tickets #031/#032), so the labelled
// box is the common, intended path. `idx` drives the fallback hue so pieces read distinctly.
function drawPiece(piece, x, y, w, h, idx, opts = {}) {
  const img = piece && piece.sprite_slug ? libStore[piece.sprite_slug] : null;
  if (img) {
    ctx.drawImage(img, x, y, w, h);
  } else {
    const hue = (idx * 67) % 360;
    ctx.fillStyle = opts.bg || `hsl(${hue},40%,28%)`;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#e2e8f0"; ctx.font = "11px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    const lines = wrapTextMemo(String(piece && piece.label || "?"), w - 12, "11px monospace").slice(0, 4);
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x + 6, y + 6 + i * 14);
  }
  if (opts.border) { ctx.strokeStyle = opts.border; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h); }
  ctx.textBaseline = "alphabetic";
}

function drawAssembly() {
  const mg = currentMinigame;
  if (!mg) return;
  const { slots, tray, traySel, feedback, phase, total, placed } = mg;
  const RW = 720, RH = 560;
  const rx = (CANVAS_W - RW) / 2, ry = (CANVAS_H - RH) / 2;

  // Title + root
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#facc15"; ctx.font = "bold 15px monospace";
  ctx.fillText("Diagram Assembly", CANVAS_W / 2, ry + 26);
  ctx.fillStyle = "#94a3b8"; ctx.font = "12px monospace";
  ctx.fillText(mg.title || "", CANVAS_W / 2, ry + 46);
  if (mg.root) {
    ctx.fillStyle = "#64748b"; ctx.font = "11px monospace";
    const rl = wrapTextMemo(`Start: ${mg.root}`, RW - 80, "11px monospace").slice(0, 1);
    ctx.fillText(rl[0] || "", CANVAS_W / 2, ry + 64);
  }

  // Target slots (ordered layout)
  ctx.fillStyle = "#64748b"; ctx.font = "bold 11px monospace"; ctx.textAlign = "left";
  ctx.fillText("LAYOUT", rx + 24, ry + 90);
  const slotW = 200, slotH = 70, slotGap = 16;
  const slotsTotalW = total * slotW + (total - 1) * slotGap;
  const slotStartX = (CANVAS_W - Math.min(slotsTotalW, RW - 48)) / 2;
  const slotScale = slotsTotalW > RW - 48 ? (RW - 48) / slotsTotalW : 1;
  const sW = slotW * slotScale, sGap = slotGap * slotScale;
  const slotY = ry + 102;
  for (let i = 0; i < total; i++) {
    const sx = slotStartX + i * (sW + sGap);
    const piece = slots[i];
    // slot frame
    ctx.fillStyle = "rgba(15,23,42,0.7)"; ctx.fillRect(sx, slotY, sW, slotH);
    let border = "#334155";
    if (phase === "feedback" && feedback && feedback.slotIdx === i) border = feedback.correct ? "#22c55e" : "#f87171";
    else if (piece) border = "#22c55e";
    else if (i === placed && phase === "place") border = "#fde047";   // next slot to fill
    if (piece) {
      drawPiece(piece, sx + 2, slotY + 2, sW - 4, slotH - 4, i, { bg: "#14532d", border });
    } else {
      ctx.strokeStyle = border; ctx.lineWidth = 2; ctx.strokeRect(sx, slotY, sW, slotH);
      ctx.fillStyle = "#475569"; ctx.font = "bold 18px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), sx + sW / 2, slotY + slotH / 2);
      ctx.textBaseline = "alphabetic";
    }
  }

  // Source tray
  mg._trayRects = [];
  if (phase !== "success") {
    ctx.fillStyle = "#64748b"; ctx.font = "bold 11px monospace"; ctx.textAlign = "left";
    ctx.fillText("PIECES — pick the next one in order", rx + 24, slotY + slotH + 34);
    const tn = tray.length;
    const trayW = 210, trayH = 76, trayGap = 14;
    const perRow = Math.max(1, Math.floor((RW - 48) / (trayW + trayGap)));
    const trayStartX = rx + 24;
    const trayStartY = slotY + slotH + 48;
    for (let i = 0; i < tn; i++) {
      const col = i % perRow, row = Math.floor(i / perRow);
      const tx = trayStartX + col * (trayW + trayGap);
      const tyy = trayStartY + row * (trayH + 12);
      const active = i === traySel && phase === "place";
      const border = active ? "#fde047" : "#334155";
      drawPiece(tray[i], tx, tyy, trayW, trayH, i + 100, { border });
      mg._trayRects.push({ x: tx, y: tyy, w: trayW, h: trayH, idx: i });
    }
  }

  // Bottom bar
  const barY = ry + RH - 30;
  ctx.fillStyle = "#94a3b8"; ctx.font = "11px monospace"; ctx.textAlign = "center";
  let hint;
  if (phase === "success") hint = "✓ Assembled!  Press any key to continue";
  else if (phase === "feedback") hint = feedback && feedback.correct ? "✓ Correct placement" : "✗ Not next in order";
  else hint = "←→ select piece   Enter/click place   Esc abort";
  ctx.fillText(hint, CANVAS_W / 2, barY);
  ctx.fillStyle = "#facc15"; ctx.font = "bold 12px monospace";
  ctx.fillText(`${placed} / ${total} placed`, CANVAS_W / 2, barY + 16);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

// ---------- Timed Recall / Boss gameplay (#030) ----------

function handleTimedKey(k) {
  const mg = currentMinigame;
  if (!mg || mg.phase !== "question") return;
  if (k === "ArrowUp") { mg.sel = (mg.sel - 2 + 4) % 4; sfx.select(); }
  else if (k === "ArrowDown") { mg.sel = (mg.sel + 2) % 4; sfx.select(); }
  else if (k === "ArrowLeft") { mg.sel = (mg.sel % 2 === 0) ? mg.sel : mg.sel - 1; sfx.select(); }
  else if (k === "ArrowRight") { mg.sel = (mg.sel % 2 === 1) ? mg.sel : mg.sel + 1; sfx.select(); }
  else if (k === "1") { mg.sel = 0; sfx.select(); }
  else if (k === "2") { mg.sel = 1; sfx.select(); }
  else if (k === "3") { mg.sel = 2; sfx.select(); }
  else if (k === "4") { mg.sel = 3; sfx.select(); }
  else if (k === "Enter" || k === " ") timedAnswer(mg.sel);
}

function timedAnswer(sel) {
  const mg = currentMinigame;
  if (!mg || mg.phase !== "question") return;
  const item = mg.queue[mg.idx];
  const correct = sel === item.answerIdx;
  if (correct) { mg.correct++; sfx.confirm(); } else { sfx.wrong(); }
  mg.feedback = { correct, chosenIdx: sel, correctIdx: item.answerIdx, until: frame + 45 };
  mg.phase = "feedback";
}

function drawTimed() {
  const mg = currentMinigame;
  if (!mg) return;
  const { queue, idx, sel, feedback, phase, correct: correctCount } = mg;
  const item = queue[idx];
  const RW = 720, RH = 560;
  const rx = (CANVAS_W - RW) / 2, ry = (CANVAS_H - RH) / 2;

  // Title + domain + progress
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#facc15"; ctx.font = "bold 15px monospace";
  ctx.fillText("Timed Recall", CANVAS_W / 2, ry + 24);
  ctx.fillStyle = "#94a3b8"; ctx.font = "12px monospace";
  ctx.fillText(`${mg.domainName || ""}  ·  Q ${idx + 1} / ${mg.total}`, CANVAS_W / 2, ry + 44);

  // Countdown bar (Date.now() delta — mirrors the Hard-mode battle timer).
  const remMs = Math.max(0, mg.timerEnd - Date.now());
  const secs = Math.ceil(remMs / 1000);
  const frac = Math.max(0, Math.min(1, remMs / TIMED_RECALL_MS));
  const low = remMs < 10000;
  const barW = 260, barH = 12, tcx = CANVAS_W / 2, tby = ry + 56;
  const col = low ? "#f87171" : "#facc15";
  ctx.fillStyle = col; ctx.font = "bold 14px monospace"; ctx.textAlign = "center";
  ctx.fillText(`⏱ ${secs}s`, tcx, tby);
  ctx.fillStyle = "#0f172a"; ctx.fillRect(tcx - barW / 2, tby + 6, barW, barH);
  ctx.fillStyle = col; ctx.fillRect(tcx - barW / 2, tby + 6, barW * frac, barH);
  ctx.strokeStyle = "#334155"; ctx.lineWidth = 1; ctx.strokeRect(tcx - barW / 2, tby + 6, barW, barH);

  // Stem
  ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 14px monospace";
  const stemLines = wrapTextMemo(item.stem, RW - 80, "bold 14px monospace").slice(0, 6);
  const stemStartY = ry + 100;
  for (let i = 0; i < stemLines.length; i++) {
    ctx.textAlign = "center";
    ctx.fillText(stemLines[i], CANVAS_W / 2, stemStartY + i * 20);
  }

  // 2×2 option grid (mirrors drawCloze)
  const optW = 310, optH = 56, optGapX = 20, optGapY = 12;
  const gridW = optW * 2 + optGapX;
  const gridStartX = (CANVAS_W - gridW) / 2;
  const gridStartY = ry + 230;
  mg._optRects = [];
  for (let i = 0; i < 4; i++) {
    const colI = i % 2, row = Math.floor(i / 2);
    const ox = gridStartX + colI * (optW + optGapX);
    const oy = gridStartY + row * (optH + optGapY);
    mg._optRects.push([ox, oy, optW, optH]);
    let bg = "rgba(30,41,59,0.6)", fg = "#e2e8f0";
    if (phase === "feedback" && feedback) {
      if (i === feedback.correctIdx) { bg = "#14532d"; fg = "#22c55e"; }
      else if (i === feedback.chosenIdx && !feedback.correct) { bg = "#450a0a"; fg = "#f87171"; }
    } else if (i === sel) { bg = "#facc15"; fg = "#0f172a"; }
    ctx.fillStyle = bg; ctx.fillRect(ox, oy, optW, optH);
    if (i === sel && phase === "question") {
      ctx.strokeStyle = "#fde047"; ctx.lineWidth = 2; ctx.strokeRect(ox, oy, optW, optH);
    }
    ctx.fillStyle = fg; ctx.font = "bold 12px monospace"; ctx.textAlign = "left";
    const lab = `${i + 1}. `;
    ctx.fillText(lab, ox + 8, oy + 18);
    ctx.font = "12px monospace";
    const optLines = wrapTextMemo(String(item.opts[i]), optW - 36, "12px monospace").slice(0, 3);
    ctx.fillText(optLines[0] || "", ox + 8 + ctx.measureText(lab).width, oy + 18);
    if (optLines[1]) ctx.fillText(optLines[1], ox + 8, oy + 34);
    if (optLines[2]) ctx.fillText(optLines[2], ox + 8, oy + 48);
  }

  // Bottom bar
  const barY = ry + RH - 30;
  ctx.fillStyle = "#94a3b8"; ctx.font = "11px monospace"; ctx.textAlign = "center";
  let hint = "↑↓←→ or 1-4 select   Enter/click confirm   Esc abort";
  if (phase === "feedback" && feedback) hint = feedback.correct ? "✓ Correct!" : "✗ Wrong";
  ctx.fillText(hint, CANVAS_W / 2, barY);
  ctx.fillStyle = "#facc15"; ctx.font = "bold 12px monospace";
  ctx.fillText(`${correctCount} correct`, CANVAS_W / 2, barY + 16);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

// ---------- Shared score screen ----------

function drawMinigameScore() {
  const mg = currentMinigame;
  if (!mg) return;
  const RW = 720, RH = 560;
  const rx = (CANVAS_W - RW) / 2, ry = (CANVAS_H - RH) / 2;
  const { score, total } = mg;

  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#facc15"; ctx.font = "bold 20px monospace";
  // Timed Recall distinguishes "ran the clock out" from "answered them all".
  const header = (mg.type === "timed" && mg.phase === "gameover") ? "Time's up!" : "Round Complete!";
  ctx.fillText(header, CANVAS_W / 2, ry + 100);

  // Big score — timed shows a raw correct-count; the others show a percentage.
  if (mg.type === "timed") {
    const c = mg.correct || 0;
    const scoreColor = c >= total * 0.8 ? "#22c55e" : c >= total * 0.5 ? "#facc15" : "#f87171";
    ctx.fillStyle = scoreColor; ctx.font = "bold 48px monospace";
    ctx.fillText(`${c} / ${total}`, CANVAS_W / 2, ry + 200);
  } else {
    const pct = score | 0;
    const scoreColor = pct >= 80 ? "#22c55e" : pct >= 50 ? "#facc15" : "#f87171";
    ctx.fillStyle = scoreColor; ctx.font = "bold 48px monospace";
    ctx.fillText(`${pct}%`, CANVAS_W / 2, ry + 200);
  }

  // Detail
  ctx.fillStyle = "#e2e8f0"; ctx.font = "13px monospace";
  if (mg.type === "matching") {
    ctx.fillText(`${mg.matched ? mg.matched.length : 0} / ${total} pairs matched`, CANVAS_W / 2, ry + 250);
  } else if (mg.type === "cloze") {
    ctx.fillText(`${mg.correct || 0} / ${total} correct`, CANVAS_W / 2, ry + 250);
  } else if (mg.type === "assembly") {
    ctx.fillText(`${mg.placed || 0} / ${total} pieces placed${mg.mistakes ? `  ·  ${mg.mistakes} misplaced` : ""}`, CANVAS_W / 2, ry + 250);
  } else if (mg.type === "timed") {
    ctx.fillText(`${mg.correct || 0} of ${total} answered correctly`, CANVAS_W / 2, ry + 250);
  }

  ctx.fillStyle = "#64748b"; ctx.font = "12px monospace";
  ctx.fillText("Press any key to return", CANVAS_W / 2, ry + RH - 40);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

// ---------- Book reader draw functions (#027) ----------

// Book-picker modal — mirrors drawCoffeePrompt box/scrim/color tokens.
function drawBookPrompt() {
  if (!bookPrompt) return;
  const MAXROWS = 8;
  const books = bookPrompt.books;
  const total = books.length;
  const rows = Math.min(MAXROWS, total);
  const rowH = 34;
  const bw = 500, headerH = 56, footerH = 28;
  const bh = headerH + rows * rowH + footerH + 8;
  const bx = (CANVAS_W - bw) / 2, by = (CANVAS_H - bh) / 2;

  // Scrim + box
  ctx.fillStyle = "rgba(8,12,24,0.78)"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = "rgba(15,23,42,0.97)"; ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "#facc15"; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);

  // Title
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#facc15"; ctx.font = "bold 15px monospace";
  ctx.fillText("LIBRARY — SELECT A BOOK", CANVAS_W / 2, by + 30);

  // Scroll window (mirror drawSearch math)
  const sel = bookPrompt.sel;
  let start = 0;
  if (total > MAXROWS) start = Math.max(0, Math.min(sel - 3, total - MAXROWS));

  // Book rows
  const listTop = by + headerH;
  for (let i = 0; i < rows; i++) {
    const idx = start + i;
    const book = books[idx];
    const ry = listTop + i * rowH;
    const on = idx === sel;
    ctx.fillStyle = on ? "#facc15" : "rgba(30,41,59,0.6)";
    ctx.fillRect(bx + 12, ry, bw - 24, rowH - 2);
    ctx.fillStyle = on ? "#0f172a" : "#e2e8f0";
    ctx.font = "bold 13px monospace"; ctx.textAlign = "left";
    ctx.fillText(book.title || "(untitled)", bx + 20, ry + 16);
    ctx.fillStyle = on ? "#334155" : "#64748b";
    ctx.font = "11px monospace";
    ctx.fillText(book.domain || "", bx + 20, ry + 29);
  }

  // "+N more" overflow hint
  if (start + rows < total) {
    ctx.fillStyle = "#64748b"; ctx.font = "10px monospace"; ctx.textAlign = "center";
    ctx.fillText(`+${total - (start + rows)} more`, CANVAS_W / 2, listTop + rows * rowH + 10);
  }

  // Footer
  ctx.fillStyle = "#64748b"; ctx.font = "11px monospace"; ctx.textAlign = "center";
  ctx.fillText("↑↓ select · Enter open · Esc close", CANVAS_W / 2, by + bh - 8);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

// Full-canvas reader — draws prebuilt screens, never re-wraps.
function drawReader() {
  if (!readerState) return;
  const { book, page, screens, maxPage } = readerState;
  const screen = screens[page];
  if (!screen) return;

  const RW = 720, RH = 560;
  const rx = (CANVAS_W - RW) / 2, ry = (CANVAS_H - RH) / 2;
  const PAD = 32;
  const headerH = 44, footerH = 32;

  // Scrim + box
  ctx.fillStyle = "rgba(8,12,24,0.88)"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = "rgba(15,23,42,0.97)"; ctx.fillRect(rx, ry, RW, RH);
  ctx.strokeStyle = "#facc15"; ctx.lineWidth = 2; ctx.strokeRect(rx, ry, RW, RH);

  // Header
  ctx.fillStyle = "#facc15"; ctx.font = "bold 13px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const title = (book.title || "Book").slice(0, 60);
  ctx.fillText(`${title} — Page ${page + 1}/${screens.length}`, CANVAS_W / 2, ry + 26);
  // Header separator
  ctx.strokeStyle = "rgba(100,116,139,0.4)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(rx + PAD, ry + headerH - 4); ctx.lineTo(rx + RW - PAD, ry + headerH - 4); ctx.stroke();

  // Body
  const bodyTop = ry + headerH;
  if (screen.kind === "sprite") {
    const img = libStore[screen.slug];
    if (img && img.width) {
      const bodyW = RW - PAD * 2, bodyH = RH - headerH - footerH;
      const scale = Math.min(bodyW / img.width, bodyH / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      const dx = rx + (RW - dw) / 2, dy = bodyTop + (bodyH - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    }
  } else {
    const lineH = 18;
    ctx.fillStyle = "#e2e8f0"; ctx.font = "12px monospace"; ctx.textAlign = "left";
    for (let i = 0; i < screen.lines.length; i++) {
      ctx.fillText(screen.lines[i], rx + PAD, bodyTop + 14 + i * lineH);
    }
  }

  // Footer separator
  const footerY = ry + RH - footerH;
  ctx.strokeStyle = "rgba(100,116,139,0.4)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(rx + PAD, footerY); ctx.lineTo(rx + RW - PAD, footerY); ctx.stroke();

  // Footer nav
  ctx.font = "11px monospace"; ctx.textAlign = "center";
  ctx.fillStyle = page > 0 ? "#94a3b8" : "#334155";
  ctx.fillText("← prev", rx + 80, footerY + 20);
  ctx.fillStyle = page < maxPage ? "#94a3b8" : "#334155";
  ctx.fillText("next →", rx + RW - 80, footerY + 20);
  ctx.fillStyle = "#64748b";
  ctx.fillText("Esc close", CANVAS_W / 2, footerY + 20);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

// reveal `shown` chars from pre-wrapped lines at their final positions
function typewriterSlice(lines, shown) {
  if (shown <= 0) return [];
  const out = [];
  let remaining = shown;
  for (let i = 0; i < lines.length; i++) {
    const budget = i < lines.length - 1 ? lines[i].length + 1 : lines[i].length;
    if (remaining >= budget) { out.push(lines[i]); remaining -= budget; }
    else { out.push(lines[i].slice(0, remaining)); break; }
  }
  return out;
}

// Minigame harness screen (#028/#029). Dispatches to per-type draw functions.
// Shared scrim+panel drawn here; per-type draw functions add their content on top.
function drawMinigame() {
  if (!currentMinigame) return;
  const { label, score, phase, type } = currentMinigame;
  const RW = 720, RH = 560;
  const rx = (CANVAS_W - RW) / 2, ry = (CANVAS_H - RH) / 2;

  // Scrim + box (same tokens as drawReader)
  ctx.fillStyle = "rgba(8,12,24,0.88)"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = "rgba(15,23,42,0.97)"; ctx.fillRect(rx, ry, RW, RH);
  ctx.strokeStyle = "#facc15"; ctx.lineWidth = 2; ctx.strokeRect(rx, ry, RW, RH);

  if (phase === "intro") {
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#e2e8f0"; ctx.font = "13px monospace";
    ctx.fillText("Loading…", CANVAS_W / 2, ry + RH / 2);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    return;
  }
  // Terminal score screens (timed gameover/complete share the shared score screen).
  if (phase === "score" || phase === "gameover" || phase === "complete") { drawMinigameScore(); return; }
  if (type === "matching") { drawMatching(); return; }
  if (type === "cloze") { drawCloze(); return; }
  if (type === "assembly") { drawAssembly(); return; }   // handles place / feedback / success
  if (type === "timed") { drawTimed(); return; }

  // Fallback (unknown minigame type) — keep the harness from rendering a blank box.
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#facc15"; ctx.font = "bold 18px monospace";
  ctx.fillText(label || "Study Station", CANVAS_W / 2, ry + 60);
  ctx.fillStyle = "#64748b"; ctx.font = "11px monospace";
  ctx.fillText("Esc — exit", CANVAS_W / 2, ry + RH - 18);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

function drawHPBar(x, y, w, h, frac, label) {
  ctx.fillStyle = "#1e293b"; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = "#0f172a"; ctx.fillRect(x, y, w, h);
  const color = frac > 0.5 ? "#22c55e" : frac > 0.25 ? "#eab308" : "#ef4444";
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.max(0, w * frac), h);
  if (label) {
    ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 11px monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(label, x, y - 6);
  }
}

function drawCharacter(cx, cy, slug, dir, isPlayer, bob, wallAbove) {
  // Base overworld size 56px; the player grows ~0.5px/win, capped +14px (→70px at 28 wins).
  const baseSize = isPlayer ? 56 + Math.min(defeated.size * 0.5, 14) : 56;
  const sizeScale = baseSize / 34;            // proportional factor vs. the old 34px base
  const footY = cy + 16;                      // tile bottom (cy + TILE/2) — feet anchored here

  // Procedural deformation of the character's OWN per-character sprite (PRD 004 / #016).
  // Applied ONLY to the moving player; the idle player and every NPC are exactly still.
  // Locked, live-validated params: bob A=1.5px, squash sq=0.02 walk / 0.12 run,
  // sway K*stride*sin(p) (stride 0.06 walk / 0.11 run, K=26). Phase p = gaitPhase, which
  // advances from eased travel in updateOverworld() (so feet never slide). Sway is a
  // translate ONLY — no shear/skew (the user explicitly rejected head-tilt).
  let bobOff = 0, sway = 0, scaleX = 1, scaleY = 1;
  if (isPlayer && player.moving) {
    const p = gaitPhase;
    const A = 1.5;
    const sq = player.running ? 0.12 : 0.02;
    const stride = player.running ? 0.11 : 0.06, K = 26;
    bobOff = A * (Math.sin(p) - 0.2 * Math.sin(2 * p));   // asymmetric vertical bob (px)
    scaleY = 1 + Math.sin(2 * p) * sq;                    // footfall-timed squash/stretch
    scaleX = 1 / scaleY;                                  // volume-conserving (foot-anchored)
    sway   = K * stride * Math.sin(p);                    // whole-sprite X translate
  }

  // Footfall ground-shadow (PRD 004 / #017): an elliptical shadow under the moving player's
  // feet that squashes WIDER + DARKER at footfall contact and thins/fades at the airborne
  // phase. contact = -sin(2p) peaks (+1) exactly at the squash contact instant. Player only —
  // NPCs are always idle (no gaitPhase), and the idle player skips this entirely. Drawn before
  // the sprite so it sits behind the character.
  if (isPlayer && player.moving) {
    const contact = -Math.sin(2 * gaitPhase);             // +1 at footfall, -1 airborne
    const shadowW = (baseSize * 0.5) * (1 + contact * 0.3);  // ±30% width swing
    const shadowAlpha = Math.max(0, 0.18 + contact * 0.1);   // ~0.08 airborne … 0.28 contact
    ctx.save();
    ctx.globalAlpha = shadowAlpha;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(px(cx), px(footY + 2), shadowW / 2, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // A tall sprite (up to 58px) grows upward past its own 32px tile — that's CORRECT
  // top-down layering: the character stands in front of the wall/desk to its north and
  // draws over it (depth-sort orders characters against each other; the static map is
  // always behind them). The opaque HUD is drawn AFTER all characters, so it naturally
  // covers anything behind it — no clip needed. (The previous clip-to-tile truncated
  // 44–58px sprites to 32px whenever a wall sat above, decapitating them — the
  // "headless legs near walls" bug. Removed.)
  // Real 4-direction walk/run frames (when available for this slug). The frames ARE the
  // animation, so skip the procedural squash/sway/bob deform entirely. Sprite playback uses
  // a capped time-based frame phase (9 FPS walk / 13 FPS run); tying four frames to each
  // 7.5/12.5 tiles-per-second step made them flash at 30/50 FPS. Idle shows frame 0. Drawn
  // bottom-centre, feet at footY, preserving the portrait aspect ratio. Player-only for now.
  const anim = isPlayer ? walkAnim[slug] : null;
  if (anim) {
    const frames = (anim[dir] && anim[dir].length === 4) ? anim[dir] : anim.down;
    if (frames && frames.length) {
      const fi = player.moving ? (Math.floor(walkAnimPhase) % 4) : 0;
      const fimg = frames[fi] || frames[0];
      if (fimg) {
        const H = baseSize;                          // match overworld character height
        const W = H * (fimg.width / fimg.height);    // preserve portrait aspect (no stretch)
        const m = walkMini(fimg, `${slug}:${dir}:${fi}`, W, H);   // HQ downscale (no NN aliasing)
        ctx.drawImage(m, px(cx - W / 2), px(footY - H), W, H);
        return;
      }
    }
  }

  const mini = spriteMini(slug, baseSize);
  if (mini) {
    // Foot-anchored affine: translate to the feet, scale about that point, draw upward.
    // bob is applied inside the scaled space (matches the validated prototype).
    ctx.save();
    ctx.translate(px(cx + sway), px(footY));
    ctx.scale(scaleX, scaleY);
    ctx.drawImage(mini, -baseSize / 2, -baseSize + bobOff, baseSize, baseSize);
    ctx.restore();
  } else {
    // fallback: simple body + pixelated headshot (only when no sprite image is available)
    const bodyColor = isPlayer ? "#ef4444" : "#475569";
    const headSize = 20 * sizeScale;
    ctx.fillStyle = bodyColor;
    ctx.fillRect(px(cx - 7 * sizeScale + sway), px(footY - 14 * sizeScale - bobOff), 14 * sizeScale, 10 * sizeScale);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(px(cx - 6 * sizeScale + sway), px(footY - 4 * sizeScale - bobOff), 5 * sizeScale, 4 * sizeScale);
    ctx.fillRect(px(cx + 1 * sizeScale + sway), px(footY - 4 * sizeScale - bobOff), 5 * sizeScale, 4 * sizeScale);
    ctx.drawImage(pixelHead(slug, 16), px(cx - headSize / 2 + sway), px(footY - 32 * sizeScale - bobOff), headSize, headSize);
  }
}

// Draw a trainer sprite bottom-anchored at (cx, baseY) with given height.
// Falls back to the pixelated headshot if no generated sprite exists.
function drawTrainer(slug, cx, baseY, h, bobAmp = 0) {
  const yOff = bobAmp ? Math.sin(frame / 16) * bobAmp : 0;
  const img = sprites[slug];
  if (img) {
    ctx.drawImage(img, px(cx - h / 2), px(baseY - h + yOff), h, h);
  } else {
    const s = Math.round(h * 0.7);
    ctx.drawImage(pixelHead(slug, 64), px(cx - s / 2), px(baseY - s + yOff), s, s);
  }
}

// ---------- Scenes ----------
function drawTitle() {
  const save = getSave();
  const wins = save?.defeated?.length || 0;
  const accent = "#fbbf24", coral = "#f9735b", teal = "#2dd4bf";

  // Signature backdrop: the actual playable office as a dim command-centre diorama.
  ctx.fillStyle = "#050a16"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  if (mapCv) {
    const mcW = mapCv.width, mcH = mapCv.height;
    const targetRatio = CANVAS_W / CANVAS_H;
    const sw = Math.min(mcW, mcH * targetRatio);
    const sx = (mcW - sw) / 2;
    ctx.globalAlpha = 0.48;
    ctx.drawImage(mapCv, sx, 0, sw, mcH, 0, 0, CANVAS_W, CANVAS_H);
    ctx.globalAlpha = 1;
  }
  const veil = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  veil.addColorStop(0, "rgba(3,8,22,0.94)");
  veil.addColorStop(0.48, "rgba(3,8,22,0.76)");
  veil.addColorStop(1, "rgba(3,8,22,0.92)");
  ctx.fillStyle = veil; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Quiet CRT scanlines bind the office art and UI into one 16-bit surface.
  ctx.fillStyle = "rgba(148,163,184,0.035)";
  for (let y = 1; y < CANVAS_H; y += 4) ctx.fillRect(0, y, CANVAS_W, 1);

  // League masthead: deliberately asymmetric terminal labels around the centred mark.
  ctx.textBaseline = "alphabetic";
  ctx.font = "bold 11px monospace"; ctx.textAlign = "left"; ctx.fillStyle = teal;
  ctx.fillText("CLAUDE ARCHITECT LEAGUE", 30, 38);
  ctx.textAlign = "right"; ctx.fillStyle = "#94a3b8";
  ctx.fillText("FIELD SIMULATION // 2026", CANVAS_W - 30, 38);
  ctx.fillStyle = "rgba(148,163,184,0.28)"; ctx.fillRect(30, 49, CANVAS_W - 60, 1);
  ctx.fillStyle = teal; ctx.fillRect(30, 48, 92, 3);

  // Logo with a one-pixel coral registration shadow, like a misaligned print layer.
  ctx.textAlign = "center"; ctx.font = "bold 76px monospace";
  ctx.fillStyle = coral; ctx.fillText("DATAMON", CANVAS_W / 2 + 3, 151 + 3);
  ctx.fillStyle = accent; ctx.fillText("DATAMON", CANVAS_W / 2, 151);
  ctx.fillStyle = "#f4ead7"; ctx.font = "bold 15px monospace";
  ctx.fillText("GOTTA CERT 'EM ALL", CANVAS_W / 2, 181);
  ctx.fillStyle = "#94a3b8"; ctx.font = "11px monospace";
  ctx.fillText("A CLAUDE CODE FOUNDATIONS FIELD EXERCISE", CANVAS_W / 2, 202);

  // Candidate dossier: progress is part of the world, not a generic percentage card.
  const bx = 214, by = 234, bw = 372, bh = 102;
  ctx.fillStyle = "rgba(7,16,35,0.92)"; ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = save ? teal : "#475569"; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = save ? teal : accent; ctx.fillRect(bx, by, 7, bh);
  ctx.textAlign = "left"; ctx.fillStyle = "#94a3b8"; ctx.font = "bold 10px monospace";
  ctx.fillText(save ? "ACTIVE CANDIDATE DOSSIER" : "NEW CANDIDATE DOSSIER", bx + 22, by + 25);
  ctx.fillStyle = "#f8fafc"; ctx.font = "bold 16px monospace";
  ctx.fillText(save ? displayName(save.player) : "UNREGISTERED CONSULTANT", bx + 22, by + 48);
  ctx.fillStyle = "#17233b"; ctx.fillRect(bx + 22, by + 65, bw - 44, 10);
  if (save) {
    ctx.fillStyle = teal; ctx.fillRect(bx + 22, by + 65, (bw - 44) * (wins / Math.max(1, ROSTER.length - 1)), 10);
  }
  ctx.fillStyle = "#94a3b8"; ctx.font = "10px monospace";
  ctx.fillText(save ? `${wins}/${ROSTER.length - 1} CONSULTANTS BESTED` : "FIVE DOMAINS AWAIT CERTIFICATION", bx + 22, by + 91);

  // One orchestrated call-to-action instead of scattered blinking decorations.
  const pulse = 0.58 + Math.sin(frame / 14) * 0.22;
  const ctaX = 258, ctaY = 365, ctaW = 284, ctaH = 48;
  ctx.fillStyle = `rgba(251,191,36,${0.10 + pulse * 0.08})`; ctx.fillRect(ctaX, ctaY, ctaW, ctaH);
  ctx.globalAlpha = pulse; ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.strokeRect(ctaX, ctaY, ctaW, ctaH); ctx.globalAlpha = 1;
  ctx.textAlign = "center"; ctx.fillStyle = "#f8fafc"; ctx.font = "bold 14px monospace";
  ctx.fillText(save ? "ENTER  /  RESUME FIELD RUN" : "ENTER  /  REGISTER CANDIDATE", CANVAS_W / 2, ctaY + 30);

  // Roster rail: a restrained moving cast reveal anchored to a real system label.
  ctx.fillStyle = "rgba(7,16,35,0.90)"; ctx.fillRect(0, 454, CANVAS_W, 91);
  ctx.fillStyle = "rgba(148,163,184,0.25)"; ctx.fillRect(0, 453, CANVAS_W, 1);
  ctx.textAlign = "left"; ctx.fillStyle = coral; ctx.font = "bold 9px monospace";
  ctx.fillText(`ROSTER LINK // ${ROSTER.length} CONSULTANTS ONLINE`, 18, 468);
  for (let i = 0; i < ROSTER.length; i++) {
    const x = ((i * 57 + frame * 0.35) % (CANVAS_W + 70)) - 42;
    const bob = Math.sin((frame + i * 19) / 17) * 2;
    const mini = spriteMini(ROSTER[i], 50);
    if (mini) ctx.drawImage(mini, px(x), px(481 + bob), 50, 50);
    else ctx.drawImage(pixelHead(ROSTER[i], 40), px(x + 5), px(486 + bob), 40, 40);
  }

  ctx.fillStyle = "#64748b"; ctx.font = "10px monospace"; ctx.textAlign = "center";
  ctx.fillText("ARROWS / WASD  MOVE    SPACE  INTERACT    1–4  ANSWER    M  AUDIO" + (save ? "    R  RESET" : ""), CANVAS_W / 2, 580);
}

// --- Character select: grid left, animated showcase panel right ---
const SEL = { cols: 6, cell: 74, ox: 26, oy: 104 };
const PANEL = { x: 488, y: 96, w: 286, h: 462 };
let selChangedAt = -999; // frame when selection last changed (drives animations)

function setSelect(i, silent) {
  if (i === selectIdx) return;
  selectIdx = i;
  selChangedAt = frame;
  loadWalkAnim(ROSTER[selectIdx]); // browsing doubles as a tiny, deduplicated prefetch
  if (!silent) sfx.select();
}

// Cycle the difficulty selector on the character-select screen (dir +1 / -1).
function cycleDifficulty(dir) {
  const i = DIFFICULTIES.indexOf(difficulty);
  difficulty = DIFFICULTIES[(i + dir + DIFFICULTIES.length) % DIFFICULTIES.length];
  sfx.select();
}

// Layout rects for the 3 difficulty segments — left column, below the roster
// grid (the right showcase panel is occupied by stat bars). Used by render +
// mouse hit-test so both stay in sync.
function difficultyRects() {
  const segW = 120, gap = 12, total = segW * 3 + gap * 2;
  const gridW = SEL.cols * SEL.cell;            // left grid span
  const x0 = SEL.ox + (gridW - total) / 2;
  const y = SEL.oy + Math.ceil(ROSTER.length / SEL.cols) * SEL.cell + 18;
  return DIFFICULTIES.map((d, i) => [x0 + i * (segW + gap), y, segW, 30, d]);
}

function difficultyHitTest(mx, my) {
  for (const [x, y, w, h, d] of difficultyRects()) {
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) return d;
  }
  return null;
}

function hashStr(s) {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const CONSULTANT_TITLES = [
  "The Pipeline Whisperer", "Prompt Sorcerer", "YAML Wrangler", "Dashboard Artisan",
  "Regex Gladiator", "Cloud Nomad", "Standup Bard", "Merge Conflict Medic",
  "Notebook Alchemist", "Latency Hunter", "Schema Sheriff", "Token Economist",
  "Edge Case Oracle", "Scope Creep Slayer", "Hotfix Cowboy", "Data Lake Lifeguard",
  "Kernel Panic Counselor", "Embedding Sommelier", "Cron Job Necromancer", "The Refactorer",
];
const STAT_NAMES = ["CAFFEINE", "DEBUGGING", "VIBES", "JARGON"];
const profileCache = {};
function charProfile(slug) {
  if (profileCache[slug]) return profileCache[slug];
  const h = hashStr(slug), rng = mulberry32(h);
  profileCache[slug] = {
    title: CONSULTANT_TITLES[h % CONSULTANT_TITLES.length],
    color: TYPE_COLORS[["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT", "MIX"][h % 6]],
    stats: STAT_NAMES.map(() => 52 + Math.floor(rng() * 48)),
  };
  return profileCache[slug];
}

function selectHitTest(mx, my) {
  for (let i = 0; i < ROSTER.length; i++) {
    const x = SEL.ox + (i % SEL.cols) * SEL.cell, y = SEL.oy + Math.floor(i / SEL.cols) * SEL.cell;
    if (mx >= x && mx <= x + SEL.cell - 8 && my >= y && my <= y + SEL.cell - 8) return i;
  }
  return -1;
}

function fitFont(text, maxW, size, weight = "bold") {
  do { ctx.font = `${weight} ${size}px monospace`; size--; }
  while (ctx.measureText(text).width > maxW && size > 9);
  return size + 1;
}

function drawSelect() {
  ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#facc15"; ctx.font = "bold 28px monospace";
  ctx.fillText("CHOOSE YOUR CONSULTANT", CANVAS_W / 2, 56);

  // --- roster grid (left) ---
  for (let i = 0; i < ROSTER.length; i++) {
    const x = SEL.ox + (i % SEL.cols) * SEL.cell, y = SEL.oy + Math.floor(i / SEL.cols) * SEL.cell;
    const size = SEL.cell - 8;
    const isSel = i === selectIdx;
    const lift = isSel ? Math.abs(Math.sin(frame / 14)) * 4 : 0;
    if (isSel) {
      ctx.fillStyle = "rgba(250,204,21,0.10)";
      ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
      ctx.strokeStyle = "#facc15"; ctx.lineWidth = 3;
      ctx.strokeRect(x - 2, y - 2, size + 4, size + 4);
    }
    ctx.globalAlpha = isSel ? 1 : 0.72;
    const mini = spriteMini(ROSTER[i], size);
    if (mini) ctx.drawImage(mini, x, y - lift, size, size);
    else ctx.drawImage(pixelHead(ROSTER[i], 48), x, y - lift, size, size);
    ctx.globalAlpha = 1;
  }

  // --- showcase panel (right) ---
  const p = charProfile(ROSTER[selectIdx]);
  const t = Math.min(1, (frame - selChangedAt) / 22);
  const ease = 1 - Math.pow(1 - t, 3);

  ctx.fillStyle = "#111c33";
  ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
  ctx.strokeStyle = p.color; ctx.lineWidth = 3;
  ctx.strokeRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);

  // rising pixel particles in the panel
  for (let i = 0; i < 10; i++) {
    const ph = (i * 997 + 31 * i * i) % PANEL.h;
    const py = PANEL.y + PANEL.h - ((ph + frame * (0.4 + (i % 3) * 0.25)) % (PANEL.h - 10)) - 5;
    const pxx = PANEL.x + 14 + ((i * 251) % (PANEL.w - 28));
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = p.color;
    ctx.fillRect(px(pxx), px(py), 3, 3);
    ctx.globalAlpha = 1;
  }

  // spotlight + big animated sprite (slides in, idle bob + breathing)
  const cx = PANEL.x + PANEL.w / 2;
  const baseY = PANEL.y + 282;
  ctx.fillStyle = "rgba(148,163,184,0.16)";
  ctx.beginPath();
  ctx.ellipse(cx, baseY - 4, 88 * (0.7 + 0.3 * ease), 17, 0, 0, 7);
  ctx.fill();

  const slide = (1 - ease) * 46;
  const bob = Math.sin(frame / 17) * 3;
  const breathe = 1 + Math.sin(frame / 17) * 0.008;
  const h = 240 * (0.92 + 0.08 * ease) * breathe;
  ctx.globalAlpha = 0.25 + 0.75 * ease;
  const img = sprites[ROSTER[selectIdx]];
  if (img) ctx.drawImage(img, px(cx - h / 2 + slide), px(baseY - h + bob), h, h);
  else ctx.drawImage(pixelHead(ROSTER[selectIdx], 128), px(cx - 70 + slide), px(baseY - 150 + bob), 140, 140);
  ctx.globalAlpha = 1;

  // name + title
  const name = displayName(ROSTER[selectIdx]);
  ctx.textAlign = "center";
  ctx.fillStyle = "#e2e8f0";
  ctx.font = `bold ${fitFont(name, PANEL.w - 24, 19)}px monospace`;
  ctx.fillText(name, cx, PANEL.y + 312);
  ctx.fillStyle = p.color; ctx.font = "bold 12px monospace";
  ctx.fillText("« " + p.title + " »", cx, PANEL.y + 332);

  // animated stat bars
  const bx = PANEL.x + 18, bw = PANEL.w - 36;
  STAT_NAMES.forEach((sn, i) => {
    const by = PANEL.y + 352 + i * 23;
    const fillT = Math.min(1, Math.max(0, (frame - selChangedAt - i * 4) / 26));
    const v = p.stats[i] * (1 - Math.pow(1 - fillT, 2));
    ctx.fillStyle = "#64748b"; ctx.font = "bold 10px monospace"; ctx.textAlign = "left";
    ctx.fillText(sn, bx, by + 8);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(bx + 86, by, bw - 86, 10);
    ctx.fillStyle = p.color;
    ctx.fillRect(bx + 86, by, (bw - 86) * (v / 100), 10);
    ctx.fillStyle = "#94a3b8"; ctx.font = "10px monospace"; ctx.textAlign = "right";
    ctx.fillText(String(Math.round(v)), bx + bw, by + 9);
  });

  if (Math.floor(frame / 25) % 2 === 0) {
    ctx.fillStyle = "#facc15"; ctx.font = "bold 13px monospace"; ctx.textAlign = "center";
    ctx.fillText("PRESS ENTER", cx, PANEL.y + PANEL.h - 14);
  }

  // --- difficulty selector (left column, below the roster grid) ---
  const rects = difficultyRects();
  const dx0 = rects[0][0], dyTop = rects[0][1];
  ctx.fillStyle = "#94a3b8"; ctx.font = "bold 12px monospace"; ctx.textAlign = "left";
  ctx.fillText("DIFFICULTY  (TAB / D to change)", dx0, dyTop - 8);
  const DIFF_COLORS = { easy: "#22c55e", normal: "#facc15", hard: "#f87171" };
  for (const [x, y, w, h, d] of rects) {
    const active = d === difficulty;
    ctx.fillStyle = active ? DIFF_COLORS[d] : "#1e293b";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? "#e2e8f0" : "#334155"; ctx.lineWidth = active ? 2 : 1;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = active ? "#0f172a" : "#94a3b8";
    ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(DIFF_LABELS[d], x + w / 2, y + h / 2);
    ctx.textBaseline = "alphabetic";
  }
  // one-line blurb for the active tier
  ctx.fillStyle = "#64748b"; ctx.font = "11px monospace"; ctx.textAlign = "center";
  ctx.fillText(DIFF_BLURB[difficulty], dx0 + (rects[2][0] + rects[2][2] - dx0) / 2, dyTop + rects[0][3] + 16);

  ctx.fillStyle = "#64748b"; ctx.font = "13px monospace"; ctx.textAlign = "center";
  ctx.fillText("Arrows or mouse to browse · TAB sets difficulty · ENTER / click to choose your consultant",
    CANVAS_W / 2, CANVAS_H - 20);
}

// Flat-color fallback per office tile slug (dominant color of each PNG). Used when a
// tile image is missing so the renderer degrades to a solid fill instead of a black
// square or a crash (ticket #019 Must-Not). Map-char cases below stay unchanged.
const TILE_FALLBACK = {
  // round-1 tiles
  "floor-a": "#f2e8d5", "floor-b": "#e8dbc3", "floor-c": "#f2e8d5",
  "wall-h": "#aa563a", "wall-v": "#aa563a",
  "wall-corner-tl": "#aa563a", "wall-corner-tr": "#aa563a",
  "wall-corner-bl": "#aa563a", "wall-corner-br": "#aa563a",
  "desk": "#a9743b", "plant": "#5b8c42", "coffee": "#4a4640", "rug": "#bc6040",
  // office surface tileset (#019)
  "hardwood-a": "#c8702f", "hardwood-b": "#d07a37", "hardwood-c": "#be682a",
  "brick-red": "#aa563a", "brick-white": "#cec2b2",
  "window-h": "#6c7a84", "column": "#8c5a30", "duct": "#b4aea2",
};

function tileColor(t, x, y) {
  // Slug-keyed flat fallback for the office tileset (missing-PNG degradation).
  if (TILE_FALLBACK[t]) return TILE_FALLBACK[t];
  switch (t) {
    case "#": return (x % 6 === 0 || y % 6 === 0) ? "#cec2b2" : "#aa563a"; // brick (pilaster/red)
    case "W": return "#6c7a84";  // window
    case "O": return "#8c5a30";  // wood column
    case "U": return "#b4aea2";  // duct
    case "G": return "#a9c7d6";  // glass wall
    case "~": return (x + y) % 2 ? "#b5651d" : "#a85a18"; // rug
    // "F" furniture footprint + "." floor + anything unrecognized → warm hardwood
    default:  return (x + y) % 2 ? "#c8702f" : "#be682a";
  }
}

function blitTile(c, slug, sx, sy) {
  // HD entries are additive and zone-scoped; any absent/rejected image falls through to
  // the unchanged legacy tile store. Natural 2× source pixels map 1:1 into a DPR2 cache.
  if (typeof DatamonWorldArt !== "undefined") {
    const hd = DatamonWorldArt.getHDAsset(slug, "tile", "office");
    const tx = Math.floor(sx / TILE), ty = Math.floor(sy / TILE);
    if (hd && (!hd.entry.zone || regionOf(tx, ty) === hd.entry.zone)) {
      c.drawImage(hd.image, sx, sy, TILE, TILE);
      return true;
    }
  }
  if (tileStore[slug]) { c.drawImage(tileStore[slug], sx, sy, TILE, TILE); return true; }
  return false;
}
function wallSlug(x, y) {
  const isWall = (cx, cy) => (cy < 0 || cy >= MAP_H || cx < 0 || cx >= MAP_W) ? false : map[cy][cx] === "#";
  const T = isWall(x, y - 1), B = isWall(x, y + 1), L = isWall(x - 1, y), R = isWall(x + 1, y);
  if (!T && !B &&  L &&  R) return "wall-h";
  if ( T &&  B && !L && !R) return "wall-v";
  if (!T &&  B && !L &&  R) return "wall-corner-tl";
  if (!T &&  B &&  L && !R) return "wall-corner-tr";
  if ( T && !B && !L &&  R) return "wall-corner-bl";
  if ( T && !B &&  L && !R) return "wall-corner-br";
  return (L || R) ? "wall-h" : "wall-v"; // T-junctions / inner / isolated: never crash
}

// ---- Procedural hardwood floor (#022) -------------------------------------------------
// Replaces the 3 repeating 32px hardwood PNGs, which tiled into harsh full-height "corduroy"
// stripes with visible seams (every tile's grain ran top-to-bottom and lined up with its
// neighbours, so stripes spanned the whole map). Instead we bake ONE continuous map-sized
// plank texture: discrete boards of varied width/length whose end-joints STAGGER per column,
// gentle per-plank colour jitter, low-contrast soft grain, soft seams, and a faint global
// light gradient. buildMapCanvas() samples each floor cell's region from this texture, so the
// floor never repeats and the tile grid disappears. Built once; deterministic (fixed seed) so
// rebuilds never flicker.
let floorTex = null;
let floorTexKey = null;  // detail-scale key for cache invalidation
function buildFloorTexture() {
  // Keyed by detail scale so DPR1 and DPR2 get distinct grain.
  var texKey = "floor_" + MAP_DETAIL_SCALE;
  if (floorTexKey === texKey && floorTex) return floorTex;
  floorTexKey = texKey;
  const W = Math.round(MAP_W * TILE * MAP_DETAIL_SCALE);
  const H = Math.round(MAP_H * TILE * MAP_DETAIL_SCALE);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  c.imageSmoothingEnabled = true;                  // soft grain/seams — the "smoothness" win
  const rng = mulberry32(0x0FF1CE);
  const rand = (a, b) => a + (b - a) * rng();

  const ds = MAP_DETAIL_SCALE;
  // Warm-oak base wash so any sub-pixel gap reads as floor, never black.
  c.fillStyle = "#b06f33"; c.fillRect(0, 0, W, H);

  // Vertical boards laid column-by-column (grain runs vertically, matching the office's
  // original orientation) but as FINITE planks with a random vertical phase per column,
  // so the end-joints stagger and no grain line ever runs unbroken down the map.
  // All spatial dimensions multiplied by detail scale for sub-logical grain.
  let x = 0;
  while (x < W) {
    const pw = Math.round(rand(26, 42) * ds);        // board width
    let y = -Math.round(rand(0, 220) * ds);          // staggered start => offset joints
    while (y < H) {
      const ph = Math.round(rand(150, 300) * ds);    // board length
      const top = Math.max(0, y), bot = Math.min(H, y + ph);
      // Warm-oak base with LOW-variance jitter: an organic blend, not three neon stripes.
      c.fillStyle = `hsl(${rand(27, 33)}, ${rand(42, 54)}%, ${rand(40, 50)}%)`;
      c.fillRect(x, top, pw, bot - top);
      // A couple of faint lengthwise grain streaks (sub-pixel widths + smoothing => feathered).
      for (let s = 1 + Math.floor(rng() * 2); s > 0; s--) {
        const gx = x + rand(2, pw - 2);
        c.fillStyle = rng() < 0.5 ? `rgba(60,35,12,${rand(0.03, 0.06)})`
                                  : `rgba(255,225,180,${rand(0.025, 0.045)})`;
        c.fillRect(gx, top, rand(0.8, 1.8) * ds, bot - top);
      }
      // Soft end-joint: gentle shadow + faint highlight (low alpha — blends, never harsh).
      if (y >= 0) {
        c.fillStyle = "rgba(45,25,8,0.15)";   c.fillRect(x, y, pw, 1.5 * ds);
        c.fillStyle = "rgba(255,230,190,0.06)"; c.fillRect(x, y + 1.5 * ds, pw, 1 * ds);
      }
      y += ph;
    }
    // Soft side seam between board columns (low alpha => reads as a crease, not a hard line).
    c.fillStyle = "rgba(40,22,6,0.11)";  c.fillRect(x + pw - 1, 0, 1, H);
    c.fillStyle = "rgba(255,228,188,0.035)"; c.fillRect(x, 0, 1, H);
    x += pw;
  }

  // Faint ambient light: a large soft warm gradient so the floor drifts tonally instead of
  // sitting flat — the final touch that makes the whole surface read as one blended wood.
  const g = c.createRadialGradient(W * 0.35, H * 0.30, 60 * ds, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
  g.addColorStop(0, "rgba(255,238,205,0.10)");
  g.addColorStop(1, "rgba(40,22,8,0.14)");
  c.fillStyle = g; c.fillRect(0, 0, W, H);

  floorTex = cv;
  return cv;
}

// ---- Living office identity -----------------------------------------------------------
// The six domains share walnut, brick, rainy steel and brass, but each zone behaves like
// a different working instrument. Everything below is baked into the visual cache only:
// no map cells, collision, placements, NPC routes or interaction coordinates change.
function drawOfficeZoneIdentity(c, ds) {
  const hair = 1 / Math.max(1, ds);
  const wash = (x0, y0, x1, y1, color, cx, cy) => {
    c.save(); c.beginPath(); c.rect(x0 * TILE, y0 * TILE, (x1 - x0) * TILE, (y1 - y0) * TILE); c.clip();
    const g = c.createRadialGradient(cx * TILE, cy * TILE, 8, cx * TILE, cy * TILE, 7 * TILE);
    g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(x0 * TILE, y0 * TILE, (x1 - x0) * TILE, (y1 - y0) * TILE); c.restore();
  };
  const node = (x, y, color) => {
    c.fillStyle = "rgba(8,20,38,0.64)"; c.fillRect(x * TILE - 3, y * TILE - 3, 6, 6);
    c.strokeStyle = color; c.lineWidth = hair; c.strokeRect(x * TILE - 2, y * TILE - 2, 4, 4);
    c.fillStyle = color; c.fillRect(x * TILE - hair / 2, y * TILE - hair / 2, hair, hair);
  };

  // Practical-light pools are low-contrast so labels, sprites and answer-signposting remain primary.
  wash(0, 0, 12, 11, "rgba(242,179,93,0.075)", 7, 5);
  wash(12, 0, 24, 11, "rgba(168,85,247,0.075)", 18, 6);
  wash(24, 0, 36, 11, "rgba(34,197,94,0.060)", 30, 5);
  wash(0, 11, 12, 24, "rgba(6,182,212,0.070)", 5, 18);
  wash(12, 11, 24, 24, "rgba(249,115,22,0.060)", 18, 18);
  wash(24, 11, 36, 24, "rgba(245,158,11,0.060)", 29, 17);

  c.save(); c.lineCap = "square"; c.lineJoin = "miter";
  // MCP LAB — a routed tool bus: ports and orthogonal cable traces, not decorative neon.
  c.strokeStyle = "rgba(168,85,247,0.48)"; c.lineWidth = hair;
  c.beginPath(); c.moveTo(13 * TILE, 7 * TILE); c.lineTo(22.5 * TILE, 7 * TILE);
  c.moveTo(15 * TILE, 7 * TILE); c.lineTo(15 * TILE, 5.25 * TILE);
  c.moveTo(18 * TILE, 7 * TILE); c.lineTo(18 * TILE, 8.5 * TILE);
  c.moveTo(21 * TILE, 7 * TILE); c.lineTo(21 * TILE, 5.25 * TILE); c.stroke();
  c.strokeStyle = "rgba(69,215,232,0.34)"; c.beginPath();
  c.moveTo(13 * TILE, 7 * TILE + 2); c.lineTo(22.5 * TILE, 7 * TILE + 2); c.stroke();
  for (const p of [[13,7],[15,5.25],[18,8.5],[21,5.25],[22.5,7]]) node(p[0], p[1], "rgba(199,157,255,0.88)");

  // CONFIG BAY — a brass calibration rail with green verified positions.
  const railY = 8.55 * TILE;
  c.fillStyle = "rgba(48,34,27,0.52)"; c.fillRect(25 * TILE, railY - 3, 9.5 * TILE, 6);
  c.fillStyle = "rgba(242,179,93,0.50)"; c.fillRect(25 * TILE, railY - hair / 2, 9.5 * TILE, hair);
  for (let i = 0; i <= 19; i++) {
    const x = (25 + i * 0.5) * TILE;
    c.fillStyle = i % 4 === 0 ? "rgba(34,197,94,0.78)" : "rgba(232,223,200,0.38)";
    c.fillRect(x, railY - (i % 4 === 0 ? 5 : 3), hair, i % 4 === 0 ? 10 : 6);
  }

  // CONTEXT CORNER — nested context windows reflected in the glass meeting room.
  c.strokeStyle = "rgba(174,232,241,0.25)"; c.lineWidth = hair;
  for (let inset = 0; inset < 3; inset++) {
    c.strokeRect((1.35 + inset * 0.28) * TILE, (16.1 + inset * 0.28) * TILE,
                 (7.2 - inset * 0.56) * TILE, (5.5 - inset * 0.56) * TILE);
  }
  c.fillStyle = "rgba(6,182,212,0.38)";
  for (const y of [17.05, 20.85]) c.fillRect(1.65 * TILE, y * TILE, 6.6 * TILE, hair);

  // PROMPT STUDIO — editorial registration frames around four drafting stations.
  c.strokeStyle = "rgba(249,115,22,0.40)"; c.lineWidth = hair;
  for (const p of [[13.25,15.15],[19.25,15.15],[13.25,18.15],[19.25,18.15]]) {
    c.strokeRect(p[0] * TILE, p[1] * TILE, 3.2 * TILE, 2.2 * TILE);
    c.fillStyle = "rgba(242,179,93,0.54)";
    c.fillRect(p[0] * TILE, p[1] * TILE, 9, hair); c.fillRect(p[0] * TILE, p[1] * TILE, hair, 9);
    c.fillRect((p[0] + 3.2) * TILE - 9, (p[1] + 2.2) * TILE - hair, 9, hair);
  }

  // THE LOUNGE — one restrained certification-compass inlay carries all five domains.
  const mx = 29 * TILE, my = 12.85 * TILE;
  c.strokeStyle = "rgba(242,179,93,0.48)"; c.lineWidth = hair;
  c.beginPath(); c.arc(mx, my, 18, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(mx, my - 15); c.lineTo(mx + 6, my); c.lineTo(mx, my + 15);
  c.lineTo(mx - 6, my); c.closePath(); c.stroke();
  const domainMarks = ["#3b82f6","#a855f7","#22c55e","#f97316","#06b6d4"];
  for (let i = 0; i < domainMarks.length; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / domainMarks.length;
    c.fillStyle = domainMarks[i]; c.fillRect(mx + Math.cos(a) * 22 - 1, my + Math.sin(a) * 22 - 1, 2, 2);
  }
  c.restore();
}

function drawLibraryStoneFloor(c, ds) {
  const hair = 1 / Math.max(1, ds), rng = mulberry32(0x1B1A44);
  c.save(); c.fillStyle = "#747984"; c.fillRect(0, 0, MAP_W * TILE, MAP_H * TILE);
  // Staggered 3×2-tile slate flags remove the old 32px checkerboard while retaining hand-cut joints.
  const tones = ["#747984","#7c818b","#6d727d","#80858e","#707681"];
  for (let row = 0, y = 0; y < MAP_H * TILE; row++, y += 2 * TILE) {
    const offset = row % 2 ? -1.5 * TILE : 0;
    for (let x = offset; x < MAP_W * TILE; x += 3 * TILE) {
      c.fillStyle = tones[Math.floor(rng() * tones.length)]; c.fillRect(x, y, 3 * TILE, 2 * TILE);
      c.fillStyle = "rgba(230,235,240,0.055)"; c.fillRect(x, y, 3 * TILE, hair);
      c.fillStyle = "rgba(25,30,40,0.18)"; c.fillRect(x, y + 2 * TILE - hair, 3 * TILE, hair);
      c.fillRect(x + 3 * TILE - hair, y, hair, 2 * TILE);
    }
  }
  // Sparse physical-pixel mineral flecks are true DPR detail, not a scaled legacy texture.
  for (let i = 0; i < 180; i++) {
    const x = rng() * MAP_W * TILE, y = rng() * MAP_H * TILE;
    c.fillStyle = rng() < 0.55 ? "rgba(225,230,236,0.10)" : "rgba(26,31,42,0.16)";
    c.fillRect(x, y, hair, hair);
  }
  const g = c.createRadialGradient(18 * TILE, 10 * TILE, TILE, 18 * TILE, 10 * TILE, 18 * TILE);
  g.addColorStop(0, "rgba(218,224,230,0.10)"); g.addColorStop(1, "rgba(20,24,34,0.14)");
  c.fillStyle = g; c.fillRect(0, 0, MAP_W * TILE, MAP_H * TILE); c.restore();
}

function drawLibraryArchitecture(c, ds) {
  const hair = 1 / Math.max(1, ds);
  c.save();
  // Brass aisle rails organize the continuous slate hall without adding collision.
  c.strokeStyle = "rgba(176,138,70,0.38)";
  for (const x of [11.5, 24.5]) { c.beginPath(); c.moveTo(x * TILE, 4 * TILE); c.lineTo(x * TILE, 22.5 * TILE); c.stroke(); }

  // Dark walnut shelf alcoves, with brass cap rails, sit behind the existing bookshelf sprites.
  for (const box of [[3.45,0.75,11.15,4.35],[25.45,0.75,33.15,4.35]]) {
    c.fillStyle = "rgba(31,24,25,0.72)"; c.fillRect(box[0] * TILE, box[1] * TILE, (box[2]-box[0]) * TILE, (box[3]-box[1]) * TILE);
    c.strokeStyle = "rgba(176,138,70,0.66)"; c.strokeRect(box[0] * TILE, box[1] * TILE, (box[2]-box[0]) * TILE, (box[3]-box[1]) * TILE);
    for (let x = box[0] + 0.5; x < box[2]; x += 1) {
      c.fillStyle = "rgba(232,223,200,0.10)"; c.fillRect(x * TILE, box[1] * TILE + 3, hair, (box[3]-box[1]) * TILE - 6);
    }
  }

  // Warm reading pools are baked once; they never flicker or obscure study text.
  for (const p of [[14,9.5],[22,9.5],[5,20.5],[33,20.5]]) {
    const g = c.createRadialGradient(p[0] * TILE, p[1] * TILE, 2, p[0] * TILE, p[1] * TILE, 2.8 * TILE);
    g.addColorStop(0, "rgba(242,179,93,0.13)"); g.addColorStop(1, "rgba(242,179,93,0)");
    c.fillStyle = g; c.fillRect((p[0]-3) * TILE, (p[1]-3) * TILE, 6 * TILE, 6 * TILE);
  }

  // The reading rug's signature is an open-book/compass medallion, not generic ornament.
  const cx = 17.5 * TILE, cy = 9.7 * TILE;
  c.strokeStyle = "rgba(232,199,123,0.72)"; c.lineWidth = hair;
  c.beginPath(); c.arc(cx, cy, 30, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(cx, cy - 17); c.lineTo(cx, cy + 16);
  c.moveTo(cx, cy - 13); c.quadraticCurveTo(cx - 16, cy - 20, cx - 23, cy - 7);
  c.lineTo(cx - 23, cy + 12); c.quadraticCurveTo(cx - 11, cy + 5, cx, cy + 15);
  c.moveTo(cx, cy - 13); c.quadraticCurveTo(cx + 16, cy - 20, cx + 23, cy - 7);
  c.lineTo(cx + 23, cy + 12); c.quadraticCurveTo(cx + 11, cy + 5, cx, cy + 15); c.stroke();

  const stationColors = ["#a855f7","#f97316","#3b82f6","#06b6d4"];
  [7,15,22,30].forEach((x, i) => {
    c.strokeStyle = stationColors[i] + "88"; c.strokeRect((x - 0.35) * TILE, 13.65 * TILE, 1.7 * TILE, 1.7 * TILE);
    c.fillStyle = stationColors[i] + "99"; c.fillRect(x * TILE - 1, 13.82 * TILE, 2, 5);
  });
  c.restore();
}

function buildMapCanvas() {
  const cv = document.createElement("canvas");
  cv.width  = Math.round(MAP_W * TILE * MAP_DETAIL_SCALE);
  cv.height = Math.round(MAP_H * TILE * MAP_DETAIL_SCALE);
  cv.detailScale = MAP_DETAIL_SCALE;  // tag for camera source rect
  const c = cv.getContext("2d");
  c.imageSmoothingEnabled = false;
  const ds = MAP_DETAIL_SCALE;        // local convenience
  c.scale(ds, ds);                    // all logical-coord draws scale to detail pixels
  // Warm-hardwood floor base under everything walkable (#021); brick / window / column /
  // duct / glass for structural chars. Each blit falls back to a flat tileColor() fill if
  // its PNG is missing, so a 404 degrades gracefully instead of leaving a black square.
  // Each floor cell is a 1:1 window into the single continuous plank texture (#022) — no
  // tiling, no repeat, no seams. Falls back to a flat warm fill only if texture build fails.
  // Source rect from detail-scaled texture matches the detail canvas target.
  const tex = buildFloorTexture();
  const floorBase = (sx, sy, x, y) => {
    if (tex) c.drawImage(tex, sx * ds, sy * ds, TILE * ds, TILE * ds, sx, sy, TILE, TILE);
    else { c.fillStyle = tileColor("F", x, y); c.fillRect(sx, sy, TILE, TILE); }
  };
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const sx = x * TILE, sy = y * TILE;
      const t = map[y][x];
      if (t === "#") {
        const brick = (x % 6 === 0 || y % 6 === 0) ? "brick-white" : "brick-red";
        if (!blitTile(c, brick, sx, sy) && !blitTile(c, wallSlug(x, y), sx, sy)) {
          c.fillStyle = tileColor(t, x, y); c.fillRect(sx, sy, TILE, TILE);
          c.fillStyle = "#1e293b"; c.fillRect(sx, sy + TILE - 6, TILE, 6);
        }
      } else if (t === "W") {
        if (!blitTile(c, "window-h", sx, sy)) { c.fillStyle = tileColor(t, x, y); c.fillRect(sx, sy, TILE, TILE); }
      } else if (t === "O") {
        if (!blitTile(c, "column", sx, sy)) { c.fillStyle = tileColor(t, x, y); c.fillRect(sx, sy, TILE, TILE); }
      } else if (t === "U") {
        if (!blitTile(c, "duct", sx, sy)) { c.fillStyle = tileColor(t, x, y); c.fillRect(sx, sy, TILE, TILE); }
      } else if (t === "G") {
        // glass wall: hardwood base + translucent tint (no glass *tile* exists; the glass-wall
        // PROP bakes on top in the prop pass below where placed)
        floorBase(sx, sy, x, y);
        c.fillStyle = "rgba(150,200,220,0.30)"; c.fillRect(sx, sy, TILE, TILE);
        c.fillStyle = "rgba(225,242,250,0.55)"; c.fillRect(sx, sy, TILE, 3);
      } else if (t === "D" || t === "P" || t === "C") {
        // floor base FIRST (objects sit on floor; PNGs have transparent margins)
        floorBase(sx, sy, x, y);
        const objSlug = t === "D" ? "desk" : t === "P" ? "plant" : "coffee";
        if (!blitTile(c, objSlug, sx, sy)) {
          if (t === "D") {
            c.fillStyle = "#92651a"; c.fillRect(sx + 2, sy + 8, TILE - 4, TILE - 12);
            c.fillStyle = "#0f172a"; c.fillRect(sx + 8, sy + 11, 16, 10); // monitor
            c.fillStyle = "#38bdf8"; c.fillRect(sx + 10, sy + 13, 12, 6); // screen
          } else if (t === "P") {
            c.fillStyle = "#7f4f24"; c.fillRect(sx + 10, sy + 18, 12, 10);
            c.fillStyle = "#16a34a";
            c.fillRect(sx + 8, sy + 6, 16, 14);
            c.fillRect(sx + 12, sy + 2, 8, 8);
          } else if (t === "C") {
            c.fillStyle = "#0f172a"; c.fillRect(sx + 4, sy + 4, TILE - 8, TILE - 8);
            c.fillStyle = "#ef4444"; c.fillRect(sx + 8, sy + 8, 6, 4);
            c.fillStyle = "#fbbf24"; c.fillRect(sx + 8, sy + 16, 16, 6); // coffee glow
          }
        }
      } else if (t === "~") {
        if (!blitTile(c, "rug", sx, sy)) { c.fillStyle = tileColor(t, x, y); c.fillRect(sx, sy, TILE, TILE); }
      } else { // floor "." , furniture base "F", and any unrecognized → hardwood floor
        floorBase(sx, sy, x, y);
      }
    }
  }

  drawOfficeZoneIdentity(c, ds);

  // ---- A3: cosmetic seam runners inlaid along zone boundaries (walkway gaps left open) ----
  // A 2px groove + faint highlight straddling the grid line reads as an inlaid threshold
  // between rooms. Drawn over the floor but BEFORE props, so desks/furniture sit on top.
  const groove = "rgba(40,22,6,0.40)", sheen = "rgba(255,228,188,0.13)";
  for (const bx of [12, 24]) {                       // vertical seams
    const px0 = bx * TILE;
    for (let yy = 0; yy < MAP_H; yy++) {
      if (SEAM_VGAPS.has(yy)) continue;
      c.fillStyle = groove; c.fillRect(px0 - 1, yy * TILE, 2, TILE);
      c.fillStyle = sheen;  c.fillRect(px0 + 1, yy * TILE, 1, TILE);
    }
  }
  {                                                   // horizontal seam y=11
    const py0 = 11 * TILE;
    for (let xx = 0; xx < MAP_W; xx++) {
      if (SEAM_HGAPS.has(xx)) continue;
      c.fillStyle = groove; c.fillRect(xx * TILE, py0 - 1, TILE, 2);
      c.fillStyle = sheen;  c.fillRect(xx * TILE, py0 + 1, TILE, 1);
    }
  }

  // Reviewed practical-light overlay remains optional and placement-bounded.
  if (typeof DatamonWorldArt !== "undefined") {
    const light = DatamonWorldArt.getHDAsset("agent-wing-lighting", "overlay", "office");
    if (light && light.entry.placement) {
      c.drawImage(light.image, light.entry.placement.col * TILE, light.entry.placement.row * TILE,
                  light.entry.widthPx, light.entry.heightPx);
    }
  }

  // ---- Baked prop layer (#021): anchored office cutouts, drawn BEHIND characters ----
  // Reviewed HD cutouts replace only their matching Agent Wing placements. Every missing,
  // invalid, or unaccepted member resolves through the legacy prop contract.
  for (const p of PROP_PLACEMENTS) {
    const legacyMeta = propManifest.find(m => m.slug === p.slug);
    const hd = (typeof DatamonWorldArt !== "undefined")
      ? DatamonWorldArt.getHDAsset(p.slug, "prop", "office") : null;
    const useHD = hd && (!hd.entry.zone || regionOf(p.col, p.row) === hd.entry.zone);
    const meta = useHD ? hd.entry : legacyMeta;
    if (!meta) continue;
    const dx = p.col * TILE + (meta.anchorX || 0), dy = p.row * TILE;
    const img = useHD ? hd.image : propStore[p.slug];
    if (img) {
      c.drawImage(img, dx, dy, meta.widthPx, meta.heightPx);
    } else {
      c.fillStyle = "#8a8f98";
      c.fillRect(p.col * TILE, p.row * TILE, (meta.tileW || 1) * TILE, (meta.tileH || 1) * TILE);
    }
  }

  // Library entrance: bake the ornate library door over the office "L" warp tile so the
  // entrance reads as a real doorway instead of a bare gap in the brick. lib-door lives in
  // libStore (loadLibraryAssets resolves before this runs at boot); bottom-anchored on the
  // south-wall tile, overhanging upward. Falls back to the plain floor gap if the asset is absent.
  {
    const [dcol, drow] = OFFICE_DOOR_TILE;
    const dmeta = libManifest.find(m => m.slug === "lib-door");
    const dimg = libStore["lib-door"];
    if (dimg && dmeta) {
      c.drawImage(dimg, dcol * TILE, (drow + 1) * TILE - dmeta.heightPx, dmeta.widthPx, dmeta.heightPx);
    }
  }
  return cv;
}

// ---------- Library map canvas (#026) ----------
// Renders LIBRARY_MAP to a 1152×768 canvas. No seam runners. No PROP_PLACEMENTS.
// Explicit fallback fill colors for every cell type — do NOT rely on tileColor() (office-only).
function buildLibraryMapCanvas() {
  const cv = document.createElement("canvas");
  cv.width  = Math.round(MAP_W * TILE * MAP_DETAIL_SCALE);
  cv.height = Math.round(MAP_H * TILE * MAP_DETAIL_SCALE);
  cv.detailScale = MAP_DETAIL_SCALE;  // tag for camera source rect
  const c = cv.getContext("2d");
  c.imageSmoothingEnabled = false;
  const ds = MAP_DETAIL_SCALE;
  c.scale(ds, ds);
  drawLibraryStoneFloor(c, ds);

  // Helper: blit a library tile (32×32) from libStore; returns true on success.
  function blitLibTile(slug, sx, sy) {
    if (libStore[slug]) { c.drawImage(libStore[slug], sx, sy, TILE, TILE); return true; }
    return false;
  }

  // Floor + walls. Door ("L"), stations ("S") and solid decor ("O") all render as a
  // plain floor tile here; their sprites are baked on top from LIBRARY_DECOR below, so
  // a 48px-tall prop can overhang the tile cleanly. The floor is clean grey stone with
  // a sparse slate accent (no striping); the central reading nook is a red-carpet rug.
  const R = LIBRARY_RUG;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const sx = x * TILE, sy = y * TILE;
      if (LIBRARY_MAP[y][x] === "#") {
        if (!blitLibTile("lib-wall", sx, sy)) { c.fillStyle = "#3b2f24"; c.fillRect(sx, sy, TILE, TILE); }
        continue;
      }
      const inRug = x >= R.x0 && x <= R.x1 && y >= R.y0 && y <= R.y1;
      // Non-rug cells already expose the continuous deterministic slate floor beneath.
      // Only the central textile uses a tile texture, bounded by one room-scale brass border.
      if (inRug && !blitLibTile("lib-floor-b", sx, sy)) {
        c.fillStyle = "#6b353b"; c.fillRect(sx, sy, TILE, TILE);
      }
    }
  }
  // Single gold border around the reading-nook rug (drawn once, not per tile).
  c.strokeStyle = "#b08a46"; c.lineWidth = 3;
  c.strokeRect(R.x0 * TILE + 2, R.y0 * TILE + 2,
               (R.x1 - R.x0 + 1) * TILE - 4, (R.y1 - R.y0 + 1) * TILE - 4);
  drawLibraryArchitecture(c, ds);

  // Bake bookshelves (top-anchored 1×3 props) then decor/furniture (bottom-anchored so
  // a 48px sprite sits feet-on-tile, overhanging 16px upward; a 64px table spans 2 cols).
  for (const p of LIBRARY_PROP_PLACEMENTS) {
    const meta = libManifest.find(m => m.slug === p.slug);
    const dx = p.col * TILE + ((meta && meta.anchorX) || 0), dy = p.row * TILE;
    const img = libStore[p.slug];
    if (img && meta) c.drawImage(img, dx, dy, meta.widthPx, meta.heightPx);
    else { c.fillStyle = "#8a6a44"; c.fillRect(p.col * TILE, p.row * TILE, TILE, 3 * TILE); }
  }
  for (const p of LIBRARY_DECOR) {
    const meta = libManifest.find(m => m.slug === p.slug);
    const img = libStore[p.slug];
    if (img && meta) {
      c.drawImage(img, p.col * TILE, (p.row + 1) * TILE - meta.heightPx, meta.widthPx, meta.heightPx);
    } else {
      c.fillStyle = "#7a5a36"; c.fillRect(p.col * TILE, p.row * TILE, TILE, TILE);   // drawn fallback
    }
  }

  return cv;
}

// Zone labels centered on the new 3×2 office partition (see regionOf()).
// [text, tileX-center, tileY, zone-type]. Y sits near the top of each 3×2 band (top
// row ≈2.6, bottom row just below the y=11 divider) so names read as room headers
// above the characters rather than behind them. Type keys the accent color.
const OVERWORLD_LABELS = [["AGENT WING", 6, 2.6, "AGENT"], ["MCP LAB", 18, 2.6, "MCP"], ["CONFIG BAY", 29, 2.6, "CONFIG"],
                          ["CONTEXT CORNER", 6, 11.6, "CONTEXT"], ["PROMPT STUDIO", 18, 11.6, "PROMPT"], ["THE LOUNGE", 29, 11.6, "MIX"],
                          // Wayfinding sign floating above the library warp door (OFFICE_DOOR_TILE [24,23]) — SPACE on the door
                          // to enter. Row 19.5 keeps it clear of the player standing at the door (row 22) and above the door sprite.
                          ["LIBRARY ↓", 24, 19.5, "CONTEXT"]];
const LIBRARY_DUST_POINTS = Object.freeze([[6,7],[11,12],[17,5],[20,17],[25,7],[29,18],[33,10],[15,20]]);
const PROMPT_CURSOR_POINTS = Object.freeze([[15.2,16.35],[21.2,16.35],[15.2,19.35],[21.2,19.35]]);

// Seven bounded, particle-free living-world loops. They are cosmetic and draw above the
// cached architecture but below labels/characters. Reduced motion pins every loop to phase 0.
function drawLivingWorldAmbient() {
  if (typeof DatamonWorldArt === "undefined") return;
  const phase = DatamonWorldArt.getAmbientPhase(2400);
  const sx = x => (x - camFx) * TILE;
  const sy = y => (y - camFy) * TILE;
  ctx.save();
  if (currentMap === "office") {
    // MCP: five tool-port pips chase along the routed floor bus.
    for (let i = 0; i < 5; i++) {
      const active = Math.floor(phase * 5) === i;
      ctx.fillStyle = active ? "rgba(199,157,255,0.90)" : "rgba(168,85,247,0.32)";
      ctx.fillRect(sx(14.3 + i * 1.75) - 2, sy(7) - 2, active ? 4 : 3, active ? 4 : 3);
    }
    // Config: two restrained coffee-steam filaments rise from the real counter.
    ctx.strokeStyle = "rgba(232,223,200,0.30)"; ctx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      const lift = ((phase + i * 0.42) % 1) * 13;
      const x = sx(31.5) + i * 5, y = sy(2.35) - lift;
      ctx.beginPath(); ctx.moveTo(x, y + 10); ctx.quadraticCurveTo(x + (i ? -3 : 3), y + 5, x, y); ctx.stroke();
    }
    // Context: one glass reflection traverses the meeting-room panes.
    ctx.save(); ctx.beginPath(); ctx.rect(sx(1), sy(15), 8 * TILE, 8 * TILE); ctx.clip();
    const glassX = sx(1.2 + phase * 7.4);
    ctx.strokeStyle = "rgba(207,243,248,0.18)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(glassX, sy(15.5)); ctx.lineTo(glassX + 38, sy(22.5)); ctx.stroke(); ctx.restore();
    // Prompt: editorial cursors blink together at the four drafting stations.
    ctx.fillStyle = phase < 0.52 ? "rgba(255,205,133,0.78)" : "rgba(249,115,22,0.22)";
    for (const p of PROMPT_CURSOR_POINTS) ctx.fillRect(sx(p[0]), sy(p[1]), 5, 2);
    // Lounge: the certification-compass inlay breathes once per cycle.
    ctx.strokeStyle = `rgba(242,179,93,${0.12 + 0.14 * Math.sin(phase * Math.PI)})`;
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sx(29), sy(12.85), 21 + phase * 5, 0, Math.PI * 2); ctx.stroke();
  } else if (currentMap === "library") {
    // Fixed dust positions drift a few pixels; there is no particle allocation or random state.
    for (let i = 0; i < LIBRARY_DUST_POINTS.length; i++) {
      const p = LIBRARY_DUST_POINTS[i], local = (phase + i * 0.137) % 1;
      ctx.fillStyle = `rgba(232,223,200,${0.10 + (i % 3) * 0.035})`;
      ctx.fillRect(sx(p[0]) + Math.sin(local * Math.PI * 2) * 3, sy(p[1]) - local * 7, i % 2 ? 2 : 1, i % 2 ? 2 : 1);
    }
    // Lamp pools breathe by alpha only; phase zero remains a complete static composition.
    const glow = 0.08 + Math.sin(phase * Math.PI) * 0.045;
    for (const p of [[4.5,20.2],[32.5,20.2]]) {
      const g = ctx.createRadialGradient(sx(p[0]), sy(p[1]), 2, sx(p[0]), sy(p[1]), 44);
      g.addColorStop(0, `rgba(242,179,93,${glow})`); g.addColorStop(1, "rgba(242,179,93,0)");
      ctx.fillStyle = g; ctx.fillRect(sx(p[0]) - 44, sy(p[1]) - 44, 88, 88);
    }
  }
  ctx.restore();
}

function drawOverworld() {
  if (!mapCv) return;
  // Focus follows the player normally; during a search scout it pans to the target NPC
  // (phase out→hold) then back to the player (phase back) before returning control.
  const panToNpc = scout && scout.phase !== "back";
  const foX = panToNpc ? scout.npc.x : player.fx;
  const foY = panToNpc ? scout.npc.y : player.fy;
  const targetCamX = Math.max(0, Math.min(MAP_W - VIEW_W, foX - VIEW_W / 2 + 0.5));
  // top clamp allows -CAM_PAD_TOP so the player can be pushed below the HUD near the top edge
  const targetCamY = Math.max(-CAM_PAD_TOP, Math.min(MAP_H - VIEW_H, foY - VIEW_H / 2 + 0.5));
  if (camFx === null) { camFx = targetCamX; camFy = targetCamY; }       // first frame: snap, no glide-in
  else {
    camFx += (targetCamX - camFx) * 0.12;
    camFy += (targetCamY - camFy) * 0.12;
  }
  camFx = Math.max(0, Math.min(MAP_W - VIEW_W, camFx));                 // re-clamp to map bounds
  camFy = Math.max(-CAM_PAD_TOP, Math.min(MAP_H - VIEW_H, camFy));
  if (scout) {
    const near = Math.abs(camFx - targetCamX) < 0.06 && Math.abs(camFy - targetCamY) < 0.06;
    if (scout.phase === "out" && near) { scout.phase = "hold"; scout.until = performance.now() + 1400; }
    else if (scout.phase === "hold" && performance.now() > scout.until) scout.phase = "back";
    else if (scout.phase === "back" && near) scout = null;             // home again → resume control
  }

  // backdrop behind any over-scrolled strip (top letterbox when camFy<0). The map drawImage
  // covers the full canvas whenever camFy>=0, so this only shows near the top edge.
  ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 9-arg drawImage: source rect from the pre-rendered map, dest = full canvas.
  // When map cache has a detailScale, use DatamonWorldArt.cameraSourceRect for
  // exact physical-pixel source coordinates.
  if (typeof DatamonWorldArt !== "undefined" && mapCv.detailScale) {
    var src = DatamonWorldArt.cameraSourceRect(camFx, camFy, TILE, CANVAS_W, CANVAS_H, mapCv.detailScale);
    ctx.drawImage(mapCv, src.sx, src.sy, src.sw, src.sh, 0, 0, CANVAS_W, CANVAS_H);
  } else {
    ctx.drawImage(mapCv,
      -Math.round(-camFx * TILE), -Math.round(-camFy * TILE), CANVAS_W, CANVAS_H,
      0, 0, CANVAS_W, CANVAS_H);
  }

  // Scene-local weather/display/practical-light loops sit above architecture and below
  // labels/characters. Missing sheets are simply absent; frame zero is immediate in reduced motion.
  if (typeof DatamonWorldArt !== "undefined") {
    DatamonWorldArt.drawAmbient(ctx, currentMap, camFx, camFy, TILE, "back");
  }
  drawLivingWorldAmbient();

  // room labels — frosted nameplates: a dark rounded pill with a zone-accent underline
  // (same palette as the "!" markers) so each zone name reads as legible signage on top
  // of the busy floor instead of low-contrast text getting lost in the planks.
  const labels = currentMap === "office" ? OVERWORLD_LABELS : LIBRARY_LABELS;
  ctx.font = "bold 13px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const [txt, lx, ly, type] of labels) {
    const sx = px((lx - camFx) * TILE), sy = px((ly - camFy) * TILE);
    const tw = ctx.measureText(txt).width;
    const padX = 14, h = 26, w = tw + padX * 2;
    const bx = px(sx - w / 2), by = px(sy - h / 2);
    const accent = TYPE_COLORS[type] || "#94a3b8";
    ctx.fillStyle = "rgba(15,23,42,0.74)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 7); else ctx.rect(bx, by, w, h);
    ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(148,163,184,0.22)"; ctx.stroke();
    ctx.fillStyle = accent;                                  // accent underline
    ctx.fillRect(bx + padX, by + h - 6, w - padX * 2, 2);
    ctx.fillStyle = "rgba(241,245,249,0.96)";                // light label text
    ctx.fillText(txt, sx, sy - 1);
  }
  ctx.textBaseline = "alphabetic";

  // Painter's algorithm: collect every on-screen character (NPCs + player) into one
  // list, sort back-to-front by feet-Y (tie-break x), and draw in that order so a
  // character standing further south (lower on screen, closer to the viewer) always
  // draws on top — whether that's the player or an NPC. sy carries a constant offset
  // from feet-Y, so sorting by sy is equivalent. The comparator reads only; it never
  // mutates any NPC/player position field.
  const onScreen = (sx, sy) => sx >= -TILE && sx <= CANVAS_W + TILE && sy >= -TILE && sy <= CANVAS_H + TILE;
  const isSolidTile = (tx, ty) =>
    ty >= 0 && ty < MAP_H && tx >= 0 && tx < MAP_W && SOLID.has(map[ty][tx]);

  const chars = [];
  for (const n of npcs) {
    const sx = (n.x - camFx) * TILE + TILE / 2, sy = (n.y - camFy) * TILE + TILE / 2;
    if (!onScreen(sx, sy)) continue;
    chars.push({ sx, sy, slug: n.slug, dir: "down", isPlayer: false, bob: !n.defeated, tx: n.x, ty: n.y, npc: n });
  }
  {
    const sx = (player.fx - camFx) * TILE + TILE / 2, sy = (player.fy - camFy) * TILE + TILE / 2;
    chars.push({ sx, sy, slug: player.slug, dir: player.dir, isPlayer: true, bob: player.moving,
                 tx: Math.round(player.fx), ty: Math.round(player.fy), npc: null });
  }
  // Visual-only detail entities join the feet-Y sort but never touch map/SOLID collision.
  if (currentMap === "office" && typeof DatamonWorldArt !== "undefined") {
    for (const item of DatamonWorldArt.getVisualDetailPlacements("office")) {
      const p = item.placement, e = item.entry;
      const sx = (p.col - camFx) * TILE + (e.anchorX || 0);
      const top = (p.row - camFy) * TILE;
      chars.push({ worldArt: item, sx, top, sy: top + e.heightPx, tx: p.col, ty: p.row });
    }
  }
  chars.sort((a, b) => (a.sy - b.sy) || (a.sx - b.sx));   // back-to-front, tie-break x

  for (const c of chars) {
    if (c.worldArt) {
      const e = c.worldArt.entry;
      ctx.drawImage(c.worldArt.image, c.sx, c.top, e.widthPx, e.heightPx);
      if (e.id === "hd-collaboration-table") {
        DatamonWorldArt.drawAmbientEntry(ctx, "hd-amb-table", camFx, camFy, TILE);
      }
    } else {
      drawCharacter(c.sx, c.sy, c.slug, c.dir, c.isPlayer, c.bob, isSolidTile(c.tx, c.ty - 1));
    }
  }

  // Footfall dust (PRD 004 / #017): draw each live puff in screen space (camera-relative),
  // fading via alpha = life/maxLife. Pure draw — ageing + pruning happen in updateOverworld.
  if (dustParticles.length) {
    ctx.fillStyle = "#d4c4a0";
    for (const d of dustParticles) {
      const dsx = (d.x - camFx) * TILE + TILE / 2;
      const dsy = (d.y - camFy) * TILE + TILE / 2;
      ctx.globalAlpha = (d.life / d.maxLife) * 0.55;
      ctx.fillRect(px(dsx), px(dsy), 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  // Defeat markers in a separate pass AFTER all characters, so they always render on
  // top regardless of the depth-sort order.
  for (const c of chars) {
    if (c.isPlayer) continue;
    const { sx, sy, npc } = c;
    if (npc.defeated) {
      ctx.fillStyle = "#22c55e"; ctx.font = "bold 14px monospace"; ctx.textAlign = "center";
      ctx.fillText("✓", px(sx + 12), px(sy - 26));
    } else {
      ctx.fillStyle = TYPE_COLORS[npc.type]; ctx.font = "bold 12px monospace"; ctx.textAlign = "center";
      ctx.fillText("!", px(sx), px(sy - 46 + Math.sin(frame / 10) * 2));
    }
  }

  // Scout highlight: pulsing accent ring on the searched colleague + a top banner.
  if (scout && scout.npc) {
    const n = scout.npc;
    const sx = (n.x - camFx) * TILE + TILE / 2, sy = (n.y - camFy) * TILE + TILE / 2;
    const accent = TYPE_COLORS[n.type], pulse = 1 + Math.sin(frame / 6) * 0.12;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.35; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.ellipse(px(sx), px(sy + 8), 22 * pulse, 11 * pulse, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.95; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(px(sx), px(sy + 8), 22 * pulse, 11 * pulse, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    const label = `\u2192 ${displayName(n.slug)} \u00b7 ${TYPE_NAMES[n.type]} \u00b7 ${n.defeated ? "\u2713 bested" : "not yet bested"}`;
    ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const bw = ctx.measureText(label).width + 34, bx = CANVAS_W / 2 - bw / 2, by = 84;
    ctx.fillStyle = "rgba(15,23,42,0.92)";
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, 30, 8); else ctx.rect(bx, by, bw, 30); ctx.fill();
    ctx.fillStyle = accent; ctx.fillRect(bx, by, 4, 30);
    ctx.fillStyle = "#f1f5f9"; ctx.fillText(label, CANVAS_W / 2 + 2, by + 16);
    ctx.textBaseline = "alphabetic";
  }

  // HUD
  ctx.fillStyle = "rgba(15,23,42,0.85)";
  ctx.fillRect(8, 8, 250, 64);
  ctx.drawImage(pixelHead(player.slug, 48), 16, 16, 48, 48);
  drawHPBar(66, 38, 140, 10, player.dispHp / MAX_HP, firstName(player.slug) + "  HP " + player.hp + "/" + MAX_HP);
  ctx.fillStyle = "#94a3b8"; ctx.font = "12px monospace"; ctx.textAlign = "left";
  ctx.fillText(`Rivals bested: ${defeated.size}/${rivalTotal}`, 66, 62);
  ctx.fillStyle = "rgba(148,163,184,0.55)"; ctx.font = "11px monospace"; ctx.textAlign = "left";
  ctx.fillText("/  find a colleague", 12, CANVAS_H - 14);

  // facing hint
  const [tx, ty] = facingTile();
  const target = npcs.find(n => n.x === tx && n.y === ty && !n.defeated);
  if (target && !scout) {
    ctx.fillStyle = "rgba(15,23,42,0.85)";
    const msg = `SPACE: battle ${displayName(target.slug)} [${target.type}]`;
    ctx.font = "bold 14px monospace";
    const w = ctx.measureText(msg).width + 24;
    ctx.fillRect(CANVAS_W / 2 - w / 2, CANVAS_H - 44, w, 30);
    ctx.fillStyle = TYPE_COLORS[target.type]; ctx.textAlign = "center";
    ctx.fillText(msg, CANVAS_W / 2, CANVAS_H - 24);
  }
}

// battle layout rects (for mouse hit testing)
let RUN_RECT = [-1, -1, 0, 0];   // overworld-safe default; set each frame by layoutChoices()
const CHOICE_RECTS = [];
function layoutChoices() {
  CHOICE_RECTS.length = 0;
  const bx = 24, by = CANVAS_H - 176, bw = CANVAS_W - 48, bh = 160;
  const cw = (bw - 36) / 2, ch = 42;
  for (let i = 0; i < 4; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    CHOICE_RECTS.push([bx + 12 + col * (cw + 12), by + 58 + row * (ch + 8), cw, ch]);
  }
  RUN_RECT = [bx + bw - 88, by + 8, 76, 26];
  return { bx, by, bw, bh };
}
function choiceHitTest(mx, my) {
  for (let i = 0; i < CHOICE_RECTS.length; i++) {
    const [x, y, w, h] = CHOICE_RECTS[i];
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) return i;
  }
  return -1;
}
function runHitTest(mx, my) {
  const [x, y, w, h] = RUN_RECT;
  return mx >= x && mx <= x + w && my >= y && my <= y + h;
}

// ---- Agent Operations drawing helpers ----

// Agent Operations geometry. Action and answer rectangles are intentionally
// separate, uncached functions; renderer and pointer paths consume these same
// values so responsive/DPR drawing can never drift from hit-testing.
function _agentActionRects() {
  if (typeof AgentArena !== "undefined") return AgentArena.actionRects();
  return [[24, 466, 368, 56], [408, 466, 368, 56], [24, 532, 368, 56], [408, 532, 368, 56]];
}

function _agentChoiceRects() {
  if (typeof AgentArena !== "undefined") return AgentArena.choiceRects();
  return [[24, 478, 368, 50], [408, 478, 368, 50], [24, 538, 368, 50], [408, 538, 368, 50]];
}

function _agentRunRect() {
  return typeof AgentArena !== "undefined" ? AgentArena.runRect() : [700, 408, 76, 26];
}

function _hitRectList(rects, mx, my) {
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    if (mx >= r[0] && mx <= r[0] + r[2] && my >= r[1] && my <= r[1] + r[3]) return i;
  }
  return -1;
}

function _agentActionHitTest(mx, my) { return _hitRectList(_agentActionRects(), mx, my); }
function _agentChoiceHitTest(mx, my) { return _hitRectList(_agentChoiceRects(), mx, my); }
function _agentRunHitTest(mx, my) {
  var r = _agentRunRect();
  return mx >= r[0] && mx <= r[0] + r[2] && my >= r[1] && my <= r[1] + r[3];
}

// Draw Agent Operations encounter with action menu, Momentum/Guardrail/Stability HUD.
// Agent Operations Incident Command arena renderer.
// Delegates to AgentArena module; draw is read-only over combat state.
function _agentDrawBattle(b) {
  if (typeof AgentArena === "undefined") {
    // Complete no-module fallback: combat remains keyboard/pointer playable and
    // every reducer-owned value/question is visible instead of a dead title card.
    var ao = b.agentOps;
    ctx.fillStyle = "#081426"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "#45d7e8"; ctx.font = "bold 18px monospace"; ctx.textAlign = "center";
    ctx.fillText("AGENT OPERATIONS // PROCEDURAL FALLBACK", CANVAS_W / 2, 36);
    ctx.fillStyle = "#e8dfc8"; ctx.font = "bold 13px monospace";
    ctx.fillText("Stability " + ao.stability + "/" + ao.maxStability + " · Momentum " + ao.momentum + "/3 · Guardrail " + (ao.guardrail ? "ACTIVE" : "OFF") + " · HP " + ao.playerHp, CANVAS_W / 2, 66);
    ctx.textAlign = "left"; ctx.fillStyle = "#f2b35d"; ctx.font = "bold 12px monospace";
    ctx.fillText((ao.question && ao.question.q || "Question unavailable").slice(0, 105), 24, 430);
    var rects = ao.phase === "action" ? _agentActionRects() : _agentChoiceRects();
    if (ao.phase === "action" || ao.phase === "choice") {
      rects.forEach(function (r, i) {
        ctx.fillStyle = "#0f1f35"; ctx.fillRect(r[0], r[1], r[2], r[3]);
        ctx.strokeStyle = "#2f6fed"; ctx.strokeRect(r[0], r[1], r[2], r[3]);
        ctx.fillStyle = "#e2e8f0"; ctx.font = "11px monospace";
        var text = ao.phase === "action"
          ? (i + 1) + ". " + DatamonBattleOps.ACTIONS[DatamonBattleOps.ACTION_KEYS[i]].label + " — " + DatamonBattleOps.ACTIONS[DatamonBattleOps.ACTION_KEYS[i]].desc
          : (i + 1) + ". " + (ao.question && ao.question.c[i] || "");
        ctx.fillText(text.slice(0, 52), r[0] + 10, r[1] + 30);
      });
    } else {
      ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 13px monospace";
      ctx.fillText((b.msg || "Continue").slice(0, 100), 24, 485);
    }
    return;
  }

  ctx.save();
  AgentArena.draw(b, ctx, frame, dtF);
  // Agent impact/entrance treatment lives in AgentArena; legacy white/red
  // full-canvas flashes are intentionally absent for reduced-motion parity.
  ctx.restore();
}

function drawBattle() {
  const b = battle;
  if (b.agentOps) { _agentDrawBattle(b); return; }
  const shakeX = b.shake > 0 ? (Math.random() - 0.5) * b.shake : 0;
  if (b.shake > 0) b.shake = Math.max(0, b.shake - dtF);

  ctx.save();
  ctx.translate(shakeX, 0);

  // backdrop
  ctx.fillStyle = battleGrad; ctx.fillRect(-20, 0, CANVAS_W + 40, CANVAS_H);

  const typeColor = TYPE_COLORS[b.npc.type];
  const mon = currentMon();

  // entrance: trainers + platforms slide in from the sides
  const ee = 1 - Math.pow(1 - Math.min(1, (frame - b.startF) / 30), 3);
  const oppX = CANVAS_W - 200 + (1 - ee) * 280;
  const plyX = 190 - (1 - ee) * 280;

  // platforms
  ctx.fillStyle = "rgba(148,163,184,0.18)";
  ctx.beginPath(); ctx.ellipse(oppX, 252, 130, 30, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(plyX, 404, 130, 30, 0, 0, 7); ctx.fill();

  // opponent trainer sprite, standing on the far platform
  drawTrainer(b.npc.slug, oppX, 268, 256, 4);

  // player trainer sprite, near platform
  drawTrainer(player.slug, plyX, 420, 192, 0);

  // ---- the mon: scale-in on sendout, idle bob, lunge on hit, fall+fade on faint ----
  const MON_X = 440, MON_Y = 238;
  if (b.sendoutAt > 0 && b.phase !== "intro") {
    let monX = MON_X, monY = MON_Y, scale = 1, alpha = 1;
    const sT = frame - b.sendoutAt;
    if (sT < 16) scale = Math.max(0.05, sT / 16);
    monY += Math.sin(frame / 13) * 5;
    if (b.attackAt) {
      const aT = frame - b.attackAt;
      if (aT < 16) { const l = Math.sin((aT / 16) * Math.PI); monX -= l * 170; monY += l * 110; }
    }
    if (b.faintAt) {
      const fT = frame - b.faintAt;
      monY += fT * fT * 0.25;
      alpha = Math.max(0, 1 - fT / 24);
    }
    if (alpha > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(MON_X, MON_Y + 58, 40 * scale, 9 * scale, 0, 0, 7); ctx.fill();
      const sz = 88 * scale;
      ctx.globalAlpha = alpha;
      ctx.drawImage(monSpriteCv(mon.name, typeColor), px(monX - sz / 2), px(monY - sz / 2), sz, sz);
      ctx.globalAlpha = 1;
    }
  }

  // sendout poof particles
  b.poof = b.poof.filter(p => { p.life -= dtF; return p.life > 0; });
  for (const p of b.poof) {
    p.x += p.vx * dtF; p.y += p.vy * dtF;
    ctx.globalAlpha = Math.min(1, p.life / 16);
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(px(MON_X + p.x), px(MON_Y + p.y), 4, 4);
  }
  ctx.globalAlpha = 1;

  // opponent info plate
  ctx.fillStyle = "rgba(15,23,42,0.9)";
  ctx.fillRect(36, 36, 330, 84);
  ctx.strokeStyle = typeColor; ctx.lineWidth = 2; ctx.strokeRect(36, 36, 330, 84);
  // FE face portrait (#023): small framed bust at the plate's left, tinted to the type colour
  ctx.drawImage(pixelHead(b.npc.slug, 56), 48, 48, 56, 56);
  ctx.strokeStyle = typeColor; ctx.lineWidth = 2; ctx.strokeRect(48, 48, 56, 56);
  const oTx = 116;
  ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 16px monospace"; ctx.textAlign = "left";
  ctx.fillText(displayName(b.npc.slug), oTx, 62);
  ctx.fillStyle = typeColor; ctx.font = "bold 12px monospace";
  ctx.fillText(`${b.npc.type} TRAINER · ${TYPE_NAMES[b.npc.type]}`, oTx, 82);
  ctx.fillStyle = "#94a3b8"; ctx.font = "12px monospace";
  ctx.fillText(`${mon.name.toUpperCase()} Lv.${mon.level}`, oTx, 100);
  for (let i = 0; i < b.mons.length; i++) {
    ctx.fillStyle = b.mons[i].alive ? typeColor : "#334155";
    ctx.beginPath(); ctx.arc(350 - (b.mons.length - 1 - i) * 16, 92, 5, 0, 7); ctx.fill();
  }

  // player info plate (HP bar drains smoothly via dispHp)
  const pbX = CANVAS_W - 366;
  ctx.fillStyle = "rgba(15,23,42,0.9)";
  ctx.fillRect(pbX, 300, 330, 70);
  ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2; ctx.strokeRect(pbX, 300, 330, 70);
  // FE face portrait (#023): small framed bust at the plate's left
  ctx.drawImage(pixelHead(player.slug, 48), pbX + 8, 312, 48, 48);
  ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2; ctx.strokeRect(pbX + 8, 312, 48, 48);
  const pTx = pbX + 68;
  ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 15px monospace"; ctx.textAlign = "left";
  ctx.fillText("YOU (" + firstName(player.slug) + ")", pTx, 324);
  drawHPBar(pTx, 340, 175, 12, player.dispHp / MAX_HP);
  ctx.fillStyle = "#94a3b8"; ctx.font = "12px monospace";
  ctx.fillText(Math.round(player.dispHp) + "/" + MAX_HP, pTx + 182, 351);

  // floating damage number
  if (b.dmgAt) {
    const dT = frame - b.dmgAt;
    if (dT < 45) {
      ctx.globalAlpha = Math.max(0, 1 - dT / 45);
      ctx.fillStyle = "#f87171"; ctx.font = "bold 22px monospace"; ctx.textAlign = "center";
      ctx.fillText("-" + WRONG_DMG, CANVAS_W - 240, 290 - dT * 1.1);
      ctx.globalAlpha = 1;
    }
  }

  // text/question box
  const { bx, by, bw, bh } = layoutChoices();
  ctx.fillStyle = "rgba(15,23,42,0.95)";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 3; ctx.strokeRect(bx, by, bw, bh);

  if (b.phase === "question") {
    const q = mon.q;
    // up to 2 lines at 14px; drop to 12px / 3 lines for extra-long questions
    let qFont = "bold 14px monospace", lh = 17, qy = by + 22;
    let qLines = wrapTextMemo(`[${q.cat}] ${q.q}`, bw - 110, qFont);
    if (qLines.length > 2) {
      qFont = "bold 12px monospace"; lh = 15; qy = by + 18;
      qLines = wrapTextMemo(`[${q.cat}] ${q.q}`, bw - 110, qFont);
    }
    ctx.fillStyle = "#facc15"; ctx.font = qFont; ctx.textAlign = "left";
    qLines.slice(0, 3).forEach((ln, i) => ctx.fillText(ln, bx + 14, qy + i * lh));
    for (let i = 0; i < 4; i++) {
      const [x, y, w, h] = CHOICE_RECTS[i];
      const isSel = i === b.sel;
      ctx.fillStyle = isSel ? "#facc15" : "#1e293b";
      ctx.fillRect(x, y, w, h);
      if (isSel) { ctx.strokeStyle = "#fde047"; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h); }
      ctx.fillStyle = isSel ? "#0f172a" : "#e2e8f0";
      ctx.font = "13px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      const lines = wrapTextMemo(`${i + 1}. ${q.c[i]}`, w - 20, "13px monospace");
      if (lines.length === 1) ctx.fillText(lines[0], x + 10, y + h / 2);
      else lines.slice(0, 2).forEach((ln, j) => ctx.fillText(ln, x + 10, y + h / 2 + (j - 0.5) * 15));
      ctx.textBaseline = "alphabetic";
    }
    // Run (flee) button — top-right of the question box, above the choice grid
    const [rrx, rry, rrw, rrh] = RUN_RECT;
    ctx.fillStyle = "#7f1d1d";
    ctx.fillRect(rrx, rry, rrw, rrh);
    ctx.strokeStyle = "#f87171"; ctx.lineWidth = 2; ctx.strokeRect(rrx, rry, rrw, rrh);
    ctx.fillStyle = "#fecaca"; ctx.font = "bold 13px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("RUN (R)", rrx + rrw / 2, rry + rrh / 2);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";

    // Hard-mode countdown — rendered in the gap above the question box; Easy/Normal show nothing.
    if (difficulty === "hard") {
      const remMs = Math.max(0, b.timerMs);
      const secs = Math.ceil(remMs / 1000);
      const frac = Math.max(0, Math.min(1, remMs / HARD_TIMER_MS));
      const low = remMs < 10000;
      const barW = 220, barH = 12, tcx = CANVAS_W / 2, tby = by - 34;
      const col = low ? "#f87171" : "#facc15";
      ctx.fillStyle = col; ctx.font = "bold 16px monospace"; ctx.textAlign = "center";
      ctx.fillText(`⏱ ${secs}s`, tcx, tby - 4);
      // track + fill
      ctx.fillStyle = "#0f172a"; ctx.fillRect(tcx - barW / 2, tby + 4, barW, barH);
      ctx.fillStyle = col; ctx.fillRect(tcx - barW / 2, tby + 4, barW * frac, barH);
      ctx.strokeStyle = "#334155"; ctx.lineWidth = 1; ctx.strokeRect(tcx - barW / 2, tby + 4, barW, barH);
      ctx.textAlign = "left";
    }
  } else {
    // typewriter message reveal — wrap once per message, reveal by char count
    const shown = Math.floor((frame - b.msgAt + 1) * TEXT_SPEED());
    if (!b._cachedMsgLines || b._cachedMsg !== b.msg) {
      b._cachedMsg = b.msg;
      b._cachedMsgLines = wrapTextMemo(b.msg, bw - 32, "bold 15px monospace");
    }
    ctx.fillStyle = b.phase === "win" || (b.phase === "feedback" && b.feedback && b.feedback.correct) ? "#22c55e"
      : (b.feedback && !b.feedback.correct && b.phase === "feedback") || b.phase === "lose" ? "#f87171" : "#e2e8f0";
    ctx.font = "bold 15px monospace"; ctx.textAlign = "left";
    typewriterSlice(b._cachedMsgLines, Math.max(0, shown)).slice(0, 5)
      .forEach((ln, i) => ctx.fillText(ln, bx + 16, by + 30 + i * 22));
    if (shown >= b.msg.length && Math.floor(frame / 25) % 2 === 0) {
      ctx.fillStyle = "#94a3b8"; ctx.font = "12px monospace"; ctx.textAlign = "right";
      ctx.fillText("ENTER ▸", bx + bw - 14, by + bh - 12);
    }
  }

  // red flash when you take a hit
  if (b.attackAt) {
    const aT = frame - b.attackAt;
    if (aT < 14) {
      ctx.fillStyle = `rgba(239,68,68,${(0.32 * (1 - aT / 14)).toFixed(3)})`;
      ctx.fillRect(-20, 0, CANVAS_W + 40, CANVAS_H);
    }
  }
  // white flash as the battle scene appears
  const wT = frame - b.startF;
  if (wT < 14) {
    ctx.fillStyle = `rgba(255,255,255,${(1 - wT / 14).toFixed(3)})`;
    ctx.fillRect(-20, 0, CANVAS_W + 40, CANVAS_H);
  }
  ctx.restore();
}

// Pokemon-style battle transition: triple white flash, then an iris wipe to black.
function drawTransition() {
  const t = battleTransition.t;
  if (t < 24) {
    if (Math.floor(t / 4) % 2 === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
  } else {
    const f = Math.min(1, (t - 24) / 22);
    const r = (1 - f) * Math.hypot(CANVAS_W, CANVAS_H) / 2;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.rect(0, 0, CANVAS_W, CANVAS_H);
    ctx.arc(CANVAS_W / 2, CANVAS_H / 2, Math.max(0.1, r), 0, 7, true);
    ctx.fill("evenodd");
  }
}

function drawVictory() {
  ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // confetti
  const rng = mulberry32(Math.floor(frame / 3));
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = ["#facc15", "#22c55e", "#3b82f6", "#a855f7", "#ef4444"][i % 5];
    ctx.fillRect(rng() * CANVAS_W, rng() * CANVAS_H, 5, 5);
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#facc15"; ctx.font = "bold 40px monospace";
  ctx.fillText("YOU'RE A CERTIFIED", CANVAS_W / 2, 110);
  ctx.fillText("CLAUDE ARCHITECT!", CANVAS_W / 2, 160);
  drawTrainer(player.slug, CANVAS_W / 2, 355, 170, 3);
  ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 18px monospace"; ctx.textAlign = "center";
  ctx.fillText(displayName(player.slug) + " bested all " + npcs.length + " rivals!", CANVAS_W / 2, 392);
  // hall of fame parade
  npcs.forEach((n, i) => {
    const cols = 15;
    const x = CANVAS_W / 2 + (i % cols - cols / 2) * 46 + 23;
    const y = 420 + Math.floor(i / cols) * 50 + Math.sin((frame + i * 20) / 15) * 3;
    const mini = spriteMini(n.slug, 44);
    if (mini) ctx.drawImage(mini, px(x - 22), px(y), 44, 44);
    else ctx.drawImage(pixelHead(n.slug, 36), px(x - 18), px(y), 36, 36);
  });
  ctx.fillStyle = "#64748b"; ctx.font = "13px monospace";
  ctx.fillText("ENTER to wander your office in glory · R on title screen to start a new run", CANVAS_W / 2, CANVAS_H - 16);
}

function drawToast() {
  if (!toast) return;
  if (performance.now() > toast.until) { toast = null; return; }
  ctx.font = "bold 14px monospace";
  const w = ctx.measureText(toast.msg).width + 28;
  ctx.fillStyle = "rgba(15,23,42,0.92)";
  ctx.fillRect(CANVAS_W / 2 - w / 2, 84, w, 34);
  ctx.strokeStyle = "#facc15"; ctx.lineWidth = 2;
  ctx.strokeRect(CANVAS_W / 2 - w / 2, 84, w, 34);
  ctx.fillStyle = "#facc15"; ctx.textAlign = "center";
  ctx.fillText(toast.msg, CANVAS_W / 2, 106);
}

// Coffee confirm dialog. Buttons cached on the prompt object so the click handler can hit-test.
function drawCoffeePrompt() {
  if (!coffeePrompt) return;
  const bw = 300, bh = 116, bx = (CANVAS_W - bw) / 2, by = (CANVAS_H - bh) / 2;
  ctx.fillStyle = "rgba(8,12,24,0.78)"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = "rgba(15,23,42,0.97)"; ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "#facc15"; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
  ctx.textAlign = "center";
  ctx.fillStyle = "#facc15"; ctx.font = "bold 15px monospace";
  ctx.fillText("Grab a coffee?", CANVAS_W / 2, by + 30);
  ctx.fillStyle = "#cbd5e1"; ctx.font = "12px monospace";
  ctx.fillText(`Restores HP · ${coffeeUses} ${coffeeUses === 1 ? "use" : "uses"} left`, CANVAS_W / 2, by + 50);

  const labels = ["Yes", "No"], btnW = 96, btnH = 30, gap = 24;
  const totalW = btnW * 2 + gap, startX = (CANVAS_W - totalW) / 2, btnY = by + bh - 42;
  coffeePrompt.btns = [];
  for (let i = 0; i < 2; i++) {
    const x = startX + i * (btnW + gap), on = coffeePrompt.sel === i;
    ctx.fillStyle = on ? "#facc15" : "rgba(51,65,85,0.9)";
    ctx.fillRect(x, btnY, btnW, btnH);
    ctx.fillStyle = on ? "#0f172a" : "#e2e8f0"; ctx.font = "bold 13px monospace";
    ctx.fillText(labels[i], x + btnW / 2, btnY + 20);
    coffeePrompt.btns.push({ x, y: btnY, w: btnW, h: btnH });
  }
}

// ---------- Main loop ----------
let lastT = performance.now();
function drawSearch() {
  ctx.fillStyle = "rgba(2,6,23,0.62)"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const MAXROWS = 7, w = 470, x = (CANVAS_W - w) / 2;
  const total = searchResults.length;
  let start = 0;
  if (total > MAXROWS) start = Math.max(0, Math.min(searchSel - 3, total - MAXROWS));
  const rows = Math.min(MAXROWS, total);
  const listTop = 0, qh = 30;
  const h = 56 + qh + 12 + Math.max(1, rows) * 40 + 18;
  const y = (CANVAS_H - h) / 2;
  // panel
  ctx.fillStyle = "rgba(15,23,42,0.97)";
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10); else ctx.rect(x, y, w, h); ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = "rgba(148,163,184,0.32)"; ctx.stroke();
  // header
  ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 15px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText("FIND A COLLEAGUE", x + 20, y + 30);
  ctx.fillStyle = "#64748b"; ctx.font = "11px monospace"; ctx.textAlign = "right";
  ctx.fillText("\u2191\u2193 select \u00b7 \u23ce go \u00b7 esc close", x + w - 20, y + 30);
  // query box
  const qy = y + 44;
  ctx.fillStyle = "rgba(2,6,23,0.7)"; ctx.fillRect(x + 20, qy, w - 40, qh);
  ctx.textAlign = "left"; ctx.font = "14px monospace";
  if (searchQuery) {
    const caret = Math.floor(frame / 30) % 2 ? "_" : "";
    ctx.fillStyle = "#f1f5f9"; ctx.fillText(searchQuery + caret, x + 30, qy + 20);
  } else {
    ctx.fillStyle = "#475569"; ctx.fillText("type a name\u2026", x + 30, qy + 20);
  }
  // results
  const listY = qy + qh + 12;
  if (!total) {
    ctx.fillStyle = "#64748b"; ctx.font = "13px monospace"; ctx.textAlign = "center";
    ctx.fillText("No one by that name.", CANVAS_W / 2, listY + 26);
  } else {
    for (let i = 0; i < rows; i++) {
      const idx = start + i, slug = searchResults[idx];
      const npc = npcs.find(n => n.slug === slug);
      const ry = listY + i * 40, sel = idx === searchSel;
      const accent = npc ? TYPE_COLORS[npc.type] : "#94a3b8";
      if (sel) {
        ctx.fillStyle = "rgba(148,163,184,0.14)"; ctx.fillRect(x + 14, ry, w - 28, 36);
        ctx.fillStyle = accent; ctx.fillRect(x + 14, ry, 3, 36);
      }
      ctx.drawImage(pixelHead(slug, 32), x + 24, ry + 3, 30, 30);
      ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 13px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText(displayName(slug), x + 64, ry + 16);
      ctx.fillStyle = accent; ctx.font = "11px monospace";
      ctx.fillText(npc ? TYPE_NAMES[npc.type] : "", x + 64, ry + 30);
      if (npc && npc.defeated) {
        ctx.fillStyle = "#22c55e"; ctx.font = "bold 13px monospace"; ctx.textAlign = "right";
        ctx.fillText("\u2713 bested", x + w - 24, ry + 24);
      }
    }
    if (start + rows < total) {
      ctx.fillStyle = "#64748b"; ctx.font = "10px monospace"; ctx.textAlign = "center";
      ctx.fillText(`+${total - (start + rows)} more \u2014 keep typing or scroll`, CANVAS_W / 2, listY + rows * 40 + 6);
    }
  }
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

// Resolve a small read-only soundtrack snapshot. Music never receives mutable game objects.
function resolveMusicScene() {
  if (typeof DatamonMusic === "undefined") return null;
  const musicBattle = battle ? {
    phase: battle.agentOps ? battle.agentOps.phase : battle.phase,
    agentOps: battle.agentOps ? {
      boss: !!battle.agentOps.boss,
      bossPhase: battle.agentOps.bossPhase || 0,
    } : null,
  } : null;
  return DatamonMusic.resolveScene({
    state,
    currentMap,
    battle: musicBattle,
    transitionType: battleTransition && battleTransition.npc ? battleTransition.npc.type : null,
  });
}

function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000); // clamp caps tab-refocus dt spikes
  lastT = t;
  dtF = dt * 60;
  frame += dtF;
  if (state === "overworld") updateOverworld(dt);
  if (state === "transition" && battleTransition) {
    battleTransition.t += dtF;
    if (battleTransition.t >= 46) { startBattle(battleTransition.npc); battleTransition = null; }
  }
  // Hard-mode question timer: counts down ONLY during the question phase (Invariant 1 —
  // paused during feedback/typewriter/intro/sendout/win/lose). On expiry, route through
  // the shared wrong-answer/timeout flow.
  if (state === "battle" && battle && difficulty === "hard") {
    // Agent Operations: timer runs only during the interactive choice phase
    if (battle.agentOps && battle.agentOps.phase === "choice") {
      battle.timerMs -= dt * 1000;
      if (battle.timerMs <= 0) { battle.timerMs = 0; timeoutQuestion(); }
    } else if (!battle.agentOps && battle.phase === "question") {
      // Classic: timer runs during question phase
      battle.timerMs -= dt * 1000;
      if (battle.timerMs <= 0) { battle.timerMs = 0; timeoutQuestion(); }
    }
  }
  // Scene sync is idempotent; unchanged scenes never restart their scheduler or loop.
  if (typeof DatamonMusic !== "undefined") DatamonMusic.setScene(resolveMusicScene());

  // Minigame update: init on first frame, then tick feedback timers (#029)
  if (state === "minigame" && currentMinigame) {
    if (currentMinigame.phase === "intro") initMinigame();
    else updateMinigame();
  }
  // HP bar drains/refills smoothly toward the real value
  player.dispHp += (player.hp - player.dispHp) * (1 - Math.pow(0.88, dtF));
  if (Math.abs(player.hp - player.dispHp) < 0.6) player.dispHp = player.hp;

  if (state === "title") drawTitle();
  else if (state === "select") drawSelect();
  else if (state === "overworld") drawOverworld();
  else if (state === "transition") { drawOverworld(); drawTransition(); }
  else if (state === "battle") drawBattle();
  else if (state === "victory") drawVictory();
  else if (state === "search") { drawOverworld(); drawSearch(); }
  else if (state === "minigame") drawMinigame();
  if (state === "overworld") drawCoffeePrompt();
  if (state === "overworld") { if (bookPrompt) drawBookPrompt(); if (readerState) drawReader(); }
  drawToast();

  requestAnimationFrame(loop);
}

// ---------- Boot ----------
ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 20px monospace"; ctx.textAlign = "center";
ctx.fillText("Loading the team...", CANVAS_W / 2, CANVAS_H / 2);
battleGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
battleGrad.addColorStop(0, "#1e293b");
battleGrad.addColorStop(1, "#0f172a");
// Initialize presentation systems without creating an AudioContext before user activation.
if (typeof DatamonWorldArt !== "undefined") DatamonWorldArt.init();
if (typeof DatamonMusic !== "undefined") DatamonMusic.init({ muted: muted, scene: "title" });
// Load and validate the additive manifest, then request only accepted office/shared HD members.
// A missing/empty manifest resolves to legacy rendering with zero HD image requests.
var hdManifestPromise = (typeof DatamonWorldArt !== "undefined")
  ? DatamonWorldArt.loadManifest() : Promise.resolve([]);
var hdOfficePromise = hdManifestPromise.then(function() {
  return (typeof DatamonWorldArt !== "undefined")
    ? DatamonWorldArt.loadScene("office") : [];
});
// Prewarm only the saved player without delaying the title screen. A new run preloads its
// highlighted character when character select opens.
loadWalkAnim(getSave()?.player);
// Boot: load office assets + shared library assets (lib-door) but NOT full library.
// Full library assets load lazily on first warp.
Promise.all([
  loadImages(), loadTiles(), loadProps(),
  hdOfficePromise,
  // Load only shared library dependencies needed by the office entrance
  fetch("library/assets/manifest.json")
    .then(r => (r.ok ? r.json() : []))
    .then(list => {
      libManifest = Array.isArray(list) ? list : [];
      // Only load lib-door at boot; remaining library art loads on first entry
      var doorEntry = libManifest.find(function(m) { return m.slug === "lib-door"; });
      if (doorEntry) return loadOne("library/assets/" + doorEntry.file, libStore, "lib-door");
      return Promise.resolve();
    })
    .catch(function() { libManifest = []; }),
]).then(function() {
  officeMapCv = buildMapCanvas();         // reads global map (= OFFICE_MAP) — must run while currentMap is office
  libraryMapCv = null;                    // first interaction loads data/art and builds once
  mapCv = officeMapCv;
  if (typeof DatamonWorldArt !== "undefined") DatamonWorldArt.activateScene("office");
  requestAnimationFrame(loop);
});
