# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Canonical dynamic (cyclocartography) layers for Astrocart.

The moving set in this module is intentionally independent from the natal
point set.  A transit/progression is first built through
``supplementary_service`` and only the explicitly selected, technique-capable
actors are copied from that derived chart. Their tropical ecliptic coordinates
and the supplementary chart's canonical equatorial coordinates are then held
fixed while Astrocart solves terrestrial angle geometry in the radix frame.

Radix frame (Cyclocartography, Jim Lewis, US 4,304,554): the Earth keeps
the radix Greenwich sidereal time, so every moving line is the locus where a
transiting/progressed body stands on the natal angles relocated to that
place. Only the bodies move; the lines drift with planetary motion, never with
the target instant's time of day. A moment chart with its own angles (a
return, an event) is a separate map, not a moving layer.

Lewis CCG is the one map-owned technique: it never calls the supplementary
builder or global progression options. The Sun, Moon, Mercury, Venus and Mars
are secondary-progressed by "one day's actual motion per year"; every other
selected body is transiting. An optional progressed-angles reading advances
the radix frame by the progressed Sun's arc in right ascension.
"""

from __future__ import annotations

from dataclasses import dataclass
import datetime
from hashlib import sha256
import json
from math import isfinite
from typing import Any, Iterable

import astrology
import astrocart
import chart as chart_mod
import planets
import util
from webapp.daemon import astrocart_spec
from webapp.daemon.supplementary_service import (
    supplementary_service as canonical_supplementary_service,
)


DYNAMIC_PUBLIC_KIND = {
    astrocart_spec.TECHNIQUE_TRANSIT: "transits",
    astrocart_spec.TECHNIQUE_SECONDARY_PROGRESSION: "secondary-progression",
    astrocart_spec.TECHNIQUE_MINOR_PROGRESSION: "minor-progression",
    astrocart_spec.TECHNIQUE_TERTIARY_PROGRESSION: "tertiary-progression",
    astrocart_spec.TECHNIQUE_SOLAR_ARC: "solar-arc",
}

DYNAMIC_ROLE = {
    astrocart_spec.TECHNIQUE_TRANSIT: astrocart_spec.ROLE_TRANSIT_ACTOR,
    astrocart_spec.TECHNIQUE_SECONDARY_PROGRESSION: (
        astrocart_spec.ROLE_SECONDARY_PROGRESSION_ACTOR
    ),
    astrocart_spec.TECHNIQUE_MINOR_PROGRESSION: (
        astrocart_spec.ROLE_MINOR_PROGRESSION_ACTOR
    ),
    astrocart_spec.TECHNIQUE_TERTIARY_PROGRESSION: (
        astrocart_spec.ROLE_TERTIARY_PROGRESSION_ACTOR
    ),
    astrocart_spec.TECHNIQUE_SOLAR_ARC: astrocart_spec.ROLE_SOLAR_ARC_ACTOR,
    astrocart_spec.TECHNIQUE_LEWIS_CCG: astrocart_spec.ROLE_TRANSIT_ACTOR,
}

ASTROCART_LAYER_TRANSIT = "transit"
ASTROCART_LAYER_PROGRESSION = "progression"
ASTROCART_DYNAMIC_SOURCE = "canonical_supplementary"
ASTROCART_TRANSIT_GEOMETRY_SOURCE = "map_ephemeris"
ASTROCART_LEWIS_CCG_SOURCE = "lewis_ccg"
LEWIS_CCG_PUBLIC_KIND = "lewis-ccg"
# US 4,304,554: "the Sun, the Moon, Mercury, Venus, and Mars are progressed".
LEWIS_CCG_PROGRESSED_BODY_IDS = frozenset((
    astrology.SE_SUN,
    astrology.SE_MOON,
    astrology.SE_MERCURY,
    astrology.SE_VENUS,
    astrology.SE_MARS,
))
TROPICAL_YEAR_DAYS = 365.24219


@dataclass(frozen=True)
class DynamicAstrocartResult:
    """One computed moving layer and its source/terrestrial time contract."""

    layer: astrocart_spec.AstrocartDynamicLayer
    public_kind: str
    layer_kind: str
    layer_id: str
    target_jd_ut: float
    frame_jd_ut: float
    source_chart_jd_ut: float
    actor_points: tuple[astrocart.ACGPoint, ...]
    skipped_actor_ids: tuple[str, ...]
    acg_result: astrocart.ACGResult
    # Lewis CCG mixes progressed and transiting actors in one layer.
    progressed_actor_ids: frozenset[str] = frozenset()
    frame_offset_deg: float = 0.0

    @property
    def selected_actor_ids(self) -> tuple[str, ...]:
        return tuple(point.id for point in self.actor_points)

    @property
    def symbolic_jd_ut(self) -> float:
        """Compatibility name for the derived source chart's Julian day."""
        return self.source_chart_jd_ut

    def to_geojson(self) -> dict[str, Any]:
        """Return layer-filterable GeoJSON without changing ACG geometry."""
        payload = self.acg_result.to_geojson()
        if self.layer.technique == astrocart_spec.TECHNIQUE_TRANSIT:
            geometry_source = ASTROCART_TRANSIT_GEOMETRY_SOURCE
        elif self.layer.technique == astrocart_spec.TECHNIQUE_LEWIS_CCG:
            geometry_source = ASTROCART_LEWIS_CCG_SOURCE
        else:
            geometry_source = ASTROCART_DYNAMIC_SOURCE
        feature_metadata = {
            "astrocart_layer": self.layer_kind,
            "astrocart_technique": self.layer.technique,
            "astrocart_layer_id": self.layer_id,
            "astrocart_source_document_id": self.layer.source_document_id,
            "astrocart_cursor_iso": self.layer.cursor_iso,
            "astrocart_source": geometry_source,
            "astrocart_source_kind": self.public_kind,
            "astrocart_target_jd_ut": self.target_jd_ut,
            "astrocart_frame_jd_ut": self.frame_jd_ut,
            "astrocart_source_chart_jd_ut": self.source_chart_jd_ut,
        }
        for feature in payload.get("features", ()):
            if not isinstance(feature, dict):
                continue
            properties = feature.setdefault("properties", {})
            if isinstance(properties, dict):
                properties.update(feature_metadata)
                if self.layer.technique == astrocart_spec.TECHNIQUE_LEWIS_CCG:
                    # Each CCG line keeps its own motion kind so the map's
                    # transit/progression visibility and labels stay truthful.
                    progressed = properties.get("point") in self.progressed_actor_ids
                    properties["astrocart_layer"] = (
                        ASTROCART_LAYER_PROGRESSION if progressed
                        else ASTROCART_LAYER_TRANSIT
                    )
                    properties["astrocart_technique"] = (
                        astrocart_spec.TECHNIQUE_SECONDARY_PROGRESSION if progressed
                        else astrocart_spec.TECHNIQUE_TRANSIT
                    )

        metadata = payload.setdefault("metadata", {})
        if isinstance(metadata, dict):
            metadata["dynamic_layer"] = {
                "id": self.layer_id,
                "source_document_id": self.layer.source_document_id,
                "layer": self.layer_kind,
                "technique": self.layer.technique,
                "cursor_iso": self.layer.cursor_iso,
                "source": geometry_source,
                "source_kind": self.public_kind,
                "target_jd_ut": self.target_jd_ut,
                "frame_jd_ut": self.frame_jd_ut,
                "source_chart_jd_ut": self.source_chart_jd_ut,
                "actor_ids": list(self.selected_actor_ids),
                "skipped_actor_ids": list(self.skipped_actor_ids),
            }
            if self.layer.technique == astrocart_spec.TECHNIQUE_LEWIS_CCG:
                metadata["dynamic_layer"].update({
                    "progressed_actor_ids": sorted(self.progressed_actor_ids),
                    "progressed_angles": self.layer.progressed_angles,
                    "frame_offset_deg": self.frame_offset_deg,
                })
        return payload


