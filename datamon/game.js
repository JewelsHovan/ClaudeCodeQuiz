// ============================================================
// DATAMON — a data & AI consulting firm's pokemon-like.
// CLAUDE CODE FOUNDATIONS EDITION: walk the office, battle
// colleagues, answer Claude Certified Architect Foundations
// exam questions to win. Headshots from headshots/ are
// pixelated at runtime to make the sprites.
// ============================================================

"use strict";

// ---------- Roster (matches headshots/ and sprites/) ----------
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
const SOLID = new Set(["#", "D", "P", "C"]);
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
const MAX_HP = 100, WRONG_DMG = 25;
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
// Legend: # wall, . floor, D desk, P plant, C coffee machine, ~ rug
const DOORS = [[9, 5], [18, 5], [27, 5], [4, 10], [13, 10], [22, 10], [31, 10]];

function buildMap() {
  const g = Array.from({ length: MAP_H }, () => Array(MAP_W).fill("."));
  for (let x = 0; x < MAP_W; x++) { g[0][x] = "#"; g[MAP_H - 1][x] = "#"; }
  for (let y = 0; y < MAP_H; y++) { g[y][0] = "#"; g[y][MAP_W - 1] = "#"; }
  // interior walls: three verticals splitting the top into 4 rooms, one horizontal
  for (let y = 1; y < 10; y++) { g[y][9] = "#"; g[y][18] = "#"; g[y][27] = "#"; }
  for (let x = 1; x < MAP_W - 1; x++) g[10][x] = "#";
  for (const [dx, dy] of DOORS) g[dy][dx] = ".";

  // desk clusters per room
  const desks = [
    [2, 3], [3, 3], [6, 3], [7, 3], [2, 7], [3, 7], [6, 7], [7, 7],          // Agent Wing
    [11, 3], [12, 3], [15, 3], [16, 3], [11, 7], [12, 7], [15, 7], [16, 7],  // MCP Lab
    [20, 3], [21, 3], [24, 3], [25, 3], [20, 7], [21, 7], [24, 7], [25, 7],  // Config Bay
    [29, 3], [30, 3], [33, 3], [29, 7], [30, 7], [33, 7],                    // Prompt Studio
  ];
  for (const [x, y] of desks) g[y][x] = "D";

  // plants
  for (const [x, y] of [[1, 1], [11, 1], [13, 1], [24, 1], [26, 1], [34, 1],
                        [1, 12], [34, 12], [1, 22 - 1], [34, 21], [10, 15], [27, 15]]) g[y][x] = "P";

  // lounge rug
  for (let y = 14; y <= 18; y++) for (let x = 14; x <= 21; x++) g[y][x] = "~";

  // coffee machines (interact to heal)
  g[21][2] = "C"; g[21][33] = "C";
  return g;
}

function regionOf(x, y) {
  if (y < 10) { if (x < 9) return "AGENT"; if (x < 18) return "MCP"; if (x < 27) return "CONFIG"; return "PROMPT"; }
  return x < 18 ? "CONTEXT" : "MIX";
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
  move: () => {},
  select: () => beep(880, 0.06),
  confirm: () => { beep(660, 0.07); beep(990, 0.09, "square", 0.04, 0.07); },
  correct: () => { beep(523, 0.09); beep(659, 0.09, "square", 0.04, 0.09); beep(784, 0.14, "square", 0.04, 0.18); },
  wrong: () => { beep(220, 0.18, "sawtooth"); beep(160, 0.22, "sawtooth", 0.04, 0.12); },
  battle: () => { [392, 392, 392, 311].forEach((f, i) => beep(f, 0.12, "square", 0.05, i * 0.13)); },
  victory: () => { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.15, "square", 0.05, i * 0.14)); },
};

// ---------- Image loading & pixelation ----------
const headshots = {};   // slug -> HTMLImageElement (or null on error)
const sprites = {};     // slug -> generated pixel-art trainer sprite (or null)
const pixelCache = {};  // slug+size -> canvas
const miniCache = {};   // slug+size -> downscaled sprite canvas

