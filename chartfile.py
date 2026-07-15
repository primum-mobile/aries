# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Morinus Aries chart file I/O — JSONL collection format (v1).

Canonical storage for chart data.  Each chart is one JSON object on its
own line inside a .jsonl file.  The format is flat (no nested objects),
uses ISO 8601 for dates/times/offsets, decimal degrees for coordinates,
and carries a schema version field so old files stay readable forever.

Legacy .hor (pickle) files remain loadable through the read path.

Schema v1 fields
-----------------
  v           int     schema version (always 1)
  id          str     stable UUID4 per chart
  name        str     chart / person name
  type        str     "radix"|"solar"|"lunar"|"revolution"|"transit"|"horary"|"profection"|"pdinchart"
  male        bool    gender (true=male)
  date        str     ISO 8601 date "YYYY-MM-DD"  (negative year for BC)
  time        str     ISO 8601 time "HH:MM:SS"
  tz          str     ISO 8601 offset "+HH:MM" or "-HH:MM" or "Z"
  tz_name     str     timezone abbreviation (informational, e.g. "CEDT")
  tzid        str     IANA timezone id (e.g. "Europe/Berlin"), empty if unknown
  tzauto      bool    auto-resolve timezone from tzid on load
  cal         str     "gregorian"|"julian"
  zt          str     "zone"|"greenwich"|"lmt"|"lat"
  bc          bool    true if BC/BCE date
  dst         bool    daylight saving applied (separate from tz offset)
  place       str     place name
  country     str     country name (optional, empty string if not separate)
  lat         float   latitude  in decimal degrees (north positive)
  lon         float   longitude in decimal degrees (east positive)
  alt         float   altitude in metres
  notes       str     user notes
