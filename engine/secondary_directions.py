# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""wx-free secondary/minor/tertiary direction row builder.

EXTRACTED verbatim from ``secdirframe.py`` (which imports wx and so cannot run in
the daemon). The desktop list window and the daemon both import the row math from
here so there is exactly ONE implementation of the secondary-directions search.

Sources (the lines moved here, unchanged in behaviour):
  - ``SECONDARY_DIRECTION_RANGES`` / ``SECONDARY_DIRECTION_LIMIT`` — secdirframe.py:630,637
  - ``build_secondary_direction_rows``                            — secdirframe.py:691
  - ``_secondary_progressed_promittor_ids``                       — secdirframe.py:731
  - ``_secondary_radix_target_ids``                              — secdirframe.py:743
  - ``_birth_date`` / ``_age_range_for_reference``                — secdirframe.py:667,675

The math touches only wx-free modules: searchcatalog, searchquery, searchbackend,
posfordate, astrology, symbolic_time, datetime.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import math

import astrology
import chart
import common
import houses
import mtexts
import posfordate
import searchbackend
import searchcatalog
import searchquery
import symbolic_time
import util
from engine import cheby_progressions

SECONDARY_DIRECTION_YEARS = 150
SECONDARY_DIRECTION_RANGES = (
    (0, 25),
    (25, 50),
    (50, 75),
    (75, 100),
    (100, 150),
)
SECONDARY_DIRECTION_LIMIT = 10000

# Every options attribute a cached secondary-progression row (engine rows,
# catalog, serialized fields) can depend on.  Established by recording every
# attribute read on ``radix.options`` while building and serializing rows for
# all methods x directions x temporal payloads, tropical and sidereal, both
# angle methods and both day types, plus the static reads of
# cheby_progressions / posfordate / searchbackend's secondary path and the
# chart-construction inputs that feed the search catalog's universe (Lots,
# asteroids, nodes, syzygy).  Colours and date formats are NOT here: the list
# palette, ``displayDate`` and ``sessionLabel`` are applied per response.
# tests/test_secondary_progression_list_contract.py walks a broad option set
# and fails when an attribute outside this list changes rows.
SECONDARY_ROW_OPTION_FIELDS = (
    # zodiac, houses, ephemeris frame
    'ayanamsha', 'hsys', 'topocentric', 'asteroid_ephe_path',
    # progression method settings
    'progressed_angle_method', 'progression_day_type',
    'solar_arc_angle_method', 'solar_arc_angle_mode', 'extendedradixstations',
    # point universe and point definitions
    'meannode', 'meanapogee', 'showapogee', 'showchiron', 'transcendental',
    'shownodes', 'lotoffortune', 'arabicparts', 'asteroids',
    'syzmoon', 'prenatal_eclipse_mode', 'usedaynightorb', 'daynightorbdeg',
    'daynightorbmin',
    # dignity codes carried in row metadata (palette roles read them)
    'dignities', 'terms', 'decans', 'trips', 'selterm', 'seldecan', 'seltrip',
    'oneruler', 'dignityscores', 'blendminordignities', 'useexaltationmercury',
    # labels and glyph sets baked into serialized text
    'langid', 'signs', 'fixstarAliasMap', 'useIndianFixstarNames',
)


def _glyph_table_identity():
    """Glyph tables serialized into row fields (promGlyph/sigGlyph/aspectGlyph)."""
    table = common.common
    return [
        list(table.Planets), list(table.Aspects), list(table.Signs1),
        list(table.Signs2), table.Chiron, table.fortune,
    ]


def secondary_rows_options_key(options):
    """Content identity of every option the secondary progression rows read."""
    values = {field: getattr(options, field, None) for field in SECONDARY_ROW_OPTION_FIELDS}
    encoded = json.dumps(
        [values, _glyph_table_identity()],
        sort_keys=True, default=repr, separators=(',', ':'),
    )
    return 'secondary-options-v2:' + hashlib.sha256(encoded.encode('utf-8')).hexdigest()[:24]
# The list paints a small window centred on the focus age first, then grows
# its coverage outward by doubling up to one stitch chunk per fetch (years of
# life). Both are sized to the methods' row density: a first window is a
# couple of screens of rows, a chunk stays well under the row cap.
SECONDARY_FIRST_WINDOW_YEARS = {
    posfordate.SECONDARY: 2.0,
    posfordate.TERTIARY: 0.2,
    posfordate.MINOR: 0.1,
}
SECONDARY_STITCH_CHUNK_YEARS = {
    posfordate.SECONDARY: 10.0,
    posfordate.TERTIARY: 1.0,
    posfordate.MINOR: 0.5,
}
SECONDARY_DIRECTION_DIRECT = 'direct'
SECONDARY_DIRECTION_CONVERSE = 'converse'
SECONDARY_DIRECTION_BOTH = 'both'

_CONVERSE_SECONDARY_STEP_YEARS = 0.25
# Half-width (degrees of the mover's motion) of the bracket that polishes a
# fitted converse root on the canonical position; widened when it misses.
_CONVERSE_POLISH_BRACKET_DEG = 1e-3
# Polished roots closer than this (years of life) are one contact.
_CONVERSE_DUPLICATE_AGE_YEARS = 1e-5
# A refined converse contact must put the mover within this arc of its target.
_CONVERSE_CONTACT_TOLERANCE_DEG = 0.01
_CONVERSE_SECONDARY_ASPECT_DEFS = (
    (searchquery.SearchQuery.ASPECT_CONJUNCTION, chart.Chart.CONJUNCTIO, mtexts.txts['Conjunctio']),
    ('semisextile', chart.Chart.SEMISEXTIL, mtexts.txts['Semisextil']),
    ('semisquare', chart.Chart.SEMIQUADRAT, mtexts.txts['Semiquadrat']),
    (searchquery.SearchQuery.ASPECT_SEXTILE, chart.Chart.SEXTIL, mtexts.txts['Sextil']),
    (searchquery.SearchQuery.ASPECT_SQUARE, chart.Chart.QUADRAT, mtexts.txts['Quadrat']),
    (searchquery.SearchQuery.ASPECT_TRINE, chart.Chart.TRIGON, mtexts.txts['Trigon']),
    ('sesquiquadrate', chart.Chart.SESQUIQUADRAT, mtexts.txts['Sesquiquadrat']),
    (searchquery.SearchQuery.ASPECT_QUINCUNX, chart.Chart.QUINQUNX, mtexts.txts['Quinqunx']),
    (searchquery.SearchQuery.ASPECT_OPPOSITION, chart.Chart.OPPOSITIO, mtexts.txts['Oppositio']),
)
# The progression list uses the two independent axes as actors. DSC/IC are
# unsupported as separate actors (opposite ends of ASC/MC); receiving roles
# retain their existing catalog contract.
SECONDARY_ACTING_ANGLE_IDS = ('angle:asc', 'angle:mc', 'angle:dsc', 'angle:ic')


