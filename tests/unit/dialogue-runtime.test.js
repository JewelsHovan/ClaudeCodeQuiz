import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync("datamon/dialogue-runtime.js", "utf8");
function load() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "datamon/dialogue-runtime.js" });
  return sandbox.window.DatamonDialogueRuntime;
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

const script = {
  id: "probe",
  startBeat: "hello",
  skipEffects: [{ type: "CLOSE_DIALOGUE" }],
  beats: {
    hello: {
      id: "hello", speaker: { name: "Mentor", slug: "mentor", side: "left", domain: "AGENT" },
      text: "Welcome to the field run.", next: "choice",
    },
    choice: {
      id: "choice", speaker: { name: "Candidate", slug: "candidate", side: "right", domain: "MIX" },
      text: "Choose a response.", choices: [
        { label: "Accept", next: "done" },
        { label: "Decline", effects: [{ type: "CLOSE_DIALOGUE" }] },
      ],
    },
    done: {
      id: "done", speaker: { name: "Mentor", slug: "mentor", side: "left", domain: "AGENT" },
      text: "Begin.", effects: [{ type: "START_BATTLE" }], next: null,
    },
  },
};

test("validates and deep-freezes a complete script", () => {
  const api = load(), normalized = api.validateScript(script);
  assert.ok(normalized);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.beats.hello.speaker), true);
  assert.equal(normalized.beats.choice.choices.length, 2);
  assert.equal(api.validateScript({ id: "bad", startBeat: "missing", beats: {} }), null);
  const badEffect = structuredClone(script); badEffect.beats.done.effects = [{ type: "ARBITRARY_MUTATION" }];
  assert.equal(api.validateScript(badEffect), null);
  const badLink = structuredClone(script); badLink.beats.hello.next = "missing";
  assert.equal(api.validateScript(badLink), null);
});

test("two-stage activation fast-forwards then advances without mutating the script", () => {
  const api = load(), original = structuredClone(script);
  let state = api.createSession(script);
  assert.equal(state.phase, "typing");
  let result = api.reduce(state, { type: "ACTIVATE", token: "key-1" });
  state = result.state;
  assert.equal(state.phase, "ready");
  assert.equal(state.visibleChars, script.beats.hello.text.length);
  assert.deepEqual(plain(result.effects), []);
  result = api.reduce(state, { type: "ACTIVATE", token: "key-2" });
  state = result.state;
  assert.equal(state.beatId, "choice");
  assert.equal(state.phase, "typing");
  assert.deepEqual(script, original);
});

test("tick, choices, effects, replay tokens, and skip are deterministic", () => {
  const api = load();
  let state = api.createSession(script);
  let result = api.reduce(state, { type: "TICK", amount: 4 });
  assert.equal(result.state.visibleChars, 4);
  state = api.reduce(result.state, { type: "ACTIVATE", token: "a" }).state;
  state = api.reduce(state, { type: "ACTIVATE", token: "b" }).state;
  state = api.reduce(state, { type: "ACTIVATE", token: "c" }).state; // reveal choice text
  assert.equal(state.phase, "choice");
  state = api.reduce(state, { type: "MOVE_CHOICE", direction: 1, token: "d" }).state;
  assert.equal(state.choice, 1);
  const declined = api.reduce(state, { type: "ACTIVATE", token: "e" });
  assert.equal(declined.state.completed, true);
  assert.deepEqual(plain(declined.effects), [{ type: "CLOSE_DIALOGUE" }]);
  const replay = api.reduce(declined.state, { type: "ACTIVATE", token: "e" });
  assert.equal(replay.state, declined.state);
  assert.deepEqual(plain(replay.effects), []);

  const skipped = api.reduce(api.createSession(script), { type: "SKIP", token: "escape" });
  assert.equal(skipped.state.completed, true);
  assert.deepEqual(plain(skipped.effects), [{ type: "CLOSE_DIALOGUE" }]);
  assert.deepEqual(plain(api.reduce(api.createSession(script), { type: "TICK", amount: 1, reducedMotion: true }).state).visibleChars,
    script.beats.hello.text.length);
});

