# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Named Primary Directions snapshots; calculations remain in OptionsService."""
from __future__ import annotations

import copy
import json
import os
import tempfile
import uuid
from pathlib import Path

from .file_transaction import exclusive_file_transaction

_READ_ONLY = {'pddefaultdirection', 'pdkeycoeff', 'pdFixStarCatalog',
              'pdFixStarMaxSelected', 'arabicPartNames', 'userPresets'}


def snapshot(settings: dict, opts) -> dict:
    fields = {k: copy.deepcopy(v) for k, v in settings.items() if k not in _READ_ONLY}
    selection = fields.pop('pdfixstarssel', [])
    return {
        'primaryDirections': fields,
        'planetsPoints': {'meannode': bool(opts.meannode)},
        'fixedStarCodes': sorted(code for i, code in enumerate(opts.fixstars)
                                 if i < len(selection) and selection[i]),
    }


def options_patch(saved: dict, opts) -> dict:
    fields = copy.deepcopy(saved['primaryDirections'])
    codes = set(saved['fixedStarCodes'])
    fields['pdfixstarssel'] = [code in codes for code in opts.fixstars]
    return {'primaryDirections': fields, 'planetsPoints': copy.deepcopy(saved['planetsPoints'])}


class PrimaryDirectionPresetStore:
    def __init__(self, directory: str):
        self.path = Path(directory) / 'primary-direction-presets.json'
        self._data = self._read()

    def _read(self):
        if not self.path.exists():
            return {'version': 1, 'revision': 0, 'selectedId': None, 'presets': []}
        data = json.loads(self.path.read_text(encoding='utf-8'))
        if (data.get('version') != 1 or not isinstance(data.get('presets'), list)
                or not isinstance(data.get('revision'), int)):
            raise ValueError('Invalid primary-direction preset store')
        return data

    def state(self, current: dict) -> dict:
        selected = next((p for p in self._data['presets'] if p['id'] == self._data['selectedId']), None)
        return {
            'revision': self._data['revision'],
            'selectedId': selected['id'] if selected else None,
            'dirty': bool(selected and selected['snapshot'] != current),
            'presets': [{'id': p['id'], 'name': p['name']} for p in self._data['presets']],
        }

    def mutate(self, command: dict, current: dict) -> dict | None:
        """Persist atomically; return a saved snapshot only for selection."""
        with exclusive_file_transaction(self.path):
            data = self._read()
            if command.get('baseRevision') != data['revision']:
                self._data = data
                raise ValueError('Primary-direction presets changed; reload before saving')
            action = command.get('action')
            preset_id = command.get('id')
            preset = next((p for p in data['presets'] if p['id'] == preset_id), None)
            selected_snapshot = None
            if action == 'save':
                if preset_id is not None and preset is None:
                    raise ValueError('Unknown primary-direction preset')
                name = str(command.get('name', preset['name'] if preset else '')).strip()
                if not name or len(name) > 80:
                    raise ValueError('Invalid primary-direction preset name')
                if any(p['id'] != preset_id and p['name'].casefold() == name.casefold() for p in data['presets']):
                    raise ValueError('Primary-direction preset name already exists')
                if preset is None:
                    preset = {'id': str(uuid.uuid4())}
                    data['presets'].append(preset)
                preset.update(name=name, snapshot=copy.deepcopy(current))
                data['selectedId'] = preset['id']
            elif action in ('select', 'delete'):
                if preset is None:
                    raise ValueError('Unknown primary-direction preset')
                if action == 'select':
                    data['selectedId'] = preset_id
                    selected_snapshot = copy.deepcopy(preset['snapshot'])
                else:
                    data['presets'].remove(preset)
                    if data['selectedId'] == preset_id:
                        data['selectedId'] = None
            elif action == 'clear':
                data['selectedId'] = None
            else:
                raise ValueError('Invalid primary-direction preset action')
            data['revision'] += 1
            descriptor, temporary = tempfile.mkstemp(prefix='.primary-direction-presets-', dir=self.path.parent)
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
            return selected_snapshot
