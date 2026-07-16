import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("datamon/core.js", "utf8");

function loadHarness(hostname = "127.0.0.1") {
  const sandboxMath = Object.create(Math);
  const realNow = Date.now;
  const sandboxDate = { now: realNow };
  const sandbox = {
    window: { location: { hostname } },
    Math: sandboxMath,
    Date: sandboxDate,
    performance: { now: () => 123.5 },
    requestAnimationFrame: callback => setTimeout(() => callback(123.5), 0),
    setTimeout,
    Promise,
    Object,
    Number,
    Error,
  };
  vm.runInNewContext(source, sandbox, { filename: "datamon/core.js" });
  return { sandbox, api: sandbox.window.__DATAMON_TEST__ };
}

describe("production test seam", () => {
  it("activates only on loopback hostnames", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      assert.equal(loadHarness(host).api?.isActive(), true, host);
    }
    assert.equal(loadHarness("datamon.pages.dev").api, undefined);
    assert.equal(loadHarness("example.com").api, undefined);
  });

  it("uses the production seeded RNG deterministically", () => {
    const first = loadHarness();
    const second = loadHarness();
    first.api.seedRNG(20260610);
    second.api.seedRNG(20260610);
    const values1 = Array.from({ length: 5 }, () => first.sandbox.Math.random());
    const values2 = Array.from({ length: 5 }, () => second.sandbox.Math.random());
    assert.deepEqual(values1, values2);
    assert.deepEqual(values1, [
      0.13391056447289884,
      0.6825902590062469,
      0.03266079304739833,
      0.9960693805478513,
      0.8175179364625365,
    ]);
  });

  it("restores the original RNG", () => {
    const { sandbox, api } = loadHarness();
    const original = sandbox.Math.random;
    api.seedRNG(42);
    assert.notEqual(sandbox.Math.random, original);
    api.unseedRNG();
    assert.equal(sandbox.Math.random, original);
    assert.equal(api.getRNGState().seeded, false);
  });

  it("mocks wall-clock time without replacing performance.now", () => {
    const { sandbox, api } = loadHarness();
    const originalPerformanceNow = sandbox.performance.now;
    api.mockClock(1000);
    assert.equal(sandbox.Date.now(), 1000);
    assert.equal(api.advanceClock(250), 1250);
    assert.equal(sandbox.Date.now(), 1250);
    assert.equal(sandbox.performance.now, originalPerformanceNow);
    api.unmockClock();
    assert.equal(api.getClockState().mocked, false);
  });

  it("rejects clock advancement when no mock is active", () => {
    const { api } = loadHarness();
    assert.throws(() => api.advanceClock(1), /not mocked/);
  });
});
