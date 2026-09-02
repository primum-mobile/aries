// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const ASPECT_LIST_CURSOR_FALLBACK_DELAY_MS = 300;
// The payload has already painted before the scheduling effect runs. Yield one
// task so that paint stays coherent, then start the first bounded viewport
// batch immediately; step bursts are guarded separately by the settled-refresh
// state and stale context work is still cancelled by identity.
export const ASPECT_LIST_PERFECTION_IDLE_MS = 0;
export const ASPECT_LIST_PERFECTION_BATCH_SIZE = 4;
export const ASPECT_LIST_PERFECTION_BATCH_LIMIT = 16;
export const ASPECT_LIST_PERFECTION_CONCURRENCY = 1;

/**
 * Hiding the comparison ring is a presentation lens, not permission to forget
 * the user's comparison-mode selection. Query the singleton primary while the
 * ring is hidden, then restore the selected interchart world when it returns.
 */
export function aspectListRequestedMode(preferredMode, comparisonVisible) {
  return comparisonVisible === false ? "primary" : preferredMode;
}

/**
 * The wheel shape owns the normal Aspect List view regardless of how that
 * chart became active. A comparison starts outer -> primary; a true singleton
 * starts on its only chart. Undefined waits for the daemon-resolved wheel.
 */
export function aspectListDefaultMode(comparisonVisible) {
  if (comparisonVisible === true) return "outerToPrimary";
  if (comparisonVisible === false) return "primary";
  return null;
}

/**
 * Resolve the first coherent virtual window for a retained world.
 *
 * A world swap already has the incoming rows, but React state still carries
 * the outgoing world's live scroll offset until the layout effect aligns the
 * DOM scroller. Use the incoming world's cached offset for that render so a
 * shorter list can never commit a spacer-only slice.
 */
export function aspectListVirtualWindow({
  currentViewport,
  presentedWorldIdentity,
  worldIdentity,
  initialScrollTop,
  rowCount,
  rowHeight,
  overscanRows,
}) {
  const safeRowCount = Math.max(0, Math.floor(Number(rowCount) || 0));
  const safeRowHeight = Math.max(1, Number(rowHeight) || 1);
  const safeOverscan = Math.max(0, Math.floor(Number(overscanRows) || 0));
  const height = Math.max(0, Number(currentViewport?.height) || 0);
  const effectiveHeight = height || safeRowHeight;
  const maxTop = Math.max(0, safeRowCount * safeRowHeight - effectiveHeight);
  const requestedTop =
    presentedWorldIdentity === worldIdentity
      ? Number(currentViewport?.scrollTop) || 0
      : Number(initialScrollTop) || 0;
  const scrollTop = Math.max(0, Math.min(maxTop, requestedTop));
  const start = Math.max(
    0,
    Math.floor(scrollTop / safeRowHeight) - safeOverscan,
  );
  const visibleCount =
    Math.ceil(effectiveHeight / safeRowHeight) + safeOverscan * 2;
  const end = Math.min(safeRowCount, start + visibleCount);
  return { scrollTop, height, start, end };
}

/** Select an exact cached list world synchronously while preserving the last
 * visible payload as stale content for a genuinely uncached replacement. */
export function selectRetainedAspectListPayloadState({
  storedState,
  cachedPayload,
  documentId,
  worldIdentity,
  queryIdentity,
  actionIdentity,
}) {
  if (storedState?.worldIdentity === worldIdentity) return storedState;
  if (!cachedPayload) return storedState;
  return {
    documentId,
    worldIdentity,
    payload: cachedPayload,
    queryIdentity,
    actionIdentity,
  };
}

/**
 * Build only the next bounded perfection work. Viewport rows win over exact-
 * sort background rows, and every identity already resolved, pending, or
 * failed in this context is omitted. The caller invokes this again after a
 * progressive batch merge; it never materializes one unbounded request.
 */
