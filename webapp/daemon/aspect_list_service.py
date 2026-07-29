# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Canonical rows and exact-perfection events for the retained Aspect List.

Technique membership comes from the complete semantic point registry, never
from wheel/display visibility.  The exporter still supplies shared point
metadata where useful; this service owns aspect-list pairing, phase, and exact
perfection for both single-chart and interchart views.
"""
from __future__ import annotations

import datetime
import hashlib
import math
from types import SimpleNamespace
from typing import Any

import astrology
import arabicparts
import chart
import common
import dateformat
import searchbackend
import util
import fortune
import houses
import mtexts
import planets

from aries.astrology.transit_fast import api as transit_fast_api
from engine import aspect_motion, moment, synodic_cycle
from webapp.daemon.primdir_points import PRIMDIR_ANGLE_LABEL_KEYS
from webapp.daemon.display_palette import (
    aspect_color_role,
    chart_body_color_role,
    effective_display_options,
    object_glyph_color,
    object_glyph_color_role,
)
from webapp.daemon import inspector_service
from webapp.frontend.scripts import export_chart_json


ASPECT_LIST_MODES = (
    "primary",
    "outer",
    "outerToPrimary",
    "primaryToOuter",
)

_PLANET_BY_KEY = {
    key: planet_id for planet_id, key in export_chart_json.PLANET_ID_MAP.items()
}


def _is_node_aspect_key(key: str) -> bool:
    return str(key) in ("nnode", "snode")
_ASPECT_NAME_KEYS = (
    "Conjunctio",
    "Semisextil",
    "Semiquadrat",
    "Sextil",
    "Quintile",
    "Quadrat",
    "Trigon",
    "Sesquiquadrat",
    "Biquintile",
    "Quinqunx",
    "Oppositio",
    "Septile",
    "Parallel",
    "Contraparallel",
)
_ENDPOINT_SORT_ORDER = {
    key: index
    for index, key in enumerate(
        (
            "sun", "moon", "mercury", "venus", "mars", "jupiter",
            "saturn", "uranus", "neptune", "pluto", "nnode", "snode",
            "chiron",
        )
    )
}
_ENDPOINT_SORT_ORDER.update({
    "asc": 30,
    "dsc": 31,
    "mc": 32,
    "ic": 33,
    "fortune": 40,
    "vertex": 41,
    "syzygy": 42,
})
_RING_POINT_SORT_ORDER = {
    # Optional Swiss bodies remain bodies: after the standard matrix, before
    # structural/chart-derived points.
    "ephemerisBody": 20,
    "angleSource": 30,
    "fortune": 40,
    "midpoint": 50,
    "projection": 55,
    "arabicPart": 60,
    "fixedPoint": 80,
    "fixedStar": 90,
}
_ANGLE_LABEL_KEY_BY_ID = dict(
    zip(("asc", "dsc", "mc", "ic"), PRIMDIR_ANGLE_LABEL_KEYS)
)
# Exact search has no product-level year horizon.  Fast Swiss-body searches may
# walk to the common ephemeris boundary; semantic/rebuilt trajectories retain
# only a calculation-budget guard so a malformed or asymptotic evaluator cannot
# occupy the daemon forever.
_FAST_PERFECTION_MIN_JD = 625000.5
_FAST_PERFECTION_MAX_JD = 3419437.5
_MAX_PERFECTION_SEARCH_ITERATIONS = 100000
_MAX_PERFECTION_BATCH_ROWS = 16
_EXACT_CALC_ORB_DEGREES = 1.0e-8
# Symbolic builders consume a civil/signified cursor but may materialize the
# derived ephemeris chart at a coarser resolution.  Secondary progressions are
# the important example: roughly six civil minutes are needed to advance the
# progressed ephemeris by one whole second.  A fixed one-minute derivative
# therefore reports false zero motion for planet pairs while progressed angles
# (which retain fractional geometry) still move.  Probe outward only until the
# same-regime relationship changes; the shared evaluator cache keeps this
# bounded ladder cheap across all rows in one payload/batch.
_RELATION_PROBE_DAYS = (
    1.0 / 1440.0,  # one minute
    5.0 / 1440.0,
    10.0 / 1440.0,
    30.0 / 1440.0,
    1.0 / 24.0,
    6.0 / 24.0,
    1.0,
    7.0,
    30.0,
)
_RELATION_ERROR_DELTA_EPSILON = 1.0e-10
_REBUILT_RELATION_ERROR_DELTA_EPSILON = 1.0e-5
_PHYSICAL_PERFECTION_ZERO_EPSILON = 1.0e-7
_REBUILT_PERFECTION_ZERO_EPSILON = 1.0e-5


def _rgb_hex(value: Any) -> str | None:
    try:
        if len(value) < 3:
            return None
        return "#%02x%02x%02x" % tuple(
            max(0, min(255, int(round(float(channel))))) for channel in value[:3]
        )
    except Exception:
        return None


def _aspect_metadata(display_options, aspect_type: int) -> dict[str, Any]:
    glyph, glyph_font = common.common.aspect_glyph(aspect_type)
    try:
        color_value = display_options.clraspect[aspect_type]
    except Exception:
        color_value = getattr(display_options, "clrtexts", None)
    color = _rgb_hex(color_value)
    name_key = _ASPECT_NAME_KEYS[aspect_type] if 0 <= aspect_type < len(_ASPECT_NAME_KEYS) else None
    return {
        "type": int(aspect_type),
        "glyph": glyph,
        "glyphFont": glyph_font,
        "name": str(mtexts.txts.get(name_key, name_key or aspect_type)),
        "color": color,
        "colorRole": aspect_color_role(
            display_options,
            aspect_type,
            resolved_color=color_value,
        ),
    }


def _body_motion_marker(chrt, body_id: int, speed_lon: Any) -> str:
    """Return the chart's canonical SR/SD-over-R/S marker for one body."""
    try:
        return str(inspector_service._motion_marker(
            chrt,
            int(body_id),
            None if speed_lon is None else float(speed_lon),
            chrt.options,
            False,
        ) or "")
    except Exception:
        try:
            speed = float(speed_lon)
        except (TypeError, ValueError):
            return ""
        return "R" if speed < 0.0 else "S" if speed == 0.0 else ""


def _planet_metadata(chrt, key: str, role: str, display_options) -> dict[str, Any]:
    planet_id = _PLANET_BY_KEY[key]
    body = chrt.get_planet_body(planet_id)
    if body is None:
        raise ValueError(f"Missing aspect-list planet body: {planet_id}")
    dignity = chart.Chart.PEREGRIN
    try:
        dignity = int(chrt.dignity(planet_id))
    except Exception:
        pass
    obj = SimpleNamespace(id=f"planet:{planet_id}", planet_index=planet_id)
    fallback = getattr(display_options, "clrperegrin", None)
    color_value = object_glyph_color(
        display_options,
        obj,
        dignity,
        fallback=fallback,
    )
    color = _rgb_hex(color_value)
    return {
        "key": key,
        "role": role,
        "objectType": "planet",
        "planetId": int(planet_id),
        "sortOrder": _ENDPOINT_SORT_ORDER.get(key, 999),
        "glyph": common.common.get_planet_glyph(planet_id),
        "glyphFont": "morinus",
        "name": export_chart_json.planet_display_label(planet_id, chrt.options),
        "color": color,
        "colorRole": object_glyph_color_role(
            display_options,
            obj,
            dignity,
            resolved_color=color_value,
        ),
        "filterIds": [f"planet:{key}"],
        "longitude": float(body.data[planets.Planet.LONG]),
        "motionMarker": _body_motion_marker(
            chrt,
            planet_id,
            body.data[planets.Planet.SPLON],
        ),
        "motionRef": {"kind": "planet", "bodyId": int(planet_id)},
    }


def _point_metadata(chrt, key: str, role: str, display_options) -> dict[str, Any]:
    if key == "dc":
        key = "dsc"
    if key in ("asc", "dsc", "mc", "ic"):
        color_value = getattr(display_options, "clrtexts", None)
        label_key = _ANGLE_LABEL_KEY_BY_ID[key]
        try:
            if key == "asc":
                longitude = float(chrt.houses.ascmc[houses.Houses.ASC])
            elif key == "dsc":
                longitude = util.normalize(float(chrt.houses.ascmc[houses.Houses.ASC]) + 180.0)
            elif key == "mc":
                longitude = float(chrt.houses.ascmc[houses.Houses.MC])
            else:
                longitude = util.normalize(float(chrt.houses.ascmc[houses.Houses.MC]) + 180.0)
        except Exception:
            longitude = 0.0
        return {
            "key": key,
            "role": role,
            "objectType": "angle",
            "planetId": None,
            "sortOrder": _ENDPOINT_SORT_ORDER.get(key, 999),
            # Directions writes structural angles as names rather than chart
            # glyphs.  Aspect List uses the same compact list convention.
            "glyph": "",
            "glyphFont": "text",
            "name": str(mtexts.txts.get(label_key, key.upper())),
            "color": _rgb_hex(color_value),
            "colorRole": "--morinus-text-bright",
            "filterIds": ["angles"],
            "longitude": longitude,
            "motionRef": {"kind": "angleSource", "angle": key},
        }

    is_fortune = key == "fortune"
    is_syzygy = key == "syzygy"
    color_value = getattr(display_options, "clrperegrin", None)
    if is_fortune:
        obj = SimpleNamespace(id="point:lof", planet_index=None)
        color_value = object_glyph_color(
            display_options,
            obj,
            chart.Chart.PEREGRIN,
            fallback=color_value,
        )
        color_role = object_glyph_color_role(
            display_options,
            obj,
            chart.Chart.PEREGRIN,
            resolved_color=color_value,
        )
        glyph = common.common.fortune
        name = str(mtexts.txts.get("LotOfFortune", "Lot of Fortune"))
        object_type = "fortune"
        longitude = float(chrt.fortune.fortune[fortune.Fortune.LON])
        motion_ref = {"kind": "fortune"}
    elif is_syzygy:
        color_value = getattr(display_options, "clrsigns", color_value)
        color_role = "--morinus-text-bright"
        glyph = "Sy"
        name = str(mtexts.txts.get("Syzygy", "Syzygy"))
        object_type = "syzygy"
        longitude = float(export_chart_json._ensure_syzygy_lon(chrt))
        motion_ref = {"kind": "syzygy"}
    else:
        color_role = chart_body_color_role(
            display_options,
            chrt,
            None,
            is_vertex=True,
            resolved_color=color_value,
        )
        glyph = common.common.Vertex
        name = str(mtexts.txts.get("Vertex", "Vertex"))
        object_type = "vertex"
        longitude = float(chrt.houses.ascmc[houses.Houses.VERTEX])
        motion_ref = {"kind": "angleSource", "angle": "vertex"}
    return {
        "key": key,
        "role": role,
        "objectType": object_type,
        "planetId": None,
        "sortOrder": _ENDPOINT_SORT_ORDER.get(key, 999),
        "glyph": glyph,
        "glyphFont": "text" if is_syzygy else "morinus",
        "name": name,
        "color": _rgb_hex(color_value),
        "colorRole": color_role,
        "filterIds": [f"point:{key}"],
        "longitude": longitude,
        "motionRef": motion_ref,
    }


def _motion_ref_planet_id(motion_ref: Any) -> int | None:
    """Resolve the canonical source body behind a planet-like ring point."""
    ref = motion_ref if isinstance(motion_ref, dict) else {}
    for _depth in range(8):
        kind = str(ref.get("kind") or "")
        if kind in ("planet", "ephemerisBody"):
            try:
                return int(ref["bodyId"])
            except (KeyError, TypeError, ValueError):
                return None
        if kind != "projection":
            return None
        source = ref.get("source")
        if not isinstance(source, dict):
            return None
        ref = source
    return None


def _ring_item_planet_glyph(item: dict[str, Any], source_planet_id: int | None) -> str:
    for segment in item.get("segments") or ():
        if (
            isinstance(segment, dict)
            and str(segment.get("kind") or "") in ("planet", "glyph")
            and segment.get("text")
        ):
            return str(segment["text"])
    glyph_source = getattr(common, "common", None)
    if glyph_source is None or source_planet_id is None:
        return ""
    try:
        return str(glyph_source.get_planet_glyph(source_planet_id) or "")
    except (AttributeError, IndexError, KeyError, TypeError, ValueError):
        return ""


def _ring_point_metadata(
    item: dict[str, Any],
    role: str,
    display_options,
    *,
    chrt=None,
) -> dict[str, Any]:
    family = str(item.get("family") or "point")
    semantic_id = str(item.get("semanticId") or item.get("id") or item.get("label") or family)
    key = f"point:{role}:{family}:{semantic_id}"
    motion_ref = item.get("motionRef")
    motion_kind = str((motion_ref or {}).get("kind") or "")
    source_planet_id = _motion_ref_planet_id(motion_ref)
    glyph = _ring_item_planet_glyph(item, source_planet_id)
    display_segments = export_chart_json.ring_item_display_segments(item)
    sort_order = _RING_POINT_SORT_ORDER.get(motion_kind)
    if sort_order is None:
        sort_order = 90 if family == "fixstar" else 70
    source_speed = item.get("speed")
    if chrt is not None and source_planet_id is not None:
        try:
            source_body = chrt.get_planet_body(source_planet_id)
        except (AttributeError, TypeError, ValueError):
            source_body = None
        if source_body is not None:
            source_speed = source_body.data[planets.Planet.SPLON]
    motion_marker = (
        _body_motion_marker(chrt, source_planet_id, source_speed)
        if chrt is not None and source_planet_id is not None
        else ""
    )
    return {
        "key": key,
        "role": role,
        "objectType": "outerPoint",
        "planetId": None,
        "sortOrder": sort_order,
        "glyph": glyph,
        "glyphFont": "morinus" if glyph else "text",
        "name": str(item.get("listLabel") or item.get("label") or family),
        "displayMarker": export_chart_json.ring_item_display_marker(item),
        "displaySegments": display_segments,
        "motionMarker": motion_marker,
        "longitude": float(item["longitude"]),
        "color": _rgb_hex(getattr(display_options, "clrtexts", None)),
        "colorRole": "--morinus-text-bright",
        "filterIds": [_secondary_ring_filter_id(role, family)],
        "family": family,
        "semanticId": semantic_id,
        "motionRef": motion_ref,
        "speed": float(item.get("speed", 0.0) or 0.0),
    }