function loadOne(src, store, slug) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { store[slug] = img; resolve(); };
    img.onerror = () => { store[slug] = null; resolve(); };
    img.src = src;
  });
}

function loadImages() {
  return Promise.all(ROSTER.flatMap(slug => [
    loadOne(`headshots/${slug}.png`, headshots, slug),
    loadOne(`sprites/${slug}.png`, sprites, slug),
  ]));
}

// Smooth-downscaled square version of the trainer sprite for small sizes
// (NN-downscaling 256px art to ~30px gets noisy; averaging keeps it readable).
function spriteMini(slug, size) {
  const key = slug + ":" + size;
  if (miniCache[key]) return miniCache[key];
  const img = sprites[slug];
  if (!img) return null;
  const cv = document.createElement("canvas");
  cv.width = size; cv.height = size;
  const c = cv.getContext("2d");
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  c.drawImage(img, 0, 0, size, size);
  miniCache[key] = cv;
  return cv;
}

// Square-crop the headshot, downscale to n x n with no smoothing = pixel art.
function pixelHead(slug, n) {
  const key = slug + ":" + n;
  if (pixelCache[key]) return pixelCache[key];
  const img = headshots[slug];
  const cv = document.createElement("canvas");
  cv.width = n; cv.height = n;
  const c = cv.getContext("2d");
  if (img) {
    const s = Math.min(img.width, img.height);
    const sx = (img.width - s) / 2;
    const sy = (img.height - s) * 0.15; // bias crop toward the top (faces)
    c.imageSmoothingEnabled = false;
    c.drawImage(img, sx, sy, s, s, 0, 0, n, n);
  } else {
    // fallback: colored tile with initials
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
const scale = Math.min(2, window.devicePixelRatio || 1);
canvas.width  = CANVAS_W * scale;
canvas.height = CANVAS_H * scale;
ctx.setTransform(scale, 0, 0, scale, 0, 0);
ctx.imageSmoothingEnabled = false; // must follow resize — resize resets all context state

let map = buildMap();
let state = "title";    // title | select | overworld | battle | victory
let selectIdx = 0;
let player = { slug: null, x: 18, y: 16, fx: 18, fy: 16, dir: "down", moving: false, hp: MAX_HP, dispHp: MAX_HP };
let battleTransition = null;   // {npc, t} — flash + iris wipe into battle
let npcs = [];          // {slug, x, y, type, defeated}
let defeated = new Set();
let battle = null;
let toast = null;       // {msg, until}
let decks = {};         // category -> shuffled question indices not yet used
let frame = 0;
let dtF = 1;           // logical 60Hz frames this tick
let mapCv = null;   // pre-rendered static map — built once at boot
let battleGrad = null; // battle backdrop gradient — built once at boot
const wrapCache = new Map(); // font|maxW|text -> wrapped lines

// ---------- NPC placement ----------
function placeNPCs() {
  const rng = mulberry32(20260610);
  const others = ROSTER.filter(s => s !== player.slug);
  const regions = { AGENT: [], MCP: [], CONFIG: [], PROMPT: [], CONTEXT: [], MIX: [] };
  for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
    if (SOLID.has(map[y][x])) continue;
    if (DOORS.some(([dx, dy]) => Math.abs(dx - x) + Math.abs(dy - y) <= 1)) continue;
    if (Math.abs(x - player.x) + Math.abs(y - player.y) <= 2) continue;
    regions[regionOf(x, y)].push([x, y]);
  }
  const order = shuffled(others, rng);
  const perRegion = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT", "MIX"];
  npcs = [];
  order.forEach((slug, i) => {
    const type = perRegion[i % 6];
    const spots = shuffled(regions[type], rng);
    const spot = spots.find(([x, y]) =>
      !npcs.some(n => Math.abs(n.x - x) + Math.abs(n.y - y) < 3));
    if (spot) {
      npcs.push({ slug, x: spot[0], y: spot[1], type, defeated: defeated.has(slug) });
      regions[type] = regions[type].filter(([x, y]) => x !== spot[0] || y !== spot[1]);
    }
  });
}

// ---------- Save / load ----------
let saveCache; // undefined = not yet read; null = confirmed empty save
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ player: player.slug, defeated: [...defeated] }));
  } catch (e) {}
  saveCache = undefined;
}
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && ROSTER.includes(s.player)) return s;
  } catch (e) {}
  return null;
}
function getSave() {
  if (saveCache === undefined) saveCache = loadSave();
  return saveCache;
}

