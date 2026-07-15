# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Morinus spotlight date/time parser.

Freeform human input -> structured date/time dict.

Disambiguation rules:
  - Euro day-first by default: 24 12 00 -> 24 Dec 2000
  - US fallback when first <= 12 and second > 12: 5 17 93 -> 17 May 1993
  - Year-first when first token > 31 or >= 100: 2000 1 2 -> 2 Jan 2000
  - Month names always recognised: jan 2 00, june 8th 96
  - Time via colon/dot (14:32, 4.19) or trailing space-separated nums
  - am/pm supported: 2pm, 4:13am
  - Two-digit years: 0-30 -> 2000s, 31-99 -> 1900s
"""

import re
from dataclasses import dataclass
from typing import Optional

from engine.calendar_policy import (
    CALENDAR_GREGORIAN,
    CALENDAR_JULIAN,
    GREGORIAN_CUTOVER,
    calendar_for_date,
)

MONTHS = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'june': 6, 'july': 7, 'august': 8, 'september': 9,
    'october': 10, 'november': 11, 'december': 12,
}

DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


def _julian_day_number(year: int, month: int, day: int, calendar: str) -> int:
    a = (14 - int(month)) // 12
    y = int(year) + 4800 - a
    m = int(month) + 12 * a - 3
    if calendar == CALENDAR_JULIAN:
        return int(day) + (153 * m + 2) // 5 + 365 * y + y // 4 - 32083
    return (
        int(day)
        + (153 * m + 2) // 5
        + 365 * y
        + y // 4
        - y // 100
        + y // 400
        - 32045
    )


@dataclass
class ParsedDateTime:
    day: Optional[int] = None
    month: Optional[int] = None
    year: Optional[int] = None
    hour: Optional[int] = None
    minute: Optional[int] = None
    second: Optional[int] = None
    location_query: str = ''
    calendar: Optional[str] = None

    @property
    def has_date(self) -> bool:
        return self.day is not None and self.month is not None and self.year is not None

    @property
    def has_time(self) -> bool:
        return self.hour is not None

    def format(self) -> str:
        """Human-readable expansion: 'Sun 2 Jan 2000 · 03:04'"""
        parts = []

        if self.has_date:
            try:
                calendar = self.calendar or calendar_for_date(self.year, self.month, self.day)
                parts.append(DAY_ABBR[_julian_day_number(
                    self.year, self.month, self.day, calendar,
                ) % 7])
            except (TypeError, ValueError):
                pass

        if self.day is not None:
            parts.append(str(self.day))
        if self.month is not None and 1 <= self.month <= 12:
            parts.append(MONTH_ABBR[self.month])
        if self.year is not None:
            parts.append(str(self.year))

        out = ' '.join(parts)

        if self.has_time:
            t = f'{self.hour:02d}:{self.minute:02d}'
            if self.second:
                t += f':{self.second:02d}'
            out += (' \u00b7 ' if out else '') + t

        return out


@dataclass(frozen=True)
class ResolvedCivilDateTime:
    year: int
    month: int
    day: int
    hour: int
    minute: int
    second: int
    calendar: str

    def as_tuple(self) -> tuple[int, int, int, int, int, int]:
        return (self.year, self.month, self.day, self.hour, self.minute, self.second)


def resolve_datetime(
    parsed: ParsedDateTime,
    anchor=None,
) -> Optional[ResolvedCivilDateTime]:
    """Merge partial Spotlight input with an anchor using the auto calendar."""
    if anchor is None:
        from datetime import datetime
        anchor = datetime.now()
    year = parsed.year if parsed.year is not None else int(anchor.year)
    month = parsed.month if parsed.month is not None else int(anchor.month)
    day = parsed.day if parsed.day is not None else int(anchor.day)
    if parsed.has_time:
        hour = parsed.hour if parsed.hour is not None else int(anchor.hour)
        minute = parsed.minute if parsed.minute is not None else 0
        second = parsed.second if parsed.second is not None else 0
    elif any(getattr(parsed, attr, None) is not None for attr in ('day', 'month', 'year')):
        hour, minute, second = 12, 0, 0
    else:
        hour, minute, second = int(anchor.hour), int(anchor.minute), int(anchor.second)

    try:
        year, month, day = int(year), int(month), int(day)
        hour, minute, second = int(hour), int(minute), int(second)
        calendar = calendar_for_date(year, month, day)
        if not 1 <= month <= 12:
            return None
        # The full chart still contains datetime-backed subsystems (notably
        # Firdaria), so keep the accepted civil domain representable by Python
        # even when the astronomical calendar flag is Julian. Calendar choice,
        # weekday and JD semantics remain Julian; Julian-only leap dates stay
        # rejected until those downstream modules become calendar-aware.
        supported_max_day = _days_in(month, year, CALENDAR_GREGORIAN)
        if not 1 <= day <= supported_max_day:
            return None
        if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
            return None
    except (TypeError, ValueError):
        return None
    return ResolvedCivilDateTime(
        year, month, day, hour, minute, second, calendar,
    )


def _is_leap(y: int, calendar: str) -> bool:
    if calendar == CALENDAR_JULIAN:
        return y % 4 == 0
    return (y % 4 == 0 and y % 100 != 0) or y % 400 == 0


def _days_in(m: int, y: int, calendar: str) -> int:
    if m == 2 and _is_leap(y, calendar):
        return 29
    return DAYS_IN_MONTH[m]


def _expand_year(v: int) -> int:
    if v >= 100:
        return v
    return 2000 + v if v <= 30 else 1900 + v


def _assign_day_month(a: int, b: int):
    """Euro-first disambiguation for two numbers that are day and month."""
    if a > 12 and b <= 12:
        return a, b  # a must be day
    if b > 12 and a <= 12:
        return b, a  # b must be day, a is month (US)
    return a, b      # ambiguous -> euro default (a=day, b=month)


def parse(raw: str) -> Optional[ParsedDateTime]:
    """Parse freeform date/time string. Returns None on empty or invalid input."""
    s = raw.strip().lower()
    s = re.sub(r',', ' ', s)
    s = re.sub(r'(\d)(st|nd|rd|th)\b', r'\1', s)
    if not s:
        return None

    hour = minute = second = None
    ampm = None

    # extract am/pm
    am_match = re.search(r'(am|pm)\b', s)
    if am_match:
        ampm = am_match.group(1)
        s = re.sub(r'(am|pm)\b', '', s).strip()

    # extract explicit time. Dot time is limited to HH.MM so dotted
    # dates like 23.2.88 are not partially consumed as invalid times.
    tm = re.search(r'\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b', s)
    if tm is None:
        tm = re.search(r'(?<![.\d])(\d{1,2})\.(\d{2})(?!\.\d)', s)
    if tm:
        hour, minute = int(tm.group(1)), int(tm.group(2))
        second = int(tm.group(3)) if tm.lastindex and tm.lastindex >= 3 and tm.group(3) else 0
        s = s.replace(tm.group(0), '', 1).strip()

    # standalone hour [minute] before am/pm: "2pm", "11am", "4 19pm"
    if tm is None and ampm:
        duo = re.search(r'\b(\d{1,2})\s+(\d{1,2})\s*$', s)
        if duo:
            duo_hour, duo_minute = int(duo.group(1)), int(duo.group(2))
            if 0 <= duo_hour <= 23 and 0 <= duo_minute <= 59:
                hour, minute, second = duo_hour, duo_minute, 0
                s = s[:duo.start()].strip()
            else:
                duo = None
        if duo is None:
            solo = re.search(r'(\d{1,2})\s*$', s)
            if solo:
                hour, minute, second = int(solo.group(1)), 0, 0
                s = s[:solo.start()].strip()

    # apply am/pm
    if ampm and hour is not None:
        if ampm == 'pm' and hour < 12:
            hour += 12
        if ampm == 'am' and hour == 12:
            hour = 0

    # extract month name
    month = None
    month_name_found = False
    for name, num in MONTHS.items():
        if re.search(rf'\b{name}\b', s):
            month = num
            month_name_found = True
            s = re.sub(rf'\b{name}\b', '', s, count=1).strip()
            break

    # 4-digit HHMM time: "1630" -> 16:30
    # Skip obvious day/year forms like "18 apr 2026" or "apr 2026".
    if tm is None and hour is None and month_name_found:
        month_nums = [int(x) for x in s.split() if x.isdigit() or (x.lstrip('-').isdigit())]
        obvious_year_shape = (
            len(month_nums) == 1 and month_nums[0] > 31
        ) or (
            len(month_nums) == 2 and any(v <= 31 for v in month_nums) and any(v > 31 for v in month_nums)
        )
        if not obvious_year_shape:
            for m4 in re.finditer(r'\b(\d{4})\b', s):
                val = int(m4.group(1))
                hh, mm = divmod(val, 100)
                if 0 <= hh <= 23 and 0 <= mm <= 59 and mm != 0:
                    hour, minute, second = hh, mm, 0
                    s = s.replace(m4.group(0), '', 1).strip()
                    break

    # tokenize remaining numbers
    s = re.sub(r'[/\-.]', ' ', s)
    nums = [int(x) for x in s.split() if x.isdigit() or (x.lstrip('-').isdigit())]

    day = year = None

    if month_name_found:
        if len(nums) >= 4 and hour is None:
            # day year hour minute
            if nums[0] > 31:
                year, day = _expand_year(nums[0]), nums[1]
            elif nums[1] > 31:
                day, year = nums[0], _expand_year(nums[1])
            else:
                day, year = nums[0], _expand_year(nums[1])
            hour, minute = nums[2], nums[3]
            second = nums[4] if len(nums) > 4 else 0
        elif len(nums) == 3 and hour is None:
            if nums[0] > 31:
                year, day = _expand_year(nums[0]), nums[1]
                hour, minute, second = nums[2], 0, 0
            elif nums[1] > 31:
                day, year = nums[0], _expand_year(nums[1])
                hour, minute, second = nums[2], 0, 0
            else:
                day = nums[0]
                hour, minute, second = nums[1], nums[2], 0
        elif len(nums) == 2:
            if nums[0] > 31:
                year, day = _expand_year(nums[0]), nums[1]
            elif nums[1] > 31:
                day, year = nums[0], _expand_year(nums[1])
            else:
                day, year = nums[0], _expand_year(nums[1])
        elif len(nums) == 1:
            if nums[0] > 31:
                year = _expand_year(nums[0])
            else:
                day = nums[0]
    else:
        if len(nums) >= 5 and hour is None:
            a, b, c = nums[0], nums[1], nums[2]
            if a > 31 or a >= 100:
                year = _expand_year(a)
                day, month = _assign_day_month(b, c)
            elif c > 31 or c >= 100:
                year = _expand_year(c)
                day, month = _assign_day_month(a, b)
            else:
                day, month = _assign_day_month(a, b)
                year = _expand_year(c)
            hour, minute = nums[3], nums[4]
            second = nums[5] if len(nums) > 5 else 0
        elif len(nums) == 4 and hour is None:
            a, b, c = nums[0], nums[1], nums[2]
            if a > 31 or a >= 100:
                year = _expand_year(a)
                day, month = _assign_day_month(b, c)
            elif c > 31 or c >= 100:
                year = _expand_year(c)
                day, month = _assign_day_month(a, b)
            else:
                day, month = _assign_day_month(a, b)
                year = _expand_year(c)
            hour, minute, second = nums[3], 0, 0
        elif len(nums) == 3:
            a, b, c = nums[0], nums[1], nums[2]
            if a > 31 or a >= 100:
                year = _expand_year(a)
                day, month = _assign_day_month(b, c)
            elif c > 31 or c >= 100:
                year = _expand_year(c)
                day, month = _assign_day_month(a, b)
            else:
                day, month = _assign_day_month(a, b)
                year = _expand_year(c)
        elif len(nums) == 2 and month is None:
            day, month = _assign_day_month(nums[0], nums[1])
        elif len(nums) == 1 and month is None:
            if nums[0] > 31:
                year = _expand_year(nums[0])
            else:
                day = nums[0]

    # validate
    if month is not None and not (1 <= month <= 12):
        return None
    calendar = None
    if day is not None and year is not None and month is not None:
        calendar = calendar_for_date(year, month, day)
        if not (1 <= day <= _days_in(month, year, CALENDAR_GREGORIAN)):
            return None
    elif day is not None and not (1 <= day <= 31):
        return None
    if hour is not None and not (0 <= hour <= 23):
        return None
    if minute is not None and not (0 <= minute <= 59):
        return None
    if second is not None and not (0 <= second <= 59):
        return None

    result = ParsedDateTime(day=day, month=month, year=year,
                            hour=hour, minute=minute, second=second or 0,
                            calendar=calendar)

    # return None if we got nothing useful
    if day is None and month is None and year is None and hour is None:
        return None

    return result


def parse_spotlight(raw: str) -> Optional[ParsedDateTime]:
    """Parse spotlight input with optional freeform location before/after datetime."""
    def _looks_like_location(text):
        text = (text or '').strip()
        if not text or any(ch.isdigit() for ch in text):
            return False
        tokens = text.lower().split()
        if not any(ch.isalpha() for ch in text):
            return False
        if any(token in ('am', 'pm') for token in tokens):
            return False
        if any(token in MONTHS for token in tokens):
            return False
        return True

    def _is_location_token(token):
        token = (token or '').strip().lower()
        if not token or not token.isalpha():
            return False
        if token in ('am', 'pm'):
            return False
        if token in MONTHS:
            return False
        return True

    def _has_temporal(parsed):
        if parsed is None:
            return False
        if parsed.has_date or parsed.has_time:
            return True
        return any(
            getattr(parsed, attr, None) is not None
            for attr in ('day', 'month', 'year')
        )

    has_letters = any(ch.isalpha() for ch in (raw or ''))
    base = parse(raw)
    if base is not None and has_letters is False:
        return base

    text = (raw or '').strip()
    if not text:
        return base

    candidates = []
    if base is not None and not has_letters:
        candidates.append((0, base, ''))

    parts = text.split()
    if len(parts) >= 2:
        for idx in range(1, len(parts)):
            left = ' '.join(parts[:idx]).strip(' ,')
            right = ' '.join(parts[idx:]).strip(' ,')
            if _looks_like_location(left):
                parsed = parse(right)
                if _has_temporal(parsed):
                    candidates.append((idx, parsed, left))
            if _looks_like_location(right):
                parsed = parse(left)
                if _has_temporal(parsed):
                    candidates.append((len(parts) - idx, parsed, right))

        # Also allow the location chunk to sit between date and time, e.g. "23 2 88 paris 4 pm".
        for start in range(len(parts)):
            if not _is_location_token(parts[start]):
                continue
            end = start
            while end + 1 < len(parts) and _is_location_token(parts[end + 1]):
                end += 1
            location = ' '.join(parts[start:end + 1]).strip(' ,')
            remaining = ' '.join(parts[:start] + parts[end + 1:]).strip(' ,')
            parsed = parse(remaining)
            if _has_temporal(parsed):
                candidates.append((0, parsed, location))

    if not candidates:
        if base is None and _looks_like_location(text):
            return ParsedDateTime(location_query=text.strip(' ,'))
        return base

    score, parsed, location = min(
        candidates,
        key=lambda item: (
            0 if item[2] else 1,
            -(len(item[2].split()) if item[2] else 0),
            0 if item[1].has_time else 1,
            item[0],
        ),
    )
    parsed.location_query = location.strip(' ,')
    return parsed


# ── quick test ──────────────────────────────────────────────

if __name__ == '__main__':
    tests = [
        '24 12 88',
        '5 17 93',
        '1 3 03',
        '2 jan 00',
        'jan 2 00',
        'jan 2 00 3 4',
        '2000 1 2',
        '1 jan 2003 14.34',
        'jan 1 2000 2pm',
        'june 8th 96 4:13am',
        '15.3.1987 14:32',
        '6 7 85',
        '12 11 90',
        '11 12 90',
        '1987-03-15',
    ]
    for t in tests:
        r = parse(t)
        print(f'  {t:30s} -> {r.format() if r else "—"}')
