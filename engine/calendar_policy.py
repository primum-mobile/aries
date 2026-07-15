# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Canonical automatic calendar policy shared by fast input and chart derivation."""

CALENDAR_GREGORIAN = "gregorian"
CALENDAR_JULIAN = "julian"
GREGORIAN_CUTOVER = (1582, 10, 15)

# 1582-10-15 00:00 Gregorian, the first instant on the automatic Gregorian side.
GREGORIAN_CUTOVER_JD = 2299160.5


def calendar_for_date(year: int, month: int, day: int) -> str:
    fields = (int(year), int(month), int(day))
    return CALENDAR_GREGORIAN if fields >= GREGORIAN_CUTOVER else CALENDAR_JULIAN


def calendar_for_jd(jd: float) -> str:
    return CALENDAR_GREGORIAN if float(jd) >= GREGORIAN_CUTOVER_JD else CALENDAR_JULIAN
