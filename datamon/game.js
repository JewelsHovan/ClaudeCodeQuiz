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
const SOLID = new Set(["#", "D", "P", "C", "W", "O", "G", "F", "U", "B", "S", "L", "A", "X"]);
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
const DOORS = [[7, 15], [11, 23], [24, 23]]; // meeting room + Battle Room + Library approaches
// Door surrounds are baked once for static-map/title continuity, then repainted in the
// feet-depth pass so characters north of/in a threshold pass behind its lintel and posts.
// They remain collision-free: the transparent centre and existing route geometry are unchanged.
const WAYFINDING_SURROUND_PLACEMENTS = Object.freeze([
  Object.freeze({ id: "door-context-surround", door: DOORS[0], accent: TYPE_COLORS.CONTEXT }),
  Object.freeze({ id: "door-battle-surround",  door: DOORS[1], accent: "#ef4444" }),
  Object.freeze({ id: "door-library-surround", door: DOORS[2], accent: "#f2b35d" }),
]);

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
];

// ---- Seat registry (#047): office-chair placements become explicit interactable seats ----
// Indexed by "col,row" string. Seats block ordinary walking and accept sit/stand interaction.
const OFFICE_SEATS = new Map();
for (const p of PROP_PLACEMENTS) {
  if (p.slug === "office-chair") OFFICE_SEATS.set(`${p.col},${p.row}`, { col: p.col, row: p.row });
}
// Deterministic NPC seat assignment: 2 seats per desk-bearing domain (CONTEXT, PROMPT, MIX).
// The seat at the desk's chair position is reserved for NPCs.
const NPC_SEAT_ASSIGNMENTS = new Map([
  ["2,18", "CONTEXT"], ["6,18", "CONTEXT"],
  ["14,17", "PROMPT"], ["20,17", "PROMPT"],
  ["26,16", "MIX"], ["31,16", "MIX"],
]);
// Player-available seats (4 total): remaining chairs not in NPC_SEAT_ASSIGNMENTS
const PLAYER_SEAT_KEYS = ["14,20", "20,20", "26,20", "31,20"];

// ---- Certification Spine path mask (#049) ----
// Union of four reserved negative-space routes: no standing NPC placement or decorative collision.
// These paths connect the Console, all domain areas, Context doorway, Battle Room, and Library.
const OFFICE_PATH_MASK = (function () {
  var mask = new Set();
  var addRect = function (x0, y0, x1, y1) {
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) mask.add(x + "," + y);
  };
  addRect(17, 5, 19, 22);  // Certification Spine (north-south)
  addRect(2, 10, 33, 12);  // Commons (east-west cross)
  addRect(10, 21, 33, 22); // Portal Gallery (south spine connector)
  addRect(6, 12, 8, 14);   // Context Spur
  return mask;
})();
function isPathMaskCell(x, y) {
  return OFFICE_PATH_MASK.has(x + "," + y);
}

// ---- Certification Console geometry (#047) ----
// Solid console at [17,4] and [18,4] with approach at row 5.
const CONSOLE_CELLS = [[17, 4], [18, 4]];

// ---- Study-life prop placements (#047) ----
const STUDY_PROP_PLACEMENTS = [
  { slug: "certification-console", col: 17, row: 4 },
  { slug: "desk-study-kit", col: 14, row: 16 },
  { slug: "desk-study-kit", col: 20, row: 16 },
  { slug: "desk-study-kit", col: 26, row: 15 },
  { slug: "desk-study-kit", col: 31, row: 15 },
  { slug: "task-lamp", col: 20, row: 19 },
];
const STUDY_AMBIENT_PLACEMENT = { slug: "screen-ambient", col: 17, row: 4 };

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
  for (const [x, y] of [[11, 5], [23, 5], [12, 13], [24, 13], [30, 13]]) g[y][x] = "O";

  // Coffee counter (interact to heal) in the kitchen
  g[2][31] = "C";

  // Bullpen desk clusters (each desk prop is 2 tiles wide → pairs of "D" cells)
  const desks = [
    [14, 16], [15, 16], [20, 16], [21, 16], [14, 19], [15, 19], [20, 19], [21, 19], // Prompt Studio
    [26, 15], [27, 15], [31, 15], [32, 15], [26, 19], [27, 19], [31, 19], [32, 19], // MIX
  ];
  for (const [x, y] of desks) g[y][x] = "D";

  // Plants
  for (const [x, y] of [[1, 12], [34, 12], [34, 21], [13, 3], [22, 3]]) g[y][x] = "P";

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
  g[23][11] = "A"; // Battle Room portal in south wall (OFFICE_BATTLE_DOOR_TILE) — #046

  // Certification Console cells (#047): solid, approachable from row 5
  for (const [cx, cy] of CONSOLE_CELLS) g[cy][cx] = "X";

  return g;
}

// ---------- Battle Room map (#046) ----------
// 36×24 training arena. Every non-player colleague is arranged in a perimeter ring.
// The return door [18,23] leads back to the office.
function buildBattleRoomMap() {
  const g = Array.from({ length: MAP_H }, () => Array(MAP_W).fill("."));
  // Brick perimeter
  for (let x = 0; x < MAP_W; x++) { g[0][x] = "#"; g[MAP_H - 1][x] = "#"; }
  for (let y = 0; y < MAP_H; y++) { g[y][0] = "#"; g[y][MAP_W - 1] = "#"; }
  // Return door on south wall (maps to office return portal)
  g[23][18] = "A";
  return g;
}

const BATTLE_ROOM_MAP = buildBattleRoomMap();

