# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Exact lunar-cycle extrema used by the retained synodic list.

Draconic Moon/node contacts already use the canonical relative-aspect search
engine.  This module owns the two event families that are not ordinary aspect
searches: true-node stations and geocentric lunar distance/speed extrema.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import astrology
import common
from aries.astrology.ephemeris_context import EphemerisContext
from aries.astrology.transit_fast import search_station_times


ANOMALISTIC_PERIGEE = "perigee"
ANOMALISTIC_APOGEE = "apogee"
ANOMALISTIC_SPEEDING = "speeding"
ANOMALISTIC_SLOWING = "slowing"

LUNAR_EXACT_SLOWEST = "slowest"
LUNAR_EXACT_FASTEST = "fastest"
LUNAR_EXACT_NORTH_BENDING = "north_bending"
LUNAR_EXACT_SOUTH_BENDING = "south_bending"

TRUE_NODE_STATION_RETROGRADE = "SR"
TRUE_NODE_STATION_DIRECT = "SD"

TRADITIONAL_MEAN_MOON_SPEED = 13.0 + 10.0 / 60.0 + 36.0 / 3600.0

_SCAN_STEP_DAYS = 0.25
_ROOT_TOLERANCE_DAYS = 0.25 / 86400.0
_SPEED_DERIVATIVE_HALF_WINDOW_DAYS = 1.0 / 48.0
_CLASSIFY_HALF_WINDOW_DAYS = 1.0 / 96.0
_DEDUP_WINDOW_DAYS = 1.0 / 1440.0
# Inspector timestamps opened from an exact list row can be rounded to the
# displayed second.  Treat a boundary as "exact" only when its authoritative
# root lies within one minute of the inspected instant.  This is a temporal
# matching tolerance, not an astrological orb.
_EXACT_STATE_TOLERANCE_DAYS = 60.0 / 86400.0


@dataclass(frozen=True, slots=True)
class LunarCycleEvent:
    code: str
    jd_ut: float
    distance_au: float | None = None
    longitude_speed: float | None = None


@dataclass(frozen=True, slots=True)
class LunarConditionSnapshot:
    """Current geocentric tropical lunar conditions for one exact instant.

    ``elongation`` is the directed Moon-minus-Sun arc in ``[0, 360)``.
    Longitude/latitude speeds are degrees per day and longitude acceleration
    is degrees per day squared.  ``exact_states`` contains boundary
    singularities whose computed roots match the instant within the documented
    one-minute transport/display tolerance.
    """

    increasing_in_light: bool
    increasing_in_latitude: bool
    increasing_in_number: bool
    swift: bool
    longitude_speed: float
    longitude_acceleration: float
    latitude: float
    latitude_speed: float
    elongation: float
    exact_states: tuple[str, ...]


def lunar_condition_snapshot(chrt, jd_ut: float) -> LunarConditionSnapshot:
    """Return the four independent traditional lunar conditions at ``jd_ut``.

    The calculation is always geocentric and tropical, including for a
    sidereal or topocentric chart:

    * increasing in light: directed Sun-Moon elongation is in the waxing half;
    * increasing in latitude: signed ecliptic latitude speed is northward;
    * increasing in number: ecliptic longitude speed is increasing;
    * swift: longitude speed exceeds 13°10′36″ per day.

    The condition booleans always reflect the measured derivatives at the
    instant.  Exact boundary names are reported separately; the selected
    mean/true node follows the chart option so bending roots agree with the
    retained synodic list.
    """
    instant = float(jd_ut)
    context = _geocentric_context(chrt)
    state_cache: dict[tuple[int, float], tuple[float, ...]] = {}

    def state(body_id: int, value: float) -> tuple[float, ...]:
        key = (int(body_id), round(float(value), 10))
        cached = state_cache.get(key)
        if cached is not None:
            return cached
        with context.activate():
            _retflag, values, _serr = astrology.swe_calc_ut_ex(
                float(value),
                int(body_id),
                context.flags,
            )
        if len(values) < 6:
            raise RuntimeError("Swiss Ephemeris returned an incomplete body state")
        result = tuple(float(item) for item in values)
        state_cache[key] = result
        return result

    def longitude_acceleration(value: float) -> float:
        half_window = _SPEED_DERIVATIVE_HALF_WINDOW_DAYS
        return (
            state(astrology.SE_MOON, float(value) + half_window)[3]
            - state(astrology.SE_MOON, float(value) - half_window)[3]
        ) / (2.0 * half_window)

    moon = state(astrology.SE_MOON, instant)
    sun = state(astrology.SE_SUN, instant)
    acceleration = longitude_acceleration(instant)
    exact_states = list(
        _speed_exact_states_near(
            instant,
            longitude_acceleration,
        )
    )
    exact_states.extend(
        _bending_exact_states_near(
            chrt,
            instant,
            state,
        )
    )

    elongation = (moon[0] - sun[0]) % 360.0
    return LunarConditionSnapshot(
        increasing_in_light=elongation < 180.0,
        increasing_in_latitude=moon[4] > 0.0,
        increasing_in_number=acceleration > 0.0,
        swift=moon[3] > TRADITIONAL_MEAN_MOON_SPEED,
        longitude_speed=moon[3],
        longitude_acceleration=acceleration,
        latitude=moon[1],
        latitude_speed=moon[4],
        elongation=elongation,
        exact_states=tuple(exact_states),
    )


