# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Astrocartography line math.

Pure computation — no GUI, no wx. Given a Julian Day (UT) and a list of
points, emits MC / IC / ASC / DSC loci as geographic polylines in degrees
(lon east-positive, WGS84-compatible).

A *point* is anything with a right ascension and declination at the chart's
instant: an ephemeris body, a fixed star, a lot / Arabic part, a midpoint,
an antiscion, or a freeform ecliptic coordinate. See ``ACGPoint``.

Math — Jim Lewis in-mundo convention (body itself on angle, not ecliptic):

    α : right ascension (deg)
    δ : declination (deg)
    θ₀: Greenwich sidereal time (deg) = swe_sidtime(jd_ut) * 15
    H : hour angle (deg),  H = LST − α
    φ : geographic latitude

Meridian loci (independent of φ):
    λ_MC = α − θ₀
    λ_IC = α − θ₀ + 180°

Horizon loci (altitude = 0 → cos H = −tan φ · tan δ):
    λ_ASC(φ) = α − θ₀ − H(φ)          (east of meridian, body rising)
    λ_DSC(φ) = α − θ₀ + H(φ)          (west of meridian, body setting)

Valid only where |tan φ · tan δ| ≤ 1; outside that band the body is
circumpolar at φ and no curve is emitted.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import acos, atan2, cos, degrees, isfinite, radians, sin, tan
from typing import Callable, Iterable

import astrology
import houses
import util

GEOGRAPHIC_LAT_LIMIT = 89.999
"""Practical GeoJSON latitude cap.

The map renderer cannot represent the mathematical pole exactly, but ACG
meridian lines are geographically pole-to-pole. Keeping the data just shy of
90° prevents the visible polar-cap gaps that appear with a Mercator-style
±85° clamp, especially in globe projection.
"""

EARTH_EQUATOR_METERS_PER_DEGREE = 111_319.49079327358
"""WGS84 equatorial meters per degree, used for curve-emission tolerances."""

HORIZON_CHORD_ERROR_METERS = 10.0
"""Maximum ground error allowed between analytic horizon curve and emitted chord."""

PARAN_SCAN_STEP_DEG = 0.1
"""Maximum latitude interval used to bracket horizon-horizon paran roots."""

PARAN_ROOT_TOL_DEG = 1e-8
"""Latitude bisection tolerance for paran roots, roughly millimeter scale."""


# ---------------------------------------------------------------------------
# Point model

KIND_PLANET = "planet"
KIND_NODE = "node"
KIND_STAR = "star"
KIND_LOT = "lot"
KIND_MIDPOINT = "midpoint"
KIND_ANTISCION = "antiscion"
KIND_CUSTOM = "custom"


@dataclass(frozen=True)
class ACGPoint:
    """A resolvable point on the celestial sphere.

    One ecliptic resolution source must be set when zodiacal or geodetic
    geometry is requested:
        * body_id        — Swiss Ephemeris integer (``astrology.SE_SUN`` etc.)
        * star_name      — fixed star catalog name (passed to ``swe_fixstar_ut``)
        * ecliptic       — (lon, lat) in degrees — for lots, midpoints, antiscia

    ``equatorial`` is an optional canonical (RA, declination) pair. It may
    coexist with ``ecliptic`` for a derived/moving point whose supplementary
    chart already owns both representations; in-mundo lines and physical
    zenith/paran overlays must use that pair without reprojecting ecliptic
    coordinates.

    If ``antipode`` is true, the resolved (α, δ) is flipped through the origin
    — used for descending nodes and opposition points.
    """

    id: str
    label: str
    kind: str = KIND_CUSTOM
    body_id: int | None = None
    star_name: str | None = None
    ecliptic: tuple[float, float] | None = None
    antipode: bool = False
    color_hex: str | None = None  # optional display hint; renderer may ignore
    # Appended for positional compatibility with the original point contract.
    equatorial: tuple[float, float] | None = None


# Swiss Ephemeris default: 10 planets + Chiron + both lunar nodes.
# Descending node is modelled as the antipode of the true ascending node.
DEFAULT_POINTS: tuple[ACGPoint, ...] = (
    ACGPoint("sun", "Sun", KIND_PLANET, body_id=astrology.SE_SUN),
    ACGPoint("moon", "Moon", KIND_PLANET, body_id=astrology.SE_MOON),
    ACGPoint("mercury", "Mercury", KIND_PLANET, body_id=astrology.SE_MERCURY),
    ACGPoint("venus", "Venus", KIND_PLANET, body_id=astrology.SE_VENUS),
    ACGPoint("mars", "Mars", KIND_PLANET, body_id=astrology.SE_MARS),
    ACGPoint("jupiter", "Jupiter", KIND_PLANET, body_id=astrology.SE_JUPITER),
    ACGPoint("saturn", "Saturn", KIND_PLANET, body_id=astrology.SE_SATURN),
    ACGPoint("uranus", "Uranus", KIND_PLANET, body_id=astrology.SE_URANUS),
    ACGPoint("neptune", "Neptune", KIND_PLANET, body_id=astrology.SE_NEPTUNE),
    ACGPoint("pluto", "Pluto", KIND_PLANET, body_id=astrology.SE_PLUTO),
    ACGPoint("chiron", "Chiron", KIND_PLANET, body_id=astrology.SE_CHIRON),
    ACGPoint("node_asc", "N. Node", KIND_NODE, body_id=astrology.SE_TRUE_NODE),
    ACGPoint("node_desc", "S. Node", KIND_NODE,
             body_id=astrology.SE_TRUE_NODE, antipode=True),
)


# ---------------------------------------------------------------------------
# Line model

LINE_MC = "MC"
LINE_IC = "IC"
LINE_ASC = "ASC"
LINE_DSC = "DSC"
ALL_KINDS = (LINE_MC, LINE_IC, LINE_ASC, LINE_DSC)

NATAL_ASC_POINT_ID = "natal_asc"
# Synthetic celestial point for the chart's own rising ecliptic degree.

LINE_SYSTEM_IN_MUNDO = "in_mundo"
LINE_SYSTEM_ZODIACAL = "zodiacal"
LINE_SYSTEM_GEODETIC_GREENWICH = "geodetic_greenwich"
LINE_SYSTEM_GEODETIC_GIZA = "geodetic_giza"
LINE_SYSTEM_GEODETIC_CUSTOM = "geodetic_custom"

MARKER_ZENITH = "ZENITH"
LINE_ASPECT = "ASPECT"

ASPECT_BRANCH_PLUS = "plus"
ASPECT_BRANCH_MINUS = "minus"
ASPECT_BRANCH_SINGLE = "single"
ASPECT_BRANCHES = (
    ASPECT_BRANCH_PLUS,
    ASPECT_BRANCH_MINUS,
    ASPECT_BRANCH_SINGLE,
)

ASPECT_LINE_LABEL_KEY = "astrocart.aspectLineLabel"

GEODETIC_GREENWICH_MERIDIAN_LON = 0.0
# Great Pyramid of Giza meridian, east-positive decimal degrees.
GEODETIC_GIZA_MERIDIAN_LON = 31.134094


@dataclass(frozen=True)
class ACGLine:
    point_id: str
    kind: str
    segments: tuple[tuple[tuple[float, float], ...], ...]


@dataclass(frozen=True)
class ACGAspectSpec:
    """A stable, selectable ecliptic-aspect definition.

    ``aspect_id`` and ``name`` are stable machine-readable identifiers.
    ``label_key`` is resolved at the service/UI boundary, while ``angle_deg``
    is normalized to an undirected separation in the 0°..180° range before
    any geometry is produced.
    """

    aspect_id: str
    name: str
    label_key: str
    angle_deg: float


@dataclass(frozen=True)
class ACGAspectLine:
    """One branch of a source point's aspect locus to a selected angle.

    These are deliberately separate from ``ACGLine``: an aspect-to-angle
    locus is not the source point itself on MC/IC/ASC/DSC and therefore must
    not participate in zenith-marker or paran computation.
    """

    point_id: str
    target_angle: str
    aspect_id: str
    aspect_name: str
    aspect_key: str
    aspect_angle: float
    branch: str
    branch_sign: int
    segments: tuple[tuple[tuple[float, float], ...], ...]


