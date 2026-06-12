#!/usr/bin/env bash
# Launch DATAMON: serve this folder and open the game in the default browser.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8741}"
URL="http://localhost:$PORT/"

if ! lsof -i ":$PORT" >/dev/null 2>&1; then
  python3 -m http.server "$PORT" >/dev/null 2>&1 &
  trap 'kill %1 2>/dev/null' EXIT
  sleep 0.5
  echo "Serving DATAMON at $URL (Ctrl-C to stop)"
else
  echo "Port $PORT already in use — assuming the server is running, opening $URL"
fi

if command -v open >/dev/null; then open "$URL"; else xdg-open "$URL"; fi
wait 2>/dev/null || true