def anomalistic_events(chrt, start_jd: float, end_jd: float) -> list[LunarCycleEvent]:
    """Return exact geocentric lunar apsides and longitude-speed turnarounds."""
    start, end = _ordered_range(start_jd, end_jd)
    if end <= start:
        return []
    context = _geocentric_context(chrt)
    state_cache: dict[float, tuple[float, ...]] = {}

    def state(jd_ut: float) -> tuple[float, ...]:
        key = round(float(jd_ut), 10)
        cached = state_cache.get(key)
        if cached is not None:
            return cached
        with context.activate():
            _retflag, values, _serr = astrology.swe_calc_ut_ex(
                float(jd_ut),
                astrology.SE_MOON,
                context.flags,
            )
        if len(values) < 6:
            raise RuntimeError("Swiss Ephemeris returned an incomplete Moon state")
        result = tuple(float(value) for value in values)
        state_cache[key] = result
        return result

    def radial_speed(jd_ut: float) -> float:
        return state(jd_ut)[5]

    def longitude_acceleration(jd_ut: float) -> float:
        half_window = _SPEED_DERIVATIVE_HALF_WINDOW_DAYS
        return (
            state(float(jd_ut) + half_window)[3]
            - state(float(jd_ut) - half_window)[3]
        ) / (2.0 * half_window)

    events: list[LunarCycleEvent] = []
    for root, before, after in _zero_crossings(
        radial_speed,
        start,
        end,
        classify_window=_CLASSIFY_HALF_WINDOW_DAYS,
    ):
        if before < 0.0 < after:
            code = ANOMALISTIC_PERIGEE
        elif before > 0.0 > after:
            code = ANOMALISTIC_APOGEE
        else:
            continue
        moon = state(root)
        events.append(
            LunarCycleEvent(
                code=code,
                jd_ut=root,
                distance_au=moon[2],
                longitude_speed=moon[3],
            )
        )

    for root, before, after in _zero_crossings(
        longitude_acceleration,
        start,
        end,
        classify_window=_CLASSIFY_HALF_WINDOW_DAYS,
    ):
        if before < 0.0 < after:
            code = ANOMALISTIC_SPEEDING
        elif before > 0.0 > after:
            code = ANOMALISTIC_SLOWING
        else:
            continue
        moon = state(root)
        events.append(
            LunarCycleEvent(
                code=code,
                jd_ut=root,
                distance_au=moon[2],
                longitude_speed=moon[3],
            )
        )
    return _dedupe_events(events)


def true_node_station_events(
    chrt,
    start_jd: float,
    end_jd: float,
) -> list[LunarCycleEvent]:
    """Return real direct/retrograde stations of the Swiss true lunar node."""
    start, end = _ordered_range(start_jd, end_jd)
    if end <= start:
        return []
    context = _geocentric_context(chrt)
    hits = search_station_times(
        astrology.SE_TRUE_NODE,
        start,
        end,
        context=context,
        step_days=0.25,
    )
    events: list[LunarCycleEvent] = []
    for hit in hits:
        jd_ut = float(hit.jd_ut)
        before = _body_speed(context, astrology.SE_TRUE_NODE, jd_ut - 0.05)
        after = _body_speed(context, astrology.SE_TRUE_NODE, jd_ut + 0.05)
        if before > 0.0 > after:
            code = TRUE_NODE_STATION_RETROGRADE
        elif before < 0.0 < after:
            code = TRUE_NODE_STATION_DIRECT
        else:
            continue
        events.append(
            LunarCycleEvent(
                code=code,
                jd_ut=jd_ut,
                longitude_speed=float(hit.speed),
            )
        )
    return _dedupe_events(events)


def true_node_state(chrt, jd_ut: float) -> tuple[float, float]:
    """Return the selected-zodiac longitude and speed of the physical true node."""
    context = EphemerisContext.for_chart(
        chrt,
        ephe_path=common.get_ephe_path(),
        include_topocentric=False,
    )
    with context.activate():
        _retflag, values, _serr = astrology.swe_calc_ut_ex(
            float(jd_ut),
            astrology.SE_TRUE_NODE,
            context.flags,
        )
    if len(values) < 4:
        raise RuntimeError("Swiss Ephemeris returned an incomplete true-node state")
    return float(values[0]) % 360.0, float(values[3])


def _geocentric_context(chrt) -> EphemerisContext:
    return EphemerisContext.for_chart(
        chrt,
        ephe_path=common.get_ephe_path(),
        include_sidereal=False,
        include_topocentric=False,
    )


