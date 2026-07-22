"""Wx-free generic embedded table payloads for workspace-hosted tables.

Packet 05A migrates the row payload contract for the simple Morinus table
family.  The wx owners still define the visual grid, but the webapp consumes
daemon-owned rows: React renders the supplied text/glyph cells and computes no
astrology.
"""
from __future__ import annotations

import datetime
import math
import re
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable

import astrology
import chart
import common
import customerpd
import dateformat
import decennials
import eclipses
import firdaria
import fixstardirs
import fortune
import houses
import manazil
import mtexts
import munprofections
import planets
import profections
import profectionsmonthly
import profectiontable
import primdirs
import triplicitydirections
import transits
import util
import zodiacalreleasing
from angleatbirth import compute_contacts
from engine import chart_factory
from engine import paranatellonta
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.display_palette import (
    aspect_color_role,
    chart_body_color_role,
    effective_display_options,
    sign_color_role,
)
from webapp.daemon.event_time import DefaultLocationClock, table_event_clock
from webapp.daemon.table_catalog import TABLE_CATALOG


Cell = dict[str, Any]
Row = dict[str, Any]


@dataclass(frozen=True)
class TableDef:
    table_id: str
    title: str
    source: str
    builder: Callable[[Any, Any], dict[str, Any]]


def _txt(key: str, fallback: str) -> str:
    return str(mtexts.txts.get(key, fallback))


def _column(column_id: str, label: str, *, align: str = "left", kind: str = "text") -> dict:
    return {"id": column_id, "label": label, "align": align, "kind": kind}


def _text(
    value: Any = "",
    *,
    align: str | None = None,
    emphasis: str | None = None,
    sort_value: Any = None,
    font_role: str | None = None,
    direction: str | None = None,
) -> Cell:
    cell: Cell = {"text": "" if value is None else str(value)}
    if align:
        cell["align"] = align
    if emphasis:
        cell["emphasis"] = emphasis
    if sort_value is not None:
        cell["sortValue"] = sort_value
    if font_role:
        cell["fontRole"] = font_role
    if direction:
        cell["dir"] = direction
    return cell


def _glyph(value: Any = "", *, text: str = "", align: str | None = "center", emphasis: str | None = None) -> Cell:
    cell: Cell = {"glyph": "" if value is None else str(value)}
    if text:
        cell["text"] = text
    if align:
        cell["align"] = align
    if emphasis:
        cell["emphasis"] = emphasis
    return cell


def _runs(*runs: tuple[str, str | bool]) -> Cell:
    out = []
    for text, glyph in runs:
        if text:
            out.append({"text": str(text), "glyph": bool(glyph)})
    return {"runs": out}


def _row(row_id: str, cells: list[Cell], *, meta: dict[str, Any] | None = None,
         emphasis: str | None = None) -> Row:
    result: Row = {"id": row_id, "cells": cells}
    if meta:
        result["meta"] = meta
    if emphasis:
        result["emphasis"] = emphasis
    return result


def _rgb_hex(color: Any) -> str | None:
    # Options colors are (r, g, b) tuples; ship CSS hex so React never owns
    # palette resolution.
    try:
        r, g, b = (int(c) for c in tuple(color)[:3])
        return "#%02x%02x%02x" % (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))
    except Exception:
        return None


def _set_semantic_color(
    target: dict[str, Any],
    color: str | None,
    role: str | None,
    *,
    color_key: str = "color",
    role_key: str = "colorRole",
) -> None:
    """Keep the historical literal while adding a live CSS paint role."""
    if color:
        target[color_key] = color
    if role:
        target[role_key] = role


def _planet_color_role(planet_id: Any, chrt, options, color: str | None) -> str | None:
    return chart_body_color_role(
        options,
        chrt,
        planet_id,
        is_vertex=planet_id == common.CHART_OBJECT_VERTEX,
        resolved_color=color,
    )


def _fortune_color_role(chrt, options, color: str | None) -> str | None:
    return chart_body_color_role(
        options,
        chrt,
        planets.Planets.PLANETS_NUM - 1,
        is_fortune=True,
        resolved_color=color,
    )


def _planet_color(planet_id: int, chrt, options) -> str | None:
    # Faithful port of AspectsWnd._planet_color (aspectswnd.py:94-108): Vertex
    # is always peregrine-colored; useplanetcolors selects the per-planet
    # individual palette via get_planet_color_index; otherwise the dignity
    # palette (domicile/exaltation/peregrine/fall/exile, aspectswnd.py:72)
    # keyed by Chart.dignity, with peregrine as the failure fallback.
    if planet_id == common.CHART_OBJECT_VERTEX:
        return _rgb_hex(getattr(options, "clrperegrin", None))
    if getattr(options, "useplanetcolors", False):
        try:
            palette = list(getattr(options, "clrindividual", []) or [])
            color_idx = min(common.common.get_planet_color_index(int(planet_id)), len(palette) - 1)
            return _rgb_hex(palette[color_idx])
        except Exception:
            return None
    dignity_palette = (
        getattr(options, "clrdomicil", None),
        getattr(options, "clrexal", None),
        getattr(options, "clrperegrin", None),
        getattr(options, "clrcasus", None),
        getattr(options, "clrexil", None),
    )
    try:
        return _rgb_hex(dignity_palette[chrt.dignity(int(planet_id))])
    except Exception:
        return _rgb_hex(getattr(options, "clrperegrin", None))


def _planet_cell(planet_id: int, chrt, options, *, align: str | None = "center",
                 emphasis: str | None = None) -> Cell:
    # Cross-cutting planet-identity cell: glyph + stable planet id + the wx
    # resolved color channel so every table renders planets consistently.
    cell = _glyph(_planet_glyph(planet_id), align=align, emphasis=emphasis)
    cell["planet"] = int(planet_id)
    color = _planet_color(planet_id, chrt, options)
    _set_semantic_color(cell, color, _planet_color_role(planet_id, chrt, options, color))
    return cell


def _planet_run(planet_id: int, chrt, options) -> dict[str, Any]:
    # Run-level planet identity for multi-planet cells: wx draws each glyph of
    # a pair with its own resolved color inside one cell (midpointswnd.py:
    # 202-228). Same color resolution as _planet_cell.
    run: dict[str, Any] = {"text": _planet_glyph(planet_id), "glyph": True, "planet": int(planet_id)}
    color = _planet_color(planet_id, chrt, options)
    _set_semantic_color(run, color, _planet_color_role(planet_id, chrt, options, color))
    return run


def _angle_glyph(angle_key: str) -> str:
    common_instance = getattr(common, "common", None)
    glyphs = getattr(common_instance, "Angles", common.CHART_ANGLE_GLYPHS)
    return str(glyphs.get(str(angle_key).lower(), ""))


def _empty(message: str | None = None) -> list[Row]:
    if message is None:
        message = _txt("NoRows", "No rows")
    return [_row("empty", [_text(message)])]


def _signs(options) -> tuple:
    return common.common.Signs1 if getattr(options, "signs", True) else common.common.Signs2


def _sign_color_hex(options, sign_index: int) -> str | None:
    try:
        element = common.get_sign_element_key(int(sign_index))
    except Exception:
        return None
    if element == "earth":
        return _rgb_hex(getattr(options, "clrsignelementearth", getattr(options, "clrsigns", None)))
    if element == "air":
        return _rgb_hex(getattr(options, "clrsignelementair", getattr(options, "clrsigns", None)))
    if element == "water":
        return _rgb_hex(getattr(options, "clrsignelementwater", getattr(options, "clrsigns", None)))
    return _rgb_hex(getattr(options, "clrsignelementfire", getattr(options, "clrsigns", None)))


def _sign_run(options, sign_index: int, sign: str | None = None) -> dict[str, Any]:
    if sign is None:
        signs = _signs(options)
        sign = signs[sign_index] if 0 <= sign_index < len(signs) else ""
    run: dict[str, Any] = {"text": sign, "glyph": True}
    color = _sign_color_hex(options, sign_index)
    _set_semantic_color(
        run,
        color,
        sign_color_role(options, sign_index, force_element=True, resolved_color=color),
    )
    return run


def _sign_cell(options, sign_index: int, *, align: str = "center") -> Cell:
    signs = _signs(options)
    sign = signs[sign_index] if 0 <= sign_index < len(signs) else ""
    cell = _glyph(sign, align=align)
    color = _sign_color_hex(options, sign_index)
    _set_semantic_color(
        cell,
        color,
        sign_color_role(options, sign_index, force_element=True, resolved_color=color),
    )
    return cell


def _planet_glyph(planet_id: int) -> str:
    try:
        return common.common.get_planet_glyph(int(planet_id)) or ""
    except Exception:
        try:
            return common.common.Planets[int(planet_id)]
        except Exception:
            return str(planet_id)


def _body_ids(chrt, options, *, aspects: bool = False) -> list[int]:
    try:
        if aspects:
            return list(chrt.get_visible_aspect_planet_ids(include_chiron=True))
    except Exception:
        pass
    if getattr(options, "intables", False):
        try:
            return list(common.common.get_visible_chart_planet_ids(
                chrt, options, include_descnode=False, include_chiron=True))
        except Exception:
            pass
    ids = list(range(astrology.SE_SUN, astrology.SE_MEAN_NODE + 1))
    if getattr(chrt, "chiron", None) is not None:
        ids.append(astrology.SE_CHIRON)
    return ids


def _dms(value: float, *, signed: bool = False, sec: bool = False) -> str:
    try:
        val = float(value)
    except Exception:
        return "-"
    sign = ""
    if signed and val < 0.0:
        sign = "-"
    d, m, s = util.decToDeg(abs(val) if signed else val)
    if sec:
        return "%s%s°%02d'%02d\"" % (sign, str(d).rjust(2), m, s)
    return "%s%s°%02d'" % (sign, str(d).rjust(2), m)


def _ra(value: float, options) -> str:
    try:
        val = float(value)
    except Exception:
        return "-"
    if getattr(options, "intime", False):
        d, m, s = util.decToDeg(val / 15.0)
        return "%s:%02d:%02d" % (str(d).rjust(2), m, s)
    return _dms(val, signed=False)


def _new_chart(*args: Any, **kwargs: Any) -> Any:
    # Profections table rows mirror the wx source builder. Construction goes
    # through the ChartFactory choke point (policy-chart-lifecycle Invariant 1).
    return chart_factory.build_chart(*args, **kwargs)


def _lon_cell(value: float, chrt, options) -> Cell:
    try:
        lon = util.normalize(float(value))
        d, m, _s = util.decToDeg(lon)
        sign_idx = int(lon / chart.Chart.SIGN_DEG)
        pos = int(d % chart.Chart.SIGN_DEG)
        text = "%s°%02d' " % (str(pos).rjust(2), m)
        signs = _signs(options)
        sign = signs[sign_idx] if 0 <= sign_idx < len(signs) else ""
        return {"runs": [{"text": text, "glyph": False}, _sign_run(options, sign_idx, sign)], "sortValue": lon}
    except Exception:
        return _text("-")


def _profection_lon_cell(value: float | None, reference_chart, options) -> Cell:
    if value is None:
        return _text("-")
    try:
        lon = util.normalize(float(value))
        d, m, _s = util.decToDeg(lon)
        sign_idx = int(d / chart.Chart.SIGN_DEG)
        pos = int(d % chart.Chart.SIGN_DEG)
        signs = _signs(options)
        sign = signs[sign_idx] if 0 <= sign_idx < len(signs) else ""
        return {
            "runs": [
                {"text": "%s°%02d' " % (str(pos).rjust(2), m), "glyph": False},
                _sign_run(options, sign_idx, sign),
            ],
            "sortValue": lon,
        }
    except Exception:
        return _text("-")


def _time_from_day_fraction(value: float) -> str:
    try:
        hours = float(value) * 24.0
    except Exception:
        return "-"
    hours %= 24.0
    h = int(hours)
    minutes = (hours - h) * 60.0
    m = int(minutes)
    s = int(round((minutes - m) * 60.0))
    if s >= 60:
        s -= 60
        m += 1
    if m >= 60:
        m -= 60
        h = (h + 1) % 24
    return "%02d:%02d:%02d" % (h, m, s)


def _date_ymd(dt: datetime.datetime | datetime.date | None) -> str:
    if dt is None:
        return "-"
    try:
        return dateformat.date_text(int(dt.year), int(dt.month), int(dt.day), chart_snapshot_service.options)
    except Exception:
        return str(dt)


def _date_iso(dt: datetime.datetime | datetime.date | None) -> str | None:
    if dt is None:
        return None
    try:
        return dt.isoformat()
    except Exception:
        return None


def _period_age_text(chrt, dt: datetime.datetime | datetime.date | None) -> str:
    if dt is None:
        return "-"
    try:
        birth = datetime.datetime(int(chrt.time.origyear), int(chrt.time.origmonth), int(chrt.time.origday), 0, 0, 0)
        if isinstance(dt, datetime.datetime):
            event_dt = dt
        else:
            event_dt = datetime.datetime(int(dt.year), int(dt.month), int(dt.day), 0, 0, 0)
        age = (event_dt - birth).total_seconds() / (365.2425 * 86400.0)
        return "%.1f" % age
    except Exception:
        return "-"


def _base_payload(table_id: str, chrt, options, columns: list[dict], rows: list[Row],
                  *, title: str, source: str, notes: list[str] | None = None) -> dict[str, Any]:
    return {
        "tableId": table_id,
        "title": title,
        "sourceName": getattr(chrt, "name", "") or "Radix",
        "columns": columns,
        "rows": rows,
        "notes": list(notes or []),
        "capabilities": {
            "sorting": True,
            "copy": True,
            "export": ["tsv", "json"],
            "currentRow": any(bool(row.get("current")) for row in rows),
            "rowActions": [],
            "dateConvention": dateformat.date_convention_from_options(options),
        },
        "deferrals": [
            "Rendered bitmap/PDF export remains deferred from commonwnd.py:163; Packet 05A exports daemon table payloads as TSV/JSON.",
            "Row context actions/current-row markers are not present for these generic simple-table rows unless a daemon row carries current=true; timed-row action tables stay in their owning packets.",
        ],
        "source": source,
        "cellEncoding": "text-glyph-runs",
        "unavailable": False,
    }


def _parse_datetime(value: Any) -> datetime.datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime.datetime):
        return value
    if isinstance(value, datetime.date):
        return datetime.datetime(int(value.year), int(value.month), int(value.day))
    if isinstance(value, str):
        try:
            return datetime.datetime.fromisoformat(value)
        except Exception:
            return None
    try:
        parts = list(value)
    except Exception:
        return None
    if len(parts) >= 6:
        try:
            return datetime.datetime(
                int(parts[0]),
                int(parts[1]),
                int(parts[2]),
                int(parts[3]),
                int(parts[4]),
                int(parts[5]),
            )
        except Exception:
            return None
    return None


def _row_contains(row: dict[str, Any], dt: datetime.datetime | None) -> bool:
    if dt is None:
        return False
    try:
        return row["start"] <= dt < row["end"]
    except Exception:
        return False


def _chart_local_datetime(chrt) -> datetime.datetime:
    try:
        return chrt.time.getDatetime()
    except Exception:
        t = chrt.time
        return datetime.datetime(
            int(getattr(t, "origyear", getattr(t, "year"))),
            int(getattr(t, "origmonth", getattr(t, "month"))),
            int(getattr(t, "origday", getattr(t, "day"))),
            int(getattr(t, "hour", 0)),
            int(getattr(t, "minute", 0)),
            int(getattr(t, "second", 0)),
        )


_ECLIPSE_RANGE_YEARS = 10
_ECLIPSE_CACHE_CHUNK_YEARS = 10
_ECLIPSE_EDGE_TRIGGER_ROWS = 4
_ECLIPSE_MAX_VISIBLE_ROWS = 22
_ECLIPSE_CHUNK_CACHE_MAX = 256
_ECLIPSE_CHUNK_CACHE: OrderedDict[tuple[float, float], list] = OrderedDict()


def _eclipse_date_values_from_datetime(chrt, current_datetime: Any = None) -> tuple[int, int, int, int, int, int]:
    if isinstance(current_datetime, datetime.datetime):
        return (
            int(current_datetime.year),
            int(current_datetime.month),
            int(current_datetime.day),
            int(current_datetime.hour),
            int(current_datetime.minute),
            int(current_datetime.second),
        )
    if isinstance(current_datetime, datetime.date):
        return (int(current_datetime.year), int(current_datetime.month), int(current_datetime.day), 0, 0, 0)
    # EclipsesFrame opens around the consultation date, not the radix birth
    # date. If no explicit focus is supplied, use the wall clock so the nearest
    # current eclipse anchors the initial viewport.
    now = datetime.datetime.now()
    return (now.year, now.month, now.day, now.hour, now.minute, now.second)


def _eclipse_birth_date_values(chrt) -> tuple[int, int, int]:
    t = getattr(chrt, "time", None)
    if t is None:
        now = datetime.datetime.now()
        return (int(now.year), int(now.month), int(now.day))
    return (
        int(getattr(t, "origyear", getattr(t, "year", 0))),
        int(getattr(t, "origmonth", getattr(t, "month", 1))),
        int(getattr(t, "origday", getattr(t, "day", 1))),
    )


def _eclipse_chart_anchor_date_values(chrt, chart_anchor_datetime: Any = None) -> tuple[int, int, int]:
    if isinstance(chart_anchor_datetime, (datetime.datetime, datetime.date)):
        return _eclipse_date_values_from_datetime(chrt, chart_anchor_datetime)[:3]
    return _eclipse_birth_date_values(chrt)


def _eclipse_date_tuple(value: Any) -> tuple[int, int, int] | None:
    if isinstance(value, dict):
        raw = (value.get("year"), value.get("month"), value.get("day"))
    else:
        raw = value
    try:
        y, m, d = tuple(raw)[:3]
        y, m, d = int(y), int(m), int(d)
        if not (1 <= m <= 12 and 1 <= d <= 31):
            return None
        return (y, m, d)
    except Exception:
        return None


def _eclipse_range_from_binding(
    chrt,
    binding: dict[str, Any] | None,
    current_datetime: Any = None,
) -> tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int, int, int, int]]:
    focus_values = _eclipse_date_values_from_datetime(chrt, current_datetime)
    cleaned = binding or {}
    # Explicit focus override — wx _rebuild_rows(focus_values=(year, 7, 1)) after
    # -10y/+10y or year entry (eclipsesframe.py:470, 536). Without it the focus
    # stays on the chart-cursor date (eclipsesframe.py:141-144 reference focus).
    focus_override = _eclipse_date_tuple(cleaned.get("focus"))
    if focus_override is not None:
        focus_values = (focus_override[0], focus_override[1], focus_override[2], 0, 0, 0)
    from_values = _eclipse_date_tuple(cleaned.get("from"))
    to_values = _eclipse_date_tuple(cleaned.get("to"))
    if from_values is not None and to_values is not None and from_values <= to_values:
        return from_values, to_values, focus_values
    try:
        center_year = int(cleaned.get("year"))
    except Exception:
        center_year = int(focus_values[0])
    return (
        (center_year - _ECLIPSE_RANGE_YEARS, 1, 1),
        (center_year + _ECLIPSE_RANGE_YEARS, 12, 31),
        focus_values,
    )


def _eclipse_center_year(binding: dict[str, Any] | None,
                         from_values: tuple[int, int, int],
                         to_values: tuple[int, int, int]) -> int:
    try:
        return int((binding or {}).get("year"))
    except Exception:
        return int(round((int(from_values[0]) + int(to_values[0])) / 2.0))


def _eclipse_chunk_key(year: int) -> int:
    return int(year) // _ECLIPSE_CACHE_CHUNK_YEARS


def _eclipse_chunk_bounds(chunk_key: int) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    start_year = int(chunk_key) * _ECLIPSE_CACHE_CHUNK_YEARS
    end_year = start_year + _ECLIPSE_CACHE_CHUNK_YEARS - 1
    return (start_year, 1, 1), (end_year, 12, 31)


def _eclipse_chunk_keys(from_values: tuple[int, int, int], to_values: tuple[int, int, int]) -> range:
    return range(_eclipse_chunk_key(from_values[0]), _eclipse_chunk_key(to_values[0]) + 1)


def _eclipse_jd_bounds(chrt, from_values: tuple[int, int, int], to_values: tuple[int, int, int]) -> tuple[float, float]:
    jd_from = eclipses.local_day_bounds_to_jd(chrt, *from_values)[0]
    jd_to = eclipses.local_day_bounds_to_jd(chrt, *to_values)[1]
    return float(jd_from), float(jd_to)


def _eclipse_events_for_range(chrt, from_values: tuple[int, int, int], to_values: tuple[int, int, int]) -> list:
    jd_from, jd_to = _eclipse_jd_bounds(chrt, from_values, to_values)
    out = []
    for chunk_key in _eclipse_chunk_keys(from_values, to_values):
        chunk_from, chunk_to = _eclipse_chunk_bounds(chunk_key)
        chunk_jd_from, chunk_jd_to = _eclipse_jd_bounds(chrt, chunk_from, chunk_to)
        events = _cached_eclipse_chunk_events(chrt, chunk_jd_from, chunk_jd_to)
        for event in events:
            try:
                event_jd = float(getattr(event, "jdut"))
            except Exception:
                continue
            if jd_from <= event_jd <= jd_to:
                out.append(event)
    out.sort(key=lambda event: float(getattr(event, "jdut", 0.0)))
    return out


def _cached_eclipse_chunk_events(chrt, jd_from: float, jd_to: float) -> list:
    key = (round(float(jd_from), 6), round(float(jd_to), 6))
    cached = _ECLIPSE_CHUNK_CACHE.get(key)
    if cached is not None:
        _ECLIPSE_CHUNK_CACHE.move_to_end(key)
        return list(cached)
    try:
        events = eclipses.find_eclipses_in_range(chrt, jd_from, jd_to)
    except Exception:
        events = []
    _ECLIPSE_CHUNK_CACHE[key] = list(events)
    if len(_ECLIPSE_CHUNK_CACHE) > _ECLIPSE_CHUNK_CACHE_MAX:
        _ECLIPSE_CHUNK_CACHE.popitem(last=False)
    return list(events)


def _eclipse_type_label(event) -> str:
    try:
        if bool(getattr(event, "is_solar", False)):
            token, _major, _priority = eclipses._classify_solar_from_retflag(int(getattr(event, "retflag", 0)))
        else:
            token, _major, _priority = eclipses._classify_lunar_from_retflag(int(getattr(event, "retflag", 0)))
    except Exception:
        token = "UNKNOWN"
    return {
        "TOTAL": _txt("Total2", "Total"),
        "ANNULAR": _txt("Annular", "Annular"),
        "HYBRID": _txt("Hybrid", "Hybrid"),
        "PARTIAL": _txt("Partial", "Partial"),
        "PENUMBRAL": _txt("Penumbral", "Penumbral"),
        "UNKNOWN": _txt("Unknown", "Unknown"),
    }.get(str(token), str(token))


def _eclipse_datetime_payload(event, chrt, mode: str) -> tuple[str | None, str | None, dict[str, Any] | None, float]:
    event_jd = eclipses.chart_moment_jdut_for_event(event, mode)
    try:
        values, time_context = eclipses.local_datetime_tuple_and_context(event_jd, chrt)
    except Exception:
        values = eclipses.local_datetime_tuple(event_jd, chrt)
        time_context = None
    try:
        y, m, d, h, mi, s = [int(v) for v in tuple(values)[:6]]
        dt_iso = "%04d-%02d-%02dT%02d:%02d:%02d" % (y, m, d, h, mi, s)
        date_iso = "%04d-%02d-%02d" % (y, m, d)
    except Exception:
        dt_iso = None
        date_iso = None
    return dt_iso, date_iso, time_context if isinstance(time_context, dict) else None, float(event_jd)


def _eclipse_longitude_cell(event, options) -> Cell:
    try:
        lon = float(getattr(event, "elon", 0.0)) % 360.0
        d, m, _s = util.decToDeg(lon)
        sign_idx = int(lon / chart.Chart.SIGN_DEG)
        pos = int(d % chart.Chart.SIGN_DEG)
        signs = _signs(options)
        sign = signs[sign_idx] if 0 <= sign_idx < len(signs) else ""
        return {
            "runs": [
                {"text": "%s°%02d' " % (str(pos).rjust(2), m), "glyph": False},
                _sign_run(options, sign_idx, sign),
            ],
            "align": "right",
        }
    except Exception:
        return _text("-", align="right")


def _eclipses(chrt, options, *, binding: dict[str, Any] | None = None,
              current_datetime: Any = None,
              chart_anchor_datetime: Any = None) -> dict[str, Any]:
    source = "eclipsesframe.py; eclipseswnd.py; eclipses.py"
    from_values, to_values, focus_values = _eclipse_range_from_binding(chrt, binding, current_datetime)
    current_values = _eclipse_date_values_from_datetime(chrt, None)[:3]
    birth_values = _eclipse_chart_anchor_date_values(chrt, chart_anchor_datetime)
    focus_jd = eclipses.local_day_bounds_to_jd(chrt, focus_values[0], focus_values[1], focus_values[2])[0]
    mode = str(
        getattr(
            options,
            "eclipse_chart_moment",
            getattr(eclipses, "ECLIPSE_CHART_MOMENT_EXACT", "exact_conjunction"),
        )
        or "exact_conjunction"
    )
    if mode not in {
        getattr(eclipses, "ECLIPSE_CHART_MOMENT_EXACT", "exact_conjunction"),
        getattr(eclipses, "ECLIPSE_CHART_MOMENT_MAXIMUM", "eclipse_maximum"),
    }:
        mode = getattr(eclipses, "ECLIPSE_CHART_MOMENT_EXACT", "exact_conjunction")
    events = _eclipse_events_for_range(chrt, from_values, to_values)
    display_clock = table_event_clock(options)
    columns = [
        _column("date", _txt("Date", "Date"), align="center"),
        _column("time", _txt("Time", "Time"), align="center"),
        _column("kind", _txt("Kind", "Kind"), align="center"),
        _column("type", _txt("Type", "Type"), align="center"),
        _column("longitude", _txt("Longitude", "Longitude"), align="right"),
        _column("saros", _txt("Saros", "Saros"), align="right"),
    ]
    focus_row_id = None
    focus_row_index = None
    if events:
        focus_index = min(range(len(events)), key=lambda idx: abs(float(getattr(events[idx], "jdut", 0.0)) - float(focus_jd)))
        focus_row_index = int(focus_index)
    rows: list[Row] = []
    display_offsets: list[int] = []
    saros_first_cache: dict[tuple[bool, int], Any] = {}
    for index, event in enumerate(events):
        event_jd = float(getattr(event, "jdut", 0.0))
        row_id = "eclipse:%s:%s" % ("solar" if getattr(event, "is_solar", False) else "lunar", "%.6f" % event_jd)
        if index == focus_row_index:
            focus_row_id = row_id
        is_solar = bool(getattr(event, "is_solar", False))
        kind_label = _txt("Solar2", "Solar") if is_solar else _txt("Lunar2", "Lunar")
        session_label = _txt("SolarEclipse", "Solar Eclipse") if is_solar else _txt("LunarEclipse", "Lunar Eclipse")
        type_label = _eclipse_type_label(event)
        dt_iso, date_iso, time_context, chart_moment_jd = _eclipse_datetime_payload(event, chrt, mode)
        event_display = display_clock.display(eclipses._utc_tuple_from_jdut(chart_moment_jd))
        display_offsets.append(event_display.utc_offset_minutes)
        display_date_iso = "%04d-%02d-%02d" % event_display.values[:3]
        has_path = is_solar and bool(int(getattr(event, "retflag", 0)) & int(getattr(eclipses, "SOLAR_BOLD_FLAGS", 0)))
        saros_raw = getattr(event, "saros", None)
        try:
            saros_meta = int(saros_raw)
        except Exception:
            saros_meta = None if saros_raw in (None, "") else str(saros_raw)
        saros_parsed = eclipses.saros_series_member(saros_raw)
        saros_series = saros_parsed[0] if saros_parsed else None
        saros_member = saros_parsed[1] if saros_parsed else None
        saros_first_event = None
        saros_first_date = None
        saros_first_label = None
        saros_first_jd = None
        if saros_series is not None:
            cache_key = (is_solar, int(saros_series))
            if cache_key not in saros_first_cache:
                saros_first_cache[cache_key] = eclipses.first_saros_event(event)
            saros_first_event = saros_first_cache.get(cache_key)
        if saros_first_event is not None:
            saros_first_jd = float(getattr(saros_first_event, "jdut", 0.0))
            first_values = display_clock.display(eclipses._utc_tuple_from_jdut(saros_first_jd)).values
            saros_first_date = "%04d-%02d-%02d" % (first_values[0], first_values[1], first_values[2])
            saros_first_label = dateformat.date_text(first_values[0], first_values[1], first_values[2], options)
        row_actions = [
            "open_containing_solar_revolution",
            "open_transit_for_date",
            "open_chart_for_date",
            "show_eclipse_path_on_map",
        ]
        if saros_first_date is not None and (saros_member or 0) > 1:
            row_actions.append("go_to_first_saros_eclipse")
        meta = {
            "eventJd": event_jd,
            "eventJdMaximum": event_jd,
            "eventJdChartMoment": chart_moment_jd,
            "eventDatetime": dt_iso,
            "eventDate": date_iso,
            "displayDatetime": event_display.iso,
            "displayDate": display_date_iso,
            "displayTime": event_display.time_text,
            "displayUtcOffsetMinutes": event_display.utc_offset_minutes,
            "timeContext": time_context,
            "kind": "solar" if is_solar else "lunar",
            "kindLabel": kind_label,
            "sessionLabel": session_label,
            "type": type_label,
            "retflag": int(getattr(event, "retflag", 0)),
            "isSolar": is_solar,
            "longitude": float(getattr(event, "elon", 0.0)),
            "saros": saros_meta,
            "sarosSeries": saros_series,
            "sarosMember": saros_member,
            "sarosFirstDate": saros_first_date,
            "sarosFirstLabel": saros_first_label,
            "sarosFirstJd": saros_first_jd,
            "hasEclipsePath": has_path,
            "eclipseChartMoment": mode,
            "rowActions": row_actions,
        }
        if time_context is None:
            meta.pop("timeContext", None)
        row = _row(
            row_id,
            [
                _text(
                    dateformat.date_text(
                        event_display.values[0], event_display.values[1], event_display.values[2], options,
                    ),
                    align="center",
                ),
                _text("%02d:%02d" % event_display.values[3:5], align="center"),
                _text(kind_label, align="center"),
                _text(type_label, align="center"),
                _eclipse_longitude_cell(event, options),
                _text(saros_raw if saros_raw not in (None, "") else "-", align="right"),
            ],
            meta=meta,
            emphasis="strong" if bool(getattr(event, "bold", False)) else None,
        )
        if row_id == focus_row_id:
            row["current"] = True
            row.setdefault("meta", {})["focus"] = True
        rows.append(row)

    time_display = display_clock.metadata(
        _txt("Time", "Time"),
        offsets=display_offsets,
    )
    columns[1]["label"] = time_display["columnLabel"]

    payload = _base_payload(
        "eclipses",
        chrt,
        options,
        columns,
        rows or _empty(_txt("NoEclipses", "No eclipses in this range")),
        title=_txt("Eclipses", "Eclipses"),
        source=source,
        notes=[
            _txt("EclipseRangeNote", "Range: %s - %s.") % (
                dateformat.date_text(from_values[0], from_values[1], from_values[2], options),
                dateformat.date_text(to_values[0], to_values[1], to_values[2], options),
            ),
            "%s: %s." % (
                _txt("ChartMoment", "Chart moment"),
                _txt("EclipseMaximum", "Eclipse maximum")
                if mode == getattr(eclipses, "ECLIPSE_CHART_MOMENT_MAXIMUM", "eclipse_maximum")
                else _txt("ExactConjunction", "Exact conjunction"),
            ),
        ],
    )
    payload["capabilities"] = {
        **payload.get("capabilities", {}),
        "sorting": False,
        "copy": True,
        "export": ["tsv", "json"],
        "timeDisplay": time_display,
        "currentRow": focus_row_id is not None,
        "currentRowIds": [focus_row_id] if focus_row_id is not None else [],
        "rowActions": [
            {"id": "open_containing_solar_revolution", "deferred": False},
            {"id": "open_transit_for_date", "deferred": False},
            {"id": "open_chart_for_date", "deferred": False},
            {
                "id": "show_eclipse_path_on_map",
                "deferred": False,
                "enabledWhen": "central_solar_eclipse",
            },
            {
                "id": "go_to_first_saros_eclipse",
                "deferred": False,
                "enabledWhen": "saros_member_after_first",
            },
        ],
        "eclipses": {
            "rangeYears": _ECLIPSE_RANGE_YEARS,
            "chunkYears": _ECLIPSE_CACHE_CHUNK_YEARS,
            "edgeTriggerRows": _ECLIPSE_EDGE_TRIGGER_ROWS,
            "maxVisibleRows": _ECLIPSE_MAX_VISIBLE_ROWS,
            "from": list(from_values),
            "to": list(to_values),
            # The web toolbar switches between wall clock and the selected
            # chart session cursor. For a focused radix that cursor is the
            # radix birth date; for a focused transit/return child it is the
            # child chart's display cursor.
            "currentDate": list(current_values),
            "birthDate": list(birth_values),
            # wx keeps the year box value sticky across endless-scroll range
            # extension (eclipsesframe.py:407,412 update_year=False); only
            # -10y/+10y and year entry re-centre it. The binding 'year' carries
            # that sticky value; the midpoint is the fallback for fresh ranges
            # (eclipsesframe.py:154-155 _year_from_range_values).
            "centerYear": _eclipse_center_year(binding, from_values, to_values),
            "focusDate": list(focus_values[:3]),
            "focusRowId": focus_row_id,
            "focusRowIndex": focus_row_index,
            "chartMoment": mode,
            "chartMomentOptions": [
                {"value": getattr(eclipses, "ECLIPSE_CHART_MOMENT_EXACT", "exact_conjunction"), "label": "Exact conjunction"},
                {"value": getattr(eclipses, "ECLIPSE_CHART_MOMENT_MAXIMUM", "eclipse_maximum"), "label": "Eclipse maximum"},
            ],
            "noRowsLabel": _txt("NoEclipses", "No eclipses in this range"),
        },
    }
    payload["source"] = source
    payload["deferrals"] = []
    return payload


