# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

import datetime
from typing import Any, Iterable

import astrology
import chart
import common
import dateformat
import eclipses
from engine import lunar_cycle, moment
import mtexts
import options
import searchbackend
import searchcatalog
import searchquery
import util
from webapp.daemon.display_palette import (
    effective_display_options,
    object_glyph_color,
    object_glyph_color_role,
    sign_color_role,
)
from webapp.daemon.event_time import DefaultLocationClock, table_event_clock


LOGICAL_NORTH_NODE_ID = astrology.SE_PLUTO + 1
NORTH_NODE_OBJECT_ID = "planet:asc_node"
INGRESS_PLANET_SPECS: tuple[tuple[int, str], ...] = (
    (astrology.SE_SUN, "sun"),
    (astrology.SE_MOON, "moon"),
    (astrology.SE_MERCURY, "mercury"),
    (astrology.SE_VENUS, "venus"),
    (astrology.SE_MARS, "mars"),
    (astrology.SE_JUPITER, "jupiter"),
    (astrology.SE_SATURN, "saturn"),
    (astrology.SE_URANUS, "uranus"),
    (astrology.SE_NEPTUNE, "neptune"),
    (astrology.SE_PLUTO, "pluto"),
    (LOGICAL_NORTH_NODE_ID, "asc_node"),
)
SYNODIC_PLANET_IDS = (
    astrology.SE_MERCURY,
    astrology.SE_VENUS,
    astrology.SE_MARS,
    astrology.SE_JUPITER,
    astrology.SE_SATURN,
    astrology.SE_URANUS,
    astrology.SE_NEPTUNE,
    astrology.SE_PLUTO,
)
SYNODIC_FILTER_PLANET_IDS = frozenset((
    astrology.SE_MOON,
    LOGICAL_NORTH_NODE_ID,
    *SYNODIC_PLANET_IDS,
))
PLANET_IDS = tuple(pid for pid, _key in INGRESS_PLANET_SPECS)
PLANET_OBJECT_IDS = {pid: f"planet:{key}" for pid, key in INGRESS_PLANET_SPECS}
OBJECT_PLANET_IDS = {oid: pid for pid, oid in PLANET_OBJECT_IDS.items()}
LUNAR_CYCLE_IDS = ("draconic", "anomalistic")
EVENT_ORDER = {
    "eclipse": 0,
    "lunation": 1,
    "draconic": 2,
    "anomalistic": 3,
    "station": 4,
    "cazimi": 5,
    "ingress": 6,
}
LUNATION_ECLIPSE_DEDUPE_DAYS = 1.0 / 24.0


