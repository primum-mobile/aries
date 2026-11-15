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

import pd_point_selection

from .file_transaction import exclusive_file_transaction

_READ_ONLY = {'pddefaultdirection', 'pdkeycoeff', 'pdFixStarCatalog',
              'pdFixStarMaxSelected', 'arabicPartNames', 'pdAsteroidCatalog', 'userPresets'}


def snapshot(settings: dict, opts) -> dict:
    """A preset: the PD settings plus the chart's node and Moon parallax
    correction, which the PD engine directs and a preset overrides."""
    fields = {k: copy.deepcopy(v) for k, v in settings.items() if k not in _READ_ONLY}
    selection = fields.pop('pdfixstarssel', [])
    return {
        'primaryDirections': fields,
        'planetsPoints': {'meannode': bool(opts.meannode)},
        'display': {'topocentric': bool(opts.topocentric)},
        'fixedStarCodes': sorted(code for i, code in enumerate(opts.fixstars)
                                 if i < len(selection) and selection[i]),
    }


def migrate_snapshot(saved: dict) -> dict:
    """The current shape of a stored preset.

    A preset saved while the PD engine had its own node and Moon parallax
    (``pdmeannode``, ``pdmoonparallax``) carries them as the chart's node and
    Moon parallax correction.  An older preset without a parallax entry
    leaves the chart's setting alone.
    """
    migrated = copy.deepcopy(saved)
    fields = migrated.setdefault('primaryDirections', {})
    node = fields.pop('pdmeannode', None)
    parallax = fields.pop('pdmoonparallax', None)
    if node is not None:
        migrated.setdefault('planetsPoints', {}).setdefault('meannode', bool(node))
    if parallax is not None:
        migrated.setdefault('display', {}).setdefault('topocentric', bool(parallax))
    return migrated


def _matches(saved: dict, current: dict) -> bool:
    """Whether the current settings are the preset's (global groups the preset
    does not store are not compared)."""
    saved = migrate_snapshot(saved)
    shown = {key: value for key, value in current.items()
             if key not in _GLOBAL_GROUPS or key in saved}
    return saved == shown


_GLOBAL_GROUPS = ('planetsPoints', 'display')


def options_patch(saved: dict, opts) -> dict:
    saved = migrate_snapshot(saved)
    fields = copy.deepcopy(saved['primaryDirections'])
    # Old snapshots predate multi-selection; keep their original point scope.
    for fields_for_role in pd_point_selection.ROLE_FIELDS.values():
        if fields_for_role['partsEnabled'] not in fields:
            continue
        fields.setdefault(fields_for_role['asteroidsEnabled'], False)
        fields.setdefault(fields_for_role['asteroidNumbers'], [])
        fields.setdefault(fields_for_role['partNames'], None)
    codes = set(saved['fixedStarCodes'])
    fields['pdfixstarssel'] = [code in codes for code in opts.fixstars]
    patch = {'primaryDirections': fields}
    for group in _GLOBAL_GROUPS:
        if group in saved:
            patch[group] = copy.deepcopy(saved[group])
    return patch


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

    def state(self, current: dict, opts=None) -> dict:
        selected = next((p for p in self._data['presets'] if p['id'] == self._data['selectedId']), None)
        return {
            'revision': self._data['revision'],
            'selectedId': selected['id'] if selected else None,
            'dirty': bool(selected and not _matches(selected['snapshot'], current)),
            'resetSettings': options_patch(selected['snapshot'], opts)['primaryDirections'] if selected and opts is not None else None,
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
