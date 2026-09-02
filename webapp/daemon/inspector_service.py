# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Daemon-side inspector payload — the FLAGSHIP faithful translation.

The inspector's core content is built by
``chartinspector.build_payload(region, options)`` (chartinspector.py:922), which
already computes position, house, motion, declination, phasis, lunar
phase/tithi/mansion, essential-dignity rows, joy, mutual reception, last/next
aspect, and the aspect list — with glyphs and colours. ``chartinspector`` is
wx-free (verified: it imports cleanly daemon-side), so the daemon calls it
directly. The one extension is the Moon-only ``lunar_conditions`` block, which
serializes the canonical current-state calculation from ``engine.lunar_cycle``;
the daemon does not re-derive that state.

What this module DOES do is reproduce the ``region`` dict that the wx renderer
(graphchart.py) hands to ``build_payload`` — specifically ``region['data']`` —
using the same engine accessors graphchart uses. The construction below is a
faithful port of graphchart's hover-region ``data`` dicts:

    planet  → graphchart.py:2160-2195
    fortune → graphchart.py:2149-2150 (region_kind branch) + :2184-2195
    angle   → graphchart.py:1869-1877
    house   → graphchart.py:2018-2064
    sign    → graphchart.py:1787

For supplementary / comparison docs the hover identity follows the LIVE
ChartSession view mode, not the launcher kind:
  - supplementary CHART view (e.g. Solar Return singleton, morin.py:18060) ->
    visible chart = derived chart, no partner ring;
  - supplementary COMPOUND view (e.g. Transit biwheel, morin.py:17945) ->
    visible chart = radix, partner ring = derived chart;
  - comparison CHART view -> visible chart only;
  - comparison COMPOUND view -> visible chart + partner ring.