def _period_meta(
    row: dict[str, Any],
    *,
    row_id: str,
    parent_id: str | None,
    current: bool,
    has_children: bool,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    meta = {
        "level": int(row.get("level", 0)),
        "parentId": parent_id,
        "hasChildren": bool(has_children),
        "periodStart": _date_iso(row.get("start")),
        "periodEndExclusive": _date_iso(row.get("end")),
        "eventDate": _date_iso(row.get("start")),
        "rowActions": ["open_containing_solar_revolution", "open_transit_for_date", "open_chart_for_date"],
    }
    if extra:
        meta.update(extra)
    if current:
        meta["current"] = True
    return meta


# Start-selector tokens + labels in the wx radio-submenu order
# (DecWnd._start_selector_labels, decennialswnd.py:82-94).
_DECENNIAL_START_OPTIONS = (
    ("sect", _txt("SectLight", "Sect Light")),
    ("sun", _txt("Sun", "Sun")),
    ("moon", _txt("Moon", "Moon")),
    ("asc", _txt("Ascendant", "Ascendant")),
    ("fortune", _txt("LotOfFortune", "Lot of Fortune")),
    ("saturn", _txt("Saturn", "Saturn")),
    ("jupiter", _txt("Jupiter", "Jupiter")),
    ("mars", _txt("Mars", "Mars")),
    ("venus", _txt("Venus", "Venus")),
    ("mercury", _txt("Mercury", "Mercury")),
)

# token -> SE index for the planet start tokens (DecWnd._drawDC pmap,
# decennialswnd.py:355-360; same map in decennials._resolve_start_planet:104-109).
_DECENNIAL_PLANET_TOKENS = {
    "sun": astrology.SE_SUN, "moon": astrology.SE_MOON,
    "mercury": astrology.SE_MERCURY, "venus": astrology.SE_VENUS,
    "mars": astrology.SE_MARS, "jupiter": astrology.SE_JUPITER,
    "saturn": astrology.SE_SATURN,
}


def _dec_strip_year_zeros(text: str) -> str:
    """Port of DecWnd._strip_year_zeros_ymd (decennialswnd.py:138-154):
    strips the leading zeros of the year part of 'YYYY.MM.DD[ BC...]'."""
    try:
        suffix = ""
        core = text
        if " BC" in text:
            core, rest = text.split(" BC", 1)
            suffix = " BC" + rest
        parts = core.split(".", 1)
        if len(parts) >= 2:
            return "%d.%s%s" % (int(parts[0]), parts[1], suffix)
        return text
    except Exception:
        return text


def _dec_planet_color(chrt, options, planet_id: int) -> str:
    """Planet glyph colour — useplanetcolors -> clrindividual[p], else the
    dignity palette [domicil, exal, peregrin, casus, exil][chart.dignity(p)]
    (DecWnd._drawDC, decennialswnd.py:452-463; same rule for the info-row glyph,
    decennialswnd.py:374-385). decennials rows carry raw SE indices, which index
    common.common.Planets / options.clrindividual directly (no correction map)."""
    try:
        if getattr(options, "useplanetcolors", False):
            return _zr_hex(options.clrindividual[int(planet_id)])
        pal = (
            getattr(options, "clrdomicil", (0, 0, 0)),
            getattr(options, "clrexal", (0, 0, 0)),
            getattr(options, "clrperegrin", (0, 0, 0)),
            getattr(options, "clrcasus", (0, 0, 0)),
            getattr(options, "clrexil", (0, 0, 0)),
        )
        return _zr_hex(pal[int(chrt.dignity(int(planet_id)))])
    except Exception:
        return "#888888"


def _decennials(chrt, options, binding: dict[str, Any] | None = None, *, current_datetime: Any = None) -> dict[str, Any]:
    source = "morin.py:16014-16031,17164-17181,17699-17729,4079-4117; decennials.py:1-223; decennialswnd.py:31-125,190-210; decennials_popup.py:126-160; time_lord_popup.py:511-672"
    if getattr(getattr(chrt, "time", None), "bc", False):
        return _unavailable(
            "decennials",
            chrt,
            title=_txt("Decennials", "Decennials"),
            source=source,
            reason=_txt("NotAvailable", "Not available for BC charts."),
        )
    binding = dict(binding or {})
    allowed = {token for token, _label in _DECENNIAL_START_OPTIONS}
    start_token = str(binding.get("start_token") or "sect").strip().lower()
    if start_token not in allowed:
        start_token = "sect"
    now = _parse_datetime(current_datetime)
    main_rows = decennials.build_main(chrt, options, cycles=2, start_selector=start_token)
    # Visible list columns. The level remains row structure/indent metadata in
    # the webapp, not a boxed data column.
    columns = [
        {**_column("planet", _txt("Ruler", "Ruler"), align="center", kind="glyph"), "widthFactor": 2},
        {**_column("start", _txt("Start", "Start"), align="center"), "widthFactor": 5},
        {**_column("age", _txt("Age", "Age"), align="right"), "widthFactor": 2},
        {**_column("length", _txt("Length", "Length"), align="right"), "widthFactor": 3},
    ]
    rows: list[Row] = []
    current_ids: list[str] = []
    expanded_ids: set[str] = set()
    current_l1_id: str | None = None
    current_l2_id: str | None = None

    l1_index = -1
    l2_index = -1
    active_l1_id: str | None = None
    for source_row in main_rows:
        level = int(source_row.get("level", 0))
        if level == 1:
            l1_index += 1
            l2_index = -1
            row_id = f"l1:{l1_index}"
            active_l1_id = row_id
            parent_id = None
            has_children = True
            if _row_contains(source_row, now):
                current_l1_id = row_id
        else:
            l2_index += 1
            row_id = f"l1:{l1_index}:l2:{l2_index}"
            parent_id = active_l1_id
            has_children = True
            if _row_contains(source_row, now):
                current_l2_id = row_id
        is_current = row_id in (current_l1_id, current_l2_id)
        if is_current:
            current_ids.append(row_id)
            if parent_id:
                expanded_ids.add(parent_id)
        planet_id = int(source_row.get("planet", astrology.SE_SUN))
        planet_color = _dec_planet_color(chrt, options, planet_id)
        planet_role = _planet_color_role(planet_id, chrt, options, planet_color)
        planet_cell = _glyph(_planet_glyph(planet_id))
        planet_cell["planet"] = planet_id
        _set_semantic_color(planet_cell, planet_color, planet_role)
        rows.append(_row(
            row_id,
            [
                planet_cell,
                # Start text = fmt_date + year-zero strip (decennialswnd.py:449,666).
                _text(_dec_strip_year_zeros(decennials.fmt_date(source_row.get("start"))), align="center"),
                _text(_period_age_text(chrt, source_row.get("start")) if level == 1 else "", align="right"),
                _text(decennials.fmt_length(source_row), align="right"),
            ],
            meta=_period_meta(
                source_row,
                row_id=row_id,
                parent_id=parent_id,
                current=is_current,
                has_children=has_children,
                extra={
                    "planet": planet_id,
                    "colorHex": planet_color,
                    "colorRole": planet_role,
                },
            ),
        ))
        if is_current:
            rows[-1]["current"] = True
        if level == 2:
            l3_rows = decennials.build_children_valens(chrt, options, source_row, level=3)
            for l3_index, l3 in enumerate(l3_rows):
                l3_id = f"{row_id}:l3:{l3_index}"
                is_l3_current = _row_contains(l3, now)
                if is_l3_current:
                    current_ids.append(l3_id)
                    expanded_ids.add(row_id)
                    expanded_ids.add(l3_id)
                l3_planet = int(l3.get("planet", astrology.SE_SUN))
                l3_color = _dec_planet_color(chrt, options, l3_planet)
                l3_role = _planet_color_role(l3_planet, chrt, options, l3_color)
                l3_cell = _glyph(_planet_glyph(l3_planet))
                l3_cell["planet"] = l3_planet
                _set_semantic_color(l3_cell, l3_color, l3_role)
                rows.append(_row(
                    l3_id,
                    [
                        l3_cell,
                        _text(_dec_strip_year_zeros(decennials.fmt_date(l3.get("start"))), align="center"),
                        _text("", align="right"),
                        _text(decennials.fmt_length(l3), align="right"),
                    ],
                    meta=_period_meta(
                        l3,
                        row_id=l3_id,
                        parent_id=row_id,
                        current=is_l3_current,
                        has_children=True,
                        extra={
                            "planet": l3_planet,
                            "colorHex": l3_color,
                            "colorRole": l3_role,
                        },
                    ),
                ))
                if is_l3_current:
                    rows[-1]["current"] = True
                l4_rows = decennials.build_children_valens(chrt, options, l3, level=4)
                for l4_index, l4 in enumerate(l4_rows):
                    l4_id = f"{l3_id}:l4:{l4_index}"
                    is_l4_current = _row_contains(l4, now)
                    if is_l4_current:
                        current_ids.append(l4_id)
                    l4_planet = int(l4.get("planet", astrology.SE_SUN))
                    l4_color = _dec_planet_color(chrt, options, l4_planet)
                    l4_role = _planet_color_role(l4_planet, chrt, options, l4_color)
                    l4_cell = _glyph(_planet_glyph(l4_planet))
                    l4_cell["planet"] = l4_planet
                    _set_semantic_color(l4_cell, l4_color, l4_role)
                    rows.append(_row(
                        l4_id,
                        [
                            l4_cell,
                            _text(_dec_strip_year_zeros(decennials.fmt_date(l4.get("start"))), align="center"),
                            _text("", align="right"),
                            _text(decennials.fmt_length(l4), align="right"),
                        ],
                        meta=_period_meta(
                            l4,
                            row_id=l4_id,
                            parent_id=l3_id,
                            current=is_l4_current,
                            has_children=False,
                            extra={
                                "planet": l4_planet,
                                "colorHex": l4_color,
                                "colorRole": l4_role,
                            },
                        ),
                    ))
                    if is_l4_current:
                        rows[-1]["current"] = True

    payload = _base_payload(
        "decennials",
        chrt,
        options,
        columns,
        rows or _empty(),
        title=_txt("Decennials", "Decennials"),
        source=source,
        notes=[_txt("DecennialStartNote", "Start: %s") % dict(_DECENNIAL_START_OPTIONS).get(start_token, start_token)],
    )
    # Info row "Start: <glyph|text>" — DecWnd._drawDC [A] block
    # (decennialswnd.py:348-413): planet tokens render the Morinus glyph in the
    # wx colour rule; sect/asc/fortune render the mtexts label.
    start_is_planet = start_token in _DECENNIAL_PLANET_TOKENS
    start_planet = _DECENNIAL_PLANET_TOKENS.get(start_token)
    start_color = _dec_planet_color(chrt, options, start_planet) if start_is_planet else None
    header = {
        "startLabel": _txt("Start", "Start"),
        "startToken": start_token,
        "startIsPlanet": start_is_planet,
        "startGlyph": _planet_glyph(start_planet) if start_is_planet else "",
        "startText": "" if start_is_planet else dict(_DECENNIAL_START_OPTIONS).get(start_token, start_token),
        "startColorHex": start_color,
        "startColorRole": _planet_color_role(start_planet, chrt, options, start_color) if start_is_planet else None,
    }
    payload["capabilities"] = {
        **payload.get("capabilities", {}),
        "sorting": False,
        "copy": True,
        "export": ["tsv", "json"],
        "timeLord": True,
        "timeLordSystem": "decennials",
        "tree": True,
        "currentRow": bool(current_ids),
        "currentRowIds": current_ids,
        "initialExpandedRowIds": sorted(expanded_ids),
        "bindings": {"start_token": start_token},
        "bindingOptions": {
            "startToken": [{"value": token, "label": label} for token, label in _DECENNIAL_START_OPTIONS],
        },
        "decennials": header,
        "rowActions": [
            {"id": "open_containing_solar_revolution", "deferred": False},
            {"id": "open_transit_for_date", "deferred": False},
            {"id": "open_chart_for_date", "deferred": False},
        ],
    }
    payload["deferrals"] = [
        "Rendered bitmap/PDF export remains deferred from commonwnd.py:102/163 and DecWnd.pdf_export_spec (decennialswnd.py:279-336); the web surface exports daemon row payloads as TSV/JSON.",
    ]
    return payload


_TRIPLICITY_EAGER_LEVEL = 4
_TRIPLICITY_MAX_EXPANDED_ROWS = 256


def _triplicity_expanded_row_ids(binding: dict[str, Any]) -> list[str]:
    raw_expanded = binding.get("expanded_row_ids")
    values: list[str] = []
    if isinstance(raw_expanded, str):
        raw_expanded = [raw_expanded]
    if isinstance(raw_expanded, (list, tuple)):
        for item in raw_expanded:
            if isinstance(item, str) and item.startswith("cycle:"):
                values.append(item)
    drill_row_id = binding.get("drill_row_id")
    if isinstance(drill_row_id, str) and drill_row_id.startswith("cycle:"):
        values.append(drill_row_id)
    return list(dict.fromkeys(values))[:_TRIPLICITY_MAX_EXPANDED_ROWS]


def _triplicity_directions(chrt, options, binding: dict[str, Any] | None = None, *, current_datetime: Any = None) -> dict[str, Any]:
    source = "Research feature: Bonatti-style triplicity timing; triplicitydirections.py; sources: Tony Louis 2020 triplicity-lord overview, Astrology Courses Bonatti multiple-choice triplicity method"
    if getattr(getattr(chrt, "time", None), "bc", False):
        return _unavailable(
            "triplicity_directions",
            chrt,
            title=_txt("TriplicityDirections", "Triplicity Directions"),
            source=source,
            reason=_txt("NotAvailable", "Not available for BC charts."),
        )

    binding = dict(binding or {})
    extended_depth = bool(binding.get("extended_depth", False))
    max_level = triplicitydirections.EXTENDED_MAX_LEVEL if extended_depth else triplicitydirections.MAX_LEVEL
    base_sign = triplicitydirections.resolved_base_sign(chrt, options, binding.get("start_sign"))
    requested_expanded_ids = _triplicity_expanded_row_ids(binding)
    drill_row_id = binding.get("drill_row_id")
    drill_row_id = drill_row_id if isinstance(drill_row_id, str) else None
    now = _parse_datetime(current_datetime)
    current_rows = triplicitydirections.current_chain(chrt, options, now, max_level=max_level, base_sign=base_sign)
    current_ids_all = [str(row.get("id")) for row in current_rows]
    expanded_ids: set[str] = set()

    for row_id in current_ids_all[:-1]:
        expanded_ids.add(row_id)

    for row_id in requested_expanded_ids:
        if triplicitydirections.row_for_id(chrt, options, row_id, max_level=max_level, base_sign=base_sign) is None:
            continue
        expanded_ids.add(row_id)
        expanded_ids.update(triplicitydirections.ancestor_ids(row_id))

    rows_data = triplicitydirections.materialized_periods(
        chrt,
        options,
        max_level=max_level,
        eager_level=_TRIPLICITY_EAGER_LEVEL,
        expanded_ids=expanded_ids,
        base_sign=base_sign,
    )
    valid_requested_expanded_ids = [
        row_id for row_id in requested_expanded_ids
        if triplicitydirections.row_for_id(chrt, options, row_id, max_level=max_level, base_sign=base_sign) is not None
    ]
    total_rows = triplicitydirections.total_row_count(max_level=max_level)
    columns = [
        {**_column("planet", _txt("Ruler", "Ruler"), align="center", kind="glyph"), "widthFactor": 2},
        {**_column("start", _txt("Start", "Start"), align="center"), "widthFactor": 5},
        {**_column("age", _txt("Age", "Age"), align="right"), "widthFactor": 2},
        {**_column("length", _txt("Length", "Length"), align="right"), "widthFactor": 3},
        {**_column("triplicity", _txt("Triplicity", "Triplicity"), align="left"), "widthFactor": 4},
    ]
    rows: list[Row] = []
    current_ids: list[str] = []

    for source_row in rows_data:
        row_id = str(source_row.get("id") or "trip:%d" % len(rows))
        parent_id = source_row.get("parent_id")
        parent_id = str(parent_id) if parent_id else None
        is_current = row_id in current_ids_all
        if is_current:
            current_ids.append(row_id)
        planet_id = int(source_row.get("planet", astrology.SE_SUN))
        planet_color = _planet_color(planet_id, chrt, options) or "#888888"
        meta = _period_meta(
            source_row,
            row_id=row_id,
            parent_id=parent_id,
            current=is_current,
            has_children=int(source_row.get("level", 1)) < max_level,
            extra={
                "planet": planet_id,
                "colorHex": planet_color,
                "colorRole": _planet_color_role(planet_id, chrt, options, planet_color),
                "triplicityGroup": int(source_row.get("group", 0)),
                "triplicityGroupLabel": str(source_row.get("group_label") or ""),
                "parentPlanet": source_row.get("parent_planet"),
                "parentSign": source_row.get("parent_sign"),
                "eventDatetime": _date_iso(source_row.get("start")),
            },
        )
        rows.append(_row(
            row_id,
            [
                _planet_cell(planet_id, chrt, options),
                _text(dateformat.date_text(source_row["start"].year, source_row["start"].month, source_row["start"].day, options), align="center"),
                _text(_period_age_text(chrt, source_row.get("start")), align="right"),
                _text(triplicitydirections.fmt_length(source_row), align="right"),
                _text(str(source_row.get("group_label") or ""), align="left"),
            ],
            meta=meta,
        ))
        if is_current:
            rows[-1]["current"] = True

    base_group = triplicitydirections.group_for_sign(base_sign)
    signs = _signs(options)
    payload = _base_payload(
        "triplicity_directions",
        chrt,
        options,
        columns,
        rows or _empty(),
        title=_txt("TriplicityDirections", "Triplicity Directions"),
        source=source,
        notes=[
            _txt("TripStartSignNote", "Start sign: %s; %s triplicity.") % (
                triplicitydirections.sign_label(base_sign),
                triplicitydirections.group_label(base_group),
            ),
            _txt("TripRuleNote", "Rule: 30-year main spans; each child level is one third of its parent and uses the triplicity lords of the natal element occupied by the parent lord."),
        ],
    )
    payload["capabilities"] = {
        **payload.get("capabilities", {}),
        "sorting": False,
        "copy": True,
        "export": ["tsv", "json"],
        "timeLord": True,
        "timeLordSystem": "triplicity_directions",
        "tree": True,
        "currentRow": bool(current_ids),
        "currentRowIds": current_ids,
        "initialExpandedRowIds": sorted(expanded_ids),
        "bindings": {
            "extended_depth": extended_depth,
            "start_sign": int(base_sign),
            "drill_row_id": drill_row_id if triplicitydirections.row_for_id(chrt, options, drill_row_id or "", max_level=max_level, base_sign=base_sign) else None,
            "expanded_row_ids": valid_requested_expanded_ids,
        },
        "bindingOptions": {
            "sign": [
                {
                    "value": index,
                    "label": triplicitydirections.sign_label(index),
                    "glyph": signs[index % len(signs)] if signs else "",
                }
                for index in range(12)
            ],
        },
        "triplicityDirections": {
            "baseSign": int(base_sign),
            "baseSignGlyph": signs[int(base_sign) % len(signs)] if signs else "",
            "baseSignName": triplicitydirections.sign_label(base_sign),
            "baseGroup": int(base_group),
            "baseGroupLabel": triplicitydirections.group_label(base_group),
            "sectLabel": _txt("Diurnal", "Diurnal") if triplicitydirections.is_diurnal(chrt) else _txt("Nocturnal", "Nocturnal"),
            "schemeLabel": triplicitydirections.triplicity_scheme_label(options),
            "maxLevel": max_level,
            "defaultMaxLevel": triplicitydirections.MAX_LEVEL,
            "extendedMaxLevel": triplicitydirections.EXTENDED_MAX_LEVEL,
            "extendedDepth": extended_depth,
            "eagerLevel": _TRIPLICITY_EAGER_LEVEL,
            "rowCount": len(rows),
            "totalRowCount": total_rows,
        },
        "rowActions": [
            {"id": "open_containing_solar_revolution", "deferred": False},
            {"id": "open_transit_for_date", "deferred": False},
            {"id": "open_chart_for_date", "deferred": False},
        ],
    }
    payload["deferrals"] = [
        "New research feature; no wx parity source exists. The daemon owns the timing rule and the React pane renders the generic time-lord table payload.",
    ]
    return payload


# Port of zodiacalreleasingwnd._MONTH_ABBR (zodiacalreleasingwnd.py:55-56).
_ZR_MONTH_ABBR = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _zr_period_label(row: dict[str, Any]) -> str:
    """Exact start date for the row's period."""
    start = row.get("start")
    return dateformat.date_text(int(start.year), int(start.month), int(start.day), chart_snapshot_service.options)


def _zr_hex(rgb: Any) -> str:
    try:
        return "#%02x%02x%02x" % (int(rgb[0]), int(rgb[1]), int(rgb[2]))
    except Exception:
        return "#888888"


def _zr_arabic_part_releaser_options(chrt) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    for item in zodiacalreleasing.iter_arabic_part_releasers(chrt):
        try:
            token = str(item.get("token") or "")
            name = str(item.get("name") or "")
            if not token or not name:
                continue
            options.append({"value": token, "label": name})
        except Exception:
            continue
    return options


def _zr_releaser_label(label_token: str, releaser: str = "") -> str:
    """Port of ZRWnd._format_releaser_label (zodiacalreleasingwnd.py:409-417)."""
    if label_token == "fortune":
        return _txt("ZRReleaserFortune", "Fortune")
    if label_token == "spirit_shifted":
        return _txt("ZRReleaserSpiritShifted", "Spirit (shifted →)")
    if label_token == "sign":
        return _txt("ZRReleaserManual", "Manual sign…")
    if label_token == "arabic_part":
        name = zodiacalreleasing.arabic_part_name_from_releaser(releaser)
        return name or _txt("ArabicParts", "Arabic Parts")
    return _txt("ZRReleaserSpirit", "Spirit (Daimon)")


def _zr_degree_text(chrt, releaser: str, resolved_sign: int) -> str:
    """Port of ZRWnd._format_releaser_subtext degree math
    (zodiacalreleasingwnd.py:419-431). Uses the pre-shift releaser longitude,
    exactly as wx does."""
    lon = zodiacalreleasing.releaser_lon(chrt, releaser)
    if lon is None:
        return ""
    deg_in_sign = float(lon) - (int(resolved_sign) % 12) * 30.0
    d = int(deg_in_sign)
    m = int(round((deg_in_sign - d) * 60.0))
    if m == 60:
        d += 1
        m = 0
    return "%d°%02d'" % (d, m)


def _zodiacal_releasing(chrt, options, binding: dict[str, Any] | None = None, *, current_datetime: Any = None) -> dict[str, Any]:
    source = "morin.py:16033-16072,17129-17162,17682-17698,4119-4147; zodiacalreleasing.py:1-305; zodiacalreleasingframe.py:12-53; zodiacalreleasingwnd.py:55-75,80-967; commonwnd.py:63-85"
    if getattr(getattr(chrt, "time", None), "bc", False):
        return _unavailable(
            "zodiacal_releasing",
            chrt,
            title=_txt("ZodiacalReleasing", "Zodiacal Releasing"),
            source=source,
            reason=_txt("NotAvailable", "Not available for BC charts."),
        )
    binding = dict(binding or {})
    releaser = str(binding.get("releaser") or getattr(options, "zr_releaser", zodiacalreleasing.RELEASER_SPIRIT))
    arabic_part_releaser_options = _zr_arabic_part_releaser_options(chrt)
    arabic_part_releaser_tokens = {str(option.get("value") or "") for option in arabic_part_releaser_options}
    if releaser not in zodiacalreleasing.VALID_RELEASERS and releaser not in arabic_part_releaser_tokens:
        releaser = zodiacalreleasing.RELEASER_SPIRIT
    apply_spirit_shift = bool(binding.get("apply_spirit_shift", getattr(options, "zr_apply_spirit_shift", True)))
    try:
        start_sign = int(binding.get("start_sign", getattr(options, "zr_start_sign", 0))) % 12
    except Exception:
        start_sign = 0
    resolved_sign, label_token = zodiacalreleasing.resolve_releaser_sign(
        chrt,
        options,
        releaser,
        apply_spirit_shift=apply_spirit_shift,
        manual_sign=start_sign,
    )
    peak_sign = zodiacalreleasing.resolve_peak_sign(chrt)
    if peak_sign is None:
        peak_sign = resolved_sign
    # Drill selection: the in-frame ZRWnd identifies the open drill panel by
    # its L2 row's start datetime (get_state/apply_state,
    # zodiacalreleasingwnd.py:249-292). The web side keeps the same on-demand
    # key, but allows multiple inline L2 branches in one retained side panel.
    drill_l2_start = binding.get("drill_l2_start")
    raw_expanded_l2_starts = binding.get("expanded_l2_starts")
    expanded_l2_start_values: list[str] = []
    if isinstance(raw_expanded_l2_starts, str):
        raw_expanded_l2_starts = [raw_expanded_l2_starts]
    if isinstance(raw_expanded_l2_starts, (list, tuple)):
        for item in raw_expanded_l2_starts:
            if isinstance(item, str) and item:
                expanded_l2_start_values.append(item)
    if isinstance(drill_l2_start, str) and drill_l2_start:
        expanded_l2_start_values.append(drill_l2_start)
    requested_l2_dts = {
        dt for dt in (_parse_datetime(item) for item in expanded_l2_start_values)
        if dt is not None
    }
    now = _parse_datetime(current_datetime)
    # Anchor at MIDNIGHT of the birth date — ZRWnd._chart_dt
    # (zodiacalreleasingwnd.py:373-376) drops the time-of-day.
    t = chrt.time
    start_dt = datetime.datetime(int(t.origyear), int(t.origmonth), int(t.origday), 0, 0, 0)
    main_rows = zodiacalreleasing.build_main(
        start_dt,
        resolved_sign,
        releaser_sign=resolved_sign,
        years_horizon=150,
        peak_sign=peak_sign,
    )
    signs = _signs(options)
    zr_sign_names = zodiacalreleasing.sign_names()  # localized, resolved at serve time
    sign_options = [
        {"value": index, "label": zr_sign_names[index], "glyph": signs[index] if index < len(signs) else ""}
        for index in range(12)
    ]
    columns = [
        {**_column("sign", _txt("Signs", "Sign"), align="center", kind="glyph"), "widthFactor": 2},
        {**_column("start", _txt("Start", "Start"), align="center"), "widthFactor": 5},
        {**_column("age", _txt("Age", "Age"), align="right"), "widthFactor": 2},
        {**_column("length", _txt("Length", "Length"), align="right"), "widthFactor": 3},
        {**_column("ruler", _txt("Ruler", "Ruler"), align="center", kind="glyph"), "widthFactor": 2},
        {**_column("flags", ""), "widthFactor": 3},
    ]
    rows: list[Row] = []
    current_ids: list[str] = []
    expanded_ids: set[str] = set()
    current_l1_id: str | None = None
    current_l2_id: str | None = None

    def append_zr_row(row_id: str, source_row: dict[str, Any], parent_id: str | None, *, has_children: bool) -> None:
        sign_idx = int(source_row.get("sign", 0)) % 12
        ruler = int(source_row.get("ruler", astrology.SE_SUN))
        parent_sign = source_row.get("parent_sign")
        is_current = _row_contains(source_row, now)
        ruler_cell = _planet_cell(ruler, chrt, options)
        # Flags column — current rows are already highlighted; only exceptional
        # states need text/glyph markers.
        flags: list[str] = []
        if is_current:
            current_ids.append(row_id)
            if parent_id:
                expanded_ids.add(parent_id)
        if source_row.get("is_lob"):
            flags.append(_txt("ZRLoB", "LB"))
        if source_row.get("is_peak"):
            flags.append("*")
        if source_row.get("is_culmination"):
            flags.append(_txt("ZRCulmination", "Culm"))
        if source_row.get("is_completion"):
            flags.append(_txt("ZRCompletion", "Comp"))
        rows.append(_row(
            row_id,
            [
                _sign_cell(options, sign_idx),
                _text(_zr_period_label(source_row), align="center"),
                _text(_period_age_text(chrt, source_row.get("start")), align="right"),
                _text(zodiacalreleasing.fmt_length(source_row), align="right"),
                ruler_cell,
                _text("·".join(flags)),
            ],
            meta=_period_meta(
                source_row,
                row_id=row_id,
                parent_id=parent_id,
                current=is_current,
                has_children=has_children,
                extra={
                    "sign": sign_idx,
                    "ruler": ruler,
                    "isPeak": bool(source_row.get("is_peak")),
                    "peakKind": source_row.get("peak_kind"),
                    "peakReferenceSign": source_row.get("peak_sign"),
                    "isCulmination": bool(source_row.get("is_culmination")),
                    "isCompletion": bool(source_row.get("is_completion")),
                    "isLob": bool(source_row.get("is_lob")),
                    # Chain identity for the left ribbon + the repeats-parent
                    # sign/ruler hiding (zodiacalreleasingwnd.py:617-686).
                    "parentSign": (int(parent_sign) % 12) if parent_sign is not None else None,
                    "repeatsParent": bool(parent_sign is not None and sign_idx == int(parent_sign) % 12),
                },
            ),
        ))
        if is_current:
            rows[-1]["current"] = True

    l1_index = -1
    l2_index = -1
    active_l1_id: str | None = None
    drilled_l2_id: str | None = None
    for source_row in main_rows:
        level = int(source_row.get("level", 0))
        if level == 1:
            l1_index += 1
            l2_index = -1
            row_id = f"l1:{l1_index}"
            active_l1_id = row_id
            parent_id = None
            if _row_contains(source_row, now):
                current_l1_id = row_id
        else:
            l2_index += 1
            row_id = f"l1:{l1_index}:l2:{l2_index}"
            parent_id = active_l1_id
            if _row_contains(source_row, now):
                current_l2_id = row_id
        is_current_l2 = level == 2 and _row_contains(source_row, now)
        should_materialize_drill = (
            level == 2
            and source_row.get("start") is not None
            and (source_row.get("start") in requested_l2_dts or is_current_l2)
        )
        append_zr_row(row_id, source_row, parent_id, has_children=(level == 1 or level == 2))
        if should_materialize_drill:
            if drilled_l2_id is None:
                drilled_l2_id = row_id
            expanded_ids.add(row_id)
            l3_rows, l4_rows = zodiacalreleasing.build_drill(source_row, releaser_sign=resolved_sign, peak_sign=peak_sign)
            l4_index = 0
            for l3_index, l3 in enumerate(l3_rows):
                l3_id = f"{row_id}:l3:{l3_index}"
                l3_l4_count = sum(
                    1 for l4 in l4_rows[l4_index:]
                    if l4["start"] >= l3["start"] and l4["end"] <= l3["end"]
                )
                append_zr_row(l3_id, l3, row_id, has_children=l3_l4_count > 0)
                if _row_contains(l3, now):
                    expanded_ids.add(row_id)
                    expanded_ids.add(l3_id)
                while l4_index < len(l4_rows) and l4_rows[l4_index]["start"] >= l3["start"] and l4_rows[l4_index]["end"] <= l3["end"]:
                    l4 = l4_rows[l4_index]
                    append_zr_row(f"{l3_id}:l4:{l4_index}", l4, l3_id, has_children=False)
                    l4_index += 1

    if current_l1_id:
        expanded_ids.add(current_l1_id)
    if current_l2_id:
        expanded_ids.add(current_l2_id)
    requested_l2_start_labels = sorted({
        item.isoformat() for item in requested_l2_dts
    })

    payload = _base_payload(
        "zodiacal_releasing",
        chrt,
        options,
        columns,
        rows or _empty(),
        title=_txt("ZodiacalReleasing", "Zodiacal Releasing"),
        source=source,
        notes=[
            _txt("ZRReleaserNote", "Releaser: %s; resolved sign: %s.") % (label_token, zr_sign_names[int(resolved_sign) % 12]),
            "Spirit/Fortune same-sign shift: %s." % ("on" if apply_spirit_shift else "off"),
        ],
    )
    payload["capabilities"] = {
        **payload.get("capabilities", {}),
        "sorting": False,
        "timeLord": True,
        "timeLordSystem": "zodiacal_releasing",
        "tree": True,
        "currentRow": bool(current_ids),
        "currentRowIds": current_ids,
        "initialExpandedRowIds": sorted(expanded_ids),
        "bindings": {
            "releaser": releaser,
            "apply_spirit_shift": apply_spirit_shift,
            "start_sign": start_sign,
            "resolved_sign": int(resolved_sign) % 12,
            "peak_sign": int(peak_sign) % 12,
            "label_token": label_token,
            "drill_l2_start": drill_l2_start if isinstance(drill_l2_start, str) else None,
            "expanded_l2_starts": requested_l2_start_labels,
            "drilled_row_id": drilled_l2_id,
        },
        "bindingOptions": {
            "releaser": [
                {"value": zodiacalreleasing.RELEASER_SPIRIT, "label": _txt("ZRReleaserSpirit", "Spirit (Daimon)")},
                {"value": zodiacalreleasing.RELEASER_FORTUNE, "label": _txt("ZRReleaserFortune", "Fortune")},
                *arabic_part_releaser_options,
                {"value": zodiacalreleasing.RELEASER_SIGN, "label": _txt("ZRReleaserManual", "Manual sign")},
            ],
            "sign": sign_options,
        },
        # Releaser header model — the in-frame ZRWnd header line
        # "Releaser: <label> | in: <glyph> <sign name> <deg>" plus the
        # element/planet colours the wx rows use
        # (zodiacalreleasingwnd.py:39-52,409-431,518-566).
        "zr": {
            "releaser": releaser,
            "labelToken": label_token,
            "releaserHeading": _txt("ZRReleaser", "Releaser"),
            "releaserLabel": _zr_releaser_label(label_token, releaser),
            "inLabel": _txt("ZRInSign", "in"),
            "signIndex": int(resolved_sign) % 12,
            "signGlyph": signs[int(resolved_sign) % 12] if int(resolved_sign) % 12 < len(signs) else "",
            "signName": zr_sign_names[int(resolved_sign) % 12],
            "peakReferenceSign": int(peak_sign) % 12,
            "peakReferenceName": zr_sign_names[int(peak_sign) % 12],
            "signNames": [str(name) for name in zr_sign_names],
            "degreeText": _zr_degree_text(chrt, releaser, resolved_sign),
            "shiftLabel": _txt("ZRApplySpiritShift", "Apply Spirit↔Fortune shift"),
            # Per-sign element colours (common.get_sign_color force_element,
            # zodiacalreleasingwnd.py:47-52) and per-planet clrindividual
            # colours (zodiacalreleasingwnd.py:39-44).
            "signColors": [
                _zr_hex(common.get_sign_color(options, i, force_element=True)) for i in range(12)
            ],
            "signColorRoles": [
                sign_color_role(
                    options,
                    i,
                    force_element=True,
                    resolved_color=_zr_hex(common.get_sign_color(options, i, force_element=True)),
                )
                for i in range(12)
            ],
            "planetColors": [
                _planet_color(pid, chrt, options) or "#888888"
                for pid in range(7)
            ],
            "planetColorRoles": [
                _planet_color_role(
                    pid,
                    chrt,
                    options,
                    _planet_color(pid, chrt, options) or "#888888",
                )
                for pid in range(7)
            ],
        },
        "rowActions": [
            {"id": "open_containing_solar_revolution", "deferred": False},
            {"id": "open_transit_for_date", "deferred": False},
            {"id": "open_chart_for_date", "deferred": False},
        ],
    }
    payload["deferrals"] = [
        "Rendered bitmap/PDF export remains deferred from commonwnd.py:102/163 and ZRWnd.pdf_export_spec (zodiacalreleasingwnd.py:433-494); the web surface exports daemon row payloads as TSV/JSON.",
    ]
    return payload


def _profection_event_datetime(year: int, month: int, day: int, time_value: float) -> datetime.datetime:
    h, mi, s = util.decToDeg(float(time_value))
    return datetime.datetime(int(year), int(month), int(day), int(h), int(mi), int(s))


def _profection_wallclock_age_offset(radix, now: datetime.datetime | None) -> int:
    if now is None:
        return 0
    try:
        birth_year = int(getattr(radix.time, "origyear", getattr(radix.time, "year", 0)))
        birth_month = int(getattr(radix.time, "origmonth", getattr(radix.time, "month", 1)))
        birth_day = int(getattr(radix.time, "origday", getattr(radix.time, "day", 1)))
    except Exception:
        return 0
    if birth_month == 2 and birth_day == 29:
        birth_day = 28
    age = int(now.year) - birth_year
    if (int(now.month), int(now.day)) < (birth_month, birth_day):
        age -= 1
    age = max(0, min(144, age))
    return age - (age % 12)


def _build_profection_charts(radix, options, *, age_offset: int = 0, proftype: int = chart.Chart.YEAR) -> list[tuple[Any, int, int, int, float]]:
    source = "morin.py:17012-17033; profectiontablestepperdlg.py:80-125"
    base_year = int(getattr(radix.time, "year", getattr(radix.time, "origyear", 0)))
    base_month = int(getattr(radix.time, "month", getattr(radix.time, "origmonth", 1)))
    base_day = int(getattr(radix.time, "day", getattr(radix.time, "origday", 1)))
    base_time = float(getattr(radix.time, "time", 0.0))
    if base_month == 2 and base_day == 29:
        base_day -= 1
    pcharts = []
    for cyc in range(12):
        row_age = int(age_offset) + cyc
        row_year = base_year + row_age
        if getattr(options, "zodprof", True):
            prof = profections.Profections(radix, base_year, base_month, base_day, base_time, row_age)
            pchart = _new_chart(
                radix.name,
                radix.male,
                radix.time,
                radix.place,
                chart.Chart.PROFECTION,
                "",
                options,
                False,
                proftype,
            )
            pchart.calcProfPos(prof)
        else:
            if (
                not getattr(options, "usezodprojsprof", False)
                and (row_year == radix.time.year or (row_year - radix.time.year) % 12 == 0)
                and base_month == radix.time.month
                and base_day == radix.time.day
            ):
                pchart = radix
            else:
                # wx in-frame parity: morin._build_profections_table_rows
                # (morin.py:17024) anchors at the BASE year and advances by
                # whole solar years (cnt), unlike the popup stepper's
                # calendar-year variant (profectiontablestepperdlg.py:111) —
                # the two diverge by ~0.04 deg of fictitious longitude.
                prof = munprofections.MunProfections(radix, base_year, base_month, base_day, base_time, row_age)
                proflondeg, proflonmin, proflonsec = util.decToDeg(prof.lonZ)
                profplace = chart.Place(
                    mtexts.txts["Profections"],
                    proflondeg,
                    proflonmin,
                    proflonsec,
                    prof.east,
                    radix.place.deglat,
                    radix.place.minlat,
                    radix.place.seclat,
                    radix.place.north,
                    radix.place.altitude,
                )
                pchart = _new_chart(
                    radix.name,
                    radix.male,
                    radix.time,
                    profplace,
                    chart.Chart.PROFECTION,
                    "",
                    options,
                    False,
                    proftype,
                    getattr(options, "usezodprojsprof", False),
                )
                pchartpls = _new_chart(
                    radix.name,
                    radix.male,
                    radix.time,
                    radix.place,
                    chart.Chart.PROFECTION,
                    "",
                    options,
                    False,
                    proftype,
                    getattr(options, "usezodprojsprof", False),
                )
                pchart.apply_mundane_profection(pchartpls, radix.place.lat, radix.obl[0])
        pcharts.append((pchart, row_year, base_month, base_day, base_time))
    if not pcharts:
        raise ValueError(f"no profection charts built from {source}")
    return pcharts


def _profection_hour_lord_cell(reference_chart, options, row_age: int) -> Cell:
    try:
        base_hl = int(reference_chart.time.ph.planetaryhour)
        chaldean = (6, 5, 4, 0, 3, 2, 1)
        pos_in_ch = chaldean.index(base_hl)
        pid = chaldean[(pos_in_ch + (int(row_age) % 7)) % 7]
        cell = _glyph(common.common.Planets[pid])
        # wx hour-lord glyph colour (profectionswnd.py:594-606; the monthly
        # window's second/winning block profectionsmonwnd.py:378-392):
        # useplanetcolors -> clrindividual[pid], else the dignity palette keyed
        # by the reference chart's dignity.
        color = None
        if getattr(options, "useplanetcolors", False):
            palette = list(getattr(options, "clrindividual", []) or [])
            if pid < len(palette):
                color = _rgb_hex(palette[pid])
        else:
            dignity_palette = (
                getattr(options, "clrdomicil", None),
                getattr(options, "clrexal", None),
                getattr(options, "clrperegrin", None),
                getattr(options, "clrcasus", None),
                getattr(options, "clrexil", None),
            )
            try:
                color = _rgb_hex(dignity_palette[reference_chart.dignity(pid)])
            except Exception:
                color = _rgb_hex(getattr(options, "clrperegrin", None))
        cell["planet"] = pid
        _set_semantic_color(cell, color, _planet_color_role(pid, reference_chart, options, color))
        return cell
    except Exception:
        return _text("-")


def _profection_column(column: dict[str, Any], index: int, reference_chart, options) -> dict:
    kind = str(column.get("kind") or "")
    label = str(column.get("label") or "")
    column_id = kind or f"col{index}"
    if kind == profectiontable.KIND_BODY:
        column_id = f"body:{column.get('body_id', index)}"
    if kind in (profectiontable.KIND_BODY, profectiontable.KIND_FORTUNE, profectiontable.KIND_HOURLORD):
        col_kind = "glyph"
    else:
        col_kind = "text"
    col = _column(column_id, label, align="center", kind=col_kind)
    # Header font: Morinus for body glyph headers (is_body_column,
    # profectionswnd.py:383-395) and the Fortune glyph char (the wx PDF
    # exporter classifies KIND_FORTUNE labels as symbols,
    # profectionswnd.py:519-520; on-screen wx drew the raw char with the text
    # font — a defect we do not reproduce). Hour Lord's header is plain text.
    col["headerGlyph"] = kind in (profectiontable.KIND_BODY, profectiontable.KIND_FORTUNE)
    # wx column widths: Age = CELL_WIDTH (3*FONT_SIZE), everything else
    # BIG_CELL_WIDTH (7*FONT_SIZE) — profectiontable.get_column_width
    # (profectiontable.py:84-87, profectionswnd.py:131-137).
    col["widthFactor"] = int(profectiontable.get_column_width(column, 3, 7))
    if kind == profectiontable.KIND_BODY:
        # Body header colour brain — profectiontable.get_body_header_color
        # (profectiontable.py:106-124), called with bw=False; the daemon ships
        # hex so React never resolves palettes.
        hex_color = _rgb_hex(
            profectiontable.get_body_header_color(
                reference_chart, options, column.get("body_id"), False, None
            )
        )
        if hex_color:
            col["colorHex"] = hex_color
        role = _planet_color_role(column.get("body_id", index), reference_chart, options, hex_color)
        if role:
            col["colorRole"] = role
    return col


def _profection_row_cells(
    *,
    pchart_tuple: tuple[Any, int, int, int, float],
    columns: list[dict[str, Any]],
    reference_chart,
    options,
    row_age: int,
    date_override: tuple[int, int, int] | None = None,
    monthly_index: int | None = None,
) -> list[Cell]:
    pchart, year, month, day, _time = pchart_tuple
    cells: list[Cell] = []
    for column in columns:
        kind = column.get("kind")
        if kind == profectiontable.KIND_AGE:
            # Monthly rows leave the Age column blank — wx draws a single age
            # label for the whole monthly window and skips KIND_AGE per row
            # (profectionsmonwnd.py:150-152,355); the tree nesting under the
            # annual row supersedes the single label.
            if monthly_index is None:
                cells.append(_text(str(row_age), align="center"))
            else:
                cells.append(_text("", align="center"))
        elif kind == profectiontable.KIND_DATE:
            if date_override is not None:
                y, m, d = date_override
            else:
                y, m, d = year, month, day
            # wx-verbatim date text: unpadded year, zero-filled month/day,
            # trailing dot (profectionswnd.py:576, profectionsmonwnd.py:352).
            cells.append(_text("%s.%s.%s." % (str(int(y)), str(int(m)).zfill(2), str(int(d)).zfill(2)), align="center"))
        elif kind == profectiontable.KIND_HOURLORD:
            hour_lord_age = row_age + int(monthly_index or 0)
            cells.append(_profection_hour_lord_cell(reference_chart, options, hour_lord_age))
        else:
            cells.append(_profection_lon_cell(profectiontable.get_column_lon(pchart, column), reference_chart, options))
    return cells


def _date_tuple_to_datetime(value: tuple[int, int, int], time_value: float = 0.0) -> datetime.datetime:
    h, mi, s = util.decToDeg(float(time_value))
    return datetime.datetime(int(value[0]), int(value[1]), int(value[2]), int(h), int(mi), int(s))


def _profections_table(chrt, options, binding: dict[str, Any] | None = None, *, current_datetime: Any = None) -> dict[str, Any]:
    source = "morin.py:16991-17033,17501-17530,4151-4178; profectionswnd.py:28-345,559-681; profectionsmonwnd.py:1-341; profectionsmonthly.py:1-49; profectiontable.py:1-108; profectiontablestepperdlg.py:1-125"
    if getattr(getattr(chrt, "time", None), "bc", False):
        return _unavailable(
            "profections_table",
            chrt,
            title=_txt("Profections", "Profections"),
            source=source,
            reason=_txt("NotAvailable", "Not available for BC charts."),
        )

    binding = dict(binding or {})
    mainsigs = bool(binding.get("mainsigs", True))
    monthly_steps12 = bool(binding.get("monthly_steps12", True))
    now = _parse_datetime(current_datetime)
    if "age_offset" in binding:
        try:
            age_offset = int(binding.get("age_offset", 0))
        except Exception:
            age_offset = 0
        age_offset = max(0, min(144, age_offset - (age_offset % 12)))
    else:
        age_offset = _profection_wallclock_age_offset(chrt, now)
    pcharts = _build_profection_charts(chrt, options, age_offset=age_offset, proftype=chart.Chart.YEAR)
    source_columns = profectiontable.build_columns(pcharts[0][0], options, mainsigs)
    columns = [
        _profection_column(column, index, pcharts[0][0], options)
        for index, column in enumerate(source_columns)
    ]
    rows: list[Row] = []
    current_ids: list[str] = []
    expanded_ids: set[str] = set()

    def append_row(row: Row, *, current: bool) -> None:
        rows.append(row)
        if current:
            rows[-1]["current"] = True
            current_ids.append(str(row["id"]))

    annual_dates = [_profection_event_datetime(y, m, d, t) for _p, y, m, d, t in pcharts]
    for annual_index, pchart_tuple in enumerate(pcharts):
        _pchart, year, month, day, time_value = pchart_tuple
        row_age = age_offset + annual_index
        row_id = f"annual:{annual_index}"
        period_start = annual_dates[annual_index]
        if annual_index + 1 < len(annual_dates):
            period_end = annual_dates[annual_index + 1]
        else:
            period_end = _profection_event_datetime(year + 1, month, day, time_value)
        annual_current = bool(now and period_start <= now < period_end)
        append_row(
            _row(
                row_id,
                _profection_row_cells(
                    pchart_tuple=pchart_tuple,
                    columns=source_columns,
                    reference_chart=pcharts[0][0],
                    options=options,
                    row_age=row_age,
                ),
                meta={
                    "level": 1,
                    "parentId": None,
                    "hasChildren": True,
                    "periodStart": _date_iso(period_start),
                    "periodEndExclusive": _date_iso(period_end),
                    "eventDate": _date_iso(period_start),
                    "rowActions": ["open_containing_solar_revolution", "open_transit_for_date", "open_chart_for_date"],
                    "annualIndex": annual_index,
                    "age": row_age,
                },
            ),
            current=annual_current,
        )
        monthly = profectionsmonthly.ProfectionsMonthly(pcharts, monthly_steps12, annual_index)
        monthly_dates = [tuple(int(v) for v in date_tuple[:3]) for date_tuple in monthly.dates]
        agestart = agecont = row_age % 12
        for month_index, date_tuple in enumerate(monthly_dates):
            if month_index < len(pcharts):
                monthly_pchart = pcharts[int(agecont)]
            else:
                monthly_pchart = pcharts[int(agestart)]
            month_start = _date_tuple_to_datetime(date_tuple, time_value)
            if month_index + 1 < len(monthly_dates):
                month_end = _date_tuple_to_datetime(monthly_dates[month_index + 1], time_value)
            else:
                month_end = period_end
            month_current = bool(now and month_start <= now < month_end)
            if month_current:
                expanded_ids.add(row_id)
            month_id = f"{row_id}:month:{month_index}"
            append_row(
                _row(
                    month_id,
                    _profection_row_cells(
                        pchart_tuple=monthly_pchart,
                        columns=source_columns,
                        reference_chart=pcharts[0][0],
                        options=options,
                        row_age=row_age,
                        date_override=date_tuple,
                        monthly_index=month_index,
                    ),
                    meta={
                        "level": 2,
                        "parentId": row_id,
                        "hasChildren": False,
                        "periodStart": _date_iso(month_start),
                        "periodEndExclusive": _date_iso(month_end),
                        "eventDate": _date_iso(month_start),
                        "rowActions": ["open_containing_solar_revolution", "open_transit_for_date", "open_chart_for_date"],
                        "annualIndex": annual_index,
                        "monthIndex": month_index,
                        "age": row_age,
                    },
                ),
                current=month_current,
            )
            agecont += 1
            if agecont > 11:
                agecont = 0

    mode_label = _txt("ZodiacalAnnualProfection", "Zodiacal annual profection") if getattr(options, "zodprof", True) else _txt("PlacidianAnnualProfection", "Placidian annual profection")
    payload = _base_payload(
        "profections_table",
        chrt,
        options,
        columns,
        rows or _empty(),
        title=_txt("Profections", "Profections"),
        source=source,
        notes=[
            _txt("ProfModeNote", "Mode: %s%s.") % (mode_label, "" if getattr(options, "zodprof", True) else _txt("ProfUseZodProjsNote", "; use zodiacal projections=%s") % bool(getattr(options, "usezodprojsprof", False))),
            _txt("ProfDisplayNote", "Display: %s; monthly steps: %s; age offset: %d.") % (
                _txt("ProfsMainSignificatorsOnly", "Main significators only") if mainsigs else _txt("ProfsAll", "All"),
                "12" if monthly_steps12 else "13",
                age_offset,
            ),
        ],
    )
    payload["capabilities"] = {
        **payload.get("capabilities", {}),
        "sorting": False,
        "timeLord": True,
        "timeLordSystem": "profections_table",
        "tree": True,
        "currentRow": bool(current_ids),
        "currentRowIds": current_ids,
        "initialExpandedRowIds": sorted(expanded_ids),
        "bindings": {
            "mainsigs": mainsigs,
            "monthly_steps12": monthly_steps12,
            "age_offset": age_offset,
        },
        "bindingOptions": {
            "mainsigs": [
                {"value": True, "label": _txt("ProfsMainSignificatorsOnly", "Main significators only")},
                {"value": False, "label": _txt("ProfsAll", "All")},
            ],
            "monthlySteps": [
                {"value": True, "label": _txt("Steps12", "12 steps")},
                {"value": False, "label": _txt("Steps13", "13 steps")},
            ],
        },
        # Header model for the dedicated pane — the wx Profections context
        # submenu (Zodiacal/Placidian radio + UseZodProjs check,
        # profectionswnd.py:48-60,146-169). These are PERSISTENT options
        # (options.zodprof / options.usezodprojsprof via saveProfections,
        # profectionswnd.py:256-270); the pane writes them through the
        # canonical options path (options_service._apply_profections).
        "profections": {
            "zodprof": bool(getattr(options, "zodprof", True)),
            "useZodProjs": bool(getattr(options, "usezodprojsprof", False)),
            "zodLabel": _txt("ZodiacalAnnualProfection", "Zodiacal annual profection"),
            "munLabel": _txt("PlacidianAnnualProfection", "Placidian annual profection"),
            "useZodProjsLabel": _txt("UseZodProjs", "Use zodiacal projections"),
            "displayLabel": _txt("DisplayGroup", "Display"),
            "monthlyLabel": _txt("MonthlyProfections", "Monthly Profections"),
            "modeLabel": mode_label,
        },
        "rowActions": [
            {"id": "open_containing_solar_revolution", "deferred": False},
            {"id": "open_transit_for_date", "deferred": False},
            {"id": "open_chart_for_date", "deferred": False},
        ],
    }
    payload["deferrals"] = [
        "Rendered bitmap/PDF export remains deferred from commonwnd.py:102/163 and the pdf_export_spec twins (profectionswnd.py:485-552, profectionsmonwnd.py:192-245); the web surface exports daemon row payloads as TSV/JSON.",
    ]
    return payload


def _unavailable(table_id: str, chrt, *, title: str, source: str, reason: str) -> dict[str, Any]:
    return {
        "tableId": table_id,
        "title": title,
        "sourceName": getattr(chrt, "name", "") or "Radix",
        "columns": [_column("message", _txt("Message", "Message"))],
        "rows": _empty(reason),
        "notes": [reason],
        "capabilities": {
            "sorting": True,
            "copy": True,
            "export": ["tsv", "json"],
            "currentRow": False,
            "rowActions": [],
        },
        "deferrals": [reason],
        "source": source,
        "cellEncoding": "text-glyph-runs",
        "unavailable": True,
    }


def _dodecatemorion_lon_cell(value: float, chrt, options) -> Cell:
    # Dodecatemorion longitude (positionswnd.py:147-151 _dodecatemoria_lon):
    # base = sign-floor(lon); pos_in_sign*12 mapped back. Rendered like any
    # longitude cell (degree + sign glyph). Ayanamsha is applied inside
    # _lon_cell which is fed the dodecatemorion longitude here.
    try:
        lon = util.normalize(float(value))
        base = int(lon / chart.Chart.SIGN_DEG) * chart.Chart.SIGN_DEG
        pos_in_sign = lon % chart.Chart.SIGN_DEG
        return _lon_cell(util.normalize(base + pos_in_sign * 12.0), chrt, options)
    except Exception:
        return _text("-")


def _positions(chrt, options) -> dict[str, Any]:
    speculum = 1 if getattr(options, "primarydir", None) == primdirs.PrimDirs.REGIOMONTAN else 0
    selected = list(getattr(options, "speculums", [[True, True, True, True], [True, True, True, True]])[speculum])
    if not (True in selected or getattr(options, "speculumdodecat", [False, False])[speculum]):
        return _unavailable("positions", chrt, title="Positions", source="morin.py:15867-15878; positionswnd.py:20-78", reason=_txt("SelectColumn", "Select column"))
    # Optional Dodecatemorion column, gated on options.speculumdodecat[speculum]
    # (positionswnd.py:285,304); when shown it sits directly after Longitude
    # (positionswnd.py:303-310). The daemon always emits Longitude, so the
    # column always follows Longitude (no leading-position branch needed).
    show_dodec = bool(getattr(options, "speculumdodecat", [False, False])[speculum])
    cols = [
        _column("body", _txt("Bodies", "Body"), align="center", kind="glyph"),
        _column("lon", _txt("Longitude", "Longitude"), align="center", kind="glyph"),
    ]
    if show_dodec:
        cols.append(_column("dodec", _txt("Dodecatemorion", "Dodecatemorion"), align="center", kind="glyph"))
    cols += [
        _column("lat", _txt("Latitude", "Latitude"), align="center"),
        _column("ra", _txt("Rectascension", "RA"), align="center"),
        _column("decl", _txt("Declination", "Declination"), align="center"),
        _column("house", _txt("House", "House"), align="right"),
    ]

    def _angle_row(row_id: str, label: str, lon: float, lat: float, ra: float, decl: float) -> Row:
        cells: list[Cell] = [_text(label), _lon_cell(lon, chrt, options)]
        if show_dodec:
            cells.append(_dodecatemorion_lon_cell(lon, chrt, options))
        cells += [
            _text(_dms(lat, signed=True)),
            _text(_ra(ra, options)),
            _text(_dms(decl, signed=True)),
            _text(""),
        ]
        return _row(row_id, cells)

    # Section 1: Asc / MC (positionswnd.py:316-326).
    ascmc_rows: list[Row] = []
    try:
        asc = chrt.houses.ascmc2[houses.Houses.ASC]
        mc = chrt.houses.ascmc2[houses.Houses.MC]
        ascmc_rows.append(_angle_row("asc", _txt("Asc", "Asc"), asc[houses.Houses.LON], asc[houses.Houses.LAT], asc[houses.Houses.RA], asc[houses.Houses.DECL]))
        ascmc_rows.append(_angle_row("mc", _txt("MC", "MC"), mc[houses.Houses.LON], mc[houses.Houses.LAT], mc[houses.Houses.RA], mc[houses.Houses.DECL]))
    except Exception:
        pass

    # Section 2: planets (positionswnd.py:328-352) + Lot of Fortune
    # (positionswnd.py:368-398). Per-planet body glyph colors mirror the wx
    # useplanetcolors path applied throughout the speculum windows.
    planet_rows: list[Row] = []
    for pid in _body_ids(chrt, options):
        body = chrt.get_planet_body(pid) if hasattr(chrt, "get_planet_body") else None
        if body is None:
            continue
        house = ""
        try:
            house = str(chrt.houses.getHousePos(body.data[planets.Planet.LONG], 0.0) + 1)
        except Exception:
            pass
        cells: list[Cell] = [_planet_cell(pid, chrt, options), _lon_cell(body.data[planets.Planet.LONG], chrt, options)]
        if show_dodec:
            cells.append(_dodecatemorion_lon_cell(body.data[planets.Planet.LONG], chrt, options))
        cells += [
            _text(_dms(body.data[planets.Planet.LAT], signed=True)),
            _text(_ra(body.dataEqu[planets.Planet.RAEQU], options)),
            _text(_dms(body.dataEqu[planets.Planet.DECLEQU], signed=True)),
            _text(house, align="right"),
        ]
        planet_rows.append(_row(f"planet:{pid}", cells))
    try:
        fort = chrt.fortune.fortune
        fcells: list[Cell] = [_glyph(common.common.fortune), _lon_cell(fort[0], chrt, options)]
        if show_dodec:
            fcells.append(_dodecatemorion_lon_cell(fort[0], chrt, options))
        fcells += [
            _text(_dms(fort[1], signed=True)),
            _text(_ra(fort[2], options)),
            _text(_dms(fort[3], signed=True)),
            _text(""),
        ]
        planet_rows.append(_row("fortune", fcells))
    except Exception:
        pass

    # Section 3: houses 1/2/3/10/11/12 (positionswnd.py:400-418), gated on
    # not intables or (intables and houses). lat/house columns stay blank as wx.
    house_rows: list[Row] = []
    if not getattr(options, "intables", False) or getattr(options, "houses", True):
        hidx = (1, 2, 3, 10, 11, 12)
        for h in hidx:
            try:
                lon = chrt.houses.cusps[h]
                cusp2 = chrt.houses.cusps2[h - 1]
                ra_val, decl_val = cusp2[0], cusp2[1]
                label = common.common.Housenames2[h - 1]
            except Exception:
                continue
            cells = [_text(label), _lon_cell(lon, chrt, options)]
            if show_dodec:
                cells.append(_dodecatemorion_lon_cell(lon, chrt, options))
            cells += [
                _text(_dms(0.0, signed=True)),
                _text(_ra(ra_val, options)),
                _text(_dms(decl_val, signed=True)),
                _text(""),
            ]
            house_rows.append(_row(f"house:{h}", cells))

    sections = [{"id": "ascmc", "columns": cols, "rows": ascmc_rows},
                {"id": "planets", "columns": cols, "rows": planet_rows}]
    if house_rows:
        sections.append({"id": "houses", "columns": cols, "rows": house_rows})
    flat_rows = ascmc_rows + planet_rows + house_rows
    payload = _base_payload("positions", chrt, options, cols, flat_rows or _empty(), title="Positions", source="morin.py:15823-15896; positionswnd.py:261-418")
    payload["sections"] = sections
    payload["capabilities"] = {**payload.get("capabilities", {}), "sections": True, "sorting": False}
    return payload


def _aspects(chrt, options) -> dict[str, Any]:
    # Structured port of the wx AspectsWnd matrix (aspectswnd.py:194-469):
    # the payload carries the layout semantics — Asc/MC × planets section,
    # planet × planet upper triangle with diagonal glyph headers, and the
    # optional houses × planets section — instead of a flattened pair list.
    source = "morin.py:16752-16766; aspectswnd.py:75-119,194-469,709-741,852-871"
    arsigndiff = (0, -1, -1, 2, -1, 3, 4, -1, -1, -1, 6)  # aspectswnd.py:73
    hidx = (1, 2, 3, 10, 11, 12)  # aspectswnd.py:74

    # AspectsWnd._get_table_body_ids (aspectswnd.py:111-119): visible aspect
    # bodies incl. Chiron, plus the Vertex pseudo-body behind its option pair.
    body_ids = _body_ids(chrt, options, aspects=True)
    if getattr(options, "showvertex", False) and getattr(options, "showaspectstovertex", False):
        body_ids = [*body_ids, common.CHART_OBJECT_VERTEX]

    def planet_lon(pid: int) -> float | None:
        # AspectsWnd._planet_lon (aspectswnd.py:122-128)
        if pid == common.CHART_OBJECT_VERTEX:
            return chrt.houses.ascmc[houses.Houses.VERTEX]
        body = chrt.get_planet_body(pid)
        if body is None:
            return None
        return body.data[planets.Planet.LONG]

    def point_aspect(pid: int, lon: float) -> Any:
        # AspectsWnd._get_point_aspect (aspectswnd.py:131-144)
        body = chrt.get_planet_body(pid)
        if body is None:
            return chart.Asp()
        idx = chrt.get_planet_orb_index(pid)
        return chrt._build_dynamic_aspect(
            body.data[planets.Planet.LONG],
            lon,
            body.data[planets.Planet.SPLON],
            0.0,
            list(options.orbis[idx]),
            node_only_conjunction=pid in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE),
        )

    def planetary_aspect(a: int, b: int) -> Any:
        # AspectsWnd._get_planetary_matrix_aspect (aspectswnd.py:147-154)
        if a == common.CHART_OBJECT_VERTEX and b == common.CHART_OBJECT_VERTEX:
            return chart.Asp()
        if a == common.CHART_OBJECT_VERTEX:
            return point_aspect(b, planet_lon(a))
        if b == common.CHART_OBJECT_VERTEX:
            return point_aspect(a, planet_lon(b))
        return chrt.get_planetary_aspect(a, b)

    def ascmc_aspect(angle_idx: int, pid: int) -> Any:
        # AspectsWnd._get_ascmc_matrix_aspect (aspectswnd.py:157-166)
        if pid != common.CHART_OBJECT_VERTEX:
            return chrt.get_ascmc_aspect(angle_idx, pid)
        return chrt._build_dynamic_aspect(
            chrt.houses.ascmc[angle_idx],
            chrt.houses.ascmc[houses.Houses.VERTEX],
            0.0,
            0.0,
            list(options.orbisAscMC),
        )

    def house_aspect(house_idx: int, pid: int) -> Any:
        # AspectsWnd._get_house_matrix_aspect (aspectswnd.py:169-187)
        if pid != common.CHART_OBJECT_VERTEX:
            return chrt.get_house_aspect(house_idx, pid)
        orb_by_aspect = []
        for a in range(chart.Chart.ASPECT_NUM):
            orb = options.orbisH[a]
            if house_idx in (0, 3) and chrt.houses.hsys in ('P', 'K', 'O', 'R', 'C', 'E', 'T', 'B'):
                orb = options.orbisAscMC[a]
            orb_by_aspect.append(orb)
        vertex_lon = chrt.houses.ascmc[houses.Houses.VERTEX]
        return chrt._build_dynamic_aspect(vertex_lon, chrt.houses.cusps[hidx[house_idx]], 0.0, 0.0, orb_by_aspect)

    def show_asp(typ: int, lon1: float | None, lon2: float | None, p: int = -1, p2: int = -1) -> bool:
        # AspectsWnd.isShowAsp (aspectswnd.py:709-741)
        if typ == chart.Chart.NONE or (getattr(options, "intables", False) and not options.aspect[typ]):
            return False
        val = True
        if getattr(options, "intables", False):
            if getattr(options, "traditionalaspects", False):
                if typ not in (chart.Chart.CONJUNCTIO, chart.Chart.SEXTIL, chart.Chart.QUADRAT, chart.Chart.TRIGON, chart.Chart.OPPOSITIO):
                    val = False
                elif lon1 is None or lon2 is None:
                    val = False
                else:
                    lona1, lona2 = lon1, lon2
                    signdiff = math.fabs(int(lona1 / chart.Chart.SIGN_DEG) - int(lona2 / chart.Chart.SIGN_DEG))
                    if signdiff > chart.Chart.SIGN_NUM / 2:
                        signdiff = chart.Chart.SIGN_NUM - signdiff
                    if arsigndiff[typ] != signdiff:
                        val = False
            nodes = (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE)
            if not getattr(options, "aspectstonodes", True) and (p in nodes or p2 in nodes):
                val = False
        return val

    def is_exact(exact: bool, lon1: float | None, lon2: float | None) -> bool:
        # AspectsWnd.isExact (aspectswnd.py:852-871): traditional-aspects mode
        # marks same in-sign degree as exact, otherwise the engine flag rules.
        if getattr(options, "intables", False) and getattr(options, "traditionalaspects", False):
            if lon1 is None or lon2 is None:
                return False
            lona1, lona2 = lon1, lon2
            return int(lona1 % chart.Chart.SIGN_DEG) == int(lona2 % chart.Chart.SIGN_DEG)
        return bool(exact)

    def orb_text(asp: Any, shown: bool) -> str:
        # wx truncates the separation to one decimal without rounding
        # (aspectswnd.py:299-303): shown cells print asp.aspdif (orb), hidden
        # cells print asp.dif (raw angular separation).
        txt = str(asp.aspdif if shown else asp.dif)
        whole, dot, frac = txt.partition('.')
        return whole + dot + (frac[0] if frac else "")

    def matrix_cell(asp: Any, lon1: float | None, lon2: float | None, p: int = -1, p2: int = -1) -> dict[str, Any]:
        shown = show_asp(asp.typ, lon1, lon2, p, p2)
        cell: dict[str, Any] = {"orb": orb_text(asp, shown)}
        if shown:
            glyph, glyph_role = common.common.aspect_glyph(asp.typ)
            cell["aspectType"] = int(asp.typ)
            cell["glyph"] = glyph
            cell["glyphFont"] = glyph_role
            color = _rgb_hex(options.clraspect[asp.typ])
            _set_semantic_color(
                cell,
                color,
                aspect_color_role(options, asp.typ, resolved_color=color),
            )
            if asp.appl:
                cell["applying"] = True  # corner triangle, aspectswnd.py:280-281
            if is_exact(asp.exact, lon1, lon2):
                cell["exact"] = True  # inset border rectangle, aspectswnd.py:277-278
        # Parallel/contraparallel marks ('X'/'Y' Morinus glyphs) render even
        # when no zodiacal aspect is shown (aspectswnd.py:289-297).
        if asp.parallel == chart.Chart.PARALLEL:
            cell["parallel"] = "parallel"
        elif asp.parallel == chart.Chart.CONTRAPARALLEL:
            cell["parallel"] = "contraparallel"
        return cell

    planet_axis = []
    for pid in body_ids:
        entry: dict[str, Any] = {
            "id": f"planet:{pid}",
            "planet": int(pid),
            "glyph": _planet_glyph(pid),
            "label": common.common.get_planet_name(pid),
        }
        color = _planet_color(pid, chrt, options)
        _set_semantic_color(entry, color, _planet_color_role(pid, chrt, options, color))
        planet_axis.append(entry)

    cells: dict[str, dict[str, Any]] = {}

    # Asc/MC × planets section: header glyphs '0'/'1' in the Morinus face
    # (aspectswnd.py:256-263), one column per angle (aspectswnd.py:265-320).
    ascmc_axis = [
        {"id": "ascmc:0", "glyph": _angle_glyph("asc"), "glyphFont": "morinus", "label": _txt("Asc", "Asc")},
        {"id": "ascmc:1", "glyph": _angle_glyph("mc"), "glyphFont": "morinus", "label": _txt("MC", "MC")},
    ]
    ar_ascmc = (chrt.houses.ascmc[houses.Houses.ASC], chrt.houses.ascmc[houses.Houses.MC])
    for angle_idx in range(len(ascmc_axis)):
        for pid in body_ids:
            try:
                asp = ascmc_aspect(angle_idx, pid)
            except Exception:
                continue
            cells[f"ascmc:{angle_idx}:planet:{pid}"] = matrix_cell(asp, ar_ascmc[angle_idx], planet_lon(pid), pid)

    # Planets × planets upper triangle, jj > ii (aspectswnd.py:333-391), with
    # the diagonal planet glyphs as column headers (aspectswnd.py:322-331).
    flat_rows: list[Row] = []
    for ii, a in enumerate(body_ids):
        for jj, b in enumerate(body_ids):
            if jj <= ii:
                continue
            try:
                asp = planetary_aspect(a, b)
            except Exception:
                continue
            lon1, lon2 = planet_lon(a), planet_lon(b)
            cells[f"planet:{a}:planet:{b}"] = matrix_cell(asp, lon1, lon2, a, b)
            if show_asp(asp.typ, lon1, lon2, a, b):
                glyph, _glyph_role = common.common.aspect_glyph(asp.typ)
                aspect_cell = _glyph(glyph)
                color = _rgb_hex(options.clraspect[asp.typ])
                _set_semantic_color(
                    aspect_cell,
                    color,
                    aspect_color_role(options, asp.typ, resolved_color=color),
                )
                flat_rows.append(_row(f"{a}:{b}", [
                    _planet_cell(a, chrt, options),
                    _planet_cell(b, chrt, options),
                    aspect_cell,
                    _text(_dms(getattr(asp, "aspdif", 0.0), signed=False), align="right"),
                    _text("A" if getattr(asp, "appl", False) else "S", align="center"),
                ]))

    # Optional houses × planets section: gated exactly like wx
    # (aspectswnd.py:394) and labeled from Housenames2 (aspectswnd.py:398-399).
    house_axis: list[dict[str, Any]] = []
    if not getattr(options, "intables", False) or getattr(options, "houses", True):
        for col, cusp_idx in enumerate(hidx):
            house_axis.append({"id": f"house:{col}", "label": str(common.common.Housenames2[cusp_idx - 1])})
        house_count = len(getattr(chrt, "aspmatrixH", []) or hidx)
        for col in range(min(house_count, len(hidx))):
            for pid in body_ids:
                try:
                    asp = house_aspect(col, pid)
                except Exception:
                    continue
                cells[f"house:{col}:planet:{pid}"] = matrix_cell(asp, chrt.houses.cusps[hidx[col]], planet_lon(pid), pid)

    # Flat pair-list columns/rows stay populated for TSV/copy/JSON consumers.
    cols = [_column("a", "A", align="center", kind="glyph"), _column("b", "B", align="center", kind="glyph"), _column("aspect", _txt("Aspect", "Aspect"), align="center", kind="glyph"), _column("orb", _txt("Orb", "Orb"), align="right"), _column("phase", _txt("Phase", "Phase"), align="center")]
    payload = _base_payload("aspects", chrt, options, cols, flat_rows or _empty(_txt("NoAspects", "No aspects")), title="Aspects", source=source)
    payload["matrix"] = {
        "planets": planet_axis,
        "ascmc": ascmc_axis,
        "houses": house_axis,
        "cells": cells,
    }
    payload["capabilities"] = {**payload.get("capabilities", {}), "matrix": True, "sorting": False}
    return payload


