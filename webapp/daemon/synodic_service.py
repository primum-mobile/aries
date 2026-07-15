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
from engine import moment
import mtexts
import options
import searchbackend
import searchcatalog
import searchquery
import util
from webapp.daemon.event_time import DefaultLocationClock, table_event_clock


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
PLANET_IDS = tuple(pid for pid, _key in INGRESS_PLANET_SPECS)
PLANET_OBJECT_IDS = {pid: f"planet:{key}" for pid, key in INGRESS_PLANET_SPECS}
OBJECT_PLANET_IDS = {oid: pid for pid, oid in PLANET_OBJECT_IDS.items()}
EVENT_ORDER = {"eclipse": 0, "lunation": 1, "station": 2, "cazimi": 3, "ingress": 4}
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
        if astrology.SE_MOON in active_planets:
            rows.extend(_search_lunation_and_eclipse_rows(catalog, chrt, start_jd, end_jd, technique, runtime))

        rows = _dedupe_rows(rows)
        rows.sort(key=_row_sort_key)
        display_clock = table_event_clock(getattr(chrt, "options", None))
        payload_rows = [
            _serialize_row(
                row,
                index=index,
                catalog=catalog,
                chrt=chrt,
                display_clock=display_clock,
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
                "columns": [
                    mtexts.txts.get("Planet", "Planet"),
                    mtexts.txts.get("Event", "Event"),
                    mtexts.txts.get("Detail", "Detail"),
                    mtexts.txts.get("Date", "Date"),
                    time_display["columnLabel"],
                ],
                "timeDisplay": time_display,
                "planetItems": _planet_items(catalog, chrt, active_planets),
                "activePlanetIds": list(active_planets),
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


def _planet_items(catalog: searchcatalog.SearchCatalog, chrt, active_planets: Iterable[int]) -> list[dict[str, Any]]:
    active = set(active_planets)
    glyphs = _common(chrt)
    return [
        {
            "id": pid,
            "objectId": oid,
            "label": (catalog.get(oid).label if catalog.get(oid) is not None else glyphs.get_planet_name(pid)),
            "glyph": glyphs.get_planet_glyph(pid),
            "color": _planet_color(chrt, pid),
            "enabled": pid in active,
        }
        for pid, oid in PLANET_OBJECT_IDS.items()
    ]


def _search_lunation_and_eclipse_rows(
    catalog: searchcatalog.SearchCatalog,
    chrt,
    start_jd: float,
    end_jd: float,
    technique: str,
    runtime,
) -> list[searchquery.SearchResult]:
    moon_id = PLANET_OBJECT_IDS[astrology.SE_MOON]
    sun_id = PLANET_OBJECT_IDS[astrology.SE_SUN]
    if catalog.get(moon_id) is None or catalog.get(sun_id) is None:
        return []

    query = searchquery.SearchQuery()
    query.set_promittor_ids([moon_id])
    query.set_significator_ids([sun_id])
    query.set_techniques([searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER])
    query.set_aspects([
        searchquery.SearchQuery.ASPECT_CONJUNCTION,
        searchquery.SearchQuery.ASPECT_OPPOSITION,
    ])
    lunation_rows = searchbackend._search_mundane_weather(
        catalog,
        chrt,
        query,
        start_jd,
        end_jd,
        runtime,
        searchbackend._CompiledQuery(catalog, query),
    )
    for row in lunation_rows:
        row.technique = technique
        # The generic weather query canonically orders Sun before Moon. A
        # lunation is carried by the moving Moon, so its selector/glyph and
        # event-time position must belong to the Moon in this list.
        row.promittor_id = moon_id
        row.significator_id = sun_id
        row.metadata["lunation"] = True
        row.metadata["lunation_kind"] = (
            "new" if row.aspect == searchquery.SearchQuery.ASPECT_CONJUNCTION else "full"
        )
        row.event_label = _lunation_label(row.metadata["lunation_kind"])
        row.notes = row.event_label
        searchbackend._apply_live_pair_row_display_payloads(row, catalog, chrt, runtime)

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
    ] + eclipse_rows


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
) -> dict[str, Any]:
    prom = catalog.get(row.promittor_id)
    glyphs = _common(chrt)
    pid = getattr(prom, "planet_index", None)
    event_tuple = _event_tuple(row)
    display = display_clock.display(event_tuple)
    display_tuple = display.values
    open_tuple = _display_datetime_for_chart_instant(chrt, event_tuple)
    event_type = _event_type(row)
    prom_display = _decorate_display_payload(row.metadata.get("prom_display", {}), chrt)
    sign_payload = _sign_payload(row, chrt, prom_display)
    live_planet_color = prom_display.get("glyph_color_css")
    detail = _detail_label(row, event_type)
    event_label = _event_label(row, event_type, prom_display)
    planet_label = row.promittor_label or (prom.label if prom is not None else str(row.promittor_id))
    session_label = _event_session_label(event_type, event_label, planet_label)
    key = "%d:%s:%s:%s:%s:%s" % (
        index,
        row.event_date,
        row.event_time,
        row.promittor_id,
        event_type,
        row.metadata.get("station_code") or row.metadata.get("sign_change_event_sign") or "",
    )
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
        "planetColor": live_planet_color or (_planet_color(chrt, int(pid)) if pid is not None else None),
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
            "promDisplay": prom_display,
        }),
    }


def _event_type(row: searchquery.SearchResult) -> str:
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
    if event_type in {"lunation", "eclipse"}:
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
    if event_type in {"station", "cazimi", "ingress", "lunation", "eclipse"}:
        return ""
    return row.event_label or row.notes or ""


def _sign_payload(
    row: searchquery.SearchResult,
    chrt,
    prom_display: dict[str, Any],
) -> dict[str, Any] | None:
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
    signs = glyphs.Signs1 if getattr(getattr(chrt, "options", None), "signs", True) else glyphs.Signs2
    return {
        "index": idx,
        "glyph": signs[idx],
        "label": mtexts.signs[idx],
        "color": _rgb_css(common.get_sign_color(getattr(chrt, "options", None), idx, force_element=True)),
    }


def _decorate_display_payload(value: Any, chrt) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
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
            signs = glyphs.Signs1 if getattr(getattr(chrt, "options", None), "signs", True) else glyphs.Signs2
            payload["sign_index"] = sign_index_int
            payload["sign_glyph"] = signs[sign_index_int]
            payload["sign_color"] = _rgb_css(
                common.get_sign_color(getattr(chrt, "options", None), sign_index_int, force_element=True)
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
        payload["glyph_color_css"] = _rgb_css(payload.get("glyph_color"))
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


def _planet_color(chrt, planet_id: int) -> str | None:
    opts = getattr(chrt, "options", None)
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