class SynodicService:
    def payload_for_context(
        self,
        context: dict[str, Any],
        *,
        from_date: str | None = None,
        to_date: str | None = None,
        planet_ids: str | None = None,
        include_stations: bool = True,
        include_cazimis: bool = True,
        include_ingresses: bool = True,
    ) -> dict[str, Any]:
        chrt = context["chart"]
        focus_dt = _coerce_datetime(context.get("current_datetime"))
        birth_dt = _context_birth_datetime(context, chrt)
        current_dt = datetime.datetime.now()
        start, end = _resolve_date_range(focus_dt, from_date, to_date)
        active_planets = _parse_planet_ids(planet_ids)
        catalog = searchcatalog.SearchCatalog(chrt)
        ingress_promittor_ids = [
            PLANET_OBJECT_IDS[pid]
            for pid in PLANET_IDS
            if pid in active_planets and catalog.get(PLANET_OBJECT_IDS[pid]) is not None
        ]
        synodic_promittor_ids = [
            PLANET_OBJECT_IDS[pid]
            for pid in SYNODIC_PLANET_IDS
            if pid in active_planets and catalog.get(PLANET_OBJECT_IDS[pid]) is not None
        ]

        rows = []
        start_jd = searchbackend._date_to_jd(start, chrt)
        end_jd = searchbackend._date_to_jd(end + datetime.timedelta(days=1), chrt)
        technique = searchquery.SearchQuery.TECHNIQUE_TRANSITS
        runtime = searchbackend._SearchRuntime()
        if ingress_promittor_ids:
            if include_ingresses:
                ingress_rows = searchbackend._search_sign_change_rows(catalog, chrt, ingress_promittor_ids, start_jd, end_jd, technique)
                for row in ingress_rows:
                    searchbackend._apply_sign_change_row_display_payloads(row, catalog, chrt, runtime)
                rows.extend(ingress_rows)
        if synodic_promittor_ids:
            if include_stations:
                rows.extend(searchbackend._search_station_rows(catalog, chrt, synodic_promittor_ids, start_jd, end_jd, technique, runtime))
            if include_cazimis:
                rows.extend(searchbackend._search_cazimi_rows(catalog, chrt, synodic_promittor_ids, start_jd, end_jd, technique, runtime))
        if LOGICAL_NORTH_NODE_ID in active_planets and include_stations:
            rows.extend(
                _search_true_node_station_rows(
                    catalog,
                    chrt,
                    start_jd,
                    end_jd,
                    technique,
                )
            )
        if astrology.SE_MOON in active_planets:
            rows.extend(
                _search_lunation_eclipse_draconic_rows(
                    catalog,
                    chrt,
                    start_jd,
                    end_jd,
                    technique,
                    runtime,
                )
            )
            rows.extend(
                _search_anomalistic_rows(
                    catalog,
                    chrt,
                    start_jd,
                    end_jd,
                    technique,
                    runtime,
                )
            )

        rows = _dedupe_rows(rows)
        rows.sort(key=_row_sort_key)
        display_clock = table_event_clock(getattr(chrt, "options", None))
        display_options = effective_display_options(getattr(chrt, "options", None))
        payload_rows = [
            _serialize_row(
                row,
                index=index,
                catalog=catalog,
                chrt=chrt,
                display_clock=display_clock,
                display_options=display_options,
            )
            for index, row in enumerate(rows)
        ]
        offsets = [row["displayUtcOffsetMinutes"] for row in payload_rows]
        if not offsets:
            offsets = display_clock.offsets_for_range(start, end)
        time_display = display_clock.metadata(
            mtexts.txts.get("Time", "Time"),
            offsets=offsets,
        )
        return {
            "tableId": "synodic_cycles",
            "name": getattr(chrt, "name", "") or "Radix",
            "meta": {
                "title": mtexts.txts.get("SynodicCycles", "Synodic Cycles"),
                "fromDate": start.isoformat(),
                "toDate": end.isoformat(),
                "focusDatetime": _datetime_iso(focus_dt),
                "currentDatetime": _datetime_iso(current_dt),
                "birthDatetime": _datetime_iso(birth_dt),
                "columns": [
                    mtexts.txts.get("Planet", "Planet"),
                    mtexts.txts.get("Event", "Event"),
                    mtexts.txts.get("Detail", "Detail"),
                    mtexts.txts.get("Date", "Date"),
                    time_display["columnLabel"],
                ],
                "timeDisplay": time_display,
                "planetItems": _planet_items(
                    catalog, chrt, active_planets, display_options=display_options
                ),
                "lunarItems": _lunar_items(chrt),
                "activePlanetIds": list(active_planets),
                "activeLunarCycleIds": list(LUNAR_CYCLE_IDS),
                "eventTypes": {
                    "station": bool(include_stations),
                    "cazimi": bool(include_cazimis),
                    "ingress": bool(include_ingresses),
                },
            },
            "rows": payload_rows,
            "summary": _summary_text(len(payload_rows)),
            "truncated": False,
        }


def _common(chrt=None):
    glyphs = getattr(common, "common", None)
    if glyphs is None:
        glyphs = common.Common()
        common.common = glyphs
    if not hasattr(glyphs, "Planets"):
        try:
            glyphs.update(getattr(chrt, "options", None) or options.Options())
        except Exception:
            pass
    return glyphs


def _resolve_date_range(
    focus_dt: datetime.datetime,
    from_date: str | None,
    to_date: str | None,
) -> tuple[datetime.date, datetime.date]:
    if from_date or to_date:
        start = _parse_date(from_date) if from_date else focus_dt.date().replace(day=1)
        end = _parse_date(to_date) if to_date else _month_end(start)
        if end < start:
            start, end = end, start
        return start, end
    start = focus_dt.date().replace(day=1)
    return start, _month_end(start)


def _parse_date(value: str | None) -> datetime.date:
    if not value:
        raise ValueError("missing date")
    try:
        return datetime.date.fromisoformat(str(value)[:10])
    except Exception as exc:
        raise ValueError(f"invalid date {value!r}") from exc


def _month_end(value: datetime.date) -> datetime.date:
    if value.month == 12:
        return datetime.date(value.year, 12, 31)
    return datetime.date(value.year, value.month + 1, 1) - datetime.timedelta(days=1)


def _coerce_datetime(value: Any) -> datetime.datetime:
    if isinstance(value, datetime.datetime):
        return value
    if isinstance(value, datetime.date):
        return datetime.datetime(value.year, value.month, value.day, 12, 0, 0)
    return datetime.datetime.now()


