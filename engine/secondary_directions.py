# -*- coding: utf-8 -*-
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

import astrology
import chart
import common
import mtexts
import posfordate
import searchbackend
import searchcatalog
import searchquery
import symbolic_time
import util

SECONDARY_DIRECTION_YEARS = 150
SECONDARY_DIRECTION_RANGES = (
    (0, 25),
    (25, 50),
    (50, 75),
    (75, 100),
    (100, 150),
)
SECONDARY_DIRECTION_LIMIT = 10000
SECONDARY_DIRECTION_DIRECT = 'direct'
SECONDARY_DIRECTION_CONVERSE = 'converse'
SECONDARY_DIRECTION_BOTH = 'both'

_CONVERSE_SECONDARY_STEP_YEARS = 0.25
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
_CONVERSE_ANGLE_PROMISSORS = (
    ('angle:mc', 'MC'),
    ('angle:asc', 'ASC'),
    ('angle:ic', 'IC'),
    ('angle:dsc', 'DSC'),
)


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
    return SECONDARY_DIRECTION_RANGES[-1]


def _secondary_progressed_promittor_ids(catalog):
    ids = []
    for object_id in catalog.promittor_ids:
        obj = catalog.get(object_id)
        if obj is None or obj.family != searchcatalog.SearchObject.FAMILY_PLANET:
            continue
        if obj.planet_index is None:
            continue
        ids.append(object_id)
    return ids


def _secondary_radix_target_ids(catalog):
    ids = []
    for object_id in catalog.builtin_significator_ids:
        obj = catalog.get(object_id)
        if obj is None:
            continue
        if obj.family in (
            searchcatalog.SearchObject.FAMILY_PLANET,
            searchcatalog.SearchObject.FAMILY_NODE,
            searchcatalog.SearchObject.FAMILY_ANGLE,
            searchcatalog.SearchObject.FAMILY_FORTUNE,
        ):
            ids.append(object_id)
    return ids


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

    catalog = searchcatalog.SearchCatalog(radix) if radix is not None else None
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
    catalog = searchcatalog.SearchCatalog(radix)
    query = searchquery.SearchQuery()
    query.set_techniques([searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS])
    query.set_aspects([aspect_id for aspect_id, _chart_aspect, _both_sides, _label in searchbackend.ASPECT_DEFS])
    query.set_promittor_ids(_secondary_progressed_promittor_ids(catalog))
    query.set_significator_ids(_secondary_radix_target_ids(catalog))
    query.set_progression_method(int(posfordate.progression_method(method)))
    birth_date = _birth_date(radix)
    start_date = birth_date + datetime.timedelta(days=int(round(float(start_age) * 365.2425)))
    end_date = birth_date + datetime.timedelta(days=int(round(float(end_age) * 365.2425)))
    rows, truncated = searchbackend.search(catalog, radix, query, start_date, end_date, limit)
    station_rows = searchbackend.build_secondary_station_rows(
        catalog,
        radix,
        start_date,
        end_date,
        promittor_ids=query.promittor_ids,
        method=posfordate.progression_method(method),
    )
    if station_rows:
        rows = searchbackend._dedupe_rows(list(rows) + list(station_rows))
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
    catalog = searchcatalog.SearchCatalog(radix)
    start_age = max(0.0, float(start_age))
    end_age = max(start_age, float(end_age))
    if end_age <= start_age:
        return [], False, catalog

    samples = _converse_age_samples(start_age, end_age, method=method)
    targets = _converse_target_specs(catalog)
    rows = []
    _append_converse_planet_rows(rows, catalog, radix, samples, targets, method)
    _append_converse_angle_rows(rows, catalog, radix, samples, targets, method)
    rows.sort(key=_secondary_row_sort_key)
    rows = searchbackend._dedupe_rows(rows)
    rows.sort(key=_secondary_row_sort_key)
    truncated = False
    if limit is not None and len(rows) > int(limit):
        rows = rows[:int(limit)]
        truncated = True
    return rows, truncated, catalog


