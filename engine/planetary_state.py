# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Canonical physical-state detection for chart bodies.

This module owns state semantics shared by chart inspection, hover flags, and
time-series consumers.  It performs no presentation or localization work.
"""

from __future__ import annotations

import math
from collections import OrderedDict
from dataclasses import asdict, dataclass
from typing import Iterable, Mapping, Optional, Sequence

import astrology
import common
import planets
from aries.astrology.ephemeris_context import EphemerisContext
from aries.astrology.transit_fast import search_station_times


_COMPARISON_TOLERANCE_DEG = 1.0e-12
_STATION_BOUNDARY_EPS_DAYS = 1.0e-5
_STATION_CACHE_MAX = 96
_STATION_SEARCH_WINDOW_DAYS = {
    astrology.SE_MERCURY: 160.0,
    astrology.SE_VENUS: 650.0,
    astrology.SE_MARS: 900.0,
}
_STATION_SEARCH_WINDOW_DEFAULT_DAYS = 450.0
_STATION_BRACKET_CACHE: "OrderedDict[tuple, StationBracket]" = OrderedDict()


@dataclass(frozen=True)
class OutOfBoundsState:
    body_id: int
    active: bool
    declination_deg: Optional[float]
    limit_deg: Optional[float]
    excess_deg: Optional[float]
    hemisphere: Optional[str]
    supported: bool
    reason: Optional[str]

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class OutOfBoundsExcursion:
    body_id: int
    sample_index: int
    declination_deg: float


@dataclass(frozen=True)
class StationEvent:
    body_id: int
    jd_ut: float
    code: str


@dataclass(frozen=True)
class StationBracket:
    body_id: int
    previous: Optional[StationEvent]
    next: Optional[StationEvent]
    supported: bool
    reason: Optional[str]


def is_out_of_bounds(
    body_id: int,
    declination_deg: object,
    solar_declination_limit_deg: object,
) -> bool:
    """Fast boolean form for series consumers."""
    if int(body_id) == astrology.SE_SUN:
        return False
    try:
        declination = float(declination_deg)
        limit = abs(float(solar_declination_limit_deg))
    except (TypeError, ValueError):
        return False
    return bool(
        math.isfinite(declination)
        and math.isfinite(limit)
        and limit > 0.0
        and abs(declination) - limit > _COMPARISON_TOLERANCE_DEG
    )


def classify_out_of_bounds(
    body_id: int,
    declination_deg: object,
    solar_declination_limit_deg: object,
) -> OutOfBoundsState:
    """Classify one body against the Sun's maximum absolute declination."""
    body_id = int(body_id)
    if body_id == astrology.SE_SUN:
        return OutOfBoundsState(
            body_id=body_id,
            active=False,
            declination_deg=None,
            limit_deg=None,
            excess_deg=None,
            hemisphere=None,
            supported=False,
            reason="sun_defines_limit",
        )
    try:
        declination = float(declination_deg)
        limit = abs(float(solar_declination_limit_deg))
    except (TypeError, ValueError):
        return OutOfBoundsState(
            body_id=body_id,
            active=False,
            declination_deg=None,
            limit_deg=None,
            excess_deg=None,
            hemisphere=None,
            supported=False,
            reason="declination_unavailable",
        )
    if not math.isfinite(declination) or not math.isfinite(limit) or limit <= 0.0:
        return OutOfBoundsState(
            body_id=body_id,
            active=False,
            declination_deg=declination,
            limit_deg=limit,
            excess_deg=None,
            hemisphere=None,
            supported=False,
            reason="solar_declination_limit_unavailable",
        )

    excess = abs(declination) - limit
    active = is_out_of_bounds(body_id, declination, limit)
    return OutOfBoundsState(
        body_id=body_id,
        active=active,
        declination_deg=declination,
        limit_deg=limit,
        excess_deg=max(0.0, excess),
        hemisphere=("north" if declination >= 0.0 else "south") if active else None,
        supported=True,
        reason=None,
    )


def classify_chart_body(chrt, body_id: int) -> OutOfBoundsState:
    """Classify a calculated chart body using the chart's true obliquity."""
    body_id = int(body_id)
    try:
        body = chrt.get_planet_body(body_id)
        declination = body.dataEqu[planets.Planet.DECLEQU]
        raw_obliquity = chrt.obl
        limit = raw_obliquity[0] if isinstance(raw_obliquity, (list, tuple)) else raw_obliquity
    except (AttributeError, IndexError, TypeError, ValueError):
        return classify_out_of_bounds(body_id, None, None)
    return classify_out_of_bounds(body_id, declination, limit)


def out_of_bounds_excursions(
    series_by_body: Mapping[int, Mapping[str, Sequence[float]]],
    body_ids: Iterable[int],
) -> tuple[OutOfBoundsExcursion, ...]:
    """Return one furthest sample for every continuous OOB excursion."""
    solar_series = series_by_body.get(astrology.SE_SUN, {}).get("declination", ())
    if not solar_series:
        return ()
    limit = max(abs(float(value)) for value in solar_series)
    if limit <= 0.0:
        return ()

    excursions: list[OutOfBoundsExcursion] = []
    for raw_body_id in body_ids:
        body_id = int(raw_body_id)
        if body_id == astrology.SE_SUN:
            continue
        candidate_index: Optional[int] = None
        candidate_value = 0.0

        def append_candidate() -> None:
            nonlocal candidate_index, candidate_value
            if candidate_index is not None:
                excursions.append(OutOfBoundsExcursion(
                    body_id=body_id,
                    sample_index=candidate_index,
                    declination_deg=candidate_value,
                ))
            candidate_index = None
            candidate_value = 0.0

        series = series_by_body.get(body_id, {}).get("declination", ())
        for index, raw_value in enumerate(series):
            value = float(raw_value)
            if is_out_of_bounds(body_id, value, limit):
                if candidate_index is None or abs(value) > abs(candidate_value):
                    candidate_index = index
                    candidate_value = value
            else:
                append_candidate()
        append_candidate()
    return tuple(excursions)


