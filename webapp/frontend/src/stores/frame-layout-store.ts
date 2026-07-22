// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Desktop IDE frame geometry. Collapse is a separate boolean state; width is only
// the remembered expanded width.
export const SIDEBAR_MIN_WIDTH = 148;
export const SIDEBAR_MAX_WIDTH = 520;
export const SIDEBAR_STARTUP_WIDTH = 272;
export const SIDEBAR_COLLAPSE_THRESHOLD = 96;
export const RIGHT_PANE_MIN_WIDTH = 300;
export const RIGHT_PANE_MAX_WIDTH = 760;
export const RIGHT_PANE_STARTUP_WIDTH = 360;
export const RIGHT_PANE_COLLAPSE_THRESHOLD = SIDEBAR_COLLAPSE_THRESHOLD;
const RIGHT_PANE_COMPACT_LIST_MIN_WIDTH = 360;
const RIGHT_PANE_DENSE_LIST_MIN_WIDTH = RIGHT_PANE_COMPACT_LIST_MIN_WIDTH;
const RIGHT_PANE_DIRECTIONS_MIN_WIDTH = 330;
const RIGHT_PANE_STANDARD_TABLE_MIN_WIDTH = RIGHT_PANE_COMPACT_LIST_MIN_WIDTH;
const RIGHT_PANE_TIME_LORD_LIST_MIN_WIDTH = RIGHT_PANE_COMPACT_LIST_MIN_WIDTH;

export type RightPaneModuleKind =
  | "hover-inspector"
  | "chart-style"
  | "notes"
  | "inspector-notes"
  | "transit-search"
  | "directions"
  | "zodiacal-releasing"
  | "firdaria"
  | "decennials"
  | "profections"
  | "eclipses"
  | "lunar-mansions"
  | "ascensional-transits"
  | "feature-catalog";

export type RightPaneModuleRole =
  | "hover-inspector"
  | "text-pane"
  | "dense-event-list"
  | "symbolic-directions-list"
  | "standard-inspector-table"
  | "time-lord-table";

export type RightPaneWidthPolicy = {
  kind: RightPaneModuleKind;
  role: RightPaneModuleRole;
  minContentWidth: number;
  preferredWidth: number;
  maxWidth: number;
  reclaimSidebar: boolean;
};

const RIGHT_PANE_WIDTH_POLICIES: Record<RightPaneModuleKind, RightPaneWidthPolicy> = {
  "hover-inspector": {
    kind: "hover-inspector",
    role: "hover-inspector",
    minContentWidth: 360,
    preferredWidth: 390,
    maxWidth: 560,
    reclaimSidebar: true,
  },
  "chart-style": {
    kind: "chart-style",
    role: "hover-inspector",
    minContentWidth: 360,
    preferredWidth: 390,
    maxWidth: 560,
    reclaimSidebar: true,
  },
  notes: {
    kind: "notes",
    role: "text-pane",
    minContentWidth: 360,
    preferredWidth: 420,
    maxWidth: 620,
    reclaimSidebar: true,
  },
  "inspector-notes": {
    kind: "inspector-notes",
    role: "text-pane",
    minContentWidth: 420,
    preferredWidth: 460,
    maxWidth: 640,
    reclaimSidebar: true,
  },
  "transit-search": {
    kind: "transit-search",
    role: "dense-event-list",
    minContentWidth: RIGHT_PANE_DENSE_LIST_MIN_WIDTH,
    preferredWidth: 640,
    maxWidth: 760,
    reclaimSidebar: true,
  },
  directions: {
    kind: "directions",
    role: "symbolic-directions-list",
    minContentWidth: RIGHT_PANE_DIRECTIONS_MIN_WIDTH,
    preferredWidth: 600,
    maxWidth: 760,
    reclaimSidebar: true,
  },
  "zodiacal-releasing": {
    kind: "zodiacal-releasing",
    role: "time-lord-table",
    minContentWidth: RIGHT_PANE_TIME_LORD_LIST_MIN_WIDTH,
    preferredWidth: 560,
    maxWidth: 720,
    reclaimSidebar: true,
  },
  firdaria: {
    kind: "firdaria",
    role: "time-lord-table",
    minContentWidth: RIGHT_PANE_TIME_LORD_LIST_MIN_WIDTH,
    preferredWidth: 520,
    maxWidth: 680,
    reclaimSidebar: true,
  },
  decennials: {
    kind: "decennials",
    role: "time-lord-table",
    minContentWidth: RIGHT_PANE_TIME_LORD_LIST_MIN_WIDTH,
    preferredWidth: 540,
    maxWidth: 700,
    reclaimSidebar: true,
  },
  profections: {
    kind: "profections",
    role: "time-lord-table",
    minContentWidth: RIGHT_PANE_TIME_LORD_LIST_MIN_WIDTH,
    preferredWidth: 540,
    maxWidth: 700,
    reclaimSidebar: true,
  },
  eclipses: {
    kind: "eclipses",
    role: "standard-inspector-table",
    minContentWidth: RIGHT_PANE_STANDARD_TABLE_MIN_WIDTH,
    preferredWidth: 640,
    maxWidth: 760,
    reclaimSidebar: true,
  },
  "lunar-mansions": {
    kind: "lunar-mansions",
    role: "standard-inspector-table",
    minContentWidth: RIGHT_PANE_STANDARD_TABLE_MIN_WIDTH,
    preferredWidth: 640,
    maxWidth: 760,
    reclaimSidebar: true,
  },
  "ascensional-transits": {
    kind: "ascensional-transits",
    role: "dense-event-list",
    minContentWidth: RIGHT_PANE_DENSE_LIST_MIN_WIDTH,
    preferredWidth: 520,
    maxWidth: 760,
    reclaimSidebar: true,
  },
  "feature-catalog": {
    kind: "feature-catalog",
    role: "text-pane",
    minContentWidth: 340,
    preferredWidth: 420,
    maxWidth: 620,
    reclaimSidebar: true,
  },
};

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_STARTUP_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
}

