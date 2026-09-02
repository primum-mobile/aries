#!/usr/bin/env bash
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$APP_DIR/../.." && pwd)"
LOG_DIR="$APP_DIR/.tmp"
PID_FILE="$LOG_DIR/tauri-dev.pid"
SOURCE_STAMP_FILE="$LOG_DIR/tauri-dev.source-stamp"
OUT_LOG="$LOG_DIR/tauri-dev.log"
ERR_LOG="$LOG_DIR/tauri-dev.err.log"
IGNORE_FILE="$APP_DIR/.taurignore"
# One smoke at a time, machine-wide.
#
# These cannot simply be moved per checkout: `src-tauri/tauri.conf.json` pins
# `devUrl` to http://localhost:3000 and names that port in six CSP directives,
# so the window loads 3000 whatever this script computes. Overriding PORT alone
# only misdirects the readiness checks and the launch hangs. Running two Tauri
# smokes side by side means templating that config per checkout first.
PORT="${PORT:-3000}"
DAEMON_PORT="${ARIES_DAEMON_PORT:-8765}"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

source_stamp() {
  PROJECT_DIR_ENV="$PROJECT_DIR" python3 - <<'PY'
import hashlib
import os
from pathlib import Path

project = Path(os.environ["PROJECT_DIR_ENV"]).resolve()
roots = [
    "webapp/daemon",
    "webapp/frontend/src",
    "webapp/frontend/src-tauri/src",
    "webapp/frontend/src-tauri/tauri.conf.json",
    "webapp/frontend/src-tauri/native-menu-manifest.json",
    "webapp/frontend/.tmp/daemon-build.stamp",
    "webapp/frontend/package.json",
    "webapp/frontend/package-lock.json",
    "Res",
    "Data/rt_0p5.txt",
    "parsers/query_corpus.py",
    "corpus/parsed",
    "corpus/valens",
    "corpus/hephaistion",
    "corpus/dorotheus",
    "corpus/lilly",
    "scripts/stage_corpus_resources.py",
    "scripts/stage_corpus_pack_seed.py",
    "scripts/stage_tauri_runtime_resources.py",
    "scripts/staging_tree.py",
    "notes_web/src",
    "notes_web/vite.config.js",
    "notes_web/package.json",
    "notes_web/package-lock.json",
    "triplicitydirections.py",
    "workspace_model.py",
]
ignored_parts = {
    ".git",
    ".next",
    ".pytest_cache",
    ".tmp",
    "__pycache__",
    "node_modules",
    "out",
    "target",
}
files = []
for root in roots:
    path = project / root
    if path.is_file():
        files.append(path)
        continue
    if not path.is_dir():
        continue
    for child in path.rglob("*"):
        if not child.is_file():
            continue
        rel_parts = child.relative_to(project).parts
        if rel_parts[:2] == ("Res", "notes"):
            continue
        if any(part in ignored_parts for part in rel_parts):
            continue
        files.append(child)

digest = hashlib.sha256()
for path in sorted(files):
    stat = path.stat()
    rel = path.relative_to(project).as_posix()
    digest.update(f"{rel}\0{stat.st_mtime_ns}\0{stat.st_size}\0".encode())
print(digest.hexdigest())
PY
}

CURRENT_SOURCE_STAMP="$(source_stamp)"
LAST_SOURCE_STAMP=""
if [ -f "$SOURCE_STAMP_FILE" ]; then
  LAST_SOURCE_STAMP="$(cat "$SOURCE_STAMP_FILE" 2>/dev/null || true)"
fi
SOURCE_STALE=0
if [ "$CURRENT_SOURCE_STAMP" != "$LAST_SOURCE_STAMP" ]; then
  SOURCE_STALE=1
fi

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