def _birth_date(radix):
    return datetime.date(
        int(getattr(radix.time, 'origyear', radix.time.year)),
        int(getattr(radix.time, 'origmonth', radix.time.month)),
        int(getattr(radix.time, 'origday', radix.time.day)),
    )


def age_range_for_reference(radix, reference_datetime):
    if reference_datetime is None or radix is None or getattr(radix, 'time', None) is None:
        return SECONDARY_DIRECTION_RANGES[0]
    try:
        y, m, d, h, mi, s = [int(v) for v in tuple(reference_datetime)[:6]]
        calflag = symbolic_time._calflag_from_chart(radix)
        reference_jd = astrology.swe_julday(y, m, d, h + mi / 60.0 + s / 3600.0, calflag)
        age_years = max(0.0, (float(reference_jd) - float(radix.time.jd)) / 365.2425)
    except Exception:
        return SECONDARY_DIRECTION_RANGES[0]
    for start_age, end_age in SECONDARY_DIRECTION_RANGES:
        if age_years < float(end_age):
            return start_age, end_age
    start_age = math.floor(age_years / 25.0) * 25.0
    return start_age, start_age + 25.0


def _secondary_catalog(radix, start_age, end_age, method, direction):
    """Keep the semantic universe, but omit unavailable bodies from this scan.

    Availability belongs to the requested ephemeris interval, not an options
    toggle. A later window gets a fresh catalog and can use the body again.
    """
    catalog = searchcatalog.SearchCatalog(radix)
    catalog.secondary_unavailable_ephemeris = {}
    context = searchbackend._planet_ephemeris_context(radix)
    sign = -1.0 if direction == SECONDARY_DIRECTION_CONVERSE else 1.0
    ages = (float(start_age), (float(start_age) + float(end_age)) / 2.0, float(end_age))
    with context.activate():
        for obj in catalog.objects:
            if not obj.id.startswith('asteroid:'):
                continue
            if obj.longitude is None:
                catalog.secondary_unavailable_ephemeris[obj.id] = obj.label
                continue
            for age in ages:
                searchbackend.transit_fast_api.check_search_cancellation()
                jd = float(radix.time.jd) + sign * _converse_symbolic_age(radix, age, method)
                status, data, _error = astrology.swe_calc_ut_ex(jd, obj.planet_index, context.flags)
                if int(status) & 0xFFFFFFFF == 0xFFFFFFFF or len(data) < 4:
                    catalog.secondary_unavailable_ephemeris[obj.id] = obj.label
                    break
    return catalog


def unavailable_secondary_ephemeris(catalog):
    unavailable = dict(getattr(catalog, 'secondary_unavailable_ephemeris', {}))
    for obj in catalog.objects:
        if getattr(obj, 'ephemeris_unavailable', False):
            unavailable[obj.id] = obj.label
    return unavailable


def _secondary_progressed_promittor_ids(catalog, available_only=True):
    ids = []
    for object_id in catalog.promittor_ids:
        obj = catalog.get(object_id)
        if available_only and object_id in getattr(catalog, 'secondary_unavailable_ephemeris', {}):
            continue
        if obj is None or obj.family != searchcatalog.SearchObject.FAMILY_PLANET:
            continue
        if obj.planet_index is None:
            continue
        ids.append(object_id)
    return ids


def _secondary_radix_target_ids(catalog, available_only=True):
    ids = []
    for object_id in catalog.builtin_significator_ids:
        obj = catalog.get(object_id)
        if obj is None or (available_only and obj.longitude is None):
            continue
        if obj.family in (
            searchcatalog.SearchObject.FAMILY_PLANET,
            searchcatalog.SearchObject.FAMILY_NODE,
            searchcatalog.SearchObject.FAMILY_ANGLE,
            searchcatalog.SearchObject.FAMILY_HOUSE_CUSP,
            searchcatalog.SearchObject.FAMILY_FORTUNE,
        ):
            ids.append(object_id)
    return ids


def secondary_acting_angle_ids(catalog):
    return [
        object_id for object_id in SECONDARY_ACTING_ANGLE_IDS
        if catalog.get(object_id) is not None
        and catalog.get(object_id).family == searchcatalog.SearchObject.FAMILY_ANGLE
    ]


def secondary_node_ids(catalog):
    return [
        obj.id for obj in catalog.objects
        if obj.family == searchcatalog.SearchObject.FAMILY_NODE
    ]


def secondary_vertex_acting_supported(radix):
    """The progressed Vertex follows the progressed ARMC. Mean-quotidian angles turn
    the ARMC a full circle per progressed day, which the daily snapshot scan cannot
    bracket; that one method keeps the Vertex as a receiving point only."""
    return not _secondary_quotidian_angles(radix)


def secondary_fortune_acting_supported(radix):
    """Fortune's day/night formula flips whenever the progressed Ascendant passes the
    Sun. Mean-quotidian angles do that twice per progressed day, so the progressed
    Lot jumps instead of moving and has no contacts to solve; Fortune then stays a
    receiving point only."""
    return not _secondary_quotidian_angles(radix)


def _secondary_quotidian_angles(radix):
    angle_method = posfordate.progression_angle_method(
        getattr(radix.options, 'progressed_angle_method', posfordate.TRUE_SOLAR_ARC_LON)
    )
    return angle_method == posfordate.MEAN_QUOTIDIAN_Q2


def secondary_acting_point_ids(catalog, radix):
    """Non-planet progressed movers: the four angles, both nodes, Fortune and Vertex."""
    ids = secondary_acting_angle_ids(catalog) + secondary_node_ids(catalog)
    if catalog.get('point:lof') is not None and secondary_fortune_acting_supported(radix):
        ids.append('point:lof')
    if catalog.get('point:vertex') is not None and secondary_vertex_acting_supported(radix):
        ids.append('point:vertex')
    return ids


def secondary_chunk_years(radix, method):
    """Years of life per list fetch and per scan chunk.

    Mean-quotidian angles turn the progressed ARMC a full circle per progressed
    day, so every angle-driven point (Asc, MC, Dsc, IC, Fortune) meets each
    aspect target about once a year of secondary life. One year of secondary
    life, scaled by the method's symbolic clock, keeps a chunk well inside the
    row budget; slower angle methods keep the long chunks.
    """
    method = posfordate.progression_method(method)
    base = SECONDARY_STITCH_CHUNK_YEARS.get(method, SECONDARY_STITCH_CHUNK_YEARS[posfordate.SECONDARY])
    angle_method = posfordate.progression_angle_method(
        getattr(radix.options, 'progressed_angle_method', posfordate.TRUE_SOLAR_ARC_LON)
    )
    if angle_method != posfordate.MEAN_QUOTIDIAN_Q2:
        return float(base)
    scale = abs(float(posfordate.progression_symbolic_scale(method) or 1.0))
    return min(float(base), 1.0 / scale)