@dataclass(frozen=True)
class _CursorContext:
    build_when: datetime.datetime
    target_jd_ut: float
    binding_payload: dict[str, Any]


def _parse_cursor(cursor_iso: str) -> datetime.datetime:
    raw = str(cursor_iso).strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    return datetime.datetime.fromisoformat(raw)


def _time_context_payload(time_obj: Any) -> dict[str, Any]:
    return {
        "cal": int(getattr(time_obj, "cal", chart_mod.Time.GREGORIAN)),
        "zt": int(getattr(time_obj, "zt", chart_mod.Time.ZONE)),
        "plus": bool(getattr(time_obj, "plus", True)),
        "zh": int(getattr(time_obj, "zh", 0) or 0),
        "zm": int(getattr(time_obj, "zm", 0) or 0),
        "daylight": bool(getattr(time_obj, "daylightsaving", False)),
        "tzid": str(getattr(time_obj, "tzid", "") or ""),
        "tzauto": bool(getattr(time_obj, "tzauto", False)),
    }


def _cursor_context(radix: Any, cursor_iso: str) -> _CursorContext:
    parsed = _parse_cursor(cursor_iso)
    base_time = radix.time

    # An offset-bearing ISO value names an absolute instant.  The normalized
    # map spec stores those in UTC, so build the supplementary chart in
    # Greenwich semantics.  A naive value is a civil cursor and inherits the
    # radix calendar/time-zone/place contract, matching the Transit adapter.
    if parsed.tzinfo is not None:
        build_when = parsed.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        target_time = chart_mod.Time(
            build_when.year,
            build_when.month,
            build_when.day,
            build_when.hour,
            build_when.minute,
            build_when.second,
            False,
            int(getattr(base_time, "cal", chart_mod.Time.GREGORIAN)),
            chart_mod.Time.GREENWICH,
            True,
            0,
            0,
            False,
            radix.place,
            False,
        )
    else:
        build_when = parsed
        target_time = chart_mod.Time(
            build_when.year,
            build_when.month,
            build_when.day,
            build_when.hour,
            build_when.minute,
            build_when.second,
            False,
            int(getattr(base_time, "cal", chart_mod.Time.GREGORIAN)),
            int(getattr(base_time, "zt", chart_mod.Time.ZONE)),
            bool(getattr(base_time, "plus", True)),
            int(getattr(base_time, "zh", 0) or 0),
            int(getattr(base_time, "zm", 0) or 0),
            bool(getattr(base_time, "daylightsaving", False)),
            radix.place,
            False,
            tzid=str(getattr(base_time, "tzid", "") or ""),
            tzauto=bool(getattr(base_time, "tzauto", False)),
        )

    return _CursorContext(
        build_when=build_when,
        target_jd_ut=float(target_time.jd),
        binding_payload={"retained_state": _time_context_payload(target_time)},
    )