def _endpoint_metadata(chrt, key: str, role: str, display_options) -> dict[str, Any]:
    if key == "dc":
        key = "dsc"
    if key in _PLANET_BY_KEY:
        return _planet_metadata(chrt, key, role, display_options)
    if key in ("asc", "dsc", "mc", "ic", "fortune", "vertex", "syzygy"):
        return _point_metadata(chrt, key, role, display_options)
    raise ValueError(f"Unsupported aspect-list endpoint: {key}")


def _motion_body(chrt, key: str, role: str) -> dict[str, Any] | None:
    if key == "dc":
        key = "dsc"
    if key in _PLANET_BY_KEY:
        planet_id = _PLANET_BY_KEY[key]
        body = chrt.get_planet_body(planet_id)
        if body is None:
            return None
        return {
            "kind": "planet",
            "index": planet_id,
            "lon": float(body.data[planets.Planet.LONG]),
            "speed": float(body.data[planets.Planet.SPLON]),
            "role": role,
            "motionRef": {"kind": "planet", "bodyId": int(planet_id)},
        }
    try:
        if key == "asc":
            lon = float(chrt.houses.ascmc[houses.Houses.ASC])
        elif key == "dsc":
            lon = util.normalize(float(chrt.houses.ascmc[houses.Houses.ASC]) + 180.0)
        elif key == "mc":
            lon = float(chrt.houses.ascmc[houses.Houses.MC])
        elif key == "ic":
            lon = util.normalize(float(chrt.houses.ascmc[houses.Houses.MC]) + 180.0)
        elif key == "vertex":
            lon = float(chrt.houses.ascmc[houses.Houses.VERTEX])
        elif key == "fortune":
            lon = float(chrt.fortune.fortune[fortune.Fortune.LON])
        elif key == "syzygy":
            lon = float(export_chart_json._ensure_syzygy_lon(chrt))
        else:
            return None
    except Exception:
        return None
    motion_ref = (
        {"kind": "fortune"}
        if key == "fortune"
        else {"kind": "syzygy"}
        if key == "syzygy"
        else {"kind": "angleSource", "angle": key}
    )
    return {
        "kind": "point",
        "index": key,
        "lon": lon,
        "speed": 0.0,
        "role": role,
        "motionRef": motion_ref,
    }


def _motion_endpoint(chrt, endpoint: dict[str, Any]) -> dict[str, Any] | None:
    if endpoint.get("objectType") == "outerPoint":
        try:
            motion_ref = endpoint.get("motionRef")
            motion_kind = str((motion_ref or {}).get("kind") or "")
            return {
                "kind": "planet" if motion_kind == "ephemerisBody" else "point",
                "index": (
                    int(motion_ref["bodyId"])
                    if motion_kind == "ephemerisBody"
                    else str(endpoint["key"])
                ),
                "lon": float(endpoint["longitude"]),
                "speed": float(endpoint.get("speed", 0.0) or 0.0),
                "role": str(endpoint["role"]),
                "motionRef": motion_ref,
            }
        except (KeyError, TypeError, ValueError):
            return None
    return _motion_body(chrt, str(endpoint["key"]), str(endpoint["role"]))


def _motion_is_logical_node(value: dict[str, Any]) -> bool:
    ref = value.get("motionRef") or {}
    try:
        return (
            str(ref.get("kind")) == "planet"
            and int(ref.get("bodyId"))
            in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE)
        )
    except (TypeError, ValueError):
        return False


def _phase_from_state(state: dict[str, Any] | None, exact: bool) -> str:
    if exact:
        return "exact"
    if state and state.get("is_applying"):
        return "applying"
    if state and state.get("is_separating"):
        return "separating"
    return "none"