def secondary_first_window_years(radix, method):
    """Years of life in the list's first, focus-centred window."""
    method = posfordate.progression_method(method)
    base = SECONDARY_FIRST_WINDOW_YEARS.get(method, SECONDARY_FIRST_WINDOW_YEARS[posfordate.SECONDARY])
    return min(float(base), secondary_chunk_years(radix, method))


def secondary_point_role_defaults(object_id, can_act, can_receive):
    """Default (from, to) roles: the shared list-filter points
    (searchcatalog.LIST_DEFAULT_POINT_IDS, progressed Moon included) wherever
    the point supports the role; everything else waits for an explicit choice."""
    default = object_id in searchcatalog.LIST_DEFAULT_POINT_IDS
    return bool(can_act and default), bool(can_receive and default)


def normalize_secondary_direction(direction):
    value = str(direction or SECONDARY_DIRECTION_DIRECT).strip().lower()
    aliases = {
        'p': SECONDARY_DIRECTION_DIRECT,
        'progressed': SECONDARY_DIRECTION_DIRECT,
        'secondary': SECONDARY_DIRECTION_DIRECT,
        're': SECONDARY_DIRECTION_CONVERSE,
        'regressed': SECONDARY_DIRECTION_CONVERSE,
        'regressive': SECONDARY_DIRECTION_CONVERSE,
        'all': SECONDARY_DIRECTION_BOTH,
    }
    value = aliases.get(value, value)
    if value not in (SECONDARY_DIRECTION_DIRECT, SECONDARY_DIRECTION_CONVERSE, SECONDARY_DIRECTION_BOTH):
        return SECONDARY_DIRECTION_DIRECT
    return value


def build_secondary_direction_rows(radix, start_age=0, end_age=25, limit=SECONDARY_DIRECTION_LIMIT, method=posfordate.SECONDARY, direction=SECONDARY_DIRECTION_DIRECT):
    direction = normalize_secondary_direction(direction)
    method = posfordate.progression_method(method)
    if direction == SECONDARY_DIRECTION_DIRECT:
        return _build_direct_secondary_direction_rows(radix, start_age, end_age, limit=limit, method=method)

    catalog = None
    rows = []
    truncated = False
    if direction == SECONDARY_DIRECTION_BOTH:
        direct_limit = int(limit) * 2 if limit is not None else SECONDARY_DIRECTION_LIMIT
        rows, truncated, catalog = _build_direct_secondary_direction_rows(
            radix, start_age, end_age, limit=direct_limit, method=method,
        )
        _mark_secondary_direction_rows(rows, SECONDARY_DIRECTION_DIRECT, 'p')

    converse_limit = int(limit) * 2 if direction == SECONDARY_DIRECTION_BOTH and limit is not None else limit
    converse_rows, converse_truncated, converse_catalog = build_converse_secondary_direction_rows(
        radix, start_age=start_age, end_age=end_age, limit=converse_limit, method=method,
    )
    if catalog is None:
        catalog = converse_catalog
    elif converse_catalog is not None:
        catalog.secondary_unavailable_ephemeris.update(unavailable_secondary_ephemeris(converse_catalog))
    rows.extend(converse_rows)
    truncated = truncated or converse_truncated
    rows.sort(key=_secondary_row_sort_key)
    if limit is not None and len(rows) > int(limit):
        rows = rows[:int(limit)]
        truncated = True
    return rows, truncated, catalog


def _build_direct_secondary_direction_rows(radix, start_age=0, end_age=25, limit=SECONDARY_DIRECTION_LIMIT, method=posfordate.SECONDARY):
    if radix is None or getattr(radix, 'time', None) is None:
        return [], False, None
    catalog = _secondary_catalog(radix, start_age, end_age, method, SECONDARY_DIRECTION_DIRECT)
    query = searchquery.SearchQuery()
    query.set_techniques([searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS])
    query.set_aspects([aspect_id for aspect_id, _chart_aspect, _both_sides, _label in searchbackend.ASPECT_DEFS])
    planet_ids = _secondary_progressed_promittor_ids(catalog)
    query.set_promittor_ids(planet_ids + secondary_acting_point_ids(catalog, radix))
    query.set_significator_ids(_secondary_radix_target_ids(catalog))
    query.set_progression_method(int(posfordate.progression_method(method)))
    birth_date = _birth_date(radix)
    start_date = birth_date + datetime.timedelta(days=int(round(float(start_age) * 365.2425)))
    # Search in age chunks and stop once the row budget is met. The search's own
    # cap fills one mover at a time, so it never sees a cap here; every chunk is
    # complete, and the final date-ordered cut is an exact prefix of the window.
    chunk_years = secondary_chunk_years(radix, method)
    rows = []
    covered_age = float(start_age)
    while covered_age < float(end_age):
        searchbackend.transit_fast_api.check_search_cancellation()
        chunk_end_age = min(float(end_age), covered_age + chunk_years)
        chunk_start = birth_date + datetime.timedelta(days=int(round(covered_age * 365.2425)))
        chunk_end = birth_date + datetime.timedelta(days=int(round(chunk_end_age * 365.2425)))
        if chunk_end > chunk_start:
            chunk_rows, _chunk_truncated = searchbackend.search(catalog, radix, query, chunk_start, chunk_end, None)
            rows.extend(chunk_rows)
        covered_age = chunk_end_age
        if limit is not None and len(rows) > int(limit):
            break
    end_date = birth_date + datetime.timedelta(days=int(round(covered_age * 365.2425)))
    truncated = covered_age < float(end_age)
    rows = searchbackend._dedupe_rows(rows)
    station_rows = searchbackend.build_secondary_station_rows(
        catalog,
        radix,
        start_date,
        end_date,
        promittor_ids=planet_ids,
        method=posfordate.progression_method(method),
    )
    ingress_rows = searchbackend.build_secondary_ingress_rows(
        catalog,
        radix,
        start_date,
        end_date,
        promittor_ids=planet_ids + secondary_node_ids(catalog),
        method=posfordate.progression_method(method),
        direction=SECONDARY_DIRECTION_DIRECT,
    )
    if station_rows or ingress_rows:
        rows = searchbackend._dedupe_rows(
            list(rows) + list(station_rows) + list(ingress_rows)
        )
    rows.sort(key=lambda row: (
        row.event_jd if row.event_jd is not None else float('inf'),
        row.technique,
        row.promittor_label,
        row.significator_label,
        row.aspect,
        row.notes,
    ))
    if limit is not None and len(rows) > int(limit):
        rows = rows[:int(limit)]
        truncated = True
    return rows, truncated, catalog