def _station_ephemeris_body_id(chrt, body_id: int) -> int:
    """Resolve Aries' two logical node ids to the configured physical node."""
    if int(body_id) in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE):
        return (
            astrology.SE_MEAN_NODE
            if bool(getattr(chrt.options, "meannode", True))
            else astrology.SE_TRUE_NODE
        )
    return int(body_id)


def _station_speed(context: EphemerisContext, body_id: int, jd_ut: float) -> Optional[float]:
    try:
        with context.activate():
            body = planets.Planet(float(jd_ut), int(body_id), context.flags)
        return float(body.data[planets.Planet.SPLON])
    except (AttributeError, IndexError, TypeError, ValueError):
        return None


def _station_code(context: EphemerisContext, body_id: int, jd_ut: float) -> Optional[str]:
    before = _station_speed(context, body_id, float(jd_ut) - 0.05)
    after = _station_speed(context, body_id, float(jd_ut) + 0.05)
    if before is None or after is None:
        return None
    if before > 0.0 and after < 0.0:
        return "SR"
    if before < 0.0 and after > 0.0:
        return "SD"
    return None


def _cached_station_bracket(cache_key: tuple, anchor_jd: float) -> Optional[StationBracket]:
    bracket = _STATION_BRACKET_CACHE.get(cache_key)
    if bracket is None or bracket.previous is None or bracket.next is None:
        return None
    if (
        bracket.previous.jd_ut - _STATION_BOUNDARY_EPS_DAYS
        <= float(anchor_jd)
        < bracket.next.jd_ut - _STATION_BOUNDARY_EPS_DAYS
    ):
        _STATION_BRACKET_CACHE.move_to_end(cache_key)
        return bracket
    return None


def station_bracket(chrt, body_id: int) -> StationBracket:
    """Return the exact longitudinal stations bracketing the chart moment.

    The interval cache is intentionally keyed without the cursor JD: every
    moment between the same two stations reuses one exact search result. This
    keeps inspector/hover refreshes cheap during time-stepping while preserving
    the chart's sidereal and topocentric Swiss-Ephemeris context.
    """
    body_id = int(body_id)
    try:
        anchor_jd = float(chrt.time.jd)
        physical_body_id = _station_ephemeris_body_id(chrt, body_id)
    except (AttributeError, TypeError, ValueError):
        return StationBracket(body_id, None, None, False, "chart_time_unavailable")

    if physical_body_id in (astrology.SE_SUN, astrology.SE_MOON, astrology.SE_MEAN_NODE):
        return StationBracket(body_id, None, None, False, "body_has_no_longitude_stations")

    try:
        context = EphemerisContext.for_chart(chrt, ephe_path=common.get_ephe_path())
    except (AttributeError, TypeError, ValueError):
        return StationBracket(body_id, None, None, False, "ephemeris_context_unavailable")

    cache_key = (body_id, physical_body_id, context)
    cached = _cached_station_bracket(cache_key, anchor_jd)
    if cached is not None:
        return cached

    window = _STATION_SEARCH_WINDOW_DAYS.get(
        physical_body_id,
        _STATION_SEARCH_WINDOW_DEFAULT_DAYS,
    )
    try:
        hits = search_station_times(
            physical_body_id,
            anchor_jd - window,
            anchor_jd + window,
            context=context,
        )
    except Exception:
        return StationBracket(body_id, None, None, False, "station_search_failed")

    events = []
    for hit in hits:
        if getattr(hit, "hit_type", None) != "station":
            continue
        jd_ut = float(hit.jd_ut)
        code = _station_code(context, physical_body_id, jd_ut)
        if code is not None:
            events.append(StationEvent(body_id, jd_ut, code))
    events.sort(key=lambda event: event.jd_ut)

    previous = next(
        (
            event
            for event in reversed(events)
            if event.jd_ut <= anchor_jd + _STATION_BOUNDARY_EPS_DAYS
        ),
        None,
    )
    following = next(
        (
            event
            for event in events
            if event.jd_ut > anchor_jd + _STATION_BOUNDARY_EPS_DAYS
        ),
        None,
    )
    bracket = StationBracket(
        body_id=body_id,
        previous=previous,
        next=following,
        supported=previous is not None and following is not None,
        reason=None if previous is not None and following is not None else "station_bracket_not_found",
    )
    if bracket.supported:
        _STATION_BRACKET_CACHE[cache_key] = bracket
        _STATION_BRACKET_CACHE.move_to_end(cache_key)
        while len(_STATION_BRACKET_CACHE) > _STATION_CACHE_MAX:
            _STATION_BRACKET_CACHE.popitem(last=False)
    return bracket


__all__ = [
    OutOfBoundsExcursion.__name__,
    OutOfBoundsState.__name__,
    StationBracket.__name__,
    StationEvent.__name__,
    "classify_chart_body",
    "classify_out_of_bounds",
    "is_out_of_bounds",
    "out_of_bounds_excursions",
    "station_bracket",
]
