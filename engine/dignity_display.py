# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Shared presentation palette and facts; no astrology calculation changes."""
import json
from pathlib import Path

import astrology
import chart
import common

_POLICY = json.loads((Path(__file__).resolve().parents[1] / 'webapp/frontend/src/lib/chart/dignity-display-policy.json').read_text(encoding='utf-8'))
MINOR_DIGNITY_BLEND_WEIGHTS = tuple(_POLICY['minorBlendWeights'])
MINOR_DIGNITY_COLOR_ROLES = tuple(_POLICY['minorColorRoles'])
DIGNITY_COLOR_ROLES = {
    chart.Chart.DOMICIL: ('--morinus-dignity-domicil', 'clrdomicil'),
    chart.Chart.EXAL: ('--morinus-dignity-exal', 'clrexal'),
    chart.Chart.PEREGRIN: ('--morinus-peregrin', 'clrperegrin'),
    chart.Chart.CASUS: ('--morinus-dignity-casus', 'clrcasus'),
    chart.Chart.EXIL: ('--morinus-dignity-exil', 'clrexil'),
}


def minor_dignity_facts(chrt, body_id, longitude=None):
    """Count term, face, and the chart's primary triplicity ruler for paint.

    Secondary/participating status remains in the complete dignity assessment
    but contributes no color. The chart owns zodiac, sect, and configured tables;
    this display policy does not change dignity scoring or peregrine status.
    """
    empty = {"minorDignityCount": 0, "primaryTriplicityElement": None, "hasTermDignity": False, "hasFaceDignity": False}
    try:
        pid = int(body_id)
        if not astrology.SE_SUN <= pid <= astrology.SE_SATURN:
            return empty
        info = (chrt.get_planet_essential_dignities(pid) if longitude is None
                else chrt.get_planet_essential_dignities(pid, longitude))
        if not info:
            return empty
        primary = any(row['label'] == 'Triplicity' and row.get('status_label') == 'Trigon lord'
                      for row in info['rows'])
        term = any(row['label'] == 'Term' and row.get('active', False) for row in info['rows'])
        face = any(row['label'] == 'Face' and row.get('active', False) for row in info['rows'])
        count = int(primary) + int(term) + int(face)
        lon = chrt.get_planet_body(pid).data[0] if longitude is None and primary else longitude
        element = common.get_sign_element_key(int(float(lon) // 30)) if primary else None
        return {"minorDignityCount": count, "primaryTriplicityElement": element,
                "hasTermDignity": term, "hasFaceDignity": face}
    except (AttributeError, TypeError, ValueError, KeyError):
        return empty


def minor_dignity_assessment(chrt, body_id, longitude=None):
    facts = minor_dignity_facts(chrt, body_id, longitude)
    return facts['minorDignityCount'], facts['primaryTriplicityElement']


def minor_dignity_count(chrt, body_id, longitude=None) -> int:
    return minor_dignity_assessment(chrt, body_id, longitude)[0]


def minor_dignity_color(display_options, count: int):
    neutral = getattr(display_options, 'clrperegrin', (205, 205, 209))
    if not getattr(display_options, 'blendminordignities', False) or not count:
        return neutral
    positive = getattr(display_options, 'clrdomicil', neutral)
    weight = MINOR_DIGNITY_BLEND_WEIGHTS[min(3, max(0, count))]
    return tuple(int(a + (b - a) * weight + 0.5) for a, b in zip(neutral, positive))


def minor_dignity_palette(options):
    return tuple(minor_dignity_color(options, count) for count in (1, 2, 3))


def dignity_color(options, dignity_code, minor_count=0):
    try:
        code = int(dignity_code)
    except (TypeError, ValueError):
        code = chart.Chart.PEREGRIN
    if code == chart.Chart.PEREGRIN:
        return minor_dignity_color(options, minor_count)
    return getattr(options, DIGNITY_COLOR_ROLES.get(code, DIGNITY_COLOR_ROLES[chart.Chart.PEREGRIN])[1])


def dignity_color_role(dignity_code, minor_count=0):
    try:
        code = int(dignity_code)
    except (TypeError, ValueError):
        code = chart.Chart.PEREGRIN
    if code == chart.Chart.PEREGRIN and minor_count:
        return MINOR_DIGNITY_COLOR_ROLES[min(3, max(1, int(minor_count))) - 1]
    return DIGNITY_COLOR_ROLES.get(code, DIGNITY_COLOR_ROLES[chart.Chart.PEREGRIN])[0]


def chart_dignity_color(chrt, options, body_id):
    try:
        code = chrt.dignity(body_id)
    except (AttributeError, IndexError, TypeError):
        code = chart.Chart.PEREGRIN
    count = minor_dignity_count(chrt, body_id) if code == chart.Chart.PEREGRIN else 0
    return dignity_color(options, code, count)