export function rightPaneWidthPolicy(kind: RightPaneModuleKind | null): RightPaneWidthPolicy {
  return kind ? RIGHT_PANE_WIDTH_POLICIES[kind] : RIGHT_PANE_WIDTH_POLICIES["hover-inspector"];
}

export function clampRightPaneWidth(
  width: number,
  policy?: Pick<RightPaneWidthPolicy, "minContentWidth" | "maxWidth">,
): number {
  if (!Number.isFinite(width)) return RIGHT_PANE_STARTUP_WIDTH;
  const minWidth = policy?.minContentWidth ?? RIGHT_PANE_MIN_WIDTH;
  const maxWidth = policy?.maxWidth ?? RIGHT_PANE_MAX_WIDTH;
  return Math.max(minWidth, Math.min(maxWidth, width));
}

export function rightPanePriorityLayout(
  sidebarOpen: boolean,
  sidebarWidth: number,
  rightPaneWidth: number,
  rightPaneKind: RightPaneModuleKind | null,
): { sidebarWidth: number; rightPaneWidth: number } {
  const savedSidebarWidth = clampSidebarWidth(sidebarWidth);
  if (!rightPaneKind) {
    return { sidebarWidth: savedSidebarWidth, rightPaneWidth: 0 };
  }

  const policy = rightPaneWidthPolicy(rightPaneKind);
  const savedRightPaneWidth = clampRightPaneWidth(rightPaneWidth, policy);
  const effectiveRightPaneWidth = Math.max(savedRightPaneWidth, policy.minContentWidth);
  if (!sidebarOpen) {
    return { sidebarWidth: 0, rightPaneWidth: savedRightPaneWidth };
  }
  if (!policy.reclaimSidebar) {
    return { sidebarWidth: savedSidebarWidth, rightPaneWidth: savedRightPaneWidth };
  }

  const reclaimableSidebarWidth = Math.max(0, savedSidebarWidth - SIDEBAR_MIN_WIDTH);
  return {
    sidebarWidth: savedSidebarWidth - Math.min(reclaimableSidebarWidth, effectiveRightPaneWidth),
    rightPaneWidth: effectiveRightPaneWidth,
  };
}

type FrameLayoutState = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarDragging: boolean;
  rightPaneWidth: number;
  rightPaneDragging: boolean;
  inspectorOpen: boolean;
  notesPaneOpen: boolean;
  styleEditorOpen: boolean;

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  resetSidebarWidth: () => void;
  setSidebarDragging: (dragging: boolean) => void;
  setRightPaneWidth: (width: number) => void;
  resetRightPaneWidth: () => void;
  setRightPaneDragging: (dragging: boolean) => void;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  setNotesPaneOpen: (open: boolean) => void;
  toggleNotesPane: () => void;
  setStyleEditorOpen: (open: boolean) => void;
  toggleStyleEditor: () => void;
};

function persistedBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function persistedNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export const useFrameLayoutStore = create<FrameLayoutState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: SIDEBAR_STARTUP_WIDTH,
      sidebarDragging: false,
      rightPaneWidth: RIGHT_PANE_STARTUP_WIDTH,
      rightPaneDragging: false,
      inspectorOpen: false,
      notesPaneOpen: false,
      styleEditorOpen: false,

      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      resetSidebarWidth: () => set({ sidebarWidth: SIDEBAR_STARTUP_WIDTH }),
      setSidebarDragging: (dragging) => set({ sidebarDragging: dragging }),
      setRightPaneWidth: (width) => set({ rightPaneWidth: clampRightPaneWidth(width) }),
      resetRightPaneWidth: () => set({ rightPaneWidth: RIGHT_PANE_STARTUP_WIDTH }),
      setRightPaneDragging: (dragging) => set({ rightPaneDragging: dragging }),
      setInspectorOpen: (open) => set({ inspectorOpen: open }),
      toggleInspector: () =>
        set((state) => {
          const open = !state.inspectorOpen;
          return { inspectorOpen: open };
        }),
      setNotesPaneOpen: (open) => set({ notesPaneOpen: open }),
      toggleNotesPane: () => set((state) => ({ notesPaneOpen: !state.notesPaneOpen })),
      setStyleEditorOpen: (open) => set({ styleEditorOpen: open }),
      toggleStyleEditor: () =>
        set((state) => ({ styleEditorOpen: !state.styleEditorOpen })),
    }),
    {
      name: "aries.frame-layout",
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        rightPaneWidth: state.rightPaneWidth,
        inspectorOpen: state.inspectorOpen,
        notesPaneOpen: state.notesPaneOpen,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<FrameLayoutState>;
        return {
          ...current,
          sidebarOpen: persistedBool(saved.sidebarOpen, current.sidebarOpen),
          sidebarWidth: clampSidebarWidth(
            persistedNumber(saved.sidebarWidth, current.sidebarWidth),
          ),
          rightPaneWidth: clampRightPaneWidth(
            persistedNumber(saved.rightPaneWidth, current.rightPaneWidth),
          ),
          inspectorOpen: persistedBool(saved.inspectorOpen, current.inspectorOpen),
          notesPaneOpen: persistedBool(saved.notesPaneOpen, current.notesPaneOpen),
        };
      },
    },
  ),
);
