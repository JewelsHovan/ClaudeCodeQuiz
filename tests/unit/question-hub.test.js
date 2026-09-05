import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = { window: {} };
vm.createContext(context);
for (const file of ['questions', 'progress', 'world-layout']) vm.runInContext(fs.readFileSync(`datamon/${file}.js`, 'utf8'), context);
const bank = vm.runInContext('QUESTION_BANK', context);
const progress = context.window.DatamonProgress;
const layout = context.window.DatamonWorldLayout;

describe('Question Hub projections', () => {
  it('indexes all 120 canonical questions, never aliases or MIX duplicates', () => {
    const rows = progress.questionCatalog(bank, { 'AGENT:0': { wrong: 999 } }, 0, []);
    assert.equal(rows.length, 120);
    assert.equal(new Set(rows.map(r => r.question.id)).size, 120);
    assert.equal(rows.filter(r => r.missed).length, 0);
    assert(rows.every(r => r.unattempted));
  });
  it('keeps missed history distinct from due and never claims latest-answer mastery', () => {
    const stats = {
      'agent-001': { seen: 3, correct: 2, wrong: 1, lastSeen: 20 },
      'agent-002': { seen: 1, correct: 0, wrong: 1, lastSeen: 19 },
      'agent-003': { seen: 1, correct: 1, wrong: 0, lastSeen: 1 },
      'agent-004': { seen: 1, correct: 0, wrong: 0, lastSeen: 20 },
      'agent-005': { seen: NaN, correct: -9, wrong: Infinity },
    };
    const before = JSON.stringify(stats);
    const rows = progress.questionCatalog(bank, stats, 20, []);
    assert.equal(rows.filter(r => r.missed).length, 2);
    assert.equal(rows[0].due, false);
    assert.equal(rows[1].due, true);
    assert.equal(rows[2].due, true);
    assert.equal(rows[3].unattempted, true);
    assert.equal(rows[4].wrong, 0);
    assert.equal(JSON.stringify(stats), before);
  });
  it('projects actual shared domain colleagues separately from mixed-topic colleagues', () => {
    const people = [{ slug: 'teacher', type: 'MCP', defeated: true }, { slug: 'generalist', type: 'MIX' }, { slug: 'other', type: 'AGENT' }];
    const before = JSON.stringify(people);
    const row = progress.questionCatalog(bank, {}, 0, people).find(r => r.domain === 'MCP');
    assert.equal(row.colleagues.map(n => n.slug).join(','), 'teacher');
    assert.equal(row.generalists.map(n => n.slug).join(','), 'generalist');
    assert.equal(JSON.stringify(people), before);
  });
});

describe('Walking directions', () => {
  it('finds a shortest walkable approach without entering a solid or occupied target', () => {
    const blocked = new Set(['2,1', '2,2', '2,3', '4,2']);
    const route = layout.routeToInteraction({ x: 0, y: 2 }, { x: 4, y: 2 }, 5, 5, (x,y) => !blocked.has(`${x},${y}`));
    assert.equal(route.length, 8);
    assert(route.every(p => !blocked.has(`${p.x},${p.y}`)));
    assert.equal(Math.abs(route.at(-1).x - 4) + Math.abs(route.at(-1).y - 2), 1);
  });
  it('returns one cell when already adjacent and null for unreachable or invalid targets', () => {
    assert.equal(layout.routeToInteraction({x:1,y:1}, {x:1,y:2}, 3,3, () => true).length, 1);
    assert.equal(layout.routeToInteraction({x:0,y:0}, {x:2,y:2}, 3,3, () => false), null);
    assert.equal(layout.routeToInteraction({x:0,y:0}, {x:-1,y:2}, 3,3, () => true), null);
  });
});
