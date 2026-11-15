// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

// Touch layout chrome for right-pane modules (see stores/touch-pane-store.ts):
// which presentation the open pane gets, the full-screen view's Back row, and
// the bar a minimized view leaves over the chart.

import * as React from "react";
import { ChevronLeft, ChevronUp, X } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import type { RightPaneModuleKind } from "@/stores/frame-layout-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import {
  minimizeTouchPane,
  restoreTouchPane,
  useTouchPaneStore,
} from "@/stores/touch-pane-store";
import { RIGHT_PANE_KEYS, useWorkspaceStore } from "@/stores/workspace-store";

type WorkspaceSnapshot = ReturnType<typeof useWorkspaceStore.getState>;
type PaneKey = (typeof RIGHT_PANE_KEYS)[number];

export type TouchPanePresentation = "sheet" | "fullscreen" | "minimized";

/**
 * Whether the retained pane around a module is on screen. A minimized touch
 * view stays mounted but hidden: its lists idle and catch up when it is
 * restored. Everywhere else (desktop, Tauri, workspace surfaces) a mounted
 * module is visible.
 */
export const RetainedPaneVisibleContext = React.createContext(true);

/** Modules that stay a sheet under the wheel (or on their map) on touch. */
const SHEET_MODULES = new Set<RightPaneModuleKind>([
  "hover-inspector",
  "inspector-notes",
  "astrocart-controls",
]);

function openWorkspacePaneKey(state: WorkspaceSnapshot): PaneKey | null {
  for (const key of RIGHT_PANE_KEYS) {
    if (key !== "astrocartControlsPane" && state[key] !== null) return key;
  }
  return null;
}

/**
 * The identity of the open full-screen pane: its workspace pane object (a new
 * open creates a new object) or the frame pane it shows.
 */
export function currentTouchPaneToken(): unknown {
  const workspace = useWorkspaceStore.getState();
  const key = openWorkspacePaneKey(workspace);
  if (key) return workspace[key];
  const frame = useFrameLayoutStore.getState();
  if (frame.styleEditorOpen) return "chart-style";
  if (frame.notesPaneOpen && !frame.inspectorOpen) return "notes";
  return null;
}

export function useTouchPanePresentation(
  mobile: boolean,
  activeRightPane: RightPaneModuleKind | null,
): { presentation: TouchPanePresentation | null; token: unknown } {
  const paneObject = useWorkspaceStore((s) => {
    const key = openWorkspacePaneKey(s);
    return key ? s[key] : null;
  });
  const minimizedToken = useTouchPaneStore((s) => s.minimizedToken);
  if (!mobile || activeRightPane === null) return { presentation: null, token: null };
  if (SHEET_MODULES.has(activeRightPane)) return { presentation: "sheet", token: null };
  const token = paneObject ?? (activeRightPane === "chart-style" ? "chart-style" : "notes");
  return {
    presentation: minimizedToken === token ? "minimized" : "fullscreen",
    token,
  };
}

/** The translated name of the open full-screen view, for its minimized bar. */
function useTouchPaneTitle(activeRightPane: RightPaneModuleKind | null): string {
  const t = useT();
  const titleKey = useWorkspaceStore((s) => {
    const key = openWorkspacePaneKey(s);
    switch (key) {
      case "transitSearchPane":
        return "toolbar.transitSearch";
      case "transitListPane":
        return "sidebar.action.transits";
      case "directionsPane": {
        const tab = s.directionsPane?.initialTab;
        if (tab === "secondary") return "dirview.secondaryProgressions";
        if (tab === "circumambulation") return "dirview.circumambulations";
        return "dirview.primaryDirections";
      }
      case "timeLordPane":
        return "sidebar.group.time-lords";
      case "zodiacalReleasingPane":
        return "zrview.zodiacalReleasing";
      case "firdariaPane":
        return "firdview.firdaria";
      case "decennialsPane":
        return "decview.decennials";
      case "profectionsPane":
        return "profview.profections";
      case "eclipsesPane":
        return "eclipsesView.eclipses";
      case "pdPositionsPane":
        return "table.pd_positions";
      case "lunarMansionsPane":
        return "table.lunar_mansions";
      case "synodicCyclesPane":
        return "table.synodic_cycles";
      case "chartEventsPane":
        return "chartEvents.title";
      case "aspectListPane":
        return "aspectList.title";
      case "calendarPane":
        return "editor.calendar";
      case "featureCatalogPane": {
        const content = s.featureCatalogPane?.content;
        if (content === "help") return "help.title";
        if (content === "whats-new") return "license.whatsNewTitle";
        if (content === "notices") return "about.link.notices";
        if (content === "license") return "about.link.license";
        return "featureCatalog.title";
      }
      default:
        return null;
    }
  });
  if (titleKey) return t(titleKey);
  return activeRightPane === "chart-style" ? t("styleLab.title") : t("notes.title");
}

/** The full-screen view's top row: Back minimizes the view over the chart. */
export function TouchPaneBackRow({ token }: { token: unknown }) {
  const t = useT();
  return (
    <div className="aries-touch-pane-backrow">
      <button
        type="button"
        className="aries-touch-pane-back"
        onClick={() => minimizeTouchPane(token)}
      >
        <ChevronLeft aria-hidden />
        <span>{t("mobile.pane.back")}</span>
      </button>
    </div>
  );
}

/** The slim bar a minimized view leaves above the navigation. */
export function TouchPaneRestoreBar({
  activeRightPane,
  onClose,
}: {
  activeRightPane: RightPaneModuleKind | null;
  onClose: () => void;
}) {
  const t = useT();
  const title = useTouchPaneTitle(activeRightPane);
  return (
    <div className="aries-touch-pane-bar">
      <button type="button" className="aries-touch-pane-bar-restore" onClick={restoreTouchPane}>
        <ChevronUp aria-hidden />
        <span>{t("mobile.pane.restore", { view: title })}</span>
      </button>
      <button
        type="button"
        className="aries-touch-pane-bar-close"
        aria-label={t("mobile.pane.close", { view: title })}
        onClick={onClose}
      >
        <X aria-hidden />
      </button>
    </div>
  );
}
