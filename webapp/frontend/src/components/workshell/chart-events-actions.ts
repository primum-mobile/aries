// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { executeWorkspaceContextMenuAction, type WorkspaceOpenResult } from "@/lib/daemon/client";
import { applyImmediateWorkspaceCommandResult } from "@/stores/daemon-workspace-adapter";
import { useChartEventsStore } from "@/stores/chart-events-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";

/** Tab actions consume the daemon's owner, never a picker. */
export async function handleChartEventsMenuAction(actionId: string, payload?: Record<string, unknown>) {
  if (!["workspace.show_events", "workspace.save_event", "workspace.open_event"].includes(actionId)) return false;
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
      cache.patch(documentId, { error: null });
      cache.invalidate([documentId]);
      return true;
    } catch (error) {
      console.error("[chart-events-save]", error);
      cache.patch(documentId, { error: "chartEvents.saveError" });
    }
  }
  const frame = useFrameLayoutStore.getState();
  frame.setInspectorOpen(false);
  frame.setNotesPaneOpen(false);
  frame.setStyleEditorOpen(false);
  useWorkspaceStore.getState().openChartEventsPane({ documentId });
  return true;
}
