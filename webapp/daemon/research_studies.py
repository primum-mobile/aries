# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Explicit, portable study operations. No background work or chart calculation."""
from __future__ import annotations

import datetime
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import uuid

import chartfile
import note_storage
from webapp.daemon.research_library import NoteLibrary, atomic_text, identity_token, markdown, split_markdown
from webapp.daemon.file_transaction import exclusive_file_transaction


def jsonl(rows):
    return ''.join(json.dumps(row, ensure_ascii=False, sort_keys=True) + '\n' for row in rows)


class ResearchLibrary:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.notes = NoteLibrary(self.root / 'Notes')

    def records(self):
        records = {}
        memberships = {}
        for path in sorted(self.root.glob('*.jsonl')):
            for record in chartfile.read_jsonl(str(path)):
                chart_id = str(record.get('id') or '')
                if not chart_id:
                    raise ValueError(f'Chart has no stable ID: {path}')
                comparable = {k: v for k, v in record.items() if k not in ('modified_at', 'notes')}
                previous = records.get(chart_id)
                if previous is not None and comparable != {k: v for k, v in previous.items() if k not in ('modified_at', 'notes')}:
                    raise ValueError(f'Conflicting records for chart ID: {chart_id}')
                records[chart_id] = record
                memberships.setdefault(chart_id, []).append(path.name)
        return records, memberships

    def migrate(self):
        records, memberships = self.records()
        migrated = []
        for chart_id, record in records.items():
            existed = self.notes._find(chart_id).exists()
            state = self.notes.read(chart_id, title=record.get('name', ''))
            if not existed and record.get('notes') and not state['content'] and not state['metadata'].get('legacy_sources'):
                self.notes.write(chart_id, str(record['notes']), title=record.get('name', ''), expected_revision=state['revision'])
            migrated.append(state['path'])
            for event in record.get('events', []):
                migrated.append(self.notes.read(chart_id, title=event['name'], event_id=event['id'])['path'])
        # Machine-readable membership is a generated index, never a second
        # authority for chart inputs. Original collection paths are preserved.
        atomic_text(self.root / 'library.json', json.dumps({'schema': 'aries-library/v1',
            'collections': sorted({p for paths in memberships.values() for p in paths}),
            'charts': [{'id': cid, 'collections': paths,
                        'note': str(self.notes._find(cid).relative_to(self.root))} for cid, paths in memberships.items()]}, ensure_ascii=False, indent=2) + '\n')
        return {'charts': len(records), 'notes': len(migrated), 'legacyFilesPreserved': True}

    def add_to_collection(self, chart_id, collection):
        records, _ = self.records()
        if chart_id not in records:
            raise ValueError('Unknown collection chart')
        name = str(collection)
        if Path(name).name != name or name in ('', '.', '..'):
            raise ValueError('Collection must be a filename within the library')
        path = self.root / (name if name.endswith('.jsonl') else name + '.jsonl')
        with exclusive_file_transaction(path):
            current = chartfile.read_jsonl(str(path)) if path.exists() else []
            if not any(str(record.get('id')) == chart_id for record in current):
                current.append(records[chart_id])
                atomic_text(path, jsonl(current))
        return {'chart_id': chart_id, 'collection': str(path)}

    def create_study(self, title):
        if not str(title).strip():
            raise ValueError('Study title is required')
        study_id = str(uuid.uuid4())
        slug = note_storage.sanitize_note_filename(title).replace(' ', '-').lower()[:64] or 'study'
        directory = self.root / 'Research' / (slug + '--' + study_id[:8])
        directory.mkdir(parents=True)
        for name in ('analyses', 'exports'):
            (directory / name).mkdir()
        atomic_text(directory / 'study.md', markdown({'schema': 'aries-study/v1', 'id': study_id, 'title': title}, ''))
        atomic_text(directory / 'members.jsonl', '')
        return {'id': study_id, 'path': str(directory)}

    def study(self, study_id):
        base = self.root / 'Research'
        matches = []
        for path in base.glob('*/study.md'):
            meta, _ = split_markdown(path.read_text(encoding='utf-8'))
            if str(meta.get('id')) == study_id:
                matches.append(path.parent)
        if len(matches) != 1:
            raise ValueError('Study identity is missing or ambiguous')
        return matches[0]

    def add_member(self, study_id, chart_id, event_id=None):
        records, _ = self.records()
        if chart_id not in records:
            raise ValueError('Unknown study chart')
        if event_id and not any(event.get('id') == event_id for event in records[chart_id].get('events', [])):
            raise ValueError('Unknown study event')
        path = self.study(study_id) / 'members.jsonl'
        member = {'chart_id': chart_id, **({'event_id': event_id} if event_id else {})}
        with exclusive_file_transaction(path):
            members = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
            if member not in members:
                members.append(member)
                atomic_text(path, jsonl(members))
        return member

    def snapshot(self, study_id, *, calculation_settings=None):
        directory = self.study(study_id)
        records, collections = self.records()
        members = [json.loads(line) for line in (directory / 'members.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
        if not members:
            raise ValueError('Study has no members')
        charts = {}
        events = {}
        for member in members:
            cid = str(member['chart_id'])
            if cid not in records:
                raise ValueError(f'Missing study chart: {cid}')
            record = records[cid]
            charts[cid] = {k: v for k, v in record.items() if k not in ('events', 'notes')}
            chosen = record.get('events', [])
            if member.get('event_id'):
                chosen = [event for event in chosen if event['id'] == member['event_id']]
                if not chosen:
                    raise ValueError(f'Missing study event: {member["event_id"]}')
            for event in chosen:
                events[(cid, event['id'])] = {**event, 'chart_id': cid}
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
        target = directory / 'exports' / stamp
        temporary = Path(tempfile.mkdtemp(dir=directory / 'exports'))
        try:
            atomic_text(temporary / 'charts.jsonl', jsonl(charts.values()))
            atomic_text(temporary / 'events.jsonl', jsonl(events.values()))
            atomic_text(temporary / 'members.jsonl', jsonl(members))
            shutil.copyfile(directory / 'study.md', temporary / 'study.md')
            for cid in charts:
                state = self.notes.read(cid, title=charts[cid].get('name', ''))
                destination = temporary / 'Notes' / identity_token(cid) / 'index.md'
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(state['path'], destination)
                attachments = Path(state['path']).parent / 'attachments'
                if attachments.exists():
                    if any(p.is_symlink() for p in attachments.rglob('*')):
                        raise ValueError('Snapshot attachments must be local files, not symbolic links')
                    shutil.copytree(attachments, destination.parent / 'attachments')
            for (cid, eid), event in events.items():
                state = self.notes.read(cid, title=event['name'], event_id=eid)
                destination = temporary / 'Notes' / identity_token(cid) / 'events' / (identity_token(eid) + '.md')
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(state['path'], destination)
            schema = {'schema': 'aries-study-snapshot/v1', 'chart_key': 'id',
                      'event_key': ['chart_id', 'id'], 'event_chart_reference': 'chart_id',
                      'members': 'A chart member includes all its events; an event member includes only that event.',
                      'dates': 'Chart records retain their calendar, timezone, BCE and civil-time fields. No missing time is imputed.',
                      'events': 'Saved recipe inputs and bindings; no calculated positions are generated by this export.'}
            atomic_text(temporary / 'schema.json', json.dumps(schema, indent=2) + '\n')
            hashes = {str(path.relative_to(temporary)): hashlib.sha256(path.read_bytes()).hexdigest()
                      for path in temporary.rglob('*') if path.is_file()}
            manifest = {'schema': 'aries-study-snapshot/v1', 'study_id': study_id, 'created_at': stamp,
                        'source_collections': {cid: collections[cid] for cid in charts},
                        'calculation_settings': calculation_settings,
                        'calculations_included': False, 'sha256': hashes}
            atomic_text(temporary / 'manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
            temporary.rename(target)
        except Exception:
            shutil.rmtree(temporary)
            raise
        return {'path': str(target), 'charts': len(charts), 'events': len(events)}
