# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Progressive daemon-owned evidence index for the Temporal Confluence map.

The map is a compact index over the existing canonical list builders.  It does
not manufacture display rows or astrology semantics.  Source adapters request
the same additive ``temporal`` blocks used by the canonical tables, retain only
that evidence, and feed exact same-planet intersections to
``temporal_correlation.resolve_concurrence``.

Coverage is deliberately split in two:

``evidenceCoverage``
    A source-owned interval that was completely searched for exact rows.

``concurrenceCoverage``
    An interval in which absence of a concurrence is authoritative.  Transit
    orb refinement is not placed here merely because exact hits inside a seed
    interval were expanded; a slow body's in-orb window may begin outside that
    seed interval.  Such useful positive evidence is reported under
    ``provisionalCoverage`` instead.  The UI can therefore draw the hit while
    never painting an unsearched interval as quiet.

Ephemeris-heavy work is chunked and runs through one process-wide worker.  A
new viewport request raises its chunks ahead of background lifetime indexing;
each chunk bounds cancellation latency even though the canonical synchronous
calculators themselves are not pre-emptible.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import datetime
import hashlib
import heapq
import json
import math
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Iterable, Optional

import astrology
import chart
import primdirs

from .temporal_correlation import resolve_concurrence


LIFE_YEARS = 120
TROPICAL_YEAR_DAYS = 365.2421904
MAX_LANES = 4
MAX_TILE_BINS = 1024
MAX_GROUP_PAGE = 2000
JOB_TTL_SECONDS = 15 * 60
GROUP_PARTITION_DAYS = 366.0
TRANSIT_CHUNK_DAYS = 183.0
SYNODIC_CHUNK_DAYS = TROPICAL_YEAR_DAYS

# A factor-four pyramid keeps one stable set of map resolutions from a life
# overview down to sub-day inspection.  Camera presets are frontend concerns;
# these are only evidence aggregation sizes.
LOD_LEVELS = (
    {"level": 0, "binDays": 256.0},
    {"level": 1, "binDays": 64.0},
    {"level": 2, "binDays": 16.0},
    {"level": 3, "binDays": 4.0},
    {"level": 4, "binDays": 1.0},
    {"level": 5, "binDays": 0.25},
    {"level": 6, "binDays": 0.0625},
)

TIME_LORD_SOURCES = {
    "zodiacal_releasing": "zodiacal_releasing",
    "firdaria": "firdaria",
    "decennials": "decennials",
    "triplicity_directions": "triplicity_directions",
    "profection_periods": "profections_table",
}
DIRECTION_SOURCES = {
    "primary_directions",
    "secondary_progressions",
    "minor_progressions",
    "tertiary_progressions",
    "circumambulation",
}
HEAVY_SOURCES = {"transits", "synodic_cycles"}
SUPPORTED_SOURCES = set(TIME_LORD_SOURCES) | DIRECTION_SOURCES | HEAVY_SOURCES


@dataclass(frozen=True, slots=True)
class _MapEvidence:
    """One canonical activation window in a memory-conscious form."""

    lane_id: str
    source_id: str
    row_id: str
    activation_id: str
    point_id: str
    planet_id: int
    role: str
    basis: str
    start: float
    end: float
    row_anchor: float | None = None
    color_role: str | None = None
    color_hex: str | None = None


@dataclass(order=True, slots=True)
class _MapTask:
    priority: int
    sequence: int
    key: str = field(compare=False)
    lane_id: str = field(compare=False)
    kind: str = field(compare=False)
    start: float | None = field(default=None, compare=False)
    end: float | None = field(default=None, compare=False)
    include_orb: bool = field(default=False, compare=False)


@dataclass(slots=True)
class _BuildResult:
    rows: list[dict[str, Any]] = field(default_factory=list)
    evidence_spans: list[tuple[float, float]] = field(default_factory=list)
    concurrence_spans: list[tuple[float, float]] = field(default_factory=list)
    provisional_spans: list[tuple[float, float]] = field(default_factory=list)
    truncated: bool = False
    unsupported_reason: str | None = None


@dataclass(slots=True)
class _LaneState:
    lane_id: str
    source_id: str
    spec: dict[str, Any]
    evidence: set[_MapEvidence] = field(default_factory=set)
    evidence_spans: list[tuple[float, float]] = field(default_factory=list)
    concurrence_spans: list[tuple[float, float]] = field(default_factory=list)
    provisional_spans: list[tuple[float, float]] = field(default_factory=list)
    active_tasks: int = 0
    queued_tasks: int = 0
    completed_tasks: int = 0
    truncated: bool = False
    error: str = ""
    unsupported_reason: str | None = None