test("accepted choice reaches one terminal battle effect and consumed history is bounded", () => {
  const api = load();
  let state = api.createSession(script), seq = 0;
  function activate() { const r = api.reduce(state, { type: "ACTIVATE", token: `t${seq++}` }); state = r.state; return r; }
  activate(); activate(); activate(); // hello reveal/advance, choice reveal
  let selected = api.reduce(state, { type: "CHOOSE", index: 0, token: `t${seq++}` }); state = selected.state;
  assert.equal(state.beatId, "done");
  activate();
  const terminal = activate();
  assert.equal(terminal.state.completed, true);
  assert.deepEqual(plain(terminal.effects), [{ type: "START_BATTLE" }]);

  let many = api.createSession(script);
  many = api.reduce(many, { type: "ACTIVATE", token: "reveal" }).state;
  many = api.reduce(many, { type: "ACTIVATE", token: "advance" }).state;
  many = api.reduce(many, { type: "ACTIVATE", token: "choice-reveal" }).state;
  for (let i = 0; i < 100; i++) many = api.reduce(many, { type: "MOVE_CHOICE", direction: 1, token: `m${i}` }).state;
  assert.equal(many.consumedTokens.length, api.MAX_CONSUMED_TOKENS);
  const saturated = many;
  assert.equal(api.reduce(many, { type: "MOVE_CHOICE", direction: 1, token: "m0" }).state, saturated);
  assert.equal(api.reduce(many, { type: "MOVE_CHOICE", direction: 1, token: "brand-new" }).state, saturated);
});

test("invalid interaction events are exact no-ops", () => {
  const api = load(), state = api.createSession(script);
  for (const event of [null, { type: "UNKNOWN", token: "x" }, { type: "CHOOSE", index: 9, token: "x" },
    { type: "MOVE_CHOICE", direction: 1, token: "x" }, { type: "ACTIVATE" }]) {
    const result = api.reduce(state, event);
    assert.equal(result.state, state);
    assert.deepEqual(plain(result.effects), []);
    assert.equal(result.consumed, false);
  }
});

test("malformed sessions fail closed without throwing", () => {
  const api = load(), valid = api.createSession(script);
  for (const malformed of [
    { ...valid, consumedTokens: null },
    { ...valid, visibleChars: NaN },
    { ...valid, choice: 0.5 },
    { ...valid, phase: "arbitrary" },
    { ...valid, phase: "choice" },
  ]) {
    const result = api.reduce(malformed, { type: "ACTIVATE", token: "bad" });
    assert.equal(result.state, malformed);
    assert.equal(result.consumed, false);
    assert.deepEqual(plain(result.effects), []);
  }
  const choiceState = api.reduce(api.reduce(api.reduce(valid,
    { type: "ACTIVATE", token: "r1" }).state,
    { type: "ACTIVATE", token: "r2" }).state,
    { type: "ACTIVATE", token: "r3" }).state;
  assert.equal(choiceState.phase, "choice");
  for (const direction of [0, -2, 2, "1", null]) {
    assert.equal(api.reduce(choiceState, { type: "MOVE_CHOICE", direction, token: `bad-${direction}` }).state, choiceState);
  }
});

test("stand displacement prefers away, then orthogonal cells, then no-motion fallback", () => {
  const api = load(), player = { x: 10, y: 11 }, npc = { x: 10, y: 10 };
  assert.deepEqual(plain(api.chooseStandDisplacement(player, npc, (x, y) => x === 10 && y === 12)), { x: 10, y: 12, moved: true });
  assert.deepEqual(plain(api.chooseStandDisplacement(player, npc, (x, y) => x === 11 && y === 11)), { x: 11, y: 11, moved: true });
  assert.deepEqual(plain(api.chooseStandDisplacement(player, npc, () => false)), { x: 10, y: 11, moved: false });
  assert.deepEqual(plain(api.chooseStandDisplacement({ x: 12, y: 11 }, npc, (x, y) => x === 13 && y === 11)), { x: 13, y: 11, moved: true });
  assert.equal(api.chooseStandDisplacement({ x: 1.5, y: 2 }, npc, () => true), null);
  assert.equal(api.chooseStandDisplacement(null, npc, () => true), null);
});