def _body_from_planet_container(derived_chart: Any, body_id: int) -> Any | None:
    container = getattr(getattr(derived_chart, "planets", None), "planets", ())
    for body in tuple(container or ()):
        try:
            if int(getattr(body, "pId")) == int(body_id):
                return body
        except (AttributeError, TypeError, ValueError):
            continue
    return None


def _body_from_asteroid_container(derived_chart: Any, body_id: int) -> Any | None:
    container = getattr(getattr(derived_chart, "asteroids", None), "asteroids", ())
    for body in tuple(container or ()):
        try:
            if int(getattr(body, "aId")) == int(body_id):
                return body
        except (AttributeError, TypeError, ValueError):
            continue
    return None


def _ephemeris_body(derived_chart: Any, body_id: int) -> Any | None:
    body = _body_from_planet_container(derived_chart, body_id)
    if body is not None:
        return body
    chiron = getattr(derived_chart, "chiron", None)
    try:
        if chiron is not None and int(getattr(chiron, "pId")) == int(body_id):
            return chiron
    except (AttributeError, TypeError, ValueError):
        pass
    return _body_from_asteroid_container(derived_chart, body_id)


def _selected_ecliptic(body: Any) -> tuple[float, float] | None:
    data = getattr(body, "data", None)
    try:
        longitude = float(data[planets.Planet.LONG])
        latitude = float(data[planets.Planet.LAT])
    except (IndexError, TypeError, ValueError):
        return None
    if not (isfinite(longitude) and isfinite(latitude)):
        return None
    return longitude, latitude