class _TemporalMapJob:
    def __init__(
        self,
        *,
        token: str,
        generation: int,
        document_id: str,
        axis: dict[str, Any],
        context: dict[str, Any],
        lanes: list[_LaneState],
        minimum_lanes: int,
    ) -> None:
        self.token = token
        self.generation = generation
        self.document_id = document_id
        self.axis = dict(axis)
        self.context = context
        self.lanes = {lane.lane_id: lane for lane in lanes}
        self.lane_order = [lane.lane_id for lane in lanes]
        self.minimum_lanes = minimum_lanes
        self.created_at = time.monotonic()
        self.updated_at = self.created_at
        self.revision = 0
        self.cancelled = False
        self.running = False
        self.evidence_epoch = 0
        self._sequence = 0
        self._lock = threading.RLock()
        self._tasks: list[_MapTask] = []
        self._queued_keys: set[str] = set()
        self._active_keys: set[str] = set()
        self._finished_keys: set[str] = set()
        self._group_cache: dict[
            tuple[int, int],
            tuple[dict[str, Any], ...],
        ] = {}

    @property
    def horizon(self) -> tuple[float, float]:
        return (
            float(self.axis["birthJdUt"]),
            float(self.axis["lifeEndJdUt"]),
        )

    def bump(self) -> None:
        self.revision += 1
        self.updated_at = time.monotonic()

    def enqueue(
        self,
        *,
        lane_id: str,
        kind: str,
        priority: int,
        start: float | None = None,
        end: float | None = None,
        include_orb: bool = False,
    ) -> bool:
        start_key = "" if start is None else f"{float(start):.8f}"
        end_key = "" if end is None else f"{float(end):.8f}"
        key = f"{lane_id}|{kind}|{start_key}|{end_key}|{int(include_orb)}"
        with self._lock:
            if self.cancelled or key in self._active_keys or key in self._finished_keys:
                return False
            if key in self._queued_keys:
                for queued in self._tasks:
                    if queued.key != key:
                        continue
                    if int(priority) < queued.priority:
                        queued.priority = int(priority)
                        heapq.heapify(self._tasks)
                        self.bump()
                        return True
                    return False
                # Keep the key index self-healing if an interrupted mutation
                # ever left it out of step with the heap.
                self._queued_keys.discard(key)
            self._sequence += 1
            heapq.heappush(
                self._tasks,
                _MapTask(
                    int(priority),
                    self._sequence,
                    key,
                    lane_id,
                    kind,
                    start,
                    end,
                    include_orb,
                ),
            )
            self._queued_keys.add(key)
            self.lanes[lane_id].queued_tasks += 1
            self.bump()
            return True

    def pop_task(self) -> _MapTask | None:
        with self._lock:
            if self.cancelled or not self._tasks:
                self.running = False
                self.bump()
                return None
            task = heapq.heappop(self._tasks)
            self._queued_keys.discard(task.key)
            self._active_keys.add(task.key)
            lane = self.lanes[task.lane_id]
            lane.queued_tasks = max(0, lane.queued_tasks - 1)
            lane.active_tasks += 1
            self.running = True
            self.bump()
            return task

    def finish_task(self, task: _MapTask, result: _BuildResult | None, error: str = "") -> None:
        with self._lock:
            lane = self.lanes[task.lane_id]
            lane.active_tasks = max(0, lane.active_tasks - 1)
            lane.completed_tasks += 1
            self._active_keys.discard(task.key)
            self._finished_keys.add(task.key)
            if self.cancelled:
                self.bump()
                return
            if error:
                lane.error = str(error)
            elif result is not None:
                start, end = self.horizon
                incoming_evidence = _evidence_from_temporal_rows(
                    result.rows,
                    lane_id=lane.lane_id,
                    source_id=lane.source_id,
                    horizon_start=start,
                    horizon_end=end,
                )
                previous_evidence_count = len(lane.evidence)
                lane.evidence.update(incoming_evidence)
                if len(lane.evidence) != previous_evidence_count:
                    self.evidence_epoch += 1
                    self._group_cache.clear()
                lane.evidence_spans = _merge_spans(
                    lane.evidence_spans + _clip_spans(result.evidence_spans, start, end)
                )
                lane.concurrence_spans = _merge_spans(
                    lane.concurrence_spans + _clip_spans(result.concurrence_spans, start, end)
                )
                lane.provisional_spans = _merge_spans(
                    lane.provisional_spans + _clip_spans(result.provisional_spans, start, end)
                )
                lane.truncated = lane.truncated or bool(result.truncated)
                if result.unsupported_reason:
                    lane.unsupported_reason = str(result.unsupported_reason)
            self.bump()

    def cancel(self) -> None:
        with self._lock:
            self.cancelled = True
            for task in self._tasks:
                lane = self.lanes.get(task.lane_id)
                if lane is not None:
                    lane.queued_tasks = max(0, lane.queued_tasks - 1)
            self._tasks.clear()
            self._queued_keys.clear()
            self.bump()

    def query_snapshot(
        self,
        start: float,
        end: float,
    ) -> tuple[dict[str, list[_MapEvidence]], list[dict[str, Any]], int, int]:
        """Copy evidence and its completeness at one atomic revision."""
        with self._lock:
            evidence = {
                lane_id: list(self.lanes[lane_id].evidence)
                for lane_id in self.lane_order
            }
            coverage = [
                _lane_payload(self.lanes[lane_id], start, end)
                for lane_id in self.lane_order
            ]
            return evidence, coverage, int(self.revision), int(self.evidence_epoch)

    def cached_groups(
        self,
        *,
        evidence_epoch: int,
        minimum_lanes: int,
    ) -> tuple[dict[str, Any], ...] | None:
        with self._lock:
            return self._group_cache.get((int(evidence_epoch), int(minimum_lanes)))

    def install_group_cache(
        self,
        *,
        evidence_epoch: int,
        minimum_lanes: int,
        groups: list[dict[str, Any]],
    ) -> None:
        with self._lock:
            if self.evidence_epoch != int(evidence_epoch):
                return
            self._group_cache[(int(evidence_epoch), int(minimum_lanes))] = tuple(groups)

    def snapshot(self) -> dict[str, Any]:
        start, end = self.horizon
        with self._lock:
            lanes = [
                _lane_payload(self.lanes[lane_id], start, end)
                for lane_id in self.lane_order
            ]
            pending = sum(lane.queued_tasks + lane.active_tasks for lane in self.lanes.values())
            build_settled = pending == 0 and not self.running
            return {
                "token": self.token,
                "worldToken": self.token,
                "generation": self.generation,
                "revision": self.revision,
                "documentId": self.document_id,
                "minimumLanes": self.minimum_lanes,
                "horizon": {
                    "startJdUt": start,
                    "endJdUt": end,
                    "lifeYears": int(self.axis.get("lifeYears", LIFE_YEARS)),
                    "timeBasis": self.axis.get("timeBasis", "ut"),
                },
                "focusJdUt": float(self.axis.get("focusJdUt", start)),
                "calendar": self.axis.get("calendar", "gregorian"),
                "semanticKey": self.context.get("semantic_key"),
                "levels": [dict(level) for level in LOD_LEVELS],
                "lanes": lanes,
                "build": {
                    "running": bool(self.running),
                    "pendingTasks": pending,
                    "settled": build_settled,
                    "cancelled": bool(self.cancelled),
                },
                # Semantic completeness is deliberately independent from job
                # idleness.  A settled Transit lane can remain honestly partial
                # while its exact whole-life index is still useful.
                "complete": all(bool(lane["complete"]) for lane in lanes),
                "cancelled": bool(self.cancelled),
            }


def _span_payload(spans: Iterable[tuple[float, float]]) -> list[dict[str, float]]:
    return [
        {"startJdUt": float(start), "endJdUt": float(end)}
        for start, end in spans
    ]


def _lane_payload(lane: _LaneState, start: float, end: float) -> dict[str, Any]:
    evidence_complete = _spans_cover(lane.evidence_spans, start, end)
    concurrence_complete = _spans_cover(lane.concurrence_spans, start, end)
    if lane.error:
        status = "error"
    elif lane.unsupported_reason and not lane.evidence:
        status = "unsupported"
    elif lane.active_tasks:
        status = "building"
    elif lane.queued_tasks and not lane.evidence:
        status = "queued"
    elif concurrence_complete:
        status = "ready"
    elif lane.evidence or lane.completed_tasks:
        status = "partial"
    else:
        status = "unknown"
    return {
        "laneId": lane.lane_id,
        "sourceId": lane.source_id,
        "status": status,
        "complete": bool(concurrence_complete and not lane.truncated and not lane.error),
        "evidenceCount": len(lane.evidence),
        "truncated": bool(lane.truncated),
        "error": lane.error or None,
        "unsupportedReason": lane.unsupported_reason,
        "evidenceCoverage": {
            "spans": _span_payload(lane.evidence_spans),
            "complete": bool(evidence_complete and not lane.truncated),
            "authoritative": True,
        },
        "concurrenceCoverage": {
            "spans": _span_payload(lane.concurrence_spans),
            "complete": bool(concurrence_complete and not lane.truncated),
            "authoritative": True,
        },
        "provisionalCoverage": {
            "spans": _span_payload(lane.provisional_spans),
            "complete": False,
            "authoritative": False,
        },
    }