def _context_birth_datetime(context: dict[str, Any], chrt) -> datetime.datetime:
    anchor = context.get("chart_anchor_datetime")
    if isinstance(anchor, datetime.datetime):
        return anchor
    if isinstance(anchor, datetime.date):
        return datetime.datetime(anchor.year, anchor.month, anchor.day, 12, 0, 0)
    try:
        return chrt.time.getDatetime()
    except Exception:
        t = getattr(chrt, "time", None)
        return datetime.datetime(
            int(getattr(t, "origyear", getattr(t, "year", 1))),
            int(getattr(t, "origmonth", getattr(t, "month", 1))),
            int(getattr(t, "origday", getattr(t, "day", 1))),
            int(getattr(t, "hour", 0)),
            int(getattr(t, "minute", 0)),
            int(getattr(t, "second", 0)),
        )


def _parse_planet_ids(value: str | None) -> tuple[int, ...]:
    if value is None or str(value).strip() == "":
        return PLANET_IDS
    active = []
    for part in str(value).split(","):
        try:
            pid = int(part.strip())
        except Exception:
            continue
        if pid in PLANET_IDS and pid not in active:
            active.append(pid)
    return tuple(active)


def _planet_items(
    catalog: searchcatalog.SearchCatalog,
    chrt,
    active_planets: Iterable[int],
    *,
    display_options=None,
) -> list[dict[str, Any]]:
    active = set(active_planets)
    glyphs = _common(chrt)
    return [
        _planet_item_payload(
            catalog,
            chrt,
            glyphs,
            pid,
            oid,
            pid in active,
            display_options,
        )
        for pid, oid in PLANET_OBJECT_IDS.items()
    ]


def _planet_item_payload(
    catalog: searchcatalog.SearchCatalog,
    chrt,
    glyphs,
    planet_id: int,
    object_id: str,
    enabled: bool,
    display_options,
) -> dict[str, Any]:
    obj = catalog.get(object_id)
    color = _planet_color(chrt, planet_id, display_options=display_options)
    try:
        dignity_code = chrt.dignity(planet_id)
    except Exception:
        dignity_code = None
    return {
        "id": planet_id,
        "objectId": object_id,
        "label": _planet_label(obj, object_id, glyphs, planet_id),
        "glyph": glyphs.get_planet_glyph(planet_id),
        "color": color,
        "colorRole": object_glyph_color_role(
            display_options,
            obj,
            dignity_code,
            resolved_color=color,
        ),
        "enabled": enabled,
        "eventGroups": [
            group
            for group, supported in (
                ("ingress", True),
                ("synodic", planet_id in SYNODIC_FILTER_PLANET_IDS),
            )
            if supported
        ],
    }


def _planet_label(obj, object_id: str, glyphs, planet_id: int) -> str:
    if object_id == NORTH_NODE_OBJECT_ID:
        return mtexts.txts.get("NorthNode", "North Node")
    if obj is not None:
        return obj.label
    return glyphs.get_planet_name(planet_id)


def _lunar_items(chrt) -> list[dict[str, Any]]:
    glyphs = _common(chrt)
    return [
        {
            "id": "draconic",
            "label": mtexts.txts.get("Draconic", "Draconic"),
            "glyph": glyphs.get_planet_glyph(LOGICAL_NORTH_NODE_ID),
            "enabled": True,
        },
        {
            "id": "anomalistic",
            "label": mtexts.txts.get("Anomalistic", "Anomalistic"),
            "glyph": glyphs.get_planet_glyph(astrology.SE_MOON),
            "enabled": True,
        },
    ]


def _search_true_node_station_rows(
    catalog: searchcatalog.SearchCatalog,
    chrt,
    start_jd: float,
    end_jd: float,
    technique: str,
) -> list[searchquery.SearchResult]:
    prom = catalog.get(NORTH_NODE_OBJECT_ID)
    if prom is None:
        return []
    calflag = searchbackend._calendar_flag(chrt)
    rows: list[searchquery.SearchResult] = []
    for event in lunar_cycle.true_node_station_events(chrt, start_jd, end_jd):
        row = searchquery.SearchResult(
            technique,
            searchquery.SearchQuery.ASPECT_STATION,
            NORTH_NODE_OBJECT_ID,
            "",
        )
        searchbackend._fill_row_from_jd(row, catalog, event.jd_ut, calflag)
        row.significator_label = ""
        row.metadata["station"] = True
        row.metadata["station_code"] = event.code
        row.metadata["true_node_station"] = True
        row.metadata["exact_event_jd"] = event.jd_ut
        row.metadata["synodic_filter_group"] = "synodic"
        row.metadata["synodic_filter_id"] = LOGICAL_NORTH_NODE_ID
        row.event_label = _station_label(event.code)
        row.notes = row.event_label
        longitude, speed = lunar_cycle.true_node_state(chrt, event.jd_ut)
        searchbackend._apply_secondary_station_display_payload(
            row,
            chrt,
            prom,
            longitude,
            speed,
            event.jd_ut,
            event.code,
        )
        rows.append(row)
    return rows


