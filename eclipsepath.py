# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Swiss Ephemeris solar eclipse shadow-path projection.

The output is plain WGS84 GeoJSON for the MapLibre/OpenStreetMap view. Swiss
Ephemeris supplies the event contacts, central-line point, and core-shadow
diameter; this module only samples those values and projects a smooth-limb path
strip around the centerline.
"""

from __future__ import annotations

from dataclasses import dataclass
import math

import astrology


SEFLG = astrology.SEFLG_SWIEPH
EARTH_RADIUS_KM = 6371.0088
DEFAULT_SAMPLE_SECONDS = 120
POLAR_FILL_LAT_LIMIT = 82.0
MAX_RENDER_LON_STEP_DEG = 5.0
MAX_RENDER_LAT_STEP_DEG = 2.0
MAX_RENDER_REFINE_DEPTH = 8
PATH_CAP_SEGMENTS = 12

MAJOR_SOLAR_FLAGS = (
    astrology.SE_ECL_TOTAL |
    astrology.SE_ECL_ANNULAR |
    astrology.SE_ECL_ANNULAR_TOTAL
)


class EclipsePathError(Exception):
    pass


@dataclass(frozen=True)
class _WherePoint:
    jdut: float
    lon: float
    lat: float
    retflag: int
    width_km: float
    magnitude: float
    obscuration: float


def _flag_int(value) -> int:
    if isinstance(value, (list, tuple)):
        for item in value:
            try:
                return int(item)
            except Exception:
                continue
        return 0
    try:
        return int(value)
    except Exception:
        return 0


def _is_finite_number(value) -> bool:
    try:
        return math.isfinite(float(value))
    except Exception:
        return False


def _normalize_lon(lon: float) -> float:
    value = (float(lon) + 180.0) % 360.0 - 180.0
    if value == -180.0:
        return 180.0
    return value


def _parse_when_glob_result(result):
    if not isinstance(result, tuple):
        return 0, ()
    retflag = 0
    tret = ()
    for item in result:
        if isinstance(item, (int, float)) and not retflag:
            retflag = int(item)
        elif isinstance(item, (list, tuple)) and len(item) == 1 and not retflag:
            retflag = _flag_int(item)
        elif (
            isinstance(item, (list, tuple)) and
            len(item) >= 10 and
            all(isinstance(v, (int, float)) for v in item[:10])
        ):
            tret = tuple(float(v) for v in item[:10])
    return retflag, tret


def _parse_where_result(result):
    if not isinstance(result, tuple):
        return 0, None, None
    retflag = 0
    geopos = None
    attr = None
    for item in result:
        if isinstance(item, (int, float)) and not retflag:
            retflag = int(item)
        elif isinstance(item, (list, tuple)) and len(item) == 1 and not retflag:
            retflag = _flag_int(item)
        elif isinstance(item, (list, tuple)) and len(item) >= 11 and isinstance(item[0], (int, float)):
            attr = tuple(float(v) for v in item)
        elif isinstance(item, (list, tuple)) and len(item) >= 2 and isinstance(item[0], (int, float)):
            if geopos is None:
                geopos = (float(item[0]), float(item[1]))
    return retflag, geopos, attr


def _sol_when_glob(jdut: float):
    try:
        result = astrology.swe_sol_eclipse_when_glob(float(jdut), SEFLG, 0, 0)
    except TypeError:
        result = astrology.swe_sol_eclipse_when_glob(float(jdut), SEFLG, 0)
    return _parse_when_glob_result(result)


def _sol_where(jdut: float):
    result = astrology.swe_sol_eclipse_where(float(jdut), SEFLG)
    return _parse_where_result(result)


def _find_event_near(jdut: float):
    target = float(jdut)
    cursor = target - 40.0
    closest = None
    for _ in range(12):
        retflag, tret = _sol_when_glob(cursor)
        if not retflag or not tret or not _is_finite_number(tret[0]):
            break
        tmax = float(tret[0])
        if closest is None or abs(tmax - target) < abs(float(closest[1][0]) - target):
            closest = (retflag, tret)
        if abs(tmax - target) <= 2.0:
            return retflag, tret
        if tmax > target + 2.0:
            break
        cursor = tmax + 0.01
    if closest is not None and abs(float(closest[1][0]) - target) <= 5.0:
        return closest
    raise EclipsePathError("Swiss Ephemeris could not locate the matching solar eclipse.")


def _event_interval(tret, fallback_jdut: float) -> tuple[float, float]:
    def pair(a, b):
        if len(tret) <= max(a, b):
            return None
        start = float(tret[a])
        end = float(tret[b])
        if _is_finite_number(start) and _is_finite_number(end) and end > start:
            return start, end
        return None

    for indices in ((6, 7), (4, 5), (2, 3)):
        found = pair(*indices)
        if found is not None:
            return found
    return float(fallback_jdut) - 0.08, float(fallback_jdut) + 0.08


def _solar_kind(retflag: int) -> str:
    retflag = int(retflag)
    if retflag & astrology.SE_ECL_ANNULAR_TOTAL:
        return "hybrid"
    if retflag & astrology.SE_ECL_TOTAL:
        return "total"
    if retflag & astrology.SE_ECL_ANNULAR:
        return "annular"
    if retflag & astrology.SE_ECL_PARTIAL:
        return "partial"
    return "solar"


def _utc_label(jdut: float) -> str:
    y, m, d, h = astrology.swe_revjul(float(jdut), astrology.SE_GREG_CAL)
    hh = int(h)
    mm = int((h - hh) * 60.0)
    ss = int(round((((h - hh) * 60.0) - mm) * 60.0))
    if ss == 60:
        ss = 0
        mm += 1
    if mm == 60:
        mm = 0
        hh += 1
    return "%04d-%02d-%02d %02d:%02d:%02d UT" % (int(y), int(m), int(d), hh, mm, ss)


def _sample_times(start: float, end: float, jdut_max: float, sample_seconds: int):
    step = max(30.0, float(sample_seconds)) / 86400.0
    count = max(2, int(math.ceil((end - start) / step)))
    values = [start + (end - start) * (i / float(count)) for i in range(count + 1)]
    if start <= jdut_max <= end:
        values.append(float(jdut_max))
    values.sort()
    out = []
    last = None
    for value in values:
        if last is None or abs(value - last) > 1e-8:
            out.append(value)
            last = value
    return out


def _where_point_at(jdut: float) -> _WherePoint | None:
    try:
        retflag, geopos, attr = _sol_where(jdut)
    except Exception:
        return None
    if not (retflag & MAJOR_SOLAR_FLAGS):
        return None
    if geopos is None or attr is None or len(attr) <= 3:
        return None
    lon, lat = geopos
    if not (_is_finite_number(lon) and _is_finite_number(lat)):
        return None
    width_km = abs(float(attr[3]))
    if not math.isfinite(width_km) or width_km <= 0.0 or width_km > 2000.0:
        return None
    magnitude = float(attr[0]) if len(attr) > 0 and _is_finite_number(attr[0]) else 0.0
    obscuration = float(attr[1]) if len(attr) > 1 and _is_finite_number(attr[1]) else 0.0
    return _WherePoint(
        jdut=float(jdut),
        lon=_normalize_lon(lon),
        lat=max(-89.999999, min(89.999999, float(lat))),
        retflag=int(retflag),
        width_km=width_km,
        magnitude=magnitude,
        obscuration=obscuration,
    )


def _longitude_delta_deg(a: float, b: float) -> float:
    return abs(_normalize_lon(float(b) - float(a)))


def _needs_render_refine(a: _WherePoint, b: _WherePoint) -> bool:
    if abs(float(b.jdut) - float(a.jdut)) * 86400.0 <= 1.0:
        return False
    return (
        _longitude_delta_deg(a.lon, b.lon) > MAX_RENDER_LON_STEP_DEG or
        abs(float(b.lat) - float(a.lat)) > MAX_RENDER_LAT_STEP_DEG
    )


def _refine_where_segment(a: _WherePoint, b: _WherePoint, depth: int) -> list[_WherePoint]:
    if depth <= 0 or not _needs_render_refine(a, b):
        return [a, b]
    mid = _where_point_at((float(a.jdut) + float(b.jdut)) / 2.0)
    if mid is None or not (a.jdut < mid.jdut < b.jdut):
        return [a, b]
    left = _refine_where_segment(a, mid, depth - 1)
    right = _refine_where_segment(mid, b, depth - 1)
    return left[:-1] + right


def _refine_where_points_for_render(points: list[_WherePoint]) -> list[_WherePoint]:
    if len(points) < 2:
        return points
    refined: list[_WherePoint] = [points[0]]
    for a, b in zip(points, points[1:]):
        segment = _refine_where_segment(a, b, MAX_RENDER_REFINE_DEPTH)
        refined.extend(segment[1:])
    return refined


def _sample_where_points(start: float, end: float, jdut_max: float, sample_seconds: int):
    points = []
    for jdut in _sample_times(start, end, jdut_max, sample_seconds):
        point = _where_point_at(jdut)
        if point is not None:
            points.append(point)
    return _refine_where_points_for_render(points)


def _initial_bearing(a: _WherePoint, b: _WherePoint) -> float:
    lat1 = math.radians(a.lat)
    lat2 = math.radians(b.lat)
    dlon = math.radians(_normalize_lon(b.lon - a.lon))
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _destination(lon: float, lat: float, bearing_deg: float, distance_km: float):
    angular_distance = float(distance_km) / EARTH_RADIUS_KM
    bearing = math.radians(float(bearing_deg))
    lat1 = math.radians(float(lat))
    lon1 = math.radians(float(lon))
    sin_lat1 = math.sin(lat1)
    cos_lat1 = math.cos(lat1)
    sin_dist = math.sin(angular_distance)
    cos_dist = math.cos(angular_distance)

    lat2 = math.asin(sin_lat1 * cos_dist + cos_lat1 * sin_dist * math.cos(bearing))
    lon2 = lon1 + math.atan2(
        math.sin(bearing) * sin_dist * cos_lat1,
        cos_dist - sin_lat1 * math.sin(lat2),
    )
    return [_normalize_lon(math.degrees(lon2)), math.degrees(lat2)]


def _line_coords(points):
    return [[p.lon, p.lat] for p in points]


def _split_antimeridian(coords):
    if len(coords) < 2:
        return []
    segments = []
    current = [coords[0]]
    for coord in coords[1:]:
        prev = current[-1]
        prev_lon = _normalize_lon(float(prev[0]))
        cur_lon = _normalize_lon(float(coord[0]))
        delta = cur_lon - prev_lon
        if abs(delta) > 180.0:
            if delta > 0.0:
                boundary = -180.0
                cur_unwrapped = cur_lon - 360.0
            else:
                boundary = 180.0
                cur_unwrapped = cur_lon + 360.0
            denom = cur_unwrapped - prev_lon
            ratio = 0.0 if abs(denom) < 1e-12 else (boundary - prev_lon) / denom
            ratio = max(0.0, min(1.0, ratio))
            boundary_lat = float(prev[1]) + (float(coord[1]) - float(prev[1])) * ratio
            current.append([boundary, boundary_lat])
            if len(current) > 1:
                segments.append(current)
            opposite = 180.0 if boundary < 0.0 else -180.0
            current = [[opposite, boundary_lat], [_normalize_lon(cur_lon), float(coord[1])]]
        else:
            current.append([cur_lon, float(coord[1])])
    if len(current) > 1:
        segments.append(current)
    return segments


def _has_antimeridian_jump(coords) -> bool:
    if len(coords) < 2:
        return False
    for prev, cur in zip(coords, coords[1:]):
        if abs(float(cur[0]) - float(prev[0])) > 180.0:
            return True
    return False


def _limit_coords(points):
    left = []
    right = []
    for index, point in enumerate(points):
        if len(points) == 1:
            bearing = 0.0
        elif index == 0:
            bearing = _initial_bearing(point, points[index + 1])
        elif index == len(points) - 1:
            bearing = _initial_bearing(points[index - 1], point)
        else:
            bearing = _initial_bearing(points[index - 1], points[index + 1])
        half_width = point.width_km / 2.0
        left.append(_destination(point.lon, point.lat, bearing - 90.0, half_width))
        right.append(_destination(point.lon, point.lat, bearing + 90.0, half_width))
    return left, right


def _path_coord_is_renderable(coord) -> bool:
    try:
        return abs(float(coord[1])) <= POLAR_FILL_LAT_LIMIT
    except Exception:
        return False


def _bearing_for_path_point(points: list[_WherePoint], index: int) -> float:
    if len(points) < 2:
        return 0.0
    if index <= 0:
        return _initial_bearing(points[0], points[1])
    if index >= len(points) - 1:
        return _initial_bearing(points[-2], points[-1])
    return _initial_bearing(points[index - 1], points[index + 1])


def _cap_coords(point: _WherePoint, bearing: float, start_offset: float, end_offset: float):
    half_width = point.width_km / 2.0
    coords = []
    for step in range(PATH_CAP_SEGMENTS + 1):
        fraction = step / float(PATH_CAP_SEGMENTS)
        coords.append(_destination(
            point.lon,
            point.lat,
            bearing + start_offset + (end_offset - start_offset) * fraction,
            half_width,
        ))
    return coords


def _ring_for_span(
    left,
    right,
    start: int,
    end: int,
    points: list[_WherePoint] | None = None,
    *,
    cap_start: bool = True,
    cap_end: bool = True,
):
    if end - start < 1:
        return None
    span_left = [list(coord) for coord in left[start:end + 1]]
    span_right = [list(coord) for coord in right[start:end + 1]]
    if points is not None and len(points) == len(left):
        ring = list(span_left)
        if cap_end:
            end_bearing = _bearing_for_path_point(points, end)
            end_cap = _cap_coords(points[end], end_bearing, -90.0, 90.0)
            ring.extend(end_cap[1:])
            ring.extend(reversed(span_right[:-1]))
        else:
            ring.extend(reversed(span_right))
        if cap_start:
            start_bearing = _bearing_for_path_point(points, start)
            start_cap = _cap_coords(points[start], start_bearing, 90.0, 270.0)
            ring.extend(start_cap[1:])
    else:
        ring = span_left + list(reversed(span_right))
    if any(not _path_coord_is_renderable(coord) for coord in ring):
        return None
    if ring[0] != ring[-1]:
        ring.append(list(ring[0]))
    return ring


def _clip_polygon_longitude(coords, boundary: float, keep_greater: bool):
    if len(coords) < 3:
        return []
    output = []
    previous = coords[-1]
    previous_inside = previous[0] >= boundary if keep_greater else previous[0] <= boundary
    for current in coords:
        current_inside = current[0] >= boundary if keep_greater else current[0] <= boundary
        if current_inside != previous_inside:
            span = current[0] - previous[0]
            if abs(span) > 1e-12:
                fraction = (boundary - previous[0]) / span
                output.append([
                    boundary,
                    previous[1] + (current[1] - previous[1]) * fraction,
                ])
        if current_inside:
            output.append(list(current))
        previous = current
        previous_inside = current_inside
    return output


def _ring_area(coords) -> float:
    if len(coords) < 3:
        return 0.0
    return 0.5 * sum(
        a[0] * b[1] - b[0] * a[1]
        for a, b in zip(coords, coords[1:] + coords[:1])
    )


def _split_ring_antimeridian(ring):
    """Split one narrow unwrapped path ring into dateline-safe polygons."""
    if len(ring) < 4:
        return []
    source = [list(coord) for coord in ring]
    if source[0] == source[-1]:
        source.pop()
    if len(source) < 3:
        return []

    unwrapped = [[_normalize_lon(float(source[0][0])), float(source[0][1])]]
    for coord in source[1:]:
        lon = _normalize_lon(float(coord[0]))
        previous_lon = unwrapped[-1][0]
        while lon - previous_lon > 180.0:
            lon -= 360.0
        while lon - previous_lon < -180.0:
            lon += 360.0
        unwrapped.append([lon, float(coord[1])])

    min_lon = min(coord[0] for coord in unwrapped)
    max_lon = max(coord[0] for coord in unwrapped)
    first_band = math.floor((min_lon + 180.0) / 360.0)
    last_band = math.floor((max_lon + 180.0) / 360.0)
    if first_band == last_band:
        shifted = [[coord[0] - 360.0 * first_band, coord[1]] for coord in unwrapped]
        shifted.append(list(shifted[0]))
        return [shifted]
    pieces = []
    for band in range(first_band, last_band + 1):
        west = -180.0 + 360.0 * band
        east = 180.0 + 360.0 * band
        clipped = _clip_polygon_longitude(unwrapped, west, True)
        clipped = _clip_polygon_longitude(clipped, east, False)
        if len(clipped) < 3 or abs(_ring_area(clipped)) < 1e-9:
            continue
        shifted = [[coord[0] - 360.0 * band, coord[1]] for coord in clipped]
        if shifted[0] != shifted[-1]:
            shifted.append(list(shifted[0]))
        pieces.append(shifted)
    return pieces


def _segment_rings_for_span(left, right, start: int, end: int, points: list[_WherePoint] | None = None):
    rings = []
    for index in range(start, end):
        ring = _ring_for_span(
            left,
            right,
            index,
            index + 1,
            points=points,
            cap_start=index == start,
            cap_end=index + 1 == end,
        )
        if ring is None:
            continue
        rings.extend(_split_ring_antimeridian(ring))
    return rings


def _path_polygons(left, right, points: list[_WherePoint] | None = None):
    if len(left) < 2 or len(right) < 2 or len(left) != len(right):
        return []
    polygons = []
    span_start = None
    count = len(left)

    def close_span(end_index: int) -> None:
        nonlocal span_start
        if span_start is None:
            return
        ring = _ring_for_span(left, right, span_start, end_index, points=points)
        if ring is None and points is not None:
            # A rounded cap can itself cross the polar fill cutoff. Keep the
            # continuous strip with a straight renderer-only edge rather than
            # degrading the whole span into separately outlined capsules.
            ring = _ring_for_span(left, right, span_start, end_index)
        if ring is not None:
            polygons.extend([[piece] for piece in _split_ring_antimeridian(ring)])
        else:
            polygons.extend([[r] for r in _segment_rings_for_span(left, right, span_start, end_index, points=points)])
        span_start = None

    for index in range(count):
        safe = _path_coord_is_renderable(left[index]) and _path_coord_is_renderable(right[index])
        if safe:
            if span_start is None:
                span_start = index
        else:
            close_span(index - 1)
    close_span(count - 1)
    return polygons


def _polar_path_polygons(left, right):
    """Return small true-coordinate strip pieces omitted from Mercator fill.

    The normal path polygons deliberately stop before the Web Mercator ceiling
    so MapLibre cannot turn a polar/antimeridian crossing into a world-sized
    fill.  These segment quads are retained in the payload for the globe's
    polar canvas only; they are never handed to MapLibre's GeoJSON renderer.
    """
    if len(left) < 2 or len(right) < 2 or len(left) != len(right):
        return []
    polygons = []
    for index in range(len(left) - 1):
        segment = (left[index], left[index + 1], right[index + 1], right[index])
        if not any(abs(float(coord[1])) > POLAR_FILL_LAT_LIMIT for coord in segment):
            continue
        ring = [list(coord) for coord in segment]
        ring.append(list(ring[0]))
        polygons.append([ring])
    return polygons


def _path_polygon(left, right):
    polygons = _path_polygons(left, right)
    if len(polygons) == 1 and polygons[0]:
        return polygons[0][0]
    return None


def _feature(kind: str, geometry_type: str, coordinates, properties=None):
    props = dict(properties or {})
    props["kind"] = kind
    return {
        "type": "Feature",
        "geometry": {
            "type": geometry_type,
            "coordinates": coordinates,
        },
        "properties": props,
    }


def build_solar_eclipse_path_geojson(event_or_jdut, retflag=None, sample_seconds=DEFAULT_SAMPLE_SECONDS):
    """Return a GeoJSON FeatureCollection for a central solar eclipse path.

    ``event_or_jdut`` can be an ``eclipses.EclipseEvent`` or a Julian Day UT.
    Partial eclipses intentionally raise ``EclipsePathError`` because Swiss
    Ephemeris has no central umbra/antumbra path to draw for them.
    """
    if hasattr(event_or_jdut, "jdut"):
        jdut = float(getattr(event_or_jdut, "jdut"))
        if retflag is None:
            retflag = getattr(event_or_jdut, "retflag", 0)
        if not bool(getattr(event_or_jdut, "is_solar", False)):
            raise EclipsePathError("Only solar eclipses have terrestrial shadow paths.")
    else:
        jdut = float(event_or_jdut)
    event_retflag, tret = _find_event_near(jdut)
    retflag = _flag_int(retflag) or int(event_retflag)
    if not (retflag & MAJOR_SOLAR_FLAGS):
        raise EclipsePathError("Only total, annular, and hybrid solar eclipses have central paths.")

    jdut_max = float(tret[0]) if tret and _is_finite_number(tret[0]) else jdut
    start, end = _event_interval(tret, jdut_max)
    points = _sample_where_points(start, end, jdut_max, int(sample_seconds))
    if len(points) < 2:
        raise EclipsePathError("Swiss Ephemeris did not return enough central-line points.")

    center_coords = _line_coords(points)
    left, right = _limit_coords(points)
    polygons = _path_polygons(left, right, points=points)
    polar_polygons = _polar_path_polygons(left, right)
    kind = _solar_kind(retflag)
    base_props = {
        "event_type": kind,
        "label": "%s solar eclipse path" % kind.title(),
        "jd_ut": jdut_max,
        "utc": _utc_label(jdut_max),
        "source": "Swiss Ephemeris smooth-limb solar eclipse routines",
        "sample_seconds": int(sample_seconds),
        "width_source": "swe_sol_eclipse_where attr[3] core-shadow diameter",
        "precision_note": "Smooth-limb umbra/antumbra path; lunar limb/topographic corrections are not applied.",
    }

    features = []
    if polygons:
        features.append(_feature(
            "ECLIPSE_PATH",
            "Polygon" if len(polygons) == 1 else "MultiPolygon",
            polygons[0] if len(polygons) == 1 else polygons,
            dict(base_props, display="core-shadow", segment_count=len(polygons)),
        ))
    else:
        features.append(_feature(
            "ECLIPSE_SHADOW",
            "MultiLineString",
            _split_antimeridian(center_coords),
            dict(base_props, display="soft-ribbon"),
        ))
    if polar_polygons:
        features.append(_feature(
            "ECLIPSE_POLAR_PATH",
            "MultiPolygon",
            polar_polygons,
            dict(
                base_props,
                display="polar-core-shadow",
                polar_fill_lat_limit=POLAR_FILL_LAT_LIMIT,
                segment_count=len(polar_polygons),
            ),
        ))
    features.append(_feature(
        "ECLIPSE_CENTER",
        "MultiLineString",
        _split_antimeridian(center_coords),
        base_props,
    ))
    features.append(_feature(
        "ECLIPSE_LIMIT",
        "MultiLineString",
        _split_antimeridian(left),
        dict(base_props, side="left"),
    ))
    features.append(_feature(
        "ECLIPSE_LIMIT",
        "MultiLineString",
        _split_antimeridian(right),
        dict(base_props, side="right"),
    ))

    max_point = min(points, key=lambda point: abs(point.jdut - jdut_max))
    features.append(_feature(
        "ECLIPSE_MAX",
        "Point",
        [max_point.lon, max_point.lat],
        dict(
            base_props,
            label="%s maximum eclipse" % kind.title(),
            magnitude=max_point.magnitude,
            obscuration=max_point.obscuration,
            width_km=max_point.width_km,
        ),
    ))

    return {
        "type": "FeatureCollection",
        "features": features,
        "properties": base_props,
    }