class TemporalMapService:
    """Own progressive lifetime evidence jobs and compact map queries."""

    _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="aries-temporal-map")

    def __init__(
        self,
        *,
        context_resolver: Callable[[str], dict[str, Any]] | None = None,
        adapter_overrides: dict[
            str,
            Callable[[dict[str, Any], dict[str, Any], _MapTask], Any],
        ] | None = None,
        executor: Any = None,
    ) -> None:
        self._context_resolver = context_resolver or self._default_context
        self._adapter_overrides = dict(adapter_overrides or {})
        self._worker = executor or self._executor
        self._lock = threading.RLock()
        self._jobs: dict[str, _TemporalMapJob] = {}
        self._owner_tokens: dict[str, str] = {}
        self._generation = 0

    def open_map(
        self,
        *,
        document_id: str,
        lanes: list[dict[str, Any]],
        minimum_lanes: int = 2,
        viewport_start_jd_ut: float | None = None,
        viewport_end_jd_ut: float | None = None,
    ) -> dict[str, Any]:
        document_id = str(document_id or "").strip()
        if not document_id:
            raise ValueError("documentId is required")
        minimum = int(minimum_lanes)
        if minimum < 2 or minimum > MAX_LANES:
            raise ValueError("minimumLanes must be between 2 and 4")
        normalized_lanes = self._normalize_lanes(lanes)
        context = self._context_resolver(document_id)
        axis = dict(context.get("axis") or {})
        try:
            horizon_start = float(axis["birthJdUt"])
            horizon_end = float(axis["lifeEndJdUt"])
        except (KeyError, TypeError, ValueError):
            raise ValueError("temporal map context has no finite lifetime horizon") from None
        if not math.isfinite(horizon_start) or not math.isfinite(horizon_end) or horizon_end <= horizon_start:
            raise ValueError("temporal map context has no finite lifetime horizon")

        with self._lock:
            self._cleanup_jobs_locked()
            previous_token = self._owner_tokens.get(document_id)
            if previous_token:
                previous = self._jobs.get(previous_token)
                if previous is not None:
                    previous.cancel()
            self._generation += 1
            token = uuid.uuid4().hex
            job = _TemporalMapJob(
                token=token,
                generation=self._generation,
                document_id=document_id,
                axis=axis,
                context=context,
                lanes=normalized_lanes,
                minimum_lanes=minimum,
            )
            self._jobs[token] = job
            self._owner_tokens[document_id] = token

        self._seed_tasks(
            job,
            viewport_start_jd_ut=viewport_start_jd_ut,
            viewport_end_jd_ut=viewport_end_jd_ut,
        )
        self._schedule(job)
        result = job.snapshot()
        result["groups"] = []
        result["initialTiles"] = {
            "startJdUt": horizon_start,
            "endJdUt": horizon_end,
            "binCount": 0,
            "bins": [],
            "complete": False,
        }
        return result

    def progress(self, token: str) -> dict[str, Any]:
        return self._job(token).snapshot()

    def cancel(self, token: str) -> dict[str, Any]:
        try:
            job = self._job(token)
        except ValueError:
            return {"cancelled": False}
        job.cancel()
        return {"cancelled": True, "token": job.token}

    def tiles(
        self,
        *,
        token: str,
        start_jd_ut: float,
        end_jd_ut: float,
        bin_count: int | None = None,
        level: int | None = None,
    ) -> dict[str, Any]:
        job = self._job(token)
        start, end = _bounded_query_span(job, start_jd_ut, end_jd_ut)
        self._prioritize_span(job, start, end)
        self._schedule(job)
        if bin_count is None:
            selected_level = max(0, min(len(LOD_LEVELS) - 1, int(level or 0)))
            bin_days = float(LOD_LEVELS[selected_level]["binDays"])
            bins_requested = int(math.ceil((end - start) / bin_days))
            bin_count = max(1, min(MAX_TILE_BINS, bins_requested))
        else:
            bin_count = max(1, min(MAX_TILE_BINS, int(bin_count)))
            selected_level = _nearest_level((end - start) / float(bin_count))

        evidence, coverage, revision, evidence_epoch = job.query_snapshot(start, end)
        width = (end - start) / float(bin_count)
        lane_bins: dict[str, list[dict[str, Any]]] = {}
        for lane_id in job.lane_order:
            accum: dict[int, dict[str, Any]] = {}
            for item in evidence.get(lane_id, ()):  # positive known evidence only
                overlap_start = max(start, item.start)
                overlap_end = min(end, item.end)
                if overlap_end <= overlap_start:
                    continue
                first = _bin_index(overlap_start, start, width, bin_count)
                last_probe = math.nextafter(overlap_end, -math.inf)
                last = _bin_index(last_probe, start, width, bin_count)
                for index in range(first, last + 1):
                    bucket = accum.setdefault(index, {"count": 0, "planets": set()})
                    bucket["count"] += 1
                    bucket["planets"].add(item.planet_id)
            lane_bins[lane_id] = [
                {
                    "index": index,
                    "count": int(payload["count"]),
                    "planetIds": sorted(int(value) for value in payload["planets"]),
                }
                for index, payload in sorted(accum.items())
            ]

        groups = self._canonical_groups_for_snapshot(
            job,
            evidence,
            evidence_epoch=evidence_epoch,
            minimum_lanes=job.minimum_lanes,
        )
        groups = _project_groups_to_span(groups, start, end)
        concurrence_bins: dict[int, dict[str, Any]] = {}
        for group in groups:
            overlap_start = max(start, float(group["startJdUt"]))
            overlap_end = min(end, float(group["endJdUt"]))
            if overlap_end <= overlap_start:
                continue
            first = _bin_index(overlap_start, start, width, bin_count)
            last = _bin_index(math.nextafter(overlap_end, -math.inf), start, width, bin_count)
            lane_mask = 0
            for participant in group.get("participants", ()):
                try:
                    lane_mask |= 1 << job.lane_order.index(str(participant.get("laneId")))
                except (ValueError, AttributeError):
                    continue
            for index in range(first, last + 1):
                bucket = concurrence_bins.setdefault(
                    index,
                    {
                        "groupCount": 0,
                        "maxLaneCount": 0,
                        "laneMask": 0,
                        "planets": set(),
                        "planetSummaries": {},
                    },
                )
                bucket["groupCount"] += 1
                bucket["maxLaneCount"] = max(bucket["maxLaneCount"], int(group["laneCount"]))
                bucket["laneMask"] |= lane_mask
                planet_id = int(group["planetId"])
                bucket["planets"].add(planet_id)
                planet_summary = bucket["planetSummaries"].setdefault(
                    (planet_id, lane_mask),
                    {"groupCount": 0, "maxLaneCount": 0, "laneMask": 0},
                )
                planet_summary["groupCount"] += 1
                planet_summary["maxLaneCount"] = max(
                    planet_summary["maxLaneCount"],
                    int(group["laneCount"]),
                )
                planet_summary["laneMask"] |= lane_mask

        complete = all(bool(lane["complete"]) for lane in coverage)
        return {
            "token": job.token,
            "generation": job.generation,
            "revision": revision,
            "startJdUt": start,
            "endJdUt": end,
            "level": selected_level,
            "binCount": bin_count,
            "binDays": width,
            "lanes": [
                {"laneId": lane_id, "bins": lane_bins[lane_id]}
                for lane_id in job.lane_order
            ],
            "bins": [
                {
                    "index": index,
                    "startJdUt": start + index * width,
                    "endJdUt": min(end, start + (index + 1) * width),
                    "groupCount": int(payload["groupCount"]),
                    "maxLaneCount": int(payload["maxLaneCount"]),
                    "laneMask": int(payload["laneMask"]),
                    "planetIds": sorted(int(value) for value in payload["planets"]),
                    "planetSummaries": [
                        {
                            "planetId": int(planet_id),
                            "laneMask": int(summary["laneMask"]),
                            "groupCount": int(summary["groupCount"]),
                            "maxLaneCount": int(summary["maxLaneCount"]),
                        }
                        for (planet_id, _summary_mask), summary in sorted(
                            payload["planetSummaries"].items()
                        )
                    ],
                }
                for index, payload in sorted(concurrence_bins.items())
            ],
            "coverage": coverage,
            "complete": complete,
        }

    def groups(
        self,
        *,
        token: str,
        start_jd_ut: float,
        end_jd_ut: float,
        minimum_lanes: int | None = None,
        offset: int = 0,
        limit: int = 500,
    ) -> dict[str, Any]:
        job = self._job(token)
        start, end = _bounded_query_span(job, start_jd_ut, end_jd_ut)
        minimum = job.minimum_lanes if minimum_lanes is None else int(minimum_lanes)
        if minimum < 2 or minimum > MAX_LANES:
            raise ValueError("minimumLanes must be between 2 and 4")
        self._prioritize_span(job, start, end)
        self._schedule(job)
        evidence, coverage, revision, evidence_epoch = job.query_snapshot(start, end)
        groups = self._canonical_groups_for_snapshot(
            job,
            evidence,
            evidence_epoch=evidence_epoch,
            minimum_lanes=minimum,
        )
        groups = _project_groups_to_span(groups, start, end)
        page_offset = max(0, int(offset))
        page_limit = max(1, min(MAX_GROUP_PAGE, int(limit)))
        page = groups[page_offset : page_offset + page_limit]
        next_offset = page_offset + len(page)
        complete = all(bool(lane["complete"]) for lane in coverage)
        return {
            "token": job.token,
            "generation": job.generation,
            "revision": revision,
            "startJdUt": start,
            "endJdUt": end,
            "minimumLanes": minimum,
            "groups": page,
            "total": len(groups),
            "offset": page_offset,
            "nextOffset": next_offset if next_offset < len(groups) else None,
            "coverage": coverage,
            "complete": complete,
        }

    @staticmethod
    def _canonical_groups_for_snapshot(
        job: _TemporalMapJob,
        evidence: dict[str, list[_MapEvidence]],
        *,
        evidence_epoch: int,
        minimum_lanes: int,
    ) -> list[dict[str, Any]]:
        cached = job.cached_groups(
            evidence_epoch=evidence_epoch,
            minimum_lanes=minimum_lanes,
        )
        if cached is not None:
            return list(cached)
        horizon_start, horizon_end = job.horizon
        groups = _resolve_groups_for_span(
            evidence,
            job.lane_order,
            horizon_start,
            horizon_end,
            minimum_lanes=minimum_lanes,
        )
        job.install_group_cache(
            evidence_epoch=evidence_epoch,
            minimum_lanes=minimum_lanes,
            groups=groups,
        )
        return groups

    def _job(self, token: str) -> _TemporalMapJob:
        with self._lock:
            self._cleanup_jobs_locked()
            job = self._jobs.get(str(token or ""))
        if job is None:
            raise ValueError("unknown temporal map token")
        return job

    def _cleanup_jobs_locked(self) -> None:
        cutoff = time.monotonic() - JOB_TTL_SECONDS
        expired = [
            token
            for token, job in self._jobs.items()
            if job.updated_at < cutoff
        ]
        for token in expired:
            job = self._jobs.pop(token)
            job.cancel()
            if self._owner_tokens.get(job.document_id) == token:
                self._owner_tokens.pop(job.document_id, None)

    def _normalize_lanes(self, lanes: list[dict[str, Any]]) -> list[_LaneState]:
        if not isinstance(lanes, list) or not 1 <= len(lanes) <= MAX_LANES:
            raise ValueError("temporal map requires between 1 and 4 lanes")
        normalized: list[_LaneState] = []
        seen: set[str] = set()
        for raw in lanes:
            if not isinstance(raw, dict):
                raise ValueError("temporal map lanes must be objects")
            lane_id = str(raw.get("laneId") or "").strip()
            source_id = str(raw.get("sourceId") or "").strip()
            if not lane_id or lane_id in seen:
                raise ValueError("laneId values must be non-empty and distinct")
            if source_id not in SUPPORTED_SOURCES and source_id not in self._adapter_overrides:
                raise ValueError(f"unsupported temporal map source {source_id!r}")
            seen.add(lane_id)
            spec = raw.get("spec")
            normalized.append(
                _LaneState(
                    lane_id=lane_id,
                    source_id=source_id,
                    spec=dict(spec) if isinstance(spec, dict) else {},
                )
            )
        return normalized

    @staticmethod
    def _default_context(document_id: str) -> dict[str, Any]:
        # Import lazily: workspace_service owns session truth and imports many
        # list services itself during startup.
        from .workspace_service import workspace_service

        axis = workspace_service.temporal_map_context(document_id)
        search_context = workspace_service.search_context_for_document(document_id)
        return {
            "axis": axis,
            "chart": search_context["chart"],
            "custom_points": list(search_context.get("custom_points") or []),
            "semantic_key": _retained_semantic_key(),
        }

    def _seed_tasks(
        self,
        job: _TemporalMapJob,
        *,
        viewport_start_jd_ut: float | None,
        viewport_end_jd_ut: float | None,
    ) -> None:
        horizon_start, horizon_end = job.horizon
        focus = float(job.axis.get("focusJdUt", horizon_start))
        priority_start = max(horizon_start, focus - TROPICAL_YEAR_DAYS / 2.0)
        priority_end = min(horizon_end, focus + TROPICAL_YEAR_DAYS / 2.0)
        try:
            requested_start = float(viewport_start_jd_ut)
            requested_end = float(viewport_end_jd_ut)
        except (TypeError, ValueError):
            requested_start = requested_end = math.nan
        if (
            math.isfinite(requested_start)
            and math.isfinite(requested_end)
            and requested_end > requested_start
            and requested_end - requested_start <= 5.0 * TROPICAL_YEAR_DAYS
        ):
            priority_start = max(horizon_start, requested_start)
            priority_end = min(horizon_end, requested_end)

        for lane_id in job.lane_order:
            lane = job.lanes[lane_id]
            if lane.source_id in HEAVY_SOURCES:
                self._enqueue_span_tasks(
                    job,
                    lane,
                    priority_start,
                    priority_end,
                    priority=1,
                    include_orb=(lane.source_id == "transits" and _transit_orbs_enabled(lane.spec)),
                )
                chunk_days = _heavy_chunk_days(lane)
                for chunk_start, chunk_end in _ordered_chunks(
                    horizon_start,
                    horizon_end,
                    chunk_days,
                    focus,
                ):
                    job.enqueue(
                        lane_id=lane_id,
                        kind="heavy",
                        priority=10,
                        start=chunk_start,
                        end=chunk_end,
                        # Whole-life Transit indexing eventually retains every
                        # configured positive orb window.  These spans stay
                        # provisional (never an absence guarantee), but the
                        # Life map must not depend on a viewport having visited
                        # the event first.
                        include_orb=(
                            lane.source_id == "transits"
                            and _transit_orbs_enabled(lane.spec)
                        ),
                    )
            else:
                job.enqueue(lane_id=lane_id, kind="whole-life", priority=0)

    def _prioritize_span(self, job: _TemporalMapJob, start: float, end: float) -> None:
        if end - start > 5.0 * TROPICAL_YEAR_DAYS:
            horizon_start, horizon_end = job.horizon
            focus = min(
                horizon_end,
                max(horizon_start, float(job.axis.get("focusJdUt", horizon_start))),
            )
            half_span = 2.5 * TROPICAL_YEAR_DAYS
            start = max(horizon_start, focus - half_span)
            end = min(horizon_end, focus + half_span)
        for lane_id in job.lane_order:
            lane = job.lanes[lane_id]
            if lane.source_id not in HEAVY_SOURCES:
                continue
            self._enqueue_span_tasks(
                job,
                lane,
                start,
                end,
                priority=1,
                include_orb=(lane.source_id == "transits" and _transit_orbs_enabled(lane.spec)),
            )

    def _enqueue_span_tasks(
        self,
        job: _TemporalMapJob,
        lane: _LaneState,
        start: float,
        end: float,
        *,
        priority: int,
        include_orb: bool,
    ) -> None:
        horizon_start, horizon_end = job.horizon
        start = max(horizon_start, float(start))
        end = min(horizon_end, float(end))
        if end <= start:
            return
        chunk_days = _heavy_chunk_days(lane)
        # Use one horizon-anchored chunk grid for foreground and background
        # work.  A later viewport can then promote its already queued lifetime
        # chunks instead of calculating an overlapping second set.
        chunk_index = max(0, int(math.floor((start - horizon_start) / chunk_days)))
        cursor = horizon_start + chunk_index * chunk_days
        while cursor < end - 1e-9:
            task_end = min(horizon_end, cursor + chunk_days)
            if task_end <= start + 1e-9:
                cursor = task_end
                continue
            job.enqueue(
                lane_id=lane.lane_id,
                kind="heavy",
                priority=priority,
                start=cursor,
                end=task_end,
                include_orb=include_orb,
            )
            cursor = task_end

    def _schedule(self, job: _TemporalMapJob) -> None:
        with job._lock:
            if job.cancelled or job.running or not job._tasks:
                return
            job.running = True
            job.bump()
        self._worker.submit(self._run_job, job)

    def _run_job(self, job: _TemporalMapJob) -> None:
        if job.cancelled:
            with job._lock:
                job.running = False
                job.bump()
            return
        expected_key = job.context.get("semantic_key")
        if expected_key and _retained_semantic_key() != expected_key:
            # Never merge chunks calculated under two option worlds.  The
            # frontend's retained-data generation opens a replacement map;
            # this old token remains readable but explicitly cancelled.
            job.cancel()
            with job._lock:
                job.running = False
                job.bump()
            return
        task = job.pop_task()
        if task is None:
            return
        result: _BuildResult | None = None
        error = ""
        try:
            result = self._execute_task(job, task)
        except Exception as exc:  # one source must not destroy the map world
            error = str(exc)
        job.finish_task(task, result, error)
        with job._lock:
            job.running = False
            job.bump()
        # Yield between bounded chunks.  With the one-worker executor this
        # lets a newly opened map or a newly prioritized viewport enter before
        # another document's entire lifetime backlog.
        self._schedule(job)

    def _execute_task(self, job: _TemporalMapJob, task: _MapTask) -> _BuildResult:
        lane = job.lanes[task.lane_id]
        override = self._adapter_overrides.get(lane.source_id)
        if override is not None:
            raw = override(job.context, lane.spec, task)
            return _coerce_build_result(raw)
        if lane.source_id in TIME_LORD_SOURCES:
            return self._build_time_lord(job, lane)
        if lane.source_id == "primary_directions":
            return self._build_primary_directions(job, lane)
        if lane.source_id in {
            "secondary_progressions",
            "minor_progressions",
            "tertiary_progressions",
        }:
            return self._build_secondary_directions(job, lane)
        if lane.source_id == "circumambulation":
            return self._build_circumambulation(job, lane)
        if lane.source_id == "transits":
            return self._build_transits(job, lane, task)
        if lane.source_id == "synodic_cycles":
            return self._build_synodic(job, lane, task)
        raise ValueError(f"unsupported temporal map source {lane.source_id!r}")

    @staticmethod
    def _build_time_lord(job: _TemporalMapJob, lane: _LaneState) -> _BuildResult:
        from .tables_service import tables_service
        from .workspace_service import workspace_service

        table_id = TIME_LORD_SOURCES[lane.source_id]
        context = workspace_service.table_context(
            job.document_id,
            requested_table_id=table_id,
        )
        binding = dict(context.get("binding") or {})
        if isinstance(lane.spec.get("binding"), dict):
            # The mounted canonical table reported this exact semantic lens.
            # Treat it as a snapshot, not a patch over a potentially newer or
            # disclosure-only session binding.
            binding = dict(lane.spec["binding"])

        def build_payload(active_binding: dict[str, Any]) -> dict[str, Any]:
            return tables_service.payload_for_chart(
                table_id,
                context["chart"],
                binding=active_binding,
                current_datetime=context.get("current_datetime"),
                chart_anchor_datetime=context.get("chart_anchor_datetime"),
                include_temporal=True,
            )

        payloads: list[tuple[int | None, dict[str, Any]]]
        if table_id == "profections_table":
            life_years = max(1, int(math.ceil(float(job.axis.get("lifeYears", LIFE_YEARS)))))
            payloads = []
            for age_offset in range(0, life_years, 12):
                page_binding = dict(binding)
                page_binding["age_offset"] = age_offset
                payloads.append((age_offset, build_payload(page_binding)))
        else:
            payloads = [(None, build_payload(binding))]
        payload = payloads[-1][1]
        if table_id == "zodiacal_releasing":
            # ZR's canonical table intentionally materializes L3/L4 only for
            # unfolded L2 branches.  The map is a source index, not a mirror of
            # today's disclosure state, so ask that same builder to unfold all
            # of its real L2 branches.  No row or ruler logic is duplicated.
            l2_starts = [
                str(meta.get("periodStart"))
                for row in payload.get("rows", ())
                if isinstance(row, dict)
                and isinstance((meta := row.get("meta")), dict)
                and int(meta.get("level", 0) or 0) == 2
                and meta.get("periodStart")
            ]
            if l2_starts:
                expanded_binding = dict(binding)
                expanded_binding["expanded_l2_starts"] = list(dict.fromkeys(l2_starts))
                payload = tables_service.payload_for_chart(
                    table_id,
                    context["chart"],
                    binding=expanded_binding,
                    current_datetime=context.get("current_datetime"),
                    chart_anchor_datetime=context.get("chart_anchor_datetime"),
                    include_temporal=True,
                )
                payloads = [(None, payload)]
        source_rows = [
            row
            for _age_offset, page_payload in payloads
            for row in list(page_payload.get("rows") or [])
        ]
        rows: list[dict[str, Any]] = []
        for age_offset, page_payload in payloads:
            page_rows = _temporal_rows(page_payload.get("rows") or [])
            if age_offset is not None:
                page_rows = _namespace_temporal_rows(
                    page_rows,
                    prefix=f"profections-age:{age_offset}",
                )
            rows.extend(page_rows)
        spans = _coverage_from_temporal_rows(rows)
        hierarchy = (
            payload.get("capabilities", {}).get("triplicityDirections", {})
            if isinstance(payload.get("capabilities"), dict)
            else {}
        )
        try:
            fully_materialized = int(hierarchy.get("rowCount")) >= int(
                hierarchy.get("totalRowCount")
            )
        except (TypeError, ValueError):
            fully_materialized = True
        unsupported = None
        if not spans:
            unsupported = _first_unsupported_reason(source_rows)
        return _BuildResult(
            rows=rows,
            evidence_spans=spans,
            concurrence_spans=spans if fully_materialized else [],
            provisional_spans=spans if not fully_materialized else [],
            unsupported_reason=unsupported,
        )

    @staticmethod
    def _build_primary_directions(job: _TemporalMapJob, lane: _LaneState) -> _BuildResult:
        from .directions_service import directions_service

        if str(lane.spec.get("mode") or "radix").strip().lower() != "radix":
            return _BuildResult(
                unsupported_reason="primary-directions-non-radix-mode",
            )
        direction = _primary_direction_mode(lane.spec.get("direction"))
        payload = directions_service.primary_directions(
            document_id=job.document_id,
            range_mode=primdirs.PrimDirs.RANGEALL,
            direction=direction,
            include_temporal=True,
        )
        rows = _temporal_rows(payload.get("directions") or [])
        coverage = _coverage_from_meta(payload.get("meta"))
        return _BuildResult(
            rows=rows,
            evidence_spans=coverage,
            concurrence_spans=coverage,
        )

    @staticmethod
    def _build_secondary_directions(job: _TemporalMapJob, lane: _LaneState) -> _BuildResult:
        from .directions_service import secondary_directions_service

        default_method = {
            "secondary_progressions": "secondary",
            "minor_progressions": "minor",
            "tertiary_progressions": "tertiary",
        }[lane.source_id]
        requested_method = str(lane.spec.get("method") or "").strip().lower()
        method = (
            requested_method
            if requested_method in {"secondary", "minor", "tertiary"}
            else default_method
        )
        direction = str(lane.spec.get("direction") or "direct").strip().lower()
        if direction not in {"direct", "converse", "both"}:
            direction = "direct"
        payload = secondary_directions_service.secondary_directions(
            document_id=job.document_id,
            start_age=0.0,
            end_age=float(job.axis.get("lifeYears", LIFE_YEARS)),
            method=method,
            direction=direction,
            include_temporal=True,
        )
        raw_rows = list(payload.get("directions") or [])
        if bool(lane.spec.get("stationsOnly", False)):
            raw_rows = [
                row
                for row in raw_rows
                if isinstance(row, dict) and row.get("isStation") is True
            ]
        rows = _temporal_rows(raw_rows)
        coverage = _coverage_from_meta(payload.get("meta"), authoritative_only=True)
        truncated = bool(payload.get("meta", {}).get("truncated", False))
        return _BuildResult(
            rows=rows,
            evidence_spans=coverage,
            concurrence_spans=coverage if not truncated else [],
            provisional_spans=coverage if truncated else [],
            truncated=truncated,
        )

    @staticmethod
    def _build_circumambulation(job: _TemporalMapJob, lane: _LaneState) -> _BuildResult:
        from .directions_service import circumambulation_service

        mode = str(lane.spec.get("mode") or "radix").strip().lower()
        if mode != "radix":
            return _BuildResult(
                unsupported_reason="circumambulation-non-radix-mode",
            )
        custom_significator = lane.spec.get("customSignificator")
        payload = circumambulation_service.circumambulations(
            document_id=job.document_id,
            use_exact_oa=bool(lane.spec.get("useExactOa", False)),
            max_age=int(job.axis.get("lifeYears", LIFE_YEARS)),
            mode=mode,
            custom_significator=(
                dict(custom_significator)
                if isinstance(custom_significator, dict)
                else None
            ),
            include_temporal=True,
        )
        rows, participants_complete = _circum_temporal_rows(
            payload.get("directions") or []
        )
        coverage = _coverage_from_meta(payload.get("meta"))
        return _BuildResult(
            rows=rows,
            evidence_spans=coverage,
            concurrence_spans=coverage if participants_complete else [],
            provisional_spans=coverage if not participants_complete else [],
        )

    @staticmethod
    def _build_transits(job: _TemporalMapJob, lane: _LaneState, task: _MapTask) -> _BuildResult:
        from .search_service import transit_search_service

        if task.start is None or task.end is None:
            raise ValueError("Transit map task has no JD span")
        chrt = job.context["chart"]
        from_date, to_date = _jd_query_dates(chrt, task.start, task.end)
        catalog_payload = transit_search_service.catalog(
            chrt,
            custom_points=job.context.get("custom_points"),
        )
        presets = catalog_payload.get("presets") or {}
        defaults = catalog_payload.get("defaults") or {}
        promittors = _spec_ids(
            lane.spec.get("promittorIds"),
            (presets.get("promittors") or {}).get("standard"),
            defaults.get("promittorIds"),
        )
        significators = _spec_ids(
            lane.spec.get("significatorIds"),
            (presets.get("significators") or {}).get("standard"),
            defaults.get("significatorIds"),
        )
        aspects = _spec_ids(
            lane.spec.get("aspects"),
            (presets.get("aspects") or {}).get("major"),
            ("conjunction", "sextile", "square", "trine", "opposition"),
        )
        direction = str(lane.spec.get("direction") or "direct").strip().lower()
        techniques = {
            "converse": ["converse_transits"],
            "both": ["transits", "converse_transits"],
        }.get(direction, ["transits"])
        include_orb = bool(task.include_orb and _transit_orbs_enabled(lane.spec))
        payload = transit_search_service.search(
            chrt,
            {
                "fromDate": from_date,
                "toDate": to_date,
                "techniques": techniques,
                "promittorIds": promittors,
                "significatorIds": significators,
                "aspects": aspects,
                "includeSignChanges": False,
                "includeTemporal": True,
                "includeOrbTemporal": include_orb,
                "partFilter": "",
                "limit": int(defaults.get("limit") or 500),
                "persistSettings": False,
            },
            custom_points=job.context.get("custom_points"),
            persist=False,
        )
        rows = _temporal_rows(payload.get("rows") or [])
        authoritative = not bool(payload.get("truncated", False))
        span = [(float(task.start), float(task.end))] if authoritative else []
        no_orb_semantics = not _transit_orbs_enabled(lane.spec)
        return _BuildResult(
            rows=rows,
            evidence_spans=span,
            concurrence_spans=span if no_orb_semantics else [],
            # Orb windows are valid positive evidence, but this seed scan is
            # not an absence guarantee near its boundaries.
            provisional_spans=span if include_orb else [],
            truncated=not authoritative,
        )

    @staticmethod
    def _build_synodic(job: _TemporalMapJob, lane: _LaneState, task: _MapTask) -> _BuildResult:
        from .synodic_service import synodic_service

        if task.start is None or task.end is None:
            raise ValueError("Synodic map task has no JD span")
        chrt = job.context["chart"]
        from_date, to_date = _jd_query_dates(chrt, task.start, task.end)
        context = {
            "chart": chrt,
            "current_datetime": datetime.datetime(
                int(getattr(chrt.time, "year", chrt.time.origyear)),
                int(getattr(chrt.time, "month", chrt.time.origmonth)),
                int(getattr(chrt.time, "day", chrt.time.origday)),
            ),
        }
        planet_ids = lane.spec.get("planetIds")
        if isinstance(planet_ids, (list, tuple, set)):
            planet_ids = ",".join(str(value) for value in planet_ids)
        payload = synodic_service.payload_for_context(
            context,
            from_date=from_date,
            to_date=to_date,
            planet_ids=str(planet_ids) if planet_ids else None,
            include_stations=bool(lane.spec.get("includeStations", True)),
            include_cazimis=bool(lane.spec.get("includeCazimis", True)),
            include_ingresses=bool(lane.spec.get("includeIngresses", True)),
            include_temporal=True,
        )
        rows = _temporal_rows(
            _filter_synodic_rows(payload.get("rows") or [], lane.spec)
        )
        span = [(float(task.start), float(task.end))]
        return _BuildResult(
            rows=rows,
            evidence_spans=span,
            concurrence_spans=span,
        )


