# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Astrocartography PMTiles registry & downloader.

Phase 3 scaffolding. The engine + map host (phases 1-2) work without any of
this — the default ``demotiles.maplibre.org`` style loads remote raster tiles.
This module manages optional offline/high-res PMTiles archives.

Responsibilities:
    * enumerate available regions (local + remote registry)
    * download on demand, report progress
    * return a MapLibre style JSON that references a local pmtiles:// URL

Deliberately empty in this iteration. The signatures are stable so the panel
can call into it once tile hosting is decided.
"""

from __future__ import annotations

import os
import platform
import posixpath
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from dataclasses import dataclass
from typing import Callable
from urllib.parse import quote, unquote, urlparse

import app_paths


DEFAULT_WORLD_SLUG = "planet_z6"
DEFAULT_WORLD_FILENAME = DEFAULT_WORLD_SLUG + ".pmtiles"
DEFAULT_WORLD_SIZE_BYTES = 60 * 1024 * 1024
DEFAULT_PLANET_SOURCE_URL = "https://build.protomaps.com/20260430.pmtiles"
PMTILES_RELEASE_VERSION = "1.30.2"
_BASEMAP_URL_ENV = "ARIES_ASTROCART_BASEMAP_URL"
_LEGACY_BASEMAP_URL_ENV = "MORINUS_ASTROCART_BASEMAP_URL"
_BASEMAP_URL_FILE = os.path.join("Res", "astrocart", "basemap_url.txt")
_INSTALL_LOCK = threading.Lock()
_INSTALL_STARTED = False
_SERVER_LOCK = threading.Lock()
_SERVER: ThreadingHTTPServer | None = None
_SERVER_THREAD: threading.Thread | None = None
_SERVED_FILES: dict[str, str] = {}
_PMTILES_V3_MAGIC = b"PMTiles\x03"
_PMTILES_MIN_HEADER_BYTES = 127


def _candidate_resource_roots() -> list[str]:
    roots: list[str] = []

    def add(value) -> None:
        if not value:
            return
        try:
            root = os.path.abspath(os.path.expanduser(str(value)))
        except Exception:
            root = str(value)
        if root not in roots:
            roots.append(root)

    add(os.environ.get("ARIES_DAEMON_BASE_DIR", "").strip())
    if getattr(sys, "frozen", False):
        add(getattr(sys, "_MEIPASS", None))
        try:
            add(os.path.join(os.path.dirname(os.path.abspath(sys.executable)), "..", "Resources"))
        except Exception:
            pass
    try:
        add(os.getcwd())
    except Exception:
        pass
    add(os.path.dirname(os.path.abspath(__file__)))
    return roots


def _resource_path(*parts: str) -> str:
    for root in _candidate_resource_roots():
        path = os.path.join(root, *parts)
        if os.path.exists(path):
            return path
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), *parts)


def user_tile_dir() -> str:
    """Directory for user-installed pmtiles. Created on demand."""
    base = user_tile_dir_path()
    os.makedirs(base, exist_ok=True)
    return base


def user_tile_dir_path() -> str:
    """Directory path for user-installed pmtiles, without creating it."""
    current = os.path.join(app_paths.app_support_dir(), "astrocart_tiles")
    legacy = os.path.join(app_paths.legacy_app_support_dir(), "astrocart_tiles")
    app_paths.migrate_directory_contents(legacy, current)
    return current


def user_tool_dir_path() -> str:
    """Directory path for downloaded helper tools, without creating it."""
    current = os.path.join(app_paths.app_support_dir(), "astrocart_tools")
    legacy = os.path.join(app_paths.legacy_app_support_dir(), "astrocart_tools")
    app_paths.migrate_directory_contents(legacy, current)
    return current


def install_log_path() -> str:
    if sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Logs", app_paths.APP_NAME)
    else:
        base = os.path.join(app_paths.app_support_dir(), "logs")
    return os.path.join(base, "astrocart_install.log")


def _log(message: str) -> None:
    try:
        path = install_log_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(message.rstrip() + "\n")
    except Exception:
        pass


@dataclass(frozen=True)
class TileRegion:
    slug: str
    label: str
    size_bytes: int
    url: str            # http(s) source
    local_path: str     # where it goes after download
    extract_maxzoom: int | None = None


def list_regions() -> tuple[TileRegion, ...]:
    """Registry of downloadable pmtiles regions.

    The default world overview is intentionally downloaded after install, not
    bundled. Packaging can provide the stable hosted URL either through
    ``ARIES_ASTROCART_BASEMAP_URL`` or ``Res/astrocart/basemap_url.txt``.
    The old ``MORINUS_ASTROCART_BASEMAP_URL`` name remains a fallback.
    """
    url = default_world_url()
    if not url:
        return ()
    return (TileRegion(
        slug=DEFAULT_WORLD_SLUG,
        label="Offline world overview map",
        size_bytes=DEFAULT_WORLD_SIZE_BYTES,
        url=url,
        local_path=os.path.join(user_tile_dir_path(), DEFAULT_WORLD_FILENAME),
        extract_maxzoom=6,
    ),)


def default_world_url() -> str:
    """Configured post-install source URL for the z0-z6 world basemap."""
    url = os.environ.get(_BASEMAP_URL_ENV, "").strip()
    if not url:
        url = os.environ.get(_LEGACY_BASEMAP_URL_ENV, "").strip()
    if url:
        return url
    path = _resource_path(_BASEMAP_URL_FILE)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    return line
    except OSError:
        pass
    return DEFAULT_PLANET_SOURCE_URL


def local_regions() -> tuple[str, ...]:
    """Slugs of already-downloaded regions."""
    d = user_tile_dir()
    out = []
    for fn in os.listdir(d):
        if fn.endswith(".pmtiles"):
            out.append(fn[:-len(".pmtiles")])
    return tuple(out)


def bundled_world_pmtiles() -> str | None:
    """Path to the bundled world-z0-4.pmtiles if shipped; ``None`` otherwise."""
    path = _resource_path("Res", "astrocart", "world-z0-4.pmtiles")
    return path if is_valid_pmtiles(path) else None


def is_valid_pmtiles(path: str | None) -> bool:
    """Cheap archive sanity check before advertising an offline basemap."""
    if not path:
        return False
    try:
        if os.path.getsize(path) < _PMTILES_MIN_HEADER_BYTES:
            return False
        with open(path, "rb") as handle:
            return handle.read(len(_PMTILES_V3_MAGIC)) == _PMTILES_V3_MAGIC
    except OSError:
        return False


def default_local_pmtiles() -> str | None:
    """Best local offline world basemap archive, if one is installed."""
    bundled = bundled_world_pmtiles()
    if bundled:
        return bundled
    d = user_tile_dir_path()
    if not os.path.isdir(d):
        return None
    preferred = (
        "world-z0-4.pmtiles",
        DEFAULT_WORLD_FILENAME,
        "planet.pmtiles",
    )
    for name in preferred:
        path = os.path.join(d, name)
        if is_valid_pmtiles(path):
            return path
    for name in sorted(os.listdir(d)):
        path = os.path.join(d, name)
        if name.endswith(".pmtiles") and is_valid_pmtiles(path):
            return path
    return None


def local_pmtiles_url(path: str) -> str:
    """Loopback HTTP URL for a local PMTiles archive.

    Browser PMTiles readers need HTTP range requests; ``file://`` is unreliable
    in WebView for that access pattern.
    """
    abspath = os.path.abspath(path)
    key = os.path.basename(abspath)
    with _SERVER_LOCK:
        _SERVED_FILES[key] = abspath
        server = _ensure_server_locked()
        host, port = server.server_address
    return "http://%s:%d/%s" % (host, port, quote(key))


def _ensure_server_locked() -> ThreadingHTTPServer:
    global _SERVER, _SERVER_THREAD
    if _SERVER is not None:
        return _SERVER
    _SERVER = ThreadingHTTPServer(("127.0.0.1", 0), _PMTilesRequestHandler)
    _SERVER_THREAD = threading.Thread(
        target=_SERVER.serve_forever,
        name="astrocart-pmtiles-server",
        daemon=True,
    )
    _SERVER_THREAD.start()
    return _SERVER


def download_region(region: TileRegion, on_progress: Callable[[float], None] | None = None) -> str:
    """Download a region. Returns local path on success, raises on failure."""
    os.makedirs(os.path.dirname(region.local_path), exist_ok=True)
    if region.extract_maxzoom is not None:
        return extract_region(region, on_progress=on_progress)

    fd, tmp_path = tempfile.mkstemp(
        prefix=region.slug + "-",
        suffix=".pmtiles.tmp",
        dir=os.path.dirname(region.local_path),
    )
    os.close(fd)
    try:
        with urllib.request.urlopen(region.url, timeout=20) as response:
            total = response.headers.get("Content-Length")
            try:
                total_bytes = int(total) if total else 0
            except ValueError:
                total_bytes = 0
            done = 0
            with open(tmp_path, "wb") as out:
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    out.write(chunk)
                    done += len(chunk)
                    if on_progress is not None and total_bytes:
                        on_progress(min(1.0, done / float(total_bytes)))
        if not is_valid_pmtiles(tmp_path):
            raise RuntimeError("Downloaded basemap is not a valid PMTiles archive")
        shutil.move(tmp_path, region.local_path)
        if on_progress is not None:
            on_progress(1.0)
        return region.local_path
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def extract_region(region: TileRegion, on_progress: Callable[[float], None] | None = None) -> str:
    """Extract a low-zoom PMTiles archive from a remote planet build.

    This downloads only the requested sub-pyramid through the PMTiles CLI,
    rather than downloading the full source archive.
    """
    pmtiles = pmtiles_executable()
    if not pmtiles:
        pmtiles = ensure_pmtiles_executable()
    remove_helper_after_success = pmtiles.startswith(user_tool_dir_path())
    tmp_path = region.local_path + ".tmp"
    try:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        cmd = [
            pmtiles,
            "extract",
            region.url,
            tmp_path,
            "--maxzoom=%d" % int(region.extract_maxzoom),
        ]
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        last_progress = 0.0
        for line in proc.stdout:
            progress = _parse_pmtiles_progress(line)
            if progress is not None and on_progress is not None:
                last_progress = max(last_progress, progress)
                on_progress(min(0.98, last_progress))
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError("pmtiles extract failed with exit code %d" % rc)
        if not is_valid_pmtiles(tmp_path):
            raise RuntimeError("Extracted basemap is not a valid PMTiles archive")
        shutil.move(tmp_path, region.local_path)
        if remove_helper_after_success:
            _remove_local_helper(pmtiles)
        if on_progress is not None:
            on_progress(1.0)
        return region.local_path
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _remove_local_helper(path: str) -> None:
    try:
        os.unlink(path)
        _log("Removed transient pmtiles helper: %s" % path)
    except OSError:
        pass


def background_install_default(on_done: Callable[[str | None, Exception | None], None] | None = None) -> bool:
    """Start the default offline basemap install in the background.

    Returns True if work was started. No UI is shown here; errors are logged
    and optionally sent to ``on_done``.
    """
    global _INSTALL_STARTED
    if default_local_pmtiles() is not None:
        if on_done:
            on_done(default_local_pmtiles(), None)
        return False
    regions = list_regions()
    if not regions:
        return False
    with _INSTALL_LOCK:
        if _INSTALL_STARTED:
            return False
        _INSTALL_STARTED = True

    region = regions[0]

    def worker():
        global _INSTALL_STARTED
        try:
            _log("Starting astrocart basemap install: %s" % region.url)
            path = download_region(region)
            _log("Astrocart basemap installed: %s" % path)
            if on_done:
                on_done(path, None)
        except Exception as exc:
            _log("Astrocart basemap install failed: %r" % (exc,))
            if on_done:
                on_done(None, exc)
        finally:
            with _INSTALL_LOCK:
                _INSTALL_STARTED = False

    threading.Thread(target=worker, name="astrocart-basemap-install", daemon=True).start()
    return True


def install_in_progress() -> bool:
    """Whether the default archive installer is actively doing work."""
    with _INSTALL_LOCK:
        return bool(_INSTALL_STARTED)


def default_install_state() -> tuple[str | None, bool]:
    """Coherent archive/install snapshot for metadata consumers.

    The installer publishes the file before clearing ``_INSTALL_STARTED``.
    Reading both under the same lock therefore cannot report false/false in
    the completion gap and strand a frontend poller.
    """
    with _INSTALL_LOCK:
        return default_local_pmtiles(), bool(_INSTALL_STARTED)


def pmtiles_executable() -> str | None:
    """Return an available pmtiles helper executable."""
    bundled = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "pmtiles")
    if os.path.exists(bundled):
        return bundled
    local = os.path.join(user_tool_dir_path(), "pmtiles")
    if os.path.exists(local):
        return local
    return shutil.which("pmtiles")


def ensure_pmtiles_executable() -> str:
    """Download the single-file pmtiles helper into Application Support."""
    existing = pmtiles_executable()
    if existing:
        return existing
    url = pmtiles_release_asset_url()
    os.makedirs(user_tool_dir_path(), exist_ok=True)
    suffix = ".zip" if url.endswith(".zip") else ".tar.gz"
    fd, archive_path = tempfile.mkstemp(prefix="pmtiles-", suffix=suffix, dir=user_tool_dir_path())
    os.close(fd)
    try:
        _log("Downloading pmtiles helper: %s" % url)
        _download_file(url, archive_path)
        tool_path = _extract_pmtiles_helper(archive_path)
        os.chmod(tool_path, 0o755)
        _log("Installed pmtiles helper: %s" % tool_path)
        return tool_path
    finally:
        try:
            os.unlink(archive_path)
        except OSError:
            pass


def pmtiles_release_asset_url() -> str:
    version = PMTILES_RELEASE_VERSION
    machine = platform.machine().lower()
    if sys.platform == "darwin":
        arch = "arm64" if machine in ("arm64", "aarch64") else "x86_64"
        return (
            "https://github.com/protomaps/go-pmtiles/releases/download/"
            f"v{version}/go-pmtiles-{version}_Darwin_{arch}.zip"
        )
    if sys.platform.startswith("linux"):
        arch = "arm64" if machine in ("arm64", "aarch64") else "x86_64"
        return (
            "https://github.com/protomaps/go-pmtiles/releases/download/"
            f"v{version}/go-pmtiles_{version}_Linux_{arch}.tar.gz"
        )
    if sys.platform.startswith("win"):
        arch = "arm64" if machine in ("arm64", "aarch64") else "x86_64"
        return (
            "https://github.com/protomaps/go-pmtiles/releases/download/"
            f"v{version}/go-pmtiles_{version}_Windows_{arch}.zip"
        )
    raise RuntimeError("Unsupported platform for pmtiles helper: %s" % sys.platform)


def _download_file(url: str, path: str) -> None:
    with urllib.request.urlopen(url, timeout=30) as response, open(path, "wb") as out:
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)


def _extract_pmtiles_helper(archive_path: str) -> str:
    out_path = os.path.join(user_tool_dir_path(), "pmtiles")
    if archive_path.endswith(".zip"):
        with zipfile.ZipFile(archive_path) as zf:
            member = _find_helper_member(zf.namelist())
            with zf.open(member) as src, open(out_path, "wb") as dst:
                shutil.copyfileobj(src, dst)
    else:
        with tarfile.open(archive_path, "r:gz") as tf:
            names = tf.getnames()
            member_name = _find_helper_member(names)
            member = tf.getmember(member_name)
            src = tf.extractfile(member)
            if src is None:
                raise RuntimeError("pmtiles helper missing from archive")
            with src, open(out_path, "wb") as dst:
                shutil.copyfileobj(src, dst)
    return out_path


def _find_helper_member(names) -> str:
    for name in names:
        base = os.path.basename(name)
        if base in ("pmtiles", "pmtiles.exe"):
            return name
    raise RuntimeError("pmtiles helper missing from archive")


class _PMTilesRequestHandler(BaseHTTPRequestHandler):
    server_version = "MorinusPMTiles/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, _format, *args):
        return

    def do_HEAD(self):
        self._serve(send_body=False)

    def do_GET(self):
        self._serve(send_body=True)

    def _serve(self, send_body: bool):
        key = posixpath.basename(unquote(urlparse(self.path).path))
        path = _SERVED_FILES.get(key)
        if not path or not os.path.exists(path):
            self.send_error(404)
            return
        size = os.path.getsize(path)
        range_header = self.headers.get("Range", "")
        start, end = 0, size - 1
        partial = False
        if range_header.startswith("bytes="):
            spec = range_header[6:].split(",", 1)[0].strip()
            if "-" in spec:
                raw_start, raw_end = spec.split("-", 1)
                try:
                    if raw_start:
                        start = int(raw_start)
                        end = int(raw_end) if raw_end else size - 1
                    elif raw_end:
                        suffix = int(raw_end)
                        start = max(0, size - suffix)
                        end = size - 1
                    partial = True
                except ValueError:
                    self.send_error(416)
                    return
        start = max(0, min(start, size - 1))
        end = max(start, min(end, size - 1))
        length = end - start + 1
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "private, max-age=3600")
        if partial:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.end_headers()
        if not send_body:
            return
        with open(path, "rb") as fh:
            fh.seek(start)
            remaining = length
            while remaining:
                chunk = fh.read(min(1024 * 256, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)


def _parse_pmtiles_progress(line: str) -> float | None:
    import re
    matches = re.findall(r"(\d+(?:\.\d+)?)\s*%", line or "")
    if not matches:
        return None
    try:
        return max(0.0, min(1.0, float(matches[-1]) / 100.0))
    except ValueError:
        return None
