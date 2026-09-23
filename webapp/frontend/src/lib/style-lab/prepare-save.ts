// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useChartStyleEditorStore, type ChartStyleSyncStatus } from "../../stores/chart-style-editor-store";
import { fetchCurrentStyleLabDraft, StyleLabApiError } from "./client";

/** Refresh the CAS revision without losing edits made since the last sync.
 * Call while holding the panel's write guard, after geometry has drained. */
export async function refreshStyleDraftForSave(conflictMessage: string) {
  const draftId = useChartStyleEditorStore.getState().remoteDraftId;
  const draft = await fetchCurrentStyleLabDraft();
  const state = useChartStyleEditorStore.getState();
  if (draft.id !== draftId || state.remoteDraftId !== draftId) {
    throw new StyleLabApiError(conflictMessage, 409);
  }
  state.acceptRemoteDraft(draft, { preserveLocalChanges: true });
  return useChartStyleEditorStore.getState();
}

export function canPersistStyleDraft(status: ChartStyleSyncStatus, revision: number | null) {
  return revision != null && status !== "connecting" && status !== "saving";
}
