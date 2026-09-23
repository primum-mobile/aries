# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Saved chart and event notes in the shared chart-ID Markdown library.

Canonical paths are Notes/<chart-id>/index.md and events/<event-id>.md.
Legacy named/record/event sidecars are copied lazily and retained for recovery.
Unsaved roots use document-ID scratch notes, promoted on chart save.
"""
from __future__ import annotations

import re
import shutil
import sys
import tempfile
import uuid
from functools import lru_cache

from webapp.daemon.research_library import NoteLibrary, NoteConflict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import note_storage  # wx-free; the same module morin.py / morinus.py resolve paths through


@lru_cache(maxsize=4)
def _library_at(root):
    return NoteLibrary(root)


def library():
    return _library_at(str(note_storage.notes_directory()))


def _seed_record_note(radix, record_id, content):
    target = library()._find(record_id)
    if target.exists():
        return False
    prior = _notes_path(radix)
    state = library().read(record_id, title=radix)
    if state['content'] or (prior is not None and prior.exists()) or not str(content).strip():
        return False
    library().write(record_id, content, title=radix, expected_revision=state['revision'])
    return True


def _record_token(record_id: str) -> str:
    token = note_storage.sanitize_note_filename(record_id or "")
    token = re.sub(r"[^A-Za-z0-9_.-]+", "_", token).strip("._")
    return token or ""


def _record_notes_path(record_id: str | None) -> Path | None:
    token = _record_token(record_id or "")
    if not token:
        return None
    return Path(note_storage.notes_directory()) / f"record-{token}.md"


def _notes_path(radix: str) -> Path | None:
    p = note_storage.saved_note_path(radix)
    return Path(p) if p else None


def _event_notes_path(event_id: str) -> Path:
    """Event identity survives chart closing, renaming and reconstruction."""
    token = _record_token(event_id)
    if not token:
        raise ValueError('Invalid event note identity')
    return Path(note_storage.notes_directory()) / 'events' / f'{token}.md'


def _archived_legacy_path(path: Path) -> Path:
    base = path.with_name(f"{path.name}.migrated")
    if not base.exists():
        return base
    for index in range(1, 1000):
        candidate = path.with_name(f"{path.name}.migrated-{index}")
        if not candidate.exists():
            return candidate
    return path.with_name(f"{path.name}.migrated-{uuid.uuid4().hex}")


def _archive_legacy_record_note(path: Path) -> None:
    try:
        if path.exists():
            path.rename(_archived_legacy_path(path))
    except OSError:
        pass


def _promote_legacy_record_note(named_path: Path | None, record_path: Path | None) -> None:
    if named_path is None or record_path is None or named_path == record_path:
        return
    if not record_path.exists():
        return
    try:
        legacy_text = record_path.read_text(encoding="utf-8")
    except OSError:
        return
    try:
        named_path.parent.mkdir(parents=True, exist_ok=True)
        if legacy_text.strip() == "":
            _archive_legacy_record_note(record_path)
            return
        if not named_path.exists():
            shutil.move(str(record_path), str(named_path))
            return
        existing = named_path.read_text(encoding="utf-8")
        if existing != legacy_text:
            prefix = "" if existing.endswith("\n") or not existing else "\n"
            with named_path.open("a", encoding="utf-8") as handle:
                handle.write(prefix + "\n---\n\n" + legacy_text)
        _archive_legacy_record_note(record_path)
    except OSError:
        pass


def _scratch_token(document_id: str) -> str:
    token = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(document_id)).strip("._")
    return token or "scratch"


def _scratch_path(radix: str, document_id: str) -> Path | None:
    safe_name = note_storage.sanitize_note_filename(radix or "") or "Scratch Chart"
    token = _scratch_token(document_id)
    return Path(tempfile.gettempdir()) / "aries-chart-notes" / f"{safe_name}-{token}.md"


def _find_scratch_path(radix: str, document_id: str) -> Path | None:
    exact = _scratch_path(radix, document_id)
    if exact is not None and exact.exists():
        return exact
    token = _scratch_token(document_id)
    scratch_dir = Path(tempfile.gettempdir()) / "aries-chart-notes"
    try:
        matches = sorted(scratch_dir.glob(f"*-{token}.md"))
    except OSError:
        matches = []
    return matches[0] if matches else exact


def _target_path(
    radix: str,
    *,
    record_id: str | None = None,
    document_id: str | None = None,
    scratch: bool = False,
    event_id: str | None = None,
) -> tuple[Path | None, bool]:
    if event_id:
        return _event_notes_path(event_id), False
    if scratch and document_id:
        return _scratch_path(radix, document_id), True
    named_path = _notes_path(radix)
    record_path = _record_notes_path(record_id)
    _promote_legacy_record_note(named_path, record_path)
    return named_path or record_path, False


def _read_note_candidates(radix: str, record_id: str | None) -> tuple[Path | None, list[Path]]:
    named_path = _notes_path(radix)
    record_path = _record_notes_path(record_id)
    _promote_legacy_record_note(named_path, record_path)
    target = named_path or record_path
    candidates: list[Path] = []
    for candidate in (target, named_path, record_path):
        if candidate is not None and candidate not in candidates:
            candidates.append(candidate)
    return target, candidates


def _merge_text_into_sidecar(path: Path, content: str) -> bool:
    text = content or ""
    if text.strip() == "":
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(text, encoding="utf-8")
        return True
    existing = path.read_text(encoding="utf-8")
    if existing == text:
        return False
    # A legacy chart record can remain open in memory after its embedded note
    # has already been lifted.  Do not append the same legacy block again when
    # another editor seed is requested before that chart record is rewritten.
    if text in existing.split("\n\n---\n\n"):
        return False
    prefix = "" if existing.endswith("\n") or not existing else "\n"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(prefix + "\n---\n\n" + text)
    return True


def _seed_sidecar_from_legacy(path: Path, content: str) -> bool:
    """Promote old embedded text only when no Markdown authority exists."""
    text = content or ""
    if not text.strip() or path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def lift_legacy_record_notes(record: dict) -> dict:
    """Move schema-v1 legacy ``notes`` into the private Markdown note file.

    ``chartfile.py`` remains the legacy schema reader/writer, so daemon save and
    import paths scrub records before they reach JSONL bytes. A missing id is
    still minted to preserve the Record identity used elsewhere in the chart
    lifecycle.
    """
    legacy = str(record.get("notes") or "")
    record_id = str(record.get("id") or "").strip()
    if not record_id:
        record_id = str(uuid.uuid4())
        record["id"] = record_id
    if legacy.strip():
        _seed_record_note(str(record.get("name") or ""), record_id, legacy)
    record["notes"] = ""
    return record


def merge_legacy_note_state(
    radix: str,
    content: str,
    *,
    record_id: str | None = None,
    document_id: str | None = None,
    scratch: bool = False,
    event_id: str | None = None,
) -> bool:
    """Lift embedded chart text into the canonical Markdown target once."""
    # Derived charts may carry the radix's legacy text. Never seed that into
    # the separate event note when opening the chart-data editor.
    if event_id:
        return False
    if record_id and not scratch:
        return _seed_record_note(radix, record_id, content)
    text = str(content or "")
    if not text.strip():
        return False
    path, _is_scratch = _target_path(
        radix,
        record_id=record_id,
        document_id=document_id,
        scratch=scratch,
    )
    if path is None:
        raise OSError(f"cannot resolve a note file for radix {radix!r}")
    return _seed_sidecar_from_legacy(path, text)


def read_note_state(
    radix: str,
    *,
    record_id: str | None = None,
    document_id: str | None = None,
    scratch: bool = False,
    event_id: str | None = None,
) -> dict:
    if event_id and not record_id:
        record_id = library().event_chart(event_id)
    if record_id and not scratch:
        return library().read(record_id, title=radix, event_id=event_id)
    if event_id:
        target_path = _event_notes_path(event_id)
        candidates = [target_path]
        is_scratch = False
    elif scratch:
        p, is_scratch = _target_path(radix, document_id=document_id, scratch=True)
        candidates = [p] if p is not None else []
        target_path = p
    else:
        target_path, candidates = _read_note_candidates(radix, record_id)
        is_scratch = False
    read_path = next((candidate for candidate in candidates if candidate is not None and candidate.exists()), None)
    if read_path is None:
        content = ""
    else:
        try:
            content = read_path.read_text(encoding="utf-8")
        except OSError:
            content = ""
    return {
        "radix": radix,
        "content": content,
        "path": str(target_path) if target_path else "",
        "legacyPath": str(read_path) if read_path and read_path != target_path else "",
        "scratch": is_scratch,
        "exists": bool(read_path and read_path.exists()),
    }


def read_notes(radix: str) -> str:
    return str(read_note_state(radix).get("content") or "")


def write_note_state(
    radix: str,
    content: str,
    *,
    record_id: str | None = None,
    document_id: str | None = None,
    scratch: bool = False,
    event_id: str | None = None,
    expected_revision: str | None = None,
) -> dict:
    if event_id and not record_id:
        record_id = library().event_chart(event_id)
    if record_id and not scratch:
        return library().write(record_id, content, title=radix, event_id=event_id, expected_revision=expected_revision)
    p, is_scratch = _target_path(radix, record_id=record_id, document_id=document_id, scratch=scratch, event_id=event_id)
    if p is None:
        raise OSError(f"cannot resolve a note file for radix {radix!r}")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return {
        "ok": True,
        "radix": radix,
        "path": str(p),
        "scratch": is_scratch,
    }


def write_notes(radix: str, content: str) -> None:
    write_note_state(radix, content)


def discard_scratch_note(radix: str, document_id: str) -> dict:
    p = _find_scratch_path(radix, document_id)
    removed = False
    if p is not None and p.exists():
        try:
            p.unlink()
            removed = True
        except OSError:
            removed = False
    return {"ok": True, "radix": radix, "path": str(p) if p else "", "removed": removed}


def commit_scratch_note(radix: str, document_id: str, *, record_id: str | None = None) -> dict:
    scratch_path = _find_scratch_path(radix, document_id)
    if record_id:
        state = library().read(record_id, title=radix)
        if scratch_path is not None and scratch_path.exists():
            content = scratch_path.read_text(encoding="utf-8")
            if content.strip() and content != state['content']:
                merged = state['content'] + "\n\n---\n\n" + content if state['content'] else content
                library().write(record_id, merged, title=radix, expected_revision=state['revision'])
            discard_scratch_note(radix, document_id)
            return {"ok": True, "committed": True, "path": state['path']}
        return {"ok": True, "committed": False, "path": state['path']}
    final_path = _notes_path(radix) or _record_notes_path(record_id)
    if scratch_path is None or final_path is None or not scratch_path.exists():
        return {"ok": True, "radix": radix, "committed": False, "path": str(final_path) if final_path else ""}
    try:
        scratch_text = scratch_path.read_text(encoding="utf-8")
    except OSError:
        scratch_text = ""
    if scratch_text.strip() == "":
        discard_scratch_note(radix, document_id)
        return {"ok": True, "radix": radix, "committed": False, "path": str(final_path)}
    try:
        final_path.parent.mkdir(parents=True, exist_ok=True)
        if not final_path.exists():
            shutil.move(str(scratch_path), str(final_path))
            return {"ok": True, "radix": radix, "committed": True, "path": str(final_path)}
        _merge_text_into_sidecar(final_path, scratch_text)
        discard_scratch_note(radix, document_id)
    except OSError:
        pass
    return {"ok": True, "radix": radix, "committed": True, "path": str(final_path)}
