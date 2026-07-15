# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Bonatti-style triplicity directions.

Research basis:
- Bonatti and related medieval authors use ordered triplicity lords as a
  threefold house/life signification.
- This Aries research feature applies its experimental timing rule: 30-year main spans,
  then equal thirds recursively. Each child level uses the triplicity lords of
  the natal element occupied by the parent lord.

The module is wx-free. It returns plain period dictionaries for daemon table
payloads and tests.
"""
from __future__ import annotations

import datetime
from typing import Any

import astrology
import chart
import houses
import mtexts
import planets
import util


MAX_LEVEL = 9
EXTENDED_MAX_LEVEL = MAX_LEVEL + 6
L1_YEARS = 30
DEFAULT_CYCLES = 1

# Same element-group mapping used by chart.Chart._dignity_rows.
# 0=Fire, 1=Air, 2=Water, 3=Earth.
SIGN_TRIPLICITY_GROUPS = (0, 3, 1, 2, 0, 3, 1, 2, 0, 3, 1, 2)

# Dorothean defaults from options.Options.def_trips[0]. Used only to complete
# schemes such as Ptolemaic that do not provide a valid participating lord.
DOROTHEAN_TRIPLICITIES = (
    (astrology.SE_SUN, astrology.SE_JUPITER, astrology.SE_SATURN),
    (astrology.SE_SATURN, astrology.SE_MERCURY, astrology.SE_JUPITER),
    (astrology.SE_VENUS, astrology.SE_MARS, astrology.SE_MOON),
    (astrology.SE_VENUS, astrology.SE_MOON, astrology.SE_MARS),
)

CLASSICAL_PLANETS = (
    astrology.SE_SUN,
    astrology.SE_MOON,
    astrology.SE_MERCURY,
    astrology.SE_VENUS,
    astrology.SE_MARS,
    astrology.SE_JUPITER,
    astrology.SE_SATURN,
)


def is_diurnal(chart_obj: Any) -> bool:
    try:
        return bool(chart_obj.isAboveHorizonWithOrb())
    except Exception:
        return bool(getattr(chart_obj, "abovehorizonwithorb", True))


def group_for_sign(sign_index: int) -> int:
    return int(SIGN_TRIPLICITY_GROUPS[int(sign_index) % chart.Chart.SIGN_NUM])


def group_label(group_index: int) -> str:
    labels = getattr(mtexts, "triplicities", ("Fire", "Air", "Water", "Earth"))
    try:
        return str(labels[int(group_index) % 4])
    except Exception:
        return ("Fire", "Air", "Water", "Earth")[int(group_index) % 4]


def sign_label(sign_index: int) -> str:
    names = (
        "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
        "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
    )
    key_names = (
        "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
        "Libra", "Scorpio", "Sagittarius", "Capricornus", "Aquarius", "Pisces",
    )
    key = key_names[int(sign_index) % chart.Chart.SIGN_NUM]
    return str(mtexts.txts.get(key, names[int(sign_index) % chart.Chart.SIGN_NUM]))


def triplicity_scheme_label(options: Any) -> str:
    try:
        labels = mtexts.triplicityList
        return str(labels[int(getattr(options, "seltrip", 0))])
    except Exception:
        return "Triplicity"


def _valid_classical(planet_id: Any) -> bool:
    try:
        pid = int(planet_id)
    except Exception:
        return False
    return astrology.SE_SUN <= pid <= astrology.SE_SATURN


def triplicity_lords_for_group(options: Any, group_index: int, *, diurnal: bool) -> tuple[int, int, int]:
    group = int(group_index) % 4
    slot_order = (0, 1, 2) if diurnal else (1, 0, 2)
    configured: list[int] = []
    try:
        selected = int(getattr(options, "seltrip", 0))
        raw_slots = getattr(options, "trips")[selected][group]
    except Exception:
        raw_slots = DOROTHEAN_TRIPLICITIES[group]
    for slot in slot_order:
        try:
            pid = int(raw_slots[slot])
        except Exception:
            continue
        if _valid_classical(pid) and pid not in configured:
            configured.append(pid)
    for slot in slot_order:
        pid = int(DOROTHEAN_TRIPLICITIES[group][slot])
        if pid not in configured:
            configured.append(pid)
        if len(configured) == 3:
            break
    return tuple(configured[:3])  # type: ignore[return-value]


def _add_years(dt: datetime.datetime, years: int) -> datetime.datetime:
    try:
        return dt.replace(year=dt.year + int(years))
    except ValueError:
        # February 29 birthdays use the same practical fallback as other annual
        # timing surfaces in Aries.
        return dt.replace(year=dt.year + int(years), day=28)


def _split_thirds(start: datetime.datetime, end: datetime.datetime) -> list[tuple[datetime.datetime, datetime.datetime]]:
    seconds = (end - start).total_seconds()
    first = start + datetime.timedelta(seconds=seconds / 3.0)
    second = start + datetime.timedelta(seconds=seconds * 2.0 / 3.0)
    return [(start, first), (first, second), (second, end)]


def _start_datetime(chart_obj: Any) -> datetime.datetime:
    t = chart_obj.time
    return datetime.datetime(int(t.origyear), int(t.origmonth), int(t.origday), 0, 0, 0)


def ascendant_sign(chart_obj: Any, _options: Any) -> int:
    lon = float(chart_obj.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON])
    # Chart._zodiac_flags applies sidereal flags at the SwissEph boundary:
    # houses and planets are already in the chosen zodiac here.
    return int(util.normalize(lon) / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM


def resolved_base_sign(chart_obj: Any, options: Any, start_sign: Any = None) -> int:
    if start_sign is None:
        return ascendant_sign(chart_obj, options)
    try:
        return int(start_sign) % chart.Chart.SIGN_NUM
    except Exception:
        return ascendant_sign(chart_obj, options)


def planet_signs(chart_obj: Any) -> dict[int, int]:
    result: dict[int, int] = {}
    for pid in CLASSICAL_PLANETS:
        try:
            body = chart_obj.planets.planets[pid]
            lon = float(body.data[planets.Planet.LONG])
        except Exception:
            continue
        result[int(pid)] = int(util.normalize(lon) / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
    return result


def total_row_count(*, cycles: int = DEFAULT_CYCLES, max_level: int = MAX_LEVEL) -> int:
    level = max(1, int(max_level))
    return max(1, int(cycles)) * 3 * ((3 ** level - 1) // 2)


def parse_row_id(row_id: str) -> tuple[int, ...] | None:
    parts = str(row_id).split(":")
    if len(parts) < 4 or len(parts) % 2 != 0 or parts[0] != "cycle" or parts[2] != "l1":
        return None
    try:
        path = [int(parts[1]), int(parts[3])]
        expected_level = 2
        index = 4
        while index < len(parts):
            if parts[index] != "l%d" % expected_level:
                return None
            path.append(int(parts[index + 1]))
            expected_level += 1
            index += 2
    except Exception:
        return None
    if path[0] < 0 or path[1] not in (0, 1, 2) or any(item not in (0, 1, 2) for item in path[2:]):
        return None
    return tuple(path)


def row_id_for_path(path: tuple[int, ...]) -> str:
    row_id = "cycle:%d:l1:%d" % (int(path[0]), int(path[1]))
    for level, child_index in enumerate(path[2:], start=2):
        row_id = "%s:l%d:%d" % (row_id, level, int(child_index))
    return row_id


def ancestor_ids(row_id: str) -> list[str]:
    path = parse_row_id(row_id)
    if path is None or len(path) <= 2:
        return []
    return [row_id_for_path(path[:end]) for end in range(2, len(path))]


def row_for_path(
    chart_obj: Any,
    options: Any,
    path: tuple[int, ...],
    *,
    cycles: int = DEFAULT_CYCLES,
    max_level: int = MAX_LEVEL,
    base_sign: int | None = None,
) -> dict[str, Any] | None:
    if len(path) < 2 or len(path) - 1 > int(max_level):
        return None
    cycle = int(path[0])
    root_index = int(path[1])
    if cycle < 0 or cycle >= max(1, int(cycles)) or root_index not in (0, 1, 2):
        return None

    diurnal = is_diurnal(chart_obj)
    base_sign = resolved_base_sign(chart_obj, options, base_sign)
    base_group = group_for_sign(base_sign)
    natal_planet_signs = planet_signs(chart_obj)
    main_lords = triplicity_lords_for_group(options, base_group, diurnal=diurnal)
    root_start = _add_years(_start_datetime(chart_obj), L1_YEARS * (cycle * 3 + root_index))
    root_end = _add_years(root_start, L1_YEARS)
    row: dict[str, Any] = {
        "level": 1,
        "planet": int(main_lords[root_index]),
        "start": root_start,
        "end": root_end,
        "group": base_group,
        "group_label": group_label(base_group),
        "base_sign": base_sign,
        "base_sign_label": sign_label(base_sign),
        "parent_planet": None,
        "parent_sign": base_sign,
        "parent_id": None,
        "path": (cycle, root_index),
        "id": row_id_for_path((cycle, root_index)),
    }
    for child_index in path[2:]:
        children = children_for_period(chart_obj, options, row, max_level=max_level, _context=(
            diurnal, base_sign, natal_planet_signs,
        ))
        if int(child_index) < 0 or int(child_index) >= len(children):
            return None
        row = children[int(child_index)]
    return row


def row_for_id(
    chart_obj: Any,
    options: Any,
    row_id: str,
    *,
    cycles: int = DEFAULT_CYCLES,
    max_level: int = MAX_LEVEL,
    base_sign: int | None = None,
) -> dict[str, Any] | None:
    path = parse_row_id(row_id)
    if path is None:
        return None
    return row_for_path(chart_obj, options, path, cycles=cycles, max_level=max_level, base_sign=base_sign)


def children_for_period(
    chart_obj: Any,
    options: Any,
    parent: dict[str, Any],
    *,
    max_level: int = MAX_LEVEL,
    base_sign: int | None = None,
    _context: tuple[bool, int, dict[int, int]] | None = None,
) -> list[dict[str, Any]]:
    level = int(parent["level"]) + 1
    if level > int(max_level):
        return []
    if _context is None:
        diurnal = is_diurnal(chart_obj)
        base_sign = resolved_base_sign(chart_obj, options, base_sign)
        natal_planet_signs = planet_signs(chart_obj)
    else:
        diurnal, base_sign, natal_planet_signs = _context
    parent_lord = int(parent["planet"])
    parent_sign = natal_planet_signs.get(parent_lord, base_sign)
    child_group = group_for_sign(parent_sign)
    child_lords = triplicity_lords_for_group(options, child_group, diurnal=diurnal)
    rows: list[dict[str, Any]] = []
    for child_index, (lord, bounds) in enumerate(zip(child_lords, _split_thirds(parent["start"], parent["end"]))):
        child_start, child_end = bounds
        child_path = (*parent["path"], child_index)
        rows.append({
            "level": level,
            "planet": int(lord),
            "start": child_start,
            "end": child_end,
            "group": child_group,
            "group_label": group_label(child_group),
            "parent_planet": parent_lord,
            "parent_sign": parent_sign,
            "parent_id": parent["id"],
            "path": child_path,
            "id": row_id_for_path(child_path),
        })
    return rows


def current_chain(
    chart_obj: Any,
    options: Any,
    when: datetime.datetime | None,
    *,
    cycles: int = DEFAULT_CYCLES,
    max_level: int = MAX_LEVEL,
    base_sign: int | None = None,
) -> list[dict[str, Any]]:
    if when is None:
        return []
    base_sign = resolved_base_sign(chart_obj, options, base_sign)
    chain: list[dict[str, Any]] = []
    for cycle in range(max(1, int(cycles))):
        for root_index in range(3):
            row = row_for_path(
                chart_obj,
                options,
                (cycle, root_index),
                cycles=cycles,
                max_level=max_level,
                base_sign=base_sign,
            )
            if row is not None and row["start"] <= when < row["end"]:
                chain.append(row)
                break
        if chain:
            break
    while chain and int(chain[-1]["level"]) < int(max_level):
        children = children_for_period(chart_obj, options, chain[-1], max_level=max_level, base_sign=base_sign)
        current_child = next((row for row in children if row["start"] <= when < row["end"]), None)
        if current_child is None:
            break
        chain.append(current_child)
    return chain


def materialized_periods(
    chart_obj: Any,
    options: Any,
    *,
    cycles: int = DEFAULT_CYCLES,
    max_level: int = MAX_LEVEL,
    eager_level: int = 4,
    expanded_ids: set[str] | None = None,
    base_sign: int | None = None,
) -> list[dict[str, Any]]:
    base_sign = resolved_base_sign(chart_obj, options, base_sign)
    expanded = set(expanded_ids or set())
    rows: list[dict[str, Any]] = []

    def append_branch(row: dict[str, Any]) -> None:
        rows.append(row)
        if int(row["level"]) >= int(max_level):
            return
        if int(row["level"]) >= int(eager_level) and row["id"] not in expanded:
            return
        for child in children_for_period(chart_obj, options, row, max_level=max_level, base_sign=base_sign):
            append_branch(child)

    for cycle in range(max(1, int(cycles))):
        for root_index in range(3):
            row = row_for_path(
                chart_obj,
                options,
                (cycle, root_index),
                cycles=cycles,
                max_level=max_level,
                base_sign=base_sign,
            )
            if row is not None:
                append_branch(row)
    return rows


def build_periods(
    chart_obj: Any,
    options: Any,
    *,
    cycles: int = DEFAULT_CYCLES,
    max_level: int = MAX_LEVEL,
    base_sign: int | None = None,
) -> list[dict[str, Any]]:
    diurnal = is_diurnal(chart_obj)
    base_sign = resolved_base_sign(chart_obj, options, base_sign)
    base_group = group_for_sign(base_sign)
    natal_planet_signs = planet_signs(chart_obj)
    start = _start_datetime(chart_obj)
    main_lords = triplicity_lords_for_group(options, base_group, diurnal=diurnal)
    periods: list[dict[str, Any]] = []

    def append_children(parent: dict[str, Any]) -> None:
        level = int(parent["level"]) + 1
        if level > max_level:
            return
        parent_lord = int(parent["planet"])
        parent_sign = natal_planet_signs.get(parent_lord, base_sign)
        child_group = group_for_sign(parent_sign)
        child_lords = triplicity_lords_for_group(options, child_group, diurnal=diurnal)
        for child_index, (lord, bounds) in enumerate(zip(child_lords, _split_thirds(parent["start"], parent["end"]))):
            child_start, child_end = bounds
            row = {
                "level": level,
                "planet": int(lord),
                "start": child_start,
                "end": child_end,
                "group": child_group,
                "group_label": group_label(child_group),
                "parent_planet": parent_lord,
                "parent_sign": parent_sign,
                "parent_id": parent["id"],
                "path": (*parent["path"], child_index),
                "id": "%s:l%d:%d" % (parent["id"], level, child_index),
            }
            periods.append(row)
            append_children(row)

    cursor = start
    for cycle in range(max(1, int(cycles))):
        for index, lord in enumerate(main_lords):
            ending = _add_years(cursor, L1_YEARS)
            row = {
                "level": 1,
                "planet": int(lord),
                "start": cursor,
                "end": ending,
                "group": base_group,
                "group_label": group_label(base_group),
                "base_sign": base_sign,
                "base_sign_label": sign_label(base_sign),
                "parent_planet": None,
                "parent_sign": base_sign,
                "parent_id": None,
                "path": (cycle, index),
                "id": "cycle:%d:l1:%d" % (cycle, index),
            }
            periods.append(row)
            append_children(row)
            cursor = ending
    return periods


def fmt_date(dt: datetime.datetime) -> str:
    return "%04d.%02d.%02d" % (int(dt.year), int(dt.month), int(dt.day))


def fmt_length(row: dict[str, Any]) -> str:
    years_word = str(mtexts.txts.get("Years", "Years"))
    level = int(row.get("level", 1))
    if level == 1:
        return "30 %s" % years_word
    if level == 2:
        return "10 %s" % years_word
    years = L1_YEARS / float(3 ** (level - 1))
    if years < 1.0:
        seconds = max(1, int(round((row["end"] - row["start"]).total_seconds())))
        if seconds < 3600:
            minutes = max(1, int(round(seconds / 60.0)))
            return "%d %s" % (minutes, str(mtexts.txts.get("Minutes", "Minutes")))
        if seconds < 86400:
            hours = seconds / 3600.0
            return "%.1f %s" % (hours, str(mtexts.txts.get("Hours", "Hours")))
        days = max(1, int(round(seconds / 86400.0)))
        return "%d %s" % (days, str(mtexts.txts.get("Days", "Days")))
    return "%.2f %s" % (years, years_word)
