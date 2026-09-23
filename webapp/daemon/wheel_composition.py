# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Canonical semantic wheel recipes and validated persistent composition.

Loaded once at startup. Render exports only copy this bounded in-memory state;
no profile or disk reads belong to a chart frame.
"""
from copy import deepcopy
import json
from pathlib import Path
import re
from webapp.daemon.wheel_factory import PROFILES, factory_wheel_composition

ARCHETYPES = json.loads((Path(__file__).parents[1] / 'frontend' / 'src' / 'lib' / 'chart' / 'wheel-ring-archetypes.json').read_text())
_ID = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]{0,63}$')


def builtin_composition(profile, *, terms=False, decans=False, houses=True):
    composition = factory_wheel_composition(profile)
    cusp = profile in ('houses', 'cusps')
    enabled = {'terms': terms and not cusp, 'decans': decans and not cusp, 'houses': houses}
    for ring in composition['rings']:
        if ring['archetypeId'] in enabled:
            ring['enabled'] = enabled[ring['archetypeId']]
    return composition


def validate_composition(value):
    if not isinstance(value, dict) or value.get('schemaVersion') != 1:
        raise ValueError('invalid wheel composition schema')
    projection = value.get('projection')
    if projection not in ('zodiac', 'houses'):
        raise ValueError('invalid wheel projection')
    rings = value.get('rings')
    if not isinstance(rings, list) or not 1 <= len(rings) <= len(ARCHETYPES):
        raise ValueError('invalid wheel ring count')
    ids, kinds, normalized = set(), set(), []
    for ring in rings:
        if not isinstance(ring, dict):
            raise ValueError('invalid wheel ring')
        identity, kind = ring.get('instanceId'), ring.get('archetypeId')
        if not isinstance(identity, str) or not _ID.fullmatch(identity) or identity in ids:
            raise ValueError('invalid or duplicate wheel ring identity')
        if kind not in ARCHETYPES or kind in kinds:
            raise ValueError('invalid or repeated wheel archetype')
        spec = ARCHETYPES[kind]
        enabled = ring.get('enabled')
        if type(enabled) is not bool or (enabled and projection not in spec['projections']):
            raise ValueError('wheel ring incompatible with projection')
        if ring.get('chartRole', spec['chartRole']) != spec['chartRole']:
            raise ValueError('wheel ring has invalid chart role')
        ids.add(identity)
        kinds.add(kind)
        normalized.append({'instanceId': identity, 'archetypeId': kind,
                           'enabled': enabled, 'chartRole': spec['chartRole']})
    if normalized[-1]['archetypeId'] != 'hub' or not normalized[-1]['enabled']:
        raise ValueError('aspect core must remain enabled and innermost')
    positions = {ring['archetypeId']: i for i, ring in enumerate(normalized) if ring['enabled']}
    body = positions.get('bodies')
    if body is not None:
        for key, index in positions.items():
            constraint = ARCHETYPES[key]['containment']
            if constraint in ('outside-points', 'comparison-outside-primary') and index > body:
                raise ValueError('wheel ring must remain outside chart points')
            if constraint == 'inside-points' and index < body:
                raise ValueError('wheel ring must remain inside chart points')
    outer = [index for key, index in positions.items() if ARCHETYPES[key]['chartRole'] == 'outer']
    primary = [index for key, index in positions.items() if ARCHETYPES[key]['chartRole'] == 'primary']
    if outer and primary and max(outer) > min(primary):
        raise ValueError('comparison rings must remain outside primary rings')
    return {'schemaVersion': 1, 'customized': bool(value.get('customized', True)), 'projection': projection, 'rings': normalized}


def validate_compositions(value):
    if not isinstance(value, dict) or any(key not in PROFILES for key in value):
        raise ValueError('invalid wheel recipes')
    result = {key: validate_composition(composition) for key, composition in value.items()}
    for profile, composition in result.items():
        if composition['projection'] != ('houses' if profile == 'houses' else 'zodiac'):
            raise ValueError('wheel projection incompatible with layout')
        for ring in composition['rings']:
            if ring['enabled'] and profile not in ARCHETYPES[ring['archetypeId']]['layouts']:
                raise ValueError('wheel archetype incompatible with layout')
    return result


def effective_composition(opts, profile=None):
    profile = profile or PROFILES[max(0, min(4, int(getattr(opts, 'theme', 0))))]
    stored = getattr(opts, 'wheel_compositions', {}).get(profile)
    composition = deepcopy(stored) if stored is not None else builtin_composition(
        profile, terms=bool(getattr(opts, 'showterms', False)),
        decans=bool(getattr(opts, 'showdecans', False)), houses=bool(getattr(opts, 'houses', True)))
    if getattr(opts, 'wheel_presets_active', False):
        for ring in composition['rings']:
            field = {'terms': 'showterms', 'decans': 'showdecans', 'houses': 'houses'}.get(ring['archetypeId'])
            if field:
                ring['enabled'] = bool(getattr(opts, field, field == 'houses')) and composition['projection'] in ARCHETYPES[ring['archetypeId']]['projections']
    return composition


def all_compositions(opts):
    return {profile: effective_composition(opts, profile) for profile in PROFILES}


def sync_display_flags(opts, fields):
    """Existing display shortcuts and Settings edit the same ring membership."""
    if getattr(opts, 'wheel_presets_active', False):
        return  # Visibility is applied to the snapshot copy, never the design.
    profile = PROFILES[max(0, min(4, int(getattr(opts, 'theme', 0))))]
    saved = getattr(opts, 'wheel_compositions', {}).get(profile)
    if saved is None:
        return
    for field, kind in (('showterms', 'terms'), ('showdecans', 'decans'), ('houses', 'houses')):
        if field not in fields:
            continue
        for ring in saved['rings']:
            if ring['archetypeId'] == kind:
                enabled = bool(fields[field]) and saved['projection'] in ARCHETYPES[kind]['projections']
                if ring['enabled'] != enabled:
                    saved['customized'] = True
                ring['enabled'] = enabled


def sync_legacy_display_flags(opts):
    """Keep existing display controls and shortcut toggles on canonical membership."""
    if getattr(opts, 'wheel_presets_active', False):
        return
    profile = PROFILES[max(0, min(4, int(getattr(opts, 'theme', 0))))]
    saved = getattr(opts, 'wheel_compositions', {}).get(profile)
    if saved is None:
        return
    enabled = {ring['archetypeId'] for ring in saved['rings'] if ring['enabled']}
    for field, kind in (('showterms', 'terms'), ('showdecans', 'decans'), ('houses', 'houses')):
        setattr(opts, field, kind in enabled)
