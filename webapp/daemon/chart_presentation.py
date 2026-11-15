# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Display-only chart view state; never part of a calculation binding.

MDO is meridian-relative. The optional reference scale is equinoctial RA on
zero-declination rays, not the physical RA or OA/OD of a plotted body.
"""
from __future__ import annotations

import copy
import math

SCHEMA_VERSION = 1
COORDINATE_MODES = frozenset(('zodiacal', 'ascensional'))
READOUTS = frozenset(('mdo-quadrant', 'absolute', 'equatorial-signs'))
# Deliberately excludes semantic aspect master/type/traditional options.
DISPLAY_OVERRIDES = frozenset((
    'drawAspects', 'houses', 'positions', 'information', 'planetarydayhour',
    'housesystem', 'showlof', 'showvertex',
    'showprenatalsyzygy', 'showprenataleclipse',
))
# The outer ring family and its all-asteroids switch are global, persisted
# options. Records saved while they were per-view overrides are read without
# them, so the global choice always wins.
RETIRED_DISPLAY_OVERRIDES = frozenset(('showfixstars', 'asteroid_outer_ring_all'))
LEGACY_ASCENSIONAL = frozenset(('mdo', 'mundane', 'ascensional_transits'))


def presentation_for_session(session: dict, options=None) -> dict:
    """Read/migrate without mutating a session or inherited preferences."""
    stored = session.get('chart_presentation')
    legacy = session.get('chart_visual_mode')
    if legacy is None and session.get('launcher_kind') == 'ascensional_transits':
        legacy = 'ascensional_transits'
    base = {
        'schemaVersion': SCHEMA_VERSION,
        'revision': 0,
        'coordinateMode': 'ascensional' if legacy in LEGACY_ASCENSIONAL else 'zodiacal',
        'convention': 'aries-mdo-asc0-ic90-dsc180-mc270',
        'showEquatorialSigns': bool(getattr(options, 'ascensional_equatorial_signs', False)),
        'readout': getattr(options, 'ascensional_readout', 'mdo-quadrant'),
        'displayOverrides': {},
    }
    if isinstance(stored, dict):
        if stored.get('schemaVersion') != SCHEMA_VERSION:
            raise ValueError('unsupported chart presentation version')
        if set(stored) - set(base):
            raise ValueError('invalid chart presentation fields')
        base.update(copy.deepcopy(stored))
        if base['coordinateMode'] not in COORDINATE_MODES or base['readout'] not in READOUTS:
            raise ValueError('invalid stored chart coordinates')
        if not isinstance(base['showEquatorialSigns'], bool):
            raise ValueError('invalid stored equatorial sign visibility')
        if isinstance(base['revision'], bool) or not isinstance(base['revision'], int) or base['revision'] < 0:
            raise ValueError('invalid chart presentation revision')
        overrides = base['displayOverrides']
        if not isinstance(overrides, dict) or set(overrides) - DISPLAY_OVERRIDES - RETIRED_DISPLAY_OVERRIDES:
            raise ValueError('invalid stored chart display overrides')
        overrides = base['displayOverrides'] = {
            key: value for key, value in overrides.items() if key not in RETIRED_DISPLAY_OVERRIDES}
        for value in overrides.values():
            if not isinstance(value, bool):
                raise ValueError('invalid stored chart visibility')
    return base


def stored_presentation(session: dict) -> dict:
    """Persist authored view state without freezing inherited Appearance defaults."""
    state = presentation_for_session(session)
    authored = session.get('chart_presentation') or {}
    for key in ('readout', 'showEquatorialSigns'):
        if key not in authored:
            state.pop(key)
    return state


def patch_presentation(session: dict, patch: dict, options=None) -> dict:
    """Validate the whole patch before installing one new view revision.

    None removes an override, restoring inheritance. No options, charts,
    cursors, bindings, contact methods or peer presentations are written.
    """
    allowed = {'coordinateMode', 'showEquatorialSigns', 'readout', 'displayOverrides'}
    if not isinstance(patch, dict) or set(patch) - allowed:
        raise ValueError('invalid chart presentation patch')
    state = presentation_for_session(session, options)
    if 'coordinateMode' in patch:
        if patch['coordinateMode'] not in COORDINATE_MODES:
            raise ValueError('invalid chart coordinate mode')
        state['coordinateMode'] = patch['coordinateMode']
    if 'readout' in patch:
        if patch['readout'] not in READOUTS:
            raise ValueError('invalid chart coordinate readout')
        state['readout'] = patch['readout']
    if 'showEquatorialSigns' in patch:
        if not isinstance(patch['showEquatorialSigns'], bool):
            raise ValueError('invalid equatorial sign visibility')
        state['showEquatorialSigns'] = patch['showEquatorialSigns']
    overrides = patch.get('displayOverrides', {})
    if not isinstance(overrides, dict) or set(overrides) - DISPLAY_OVERRIDES:
        raise ValueError('invalid chart display override')
    for key, value in overrides.items():
        if value is None:
            state['displayOverrides'].pop(key, None)
        else:
            if not isinstance(value, bool):
                raise ValueError('invalid chart display visibility')
            state['displayOverrides'][key] = value
    previous = presentation_for_session(session, options)
    if state != previous:
        state['revision'] = int(previous['revision']) + 1
    authored = copy.deepcopy(state)
    previous_authored = session.get('chart_presentation') or {}
    for key in ('readout', 'showEquatorialSigns'):
        if key not in patch and key not in previous_authored:
            authored.pop(key)
    session['chart_presentation'] = authored
    return copy.deepcopy(state)


def effective_options(options, presentation: dict):
    """A shallow options facade; local paint changes never touch global truth."""
    if not presentation['displayOverrides']:
        return options
    result = copy.copy(options)
    for key, value in presentation['displayOverrides'].items():
        if key != 'drawAspects':
            setattr(result, key, value)
    return result


def equatorial_reference_frame(ramc: float, *, owner_document_id: str, role: str) -> dict:
    """Frame owned by the primary house cross, including a corrected AT RAMC.

    Comparison and tri/quad rings share this committed frame. A side-by-side
    peer owns its own frame. Sector values never receive an ayanamsha offset.
    """
    if not math.isfinite(ramc):
        raise ValueError('equatorial frame requires a finite RAMC')
    ramc %= 360.0
    def ray(alpha):
        return (alpha - ramc - 90.0) % 360.0
    return {
        'identity': 'equinoctial-zero-declination',
        'ownerDocumentId': owner_document_id,
        'ownerRole': role,
        'ramc': ramc,
        'declination': 0.0,
        'sectors': [
            {'sign': index, 'absoluteStart': index * 30.0,
             'drawingStart': ray(index * 30.0),
             'drawingCenter': ray(index * 30.0 + 15.0)}
            for index in range(12)
        ],
    }


# Map persisted option names to the shared renderer's display fields. Semantic
# data and adjacency stay intact; local aspect hiding is paint authority only.
_RENDER_FLAGS = {
    'houses': 'showHouses', 'positions': 'showPositions',
    'information': 'showInformation', 'housesystem': 'showHouseSystem',
    'showlof': 'showLoF', 'showvertex': 'showVertex',
    'showprenatalsyzygy': 'showPrenatalSyzygy',
    'showprenataleclipse': 'showPrenatalEclipse',
}


def apply_snapshot_presentation(snapshot: dict, presentation: dict) -> None:
    """Resolve per-view composition on newly exported payloads only.

    Source style profiles and the session record retain authored bands. Every
    ring in one wheel has the owning view's capabilities. A split peer is a
    separate snapshot and is deliberately not traversed here.
    """
    if presentation['coordinateMode'] == 'zodiacal' and not presentation['displayOverrides']:
        return
    seen = set()
    charts = [snapshot.get(key) for key in (
        'primaryChart', 'comparisonChart', 'radixChart', 'displayAnchorChart',
    )] + list(snapshot.get('rings') or [])
    for chart in charts:
        if not isinstance(chart, dict) or id(chart) in seen:
            continue
        seen.add(id(chart))
        options = chart.get('options')
        if not isinstance(options, dict):
            continue
        # Detached even if an exporter reused an options dict within a bundle.
        options = dict(options)
        chart['options'] = options
        options['viewDisplayOverrides'] = dict(presentation['displayOverrides'])
        if isinstance(options.get('wheelComposition'), dict):
            options['wheelComposition'] = copy.deepcopy(options['wheelComposition'])
        for key, value in presentation['displayOverrides'].items():
            render_key = _RENDER_FLAGS.get(key)
            if render_key is not None:
                options[render_key] = value
        if 'drawAspects' in presentation['displayOverrides']:
            options['showAspects'] = presentation['displayOverrides']['drawAspects']
        if 'houses' in presentation['displayOverrides']:
            for ring in (options.get('wheelComposition') or {}).get('rings', []):
                if ring.get('archetypeId') == 'houses':
                    ring['enabled'] = presentation['displayOverrides']['houses']
        if presentation['coordinateMode'] == 'ascensional':
            options['showTerms'] = options['showDecans'] = False
            composition = options.get('wheelComposition')
            if isinstance(composition, dict):
                # Zodiac and degree bands keep their authored radii: without
                # equatorial signs the renderer labels them as the house band.
                for ring in composition.get('rings', []):
                    if ring.get('archetypeId') in ('terms', 'decans'):
                        ring['enabled'] = False
