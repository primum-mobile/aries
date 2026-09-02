#!/usr/bin/env bash
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$FRONTEND_DIR/../.." && pwd)"
TMP_DIR="$FRONTEND_DIR/.tmp"
PID_FILE="$TMP_DIR/style-lab.pid"
LOG_FILE="$TMP_DIR/style-lab.log"
CONNECTION_FILE="$TMP_DIR/style-lab-connection.json"
FRONTEND_PORT="${ARIES_STYLE_LAB_PORT:-3010}"
DAEMON_PORT="${ARIES_STYLE_LAB_DAEMON_PORT:-8766}"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}/style-lab"
DAEMON_URL="${STYLE_LAB_DAEMON_URL:-http://127.0.0.1:${DAEMON_PORT}}"
DAEMON_TOKEN="${STYLE_LAB_DAEMON_TOKEN:-}"
USE_EXISTING_DAEMON="${STYLE_LAB_USE_EXISTING:-0}"
WEB_PYTHON="${WEB_PYTHON:-$PROJECT_DIR/webapp/.venv/bin/python}"

mkdir -p "$TMP_DIR"

frontend_ready() {
  local body=""
  body="$(curl --connect-timeout 1 --max-time 3 -fsS "$FRONTEND_URL" 2>/dev/null)" || return 1
  grep -qE '(__next|/_next/)' <<< "$body"
}

daemon_ready() {
  local headers=()
  local body=""
  if [ -n "$DAEMON_TOKEN" ]; then
    headers=(-H "X-Aries-Token: $DAEMON_TOKEN")
  fi
  body="$(curl --connect-timeout 1 --max-time 3 -fsS "${headers[@]}" \
    "$DAEMON_URL/api/style-lab/catalog?q=__aries_style_lab_probe__" 2>/dev/null)" || return 1
  grep -q '"tokenSchemaVersion"' <<< "$body"
}

load_connection() {
  local file="$1"
  local values=""
  local loaded_url=""
  local loaded_token=""
  [ -f "$file" ] || return 1
  values="$("$WEB_PYTHON" - "$file" <<'PY'
import json
import sys
from pathlib import Path

value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print(f'{value.get("url") or ""}\t{value.get("token") or ""}')
PY
  )" || return 1
  IFS=$'\t' read -r loaded_url loaded_token <<< "$values"
  [ -n "$loaded_url" ] && [ -n "$loaded_token" ] || return 1
  DAEMON_URL="$loaded_url"
  DAEMON_TOKEN="$loaded_token"
}

write_connection() {
  STYLE_LAB_CONNECTION_PATH="$CONNECTION_FILE" \
  STYLE_LAB_CONNECTION_URL="$DAEMON_URL" \
  STYLE_LAB_CONNECTION_TOKEN="$DAEMON_TOKEN" \
    "$WEB_PYTHON" - <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["STYLE_LAB_CONNECTION_PATH"])
path.write_text(json.dumps({
    "url": os.environ["STYLE_LAB_CONNECTION_URL"],
    "token": os.environ["STYLE_LAB_CONNECTION_TOKEN"],
}) + "\n", encoding="utf-8")
path.chmod(0o600)
PY
}

style_lab_pid() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1 || return 1
  ps -p "$pid" -o command= 2>/dev/null | grep -q 'style-lab-up.sh --serve'
}

stop_stack() {
  local pid=""
  if [ -f "$PID_FILE" ]; then
    pid="$(tr -dc '0-9' < "$PID_FILE")"
  fi
  if style_lab_pid "$pid"; then
    kill "$pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 30); do
      kill -0 "$pid" >/dev/null 2>&1 || break
      sleep 0.1
    done
  fi
  rm -f "$PID_FILE"
  rm -f "$CONNECTION_FILE"
}

