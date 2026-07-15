#!/usr/bin/env bash
set -euo pipefail

FRONTEND_PORT="${PORT:-3000}"
DAEMON_PORT="${ARIES_DAEMON_PORT:-8765}"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"
DAEMON_URL="http://127.0.0.1:${DAEMON_PORT}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$APP_DIR/.tmp/tauri-dev.pid"

require_live() {
  local url="$1"
  local label="$2"
  if ! curl -fsS "$url" >/dev/null; then
    echo "$label is not reachable at $url"
    exit 1
  fi
}

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${PID:-}" ] && kill -0 "$PID" >/dev/null 2>&1; then
    echo "tauri dev pid: $PID"
  else
    echo "tauri dev pid file is stale; probing live ports instead"
  fi
fi

echo "Checking live Aries frontend at ${FRONTEND_URL}..."
require_live "${FRONTEND_URL}/" "Frontend"
require_live "${FRONTEND_URL}/chart-picker?mode=open-radix" "Frontend chart-picker"

echo "Checking live Aries daemon at ${DAEMON_URL}..."
require_live "${DAEMON_URL}/health" "Daemon health"

echo "live smoke ok"
echo "frontend: ${FRONTEND_URL}"
echo "daemon:   ${DAEMON_URL}"