export function nextAspectListPerfectionBatches({
  priorityRowIds,
  backgroundRowIds,
  resolvedRowIds,
  pendingRowIds,
  failedRowIds,
  availableSlots,
  batchSize = ASPECT_LIST_PERFECTION_BATCH_SIZE,
}) {
  const boundedBatchSize = Math.max(
    1,
    Math.min(ASPECT_LIST_PERFECTION_BATCH_LIMIT, Math.floor(batchSize)),
  );
  const batchCount = Math.max(
    0,
    Math.min(ASPECT_LIST_PERFECTION_CONCURRENCY, Math.floor(availableSlots)),
  );
  if (batchCount === 0) return [];

  const seen = new Set();
  const missing = [];
  for (const rowId of [...priorityRowIds, ...backgroundRowIds]) {
    if (
      !rowId ||
      seen.has(rowId) ||
      resolvedRowIds.has(rowId) ||
      pendingRowIds.has(rowId) ||
      failedRowIds.has(rowId)
    ) {
      continue;
    }
    seen.add(rowId);
    missing.push(rowId);
    if (missing.length >= boundedBatchSize * batchCount) break;
  }

  const batches = [];
  for (let index = 0; index < missing.length; index += boundedBatchSize) {
    batches.push(missing.slice(index, index + boundedBatchSize));
  }
  return batches;
}

/**
 * Advance the tiny cursor-event handoff state machine used by Aspect List.
 * A step event may arrive before the navigate response publishes its focus;
 * keep that event available for exactly one following focus update so the
 * missed-event fallback does not duplicate the canonical settled refresh.
 */
export function advanceAspectListCursorTracker(tracker, input) {
  const {
    documentId,
    focusDatetime,
    sessionSeq,
    sessionChangeReason,
    now,
    handoffMs = ASPECT_LIST_CURSOR_FALLBACK_DELAY_MS,
  } = input;

  if (tracker.documentId !== documentId) {
    return {
      tracker: {
        documentId,
        focusDatetime,
        sessionSeq,
        pendingStepSeq: 0,
        pendingStepAt: 0,
      },
      scheduleFallback: false,
    };
  }

  let next = tracker;
  const focusChanged = tracker.focusDatetime !== focusDatetime;
  if (sessionSeq > tracker.sessionSeq) {
    next = {
      ...tracker,
      sessionSeq,
      pendingStepSeq: 0,
      pendingStepAt: 0,
    };
    if (sessionChangeReason === "step") {
      if (focusChanged) {
        return {
          tracker: { ...next, focusDatetime },
          scheduleFallback: false,
        };
      }
      return {
        tracker: {
          ...next,
          pendingStepSeq: sessionSeq,
          pendingStepAt: now,
        },
        scheduleFallback: false,
      };
    }
  }

  if (!focusChanged) {
    return { tracker: next, scheduleFallback: false };
  }

  const pendingStepCoversFocus =
    next.pendingStepSeq > 0 &&
    now - next.pendingStepAt >= 0 &&
    now - next.pendingStepAt <= handoffMs;
  if (pendingStepCoversFocus) {
    return {
      tracker: {
        ...next,
        focusDatetime,
        pendingStepSeq: 0,
        pendingStepAt: 0,
      },
      scheduleFallback: false,
    };
  }

  return {
    tracker: {
      ...next,
      pendingStepSeq: 0,
      pendingStepAt: 0,
    },
    scheduleFallback: true,
  };
}

export function aspectListQueryIdentity({
  documentId,
  mode,
  refreshSeq,
  cursorFallbackSeq,
  contextRevisionSeq,
  retrySeq,
}) {
  return [
    documentId,
    mode ?? "default",
    refreshSeq,
    cursorFallbackSeq,
    contextRevisionSeq,
    retrySeq,
  ].join("\u0000");
}

/**
 * Content identity for a reusable retained Aspect List world.
 *
 * Request/event generations deliberately do not belong here: they authorize
 * replacement work, but they do not describe chart data. A stable options key
 * comes from the daemon, while irreversible same-cursor session mutations keep
 * their own generation. Cursor time and comparison shape are reversible inputs,
 * so returning to either restores the previously cached world.
 */