serve_stack() {
  local daemon_pid=""
  local frontend_pid=""

  cleanup() {
    [ -z "$frontend_pid" ] || kill "$frontend_pid" >/dev/null 2>&1 || true
    [ -z "$daemon_pid" ] || kill "$daemon_pid" >/dev/null 2>&1 || true
    [ -z "$frontend_pid" ] || wait "$frontend_pid" >/dev/null 2>&1 || true
    [ -z "$daemon_pid" ] || wait "$daemon_pid" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT INT TERM

  cd "$PROJECT_DIR"
  if [ "$USE_EXISTING_DAEMON" != "1" ]; then
    ARIES_STYLE_LAB=1 \
    ARIES_DAEMON_TOKEN="$DAEMON_TOKEN" \
    ARIES_DAEMON_CORS_ORIGINS="http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT}" \
      "$WEB_PYTHON" -m uvicorn webapp.daemon.server:app \
        --host 127.0.0.1 --port "$DAEMON_PORT" &
    daemon_pid=$!
  fi

  cd "$FRONTEND_DIR"
  NEXT_PUBLIC_ARIES_DAEMON_URL="$DAEMON_URL" \
  NEXT_PUBLIC_ARIES_DAEMON_TOKEN="$DAEMON_TOKEN" \
  NEXT_PUBLIC_ARIES_STYLE_LAB=1 \
  ARIES_NEXT_DIST_DIR=.next-style-lab \
    npm run dev -- --port "$FRONTEND_PORT" &
  frontend_pid=$!

  while kill -0 "$frontend_pid" >/dev/null 2>&1; do
    if [ -n "$daemon_pid" ] && ! kill -0 "$daemon_pid" >/dev/null 2>&1; then
      break
    fi
    if [ "$USE_EXISTING_DAEMON" = "1" ] && ! daemon_ready; then
      break
    fi
    sleep 1
  done
  exit 1
}

case "${1:-}" in
  --serve)
    serve_stack
    ;;
  --stop)
    stop_stack
    printf '%s\n' "Aries Chart Style Lab stopped."
    exit 0
    ;;
esac

if [ -z "${STYLE_LAB_DAEMON_URL:-}" ]; then
  if load_connection "$CONNECTION_FILE" && daemon_ready && frontend_ready; then
    open "$FRONTEND_URL"
    printf '%s\n' "Aries Chart Style Lab ready: $FRONTEND_URL"
    exit 0
  fi
  stop_stack
  # The Style Lab is deliberately its own browser sidecar. Never borrow the
  # active Tauri daemon or its document/session state implicitly.
  DAEMON_URL="http://127.0.0.1:${DAEMON_PORT}"
  DAEMON_TOKEN="$("$WEB_PYTHON" -c 'import secrets; print(secrets.token_hex(32))')"
  USE_EXISTING_DAEMON=0
  write_connection
fi

: > "$LOG_FILE"
stack_pid="$(
  STYLE_LAB_DAEMON_URL="$DAEMON_URL" \
  STYLE_LAB_DAEMON_TOKEN="$DAEMON_TOKEN" \
  STYLE_LAB_USE_EXISTING="$USE_EXISTING_DAEMON" \
  WEB_PYTHON="$WEB_PYTHON" \
    "$WEB_PYTHON" - "$0" "$LOG_FILE" <<'PY'
import os
import subprocess
import sys

script, log_path = sys.argv[1:]
with open(log_path, "ab") as log:
    process = subprocess.Popen(
        ["bash", script, "--serve"],
        env=os.environ.copy(),
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
print(process.pid)
PY
)"
printf '%s\n' "$stack_pid" > "$PID_FILE"

for _ in $(seq 1 180); do
  if frontend_ready && daemon_ready; then
    open "$FRONTEND_URL"
    printf '%s\n' "Aries Chart Style Lab ready: $FRONTEND_URL"
    printf '%s\n' "Agent daemon: $DAEMON_URL"
    printf '%s\n' "Log: $LOG_FILE"
    exit 0
  fi
  if ! kill -0 "$stack_pid" >/dev/null 2>&1; then
    printf '%s\n' "Aries Chart Style Lab exited early; see $LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep 0.5
done

printf '%s\n' "Aries Chart Style Lab did not become ready; see $LOG_FILE" >&2
stop_stack
exit 1