def _mark_secondary_direction_rows(rows, direction, motion_code):
    for row in rows:
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
        symbolic_age /= symbolic_time.BIJA_RATIO
    return symbolic_age


def _converse_age_samples(start_age, end_age, step_symbolic_days=_CONVERSE_SECONDARY_STEP_YEARS, method=posfordate.SECONDARY):
    scale = posfordate.progression_symbolic_scale(method) or 1.0
    step_years = max(0.0025, float(step_symbolic_days) / abs(float(scale)))
    samples = [float(start_age)]
    current = float(start_age)
    while current < float(end_age):
        current = min(current + float(step_years), float(end_age))
        if current > samples[-1]:
            samples.append(current)
        else:
            break
    return samples


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


def _append_converse_planet_rows(rows, catalog, radix, samples, targets, method):
    flags = searchbackend._planet_flags(radix)
    for prom_id in _secondary_progressed_promittor_ids(catalog):
        prom = catalog.get(prom_id)
        if prom is None or prom.planet_index is None:
            continue

        def state_at(age, _prom=prom, _flags=flags, _method=method):
            return _converse_planet_state(radix, _prom, age, _flags, _method)

        _append_converse_rows_for_promissor(
            rows, catalog, radix, prom_id, prom.label, state_at, samples, targets,
        )


def _append_converse_angle_rows(rows, catalog, radix, samples, targets, method):
    state_cache = {}

    def angle_state(age):
        key = round(float(age), 9)
        if key not in state_cache:
            state_cache[key] = _converse_angle_longitudes(radix, age, method)
        return state_cache[key]

    for prom_id, label in _CONVERSE_ANGLE_PROMISSORS:
        def state_at(age, _prom_id=prom_id):
            lons = angle_state(age)
            lon = lons.get(_prom_id)
            if lon is None:
                return None
            symbolic_age = _converse_symbolic_age(radix, age, method)
            return lon, None, float(radix.time.jd) - float(symbolic_age), float(symbolic_age)

        _append_converse_rows_for_promissor(
            rows, catalog, radix, prom_id, label, state_at, samples, targets,
        )


def _append_converse_rows_for_promissor(rows, catalog, radix, prom_id, prom_label, state_at, samples, targets):
    series = []
    for age in samples:
        state = state_at(age)
        lon = state[0] if state is not None else None
        series.append((age, lon))
    if all(lon is None for _age, lon in series):
        return

    for sig_id, aspect_id, aspect_index, aspect_label, target_lon in targets:
        prev_age, prev_lon = series[0]
        if prev_lon is None:
            continue
        prev_delta = searchbackend._signed_angular_delta(prev_lon, target_lon)
        for age, lon in series[1:]:
            if lon is None:
                prev_age, prev_lon, prev_delta = age, lon, None
                continue
            delta = searchbackend._signed_angular_delta(lon, target_lon)
            if prev_delta is not None and searchbackend._is_target_zero_crossing(prev_delta, delta):
                exact_age = _refine_converse_age(state_at, target_lon, prev_age, age, prev_delta, delta)
                row = _build_converse_row(
                    catalog, radix, prom_id, prom_label, sig_id,
                    aspect_id, aspect_index, aspect_label, exact_age, state_at,
                )
                if row is not None:
                    rows.append(row)
            prev_age, prev_lon, prev_delta = age, lon, delta


def _refine_converse_age(state_at, target_lon, start_age, end_age, delta0, delta1):
    if abs(float(delta0)) <= searchbackend.EXACT_EPSILON:
        return float(start_age)
    if abs(float(delta1)) <= searchbackend.EXACT_EPSILON:
        return float(end_age)
    lo = float(start_age)
    hi = float(end_age)
    lo_val = float(delta0)
    hi_val = float(delta1)
    best_age = searchbackend._interpolate_zero_crossing(lo, hi, lo_val, hi_val)
    best_val = abs(_converse_delta_at_age(state_at, best_age, target_lon))
    for _i in range(28):
        mid = (lo + hi) / 2.0
        mid_val = _converse_delta_at_age(state_at, mid, target_lon)
        if abs(mid_val) < best_val:
            best_age = mid
            best_val = abs(mid_val)
        if abs(mid_val) <= searchbackend.EXACT_EPSILON:
            return mid
        if searchbackend._is_target_zero_crossing(lo_val, mid_val):
            hi = mid
            hi_val = mid_val
        elif searchbackend._is_target_zero_crossing(mid_val, hi_val):
            lo = mid
            lo_val = mid_val
        elif abs(lo_val) <= abs(hi_val):
            hi = mid
            hi_val = mid_val
        else:
            lo = mid
            lo_val = mid_val
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


