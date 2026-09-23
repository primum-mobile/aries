# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Independent wheel designs, immutable factories, and revisioned working copies.

Only initialization and explicit mutations touch disk. Snapshot export consumes
the compact values hydrated onto options, never this store or a theme file.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import logging
import os
from pathlib import Path
import tempfile
import threading
from typing import Mapping
import uuid

from webapp.daemon.file_transaction import exclusive_file_transaction
from webapp.daemon.wheel_factory import PROFILES, factory_wheel_composition
from webapp.daemon.wheel_composition import ARCHETYPES, validate_compositions
from webapp.daemon.wheel_geometry_ownership import geometry_for_layout, is_geometry_key
from webapp.daemon.style_authoring_service import validate_authoring_override
from webapp.daemon.style_profile_service import _validate_token_value


SCHEMA_VERSION = 1
FILENAME = 'wheel-presets.json'
_NAME_KEYS = {'classic': 'ClassicWheel', 'compact': 'CompactWheel', 'anglo': 'AngloWheel',
              'houses': 'HouseWheel', 'cusps': 'CuspWheel'}
VISIBILITY_FIELDS = {'houses': 'houses', 'terms': 'showterms', 'decans': 'showdecans'}
logger = logging.getLogger(__name__)


class WheelPresetError(ValueError):
    pass


class WheelPresetConflict(WheelPresetError):
    def __init__(self, current):
        super().__init__('wheel-preset-conflict')
        self.current = current


def _layout(value):
    if value not in PROFILES:
        raise WheelPresetError('unknown wheel layout')
    return value


def _factory(layout):
    return {'id': f'factory.{layout}', 'name': _name(layout), 'layout': layout,
            'factory': True, 'overrides': {}, 'composition': factory_wheel_composition(layout)}


def _name(layout):
    import mtexts
    return str(mtexts.txts.get(_NAME_KEYS[layout], layout))


def _overrides(value):
    if not isinstance(value, Mapping):
        raise WheelPresetError('wheel overrides must be an object')
    result = {}
    for key, item in value.items():
        if not isinstance(key, str) or not is_geometry_key(key):
            raise WheelPresetError('wheel preset accepts geometry only')
        result[key] = (validate_authoring_override(key, item)
                       if key.startswith('authoring.wheel.') else _validate_token_value(key, item))
    return result


def _composition(layout, value):
    return validate_compositions({layout: value})[layout]


def _shape(value):
    """Visibility and the compatibility marker do not define a wheel design."""
    return {'projection': value['projection'], 'rings': [
        {key: item for key, item in ring.items() if key != 'enabled'}
        for ring in value['rings']]}


def validate_theme_geometry(value):
    """Portable frozen geometry, private to a theme; never a collection entry."""
    if not isinstance(value, Mapping) or value.get('schemaVersion') != 1:
        raise WheelPresetError('invalid theme wheel geometry')
    layout = value.get('layout')
    if layout is not None:
        _layout(layout)
    designs = value.get('designs')
    if not isinstance(designs, Mapping) or not designs or any(key not in PROFILES for key in designs):
        raise WheelPresetError('invalid theme wheel designs')
    if layout is not None and layout not in designs:
        raise WheelPresetError('active theme wheel design is missing')
    result = {}
    for key, design in designs.items():
        if not isinstance(design, Mapping):
            raise WheelPresetError('invalid theme wheel design')
        result[key] = {'overrides': _overrides(design.get('overrides', {})),
                       'composition': _composition(key, design.get('composition'))}
    return {'schemaVersion': 1, 'layout': layout, 'designs': result}


def factory_theme_geometry(layout=None):
    """A complete pristine wheel snapshot for a theme without saved geometry."""
    if layout is not None:
        _layout(layout)
    return validate_theme_geometry({'schemaVersion': 1, 'layout': layout, 'designs': {
        key: {'overrides': {}, 'composition': factory_wheel_composition(key)}
        for key in PROFILES
    }})


def factory_theme_visibility():
    """Complete factory ring visibility, independent of ambient working state."""
    return {
        layout: {
            ring['archetypeId']: ring['enabled']
            for ring in factory_wheel_composition(layout)['rings']
        }
        for layout in PROFILES
    }


