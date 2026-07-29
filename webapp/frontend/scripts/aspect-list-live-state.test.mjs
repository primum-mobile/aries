// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

import {
  ASPECT_LIST_CURSOR_FALLBACK_DELAY_MS,
  ASPECT_LIST_PERFECTION_BATCH_SIZE,
  ASPECT_LIST_PERFECTION_CONCURRENCY,
  advanceAspectListCursorTracker,
  aspectListQueryIdentity,
  aspectListRequestedMode,
  aspectListRetainedWorldIdentity,
  aspectListVirtualWindow,
  isAspectListPayloadCurrent,
  nextAspectListPerfectionBatches,
  retainMatchingAspectListPerfections,
  selectRetainedAspectListPayloadState,
} from "../src/lib/aspect-list-live-state.mjs";

const stepRefreshSource = await readFile(
  new URL("../src/components/workshell/step-refresh.ts", import.meta.url),
  "utf8",
);
const stepRefreshJavascript = ts.transpileModule(stepRefreshSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText.replace(/^import \* as React from "react";\n/m, "");
const {
  advanceWorkspaceSemanticRefreshState,
  optionsTouchIds,
  workspaceSemanticRefreshSeq,
} = await import(
  `data:text/javascript;base64,${Buffer.from(stepRefreshJavascript).toString("base64")}`
);
const payloadCacheSource = await readFile(
  new URL("../src/lib/table/payload-cache.ts", import.meta.url),
  "utf8",
);
const payloadCacheJavascript = ts.transpileModule(payloadCacheSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  getCachedListPayload,
  rememberListPayload,
} = await import(
  `data:text/javascript;base64,${Buffer.from(payloadCacheJavascript).toString("base64")}`
);

function tracker(overrides = {}) {
  return {
    documentId: "chart-a",
    focusDatetime: "2026-07-22T10:00:00",
    sessionSeq: 0,
    pendingStepSeq: 0,
    pendingStepAt: 0,
    ...overrides,
  };
}

function advance(current, overrides = {}) {
  return advanceAspectListCursorTracker(current, {
    documentId: "chart-a",
    focusDatetime: current.focusDatetime,
    sessionSeq: current.sessionSeq,
    sessionChangeReason: null,
    now: 0,
    ...overrides,
  });
}

function semanticRefreshState(scopeKey = "chart-a") {
  return {
    scopeKey,
    immediateSessionSeq: 0,
    optionsSeq: 0,
    pendingStepSeq: 0,
    settledStepSeq: 0,
  };
}

function advanceSemanticRefresh(current, overrides = {}) {
  return advanceWorkspaceSemanticRefreshState(current, {
    scopeKey: current.scopeKey,
    immediateSessionSeq: 0,
    optionsSeq: 0,
    stepSeq: 0,
    settledStepSeq: 0,
    ...overrides,
  });
}

test("renderer-only replacements cannot lower the retained semantic refresh key", () => {
  const sessionRefresh = advanceSemanticRefresh(semanticRefreshState(), {
    immediateSessionSeq: 4,
  });
  assert.equal(workspaceSemanticRefreshSeq(sessionRefresh), 4);

  const neutralSession = advanceSemanticRefresh(sessionRefresh);
  assert.strictEqual(neutralSession, sessionRefresh);
  assert.equal(workspaceSemanticRefreshSeq(neutralSession), 4);

  const optionsRefresh = advanceSemanticRefresh(neutralSession, {
    optionsSeq: 3,
  });
  assert.equal(workspaceSemanticRefreshSeq(optionsRefresh), 7);

  const neutralOptionsAndSynthesizedSession = advanceSemanticRefresh(optionsRefresh);
  assert.strictEqual(neutralOptionsAndSynthesizedSession, optionsRefresh);
  assert.equal(workspaceSemanticRefreshSeq(neutralOptionsAndSynthesizedSession), 7);
});

test("inspector-only option invalidation bypasses only the inspector refresh gate", () => {
  const change = {
    refreshedDocumentIds: ["chart-a"],
    refreshMode: "display-overlay",
    styleOnly: false,
    listDataChanged: false,
    inspectorDataChanged: true,
    schemaVersion: 1,
    themeVersion: 1,
    styleRevision: 1,
    paletteHash: "",
    styleHash: "",
    seq: 5,
  };

  assert.equal(optionsTouchIds(change, ["chart-a"], false), false);
  assert.equal(optionsTouchIds(change, ["chart-a"], true), true);
  assert.equal(optionsTouchIds(change, ["chart-b"], true), false);
});

test("a renderer-only replacement cannot cancel a pending step settle", () => {
  const pending = advanceSemanticRefresh(semanticRefreshState(), {
    stepSeq: 8,
  });
  assert.equal(pending.pendingStepSeq, 8);
  assert.equal(workspaceSemanticRefreshSeq(pending), 0);

  const neutralReplacement = advanceSemanticRefresh(pending);
  assert.strictEqual(neutralReplacement, pending);
  assert.equal(neutralReplacement.pendingStepSeq, 8);

  const settled = advanceSemanticRefresh(neutralReplacement, {
    settledStepSeq: neutralReplacement.pendingStepSeq,
  });
  assert.equal(workspaceSemanticRefreshSeq(settled), 8);
});

test("semantic refresh cursors and pending steps are scoped to the query owner", () => {
  const oldScope = advanceSemanticRefresh(semanticRefreshState("chart-a"), {
    immediateSessionSeq: 3,
    stepSeq: 4,
  });
  const newScope = advanceSemanticRefresh(oldScope, {
    scopeKey: "chart-b",
  });

  assert.deepEqual(newScope, semanticRefreshState("chart-b"));
  assert.equal(workspaceSemanticRefreshSeq(newScope), 0);
});

test("event before navigate snapshot covers the following focus exactly once", () => {
  const eventFirst = advance(tracker(), {
    sessionSeq: 1,
    sessionChangeReason: "step",
    now: 10,
  });
  assert.equal(eventFirst.scheduleFallback, false);
  assert.equal(eventFirst.tracker.pendingStepSeq, 1);

  const snapshotSecond = advance(eventFirst.tracker, {
    focusDatetime: "2026-07-22T11:00:00",
    sessionSeq: 1,
    sessionChangeReason: "step",
    now: 20,
  });
  assert.equal(snapshotSecond.scheduleFallback, false);
  assert.equal(snapshotSecond.tracker.focusDatetime, "2026-07-22T11:00:00");
  assert.equal(snapshotSecond.tracker.pendingStepSeq, 0);
});

test("event after navigate snapshot cancels a proposed fallback", () => {
  const targetFocus = "2026-07-22T11:00:00";
  const snapshotFirst = advance(tracker(), {
    focusDatetime: targetFocus,
    now: 10,
  });
  assert.equal(snapshotFirst.scheduleFallback, true);
  assert.notEqual(snapshotFirst.tracker.focusDatetime, targetFocus);

  const eventSecond = advance(snapshotFirst.tracker, {
    focusDatetime: targetFocus,
    sessionSeq: 1,
    sessionChangeReason: "step",
    now: 20,
  });
  assert.equal(eventSecond.scheduleFallback, false);
  assert.equal(eventSecond.tracker.focusDatetime, targetFocus);
});

test("only a recent step event suppresses the true missed-event fallback", () => {
  const targetFocus = "2026-07-22T11:00:00";
  const noEvent = advance(tracker(), {
    focusDatetime: targetFocus,
    now: 10,
  });
  assert.equal(noEvent.scheduleFallback, true);
  assert.notEqual(noEvent.tracker.focusDatetime, targetFocus);
  assert.equal(noEvent.tracker.documentId === "chart-a" && noEvent.tracker.focusDatetime !== targetFocus, true);

  const nonStep = advance(tracker(), {
    sessionSeq: 1,
    sessionChangeReason: "options",
    now: 10,
  });
  const focusAfterOptions = advance(nonStep.tracker, {
    focusDatetime: targetFocus,
    sessionSeq: 1,
    sessionChangeReason: "options",
    now: 20,
  });
  assert.equal(focusAfterOptions.scheduleFallback, true);

  const oldStep = tracker({
    sessionSeq: 1,
    pendingStepSeq: 1,
    pendingStepAt: 10,
  });
  const focusAfterExpiredStep = advance(oldStep, {
    focusDatetime: targetFocus,
    sessionSeq: 1,
    sessionChangeReason: "step",
    now: 10 + ASPECT_LIST_CURSOR_FALLBACK_DELAY_MS + 1,
  });
  assert.equal(focusAfterExpiredStep.scheduleFallback, true);
});

test("query identity changes for every authoritative refresh input", () => {
  const base = {
    documentId: "chart-a",
    mode: "primary",
    refreshSeq: 1,
    cursorFallbackSeq: 0,
    contextRevisionSeq: 0,
    retrySeq: 0,
  };
  const identity = aspectListQueryIdentity(base);
  for (const patch of [
    { documentId: "chart-b" },
    { mode: "outer" },
    { refreshSeq: 2 },
    { cursorFallbackSeq: 1 },
    { contextRevisionSeq: 1 },
    { retrySeq: 1 },
  ]) {
    assert.notEqual(aspectListQueryIdentity({ ...base, ...patch }), identity);
  }
});

test("retained world identity describes reusable data, not request generations", () => {
  const base = {
    documentId: "chart-a",
    mode: "primary",
    contextRevision: "singleton-context",
    focusDatetime: "2026-07-22T11:00:00",
    sessionMutationSeq: 0,
    retainedListDataKey: "options-a",
  };
  const identity = aspectListRetainedWorldIdentity(base);

  assert.equal(aspectListRetainedWorldIdentity({ ...base }), identity);
  for (const patch of [
    { documentId: "chart-b" },
    { mode: "outer" },
    { contextRevision: "comparison-context" },
    { focusDatetime: "2026-07-22T12:00:00" },
    { sessionMutationSeq: 1 },
    { retainedListDataKey: "options-b" },
  ]) {
    assert.notEqual(
      aspectListRetainedWorldIdentity({ ...base, ...patch }),
      identity,
    );
  }

  const changedOptions = aspectListRetainedWorldIdentity({
    ...base,
    retainedListDataKey: "options-b",
  });
  assert.notEqual(changedOptions, identity);
  assert.equal(aspectListRetainedWorldIdentity({ ...base }), identity);
});

test("TAB preserves the chosen comparison world while presenting singleton primary", () => {
  assert.equal(
    aspectListRequestedMode("outerToPrimary", true),
    "outerToPrimary",
  );
  assert.equal(
    aspectListRequestedMode("outerToPrimary", false),
    "primary",
  );
  assert.equal(
    aspectListRequestedMode("outerToPrimary", true),
    "outerToPrimary",
  );
  assert.equal(aspectListRequestedMode(null, false), "primary");
  assert.equal(aspectListRequestedMode(null, undefined), null);
});

test("retained list cache keeps singleton and comparison worlds independently", () => {
  const comparisonKey = aspectListRetainedWorldIdentity({
    documentId: "chart-a",
    mode: "outerToPrimary",
    contextRevision: "comparison-context",
    focusDatetime: "2026-07-22T11:00:00",
    sessionMutationSeq: 0,
    retainedListDataKey: "options-a",
  });
  const singletonKey = aspectListRetainedWorldIdentity({
    documentId: "chart-a",
    mode: "primary",
    contextRevision: "singleton-context",
    focusDatetime: "2026-07-22T11:00:00",
    sessionMutationSeq: 0,
    retainedListDataKey: "options-a",
  });
  const comparisonWorld = {
    rows: ["comparison-row"],
    perfections: new Map([["comparison-row", "exact"]]),
    scrollTop: 144,
  };
  const singletonWorld = {
    rows: ["singleton-row"],
    perfections: new Map([["singleton-row", "exact"]]),
    scrollTop: 24,
  };

  rememberListPayload("aspect-list-world-test", comparisonKey, comparisonWorld);
  rememberListPayload("aspect-list-world-test", singletonKey, singletonWorld);

  let fetchCount = 0;
  const readCachedWorld = (key) => {
    const cached = getCachedListPayload("aspect-list-world-test", key);
    if (!cached) fetchCount += 1;
    return cached;
  };
  assert.strictEqual(
    readCachedWorld(comparisonKey),
    comparisonWorld,
  );
  assert.strictEqual(
    readCachedWorld(singletonKey),
    singletonWorld,
  );
  const returnedComparisonKey = aspectListRetainedWorldIdentity({
    documentId: "chart-a",
    mode: "outerToPrimary",
    contextRevision: "comparison-context",
    focusDatetime: "2026-07-22T11:00:00",
    sessionMutationSeq: 0,
    retainedListDataKey: "options-a",
  });
  assert.equal(returnedComparisonKey, comparisonKey);
  const restoredComparison = readCachedWorld(returnedComparisonKey);
  assert.strictEqual(restoredComparison, comparisonWorld);
  assert.strictEqual(restoredComparison.perfections, comparisonWorld.perfections);
  assert.equal(restoredComparison.scrollTop, 144);
  assert.equal(fetchCount, 0);
});

test("a world change virtualizes from the incoming cached scroll before paint", () => {
  const incoming = aspectListVirtualWindow({
    currentViewport: { scrollTop: 900, height: 120 },
    presentedWorldIdentity: "comparison",
    worldIdentity: "singleton",
    initialScrollTop: 48,
    rowCount: 8,
    rowHeight: 24,
    overscanRows: 2,
  });
  assert.deepEqual(incoming, {
    scrollTop: 48,
    height: 120,
    start: 0,
    end: 8,
  });
  assert.ok(incoming.start < incoming.end);

  const sameWorld = aspectListVirtualWindow({
    currentViewport: { scrollTop: 168, height: 120 },
    presentedWorldIdentity: "singleton",
    worldIdentity: "singleton",
    initialScrollTop: 48,
    rowCount: 20,
    rowHeight: 24,
    overscanRows: 2,
  });
  assert.equal(sameWorld.scrollTop, 168);
  assert.equal(sameWorld.start, 5);
});

test("a returning cached world is selected before an uncached fetch can replace it", () => {
  const comparisonPayload = { rows: ["comparison"] };
  const singletonPayload = { rows: ["singleton"] };
  const storedSingleton = {
    documentId: "chart-a",
    worldIdentity: "singleton",
    payload: singletonPayload,
    queryIdentity: "singleton-query",
    actionIdentity: "singleton-action",
  };

  const restored = selectRetainedAspectListPayloadState({
    storedState: storedSingleton,
    cachedPayload: comparisonPayload,
    documentId: "chart-a",
    worldIdentity: "comparison",
    queryIdentity: "comparison-query-2",
    actionIdentity: "comparison-action-2",
  });
  assert.strictEqual(restored.payload, comparisonPayload);
  assert.equal(restored.worldIdentity, "comparison");
  assert.equal(restored.queryIdentity, "comparison-query-2");
  assert.equal(restored.actionIdentity, "comparison-action-2");

  const uncached = selectRetainedAspectListPayloadState({
    storedState: storedSingleton,
    cachedPayload: null,
    documentId: "chart-a",
    worldIdentity: "unseen",
    queryIdentity: "unseen-query",
    actionIdentity: "unseen-action",
  });
  assert.strictEqual(uncached, storedSingleton);
});

test("only the successful current query generation enables row actions", () => {
  const successful = {
    documentId: "chart-a",
    queryIdentity: "generation-1",
    actionIdentity: "action-1",
  };
  assert.equal(
    isAspectListPayloadCurrent(successful, "chart-a", "generation-1", "action-1"),
    true,
  );
  assert.equal(
    isAspectListPayloadCurrent(successful, "chart-a", "generation-2", "action-1"),
    false,
  );
  assert.equal(
    isAspectListPayloadCurrent(successful, "chart-b", "generation-1", "action-1"),
    false,
  );
  assert.equal(
    isAspectListPayloadCurrent(successful, "chart-a", "generation-1", "action-2"),
    false,
  );
  assert.equal(
    isAspectListPayloadCurrent(null, "chart-a", "generation-1", "action-1"),
    false,
  );
});

test("perfection planning prioritizes the viewport and never exceeds daemon bounds", () => {
  const priorityRowIds = Array.from({ length: 10 }, (_, index) => `visible-${index}`);
  const backgroundRowIds = [
    "visible-0",
    ...Array.from({ length: 100 }, (_, index) => `background-${index}`),
  ];
  const batches = nextAspectListPerfectionBatches({
    priorityRowIds,
    backgroundRowIds,
    resolvedRowIds: new Set(["visible-1"]),
    pendingRowIds: new Set(["visible-2"]),
    failedRowIds: new Set(["visible-3"]),
    availableSlots: ASPECT_LIST_PERFECTION_CONCURRENCY,
  });

  assert.equal(batches.length, ASPECT_LIST_PERFECTION_CONCURRENCY);
  assert.ok(batches.every((batch) => batch.length <= ASPECT_LIST_PERFECTION_BATCH_SIZE));
  assert.deepEqual(batches[0].slice(0, 4), [
    "visible-0",
    "visible-4",
    "visible-5",
    "visible-6",
  ]);
  assert.equal(batches.flat().some((rowId) => rowId.startsWith("background-")), true);
  assert.equal(new Set(batches.flat()).size, batches.flat().length);
});

test("patch refresh retains only exact dates with the same row trajectory", () => {
  const retained = retainMatchingAspectListPerfections({
    previousRows: [
      { id: "planet", trajectoryKey: "same" },
      { id: "lot", trajectoryKey: "old-house-model" },
      { id: "removed", trajectoryKey: "gone" },
    ],
    nextRows: [
      { id: "planet", trajectoryKey: "same" },
      { id: "lot", trajectoryKey: "new-house-model" },
      { id: "new", trajectoryKey: "new" },
    ],
    previousByRow: new Map([
      ["planet", { rowId: "planet", exactJd: 1 }],
      ["lot", { rowId: "lot", exactJd: 2 }],
      ["removed", { rowId: "removed", exactJd: 3 }],
    ]),
  });

  assert.deepEqual([...retained.keys()], ["planet"]);
  assert.equal(retained.get("planet").exactJd, 1);
});

test("normal list planning requests only missing viewport rows", () => {
  const batches = nextAspectListPerfectionBatches({
    priorityRowIds: ["row-4", "row-5", "row-6"],
    backgroundRowIds: [],
    resolvedRowIds: new Set(["row-4"]),
    pendingRowIds: new Set(),
    failedRowIds: new Set(),
    availableSlots: 2,
  });
  assert.deepEqual(batches, [["row-5", "row-6"]]);
});

test("exact-sort background work progresses in bounded waves", () => {
  const rowIds = Array.from({ length: 50 }, (_, index) => `row-${index}`);
  const first = nextAspectListPerfectionBatches({
    priorityRowIds: rowIds.slice(32, 36),
    backgroundRowIds: rowIds,
    resolvedRowIds: new Set(),
    pendingRowIds: new Set(),
    failedRowIds: new Set(),
    availableSlots: 2,
  });
  assert.deepEqual(first[0].slice(0, 4), rowIds.slice(32, 36));
  assert.equal(first.flat().length, 16);

  const second = nextAspectListPerfectionBatches({
    priorityRowIds: rowIds.slice(32, 36),
    backgroundRowIds: rowIds,
    resolvedRowIds: new Set(first.flat()),
    pendingRowIds: new Set(),
    failedRowIds: new Set(),
    availableSlots: 2,
  });
  assert.equal(second.flat().length, 16);
  assert.ok(second.every((batch) => batch.length <= 16));
});
