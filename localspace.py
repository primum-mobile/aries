# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Local Space astrology line math.

Pure computation - no GUI, no wx.  A Local Space line is the geodetic ray
starting at the chart place in the planet's horizontal azimuth at the chart
instant.  Swiss Ephemeris supplies the horizontal coordinates; map geometry is
sampled along a WGS84 geodesic when GeographicLib is installed, with a spherical
fallback kept for source/test runs that have not installed the daemon deps yet.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import asin, atan2, cos, degrees, pi, radians, sin
from typing import Iterable

import astrology
import astrocart

try:  # daemon requirement; optional so root-level tests still run in source envs
    from geographiclib.geodesic import Geodesic
except Exception:  # pragma: no cover - exercised when the dependency is absent
    Geodesic = None


KIND_LOCAL_SPACE = "LOCAL_SPACE"

EARTH_MEAN_RADIUS_METERS = 6_371_008.8
"""IUGG mean Earth radius, used only by the spherical fallback."""

LOCAL_SPACE_MAX_DISTANCE_METERS = 20_000_000.0
"""Global Local Space ray length, just short of the antipodal singularity."""

LOCAL_SPACE_STEP_METERS = 200_000.0
"""Precise render sampling distance along each geodesic."""


@dataclass(frozen=True)
class LocalSpaceLine:
    point_id: str
    azimuth_swe_deg: float
    bearing_deg: float
    altitude_true_deg: float
    altitude_apparent_deg: float
    segments: tuple[tuple[tuple[float, float], ...], ...]


@dataclass(frozen=True)
class LocalSpaceResult:
    jd_ut: float
    origin_lon: float
    origin_lat: float
    origin_alt_m: float
    points: tuple[astrocart.ACGPoint, ...] = field(default_factory=tuple)
    lines: tuple[LocalSpaceLine, ...] = field(default_factory=tuple)

    def to_geojson(self) -> dict:
        # Labels are served UI text. Resolve them from the active language at
        # serialization time, matching ACGResult.to_geojson, without feeding
        # localized strings back into any Local Space calculation.
        import mtexts
        label_by_id = {
            p.id: mtexts.txts.get(p.label, p.label) for p in self.points
        }
        color_by_id = {p.id: p.color_hex for p in self.points}
        features = []
        for line in self.lines:
            props = {
                "point": line.point_id,
                "label": label_by_id.get(line.point_id, line.point_id),
                "kind": KIND_LOCAL_SPACE,
                "bearing": line.bearing_deg,
                "bearing_label": _format_bearing(line.bearing_deg),
                "azimuth_swe": line.azimuth_swe_deg,
                "altitude": line.altitude_true_deg,
                "altitude_apparent": line.altitude_apparent_deg,
            }
            color = color_by_id.get(line.point_id)
            if color:
                props["color"] = color
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "MultiLineString",
                    "coordinates": [list(map(list, seg)) for seg in line.segments],
                },
                "properties": props,
            })
        return {"type": "FeatureCollection", "features": features}


def swiss_azimuth_to_bearing(azimuth_swe_deg: float) -> float:
    """Swiss azimuth (south-through-west) -> map bearing (north-through-east)."""
    return (float(azimuth_swe_deg) + 180.0) % 360.0


def compute_local_space(
    jd_ut: float,
    origin_lon: float,
    origin_lat: float,
    origin_alt_m: float,
    points: Iterable = astrocart.DEFAULT_POINTS,
    iflag: int = astrology.SEFLG_SWIEPH,
    max_distance_m: float = LOCAL_SPACE_MAX_DISTANCE_METERS,
    step_m: float = LOCAL_SPACE_STEP_METERS,
    atpress: float = 0.0,
    attemp: float = 10.0,
) -> LocalSpaceResult:
    if step_m <= 0:
        raise ValueError("step_m must be positive")
    if max_distance_m <= 0:
        raise ValueError("max_distance_m must be positive")

    origin_lon = float(origin_lon)
    origin_lat = float(origin_lat)
    origin_alt_m = float(origin_alt_m)
    resolved_points = tuple(_coerce_point(p) for p in points)
    lines: list[LocalSpaceLine] = []

    for pt in resolved_points:
        try:
            ra, dec = _resolve_local_equatorial(
                pt,
                jd_ut,
                origin_lon,
                origin_lat,
                origin_alt_m,
                iflag,
            )
            azimuth_swe, alt_true, alt_app = _horizontal_coordinates(
                jd_ut,
                origin_lon,
                origin_lat,
                origin_alt_m,
                ra,
                dec,
                atpress,
                attemp,
            )
        except Exception:
            continue

        bearing = swiss_azimuth_to_bearing(azimuth_swe)
        samples = _sample_geodesic_ray(
            origin_lon,
            origin_lat,
            bearing,
            max_distance_m=max_distance_m,
            step_m=step_m,
        )
        segments = astrocart._split_antimeridian(samples)
        if not segments:
            continue
        lines.append(LocalSpaceLine(
            point_id=pt.id,
            azimuth_swe_deg=float(azimuth_swe),
            bearing_deg=float(bearing),
            altitude_true_deg=float(alt_true),
            altitude_apparent_deg=float(alt_app),
            segments=segments,
        ))

    return LocalSpaceResult(
        jd_ut=float(jd_ut),
        origin_lon=origin_lon,
        origin_lat=origin_lat,
        origin_alt_m=origin_alt_m,
        points=resolved_points,
        lines=tuple(lines),
    )