def _coerce_build_result(raw: Any) -> _BuildResult:
    if isinstance(raw, _BuildResult):
        return raw
    if not isinstance(raw, dict):
        raise ValueError("temporal map adapter returned no build result")
    return _BuildResult(
        rows=list(raw.get("rows") or []),
        evidence_spans=_coerce_spans(raw.get("evidenceSpans") or raw.get("evidence_spans")),
        concurrence_spans=_coerce_spans(
            raw.get("concurrenceSpans") or raw.get("concurrence_spans")
        ),
        provisional_spans=_coerce_spans(
            raw.get("provisionalSpans") or raw.get("provisional_spans")
        ),
        truncated=bool(raw.get("truncated", False)),
        unsupported_reason=(
            str(raw.get("unsupportedReason") or raw.get("unsupported_reason"))
            if raw.get("unsupportedReason") or raw.get("unsupported_reason")
            else None
        ),
    )


def _coerce_spans(raw: Any) -> list[tuple[float, float]]:
    spans: list[tuple[float, float]] = []
    for item in list(raw or []):
        if isinstance(item, dict):
            values = (item.get("startJdUt"), item.get("endJdUt"))
        else:
            try:
                values = tuple(item)[:2]
            except TypeError:
                continue
        try:
            start, end = float(values[0]), float(values[1])
        except (IndexError, TypeError, ValueError):
            continue
        if math.isfinite(start) and math.isfinite(end) and end > start:
            spans.append((start, end))
    return spans