def build_converse_secondary_direction_rows(radix, start_age=0, end_age=25, limit=SECONDARY_DIRECTION_LIMIT, method=posfordate.SECONDARY):
    if radix is None or getattr(radix, 'time', None) is None:
        return [], False, None
    method = posfordate.progression_method(method)
    catalog = _secondary_catalog(radix, start_age, end_age, method, SECONDARY_DIRECTION_CONVERSE)
    start_age = max(0.0, float(start_age))
    end_age = max(start_age, float(end_age))
    if end_age <= start_age:
        return [], False, catalog

    targets = _converse_target_specs(catalog)
    rows = []
    _append_converse_rows(rows, catalog, radix, start_age, end_age, targets, method)
    # Every contact in the window is solved; a row budget cuts at the last kept
    # row's age so the ingress rows cover exactly the same span.
    covered_age = end_age
    if limit is not None and len(rows) > int(limit):
        rows.sort(key=_secondary_row_sort_key)
        rows = rows[:int(limit)]
        covered_age = float(rows[-1].metadata.get('converse_age', end_age))
    birth_date = _birth_date(radix)
    start_date = birth_date + datetime.timedelta(days=int(round(start_age * 365.2425)))
    end_date = birth_date + datetime.timedelta(days=int(round(covered_age * 365.2425)))
    ingress_rows = searchbackend.build_secondary_ingress_rows(
        catalog,
        radix,
        start_date,
        end_date,
        promittor_ids=_secondary_progressed_promittor_ids(catalog) + secondary_node_ids(catalog),
        method=method,
        direction=SECONDARY_DIRECTION_CONVERSE,
    )
    station_rows = searchbackend.build_secondary_station_rows(
        catalog,
        radix,
        start_date,
        end_date,
        promittor_ids=_secondary_progressed_promittor_ids(catalog),
        method=method,
        direction=SECONDARY_DIRECTION_CONVERSE,
    )
    _mark_secondary_direction_rows(
        list(ingress_rows) + list(station_rows),
        SECONDARY_DIRECTION_CONVERSE,
        're',
    )
    rows.extend(ingress_rows)
    rows.extend(station_rows)
    rows.sort(key=_secondary_row_sort_key)
    rows = searchbackend._dedupe_rows(rows)
    rows.sort(key=_secondary_row_sort_key)
    truncated = covered_age < end_age
    if limit is not None and len(rows) > int(limit):
        rows = rows[:int(limit)]
        truncated = True
    return rows, truncated, catalog


def _mark_secondary_direction_rows(rows, direction, motion_code):
    for row in rows:
        searchbackend.transit_fast_api.check_search_cancellation()
        if not isinstance(getattr(row, 'metadata', None), dict):
            continue
        row.metadata['secondary_direction'] = direction
        row.metadata['motion_code'] = motion_code


def _secondary_row_sort_key(row):
    return (
        row.event_jd if row.event_jd is not None else float('inf'),
        row.technique,
        row.promittor_label,
        row.significator_label,
        row.aspect,
        getattr(row, 'notes', ''),
    )


def _converse_symbolic_age(radix, age_years, method):
    method = posfordate.progression_method(method)
    scale = posfordate.progression_symbolic_scale(method) or 1.0
    symbolic_age = float(age_years) * float(scale)
    day_type = getattr(radix.options, 'progression_day_type', posfordate.PROGRESSION_DAY_TYPE_Q2)
    if (
        method in (posfordate.SECONDARY, posfordate.TERTIARY)
        and posfordate.progression_day_type(day_type) == posfordate.PROGRESSION_DAY_TYPE_Q1
    ):
        symbolic_age *= symbolic_time.BIJA_RATIO
    return symbolic_age


def _converse_target_specs(catalog):
    targets = []
    for sig_id in _secondary_radix_target_ids(catalog):
        sig = catalog.get(sig_id)
        if sig is None:
            continue
        for aspect_id, aspect_index, aspect_label in _CONVERSE_SECONDARY_ASPECT_DEFS:
            for target_lon in searchbackend._aspect_target_longitudes(sig.longitude, aspect_index):
                targets.append((sig_id, aspect_id, aspect_index, aspect_label, target_lon))
    return targets


def _converse_mover_ids(catalog, radix):
    """Every converse mover: planets/asteroids, the four angles, Vertex, nodes, Fortune."""
    ids = list(_secondary_progressed_promittor_ids(catalog)) + secondary_acting_angle_ids(catalog)
    if catalog.get('point:vertex') is not None and secondary_vertex_acting_supported(radix):
        ids.append('point:vertex')
    ids.extend(secondary_node_ids(catalog))
    if catalog.get('point:lof') is not None and secondary_fortune_acting_supported(radix):
        ids.append('point:lof')
    return ids


def _converse_state_functions(catalog, radix, prom_ids, method):
    """Canonical converse state per mover: (lon, speed, motion_jd, symbolic_age)."""
    context = searchbackend._planet_ephemeris_context(radix)
    angle_cache = {}

    def angle_state(age, vertex=False):
        # Asc/MC/Dsc/IC read the cusp-free angle projection; only the Vertex
        # needs the full progressed house state.
        key = (round(float(age), 9), bool(vertex))
        if key not in angle_cache:
            if vertex:
                angle_cache[key] = _converse_angle_longitudes(radix, age, method)
            else:
                angle_cache[key] = _converse_axis_longitudes(radix, age, method)
        return angle_cache[key]

    def symbolic(age):
        return _converse_symbolic_age(radix, age, method)

    out = {}
    for prom_id in prom_ids:
        prom = catalog.get(prom_id)
        if prom is None:
            continue
        if prom_id in _CONVERSE_ANGLE_STATE_IDS:
            def state_at(age, _prom_id=prom_id):
                lon = angle_state(age, _prom_id == 'point:vertex').get(_prom_id)
                if lon is None:
                    return None
                symbolic_age = symbolic(age)
                return lon, None, float(radix.time.jd) - float(symbolic_age), float(symbolic_age)
        elif prom.family == searchcatalog.SearchObject.FAMILY_NODE or prom_id == 'point:lof':
            def state_at(age, _prom=prom):
                symbolic_age = symbolic(age)
                lon = searchbackend._secondary_symbolic_object_longitude(
                    _prom, radix, -float(symbolic_age), method=method,
                )
                if lon is None:
                    return None
                return lon, None, float(radix.time.jd) - float(symbolic_age), float(symbolic_age)
        elif prom.planet_index is not None:
            def state_at(age, _prom=prom):
                return _converse_planet_state(radix, _prom, age, context.flags, method, context)
        else:
            continue
        out[prom_id] = state_at
    return out