def _speed_exact_states_near(
    jd_ut: float,
    longitude_acceleration: Callable[[float], float],
) -> tuple[str, ...]:
    """Match a longitude-speed extremum within the inspector time tolerance."""
    left = float(jd_ut) - _EXACT_STATE_TOLERANCE_DAYS
    right = float(jd_ut) + _EXACT_STATE_TOLERANCE_DAYS
    left_value = longitude_acceleration(left)
    right_value = longitude_acceleration(right)
    if (
        left_value != 0.0
        and right_value != 0.0
        and left_value * right_value > 0.0
    ):
        return ()
    root = _bisect_root(
        longitude_acceleration,
        left,
        right,
        left_value,
        right_value,
    )
    if root is None:
        return ()
    before = longitude_acceleration(root - _CLASSIFY_HALF_WINDOW_DAYS)
    after = longitude_acceleration(root + _CLASSIFY_HALF_WINDOW_DAYS)
    if before < 0.0 < after:
        return (LUNAR_EXACT_SLOWEST,)
    if before > 0.0 > after:
        return (LUNAR_EXACT_FASTEST,)
    return ()


def _bending_exact_states_near(
    chrt,
    jd_ut: float,
    state: Callable[[int, float], tuple[float, ...]],
) -> tuple[str, ...]:
    """Match a nodal-axis square and classify it by exact signed latitude."""
    node_id = (
        astrology.SE_MEAN_NODE
        if bool(getattr(getattr(chrt, "options", None), "meannode", True))
        else astrology.SE_TRUE_NODE
    )
    left = float(jd_ut) - _EXACT_STATE_TOLERANCE_DAYS
    right = float(jd_ut) + _EXACT_STATE_TOLERANCE_DAYS

    def relative_angle(value: float) -> float:
        moon = state(astrology.SE_MOON, value)
        node = state(node_id, value)
        return (moon[0] - node[0]) % 360.0

    current_angle = relative_angle(float(jd_ut))
    north_residual = _signed_angle_difference(current_angle, 90.0)
    south_residual = _signed_angle_difference(current_angle, 270.0)
    target = 90.0 if abs(north_residual) <= abs(south_residual) else 270.0

    def residual(value: float) -> float:
        return _signed_angle_difference(relative_angle(value), target)

    left_value = residual(left)
    right_value = residual(right)
    if (
        left_value != 0.0
        and right_value != 0.0
        and left_value * right_value > 0.0
    ):
        return ()
    root = _bisect_root(residual, left, right, left_value, right_value)
    if root is None:
        return ()
    latitude = state(astrology.SE_MOON, root)[1]
    if latitude > 0.0:
        return (LUNAR_EXACT_NORTH_BENDING,)
    if latitude < 0.0:
        return (LUNAR_EXACT_SOUTH_BENDING,)
    return ()


def _signed_angle_difference(value: float, target: float) -> float:
    return ((float(value) - float(target) + 180.0) % 360.0) - 180.0


def _body_speed(context: EphemerisContext, planet_id: int, jd_ut: float) -> float:
    with context.activate():
        _retflag, values, _serr = astrology.swe_calc_ut_ex(
            float(jd_ut),
            int(planet_id),
            context.flags,
        )
    if len(values) < 4:
        raise RuntimeError("Swiss Ephemeris returned an incomplete body state")
    return float(values[3])


def _zero_crossings(
    fn: Callable[[float], float],
    start_jd: float,
    end_jd: float,
    *,
    classify_window: float,
) -> list[tuple[float, float, float]]:
    roots: list[tuple[float, float, float]] = []
    left = float(start_jd)
    left_value = fn(left)
    while left < end_jd:
        right = min(left + _SCAN_STEP_DAYS, float(end_jd))
        right_value = fn(right)
        if left_value == 0.0 or right_value == 0.0 or left_value * right_value < 0.0:
            root = _bisect_root(fn, left, right, left_value, right_value)
            if root is not None:
                before = fn(max(float(start_jd), root - classify_window))
                after = fn(min(float(end_jd), root + classify_window))
                roots.append((root, before, after))
        left = right
        left_value = right_value
    return roots


def _bisect_root(
    fn: Callable[[float], float],
    left: float,
    right: float,
    left_value: float,
    right_value: float,
) -> float | None:
    if abs(left_value) <= 1e-14:
        return float(left)
    if abs(right_value) <= 1e-14:
        return float(right)
    if left_value * right_value > 0.0:
        return None
    lo = float(left)
    hi = float(right)
    flo = float(left_value)
    for _index in range(80):
        mid = (lo + hi) / 2.0
        fmid = fn(mid)
        if abs(fmid) <= 1e-14 or hi - lo <= _ROOT_TOLERANCE_DAYS:
            return mid
        if flo * fmid <= 0.0:
            hi = mid
        else:
            lo = mid
            flo = fmid
    return (lo + hi) / 2.0


def _dedupe_events(events: list[LunarCycleEvent]) -> list[LunarCycleEvent]:
    out: list[LunarCycleEvent] = []
    for event in sorted(events, key=lambda item: (item.jd_ut, item.code)):
        if any(
            previous.code == event.code
            and abs(previous.jd_ut - event.jd_ut) <= _DEDUP_WINDOW_DAYS
            for previous in out[-4:]
        ):
            continue
        out.append(event)
    return out


def _ordered_range(start_jd: float, end_jd: float) -> tuple[float, float]:
    start = float(start_jd)
    end = float(end_jd)
    return (start, end) if start <= end else (end, start)
