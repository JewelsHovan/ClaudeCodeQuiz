import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyMetadata } from "../../.agents/skills/datamon-deploy/scripts/verify-metadata.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILL = path.join(ROOT, ".agents/skills/datamon-deploy");
const COMMIT = "a".repeat(40);
const LOCAL = {
  schemaVersion: 1, branch: "main", commit: COMMIT, clean: true,
  payloadSha256: "b".repeat(64), fileCount: 42, totalBytes: 12345,
};
const response = (metadata = LOCAL, status = 200, type = "application/json") =>
  new Response(JSON.stringify(metadata), { status, headers: { "content-type": type } });
const verify = (overrides = {}) => verifyMetadata({
  target: "https://datamon.pages.dev/", expectedCommit: COMMIT, local: LOCAL,
  fetchImpl: async () => response(), ...overrides,
});

// These are document-contract checks, not a claim of model obedience or release acceptance.
test("project skill is discoverable with bounded standard frontmatter", () => {
  const markdown = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, "SKILL.md frontmatter required");
  const name = frontmatter[1].match(/^name: (.+)$/m)?.[1];
  const description = frontmatter[1].match(/^description: (.+)$/m)?.[1];
  assert.equal(name, path.basename(SKILL));
  assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(name.length <= 64);
  assert.ok(description?.length > 0 && description.length <= 1024);
  assert.doesNotMatch(frontmatter[1], /disable-model-invocation:\s*true/);
});

test("skill references resolve within the repository from their owning document", () => {
  let links = 0;
  for (const relative of ["SKILL.md", "references/operations.md", "references/evaluation.md"]) {
    const file = path.join(SKILL, relative);
    const markdown = fs.readFileSync(file, "utf8");
    for (const [, link] of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      assert.doesNotMatch(link, /^(?:[a-z]+:|\/)/i, "Use local, relative owner references");
      const target = path.resolve(path.dirname(file), link.split("#")[0]);
      assert.ok(target.startsWith(`${ROOT}${path.sep}`), `Reference escapes project: ${link}`);
      assert.ok(fs.statSync(target).isFile(), `Missing reference: ${link}`);
      links++;
    }
  }
  assert.ok(links >= 10, "Keep links to canonical gates rather than copying their implementation");
});

test("documented recipes and evaluator evidence still have repository owners", () => {
  const justfile = fs.readFileSync(path.join(ROOT, "justfile"), "utf8");
  for (const recipe of ["bootstrap", "check", "deploy", "preview", "rollback", "remote-smoke"]) {
    assert.match(justfile, new RegExp(`^${recipe}(?: [^\\n:]+)?:[^\\n]*$`, "m"));
  }
  const evaluation = fs.readFileSync(path.join(SKILL, "references/evaluation.md"), "utf8");
  for (const [owner, output] of [
    ["eval-locomotion.mjs", "ledger.json"],
    ["perf-baseline.mjs", "performance.json"],
    ["perf-worlds.mjs", "world-performance.json"],
  ]) {
    assert.ok(justfile.includes(`node scripts/${owner}`));
    assert.ok(evaluation.includes(output));
    assert.ok(fs.readFileSync(path.join(ROOT, "scripts", owner), "utf8").includes(`"${output}"`));
  }
});

