// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { executeWorkspaceContextMenuAction, type WorkspaceOpenResult } from "@/lib/daemon/client";
import { applyImmediateWorkspaceCommandResult } from "@/stores/daemon-workspace-adapter";
import { useChartEventsStore } from "@/stores/chart-events-store";
import { useChartEventSearchStore } from "@/stores/chart-event-search-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

/** Tab actions consume the daemon's owner, never a picker. */
export async function handleChartEventsMenuAction(actionId: string, payload?: Record<string, unknown>) {
  if (!["workspace.show_events", "workspace.save_event", "workspace.open_event", "workspace.paste_event"].includes(actionId)) return false;
  let documentId = String(payload?.ownerDocumentId ?? payload?.documentId ?? "");
  if (!documentId) return true;
  const cache = useChartEventsStore.getState();
  if (actionId === "workspace.open_event") {
    try {
      const result = await executeWorkspaceContextMenuAction(actionId, payload);
      applyImmediateWorkspaceCommandResult(result as unknown as WorkspaceOpenResult, documentId);
      return true;
    } catch (error) {
      console.error("[chart-events-open]", error);
      cache.patch(documentId, { error: "chartEvents.openError" });
    }
  }
  if (actionId === "workspace.save_event") {
    try {
      const result = await executeWorkspaceContextMenuAction(actionId, payload);
      documentId = String(result.ownerDocumentId);
      // The event is saved under its automatic name; the pane opens on it
      // with that name selected for renaming (Enter keeps, Escape accepts).
      cache.patch(documentId, { error: null, renameEventId: String(result.eventId ?? "") || null });
      cache.invalidate([documentId]);
    } catch (error) {
      console.error("[chart-events-save]", error);
      cache.patch(documentId, { error: "chartEvents.saveError" });
    }
  }
  if (actionId === "workspace.paste_event") {
    try {
      const result = await executeWorkspaceContextMenuAction(actionId, payload);
      documentId = String(result.ownerDocumentId);
      cache.patch(documentId, { error: null });
      cache.invalidate([documentId]);
    } catch (error) {
      console.error("[chart-events-paste]", error);
      cache.patch(documentId, { error: "chartEvents.pasteError" });
    }
  }
  if (payload?.search === true) useChartEventSearchStore.getState().patch(documentId, { open: true });
  useWorkspaceStore.getState().openChartEventsPane({ documentId });
  return true;
}
