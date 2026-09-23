# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Shared event-tag names; portable assignments remain in chart records.

Stable IDs let rename/delete affect closed charts without scanning collections.
Deleted IDs remain tombstones so old embedded names cannot resurrect a tag.
Reads use the in-memory catalog; only explicit edits touch disk.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
import unicodedata
import uuid
from pathlib import Path

import app_paths
from webapp.daemon.file_transaction import exclusive_file_transaction


def clean_name(value):
    name = ' '.join(unicodedata.normalize('NFC', str(value or '')).split())
    if not name or len(name) > 64:
        raise ValueError('Tag names must contain 1–64 characters')
    return name


class EventTags:
    def __init__(self, path=None):
        self.path = Path(path) if path else Path(app_paths.user_opts_dir()) / 'event-tags.json'
        self.catalog_version = 0
        self.tags = self._read()

    def _read(self):
        if not self.path.exists():
            return {}
        data = json.loads(self.path.read_text(encoding='utf-8'))
        if data.get('v') != 1 or not isinstance(data.get('tags'), dict):
            raise ValueError('Invalid event tag catalog')
        self.catalog_version = int(data.get('catalogVersion', 0))
        return data['tags']

    def resolve(self, refs):
        found = {}
        for ref in refs or []:
            if not isinstance(ref, dict) or not ref.get('id') or not ref.get('name'):
                continue
            tag = self.tags.get(ref['id'], ref)
            if not tag.get('deleted'):
                found[tag['id']] = {'id': tag['id'], 'name': tag['name']}
        return sorted(found.values(), key=lambda tag: (tag['name'].casefold(), tag['id']))

    def catalog(self, refs=()):
        return [{**tag, 'lastUsed': self.tags.get(tag['id'], {}).get('lastUsed', 0)}
                for tag in self.resolve([*refs, *self.tags.values()])]

    def _write(self, tags):
        self.catalog_version = max(self.catalog_version + 1, time.time_ns() // 1000)
        descriptor, temporary = tempfile.mkstemp(prefix='.event-tags-', dir=self.path.parent)
        try:
            with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
                json.dump({'v': 1, 'tags': tags, 'catalogVersion': self.catalog_version}, handle, ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        self.tags = tags

    def touch(self, tag_ids, *, refs=()):
        """Record explicit assignments, never reads or filter toggles."""
        if not tag_ids:
            return
        with exclusive_file_transaction(self.path):
            tags = self._read()
            for ref in refs:
                tags.setdefault(ref['id'], dict(ref))
            stamp = time.time_ns() // 1000
            for tag_id in tag_ids:
                if tag_id in tags and not tags[tag_id].get('deleted'):
                    tags[tag_id] = {**tags[tag_id], 'lastUsed': stamp}
            self._write(tags)

    def change(self, *, name=None, tag_id=None, remove=False, refs=()):
        with exclusive_file_transaction(self.path):
            tags = self._read()
            for ref in refs:
                tags.setdefault(ref['id'], dict(ref))
            if tag_id:
                if tag_id not in tags or tags[tag_id].get('deleted'):
                    raise ValueError('Unknown event tag')
                if remove:
                    tags[tag_id] = {**tags[tag_id], 'deleted': True}
                else:
                    label = clean_name(name)
                    if any(t['id'] != tag_id and not t.get('deleted') and t['name'].casefold() == label.casefold()
                           for t in tags.values()):
                        raise ValueError('An event tag already has that name')
                    tags[tag_id] = {**tags[tag_id], 'name': label}
            else:
                label = clean_name(name)
                existing = next((t for t in tags.values() if not t.get('deleted')
                                 and t['name'].casefold() == label.casefold()), None)
                tag_id = existing['id'] if existing else str(uuid.uuid4())
                if existing is None:
                    tags[tag_id] = {'id': tag_id, 'name': label}
            self._write(tags)
            return dict(tags[tag_id])
