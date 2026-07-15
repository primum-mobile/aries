# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

import time
import datetime
from typing import Any, Optional

import datetime_parser
import geonames
import localcities

from webapp.daemon.chart_picker_service import chart_picker_service
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.workspace_service import workspace_service
from webapp.frontend.scripts import export_chart_json
from engine import chart_factory


_CHART_ROW_CACHE_SECONDS = 5.0


class SpotlightService:
    """Daemon-owned preview contract for the ambient spotlight input.

    This is the wx-free first slice of ``spotlight_ambient.py`` + the
    ``morin.py`` spotlight helpers. React owns only the retained overlay skin;
    parsing, chart matching, action eligibility, and later execution stay here.
    """

    def __init__(self) -> None:
        self._chart_rows_cached_at = 0.0
        self._chart_rows: list[dict[str, Any]] = []

    def preview(self, text: str) -> dict[str, Any]:
        query = (text or "").strip()
        if not query:
            return self._none()

        parsed = datetime_parser.parse_spotlight(query)
        has_temporal = self._parsed_has_temporal(parsed)
        location_only = bool(
            parsed is not None
            and parsed.location_query
            and not has_temporal
        )

        if location_only:
            chart_match = self._match_chart_query(query)
            if chart_match is not None:
                return chart_match

        if parsed is not None and (has_temporal or location_only):
            return self._datetime_preview(parsed)

        chart_match = self._match_chart_query(query)
        if chart_match is not None:
            return chart_match
        return self._none()

    def execute(self, text: str, action: str = "default") -> dict[str, Any]:
        query = (text or "").strip()
        if not query:
            raise ValueError("spotlight input is empty")
        preview = self.preview(query)
        if preview.get("kind") == "chart":
            chart_ref = preview.get("chart") or {}
            return workspace_service.open_document(
                kind="chart",
                source_name=str(chart_ref.get("name") or ""),
                source=str(chart_ref.get("source") or ""),
                record_index=chart_ref.get("recordIndex"),
            )

        parsed = datetime_parser.parse_spotlight(query)
        if parsed is None:
            raise ValueError("spotlight input did not resolve")
        actions = self._action_specs(parsed)
        action_id = (action or "default").strip()
        if action_id == "default":
            action_id = self._default_action(parsed, actions) or ""
        if action_id == "current":
            current_dt = self._current_merge_anchor(parsed)
            location_context = None
            if parsed.location_query:
                location_context = self._location_context(parsed.location_query, current_dt)
                if location_context is None:
                    raise ValueError("spotlight location did not resolve")
            parsed_payload = self._serialize_parsed(parsed)
            parsed_payload["calendar"] = current_dt.calendar
            return workspace_service.apply_spotlight_current(
                parsed=parsed_payload,
                location_context=location_context,
            )
        if action_id not in {"radix", "horary", "transit"}:
            raise ValueError(f"unsupported spotlight action {action_id!r}")

        dt = self._datetime_from_parsed(parsed)
        if dt is None:
            raise ValueError("spotlight input needs a date or time")
        location_context = self._effective_location_context(parsed, dt)
        if action_id == "radix":
            return self._open_radix(dt, location_context)
        if action_id == "horary":
            return self._open_horary(dt, location_context)
        return workspace_service.open_spotlight_transit(
            display_datetime=self._display_tuple(dt),
            calendar=self._calendar_enum(dt.calendar),
            time_context=location_context,
        )

    @staticmethod
    def _none() -> dict[str, Any]:
        return {
            "kind": "none",
            "primary": "",
            "secondary": "",
            "parsed": None,
            "actions": [],
            "defaultAction": None,
            "canConfirm": False,
        }

    def _datetime_preview(self, parsed: datetime_parser.ParsedDateTime) -> dict[str, Any]:
        has_temporal = self._parsed_has_temporal(parsed)
        primary = parsed.format() if has_temporal else ""
        location_label = self._preview_location_label(parsed.location_query)
        if not primary:
            primary = location_label or parsed.location_query.strip()
            secondary = ""
        elif location_label:
            secondary = location_label
        elif parsed.location_query:
            secondary = parsed.location_query.strip()
        else:
            secondary = ""

        actions = self._action_specs(parsed)
        default_action = self._default_action(parsed, actions)
        return {
            "kind": "datetime",
            "primary": primary,
            "secondary": secondary,
            "parsed": self._serialize_parsed(parsed),
            "actions": actions,
            "defaultAction": default_action,
            "canConfirm": bool(default_action),
        }

    def _match_chart_query(self, query: str) -> Optional[dict[str, Any]]:
        normalized = self._normalize_query(query)
        if len(normalized) < 2 or any(ch.isdigit() for ch in normalized):
            return None
        tokens = [token for token in normalized.split() if token]
        candidates: list[tuple[int, int, str, dict[str, Any]]] = []
        for row in self._chart_rows_for_preview():
            name = str(row.get("name") or "").strip()
            name_key = self._normalize_query(name)
            if not name_key:
                continue
            rank: Optional[int] = None
            if name_key == normalized:
                rank = 0
            elif name_key.startswith(normalized):
                rank = 1
            elif tokens and all(token in name_key for token in tokens):
                rank = 2
            elif normalized in name_key:
                rank = 3
            if rank is None:
                continue
            candidates.append((rank, len(name_key), name_key, row))
        if not candidates:
            return None

        _rank, _name_len, _name_key, row = min(
            candidates,
            key=lambda item: (item[0], item[1], item[2]),
        )
        date = str(row.get("date") or "").strip()
        chart_time = str(row.get("time") or "").strip()
        primary_meta = " ".join(part for part in (date, chart_time) if part).strip()
        name = str(row.get("name") or "").strip()
        primary = f"{name} - {primary_meta}" if primary_meta else name
        return {
            "kind": "chart",
            "primary": primary,
            "secondary": str(row.get("collection") or "").strip(),
            "parsed": None,
            "chart": {
                "source": str(row.get("source") or ""),
                "recordIndex": row.get("recordIndex"),
                "name": name,
                "collection": str(row.get("collection") or "").strip(),
            },
            "actions": [],
            "defaultAction": "open-chart",
            "canConfirm": True,
        }

    def _chart_rows_for_preview(self) -> list[dict[str, Any]]:
        now = time.monotonic()
        if self._chart_rows and now - self._chart_rows_cached_at < _CHART_ROW_CACHE_SECONDS:
            return self._chart_rows
        try:
            rows = chart_picker_service.rows().get("rows", [])
        except Exception:
            rows = []
        self._chart_rows = [row for row in rows if isinstance(row, dict)]
        self._chart_rows_cached_at = now
        return self._chart_rows

    def _open_radix(
        self,
        dt: datetime_parser.ResolvedCivilDateTime,
        location_context: dict[str, Any],
    ) -> dict[str, Any]:
        chrt = self._build_chart("", export_chart_json.chart_mod.Chart.RADIX, dt, location_context)
        return workspace_service.open_dirty_scratch_chart(
            chrt=chrt,
            session_label="Chart",
            display_datetime=self._display_tuple(dt),
        )

    def _open_horary(
        self,
        dt: datetime_parser.ResolvedCivilDateTime,
        location_context: dict[str, Any],
    ) -> dict[str, Any]:
        chart_mod = export_chart_json.chart_mod
        horary_label = export_chart_json.mtexts.txts.get("Horary", "Horary")
        horary_name = export_chart_json.mtexts.txts.get("HereAndNow", horary_label)
        chrt = self._build_chart(horary_name, chart_mod.Chart.HORARY, dt, location_context)
        return workspace_service.open_spotlight_horary(
            chrt=chrt,
            session_label=horary_name,
            display_datetime=self._display_tuple(dt),
        )

    def _build_chart(
        self,
        name: str,
        chart_type: int,
        dt: datetime_parser.ResolvedCivilDateTime,
        location_context: dict[str, Any],
    ):
        chart_mod = export_chart_json.chart_mod
        place = location_context["place"]
        time_obj = chart_factory.build_time(
            dt.year,
            dt.month,
            dt.day,
            dt.hour,
            dt.minute,
            dt.second,
            place=place,
            cal=self._calendar_enum(dt.calendar),
            zt=location_context.get("zt", chart_mod.Time.ZONE),
            plus=location_context.get("plus", True),
            zh=location_context.get("zh", 0),
            zm=location_context.get("zm", 0),
            daylight=location_context.get("daylightsaving", False),
            tzid=location_context.get("tzid", ""),
            tzauto=location_context.get("tzauto", False),
        )
        return chart_factory.build_chart(
            name,
            True,
            time_obj,
            place,
            chart_type,
            "",
            chart_snapshot_service.options,
        )

    def _action_specs(self, parsed: datetime_parser.ParsedDateTime) -> list[dict[str, str]]:
        # Labels resolved from mtexts at serve time so the active langid applies.
        mtexts = export_chart_json.mtexts
        actions: list[dict[str, str]] = []
        active = self._active_document_summary()
        if self._targets_active_steppable_chart(parsed, active):
            actions.append({"id": "current", "label": mtexts.txts.get("CurrentChart", "Current Chart")})
        if not self._parsed_has_temporal(parsed):
            return actions
        actions.append({"id": "radix", "label": mtexts.txts.get("Radix", "Radix")})
        actions.append({"id": "horary", "label": mtexts.txts.get("Horary", "Horary")})
        if active is not None:
            actions.append({"id": "transit", "label": mtexts.txts.get("Transit", "Transit")})
        return actions

    def _default_action(
        self,
        parsed: datetime_parser.ParsedDateTime,
        actions: list[dict[str, str]],
    ) -> Optional[str]:
        action_ids = [str(action.get("id") or "") for action in actions]
        if "current" in action_ids:
            return "current"
        if not self._parsed_has_temporal(parsed):
            return None
        if self._has_partial_datetime(parsed) and self._active_document_summary() is not None:
            return "transit"
        return "radix"

    def _active_document_summary(self) -> Optional[dict[str, Any]]:
        try:
            state = workspace_service.state()
        except Exception:
            return None
        active_id = state.get("activeDocumentId")
        if not active_id:
            return None
        for doc in state.get("documents") or []:
            if isinstance(doc, dict) and doc.get("documentId") == active_id:
                return doc
        return None

    def _effective_location_context(
        self,
        parsed: datetime_parser.ParsedDateTime,
        dt: datetime_parser.ResolvedCivilDateTime,
    ) -> dict[str, Any]:
        if parsed.location_query:
            resolved = self._location_context(parsed.location_query, dt)
            if resolved is not None:
                return resolved
        return workspace_service.spotlight_default_location_context()

    def _location_context(
        self,
        query: str,
        dt: datetime_parser.ResolvedCivilDateTime,
    ) -> Optional[dict[str, Any]]:
        query = (query or "").strip()
        if not query:
            return None
        display_query, state_hint, hit, queries = self._resolve_location_hit(query)
        if hit is None:
            for candidate_query in queries:
                try:
                    geo = geonames.Geonames(candidate_query, 1, chart_snapshot_service.options.langid)
                    if geo.get_location_info() and geo.li:
                        hit = geo.li[0]
                        break
                except Exception:
                    continue
        if hit is None:
            return None
        label = self._location_label(hit, display_query=display_query, state_hint=state_hint)
        lon = float(hit[geonames.Geonames.LON])
        lat = float(hit[geonames.Geonames.LAT])
        altitude = hit[geonames.Geonames.ALTITUDE]
        altitude = int(altitude) if altitude not in (None, "") else int(
            chart_snapshot_service.options.deflocalt
        )
        place = self._place_from_coords(label, lon, lat, altitude)
        zone_info = geonames.Geonames.resolve_zone_fields(
            dt.year,
            dt.month,
            dt.day,
            dt.hour,
            dt.minute,
            dt.second,
            place,
            "",
        )
        opts = chart_snapshot_service.options
        return {
            "place": place,
            "zt": export_chart_json.chart_mod.Time.ZONE,
            "tzid": zone_info["tzid"] if zone_info else "",
            "tzauto": bool(zone_info),
            "plus": zone_info["plus"] if zone_info else opts.deflocplus,
            "zh": zone_info["zh"] if zone_info else opts.defloczhour,
            "zm": zone_info["zm"] if zone_info else opts.defloczminute,
            "daylightsaving": zone_info["daylightsaving"] if zone_info else opts.deflocdst,
        }

    def _resolve_location_hit(self, query: str):
        display_query = " ".join((query or "").replace(",", " ").split())
        state_hint = self._us_state_abbrev_from_query(display_query)
        queries = self._location_queries(display_query)
        hit = None
        for candidate_query in queries:
            try:
                results = localcities.search(candidate_query, 8)
            except Exception:
                results = []
            if results:
                hit = self._choose_location_hit(results, state_hint=state_hint)
                break
        return display_query, state_hint, hit, queries

    def _location_queries(self, query: str) -> list[str]:
        variants: list[str] = []

        def add(value: str) -> None:
            value = " ".join((value or "").replace(",", " ").split())
            if value and value not in variants:
                variants.append(value)

        add(query)
        parts = str(query or "").replace(",", " ").split()
        if len(parts) >= 2:
            last = parts[-1]
            if last.isalpha() and len(last) == 2:
                add(" ".join(parts[:-1]))
        normalized = " ".join(str(query or "").replace(",", " ").split()).lower()
        for token in _US_STATE_ABBREV_BY_TOKEN:
            if normalized.endswith(token):
                trimmed = normalized[: -len(token)].strip()
                if trimmed:
                    add(trimmed)
        return variants

    @staticmethod
    def _location_label(hit, *, display_query: str = "", state_hint: str = "") -> str:
        name = str(hit[geonames.Geonames.NAME]).strip()
        country_code = str(hit[geonames.Geonames.COUNTRYCODE]).strip().upper()
        admin1_code = ""
        if len(hit) > geonames.Geonames.ADMIN1CODE:
            admin1_code = str(hit[geonames.Geonames.ADMIN1CODE]).strip().upper()
        if country_code == "US" and (not admin1_code or len(admin1_code) != 2):
            admin1_code = state_hint or SpotlightService._us_state_abbrev_from_query(display_query)
        if country_code == "US" and len(admin1_code) == 2 and admin1_code.isalpha():
            return f"{name}, {admin1_code}"
        return name

    @staticmethod
    def _choose_location_hit(results, *, state_hint: str = ""):
        if not results:
            return None
        state_hint = (state_hint or "").strip().upper()
        if not state_hint:
            return results[0]
        for hit in results:
            country_code = str(hit[geonames.Geonames.COUNTRYCODE]).strip().upper()
            admin1_code = ""
            if len(hit) > geonames.Geonames.ADMIN1CODE:
                admin1_code = str(hit[geonames.Geonames.ADMIN1CODE]).strip().upper()
            if country_code == "US" and admin1_code == state_hint:
                return hit
        for hit in results:
            if str(hit[geonames.Geonames.COUNTRYCODE]).strip().upper() == "US":
                return hit
        return results[0]

    @staticmethod
    def _place_from_coords(label: str, lon: float, lat: float, altitude: int):
        def deg_parts(value: float) -> tuple[int, int]:
            value = abs(float(value))
            deg = int(value)
            minute = int(round((value - deg) * 60.0))
            if minute >= 60:
                deg += 1
                minute = 0
            return deg, minute

        londeg, lonmin = deg_parts(lon)
        latdeg, latmin = deg_parts(lat)
        return export_chart_json.chart_mod.Place(
            label,
            londeg,
            lonmin,
            0,
            lon >= 0,
            latdeg,
            latmin,
            0,
            lat >= 0,
            altitude,
        )

    @staticmethod
    def _us_state_abbrev_from_query(query: str) -> str:
        query = " ".join((query or "").replace(",", " ").split()).lower()
        if not query:
            return ""
        parts = query.split()
        if parts:
            last = parts[-1].upper()
            if len(last) == 2 and last.isalpha():
                return last
        for token, abbrev in _US_STATE_ABBREV_BY_TOKEN.items():
            if query.endswith(token):
                return abbrev
        return ""

    def _targets_active_steppable_chart(
        self,
        parsed: datetime_parser.ParsedDateTime,
        active: Optional[dict[str, Any]],
    ) -> bool:
        if active is None or not self._can_update_current_chart(parsed):
            return False
        try:
            return bool(workspace_service.spotlight_current_supported())
        except Exception:
            return False

    @staticmethod
    def _can_update_current_chart(parsed: datetime_parser.ParsedDateTime) -> bool:
        return bool(parsed.location_query or SpotlightService._has_partial_datetime(parsed))

    @staticmethod
    def _has_partial_datetime(parsed: datetime_parser.ParsedDateTime) -> bool:
        if parsed.has_time and not parsed.has_date:
            return True
        has_any_date_part = any(
            getattr(parsed, attr, None) is not None
            for attr in ("day", "month", "year")
        )
        return has_any_date_part and not (parsed.has_date and parsed.has_time)

    @staticmethod
    def _parsed_has_temporal(parsed: Optional[datetime_parser.ParsedDateTime]) -> bool:
        if parsed is None:
            return False
        if parsed.has_date or parsed.has_time:
            return True
        return any(
            getattr(parsed, attr, None) is not None
            for attr in ("day", "month", "year")
        )

    @staticmethod
    def _serialize_parsed(parsed: datetime_parser.ParsedDateTime) -> dict[str, Any]:
        return {
            "day": parsed.day,
            "month": parsed.month,
            "year": parsed.year,
            "hour": parsed.hour,
            "minute": parsed.minute,
            "second": parsed.second,
            "calendar": parsed.calendar,
            "locationQuery": parsed.location_query,
            "hasDate": parsed.has_date,
            "hasTime": parsed.has_time,
        }

    @staticmethod
    def _datetime_from_parsed(
        parsed: datetime_parser.ParsedDateTime,
        anchor=None,
    ) -> Optional[datetime_parser.ResolvedCivilDateTime]:
        return datetime_parser.resolve_datetime(parsed, anchor=anchor)

    def _current_merge_anchor(
        self,
        parsed: datetime_parser.ParsedDateTime,
    ) -> datetime_parser.ResolvedCivilDateTime:
        try:
            display = workspace_service.spotlight_active_display_datetime()
        except Exception:
            display = None
        anchor = None
        if display:
            try:
                y, m, d, h, mi, s = [int(v) for v in tuple(display)[:6]]
                anchor = datetime_parser.ResolvedCivilDateTime(
                    y, m, d, h, mi, s,
                    datetime_parser.calendar_for_date(y, m, d),
                )
            except Exception:
                anchor = None
        resolved = self._datetime_from_parsed(parsed, anchor=anchor)
        if resolved is not None:
            return resolved
        now = datetime.datetime.now()
        return datetime_parser.ResolvedCivilDateTime(
            now.year, now.month, now.day, now.hour, now.minute, now.second,
            datetime_parser.calendar_for_date(now.year, now.month, now.day),
        )

    @staticmethod
    def _display_tuple(
        dt: datetime_parser.ResolvedCivilDateTime,
    ) -> tuple[int, int, int, int, int, int]:
        return dt.as_tuple()

    @staticmethod
    def _calendar_enum(calendar: str) -> int:
        chart_mod = export_chart_json.chart_mod
        if calendar == datetime_parser.CALENDAR_JULIAN:
            return chart_mod.Time.JULIAN
        return chart_mod.Time.GREGORIAN

    def _preview_location_label(self, query: str) -> str:
        query = (query or "").strip()
        if not query:
            return ""
        display_query = " ".join(query.replace(",", " ").split())
        if len(display_query) < 3:
            return display_query
        try:
            display_query, state_hint, hit, _queries = self._resolve_location_hit(query)
        except Exception:
            hit = None
            state_hint = ""
        if hit is None:
            return display_query
        return self._location_label(hit, display_query=display_query, state_hint=state_hint)

    @staticmethod
    def _normalize_query(value: str) -> str:
        return " ".join((value or "").strip().lower().split())


_US_STATE_ABBREV_BY_TOKEN = {
    "alabama": "AL",
    "alaska": "AK",
    "arizona": "AZ",
    "arkansas": "AR",
    "california": "CA",
    "colorado": "CO",
    "connecticut": "CT",
    "delaware": "DE",
    "florida": "FL",
    "georgia": "GA",
    "hawaii": "HI",
    "idaho": "ID",
    "illinois": "IL",
    "indiana": "IN",
    "iowa": "IA",
    "kansas": "KS",
    "kentucky": "KY",
    "louisiana": "LA",
    "maine": "ME",
    "maryland": "MD",
    "massachusetts": "MA",
    "michigan": "MI",
    "minnesota": "MN",
    "mississippi": "MS",
    "missouri": "MO",
    "montana": "MT",
    "nebraska": "NE",
    "nevada": "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    "ohio": "OH",
    "oklahoma": "OK",
    "oregon": "OR",
    "pennsylvania": "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    "tennessee": "TN",
    "texas": "TX",
    "utah": "UT",
    "vermont": "VT",
    "virginia": "VA",
    "washington": "WA",
    "west virginia": "WV",
    "wisconsin": "WI",
    "wyoming": "WY",
}


spotlight_service = SpotlightService()