// ---------- Questions ----------
function drawQuestion(category) {
  const cat = category === "MIX" ? weightedDomain() : category;
  if (!decks[cat] || decks[cat].length === 0) {
    decks[cat] = shuffled(QUESTION_BANK[cat].map((_, i) => i), mulberry32(Math.floor(Math.random() * 1e9)));
  }
  const idx = decks[cat].pop();
  return { ...QUESTION_BANK[cat][idx], cat };
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
  const level = 5 + defeated.size * 2;
  battle = {
    npc,
    mons: [0, 1].map(i => ({ name: monPool[i % monPool.length], level: level + i, q: null, alive: true })),
    idx: 0,
    phase: "intro",                 // intro | sendout | question | feedback | win | lose
    msg: `${displayName(npc.slug)} ${BATTLE_INTROS[Math.floor(Math.random() * BATTLE_INTROS.length)]}`,
    sel: 0,
    feedback: null,
    shake: 0,
    startF: frame,                  // entrance slide / white flash
    msgAt: frame,                   // typewriter anchor
    sendoutAt: 0,                   // mon scale-in + poof anchor
    faintAt: 0,                     // mon faint (fall + fade) anchor
    attackAt: 0,                    // mon lunge + red flash anchor
    dmgAt: 0,                       // floating damage number anchor
    poof: [],
  };
  wrapCache.clear();
  state = "battle";
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

function advanceBattle() {
  const b = battle;
  if (b.phase === "intro") {
    sendOutCurrentMon(b);
  } else if (b.phase === "sendout") {
    currentMon().q = drawQuestion(b.npc.type);
    b.phase = "question";
    b.sel = 0;
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
    }
  } else if (b.phase === "win") {
    b.npc.defeated = true;
    defeated.add(b.npc.slug);
    save();
    wrapCache.clear();
    battle = null;
    if (npcs.every(n => n.defeated)) { state = "victory"; sfx.victory(); }
    else { state = "overworld"; bufferedDir = null; turnStartMs = null; }
  } else if (b.phase === "lose") {
    wrapCache.clear();
    battle = null;
    player.hp = MAX_HP;
    player.x = player.fx = 18; player.y = player.fy = 16;
    state = "overworld"; bufferedDir = null; turnStartMs = null;
    showToast("You respawned in the lounge with a fresh coffee. HP restored!");
  }
}

function answerQuestion(i) {
  const b = battle, q = currentMon().q;
  const correct = i === q.a;
  if (correct) {
    sfx.correct();
    b.feedback = { correct: true };
    b.msg = `Correct! ${currentMon().name.toUpperCase()} fainted!` + (q.x ? ` (${q.x})` : "");
    b.faintAt = frame;
  } else {
    sfx.wrong();
    player.hp = Math.max(0, player.hp - WRONG_DMG);
    b.shake = 14;
    b.feedback = { correct: false };
    b.msg = `Wrong! It was "${q.c[q.a]}". ${q.x || ""} ${currentMon().name.toUpperCase()} hits you for ${WRONG_DMG}!`;
    b.attackAt = frame;
    b.dmgAt = frame;
  }
  b.msgAt = frame;
  b.phase = "feedback";
}

// ---------- Toast ----------
function showToast(msg, ms = 2600) { toast = { msg, until: performance.now() + ms }; }

// ---------- Input ----------
const keys = {};
window.addEventListener("keydown", e => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
  keys[e.key] = true;
  if (state === "overworld" && player.moving && KEY_DIR[e.key]) bufferedDir = KEY_DIR[e.key];
  handleKey(e.key);
});
window.addEventListener("keyup", e => { keys[e.key] = false; });

