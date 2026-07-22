// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/workshell/app-sidebar";
import { SidebarSash } from "@/components/workshell/sidebar-sash";
import {
  StatusBar,
  UnifiedTitleBar,
  type KeyHintPlacement,
} from "@/components/workshell/workspace-content";
import { activeRightPaneModule } from "@/components/workshell/right-pane-layout";
import { cn } from "@/lib/utils";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import type { WorkspaceManifest } from "@/lib/daemon/client";
import { rightPanePriorityLayout, useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useWorkspaceStore, type WorkspaceDocument } from "@/stores/workspace-store";
import type { SettingsTabId } from "./settings-dialog";

type WorkspaceFrameProps = {
  chart: ChartRenderSnapshot | null;
  activeDocument: WorkspaceDocument | null;
  manifest: WorkspaceManifest | null;
  documents: WorkspaceDocument[];
  onSelect: (id: string) => void;
  onCloseDocument: (id: string) => void;
  onReorder: (docId: string, beforeId: string | null) => void;
  onSolarAverageWindowSelect: (maxBirthday: number, returnKind: "solar" | "lunar") => void;
  onOpenSettings: (tab?: SettingsTabId) => void;
  onMenuCommand: (command: string) => void;
  isMenuCommandEnabled: (command: string) => boolean;
  onRevealKeyHints?: (placement: KeyHintPlacement) => void;
  children: React.ReactNode;
};