def _rise_set(chrt, options) -> dict[str, Any]:
    cols = [_column("body", _txt("Bodies", "Body"), align="center", kind="glyph"), _column("rise", _txt("Rise", "Rise"), align="center"), _column("mc", _txt("MC", "MC"), align="center"), _column("set", _txt("Set", "Set"), align="center"), _column("ic", _txt("IC", "IC"), align="center")]
    rows = []
    for idx, times in enumerate(getattr(getattr(chrt, "riseset", None), "times", []) or []):
        glyph = _planet_glyph(idx) if idx < astrology.SE_MEAN_NODE + 1 else str(idx + 1)
        rows.append(_row(f"body:{idx}", [_glyph(glyph), *[_text(_time_from_day_fraction(v), align="center") for v in list(times)[:4]]]))
    return _base_payload("rise_set", chrt, options, cols, rows or _empty(), title="Rise/Set", source="morin.py:16768-16769; risesetwnd.py:15-255")


def _planetary_hours(chrt, options) -> dict[str, Any]:
    cols = [_column("idx", "#", align="right"), _column("ruler", _txt("Planet", "Planet"), align="center", kind="glyph"), _column("start", _txt("Start", "Start"), align="center"), _column("end", _txt("End", "End"), align="center")]
    ph = getattr(getattr(chrt, "time", None), "ph", None)
    rows = []
    if ph is not None:
        start = float(getattr(ph, "risetime", getattr(chrt.time, "jd", 0.0)))
        hrlen = float(getattr(ph, "hrlen", 1.0 / 24.0))
        weekday = int(getattr(ph, "weekday", 0))
        rulers = getattr(ph, "PHs", ())
        seq = rulers[weekday] if 0 <= weekday < len(rulers) else []
        for idx, ruler in enumerate(list(seq)[:24]):
            s = start + (idx * hrlen)
            e = s + hrlen
            rows.append(_row(f"hour:{idx+1}", [_text(idx + 1, align="right"), _glyph(_planet_glyph(int(ruler))), _text(_time_from_day_fraction(s % 1.0), align="center"), _text(_time_from_day_fraction(e % 1.0), align="center")]))
    notes = []
    try:
        notes.append("%s: %02d:%02d:%02d" % (_txt("TimeofBirth", "Time of Birth"), chrt.time.hour, chrt.time.minute, chrt.time.second))
    except Exception:
        pass
    return _base_payload("planetary_hours", chrt, options, cols, rows or _empty(), title=_txt("PlanetaryHours", "Planetary Hours"), source="morin.py:16770-16771; hourswnd.py:15-332", notes=notes)


