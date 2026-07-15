// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fetchDocumentSnapshot } from "@/lib/daemon/client";
import type {
  Chart,
  ChartRenderSnapshot,
  OverlayInfoRow,
  OverlayRenderMode,
} from "@/lib/chart/types";

const documentSnapshotCache = new Map<string, ChartRenderSnapshot>();
const documentSnapshotInflight = new Map<string, Promise<ChartRenderSnapshot>>();
let documentSnapshotEpoch = 0;

export function rememberDocumentSnapshot(
  docId: string,
  snapshot: ChartRenderSnapshot,
): ChartRenderSnapshot {
  const previous = documentSnapshotCache.get(docId);
  const retained = retainStableOverlayRows(previous, snapshot);
  // Several callers push the same object into React state immediately after
  // remembering it. Mutate the fetched object at the top level so those callers
  // see the retained overlay without each one needing bespoke merge plumbing.
  if (retained !== snapshot) {
    Object.assign(snapshot, retained);
  }
  documentSnapshotCache.set(docId, snapshot);
  return snapshot;
}

export function getDocumentSnapshot(docId: string): ChartRenderSnapshot | undefined {
  return documentSnapshotCache.get(docId);
}

export function retainDocumentSnapshots(docIds: Iterable<string>): void {
  const liveIds = new Set(docIds);
  for (const docId of Array.from(documentSnapshotCache.keys())) {
    if (!liveIds.has(docId)) {
      documentSnapshotCache.delete(docId);
    }
  }
  for (const docId of Array.from(documentSnapshotInflight.keys())) {
    if (!liveIds.has(docId)) {
      documentSnapshotInflight.delete(docId);
    }
  }
}

export function invalidateDocumentSnapshots(docIds?: Iterable<string>): void {
  documentSnapshotEpoch += 1;
  if (docIds === undefined) {
    documentSnapshotCache.clear();
    documentSnapshotInflight.clear();
    return;
  }
  for (const docId of docIds) {
    documentSnapshotCache.delete(docId);
    documentSnapshotInflight.delete(docId);
  }
}

export function fetchCachedDocumentSnapshot(docId: string): Promise<ChartRenderSnapshot> {
  const inflight = documentSnapshotInflight.get(docId);
  if (inflight) return inflight;
  const requestEpoch = documentSnapshotEpoch;
  const request = fetchDocumentSnapshot(docId)
    .then((snapshot) => {
      if (requestEpoch === documentSnapshotEpoch) {
        return rememberDocumentSnapshot(docId, snapshot);
      }
      return snapshot;
    })
    .finally(() => {
      if (documentSnapshotInflight.get(docId) === request) {
        documentSnapshotInflight.delete(docId);
      }
    });
  documentSnapshotInflight.set(docId, request);
  return request;
}

function retainStableOverlayRows(
  previous: ChartRenderSnapshot | undefined,
  next: ChartRenderSnapshot,
): ChartRenderSnapshot {
  if (!previous || next.overlayRenderMode === "full") {
    return next;
  }

  let changed = false;
  const primaryChart = retainChartOverlayRows(
    previous.primaryChart,
    next.primaryChart,
    next.overlayRenderMode,
  );
  changed ||= primaryChart !== next.primaryChart;

  const comparisonChart = retainNullableChartOverlayRows(
    previous.comparisonChart,
    next.comparisonChart,
    next.overlayRenderMode,
  );
  changed ||= comparisonChart !== next.comparisonChart;

  const radixChart = retainNullableChartOverlayRows(
    previous.radixChart,
    next.radixChart,
    next.overlayRenderMode,
  );
  changed ||= radixChart !== next.radixChart;

  const displayAnchorChart = retainNullableChartOverlayRows(
    previous.displayAnchorChart,
    next.displayAnchorChart,
    next.overlayRenderMode,
  );
  changed ||= displayAnchorChart !== next.displayAnchorChart;

  if (!changed) {
    return next;
  }

  return {
    ...next,
    primaryChart,
    comparisonChart,
    radixChart,
    displayAnchorChart,
  };
}

function retainNullableChartOverlayRows(
  previous: Chart | null | undefined,
  next: Chart | null | undefined,
  mode: OverlayRenderMode,
): Chart | null | undefined {
  if (!previous || !next) {
    return next;
  }
  return retainChartOverlayRows(previous, next, mode);
}

function retainChartOverlayRows(
  previous: Chart,
  next: Chart,
  mode: OverlayRenderMode,
): Chart {
  if (!previous.overlay || !next.overlay || !sameOverlayHost(previous, next)) {
    return next;
  }
  const rows = retainOverlayRows(previous.overlay.rows, next.overlay.rows, mode);
  if (rows === next.overlay.rows) {
    return next;
  }
  return {
    ...next,
    overlay: {
      ...next.overlay,
      rows,
    },
  };
}

