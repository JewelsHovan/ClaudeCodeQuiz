---
name: datamon-deploy
description: Test, evaluate, deploy, and verify DATAMON on Cloudflare Pages. Use for release readiness, full quality checks, performance or locomotion evaluation, publishing main/dev, or checking a live release. Defaults to checks only; publishing requires a current explicit request.
---

# DATAMON release workflow

Reuse the repository's guarded pipeline; do not invent a parallel deployment path.
This is a project skill, not an automatic deployment trigger or permission to publish.

## 1. Choose the mode

| Invocation / intent | Action | Public writes |
| --- | --- | --- |
| `/skill:datamon-deploy` or `check` (also test/evaluate) | Run local tests and evaluations; report readiness | None |
| `/skill:datamon-deploy deploy main` | Full guarded production release | Explicitly authorized |
| `/skill:datamon-deploy deploy dev` | Full guarded preview release | Explicitly authorized |
| `/skill:datamon-deploy verify main` or `verify dev` | Compare an existing checked local artifact with the live alias | None |

A request to create/edit this skill, a Git push, past consent, or remembered release
success is **not** a deployment request. If publishing intent or target is ambiguous,
ask one focused question with `compass_ask_user` and wait. If that UI is unavailable,
ask in text and wait. Never silently switch branches or choose another account.

## 2. Establish fresh state

Resolve all skill-relative paths from this `SKILL.md` directory, not the caller's cwd.
Set `SKILL_DIR` to that absolute directory, then work from the repository root:

```bash
ROOT="$(git -C "$SKILL_DIR" rev-parse --show-toplevel)"
cd "$ROOT"
export PATH="$ROOT/.venv/bin:$PATH"
git status --short --branch --untracked-files=all
git branch --show-current
git rev-parse HEAD
```

Read the current [justfile](../../../justfile), [deployment documentation](../../../datamon/README.md),
[package builder](../../../scripts/package-datamon.mjs), [artifact verifier](../../../scripts/verify-artifact.mjs),
and [public smoke](../../../scripts/smoke-remote.mjs). They—not old logs or this
skill's historical examples—define the current implementation. Read
[operations](references/operations.md) before setup, publishing, or remote verification,
and [evaluation](references/evaluation.md) before interpreting results.

Check Node/npm, Git, `just`, Python with Pillow/NumPy, and Playwright Chromium.
Use `just bootstrap` only when dependencies/browser setup is needed. Do not upgrade
lockfiles or install credentials into the project. Local checks need no Cloudflare login.

Record mode, requested target, UTC start, full HEAD, initial dirty state, tool versions,
and evidence directory. Use an ignored `.tdd/deployments/` run directory or a unique
temporary directory **outside `test-results/`**, which Playwright replaces.
Serialize work: no concurrent builds, edits, tests, deployment, or artifact-serving rebuilds.

## 3. Execute the selected mode

### Check (default)

```bash
PATH="$ROOT/.venv/bin:$PATH" just check
```

Capture the actual exit code and complete log. A dirty tree is acceptable for local
review, but its result is **not deployable**. Inspect the evaluation reports and changed
feature journeys below. Do not run Wrangler, push Git, or publish in this mode.

### Deploy (explicit request only)

Complete the read-only release preflight in `references/operations.md`: current branch
must match the requested `main`/`dev`, worktree/index/untracked state must be clean,
and HEAD must match a freshly checked, correctly mapped upstream. Confirm access to
the existing `datamon` project and its production domain; inventory the prior release.
Unpushed work is a blocker, not permission to push, commit, stash, reset, or bypass delivery.

Then run the canonical command **once** with a logged, supervised process:

```bash
PATH="$ROOT/.venv/bin:$PATH" npm_config_yes=true CI=1 just deploy
```

`just deploy` already runs the full `just check`, verifies `dist/`, uploads that exact
artifact, and runs public smoke. Do not run a redundant full check first, rebuild between
check and upload, upload `datamon/`, or invoke a raw `wrangler pages deploy` shortcut.
Never weaken tests, performance budgets, private-file exclusions, or clean/upstream gates.

An upload URL alone is not success. Finish the verification section even when Wrangler
reports success. If upload succeeded but verification failed, report **published but
unverified**, preserve evidence, and stop; do not upload again or roll back automatically.

### Verify (also mandatory after deploy)

Use `main` → `https://datamon.pages.dev/`, `dev` → `https://dev.datamon.pages.dev/`.
Require the exact checked `dist/`, its full expected commit, and associated check evidence.
Do not rebuild a missing/stale artifact to make the live deployment appear current.
The artifact verifier binds it to this checkout's HEAD; stop on mismatch and obtain the
matching checked checkout/artifact rather than resetting somebody's worktree.

```bash
node scripts/verify-artifact.mjs
# Set TARGET from the branch mapping and EXPECTED_COMMIT from the checked release.
node "$SKILL_DIR/scripts/verify-metadata.mjs" "$TARGET" "$EXPECTED_COMMIT"
just remote-smoke "$TARGET" "$EXPECTED_COMMIT"
```

After deploy, reuse its successful alias smoke log rather than repeating that long smoke;
still run the metadata comparison. Also verify metadata at the immutable deployment URL
returned by Wrangler. The helper is read-only and does not replace artifact or browser tests.

Inspect the release diff from the recorded prior commit. Public smoke checks a fixed subset
of runtime files, **not every payload file or every new feature**. Compare additional changed
public bytes with local `dist/` and exercise the relevant feature in a fresh browser context.
Use `references/evaluation.md`; do not modify a learner's real save/profile.

## 4. Report and stop

Return one verdict: **checks passed (not deployed)**, **verified live**, **blocked**, or
**published but unverified**. Include branch/full commit, payload SHA/file count/bytes,
target and immutable URL when applicable, test/evaluator exit results and key measurements,
changed-feature evidence, log/report paths, and any untested scope. Copy the artifact metadata,
manifest, and evaluation reports into the run directory before another run replaces them.

Recheck Git/HEAD and artifact identity at the end. Changed state invalidates earlier readiness.
No automatic retry loop: name a failed predicate, preserve the failed run, and obtain new
evidence or an authorized fix before another attempt. Do not infer success from a tmux
session disappearing, a summary, stale green reports, or a successful upload alone.
