# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Versioned original wheel layouts, independent of saved options and themes.

The renderer consumes the same checked-in definition. Read once at import;
callers receive fresh working copies and cannot mutate the factory source.
These are layout defaults, not astrology settings or color presets.
"""
import json
from pathlib import Path
from types import MappingProxyType


_SOURCE = Path(__file__).parents[1] / 'frontend' / 'src' / 'lib' / 'chart' / 'wheel-factory-v1.json'
_DOCUMENT = json.loads(_SOURCE.read_text(encoding='utf-8'))
FACTORY_VERSION = _DOCUMENT['factoryVersion']
FACTORY_SOURCE_COMMIT = _DOCUMENT['sourceCommit']
PROFILES = ('classic', 'compact', 'anglo', 'houses', 'cusps')
if _DOCUMENT['schemaVersion'] != 1 or set(_DOCUMENT['layouts']) != set(PROFILES):
    raise ValueError('invalid original wheel factory definition')

# Serialized definitions keep even nested objects immutable between requests.
_LAYOUTS = MappingProxyType({
    profile: json.dumps({
        **_DOCUMENT['layouts'][profile],
        'factoryVersion': FACTORY_VERSION,
        'sourceCommit': FACTORY_SOURCE_COMMIT,
        'geometry': _DOCUMENT['geometry'][profile],
        'sharedGeometry': {
            'classic': _DOCUMENT['geometry']['classic'],
            'biwheel': _DOCUMENT['geometry']['biwheel'],
        },
    })
    for profile in PROFILES
})
_COMPOSITIONS = MappingProxyType({
    profile: json.dumps(_DOCUMENT['layouts'][profile]['composition'])
    for profile in PROFILES
})
del _DOCUMENT


def factory_wheel_layout(profile: str) -> dict:
    """Return the original layout, including its single/comparison geometry."""
    try:
        return json.loads(_LAYOUTS[profile])
    except (KeyError, TypeError) as exc:
        raise ValueError('unknown factory wheel layout') from exc


def factory_wheel_composition(profile: str) -> dict:
    """Fresh default recipe; customization never rewrites the original."""
    try:
        return json.loads(_COMPOSITIONS[profile])
    except (KeyError, TypeError) as exc:
        raise ValueError('unknown factory wheel layout') from exc


def factory_wheel_catalog() -> dict:
    """Read-only factory settings API; never sample the active appearance."""
    return {
        'factoryVersion': FACTORY_VERSION,
        'sourceCommit': FACTORY_SOURCE_COMMIT,
        'layouts': {profile: factory_wheel_layout(profile) for profile in PROFILES},
    }
