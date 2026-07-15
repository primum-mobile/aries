// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

type WorkspaceSnapshot = ReturnType<typeof useWorkspaceStore.getState>;

function rightWorkspacePaneIsOpen(state: WorkspaceSnapshot): boolean {
  return (
    state.transitSearchPane !== null ||
    state.transitListPane !== null ||
    state.directionsPane !== null ||
    state.timeLordPane !== null ||
    state.zodiacalReleasingPane !== null ||
    state.firdariaPane !== null ||
    state.decennialsPane !== null ||
    state.profectionsPane !== null ||
    state.eclipsesPane !== null ||
    state.lunarMansionsPane !== null ||
    state.synodicCyclesPane !== null ||
    state.ascensionalTransitsPane !== null
  );
}

export function closeInspectorAndNotes(): boolean {
  const frame = useFrameLayoutStore.getState();
  const hadOpenPane = frame.inspectorOpen || frame.notesPaneOpen;
  if (!hadOpenPane) return false;
  frame.setInspectorOpen(false);
  frame.setNotesPaneOpen(false);
  return true;
}

export function closeWorkspaceTransientPanes(): boolean {
  const frame = useFrameLayoutStore.getState();
  const workspace = useWorkspaceStore.getState();
  const hadOpenPane =
    frame.inspectorOpen ||
    frame.notesPaneOpen ||
    rightWorkspacePaneIsOpen(workspace);

  if (!hadOpenPane) return false;

  workspace.closeAllRightPanes();
  frame.setInspectorOpen(false);
  frame.setNotesPaneOpen(false);
  return true;
}
