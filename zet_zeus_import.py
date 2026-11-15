# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Import chart lines from the Zet and Zeus semicolon-delimited formats.

Zet line::

    name; d.m.yyyy; h:mm[:ss]; [offset]; place; 35s11; 59w06; M; notes

Zeus line::

    name;type;dd.mm.yyyy;hh:mm:ss;+hh:mm:ss;place;N40.24.00;W003.41.00;sex;...;notes;...

Both carry exact coordinates and an offset, so nothing is guessed from a place
label. Offsets that carry seconds are kept exact: an offset equal to the
place's local mean time imports as LMT, and any other offset keeps the same
instant by moving the leftover seconds onto the clock time, because chart
records store offsets in whole minutes.

Contributed by Thomas Bikeev (primum-mobile/aries#3).
"""

from __future__ import annotations

import re
from typing import Any, Callable

from aaf_import import _format_tz, _valid_calendar_date, record_to_v1_dict

_ZET_LINE_RE = re.compile(r"^[^;]+;\s*-?\d{1,2}\.\d{1,2}\.-?\d{1,4};")
_ZEUS_LINE_RE = re.compile(r"^[^;]+;\s*\d*\s*;\s*\d{1,2}\.\d{1,2}\.-?\d{1,4};")
_DASHES = {"—", "–", "−", "-", "―"}
_DMS_COORD_RE = re.compile(
    r"(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(?:(\d{1,2}(?:\.\d+)?)\s*[\"″])?\s*([NSEW])",
    re.IGNORECASE,
)
_ZET_COMPACT_COORD_RE = re.compile(r"(\d{1,3})([nsew])(\d{1,2})(?:[:'](\d{1,2}))?", re.IGNORECASE)
_ZEUS_COORD_RE = re.compile(r"([NSEW])(\d{1,3})\.(\d{1,2})\.(\d{1,2})", re.IGNORECASE)
_OFFSET_RE = re.compile(r"([+-])(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?")
# An explicit offset with seconds within this many seconds of the place's
# local mean time is the LMT the exporting program computed.
_LMT_MATCH_SECONDS = 2


def parse_zet_text_best_effort(text: str, *, source_name: str = "<Zet paste>") -> dict[str, Any]:
    return _parse_lines(text, source_name=source_name, parser=_parse_zet_line)


def parse_zeus_text_best_effort(text: str, *, source_name: str = "<Zeus paste>") -> dict[str, Any]:
    return _parse_lines(text, source_name=source_name, parser=_parse_zeus_line)


def record_to_v1(record: dict[str, Any]) -> dict[str, Any]:
    """Convert a parsed Zet/Zeus record to the chartfile schema-v1 shape."""

    plain = dict(record, time_unknown=False)
    source = plain.pop("source", "Zet")
    converted = record_to_v1_dict(plain)
    if record.get("time_unknown"):
        unknown_note = f"{source} time was unknown; imported as 12:00."
        notes = converted["notes"]
        converted["notes"] = f"{notes}\n{unknown_note}".strip() if notes else unknown_note
    return converted


def records_to_v1_dicts(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [record_to_v1(record) for record in records]


def _parse_lines(
    text: str,
    *,
    source_name: str,
    parser: Callable[[str, int], dict[str, Any]],
) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for lineno, raw_line in enumerate(str(text or "").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            records.append(parser(line, lineno))
        except ValueError as exc:
            errors.append({"line": lineno, "source": source_name, "message": str(exc)})
    return {"records": records, "errors": errors}


def _parse_zet_line(line: str, lineno: int) -> dict[str, Any]:
    if not _ZET_LINE_RE.match(line):
        raise ValueError(f"line {lineno}: not a Zet chart line")
    parts = [part.strip() for part in line.split(";")]
    if len(parts) < 7:
        raise ValueError(f"line {lineno}: Zet line needs at least 7 semicolon fields")
    name = parts[0]
    if not name:
        raise ValueError(f"line {lineno}: Zet line has no chart name")
    year, month, day, bc, cal = _parse_date(parts[1], lineno)
    hour, minute, second, time_unknown = _parse_time(parts[2], lineno)

    coord_indices = [index for index in range(4, len(parts)) if _looks_like_zet_coord(parts[index])]
    if len(coord_indices) < 2 or coord_indices[1] != coord_indices[0] + 1:
        raise ValueError(f"line {lineno}: Zet line needs latitude and longitude fields")
    lat_index, lon_index = coord_indices[0], coord_indices[1]
    place = next((parts[i] for i in range(4, lat_index) if parts[i]), "")
    lat = _parse_zet_coord(parts[lat_index], expected="lat", lineno=lineno)
    lon = _parse_zet_coord(parts[lon_index], expected="lon", lineno=lineno)
    sex_text = parts[lon_index + 1] if lon_index + 1 < len(parts) else ""
    notes = ";".join(parts[lon_index + 2:]).strip().strip(";").strip()

    offset_seconds = _parse_offset(parts[3], lineno, label="Zet")
    record = _base_record(
        name=name, male=_parse_sex(sex_text, lineno), date=(year, month, day, bc, cal),
        time=(hour, minute, second, time_unknown), place=place, lat=lat, lon=lon, notes=notes,
    )
    record["source"] = "Zet"
    return _apply_offset(record, offset_seconds)


def _parse_zeus_line(line: str, lineno: int) -> dict[str, Any]:
    if not _ZEUS_LINE_RE.match(line):
        raise ValueError(f"line {lineno}: not a Zeus chart line")
    parts = [part.strip() for part in line.split(";")]
    if len(parts) < 9:
        raise ValueError(f"line {lineno}: Zeus line needs at least 9 semicolon fields")
    name = parts[0]
    if not name:
        raise ValueError(f"line {lineno}: Zeus line has no chart name")
    year, month, day, bc, cal = _parse_date(parts[2], lineno)
    hour, minute, second, time_unknown = _parse_time(parts[3], lineno)
    lat = _parse_zeus_coord(parts[6], expected="lat", lineno=lineno)
    lon = _parse_zeus_coord(parts[7], expected="lon", lineno=lineno)
    notes = parts[11] if len(parts) > 11 and parts[11] else (parts[10] if len(parts) > 10 else "")
    offset_seconds = _parse_offset(parts[4], lineno, label="Zeus")
    record = _base_record(
        name=name, male=_parse_sex(parts[8], lineno), date=(year, month, day, bc, cal),
        time=(hour, minute, second, time_unknown), place=parts[5], lat=lat, lon=lon, notes=notes,
    )
    record["source"] = "Zeus"
    return _apply_offset(record, offset_seconds)


def _base_record(
    *,
    name: str,
    male: bool | None,
    date: tuple[int, int, int, bool, str],
    time: tuple[int, int, int, bool],
    place: str,
    lat: float,
    lon: float,
    notes: str,
) -> dict[str, Any]:
    year, month, day, bc, cal = date
    hour, minute, second, time_unknown = time
    _city, country = _split_place(place)
    return {
        "name": name,
        "type": "radix",
        "male": male,
        "year": year,
        "month": month,
        "day": day,
        "bc": bc,
        "cal": cal,
        "hour": hour,
        "minute": minute,
        "second": second,
        "time_unknown": time_unknown,
        "place": place,
        "country": country,
        "lat": lat,
        "lon": lon,
        "notes": notes,
    }


def _apply_offset(record: dict[str, Any], offset_seconds: int | None) -> dict[str, Any]:
    """Set the record's zone so the stored moment equals the source moment.

    ``None`` means the source gave local mean time. An offset with seconds
    that matches the place's LMT imports as LMT (exact). Any other offset is
    rounded to whole minutes and the clock time takes the leftover seconds,
    which keeps the instant unchanged.
    """

    if offset_seconds is None:
        record.update(tz="Z", tz_name="LMT", zt="lmt")
        return record
    if offset_seconds % 60:
        lmt_seconds = round(float(record["lon"]) * 240.0)
        if abs(offset_seconds - lmt_seconds) <= _LMT_MATCH_SECONDS:
            record.update(tz="Z", tz_name="LMT", zt="lmt")
            return record
    minutes = round(offset_seconds / 60)
    residual = minutes * 60 - offset_seconds
    if residual:
        clock = record["hour"] * 3600 + record["minute"] * 60 + record["second"] + residual
        if 0 <= clock < 86400:
            record["hour"], rest = divmod(clock, 3600)
            record["minute"], record["second"] = divmod(rest, 60)
    record.update(tz=_format_tz(minutes), tz_name="", zt="zone")
    return record


def _parse_date(text: str, lineno: int) -> tuple[int, int, int, bool, str]:
    match = re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(-?\d{1,4})", str(text or "").strip())
    if not match:
        raise ValueError(f"line {lineno}: invalid date {text!r}")
    day, month, astronomical_year = int(match.group(1)), int(match.group(2)), int(match.group(3))
    cal = "gregorian" if (astronomical_year, month, day) >= (1582, 10, 15) else "julian"
    if not _valid_calendar_date(astronomical_year, month, day, cal):
        raise ValueError(f"line {lineno}: invalid date {text!r}")
    bc = astronomical_year <= 0
    year = 1 - astronomical_year if bc else astronomical_year
    return year, month, day, bc, cal


def _parse_time(text: str, lineno: int) -> tuple[int, int, int, bool]:
    cleaned = str(text or "").strip()
    if not cleaned or cleaned in {"*", "?"}:
        return 12, 0, 0, True
    match = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", cleaned)
    if not match:
        raise ValueError(f"line {lineno}: invalid time {text!r}")
    hour, minute, second = int(match.group(1)), int(match.group(2)), int(match.group(3) or 0)
    if hour >= 24 or minute >= 60 or second >= 60:
        raise ValueError(f"line {lineno}: invalid time {text!r}")
    return hour, minute, second, False


def _parse_offset(text: str, lineno: int, *, label: str) -> int | None:
    """Return the offset east of Greenwich in seconds; ``None`` for LMT."""

    cleaned = str(text or "").replace(" ", "")
    if not cleaned or cleaned in _DASHES or cleaned.lower() in {"l", "lmt", "*", "?"}:
        return None
    if cleaned in {"0", "+0", "-0"} or cleaned.lower() in {"z", "ut", "utc", "gmt"}:
        return 0
    match = _OFFSET_RE.fullmatch(cleaned)
    if not match:
        raise ValueError(f"line {lineno}: invalid {label} timezone {text!r}")
    sign = 1 if match.group(1) == "+" else -1
    hours, minutes, seconds = int(match.group(2)), int(match.group(3) or 0), int(match.group(4) or 0)
    if hours > 14 or minutes >= 60 or seconds >= 60:
        raise ValueError(f"line {lineno}: invalid {label} timezone {text!r}")
    return sign * (hours * 3600 + minutes * 60 + seconds)


def _looks_like_zet_coord(text: str) -> bool:
    candidate = str(text or "").strip().replace(" ", "")
    return bool(_DMS_COORD_RE.fullmatch(candidate) or _ZET_COMPACT_COORD_RE.fullmatch(candidate))


def _coord_value(
    degrees: int,
    minutes: int,
    seconds: float,
    hemisphere: str,
    *,
    expected: str,
    text: str,
    lineno: int,
    label: str,
) -> float:
    hemisphere = hemisphere.lower()
    valid_hemispheres = {"n", "s"} if expected == "lat" else {"e", "w"}
    limit = 90 if expected == "lat" else 180
    value = degrees + minutes / 60.0 + seconds / 3600.0
    if hemisphere not in valid_hemispheres or minutes >= 60 or seconds >= 60 or value > limit:
        name = "latitude" if expected == "lat" else "longitude"
        raise ValueError(f"line {lineno}: invalid {label} {name} {text!r}")
    return -value if hemisphere in {"s", "w"} else value


def _parse_zet_coord(text: str, *, expected: str, lineno: int) -> float:
    raw = str(text or "").strip().replace(" ", "")
    dms = _DMS_COORD_RE.fullmatch(raw)
    if dms:
        degrees, minutes, seconds, hemisphere = int(dms.group(1)), int(dms.group(2)), float(dms.group(3) or 0), dms.group(4)
    else:
        compact = _ZET_COMPACT_COORD_RE.fullmatch(raw)
        if not compact:
            name = "latitude" if expected == "lat" else "longitude"
            raise ValueError(f"line {lineno}: invalid Zet {name} {text!r}")
        degrees, hemisphere = int(compact.group(1)), compact.group(2)
        minutes, seconds = int(compact.group(3)), float(compact.group(4) or 0)
    return _coord_value(
        degrees, minutes, seconds, hemisphere, expected=expected, text=text, lineno=lineno, label="Zet"
    )


def _parse_zeus_coord(text: str, *, expected: str, lineno: int) -> float:
    match = _ZEUS_COORD_RE.fullmatch(str(text or "").strip())
    if not match:
        name = "latitude" if expected == "lat" else "longitude"
        raise ValueError(f"line {lineno}: invalid Zeus {name} {text!r}")
    return _coord_value(
        int(match.group(2)), int(match.group(3)), float(match.group(4)), match.group(1),
        expected=expected, text=text, lineno=lineno, label="Zeus",
    )


def _parse_sex(text: str, lineno: int) -> bool | None:
    raw = str(text or "").strip()
    if raw in _DASHES or raw in {"", "*", "?"}:
        return None
    marker = raw.upper()
    if marker in {"M", "MALE"}:
        return True
    if marker in {"F", "FEMALE"}:
        return False
    # Zeus and Zet use other single letters for events and mundane charts.
    if len(marker) == 1 and marker.isalpha():
        return None
    raise ValueError(f"line {lineno}: unsupported sex marker {text!r}")


def _split_place(place: str) -> tuple[str, str]:
    cleaned = str(place or "").strip()
    if "," in cleaned:
        head, tail = cleaned.rsplit(",", 1)
        return head.strip(), tail.strip()
    return cleaned, ""
