# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Step-coupled live surfaces.

A visible surface that must follow arrow stepping (the Inspector Speculum, the
focused Inspector object, the hover flag) declares itself on the navigate-key
request. Its payload is built right after the step and travels inside that
step's snapshot, so the surface repaints with the wheel from one response
instead of issuing its own request after the paint.

The step lane has a fixed budget. Requests run in the caller's priority order;
once the budget is spent the rest come back ``deferred`` and the surface keeps
its ordinary settle refresh. A failed surface reports ``error`` and likewise
falls back, so a live surface can never fail the step itself.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Iterable, Mapping

# Daemon time per step for all live surfaces together (doc: inspector tier
# <= 4 ms plus visible cheap tables <= 4 ms). The wheel snapshot is separate.
LIVE_SURFACE_BUDGET_MS = 8.0
MAX_LIVE_SURFACES = 8

LIVE_SURFACE_KINDS = ("table", "inspector", "inspector-flag")

Builder = Callable[[Mapping[str, Any]], Any]


def resolve(
    requests: Iterable[Mapping[str, Any]],
    builders: Mapping[str, Builder],
    *,
    budget_ms: float | None = None,
    clock: Callable[[], float] = time.perf_counter,
) -> dict[str, dict[str, Any]]:
    """Build each requested surface until the budget runs out, keyed by its key."""
    budget_ms = LIVE_SURFACE_BUDGET_MS if budget_ms is None else budget_ms
    started = clock()
    results: dict[str, dict[str, Any]] = {}
    for request in requests:
        key = str(request.get("key") or "")
        if not key or key in results:
            continue
        if (clock() - started) * 1000.0 >= budget_ms:
            results[key] = {"status": "deferred"}
            continue
        builder = builders.get(str(request.get("kind") or ""))
        if builder is None:
            results[key] = {"status": "error", "detail": "unsupported live surface"}
            continue
        surface_started = clock()
        try:
            payload = builder(request)
        # Inspector lookups signal "no such region" with SystemExit; either
        # way the step must still paint and the surface falls back.
        except (Exception, SystemExit) as exc:
            results[key] = {"status": "error", "detail": str(exc)}
            continue
        if payload is None:
            results[key] = {"status": "error", "detail": "no payload"}
            continue
        results[key] = {
            "status": "ok",
            "payload": payload,
            "ms": round((clock() - surface_started) * 1000.0, 3),
        }
    return results