# Arabic-parts formula tokens (port of arabicpartswnd.py:24-48 module constants;
# arabicpartswnd imports wx so the maps are mirrored inline per the daemon
# wx-free rule). Abbreviation -> swiss planet id, used to color formula glyphs.
_ARABIC_ABBR_TO_PID = {
    "SU": astrology.SE_SUN, "MO": astrology.SE_MOON, "ME": astrology.SE_MERCURY,
    "VE": astrology.SE_VENUS, "MA": astrology.SE_MARS, "JU": astrology.SE_JUPITER,
    "SA": astrology.SE_SATURN, "UR": astrology.SE_URANUS, "NE": astrology.SE_NEPTUNE,
    "PL": astrology.SE_PLUTO,
}
_ARABIC_SIGN_INDEX = {
    "Ari": 0, "Tau": 1, "Gem": 2, "Can": 3, "Leo": 4, "Vir": 5,
    "Lib": 6, "Sco": 7, "Sag": 8, "Cap": 9, "Aqu": 10, "Pis": 11,
}
_ARABIC_SIGN_ABBR = ("Ari", "Tau", "Gem", "Can", "Leo", "Vir",
                     "Lib", "Sco", "Sag", "Cap", "Aqu", "Pis")


def _arabic_token_runs(code: int, ref_index: int, ref_triplet, chrt, options) -> list[dict[str, Any]]:
    # Port of arabicpartswnd._draw_formula_for_part token resolution
    # (arabicpartswnd.py:266-318) + _token_segments_for_formula
    # (arabicpartswnd.py:125-189), emitting text/glyph runs instead of pixel
    # draws. Planets/Asc-MC become Morinus glyphs; DE: -> degree + sign glyph;
    # RE: -> "#n"; lord ('!') keeps the trailing marker.
    try:
        lbl = mtexts.partstxts[code]
    except Exception:
        rev = getattr(mtexts, "_conv_rev_cache", None)
        if not isinstance(rev, dict):
            try:
                rev = {v: k for (k, v) in mtexts.conv.items()}
            except Exception:
                rev = {}
            mtexts._conv_rev_cache = rev
        lbl = rev.get(code, "?")
    want_lord = False
    if lbl[-1:] in ("!", "G", "g"):
        want_lord = True
        lbl = lbl[:-1]

    runs: list[dict[str, Any]] = []
    try:
        ref_val = (ref_triplet[0], ref_triplet[1], ref_triplet[2])[ref_index]
    except Exception:
        ref_val = 0

    if lbl == mtexts.txts.get("DE", "DE"):
        absdeg = int(ref_val) % 360
        si = absdeg // 30
        dg = absdeg % 30
        runs.append({"text": "%d°" % dg, "glyph": False})
        runs.append({"text": _signs(options)[si], "glyph": True})
    elif lbl == mtexts.txts.get("RE", "RE"):
        runs.append({"text": "#%d" % (int(ref_val) + 1), "glyph": False})
    else:
        # Resolve localized label back to canonical abbreviation
        # (arabicpartswnd._resolve_token_to_canonical:224-237).
        canon = lbl
        for k in ("SU", "MO", "ME", "VE", "MA", "JU", "SA", "UR", "NE", "PL",
                  "AC", "DC", "MC", "IC"):
            if lbl == mtexts.txts.get(k, k):
                canon = k
                break
        cu = canon.upper()
        if cu in _ARABIC_ABBR_TO_PID:
            pid = _ARABIC_ABBR_TO_PID[cu]
            runs.append(_planet_run(pid, chrt, options))
        elif cu in ("AC", "DC", "MC", "IC"):
            runs.append({"text": mtexts.txts.get(cu, cu), "glyph": False})
        else:
            runs.append({"text": str(canon), "glyph": False})
    if want_lord:
        runs.append({"text": "!", "glyph": False})
    return runs


def _arabic_formula_cell(src, chrt, options) -> Cell:
    # Formula column: A + B - C with the active (diurnal/gendered-swapped)
    # triplet (arabicpartswnd.py:311-320 via
    # arabicparts.ArabicParts.get_active_formula_triplet).
    import arabicparts
    try:
        above = chrt.planets.planets[astrology.SE_SUN].abovehorizon
    except Exception:
        above = True
    try:
        male = bool(chrt.male)
    except Exception:
        male = True
    try:
        (f1, f2, f3), refs = arabicparts.ArabicParts.get_active_formula_triplet(src, above, male)
    except Exception:
        return _text("")
    runs = (_arabic_token_runs(f1, 0, refs, chrt, options)
            + [{"text": " + ", "glyph": False}]
            + _arabic_token_runs(f2, 1, refs, chrt, options)
            + [{"text": " - ", "glyph": False}]
            + _arabic_token_runs(f3, 2, refs, chrt, options))
    return {"runs": runs, "align": "center"}


def _arabic_lof_formula_cell(chrt, options) -> Cell:
    # Lot of Fortune formula AC + (MO/SU) - (SU/MO) with diurnal swap
    # (arabicpartswnd.py:786-798). lotoffortune selects the planet order.
    typ = getattr(options, "lotoffortune", 2)
    try:
        above = chrt.planets.planets[astrology.SE_SUN].abovehorizon
    except Exception:
        above = True
    if typ == chart.Chart.LFMOONSUN:
        b_pid, c_pid = astrology.SE_MOON, astrology.SE_SUN
    elif typ == chart.Chart.LFDMOONSUN:
        b_pid, c_pid = astrology.SE_MOON, astrology.SE_SUN
        if not above:
            b_pid, c_pid = c_pid, b_pid
    else:
        b_pid, c_pid = astrology.SE_SUN, astrology.SE_MOON
        if not above:
            b_pid, c_pid = c_pid, b_pid
    runs = [
        {"text": mtexts.txts.get("AC", "AC"), "glyph": False},
        {"text": " + ", "glyph": False},
        _planet_run(b_pid, chrt, options),
        {"text": " - ", "glyph": False},
        _planet_run(c_pid, chrt, options),
    ]
    return {"runs": runs, "align": "center"}


def _arabic_decl_cell(lon: float, chrt) -> Cell:
    # Declination from longitude with lat=0 (arabicpartswnd._decl_from_longitude
    # _zero_lat:438-449): delta = asin(sin(eps)*sin(lambda)) using true
    # obliquity (chart.obl[0]).
    try:
        obl = chrt.obl[0] if isinstance(chrt.obl, (list, tuple)) else chrt.obl
        tropical_lon = util.to_tropical_lon(
            float(lon), float(getattr(chrt, "ayanamsha_offset", 0.0) or 0.0)
        )
        lam = math.radians(util.normalize(tropical_lon))
        eps = math.radians(float(obl))
        dec = math.degrees(math.asin(math.sin(eps) * math.sin(lam)))
        return _text(_dms(dec, signed=True), align="center")
    except Exception:
        return _text("-", align="center")


def _arabic_almuten_cell(degwinner, chrt, options) -> Cell:
    # Almuten column: multi-planet colored winner runs + shared "(score)"
    # (arabicpartswnd.drawDegWinner2:524-570). degwinner is [[pid,score],...].
    return _almuten_degwinner_cell(degwinner, chrt, options)


def _arabic_parts(chrt, options) -> dict[str, Any]:
    # 9-column flat layout faithful to arabicpartswnd.py:682-684,1035-1145:
    # #, Name, Formula (glyph runs), Longitude (+sign), Dodecatemorion (+sign),
    # Declination, Almuten (colored winner runs), Diurnal, M/F.
    import arabicparts
    cols = [
        _column("idx", "#", align="right"),
        _column("name", _txt("Name", "Name")),
        _column("formula", _txt("Formula", "Formula"), align="center", kind="glyph"),
        _column("lon", _txt("Longitude", "Longitude"), align="center", kind="glyph"),
        _column("dodec", _txt("Dodecatemorion", "Dodecatemorion"), align="center", kind="glyph"),
        _column("decl", _txt("Declination", "Declination"), align="center"),
        _column("almuten", _txt("Almuten", "Almuten"), align="center", kind="glyph"),
        _column("diurnal", _txt("Diurnal", "Diurnal"), align="center"),
        _column("mf", _txt("MF", "M/F"), align="center"),
    ]
    rows: list[Row] = []
    # Lot of Fortune row (#1): almuten = essentials.degwinner[3] (the LoF
    # significator line, arabicpartswnd.py:836-843).
    try:
        lof_lon = chrt.fortune.fortune[0]
        ess = getattr(getattr(chrt, "almutens", None), "essentials", None)
        lof_degwinner = getattr(ess, "degwinner", None)
        lof_alm = lof_degwinner[3] if lof_degwinner else None
        rows.append(_row("fortune", [
            _text("1", align="right"),
            _runs((common.common.fortune, True), (" " + _txt("LotOfFortune", "Lot of Fortune"), False)),
            _arabic_lof_formula_cell(chrt, options),
            _lon_cell(lof_lon, chrt, options),
            _dodecatemorion_lon_cell(lof_lon, chrt, options),
            _arabic_decl_cell(lof_lon, chrt),
            _arabic_almuten_cell(lof_alm, chrt, options),
            _text(""),
            _text(""),
        ]))
    except Exception:
        pass
    NAME = arabicparts.ArabicParts.NAME
    LONG = arabicparts.ArabicParts.LONG
    DEGWINNER = arabicparts.ArabicParts.DEGWINNER
    for idx, part in enumerate(getattr(getattr(chrt, "parts", None), "parts", []) or []):
        try:
            name = part[NAME]
            lon = part[LONG]
            # Source definition for formula + diurnal/gendered flags
            # (arabicpartswnd.py:1051-1052,1121-1129).
            src = None
            for it in getattr(options, "arabicparts", []) or []:
                if isinstance(it, (list, tuple)) and it[NAME] == name:
                    src = it
                    break
            # Stable # follows the absolute options order (+2; LoF is #1)
            # (arabicpartswnd.py:1047-1057).
            ref_num = idx
            if src is not None:
                try:
                    ref_num = next(i for i, it in enumerate(options.arabicparts)
                                   if isinstance(it, (list, tuple)) and it[NAME] == name)
                except Exception:
                    ref_num = idx
            try:
                degw = part[DEGWINNER]
            except Exception:
                degw = None
            diurnal_txt = ""
            mf_txt = ""
            if src is not None:
                try:
                    if arabicparts.ArabicParts.get_diurnal_flag(src):
                        diurnal_txt = _txt("Diurnal", "Diurnal")
                except Exception:
                    pass
                try:
                    if arabicparts.ArabicParts.is_gendered_item(src):
                        mf_txt = _txt("MF", "M/F")
                except Exception:
                    pass
            rows.append(_row(f"part:{idx}", [
                _text(ref_num + 2, align="right"),
                _text(name),
                _arabic_formula_cell(src, chrt, options) if src is not None else _text(""),
                _lon_cell(lon, chrt, options),
                _dodecatemorion_lon_cell(lon, chrt, options),
                _arabic_decl_cell(lon, chrt),
                _arabic_almuten_cell(degw, chrt, options),
                _text(diurnal_txt, align="center"),
                _text(mf_txt, align="center"),
            ]))
        except Exception:
            continue
    return _base_payload("arabic_parts", chrt, options, cols, rows or _empty(_txt("NoPartsConfigured", "No parts configured")), title="Arabic Parts", source="morin.py:16776-16777; arabicpartswnd.py:682-684,716-761,1035-1145")


def _misc(chrt, options) -> dict[str, Any]:
    # Two independent sections (miscwnd.py:106-194):
    #   1) 5-row label/value pairs: SidTime, OblEcl, JulianDay, Vertex(lon+sign),
    #      EquAsc(lon+sign).
    #   2) Syzygy 3-col block: header (Syzygy/Date/Longitude) + one data row
    #      (New/Full Moon, datetime, lon+sign).
    pair_cols = [_column("field", _txt("Field", "Field")), _column("value", _txt("Value", "Value"), align="center", kind="glyph")]
    pair_rows: list[Row] = []
    try:
        armc = chrt.houses.ascmc[houses.Houses.ARMC]
        d, m, s = util.decToDeg(armc / 15.0)
        pair_rows.append(_row("sidtime", [_text(_txt("SidTime", "Sidereal time")),
                                          _text("%d:%02d:%02d" % (d, m, s), align="center")]))
    except Exception:
        pass
    try:
        obl = chrt.obl[0] if isinstance(chrt.obl, (list, tuple)) else chrt.obl
        pair_rows.append(_row("obl", [_text(_txt("OblEcl", "Obliquity")),
                                      _text(_dms(obl), align="center")]))
    except Exception:
        pass
    try:
        pair_rows.append(_row("jd", [_text(_txt("JulianDay", "Julian day")),
                                     _text(str(chrt.time.jd), align="center")]))
    except Exception:
        pass
    try:
        pair_rows.append(_row("vertex", [_text(_txt("Vertex", "Vertex")),
                                         _lon_cell(chrt.houses.ascmc[houses.Houses.VERTEX], chrt, options)]))
    except Exception:
        pass
    try:
        pair_rows.append(_row("equasc", [_text(_txt("EquAsc", "Equatorial Asc")),
                                         _lon_cell(chrt.houses.ascmc[houses.Houses.EQUASC], chrt, options)]))
    except Exception:
        pass

    syz_cols = [
        _column("syzygy", _txt("Syzygy", "Syzygy")),
        _column("date", _txt("Date2", "Date")),
        _column("lon", _txt("Longitude", "Longitude"), align="center", kind="glyph"),
    ]
    syz_rows: list[Row] = []
    syzygy = getattr(chrt, "syzygy", None)
    if not getattr(getattr(chrt, "time", None), "bc", False) and syzygy is not None:
        try:
            kind = _txt("NewMoon", "New Moon") if syzygy.newmoon else _txt("FullMoon", "Full Moon")
            t = syzygy.time
            hh, mm, ss = util.decToDeg(t.time)
            date_text = dateformat.date_time_text(
                (t.year, t.month, t.day, hh, mm, ss),
                options,
                show_seconds=True,
            )
            syz_rows.append(_row("syz", [_text(kind), _text(date_text), _lon_cell(syzygy.lon, chrt, options)]))
        except Exception:
            pass

    sections = [{"id": "pairs", "columns": pair_cols, "rows": pair_rows}]
    if syz_rows:
        sections.append({"id": "syzygy", "columns": syz_cols, "rows": syz_rows})
    # Flat fallback: pair rows are the canonical 2-col grid; syzygy lives in the
    # section payload (its 3-col shape would not align in a flat 2-col grid).
    payload = _base_payload("misc", chrt, options, pair_cols, pair_rows or _empty(),
                            title=_txt("Miscellaneous", "Miscellaneous"), source="morin.py:16862-16863; miscwnd.py:13-229")
    payload["sections"] = sections
    payload["capabilities"] = {**payload.get("capabilities", {}), "sections": True, "sorting": False}
    return payload


