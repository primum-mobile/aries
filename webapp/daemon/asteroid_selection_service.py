# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Named asteroid selections; chart changes use the canonical options path."""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from pathlib import Path

import asteroids

from .file_transaction import exclusive_file_transaction


class AsteroidSelectionStore:
    EXCHANGE_FORMAT = 'aries-asteroid-selections'
    def __init__(self, directory):
        self.path = Path(directory) / 'asteroid-selections.json'
        self._data = self._read()

    @staticmethod
    def _numbers(values):
        if (not isinstance(values, list) or len(values) > asteroids.MAX_SELECTED_ASTEROIDS
                or any(type(number) is not int or not 1 <= number <= 999999
                       or number == 134340 for number in values)
                or len(set(values)) != len(values)):
            raise ValueError('Invalid asteroid selection')
        return list(values)

    @staticmethod
    def _name(value):
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80:
            raise ValueError('Invalid asteroid selection name')
        return value.strip()

    def _read(self):
        if not self.path.exists():
            return {'version': 1, 'revision': 0, 'selectedId': None, 'selections': []}
        data = json.loads(self.path.read_text(encoding='utf-8'))
        if (not isinstance(data, dict) or data.get('version') != 1
                or type(data.get('revision')) is not int or data['revision'] < 0
                or not isinstance(data.get('selections'), list)):
            raise ValueError('Invalid asteroid selection store')
        ids, names = set(), set()
        for selection in data['selections']:
            if not isinstance(selection, dict) or not isinstance(selection.get('id'), str):
                raise ValueError('Invalid asteroid selection store')
            name = self._name(selection.get('name')).casefold()
            self._numbers(selection.get('selectedNumbers'))
            if not selection['id'] or selection['id'] in ids or name in names:
                raise ValueError('Duplicate asteroid selection')
            ids.add(selection['id'])
            names.add(name)
        if data.get('selectedId') is not None and data['selectedId'] not in ids:
            raise ValueError('Invalid selected asteroid selection')
        return data

    def state(self, current):
        selected = next((item for item in self._data['selections']
                         if item['id'] == self._data['selectedId']), None)
        return {
            'revision': self._data['revision'],
            'selectedId': selected['id'] if selected else None,
            'dirty': bool(selected and sorted(selected['selectedNumbers']) != sorted(current)),
            'selections': [{'id': item['id'], 'name': item['name']}
                           for item in self._data['selections']],
        }

    def export(self, selection_id=None):
        """Portable names and MPC numbers, without local ids or paths."""
        data = self._read()
        selections = data['selections']
        if selection_id is not None:
            selections = [item for item in selections if item['id'] == selection_id]
            if not selections:
                raise ValueError('Unknown asteroid selection')
        return {'format': self.EXCHANGE_FORMAT, 'version': 1,
                'selections': [{'name': item['name'], 'selectedNumbers': list(item['selectedNumbers'])}
                               for item in selections]}

    @classmethod
    def _exchange_selections(cls, document):
        if (not isinstance(document, dict) or document.get('format') != cls.EXCHANGE_FORMAT
                or type(document.get('version')) is not int or document['version'] != 1
                or not isinstance(document.get('selections'), list)
                or not document['selections']):
            raise ValueError('Invalid asteroid selections file')
        imported = []
        for item in document['selections']:
            if not isinstance(item, dict):
                raise ValueError('Invalid asteroid selections file')
            imported.append({'name': cls._name(item.get('name')),
                             'selectedNumbers': cls._numbers(item.get('selectedNumbers'))})
        return imported

    def numbers_for_command(self, command):
        """Read a revisioned selection before installing any missing ephemeris."""
        with exclusive_file_transaction(self.path):
            self._data = self._read()
            if command.get('baseRevision') != self._data['revision']:
                raise ValueError('Asteroid selections changed; reload before loading')
            selection = next((item for item in self._data['selections']
                              if item['id'] == command.get('id')), None)
            if selection is None:
                raise ValueError('Unknown asteroid selection')
            return list(selection['selectedNumbers'])

    def mutate(self, command, current, validate_selection=None):
        """Persist atomically; validate a restored set before changing metadata."""
        with exclusive_file_transaction(self.path):
            data = self._read()
            if command.get('baseRevision') != data['revision']:
                self._data = data
                raise ValueError('Asteroid selections changed; reload before saving')
            action, selection_id = command.get('action'), command.get('id')
            selection = next((item for item in data['selections']
                              if item['id'] == selection_id), None)
            restored = None
            if action in ('save', 'rename'):
                if (selection_id is not None or action == 'rename') and selection is None:
                    raise ValueError('Unknown asteroid selection')
                name = self._name(command.get('name', selection['name'] if selection else None))
                if any(item['id'] != selection_id and item['name'].casefold() == name.casefold()
                       for item in data['selections']):
                    raise ValueError('Asteroid selection name already exists')
                if action == 'save':
                    numbers = self._numbers(current)
                    if selection is None:
                        selection = {'id': str(uuid.uuid4())}
                        data['selections'].append(selection)
                    selection['selectedNumbers'] = numbers
                    data['selectedId'] = selection['id']
                selection['name'] = name
            elif action == 'import':
                # Validate the entire file before changing any saved set.
                imported = self._exchange_selections(command.get('document'))
                by_name = {item['name'].casefold(): item for item in data['selections']}
                for item in imported:
                    base_name, name, suffix = item['name'], item['name'], 1
                    while name.casefold() in by_name:
                        if sorted(by_name[name.casefold()]['selectedNumbers']) == sorted(item['selectedNumbers']):
                            break
                        suffix += 1
                        tail = f' ({suffix})'
                        name = base_name[:80 - len(tail)] + tail
                    else:
                        added = {**item, 'name': name, 'id': str(uuid.uuid4())}
                        data['selections'].append(added)
                        by_name[name.casefold()] = added
            elif action in ('select', 'delete'):
                if selection is None:
                    raise ValueError('Unknown asteroid selection')
                if action == 'select':
                    restored = list(selection['selectedNumbers'])
                    if validate_selection is not None:
                        validate_selection(restored)
                    data['selectedId'] = selection_id
                else:
                    data['selections'].remove(selection)
                    if data['selectedId'] == selection_id:
                        data['selectedId'] = None
            elif action in ('clear', 'new'):
                if action == 'new':
                    restored = []
                    if validate_selection is not None:
                        validate_selection(restored)
                data['selectedId'] = None
            else:
                raise ValueError('Invalid asteroid selection action')
            data['revision'] += 1
            descriptor, temporary = tempfile.mkstemp(prefix='.asteroid-selections-', dir=self.path.parent)
            try:
                with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
                    json.dump(data, output, ensure_ascii=False, indent=2)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, self.path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            self._data = data
            return restored