function handleKey(k) {
  if (k === "m" || k === "M") { muted = !muted; showToast(muted ? "Muted" : "Sound on"); return; }

  if (state === "title") {
    if (k === "Enter" || k === " ") {
      sfx.confirm();
      const s = getSave();
      if (s) {
        player.slug = s.player;
        defeated = new Set(s.defeated);
        placeNPCs();
        if (npcs.every(n => n.defeated)) { state = "victory"; }
        else { state = "overworld"; bufferedDir = null; turnStartMs = null; }
      } else state = "select";
    }
    if (k === "r" || k === "R") {
      localStorage.removeItem(SAVE_KEY);
      saveCache = undefined;
      defeated = new Set();
      showToast("Save cleared!");
    }
  } else if (state === "select") {
    const cols = SEL.cols;
    if (k === "ArrowRight") setSelect(Math.min(ROSTER.length - 1, selectIdx + 1));
    if (k === "ArrowLeft")  setSelect(Math.max(0, selectIdx - 1));
    if (k === "ArrowDown")  setSelect(Math.min(ROSTER.length - 1, selectIdx + cols));
    if (k === "ArrowUp")    setSelect(Math.max(0, selectIdx - cols));
    if (k === "Enter" || k === " ") {
      sfx.confirm();
      player.slug = ROSTER[selectIdx];
      defeated = new Set();
      player.hp = MAX_HP;
      placeNPCs();
      save();
      state = "overworld"; bufferedDir = null; turnStartMs = null;
      showToast("Beat every colleague to become a Claude Certified Architect!", 3500);
    }
  } else if (state === "overworld") {
    if (k === " " || k === "Enter" || k === "e" || k === "E") interact();
  } else if (state === "battle") {
    const b = battle;
    if (b.phase === "question") {
      if (k === "ArrowRight" || k === "ArrowDown") { b.sel = (b.sel + 1) % 4; sfx.select(); }
      if (k === "ArrowLeft" || k === "ArrowUp")    { b.sel = (b.sel + 3) % 4; sfx.select(); }
      if (["1", "2", "3", "4"].includes(k)) answerQuestion(parseInt(k) - 1);
      if (k === "Enter" || k === " ") answerQuestion(b.sel);
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
  }
}

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * (CANVAS_W / r.width),
          (e.clientY - r.top) * (CANVAS_H / r.height)];
}

canvas.addEventListener("mousemove", e => {
  if (state !== "select") return;
  const [mx, my] = canvasPos(e);
  const hit = selectHitTest(mx, my);
  if (hit >= 0) setSelect(hit, true); // hover browses silently
});

canvas.addEventListener("click", e => {
  const [mx, my] = canvasPos(e);
  if (state === "title") handleKey("Enter");
  else if (state === "select") {
    const hit = selectHitTest(mx, my);
    if (hit >= 0) { setSelect(hit, true); handleKey("Enter"); }
  } else if (state === "battle") {
    const b = battle;
    if (b.phase === "question") {
      const hit = choiceHitTest(mx, my);
      if (hit >= 0) answerQuestion(hit);
    } else handleKey("Enter");
  } else if (state === "victory") handleKey("Enter");
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
    else { battleTransition = { npc, t: 0 }; state = "transition"; sfx.battle(); }
    return;
  }
  if (map[ty] && map[ty][tx] === "C") {
    player.hp = MAX_HP;
    sfx.confirm();
    showToast("You brewed a fresh coffee. HP fully restored!");
  }
  if (map[ty] && map[ty][tx] === "D") showToast("A standing desk. Someone left 47 Chrome tabs open.");
  if (map[ty] && map[ty][tx] === "P") showToast("An office plant. It has seen things.");
}