def _search_lunation_eclipse_draconic_rows(
    catalog: searchcatalog.SearchCatalog,
    chrt,
    start_jd: float,
    end_jd: float,
    technique: str,
    runtime,
) -> list[searchquery.SearchResult]:
    moon_id = PLANET_OBJECT_IDS[astrology.SE_MOON]
    sun_id = PLANET_OBJECT_IDS[astrology.SE_SUN]
    node_id = NORTH_NODE_OBJECT_ID
    if (
        catalog.get(moon_id) is None
        or catalog.get(sun_id) is None
        or catalog.get(node_id) is None
    ):
        return []

    query = searchquery.SearchQuery()
    query.set_promittor_ids([moon_id])
    query.set_significator_ids([sun_id, node_id])
    query.set_techniques([searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER])
    query.set_aspects([
        searchquery.SearchQuery.ASPECT_CONJUNCTION,
        searchquery.SearchQuery.ASPECT_SQUARE,
        searchquery.SearchQuery.ASPECT_OPPOSITION,
    ])
    cycle_rows = searchbackend._search_mundane_weather(
        catalog,
        chrt,
        query,
        start_jd,
        end_jd,
        runtime,
        searchbackend._CompiledQuery(catalog, query),
    )
    lunation_rows: list[searchquery.SearchResult] = []
    draconic_rows: list[searchquery.SearchResult] = []
    for row in cycle_rows:
        pair = {row.promittor_id, row.significator_id}
        if pair == {moon_id, sun_id}:
            if row.aspect == searchquery.SearchQuery.ASPECT_SQUARE:
                continue
            row.technique = technique
            # The generic weather query canonically orders Sun before Moon. A
            # lunation is carried by the moving Moon, so its selector/glyph and
            # event-time position must belong to the Moon in this list.
            row.promittor_id = moon_id
            row.significator_id = sun_id
            row.metadata["lunation"] = True
            row.metadata["lunation_kind"] = (
                "new"
                if row.aspect == searchquery.SearchQuery.ASPECT_CONJUNCTION
                else "full"
            )
            row.event_label = _lunation_label(row.metadata["lunation_kind"])
            row.notes = row.event_label
            searchbackend._apply_live_pair_row_display_payloads(
                row, catalog, chrt, runtime
            )
            lunation_rows.append(row)
            continue
        if pair != {moon_id, node_id}:
            continue
        row.technique = technique
        row.promittor_id = moon_id
        row.significator_id = node_id
        row.metadata["synodic_event_type"] = "draconic"
        row.metadata["lunar_cycle"] = "draconic"
        row.metadata["lunar_cycle_code"] = _draconic_code(
            row.aspect,
            chrt,
            float(row.event_jd),
        )
        row.metadata["synodic_filter_group"] = "lunar"
        row.metadata["synodic_filter_id"] = "draconic"
        row.event_label = _draconic_label(row.metadata["lunar_cycle_code"])
        row.notes = row.event_label
        searchbackend._apply_live_pair_row_display_payloads(
            row, catalog, chrt, runtime
        )
        draconic_rows.append(row)

    eclipse_rows: list[searchquery.SearchResult] = []
    eclipse_jds: list[float] = []
    try:
        eclipse_events = eclipses.find_eclipses_in_range(chrt, start_jd, end_jd)
    except Exception:
        eclipse_events = []
    calflag = searchbackend._calendar_flag(chrt)
    for event in eclipse_events:
        event_jd = eclipses.syzygy_jdut_for_event(event)
        if event_jd is None or not (start_jd <= float(event_jd) < end_jd):
            continue
        is_solar = bool(getattr(event, "is_solar", False))
        row = searchquery.SearchResult(
            technique,
            searchquery.SearchQuery.ASPECT_CONJUNCTION if is_solar else searchquery.SearchQuery.ASPECT_OPPOSITION,
            moon_id,
            sun_id,
        )
        searchbackend._fill_row_from_jd(row, catalog, float(event_jd), calflag)
        row.metadata["eclipse"] = True
        row.metadata["eclipse_kind"] = "solar" if is_solar else "lunar"
        row.event_label = _eclipse_label(is_solar)
        row.notes = row.event_label
        searchbackend._apply_live_pair_row_display_payloads(row, catalog, chrt, runtime)
        eclipse_jds.append(float(event_jd))
        eclipse_rows.append(row)

    return [
        row
        for row in lunation_rows
        if not any(abs(float(row.event_jd or 0.0) - eclipse_jd) <= LUNATION_ECLIPSE_DEDUPE_DAYS for eclipse_jd in eclipse_jds)
    ] + eclipse_rows + draconic_rows


