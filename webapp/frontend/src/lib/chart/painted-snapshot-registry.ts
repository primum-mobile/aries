// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChartRenderSnapshot } from "@/lib/chart/types";
import { sameCanvasRenderState } from "@/lib/chart/snapshot-render-equivalence";

// Exact-object acknowledgement for snapshots that reached a successful Canvas
// render. Weak keys keep this proof generation-specific without retaining old
// document frames or adding IDs/state to the daemon payload.
const paintedDocumentSnapshots = new WeakMap<ChartRenderSnapshot, string>();

export function acknowledgePaintedDocumentSnapshot(
  docId: string | null | undefined,
  snapshot: ChartRenderSnapshot,
): void {
  if (docId) paintedDocumentSnapshots.set(snapshot, docId);
}

export function wasDocumentSnapshotPainted(
  docId: string,
  snapshot: ChartRenderSnapshot | null,
): boolean {
  return snapshot !== null && paintedDocumentSnapshots.get(snapshot) === docId;
}

export function canReusePaintedDocumentCanvas(
  docId: string,
  current: ChartRenderSnapshot | null,
  next: ChartRenderSnapshot,
): boolean {
  return (
    wasDocumentSnapshotPainted(docId, current) &&
    sameCanvasRenderState(current, next)
  );
}
