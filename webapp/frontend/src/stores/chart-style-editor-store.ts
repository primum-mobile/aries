// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

import type { StyleSceneElement } from "@/lib/style-lab/style-scene";
import {
  styleLabDraftEditorOverrides,
  type StyleLabDraft,
  type StyleLabScalarValue,
  type StyleLabTokenValue,
} from "@/lib/style-lab/client";

export type ChartStyleSyncStatus =
  | "connecting"
  | "synced"
  | "saving"
  | "local"
  | "conflict"
  | "error";

export type ChartStyleAuthoringEditScope = "base" | "variant";
export type StyleEditorDomain = "chart" | "app";

export type ChartStyleTokenBounds = Readonly<{
  min: number;
  max: number;
  step: number;
}>;

export type ChartStyleTokenMetadata = Readonly<{
  semanticId: string;
  cssVar: string;
  label: string;
  description: string;
  type: "color" | "number" | "font-family";
  unit: string;
  defaultValue: StyleLabTokenValue;
  bounds?: ChartStyleTokenBounds;
  supportsAlpha?: boolean;
}>;

export type ChartStyleSemanticOverrides = Record<string, StyleLabTokenValue>;
export type ChartStyleCssOverrides = Record<string, string>;
export type ChartStyleLabBaseTheme = Readonly<{
  sourceThemeName: string | null;
  mode: "light" | "dark";
  appTokens: Readonly<Record<string, string>>;
  chartPalette: Readonly<Record<string, string>>;
  appAuthoring: Readonly<Record<string, StyleLabScalarValue>>;
}>;

const HISTORY_LIMIT = 80;

function cloneValue(value: StyleLabTokenValue): StyleLabTokenValue {
  return Array.isArray(value) ? [...value] : value;
}

export function cloneChartStyleOverrides(
  overrides: Readonly<ChartStyleSemanticOverrides>,
): ChartStyleSemanticOverrides {
  return Object.fromEntries(
    Object.entries(overrides).map(([semanticId, value]) => [semanticId, cloneValue(value)]),
  );
}

function sameValue(
  left: StyleLabTokenValue | undefined,
  right: StyleLabTokenValue | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function equalChartStyleOverrides(
  left: Readonly<ChartStyleSemanticOverrides>,
  right: Readonly<ChartStyleSemanticOverrides>,
): boolean {
  const semanticIds = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...semanticIds].every((semanticId) => sameValue(left[semanticId], right[semanticId]));
}

function formatCssValue(value: StyleLabTokenValue, unit: string): string {
  if (Array.isArray(value)) {
    const red = Number(value[0] ?? 0);
    const green = Number(value[1] ?? 0);
    const blue = Number(value[2] ?? 0);
    if (value.length > 3) {
      return `rgb(${red} ${green} ${blue} / ${Math.max(0, Math.min(1, Number(value[3]))) * 100}%)`;
    }
    return `rgb(${red} ${green} ${blue})`;
  }
  return typeof value === "number" ? `${value}${unit}` : String(value);
}

function buildCssOverrides(
  overrides: Readonly<ChartStyleSemanticOverrides>,
  metadata: Readonly<Record<string, ChartStyleTokenMetadata>>,
): ChartStyleCssOverrides {
  const cssOverrides: ChartStyleCssOverrides = {};
  for (const [semanticId, value] of Object.entries(overrides)) {
    const token = metadata[semanticId];
    if (!token) continue;
    cssOverrides[token.cssVar] = formatCssValue(value, token.unit);
  }
  return cssOverrides;
}

function metadataIndex(tokens: readonly ChartStyleTokenMetadata[]) {
  return Object.fromEntries(tokens.map((token) => [token.semanticId, token]));
}

function boundsIndex(tokens: readonly ChartStyleTokenMetadata[]) {
  return Object.fromEntries(
    tokens.flatMap((token) => token.bounds ? [[token.semanticId, token.bounds] as const] : []),
  );
}

