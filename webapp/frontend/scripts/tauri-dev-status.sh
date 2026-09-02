#!/usr/bin/env bash
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$APP_DIR/.tmp"
PID_FILE="$LOG_DIR/tauri-dev.pid"
PORT="${PORT:-3000}"
DAEMON_PORT="${ARIES_DAEMON_PORT:-8765}"

FRONTEND_STATE="down"
DAEMON_STATE="down"
TAURI_STATE="down"
PID_STATE="absent"

frontend_ready() {
  local pids
  local pid
  local command
  local process_cwd

  pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  for pid in $pids; do
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if printf '%s' "$command" | grep -Eqi '(next dev|next-server|node .*next|node .*next/dist)'; then
      process_cwd="$(
        lsof -a -p "$pid" -d cwd -Fn 2>/dev/null \
          | sed -n 's/^n//p' \
          | head -n 1
      )"
      if [ "$process_cwd" = "$APP_DIR" ]; then
        return 0
      fi
    fi
  done
  return 1
}

daemon_owned_by_tauri() {
  local pid
  local ppid
  local parent_command
  for pid in $(lsof -tiTCP:"$DAEMON_PORT" -sTCP:LISTEN 2>/dev/null || true); do
    ppid="$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ' || true)"
    [ -n "$ppid" ] || continue
    parent_command="$(ps -p "$ppid" -o command= 2>/dev/null || true)"
    if printf '%s' "$parent_command" | grep -Eq '(^|/)target/debug/aries($| )|^target/debug/aries$'; then
      return 0
    fi
  done
  return 1
}

if frontend_ready; then
  FRONTEND_STATE="up"
fi
if curl -fsS --connect-timeout 1 --max-time 2 \
  "http://127.0.0.1:${DAEMON_PORT}/health" >/dev/null 2>&1; then
  if daemon_owned_by_tauri; then
    DAEMON_STATE="up"
  else
    DAEMON_STATE="orphan"
  fi
fi
if pgrep -f '(^|/)target/debug/aries($| )|^target/debug/aries$' >/dev/null 2>&1; then
  TAURI_STATE="up"
fi
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${PID:-}" ] && kill -0 "$PID" >/dev/null 2>&1; then
    PID_STATE="running:$PID"
  else
    PID_STATE="stale-removed"
    rm -f "$PID_FILE"
  fi
fi

if [ "$FRONTEND_STATE" = "down" ] && [ "$DAEMON_STATE" = "down" ] && [ "$TAURI_STATE" = "down" ]; then
  echo "tauri dev is not running"
  echo "pid-file: $PID_STATE"
  exit 1
fi

if [ "$FRONTEND_STATE" = "up" ] && [ "$DAEMON_STATE" = "up" ] && [ "$TAURI_STATE" = "up" ]; then
  echo "tauri dev serving"
else
  echo "tauri dev incomplete"
fi
echo "pid-file: $PID_STATE"
echo "tauri:   $TAURI_STATE"
echo "frontend: $FRONTEND_STATE http://127.0.0.1:${PORT}"
echo "daemon:   $DAEMON_STATE http://127.0.0.1:${DAEMON_PORT}"

if [ "$FRONTEND_STATE" != "up" ] || [ "$DAEMON_STATE" != "up" ] || [ "$TAURI_STATE" != "up" ]; then
  exit 1
fi