def _temporal_rows(rows: Iterable[Any]) -> list[dict[str, Any]]:
    return [
        dict(temporal)
        for row in rows
        if isinstance(row, dict)
        and isinstance((temporal := row.get("temporal")), dict)
    ]


def _namespace_temporal_rows(
    rows: Iterable[dict[str, Any]],
    *,
    prefix: str,
) -> list[dict[str, Any]]:
    """Give canonical page-local rows stable lifetime-map identities."""

    namespaced: list[dict[str, Any]] = []
    for raw in rows:
        row = dict(raw)
        row_id = str(row.get("rowId") or "")
        row["rowId"] = f"{prefix}:{row_id}"
        activations: list[dict[str, Any]] = []
        for raw_activation in list(row.get("activations") or []):
            if not isinstance(raw_activation, dict):
                continue
            activation = dict(raw_activation)
            activation_id = str(activation.get("activationId") or "")
            activation["activationId"] = f"{prefix}:{activation_id}"
            activations.append(activation)
        row["activations"] = activations
        namespaced.append(row)
    return namespaced


def _circum_temporal_rows(
    rows: Iterable[Any],
) -> tuple[list[dict[str, Any]], bool]:
    """Collect both term and canonical nested participating evidence."""

    source_rows = list(rows)
    temporal_rows = _temporal_rows(source_rows)
    participants_complete = True
    for row in source_rows:
        if not isinstance(row, dict):
            continue
        for participant in list(row.get("participating") or []):
            if not isinstance(participant, dict):
                participants_complete = False
                continue
            temporal = participant.get("temporal")
            if not isinstance(temporal, dict):
                participants_complete = False
                continue
            temporal_rows.append(dict(temporal))
    return temporal_rows, participants_complete