export type ChartStyleEditorState = {
  active: boolean;
  liveAppThemePreview: boolean;
  hoveredElement: StyleSceneElement | null;
  selectedElement: StyleSceneElement | null;
  sceneElements: readonly StyleSceneElement[];
  activePropertyId: string | null;
  authoringEditScope: ChartStyleAuthoringEditScope;
  editorDomain: StyleEditorDomain;

  semanticOverrides: ChartStyleSemanticOverrides;
  cssOverrides: ChartStyleCssOverrides;
  syncedOverrides: ChartStyleSemanticOverrides;
  tokenMetadata: Record<string, ChartStyleTokenMetadata>;
  tokenBounds: Record<string, ChartStyleTokenBounds>;
  revision: number;
  undoStack: ChartStyleSemanticOverrides[];
  redoStack: ChartStyleSemanticOverrides[];
  gestureStart: ChartStyleSemanticOverrides | null;

  syncStatus: ChartStyleSyncStatus;
  syncDetail: string | null;
  remoteRevision: number | null;
  remoteEtag: string | null;
  remoteDraftId: string | null;
  remoteSourceThemeName: string | null;
  remoteModifiedFromBaseline: boolean;
  styleLabBaseTheme: ChartStyleLabBaseTheme;

  setActive: (active: boolean) => void;
  setLiveAppThemePreview: (active: boolean) => void;
  setHoveredElement: (element: StyleSceneElement | null) => void;
  selectElement: (element: StyleSceneElement | null) => void;
  setSceneElements: (elements: readonly StyleSceneElement[]) => void;
  setActiveProperty: (semanticId: string | null) => void;
  setAuthoringEditScope: (scope: ChartStyleAuthoringEditScope) => void;
  setEditorDomain: (domain: StyleEditorDomain) => void;
  clearSelection: () => void;
  setTokenMetadata: (tokens: readonly ChartStyleTokenMetadata[]) => void;

  beginGesture: () => void;
  setOverride: (semanticId: string, value: StyleLabTokenValue) => void;
  endGesture: () => void;
  cancelGesture: () => void;
  resetProperty: (semanticId: string) => void;
  resetProperties: (semanticIds: readonly string[]) => void;
  applyOverrides: (
    patch: Readonly<Record<string, StyleLabTokenValue | null>>,
  ) => void;
  resetAll: () => void;
  undo: () => void;
  redo: () => void;

  replaceOverrides: (
    overrides: Readonly<ChartStyleSemanticOverrides>,
    options?: Readonly<{ clearHistory?: boolean }>,
  ) => void;
  setSyncedOverrides: (overrides: Readonly<ChartStyleSemanticOverrides>) => void;
  acceptRemoteDraft: (
    draft: StyleLabDraft,
    options?: Readonly<{ preserveLocalChanges?: boolean; clearHistory?: boolean }>,
  ) => void;
  setSyncStatus: (status: ChartStyleSyncStatus, detail?: string | null) => void;
  setRemoteDraftMeta: (
    revision: number | null,
    etag: string | null,
    draftId?: string | null,
  ) => void;
  setStyleLabBaseTheme: (theme: ChartStyleLabBaseTheme) => void;
  markSynced: (draft: StyleLabDraft, overrides?: Readonly<ChartStyleSemanticOverrides>) => void;
};