def _midpoints(chrt, options) -> dict[str, Any]:
    # Faithful port of the wx multi-panel layout (midpointswnd.py:44-87
    # geometry, 156-257 draw): one panel per first body (Sun..Pluto), each
    # holding that body's pairs with every later body, progressively one row
    # shorter (artmp/arln partition, midpointswnd.py:188-195). The partition
    # equals grouping mids by p1 in order — midpoints.py:30-74 appends each
    # i-block contiguously with Chiron last — so group rather than re-derive
    # the prefix sums; this also stays aligned when Chiron is absent.
    mids = list(getattr(getattr(chrt, "midpoints", None), "mids", []) or [])
    # Panel header: only the wide longitude cell is labeled; the narrow
    # planet-pair cell has no header text (midpointswnd.py:167-186).
    cols = [
        _column("pair", "", align="center", kind="glyph"),
        _column("lon", _txt("Longitude", "Longitude"), align="center", kind="glyph"),
    ]

    panels: list[tuple[int, list[tuple[int, Any]]]] = []
    for idx, mid in enumerate(mids):
        if not panels or panels[-1][0] != mid.p1:
            panels.append((mid.p1, []))
        panels[-1][1].append((idx, mid))

    intables = getattr(options, "intables", False)
    transcendental = list(getattr(options, "transcendental", []) or [])

    def _trans(idx: int) -> bool:
        return bool(transcendental[idx]) if idx < len(transcendental) else True

    shownodes = getattr(options, "shownodes", True)
    # wx drops one trailing panel per hidden outer/node family
    # (midpointswnd.py:170-178).
    num = len(panels)
    if intables:
        if not _trans(chart.Chart.TRANSURANUS):
            num -= 1
        if not _trans(chart.Chart.TRANSNEPTUNE):
            num -= 1
        if not _trans(chart.Chart.TRANSPLUTO):
            num -= 1
        if not shownodes:
            num -= 1

    def _filtered(p2: int) -> bool:
        # Row filter mirrors midpointswnd.py:200 — second body only.
        if not intables:
            return False
        if p2 == astrology.SE_URANUS and not _trans(chart.Chart.TRANSURANUS):
            return True
        if p2 == astrology.SE_NEPTUNE and not _trans(chart.Chart.TRANSNEPTUNE):
            return True
        if p2 == astrology.SE_PLUTO and not _trans(chart.Chart.TRANSPLUTO):
            return True
        if p2 in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not shownodes:
            return True
        return False

    sections: list[dict[str, Any]] = []
    flat_rows: list[Row] = []
    for p1, entries in panels[:max(0, num)]:
        section_rows: list[Row] = []
        for idx, mid in entries:
            if _filtered(mid.p2):
                continue
            # Pair cell: p1 glyph + ' - ' + p2 glyph, each glyph in its own wx
            # color (midpointswnd.py:202-228); longitude with sign glyph
            # (midpointswnd.py:230-245).
            pair_cell: Cell = {
                "runs": [
                    _planet_run(mid.p1, chrt, options),
                    {"text": " - ", "glyph": False},
                    _planet_run(mid.p2, chrt, options),
                ],
                "align": "center",
            }
            row = _row(f"mid:{idx}", [pair_cell, _lon_cell(mid.m, chrt, options)])
            section_rows.append(row)
            flat_rows.append(row)
        # wx draws the panel header box even when every row is filtered.
        sections.append({"id": f"panel:{p1}", "columns": cols, "rows": section_rows})

    payload = _base_payload(
        "midpoints", chrt, options, cols, flat_rows or _empty(),
        title="Midpoints",
        source="morin.py:16864-16865; midpointswnd.py:44-87,156-257",
    )
    # Channel 4 (sections): flat columns/rows stay populated as the
    # concatenation of sections for TSV/copy/export.
    payload["sections"] = sections
    payload["capabilities"] = {**payload.get("capabilities", {}), "sections": True, "sorting": False}
    return payload


def _speeds(chrt, options) -> dict[str, Any]:
    cols = [_column("body", _txt("Bodies", "Body"), align="center", kind="glyph"), _column("lon", _txt("InLong", "In long."), align="right"), _column("lat", _txt("InLat", "In lat."), align="right"), _column("dist", _txt("InAU", "In AU"), align="right")]
    rows = []
    for pid in _body_ids(chrt, options):
        body = chrt.get_planet_body(pid) if hasattr(chrt, "get_planet_body") else None
        if body is None:
            continue
        rows.append(_row(f"speed:{pid}", [_glyph(_planet_glyph(pid)), _text("%.8f" % body.data[planets.Planet.SPLON], align="right"), _text("%.8f" % body.data[planets.Planet.SPLAT], align="right"), _text("%.8f" % body.data[planets.Planet.SPDIST], align="right")]))
    return _base_payload("speeds", chrt, options, cols, rows or _empty(), title="Speeds", source="morin.py:16866-16867; speedswnd.py:15-180")


def _mundane_positions(chrt, options) -> dict[str, Any]:
    # Two sections (munposwnd.py:144-300):
    #   1) Planet grid: glyph (per-planet color) + House% via swe_house_pos
    #      (munposwnd.drawline:310-341), intables-gated outers/nodes
    #      (munposwnd.py:167).
    #   2) Optional Mundane Fortuna 4-col block (lon+sign / lat / RA / decl),
    #      gated on not intables or (intables and showlof) (munposwnd.py:173,269).
    grid_cols = [
        _column("body", _txt("Bodies", "Body"), align="center", kind="glyph"),
        _column("percent", _txt("HousePercent", "House %"), align="right"),
    ]
    grid_rows: list[Row] = []
    intables = getattr(options, "intables", False)
    transcendental = list(getattr(options, "transcendental", []) or [])
    shownodes = getattr(options, "shownodes", True)
    for i in range(len(common.common.Planets) - 1):
        if intables and (
            (i == astrology.SE_URANUS and not (transcendental[chart.Chart.TRANSURANUS] if chart.Chart.TRANSURANUS < len(transcendental) else True))
            or (i == astrology.SE_NEPTUNE and not (transcendental[chart.Chart.TRANSNEPTUNE] if chart.Chart.TRANSNEPTUNE < len(transcendental) else True))
            or (i == astrology.SE_PLUTO and not (transcendental[chart.Chart.TRANSPLUTO] if chart.Chart.TRANSPLUTO < len(transcendental) else True))
            or (i == astrology.SE_MEAN_NODE and not shownodes)
        ):
            continue
        try:
            ret, _serr = astrology.swe_house_pos(
                chrt.houses.ascmc[1], chrt.place.lat,
                chrt.obl[0] if isinstance(chrt.obl, (list, tuple)) else chrt.obl,
                ord(chrt.houses.hsys),
                chrt.planets.planets[i].data[planets.Planet.LONG],
                chrt.planets.planets[i].data[planets.Planet.LAT])
            pct = "{:.10f}".format(ret)
        except Exception:
            pct = ""
        grid_rows.append(_row(f"mun:{i}", [_planet_cell(i, chrt, options), _text(pct, align="right")]))

    munf_cols = [
        _column("name", "", align="left"),
        _column("lon", _txt("Longitude", "Longitude"), align="center", kind="glyph"),
        _column("lat", _txt("Latitude", "Latitude"), align="center"),
        _column("ra", _txt("Rectascension", "RA"), align="center"),
        _column("decl", _txt("Declination", "Declination"), align="center"),
    ]
    munf_rows: list[Row] = []
    if not intables or getattr(options, "showlof", True):
        try:
            import munfortune
            try:
                abovehor = chrt.planets.planets[astrology.SE_SUN].abovehorizon
            except Exception:
                abovehor = getattr(chrt, "abovehorizonwithorb", getattr(chrt, "abovehorizon", False))
            mf = munfortune.MundaneFortune(
                getattr(options, "lotoffortune", 2),
                chrt.houses.ascmc2,
                chrt.planets,
                chrt.obl[0] if isinstance(chrt.obl, (list, tuple)) else chrt.obl,
                chrt.place.lat,
                abovehor,
            ).mfortune
            munf_rows.append(_row("mlof", [
                _text(_txt("MLoF", "Mundane Fortuna")),
                _lon_cell(mf[0], chrt, options),
                _text(_dms(mf[1], signed=True), align="center"),
                _text(_ra(mf[2], options), align="center"),
                _text(_dms(mf[3], signed=True), align="center"),
            ]))
        except Exception:
            pass

    sections = [{"id": "grid", "columns": grid_cols, "rows": grid_rows}]
    if munf_rows:
        sections.append({"id": "munfortune", "columns": munf_cols, "rows": munf_rows})
    # Flat fallback: the planet grid is the canonical 2-col table; the Mundane
    # Fortuna 5-col block lives in the section payload only.
    payload = _base_payload("mundane_positions", chrt, options, grid_cols, grid_rows or _empty(),
                            title=_txt("MundanePositions", "Mundane Positions"), source="morin.py:16868-16869; munposwnd.py:144-454")
    payload["sections"] = sections
    payload["capabilities"] = {**payload.get("capabilities", {}), "sections": True, "sorting": False}
    return payload


def _antiscia(chrt, options) -> dict[str, Any]:
    cols = [_column("body", _txt("Bodies", "Body"), align="center", kind="glyph"), _column("ant_lon", _txt("Antiscion", "Antiscion"), align="center", kind="glyph"), _column("contra_lon", _txt("Contraantiscion", "Contraantiscion"), align="center", kind="glyph")]
    rows = []
    ant = getattr(getattr(chrt, "antiscia", None), "plantiscia", []) or []
    contra = getattr(getattr(chrt, "antiscia", None), "plcontraant", []) or []
    for idx, item in enumerate(ant):
        pid = idx if idx <= astrology.SE_MEAN_NODE else idx
        contra_item = contra[idx] if idx < len(contra) else None
        rows.append(_row(f"ant:{idx}", [_glyph(_planet_glyph(pid)), _lon_cell(item.lon, chrt, options), _lon_cell(contra_item.lon, chrt, options) if contra_item else _text("-")]))
    return _base_payload("antiscia", chrt, options, cols, rows or _empty(), title="Antiscia", source="morin.py:16870-16871; antisciawnd.py:16-206")


def _zodpars(chrt, options) -> dict[str, Any]:
    cols = [_column("body", _txt("Bodies", "Body"), align="center", kind="glyph"), _column("parallel", _txt("Parallel", "Parallel"), align="center", kind="glyph"), _column("contra", _txt("ContraParallel", "ContraParallel"), align="center", kind="glyph")]
    rows = []
    for idx, pts in enumerate(getattr(getattr(chrt, "zodpars", None), "pars", []) or []):
        p = getattr(pts, "pts", ())
        rows.append(_row(f"zod:{idx}", [_glyph(_planet_glyph(idx)), _lon_cell(p[0][0], chrt, options) if len(p) > 0 else _text("-"), _lon_cell(p[1][0], chrt, options) if len(p) > 1 else _text("-")]))
    return _base_payload("zodpars", chrt, options, cols, rows or _empty(), title=_txt("ZodPars", "Zodiacal Parallels"), source="morin.py:16872-16873; zodparswnd.py:17-214")


# The seven scored bodies in every almuten window are Sun..Saturn
# (range(astrology.SE_SATURN+1)); the dignity-letter matrices and totals never
# include the outer planets or nodes (almutens.py:43,85,262 etc.).
_ALMUTEN_PLANETS = tuple(range(astrology.SE_SUN, astrology.SE_SATURN + 1))


def _almuten_planet_header_column(column_id: str, planet_id: int, chrt, options) -> dict:
    # Planet-glyph column header drawn in the Morinus font with the wx
    # per-planet color (useplanetcolors -> clrindividual[i], else dignity
    # palette[chart.dignity(i)]; almutenchartwnd.py:346-356,
    # almutenzodswnd.py:390-401, almutentopicalswnd.py:148-158).
    col = _column(column_id, _planet_glyph(planet_id), align="center", kind="glyph")
    col["headerGlyph"] = True
    color = _planet_color(planet_id, chrt, options)
    _set_semantic_color(
        col,
        color,
        _planet_color_role(planet_id, chrt, options, color),
        color_key="colorHex",
    )
    return col


def _almuten_dignity_cell(value: Any) -> Cell:
    # Dignity-letter scoretext cell; wx renders an em-dash when empty
    # (almutenchartwnd.py:443, almutenzodswnd.py:408, almutentopicalswnd.py:171).
    text = str(value) if value not in (None, "") else "—"
    return _text(text, align="center")


def _almuten_total_cell(value: Any, *, winner: bool) -> Cell:
    # Shares/Scores totals; the dead-heat-free max winner is drawn in the big
    # bold font (almutenchartwnd.py:449-463,749-754;
    # almutentopicalswnd.py:204-219). emphasis="strong" carries the bold.
    return _text("" if value is None else str(value), align="center",
                 emphasis="strong" if winner else None)


def _almuten_lon_cell(lon: float, chrt, options) -> Cell:
    # Significator longitude with sign glyph (drawLong; ayanamsha-corrected),
    # shared by all three windows. _lon_cell already applies the ayanamsha
    # offset and emits the degree text + sign-glyph run.
    return _lon_cell(lon, chrt, options)


def _almuten_degwinner_cell(winners: Any, chrt, options) -> Cell:
    # Degree-winner cell: up to three tied planets, each glyph in its own wx
    # color, followed by the shared score "(N)" in text color. wx draws
    # "<glyph>(score)" per winner separated by a space, all winners sharing
    # degwinner[..][0][1] as the score (almutenchartwnd.py:467-509,
    # almutenzodswnd.drawDegWinner, almutentopicalswnd.py:224-266).
    try:
        entries = list(winners)
    except Exception:
        entries = []
    if not entries:
        return _text("—", align="center")
    score = None
    try:
        score = entries[0][1]
    except Exception:
        score = None
    runs: list[dict[str, Any]] = []
    for slot in entries:
        try:
            pid = int(slot[0])
        except Exception:
            pid = -1
        if pid == -1:
            break
        if runs:
            runs.append({"text": " ", "glyph": False})
        runs.append(_planet_run(pid, chrt, options))
        runs.append({"text": "(%s)" % ("" if score is None else score), "glyph": False})
    if not runs:
        return _text("—", align="center")
    return {"runs": runs, "align": "center"}


def _almuten_essentials_section(chrt, options) -> dict[str, Any]:
    # Essentials matrix: 5 significator longitude rows (Sun, Moon, Asc, LoF,
    # Syzygy) x 7 planet columns + per-row degree winners, then Shares/Scores
    # totals (almutenchartwnd.py:362-509 left side + 438-463 cells + degwins).
    # The essentials collections order is (Sun, Moon, Asc, LoF, Syz)
    # (almutens.py:35); the wx essential block draws Sun..Moon as glyphs then
    # Asc/LoF/Syzygy as labels (almutenchartwnd.py:362-407).
    ess = getattr(getattr(chrt, "almutens", None), "essentials", None)
    cols = [
        _column("sig", _txt("Essential", "Essential"), align="left", kind="glyph"),
        _column("lon", _txt("Longitude", "Longitude"), align="center", kind="glyph"),
    ]
    for pid in _ALMUTEN_PLANETS:
        cols.append(_almuten_planet_header_column(f"p{pid}", pid, chrt, options))
    cols.append(_column("degwins", _txt("DegreeWins", "Degree Wins"), align="center", kind="glyph"))

    # (collection index in essentials tuple, significator descriptor, longitude)
    fortune_glyph = getattr(common.common, "fortune", "4")
    sig_specs = [
        (0, _planet_cell(astrology.SE_SUN, chrt, options, align="left"),
         chrt.planets.planets[astrology.SE_SUN].data[planets.Planet.LONG]),
        (1, _planet_cell(astrology.SE_MOON, chrt, options, align="left"),
         chrt.planets.planets[astrology.SE_MOON].data[planets.Planet.LONG]),
        (2, _glyph("", text=_txt("Asc", "Asc"), align="left"),
         chrt.houses.ascmc[houses.Houses.ASC]),
        (3, {"glyph": fortune_glyph, "align": "left"},
         chrt.fortune.fortune[fortune.Fortune.LON]),
        (4, _glyph("", text=_txt("Syzygy", "Syzygy"), align="left"),
         chrt.syzygy.lon),
    ]
    fortune_cell = sig_specs[3][1]
    fortune_color = (
        _rgb_hex(getattr(options, "clrindividual", [None] * 12)[11])
        if getattr(options, "useplanetcolors", False)
        else _rgb_hex(getattr(options, "clrperegrin", None))
    )
    _set_semantic_color(
        fortune_cell,
        fortune_color,
        _fortune_color_role(chrt, options, fortune_color),
    )
    degwinners = list(getattr(ess, "degwinner", []) or [])
    rows: list[Row] = []
    for coll_idx, sig_cell, lon in sig_specs:
        cells = [sig_cell, _almuten_lon_cell(lon, chrt, options)]
        for pid in _ALMUTEN_PLANETS:
            try:
                value = ess.essentials[pid][coll_idx][0]
            except Exception:
                value = ""
            cells.append(_almuten_dignity_cell(value))
        dw = degwinners[coll_idx] if coll_idx < len(degwinners) else None
        cells.append(_almuten_degwinner_cell(dw, chrt, options))
        rows.append(_row(f"alm-ess:{coll_idx}", cells))

    shares = list(getattr(ess, "shares", []) or [])
    scores = list(getattr(ess, "scores", []) or [])
    maxshare = list(getattr(ess, "maxshare", [-1, -1, False]) or [-1, -1, False])
    maxscore = list(getattr(ess, "maxscore", [-1, -1, False]) or [-1, -1, False])

    def _totals_row(row_id: str, label: str, values: list, maxinfo: list) -> Row:
        cells = [_text(label, align="left"), _text("—", align="center")]
        win_id = maxinfo[0] if len(maxinfo) > 0 else -1
        dead_heat = bool(maxinfo[2]) if len(maxinfo) > 2 else False
        for pid in _ALMUTEN_PLANETS:
            value = values[pid] if pid < len(values) else None
            cells.append(_almuten_total_cell(value, winner=(win_id != -1 and win_id == pid and not dead_heat)))
        cells.append(_text("—", align="center"))
        return _row(row_id, cells)

    rows.append(_totals_row("alm-ess:shares", _txt("TotalShares1", "Total") + " " + _txt("TotalShares2", "Shares"), shares, maxshare))
    rows.append(_totals_row("alm-ess:scores", _txt("TotalScores1", "Total") + " " + _txt("TotalScores2", "Scores"), scores, maxscore))
    return {"id": "essentials", "title": _txt("Essential", "Essentials"), "columns": cols, "rows": rows}


def _almuten_accidentals_sections(chrt, options) -> list[dict[str, Any]]:
    # Accidentals block: four sub-grids — In Houses (7 planets), In Phases
    # (Mars..Saturn only), Day Ruler (7), Hour Ruler (7)
    # (almutenchartwnd.py:511-684). Each is a 7- or 3-column planet grid with a
    # single value row, rendered as its own panel.
    acc = getattr(getattr(chrt, "almutens", None), "accidentals", None)
    if acc is None:
        return []

    def _grid(section_id: str, title: str, planet_ids, values: list) -> dict[str, Any]:
        cols = [_almuten_planet_header_column(f"{section_id}-p{pid}", pid, chrt, options) for pid in planet_ids]
        cells = []
        for offset, pid in enumerate(planet_ids):
            value = values[offset] if offset < len(values) else None
            cells.append(_text("" if value is None else str(value), align="center"))
        return {"id": section_id, "title": title, "columns": cols, "rows": [_row(f"{section_id}:v", cells)]}

    inhouses = list(getattr(acc, "inhouses", []) or [])
    inphases = list(getattr(acc, "inphases", []) or [])
    dayruler = list(getattr(acc, "dayruler", []) or [])
    hourruler = list(getattr(acc, "hourruler", []) or [])
    phase_ids = tuple(range(astrology.SE_MARS, astrology.SE_SATURN + 1))
    return [
        _grid("acc-houses", _txt("HouseScores1", "House") + " " + _txt("HouseScores2", "Scores"),
              _ALMUTEN_PLANETS, inhouses),
        _grid("acc-phases", _txt("PhaseScores1", "Phase") + " " + _txt("PhaseScores2", "Scores"),
              phase_ids, inphases),
        _grid("acc-day", _txt("DayRulerScores1", "Day Ruler") + " " + _txt("DayRulerScores2", "Scores"),
              _ALMUTEN_PLANETS, dayruler),
        _grid("acc-hour", _txt("HourRulerScores1", "Hour Ruler") + " " + _txt("HourRulerScores2", "Scores"),
              _ALMUTEN_PLANETS, hourruler),
    ]


def _almuten_totals_section(chrt, options) -> dict[str, Any]:
    # Grand totals: 3 score rows (Essential, Accidental, Grand) x 7 planets;
    # the dead-heat-free grand-total winner is bold (almutenchartwnd.py:686-754).
    alm = getattr(chrt, "almutens", None)
    ess_scores = list(getattr(getattr(alm, "essentials", None), "scores", []) or []) if alm else []
    acc_scores = list(getattr(getattr(alm, "accidentals", None), "scores", []) or []) if alm else []
    grand = list(getattr(alm, "scores", []) or []) if alm else []
    maxscore = list(getattr(alm, "maxscore", [-1, -1, False]) or [-1, -1, False]) if alm else [-1, -1, False]
    win_id = maxscore[0] if len(maxscore) > 0 else -1
    dead_heat = bool(maxscore[2]) if len(maxscore) > 2 else False

    cols = [_column("kind", _txt("Total", "Total"), align="left")]
    for pid in _ALMUTEN_PLANETS:
        cols.append(_almuten_planet_header_column(f"tot-p{pid}", pid, chrt, options))

    def _score_row(row_id: str, label: str, values: list, *, winner_check: bool) -> Row:
        cells = [_text(label, align="left")]
        for pid in _ALMUTEN_PLANETS:
            value = values[pid] if pid < len(values) else None
            cells.append(_almuten_total_cell(
                value, winner=(winner_check and win_id != -1 and win_id == pid and not dead_heat)))
        return _row(row_id, cells)

    rows = [
        _score_row("tot:ess", _txt("EssentialScores1", "Essential") + " " + _txt("EssentialScores2", "Scores"), ess_scores, winner_check=False),
        _score_row("tot:acc", _txt("AccidentalScores1", "Accidental") + " " + _txt("AccidentalScores2", "Scores"), acc_scores, winner_check=False),
        _score_row("tot:grand", _txt("GrandScores1", "Grand") + " " + _txt("GrandScores2", "Scores"), grand, winner_check=True),
    ]
    return {"id": "totals", "title": _txt("Total", "Total"), "columns": cols, "rows": rows}


def _almuten_chart(chrt, options) -> dict[str, Any]:
    # Three stacked sections (almutenchartwnd.py:300-757): essentials matrix,
    # the accidentals block (only when options.useaccidental,
    # almutenchartwnd.py:511), and grand totals. Sections channel carries the
    # per-section column headers (planet glyphs); the flat rows stay populated
    # as the concatenation for TSV/copy.
    source = "morin.py:16877-16878; almutenchartwnd.py:300-757; almutens.py:11-249,252-319,646-674"
    if getattr(chrt, "almutens", None) is None:
        return _unavailable("almuten_chart", chrt, title=_txt("AlmutenChart", "Almuten Chart"), source=source,
                            reason=_txt("AlmutensUnavailable", "Almutens unavailable for this chart."))
    sections = [_almuten_essentials_section(chrt, options)]
    if getattr(options, "useaccidental", True):
        sections.extend(_almuten_accidentals_sections(chrt, options))
    sections.append(_almuten_totals_section(chrt, options))

    flat_cols = sections[0]["columns"]
    flat_rows: list[Row] = []
    for section in sections:
        flat_rows.extend(section["rows"])
    payload = _base_payload("almuten_chart", chrt, options, flat_cols, flat_rows or _empty(),
                            title=_txt("AlmutenChart", "Almuten Chart"), source=source)
    payload["sections"] = sections
    payload["capabilities"] = {**payload.get("capabilities", {}), "sections": True, "sorting": False}
    return payload


# Significator rows of the transposed Zodiacal/Points grid in wx draw order
# (almutenzodswnd.py:390-524): 7 planets, LoF, Syzygy, Asc, MC, 12 housecusps.
# Each tuple is (essentials source key, degwinner source key, row index in that
# source, longitude provider). The cell at (significator row, planet column j)
# is the dignity-letter scoretext of planet j against that significator.
def _almuten_zodiacal(chrt, options) -> dict[str, Any]:
    # Transposed planet x significator dignity grid + significator longitude
    # side column + degree-winner ("Almuten") column (almutenzodswnd.py:62-534).
    source = "morin.py:16875-16876; almutenzodswnd.py:18-534; almutens.py:11-249"
    ess = getattr(getattr(chrt, "almutens", None), "essentials", None)
    if ess is None:
        return _unavailable("almuten_zodiacal", chrt, title=_txt("AlmutenPoints", "Almuten Points"), source=source,
                            reason=_txt("AlmutensUnavailable", "Almutens unavailable for this chart."))
    cols = [
        _column("sig", _txt("Bodies", "Body"), align="left", kind="glyph"),
        _column("lon", _txt("Longitude", "Longitude"), align="center", kind="glyph"),
    ]
    for pid in _ALMUTEN_PLANETS:
        cols.append(_almuten_planet_header_column(f"p{pid}", pid, chrt, options))
    cols.append(_column("almuten", _txt("Almuten", "Almuten"), align="center", kind="glyph"))

    fortune_glyph = getattr(common.common, "fortune", "4")
    lof_color = (_rgb_hex(getattr(options, "clrindividual", [None] * 12)[11])
                 if getattr(options, "useplanetcolors", False)
                 else _rgb_hex(getattr(options, "clrperegrin", None)))
    lof_cell: Cell = {"glyph": fortune_glyph, "align": "left"}
    _set_semantic_color(lof_cell, lof_color, _fortune_color_role(chrt, options, lof_color))
    houses_cusps = getattr(chrt.houses, "cusps", [])
    hc_labels = [_txt("HC%d" % n, "HC%d" % n) for n in range(1, houses.Houses.HOUSE_NUM + 1)]

    # value(significator_index, planet_j) — dignity scoretext.
    # For the 7 planet significator rows wx splits Sun/Moon (essentials[j][i])
    # from Mercury..Saturn (essentials2[j][i-2]); LoF/Syzygy/Asc map to
    # essentials[j][3]/[4]/[2]; MC -> essentialsmc[j]; housecusps ->
    # essentialshcs[j][hc] (almutenzodswnd.py:406-430,505-517).
    rows: list[Row] = []

    def _planet_sig_cell(sig_pid: int, j: int) -> Cell:
        try:
            if sig_pid in (astrology.SE_SUN, astrology.SE_MOON):
                value = ess.essentials[j][sig_pid][0]
            else:
                value = ess.essentials2[j][sig_pid - astrology.SE_MERCURY][0]
        except Exception:
            value = ""
        return _almuten_dignity_cell(value)

    # 7 planet significator rows.
    degwinner2 = list(getattr(ess, "degwinner2", []) or [])
    degwinner = list(getattr(ess, "degwinner", []) or [])
    degwinnermc = getattr(ess, "degwinnermc", None)
    degwinnerhcs = list(getattr(ess, "degwinnerhcs", []) or [])
    for sig_pid in _ALMUTEN_PLANETS:
        cells = [
            _planet_cell(sig_pid, chrt, options, align="left"),
            _almuten_lon_cell(chrt.planets.planets[sig_pid].data[planets.Planet.LONG], chrt, options),
        ]
        for j in _ALMUTEN_PLANETS:
            cells.append(_planet_sig_cell(sig_pid, j))
        # Almuten column: degwinner for Sun/Moon (essentials.degwinner index 0/1),
        # degwinner2 for Mercury..Saturn (almutenzodswnd.py:440-447).
        if sig_pid in (astrology.SE_SUN, astrology.SE_MOON):
            dw = degwinner[sig_pid] if sig_pid < len(degwinner) else None
        else:
            dw_idx = sig_pid - astrology.SE_MERCURY
            dw = degwinner2[dw_idx] if dw_idx < len(degwinner2) else None
        cells.append(_almuten_degwinner_cell(dw, chrt, options))
        rows.append(_row(f"almz:p{sig_pid}", cells))

    # LoF / Syzygy / Asc / MC special significator rows. The cell source index
    # into essentials[j] is 3 (LoF), 4 (Syzygy), 2 (Asc); MC uses essentialsmc.
    def _special_row(row_id: str, sig_cell: Cell, lon: float,
                     ess_idx: int | None, mc: bool, dw: Any) -> Row:
        cells = [sig_cell, _almuten_lon_cell(lon, chrt, options)]
        for j in _ALMUTEN_PLANETS:
            try:
                if mc:
                    value = ess.essentialsmc[j][0]
                else:
                    value = ess.essentials[j][ess_idx][0]
            except Exception:
                value = ""
            cells.append(_almuten_dignity_cell(value))
        cells.append(_almuten_degwinner_cell(dw, chrt, options))
        return _row(row_id, cells)

    # degwinner for LoF/Syzygy/Asc are degwinner index 3/4/2; MC -> degwinnermc.
    rows.append(_special_row(
        "almz:lof",
        lof_cell,
        chrt.fortune.fortune[fortune.Fortune.LON], 3, False,
        degwinner[3] if len(degwinner) > 3 else None))
    rows.append(_special_row(
        "almz:syzygy", _glyph("", text=_txt("Syzygy", "Syzygy"), align="left"),
        chrt.syzygy.lon, 4, False,
        degwinner[4] if len(degwinner) > 4 else None))
    rows.append(_special_row(
        "almz:asc", _glyph("", text=_txt("Asc", "Asc"), align="left"),
        chrt.houses.ascmc[houses.Houses.ASC], 2, False,
        degwinner[2] if len(degwinner) > 2 else None))
    rows.append(_special_row(
        "almz:mc", _glyph("", text=_txt("MC", "MC"), align="left"),
        chrt.houses.ascmc[houses.Houses.MC], None, True, degwinnermc))

    # 12 housecusp significator rows.
    for hc in range(houses.Houses.HOUSE_NUM):
        cusp_lon = houses_cusps[hc + 1] if hc + 1 < len(houses_cusps) else 0.0
        cells = [
            _glyph("", text=hc_labels[hc], align="left"),
            _almuten_lon_cell(cusp_lon, chrt, options),
        ]
        for j in _ALMUTEN_PLANETS:
            try:
                value = ess.essentialshcs[j][hc][0]
            except Exception:
                value = ""
            cells.append(_almuten_dignity_cell(value))
        dw = degwinnerhcs[hc] if hc < len(degwinnerhcs) else None
        cells.append(_almuten_degwinner_cell(dw, chrt, options))
        rows.append(_row(f"almz:hc{hc + 1}", cells))

    payload = _base_payload("almuten_zodiacal", chrt, options, cols, rows or _empty(),
                            title=_txt("AlmutenPoints", "Almuten Points"), source=source)
    payload["sections"] = [{"id": "zodiacal", "columns": cols, "rows": rows}]
    payload["capabilities"] = {**payload.get("capabilities", {}), "sections": True, "sorting": False}
    return payload


