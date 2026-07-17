// ============================================================
// DATAMON deterministic world layout — pure placement helpers.
// Keeps semantic office staging and Battle Room slots separate
// from rendering, saves, collision, and learning telemetry.
// Classic script (no ESM). Exposes window.DatamonWorldLayout.
// ============================================================

"use strict";

(function () {
  var API = {};
  var DOMAINS = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT", "MIX"];

  // Hand-authored activity anchors use existing walkable office cells. The renderer still
  // validates every point against the current map, seats, doors, player safety radius, and
  // Certification Spine mask before allocation. Multiple named micro-zones keep colleagues
  // distributed between plausible work and social positions instead of clustering around the
  // first furniture-adjacent cells.
  var OFFICE_ANCHORS = {
    AGENT: [
      [3, 3, "lounge"], [3, 5, "lounge"], [3, 7, "lounge"], [5, 8, "lounge"],
      [8, 2, "media"], [9, 4, "media"], [9, 7, "media"],
      [6, 3, "focus"], [10, 8, "focus"],
    ],
    MCP: [
      [14, 2, "north-bench"], [16, 2, "north-bench"], [19, 2, "north-bench"], [21, 2, "north-bench"],
      [14, 5, "tool-studio"], [16, 6, "tool-studio"], [21, 5, "tool-studio"], [22, 7, "tool-studio"],
      [14, 8, "review"], [16, 9, "review"], [20, 8, "review"], [22, 9, "review"],
    ],
    CONFIG: [
      [26, 2, "prep"], [28, 2, "prep"], [30, 2, "prep"], [32, 4, "prep"],
      [26, 5, "counter"], [27, 6, "counter"], [31, 6, "counter"], [33, 5, "counter"],
      [26, 8, "standup"], [29, 8, "standup"], [32, 8, "standup"], [34, 6, "standup"],
    ],
    CONTEXT: [
      [2, 16, "huddle"], [5, 16, "huddle"], [7, 17, "huddle"],
      [2, 20, "table"], [5, 20, "table"], [7, 20, "table"],
      [2, 22, "quiet"], [5, 22, "quiet"],
    ],
    PROMPT: [
      [13, 14, "north-desk"], [16, 14, "north-desk"], [20, 14, "north-desk"], [22, 14, "north-desk"],
      [13, 17, "workbench"], [16, 17, "workbench"], [22, 17, "workbench"],
      [13, 18, "review"], [16, 18, "review"], [22, 18, "review"],
      [13, 20, "review"], [16, 20, "review"], [22, 20, "review"],
    ],
    MIX: [
      [25, 14, "lounge"], [28, 14, "lounge"], [32, 14, "lounge"], [34, 14, "lounge"],
      [25, 16, "workbench"], [28, 16, "workbench"], [33, 16, "workbench"],
      [25, 18, "review"], [29, 18, "review"], [33, 18, "review"],
      [25, 20, "review"], [29, 20, "review"], [33, 20, "review"],
    ],
  };

  function freezeAnchors() {
    Object.keys(OFFICE_ANCHORS).forEach(function (domain) {
      OFFICE_ANCHORS[domain] = Object.freeze(OFFICE_ANCHORS[domain].map(function (point) {
        return Object.freeze({ x: point[0], y: point[1], zone: point[2], source: "anchor" });
      }));
    });
    Object.freeze(OFFICE_ANCHORS);
  }
  freezeAnchors();

  function stableHash(value) {
    var h = 2166136261;
    var text = String(value || "");
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function normalizeCandidate(candidate, fallbackZone) {
    if (!candidate || !Number.isInteger(candidate.x) || !Number.isInteger(candidate.y)) return null;
    return {
      x: candidate.x,
      y: candidate.y,
      zone: typeof candidate.zone === "string" && candidate.zone ? candidate.zone : fallbackZone,
      source: candidate.source === "anchor" ? "anchor" : "fallback",
    };
  }

  function uniqueCandidates(list, fallbackZone) {
    var seen = Object.create(null), result = [];
    (list || []).forEach(function (candidate) {
      var point = normalizeCandidate(candidate, fallbackZone);
      if (!point) return;
      var key = point.x + "," + point.y;
      if (seen[key]) return;
      seen[key] = true;
      result.push(point);
    });
    return result;
  }

  function candidateRank(candidate, person, placed, zoneUse, seed, relaxed) {
    var near = 0;
    var nearest = 999;
    for (var i = 0; i < placed.length; i++) {
      var distance = manhattan(candidate, placed[i]);
      if (distance <= 3) near++;
      if (distance < nearest) nearest = distance;
    }
    if (!placed.length) nearest = 999;
    // Prefer low local density, then reviewed anchors and under-used activity zones. Wide
    // spacing breaks later ties; generic region cells remain capacity-only fallbacks.
    return {
      allowed: relaxed || near < 2,
      zoneUse: zoneUse[candidate.zone] || 0,
      near: near,
      nearest: nearest,
      anchor: candidate.source === "anchor" ? 1 : 0,
      tie: stableHash(seed + "|" + person.slug + "|" + candidate.x + "," + candidate.y),
    };
  }

  function betterRank(a, b) {
    if (!b) return true;
    if (a.allowed !== b.allowed) return a.allowed;
    if (a.near !== b.near) return a.near < b.near;
    if (a.anchor !== b.anchor) return a.anchor > b.anchor;
    if (a.zoneUse !== b.zoneUse) return a.zoneUse < b.zoneUse;
    if (a.nearest !== b.nearest) return a.nearest > b.nearest;
    return a.tie < b.tie;
  }

  // Allocate [{slug, domain}] records to valid unique office cells. isValid is supplied by
  // game.js so this pure module never owns collision or reachability. Generic region cells are
  // accepted only as deterministic capacity fallbacks when reviewed semantic anchors are full.
  API.allocateOffice = function (options) {
    options = options || {};
    var people = Array.isArray(options.people) ? options.people : [];
    var isValid = typeof options.isValid === "function" ? options.isValid : function () { return true; };
    var fallbackByDomain = options.fallbackByDomain || {};
    var seed = Number.isInteger(options.seed) ? options.seed : 20260717;
    var occupied = Object.create(null), placed = [], zoneUse = Object.create(null), placements = [];

    for (var domainIndex = 0; domainIndex < DOMAINS.length; domainIndex++) {
      var domain = DOMAINS[domainIndex];
      var domainZoneUse = Object.create(null);
      var domainPeople = people.filter(function (person) { return person && person.domain === domain; });
      var pool = uniqueCandidates(
        OFFICE_ANCHORS[domain].concat(uniqueCandidates(fallbackByDomain[domain], "fallback-" + domain.toLowerCase())),
        "fallback-" + domain.toLowerCase()
      );

      for (var personIndex = 0; personIndex < domainPeople.length; personIndex++) {
        var person = domainPeople[personIndex], best = null, bestRank = null;
        for (var pass = 0; pass < 2 && !best; pass++) {
          var relaxed = pass === 1;
          for (var candidateIndex = 0; candidateIndex < pool.length; candidateIndex++) {
            var candidate = pool[candidateIndex];
            var key = candidate.x + "," + candidate.y;
            if (occupied[key] || !isValid(candidate.x, candidate.y, person)) continue;
            var rank = candidateRank(candidate, person, placed, domainZoneUse, seed, relaxed);
            if (!rank.allowed || !betterRank(rank, bestRank)) continue;
            best = candidate; bestRank = rank;
          }
        }
        if (!best) continue;
        var bestKey = best.x + "," + best.y;
        occupied[bestKey] = true;
        domainZoneUse[best.zone] = (domainZoneUse[best.zone] || 0) + 1;
        zoneUse[domain + ":" + best.zone] = domainZoneUse[best.zone];
        var placement = {
          slug: person.slug,
          domain: person.domain,
          x: best.x,
          y: best.y,
          zone: best.zone,
          source: best.source,
        };
        placements.push(placement);
        placed.push(placement);
      }
    }

    return {
      placements: placements,
      complete: placements.length === people.length,
      requested: people.length,
      zoneUse: Object.assign({}, zoneUse),
    };
  };

  // Thirty-six reviewed training positions. The north/perimeter rows preserve a league-ring
  // silhouette, while three nearer sparring rows put colleagues inside the entry camera. The
  // x=17..19 south-to-centre lane remains clear from the return door.
  var BATTLE_ROOM_SLOTS = Object.freeze([
    [4,19],[7,19],[10,19],[13,19],[23,19],[26,19],[29,19],[32,19],
    [6,15],[10,15],[14,15],[22,15],[26,15],[30,15],
    [8,11],[12,11],[16,11],[20,11],[24,11],[28,11],
    [3,4],[3,7],[3,10],[3,13],[3,16],
    [32,4],[32,7],[32,10],[32,13],[32,16],
    [6,3],[11,3],[16,3],[20,3],[25,3],[30,3],
  ].map(function (slot) { return Object.freeze({ x: slot[0], y: slot[1] }); }));

  API.battleRoomSlots = function () {
    return BATTLE_ROOM_SLOTS.map(function (slot) { return { x: slot.x, y: slot.y }; });
  };
  API.officeAnchors = function (domain) {
    return OFFICE_ANCHORS[domain] ? OFFICE_ANCHORS[domain].map(function (point) {
      return { x: point.x, y: point.y, zone: point.zone, source: point.source };
    }) : [];
  };
  API.DOMAINS = Object.freeze(DOMAINS.slice());

  window.DatamonWorldLayout = API;
})();
