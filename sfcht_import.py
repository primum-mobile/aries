# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Import module for Astro Gold .SFcht chart database files.

Parses the proprietary binary format and converts records to either:
  - Morinus .hor files (pickle, directly openable)
  - JSON files (same field layout as .hor, human-readable)

Binary layout (reverse-engineered):
  File  = 86-byte header + N x 300-byte records
  Header: 2 bytes magic (0x03 0x00) + 84 bytes creation timestamp (ASCII, space-padded)
  Record: see _parse_record() docstring for field map.
"""

import struct
import pickle
import json
import os
import math


# ---------------------------------------------------------------------------
# SFcht binary constants
# ---------------------------------------------------------------------------

_HEADER_SIZE = 86
_RECORD_SIZE = 300

# Record-start byte pairs (chart_type, subtype)
_SFCHT_PAIR_NATAL        = (0x01, 0x01)  # Standard record (Natal/Male/Female/Event)
_SFCHT_PAIR_COMPOSITE    = (0x05, 0x02)  # Composite chart
_SFCHT_PAIR_RELATIONSHIP = (0x05, 0x0F)  # Relationship (synastry)
_SFCHT_PAIR_SOLAR_RETURN = (0x04, 0x05)  # Solar Return
_SFCHT_PAIR_SATURN_RETURN = (0x04, 0x07) # Saturn Return

_SFCHT_VALID_PAIRS = {
    _SFCHT_PAIR_NATAL,
    _SFCHT_PAIR_COMPOSITE,
    _SFCHT_PAIR_RELATIONSHIP,
    _SFCHT_PAIR_SOLAR_RETURN,
    _SFCHT_PAIR_SATURN_RETURN,
}

# byte117 category values (within standard records)
_SFCHT_CAT_NATAL  = 0x00
_SFCHT_CAT_MALE   = 0x01
_SFCHT_CAT_FEMALE = 0x02
_SFCHT_CAT_EVENT  = 0x03
_SFCHT_CAT_HORARY = 0x04

# Morinus chart types (from chart.py)
_HOR_RADIX        = 0
_HOR_SOLAR        = 1
_HOR_REVOLUTION   = 3
_HOR_TRANSIT      = 4
_HOR_HORARY       = 5
_HOR_COMPOSITE    = 8
_HOR_RELATIONSHIP = 9

# Field widths inside a record
_NAME_LEN    = 50
_CITY_LEN    = 20
_COUNTRY_LEN = 20


# ---------------------------------------------------------------------------
# Low-level binary parsing
# ---------------------------------------------------------------------------

def _parse_record(buf, offset):
    """Parse a single 300-byte SFcht record.

    Record layout (offsets relative to record start):
        +0    uint8   chart_type  (0x01=natal, 0x05=composite/synastry, 0x04=event)
        +1    uint8   subtype     (type-specific modifier)
        +2    50B     name        (Latin-1, space-padded)
        +52   20B     city        (Latin-1, space-padded)
        +72   20B     country     (Latin-1, space-padded)
        +92   float32 longitude   (LE, East-negative)
        +96   float32 latitude    (LE, North-positive)
        +100  uint16  year        (LE)
        +102  uint8   month       (1-12)
        +103  uint8   day         (1-31)
        +104  uint8   hour        (local time, 0-23)
        +105  uint8   minute      (0-59)
        +106  uint8   (reserved, usually 0x00)
        +107  float32 tz_offset   (LE, sign-inverted hours; negate → UTC offset)
        +111  5B      tz_name     (Latin-1, space-padded)
        +260  uint16  mod_year    (LE, last-modified timestamp)
        +262  uint8   mod_month
        +263  uint8   mod_day
        +264  uint8   mod_hour
        +265  uint8   mod_minute
        +266  uint8   mod_second

    Returns a dict with decoded fields, or None if the record is invalid.
    """
    if offset + _RECORD_SIZE > len(buf):
        return None

    chart_type = buf[offset]
    subtype    = buf[offset + 1]

    # Name must be printable Latin-1
    name_raw = buf[offset + 2 : offset + 2 + _NAME_LEN]
    try:
        name = name_raw.decode('latin-1').rstrip()
    except Exception:
        return None
    if not name:
        return None

    city_raw    = buf[offset + 52 : offset + 72]
    country_raw = buf[offset + 72 : offset + 92]
    city    = city_raw.decode('latin-1').rstrip()
    country = country_raw.decode('latin-1').rstrip()

    # Coordinates
    lon_raw = struct.unpack_from('<f', buf, offset + 92)[0]
    lat_raw = struct.unpack_from('<f', buf, offset + 96)[0]

    # Validate ranges
    if not (-180.0 <= lon_raw <= 180.0) or not (-90.0 <= lat_raw <= 90.0):
        return None

    # Date / time
    year   = struct.unpack_from('<H', buf, offset + 100)[0]
    month  = buf[offset + 102]
    day    = buf[offset + 103]
    hour   = buf[offset + 104]
    minute = buf[offset + 105]
    second = 0  # SFcht format doesn't store seconds

    if not (1 <= month <= 12) or not (1 <= day <= 31):
        return None
    if year < 100 or year > 2200:
        return None

    # Timezone
    tz_offset_raw = struct.unpack_from('<f', buf, offset + 107)[0]
    tz_name_raw   = buf[offset + 111 : offset + 116]
    tz_name = tz_name_raw.decode('latin-1').rstrip()

    # Modification timestamp
    mod_year   = struct.unpack_from('<H', buf, offset + 260)[0]
    mod_month  = buf[offset + 262]
    mod_day    = buf[offset + 263]
    mod_hour   = buf[offset + 264]
    mod_minute = buf[offset + 265]
    mod_second = buf[offset + 266]

    # Sign conventions: SFcht stores East longitude as negative, TZ as sign-inverted
    longitude = -lon_raw   # flip: East positive
    latitude  = lat_raw    # North positive already
    tz_hours  = -tz_offset_raw  # flip: UTC+ is positive
    
    # Gender detection from SFcht binary analysis (verified from screenshot):
    #   byte117=0x02 = Female (15 entries: Sianza, Juno, Tanja, Marie Berger, etc.)
    #   byte117=0x01 = Male (Opa, Nietzsche, Konrad, owen, Ph, etc.)
    #   byte117=0x00 = Natal (no gender: Patricia, Wolf-Dietrich, Papa, ChatGPT, Putin, etc.)
    #   byte117=0x20 and all other values = Event/Composite/Other (no gender)
    gender_byte = buf[offset + 117]
    is_male = None  # None = no gender (Natal, Event, Composite types)
    
    if gender_byte == 0x02:
        is_male = False  # Female
    elif gender_byte == 0x01:
        is_male = True   # Male (explicitly tagged Male in AstroGold)
    # byte117=0x00 and all other values remain None (Natal/Event/Composite have no gender)

    return {
        'chart_type': chart_type,
        'subtype':    subtype,
        'byte117':    gender_byte,
        'name':       name,
        'city':       city,
        'country':    country,
        'longitude':  longitude,
        'latitude':   latitude,
        'year':       year,
        'month':      month,
        'day':        day,
        'hour':       hour,
        'minute':     minute,
        'second':     second,
        'tz_hours':   tz_hours,
        'tz_name':    tz_name,
        'mod_year':   mod_year,
        'mod_month':  mod_month,
        'mod_day':    mod_day,
        'mod_hour':   mod_hour,
        'mod_minute': mod_minute,
        'mod_second': mod_second,
        'male':       is_male,
    }


def parse_sfcht(filepath):
    """Parse an entire .SFcht file and return a list of valid chart records.

    Scans for 0x01 0x01 record markers (natal charts) and also recognises
    0x05 0x02 (synastry/composite) and 0x04 0x05 (variant) markers.
    Records that fail validation are silently skipped.
    """
    with open(filepath, 'rb') as f:
        buf = f.read()

    records = []
    seen_offsets = set()

    # Scan every byte for valid record starts
    i = 0
    while i <= len(buf) - _RECORD_SIZE:
        b0, b1 = buf[i], buf[i + 1]
        # Recognised chart-type markers (skip 0x00,0x00 internal reference copies)
        if (b0, b1) in _SFCHT_VALID_PAIRS:
            rec = _parse_record(buf, i)
            if rec is not None and i not in seen_offsets:
                seen_offsets.add(i)
                records.append(rec)
        i += 1

    # Deduplicate overlapping detections (keep first hit per 50-byte window)
    deduped = []
    last_offset = -100
    for rec in records:
        # Records are reconstructed from the scan offset implicitly; use name+date as key
        key = (rec['name'], rec['year'], rec['month'], rec['day'], rec['hour'], rec['minute'])
        if not deduped or key != (deduped[-1]['name'], deduped[-1]['year'],
                                   deduped[-1]['month'], deduped[-1]['day'],
                                   deduped[-1]['hour'], deduped[-1]['minute']):
            deduped.append(rec)

    return deduped


# ---------------------------------------------------------------------------
# Coordinate helpers: decimal degrees ↔ deg/min/sec
# ---------------------------------------------------------------------------

def _decimal_to_dms(decimal_deg):
    """Convert decimal degrees to (deg, min, sec) all non-negative."""
    total = abs(decimal_deg)
    deg = int(total)
    remainder = (total - deg) * 60.0
    minutes = int(remainder)
    seconds = (remainder - minutes) * 60.0
    # Clamp rounding artefacts
    if seconds >= 59.9999:
        seconds = 0.0
        minutes += 1
    if minutes >= 60:
        minutes = 0
        deg += 1
    return deg, minutes, round(seconds, 2)


# ---------------------------------------------------------------------------
# Conversion to Morinus .hor field list (29 pickle objects)
# ---------------------------------------------------------------------------

def _sfcht_to_hor_values(rec):
    """Convert an SFcht record dict to the 29-element list that Morinus
    serialises into a .hor pickle file.

    Index → field mapping matches morin.py _write_chart_file() exactly:
        0  name           str
        1  male           bool
        2  htype          int   (0=RADIX, 4=TRANSIT, ...)
        3  bc             bool
        4  year           int
        5  month          int
        6  day            int
        7  hour           int
        8  minute         int
        9  second         int
        10 cal            int   (0=Gregorian)
        11 zt             int   (0=Zone)
        12 plus           bool  (True=East of Greenwich)
        13 zh             int   (zone hours, absolute)
        14 zm             int   (zone minutes, absolute)
        15 daylightsaving bool
        16 place          str
        17 deglon         float
        18 minlon         float
        19 seclon         float
        20 east           bool
        21 deglat         float
        22 minlat         float
        23 seclat         float
        24 north          bool
        25 altitude       float
        26 notes          str
        27 tzid           str
        28 tzauto         bool
    """
    # Chart type mapping from byte pair + byte117 category
    pair = (rec['chart_type'], rec['subtype'])
    b117 = rec.get('byte117', _SFCHT_CAT_NATAL)
    if pair == _SFCHT_PAIR_COMPOSITE:
        htype = _HOR_COMPOSITE
    elif pair == _SFCHT_PAIR_RELATIONSHIP:
        htype = _HOR_RELATIONSHIP
    elif pair == _SFCHT_PAIR_SOLAR_RETURN:
        htype = _HOR_SOLAR
    elif pair == _SFCHT_PAIR_SATURN_RETURN:
        htype = _HOR_REVOLUTION
    elif b117 == _SFCHT_CAT_EVENT:
        htype = _HOR_TRANSIT
    elif b117 == _SFCHT_CAT_HORARY:
        htype = _HOR_HORARY
    else:
        htype = _HOR_RADIX

    # Place string: combine city + country
    parts = [p for p in (rec['city'], rec['country']) if p]
    place_str = ', '.join(parts) if parts else ''

    # Longitude: decimal → DMS + direction
    lon = rec['longitude']
    east = lon >= 0.0
    deglon, minlon, seclon = _decimal_to_dms(lon)

    # Latitude: decimal → DMS + direction
    lat = rec['latitude']
    north = lat >= 0.0
    deglat, minlat, seclat = _decimal_to_dms(lat)

    # Timezone: SFcht tz_hours is the full UTC offset (DST already folded in).
    # Store as plus/zh/zm with daylightsaving=False.
    tz = rec['tz_hours']
    plus = tz >= 0.0
    tz_abs = abs(tz)
    zh = int(tz_abs)
    zm = int(round((tz_abs - zh) * 60.0))

    return [
        rec['name'],        # 0  name
        rec.get('male', True) if rec.get('male') is not None else True,  # 1  male (None events default to male for compatibility)
        htype,              # 2  htype
        False,              # 3  bc
        rec['year'],        # 4  year
        rec['month'],       # 5  month
        rec['day'],         # 6  day
        rec['hour'],        # 7  hour
        rec['minute'],      # 8  minute
        0,                  # 9  second (SFcht has no seconds)
        0,                  # 10 cal = Gregorian
        0,                  # 11 zt = Zone
        plus,               # 12 plus
        zh,                 # 13 zh
        zm,                 # 14 zm
        False,              # 15 daylightsaving (offset already includes DST)
        place_str,          # 16 place
        float(deglon),      # 17 deglon
        float(minlon),      # 18 minlon
        float(seclon),      # 19 seclon
        east,               # 20 east
        float(deglat),      # 21 deglat
        float(minlat),      # 22 minlat
        float(seclat),      # 23 seclat
        north,              # 24 north
        0.0,                # 25 altitude (SFcht has no altitude)
        '',                 # 26 notes
        '',                 # 27 tzid
        False,              # 28 tzauto
    ]


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------

def write_hor(rec, filepath):
    """Write a single SFcht record as a Morinus .hor file (pickle protocol 2)."""
    values = _sfcht_to_hor_values(rec)
    with open(filepath, 'wb') as f:
        p = pickle.Pickler(f, 2)
        for v in values:
            p.dump(v)


def _record_to_json_dict(rec):
    """Convert an SFcht record to a JSON-serialisable dict using the same
    field names as the Morinus .hor format."""
    vals = _sfcht_to_hor_values(rec)
    keys = [
        'name', 'male', 'htype', 'bc',
        'year', 'month', 'day', 'hour', 'minute', 'second',
        'cal', 'zt', 'plus', 'zh', 'zm', 'daylightsaving',
        'place', 'deglon', 'minlon', 'seclon', 'east',
        'deglat', 'minlat', 'seclat', 'north',
        'altitude', 'notes', 'tzid', 'tzauto',
    ]
    d = dict(zip(keys, vals))
    # Attach original SFcht metadata for provenance
    d['_sfcht'] = {
        'chart_type': rec['chart_type'],
        'subtype':    rec['subtype'],
        'tz_name':    rec['tz_name'],
        'tz_hours':   rec['tz_hours'],
        'longitude_decimal': rec['longitude'],
        'latitude_decimal':  rec['latitude'],
        'modified': (
            f"{rec['mod_year']}-{rec['mod_month']:02d}-{rec['mod_day']:02d} "
            f"{rec['mod_hour']:02d}:{rec['mod_minute']:02d}:{rec['mod_second']:02d}"
        ) if rec['mod_year'] > 1900 else None,
    }
    return d


def write_json(records, filepath):
    """Write a list of SFcht records to a single JSON file.

    Each record uses the same field names as the Morinus .hor pickle layout,
    making future JSON-import support trivial.
    """
    data = [_record_to_json_dict(r) for r in records]
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _record_to_v1_dict(rec):
    """Convert an SFcht record to a chartfile.py schema-v1 dict (JSONL-ready)."""
    import uuid

    # Chart type mapping from byte pair + byte117 category
    pair = (rec['chart_type'], rec['subtype'])
    b117 = rec.get('byte117', _SFCHT_CAT_NATAL)
    if pair == _SFCHT_PAIR_COMPOSITE:
        type_str = 'composite'
    elif pair == _SFCHT_PAIR_RELATIONSHIP:
        type_str = 'relationship'
    elif pair == _SFCHT_PAIR_SOLAR_RETURN:
        type_str = 'solar'
    elif pair == _SFCHT_PAIR_SATURN_RETURN:
        type_str = 'revolution'
    elif b117 == _SFCHT_CAT_EVENT:
        type_str = 'transit'
    elif b117 == _SFCHT_CAT_HORARY:
        type_str = 'horary'
    else:
        type_str = 'radix'

    # Place
    parts = [p for p in (rec['city'], rec['country']) if p]
    place_str = rec['city'] if rec['city'] else ''
    country_str = rec['country'] if rec['country'] else ''

    # Timezone offset → ISO 8601
    tz = rec['tz_hours']
    if tz == 0.0:
        tz_str = 'Z'
    else:
        sign = '+' if tz >= 0 else '-'
        tz_abs = abs(tz)
        tz_h = int(tz_abs)
        tz_m = int(round((tz_abs - tz_h) * 60.0))
        tz_str = f'{sign}{tz_h:02d}:{tz_m:02d}'

    # Format modification timestamp as ISO 8601 if valid
    mod_timestamp = ''
    if (rec['mod_year'] >= 100 and rec['mod_year'] <= 2200 and 
        1 <= rec['mod_month'] <= 12 and 1 <= rec['mod_day'] <= 31):
        mod_timestamp = f"{rec['mod_year']:04d}-{rec['mod_month']:02d}-{rec['mod_day']:02d}T{rec['mod_hour']:02d}:{rec['mod_minute']:02d}:{rec['mod_second']:02d}"

    return {
        'v':        1,
        'id':       str(uuid.uuid4()),
        'name':     rec['name'],
        'type':     type_str,
        'male':     rec.get('male', True),  # ← Preserve None for events, True for male
        'date':     f"{rec['year']:04d}-{rec['month']:02d}-{rec['day']:02d}",
        'time':     f"{rec['hour']:02d}:{rec['minute']:02d}:00",
        'tz':       tz_str,
        'tz_name':  rec['tz_name'],
        'tzid':     '',
        'tzauto':   False,
        'cal':      'gregorian',
        'zt':       'zone',
        'bc':       False,
        'dst':      False,
        'place':    place_str,
        'country':  country_str,
        'lat':      round(rec['latitude'], 6),
        'lon':      round(rec['longitude'], 6),
        'alt':      0.0,
        'notes':    '',
        'modified_at': mod_timestamp,  # ← NEW: AstroGold modification timestamp
    }


def write_jsonl(records, filepath):
    """Write SFcht records as a Morinus Aries .jsonl collection (schema v1)."""
    data = [_record_to_v1_dict(r) for r in records]
    with open(filepath, 'w', encoding='utf-8') as f:
        for d in data:
            f.write(json.dumps(d, ensure_ascii=False, separators=(',', ':')) + '\n')


def write_hor_batch(records, output_dir):
    """Write every record as an individual .hor file inside output_dir.

    Filenames are sanitised from the chart name.  Returns a list of
    (record_name, output_path) tuples.
    """
    os.makedirs(output_dir, exist_ok=True)
    written = []
    used_names = set()
    for rec in records:
        base = _safe_filename(rec['name'])
        # Disambiguate duplicates
        fname = base
        n = 2
        while fname in used_names:
            fname = f"{base}_{n}"
            n += 1
        used_names.add(fname)
        fpath = os.path.join(output_dir, fname + '.hor')
        write_hor(rec, fpath)
        written.append((rec['name'], fpath))
    return written


def _safe_filename(name):
    """Sanitise a chart name into a filesystem-safe filename."""
    safe = name.replace('/', '-').replace('\\', '-').replace(':', '-')
    safe = ''.join(c for c in safe if c.isalnum() or c in (' ', '-', '_', '.'))
    safe = safe.strip()
    return safe or 'chart'


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description='Import Astro Gold .SFcht chart database into Morinus Aries .jsonl / legacy .hor files.')
    parser.add_argument('sfcht_file', help='Path to the .SFcht file')
    parser.add_argument('-o', '--output', default=None,
                        help='Output path for .jsonl collection (default: <sfcht_file>.jsonl)')
    parser.add_argument('--hor', action='store_true',
                        help='Also write individual legacy .hor files')
    parser.add_argument('--hor-dir', default=None,
                        help='Directory for .hor output (default: <sfcht_file>_hor/)')
    parser.add_argument('--legacy-json', default=None,
                        help='Write old-style JSON array (for debugging)')
    parser.add_argument('--list', action='store_true',
                        help='List records without writing files')
    args = parser.parse_args()

    records = parse_sfcht(args.sfcht_file)
    print(f"Parsed {len(records)} chart records from {args.sfcht_file}")

    if args.list:
        for i, r in enumerate(records):
            print(f"  [{i:3d}] {r['name']:30s}  {r['year']}-{r['month']:02d}-{r['day']:02d} "
                  f"{r['hour']:02d}:{r['minute']:02d}  {r['city']}, {r['country']}  "
                  f"TZ={r['tz_name']}({r['tz_hours']:+.1f}h)")
        return

    base = os.path.splitext(args.sfcht_file)[0]

    # Primary output: JSONL collection (Morinus Aries native)
    jsonl_path = args.output or (base + '.jsonl')
    write_jsonl(records, jsonl_path)
    print(f"Wrote {jsonl_path}  ({len(records)} records)")

    # Optional: legacy JSON array
    if args.legacy_json:
        write_json(records, args.legacy_json)
        print(f"Wrote {args.legacy_json}  ({len(records)} records, legacy format)")

    # Optional: individual .hor files
    if args.hor:
        hor_dir = args.hor_dir or (base + '_hor')
        written = write_hor_batch(records, hor_dir)
        print(f"Wrote {len(written)} .hor files to {hor_dir}/")
        for name, path in written[:5]:
            print(f"  {name} → {path}")
        if len(written) > 5:
            print(f"  ... and {len(written) - 5} more")


if __name__ == '__main__':
    main()