def _almuten_topical(chrt, options, binding: dict[str, Any] | None = None) -> dict[str, Any]:
    # Per-topic matrix: rows = the topic's significator longitudes, columns =
    # 7 planet dignity-letter scoretexts + degree winners, then Shares/Scores
    # totals (almutentopicalswnd.py:64-484). The topic is chosen by index from
    # almutens.topicals.names (almutentopicalsframe.py:21-27,74-82). When no
    # topicals exist the wx menu shows NoTopicalsCreated (morin.py:17214-17221).
    source = "morin.py:14263,14602,17208-17221; almutentopicalswnd.py:64-484; almutentopicalsframe.py:10-85; almutens.py:322-642"
    topicals = getattr(getattr(chrt, "almutens", None), "topicals", None)
    names = list(getattr(topicals, "names", []) or []) if topicals is not None else []
    if topicals is None or not names:
        return _unavailable("almuten_topical", chrt, title=_txt("AlmutenTopical", "Almuten Topical"), source=source,
                            reason=_txt("NoTopicalsCreated", "No topicals created"))
    binding = dict(binding or {})
    try:
        topic = int(binding.get("topic", 0))
    except Exception:
        topic = 0
    if not (0 <= topic < len(names)):
        topic = 0

    collections = list(getattr(topicals, "collections", []) or [])
    data = list(getattr(topicals, "data", []) or [])
    degwinner = list(getattr(topicals, "degwinner", []) or [])
    shares = list(getattr(topicals, "shares", []) or [])
    scores = list(getattr(topicals, "scores", []) or [])
    maxshare = list(getattr(topicals, "maxshare", []) or [])
    maxscore = list(getattr(topicals, "maxscore", []) or [])

    cols = [_column("lon", _txt("Longitude", "Longitude"), align="center", kind="glyph")]
    for pid in _ALMUTEN_PLANETS:
        cols.append(_almuten_planet_header_column(f"p{pid}", pid, chrt, options))
    cols.append(_column("degwins", _txt("DegreeWins", "Degree Wins"), align="center", kind="glyph"))

    topic_lons = list(collections[topic]) if topic < len(collections) else []
    topic_data = data[topic] if topic < len(data) else []
    topic_degwins = degwinner[topic] if topic < len(degwinner) else []
    rows: list[Row] = []
    for i, lon in enumerate(topic_lons):
        # collections carry pre-Ayanamsha longitudes (almutens.py:403); the
        # window applies the ayanamsha offset in drawLong, which _lon_cell does.
        cells = [_almuten_lon_cell(lon, chrt, options)]
        for j in _ALMUTEN_PLANETS:
            try:
                value = topic_data[j][i][0]
            except Exception:
                value = ""
            cells.append(_almuten_dignity_cell(value))
        dw = topic_degwins[i] if i < len(topic_degwins) else None
        cells.append(_almuten_degwinner_cell(dw, chrt, options))
        rows.append(_row(f"almt:{topic}:{i}", cells))

    topic_shares = shares[topic] if topic < len(shares) else []
    topic_scores = scores[topic] if topic < len(scores) else []
    topic_maxshare = list(maxshare[topic]) if topic < len(maxshare) else [-1, -1, False]
    topic_maxscore = list(maxscore[topic]) if topic < len(maxscore) else [-1, -1, False]

    def _totals_row(row_id: str, label: str, values: list, maxinfo: list) -> Row:
        cells = [_text(label, align="left")]
        win_id = maxinfo[0] if len(maxinfo) > 0 else -1
        dead_heat = bool(maxinfo[2]) if len(maxinfo) > 2 else False
        for pid in _ALMUTEN_PLANETS:
            value = values[pid] if pid < len(values) else None
            cells.append(_almuten_total_cell(value, winner=(win_id != -1 and win_id == pid and not dead_heat)))
        cells.append(_text("—", align="center"))
        return _row(row_id, cells)

    rows.append(_totals_row(f"almt:{topic}:shares", _txt("TotalShares1", "Total") + " " + _txt("TotalShares2", "Shares"), topic_shares, topic_maxshare))
    rows.append(_totals_row(f"almt:{topic}:scores", _txt("TotalScores1", "Total") + " " + _txt("TotalScores2", "Scores"), topic_scores, topic_maxscore))

    payload = _base_payload("almuten_topical", chrt, options, cols, rows or _empty(),
                            title=_txt("AlmutenTopical", "Almuten Topical"), source=source,
                            notes=[_txt("AlmutenTopicNote", "Topic: %s") % names[topic]])
    payload["sections"] = [{"id": f"topic:{topic}", "title": names[topic], "columns": cols, "rows": rows}]
    payload["capabilities"] = {
        **payload.get("capabilities", {}),
        "sections": True,
        "sorting": False,
        "bindings": {"topic": topic},
        # available topics for the skin's topic selector (id+label), mirroring
        # the wx ComboBox of topicals.names (almutentopicalsframe.py:21-27).
        "almutenTopical": {
            "topic": topic,
            "topics": [{"id": idx, "label": name} for idx, name in enumerate(names)],
        },
    }
    return payload


def _fixed_stars(chrt, options) -> dict[str, Any]:
    if len(getattr(options, "fixstars", []) or []) == 0:
        return _unavailable("fixed_stars", chrt, title="Fixed Stars", source="morin.py:15883-15896; fixstarswnd.py:15-312", reason=_txt("NoSelFixStars", "No selected fixed stars"))
    cols = [_column("idx", "#", align="right"), _column("name", _txt("Name", "Name")), _column("nomencl", _txt("Nomencl", "Nomencl")), _column("lon", _txt("Longitude", "Longitude"), align="center", kind="glyph"), _column("lat", _txt("Latitude", "Latitude"), align="center"), _column("ra", _txt("Rectascension", "RA"), align="center"), _column("decl", _txt("Declination", "Declination"), align="center")]
    rows = []
    for idx, fs in enumerate(getattr(getattr(chrt, "fixstars", None), "data", []) or []):
        name = astrology.display_fixstar_name(fs[1], options, fs[0])
        rows.append(_row(f"fix:{idx}", [
            _text(idx + 1, align="right", sort_value=idx + 1),
            _text(name),
            _text(fs[1]),
            _lon_cell(fs[2], chrt, options),
            _text(_dms(fs[3], signed=True), sort_value=float(fs[3])),
            _text(_ra(fs[4], options), sort_value=float(fs[4])),
            _text(_dms(fs[5], signed=True), sort_value=float(fs[5])),
        ]))
    return _base_payload("fixed_stars", chrt, options, cols, rows or _empty(), title="Fixed Stars", source="morin.py:15883-15896; fixstarswnd.py:15-312")


def _fixed_star_aspects(chrt, options) -> dict[str, Any]:
    # Structured port of the wx FixStarsAspectsWnd matrix
    # (fixstarsaspectswnd.py:184-841): rows = selected fixed stars (text name
    # labels in the left rail), columns = a flat sequence of Asc/Dsc/MC/IC
    # angles, the visible planets, the Lot of Fortune, and the option-gated
    # house cusps. Each cell carries the aspect glyph + aspect-type color + the
    # 1-decimal orb (fixstarsaspectswnd.py:251-270). The wx aspect test is a
    # fixed-star-specific orb model (getAsp/getOrb, fixstarsaspectswnd.py:
    # 436-473) over the per-star orb options.fixstars[code], NOT the planet
    # dynamic-aspect model — so it is ported here verbatim rather than reusing
    # _build_dynamic_aspect.
    source = "morin.py:16879-16882; fixstarsaspectswnd.py:184-841"
    if len(getattr(options, "fixstars", []) or []) == 0:
        return _unavailable("fixed_stars_aspects", chrt, title=_txt("FixedStarAspects", "Fixed Star Aspects"), source=source, reason=_txt("NoSelFixStars", "No selected fixed stars"))

    stars = getattr(getattr(chrt, "fixstars", None), "data", []) or []

    # Aspect set: traditional five or the full conjunctio..oppositio run
    # (fixstarsaspectswnd.py:185-188).
    if getattr(options, "traditionalaspects", False):
        run_aspects = [chart.Chart.CONJUNCTIO, chart.Chart.SEXTIL, chart.Chart.QUADRAT, chart.Chart.TRIGON, chart.Chart.OPPOSITIO]
    else:
        run_aspects = list(range(chart.Chart.CONJUNCTIO, chart.Chart.OPPOSITIO + 1))

    def get_asp(typ_deg: float, lon1: float, lon2: float, orb: float) -> bool:
        # FixStarsAspectsWnd.getAsp (fixstarsaspectswnd.py:436-452)
        a1, a2 = lon1, lon2
        if not a1 > a2:
            a1, a2 = a2, a1
        diff = a1 - typ_deg
        return (a2 - orb) < diff and (a2 + orb) > diff

    def get_orb(typ_deg: float, lon1: float, lon2: float, orb: float):
        # FixStarsAspectsWnd.getOrb (fixstarsaspectswnd.py:454-473)
        a1, a2 = lon1, lon2
        if not a1 > a2:
            a1, a2 = a2, a1
        diff = a1 - typ_deg
        if (a2 - orb) < diff and (a2 + orb) > diff:
            return (diff - a2) if a2 < diff else (a2 - diff)
        return None

    def star_orb(fs) -> float:
        try:
            return options.fixstars[fs[1]]
        except Exception:
            return chart.Chart.def_fixstarsorb

    def cell_for(lon1: float, lon2: float, orb: float) -> dict[str, Any] | None:
        # First shown aspect wins (wx draws each in place but only one can
        # occupy a square; the run is ordered conjunctio..oppositio).
        for numasp in run_aspects:
            if not options.aspect[numasp]:
                continue
            typ_deg = chart.Chart.Aspects[numasp]
            if not get_asp(typ_deg, lon1, lon2, orb):
                continue
            o = get_orb(typ_deg, lon1, lon2, orb)
            if o is None:
                continue
            glyph, glyph_role = common.common.aspect_glyph(numasp)
            cell: dict[str, Any] = {
                "aspectType": int(numasp),
                "glyph": glyph,
                "glyphFont": glyph_role,
                "orb": "%0.1f" % o,
            }
            color = _rgb_hex(options.clraspect[numasp])
            _set_semantic_color(
                cell,
                color,
                aspect_color_role(options, numasp, resolved_color=color),
            )
            return cell
        return None

    # ---- Column axis (fixstarsaspectswnd.py:225-427 draw order) ----------
    intables = getattr(options, "intables", False)

    def planet_visible(p: int) -> bool:
        if not intables:
            return True
        if p == astrology.SE_URANUS and not options.transcendental[chart.Chart.TRANSURANUS]:
            return False
        if p == astrology.SE_NEPTUNE and not options.transcendental[chart.Chart.TRANSNEPTUNE]:
            return False
        if p == astrology.SE_PLUTO and not options.transcendental[chart.Chart.TRANSPLUTO]:
            return False
        if p in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not options.shownodes:
            return False
        return True

    ASC = chrt.houses.ascmc[houses.Houses.ASC]
    DESC = util.normalize(ASC + 180.0)
    MC = chrt.houses.ascmc[houses.Houses.MC]
    IC = util.normalize(MC + 180.0)
    # AscMC header glyphs ('0','3','1','2' = Asc/Dsc/MC/IC, Morinus face;
    # fixstarsaspectswnd.py:228,561) with the longitude each represents.
    ascmc_cols = [
        {"glyph": _angle_glyph("asc"), "label": _txt("Asc", "Asc"), "lon": ASC},
        {"glyph": _angle_glyph("dsc"), "label": _txt("Dsc", "Dsc"), "lon": DESC},
        {"glyph": _angle_glyph("mc"), "label": _txt("MC", "MC"), "lon": MC},
        {"glyph": _angle_glyph("ic"), "label": _txt("IC", "IC"), "lon": IC},
    ]

    col_axis: list[dict[str, Any]] = []
    col_lons: list[float] = []
    for c in ascmc_cols:
        col_axis.append({"id": f"col:{len(col_axis)}", "glyph": c["glyph"], "glyphFont": "morinus", "label": c["label"]})
        col_lons.append(c["lon"])

    # Visible planets (fixstarsaspectswnd.py:273-305).
    for p in range(len(common.common.Planets)):
        if not planet_visible(p):
            continue
        body = chrt.get_planet_body(p) if hasattr(chrt, "get_planet_body") else None
        if body is None:
            continue
        entry: dict[str, Any] = {
            "id": f"col:{len(col_axis)}",
            "planet": int(p),
            "glyph": _planet_glyph(p),
            "glyphFont": "morinus",
            "label": common.common.get_planet_name(p),
        }
        color = _planet_color(p, chrt, options)
        _set_semantic_color(entry, color, _planet_color_role(p, chrt, options, color))
        col_axis.append(entry)
        col_lons.append(body.data[planets.Planet.LONG])

    # Lot of Fortune (fixstarsaspectswnd.py:342-384). wx LoF color uses the
    # individual palette slot SE_MEAN_NODE+1 under useplanetcolors, else
    # peregrine.
    show_lof = (not intables) or getattr(options, "showlof", True)
    if show_lof:
        lof_color = None
        try:
            if getattr(options, "useplanetcolors", False):
                lof_color = _rgb_hex(options.clrindividual[astrology.SE_MEAN_NODE + 1])
            else:
                lof_color = _rgb_hex(getattr(options, "clrperegrin", None))
        except Exception:
            lof_color = _rgb_hex(getattr(options, "clrperegrin", None))
        entry = {"id": f"col:{len(col_axis)}", "glyph": common.common.fortune, "glyphFont": "morinus", "label": _txt("FortunaeF", "Fortune")}
        _set_semantic_color(entry, lof_color, _fortune_color_role(chrt, options, lof_color))
        col_axis.append(entry)
        col_lons.append(chrt.fortune.fortune[fortune.Fortune.LON])

    # Houses (fixstarsaspectswnd.py:386-427): cusps [1,2,3,10,11,12] labelled
    # by Housenames2; text headers (no glyph).
    show_houses = (not intables) or getattr(options, "houses", True)
    if show_houses:
        hidx = (1, 2, 3, 10, 11, 12)            # fixstarsaspectswnd.py:79
        cusps = [0, 1, 2, 9, 10, 11]            # fixstarsaspectswnd.py:397
        for h, cusp in zip(hidx, cusps):
            col_axis.append({"id": f"col:{len(col_axis)}", "glyphFont": "text", "label": str(common.common.Housenames2[h - 1])})
            col_lons.append(chrt.houses.cusps[cusp + 1])

    # ---- Cells + flat list ---------------------------------------------------
    row_axis: list[dict[str, Any]] = []
    cells: dict[str, dict[str, Any]] = {}
    flat_rows: list[Row] = []
    flat_cols = [_column("star", _txt("FixedStar", "Star")), _column("body", _txt("Bodies", "Body"), align="center", kind="glyph"), _column("aspect", _txt("Aspect", "Aspect"), align="center", kind="glyph"), _column("orb", _txt("Orb", "Orb"), align="right")]

    for r, fs in enumerate(stars):
        name = astrology.display_fixstar_name(fs[1], options, fs[0])
        row_axis.append({"id": f"row:{r}", "label": name})
        lon1 = fs[2]
        orb = star_orb(fs)
        for c, lon2 in enumerate(col_lons):
            cell = cell_for(lon1, lon2, orb)
            if cell is None:
                continue
            cells[f"row:{r}:col:{c}"] = cell
            # Flat pair list for TSV/copy: star · column glyph · aspect · orb.
            axis_entry = col_axis[c]
            head = _glyph(axis_entry.get("glyph", ""), text=axis_entry.get("label", "")) if axis_entry.get("glyphFont") != "text" else _text(axis_entry.get("label", ""), align="center")
            asp_cell = _glyph(cell["glyph"])
            _set_semantic_color(
                asp_cell,
                cell.get("color"),
                cell.get("colorRole"),
            )
            flat_rows.append(_row(f"fsasp:{r}:{c}", [_text(name), head, asp_cell, _text(cell["orb"] + "°", align="right")]))

    payload = _base_payload("fixed_stars_aspects", chrt, options, flat_cols, flat_rows or _empty(_txt("NoFixedStarAspects", "No fixed star aspects")), title=_txt("FixedStarAspects", "Fixed Star Aspects"), source=source)
    payload["matrix"] = {
        # Distinct geometry from the planet aspect matrix: text row labels
        # (stars) on the left rail and a single flat glyph-header column axis;
        # no triangle, no diagonal headers. The "kind" discriminator lets the
        # shared AspectMatrixView branch to this layout.
        "kind": "fixedStar",
        "rows": row_axis,
        "cols": col_axis,
        "cells": cells,
        "planets": [],
        "ascmc": [],
        "houses": [],
    }
    payload["capabilities"] = {**payload.get("capabilities", {}), "matrix": True, "sorting": False}
    return payload


def _fixstar_parallel_mag(code: str, fallback_name: str | None) -> float | None:
    # Magnitude lookup (fixstarsparallelswnd._star_mag_from_sef_or_fallback:
    # 268-355): swe_fixstar_mag primary path, range-filtered. The sefstars.txt /
    # generic-catalog fallbacks are omitted (daemon-only, rarely needed); None
    # magnitude yields the conservative 5' orb in _fixstar_bold_orb_deg.
    for sid in (code, fallback_name):
        if not sid:
            continue
        try:
            _ret, _st, mag_val, _serr = astrology.swe_fixstar_mag("," + str(sid).replace("\x00", "").strip())
        except Exception:
            continue
        try:
            raw = mag_val[0] if isinstance(mag_val, (list, tuple)) else mag_val
            if raw is not None:
                cand = float(raw)
                if -15.0 < cand < 20.0 and cand < 998.0:
                    return cand
        except Exception:
            continue
    return None


def _fixstar_bold_orb_deg(mag: float | None) -> float:
    # Magnitude-tiered bold orb in degrees (fixstarsparallelswnd._bold_orb_deg:
    # 370-380): brighter stars get a wider close-parallel orb.
    if mag is None:
        return 5.0 / 60.0
    if mag < 0.0:
        return 10.0 / 60.0
    if 0.0 <= mag < 1.0:
        return 8.0 / 60.0
    if 1.0 <= mag <= 1.5:
        return 6.0 / 60.0
    return 5.0 / 60.0


def _fixstar_parallel_label_color(key, chrt, options) -> str | None:
    # Point-symbol color (fixstarsparallelswnd._label_color:688-715).
    indiv = list(getattr(options, "clrindividual", []) or [])
    use = getattr(options, "useplanetcolors", False)
    if key == astrology.SE_CHIRON:
        return _planet_color(astrology.SE_CHIRON, chrt, options)
    if isinstance(key, int) and astrology.SE_SUN <= key <= astrology.SE_PLUTO:
        return _planet_color(key, chrt, options)
    if key in ("NN", "SN"):
        if use and astrology.SE_PLUTO + 1 < len(indiv):
            return _rgb_hex(indiv[astrology.SE_PLUTO + 1])
        return _rgb_hex(getattr(options, "clrtexts", None))
    if key == "LOF":
        if use and astrology.SE_PLUTO + 2 < len(indiv):
            return _rgb_hex(indiv[astrology.SE_PLUTO + 2])
        return _rgb_hex(getattr(options, "clrtexts", None))
    return _rgb_hex(getattr(options, "clrtexts", None))


def _fixstar_parallel_label_color_role(key, chrt, options, color: str | None) -> str | None:
    if key == astrology.SE_CHIRON or (
        isinstance(key, int) and astrology.SE_SUN <= key <= astrology.SE_PLUTO
    ):
        return _planet_color_role(int(key), chrt, options, color)
    if key in ("NN", "SN") and getattr(options, "useplanetcolors", False):
        return _planet_color_role(astrology.SE_MEAN_NODE, chrt, options, color)
    if key == "LOF" and getattr(options, "useplanetcolors", False):
        return _fortune_color_role(chrt, options, color)
    return "--morinus-text-bright" if color == _rgb_hex(getattr(options, "clrtexts", None)) else None


def _fixed_star_parallels(chrt, options) -> dict[str, Any]:
    if len(getattr(options, "fixstars", []) or []) == 0:
        return _unavailable("fixed_stars_parallels", chrt, title=_txt("FixedStarParallels", "Fixed Star Parallels"), source="morin.py:15883-15896; fixstarsparallelswnd.py:30-402", reason=_txt("NoSelFixStars", "No selected fixed stars"))
    # Point-major layout (fixstarsparallelswnd.py:193-266,545-655): each chart
    # point (Asc/Dsc/MC/IC, planets, Chiron, NN/SN, LoF) lists every fixstar
    # whose declination matches in sign within 15', stacked one row per match;
    # the point symbol + declination repeat on each stacked row. Rows where the
    # decl orb falls within the magnitude-tiered bold threshold carry
    # emphasis="strong" (fixstarsparallelswnd.py:576-577).
    decl_label = _txt("Declination", "Declination")
    star_label = _txt("FixedStar", "Star")
    cols = [
        _column("point", "", align="center", kind="glyph"),
        _column("pdecl", decl_label, align="center"),
        _column("star", star_label),
        _column("sdecl", decl_label, align="center"),
    ]

    try:
        obl = chrt.obl[0] if isinstance(chrt.obl, (list, tuple)) else chrt.obl
    except Exception:
        obl = 0.0

    # Collect point declinations (fixstarsparallelswnd._collect_points:205-266).
    points: list[tuple[Any, str, bool, float | None]] = []  # (key, label, is_glyph, decl)
    try:
        asc = chrt.houses.ascmc2[houses.Houses.ASC]
        mc = chrt.houses.ascmc2[houses.Houses.MC]
        ayanamsha_offset = float(getattr(chrt, "ayanamsha_offset", 0.0) or 0.0)
        _dsc_ra, dsc_decl, _z = astrology.swe_cotrans(
            util.to_tropical_lon(util.normalize(asc[houses.Houses.LON] + 180.0), ayanamsha_offset),
            0.0,
            1.0,
            -obl,
        )
        _ic_ra, ic_decl, _z2 = astrology.swe_cotrans(
            util.to_tropical_lon(util.normalize(mc[houses.Houses.LON] + 180.0), ayanamsha_offset),
            0.0,
            1.0,
            -obl,
        )
        points.append(("ASC", _txt("Asc", "Asc"), False, asc[houses.Houses.DECL]))
        points.append(("DSC", _txt("Dsc", "Dsc"), False, dsc_decl))
        points.append(("MC", _txt("MC", "MC"), False, mc[houses.Houses.DECL]))
        points.append(("IC", _txt("IC", "IC"), False, ic_decl))
    except Exception:
        pass
    for p in (astrology.SE_SUN, astrology.SE_MOON, astrology.SE_MERCURY, astrology.SE_VENUS,
              astrology.SE_MARS, astrology.SE_JUPITER, astrology.SE_SATURN,
              astrology.SE_URANUS, astrology.SE_NEPTUNE, astrology.SE_PLUTO):
        try:
            points.append((p, _planet_glyph(p), True, chrt.planets.planets[p].dataEqu[planets.Planet.DECLEQU]))
        except Exception:
            continue
    if getattr(chrt, "chiron", None) is not None and getattr(options, "showchiron", True):
        try:
            points.append((astrology.SE_CHIRON, _planet_glyph(astrology.SE_CHIRON), True, chrt.chiron.dataEqu[planets.Planet.DECLEQU]))
        except Exception:
            pass
    try:
        node_decl = chrt.planets.planets[astrology.SE_PLUTO + 1].dataEqu[planets.Planet.DECLEQU]
        points.append(("NN", _planet_glyph(astrology.SE_MEAN_NODE), True, node_decl))
        points.append(("SN", common.common.descnode if hasattr(common.common, "descnode") else _planet_glyph(astrology.SE_MEAN_NODE), True, -node_decl))
    except Exception:
        pass
    try:
        points.append(("LOF", common.common.fortune, True, chrt.fortune.fortune[3]))
    except Exception:
        pass

    fixstars_data = getattr(getattr(chrt, "fixstars", None), "data", []) or []
    rows: list[Row] = []
    for key, label, is_glyph, pdecl in points:
        color = _fixstar_parallel_label_color(key, chrt, options)
        point_cell = _glyph(label, align="center") if is_glyph else _text(label, align="center")
        _set_semantic_color(
            point_cell,
            color,
            _fixstar_parallel_label_color_role(key, chrt, options, color),
        )
        # Matches: sign-equal decl within 15' (fixstarsparallelswnd._compute
        # _matches:659-676), sorted by orb.
        matches: list[tuple[str, float, float | None]] = []
        if pdecl is not None:
            for fs in fixstars_data:
                try:
                    sdecl = fs[5]
                    if pdecl * sdecl < 0:
                        continue
                    if abs(pdecl - sdecl) <= (15.0 / 60.0):
                        code = fs[1]
                        disp = astrology.display_fixstar_name(code, options, fs[0])
                        mag = _fixstar_parallel_mag(code, fs[0])
                        matches.append((disp, sdecl, mag))
                except Exception:
                    continue
            matches.sort(key=lambda mm: abs(pdecl - mm[1]))
        pdecl_text = "—" if pdecl is None else _dms(pdecl, signed=True)
        if not matches:
            rows.append(_row(f"fspar:{key}", [point_cell, _text(pdecl_text, align="center"), _text("—"), _text("—", align="center")]))
            continue
        for mi, (disp, sdecl, mag) in enumerate(matches):
            bold = (pdecl is not None and (pdecl * sdecl) >= 0.0
                    and abs(pdecl - sdecl) <= _fixstar_bold_orb_deg(mag))
            emphasis = "strong" if bold else None
            # Repeat the point symbol + decl on each stacked row, matching wx.
            repeat_cell = dict(point_cell)
            rows.append(_row(
                f"fspar:{key}:{mi}",
                [repeat_cell,
                 _text(pdecl_text, align="center", emphasis=emphasis),
                 _text(disp, emphasis=emphasis),
                 _text(_dms(sdecl, signed=True), align="center", emphasis=emphasis)],
                emphasis=emphasis,
            ))
    return _base_payload("fixed_stars_parallels", chrt, options, cols, rows or _empty(_txt("NoFixedStarParallels", "No fixed star parallels")), title=_txt("FixedStarParallels", "Fixed Star Parallels"), source="morin.py:16883-16884; fixstarsparallelswnd.py:193-715")


def _asteroids(chrt, options) -> dict[str, Any]:
    cols = [_column("name", _txt("Name", "Name")), _column("lon", _txt("Longitude", "Longitude"), align="center", kind="glyph"), _column("lat", _txt("Latitude", "Latitude"), align="center"), _column("ra", _txt("Rectascension", "RA"), align="center"), _column("decl", _txt("Declination", "Declination"), align="center")]
    rows = []
    for idx, ast in enumerate(getattr(getattr(chrt, "asteroids", None), "asteroids", []) or []):
        data = getattr(ast, "data", ())
        rows.append(_row(f"asteroid:{idx}", [_text(getattr(ast, "name", "")), _lon_cell(data[0], chrt, options) if len(data) > 0 else _text("-"), _text(_dms(data[1], signed=True) if len(data) > 1 else "-"), _text(_ra(data[2], options) if len(data) > 2 else "-"), _text(_dms(data[3], signed=True) if len(data) > 3 else "-")]))
    return _base_payload("asteroids", chrt, options, cols, rows or _empty(), title="Asteroids", source="morin.py:17188-17190; asteroidswnd.py:13-294")


def _angle_at_birth(chrt, options, binding: dict[str, Any] | None = None) -> dict[str, Any]:
    binding = dict(binding or {})
    try:
        minutes = max(1, int(binding.get("minutes", 10)))
    except Exception:
        minutes = 10
    cols = [_column("dt", "ΔT", align="right"), _column("star", _txt("FixedStar", "Star")), _column("angle", _txt("Angles", "Angle"), align="center"), _column("time", _txt("ExactTime", "Exact Time"), align="center")]
    rows = []
    for idx, r in enumerate(compute_contacts(chrt, options, minutes) or []):
        time_str = str(r.get("time_str", ""))
        m_all = re.findall(r"(\d{1,2})[:.](\d{1,2})(?:[:.](\d{1,2}))?", time_str)
        if m_all:
            h, mi, se = m_all[-1]
            time_str = "%02d:%02d:%02d" % (int(h), int(mi), int(se or 0))
        rows.append(_row(f"angle:{idx}", [_text("%.2f" % float(r.get("dt_min", 0.0)), align="right"), _text(r.get("star", "")), _text(r.get("angle", ""), align="center"), _text(time_str, align="center")]))
    return _base_payload(
        "angle_at_birth",
        chrt,
        options,
        cols,
        rows or _empty(_txt("NoAngleContacts", "No angle contacts")),
        title=_txt("AngleAtBirth", "Angle at Birth"),
        source="morin.py:16887-16898; angleatbirthwnd.py:12-93; angleatbirth.py:317",
        notes=[
            _txt("AngleWindowNote", "Window: %d minutes") % minutes,
            "The wx prompt UI from morin.onAngleAtBirth (morin.py:17503-17518) is outside Packet 05A; daemon table binding preserves the chosen minutes value when supplied.",
        ],
    )


