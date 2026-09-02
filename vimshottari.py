# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Vimshottari dasha periods for the Aries daemon.

The calculation follows the chart's canonical zodiac by default.  A persisted
technique binding may instead rebase the nakshatra anchor to one explicit
ayanamsha without changing the chart or Aries' global zodiac setting.
"""

from __future__ import annotations

from dataclasses import dataclass
import datetime
from typing import Any

import astrology
import houses
import planets


NAKSHATRA_SPAN_DEG = 360.0 / 27.0
FULL_CYCLE_YEARS = 120.0

ANCHOR_MOON = "moon"
ANCHOR_ASCENDANT = "ascendant"
VALID_ANCHORS = frozenset({ANCHOR_MOON, ANCHOR_ASCENDANT})

START_JANMA = "janma"
START_KSHEMA = "kshema"
START_UTPANNA = "utpanna"
START_ADHANA = "adhana"
START_STAR_OFFSETS = {
    START_JANMA: 0,
    START_KSHEMA: 3,
    START_UTPANNA: 4,
    START_ADHANA: 7,
}

YEAR_JULIAN_DAYS = 365.25
YEAR_SAVANA_DAYS = 360.0
VALID_YEAR_DAYS = frozenset({YEAR_JULIAN_DAYS, YEAR_SAVANA_DAYS})

AYANAMSHA_FOLLOW_CHART = "follow_chart"
VALID_AYANAMSHA_INDICES = frozenset(range(25))

NAKSHATRA_KEYS = (
    "ashwini", "bharani", "krittika", "rohini", "mrigashira", "ardra",
    "punarvasu", "pushya", "ashlesha", "magha", "purva_phalguni",
    "uttara_phalguni", "hasta", "chitra", "swati", "vishakha",
    "anuradha", "jyeshtha", "mula", "purva_ashadha", "uttara_ashadha",
    "shravana", "dhanishta", "shatabhisha", "purva_bhadrapada",
    "uttara_bhadrapada", "revati",
)

# Canonical Vimshottari order and fixed 120-year weights.
LORDS = (
    {"key": "ketu", "name": "Ketu", "years": 7.0, "planet_id": astrology.SE_TRUE_NODE},
    {"key": "venus", "name": "Venus", "years": 20.0, "planet_id": astrology.SE_VENUS},
    {"key": "sun", "name": "Sun", "years": 6.0, "planet_id": astrology.SE_SUN},
    {"key": "moon", "name": "Moon", "years": 10.0, "planet_id": astrology.SE_MOON},
    {"key": "mars", "name": "Mars", "years": 7.0, "planet_id": astrology.SE_MARS},
    {"key": "rahu", "name": "Rahu", "years": 18.0, "planet_id": astrology.SE_MEAN_NODE},
    {"key": "jupiter", "name": "Jupiter", "years": 16.0, "planet_id": astrology.SE_JUPITER},
    {"key": "saturn", "name": "Saturn", "years": 19.0, "planet_id": astrology.SE_SATURN},
    {"key": "mercury", "name": "Mercury", "years": 17.0, "planet_id": astrology.SE_MERCURY},
)


@dataclass(frozen=True, slots=True)
class NakshatraPosition:
    index: int
    fraction_elapsed: float

    @property
    def key(self) -> str:
        return NAKSHATRA_KEYS[self.index]


@dataclass(frozen=True, slots=True)
class VimshottariTimeline:
    rows: tuple[dict[str, Any], ...]
    anchor_longitude: float
    birth_nakshatra_index: int
    start_nakshatra_index: int
    starting_lord_index: int
    balance_years: float
    year_days: float
    depth: int

    @property
    def birth_nakshatra_key(self) -> str:
        return NAKSHATRA_KEYS[self.birth_nakshatra_index]

    @property
    def start_nakshatra_key(self) -> str:
        return NAKSHATRA_KEYS[self.start_nakshatra_index]

    @property
    def starting_lord(self) -> dict[str, Any]:
        return LORDS[self.starting_lord_index]


def normalize_anchor(value: Any) -> str:
    token = str(value or ANCHOR_MOON).strip().lower()
    return token if token in VALID_ANCHORS else ANCHOR_MOON


def normalize_start_star(value: Any) -> str:
    token = str(value or START_JANMA).strip().lower()
    return token if token in START_STAR_OFFSETS else START_JANMA


def normalize_year_days(value: Any) -> float:
    try:
        days = float(value)
    except (TypeError, ValueError):
        days = YEAR_JULIAN_DAYS
    return days if days in VALID_YEAR_DAYS else YEAR_JULIAN_DAYS


def normalize_depth(value: Any) -> int:
    try:
        depth = int(value)
    except (TypeError, ValueError):
        depth = 3
    return max(2, min(3, depth))


def normalize_ayanamsha(value: Any) -> str | int:
    if value is None or str(value).strip().lower() == AYANAMSHA_FOLLOW_CHART:
        return AYANAMSHA_FOLLOW_CHART
    try:
        index = int(value)
    except (TypeError, ValueError):
        return AYANAMSHA_FOLLOW_CHART
    return index if index in VALID_AYANAMSHA_INDICES else AYANAMSHA_FOLLOW_CHART


def chart_birth_datetime(chrt: Any) -> datetime.datetime:
    time = chrt.time
    return datetime.datetime(
        int(getattr(time, "origyear", getattr(time, "year", 1))),
        int(getattr(time, "origmonth", getattr(time, "month", 1))),
        int(getattr(time, "origday", getattr(time, "day", 1))),
        int(getattr(time, "hour", 0)),
        int(getattr(time, "minute", 0)),
        int(getattr(time, "second", 0)),
    )


def chart_anchor_longitude(
    chrt: Any,
    anchor: Any = ANCHOR_MOON,
    ayanamsha: Any = AYANAMSHA_FOLLOW_CHART,
) -> float:
    """Return the anchor in the selected Vimshottari zodiac frame."""
    token = normalize_anchor(anchor)
    if token == ANCHOR_ASCENDANT:
        try:
            longitude = float(chrt.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON])
        except Exception:
            longitude = float(chrt.houses.ascmc[houses.Houses.ASC])
    else:
        longitude = float(chrt.planets.planets[astrology.SE_MOON].data[planets.Planet.LONG])

    choice = normalize_ayanamsha(ayanamsha)
    longitude %= 360.0
    if choice == AYANAMSHA_FOLLOW_CHART:
        return longitude

    chart_offset = float(getattr(chrt, "ayanamsha_offset", 0.0) or 0.0)
    tropical_longitude = (longitude + chart_offset) % 360.0
    if choice == 0:
        return tropical_longitude

    mode = astrology.ayanamsha_swe_mode(choice)
    if mode is None:
        return tropical_longitude
    with astrology.swiss_context(sidereal_mode=mode):
        selected_offset = float(astrology.effective_ayanamsha_ut(chrt.time.jd, choice))
    return (tropical_longitude - selected_offset) % 360.0


def nakshatra_position(longitude: float) -> NakshatraPosition:
    normalized = float(longitude) % 360.0
    raw = normalized / NAKSHATRA_SPAN_DEG
    index = min(26, int(raw))
    fraction = max(0.0, min(1.0, raw - index))
    return NakshatraPosition(index=index, fraction_elapsed=fraction)


def build_for_chart(
    chrt: Any,
    *,
    anchor: Any = ANCHOR_MOON,
    start_star: Any = START_JANMA,
    year_days: Any = YEAR_JULIAN_DAYS,
    depth: Any = 3,
    ayanamsha: Any = AYANAMSHA_FOLLOW_CHART,
) -> VimshottariTimeline:
    return build_timeline(
        chart_birth_datetime(chrt),
        chart_anchor_longitude(chrt, anchor, ayanamsha),
        start_star=start_star,
        year_days=year_days,
        depth=depth,
    )


def build_timeline(
    birth: datetime.datetime,
    anchor_longitude: float,
    *,
    start_star: Any = START_JANMA,
    year_days: Any = YEAR_JULIAN_DAYS,
    depth: Any = 3,
    horizon_years: float = FULL_CYCLE_YEARS,
) -> VimshottariTimeline:
    start_token = normalize_start_star(start_star)
    resolved_year_days = normalize_year_days(year_days)
    resolved_depth = normalize_depth(depth)
    position = nakshatra_position(anchor_longitude)
    start_nakshatra = (position.index + START_STAR_OFFSETS[start_token]) % len(NAKSHATRA_KEYS)
    starting_lord = start_nakshatra % len(LORDS)
    starting_years = float(LORDS[starting_lord]["years"])
    first_span = datetime.timedelta(days=starting_years * resolved_year_days)
    first_full_start = birth - first_span * position.fraction_elapsed
    first_full_end = first_full_start + first_span
    horizon_end = birth + datetime.timedelta(days=float(horizon_years) * resolved_year_days)

    rows: list[dict[str, Any]] = []
    main_start = first_full_start
    main_index = 0
    while main_start < horizon_end:
        lord_index = (starting_lord + main_index) % len(LORDS)
        main_end = main_start + datetime.timedelta(
            days=float(LORDS[lord_index]["years"]) * resolved_year_days,
        )
        if main_end > birth:
            row_id = f"main:{main_index}"
            _append_period_tree(
                rows,
                row_id=row_id,
                parent_id=None,
                path=(lord_index,),
                lord_index=lord_index,
                level=1,
                full_start=main_start,
                full_end=main_end,
                clip_start=birth,
                clip_end=horizon_end,
                depth=resolved_depth,
            )
        main_start = main_end
        main_index += 1
        if main_index > 18:  # defensive; a 120-year horizon needs at most ten.
            break

    return VimshottariTimeline(
        rows=tuple(rows),
        anchor_longitude=float(anchor_longitude) % 360.0,
        birth_nakshatra_index=position.index,
        start_nakshatra_index=start_nakshatra,
        starting_lord_index=starting_lord,
        balance_years=(first_full_end - birth).total_seconds() / (resolved_year_days * 86400.0),
        year_days=resolved_year_days,
        depth=resolved_depth,
    )


def current_row_ids(rows: tuple[dict[str, Any], ...] | list[dict[str, Any]], when: datetime.datetime | None) -> list[str]:
    if when is None:
        return []
    return [
        str(row["id"])
        for row in rows
        if row["start"] <= when < row["end"]
    ]


def _append_period_tree(
    rows: list[dict[str, Any]],
    *,
    row_id: str,
    parent_id: str | None,
    path: tuple[int, ...],
    lord_index: int,
    level: int,
    full_start: datetime.datetime,
    full_end: datetime.datetime,
    clip_start: datetime.datetime,
    clip_end: datetime.datetime,
    depth: int,
) -> None:
    start = max(full_start, clip_start)
    end = min(full_end, clip_end)
    if end <= start:
        return
    lord = LORDS[lord_index]
    rows.append({
        "id": row_id,
        "parent_id": parent_id,
        "path": path,
        "level": level,
        "lord_index": lord_index,
        "lord_key": lord["key"],
        "lord_name": lord["name"],
        "planet": int(lord["planet_id"]),
        "start": start,
        "end": end,
        "full_start": full_start,
        "full_end": full_end,
        "clipped_start": start > full_start,
        "clipped_end": end < full_end,
        "has_children": level < depth,
    })
    if level >= depth:
        return

    parent_span = full_end - full_start
    cumulative_years = 0.0
    child_start = full_start
    for child_offset in range(len(LORDS)):
        child_lord_index = (lord_index + child_offset) % len(LORDS)
        cumulative_years += float(LORDS[child_lord_index]["years"])
        child_end = (
            full_end
            if child_offset == len(LORDS) - 1
            else full_start + parent_span * (cumulative_years / FULL_CYCLE_YEARS)
        )
        child_id = f"{row_id}:l{level + 1}:{child_offset}"
        _append_period_tree(
            rows,
            row_id=child_id,
            parent_id=row_id,
            path=path + (child_lord_index,),
            lord_index=child_lord_index,
            level=level + 1,
            full_start=child_start,
            full_end=child_end,
            clip_start=clip_start,
            clip_end=clip_end,
            depth=depth,
        )
        child_start = child_end
