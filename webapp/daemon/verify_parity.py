# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Phase 3 gate: verify daemon /api/chart matches direct engine call for Morinus.

Builds the Morinus snapshot two ways:
  A. Direct engine call (export_chart_json.load_chart + export_snapshot).
  B. HTTP fetch from the running daemon at http://127.0.0.1:8765/api/chart?name=Morinus.

Compares the two snapshots field-by-field at 6 decimal places. Either path
ultimately runs through chart.Chart(), so equality proves the daemon's
HTTP + JSON layer preserves engine output without precision loss or drift.

Daemon must be running on 127.0.0.1:8765 (e.g. `make web-daemon`).
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import common
common.ensure_swe_ready()

from webapp.frontend.scripts import export_chart_json

DAEMON_URL = "http://127.0.0.1:8765"


def build_reference() -> dict:
    opts = export_chart_json.init_environment()
    primary, _ = export_chart_json.load_chart(
        str(export_chart_json.DEFAULT_SOURCE),
        opts,
        name="Morinus",
    )
    return export_chart_json.export_snapshot(primary, overlay_render_mode="full")


def wait_for_health(timeout_s: float = 30.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{DAEMON_URL}/health", timeout=1) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, ConnectionRefusedError, OSError):
            time.sleep(0.5)
    return False


def fetch_daemon() -> dict:
    with urllib.request.urlopen(f"{DAEMON_URL}/api/chart?name=Morinus") as resp:
        return json.loads(resp.read())


def round_floats(obj, places: int = 6):
    if isinstance(obj, float):
        return round(obj, places)
    if isinstance(obj, dict):
        return {k: round_floats(v, places) for k, v in obj.items()}
    if isinstance(obj, list):
        return [round_floats(v, places) for v in obj]
    return obj


# Fields populated with wall-clock timestamps at snapshot time. Two independent
# calls produce values that differ by milliseconds-to-seconds even when the
# chart is identical. Mask these before comparing.
_VOLATILE_KEYS = {"buildStamp", "titleParts"}


def mask_volatile(obj):
    if isinstance(obj, dict):
        return {k: ("<masked>" if k in _VOLATILE_KEYS else mask_volatile(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [mask_volatile(v) for v in obj]
    return obj


def find_diffs(a, b, path: str = "", limit: int = 50) -> list[str]:
    diffs: list[str] = []
    if isinstance(a, dict) and isinstance(b, dict):
        for key in sorted(set(a) | set(b)):
            if len(diffs) >= limit:
                return diffs
            p = f"{path}.{key}" if path else key
            if key not in a:
                diffs.append(f"{p}: missing in reference")
            elif key not in b:
                diffs.append(f"{p}: missing in daemon")
            else:
                diffs.extend(find_diffs(a[key], b[key], p, limit - len(diffs)))
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            diffs.append(f"{path}: length ref={len(a)} daemon={len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            if len(diffs) >= limit:
                return diffs
            diffs.extend(find_diffs(x, y, f"{path}[{i}]", limit - len(diffs)))
    elif a != b:
        diffs.append(f"{path}: ref={a!r} daemon={b!r}")
    return diffs


def main() -> int:
    if not wait_for_health(timeout_s=2):
        print(f"Daemon not reachable at {DAEMON_URL}. Start it with: make web-daemon", file=sys.stderr)
        return 2

    print("Building reference Morinus via engine (direct)...", flush=True)
    ref = build_reference()
    primary = ref["primaryChart"]
    print(f"  planets:    {len(primary['planets'])}")
    print(f"  cusps:      {len(primary['houses']['cusps'])}")
    print(f"  aspects:    {len(primary['aspects'])}")
    print(f"  ASC: {primary['angles']['asc']:.6f}  MC: {primary['angles']['mc']:.6f}")

    print("\nFetching from daemon HTTP...", flush=True)
    daemon = fetch_daemon()

    print("\nComparing snapshots (rounded to 6 decimals, volatile timestamps masked)...", flush=True)
    diffs = find_diffs(mask_volatile(round_floats(ref)), mask_volatile(round_floats(daemon)))
    if not diffs:
        print("\nPARITY OK — daemon HTTP layer preserves engine output exactly.")
        return 0
    print(f"\nMISMATCH ({len(diffs)} diffs):", file=sys.stderr)
    for d in diffs:
        print(f"  {d}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