def _search_anomalistic_rows(
    catalog: searchcatalog.SearchCatalog,
    chrt,
    start_jd: float,
    end_jd: float,
    technique: str,
    runtime,
) -> list[searchquery.SearchResult]:
    moon_id = PLANET_OBJECT_IDS[astrology.SE_MOON]
    if catalog.get(moon_id) is None:
        return []
    calflag = searchbackend._calendar_flag(chrt)
    rows: list[searchquery.SearchResult] = []
    for event in lunar_cycle.anomalistic_events(chrt, start_jd, end_jd):
        row = searchquery.SearchResult(
            technique,
            event.code,
            moon_id,
            "",
        )
        searchbackend._fill_row_from_jd(row, catalog, event.jd_ut, calflag)
        row.significator_label = ""
        row.metadata["synodic_event_type"] = "anomalistic"
        row.metadata["lunar_cycle"] = "anomalistic"
        row.metadata["lunar_cycle_code"] = event.code
        row.metadata["synodic_filter_group"] = "lunar"
        row.metadata["synodic_filter_id"] = "anomalistic"
        row.metadata["distance_au"] = event.distance_au
        row.metadata["longitude_speed"] = event.longitude_speed
        row.event_label = _anomalistic_label(event.code)
        row.notes = row.event_label
        prom_display = searchbackend._build_live_row_object_display(
            catalog,
            moon_id,
            chrt,
            event.jd_ut,
            runtime,
        )
        if prom_display is not None:
            row.metadata["prom_display"] = prom_display
        row.metadata["display_hydrated"] = True
        rows.append(row)
    return rows


def _draconic_code(aspect: str, chrt, event_jd: float) -> str:
    if aspect == searchquery.SearchQuery.ASPECT_CONJUNCTION:
        return "north_node"
    if aspect == searchquery.SearchQuery.ASPECT_OPPOSITION:
        return "south_node"
    state = lunar_cycle.lunar_condition_snapshot(chrt, event_jd)
    return "north_bending" if state.latitude > 0.0 else "south_bending"


def _draconic_label(code: str) -> str:
    if code == "north_node":
        return mtexts.txts.get("NorthNode", "North Node")
    if code == "south_node":
        return mtexts.txts.get("SouthNode", "South Node")
    if code == "north_bending":
        return mtexts.txts.get("NorthBending", "North Bending")
    if code == "south_bending":
        return mtexts.txts.get("SouthBending", "South Bending")
    return mtexts.txts.get("SquareNodes", "Square Nodes")


def _anomalistic_label(code: str) -> str:
    if code == lunar_cycle.ANOMALISTIC_PERIGEE:
        return mtexts.txts.get("Perigee", "Perigee")
    if code == lunar_cycle.ANOMALISTIC_APOGEE:
        return mtexts.txts.get("Apogee", "Apogee")
    if code == lunar_cycle.ANOMALISTIC_SPEEDING:
        return mtexts.txts.get("Slowest", "Slowest")
    if code == lunar_cycle.ANOMALISTIC_SLOWING:
        return mtexts.txts.get("Fastest", "Fastest")
    return mtexts.txts.get("Anomalistic", "Anomalistic")


def _station_label(code: str) -> str:
    if str(code).upper() == "SR":
        return mtexts.txts.get("StationRetrograde", "Station (R)")
    if str(code).upper() == "SD":
        return mtexts.txts.get("StationDirect", "Station (D)")
    return mtexts.txts.get("Station", "Station")


def _lunation_label(kind: str) -> str:
    return mtexts.txts.get("NewMoon", "New Moon") if kind == "new" else mtexts.txts.get("FullMoon", "Full Moon")


def _eclipse_label(is_solar: bool) -> str:
    return (
        mtexts.txts.get("SolarEclipse", "Solar Eclipse")
        if is_solar
        else mtexts.txts.get("LunarEclipse", "Lunar Eclipse")
    )