def _selected_equatorial(body: Any) -> tuple[float, float] | None:
    """Read the supplementary chart's canonical RA/declination representation.

    Planet, Chiron, and node objects expose ``dataEqu``. The compact Asteroid
    owner instead stores RA/declination in ``data[2:4]``; only rows carrying an
    ``aId`` use that fallback so an ordinary planet's distance/speed slots can
    never be mistaken for equatorial coordinates.
    """
    data_equ = getattr(body, "dataEqu", None)
    try:
        ra = float(data_equ[planets.Planet.RAEQU])
        declination = float(data_equ[planets.Planet.DECLEQU])
    except (IndexError, TypeError, ValueError):
        pass
    else:
        if isfinite(ra) and isfinite(declination):
            return ra % 360.0, declination

    if getattr(body, "aId", None) is None:
        return None
    data = getattr(body, "data", None)
    try:
        ra = float(data[2])
        declination = float(data[3])
    except (IndexError, TypeError, ValueError):
        return None
    if not (isfinite(ra) and isfinite(declination)):
        return None
    return ra % 360.0, declination


def _moving_point(
    record: astrocart_spec.AstrocartPointRecord,
    derived_chart: Any,
) -> astrocart.ACGPoint | None:
    motion_ref = record.motion_reference
    ref_kind = str(motion_ref.get("kind") or "")
    antipode = bool(record.acg_point.antipode)

    if ref_kind == "ephemerisBody":
        try:
            body_id = int(motion_ref["bodyId"])
        except (KeyError, TypeError, ValueError):
            return None
        body = _ephemeris_body(derived_chart, body_id)
    elif ref_kind == "logicalNode":
        try:
            body_id = int(motion_ref["bodyId"])
        except (KeyError, TypeError, ValueError):
            return None
        body = _body_from_planet_container(derived_chart, body_id)
        antipode = str(motion_ref.get("axis") or "north").lower() == "south"
    else:
        # Fixed stars and structural/chart-derived point families never become
        # moving actors by approximation.  Their capability cells are explicit.
        return None

    selected = _selected_ecliptic(body)
    if selected is None:
        return None
    selected_equatorial = _selected_equatorial(body)
    if selected_equatorial is None:
        # Dynamic in-mundo geometry must come from the canonical
        # supplementary chart, never a target-date reprojection fallback.
        return None
    selected_lon, physical_lat = selected
    tropical_lon = util.to_tropical_lon(
        selected_lon,
        float(getattr(derived_chart, "ayanamsha_offset", 0.0) or 0.0),
    )
    source_point = record.acg_point
    return astrocart.ACGPoint(
        id=record.semantic_id,
        label=record.label,
        kind=source_point.kind,
        ecliptic=(float(tropical_lon), float(physical_lat)),
        antipode=antipode,
        color_hex=source_point.color_hex,
        equatorial=selected_equatorial,
    )


def _layer_kind(technique: str) -> str:
    return (
        ASTROCART_LAYER_TRANSIT
        if technique == astrocart_spec.TECHNIQUE_TRANSIT
        else ASTROCART_LAYER_PROGRESSION
    )


