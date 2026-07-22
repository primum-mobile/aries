# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Daemon-side Search module surface.

The search brain already exists in ``searchbackend.py``. This service is only
the webapp boundary: it builds the canonical ``SearchCatalog`` / ``SearchQuery``
objects, calls the backend, and serializes the rows for the React table.

Source surface: ``searchwnd.SearchWnd`` / ``searchframe.SearchFrame``.
"""
from __future__ import annotations

import calendar
import datetime
import math
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import chart
import common
import dateformat
import mtexts
import searchbackend
import searchcatalog
import searchquery
import util
from engine import moment
from engine.supplementary_headless_driver import SupplementaryHeadlessDriver
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.display_palette import (
    aspect_color_role,
    effective_display_options,
    object_glyph_color,
    object_glyph_color_role,
    sign_color_role,
)
from webapp.daemon.event_time import DefaultLocationClock, table_event_clock


RESULT_LIMIT = 500
SEARCH_JOB_TTL_SECONDS = 5 * 60

# (technique id, mtexts key, English fallback). Labels are resolved from
# mtexts at SERVE time (see _technique_payloads) so the active langid applies.
TECHNIQUE_DEFS = (
    (searchquery.SearchQuery.TECHNIQUE_TRANSITS, "Transits", "Transits"),
    (searchquery.SearchQuery.TECHNIQUE_CONVERSE_TRANSITS, "ConverseTransits", "Converse Transits"),
    (searchquery.SearchQuery.TECHNIQUE_PROFECTIONS, "Profections", "Profections"),
    (searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS, "SecProgressions", "Sec. Progressions"),
    (searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS, "PrimaryDirections", "Primary Directions"),
    (searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER, "CelestialWeather", "Celestial Weather"),
    (searchquery.SearchQuery.TECHNIQUE_HELIACAL_PHASES, "HeliacalPhases", "Heliacal Phases"),
)

DEFAULT_TECHNIQUES = (
    searchquery.SearchQuery.TECHNIQUE_TRANSITS,
    searchquery.SearchQuery.TECHNIQUE_PROFECTIONS,
)
FIND_TRANSITS_TECHNIQUES = (searchquery.SearchQuery.TECHNIQUE_TRANSITS,)

MAJOR_ASPECTS = (
    searchquery.SearchQuery.ASPECT_CONJUNCTION,
    searchquery.SearchQuery.ASPECT_SEXTILE,
    searchquery.SearchQuery.ASPECT_SQUARE,
    searchquery.SearchQuery.ASPECT_TRINE,
    searchquery.SearchQuery.ASPECT_OPPOSITION,
)

class _SearchJob:
    def __init__(self, session_id: str, owner_key: str, time_display: dict[str, Any]) -> None:
        self.session_id = session_id
        self.owner_key = owner_key
        self.time_display = dict(time_display)
        self._lock = threading.Lock()
        self.rows: list[dict[str, Any]] = []
        self.summary = mtexts.txts.get("Searching", "Searching")
        self.truncated = False
        self.complete = False
        self.cancelled = False
        self.phase = ""
        self.error = ""
        now = time.monotonic()
        self.created_at = now
        self.updated_at = now

    def update(
        self,
        *,
        rows: list[dict[str, Any]],
        truncated: bool,
        summary: str,
        phase: str,
    ) -> None:
        with self._lock:
            if self.cancelled:
                return
            self.rows = rows
            self.truncated = bool(truncated)
            self.summary = summary
            self.phase = phase
            self.updated_at = time.monotonic()

    def finish(self) -> None:
        with self._lock:
            self.complete = True
            self.updated_at = time.monotonic()

    def fail(self, message: str) -> None:
        with self._lock:
            if self.cancelled:
                return
            self.error = message
            self.summary = mtexts.txts.get("SearchFailed", "Search failed")
            self.complete = True
            self.updated_at = time.monotonic()

    def cancel(self) -> None:
        with self._lock:
            self.cancelled = True
            self.complete = True
            self.summary = mtexts.txts.get("SearchCancelled", "Search cancelled")
            self.updated_at = time.monotonic()

    def is_cancelled(self) -> bool:
        with self._lock:
            return bool(self.cancelled)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "sessionId": self.session_id,
                "rows": list(self.rows),
                "truncated": bool(self.truncated),
                "summary": self.summary,
                "complete": bool(self.complete),
                "cancelled": bool(self.cancelled),
                "phase": self.phase,
                "error": self.error,
                "timeDisplay": dict(self.time_display),
            }


class TransitSearchService:
    """Thin JSON boundary over the existing search backend."""

    def __init__(self) -> None:
        self._driver = SupplementaryHeadlessDriver(chart_snapshot_service.options)
        self._has_saved_search_state = False
        self._jobs: dict[str, _SearchJob] = {}
        self._jobs_lock = threading.Lock()
        self._search_worker_lock = threading.Lock()

    def catalog(
        self,
        chrt,
        *,
        custom_points: Optional[list[dict[str, Any]]] = None,
        initial_significator_id: Optional[str] = None,
        initial_techniques: Optional[list[str] | tuple[str, ...]] = None,
    ) -> dict:
        catalog = searchcatalog.SearchCatalog(chrt, custom_points=custom_points)
        default_from, default_to = self._default_date_range()
        default_clock = table_event_clock(chart_snapshot_service.options)
        initial_id = (
            initial_significator_id
            if initial_significator_id in catalog.objects_by_id
            else None
        )
        initial_technique_ids = self._valid_techniques(initial_techniques)
        opts = chart_snapshot_service.options
        saved_techniques = self._valid_techniques(getattr(opts, "search_techniques", []))
        saved_aspects = self._valid_aspects(getattr(opts, "search_aspects", []))
        saved_promittors = [
            oid
            for oid in getattr(opts, "search_promittor_ids", [])
            if oid in catalog.objects_by_id and oid != "planet:moon"
        ]
        saved_significators = [
            oid
            for oid in getattr(opts, "search_significator_ids", [])
            if oid in catalog.objects_by_id
        ]
        standard_promittors = self._standard_promittor_ids(catalog)
        standard_significators = self._standard_significator_ids(catalog)
        has_saved_state = self._search_has_saved_state()
        if initial_id:
            default_significators = [initial_id]
            default_techniques = initial_technique_ids or list(DEFAULT_TECHNIQUES)
            default_promittors = self._regular_promittor_ids(catalog)
            default_aspects = saved_aspects or [searchquery.SearchQuery.ASPECT_CONJUNCTION]
        else:
            default_significators = (
                saved_significators
                if has_saved_state
                else standard_significators
            )
            default_techniques = (
                saved_techniques
                if has_saved_state
                else list(DEFAULT_TECHNIQUES)
            )
            default_promittors = (
                saved_promittors
                if has_saved_state
                else standard_promittors
            )
            default_aspects = (
                saved_aspects
                if has_saved_state
                else [searchquery.SearchQuery.ASPECT_CONJUNCTION]
            )
        initial_obj = catalog.get(initial_id) if initial_id else None
        return {
            "title": mtexts.txts.get("Search", "Search"),
            "sourceName": getattr(chrt, "name", "") or "Radix",
            "dateConvention": dateformat.date_convention_from_options(opts),
            "timeDisplay": default_clock.metadata(
                mtexts.txts.get("Time", "Time"),
                offsets=default_clock.offsets_for_range(default_from, default_to),
            ),
            "meanNode": bool(getattr(chrt.options, "meannode", True)),
            "initialSignificatorId": initial_id,
            "initialSignificatorLabel": getattr(initial_obj, "label", "") if initial_obj else "",
            "initialSignificatorGlyph": self._object_glyph(initial_obj),
            "objects": [self._object_payload(obj) for obj in catalog.objects],
            "techniques": self._technique_payloads(),
            "promittorIds": catalog.promittor_ids[:],
            "significatorIds": catalog.significator_ids[:],
            "builtinSignificatorIds": catalog.builtin_significator_ids[:],
            "partIds": catalog.part_ids[:],
            "aspects": self._aspect_payloads(),
            "presets": {
                "aspects": {
                    "all": [aspect_id for aspect_id, _idx, _both, _label in searchbackend.ASPECT_DEFS],
                    "major": list(MAJOR_ASPECTS),
                    "clear": [],
                },
                "promittors": {
                    "all": catalog.promittor_ids[:],
                    "standard": standard_promittors,
                    "planets": self._planetary_promittor_ids(catalog),
                    "core7": self._classical_promittor_ids(catalog),
                    "clear": [],
                },
                "significators": {
                    "standard": standard_significators,
                    "builtins": catalog.builtin_significator_ids[:],
                    "planets": self._planetary_significator_ids(catalog),
                    "clear": [],
                },
            },
            "defaults": {
                "fromDate": default_from.isoformat(),
                "toDate": default_to.isoformat(),
                "techniques": default_techniques,
                "promittorIds": default_promittors,
                "significatorIds": default_significators,
                "aspects": default_aspects,
                "includeSignChanges": bool(getattr(opts, "search_sign_changes", False)),
                "partFilter": str(getattr(opts, "search_part_filter", "") or ""),
                "defaultOffsetMonths": self._coerce_month_option("search_default_offset_months", -2, -120, 120),
                "defaultRangeMonths": self._coerce_month_option("search_default_range_months", 12, 1, 120),
                "limit": RESULT_LIMIT,
                "hasSavedState": has_saved_state,
            },
        }

    def search(
        self,
        chrt,
        payload: dict[str, Any],
        *,
        custom_points: Optional[list[dict[str, Any]]] = None,
        persist: bool = True,
    ) -> dict:
        catalog = searchcatalog.SearchCatalog(chrt, custom_points=custom_points)
        query = searchquery.SearchQuery()
        query.set_techniques(self._valid_techniques(payload.get("techniques")) or list(DEFAULT_TECHNIQUES))
        query.set_promittor_ids(
            self._valid_ids(catalog, payload.get("promittorIds"), can_promittor=True)
        )
        query.set_significator_ids(
            self._valid_ids(catalog, payload.get("significatorIds"), can_significator=True)
        )
        query.set_aspects(self._valid_aspects(payload.get("aspects")))
        query.set_include_sign_changes(bool(payload.get("includeSignChanges", False)))
        query.set_object_motion_filters(payload.get("objectMotionFilters") or {})
        progression_method = payload.get("progressionMethod")
        if progression_method is not None:
            try:
                query.set_progression_method(int(progression_method))
            except Exception:
                pass

        start_date = self._parse_date(payload.get("fromDate"))
        end_date = self._parse_date(payload.get("toDate"))
        if start_date is None or end_date is None:
            raise ValueError("fromDate and toDate are required ISO dates")
        if start_date > end_date:
            raise ValueError("fromDate must be before toDate")
        display_clock = table_event_clock(chart_snapshot_service.options)
        time_display = display_clock.metadata(
            mtexts.txts.get("Time", "Time"),
            offsets=display_clock.offsets_for_range(start_date, end_date),
        )
        if query.get_combination_count() == 0:
            return {
                "rows": [],
                "truncated": False,
                "summary": mtexts.txts.get(
                    "NoValidTransitSearchCombinations",
                    "No valid transit search combinations.",
                ),
                "timeDisplay": time_display,
            }

        raw_limit = payload.get("limit", RESULT_LIMIT)
        try:
            limit = int(raw_limit)
        except Exception:
            limit = RESULT_LIMIT
        limit = max(1, min(RESULT_LIMIT, limit))
        if persist:
            self._persist_search_options(query, start_date, end_date, payload)

        rows, truncated = searchbackend.search(
            catalog, chrt, query, start_date, end_date, limit
        )
        display_options = effective_display_options(chart_snapshot_service.options)
        serialized = [
            self._row_payload(
                row,
                catalog,
                chrt,
                index,
                display_clock=display_clock,
                display_options=display_options,
            )
            for index, row in enumerate(rows)
        ]
        return {
            "rows": serialized,
            "truncated": bool(truncated),
            "summary": self._summary_text(serialized, truncated),
            "timeDisplay": time_display,
        }

    def search_transits(
        self,
        chrt,
        payload: dict[str, Any],
        *,
        custom_points: Optional[list[dict[str, Any]]] = None,
        persist: bool = True,
    ) -> dict:
        return self.search(chrt, payload, custom_points=custom_points, persist=persist)

    def start_search(
        self,
        chrt,
        payload: dict[str, Any],
        *,
        custom_points: Optional[list[dict[str, Any]]] = None,
        persist: bool = True,
    ) -> dict:
        catalog = searchcatalog.SearchCatalog(chrt, custom_points=custom_points)
        query = searchquery.SearchQuery()
        query.set_techniques(self._valid_techniques(payload.get("techniques")) or list(DEFAULT_TECHNIQUES))
        query.set_promittor_ids(
            self._valid_ids(catalog, payload.get("promittorIds"), can_promittor=True)
        )
        query.set_significator_ids(
            self._valid_ids(catalog, payload.get("significatorIds"), can_significator=True)
        )
        query.set_aspects(self._valid_aspects(payload.get("aspects")))
        query.set_include_sign_changes(bool(payload.get("includeSignChanges", False)))
        query.set_object_motion_filters(payload.get("objectMotionFilters") or {})
        progression_method = payload.get("progressionMethod")
        if progression_method is not None:
            try:
                query.set_progression_method(int(progression_method))
            except Exception:
                pass

        start_date = self._parse_date(payload.get("fromDate"))
        end_date = self._parse_date(payload.get("toDate"))
        if start_date is None or end_date is None:
            raise ValueError("fromDate and toDate are required ISO dates")
        if start_date > end_date:
            raise ValueError("fromDate must be before toDate")
        display_clock = table_event_clock(chart_snapshot_service.options)
        time_display = display_clock.metadata(
            mtexts.txts.get("Time", "Time"),
            offsets=display_clock.offsets_for_range(start_date, end_date),
        )

        raw_limit = payload.get("limit", RESULT_LIMIT)
        try:
            limit = int(raw_limit)
        except Exception:
            limit = RESULT_LIMIT
        limit = max(1, min(RESULT_LIMIT, limit))
        if persist:
            self._persist_search_options(query, start_date, end_date, payload)

        session_id = uuid.uuid4().hex
        job = _SearchJob(session_id, self._owner_key(payload), time_display)
        self._remember_job(job)
        if query.get_combination_count() == 0:
            job.update(
                rows=[],
                truncated=False,
                summary=mtexts.txts.get(
                    "NoValidTransitSearchCombinations",
                    "No valid transit search combinations.",
                ),
                phase="",
            )
            job.finish()
            return job.snapshot()

        thread = threading.Thread(
            target=self._run_search_job,
            args=(job, catalog, chrt, query, start_date, end_date, limit),
            daemon=True,
        )
        thread.start()
        return job.snapshot()

    def progress(self, session_id: str) -> dict:
        self._cleanup_jobs()
        with self._jobs_lock:
            job = self._jobs.get(str(session_id or ""))
        if job is None:
            raise ValueError("unknown search session")
        return job.snapshot()

    def cancel(self, session_id: str) -> dict:
        with self._jobs_lock:
            job = self._jobs.get(str(session_id or ""))
        if job is None:
            return {"cancelled": False}
        job.cancel()
        return {"cancelled": True}

    def _run_search_job(
        self,
        job: _SearchJob,
        catalog: searchcatalog.SearchCatalog,
        chrt,
        query: searchquery.SearchQuery,
        start_date: datetime.date,
        end_date: datetime.date,
        limit: int,
    ) -> None:
        try:
            emitted = False
            display_clock = table_event_clock(chart_snapshot_service.options)
            display_options = effective_display_options(chart_snapshot_service.options)
            # Swiss Ephemeris mode/topocentric flags are process-global. Keep
            # worker searches serialized while still letting the UI return and
            # poll progressively.
            with self._search_worker_lock:
                for phase, rows, truncated in searchbackend.search_progress(
                    catalog, chrt, query, start_date, end_date, limit
                ):
                    if job.is_cancelled():
                        return
                    emitted = True
                    serialized = [
                        self._row_payload(
                            row,
                            catalog,
                            chrt,
                            index,
                            display_clock=display_clock,
                            display_options=display_options,
                        )
                        for index, row in enumerate(rows)
                    ]
                    job.update(
                        rows=serialized,
                        truncated=truncated,
                        summary=self._summary_text(serialized, truncated),
                        phase=str(phase or ""),
                    )
            if not emitted:
                job.update(rows=[], truncated=False, summary=mtexts.txts.get("ZeroResults", "0 results"), phase="")
            job.finish()
        except Exception as exc:
            job.fail(str(exc))

    def _remember_job(self, job: _SearchJob) -> None:
        self._cleanup_jobs()
        with self._jobs_lock:
            for existing in self._jobs.values():
                if existing.owner_key == job.owner_key and not existing.complete:
                    existing.cancel()
            self._jobs[job.session_id] = job

    def _cleanup_jobs(self) -> None:
        cutoff = time.monotonic() - SEARCH_JOB_TTL_SECONDS
        with self._jobs_lock:
            expired = [
                session_id
                for session_id, job in self._jobs.items()
                if job.updated_at < cutoff
            ]
            for session_id in expired:
                self._jobs.pop(session_id, None)

    @staticmethod
    def _owner_key(payload: dict[str, Any]) -> str:
        return ":".join(
            str(payload.get(key) or "")
            for key in ("documentId", "chartRole", "significatorId")
        )

    def save_settings(
        self,
        chrt,
        payload: dict[str, Any],
        *,
        custom_points: Optional[list[dict[str, Any]]] = None,
        persist: bool = True,
    ) -> dict:
        if not persist:
            return {"ok": True}
        catalog = searchcatalog.SearchCatalog(chrt, custom_points=custom_points)
        query = searchquery.SearchQuery()
        query.set_techniques(self._valid_techniques(payload.get("techniques")))
        query.set_promittor_ids(
            self._valid_ids(catalog, payload.get("promittorIds"), can_promittor=True)
        )
        query.set_significator_ids(
            self._valid_ids(catalog, payload.get("significatorIds"), can_significator=True)
        )
        query.set_aspects(self._valid_aspects(payload.get("aspects")))
        query.set_include_sign_changes(bool(payload.get("includeSignChanges", False)))
        start_date = self._parse_date(payload.get("fromDate")) or datetime.date.today()
        end_date = self._parse_date(payload.get("toDate")) or start_date
        self._persist_search_options(query, start_date, end_date, payload)
        return {"ok": True}

    def update_default_range(self, offset_months: Any, range_months: Any) -> dict:
        opts = chart_snapshot_service.options
        offset = self._coerce_int(offset_months, -2, -120, 120)
        span = self._coerce_int(range_months, 12, 1, 120)
        opts.search_default_offset_months = offset
        opts.search_default_range_months = span
        self._mark_search_options_changed()
        start, end = self._default_date_range()
        return {
            "defaultOffsetMonths": offset,
            "defaultRangeMonths": span,
            "fromDate": start.isoformat(),
            "toDate": end.isoformat(),
        }

    def export_rows(self, rows_payload: Any, kind: str) -> dict:
        """Clipboard/ICS text for selected result rows.

        Oracle: searchwnd._on_copy_selected_time (searchwnd.py:3733) calls
        searchbackend.build_clipboard_text(selected); _on_export_selected_ics
        (searchwnd.py:3744) writes searchbackend.build_ics(selected). The skin
        never reassembles these strings — rows round-trip through the brains.
        """
        rows = [self._export_row(item) for item in list(rows_payload or [])]
        if str(kind) == "ics":
            return {"text": searchbackend.build_ics(rows), "filename": "search.ics"}
        return {"text": searchbackend.build_clipboard_text(rows)}

    @staticmethod
    def _export_row(item: Any) -> searchquery.SearchResult:
        """Rebuild the SearchResult DTO fields the export brains read
        (searchquery.py:113-135): labels, event date/time strings, raw event
        ints, aspect/technique ids, and notes."""
        data = dict(item or {})
        row = searchquery.SearchResult(
            str(data.get("technique") or ""),
            str(data.get("aspect") or ""),
            str(data.get("promittorId") or ""),
            str(data.get("significatorId") or ""),
        )
        row.promittor_label = str(data.get("promittorLabel") or "")
        row.significator_label = str(data.get("significatorLabel") or "")
        row.event_date = str(data.get("eventDate") or "")
        row.event_time = str(data.get("eventTime") or "")
        row.notes = str(data.get("notes") or "")
        event_tuple = data.get("eventTuple")
        if isinstance(event_tuple, (list, tuple)) and len(event_tuple) >= 6:
            (
                row.event_year, row.event_month, row.event_day,
                row.event_hour, row.event_minute, row.event_second,
            ) = [int(value) for value in event_tuple[:6]]
        return row

    def _default_date_range(self) -> tuple[datetime.date, datetime.date]:
        opts = chart_snapshot_service.options
        today = datetime.date.today()
        offset = self._coerce_month_option("search_default_offset_months", -2, -120, 120)
        span = self._coerce_month_option("search_default_range_months", 12, 1, 120)
        start = self._add_months(today, offset)
        return start, self._add_months(start, span)

    @staticmethod
    def _add_months(value: datetime.date, months: int) -> datetime.date:
        month_index = value.month - 1 + int(months)
        year = value.year + month_index // 12
        month = month_index % 12 + 1
        day = min(value.day, calendar.monthrange(year, month)[1])
        return datetime.date(year, month, day)

    @staticmethod
    def _coerce_month_option(attr_name: str, default: int, min_value: int, max_value: int) -> int:
        try:
            value = int(getattr(chart_snapshot_service.options, attr_name, default))
        except Exception:
            value = int(default)
        return max(int(min_value), min(int(max_value), value))

    @staticmethod
    def _coerce_int(value: Any, default: int, min_value: int, max_value: int) -> int:
        try:
            coerced = int(value)
        except Exception:
            coerced = int(default)
        return max(int(min_value), min(int(max_value), coerced))

    @staticmethod
    def _parse_date(value: Any) -> Optional[datetime.date]:
        if isinstance(value, datetime.date):
            return value
        try:
            return datetime.date.fromisoformat(str(value))
        except Exception:
            return None

    @staticmethod
    def _valid_ids(
        catalog: searchcatalog.SearchCatalog,
        ids: Any,
        *,
        can_promittor: bool = False,
        can_significator: bool = False,
    ) -> list[str]:
        out: list[str] = []
        for raw in list(ids or []):
            oid = str(raw)
            obj = catalog.get(oid)
            if obj is None:
                continue
            if can_promittor and not obj.can_promittor:
                continue
            if can_significator and not obj.can_significator:
                continue
            if oid not in out:
                out.append(oid)
        return out

    @staticmethod
    def _valid_aspects(ids: Any) -> list[str]:
        valid = {aspect_id for aspect_id, _idx, _both, _label in searchbackend.ASPECT_DEFS}
        out: list[str] = []
        for raw in list(ids or []):
            aspect_id = str(raw)
            if aspect_id in valid and aspect_id not in out:
                out.append(aspect_id)
        return out

    @staticmethod
    def _valid_techniques(ids: Any) -> list[str]:
        valid = {technique_id for technique_id, _key, _label in TECHNIQUE_DEFS}
        out: list[str] = []
        for raw in list(ids or []):
            technique_id = str(raw)
            if technique_id in valid and technique_id not in out:
                out.append(technique_id)
        return out

    def _technique_payloads(self) -> list[dict[str, Any]]:
        return [
            {"id": technique_id, "label": mtexts.txts.get(key, label)}
            for technique_id, key, label in TECHNIQUE_DEFS
        ]

    def _aspect_payloads(self) -> list[dict[str, Any]]:
        return [
            {
                "id": aspect_id,
                "label": label,
                "glyph": searchbackend._search_aspect_glyph(aspect_id),
                "chartAspect": int(chart_aspect),
                "bothSides": bool(both_sides),
            }
            for aspect_id, chart_aspect, both_sides, label in searchbackend.ASPECT_DEFS
        ]

    def _object_payload(self, obj: searchcatalog.SearchObject) -> dict[str, Any]:
        return {
            "id": obj.id,
            "label": obj.label,
            "family": obj.family,
            "sourceType": obj.source_type,
            "longitude": obj.longitude,
            "longitudeText": searchcatalog.format_longitude(obj.longitude),
            "planetIndex": obj.planet_index,
            "canPromittor": bool(obj.can_promittor),
            "canSignificator": bool(obj.can_significator),
            "glyph": self._object_glyph(obj),
            "displayMarker": self._object_marker(obj),
            "displaySegments": self._object_segments(obj),
            "fixedstarCode": getattr(obj, "fixedstar_code", None),
        }

    @staticmethod
    def _object_glyph(obj: Optional[searchcatalog.SearchObject]) -> str:
        if obj is None:
            return ""
        display_glyph = getattr(obj, "display_glyph", "")
        if display_glyph:
            return str(display_glyph)
        if obj.planet_index is not None:
            return common.common.get_planet_glyph(obj.planet_index)
        if obj.id == "point:lof":
            return common.common.fortune
        return ""

    @staticmethod
    def _object_marker(obj: Optional[searchcatalog.SearchObject]) -> str:
        if obj is None:
            return ""
        return str(getattr(obj, "display_marker", "") or "")

    @staticmethod
    def _object_segments(obj: Optional[searchcatalog.SearchObject]) -> list[dict[str, Any]]:
        if obj is None:
            return []
        segments = getattr(obj, "display_segments", None) or []
        if not isinstance(segments, list):
            return []
        out: list[dict[str, Any]] = []
        for segment in segments:
            if not isinstance(segment, dict):
                continue
            text = str(segment.get("text") or "")
            kind = str(segment.get("kind") or "text")
            if not text or kind not in ("text", "planet", "glyph"):
                continue
            payload: dict[str, Any] = {"text": text, "kind": kind}
            if "seId" in segment:
                try:
                    payload["seId"] = int(segment.get("seId"))
                except Exception:
                    pass
            out.append(payload)
        return out

    def _row_payload(
        self,
        row: searchquery.SearchResult,
        catalog: searchcatalog.SearchCatalog,
        chrt,
        index: int,
        *,
        display_clock: DefaultLocationClock | None = None,
        display_options=None,
    ) -> dict[str, Any]:
        display_options = display_options or effective_display_options(
            chart_snapshot_service.options
        )
        event_tuple = self._event_tuple(row)
        display = (display_clock or table_event_clock(chart_snapshot_service.options)).display(event_tuple)
        display_tuple = display.values
        open_event_tuple = self._chart_open_event_tuple(row) or event_tuple
        open_tuple = self._display_datetime_for_chart_instant(chrt, open_event_tuple)
        prom = catalog.get(row.promittor_id)
        sig = catalog.get(row.significator_id)
        metadata = dict(row.metadata)
        metadata["aspect_color"] = self._aspect_color(row, display_options)
        metadata["aspect_color_role"] = self._aspect_color_role(row, display_options)
        if row.metadata.get("sign_change"):
            from_display, to_display = self._sign_change_displays(row)
            if from_display:
                metadata["sign_change_from_display"] = self._decorate_display_payload(
                    from_display, display_options, obj=prom
                )
            if to_display:
                metadata["sign_change_to_display"] = self._decorate_display_payload(
                    to_display, display_options, obj=prom
                )
        prom_display = self._decorate_display_payload(
            row.metadata.get("prom_display", {}), display_options, obj=prom
        )
        sig_display = self._decorate_display_payload(
            row.metadata.get("sig_display", {}), display_options, obj=sig
        )
        return {
            "key": "%d:%s:%s:%s:%s" % (
                index, row.event_date, row.event_time, row.promittor_id, row.significator_id
            ),
            "technique": row.technique,
            "techniqueLabel": searchbackend.format_result_technique_label(row),
            "aspect": row.aspect,
            "aspectLabel": searchbackend.ASPECT_LABEL_BY_ID.get(row.aspect, row.aspect),
            "aspectGlyph": "" if row.metadata.get("sign_change") or row.metadata.get("station") or row.metadata.get("cazimi") or row.metadata.get("heliacal") else searchbackend._search_aspect_glyph(row.aspect),
            "promittorId": row.promittor_id,
            "promittorLabel": row.promittor_label,
            "promittorGlyph": self._object_glyph(prom),
            "promittorMarker": self._object_marker(prom),
            "promittorSegments": self._object_segments(prom),
            "significatorId": row.significator_id,
            "significatorLabel": row.significator_label,
            "significatorGlyph": self._object_glyph(sig),
            "significatorMarker": self._object_marker(sig),
            "significatorSegments": self._object_segments(sig),
            "eventDate": row.event_date,
            "eventTime": row.event_time,
            # Raw UTC event ints — round-tripped by /api/search/export so the
            # Python brains (build_clipboard_text / build_ics) format the exact
            # same SearchResult fields the wx menu actions used.
            "eventTuple": list(self._event_tuple(row)),
            "displayDatetime": display.iso,
            "displayDate": self._date_text(display_tuple),
            "displayTime": self._time_text(display_tuple),
            "displayUtcOffsetMinutes": display.utc_offset_minutes,
            "openDatetime": self._iso_text(open_tuple),
            "eventJd": row.event_jd,
            "canOpenChart": bool(row.can_open_chart),
            "canExportTime": bool(row.can_export_time),
            "canExportIcs": bool(row.can_export_ics),
            "notes": row.notes,
            "metadata": self._json_clean(metadata),
            "promDisplay": self._json_clean(prom_display),
            "sigDisplay": self._json_clean(sig_display),
            "isSignChange": bool(row.metadata.get("sign_change")),
            "primaryMode": self._primary_mode_text(row),
            "primaryDirection": self._primary_direction_text(row),
        }

    def _aspect_color(self, row: searchquery.SearchResult, display_options=None) -> str:
        display_options = display_options or effective_display_options(
            chart_snapshot_service.options
        )
        if row.metadata.get("sign_change"):
            return self._rgb_css(getattr(display_options, "clrtexts", (0, 0, 0)))
        chart_aspect = searchbackend.ASPECT_INDEX_BY_ID.get(row.aspect)
        if chart_aspect is None:
            return self._rgb_css(getattr(display_options, "clrtexts", (0, 0, 0)))
        colors = getattr(display_options, "clraspect", ())
        try:
            return self._rgb_css(colors[int(chart_aspect)])
        except Exception:
            return self._rgb_css(getattr(display_options, "clrtexts", (0, 0, 0)))

    def _aspect_color_role(
        self,
        row: searchquery.SearchResult,
        display_options=None,
    ) -> str | None:
        display_options = display_options or effective_display_options(
            chart_snapshot_service.options
        )
        color = self._aspect_color(row, display_options)
        return aspect_color_role(
            display_options,
            searchbackend.ASPECT_INDEX_BY_ID.get(row.aspect),
            resolved_color=color,
        )

    @staticmethod
    def _sign_change_displays(row: searchquery.SearchResult) -> tuple[dict[str, Any], dict[str, Any]]:
        pair = row.metadata.get("sign_pair")
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            return {}, {}
        try:
            left = int(pair[0]) % chart.Chart.SIGN_NUM
            right = int(pair[1]) % chart.Chart.SIGN_NUM
        except Exception:
            return {}, {}
        retrograde = bool(row.metadata.get("sign_change_retrograde"))
        one_minute = 1.0 / 60.0
        display_epsilon = 1e-7
        if retrograde:
            from_lon = float(left * chart.Chart.SIGN_DEG)
            to_lon = util.normalize(float((right + 1) * chart.Chart.SIGN_DEG) - one_minute + display_epsilon)
        else:
            from_lon = util.normalize(float(right * chart.Chart.SIGN_DEG) - one_minute + display_epsilon)
            to_lon = float(right * chart.Chart.SIGN_DEG)
        return (
            {
                "display_longitude": from_lon,
                "motion_marker": "",
                "dignity_code": None,
                "state_suffix": "",
                "is_live": False,
            },
            {
                "display_longitude": util.normalize(to_lon),
                "motion_marker": "",
                "dignity_code": None,
                "state_suffix": "",
                "is_live": False,
            },
        )

    def _decorate_display_payload(
        self,
        value: Any,
        display_options=None,
        *,
        obj: Optional[searchcatalog.SearchObject] = None,
    ) -> dict[str, Any]:
        if not isinstance(value, dict):
            return {}
        display_options = display_options or effective_display_options(
            chart_snapshot_service.options
        )
        payload = dict(value)
        sign_index = payload.get("sign_index")
        display_longitude = payload.get("display_longitude")
        if sign_index is None and display_longitude is not None:
            try:
                sign_index = int(float(display_longitude) / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
            except Exception:
                sign_index = None
        if sign_index is not None:
            try:
                sign_index_int = int(sign_index) % chart.Chart.SIGN_NUM
            except Exception:
                sign_index_int = None
            if sign_index_int is not None:
                signs = common.common.Signs1
                if not getattr(display_options, "signs", True):
                    signs = common.common.Signs2
                payload["sign_index"] = sign_index_int
                payload["sign_glyph"] = signs[sign_index_int]
                payload["sign_color"] = self._rgb_css(
                    common.get_sign_color(display_options, sign_index_int, force_element=True)
                )
                payload["sign_color_role"] = sign_color_role(
                    display_options,
                    sign_index_int,
                    force_element=True,
                    resolved_color=payload["sign_color"],
                )
        if display_longitude is not None:
            try:
                lon = float(display_longitude) % 360.0
                sign = int(lon / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
                deg, minute, _second = util.decToDeg(lon - sign * chart.Chart.SIGN_DEG)
                payload["degree_text"] = "%02d%s%02d" % (deg, chr(176), minute)
            except Exception:
                pass
        if payload.get("glyph_color") is not None:
            payload["glyph_color_css"] = self._rgb_css(
                object_glyph_color(
                    display_options,
                    obj,
                    payload.get("dignity_code"),
                    fallback=payload.get("glyph_color"),
                    source_options=chart_snapshot_service.options,
                )
            )
            payload["glyph_color_role"] = object_glyph_color_role(
                display_options,
                obj,
                payload.get("dignity_code"),
                resolved_color=payload["glyph_color_css"],
            )
        return payload

    @staticmethod
    def _rgb_css(value: Any) -> str:
        try:
            r, g, b = list(value)[:3]
            return "#%02x%02x%02x" % (
                max(0, min(255, int(r))),
                max(0, min(255, int(g))),
                max(0, min(255, int(b))),
            )
        except Exception:
            return "#000000"

    @staticmethod
    def _event_tuple(row: searchquery.SearchResult) -> tuple[int, int, int, int, int, int]:
        return (
            int(row.event_year), int(row.event_month), int(row.event_day),
            int(row.event_hour), int(row.event_minute), int(row.event_second),
        )

    @staticmethod
    def _chart_open_event_tuple(row: searchquery.SearchResult) -> tuple[int, int, int, int, int, int] | None:
        if row.technique != searchquery.SearchQuery.TECHNIQUE_CONVERSE_TRANSITS:
            return None
        raw = row.metadata.get("converse_transit_datetime")
        if not isinstance(raw, (list, tuple)) or len(raw) < 6:
            return None
        try:
            return tuple(int(value) for value in raw[:6])
        except Exception:
            return None

    def _display_datetime_for_chart_instant(
        self, chrt, utc_tuple: tuple[int, int, int, int, int, int]
    ) -> tuple[int, int, int, int, int, int]:
        """Delegates to the canonical Moment normalizer (engine/moment,
        policy-chart-lifecycle §1): displayed search/open times are local civil
        time; UT is retained only as raw event data/footer context."""
        converted = moment.utc_to_chart_local(
            getattr(chrt, "time", None),
            utc_tuple,
            place=getattr(chrt, "place", None),
        )
        return converted if converted is not None else utc_tuple

    @staticmethod
    def _date_text(value: tuple[int, int, int, int, int, int]) -> str:
        return dateformat.date_text(value[0], value[1], value[2], chart_snapshot_service.options)

    @staticmethod
    def _time_text(value: tuple[int, int, int, int, int, int]) -> str:
        return "%02d:%02d:%02d" % (value[3], value[4], value[5])

    @staticmethod
    def _iso_text(value: tuple[int, int, int, int, int, int]) -> str:
        return "%04d-%02d-%02dT%02d:%02d:%02d" % value

    @classmethod
    def _summary_text(cls, rows: list[dict[str, Any]], truncated: bool) -> str:
        count = len(rows)
        if count == 1:
            text = mtexts.txts.get("OneResult", "1 result")
        else:
            text = mtexts.txts.get("NResults", "%d results") % count
        if truncated:
            text += mtexts.txts.get("ResultsLimitedSuffix", " (limited)")
        return text

    @staticmethod
    def _primary_mode_text(row: searchquery.SearchResult) -> str:
        if row.technique != searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS:
            return ""
        return "M" if row.metadata.get("pd_mundane") else "Z"

    @staticmethod
    def _primary_direction_text(row: searchquery.SearchResult) -> str:
        if row.technique != searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS:
            return ""
        return "D" if row.metadata.get("pd_direct", True) else "C"

    @staticmethod
    def _regular_promittor_ids(catalog: searchcatalog.SearchCatalog) -> list[str]:
        return [
            oid for oid in catalog.promittor_ids
            if oid != "planet:moon"
            and (catalog.get(oid) is None or catalog.get(oid).family != searchcatalog.SearchObject.FAMILY_FIXED_STAR)
        ]

    @staticmethod
    def _standard_promittor_ids(catalog: searchcatalog.SearchCatalog) -> list[str]:
        return [
            oid
            for oid in catalog.promittor_ids
            if oid not in ("planet:moon", "planet:chiron")
            and (catalog.get(oid) is None or catalog.get(oid).family != searchcatalog.SearchObject.FAMILY_FIXED_STAR)
        ]

    @staticmethod
    def _standard_significator_ids(catalog: searchcatalog.SearchCatalog) -> list[str]:
        return [
            oid
            for oid in catalog.builtin_significator_ids
            if oid not in ("planet:chiron", "point:syzygy")
        ]

    @staticmethod
    def _planetary_promittor_ids(catalog: searchcatalog.SearchCatalog) -> list[str]:
        out: list[str] = []
        for oid in catalog.promittor_ids:
            if oid == "planet:moon":
                continue
            obj = catalog.get(oid)
            if obj is None:
                continue
            if obj.family in (searchcatalog.SearchObject.FAMILY_PLANET, searchcatalog.SearchObject.FAMILY_NODE):
                out.append(oid)
        return out

    @staticmethod
    def _classical_promittor_ids(catalog: searchcatalog.SearchCatalog) -> list[str]:
        order = (
            "planet:sun",
            "planet:moon",
            "planet:mercury",
            "planet:venus",
            "planet:mars",
            "planet:jupiter",
            "planet:saturn",
        )
        return [oid for oid in order if oid in catalog.objects_by_id]

    @staticmethod
    def _planetary_significator_ids(catalog: searchcatalog.SearchCatalog) -> list[str]:
        out: list[str] = []
        for oid in catalog.builtin_significator_ids:
            if oid == "planet:moon":
                continue
            obj = catalog.get(oid)
            if obj is None:
                continue
            if obj.family in (searchcatalog.SearchObject.FAMILY_PLANET, searchcatalog.SearchObject.FAMILY_NODE):
                out.append(oid)
        return out

    def _search_has_saved_state(self) -> bool:
        opts = chart_snapshot_service.options
        return bool(getattr(opts, "search_has_saved_state", False) or self._has_saved_search_state)

    def _persist_search_options(
        self,
        query: searchquery.SearchQuery,
        start_date: datetime.date,
        end_date: datetime.date,
        payload: dict[str, Any],
    ) -> None:
        opts = chart_snapshot_service.options
        opts.search_techniques = query.techniques[:]
        opts.search_aspects = query.aspects[:]
        opts.search_promittor_ids = query.promittor_ids[:]
        opts.search_significator_ids = query.significator_ids[:]
        opts.search_sign_changes = bool(query.include_sign_changes)
        opts.search_part_filter = str(payload.get("partFilter") or "")
        opts.search_from = (start_date.year, start_date.month, start_date.day)
        opts.search_to = (end_date.year, end_date.month, end_date.day)
        opts.search_has_saved_state = True
        self._has_saved_search_state = True
        self._mark_search_options_changed()

    @staticmethod
    def _mark_search_options_changed() -> None:
        opts = chart_snapshot_service.options
        try:
            opts.saveSearch()
        except Exception:
            pass

    @classmethod
    def _json_clean(cls, value: Any) -> Any:
        if isinstance(value, dict):
            return {str(k): cls._json_clean(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [cls._json_clean(v) for v in value]
        if isinstance(value, float):
            if not math.isfinite(value):
                return None
            return value
        return value


transit_search_service = TransitSearchService()