# Aries' complete ecliptic-aspect block, matching ``chart.Chart.Aspects``.
# This registry is calculation data only; it does not read mutable chart or UI
# option state. Callers opt into any subset explicitly.
ECLIPTIC_ASPECT_SPECS: tuple[ACGAspectSpec, ...] = (
    ACGAspectSpec("conjunction", "conjunction", "Conjunctio", 0.0),
    ACGAspectSpec("semisextile", "semisextile", "Semisextil", 30.0),
    ACGAspectSpec("semisquare", "semisquare", "Semiquadrat", 45.0),
    ACGAspectSpec("sextile", "sextile", "Sextil", 60.0),
    ACGAspectSpec("quintile", "quintile", "Quintile", 72.0),
    ACGAspectSpec("square", "square", "Quadrat", 90.0),
    ACGAspectSpec("trine", "trine", "Trigon", 120.0),
    ACGAspectSpec("sesquisquare", "sesquisquare", "Sesquiquadrat", 135.0),
    ACGAspectSpec("biquintile", "biquintile", "Biquintile", 144.0),
    ACGAspectSpec("quincunx", "quincunx", "Quinqunx", 150.0),
    ACGAspectSpec("opposition", "opposition", "Oppositio", 180.0),
    ACGAspectSpec("septile", "septile", "Septile", 360.0 / 7.0),
)

ASPECT_SPEC_BY_ID: dict[str, ACGAspectSpec] = {
    spec.aspect_id: spec for spec in ECLIPTIC_ASPECT_SPECS
}


@dataclass(frozen=True)
class ACGParan:
    """A latitude where two bodies simultaneously touch their angles.

    Renders as a horizontal line across the map at ``latitude`` degrees.
    """
    point_a_id: str
    angle_a: str           # 'MC', 'IC', 'ASC', 'DSC'
    point_b_id: str
    angle_b: str
    latitude: float


@dataclass(frozen=True)
class ACGMarker:
    """A point-like geographic annotation derived from a celestial point."""

    point_id: str
    kind: str
    longitude: float
    latitude: float


@dataclass(frozen=True)
class ACGResult:
    jd_ut: float
    theta0_deg: float
    equatorial: dict[str, tuple[float, float]]  # point.id -> (ra_deg, dec_deg)
    lines: tuple[ACGLine, ...]
    lat_range: tuple[float, float]
    points: tuple[ACGPoint, ...] = field(default_factory=tuple)
    # Keep ``parans`` immediately after ``points``: callers historically used
    # the first seven fields positionally before aspect/marker systems existed.
    parans: tuple[ACGParan, ...] = field(default_factory=tuple)
    aspect_lines: tuple[ACGAspectLine, ...] = field(default_factory=tuple)
    markers: tuple[ACGMarker, ...] = field(default_factory=tuple)
    line_system: str = LINE_SYSTEM_IN_MUNDO
    # Parans always mean simultaneous physical angularity. They do not change
    # coordinate systems when the displayed longitude lines are zodiacal.
    paran_system: str = LINE_SYSTEM_IN_MUNDO

    def lines_for(self, point_id: str) -> tuple[ACGLine, ...]:
        return tuple(l for l in self.lines if l.point_id == point_id)

    def aspect_lines_for(self, point_id: str) -> tuple[ACGAspectLine, ...]:
        return tuple(l for l in self.aspect_lines if l.point_id == point_id)

    def to_geojson(self) -> dict:
        # Serve boundary: point labels ("N. Node", "S. Node", planet names)
        # are rendered as the map text-field / legend, so localize them here
        # rather than at the import-time DEFAULT_POINTS constant.
        import mtexts
        features = []
        label_by_id = {
            p.id: mtexts.txts.get(p.label, p.label) for p in self.points
        }
        color_by_id = {p.id: p.color_hex for p in self.points}
        for line in self.lines:
            props = {
                "point": line.point_id,
                "label": label_by_id.get(line.point_id, line.point_id),
                "kind": line.kind,
                "line_system": self.line_system,
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
        for line in self.aspect_lines:
            point_label = label_by_id.get(line.point_id, line.point_id)
            props = {
                "point": line.point_id,
                "label": point_label,
                "kind": LINE_ASPECT,
                "target_angle": line.target_angle,
                "aspect_id": line.aspect_id,
                "aspect_name": line.aspect_name,
                "aspect_key": line.aspect_key,
                "aspect_angle": line.aspect_angle,
                "branch": line.branch,
                "branch_sign": line.branch_sign,
                "line_system": self.line_system,
                # Keep phrase construction at the service/UI boundary so
                # languages can control word order. No served English
                # sentence is baked into this calculation result.
                "label_key": ASPECT_LINE_LABEL_KEY,
                "label_args": {
                    "point": line.point_id,
                    "point_label": point_label,
                    "aspect_id": line.aspect_id,
                    "aspect_key": line.aspect_key,
                    "target_angle": line.target_angle,
                },
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
        for marker in self.markers:
            props = {
                "point": marker.point_id,
                "label": label_by_id.get(marker.point_id, marker.point_id),
                "kind": marker.kind,
                # Zeniths are physical substellar points even while the
                # selectable line layer is rendered zodiacally.
                "line_system": LINE_SYSTEM_IN_MUNDO,
                "display_line_system": self.line_system,
                "method": "substellar",
            }
            color = color_by_id.get(marker.point_id)
            if color:
                props["color"] = color
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [marker.longitude, marker.latitude],
                },
                "properties": props,
            })
        for p in self.parans:
            a_label = label_by_id.get(p.point_a_id, p.point_a_id)
            b_label = label_by_id.get(p.point_b_id, p.point_b_id)
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-180.0, p.latitude], [180.0, p.latitude]],
                },
                "properties": {
                    "kind": "PARAN",
                    "a_point": p.point_a_id,
                    "a_angle": p.angle_a,
                    "b_point": p.point_b_id,
                    "b_angle": p.angle_b,
                    "label": f"{a_label} {p.angle_a} × {b_label} {p.angle_b}",
                    "line_system": self.paran_system,
                    "display_line_system": self.line_system,
                },
            })
        return {
            "type": "FeatureCollection",
            "features": features,
            "metadata": {
                "line_system": self.line_system,
                "paran_system": self.paran_system,
            },
        }


# ---------------------------------------------------------------------------
# Coordinate helpers

def _norm_lon(x: float) -> float:
    return ((x + 180.0) % 360.0) - 180.0


def _unwrap_near(lon: float, reference: float) -> float:
    """Return an equivalent longitude nearest to ``reference``."""
    return lon + 360.0 * round((reference - lon) / 360.0)


def _split_antimeridian(points: list[tuple[float, float]]) -> tuple[tuple[tuple[float, float], ...], ...]:
    if not points:
        return ()
    normalized = [(_norm_lon(lon), float(lat)) for lon, lat in points]
    segs: list[list[tuple[float, float]]] = [[normalized[0]]]
    for prev, cur in zip(normalized, normalized[1:]):
        prev_lon, prev_lat = prev
        cur_lon, cur_lat = cur
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
            boundary_lat = prev_lat + (cur_lat - prev_lat) * ratio
            segs[-1].append((boundary, boundary_lat))
            opposite = 180.0 if boundary < 0.0 else -180.0
            segs.append([(opposite, boundary_lat), cur])
        else:
            segs[-1].append(cur)
    return tuple(tuple(s) for s in segs if len(s) >= 2)


def _meridian_segments(lon: float, lat_min: float, lat_max: float) -> tuple[tuple[tuple[float, float], ...], ...]:
    lon = _norm_lon(lon)
    return (((lon, lat_min), (lon, lat_max)),)


def _lon_error_meters(exact_lon: float, linear_lon: float, lat_deg: float) -> float:
    """Ground-distance error for a longitude miss at a given geographic latitude."""
    exact_lon = _unwrap_near(exact_lon, linear_lon)
    return (
        abs(exact_lon - linear_lon)
        * EARTH_EQUATOR_METERS_PER_DEGREE
        * max(0.0, cos(radians(lat_deg)))
    )