def _phasis(chrt, options) -> dict[str, Any]:
    try:
        from phasiscalc import PLANET_IDS, is_outer, visibility_flags_around, _local_date_tuple
    except Exception as exc:
        return _unavailable("phasis", chrt, title="Phasis", source="morin.py:17181-17183; phasiswnd.py:185-467", reason=str(exc))
    cols = [_column("body", _txt("TopicalPlanet", "Planet"), align="center", kind="glyph"), _column("phasis", _txt("Phasis", "Phasis")), _column("time", _txt("TimeDays", "Time"))]
    labels = {"MF": _txt("MorningFirst", "Morning first"), "ML": _txt("MorningLast", "Morning last"), "EF": _txt("EveningFirst", "Evening first"), "EL": _txt("EveningLast", "Evening last")}
    mode = int(getattr(options, "phasismode", getattr(options, "PHASIS_MODE_ASTRONOMICAL", 0)))
    try:
        vis = visibility_flags_around(chrt, days_window=7, mode=mode)
    except Exception:
        vis = {}
    jd0 = chrt.time.jd
    y0, m0, d0, calflag = _local_date_tuple(chrt, jd0)
    rows = []
    pref = {"MF": 0, "ML": 1, "EF": 2, "EL": 3}
    for ipl in PLANET_IDS:
        codes = ("EL", "MF") if is_outer(ipl) else ("MF", "ML", "EF", "EL")
        events = []
        for code in codes:
            off = (vis.get(ipl, {}) or {}).get(code)
            if isinstance(off, int) and abs(off) <= 7:
                events.append((code, off))
        if events:
            code, off = sorted(events, key=lambda t: (abs(t[1]), pref[t[0]]))[0]
            base = datetime.date(int(y0), int(m0), int(d0))
            when = base + datetime.timedelta(days=int(off))
            day_word = _txt("Day", "day") if abs(off) == 1 else _txt("Days", "days")
            time_text = "%s (%+d %s)" % (when.isoformat(), int(off), day_word)
            phase = labels.get(code, code)
        else:
            phase = "-"
            time_text = "- (±7 %s)" % _txt("Days", "days")
        # Per-planet colored body glyph (phasiswnd._apply_row_colors:410-417).
        rows.append(_row(f"phasis:{ipl}", [_planet_cell(ipl, chrt, options), _text(phase), _text(time_text)]))

    # Section 1: two info header rows without column separators
    # (phasiswnd.py:476-492): "Heliacal Risings/Settings ±7 Days" then
    # "Atmospheric Extinction <k>" where k = AE from the visibility flags
    # (phasiswnd._get_extinction_and_altitude:256-288, first valid vis['AE']).
    days_word = _txt("Days", "days")
    info1 = "%s ±7 %s" % (_txt("HeliacalRisingsSettings", "Heliacal Risings/Settings"), days_word)
    k = None
    try:
        for ipl in PLANET_IDS:
            entry = vis.get(ipl, {}) or {}
            if "AE" in entry:
                k = float(entry["AE"])
                break
    except Exception:
        k = None
    info2 = "%s %s" % (_txt("AtmosphericExtinction", "Atmospheric Extinction"),
                       "—" if k is None else ("%.4f" % k))
    info_cols = [_column("info", "")]
    info_rows = [_row("info1", [_text(info1)]), _row("info2", [_text(info2)])]
    sections = [
        {"id": "info", "columns": info_cols, "rows": info_rows},
        {"id": "phasis", "columns": cols, "rows": rows},
    ]
    # Flat fallback keeps the info lines as notes (single-column rows would
    # corrupt the 3-col TSV), with the planet grid as the flat rows.
    payload = _base_payload("phasis", chrt, options, cols, rows, title="Phasis",
                            source="morin.py:15843-15850,17181-17183; phasiswnd.py:467-555",
                            notes=[info1, info2])
    payload["sections"] = sections
    payload["capabilities"] = {**payload.get("capabilities", {}), "sections": True, "sorting": False}
    return payload


def _paranatellonta(chrt, options) -> dict[str, Any]:
    # Paran rows now come from the wx-free solver in engine.paranatellonta
    # (relocated verbatim from paranwnd.py; the wx window re-imports it). Each row
    # is (ΔtTxt, ipl, StarDispName, AnglesTxt, same). The columns mirror the wx
    # ParanatellontaWnd grid: ΔT | Planet(glyph) | Fixed Star | Angles
    # (paranwnd.py:792,902). The whole row is bold when planet and star cross the
    # SAME angle (same = kindP == kindS, paranwnd.py:1216), carried here as the
    # row-level emphasis="strong" channel the generic table view already renders.
    source = "morin.py:17184-17185; paranwnd.py:659-1238; engine/paranatellonta.py"
    if len(getattr(options, "fixstars", []) or []) == 0:
        return _unavailable(
            "paranatellonta",
            chrt,
            title=_txt("Paranatellonta", "Paranatellonta"),
            source=source,
            reason=_txt("NoSelFixStars", "No selected fixed stars"),
        )

    rows_data = paranatellonta.compute_paran_rows(chrt, options)

    cols = [
        _column("dt", "ΔT", align="center"),
        _column("planet", _txt("TopicalPlanet", "Planet"), align="center", kind="glyph"),
        _column("star", _txt("FixedStar", "Fixed Star")),
        _column("angles", _txt("Angles", "Angles"), align="center"),
    ]

    rows: list[Row] = []
    for idx, row in enumerate(rows_data):
        dtxt, ipl, star_disp, angles_txt, same = row
        emphasis = "strong" if same else None
        rows.append(_row(
            f"paran:{idx}",
            [
                _text(dtxt, align="center", emphasis=emphasis),
                _planet_cell(int(ipl), chrt, options, emphasis=emphasis),
                _text(star_disp, emphasis=emphasis),
                _text(angles_txt, align="center", emphasis=emphasis),
            ],
            emphasis=emphasis,
        ))

    return _base_payload("paranatellonta", chrt, options, cols, rows or _empty(_txt("NoParanatellonta", "No parans")),
                         title=_txt("Paranatellonta", "Paranatellonta"), source=source)


def _firdaria(chrt, options, binding: dict[str, Any] | None = None, *, current_datetime: Any = None) -> dict[str, Any]:
    source = "morin.py:15883-15888,16017-16020,16764-16769,17566-17570; firdaria.py:1-99; firdariaframe.py:6-15; firdariawnd.py:21-615; commonwnd.py:63-85"
    if getattr(getattr(chrt, "time", None), "bc", False):
        return _unavailable(
            "firdaria",
            chrt,
            title=_txt("Firdaria", "Firdaria"),
            source=source,
            reason=_txt("NotAvailable", "Not available for BC charts."),
        )

    binding = dict(binding or {})
    isfirbonatti = bool(binding.get("isfirbonatti", getattr(options, "isfirbonatti", True)))
    # Anchor: midnight of the radix birth DATE — firdaria.Firdaria builds its
    # startdate from datetime(origyear, origmonth, origday) (firdaria.py:21),
    # the same midnight anchor the wx FirdariaWnd uses (firdariawnd.py:92-100).
    # Diurnal/nocturnal mode is AUTO from chart sect (chrt.abovehorizonwithorb,
    # chart.py:544/577); only the nocturnal ORDER (Bonatti vs al-Biruni) is the
    # user toggle (firdariawnd.py:69-76,126-135).
    fird = firdaria.Firdaria(
        int(chrt.time.origyear),
        int(chrt.time.origmonth),
        int(chrt.time.origday),
        options,
        bool(getattr(chrt, "abovehorizonwithorb", False)),
        isfirbonatti=isfirbonatti,
    )
    # Planetary-year table selection — FirdariaWnd._firdaria_rows
    # (firdariawnd.py:181-187) / drawBkg (494-500).
    if fird.isdaily:
        planetaryyears = fird.dailyplanetaryyears
        sect_label = _txt("Diurnal", "Diurnal")
    elif isfirbonatti:
        planetaryyears = fird.nightlyplanetaryyearsbonatti
        sect_label = "%s: %s" % (_txt("Nocturnal", "Nocturnal"), _txt("Bonatus", "Bonatus"))
    else:
        planetaryyears = fird.nightlyplanetaryyearsalbiruni
        sect_label = "%s: %s" % (_txt("Nocturnal", "Nocturnal"), _txt("AlBiruni", "Al Biruni"))
    # Title text exactly as the wx table header (firdariawnd.py:370-377).
    title_text = "%s (%s)" % (_txt("Firdaria", "Firdaria"), sect_label)

    # Firdaria's internal ids are [Saturn, Jupiter, Mars, Sun, Venus, Mercury,
    # Moon, North Node, South Node].  wx first maps those ids through
    # planetseliascorrection into a shortened tuple where slots 7/8 are already
    # common.common.Planets[10]/[11] (firdariawnd.py:382,398,491,511,580).
    # The daemon needs the final chart body ids directly; using the wx
    # correction list as common.common.Planets indices turns the node periods
    # into Uranus/Neptune glyphs.
    firdaria_body_ids = [
        astrology.SE_SATURN,
        astrology.SE_JUPITER,
        astrology.SE_MARS,
        astrology.SE_SUN,
        astrology.SE_VENUS,
        astrology.SE_MERCURY,
        astrology.SE_MOON,
        astrology.SE_MEAN_NODE,
        astrology.SE_TRUE_NODE,
    ]
    # Dignity colour table self.clrs (firdariawnd.py:64).
    dign_clrs = [
        getattr(options, "clrdomicil", (0, 0, 0)),
        getattr(options, "clrexal", (0, 0, 0)),
        getattr(options, "clrperegrin", (0, 0, 0)),
        getattr(options, "clrcasus", (0, 0, 0)),
        getattr(options, "clrexil", (0, 0, 0)),
    ]

    def planet_color(internal_pid: int) -> str:
        # Glyph colour — useplanetcolors → clrindividual (nodes mapped to the
        # shared Node colour slot 10), else the planet's dignity colour
        # (firdariawnd.py:403-411,517-525,586-594).
        objidx = firdaria_body_ids[int(internal_pid)]
        try:
            if getattr(options, "useplanetcolors", False):
                if objidx > astrology.SE_SATURN:
                    objidx = 10
                return _zr_hex(options.clrindividual[objidx])
            return _zr_hex(dign_clrs[int(chrt.dignity(objidx))])
        except Exception:
            return "#888888"

    def planet_cell(internal_pid: int) -> Cell:
        pid = firdaria_body_ids[int(internal_pid)]
        cell = _glyph(_planet_glyph(pid))
        cell["planet"] = int(pid)
        color = planet_color(internal_pid)
        _set_semantic_color(cell, color, _planet_color_role(pid, chrt, options, color))
        return cell

    now = _parse_datetime(current_datetime)
    columns = [
        {**_column("body", _txt("Ruler", "Ruler"), align="center", kind="glyph"), "widthFactor": 2},
        {**_column("period", _txt("Start", "Start"), align="center"), "widthFactor": 5},
        {**_column("age", _txt("Age", "Age"), align="right"), "widthFactor": 2},
    ]
    rows: list[Row] = []
    current_ids: list[str] = []
    starting = fird.startdate
    # Two full cycles, mains interleaved with their 7 sub-periods — the
    # FirdariaWnd row model (firdariawnd.py:190-207 / 393-428 + 556-615).
    for index in range(2 * len(planetaryyears)):
        aindex = index % len(planetaryyears)
        planet, years = planetaryyears[aindex]
        ending = datetime.datetime(starting.year + int(years), starting.month, starting.day)
        period_text = dateformat.date_text(starting.year, starting.month, starting.day, options)
        row_id = f"main:{index}"
        is_current = now is not None and starting <= now < ending
        main_color = planet_color(planet)
        main_role = _planet_color_role(
            int(firdaria_body_ids[int(planet)]), chrt, options, main_color,
        )
        if is_current:
            current_ids.append(row_id)
        rows.append(_row(
            row_id,
            [
                planet_cell(planet),
                _text(period_text, align="center"),
                _text(_period_age_text(chrt, starting), align="right"),
            ],
            meta={
                "level": 1,
                "planet": int(firdaria_body_ids[int(planet)]),
                "firdariaPlanet": int(planet),
                "colorHex": main_color,
                "colorRole": main_role,
                "hasChildren": not fird.isNode(aindex),
                "periodStart": _date_iso(starting),
                "periodEndExclusive": _date_iso(ending),
                "eventDate": _date_iso(starting),
                "current": is_current,
                "rowActions": ["open_containing_solar_revolution", "open_transit_for_date", "open_chart_for_date"],
            },
        ))
        if is_current:
            rows[-1]["current"] = True
        # Node main periods carry NO sub-periods (firdaria.isNode +
        # displaySubPeriods early return, firdaria.py:36-43 / firdariawnd.py:557-558).
        if not fird.isNode(aindex):
            subperiodstart = starting
            secs = (ending - starting).total_seconds()
            subindex = aindex
            for subrow in range(7):
                subplanet, _subyears = planetaryyears[subindex]
                # Last sub closes exactly on the main's end so the float
                # secs/7 chain leaves no containment gap (wx never tests containment,
                # it only prints starts — firdariawnd.py:576,609).
                subperiodend = ending if subrow == 6 else subperiodstart + datetime.timedelta(seconds=secs / 7.0)
                sub_id = f"sub:{index}:{subrow}"
                sub_current = now is not None and subperiodstart <= now < subperiodend
                sub_color = planet_color(subplanet)
                sub_role = _planet_color_role(
                    int(firdaria_body_ids[int(subplanet)]), chrt, options, sub_color,
                )
                if sub_current:
                    current_ids.append(sub_id)
                rows.append(_row(
                    sub_id,
                    [
                        planet_cell(subplanet),
                        # Sub rows show only the start date (firdariawnd.py:609).
                        _text(dateformat.date_text(subperiodstart.year, subperiodstart.month, subperiodstart.day, options), align="center"),
                        _text("", align="right"),
                    ],
                    meta={
                        "level": 2,
                        "planet": int(firdaria_body_ids[int(subplanet)]),
                        "firdariaPlanet": int(subplanet),
                        "colorHex": sub_color,
                        "colorRole": sub_role,
                        "periodStart": _date_iso(subperiodstart),
                        "periodEndExclusive": _date_iso(subperiodend),
                        "eventDate": _date_iso(subperiodstart),
                        "parentId": row_id,
                        "hasChildren": False,
                        "current": sub_current,
                        "rowActions": ["open_containing_solar_revolution", "open_transit_for_date", "open_chart_for_date"],
                    },
                ))
                if sub_current:
                    rows[-1]["current"] = True
                subperiodstart = subperiodend
                subindex = fird.nextIndex(subindex)
        starting = ending

    payload = _base_payload(
        "firdaria",
        chrt,
        options,
        columns,
        rows or _empty(),
        title=_txt("Firdaria", "Firdaria"),
        source=source,
        notes=["%s" % title_text],
    )
    payload["capabilities"] = {
        **payload.get("capabilities", {}),
        "sorting": False,
        "copy": True,
        "export": ["tsv", "json"],
        "timeLord": True,
        "timeLordSystem": "firdaria",
        "tree": True,
        "currentRow": bool(current_ids),
        "currentRowIds": current_ids,
        "initialExpandedRowIds": sorted({str(row.get("meta", {}).get("parentId")) for row in rows if row.get("current") and row.get("meta", {}).get("parentId")}),
        "bindings": {
            "isfirbonatti": bool(isfirbonatti),
        },
        # Header model for the dedicated pane — the wx title cell text plus the
        # nocturnal-order toggle label (firdariawnd.py:69-70,370-377).
        "firdaria": {
            "titleText": title_text,
            "sectLabel": sect_label,
            "isDaily": bool(fird.isdaily),
            "isFirBonatti": bool(isfirbonatti),
            "bonattiToggleLabel": _txt("BonattiNocturnalOrder", "Use Bonatti nocturnal order"),
        },
        "rowActions": [
            {"id": "open_containing_solar_revolution", "deferred": False},
            {"id": "open_transit_for_date", "deferred": False},
            {"id": "open_chart_for_date", "deferred": False},
        ],
    }
    payload["deferrals"] = [
        "Rendered bitmap/PDF export remains deferred from commonwnd.py:102/163 and FirdariaWnd.pdf_export_spec (firdariawnd.py:250-346); the web surface exports daemon row payloads as TSV/JSON.",
    ]
    payload["source"] = source
    return payload


