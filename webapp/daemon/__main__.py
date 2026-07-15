# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Aries daemon executable entry point (used by the PyInstaller-built sidecar)."""
import os
import sys
import threading
import time
from pathlib import Path

def _daemon_base_dir() -> Path:
    override = os.environ.get("ARIES_DAEMON_BASE_DIR", "").strip()
    if override:
        return Path(override)
    if getattr(sys, "frozen", False):
        mei = getattr(sys, "_MEIPASS", None)
        if mei:
            return Path(mei)
    return Path(__file__).resolve().parents[2]


REPO_ROOT = _daemon_base_dir()
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
try:
    os.chdir(REPO_ROOT)
except Exception:
    pass


def _maybe_run_export_helper(argv: list[str]) -> None:
    if len(argv) != 3:
        return
    if argv[1] == "--export-chart-image":
        from webapp.frontend.scripts.export_chart_image import main
        raise SystemExit(main(["export_chart_image.py", argv[2]]))
    if argv[1] == "--export-table-pdf":
        from webapp.frontend.scripts.export_table_pdf import main
        raise SystemExit(main(["export_table_pdf.py", argv[2]]))


_maybe_run_export_helper(sys.argv)

import uvicorn  # noqa: E402

from webapp.daemon.server import app  # noqa: E402


def _is_frozen_sidecar() -> bool:
    return bool(getattr(sys, "frozen", False))


def _daemon_port() -> int:
    value = os.environ.get("ARIES_DAEMON_PORT", "").strip()
    if not value:
        if _is_frozen_sidecar():
            raise SystemExit("ARIES_DAEMON_PORT is required for packaged Aries sidecar")
        return 8765
    try:
        port = int(value)
    except ValueError:
        if _is_frozen_sidecar():
            raise SystemExit("ARIES_DAEMON_PORT must be an integer for packaged Aries sidecar")
        return 8765
    if 0 < port < 65536:
        return port
    if _is_frozen_sidecar():
        raise SystemExit("ARIES_DAEMON_PORT must be between 1 and 65535")
    return 8765


def _parent_pid() -> int | None:
    value = os.environ.get("ARIES_DAEMON_PARENT_PID", "").strip()
    if not value:
        return None
    try:
        pid = int(value)
    except ValueError:
        return None
    return pid if pid > 1 else None


def _pid_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _start_parent_watchdog() -> None:
    parent_pid = _parent_pid()
    if parent_pid is None:
        return

    def watch() -> None:
        while True:
            time.sleep(2.0)
            if not _pid_exists(parent_pid):
                os._exit(0)

    threading.Thread(target=watch, name="aries-parent-watchdog", daemon=True).start()


def _start_astrocart_basemap_install() -> None:
    """Install the optional offline map without delaying daemon readiness."""
    try:
        import astrocart_tiles

        astrocart_tiles.background_install_default()
    except Exception:
        # The downloader owns its persistent log and retry-on-next-start path;
        # an optional map archive must never prevent Aries from starting.
        pass


def _start_astrocart_label_prewarm() -> None:
    """Warm bundled world labels after health startup, off the request path."""
    def load() -> None:
        # Let uvicorn claim its socket first; JSON decoding then finishes long
        # before a user can navigate to the retained map surface.
        time.sleep(0.1)
        try:
            from webapp.daemon.astrocart_service import astrocart_service

            astrocart_service.prewarm_city_labels()
        except Exception:
            pass

    threading.Thread(target=load, name="astrocart-label-prewarm", daemon=True).start()


if __name__ == "__main__":
    _start_parent_watchdog()
    _start_astrocart_basemap_install()
    _start_astrocart_label_prewarm()
    uvicorn.run(app, host="127.0.0.1", port=_daemon_port(), log_level="info")
