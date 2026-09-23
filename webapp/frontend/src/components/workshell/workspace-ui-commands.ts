// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { RIGHT_PANE_KEYS, useWorkspaceStore } from "@/stores/workspace-store";

type WorkspaceSnapshot = ReturnType<typeof useWorkspaceStore.getState>;

function rightWorkspacePaneIsOpen(state: WorkspaceSnapshot): boolean {
  return RIGHT_PANE_KEYS.some((key) => state[key] !== null);
}

export function closeInspectorAndNotes(): boolean {
  const frame = useFrameLayoutStore.getState();
  const hadOpenPane = frame.inspectorOpen || frame.notesPaneOpen || frame.styleEditorOpen;
  if (!hadOpenPane) return false;
  frame.setInspectorOpen(false);
  frame.setNotesPaneOpen(false);
  frame.setStyleEditorOpen(false);
  return true;
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