export function aspectListRetainedWorldIdentity({
  documentId,
  mode,
  contextRevision,
  focusDatetime,
  sessionMutationSeq,
  retainedListDataKey,
}) {
  return JSON.stringify([
    documentId,
    mode ?? "default",
    contextRevision ?? "unresolved-context",
    focusDatetime ?? "no-focus",
    sessionMutationSeq,
    retainedListDataKey ?? "startup-options",
  ]);
}

export function isAspectListPayloadCurrent(
  payloadState,
  documentId,
  queryIdentity,
  actionIdentity,
) {
  return (
    payloadState?.documentId === documentId &&
    payloadState.queryIdentity === queryIdentity &&
    payloadState.actionIdentity === actionIdentity
  );
}

const STABLE_UNAVAILABLE_PERFECTION_REASONS = new Set([
  "missing-chart-role",
  "static-trajectory",
  "unsupported-trajectory",
  "missing-trajectory-builder",
  "unsupported-endpoint-motion",
  "no-relative-motion",
]);

export function shouldDeferAspectListRefresh({
  pendingStepSeq,
  settledStepSeq,
}) {
  return Number(pendingStepSeq) > Number(settledStepSeq);
}

export function aspectListPerfectionLedgerKey(documentId, mode, row) {
  return [documentId, mode, row.trajectoryKey].join("\u0000");
}

function isReusableAspectListPerfection(row, result, nextAnchorJd) {
  if (!result) return false;
  if (result.status === "unavailable") {
    return STABLE_UNAVAILABLE_PERFECTION_REASONS.has(result.reason);
  }
  const exactJd = Number(result.exactJd);
  const anchorJd = Number(nextAnchorJd);
  if (!Number.isFinite(exactJd) || !Number.isFinite(anchorJd)) return false;
  const epsilon = 1e-5;
  return (
    (row.phase === "applying" && exactJd >= anchorJd - epsilon) ||
    (row.phase === "separating" && exactJd <= anchorJd + epsilon) ||
    (row.phase === "exact" && Math.abs(exactJd - anchorJd) <= epsilon)
  );
}

/** Restore exact results from the pane-lifetime trajectory ledger. Context
 * tokens are deliberately absent: they authorize actions, while the daemon's
 * trajectory key proves whether the underlying exact root is reusable. */
export function retainAspectListPerfectionsFromLedger({
  documentId,
  mode,
  rows,
  ledger,
  nextAnchorJd,
}) {
  const retained = new Map();
  for (const row of rows) {
    if (!row.trajectoryKey) continue;
    const result = ledger.get(
      aspectListPerfectionLedgerKey(documentId, mode, row),
    );
    if (isReusableAspectListPerfection(row, result, nextAnchorJd)) {
      retained.set(row.id, result);
    }
  }
  return retained;
}

/** Carry exact results across refreshes for the same daemon-owned trajectory.
 * A ready root remains reusable only while it is on the side selected by the
 * current applying/separating phase. This preserves dates through ordinary
 * steps and the exact crossing itself, while a station/retrograde branch that
 * points at a different perfection is recalculated. */
export function retainMatchingAspectListPerfections({
  previousRows,
  nextRows,
  previousByRow,
  nextAnchorJd,
}) {
  const previousTrajectoryById = new Map(
    previousRows.map((row) => [row.id, row.trajectoryKey]),
  );
  const retained = new Map();
  for (const row of nextRows) {
    if (!row.trajectoryKey || previousTrajectoryById.get(row.id) !== row.trajectoryKey) {
      continue;
    }
    const result = previousByRow.get(row.id);
    if (!result) continue;
    if (isReusableAspectListPerfection(row, result, nextAnchorJd)) {
      retained.set(row.id, result);
    }
  }
  return retained;
}