function sameOverlayHost(previous: Chart, next: Chart): boolean {
  return previous.meta.kind === next.meta.kind && previous.meta.name === next.meta.name;
}

function retainOverlayRows(
  previousRows: OverlayInfoRow[],
  nextRows: OverlayInfoRow[],
  mode: OverlayRenderMode,
): OverlayInfoRow[] {
  const retainedGroups = retainedOverlayGroups(mode);
  if (retainedGroups.size === 0 || previousRows.length === 0) {
    return nextRows;
  }

  const merged: OverlayInfoRow[] = [];
  const seen = new Set<string>();
  let changed = false;
  for (const group of ["dayhour", "header", "signal"] as const) {
    const currentGroupRows = nextRows.filter((row) => row.group === group);
    if (!retainedGroups.has(group)) {
      changed = appendOverlayRows(merged, currentGroupRows, seen) || changed;
      continue;
    }

    const previousGroupRows = previousRows.filter(
      (row) => row.group === group && shouldRetainPreviousOverlayRow(row, mode),
    );
    if (previousGroupRows.length === 0) {
      changed = appendOverlayRows(merged, currentGroupRows, seen) || changed;
      continue;
    }

    const currentQueues = overlayRowQueues(currentGroupRows);
    const consumed = new WeakSet<OverlayInfoRow>();
    for (const previousRow of previousGroupRows) {
      const identity = overlayRowRetentionKey(previousRow);
      const queue = currentQueues.get(identity);
      const currentRow = queue?.shift();
      if (currentRow) {
        consumed.add(currentRow);
        changed = appendOverlayRow(merged, currentRow, seen) || changed;
      } else {
        changed = true;
        changed = appendOverlayRow(merged, previousRow, seen) || changed;
      }
    }
    for (const currentRow of currentGroupRows) {
      if (!consumed.has(currentRow)) {
        changed = appendOverlayRow(merged, currentRow, seen) || changed;
      }
    }
  }

  const ungroupedRows = nextRows.filter((row) => row.group == null);
  if (ungroupedRows.length) {
    changed = appendOverlayRows(merged, ungroupedRows, seen) || changed;
  }

  if (!changed && merged.length === nextRows.length) {
    return nextRows;
  }
  return merged;
}

function shouldRetainPreviousOverlayRow(
  row: OverlayInfoRow,
  mode: OverlayRenderMode,
): boolean {
  if (mode === "deferred" && row.group === "signal") {
    return !isStationSignalRow(row);
  }
  return true;
}

function isStationSignalRow(row: OverlayInfoRow): boolean {
  return row.group === "signal" && (
    row.label === "Retro station" || row.label === "Direct station"
  );
}

function appendOverlayRows(
  target: OverlayInfoRow[],
  rows: OverlayInfoRow[],
  seen: Set<string>,
): boolean {
  let skipped = false;
  for (const row of rows) {
    skipped = appendOverlayRow(target, row, seen) || skipped;
  }
  return skipped;
}

function appendOverlayRow(
  target: OverlayInfoRow[],
  row: OverlayInfoRow,
  seen: Set<string>,
): boolean {
  const identity = overlayRowRetentionKey(row);
  if (seen.has(identity)) {
    return true;
  }
  seen.add(identity);
  target.push(row);
  return false;
}

function retainedOverlayGroups(mode: OverlayRenderMode): Set<OverlayInfoRow["group"]> {
  if (mode === "step_fast") {
    return new Set(["header", "signal"]);
  }
  if (mode === "deferred") {
    return new Set(["signal"]);
  }
  return new Set();
}

function overlayRowQueues(rows: OverlayInfoRow[]): Map<string, OverlayInfoRow[]> {
  const queues = new Map<string, OverlayInfoRow[]>();
  for (const row of rows) {
    const identity = overlayRowRetentionKey(row);
    const queue = queues.get(identity);
    if (queue) {
      queue.push(row);
    } else {
      queues.set(identity, [row]);
    }
  }
  return queues;
}

// Merge/dedup key for the retention pass. Header rows ("Term lord", "Lord of
// the year") are singleton slots per LABEL: their lord glyphs legitimately
// change while the time cursor steps across a profection-year boundary, and
// keying the merge on full glyph identity would retain the outgoing lord's row
// next to the incoming one — a duplicated "Lord of the year" during step
// bursts. An incoming header row therefore always replaces the retained row
// with the same label. All other groups keep full identity: signal rows repeat
// a label across planets (e.g. several Phasis rows) and must not collapse.
function overlayRowRetentionKey(row: OverlayInfoRow): string {
  if (row.group === "header") {
    return `header:${row.label}`;
  }
  return overlayRowIdentity(row);
}

function overlayRowIdentity(row: OverlayInfoRow): string {
  const glyphs = row.glyphs
    .map((glyph) => `${glyph.kind ?? ""}:${glyph.seId ?? ""}:${glyph.char}`)
    .join("|");
  return `${row.group ?? "row"}:${row.label}:${glyphs}`;
}