def compute_local_space_for_chart(chart, points: Iterable | None = None, **kwargs) -> LocalSpaceResult:
    if points is None:
        points = astrocart.points_from_chart(chart)
    place = chart.place
    return compute_local_space(
        chart.time.jd,
        float(place.lon),
        float(place.lat),
        float(getattr(place, "altitude", 0.0) or 0.0),
        points=points,
        **kwargs,
    )


def _coerce_point(point) -> astrocart.ACGPoint:
    if isinstance(point, astrocart.ACGPoint):
        return point
    if isinstance(point, int):
        return astrocart.ACGPoint(
            id=f"body_{point}",
            label=str(point),
            kind=astrocart.KIND_PLANET,
            body_id=point,
        )
    raise TypeError(f"cannot coerce {point!r} to ACGPoint")


def _resolve_local_equatorial(
    point: astrocart.ACGPoint,
    jd_ut: float,
    origin_lon: float,
    origin_lat: float,
    origin_alt_m: float,
    iflag: int,
) -> tuple[float, float]:
    """Resolve a point for observer-local horizontal conversion.

    Planet bodies use Swiss topocentric equatorial coordinates. Fixed stars and
    synthetic ecliptic points are effectively direction-only in the existing
    Aries chart model, so they use the ordinary ACG resolver.
    """
    if point.body_id is None:
        return astrocart.resolve_equatorial(point, jd_ut, iflag)

    astrology.swe_set_topo(origin_lon, origin_lat, origin_alt_m)
    flag = (iflag & ~astrology.SEFLG_SIDEREAL) | astrology.SEFLG_EQUATORIAL | astrology.SEFLG_TOPOCTR
    _ret, eq, _err = astrology.swe_calc_ut_ex(jd_ut, int(point.body_id), flag)
    ra, dec = float(eq[0]), float(eq[1])
    if point.antipode:
        ra = (ra + 180.0) % 360.0
        dec = -dec
    return ra, dec


def _horizontal_coordinates(
    jd_ut: float,
    origin_lon: float,
    origin_lat: float,
    origin_alt_m: float,
    ra: float,
    dec: float,
    atpress: float,
    attemp: float,
) -> tuple[float, float, float]:
    xaz = astrology.swe_azalt(
        float(jd_ut),
        astrology.SE_EQU2HOR,
        float(origin_lon),
        float(origin_lat),
        float(origin_alt_m),
        float(atpress),
        float(attemp),
        float(ra),
        float(dec),
        1.0,
    )
    return float(xaz[0]) % 360.0, float(xaz[1]), float(xaz[2])


def _sample_geodesic_ray(
    origin_lon: float,
    origin_lat: float,
    bearing_deg: float,
    *,
    max_distance_m: float,
    step_m: float,
) -> list[tuple[float, float]]:
    steps = max(1, int(max_distance_m / step_m))
    distances = [max_distance_m * i / steps for i in range(steps + 1)]
    if Geodesic is not None:
        return [
            _geographiclib_direct(origin_lon, origin_lat, bearing_deg, distance)
            for distance in distances
        ]
    return [
        _spherical_direct(origin_lon, origin_lat, bearing_deg, distance)
        for distance in distances
    ]


def _geographiclib_direct(
    origin_lon: float,
    origin_lat: float,
    bearing_deg: float,
    distance_m: float,
) -> tuple[float, float]:
    res = Geodesic.WGS84.Direct(
        float(origin_lat),
        float(origin_lon),
        float(bearing_deg),
        float(distance_m),
    )
    return astrocart._norm_lon(float(res["lon2"])), float(res["lat2"])


def _spherical_direct(
    origin_lon: float,
    origin_lat: float,
    bearing_deg: float,
    distance_m: float,
) -> tuple[float, float]:
    phi1 = radians(origin_lat)
    lam1 = radians(origin_lon)
    theta = radians(bearing_deg)
    delta = distance_m / EARTH_MEAN_RADIUS_METERS
    sin_phi2 = sin(phi1) * cos(delta) + cos(phi1) * sin(delta) * cos(theta)
    phi2 = asin(max(-1.0, min(1.0, sin_phi2)))
    y = sin(theta) * sin(delta) * cos(phi1)
    x = cos(delta) - sin(phi1) * sin(phi2)
    lam2 = lam1 + atan2(y, x)
    return astrocart._norm_lon(degrees(lam2)), degrees(phi2)


def _format_bearing(bearing_deg: float) -> str:
    return f"{int(round(float(bearing_deg))) % 360}\N{DEGREE SIGN}"
