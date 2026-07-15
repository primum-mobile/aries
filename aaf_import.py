# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Import Astrological Exchange Format (AAF) chart records.

AAF is a plain text format. The import path here supports the common
Astro-Seek/Astrodienst shape:

    #A93:first,last,kind,date,time,city,state
    #B93:julian_day,latitude,longitude,timezone,dst

Only records with both rows are imported because Aries needs exact coordinates
and timezone data instead of guessing from a place label.
"""

from __future__ import annotations

import csv
import datetime as _datetime
import json
import re
import uuid
from pathlib import Path
from typing import Any


_NUM_RE = re.compile(r"[-+]?\d+(?:\.\d+)?")


def parse_aaf(filepath: str) -> list[dict[str, Any]]:
    """Parse an AAF text file into normalized raw record dictionaries."""

    path = Path(filepath)
    return parse_aaf_text(_read_text(path), source_name=str(path))


def parse_aaf_text(text: str, *, source_name: str = "<AAF paste>") -> list[dict[str, Any]]:
    """Parse AAF text into normalized raw record dictionaries."""

    records: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for lineno, raw_line in enumerate(text.splitlines(), 1):
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#A93:"):
            if current is not None:
                records.append(_finalize_record(current))
            current = {"line": lineno, "a": _parse_a93(line[5:], lineno), "notes": []}
            continue
        if line.startswith("#B93:"):
            if current is None:
                raise ValueError(f"{source_name}:{lineno}: #B93 appears before #A93")
            current["b"] = _parse_b93(line[5:], lineno)
            continue
        if line.startswith("#COM:") and current is not None:
            note = line[5:].strip()
            if note:
                current["notes"].append(note)
            continue
        if line.startswith("#SRC:") and current is not None:
            source = line[5:].strip()
            if source:
                current["notes"].append(f"Source: {source}")
            continue
        # Other AAF rows and comments are metadata not needed for chart import.

    if current is not None:
        records.append(_finalize_record(current))
    return records


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _csv_fields(payload: str) -> list[str]:
    try:
        return [field.strip() for field in next(csv.reader([payload]))]
    except csv.Error as exc:
        raise ValueError(f"bad comma-delimited AAF row: {exc}") from exc


def _parse_a93(payload: str, lineno: int) -> dict[str, Any]:
    fields = _csv_fields(payload)
    if len(fields) < 7:
        raise ValueError(f"line {lineno}: #A93 expects at least 7 fields, got {len(fields)}")
    first, last, kind, date_text, time_text = fields[:5]
    location_fields = fields[5:]
    name = _join_name(first, last)
    if not name:
        raise ValueError(f"line {lineno}: #A93 has no chart name")
    year, month, day, bc = _parse_date(date_text, lineno)
    hour, minute, second, time_unknown = _parse_time(time_text, lineno)
    male = _parse_gender(kind)
    chart_type = _parse_chart_type(kind)
    city, country, place = _parse_place_fields(location_fields)
    return {
        "name": name,
        "kind": _clean_star(kind),
        "type": chart_type,
        "male": male,
        "year": year,
        "month": month,
        "day": day,
        "bc": bc,
        "hour": hour,
        "minute": minute,
        "second": second,
        "time_unknown": time_unknown,
        "city": city,
        "country": country,
        "place": place,
    }


def _parse_place_fields(fields: list[str]) -> tuple[str, str, str]:
    parts = [_clean_star(field) for field in fields]
    parts = [part for part in parts if part]
    if not parts:
        return "", "", ""
    city = parts[0]
    if len(parts) == 1:
        return city, "", city
    if len(parts) == 2:
        country = parts[1]
        return city, country, ", ".join(parts)
    country = parts[1]
    region_parts = parts[2:]
    place_parts = [city, *region_parts, country]
    return city, country, ", ".join(place_parts)


def _parse_b93(payload: str, lineno: int) -> dict[str, Any]:
    fields = _csv_fields(payload)
    if len(fields) != 5:
        raise ValueError(f"line {lineno}: #B93 expects 5 fields, got {len(fields)}")
    julian_day, lat_text, lon_text, tz_text, dst_text = fields
    lat = _parse_coordinate(lat_text, expected="lat", lineno=lineno)
    lon = _parse_coordinate(lon_text, expected="lon", lineno=lineno)
    zone = _parse_timezone(tz_text, dst_text, lineno)
    return {
        "julian_day": _clean_star(julian_day),
        "lat": lat,
        "lon": lon,
        "tz": zone["tz"],
        "tz_name": zone["tz_name"],
        "zt": zone["zt"],
        "dst_marker": _clean_star(dst_text),
    }


def _finalize_record(record: dict[str, Any]) -> dict[str, Any]:
    if "b" not in record:
        raise ValueError(f"line {record['line']}: #A93 record has no #B93 row")
    a = record["a"]
    b = record["b"]
    return {
        **a,
        **b,
        "notes": "\n".join(record.get("notes", [])),
    }


def _clean_star(value: Any) -> str:
    text = str(value or "").strip()
    return "" if text == "*" else text


def _join_name(first: str, last: str) -> str:
    first_clean = _clean_star(first)
    last_clean = _clean_star(last)
    if first_clean and last_clean:
        return f"{first_clean} {last_clean}".strip()
    return (last_clean or first_clean).strip()


def _parse_gender(kind: str) -> bool | None:
    marker = _clean_star(kind).lower()
    if marker in {"m", "male", "mann", "masculine"}:
        return True
    if marker in {"f", "female", "w", "weiblich", "feminine"}:
        return False
    return None


def _parse_chart_type(kind: str) -> str:
    marker = _clean_star(kind).lower()
    if marker in {"h", "horary"}:
        return "horary"
    if marker in {"e", "event", "transit"}:
        return "transit"
    return "radix"


def _parse_date(text: str, lineno: int) -> tuple[int, int, int, bool]:
    cleaned = _clean_star(text)
    match = re.fullmatch(r"(-?\d{1,6})[./-](\d{1,2})[./-](-?\d{1,6})", cleaned)
    if not match:
        raise ValueError(f"line {lineno}: unsupported AAF date {text!r}")
    day = int(match.group(1))
    month = int(match.group(2))
    year = int(match.group(3))
    bc = year <= 0
    try:
        _datetime.date(abs(year), month, day)
    except ValueError as exc:
        raise ValueError(f"line {lineno}: invalid AAF date {text!r}") from exc
    return abs(year), month, day, bc


def _parse_time(text: str, lineno: int) -> tuple[int, int, int, bool]:
    cleaned = _clean_star(text)
    if not cleaned:
        return 12, 0, 0, True
    parts = cleaned.split(":")
    if len(parts) not in (2, 3):
        raise ValueError(f"line {lineno}: unsupported AAF time {text!r}")
    try:
        hour = int(parts[0])
        minute = int(parts[1])
        second = int(float(parts[2])) if len(parts) == 3 else 0
        _datetime.time(hour, minute, second)
    except ValueError as exc:
        raise ValueError(f"line {lineno}: invalid AAF time {text!r}") from exc
    return hour, minute, second, False


def _parse_coordinate(text: str, *, expected: str, lineno: int) -> float:
    cleaned = _clean_star(text).lower()
    hemi_match = re.search(r"[nsew]", cleaned)
    if not hemi_match:
        try:
            value = float(cleaned)
        except ValueError as exc:
            raise ValueError(f"line {lineno}: invalid AAF coordinate {text!r}") from exc
        _validate_coordinate(value, expected, lineno, text)
        return value

    hemi = hemi_match.group(0)
    if expected == "lat" and hemi not in {"n", "s"}:
        raise ValueError(f"line {lineno}: latitude uses longitude hemisphere {text!r}")
    if expected == "lon" and hemi not in {"e", "w"}:
        raise ValueError(f"line {lineno}: longitude uses latitude hemisphere {text!r}")

    numbers = [float(item) for item in _NUM_RE.findall(cleaned)]
    if not numbers:
        raise ValueError(f"line {lineno}: invalid AAF coordinate {text!r}")
    degrees = numbers[0]
    minutes = numbers[1] if len(numbers) > 1 else 0.0
    seconds = numbers[2] if len(numbers) > 2 else 0.0
    if minutes < 0 or minutes >= 60 or seconds < 0 or seconds >= 60:
        raise ValueError(f"line {lineno}: invalid coordinate minutes/seconds {text!r}")
    value = abs(degrees) + minutes / 60.0 + seconds / 3600.0
    if hemi in {"s", "w"}:
        value = -value
    _validate_coordinate(value, expected, lineno, text)
    return value


def _validate_coordinate(value: float, expected: str, lineno: int, original: str) -> None:
    limit = 90.0 if expected == "lat" else 180.0
    if not -limit <= value <= limit:
        raise ValueError(f"line {lineno}: AAF {expected} out of range {original!r}")


def _parse_timezone(tz_text: str, dst_text: str, lineno: int) -> dict[str, str]:
    cleaned = _clean_star(tz_text).lower()
    dst_marker = _clean_star(dst_text).lower()
    if dst_marker in {"l", "lmt"}:
        return {"tz": "Z", "tz_name": "LMT", "zt": "lmt"}
    dst_hours = _dst_hours(dst_text)
    if not cleaned or cleaned in {"l", "lmt", "lat"}:
        return {"tz": "Z", "tz_name": "LMT", "zt": "lmt"}

    signed_minutes = _timezone_minutes(cleaned, lineno)
    if signed_minutes is None:
        return {"tz": "Z", "tz_name": "LMT", "zt": "lmt"}
    if dst_hours:
        signed_minutes += 60 * dst_hours
    return {"tz": _format_tz(signed_minutes), "tz_name": "", "zt": "zone"}


def _timezone_minutes(text: str, lineno: int) -> int | None:
    if text in {"*", "l", "lmt", "lat"}:
        return None
    if text in {"z", "ut", "utc", "gmt", "0"}:
        return 0

    match = re.fullmatch(r"([+-])?(\d{1,2})(?::?(\d{2}))?", text)
    if match:
        sign = -1 if match.group(1) == "-" else 1
        hours = int(match.group(2))
        minutes = int(match.group(3) or 0)
        return sign * (hours * 60 + minutes)

    for pattern in (
        r"(\d{1,2})h([ew])(\d{0,2})",
        r"(\d{1,2})([ew])(\d{0,2})",
        r"h(\d{1,2})([ew])(\d{0,2})",
        r"([ew])(\d{1,2})h?(\d{0,2})",
    ):
        match = re.fullmatch(pattern, text)
        if match:
            groups = match.groups()
            if groups[0] in {"e", "w"}:
                hemi = groups[0]
                hours = int(groups[1])
                minutes = int(groups[2] or 0)
            else:
                hours = int(groups[0])
                hemi = groups[1]
                minutes = int(groups[2] or 0)
            sign = 1 if hemi == "e" else -1
            return sign * (hours * 60 + minutes)
    raise ValueError(f"line {lineno}: unsupported AAF timezone {text!r}")


def _dst_hours(text: str) -> int:
    marker = _clean_star(text).lower()
    if marker in {"", "0", "n", "no", "s", "st", "std"}:
        return 0
    if marker in {"1", "d", "dst", "w", "war", "yes", "y"}:
        return 1
    if marker in {"2", "dd", "double"}:
        return 2
    if marker in {"l", "lmt"}:
        return 0
    try:
        return int(float(marker))
    except ValueError:
        return 0


def _format_tz(signed_minutes: int) -> str:
    if signed_minutes == 0:
        return "Z"
    sign = "+" if signed_minutes >= 0 else "-"
    total = abs(signed_minutes)
    return f"{sign}{total // 60:02d}:{total % 60:02d}"


def record_to_v1_dict(record: dict[str, Any]) -> dict[str, Any]:
    """Convert one parsed AAF record to chartfile.py schema-v1 JSONL shape."""

    date_prefix = "-" if record.get("bc") else ""
    notes = str(record.get("notes", "") or "")
    if record.get("time_unknown"):
        unknown_note = "AAF time was unknown; imported as 12:00."
        notes = f"{notes}\n{unknown_note}".strip() if notes else unknown_note
    return {
        "v": 1,
        "id": str(uuid.uuid4()),
        "name": record["name"],
        "type": record.get("type") or "radix",
        "male": record.get("male"),
        "date": f"{date_prefix}{record['year']:04d}-{record['month']:02d}-{record['day']:02d}",
        "time": f"{record['hour']:02d}:{record['minute']:02d}:{record['second']:02d}",
        "tz": record["tz"],
        "tz_name": record.get("tz_name", ""),
        "tzid": "",
        "tzauto": False,
        "cal": "gregorian",
        "zt": record.get("zt", "zone"),
        "bc": bool(record.get("bc", False)),
        "dst": False,
        "place": record.get("place", ""),
        "country": record.get("country", ""),
        "lat": round(float(record["lat"]), 6),
        "lon": round(float(record["lon"]), 6),
        "alt": 0.0,
        "notes": notes,
        "modified_at": "",
    }


def write_jsonl(records: list[dict[str, Any]], filepath: str) -> None:
    """Write parsed AAF records as a schema-v1 JSONL collection."""

    with open(filepath, "w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record_to_v1_dict(record), ensure_ascii=False, separators=(",", ":")))
            fh.write("\n")