test("CLI fails closed with usage even when invoked outside the repository", () => {
  const result = spawnSync(process.execPath, [path.join(SKILL, "scripts/verify-metadata.mjs")], {
    cwd: os.tmpdir(), encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: node verify-metadata.mjs/);
  assert.equal(result.stdout, "");
});

test("CLI resolves dist from the skill location, not cwd, with network stubbed", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "datamon release-"));
  try {
    const script = path.join(fixture, ".agents/skills/datamon-deploy/scripts/verify-metadata.mjs");
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync(path.join(SKILL, "scripts/verify-metadata.mjs"), script);
    fs.mkdirSync(path.join(fixture, "dist"));
    fs.writeFileSync(path.join(fixture, "dist/artifact-metadata.json"), JSON.stringify(LOCAL));
    const stub = path.join(fixture, "fetch-stub.mjs");
    fs.writeFileSync(stub, `globalThis.fetch = async () => new Response(${JSON.stringify(JSON.stringify(LOCAL))},
      { headers: { "content-type": "application/json; charset=utf-8" } });\n`);
    const result = spawnSync(process.execPath, ["--import", stub, script, "https://datamon.pages.dev/", COMMIT], {
      cwd: os.tmpdir(), encoding: "utf8", timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Public metadata matches checked artifact/);
    assert.ok(result.stdout.includes(LOCAL.payloadSha256));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("metadata verification binds an unauthenticated bounded request to local identity", async () => {
  let requests = 0;
  const receipt = await verify({ fetchImpl: async (url, options) => {
    requests++;
    assert.equal(url.origin, "https://datamon.pages.dev");
    assert.equal(url.pathname, "/artifact-metadata.json");
    assert.equal(url.searchParams.get("artifact"), LOCAL.payloadSha256);
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers, undefined, "No token or cookie headers");
    return response({ ...LOCAL, packagedAt: "a different packaging time is immaterial" });
  } });
  assert.equal(requests, 1);
  assert.deepEqual(receipt, { target: "https://datamon.pages.dev/", ...LOCAL });
});

test("preview and immutable deployment metadata are accepted only with matching identity", async () => {
  const preview = { ...LOCAL, branch: "dev" };
  for (const target of ["https://dev.datamon.pages.dev/", "https://c69f4c38.datamon.pages.dev/"]) {
    await verify({ target, local: preview, fetchImpl: async () => response(preview) });
  }
  await assert.rejects(verify({ target: "https://dev.datamon.pages.dev/" }), /target alias/);
  await assert.rejects(verify({ local: preview }), /target alias/);
});

test("unsafe destinations are rejected before any network access", async () => {
  for (const target of [
    "http://datamon.pages.dev/", "https://elsewhere.pages.dev/", "https://datamon.pages.dev.evil.test/",
    "https://user:secret@datamon.pages.dev/", "https://datamon.pages.dev:8443/",
    "https://datamon.pages.dev/path", "https://datamon.pages.dev/?token=secret",
    "https://datamon.pages.dev/#fragment", "http://127.0.0.1/",
  ]) {
    await assert.rejects(verify({ target, fetchImpl: async () => assert.fail("Unexpected network access") }),
      /HTTPS Datamon Pages root URL/);
  }
});

test("unverified local identity is rejected before any network access", async () => {
  for (const [overrides, error] of [
    [{ expectedCommit: "short" }, /full checked Git commit/],
    [{ local: null }, /Missing checked local metadata/],
    [{ local: { ...LOCAL, schemaVersion: 2 } }, /schema/],
    [{ local: { ...LOCAL, branch: "feature" } }, /main\/dev/],
    [{ local: { ...LOCAL, commit: "c".repeat(40) } }, /expected checked commit/],
    [{ local: { ...LOCAL, clean: false } }, /dirty state/],
    [{ local: { ...LOCAL, payloadSha256: "unknown" } }, /payload SHA/],
    [{ local: { ...LOCAL, fileCount: 0 } }, /file count/],
    [{ local: { ...LOCAL, totalBytes: -1 } }, /byte count/],
  ]) {
    await assert.rejects(verify({ ...overrides, fetchImpl: async () => assert.fail("Unexpected network access") }), error);
  }
});

for (const [field, changed] of Object.entries({
  schemaVersion: 2, branch: "dev", commit: "c".repeat(40), clean: false,
  payloadSha256: "d".repeat(64), fileCount: 43, totalBytes: 12346,
})) {
  test(`remote ${field} mismatch blocks acceptance`, async () => {
    await assert.rejects(verify({ fetchImpl: async () => response({ ...LOCAL, [field]: changed }) }),
      new RegExp(`Remote ${field} differs`));
  });
}

test("public challenges, redirects, missing files, malformed or incomplete JSON all fail", async () => {
  for (const status of [302, 403, 404, 500]) {
    await assert.rejects(verify({ fetchImpl: async () => response(LOCAL, status) }), /Public metadata HTTP/);
  }
  await assert.rejects(verify({ fetchImpl: async () => response(LOCAL, 200, "text/html") }), /must be JSON/);
  await assert.rejects(verify({ fetchImpl: async () => response(null) }), /Remote schemaVersion differs/);
  await assert.rejects(verify({ fetchImpl: async () => response({}) }), /Remote schemaVersion differs/);
  await assert.rejects(verify({ fetchImpl: async () => new Response("broken", {
    headers: { "content-type": "application/json" },
  }) }), SyntaxError);
});

test("network/timeout failure propagates without a retry or a success receipt", async () => {
  let calls = 0;
  await assert.rejects(verify({ fetchImpl: async () => {
    calls++;
    throw new DOMException("Public metadata timed out", "TimeoutError");
  } }), /timed out/);
  assert.equal(calls, 1);
});
