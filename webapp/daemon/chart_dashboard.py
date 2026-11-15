# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Chart dashboard payload: module data for singleton charts.

Tab on a singleton (radix-only) chart switches the wheel to the dashboard,
where it yields space to three modules: the triangular aspect grid, the
declination scale and the Moon status list.
The mode, the module toggles and their settings are display options owned
here; React renders this payload and computes no astrology.

The aspect grid shares the Aspects table's cell truth
(``tables_service._aspects``). Declinations and obliquity come from the
engine chart; the Moon status from the same engine sources the Luna
inspector uses (lunar condition snapshot, void of course under the configured
policy, lunar day under the configured anchor, mansion in the configured
manazil frame).
"""
from __future__ import annotations

from typing import Any

import astrology
import chart as chart_mod
import common
import lunar
import manazil
import planets

MODULE_OPTIONS = (
    ("aspectGrid", "dashboard_aspect_grid"),
    ("declination", "dashboard_declination"),
    ("moon", "dashboard_moon"),
)


def dashboard_eligible(session: dict, comparison, ring_charts, presentation: dict) -> bool:
    """Singleton (radix-only) charts: no derived binding, no second ring."""
    return bool(
        comparison is None
        and len(ring_charts or ()) < 2
        and session.get('supplementary_feature_kind') is None
        and not session.get('compound_kind')
        and session.get('launcher_kind') != 'pd_in_chart'
        and not session.get('parallel_transits_enabled')
        and (presentation or {}).get('coordinateMode', 'zodiacal') == 'zodiacal'
    )


def dashboard_state(options, eligible: bool, force_modules: bool = False) -> dict[str, Any]:
    """``force_modules`` (poster export) turns every module on, whatever the
    screen's dashboard shows; the module settings stay the user's."""
    modules = {key: bool(force_modules or getattr(options, attr, True)) for key, attr in MODULE_OPTIONS}
    return {
        "eligible": bool(eligible),
        "enabled": bool(force_modules or (eligible and getattr(options, 'chart_dashboard', False))),
        "modules": modules,
        "gridOrbs": bool(getattr(options, 'dashboard_grid_orbs', True)),
        "gridLarge": bool(getattr(options, 'dashboard_grid_large', False)),
        # Grid turned 90 degrees into the top-left corner, chart data bottom left.
        # Heavy ∥ / # cell marks for declination parallels in orb.
        "gridParallels": bool(getattr(options, 'dashboard_grid_parallels', True)),
        "declinationMirrored": bool(getattr(options, 'dashboard_declination_mirrored', False)),
        "moonAllBodies": bool(getattr(options, 'dashboard_moon_all_bodies', False)),
        # Wide surfaces too keep the horizontal bar (placement A2).
        "declinationHorizontal": bool(getattr(options, 'dashboard_declination_horizontal', False)),
    }


MAJOR_ASPECTS = frozenset((
    chart_mod.Chart.CONJUNCTIO, chart_mod.Chart.SEXTIL, chart_mod.Chart.QUADRAT,
    chart_mod.Chart.TRIGON, chart_mod.Chart.OPPOSITIO,
))
# Moon Last/Next default to the traditional planets (Sun through Saturn).
TRADITIONAL_PLANETS = frozenset(range(astrology.SE_SUN, astrology.SE_SATURN + 1))


def wheel_draws_aspect_type(options, aspect_type: int) -> bool:
    """Minor aspect types appear only while the wheel draws them
    (export_chart_json.shown_aspect: master switch, per-type switch, and
    the traditional filter, which admits majors only)."""
    if aspect_type in MAJOR_ASPECTS:
        return True
    aspects = list(getattr(options, 'aspect', []) or [])
    return bool(
        getattr(options, 'aspects', True)
        and not getattr(options, 'traditionalaspects', False)
        and 0 <= aspect_type < len(aspects)
        and aspects[aspect_type]
    )


def dashboard_payload(
    chrt, options, eligible: bool, include_modules: bool = True, force_modules: bool = False,
) -> dict[str, Any]:
    """Dashboard state plus, when the dashboard shows, its module data.

    ``force_modules=True`` returns every module's data for the chart even when
    the dashboard is off (the astrolabe poster's widget choices).

    ``include_modules=False`` (a time step while the dashboard view is hidden)
    marks the module data as omitted; the frontend refreshes once if the
    dashboard is then shown before a full snapshot has replaced the step."""
    state = dashboard_state(options, eligible, force_modules)
    if not state["enabled"] or not any(state["modules"].values()):
        return state
    if not include_modules:
        state["dataOmitted"] = True
        return state
    from webapp.daemon import inspector_service, tables_service

    display_options = tables_service.effective_display_options(options)
    matrix = tables_service._aspects(
        chrt, display_options, planet_matrix_only=True,
        aspect_filter=lambda typ: wheel_draws_aspect_type(options, typ),
    )
    # Each body carries the wheel's own motion marker (R, SR/SD at a
    # station, or "") for the Moon rows and the declination strip.
    state["bodies"] = [
        {**entry, "motion": inspector_service._motion_marker(
            chrt, entry["planet"], float(body.data[planets.Planet.SPLON]), chrt.options, False)}
        if (body := chrt.get_planet_body(entry["planet"])) is not None else entry
        for entry in matrix["planets"]
    ]
    if state["modules"]["aspectGrid"]:
        state["grid"] = {"cells": matrix["cells"]}
    if state["modules"]["declination"]:
        state["declination"] = declination_payload(chrt, matrix["planets"])
    if state["modules"]["moon"]:
        state["moon"] = moon_payload(chrt, options, matrix)
    return state


def declination_contacts(chrt, body_ids, se_id=None, partner=None) -> dict[int, list[dict[str, Any]]]:
    """Parallels and contraparallels in orb, per body: the engine's in-orb flag
    (``Asp.parallel``, the same source as the grid's cell marks) with the
    declination separation it tests as the orb (parallel |d1 - d2|,
    contraparallel ||d1| - |d2||). ``se_id``/``partner`` narrow the result."""
    decl = {}
    for pid in body_ids:
        body = chrt.get_planet_body(pid) if pid != common.CHART_OBJECT_VERTEX else None
        data = getattr(body, 'dataEqu', None) if body is not None else None
        if data is not None:
            decl[int(pid)] = float(data[planets.Planet.DECLEQU])
    ids = list(decl)
    contacts: dict[int, list[dict[str, Any]]] = {pid: [] for pid in ids if se_id is None or pid == se_id}
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if se_id is not None and se_id not in (a, b):
                continue
            if partner is not None and partner not in (a, b):
                continue
            try:
                flag = chrt.get_planetary_aspect(a, b).parallel
            except Exception:
                continue
            if flag == chart_mod.Chart.PARALLEL:
                kind, orb = 'parallel', abs(decl[a] - decl[b])
            elif flag == chart_mod.Chart.CONTRAPARALLEL:
                kind, orb = 'contraparallel', abs(abs(decl[a]) - abs(decl[b]))
            else:
                continue
            for own, other in ((a, b), (b, a)):
                if own in contacts:
                    contacts[own].append({"partner": int(other), "kind": kind, "orb": float(orb)})
    for rows in contacts.values():
        rows.sort(key=lambda row: row["orb"])
    return contacts


def declination_payload(chrt, bodies: list[dict[str, Any]]) -> dict[str, Any]:
    """Engine declinations (planets.Planet.dataEqu) for the grid's bodies, with
    each body's parallels and contraparallels in orb (strip hover)."""
    points = []
    for entry in bodies:
        body = chrt.get_planet_body(entry["planet"])
        data = getattr(body, 'dataEqu', None) if body is not None else None
        if data is None:
            continue
        points.append({"planet": int(entry["planet"]), "declination": float(data[planets.Planet.DECLEQU])})
    contacts = declination_contacts(chrt, [entry["planet"] for entry in bodies])
    return {
        "obliquity": float(chrt.obl[0]),
        "points": points,
        "contacts": {str(pid): rows for pid, rows in contacts.items()},
    }


def _lunar_day(chrt, options) -> dict[str, Any]:
    anchor = getattr(options, 'lunar_day_anchor', lunar.ANCHOR_TRUE)
    true_day = int(lunar.lunation_day_true(chrt))
    mean_day = int(lunar.lunation_day_mean(chrt))
    if anchor == lunar.ANCHOR_MEAN:
        return {"day": mean_day, "meanDay": None}
    if anchor == lunar.ANCHOR_BOTH and mean_day != true_day:
        return {"day": true_day, "meanDay": mean_day}
    return {"day": true_day, "meanDay": None}


def _mansion(chrt, options, moon_lon: float, jd: float) -> dict[str, Any]:
    frame_lon = manazil.resolve_chart_lon(
        moon_lon,
        getattr(options, 'manazil_zodiac', manazil.ZODIAC_AUTO),
        float(getattr(chrt, 'ayanamsha_offset', 0.0) or getattr(chrt, 'ayanamsha', 0.0) or 0.0),
        jd,
        getattr(options, 'ayanamsha', 0) != 0,
    )
    index, _degree_in, entry = manazil.mansion_of(frame_lon)
    return {
        "number": index + 1,
        "arabic": entry["name_ar"],
        "transliteration": entry["name_translit"],
    }


def _moon_search_target(chrt, pid: int, angles: tuple[float, ...]):
    """(id, ephemeris code, shift, angles) for the lunar contact search.

    The north node follows the chart's mean/true choice; the south node is
    that node + 180. Other calculated points (apogees, Vertex) have no
    ephemeris trajectory here and are unsupported.
    """
    node = astrology.SE_MEAN_NODE if getattr(chrt.options, 'meannode', True) else astrology.SE_TRUE_NODE
    if pid == astrology.SE_MEAN_NODE:
        return pid, node, 0.0, angles[:1]
    if pid == astrology.SE_TRUE_NODE:
        return pid, node, 180.0, angles[:1]
    if astrology.SE_SUN <= pid <= astrology.SE_PLUTO or pid == astrology.SE_CHIRON:
        return pid, pid, 0.0, angles
    return None


def moon_course(chrt, body_ids, all_bodies: bool = False, options=None):
    """Last and next exact Moon contacts, in time order: ``(last, next)``
    ``void_of_course.LunarContact`` (body, angle, jd) or None each, plus the
    aspect type of each searched angle.

    The one Moon Last/Next rule, shared by the dashboard Moon list and the
    Inspector's Moon rows. Next is the earliest solved perfection and Last the
    most recent one, with the major aspects plus any minor types the wheel
    draws. Orbs and the Moon's sign do not limit them; a body moving toward
    the Moon can perfect before a nearer one moving away. Targets are the
    traditional planets unless ``all_bodies``. Unavailable outside the chart's
    own sky (symbolic charts).
    """
    from engine import void_of_course

    moon = astrology.SE_MOON
    options = options if options is not None else chrt.options
    types = [t for t in range(chart_mod.Chart.ASPECT_NUM) if wheel_draws_aspect_type(options, t)]
    angles = tuple(chart_mod.Chart.Aspects[t] for t in types)
    type_of = dict(zip(angles, types))
    targets = []
    for pid in body_ids:
        if pid == moon or not (all_bodies or pid in TRADITIONAL_PLANETS):
            continue
        target = _moon_search_target(chrt, pid, angles)
        if target is not None and chrt.get_planet_body(pid) is not None:
            targets.append(target)
    found = (None, None)
    try:
        sky = void_of_course.chart_sky(chrt, void_of_course.TRADITIONAL)
        if sky is not None and targets:
            jd, context = sky
            found = void_of_course.lunar_contacts(jd, tuple(targets), context)
    except (ValueError, RuntimeError):
        pass
    return found[0], found[1], type_of


def _moon_contacts(chrt, matrix: dict[str, Any], all_bodies: bool = False, options=None) -> dict[str, Any]:
    """Dashboard rows for ``moon_course`` over the grid's bodies."""
    from webapp.daemon import tables_service

    moon = astrology.SE_MOON
    ids = [entry["planet"] for entry in matrix["planets"]]
    if moon not in ids:
        return {"last": None, "next": None}
    last, upcoming, type_of = moon_course(chrt, ids, all_bodies, options)
    found = (last, upcoming)
    display_options = tables_service.effective_display_options(chrt.options)
    moon_lon = chrt.get_planet_body(moon).data[planets.Planet.LONG]

    def row(contact, applying: bool):
        if contact is None:
            return None
        aspect_type = type_of[contact.angle]
        lon = chrt.get_planet_body(contact.body).data[planets.Planet.LONG]
        color = tables_service._rgb_hex(display_options.clraspect[aspect_type])
        result = {
            "planet": int(contact.body),
            "aspectType": int(aspect_type),
            "glyph": common.common.aspect_glyph(aspect_type)[0],
            "orb": float(chart_mod.Chart._aspect_orb_delta(moon_lon, lon, aspect_type)),
            "applying": applying,
        }
        tables_service._set_semantic_color(
            result, color,
            tables_service.aspect_color_role(display_options, aspect_type, resolved_color=color),
        )
        return result

    return {"last": row(found[0], False), "next": row(found[1], True)}


def moon_payload(chrt, options, matrix: dict[str, Any]) -> dict[str, Any]:
    from engine import lunar_cycle, void_of_course

    jd = float(chrt.time.jd)
    state = lunar_cycle.lunar_condition_snapshot(chrt, jd)
    moon = chrt.planets.planets[astrology.SE_MOON]
    try:
        void = {"isVoid": void_of_course.for_chart(chrt, options).is_void}
    except (ValueError, RuntimeError):
        void = {"isVoid": None}
    return {
        "elongation": float(state.elongation),
        "increasingInLight": bool(state.increasing_in_light),
        "increasingInLatitude": bool(state.increasing_in_latitude),
        "swift": bool(state.swift),
        "longitudeSpeed": float(state.longitude_speed),
        # The Inspector's speed arrow: the engine's speed trend, none at the
        # exact slowest/fastest turning point.
        "speedTrend": (
            None if {lunar_cycle.LUNAR_EXACT_SLOWEST, lunar_cycle.LUNAR_EXACT_FASTEST} & set(state.exact_states)
            else ("up" if state.increasing_in_number else "down")
        ),
        # The chart's own Moon (topocentric when the chart is), as in the
        # positions table; rising/falling stays the geocentric condition.
        "latitude": float(moon.data[planets.Planet.LAT]),
        "lunarDay": _lunar_day(chrt, options),
        # Shown only where the Inspector shows lunar mansions.
        "mansion": (
            _mansion(chrt, options, float(moon.data[planets.Planet.LONG]), jd)
            if getattr(options, 'show_manzil_in_inspector', True) else None
        ),
        "voidOfCourse": void,
        **_moon_contacts(chrt, matrix, bool(getattr(options, 'dashboard_moon_all_bodies', False)), options),
    }