// Deterministic training-bay placement for every non-player roster member. Reviewed slots
// preserve the perimeter league silhouette while bringing three sparring rows into the entry
// camera; the south-to-centre lane remains open. world-layout.js returns defensive copies so
// no runtime interaction can mutate the accepted slot contract.
function buildBattleRoomNPCs(playerSlug) {
  const slots = (typeof DatamonWorldLayout !== "undefined")
    ? DatamonWorldLayout.battleRoomSlots()
    : [
      [4,19],[7,19],[10,19],[13,19],[23,19],[26,19],[29,19],[32,19],
      [6,15],[10,15],[14,15],[22,15],[26,15],[30,15],
      [8,11],[12,11],[16,11],[20,11],[24,11],[28,11],
      [3,4],[3,7],[3,10],[3,13],[3,16],[32,4],[32,7],[32,10],[32,13],[32,16],
      [6,3],[11,3],[16,3],[20,3],[25,3],[30,3],
    ].map(function(slot) { return { x: slot[0], y: slot[1] }; });

  const others = ROSTER.filter(function(s) { return s !== playerSlug; });
  const domains = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT", "MIX"];
  console.assert(others.length === slots.length, "Battle Room slot contract must fit all 36 rivals");
  return others.slice(0, slots.length).map(function(slug, index) {
    var persisted = _npcDomains && _npcDomains[slug];
    var type = domains.indexOf(persisted) >= 0 ? persisted : domains[index % domains.length];
    return {
      slug: slug, x: slots[index].x, y: slots[index].y,
      type: type, defeated: false, training: true,
    };
  });
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
// every roster member's PNGs. Missing files leave gaps and drawCharacter falls back safely to spriteMini.
const walkAnim = {};      // slug -> {down:[img×4], up:[...], left:[...], right:[...]}
const walkAnimMeta = {};  // slug -> validated per-frame body/visible-foot anchors
const walkAnimLoads = {}; // slug -> in-flight/completed Promise (deduplicates hover/preload)
const locomotionPilot = {}; // bounded pilot slug -> authored eight-frame walk/run + metadata
const LOCOMOTION_PILOT_SLUGS = new Set(["julien-hovan", "veronica-marallag", "alex-andrianavalontsalama"]);
const WALK_DIRS = ["down", "up", "left", "right"];

function loadLocomotionPilot(slug) {
  if (!LOCOMOTION_PILOT_SLUGS.has(slug)) return Promise.resolve();
  return fetch(`sprites-locomotion-pilot/${slug}/manifest.json`)
    .then(function(response) { return response.ok ? response.json() : null; })
    .then(function(raw) {
      var manifest = typeof DatamonLocomotion !== "undefined"
        ? DatamonLocomotion.normalizePilotManifest(raw) : null;
      if (!manifest) return;
      var jobs = [], refs = [];
      ["idle", "walk", "run"].forEach(function(motion) {
        WALK_DIRS.forEach(function(direction) {
          var count = motion === "idle" ? manifest.idleFrameCount : manifest.frameCount;
          for (var index = 0; index < count; index++) {
            refs.push({ motion: motion, direction: direction, index: index });
            jobs.push(new Promise(function(resolve) {
              var image = new Image();
              image.onload = function() { resolve(image); };
              image.onerror = function() { resolve(null); };
              image.src = motion === "idle"
                ? `sprites-locomotion-pilot/${slug}/idle_${direction}.png`
                : `sprites-locomotion-pilot/${slug}/${motion}_${direction}_${index}.png`;
            }));
          }
        });
      });
      return Promise.all(jobs).then(function(images) {
        if (images.some(function(image) { return !image; })) return;
        var motions = { idle: { down: [], up: [], left: [], right: [] }, walk: { down: [], up: [], left: [], right: [] }, run: { down: [], up: [], left: [], right: [] } };
        for (var i = 0; i < images.length; i++) {
          var ref = refs[i], frame = images[i];
          var anchor = manifest.motions[ref.motion].frames[`${ref.direction}_${ref.index}`];
          if (!anchor || anchor.width !== frame.width || anchor.height !== frame.height) return;
          motions[ref.motion][ref.direction][ref.index] = frame;
        }
        locomotionPilot[slug] = { manifest: manifest, motions: motions };
      });
    })
    .catch(function() { /* accepted four-frame art remains the fail-safe */ });
}

function loadWalkAnim(slug) {
  if (!slug || !ROSTER.includes(slug)) return Promise.resolve();
  if (walkAnimLoads[slug]) return walkAnimLoads[slug];
  walkAnim[slug] = { down: [], up: [], left: [], right: [] };
  var metadataLoad = fetch(`sprites-walk/${slug}/manifest.json`)
    .then(function(response) { return response.ok ? response.json() : null; })
    .then(function(raw) {
      walkAnimMeta[slug] = typeof DatamonLocomotion !== "undefined"
        ? DatamonLocomotion.normalizeAnchorManifest(raw) : null;
    })
    .catch(function() { walkAnimMeta[slug] = null; });
  var frameLoads = WALK_DIRS.flatMap(dir =>
    [0, 1, 2, 3].map(i => new Promise(resolve => {
      const img = new Image();
      img.onload = () => { walkAnim[slug][dir][i] = img; resolve(); };
      img.onerror = () => { resolve(); };
      img.src = `sprites-walk/${slug}/${dir}_${i}.png`;
    }))
  );
  walkAnimLoads[slug] = Promise.all([metadataLoad, loadLocomotionPilot(slug), ...frameLoads]);
  return walkAnimLoads[slug];
}

const idleManifestState = { manifest: null, promise: null, failed: false, seq: 0 };
const idleImageState = new Map(); // key -> {slug,dir,status,image,promise,lastUsed,pinned,requestSeq}
const IDLE_RESIDENT_LIMIT = 40;   // player 4 directions + at most one current direction per 36 NPCs
let idleUseTick = 0;
let idleRequestSeq = 0;

function idleDirection(dir) {
  return WALK_DIRS.includes(dir) ? dir : "down";
}
function idleKey(slug, dir) {
  return `${slug}:${idleDirection(dir)}`;
}
function idleLoadedRecords() {
  return [...idleImageState.values()].filter(function(record) { return record.status === "loaded" && record.image; });
}
function trimIdleImageCache() {
  var loaded = idleLoadedRecords();
  if (loaded.length <= IDLE_RESIDENT_LIMIT) return;
  loaded.sort(function(a, b) {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? 1 : -1;
    return a.lastUsed - b.lastUsed;
  });
  while (loaded.length > IDLE_RESIDENT_LIMIT) {
    var record = loaded.shift();
    if (!record || record.pinned) break;
    idleImageState.delete(record.key);
  }
}
function markIdleUse(record, pinned) {
  if (!record) return;
  if (pinned) record.pinned = true;
  record.lastUsed = ++idleUseTick;
}
function pinPlayerIdleDirections(slug) {
  idleImageState.forEach(function(record) {
    record.pinned = record.slug === slug && WALK_DIRS.includes(record.dir);
  });
  trimIdleImageCache();
}
function resolveIdleEntry(slug, dir) {
  var manifest = idleManifestState.manifest;
  var entry = manifest && manifest.entriesBySlug ? manifest.entriesBySlug[slug] : null;
  return entry && entry.directions ? entry.directions[idleDirection(dir)] : null;
}
function ensureIdleManifest() {
  if (idleManifestState.manifest) return Promise.resolve(idleManifestState.manifest);
  if (idleManifestState.failed) return Promise.resolve(null);
  if (idleManifestState.promise) return idleManifestState.promise;
  var seq = ++idleManifestState.seq;
  idleManifestState.promise = fetch("sprites-idle/manifest.json")
    .then(function(response) { return response.ok ? response.json() : null; })
    .then(function(raw) {
      if (seq !== idleManifestState.seq) return idleManifestState.manifest;
      var manifest = typeof DatamonLocomotion !== "undefined"
        ? DatamonLocomotion.normalizeIdleManifest(raw, ROSTER) : null;
      idleManifestState.promise = null;
      idleManifestState.manifest = manifest;
      idleManifestState.failed = !manifest;
      return manifest;
    })
    .catch(function() {
      if (seq === idleManifestState.seq) {
        idleManifestState.promise = null;
        idleManifestState.failed = true;
      }
      return null;
    });
  return idleManifestState.promise;
}
function loadIdleDirection(slug, dir, pinned) {
  var direction = idleDirection(dir);
  var key = idleKey(slug, direction);
  var record = idleImageState.get(key);
  if (record) {
    markIdleUse(record, pinned);
    return record.promise || Promise.resolve(record.image || null);
  }
  var entry = resolveIdleEntry(slug, direction);
  if (!entry) return Promise.resolve(null);
  record = {
    key: key, slug: slug, dir: direction, status: "pending", image: null,
    lastUsed: ++idleUseTick, pinned: !!pinned, requestSeq: ++idleRequestSeq, promise: null,
  };
  idleImageState.set(key, record);
  record.promise = new Promise(function(resolve) {
    var image = new Image();
    image.onload = function() {
      if (idleImageState.get(key) !== record || record.status !== "pending") return resolve(null);
      if (image.naturalWidth !== entry.width || image.naturalHeight !== entry.height) {
        record.status = "failed";
        record.image = null;
        record.promise = Promise.resolve(null);
        return resolve(null);
      }
      record.status = "loaded";
      record.image = image;
      record.promise = Promise.resolve(image);
      markIdleUse(record, pinned);
      trimIdleImageCache();
      resolve(image);
    };
    image.onerror = function() {
      if (idleImageState.get(key) !== record) return resolve(null);
      record.status = "failed";
      record.image = null;
      record.promise = Promise.resolve(null);
      resolve(null);
    };
    image.src = `sprites-idle/${entry.file}`;
  });
  return record.promise;
}
function getLoadedIdleDirection(slug, dir, pinned) {
  var record = idleImageState.get(idleKey(slug, dir));
  if (!record || record.status !== "loaded" || !record.image) return null;
  markIdleUse(record, pinned);
  return record.image;
}
function primePlayerIdleDirections(slug) {
  if (!slug || !ROSTER.includes(slug)) return Promise.resolve(null);
  pinPlayerIdleDirections(slug);
  return ensureIdleManifest().then(function(manifest) {
    if (!manifest) return null;
    return Promise.all(WALK_DIRS.map(function(direction) {
      return loadIdleDirection(slug, direction, true);
    }));
  });
}
function primeVisibleNpcIdleDirections(onScreenFn) {
  if (!idleManifestState.manifest || typeof onScreenFn !== "function") return;
  for (const npc of npcs) {
    if (npc._seated) continue;
    const sx = (npc.x - camFx) * TILE + TILE / 2, sy = (npc.y - camFy) * TILE + TILE / 2;
    if (!onScreenFn(sx, sy)) continue;
    loadIdleDirection(npc.slug, npc.dir || "down", false);
  }
}
function gameplayIdleBootstrap(slug) {
  ensureIdleManifest().then(function(manifest) {
    if (!manifest) return null;
    return primePlayerIdleDirections(slug);
  });
}

// One ephemeral directional frame lets a seated challenger visibly face the displaced
// candidate without loading or retaining all sixteen rival walk frames.
let challengeFacingFrame = null; // {slug,dir,image}; at most one resident
function loadChallengeFacingFrame(slug, dir) {
  var record = { slug: slug, dir: WALK_DIRS.includes(dir) ? dir : "down", image: null };
  challengeFacingFrame = record;
  var image = new Image();
  image.onload = function() { if (challengeFacingFrame === record) record.image = image; };
  image.onerror = function() { if (challengeFacingFrame === record) record.image = null; };
  image.src = "sprites-walk/" + slug + "/" + record.dir + "_0.png";
}
function clearChallengeFacingFrame(slug) {
  if (!challengeFacingFrame || (slug && challengeFacingFrame.slug !== slug)) return;
  var activeSlug = challengeFacingFrame.slug;
  challengeFacingFrame = null;
  Object.keys(walkMiniCache).forEach(function(key) {
    if (key.indexOf("challenge:" + activeSlug + ":") === 0) delete walkMiniCache[key];
  });
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
const studyPropStore = {}; // accepted deterministic study-life cutouts
let studyPropManifest = [];
const libStore = {};      // slug -> HTMLImageElement (or null on error) — library assets
let libManifest = [];     // library manifest entries (or [] on failure)
const wayfindingStore = {}; // id -> validated HTMLImageElement — wayfinding assets (#049)
let wayfindingManifest = []; // exact accepted wayfinding entries (or [] on failure)
const WAYFINDING_IDS = Object.freeze([
  "zone-agent-frieze", "zone-mcp-frieze", "zone-config-frieze",
  "zone-prompt-frieze", "zone-context-frieze", "zone-mix-frieze",
  "door-context-surround", "door-library-surround", "door-battle-surround",
]);
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

function loadStudyProps() {
  return fetch("props-study/manifest.json")
    .then(r => (r.ok ? r.json() : { entries: [] }))
    .then(manifest => {
      studyPropManifest = manifest && Array.isArray(manifest.entries)
        ? manifest.entries.filter(entry => entry.reviewState === "accepted") : [];
      return Promise.all(studyPropManifest.map(entry =>
        loadOne(`props-study/${entry.file}`, studyPropStore, entry.slug)));
    })
    .catch(() => { studyPropManifest = []; });
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

// Wayfinding assets (#049): deterministic accepted 2x batch. The whole manifest fails
// closed if any declaration is malformed; no partial set can create ambiguous entrances.
function normalizeWayfindingManifest(manifest) {
  var rootKeys = ["asset_count", "batch", "batch_sha256", "entries", "format", "provenance", "reviewState", "sourceScale"];
  var entryKeys = ["alphaMode", "collision", "description", "file", "heightPx", "id", "kind", "provenance", "reviewState", "sha256", "slug", "sourceHeightPx", "sourceScale", "sourceWidthPx", "widthPx"];
  var provenance = "pillow-primitives:certification-spine-v1";
  if (!manifest || Object.keys(manifest).sort().join(",") !== rootKeys.join(",") ||
      manifest.batch !== "batch-certification-spine" || manifest.format !== "RGBA" ||
      manifest.reviewState !== "accepted" || manifest.sourceScale !== 2 ||
      manifest.provenance !== provenance || !/^[0-9a-f]{64}$/.test(manifest.batch_sha256 || "") ||
      manifest.asset_count !== WAYFINDING_IDS.length || !Array.isArray(manifest.entries) ||
      manifest.entries.length !== WAYFINDING_IDS.length) return [];
  var normalized = [];
  for (var i = 0; i < WAYFINDING_IDS.length; i++) {
    var entry = manifest.entries[i], id = WAYFINDING_IDS[i];
    var surround = id.indexOf("door-") === 0;
    var width = 96, height = surround ? 64 : 16;
    var requiredKeys = surround ? entryKeys.concat(["opening"]).sort() : entryKeys;
    if (!entry || Object.keys(entry).sort().join(",") !== requiredKeys.join(",") ||
        entry.id !== id || entry.slug !== id || entry.file !== id + ".png" ||
        entry.kind !== (surround ? "surround" : "frieze") ||
        entry.widthPx !== width || entry.heightPx !== height ||
        entry.sourceWidthPx !== width * 2 || entry.sourceHeightPx !== height * 2 ||
        entry.sourceScale !== 2 || entry.alphaMode !== "binary" ||
        entry.collision !== "none" || entry.reviewState !== "accepted" ||
        entry.provenance !== provenance ||
        entry.description !== (surround ? "Destination architecture surround" : "Domain architecture frieze") ||
        typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) return [];
    if (surround && (!Array.isArray(entry.opening) || entry.opening.join(",") !== "32,23,64,64")) return [];
    normalized.push(Object.assign({}, entry));
  }
  return normalized;
}
function loadWayfindingImage(entry) {
  return new Promise(function(resolve) {
    var image = new Image();
    image.onload = function() {
      var valid = image.naturalWidth === entry.sourceWidthPx && image.naturalHeight === entry.sourceHeightPx;
      wayfindingStore[entry.id] = valid ? image : null;
      resolve();
    };
    image.onerror = function() { wayfindingStore[entry.id] = null; resolve(); };
    image.src = "props-wayfinding/" + entry.file;
  });
}
function loadWayfindingAssets() {
  return fetch("props-wayfinding/manifest.json")
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (manifest) {
      wayfindingManifest = normalizeWayfindingManifest(manifest);
      return Promise.all(wayfindingManifest.map(loadWayfindingImage));
    })
    .catch(function () { wayfindingManifest = []; });
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
let currentMap = "office";               // "office" | "library" | "battleRoom"
let officeNpcs = [];                     // stash for office NPCs while in library/battleRoom
let battleRoomNpcs = [];                 // training NPCs built once per visit
// Warp geometry — door tiles are SOLID (face-to-interact); entry cells are walkable floor.
// Hardcoded coords are the source of truth (buildMap/buildLibraryMap also use literals).
const OFFICE_DOOR_TILE         = [24, 23];      // "L" in office south wall (library)
const OFFICE_ENTRY             = [24, 22];      // land here returning to office
const OFFICE_BATTLE_DOOR_TILE  = [11, 23];      // "A" in office south wall (battle room) — #046
const OFFICE_BATTLE_ENTRY      = [11, 22];      // land here returning to office from battle room
const LIBRARY_DOOR_TILE        = [18, 23];      // "L" in library south wall
const LIBRARY_ENTRY            = [18, 22];      // land here entering library
const BATTLE_ROOM_DOOR_TILE    = [18, 23];      // "A" in battle room south wall
const BATTLE_ROOM_ENTRY        = [18, 22];      // land here entering battle room
let state = "title";    // title | select | overworld | dialogue | transition | battle | victory | search | minigame
let selectIdx = 0;
let player = { slug: null, x: 18, y: 16, fx: 18, fy: 16, dir: "down", moving: false, hp: MAX_HP, dispHp: MAX_HP, seated: null };
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
// ---- Certification Console state (#047) ----
let certConsoleOpen = false;
let certConsoleSel = 0;
// ---- Sitting asset cache and fixed draw geometry (#047/#048) ----
// Gameplay remains anchored to the same chair tile. These visual-only values make the
// compact pose, fallback, cadence, and foreground chair mask independently testable.
const STANDING_CHARACTER_HEIGHT = 56; // equal player/NPC visual height; progression never changes scale
const SEATED_DRAW_GEOMETRY = Object.freeze({
  poseSize: 64,
  feetOffsetY: 16,
  frameHoldTicks: 60,
  phasePeriodTicks: 120,
  chairSize: 32,
  chairTopOffsetY: -16,
  chairForegroundSourceY: 7,
  chairForegroundHeight: 25,
  fallbackHeadWidth: 18,
  fallbackHeadHeight: 17,
  fallbackHeadTopOffsetY: -34,
  fallbackTorsoTopOffsetY: -18,
  fallbackTorsoWidth: 24,
  fallbackTorsoHeight: 18,
});
const SEATED_FALLBACK_HAIR = Object.freeze(["#33251f", "#171717", "#5b3a29", "#8a5a32", "#b45309", "#d4a574"]);
const SEATED_FALLBACK_SHIRTS = Object.freeze(["#334155", "#1e3a5f", "#3f3f46", "#374151", "#254b45", "#4c3d67"]);
let _sittingAssetStore = {};   // slug -> {idle_0: Image, idle_1: Image}|null
let _sittingLoaded = new Set();// slugs that have been requested (avoid double-fetch)
let _sitAnimPhase = 0;         // bounded animation phase for seated idle loop
function freshProgression() {
  return { badges: [], quests: {}, activities: { battleRoom: { currentStreak: 0, bestStreak: 0, wins: 0 } }, npcDomains: {} };
}
let _progression = freshProgression();
let _npcDomains = _progression.npcDomains; // alias into _progression.npcDomains
let _writeProtectedSave = false; // true when a future-version save blocks writes
let seenThisRun = {};   // category -> Set<idx> drawn this run (within-run repeat avoidance)
let coffeeUses = 0;   // coffee heals remaining this run (cap 3); persisted in save
let difficulty = "normal";   // "easy" | "normal" | "hard" — chosen at select, persisted in save
// ---------- Library minigame harness (#028) ----------
let currentMinigame = null;  // {type, stationId, label, score, phase} while state==="minigame"; null otherwise
let libraryProgress = {};    // bookId -> pageReached; persisted now, written by the reader later (#027 follow-up)
let minigameScores = {};     // stationId -> best score (higher is better; 0 = not attempted)
let mentorReview = null;    // #049: {npc, question, review, sel, phase, feedback, msgAt} — defeated-colleague review modal
// ---- Portrait dialogue + encounter staging (#052) ----
let dialogueSession = null;  // pure DatamonDialogueRuntime state; never serialized
let dialogueContext = null;  // {kind,npc,training,replay}
let dialogueStaging = null;  // visual-only player displacement tween
let encounterSeatRestore = null; // captured chair contract retained through battle
let dialogueEventSeq = 0;
let dialogueAnnouncedKey = null;
let dialogueAnnouncementHoldUntil = 0;
const DIALOGUE_STAGING_FRAMES = 24;
const DIALOGUE_PANEL = Object.freeze({ y: 350, h: 238, portrait: 112, leftX: 24, rightX: 664, textInset: 156 });
let frame = 0;
let dtF = 1;           // logical 60Hz frames this tick
let mapCv = null;        // active pre-rendered map (points to officeMapCv or libraryMapCv or battleRoomMapCv)
let officeMapCv = null;  // pre-rendered office map — built once at boot
let libraryMapCv = null; // pre-rendered library map — built once at boot
let battleRoomMapCv = null; // pre-rendered battle room map — built on first entry (#046)
let stepStartFx = 0, stepStartFy = 0, stepT = 1; // linear progress through the active grid step (0..1)
let locomotionPhase = 0; // normalized full gait cycle; derived only from actual rendered travel
let locomotionActive = false; // true across a continuous buffered/held chain, false at a real stop
let locomotionContactCount = 0; // bounded diagnostics counter; reset only by explicit test/lifecycle seams
let locomotionProfile = typeof DatamonLocomotion !== "undefined"
  ? DatamonLocomotion.profile("balanced")
  : { name: "fallback", walkTilesPerSecond: 5, runTilesPerSecond: 8.5, walkCycleTiles: 2, runCycleTiles: 2 };
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
  const domains = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT", "MIX"];
  const order = shuffled(others, rng);
  const reservedSeats = new Set(OFFICE_SEATS.keys());

  // Preserve valid persisted domain identities; new colleagues receive a deterministic
  // round-robin identity. Placement is now a separate pure concern in world-layout.js.
  const people = order.map(function(slug, index) {
    const persisted = (typeof _npcDomains === "object" && _npcDomains[slug]);
    const domain = domains.indexOf(persisted) >= 0 ? persisted : domains[index % domains.length];
    if (typeof _npcDomains === "object") _npcDomains[slug] = domain;
    return { slug: slug, domain: domain };
  });

  // Select the six seated colleagues before standing allocation so chair occupants do not
  // consume and then vacate the best standing anchors. Seat identity remains deterministic.
  const seatedSlugs = new Set();
  const seated = [];
  for (const [seatKey, domain] of NPC_SEAT_ASSIGNMENTS) {
    const person = people.find(function(candidate) {
      return candidate.domain === domain && !seatedSlugs.has(candidate.slug);
    });
    if (!person) continue;
    const coords = seatKey.split(",");
    seatedSlugs.add(person.slug);
    seated.push({
      slug: person.slug, type: person.domain,
      x: parseInt(coords[0], 10), y: parseInt(coords[1], 10),
      defeated: defeated.has(person.slug), _seated: true, dir: "down",
      _layoutZone: "assigned-seat", _layoutSource: "seat",
    });
  }
  const standingPeople = people.filter(function(person) { return !seatedSlugs.has(person.slug); });

  function validStandingCell(x, y) {
    if (x < 1 || y < 1 || x >= MAP_W - 1 || y >= MAP_H - 1) return false;
    if (SOLID.has(map[y][x])) return false;
    if (DOORS.some(function(door) { return Math.abs(door[0] - x) + Math.abs(door[1] - y) <= 1; })) return false;
    if (Math.abs(x - player.x) + Math.abs(y - player.y) <= 2) return false;
    if (reservedSeats.has(x + "," + y) || isPathMaskCell(x, y)) return false;
    return true;
  }

  // Complete region pools are capacity-only fallbacks. Named activity anchors from the pure
  // module win ties, while quadrant tags ensure a fallback cannot collapse into one corner.
  const fallbackByDomain = { AGENT: [], MCP: [], CONFIG: [], PROMPT: [], CONTEXT: [], MIX: [] };
  for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
    if (!validStandingCell(x, y)) continue;
    const domain = regionOf(x, y);
    const horizontal = x < (domain === "AGENT" || domain === "CONTEXT" ? 6 : domain === "MCP" || domain === "PROMPT" ? 18 : 30)
      ? "west" : "east";
    const vertical = y < 6 || (y >= 13 && y < 18) ? "north" : "south";
    fallbackByDomain[domain].push({ x: x, y: y, zone: "fallback-" + horizontal + "-" + vertical, source: "fallback" });
  }

  let allocation = null;
  if (typeof DatamonWorldLayout !== "undefined") {
    allocation = DatamonWorldLayout.allocateOffice({
      people: standingPeople,
      fallbackByDomain: fallbackByDomain,
      isValid: validStandingCell,
      seed: 20260717,
    });
  }
  // Missing-module fallback remains deterministic and geometry-safe; packaging independently
  // requires world-layout.js, so production normally takes the richer semantic allocator.
  if (!allocation || !allocation.complete) {
    const used = new Set();
    const placements = [];
    for (const person of standingPeople) {
      const candidate = fallbackByDomain[person.domain].find(function(point) {
        const key = point.x + "," + point.y;
        return !used.has(key) && !placements.some(function(other) {
          return Math.abs(other.x - point.x) + Math.abs(other.y - point.y) < 3;
        });
      });
      if (!candidate) continue;
      used.add(candidate.x + "," + candidate.y);
      placements.push({ slug: person.slug, domain: person.domain, x: candidate.x, y: candidate.y, zone: candidate.zone, source: "fallback" });
    }
    allocation = { placements: placements, complete: placements.length === standingPeople.length };
  }

  npcs = allocation.placements.map(function(placement) {
    return {
      slug: placement.slug, x: placement.x, y: placement.y, type: placement.domain,
      defeated: defeated.has(placement.slug),
      _layoutZone: placement.zone, _layoutSource: placement.source,
    };
  }).concat(seated);
  for (const colleague of seated) loadSitAsset(colleague.slug);

  console.assert(allocation.complete && npcs.length === others.length,
    "Office layout must place every non-player colleague");
  rivalTotal = npcs.length;
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
      _progression = freshProgression();
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
  _evidenceRevision++;
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

function startBattle(npc, portraitLed) {
  // Player cannot be seated during battle (#047).
  leaveSeat();
  clearMentorReview(); // #049: modal must not survive battle start
  const matchup = resolveAttributeMatchup(npc.slug);
  // MIX chooses one visual species pool exactly once, matching the pre-presentation RNG
  // contract. Presentation IDs never consume extra randomness or affect question selection.
  const monDomain = npc.type === "MIX" ? weightedDomain() : npc.type;
  const monPool = shuffled(MON_NAMES[monDomain],
                           mulberry32(Math.floor(Math.random() * 1e9)));
  const level = Math.max(1, 5 + defeated.size * 2 + (TIER_LEVEL_DELTA[difficulty] || 0));
  const isAgent = npc.type === "AGENT";
  // Training restores attribute-derived max HP. Campaign HP is clamped when a
  // legacy/newly-selected character enters its first stat-aware encounter.
  var training = currentMap === "battleRoom";
  if (training) player.hp = matchup.maxHp;
  else player.hp = Math.min(player.hp, matchup.maxHp);
  var introMessage;
  if (typeof DatamonDialogue !== "undefined") {
    introMessage = training
      ? DatamonDialogue.trainingRematch(npc.slug, npc.type, displayName)
      : DatamonDialogue.battleIntro(npc.slug, npc.type, displayName);
  } else {
    introMessage = isAgent
      ? `${displayName(npc.slug)} challenges you to an Agent Operations duel!`
      : `${displayName(npc.slug)} ${BATTLE_INTROS[Math.floor(Math.random() * BATTLE_INTROS.length)]}`;
  }
  var monCount = isAgent ? 2 : matchup.opponentMonCount;
  var attributeLine = typeof DatamonAttributes !== "undefined" ? DatamonAttributes.describe(matchup) : "";
  battle = {
    npc,
    training: training,
    portraitLed: !!portraitLed,
    attributes: matchup,
    mons: Array.from({ length: monCount }, (_, i) => ({
      name: monPool[i % monPool.length], level: level + i, q: null, alive: true,
      domain: monDomain,
      id: typeof DatamonBattlePresentation !== "undefined"
        ? DatamonBattlePresentation.battlemonId(monDomain, monPool[i % monPool.length])
        : null,
    })),
    idx: 0,
    phase: "intro", // Agent phase is projected from reducer state before the scene renders
    timerLimitMs: matchup.hardTimerMs,
    timerMs: matchup.hardTimerMs,
    msg: introMessage,
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
  // Retain only this encounter's Battlemon sheets (classic only). Stale in-flight decodes
  // cannot repopulate a later encounter, and Agent Operations releases classic residents.
  // No mon PNGs load on the title screen; only the encounter's 1-3 sheets load here.
  if (typeof DatamonBattlePresentation !== "undefined") {
    var seenIds = {}, encounterIds = [];
    if (!isAgent) {
      for (var mi = 0; mi < battle.mons.length; mi++) {
        var mon = battle.mons[mi];
        if (mon.id && !seenIds[mon.id]) { seenIds[mon.id] = true; encounterIds.push(mon.id); }
      }
    }
    DatamonBattlePresentation.setActiveEncounter(encounterIds);
    for (var assetIndex = 0; assetIndex < encounterIds.length; assetIndex++) {
      DatamonBattlePresentation.requestSheet(encounterIds[assetIndex]);
    }
  }
  // One authored domain arena is requested per classic encounter. It is presentation-only,
  // consumes no RNG, and the loader keeps at most one decoded background resident.
  if (typeof DatamonBattleArena !== "undefined" && !isAgent) {
    DatamonBattleArena.requestArena(monDomain);
  }
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
      maxHp: matchup.maxHp,
      wrongDamage: matchup.wrongDamage,
      correctHeal: matchup.correctHeal,
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
    b.timerMs = battleTimerLimit(b);
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
      case "PLAYER_HEAL":
        // Correct-answer Jargon recovery is already projected from reducer HP.
        if (!arenaActive) sfx.confirm();
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
        if (b.training) {
          // Training flee: reset current streak, return to Battle Room.
          _trainingLoss(b);
          _agentExitToOverworld(b, "Fled from training! Streak reset.");
        } else {
          _agentExitToOverworld(b, "Fled from the Agent Operations duel!");
        }
        break;
      case "PHASE_SHIFT":
        if (!arenaActive) sfx.confirm();
        break;
      case "VICTORY":
        if (!b._agentVictoryConsumed) {
          b._agentVictoryConsumed = true;
          if (b.training) {
            // Training: record streak, never mark campaign defeat.
            _trainingWin(b);
          } else {
            b.npc.defeated = true;
            defeated.add(b.npc.slug);
            save();
          }
          if (!arenaActive) sfx.victory();
        }
        break;
      case "DEFEAT":
        if (!b._agentDefeatConsumed) {
          b._agentDefeatConsumed = true;
          if (b.training) _trainingLoss(b);
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
  restoreEncounterSeat();
  battle = null;
  player.fx = player.x; player.fy = player.y; player.moving = false; stepT = 1;
  state = "overworld"; bufferedDir = null; turnStartMs = null;
  if (toastMessage) showToast(toastMessage);
}

function _agentFinishVictory(b) {
  if (battle !== b || !b._agentVictoryConsumed) return;
  if (typeof AgentArena !== "undefined") AgentArena.reset();
  wrapCache.clear();
  restoreEncounterSeat();
  battle = null;
  player.fx = player.x; player.fy = player.y; player.moving = false; stepT = 1;
  bufferedDir = null; turnStartMs = null;
  if (b.training) {
    // Training: always return to Battle Room, never trigger campaign victory.
    state = "overworld";
    var agentTrainingWinToast = toast && toast.msg;
    if (b.portraitLed) openPostBattleDialogue(b, true, "overworld", agentTrainingWinToast);
    return;
  }
  var campaignComplete = npcs.every(function (n) { return n.defeated; });
  if (campaignComplete) completeCertificationQuest();
  state = campaignComplete ? "victory" : "overworld";
  if (b.portraitLed) openPostBattleDialogue(b, true, campaignComplete ? "victory" : "overworld", null);
}

function _agentFinishDefeat(b) {
  if (battle !== b || !b._agentDefeatConsumed) return;
  restoreEncounterSeat();
  if (b.training) {
    // Training defeat: no campaign respawn; stay in Battle Room.
    if (typeof AgentArena !== "undefined") AgentArena.reset();
    wrapCache.clear();
    battle = null;
    restorePlayerHp(true);
    player.fx = player.x; player.fy = player.y; player.moving = false; stepT = 1;
    state = "overworld"; bufferedDir = null; turnStartMs = null;
    var agentTrainingLossToast = "Training defeat — HP restored. Try again!";
    showToast(agentTrainingLossToast);
    if (b.portraitLed) openPostBattleDialogue(b, false, "overworld", agentTrainingLossToast);
    return;
  }
  if (typeof AgentArena !== "undefined") AgentArena.reset();
  wrapCache.clear();
  battle = null;
  if (currentMap !== "office") { currentMap = "office"; map = OFFICE_MAP; mapCv = officeMapCv; npcs = officeNpcs; }
  restorePlayerHp(true);
  player.x = player.fx = 18; player.y = player.fy = 16;
  camFx = camFy = null; stepT = 1; player.moving = false;
  state = "overworld"; bufferedDir = null; turnStartMs = null;
  var agentRespawnToast = "You respawned in the lounge with a fresh coffee. HP restored!";
  showToast(agentRespawnToast);
  if (b.portraitLed) openPostBattleDialogue(b, false, "overworld", agentRespawnToast);
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

function battleTerminalMessage(b, playerWon) {
  if (b && b.portraitLed) {
    return playerWon
      ? "You defeated " + displayName(b.npc.slug) + "! Debrief link ready."
      : "You blacked out from imposter syndrome... Recovery debrief ready.";
  }
  if (playerWon) {
    return "You defeated " + displayName(b.npc.slug) + "! "
      + (typeof DatamonDialogue !== "undefined"
        ? '"' + DatamonDialogue.opponentLoss(b.npc.slug, b.npc.type, displayName) + '"'
        : '"' + WIN_QUOTES[Math.floor(Math.random() * WIN_QUOTES.length)] + '"');
  }
  return "You blacked out from imposter syndrome... "
    + (typeof DatamonDialogue !== "undefined"
      ? '"' + DatamonDialogue.opponentWin(b.npc.slug, b.npc.type, displayName) + '"'
      : '"' + LOSE_QUOTES[Math.floor(Math.random() * LOSE_QUOTES.length)] + '"');
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
          b.msg = "Correct! " + action.label + " hit for " + action.damage + " Stability."
            + (ao.outcome.healed ? " Jargon restored " + ao.outcome.healed + " HP." : "")
            + (q && q.x ? " (" + q.x + ")" : "");
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
            b.msg += " You took " + ao.wrongDamage + " damage!";
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
        b.msg = "Good hit! " + (ao.boss ? "Boss Stability: " + ao.stability + "/" + ao.maxStability : "Stability: " + ao.stability + "/" + ao.maxStability)
          + (ao.outcome.healed ? " · Jargon +" + ao.outcome.healed + " HP" : "");
      } else if (ao.outcome && ao.outcome.blocked) {
        b.feedback = { correct: false, blocked: true };
        b.msg = "Guardrail blocked the hit. No HP damage taken.";
      } else {
        b.feedback = { correct: false };
        b.msg = "You took " + ao.wrongDamage + " damage!";
      }
      b.msgAt = frame;
      break;
    case "phase-shift":
      b.msg = displayName(b.npc.slug) + " shifts stance! Phase " + (ao.bossPhase + 1) + " — Stability " + ao.stability + "/" + ao.maxStability + "!";
      b.msgAt = frame;
      break;
    case "victory":
      b.msg = battleTerminalMessage(b, true);
      b.msgAt = frame;
      break;
    case "defeat":
      b.msg = battleTerminalMessage(b, false);
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
    b.timerMs = battleTimerLimit(b); // Caffeine matchup sets the Hard-mode countdown
  } else if (b.phase === "feedback") {
    if (b.feedback.correct) {
      currentMon().alive = false;
      if (b.idx + 1 < b.mons.length) {
        b.idx++;
        sendOutCurrentMon(b);
      } else {
        b.phase = "win";
        b.msg = battleTerminalMessage(b, true);
        b.msgAt = frame;
        sfx.victory();
      }
    } else if (player.hp <= 0) {
      b.phase = "lose";
      b.msg = battleTerminalMessage(b, false);
      b.msgAt = frame;
    } else {
      currentMon().q = drawQuestion(b.npc.type);
      b.phase = "question";
      b.sel = 0; b.attackAt = 0; b.dmgAt = 0;
      b.timerMs = battleTimerLimit(b); // Caffeine matchup sets the next countdown
    }
  } else if (b.phase === "win") {
    restoreEncounterSeat();
    if (b.training) {
      _trainingWin(b);
      var trainingWinToast = toast && toast.msg;
      wrapCache.clear();
      battle = null;
      player.fx = player.x; player.fy = player.y; player.moving = false; stepT = 1;
      state = "overworld"; bufferedDir = null; turnStartMs = null;
      if (b.portraitLed) openPostBattleDialogue(b, true, "overworld", trainingWinToast);
    } else {
      b.npc.defeated = true;
      defeated.add(b.npc.slug);
      save();
      wrapCache.clear();
      battle = null;
      var campaignComplete = npcs.every(function(npc) { return npc.defeated; });
      if (campaignComplete) { completeCertificationQuest(); sfx.victory(); }
      player.fx = player.x; player.fy = player.y; player.moving = false; stepT = 1;
      state = campaignComplete ? "victory" : "overworld"; bufferedDir = null; turnStartMs = null;
      if (b.portraitLed) openPostBattleDialogue(b, true, campaignComplete ? "victory" : "overworld", null);
    }
  } else if (b.phase === "lose") {
    wrapCache.clear();
    restoreEncounterSeat();
    battle = null;
    if (b.training) {
      _trainingLoss(b);
      restorePlayerHp(true);
      player.fx = player.x; player.fy = player.y; player.moving = false; stepT = 1;
      state = "overworld"; bufferedDir = null; turnStartMs = null;
      var trainingLossToast = "Training defeat — HP restored. Try again!";
      showToast(trainingLossToast);
      if (b.portraitLed) openPostBattleDialogue(b, false, "overworld", trainingLossToast);
    } else {
      if (currentMap !== "office") { currentMap = "office"; map = OFFICE_MAP; mapCv = officeMapCv; npcs = officeNpcs; }
      restorePlayerHp(true);
      player.x = player.fx = 18; player.y = player.fy = 16;
      camFx = camFy = null; stepT = 1; player.moving = false;
      state = "overworld"; bufferedDir = null; turnStartMs = null;
      var respawnToast = "You respawned in the lounge with a fresh coffee. HP restored!";
      showToast(respawnToast);
      if (b.portraitLed) openPostBattleDialogue(b, false, "overworld", respawnToast);
    }
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
  _evidenceRevision++;
  save();   // persist immediately so a single answer lands in localStorage
}

function applyCorrectHeal(b) {
  var amount = b && b.attributes ? b.attributes.correctHeal : 0;
  var before = player.hp;
  player.hp = Math.min(battleMaxHp(b), player.hp + amount);
  return player.hp - before;
}

// Shared wrong-answer outcome: attribute-derived damage + shake + mon attack/flash
// animation + feedback. Wrong answers and Hard-mode timeouts use this exact path.
function applyWrongHit(b, msg) {
  sfx.wrong();
  player.hp = Math.max(0, player.hp - battleWrongDamage(b));
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
    var healed = applyCorrectHeal(b);
    b.feedback = { correct: true, healed: healed };
    b.msg = `Correct! ${currentMon().name.toUpperCase()} fainted!`
      + (healed ? ` Jargon restored ${healed} HP.` : "")
      + (q.x ? ` (${q.x})` : "");
    b.faintAt = frame;
    b.msgAt = frame;
    b.phase = "feedback";
  } else {
    var damage = battleWrongDamage(b);
    applyWrongHit(b, `Wrong! It was "${q.c[q.a]}". ${q.x || ""} ${currentMon().name.toUpperCase()} hits you for ${damage}!`);
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
  var damage = battleWrongDamage(b);
  applyWrongHit(b, `Time's up! It was "${currentMon().q.c[currentMon().q.a]}". ${currentMon().name.toUpperCase()} hits you for ${damage}!`);
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
    // SUCCESS — flee to the overworld.
    sfx.confirm();
    wrapCache.clear();
    restoreEncounterSeat();
    battle = null;
    if (b.training) {
      _trainingLoss(b);
      restorePlayerHp(true);
    }
    player.fx = player.x; player.fy = player.y; player.moving = false; stepT = 1;
    state = "overworld"; bufferedDir = null; turnStartMs = null;
    showToast(b.training ? "Fled from training! Streak reset." : "Got away safely!");
  } else {
    // FAILURE — same attack path as a wrong answer (damage + shake + hit animation).
    sfx.wrong();
    player.hp = Math.max(0, player.hp - battleWrongDamage(b));
    b.shake = 14;
    b.attackAt = frame;
    b.dmgAt = frame;
    if (player.hp <= 0) {
      // route into the existing lose/blackout flow (advanceBattle() handles it on advance)
      b.feedback = { correct: false };
      b.msg = battleTerminalMessage(b, false);
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

// ---------- Training streak helpers (#046) ----------
// Centralised exact-once completion for classic and Agent training encounters.
// Isolates campaign progression and mutates only _progression.activities.battleRoom.
function _trainingWin(b) {
  if (b && b._trainingOutcomeConsumed) return;
  if (b) b._trainingOutcomeConsumed = true;
  if (!_progression || !_progression.activities) return;
  var br = _progression.activities.battleRoom;
  if (!br || typeof br !== "object") {
    br = { currentStreak: 0, bestStreak: 0, wins: 0 };
    _progression.activities.battleRoom = br;
  }
  br.currentStreak = (typeof br.currentStreak === "number" ? br.currentStreak : 0) + 1;
  br.wins = (typeof br.wins === "number" ? br.wins : 0) + 1;
  if (br.currentStreak > (typeof br.bestStreak === "number" ? br.bestStreak : 0)) {
    br.bestStreak = br.currentStreak;
  }
  save();
  showToast("Training win! Streak: " + br.currentStreak + " (best: " + br.bestStreak + ", wins: " + br.wins + ")");
}

function _trainingLoss(b) {
  if (b && b._trainingOutcomeConsumed) return;
  if (b) b._trainingOutcomeConsumed = true;
  if (!_progression || !_progression.activities) return;
  var br = _progression.activities.battleRoom;
  if (!br || typeof br !== "object") {
    br = { currentStreak: 0, bestStreak: 0, wins: 0 };
    _progression.activities.battleRoom = br;
  }
  br.currentStreak = 0;
  save();
}

// ---------- Location HUD (#046) ----------
// Fixed top-right 286×52 instrument; replaces floating floor plaques.
// Derived from committed player tile for office, map identity for Library and Battle Room.
var _lastLocationKey = null;
var _locationPoliteEl = null;
const LOCATION_PURPOSES = Object.freeze({
  AGENT: "Debrief agent strategy with mentors",
  MCP: "Review tool interfaces with mentors",
  CONFIG: "Audit settings and deployment with mentors",
  PROMPT: "Critique prompts with mentors",
  CONTEXT: "Triage context reliability with mentors",
  MIX: "Review your recommended weak domain",
});

function locationHudLabel() {
  if (currentMap === "library") return "The Library";
  if (currentMap === "battleRoom") return "Battle Room";
  // Office: derive from committed player tile via regionOf
  var region = regionOf(player.x, player.y);
  return (TYPE_NAMES[region] || "Office");
}

function locationHudPurpose() {
  if (currentMap === "library") return "Learn unseen material and rehearse";
  if (currentMap === "battleRoom") return "Test due concepts in safe rematches";
  var region = regionOf(player.x, player.y);
  return LOCATION_PURPOSES[region] || "Office workspace";
}

function locationHudAccent() {
  if (currentMap === "library") return TYPE_COLORS["CONTEXT"];
  if (currentMap === "battleRoom") return "#ef4444";
  return TYPE_COLORS[regionOf(player.x, player.y)] || "#94a3b8";
}

function announceLocation(label, purpose, force) {
  if (!force && _lastLocationKey === currentMap + ":" + (label || "")) return;
  _lastLocationKey = currentMap + ":" + (label || "");
  // Use the existing polite live-region for assistive technology.
  if (typeof document !== "undefined") {
    if (!_locationPoliteEl) {
      _locationPoliteEl = document.getElementById("datamon-announcer");
    }
    if (_locationPoliteEl) {
      var text = (label || "") + ". " + (purpose || "");
      _locationPoliteEl.textContent = "";
      // Re-setting after a microtask lets screen readers re-read.
      setTimeout(function() {
        if (_locationPoliteEl && state !== "dialogue" && performance.now() >= dialogueAnnouncementHoldUntil) {
          _locationPoliteEl.textContent = text;
        }
      }, 0);
    }
  }
}

// ---- Destination preview (#049): door-facing projections ----
// When the player stands adjacent to (and faces) the Context, Battle, or Library
// entrance, the Location HUD temporarily projects destination, purpose, accent,
// and interaction hint. This does not affect collision or interaction logic.
function officeDestinationPreview() {
  if (currentMap !== "office") return null;
  var ft = facingTile();
  var facing = map[ft[1]] && map[ft[1]][ft[0]];

  // Context meeting-room door: walk-through
  if (ft[0] === 7 && ft[1] === 15 && facing === ".") {
    return {
      label: "Reliability Triage",
      purpose: "Review Context with bested mentors",
      accent: TYPE_COLORS["CONTEXT"],
      hint: "AHEAD: Reliability Triage · review Context",
      announce: "Reliability Triage ahead. Review Context concepts with bested mentors inside.",
    };
  }
  // Battle Room door: interact
  if (facing === "A" && (ft[0] === 11 && ft[1] === 23)) {
    return {
      label: "Battle Room",
      purpose: "Test due concepts in safe rematches",
      accent: "#ef4444",
      hint: "SPACE: enter Battle Room · Test & Retain",
      announce: "Battle Room ahead. Test and retain due concepts in safe rematches. Press Enter to enter.",
    };
  }
  // Library door: interact
  if (facing === "L" && (ft[0] === 24 && ft[1] === 23)) {
    return {
      label: "The Library",
      purpose: "Learn unseen material and rehearse",
      accent: "#f2b35d",
      hint: "SPACE: enter Library · Learn & Rehearse",
      announce: "The Library ahead. Learn unseen material and rehearse with reading and study stations. Press Enter to enter.",
    };
  }
  return null;
}

function drawLocationHUD() {
  var hudX = CANVAS_W - 294, hudY = 8, hudW = 286, hudH = 52;
  // #049: destination preview overrides normal location HUD when facing an entrance
  var preview = officeDestinationPreview();
  var label = preview ? preview.label : locationHudLabel();
  var purpose = preview ? preview.purpose : locationHudPurpose();
  var accent = preview ? preview.accent : locationHudAccent();

  ctx.fillStyle = "rgba(15,23,42,0.85)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(hudX, hudY, hudW, hudH, 6);
  else ctx.fillRect(hudX, hudY, hudW, hudH);
  ctx.fill();

  // Accent left border
  ctx.fillStyle = accent;
  ctx.fillRect(hudX, hudY + 6, 3, hudH - 12);

  // "LOCATION" utility label
  ctx.fillStyle = "#94a3b8";
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillText("LOCATION", hudX + 12, hudY + 16);

  // Room name in accent color
  ctx.fillStyle = accent;
  ctx.font = "bold 13px monospace";
  ctx.fillText(label, hudX + 12, hudY + 32);

  // Purpose always remains visible; the contextual bottom hint carries the action key.
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px monospace";
  ctx.fillText(purpose, hudX + 12, hudY + 46);
}

// ---- Evidence HUD (#047): compact study-readiness strip below location instrument ----
var _cachedEvidenceHUD = null;
var _cachedEvidenceSummary = null;
var _cachedEvidenceRevision = -1;
var _evidenceRevision = 0;
function _getEvidenceSummary() {
  if (_cachedEvidenceRevision === _evidenceRevision) return _cachedEvidenceSummary;
  _cachedEvidenceRevision = _evidenceRevision;
  _cachedEvidenceSummary = (typeof DatamonProgress !== "undefined" && typeof QUESTION_BANK !== "undefined")
    ? DatamonProgress.summarise(QUESTION_BANK, questionStats, seenCounter) : null;
  if (_cachedEvidenceSummary && _cachedEvidenceSummary.recommendation) {
    var key = _cachedEvidenceSummary.recommendation.key;
    _cachedEvidenceHUD = "EVIDENCE " + _cachedEvidenceSummary.evidencePct + "% · " + (TYPE_NAMES[key] || key);
  } else {
    _cachedEvidenceHUD = null;
  }
  return _cachedEvidenceSummary;
}
function _getEvidenceHUD() {
  _getEvidenceSummary();
  return _cachedEvidenceHUD;
}
function drawEvidenceHUD() {
  var hudText = _getEvidenceHUD();
  if (!hudText) return;
  var hudX = CANVAS_W - 294, hudY = 64, hudW = 286, hudH = 22;
  ctx.fillStyle = "rgba(15,23,42,0.78)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(hudX, hudY, hudW, hudH, 4);
  else ctx.fillRect(hudX, hudY, hudW, hudH);
  ctx.fill();
  // Small accent bar connecting to the location instrument
  ctx.fillStyle = locationHudAccent();
  ctx.fillRect(hudX, hudY, 3, hudH);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  ctx.fillText(hudText, hudX + 12, hudY + 15);
}

// ---- Mentor Review Modal (#049): defeated-colleague one-question review ----
// Freezes overworld movement/input behind the modal. Clears on Escape, reset, search,
// battle, warps, map swap, and victory lifecycle paths.
function openMentorReview(npc) {
  if (!npc || state !== "overworld" || currentMap !== "office" || npc.training) return;
  if (mentorReview) return; // Don't stack modals

  var reviewDomain = npc.type;
  var review = (typeof DatamonProgress !== "undefined" && typeof QUESTION_BANK !== "undefined")
    ? DatamonProgress.selectReviewQuestion(QUESTION_BANK, questionStats, seenCounter, reviewDomain)
    : null;
  if (!review) {
    showToast(displayName(npc.slug) + " has no review material for you right now.");
    return;
  }

  // Apply reveal telemetry once and retain the reducer's consumed event token.
  var revealEvent = { type: "reveal", consumed: false };
  var telemetry = (typeof DatamonProgress !== "undefined")
    ? DatamonProgress.applyReviewTelemetry(questionStats, seenCounter, review, revealEvent)
    : null;
  if (telemetry && telemetry.changed) {
    questionStats = telemetry.questionStats;
    seenCounter = telemetry.seenCounter;
    _evidenceRevision++;
    save();
  }

  var question = review.question;
  var mentorLine = (typeof DatamonDialogue !== "undefined")
    ? DatamonDialogue.getLine(npc.slug, "campaign-follow-up", npc.type)
    : "Let's turn that battle into one useful review.";
  mentorReview = {
    npc: npc,
    question: question,
    review: review,
    sel: 0,
    phase: "question",     // question → feedback → close
    feedback: null,        // {correct: bool}
    msgAt: frame,
    answered: false,
    revealEvent: telemetry && telemetry.event ? telemetry.event : revealEvent,
    answerEvent: null,
    mentorLine: mentorLine,
  };

  sfx.select();
  toast = null;
  bufferedDir = null;
  if (typeof document !== "undefined") {
    var announcer = document.getElementById("datamon-announcer");
    if (announcer) {
      var spokenChoices = (question.c || []).map(function (choice, index) {
        return (index + 1) + ", " + choice;
      }).join(". ");
      announcer.textContent = "Review with " + displayName(npc.slug) + ": " +
        question.q + " " + spokenChoices + ". Arrow keys or 1 through 4 to choose; Enter to answer; Escape to close.";
    }
  }
}

function drawMentorReview() {
  if (!mentorReview) return;
  var mr = mentorReview;
  var q = mr.question;

  // Full-canvas scrim
  ctx.fillStyle = "rgba(8,12,24,0.78)";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Modal panel
  var mx = 60, my = 80, mw = CANVAS_W - 120, mh = CANVAS_H - 160;
  ctx.fillStyle = "rgba(12,18,36,0.97)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(mx, my, mw, mh, 8);
  else ctx.fillRect(mx, my, mw, mh);
  ctx.fill();
  ctx.strokeStyle = TYPE_COLORS[mr.npc.type] || "#94a3b8";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Header: mentor identity + domain
  var accent = TYPE_COLORS[mr.npc.type] || "#94a3b8";
  ctx.fillStyle = accent;
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(displayName(mr.npc.slug), mx + 20, my + 28);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px monospace";
  ctx.fillText('"' + mr.mentorLine + '"', mx + 20, my + 44);
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "left";
  ctx.fillText((TYPE_NAMES[mr.review.domain] || mr.review.domain) + " · " +
    (mr.review.reason === "due" ? "DUE" : mr.review.reason === "unseen" ? "UNSEEN" : "REFRESH"),
    mx + 220, my + 28);
  ctx.fillStyle = "rgba(148,163,184,0.12)"; ctx.fillRect(mx + mw - 92, my + 10, 72, 26);
  ctx.strokeStyle = "#64748b"; ctx.lineWidth = 1; ctx.strokeRect(mx + mw - 92, my + 10, 72, 26);
  ctx.fillStyle = "#cbd5e1"; ctx.textAlign = "center"; ctx.fillText("CLOSE ×", mx + mw - 56, my + 27);

  // Divider
  ctx.fillStyle = "rgba(148,163,184,0.25)";
  ctx.fillRect(mx + 16, my + 52, mw - 32, 1);

  // Question text
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "13px monospace";
  ctx.textAlign = "left";
  var questionLines = wrapText(q.q, mw - 40);
  var qy = my + 72;
  for (var li = 0; li < questionLines.length; li++) {
    ctx.fillText(questionLines[li], mx + 20, qy + li * 18);
  }
  qy += questionLines.length * 18 + 12;

  // Choices
  var choices = q.c || [];
  var correctIndex = q.correct != null ? q.correct : q.a;
  var choiceY = qy;
  for (var ci = 0; ci < choices.length; ci++) {
    var cy = choiceY + ci * 36;
    var selected = ci === mr.sel;
    var isCorrectAnswer = ci === correctIndex;
    var isWrongSelected = mr.phase === "feedback" && selected && !mr.feedback.correct;
    var isCorrectRevealed = mr.phase === "feedback" && isCorrectAnswer;

    // Choice background
    var bgColor = isCorrectRevealed ? "rgba(34,197,94,0.18)"
      : isWrongSelected ? "rgba(239,68,68,0.18)"
      : selected && mr.phase === "question" ? "rgba(148,163,184,0.15)"
      : "rgba(148,163,184,0.04)";
    ctx.fillStyle = bgColor;
    var ch = 34;
    ctx.fillRect(mx + 16, cy, mw - 32, ch);
    if (selected || isCorrectRevealed) {
      ctx.fillStyle = isWrongSelected ? "#ef4444" : isCorrectRevealed ? "#22c55e" : accent;
      ctx.fillRect(mx + 16, cy, 3, ch);
    }

    // Number
    ctx.fillStyle = selected ? "#e2e8f0" : "#64748b";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "left";
    ctx.fillText((ci + 1), mx + 28, cy + 22);

    // Choice text
    ctx.fillStyle = (mr.phase === "feedback" && !isCorrectAnswer && !selected) ? "#64748b" : "#e2e8f0";
    ctx.font = "12px monospace";
    var choiceLines = wrapText(choices[ci], mw - 80);
    for (var cl = 0; cl < Math.min(2, choiceLines.length); cl++) {
      ctx.fillText(choiceLines[cl], mx + 48, cy + 16 + cl * 14);
    }

    // Feedback markers
    if (mr.phase === "feedback") {
      ctx.textAlign = "right";
      if (isCorrectAnswer) {
        ctx.fillStyle = "#22c55e";
        ctx.font = "bold 11px monospace";
        ctx.fillText("CORRECT", mx + mw - 28, cy + 22);
      } else if (isWrongSelected) {
        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 11px monospace";
        ctx.fillText("WRONG", mx + mw - 28, cy + 22);
      }
    }
  }
  choiceY += choices.length * 36 + 16;

  // Explanation (after answer)
  if (mr.phase === "feedback" && q.x) {
    ctx.fillStyle = "rgba(148,163,184,0.15)";
    ctx.fillRect(mx + 16, choiceY, mw - 32, 1);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    var expLines = wrapText(q.x, mw - 40);
    for (var ei = 0; ei < expLines.length; ei++) {
      ctx.fillText(expLines[ei], mx + 20, choiceY + 16 + ei * 15);
    }
  }

  // Bottom hint
  ctx.fillStyle = "#64748b";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  var hintY = my + mh - 14;
  if (mr.phase === "question") {
    ctx.fillText("\u2191\u2193 select  \u00b7  1-4 choose  \u00b7  Enter/Space confirm  \u00b7  ESC close", mx + mw / 2, hintY);
  } else {
    ctx.fillText("Enter/Space to close  \u00b7  ESC close", mx + mw / 2, hintY);
  }
}

function handleMentorReviewKey(k) {
  if (!mentorReview) return false;
  var mr = mentorReview;
  var choices = mr.question.c || [];

  if (k === "Escape" || k === "esc") {
    closeMentorReview();
    return true;
  }

  if (mr.phase === "question") {
    if (k === "ArrowUp" || k === "ArrowLeft" || k === "up" || k === "left") {
      mr.sel = (mr.sel + choices.length - 1) % choices.length;
      _announceMentorChoice();
      return true;
    }
    if (k === "ArrowDown" || k === "ArrowRight" || k === "down" || k === "right") {
      mr.sel = (mr.sel + 1) % choices.length;
      _announceMentorChoice();
      return true;
    }
    if (["1", "2", "3", "4"].includes(k)) {
      submitMentorAnswer(parseInt(k) - 1);
      return true;
    }
    if (k === "Enter" || k === " " || k === "Space") {
      submitMentorAnswer(mr.sel);
      return true;
    }
  } else if (mr.phase === "feedback") {
    if (k === "Enter" || k === " " || k === "Space") {
      closeMentorReview();
      return true;
    }
  }
  return false;
}

function submitMentorAnswer(index) {
  if (!mentorReview || mentorReview.phase !== "question") return;
  var mr = mentorReview;
  var q = mr.question;
  if (!Number.isInteger(index) || index < 0 || index >= (q.c || []).length || mr.answered) return;
  var correctIndex = q.correct != null ? q.correct : q.a;
  var correct = index === correctIndex;

  mr.sel = index;
  mr.answered = true;
  mr.phase = "feedback";
  mr.feedback = { correct: correct };
  mr.msgAt = frame;

  // Apply answer telemetry with a retained consumed token so duplicate dispatch is a no-op.
  if (typeof DatamonProgress !== "undefined") {
    if (!mr.answerEvent) mr.answerEvent = { type: "answer", correct: correct, consumed: false };
    var telemetry = DatamonProgress.applyReviewTelemetry(
      questionStats, seenCounter, mr.review, mr.answerEvent
    );
    if (telemetry && telemetry.event) mr.answerEvent = telemetry.event;
    if (telemetry && telemetry.changed) {
      questionStats = telemetry.questionStats;
      seenCounter = telemetry.seenCounter;
      _evidenceRevision++;
      save();
    }
  }

  if (correct) sfx.correct(); else sfx.wrong();

  if (typeof document !== "undefined") {
    var announcer = document.getElementById("datamon-announcer");
    if (announcer) {
      var msg = correct
        ? "Correct! " + (q.x || "")
        : "Wrong. The correct answer was: " + q.c[correctIndex] + ". " + (q.x || "");
      announcer.textContent = msg;
    }
  }
}

function closeMentorReview() {
  if (!mentorReview) return;
  mentorReview = null;
  sfx.select();
  if (typeof document !== "undefined") {
    var announcer = document.getElementById("datamon-announcer");
    if (announcer) announcer.textContent = "Review closed.";
  }
}

// Centralised lifecycle clear — modal must not survive reset, battle, warps, or map swaps.
function clearMentorReview() {
  if (mentorReview) mentorReview = null;
}

function _announceMentorChoice() {
  if (!mentorReview || typeof document === "undefined") return;
  var announcer = document.getElementById("datamon-announcer");
  if (!announcer) return;
  var mr = mentorReview;
  var choices = mr.question.c || [];
  var text = "Choice " + (mr.sel + 1) + " of " + choices.length + ": " + choices[mr.sel];
  announcer.textContent = text;
}
function drawCertConsole() {
  // Full-canvas command-center dossier.
  var bgX = 40, bgY = 40, bgW = CANVAS_W - 80, bgH = CANVAS_H - 80;

  // Scrim
  ctx.fillStyle = "rgba(8,12,24,0.82)";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Main panel
  ctx.fillStyle = "rgba(12,18,36,0.97)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bgX, bgY, bgW, bgH, 8);
  else ctx.fillRect(bgX, bgY, bgW, bgH);
  ctx.fill();
  ctx.strokeStyle = "#2dd4bf";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Header
  ctx.fillStyle = "#2dd4bf";
  ctx.font = "bold 16px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("CERTIFICATION CONSOLE", bgX + 24, bgY + 34);
  ctx.fillStyle = "#64748b";
  ctx.font = "10px monospace";
  ctx.textAlign = "right";
  ctx.fillText("ESC to close", bgX + bgW - 24, bgY + 34);

  // Divider
  ctx.fillStyle = "rgba(45, 212, 191, 0.3)";
  ctx.fillRect(bgX + 20, bgY + 46, bgW - 40, 1);

  // Progress summary — compute from DatamonProgress
  var summary = _getEvidenceSummary();
  if (!summary) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "13px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Study data unavailable — explore the office and battle colleagues!", bgX + bgW / 2, bgY + 90);
    return;
  }

  // Overall evidence header
  var overallY = bgY + 70;
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 28px monospace";
  ctx.textAlign = "center";
  ctx.fillText(summary.evidencePct + "%", bgX + bgW / 2, overallY);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px monospace";
  ctx.fillText("WEIGHTED STUDY EVIDENCE · NOT A PASS PREDICTION", bgX + bgW / 2, overallY + 20);
  ctx.fillText(summary.evidenceLabel, bgX + bgW / 2, overallY + 36);

  // Domain rows
  var rowY = overallY + 56;
  var rowH = 40;
  var colLabelsX = bgX + 40;
  var colNameW = 120, colCovW = 60, colAccW = 60, colEvW = 60, colDueW = 60, colUnseenW = 70;

  // Column headers
  ctx.fillStyle = "#64748b";
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillText("DOMAIN", colLabelsX, rowY - 6);
  ctx.textAlign = "center";
  var cx = colLabelsX + colNameW;
  ctx.fillText("COVERAGE", cx + colCovW / 2, rowY - 6);
  cx += colCovW;
  ctx.fillText("ACCURACY", cx + colAccW / 2, rowY - 6);
  cx += colAccW;
  ctx.fillText("EVIDENCE", cx + colEvW / 2, rowY - 6);
  cx += colEvW;
  ctx.fillText("DUE", cx + colDueW / 2, rowY - 6);
  cx += colDueW;
  ctx.fillText("UNSEEN", cx + colUnseenW / 2, rowY - 6);

  for (var i = 0; i < summary.domains.length; i++) {
    var d = summary.domains[i];
    var ry = rowY + i * rowH;
    var sel = i === certConsoleSel;
    var accent = TYPE_COLORS[d.key] || "#94a3b8";

    // Row background
    if (sel) {
      ctx.fillStyle = "rgba(148,163,184,0.08)";
      ctx.fillRect(bgX + 12, ry, bgW - 24, rowH - 2);
      ctx.fillStyle = accent;
      ctx.fillRect(bgX + 12, ry, 3, rowH - 2);
    }

    // Domain name with weight
    ctx.fillStyle = accent;
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "left";
    var domainLabel = (typeof TYPE_NAMES !== "undefined" ? TYPE_NAMES[d.key] : d.key);
    ctx.fillText(domainLabel, colLabelsX, ry + 16);
    ctx.fillStyle = "#64748b";
    ctx.font = "9px monospace";
    ctx.fillText("Weight: " + d.weight + "%", colLabelsX, ry + 28);

    // Metrics
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    cx = colLabelsX + colNameW;
    ctx.fillText(Math.round(d.coverage * 100) + "%", cx + colCovW / 2, ry + 20);
    cx += colCovW;
    ctx.fillText(Math.round(d.accuracy * 100) + "%", cx + colAccW / 2, ry + 20);
    cx += colAccW;
    ctx.fillText(Math.round(d.evidence * 100) + "%", cx + colEvW / 2, ry + 20);
    cx += colEvW;
    ctx.fillStyle = d.due > 0 ? "#f87171" : "#22c55e";
    ctx.fillText(String(d.due), cx + colDueW / 2, ry + 20);
    cx += colDueW;
    ctx.fillStyle = d.unseen > 0 ? "#fbbf24" : "#22c55e";
    ctx.fillText(String(d.unseen), cx + colUnseenW / 2, ry + 20);
  }

  // Recommendation
  var recY = rowY + summary.domains.length * rowH + 16;
  ctx.fillStyle = "rgba(45, 212, 191, 0.2)";
  ctx.fillRect(bgX + 20, recY, bgW - 40, 1);
  if (summary.recommendation) {
    var rec = summary.recommendation;
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "left";
    ctx.fillText("NEXT STUDY TARGET", bgX + 40, recY + 20);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "12px monospace";
    var recText = (typeof DatamonProgress !== "undefined")
      ? DatamonProgress.recommendationText(QUESTION_BANK, questionStats, seenCounter)
      : "Study " + (typeof TYPE_NAMES !== "undefined" ? TYPE_NAMES[rec.key] : rec.key) + ".";
    ctx.fillText(recText, bgX + 40, recY + 38);
  }

  // Keyboard hint
  ctx.fillStyle = "#64748b";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.fillText("\u2191\u2193 navigate  \u00b7  ENTER detail  \u00b7  P replay briefing  \u00b7  ESC close", bgX + bgW / 2, bgY + bgH - 16);
}

// ---- Certification Console input handling (#047) ----
function handleCertConsoleKey(key) {
  if (key === "Escape" || key === "esc") {
    certConsoleOpen = false;
    certConsoleSel = 0;
    sfx.select();
    if (typeof document !== "undefined") {
      var announcer = document.getElementById("datamon-announcer");
      if (announcer) announcer.textContent = "Certification Console closed.";
    }
    return true;
  }
  if (!certConsoleOpen) return false;
  if (key === "p" || key === "P") {
    certConsoleOpen = false;
    certConsoleSel = 0;
    openPrologue(true);
    return true;
  }
  var summary = _getEvidenceSummary();
  var maxSel = summary ? summary.domains.length - 1 : 4;
  if (key === "ArrowUp" || key === "up") {
    certConsoleSel = Math.max(0, certConsoleSel - 1);
    _announceConsoleSelection();
    return true;
  }
  if (key === "ArrowDown" || key === "down") {
    certConsoleSel = Math.min(maxSel, certConsoleSel + 1);
    _announceConsoleSelection();
    return true;
  }
  if (key === "Enter" || key === " " || key === "Space") {
    _announceConsoleDetail();
    return true;
  }
  return false;
}

function _announceConsoleSelection() {
  if (typeof document === "undefined") return;
  var announcer = document.getElementById("datamon-announcer");
  if (!announcer) return;
  var summary = _getEvidenceSummary();
  if (!summary || !summary.domains[certConsoleSel]) return;
  var d = summary.domains[certConsoleSel];
  var name = (typeof TYPE_NAMES !== "undefined" ? TYPE_NAMES[d.key] : d.key);
  announcer.textContent = name + ": " + Math.round(d.evidence * 100) + "% evidence, "
    + Math.round(d.coverage * 100) + "% coverage, " + Math.round(d.accuracy * 100) + "% accuracy.";
}

function _announceConsoleDetail() {
  if (typeof document === "undefined") return;
  var announcer = document.getElementById("datamon-announcer");
  if (!announcer) return;
  var summary = _getEvidenceSummary();
  if (!summary) return;
  var selected = summary.domains[certConsoleSel];
  var text = "Overall study evidence: " + summary.evidencePct + " percent. ";
  if (selected) {
    text += (TYPE_NAMES[selected.key] || selected.key) + ": " +
      Math.round(selected.coverage * 100) + " percent coverage, " +
      Math.round(selected.accuracy * 100) + " percent accuracy, " +
      selected.due + " due, " + selected.unseen + " unseen. ";
  }
  if (summary.recommendation) {
    text += "Recommended next: " + (TYPE_NAMES[summary.recommendation.key] || summary.recommendation.key) + ".";
  }
  announcer.textContent = text;
}

// ---------- Input ----------
const keys = {};
const agentActivationKeys = new Set();
const dialogueActivationKeys = new Set();
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
  if (e.key === "Escape" && (state === "dialogue" || (state === "battle" && battle && (battle.phase === "question" || (battle.agentOps && (battle.agentOps.phase === "action" || battle.agentOps.phase === "choice")))))) e.preventDefault();
  const code = e.code || "";
  const alreadyDown = !!keys[e.key] || !!(code && keys[code]);
  const agentOwned = agentActivationKeys.has(e.key);
  const inAgentBattle = state === "battle" && battle && battle.agentOps;
  keys[e.key] = true;
  if (code) keys[code] = true; // physical key codes survive Shift/Caps Lock/layout changes
  const pressedDir = KEY_DIR[e.key] || KEY_DIR[code];
  if (state === "overworld" && pressedDir && !coffeePrompt && !bookPrompt && !readerState && !scout && !certConsoleOpen && !mentorReview) {
    if (player.moving) bufferedDir = pressedDir;
    else {
      // A quick tap must move—not merely turn. Holding/repeat continues through the normal loop.
      player.dir = pressedDir;
      turnStartMs = null;
      tryStep(pressedDir);
    }
  }
  // A held activation cannot cross dialogue beats/choices or answer and then close a mentor modal.
  var dialogueKeySupported = ["Enter", " ", "Space", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "1", "2", "3", "4", "5", "6"].includes(e.key);
  var dialogueActivation = (state === "dialogue" && dialogueKeySupported) || dialogueActivationKeys.has(e.key);
  if (dialogueActivation && (e.repeat || alreadyDown)) return;
  if (state === "dialogue" && dialogueKeySupported) dialogueActivationKeys.add(e.key);
  var mentorActivation = mentorReview && ["Enter", " ", "Space", "1", "2", "3", "4"].includes(e.key);
  if (mentorActivation && (e.repeat || alreadyDown)) return;
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
  dialogueActivationKeys.delete(e.key);
}, true);
window.addEventListener("blur", () => {
  for (const key in keys) keys[key] = false;
  agentActivationKeys.clear();
  dialogueActivationKeys.clear();
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

  if (state === "dialogue") {
    handleDialogueKey(k);
    return;
  }

  if (state === "title") {
    if (k === "Enter" || k === " ") {
      sfx.confirm();
      const s = getSave();
      if (s) {
        player.slug = s.player;
        restorePlayerHp(true);
        player.seated = null; certConsoleOpen = false; clearMentorReview(); resetDialogueLifecycle();
        loadWalkAnim(player.slug); // prewarmed at boot; idempotent if already complete
        gameplayIdleBootstrap(player.slug);
        defeated = new Set(s.defeated);
        placeNPCs();
        if (npcs.every(n => n.defeated)) { state = "victory"; }
        else if (certificationQuestRecord() && certificationQuestRecord().prologueSeen === false) {
          openPrologue(false);
        } else { state = "overworld"; bufferedDir = null; turnStartMs = null; }
      } else {
        state = "select";
        loadWalkAnim(ROSTER[selectIdx]);
        announceSelectProfile();
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
      seenCounter = 0; _evidenceRevision++; clearMentorReview(); resetDialogueLifecycle();
      resetSitAssetCache();
      seenThisRun = {};
      coffeeUses = 3;
      difficulty = "normal";
      libraryProgress = {}; minigameScores = {}; currentMinigame = null;
      _progression = freshProgression();
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
      gameplayIdleBootstrap(player.slug);
      resetSitAssetCache();
      defeated = new Set();
      restorePlayerHp(true);
      player.x = player.fx = 18; player.y = player.fy = 16;
      player.seated = null; certConsoleOpen = false; clearMentorReview();
      camFx = camFy = null; stepT = 1; player.moving = false;
      _progression = freshProgression();
      _npcDomains = _progression.npcDomains;
      createFreshCertificationQuest();
      placeNPCs();
      coffeeUses = 3;
      libraryProgress = {}; minigameScores = {}; currentMinigame = null;  // #028 — fresh character starts clean
      save();
      state = "overworld"; bufferedDir = null; turnStartMs = null;
      openPrologue(false);
    }
  } else if (state === "overworld") {
    // #049: Mentor review modal intercepts before all overworld input
    if (mentorReview) {
      handleMentorReviewKey(k);
      return;
    }
    if (scout) return;                                  // camera pan cinematic — ignore input
    // Certification Console key handling (#047)
    if (certConsoleOpen) {
      handleCertConsoleKey(k);
      return;
    }
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
function openSearch() {
  leaveSeat();
  certConsoleOpen = false;
  clearMentorReview(); // #049
  state = "search"; searchQuery = ""; recomputeSearch(); sfx.select();
}
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
const activeDialoguePointers = new Set();
// Pointerdown owns adjacent overworld interactions. Swallow its synthetic follow-on click
// so opening a modal can never also select/answer/close inside the newly opened layer.
let suppressCanvasClickUntil = 0;
let suppressCanvasClickPointerId = null;
canvas.addEventListener("pointerdown", e => {
  try { canvas.focus({ preventScroll: true }); } catch (_) { canvas.focus(); }
  if (typeof AgentArena !== "undefined") AgentArena.unlockAudio();
  if (typeof DatamonMusic !== "undefined") DatamonMusic.unlock();
  if (state === "dialogue" && dialogueSession) {
    if (activeDialoguePointers.has(e.pointerId)) return;
    activeDialoguePointers.add(e.pointerId);
    const [mx, my] = canvasPos(e);
    handleDialoguePointer(mx, my, "pointerdown");
    suppressCanvasClickUntil = performance.now() + 750;
    suppressCanvasClickPointerId = e.pointerId;
    e.preventDefault();
    return;
  }
  if (state === "overworld" && (certConsoleOpen || mentorReview)) return; // modal click is handled once by `click`
  if (state === "overworld" && !coffeePrompt && !bookPrompt && !readerState && !scout) {
    const [mx, my] = canvasPos(e);
    const dir = pointerDirection(mx, my);
    if (dir) {
      // Adjacent pointer interaction (#046): if the tapped direction leads to an
      // adjacent NPC, interactive door tile, free seat, or Certification Console,
      // face-and-interact instead of stepping.
      player.dir = dir;
      var ft = facingTile();
      var adjacentNpc = npcs.find(function(n) { return n.x === ft[0] && n.y === ft[1]; });
      var adjacentPortal = map[ft[1]] && (map[ft[1]][ft[0]] === "L" || map[ft[1]][ft[0]] === "A");
      var adjacentSeat = isFreePlayerSeat(ft[0], ft[1]);
      var adjacentConsole = map[ft[1]] && map[ft[1]][ft[0]] === "X" && currentMap === "office";
      if (!player.moving && (adjacentNpc || adjacentPortal || adjacentSeat || adjacentConsole)) {
        suppressCanvasClickUntil = performance.now() + 750;
        suppressCanvasClickPointerId = e.pointerId;
        interact();
        e.preventDefault();
        return;
      }
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
  activeDialoguePointers.delete(e.pointerId);
  if (typeof AgentArena !== "undefined") AgentArena.setHover(null, -1, false);
});
window.addEventListener("pointercancel", e => {
  releasePointerMovement(e.pointerId);
  activeAgentPointers.delete(e.pointerId);
  activeDialoguePointers.delete(e.pointerId);
  if (suppressCanvasClickPointerId === e.pointerId) {
    suppressCanvasClickUntil = 0;
    suppressCanvasClickPointerId = null;
  }
  if (typeof AgentArena !== "undefined") AgentArena.setHover(null, -1, false);
});
window.addEventListener("blur", () => {
  pointerMoveId = null; pointerMoveDir = null;
  activeAgentPointers.clear();
  activeDialoguePointers.clear();
  suppressCanvasClickUntil = 0; suppressCanvasClickPointerId = null;
});

canvas.addEventListener("click", e => {
  var clickNow = performance.now();
  var samePointer = !e.pointerId || suppressCanvasClickPointerId == null || e.pointerId === suppressCanvasClickPointerId;
  if (clickNow <= suppressCanvasClickUntil && samePointer) {
    suppressCanvasClickUntil = 0; suppressCanvasClickPointerId = null;
    e.preventDefault();
    return;
  }
  if (clickNow > suppressCanvasClickUntil) {
    suppressCanvasClickUntil = 0; suppressCanvasClickPointerId = null;
  }
  const [mx, my] = canvasPos(e);
  if (state === "dialogue" && dialogueSession) {
    handleDialoguePointer(mx, my, "click");
    e.preventDefault();
    return;
  }
  if (bookPrompt || readerState) return; // swallow clicks behind book modal (keyboard-only UI)
  if (mentorReview) {
    // #049: Mentor review click — close on scrim click, select on choice hit
    var mrX = 60, mrY = 80, mrW = CANVAS_W - 120, mrH = CANVAS_H - 160;
    if (mx < mrX || mx > mrX + mrW || my < mrY || my > mrY + mrH ||
        (mx >= mrX + mrW - 92 && mx <= mrX + mrW - 20 && my >= mrY + 10 && my <= mrY + 36)) {
      closeMentorReview();
    } else if (mentorReview.phase === "question") {
      // Calculate which choice was clicked based on question rendering position
      var qy = mrY + 72;
      ctx.font = "13px monospace";
      var qLines = wrapText(mentorReview.question.q, mrW - 40);
      qy += qLines.length * 18 + 12;
      var choiceRowH = 36;
      var clickedChoice = Math.floor((my - qy) / choiceRowH);
      if (mx >= mrX + 16 && mx <= mrX + mrW - 16 &&
          clickedChoice >= 0 && clickedChoice < (mentorReview.question.c || []).length) {
        submitMentorAnswer(clickedChoice);
      }
    } else if (mentorReview.phase === "feedback") {
      closeMentorReview();
    }
    return;
  }
  if (certConsoleOpen) {
    var bgX = 40, bgY = 40, bgW = CANVAS_W - 80, bgH = CANVAS_H - 80;
    if (mx < bgX || mx > bgX + bgW || my < bgY || my > bgY + bgH ||
        (mx > bgX + bgW - 120 && my < bgY + 52)) {
      handleCertConsoleKey("Escape");
    } else {
      var firstRowY = bgY + 126, rowH = 40;
      var row = Math.floor((my - firstRowY) / rowH);
      if (row >= 0 && row < 5) {
        certConsoleSel = row;
        _announceConsoleSelection();
        sfx.select();
      } else {
        _announceConsoleDetail();
      }
    }
    return;
  }
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
function walkable(x, y, ignoreSeats) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  if (SOLID.has(map[y][x])) return false;
  if (npcs.some(n => n.x === x && n.y === y)) return false;
  // Office seats block ordinary walking but never leak collision into other maps.
  if (currentMap === "office" && !ignoreSeats && OFFICE_SEATS.has(`${x},${y}`)) {
    // Allow walking INTO an unoccupied seat only via sitAt().
    // Normal pathing treats seats as blocked.
    return false;
  }
  return true;
}

// ---- Sitting asset loading (#047/#048) ----
// Lazy-load the two-frame sitting sprite for a slug. Missing/pending files use the
// compact procedural seated fallback in drawCharacter; standing art is never shown.
// Returns the cache entry synchronously (images may still be loading).
function loadSitAsset(slug) {
  if (!slug || _sittingLoaded.has(slug)) return;
  _sittingLoaded.add(slug);
  var entry = { idle_0: null, idle_1: null, pending: 2 };
  _sittingAssetStore[slug] = entry;
  [0, 1].forEach(function(index) {
    var image = new Image();
    image.onload = function() {
      entry["idle_" + index] = image;
      entry.pending--;
    };
    image.onerror = function() { entry.pending--; };
    image.src = "sprites-sit/" + slug + "/idle_" + index + ".png";
  });
}

// Return the sitting frames for a slug, or null if not yet loaded/missing.
function getSitFrames(slug) {
  var entry = _sittingAssetStore[slug];
  if (!entry) return null;
  return entry;
}
function resetSitAssetCache() {
  _sittingAssetStore = {};
  _sittingLoaded = new Set();
}

// Check whether a tile is an unoccupied player seat.
function isFreePlayerSeat(x, y) {
  if (currentMap !== "office") return false;
  var key = `${x},${y}`;
  if (!PLAYER_SEAT_KEYS.includes(key) || !OFFICE_SEATS.has(key)) return false;
  if (npcs.some(function(n) { return n.x === x && n.y === y; })) return false;
  return true;
}

// Seat the player at a chair tile. Must be called from interaction, not movement.
function sitAt(x, y) {
  if (!isFreePlayerSeat(x, y)) return false;
  var returnX = player.x, returnY = player.y;
  player.moving = false; stepT = 1; bufferedDir = null; turnStartMs = null;
  pointerMoveId = null; pointerMoveDir = null;
  player.x = player.fx = x;
  player.y = player.fy = y;
  player.dir = "up";
  player.seated = { seatX: x, seatY: y, returnX: returnX, returnY: returnY };
  locomotionPhase = 0; locomotionActive = false;
  loadSitAsset(player.slug);
  showToast("Seated at the study desk. Move or interact to stand.");
  return true;
}

// Restore the approach tile so a standing character is never left inside chair art.
function leaveSeat() {
  var seat = player.seated;
  if (!seat) return false;
  player.seated = null;
  var candidates = [[seat.returnX, seat.returnY], [seat.seatX, seat.seatY + 1],
    [seat.seatX - 1, seat.seatY], [seat.seatX + 1, seat.seatY], [seat.seatX, seat.seatY - 1]];
  var destination = candidates.find(function(pos) { return walkable(pos[0], pos[1]); });
  if (!destination) destination = [seat.returnX, seat.returnY];
  player.x = player.fx = destination[0];
  player.y = player.fy = destination[1];
  player.moving = false; stepT = 1; bufferedDir = null; turnStartMs = null;
  pointerMoveId = null; pointerMoveDir = null;
  return true;
}

function facingTile() {
  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[player.dir];
  return [player.x + d[0], player.y + d[1]];
}

// ---------- Portrait dialogue + certification quest (#052) ----------
function certificationQuestRecord() {
  if (!_progression || !_progression.quests) return null;
  return _progression.quests[DatamonState.CERTIFICATION_QUEST_ID] || null;
}

function createFreshCertificationQuest() {
  if (!_progression.quests || typeof _progression.quests !== "object") _progression.quests = {};
  _progression.quests[DatamonState.CERTIFICATION_QUEST_ID] = {
    status: "active",
    objective: DatamonState.CERTIFICATION_FIRST_OBJECTIVE,
    prologueSeen: false,
  };
}

function activateCertificationQuest(replay) {
  if (!_progression.quests || typeof _progression.quests !== "object") _progression.quests = {};
  var existing = certificationQuestRecord();
  if (replay && existing) {
    existing.prologueSeen = true;
  } else {
    _progression.quests[DatamonState.CERTIFICATION_QUEST_ID] = {
      status: "active",
      objective: DatamonState.CERTIFICATION_FIRST_OBJECTIVE,
      prologueSeen: true,
    };
  }
  save();
  showToast(replay ? "Certification briefing replay complete." : "Quest active: report to the Certification Console.", 3400);
}

function openCertificationConsole() {
  certConsoleOpen = true;
  certConsoleSel = 0;
  toast = null;
  sfx.select();
  _dialogueAnnounce("Certification Console opened. Study evidence, not a pass prediction. Use arrow keys to navigate, P to replay the briefing, Escape to close.");
  setTimeout(_announceConsoleSelection, 0);
}

function advanceCertificationQuestAtConsole() {
  var quest = certificationQuestRecord();
  if (!quest || quest.status !== "active" || quest.objective !== DatamonState.CERTIFICATION_FIRST_OBJECTIVE) return false;
  quest.objective = DatamonState.CERTIFICATION_FIELD_OBJECTIVE;
  quest.prologueSeen = true;
  save();
  showToast("Quest updated: challenge colleagues across all five domains.", 3600);
  return true;
}

function completeCertificationQuest() {
  var quest = certificationQuestRecord();
  if (!quest || quest.status === "completed") return false;
  quest.status = "completed";
  quest.objective = "Claude Code certification complete";
  quest.prologueSeen = true;
  save();
  return true;
}

function _dialogueAnnounce(message) {
  if (typeof document === "undefined") return;
  var announcer = document.getElementById("datamon-announcer");
  if (announcer) announcer.textContent = message;
}

function announceDialogueBeat(force, selectionOnly, prefix) {
  if (!dialogueSession || typeof DatamonDialogueRuntime === "undefined") return;
  var beat = DatamonDialogueRuntime.currentBeat(dialogueSession);
  if (!beat) return;
  var key = dialogueSession.script.id + ":" + dialogueSession.beatId + ":" + dialogueSession.choice;
  if (!force && key === dialogueAnnouncedKey) return;
  dialogueAnnouncedKey = key;
  var message;
  if (selectionOnly && beat.choices && beat.choices.length) {
    message = "Choice " + (dialogueSession.choice + 1) + " of " + beat.choices.length + ": " + beat.choices[dialogueSession.choice].label;
  } else {
    message = beat.speaker.name + ", " + (beat.speaker.domain || "mixed") + " channel. " + beat.text;
    if (beat.choices && beat.choices.length) {
      message += " " + beat.choices.map(function(choice, index) { return (index + 1) + ", " + choice.label + "."; }).join(" ");
      message += " Selected: " + beat.choices[dialogueSession.choice].label + ".";
    } else {
      message += " Press Enter to reveal or continue.";
    }
    message += " Escape skips or closes this scene.";
  }
  _dialogueAnnounce((prefix || "") + message);
}

function dialogueEventToken(source) {
  dialogueEventSeq = (dialogueEventSeq + 1) % 1000000000;
  return source + ":" + dialogueEventSeq;
}

function restoreEncounterSeat() {
  var record = encounterSeatRestore;
  encounterSeatRestore = null;
  dialogueStaging = null;
  if (!record || !record.npc) { clearChallengeFacingFrame(); return false; }
  clearChallengeFacingFrame(record.npc.slug);
  record.npc.x = record.x;
  record.npc.y = record.y;
  record.npc._seated = true;
  record.npc.dir = "down";
  loadSitAsset(record.npc.slug);
  return true;
}

function clearDialogueInputLatches() {
  // Preserve the currently-held physical key in `keys` until keyup so a synthetic
  // repeat:false duplicate cannot leak from a terminal dialogue beat into the world.
  agentActivationKeys.clear();
  bufferedDir = null;
  turnStartMs = null;
  pointerMoveId = null;
  pointerMoveDir = null;
}

function closeDialogue(restoreSeat, announcement) {
  dialogueSession = null;
  dialogueContext = null;
  dialogueAnnouncedKey = null;
  dialogueStaging = null;
  wrapCache.clear();
  if (restoreSeat !== false) restoreEncounterSeat();
  clearDialogueInputLatches();
  state = "overworld";
  dialogueAnnouncementHoldUntil = performance.now() + 1000;
  _dialogueAnnounce(announcement || "Dialogue closed. Movement restored.");
}

function resetDialogueLifecycle() {
  dialogueSession = null;
  dialogueContext = null;
  dialogueAnnouncedKey = null;
  restoreEncounterSeat();
  dialogueActivationKeys.clear();
  clearDialogueInputLatches();
}

function _standDestinationValid(x, y, challengedNpc) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  if (!map[y] || SOLID.has(map[y][x])) return false;
  if (currentMap === "office" && OFFICE_SEATS.has(x + "," + y)) return false;
  if (npcs.some(function(npc) { return npc !== challengedNpc && npc.x === x && npc.y === y; })) return false;
  return !(challengedNpc.x === x && challengedNpc.y === y);
}

function prepareSeatedChallenge(npc) {
  dialogueStaging = null;
  if (currentMap !== "office" || !npc || !npc._seated || typeof DatamonDialogueRuntime === "undefined") return;
  encounterSeatRestore = { npc: npc, slug: npc.slug, x: npc.x, y: npc.y };
  npc._seated = false;
  var from = { x: player.fx, y: player.fy };
  var destination = DatamonDialogueRuntime.chooseStandDisplacement(player, npc, function(x, y) {
    return _standDestinationValid(x, y, npc);
  }) || { x: player.x, y: player.y, moved: false };
  player.x = destination.x; player.y = destination.y;
  player.moving = false; stepT = 1;
  var vx = destination.x - npc.x, vy = destination.y - npc.y;
  npc.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? "left" : "right") : (vy < 0 ? "up" : "down");
  loadChallengeFacingFrame(npc.slug, npc.dir);
  var reduced = typeof AgentArena !== "undefined" && AgentArena.prefersReducedMotion();
  if (!destination.moved || reduced) {
    player.fx = destination.x; player.fy = destination.y;
  } else {
    player.fx = from.x; player.fy = from.y;
    dialogueStaging = {
      fromX: from.x, fromY: from.y, toX: destination.x, toY: destination.y,
      t: 0, duration: DIALOGUE_STAGING_FRAMES,
    };
  }
}

function _openDialogueFallback(context) {
  if (context.kind === "prologue") {
    activateCertificationQuest(context.replay);
    state = "overworld";
  } else if (context.kind === "console-arrival") {
    state = "overworld";
    openCertificationConsole();
  } else if (context.kind === "outcome") {
    state = context.afterState === "victory" ? "victory" : "overworld";
    if (context.toastMessage) showToast(context.toastMessage);
  } else if (context.kind === "mentor") {
    restoreEncounterSeat();
    state = "overworld";
    openMentorReview(context.npc);
  } else if (context.npc) {
    restoreEncounterSeat();
    if (context.npc.type === "AGENT" && typeof AgentArena !== "undefined" && AgentArena.prefersReducedMotion()) {
      startBattle(context.npc);
    } else {
      battleTransition = { npc: context.npc, t: 0 }; state = "transition";
    }
  }
}

function openDialogueScene(script, context) {
  if (typeof DatamonDialogueRuntime === "undefined" || !script) {
    _openDialogueFallback(context);
    return false;
  }
  var session = DatamonDialogueRuntime.createSession(script);
  if (!session) {
    restoreEncounterSeat();
    state = "overworld";
    if (context.kind === "prologue") activateCertificationQuest(context.replay);
    else if (context.kind === "console-arrival") { openCertificationConsole(); return false; }
    else if (context.kind === "outcome") {
      state = context.afterState === "victory" ? "victory" : "overworld";
      if (context.toastMessage) showToast(context.toastMessage);
      return false;
    } else showToast("Comms script rejected. No encounter started.");
    _dialogueAnnounce("Dialogue unavailable. No encounter or review was started.");
    return false;
  }
  dialogueSession = session;
  dialogueContext = context;
  ["Enter", " ", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "1", "2", "3", "4", "5", "6"].forEach(function(key) {
    if (keys[key]) dialogueActivationKeys.add(key);
  });
  dialogueAnnouncedKey = null;
  toast = null;
  certConsoleOpen = false;
  clearMentorReview();
  clearDialogueInputLatches();
  state = "dialogue";
  if (dialogueStaging) {
    _dialogueAnnounce("Seated challenge handoff. Colleague standing and moving the candidate to a safe tile.");
  } else {
    announceDialogueBeat(true, false);
  }
  return true;
}

function openPrologue(replay) {
  var script = typeof DatamonDialogue !== "undefined" && DatamonDialogue.prologueScript
    ? DatamonDialogue.prologueScript(player.slug, displayName) : null;
  return openDialogueScene(script, { kind: "prologue", npc: null, training: false, replay: !!replay });
}

function openConsoleArrivalDialogue() {
  var script = typeof DatamonDialogue !== "undefined" && DatamonDialogue.consoleArrivalScript
    ? DatamonDialogue.consoleArrivalScript(player.slug, displayName) : null;
  return openDialogueScene(script, { kind: "console-arrival", npc: null, training: false, replay: false });
}

function openPostBattleDialogue(b, playerWon, afterState, toastMessage) {
  if (!b || !b.portraitLed) {
    state = afterState === "victory" ? "victory" : "overworld";
    if (toastMessage) showToast(toastMessage);
    return false;
  }
  var script = typeof DatamonDialogue !== "undefined" && DatamonDialogue.outcomeScript
    ? DatamonDialogue.outcomeScript(b.npc.slug, b.npc.type, displayName, !!playerWon, !!b.training) : null;
  return openDialogueScene(script, {
    kind: "outcome", npc: b.npc, training: !!b.training, replay: false,
    playerWon: !!playerWon, afterState: afterState || "overworld", toastMessage: toastMessage || null,
  });
}

function beginNpcDialogue(npc) {
  if (!npc) return;
  var training = currentMap === "battleRoom";
  if (npc.defeated && !training) {
    var campaignNpcs = currentMap === "office" ? npcs : officeNpcs;
    var domainTotal = campaignNpcs.filter(function(rival) { return rival.type === npc.type; }).length;
    var domainDefeated = campaignNpcs.filter(function(rival) { return rival.type === npc.type && rival.defeated; }).length;
    var mentorScript = typeof DatamonDialogue !== "undefined" && DatamonDialogue.mentorScript
      ? DatamonDialogue.mentorScript(npc.slug, npc.type, player.slug, {
          total: rivalTotal, defeated: defeated.size, domainTotal: domainTotal, domainDefeated: domainDefeated,
        }, displayName) : null;
    openDialogueScene(mentorScript, { kind: "mentor", npc: npc, training: false, replay: false });
    return;
  }
  prepareSeatedChallenge(npc);
  var script = typeof DatamonDialogue !== "undefined" && DatamonDialogue.challengeScript
    ? DatamonDialogue.challengeScript(npc.slug, npc.type, player.slug, displayName, training) : null;
  openDialogueScene(script, { kind: "challenge", npc: npc, training: training, replay: false });
}

function applyDialogueEffects(effects, selectionLabel, eventType) {
  if (!Array.isArray(effects) || !effects.length) return;
  var selectedPrefix = selectionLabel ? "Selected choice: " + selectionLabel + ". " : "";
  var skippedPrefix = eventType === "SKIP" ? "Scene skipped. " : "";
  for (var i = 0; i < effects.length; i++) {
    var effect = effects[i];
    var context = dialogueContext;
    if (!effect || !context) return;
    if (effect.type === "ACTIVATE_QUEST") {
      activateCertificationQuest(context.replay);
      closeDialogue(true, skippedPrefix + (context.replay
        ? "Certification briefing replay complete. Previous quest objective preserved."
        : "Certification quest active. Objective: report to the Certification Console."));
      return;
    }
    if (effect.type === "CLOSE_DIALOGUE") {
      if (context.kind === "outcome") {
        var afterState = context.afterState;
        var outcomeToast = context.toastMessage;
        closeDialogue(true, skippedPrefix + "Encounter debrief complete.");
        state = afterState === "victory" ? "victory" : "overworld";
        if (outcomeToast) showToast(outcomeToast);
      } else {
        closeDialogue(true, selectedPrefix + skippedPrefix + "Conversation closed. Movement restored.");
        showToast("Conversation closed.");
      }
      return;
    }
    if (effect.type === "OPEN_MENTOR_REVIEW") {
      var mentorNpc = context.npc;
      closeDialogue(true);
      openMentorReview(mentorNpc);
      return;
    }
    if (effect.type === "OPEN_CERT_CONSOLE") {
      closeDialogue(true, skippedPrefix + "Certification objective acknowledged. Opening evidence Console.");
      openCertificationConsole();
      return;
    }
    if (effect.type === "START_BATTLE") {
      var npc = context.npc;
      closeDialogue(false, selectedPrefix + "Challenge accepted. Battle transition starting."); // keep the captured seat contract until encounter exit
      sfx.battle();
      if (npc.type === "AGENT" && typeof AgentArena !== "undefined" && AgentArena.prefersReducedMotion()) {
        startBattle(npc, true);
      } else {
        battleTransition = { npc: npc, t: 0, portraitLed: true };
        state = "transition";
      }
      return;
    }
  }
}

function dispatchDialogue(event) {
  if (!dialogueSession || typeof DatamonDialogueRuntime === "undefined") return false;
  var previousBeat = dialogueSession.beatId;
  var previousChoice = dialogueSession.choice;
  var previousBeatData = DatamonDialogueRuntime.currentBeat(dialogueSession);
  var selectionLabel = null;
  if (dialogueSession.phase === "choice" && previousBeatData && previousBeatData.choices) {
    var selectedIndex = event.type === "CHOOSE" ? event.index
      : (event.type === "ACTIVATE" ? dialogueSession.choice : -1);
    if (Number.isInteger(selectedIndex) && previousBeatData.choices[selectedIndex]) {
      selectionLabel = previousBeatData.choices[selectedIndex].label;
    }
  }
  var result = DatamonDialogueRuntime.reduce(dialogueSession, event);
  if (!result.consumed && result.state === dialogueSession) return false;
  dialogueSession = result.state;
  if (event.type !== "TICK") sfx.select();
  if (dialogueSession && (dialogueSession.beatId !== previousBeat || dialogueSession.choice !== previousChoice)) {
    var changedBeat = dialogueSession.beatId !== previousBeat;
    announceDialogueBeat(true, !changedBeat, changedBeat && selectionLabel
      ? "Selected choice: " + selectionLabel + ". " : "");
  }
  applyDialogueEffects(result.effects, selectionLabel, event.type);
  if (dialogueSession && dialogueSession.completed) {
    closeDialogue(true, "Dialogue complete. Movement restored.");
  }
  return !!result.consumed;
}

function handleDialoguePointer(mx, my, source) {
  if (!dialogueSession) return false;
  var geometry = dialogueHitGeometry();
  if (!geometry) return false;
  var token = dialogueEventToken(source || "pointer");
  if (mx >= geometry.skip.x && mx <= geometry.skip.x + geometry.skip.w &&
      my >= geometry.skip.y && my <= geometry.skip.y + geometry.skip.h) {
    return dispatchDialogue({ type: "SKIP", token: token });
  }
  if (dialogueStaging) return false;
  var choice = geometry.choices.find(function(rect) {
    return mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h;
  });
  if (choice) return dispatchDialogue({ type: "CHOOSE", index: choice.index, token: token });
  if (mx >= 12 && mx <= CANVAS_W - 12 && my >= DIALOGUE_PANEL.y && my <= DIALOGUE_PANEL.y + DIALOGUE_PANEL.h) {
    return dispatchDialogue({ type: "ACTIVATE", token: token });
  }
  return false;
}

function handleDialogueKey(k) {
  if (!dialogueSession) return false;
  var token = dialogueEventToken("key");
  if (k === "Escape") return dispatchDialogue({ type: "SKIP", token: token });
  if (dialogueStaging) return true; // stand/displacement must converge before any spoken beat advances
  if (k === "ArrowUp" || k === "ArrowLeft") return dispatchDialogue({ type: "MOVE_CHOICE", direction: -1, token: token });
  if (k === "ArrowDown" || k === "ArrowRight") return dispatchDialogue({ type: "MOVE_CHOICE", direction: 1, token: token });
  if (/^[1-6]$/.test(k)) return dispatchDialogue({ type: "CHOOSE", index: Number(k) - 1, token: token });
  if (k === "Enter" || k === " " || k === "Space") return dispatchDialogue({ type: "ACTIVATE", token: token });
  return false;
}

function updateDialogue() {
  if (!dialogueSession || typeof DatamonDialogueRuntime === "undefined") return;
  if (dialogueStaging) {
    dialogueStaging.t = Math.min(1, dialogueStaging.t + dtF / dialogueStaging.duration);
    var eased = dialogueStaging.t * dialogueStaging.t * (3 - 2 * dialogueStaging.t);
    player.fx = dialogueStaging.fromX + (dialogueStaging.toX - dialogueStaging.fromX) * eased;
    player.fy = dialogueStaging.fromY + (dialogueStaging.toY - dialogueStaging.fromY) * eased;
    if (dialogueStaging.t >= 1) {
      player.fx = dialogueStaging.toX; player.fy = dialogueStaging.toY;
      dialogueStaging = null;
      announceDialogueBeat(true, false);
    }
    return;
  }
  var reduced = typeof AgentArena !== "undefined" && AgentArena.prefersReducedMotion();
  var tick = DatamonDialogueRuntime.reduce(dialogueSession, {
    type: "TICK", amount: Math.max(1, TEXT_SPEED() * dtF), reducedMotion: reduced,
  });
  dialogueSession = tick.state;
}

function interact() {
  const [tx, ty] = facingTile();

  // Standing up from a chair: interacting while seated stands you up.
  if (player.seated) {
    leaveSeat();
    sfx.select();
    return;
  }

  // Sitting in a chair: facing an unoccupied player seat → sit
  if (isFreePlayerSeat(tx, ty)) {
    if (sitAt(tx, ty)) { sfx.confirm(); return; }
  }

  // Certification Console interaction. The first quest arrival gets one portrait-led
  // command beat; interrupted/reloaded arrivals are already advanced and open directly.
  if (map[ty] && map[ty][tx] === "X" && currentMap === "office") {
    var arrivingQuest = certificationQuestRecord();
    if (arrivingQuest && arrivingQuest.status === "active" &&
        arrivingQuest.objective === DatamonState.CERTIFICATION_FIRST_OBJECTIVE) {
      advanceCertificationQuestAtConsole();
      openConsoleArrivalDialogue();
    } else {
      openCertificationConsole();
    }
    return;
  }

  const npc = npcs.find(n => n.x === tx && n.y === ty);
  if (npc) {
    beginNpcDialogue(npc);
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
  if (map[ty] && map[ty][tx] === "L") {
    if (currentMap === "office") { leaveSeat(); enterLibrary(); return; }
    if (currentMap === "library") { returnToOffice(); return; }
  }
  if (map[ty] && map[ty][tx] === "A") {
    if (currentMap === "office") { leaveSeat(); enterBattleRoom(); return; }
    // Library door is "L", Battle Room and return doors are "A"
    if (currentMap === "battleRoom") { returnToOffice(OFFICE_BATTLE_ENTRY[0], OFFICE_BATTLE_ENTRY[1]); return; }
  }
  if (map[ty] && map[ty][tx] === "B") { openBookPicker(); return; }                          // book reader — ticket #027
  if (map[ty] && map[ty][tx] === "S") {                                                       // study station → minigame (#028)
    const st = STUDY_STATIONS[`${tx},${ty}`];
    if (st) launchMinigame(st.type, st.id, st.label);
    else showToast("Study station: coming soon.");
    return;
  }
}

// ---------- Warp routing (#026/#044/#046) ----------
// Boot keeps only the manifest + shared door resident. The first interaction starts one
// deduplicated load/build Promise and that same interaction commits exactly one warp.
var libraryLoadPromise = null;
var libraryWarpRequested = false;
var libraryLoadGeneration = 0;
var battleRoomLoadPromise = null;
var battleRoomWarpRequested = false;
var battleRoomLoadGeneration = 0;

function ensureLibraryLoaded() {
  if (libraryMapCv) return Promise.resolve(libraryMapCv);
  if (libraryLoadPromise) return libraryLoadPromise;
  var generation = libraryLoadGeneration;
  libraryLoadPromise = Promise.all([
    Promise.all(libManifest.filter(function(m) { return m.slug !== "lib-door"; }).map(function(m) {
      return loadOne("library/assets/" + m.file, libStore, m.slug);
    })),
    loadBooks(), loadPairs(), loadCloze(), loadDiagrams(),
    (typeof DatamonWorldArt !== "undefined") ? DatamonWorldArt.loadScene("library") : Promise.resolve([]),
  ]).catch(function() {
    return [];
  }).then(function() {
    if (generation !== libraryLoadGeneration) {
      if (typeof DatamonWorldArt !== "undefined") DatamonWorldArt.activateScene(currentMap);
      return null;
    }
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
  announceLocation("The Library", "Learn unseen material and rehearse");
  showToast("Entered the Library.");
  camFx = camFy = null; bufferedDir = null; turnStartMs = null;
}

function enterLibrary() {
  clearMentorReview(); // #049
  leaveSeat();
  certConsoleOpen = false;
  player.moving = false; stepT = 1;
  coffeePrompt = null; scout = null;
  bookPrompt = null; readerState = null;
  battleRoomWarpRequested = false;
  if (currentMap === "office") {
    // Keep at most two DPR-aware world caches resident (office + active destination).
    battleRoomLoadGeneration++;
    battleRoomMapCv = null; battleRoomLoadPromise = null;
    if (libraryMapCv) { commitLibraryWarp(); return; }
    libraryWarpRequested = true;
    showToast(libraryLoadPromise ? "Library loading..." : "Opening library...");
    ensureLibraryLoaded().then(function() {
      if (libraryWarpRequested && currentMap === "office") commitLibraryWarp();
    });
    return;
  }
}

function ensureBattleRoomLoaded() {
  if (battleRoomMapCv) return Promise.resolve(battleRoomMapCv);
  if (battleRoomLoadPromise) return battleRoomLoadPromise;
  var generation = battleRoomLoadGeneration;
  battleRoomLoadPromise = ((typeof DatamonWorldArt !== "undefined")
    ? DatamonWorldArt.loadScene("battleRoom") : Promise.resolve([]))
    .catch(function() { return []; })
    .then(function() {
      if (generation !== battleRoomLoadGeneration) {
        if (typeof DatamonWorldArt !== "undefined") DatamonWorldArt.activateScene(currentMap);
        return null;
      }
      if (!battleRoomMapCv) battleRoomMapCv = buildBattleRoomMapCanvas();
      return battleRoomMapCv;
    });
  return battleRoomLoadPromise;
}

function commitBattleRoomWarp() {
  if (currentMap !== "office" || !battleRoomMapCv) return;
  currentMap = "battleRoom"; map = BATTLE_ROOM_MAP; mapCv = battleRoomMapCv;
  officeNpcs = npcs;
  battleRoomNpcs = buildBattleRoomNPCs(player.slug);
  npcs = battleRoomNpcs;
  player.x = player.fx = BATTLE_ROOM_ENTRY[0]; player.y = player.fy = BATTLE_ROOM_ENTRY[1];
  player.dir = "up";
  battleRoomWarpRequested = false;
  if (typeof DatamonWorldArt !== "undefined") DatamonWorldArt.activateScene("battleRoom");
  announceLocation("Battle Room", "Test due concepts in safe rematches");
  showToast("Entered the Battle Room.");
  camFx = camFy = null; bufferedDir = null; turnStartMs = null;
}

function enterBattleRoom() {
  clearMentorReview(); // #049
  leaveSeat();
  certConsoleOpen = false;
  player.moving = false; stepT = 1;
  coffeePrompt = null; scout = null;
  bookPrompt = null; readerState = null;
  libraryWarpRequested = false;
  if (currentMap !== "office") return;
  // Releasing an inactive Library cache caps DPR2 map memory at two resident scenes.
  libraryLoadGeneration++;
  libraryMapCv = null; libraryLoadPromise = null;
  battleRoomWarpRequested = true;
  showToast(battleRoomLoadPromise ? "Battle Room loading..." : "Opening Battle Room...");
  ensureBattleRoomLoaded().then(function() {
    if (battleRoomWarpRequested && currentMap === "office") commitBattleRoomWarp();
  });
}

function returnToOffice(entryX, entryY, toastMsg) {
  leaveSeat();
  certConsoleOpen = false;
  clearMentorReview();
  libraryWarpRequested = false;
  battleRoomWarpRequested = false;
  currentMap = "office"; map = OFFICE_MAP; mapCv = officeMapCv;
  npcs = officeNpcs;
  battleRoomNpcs = [];
  var ex = typeof entryX === "number" ? entryX : OFFICE_ENTRY[0];
  var ey = typeof entryY === "number" ? entryY : OFFICE_ENTRY[1];
  player.x = player.fx = ex; player.y = player.fy = ey;
  player.dir = "up";
  if (typeof DatamonWorldArt !== "undefined") DatamonWorldArt.activateScene("office");
  var msg = typeof toastMsg === "string" ? toastMsg : "Back to the office.";
  announceLocation(locationHudLabel(), locationHudPurpose());
  showToast(msg);
  camFx = camFy = null; bufferedDir = null; turnStartMs = null;
}

function drinkCoffee() {
  if (coffeeUses <= 0) return;
  coffeeUses--;
  restorePlayerHp(true);
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
function locomotionReducedMotion() {
  if (typeof DatamonWorldArt !== "undefined" && DatamonWorldArt.isReducedMotion) {
    return DatamonWorldArt.isReducedMotion();
  }
  return !!(typeof AgentArena !== "undefined" && AgentArena.prefersReducedMotion && AgentArena.prefersReducedMotion());
}

function heldMovementDirection() {
  if (dirHeld("up")) return "up";
  if (dirHeld("down")) return "down";
  if (dirHeld("left")) return "left";
  if (dirHeld("right")) return "right";
  return pointerMoveDir || null;
}

function emitFootfallContact(foot) {
  locomotionContactCount = Math.min(1000000, locomotionContactCount + 1);
  if (state === "overworld") sfx.move();
  if (locomotionReducedMotion()) return;
  const count = player.running ? 3 : 1;
  const side = foot === "right" ? 1 : -1;
  for (let i = 0; i < count; i++) {
    dustParticles.push({
      x: player.fx + side * 0.045 + (Math.random() - 0.5) * 0.12,
      y: player.fy + 0.5, // character footY resolves to tile bottom (center + TILE/2)
      dx: (Math.random() - 0.5) * 0.012,
      dy: -0.018 - Math.random() * 0.008,
      life: 10 + Math.floor(Math.random() * 3),
      maxLife: 12,
    });
  }
}

function applyLocomotionResult(result) {
  if (!result) return;
  locomotionPhase = result.phase;
  for (const contact of result.contacts) emitFootfallContact(contact.foot);
}

function continueHeldMovement() {
  if (bufferedDir) {
    consumeBuffered(true);
    return player.moving;
  }
  const dir = heldMovementDirection();
  if (!dir) return false;
  player.dir = dir;
  tryStep(dir, true);
  return player.moving;
}

function updateOverworld(dt) {
  // Secondary puffs use logical 60Hz ticks but are integrated from elapsed time, so their
  // lifetime/drift is equivalent on 30/60/120Hz displays.
  const particleTicks = Math.max(0, dt * 60);
  for (const d of dustParticles) {
    d.x += d.dx * particleTicks;
    d.y += d.dy * particleTicks;
    d.life -= particleTicks;
  }
  if (dustParticles.length) dustParticles = dustParticles.filter(d => d.life > 0);

  if (coffeePrompt) return;
  if (bookPrompt) return;
  if (readerState) return;
  if (mentorReview) return;
  if (scout) return;
  if (certConsoleOpen) return;
  if (player.seated) return;

  const moveMultiplier = currentMovementMultiplier();
  player.running = !!(keys["r"] || keys["R"] || keys["KeyR"] ||
    keys["Shift"] || keys["ShiftLeft"] || keys["ShiftRight"]);
  const baseSpeed = player.running ? locomotionProfile.runTilesPerSecond : locomotionProfile.walkTilesPerSecond;
  const speed = Math.max(0.1, baseSpeed * moveMultiplier);

  if (player.moving) {
    // Consume the complete distance budget. Carrying fractional overflow into a buffered next
    // tile removes the old one-frame deceleration/acceleration pulse at every grid boundary.
    let budget = Math.max(0, speed * dt);
    let guard = 0;
    while (player.moving && budget > 1e-9 && guard++ < 4) {
      const cycleTiles = player.running ? locomotionProfile.runCycleTiles : locomotionProfile.walkCycleTiles;
      const activeFrames = locomotionPilot[player.slug] ? 8 : 4;
      const result = DatamonLocomotion.advanceTile({
        startX: stepStartFx, startY: stepStartFy, targetX: player.x, targetY: player.y,
        stepT: stepT, phase: locomotionPhase,
      }, budget, cycleTiles, activeFrames);
      stepT = result.stepT;
      player.fx = result.x;
      player.fy = result.y;
      budget = result.remainingBudget;
      applyLocomotionResult(result);

      if (result.complete) {
        player.fx = player.x;
        player.fy = player.y;
        player.moving = false;
        stepT = 1;
        if (!continueHeldMovement()) locomotionActive = false;
      }
    }
    return;
  }

  locomotionActive = false;
  const dir = heldMovementDirection();
  if (!dir) { turnStartMs = null; return; }
  if (dir !== player.dir) { player.dir = dir; turnStartMs = performance.now(); return; }
  // tap window open: released before TAP_TURN_MS means turn-only
  if (turnStartMs !== null && performance.now() - turnStartMs < TAP_TURN_MS) return;
  turnStartMs = null;
  tryStep(dir, false);
}
function dirHeld(dir) {
  for (const k in KEY_DIR) if (KEY_DIR[k] === dir && keys[k]) return true;
  return false;
}
function tryStep(dir, continuing) {
  // Seated: the first movement press stands you up instead of walking. Clear that
  // direction's held-key state so a render tick between keydown and keyup cannot also
  // advance one tile; a later repeat/new press may move normally.
  if (player.seated) {
    leaveSeat();
    for (const key in keys) if (KEY_DIR[key] === dir) keys[key] = false;
    sfx.select();
    return;
  }
  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  const nx = player.x + d[0], ny = player.y + d[1];
  if (walkable(nx, ny)) {
    stepStartFx = player.fx;
    stepStartFy = player.fy;
    stepT = 0;
    player.x = nx;
    player.y = ny;
    player.moving = true;
    locomotionActive = true;
  } else if (continuing) {
    locomotionActive = false;
  }
}
function consumeBuffered(continuing) {
  const dir = bufferedDir, wasFacing = player.dir;
  bufferedDir = null;
  turnStartMs = null;
  player.dir = dir;
  if (dir !== wasFacing && !dirHeld(dir)) return; // tap during slide → turn-only at stop
  tryStep(dir, !!continuing);
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

function seatedFrameIndex(phase, reducedMotion) {
  if (reducedMotion) return 0;
  var period = SEATED_DRAW_GEOMETRY.phasePeriodTicks;
  var bounded = ((phase % period) + period) % period;
  return Math.floor(bounded / SEATED_DRAW_GEOMETRY.frameHoldTicks);
}

function seatedFallbackPaletteIndex(slug, salt, length) {
  var hash = salt | 0;
  var source = String(slug || "datamon");
  for (var i = 0; i < source.length; i++) hash = ((hash * 33) ^ source.charCodeAt(i)) | 0;
  return (hash >>> 0) % length;
}

function drawCompactSeatedFallback(cx, cy, slug) {
  var geometry = SEATED_DRAW_GEOMETRY;
  var shirt = SEATED_FALLBACK_SHIRTS[seatedFallbackPaletteIndex(slug, 17, SEATED_FALLBACK_SHIRTS.length)];
  var hair = SEATED_FALLBACK_HAIR[seatedFallbackPaletteIndex(slug, 53, SEATED_FALLBACK_HAIR.length)];
  // Opaque, rear-facing, legless shoulder/back silhouette. It performs no image or
  // portrait request, so pending and failed sitting art cannot flash a standing body
  // or a front-facing face while the character is looking toward the desk.
  ctx.fillStyle = shirt;
  ctx.fillRect(px(cx - geometry.fallbackTorsoWidth / 2),
    px(cy + geometry.fallbackTorsoTopOffsetY),
    geometry.fallbackTorsoWidth, geometry.fallbackTorsoHeight);
  ctx.fillStyle = "rgba(15,23,42,0.32)";
  ctx.fillRect(px(cx - geometry.fallbackTorsoWidth / 2 + 3),
    px(cy + geometry.fallbackTorsoTopOffsetY + 8),
    geometry.fallbackTorsoWidth - 6, geometry.fallbackTorsoHeight - 8);
  ctx.fillStyle = "#b98263"; // nape only; no face is visible from this rear pose
  ctx.fillRect(px(cx - 4), px(cy - 20), 8, 5);
  ctx.fillStyle = hair;
  var headX = cx - geometry.fallbackHeadWidth / 2;
  var headY = cy + geometry.fallbackHeadTopOffsetY;
  ctx.fillRect(px(headX + 2), px(headY), geometry.fallbackHeadWidth - 4, 2);
  ctx.fillRect(px(headX), px(headY + 2), geometry.fallbackHeadWidth, geometry.fallbackHeadHeight - 4);
  ctx.fillRect(px(headX + 2), px(headY + geometry.fallbackHeadHeight - 2), geometry.fallbackHeadWidth - 4, 2);
}

function drawSeatedChairForeground(cx, cy) {
  var geometry = SEATED_DRAW_GEOMETRY;
  var chair = propStore["office-chair"];
  if (!chair || chair.naturalWidth < geometry.chairSize || chair.naturalHeight < geometry.chairSize) return;
  // The chair was cache-baked behind the person. Repaint its explicit upper-back-through-
  // base region in front, covering the lower torso/pelvis while retaining the outer shell.
  ctx.drawImage(chair,
    0, geometry.chairForegroundSourceY,
    geometry.chairSize, geometry.chairForegroundHeight,
    px(cx - geometry.chairSize / 2),
    px(cy + geometry.chairTopOffsetY + geometry.chairForegroundSourceY),
    geometry.chairSize, geometry.chairForegroundHeight);
}

function drawCharacter(cx, cy, slug, dir, isPlayer, bob, wallAbove, seated) {
  // ---- Compact seated pose (#047/#048): fixed tile anchor, visual-only lowering ----
  if (seated) {
    var sitFrames = getSitFrames(slug);
    var reducedMotion = (typeof AgentArena !== "undefined" && AgentArena.prefersReducedMotion && AgentArena.prefersReducedMotion());
    var sitFrameIdx = seatedFrameIndex(_sitAnimPhase, reducedMotion);
    var sitImg = null;
    if (sitFrames) {
      sitImg = (sitFrameIdx === 0 ? sitFrames.idle_0 : sitFrames.idle_1)
        || sitFrames.idle_0 || sitFrames.idle_1; // coherent partial-load fallback
    }
    if (sitImg && sitImg.complete && sitImg.naturalWidth > 0) {
      var poseSize = SEATED_DRAW_GEOMETRY.poseSize;
      ctx.drawImage(sitImg, px(cx - poseSize / 2),
        px(cy + SEATED_DRAW_GEOMETRY.feetOffsetY - poseSize), poseSize, poseSize);
    } else {
      drawCompactSeatedFallback(cx, cy, slug);
    }
    drawSeatedChairForeground(cx, cy);
    return;
  }

  // Every standing consultant uses one visual-height contract. Progress remains visible in
  // evidence/campaign instruments rather than making the player physically dwarf colleagues.
  const baseSize = STANDING_CHARACTER_HEIGHT;
  const sizeScale = baseSize / 34;            // proportional factor vs. the old 34px base
  const footY = cy + 16;                      // tile bottom (cy + TILE/2) — feet anchored here

  // Procedural deformation remains only as a missing-walk-art fallback. Its phase now comes
  // from the same traveled-distance clock as authored frames and footfall effects. Reduced
  // motion removes this optional deformation while preserving essential player translation.
  let bobOff = 0, sway = 0, scaleX = 1, scaleY = 1;
  const reducedLocomotion = locomotionReducedMotion();
  if (isPlayer && player.moving && !reducedLocomotion) {
    const p = locomotionPhase * Math.PI * 2;
    const A = 1.2;
    const sq = player.running ? 0.08 : 0.02;
    const stride = player.running ? 0.08 : 0.045, K = 26;
    bobOff = A * (Math.sin(p) - 0.2 * Math.sin(2 * p));
    scaleY = 1 + Math.sin(2 * p) * sq;
    scaleX = 1 / scaleY;
    sway = K * stride * Math.sin(p);
  }

  // The grounding shadow shares authored left/right contact markers. It remains as a static,
  // low-contrast grounding cue under reduced motion; only the optional pulse is removed.
  if (isPlayer && player.moving) {
    const contact = reducedLocomotion || typeof DatamonLocomotion === "undefined"
      ? 0 : DatamonLocomotion.contactWeight(locomotionPhase);
    const shadowW = (baseSize * 0.46) * (1 + contact * 0.18);
    const shadowAlpha = Math.max(0.08, 0.16 + contact * 0.06);
    ctx.save();
    ctx.globalAlpha = shadowAlpha;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(px(cx), px(footY + 1), shadowW / 2, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // A tall sprite grows upward past its own 32px tile — that's CORRECT
  // top-down layering: the character stands in front of the wall/desk to its north and
  // draws over it (depth-sort orders characters against each other; the static map is
  // always behind them). The opaque HUD is drawn AFTER all characters, so it naturally
  // covers anything behind it — no clip needed. (The previous clip-to-tile truncated
  // 44–58px sprites to 32px whenever a wall sat above, decapitating them — the
  // "headless legs near walls" bug. Removed.)
  // Movement keeps its existing locomotion contracts; standing now prefers the reviewed
  // directional idle package and falls back safely to the front-facing trainer miniature.
  const pilot = isPlayer ? locomotionPilot[slug] : null;
  const motionName = player.running ? "run" : "walk";
  const anim = pilot ? pilot.motions[motionName] : (isPlayer ? walkAnim[slug] : null);
  const frameCount = pilot ? pilot.manifest.frameCount : 4;
  const animMeta = pilot ? pilot.manifest.motions[motionName] : walkAnimMeta[slug];
  if (anim && player.moving) {
    const frameDir = (anim[dir] && anim[dir].length === frameCount) ? dir : "down";
    const frames = anim[frameDir];
    if (frames && frames.length) {
      const requestedFrame = typeof DatamonLocomotion !== "undefined"
        ? DatamonLocomotion.frameIndex(locomotionPhase, frameCount) : 0;
      const actualFrame = frames[requestedFrame] ? requestedFrame : 0;
      const fimg = frames[actualFrame];
      if (fimg) {
        // The generated frame includes transparent composition margins. Scale its canonical
        // visible 224/240 span to the same 56px standing model instead of shrinking the whole
        // source canvas into 56px; crouch/flight height changes remain authored motion.
        const frameScale = typeof DatamonLocomotion !== "undefined"
          ? DatamonLocomotion.authoredFrameScale(fimg.height, baseSize)
          : baseSize / fimg.height;
        const H = fimg.height * frameScale;
        const W = fimg.width * frameScale;
        const m = walkMini(fimg, `${slug}:${motionName}:${frameDir}:${actualFrame}`, W, H);
        const anchor = typeof DatamonLocomotion !== "undefined"
          ? DatamonLocomotion.resolveFrameAnchor(animMeta, frameDir, actualFrame, fimg.width, fimg.height)
          : { bodyX: fimg.width / 2, footY: fimg.height };
        let frameY = footY - anchor.footY * frameScale;
        if (pilot && motionName === "run") {
          const authoredGround = animMeta.groundY[frameDir];
          if (Number.isFinite(authoredGround)) frameY = footY - authoredGround * frameScale;
        }
        ctx.drawImage(m, px(cx - anchor.bodyX * frameScale), px(frameY), W, H);
        return;
      }
    }
  }

  // A seated challenger gets one ephemeral directional idle frame during the handoff/battle
  // lead-in, making the recorded face-player direction visible without retaining rival sheets.
  if (!isPlayer && challengeFacingFrame && challengeFacingFrame.slug === slug && challengeFacingFrame.image) {
    var facingImage = challengeFacingFrame.image;
    var facingScale = typeof DatamonLocomotion !== "undefined"
      ? DatamonLocomotion.authoredFrameScale(facingImage.height, baseSize)
      : baseSize / facingImage.height;
    var facingH = facingImage.height * facingScale;
    var facingW = facingImage.width * facingScale;
    var facingMini = walkMini(facingImage, "challenge:" + slug + ":" + challengeFacingFrame.dir, facingW, facingH);
    var facingFootY = facingImage.height * 0.95; // authored 228/240 visible-foot baseline
    ctx.drawImage(facingMini, px(cx - facingW / 2), px(footY - facingFootY * facingScale), facingW, facingH);
    return;
  }

  if (!isPlayer || !player.moving) {
    var idleDir = idleDirection(dir);
    var idleImage = getLoadedIdleDirection(slug, idleDir, isPlayer);
    if (!idleImage) loadIdleDirection(slug, idleDir, isPlayer);
    if (idleImage) {
      var idleScale = typeof DatamonLocomotion !== "undefined"
        ? DatamonLocomotion.authoredFrameScale(idleImage.height, baseSize)
        : baseSize / idleImage.height;
      var idleH = idleImage.height * idleScale;
      var idleW = idleImage.width * idleScale;
      var idleMiniature = walkMini(idleImage, `${slug}:idle:${idleDir}:manifest`, idleW, idleH);
      var idleAnchor = typeof DatamonLocomotion !== "undefined"
        ? DatamonLocomotion.resolveIdleFrame(idleManifestState.manifest, slug, idleDir, idleImage.width, idleImage.height)
        : { bodyX: idleImage.width / 2, footY: idleImage.height, metadata: true };
      if (idleAnchor && idleAnchor.metadata) {
        ctx.drawImage(idleMiniature, px(cx - idleAnchor.bodyX * idleScale), px(footY - idleAnchor.footY * idleScale), idleW, idleH);
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

// Draw a trainer bottom-anchored at (cx, baseY). Existing callers omit poseParams;
// classic battles provide one frozen semantic pose. Decoded alpha bounds make `h` the
// visible character height rather than the transparent source-square height.
function drawTrainer(slug, cx, baseY, h, bobAmp, poseParams, mirrorPose, imageOverride) {
  var yOff = bobAmp ? Math.sin(frame / 16) * bobAmp : 0;
  var dx = poseParams ? poseParams.dx : 0;
  var dy = poseParams ? poseParams.dy : 0;
  var rotation = poseParams ? poseParams.rotation : 0;
  var scaleX = poseParams ? poseParams.scaleX : 1;
  var scaleY = poseParams ? poseParams.scaleY : 1;
  var alpha = poseParams ? poseParams.alpha / 255 : 1;
  if (mirrorPose) { dx = -dx; rotation = -rotation; }

  var image = imageOverride || sprites[slug];
  var bounds = image && typeof DatamonBattlePresentation !== "undefined"
    ? DatamonBattlePresentation.computeAlphaBounds(image) : null;
  var sourceX = bounds ? bounds.x : 0;
  var sourceY = bounds ? bounds.y : 0;
  var sourceW = bounds ? bounds.w : (image ? image.naturalWidth : 64);
  var sourceH = bounds ? bounds.h : (image ? image.naturalHeight : 64);
  var visibleW = h * sourceW / Math.max(1, sourceH);

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(px(cx + dx), px(baseY + dy + yOff));
  ctx.rotate(rotation * Math.PI / 180);
  ctx.scale(scaleX, scaleY);
  if (image) {
    ctx.drawImage(image, sourceX, sourceY, sourceW, sourceH,
      -visibleW / 2, -h, visibleW, h);
  } else {
    var fallbackSize = h * 0.7;
    ctx.drawImage(pixelHead(slug, 64), -fallbackSize / 2, -fallbackSize, fallbackSize, fallbackSize);
  }
  ctx.restore();
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
// Seven compact columns keep the full 37-person roster and difficulty controls visible
// without shrinking the selected consultant's large showcase portrait.
const SEL = { cols: 7, cell: 61, ox: 26, oy: 88 };
const PANEL = { x: 488, y: 96, w: 286, h: 462 };
const SELECT_STAT_LAYOUT = Object.freeze({
  panelPad: 18, labelWidth: 80, labelGap: 8, valueWidth: 30, valueGap: 8, trackHeight: 10,
});
function selectStatGeometry() {
  const labelX = PANEL.x + SELECT_STAT_LAYOUT.panelPad;
  const valueRight = PANEL.x + PANEL.w - SELECT_STAT_LAYOUT.panelPad;
  const valueLeft = valueRight - SELECT_STAT_LAYOUT.valueWidth;
  const trackX = labelX + SELECT_STAT_LAYOUT.labelWidth + SELECT_STAT_LAYOUT.labelGap;
  const trackRight = valueLeft - SELECT_STAT_LAYOUT.valueGap;
  return {
    labelX: labelX, trackX: trackX, trackWidth: Math.max(0, trackRight - trackX),
    valueLeft: valueLeft, valueRight: valueRight, valueWidth: SELECT_STAT_LAYOUT.valueWidth,
    trackHeight: SELECT_STAT_LAYOUT.trackHeight,
  };
}
let selChangedAt = -999; // frame when selection last changed (drives animations)

function announceSelectProfile() {
  if (typeof document === "undefined") return;
  var announcer = document.getElementById("datamon-announcer");
  if (!announcer) return;
  var slug = ROSTER[selectIdx], profile = charProfile(slug);
  announcer.textContent = displayName(slug) + ", " + profile.title + ". " +
    STAT_NAMES.map(function(name, index) {
      return name.charAt(0) + name.slice(1).toLowerCase() + " " + profile.stats[index];
    }).join(", ") +
    ". Difficulty " + DIFF_LABELS[difficulty] + ".";
}

function setSelect(i, silent) {
  if (i === selectIdx) return;
  selectIdx = i;
  selChangedAt = frame;
  loadWalkAnim(ROSTER[selectIdx]); // browsing doubles as a tiny, deduplicated prefetch
  announceSelectProfile();
  if (!silent) sfx.select();
}

// Cycle the difficulty selector on the character-select screen (dir +1 / -1).
function cycleDifficulty(dir) {
  const i = DIFFICULTIES.indexOf(difficulty);
  difficulty = DIFFICULTIES[(i + dir + DIFFICULTIES.length) % DIFFICULTIES.length];
  announceSelectProfile();
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

// Hand-tuned public character attributes. The select panel introduces them; attributes.js
// maps them into bounded, symmetric movement/combat resources without changing answers,
// question choice, campaign rewards, or learning telemetry.
const CURATED_STATS = Object.freeze({
  "alex-andrianavalontsalama": [72, 82, 86, 65],
  "andrea-vreugdenhil":       [74, 76, 96, 84],
  "antonia-nistor":           [78, 84, 92, 69],
  "aurelien-bouffanais":      [68, 88, 87, 78],
  "dana-domanko":             [73, 79, 94, 85],
  "duc-an-nguyen":            [86, 94, 82, 88],
  "elina-gu":                 [70, 87, 90, 82],
  "emile-moffatt":            [88, 91, 83, 72],
  "ethan-pirso":              [84, 93, 85, 95],
  "felicia-gorgacheva":       [91, 84, 96, 74],
  "francesco-finn":           [77, 90, 88, 70],
  "guillaume-delmas-frenette":[82, 89, 86, 79],
  "guillaume-pregent":        [85, 94, 91, 81],
  "jerry-zhu":                [76, 93, 92, 80],
  "jewoo-lee":                [73, 90, 84, 77],
  "jonah-lee":                [81, 88, 89, 73],
  "jonathan-kim":             [87, 95, 94, 83],
  "julien-hovan":             [100, 100, 100, 100],
  "logan-labossiere":         [92, 91, 95, 69],
  "megane-darnaud":           [89, 86, 93, 77],
  "milen-thomas":             [94, 92, 88, 76],
  "minh-ngoc-do":             [75, 89, 91, 80],
  "oyku-cildir":              [83, 94, 93, 90],
  "pentcho-tchomakov":        [97, 100, 96, 99],
  "philippe-miranda-jean":    [90, 96, 89, 82],
  "richard-el-chaar":         [86, 93, 91, 84],
  "sarah-kotb":               [88, 82, 98, 90],
  "saransh-padhy":            [89, 92, 93, 74],
  "scott-carr":               [99, 96, 98, 100],
  "stephanie-fontaine":       [79, 90, 92, 83],
  "tabarek-al-khalidi":       [84, 91, 95, 85],
  "tyler-nagano":             [86, 96, 88, 89],
  "veronica-marallag":        [78, 88, 94, 77],
  "victor-desautels":         [91, 90, 97, 72],
  "vincent-anctil":           [80, 92, 90, 81],
  "wild-guevera":             [82, 94, 93, 86],
  "william-chan":             [98, 98, 99, 100],
});
const FEATURED_PROFILES = Object.freeze({
  "julien-hovan":      { title: "The Creator", color: "#f9735b" },
  "william-chan":      { title: "The Founder", color: "#fbbf24" },
  "scott-carr":        { title: "The Managing Partner", color: "#fbbf24" },
  "pentcho-tchomakov": { title: "The Chief Architect", color: "#fbbf24" },
});
console.assert(
  Object.keys(CURATED_STATS).length === ROSTER.length &&
  ROSTER.every(slug => Array.isArray(CURATED_STATS[slug]) &&
    CURATED_STATS[slug].length === STAT_NAMES.length &&
    CURATED_STATS[slug].every(value => Number.isInteger(value) && value >= 0 && value <= 100)),
  "Curated character attributes must exactly cover ROSTER with four 0-100 integers"
);

const profileCache = {};
function charProfile(slug) {
  if (profileCache[slug]) return profileCache[slug];
  const h = hashStr(slug), rng = mulberry32(h);
  const featured = FEATURED_PROFILES[slug];
  profileCache[slug] = {
    title: featured ? featured.title : CONSULTANT_TITLES[h % CONSULTANT_TITLES.length],
    color: featured ? featured.color : TYPE_COLORS[["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT", "MIX"][h % 6]],
    stats: CURATED_STATS[slug] ? CURATED_STATS[slug].slice() : STAT_NAMES.map(() => 52 + Math.floor(rng() * 48)),
  };
  return profileCache[slug];
}

function statsForSlug(slug) {
  return slug && ROSTER.includes(slug) ? charProfile(slug).stats : [90, 90, 90, 90];
}
function currentPlayerMaxHp() {
  return typeof DatamonAttributes !== "undefined"
    ? DatamonAttributes.maxHp(statsForSlug(player.slug)) : MAX_HP;
}
function currentMovementMultiplier() {
  return typeof DatamonAttributes !== "undefined"
    ? DatamonAttributes.movementMultiplier(statsForSlug(player.slug)) : 1;
}
function resolveAttributeMatchup(opponentSlug) {
  if (typeof DatamonAttributes !== "undefined") {
    return DatamonAttributes.derive(statsForSlug(player.slug), statsForSlug(opponentSlug), difficulty);
  }
  return {
    difficulty: difficulty, maxHp: MAX_HP, wrongDamage: WRONG_DMG,
    hardTimerMs: HARD_TIMER_MS, correctHeal: 0, opponentMonCount: 2,
    movementMultiplier: 1,
  };
}
function battleMaxHp(b) {
  return b && b.attributes ? b.attributes.maxHp : currentPlayerMaxHp();
}
function battleWrongDamage(b) {
  return b && b.attributes ? b.attributes.wrongDamage : WRONG_DMG;
}
function battleCorrectHeal(b) {
  return b && b.attributes ? b.attributes.correctHeal : 0;
}
function battleTimerLimit(b) {
  return b && b.attributes ? b.attributes.hardTimerMs : HARD_TIMER_MS;
}
function restorePlayerHp(snapDisplay) {
  player.hp = currentPlayerMaxHp();
  if (snapDisplay) player.dispHp = player.hp;
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

  // Animated stat bars use three explicit columns. The fill is clamped to its track and can
  // never paint beneath the fixed right-aligned value lane (including values 99 and 100).
  const statGeo = selectStatGeometry();
  STAT_NAMES.forEach((sn, i) => {
    const by = PANEL.y + 352 + i * 23;
    const fillT = Math.min(1, Math.max(0, (frame - selChangedAt - i * 4) / 26));
    const v = Math.max(0, Math.min(100, p.stats[i] * (1 - Math.pow(1 - fillT, 2))));
    ctx.fillStyle = "#94a3b8"; ctx.font = "bold 10px monospace"; ctx.textAlign = "left";
    ctx.fillText(sn, statGeo.labelX, by + 8);
    ctx.fillStyle = "#07101f";
    ctx.fillRect(statGeo.trackX, by, statGeo.trackWidth, statGeo.trackHeight);
    ctx.fillStyle = p.color;
    ctx.fillRect(statGeo.trackX, by, statGeo.trackWidth * (v / 100), statGeo.trackHeight);
    // Repaint the dedicated number lane so even malformed canvas state cannot reduce contrast.
    ctx.fillStyle = "#111c33";
    ctx.fillRect(statGeo.valueLeft, by - 2, statGeo.valueWidth, statGeo.trackHeight + 4);
    ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 10px monospace"; ctx.textAlign = "right";
    ctx.fillText(String(Math.round(v)), statGeo.valueRight, by + 9);
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
function architectureAsset(slug, kind, scene) {
  return (typeof DatamonWorldArt !== "undefined")
    ? DatamonWorldArt.getHDAsset(slug, kind, scene) : null;
}

function drawArchitecturePortal(c, slug, col, row) {
  var asset = architectureAsset(slug, "prop", "office");
  if (!asset) return false;
  c.drawImage(asset.image,
    col * TILE + (asset.entry.anchorX || 0),
    (row + 1) * TILE - asset.entry.heightPx,
    asset.entry.widthPx, asset.entry.heightPx);
  return true;
}

function drawWallRelief(c, sx, sy, horizontal, light, dark) {
  if (horizontal) {
    c.fillStyle = light; c.fillRect(sx, sy, TILE, 3);
    c.fillStyle = dark; c.fillRect(sx, sy + TILE - 4, TILE, 4);
    c.fillStyle = "rgba(8,20,38,0.34)"; c.fillRect(sx + 2, sy + 5, 2, TILE - 10);
  } else {
    c.fillStyle = light; c.fillRect(sx, sy, 3, TILE);
    c.fillStyle = dark; c.fillRect(sx + TILE - 4, sy, 4, TILE);
  }
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

  // Sparse physical-pixel pores, checks, and knots survive the DPR2 cache as detail below one
  // logical pixel. They are deterministic and restrained enough not to reintroduce tile noise.
  c.imageSmoothingEnabled = false;
  for (let i = 0; i < 360; i++) {
    const pxX = Math.floor(rng() * W), pxY = Math.floor(rng() * H);
    c.fillStyle = rng() < 0.64 ? "rgba(58,31,10,0.16)" : "rgba(255,224,177,0.13)";
    c.fillRect(pxX, pxY, rng() < 0.82 ? 1 : Math.max(1, ds), 1);
  }
  for (let i = 0; i < 26; i++) {
    const knotX = Math.floor(rand(20, W - 20)), knotY = Math.floor(rand(20, H - 20));
    const radiusX = rand(2.5, 5.5) * ds, radiusY = rand(1.2, 2.8) * ds;
    c.strokeStyle = "rgba(58,31,10,0.13)"; c.lineWidth = 1;
    c.beginPath(); c.ellipse(knotX, knotY, radiusX, radiusY, 0, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "rgba(255,226,184,0.07)"; c.fillRect(knotX - radiusX, knotY - 1, radiusX * 2, 1);
  }

  floorTex = cv;
  return cv;
}

// Quiet material zoning replaces the old seam runners and dense floor diagrams.
// Domain identity is carried by wall friezes and door silhouettes (#049).
function drawOfficeZoneIdentity(c, ds) {
  var hair = 1 / Math.max(1, ds);

  // Six-zone low-contrast material washes — labels, sprites, and wayfinding remain primary.
  var zones = [
    [0, 0, 12, 11, "rgba(242,179,93,0.05)"],
    [12, 0, 24, 11, "rgba(168,85,247,0.05)"],
    [24, 0, 36, 11, "rgba(34,197,94,0.04)"],
    [0, 11, 12, 24, "rgba(6,182,212,0.05)"],
    [12, 11, 24, 24, "rgba(249,115,22,0.04)"],
    [24, 11, 36, 24, "rgba(245,158,11,0.04)"],
  ];
  for (var z = 0; z < zones.length; z++) {
    var zz = zones[z];
    c.fillStyle = zz[4];
    c.fillRect(zz[0] * TILE, zz[1] * TILE, (zz[2] - zz[0]) * TILE, (zz[3] - zz[1]) * TILE);
  }

  // Restrained Spine/Commons/Gallery inlays — bounded matte/brass paths that lead the eye.
  c.save();
  var pathColor = "rgba(242,179,93,0.18)";       // brass path line
  var spineColor = "rgba(45,55,72,0.32)";        // matte spine track

  // Certification Spine: north-south central corridor (x=17..19, y=5..22)
  c.fillStyle = spineColor;
  c.fillRect(17 * TILE, 5 * TILE, 3 * TILE, 18 * TILE);
  c.strokeStyle = pathColor;
  c.lineWidth = hair;
  c.strokeRect(17 * TILE + hair, 5 * TILE + hair, 3 * TILE - hair * 2, 18 * TILE - hair * 2);

  // Commons: east-west cross corridor (x=2..33, y=10..12)
  c.fillStyle = "rgba(232,223,200,0.12)";
  c.fillRect(2 * TILE, 10 * TILE, 32 * TILE, 3 * TILE);
  c.strokeStyle = "rgba(232,223,200,0.28)";
  c.strokeRect(2 * TILE + hair, 10 * TILE + hair, 32 * TILE - hair * 2, 3 * TILE - hair * 2);

  // Portal Gallery: south spine extension (x=10..33, y=21..22)
  c.fillStyle = "rgba(45,55,72,0.24)";
  c.fillRect(10 * TILE, 21 * TILE, 24 * TILE, 2 * TILE);
  c.strokeStyle = "rgba(242,179,93,0.16)";
  c.strokeRect(10 * TILE + hair, 21 * TILE + hair, 24 * TILE - hair * 2, 2 * TILE - hair * 2);

  // Context Spur: approach to the meeting room
  c.strokeStyle = "rgba(6,182,212,0.22)";
  c.strokeRect(6 * TILE + hair, 12 * TILE + hair, 3 * TILE - hair * 2, 3 * TILE - hair * 2);
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

// One geometry contract drives both the cache-baked landmark and its runtime foreground
// repaint. sortY is the centreline of the southernmost occupied tile, matching the existing
// character sy key; a character crosses in front only after its feet move south of the frame.
function wayfindingSurroundGeometry(surround, cameraX, cameraY) {
  var camX = Number.isFinite(cameraX) ? cameraX : 0;
  var camY = Number.isFinite(cameraY) ? cameraY : 0;
  var width = 96, height = 64;
  var left = (surround.door[0] - camX) * TILE - TILE;
  var top = (surround.door[1] + 1 - camY) * TILE - height;
  return { left: left, top: top, width: width, height: height,
    sortY: top + height - TILE / 2 };
}

function drawWayfindingSurround(target, surround, geometry) {
  var image = wayfindingStore[surround.id];
  var meta = wayfindingManifest.find(function(entry) { return entry.id === surround.id; });
  if (image && meta) {
    target.drawImage(image, geometry.left, geometry.top, geometry.width, geometry.height);
    return;
  }
  // Fail-closed fallback retains opaque frame mass as well as the transparent portal opening,
  // so malformed/missing art cannot reintroduce character-through-post overlap.
  target.fillStyle = "#0f1a2e";
  target.fillRect(geometry.left + 4, geometry.top + 6, 88, 16);
  target.fillRect(geometry.left + 5, geometry.top + 22, 22, 40);
  target.fillRect(geometry.left + 69, geometry.top + 22, 22, 40);
  target.strokeStyle = surround.accent; target.lineWidth = 2;
  target.strokeRect(geometry.left + 4, geometry.top + 6, 88, 16);
  target.strokeRect(geometry.left + 5, geometry.top + 22, 22, 40);
  target.strokeRect(geometry.left + 69, geometry.top + 22, 22, 40);
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
        const horizontalWall = y === 0 || y === MAP_H - 1;
        const architecture = horizontalWall
          ? architectureAsset("architecture-office-wall", "tile", "office") : null;
        if (architecture) {
          c.drawImage(architecture.image, sx, sy, TILE, TILE);
        } else {
          const brick = (x % 6 === 0 || y % 6 === 0) ? "brick-white" : "brick-red";
          if (!blitTile(c, brick, sx, sy) && !blitTile(c, wallSlug(x, y), sx, sy)) {
            c.fillStyle = tileColor(t, x, y); c.fillRect(sx, sy, TILE, TILE);
          }
          drawWallRelief(c, sx, sy, horizontalWall, "rgba(232,223,200,0.72)", "rgba(15,23,42,0.72)");
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
    if (!drawArchitecturePortal(c, "architecture-library-portal", dcol, drow)) {
      const dmeta = libManifest.find(m => m.slug === "lib-door");
      const dimg = libStore["lib-door"];
      if (dimg && dmeta) {
        c.drawImage(dimg, dcol * TILE, (drow + 1) * TILE - dmeta.heightPx, dmeta.widthPx, dmeta.heightPx);
      }
    }
  }

  // Battle Room entrance: accepted 2× portal at Retina scale, bounded procedural fallback otherwise.
  {
    var bcol = OFFICE_BATTLE_DOOR_TILE[0], brow = OFFICE_BATTLE_DOOR_TILE[1];
    if (!drawArchitecturePortal(c, "architecture-battle-portal", bcol, brow)) {
      var bx = bcol * TILE, by = brow * TILE;
      c.fillStyle = "#1e2838"; c.fillRect(bx + 2, by - 14, TILE - 4, TILE + 12);
      c.strokeStyle = "#c89940"; c.lineWidth = 2; c.strokeRect(bx + 2, by - 14, TILE - 4, TILE + 12);
      c.fillStyle = "#ef4444"; c.fillRect(bx + 8, by + 12, 16, 3);
    }
  }

  // ---- Study-life environment batch (#047): deterministic true-2× cutouts ----
  // These are cache-baked visuals; only the Certification Console has collision cells.
  for (var sp = 0; sp < STUDY_PROP_PLACEMENTS.length; sp++) {
    var studyProp = STUDY_PROP_PLACEMENTS[sp];
    var spx = studyProp.col * TILE, spy = studyProp.row * TILE;
    var spImg = studyPropStore[studyProp.slug];
    var spMeta = studyPropManifest.find(function(m) { return m.slug === studyProp.slug; });

    if (spImg && spMeta) {
      c.drawImage(spImg, spx + (spMeta.anchorX || 0), spy,
        spMeta.widthPx, spMeta.heightPx);
    } else if (studyProp.slug === "certification-console") {
      c.fillStyle = "#0f1a2e"; c.fillRect(spx, spy, TILE * 2, TILE);
      c.strokeStyle = "#2dd4bf"; c.lineWidth = 2;
      c.strokeRect(spx + 1, spy + 1, TILE * 2 - 2, TILE - 2);
      c.fillStyle = "#2dd4bf"; c.font = "bold 10px monospace"; c.textAlign = "center";
      c.fillText("CERT", spx + TILE, spy + 20);
    } else if (studyProp.slug === "readiness-board") {
      c.fillStyle = "#0f1a2e"; c.fillRect(spx, spy, TILE * 3, TILE);
      c.strokeStyle = "#2dd4bf"; c.strokeRect(spx + 2, spy + 2, TILE * 3 - 4, TILE - 4);
    } else if (studyProp.slug === "task-lamp") {
      c.fillStyle = "#334155"; c.fillRect(spx + 12, spy + TILE - 18, 8, 18);
      c.fillStyle = "#fbbf24"; c.fillRect(spx + 8, spy + 4, 16, 6);
    } else if (studyProp.slug === "desk-study-kit") {
      c.fillStyle = "#1e293b"; c.fillRect(spx + 6, spy + 2, 20, 16);
      c.fillStyle = "#38bdf8"; c.fillRect(spx + 8, spy + 4, 16, 10);
    }
  }

  // ---- Wayfinding batch (#049): six wall friezes + three destination surrounds ----
  // Source pixels are true 2x; widthPx/heightPx are the fixed logical draw dimensions.
  // The lower-zone friezes live on real glass/south walls rather than lying on the floor.
  var friezePlacements = [
    { id: "zone-agent-frieze",   col: 2,  row: 0,  accent: TYPE_COLORS.AGENT },
    { id: "zone-mcp-frieze",     col: 14, row: 0,  accent: TYPE_COLORS.MCP },
    { id: "zone-config-frieze",  col: 26, row: 0,  accent: TYPE_COLORS.CONFIG },
    { id: "zone-context-frieze", col: 2,  row: 15, accent: TYPE_COLORS.CONTEXT },
    { id: "zone-prompt-frieze",  col: 15, row: 23, accent: TYPE_COLORS.PROMPT },
    { id: "zone-mix-frieze",     col: 29, row: 23, accent: TYPE_COLORS.MIX },
  ];
  for (var fi = 0; fi < friezePlacements.length; fi++) {
    var fp = friezePlacements[fi];
    var friezeImg = wayfindingStore[fp.id];
    var friezeMeta = wayfindingManifest.find(function(entry) { return entry.id === fp.id; });
    if (friezeImg && friezeMeta) {
      c.drawImage(friezeImg, fp.col * TILE, fp.row * TILE, friezeMeta.widthPx, friezeMeta.heightPx);
    } else {
      // Bounded fallback still communicates a wall instrument without text or collision.
      c.fillStyle = "rgba(8,20,38,0.82)"; c.fillRect(fp.col * TILE, fp.row * TILE + 4, 3 * TILE, 12);
      c.strokeStyle = fp.accent; c.lineWidth = 1; c.strokeRect(fp.col * TILE, fp.row * TILE + 4, 3 * TILE, 12);
      c.fillStyle = fp.accent; c.fillRect(fp.col * TILE + 8, fp.row * TILE + 9, 3 * TILE - 16, 2);
    }
  }

  for (var si = 0; si < WAYFINDING_SURROUND_PLACEMENTS.length; si++) {
    var surround = WAYFINDING_SURROUND_PLACEMENTS[si];
    var surroundGeometry = wayfindingSurroundGeometry(surround, 0, 0);
    drawWayfindingSurround(c, surround, surroundGeometry);
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
        const horizontalWall = y === 0 || y === MAP_H - 1;
        const architecture = horizontalWall
          ? architectureAsset("architecture-library-wall", "tile", "library") : null;
        if (architecture) c.drawImage(architecture.image, sx, sy, TILE, TILE);
        else {
          if (!blitLibTile("lib-wall", sx, sy)) { c.fillStyle = "#3b2f24"; c.fillRect(sx, sy, TILE, TILE); }
          drawWallRelief(c, sx, sy, horizontalWall, "rgba(232,223,200,0.66)", "rgba(15,23,42,0.64)");
        }
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
  // The accepted portal deliberately overlays the legacy door only at DPR2.
  drawArchitecturePortal(c, "architecture-library-portal", LIBRARY_DOOR_TILE[0], LIBRARY_DOOR_TILE[1]);

  return cv;
}

// ---------- Battle Room map canvas (#046/#051) ----------
// The proving-ground floor is one room-scale material composition. Large resin panels,
// physical-pixel wear, six domain bays, and a lit centre dais replace the old 32px checkerboard
// without changing a single map/collision cell.
function drawBattleRoomFloor(c, ds) {
  const hair = 1 / Math.max(1, ds), rng = mulberry32(0xBA771E);
  const worldW = MAP_W * TILE, worldH = MAP_H * TILE;
  c.save();
  c.fillStyle = "#20293a"; c.fillRect(0, 0, worldW, worldH);

  // Staggered 4×3-tile resin plates erase the logical tile grid and give the room industrial
  // scale. Hairline bevels remain one physical pixel at DPR2.
  const panelTones = ["#242e40", "#283246", "#222c3d", "#2a3447"];
  const panelW = 4 * TILE, panelH = 3 * TILE;
  for (let row = 0, y = 0; y < worldH; row++, y += panelH) {
    const offset = row % 2 ? -panelW / 2 : 0;
    for (let x = offset; x < worldW; x += panelW) {
      c.fillStyle = panelTones[Math.floor(rng() * panelTones.length)];
      c.fillRect(x, y, panelW, panelH);
      c.fillStyle = "rgba(226,232,240,0.055)"; c.fillRect(x, y, panelW, hair);
      c.fillStyle = "rgba(3,7,18,0.28)"; c.fillRect(x, y + panelH - hair, panelW, hair);
      c.fillRect(x + panelW - hair, y, hair, panelH);
    }
  }

  // True-detail scuffs and inspection marks: deterministic, cache-baked, and below one logical
  // pixel at DPR2. Sparse diagonal checks imply repeated training rather than visual noise.
  for (let i = 0; i < 260; i++) {
    const x = 2 * TILE + rng() * (worldW - 4 * TILE);
    const y = 2 * TILE + rng() * (worldH - 4 * TILE);
    const length = (2 + rng() * 6) / Math.max(1, ds);
    c.strokeStyle = rng() < 0.68 ? "rgba(226,232,240,0.08)" : "rgba(2,6,23,0.16)";
    c.lineWidth = hair;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + length, y + length * 0.35); c.stroke();
  }

  // A matte certification runway gives the south entry an immediate destination and keeps
  // x=17..19 visually/physically legible all the way to the central proving dais.
  const laneX = 17 * TILE, laneW = 3 * TILE;
  const lane = c.createLinearGradient(0, 22 * TILE, 0, 9 * TILE);
  lane.addColorStop(0, "rgba(239,68,68,0.20)"); lane.addColorStop(1, "rgba(45,212,191,0.08)");
  c.fillStyle = lane; c.fillRect(laneX, 9 * TILE, laneW, 14 * TILE);
  c.strokeStyle = "rgba(226,232,240,0.24)"; c.lineWidth = hair;
  c.strokeRect(laneX + hair, 9 * TILE + hair, laneW - hair * 2, 14 * TILE - hair * 2);
  for (let y = 20.5; y >= 14.5; y -= 2) {
    c.fillStyle = "rgba(242,179,93,0.38)";
    c.beginPath(); c.moveTo(18.5 * TILE, y * TILE - 7); c.lineTo(18.5 * TILE + 8, y * TILE + 1);
    c.lineTo(18.5 * TILE, y * TILE + 9); c.lineTo(18.5 * TILE - 8, y * TILE + 1); c.fill();
  }

  // Central certification seal: layered hex/dial geometry is the room's one signature moment.
  const cx = 18.5 * TILE, cy = 11.7 * TILE;
  const glow = c.createRadialGradient(cx, cy, 10, cx, cy, 4.7 * TILE);
  glow.addColorStop(0, "rgba(242,179,93,0.18)"); glow.addColorStop(0.58, "rgba(45,212,191,0.055)");
  glow.addColorStop(1, "rgba(2,6,23,0)");
  c.fillStyle = glow; c.fillRect(cx - 5 * TILE, cy - 5 * TILE, 10 * TILE, 10 * TILE);
  function hex(radius) {
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 3;
      const x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
  }
  c.fillStyle = "rgba(8,20,38,0.48)"; hex(3.2 * TILE); c.fill();
  c.strokeStyle = "rgba(242,179,93,0.68)"; c.lineWidth = 2 * hair; hex(3.2 * TILE); c.stroke();
  c.strokeStyle = "rgba(226,232,240,0.24)"; c.lineWidth = hair; hex(2.35 * TILE); c.stroke();
  c.fillStyle = "rgba(242,179,93,0.62)"; c.fillRect(cx - 18, cy - hair, 36, 2 * hair);
  c.fillStyle = "rgba(45,212,191,0.58)"; c.fillRect(cx - hair, cy - 18, 2 * hair, 36);

  // Six domain proving bays use a shape + accent rail, never text or colour alone.
  const bayColors = [TYPE_COLORS.AGENT, TYPE_COLORS.MCP, TYPE_COLORS.CONFIG,
    TYPE_COLORS.PROMPT, TYPE_COLORS.CONTEXT, TYPE_COLORS.MIX];
  const bays = [[6,15],[10,11],[13,6],[24,6],[27,11],[30,15]];
  bays.forEach(function(bay, index) {
    const x = (bay[0] - 1.2) * TILE, y = (bay[1] - 0.8) * TILE, w = 2.4 * TILE, h = 1.6 * TILE;
    c.fillStyle = "rgba(8,20,38,0.34)"; c.fillRect(x, y, w, h);
    c.strokeStyle = bayColors[index] + "99"; c.lineWidth = 2 * hair; c.strokeRect(x, y, w, h);
    c.fillStyle = bayColors[index] + "bb"; c.fillRect(x + 8, y + 7, w - 16, 3);
    c.strokeStyle = "rgba(226,232,240,0.34)"; c.lineWidth = hair;
    c.beginPath();
    if (index % 3 === 0) c.arc(x + w / 2, y + h / 2 + 5, 9, 0, Math.PI * 2);
    else if (index % 3 === 1) { c.moveTo(x + w / 2, y + 16); c.lineTo(x + w / 2 - 10, y + h - 9); c.lineTo(x + w / 2 + 10, y + h - 9); c.closePath(); }
    else c.rect(x + w / 2 - 8, y + h / 2 - 3, 16, 16);
    c.stroke();
  });

  // Segmented perimeter rails frame the 36 training positions without reading as one empty box.
  c.strokeStyle = "rgba(239,68,68,0.24)"; c.lineWidth = 2 * hair;
  [[2.4,2.4,8,0],[25.6,2.4,8,0],[2.4,20.6,8,0],[25.6,20.6,8,0]].forEach(function(seg) {
    c.beginPath(); c.moveTo(seg[0] * TILE, seg[1] * TILE); c.lineTo((seg[0] + seg[2]) * TILE, seg[1] * TILE); c.stroke();
  });
  c.restore();
}

function buildBattleRoomMapCanvas() {
  var cv = document.createElement("canvas");
  cv.width  = Math.round(MAP_W * TILE * MAP_DETAIL_SCALE);
  cv.height = Math.round(MAP_H * TILE * MAP_DETAIL_SCALE);
  cv.detailScale = MAP_DETAIL_SCALE;
  var c = cv.getContext("2d");
  c.imageSmoothingEnabled = false;
  var ds = MAP_DETAIL_SCALE;
  c.scale(ds, ds);
  drawBattleRoomFloor(c, ds);

  // Structural walls/portal remain map-authoritative; floor paint never creates collision.
  for (var y = 0; y < MAP_H; y++) {
    for (var x = 0; x < MAP_W; x++) {
      var sx = x * TILE, sy = y * TILE;
      var t = BATTLE_ROOM_MAP[y][x];
      if (t === "#") {
        var horizontalWall = y === 0 || y === MAP_H - 1;
        var architecture = horizontalWall
          ? architectureAsset("architecture-battle-wall", "tile", "battleRoom") : null;
        if (architecture) c.drawImage(architecture.image, sx, sy, TILE, TILE);
        else {
          c.fillStyle = "#1a2740"; c.fillRect(sx, sy, TILE, TILE);
          c.fillStyle = "#0c1a30"; c.fillRect(sx + TILE / 2 - 1, sy, 2, TILE);
          drawWallRelief(c, sx, sy, horizontalWall, "rgba(200,208,224,0.76)", "rgba(8,20,38,0.82)");
        }
      } else if (t === "A") {
        c.fillStyle = "#1e2838"; c.fillRect(sx, sy, TILE, TILE);
        c.strokeStyle = "#c89940"; c.lineWidth = 2; c.strokeRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
        c.fillStyle = "#c89940"; c.font = "9px monospace"; c.textAlign = "center";
        c.fillText("EXIT", sx + TILE / 2, sy + TILE / 2 + 3);
      }
    }
  }
  drawArchitecturePortal(c, "architecture-battle-portal", BATTLE_ROOM_DOOR_TILE[0], BATTLE_ROOM_DOOR_TILE[1]);
  return cv;
}

// World-space room plaques were removed in favor of the fixed location HUD (#046).
const LIBRARY_DUST_POINTS = Object.freeze([[6,7],[11,12],[17,5],[20,17],[25,7],[29,18],[33,10],[15,20]]);

// Seven bounded, particle-free living-world loops. They are cosmetic and draw above the
// cached architecture but below labels/characters. Reduced motion pins every loop to phase 0.
function drawLivingWorldAmbient() {
  if (typeof DatamonWorldArt === "undefined") return;
  var phase = DatamonWorldArt.getAmbientPhase(2400);
  var sx = function (x) { return (x - camFx) * TILE; };
  var sy = function (y) { return (y - camFy) * TILE; };
  ctx.save();
  if (currentMap === "office") {
    // #049: Quiet ambient — only the certification console telemetry strip remains.
    // Old MCP bus/pips, Config rail, Context window frames, Prompt cursors, and MIX
    // compass/pulse animations have been removed in favor of static wayfinding assets.
    var ambientMeta = studyPropManifest.find(function(entry) {
      return entry.slug === STUDY_AMBIENT_PLACEMENT.slug;
    });
    var ambientImage = studyPropStore[STUDY_AMBIENT_PLACEMENT.slug];
    if (ambientMeta && ambientImage && ambientMeta.animation) {
      var ambientFrames = ambientMeta.animation.frames || 1;
      var ambientFrame = Math.min(ambientFrames - 1, Math.floor(phase * ambientFrames));
      var sourceWidth = ambientImage.naturalWidth / ambientFrames;
      ctx.drawImage(ambientImage, ambientFrame * sourceWidth, 0, sourceWidth, ambientImage.naturalHeight,
        sx(STUDY_AMBIENT_PLACEMENT.col), sy(STUDY_AMBIENT_PLACEMENT.row) + 7,
        ambientMeta.widthPx, ambientMeta.heightPx);
    }
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
  } else if (currentMap === "battleRoom") {
    // Training floor: subtle pulsing compass ring and perimeter glow.
    var ringGlow = 0.12 + Math.sin(phase * Math.PI * 2) * 0.05;
    ctx.strokeStyle = "rgba(200,153,64," + ringGlow + ")";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx(18), sy(12), 3 * TILE, 0, Math.PI * 2);
    ctx.stroke();
    // Faint red perimeter pulse
    var perimeterGlow = 0.06 + Math.sin(phase * Math.PI * 1.5) * 0.04;
    ctx.strokeStyle = "rgba(239,68,68," + perimeterGlow + ")";
    ctx.strokeRect(sx(2.2), sy(2.2), (MAP_W - 4.4) * TILE, (MAP_H - 4.4) * TILE);
  }
  ctx.restore();
}

const OFFICE_HUD_GEOMETRY = Object.freeze({
  x: 8, y: 8, width: 250, height: 64, portraitX: 16, portraitY: 16, portraitSize: 48,
  contentX: 66, hpY: 38, hpWidth: 140, primaryBaseline: 62, secondaryBaseline: null,
});
const TRAINING_HUD_GEOMETRY = Object.freeze({
  x: 8, y: 8, width: 292, height: 88, portraitX: 16, portraitY: 16, portraitSize: 48,
  contentX: 66, hpY: 38, hpWidth: 164, primaryBaseline: 65, secondaryBaseline: 82,
});
function overworldHudGeometry(mapName) {
  return mapName === "battleRoom" ? TRAINING_HUD_GEOMETRY : OFFICE_HUD_GEOMETRY;
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
    const cameraFollow = typeof DatamonLocomotion !== "undefined"
      ? DatamonLocomotion.cameraFactor(dtF / 60, 0.12, 60) : 0.12;
    camFx += (targetCamX - camFx) * cameraFollow;
    camFy += (targetCamY - camFy) * cameraFollow;
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

  // Painter's algorithm: collect every on-screen character (NPCs + player) into one
  // list, sort back-to-front by feet-Y (tie-break x), and draw in that order so a
  // character standing further south (lower on screen, closer to the viewer) always
  // draws on top — whether that's the player or an NPC. sy carries a constant offset
  // from feet-Y, so sorting by sy is equivalent. The comparator reads only; it never
  // mutates any NPC/player position field.
  const onScreen = (sx, sy) => sx >= -TILE && sx <= CANVAS_W + TILE && sy >= -TILE && sy <= CANVAS_H + TILE;
  const isSolidTile = (tx, ty) =>
    ty >= 0 && ty < MAP_H && tx >= 0 && tx < MAP_W && SOLID.has(map[ty][tx]);

  primeVisibleNpcIdleDirections(onScreen);

  const chars = [];
  for (const n of npcs) {
    const sx = (n.x - camFx) * TILE + TILE / 2, sy = (n.y - camFy) * TILE + TILE / 2;
    if (!onScreen(sx, sy)) continue;
    chars.push({ sx, sy, slug: n.slug, dir: n.dir || "down", isPlayer: false, bob: !n.defeated, tx: n.x, ty: n.y, npc: n, seated: !!n._seated });
  }
  {
    const sx = (player.fx - camFx) * TILE + TILE / 2, sy = (player.fy - camFy) * TILE + TILE / 2;
    chars.push({ sx, sy, slug: player.slug, dir: player.dir, isPlayer: true, bob: player.moving,
                 tx: Math.round(player.fx), ty: Math.round(player.fy), npc: null, seated: player.seated });
  }
  // Visual-only detail entities join the feet-Y sort but never touch map/SOLID collision.
  if (currentMap === "office" && typeof DatamonWorldArt !== "undefined") {
    for (const item of DatamonWorldArt.getVisualDetailPlacements("office")) {
      const p = item.placement, e = item.entry;
      // The old collision-free collaboration table implied a physical obstacle in a walkable cell.
      // Functional furniture now owns that role; keep this deprecated visual out of the scene.
      if (e.id === "hd-collaboration-table") continue;
      const sx = (p.col - camFx) * TILE + (e.anchorX || 0);
      const top = (p.row - camFy) * TILE;
      chars.push({ worldArt: item, sx, top, sy: top + e.heightPx, tx: p.col, ty: p.row });
    }
  }
  // Repaint each threshold frame at its physical base depth. The cache copy remains the
  // backplate; this sorted copy supplies the missing foreground occlusion without changing
  // collision, route widths, or transparent openings. At an exact threshold tie the frame wins.
  if (currentMap === "office") {
    for (const surround of WAYFINDING_SURROUND_PLACEMENTS) {
      const geometry = wayfindingSurroundGeometry(surround, camFx, camFy);
      if (geometry.left + geometry.width < -TILE || geometry.left > CANVAS_W + TILE ||
          geometry.top + geometry.height < -TILE || geometry.top > CANVAS_H + TILE) continue;
      chars.push({ wayfindingSurround: surround, geometry: geometry,
        sx: geometry.left, sy: geometry.sortY, sortRank: 1 });
    }
  }
  chars.sort((a, b) => (a.sy - b.sy) || ((a.sortRank || 0) - (b.sortRank || 0)) || (a.sx - b.sx));

  for (const c of chars) {
    if (c.wayfindingSurround) {
      drawWayfindingSurround(ctx, c.wayfindingSurround, c.geometry);
    } else if (c.worldArt) {
      const e = c.worldArt.entry;
      ctx.drawImage(c.worldArt.image, c.sx, c.top, e.widthPx, e.heightPx);
      if (e.id === "hd-collaboration-table") {
        DatamonWorldArt.drawAmbientEntry(ctx, "hd-amb-table", camFx, camFy, TILE);
      }
    } else {
      drawCharacter(c.sx, c.sy, c.slug, c.dir, c.isPlayer, c.bob, isSolidTile(c.tx, c.ty - 1), c.seated);
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
    // DPR2 world-art details share the depth-sort list but are neither players nor NPCs.
    if (c.isPlayer || c.worldArt || !c.npc) continue;
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

  // Measured HUD geometry gives Battle Room telemetry its own baselines below the HP bar;
  // the previous 64px panel let streak/wins glyphs collide with the bar and panel edge.
  const hud = overworldHudGeometry(currentMap);
  ctx.fillStyle = "rgba(15,23,42,0.90)";
  ctx.fillRect(hud.x, hud.y, hud.width, hud.height);
  ctx.drawImage(pixelHead(player.slug, hud.portraitSize), hud.portraitX, hud.portraitY,
    hud.portraitSize, hud.portraitSize);
  const hudMaxHp = currentPlayerMaxHp();
  drawHPBar(hud.contentX, hud.hpY, hud.hpWidth, 10,
    Math.min(1, player.dispHp / hudMaxHp), firstName(player.slug) + "  HP " + player.hp + "/" + hudMaxHp);
  ctx.fillStyle = "#cbd5e1"; ctx.font = "11px monospace"; ctx.textAlign = "left";
  if (currentMap === "battleRoom") {
    var brActivity = (_progression && _progression.activities && _progression.activities.battleRoom)
      ? _progression.activities.battleRoom : null;
    var str = brActivity ? brActivity.currentStreak || 0 : 0;
    var bst = brActivity ? brActivity.bestStreak || 0 : 0;
    ctx.fillText("Training streak " + str + "  ·  best " + bst, hud.contentX, hud.primaryBaseline);
    ctx.fillStyle = "#94a3b8"; ctx.font = "10px monospace";
    ctx.fillText("Wins " + (brActivity ? brActivity.wins || 0 : 0) + "  ·  unlimited rematches",
      hud.contentX, hud.secondaryBaseline);
  } else {
    ctx.fillText("Rivals bested: " + defeated.size + "/" + rivalTotal, hud.contentX, hud.primaryBaseline);
  }

  // Draw fixed navigation chrome after world entities so no sprite can cover it.
  var destinationPreview = officeDestinationPreview();
  drawLocationHUD();
  if (state !== "dialogue" && performance.now() >= dialogueAnnouncementHoldUntil) {
    announceLocation(destinationPreview ? destinationPreview.label : locationHudLabel(),
      destinationPreview ? destinationPreview.announce : locationHudPurpose());
  }

  // ---- Evidence HUD strip (#047): compact study-readiness below location instrument ----
  drawEvidenceHUD();

  ctx.fillStyle = "rgba(148,163,184,0.55)"; ctx.font = "11px monospace"; ctx.textAlign = "left";
  ctx.fillText("/  find a colleague", 12, CANVAS_H - 14);

  // One contextual facing hint covers colleagues, free seats, and the study console.
  const [tx, ty] = facingTile();
  const facingNpc = npcs.find(n => n.x === tx && n.y === ty);
  var hint = null, hintColor = "#2dd4bf";
  if (player.seated) {
    hint = "SPACE / MOVE: stand up";
  } else if (destinationPreview) {
    hint = destinationPreview.hint;
    hintColor = destinationPreview.accent;
  } else if (facingNpc && !scout) {
    var actionVerb = facingNpc.defeated ? "review with"
      : (currentMap === "battleRoom" ? "train against" : "battle");
    hint = "SPACE: " + actionVerb + " " + displayName(facingNpc.slug) + " [" + facingNpc.type + "]";
    hintColor = TYPE_COLORS[facingNpc.type];
  } else if (isFreePlayerSeat(tx, ty)) {
    hint = "SPACE: sit at study desk";
    hintColor = "#fbbf24";
  } else if (currentMap === "office" && map[ty] && map[ty][tx] === "X") {
    hint = "SPACE: open Certification Console";
  }
  if (hint && !certConsoleOpen && !mentorReview) {
    ctx.fillStyle = "rgba(15,23,42,0.90)";
    ctx.font = "bold 14px monospace";
    const hintW = ctx.measureText(hint).width + 24;
    ctx.fillRect(CANVAS_W / 2 - hintW / 2, CANVAS_H - 44, hintW, 30);
    ctx.fillStyle = hintColor; ctx.textAlign = "center";
    ctx.fillText(hint, CANVAS_W / 2, CANVAS_H - 24);
  }

  // Modal is last so no navigation prompt or character can paint over it.
  if (certConsoleOpen) drawCertConsole();
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
    ctx.fillText("Stability " + ao.stability + "/" + ao.maxStability + " · Momentum " + ao.momentum + "/3 · Guardrail " + (ao.guardrail ? "ACTIVE" : "OFF") + " · HP " + ao.playerHp + "/" + ao.maxHp, CANVAS_W / 2, 66);
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

// Compact pixel-banded contact shadow. Keeping every band above the authored ground
// coordinate preserves the platform lip while visually seating feet/claws on its surface.
function drawBattleContactShadow(cx, groundY, width, alpha) {
  var bands = [0.42, 0.72, 0.9, 1, 0.9, 0.72, 0.42];
  ctx.save();
  ctx.fillStyle = "#030711";
  ctx.globalAlpha *= alpha;
  for (var band = 0; band < bands.length; band++) {
    var bandWidth = Math.max(2, Math.round(width * bands[band]));
    ctx.fillRect(px(cx - bandWidth / 2), px(groundY - bands.length + band), bandWidth, 1);
  }
  ctx.restore();
}

function drawBattle() {
  var b = battle;
  if (b.agentOps) { _agentDrawBattle(b); return; }
  var BPS = typeof DatamonBattlePresentation !== "undefined" ? DatamonBattlePresentation : null;
  var GEO = BPS ? BPS.GEOMETRY : null;
  var reducedMotion = typeof AgentArena !== "undefined" && AgentArena.prefersReducedMotion
    ? AgentArena.prefersReducedMotion()
    : !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var shakeX = !reducedMotion && b.shake > 0 ? (Math.random() - 0.5) * b.shake : 0;
  if (reducedMotion) b.shake = 0;
  else if (b.shake > 0) b.shake = Math.max(0, b.shake - dtF);

  ctx.save();
  ctx.translate(shakeX, 0);

  var typeColor = TYPE_COLORS[b.npc.type];
  var mon = currentMon();
  var monColor = TYPE_COLORS[mon.domain] || typeColor;

  // ---- Authored certification arena ----
  var Arena = typeof DatamonBattleArena !== "undefined" ? DatamonBattleArena : null;
  ctx.fillStyle = "#07111f";
  ctx.fillRect(-20, 0, CANVAS_W + 40, CANVAS_H);
  if (Arena) Arena.drawArena(ctx, mon.domain, 0, 0, CANVAS_W, GEO ? GEO.STAGE_BOTTOM : 432);
  else {
    ctx.fillStyle = "#0b1729";
    ctx.fillRect(0, 0, CANVAS_W, GEO ? GEO.STAGE_BOTTOM : 432);
  }
  // A restrained projector core gives intro a focal endpoint before sendout. It is static
  // under reduced motion and never replaces Battlemon semantic frames.
  if (GEO && b.phase === "intro") {
    var beaconPhase = reducedMotion ? 0 : Math.floor(frame / 8) % 3;
    ctx.fillStyle = monColor; ctx.globalAlpha = 0.64;
    ctx.beginPath();
    ctx.moveTo(GEO.BATTLEMON_CENTER_X, GEO.BATTLEMON_CENTER_Y + 5 - beaconPhase);
    ctx.lineTo(GEO.BATTLEMON_CENTER_X + 7, GEO.BATTLEMON_CENTER_Y + 12);
    ctx.lineTo(GEO.BATTLEMON_CENTER_X, GEO.BATTLEMON_CENTER_Y + 19 + beaconPhase);
    ctx.lineTo(GEO.BATTLEMON_CENTER_X - 7, GEO.BATTLEMON_CENTER_Y + 12);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.28;
    ctx.fillRect(GEO.BATTLEMON_CENTER_X - 13 - beaconPhase * 2, GEO.BATTLEMON_CENTER_Y + 27,
      26 + beaconPhase * 4, 2);
    ctx.globalAlpha = 1;
  }

  // ---- Entrance easing (reduced motion: no slide) ----
  var ee = reducedMotion ? 1 : (1 - Math.pow(1 - Math.min(1, (frame - b.startF) / 30), 3));
  var oppX = GEO ? GEO.OPPONENT_ANCHOR[0] : 683;
  var plyX = GEO ? GEO.PLAYER_ANCHOR[0] : 151;
  if (!reducedMotion) {
    oppX += (1 - ee) * 220;
    plyX -= (1 - ee) * 220;
  }
  var oppBaseY = GEO ? GEO.OPPONENT_ANCHOR[1] : 158;
  var plyBaseY = GEO ? GEO.PLAYER_ANCHOR[1] : 340;

  // ---- Resolve trainer poses from existing combat state only ----
  var impactActive = !!(b.attackAt && frame >= b.attackAt && frame - b.attackAt < 16);
  var playerPose = BPS ? BPS.resolveTrainerPose("player", b.phase, b.feedback, impactActive) : "idle";
  var opponentPose = BPS ? BPS.resolveTrainerPose("opponent", b.phase, b.feedback, impactActive) : "idle";
  var oppH = GEO ? GEO.OPPONENT_VISIBLE_HEIGHT : 156;
  var plyH = GEO ? GEO.PLAYER_VISIBLE_HEIGHT : 172;
  var oppParams = BPS ? BPS.POSE_PARAMS[opponentPose] : null;
  var plyParams = BPS ? BPS.POSE_PARAMS[playerPose] : null;

  // Classic battles retain the original front-facing trainer identity. Directional overworld
  // frames remain locomotion-only; reusing the rear frame here made the selected character less
  // recognizable and diverged from the established battle presentation.
  // Follow semantic pose offsets so contact remains attached during challenge/command/hit states.
  // Opponent horizontal offsets are mirrored by drawTrainer; vertical offsets are not.
  var oppShadowX = oppX - (oppParams ? oppParams.dx : 0);
  var oppShadowY = oppBaseY + (oppParams ? oppParams.dy : 0);
  var plyShadowX = plyX + (plyParams ? plyParams.dx : 0);
  var plyShadowY = plyBaseY + (plyParams ? plyParams.dy : 0);
  drawBattleContactShadow(oppShadowX, oppShadowY, 46 * (oppParams ? oppParams.scaleX : 1), 0.24);
  drawBattleContactShadow(plyShadowX, plyShadowY, 54 * (plyParams ? plyParams.scaleX : 1), 0.3);
  // Resting trainers stay planted on their platforms. Action feedback still uses the
  // bounded semantic poses above, but there is no perpetual sine-wave bob at idle.
  drawTrainer(b.npc.slug, oppX, oppBaseY, oppH, 0, oppParams, true);
  drawTrainer(player.slug, plyX, plyBaseY, plyH, 0, plyParams, false);

  // Semantic cues are grounded at each authored platform rather than floating debug chevrons.
  if (BPS) {
    drawPoseSignal(plyX, plyBaseY - 5, "player", "#fbbf24", playerPose);
    drawPoseSignal(oppX, oppBaseY - 5, "opponent", typeColor, opponentPose);
  }

  // ---- Battlemon rendering: state derives from existing timestamps ----
  var monState = "idle-a";
  var monX = GEO ? GEO.BATTLEMON_CENTER_X : 495;
  var monY = GEO ? GEO.BATTLEMON_CENTER_Y : 170;
  var monSize = GEO ? GEO.BATTLEMON_DRAW_SIZE : 128;
  if (b.sendoutAt > 0 && b.phase !== "intro") {
    if (BPS) monState = BPS.resolveBattlemonState(b.phase, frame, b.attackAt, b.faintAt, reducedMotion);
    var presentationScale = 1;
    var monAlpha = 1;
    if (!reducedMotion) {
      var sendoutElapsed = frame - b.sendoutAt;
      if (b.phase === "sendout" && sendoutElapsed < 16) {
        presentationScale = Math.max(0.05, sendoutElapsed / 16);
      }
      if (monState === "idle-a" || monState === "idle-b") monY += Math.sin(frame / 13) * 3;
      if (monState === "attack") {
        var attackProgress = Math.max(0, Math.min(1, (frame - b.attackAt) / 16));
        monX -= Math.sin(attackProgress * Math.PI) * 80;
      }
      if (monState === "faint") {
        var faintElapsed = Math.max(0, frame - b.faintAt - 8);
        monY += faintElapsed * faintElapsed * 0.12;
        monAlpha = Math.max(0, 1 - faintElapsed / 28);
      }
    }
    var drawSize = monSize * presentationScale;
    if (monAlpha > 0) {
      var monGroundY = (GEO ? GEO.BATTLEMON_CENTER_Y : 170) + monSize * 0.44;
      drawBattleContactShadow(monX, monGroundY, 88 * presentationScale, 0.32 * monAlpha);
      ctx.globalAlpha = monAlpha;
      if (BPS && mon.domain && mon.id) {
        BPS.drawBattlemonFrame(ctx, mon.domain, mon.id, monState,
          px(monX - drawSize / 2), px(monY - drawSize / 2), drawSize, drawSize);
      } else {
        ctx.drawImage(monSpriteCv(mon.name, monColor),
          px(monX - drawSize / 2), px(monY - drawSize / 2), drawSize, drawSize);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Sendout poof particles are bounded and absent under reduced motion.
  if (reducedMotion) b.poof.length = 0;
  else {
    b.poof = b.poof.filter(function(particle) { particle.life -= dtF; return particle.life > 0; });
    for (var particleIndex = 0; particleIndex < b.poof.length; particleIndex++) {
      var particle = b.poof[particleIndex];
      particle.x += particle.vx * dtF; particle.y += particle.vy * dtF;
      ctx.globalAlpha = Math.min(1, particle.life / 16);
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(px(monX + particle.x), px(monY + particle.y), 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  // ---- Compact diegetic telemetry modules ----
  var oppPlate = GEO ? GEO.OPPONENT_PLATE : [18, 16, 310, 86];
  var oW = oppPlate[2] - oppPlate[0], oH = oppPlate[3] - oppPlate[1];
  ctx.fillStyle = "rgba(5,12,26,0.94)"; ctx.fillRect(oppPlate[0], oppPlate[1], oW, oH);
  ctx.fillStyle = typeColor; ctx.fillRect(oppPlate[0], oppPlate[1], oW, 4);
  ctx.strokeStyle = "rgba(226,232,240,0.62)"; ctx.lineWidth = 1; ctx.strokeRect(oppPlate[0], oppPlate[1], oW, oH);
  ctx.drawImage(pixelHead(b.npc.slug, 48), oppPlate[0] + 8, oppPlate[1] + 13, 44, 44);
  ctx.strokeStyle = typeColor; ctx.lineWidth = 2; ctx.strokeRect(oppPlate[0] + 8, oppPlate[1] + 13, 44, 44);
  var oTx = oppPlate[0] + 62, opponentName = displayName(b.npc.slug);
  ctx.fillStyle = "#f1f5f9"; ctx.font = "bold " + fitFont(opponentName, oW - 76, 14) + "px monospace"; ctx.textAlign = "left";
  ctx.fillText(opponentName, oTx, oppPlate[1] + 22);
  ctx.fillStyle = typeColor; ctx.font = "bold 10px monospace";
  ctx.fillText(b.npc.type + " // " + TYPE_NAMES[b.npc.type], oTx, oppPlate[1] + 39);
  ctx.fillStyle = "#b6c2d5"; ctx.font = "10px monospace";
  ctx.fillText(mon.name.toUpperCase() + "  Lv." + mon.level, oTx, oppPlate[1] + 56);
  for (var i = 0; i < b.mons.length; i++) {
    ctx.fillStyle = b.mons[i].alive ? typeColor : "#334155";
    ctx.fillRect(oppPlate[2] - 13 - (b.mons.length - i) * 11, oppPlate[1] + 63, 7, 3);
  }

  var plyPlate = GEO ? GEO.PLAYER_PLATE : [500, 340, 782, 412];
  var pW = plyPlate[2] - plyPlate[0], pH = plyPlate[3] - plyPlate[1];
  ctx.fillStyle = "rgba(5,12,26,0.94)"; ctx.fillRect(plyPlate[0], plyPlate[1], pW, pH);
  ctx.fillStyle = "#ef5e6a"; ctx.fillRect(plyPlate[0], plyPlate[1], pW, 4);
  ctx.strokeStyle = "rgba(226,232,240,0.62)"; ctx.lineWidth = 1; ctx.strokeRect(plyPlate[0], plyPlate[1], pW, pH);
  ctx.drawImage(pixelHead(player.slug, 48), plyPlate[0] + 8, plyPlate[1] + 14, 44, 44);
  ctx.strokeStyle = "#ef5e6a"; ctx.lineWidth = 2; ctx.strokeRect(plyPlate[0] + 8, plyPlate[1] + 14, 44, 44);
  var pTx = plyPlate[0] + 62;
  ctx.fillStyle = "#f1f5f9"; ctx.font = "bold 13px monospace"; ctx.textAlign = "left";
  ctx.fillText("YOU // " + firstName(player.slug).toUpperCase(), pTx, plyPlate[1] + 22);
  var maxHp = battleMaxHp(b);
  drawHPBar(pTx, plyPlate[1] + 32, 142, 10, Math.min(1, player.dispHp / maxHp));
  ctx.fillStyle = "#b6c2d5"; ctx.font = "10px monospace";
  ctx.fillText(Math.round(player.dispHp) + "/" + maxHp, pTx + 150, plyPlate[1] + 41);
  ctx.fillStyle = "#cbd5e1"; ctx.font = "bold 9px monospace";
  ctx.fillText("MISS -" + battleWrongDamage(b) + "  //  CORRECT +" + battleCorrectHeal(b) + " HP", pTx, plyPlate[1] + 59);

  // floating damage number
  if (b.dmgAt) {
    var dT = frame - b.dmgAt;
    if (dT < 45) {
      ctx.globalAlpha = Math.max(0, 1 - dT / 45);
      ctx.fillStyle = "#f87171"; ctx.font = "bold 22px monospace"; ctx.textAlign = "center";
      ctx.fillText("-" + battleWrongDamage(b), CANVAS_W - 240, 290 - dT * 1.1);
      ctx.globalAlpha = 1;
    }
  }

  // ---- text/question box (unchanged geometry below y=432) ----
  var layout = layoutChoices();
  var bx = layout.bx, by = layout.by, bw = layout.bw, bh = layout.bh;
  ctx.fillStyle = "rgba(15,23,42,0.95)";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 3; ctx.strokeRect(bx, by, bw, bh);

  if (b.phase === "question") {
    var q = mon.q;
    var qFont = "bold 14px monospace", lh = 17, qy = by + 22;
    var qLines = wrapTextMemo("[" + q.cat + "] " + q.q, bw - 110, qFont);
    if (qLines.length > 2) {
      qFont = "bold 12px monospace"; lh = 15; qy = by + 18;
      qLines = wrapTextMemo("[" + q.cat + "] " + q.q, bw - 110, qFont);
    }
    ctx.fillStyle = "#facc15"; ctx.font = qFont; ctx.textAlign = "left";
    qLines.slice(0, 3).forEach(function(ln, i) { ctx.fillText(ln, bx + 14, qy + i * lh); });
    for (var i = 0; i < 4; i++) {
      var cr = CHOICE_RECTS[i];
      var isSel = i === b.sel;
      ctx.fillStyle = isSel ? "#facc15" : "#1e293b";
      ctx.fillRect(cr[0], cr[1], cr[2], cr[3]);
      if (isSel) { ctx.strokeStyle = "#fde047"; ctx.lineWidth = 2; ctx.strokeRect(cr[0], cr[1], cr[2], cr[3]); }
      ctx.fillStyle = isSel ? "#0f172a" : "#e2e8f0";
      ctx.font = "13px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      var clines = wrapTextMemo((i + 1) + ". " + q.c[i], cr[2] - 20, "13px monospace");
      if (clines.length === 1) ctx.fillText(clines[0], cr[0] + 10, cr[1] + cr[3] / 2);
      else clines.slice(0, 2).forEach(function(ln, j) { ctx.fillText(ln, cr[0] + 10, cr[1] + cr[3] / 2 + (j - 0.5) * 15); });
      ctx.textBaseline = "alphabetic";
    }
    var rrx = RUN_RECT[0], rry = RUN_RECT[1], rrw = RUN_RECT[2], rrh = RUN_RECT[3];
    ctx.fillStyle = "#7f1d1d";
    ctx.fillRect(rrx, rry, rrw, rrh);
    ctx.strokeStyle = "#f87171"; ctx.lineWidth = 2; ctx.strokeRect(rrx, rry, rrw, rrh);
    ctx.fillStyle = "#fecaca"; ctx.font = "bold 13px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("RUN (R)", rrx + rrw / 2, rry + rrh / 2);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";

    if (difficulty === "hard") {
      var remMs = Math.max(0, b.timerMs);
      var secs = Math.ceil(remMs / 1000);
      var frac = Math.max(0, Math.min(1, remMs / battleTimerLimit(b)));
      var low = remMs < 10000;
      var barW = 220, barH = 12, tcx = CANVAS_W / 2, tby = by - 34;
      var col = low ? "#f87171" : "#facc15";
      ctx.fillStyle = col; ctx.font = "bold 16px monospace"; ctx.textAlign = "center";
      ctx.fillText("⏱ " + secs + "s", tcx, tby - 4);
      ctx.fillStyle = "#0f172a"; ctx.fillRect(tcx - barW / 2, tby + 4, barW, barH);
      ctx.fillStyle = col; ctx.fillRect(tcx - barW / 2, tby + 4, barW * frac, barH);
      ctx.strokeStyle = "#334155"; ctx.lineWidth = 1; ctx.strokeRect(tcx - barW / 2, tby + 4, barW, barH);
      ctx.textAlign = "left";
    }
  } else {
    var shown = Math.floor((frame - b.msgAt + 1) * TEXT_SPEED());
    if (!b._cachedMsgLines || b._cachedMsg !== b.msg) {
      b._cachedMsg = b.msg;
      b._cachedMsgLines = wrapTextMemo(b.msg, bw - 32, "bold 15px monospace");
    }
    ctx.fillStyle = b.phase === "win" || (b.phase === "feedback" && b.feedback && b.feedback.correct) ? "#22c55e"
      : (b.feedback && !b.feedback.correct && b.phase === "feedback") || b.phase === "lose" ? "#f87171" : "#e2e8f0";
    ctx.font = "bold 15px monospace"; ctx.textAlign = "left";
    typewriterSlice(b._cachedMsgLines, Math.max(0, shown)).slice(0, 5)
      .forEach(function(ln, i) { ctx.fillText(ln, bx + 16, by + 30 + i * 22); });
    if (shown >= b.msg.length && Math.floor(frame / 25) % 2 === 0) {
      ctx.fillStyle = "#94a3b8"; ctx.font = "12px monospace"; ctx.textAlign = "right";
      ctx.fillText("ENTER ▸", bx + bw - 14, by + bh - 12);
    }
  }

  // Full-canvas flashes are motion effects and disappear under reduced motion.
  if (!reducedMotion && b.attackAt) {
    var flashElapsed = frame - b.attackAt;
    if (flashElapsed < 14) {
      ctx.fillStyle = "rgba(239,68,68," + (0.32 * (1 - flashElapsed / 14)).toFixed(3) + ")";
      ctx.fillRect(-20, 0, CANVAS_W + 40, CANVAS_H);
    }
  }
  var entranceFlashElapsed = frame - b.startF;
  if (!reducedMotion && entranceFlashElapsed < 14) {
    ctx.fillStyle = "rgba(255,255,255," + (1 - entranceFlashElapsed / 14).toFixed(3) + ")";
    ctx.fillRect(-20, 0, CANVAS_W + 40, CANVAS_H);
  }
  ctx.restore();
}

// Grounded semantic cue: the authored platforms carry state instead of floating chevrons.
function drawPoseSignal(cx, cy, side, color, pose) {
  if (pose === "idle") return;
  var dir = side === "player" ? 1 : -1;
  ctx.fillStyle = pose === "hit" ? "#fb7185" : color;
  if (pose === "challenge" || pose === "command") {
    for (var i = 0; i < 3; i++) {
      var x = cx + dir * (25 + i * 10);
      ctx.fillRect(x - (dir < 0 ? 6 : 0), cy - i * 2, pose === "command" ? 7 : 5, 2);
    }
  } else if (pose === "win") {
    ctx.fillRect(cx - 12, cy - 13, 3, 13);
    ctx.fillRect(cx - 1, cy - 21, 3, 21);
    ctx.fillRect(cx + 10, cy - 13, 3, 13);
  } else if (pose === "loss") {
    ctx.fillRect(cx - 9, cy - 5, 18, 3);
  } else if (pose === "hit") {
    ctx.save(); ctx.translate(cx, cy - 5); ctx.rotate(-dir * 0.45);
    ctx.fillRect(-12, -2, 24, 4); ctx.restore();
  }
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

// ---------- Ops Comms portrait dialogue (#052) ----------
function dialogueHitGeometry() {
  if (!dialogueSession || typeof DatamonDialogueRuntime === "undefined") return null;
  var beat = DatamonDialogueRuntime.currentBeat(dialogueSession);
  if (!beat) return null;
  var right = beat.speaker.side === "right";
  var textX = right ? 24 : DIALOGUE_PANEL.textInset;
  var textW = right ? DIALOGUE_PANEL.rightX - 40 : CANVAS_W - textX - 24;
  var choiceRects = [];
  if (beat.choices && dialogueSession.phase === "choice") {
    for (var i = 0; i < beat.choices.length; i++) {
      choiceRects.push({ x: textX + 14, y: 486 + i * 34, w: textW - 28, h: 29, index: i });
    }
  }
  return {
    textX: textX, textW: textW,
    choices: choiceRects,
    advance: { x: textX + textW - 148, y: 541, w: 134, h: 28 },
    skip: dialogueStaging
      ? { x: CANVAS_W - 142, y: 116, w: 116, h: 28 }
      : { x: CANVAS_W - 122, y: 358, w: 98, h: 24 },
  };
}

function _drawCommandPortrait(speaker, x, y, size, accent) {
  ctx.save();
  ctx.fillStyle = "#07111f"; ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.strokeRect(x, y, size, size);
  if (speaker.slug) {
    ctx.drawImage(pixelHead(speaker.slug, size - 12), x + 6, y + 6, size - 12, size - 12);
  } else {
    var cx = x + size / 2, cy = y + size / 2;
    ctx.strokeStyle = accent; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, size * 0.31, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, size * 0.18, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = accent;
    for (var i = 0; i < 8; i++) {
      var angle = i * Math.PI / 4;
      ctx.fillRect(Math.round(cx + Math.cos(angle) * size * 0.36) - 3,
        Math.round(cy + Math.sin(angle) * size * 0.36) - 3, 6, 6);
    }
    ctx.font = "bold 13px monospace"; ctx.textAlign = "center";
    ctx.fillText("CC", cx, cy + 5);
  }
  // Consultant badge cut-corner and live-link indicator.
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 22, y); ctx.lineTo(x, y + 22); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#22c55e"; ctx.fillRect(x + size - 13, y + 7, 6, 6);
  ctx.restore();
}

function drawDialogue() {
  if (!dialogueSession || typeof DatamonDialogueRuntime === "undefined") return;
  var beat = DatamonDialogueRuntime.currentBeat(dialogueSession);
  if (!beat) return;
  var geometry = dialogueHitGeometry();
  var accent = TYPE_COLORS[beat.speaker.domain] || TYPE_COLORS.MIX || "#2dd4bf";
  var right = beat.speaker.side === "right";
  var portraitX = right ? DIALOGUE_PANEL.rightX : DIALOGUE_PANEL.leftX;
  var portraitY = 392;

  // The physical seated handoff is shown before the transcript panel so standing and
  // safe displacement remain visible even for chairs near the south edge.
  if (dialogueStaging) {
    var stageX = 178, stageY = 106, stageW = 438, stageH = 48;
    ctx.fillStyle = "rgba(5,13,26,0.94)"; ctx.fillRect(stageX, stageY, stageW, stageH);
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.strokeRect(stageX, stageY, stageW, stageH);
    ctx.fillStyle = accent; ctx.fillRect(stageX, stageY, 5, stageH);
    ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 11px monospace"; ctx.textAlign = "left";
    ctx.fillText("SEATED HANDOFF // " + beat.speaker.name.toUpperCase(), stageX + 16, stageY + 20);
    ctx.fillStyle = "#94a3b8"; ctx.font = "9px monospace";
    ctx.fillText("STANDING · FACING CANDIDATE · SAFE TILE LOCK", stageX + 16, stageY + 36);
    ctx.fillStyle = "#162235"; ctx.fillRect(stageX + 16, stageY + stageH - 5, stageW - 32, 2);
    ctx.fillStyle = accent; ctx.fillRect(stageX + 16, stageY + stageH - 5,
      (stageW - 32) * Math.max(0, Math.min(1, dialogueStaging.t)), 2);
    ctx.fillStyle = "#172033"; ctx.fillRect(geometry.skip.x, geometry.skip.y, geometry.skip.w, geometry.skip.h);
    ctx.strokeStyle = "#475569"; ctx.strokeRect(geometry.skip.x, geometry.skip.y, geometry.skip.w, geometry.skip.h);
    ctx.fillStyle = "#cbd5e1"; ctx.font = "bold 9px monospace"; ctx.textAlign = "center";
    ctx.fillText("CANCEL  ESC", geometry.skip.x + geometry.skip.w / 2, geometry.skip.y + 18);
    ctx.textAlign = "left";
    return;
  }

  // Frozen-world scrim + certification-command console.
  ctx.fillStyle = "rgba(2,6,23,0.52)"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = "rgba(5,13,26,0.98)";
  ctx.fillRect(12, DIALOGUE_PANEL.y, CANVAS_W - 24, DIALOGUE_PANEL.h);
  ctx.strokeStyle = "#334155"; ctx.lineWidth = 2;
  ctx.strokeRect(12, DIALOGUE_PANEL.y, CANVAS_W - 24, DIALOGUE_PANEL.h);
  ctx.fillStyle = accent; ctx.fillRect(12, DIALOGUE_PANEL.y, CANVAS_W - 24, 4);
  ctx.fillRect(right ? CANVAS_W - 18 : 12, DIALOGUE_PANEL.y, 6, DIALOGUE_PANEL.h);

  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#64748b"; ctx.font = "bold 9px monospace";
  ctx.fillText("OPS COMMS // " + dialogueSession.script.id.toUpperCase(), 26, 373);
  ctx.fillStyle = accent; ctx.font = "bold 13px monospace";
  ctx.fillText(beat.speaker.name.toUpperCase(), geometry.textX, 397);
  ctx.fillStyle = "#94a3b8"; ctx.font = "10px monospace";
  ctx.fillText((beat.speaker.domain || "MIX") + " CHANNEL  ·  " + (beat.speaker.expression || "NEUTRAL").toUpperCase(), geometry.textX, 413);
  _drawCommandPortrait(beat.speaker, portraitX, portraitY, DIALOGUE_PANEL.portrait, accent);

  // Transcript is wrapped from the complete line, then clipped by pure visibleChars.
  var lines = wrapTextMemo(beat.text, geometry.textW - 18, "bold 13px monospace");
  var visibleLines = typewriterSlice(lines, dialogueSession.visibleChars);
  ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 13px monospace";
  visibleLines.slice(0, 4).forEach(function(line, index) {
    ctx.fillText(line, geometry.textX, 439 + index * 18);
  });

  if (beat.choices && dialogueSession.phase === "choice") {
    geometry.choices.forEach(function(rect, index) {
      var selected = index === dialogueSession.choice;
      ctx.fillStyle = selected ? accent : "#162235";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = selected ? "#f8fafc" : "#334155"; ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = selected ? "#06111e" : "#cbd5e1";
      ctx.font = "bold 11px monospace";
      ctx.fillText((index + 1) + "  " + beat.choices[index].label, rect.x + 10, rect.y + 19);
    });
  } else if (dialogueSession.phase !== "typing") {
    ctx.fillStyle = accent; ctx.fillRect(geometry.advance.x, geometry.advance.y, geometry.advance.w, geometry.advance.h);
    ctx.fillStyle = "#06111e"; ctx.font = "bold 11px monospace"; ctx.textAlign = "center";
    ctx.fillText(dialogueSession.phase === "ready" ? "ENTER  CONTINUE" : "LINK COMPLETE", geometry.advance.x + geometry.advance.w / 2, geometry.advance.y + 18);
    ctx.textAlign = "left";
  } else {
    ctx.fillStyle = "#162235"; ctx.fillRect(geometry.advance.x, geometry.advance.y, geometry.advance.w, geometry.advance.h);
    ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.strokeRect(geometry.advance.x, geometry.advance.y, geometry.advance.w, geometry.advance.h);
    ctx.fillStyle = "#cbd5e1"; ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
    ctx.fillText("REVEAL  ENTER", geometry.advance.x + geometry.advance.w / 2, geometry.advance.y + 18);
    ctx.textAlign = "left";
  }

  // Pointer-accessible skip/close control.
  ctx.fillStyle = "#172033"; ctx.fillRect(geometry.skip.x, geometry.skip.y, geometry.skip.w, geometry.skip.h);
  ctx.strokeStyle = "#475569"; ctx.lineWidth = 1; ctx.strokeRect(geometry.skip.x, geometry.skip.y, geometry.skip.w, geometry.skip.h);
  ctx.fillStyle = "#cbd5e1"; ctx.font = "bold 9px monospace"; ctx.textAlign = "center";
  ctx.fillText(dialogueContext && dialogueContext.kind === "prologue" ? "SKIP  ESC" : "CLOSE  ESC", geometry.skip.x + geometry.skip.w / 2, geometry.skip.y + 16);
  ctx.textAlign = "left";

  ctx.fillStyle = "#64748b"; ctx.font = "9px monospace";
  ctx.fillText("ENTER/SPACE advance  ·  ↑↓ choose  ·  1–6 direct select  ·  ESC skip/close", 26, 580);
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
  // Advance the subtle seated idle at one frame/second (0.5 Hz full cycle).
  // Reduced motion pins frame zero in drawCharacter; the phase remains bounded.
  _sitAnimPhase += dtF;
  if (_sitAnimPhase >= SEATED_DRAW_GEOMETRY.phasePeriodTicks) {
    _sitAnimPhase %= SEATED_DRAW_GEOMETRY.phasePeriodTicks;
  }
  if (state === "overworld") updateOverworld(dt);
  if (state === "dialogue") updateDialogue();
  if (state === "transition" && battleTransition) {
    battleTransition.t += dtF;
    if (battleTransition.t >= 46) { startBattle(battleTransition.npc, !!battleTransition.portraitLed); battleTransition = null; }
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
  else if (state === "dialogue") { drawOverworld(); drawDialogue(); }
  else if (state === "transition") { drawOverworld(); drawTransition(); }
  else if (state === "battle") drawBattle();
  else if (state === "victory") drawVictory();
  else if (state === "search") { drawOverworld(); drawSearch(); }
  else if (state === "minigame") drawMinigame();
  if (state === "overworld") drawCoffeePrompt();
  if (state === "overworld") { if (bookPrompt) drawBookPrompt(); if (readerState) drawReader(); }
  drawToast();
  // Mentor review is the final visual layer; no stale toast or navigation chrome can cover it.
  if (state === "overworld" && mentorReview) drawMentorReview();

  requestAnimationFrame(loop);
}

// ---------- Boot ----------
ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 20px monospace"; ctx.textAlign = "center";
ctx.fillText("Loading the team...", CANVAS_W / 2, CANVAS_H / 2);
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
// Validate only the small taxonomy manifest at boot. No Battlemon PNG is requested until
// a classic encounter has selected its 1–3 immutable species IDs.
var battlePresentationManifestPromise = (typeof DatamonBattlePresentation !== "undefined")
  ? DatamonBattlePresentation.loadManifest() : Promise.resolve(null);
var battleArenaManifestPromise = (typeof DatamonBattleArena !== "undefined")
  ? DatamonBattleArena.loadManifest() : Promise.resolve(null);
// Prewarm only the saved player without delaying the title screen. A new run preloads its
// highlighted character when character select opens.
loadWalkAnim(getSave()?.player);
// Boot: load office assets + shared library assets (lib-door) but NOT full library.
// Full library assets load lazily on first warp.
Promise.all([
  loadImages(), loadTiles(), loadProps(), loadStudyProps(),
  loadWayfindingAssets(),
  hdOfficePromise,
  battlePresentationManifestPromise,
  battleArenaManifestPromise,
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
