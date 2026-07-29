// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const ASPECT_LIST_CURSOR_FALLBACK_DELAY_MS = 300;
export const ASPECT_LIST_PERFECTION_BATCH_SIZE = 8;
export const ASPECT_LIST_PERFECTION_BATCH_LIMIT = 16;
export const ASPECT_LIST_PERFECTION_CONCURRENCY = 2;

/**
 * Hiding the comparison ring is a presentation lens, not permission to forget
 * the user's comparison-mode selection. Query the singleton primary while the
 * ring is hidden, then restore the selected interchart world when it returns.
 */
export function aspectListRequestedMode(preferredMode, comparisonVisible) {
  return comparisonVisible === false ? "primary" : preferredMode;
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

/** Carry exact results across a patch only for rows whose daemon-owned
 * calculation trajectory is unchanged. Removed, new, and changed rows are
 * deliberately omitted so the lazy scheduler resolves only those rows. */
export function retainMatchingAspectListPerfections({
  previousRows,
  nextRows,
  previousByRow,
}) {
  const previousTrajectoryById = new Map(
    previousRows.map((row) => [row.id, row.trajectoryKey]),
  );
  const retained = new Map();
  for (const row of nextRows) {
    if (
      row.trajectoryKey &&
      previousTrajectoryById.get(row.id) === row.trajectoryKey &&
      previousByRow.has(row.id)
    ) {
      retained.set(row.id, previousByRow.get(row.id));
    }
  }
  return retained;
}