def _filter_synodic_rows(
    rows: Iterable[Any],
    spec: dict[str, Any],
) -> list[dict[str, Any]]:
    canonical_filter_ids: set[str] | None = None
    if "filterIds" in spec:
        raw_filter_ids = spec.get("filterIds")
        values = (
            raw_filter_ids
            if isinstance(raw_filter_ids, (list, tuple, set))
            else []
        )
        canonical_filter_ids = {str(value) for value in values}
    gates: dict[str, set[str]] = {}
    for spec_key, filter_group in (
        ("ingressPlanetIds", "ingress"),
        ("synodicPlanetIds", "synodic"),
        ("lunarCycleIds", "lunar"),
    ):
        if spec_key not in spec:
            continue
        raw_values = spec.get(spec_key)
        values = raw_values if isinstance(raw_values, (list, tuple, set)) else []
        gates[filter_group] = {str(value) for value in values}

    filtered: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        filter_group = str(row.get("filterGroup") or "")
        filter_key = f"{filter_group}:{row.get('filterId')}"
        if canonical_filter_ids is not None and filter_key not in canonical_filter_ids:
            continue
        allowed = gates.get(filter_group)
        if allowed is not None and str(row.get("filterId")) not in allowed:
            continue
        filtered.append(row)
    return filtered