The React hit-test forwards that live view mode so the daemon resolves the same
chart object the wx renderer registered in its hover region.
"""
from __future__ import annotations

import math
import sys
import threading
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.supplementary_service import (
    SUPPLEMENTARY_KINDS,
    parse_when,
    supplementary_service,
)
from webapp.frontend.scripts import export_chart_json

import arabicparts
import astrology
import chart
import chartinspector
import common
import eclipses
from engine import harmonic_chart, lunar_cycle, pd_in_chart
import fixedstar_natures
import fixstars as fixstars_mod
import fortune as fortune_mod
import houses
import interchartaspects
import mtexts
import planets
import radixsignals
import util


# Region object_id for an angle → the key chartinspector / graphchart expect
# (chartinspector._ANGLE_LABELS uses 'asc'/'desc'/'mc'/'ic'; the React canvas
# emits 'asc'/'mc'/'dsc'/'ic'). Normalise 'dsc' → 'desc'.
_ANGLE_OBJECT_ID = {"asc": "asc", "mc": "mc", "dc": "desc", "dsc": "desc", "desc": "desc", "ic": "ic"}

# ascmc index per angle, for the angle longitude (mirrors graphchart angle_lons).
_ANGLE_ASCMC = {
    "asc": houses.Houses.ASC,
    "mc": houses.Houses.MC,
}

_ANGLE_HOUSE = {
    "asc": 1,
    "mc": 10,
    "desc": 7,
    "ic": 4,
}


def _body_obj(chrt, body_id):
    """graphchart._get_body_obj — None for Fortune/Vertex pseudo-bodies."""
    if body_id in (planets.Planets.PLANETS_NUM, common.CHART_OBJECT_VERTEX):
        return None
    return common.common.get_chart_planet(chrt, body_id)


def _body_lon(chrt, body_id):
    if body_id == planets.Planets.PLANETS_NUM:
        return chrt.fortune.fortune[fortune_mod.Fortune.LON]
    if body_id == common.CHART_OBJECT_VERTEX:
        return chrt.houses.ascmc[houses.Houses.VERTEX]
    obj = _body_obj(chrt, body_id)
    return None if obj is None else obj.data[planets.Planet.LONG]


def _body_speed_lon(chrt, body_id):
    if body_id in (planets.Planets.PLANETS_NUM, common.CHART_OBJECT_VERTEX):
        return None
    obj = _body_obj(chrt, body_id)
    return None if obj is None else obj.data[planets.Planet.SPLON]


def _body_declination(chrt, body_id):
    if body_id in (planets.Planets.PLANETS_NUM, common.CHART_OBJECT_VERTEX):
        return None
    obj = _body_obj(chrt, body_id)
    return None if obj is None else obj.dataEqu[planets.Planet.DECLEQU]


def _body_colour(chrt, body_id, options):
    """Port of graphchart._get_body_color (round-wheel, non-bw, non-outer path).

    Returns the accent (r,g,b) the inspector tints the glyph with.
    """
    if body_id == planets.Planets.PLANETS_NUM:
        if getattr(options, "useplanetcolors", False):
            idx = min(astrology.SE_PLUTO + 2, len(options.clrindividual) - 1)
            return tuple(options.clrindividual[idx])
        return tuple(options.clrperegrin)
    if body_id == common.CHART_OBJECT_VERTEX:
        return tuple(options.clrperegrin)
    if getattr(options, "useplanetcolors", False):
        color_idx = min(common.common.get_planet_color_index(body_id), len(options.clrindividual) - 1)
        return tuple(options.clrindividual[color_idx])
    if body_id == astrology.SE_CHIRON:
        return tuple(options.clrperegrin)
    try:
        palette = (
            tuple(options.clrdomicil), tuple(options.clrexal), tuple(options.clrperegrin),
            tuple(options.clrcasus), tuple(options.clrexil),
        )
        return palette[chrt.dignity(body_id)]
    except Exception:
        return tuple(options.clrperegrin)


def _motion_marker(chrt, body_id, speed_lon, options, has_partner):
    """Port of the marker logic at graphchart.py:2160-2168.

    Station marker (within 1 day) wins; else 'S' (stationary, speed<=0) or 'R'
    (retrograde, speed<0). Station signals are suppressed on biwheels (chart2).
    """
    if not has_partner:
        try:
            sm = radixsignals.get_station_marker(chrt, body_id, within_days=1.0, options=options)
        except Exception:
            sm = None
        if sm is not None:
            return sm
    if speed_lon is not None and speed_lon <= 0.0:
        return "R" if speed_lon < 0.0 else "S"
    return ""


def _house_index(chrt, lon, options):
    try:
        return int(chrt.houses.getHousePos(lon, options, False)) + 1
    except Exception:
        return None


def _planet_region(chrt, partner_chart, options, body_id, chart_role="primary"):
    """Reproduce graphchart.py:2174-2196 planet hover-region data.

    For an OUTER-ring body the caller passes the comparison chart as ``chrt`` and
    the radix as ``partner_chart``, plus chart_role='outer' — exactly the swap
    graphchart does (partner_chart = self.chart if outer else self.chart2,
    graphchart.py:2157-2159)."""
    lon = _body_lon(chrt, body_id)
    if lon is None:
        raise SystemExit(f"body {body_id} not present in chart")
    speed_lon = _body_speed_lon(chrt, body_id)
    display_lon = lon
    data = {
        "chart": chrt,
        "partner_chart": partner_chart,
        "planet_index": body_id,
        "longitude": lon,
        "display_lon": display_lon,
        "house_index": _house_index(chrt, lon, options),
        "motion_marker": _motion_marker(chrt, body_id, speed_lon, options, partner_chart is not None),
        "speed_lon": speed_lon,
        "declination": _body_declination(chrt, body_id),
        "colour": _body_colour(chrt, body_id, options),
    }
    return {"kind": "planet", "object_id": int(body_id), "chart_role": chart_role, "data": data}


def _lunar_conditions_payload(region) -> Optional[dict]:
    """Serialize the canonical lunar-condition state for a Moon region.

    The state itself belongs to ``engine.lunar_cycle``.  Keeping this adapter
    next to the region builder means inner- and outer-ring Moon inspectors use
    the exact chart object and Julian date that the hovered glyph represents.
    """
    if region.get("kind") != "planet" or int(region.get("object_id", -1)) != astrology.SE_MOON:
        return None
    chrt = region.get("data", {}).get("chart")
    if chrt is None:
        return None
    state = lunar_cycle.lunar_condition_snapshot(chrt, float(chrt.time.jd))
    return {
        "increasing_in_light": bool(state.increasing_in_light),
        "increasing_in_latitude": bool(state.increasing_in_latitude),
        "increasing_in_number": bool(state.increasing_in_number),
        "swift": bool(state.swift),
        "longitude_speed": float(state.longitude_speed),
        "longitude_acceleration": float(state.longitude_acceleration),
        "latitude": float(state.latitude),
        "latitude_speed": float(state.latitude_speed),
        "elongation": float(state.elongation),
        "exact_states": list(state.exact_states),
    }


def _pd_event_region(context: dict, event_id: str) -> dict:
    """Validate one live supported PD marker and build its dedicated region."""
    state = context.get("state")
    overlay = context.get("overlay")
    binding = context.get("binding") or {}
    requested = str(event_id or "")
    if not requested or not isinstance(state, dict):
        raise SystemExit("primary-direction event is unavailable")
    if requested != str(state.get("eventId") or ""):
        raise SystemExit("stale primary-direction event")
    if str(binding.get("eventId") or "") != requested:
        raise SystemExit("stale primary-direction event binding")
    if (
        not isinstance(overlay, dict)
        or not bool(overlay.get("supported"))
        or str(overlay.get("eventId") or "") != requested
    ):
        raise SystemExit("primary-direction event has no supported marker")
    if overlay.get("eventKind") not in {
        "body-aspect-to-angle",
        "angle-to-body-aspect",
    }:
        raise SystemExit("unsupported primary-direction event marker family")
    primitives = overlay.get("primitives")
    expected_primitive_kinds = {"direction-ray", "directed-angle"}
    if not isinstance(primitives, list) or not primitives:
        raise SystemExit("primary-direction event marker has no geometry")
    primitive_kinds = set()
    for item in primitives:
        if not isinstance(item, dict) or item.get("kind") not in expected_primitive_kinds:
            raise SystemExit("unsupported primary-direction event marker primitive")
        try:
            longitude = float(item.get("longitude"))
        except (TypeError, ValueError, OverflowError):
            raise SystemExit("primary-direction event marker has no geometry")
        if not math.isfinite(longitude):
            raise SystemExit("primary-direction event marker has no geometry")
        primitive_kinds.add(item["kind"])
    if primitive_kinds != expected_primitive_kinds:
        raise SystemExit("primary-direction event marker has incomplete geometry")
    event = binding.get("directionEvent")
    if not isinstance(event, dict):
        raise SystemExit("primary-direction selected row is unavailable")
    if pd_in_chart._selected_event_id(event) != requested:
        raise SystemExit("stale primary-direction selected row")
    event_datetime = (
        binding.get("initialDisplayDatetime")
        if bool(binding.get("hasEventDatetime"))
        else None
    )
    return {
        "kind": "pd_event",
        "object_id": requested,
        "chart_role": "primary",
        "data": {
            "direction_state": state,
            "event_overlay": overlay,
            "direction_event": event,
            "event_datetime": event_datetime,
            "prom_parts": list(event.get("promParts") or []),
            "sig_parts": list(event.get("sigParts") or []),
        },
    }


def _vertex_region(chrt, partner_chart, options, chart_role):
    """Reproduce graphchart's Vertex hover-region data (graphchart.py:2174-2196,
    body_id == common.CHART_OBJECT_VERTEX). The Vertex is drawn via
    _iter_draw_body_ids with object_id = CHART_OBJECT_VERTEX and registered as a
    'planet' region carrying a 'title' of mtexts.txts['Vertex']. We hand
    chartinspector.build_flag_payload a kind='planet' region with that object_id;
    build_flag_payload calls _planet_name(CHART_OBJECT_VERTEX) → 'Vertex' and
    _planet_glyph(CHART_OBJECT_VERTEX) → the Vertex glyph (common.py:404,425).
    This is the fix for the prior bug where the Vertex resolved to sign 0."""
    body_id = common.CHART_OBJECT_VERTEX
    lon = _body_lon(chrt, body_id)
    if lon is None:
        raise SystemExit("vertex not present in chart")
    display_lon = lon
    data = {
        "chart": chrt,
        "partner_chart": partner_chart,
        "planet_index": body_id,
        "longitude": lon,
        "display_lon": display_lon,
        "house_index": _house_index(chrt, lon, options),
        "motion_marker": "",
        "speed_lon": None,
        "declination": None,
        "colour": _body_colour(chrt, body_id, options),
        "title": mtexts.txts.get("Vertex", "Vertex"),
    }
    return {"kind": "planet", "object_id": int(body_id), "chart_role": chart_role, "data": data}


def _fortune_region(chrt, options, chart_role="primary", partner_chart=None):
    lon = _body_lon(chrt, planets.Planets.PLANETS_NUM)
    display_lon = lon
    data = {
        "chart": chrt,
        "partner_chart": partner_chart,
        "longitude": lon,
        "display_lon": display_lon,
        "house_index": _house_index(chrt, lon, options),
        "colour": _body_colour(chrt, planets.Planets.PLANETS_NUM, options),
    }
    return {"kind": "fortune", "object_id": "fortune", "chart_role": chart_role, "data": data}


def _syzygy_region(chrt, options, chart_role="primary", partner_chart=None):
    syz = getattr(chrt, "syzygy", None)
    try:
        lon = float(syz.lon)
    except Exception:
        raise SystemExit("syzygy not present in chart")
    display_lon = lon
    data = {
        "chart": chrt,
        "partner_chart": partner_chart,
        "longitude": lon,
        "display_lon": display_lon,
        "house_index": _house_index(chrt, lon, options),
        "colour": tuple(getattr(options, "clrsigns", ())),
        "title": mtexts.txts.get("PrenatalSyzygy", "Prenatal Syzygy"),
    }
    return {"kind": "syzygy", "object_id": "syzygy", "chart_role": chart_role, "data": data}


def _eclipse_region(chrt, options, chart_role="primary", partner_chart=None):
    try:
        event, _exact_jd, lon = eclipses.selected_prenatal_eclipse_point(chrt, options)
    except Exception:
        raise SystemExit("recent eclipse longitude unavailable")
    if getattr(event, "saros", None) in (None, "", eclipses._SAROS_UNSET):
        eclipses._assign_saros(event)
    is_solar = bool(getattr(event, "is_solar", False))
    eclipse_type = radixsignals._eclipse_kind_label(event)
    eclipse_kind = mtexts.txts.get("Solar2" if is_solar else "Lunar2", "Solar" if is_solar else "Lunar")
    title = mtexts.txts.get("EclipseLabelFormat", "{kind} {luminary} Eclipse").format(
        kind=eclipse_type,
        luminary=mtexts.txts.get(
            "EclipseSolar" if is_solar else "EclipseLunar",
            eclipse_kind,
        ),
    )
    data = {
        "chart": chrt,
        "partner_chart": partner_chart,
        "longitude": lon,
        "display_lon": lon,
        "house_index": _house_index(chrt, lon, options),
        "colour": tuple(getattr(options, "clrsigns", ())),
        "title": str(title),
        "eclipse_kind": str(eclipse_kind),
        "eclipse_type": str(eclipse_type),
        "saros": str(getattr(event, "saros", eclipses._SAROS_UNSET) or eclipses._SAROS_UNSET),
        "event_jd": float(getattr(event, "jdut", _exact_jd)),
        "is_solar": is_solar,
    }
    return {"kind": "eclipse", "object_id": "eclipse", "chart_role": chart_role, "data": data}


def _angle_region(chrt, partner_chart, options, angle_key, chart_role="primary"):
    object_id = _ANGLE_OBJECT_ID.get(angle_key, angle_key)
    ascmc = chrt.houses.ascmc
    if object_id == "asc":
        lon = chart.semantic_angle_longitude(chrt, "asc")
        declination = chrt.houses.ascmc2[houses.Houses.ASC][houses.Houses.DECL]
    elif object_id == "mc":
        lon = chart.semantic_angle_longitude(chrt, "mc")
        declination = chrt.houses.ascmc2[houses.Houses.MC][houses.Houses.DECL]
    elif object_id == "desc":
        lon = chart.semantic_angle_longitude(chrt, "dsc")
        declination = -chrt.houses.ascmc2[houses.Houses.ASC][houses.Houses.DECL]
    elif object_id == "ic":
        lon = chart.semantic_angle_longitude(chrt, "ic")
        declination = -chrt.houses.ascmc2[houses.Houses.MC][houses.Houses.DECL]
    else:
        raise SystemExit(f"unknown angle {angle_key}")
    display_lon = lon
    data = {
        "chart": chrt,
        "partner_chart": partner_chart,
        "longitude": lon,
        "display_lon": display_lon,
        "house_index": _ANGLE_HOUSE[object_id],
        "declination": declination,
        "colour": tuple(options.clrAscMC),
    }
    return {"kind": "angle", "object_id": object_id, "chart_role": chart_role, "data": data}


def _house_region(chrt, options, house_index):
    house_index = max(1, int(house_index))
    lon = chrt.houses.cusps[house_index]
    display_lon = lon
    data = {"chart": chrt, "longitude": lon, "display_lon": display_lon}
    return {"kind": "house", "object_id": house_index, "chart_role": "primary", "data": data}


def _sign_region(chrt, options, sign_index):
    sign_index = int(sign_index) % chart.Chart.SIGN_NUM
    return {"kind": "sign", "object_id": sign_index, "chart_role": "primary", "data": {"chart": chrt}}


# ---------------------------------------------------------------------------
# secondary_ring — outer-ring item hover (fixed star / lot / midpoint /
# asteroid / antiscia / contra / dodecatemoria). Faithful port of the
# graphchart ``data`` dicts (graphchart.py:3879-3897 fixstar, :4440-4453 lot,
# :4241-4257 midpoint, :4692-4710 antiscia/contra/dodec) consumed by
# chartinspector._build_secondary_ring_payload (chartinspector.py:1297). The
# React canvas emits the frontend OuterRingItem family ('fixstar', 'arabic_part',
# 'midpoint', 'asteroid', 'antiscia', 'contra_antiscia', 'dodecatemoria'); the
# daemon owns the meaning — re-deriving nature/formula/title from engine data.
# ---------------------------------------------------------------------------

# Frontend OuterRingItem.family → the family chartinspector keys on.
_RING_FAMILY_MAP = {
    "fixstar": "fixed_star",
    "fixed_star": "fixed_star",
    "arabic_part": "lot",
    "lot": "lot",
    "midpoint": "midpoint",
    "asteroid": "asteroid",
    "antiscia": "antiscia",
    "contra_antiscia": "contra_antiscia",
    "dodecatemoria": "dodecatemoria",
    "hybrid_hit": "secondary_ring",
    "parallel_transits": "parallel_transits",
}

# Overlay-family glyphs come from the planet that generated the projected point.
_OVERLAY_FAMILIES = {"antiscia", "contra_antiscia", "dodecatemoria"}


def _overlay_source_se_id(label):
    """Resolve an overlay source label back to its planet id when possible."""
    text = str(label or "").strip()
    if not text:
        return None
    normalized = text
    stripped = True
    while stripped:
        stripped = False
        for suffix in ("(12th)", "(D12)", "(d12)", "(T)"):
            if normalized.endswith(suffix):
                normalized = normalized[: -len(suffix)].strip()
                stripped = True
                break
    key = normalized.lower()
    if key in _PLANET_NAME_TO_SE:
        return _PLANET_NAME_TO_SE[key]
    for se_id in export_chart_json.PLANET_ID_MAP:
        try:
            if export_chart_json.planet_display_label(se_id).lower() == key:
                return int(se_id)
        except Exception:
            continue
    aliases = {
        "asc. node": astrology.SE_MEAN_NODE,
        "ascending node": astrology.SE_MEAN_NODE,
        "north node": astrology.SE_MEAN_NODE,
        "dsc. node": astrology.SE_TRUE_NODE,
        "descending node": astrology.SE_TRUE_NODE,
        "south node": astrology.SE_TRUE_NODE,
    }
    return aliases.get(key)


def _display_lon(chrt, options, lon):
    return util.normalize(lon)


def _find_fixstar(chrt, lon):
    """Nearest star in chrt.fixstars.data to *lon* (ecliptic). graphchart keys
    the hover by index; the daemon keys by longitude (the shared snapshot field)
    then reads the same NOMNAME/NAME slots."""
    fsdata = getattr(getattr(chrt, "fixstars", None), "data", None)
    if not fsdata:
        return None
    best = None
    best_diff = None
    for row in fsdata:
        diff = abs(util.normalize(row[fixstars_mod.FixStars.LON] - lon + 180.0) - 180.0)
        if best_diff is None or diff < best_diff:
            best_diff = diff
            best = row
    # Tolerate the rounding the snapshot longitude went through.
    if best is None or best_diff is None or best_diff > 0.05:
        return None
    return best


def _secondary_ring_region(chrt, options, object_id, chart_role="primary"):
    """Rebuild graphchart's secondary-ring ``data`` dict from the objectId
    ``family|longitude|label`` the React canvas emits for an outer-ring item."""
    parts = str(object_id).split("|")
    raw_family = parts[0] if parts else ""
    family = _RING_FAMILY_MAP.get(raw_family, raw_family or "secondary_ring")
    try:
        longitude = float(parts[1]) if len(parts) > 1 and parts[1] != "" else None
    except (TypeError, ValueError):
        longitude = None
    label = parts[2] if len(parts) > 2 else ""
    display_lon = _display_lon(chrt, options, longitude) if longitude is not None else None

    data = {
        "chart": chrt,
        "family": family,
        "title": label or None,
        "longitude": longitude,
        "display_lon": display_lon,
    }

    if family == "fixed_star" and longitude is not None:
        star = _find_fixstar(chrt, longitude)
        if star is not None:
            code = star[fixstars_mod.FixStars.NOMNAME]
            name = star[fixstars_mod.FixStars.NAME]
            data["fixstar_code"] = code
            data["fixstar_name"] = name
            data["fixstar_nature"] = fixedstar_natures.as_payload(code)
        if not data.get("title"):
            data["title"] = label or data.get("fixstar_name") or "Fixed star"
    elif family == "lot":
        # Faithful port of graphchart.drawArabicParts (graphchart.py:4374-4439):
        # day/night flag drives the active triplet; the Lot of Fortune itself is
        # not in options.arabicparts so it uses its own variant-aware formatter.
        formula_text = None
        try:
            lof_above = bool(chrt.fortune.abovehorizon)
        except Exception:
            lof_above = bool(getattr(chrt, "abovehorizonwithorb", True))
        chart_male = bool(getattr(chrt, "male", True))
        lof_name = mtexts.txts.get("LotOfFortune", "Fortuna")
        try:
            if label == lof_name:
                formula_text = arabicparts.format_lof_formula_text(
                    options.lotoffortune, lof_above,
                )
            else:
                ar_item = arabicparts.ArabicParts.find_ar_item_by_name(
                    getattr(options, "arabicparts", None), label,
                )
                if ar_item is not None:
                    formula_text = arabicparts.ArabicParts.format_formula_text(
                        ar_item, lof_above, chart_male,
                    )
        except Exception:
            formula_text = None
        data["formula"] = formula_text
        if not data.get("title"):
            data["title"] = label or "Lot"
    elif family in _OVERLAY_FAMILIES:
        # graphchart registers glyph + source_name for the projected point. The
        # label the canvas carries is the source body's name/glyph text.
        source_se_id = _overlay_source_se_id(label)
        if source_se_id is not None:
            source_name = export_chart_json.overlay_source_display_label(source_se_id, family, options)
            data["source_name"] = source_name
            data["title"] = source_name
            data["glyph"] = common.common.get_planet_glyph(source_se_id)
            data["glyph_font"] = "morinus"
        else:
            data["source_name"] = label or None
            data["glyph"] = ""
            data["glyph_font"] = "text"
            if not data.get("title"):
                data["title"] = label or family
    elif family == "parallel_transits":
        source_se_id = _overlay_source_se_id(label)
        if source_se_id is not None:
            data["source_name"] = export_chart_json.planet_display_label(source_se_id, options)
            data["glyph"] = common.common.get_planet_glyph(source_se_id)
            data["glyph_font"] = "morinus"
        elif label == mtexts.txts.get("LotOfFortune", "Fortuna"):
            data["source_name"] = label
            data["glyph"] = common.common.fortune
            data["glyph_font"] = "morinus"
        else:
            data["source_name"] = label or None
        data["title"] = label or "Parallel Transit"
    else:
        if not data.get("title"):
            data["title"] = label or "Ring item"

    return {"kind": "secondary_ring", "object_id": object_id, "chart_role": chart_role, "data": data}


# ---------------------------------------------------------------------------
# aspect — aspect-glyph / aspect-line hover. Faithful port of
# graphchart._aspect_hover_data (graphchart.py:734) + the body-info builders
# (:776 planet, :789 angle, :805 fortune), consumed by the chartinspector
# 'aspect' branch (chartinspector.py:1099). The React canvas emits the same
# endpoint encoding the snapshot uses (export_chart_json.export_aspects:357):
# planet name strings + 'asc'/'mc'/'fortune'. objectId = 'p1:p2:type'.
# ---------------------------------------------------------------------------

# Inverse of export_chart_json.PLANET_ID_MAP (planet string id → SE id).
_PLANET_NAME_TO_SE = {name: se for se, name in export_chart_json.PLANET_ID_MAP.items()}


def _aspect_angle_lon(chrt, key):
    try:
        if key in ("asc", "mc", "dc", "dsc", "desc", "ic"):
            return float(chart.semantic_angle_longitude(chrt, key))
    except Exception:
        return None
    return None


def _aspect_angle_label(key):
    if key == "asc":
        return "Asc"
    if key == "mc":
        return "MC"
    if key in ("dc", "dsc", "desc"):
        return "DC"
    if key == "ic":
        return "IC"
    return "Angle"


def _aspect_point_lon(key):
    if not str(key).startswith("point:"):
        return None
    try:
        return float(str(key).rsplit(":", 1)[1])
    except Exception:
        return None


def _parse_aspect_object_id(object_id):
    parts = str(object_id).split(":")
    if len(parts) < 3:
        raise SystemExit(f"malformed aspect objectId {object_id!r}")
    type_str = parts[-1]
    endpoint_parts = parts[:-1]
    if endpoint_parts[0] == "point" and len(endpoint_parts) >= 6:
        p1_key = ":".join(endpoint_parts[:5])
        p2_key = ":".join(endpoint_parts[5:])
    elif len(endpoint_parts) >= 6 and endpoint_parts[1] == "point":
        p1_key = endpoint_parts[0]
        p2_key = ":".join(endpoint_parts[1:6])
    else:
        p1_key = endpoint_parts[0]
        p2_key = ":".join(endpoint_parts[1:])
    if not p1_key or not p2_key:
        raise SystemExit(f"malformed aspect objectId {object_id!r}")
    return p1_key, p2_key, type_str


def _aspect_body_info(chrt, key, role="primary"):
    """Mirror graphchart._planet_body_info / _angle_body_info / _fortune_body_info
    for a single aspect endpoint string."""
    angle_lon = _aspect_angle_lon(chrt, key)
    if angle_lon is not None:
        return {
            "kind": "angle",
            "label": _aspect_angle_label(key),
            "lon": float(angle_lon),
        }
    if key == "fortune":
        try:
            lon = chrt.fortune.fortune[fortune_mod.Fortune.LON]
        except Exception:
            lon = None
        return {
            "kind": "fortune",
            "label": mtexts.txts.get("Fortune", "Fortune"),
            "glyph": common.common.fortune,
            "lon": float(lon) if lon is not None else None,
        }
    if key == "vertex":
        try:
            lon = chrt.houses.ascmc[houses.Houses.VERTEX]
        except Exception:
            lon = None
        return {
            "kind": "vertex",
            "label": mtexts.txts.get("Vertex", "Vertex"),
            "lon": float(lon) if lon is not None else None,
        }
    if key == "syzygy":
        try:
            lon = chrt.syzygy.lon
        except Exception:
            lon = None
        return {
            "kind": "syzygy",
            "label": mtexts.txts.get("PrenatalSyzygy", "Prenatal Syzygy"),
            "lon": float(lon) if lon is not None else None,
        }
    point_lon = _aspect_point_lon(key)
    if point_lon is not None:
        return {
            "kind": "point",
            "label": mtexts.txts.get("Point", "Point"),
            "lon": float(point_lon),
        }
    se = _PLANET_NAME_TO_SE.get(key)
    if se is None:
        return None
    obj = _body_obj(chrt, se)
    if obj is None:
        return None
    lon = obj.data[planets.Planet.LONG]
    speed = obj.data[planets.Planet.SPLON]
    return {
        "kind": "planet",
        "index": int(se),
        "lon": float(lon),
        "speed": float(speed) if speed is not None else None,
        "role": role,
    }


def _aspect_endpoint_motion(chrt, key):
    angle_lon = _aspect_angle_lon(chrt, key)
    if angle_lon is not None:
        return (float(angle_lon), 0.0, None)
    if key == "fortune":
        try:
            return (float(chrt.fortune.fortune[fortune_mod.Fortune.LON]), 0.0, None)
        except Exception:
            return (None, None, None)
    if key == "vertex":
        try:
            return (float(chrt.houses.ascmc[houses.Houses.VERTEX]), 0.0, None)
        except Exception:
            return (None, None, None)
    if key == "syzygy":
        try:
            return (float(chrt.syzygy.lon), 0.0, None)
        except Exception:
            return (None, None, None)
    point_lon = _aspect_point_lon(key)
    if point_lon is not None:
        return (float(point_lon), 0.0, None)
    se = _PLANET_NAME_TO_SE.get(key)
    if se is None:
        return (None, None, None)
    obj = _body_obj(chrt, se)
    if obj is None:
        return (None, None, None)
    try:
        return (
            float(obj.data[planets.Planet.LONG]),
            float(obj.data[planets.Planet.SPLON]),
            int(se),
        )
    except Exception:
        return (None, None, int(se))


def _aspect_endpoint_orbs(chrt, key, aspect_type):
    se = _PLANET_NAME_TO_SE.get(key)
    if se is not None:
        try:
            return float(chrt.options.orbis[chrt.get_planet_orb_index(se)][aspect_type])
        except Exception:
            return 0.0
    if _aspect_angle_lon(chrt, key) is not None:
        try:
            return float(chrt.options.orbisAscMC[aspect_type])
        except Exception:
            return 0.0
    return 0.0


def _aspect_from_region_type(chrt, p1_key, p2_key, aspect_type):
    try:
        aspect_type = int(aspect_type)
    except Exception:
        return None
    if aspect_type < 0 or aspect_type >= chart.Chart.ASPECT_NUM:
        return None
    lon1, speed1, se1 = _aspect_endpoint_motion(chrt, p1_key)
    lon2, speed2, se2 = _aspect_endpoint_motion(chrt, p2_key)
    if lon1 is None or lon2 is None:
        return None
    asp = chart.Asp()
    asp.typ = int(aspect_type)
    asp.dif = chart.Chart._aspect_distance_static(lon1, lon2)
    asp.aspdif = abs(asp.dif - chart.Chart.Aspects[int(aspect_type)])
    asp.exact = asp.aspdif <= float(getattr(chrt.options, "exact", 0.0))
    asp.max_orb = (
        _aspect_endpoint_orbs(chrt, p1_key, int(aspect_type))
        + _aspect_endpoint_orbs(chrt, p2_key, int(aspect_type))
    )
    if asp.max_orb > 0.0 and asp.aspdif > asp.max_orb:
        return None
    try:
        asp.appl = bool(chrt._is_applying_dynamic(lon1, speed1 or 0.0, lon2, speed2 or 0.0, int(aspect_type)))
    except Exception:
        asp.appl = False
    return asp


def _interchart_aspect_from_region_type(inner_chart, outer_chart, options, inner_key, outer_key, aspect_type):
    try:
        aspect_type = int(aspect_type)
    except Exception:
        return None
    if aspect_type < 0 or aspect_type >= chart.Chart.ASPECT_NUM:
        return None
    inner_lon, inner_speed, inner_se = _aspect_endpoint_motion(inner_chart, inner_key)
    outer_lon, outer_speed, outer_se = _aspect_endpoint_motion(outer_chart, outer_key)
    if inner_lon is None or outer_lon is None:
        return None

    asp = chart.Asp()
    asp.typ = int(aspect_type)
    delta, distance = interchartaspects._aspect_delta(inner_lon, outer_lon, int(aspect_type))
    asp.dif = distance
    asp.aspdif = delta
    asp.exact = delta <= float(getattr(options, "exact", 0.0))
    asp.max_orb = (
        _aspect_endpoint_orbs(inner_chart, inner_key, int(aspect_type))
        + _aspect_endpoint_orbs(outer_chart, outer_key, int(aspect_type))
    )
    if asp.max_orb > 0.0 and asp.aspdif > asp.max_orb:
        return None
    try:
        asp.appl = bool(
            chart.Chart.directed_aspect_state_from_motion(
                int(inner_se) if inner_se is not None else -1,
                int(outer_se) if outer_se is not None else -2,
                inner_lon,
                inner_speed or 0.0,
                outer_lon,
                outer_speed or 0.0,
                int(aspect_type),
            ).get("is_applying")
        )
    except Exception:
        asp.appl = False
    return asp


def _resolve_aspect(chrt, p1_key, p2_key, aspect_type=None):
    """Recompute the Asp object the renderer drew, via the same accessors
    export_chart_json.export_aspects used."""
    a = _PLANET_NAME_TO_SE.get(p1_key)
    b = _PLANET_NAME_TO_SE.get(p2_key)
    asp = None
    if a is not None and b is not None:
        asp = chrt.get_planetary_aspect(a, b)
    elif a is not None and p2_key in ("asc", "mc"):
        angle_idx = houses.Houses.ASC if p2_key == "asc" else houses.Houses.MC
        asp = chrt.get_ascmc_aspect(angle_idx, a)
    elif b is not None and p1_key in ("asc", "mc"):
        angle_idx = houses.Houses.ASC if p1_key == "asc" else houses.Houses.MC
        asp = chrt.get_ascmc_aspect(angle_idx, b)
    elif a is not None and p2_key == "fortune":
        asp = chrt.get_lof_aspect(a)
    elif b is not None and p1_key == "fortune":
        asp = chrt.get_lof_aspect(b)
    try:
        desired = int(aspect_type) if aspect_type is not None else None
    except Exception:
        desired = None
    if asp is not None and asp.typ != chart.Chart.NONE and (desired is None or int(asp.typ) == desired):
        return asp
    fallback = _aspect_from_region_type(chrt, p1_key, p2_key, desired)
    if fallback is not None:
        return fallback
    return asp


def _aspect_hover_data(chrt, options, asp, body_a, body_b):
    """Faithful port of graphchart._aspect_hover_data (graphchart.py:734)."""
    clr = (0, 0, 0)
    try:
        clr = tuple(options.clraspect[asp.typ])
    except Exception:
        pass
    data = {
        "chart": chrt,
        "aspect_type": asp.typ,
        "colour": clr,
        "orb": float(getattr(asp, "aspdif", 0.0)),
        "exact": bool(getattr(asp, "exact", False)),
        "applying": bool(getattr(asp, "appl", False)),
    }
    if not isinstance(body_a, dict) or not isinstance(body_b, dict):
        return data
    actor, target = body_a, body_b
    a_speed = body_a.get("speed")
    b_speed = body_b.get("speed")
    if (
        body_a.get("kind") == "planet"
        and body_b.get("kind") == "planet"
        and a_speed is not None
        and b_speed is not None
    ):
        try:
            cross_role = body_a.get("role") != body_b.get("role")
            if cross_role:
                state = chartinspector.relative_cross_chart_aspect_state(body_a, body_b, int(asp.typ))
            else:
                state = chart.Chart.directed_aspect_state_from_motion(
                    int(body_a["index"]), int(body_b["index"]),
                    float(body_a["lon"]), float(a_speed),
                    float(body_b["lon"]), float(b_speed),
                    int(asp.typ),
                )
            # Same-chart aspects already carry the engine's canonical phase in
            # asp.appl.  Only a cross-ring relation needs role-relative motion.
            if state is not None and cross_role:
                data["applying"] = bool(state.get("is_applying"))
            if state is not None and state.get("actor_side") == "other":
                actor, target = body_b, body_a
            elif state is not None and state.get("actor_id") == int(body_b["index"]):
                actor, target = body_b, body_a
        except Exception:
            pass
    elif body_a.get("kind") != "planet" and body_b.get("kind") == "planet":
        actor, target = body_b, body_a
    data["actor"] = actor
    data["target"] = target
    return data


def _aspect_region(chrt, options, object_id):
    p1_key, p2_key, type_str = _parse_aspect_object_id(object_id)
    try:
        aspect_type = int(type_str)
    except (TypeError, ValueError):
        aspect_type = chart.Chart.NONE
    asp = _resolve_aspect(chrt, p1_key, p2_key, aspect_type)
    if asp is None or asp.typ == chart.Chart.NONE:
        raise SystemExit(f"no aspect for {p1_key}/{p2_key}")
    body_a = _aspect_body_info(chrt, p1_key)
    body_b = _aspect_body_info(chrt, p2_key)
    data = _aspect_hover_data(chrt, options, asp, body_a, body_b)
    return {"kind": "aspect", "object_id": int(aspect_type), "chart_role": "primary", "data": data}


def _drishti_region(chrt, options, object_id):
    relations = harmonic_chart.varga_drishti_relations(
        chrt,
        getattr(options, "varga_drishti_mode", harmonic_chart.DEFAULT_DRISHTI_MODE),
        include_node_special=bool(
            getattr(options, "varga_node_special_drishti", False)
        ),
    )
    relation = next(
        (row for row in relations if str(row.get("id")) == str(object_id)),
        None,
    )
    if relation is None:
        raise SystemExit(f"no dṛṣṭi relation for {object_id}")
    actor_id = relation.get("actor_id")
    if actor_id is None:
        colour = tuple(common.get_sign_color(options, int(relation["actor_sign"])))
    else:
        colour = _body_colour(chrt, int(actor_id), options)
    return {
        "kind": "drishti",
        "object_id": str(object_id),
        "chart_role": "primary",
        "data": {
            "chart": chrt,
            "colour": colour,
            **relation,
        },
    }


def _interchart_aspect_region(chrt, partner_chart, options, object_id):
    parts = str(object_id).split(":")
    if len(parts) != 4 or parts[0] != "interchart":
        raise SystemExit(f"malformed interchart aspect objectId {object_id!r}")
    if partner_chart is None:
        raise SystemExit("interchart aspect hover requires comparison chart")
    _, inner_key, outer_key, type_str = parts
    try:
        aspect_type = int(type_str)
    except (TypeError, ValueError):
        aspect_type = chart.Chart.NONE
    inner_idx = _PLANET_NAME_TO_SE.get(inner_key)
    outer_idx = _PLANET_NAME_TO_SE.get(outer_key)

    asp = None
    if inner_idx is not None and outer_idx is not None:
        for candidate_outer, candidate_inner, candidate_asp in interchartaspects.calc_planetary_interchart_aspects(
            chrt,
            partner_chart,
            options,
        ):
            if (
                int(candidate_inner) == int(inner_idx)
                and int(candidate_outer) == int(outer_idx)
                and int(getattr(candidate_asp, "typ", chart.Chart.NONE)) == int(aspect_type)
            ):
                asp = candidate_asp
                break
    if asp is None:
        asp = _interchart_aspect_from_region_type(chrt, partner_chart, options, inner_key, outer_key, aspect_type)
    if asp is None or asp.typ == chart.Chart.NONE:
        raise SystemExit(f"no interchart aspect for {inner_key}/{outer_key}")

    body_a = _aspect_body_info(chrt, inner_key, role="primary")
    body_b = _aspect_body_info(partner_chart, outer_key, role="outer")
    data = _aspect_hover_data(chrt, options, asp, body_a, body_b)
    return {"kind": "aspect", "object_id": int(aspect_type), "chart_role": "primary", "data": data}


def _attach_multiwheel_ring_context(region: dict, context: Optional[dict]) -> None:
    """Attach the visible ring identities consumed by inspector formatters."""
    if not context:
        return
    data = region.setdefault("data", {})
    data["multiwheel_ring_numeral"] = context.get("currentNumeral")
    data["multiwheel_partner_numeral"] = context.get("partnerNumeral")
    endpoints = [
        data.get(endpoint_name)
        for endpoint_name in ("actor", "target")
    ]
    for endpoint_name in ("actor", "target"):
        endpoint = data.get(endpoint_name)
        if not isinstance(endpoint, dict):
            continue
        role = endpoint.get("role")
        if role not in ("primary", "outer"):
            other = endpoints[1] if endpoint is endpoints[0] else endpoints[0]
            other_role = other.get("role") if isinstance(other, dict) else None
            role = "outer" if other_role == "primary" else (
                "primary" if other_role == "outer" else None
            )
        if role == "outer":
            endpoint["ring_numeral"] = context.get("comparisonNumeral")
        elif role == "primary":
            endpoint["ring_numeral"] = context.get("primaryNumeral")


def _apply_multiwheel_payload_title(
    payload: Optional[dict],
    region: dict,
    context: Optional[dict],
) -> Optional[dict]:
    if not payload or not context or region.get("kind") == "aspect":
        return payload
    title = str(payload.get("title") or "").strip()
    numeral = str(context.get("currentNumeral") or "").strip()
    if title and numeral:
        payload["title"] = f"{numeral} {title}"
    return payload


class InspectorService:
    """Rebuilds the hovered chart and returns chartinspector.build_payload(...)."""

    def __init__(self) -> None:
        self._lock = threading.RLock()

    @staticmethod
    def _presentation_options(options):
        """Apply the active profile's color-only layer to inspector rendering.

        The resolved chart objects remain the live session objects.  Style
        profiles are deliberately non-mutating, so the inspector needs the
        same shallow presentation adapter as retained chart exporters to keep
        glyph, dignity, and aspect colors aligned with the visible wheel.
        Import lazily to keep the daemon service graph acyclic at startup.
        """
        from webapp.daemon.options_service import options_service

        return options_service.get_effective_style_chart_options(options)

    def resolve_chart(
        self,
        *,
        doc_id: Optional[str] = None,
        source: Optional[str] = None,
        name: str = "Morinus",
        here_now: bool = False,
        supplementary_kind: Optional[str] = None,
        comparison_name: Optional[str] = None,
        when_iso: Optional[str] = None,
        binding_payload: Optional[dict] = None,
        view_mode: Optional[int] = None,
        ring_index: Optional[int] = None,
    ):
        """Rebuild the hovered chart and its optional biwheel partner.

        Factored out of ``payload`` so sibling services (Zone B passages +
        pack alerts) reuse the exact same chart identity → chart object path.
        Returns ``(options, chrt, partner_chart)``.

        When ``doc_id`` is given, the chart pair is taken from the LIVE session
        document (the same objects the wheel is drawing) instead of reloading by
        ``name`` from a .jsonl file. This is the only path that works for a
        session-only chart — edited/unsaved, here-now, or derived — whose
        ``fpath`` is empty so name-based file lookup 404s. Lazy import keeps the
        service layering acyclic.
        """
        with self._lock:
            if doc_id:
                from webapp.daemon.workspace_service import workspace_service
                return workspace_service.inspector_charts(
                    doc_id,
                    ring_index=ring_index,
                )
            opts = chart_snapshot_service.options
            source_path = str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)
            if here_now:
                radix = chart_snapshot_service._build_here_now_chart(opts, when_iso=when_iso)
            else:
                radix, _ = export_chart_json.load_chart(source_path, opts, name=name)

            chrt = radix
            partner_chart = None
            if comparison_name:
                comparison, _ = export_chart_json.load_chart(source_path, opts, name=comparison_name)
                if view_mode is not None and int(view_mode) == 0:
                    chrt = radix
                    partner_chart = None
                else:
                    partner_chart = comparison
            elif supplementary_kind:
                if supplementary_kind not in SUPPLEMENTARY_KINDS:
                    raise SystemExit(f"unsupported supplementary kind {supplementary_kind!r}")
                derived = supplementary_service.build_chart(
                    radix=radix,
                    kind=supplementary_kind,
                    when=parse_when(when_iso),
                    binding_payload=binding_payload,
                )
                if derived is None:
                    raise SystemExit(f"could not build {supplementary_kind!r}")
                if view_mode is not None and int(view_mode) == 0:
                    chrt = derived
                    partner_chart = None
                else:
                    partner_chart = derived
            return opts, chrt, partner_chart

    @staticmethod
    def _ring_context(
        doc_id: Optional[str],
        ring_index: Optional[int],
    ) -> Optional[dict]:
        if not doc_id or ring_index is None:
            return None
        from webapp.daemon.workspace_service import workspace_service
        return workspace_service.inspector_ring_context(doc_id, ring_index)

    @staticmethod
    def _live_pd_context(doc_id: Optional[str]) -> Optional[dict]:
        if not doc_id:
            return None
        from webapp.daemon.workspace_service import workspace_service
        return workspace_service.inspector_pd_direction_context(str(doc_id))

    def build_region(self, chrt, partner_chart, options, kind: str, object_id: str, chart_role: str = "primary"):
        """Public alias for ``_build_region`` so sibling services can build the
        identical region dict Zone A hovers."""
        return self._build_region(chrt, partner_chart, options, kind, object_id, chart_role)

    def payload(
        self,
        *,
        kind: str,
        object_id: str,
        doc_id: Optional[str] = None,
        source: Optional[str] = None,
        name: str = "Morinus",
        here_now: bool = False,
        chart_role: str = "primary",
        supplementary_kind: Optional[str] = None,
        comparison_name: Optional[str] = None,
        when_iso: Optional[str] = None,
        binding_payload: Optional[dict] = None,
        view_mode: Optional[int] = None,
        ring_index: Optional[int] = None,
        defer_signals: bool = False,
    ) -> Optional[dict]:
        pd_context = self._live_pd_context(doc_id)
        if kind == "pd_event":
            if pd_context is None:
                raise SystemExit("primary-direction event requires a live PD-in-chart document")
            opts = self._presentation_options(pd_context["options"])
            return chartinspector.build_payload(
                _pd_event_region(pd_context, object_id),
                opts,
            )
        # Resolve the chart the user is hovering (inner ring) + its biwheel
        # partner (outer ring), matching what the React hit-test hovers.
        opts, chrt, partner_chart = self.resolve_chart(
            doc_id=doc_id,
            source=source,
            name=name,
            here_now=here_now,
            supplementary_kind=supplementary_kind,
            comparison_name=comparison_name,
            when_iso=when_iso,
            binding_payload=binding_payload,
            view_mode=view_mode,
            ring_index=ring_index,
        )
        opts = self._presentation_options(opts)
        if pd_context is not None and kind == "aspect":
            raise SystemExit("ordinary aspect phase is unavailable in a PD-in-chart document")
        region = self._build_region(chrt, partner_chart, opts, kind, object_id, chart_role)
        ring_context = self._ring_context(doc_id, ring_index)
        _attach_multiwheel_ring_context(region, ring_context)
        if pd_context is not None:
            region.setdefault("data", {})["pd_direction_context"] = True
        if defer_signals:
            payload = chartinspector.build_payload(region, opts, defer_signals=True)
        else:
            payload = chartinspector.build_payload(region, opts)
        payload = _apply_multiwheel_payload_title(payload, region, ring_context)
        lunar_conditions = _lunar_conditions_payload(region)
        if lunar_conditions is not None:
            payload["lunar_conditions"] = lunar_conditions
        return payload

    def flag_payload(
        self,
        *,
        kind: str,
        object_id: str,
        doc_id: Optional[str] = None,
        source: Optional[str] = None,
        name: str = "Morinus",
        here_now: bool = False,
        chart_role: str = "primary",
        supplementary_kind: Optional[str] = None,
        comparison_name: Optional[str] = None,
        when_iso: Optional[str] = None,
        binding_payload: Optional[dict] = None,
        view_mode: Optional[int] = None,
        ring_index: Optional[int] = None,
        defer_signals: bool = False,
    ) -> Optional[dict]:
        """Compact on-chart hover-flag payload — the OTHER chartinspector entry
        point (chartinspector.build_flag_payload, chartinspector.py:1148). The wx
        driver (workspace_shell._update_hover_flag, workspace_shell.py:5307) feeds
        it the SAME renderer hover region build_payload gets; the only difference
        is the builder. We reuse resolve_chart + _build_region verbatim so the
        chart identity / region dict is byte-for-byte what Zone A hovers, then
        call the real brain. No reimplementation — the daemon ships its JSON."""
        pd_context = self._live_pd_context(doc_id)
        if kind == "pd_event":
            if pd_context is None:
                raise SystemExit("primary-direction event requires a live PD-in-chart document")
            opts = self._presentation_options(pd_context["options"])
            return chartinspector.build_flag_payload(
                _pd_event_region(pd_context, object_id),
                opts,
            )
        opts, chrt, partner_chart = self.resolve_chart(
            doc_id=doc_id,
            source=source,
            name=name,
            here_now=here_now,
            supplementary_kind=supplementary_kind,
            comparison_name=comparison_name,
            when_iso=when_iso,
            binding_payload=binding_payload,
            view_mode=view_mode,
            ring_index=ring_index,
        )
        opts = self._presentation_options(opts)
        if pd_context is not None and kind == "aspect":
            raise SystemExit("ordinary aspect phase is unavailable in a PD-in-chart document")
        region = self._build_region(chrt, partner_chart, opts, kind, object_id, chart_role)
        ring_context = self._ring_context(doc_id, ring_index)
        _attach_multiwheel_ring_context(region, ring_context)
        if pd_context is not None:
            region.setdefault("data", {})["pd_direction_context"] = True
        if defer_signals:
            payload = chartinspector.build_flag_payload(
                region,
                opts,
                defer_signals=True,
            )
        else:
            payload = chartinspector.build_flag_payload(region, opts)
        return _apply_multiwheel_payload_title(payload, region, ring_context)

    def _build_region(self, chrt, partner_chart, options, kind: str, object_id: str, chart_role: str = "primary"):
        # OUTER-ring body → resolve against the comparison chart, with the radix
        # as the partner. graphchart does this exact swap (partner_chart =
        # self.chart if outer else self.chart2, graphchart.py:2157-2159). Only the
        # body kinds plus role-bearing secondary-ring labels can sit on the
        # outer ring; sign / house / aspect stay primary.
        if chart_role == "outer" and partner_chart is not None and kind in (
            "planet", "vertex", "fortune", "syzygy", "eclipse", "angle", "secondary_ring",
        ):
            chrt, partner_chart = partner_chart, chrt
        if kind == "planet":
            return _planet_region(chrt, partner_chart, options, int(object_id), chart_role)
        if kind == "vertex":
            return _vertex_region(chrt, partner_chart, options, chart_role)
        if kind == "fortune":
            return _fortune_region(chrt, options, chart_role, partner_chart=partner_chart)
        if kind == "syzygy":
            return _syzygy_region(chrt, options, chart_role, partner_chart=partner_chart)
        if kind == "eclipse":
            return _eclipse_region(chrt, options, chart_role, partner_chart=partner_chart)
        if kind == "angle":
            return _angle_region(chrt, partner_chart, options, str(object_id), chart_role)
        if kind == "house":
            return _house_region(chrt, options, int(object_id))
        if kind == "sign":
            return _sign_region(chrt, options, int(object_id))
        if kind == "secondary_ring":
            return _secondary_ring_region(chrt, options, str(object_id), chart_role)
        if kind == "aspect":
            if str(object_id).startswith("interchart:"):
                return _interchart_aspect_region(chrt, partner_chart, options, str(object_id))
            return _aspect_region(chrt, options, str(object_id))
        if kind == "drishti":
            return _drishti_region(chrt, options, str(object_id))
        # Unknown kind → build_payload returns the empty-state payload.
        return {"kind": kind, "object_id": object_id, "chart_role": "primary", "data": {}}


inspector_service = InspectorService()