daemon_ready() {
  curl -fsS --connect-timeout 1 --max-time 2 \
    "http://127.0.0.1:${DAEMON_PORT}/health" >/dev/null 2>&1
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

tauri_app_ready() {
  pgrep -f '(^|/)target/debug/aries($| )|^target/debug/aries$' >/dev/null 2>&1
}

# The working directory of a process, or empty if it has gone away.
process_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

# Is this process part of the checkout we are launching from?
#
# Every pattern below ('next dev', '/target/debug/aries', the daemon) matches
# any Aries checkout on the machine. A bare pkill therefore reaches into other
# worktrees and kills their smoke — main and a feature worktree were silently
# terminating each other's app, so whoever launched last won and the other
# developer was left looking at a window that had quietly become someone else's
# branch. Ownership is decided by the process's working directory.
owned_by_this_checkout() {
  local cwd
  cwd="$(process_cwd "$1")"
  case "$cwd" in
    "$PROJECT_DIR"|"$PROJECT_DIR"/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Kill only the processes matching a pattern that belong to this checkout.
kill_owned() {
  local pid
  for pid in $(pgrep -f "$1" 2>/dev/null || true); do
    if owned_by_this_checkout "$pid"; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  done
}

# Reclaim one of our own ports. A foreign checkout holding it is reported rather
# than killed: ports are per-checkout now, so that overlap means a real
# misconfiguration and stealing the port would just restart the war.
reclaim_port() {
  local port="$1"
  local label="$2"
  local pid
  for pid in $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true); do
    if owned_by_this_checkout "$pid"; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    else
      echo "error: ${label} port ${port} is held by pid ${pid} from another checkout:" >&2
      echo "       $(process_cwd "$pid")" >&2
      echo "       set PORT / ARIES_DAEMON_PORT to free values, or stop that stack." >&2
      exit 1
    fi
  done
}

stop_live_processes() {
  local pid
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "${pid:-}" ] && kill -0 "$pid" >/dev/null 2>&1; then
      kill -- "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1 || true
      sleep 1
    fi
    rm -f "$PID_FILE"
  fi
  reclaim_port "$PORT" "frontend"
  reclaim_port "$DAEMON_PORT" "daemon"
  kill_owned '/target/debug/aries'
  kill_owned 'next dev'
  kill_owned 'uvicorn webapp.daemon.server:app'
}

if daemon_ready && ! daemon_owned_by_tauri; then
  echo "stale daemon owns ${DAEMON_PORT}; restarting smoke stack"
  reclaim_port "$DAEMON_PORT" "daemon"
  kill_owned 'uvicorn webapp.daemon.server:app'
  kill_owned '/target/debug/aries'
fi

if [ "$SOURCE_STALE" -eq 1 ] && ( frontend_ready || daemon_ready || tauri_app_ready ); then
  echo "tauri dev source changed; restarting smoke stack"
  stop_live_processes
fi

if frontend_ready && daemon_ready && tauri_app_ready && daemon_owned_by_tauri; then
  echo "tauri dev already serving"
  echo "frontend: http://127.0.0.1:${PORT}"
  echo "daemon:   http://127.0.0.1:${DAEMON_PORT}"
  exit 0
fi

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${PID:-}" ] && kill -0 "$PID" >/dev/null 2>&1; then
    echo "tauri dev pid is running but smoke is incomplete; restarting (pid: $PID)"
    kill -- "-$PID" >/dev/null 2>&1 || kill "$PID" >/dev/null 2>&1 || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

TAURI_PID="$(APP_DIR_ENV="$APP_DIR" OUT_LOG_ENV="$OUT_LOG" ERR_LOG_ENV="$ERR_LOG" IGNORE_FILE_ENV="$IGNORE_FILE" python3 - <<'PY'
import os
import subprocess

app_dir = os.environ["APP_DIR_ENV"]
out_log = os.environ["OUT_LOG_ENV"]
err_log = os.environ["ERR_LOG_ENV"]
ignore_file = os.environ["IGNORE_FILE_ENV"]
env = os.environ.copy()
env["TAURI_CLI_WATCHER_IGNORE_FILENAME"] = os.path.basename(ignore_file)
env["TAURI_DEV_WATCHER_IGNORE_FILE"] = ignore_file

with open(out_log, "ab") as out, open(err_log, "ab") as err:
    proc = subprocess.Popen(
        ["npm", "run", "tauri:dev"],
        cwd=app_dir,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=out,
        stderr=err,
        start_new_session=True,
    )
print(proc.pid)
PY
)"
echo "$TAURI_PID" >"$PID_FILE"

for _ in $(seq 1 60); do
  if frontend_ready && daemon_ready && tauri_app_ready; then
    echo "$CURRENT_SOURCE_STAMP" >"$SOURCE_STAMP_FILE"
    echo "tauri dev ready"
    echo "pid: $TAURI_PID"
    echo "frontend: http://127.0.0.1:${PORT}"
    echo "daemon:   http://127.0.0.1:${DAEMON_PORT}"
    exit 0
  fi
  if ! kill -0 "$TAURI_PID" >/dev/null 2>&1; then
    echo "tauri dev exited early; see $ERR_LOG"
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep 1
done

echo "tauri dev did not become ready; see $OUT_LOG and $ERR_LOG"
exit 1
