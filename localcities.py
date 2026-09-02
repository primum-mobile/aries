# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import csv
import io
import os
import sqlite3
import sys
import threading
import unicodedata
import zipfile

import app_paths


GEONAMES_COLUMNS = [
    'geonameid',
    'name',
    'asciiname',
    'alternatenames',
    'latitude',
    'longitude',
    'feature_class',
    'feature_code',
    'country_code',
    'cc2',
    'admin1_code',
    'admin2_code',
    'admin3_code',
    'admin4_code',
    'population',
    'elevation',
    'dem',
    'timezone',
    'modification_date',
]

_SCHEMA_VERSION = '4'
_STATE_LOCK = threading.Lock()
_HAS_FTS = False
_THREAD_LOCAL = threading.local()


def normalize_text(text):
    text = (text or '').strip().lower()
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    text = ' '.join(text.split())
    return text


def parse_int(value):
    value = (value or '').strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def parse_float(value):
    value = (value or '').strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def admin_priority(feature_code):
    if feature_code == 'PPLC':
        return 0
    if feature_code == 'PPLA':
        return 1
    if feature_code == 'PPLA2':
        return 2
    if feature_code == 'PPLA3':
        return 3
    if feature_code == 'PPLA4':
        return 4
    if feature_code == 'PPL':
        return 5
    return 9


def _candidate_base_dirs():
    candidates = []
    daemon_base = os.environ.get('ARIES_DAEMON_BASE_DIR', '').strip()
    if daemon_base:
        candidates.append(daemon_base)

    mei = getattr(sys, '_MEIPASS', None)
    if mei:
        candidates.append(mei)

    if getattr(sys, 'frozen', False):
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        candidates.append(exe_dir)
        candidates.append(os.path.dirname(os.path.dirname(exe_dir)))
        candidates.append(os.path.join(os.path.dirname(exe_dir), 'Resources'))

    candidates.append(os.getcwd())
    candidates.append(os.path.dirname(os.path.abspath(__file__)))

    seen = set()
    out = []
    for path in candidates:
        if not path:
            continue
        key = os.path.abspath(path)
        if key in seen:
            continue
        seen.add(key)
        out.append(path)
    return out


def _repo_root():
    for base_dir in _candidate_base_dirs():
        if os.path.isdir(os.path.join(base_dir, 'Res')):
            return base_dir
    return os.path.dirname(os.path.abspath(__file__))


def _resource_path(filename):
    for base_dir in _candidate_base_dirs():
        candidate = os.path.join(base_dir, 'Res', filename)
        if os.path.exists(candidate):
            return candidate
    return os.path.join(_repo_root(), 'Res', filename)


def _user_data_dir():
    return app_paths.app_support_dir()


def source_path():
    return _resource_path('cities500.zip')


def db_path():
    return _resource_path('places.sqlite3')


def available():
    return os.path.exists(db_path())


def _helper_paths():
    return (
        _resource_path('countryInfo.txt'),
        _resource_path('admin1CodesASCII.txt'),
    )


def _source_signature(path):
    parts = []
    for item_path in (path,) + _helper_paths():
        try:
            st = os.stat(item_path)
            parts.append('%s:%s:%s' % (os.path.basename(item_path), int(st.st_mtime), st.st_size))
        except OSError:
            parts.append('%s:missing' % os.path.basename(item_path))
    return '|'.join(parts)


def _load_country_names():
    path = _resource_path('countryInfo.txt')
    names = {}
    if not os.path.exists(path):
        return names
    try:
        with io.open(path, 'r', encoding='utf-8', newline='') as handle:
            reader = csv.reader(handle, delimiter='\t')
            for row in reader:
                if not row or row[0].startswith('#') or len(row) < 5:
                    continue
                code = row[0].strip()
                name = row[4].strip()
                if code and name:
                    names[code] = name
    except Exception:
        return {}
    return names


