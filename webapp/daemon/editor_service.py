# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Daemon-side chart editor — construct / preview / save a chart and manage
JSONL collections, all on the canonical Python path.

Oracle: personaldatadlg.py (the wx Personal Data dialog). This service does NOT
reimplement chart math or hand-roll JSON. It:

  * build_chart(fields)  -> normalise editor fields into a schema-v1 dict, then
    chart_factory.chart_from_record(dict, opts) to construct Place/Time/Chart exactly as
    the dialog's OK path does, and return export_snapshot(chrt) for preview.
    (Timezone auto-resolution happens inside chart.Time when tzauto is set —
    see chart.py:242 — so daemon-built charts match the dialog without us
    re-deriving offsets.)
  * resolve_place(query) -> geonames candidates (the dialog's city search).
  * save_chart(collection, record) -> chartfile.update_jsonl upsert by id.
  * list_collections() -> the .jsonl collections in the Hors dir, with counts.

Spec: doc/migration/surfaces/chart-editor.md. Stays wx-free; constructs charts
via the ChartFactory (engine layer), never a direct Chart construction (wiring
guard).
"""
from __future__ import annotations

import datetime
import sys
import threading
import uuid
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import chart  # engine layer, wx-free — canonical enum constants
import chartfile
import default_location as default_location_model
import note_storage
from engine import calendar_policy
from engine import chart_factory  # engine layer, wx-free
import geonames  # wx-free
import mtexts  # canonical enum label lists (wx-free, see options_service)
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon import notes_service
from webapp.daemon.event_time import DefaultLocationClock
from webapp.frontend.scripts import export_chart_json


# Reverse of chartfile's int->str maps, so the editor can send either the wx
# enum index (htype/cal/zt as the dialog combo boxes report them) or the
# canonical string. We accept both and normalise to the schema-v1 strings.
_TYPE_BY_INDEX = {
    0: "radix", 1: "solar", 2: "lunar", 3: "revolution", 4: "transit",
    5: "horary", 6: "profection", 7: "pdinchart", 8: "composite",
    9: "relationship",
}
_CAL_BY_INDEX = {0: "gregorian", 1: "julian"}
_ZT_BY_INDEX = {0: "zone", 1: "greenwich", 2: "lmt", 3: "lat"}

_VALID_TYPES = set(chartfile._STR_TO_HTYPE)
_VALID_CALS = set(chartfile._STR_TO_CAL)
_VALID_ZTS = set(chartfile._STR_TO_ZT)


def _coord_signed(deg: int, minute: int, sec: float, positive: bool) -> float:
    """DMS + direction -> signed decimal degrees (E/N positive), 6dp — the same
    reconstruction chartfile.chart_to_dict performs (chartfile.py:123)."""
    value = abs(int(deg)) + abs(int(minute)) / 60.0 + abs(float(sec)) / 3600.0
    return round(value if positive else -value, 6)


def _dms_display(value: float) -> tuple[int, int, int]:
    """Signed decimal degrees -> (deg, min, sec) for the editor's DMS *display*,
    with whole-arcsecond rounding and proper 60-carry (so 0 ≤ sec ≤ 59 and a
    rounded 60 promotes into the minute). The authoritative coordinate stays the
    full-precision signed decimal; this is only the human-editable view, kept
    integer so the Sec field never shows a fractional second."""
    total_sec = int(round(abs(value) * 3600.0))
    deg, rem = divmod(total_sec, 3600)
    minute, sec = divmod(rem, 60)
    return deg, minute, sec


def _norm_type(value: Any) -> str:
    if isinstance(value, str):
        return value if value in _VALID_TYPES else "radix"
    return _TYPE_BY_INDEX.get(int(value or 0), "radix")


def _norm_cal(value: Any) -> str:
    if isinstance(value, str):
        return value if value in _VALID_CALS else "gregorian"
    return _CAL_BY_INDEX.get(int(value or 0), "gregorian")


def _norm_zt(value: Any) -> str:
    if isinstance(value, str):
        return value if value in _VALID_ZTS else "zone"
    return _ZT_BY_INDEX.get(int(value or 0), "zone")


def _build_tz_string(plus: bool, zh: int, zm: int, dst: bool) -> str:
    """(plus, zh, zm, dst) -> ISO offset string, folding DST into the total —
    the encoding chartfile expects (chartfile.py:99). The standard-offset
    fields the editor carries become a total offset incl. +60 when dst."""
    total = int(zh) * 60 + int(zm)
    if dst:
        total += 60
    if total == 0:
        return "Z"
    sign = "+" if plus else "-"
    return f"{sign}{total // 60:02d}:{total % 60:02d}"


def editor_fields_to_record(fields: dict[str, Any]) -> dict[str, Any]:
    """Normalise the editor field set (personaldatadlg's apply() values) into a
    schema-v1 JSONL dict (chartfile.py:12). Accepts the dialog-natural shape:
    DMS + E/W + N/S radios, plus/zh/zm standard offset, tzauto + tzid.

    Lat/lon are accepted either as signed decimals (``lat``/``lon``) or as the
    DMS+direction set (``lonDeg``/``lonMin``/``east`` …) the wx form uses.
    """
    f = fields

    # Coordinates: prefer explicit signed decimals; else reconstruct from DMS.
    if "lat" in f and "lon" in f and f.get("lat") is not None and f.get("lon") is not None:
        lat = round(float(f["lat"]), 6)
        lon = round(float(f["lon"]), 6)
    else:
        lon = _coord_signed(
            f.get("lonDeg", 0), f.get("lonMin", 0), f.get("lonSec", 0),
            bool(f.get("east", True)),
        )
        lat = _coord_signed(
            f.get("latDeg", 0), f.get("latMin", 0), f.get("latSec", 0),
            bool(f.get("north", True)),
        )

    bc = bool(f.get("bc", False))
    year = int(f.get("year", 2000))
    month = int(f.get("month", 1))
    day = int(f.get("day", 1))
    hour = int(f.get("hour", 0))
    minute = int(f.get("minute", 0))
    second = int(f.get("second", 0))

    date_str = (f"-{abs(year):04d}" if bc else f"{year:04d}") + f"-{month:02d}-{day:02d}"
    time_str = f"{hour:02d}:{minute:02d}:{second:02d}"

    plus = bool(f.get("plus", True))
    zh = int(f.get("zoneHour", f.get("zh", 0)))
    zm = int(f.get("zoneMin", f.get("zm", 0)))
    dst = bool(f.get("daylightSaving", f.get("dst", False)))

    male = f.get("male", True)  # True/False/None all preserved

    record = {
        "v": 1,
        "id": str(f.get("id") or uuid.uuid4()),
        "name": str(f.get("name", "") or ""),
        "type": _norm_type(f.get("type", "radix")),
        "male": male,
        "date": date_str,
        "time": time_str,
        "tz": _build_tz_string(plus, zh, zm, dst),
        "tz_name": f.get("tzName", "") or "",
        "tzid": f.get("tzid", "") or "",
        "tzauto": bool(f.get("tzauto", True)),
        "cal": _norm_cal(f.get("cal", "gregorian")),
        "zt": _norm_zt(f.get("zt", "zone")),
        "bc": bc,
        "dst": dst,
        "place": (f.get("place", "") or "")[:20],
        "country": f.get("country", "") or "",
        "lat": lat,
        "lon": lon,
        "alt": float(f.get("altitude", f.get("alt", 0)) or 0),
        "notes": f.get("notes", "") or "",
        "modified_at": f.get("modifiedAt", "") or "",
    }
    return record


def record_to_editor_fields(d: dict[str, Any]) -> dict[str, Any]:
    """Inverse of :func:`editor_fields_to_record`: a stored schema-v1 JSONL dict
    (chartfile.py:12) → the editor's form-field shape (the same set
    ``editor_meta().defaults`` + ``resolve_place`` candidates carry), PLUS the
    record ``id`` so a subsequent save overwrites in place.

    Reuses the canonical chartfile reversers (``_parse_tz``, ``_decimal_to_dms``)
    rather than re-deriving — these are exactly the splits dict_to_chart performs
    (chartfile.py:234-250), so a loaded record round-trips to the same chart.
    The date/time strings are parsed the same way dict_to_chart does
    (chartfile.py:212-227): a leading "-" marks BC.
    """
    # Date — leading "-" marks BC (matches dict_to_chart, chartfile.py:212).
    date_str = str(d.get("date", "2000-01-01"))
    if date_str.startswith("-"):
        bc = True
        date_str = date_str[1:]
    else:
        bc = bool(d.get("bc", False))
    dparts = date_str.split("-")
    year = int(dparts[0]) if dparts and dparts[0] else 2000
    month = int(dparts[1]) if len(dparts) > 1 and dparts[1] else 1
    day = int(dparts[2]) if len(dparts) > 2 and dparts[2] else 1

    # Time.
    tparts = str(d.get("time", "00:00:00")).split(":")
    hour = int(tparts[0]) if tparts and tparts[0] else 0
    minute = int(tparts[1]) if len(tparts) > 1 and tparts[1] else 0
    second = int(tparts[2]) if len(tparts) > 2 and tparts[2] else 0

    # Timezone offset → plus / standard hour+min, peeling DST back out the same
    # way dict_to_chart does (chartfile.py:234-239) so the form shows the
    # standard offset with the DST checkbox separate.
    plus, total_min = chartfile._parse_tz(d.get("tz", "Z"))
    dst = bool(d.get("dst", False))
    if dst:
        total_min = max(0, total_min - 60)
    zone_hour = total_min // 60
    zone_min = total_min % 60

    # Coordinates: signed decimal → DMS + direction (chartfile.py:244-250).
    lon = float(d.get("lon", 0.0) or 0.0)
    lat = float(d.get("lat", 0.0) or 0.0)
    east = lon >= 0.0
    north = lat >= 0.0
    lon_d, lon_m, lon_s = _dms_display(lon)
    lat_d, lat_m, lat_s = _dms_display(lat)

    place = d.get("place", "") or ""

    return {
        "id": d.get("id", "") or "",
        "name": d.get("name", "") or "",
        "male": d.get("male", True),  # True/False/None preserved
        "type": _norm_type(d.get("type", "radix")),
        "bc": bc,
        "year": year,
        "month": month,
        "day": day,
        "hour": hour,
        "minute": minute,
        "second": second,
        "lonDeg": lon_d,
        "lonMin": lon_m,
        "lonSec": lon_s,
        "east": east,
        "latDeg": lat_d,
        "latMin": lat_m,
        "latSec": lat_s,
        "north": north,
        # Authoritative signed decimals so editing + saving a stored chart keeps
        # its full 6dp precision instead of round-tripping through deg/min only.
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "place": place,
        "cal": _norm_cal(d.get("cal", "gregorian")),
        "zt": _norm_zt(d.get("zt", "zone")),
        "plus": plus,
        "zoneHour": zone_hour,
        "zoneMin": zone_min,
        "daylightSaving": dst,
        "tzauto": bool(d.get("tzauto", False)),
        "tzid": d.get("tzid", "") or "",
        "altitude": float(d.get("alt", 0) or 0),
        "notes": d.get("notes", "") or "",
    }


class EditorService:
    """Chart construction / save + JSONL collection management for the editor."""

    def __init__(self) -> None:
        self._lock = threading.RLock()

    # -- options ----------------------------------------------------------
    @property
    def _opts(self):
        return chart_snapshot_service.options

    def _hors_dir(self) -> Path:
        return Path(note_storage.charts_directory()).expanduser()

    def _default_collection(self) -> Path:
        return Path(note_storage.default_chart_collection_path()).expanduser()

    def _resolve_collection_path(self, collection: Optional[str]) -> Path:
        if not collection:
            return self._default_collection()
        path = Path(collection).expanduser()
        if not path.is_absolute():
            path = self._hors_dir() / path
        if path.suffix.lower() != ".jsonl":
            path = path.with_suffix(".jsonl")
        return path

    def _default_location_fields(self, when: datetime.datetime) -> dict[str, Any]:
        """Saved Default Location in the chart-editor field contract."""
        opts = self._opts
        if not default_location_model.has_default_location(opts):
            return {}
        try:
            place = default_location_model.place_from_options(
                opts, require_present=True,
            )
        except Exception:
            return {}
        if place is None:
            return {}
        lon = float(place.lon)
        lat = float(place.lat)
        lon_d, lon_m, lon_s = _dms_display(lon)
        lat_d, lat_m, lat_s = _dms_display(lat)
        zone = DefaultLocationClock(opts).local_zone_fields((
            when.year, when.month, when.day,
            when.hour, when.minute, when.second,
        ))
        return {
            "lonDeg": lon_d,
            "lonMin": lon_m,
            "lonSec": lon_s,
            "east": lon >= 0.0,
            "latDeg": lat_d,
            "latMin": lat_m,
            "latSec": lat_s,
            "north": lat >= 0.0,
            "lon": round(lon, 6),
            "lat": round(lat, 6),
            "place": str(getattr(place, "place", "") or "")[:20],
            "plus": bool(zone["plus"]),
            "zoneHour": int(zone["zh"]),
            "zoneMin": int(zone["zm"]),
            "daylightSaving": bool(zone["daylightsaving"]),
            "tzauto": bool(zone["tzauto"]),
            "tzid": str(zone["tzid"] or ""),
            "altitude": int(getattr(place, "altitude", 0) or 0),
        }

    @staticmethod
    def _location_is_unspecified(fields: dict[str, Any]) -> bool:
        if str(fields.get("place", "") or "").strip():
            return False
        if str(fields.get("tzid", "") or "").strip():
            return False
        for key in (
            "lon", "lat", "lonDeg", "lonMin", "lonSec",
            "latDeg", "latMin", "latSec",
        ):
            try:
                if float(fields.get(key, 0) or 0) != 0.0:
                    return False
            except (TypeError, ValueError):
                return False
        return True

    def _new_chart_fields_with_default_location(
        self, fields: dict[str, Any], *, when: Optional[datetime.datetime] = None,
    ) -> dict[str, Any]:
        """Fill only a new chart's wholly unspecified location.

        Existing records carry an id and must preserve even unusual blank or
        zero-coordinate data exactly. An explicit new location likewise wins.
        """
        prepared = dict(fields)
        if prepared.get("id") or not self._location_is_unspecified(prepared):
            return prepared
        defaults = self._default_location_fields(when or datetime.datetime.now())
        if defaults:
            prepared.update(defaults)
        return prepared

    # -- build / preview --------------------------------------------------
    def build_chart(self, fields: dict[str, Any]) -> dict:
        """Normalise fields -> schema-v1 dict -> Chart via chartfile, then return
        the export snapshot (the same payload /api/chart returns)."""
        record = editor_fields_to_record(
            self._new_chart_fields_with_default_location(fields),
        )
        with self._lock:
            chrt = chart_factory.chart_from_record(record, self._opts)
            snapshot = export_chart_json.export_snapshot(chrt, overlay_render_mode="full")
        return {"record": record, "snapshot": snapshot}

    # -- load existing record (edit) --------------------------------------
    def load_chart_record(
        self, name: Optional[str], collection: Optional[str] = None,
        record_id: Optional[str] = None,
    ) -> dict:
        """Read a stored chart record from a .jsonl collection and return it in
        the editor's form-field shape PLUS its record ``id`` (so save overwrites).

        Resolution mirrors export_chart_json.load_chart (export_chart_json.py:153)
        — match by ``id`` first (stable), else the first record whose ``name``
        equals ``name``. Reads via the canonical chartfile.read_jsonl; the
        record→form mapping is record_to_editor_fields (the inverse of the build
        path). Raises ValueError if no record matches.
        """
        path = self._resolve_collection_path(collection)
        with self._lock:
            records = chartfile.read_jsonl(str(path))
        match = None
        if record_id:
            for rec in records:
                if rec.get("id", "") == record_id:
                    match = rec
                    break
        if match is None and name:
            for rec in records:
                if rec.get("name") == name:
                    match = rec
                    break
        if match is None:
            ref = record_id or name or "<unspecified>"
            raise ValueError(f'Chart "{ref}" not found in {path}')
        # Embedded JSONL/HOR notes are migration input only.  Lift them once,
        # scrub the stored record, then seed the editor from the canonical
        # Markdown sidecar used by NotesPanel.
        legacy_notes = str(match.get("notes") or "")
        notes_service.lift_legacy_record_notes(match)
        if legacy_notes:
            with self._lock:
                chartfile.update_jsonl(match, str(path))
        fields = record_to_editor_fields(match)
        fields["notes"] = str(notes_service.read_note_state(
            str(match.get("name") or ""),
            record_id=str(match.get("id") or "").strip() or None,
        ).get("content") or "")
        return {"fields": fields, "collection": str(path)}

    # -- place resolution -------------------------------------------------
    def resolve_place(self, query: str, max_rows: int = 10) -> list[dict]:
        """Geonames city candidates, returned already in editor-form-field shape
        — the daemon performs the split/clamp/cap personaldatadlg._applyGeoPlace
        does (personaldatadlg.py:644) so the skin only assigns the fields.

        Each candidate carries:
          name (≤20, the persisted place value), lonDeg/lonMin/lonSec/east,
          latDeg/latMin/latSec/north, the full-precision signed decimals lat/lon,
          altitude (≥0), plus/zoneHour/zoneMin (GMT offset), tzid, and
          display-only label/countryName for the picker list.
        The DMS split uses chartfile._decimal_to_dms (sign→E/W·N/S), matching the
        record→form path; the signed decimals carry geonames' native precision so
        a search-pick reconstructs to the same chart as a map-pick.
        """
        query = (query or "").strip()
        if len(query) < 3:
            return []
        langid = int(getattr(self._opts, "langid", 0) or 0)
        geo = geonames.Geonames(query, max_rows, langid)
        if not geo.get_location_info() or not geo.li:
            return []
        out: list[dict] = []
        for item in geo.li:
            out.append(self._candidate_from_geo(item))
        return out

    @staticmethod
    def _candidate_from_geo(item) -> dict:
        """Port of personaldatadlg._applyGeoPlace (:644): a single geonames row
        → editor-form fields (DMS split + direction + capped name + alt≥0 + GMT
        offset). wx-free; no GUI widgets are touched."""
        raw_name = item[geonames.Geonames.NAME] or ""

        # Longitude → deg/min/sec + E/W. _dms_display gives the same integer
        # DMS view the record→form path uses, so a search-pick and an
        # edit-existing-chart show identical DMS for the same coordinate; the
        # authoritative full-precision value rides in the signed decimals below.
        lon = item[geonames.Geonames.LON]
        east = lon >= 0.0
        lon_d, lon_m, lon_s = _dms_display(lon)

        # Latitude → deg/min/sec + N/S.
        lat = item[geonames.Geonames.LAT]
        north = lat >= 0.0
        lat_d, lat_m, lat_s = _dms_display(lat)

        # Altitude: clamp to ≥0, else 0 (the dialog's alt='0' fallback).
        alt_raw = item[geonames.Geonames.ALTITUDE]
        altitude = int(alt_raw) if (alt_raw is not None and int(alt_raw) >= 0) else 0

        # Timezone id (best effort) for the auto-DST/TZ path.
        try:
            tzid = geonames.Geonames.get_timezone_name(lon, lat)
        except Exception:
            tzid = None

        # GMT standard offset → plus / hour / minute (decToDeg parity with the
        # dialog's fetch.apply: h = int(|off|), m = round(frac*60)).
        gmt = item[geonames.Geonames.GMTOFFS]
        plus = True
        zone_hour = 0
        zone_min = 0
        if gmt is not None:
            off = float(gmt)
            plus = off >= 0
            v = abs(off)
            zone_hour = int(v)
            zone_min = int(round((v - zone_hour) * 60.0))

        country_name = (
            item[geonames.Geonames.COUNTRYNAME]
            if len(item) > geonames.Geonames.COUNTRYNAME
            else ""
        )
        country_code = (
            item[geonames.Geonames.COUNTRYCODE]
            if len(item) > geonames.Geonames.COUNTRYCODE
            else ""
        )

        return {
            # form fields — assigned verbatim by the skin
            "name": raw_name[:20],
            "lonDeg": lon_d,
            "lonMin": lon_m,
            "lonSec": lon_s,
            "east": east,
            "latDeg": lat_d,
            "latMin": lat_m,
            "latSec": lat_s,
            "north": north,
            # Full-precision signed decimals (geonames' native resolution) so a
            # search-pick lands at the same accuracy as a map-pick — the form
            # forwards these and editor_fields_to_record prefers them over DMS.
            "lat": round(float(lat), 6),
            "lon": round(float(lon), 6),
            "altitude": altitude,
            "plus": plus,
            "zoneHour": zone_hour,
            "zoneMin": zone_min,
            "tzid": tzid or "",
            # display-only metadata for the candidate picker
            "label": raw_name,
            "countryCode": country_code,
            "countryName": country_name,
        }

    # -- editor meta (enums + defaults) -----------------------------------
    def editor_meta(self) -> dict:
        """Enum catalogs + canonical editor defaults so the skin renders the form
        without hardcoding option lists or seeding from the browser clock.

        Enums come from mtexts.{typeList,calList,zoneList} (wx-free, same lists
        the dialog combo boxes show), keyed by the canonical schema-v1 strings the
        daemon's _norm_* maps accept. Identity and time reproduce
        personaldatadlg.initialize(); place and zone come from Aries' saved
        Default Location. The daemon owns both, never the browser clock.
        """
        chart_types = [
            {"value": _TYPE_BY_INDEX[i], "label": label}
            for i, label in enumerate(mtexts.typeList)
            if i in _TYPE_BY_INDEX
        ]
        calendars = [
            {"value": _CAL_BY_INDEX[i], "label": label}
            for i, label in enumerate(mtexts.calList)
            if i in _CAL_BY_INDEX
        ]
        zone_types = [
            {"value": _ZT_BY_INDEX[i], "label": label}
            for i, label in enumerate(mtexts.zoneList)
            if i in _ZT_BY_INDEX
        ]

        now = datetime.datetime.now()
        defaults = {
            "name": "",
            "male": True,
            "type": _TYPE_BY_INDEX[chart.Chart.RADIX],
            "bc": False,
            "year": now.year,
            "month": now.month,
            "day": now.day,
            "hour": now.hour,
            "minute": now.minute,
            "second": now.second,
            "lonDeg": 0,
            "lonMin": 0,
            "lonSec": 0,
            "east": True,
            "latDeg": 0,
            "latMin": 0,
            "latSec": 0,
            "north": True,
            "place": "",
            "cal": _CAL_BY_INDEX[chart.Time.GREGORIAN],
            "zt": _ZT_BY_INDEX[chart.Time.ZONE],
            "plus": True,
            "zoneHour": 1,
            "zoneMin": 0,
            "daylightSaving": False,
            "tzauto": True,
            "tzid": "",
            "altitude": 100,
            "notes": "",
        }
        defaults.update(self._default_location_fields(now))
        return {
            "chartTypes": chart_types,
            "calendars": calendars,
            "zoneTypes": zone_types,
            "calendarAutoPolicy": {
                "cutover": {
                    "year": calendar_policy.GREGORIAN_CUTOVER[0],
                    "month": calendar_policy.GREGORIAN_CUTOVER[1],
                    "day": calendar_policy.GREGORIAN_CUTOVER[2],
                },
                "before": calendar_policy.CALENDAR_JULIAN,
                "from": calendar_policy.CALENDAR_GREGORIAN,
            },
            "defaults": defaults,
        }

    # -- save -------------------------------------------------------------
    def save_chart(self, collection: Optional[str], record_or_fields: dict[str, Any]) -> dict:
        """Upsert a chart record into a .jsonl collection via the canonical
        chartfile.update_jsonl writer (matched by id, appended if new)."""
        # Accept either a finished schema-v1 record or raw editor fields.
        if record_or_fields.get("v") == 1 and "date" in record_or_fields and "time" in record_or_fields:
            record = dict(record_or_fields)
            if not record.get("id"):
                record["id"] = str(uuid.uuid4())
        else:
            record = editor_fields_to_record(
                self._new_chart_fields_with_default_location(record_or_fields),
            )
        markdown = str(record.get("notes") or "")
        record["notes"] = ""
        path = self._resolve_collection_path(collection)
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            self._reject_duplicate_name(path, record)
            chartfile.update_jsonl(record, str(path))
            record_index = self._record_index_by_id(path, str(record.get("id", "") or ""))
        notes_service.write_note_state(
            str(record.get("name") or ""),
            markdown,
            record_id=str(record.get("id") or "").strip() or None,
        )
        return {
            "ok": True,
            "id": record["id"],
            "collection": str(path),
            "recordIndex": record_index,
        }

    @staticmethod
    def _normalized_name(value: Any) -> str:
        return str(value or "").strip().casefold()

    def _reject_duplicate_name(self, path: Path, record: dict[str, Any]) -> None:
        name = self._normalized_name(record.get("name"))
        if not name or not path.exists():
            return
        record_id = str(record.get("id", "") or "")
        for existing in chartfile.read_jsonl(str(path)):
            if record_id and str(existing.get("id", "") or "") == record_id:
                continue
            if self._normalized_name(existing.get("name")) == name:
                display_name = str(record.get("name", "") or "").strip()
                raise ValueError(
                    f'A chart named "{display_name}" already exists in {path.name}.'
                )

    @staticmethod
    def _record_index_by_id(path: Path, record_id: str) -> int | None:
        if not record_id:
            return None
        try:
            records = chartfile.read_jsonl(str(path))
        except Exception:
            return None
        for idx, existing in enumerate(records):
            if str(existing.get("id", "") or "") == record_id:
                return idx
        return None

    # -- collections ------------------------------------------------------
    def list_collections(self) -> list[dict]:
        """The .jsonl chart collections available — the default Hors source plus
        any sibling .jsonl files in the same directory, each with an entry
        count from chartfile.read_jsonl_summaries."""
        hors_dir = self._hors_dir()
        seen: set[str] = set()
        out: list[dict] = []
        candidates: list[Path] = []
        default = self._default_collection()
        if default.exists():
            candidates.append(default)
        if hors_dir.exists():
            candidates.extend(sorted(hors_dir.glob("*.jsonl")))
        for path in candidates:
            key = str(path.resolve())
            if key in seen:
                continue
            seen.add(key)
            try:
                count = len(chartfile.read_jsonl_summaries(str(path)))
            except Exception:
                count = 0
            out.append({
                "path": str(path),
                "name": path.stem,
                "count": count,
                "isDefault": path.resolve() == default.resolve(),
            })
        return out


editor_service = EditorService()
