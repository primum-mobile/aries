# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Resolve exact cross-list planetary concurrence from canonical row evidence.

The four participating list services remain the owners of their rows, filters,
and astrology semantics.  They may add a small ``temporal`` evidence block to
an otherwise unchanged row.  This module only intersects those already-defined
half-open windows; it never rounds dates, invents a tolerance, or creates a
replacement table.
"""

from __future__ import annotations

from dataclasses import dataclass
import datetime as _datetime
import hashlib
import heapq
from itertools import combinations
import json
import math
from typing import Any, Iterable


MAX_LANES = 4
MAX_ROWS_PER_LANE = 20_000
MAX_ACTIVATIONS_PER_ROW = 32
MAX_WINDOWS_PER_ACTIVATION = 64

_ROLE_RANK = {
    "actor": 0,
    "period-ruler": 1,
    "target": 2,
    "participant": 3,
    "term-ruler": 4,
    "releaser-affinity": 5,
}
_BASIS_RANK = {
    "exact": 0,
    "station-state": 1,
    "orb": 2,
    "period": 3,
}


@dataclass(frozen=True)
class _Evidence:
    lane_id: str
    source_id: str
    row_id: str
    activation_id: str
    point_id: str
    planet_id: int
    color_role: str | None
    color_hex: str | None
    role: str
    basis: str
    row_anchor: float | None
    start: float
    end: float

    @property
    def participant_key(self) -> tuple[str, str, str]:
        return (self.lane_id, self.row_id, self.activation_id)


def resolve_concurrence(
    lanes: Iterable[dict[str, Any]],
    *,
    minimum_lanes: int = 2,
) -> dict[str, Any]:
    """Return maximal, deterministic 2–4-lane planetary intersections.

    Each result contains at most one real row from each lane.  Candidate
    windows are partitioned at every exact boundary, so A↔B and B↔C do not
    transitive-chain into a false A↔B↔C group when A and C never overlap.
    Adjacent atomic spans are merged only while their selected participants are
    identical.
    """

    lane_values = list(lanes)
    if len(lane_values) > MAX_LANES:
        raise ValueError(f"at most {MAX_LANES} lanes are supported")
    minimum = int(minimum_lanes)
    if minimum < 2 or minimum > MAX_LANES:
        raise ValueError("minimum_lanes must be between 2 and 4")

    evidence = _read_evidence(lane_values)
    by_planet: dict[int, list[_Evidence]] = {}
    for item in evidence:
        by_planet.setdefault(item.planet_id, []).append(item)

    groups: list[dict[str, Any]] = []
    for planet_id in sorted(by_planet):
        groups.extend(_planet_groups(planet_id, by_planet[planet_id], minimum))
    groups.sort(
        key=lambda group: (
            float(group["startJdUt"]),
            -int(group["laneCount"]),
            int(group["planetId"]),
            str(group["groupId"]),
        )
    )

    return {
        "groups": groups,
        "minimumLanes": minimum,
        "laneCount": len({item.lane_id for item in evidence}),
    }


def _read_evidence(lanes: list[dict[str, Any]]) -> list[_Evidence]:
    seen_lane_ids: set[str] = set()
    evidence: list[_Evidence] = []
    for raw_lane in lanes:
        if not isinstance(raw_lane, dict):
            continue
        lane_id = str(raw_lane.get("laneId") or "").strip()
        source_id = str(raw_lane.get("sourceId") or "").strip()
        if not lane_id or lane_id in seen_lane_ids:
            raise ValueError("laneId values must be non-empty and distinct")
        seen_lane_ids.add(lane_id)
        raw_rows = raw_lane.get("rows")
        if not isinstance(raw_rows, list):
            continue
        if len(raw_rows) > MAX_ROWS_PER_LANE:
            raise ValueError("a temporal lane contains too many rows")
        for raw_temporal in raw_rows:
            evidence.extend(_read_row(lane_id, source_id, raw_temporal))
    return evidence


def _read_row(
    lane_id: str,
    source_id: str,
    raw_temporal: Any,
) -> list[_Evidence]:
    if not isinstance(raw_temporal, dict):
        return []
    row_id = str(raw_temporal.get("rowId") or "").strip()
    raw_row_anchor = raw_temporal.get("rowAnchorJdUt")
    try:
        row_anchor = float(raw_row_anchor) if raw_row_anchor is not None else None
    except (TypeError, ValueError):
        row_anchor = None
    if row_anchor is not None and not math.isfinite(row_anchor):
        row_anchor = None
    activations = raw_temporal.get("activations")
    if not row_id or not isinstance(activations, list):
        return []
    if len(activations) > MAX_ACTIVATIONS_PER_ROW:
        raise ValueError("a temporal row contains too many activations")

    evidence: list[_Evidence] = []
    for raw_activation in activations:
        if not isinstance(raw_activation, dict):
            continue
        try:
            planet_id = int(raw_activation.get("planetId"))
        except (TypeError, ValueError):
            continue
        activation_id = str(raw_activation.get("activationId") or "").strip()
        point_id = str(raw_activation.get("pointId") or "").strip()
        role = str(raw_activation.get("role") or "").strip()
        basis = str(raw_activation.get("basis") or "").strip()
        color_role = str(raw_activation.get("colorRole") or "").strip() or None
        color_hex = str(raw_activation.get("colorHex") or "").strip() or None
        windows = raw_activation.get("windows")
        if not activation_id or not point_id or not role or not basis:
            continue
        if not isinstance(windows, list):
            continue
        if len(windows) > MAX_WINDOWS_PER_ACTIVATION:
            raise ValueError("a temporal activation contains too many windows")
        for raw_window in windows:
            if not isinstance(raw_window, dict):
                continue
            try:
                start = float(raw_window.get("startJdUt"))
                end = float(raw_window.get("endJdUt"))
            except (TypeError, ValueError):
                continue
            if not math.isfinite(start) or not math.isfinite(end) or end <= start:
                continue
            evidence.append(
                _Evidence(
                    lane_id=lane_id,
                    source_id=source_id,
                    row_id=row_id,
                    activation_id=activation_id,
                    point_id=point_id,
                    planet_id=planet_id,
                    color_role=color_role,
                    color_hex=color_hex,
                    role=role,
                    basis=basis,
                    row_anchor=row_anchor,
                    start=start,
                    end=end,
                )
            )
    return evidence


def _planet_groups(
    planet_id: int,
    evidence: list[_Evidence],
    minimum_lanes: int,
) -> list[dict[str, Any]]:
    # The canonical lists can legitimately contribute thousands of resident
    # rows.  Sweep their exact half-open boundaries once instead of rescanning
    # every item for every atomic interval.  Per-lane heaps retain the same
    # narrowest-row selection rule and lazily discard evidence as it expires.
    unique_evidence = list(dict.fromkeys(evidence))
    starts: dict[float, list[_Evidence]] = {}
    ends: dict[float, list[_Evidence]] = {}
    for item in unique_evidence:
        starts.setdefault(item.start, []).append(item)
        ends.setdefault(item.end, []).append(item)
    boundaries = sorted(set(starts) | set(ends))
    if len(boundaries) < 2:
        return []

    active_by_lane: dict[str, set[_Evidence]] = {}
    heap_by_lane: dict[str, list[tuple[tuple[Any, ...], _Evidence]]] = {}
    atomic: list[tuple[float, float, tuple[_Evidence, ...]]] = []
    for start, end in zip(boundaries, boundaries[1:]):
        if end <= start:
            continue
        for item in ends.get(start, ()):
            active = active_by_lane.get(item.lane_id)
            if active is None:
                continue
            active.discard(item)
            if not active:
                active_by_lane.pop(item.lane_id, None)
        for item in starts.get(start, ()):
            active_by_lane.setdefault(item.lane_id, set()).add(item)
            heapq.heappush(
                heap_by_lane.setdefault(item.lane_id, []),
                (_lane_evidence_rank(item), item),
            )
        if len(active_by_lane) < minimum_lanes:
            continue
        selected_rows: list[_Evidence] = []
        for lane_id in sorted(active_by_lane):
            heap = heap_by_lane[lane_id]
            active = active_by_lane[lane_id]
            while heap and heap[0][1] not in active:
                heapq.heappop(heap)
            if heap:
                selected_rows.append(heap[0][1])
        selected = tuple(selected_rows)
        if len(selected) >= minimum_lanes:
            atomic.append((start, end, selected))

    # Preserve one long lower-order relationship across nested peaks.  An A+B
    # period therefore remains a single interval when brief A+B+C or A+B+C+D
    # activations occur inside it, instead of becoming one low-information
    # episode on each side of every peak.
    spans_by_participants: dict[
        tuple[tuple[str, str, str], ...],
        list[tuple[float, float, tuple[_Evidence, ...]]],
    ] = {}
    for start, end, participants in atomic:
        for lane_count in range(minimum_lanes, len(participants) + 1):
            for participant_subset in combinations(participants, lane_count):
                key = tuple(item.participant_key for item in participant_subset)
                spans = spans_by_participants.setdefault(key, [])
                if spans and spans[-1][1] == start:
                    spans[-1] = (spans[-1][0], end, participant_subset)
                else:
                    spans.append((start, end, participant_subset))

    candidates = [
        span
        for spans in spans_by_participants.values()
        for span in spans
    ]
    participants_by_interval: dict[
        tuple[float, float],
        list[frozenset[tuple[str, str, str]]],
    ] = {}
    for start, end, participants in candidates:
        participants_by_interval.setdefault((start, end), []).append(
            frozenset(item.participant_key for item in participants)
        )

    maximal: list[tuple[float, float, tuple[_Evidence, ...]]] = []
    for start, end, participants in candidates:
        participant_set = frozenset(item.participant_key for item in participants)
        if any(
            participant_set < other
            for other in participants_by_interval[(start, end)]
        ):
            continue
        maximal.append((start, end, participants))
    return [
        _group_payload(planet_id, start, end, participants)
        for start, end, participants in maximal
    ]


def _select_lane_evidence(candidates: list[_Evidence]) -> _Evidence:
    return min(candidates, key=_lane_evidence_rank)


def _lane_evidence_rank(item: _Evidence) -> tuple[Any, ...]:
    return (
        item.end - item.start,
        _BASIS_RANK.get(item.basis, 99),
        item.basis,
        _ROLE_RANK.get(item.role, 99),
        item.role,
        item.row_id,
        item.activation_id,
        item.start,
        item.end,
        item.point_id,
        item.source_id,
        item.lane_id,
        item.planet_id,
        item.color_role or "",
        item.color_hex or "",
        0 if item.row_anchor is None else 1,
        item.row_anchor if item.row_anchor is not None else 0.0,
    )


def _group_payload(
    planet_id: int,
    start: float,
    end: float,
    participants: tuple[_Evidence, ...],
) -> dict[str, Any]:
    participant_payload = [
        {
            "laneId": item.lane_id,
            "sourceId": item.source_id,
            "rowId": item.row_id,
            "activationId": item.activation_id,
            "pointId": item.point_id,
            "planetId": item.planet_id,
            "role": item.role,
            "basis": item.basis,
            **(
                {
                    "rowAnchorJdUt": item.row_anchor,
                    "rowAnchorDatetime": _jd_to_iso(item.row_anchor),
                }
                if item.row_anchor is not None
                else {}
            ),
        }
        for item in participants
    ]
    color_role = next((item.color_role for item in participants if item.color_role), None)
    color_hex = next((item.color_hex for item in participants if item.color_hex), None)
    identity = {
        "planetId": planet_id,
        "startJdUt": start,
        "endJdUt": end,
        "participants": [
            [item.lane_id, item.row_id, item.activation_id]
            for item in participants
        ],
    }
    digest = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:20]
    focus = start if math.nextafter(start, math.inf) >= end else start + (end - start) / 2.0
    payload = {
        "groupId": f"planet:{planet_id}:{digest}",
        "planetId": planet_id,
        "startJdUt": start,
        "endJdUt": end,
        "focusJdUt": focus,
        "focusDatetime": _jd_to_iso(focus),
        "laneCount": len(participants),
        "participants": participant_payload,
    }
    if color_role:
        payload["colorRole"] = color_role
    if color_hex:
        payload["colorHex"] = color_hex
    return payload


def _jd_to_iso(jd_ut: float) -> str | None:
    """Format a UI navigation instant without changing its JD authority."""
    try:
        epoch = _datetime.datetime(2000, 1, 1, 12, tzinfo=_datetime.timezone.utc)
        value = epoch + _datetime.timedelta(days=float(jd_ut) - 2451545.0)
    except (OverflowError, TypeError, ValueError):
        return None
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")
