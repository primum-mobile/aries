# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Portable chart-note identities and Markdown files; no chart calculations.

Folders and filenames are conveniences. YAML identities survive external moves.
Only explicit note/library operations scan disk, never chart paint or stepping.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import shutil
import tempfile

import yaml

import note_storage
from webapp.daemon.file_transaction import exclusive_file_transaction


class NoteConflict(OSError):
    def __init__(self, message, *, draft_preserved=False):
        super().__init__(message)
        self.draft_preserved = draft_preserved


def identity_token(value):
    value = str(value or '')
    if not value:
        raise ValueError('Missing chart identity')
    if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,127}', value):
        return value
    return hashlib.sha256(value.encode()).hexdigest()


def split_markdown(text):
    if not text.startswith('---\n') and not text.startswith('---\r\n'):
        return {}, text
    lines = text.splitlines(keepends=True)
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == '---'), None)
    if end is None:
        raise ValueError('Unclosed note metadata')
    metadata = yaml.safe_load(''.join(lines[1:end])) or {}
    if not isinstance(metadata, dict):
        raise ValueError('Note metadata must be a mapping')
    return metadata, ''.join(lines[end + 1:])


def markdown(metadata, body):
    return '---\n' + yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False) + '---\n' + body


def revision(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def atomic_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


class NoteLibrary:
    def __init__(self, root=None):
        self.root = Path(root) if root else Path(note_storage.notes_directory())
        self._index = None

    def reindex(self):
        index = {}
        if self.root.exists():
            for path in self.root.rglob('*.md'):
                if path.is_symlink():
                    continue
                try:
                    meta, _ = split_markdown(path.read_text(encoding='utf-8'))
                except (ValueError, yaml.YAMLError):
                    continue
                if meta.get('schema') == 'aries-note/v1' and meta.get('chart_id') and meta.get('id'):
                    key = (str(meta['chart_id']), str(meta['id']))
                    index.setdefault(key, []).append(path)
        self._index = index
        return index

    def event_chart(self, event_id):
        index = self.reindex() if self._index is None else self._index
        owners = {chart_id for chart_id, note_id in index if note_id == event_id}
        if len(owners) > 1:
            raise NoteConflict('Event notes require a chart identity')
        return next(iter(owners), None)

    def fork(self, source_id, target_id, *, source_title='', title='', events=()):
        """Save As copies notes and attachments into an independent identity."""
        if source_id == target_id:
            return
        source = self.path(source_id, title=source_title)
        target = self._find(target_id)
        with exclusive_file_transaction(target):
            if target.exists():
                raise NoteConflict('Save As note identity already exists')
            temporary = Path(tempfile.mkdtemp(dir=self.root))
            try:
                for event in [None, *events]:
                    eid = event['id'] if event else None
                    state = self.read(source_id, title=event['name'] if event else source_title, event_id=eid)
                    meta = dict(state['metadata'], chart_id=target_id)
                    if not event:
                        meta.update(id=target_id, title=title)
                    destination = temporary / ('events/' + identity_token(eid) + '.md' if eid else 'index.md')
                    atomic_text(destination, markdown(meta, state['content']))
                attachments = source.parent / 'attachments'
                if attachments.exists():
                    shutil.copytree(attachments, temporary / 'attachments', symlinks=True)
                target.parent.mkdir(parents=True, exist_ok=True)
                # The transaction lock occupies the target directory; publish
                # files only after the complete copy has been prepared.
                for child in temporary.iterdir():
                    child.rename(target.parent / child.name)
            finally:
                shutil.rmtree(temporary)
        self.reindex()

    def _find(self, chart_id, event_id=None):
        chart_id = str(chart_id)
        token = identity_token(chart_id)
        base = self._find(chart_id).parent if event_id else self.root / token
        default = base / ('events/' + identity_token(event_id) + '.md' if event_id else 'index.md')
        key = (chart_id, event_id or chart_id)
        if default.exists():
            meta, _ = split_markdown(default.read_text(encoding='utf-8'))
            if str(meta.get('chart_id', '')) != key[0] or str(meta.get('id', '')) != key[1]:
                raise NoteConflict('Note identity changed externally')
            if self._index is not None and len(self._index.get(key, [])) > 1:
                raise NoteConflict('Multiple notes claim the same identity')
            if self._index is not None:
                self._index[key] = [default]
            return default
        index = self.reindex() if self._index is None else self._index
        matches = index.get(key, [])
        if matches and any(not path.exists() for path in matches):
            matches = self.reindex().get(key, [])
        if len(matches) > 1:
            raise NoteConflict('Multiple notes claim the same identity')
        return matches[0] if matches else default

    def path(self, chart_id, *, title='', event_id=None):
        chart_id = str(chart_id)
        target = self._find(chart_id, event_id)
        if not target.exists():
            candidates = ([self.root / 'events' / (identity_token(event_id) + '.md')] if event_id else [
                self.root / (note_storage.sanitize_note_filename(title) + '.md'),
                self.root / ('record-' + identity_token(chart_id) + '.md'),
            ])
            bodies = []
            origins = []
            for old in candidates:
                if old.is_file():
                    content = old.read_text(encoding='utf-8')
                    if content.strip() and content not in bodies:
                        bodies.append(content)
                        origins.append(str(old.relative_to(self.root)))
            meta = {'schema': 'aries-note/v1', 'id': event_id or chart_id,
                    'chart_id': chart_id, 'type': 'event' if event_id else 'chart', 'title': title}
            if origins:
                meta['legacy_sources'] = origins
            # Copy migration is deliberately non-destructive. Legacy files are
            # retained for recovery, and a cleared new note is never re-seeded.
            with exclusive_file_transaction(target):
                if not target.exists():
                    atomic_text(target, markdown(meta, '\n\n---\n\n'.join(bodies)))
            if self._index is not None:
                self._index[(chart_id, event_id or chart_id)] = [target]
            if not event_id:
                (target.parent / 'events').mkdir(exist_ok=True)
                (target.parent / 'attachments').mkdir(exist_ok=True)
        return target

    def read(self, chart_id, *, title='', event_id=None):
        path = self.path(chart_id, title=title, event_id=event_id)
        text = path.read_text(encoding='utf-8')
        meta, body = split_markdown(text)
        return {'content': body, 'metadata': meta, 'path': str(path), 'revision': revision(text),
                'recordId': chart_id, 'eventId': event_id, 'exists': True, 'scratch': False, 'radix': title}

    def write(self, chart_id, body, *, title='', event_id=None, expected_revision=None):
        path = self.path(chart_id, title=title, event_id=event_id)
        with exclusive_file_transaction(path):
            current = path.read_text(encoding='utf-8')
            if expected_revision is not None and revision(current) != expected_revision:
                conflict = self._find(chart_id).parent / 'conflicts' / (revision(body) + '.md')
                atomic_text(conflict, markdown({'schema': 'aries-note-conflict/v1', 'chart_id': chart_id,
                    'event_id': event_id, 'base_revision': expected_revision}, body))
                raise NoteConflict('Note changed externally; your draft is preserved in conflicts', draft_preserved=True)
            meta, _ = split_markdown(current)
            if str(meta.get('chart_id', '')) != chart_id or str(meta.get('id', '')) != (event_id or chart_id):
                raise NoteConflict('Note identity changed externally')
            meta['title'] = title
            text = markdown(meta, body)
            atomic_text(path, text)
        return {'ok': True, 'radix': title, 'path': str(path), 'revision': revision(text),
                'recordId': chart_id, 'eventId': event_id, 'scratch': False}
