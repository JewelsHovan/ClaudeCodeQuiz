# DATAMON — Pokemon-style study game
# Run `just` to list available commands.

port := "8741"
url := "http://localhost:" + port + "/"

# List available commands
default:
    @just --list

# Start the DATAMON server (background) and open the game in your browser
play:
    @lsof -i :{{port}} >/dev/null 2>&1 || (cd datamon && python3 -m http.server {{port}} >/dev/null 2>&1 &)
    @sleep 1
    @open "{{url}}" 2>/dev/null || xdg-open "{{url}}" 2>/dev/null || true
    @echo "DATAMON serving at {{url}}"

# Stop the DATAMON server
stop:
    @lsof -ti :{{port}} | xargs kill 2>/dev/null && echo "DATAMON server stopped." || echo "No server running on port {{port}}."

# Restart the server
restart: stop play

# Show whether the server is running
status:
    @lsof -i :{{port}} >/dev/null 2>&1 && echo "DATAMON is running at {{url}}" || echo "DATAMON is not running."

# Deploy a clean tracked snapshot to Cloudflare Pages (dev => preview, main => production)
deploy:
    #!/usr/bin/env bash
    set -euo pipefail
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    git archive HEAD:datamon | tar -x -C "$tmp"
    npx wrangler pages deploy "$tmp" \
      --project-name=datamon \
      --branch="$(git branch --show-current)" \
      --commit-hash="$(git rev-parse HEAD)" \
      --commit-message="$(git log -1 --pretty=%s)" \
      --commit-dirty=false
