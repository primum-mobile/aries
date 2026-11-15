// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { create } from "zustand";

import {
  resetWorkspaceSidebarHiddenActions,
  setWorkspaceSidebarActionsHidden,
  type WorkspaceManifest,
} from "@/lib/daemon/client";
import {
  currentWorkspaceManifest,
  publishWorkspaceManifest,
} from "@/stores/use-workspace-manifest";

// Sidebar launcher visibility (Edit Sidebar, design A2). The daemon owns which launchers
// are hidden and returns the manifest with `hidden` flags; this store only
// holds transient UI state (edit mode, the "Hidden · Undo" notice) and applies
// an optimistic projection so a toggle repaints immediately.

export type HiddenNotice = {
  sectionLabel: string;
  actionIds: string[];
  token: number;
};

type SidebarVisibilityState = {
  editing: boolean;
  notice: HiddenNotice | null;
  setEditing: (editing: boolean) => void;
  dismissNotice: (token?: number) => void;
};

export const useSidebarVisibilityStore = create<SidebarVisibilityState>()((set, get) => ({
  editing: false,
  notice: null,
  setEditing: (editing) => set({ editing, notice: editing ? null : get().notice }),
  dismissNotice: (token) => {
    const notice = get().notice;
    if (!notice || (token !== undefined && notice.token !== token)) return;
    set({ notice: null });
  },
}));

let noticeToken = 0;
// Requests run one at a time so the daemon applies toggles in click order and
// only the newest response replaces the optimistic manifest.
let queue: Promise<unknown> = Promise.resolve();
let latestRequest = 0;

function projectHidden(
  manifest: WorkspaceManifest,
  sectionLabel: string | null,
  actionIds: ReadonlySet<string> | null,
  hidden: boolean,
): WorkspaceManifest {
  return {
    ...manifest,
    groups: manifest.groups.map((group) => {
      if (sectionLabel !== null && group.label !== sectionLabel) return group;
      return {
        ...group,
        actions: group.actions.map((action) => {
          if (actionIds !== null && !actionIds.has(action.id)) return action;
          if (Boolean(action.hidden) === hidden) return action;
          const next = { ...action };
          if (hidden) next.hidden = true;
          else delete next.hidden;
          return next;
        }),
      };
    }),
  };
}

function runVisibilityRequest(
  optimistic: WorkspaceManifest,
  request: () => Promise<WorkspaceManifest>,
): Promise<void> {
  const previous = currentWorkspaceManifest();
  const requestId = ++latestRequest;
  publishWorkspaceManifest(optimistic);
  const run = queue.then(request).then(
    (manifest) => {
      if (requestId === latestRequest) publishWorkspaceManifest(manifest);
    },
    (err) => {
      console.error("[sidebar-visibility]", err);
      if (requestId === latestRequest) publishWorkspaceManifest(previous);
    },
  );
  queue = run;
  return run;
}

export function setSidebarLaunchersHidden(
  sectionLabel: string,
  actionIds: string[],
  hidden: boolean,
  options: { notice?: boolean } = {},
): Promise<void> {
  if (actionIds.length === 0) return Promise.resolve();
  const optimistic = projectHidden(
    currentWorkspaceManifest(),
    sectionLabel,
    new Set(actionIds),
    hidden,
  );
  if (options.notice && hidden) {
    useSidebarVisibilityStore.setState({
      notice: { sectionLabel, actionIds, token: ++noticeToken },
    });
  }
  return runVisibilityRequest(optimistic, () =>
    setWorkspaceSidebarActionsHidden(sectionLabel, actionIds, hidden),
  );
}

export function resetSidebarLaunchers(): Promise<void> {
  const optimistic = projectHidden(currentWorkspaceManifest(), null, null, false);
  return runVisibilityRequest(optimistic, () => resetWorkspaceSidebarHiddenActions());
}

export function undoHiddenNotice(notice: HiddenNotice): void {
  useSidebarVisibilityStore.getState().dismissNotice(notice.token);
  void setSidebarLaunchersHidden(notice.sectionLabel, notice.actionIds, false);
}
