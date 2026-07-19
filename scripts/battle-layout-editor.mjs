import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const DATAMON = path.join(ROOT, "datamon");
const SOURCE = path.join(DATAMON, "battle-presentation.js");
const EDITOR = path.join(SCRIPT_DIR, "battle-layout-editor.html");
const DRAFT = path.join(ROOT, ".claude-plans", "battle-layout-draft.json");

function integer(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function parseGeometrySource(source) {
  if (typeof source !== "string") throw new TypeError("battle presentation source must be text");
  function pair(name) {
    const match = source.match(new RegExp(`${name}:\\s*Object\\.freeze\\(\\[(-?\\d+),\\s*(-?\\d+)\\]\\)`));
    if (!match) throw new Error(`Unable to read ${name} from battle-presentation.js`);
    return [Number(match[1]), Number(match[2])];
  }
  function scalar(name) {
    const match = source.match(new RegExp(`${name}:\\s*(-?\\d+)`));
    if (!match) throw new Error(`Unable to read ${name} from battle-presentation.js`);
    return Number(match[1]);
  }
  return Object.freeze({
    PLAYER_ANCHOR: Object.freeze(pair("PLAYER_ANCHOR")),
    OPPONENT_ANCHOR: Object.freeze(pair("OPPONENT_ANCHOR")),
    BATTLEMON_CENTER: Object.freeze([scalar("BATTLEMON_CENTER_X"), scalar("BATTLEMON_CENTER_Y")]),
  });
}

export function normalizeLayout(value) {
  const geometry = value && typeof value === "object" && value.geometry;
  const player = geometry && geometry.PLAYER_ANCHOR;
  const opponent = geometry && geometry.OPPONENT_ANCHOR;
  const battlemon = geometry && geometry.BATTLEMON_CENTER;
  const pairValid = pair => Array.isArray(pair) && pair.length === 2 &&
    integer(pair[0], -128, 928) && integer(pair[1], -128, 560);
  if (!pairValid(player) || !pairValid(opponent) || !pairValid(battlemon)) return null;
  const preview = value.preview && typeof value.preview === "object" ? value.preview : {};
  const domain = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT"].includes(preview.domain)
    ? preview.domain : "PROMPT";
  const phase = ["sendout", "question"].includes(preview.phase) ? preview.phase : "sendout";
  return {
    schemaVersion: 1,
    source: "datamon-battle-layout-editor",
    geometry: {
      PLAYER_ANCHOR: player.slice(),
      OPPONENT_ANCHOR: opponent.slice(),
      BATTLEMON_CENTER: battlemon.slice(),
    },
    preview: { domain, phase },
  };
}

function json(response, status, value) {
  const body = JSON.stringify(value, null, 2) + "\n";
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendFile(response, file, contentType) {
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { response.writeHead(404); response.end("Not found\n"); return; }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(response);
  });
}

function safeAsset(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname.slice("/asset/".length)); } catch { return null; }
  const file = path.resolve(DATAMON, decoded);
  if (!file.startsWith(DATAMON + path.sep) || path.extname(file).toLowerCase() !== ".png") return null;
  return file;
}

export function createLayoutServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      sendFile(response, EDITOR, "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/asset/")) {
      const file = safeAsset(url.pathname);
      if (!file) { response.writeHead(404); response.end("Not found\n"); return; }
      sendFile(response, file, "image/png");
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/config") {
      try {
        const current = parseGeometrySource(fs.readFileSync(SOURCE, "utf8"));
        let draft = null;
        if (fs.existsSync(DRAFT)) {
          try { draft = normalizeLayout(JSON.parse(fs.readFileSync(DRAFT, "utf8"))); } catch { draft = null; }
        }
        json(response, 200, { current, draft, saveFile: path.relative(ROOT, DRAFT) });
      } catch (error) {
        json(response, 500, { error: error.message });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/layout") {
      let body = "", rejected = false;
      request.setEncoding("utf8");
      request.on("data", chunk => {
        body += chunk;
        if (body.length > 16384) { rejected = true; request.destroy(); }
      });
      request.on("end", () => {
        if (rejected) return;
        let normalized;
        try { normalized = normalizeLayout(JSON.parse(body)); } catch { normalized = null; }
        if (!normalized) { json(response, 400, { error: "Invalid layout" }); return; }
        const saved = { ...normalized, savedAt: new Date().toISOString() };
        fs.mkdirSync(path.dirname(DRAFT), { recursive: true });
        const temporary = `${DRAFT}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(saved, null, 2) + "\n", { mode: 0o600 });
        fs.renameSync(temporary, DRAFT);
        json(response, 200, { ok: true, file: path.relative(ROOT, DRAFT), layout: saved });
      });
      return;
    }
    response.writeHead(404); response.end("Not found\n");
  });
}

async function main() {
  const requested = Number(process.env.DATAMON_LAYOUT_PORT || process.argv.find(arg => arg.startsWith("--port="))?.slice(7) || 8765);
  const port = integer(requested, 1024, 65535) ? requested : 8765;
  const server = createLayoutServer();
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`DATAMON battle layout editor: ${url}`);
    console.log(`Save target: ${path.relative(ROOT, DRAFT)}`);
    if (!process.argv.includes("--no-open")) {
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
      const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
      const child = spawn(opener, args, { detached: true, stdio: "ignore" });
      child.unref();
    }
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
