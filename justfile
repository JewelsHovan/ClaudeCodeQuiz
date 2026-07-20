# DATAMON — Pokémon-style study game
# Run `just` to list available commands.

port := "8741"
url := "http://localhost:" + port + "/"

default:
    @just --list

# Install pinned JavaScript dependencies and Chromium for browser checks
bootstrap:
    npm ci
    npx playwright install chromium

# Start DATAMON locally
play:
    @lsof -i :{{port}} >/dev/null 2>&1 || (cd datamon && python3 -m http.server {{port}} >/dev/null 2>&1 &)
    @sleep 1
    @open "{{url}}" 2>/dev/null || xdg-open "{{url}}" 2>/dev/null || true
    @echo "DATAMON serving at {{url}}"

stop:
    @lsof -ti :{{port}} | xargs kill 2>/dev/null && echo "DATAMON server stopped." || echo "No server running on port {{port}}."

restart: stop play

status:
    @lsof -i :{{port}} >/dev/null 2>&1 && echo "DATAMON is running at {{url}}" || echo "DATAMON is not running."

# Validate syntax/content, unit behavior, deterministic artifact, browser journey, and budgets
check:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "=== DATAMON check suite ==="
    node --check datamon/game.js
    node --check datamon/battle-presentation.js
    node --check datamon/battle-arena.js
    node --check datamon/attributes.js
    node --check datamon/battle-ops.js
    node --check datamon/agent-arena.js
    node --check datamon/questions.js
    node --check datamon/progress.js
    node --check datamon/dialogue-runtime.js
    node --check datamon/dialogue.js
    node --check datamon/state.js
    node --check datamon/core.js
    node --check datamon/world-art.js
    node --check datamon/world-layout.js
    node --check datamon/music.js
    node --check datamon/locomotion.js
    for file in scripts/*.mjs tests/unit/*.js tests/browser/*.js; do node --check "$file"; done
    python3 -m py_compile datamon/tools/art_pipeline.py datamon/tools/gen_world_art.py datamon/tools/gen_architecture_assets.py datamon/tools/gen_battle_assets.py datamon/tools/gen_battlemon_ai_sources.py datamon/tools/gen_battle_arena_ai.py datamon/tools/gen_idle_assets.py datamon/tools/gen_locomotion_pilot.py datamon/tools/gen_sitting_assets.py datamon/tools/gen_study_assets.py datamon/tools/gen_walk_assets.py datamon/tools/gen_wayfinding_assets.py tests/test_art_pipeline.py tests/test_battle_assets.py tests/test_battlemon_ai_sources.py tests/test_battle_arena_assets.py tests/test_idle_assets.py tests/test_locomotion_pilot.py tests/test_sitting_assets.py tests/test_walk_assets.py tests/test_wayfinding_assets.py
    python3 datamon/retag_questions.py --check
    node scripts/validate-content.mjs
    python3 -m unittest tests/test_art_pipeline.py tests/test_battle_assets.py tests/test_battlemon_ai_sources.py tests/test_battle_arena_assets.py tests/test_idle_assets.py tests/test_locomotion_pilot.py tests/test_sitting_assets.py tests/test_walk_assets.py tests/test_wayfinding_assets.py
    python3 datamon/tools/gen_architecture_assets.py --validate-twice
    python3 datamon/tools/gen_battlemon_ai_sources.py --validate
    python3 datamon/tools/gen_battle_assets.py --validate-twice
    python3 datamon/tools/gen_battle_arena_ai.py --validate
    python3 datamon/tools/gen_sitting_assets.py --validate-twice
    python3 datamon/tools/gen_study_assets.py --validate-twice
    python3 datamon/tools/gen_wayfinding_assets.py --validate-twice
    python3 datamon/tools/art_pipeline.py validate-active
    if [[ -f datamon/.environment-work/staging/batch-agent-wing/manifest.json ]]; then python3 datamon/tools/art_pipeline.py validate datamon/.environment-work/staging/batch-agent-wing datamon/.environment-work/staging/batch-agent-wing/manifest.json; fi
    node --test tests/unit/*.test.js
    node scripts/package-datamon.mjs
    node scripts/verify-artifact.mjs
    npx playwright test tests/browser/ --project=chromium
    node scripts/eval-locomotion.mjs
    node scripts/perf-baseline.mjs --runs 3
    node scripts/perf-worlds.mjs
    echo "=== DATAMON checks passed ==="

# Build dist/ twice and verify the deterministic tracked runtime payload
package:
    node scripts/package-datamon.mjs
    node scripts/verify-artifact.mjs

# Re-run the fixed cold-title performance contract against dist/
perf-baseline: package
    node scripts/perf-baseline.mjs --runs 3

# Serve the exact packaged artifact
preview: package
    @echo "Serving dist/ artifact at http://localhost:8750/"
    @cd dist && python3 -m http.server 8750

# Smoke an existing deployed artifact and optionally require its commit
remote-smoke target expected_commit="":
    node scripts/smoke-remote.mjs "{{target}}" "{{expected_commit}}"

# Check the clean/upstream state, test once, then deploy that unchanged artifact
# (dev => preview alias, main => production). No public deploy is run automatically.
deploy:
    #!/usr/bin/env bash
    set -euo pipefail
    branch="$(git branch --show-current)"
    [[ -n "$branch" ]] || { echo "ERROR: detached HEAD"; exit 1; }
    [[ "$branch" == "dev" || "$branch" == "main" ]] || { echo "ERROR: deploy only supports dev/main"; exit 1; }
    [[ -z "$(git status --porcelain --untracked-files=all)" ]] || { echo "ERROR: working tree contains tracked or untracked changes"; git status --short; exit 1; }
    upstream="$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)" || { echo "ERROR: no upstream"; exit 1; }
    [[ "$(git rev-parse HEAD)" == "$(git rev-parse '@{upstream}')" ]] || { echo "ERROR: HEAD differs from $upstream; push first"; exit 1; }

    just check
    node scripts/verify-artifact.mjs
    commit="$(git rev-parse HEAD)"
    payload="$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/artifact-metadata.json')).payloadSha256)")"
    echo "Deploying checked payload $payload from $branch@$commit"
    npx wrangler pages deploy dist \
      --project-name=datamon \
      --branch="$branch" \
      --commit-hash="$commit" \
      --commit-message="$(git log -1 --pretty=%s)" \
      --commit-dirty=false

    if [[ "$branch" == "main" ]]; then target="https://datamon.pages.dev/"; else target="https://dev.datamon.pages.dev/"; fi
    node scripts/smoke-remote.mjs "$target" "$commit"

rollback:
    @echo "Cloudflare dashboard: Workers & Pages > datamon > Deployments > Rollback"
    @echo "CLI inventory: npx wrangler pages deployment list --project-name=datamon"
