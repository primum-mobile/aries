# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Shared wheel geometry ownership, loaded once outside rendering hot paths."""
import json
import re
from copy import deepcopy
from pathlib import Path

_SOURCE = Path(__file__).parents[1] / 'frontend' / 'src' / 'lib' / 'chart' / 'wheel-geometry-ownership.json'
_CONTRACT = json.loads(_SOURCE.read_text(encoding='utf-8'))
LEGACY_GEOMETRY_TOKENS = frozenset(_CONTRACT['legacyTokens'])
_LEGACY_KEYS = LEGACY_GEOMETRY_TOKENS | frozenset(_CONTRACT['legacyTokens'].values())
_PROPERTIES = frozenset(_CONTRACT['authoringProperties'])
_SCALE_CLASSES = frozenset(_CONTRACT['scaleClasses'])
_DIRECT_KEY = re.compile(r'^authoring\.wheel\.(base|classic|compact|anglo|houses|cusps)\.(.+)\.([^.]+)$')


def is_geometry_key(key: str) -> bool:
    if key in _LEGACY_KEYS:
        return True
    match = _DIRECT_KEY.fullmatch(key)
    return bool(match and (match[3] in _PROPERTIES or (match[3] == 'scale' and match[2] in _SCALE_CLASSES)))


def geometry_overrides(values: dict) -> dict:
    return {key: deepcopy(value) for key, value in values.items() if is_geometry_key(key)}


def appearance_overrides(values: dict) -> dict:
    return {key: deepcopy(value) for key, value in values.items() if not is_geometry_key(key)}


def geometry_for_layout(values: dict, layout: str) -> dict:
    """Freeze inherited Base geometry into a selected wheel's own draft."""
    geometry = geometry_overrides(values)
    result = {}
    for key, value in geometry.items():
        match = _DIRECT_KEY.fullmatch(key)
        if not match:
            result[key] = value
        elif match[1] == 'base':
            result[key.replace('.base.', f'.{layout}.', 1)] = value
    for key, value in geometry.items():
        match = _DIRECT_KEY.fullmatch(key)
        if match and match[1] == layout:
            result[key] = value
    return result
