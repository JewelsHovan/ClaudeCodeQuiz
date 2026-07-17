import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync("datamon/world-layout.js", "utf8");

function load() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "datamon/world-layout.js" });
  return sandbox.window.DatamonWorldLayout;
}

const DOMAINS = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT", "MIX"];

function people(perDomain = 6) {
  return DOMAINS.flatMap(domain => Array.from({ length: perDomain }, (_, index) => ({
    slug: `${domain.toLowerCase()}-${index}`,
    domain,
  })));
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test("semantic office anchors cover every domain and multiple activity micro-zones", () => {
  const api = load();
  assert.deepEqual(plain(api.DOMAINS), DOMAINS);
  for (const domain of DOMAINS) {
    const anchors = plain(api.officeAnchors(domain));
    assert.ok(anchors.length >= 8, `${domain} anchor capacity`);
    assert.ok(new Set(anchors.map(point => point.zone)).size >= 3, `${domain} micro-zones`);
    assert.ok(anchors.every(point => Number.isInteger(point.x) && Number.isInteger(point.y)));
  }
  assert.deepEqual(plain(api.officeAnchors("INVALID")), []);
});

test("office allocation is complete, deterministic, unique, and density bounded", () => {
  const api = load(), roster = people();
  const first = plain(api.allocateOffice({ people: roster, isValid: () => true, seed: 42 }));
  const second = plain(api.allocateOffice({ people: roster, isValid: () => true, seed: 42 }));
  assert.deepEqual(first, second);
  assert.equal(first.complete, true);
  assert.equal(first.requested, 36);
  assert.equal(first.placements.length, 36);
  assert.equal(new Set(first.placements.map(point => `${point.x},${point.y}`)).size, 36);
  assert.deepEqual(roster, people(), "input records remain immutable");

  for (const domain of DOMAINS) {
    const placed = first.placements.filter(point => point.domain === domain);
    assert.equal(placed.length, 6);
    assert.ok(new Set(placed.map(point => point.zone)).size >= 2, `${domain} uses multiple micro-zones`);
  }
  const maxNearby = Math.max(...first.placements.map(point => first.placements.filter(other =>
    other !== point && Math.abs(other.x - point.x) + Math.abs(other.y - point.y) <= 3
  ).length));
  assert.ok(maxNearby <= 2, `local radius-3 density was ${maxNearby}`);
});

test("invalid semantic anchors fail over to declared valid region capacity", () => {
  const api = load();
  const roster = [{ slug: "a", domain: "AGENT" }, { slug: "b", domain: "AGENT" }];
  const fallbackByDomain = {
    AGENT: [
      { x: 100, y: 100, zone: "fallback-west", source: "fallback" },
      { x: 110, y: 100, zone: "fallback-east", source: "fallback" },
    ],
  };
  const result = plain(api.allocateOffice({
    people: roster,
    fallbackByDomain,
    isValid: (x, y) => x >= 100,
    seed: 7,
  }));
  assert.equal(result.complete, true);
  assert.equal(result.placements.length, 2);
  assert.ok(result.placements.every(point => point.source === "fallback" && point.x >= 100));
  assert.equal(new Set(result.placements.map(point => point.zone)).size, 2);
});

test("Battle Room slots fit 36 rivals, preserve the entry lane, and return defensive copies", () => {
  const api = load();
  const first = plain(api.battleRoomSlots());
  assert.equal(first.length, 36);
  assert.equal(new Set(first.map(point => `${point.x},${point.y}`)).size, 36);
  assert.ok(first.every(point => point.x > 0 && point.x < 35 && point.y > 0 && point.y < 23));
  assert.ok(first.every(point => !(point.x >= 17 && point.x <= 19 && point.y >= 9)), "south-centre lane clear");
  assert.ok(first.filter(point => point.y >= 11).length >= 20, "entry camera has nearby rivals");
  first[0].x = 999;
  assert.notEqual(plain(api.battleRoomSlots())[0].x, 999);
});
