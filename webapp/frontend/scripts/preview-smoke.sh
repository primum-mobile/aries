#!/usr/bin/env bash
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$APP_DIR/.tmp"
PID_FILE="$LOG_DIR/preview-smoke.pid"
PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

if curl -fsS "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
  echo "http://127.0.0.1:$PORT is already serving"
  exit 1
fi

npm run build

SERVER_PID="$(APP_DIR_ENV="$APP_DIR" LOG_DIR_ENV="$LOG_DIR" HOST_ENV="$HOST" PORT_ENV="$PORT" python3 - <<'PY'
import os
import subprocess

app_dir = os.environ["APP_DIR_ENV"]
log_path = os.path.join(os.environ["LOG_DIR_ENV"], "preview-smoke.log")
err_path = os.path.join(os.environ["LOG_DIR_ENV"], "preview-smoke.err.log")
host = os.environ["HOST_ENV"]
port = os.environ["PORT_ENV"]

with open(log_path, "ab") as out, open(err_path, "ab") as err:
    proc = subprocess.Popen(
        ["npm", "run", "start", "--", "--hostname", host, "--port", str(port)],
        cwd=app_dir,
        stdin=subprocess.DEVNULL,
        stdout=out,
        stderr=err,
        start_new_session=True,
    )
print(proc.pid)
PY
)"
echo "$SERVER_PID" >"$PID_FILE"

cleanup_on_failure() {
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$PID_FILE"
}

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
    if [ -n "$LAN_IP" ]; then
      echo "preview ready: http://$LAN_IP:$PORT"
    else
      echo "preview ready: http://127.0.0.1:$PORT"
    fi
    echo "pid: $SERVER_PID"
    exit 0
  fi
  sleep 1
done

echo "preview failed to come up; see $LOG_DIR/preview-smoke.err.log"
cleanup_on_failure
exit 1