def _endpoint_motion_ref(endpoint: dict[str, Any]) -> dict[str, Any] | None:
    ref = endpoint.get("motionRef")
    if isinstance(ref, dict) and ref.get("kind"):
        return ref
    if endpoint.get("planetId") is not None:
        return {"kind": "planet", "bodyId": int(endpoint["planetId"])}
    if endpoint.get("objectType") == "outerPoint":
        return None
    try:
        longitude = float(endpoint["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    return {
        "kind": "fixedPoint",
        "id": str(endpoint.get("key") or "point"),
        "longitude": longitude,
    }


def _frozen_sample(endpoint: dict[str, Any]) -> dict[str, Any] | None:
    try:
        longitude = float(endpoint["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    return {
        "longitude": util.normalize(longitude),
        "regime": ("frozen", str(endpoint.get("key") or "point")),
        "canAct": False,
        "valid": True,
    }


def _snapshot_motion_sample(chrt, ref: dict[str, Any]) -> dict[str, Any] | None:
    """Read one semantic endpoint from an already rebuilt canonical chart.

    Symbolic techniques cannot be sampled by asking Swiss Ephemeris for the
    candidate civil date: solar arc, progressions, profections and PD-in-Chart
    have transformed positions.  Their canonical builder has already produced
    the right chart, so sample that chart's stored bodies/points directly.
    """
    kind = str(ref.get("kind") or "")
    if kind in ("planet", "ephemerisBody"):
        try:
            body_id = int(ref["bodyId"])
        except (KeyError, TypeError, ValueError):
            return None
        body = chrt.get_planet_body(body_id)
        if body is not None:
            return {
                "longitude": util.normalize(float(body.data[planets.Planet.LONG])),
                "latitude": float(body.data[planets.Planet.LAT]),
                "speed": float(body.data[planets.Planet.SPLON]),
                "regime": ("rebuiltPlanet", body_id),
                "canAct": True,
                "valid": True,
            }
        # Optional asteroids are ring payloads rather than members of the fixed
        # planet matrix. Their exporter is the wheel's canonical position.
        try:
            for item in export_chart_json.export_asteroid_items(chrt):
                if item.get("motionRef") == ref:
                    return {
                        "longitude": util.normalize(float(item["longitude"])),
                        "speed": float(item.get("speed", 0.0) or 0.0),
                        "regime": ("rebuiltEphemerisBody", body_id),
                        "canAct": True,
                        "valid": True,
                    }
        except Exception:
            return None
        return None
    if kind == "angleSource":
        key = "dsc" if str(ref.get("angle")) == "dc" else str(ref.get("angle") or "")
        try:
            if key == "asc":
                longitude = float(chrt.houses.ascmc[houses.Houses.ASC])
            elif key == "dsc":
                longitude = util.normalize(float(chrt.houses.ascmc[houses.Houses.ASC]) + 180.0)
            elif key == "mc":
                longitude = float(chrt.houses.ascmc[houses.Houses.MC])
            elif key == "ic":
                longitude = util.normalize(float(chrt.houses.ascmc[houses.Houses.MC]) + 180.0)
            elif key == "vertex":
                longitude = float(chrt.houses.ascmc[houses.Houses.VERTEX])
            else:
                return None
        except Exception:
            return None
        return {
            "longitude": util.normalize(longitude),
            "regime": ("rebuiltAngle", key),
            "canAct": True,
            "valid": True,
        }
    if kind == "fortune":
        try:
            longitude = float(chrt.fortune.fortune[fortune.Fortune.LON])
            above = bool(getattr(chrt.fortune, "abovehorizon", False))
            formula_type = int(getattr(chrt.options, "lotoffortune", 0) or 0)
        except Exception:
            return None
        return {
            "longitude": util.normalize(longitude),
            "regime": ("rebuiltFortune", formula_type, above),
            "canAct": True,
            "valid": True,
        }
    if kind == "syzygy":
        try:
            longitude = float(export_chart_json._ensure_syzygy_lon(chrt))
            syzygy_state = getattr(chrt, "syzygy", None)
            event_time = getattr(syzygy_state, "time", None)
            event_jd = round(float(event_time.jd), 7)
            new_moon = bool(getattr(syzygy_state, "newmoon"))
            selected_body = str(
                getattr(syzygy_state, "selected_body", "moon") or "moon"
            )
        except Exception:
            return None
        return {
            "longitude": util.normalize(longitude),
            # Prenatal Syzygy is piecewise constant.  Its exact lunation and
            # configured Moon/Sun selection identify the continuous branch;
            # crossing into the next lunation must never be bisected as though
            # the longitude jump were an aspect perfection.
            "regime": (
                "rebuiltSyzygy",
                event_jd,
                "new" if new_moon else "full",
                selected_body,
            ),
            "canAct": False,
            "valid": True,
        }
    if kind == "arabicPart":
        try:
            config_index = int(ref["configIndex"])
            parts_values = list(export_chart_json.ensure_arabic_parts(chrt) or ())
            active_indices = []
            for index, item in enumerate(getattr(chrt.options, "arabicparts", ()) or ()):
                try:
                    if not arabicparts.ArabicParts.is_active_item(item):
                        continue
                except Exception:
                    pass
                active_indices.append(index)
            active_index = active_indices.index(config_index)
            longitude = float(parts_values[active_index][arabicparts.ArabicParts.LONG])
            regimes = tuple(
                getattr(getattr(chrt, "parts", None), "motion_regimes_by_config", None)
                or ()
            )
            regime = regimes[config_index] if config_index < len(regimes) else None
            if regime is None:
                return None
        except (ValueError, IndexError, KeyError, TypeError):
            return None
        return {
            "longitude": util.normalize(longitude),
            "regime": ("rebuiltArabicPart", config_index, regime),
            "canAct": True,
            "valid": True,
        }
    if kind == "fixedPoint":
        try:
            longitude = float(ref["longitude"])
        except (KeyError, TypeError, ValueError):
            return None
        return {
            "longitude": util.normalize(longitude),
            "regime": ("fixedPoint", str(ref.get("id") or "")),
            "canAct": False,
            "valid": True,
        }
    if kind == "fixedStar":
        return aspect_motion.ChartMotionEvaluator(chrt).sample(
            ref, float(chrt.time.jd)
        )

    midpoint_regime = None
    midpoint_valid = True
    exporters = []
    if kind == "midpoint":
        try:
            left_body = chrt.get_planet_body(int(ref["p1"]))
            right_body = chrt.get_planet_body(int(ref["p2"]))
            if left_body is None or right_body is None:
                return None
            left_lon = float(left_body.data[planets.Planet.LONG])
            right_lon = float(right_body.data[planets.Planet.LONG])
            midpoint_arc = (right_lon - left_lon + 540.0) % 360.0 - 180.0
            midpoint_valid = abs(abs(midpoint_arc) - 180.0) > 1.0e-7
            midpoint_regime = 1 if midpoint_arc >= 0.0 else -1
        except (AttributeError, KeyError, TypeError, ValueError):
            return None
        exporters.append(lambda: export_chart_json.export_midpoint_ring_items(chrt))
    elif kind == "projection":
        projection = str(ref.get("projection") or "")
        family = {
            "dodecatemoria": "dodecatemoria",
            "antiscia": "antiscia",
            "morin_antiscia": "antiscia",
            "contra_antiscia": "contra_antiscia",
            "morin_contra_antiscia": "contra_antiscia",
        }.get(projection)
        if family is not None:
            exporters.append(
                lambda family=family: export_chart_json.export_overlay_family_items(
                    chrt, family
                )
            )
    for exporter in exporters:
        try:
            for item in exporter():
                if item.get("motionRef") == ref:
                    return {
                        "longitude": util.normalize(float(item["longitude"])),
                        "regime": (
                            "rebuiltRingPoint",
                            str(item.get("semanticId") or item.get("id") or ""),
                            repr(ref),
                        ) + ((midpoint_regime,) if kind == "midpoint" else ()),
                        "canAct": True,
                        "valid": midpoint_valid,
                    }
        except Exception:
            return None
    return None


class _RebuiltChartMotionEvaluator:
    """Motion evaluator backed by a canonical supplementary chart builder."""

    # A symbolic civil year normally maps to at most a day of ephemeris motion.
    # The semantic root finder may therefore advance farther than the physical
    # evaluator's ten-day ceiling without skipping a multi-degree crossing.
    max_step_days = 365.0
    # The public cursor carries seconds, while rebuilt symbolic charts can
    # quantize their derived ephemeris epoch to whole seconds.  Secondary
    # progression is the coarsest supported mapping (about six signified
    # minutes per progressed second), so ten minutes is the smallest shared
    # representable root neighborhood.  Physical sampling can still begin at
    # one minute; rebuilt trajectories begin at this floor and expand only when
    # the same-regime relationship remains numerically unchanged.
    sample_resolution_days = 10.0 / 1440.0

    def __init__(self, builder):
        self._builder = builder
        self._chart_cache: dict[float, Any] = {}

    def _chart(self, jd: float):
        key = round(float(jd), 8)
        if key not in self._chart_cache:
            self._chart_cache[key] = self._builder(float(jd))
        return self._chart_cache[key]

    def sample(self, ref: dict[str, Any], jd: float) -> dict[str, Any] | None:
        chrt = self._chart(jd)
        if chrt is None:
            return None
        return _snapshot_motion_sample(chrt, ref)


def _role_motion_context(
    role_contexts: dict[str, Any] | None,
    role: str,
    chrt,
) -> dict[str, Any]:
    candidate = (role_contexts or {}).get(str(role))
    if isinstance(candidate, dict):
        return candidate
    try:
        anchor_jd = float(chrt.time.jd)
        calendar = int(getattr(chrt.time, "cal", 0) or 0)
    except Exception:
        anchor_jd = 0.0
        calendar = 0
    return {
        "role": str(role),
        "trajectoryKind": "physical",
        "anchorJd": anchor_jd,
        "calendar": calendar,
        # Prenatal Syzygy belongs to the chart snapshot.  Advancing the
        # candidate date must not silently replace it with a different
        # lunation; planets and other supported endpoints perfect against the
        # source chart's Syzygy longitude just as they do against a fixed
        # radix target.
        "pointMotionPolicy": {"syzygy": "anchor-fixed"},
    }


def _role_evolves(motion_context: dict[str, Any]) -> bool:
    return str(motion_context.get("trajectoryKind") or "physical") not in {
        "static", "unsupported",
    }


def _motion_anchor_jd(motion_context: dict[str, Any], chrt) -> float:
    try:
        return float(motion_context["anchorJd"])
    except (KeyError, TypeError, ValueError):
        return float(chrt.time.jd)


def _adaptive_error_probe(
    error_at,
    anchor_jd: float,
    *,
    minimum_days: float = 0.0,
    delta_epsilon: float = _RELATION_ERROR_DELTA_EPSILON,
):
    """Return the first bounded symmetric probe with measurable motion.

    ``error_at`` owns endpoint validity and branch/regime checks.  A ``None``
    sample therefore stops the search rather than skipping across a semantic
    discontinuity.  Returning the final zero-rate probe distinguishes a truly
    invariant relationship from an under-resolved first sample.
    """
    probe_days = [
        float(value)
        for value in _RELATION_PROBE_DAYS
        if float(value) >= float(minimum_days) - 1.0e-15
    ]
    if minimum_days > 0.0 and (
        not probe_days or abs(probe_days[0] - float(minimum_days)) > 1.0e-15
    ):
        probe_days.insert(0, float(minimum_days))
    for epsilon in probe_days:
        before_error = error_at(float(anchor_jd) - float(epsilon))
        after_error = error_at(float(anchor_jd) + float(epsilon))
        if before_error is None or after_error is None:
            return None
        probe = (float(epsilon), float(before_error), float(after_error))
        if abs(float(after_error) - float(before_error)) > float(delta_epsilon):
            return probe
    return None


def _relation_endpoint_is_anchor_fixed(
    endpoint: dict[str, Any],
    *,
    evolves: bool,
    motion_context: dict[str, Any] | None = None,
) -> bool:
    if not evolves:
        return True
    ref = _endpoint_motion_ref(endpoint)
    point_policy = (motion_context or {}).get("pointMotionPolicy") or {}
    return bool(
        ref
        and str(ref.get("kind") or "") == "syzygy"
        and str(point_policy.get("syzygy") or "") == "anchor-fixed"
    )


def _sample_relation_endpoint(
    evaluator: aspect_motion.ChartMotionEvaluator,
    endpoint: dict[str, Any],
    jd: float,
    *,
    evolves: bool,
    motion_context: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if _relation_endpoint_is_anchor_fixed(
        endpoint,
        evolves=evolves,
        motion_context=motion_context,
    ):
        return _frozen_sample(endpoint)
    ref = _endpoint_motion_ref(endpoint)
    if ref is None:
        return None
    return evaluator.sample(ref, jd)


def _relationship_state(
    *,
    left_chart,
    left_endpoint: dict[str, Any],
    right_chart,
    right_endpoint: dict[str, Any],
    aspect_type: int,
    exact: bool,
    anchor_jd: float,
    evolving_roles: set[str],
    evaluator_cache: dict[int, aspect_motion.ChartMotionEvaluator] | None = None,
    role_contexts: dict[str, Any] | None = None,
) -> dict[str, Any]:
    def unavailable(relative_speed: float = 0.0) -> dict[str, Any]:
        return {
            "phase": "exact" if exact else "none",
            "actorSide": None,
            "relativeSpeed": relative_speed,
        }

    evaluators = evaluator_cache if evaluator_cache is not None else {}

    def evaluator(chrt, endpoint):
        role = str(endpoint.get("role") or "")
        motion_context = _role_motion_context(role_contexts, role, chrt)
        builder = motion_context.get("builder")
        key = (id(chrt), role, id(builder) if callable(builder) else None)
        if key not in evaluators:
            if (
                str(motion_context.get("trajectoryKind") or "physical")
                in ("supplementary", "pd_in_chart")
                and callable(builder)
            ):
                evaluators[key] = _RebuiltChartMotionEvaluator(builder)
            else:
                evaluators[key] = aspect_motion.ChartMotionEvaluator(chrt)
        return evaluators[key]

    left_evolves = str(left_endpoint.get("role")) in evolving_roles
    right_evolves = str(right_endpoint.get("role")) in evolving_roles
    left_motion_context = _role_motion_context(
        role_contexts, str(left_endpoint.get("role") or ""), left_chart
    )
    right_motion_context = _role_motion_context(
        role_contexts, str(right_endpoint.get("role") or ""), right_chart
    )
    left_eval = evaluator(left_chart, left_endpoint) if left_evolves else None
    right_eval = evaluator(right_chart, right_endpoint) if right_evolves else None
    current_left = _sample_relation_endpoint(
        left_eval,
        left_endpoint,
        anchor_jd,
        evolves=left_evolves,
        motion_context=left_motion_context,
    )
    current_right = _sample_relation_endpoint(
        right_eval,
        right_endpoint,
        anchor_jd,
        evolves=right_evolves,
        motion_context=right_motion_context,
    )
    if (
        current_left is None
        or current_right is None
        or not current_left.get("valid", True)
        or not current_right.get("valid", True)
    ):
        return unavailable()
    offsets = searchbackend._dynamic_aspect_offsets(int(aspect_type))
    offset = min(
        offsets,
        key=lambda value: abs(searchbackend._dynamic_weather_delta(
            current_left["longitude"], current_right["longitude"], float(value)
        )),
    )
    current_error = searchbackend._dynamic_weather_delta(
        current_left["longitude"], current_right["longitude"], float(offset)
    )

    def sample_pair(jd: float):
        left_sample = _sample_relation_endpoint(
            left_eval,
            left_endpoint,
            jd,
            evolves=left_evolves,
            motion_context=left_motion_context,
        )
        right_sample = _sample_relation_endpoint(
            right_eval,
            right_endpoint,
            jd,
            evolves=right_evolves,
            motion_context=right_motion_context,
        )
        samples = (left_sample, right_sample)
        if any(sample is None or not sample.get("valid", True) for sample in samples):
            return None
        if left_evolves and left_sample.get("regime") != current_left.get("regime"):
            return None
        if right_evolves and right_sample.get("regime") != current_right.get("regime"):
            return None
        return left_sample, right_sample

    def error_at(jd: float):
        pair = sample_pair(jd)
        if pair is None:
            return None
        left_sample, right_sample = pair
        return searchbackend._dynamic_weather_delta(
            left_sample["longitude"], right_sample["longitude"], float(offset)
        )

    minimum_probe_days = max(
        (
            float(getattr(candidate, "sample_resolution_days", 0.0) or 0.0)
            for candidate, evolves in (
                (left_eval, left_evolves),
                (right_eval, right_evolves),
            )
            if evolves and candidate is not None
        ),
        default=0.0,
    )
    probe = _adaptive_error_probe(
        error_at,
        anchor_jd,
        minimum_days=minimum_probe_days,
        delta_epsilon=(
            _REBUILT_RELATION_ERROR_DELTA_EPSILON
            if minimum_probe_days > 0.0
            else _RELATION_ERROR_DELTA_EPSILON
        ),
    )
    if probe is None:
        return unavailable()
    epsilon, before_error, after_error = probe
    before_pair = sample_pair(float(anchor_jd) - float(epsilon))
    after_pair = sample_pair(float(anchor_jd) + float(epsilon))
    if before_pair is None or after_pair is None:
        return unavailable()
    left_before, right_before = before_pair
    left_after, right_after = after_pair

    left_speed = (
        (float(left_after["longitude"]) - float(left_before["longitude"]) + 540.0) % 360.0 - 180.0
    ) / (2.0 * epsilon) if left_evolves else 0.0
    right_speed = (
        (float(right_after["longitude"]) - float(right_before["longitude"]) + 540.0) % 360.0 - 180.0
    ) / (2.0 * epsilon) if right_evolves else 0.0
    actor_candidates = []
    if left_evolves and bool(current_left.get("canAct", True)):
        actor_candidates.append((abs(left_speed), "left"))
    if right_evolves and bool(current_right.get("canAct", True)):
        actor_candidates.append((abs(right_speed), "right"))
    if not actor_candidates:
        return unavailable(left_speed - right_speed)
    actor_side = max(actor_candidates)[1]
    error_rate = (float(after_error) - float(before_error)) / (2.0 * epsilon)
    phase_metric = float(current_error) * error_rate
    if exact:
        phase = "exact"
    elif phase_metric < -1.0e-10:
        phase = "applying"
    elif phase_metric > 1.0e-10:
        phase = "separating"
    else:
        phase = "none"
    return {
        "phase": phase,
        "actorSide": actor_side,
        "relativeSpeed": left_speed - right_speed,
        "offset": float(offset),
    }


def _format_orb(orb: float) -> str:
    total_minutes = max(0, int(round(float(orb) * 60.0)))
    degrees, minutes = divmod(total_minutes, 60)
    return f"{degrees}°{minutes:02d}′"


def _internal_relationship(
    chrt,
    left_key: str,
    right_key: str,
    aspect_type: int,
    exact: bool,
    evaluator_cache: dict[int, aspect_motion.ChartMotionEvaluator] | None = None,
    role_contexts: dict[str, Any] | None = None,
    role: str = "primary",
) -> dict[str, Any]:
    left = _motion_body(chrt, left_key, role)
    right = _motion_body(chrt, right_key, role)
    if left is None or right is None:
        return {
            "phase": _phase_from_state(None, exact),
            "actorSide": None,
            "relativeSpeed": 0.0,
        }
    motion_context = _role_motion_context(role_contexts, role, chrt)
    return _relationship_state(
        left_chart=chrt,
        left_endpoint={
            "key": left_key,
            "role": role,
            "longitude": left["lon"],
            "planetId": left["index"] if left["kind"] == "planet" else None,
            "motionRef": left.get("motionRef"),
        },
        right_chart=chrt,
        right_endpoint={
            "key": right_key,
            "role": role,
            "longitude": right["lon"],
            "planetId": right["index"] if right["kind"] == "planet" else None,
            "motionRef": right.get("motionRef"),
        },
        aspect_type=aspect_type,
        exact=exact,
        anchor_jd=_motion_anchor_jd(motion_context, chrt),
        evolving_roles={role} if _role_evolves(motion_context) else set(),
        evaluator_cache=evaluator_cache,
        role_contexts=role_contexts,
    )


def _internal_phase(
    chrt,
    left_key: str,
    right_key: str,
    aspect_type: int,
    exact: bool,
    evaluator_cache: dict[int, aspect_motion.ChartMotionEvaluator] | None = None,
    role_contexts: dict[str, Any] | None = None,
    role: str = "primary",
) -> str:
    return str(_internal_relationship(
        chrt,
        left_key,
        right_key,
        aspect_type,
        exact,
        evaluator_cache,
        role_contexts,
        role,
    )["phase"])


def _cross_relationship(
    primary,
    outer,
    inner_key: str,
    outer_key: str,
    aspect_type: int,
    exact: bool,
    evaluator_cache: dict[int, aspect_motion.ChartMotionEvaluator] | None = None,
    role_contexts: dict[str, Any] | None = None,
) -> dict[str, Any]:
    inner_body = _motion_body(primary, inner_key, "primary")
    outer_body = _motion_body(outer, outer_key, "outer")
    if inner_body is None or outer_body is None:
        return {
            "phase": _phase_from_state(None, exact),
            "actorSide": None,
            "relativeSpeed": 0.0,
        }
    outer_motion_context = _role_motion_context(role_contexts, "outer", outer)
    return _relationship_state(
        left_chart=outer,
        left_endpoint={
            "key": outer_key,
            "role": "outer",
            "longitude": outer_body["lon"],
            "planetId": outer_body["index"] if outer_body["kind"] == "planet" else None,
            "motionRef": outer_body.get("motionRef"),
        },
        right_chart=primary,
        right_endpoint={
            "key": inner_key,
            "role": "primary",
            "longitude": inner_body["lon"],
            "planetId": inner_body["index"] if inner_body["kind"] == "planet" else None,
            "motionRef": inner_body.get("motionRef"),
        },
        aspect_type=aspect_type,
        exact=exact,
        anchor_jd=_motion_anchor_jd(outer_motion_context, outer),
        evolving_roles={"outer"} if _role_evolves(outer_motion_context) else set(),
        evaluator_cache=evaluator_cache,
        role_contexts=role_contexts,
    )


def _cross_phase(
    primary,
    outer,
    inner_key: str,
    outer_key: str,
    aspect_type: int,
    exact: bool,
    evaluator_cache: dict[int, aspect_motion.ChartMotionEvaluator] | None = None,
    role_contexts: dict[str, Any] | None = None,
) -> str:
    return str(_cross_relationship(
        primary,
        outer,
        inner_key,
        outer_key,
        aspect_type,
        exact,
        evaluator_cache,
        role_contexts,
    )["phase"])


def _row(
    *,
    mode: str,
    left_chart,
    left_key: str,
    left_role: str,
    right_chart,
    right_key: str,
    right_role: str,
    source: dict[str, Any],
    display_options,
    phase: str,
    moving_role: str | None,
    left_metadata: dict[str, Any] | None = None,
    right_metadata: dict[str, Any] | None = None,
    actor_side: str | None = None,
) -> dict[str, Any]:
    aspect_type = int(source["type"])
    orb = float(source.get("orb", 0.0))
    left_payload = left_metadata or _endpoint_metadata(
        left_chart, left_key, left_role, display_options
    )
    right_payload = right_metadata or _endpoint_metadata(
        right_chart, right_key, right_role, display_options
    )
    row = {
        "id": f"{mode}:{left_role}:{left_key}:{aspect_type}:{right_role}:{right_key}",
        "left": left_payload,
        "aspect": _aspect_metadata(display_options, aspect_type),
        "right": right_payload,
        "orb": orb,
        "orbFormatted": _format_orb(orb),
        "phase": phase,
        "movingRole": moving_role,
        "actorSide": actor_side,
        "filterIds": list(dict.fromkeys(
            left_payload.get("filterIds", []) + right_payload.get("filterIds", [])
        )),
    }
    row["trajectoryKey"] = _row_trajectory_key(
        row,
        left_chart=left_chart,
        right_chart=right_chart,
    )
    return row


def _freeze_trajectory_value(value: Any, depth: int = 0):
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return ("float", f"{value:.12g}")
    if depth >= 6:
        return ("type", type(value).__name__)
    if isinstance(value, dict):
        return tuple(
            (str(key), _freeze_trajectory_value(item, depth + 1))
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        )
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_trajectory_value(item, depth + 1) for item in value)
    return ("type", type(value).__name__)


def _motion_ref_contains_kind(ref: Any, kind: str) -> bool:
    if not isinstance(ref, dict):
        return False
    if str(ref.get("kind") or "") == kind:
        return True
    return _motion_ref_contains_kind(ref.get("source"), kind)


def _endpoint_house_trajectory_signature(chrt, endpoint: dict[str, Any]):
    """Only the house-model inputs that can alter this endpoint's trajectory.

    Ordinary quadrant systems leave planets and the astronomical angle frame
    unchanged.  True Ascendant (Q) is a distinct angle model, while configured
    Lots may use intermediate cusps or cusp lords and therefore retain the
    exact house-system code.
    """
    ref = endpoint.get("motionRef") or {}
    if _motion_ref_contains_kind(ref, "arabicPart"):
        return ("configured-lot", str(getattr(chrt.options, "hsys", "")))
    if (
        str(endpoint.get("objectType") or "") in ("angle", "fortune", "vertex")
        or _motion_ref_contains_kind(ref, "angleSource")
        or _motion_ref_contains_kind(ref, "fortune")
    ):
        return ("angle-model", str(getattr(chrt.options, "hsys", "")) == "Q")
    return None


def _row_trajectory_key(
    row: dict[str, Any],
    *,
    left_chart,
    right_chart,
) -> str:
    """Stable cache identity for one exact-perfection trajectory.

    It intentionally omits the raw house-system code for invariant planet and
    fixed-point rows. A P→R change can then retain their Exact dates, while Q
    angles and cusp-derived Lots get different keys and are recalculated.
    """

    def endpoint_signature(chrt, endpoint: dict[str, Any]):
        try:
            chart_jd = f"{float(chrt.time.jd):.10f}"
        except Exception:
            chart_jd = "none"
        try:
            longitude = f"{float(endpoint.get('longitude')):.12g}"
        except (TypeError, ValueError):
            longitude = "none"
        return (
            str(endpoint.get("role") or ""),
            str(endpoint.get("key") or ""),
            str(endpoint.get("objectType") or ""),
            longitude,
            chart_jd,
            _freeze_trajectory_value(endpoint.get("motionRef") or {}),
            _endpoint_house_trajectory_signature(chrt, endpoint),
        )

    signature = (
        "aspect-row-trajectory-v1",
        int((row.get("aspect") or {}).get("type", -1)),
        f"{float(row.get('orb', 0.0)):.12g}",
        str(row.get("phase") or ""),
        str(row.get("movingRole") or ""),
        str(row.get("actorSide") or ""),
        endpoint_signature(left_chart, row["left"]),
        endpoint_signature(right_chart, row["right"]),
    )
    return hashlib.sha256(repr(signature).encode("utf-8")).hexdigest()


def _is_nonacting_target(endpoint: dict[str, Any]) -> bool:
    motion_ref = endpoint.get("motionRef") or {}
    return (
        str(motion_ref.get("kind") or "") in ("fixedPoint", "fixedStar")
        or str(endpoint.get("family") or "") == "fixstar"
    )


def _swap_display_endpoints(row: dict[str, Any]) -> dict[str, Any]:
    row["left"], row["right"] = row["right"], row["left"]
    if row.get("actorSide") == "left":
        row["actorSide"] = "right"
    elif row.get("actorSide") == "right":
        row["actorSide"] = "left"
    return row


def _orient_within_chart_row(row: dict[str, Any]) -> dict[str, Any]:
    """Put the acting endpoint first without changing semantic row identity.

    Cross-chart rows deliberately use chart provenance instead.  When agency
    cannot be sampled, a known fixed target still belongs on the right; all
    other indeterminate pairs retain their canonical exporter order.
    """
    left = row["left"]
    right = row["right"]
    if str(left.get("role")) != str(right.get("role")):
        return row
    if row.get("actorSide") == "right" or (
        row.get("actorSide") is None
        and _is_nonacting_target(left)
        and not _is_nonacting_target(right)
    ):
        return _swap_display_endpoints(row)
    return row


def _keeps_canonical_angle_contact(
    left_key: str,
    right_key: str,
    aspect_type: int,
) -> bool:
    """Keep one semantic row for each contact with a chart axis.

    ASC/MC are the canonical targets for ordinary aspects.  DSC/IC remain
    independently useful only for conjunctions, where replacing the contact
    with an opposition to the opposite angle would obscure what is actually
    on the horizon or meridian.
    """
    for raw_key in (left_key, right_key):
        key = "dsc" if raw_key == "dc" else raw_key
        if key in ("dsc", "ic"):
            if int(aspect_type) != int(chart.Chart.CONJUNCTIO):
                return False
        elif key in ("asc", "mc"):
            if int(aspect_type) == int(chart.Chart.OPPOSITIO):
                return False
    return True


def _angle_sources(chrt) -> list[dict[str, Any]]:
    if not bool(getattr(chrt.options, "aspects", True)):
        return []
    rows = []
    try:
        planet_ids = chrt.get_visible_aspect_planet_ids(
            include_chiron=getattr(chrt.options, "showchiron", True)
        )
        for pid in planet_ids:
            if pid in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not getattr(chrt.options, "aspectstonodes", False):
                continue
            body = chrt.get_planet_body(pid)
            if body is None:
                continue
            lon = float(body.data[planets.Planet.LONG])
            for angle_key, angle_lon in export_chart_json._angle_longitudes(chrt):
                asp = export_chart_json._angle_aspect(chrt, pid, angle_key, angle_lon)
                if asp is None or not _keeps_canonical_angle_contact(
                    _PLANET_BY_KEY_INV[pid], angle_key, int(asp.typ)
                ):
                    continue
                if export_chart_json.should_show_aspect(chrt, asp, lon, angle_lon):
                    canonical_key = "dsc" if angle_key == "dc" else angle_key
                    rows.append(export_chart_json.aspect_payload(_PLANET_BY_KEY_INV[pid], canonical_key, asp))
    except Exception:
        return []
    return rows


_PLANET_BY_KEY_INV = {planet_id: key for key, planet_id in _PLANET_BY_KEY.items()}

_OUTER_RING_LABELS = {
    "fixstars": ("FixStars", "Fixed Stars"),
    "fixstar": ("FixStars", "Fixed Stars"),
    "asteroids": ("Asteroids", "Asteroids"),
    "asteroid": ("Asteroids", "Asteroids"),
    "midpoints": ("Midpoints", "Midpoints"),
    "midpoint": ("Midpoints", "Midpoints"),
    "hybrid_hits": ("HybridHits", "Hybrid Hits"),
    "hybrid_hit": ("HybridHits", "Hybrid Hits"),
    "antiscia": ("Antiscia", "Antiscia"),
    "dodecatemoria": ("Dodecatemoria", "Dodecatemoria"),
    "contra_antiscia": ("ContraAntiscia", "Contraantiscia"),
    "arabic_parts": ("ArabicParts", "Arabic Parts"),
    "arabic_part": ("ArabicParts", "Arabic Parts"),
}


def _outer_ring_label(identity: str, fallback: str) -> str:
    label_key, default = _OUTER_RING_LABELS.get(identity, (identity, fallback))
    return str(mtexts.txts.get(label_key, default))


def _active_outer_ring_mode(display_options) -> str:
    return export_chart_json.OUTER_RING_MODE_MAP.get(
        int(getattr(display_options, "showfixstars", 0) or 0),
        "none",
    )


def _secondary_ring_filter_id(role: str, family: str) -> str:
    """Keep equal point families on opposite chart roles distinct."""
    return f"outer:{str(role)}:{str(family)}"


def _secondary_ring_filter_family(filter_id: str) -> str:
    parts = str(filter_id).split(":", 2)
    return parts[2] if len(parts) == 3 else parts[-1]


def _active_ring_target_role(selected_mode: str, outer) -> str | None:
    """Resolve the chart role receiving the selected directional contacts."""
    if selected_mode == "primary":
        return "primary"
    if selected_mode == "outer":
        return "outer" if outer is not None else None
    if selected_mode == "outerToPrimary":
        return "primary"
    if selected_mode == "primaryToOuter":
        return "outer" if outer is not None else None
    return None


def _active_outer_ring_items(
    chrt,
    role: str,
    display_options=None,
) -> tuple[str, list[dict[str, Any]]]:
    option_source = display_options if display_options is not None else chrt.options
    mode = _active_outer_ring_mode(option_source)
    try:
        if mode == "fixstars":
            items = export_chart_json.export_fixstar_items(chrt)
        elif mode == "asteroids":
            items = export_chart_json.export_asteroid_items(chrt, role=role)
        elif mode == "midpoints":
            items = export_chart_json.export_midpoint_ring_items(chrt)
        elif mode == "hybrid_hits":
            items = export_chart_json.export_hybrid_items(chrt, role=role)
        elif mode in ("antiscia", "dodecatemoria", "contra_antiscia"):
            items = export_chart_json.export_overlay_family_items(chrt, mode, role=role)
        elif mode == "arabic_parts":
            items = export_chart_json.export_arabic_part_items(chrt, role=role)
        else:
            items = []
    except Exception:
        items = []
    return mode, [{**item, "role": role} for item in items]


def _active_secondary_ring(
    primary,
    outer,
    display_options,
    selected_mode: str,
) -> dict[str, Any] | None:
    """Describe the selected family's directional receiving-chart projection."""
    mode = _active_outer_ring_mode(display_options)
    if mode == "none":
        return None
    role = _active_ring_target_role(selected_mode, outer)
    if role is None:
        return None
    ring_chart = outer if role == "outer" else primary
    if ring_chart is None:
        return None
    mode, items = _active_outer_ring_items(ring_chart, role, display_options)
    return {
        "id": mode,
        "label": _outer_ring_label(mode, mode),
        "role": role,
        "filterIds": sorted(
            {
                _secondary_ring_filter_id(
                    role,
                    str(item.get("family") or "point"),
                )
                for item in items
            }
        ),
    }


def _ring_item_identity(item: dict[str, Any]) -> tuple[str, str]:
    """Stable identity used when a configured Lot is also the active ring."""
    semantic_id = str(item.get("semanticId") or item.get("id") or "")
    return semantic_id, repr(item.get("motionRef") or {})


def _technique_ring_items(
    chrt,
    role: str,
    display_options,
    *,
    include_active_ring: bool = True,
) -> list[dict[str, Any]]:
    """Return non-core points considered by the Aspect List technique.

    Activated Lots are technique inputs even when another wheel overlay is
    selected.  The context-active ring family is additive.  Fortune is a core
    point and is therefore removed from the Arabic-Parts overlay copy.
    """
    candidates: list[dict[str, Any]] = []
    try:
        candidates.extend(export_chart_json.export_arabic_part_items(chrt, role=role))
    except Exception:
        pass
    if include_active_ring:
        _mode, active_items = _active_outer_ring_items(chrt, role, display_options)
        candidates.extend(active_items)

    standard_body_ids = {
        int(planet_id)
        for key, planet_id in _PLANET_BY_KEY.items()
        if key in _ENDPOINT_SORT_ORDER
    }
    seen: set[tuple[str, str]] = set()
    items: list[dict[str, Any]] = []
    for raw_item in candidates:
        item = {**raw_item, "role": role}
        semantic_id = str(item.get("semanticId") or "")
        motion_ref = item.get("motionRef") or {}
        if semantic_id == "lot-of-fortune" or str(motion_ref.get("kind") or "") == "fortune":
            continue
        if str(motion_ref.get("kind") or "") == "ephemerisBody":
            try:
                if int(motion_ref["bodyId"]) in standard_body_ids:
                    continue
            except (KeyError, TypeError, ValueError):
                pass
        identity = _ring_item_identity(item)
        if identity in seen:
            continue
        seen.add(identity)
        items.append(item)
    return items


def _ring_item_orbs(chrt, item: dict[str, Any]) -> list[float]:
    """Resolve the point's own orb contribution without inventing one.

    Physical optional bodies and projections of bodies inherit the normal body
    orb row. Structural points, Lots, midpoints, and fixed stars contribute
    zero; the opposite endpoint supplies its established body/angle orb.
    """
    ref = dict(item.get("motionRef") or {})
    while str(ref.get("kind") or "") == "projection":
        ref = dict(ref.get("source") or {})
    if str(ref.get("kind") or "") in ("planet", "ephemerisBody"):
        try:
            body_id = int(ref["bodyId"])
            orb_index = int(chrt.get_planet_orb_index(body_id))
            return [float(value) for value in chrt.options.orbis[orb_index]]
        except (AttributeError, IndexError, KeyError, TypeError, ValueError):
            pass
    return [0.0] * chart.Chart.ASPECT_NUM


def _technique_endpoints(
    chrt,
    role: str,
    display_options,
    *,
    include_active_ring: bool = True,
) -> list[dict[str, Any]] | None:
    """Materialize the complete Aspect List endpoint universe for one chart."""
    if not callable(getattr(chrt, "get_planet_body", None)) or not hasattr(chrt, "houses"):
        return None
    try:
        core = export_chart_json.technique_aspect_endpoints(chrt, chrt.options)
    except (AttributeError, TypeError):
        # Lightweight compatibility path for unit fixtures and stale callers;
        # real Chart objects always expose the canonical registry helper.
        return None
    except Exception:
        return None

    endpoints: list[dict[str, Any]] = []
    for endpoint in core:
        try:
            key = "dsc" if str(endpoint["key"]) == "dc" else str(endpoint["key"])
            metadata = _endpoint_metadata(chrt, key, role, display_options)
            endpoints.append({
                "key": key,
                "kind": str(endpoint.get("kind") or metadata.get("objectType") or "point"),
                "longitude": float(endpoint["lon"]),
                "orbs": [float(value) for value in endpoint["orbs"]],
                "metadata": metadata,
            })
        except (KeyError, TypeError, ValueError):
            continue

    for item in _technique_ring_items(
        chrt,
        role,
        display_options,
        include_active_ring=include_active_ring,
    ):
        try:
            metadata = _ring_point_metadata(
                item,
                role,
                display_options,
                chrt=chrt,
            )
            endpoints.append({
                "key": str(metadata["key"]),
                "kind": "ringPoint",
                "longitude": float(metadata["longitude"]),
                "orbs": _ring_item_orbs(chrt, item),
                "metadata": metadata,
            })
        except (KeyError, TypeError, ValueError):
            continue
    return endpoints


def _configured_aspect_mask(options) -> list[bool]:
    values = list(getattr(options, "aspect", ()) or ())
    return [bool(values[index]) if index < len(values) else False for index in range(chart.Chart.ASPECT_NUM)]


def _uses_derived_point_aspect_policy(endpoint: dict[str, Any]) -> bool:
    """Asteroids are bodies; other outer-ring endpoints are derived targets."""
    metadata = endpoint.get("metadata")
    if not isinstance(metadata, dict):
        metadata = endpoint
    if str(metadata.get("objectType") or "") != "outerPoint":
        return False
    motion_ref = metadata.get("motionRef")
    return str((motion_ref or {}).get("kind") or "") != "ephemerisBody"


def _technique_pair_aspect(
    primary,
    comparison,
    primary_endpoint: dict[str, Any],
    comparison_endpoint: dict[str, Any],
    options,
):
    aspect_mask = _configured_aspect_mask(options)
    if (
        not bool(getattr(options, "showaspectsforderivedpoints", False))
        and (
            _uses_derived_point_aspect_policy(primary_endpoint)
            or _uses_derived_point_aspect_policy(comparison_endpoint)
        )
    ):
        aspect_mask = [
            enabled and index == chart.Chart.CONJUNCTIO
            for index, enabled in enumerate(aspect_mask)
        ]
    return export_chart_json._interchart_point_aspect(
        primary,
        comparison,
        float(primary_endpoint["longitude"]),
        float(comparison_endpoint["longitude"]),
        primary_endpoint["orbs"],
        comparison_endpoint["orbs"],
        options,
        aspect_mask,
        bool(getattr(options, "traditionalaspects", False)),
    )


def _endpoint_node_key(endpoint: Any) -> str | None:
    if isinstance(endpoint, str):
        return endpoint if endpoint in ("nnode", "snode") else None
    if not isinstance(endpoint, dict):
        return None
    key = str(endpoint.get("key") or "")
    if key in ("nnode", "snode"):
        return key
    metadata = endpoint.get("metadata")
    if not isinstance(metadata, dict):
        metadata = endpoint
    body_id = _motion_ref_planet_id(metadata.get("motionRef"))
    if body_id == astrology.SE_MEAN_NODE:
        return "nnode"
    if body_id == astrology.SE_TRUE_NODE:
        return "snode"
    return None


def _same_node_axis(left_endpoint: Any, right_endpoint: Any) -> bool:
    return {
        _endpoint_node_key(left_endpoint),
        _endpoint_node_key(right_endpoint),
    } == {"nnode", "snode"}


def _technique_internal_rows(
    chrt,
    *,
    mode: str,
    role: str,
    display_options,
    role_contexts: dict[str, Any] | None,
    include_active_ring: bool,
) -> list[dict[str, Any]] | None:
    endpoints = _technique_endpoints(
        chrt,
        role,
        display_options,
        include_active_ring=include_active_ring,
    )
    if endpoints is None:
        return None
    rows: list[dict[str, Any]] = []
    evaluator_cache: dict[int, aspect_motion.ChartMotionEvaluator] = {}
    motion_context = _role_motion_context(role_contexts, role, chrt)
    evolving_roles = {role} if _role_evolves(motion_context) else set()
    anchor_jd = _motion_anchor_jd(motion_context, chrt)
    for index, left in enumerate(endpoints):
        for right in endpoints[index + 1:]:
            if _same_node_axis(left, right):
                continue
            asp = _technique_pair_aspect(chrt, chrt, left, right, chrt.options)
            if asp is None or not _keeps_canonical_angle_contact(
                str(left["key"]), str(right["key"]), int(asp.typ)
            ):
                continue
            source = export_chart_json.aspect_payload(left["key"], right["key"], asp)
            exact = float(source.get("orb", 0.0)) <= _EXACT_CALC_ORB_DEGREES
            relationship = _relationship_state(
                left_chart=chrt,
                left_endpoint=left["metadata"],
                right_chart=chrt,
                right_endpoint=right["metadata"],
                aspect_type=int(source["type"]),
                exact=exact,
                anchor_jd=anchor_jd,
                evolving_roles=evolving_roles,
                evaluator_cache=evaluator_cache,
                role_contexts=role_contexts,
            )
            rows.append(_orient_within_chart_row(_row(
                mode=mode,
                left_chart=chrt,
                left_key=str(left["key"]),
                left_role=role,
                right_chart=chrt,
                right_key=str(right["key"]),
                right_role=role,
                source=source,
                display_options=display_options,
                phase=str(relationship["phase"]),
                moving_role=None,
                left_metadata=left["metadata"],
                right_metadata=right["metadata"],
                actor_side=relationship.get("actorSide"),
            )))
    return rows


def _technique_cross_rows(
    primary,
    outer,
    *,
    mode: str,
    reverse: bool,
    display_options,
    role_contexts: dict[str, Any] | None,
) -> list[dict[str, Any]] | None:
    active_ring_role = _active_ring_target_role(mode, outer)
    primary_endpoints = _technique_endpoints(
        primary,
        "primary",
        display_options,
        include_active_ring=active_ring_role == "primary",
    )
    outer_endpoints = _technique_endpoints(
        outer,
        "outer",
        display_options,
        include_active_ring=active_ring_role == "outer",
    )
    if primary_endpoints is None or outer_endpoints is None:
        return None
    rows: list[dict[str, Any]] = []
    evaluator_cache: dict[int, aspect_motion.ChartMotionEvaluator] = {}
    outer_context = _role_motion_context(role_contexts, "outer", outer)
    evolving_roles = {"outer"} if _role_evolves(outer_context) else set()
    anchor_jd = _motion_anchor_jd(outer_context, outer)
    for outer_endpoint in outer_endpoints:
        for primary_endpoint in primary_endpoints:
            if _same_node_axis(outer_endpoint, primary_endpoint):
                continue
            asp = _technique_pair_aspect(
                primary,
                outer,
                primary_endpoint,
                outer_endpoint,
                primary.options,
            )
            if asp is None or not _keeps_canonical_angle_contact(
                str(outer_endpoint["key"]),
                str(primary_endpoint["key"]),
                int(asp.typ),
            ):
                continue
            source = {
                "outer": str(outer_endpoint["key"]),
                "inner": str(primary_endpoint["key"]),
                **export_chart_json.aspect_payload(
                    str(outer_endpoint["key"]),
                    str(primary_endpoint["key"]),
                    asp,
                ),
            }
            exact = float(source.get("orb", 0.0)) <= _EXACT_CALC_ORB_DEGREES
            relationship = _relationship_state(
                left_chart=outer,
                left_endpoint=outer_endpoint["metadata"],
                right_chart=primary,
                right_endpoint=primary_endpoint["metadata"],
                aspect_type=int(source["type"]),
                exact=exact,
                anchor_jd=anchor_jd,
                evolving_roles=evolving_roles,
                evaluator_cache=evaluator_cache,
                role_contexts=role_contexts,
            )
            row = _row(
                mode=mode,
                left_chart=outer,
                left_key=str(outer_endpoint["key"]),
                left_role="outer",
                right_chart=primary,
                right_key=str(primary_endpoint["key"]),
                right_role="primary",
                source=source,
                display_options=display_options,
                phase=str(relationship["phase"]),
                moving_role="outer",
                left_metadata=outer_endpoint["metadata"],
                right_metadata=primary_endpoint["metadata"],
                actor_side=relationship.get("actorSide"),
            )
            if reverse:
                _swap_display_endpoints(row)
            rows.append(row)
    return rows


def _ring_point_rows(
    point_chart,
    planet_chart,
    *,
    mode: str,
    point_role: str,
    planet_role: str,
    display_options,
    moving_role: str | None,
    role_contexts: dict[str, Any] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    outer_mode, items = _active_outer_ring_items(
        point_chart,
        point_role,
        display_options,
    )
    rows = []
    if not items:
        return outer_mode, rows
    evaluator_cache: dict[int, aspect_motion.ChartMotionEvaluator] = {}
    requested_roles = {moving_role} if moving_role else {point_role, planet_role}
    chart_by_role = {point_role: point_chart, planet_role: planet_chart}
    evolving_roles = {
        str(candidate_role)
        for candidate_role in requested_roles
        if candidate_role
        and _role_evolves(_role_motion_context(
            role_contexts,
            str(candidate_role),
            chart_by_role[str(candidate_role)],
        ))
    }
    anchor_chart = point_chart if moving_role == "outer" else planet_chart
    anchor_role = str(moving_role or planet_role)
    anchor_jd = _motion_anchor_jd(
        _role_motion_context(role_contexts, anchor_role, anchor_chart),
        anchor_chart,
    )
    for item in items:
        point = _ring_point_metadata(
            item,
            point_role,
            display_options,
            chrt=point_chart,
        )
        point_lon = float(point["longitude"])
        for pid in planet_chart.get_visible_aspect_planet_ids(
            include_chiron=getattr(planet_chart.options, "showchiron", True)
        ):
            key = _PLANET_BY_KEY_INV.get(pid)
            body = planet_chart.get_planet_body(pid)
            if key is None or body is None:
                continue
            lon = float(body.data[planets.Planet.LONG])
            asp = export_chart_json._point_aspect(planet_chart, pid, point_lon)
            if not export_chart_json.should_show_aspect(planet_chart, asp, lon, point_lon):
                continue
            if (
                not bool(
                    getattr(
                        planet_chart.options,
                        "showaspectsforderivedpoints",
                        False,
                    )
                )
                and _uses_derived_point_aspect_policy(point)
                and int(asp.typ) != chart.Chart.CONJUNCTIO
            ):
                continue
            source = export_chart_json.aspect_payload(point["key"], key, asp)
            exact = float(source.get("orb", 0.0)) <= _EXACT_CALC_ORB_DEGREES
            planet = _planet_metadata(planet_chart, key, planet_role, display_options)
            relationship = _relationship_state(
                left_chart=point_chart,
                left_endpoint=point,
                right_chart=planet_chart,
                right_endpoint=planet,
                aspect_type=int(source["type"]),
                exact=exact,
                anchor_jd=anchor_jd,
                evolving_roles={str(value) for value in evolving_roles if value},
                evaluator_cache=evaluator_cache,
                role_contexts=role_contexts,
            )
            row = _row(
                mode=mode,
                left_chart=point_chart,
                left_key=point["key"],
                left_role=point_role,
                right_chart=planet_chart,
                right_key=key,
                right_role=planet_role,
                source=source,
                display_options=display_options,
                phase=str(relationship["phase"]),
                moving_role=moving_role,
                left_metadata=point,
                right_metadata=planet,
                actor_side=relationship.get("actorSide"),
            )
            rows.append(_orient_within_chart_row(row))
    return outer_mode, rows


def _internal_rows(
    chrt,
    *,
    mode: str,
    role: str,
    display_options,
    role_contexts: dict[str, Any] | None = None,
    include_active_ring: bool = True,
) -> list[dict[str, Any]]:
    technique_rows = _technique_internal_rows(
        chrt,
        mode=mode,
        role=role,
        display_options=display_options,
        role_contexts=role_contexts,
        include_active_ring=include_active_ring,
    )
    if technique_rows is not None:
        return technique_rows

    # Compatibility fallback for non-Chart test doubles and older embeddings.
    sources = [
        source for source in export_chart_json.export_aspects(chrt)
        if str(source.get("p2")) not in ("asc", "dsc", "mc", "ic")
    ]
    sources.extend(_angle_sources(chrt))
    sources.extend(export_chart_json.export_vertex_aspects(chrt))
    rows = []
    evaluator_cache: dict[int, aspect_motion.ChartMotionEvaluator] = {}
    for source in sources:
        left_key = str(source["p1"])
        right_key = str(source["p2"])
        aspect_type = int(source["type"])
        # The exporter ``exact`` flag means "inside the user's exact-orb
        # preference", not 0°00′.  The list's Exact state is deliberately the
        # mathematical zero-orb condition the perfection action targets.
        exact = float(source.get("orb", 0.0)) <= _EXACT_CALC_ORB_DEGREES
        relationship = _internal_relationship(
            chrt,
            left_key,
            right_key,
            aspect_type,
            exact,
            evaluator_cache,
            role_contexts,
            role,
        )
        rows.append(
            _orient_within_chart_row(_row(
                mode=mode,
                left_chart=chrt,
                left_key=left_key,
                left_role=role,
                right_chart=chrt,
                right_key=right_key,
                right_role=role,
                source=source,
                display_options=display_options,
                phase=str(relationship["phase"]),
                moving_role=None,
                actor_side=relationship.get("actorSide"),
            ))
        )
    point_rows = []
    if include_active_ring:
        _outer_mode, point_rows = _ring_point_rows(
            chrt, chrt, mode=mode, point_role=role, planet_role=role,
            display_options=display_options, moving_role=None,
            role_contexts=role_contexts,
        )
    return rows + point_rows


def _cross_angle_sources(primary, outer, *, reverse: bool) -> list[dict[str, Any]]:
    """Build the directional planet-to-angle contacts absent from the wheel grid."""
    try:
        options = primary.options
        enabled_aspects = [
            bool(options.aspect[index])
            for index in range(chart.Chart.ASPECT_NUM)
        ]
        traditional_filter = bool(getattr(options, "traditionalaspects", False))
        inner_planets = export_chart_json._interchart_planet_endpoints(primary, options)
        outer_planets = export_chart_json._interchart_planet_endpoints(outer, options)
        inner_angles = [
            endpoint
            for endpoint in export_chart_json._interchart_point_endpoints(primary, options)
            if endpoint.get("kind") == "angle"
        ]
        outer_angles = [
            endpoint
            for endpoint in export_chart_json._interchart_point_endpoints(outer, options)
            if endpoint.get("kind") == "angle"
        ]
    except Exception:
        return []

    pairs = (
        ((planet, angle) for planet in inner_planets for angle in outer_angles)
        if reverse
        else ((angle, planet) for angle in inner_angles for planet in outer_planets)
    )
    rows = []
    for inner_endpoint, outer_endpoint in pairs:
        if not getattr(options, "aspectstonodes", False) and (
            _is_node_aspect_key(str(inner_endpoint["key"]))
            or _is_node_aspect_key(str(outer_endpoint["key"]))
        ):
            continue
        asp = export_chart_json._interchart_point_aspect(
            primary,
            outer,
            float(inner_endpoint["lon"]),
            float(outer_endpoint["lon"]),
            inner_endpoint["orbs"],
            outer_endpoint["orbs"],
            options,
            enabled_aspects,
            traditional_filter,
        )
        if asp is None:
            continue
        rows.append({
            "outer": str(outer_endpoint["key"]),
            "inner": str(inner_endpoint["key"]),
            "type": int(asp.typ),
            "orb": float(asp.aspdif),
            "maxOrb": float(getattr(asp, "max_orb", 0.0)),
            "exact": bool(getattr(asp, "exact", False)),
            "showsNormally": True,
        })
    return rows


def _cross_rows(
    primary,
    outer,
    *,
    mode: str,
    reverse: bool,
    display_options,
    role_contexts: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    technique_rows = _technique_cross_rows(
        primary,
        outer,
        mode=mode,
        reverse=reverse,
        display_options=display_options,
        role_contexts=role_contexts,
    )
    if technique_rows is not None:
        return technique_rows

    # Compatibility fallback for non-Chart test doubles and older embeddings.
    if not bool(getattr(primary.options, "aspects", True)):
        return []
    aspect_data = export_chart_json.export_interchart_aspect_data(primary, outer)
    sources = [
        row for row in aspect_data.get("aspects", [])
        if row.get("showsNormally")
        and _keeps_canonical_angle_contact(
            str(row.get("outer")),
            str(row.get("inner")),
            int(row.get("type", -1)),
        )
    ]
    sources.extend(
        row
        for row in _cross_angle_sources(primary, outer, reverse=reverse)
        if _keeps_canonical_angle_contact(
            str(row.get("outer")),
            str(row.get("inner")),
            int(row.get("type", -1)),
        )
    )
    rows = []
    evaluator_cache: dict[int, aspect_motion.ChartMotionEvaluator] = {}
    for source in sources:
        outer_key = "dsc" if str(source["outer"]) == "dc" else str(source["outer"])
        inner_key = "dsc" if str(source["inner"]) == "dc" else str(source["inner"])
        aspect_type = int(source["type"])
        exact = float(source.get("orb", 0.0)) <= _EXACT_CALC_ORB_DEGREES
        relationship = _cross_relationship(
            primary,
            outer,
            inner_key,
            outer_key,
            aspect_type,
            exact,
            evaluator_cache,
            role_contexts,
        )
        if reverse:
            left_chart, left_key, left_role = primary, inner_key, "primary"
            right_chart, right_key, right_role = outer, outer_key, "outer"
        else:
            left_chart, left_key, left_role = outer, outer_key, "outer"
            right_chart, right_key, right_role = primary, inner_key, "primary"
        actor_side = relationship.get("actorSide")
        if reverse:
            if actor_side == "left":
                actor_side = "right"
            elif actor_side == "right":
                actor_side = "left"
        rows.append(
            _row(
                mode=mode,
                left_chart=left_chart,
                left_key=left_key,
                left_role=left_role,
                right_chart=right_chart,
                right_key=right_key,
                right_role=right_role,
                source=source,
                display_options=display_options,
                phase=str(relationship["phase"]),
                moving_role="outer",
                actor_side=actor_side,
            )
        )
    point_role = _active_ring_target_role(mode, outer)
    if point_role is not None and _active_outer_ring_mode(display_options) != "none":
        point_chart = outer if point_role == "outer" else primary
        planet_role = "primary" if point_role == "outer" else "outer"
        planet_chart = primary if planet_role == "primary" else outer
        _outer_mode, point_rows = _ring_point_rows(
            point_chart,
            planet_chart,
            mode=mode,
            point_role=point_role,
            planet_role=planet_role,
            display_options=display_options,
            moving_role="outer",
            role_contexts=role_contexts,
        )
    else:
        point_rows = []
    for row in point_rows:
        # _ring_point_rows materializes the receiving point first; directional
        # rows display the sending chart on the left and receiver on the right.
        _swap_display_endpoints(row)
        row["id"] = f"{mode}:{row['left']['role']}:{row['left']['key']}:{row['aspect']['type']}:{row['right']['role']}:{row['right']['key']}"
    return rows + point_rows


def _chart_label(chrt, fallback: str) -> str:
    return str(getattr(chrt, "name", "") or fallback).strip() or fallback


def _mode_options(
    context: dict[str, Any],
    available_modes: list[str],
    primary,
    outer,
) -> list[dict[str, str]]:
    primary_label = str(
        context.get("primary_label") or _chart_label(primary, mtexts.txts.get("Chart", "Chart"))
    )
    outer_label = str(
        context.get("outer_label")
        or (_chart_label(outer, mtexts.txts.get("Comparison", "Comparison")) if outer is not None else "")
    )
    labels = {
        "primary": primary_label,
        "outer": outer_label,
        "outerToPrimary": f"{outer_label} → {primary_label}",
        "primaryToOuter": f"{primary_label} → {outer_label}",
    }
    return [{"id": mode, "label": labels[mode]} for mode in available_modes]


def _rows_for_mode(
    context: dict[str, Any],
    mode: str | None,
) -> tuple[Any, Any, list[str], str, list[dict[str, Any]]]:
    primary = context.get("chart")
    outer = context.get("comparison_chart")
    role_contexts = context.get("role_contexts") or {}
    if primary is None:
        raise ValueError("Aspect List requires a chart document")

    available_modes = list(ASPECT_LIST_MODES if outer is not None else ASPECT_LIST_MODES[:1])
    selected_mode = mode or ("outerToPrimary" if outer is not None else "primary")
    if selected_mode not in available_modes:
        raise ValueError(f"Aspect List mode is not available: {selected_mode}")

    display_options = effective_display_options(primary.options)
    active_ring_role = _active_ring_target_role(selected_mode, outer)
    if selected_mode == "primary":
        rows = _internal_rows(
            primary,
            mode=selected_mode,
            role="primary",
            display_options=display_options,
            role_contexts=role_contexts,
            include_active_ring=active_ring_role == "primary",
        )
    elif selected_mode == "outer":
        rows = _internal_rows(
            outer,
            mode=selected_mode,
            role="outer",
            display_options=display_options,
            role_contexts=role_contexts,
            include_active_ring=active_ring_role == "outer",
        )
    else:
        rows = _cross_rows(
            primary,
            outer,
            mode=selected_mode,
            reverse=selected_mode == "primaryToOuter",
            display_options=display_options,
            role_contexts=role_contexts,
        )

    return primary, outer, available_modes, selected_mode, rows


def _context_key(
    selected_mode: str,
    primary,
    outer,
    role_contexts: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
) -> str:
    """Opaque identity for one wheel-authoritative Aspect List snapshot.

    Row ids are semantic ids and intentionally survive refreshes, so they are
    not sufficient authorization for an exact-row action.  This token binds a
    request to the live host/session, rendered role owners, comparison lens,
    technique trajectory, anchors, bindings, chart objects and option values.
    """

    def freeze(value: Any, depth: int = 0):
        if value is None or isinstance(value, (bool, int, str)):
            return value
        if isinstance(value, float):
            return ("float", f"{value:.12g}")
        if depth >= 8:
            return ("type", type(value).__name__)
        if isinstance(value, dict):
            return tuple(
                (str(key), freeze(item, depth + 1))
                for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
            )
        if isinstance(value, (list, tuple, set)):
            items = [freeze(item, depth + 1) for item in value]
            if isinstance(value, set):
                items.sort(key=repr)
            return tuple(items)
        return ("type", type(value).__name__)

    def options_signature(chrt):
        option_source = getattr(chrt, "options", None)
        # Only calculation/motion inputs belong here. Palette, typography and
        # other style-only values deliberately do not invalidate row actions;
        # the frontend does not refetch list data for those option events.
        values = {
            key: getattr(option_source, key, None)
            for key in (
                "ayanamsha",
                "topocentric",
                "meannode",
                "hsys",
                "usedaynightorb",
                "daynightorbdeg",
                "daynightorbmin",
                "lotoffortune",
                "arabicparts",
                "morin_antiscia",
                "aspects",
                "aspect",
                "orbis",
                "orbisAscMC",
                "orbisparAscMC",
                "orbisplanetspar",
                "exact",
                "traditionalaspects",
                "showaspectsforderivedpoints",
                "showfixstars",
                "fixstars",
                "ringorb_asteroids",
                "ringorb_midpoints",
                "ringorb_hybrid",
            )
        }
        return (
            id(option_source) if option_source is not None else None,
            freeze(values),
        )

    def role_signature(chrt, role: str):
        motion_context = (role_contexts or {}).get(role)
        role_state = {}
        if isinstance(motion_context, dict):
            role_state = {
                key: motion_context.get(key)
                for key in (
                    "ownerDocumentId",
                    "parentDocumentId",
                    "trajectoryKind",
                    "featureKind",
                    "launcherKind",
                    "anchorJd",
                    "calendar",
                    "binding",
                    "pointMotionPolicy",
                )
            }
        try:
            chart_jd = f"{float(chrt.time.jd):.10f}"
        except Exception:
            chart_jd = "none"
        return (
            role,
            id(chrt) if chrt is not None else None,
            chart_jd,
            freeze(role_state),
            options_signature(chrt),
        )

    host_state = (context or {}).get("aspect_context") or {}
    signature = (
        "aspect-list-context-v2",
        str(selected_mode),
        str((context or {}).get("host_document_id") or ""),
        freeze(host_state),
        role_signature(primary, "primary"),
        role_signature(outer, "outer"),
    )
    digest = hashlib.sha256(repr(signature).encode("utf-8")).hexdigest()
    return f"aspect-v2:{digest}"


def aspect_list_context_key(
    context: dict[str, Any],
    mode: str | None = None,
) -> str:
    """Resolve the cheap structural token without calculating any rows."""
    primary = context.get("chart")
    outer = context.get("comparison_chart")
    if primary is None:
        raise ValueError("Aspect List requires a chart document")
    available_modes = list(
        ASPECT_LIST_MODES if outer is not None else ASPECT_LIST_MODES[:1]
    )
    selected_mode = mode or ("outerToPrimary" if outer is not None else "primary")
    if selected_mode not in available_modes:
        raise ValueError(f"Aspect List mode is not available: {selected_mode}")
    return _context_key(
        selected_mode,
        primary,
        outer,
        context.get("role_contexts") or {},
        context,
    )


def _filter_items(
    rows: list[dict[str, Any]],
    endpoint_catalog: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    items: dict[str, dict[str, Any]] = {}
    endpoints = list(endpoint_catalog or ())
    endpoints.extend(
        endpoint
        for row in rows
        for endpoint in (row["left"], row["right"])
    )
    for endpoint in endpoints:
        for filter_id in endpoint.get("filterIds", []):
            if filter_id in items:
                continue
            if filter_id == "angles":
                label = str(mtexts.txts.get("Angles", "Angles"))
                glyph = ""
                glyph_font = "text"
            elif filter_id.startswith("outer:"):
                label = _outer_ring_label(
                    _secondary_ring_filter_family(filter_id),
                    endpoint["name"],
                )
                glyph = ""
                glyph_font = "text"
            else:
                label = endpoint["name"]
                glyph = endpoint["glyph"]
                glyph_font = endpoint["glyphFont"]
            items[filter_id] = {
                "id": filter_id,
                "label": label,
                "glyph": glyph,
                "glyphFont": glyph_font,
                "group": "planets" if filter_id.startswith("planet:") else "points",
            }
    return sorted(
        items.values(),
        key=lambda item: (
            0 if item["group"] == "planets" else 1,
            next(
                (
                    endpoint["sortOrder"]
                    for endpoint in endpoints
                    if item["id"] in endpoint.get("filterIds", [])
                ),
                9999,
            ),
            item["label"],
        ),
    )


def _filter_endpoint_catalog(
    primary,
    outer,
    selected_mode: str,
) -> list[dict[str, Any]]:
    display_options = effective_display_options(primary.options)
    active_ring_role = _active_ring_target_role(selected_mode, outer)
    charts_and_roles = (
        ((primary, "primary"),)
        if selected_mode == "primary"
        else ((outer, "outer"),)
        if selected_mode == "outer"
        else ((primary, "primary"), (outer, "outer"))
    )
    catalog: list[dict[str, Any]] = []
    for chrt, role in charts_and_roles:
        if chrt is None:
            continue
        endpoints = _technique_endpoints(
            chrt,
            role,
            display_options,
            include_active_ring=active_ring_role == role,
        )
        if endpoints is None:
            continue
        catalog.extend(endpoint["metadata"] for endpoint in endpoints)
    return catalog


def aspect_list_payload(context: dict[str, Any], mode: str | None = None) -> dict[str, Any]:
    """Build the current aspect relationships for one named chart view."""
    primary, outer, available_modes, selected_mode, rows = _rows_for_mode(context, mode)
    display_options = effective_display_options(primary.options)

    return {
        "rows": rows,
        "filters": _filter_items(
            rows,
            _filter_endpoint_catalog(primary, outer, selected_mode),
        ),
        "modes": _mode_options(context, available_modes, primary, outer),
        "activeMode": selected_mode,
        "hasOuter": outer is not None,
        "activeSecondaryRing": _active_secondary_ring(
            primary,
            outer,
            display_options,
            selected_mode,
        ),
        "contextKey": _context_key(
            selected_mode,
            primary,
            outer,
            context.get("role_contexts") or {},
            context,
        ),
    }


def _nearest_aspect_offset(prom_lon: float, sig_lon: float, aspect_type: int) -> float:
    offsets = searchbackend._dynamic_aspect_offsets(int(aspect_type))
    return min(
        offsets,
        key=lambda offset: abs(
            searchbackend._dynamic_weather_delta(prom_lon, sig_lon, float(offset))
        ),
    )


def _search_bounds(anchor_jd: float, phase: str, span: float) -> tuple[float, float]:
    epsilon = 1.0e-5
    if phase == "applying":
        return anchor_jd + epsilon, anchor_jd + span
    return anchor_jd - span, anchor_jd - epsilon


def _search_span_and_step(orb: float, relative_speed: float) -> tuple[float, float]:
    speed = max(abs(float(relative_speed)), 0.001)
    estimated_days = max(float(orb), 0.25) / speed
    span = max(30.0, estimated_days * 8.0 + 30.0)
    step = min(10.0, max(0.04, 1.5 / max(speed, 0.15)))
    return span, step


def _fast_search_span(anchor_jd: float, phase: str) -> float:
    if phase == "applying":
        return max(0.0, _FAST_PERFECTION_MAX_JD - float(anchor_jd))
    return max(0.0, float(anchor_jd) - _FAST_PERFECTION_MIN_JD)


def _expanding_search_spans(
    initial_span: float,
    maximum_span: float,
) -> tuple[float, ...]:
    maximum = max(0.0, float(maximum_span))
    if maximum <= 0.0:
        return ()
    spans = []
    current = min(maximum, max(1.0, float(initial_span)))
    while True:
        spans.append(current)
        if current >= maximum:
            return tuple(spans)
        current = min(maximum, current * 2.0)


def _search_direction_groups(phase: str) -> tuple[tuple[str, ...], ...]:
    if phase == "applying":
        return (("applying",),)
    if phase == "separating":
        return (("separating",),)
    return (("applying", "separating"),)


def _select_directional_hit(hits: list[tuple], anchor_jd: float, phase: str) -> float | None:
    candidates = [float(hit[0]) for hit in hits if abs(float(hit[0]) - anchor_jd) > 1.0e-5]
    if phase == "applying":
        candidates = [jd for jd in candidates if jd > anchor_jd]
        return min(candidates) if candidates else None
    candidates = [jd for jd in candidates if jd < anchor_jd]
    return max(candidates) if candidates else None


def _search_moving_pair(
    chrt,
    prom: dict[str, Any],
    sig: dict[str, Any],
    *,
    aspect_type: int,
    orb: float,
    phase: str,
) -> float | None:
    anchor_jd = float(chrt.time.jd)
    offset = _nearest_aspect_offset(prom["lon"], sig["lon"], aspect_type)
    span, step = _search_span_and_step(orb, prom["speed"] - sig["speed"])
    context = searchbackend._planet_ephemeris_context(chrt)
    for directions in _search_direction_groups(phase):
        maximum_span = max(
            (_fast_search_span(anchor_jd, direction) for direction in directions),
            default=0.0,
        )
        for search_span in _expanding_search_spans(span, maximum_span):
            candidates = []
            for direction in directions:
                start, end = _search_bounds(anchor_jd, direction, search_span)
                hits = transit_fast_api.search_relative_aspects_batch_raw(
                    [int(prom["index"]), int(sig["index"])],
                    float(start),
                    float(end),
                    [(0, 1, float(offset))],
                    context=context,
                    step_days=step,
                )
                selected = _select_directional_hit(hits, anchor_jd, direction)
                if selected is not None:
                    candidates.append(selected)
            if candidates:
                return min(candidates, key=lambda jd: abs(jd - anchor_jd))
    return None


def _search_moving_to_fixed(
    chrt,
    moving: dict[str, Any],
    fixed: dict[str, Any],
    *,
    aspect_type: int,
    orb: float,
    phase: str,
) -> float | None:
    anchor_jd = float(chrt.time.jd)
    offset = _nearest_aspect_offset(moving["lon"], fixed["lon"], aspect_type)
    target = util.normalize(float(fixed["lon"]) + float(offset))
    span, step = _search_span_and_step(orb, moving["speed"])
    context = searchbackend._planet_ephemeris_context(chrt)
    for directions in _search_direction_groups(phase):
        maximum_span = max(
            (_fast_search_span(anchor_jd, direction) for direction in directions),
            default=0.0,
        )
        for search_span in _expanding_search_spans(span, maximum_span):
            candidates = []
            for direction in directions:
                start, end = _search_bounds(anchor_jd, direction, search_span)
                hits = transit_fast_api.search_longitude_transits_batch_raw(
                    [int(moving["index"])],
                    float(start),
                    float(end),
                    [float(target)],
                    context=context,
                    step_days=step,
                )
                selected = _select_directional_hit(hits, anchor_jd, direction)
                if selected is not None:
                    candidates.append(selected)
            if candidates:
                return min(candidates, key=lambda jd: abs(jd - anchor_jd))
    return None


def _semantic_perfection_search(
    *,
    left_chart,
    left: dict[str, Any],
    right_chart,
    right: dict[str, Any],
    aspect_type: int,
    orb: float,
    phase: str,
    anchor_jd: float,
    evolving_roles: set[str],
    role_contexts: dict[str, Any] | None = None,
    evaluator_cache: dict[Any, Any] | None = None,
    failure_reason: dict[str, str] | None = None,
) -> float | None:
    """Find the nearest real zero in the row phase's time direction.

    Applying selects the future and separating the past; neither promises
    monotonic motion.  The search therefore continues through stations and
    retrograde loops without a product-level year cutoff.  Wrapped longitude is
    also tracked as a continuous winding so only a true ``360*k`` residual is
    accepted; the raw ``+180° -> -180°`` antipode wrap is never a perfection.
    Piecewise calculated points keep the anchor regime throughout the walk.
    """
    def finish(exact_jd: float | None, reason: str | None = None) -> float | None:
        if failure_reason is not None:
            failure_reason.clear()
            if reason:
                failure_reason["reason"] = str(reason)
        return exact_jd

    evaluators = evaluator_cache if evaluator_cache is not None else {}

    def evaluator(chrt, endpoint):
        role = str(endpoint.get("role") or "")
        motion_context = _role_motion_context(role_contexts, role, chrt)
        builder = motion_context.get("builder")
        key = (id(chrt), role, id(builder) if callable(builder) else None)
        if key not in evaluators:
            if (
                str(motion_context.get("trajectoryKind") or "physical")
                in ("supplementary", "pd_in_chart")
                and callable(builder)
            ):
                evaluators[key] = _RebuiltChartMotionEvaluator(builder)
            else:
                evaluators[key] = aspect_motion.ChartMotionEvaluator(chrt)
        return evaluators[key]

    left_evolves = str(left.get("role")) in evolving_roles
    right_evolves = str(right.get("role")) in evolving_roles
    left_motion_context = _role_motion_context(
        role_contexts, str(left.get("role") or ""), left_chart
    )
    right_motion_context = _role_motion_context(
        role_contexts, str(right.get("role") or ""), right_chart
    )
    left_eval = evaluator(left_chart, left) if left_evolves else None
    right_eval = evaluator(right_chart, right) if right_evolves else None

    def samples(jd: float):
        left_sample = _sample_relation_endpoint(
            left_eval,
            left,
            jd,
            evolves=left_evolves,
            motion_context=left_motion_context,
        )
        right_sample = _sample_relation_endpoint(
            right_eval,
            right,
            jd,
            evolves=right_evolves,
            motion_context=right_motion_context,
        )
        return left_sample, right_sample

    current_left, current_right = samples(anchor_jd)
    if current_left is None or current_right is None:
        return finish(None, "trajectory-sample-unavailable")
    if not current_left.get("valid", True) or not current_right.get("valid", True):
        return finish(None, "trajectory-sample-unavailable")
    offsets = searchbackend._dynamic_aspect_offsets(int(aspect_type))
    offset = min(
        offsets,
        key=lambda value: abs(searchbackend._dynamic_weather_delta(
            current_left["longitude"], current_right["longitude"], float(value)
        )),
    )
    current_error = searchbackend._dynamic_weather_delta(
        current_left["longitude"], current_right["longitude"], float(offset)
    )
    if abs(current_error) <= 1.0e-8:
        return finish(float(anchor_jd))

    anchor_regimes = (
        current_left.get("regime") if left_evolves else None,
        current_right.get("regime") if right_evolves else None,
    )

    sample_failure = [None]

    def error_at(jd: float) -> float | None:
        left_sample, right_sample = samples(jd)
        if left_sample is None or right_sample is None:
            sample_failure[0] = "trajectory-sample-unavailable"
            return None
        if not left_sample.get("valid", True) or not right_sample.get("valid", True):
            sample_failure[0] = "trajectory-sample-unavailable"
            return None
        if left_evolves and left_sample.get("regime") != anchor_regimes[0]:
            sample_failure[0] = "regime-change-before-perfection"
            return None
        if right_evolves and right_sample.get("regime") != anchor_regimes[1]:
            sample_failure[0] = "regime-change-before-perfection"
            return None
        return searchbackend._dynamic_weather_delta(
            left_sample["longitude"], right_sample["longitude"], float(offset)
        )

    minimum_probe_days = max(
        (
            float(getattr(candidate, "sample_resolution_days", 0.0) or 0.0)
            for candidate, evolves in (
                (left_eval, left_evolves),
                (right_eval, right_evolves),
            )
            if evolves and candidate is not None
        ),
        default=0.0,
    )
    probe = _adaptive_error_probe(
        error_at,
        anchor_jd,
        minimum_days=minimum_probe_days,
        delta_epsilon=(
            _REBUILT_RELATION_ERROR_DELTA_EPSILON
            if minimum_probe_days > 0.0
            else _RELATION_ERROR_DELTA_EPSILON
        ),
    )
    if probe is None:
        return finish(None, sample_failure[0] or "no-relative-motion")
    epsilon, error_before, error_after = probe
    rate = (float(error_after) - float(error_before)) / (2.0 * epsilon)
    if abs(rate) < 1.0e-9:
        return finish(None, "no-relative-motion")
    direction = 1.0 if phase == "applying" else -1.0
    predicted = -float(current_error) / rate
    if predicted * direction <= 0.0:
        predicted = direction * max(epsilon, abs(float(orb)) / max(abs(rate), 0.001))

    left_speed = 0.0
    right_speed = 0.0
    if left_evolves:
        before_left = _sample_relation_endpoint(
            left_eval,
            left,
            anchor_jd - epsilon,
            evolves=True,
            motion_context=left_motion_context,
        )
        after_left = _sample_relation_endpoint(
            left_eval,
            left,
            anchor_jd + epsilon,
            evolves=True,
            motion_context=left_motion_context,
        )
        if before_left and after_left:
            left_speed = (
                (float(after_left["longitude"]) - float(before_left["longitude"]) + 540.0) % 360.0 - 180.0
            ) / (2.0 * epsilon)
    if right_evolves:
        before_right = _sample_relation_endpoint(
            right_eval,
            right,
            anchor_jd - epsilon,
            evolves=True,
            motion_context=right_motion_context,
        )
        after_right = _sample_relation_endpoint(
            right_eval,
            right,
            anchor_jd + epsilon,
            evolves=True,
            motion_context=right_motion_context,
        )
        if before_right and after_right:
            right_speed = (
                (float(after_right["longitude"]) - float(before_right["longitude"]) + 540.0) % 360.0 - 180.0
            ) / (2.0 * epsilon)
    endpoint_motion_budget = max(
        abs(left_speed) + abs(right_speed), abs(rate), 0.001
    )
    relative_motion_budget = max(abs(rate), 1.0e-9)
    evaluator_step_limits = []
    if left_evolves:
        evaluator_step_limits.append(float(getattr(left_eval, "max_step_days", 10.0)))
    if right_evolves:
        evaluator_step_limits.append(float(getattr(right_eval, "max_step_days", 10.0)))
    evaluator_step_limit = min(evaluator_step_limits or [10.0])
    # Limit both elapsed time and angular travel.  The evaluator ceiling is
    # already expressed in the trajectory's civil/signified units; the angular
    # cap keeps fast relationships from crossing multiple roots at once.
    max_step = max(
        epsilon,
        min(evaluator_step_limit, max(epsilon, 2.0 / relative_motion_budget)),
    )
    # Begin conservatively when the endpoints have substantial common-mode
    # motion, then expand only while the relationship itself remains smooth.
    # This avoids both skipping an early station/turn and spending one sample
    # per day for a century when two endpoints move together.
    initial_step_limit = max(epsilon, 2.0 / endpoint_motion_budget)
    step = min(
        max_step,
        initial_step_limit,
        max(epsilon, abs(predicted) * 1.2),
    )
    sample_resolution = max(
        (
            float(getattr(evaluator, "sample_resolution_days", 0.0))
            for evaluator, evolves in (
                (left_eval, left_evolves),
                (right_eval, right_evolves),
            )
            if evolves and evaluator is not None
        ),
        default=0.0,
    )
    zero_epsilon = (
        _REBUILT_PERFECTION_ZERO_EPSILON
        if sample_resolution > 0.0
        else _PHYSICAL_PERFECTION_ZERO_EPSILON
    )
    refine_resolution = 1.0 / 86400.0 if sample_resolution > 0.0 else 1.0e-9
    # A state is (jd, wrapped residual, residual unwrapped continuously from
    # the anchor).  Genuine recurrences cross a multiple of 360 degrees;
    # antipode wrapping near +/-180 degrees crosses no such target.
    State = tuple[float, float, float]

    def signed_residual_arc(start: float, end: float) -> float:
        return (float(end) - float(start) + 540.0) % 360.0 - 180.0

    def state_from(reference: State, candidate_jd: float) -> State | None:
        raw_error = error_at(float(candidate_jd))
        if raw_error is None:
            return None
        return (
            float(candidate_jd),
            float(raw_error),
            float(reference[2])
            + signed_residual_arc(float(reference[1]), float(raw_error)),
        )

    def nearest_winding_target(state: State) -> float:
        return 360.0 * round(float(state[2]) / 360.0)

    def winding_distance(state: State) -> float:
        return abs(float(state[2]) - nearest_winding_target(state))

    def crossing_target(start: State, end: State) -> float | None:
        lo = min(float(start[2]), float(end[2]))
        hi = max(float(start[2]), float(end[2]))
        first = math.ceil((lo - zero_epsilon) / 360.0)
        last = math.floor((hi + zero_epsilon) / 360.0)
        if first > last:
            return None
        targets = [360.0 * value for value in range(first, last + 1)]
        if float(end[2]) >= float(start[2]):
            targets.sort()
        else:
            targets.sort(reverse=True)
        for target in targets:
            if (
                min(float(start[2]), float(end[2])) - zero_epsilon
                <= target
                <= max(float(start[2]), float(end[2])) + zero_epsilon
            ):
                return target
        return None

    def refine_crossing(start: State, end: State, target: float) -> float | None:
        start_value = float(start[2]) - float(target)
        end_value = float(end[2]) - float(target)
        if start_value * end_value > 0.0:
            return None
        # A true zero bracket is locally near wrapped 0 degrees.  This explicit
        # verification makes a +/-180-degree raw sign wrap ineligible even if
        # a future endpoint family ever reports an incomplete regime token.
        if max(abs(float(start[1])), abs(float(end[1]))) > 45.0:
            return None
        lo = start
        hi = end
        candidates = [start, end]
        for _refine in range(64):
            lo_value = float(lo[2]) - float(target)
            hi_value = float(hi[2]) - float(target)
            denominator = hi_value - lo_value
            if abs(denominator) > 1.0e-15:
                fraction = -lo_value / denominator
            else:
                fraction = 0.5
            # A guarded false-position step converges in one or two rebuilds
            # for ordinary smooth planet motion.  Keep it away from a sticky
            # endpoint so curved/quantized trajectories retain bisection's
            # bounded progress.
            if fraction <= 0.05 or fraction >= 0.95:
                fraction = 0.5
            mid_jd = lo[0] + (hi[0] - lo[0]) * fraction
            mid = state_from(lo, mid_jd)
            if mid is None:
                return None
            candidates.append(mid)
            mid_value = float(mid[2]) - float(target)
            if abs(mid_value) <= zero_epsilon and abs(float(mid[1])) <= zero_epsilon * 4.0:
                return mid[0]
            if abs(hi[0] - lo[0]) <= refine_resolution:
                break
            if lo_value * mid_value <= 0.0:
                hi = mid
            else:
                lo = mid
        # A same-regime continuous/quantized straddle proves that the real
        # trajectory crossed zero even when the public civil cursor cannot
        # represent the mathematical instant more finely than one second.
        closest = min(
            candidates,
            key=lambda value: abs(float(value[2]) - float(target)),
        )
        if abs(float(closest[1])) > max(zero_epsilon * 4.0, 1.0e-4):
            return None
        return closest[0]

    def refine_turning_minimum(
        start: State,
        end: State,
        target: float,
    ) -> float | None:
        """Return a tangent winding-zero inside one local-turn bracket."""
        lo_fraction = 0.0
        hi_fraction = 1.0
        candidates = [start, end]

        def distance(candidate: State) -> float:
            return abs(float(candidate[2]) - float(target))

        def at_fraction(fraction: float) -> State | None:
            jd = start[0] + (end[0] - start[0]) * float(fraction)
            return state_from(start, jd)

        for refine_index in range(48):
            left_fraction = (2.0 * lo_fraction + hi_fraction) / 3.0
            right_fraction = (lo_fraction + 2.0 * hi_fraction) / 3.0
            left_probe = at_fraction(left_fraction)
            right_probe = at_fraction(right_fraction)
            if left_probe is None or right_probe is None:
                return None
            candidates.extend((left_probe, right_probe))
            if distance(left_probe) <= zero_epsilon and abs(float(left_probe[1])) <= zero_epsilon * 4.0:
                return left_probe[0]
            if distance(right_probe) <= zero_epsilon and abs(float(right_probe[1])) <= zero_epsilon * 4.0:
                return right_probe[0]
            # After eight ternary contractions the retained interval is under
            # four percent of one already travel-capped step.  If the best
            # residual is still nowhere near zero, this is plainly a non-zero
            # turnaway; spending dozens more canonical chart rebuilds cannot
            # turn it into a tangent perfection.
            if refine_index == 7 and min(
                distance(candidate) for candidate in candidates
            ) > 0.25:
                return None
            if distance(left_probe) <= distance(right_probe):
                hi_fraction = right_fraction
            else:
                lo_fraction = left_fraction
            if abs((end[0] - start[0]) * (hi_fraction - lo_fraction)) <= refine_resolution:
                break
        closest = min(candidates, key=distance)
        return (
            closest[0]
            if distance(closest) <= zero_epsilon
            and abs(float(closest[1])) <= max(zero_epsilon * 4.0, 1.0e-4)
            else None
        )

    previous: State = (
        float(anchor_jd),
        float(current_error),
        float(current_error),
    )
    previous_left: State | None = None
    travelled = 0.0
    # Fast Swiss-body paths bypass this rebuilt/synthetic walker.  This is an
    # iteration safety guard, not a civil-year product horizon.
    for _iteration in range(_MAX_PERFECTION_SEARCH_ITERATIONS):
        next_travelled = travelled + step
        if next_travelled <= travelled:
            return finish(None, "search-budget-exhausted")
        travelled = next_travelled
        candidate_jd = float(anchor_jd) + direction * travelled
        candidate = state_from(previous, candidate_jd)
        if candidate is None:
            return finish(
                None,
                sample_failure[0] or "trajectory-sample-unavailable",
            )
        if (
            winding_distance(candidate) <= zero_epsilon
            and abs(float(candidate[1])) <= zero_epsilon * 4.0
        ):
            return finish(candidate[0])
        target = crossing_target(previous, candidate)
        if target is not None:
            root_jd = refine_crossing(previous, candidate, target)
            if root_jd is not None:
                return finish(root_jd)

        if previous_left is not None:
            left_distance = winding_distance(previous_left)
            previous_distance = winding_distance(previous)
            candidate_distance = winding_distance(candidate)
            turn_tolerance = max(
                zero_epsilon * 4.0,
                previous_distance * 1.0e-8,
            )
            if (
                previous_distance < left_distance - turn_tolerance
                and candidate_distance > previous_distance + turn_tolerance
            ):
                tangent_jd = refine_turning_minimum(
                    previous_left,
                    candidate,
                    nearest_winding_target(previous),
                )
            else:
                tangent_jd = None
            if tangent_jd is not None:
                return finish(tangent_jd)

        elapsed = abs(candidate[0] - previous[0])
        local_rate = (
            abs(candidate[2] - previous[2]) / elapsed
            if elapsed > 0.0
            else relative_motion_budget
        )
        previous_left = previous
        previous = candidate
        # Retain bounded geometric expansion for slow trajectories, but reduce
        # the next step immediately when the local relationship accelerates.
        local_step_limit = 2.0 / max(local_rate, 1.0e-9)
        step = min(max_step, step * 1.35, max(epsilon, local_step_limit))
    return finish(None, "search-budget-exhausted")


def _jd_display_payload(chrt, exact_jd: float) -> dict[str, Any] | None:
    try:
        chart_mod = export_chart_json.chart_mod
        calflag = (
            astrology.SE_JUL_CAL
            if int(chrt.time.cal) == int(chart_mod.Time.JULIAN)
            else astrology.SE_GREG_CAL
        )
        utc_tuple = synodic_cycle.jd_to_datetime_tuple(float(exact_jd), calflag)
        display = moment.utc_to_chart_local(
            chrt.time,
            utc_tuple,
            place=getattr(chrt, "place", None),
        ) or utc_tuple
        y, month, day, hour, minute, second = [int(value) for value in display[:6]]
        value = datetime.datetime(y, month, day, hour, minute, second)
        return {
            "exactJd": float(exact_jd),
            "exactDatetime": value.isoformat(timespec="seconds"),
            "exactDate": dateformat.date_text(y, month, day, getattr(chrt, "options", None)),
            "exactTime": f"{hour:02d}:{minute:02d}:{second:02d}",
        }
    except Exception:
        return None


def _timeline_display_payload(
    chrt,
    exact_jd: float,
    motion_context: dict[str, Any],
) -> dict[str, Any] | None:
    trajectory_kind = str(motion_context.get("trajectoryKind") or "physical")
    if trajectory_kind not in ("supplementary", "pd_in_chart"):
        return _jd_display_payload(chrt, exact_jd)
    try:
        display_for_jd = motion_context.get("displayForJd")
        if callable(display_for_jd):
            values = display_for_jd(float(exact_jd))
        else:
            calflag = (
                astrology.SE_JUL_CAL
                if int(motion_context.get("calendar", chrt.time.cal))
                == int(export_chart_json.chart_mod.Time.JULIAN)
                else astrology.SE_GREG_CAL
            )
            values = synodic_cycle.jd_to_datetime_tuple(float(exact_jd), calflag)
        if values is None:
            return None
        y, month, day, hour, minute, second = [int(value) for value in values[:6]]
        value = datetime.datetime(y, month, day, hour, minute, second)
        return {
            "exactJd": float(exact_jd),
            "exactDatetime": value.isoformat(timespec="seconds"),
            "exactDate": dateformat.date_text(
                y, month, day, getattr(chrt, "options", None)
            ),
            "exactTime": f"{hour:02d}:{minute:02d}:{second:02d}",
        }
    except Exception:
        return None


def _perfection_for_row(
    primary,
    outer,
    selected_mode: str,
    row: dict[str, Any],
    role_contexts: dict[str, Any] | None = None,
    semantic_evaluator_cache: dict[Any, Any] | None = None,
) -> dict[str, Any]:
    def unavailable(reason: str) -> dict[str, Any]:
        return {
            "rowId": row["id"],
            "status": "unavailable",
            "reason": str(reason),
        }

    chart_by_role = {"primary": primary, "outer": outer}
    left = row["left"]
    right = row["right"]
    left_chart = chart_by_role.get(left.get("role"))
    right_chart = chart_by_role.get(right.get("role"))
    if left_chart is None or right_chart is None:
        return unavailable("missing-chart-role")

    exact_role = (
        "outer"
        if selected_mode in ("outer", "outerToPrimary", "primaryToOuter")
        else "primary"
    )
    exact_chart = outer if exact_role == "outer" else primary
    if exact_chart is None:
        return unavailable("missing-chart-role")
    exact_motion_context = _role_motion_context(
        role_contexts, exact_role, exact_chart,
    )
    trajectory_kind = str(
        exact_motion_context.get("trajectoryKind") or "physical"
    )
    if trajectory_kind == "static":
        return unavailable("static-trajectory")
    if trajectory_kind == "unsupported":
        return unavailable(
            str(exact_motion_context.get("unsupportedReason") or "unsupported-trajectory")
        )
    if (
        trajectory_kind in ("supplementary", "pd_in_chart")
        and not callable(exact_motion_context.get("builder"))
    ):
        return unavailable("missing-trajectory-builder")
    if not _role_evolves(exact_motion_context):
        return unavailable("unsupported-trajectory")

    phase = str(row.get("phase") or "none")
    if phase not in ("exact", "applying", "separating"):
        return unavailable(
            "no-relative-motion"
            if row.get("actorSide") is not None
            else "unsupported-endpoint-motion"
        )
    left_motion = _motion_endpoint(left_chart, left)
    right_motion = _motion_endpoint(right_chart, right)
    if left_motion is None or right_motion is None:
        return unavailable("unsupported-endpoint-motion")
    anchor_jd = _motion_anchor_jd(exact_motion_context, exact_chart)
    evolving_roles = {exact_role}
    search_failure = {"reason": "search-limit-reached"}
    source_frame_required = bool(
        trajectory_kind == "physical"
        and selected_mode in ("primary", "outer")
        and str(
            ((exact_motion_context.get("pointMotionPolicy") or {}).get("syzygy"))
            or ""
        ) == "anchor-fixed"
        and any(
            str((_endpoint_motion_ref(endpoint) or {}).get("kind") or "")
            == "syzygy"
            for endpoint in (left, right)
        )
    )

    if phase == "exact":
        exact_jd = float(anchor_jd)
    else:
        left_evolves = str(left.get("role") or "") in evolving_roles
        right_evolves = str(right.get("role") or "") in evolving_roles
        left_motion_context = _role_motion_context(
            role_contexts, str(left.get("role") or ""), left_chart
        )
        right_motion_context = _role_motion_context(
            role_contexts, str(right.get("role") or ""), right_chart
        )
        left_fixed = _relation_endpoint_is_anchor_fixed(
            left,
            evolves=left_evolves,
            motion_context=left_motion_context,
        )
        right_fixed = _relation_endpoint_is_anchor_fixed(
            right,
            evolves=right_evolves,
            motion_context=right_motion_context,
        )
        fast_search_used = False
        exact_jd = None
        if trajectory_kind == "physical":
            try:
                if (
                    left_evolves
                    and right_evolves
                    and not left_fixed
                    and not right_fixed
                    and left_motion.get("kind") == "planet"
                    and right_motion.get("kind") == "planet"
                ):
                    # The Swiss-body event engine searches the anchor-selected
                    # aspect branch directly.  It naturally crosses any
                    # number of stations/retrograde loops and cannot confuse
                    # the +/-180-degree wrap with an exact hit.
                    fast_search_used = True
                    exact_jd = _search_moving_pair(
                        exact_chart,
                        left_motion,
                        right_motion,
                        aspect_type=int(row["aspect"]["type"]),
                        orb=float(row["orb"]),
                        phase=phase,
                    )
                elif (
                    left_evolves
                    and not left_fixed
                    and left_motion.get("kind") == "planet"
                    and right_fixed
                ):
                    fast_search_used = True
                    exact_jd = _search_moving_to_fixed(
                        exact_chart,
                        left_motion,
                        right_motion,
                        aspect_type=int(row["aspect"]["type"]),
                        orb=float(row["orb"]),
                        phase=phase,
                    )
                elif (
                    right_evolves
                    and not right_fixed
                    and right_motion.get("kind") == "planet"
                    and left_fixed
                ):
                    fast_search_used = True
                    exact_jd = _search_moving_to_fixed(
                        exact_chart,
                        right_motion,
                        left_motion,
                        aspect_type=int(row["aspect"]["type"]),
                        orb=float(row["orb"]),
                        phase=phase,
                    )
            except Exception:
                # Optional/non-Swiss endpoint codes can legitimately be absent
                # from the fast kernel.  Preserve their canonical semantic
                # evaluator rather than turning a list-row request into a 500.
                fast_search_used = False
                exact_jd = None

        if fast_search_used:
            if exact_jd is None:
                search_failure["reason"] = "ephemeris-range-exhausted"
        else:
            exact_jd = _semantic_perfection_search(
                left_chart=left_chart,
                left=left,
                right_chart=right_chart,
                right=right,
                aspect_type=int(row["aspect"]["type"]),
                orb=float(row["orb"]),
                phase=phase,
                anchor_jd=anchor_jd,
                evolving_roles=evolving_roles,
                role_contexts=role_contexts,
                evaluator_cache=semantic_evaluator_cache,
                failure_reason=search_failure,
            )

    if exact_jd is None:
        return unavailable(search_failure["reason"])
    display = _timeline_display_payload(exact_chart, exact_jd, exact_motion_context)
    if display is None:
        return unavailable("invalid-timeline")
    return {
        "rowId": row["id"],
        **display,
        "status": "ready",
        "sourceFrameRequired": source_frame_required,
    }


def aspect_list_perfections(
    context: dict[str, Any],
    mode: str | None = None,
    max_orb: float = 10.0,
    row_id: str | None = None,
    row_ids: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """Resolve a bounded batch of exact instants after rows have painted.

    ``row_id`` remains the strict one-row path used by exact-open.  List paint
    uses ``row_ids`` for the current viewport/overscan slice.  Calls without an
    explicit selection retain compatibility but are capped; consumers must
    request subsequent batches rather than turning a symbolic chart into an
    all-rows, thousands-of-rebuild hot path.
    """
    if row_id is not None and row_ids is not None:
        raise ValueError("Specify row_id or row_ids, not both")
    requested_ids: list[str] | None = None
    if row_id is not None:
        requested_ids = [str(row_id)]
    elif row_ids is not None:
        requested_ids = list(dict.fromkeys(
            str(value) for value in row_ids if str(value)
        ))
        if len(requested_ids) > _MAX_PERFECTION_BATCH_ROWS:
            raise ValueError(
                f"Aspect List perfection batches are limited to "
                f"{_MAX_PERFECTION_BATCH_ROWS} rows"
            )

    primary, outer, _available, selected_mode, rows = _rows_for_mode(context, mode)
    eligible_rows = [
        row for row in rows
        if float(row.get("orb", 0.0)) <= float(max_orb)
    ]
    if requested_ids is None:
        selected_rows = eligible_rows[:_MAX_PERFECTION_BATCH_ROWS]
        truncated = len(eligible_rows) > len(selected_rows)
    else:
        eligible_by_id = {str(row.get("id")): row for row in eligible_rows}
        missing = [value for value in requested_ids if value not in eligible_by_id]
        if missing:
            raise ValueError("Aspect List row is no longer available")
        selected_rows = [eligible_by_id[value] for value in requested_ids]
        truncated = False
    role_contexts = context.get("role_contexts") or {}
    semantic_evaluator_cache: dict[Any, Any] = {}

    def resolve(row):
        if role_contexts:
            return _perfection_for_row(
                primary,
                outer,
                selected_mode,
                row,
                role_contexts,
                semantic_evaluator_cache,
            )
        return _perfection_for_row(primary, outer, selected_mode, row)

    return {
        "contextKey": _context_key(
            selected_mode,
            primary,
            outer,
            role_contexts,
            context,
        ),
        "activeMode": selected_mode,
        "rows": [resolve(row) for row in selected_rows],
        "truncated": truncated,
        "batchLimit": _MAX_PERFECTION_BATCH_ROWS,
    }