const TAP_TURN_MS = 80;
const KEY_DIR = { ArrowUp: "up", w: "up", ArrowDown: "down", s: "down",
                  ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right" };
let turnStartMs = null;  // wall-clock when tap-to-turn window opened; null when closed
let bufferedDir = null;  // direction pressed mid-slide; consumed at slide end
function updateOverworld(dt) {
  const speed = 7.5; // tiles/sec
  if (player.moving) {
    const dx = player.x - player.fx, dy = player.y - player.fy;
    const dist = Math.hypot(dx, dy), step = speed * dt;
    if (dist <= step) {
      player.fx = player.x; player.fy = player.y; player.moving = false;
      if (bufferedDir) consumeBuffered();
    } else { player.fx += (dx / dist) * step; player.fy += (dy / dist) * step; }
    return;
  }
  let dir = null;
  if (keys["ArrowUp"] || keys["w"]) dir = "up";
  else if (keys["ArrowDown"] || keys["s"]) dir = "down";
  else if (keys["ArrowLeft"] || keys["a"]) dir = "left";
  else if (keys["ArrowRight"] || keys["d"]) dir = "right";
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
  if (walkable(nx, ny)) { player.x = nx; player.y = ny; player.moving = true; }
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

function drawCharacter(cx, cy, slug, dir, isPlayer, bob) {
  const yOff = bob ? Math.sin(frame / 12) * 1.5 : 0;
  const mini = spriteMini(slug, 34);
  if (mini) {
    // full-body pixel trainer sprite, feet anchored to tile bottom
    ctx.drawImage(mini, px(cx - 17), px(cy - 18 + yOff), 34, 34);
    return;
  }
  // fallback: simple body + pixelated headshot
  const bodyColor = isPlayer ? "#ef4444" : "#475569";
  const headSize = 20;
  ctx.fillStyle = bodyColor;
  ctx.fillRect(px(cx - 7), px(cy + 2 + yOff), 14, 10);
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(px(cx - 6), px(cy + 12 + yOff), 5, 4);
  ctx.fillRect(px(cx + 1), px(cy + 12 + yOff), 5, 4);
  ctx.drawImage(pixelHead(slug, 16), px(cx - headSize / 2), px(cy - headSize + 4 + yOff), headSize, headSize);
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
    ctx.drawImage(pixelHead(slug, 32), px(cx - s / 2), px(baseY - s + yOff), s, s);
  }
}

// ---------- Scenes ----------
function drawTitle() {
  ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // marching trainer parade
  const n = ROSTER.length;
  for (let i = 0; i < n; i++) {
    const x = ((i * 90 + frame * 0.8) % (CANVAS_W + 80)) - 40;
    const y = 440 + Math.sin((frame + i * 30) / 20) * 8;
    const mini = spriteMini(ROSTER[i], 64);
    if (mini) ctx.drawImage(mini, px(x), px(y), 64, 64);
    else ctx.drawImage(pixelHead(ROSTER[i], 24), px(x), px(y + 8), 48, 48);
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#facc15"; ctx.font = "bold 72px monospace";
  ctx.fillText("DATAMON", CANVAS_W / 2, 180);
  ctx.fillStyle = "#94a3b8"; ctx.font = "bold 20px monospace";
  ctx.fillText("Gotta Cert 'Em All — Claude Code Foundations Edition", CANVAS_W / 2, 220);
  ctx.fillStyle = "#e2e8f0"; ctx.font = "16px monospace";
  if (Math.floor(frame / 30) % 2 === 0)
    ctx.fillText(getSave() ? "Press ENTER to continue your run" : "Press ENTER to start", CANVAS_W / 2, 320);
  ctx.fillStyle = "#64748b"; ctx.font = "13px monospace";
  ctx.fillText("Arrows/WASD move · SPACE interact · 1-4 answer · M mute" + (getSave() ? " · R reset save" : ""), CANVAS_W / 2, 560);
}

// --- Character select: grid left, animated showcase panel right ---
const SEL = { cols: 6, cell: 74, ox: 26, oy: 104 };
const PANEL = { x: 488, y: 96, w: 286, h: 462 };
let selChangedAt = -999; // frame when selection last changed (drives animations)

function setSelect(i, silent) {
  if (i === selectIdx) return;
  selectIdx = i;
  selChangedAt = frame;
  if (!silent) sfx.select();
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
    else ctx.drawImage(pixelHead(ROSTER[i], 28), x, y - lift, size, size);
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
  else ctx.drawImage(pixelHead(ROSTER[selectIdx], 32), px(cx - 70 + slide), px(baseY - 150 + bob), 140, 140);
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

  ctx.fillStyle = "#64748b"; ctx.font = "13px monospace"; ctx.textAlign = "center";
  ctx.fillText("Arrows or mouse to browse · ENTER / click to pick — everyone else becomes a rival!",
    CANVAS_W / 2, CANVAS_H - 20);
}

function tileColor(t, x, y) {
  switch (t) {
    case "#": return "#334155";
    case "~": return (x + y) % 2 ? "#7c3aed" : "#6d28d9";
    default:  return (x + y) % 2 ? "#cbd5e1" : "#c2cad6";
  }
}

function buildMapCanvas() {
  const cv = document.createElement("canvas");
  cv.width  = MAP_W * TILE;   // 1152
  cv.height = MAP_H * TILE;   // 768
  const c = cv.getContext("2d");
  c.imageSmoothingEnabled = false;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const sx = x * TILE, sy = y * TILE;
      const t = map[y][x];
      c.fillStyle = tileColor(t, x, y);
      c.fillRect(sx, sy, TILE, TILE);
      if (t === "#") {
        c.fillStyle = "#1e293b"; c.fillRect(sx, sy + TILE - 6, TILE, 6);
      } else if (t === "D") {
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
  }
  return cv;
}

function drawOverworld() {
  const camX = Math.max(0, Math.min(MAP_W - VIEW_W, player.fx - VIEW_W / 2 + 0.5));
  const camY = Math.max(0, Math.min(MAP_H - VIEW_H, player.fy - VIEW_H / 2 + 0.5));

  // 9-arg drawImage: source rect from the pre-rendered map, dest = full canvas.
  // Source offset -Math.round(-cam*TILE) reproduces the old per-tile
  // px((x-camX)*TILE) rounding EXACTLY (JS rounds half toward +Inf, so
  // Math.round(cam*TILE) alone would differ by 1px at exact half-pixel values).
  ctx.drawImage(mapCv,
    -Math.round(-camX * TILE), -Math.round(-camY * TILE), CANVAS_W, CANVAS_H,
    0, 0, CANVAS_W, CANVAS_H);

  // room labels
  ctx.font = "bold 14px monospace"; ctx.textAlign = "center";
  const labels = [["AGENT WING", 4.5, 5.6], ["MCP LAB", 13.5, 5.6], ["CONFIG BAY", 22.5, 5.6], ["PROMPT STUDIO", 30.5, 5.6],
                  ["CONTEXT CORNER", 8, 13], ["THE LOUNGE", 26, 13]];
  for (const [txt, lx, ly] of labels) {
    const sx = (lx - camX) * TILE, sy = (ly - camY) * TILE;
    ctx.fillStyle = "rgba(15,23,42,0.45)";
    ctx.fillText(txt, px(sx), px(sy));
  }

  // NPCs
  for (const n of npcs) {
    const sx = (n.x - camX) * TILE + TILE / 2, sy = (n.y - camY) * TILE + TILE / 2;
    if (sx < -TILE || sx > CANVAS_W + TILE || sy < -TILE || sy > CANVAS_H + TILE) continue;
    drawCharacter(sx, sy, n.slug, "down", false, !n.defeated);
    if (n.defeated) {
      ctx.fillStyle = "#22c55e"; ctx.font = "bold 14px monospace"; ctx.textAlign = "center";
      ctx.fillText("✓", px(sx + 12), px(sy - 14));
    } else {
      ctx.fillStyle = TYPE_COLORS[n.type]; ctx.font = "bold 12px monospace"; ctx.textAlign = "center";
      ctx.fillText("!", px(sx), px(sy - 18 + Math.sin(frame / 10) * 2));
    }
  }

  // player
  drawCharacter((player.fx - camX) * TILE + TILE / 2, (player.fy - camY) * TILE + TILE / 2,
    player.slug, player.dir, true, player.moving);

  // HUD
  ctx.fillStyle = "rgba(15,23,42,0.85)";
  ctx.fillRect(8, 8, 250, 64);
  ctx.drawImage(pixelHead(player.slug, 20), 16, 16, 40, 40);
  drawHPBar(66, 38, 140, 10, player.dispHp / MAX_HP, firstName(player.slug) + "  HP " + player.hp + "/" + MAX_HP);
  ctx.fillStyle = "#94a3b8"; ctx.font = "12px monospace"; ctx.textAlign = "left";
  ctx.fillText(`Rivals bested: ${defeated.size}/${npcs.length}`, 66, 62);

  // facing hint
  const [tx, ty] = facingTile();
  const target = npcs.find(n => n.x === tx && n.y === ty && !n.defeated);
  if (target) {
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
const CHOICE_RECTS = [];
function layoutChoices() {
  CHOICE_RECTS.length = 0;
  const bx = 24, by = CANVAS_H - 176, bw = CANVAS_W - 48, bh = 160;
  const cw = (bw - 36) / 2, ch = 42;
  for (let i = 0; i < 4; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    CHOICE_RECTS.push([bx + 12 + col * (cw + 12), by + 58 + row * (ch + 8), cw, ch]);
  }
  return { bx, by, bw, bh };
}
function choiceHitTest(mx, my) {
  for (let i = 0; i < CHOICE_RECTS.length; i++) {
    const [x, y, w, h] = CHOICE_RECTS[i];
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) return i;
  }
  return -1;
}

function drawBattle() {
  const b = battle;
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
  ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 16px monospace"; ctx.textAlign = "left";
  ctx.fillText(displayName(b.npc.slug), 50, 60);
  ctx.fillStyle = typeColor; ctx.font = "bold 12px monospace";
  ctx.fillText(`${b.npc.type} TRAINER · ${TYPE_NAMES[b.npc.type]}`, 50, 78);
  ctx.fillStyle = "#94a3b8"; ctx.font = "12px monospace";
  ctx.fillText(`${mon.name.toUpperCase()} Lv.${mon.level}`, 50, 98);
  for (let i = 0; i < b.mons.length; i++) {
    ctx.fillStyle = b.mons[i].alive ? typeColor : "#334155";
    ctx.beginPath(); ctx.arc(350 - (b.mons.length - 1 - i) * 16, 92, 5, 0, 7); ctx.fill();
  }

  // player info plate (HP bar drains smoothly via dispHp)
  ctx.fillStyle = "rgba(15,23,42,0.9)";
  ctx.fillRect(CANVAS_W - 366, 300, 330, 70);
  ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2; ctx.strokeRect(CANVAS_W - 366, 300, 330, 70);
  ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 15px monospace"; ctx.textAlign = "left";
  ctx.fillText("YOU (" + firstName(player.slug) + ")", CANVAS_W - 352, 324);
  drawHPBar(CANVAS_W - 352, 340, 220, 12, player.dispHp / MAX_HP);
  ctx.fillStyle = "#94a3b8"; ctx.font = "12px monospace";
  ctx.fillText(Math.round(player.dispHp) + "/" + MAX_HP, CANVAS_W - 120, 351);

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
    let qLines = wrapTextMemo(`[${q.cat}] ${q.q}`, bw - 32, qFont);
    if (qLines.length > 2) {
      qFont = "bold 12px monospace"; lh = 15; qy = by + 18;
      qLines = wrapTextMemo(`[${q.cat}] ${q.q}`, bw - 32, qFont);
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
    else ctx.drawImage(pixelHead(n.slug, 20), px(x - 18), px(y), 36, 36);
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

// ---------- Main loop ----------
let lastT = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  dtF = dt * 60;
  frame += dtF;
  if (state === "overworld") updateOverworld(dt);
  if (state === "transition" && battleTransition) {
    battleTransition.t += dtF;
    if (battleTransition.t >= 46) { startBattle(battleTransition.npc); battleTransition = null; }
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
  drawToast();

  requestAnimationFrame(loop);
}

// ---------- Boot ----------
ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 20px monospace"; ctx.textAlign = "center";
ctx.fillText("Loading the team...", CANVAS_W / 2, CANVAS_H / 2);
mapCv = buildMapCanvas();
battleGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
battleGrad.addColorStop(0, "#1e293b");
battleGrad.addColorStop(1, "#0f172a");
loadImages().then(() => requestAnimationFrame(loop));