def _stable_layer_id(
    layer: astrocart_spec.AstrocartDynamicLayer,
    actor_ids: Iterable[str],
) -> str:
    if layer.source_document_id:
        digest = sha256(layer.source_document_id.encode("utf-8")).hexdigest()[:16]
        return f"{_layer_kind(layer.technique)}:{layer.technique}:{digest}"
    identity = json.dumps(
        {
            "technique": layer.technique,
            "cursor": layer.cursor_iso,
            "actors": sorted(str(actor_id) for actor_id in actor_ids),
        },
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = sha256(identity.encode("utf-8")).hexdigest()[:16]
    return f"{_layer_kind(layer.technique)}:{layer.technique}:{digest}"


def compute_dynamic_layer(
    radix: Any,
    catalog: astrocart_spec.AstrocartPointCatalog,
    layer: astrocart_spec.AstrocartDynamicLayer,
    *,
    coordinate_system: str = astrocart_spec.COORDINATE_IN_MUNDO,
    kinds: Iterable[str] = astrocart.ALL_KINDS,
    include_parans: bool = False,
    include_zenith_markers: bool = False,
    lat_range: tuple[float, float] = (
        -astrocart.GEOGRAPHIC_LAT_LIMIT,
        astrocart.GEOGRAPHIC_LAT_LIMIT,
    ),
    step_deg: float = 1.0,
    iflag: int = astrology.SEFLG_SWIEPH,
    horizon_error_meters: float = astrocart.HORIZON_CHORD_ERROR_METERS,
    paran_scan_step_deg: float = astrocart.PARAN_SCAN_STEP_DEG,
    geodetic_meridian_lon: float | None = None,
    supplementary_builder: Any | None = None,
    source_chart: Any | None = None,
) -> DynamicAstrocartResult | None:
    """Compute one enabled, normalized moving Astrocart layer.

    ``None`` means the layer is intentionally inert: it is disabled, invalid,
    has no cursor/actors, has no technique-capable actors, or the canonical
    supplementary builder could not materialize any selected actor.
    """
    if not isinstance(layer, astrocart_spec.AstrocartDynamicLayer):
        return None
    if (
        not layer.enabled
        or layer.cursor_iso is None
        or not layer.selected_actor_ids
        or layer.technique not in DYNAMIC_ROLE
    ):
        return None
    if coordinate_system not in astrocart_spec.COORDINATE_SYSTEMS:
        return None

    role = DYNAMIC_ROLE[layer.technique]
    requested = set(layer.selected_actor_ids)
    capable_records = tuple(
        record
        for record in catalog.records
        if record.semantic_id in requested and record.capability(role).supported
    )
    if not capable_records:
        return None

    try:
        cursor = _cursor_context(radix, layer.cursor_iso)
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None

    try:
        frame_jd_ut = float(radix.time.jd)
    except (AttributeError, TypeError, ValueError):
        return None

    if layer.technique == astrocart_spec.TECHNIQUE_LEWIS_CCG:
        return _compute_lewis_ccg_layer(
            layer,
            capable_records,
            requested,
            cursor=cursor,
            frame_jd_ut=frame_jd_ut,
            coordinate_system=coordinate_system,
            geodetic_meridian_lon=geodetic_meridian_lon,
            compute_kwargs={
                "kinds": tuple(kinds),
                "lat_range": lat_range,
                "step_deg": step_deg,
                "iflag": iflag,
                "include_parans": bool(include_parans),
                "horizon_error_meters": horizon_error_meters,
                "paran_scan_step_deg": paran_scan_step_deg,
                "include_zenith_markers": bool(include_zenith_markers),
            },
        )

    public_kind = DYNAMIC_PUBLIC_KIND[layer.technique]
    if source_chart is None:
        builder = supplementary_builder or canonical_supplementary_service
        supplementary = builder.build_result(
            radix=radix,
            kind=public_kind,
            when=cursor.build_when,
            binding_payload=cursor.binding_payload,
        )
        derived_chart = (
            supplementary.get("chart")
            if isinstance(supplementary, dict)
            else getattr(supplementary, "chart", None)
        )
    else:
        derived_chart = source_chart
    if derived_chart is None:
        raise RuntimeError(
            f"Canonical supplementary builder returned no chart for {public_kind!r}"
        )

    actor_points: list[astrocart.ACGPoint] = []
    unavailable: set[str] = set(requested)
    for record in capable_records:
        point = _moving_point(record, derived_chart)
        if point is None:
            continue
        if layer.technique == astrocart_spec.TECHNIQUE_TRANSIT:
            # Ordinary ACG resolves bodies from the geocentric ephemeris at
            # the map instant. A transit chart can carry observer-specific
            # coordinates; reusing those here displaces its lines from natal
            # ACG even when the two instants are identical.
            point = record.acg_point
        actor_points.append(point)
        unavailable.discard(record.semantic_id)
    compute_kwargs = {
        "points": tuple(actor_points),
        "kinds": tuple(kinds),
        "lat_range": lat_range,
        "step_deg": step_deg,
        "iflag": iflag,
        "include_parans": bool(include_parans),
        "horizon_error_meters": horizon_error_meters,
        "paran_scan_step_deg": paran_scan_step_deg,
        "include_zenith_markers": bool(include_zenith_markers),
        "frame_jd_ut": frame_jd_ut,
    }
    if geodetic_meridian_lon is not None:
        acg_result = astrocart.compute_geodetic_acg(
            cursor.target_jd_ut,
            meridian_lon=float(geodetic_meridian_lon),
            **compute_kwargs,
        )
    else:
        compute = (
            astrocart.compute_zodiacal_acg
            if coordinate_system == astrocart_spec.COORDINATE_ZODIACAL
            else astrocart.compute_acg
        )
        acg_result = compute(
            cursor.target_jd_ut,
            **compute_kwargs,
        )
    try:
        source_chart_jd_ut = float(derived_chart.time.jd)
    except (AttributeError, TypeError, ValueError) as exc:
        raise RuntimeError(
            f"Canonical supplementary chart for {public_kind!r} has no Julian day"
        ) from exc

    actor_tuple = tuple(actor_points)
    return DynamicAstrocartResult(
        layer=layer,
        public_kind=public_kind,
        layer_kind=_layer_kind(layer.technique),
        layer_id=_stable_layer_id(layer, layer.selected_actor_ids),
        target_jd_ut=cursor.target_jd_ut,
        frame_jd_ut=frame_jd_ut,
        source_chart_jd_ut=source_chart_jd_ut,
        actor_points=actor_tuple,
        skipped_actor_ids=tuple(sorted(unavailable)),
        acg_result=acg_result,
    )


def _lewis_ccg_progressed_jd(radix_jd_ut: float, target_jd_ut: float) -> float:
    """Secondary progression: one day of actual motion per year of life."""
    return radix_jd_ut + (target_jd_ut - radix_jd_ut) / TROPICAL_YEAR_DAYS


def _is_lewis_ccg_progressed(record: astrocart_spec.AstrocartPointRecord) -> bool:
    motion_ref = record.motion_reference
    if str(motion_ref.get("kind") or "") != "ephemerisBody":
        return False
    try:
        return int(motion_ref["bodyId"]) in LEWIS_CCG_PROGRESSED_BODY_IDS
    except (KeyError, TypeError, ValueError):
        return False


def _ephemeris_actor(
    record: astrocart_spec.AstrocartPointRecord,
    jd_ut: float,
    iflag: int,
) -> astrocart.ACGPoint | None:
    """Freeze a catalog body's geocentric position at ``jd_ut``."""
    source_point = record.acg_point
    try:
        ecliptic = astrocart.resolve_ecliptic(source_point, jd_ut, iflag)
        equatorial = astrocart.resolve_equatorial(source_point, jd_ut, iflag)
    except Exception:
        return None
    return astrocart.ACGPoint(
        id=record.semantic_id,
        label=record.label,
        kind=source_point.kind,
        ecliptic=ecliptic,
        color_hex=source_point.color_hex,
        equatorial=equatorial,
    )


def _lewis_ccg_frame_offset(radix_jd_ut: float, progressed_jd_ut: float, iflag: int) -> float:
    """Progressed Sun's arc in right ascension (Lewis's progressed angles)."""
    sun = astrocart.ACGPoint(id="lewis-ccg-sun", label="Sun", body_id=astrology.SE_SUN)
    natal_ra, _dec = astrocart.resolve_equatorial(sun, radix_jd_ut, iflag)
    progressed_ra, _dec = astrocart.resolve_equatorial(sun, progressed_jd_ut, iflag)
    return ((progressed_ra - natal_ra + 180.0) % 360.0) - 180.0


def _compute_lewis_ccg_layer(
    layer: astrocart_spec.AstrocartDynamicLayer,
    capable_records: tuple[astrocart_spec.AstrocartPointRecord, ...],
    requested: set[str],
    *,
    cursor: _CursorContext,
    frame_jd_ut: float,
    coordinate_system: str,
    geodetic_meridian_lon: float | None,
    compute_kwargs: dict[str, Any],
) -> DynamicAstrocartResult | None:
    iflag = int(compute_kwargs["iflag"])
    target_jd_ut = cursor.target_jd_ut
    progressed_jd_ut = _lewis_ccg_progressed_jd(frame_jd_ut, target_jd_ut)
    actor_points: list[astrocart.ACGPoint] = []
    progressed_ids: set[str] = set()
    unavailable: set[str] = set(requested)
    for record in capable_records:
        progressed = _is_lewis_ccg_progressed(record)
        point = _ephemeris_actor(
            record,
            progressed_jd_ut if progressed else target_jd_ut,
            iflag,
        )
        if point is None:
            continue
        actor_points.append(point)
        unavailable.discard(record.semantic_id)
        if progressed:
            progressed_ids.add(record.semantic_id)
    if not actor_points:
        return None

    frame_offset_deg = (
        _lewis_ccg_frame_offset(frame_jd_ut, progressed_jd_ut, iflag)
        if layer.progressed_angles
        else 0.0
    )
    points = tuple(actor_points)
    if geodetic_meridian_lon is not None:
        acg_result = astrocart.compute_geodetic_acg(
            target_jd_ut,
            points=points,
            meridian_lon=float(geodetic_meridian_lon),
            frame_jd_ut=frame_jd_ut,
            frame_offset_deg=frame_offset_deg,
            **compute_kwargs,
        )
    else:
        compute = (
            astrocart.compute_zodiacal_acg
            if coordinate_system == astrocart_spec.COORDINATE_ZODIACAL
            else astrocart.compute_acg
        )
        acg_result = compute(
            target_jd_ut,
            points=points,
            frame_jd_ut=frame_jd_ut,
            frame_offset_deg=frame_offset_deg,
            **compute_kwargs,
        )
    return DynamicAstrocartResult(
        layer=layer,
        public_kind=LEWIS_CCG_PUBLIC_KIND,
        layer_kind=ASTROCART_LAYER_TRANSIT,
        layer_id=_stable_layer_id(layer, layer.selected_actor_ids),
        target_jd_ut=target_jd_ut,
        frame_jd_ut=frame_jd_ut,
        source_chart_jd_ut=progressed_jd_ut,
        actor_points=points,
        skipped_actor_ids=tuple(sorted(unavailable)),
        acg_result=acg_result,
        progressed_actor_ids=frozenset(progressed_ids),
        frame_offset_deg=frame_offset_deg,
    )


def dynamic_layer_geojson(*args: Any, **kwargs: Any) -> dict[str, Any] | None:
    """Convenience boundary for services that only need filtered GeoJSON."""
    result = compute_dynamic_layer(*args, **kwargs)
    return result.to_geojson() if result is not None else None
