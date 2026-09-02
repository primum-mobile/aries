# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Single source of truth for per-chart note storage paths and filename sanitizing.

Both the wx desktop brain (``morin.py`` / ``morinus.py``) and the wx-free daemon
(``webapp/daemon/notes_service.py``) must resolve a chart's Markdown note to the
*same* file, or a note written on the desktop is invisible to the web app and
vice-versa. To guarantee that, the directory resolver and the filename
sanitizer live here — moved out of ``morinus.py`` / ``morin.py`` verbatim — and
every caller imports them instead of reimplementing.

The note file for a chart named ``<name>`` is:

    <Documents>/Aries/Charts/Notes/<sanitize(name)>.md

co-located with the chart repository so an Obsidian vault rooted at the chart
folder renders the notes.

This module is wx-free so the daemon can import it without
pulling in wxPython or ``morin.py``.
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

DEFAULT_CHART_COLLECTION = "Charts.jsonl"
LEGACY_DEFAULT_CHART_COLLECTION = "Morinus-import.jsonl"


# --- storage root (moved from morinus.py: _morinus_documents_root / _ensure_dir) ---

def documents_root():
    home = os.path.expanduser("~")
    documents_dir = os.path.join(home, "Documents")
    if os.path.isdir(documents_dir):
        return os.path.join(documents_dir, "Aries")
    return os.path.join(home, "Aries")


def ensure_dir(path):
    try:
        os.makedirs(path, exist_ok=True)
    except Exception:
        pass
    return path


def charts_root():
    override = os.environ.get("ARIES_CHARTS_DIR", "").strip()
    if override:
        return os.path.expanduser(override)
    return os.path.join(documents_root(), "Charts")


def charts_directory():
    return ensure_dir(charts_root())


def default_chart_collection_path():
    override = os.environ.get("ARIES_CHART_COLLECTION", "").strip()
    if override:
        return os.path.expanduser(override)
    root = Path(charts_root())
    target = root / DEFAULT_CHART_COLLECTION
    _seed_factory_chart_collection(target)
    if target.is_file():
        return str(target)
    legacy = root / LEGACY_DEFAULT_CHART_COLLECTION
    if legacy.is_file():
        return str(legacy)
    return str(target)


def startup_chart_collection_path():
    """Return a readable startup collection without mutating existing users.

    A configured override remains authoritative.  Otherwise the canonical user
    collection (or the legacy default) wins when it exists.  If a populated
    ``Aries/Charts`` directory has no default collection, the bundled starter is
    used read-only instead of silently creating or selecting a user collection.
    """
    override = os.environ.get("ARIES_CHART_COLLECTION", "").strip()
    if override:
        return os.path.expanduser(override)
    user_collection = Path(default_chart_collection_path())
    if user_collection.is_file():
        return str(user_collection)
    factory = _factory_chart_collection_path()
    return str(factory if factory is not None else user_collection)


def _factory_chart_collection_path():
    """Return the bundled Morinus-only starter collection, if available."""
    candidates = []
    daemon_base = os.environ.get("ARIES_DAEMON_BASE_DIR", "").strip()
    if daemon_base:
        candidates.append(Path(daemon_base))
    mei = getattr(sys, "_MEIPASS", None)
    if mei:
        candidates.append(Path(mei))
    candidates.extend((Path(__file__).resolve().parent, Path.cwd()))

    seen = set()
    for base in candidates:
        source = (base / "Hors" / "Charts.jsonl").resolve()
        if source in seen:
            continue
        seen.add(source)
        if source.is_file():
            return source
    return None


def _seed_factory_chart_collection(target):
    """Copy the starter only when the user's Charts root does not exist."""
    target = Path(target)
    if target.exists():
        return
    parent = target.parent
    try:
        if parent.exists():
            return
    except OSError:
        return
    source = _factory_chart_collection_path()
    if source is None or source == target.resolve():
        return
    temporary = target.with_name(target.name + ".factory-tmp")
    created_parent = False
    try:
        parent.mkdir(parents=True, exist_ok=False)
        created_parent = True
        shutil.copyfile(source, temporary)
        if target.exists() or any(entry != temporary for entry in parent.iterdir()):
            temporary.unlink(missing_ok=True)
            return
        os.replace(temporary, target)
    except OSError:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        if created_parent:
            try:
                parent.rmdir()
            except OSError:
                pass


def images_directory():
    return ensure_dir(os.path.join(documents_root(), "Images"))


def notes_directory():
    """`<Documents>/Aries/Charts/Notes` — the brain's `_standard_hors_directory()/Notes`."""
    return os.path.join(charts_directory(), "Notes")


# --- filename sanitizing (moved from morin.py: _sanitize_note_filename) ---

_NOTE_FILENAME_BAD = set('/\\:*?"<>|\0')


def sanitize_note_filename(name):
    """Strip filesystem-hostile chars from a chart name for use as a .md filename.

    Keeps unicode letters, spaces, dashes; replaces banned chars with '_';
    collapses runs of whitespace; trims leading/trailing dots and spaces
    (macOS/Windows both reject those at the boundaries).
    """
    cleaned = ''.join(('_' if c in _NOTE_FILENAME_BAD else c) for c in name)
    cleaned = ' '.join(cleaned.split())
    cleaned = cleaned.strip(' .')
    return cleaned


def saved_note_path(chart_name):
    """Resolve the saved Markdown note path for a chart by name, or None.

    Mirrors morin._saved_note_path_for_chart: trim, sanitize, refuse empties.
    """
    chart_name = (chart_name or '').strip()
    if not chart_name:
        return None
    safe_name = sanitize_note_filename(chart_name)
    if not safe_name:
        return None
    return os.path.join(notes_directory(), safe_name + '.md')