export const useChartStyleEditorStore = create<ChartStyleEditorState>()((set, get) => ({
  active: false,
  liveAppThemePreview: false,
  hoveredElement: null,
  selectedElement: null,
  sceneElements: [],
  activePropertyId: null,
  authoringEditScope: "variant",
  editorDomain: "chart",

  semanticOverrides: {},
  cssOverrides: {},
  syncedOverrides: {},
  tokenMetadata: {},
  tokenBounds: {},
  revision: 0,
  undoStack: [],
  redoStack: [],
  gestureStart: null,

  syncStatus: "connecting",
  syncDetail: null,
  remoteRevision: null,
  remoteEtag: null,
  remoteDraftId: null,
  remoteSourceThemeName: null,
  remoteModifiedFromBaseline: false,
  styleLabBaseTheme: {
    sourceThemeName: null,
    mode: "dark",
    appTokens: {},
    chartPalette: {},
    appAuthoring: {},
  },

  setActive: (active) => set((state) => ({
    active,
    hoveredElement: active ? state.hoveredElement : null,
    selectedElement: active ? state.selectedElement : null,
    sceneElements: active ? state.sceneElements : [],
    activePropertyId: active ? state.activePropertyId : null,
    gestureStart: active ? state.gestureStart : null,
  })),
  setLiveAppThemePreview: (liveAppThemePreview) => set({ liveAppThemePreview }),
  setHoveredElement: (hoveredElement) => set({ hoveredElement }),
  selectElement: (selectedElement) => {
    const defaultBinding = selectedElement && (
      selectedElement.primitive === "line" || selectedElement.primitive === "circle"
    )
      ? selectedElement.tokenBindings.find((binding) => binding.property === "stroke-width") ??
        selectedElement.tokenBindings[0]
      : selectedElement?.tokenBindings[0];
    set({
      selectedElement,
      activePropertyId: defaultBinding?.semanticId ?? null,
    });
  },
  setSceneElements: (sceneElements) => set((state) => {
    const selectedElement = state.selectedElement
      ? sceneElements.find((element) => element.id === state.selectedElement?.id) ?? null
      : null;
    const hoveredElement = state.hoveredElement
      ? sceneElements.find((element) => element.id === state.hoveredElement?.id) ?? null
      : null;
    return { sceneElements, selectedElement, hoveredElement };
  }),
  setActiveProperty: (activePropertyId) => set({ activePropertyId }),
  setAuthoringEditScope: (authoringEditScope) => set((state) => (
    state.authoringEditScope === authoringEditScope
      ? state
      : { authoringEditScope, revision: state.revision + 1 }
  )),
  setEditorDomain: (editorDomain) => set({ editorDomain }),
  clearSelection: () => set({ selectedElement: null, activePropertyId: null }),
  setTokenMetadata: (tokens) => set((state) => {
    const tokenMetadata = metadataIndex(tokens);
    return {
      tokenMetadata,
      tokenBounds: boundsIndex(tokens),
      cssOverrides: buildCssOverrides(state.semanticOverrides, tokenMetadata),
    };
  }),

  beginGesture: () => set((state) => ({
    gestureStart: state.gestureStart ?? cloneChartStyleOverrides(state.semanticOverrides),
  })),
  setOverride: (semanticId, value) => set((state) => {
    if (sameValue(state.semanticOverrides[semanticId], value)) return state;
    const semanticOverrides = {
      ...state.semanticOverrides,
      [semanticId]: cloneValue(value),
    };
    return {
      semanticOverrides,
      cssOverrides: buildCssOverrides(semanticOverrides, state.tokenMetadata),
      revision: state.revision + 1,
      activePropertyId: semanticId,
    };
  }),
  endGesture: () => set((state) => {
    if (!state.gestureStart) return state;
    if (equalChartStyleOverrides(state.gestureStart, state.semanticOverrides)) {
      return { gestureStart: null };
    }
    return {
      undoStack: [...state.undoStack.slice(-(HISTORY_LIMIT - 1)), state.gestureStart],
      redoStack: [],
      gestureStart: null,
    };
  }),
  cancelGesture: () => set((state) => {
    if (!state.gestureStart) return state;
    const semanticOverrides = cloneChartStyleOverrides(state.gestureStart);
    return {
      semanticOverrides,
      cssOverrides: buildCssOverrides(semanticOverrides, state.tokenMetadata),
      gestureStart: null,
      revision: state.revision + 1,
    };
  }),
  resetProperty: (semanticId) => set((state) => {
    if (!Object.hasOwn(state.semanticOverrides, semanticId)) return state;
    const before = cloneChartStyleOverrides(state.semanticOverrides);
    const semanticOverrides = cloneChartStyleOverrides(state.semanticOverrides);
    delete semanticOverrides[semanticId];
    return {
      semanticOverrides,
      cssOverrides: buildCssOverrides(semanticOverrides, state.tokenMetadata),
      undoStack: [...state.undoStack.slice(-(HISTORY_LIMIT - 1)), before],
      redoStack: [],
      gestureStart: null,
      revision: state.revision + 1,
      activePropertyId: semanticId,
    };
  }),
  resetProperties: (semanticIds) => set((state) => {
    const resetIds = [...new Set(semanticIds)].filter((semanticId) =>
      Object.hasOwn(state.semanticOverrides, semanticId)
    );
    if (!resetIds.length) return state;
    const before = cloneChartStyleOverrides(state.semanticOverrides);
    const semanticOverrides = cloneChartStyleOverrides(state.semanticOverrides);
    for (const semanticId of resetIds) delete semanticOverrides[semanticId];
    return {
      semanticOverrides,
      cssOverrides: buildCssOverrides(semanticOverrides, state.tokenMetadata),
      undoStack: [...state.undoStack.slice(-(HISTORY_LIMIT - 1)), before],
      redoStack: [],
      gestureStart: null,
      revision: state.revision + 1,
      activePropertyId: resetIds[0] ?? state.activePropertyId,
    };
  }),
  applyOverrides: (patch) => set((state) => {
    const semanticOverrides = cloneChartStyleOverrides(state.semanticOverrides);
    const changedIds: string[] = [];
    for (const [semanticId, value] of Object.entries(patch)) {
      if (value === null) {
        if (!Object.hasOwn(semanticOverrides, semanticId)) continue;
        delete semanticOverrides[semanticId];
      } else {
        if (sameValue(semanticOverrides[semanticId], value)) continue;
        semanticOverrides[semanticId] = cloneValue(value);
      }
      changedIds.push(semanticId);
    }
    if (!changedIds.length) return state;
    return {
      semanticOverrides,
      cssOverrides: buildCssOverrides(semanticOverrides, state.tokenMetadata),
      undoStack: [
        ...state.undoStack.slice(-(HISTORY_LIMIT - 1)),
        cloneChartStyleOverrides(state.semanticOverrides),
      ],
      redoStack: [],
      gestureStart: null,
      revision: state.revision + 1,
      activePropertyId: changedIds[0] ?? state.activePropertyId,
    };
  }),
  resetAll: () => set((state) => {
    if (!Object.keys(state.semanticOverrides).length) return state;
    return {
      semanticOverrides: {},
      cssOverrides: {},
      undoStack: [
        ...state.undoStack.slice(-(HISTORY_LIMIT - 1)),
        cloneChartStyleOverrides(state.semanticOverrides),
      ],
      redoStack: [],
      gestureStart: null,
      revision: state.revision + 1,
    };
  }),
  undo: () => set((state) => {
    const previous = state.undoStack.at(-1);
    if (!previous) return state;
    const semanticOverrides = cloneChartStyleOverrides(previous);
    return {
      semanticOverrides,
      cssOverrides: buildCssOverrides(semanticOverrides, state.tokenMetadata),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [
        ...state.redoStack.slice(-(HISTORY_LIMIT - 1)),
        cloneChartStyleOverrides(state.semanticOverrides),
      ],
      gestureStart: null,
      revision: state.revision + 1,
    };
  }),
  redo: () => set((state) => {
    const next = state.redoStack.at(-1);
    if (!next) return state;
    const semanticOverrides = cloneChartStyleOverrides(next);
    return {
      semanticOverrides,
      cssOverrides: buildCssOverrides(semanticOverrides, state.tokenMetadata),
      undoStack: [
        ...state.undoStack.slice(-(HISTORY_LIMIT - 1)),
        cloneChartStyleOverrides(state.semanticOverrides),
      ],
      redoStack: state.redoStack.slice(0, -1),
      gestureStart: null,
      revision: state.revision + 1,
    };
  }),

  replaceOverrides: (overrides, options) => set((state) => {
    const semanticOverrides = cloneChartStyleOverrides(overrides);
    return {
      semanticOverrides,
      cssOverrides: buildCssOverrides(semanticOverrides, state.tokenMetadata),
      revision: state.revision + 1,
      gestureStart: null,
      ...(options?.clearHistory ? { undoStack: [], redoStack: [] } : {}),
    };
  }),
  setSyncedOverrides: (syncedOverrides) => set({
    syncedOverrides: cloneChartStyleOverrides(syncedOverrides),
  }),
  acceptRemoteDraft: (draft, options) => set((state) => {
    const remote = cloneChartStyleOverrides(styleLabDraftEditorOverrides(draft));
    let semanticOverrides = remote;
    if (options?.preserveLocalChanges) {
      semanticOverrides = cloneChartStyleOverrides(remote);
      const localIds = new Set([
        ...Object.keys(state.syncedOverrides),
        ...Object.keys(state.semanticOverrides),
      ]);
      for (const semanticId of localIds) {
        if (sameValue(state.syncedOverrides[semanticId], state.semanticOverrides[semanticId])) continue;
        const value = state.semanticOverrides[semanticId];
        if (value === undefined) delete semanticOverrides[semanticId];
        else semanticOverrides[semanticId] = cloneValue(value);
      }
    }
    return {
      semanticOverrides,
      cssOverrides: buildCssOverrides(semanticOverrides, state.tokenMetadata),
      syncedOverrides: remote,
      remoteRevision: draft.revision,
      remoteEtag: draft.etag ?? null,
      remoteDraftId: draft.id,
      remoteSourceThemeName: draft.sourceThemeName ?? null,
      remoteModifiedFromBaseline: Boolean(draft.modifiedFromBaseline),
      syncStatus: equalChartStyleOverrides(remote, semanticOverrides) ? "synced" : "saving",
      syncDetail: null,
      revision: state.revision + 1,
      gestureStart: null,
      ...(options?.clearHistory ? { undoStack: [], redoStack: [] } : {}),
    };
  }),
  setSyncStatus: (syncStatus, syncDetail = null) => set({ syncStatus, syncDetail }),
  setRemoteDraftMeta: (remoteRevision, remoteEtag, remoteDraftId) => set((state) => ({
    remoteRevision,
    remoteEtag,
    remoteDraftId: remoteDraftId === undefined ? state.remoteDraftId : remoteDraftId,
  })),
  setStyleLabBaseTheme: (styleLabBaseTheme) => set({ styleLabBaseTheme }),
  markSynced: (draft, overrides) => {
    const desired = cloneChartStyleOverrides(overrides ?? get().semanticOverrides);
    set({
      syncedOverrides: desired,
      remoteRevision: draft.revision,
      remoteEtag: draft.etag ?? null,
      remoteDraftId: draft.id,
      remoteSourceThemeName: draft.sourceThemeName ?? null,
      remoteModifiedFromBaseline: Boolean(draft.modifiedFromBaseline),
      syncStatus: "synced",
      syncDetail: null,
    });
  },
}));

export function chartStyleCssValue(cssVar: string): string | undefined {
  return useChartStyleEditorStore.getState().cssOverrides[cssVar];
}