def _load_admin1_names():
    path = _resource_path('admin1CodesASCII.txt')
    names = {}
    if not os.path.exists(path):
        return names
    try:
        with io.open(path, 'r', encoding='utf-8', newline='') as handle:
            reader = csv.reader(handle, delimiter='\t')
            for row in reader:
                if not row or len(row) < 2:
                    continue
                code = row[0].strip()
                name = row[1].strip() or row[0].strip()
                if code and name:
                    names[code] = name
    except Exception:
        return {}
    return names


def _iter_geonames_rows(input_path):
    with zipfile.ZipFile(input_path, 'r') as zf:
        txt_names = [name for name in zf.namelist() if name.lower().endswith('.txt')]
        if not txt_names:
            raise RuntimeError('No .txt file found inside zip.')
        with zf.open(txt_names[0], 'r') as handle:
            stream = io.TextIOWrapper(handle, encoding='utf-8', newline='')
            reader = csv.reader(stream, delimiter='\t')
            for row in reader:
                if len(row) != len(GEONAMES_COLUMNS):
                    continue
                yield dict(zip(GEONAMES_COLUMNS, row))


def _format_region(country_name, admin1_name, country_code):
    if admin1_name and country_name:
        return '%s, %s' % (admin1_name, country_name)
    if country_name:
        return country_name
    return country_code or ''


def _create_schema(conn):
    cur = conn.cursor()
    cur.executescript(
        """
        DROP TABLE IF EXISTS places_rtree;
        DROP TABLE IF EXISTS place_aliases;
        DROP TABLE IF EXISTS places;
        DROP TABLE IF EXISTS countries;
        DROP TABLE IF EXISTS admin1;
        DROP TABLE IF EXISTS meta;

        CREATE TABLE places (
            geonameid INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            asciiname TEXT,
            search_name TEXT NOT NULL,
            search_ascii TEXT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            admin_priority INTEGER NOT NULL,
            country_code TEXT,
            admin1_code TEXT,
            population INTEGER,
            elevation INTEGER,
            timezone TEXT
        );

        CREATE VIRTUAL TABLE places_rtree USING rtree(
            geonameid,
            min_lon,
            max_lon,
            min_lat,
            max_lat
        );

        CREATE TABLE place_aliases (
            alias TEXT NOT NULL,
            geonameid INTEGER NOT NULL
        );

        CREATE TABLE countries (
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );

        CREATE TABLE admin1 (
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );

        CREATE TABLE meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE INDEX idx_places_search_name ON places(search_name);
        CREATE INDEX idx_places_search_ascii ON places(search_ascii);
        CREATE INDEX idx_places_country_code ON places(country_code);
        CREATE INDEX idx_places_admin1_code ON places(admin1_code);
        CREATE INDEX idx_places_admin_priority ON places(admin_priority);
        CREATE INDEX idx_places_population ON places(population DESC);
        """
    )
    fts_enabled = '0'
    cur.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('fts_enabled', ?)", (fts_enabled,))
    conn.commit()


