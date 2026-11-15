// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Touch layout (browser build on phones and tablets) presentation of the right
// pane modules. The Inspector stays a sheet under the wheel; every other pane
// (Primary Directions, transit lists, tables, Notes, …) is a full-screen view
// over the workspace. Its Back button minimizes it to a bar over the chart
// without closing it, so the mounted view keeps its rows, filters and scroll
// position. The pane itself stays open in the workspace store; this store only
// remembers which open pane is minimized, by the identity of its pane object:
//  * Back minimizes it, and so does a change of the active chart (a row of
//    the view that opens a chart, a chart picked in the launcher), so the
//    chart is what shows and the view waits on its bar. A chart switch that
//    belongs to the same user action as the pane's opening (a launcher item
//    that returns to the radix and opens its list) leaves it full screen;
//  * the bar, or opening a pane again from app chrome, restores it;
//  * a newly opened pane (a new pane object) is never minimized.
// Desktop and Tauri never minimize anything, so the store stays inert there.

import { create } from "zustand";

import { useFrameLayoutStore } from "@/stores/frame-layout-store";

type TouchPaneState = {
  /** Identity of the minimized pane (its workspace pane object or frame key). */
  minimizedToken: unknown;
};

export const useTouchPaneStore = create<TouchPaneState>(() => ({
  minimizedToken: null,
}));

export function minimizeTouchPane(token: unknown): void {
  if (token === null || token === undefined) return;
  if (useTouchPaneStore.getState().minimizedToken === token) return;
  useTouchPaneStore.setState({ minimizedToken: token });
}

/** Show the full-screen view again (its bar was tapped, or it was reopened). */
export function restoreTouchPane(): void {
  if (useTouchPaneStore.getState().minimizedToken === null) return;
  useTouchPaneStore.setState({ minimizedToken: null });
}

// The pane opened by the latest user action, until the next pointer or key
// input. Not React state: only the chart-switch handler reads it.
let freshToken: unknown = null;
let inputWatch = false;

function forgetFreshPane(): void {
  freshToken = null;
}

/** An explicit open created this pane (a new pane object or frame pane). */
export function noteTouchPaneOpened(token: unknown): void {
  freshToken = token;
  if (inputWatch || typeof window === "undefined") return;
  inputWatch = true;
  // Capture phase: the input that triggers an open is seen before the open.
  window.addEventListener("pointerdown", forgetFreshPane, true);
  window.addEventListener("keydown", forgetFreshPane, true);
}

/** True when ``token`` was opened by the user action still in progress. */
export function touchPaneOpenedByCurrentAction(token: unknown): boolean {
  return token !== null && token === freshToken;
}

// Opening Notes or the Chart Style Lab from app chrome shows it full screen.
useFrameLayoutStore.subscribe((state, previous) => {
  const notesOpened = state.notesPaneOpen && !previous.notesPaneOpen;
  const styleOpened = state.styleEditorOpen && !previous.styleEditorOpen;
  if (!notesOpened && !styleOpened) return;
  restoreTouchPane();
  noteTouchPaneOpened(styleOpened ? "chart-style" : "notes");
});
