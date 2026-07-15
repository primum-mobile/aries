# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Default-location display time for daemon event/list payloads.

Event engines keep their exact UT tuples/JDs.  This module owns the separate
presentation clock used by Search and the retained event lists: the saved
Default Location from Options.  Manual zones stay manual; automatic zones use
the event instant's IANA offset (including historical DST changes).
"""
from __future__ import annotations

import datetime
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Iterable

import chart
import default_location as default_location_model
import geonames
from engine import moment


UtcTuple = tuple[int, int, int, int, int, int]
EVENT_TABLE_TIME_DEFAULT_LOCATION = "default_location"
EVENT_TABLE_TIME_UT = "ut"
EVENT_TABLE_TIME_BASIS_VALUES = {EVENT_TABLE_TIME_DEFAULT_LOCATION, EVENT_TABLE_TIME_UT}


@dataclass(frozen=True)
class EventDisplayTime:
    values: UtcTuple
    utc_offset_minutes: int

    @property
    def iso(self) -> str:
        return "%04d-%02d-%02dT%02d:%02d:%02d" % self.values

    @property
    def time_text(self) -> str:
        return "%02d:%02d:%02d" % self.values[3:6]


def _int_option(options: Any, name: str, default: int = 0) -> int:
    try:
        return int(getattr(options, name, default) or 0)
    except (TypeError, ValueError):
        return int(default)


def _default_place(options: Any):
    try:
        return default_location_model.place_from_options(options, require_present=True)
    except Exception:
        return None


def _has_default_coordinates(options: Any) -> bool:
    return default_location_model.has_coordinates(options)


def event_table_time_basis(options: Any) -> str:
    value = str(getattr(options, "event_table_time_basis", EVENT_TABLE_TIME_DEFAULT_LOCATION) or "")
    return value if value in EVENT_TABLE_TIME_BASIS_VALUES else EVENT_TABLE_TIME_DEFAULT_LOCATION


class DefaultLocationClock:
    """Convert exact UT event tuples to the saved Default Location clock."""

    def __init__(self, options: Any, *, basis: str = EVENT_TABLE_TIME_DEFAULT_LOCATION) -> None:
        self.options = options
        self.basis = basis if basis in EVENT_TABLE_TIME_BASIS_VALUES else EVENT_TABLE_TIME_DEFAULT_LOCATION
        self.automatic = bool(getattr(options, "defloctzauto", True))
        self.place = _default_place(options) if self.automatic else None
        saved_zone_id = str(getattr(options, "defloctzid", "") or "") if self.automatic else ""
        zone_id = saved_zone_id
        # Auto TZ belongs to the Default Location coordinates.  A saved tzid
        # may be left over from the previously selected city; never let that
        # stale value override a newly selected place.
        if self.automatic and self.place is not None and _has_default_coordinates(options):
            try:
                zone_id = geonames.Geonames.get_timezone_name(
                    self.place.lon,
                    self.place.lat,
                ) or saved_zone_id
            except Exception:
                zone_id = saved_zone_id
        self.zone_id = zone_id
        self.time = SimpleNamespace(
            zt=chart.Time.ZONE,
            plus=bool(getattr(options, "deflocplus", True)),
            zh=abs(_int_option(options, "defloczhour")),
            zm=abs(_int_option(options, "defloczminute")),
            daylightsaving=bool(getattr(options, "deflocdst", False)),
            tzid=zone_id,
            tzauto=self.automatic,
        )

    def local_zone_fields(self, local_values: Iterable[Any]) -> dict[str, Any]:
        values = tuple(int(value) for value in tuple(local_values)[:6])
        if self.automatic and self.place is not None and self.zone_id:
            try:
                resolved = geonames.Geonames.resolve_zone_fields(
                    *values,
                    self.place,
                    self.zone_id,
                )
                if resolved is not None:
                    return {
                        "plus": bool(resolved["plus"]),
                        "zh": int(resolved["zh"]),
                        "zm": int(resolved["zm"]),
                        "daylightsaving": bool(resolved["daylightsaving"]),
                        "tzid": str(resolved["tzid"] or ""),
                        "tzauto": True,
                    }
            except Exception:
                pass
        return {
            "plus": bool(self.time.plus),
            "zh": int(self.time.zh),
            "zm": int(self.time.zm),
            "daylightsaving": bool(self.time.daylightsaving),
            "tzid": self.zone_id,
            "tzauto": self.automatic,
        }

    def display(self, utc_values: Iterable[Any]) -> EventDisplayTime:
        utc_tuple = tuple(int(value) for value in tuple(utc_values)[:6])
        if len(utc_tuple) != 6:
            raise ValueError("event time requires six UTC fields")
        if self.basis == EVENT_TABLE_TIME_UT:
            return EventDisplayTime(
                values=utc_tuple,  # type: ignore[arg-type]
                utc_offset_minutes=0,
            )
        converted = moment.utc_to_chart_local(
            self.time,
            utc_tuple,
            place=self.place,
        )
        local_tuple = tuple(int(value) for value in (converted or utc_tuple))
        return EventDisplayTime(
            values=local_tuple,  # type: ignore[arg-type]
            utc_offset_minutes=self._offset_minutes(utc_tuple, local_tuple),
        )

    def offsets_for_range(
        self,
        start: datetime.date,
        end: datetime.date,
    ) -> list[int]:
        """Return every effective offset in a bounded civil-date range.

        Midnight and noon samples catch both sides of ordinary DST transition
        days.  Search ranges are capped at ten years, so this remains small and
        avoids frontend timezone inference.
        """
        if self.basis == EVENT_TABLE_TIME_UT:
            return [0]
        if end < start:
            start, end = end, start
        offsets: set[int] = set()
        day = start
        while day <= end:
            for hour in (0, 12):
                offsets.add(
                    self.display((day.year, day.month, day.day, hour, 0, 0)).utc_offset_minutes
                )
            day += datetime.timedelta(days=1)
        return sorted(offsets)

    def metadata(
        self,
        base_label: str,
        *,
        offsets: Iterable[int] | None = None,
        fallback_utc: Iterable[Any] | None = None,
    ) -> dict[str, Any]:
        values = sorted({int(value) for value in (offsets or [])})
        if self.basis == EVENT_TABLE_TIME_UT:
            values = [0]
        if not values:
            if fallback_utc is None:
                now = datetime.datetime.now(datetime.timezone.utc)
                fallback_utc = (now.year, now.month, now.day, now.hour, now.minute, now.second)
            values = [self.display(fallback_utc).utc_offset_minutes]
        return {
            "basis": self.basis,
            "zoneId": "UTC" if self.basis == EVENT_TABLE_TIME_UT else self.zone_id,
            "offsetsMinutes": values,
            "columnLabel": str(base_label),
        }

    def _offset_minutes(self, utc_tuple: UtcTuple, local_tuple: UtcTuple) -> int:
        try:
            utc_dt = datetime.datetime(*utc_tuple)
            local_dt = datetime.datetime(*local_tuple)
            return int(round((local_dt - utc_dt).total_seconds() / 60.0))
        except Exception:
            standard = self.time.zh * 60 + self.time.zm
            if not self.time.plus:
                standard *= -1
            return int(standard + (60 if self.time.daylightsaving else 0))


def format_utc_offset(offset_minutes: int) -> str:
    value = int(offset_minutes)
    if value == 0:
        return "0"
    sign = "+" if value > 0 else "-"
    absolute = abs(value)
    hours, minutes = divmod(absolute, 60)
    return f"{sign}{hours}" if minutes == 0 else f"{sign}{hours}:{minutes:02d}"


def format_time_column_label(base_label: str, offsets: Iterable[int]) -> str:
    values = sorted({int(value) for value in offsets})
    if not values:
        return str(base_label)
    labels = [format_utc_offset(value) for value in values]
    if len(labels) <= 3:
        suffix = "/".join(labels)
    else:
        suffix = f"{labels[0]}…{labels[-1]}"
    return f"{base_label}({suffix})"


def table_event_clock(options: Any) -> DefaultLocationClock:
    return DefaultLocationClock(options, basis=event_table_time_basis(options))