def _strip(chrt, options) -> dict[str, Any]:
    # Structured port of the wx StripWnd (stripwnd.py:78-646). The wx surface
    # is a SINGLE graphical 0-30 axis (TABLE_WIDTH = SIGN_DEG*TICSTEP,
    # stripwnd.py:41) onto which every body is collapsed by its within-sign
    # degree (lon %= SIGN_DEG, stripwnd.py:214,398). It does NOT split per
    # occupied sign — all bodies from all signs overlay on one strip.
    #
    # The daemon emits the *semantic* data only: each body's within-sign degree
    # (0-30 float), its true longitude, its resolved per-body color, and its
    # glyph + font role. Pixel placement and the anti-overlap nudging
    # (arrange/doArrange/doShift, stripwnd.py:407-646) are layout concerns the
    # React view owns. Bodies are additionally grouped by occupied sign so the
    # web view can render one strip per sign (more legible than the wx overlay);
    # the wx single-overlay form is recoverable by merging all groups.
    source = "morin.py:14245,14620; stripwnd.py:78-646"
    def _within_sign(lon: float) -> tuple[int, float]:
        norm = util.normalize(float(lon))
        sign_idx = int(norm / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
        return sign_idx, norm % float(chart.Chart.SIGN_DEG)

    def _minute_label(deg_in_sign: float) -> str:
        d, m, _s = util.decToDeg(deg_in_sign)
        return "%s°%02d'" % (str(d).rjust(2), m)

    signs = _signs(options)

    # Body collection mirrors StripWnd.arrange (stripwnd.py:417-461): visible
    # planets (intables gates for transcendentals + nodes, stripwnd.py:418),
    # Chiron when visible (stripwnd.py:428), Lot of Fortune unless hidden
    # (stripwnd.py:437), optional Vertex (stripwnd.py:445), then Asc + MC
    # (stripwnd.py:454, houses.Houses.MC+1 => indices 0..1).
    entries: list[tuple[int, float, str, str, str, str | None, str | None]] = []
    # tuple: (sign_idx, deg_in_sign, glyph, font, label, colorHex, colorRole)

    def _push(planet_id_for_color: int, lon: float, glyph: str, font: str, label: str,
              *, color_id: int | None = None, is_fortune: bool = False) -> None:
        sign_idx, deg = _within_sign(lon)
        color = None
        color_role = None
        cid = planet_id_for_color if color_id is None else color_id
        if cid is not None and cid >= 0:
            color = _planet_color(cid, chrt, options)
            color_role = (
                _fortune_color_role(chrt, options, color)
                if is_fortune
                else _planet_color_role(cid, chrt, options, color)
            )
        entries.append((sign_idx, deg, glyph, font, label, color, color_role))

    for i in range(planets.Planets.PLANETS_NUM - 1):
        if getattr(options, "intables", False) and (
            (i == astrology.SE_URANUS and not options.transcendental[chart.Chart.TRANSURANUS]) or
            (i == astrology.SE_NEPTUNE and not options.transcendental[chart.Chart.TRANSNEPTUNE]) or
            (i == astrology.SE_PLUTO and not options.transcendental[chart.Chart.TRANSPLUTO]) or
            (i == astrology.SE_MEAN_NODE and not options.shownodes)
        ):
            continue
        body = chrt.planets.planets[i]
        _push(i, body.data[planets.Planet.LONG], common.common.Planets[i], "morinus",
              common.common.get_planet_name(i))

    if getattr(chrt, "chiron", None) is not None and common.common.is_planet_visible(options, astrology.SE_CHIRON):
        _push(astrology.SE_CHIRON, chrt.chiron.data[planets.Planet.LONG],
              common.common.get_planet_glyph(astrology.SE_CHIRON), "morinus",
              common.common.get_planet_name(astrology.SE_CHIRON))

    if not getattr(options, "intables", False) or getattr(options, "showlof", True):
        _push(planets.Planets.PLANETS_NUM - 1, chrt.fortune.fortune[fortune.Fortune.LON],
              common.common.fortune, "morinus", _txt("StripLoF", "Lot of Fortune"),
              is_fortune=True)

    if getattr(options, "showvertex", False):
        _push(common.CHART_OBJECT_VERTEX, chrt.houses.ascmc[houses.Houses.VERTEX],
              common.common.get_planet_glyph(common.CHART_OBJECT_VERTEX), "morinus",
              _txt("Vertex", "Vertex"))

    # Asc / MC: wx draws text glyphs (StripAsc/StripMC, stripwnd.py:195-200) and
    # gives them the default black color (no per-planet entry). We keep them
    # uncolored (color_id=-1) so they render in the theme text color.
    _push(-1, chrt.houses.ascmc[houses.Houses.ASC], _txt("StripAsc", "A"), "text",
          _txt("Asc", "Asc"), color_id=-1)
    _push(-1, chrt.houses.ascmc[houses.Houses.MC], _txt("StripMC", "M"), "text",
          _txt("MC", "MC"), color_id=-1)

    # Group by occupied sign, in zodiac order, sorted within each sign by degree.
    by_sign: dict[int, list[tuple[int, float, str, str, str, str | None, str | None]]] = {}
    for entry in entries:
        by_sign.setdefault(entry[0], []).append(entry)

    strip_signs: list[dict[str, Any]] = []
    for sign_idx in sorted(by_sign):
        bucket = sorted(by_sign[sign_idx], key=lambda e: e[1])
        bodies = []
        for _s, deg, glyph, font, label, color, color_role in bucket:
            body_entry: dict[str, Any] = {
                "glyph": glyph,
                "glyphFont": font,
                "label": label,
                "degree": round(deg, 6),
                "minuteLabel": _minute_label(deg),
            }
            _set_semantic_color(
                body_entry,
                color,
                color_role,
                color_key="colorHex",
            )
            bodies.append(body_entry)
        strip_signs.append({
            "signId": sign_idx,
            "signGlyph": signs[sign_idx] if 0 <= sign_idx < len(signs) else "",
            "bodies": bodies,
        })

    # Flat fallback for TSV/copy/JSON: body, sign, degree-in-sign (sorted by the
    # within-sign degree, matching pdf_export_spec intent, stripwnd.py:228-292).
    cols = [
        _column("body", _txt("Bodies", "Body"), align="center", kind="glyph"),
        _column("sign", _txt("Sign", "Sign"), align="center", kind="glyph"),
        _column("degree", _txt("Strip", "Position in sign"), align="right"),
    ]
    flat: list[Row] = []
    for sign in strip_signs:
        sign_glyph = sign["signGlyph"]
        for body in sign["bodies"]:
            glyph_cell = _glyph(body["glyph"]) if body["glyphFont"] == "morinus" else _text(body["glyph"], align="center")
            _set_semantic_color(
                glyph_cell,
                body.get("colorHex"),
                body.get("colorRole"),
            )
            flat.append(_row(f"{sign['signId']}:{body['label']}", [
                glyph_cell,
                _sign_cell(options, int(sign["signId"])),
                _text(body["minuteLabel"], align="right"),
            ]))

    payload = _base_payload("strip", chrt, options, cols, flat or _empty(_txt("NoBodies", "No bodies")),
                            title=_txt("Strip", "30° Strip"), source=source)
    payload["strip"] = {"signs": strip_signs}
    payload["capabilities"] = {**payload.get("capabilities", {}), "strip": True, "sorting": False}
    return payload


def _sidereal_lon_cell(value: float, options) -> Cell:
    # Longitude cell for points whose longitude is ALREADY in the chart's chosen
    # zodiac (no further ayanamsha rebase). DodecatemoriaWnd.drawline renders the
    # dodecatemoria longitude raw — antiscia.calcDodecatemoria already
    # siderealized it, so the wx draw applies NO ayanamsha (dodecatemoriawnd.py:
    # 347-362, comment 349-350). Degree-in-sign + sign glyph, like every lon cell.
    try:
        lon = util.normalize(float(value))
        d, m, _s = util.decToDeg(lon)
        sign_idx = int(d / chart.Chart.SIGN_DEG)
        pos = int(d % chart.Chart.SIGN_DEG)
        signs = _signs(options)
        sign = signs[sign_idx] if 0 <= sign_idx < len(signs) else ""
        return {
            "runs": [
                {"text": "%s°%02d' " % (str(pos).rjust(2), m), "glyph": False},
                _sign_run(options, sign_idx, sign),
            ],
        }
    except Exception:
        return _text("-")


def _dodecatemoria(chrt, options) -> dict[str, Any]:
    # Standalone Dodecatemoria table — port of DodecatemoriaWnd
    # (dodecatemoriawnd.py:152-372). Rows: 12 planets + Lot of Fortune + Asc + MC.
    # Columns: Body (glyph) | Dodecatemorion longitude (sign glyph) | Latitude.
    # Data comes from chrt.antiscia.pldodecatemoria[].lon, .lofdodec, .ascmcdodec.
    source = "morin.py:14244,14632,17585-17599; dodecatemoriawnd.py:17-372; antiscia.py:69-153"
    ants = getattr(chrt, "antiscia", None)
    if ants is None or not getattr(ants, "pldodecatemoria", None):
        return _unavailable(
            "dodecatemoria",
            chrt,
            title=_txt("Dodecatemorion", "Dodecatemoria"),
            source=source,
            reason=_txt("DodecatemoriaUnavailable", "Dodecatemoria data unavailable for this chart."),
        )
    cols = [
        _column("body", _txt("Bodies", "Body"), align="center", kind="glyph"),
        _column("dodec", _txt("Dodecatemorion", "Dodecatemorion"), align="center", kind="glyph"),
        _column("lat", _txt("Latitude", "Latitude"), align="center"),
    ]

    # DodecatemoriaWnd.drawline maps row index -> object glyph + colour
    # (dodecatemoriawnd.py:153,316-339): planets 0..11 use the dignity/individual
    # palette via Chart.dignity; Fortune uses the fortune glyph (peregrine fallback
    # has no special colour in wx — it draws clrtexts); Asc/MC use clrtexts.
    def _planet_dodec_color(planet_id: int) -> str | None:
        # objidx clamp mirrors dodecatemoriawnd.py:323-329 (>= len(Planets)-1 -> -1)
        try:
            objidx = int(planet_id)
            if objidx >= len(common.common.Planets) - 1:
                objidx -= 1
            if getattr(options, "useplanetcolors", False):
                return _rgb_hex(options.clrindividual[objidx])
            palette = (
                getattr(options, "clrdomicil", None),
                getattr(options, "clrexal", None),
                getattr(options, "clrperegrin", None),
                getattr(options, "clrcasus", None),
                getattr(options, "clrexil", None),
            )
            return _rgb_hex(palette[chrt.dignity(objidx)])
        except Exception:
            return _rgb_hex(getattr(options, "clrperegrin", None))

    rows: list[Row] = []
    # 12 planets (Sun..Pluto, Node, Node) — wx draws Planets[0..11] which is
    # SE_SUN..SE_TRUE_NODE (dodecatemoriawnd.py:153).
    for j in range(12):
        # intables visibility gate (dodecatemoriawnd.py:166-167).
        if getattr(options, "intables", False):
            if (
                (j == astrology.SE_URANUS and not options.transcendental[chart.Chart.TRANSURANUS])
                or (j == astrology.SE_NEPTUNE and not options.transcendental[chart.Chart.TRANSNEPTUNE])
                or (j == astrology.SE_PLUTO and not options.transcendental[chart.Chart.TRANSPLUTO])
                or (j == astrology.SE_MEAN_NODE and not options.shownodes)
                or (j == astrology.SE_TRUE_NODE and not options.shownodes)
            ):
                continue
        try:
            point = ants.pldodecatemoria[j]
        except Exception:
            continue
        lon = getattr(point, "lon", 0.0)
        lat = getattr(point, "lat", 0.0) if j in (10, 11) else 0.0
        body_cell = _glyph(common.common.Planets[j])
        color = _planet_dodec_color(j)
        role_body_id = j - 1 if j >= len(common.common.Planets) - 1 else j
        _set_semantic_color(
            body_cell,
            color,
            _planet_color_role(role_body_id, chrt, options, color),
        )
        body_cell["planet"] = j
        rows.append(_row(f"planet:{j}", [
            body_cell,
            _sidereal_lon_cell(lon, options),
            _text(_dms(lat, signed=True)),
        ]))

    # Lot of Fortune (dodecatemoriawnd.py:153 fortune glyph, j==12, lofdodec).
    if not getattr(options, "intables", False) or getattr(options, "showlof", True):
        lof = getattr(ants, "lofdodec", None)
        if lof is not None:
            rows.append(_row("fortune", [
                _glyph(common.common.fortune),
                _sidereal_lon_cell(getattr(lof, "lon", 0.0), options),
                _text(_dms(getattr(lof, "lat", 0.0), signed=True)),
            ]))

    # Asc / MC (dodecatemoriawnd.py:153 '0'/'1' -> ascmcdodec[0]/[1], AscMC=True
    # uses clrtexts and the larger symbol font; labels are the Asc/MC text).
    ascmc = getattr(ants, "ascmcdodec", None) or []
    ascmc_labels = (_txt("Asc", "Asc"), _txt("MC", "MC"))
    for k in range(min(2, len(ascmc))):
        pt = ascmc[k]
        rows.append(_row(f"ascmc:{k}", [
            _text(ascmc_labels[k], align="center"),
            _sidereal_lon_cell(getattr(pt, "lon", 0.0), options),
            _text(_dms(getattr(pt, "lat", 0.0), signed=True)),
        ]))

    payload = _base_payload(
        "dodecatemoria", chrt, options, cols, rows or _empty(),
        title=_txt("Dodecatemorion", "Dodecatemoria"), source=source,
    )
    payload["capabilities"] = {**payload.get("capabilities", {}), "sorting": False}
    return payload


# Placidian speculum field labels in CustomerPD index order
# (customerwnd.py:157, CustomerPD.LONG..AODO; horizontal AZM/ELV at 14/15 are
# computed but wx draws only the 14 classical fields — speculums option has 14
# slots for placidian). Each label keys mtexts.txts.
_USER_SPECULUM_PLACIDIAN_FIELDS = (
    ("Longitude", customerpd.CustomerPD.LONG),
    ("Latitude", customerpd.CustomerPD.LAT),
    ("Rectascension", customerpd.CustomerPD.RA),
    ("Declination", customerpd.CustomerPD.DECL),
    ("AscDiffLat", customerpd.CustomerPD.ADLAT),
    ("Semiarcus", customerpd.CustomerPD.SA),
    ("Meridiandist", customerpd.CustomerPD.MD),
    ("Horizondist", customerpd.CustomerPD.HD),
    ("TemporalHour", customerpd.CustomerPD.TH),
    ("HourlyDist", customerpd.CustomerPD.HOD),
    ("PMP", customerpd.CustomerPD.PMP),
    ("AscDiffPole", customerpd.CustomerPD.ADPH),
    ("PoleHeight", customerpd.CustomerPD.POH),
    ("AODO", customerpd.CustomerPD.AODO),
)

# Regiomontanian/Campanian speculum field labels (customerwnd.py:249).
_USER_SPECULUM_REGIO_FIELDS = (
    ("Longitude", customerpd.CustomerPD.LONG),
    ("Latitude", customerpd.CustomerPD.LAT),
    ("Rectascension", customerpd.CustomerPD.RA),
    ("Declination", customerpd.CustomerPD.DECL),
    ("Meridiandist", customerpd.CustomerPD.RMD),
    ("Horizondist", customerpd.CustomerPD.RHD),
    ("ZD", customerpd.CustomerPD.ZD),
    ("Pole", customerpd.CustomerPD.POLE),
    ("Q", customerpd.CustomerPD.Q),
    ("WReg", customerpd.CustomerPD.W),
    ("CMP", customerpd.CustomerPD.CMP),
    ("RMP", customerpd.CustomerPD.RMP),
    ("AZM", customerpd.CustomerPD.AZM),
    ("ELV", customerpd.CustomerPD.ELV),
)


def _user_speculum_value_cell(field_idx: int, value: float, chrt, options, *, regio: bool) -> Cell:
    # Faithful port of CustomerWnd.drawplacidian / drawregiomontan value
    # formatting (customerwnd.py:171-231 / 266-331). The same field index drives
    # the format branch in both apps.
    CPD = customerpd.CustomerPD
    if field_idx == CPD.LONG:
        # Longitude: degree-in-sign + sign glyph, ayanamsha rebased
        # (customerwnd.py:174-190 / 269-285).
        return _lon_cell(value, chrt, options)
    if not regio and field_idx in (CPD.LAT, CPD.DECL, CPD.ADLAT):
        return _text(_dms(value, signed=True))
    if regio and field_idx in (CPD.LAT, CPD.DECL, CPD.Q, CPD.ELV):
        return _text(_dms(value, signed=True))
    # RA: in-time HH:MM:SS or 3-digit degrees (customerwnd.py:199-206 / 297-313).
    if field_idx == CPD.RA:
        return _text(_ra(value, options))
    # Placidian sign-coded magnitudes: SA(D/N), MD(M/I), HD(A/D), TH(D/N),
    # HOD(D/N), AODO(A/D) (customerwnd.py:210-228).
    if not regio and field_idx in (CPD.SA, CPD.MD, CPD.HD, CPD.TH, CPD.HOD, CPD.AODO):
        if field_idx in (CPD.SA, CPD.TH, CPD.HOD):
            prefix = "N" if value < 0.0 else "D"
        elif field_idx == CPD.MD:
            prefix = "I" if value < 0.0 else "M"
        else:  # HD, AODO
            prefix = "D" if value < 0.0 else "A"
        return _text(prefix + _dms(value, signed=False))
    # Regio ZD carries a Z/N prefix (customerwnd.py:302-305); RMD M/I, RHD A/D
    # (customerwnd.py:317-326).
    if regio and field_idx == CPD.ZD:
        prefix = "N" if value < 0.0 else "Z"
        return _text(prefix + _dms(value, signed=False))
    if regio and field_idx == CPD.RMD:
        prefix = "I" if value < 0.0 else "M"
        return _text(prefix + _dms(value, signed=False))
    if regio and field_idx == CPD.RHD:
        prefix = "D" if value < 0.0 else "A"
        return _text(prefix + _dms(value, signed=False))
    return _text(_dms(value, signed=False))


def _user_speculum(chrt, options) -> dict[str, Any]:
    # Port of CustomerWnd (customerwnd.py:17-341) opened via onCustomerSpeculum
    # (morin.py:17537-17562). A 2-column field/value table over the user-defined
    # PD point chrt.cpd (or cpd2), showing only the speculum fields the user has
    # enabled in options.speculums[speculum]. The speculum index (0 Placidian /
    # 1 Regiomontanian) follows options.primarydir (customerwnd.py:28-30).
    source = "morin.py:14289,14634,17537-17562; customerwnd.py:17-341; customerpd.py:7-455; chart.py:603-606"
    speculum = 0
    if getattr(options, "primarydir", None) in (
        primdirs.PrimDirs.REGIOMONTAN, primdirs.PrimDirs.CAMPANIAN,
    ):
        speculum = 1
    selected = list(getattr(options, "speculums", [[True] * 14, [True] * 14])[speculum])
    # onCustomerSpeculum gate: at least one speculum column must be selected
    # (morin.py:17546,17559-17562).
    if True not in selected:
        return _unavailable(
            "user_speculum", chrt,
            title=_txt("Cpt", "User Speculum"), source=source,
            reason=_txt("SelectColumn", "Select column"),
        )
    # The user point: cpd preferred, else cpd2 (morin.py:17547-17558). When
    # neither is defined (options.pdcustomer/pdcustomer2 off), wx shows CheckUser.
    cpt = getattr(chrt, "cpd", None)
    if cpt is None:
        cpt = getattr(chrt, "cpd2", None)
    if cpt is None:
        return _unavailable(
            "user_speculum", chrt,
            title=_txt("Cpt", "User Speculum"), source=source,
            reason=_txt("CheckUser", "Define a user PD point first."),
        )
    regio = speculum == 1
    field_defs = _USER_SPECULUM_REGIO_FIELDS if regio else _USER_SPECULUM_PLACIDIAN_FIELDS
    cols = [
        _column("field", _txt("Cpt", "User Speculum"), align="left"),
        _column("value", _txt("Value", "Value"), align="center", kind="glyph"),
    ]
    try:
        speculum_values = cpt.speculums[speculum]
    except Exception:
        speculum_values = ()
    rows: list[Row] = []
    for i, (label_key, field_idx) in enumerate(field_defs):
        if i >= len(selected) or not selected[i]:
            continue
        try:
            value = speculum_values[field_idx]
        except Exception:
            value = 0.0
        rows.append(_row(f"field:{i}", [
            _text(_txt(label_key, label_key)),
            _user_speculum_value_cell(field_idx, value, chrt, options, regio=regio),
        ]))

    payload = _base_payload(
        "user_speculum", chrt, options, cols, rows or _empty(),
        title=_txt("Cpt", "User Speculum"), source=source,
        notes=[_txt("SpeculumNote", "Speculum: %s") % ("Regiomontanian/Campanian" if regio else "Placidian")],
    )
    payload["capabilities"] = {**payload.get("capabilities", {}), "sorting": False}
    return payload


# Aspect name keys (mtexts) in chart.Chart aspect-index order, used by the
# monthly-transit label/aspect cell (transitmwnd.py:249-254).
_TRANSIT_ASPECT_KEYS = (
    "Conjunctio", "Semisextil", "Semiquadrat", "Sextil", "Quintile",
    "Quadrat", "Trigon", "Sesquiquadrat", "Biquintile", "Quinqunx", "Oppositio",
)


def _transit_planet_color(planet_id: int, chrt, options, *, target: bool) -> str | None:
    # Transiting planet colour (transitmwnd.py:510-515): useplanetcolors ->
    # clrindividual[color_index]; else clrperegrin. Target planet colour
    # (transitmwnd.py:587-596): useplanetcolors -> clrindividual[color_index];
    # else Chiron->clrperegrin, otherwise the dignity palette via Chart.dignity.
    try:
        if getattr(options, "useplanetcolors", False):
            idx = common.common.get_planet_color_index(int(planet_id))
            return _rgb_hex(options.clrindividual[idx])
        if not target:
            return _rgb_hex(getattr(options, "clrperegrin", None))
        if int(planet_id) == astrology.SE_CHIRON:
            return _rgb_hex(getattr(options, "clrperegrin", None))
        palette = (
            getattr(options, "clrdomicil", None),
            getattr(options, "clrexal", None),
            getattr(options, "clrperegrin", None),
            getattr(options, "clrcasus", None),
            getattr(options, "clrexil", None),
        )
        return _rgb_hex(palette[chrt.dignity(int(planet_id))])
    except Exception:
        return _rgb_hex(getattr(options, "clrperegrin", None))


def _transit_is_hidden(tr, options) -> bool:
    # Port of TransitMonthWnd._transit_is_hidden (transitmwnd.py:131-139).
    if getattr(options, "intables", False):
        for body, flag in (
            (astrology.SE_URANUS, chart.Chart.TRANSURANUS),
            (astrology.SE_NEPTUNE, chart.Chart.TRANSNEPTUNE),
            (astrology.SE_PLUTO, chart.Chart.TRANSPLUTO),
        ):
            if not options.transcendental[flag] and tr.objtype != transits.Transit.SIGN and (tr.plt == body or tr.obj == body):
                return True
    if not getattr(options, "showchiron", True):
        if tr.objtype != transits.Transit.SIGN and (tr.plt == astrology.SE_CHIRON or tr.obj == astrology.SE_CHIRON):
            return True
    return False


def _transit_cell(tr, chrt, options) -> Cell:
    # Port of TransitMonthWnd.drawline transit-cell composition
    # (transitmwnd.py:508-659). Each objtype yields a different run sequence of
    # planet glyph + aspect glyph + target. Glyph runs carry per-run colour.
    runs: list[dict[str, Any]] = []
    plt = int(tr.plt)
    aspect_color = None
    plt_run = {"text": common.common.get_planet_glyph(plt), "glyph": True, "planet": plt}
    c = _transit_planet_color(plt, chrt, options, target=False)
    _set_semantic_color(plt_run, c, _planet_color_role(plt, chrt, options, c))
    runs.append(plt_run)

    def _aspect_run(aspect_idx: int) -> dict[str, Any]:
        run = {"text": common.common.Aspects[aspect_idx], "glyph": True}
        try:
            col = _rgb_hex(options.clraspect[aspect_idx])
        except Exception:
            col = None
        _set_semantic_color(
            run,
            col,
            aspect_color_role(options, aspect_idx, resolved_color=col),
        )
        return run

    def _target_planet_run(target_id: int) -> dict[str, Any]:
        run = {"text": common.common.get_planet_glyph(int(target_id)), "glyph": True, "planet": int(target_id)}
        col = _transit_planet_color(int(target_id), chrt, options, target=True)
        _set_semantic_color(
            run,
            col,
            _planet_color_role(int(target_id), chrt, options, col),
        )
        return run

    objtype = tr.objtype
    signs = _signs(options)
    rs = ("R", "S")
    if objtype == transits.Transit.ASCMC:
        runs.append(_aspect_run(tr.aspect))
        ascmc_labels = (_txt("Asc", "Asc"), _txt("MC", "MC"))
        runs.append({"text": " " + ascmc_labels[tr.obj] if False else ascmc_labels[tr.obj], "glyph": False})
    elif objtype == transits.Transit.SIGN:
        # Left/right sign indices precomputed in transits.py (sign_left/right);
        # fallback mirrors transitmwnd.py:546-557.
        s_left = getattr(tr, "sign_left", chart.Chart.NONE)
        s_right = getattr(tr, "sign_right", chart.Chart.NONE)
        if s_left == chart.Chart.NONE or s_right == chart.Chart.NONE:
            s2 = tr.obj
            s_left = (s2 + 11) % 12
            s_right = s2
            if getattr(tr, "pltretr", 0):
                s_left = (s2 + 1) % 12
                s_right = s2
        runs.append(_sign_run(options, int(s_left), signs[s_left]))
        runs.append({"text": "|", "glyph": False})
        runs.append(_sign_run(options, int(s_right), signs[s_right]))
    elif objtype == transits.Transit.PLANET:
        runs.append(_aspect_run(tr.aspect))
        runs.append(_target_planet_run(tr.obj))
        if tr.objretr != transits.Transits.NONE:
            runs.append({"text": rs[tr.objretr], "glyph": False})
    elif objtype in (transits.Transit.ANTISCION, transits.Transit.CONTRAANTISCION):
        runs.append(_aspect_run(tr.aspect))
        anti = "CA" if objtype == transits.Transit.CONTRAANTISCION else "A"
        runs.append({"text": anti + " ", "glyph": False})
        runs.append(_target_planet_run(tr.obj))
        if tr.objretr != transits.Transits.NONE:
            runs.append({"text": rs[tr.objretr], "glyph": False})
    elif objtype == transits.Transit.LOF:
        runs.append(_aspect_run(tr.aspect))
        lof_run = {"text": common.common.fortune, "glyph": True}
        lof_color = None
        try:
            if getattr(options, "useplanetcolors", False):
                lof_color = _rgb_hex(options.clrindividual[planets.Planets.PLANETS_NUM - 1])
            else:
                lof_color = _rgb_hex(getattr(options, "clrperegrin", None))
        except Exception:
            pass
        _set_semantic_color(
            lof_run,
            lof_color,
            _fortune_color_role(chrt, options, lof_color),
        )
        runs.append(lof_run)
    return {"runs": runs, "align": "left"}


def _monthly_transits(chrt, options, binding: dict[str, Any] | None = None, *, current_datetime: Any = None) -> dict[str, Any]:
    # Port of the Exact (Monthly) Transits table — onExactTransits
    # (morin.py:17314-17332) + _build_exact_transits_month_rows (morin.py:
    # 16790-16793) + TransitMonthWnd (transitmwnd.py:17-666). Brain computes the
    # transit events for one (year, month) via transits.Transits().month().
    # Columns: Day | default-location civil time | Transit | House.  The exact
    # event tuple and row-action context remain Greenwich/UT.
    source = "morin.py:14293,14622,16790-16793,17314-17332; transits.py:36-401; transitmwnd.py:17-666; transitmframe.py:7-13"
    if getattr(getattr(chrt, "time", None), "bc", False):
        return _unavailable(
            "monthly_transits", chrt,
            title=_txt("Transits", "Monthly Transits"), source=source,
            reason=_txt("NotAvailable", "Not available for BC charts."),
        )
    binding = dict(binding or {})
    # Anchor: binding (year, month) if supplied; else the wall clock, mirroring
    # onCurrentMonth / _exact_transits_reference_datetime defaults
    # (transitmwnd.py:151-153).
    now = datetime.datetime.now()
    try:
        year = int(binding.get("year"))
    except Exception:
        year = now.year
    try:
        month = int(binding.get("month"))
    except Exception:
        month = now.month
    month = max(1, min(12, month))

    display_clock = table_event_clock(options)
    month_start = datetime.date(year, month, 1)
    if month == 12:
        next_month_start = datetime.date(year + 1, 1, 1)
    else:
        next_month_start = datetime.date(year, month + 1, 1)
    month_end = next_month_start - datetime.timedelta(days=1)
    display_offsets = display_clock.offsets_for_range(month_start, month_end)

    source_months = [(year, month)]
    # A positive offset pulls late events from the previous UT month into this
    # local month; a negative offset pulls early events from the next UT month.
    # Load only the needed neighbor, then filter by converted local year/month.
    if any(offset > 0 for offset in display_offsets):
        source_months.insert(0, (year - 1, 12) if month == 1 else (year, month - 1))
    if any(offset < 0 for offset in display_offsets):
        source_months.append((year + 1, 1) if month == 12 else (year, month + 1))

    trans: list[tuple[int, int, Any]] = []
    for source_year, source_month in source_months:
        engine = transits.Transits()
        engine.month(source_year, source_month, chrt)
        trans.extend(
            (source_year, source_month, event)
            for event in list(getattr(engine, "transits", []) or [])
        )
    trans.sort(
        key=lambda item: (
            item[0],
            item[1],
            int(getattr(item[2], "day", 0) or 0),
            float(getattr(item[2], "time", 0.0) or 0.0),
        )
    )

    time_display = display_clock.metadata(
        _txt("Time", "Time"),
        offsets=display_offsets,
    )

    cols = [
        _column("day", _txt("Day", "Day"), align="center"),
        _column("time", time_display["columnLabel"], align="center"),
        _column("transit", _txt("Transit", "Transit"), align="left", kind="glyph"),
        _column("house", _txt("House", "House"), align="center"),
    ]
    rows: list[Row] = []
    for source_year, source_month, tr in trans:
        if _transit_is_hidden(tr, options):
            continue
        try:
            day = int(tr.day)
            h, mi, s = util.decToDeg(tr.time)
            utc_tuple = (source_year, source_month, day, int(h), int(mi), int(s))
            display = display_clock.display(utc_tuple)
        except Exception:
            continue
        if display.values[0] != year or display.values[1] != month:
            continue
        time_txt = "%02d:%02d:%02d" % display.values[3:6]
        try:
            house_txt = common.common.Housenames[tr.house]
        except Exception:
            house_txt = ""
        event_iso = None
        try:
            event_iso = datetime.datetime(*utc_tuple).isoformat()
        except Exception:
            event_iso = None
        meta = {
            "eventDate": "%04d-%02d-%02d" % utc_tuple[:3],
            "eventDatetime": event_iso,
            "displayDatetime": display.iso,
            "displayDate": "%04d-%02d-%02d" % display.values[:3],
            "displayTime": display.time_text,
            "displayUtcOffsetMinutes": display.utc_offset_minutes,
            # GMT/Greenwich frame, mirroring the wx open_as_transit/chart
            # time_context (transitmwnd.py:318-326,337-345).
            "timeContext": {
                "zt": chart.Time.GREENWICH, "plus": True, "zh": 0, "zm": 0,
                "daylightsaving": False, "tzid": "", "tzauto": False,
            },
            "rowActions": ["open_transit_for_date", "open_chart_for_date"],
        }
        rows.append(_row(
            "transit:%04d-%02d-%02dT%02d:%02d:%02d:%d" % (*utc_tuple, len(rows)),
            [
                _text(str(display.values[2]), align="center"),
                _text(time_txt, align="center"),
                _transit_cell(tr, chrt, options),
                _text(house_txt, align="center"),
            ],
            meta=meta,
        ))

    month_name = common.common.months[month - 1]
    title = "%s %s" % (
        _txt("Transits", "Transits"),
        dateformat.month_year_text(year, month_name, options, pad_year=False),
    )
    payload = _base_payload(
        "monthly_transits", chrt, options, cols,
        rows or _empty(_txt("NoTransits", "No transits this month")),
        title=title, source=source,
    )
    payload["capabilities"] = {
        **payload.get("capabilities", {}),
        "sorting": False,
        "monthlyTransits": {
            "year": year,
            "month": month,
            "frame": "default_location",
        },
        "timeDisplay": time_display,
        "rowActions": [
            {"id": "open_transit_for_date", "deferred": False},
            {"id": "open_chart_for_date", "deferred": False},
        ],
    }
    return payload


# PrimDirs range tokens -> RANGE constants (primdirsrangedlg radio set,
# morin.py:17653-17661); the angle-dirs handler reuses the PD range popup.
_FIXSTAR_DIRS_RANGE_TOKENS = {
    "25": primdirs.PrimDirs.RANGE25,
    "50": primdirs.PrimDirs.RANGE50,
    "75": primdirs.PrimDirs.RANGE75,
    "100": primdirs.PrimDirs.RANGE100,
    "all": primdirs.PrimDirs.RANGEALL,
}
_FIXSTAR_DIRS_DIRECTION_TOKENS = {
    "direct": primdirs.PrimDirs.DIRECT,
    "converse": primdirs.PrimDirs.CONVERSE,
    "both": primdirs.PrimDirs.BOTHDC,
}


def _fixstar_dirs_age_range(range_token: str) -> tuple[float, float]:
    # Map the PD range constant to a (lo_age, hi_age) window. compute_fixedstar_
    # angle_rows takes (lo, hi) in years; RANGE25/50/75/100 cap the upper age,
    # RANGEALL spans 0..LIMIT (fixstardirs.py:858-862; primdirs range semantics).
    limit = float(getattr(primdirs.PrimDirs, "LIMIT", 100.0))
    caps = {"25": 25.0, "50": 50.0, "75": 75.0, "100": 100.0}
    hi = caps.get(range_token, limit)
    return (0.0, min(hi, limit))


def _fixedstar_angle_directions(chrt, options, binding: dict[str, Any] | None = None) -> dict[str, Any]:
    # Port of the Angular Directions of Fixed Stars table — onFixStarAngleDirs
    # (morin.py:17628-17675) + FixedStarDirsFrame (fixstardirsframe.py) over the
    # wx-free brain fixstardirs.compute_fixedstar_angle_rows. Columns:
    # Age | Prom (star) | D/C | Sig (angle) | Arc | Date.
    source = "morin.py:14287,14641,17628-17675; fixstardirs.py:846-983; fixstardirsframe.py:1-60"
    if getattr(getattr(chrt, "time", None), "bc", False):
        return _unavailable(
            "fixedstar_angle_directions", chrt,
            title=_txt("TMFixStarAngleDirs", "Angular Directions of Fixed Stars"),
            source=source,
            reason=_txt("NotAvailable", "Not available for BC charts."),
        )
    binding = dict(binding or {})
    range_token = str(binding.get("range") or "all").strip().lower()
    if range_token not in _FIXSTAR_DIRS_RANGE_TOKENS:
        range_token = "all"
    direction_token = str(binding.get("direction") or "both").strip().lower()
    if direction_token not in _FIXSTAR_DIRS_DIRECTION_TOKENS:
        direction_token = "both"
    age_range = _fixstar_dirs_age_range(range_token)
    direction = _FIXSTAR_DIRS_DIRECTION_TOKENS[direction_token]

    try:
        rows_raw = fixstardirs.compute_fixedstar_angle_rows(
            chrt, options, age_range=age_range, direction=direction,
        )
    except Exception as exc:
        return _unavailable(
            "fixedstar_angle_directions", chrt,
            title=_txt("TMFixStarAngleDirs", "Angular Directions of Fixed Stars"),
            source=source,
            reason=_txt("FixedStarAngleDirsUnavailable", "Fixed-star angle directions unavailable: %s") % exc,
        )
    if not rows_raw:
        return _unavailable(
            "fixedstar_angle_directions", chrt,
            title=_txt("TMFixStarAngleDirs", "Angular Directions of Fixed Stars"),
            source=source,
            reason=_txt("NoSelFixStars", "No selected fixed stars."),
        )

    cols = [
        _column("age", _txt("Age", "Age"), align="right"),
        _column("prom", _txt("Promissor", "Promissor"), align="left"),
        _column("dc", _txt("DC", "D/C"), align="center"),
        _column("sig", _txt("Significator", "Significator"), align="center"),
        _column("arc", _txt("Arc", "Arc"), align="right"),
        _column("date", _txt("Date", "Date"), align="center"),
    ]
    angle_labels = {
        "ASC": _txt("Asc", "Asc"), "DSC": _txt("Dsc", "Dsc"),
        "MC": _txt("MC", "MC"), "IC": _txt("IC", "IC"),
    }
    rows: list[Row] = []
    for i, r in enumerate(rows_raw):
        arc = float(r.get("arc", 0.0))
        age_years = fixstardirs.arc_to_age_years_naibod(arc)
        sig = str(r.get("sig", ""))
        dc = str(r.get("dc", ""))
        rows.append(_row(
            f"fsd:{i}",
            [
                _text("%.1f" % age_years, align="right"),
                _text(str(r.get("prom", "")), align="left"),
                _text(dc, align="center"),
                _text(angle_labels.get(sig, sig), align="center"),
                _text(_dms(arc, signed=False, sec=False), align="right"),
                _text(str(r.get("date", "")), align="center"),
            ],
            meta={"jd": float(r.get("jd", 0.0)), "dc": dc, "sig": sig},
        ))

    payload = _base_payload(
        "fixedstar_angle_directions", chrt, options, cols, rows or _empty(),
        title=_txt("TMFixStarAngleDirs", "Angular Directions of Fixed Stars"),
        source=source,
        notes=[_txt("DirRangeNote", "Range: %s") % range_token, _txt("DirDirectionNote", "Direction: %s") % direction_token],
    )
    payload["capabilities"] = {
        **payload.get("capabilities", {}),
        "sorting": True,
        "bindings": {"range": range_token, "direction": direction_token},
        "bindingOptions": {
            "range": [{"value": t, "label": t.upper()} for t in ("25", "50", "75", "100", "all")],
            "direction": [
                {"value": "direct", "label": _txt("Direct", "Direct")},
                {"value": "converse", "label": _txt("Converse", "Converse")},
                {"value": "both", "label": _txt("BothDirections", "Both")},
            ],
        },
    }
    return payload


def _lunar_mansions(chrt, options) -> dict[str, Any]:
    """Academic 28-mansion reference with the chart Moon's current row."""
    mode = getattr(options, "manazil_zodiac", manazil.ZODIAC_AUTO)
    ayan = float(
        getattr(chrt, "ayanamsha_offset", 0.0)
        or getattr(chrt, "ayanamsha", 0.0)
        or 0.0
    )
    try:
        jd = float(chrt.time.jd)
    except (AttributeError, TypeError, ValueError):
        jd = 0.0
    moon = chrt.get_planet_body(astrology.SE_MOON)
    moon_lon = float(moon.data[planets.Planet.LONG]) if moon is not None else 0.0
    frame_lon = manazil.resolve_chart_lon(
        moon_lon,
        mode,
        ayan,
        jd,
        getattr(options, "ayanamsha", 0) != 0,
    )
    current_index, _degree_in, _entry = manazil.mansion_of(frame_lon)

    columns = [
        _column("number", "#", align="right"),
        _column("arabic", _txt("Arabic", "Arabic"), align="right"),
        _column("transliteration", _txt("Transliteration", "Transliteration")),
        _column("start", "Start", align="center", kind="glyph"),
        _column("stars", _txt("StellarIndicators", "Stellar indicators")),
    ]
    rows: list[Row] = []
    for entry in manazil.MANAZIL:
        index = int(entry["index"])
        start = index * manazil.MANZIL_WIDTH
        degrees, minutes, _seconds = util.decToDeg(start)
        sign_index = int(degrees // chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
        start_cell: Cell = {
            "runs": [
                {"text": "%d°%02d' " % (degrees % chart.Chart.SIGN_DEG, minutes), "glyph": False},
                _sign_run(options, sign_index),
            ],
            "sortValue": start,
        }
        row = _row(
            "manzil:%d" % (index + 1),
            [
                _text(index + 1, align="right", sort_value=index + 1),
                _text(entry["name_ar"], align="right", font_role="arabic", direction="rtl"),
                _text(entry["name_translit"]),
                start_cell,
                _text(entry["star"]),
            ],
            meta={
                "index": index + 1,
                "aliasesAr": list(entry.get("aliases_ar", ())),
                "aliasesTranslit": list(entry.get("aliases_translit", ())),
            },
        )
        if index == current_index:
            row["current"] = True
        rows.append(row)

    payload = _base_payload(
        "lunar_mansions",
        chrt,
        options,
        columns,
        rows,
        title=_txt("LunarMansions", "Lunar Mansions").rstrip(". …"),
        source="manazil.py; classical Arabic manāzil al-qamar nomenclature",
    )
    payload["capabilities"] = {
        **payload["capabilities"],
        "sorting": False,
        "manzilZodiac": mode,
        "currentManzilIndex": current_index + 1,
    }
    return payload


_TABLE_BUILDERS = {
    "strip": _strip,
    "positions": _positions,
    "aspects": _aspects,
    "rise_set": _rise_set,
    "planetary_hours": _planetary_hours,
    "firdaria": _firdaria,
    "decennials": _decennials,
    "triplicity_directions": _triplicity_directions,
    "zodiacal_releasing": _zodiacal_releasing,
    "profections_table": _profections_table,
    "eclipses": _eclipses,
    "arabic_parts": _arabic_parts,
    "misc": _misc,
    "midpoints": _midpoints,
    "speeds": _speeds,
    "mundane_positions": _mundane_positions,
    "antiscia": _antiscia,
    "zodpars": _zodpars,
    "almuten_zodiacal": _almuten_zodiacal,
    "almuten_chart": _almuten_chart,
    "almuten_topical": _almuten_topical,
    "fixed_stars": _fixed_stars,
    "fixed_stars_aspects": _fixed_star_aspects,
    "fixed_stars_parallels": _fixed_star_parallels,
    "asteroids": _asteroids,
    "angle_at_birth": _angle_at_birth,
    "phasis": _phasis,
    "paranatellonta": _paranatellonta,
    "dodecatemoria": _dodecatemoria,
    "user_speculum": _user_speculum,
    "monthly_transits": _monthly_transits,
    "fixedstar_angle_directions": _fixedstar_angle_directions,
    "lunar_mansions": _lunar_mansions,
}


TABLES: dict[str, TableDef] = {
    table_id: TableDef(entry.table_id, entry.title, entry.source, _TABLE_BUILDERS[table_id])
    for table_id, entry in TABLE_CATALOG.items()
    if table_id in _TABLE_BUILDERS
}


class TablesService:
    def table_ids(self) -> list[str]:
        return sorted(TABLES)

    def payload_for_chart(
        self,
        table_id: str,
        chrt,
        *,
        binding: dict[str, Any] | None = None,
        current_datetime: Any = None,
        chart_anchor_datetime: Any = None,
    ) -> dict[str, Any]:
        spec = TABLES.get(str(table_id or ""))
        if spec is None:
            raise ValueError(f"unsupported table id {table_id!r}")
        # Table builders receive a presentation-only palette adapter. The
        # chart and canonical options retain their original calculation state.
        options = effective_display_options(chart_snapshot_service.options)
        try:
            if spec.table_id == "angle_at_birth":
                payload = _angle_at_birth(chrt, options, binding=binding)
            elif spec.table_id == "firdaria":
                payload = _firdaria(chrt, options, binding=binding, current_datetime=current_datetime)
            elif spec.table_id == "decennials":
                payload = _decennials(chrt, options, binding=binding, current_datetime=current_datetime)
            elif spec.table_id == "triplicity_directions":
                payload = _triplicity_directions(chrt, options, binding=binding, current_datetime=current_datetime)
            elif spec.table_id == "zodiacal_releasing":
                payload = _zodiacal_releasing(chrt, options, binding=binding, current_datetime=current_datetime)
            elif spec.table_id == "profections_table":
                payload = _profections_table(chrt, options, binding=binding, current_datetime=current_datetime)
            elif spec.table_id == "eclipses":
                payload = _eclipses(
                    chrt,
                    options,
                    binding=binding,
                    current_datetime=current_datetime,
                    chart_anchor_datetime=chart_anchor_datetime,
                )
            elif spec.table_id == "almuten_topical":
                payload = _almuten_topical(chrt, options, binding=binding)
            elif spec.table_id == "monthly_transits":
                payload = _monthly_transits(chrt, options, binding=binding, current_datetime=current_datetime)
            elif spec.table_id == "fixedstar_angle_directions":
                payload = _fixedstar_angle_directions(chrt, options, binding=binding)
            else:
                payload = spec.builder(chrt, options)
        except Exception as exc:
            payload = _unavailable(spec.table_id, chrt, title=spec.title, source=spec.source, reason=f"{spec.title} unavailable: {exc}")
        payload.setdefault("tableId", spec.table_id)
        payload.setdefault("title", spec.title)
        # Stable i18n key for the catalog title; the frontend renders it from the
        # shared catalog (table.<id>), falling back to the English `title`.
        payload.setdefault("titleKey", f"table.{spec.table_id}")
        payload.setdefault("source", spec.source)
        return payload


tables_service = TablesService()
