# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Aries daemon executable entry point (used by the PyInstaller-built sidecar)."""
import os
import sys
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
    if len(argv) == 2 and argv[1] == "--verify-native-transit-kernel":
        from aries.astrology.transit_fast import api as transit_fast_api

        if not transit_fast_api.native_backend_available():
            raise SystemExit(
                transit_fast_api.native_backend_error()
                or "Native transit kernel is unavailable"
            )
        raise SystemExit(0)
    if len(argv) == 2 and argv[1] == "--verify-platform-runtime":
        from webapp.daemon.platform_selfcheck import main as platform_selfcheck

        raise SystemExit(platform_selfcheck(REPO_ROOT))
    if len(argv) != 3:
        return
    if argv[1] == "--export-table-pdf":
        from webapp.frontend.scripts.export_table_pdf import main
        raise SystemExit(main(["export_table_pdf.py", argv[2]]))


_maybe_run_export_helper(sys.argv)

if sys.platform == "win32":
    # The shell pipes stderr into %LOCALAPPDATA%\Aries\logs; make hard
    # crashes and uncaught exceptions land there with a traceback.
    from webapp.daemon import crash_logging

    crash_logging.install()

from webapp.daemon import dev_reload, parent_watch  # noqa: E402

DEV_RELOAD = dev_reload.enabled()
if DEV_RELOAD:
    from webapp.daemon.dev_runtime import ensure_native

    ensure_native(REPO_ROOT)

if getattr(sys, "frozen", False):
    from aries.astrology.transit_fast import api as transit_fast_api

    if not transit_fast_api.native_backend_available():
        raise SystemExit(
            transit_fast_api.native_backend_error()
            or "Native transit kernel is unavailable"
        )

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


def _start_astrocart_basemap_install() -> None:
    """Install the optional offline map without delaying daemon readiness."""
    try:
        import astrocart_tiles

        astrocart_tiles.background_install_default()
    except Exception:
        # The downloader owns its persistent log and retry-on-next-start path;
        # an optional map archive must never prevent Aries from starting.
        pass


if __name__ == "__main__":
    parent_watch.start_parent_watchdog()
    _start_astrocart_basemap_install()
    server = uvicorn.Server(uvicorn.Config(
        app,
        host="127.0.0.1",
        port=_daemon_port(),
        log_level="info",
        # Windows serves every step over HTTP; per-request lines would rotate
        # start-up errors out of the size-capped log. Errors still log.
        access_log=sys.platform != "win32",
    ))
    reloader = dev_reload.start_reload_watcher(server, REPO_ROOT) if DEV_RELOAD else None
    if DEV_RELOAD:
        dev_reload.restore_workspace_before_serving()
    try:
        server.run()
    finally:
        if reloader is not None:
            reloader.stopped.set()
    if reloader is not None and reloader.requested.is_set():
        from webapp.daemon.server import workspace_service

        if object.__getattribute__(workspace_service, "_service") is not None:
            dev_reload.save_chart_handoff(workspace_service.open_chart_handoff())
        dev_reload.reexec()
