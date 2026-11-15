// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrameLayoutStore, type NotesFocusRequest } from "@/stores/frame-layout-store";
import { RIGHT_PANE_KEYS, useWorkspaceStore } from "@/stores/workspace-store";

type WorkspaceSnapshot = ReturnType<typeof useWorkspaceStore.getState>;

function rightWorkspacePaneIsOpen(state: WorkspaceSnapshot): boolean {
  return RIGHT_PANE_KEYS.some((key) => state[key] !== null);
}

export function toggleWorkspaceNotes(focusRequest?: NotesFocusRequest): void {
  useWorkspaceStore.getState().closeAllRightPanes();
  const open = !useFrameLayoutStore.getState().notesPaneOpen;
  useFrameLayoutStore.setState({
    notesPaneOpen: open,
    notesFocusRequest: open ? focusRequest ?? null : null,
  });
}

/** Restore closed content or toggle Inspector; never select Chart Style Lab. */
export function toggleWorkspaceInspector(): void {
  const workspace = useWorkspaceStore.getState();
  if (workspace.reopenRightPane({ skipStyleEditor: true })) return;
  workspace.closeAllRightPanes();
  const frame = useFrameLayoutStore.getState();
  useFrameLayoutStore.setState({
    inspectorOpen: frame.styleEditorOpen || !frame.inspectorOpen,
    styleEditorOpen: false,
  });
}

/** Suspend frame chrome when another pane takes over. */
export function closeInspectorAndNotes(): boolean {
  return useWorkspaceStore.getState().suspendFramePanes();
}

export function closeWorkspaceTransientPanes(): boolean {
  const frame = useFrameLayoutStore.getState();
  const workspace = useWorkspaceStore.getState();
  const hadOpenPane =
    frame.inspectorOpen ||
    frame.notesPaneOpen ||
    frame.styleEditorOpen ||
    rightWorkspacePaneIsOpen(workspace);

  if (!hadOpenPane) return false;

  workspace.closeAllRightPanes();
  frame.setInspectorOpen(false);
  frame.setNotesPaneOpen(false);
  frame.setStyleEditorOpen(false);
  return true;
}
