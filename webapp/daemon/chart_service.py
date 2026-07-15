# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

import datetime
import json
import threading
import sys
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import default_location as default_location_model
from engine import chart_factory, moment
from webapp.daemon.event_time import DefaultLocationClock
from webapp.frontend.scripts import export_chart_json


def _source_path(source: Optional[str]) -> str:
    return str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)


def list_chart_names(source: Optional[str] = None) -> list[dict]:
    """List chart entries available in the Hors source jsonl.

    Returns a list of `{index, name, date, place}` records the frontend
    can render in an Open dialog. Reading is line-by-line — works for the
    flat jsonl format the engine has used since the original Morinus.
    """
    path = Path(_source_path(source))
    if not path.exists():
        return []
    out: list[dict] = []
    with path.open() as fh:
        for idx, line in enumerate(fh):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            out.append({
                "index": idx,
                "name": entry.get("name") or f"#{idx}",
                "date": entry.get("date", ""),
                "time": entry.get("time", ""),
                "place": entry.get("place", ""),
            })
    return out


class ChartSnapshotService:
    """Long-lived chart snapshot exporter for the Tauri/Web frontend."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._options = None

    @property
    def options(self):
        with self._lock:
            if self._options is None:
                self._options = export_chart_json.init_environment()
            return self._options

    def snapshot(
        self,
        *,
        source: Optional[str] = None,
        name: str = "Morinus",
        record_index: Optional[int] = None,
        comparison_name: Optional[str] = None,
        comparison_record_index: Optional[int] = None,
        radix_name: Optional[str] = None,
        radix_record_index: Optional[int] = None,
        anchor_name: Optional[str] = None,
        anchor_record_index: Optional[int] = None,
        overlay_render_mode: str = "full",
    ) -> dict:
        source_path = str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)
        with self._lock:
            opts = self.options
            primary, _ = export_chart_json.load_chart(
                source_path,
                opts,
                name=name,
                record_index=record_index,
            )
            comparison = None
            radix = None
            anchor = None
            if comparison_name or comparison_record_index is not None:
                comparison, _ = export_chart_json.load_chart(
                    source_path,
                    opts,
                    name=comparison_name,
                    record_index=comparison_record_index,
                )
            if radix_name or radix_record_index is not None:
                radix, _ = export_chart_json.load_chart(
                    source_path,
                    opts,
                    name=radix_name,
                    record_index=radix_record_index,
                )
            if anchor_name or anchor_record_index is not None:
                anchor, _ = export_chart_json.load_chart(
                    source_path,
                    opts,
                    name=anchor_name,
                    record_index=anchor_record_index,
                )
            return export_chart_json.export_snapshot(
                primary,
                comparison=comparison,
                radix=radix,
                anchor=anchor,
                overlay_render_mode=overlay_render_mode,
            )

    def here_now_snapshot(self, *, when_iso: Optional[str] = None) -> dict:
        """Build File -> Here and Now as a wx-free horary/current chart.

        Mirrors morin._build_here_and_now_chart(): default location, current
        local clock, Time.ZONE using saved default-location timezone settings.
        """
        with self._lock:
            opts = self.options
            chrt = self._build_here_now_chart(opts, when_iso=when_iso)
            return export_chart_json.export_snapshot(chrt, overlay_render_mode="full")

    def _build_here_now_chart(self, opts, *, when_iso: Optional[str] = None,
                              chart_type: Optional[int] = None,
                              name: Optional[str] = None):
        # chart_type/name mirror morin._build_here_and_now_chart's params
        # (morin.py:19034-19038): the elections menu fallback builds a TRANSIT
        # 'Election Base' here-and-now (morin.py:19082), horary a HORARY one.
        chart_mod = export_chart_json.chart_mod
        place = default_location_model.place_from_options(opts)
        clock = self._here_now_clock_fields(opts, place, when_iso)
        time = chart_factory.build_time(
            clock["year"], clock["month"], clock["day"],
            clock["hour"], clock["minute"], clock["second"],
            place=place,
            plus=clock["plus"],
            zh=clock["zh"],
            zm=clock["zm"],
            daylight=clock["daylightsaving"],
            tzid=clock["tzid"],
            tzauto=clock["tzauto"],
        )
        if name is None:
            name = export_chart_json.mtexts.txts.get(
                "HereAndNow",
                export_chart_json.mtexts.txts.get("Horary", "Here and Now"),
            )
        if chart_type is None:
            chart_type = chart_mod.Chart.HORARY
        return chart_factory.build_chart(name, True, time, place, chart_type, "", opts)

    @staticmethod
    def _parse_when_iso(when_iso: Optional[str]) -> Optional[datetime.datetime]:
        if not when_iso:
            return None
        try:
            value = str(when_iso).strip()
            if value.endswith("Z"):
                value = value[:-1] + "+00:00"
            return datetime.datetime.fromisoformat(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _has_default_place(opts) -> bool:
        return default_location_model.has_default_location(opts)

    @staticmethod
    def _utc_tuple(dt: datetime.datetime) -> tuple[int, int, int, int, int, int]:
        utc = dt.astimezone(datetime.timezone.utc)
        return utc.year, utc.month, utc.day, utc.hour, utc.minute, utc.second

    def _here_now_clock_fields(self, opts, place, when_iso: Optional[str] = None) -> dict:
        """Return local clock digits + zone fields for the default location.

        A naive `when_iso` remains a local civil-time anchor for tests and
        internal callers. A timezone-aware anchor, and the ordinary no-anchor
        Here-and-Now action, is an instant that must be converted into the
        default location's local civil clock before constructing chart.Time.
        """
        parsed = self._parse_when_iso(when_iso)
        if parsed is not None and parsed.tzinfo is None:
            default_clock = DefaultLocationClock(opts)
            zone_fields = default_clock.local_zone_fields(
                (parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute, parsed.second)
            )
            return {
                "year": parsed.year,
                "month": parsed.month,
                "day": parsed.day,
                "hour": parsed.hour,
                "minute": parsed.minute,
                "second": parsed.second,
                "plus": zone_fields["plus"],
                "zh": zone_fields["zh"],
                "zm": zone_fields["zm"],
                "daylightsaving": zone_fields["daylightsaving"],
                "tzid": zone_fields["tzid"],
                "tzauto": zone_fields["tzauto"],
            }

        if parsed is None:
            parsed = datetime.datetime.now(datetime.timezone.utc)
        utc_tuple = self._utc_tuple(parsed)

        if bool(getattr(opts, "defloctzauto", True)) and self._has_default_place(opts):
            zone = moment.utc_to_place_local_zone(utc_tuple, place)
            if zone is not None and zone.get("tzid"):
                y, m, d, h, mi, s = zone["datetime"]
                return {
                    "year": y,
                    "month": m,
                    "day": d,
                    "hour": h,
                    "minute": mi,
                    "second": s,
                    "plus": bool(zone["plus"]),
                    "zh": int(zone["zh"]),
                    "zm": int(zone["zm"]),
                    "daylightsaving": bool(zone["daylightsaving"]),
                    "tzid": str(zone["tzid"] or ""),
                    "tzauto": True,
                }

        class _StaticTime:
            pass

        static_time = _StaticTime()
        static_time.zt = export_chart_json.chart_mod.Time.ZONE
        static_time.plus = bool(getattr(opts, "deflocplus", True))
        static_time.zh = int(getattr(opts, "defloczhour", 0) or 0)
        static_time.zm = int(getattr(opts, "defloczminute", 0) or 0)
        static_time.daylightsaving = bool(getattr(opts, "deflocdst", False))
        static_time.tzid = ""
        local_tuple = moment.utc_to_chart_local(static_time, utc_tuple, place=None)
        y, m, d, h, mi, s = local_tuple or utc_tuple
        return {
            "year": y,
            "month": m,
            "day": d,
            "hour": h,
            "minute": mi,
            "second": s,
            "plus": static_time.plus,
            "zh": static_time.zh,
            "zm": static_time.zm,
            "daylightsaving": static_time.daylightsaving,
            "tzid": str(getattr(opts, "defloctzid", "") or ""),
            "tzauto": bool(getattr(opts, "defloctzauto", True)),
        }


chart_snapshot_service = ChartSnapshotService()