_CONVERSE_ANGLE_STATE_IDS = ('angle:asc', 'angle:mc', 'angle:dsc', 'angle:ic', 'point:vertex')


def _append_converse_rows(rows, catalog, radix, start_age, end_age, targets, method, prom_ids=None):
    """Solve converse contacts on the same Chebyshev fits as the direct list.

    Converse motion at age a is the ephemeris read at birth - symbolic(a), so
    one fit over the mirrored ephemeris span serves every mover; each fitted
    root is then polished on the canonical converse position, which keeps the
    contact exact to below a display second.
    """
    if end_age <= start_age:
        return
    if prom_ids is None:
        prom_ids = _converse_mover_ids(catalog, radix)
    states = _converse_state_functions(catalog, radix, prom_ids, method)
    # Symbolic age is linear in age (method scale x optional bija ratio).
    factor = _converse_symbolic_age(radix, 1.0, method)
    if not factor:
        return
    sym_lo = _converse_symbolic_age(radix, start_age, method)
    sym_hi = _converse_symbolic_age(radix, end_age, method)
    fit = cheby_progressions.ProgressionFit(radix, radix.options, -sym_hi, -sym_lo, method=method)
    for prom_id, state_at in states.items():
        searchbackend.transit_fast_api.check_search_cancellation()
        fit_id, fit_offset = searchbackend._SECONDARY_ANGLE_AXIS_ALIASES.get(prom_id, (prom_id, 0.0))
        fit_obj = catalog.get(fit_id)
        kind = searchbackend._cheby_body_kind_for_promittor(fit_obj, radix.options)
        if kind is None or not cheby_progressions.supported_body_id(catalog, radix.options, fit_id):
            raise ValueError('converse mover has no progression fit: %s' % prom_id)
        try:
            fit.fit(fit_id, kind, planet_index=fit_obj.planet_index)
        except cheby_progressions.EphemerisUnavailable:
            fit_obj.ephemeris_unavailable = True
            continue
        label = catalog.get(prom_id).label
        state_at = _memoized_state(state_at)
        start_state = state_at(float(start_age))
        solve_lons = [util.normalize(target[4] - fit_offset) if fit_offset else target[4] for target in targets]
        for (sig_id, aspect_id, aspect_index, aspect_label, target_lon), roots in zip(
            targets, fit.find_aspect_hits_many(fit_id, solve_lons),
        ):
            searchbackend.transit_fast_api.check_search_cancellation()
            ages = [-float(root) / factor for root in roots]
            # A contact exactly at the window start (a body on its own radix
            # place at birth) sits on the fit's edge, where no sign change shows.
            if (
                start_state is not None
                and abs(searchbackend._signed_angular_delta(start_state[0], target_lon)) <= searchbackend.EXACT_EPSILON
            ):
                ages.insert(0, float(start_age))
            solved = []
            for age in ages:
                if age < start_age or age > end_age:
                    continue
                # d(lon)/d(age) = -factor x d(lon)/d(ephemeris day) on the mirrored fit.
                speed = -factor * float(fit.speed(fit_id, -age * factor) or 0.0)
                exact_age = _polish_converse_root(state_at, target_lon, age, speed, start_age, end_age)
                # Fit roots that polish onto the same contact count once.
                if exact_age is None or any(abs(exact_age - prior) < _CONVERSE_DUPLICATE_AGE_YEARS for prior in solved):
                    continue
                solved.append(exact_age)
                row = _build_converse_row(
                    catalog, radix, prom_id, label, sig_id,
                    aspect_id, aspect_index, aspect_label, exact_age, state_at,
                )
                if row is not None:
                    rows.append(row)


def _memoized_state(state_at):
    cache = {}

    def cached(age):
        key = float(age)
        if key not in cache:
            cache[key] = state_at(key)
        return cache[key]
    return cached


def _polish_converse_root(state_at, target_lon, age, speed_deg_per_year, start_age, end_age):
    """Refine a fitted root on the canonical converse position, or reject it.

    The fit root is already within its fit error, so a secant step or two on
    the canonical position lands below a display second; slow or stationary
    movers fall back to the bracketed solve.
    """
    tolerance = 0.25 / (366.0 * 86400.0)
    lo_bound, hi_bound = float(start_age), float(end_age)
    a0 = min(max(float(age), lo_bound), hi_bound)
    d0 = _converse_delta_at_age(state_at, a0, target_lon)
    exact_age = None
    if abs(speed_deg_per_year) > 1e-3 and abs(d0) < 1.0:
        a1 = min(max(a0 - d0 / speed_deg_per_year, lo_bound), hi_bound)
        for _i in range(6):
            if abs(a1 - a0) <= tolerance or d0 == 0.0:
                exact_age = a1 if d0 != 0.0 else a0
                break
            d1 = _converse_delta_at_age(state_at, a1, target_lon)
            if d1 == d0:
                break
            a0, d0, a1 = a1, d1, min(max(a1 - d1 * (a1 - a0) / (d1 - d0), lo_bound), hi_bound)
    if exact_age is None:
        exact_age = _bracket_converse_root(state_at, target_lon, float(age), speed_deg_per_year, lo_bound, hi_bound)
    # A jump (Fortune at a sect change) can look like a root without a
    # contact; keep only roots where the mover reaches the target.
    if abs(_converse_delta_at_age(state_at, exact_age, target_lon)) > _CONVERSE_CONTACT_TOLERANCE_DEG:
        return None
    return exact_age


def _bracket_converse_root(state_at, target_lon, age, speed_deg_per_year, start_age, end_age):
    half_width = _CONVERSE_POLISH_BRACKET_DEG / max(abs(float(speed_deg_per_year)), 1e-6)
    half_width = min(max(half_width, 1e-7), _CONVERSE_SECONDARY_STEP_YEARS)
    while True:
        lo = max(start_age, age - half_width)
        hi = min(end_age, age + half_width)
        lo_delta = _converse_delta_at_age(state_at, lo, target_lon)
        hi_delta = _converse_delta_at_age(state_at, hi, target_lon)
        if searchbackend._is_target_zero_crossing(lo_delta, hi_delta):
            return _refine_converse_age(state_at, target_lon, lo, hi, lo_delta, hi_delta)
        if half_width >= _CONVERSE_SECONDARY_STEP_YEARS:
            return age
        half_width = min(half_width * 8.0, _CONVERSE_SECONDARY_STEP_YEARS)