def _dedupe_rows(rows: Iterable[searchquery.SearchResult]) -> list[searchquery.SearchResult]:
    seen: set[tuple[Any, ...]] = set()
    out: list[searchquery.SearchResult] = []
    for row in rows:
        event_type = _event_type(row)
        key = (
            round(float(row.event_jd or 0.0) * 86400.0),
            row.promittor_id,
            event_type,
            row.metadata.get("station_code"),
            row.metadata.get("sign_change_event_sign"),
            row.metadata.get("lunar_cycle_code"),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def _row_sort_key(row: searchquery.SearchResult) -> tuple[float, int, int, str]:
    pid = OBJECT_PLANET_IDS.get(row.promittor_id, 999)
    try:
        planet_order = PLANET_IDS.index(pid)
    except ValueError:
        planet_order = 999
    return (
        float(row.event_jd or 0.0),
        planet_order,
        EVENT_ORDER.get(_event_type(row), 99),
        str(row.promittor_id),
    )


def _serialize_row(
    row: searchquery.SearchResult,
    *,
    index: int,
    catalog: searchcatalog.SearchCatalog,
    chrt,
    display_clock: DefaultLocationClock,
    display_options=None,
) -> dict[str, Any]:
    display_options = display_options or effective_display_options(
        getattr(chrt, "options", None)
    )
    prom = catalog.get(row.promittor_id)
    glyphs = _common(chrt)
    pid = getattr(prom, "planet_index", None)
    event_tuple = _event_tuple(row)
    display = display_clock.display(event_tuple)
    display_tuple = display.values
    open_tuple = _display_datetime_for_chart_instant(chrt, event_tuple)
    event_type = _event_type(row)
    prom_display = _decorate_display_payload(
        row.metadata.get("prom_display", {}),
        chrt,
        display_options=display_options,
        obj=prom,
    )
    sign_payload = _sign_payload(
        row, chrt, prom_display, display_options=display_options
    )
    live_planet_color = prom_display.get("glyph_color_css")
    planet_color = live_planet_color or (
        _planet_color(chrt, int(pid), display_options=display_options)
        if pid is not None
        else None
    )
    try:
        dignity_code = prom_display.get("dignity_code")
        if dignity_code is None and pid is not None:
            dignity_code = chrt.dignity(int(pid))
    except Exception:
        dignity_code = None
    detail = _detail_label(row, event_type)
    event_label = _event_label(row, event_type, prom_display)
    planet_label = (
        mtexts.txts.get("NorthNode", "North Node")
        if row.promittor_id == NORTH_NODE_OBJECT_ID
        else row.promittor_label or (
            prom.label if prom is not None else str(row.promittor_id)
        )
    )
    session_label = _event_session_label(event_type, event_label, planet_label)
    key = "%d:%s:%s:%s:%s:%s" % (
        index,
        row.event_date,
        row.event_time,
        row.promittor_id,
        event_type,
        row.metadata.get("station_code")
        or row.metadata.get("sign_change_event_sign")
        or row.metadata.get("lunar_cycle_code")
        or "",
    )
    filter_group = str(
        row.metadata.get("synodic_filter_group")
        or ("ingress" if event_type == "ingress" else "synodic")
    )
    filter_id = row.metadata.get("synodic_filter_id")
    if filter_id is None:
        filter_id = pid
    return {
        "key": key,
        "eventType": event_type,
        "eventLabel": event_label,
        "detailLabel": detail,
        "sessionLabel": session_label,
        "planetId": pid,
        "planetObjectId": row.promittor_id,
        "planetLabel": planet_label,
        "planetGlyph": glyphs.get_planet_glyph(int(pid)) if pid is not None else "",
        "planetColor": planet_color,
        "planetColorRole": prom_display.get("glyph_color_role") or object_glyph_color_role(
            display_options,
            prom,
            dignity_code,
            resolved_color=planet_color,
        ),
        "filterGroup": filter_group,
        "filterId": filter_id,
        "eventDate": row.event_date,
        "eventTime": row.event_time,
        "displayDatetime": display.iso,
        "displayDate": dateformat.date_text(display_tuple[0], display_tuple[1], display_tuple[2], getattr(chrt, "options", None)),
        "displayTime": "%02d:%02d:%02d" % (display_tuple[3], display_tuple[4], display_tuple[5]),
        "displayUtcOffsetMinutes": display.utc_offset_minutes,
        "openDatetime": "%04d-%02d-%02dT%02d:%02d:%02d" % open_tuple,
        "eventJd": row.event_jd,
        "canOpenChart": bool(row.can_open_chart),
        "sign": sign_payload,
        "longitudeText": str(prom_display.get("degree_text") or _longitude_text(row, prom_display)),
        "motionMarker": str(prom_display.get("motion_marker") or ""),
        "metadata": _json_clean({
            "stationCode": row.metadata.get("station_code"),
            "cazimiMode": row.metadata.get("cazimi_mode"),
            "signChangeDirection": (
                "retrograde" if row.metadata.get("sign_change_retrograde") else "direct"
            ) if row.metadata.get("sign_change") else None,
            "lunarCycle": row.metadata.get("lunar_cycle"),
            "lunarCycleCode": row.metadata.get("lunar_cycle_code"),
            "distanceAu": row.metadata.get("distance_au"),
            "longitudeSpeed": row.metadata.get("longitude_speed"),
            "trueNodeStation": (
                True if row.metadata.get("true_node_station") else None
            ),
            "promDisplay": prom_display,
        }),
    }


def _event_type(row: searchquery.SearchResult) -> str:
    custom_type = row.metadata.get("synodic_event_type")
    if custom_type:
        return str(custom_type)
    if row.metadata.get("eclipse"):
        return "eclipse"
    if row.metadata.get("lunation"):
        return "lunation"
    if row.metadata.get("station"):
        return "station"
    if row.metadata.get("cazimi"):
        return "cazimi"
    if row.metadata.get("sign_change"):
        return "ingress"
    return str(row.aspect or "event")


def _event_label(
    row: searchquery.SearchResult,
    event_type: str,
    prom_display: dict[str, Any],
) -> str:
    if event_type in {"lunation", "eclipse", "draconic", "anomalistic"}:
        return row.event_label or row.notes
    if event_type == "station":
        code = str(row.metadata.get("station_code") or "").upper()
        if code == "SR":
            return mtexts.txts.get("StationRetrograde", "Station (R)")
        if code == "SD":
            return mtexts.txts.get("StationDirect", "Station (D)")
        return mtexts.txts.get("Station", "Station")
    if event_type == "cazimi":
        marker = str(prom_display.get("motion_marker") or "").upper()
        return mtexts.txts.get("CazimiRetrograde", "Cazimi (R)") if marker == "R" else mtexts.txts.get("Cazimi", "Cazimi")
    if event_type == "ingress":
        return "←" if row.metadata.get("sign_change_retrograde") else "→"
    return row.event_label or str(row.aspect or "")


def _event_session_label(event_type: str, event_label: str, planet_label: str) -> str:
    """Semantic chart root for a synodic row; its date remains the tab suffix."""
    if event_type in {"lunation", "eclipse"}:
        return str(event_label or "").strip()
    if event_type == "ingress":
        event_label = mtexts.txts.get("Ingress", "Ingress")
    return " ".join(
        part for part in (str(planet_label or "").strip(), str(event_label or "").strip())
        if part
    )


def _detail_label(row: searchquery.SearchResult, event_type: str) -> str:
    if event_type in {
        "station",
        "cazimi",
        "ingress",
        "lunation",
        "eclipse",
        "draconic",
        "anomalistic",
    }:
        return ""
    return row.event_label or row.notes or ""


def _sign_payload(
    row: searchquery.SearchResult,
    chrt,
    prom_display: dict[str, Any],
    *,
    display_options=None,
) -> dict[str, Any] | None:
    display_options = display_options or effective_display_options(
        getattr(chrt, "options", None)
    )
    sign_index = prom_display.get("sign_index")
    if sign_index is None and row.metadata.get("sign_change"):
        sign_index = row.metadata.get("sign_change_event_sign")
    if sign_index is None:
        return None
    try:
        idx = int(sign_index) % chart.Chart.SIGN_NUM
    except Exception:
        return None
    glyphs = _common(chrt)
    signs = glyphs.Signs1 if getattr(display_options, "signs", True) else glyphs.Signs2
    color = _rgb_css(
        common.get_sign_color(display_options, idx, force_element=True)
    )
    return {
        "index": idx,
        "glyph": signs[idx],
        "label": mtexts.signs[idx],
        "color": color,
        "colorRole": sign_color_role(
            display_options,
            idx,
            force_element=True,
            resolved_color=color,
        ),
    }


def _decorate_display_payload(
    value: Any,
    chrt,
    *,
    display_options=None,
    obj: searchcatalog.SearchObject | None = None,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    source_options = getattr(chrt, "options", None)
    display_options = display_options or effective_display_options(source_options)
    payload = dict(value)
    sign_index = payload.get("sign_index")
    display_longitude = payload.get("display_longitude")
    if sign_index is None and display_longitude is not None:
        try:
            sign_index = int(float(display_longitude) / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
        except Exception:
            sign_index = None
    if sign_index is not None:
        try:
            sign_index_int = int(sign_index) % chart.Chart.SIGN_NUM
        except Exception:
            sign_index_int = None
        if sign_index_int is not None:
            glyphs = _common(chrt)
            signs = glyphs.Signs1 if getattr(display_options, "signs", True) else glyphs.Signs2
            payload["sign_index"] = sign_index_int
            payload["sign_glyph"] = signs[sign_index_int]
            payload["sign_color"] = _rgb_css(
                common.get_sign_color(display_options, sign_index_int, force_element=True)
            )
            payload["sign_color_role"] = sign_color_role(
                display_options,
                sign_index_int,
                force_element=True,
                resolved_color=payload["sign_color"],
            )
    if display_longitude is not None:
        try:
            lon = util.normalize(float(display_longitude))
            sign = int(lon / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
            deg, minute, _second = util.decToDeg(lon - sign * chart.Chart.SIGN_DEG)
            payload["degree_text"] = "%02d%s%02d" % (deg, chr(176), minute)
        except Exception:
            pass
    if payload.get("glyph_color") is not None:
        payload["glyph_color_css"] = _rgb_css(
            object_glyph_color(
                display_options,
                obj,
                payload.get("dignity_code"),
                fallback=payload.get("glyph_color"),
                source_options=source_options,
            )
        )
        payload["glyph_color_role"] = object_glyph_color_role(
            display_options,
            obj,
            payload.get("dignity_code"),
            resolved_color=payload["glyph_color_css"],
        )
    return payload


def _longitude_text(row: searchquery.SearchResult, prom_display: dict[str, Any]) -> str:
    lon_text = prom_display.get("lon_text")
    if lon_text:
        return str(lon_text)
    display_longitude = prom_display.get("display_longitude")
    if display_longitude is not None:
        return searchcatalog.format_longitude(float(display_longitude))
    return ""


def _event_tuple(row: searchquery.SearchResult) -> tuple[int, int, int, int, int, int]:
    return (
        int(row.event_year),
        int(row.event_month),
        int(row.event_day),
        int(row.event_hour),
        int(row.event_minute),
        int(row.event_second),
    )


def _display_datetime_for_chart_instant(chrt, utc_tuple: tuple[int, int, int, int, int, int]) -> tuple[int, int, int, int, int, int]:
    converted = moment.utc_to_chart_local(
        getattr(chrt, "time", None),
        utc_tuple,
        place=getattr(chrt, "place", None),
    )
    return converted if converted is not None else utc_tuple


def _planet_color(chrt, planet_id: int, *, display_options=None) -> str | None:
    opts = display_options or effective_display_options(getattr(chrt, "options", None))
    if opts is None:
        return None
    if getattr(opts, "useplanetcolors", False):
        try:
            color_idx = _common(chrt).get_planet_color_index(planet_id)
            return _rgb_css(getattr(opts, "clrindividual")[color_idx])
        except Exception:
            return _rgb_css(getattr(opts, "clrperegrin", (0, 0, 0)))
    try:
        palette = (
            getattr(opts, "clrdomicil"),
            getattr(opts, "clrexal"),
            getattr(opts, "clrperegrin"),
            getattr(opts, "clrcasus"),
            getattr(opts, "clrexil"),
        )
        return _rgb_css(palette[int(chrt.dignity(int(planet_id)))])
    except Exception:
        return _rgb_css(getattr(opts, "clrperegrin", (0, 0, 0)))


def _rgb_css(value: Any) -> str:
    try:
        r, g, b = list(value)[:3]
        return "#%02x%02x%02x" % (
            max(0, min(255, int(r))),
            max(0, min(255, int(g))),
            max(0, min(255, int(b))),
        )
    except Exception:
        return "#000000"


def _datetime_iso(value: datetime.datetime) -> str:
    return "%04d-%02d-%02dT%02d:%02d:%02d" % (
        value.year,
        value.month,
        value.day,
        value.hour,
        value.minute,
        value.second,
    )


def _json_clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_clean(val) for key, val in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_clean(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _summary_text(count: int) -> str:
    if count == 1:
        return mtexts.txts.get("OneSynodicEvent", "1 synodic event")
    return mtexts.txts.get("NSynodicEvents", "%d synodic events") % count


synodic_service = SynodicService()
