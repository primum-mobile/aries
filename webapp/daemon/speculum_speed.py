# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Display semantics for the Inspector's compact planetary-speed column.

The relative reference values are the deterministic, J2000-centred form of
the existing ``speedswnd.py`` convention: mean absolute longitude speed over a
1,000-year window, sampled every 500 days.  Keeping the sampled references as
constants preserves that established percentage while avoiding thousands of
Swiss Ephemeris calls whenever the Inspector refreshes after chart stepping.
"""

from __future__ import annotations

from typing import Final

import astrology


SPEED_DISPLAY_WORDS: Final = "words"
SPEED_DISPLAY_PERCENT: Final = "percent"
SPEED_DISPLAY_DAILY: Final = "daily"
SPEED_DISPLAY_MODES: Final = (
    SPEED_DISPLAY_WORDS,
    SPEED_DISPLAY_PERCENT,
    SPEED_DISPLAY_DAILY,
)

# speedswnd.py DYN_MEAN_DAYS=365000 / DYN_MEAN_STEP=500, sampled around
# JD 2451545.0 with SEFLG_SWIEPH | SEFLG_SPEED.  Values are degrees/day.
RELATIVE_SPEED_REFERENCE_DEG_PER_DAY: Final = {
    astrology.SE_SUN: 0.9856031716784196,
    astrology.SE_MOON: 13.174957841999344,
    astrology.SE_MERCURY: 1.2140453435167389,
    astrology.SE_VENUS: 1.0393642662839766,
    astrology.SE_MARS: 0.5662727448482726,
    astrology.SE_JUPITER: 0.13299894660000444,
    astrology.SE_SATURN: 0.06952800973078724,
    astrology.SE_URANUS: 0.03358185443738891,
    astrology.SE_NEPTUNE: 0.021213084502478947,
    astrology.SE_PLUTO: 0.01649627308664681,
    astrology.SE_MEAN_NODE: 0.052953776357837254,
    astrology.SE_CHIRON: 0.04989634307158842,
}

# Existing Aries motion-quality bands (engine.morin_chart.motion_quality), now
# applied to the same relative basis as the percentage display.
STATIONARY_MAX_PERCENT: Final = 10.0
SLOW_BELOW_PERCENT: Final = 80.0
FAST_ABOVE_PERCENT: Final = 120.0


def normalize_speed_display_mode(value: object) -> str:
    mode = str(value or SPEED_DISPLAY_DAILY)
    return mode if mode in SPEED_DISPLAY_MODES else SPEED_DISPLAY_DAILY


def relative_speed_percent(body_id: int, speed_deg_per_day: float) -> float | None:
    """Signed speed percentage, where the existing sampled reference is 100%."""
    reference = RELATIVE_SPEED_REFERENCE_DEG_PER_DAY.get(int(body_id))
    if reference is None or reference <= 0.0:
        return None
    try:
        return float(speed_deg_per_day) / reference * 100.0
    except (TypeError, ValueError):
        return None


def motion_word(
    body_id: int,
    speed_deg_per_day: float,
    station_marker: str | None = None,
) -> tuple[str, str | None] | None:
    """Return (localized-label key, motion suffix key) for one body."""
    percent = relative_speed_percent(body_id, speed_deg_per_day)
    if percent is None:
        return None
    magnitude = abs(percent)
    if magnitude <= STATIONARY_MAX_PERCENT:
        marker = str(station_marker or "").upper()
        if marker in {"SR", "SD"}:
            return ("Station", marker[-1])
    if magnitude < SLOW_BELOW_PERCENT:
        key = "SpeedMotionSlow"
    elif magnitude > FAST_ABOVE_PERCENT:
        key = "SpeedMotionFast"
    else:
        key = "SpeedMotionNormal"
    return (key, "R" if percent < 0.0 else None)