def _refine_converse_age(state_at, target_lon, start_age, end_age, delta0, delta1):
    if float(delta0) == 0.0:
        return float(start_age)
    if float(delta1) == 0.0:
        return float(end_age)
    lo = float(start_age)
    hi = float(end_age)
    lo_val = float(delta0)
    hi_val = float(delta1)
    best_age = searchbackend._interpolate_zero_crossing(lo, hi, lo_val, hi_val)
    best_val = abs(_converse_delta_at_age(state_at, best_age, target_lon))
    # An angular "exact" orb can span many minutes of life for slow
    # progressed angles. Refine the time bracket to below a display second.
    age_tolerance = 0.25 / (366.0 * 86400.0)
    if lo_val * hi_val > 0.0:
        return best_age
    # Illinois false position: the bracket always holds the root, and halving
    # the retained endpoint's weight keeps convergence superlinear for the
    # smooth, locally monotone progressed motions.
    side = 0
    for _i in range(40):
        if hi - lo <= age_tolerance or best_val < 1e-9:
            break
        mid = (lo * hi_val - hi * lo_val) / (hi_val - lo_val)
        if not lo < mid < hi:
            mid = (lo + hi) / 2.0
        mid_val = _converse_delta_at_age(state_at, mid, target_lon)
        if abs(mid_val) < best_val:
            best_age = mid
            best_val = abs(mid_val)
        if mid_val == 0.0:
            return mid
        if lo_val * mid_val < 0.0:
            hi, hi_val = mid, mid_val
            if side == -1:
                lo_val /= 2.0
            side = -1
        else:
            lo, lo_val = mid, mid_val
            if side == 1:
                hi_val /= 2.0
            side = 1
    return best_age


def _converse_delta_at_age(state_at, age, target_lon):
    state = state_at(age)
    if state is None:
        return 999.0
    return searchbackend._signed_angular_delta(state[0], target_lon)


def _build_converse_row(catalog, radix, prom_id, prom_label, sig_id, aspect_id, aspect_index, aspect_label, exact_age, state_at):
    event_info = _converse_real_event_info_for_age(radix, exact_age)
    if event_info is None:
        return None
    event_jd, event_tuple, event_date, event_time = event_info
    state = state_at(exact_age)
    if state is None:
        return None
    prom_lon, prom_speed, prom_motion_jd, symbolic_age = state
    row = searchquery.SearchResult(
        searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS,
        aspect_id,
        prom_id,
        sig_id,
    )
    searchbackend._fill_row_from_event(row, catalog, event_jd, event_tuple, event_date, event_time)
    row.promittor_label = prom_label
    row.metadata['display_datetime'] = event_tuple
    row.metadata['secondary_direction'] = SECONDARY_DIRECTION_CONVERSE
    row.metadata['motion_code'] = 're'
    row.metadata['aspect_index'] = int(aspect_index)
    row.metadata['aspect_label'] = aspect_label
    row.metadata['converse_age'] = float(exact_age)
    row.metadata['converse_symbolic_age'] = float(symbolic_age)
    row.metadata['converse_motion_jd'] = float(prom_motion_jd)
    prom_obj = catalog.get(prom_id)
    if prom_obj is not None:
        prom_payload = searchbackend._secondary_aspect_motion_payload(
            searchbackend._build_payload_for_object(radix, prom_obj, prom_lon, prom_speed, prom_motion_jd, True)
        )
        if prom_payload is not None:
            row.metadata['prom_display'] = prom_payload
            if prom_payload.get('state_suffix'):
                row.promittor_label = '%s%s' % (row.promittor_label, prom_payload['state_suffix'])
    sig_payload = searchbackend._build_static_row_object_display(catalog, sig_id, radix)
    if sig_payload is not None:
        row.metadata['sig_display'] = sig_payload
    return row


def _converse_real_event_info_for_age(radix, age_years):
    real_tuple = symbolic_time._real_datetime_for_calendar_age(radix, float(age_years))
    if real_tuple is None:
        return None
    calflag = searchbackend._calendar_flag(radix)
    event_jd = astrology.swe_julday(
        int(real_tuple[0]),
        int(real_tuple[1]),
        int(real_tuple[2]),
        int(real_tuple[3]) + int(real_tuple[4]) / 60.0 + int(real_tuple[5]) / 3600.0,
        calflag,
    )
    event_date = '%04d-%02d-%02d' % (real_tuple[0], real_tuple[1], real_tuple[2])
    event_time = '%02d:%02d:%02d' % (real_tuple[3], real_tuple[4], real_tuple[5])
    return event_jd, real_tuple, event_date, event_time


def _converse_planet_state(radix, prom, age, flags, method, context):
    symbolic_age = _converse_symbolic_age(radix, age, method)
    jd_reg = float(radix.time.jd) - float(symbolic_age)
    try:
        with context.activate():
            status, xx, _serr = astrology.swe_calc_ut_ex(jd_reg, int(prom.planet_index), int(flags))
        if int(status) & 0xFFFFFFFF == 0xFFFFFFFF or len(xx) < 4:
            if prom.id.startswith('asteroid:'):
                prom.ephemeris_unavailable = True
            return None
        lon = util.normalize(float(xx[0]))
        speed = float(xx[3]) if len(xx) > 3 else None
        return lon, speed, jd_reg, symbolic_age
    except Exception:
        return None


def _converse_axis_longitudes(radix, age, method):
    try:
        symbolic_age = _converse_symbolic_age(radix, age, method)
        state = searchbackend._secondary_angle_projection(radix, -float(symbolic_age), method)
        return {
            'angle:mc': state['mc_lon'],
            'angle:asc': state['asc_lon'],
            'angle:ic': util.normalize(state['mc_lon'] + 180.0),
            'angle:dsc': util.normalize(state['asc_lon'] + 180.0),
        }
    except Exception:
        return {}


def _converse_angle_longitudes(radix, age, method):
    try:
        symbolic_age = _converse_symbolic_age(radix, age, method)
        state = posfordate.progressed_angle_state_for_symbolic_age(
            radix,
            radix.options,
            -float(symbolic_age),
            method=method,
        )
        return {
            'angle:mc': state['mc_lon'],
            'angle:asc': state['asc_lon'],
            'angle:ic': util.normalize(state['mc_lon'] + 180.0),
            'angle:dsc': util.normalize(state['asc_lon'] + 180.0),
            'point:vertex': util.normalize(float(state['houses'].ascmc[houses.Houses.VERTEX])),
        }
    except Exception:
        return {}


def _temporal_id_component(value):
    return str(value).replace('%', '%25').replace('|', '%7C')


def _secondary_temporal_point(catalog, object_id):
    point_id = str(object_id or '').strip()
    if not point_id:
        return None
    obj = catalog.get(point_id) if catalog is not None else None
    planet_id = getattr(obj, 'planet_index', None) if obj is not None else None
    try:
        planet_id = int(planet_id) if planet_id is not None else None
    except Exception:
        planet_id = None
    return {'pointId': point_id, 'planetId': planet_id}