def _first_unsupported_reason(rows: Iterable[Any]) -> str | None:
    for row in rows:
        if not isinstance(row, dict):
            continue
        temporal = row.get("temporal")
        if isinstance(temporal, dict) and temporal.get("unsupportedReason"):
            return str(temporal["unsupportedReason"])
    return None


def _coverage_from_temporal_rows(rows: Iterable[dict[str, Any]]) -> list[tuple[float, float]]:
    spans: list[tuple[float, float]] = []
    for row in rows:
        for activation in list(row.get("activations") or []):
            if not isinstance(activation, dict):
                continue
            for window in list(activation.get("windows") or []):
                if not isinstance(window, dict):
                    continue
                try:
                    start = float(window.get("startJdUt"))
                    end = float(window.get("endJdUt"))
                except (TypeError, ValueError):
                    continue
                if math.isfinite(start) and math.isfinite(end) and end > start:
                    spans.append((start, end))
    return _merge_spans(spans)


def _coverage_from_meta(meta: Any, *, authoritative_only: bool = True) -> list[tuple[float, float]]:
    if not isinstance(meta, dict):
        return []
    coverage = meta.get("temporalCoverage")
    if not isinstance(coverage, dict):
        return []
    if authoritative_only and not bool(coverage.get("authoritative", True)):
        return []
    try:
        start = float(coverage.get("startJdUt"))
        end = float(coverage.get("endJdUt"))
    except (TypeError, ValueError):
        return []
    return [(start, end)] if math.isfinite(start) and math.isfinite(end) and end > start else []


def _evidence_from_temporal_rows(
    rows: Iterable[dict[str, Any]],
    *,
    lane_id: str,
    source_id: str,
    horizon_start: float,
    horizon_end: float,
) -> set[_MapEvidence]:
    evidence: set[_MapEvidence] = set()
    for row in rows:
        row_id = str(row.get("rowId") or "").strip()
        if not row_id:
            continue
        try:
            row_anchor = float(row.get("rowAnchorJdUt"))
        except (TypeError, ValueError):
            row_anchor = None
        if row_anchor is not None and not math.isfinite(row_anchor):
            row_anchor = None
        for activation in list(row.get("activations") or []):
            if not isinstance(activation, dict):
                continue
            try:
                planet_id = int(activation.get("planetId"))
            except (TypeError, ValueError):
                continue
            activation_id = str(activation.get("activationId") or "").strip()
            point_id = str(activation.get("pointId") or "").strip()
            role = str(activation.get("role") or "").strip()
            basis = str(activation.get("basis") or "").strip()
            if not activation_id or not point_id or not role or not basis:
                continue
            for window in list(activation.get("windows") or []):
                if not isinstance(window, dict):
                    continue
                try:
                    start = float(window.get("startJdUt"))
                    end = float(window.get("endJdUt"))
                except (TypeError, ValueError):
                    continue
                if (
                    not math.isfinite(start)
                    or not math.isfinite(end)
                    or end <= start
                    or end <= horizon_start
                    or start >= horizon_end
                ):
                    continue
                evidence.add(
                    _MapEvidence(
                        lane_id=lane_id,
                        source_id=source_id,
                        row_id=row_id,
                        activation_id=activation_id,
                        point_id=point_id,
                        planet_id=planet_id,
                        role=role,
                        basis=basis,
                        start=start,
                        end=end,
                        row_anchor=row_anchor,
                        color_role=str(activation.get("colorRole") or "") or None,
                        color_hex=str(activation.get("colorHex") or "") or None,
                    )
                )
    return evidence


def _resolve_groups_for_span(
    evidence_by_lane: dict[str, list[_MapEvidence]],
    lane_order: list[str],
    start: float,
    end: float,
    *,
    minimum_lanes: int,
) -> list[dict[str, Any]]:
    partition_count = max(1, int(math.ceil((end - start) / GROUP_PARTITION_DAYS)))
    partitioned: list[dict[str, list[_MapEvidence]]] = [
        {lane_id: [] for lane_id in lane_order}
        for _index in range(partition_count)
    ]
    for lane_id in lane_order:
        for item in evidence_by_lane.get(lane_id, ()):
            overlap_start = max(start, item.start)
            overlap_end = min(end, item.end)
            if overlap_end <= overlap_start:
                continue
            first = max(
                0,
                min(
                    partition_count - 1,
                    int(math.floor((overlap_start - start) / GROUP_PARTITION_DAYS)),
                ),
            )
            last = max(
                0,
                min(
                    partition_count - 1,
                    int(
                        math.floor(
                            (math.nextafter(overlap_end, -math.inf) - start)
                            / GROUP_PARTITION_DAYS
                        )
                    ),
                ),
            )
            for partition_index in range(first, last + 1):
                partitioned[partition_index][lane_id].append(item)

    groups: list[dict[str, Any]] = []
    for partition_index, partition in enumerate(partitioned):
        cursor = start + partition_index * GROUP_PARTITION_DAYS
        chunk_end = min(end, cursor + GROUP_PARTITION_DAYS)
        lanes = [
            _resolver_lane_payload(
                lane_id,
                partition.get(lane_id, ()),
                clip_start=cursor,
                clip_end=chunk_end,
            )
            for lane_id in lane_order
        ]
        resolved = resolve_concurrence(lanes, minimum_lanes=minimum_lanes)
        groups.extend(_sanitize_group(group) for group in resolved.get("groups", ()))
    return _merge_partitioned_groups(groups)


def _resolver_lane_payload(
    lane_id: str,
    items: Iterable[_MapEvidence],
    *,
    clip_start: float,
    clip_end: float,
) -> dict[str, Any]:
    rows: dict[str, dict[str, Any]] = {}
    activations: dict[tuple[str, str], dict[str, Any]] = {}
    source_id = ""
    for item in items:
        start = max(clip_start, item.start)
        end = min(clip_end, item.end)
        if end <= start:
            continue
        source_id = item.source_id
        row = rows.setdefault(
            item.row_id,
            {
                "rowId": item.row_id,
                **({"rowAnchorJdUt": item.row_anchor} if item.row_anchor is not None else {}),
                "activations": [],
            },
        )
        key = (item.row_id, item.activation_id)
        activation = activations.get(key)
        if activation is None:
            activation = {
                "activationId": item.activation_id,
                "pointId": item.point_id,
                "planetId": item.planet_id,
                "role": item.role,
                "basis": item.basis,
                "windows": [],
            }
            if item.color_role:
                activation["colorRole"] = item.color_role
            if item.color_hex:
                activation["colorHex"] = item.color_hex
            activations[key] = activation
            row["activations"].append(activation)
        activation["windows"].append(
            {"startJdUt": start, "endJdUt": end, "endExclusive": True}
        )
    return {"laneId": lane_id, "sourceId": source_id, "rows": list(rows.values())}


def _sanitize_group(group: dict[str, Any]) -> dict[str, Any]:
    payload = dict(group)
    payload["focusDatetime"] = None
    participants = []
    for raw in payload.get("participants", ()):
        participant = dict(raw)
        participant["rowAnchorDatetime"] = None
        participants.append(participant)
    payload["participants"] = participants
    return payload


def _project_groups_to_span(
    groups: Iterable[dict[str, Any]],
    start: float,
    end: float,
) -> list[dict[str, Any]]:
    """Clip visible horizons without changing canonical identity or focus."""

    projected: list[dict[str, Any]] = []
    for group in groups:
        group_start = float(group["startJdUt"])
        group_end = float(group["endJdUt"])
        visible_start = max(float(start), group_start)
        visible_end = min(float(end), group_end)
        if visible_end <= visible_start:
            continue
        payload = dict(group)
        payload["startJdUt"] = visible_start
        payload["endJdUt"] = visible_end
        projected.append(payload)
    projected.sort(
        key=lambda group: (
            float(group["startJdUt"]),
            -int(group["laneCount"]),
            int(group["planetId"]),
            str(group["groupId"]),
        )
    )
    return projected