def _build_database(db_file, source_file, source_signature):
    tmp_file = db_file + '.tmp'
    if os.path.exists(tmp_file):
        try:
            os.unlink(tmp_file)
        except OSError:
            pass
    country_names = _load_country_names()
    admin1_names = _load_admin1_names()
    conn = sqlite3.connect(tmp_file)
    try:
        _create_schema(conn)
        cur = conn.cursor()
        cur.execute('PRAGMA journal_mode=WAL')
        cur.execute('PRAGMA synchronous=NORMAL')
        cur.execute('PRAGMA temp_store=MEMORY')
        cur.executemany(
            'INSERT INTO countries (code, name) VALUES (?, ?)',
            sorted(country_names.items()),
        )
        cur.executemany(
            'INSERT INTO admin1 (code, name) VALUES (?, ?)',
            sorted(admin1_names.items()),
        )
        insert_sql = (
            'INSERT INTO places ('
            'geonameid, name, asciiname, search_name, search_ascii, '
            'latitude, longitude, admin_priority, country_code, admin1_code, population, elevation, timezone'
            ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        count = 0
        alias_count = 0
        for row in _iter_geonames_rows(source_file):
            if row['feature_class'] != 'P':
                continue
            geonameid = parse_int(row['geonameid'])
            latitude = parse_float(row['latitude'])
            longitude = parse_float(row['longitude'])
            if geonameid is None or latitude is None or longitude is None:
                continue
            name = (row['name'] or '').strip()
            asciiname = (row['asciiname'] or '').strip()
            search_name = normalize_text(name)
            search_ascii = normalize_text(asciiname) if asciiname else None
            country_code = (row['country_code'] or '').strip() or None
            admin1_code = (row['admin1_code'] or '').strip() or None
            elevation = parse_int(row['elevation'])
            if elevation is None:
                elevation = parse_int(row['dem'])
            cur.execute(
                insert_sql,
                (
                    geonameid,
                    name,
                    asciiname or None,
                    search_name,
                    search_ascii,
                    latitude,
                    longitude,
                    admin_priority((row['feature_code'] or '').strip()),
                    country_code,
                    admin1_code,
                    parse_int(row['population']) or 0,
                    elevation,
                    (row['timezone'] or '').strip() or None,
                ),
            )
            aliases = {
                normalize_text(alias)
                for alias in (row['alternatenames'] or '').split(',')
            }
            aliases.discard('')
            aliases.discard(search_name)
            if search_ascii:
                aliases.discard(search_ascii)
            if aliases:
                cur.executemany(
                    'INSERT INTO place_aliases (alias, geonameid) VALUES (?, ?)',
                    ((alias, geonameid) for alias in sorted(aliases)),
                )
                alias_count += len(aliases)
            count += 1
            if count % 5000 == 0:
                conn.commit()
        cur.execute(
            'INSERT INTO places_rtree '
            'SELECT geonameid, longitude, longitude, latitude, latitude FROM places'
        )
        cur.execute('CREATE INDEX idx_place_aliases_alias ON place_aliases(alias)')
        cur.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", (_SCHEMA_VERSION,))
        cur.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('source_signature', ?)", (source_signature,))
        cur.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('row_count', ?)", (str(count),))
        cur.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('alias_count', ?)", (str(alias_count),))
        conn.commit()
        conn.execute('VACUUM')
        conn.commit()
        # The bundled database is immutable/read-only in signed app resources.
        # Do not ship a WAL-mode header that makes readers request sibling
        # ``-shm``/``-wal`` files beside the signed resource.
        conn.execute('PRAGMA journal_mode=DELETE')
    finally:
        conn.close()
    os.replace(tmp_file, db_file)
    # A previous WAL-mode reader can leave ignored sidecars beside the resource.
    # They are never part of the immutable database and must not be swept into
    # Tauri's ``Res/**`` bundle on the next build.
    for suffix in ('-wal', '-shm'):
        try:
            os.unlink(db_file + suffix)
        except OSError:
            pass


def _ensure_connection():
    database_file = db_path()
    if not os.path.exists(database_file):
        return None
    conn = getattr(_THREAD_LOCAL, 'conn', None)
    conn_path = getattr(_THREAD_LOCAL, 'conn_path', '')
    if conn is None or conn_path != database_file:
        # The packaged database lives inside the signed application bundle.
        # SQLite's ordinary read-only mode can still create WAL/SHM siblings,
        # which invalidates the bundle signature after the first lookup.
        conn = sqlite3.connect(
            'file:%s?mode=ro&immutable=1' % database_file,
            uri=True,
            check_same_thread=False,
        )
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA query_only=ON')
        _THREAD_LOCAL.conn = conn
        _THREAD_LOCAL.conn_path = database_file
    return conn


def _rows_to_results(rows, results, seen, maxnum):
    for row in rows:
        geonameid = row['geonameid']
        if geonameid in seen:
            continue
        seen.add(geonameid)
        region = _format_region(row['country_name'], row['admin1_name'], row['country_code'])
        results.append(
            (
                row['name'],
                row['longitude'],
                row['latitude'],
                row['country_code'] or '',
                region,
                row['elevation'],
                None,
                row['admin1_code'] or '',
                row['admin1_name'] or '',
            )
        )
        if len(results) >= maxnum:
            break


def _seed_geonames_cache(results, rows_by_id):
    try:
        from geonames import Geonames
    except Exception:
        return
    for row in rows_by_id.values():
        try:
            key = Geonames._coord_key(row['longitude'], row['latitude'])
        except Exception:
            continue
        timezone_name = row['timezone']
        elevation = row['elevation']
        if timezone_name:
            Geonames._tz_cache[key] = timezone_name
        if elevation is not None:
            Geonames._elevation_cache[key] = elevation


def chart_label(result):
    if not result:
        return ''
    name = str(result[0] or '').strip()
    country_code = str(result[3] or '').strip().upper()
    region = str(result[4] or '').strip() if len(result) > 4 else ''
    country = region
    if ', ' in region:
        country = region.split(', ')[-1].strip()
    if name and country:
        return '%s, %s' % (name, country)
    return name


def search(query, maxnum=10):
    conn = _ensure_connection()
    if conn is None:
        return []
    q = normalize_text(query)
    if not q:
        return []
    prefix = q + '%'
    prefix_end = q + '\U0010ffff'
    contains = '%' + q + '%'
    limit = max(25, maxnum * 4)
    results = []
    seen = set()
    rows_by_id = {}

    rows = conn.execute(
        """
        WITH matches AS (
            SELECT p.geonameid,
                   CASE
                       WHEN p.search_name = ? THEN 0
                       WHEN p.search_ascii = ? THEN 0
                       WHEN p.search_name >= ? AND p.search_name < ? THEN 1
                       ELSE 1
                   END AS match_priority
            FROM places p
            WHERE p.search_name = ?
               OR p.search_ascii = ?
               OR (p.search_name >= ? AND p.search_name < ?)
               OR (p.search_ascii >= ? AND p.search_ascii < ?)
            UNION ALL
            SELECT pa.geonameid,
                   CASE WHEN pa.alias = ? THEN 0 ELSE 1 END AS match_priority
            FROM place_aliases pa
            WHERE pa.alias = ?
               OR (pa.alias >= ? AND pa.alias < ?)
        ), ranked_matches AS (
            SELECT geonameid, MIN(match_priority) AS match_priority
            FROM matches
            GROUP BY geonameid
        )
        SELECT p.geonameid, p.name, p.longitude, p.latitude, p.country_code,
               p.admin1_code,
               c.name AS country_name, a.name AS admin1_name,
               p.elevation, p.timezone, p.population, p.admin_priority,
               m.match_priority
        FROM ranked_matches m
        JOIN places p ON p.geonameid = m.geonameid
        LEFT JOIN countries c ON c.code = p.country_code
        LEFT JOIN admin1 a ON a.code = CASE
            WHEN p.country_code IS NOT NULL AND p.admin1_code IS NOT NULL THEN p.country_code || '.' || p.admin1_code
            ELSE NULL
        END
        ORDER BY
            m.match_priority,
            p.admin_priority ASC,
            p.population DESC,
            p.name ASC
        LIMIT ?
        """,
        (
            q, q, q, prefix_end,
            q, q, q, prefix_end, q, prefix_end,
            q, q, q, prefix_end,
            limit,
        ),
    ).fetchall()
    for row in rows:
        rows_by_id[row['geonameid']] = row
    _rows_to_results(rows, results, seen, maxnum)

    if len(results) < maxnum:
        rows = conn.execute(
            """
            SELECT p.geonameid, p.name, p.longitude, p.latitude, p.country_code,
                   p.admin1_code,
                   c.name AS country_name, a.name AS admin1_name,
                   p.elevation, p.timezone, p.population, p.admin_priority
            FROM places p
            LEFT JOIN countries c ON c.code = p.country_code
            LEFT JOIN admin1 a ON a.code = CASE
                WHEN p.country_code IS NOT NULL AND p.admin1_code IS NOT NULL THEN p.country_code || '.' || p.admin1_code
                ELSE NULL
            END
            WHERE p.search_name LIKE ?
               OR p.search_ascii LIKE ?
            ORDER BY
                CASE
                    WHEN p.search_name LIKE ? THEN 0
                    ELSE 1
                END,
                p.admin_priority ASC,
                p.population DESC,
                p.name ASC
            LIMIT ?
            """,
            (contains, contains, prefix, limit),
        ).fetchall()
        for row in rows:
            rows_by_id[row['geonameid']] = row
        _rows_to_results(rows, results, seen, maxnum)

    _seed_geonames_cache(results, rows_by_id)
    return results[:maxnum]


def nearest(longitude, latitude):
    conn = _ensure_connection()
    if conn is None:
        return None
    try:
        lon = float(longitude)
        lat = float(latitude)
    except (TypeError, ValueError):
        return None

    row = conn.execute(
        """
        SELECT p.geonameid, p.name, p.longitude, p.latitude, p.country_code,
               p.admin1_code,
               c.name AS country_name, a.name AS admin1_name,
               p.elevation, p.timezone, p.population, p.admin_priority
        FROM places p
        LEFT JOIN countries c ON c.code = p.country_code
        LEFT JOIN admin1 a ON a.code = CASE
            WHEN p.country_code IS NOT NULL AND p.admin1_code IS NOT NULL THEN p.country_code || '.' || p.admin1_code
            ELSE NULL
        END
        ORDER BY
            ((p.latitude - ?) * (p.latitude - ?)) + ((p.longitude - ?) * (p.longitude - ?)),
            p.admin_priority ASC,
            p.population DESC,
            p.name ASC
        LIMIT 1
        """,
        (lat, lat, lon, lon),
    ).fetchone()
    if row is None:
        return None

    result = (
        row['name'],
        row['longitude'],
        row['latitude'],
        row['country_code'] or '',
        _format_region(row['country_name'], row['admin1_name'], row['country_code']),
        row['elevation'],
        None,
        row['admin1_code'] or '',
        row['admin1_name'] or '',
    )
    _seed_geonames_cache([result], {row['geonameid']: row})
    return result


def timezone_near(longitude, latitude):
    conn = _ensure_connection()
    if conn is None:
        return None
    try:
        lon = float(longitude)
        lat = float(latitude)
    except (TypeError, ValueError):
        return None

    row = conn.execute(
        """
        SELECT p.geonameid, p.longitude, p.latitude, p.elevation, p.timezone
        FROM places p
        WHERE p.timezone IS NOT NULL AND p.timezone != ''
        ORDER BY
            ((p.latitude - ?) * (p.latitude - ?)) + ((p.longitude - ?) * (p.longitude - ?)),
            p.admin_priority ASC,
            p.population DESC,
            p.name ASC
        LIMIT 1
        """,
        (lat, lat, lon, lon),
    ).fetchone()
    if row is None:
        return None

    try:
        from geonames import Geonames
        Geonames._tz_cache[Geonames._coord_key(lon, lat)] = row['timezone']
        nearest_key = Geonames._coord_key(row['longitude'], row['latitude'])
        Geonames._tz_cache[nearest_key] = row['timezone']
        if row['elevation'] is not None:
            Geonames._elevation_cache[nearest_key] = row['elevation']
    except Exception:
        pass
    return row['timezone']
