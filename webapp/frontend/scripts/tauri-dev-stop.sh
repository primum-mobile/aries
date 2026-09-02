#!/usr/bin/env bash
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$APP_DIR/.tmp"
PID_FILE="$LOG_DIR/tauri-dev.pid"
SOURCE_STAMP_FILE="$LOG_DIR/tauri-dev.source-stamp"
PORT="${PORT:-3000}"
DAEMON_PORT="${ARIES_DAEMON_PORT:-8765}"
PID=""
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  rm -f "$PID_FILE"
fi
rm -f "$SOURCE_STAMP_FILE"

stopped=0
if [ -n "${PID:-}" ] && kill -0 "$PID" >/dev/null 2>&1; then
  # The detached launcher starts a new session; kill the whole process group so
  # Next, cargo, and the spawned Tauri app all exit together.
  kill -- "-$PID" >/dev/null 2>&1 || kill "$PID" >/dev/null 2>&1 || true
  stopped=1
fi

# Tauri dev may detach children and exit the launcher process. In that case the
# real health signal is the live Aries ports / binary names, so stop them too.
( lsof -ti tcp:"$PORT"; lsof -ti tcp:"$DAEMON_PORT" ) 2>/dev/null | sort -u | xargs kill -9 2>/dev/null || true
pkill -f '/target/debug/aries' >/dev/null 2>&1 || true
pkill -f 'next dev' >/dev/null 2>&1 || true
pkill -f 'uvicorn webapp.daemon.server:app' >/dev/null 2>&1 || true
pgrep -f 'uvicorn webapp.daemon.server:app' 2>/dev/null | xargs kill -9 2>/dev/null || true

if [ "$stopped" -eq 0 ]; then
  echo "stopped tauri dev child processes"
else
  echo "stopped tauri dev (pid: $PID)"
fi
