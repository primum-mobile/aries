# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Development-only daemon reload: watch backend sources, then re-exec in place.

The process keeps its PID, port, token and native socket path, so the Tauri
shell never notices; the frontend's socket reconnect resyncs workspace state.
Open charts cross the reload through a handoff file instead of user options and
keep their document ids, so ids the frontend still holds stay valid.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import sys
import threading
from typing import Any


PYTHON_ROOTS = {"aries", "engine", "forecasting", "parsers", "rectification", "shortcuts"}
RESOURCE_ROOTS = {"Res", "Data", "corpus"}
IGNORED = {"__pycache__", "node_modules", ".venv", "target", ".tmp", ".git"}
ROOT = Path(__file__).resolve().parents[2]


def enabled() -> bool:
    return not getattr(sys, "frozen", False) and os.environ.get("ARIES_DEV_RELOAD") == "1"


def handoff_path(root: Path = ROOT) -> Path:
    return root / "webapp/frontend/.tmp/dev-reload-charts.json"


def reloads_daemon(root: Path, path: str) -> bool:
    try:
        relative = Path(path).relative_to(root)
    except ValueError:
        return False
    parts = relative.parts
    if not parts or any(part in IGNORED or part.startswith(".") for part in parts):
        return False
    if len(parts) == 1:
        return relative.suffix in {".py", ".so", ".pyd"}
    if parts[0] in PYTHON_ROOTS or parts[:2] == ("webapp", "daemon"):
        return relative.suffix in {"", ".py", ".json", ".so", ".pyd", ".c", ".h", ".pyx", ".pxd"}
    if parts[:2] == ("SWEP", "src"):
        return relative.suffix in {".py", ".c", ".h"}
    if parts[0] in RESOURCE_ROOTS:
        return relative.suffix in {".json", ".toml", ".txt", ".tsv"}
    if parts[:2] == ("scripts", "i18n"):
        return relative.suffix == ".json"
    return (parts[:5] == ("webapp", "frontend", "src", "lib", "chart")
            and relative.suffix == ".json")


def watch_directories(root: Path) -> list[Path]:
    """Watch source directories, never recursively traverse build/dependency trees."""
    directories = [root]
    for name in sorted(PYTHON_ROOTS | RESOURCE_ROOTS | {"webapp/daemon", "SWEP/src", "scripts/i18n"}):
        for directory, children, _files in os.walk(root / name):
            children[:] = [child for child in children if child not in IGNORED and not child.startswith(".")]
            directories.append(Path(directory))
    charts = root / "webapp/frontend/src/lib/chart"
    if charts.is_dir():
        directories.append(charts)
    return directories


class Reloader:
    def __init__(self) -> None:
        self.stopped = threading.Event()
        self.requested = threading.Event()


def start_reload_watcher(server, root: Path) -> Reloader:
    from watchfiles import watch

    reloader = Reloader()

    def watch_source():
        for changes in watch(*watch_directories(root), recursive=False,
                             watch_filter=lambda _change, path: reloads_daemon(root, path),
                             stop_event=reloader.stopped, debounce=150, step=50):
            logging.getLogger(__name__).info("Source changed; reloading Aries daemon (%s)",
                                             ", ".join(sorted(Path(p).name for _, p in changes)))
            reloader.requested.set()
            server.should_exit = True
            return

    threading.Thread(target=watch_source, name="aries-dev-reload", daemon=True).start()
    return reloader


def save_chart_handoff(handoff: dict[str, Any], root: Path = ROOT) -> None:
    path = handoff_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(handoff), encoding="utf-8")


def take_chart_handoff(root: Path = ROOT) -> dict[str, Any] | None:
    """Return and consume the charts open before the last reload."""
    path = handoff_path(root)
    try:
        handoff = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    finally:
        path.unlink(missing_ok=True)
    return handoff if isinstance(handoff, dict) else None


def restore_workspace_before_serving(root: Path = ROOT) -> None:
    """Rebuild the handed-off documents before the port reopens.

    The restore is otherwise lazy (first workspace-state request), so a retained
    pane's refetch or a step that reaches the reloaded daemon first would post a
    document id that does not exist yet."""
    if not handoff_path(root).exists():
        return
    from webapp.daemon.server import workspace_service

    try:
        workspace_service.state()
    except Exception:
        logging.getLogger(__name__).exception("Restoring the workspace after a daemon reload failed")


def reexec() -> None:
    sys.stdout.flush()
    sys.stderr.flush()
    os.execv(sys.executable, [sys.executable, *sys.orig_argv[1:]])
