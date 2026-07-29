# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Canonical dual-clock math for converse transits.

A converse transit is calculated at the physical prenatal epoch ``P`` while
the user navigates the mirrored symbolic epoch ``S``:

    S = 2B - P
    P = 2B - S

where ``B`` is the radix Julian day.  Keeping this involution in one engine
module prevents Search, supplementary chart construction, and stepping from
quietly adopting different clocks.
"""

from __future__ import annotations

import astrology
import chart
import util


def mirrored_jd(birth_jd: float, event_jd: float) -> float:
    """Mirror ``event_jd`` across the radix epoch.

    The operation is its own inverse, so the same function maps physical to
    symbolic time and symbolic back to physical time.
    """

    return (2.0 * float(birth_jd)) - float(event_jd)


def calendar_flag(calendar: int) -> int:
    return (
        astrology.SE_JUL_CAL
        if int(calendar) == chart.Time.JULIAN
        else astrology.SE_GREG_CAL
    )


def jd_to_utc_tuple(jd_value: float, calendar: int) -> tuple[int, int, int, int, int, int]:
    """Convert an exact UT Julian day to rounded civil UT fields."""

    year, month, day, hour = astrology.swe_revjul(
        float(jd_value),
        calendar_flag(calendar),
    )
    total_seconds = int(round(float(hour) * 3600.0))
    if total_seconds >= 24 * 3600:
        total_seconds -= 24 * 3600
        year, month, day = util.incrDay(int(year), int(month), int(day))
    elif total_seconds < 0:
        total_seconds += 24 * 3600
        year, month, day = util.decrDay(int(year), int(month), int(day))
    hour, remainder = divmod(total_seconds, 3600)
    minute, second = divmod(remainder, 60)
    return (
        int(year),
        int(month),
        int(day),
        int(hour),
        int(minute),
        int(second),
    )