def _converse_planet_state(radix, prom, age, flags, method):
    symbolic_age = _converse_symbolic_age(radix, age, method)
    jd_reg = float(radix.time.jd) - float(symbolic_age)
    try:
        _serr, xx = astrology.swe_calc_ut(jd_reg, int(prom.planet_index), int(flags))
        lon = util.normalize(float(xx[0]))
        speed = float(xx[3]) if len(xx) > 3 else None
        return lon, speed, jd_reg, symbolic_age
    except Exception:
        return None


def _converse_angle_longitudes(radix, age, method):
    try:
        symbolic_age = _converse_symbolic_age(radix, age, method)
        state = posfordate.progressed_angle_state_for_symbolic_age(
            radix,
            radix.options,
            -float(symbolic_age),
            method=method,
            angle_method=posfordate.TRUE_SOLAR_ARC_RA,
        )
        cusps = state['houses'].cusps
        return {
            'angle:mc': util.normalize(float(cusps[10])),
            'angle:asc': util.normalize(float(cusps[1])),
            'angle:ic': util.normalize(float(cusps[4])),
            'angle:dsc': util.normalize(float(cusps[7])),
        }
    except Exception:
        return {}


def serialize_secondary_rows(radix, rows, catalog):
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
        out.append({
            "age": round(age, 4) if age is not None else None,
            "date": "%04d-%02d-%02d" % (dt[0], dt[1], dt[2]) if dt else (row.event_date or ""),
            "time": "%02d:%02d:%02d" % (dt[3], dt[4], dt[5]) if dt else (row.event_time or ""),
            "motionCode": _row_motion_code(row),
            "prom": row.promittor_label or "",
            "sig": row.significator_label or "",
            "aspect": _row_aspect_label(row),
            # Raw hints so React maps to glyphs (planet index / aspect chart idx).
            "fields": _row_glyph_fields(radix, catalog, row),
            # Stable event datetime for the Timed-chart actions.
            "eventDatetime": ("%04d-%02d-%02dT%02d:%02d:%02d" % dt) if dt else None,
            "jd": float(row.event_jd) if row.event_jd is not None else None,
        })
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


def _row_aspect_index(row):
    value = _row_metadata(row).get('aspect_index')
    if value is not None:
        try:
            return int(value)
        except Exception:
            pass
    return searchbackend.ASPECT_INDEX_BY_ID.get(row.aspect)


def _row_aspect_label(row):
    value = _row_metadata(row).get('aspect_label')
    if value:
        return str(value)
    return searchbackend.ASPECT_LABEL_BY_ID.get(row.aspect, row.aspect or '')


def build_secondary_rows_text(radix, rows, catalog):
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
        date_txt, time_txt = _row_date_time_text(row)
        values = (
            _row_age_text(radix, row),
            date_txt,
            time_txt,
            row.promittor_label,
            _row_aspect_label(row),
            row.significator_label,
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
            return common.common.get_planet_glyph(int(obj.planet_index)) or None
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
    return {
        "promPlanet": _planet_index(catalog, row.promittor_id),
        "sigPlanet": _planet_index(catalog, row.significator_id),
        "aspectIndex": _row_aspect_index(row),
        "promGlyph": _object_glyph(catalog, row.promittor_id),
        "sigGlyph": _object_glyph(catalog, row.significator_id),
        "aspectGlyph": _aspect_glyph(row),
        "promColor": _metadata_color(row, 'prom_display'),
        "sigColor": _metadata_color(row, 'sig_display'),
        "aspectColor": _aspect_color(radix, row),
    }
