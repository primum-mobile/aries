# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Typed lunar-day definitions for source-aware corpus rules.

Hephaistion III.24 numbers thirty days from the Sun-Moon assembly, but the
surviving clause does not specify an intra-day computational boundary.  This
module keeps the interpretations finite and explicit:

``elapsed_24h_from_exact_assembly``
    Rolling 24-hour periods from the exact prior geocentric conjunction.
``equal_12_degree_elongation``
    Thirty equal sectors of directed Moon-minus-Sun elongation (tithi).
``mean_lunation``
    Thirty equal temporal divisions of the mean synodic month.
``source_phrase_only``
    A deliberate fail-closed audit setting; it never yields a day number.

The exact-assembly search is geocentric and tropical.  A Sun-Moon longitude
difference is ayanamsa-invariant, and source lunar days must not change merely
because the displayed chart is sidereal or topocentric.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import math

import astrology
import common
import lunar
from aries.astrology.ephemeris_context import EphemerisContext


POLICY_ELAPSED_24H = "elapsed_24h_from_exact_assembly"
POLICY_EQUAL_ELONGATION = "equal_12_degree_elongation"
POLICY_MEAN_LUNATION = "mean_lunation"
POLICY_SOURCE_PHRASE_ONLY = "source_phrase_only"
LUNAR_DAY_POLICIES = frozenset({
    POLICY_ELAPSED_24H,
    POLICY_EQUAL_ELONGATION,
    POLICY_MEAN_LUNATION,
    POLICY_SOURCE_PHRASE_ONLY,
})

_SEARCH_STEP_DAYS = 0.5
_SEARCH_HORIZON_DAYS = 35.0
_ROOT_TOLERANCE_DAYS = 0.001 / 86400.0
_EXACT_RESIDUAL_DEGREES = 2.0e-7

LUNAR_PHASE_ANGLES = {
    "assembly": 0.0,
    "new_moon": 0.0,
    "one_sign_after_assembly": 30.0,
    "diameter": 180.0,
    "full_moon": 180.0,
}


@dataclass(frozen=True, slots=True)
class LunarDayState:
    """One measured lunar-day result under a named finite policy."""

    policy: str
    day: int
    jd_ut: float
    method: str
    elongation: float | None = None
    sector_start: float | None = None
    sector_end: float | None = None
    prior_assembly_jd: float | None = None
    elapsed_days: float | None = None
    mean_age_days: float | None = None


@dataclass(frozen=True, slots=True)
class LunarPhaseRoots:
    """Exact roots bracketing one directed Moon-minus-Sun phase angle."""

    phase: str
    target_angle: float
    jd_ut: float
    elongation: float
    prior_jd: float
    next_jd: float

    @property
    def nearest_jd(self) -> float:
        prior_distance = abs(self.jd_ut - self.prior_jd)
        next_distance = abs(self.next_jd - self.jd_ut)
        return self.prior_jd if prior_distance <= next_distance else self.next_jd

    @property
    def signed_days(self) -> float:
        """Nearest exact event minus the chart instant, in UT days."""
        return self.nearest_jd - self.jd_ut