def _secondary_temporal_payload(row, catalog, method=None):
    try:
        jd_ut = float(row.event_jd)
    except Exception:
        return None
    if not math.isfinite(jd_ut):
        return None
    source = str(method or row.technique or 'secondary').strip().lower()
    discriminator = ':'.join(
        str(value or '')
        for value in (
            _row_metadata(row).get('secondary_direction'),
            _row_motion_code(row),
            _row_station_code(row),
        )
    )
    row_id = '|'.join((
        'secondary-direction',
        _temporal_id_component(source),
        _temporal_id_component(row.technique or ''),
        _temporal_id_component(row.aspect or ''),
        _temporal_id_component(row.promittor_id or ''),
        _temporal_id_component(row.significator_id or ''),
        format(jd_ut, '.8f'),
        _temporal_id_component(discriminator),
    ))
    window = {
        'startJdUt': jd_ut,
        'endJdUt': math.nextafter(jd_ut, math.inf),
        'endExclusive': True,
    }
    activations = []
    for role, point in (
        ('actor', _secondary_temporal_point(catalog, row.promittor_id)),
        ('target', _secondary_temporal_point(catalog, row.significator_id)),
    ):
        if point is None:
            continue
        activations.append({
            'activationId': '|'.join((
                row_id,
                _temporal_id_component(role),
                _temporal_id_component(point['pointId']),
            )),
            'pointId': point['pointId'],
            'planetId': point['planetId'],
            'role': role,
            'basis': 'exact',
            'windows': [dict(window)],
        })
    if not activations:
        return None
    payload = {
        'rowId': row_id,
        'rowAnchorJdUt': jd_ut,
        'activations': activations,
    }
    actor = next((item for item in activations if item['role'] == 'actor'), None)
    target = next((item for item in activations if item['role'] == 'target'), None)
    if actor is not None and target is not None:
        payload['relationship'] = {
            'aspect': row.aspect,
            'actorPointId': actor['pointId'],
            'targetPointId': target['pointId'],
        }
    return payload


def serialize_secondary_rows(radix, rows, catalog, method=None, include_temporal=False):
    """Daemon row serializer — mirrors the wx list-window's row cells
    (secdirframe.py:970-989 age/date/time/aspect text). Materialises every row's
    lazy display + sweph-anchored time so the JSON carries final values, then
    maps the promittor/significator object ids to glyph hints (planet glyphs +
    aspect glyph) the same way the wx renderer does (secdirframe._object_glyph
    :1026, _aspect_glyph:1074). React maps the hint -> Morinus codepoint."""
    if catalog is not None and radix is not None:
        try:
            searchbackend.cheby_apply_lazy_display_rows(catalog, radix, rows)
            searchbackend.cheby_refine_rows(catalog, radix, rows)
        except Exception:
            pass
    radix_jd = float(radix.time.jd) if getattr(radix, 'time', None) is not None else None
    out = []
    for row in rows:
        searchbackend.transit_fast_api.check_search_cancellation()
        display = row.metadata.get('display_datetime') if isinstance(row.metadata, dict) else None
        if display is not None:
            try:
                dt = tuple(int(v) for v in tuple(display)[:6])
            except Exception:
                dt = None
        else:
            dt = None
        if dt is None and row.event_year is not None:
            dt = (int(row.event_year), int(row.event_month), int(row.event_day),
                  int(row.event_hour), int(row.event_minute), int(row.event_second))
        age = None
        if radix_jd is not None and row.event_jd is not None:
            age = max(0.0, (float(row.event_jd) - radix_jd) / 365.2425)
        payload = {
            "age": round(age, 4) if age is not None else None,
            "date": "%04d-%02d-%02d" % (dt[0], dt[1], dt[2]) if dt else (row.event_date or ""),
            "time": "%02d:%02d:%02d" % (dt[3], dt[4], dt[5]) if dt else (row.event_time or ""),
            "motionCode": _row_motion_code(row),
            "isStation": is_secondary_station_row(row),
            "isIngress": is_secondary_ingress_row(row),
            "stationCode": _row_station_code(row),
            "prom": row.promittor_label or "",
            "sig": _row_significator_label(row),
            "aspect": _row_aspect_label(row),
            # Raw hints so React maps to glyphs (planet index / aspect chart idx).
            "fields": _row_glyph_fields(radix, catalog, row),
            # Stable event datetime for the Timed-chart actions.
            "eventDatetime": ("%04d-%02d-%02dT%02d:%02d:%02d" % dt) if dt else None,
            "jd": float(row.event_jd) if row.event_jd is not None else None,
        }
        if include_temporal:
            temporal = _secondary_temporal_payload(row, catalog, method=method)
            if temporal is not None:
                payload["temporal"] = temporal
        out.append(payload)
    return out


def _row_display_tuple(row):
    """Transcribed from secdirframe.SecDirListWnd._row_display_tuple
    (secdirframe.py:866-880): prefer the refined display_datetime metadata,
    fall back to the raw event ints."""
    if row is None:
        return None
    display_tuple = getattr(row, 'metadata', {}).get('display_datetime')
    if display_tuple is not None:
        try:
            return tuple(int(v) for v in tuple(display_tuple)[:6])
        except Exception:
            pass
    if row.event_year is None:
        return None
    return (
        int(row.event_year), int(row.event_month), int(row.event_day),
        int(row.event_hour), int(row.event_minute), int(row.event_second),
    )


def _row_date_time_text(row):
    """Transcribed from secdirframe._row_date_time_text (secdirframe.py:899)."""
    values = _row_display_tuple(row)
    if values is None:
        return row.event_date or '--', row.event_time or '--'
    return (
        '%04d-%02d-%02d' % (values[0], values[1], values[2]),
        '%02d:%02d:%02d' % (values[3], values[4], values[5]),
    )


def _row_age_text(radix, row):
    """Transcribed from secdirframe._row_age_text (secdirframe.py:892)."""
    if row is None or row.event_jd is None or radix is None or getattr(radix, 'time', None) is None:
        return ''
    age = max(0.0, (float(row.event_jd) - float(radix.time.jd)) / 365.2425)
    return '%.2f' % age


def _row_metadata(row):
    meta = getattr(row, 'metadata', {})
    return meta if isinstance(meta, dict) else {}


def _row_motion_code(row):
    value = _row_metadata(row).get('motion_code')
    return str(value) if value else None


def is_secondary_station_row(row):
    return bool(_row_metadata(row).get('secondary_station'))


def is_secondary_ingress_row(row):
    return bool(_row_metadata(row).get('secondary_ingress'))