def _adaptive_latitude_curve(
    lat0: float,
    lon0: float,
    lat1: float,
    lon1: float,
    lon_at,
    *,
    max_lat_step: float,
    max_error_meters: float = HORIZON_CHORD_ERROR_METERS,
    max_depth: int = 45,
) -> list[tuple[float, float]]:
    """Sample an analytic longitude(latitude) curve to a meter error bound.

    Midpoint-only subdivision misses symmetric S-curves, so we test one-third,
    midpoint, and two-third positions before accepting a chord.
    """
    if lat0 >= lat1:
        return []
    max_lat_step = max(float(max_lat_step), 1e-9)
    max_error_meters = max(float(max_error_meters), 0.0)
    out: list[tuple[float, float]] = []
    lon1 = _unwrap_near(lon1, lon0)

    def _exact(lat: float, reference_lon: float) -> float:
        return _unwrap_near(float(lon_at(lat)), reference_lon)

    def _probe(lat: float, a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> tuple[float, float]:
        t = (lat - a_lat) / (b_lat - a_lat)
        linear_lon = a_lon + (b_lon - a_lon) * t
        exact_lon = _exact(lat, linear_lon)
        return _lon_error_meters(exact_lon, linear_lon, lat), exact_lon

    def _walk(a_lat: float, a_lon: float, b_lat: float, b_lon: float, depth: int) -> None:
        span = b_lat - a_lat
        mid_lat = 0.5 * (a_lat + b_lat)
        q1_lat = a_lat + span / 3.0
        q2_lat = a_lat + 2.0 * span / 3.0
        q1_err, _q1_lon = _probe(q1_lat, a_lat, a_lon, b_lat, b_lon)
        mid_err, mid_lon = _probe(mid_lat, a_lat, a_lon, b_lat, b_lon)
        q2_err, _q2_lon = _probe(q2_lat, a_lat, a_lon, b_lat, b_lon)
        err = max(q1_err, mid_err, q2_err)
        if (
            (err <= max_error_meters and span <= max_lat_step)
            or depth >= max_depth
            or span < 1e-14
        ):
            out.append((_norm_lon(a_lon), a_lat))
            return
        _walk(a_lat, a_lon, mid_lat, mid_lon, depth + 1)
        _walk(mid_lat, mid_lon, b_lat, b_lon, depth + 1)

    _walk(lat0, lon0, lat1, lon1, 0)
    out.append((_norm_lon(lon1), lat1))
    return out


def _mean_obliquity_deg(jd_ut: float) -> float:
    """IAU 1980 mean obliquity. Accurate to sub-arcsecond for centuries around J2000."""
    T = (jd_ut - 2451545.0) / 36525.0
    eps_arcsec = 84381.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T
    return eps_arcsec / 3600.0


def _true_obliquity_deg(jd_ut: float) -> float:
    """Prefer Swiss Ephemeris' true obliquity (with nutation); fall back to mean."""
    try:
        _ret, xx, _err = astrology.swe_calc_ut_ex(jd_ut, astrology.SE_ECL_NUT, 0)
        eps = float(xx[0])
        if 20.0 < eps < 30.0:
            return eps
    except Exception:
        pass
    return _mean_obliquity_deg(jd_ut)


def _ecl_to_equ(lon_deg: float, lat_deg: float, eps_deg: float) -> tuple[float, float]:
    """Rotate ecliptic (λ, β) → equatorial (α, δ). All inputs/outputs in degrees."""
    lam = radians(lon_deg)
    bet = radians(lat_deg)
    eps = radians(eps_deg)
    sin_delta = sin(bet) * cos(eps) + cos(bet) * sin(eps) * sin(lam)
    delta = degrees(_safe_asin(sin_delta))
    y = sin(lam) * cos(eps) - tan(bet) * sin(eps)
    x = cos(lam)
    alpha = degrees(atan2(y, x)) % 360.0
    return alpha, delta


def _ra_to_ecl_lon(ra_deg: float, eps_deg: float) -> float:
    """Longitude of the ecliptic point whose right ascension is ``ra_deg``."""
    ra = radians(ra_deg)
    eps = radians(eps_deg)
    return degrees(atan2(sin(ra) / cos(eps), cos(ra))) % 360.0


def _safe_asin(x: float) -> float:
    from math import asin
    if x > 1.0:
        return radians(90.0)
    if x < -1.0:
        return radians(-90.0)
    return asin(x)


def _gst_deg(jd_ut: float) -> float:
    return float(astrology.swe_sidtime(jd_ut)) * 15.0


def _normalize_aspect_angle(value: float) -> float:
    """Return an undirected aspect separation in the closed 0°..180° range."""
    if isinstance(value, bool):
        raise ValueError("aspect angle must be a finite number")
    try:
        angle = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("aspect angle must be a finite number") from exc
    if not isfinite(angle):
        raise ValueError("aspect angle must be a finite number")
    angle %= 360.0
    if angle > 180.0:
        angle = 360.0 - angle
    if abs(angle) < 1e-12:
        return 0.0
    if abs(angle - 180.0) < 1e-12:
        return 180.0
    return angle


def _coerce_aspect_spec(value: ACGAspectSpec | str) -> ACGAspectSpec:
    if isinstance(value, str):
        lookup = value.strip().casefold()
        for candidate in ECLIPTIC_ASPECT_SPECS:
            if lookup in {
                candidate.aspect_id.casefold(),
                candidate.name.casefold(),
                candidate.label_key.casefold(),
            }:
                return candidate
        raise ValueError(f"unknown ACG aspect specification {value!r}")
    if not isinstance(value, ACGAspectSpec):
        raise TypeError(f"cannot coerce {value!r} to ACGAspectSpec")

    aspect_id = value.aspect_id.strip() if isinstance(value.aspect_id, str) else ""
    name = value.name.strip() if isinstance(value.name, str) else ""
    label_key = value.label_key.strip() if isinstance(value.label_key, str) else ""
    if not aspect_id or not name or not label_key:
        raise ValueError("aspect id, name, and label key must be non-empty")
    return ACGAspectSpec(
        aspect_id=aspect_id,
        name=name,
        label_key=label_key,
        angle_deg=_normalize_aspect_angle(value.angle_deg),
    )


def _normalize_aspect_specs(
    aspects: Iterable[ACGAspectSpec | str] | None,
) -> tuple[ACGAspectSpec, ...]:
    """Validate and deduplicate a caller-selected aspect set."""
    if aspects is None:
        return ()
    if isinstance(aspects, (ACGAspectSpec, str)):
        aspects = (aspects,)

    normalized: list[ACGAspectSpec] = []
    by_id: dict[str, ACGAspectSpec] = {}
    for raw in aspects:
        spec = _coerce_aspect_spec(raw)
        previous = by_id.get(spec.aspect_id)
        if previous is not None:
            if previous != spec:
                raise ValueError(
                    f"conflicting ACG aspect definitions for {spec.aspect_id!r}"
                )
            continue
        by_id[spec.aspect_id] = spec
        normalized.append(spec)
    return tuple(normalized)


def _normalize_aspect_targets(
    targets: Iterable[str] | str | None,
) -> tuple[str, ...]:
    if targets is None:
        return ()
    if isinstance(targets, str):
        targets = (targets,)
    normalized: list[str] = []
    for target in targets:
        if target not in ALL_KINDS:
            raise ValueError(
                f"aspect target must be one of {ALL_KINDS!r}, got {target!r}"
            )
        if target not in normalized:
            normalized.append(target)
    return tuple(normalized)


def _aspect_branches(angle_deg: float) -> tuple[tuple[str, float], ...]:
    """Return unique signed branches for one normalized aspect separation."""
    if angle_deg == 0.0 or angle_deg == 180.0:
        return ((ASPECT_BRANCH_SINGLE, angle_deg),)
    return (
        (ASPECT_BRANCH_PLUS, angle_deg),
        (ASPECT_BRANCH_MINUS, -angle_deg),
    )


# ---------------------------------------------------------------------------
# Point resolution

def resolve_equatorial(point: ACGPoint, jd_ut: float, iflag: int = astrology.SEFLG_SWIEPH) -> tuple[float, float]:
    """Return (ra_deg, dec_deg) for a point at the given instant."""
    flag = (iflag & ~astrology.SEFLG_SIDEREAL) | astrology.SEFLG_EQUATORIAL
    if point.equatorial is not None:
        ra, dec = float(point.equatorial[0]), float(point.equatorial[1])
        if not (isfinite(ra) and isfinite(dec)):
            raise ValueError(f"ACGPoint {point.id!r} has invalid equatorial coordinates")
        ra %= 360.0
    elif point.body_id is not None:
        _ret, eq, _err = astrology.swe_calc_ut_ex(jd_ut, int(point.body_id), flag)
        ra, dec = float(eq[0]), float(eq[1])
    elif point.star_name is not None:
        _ret, _name, eq, _err = astrology.swe_fixstar_ut(str(point.star_name), jd_ut, flag)
        ra, dec = float(eq[0]), float(eq[1])
    elif point.ecliptic is not None:
        eps = _true_obliquity_deg(jd_ut)
        ra, dec = _ecl_to_equ(float(point.ecliptic[0]), float(point.ecliptic[1]), eps)
    else:
        raise ValueError(f"ACGPoint {point.id!r} has no resolution source")

    if point.antipode:
        ra = (ra + 180.0) % 360.0
        dec = -dec
    return ra, dec


def resolve_ecliptic(point: ACGPoint, jd_ut: float, iflag: int = astrology.SEFLG_SWIEPH) -> tuple[float, float]:
    """Return (ecliptic_lon_deg, ecliptic_lat_deg) for a point at the instant."""
    flag = iflag & ~(
        getattr(astrology, "SEFLG_EQUATORIAL", 0)
        | getattr(astrology, "SEFLG_SIDEREAL", 0)
    )
    if point.body_id is not None:
        _ret, ecl, _err = astrology.swe_calc_ut_ex(jd_ut, int(point.body_id), flag)
        lon, lat = float(ecl[0]), float(ecl[1])
    elif point.star_name is not None:
        _ret, _name, ecl, _err = astrology.swe_fixstar_ut(str(point.star_name), jd_ut, flag)
        lon, lat = float(ecl[0]), float(ecl[1])
    elif point.ecliptic is not None:
        lon, lat = float(point.ecliptic[0]), float(point.ecliptic[1])
    else:
        raise ValueError(f"ACGPoint {point.id!r} has no resolution source")

    if point.antipode:
        lon = (lon + 180.0) % 360.0
        lat = -lat
    return lon % 360.0, lat


def resolve_zodiacal_equatorial(
    point: ACGPoint,
    jd_ut: float,
    iflag: int = astrology.SEFLG_SWIEPH,
) -> tuple[float, float]:
    """Return zodiacal ACG coordinates for ``point``.

    Zodiacal ACG uses the point's tropical ecliptic longitude but suppresses
    ecliptic latitude before rotating through the date-correct true obliquity.
    This is an ordinary chart-time ACG coordinate, not a geodetic mapping.
    """
    ecl_lon, _ecl_lat = resolve_ecliptic(point, jd_ut, iflag)
    return _ecl_to_equ(ecl_lon, 0.0, _true_obliquity_deg(jd_ut))


def _coerce_point(x) -> ACGPoint:
    if isinstance(x, ACGPoint):
        return x
    if isinstance(x, int):
        return ACGPoint(id=f"body_{x}", label=str(x), kind=KIND_PLANET, body_id=x)
    raise TypeError(f"cannot coerce {x!r} to ACGPoint")


# ---------------------------------------------------------------------------
# Horizon sampling

def _horizon_points(
    ra: float,
    dec: float,
    theta0: float,
    lat_min: float,
    lat_max: float,
    step: float,
    sign: int,
    max_error_meters: float = HORIZON_CHORD_ERROR_METERS,
    anchor_latitudes: Iterable[float] = (),
) -> list[tuple[float, float]]:
    """(lon, lat) samples for ASC (sign=-1) or DSC (sign=+1).

    The valid latitude band is bounded by the circumpolar condition
    |tan φ · tan δ| ≤ 1 → |φ| ≤ 90° − |δ|. To keep the curve visually
    closed we clamp the sampling range to that band and insert the
    exact termination points (where H = 0°/180°, i.e. the curve meets
    one of the MC/IC meridians).
    """
    if abs(dec) < 1e-9:
        # δ = 0 — body is on celestial equator; ASC/DSC are vertical
        # lines at ±90° from MC. Preserve any requested exact latitude
        # anchors between the endpoints as well.
        lon = _norm_lon(ra + sign * 90.0 - theta0)
        latitudes = [lat_min]
        latitudes.extend(
            sorted({float(value) for value in anchor_latitudes if lat_min < float(value) < lat_max})
        )
        latitudes.append(lat_max)
        return [(lon, latitude) for latitude in latitudes]

    phi_edge = 90.0 - abs(dec)  # strict circumpolar limit for this δ
    eff_min = max(lat_min, -phi_edge)
    eff_max = min(lat_max, phi_edge)
    if eff_min >= eff_max:
        return []

    dec_rad = radians(dec)

    def _lon_at(phi: float) -> float:
        cos_h = -tan(radians(phi)) * tan(dec_rad)
        cos_h = max(-1.0, min(1.0, cos_h))
        H = degrees(acos(cos_h))
        return ra + sign * H - theta0

    # The requested latitude window can end before either circumpolar
    # boundary. Evaluate its actual horizon intersection instead of stamping
    # the H=0°/180° boundary longitude onto an off-boundary endpoint.
    start_lon = _lon_at(eff_min)
    end_lon = _lon_at(eff_max)

    points = _adaptive_latitude_curve(
        eff_min,
        start_lon,
        eff_max,
        end_lon,
        _lon_at,
        max_lat_step=step,
        max_error_meters=max_error_meters,
    )
    for latitude in sorted({
        float(value) for value in anchor_latitudes
        if eff_min < float(value) < eff_max
    }):
        if any(abs(point[1] - latitude) < 1e-12 for point in points):
            continue
        index = next(
            (i for i, point in enumerate(points) if point[1] > latitude),
            len(points),
        )
        points.insert(index, (_norm_lon(_lon_at(latitude)), latitude))
    return points


def _geodetic_horizon_points(
    ecl_lon: float,
    eps: float,
    meridian_lon: float,
    lat_min: float,
    lat_max: float,
    step: float,
    sign: int,
    max_error_meters: float = HORIZON_CHORD_ERROR_METERS,
) -> list[tuple[float, float]]:
    """ASC/DSC samples for geodetic zodiacal-offset maps.

    Geodetic mode fixes the ecliptic MC directly to terrestrial longitude:
    0 Aries lies on ``meridian_lon`` and each degree east advances one zodiac
    degree. For a given latitude, solve the ordinary horizon condition for the
    target ecliptic longitude, then convert the resulting RAMC back to the
    geodetic MC longitude before adding the selected terrestrial meridian.
    """
    ra, dec = _ecl_to_equ(ecl_lon, 0.0, eps)

    def _geo_lon_for_ramc(ramc: float) -> float:
        return _norm_lon(_ra_to_ecl_lon(ramc, eps) + meridian_lon)

    if abs(dec) < 1e-9:
        lon = _geo_lon_for_ramc(ra + sign * 90.0)
        return [(lon, lat_min), (lon, lat_max)]

    phi_edge = 90.0 - abs(dec)
    eff_min = max(lat_min, -phi_edge)
    eff_max = min(lat_max, phi_edge)
    if eff_min >= eff_max:
        return []

    dec_rad = radians(dec)

    def _lon_at(phi: float) -> float:
        cos_h = -tan(radians(phi)) * tan(dec_rad)
        cos_h = max(-1.0, min(1.0, cos_h))
        H = degrees(acos(cos_h))
        return _geo_lon_for_ramc(ra + sign * H)

    start_lon = _lon_at(eff_min)
    end_lon = _lon_at(eff_max)

    return _adaptive_latitude_curve(
        eff_min,
        start_lon,
        eff_max,
        end_lon,
        _lon_at,
        max_lat_step=step,
        max_error_meters=max_error_meters,
    )


def _geodetic_angle_locus_segments(
    ecl_lon: float,
    eps: float,
    meridian_lon: float,
    target_angle: str,
    lat_min: float,
    lat_max: float,
    step_deg: float,
    horizon_error_meters: float,
) -> tuple[tuple[tuple[float, float], ...], ...]:
    """Return one angle locus in the selected geodetic longitude system."""
    if target_angle == LINE_MC:
        return _meridian_segments(ecl_lon + meridian_lon, lat_min, lat_max)
    if target_angle == LINE_IC:
        return _meridian_segments(
            ecl_lon + meridian_lon + 180.0,
            lat_min,
            lat_max,
        )
    if target_angle == LINE_ASC:
        points = _geodetic_horizon_points(
            ecl_lon,
            eps,
            meridian_lon,
            lat_min,
            lat_max,
            step_deg,
            sign=-1,
            max_error_meters=horizon_error_meters,
        )
        return _split_antimeridian(points)
    if target_angle == LINE_DSC:
        points = _geodetic_horizon_points(
            ecl_lon,
            eps,
            meridian_lon,
            lat_min,
            lat_max,
            step_deg,
            sign=+1,
            max_error_meters=horizon_error_meters,
        )
        return _split_antimeridian(points)
    raise ValueError(f"unsupported ACG target angle {target_angle!r}")


# ---------------------------------------------------------------------------
# Parans — latitude where two bodies are simultaneously on angles

def _solve_meridian_horizon_paran(
    ra_m: float, h_m_deg: float,
    ra_h: float, dec_h: float,
) -> float | None:
    """Latitude where body-on-meridian and body-on-horizon are simultaneous.

    ``h_m_deg`` is the hour angle of the meridian body (0 for MC, 180 for IC).
    Closed form:

        cos(Δα + h_m) = −tan(φ)·tan(δ_h)
        → φ = atan(−cos(Δα + h_m) / tan(δ_h)),   Δα = α_m − α_h

    The cos-of-both-sides collapses the ASC/DSC sign distinction — each pair
    yields a single paran latitude that is geometrically valid for exactly
    one of {ASC, DSC} depending on the sign of Δα + h_m.
    """
    if abs(dec_h) < 1e-6:
        return None  # equatorial body — horizon lines are vertical meridians; no crossing
    delta_alpha = (ra_m - ra_h) % 360.0
    c = cos(radians(delta_alpha + h_m_deg))
    td = tan(radians(dec_h))
    if abs(td) < 1e-9:
        return None
    # atan (not atan2) — latitude is always in (-90°, 90°). atan2 would sign-
    # flip into quadrant III when the horizon body has negative declination.
    try:
        from math import atan
        phi = degrees(atan(-c / td))
    except Exception:
        return None
    if phi != phi:  # NaN guard
        return None
    return phi


def _solve_horizon_horizon_parans(
    ra_a: float, dec_a: float, beta_a: int,
    ra_b: float, dec_b: float, beta_b: int,
    lat_min: float, lat_max: float,
    scan_step_deg: float = PARAN_SCAN_STEP_DEG,
    root_tol_deg: float = PARAN_ROOT_TOL_DEG,
) -> list[float]:
    """Latitudes where A on horizon (ASC if ``beta_a=-1`` / DSC if +1) and
    B on horizon (similarly) are simultaneous. Transcendental; solved by
    sampling + bisection on::

        β_A · h_A(φ) − β_B · h_B(φ) ≡ (α_B − α_A)   (mod 360°)

    where h_X(φ) = acos(−tan φ · tan δ_X). Returns 0, 1, or occasionally 2
    latitudes (a single equation pair can root twice inside the valid band).
    """
    if abs(dec_a) < 1e-6 or abs(dec_b) < 1e-6:
        return []  # equatorial body: horizon is a vertical meridian → degenerate

    phi_edge = min(90.0 - abs(dec_a), 90.0 - abs(dec_b)) - 0.01
    phi_lo = max(lat_min, -phi_edge)
    phi_hi = min(lat_max, phi_edge)
    if phi_lo >= phi_hi:
        return []

    dec_a_rad = radians(dec_a)
    dec_b_rad = radians(dec_b)
    # α_B − α_A normalized to (-180, 180]
    delta_alpha = (ra_b - ra_a + 540.0) % 360.0 - 180.0

    def residual(phi_deg: float) -> float:
        cos_ha = -tan(radians(phi_deg)) * tan(dec_a_rad)
        cos_hb = -tan(radians(phi_deg)) * tan(dec_b_rad)
        cos_ha = max(-1.0, min(1.0, cos_ha))
        cos_hb = max(-1.0, min(1.0, cos_hb))
        h_a = degrees(acos(cos_ha))
        h_b = degrees(acos(cos_hb))
        lhs = beta_a * h_a - beta_b * h_b
        return ((lhs - delta_alpha + 180.0) % 360.0) - 180.0

    from math import isnan
    samples = []
    scan_step_deg = max(float(scan_step_deg), 1e-6)
    root_tol_deg = max(float(root_tol_deg), 1e-12)
    n = max(1, int((phi_hi - phi_lo) / scan_step_deg))
    for i in range(n + 1):
        phi = phi_lo + (phi_hi - phi_lo) * i / n
        r = residual(phi)
        if isnan(r):
            r = None
        samples.append((phi, r))

    roots: list[float] = []
    def add_root(phi: float) -> None:
        if any(abs(phi - existing) <= root_tol_deg * 10.0 for existing in roots):
            return
        roots.append(phi)

    for (p1, v1), (p2, v2) in zip(samples, samples[1:]):
        if v1 is None or v2 is None:
            continue
        if abs(v1) <= 1e-10:
            add_root(p1)
            continue
        if abs(v2) <= 1e-10:
            add_root(p2)
            continue
        # Ignore modular-wrap discontinuities: a real zero-crossing moves < 180°
        if v1 * v2 > 0.0 or abs(v1 - v2) > 180.0:
            continue
        a, b, fa, fb = p1, p2, v1, v2
        for _ in range(60):
            m = 0.5 * (a + b)
            fm = residual(m)
            if fm is None:
                break
            if abs(b - a) < root_tol_deg:
                break
            if fa * fm < 0.0:
                b, fb = m, fm
            else:
                a, fa = m, fm
        add_root(0.5 * (a + b))
    return roots


def _horizon_angle_for_observer(ra: float, dec: float, theta0: float, phi_deg: float,
                                 lon_deg: float) -> str | None:
    """Given observer (lon, φ) and body (α, δ), return 'ASC' or 'DSC'
    if the body is on the horizon at that observer, else None.
    Used to decide which horizon label applies to a computed paran."""
    phi_rad = radians(phi_deg)
    dec_rad = radians(dec)
    cos_h = -tan(phi_rad) * tan(dec_rad)
    if not (-1.0 <= cos_h <= 1.0):
        return None
    h_expected = degrees(acos(cos_h))
    # Observer LST
    lst = (theta0 + lon_deg) % 360.0
    h_observed = ((lst - ra) + 540.0) % 360.0 - 180.0  # in [-180, 180]
    if abs(abs(h_observed) - h_expected) > 1e-6:
        return None
    return "ASC" if h_observed < 0 else "DSC"


def _dedup_parans(parans: Iterable[ACGParan]) -> tuple[ACGParan, ...]:
    seen: set = set()
    dedup: list[ACGParan] = []
    for p in parans:
        key = tuple(sorted([(p.point_a_id, p.angle_a), (p.point_b_id, p.angle_b)]))
        if key in seen:
            continue
        seen.add(key)
        dedup.append(p)
    return tuple(dedup)


PARAN_LAT_RANGE_DEFAULT: tuple[float, float] = (-65.0, 65.0)
"""Default paran latitude clamp. Matches Jim Lewis (Astro*Carto*Graphy) and
astro.com conventions: parans above ±65° cluster at the poles, overlap on the
map, and correspond to uninhabited / circumpolar regions. Callers may widen
via ``compute_parans(..., lat_range=(-85, 85))``."""


def compute_parans(
    jd_ut: float,
    points: Iterable = DEFAULT_POINTS,
    lat_range: tuple[float, float] = PARAN_LAT_RANGE_DEFAULT,
    iflag: int = astrology.SEFLG_SWIEPH,
    scan_step_deg: float = PARAN_SCAN_STEP_DEG,
) -> tuple[ACGParan, ...]:
    """Latitudes where two bodies are simultaneously on their angles.

    Covers the full Jim Lewis paran set:

        Meridian × horizon (closed form):
            MC × ASC,  MC × DSC,  IC × ASC,  IC × DSC
        Horizon × horizon (numerical):
            ASC × ASC, ASC × DSC, DSC × ASC, DSC × DSC
    """
    theta0 = _gst_deg(jd_ut)
    resolved = tuple(_coerce_point(p) for p in points)
    equ: dict[str, tuple[float, float]] = {}
    for pt in resolved:
        try:
            equ[pt.id] = resolve_equatorial(pt, jd_ut, iflag)
        except Exception:
            continue

    lat_min, lat_max = lat_range
    out: list[ACGParan] = []
    meridian_info = {LINE_MC: 0.0, LINE_IC: 180.0}
    horizon_signs = {LINE_ASC: -1, LINE_DSC: +1}

    ids = list(equ.keys())
    for a_id in ids:
        ra_a, dec_a = equ[a_id]
        for b_id in ids:
            if b_id == a_id:
                continue
            ra_b, dec_b = equ[b_id]

            # --- meridian × horizon (closed-form) ---------------------------
            for a_angle, h_m in meridian_info.items():
                phi = _solve_meridian_horizon_paran(ra_a, h_m, ra_b, dec_b)
                if phi is None or not (lat_min <= phi <= lat_max):
                    continue
                lon_obs = _norm_lon(ra_a + h_m - theta0)
                branch = _horizon_angle_for_observer(ra_b, dec_b, theta0, phi, lon_obs)
                if branch is None:
                    continue
                out.append(ACGParan(
                    point_a_id=a_id, angle_a=a_angle,
                    point_b_id=b_id, angle_b=branch,
                    latitude=phi,
                ))

            # --- horizon × horizon (numerical) ------------------------------
            # Only do each unordered (a_id, b_id) pair once for this leg,
            # since horizon-horizon is symmetric under (A↔B, β_A↔β_B swap).
            if a_id >= b_id:
                continue
            for a_angle, beta_a in horizon_signs.items():
                for b_angle, beta_b in horizon_signs.items():
                    for phi in _solve_horizon_horizon_parans(
                        ra_a, dec_a, beta_a, ra_b, dec_b, beta_b,
                        lat_min, lat_max,
                        scan_step_deg=scan_step_deg,
                    ):
                        out.append(ACGParan(
                            point_a_id=a_id, angle_a=a_angle,
                            point_b_id=b_id, angle_b=b_angle,
                            latitude=phi,
                        ))
    # Deduplicate: paran (A-X, B-Y) == (B-Y, A-X).
    return _dedup_parans(out)


# ---------------------------------------------------------------------------
# Public API

def _angle_locus_segments(
    ra: float,
    dec: float,
    theta0: float,
    target_angle: str,
    lat_min: float,
    lat_max: float,
    step_deg: float,
    horizon_error_meters: float,
) -> tuple[tuple[tuple[float, float], ...], ...]:
    """Solve one celestial coordinate's locus on exactly one chart angle."""
    if target_angle == LINE_MC:
        return _meridian_segments(ra - theta0, lat_min, lat_max)
    if target_angle == LINE_IC:
        return _meridian_segments(ra - theta0 + 180.0, lat_min, lat_max)
    if target_angle == LINE_ASC:
        points = _horizon_points(
            ra,
            dec,
            theta0,
            lat_min,
            lat_max,
            step_deg,
            sign=-1,
            max_error_meters=horizon_error_meters,
        )
        return _split_antimeridian(points)
    if target_angle == LINE_DSC:
        points = _horizon_points(
            ra,
            dec,
            theta0,
            lat_min,
            lat_max,
            step_deg,
            sign=+1,
            max_error_meters=horizon_error_meters,
        )
        return _split_antimeridian(points)
    raise ValueError(f"unsupported ACG target angle {target_angle!r}")


def _compute_ordinary_acg(
    jd_ut: float,
    points: Iterable,
    kinds: Iterable[str],
    lat_range: tuple[float, float],
    step_deg: float,
    iflag: int,
    include_parans: bool,
    include_zenith_markers: bool,
    horizon_error_meters: float,
    paran_scan_step_deg: float,
    aspects: Iterable[ACGAspectSpec | str] | None,
    aspect_targets: Iterable[str] | str | None,
    *,
    line_system: str,
    resolver: Callable[[ACGPoint], tuple[float, float]],
    aspect_basis_resolver: Callable[[ACGPoint], tuple[float, float]] | None = None,
    aspect_branch_resolver: Callable[
        [float, float, float], tuple[float, float]
    ] | None = None,
    zenith_resolver: Callable[[ACGPoint], tuple[float, float]] | None = None,
) -> ACGResult:
    if step_deg <= 0:
        raise ValueError("step_deg must be positive")
    lat_min, lat_max = lat_range
    if lat_min >= lat_max:
        raise ValueError("lat_range must be (min, max) with min < max")

    theta0 = _gst_deg(jd_ut)
    kinds_set = set(kinds)
    aspect_specs = _normalize_aspect_specs(aspects)
    selected_aspect_targets = (
        _normalize_aspect_targets(aspect_targets) if aspect_specs else ()
    )
    resolved_points = tuple(_coerce_point(p) for p in points)
    equatorial: dict[str, tuple[float, float]] = {}
    zenith_equatorial: dict[str, tuple[float, float]] = {}
    out_lines: list[ACGLine] = []
    out_aspect_lines: list[ACGAspectLine] = []

    for pt in resolved_points:
        try:
            ra, dec = resolver(pt)
        except Exception:
            continue
        equatorial[pt.id] = (ra, dec)
        if include_zenith_markers:
            try:
                zenith_equatorial[pt.id] = (
                    zenith_resolver(pt) if zenith_resolver is not None else (ra, dec)
                )
            except Exception:
                # A point can still have a valid display-system line even when
                # its physical coordinate is unavailable. Zeniths, unlike the
                # selectable line system, are always physical substellar
                # points and therefore omit only that marker.
                pass

        if LINE_MC in kinds_set:
            out_lines.append(ACGLine(pt.id, LINE_MC,
                _meridian_segments(ra - theta0, lat_min, lat_max)))
        if LINE_IC in kinds_set:
            out_lines.append(ACGLine(pt.id, LINE_IC,
                _meridian_segments(ra - theta0 + 180.0, lat_min, lat_max)))
        if LINE_ASC in kinds_set:
            pts = _horizon_points(
                ra, dec, theta0, lat_min, lat_max, step_deg,
                sign=-1,
                max_error_meters=horizon_error_meters,
            )
            out_lines.append(ACGLine(pt.id, LINE_ASC, _split_antimeridian(pts)))
        if LINE_DSC in kinds_set:
            pts = _horizon_points(
                ra, dec, theta0, lat_min, lat_max, step_deg,
                sign=+1,
                max_error_meters=horizon_error_meters,
            )
            out_lines.append(ACGLine(pt.id, LINE_DSC, _split_antimeridian(pts)))

        if aspect_specs and selected_aspect_targets:
            # In mundo uses actual RA/declination as its aspect coordinate:
            # branches are RA±A and retain the source's physical declination.
            # Zodiacal callers supply an ecliptic basis/branch resolver below.
            if aspect_basis_resolver is None:
                basis_coordinate, basis_latitude = ra, dec
            else:
                try:
                    basis_coordinate, basis_latitude = aspect_basis_resolver(pt)
                except Exception:
                    continue

            for aspect in aspect_specs:
                for branch, signed_angle in _aspect_branches(aspect.angle_deg):
                    if aspect_branch_resolver is None:
                        branch_ra = (basis_coordinate + signed_angle) % 360.0
                        branch_dec = basis_latitude
                    else:
                        branch_ra, branch_dec = aspect_branch_resolver(
                            basis_coordinate,
                            basis_latitude,
                            signed_angle,
                        )
                    for target_angle in selected_aspect_targets:
                        out_aspect_lines.append(ACGAspectLine(
                            point_id=pt.id,
                            target_angle=target_angle,
                            aspect_id=aspect.aspect_id,
                            aspect_name=aspect.name,
                            aspect_key=aspect.label_key,
                            aspect_angle=aspect.angle_deg,
                            branch=branch,
                            branch_sign=(
                                1 if branch == ASPECT_BRANCH_PLUS
                                else -1 if branch == ASPECT_BRANCH_MINUS
                                else 0
                            ),
                            segments=_angle_locus_segments(
                                branch_ra,
                                branch_dec,
                                theta0,
                                target_angle,
                                lat_min,
                                lat_max,
                                step_deg,
                                horizon_error_meters,
                            ),
                        ))

    markers = (
        tuple(
            ACGMarker(
                point_id=point_id,
                kind=MARKER_ZENITH,
                longitude=_norm_lon(ra - theta0),
                latitude=dec,
            )
            for point_id, (ra, dec) in zenith_equatorial.items()
        )
        if include_zenith_markers else ()
    )
    # Parans retain their established meaning: simultaneous physical
    # in-mundo angularity, independent of the displayed line coordinate
    # system. In particular, zodiacal longitude lines do not reinterpret
    # paran latitudes using latitude-suppressed coordinates.
    parans = (
        compute_parans(jd_ut, resolved_points, iflag=iflag, scan_step_deg=paran_scan_step_deg)
        if include_parans else ()
    )

    return ACGResult(
        jd_ut=jd_ut,
        theta0_deg=theta0,
        equatorial=equatorial,
        lines=tuple(out_lines),
        lat_range=lat_range,
        points=resolved_points,
        aspect_lines=tuple(out_aspect_lines),
        parans=parans,
        markers=markers,
        line_system=line_system,
        paran_system=LINE_SYSTEM_IN_MUNDO,
    )


def compute_acg(
    jd_ut: float,
    points: Iterable = DEFAULT_POINTS,
    kinds: Iterable[str] = ALL_KINDS,
    lat_range: tuple[float, float] = (-GEOGRAPHIC_LAT_LIMIT, GEOGRAPHIC_LAT_LIMIT),
    step_deg: float = 1.0,
    iflag: int = astrology.SEFLG_SWIEPH,
    include_parans: bool = True,
    horizon_error_meters: float = HORIZON_CHORD_ERROR_METERS,
    paran_scan_step_deg: float = PARAN_SCAN_STEP_DEG,
    include_zenith_markers: bool = False,
    aspects: Iterable[ACGAspectSpec | str] | None = (),
    aspect_targets: Iterable[str] | str | None = ALL_KINDS,
) -> ACGResult:
    """Compute ordinary in-mundo ACG lines at the chart instant.

    Aspect loci, when selected, follow the professional in-mundo convention:
    apply the aspect as ``RA ± aspect`` while preserving the source point's
    actual declination, then solve only each selected target angle locus.
    """
    return _compute_ordinary_acg(
        jd_ut,
        points,
        kinds,
        lat_range,
        step_deg,
        iflag,
        include_parans,
        include_zenith_markers,
        horizon_error_meters,
        paran_scan_step_deg,
        aspects,
        aspect_targets,
        line_system=LINE_SYSTEM_IN_MUNDO,
        resolver=lambda point: resolve_equatorial(point, jd_ut, iflag),
    )


def compute_zodiacal_acg(
    jd_ut: float,
    points: Iterable = DEFAULT_POINTS,
    kinds: Iterable[str] = ALL_KINDS,
    lat_range: tuple[float, float] = (-GEOGRAPHIC_LAT_LIMIT, GEOGRAPHIC_LAT_LIMIT),
    step_deg: float = 1.0,
    iflag: int = astrology.SEFLG_SWIEPH,
    include_parans: bool = True,
    horizon_error_meters: float = HORIZON_CHORD_ERROR_METERS,
    paran_scan_step_deg: float = PARAN_SCAN_STEP_DEG,
    include_zenith_markers: bool = False,
    aspects: Iterable[ACGAspectSpec | str] | None = (),
    aspect_targets: Iterable[str] | str | None = ALL_KINDS,
) -> ACGResult:
    """Compute chart-time zodiacal ACG lines.

    Each point is resolved to tropical ecliptic longitude, its ecliptic
    latitude is suppressed, and the longitude is rotated to equatorial
    coordinates with true obliquity. Geographic lines remain anchored to this
    chart instant's GST. Parans, when requested, remain physical in-mundo
    simultaneous angularity and are declared as such on the result.
    """
    eps = _true_obliquity_deg(jd_ut)
    ecliptic_cache: dict[int, tuple[float, float]] = {}

    def _resolve_ecliptic(point: ACGPoint) -> tuple[float, float]:
        cache_key = id(point)
        coordinate = ecliptic_cache.get(cache_key)
        if coordinate is None:
            coordinate = resolve_ecliptic(point, jd_ut, iflag)
            ecliptic_cache[cache_key] = coordinate
        return coordinate

    def _resolve(point: ACGPoint) -> tuple[float, float]:
        ecl_lon, _ecl_lat = _resolve_ecliptic(point)
        return _ecl_to_equ(ecl_lon, 0.0, eps)

    def _resolve_aspect_branch(
        ecl_lon: float,
        _ecl_lat: float,
        signed_angle: float,
    ) -> tuple[float, float]:
        # Zodiacal aspects are formed in tropical ecliptic longitude first;
        # each λ±A branch has β=0 before the date-correct obliquity rotation.
        return _ecl_to_equ(ecl_lon + signed_angle, 0.0, eps)

    return _compute_ordinary_acg(
        jd_ut,
        points,
        kinds,
        lat_range,
        step_deg,
        iflag,
        include_parans,
        include_zenith_markers,
        horizon_error_meters,
        paran_scan_step_deg,
        aspects,
        aspect_targets,
        line_system=LINE_SYSTEM_ZODIACAL,
        resolver=_resolve,
        aspect_basis_resolver=_resolve_ecliptic,
        aspect_branch_resolver=_resolve_aspect_branch,
        zenith_resolver=lambda point: resolve_equatorial(point, jd_ut, iflag),
    )


def compute_geodetic_acg(
    jd_ut: float,
    points: Iterable = DEFAULT_POINTS,
    kinds: Iterable[str] = ALL_KINDS,
    lat_range: tuple[float, float] = (-GEOGRAPHIC_LAT_LIMIT, GEOGRAPHIC_LAT_LIMIT),
    step_deg: float = 1.0,
    iflag: int = astrology.SEFLG_SWIEPH,
    meridian_lon: float = GEODETIC_GREENWICH_MERIDIAN_LON,
    include_parans: bool = True,
    horizon_error_meters: float = HORIZON_CHORD_ERROR_METERS,
    paran_scan_step_deg: float = PARAN_SCAN_STEP_DEG,
    include_zenith_markers: bool = False,
    aspects: Iterable[ACGAspectSpec | str] | None = (),
    aspect_targets: Iterable[str] | str | None = ALL_KINDS,
) -> ACGResult:
    """Geodetic zodiacal-offset astrocartography lines.

    ``meridian_lon`` is the terrestrial longitude assigned to 0 Aries. Greenwich
    is 0°; the Giza variant uses the Great Pyramid meridian. MC/IC lines are the
    direct geodetic equivalents of a point's zodiacal longitude. ASC/DSC lines
    are computed from the ecliptic horizon under that geodetic MC.

    Aspect branches are formed in tropical ecliptic longitude before the same
    geodetic angle solve. Parans and zenith markers remain physical in-mundo
    overlays: changing the display meridian never relocates them.
    """
    if step_deg <= 0:
        raise ValueError("step_deg must be positive")
    lat_min, lat_max = lat_range
    if lat_min >= lat_max:
        raise ValueError("lat_range must be (min, max) with min < max")

    eps = _true_obliquity_deg(jd_ut)
    physical_theta0 = _gst_deg(jd_ut)
    kinds_set = set(kinds)
    aspect_specs = _normalize_aspect_specs(aspects)
    selected_aspect_targets = (
        _normalize_aspect_targets(aspect_targets) if aspect_specs else ()
    )
    resolved_points = tuple(_coerce_point(p) for p in points)
    equatorial: dict[str, tuple[float, float]] = {}
    zenith_equatorial: dict[str, tuple[float, float]] = {}
    out_lines: list[ACGLine] = []
    out_aspect_lines: list[ACGAspectLine] = []

    for pt in resolved_points:
        try:
            ecl_lon, _ecl_lat = resolve_ecliptic(pt, jd_ut, iflag)
        except Exception:
            continue
        ra, dec = _ecl_to_equ(ecl_lon, 0.0, eps)
        equatorial[pt.id] = (ra, dec)
        if include_zenith_markers:
            try:
                zenith_equatorial[pt.id] = resolve_equatorial(
                    pt,
                    jd_ut,
                    iflag,
                )
            except Exception:
                pass

        if LINE_MC in kinds_set:
            out_lines.append(ACGLine(pt.id, LINE_MC,
                _meridian_segments(ecl_lon + meridian_lon, lat_min, lat_max)))
        if LINE_IC in kinds_set:
            out_lines.append(ACGLine(pt.id, LINE_IC,
                _meridian_segments(ecl_lon + meridian_lon + 180.0, lat_min, lat_max)))
        if LINE_ASC in kinds_set:
            pts = _geodetic_horizon_points(
                ecl_lon, eps, meridian_lon, lat_min, lat_max, step_deg,
                sign=-1,
                max_error_meters=horizon_error_meters,
            )
            out_lines.append(ACGLine(pt.id, LINE_ASC, _split_antimeridian(pts)))
        if LINE_DSC in kinds_set:
            pts = _geodetic_horizon_points(
                ecl_lon, eps, meridian_lon, lat_min, lat_max, step_deg,
                sign=+1,
                max_error_meters=horizon_error_meters,
            )
            out_lines.append(ACGLine(pt.id, LINE_DSC, _split_antimeridian(pts)))

        for aspect in aspect_specs:
            for branch, signed_angle in _aspect_branches(aspect.angle_deg):
                branch_lon = (ecl_lon + signed_angle) % 360.0
                for target_angle in selected_aspect_targets:
                    out_aspect_lines.append(ACGAspectLine(
                        point_id=pt.id,
                        target_angle=target_angle,
                        aspect_id=aspect.aspect_id,
                        aspect_name=aspect.name,
                        aspect_key=aspect.label_key,
                        aspect_angle=aspect.angle_deg,
                        branch=branch,
                        branch_sign=(
                            1 if branch == ASPECT_BRANCH_PLUS
                            else -1 if branch == ASPECT_BRANCH_MINUS
                            else 0
                        ),
                        segments=_geodetic_angle_locus_segments(
                            branch_lon,
                            eps,
                            meridian_lon,
                            target_angle,
                            lat_min,
                            lat_max,
                            step_deg,
                            horizon_error_meters,
                        ),
                    ))

    markers = (
        tuple(
            ACGMarker(
                point_id=point_id,
                kind=MARKER_ZENITH,
                longitude=_norm_lon(ra - physical_theta0),
                latitude=dec,
            )
            for point_id, (ra, dec) in zenith_equatorial.items()
        )
        if include_zenith_markers else ()
    )
    # Parans are latitude crossings and remain the same latitude set across
    # standard/geodetic longitude-line modes.
    parans = (
        compute_parans(jd_ut, resolved_points, iflag=iflag, scan_step_deg=paran_scan_step_deg)
        if include_parans else ()
    )
    normalized_meridian = _norm_lon(meridian_lon)
    if abs(normalized_meridian) < 1e-9:
        line_system = LINE_SYSTEM_GEODETIC_GREENWICH
    elif abs(_norm_lon(normalized_meridian - GEODETIC_GIZA_MERIDIAN_LON)) < 1e-9:
        line_system = LINE_SYSTEM_GEODETIC_GIZA
    else:
        line_system = LINE_SYSTEM_GEODETIC_CUSTOM
    return ACGResult(
        jd_ut=jd_ut,
        theta0_deg=meridian_lon % 360.0,
        equatorial=equatorial,
        lines=tuple(out_lines),
        lat_range=lat_range,
        points=resolved_points,
        aspect_lines=tuple(out_aspect_lines),
        parans=parans,
        markers=markers,
        line_system=line_system,
        paran_system=LINE_SYSTEM_IN_MUNDO,
    )


def compute_acg_for_chart(chart, points: Iterable | None = None, **kwargs) -> ACGResult:
    if points is None:
        points = points_from_chart(chart)
    return compute_acg(chart.time.jd, points=points, **kwargs)


def compute_zodiacal_acg_for_chart(chart, points: Iterable | None = None, **kwargs) -> ACGResult:
    if points is None:
        points = points_from_chart(chart)
    return compute_zodiacal_acg(chart.time.jd, points=points, **kwargs)


def compute_geodetic_acg_for_chart(chart, points: Iterable | None = None, **kwargs) -> ACGResult:
    if points is None:
        points = points_from_chart(chart)
    return compute_geodetic_acg(chart.time.jd, points=points, **kwargs)


def natal_ascendant_point_from_chart(
    chart,
    *,
    color_hex: str | None = None,
) -> ACGPoint:
    """Return the chart's natal Ascendant degree as a celestial point.

    Chart angles are stored in the selected zodiac, while an ecliptic-to-
    equatorial rotation needs tropical longitude. Recovering the tropical
    value here keeps this physical rising point identical in tropical and
    sidereal charts.
    """
    selected_lon = float(chart.houses.ascmc[houses.Houses.ASC])
    tropical_lon = util.to_tropical_lon(
        selected_lon,
        float(getattr(chart, "ayanamsha_offset", 0.0) or 0.0),
    )
    return ACGPoint(
        id=NATAL_ASC_POINT_ID,
        label="Ascendant",
        kind=KIND_CUSTOM,
        ecliptic=(tropical_lon, 0.0),
        color_hex=color_hex,
    )


def compute_natal_ascendant_acg_for_chart(
    chart,
    *,
    lat_range: tuple[float, float] = (-GEOGRAPHIC_LAT_LIMIT, GEOGRAPHIC_LAT_LIMIT),
    step_deg: float = 1.0,
    iflag: int = astrology.SEFLG_SWIEPH,
    horizon_error_meters: float = HORIZON_CHORD_ERROR_METERS,
    color_hex: str | None = None,
) -> ACGResult:
    """Compute the natal Ascendant degree's standard ASC/DSC ACG pair.

    This is distinct from the ordinary planetary ASC lines. The natal
    Ascendant is the ecliptic degree rising at the chart place and time, so its
    ASC locus necessarily crosses the birthplace. The birthplace latitude is
    inserted as an exact analytic sample in both branches so preview geometry
    shows the birthplace crossing and the opposite DSC branch without
    interpolation drift.
    """
    if step_deg <= 0:
        raise ValueError("step_deg must be positive")
    lat_min, lat_max = map(float, lat_range)
    if lat_min >= lat_max:
        raise ValueError("lat_range must be (min, max) with min < max")

    point = natal_ascendant_point_from_chart(chart, color_hex=color_hex)
    jd_ut = float(chart.time.jd)
    theta0 = _gst_deg(jd_ut)
    ra, dec = resolve_equatorial(point, jd_ut, iflag)
    observer_lat = float(chart.place.lat)
    asc_points = _horizon_points(
        ra,
        dec,
        theta0,
        lat_min,
        lat_max,
        step_deg,
        sign=-1,
        max_error_meters=horizon_error_meters,
        anchor_latitudes=(observer_lat,),
    )
    dsc_points = _horizon_points(
        ra,
        dec,
        theta0,
        lat_min,
        lat_max,
        step_deg,
        sign=+1,
        max_error_meters=horizon_error_meters,
        anchor_latitudes=(observer_lat,),
    )
    lines = (
        ACGLine(point.id, LINE_ASC, _split_antimeridian(asc_points)),
        ACGLine(point.id, LINE_DSC, _split_antimeridian(dsc_points)),
    )
    return ACGResult(
        jd_ut=jd_ut,
        theta0_deg=theta0,
        equatorial={point.id: (ra, dec)},
        lines=lines,
        lat_range=(lat_min, lat_max),
        points=(point,),
        parans=(),
    )


# ---------------------------------------------------------------------------
# Convenience: build point sets from an existing Morinus chart

def points_from_chart(chart, *, include_parts: bool = True) -> tuple[ACGPoint, ...]:
    """Full ACG point set for a chart: default luminaries/planets/nodes/Chiron
    plus Arabic parts (if present). Fixed stars are *not* included by default
    (they need an explicit selection — typically done via ``fixstarspddlg``).

    The caller is expected to route this through ``compute_acg``. The function
    is intentionally permissive: missing attributes on the chart are skipped.
    """
    out: list[ACGPoint] = list(DEFAULT_POINTS)

    if include_parts:
        parts = getattr(chart, "arabicparts", None)
        if parts is not None:
            for ap in _iter_arabic_parts(parts):
                pid, label, lon = ap
                out.append(ACGPoint(
                    id=f"lot_{pid}",
                    label=label,
                    kind=KIND_LOT,
                    ecliptic=(float(lon), 0.0),
                ))

    return tuple(out)


def _iter_arabic_parts(parts_obj):
    """Best-effort iteration over a Morinus ArabicParts-ish container.

    Yields (slug, label, ecliptic_lon_deg) tuples. Tolerant of shape since
    the Morinus arabic-parts structure varies (list / dict / custom object).
    """
    items = None
    if hasattr(parts_obj, "parts"):
        items = parts_obj.parts
    elif isinstance(parts_obj, (list, tuple)):
        items = parts_obj
    elif isinstance(parts_obj, dict):
        items = parts_obj.items()
    if items is None:
        return

    for entry in items:
        try:
            if isinstance(entry, tuple) and len(entry) == 2:
                key, val = entry
                label = str(key)
                lon = float(getattr(val, "lon", val))
            else:
                label = str(getattr(entry, "name", None) or getattr(entry, "label", None) or "lot")
                lon = float(getattr(entry, "lon", None) or getattr(entry, "longitude", None))
        except Exception:
            continue
        slug = label.lower().replace(" ", "_")
        yield slug, label, lon


def star_point(name: str, label: str | None = None) -> ACGPoint:
    """Helper: build a fixed-star ACG point."""
    return ACGPoint(id=f"star_{name}", label=label or name, kind=KIND_STAR, star_name=name)


def ecliptic_point(point_id: str, label: str, lon_deg: float, lat_deg: float = 0.0, kind: str = KIND_CUSTOM) -> ACGPoint:
    """Helper: build a custom point from an ecliptic coordinate (lon, lat)."""
    return ACGPoint(id=point_id, label=label, kind=kind, ecliptic=(lon_deg, lat_deg))