"""

import json
import uuid
import os
import chart as _chart_mod


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SCHEMA_VERSION = 1

# htype int → string
_HTYPE_TO_STR = {
    _chart_mod.Chart.RADIX:      'radix',
    _chart_mod.Chart.SOLAR:      'solar',
    _chart_mod.Chart.LUNAR:      'lunar',
    _chart_mod.Chart.REVOLUTION: 'revolution',
    _chart_mod.Chart.TRANSIT:    'transit',
    _chart_mod.Chart.HORARY:     'horary',
    _chart_mod.Chart.PROFECTION: 'profection',
    _chart_mod.Chart.PDINCHART:  'pdinchart',
    _chart_mod.Chart.COMPOSITE:  'composite',
    _chart_mod.Chart.RELATIONSHIP: 'relationship',
}
_STR_TO_HTYPE = {v: k for k, v in _HTYPE_TO_STR.items()}

# cal int → string
_CAL_TO_STR = {_chart_mod.Time.GREGORIAN: 'gregorian', _chart_mod.Time.JULIAN: 'julian'}
_STR_TO_CAL = {v: k for k, v in _CAL_TO_STR.items()}

# zt int → string
_ZT_TO_STR = {
    _chart_mod.Time.ZONE:           'zone',
    _chart_mod.Time.GREENWICH:      'greenwich',
    _chart_mod.Time.LOCALMEAN:      'lmt',
    _chart_mod.Time.LOCALAPPARENT:  'lat',
}
_STR_TO_ZT = {v: k for k, v in _ZT_TO_STR.items()}


# ---------------------------------------------------------------------------
# Chart object → JSONL dict
# ---------------------------------------------------------------------------

def chart_to_dict(chrt, chart_id=None, interpretation=None):
    """Serialise a Chart object to a flat dict conforming to schema v1.

    If *chart_id* is None a new UUID4 is generated.  Pass an existing id
    to preserve identity across saves.

    *interpretation*, when provided AND the chart is horary, is written under
    an `'interpretation'` key — the lens-model persistence vehicle for horary
    questions (which "are" their chart, so the discipline/theme/context is
    intrinsic to the chart record). Non-horary charts ignore the kwarg.
    """
    t = chrt.time
    p = chrt.place

    # Timezone offset → ISO 8601 string
    zh = getattr(t, 'zh', 0)
    zm = getattr(t, 'zm', 0)
    total_minutes = zh * 60 + zm
    if getattr(t, 'daylightsaving', False):
        total_minutes += 60
    plus = getattr(t, 'plus', True)
    if total_minutes == 0:
        tz_str = 'Z'
    else:
        sign = '+' if plus else '-'
        tz_str = f'{sign}{total_minutes // 60:02d}:{total_minutes % 60:02d}'

    # Date — use origyear/origmonth/origday (pre-adjustment values)
    year = getattr(t, 'origyear', t.year)
    month = getattr(t, 'origmonth', t.month)
    day = getattr(t, 'origday', t.day)
    bc = getattr(t, 'bc', False)

    if bc:
        date_str = f'-{abs(year):04d}-{month:02d}-{day:02d}'
    else:
        date_str = f'{year:04d}-{month:02d}-{day:02d}'

    time_str = f'{t.hour:02d}:{t.minute:02d}:{t.second:02d}'

    # Coordinates — reconstruct signed decimal from DMS + direction
    lon = p.deglon + p.minlon / 60.0 + getattr(p, 'seclon', 0.0) / 3600.0
    if not p.east:
        lon = -lon
    lat = p.deglat + p.minlat / 60.0 + getattr(p, 'seclat', 0.0) / 3600.0
    if not p.north:
        lat = -lat

    out = {
        'v':        _SCHEMA_VERSION,
        'id':       chart_id or str(uuid.uuid4()),
        'name':     chrt.name,
        'type':     _HTYPE_TO_STR.get(chrt.htype, 'radix'),
        'male':     chrt.male,
        'date':     date_str,
        'time':     time_str,
        'tz':       tz_str,
        'tz_name':  '',
        'tzid':     getattr(t, 'tzid', ''),
        'tzauto':   getattr(t, 'tzauto', False),
        'cal':      _CAL_TO_STR.get(getattr(t, 'cal', 0), 'gregorian'),
        'zt':       _ZT_TO_STR.get(getattr(t, 'zt', 0), 'zone'),
        'bc':       bc,
        'dst':      getattr(t, 'daylightsaving', False),
        'place':    p.place,
        'country':  '',
        'lat':      round(lat, 6),
        'lon':      round(lon, 6),
        'alt':      getattr(p, 'altitude', 0.0),
        'notes':    getattr(chrt, 'notes', ''),
        'modified_at': getattr(chrt, 'modified_at', ''),
    }
    # Horary-only persistence: round-trip the lens binding. Caller-supplied
    # `interpretation` kwarg wins; otherwise read the chart's own attribute,
    # which is the authoritative slot once the lens-write path lands on the
    # Chart object directly.
    try:
        import chart as _chart_mod
        if chrt.htype == _chart_mod.Chart.HORARY:
            payload = interpretation if interpretation else getattr(chrt, 'interpretation', None)
            if payload:
                out['interpretation'] = payload
    except Exception:
        pass
    return out


# ---------------------------------------------------------------------------
# JSONL dict → Chart object
# ---------------------------------------------------------------------------

def _parse_tz(tz_str):
    """Parse ISO 8601 offset string → (plus, total_minutes).

    Accepts "+02:00", "-05:00", "Z", "+05:30", etc.
    """
    if tz_str == 'Z' or not tz_str:
        return True, 0
    sign = 1 if tz_str[0] == '+' else -1
    body = tz_str[1:]
    if ':' in body:
        h, m = body.split(':', 1)
    else:
        h, m = body[:2], body[2:4] if len(body) >= 4 else '0'
    total = int(h) * 60 + int(m)
    return (sign > 0), total


def _decimal_to_dms(decimal_deg):
    """Decimal degrees → (deg, min, sec) all non-negative."""
    total = abs(decimal_deg)
    deg = int(total)
    remainder = (total - deg) * 60.0
    minutes = int(remainder)
    seconds = round((remainder - minutes) * 60.0, 2)
    if seconds >= 60.0:
        seconds = 0.0
        minutes += 1
    if minutes >= 60:
        minutes = 0
        deg += 1
    return int(deg), int(minutes), float(seconds)


def dict_to_chart(d, options):
    """Reconstruct a Chart object from a schema-v1 dict.

    *options* is the Morinus options object needed by ``chart.Time``.
    """
    # Date
    date_str = d['date']
    if date_str.startswith('-'):
        bc = True
        date_str = date_str[1:]
    else:
        bc = d.get('bc', False)
    parts = date_str.split('-')
    year  = int(parts[0])
    month = int(parts[1])
    day   = int(parts[2])

    # Time
    tparts = d['time'].split(':')
    hour   = int(tparts[0])
    minute = int(tparts[1])
    second = int(tparts[2]) if len(tparts) > 2 else 0

    # Calendar, zone-time type
    cal = _STR_TO_CAL.get(d.get('cal', 'gregorian'), _chart_mod.Time.GREGORIAN)
    zt  = _STR_TO_ZT.get(d.get('zt', 'zone'), _chart_mod.Time.ZONE)

    # Timezone
    plus, total_min = _parse_tz(d.get('tz', 'Z'))
    dst = d.get('dst', False)
    if dst:
        total_min = max(0, total_min - 60)
    zh = total_min // 60
    zm = total_min % 60

    tzid   = d.get('tzid', '')
    tzauto = d.get('tzauto', False)

    # Coordinates
    lon = d['lon']
    lat = d['lat']
    east  = lon >= 0.0
    north = lat >= 0.0
    deglon, minlon, seclon = _decimal_to_dms(lon)
    deglat, minlat, seclat = _decimal_to_dms(lat)

    alt = d.get('alt', 0.0)

    # Chart type
    htype = _STR_TO_HTYPE.get(d.get('type', 'radix'), _chart_mod.Chart.RADIX)

    # Build Place and Time, then Chart
    place = _chart_mod.Place(
        d.get('place', ''), deglon, minlon, seclon, east,
        deglat, minlat, seclat, north, alt)
    time = _chart_mod.Time(
        year, month, day, hour, minute, second,
        bc, cal, zt, plus, zh, zm, dst, place,
        tzid=tzid, tzauto=tzauto)
    male = d['male'] if 'male' in d else True  # preserve None (no gender)
    chrt = _chart_mod.Chart(
        d.get('name', ''), male,
        time, place, htype, d.get('notes', ''), options)
    # Preserve stable record identity so saves can overwrite by id.
    chrt.chart_id = d.get('id', '')

    # Preserve modification timestamp if present
    if d.get('modified_at'):
        chrt.modified_at = d['modified_at']

    # Lens-model: horary interpretation lives on the Chart object directly.
    # `_refresh_pack_alerts` reads it via the active workspace chart, so it
    # survives load → eval → save without depending on chart_session (which
    # is intentionally None for loaded radixes).
    interp = d.get('interpretation')
    if interp and htype == _chart_mod.Chart.HORARY:
        chrt.interpretation = interp

    return chrt


# ---------------------------------------------------------------------------
# File I/O — JSONL collections
# ---------------------------------------------------------------------------

def read_jsonl(filepath):
    """Read a .jsonl chart collection → list of dicts."""
    records = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
                records.append(d)
            except json.JSONDecodeError as e:
                raise ValueError(f'{filepath}:{lineno}: bad JSON: {e}') from e
    return records


def read_jsonl_record(filepath, record_index):
    """Read one zero-based record from a .jsonl chart collection."""
    target = int(record_index)
    if target < 0:
        raise IndexError('record index out of range')
    with open(filepath, 'r', encoding='utf-8') as f:
        record_idx = 0
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            if record_idx != target:
                record_idx += 1
                continue
            try:
                return json.loads(line)
            except json.JSONDecodeError as e:
                raise ValueError(f'{filepath}:{lineno}: bad JSON: {e}') from e
        raise IndexError('record index out of range')


def find_jsonl_record_index(filepath, chart_ref=None):
    """Resolve a chart reference to a stable record index in a .jsonl collection.

    Returns ``(index, resolved)`` where ``index`` is the matching record index or
    ``None`` when no safe match exists. ``resolved`` indicates whether the lookup
    was confidently resolved for the given reference.
    """
    if os.path.splitext(filepath)[1].lower() != '.jsonl':
        return None, True

    records = read_jsonl(filepath)
    if not records:
        return None, False

    chart_ref = chart_ref or {}
    chart_id = chart_ref.get('chart_id', '') if isinstance(chart_ref, dict) else ''
    if chart_id:
        for idx, record in enumerate(records):
            if record.get('id', '') == chart_id:
                return idx, True

    fingerprint_keys = ('chart_name', 'chart_date', 'chart_time', 'chart_place')
    if isinstance(chart_ref, dict):
        fingerprint = {
            key: chart_ref.get(key, '')
            for key in fingerprint_keys
            if chart_ref.get(key, '')
        }
    else:
        fingerprint = {}

    if fingerprint:
        matches = []
        for idx, record in enumerate(records):
            if all((record.get(key[6:], '') or '').strip() == value for key, value in fingerprint.items()):
                matches.append(idx)
        if len(matches) == 1:
            return matches[0], True

    if isinstance(chart_ref, str) or not chart_ref:
        if len(records) == 1:
            return 0, True
        return None, False

    return None, False


def write_jsonl(records, filepath):
    """Write a list of chart dicts to a .jsonl file (one JSON object per line)."""
    with open(filepath, 'w', encoding='utf-8') as f:
        for d in records:
            f.write(json.dumps(d, ensure_ascii=False, separators=(',', ':')) + '\n')


def merge_into_jsonl(new_records, filepath):
    """Merge new records into an existing .jsonl file, deduplicating."""
    existing = []
    seen = set()
    if os.path.exists(filepath):
        existing = read_jsonl(filepath)
        for r in existing:
            key = (r.get('name', '').lower(), r.get('year'), r.get('month'),
                   r.get('day'), r.get('hour'), r.get('minute'))
            seen.add(key)
    merged = list(existing)
    for r in new_records:
        key = (r.get('name', '').lower(), r.get('year'), r.get('month'),
               r.get('day'), r.get('hour'), r.get('minute'))
        if key not in seen:
            seen.add(key)
            merged.append(r)
    write_jsonl(merged, filepath)
    return len(merged) - len(existing)


def append_jsonl(record, filepath):
    """Append a single chart dict to an existing .jsonl file."""
    with open(filepath, 'a', encoding='utf-8') as f:
        f.write(json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n')


def update_jsonl(record, filepath):
    """Update an existing record in a .jsonl file (matched by 'id').

    If no matching id is found, the record is appended.
    """
    target_id = record.get('id', '')
    found = False
    lines = []

    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            for line in f:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    d = json.loads(stripped)
                except json.JSONDecodeError:
                    lines.append(stripped)
                    continue
                if d.get('id') == target_id:
                    lines.append(json.dumps(record, ensure_ascii=False, separators=(',', ':')))
                    found = True
                else:
                    lines.append(stripped)

    if not found:
        lines.append(json.dumps(record, ensure_ascii=False, separators=(',', ':')))

    with open(filepath, 'w', encoding='utf-8') as f:
        for line in lines:
            f.write(line + '\n')


def remove_jsonl(chart_id, filepath):
    """Remove a record by id from a .jsonl file."""
    if not os.path.exists(filepath):
        return
    lines = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                d = json.loads(stripped)
            except json.JSONDecodeError:
                lines.append(stripped)
                continue
            if d.get('id') != chart_id:
                lines.append(stripped)

    with open(filepath, 'w', encoding='utf-8') as f:
        for line in lines:
            f.write(line + '\n')


# ---------------------------------------------------------------------------
# File I/O — single-chart JSON (convenience)
# ---------------------------------------------------------------------------

def read_json_chart(filepath, options):
    """Read a single-chart .json file → Chart object."""
    with open(filepath, 'r', encoding='utf-8') as f:
        d = json.load(f)
    # Accept both single-object and first-element-of-array
    if isinstance(d, list):
        d = d[0]
    return dict_to_chart(d, options)


def write_json_chart(chrt, filepath, chart_id=None, interpretation=None):
    """Write a single Chart to a .json file. `interpretation` is round-tripped
    only when the chart is horary (see `chart_to_dict`)."""
    d = chart_to_dict(chrt, chart_id=chart_id, interpretation=interpretation)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(d, f, indent=2, ensure_ascii=False)
        f.write('\n')


# ---------------------------------------------------------------------------
# File I/O — JSONL collection chart load (returns Chart objects)
# ---------------------------------------------------------------------------

def read_jsonl_charts(filepath, options):
    """Read a .jsonl collection → list of Chart objects."""
    return [dict_to_chart(d, options) for d in read_jsonl(filepath)]


def read_jsonl_summaries(filepath):
    """Quick read of basic chart info without full Chart construction.

    Returns list of dicts with: id, name, date, time, tz, place, type.
    """
    summaries = []
    for d in read_jsonl(filepath):
        summaries.append({
            'id':    d.get('id', ''),
            'name':  d.get('name', ''),
            'date':  d.get('date', ''),
            'time':  d.get('time', ''),
            'tz':    d.get('tz', ''),
            'place': d.get('place', ''),
            'type':  d.get('type', ''),
        })
    return summaries


# ---------------------------------------------------------------------------
# Legacy .hor conversion helpers
# ---------------------------------------------------------------------------

def hor_values_to_dict(values, chart_id=None):
    """Convert a 29-element .hor pickle value list to a schema-v1 dict.

    This avoids constructing a full Chart object (no SWEP needed).
    """
    if len(values) < 27:
        raise ValueError('Incomplete horoscope data (need >= 27 values)')

    name  = values[0]
    male  = values[1]
    htype = values[2]
    bc    = values[3]
    year  = values[4]
    month = values[5]
    day   = values[6]
    hour  = values[7]
    minute = values[8]
    second = values[9]
    cal   = values[10]
    zt    = values[11]
    plus  = values[12]
    zh    = values[13]
    zm    = values[14]
    dst   = values[15]
    place_name = values[16]
    deglon = values[17]
    minlon = values[18]
    seclon = values[19]
    east   = values[20]
    deglat = values[21]
    minlat = values[22]
    seclat = values[23]
    north  = values[24]
    alt    = values[25]
    notes  = values[26]
    tzid   = values[27] if len(values) > 27 else ''
    tzauto = values[28] if len(values) > 28 else False

    # Reconstruct signed decimal coords
    lon = deglon + minlon / 60.0 + seclon / 3600.0
    if not east:
        lon = -lon
    lat = deglat + minlat / 60.0 + seclat / 3600.0
    if not north:
        lat = -lat

    # TZ offset → ISO string
    total_min = zh * 60 + zm
    if dst:
        total_min += 60
    if total_min == 0:
        tz_str = 'Z'
    else:
        sign = '+' if plus else '-'
        tz_str = f'{sign}{total_min // 60:02d}:{total_min % 60:02d}'

    # Date string
    if bc:
        date_str = f'-{abs(year):04d}-{month:02d}-{day:02d}'
    else:
        date_str = f'{year:04d}-{month:02d}-{day:02d}'

    return {
        'v':        _SCHEMA_VERSION,
        'id':       chart_id or str(uuid.uuid4()),
        'name':     name,
        'type':     _HTYPE_TO_STR.get(htype, 'radix'),
        'male':     male,
        'date':     date_str,
        'time':     f'{hour:02d}:{minute:02d}:{second:02d}',
        'tz':       tz_str,
        'tz_name':  '',
        'tzid':     tzid,
        'tzauto':   tzauto,
        'cal':      _CAL_TO_STR.get(cal, 'gregorian'),
        'zt':       _ZT_TO_STR.get(zt, 'zone'),
        'bc':       bc,
        'dst':      dst,
        'place':    place_name,
        'country':  '',
        'lat':      round(lat, 6),
        'lon':      round(lon, 6),
        'alt':      alt,
        'notes':    notes,
    }