def lunar_day_state(chrt, policy: str) -> LunarDayState | None:
    """Return the current lunar day under ``policy`` or fail closed.

    Unknown policies and ``source_phrase_only`` deliberately return ``None``.
    The latter preserves the source wording without pretending that the text
    itself supplied a numerical boundary.
    """
    selected = _normalise_policy(policy)
    if selected is None or selected == POLICY_SOURCE_PHRASE_ONLY:
        return None
    try:
        jd_ut = float(chrt.time.jd)
    except (AttributeError, TypeError, ValueError):
        return None
    if not math.isfinite(jd_ut):
        return None

    if selected == POLICY_MEAN_LUNATION:
        age = (
            (jd_ut - lunar.MEAN_NM_REFERENCE_JD)
            % lunar.SYNODIC_MONTH_DAYS
        )
        day = int(age / (lunar.SYNODIC_MONTH_DAYS / 30.0)) + 1
        return LunarDayState(
            policy=selected,
            day=min(30, max(1, day)),
            jd_ut=jd_ut,
            method="mean-synodic-cycle",
            mean_age_days=age,
        )

    ephe_path = common.get_ephe_path()
    try:
        elongation = _elongation_at_cached(round(jd_ut, 10), ephe_path)
    except Exception:
        return None

    if selected == POLICY_EQUAL_ELONGATION:
        day = int(elongation // lunar.TITHI_DEG) + 1
        day = min(30, max(1, day))
        return LunarDayState(
            policy=selected,
            day=day,
            jd_ut=jd_ut,
            method="geocentric-elongation-sector",
            elongation=elongation,
            sector_start=(day - 1) * lunar.TITHI_DEG,
            sector_end=day * lunar.TITHI_DEG,
        )

    try:
        assembly_jd = _prior_assembly_jd_cached(
            round(jd_ut, 10), ephe_path,
        )
    except Exception:
        return None
    if assembly_jd is None:
        return None
    elapsed = jd_ut - float(assembly_jd)
    # A true synodic month is about 29.53 days.  The loose upper bound rejects
    # a stale/mis-bracketed root without truncating any physical lunation.
    if not math.isfinite(elapsed) or elapsed < -_ROOT_TOLERANCE_DAYS or elapsed >= 31.0:
        return None
    elapsed = max(0.0, elapsed)
    day = int(math.floor(elapsed)) + 1
    if not 1 <= day <= 30:
        return None
    return LunarDayState(
        policy=selected,
        day=day,
        jd_ut=jd_ut,
        method="exact-prior-assembly-plus-24h",
        elongation=elongation,
        prior_assembly_jd=float(assembly_jd),
        elapsed_days=elapsed,
    )


def prior_lunar_assembly_jd(chrt, jd_ut: float | None = None) -> float | None:
    """Return the exact geocentric Sun-Moon conjunction at or before ``jd``."""
    try:
        instant = float(chrt.time.jd if jd_ut is None else jd_ut)
    except (AttributeError, TypeError, ValueError):
        return None
    if not math.isfinite(instant):
        return None
    try:
        return _prior_assembly_jd_cached(
            round(instant, 10), common.get_ephe_path(),
        )
    except Exception:
        return None


def lunar_phase_roots(
        chrt, phase: str, jd_ut: float | None = None,
) -> LunarPhaseRoots | None:
    """Return exact geocentric tropical phase roots around the chart instant.

    The root is an astronomical event, never a present-chart aspect orb.  The
    caller remains responsible for choosing an explicit temporal admission
    policy around that event.
    """
    selected = _normalise_phase(phase)
    if selected is None:
        return None
    try:
        instant = float(chrt.time.jd if jd_ut is None else jd_ut)
    except (AttributeError, TypeError, ValueError):
        return None
    if not math.isfinite(instant):
        return None
    target = LUNAR_PHASE_ANGLES[selected]
    ephe_path = common.get_ephe_path()
    try:
        rounded = round(instant, 10)
        elongation = _elongation_at_cached(rounded, ephe_path)
        prior = _prior_phase_jd_cached(rounded, target, ephe_path)
        following = _next_phase_jd_cached(rounded, target, ephe_path)
    except Exception:
        return None
    if prior is None or following is None:
        return None
    return LunarPhaseRoots(
        phase=selected,
        target_angle=target,
        jd_ut=instant,
        elongation=float(elongation),
        prior_jd=float(prior),
        next_jd=float(following),
    )


def _normalise_policy(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    selected = value.strip().lower().replace("-", "_")
    return selected if selected in LUNAR_DAY_POLICIES else None


def _normalise_phase(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    selected = value.strip().lower().replace("-", "_")
    return selected if selected in LUNAR_PHASE_ANGLES else None


def _ephemeris_context(ephe_path: str) -> EphemerisContext:
    return EphemerisContext(
        flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
        ephe_path=ephe_path,
    )


@lru_cache(maxsize=2048)
def _elongation_at_cached(jd_ut: float, ephe_path: str) -> float:
    context = _ephemeris_context(ephe_path)
    with context.activate():
        _sun_flag, sun, _sun_error = astrology.swe_calc_ut_ex(
            float(jd_ut), astrology.SE_SUN, context.flags,
        )
        _moon_flag, moon, _moon_error = astrology.swe_calc_ut_ex(
            float(jd_ut), astrology.SE_MOON, context.flags,
        )
    if len(sun) < 1 or len(moon) < 1:
        raise RuntimeError("Swiss Ephemeris returned incomplete luminary states")
    return (float(moon[0]) - float(sun[0])) % 360.0


def _signed_assembly_residual(jd_ut: float, ephe_path: str) -> float:
    return _signed_phase_residual(jd_ut, 0.0, ephe_path)


def _signed_phase_residual(
        jd_ut: float, target_angle: float, ephe_path: str,
) -> float:
    elongation = _elongation_at_cached(round(float(jd_ut), 10), ephe_path)
    return ((elongation - float(target_angle) + 180.0) % 360.0) - 180.0


@lru_cache(maxsize=1024)
def _prior_assembly_jd_cached(jd_ut: float, ephe_path: str) -> float | None:
    """Find the conjunction at or before ``jd_ut`` with a bounded root search."""
    return _prior_phase_jd_cached(jd_ut, 0.0, ephe_path)


@lru_cache(maxsize=2048)
def _prior_phase_jd_cached(
        jd_ut: float, target_angle: float, ephe_path: str,
) -> float | None:
    """Find the named directed phase root at or before ``jd_ut``."""
    instant = float(jd_ut)
    current = _elongation_at_cached(round(instant, 10), ephe_path)
    target = float(target_angle) % 360.0
    current_phase = (current - target) % 360.0
    current_residual = ((current_phase + 180.0) % 360.0) - 180.0
    if abs(current_residual) <= _EXACT_RESIDUAL_DEGREES:
        return instant

    newer_jd = instant
    newer_phase = current_phase
    steps = int(math.ceil(_SEARCH_HORIZON_DAYS / _SEARCH_STEP_DAYS))
    for index in range(1, steps + 1):
        older_jd = instant - index * _SEARCH_STEP_DAYS
        older_elongation = _elongation_at_cached(
            round(older_jd, 10), ephe_path,
        )
        older_phase = (older_elongation - target) % 360.0
        # Traversing backward across the requested event changes its phase
        # from a small positive value to one near 360 degrees.  This wrap test
        # cannot confuse the signed-residual discontinuity at the opposite
        # phase for the requested root.
        if older_phase > newer_phase + 180.0:
            return _bisect_phase_root(
                older_jd, newer_jd, target, ephe_path,
            )
        newer_jd = older_jd
        newer_phase = older_phase
    return None


@lru_cache(maxsize=2048)
def _next_phase_jd_cached(
        jd_ut: float, target_angle: float, ephe_path: str,
) -> float | None:
    """Find the named directed phase root at or after ``jd_ut``."""
    instant = float(jd_ut)
    current = _elongation_at_cached(round(instant, 10), ephe_path)
    target = float(target_angle) % 360.0
    current_phase = (current - target) % 360.0
    current_residual = ((current_phase + 180.0) % 360.0) - 180.0
    if abs(current_residual) <= _EXACT_RESIDUAL_DEGREES:
        return instant

    older_jd = instant
    older_phase = current_phase
    steps = int(math.ceil(_SEARCH_HORIZON_DAYS / _SEARCH_STEP_DAYS))
    for index in range(1, steps + 1):
        newer_jd = instant + index * _SEARCH_STEP_DAYS
        newer_elongation = _elongation_at_cached(
            round(newer_jd, 10), ephe_path,
        )
        newer_phase = (newer_elongation - target) % 360.0
        if newer_phase + 180.0 < older_phase:
            return _bisect_phase_root(
                older_jd, newer_jd, target, ephe_path,
            )
        older_jd = newer_jd
        older_phase = newer_phase
    return None


def _bisect_assembly_root(left: float, right: float, ephe_path: str) -> float | None:
    return _bisect_phase_root(left, right, 0.0, ephe_path)


def _bisect_phase_root(
        left: float, right: float, target_angle: float, ephe_path: str,
) -> float | None:
    lo = float(left)
    hi = float(right)
    flo = _signed_phase_residual(lo, target_angle, ephe_path)
    fhi = _signed_phase_residual(hi, target_angle, ephe_path)
    if abs(flo) <= _EXACT_RESIDUAL_DEGREES:
        return lo
    if abs(fhi) <= _EXACT_RESIDUAL_DEGREES:
        return hi
    if flo >= 0.0 or fhi <= 0.0:
        return None
    for _index in range(80):
        mid = (lo + hi) / 2.0
        fmid = _signed_phase_residual(mid, target_angle, ephe_path)
        if (
            abs(fmid) <= _EXACT_RESIDUAL_DEGREES
            or hi - lo <= _ROOT_TOLERANCE_DAYS
        ):
            return mid
        if fmid < 0.0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0