export function WorkspaceFrame({
  chart,
  activeDocument,
  manifest,
  documents,
  onSelect,
  onCloseDocument,
  onReorder,
  onSolarAverageWindowSelect,
  onOpenSettings,
  onMenuCommand,
  isMenuCommandEnabled,
  onRevealKeyHints,
  children,
}: WorkspaceFrameProps) {
  // First-paint settle guard. The frame renders at the default sidebar width,
  // then zustand-persist rehydrates the saved width just after mount; without
  // this attribute that one programmatic jump animates (180ms) and WKWebView
  // can stall mid-transition, leaving the pane, the sash and the status-bar
  // cell out of sync until the next interaction. The matching CSS lives next to
  // the data-sidebar-resizing drag guard in globals.css. Removed one painted
  // frame after hydration so user-driven changes animate normally.
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-initial-settle", "");
    let raf = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      raf = window.requestAnimationFrame(() => {
        raf = window.requestAnimationFrame(() => {
          root.removeAttribute("data-initial-settle");
        });
      });
    };
    const persistApi = useFrameLayoutStore.persist;
    let unsub: (() => void) | undefined;
    if (persistApi.hasHydrated()) {
      finish();
    } else {
      unsub = persistApi.onFinishHydration(finish);
    }
    const fallback = window.setTimeout(finish, 1200);
    return () => {
      unsub?.();
      window.clearTimeout(fallback);
      window.cancelAnimationFrame(raf);
      root.removeAttribute("data-initial-settle");
    };
  }, []);
  const sidebarOpen = useFrameLayoutStore((s) => s.sidebarOpen);
  const setSidebarOpen = useFrameLayoutStore((s) => s.setSidebarOpen);
  const sidebarWidth = useFrameLayoutStore((s) => s.sidebarWidth);
  const sidebarDragging = useFrameLayoutStore((s) => s.sidebarDragging);
  const rightPaneWidth = useFrameLayoutStore((s) => s.rightPaneWidth);
  const inspectorOpen = useFrameLayoutStore((s) => s.inspectorOpen);
  const notesOpen = useFrameLayoutStore((s) => s.notesPaneOpen);
  const styleEditorOpen = useFrameLayoutStore((s) => s.styleEditorOpen);
  const transitSearchPane = useWorkspaceStore((s) => s.transitSearchPane);
  const transitListPane = useWorkspaceStore((s) => s.transitListPane);
  const directionsPane = useWorkspaceStore((s) => s.directionsPane);
  const timeLordPane = useWorkspaceStore((s) => s.timeLordPane);
  const zodiacalReleasingPane = useWorkspaceStore((s) => s.zodiacalReleasingPane);
  const firdariaPane = useWorkspaceStore((s) => s.firdariaPane);
  const decennialsPane = useWorkspaceStore((s) => s.decennialsPane);
  const profectionsPane = useWorkspaceStore((s) => s.profectionsPane);
  const eclipsesPane = useWorkspaceStore((s) => s.eclipsesPane);
  const lunarMansionsPane = useWorkspaceStore((s) => s.lunarMansionsPane);
  const synodicCyclesPane = useWorkspaceStore((s) => s.synodicCyclesPane);
  const ascensionalTransitsPane = useWorkspaceStore((s) => s.ascensionalTransitsPane);
  const featureCatalogPane = useWorkspaceStore((s) => s.featureCatalogPane);
  const fullBleed = activeDocument?.kind === "astrocart";
  const activeRightPane = activeRightPaneModule({
    inspectorOpen,
    notesOpen,
    styleEditorOpen,
    transitSearchPane,
    transitListPane,
    directionsPane,
    timeLordPane,
    zodiacalReleasingPane,
    firdariaPane,
    decennialsPane,
    profectionsPane,
    eclipsesPane,
    lunarMansionsPane,
    synodicCyclesPane,
    ascensionalTransitsPane,
    featureCatalogPane,
  });
  const effectiveSidebarWidth = activeRightPane
    ? rightPanePriorityLayout(
        sidebarOpen,
        sidebarWidth,
        rightPaneWidth,
        activeRightPane,
      ).sidebarWidth
    : sidebarWidth;
  const lastKeyHintEdgeRevealRef = React.useRef(0);
  const lastKeyHintEdgePlacementRef = React.useRef<KeyHintPlacement | null>(null);
  const handleShellPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!onRevealKeyHints) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const edgeSize = Math.min(92, Math.max(52, rect.height * 0.1));
      if (y > edgeSize && rect.height - y > edgeSize) return;
      const placement: KeyHintPlacement = y <= edgeSize ? "top" : "bottom";
      const now = window.performance.now();
      if (
        lastKeyHintEdgePlacementRef.current === placement &&
        now - lastKeyHintEdgeRevealRef.current < 700
      ) {
        return;
      }
      lastKeyHintEdgeRevealRef.current = now;
      lastKeyHintEdgePlacementRef.current = placement;
      onRevealKeyHints(placement);
    },
    [onRevealKeyHints],
  );

  const sidebarVars = {
    "--sidebar-width": `${effectiveSidebarWidth}px`,
  } as React.CSSProperties;

  // The wx shell has fused titlebar controls: they float over the workspace and
  // do not consume a full grid row. The sidebar interior carries the small
  // titlebar plane as top padding; chart/table content keeps the recovered
  // height. Full-bleed surfaces also drop the status row.
  return (
    <div
      className={cn(
        "app-shell relative grid h-dvh overflow-hidden bg-background text-foreground",
        fullBleed
          ? "app-shell-full-bleed grid-rows-[minmax(0,1fr)]"
          : "grid-rows-[minmax(0,1fr)_var(--morinus-status-height)]",
      )}
      style={sidebarVars}
      onPointerMove={handleShellPointerMove}
    >
      <UnifiedTitleBar
        chart={chart}
        activeDoc={activeDocument}
        manifest={manifest}
        overlay={fullBleed}
        onOpenSettings={onOpenSettings}
        onMenuCommand={onMenuCommand}
        isMenuCommandEnabled={isMenuCommandEnabled}
      />
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        className={
          "h-full min-h-0 overflow-hidden" +
          (sidebarDragging
            ? " [&_[data-slot=sidebar-gap]]:transition-none [&_[data-slot=sidebar-container]]:transition-none"
            : "")
        }
        style={sidebarVars}
      >
        <AppSidebar
          manifest={manifest}
          documents={documents}
          activeDocumentId={activeDocument?.id ?? null}
          onSelect={onSelect}
          onCloseDocument={onCloseDocument}
          onReorder={onReorder}
          onSolarAverageWindowSelect={onSolarAverageWindowSelect}
        />
        <SidebarSash />
        <SidebarInset className="flex min-w-0 flex-col bg-background">
          {children}
        </SidebarInset>
      </SidebarProvider>
      {fullBleed ? null : (
        <StatusBar chart={chart} onOpenSettings={() => onOpenSettings("appearance")} />
      )}
    </div>
  );
}