def complete_theme_geometry(value):
    """Fill an older partial theme snapshot from immutable factory designs."""
    incoming = validate_theme_geometry(value)
    factory = factory_theme_geometry(incoming['layout'])
    return {
        **factory,
        'designs': {**factory['designs'], **incoming['designs']},
    }


class WheelPresetStore:
    def __init__(self, opts_dir=None):
        self.path = Path(opts_dir) / FILENAME if opts_dir else None
        self._lock = threading.RLock()
        self._load_error = None
        try:
            self._state = self._load()
        except WheelPresetError as exc:
            # Optional customization must not prevent charts from opening.
            # Keep the damaged file untouched and make the fallback read-only.
            self._state = self._empty()
            self._record_load_error(exc)

    @property
    def load_error(self):
        return self._load_error

    def _record_load_error(self, exc):
        self._load_error = 'wheel-preset-load-failed'
        logger.warning('wheel-preset-load-failed: %s (%s)', self.path, exc)

    @property
    def revision(self):
        return self._state['revision']

    @staticmethod
    def _empty():
        return {'schemaVersion': SCHEMA_VERSION, 'revision': 0, 'presets': {},
                'selected': {key: f'factory.{key}' for key in PROFILES},
                'workingCopies': {}, 'visibility': {}, 'migrationSources': {},
                'currentMigrated': False}

    def _load(self):
        try:
            if self.path is None or not self.path.exists():
                return self._empty()
            state = json.loads(self.path.read_text(encoding='utf-8'))
            if (not isinstance(state, Mapping) or state.get('schemaVersion') != SCHEMA_VERSION
                    or type(state.get('revision')) is not int or state['revision'] < 0):
                raise WheelPresetError('unsupported wheel preset store')
            normalized = self._empty()
            normalized.update(state)
            if (any(not isinstance(normalized[key], Mapping) for key in
                    ('presets', 'selected', 'workingCopies', 'migrationSources'))
                    or set(normalized['selected']) != set(PROFILES)
                    or type(normalized['currentMigrated']) is not bool):
                raise WheelPresetError('invalid wheel preset store structure')
            for identity, preset in normalized['presets'].items():
                layout = _layout(preset['layout'])
                if identity.startswith('factory.') or preset.get('factory') or preset['id'] != identity:
                    raise WheelPresetError('factory wheel presets cannot be replaced')
                preset['overrides'] = _overrides(preset['overrides'])
                preset['composition'] = _composition(layout, preset['composition'])
                if 'themeVisibility' in preset:
                    self._validate_visibility({layout: preset['themeVisibility']})
            for layout, identity in normalized['selected'].items():
                if self._preset(normalized, identity)['layout'] != _layout(layout):
                    raise WheelPresetError('preset layout mismatch')
            for identity, draft in normalized['workingCopies'].items():
                preset = self._preset(normalized, identity)
                draft['overrides'] = _overrides(draft['overrides'])
                draft['composition'] = _composition(preset['layout'], draft['composition'])
                if 'visibility' in draft:
                    self._validate_visibility({preset['layout']: draft['visibility']})
            for source in normalized['migrationSources'].values():
                if not isinstance(source, Mapping) or not isinstance(source.get('refs'), Mapping):
                    raise WheelPresetError('invalid wheel preset migration source')
                for layout, identity in source['refs'].items():
                    _layout(layout)
                    # Archived source receipts outlive a user's later deletion
                    # of the migrated named copy.
                    if not isinstance(identity, str):
                        raise WheelPresetError('invalid wheel preset migration reference')
            self._validate_visibility(normalized['visibility'])
            return normalized
        except (OSError, KeyError, TypeError, ValueError, AttributeError) as exc:
            raise WheelPresetError('invalid wheel preset store; original file preserved') from exc

    @staticmethod
    def _preset(state, identity):
        if identity in {f'factory.{key}' for key in PROFILES}:
            return _factory(identity.split('.', 1)[1])
        if identity not in state['presets']:
            raise WheelPresetError('unknown wheel preset')
        return state['presets'][identity]

    @classmethod
    def _draft(cls, state, layout):
        identity = state['selected'][layout]
        preset = cls._preset(state, identity)
        draft = deepcopy(state['workingCopies'].get(identity) or {
            'overrides': preset['overrides'], 'composition': preset['composition']})
        draft['sourcePresetId'] = identity
        draft['dirty'] = (draft['overrides'] != preset['overrides']
                          or _shape(draft['composition']) != _shape(preset['composition']))
        return draft

    @staticmethod
    def _visible_composition(state, layout, composition):
        value = deepcopy(composition)
        flags = state['visibility'].get(layout, {})
        for ring in value['rings']:
            if ring['archetypeId'] in flags and ring['archetypeId'] != 'hub':
                ring['enabled'] = flags[ring['archetypeId']] and value['projection'] in ARCHETYPES[ring['archetypeId']]['projections']
        return value

    def public_catalog(self):
        """Compact picker metadata; private theme copies never become styles."""
        with self._lock:
            originals = [{'id': f'factory.{key}', 'name': _name(key), 'layout': key, 'factory': True}
                         for key in PROFILES]
            return originals + [{key: preset[key] for key in ('id', 'name', 'layout', 'factory')}
                for identity, preset in self._state['presets'].items() if identity.startswith('user.')]

    def payload(self):
        with self._lock:
            drafts = {layout: self._draft(self._state, layout) for layout in PROFILES}
            for layout, draft in drafts.items():
                draft['composition'] = self._visible_composition(self._state, layout, draft['composition'])
            return deepcopy({'schemaVersion': SCHEMA_VERSION, 'revision': self._state['revision'],
                             'presets': [_factory(key) for key in PROFILES] + [preset for identity, preset in self._state['presets'].items() if identity.startswith('user.')],
                             'activePresets': {key: self._preset(self._state, self._state['selected'][key]) for key in PROFILES},
                             'selected': self._state['selected'], 'drafts': drafts,
                             'loadError': self._load_error})

    def effective(self, layout):
        return self.payload()['drafts'][_layout(layout)]

    @contextmanager
    def _transaction(self):
        with self._lock:
            if self._load_error:
                raise WheelPresetError(self._load_error)
            if self.path is None:
                yield deepcopy(self._state)
            else:
                with exclusive_file_transaction(self.path):
                    try:
                        self._state = self._load()
                    except WheelPresetError as exc:
                        self._record_load_error(exc)
                        raise WheelPresetError(self._load_error) from exc
                    yield deepcopy(self._state)

    def _commit(self, state):
        if self._load_error:
            raise WheelPresetError(self._load_error)
        if state == self._state:
            return
        state['revision'] = self._state['revision'] + 1
        if self.path is not None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix='.wheel-presets-', suffix='.json', dir=self.path.parent)
            try:
                with os.fdopen(fd, 'w', encoding='utf-8') as handle:
                    json.dump(state, handle, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self.path)
            except Exception:
                try:
                    os.unlink(temporary)
                except OSError:
                    pass
                raise
        self._state = state

    def mutate(self, action, layout, *, base_revision, preset_id=None, name=None,
               overrides=None, composition=None):
        layout = _layout(layout)
        with self._transaction() as state:
            if type(base_revision) is not int or base_revision != state['revision']:
                raise WheelPresetConflict(self.payload())
            identity = state['selected'][layout]
            if action == 'select':
                # Built-in layout entries resume the active theme's modification.
                theme_id = f'working.{layout}'
                if preset_id == f'factory.{layout}' and theme_id in state['presets']:
                    preset_id = theme_id
                if identity.startswith('working.'):
                    parked = self._draft(state, layout)
                    state['workingCopies'][identity] = {key: parked[key] for key in ('overrides', 'composition')}
                    state['workingCopies'][identity]['visibility'] = deepcopy(state['visibility'].get(layout, {}))
                if self._preset(state, preset_id)['layout'] != layout:
                    raise WheelPresetError('preset layout mismatch')
                state['selected'][layout] = preset_id
                theme_visibility = state['workingCopies'].get(preset_id, {}).get(
                    'visibility', self._preset(state, preset_id).get('themeVisibility'))
                if theme_visibility is not None:
                    state['visibility'][layout] = deepcopy(theme_visibility)
            elif action == 'patch':
                draft = self._draft(state, layout)
                if overrides is not None:
                    if not isinstance(overrides, Mapping):
                        raise WheelPresetError('wheel overrides patch must be an object')
                    merged = dict(draft['overrides'])
                    for key, value in overrides.items():
                        if not is_geometry_key(key):
                            raise WheelPresetError('wheel preset accepts geometry only')
                        if value is None:
                            merged.pop(key, None)
                        else:
                            merged.update(_overrides({key: value}))
                    draft['overrides'] = merged
                if composition is not None:
                    incoming = _composition(layout, composition)
                    previous = {ring['instanceId']: ring for ring in draft['composition']['rings']}
                    visible = {ring['instanceId']: ring for ring in self._visible_composition(state, layout, draft['composition'])['rings']}
                    flags = state['visibility'].setdefault(layout, {})
                    same_shape = _shape(incoming) == _shape(draft['composition'])
                    for ring in incoming['rings']:
                        old = previous.get(ring['instanceId'])
                        if old:
                            if ring['enabled'] != visible[ring['instanceId']]['enabled']:
                                flags[ring['archetypeId']] = ring['enabled']
                            if same_shape:
                                ring['enabled'] = old['enabled']
                        else:
                            # Re-adding an instance is explicit inclusion; a
                            # removed predecessor's hidden flag must not win.
                            flags[ring['archetypeId']] = ring['enabled']
                    incoming['customized'] = _shape(incoming) != _shape(_factory(layout)['composition'])
                    draft['composition'] = incoming
                state['workingCopies'][identity] = {'overrides': draft['overrides'], 'composition': draft['composition']}
                if identity.startswith('working.'):
                    state['workingCopies'][identity]['visibility'] = deepcopy(state['visibility'].get(layout, {}))
            elif action == 'save':
                draft = self._draft(state, layout)
                if name is not None and (not isinstance(name, str) or not name.strip() or len(name.strip()) > 80):
                    raise WheelPresetError('wheel preset name must contain 1 to 80 characters')
                # A supplied name means Save as; an unnamed user Save updates
                # that explicit user preset. The request revision protects the
                # target from a concurrent selection change; do not silently
                # redirect Save to whichever identity happens to be ambient.
                target_identity = preset_id or identity
                source = self._preset(state, target_identity)
                if source['layout'] != layout:
                    raise WheelPresetError('preset layout mismatch')
                # Factories and private theme snapshots can only produce a
                # named copy; only public user slots are replaceable in place.
                if not target_identity.startswith('user.') and not name:
                    raise WheelPresetError('save a factory wheel as a named user preset')
                target = f'user.{uuid.uuid4().hex}' if name else target_identity
                state['presets'][target] = {'id': target, 'name': name.strip() if name else source['name'],
                                            'layout': layout, 'factory': False, 'overrides': draft['overrides'],
                                            'composition': draft['composition']}
                state['selected'][layout] = target
                state['workingCopies'].pop(target, None)
                if identity != target:
                    state['workingCopies'].pop(identity, None)
                if not identity.startswith('user.'):
                    # The edits now have a durable user identity. Returning to
                    # the protected factory must show the original again.
                    state['workingCopies'].pop(identity, None)
            elif action == 'revert':
                state['workingCopies'].pop(identity, None)
                visibility = self._preset(state, identity).get('themeVisibility')
                if visibility is not None:
                    state['visibility'][layout] = deepcopy(visibility)
            elif action == 'restore-factory':
                # Selecting a preset normally resumes its parked draft. An
                # explicit restore must instead recover the pristine original
                # in one transaction, while preserving saved user designs.
                factory_id = f'factory.{layout}'
                state['visibility'][layout] = factory_theme_visibility()[layout]
                state['workingCopies'].pop(factory_id, None)
                theme_id = f'working.{layout}'
                if theme_id in state['presets']:
                    factory = _factory(layout)
                    state['workingCopies'][theme_id] = {key: deepcopy(factory[key]) for key in ('overrides', 'composition')}
                    state['workingCopies'][theme_id]['visibility'] = deepcopy(state['visibility'].get(layout, {}))
                    state['selected'][layout] = theme_id
                else:
                    state['selected'][layout] = factory_id
            elif action == 'delete':
                target = preset_id or identity
                preset = self._preset(state, target)
                if preset['factory']:
                    raise WheelPresetError('factory wheel presets cannot be deleted')
                if preset['layout'] != layout:
                    raise WheelPresetError('preset layout mismatch')
                if not target.startswith('user.') and not target.startswith('migrated.'):
                    raise WheelPresetError('only saved wheel presets can be deleted')
                del state['presets'][target]
                state['workingCopies'].pop(target, None)
                if identity == target:
                    state['selected'][layout] = f'factory.{layout}'
            else:
                raise WheelPresetError('unknown wheel preset action')
            if action == 'select' and state['selected'][layout] == f'factory.{layout}':
                # Loading an original includes its instruments. Stale theme
                # visibility must not silently turn Anglo into another recipe.
                # The established Houses/Terms/Decans display controls remain
                # independent of this explicit preset action.
                state['visibility'][layout] = {
                    key: value for key, value in state['visibility'].get(layout, {}).items()
                    if key in VISIBILITY_FIELDS
                }
            self._commit(state)
        return self.payload()

    def capture_theme_geometry(self, layout):
        with self._lock:
            return validate_theme_geometry({'schemaVersion': 1, 'layout': layout, 'designs': {
                key: self._draft(self._state, key) for key in PROFILES}})

    def migrated_theme_geometry(self, source_id, refs, layout=None, *, fallback_source_id=None):
        """Recover migration-time geometry even if its generated entry was deleted."""
        with self._lock:
            receipt = self._state['migrationSources'].get(source_id, {})
            if not receipt and fallback_source_id:
                receipt = self._state['migrationSources'].get(fallback_source_id, {})
            refs = refs or receipt.get('refs', {})
            source = receipt.get('source', {})
            if not source and refs:
                source = next((item.get('source', {}) for item in self._state['migrationSources'].values()
                               if item.get('refs') == refs and item.get('source')), {})
            stored_layout = source.get('layout', layout)
            active = PROFILES[stored_layout] if type(stored_layout) is int and stored_layout in range(5) else None
            if active is None and len(refs) == 1:
                active = next(iter(refs))
            designs = {}
            for key in PROFILES:
                # The receipt is immutable. Later collection edits must not
                # silently rewrite a theme's originally saved appearance.
                if source:
                    designs[key] = {'overrides': geometry_for_layout(source.get('overrides', {}), key),
                                    'composition': source.get('compositions', {}).get(key) or factory_wheel_composition(key)}
                else:
                    identity = refs.get(key, f'factory.{key}')
                    preset = self._preset(self._state, identity)
                    designs[key] = {'overrides': preset['overrides'], 'composition': preset['composition']}
            return validate_theme_geometry({'schemaVersion': 1, 'layout': active, 'designs': designs})

    def apply_theme_geometry(self, value):
        snapshot = complete_theme_geometry(value)
        with self._transaction() as state:
            before = deepcopy(state)
            for key, design in snapshot['designs'].items():
                # Private working slots protect both named presets and parked
                # factory drafts. Applying a theme never publishes a new style.
                factory = _factory(key)
                if design == {k: factory[k] for k in ('overrides', 'composition')} and f'factory.{key}' not in state['workingCopies']:
                    state['selected'][key] = f'factory.{key}'
                else:
                    identity = f'working.{key}'
                    state['presets'][identity] = {**factory, **deepcopy(design), 'id': identity, 'factory': False}
                    state['workingCopies'].pop(identity, None)
                    state['selected'][key] = identity
            self._commit(state)
            return before != state

    def apply_theme_snapshot(self, geometry, visibility):
        """Replace the complete wheel state when selecting a theme.

        Theme changes are a discard boundary for unsaved wheel drafts. Saved
        user presets remain in the catalog, while every active layout and ring
        visibility value comes solely from the selected theme (or its factory
        fallback), never from the previously selected theme.
        """
        snapshot = complete_theme_geometry(geometry)
        defaults = factory_theme_visibility()
        self._validate_visibility(visibility or {})
        resolved_visibility = {
            layout: {**defaults[layout], **dict((visibility or {}).get(layout, {}))}
            for layout in PROFILES
        }
        with self._transaction() as state:
            before = deepcopy(state)
            state['workingCopies'] = {}
            for key, design in snapshot['designs'].items():
                factory = _factory(key)
                if design == {field: factory[field] for field in ('overrides', 'composition')}:
                    state['presets'].pop(f'working.{key}', None)
                    state['selected'][key] = f'factory.{key}'
                else:
                    identity = f'working.{key}'
                    state['presets'][identity] = {
                        **factory,
                        **deepcopy(design),
                        'id': identity,
                        'factory': False,
                        'themeVisibility': deepcopy(resolved_visibility[key]),
                    }
                    state['selected'][key] = identity
            state['visibility'] = resolved_visibility
            self._commit(state)
            return before != state

    @staticmethod
    def _validate_visibility(value):
        if not isinstance(value, Mapping):
            raise WheelPresetError('wheel visibility must be an object')
        for layout, flags in value.items():
            _layout(layout)
            if not isinstance(flags, Mapping) or any(kind not in ARCHETYPES or type(enabled) is not bool
                                                     or (kind == 'hub' and not enabled) for kind, enabled in flags.items()):
                raise WheelPresetError('invalid wheel visibility')

    def visibility(self):
        with self._lock:
            return deepcopy(self._state['visibility'])

    def apply_visibility(self, value):
        self._validate_visibility(value)
        with self._transaction() as state:
            for layout, flags in value.items():
                state['visibility'][layout] = {**state['visibility'].get(layout, {}), **flags}
            self._commit(state)
        return self.payload()

    def ensure_migrated_profile(self, profile_id, name, compositions, overrides, layout=None):
        """Archive a legacy geometry source once; never overwrite user edits."""
        source_id = str(profile_id)
        with self._transaction() as state:
            if source_id in state['migrationSources']:
                return deepcopy(state['migrationSources'][source_id]['refs'])
            compositions = validate_compositions(compositions or {})
            refs = {}
            for key in PROFILES:
                selected_overrides = _overrides(geometry_for_layout(overrides or {}, key))
                recipe = compositions.get(key) or factory_wheel_composition(key)
                if not selected_overrides and _shape(recipe) == _shape(factory_wheel_composition(key)):
                    continue
                suffix = hashlib.sha256(source_id.encode()).hexdigest()[:16]
                identity = f'migrated.{suffix}.{key}'
                state['presets'][identity] = {'id': identity, 'name': (f'{name} · {_name(key)}' if name else _name(key))[:80],
                                              'layout': key, 'factory': False,
                                              'overrides': selected_overrides, 'composition': recipe}
                refs[key] = identity
            state['migrationSources'][source_id] = {'refs': refs, 'source': {
                'name': name, 'layout': layout, 'compositions': deepcopy(compositions),
                'overrides': deepcopy(overrides or {})}}
            self._commit(state)
            return deepcopy(refs)

    def migrate_current(self, opts, overrides=None, name=None):
        if self._state['currentMigrated']:
            return
        recipes = deepcopy(getattr(opts, 'wheel_compositions', {}) or {})
        refs = self.ensure_migrated_profile('legacy-current', name, recipes, overrides or {})
        with self._transaction() as state:
            if not state['currentMigrated']:
                state['selected'].update(refs)
                for layout, recipe in recipes.items():
                    state['visibility'][layout] = {ring['archetypeId']: ring['enabled'] for ring in recipe['rings']}
                state['currentMigrated'] = True
                self._commit(state)

    def hydrate_options(self, opts):
        """Publish bounded memory-only snapshot inputs, never a store handle."""
        with self._lock:
            opts.wheel_compositions = {}
            opts.wheel_geometry_presets = {}
            for layout in PROFILES:
                draft = self._draft(self._state, layout)
                opts.wheel_compositions[layout] = self._visible_composition(self._state, layout, draft['composition'])
                opts.wheel_geometry_presets[layout] = {'id': draft['sourcePresetId'],
                    'revision': self._state['revision'], 'overrides': deepcopy(draft['overrides'])}
            opts.wheel_style_catalog = self.public_catalog()
            opts.wheel_presets_active = True
            opts.wheel_preset_revision = self._state['revision']
