# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Which charts occupy the wheel's concentric rings, and in what order.

The wheel has always drawn at most two charts, chosen by
``WorkspaceService._select_render_charts``: the live chart outermost, its
immediate parent (or the radix, under ``show_radix_comparison``) innermost.
This module keeps the established two-ring rule and supplies the ordered branch
universe used by the explicit tri/quad multi-wheel participant selection.

The document tree supplies the branch-wide eligible universe and its stable
inner-to-outer order. The multi-wheel mode then stores an explicit subset of
three or four document IDs. The root is selectable like every child and the
active tab need not be a participant. Closing or reparenting a document is
therefore reconciled against the same live universe before the next paint.

The older root/middle/active helpers remain below for the ordinary two-wheel
contract and compatibility tests; they are not the tri/quad selection owner.
"""
from __future__ import annotations

from typing import Any, Callable, Iterable, Optional, Sequence

CHART_RING_COUNT_MIN = 2
CHART_RING_COUNT_MAX = 4
CHART_RING_NUMERALS = ("I", "II", "III", "IV")
CHART_RING_ZODIAC_RIM = "rim"
CHART_RING_ZODIAC_CENTRE = "centre"
CHART_RING_ZODIAC_VALUES = {CHART_RING_ZODIAC_RIM, CHART_RING_ZODIAC_CENTRE}


def multiwheel_ring_taxonomy(ring_count: Any) -> list[dict[str, Any]]:
    """Visible inner-to-outer ring identities, compacted to I–IV."""
    try:
        count = int(ring_count)
    except (TypeError, ValueError):
        count = 0
    count = max(0, min(count, CHART_RING_COUNT_MAX))
    return [
        {"ringIndex": index, "numeral": CHART_RING_NUMERALS[index]}
        for index in range(count)
    ]


def chart_ring_count(options: Any) -> int:
    """Saved default ring count, clamped to the supported range."""
    try:
        value = int(getattr(options, "chart_ring_count", CHART_RING_COUNT_MIN))
    except (TypeError, ValueError):
        return CHART_RING_COUNT_MIN
    if value < CHART_RING_COUNT_MIN:
        return CHART_RING_COUNT_MIN
    if value > CHART_RING_COUNT_MAX:
        return CHART_RING_COUNT_MAX
    return value


def chart_ring_zodiac(options: Any) -> str:
    """Saved zodiac position for 3+ ring wheels ("rim" or "centre").

    The two-ring wheel keeps its own inherited layout (the zodiac band sits
    between the two body rings) and ignores this value; only the tri/quad
    families read it.
    """
    value = str(getattr(options, "chart_ring_zodiac", CHART_RING_ZODIAC_RIM) or "")
    return value if value in CHART_RING_ZODIAC_VALUES else CHART_RING_ZODIAC_RIM


def normalize_ring_count(value: Any, default: int = CHART_RING_COUNT_MIN) -> int:
    try:
        count = int(value)
    except (TypeError, ValueError):
        return default
    if count < CHART_RING_COUNT_MIN:
        return CHART_RING_COUNT_MIN
    if count > CHART_RING_COUNT_MAX:
        return CHART_RING_COUNT_MAX
    return count


def normalize_ring_zodiac(value: Any, default: str = CHART_RING_ZODIAC_RIM) -> str:
    text = str(value or "")
    return text if text in CHART_RING_ZODIAC_VALUES else default


def branch_document_ids(
    documents: Sequence[Any],
    active_document_id: Optional[str],
) -> list[str]:
    """The active document's branch, flattened in tree (indentation) order.

    ``documents`` is the flat, visually-ordered tuple
    ``workspace_model.WorkspaceState.documents()`` returns — the same order the
    sidebar renders and drag/drop rewrites. The branch is the active
    document's root ancestor plus every descendant of that root.
    """
    if not active_document_id:
        return []
    by_id = {getattr(doc, "document_id", None): doc for doc in documents}
    if active_document_id not in by_id:
        return []

    # Root ancestor of the active document.
    root_id = active_document_id
    seen = {root_id}
    while True:
        parent_id = getattr(by_id.get(root_id), "parent_document_id", None)
        if not parent_id or parent_id in seen or parent_id not in by_id:
            break
        seen.add(parent_id)
        root_id = parent_id

    # Every document whose ancestry reaches that root, kept in tree order.
    def reaches_root(document_id: str) -> bool:
        guard = {document_id}
        current = document_id
        while current != root_id:
            parent_id = getattr(by_id.get(current), "parent_document_id", None)
            if not parent_id or parent_id in guard or parent_id not in by_id:
                return False
            guard.add(parent_id)
            current = parent_id
        return True

    return [
        document_id
        for document_id in (getattr(doc, "document_id", None) for doc in documents)
        if document_id and reaches_root(document_id)
    ]


def resolve_ring_document_ids(
    documents: Sequence[Any],
    active_document_id: Optional[str],
    ring_count: int,
    *,
    has_chart: Optional[Callable[[str], bool]] = None,
) -> list[str]:
    """Ordered ring membership, innermost first, for one active document.

    Documents with no chart (tables, astrocart, other view-only surfaces) are
    never rings; ``has_chart`` filters them before the ordering rule applies,
    so a table opened under a radix cannot displace a chart.
    """
    count = normalize_ring_count(ring_count)
    branch = branch_document_ids(documents, active_document_id)
    if has_chart is not None:
        branch = [
            document_id for document_id in branch
            if document_id == active_document_id or has_chart(document_id)
        ]
    if not branch or active_document_id not in branch:
        return [active_document_id] if active_document_id else []

    root_id = branch[0]
    if root_id == active_document_id or count < CHART_RING_COUNT_MIN:
        return [active_document_id]

    # Ring 1 is the branch root, ring N the active document; the middle rings
    # fill from the nodes between them, nearest the root first.
    active_index = branch.index(active_document_id)
    middle = branch[1:active_index]
    wanted_middle = max(0, count - 2)
    return [root_id] + middle[:wanted_middle] + [active_document_id]


def resolve_shared_ring_document_ids(
    documents: Sequence[Any],
    selected_document_id: Optional[str],
    ring_count: int,
    *,
    has_chart: Optional[Callable[[str], bool]] = None,
) -> list[str]:
    """Stable branch-owned ring membership for the multi-wheel view.

    Unlike the two-chart comparison contract above, selecting another chart in
    the same indentation tree must not change the tri/quad wheel. The branch's
    visual order is therefore the sole membership authority; selection only
    chooses the navigation grammar.
    """
    count = normalize_ring_count(ring_count)
    branch = branch_document_ids(documents, selected_document_id)
    if has_chart is not None:
        branch = [document_id for document_id in branch if has_chart(document_id)]
    return branch[:count]


def eligible_multiwheel_document_ids(
    documents: Sequence[Any],
    selected_document_id: Optional[str],
    *,
    has_chart: Optional[Callable[[str], bool]] = None,
) -> list[str]:
    """All chart-bearing documents available to one branch multi-wheel.

    This deliberately does not impose the four-ring paint limit. The complete
    branch is needed by the participant picker so users can exchange an
    unchecked chart for one of the three/four current participants.
    """
    branch = branch_document_ids(documents, selected_document_id)
    if has_chart is not None:
        branch = [document_id for document_id in branch if has_chart(document_id)]
    return branch


def normalize_multiwheel_participant_ids(
    participant_ids: Iterable[Any],
    eligible_ids: Sequence[str],
) -> list[str]:
    """Live participant subset in current tree order, capped at four."""
    selected: set[str] = set()
    for value in participant_ids:
        if value is None:
            continue
        selected.add(str(value))
    normalized: list[str] = []
    for document_id in eligible_ids:
        if document_id not in selected or document_id in normalized:
            continue
        normalized.append(document_id)
        if len(normalized) == CHART_RING_COUNT_MAX:
            break
    return normalized
