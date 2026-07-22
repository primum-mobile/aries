# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Project J2000 asterism figures onto the Earth for an ACG instant.

The bundled catalogue supplies constellation figure topology as J2000
equatorial longitude/right ascension and declination.  This module precesses
those vertices to the chart epoch and converts them to substellar geographic
coordinates::

    latitude = declination
    longitude = right ascension - Greenwich sidereal time

The result is view-only GeoJSON.  It does not alter chart or ACG calculation.
"""

from __future__ import annotations

from functools import lru_cache
import json
from math import acos, asin, atan2, ceil, cos, degrees, radians, sin
from pathlib import Path

import astrology


J2000_JD = 2451545.0
# MapLibre joins the supplied vertices as projected chords. Keep the spherical
# sampling fine enough that those chords remain sub-pixel at ACG's maximum
# working zoom, including the tight curvature around the celestial poles.
_MAX_ARC_STEP_DEG = 1.0
_REFERENCE_STEP_DEG = 2.0
_REFERENCE_TICK_HALF_SPAN_DEG = 0.65


@lru_cache(maxsize=4)
def load_catalog(path: str | Path) -> dict:
    """Load and validate one immutable-on-disk asterism GeoJSON catalogue."""
    resource = Path(path)
    with resource.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
        raise ValueError("invalid asterism catalogue")
    return payload


def precess_j2000_equatorial(ra_deg: float, dec_deg: float, jd_ut: float) -> tuple[float, float]:
    """Precess a J2000 mean equatorial coordinate to the chart epoch.

    This is the standard IAU 1976 J2000 precession rotation.  Asterism figures
    are display topology rather than precision astrometry, but precessing them
    prevents the whole figure set drifting against historical chart epochs.
    """
    t = (float(jd_ut) - J2000_JD) / 36525.0
    zeta = radians((2306.2181 * t + 0.30188 * t * t + 0.017998 * t**3) / 3600.0)
    zed = radians((2306.2181 * t + 1.09468 * t * t + 0.018203 * t**3) / 3600.0)
    theta = radians((2004.3109 * t - 0.42665 * t * t - 0.041833 * t**3) / 3600.0)
    ra = radians(float(ra_deg))
    dec = radians(float(dec_deg))
    shifted_ra = ra + zeta
    a = cos(dec) * sin(shifted_ra)
    b = cos(theta) * cos(dec) * cos(shifted_ra) - sin(theta) * sin(dec)
    c = sin(theta) * cos(dec) * cos(shifted_ra) + cos(theta) * sin(dec)
    return (degrees(atan2(a, b) + zed) % 360.0, degrees(asin(max(-1.0, min(1.0, c)))))


def _to_vector(ra_deg: float, dec_deg: float) -> tuple[float, float, float]:
    ra = radians(ra_deg)
    dec = radians(dec_deg)
    return cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec)


def _from_vector(vector: tuple[float, float, float]) -> tuple[float, float]:
    x, y, z = vector
    length = max((x * x + y * y + z * z) ** 0.5, 1e-15)
    x, y, z = x / length, y / length, z / length
    return degrees(atan2(y, x)) % 360.0, degrees(asin(max(-1.0, min(1.0, z))))


def _unit_vector(vector: tuple[float, float, float]) -> tuple[float, float, float]:
    length = max(sum(value * value for value in vector) ** 0.5, 1e-15)
    return tuple(value / length for value in vector)


def _vector_dot(
    left: tuple[float, float, float],
    right: tuple[float, float, float],
) -> float:
    return sum(a * b for a, b in zip(left, right))


def _great_circle(
    start: tuple[float, float],
    end: tuple[float, float],
    *,
    max_step_deg: float = _MAX_ARC_STEP_DEG,
) -> list[tuple[float, float]]:
    """Densify the shortest spherical arc so it stays curved on the globe."""
    a = _to_vector(*start)
    b = _to_vector(*end)
    dot = max(-1.0, min(1.0, sum(x * y for x, y in zip(a, b))))
    omega = acos(dot)
    steps = max(1, int(ceil(degrees(omega) / max(float(max_step_deg), 0.1))))
    if omega < 1e-12:
        return [start, end]
    sin_omega = sin(omega)
    points = []
    for index in range(steps + 1):
        fraction = index / steps
        wa = sin((1.0 - fraction) * omega) / sin_omega
        wb = sin(fraction * omega) / sin_omega
        points.append(_from_vector(tuple(wa * x + wb * y for x, y in zip(a, b))))
    return points


def _normalize_lon(value: float) -> float:
    return ((float(value) + 180.0) % 360.0) - 180.0


def _split_antimeridian(points: list[tuple[float, float]]) -> list[list[list[float]]]:
    """Split a geographic polyline at the map seam without a world-spanning chord."""
    if len(points) < 2:
        return []
    normalized = [(_normalize_lon(lon), float(lat)) for lon, lat in points]
    segments: list[list[tuple[float, float]]] = [[normalized[0]]]
    for previous, current in zip(normalized, normalized[1:]):
        prev_lon, prev_lat = previous
        cur_lon, cur_lat = current
        delta = cur_lon - prev_lon
        if abs(delta) <= 180.0:
            segments[-1].append(current)
            continue
        if delta > 0.0:
            boundary = -180.0
            cur_unwrapped = cur_lon - 360.0
        else:
            boundary = 180.0
            cur_unwrapped = cur_lon + 360.0
        denominator = cur_unwrapped - prev_lon
        ratio = 0.0 if abs(denominator) < 1e-12 else (boundary - prev_lon) / denominator
        ratio = max(0.0, min(1.0, ratio))
        boundary_lat = prev_lat + (cur_lat - prev_lat) * ratio
        segments[-1].append((boundary, boundary_lat))
        opposite = 180.0 if boundary < 0.0 else -180.0
        segments.append([(opposite, boundary_lat), current])
    return [
        [[round(lon, 6), round(lat, 6)] for lon, lat in segment]
        for segment in segments
        if len(segment) >= 2
    ]


def _project_line(
    coordinates: list,
    *,
    jd_ut: float,
    sidereal_deg: float,
) -> list[list[list[float]]]:
    epoch_points = [
        precess_j2000_equatorial(float(point[0]), float(point[1]), jd_ut)
        for point in coordinates
        if isinstance(point, (list, tuple)) and len(point) >= 2
    ]
    if len(epoch_points) < 2:
        return []
    dense: list[tuple[float, float]] = []
    for start, end in zip(epoch_points, epoch_points[1:]):
        arc = _great_circle(start, end)
        if dense:
            arc = arc[1:]
        dense.extend(arc)
    earth_fixed = [(_normalize_lon(ra - sidereal_deg), dec) for ra, dec in dense]
    return _split_antimeridian(earth_fixed)


def _project_star(coordinates: list, *, jd_ut: float, sidereal_deg: float) -> list[float] | None:
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return None
    ra, dec = precess_j2000_equatorial(float(coordinates[0]), float(coordinates[1]), jd_ut)
    return [round(_normalize_lon(ra - sidereal_deg), 6), round(dec, 6)]


def _ecliptic_to_equatorial(
    longitude_deg: float,
    obliquity_deg: float,
    latitude_deg: float = 0.0,
) -> tuple[float, float]:
    """Rotate one tropical ecliptic point onto the equatorial sphere."""
    longitude = radians(float(longitude_deg))
    latitude = radians(float(latitude_deg))
    obliquity = radians(float(obliquity_deg))
    x = cos(latitude) * cos(longitude)
    y = cos(latitude) * sin(longitude) * cos(obliquity) - sin(latitude) * sin(obliquity)
    z = cos(latitude) * sin(longitude) * sin(obliquity) + sin(latitude) * cos(obliquity)
    ra = atan2(y, x)
    dec = asin(max(-1.0, min(1.0, z)))
    return degrees(ra) % 360.0, degrees(dec)


def _sample_closed_curve(project) -> list[list[list[float]]]:
    points = [project(float(degree)) for degree in range(0, 361, int(_REFERENCE_STEP_DEG))]
    return _split_antimeridian(points)


def _sample_ecliptic_longitude_curve(
    longitude_deg: float,
    obliquity_deg: float,
    earth_fixed,
) -> list[list[list[float]]]:
    """Astrolog-style zodiacal longitude semicircle from pole to pole."""
    points = [
        earth_fixed(*_ecliptic_to_equatorial(
            longitude_deg,
            obliquity_deg,
            float(latitude),
        ))
        for latitude in range(-90, 91, int(_REFERENCE_STEP_DEG))
    ]
    return _split_antimeridian(points)


def _house_plane_for_system(house_system_code: str) -> str:
    """Return the system-native sphere plane used by the map house grid.

    Whole Sign and other ecliptic-defined systems retain the ecliptic poles.
    Campanus and Regiomontanus both meet at the North/South points of the local
    horizon, Horizontal uses zenith/nadir, and Meridian/Morinus use the
    celestial-equator poles.
    """
    code = str(house_system_code or "").upper()
    if code in {"X", "M"}:
        return "celestial-equator"
    if code in {"C", "R"}:
        return "prime-vertical"
    if code == "H":
        return "local-horizon"
    return "ecliptic"


def _house_plane_axis(
    *,
    plane: str,
    local_sidereal_deg: float,
    observer_lat: float,
    obliquity_deg: float,
) -> tuple[float, float, float]:
    """Return one convergence pole for a system-native house plane."""
    sidereal = radians(float(local_sidereal_deg))
    latitude = radians(float(observer_lat))
    if plane == "celestial-equator":
        return (0.0, 0.0, 1.0)
    if plane == "prime-vertical":
        # North point on the local horizon; the antipode is South.
        return _unit_vector((
            -sin(latitude) * cos(sidereal),
            -sin(latitude) * sin(sidereal),
            cos(latitude),
        ))
    if plane == "local-horizon":
        # Zenith; the antipode is the nadir.
        return _unit_vector((
            cos(latitude) * cos(sidereal),
            cos(latitude) * sin(sidereal),
            sin(latitude),
        ))
    pole_ra, pole_dec = _ecliptic_to_equatorial(0.0, obliquity_deg, 90.0)
    return _to_vector(pole_ra, pole_dec)


def _plane_tangent_through(
    axis: tuple[float, float, float],
    point: tuple[float, float, float],
) -> tuple[float, float, float]:
    """Direction 90 degrees from ``axis`` in their shared great-circle plane."""
    projection = _vector_dot(axis, point)
    tangent = tuple(value - projection * pole for value, pole in zip(point, axis))
    return _unit_vector(tangent)


def _sample_axis_semicircle(
    *,
    axis: tuple[float, float, float],
    tangent: tuple[float, float, float],
    earth_fixed,
) -> list[list[list[float]]]:
    """Semicircle from one plane pole to its antipode through one cusp."""
    points = []
    for degree in range(0, 181, int(_REFERENCE_STEP_DEG)):
        angle = radians(float(degree))
        vector = tuple(
            -cos(angle) * pole + sin(angle) * across
            for pole, across in zip(axis, tangent)
        )
        points.append(earth_fixed(*_from_vector(vector)))
    return _split_antimeridian(points)


def _pole_label_point(
    *,
    axis: tuple[float, float, float],
    tangent: tuple[float, float, float],
    north: bool,
    earth_fixed,
    inset_deg: float,
) -> list[float]:
    inset = radians(float(inset_deg))
    pole_scale = cos(inset) if north else -cos(inset)
    vector = _unit_vector(tuple(
        pole_scale * pole + sin(inset) * across
        for pole, across in zip(axis, tangent)
    ))
    lon, lat = earth_fixed(*_from_vector(vector))
    return [round(lon, 6), round(lat, 6)]


def _horizon_point(
    observer_lon: float,
    observer_lat: float,
    bearing_deg: float,
) -> tuple[float, float]:
    """Point on the terrestrial great circle 90° from the birthplace.

    Under the substellar projection this is the local celestial horizon, the
    great circle containing the chart's Ascendant and Descendant.
    """
    lon = radians(float(observer_lon))
    lat = radians(float(observer_lat))
    bearing = radians(float(bearing_deg))
    distance = radians(90.0)
    lat2 = asin(max(-1.0, min(1.0,
        sin(lat) * cos(distance) + cos(lat) * sin(distance) * cos(bearing)
    )))
    lon2 = lon + atan2(
        sin(bearing) * sin(distance) * cos(lat),
        cos(distance) - sin(lat) * sin(lat2),
    )
    return _normalize_lon(degrees(lon2)), degrees(lat2)


def _reference_line(kind: str, coordinates: list[list[list[float]]], frame: str) -> dict:
    return {
        "type": "Feature",
        "properties": {"kind": kind, "frame": frame},
        "geometry": {"type": "MultiLineString", "coordinates": coordinates},
    }


def build_reference_features(
    *,
    jd_ut: float,
    observer_lon: float,
    observer_lat: float,
    obliquity_deg: float,
    zodiac_offset_deg: float = 0.0,
    sign_glyphs: tuple[str, ...] | list[str] = (),
    house_cusps: tuple[float, ...] | list[float] = (),
    house_system_code: str = "",
) -> list[dict]:
    """Build celestial reference circles in substellar map coordinates.

    The physical ecliptic and equator use the tropical celestial frame. Zodiac
    glyphs follow the chart's selected zodiac, so sidereal sign centers are
    shifted by the chart's ayanamsha before the equatorial rotation.
    """
    sidereal_deg = float(astrology.swe_sidtime(float(jd_ut))) * 15.0

    def earth_fixed(ra: float, dec: float) -> tuple[float, float]:
        return _normalize_lon(ra - sidereal_deg), dec

    local_sidereal_deg = (sidereal_deg + float(observer_lon)) % 360.0
    ecliptic_pole_ra, ecliptic_pole_dec = _ecliptic_to_equatorial(
        0.0,
        obliquity_deg,
        90.0,
    )
    ecliptic_axis = _to_vector(ecliptic_pole_ra, ecliptic_pole_dec)

    equator = _sample_closed_curve(
        lambda ra: earth_fixed(ra, 0.0)
    )
    ecliptic = _sample_closed_curve(
        lambda longitude: earth_fixed(*_ecliptic_to_equatorial(longitude, obliquity_deg))
    )
    asc_circle = _sample_closed_curve(
        lambda bearing: _horizon_point(observer_lon, observer_lat, bearing)
    )
    mc_lon = _normalize_lon(observer_lon)
    ic_lon = _normalize_lon(observer_lon + 180.0)
    mc_circle = [
        [[round(mc_lon, 6), -90.0], [round(mc_lon, 6), 90.0]],
        [[round(ic_lon, 6), -90.0], [round(ic_lon, 6), 90.0]],
    ]
    features = [
        _reference_line("REFERENCE_ECLIPTIC", ecliptic, "ecliptic"),
        _reference_line("REFERENCE_EQUATOR", equator, "celestial-equator"),
        _reference_line("REFERENCE_ASC", asc_circle, "local-horizon"),
        _reference_line("REFERENCE_MC", mc_circle, "local-meridian"),
    ]

    # Zodiac boundaries are constant ecliptic-longitude semicircles. House
    # boundaries retain the calculated ecliptic cusp as their anchor but use
    # the selected system's native sphere plane and convergence poles.
    for sign in range(12):
        zodiac_longitude = float(sign * 30)
        tropical_longitude = zodiac_longitude + float(zodiac_offset_deg)
        features.append({
            "type": "Feature",
            "properties": {
                "kind": "REFERENCE_ZODIAC_LINE",
                "sign": sign,
                "zodiacLongitude": zodiac_longitude,
                "frame": "zodiacal-longitude",
            },
            "geometry": {
                "type": "MultiLineString",
                "coordinates": _sample_ecliptic_longitude_curve(
                    tropical_longitude,
                    obliquity_deg,
                    earth_fixed,
                ),
            },
        })

        label_longitude = tropical_longitude + 15.0
        label_ra, label_dec = _ecliptic_to_equatorial(
            label_longitude,
            obliquity_deg,
        )
        label_tangent = _plane_tangent_through(
            ecliptic_axis,
            _to_vector(label_ra, label_dec),
        )
        for north in (True, False):
            features.append({
                "type": "Feature",
                "properties": {
                    "kind": "REFERENCE_ZODIAC_POLE_SIGN",
                    "sign": sign,
                    "pole": "north" if north else "south",
                    "frame": "ecliptic-pole-label",
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": _pole_label_point(
                        axis=ecliptic_axis,
                        tangent=label_tangent,
                        north=north,
                        earth_fixed=earth_fixed,
                        inset_deg=7.5,
                    ),
                },
            })

    house_plane = _house_plane_for_system(house_system_code)
    house_axis = _house_plane_axis(
        plane=house_plane,
        local_sidereal_deg=local_sidereal_deg,
        observer_lat=observer_lat,
        obliquity_deg=obliquity_deg,
    )
    house_tangents = []
    for house_index, cusp_longitude in enumerate(house_cusps[:12], start=1):
        selected_zodiac_cusp = float(cusp_longitude)
        tropical_longitude = selected_zodiac_cusp + float(zodiac_offset_deg)
        cusp_ra, cusp_dec = _ecliptic_to_equatorial(
            tropical_longitude,
            obliquity_deg,
        )
        tangent = _plane_tangent_through(
            house_axis,
            _to_vector(cusp_ra, cusp_dec),
        )
        house_tangents.append(tangent)
        features.append({
            "type": "Feature",
            "properties": {
                "kind": "REFERENCE_HOUSE_LINE",
                "house": house_index,
                "cuspLongitude": selected_zodiac_cusp,
                "houseSystem": str(house_system_code or ""),
                "plane": house_plane,
                "angle": house_index in (1, 4, 7, 10),
                "frame": "house-system-great-circle",
            },
            "geometry": {
                "type": "MultiLineString",
                "coordinates": _sample_axis_semicircle(
                    axis=house_axis,
                    tangent=tangent,
                    earth_fixed=earth_fixed,
                ),
            },
        })

    house_names = ("I", "2", "3", "IV", "5", "6", "VII", "8", "9", "X", "11", "12")
    for index, tangent in enumerate(house_tangents):
        next_tangent = house_tangents[(index + 1) % len(house_tangents)]
        midpoint = _unit_vector(tuple(
            left + right for left, right in zip(tangent, next_tangent)
        ))
        house_index = index + 1
        for north in (True, False):
            features.append({
                "type": "Feature",
                "properties": {
                    "kind": "REFERENCE_HOUSE_POLE_LABEL",
                    "house": house_index,
                    "label": house_names[index],
                    "pole": "north" if north else "south",
                    "plane": house_plane,
                    "angle": house_index in (1, 4, 7, 10),
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": _pole_label_point(
                        axis=house_axis,
                        tangent=midpoint,
                        north=north,
                        earth_fixed=earth_fixed,
                        inset_deg=6.0,
                    ),
                },
            })

    for sign, glyph in enumerate(sign_glyphs[:12]):
        boundary_longitude = sign * 30.0 + float(zodiac_offset_deg)
        tick = _split_antimeridian([
            list(earth_fixed(*_ecliptic_to_equatorial(
                boundary_longitude,
                obliquity_deg,
                -_REFERENCE_TICK_HALF_SPAN_DEG,
            ))),
            list(earth_fixed(*_ecliptic_to_equatorial(
                boundary_longitude,
                obliquity_deg,
                _REFERENCE_TICK_HALF_SPAN_DEG,
            ))),
        ])
        features.append({
            "type": "Feature",
            "properties": {
                "kind": "REFERENCE_ZODIAC_TICK",
                "sign": sign,
                "zodiacLongitude": sign * 30.0,
            },
            "geometry": {"type": "MultiLineString", "coordinates": tick},
        })
        zodiac_longitude = sign * 30.0 + 15.0
        tropical_longitude = zodiac_longitude + float(zodiac_offset_deg)
        ra, dec = _ecliptic_to_equatorial(tropical_longitude, obliquity_deg)
        lon, lat = earth_fixed(ra, dec)
        features.append({
            "type": "Feature",
            "properties": {
                "kind": "REFERENCE_ZODIAC_SIGN",
                "sign": sign,
                "glyph": str(glyph),
            },
            "geometry": {
                "type": "Point",
                "coordinates": [round(lon, 6), round(lat, 6)],
            },
        })
    return features


def _star_display_name(properties: dict) -> str:
    """Return the bundled star label, with a stable catalogue fallback."""
    for key in ("name", "designation", "hip"):
        value = str(properties.get(key) or "").strip()
        if value:
            return value
    star_id = str(properties.get("id") or "").strip()
    return f"HIP {star_id}" if star_id else ""


def _label_anchor(lines: list) -> tuple[float, float] | None:
    """Return one seam-safe spherical center for a constellation figure."""
    vectors = []
    seen = set()
    for line in lines:
        if not isinstance(line, list):
            continue
        for point in line:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            ra = float(point[0])
            dec = float(point[1])
            # The vendored topology uses ±180° splice vertices at the seam;
            # those are line mechanics, not stars or meaningful label weight.
            if abs(abs(ra) - 180.0) < 1e-8:
                continue
            key = (round(ra, 7), round(dec, 7))
            if key in seen:
                continue
            seen.add(key)
            vectors.append(_to_vector(ra, dec))
    if not vectors:
        return None
    return _from_vector(tuple(sum(vector[index] for vector in vectors) for index in range(3)))


def build_geojson(
    catalog: dict,
    jd_ut: float,
    star_catalog: dict | None = None,
    *,
    observer_lon: float | None = None,
    observer_lat: float | None = None,
    obliquity_deg: float | None = None,
    zodiac_offset_deg: float = 0.0,
    sign_glyphs: tuple[str, ...] | list[str] = (),
    house_cusps: tuple[float, ...] | list[float] = (),
    house_system_code: str = "",
) -> dict:
    """Return date-correct substellar asterism figures and their stars."""
    jd = float(jd_ut)
    sidereal_deg = float(astrology.swe_sidtime(jd)) * 15.0
    features = []
    label_features = []
    for source in catalog.get("features", []):
        if not isinstance(source, dict):
            continue
        geometry = source.get("geometry") or {}
        if geometry.get("type") != "MultiLineString":
            continue
        projected_lines: list[list[list[float]]] = []
        source_lines = geometry.get("coordinates") or []
        for line in source_lines:
            if isinstance(line, list):
                projected_lines.extend(_project_line(line, jd_ut=jd, sidereal_deg=sidereal_deg))
        if not projected_lines:
            continue
        source_props = source.get("properties") or {}
        figure_id = str(source_props.get("id") or "")
        figure_name = str(source_props.get("name") or "").strip()
        rank = int(source_props.get("rank") or 0)
        features.append({
            "type": "Feature",
            "properties": {
                "kind": "ASTERISM",
                "id": figure_id,
                "rank": rank,
            },
            "geometry": {
                "type": "MultiLineString",
                "coordinates": projected_lines,
            },
        })
        anchor = _label_anchor(source_lines)
        if figure_name and anchor is not None:
            projected_anchor = _project_star(
                list(anchor),
                jd_ut=jd,
                sidereal_deg=sidereal_deg,
            )
            if projected_anchor is not None:
                label_features.append({
                    "type": "Feature",
                    "properties": {
                        "kind": "ASTERISM_LABEL",
                        "id": figure_id,
                        "name": figure_name,
                        "rank": rank,
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": projected_anchor,
                    },
                })
    figure_count = len(features)
    features.extend(label_features)
    label_count = len(label_features)
    for source in (star_catalog or {}).get("features", []):
        if not isinstance(source, dict):
            continue
        geometry = source.get("geometry") or {}
        if geometry.get("type") != "Point":
            continue
        projected = _project_star(
            geometry.get("coordinates") or [],
            jd_ut=jd,
            sidereal_deg=sidereal_deg,
        )
        if projected is None:
            continue
        source_props = source.get("properties") or {}
        star_id = str(source_props.get("id") or "")
        try:
            magnitude = float(source_props.get("mag"))
        except (TypeError, ValueError):
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "kind": "ASTERISM_STAR",
                "id": star_id,
                "name": _star_display_name(source_props),
                "magnitude": round(magnitude, 2),
            },
            "geometry": {
                "type": "Point",
                "coordinates": projected,
            },
        })
    star_count = len(features) - figure_count - label_count
    reference_count = 0
    if observer_lon is not None and observer_lat is not None and obliquity_deg is not None:
        reference_features = build_reference_features(
            jd_ut=jd,
            observer_lon=float(observer_lon),
            observer_lat=float(observer_lat),
            obliquity_deg=float(obliquity_deg),
            zodiac_offset_deg=float(zodiac_offset_deg),
            sign_glyphs=sign_glyphs,
            house_cusps=house_cusps,
            house_system_code=house_system_code,
        )
        features.extend(reference_features)
        reference_count = len(reference_features)
    return {
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "projection": "substellar",
            "sourceEpoch": "J2000",
            "jdUt": jd,
            "featureCount": len(features),
            "figureCount": figure_count,
            "labelCount": label_count,
            "starCount": star_count,
            "referenceCount": reference_count,
            "housePlane": _house_plane_for_system(house_system_code),
        },
    }
