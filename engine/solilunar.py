# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Soli-lunar phase return helpers.

The Jonas / embolismic lunar point is the recurrence of the natal Sun-Moon
phase angle, not the Moon's return to natal longitude.  This module only solves
the astronomical event; interpretation belongs elsewhere.
"""
from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Optional

import astrology
import chart
import planets
import util


RETURN_MODE_LUNAR = "lunar"
RETURN_MODE_SOLILUNAR = "soli_lunar"
RETURN_MODE_JONAS_ARC = "jonas_arc"
RETURN_MODE_TITHI_PRAVESHA = "tithi_pravesha"
RETURN_BRANCH_ANY = "any"
RETURN_BRANCH_DIRECTED = "directed"
RETURN_BRANCH_MIRROR = "mirror"

_FLAGS = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
_STEP_DAYS = 0.5
_ROOT_TOLERANCE_DAYS = 1.0 / 86400.0


@dataclass(frozen=True)
class SoliLunarReturn:
    jd_ut: float
    datetime: tuple[int, int, int, int, int, int]
    target_phase: Optional[float] = None
    branch: str = RETURN_BRANCH_DIRECTED


def normalize_return_mode(value) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in {"jonas", "jonas_arc", "jonasarc"}:
        return RETURN_MODE_JONAS_ARC
    if normalized in {"soli_lunar", "solilunar", "embolismic", "phase", "phase_return"}:
        return RETURN_MODE_SOLILUNAR
    return RETURN_MODE_LUNAR


def normalize_return_branch(value) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in {"phase", "directed", "same_phase", "natal_phase"}:
        return RETURN_BRANCH_DIRECTED
    if normalized in {"mirror", "jonas_mirror", "opposite_branch", "alternate"}:
        return RETURN_BRANCH_MIRROR
    return RETURN_BRANCH_ANY


def calflag_for_chart(radix) -> int:
    if getattr(getattr(radix, "time", None), "cal", chart.Time.GREGORIAN) == chart.Time.JULIAN:
        return astrology.SE_JUL_CAL
    return astrology.SE_GREG_CAL


def datetime_to_jd(radix, value: datetime.datetime) -> float:
    hour = int(value.hour) + int(value.minute) / 60.0 + int(value.second) / 3600.0
    return float(astrology.swe_julday(int(value.year), int(value.month), int(value.day), hour, calflag_for_chart(radix)))


def jd_to_datetime_tuple(jd_ut: float, calflag: int) -> tuple[int, int, int, int, int, int]:
    year, month, day, hour = astrology.swe_revjul(float(jd_ut), int(calflag))
    total_seconds = int(round(float(hour) * 3600.0))
    while total_seconds >= 86400:
        total_seconds -= 86400
        year, month, day = util.incrDay(int(year), int(month), int(day))
    while total_seconds < 0:
        total_seconds += 86400
        year, month, day = util.decrDay(int(year), int(month), int(day))
    hh = total_seconds // 3600
    mm = (total_seconds % 3600) // 60
    ss = total_seconds % 60
    return int(year), int(month), int(day), int(hh), int(mm), int(ss)


def natal_phase_angle(radix) -> float:
    moon = float(radix.planets.planets[astrology.SE_MOON].data[planets.Planet.LONG])
    sun = float(radix.planets.planets[astrology.SE_SUN].data[planets.Planet.LONG])
    return util.normalize(moon - sun)


def natal_arc_angle(radix) -> float:
    phase = natal_phase_angle(radix)
    return abs(((phase + 180.0) % 360.0) - 180.0)


def natal_mirror_phase_angle(radix) -> float:
    return util.normalize(360.0 - natal_phase_angle(radix))


def phase_returns_in_range(
    radix,
    start_dt: datetime.datetime,
    end_dt: datetime.datetime,
    *,
    mode: str = RETURN_MODE_SOLILUNAR,
    branch: str = RETURN_BRANCH_ANY,
    inclusive_start: bool = True,
    inclusive_end: bool = False,
) -> list[SoliLunarReturn]:
    start_jd = datetime_to_jd(radix, start_dt)
    end_jd = datetime_to_jd(radix, end_dt)
    if end_jd < start_jd:
        start_jd, end_jd = end_jd, start_jd
        inclusive_start, inclusive_end = inclusive_end, inclusive_start
    requested_branch = normalize_return_branch(branch)
    targets = _target_phase_targets(radix, mode)
    calflag = calflag_for_chart(radix)
    roots: list[tuple[float, float, str]] = []
    for target, target_branch in targets:
        if requested_branch != RETURN_BRANCH_ANY and target_branch != requested_branch:
            continue
        roots.extend(
            (root, float(target), target_branch)
            for root in _directed_phase_roots(radix, start_jd, end_jd, float(target), inclusive_start, inclusive_end)
        )
    roots = _dedupe_root_events(sorted(roots, key=lambda item: item[0]))
    return [
        SoliLunarReturn(root, jd_to_datetime_tuple(root, calflag), target_phase=target, branch=target_branch)
        for root, target, target_branch in roots
    ]


def phase_return_before_datetime(
    radix,
    ref_dt: datetime.datetime,
    inclusive: bool = False,
    mode: str = RETURN_MODE_SOLILUNAR,
    branch: str = RETURN_BRANCH_ANY,
) -> Optional[SoliLunarReturn]:
    search_ref = ref_dt if inclusive else ref_dt - datetime.timedelta(seconds=2)
    for days in (45, 90, 180):
        events = phase_returns_in_range(
            radix,
            search_ref - datetime.timedelta(days=days),
            search_ref,
            mode=mode,
            branch=branch,
            inclusive_start=True,
            inclusive_end=bool(inclusive),
        )
        if events:
            return events[-1]
    return None


def phase_return_after_datetime(
    radix,
    ref_dt: datetime.datetime,
    inclusive: bool = False,
    mode: str = RETURN_MODE_SOLILUNAR,
    branch: str = RETURN_BRANCH_ANY,
) -> Optional[SoliLunarReturn]:
    search_ref = ref_dt if inclusive else ref_dt + datetime.timedelta(seconds=2)
    for days in (45, 90, 180):
        events = phase_returns_in_range(
            radix,
            search_ref,
            search_ref + datetime.timedelta(days=days),
            mode=mode,
            branch=branch,
            inclusive_start=bool(inclusive),
            inclusive_end=False,
        )
        if events:
            return events[0]
    return None


def closest_phase_return(
    radix,
    anchor_dt: datetime.datetime,
    window_days: float = 16.0,
    mode: str = RETURN_MODE_SOLILUNAR,
    branch: str = RETURN_BRANCH_ANY,
) -> Optional[SoliLunarReturn]:
    events = phase_returns_in_range(
        radix,
        anchor_dt - datetime.timedelta(days=float(window_days)),
        anchor_dt + datetime.timedelta(days=float(window_days)),
        mode=mode,
        branch=branch,
        inclusive_start=True,
        inclusive_end=True,
    )
    if not events:
        return None
    anchor_jd = datetime_to_jd(radix, anchor_dt)
    return min(events, key=lambda event: abs(float(event.jd_ut) - anchor_jd))


def phase_error_degrees(radix, jd_ut: float) -> float:
    return _phase_error(radix, jd_ut, natal_phase_angle(radix))


def arc_error_degrees(radix, jd_ut: float) -> float:
    return abs(((float(_phase(radix, jd_ut)) + 180.0) % 360.0) - 180.0) - natal_arc_angle(radix)


def _target_phase_angles(radix, mode: str) -> tuple[float, ...]:
    return tuple(target for target, _branch in _target_phase_targets(radix, mode))


def _target_phase_targets(radix, mode: str) -> tuple[tuple[float, str], ...]:
    mode = normalize_return_mode(mode)
    phase = natal_phase_angle(radix)
    if mode == RETURN_MODE_JONAS_ARC:
        mirror = natal_mirror_phase_angle(radix)
        if _angle_distance(phase, mirror) <= 1e-9:
            return ((util.normalize(phase), RETURN_BRANCH_DIRECTED),)
        return (
            (util.normalize(phase), RETURN_BRANCH_DIRECTED),
            (util.normalize(mirror), RETURN_BRANCH_MIRROR),
        )
    return ((util.normalize(phase), RETURN_BRANCH_DIRECTED),)


def _directed_phase_roots(radix, start_jd: float, end_jd: float, target: float, inclusive_start: bool, inclusive_end: bool) -> list[float]:
    roots = []
    prev_jd = float(start_jd)
    prev_err = _phase_error(radix, prev_jd, target)
    jd = min(float(end_jd), float(start_jd) + _STEP_DAYS)
    while jd <= end_jd + 1e-9:
        err = _phase_error(radix, jd, target)
        root = None
        if abs(prev_err) < 1e-9:
            root = prev_jd
        elif prev_err * err <= 0.0 and abs(prev_err - err) < 180.0:
            root = _bisect_phase_root(radix, target, prev_jd, jd, prev_err, err)
        if root is not None and _in_bounds(root, start_jd, end_jd, inclusive_start, inclusive_end):
            roots.append(root)
        prev_jd = jd
        prev_err = err
        jd = min(end_jd, jd + _STEP_DAYS)
        if abs(jd - prev_jd) < 1e-12:
            break
    return roots


def _dedupe_roots(roots: list[float]) -> list[float]:
    out = []
    for root in roots:
        if out and abs(float(root) - float(out[-1])) <= _ROOT_TOLERANCE_DAYS:
            continue
        out.append(float(root))
    return out


def _dedupe_root_events(roots: list[tuple[float, float, str]]) -> list[tuple[float, float, str]]:
    out: list[tuple[float, float, str]] = []
    for root, target, branch in roots:
        if out and abs(float(root) - float(out[-1][0])) <= _ROOT_TOLERANCE_DAYS:
            continue
        out.append((float(root), float(target), branch))
    return out


def _angle_distance(a: float, b: float) -> float:
    return abs(((float(a) - float(b) + 180.0) % 360.0) - 180.0)


def _calc_flags(radix) -> int:
    flags = _FLAGS
    opts = getattr(radix, "options", None)
    if opts is not None and int(getattr(opts, "ayanamsha", 0) or 0) != 0:
        astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(int(getattr(opts, "ayanamsha", 0))), 0, 0)
        flags |= astrology.SEFLG_SIDEREAL
    if opts is not None and bool(getattr(opts, "topocentric", False)):
        place = getattr(radix, "place", None)
        if place is not None:
            astrology.swe_set_topo(place.lon, place.lat, place.altitude)
            flags |= astrology.SEFLG_TOPOCTR
    return flags


def _longitude(radix, jd_ut: float, planet_id: int) -> float:
    _retflag, xx, _serr = astrology.swe_calc_ut_ex(float(jd_ut), int(planet_id), _calc_flags(radix))
    return float(xx[0])


def _phase(radix, jd_ut: float) -> float:
    return util.normalize(_longitude(radix, jd_ut, astrology.SE_MOON) - _longitude(radix, jd_ut, astrology.SE_SUN))


def _phase_error(radix, jd_ut: float, target: float) -> float:
    return ((float(_phase(radix, jd_ut)) - float(target) + 180.0) % 360.0) - 180.0


def _bisect_phase_root(radix, target: float, a: float, b: float, fa: float, fb: float) -> float:
    left = float(a)
    right = float(b)
    f_left = float(fa)
    f_right = float(fb)
    if abs(f_left) < 1e-9:
        return left
    if abs(f_right) < 1e-9:
        return right
    for _ in range(80):
        mid = (left + right) / 2.0
        f_mid = _phase_error(radix, mid, target)
        if abs(f_mid) < 1e-10 or abs(right - left) <= _ROOT_TOLERANCE_DAYS:
            return mid
        if f_left * f_mid <= 0.0:
            right = mid
            f_right = f_mid
        else:
            left = mid
            f_left = f_mid
    return (left + right) / 2.0


def _in_bounds(root: float, start_jd: float, end_jd: float, inclusive_start: bool, inclusive_end: bool) -> bool:
    if root < start_jd or (root == start_jd and not inclusive_start):
        return False
    if root > end_jd or (root == end_jd and not inclusive_end):
        return False
    return True