def _row_station_code(row):
    if not is_secondary_station_row(row):
        return None
    value = _row_metadata(row).get('station_code')
    return str(value) if value else None


def _row_aspect_index(row):
    value = _row_metadata(row).get('aspect_index')
    if value is not None:
        try:
            return int(value)
        except Exception:
            pass
    return searchbackend.ASPECT_INDEX_BY_ID.get(row.aspect)


def _row_aspect_label(row):
    if is_secondary_ingress_row(row):
        return '←' if _row_metadata(row).get('sign_change_retrograde') else '→'
    value = _row_metadata(row).get('aspect_label')
    if value:
        return str(value)
    return searchbackend.ASPECT_LABEL_BY_ID.get(row.aspect, row.aspect or '')


def _row_significator_label(row):
    if is_secondary_ingress_row(row):
        sign_index = _row_metadata(row).get('sign_change_event_sign')
        try:
            return mtexts.signs[int(sign_index) % chart.Chart.SIGN_NUM]
        except Exception:
            pass
    return row.significator_label or ''


def build_secondary_rows_text(radix, rows, catalog, aspect_label_for_index=None):
    """Save-As-Text export — transcribed from secdirframe.onSaveAsText
    (secdirframe.py:1237-1269): bulk cheby display materialisation + sweph
    refinement first, then the tab-separated Age/Date/Time/Progressed/Aspect/
    Radix table the wx file dialog writes."""
    if catalog is not None and radix is not None:
        try:
            searchbackend.cheby_apply_lazy_display_rows(catalog, radix, rows)
            searchbackend.cheby_refine_rows(catalog, radix, rows)
        except Exception:
            pass
    has_motion = any(_row_motion_code(row) for row in rows)
    _t = mtexts.txts.get
    if has_motion:
        header = '\t'.join((
            _t('Age', 'Age'), _t('Dir', 'Dir'), _t('Date', 'Date'),
            _t('Time', 'Time'), _t('Progressed', 'Progressed'),
            _t('Aspect', 'Aspect'), _t('Radix', 'Radix'),
        ))
    else:
        header = '\t'.join((
            _t('Age', 'Age'), _t('Date', 'Date'), _t('Time', 'Time'),
            _t('Progressed', 'Progressed'), _t('Aspect', 'Aspect'),
            _t('Radix', 'Radix'),
        ))
    lines = [header]
    for row in rows:
        searchbackend.transit_fast_api.check_search_cancellation()
        date_txt, time_txt = _row_date_time_text(row)
        aspect_text = _row_aspect_label(row)
        aspect_index = _row_aspect_index(row)
        if callable(aspect_label_for_index) and aspect_index is not None:
            compact = aspect_label_for_index(aspect_index)
            if compact:
                aspect_text = str(compact)
        values = (
            _row_age_text(radix, row),
            date_txt,
            time_txt,
            row.promittor_label,
            aspect_text,
            _row_significator_label(row),
        )
        if has_motion:
            values = (values[0], _row_motion_code(row) or '') + values[1:]
            lines.append('%s\t%s\t%s\t%s\t%s\t%s\t%s' % values)
        else:
            lines.append('%s\t%s\t%s\t%s\t%s\t%s' % values)
    return '\n'.join(lines)


def _planet_index(catalog, object_id):
    if catalog is None or object_id is None:
        return None
    obj = catalog.get(object_id)
    if obj is None:
        return None
    return obj.planet_index


def _rgb_css(value):
    try:
        r, g, b = list(value)[:3]
        return "#%02x%02x%02x" % (
            max(0, min(255, int(r))),
            max(0, min(255, int(g))),
            max(0, min(255, int(b))),
        )
    except Exception:
        return "#000000"


def _metadata_color(row, key):
    meta = getattr(row, 'metadata', {})
    if not isinstance(meta, dict):
        return None
    value = meta.get(key)
    if not isinstance(value, dict) or value.get('glyph_color') is None:
        return None
    return _rgb_css(value.get('glyph_color'))


def _object_glyph(catalog, object_id):
    if catalog is None or object_id is None:
        return None
    obj = catalog.get(object_id)
    if obj is None:
        return None
    if obj.id == 'point:lof':
        return getattr(common.common, 'fortune', None)
    if obj.planet_index is not None:
        try:
            return common.common.get_ephemeris_body_glyph(int(obj.planet_index)) or None
        except Exception:
            return None
    return getattr(obj, 'display_glyph', None) or None


def _aspect_glyph(row):
    chart_aspect = _row_aspect_index(row)
    if chart_aspect is None:
        return None
    try:
        return common.common.Aspects[int(chart_aspect)] or None
    except Exception:
        return None


def _aspect_color(radix, row):
    chart_aspect = _row_aspect_index(row)
    if chart_aspect is None:
        return None
    try:
        return _rgb_css(radix.options.clraspect[int(chart_aspect)])
    except Exception:
        return None


def _row_glyph_fields(radix, catalog, row):
    prom_planet = _planet_index(catalog, row.promittor_id)
    sig_planet = _planet_index(catalog, row.significator_id)
    aspect_index = _row_aspect_index(row)
    sig_sign_index = None
    sig_glyph = _object_glyph(catalog, row.significator_id)
    if is_secondary_ingress_row(row):
        try:
            sig_sign_index = int(
                _row_metadata(row).get('sign_change_event_sign')
            ) % chart.Chart.SIGN_NUM
            signs = (
                common.common.Signs1
                if getattr(radix.options, 'signs', True)
                else common.common.Signs2
            )
            sig_glyph = signs[sig_sign_index]
        except Exception:
            sig_glyph = None
    return {
        "promObjectId": row.promittor_id,
        "sigObjectId": None if is_secondary_ingress_row(row) or is_secondary_station_row(row) else row.significator_id,
        "promAngleId": row.promittor_id if row.promittor_id in SECONDARY_ACTING_ANGLE_IDS else None,
        "promPlanet": prom_planet,
        "sigPlanet": sig_planet,
        "aspectIndex": aspect_index,
        "promGlyph": _object_glyph(catalog, row.promittor_id),
        "sigGlyph": sig_glyph,
        "aspectGlyph": _aspect_glyph(row),
        "promExportSymbolText": common.planet_text_export_mark(prom_planet),
        "sigExportSymbolText": (
            common.sign_text_export_mark(sig_sign_index)
            if sig_sign_index is not None
            else common.planet_text_export_mark(sig_planet)
        ),
        "aspectExportSymbolText": common.aspect_text_export_mark(aspect_index),
        "promColor": _metadata_color(row, 'prom_display'),
        "sigColor": _metadata_color(row, 'sig_display'),
        "aspectColor": _aspect_color(radix, row),
    }
