// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useChartStyleEditorStore, type ChartStyleSyncStatus } from "../../stores/chart-style-editor-store";
import { createStyleLabDraftFromTheme, fetchStyleLabDraft, StyleLabApiError, type StyleLabDraft } from "./client";

/** Read the editor's bound draft. Only modified drafts survive a daemon
 * restart, and another window can retire one; the source theme's working copy
 * (parked, or reopened from the saved theme) is then the same binding.
 * Resolves to null when the reply belongs to another binding. */
export async function fetchBoundStyleDraft(draftId: string): Promise<StyleLabDraft | null> {
  const source = useChartStyleEditorStore.getState().remoteSourceThemeName;
  try {
    const draft = await fetchStyleLabDraft(draftId);
    return draft.id === draftId ? draft : null;
  } catch (error) {
    if (!(error instanceof StyleLabApiError && error.status === 404) || !source) throw error;
    const draft = await createStyleLabDraftFromTheme(source);
    return draft.sourceThemeName === source ? draft : null;
  }
}

/** Refresh the CAS revision without losing edits made since the last sync.
 * Call while holding the panel's write guard, after geometry has drained. */
export async function refreshStyleDraftForSave(conflictMessage: string) {
  const draftId = useChartStyleEditorStore.getState().remoteDraftId;
  if (!draftId) throw new StyleLabApiError(conflictMessage, 409);
  const draft = await fetchBoundStyleDraft(draftId);
  const state = useChartStyleEditorStore.getState();
  if (!draft || state.remoteDraftId !== draftId) {
    throw new StyleLabApiError(conflictMessage, 409);
  }
  state.acceptRemoteDraft(draft, { preserveLocalChanges: true });
  return useChartStyleEditorStore.getState();
}

export function canPersistStyleDraft(status: ChartStyleSyncStatus, revision: number | null) {
  return revision != null && status !== "connecting" && status !== "saving";
}
