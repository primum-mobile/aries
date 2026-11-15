// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DaemonWorkspaceState } from "@/stores/daemon-workspace-store";

type RefreshState = Pick<DaemonWorkspaceState,
  "lastSessionChange" | "lastOptionsChange" | "steppedSnapshot" | "commandSnapshot">;

/** Direct paired frames paint immediately. Events only recover external
 * changes or older responses without the visible peer payload. */
export function createSplitPeerRefreshGate(documentId: string, relatedDocumentIds: () => readonly string[] = () => [], viewSide?: "left" | "right") {
  let pendingStep = false;
  return (state: RefreshState, previous: RefreshState): boolean => {
    const direct = state.steppedSnapshot !== previous.steppedSnapshot
      ? state.steppedSnapshot?.snapshot : state.commandSnapshot !== previous.commandSnapshot
        ? state.commandSnapshot?.snapshot : undefined;
    if (direct && splitSnapshotForDocument(direct, documentId, viewSide)) {
      pendingStep = false;
      return false;
    }
    let refresh = false;
    const ids = [documentId, ...relatedDocumentIds()];
    const event = state.lastSessionChange;
    if (event !== previous.lastSessionChange && event &&
        (ids.includes(event.docId ?? "") || event.rebuiltChildIds.some((id) => ids.includes(id)))) {
      if (event.changeReason === "step") pendingStep = true;
      else refresh = true;
    }
    const options = state.lastOptionsChange;
    if (options !== previous.lastOptionsChange && options && !options.styleOnly &&
        (options.refreshedDocumentIds.length === 0 || options.refreshedDocumentIds.some((id) => ids.includes(id)))) refresh = true;
    const completedStep = state.steppedSnapshot !== previous.steppedSnapshot &&
      state.steppedSnapshot?.snapshot.overlayRenderMode === "full";
    const completedCommand = state.commandSnapshot !== previous.commandSnapshot &&
      state.commandSnapshot?.snapshot.overlayRenderMode === "full";
    if (pendingStep && (completedStep || completedCommand)) {
      pendingStep = false;
      refresh = true;
    }
    return refresh;
  };
}

/** Select a pane from the one authoritative visible frame, never from an older cache. */
export function splitSnapshotForDocument(
  snapshot: import("@/lib/chart/types").ChartRenderSnapshot,
  documentId: string | null,
  viewSide?: "left" | "right",
) {
  if (!documentId) return null;
  if (viewSide && snapshot.viewSide) {
    const pane = snapshot.viewSide === viewSide ? snapshot : snapshot.sideBySideSnapshotsBySide?.[viewSide];
    return pane?.document?.documentId === documentId ? pane : null;
  }
  return snapshot.document?.documentId === documentId ? snapshot
    : snapshot.sideBySideSnapshots?.[documentId] ?? null;
}
