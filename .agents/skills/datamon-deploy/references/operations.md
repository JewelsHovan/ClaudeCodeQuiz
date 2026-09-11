# Release operations

Commands run from the repository root; `SKILL_DIR` is the absolute directory containing
`SKILL.md`. This reference does not grant publishing, login, push, or rollback authority.

## Environment and local testing

- Inspect current [package.json](../../../../package.json) and lockfile. `just bootstrap`
  runs `npm ci` and installs Chromium; it does not provision Python.
- Prefer the existing `.venv/bin` on PATH. Verify `python3 -c 'import PIL, numpy'`.
  If missing, use an approved local Python environment with Pillow and NumPy. Do not use
  global `sudo pip`, regenerate art, or change source files merely to fix PATH.
- Record `node --version`, `npm --version`, `python3 --version`, `just --version`,
  and `npx --no-install playwright --version`. For deploy only, record the Wrangler
  version actually emitted by the deployment, not just a remembered cache version.
- `just play` serves **source** on port 8741. `just preview` **repackages** and serves
  `dist/` on 8750; neither proves a production release is current. To review an already
  checked artifact without rebuilding, serve `dist/` directly with a foreground local
  HTTP server in a dedicated tmux session. Use a free port, bind `127.0.0.1`, and verify
  returned metadata before opening it. Never kill an unrelated listener to claim a port.

## Deployment preflight (no publish yet)

1. Require the user's current explicit deployment request and target. Production is `main`;
   preview is `dev`. Detached HEAD, another branch, or a requested/current branch mismatch blocks.
2. Inspect **all** Git state, including index and untracked files:

   ```bash
   git status --porcelain --untracked-files=all
   git diff --stat
   git diff --cached --stat
   git rev-parse --abbrev-ref '@{upstream}'
   git remote
   git config --get "branch.$(git branch --show-current).remote"
   git config --get "branch.$(git branch --show-current).merge"
   ```

   Confirm the expected repository and matching upstream branch (`refs/heads/main` or
   `refs/heads/dev`). Inspect the configured remote URL with any embedded credentials
   redacted **before** emitting output or saving/reporting it; do not dump secrets.
   Fetch that configured remote without merging/rebasing (`git fetch <confirmed-remote>`),
   then compare `git rev-parse HEAD` with `git rev-parse '@{upstream}'`. A stale local
   tracking ref is not proof the branch is pushed. A failed fetch, missing upstream,
   divergence, or any tracked/untracked/index change blocks publishing. Never repair this
   with a force-push, broad staging, stash, reset, checkout, or delivery-state edits.
3. For deployment only, resolve Wrangler without changing project dependencies:

   ```bash
   npx --yes wrangler --version
   npx --yes wrangler whoami
   npx --yes wrangler pages project list
   npx --yes wrangler pages deployment list --project-name=datamon
   ```

   Verify access to **both** the correct account and the existing project whose domain
   is `datamon.pages.dev`. `whoami` alone is insufficient. Do not create a project, select
   the first account, overwrite an account ID, enable Git integration, or alter Pages/Access
   configuration. Inspect provider status afresh: a Git push is not evidence of deployment;
   the manual workflow does not install automatic deployment on push.
4. Capture the previous successful deployment ID/URL/commit for the **requested environment**
   and its public metadata as rollback inventory. If none exists or identity is uncertain,
   stop for clarification rather than inventing a recovery target. Inspect the change range
   (`git diff --name-only <prior-full-commit> HEAD`) to select extra release verification.
   If that commit is unavailable locally, obtain it through the confirmed remote or report
   the missing comparison; do not silently claim changed-feature coverage.
5. Confirm no concurrent worker is editing/rebuilding this checkout or `dist/`. Capture HEAD
   and start state. Run `just deploy` only after all preceding predicates pass.

## Long-running evidence

Run the full check/deploy with adequate foreground timeout or in a unique tmux session.
Use `functions.bash` only to start/inspect the session, then monitor it until completion;
ordinary background jobs may be killed when the harness shell ends. Do not detach and declare done.

Use a fresh directory under ignored `.tdd/deployments/` (or a unique temporary directory),
not `test-results/`. A Bash runner can capture an unambiguous exit status as follows;
substitute exactly one selected command (`just check` or explicitly authorized `just deploy`):

```bash
# ROOT and RUN_DIR must already be set to absolute paths in the runner.
cd "$ROOT" || exit 1
export PATH="$ROOT/.venv/bin:$PATH"
# For deploy only: export npm_config_yes=true CI=1
set +e
set -o pipefail
just check 2>&1 | tee "$RUN_DIR/command.log"
status=$?
printf '%s\n' "$status" > "$RUN_DIR/exit-status"
exit "$status"
```

The file is evidence of that command's exit, not acceptance. Require the log, fresh reports,
and artifact identity too. Record UTC start/end and actual tool versions; do not use shell
tracing or dump credential-bearing environment variables. Monitor for progress/errors;
a missing exit file or stalled run is incomplete, not success. Stop rather than starting
another competing suite. Preserve failed attempts separately.

## Remote metadata helper

From the skill directory, `scripts/verify-metadata.mjs` reads the repository's existing
`dist/artifact-metadata.json` and fetches **only** public metadata. It requires a full
expected commit, clean local/remote metadata, matching schema/branch/commit/SHA/count/bytes,
and correct main/dev alias mapping. It permits only HTTPS root URLs on the Datamon Pages
host or its subdomains, rejects redirects and non-JSON responses, uses no cookies/tokens,
and times out after 20 seconds. It does not prove that every remote file matches the digest;
use artifact verification, public smoke, and additional changed-file checks as instructed.

Run it for the selected alias and, after deploy, for Wrangler's immutable deployment URL.
The expected commit comes from the checked release, **never from whatever happens to be live**.
Missing local artifacts/check evidence means verification is blocked. Report an older live
commit as older, even if the HTML still looks correct.

## Failure handling and rollback

- **Python module missing:** repair the local environment/PATH, then repeat the failed gate.
- **Wrangler install prompt/cache miss:** `npx --no-install wrangler` can fail even with an
  older cached release. Use `npx --yes wrangler` for preflight and `npm_config_yes=true` for
  the canonical deploy. Do not hard-code a user's npm cache path or silently upgrade the app.
- **Login/account failure (including code 10000):** stop before publishing. Ask permission
  before interactive `npx --yes wrangler login`; let the user authenticate. Then repeat
  project/account access checks. Do not read, print, copy, or commit Wrangler tokens.
- **HTTP 403 / code 1010 from Python urllib:** compare with the project's unauthenticated
  Node/browser smoke. A client-specific bot block is not automatically an app outage.
  Never weaken security or add an authenticated cookie to force the public check green.
- **Tests/performance/artifact failed:** no deploy. Preserve exact failures; never adjust
  baselines, generation history, art, budgets, or tests just to manufacture success.
- **Upload succeeded; alias stale or smoke failed:** published but unverified. Public smoke
  already has bounded edge-convergence retries. Diagnose before any additional verification
  attempt; do not repeatedly publish. Keep the deployment URL and prior-good inventory.
- **Rollback:** `just rollback` displays the inventory/dashboard procedure; it does not
  roll anything back. List deployments read-only as needed. An actual rollback requires
  separate explicit approval of the target/environment. Afterwards verify against that
  target's matching checked artifact and expected commit, not the failed release's `dist/`.