def _merge_partitioned_groups(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_participants: dict[
        tuple[int, tuple[tuple[str, str, str], ...]],
        list[dict[str, Any]],
    ] = {}
    for group in groups:
        key = (int(group["planetId"]), _group_participant_key(group))
        by_participants.setdefault(key, []).append(group)

    merged: list[dict[str, Any]] = []
    for participant_groups in by_participants.values():
        participant_groups.sort(
            key=lambda group: (float(group["startJdUt"]), float(group["endJdUt"]))
        )
        current: dict[str, Any] | None = None
        for group in participant_groups:
            if (
                current is not None
                and float(group["startJdUt"]) <= float(current["endJdUt"]) + 1e-9
            ):
                current["endJdUt"] = max(
                    float(current["endJdUt"]),
                    float(group["endJdUt"]),
                )
                current["focusJdUt"] = float(current["startJdUt"]) + (
                    float(current["endJdUt"]) - float(current["startJdUt"])
                ) / 2.0
                continue
            if current is not None:
                _refresh_group_id(current)
                merged.append(current)
            current = dict(group)
        if current is not None:
            _refresh_group_id(current)
            merged.append(current)
    merged.sort(
        key=lambda group: (
            float(group["startJdUt"]),
            -int(group["laneCount"]),
            int(group["planetId"]),
            str(group["groupId"]),
        )
    )
    return merged


def _group_participant_key(group: dict[str, Any]) -> tuple[tuple[str, str, str], ...]:
    return tuple(
        sorted(
            (
                str(item.get("laneId") or ""),
                str(item.get("rowId") or ""),
                str(item.get("activationId") or ""),
            )
            for item in group.get("participants", ())
            if isinstance(item, dict)
        )
    )


def _refresh_group_id(group: dict[str, Any]) -> None:
    identity = {
        "planetId": int(group["planetId"]),
        "startJdUt": float(group["startJdUt"]),
        "endJdUt": float(group["endJdUt"]),
        "participants": _group_participant_key(group),
    }
    digest = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:20]
    group["groupId"] = f"planet:{int(group['planetId'])}:{digest}"


def _merge_spans(spans: Iterable[tuple[float, float]]) -> list[tuple[float, float]]:
    ordered = sorted(
        (float(start), float(end))
        for start, end in spans
        if math.isfinite(float(start)) and math.isfinite(float(end)) and float(end) > float(start)
    )
    merged: list[tuple[float, float]] = []
    for start, end in ordered:
        if merged and start <= merged[-1][1] + 1e-9:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _clip_spans(
    spans: Iterable[tuple[float, float]],
    horizon_start: float,
    horizon_end: float,
) -> list[tuple[float, float]]:
    return [
        (max(horizon_start, start), min(horizon_end, end))
        for start, end in spans
        if min(horizon_end, end) > max(horizon_start, start)
    ]


def _spans_cover(spans: Iterable[tuple[float, float]], start: float, end: float) -> bool:
    cursor = float(start)
    for span_start, span_end in _merge_spans(spans):
        if span_end <= cursor + 1e-9:
            continue
        if span_start > cursor + 1e-9:
            return False
        cursor = max(cursor, span_end)
        if cursor >= end - 1e-9:
            return True
    return cursor >= end - 1e-9


def _bounded_query_span(
    job: _TemporalMapJob,
    start_jd_ut: float,
    end_jd_ut: float,
) -> tuple[float, float]:
    horizon_start, horizon_end = job.horizon
    try:
        start = max(horizon_start, float(start_jd_ut))
        end = min(horizon_end, float(end_jd_ut))
    except (TypeError, ValueError):
        raise ValueError("temporal map query bounds must be numeric") from None
    if not math.isfinite(start) or not math.isfinite(end) or end <= start:
        raise ValueError("temporal map query has an empty JD span")
    return start, end


def _ordered_chunks(
    start: float,
    end: float,
    chunk_days: float,
    focus: float,
) -> list[tuple[float, float]]:
    chunks: list[tuple[float, float]] = []
    cursor = start
    while cursor < end - 1e-9:
        chunk_end = min(end, cursor + chunk_days)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end
    chunks.sort(key=lambda span: abs((span[0] + span[1]) / 2.0 - focus))
    return chunks


def _jd_query_dates(chrt, start_jd: float, end_jd: float) -> tuple[str, str]:
    calflag = (
        astrology.SE_JUL_CAL
        if int(getattr(getattr(chrt, "time", None), "cal", chart.Time.GREGORIAN))
        == chart.Time.JULIAN
        else astrology.SE_GREG_CAL
    )
    start_values = astrology.swe_revjul(float(start_jd) + 1e-9, calflag)
    end_values = astrology.swe_revjul(math.nextafter(float(end_jd), -math.inf), calflag)
    start = _safe_civil_date(*start_values[:3], boundary="start")
    end = _safe_civil_date(*end_values[:3], boundary="end")
    return start.isoformat(), end.isoformat()


def _safe_civil_date(
    year: Any,
    month: Any,
    day: Any,
    *,
    boundary: str,
) -> datetime.date:
    """Fit a Swiss civil date through the existing date-based list APIs.

    Python's ``date`` validates with Gregorian leap rules while a Julian chart
    can produce e.g. 1900-02-29.  The date-based canonical list APIs interpret
    the accepted tuple in the chart calendar.  Round a start backward and an
    end forward so their inclusive source scan always contains the requested JD
    interval; moving both backward can silently omit the Julian-only leap day.
    """
    y, m, d = int(year), int(month), int(day)
    if y < 1 or y > 9999:
        raise ValueError("temporal map source date is outside the supported civil range")
    if boundary not in {"start", "end"}:
        raise ValueError("temporal map boundary must be start or end")
    try:
        return datetime.date(y, m, d)
    except ValueError:
        pass
    prior_day = d
    while prior_day > 0:
        try:
            prior = datetime.date(y, m, prior_day)
            if boundary == "start":
                return prior
            return prior + datetime.timedelta(days=1)
        except ValueError:
            prior_day -= 1
    raise ValueError("temporal map source date is invalid")


def _spec_ids(*candidates: Any) -> list[str]:
    for candidate in candidates:
        if not isinstance(candidate, (list, tuple)):
            continue
        values = [str(value) for value in candidate if str(value)]
        if values:
            return values
    return []


def _retained_semantic_key() -> str:
    from .options_service import options_service

    return options_service.get_retained_list_data_key()


def _transit_orbs_enabled(spec: dict[str, Any]) -> bool:
    return bool(spec.get("includeOrbTemporal", True))


def _heavy_chunk_days(lane: _LaneState) -> float:
    if lane.source_id != "transits":
        return SYNODIC_CHUNK_DAYS
    # Direct + converse can roughly double the canonical row stream.  Keep its
    # chunks below the Search service's real 500-row safety ceiling instead of
    # accepting a truncated interval as authoritative.
    if str(lane.spec.get("direction") or "direct").strip().lower() == "both":
        return TRANSIT_CHUNK_DAYS / 2.0
    return TRANSIT_CHUNK_DAYS


def _primary_direction_mode(value: Any) -> int:
    text = str(value or "direct").strip().lower()
    if text == "converse":
        return primdirs.PrimDirs.CONVERSE
    if text == "both":
        return primdirs.PrimDirs.BOTHDC
    return primdirs.PrimDirs.DIRECT


def _nearest_level(bin_days: float) -> int:
    return min(
        range(len(LOD_LEVELS)),
        key=lambda index: abs(math.log(max(bin_days, 1e-9) / float(LOD_LEVELS[index]["binDays"]))),
    )


def _bin_index(value: float, start: float, width: float, count: int) -> int:
    return max(0, min(count - 1, int(math.floor((float(value) - start) / width))))


temporal_map_service = TemporalMapService()
