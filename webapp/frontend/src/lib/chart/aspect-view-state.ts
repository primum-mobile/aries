// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export interface AspectViewState {
  selectedAspectBody: string | null;
  hideAllAspects: boolean;
  minorOnlyAspects: boolean;
}
export const EMPTY_ASPECT_VIEW: Readonly<AspectViewState> = Object.freeze({
  selectedAspectBody: null, hideAllAspects: false, minorOnlyAspects: false,
});
export function aspectViewState(
  state: AspectViewState & { aspectViews: Record<string, AspectViewState> },
  documentId?: string | null,
): Readonly<AspectViewState> {
  return documentId ? state.aspectViews[documentId] ?? EMPTY_ASPECT_VIEW : state;
}
export function changeAspectView(
  state: AspectViewState & { aspectViews: Record<string, AspectViewState> },
  documentId: string | null | undefined,
  action: "body" | "hide" | "minor" | "clear",
  bodyKey?: string,
): Partial<AspectViewState & { aspectViews: Record<string, AspectViewState> }> {
  const current = aspectViewState(state, documentId);
  const next = action === "body"
    ? { ...EMPTY_ASPECT_VIEW, selectedAspectBody: current.selectedAspectBody === bodyKey ? null : bodyKey ?? null }
    : action === "hide"
      ? { ...EMPTY_ASPECT_VIEW, hideAllAspects: !current.hideAllAspects }
      : action === "minor"
        ? { ...current, minorOnlyAspects: current.hideAllAspects ? !current.minorOnlyAspects : current.minorOnlyAspects, selectedAspectBody: null }
        : { ...EMPTY_ASPECT_VIEW };
  return documentId ? { aspectViews: { ...state.aspectViews, [documentId]: next } } : next;
}
