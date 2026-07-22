// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import {
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  rightPanePriorityLayout,
  useFrameLayoutStore,
} from "@/stores/frame-layout-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { activeRightPaneModule } from "./right-pane-layout";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";

// Set synchronously on <html> at pointer-down so the global CSS rule
// (globals.css) kills the sidebar width transition BEFORE the first
// pointermove — see note below.
const RESIZING_ATTR = "data-sidebar-resizing";

/**
 * Plain, native-style resize handle for the left navigator sidebar — drag the
 * pane border to resize. A 12px hit zone shows cursor:col-resize; the visible
 * divider is a 1px hairline that brightens on hover/drag.
 *
 * Behaviour (kept simple, like a normal desktop sidebar):
 *   • drag resizes within [148, 520]; dragging below the collapse threshold
 *     closes the sidebar and restores the previous width when reopened.
 *   • double-click resets to the startup width.
 *
 * Library boundary: the current `react-resizable-panels` dependency is v3,
 * whose docs do not support pixel-based panel constraints. The left navigator
 * is intentionally pixel-sized, so the frame owns it as a CSS-variable column
 * until a scoped v4+ upgrade can replace this with the library primitive.
 *
 * Drag performance: transient pointer positions live in refs and a CSS custom
 * property, then commit once on pointer-up. That keeps React/Zustand/persist out
 * of the pointermove loop, matching the React guidance to keep high-frequency
 * transient values out of render state.
 */
export function SidebarSash() {
  const t = useT();
  const sidebarOpen = useFrameLayoutStore((s) => s.sidebarOpen);
  const width = useFrameLayoutStore((s) => s.sidebarWidth);
  const setSidebarWidth = useFrameLayoutStore((s) => s.setSidebarWidth);
  const setSidebarOpen = useFrameLayoutStore((s) => s.setSidebarOpen);
  const resetSidebarWidth = useFrameLayoutStore((s) => s.resetSidebarWidth);
  const setSidebarDragging = useFrameLayoutStore((s) => s.setSidebarDragging);
  const dragging = useFrameLayoutStore((s) => s.sidebarDragging);
  const inspectorOpen = useFrameLayoutStore((s) => s.inspectorOpen);
  const notesOpen = useFrameLayoutStore((s) => s.notesPaneOpen);
  const styleEditorOpen = useFrameLayoutStore((s) => s.styleEditorOpen);
  const rightPaneWidth = useFrameLayoutStore((s) => s.rightPaneWidth);
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
  const visualWidth = activeRightPane
    ? rightPanePriorityLayout(
        sidebarOpen,
        width,
        rightPaneWidth,
        activeRightPane,
      ).sidebarWidth
    : width;

  // The desktop navigator is pinned to the window's left edge; the splitter
  // width is therefore the pointer x-coordinate in viewport space.
  const leftEdgeRef = React.useRef(0);
  // Active-drag flag as a ref (not React state) so onPointerMove works on the
  // very first move event — it must not wait for a re-render of `dragging`.
  const activeRef = React.useRef(false);
  const collapseInProgressRef = React.useRef(false);
  // DOM nodes carrying the live `--sidebar-width` var. The sidebar wrapper
  // moves the pane; the app shell moves the unified titlebar split because
  // the titlebar sits outside SidebarProvider.
  const wrapperRef = React.useRef<HTMLElement | null>(null);
  const appShellRef = React.useRef<HTMLElement | null>(null);
  // Latest raw (pre-clamp) width during the drag — committed to the store on
  // pointer-up. NaN means "no committed value yet".
  const lastWidthRef = React.useRef<number>(width);
  const dragStartWidthRef = React.useRef<number>(width);
  const windowMoveHandlerRef = React.useRef<((event: PointerEvent) => void) | null>(null);
  const windowEndHandlerRef = React.useRef<((event: PointerEvent) => void) | null>(null);
  const [sashReady, setSashReady] = React.useState(sidebarOpen);

  const setLiveSidebarWidth = React.useCallback((nextWidth: number) => {
    const value = `${nextWidth}px`;
    wrapperRef.current?.style.setProperty("--sidebar-width", value);
    appShellRef.current?.style.setProperty("--sidebar-width", value);
  }, []);

  const removeWindowDragListeners = React.useCallback(() => {
    if (windowMoveHandlerRef.current) {
      window.removeEventListener("pointermove", windowMoveHandlerRef.current);
      windowMoveHandlerRef.current = null;
    }
    if (windowEndHandlerRef.current) {
      window.removeEventListener("pointerup", windowEndHandlerRef.current);
      window.removeEventListener("pointercancel", windowEndHandlerRef.current);
      windowEndHandlerRef.current = null;
    }
  }, []);

  const collapseFromDrag = React.useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    removeWindowDragListeners();
    collapseInProgressRef.current = true;
    setSidebarOpen(false);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        collapseInProgressRef.current = false;
        setSidebarDragging(false);
        wrapperRef.current = null;
        appShellRef.current = null;
        document.documentElement.removeAttribute(RESIZING_ATTR);
      });
    });
  }, [
    removeWindowDragListeners,
    setSidebarOpen,
    setSidebarDragging,
  ]);

  const updateDragWidth = React.useCallback(
    (clientX: number) => {
      if (!activeRef.current) return;
      const raw = clientX - leftEdgeRef.current;
      const shouldCollapse = raw < SIDEBAR_COLLAPSE_THRESHOLD;
      if (shouldCollapse) {
        collapseFromDrag();
        return;
      }
      const clamped = clampSidebarWidth(raw);
      lastWidthRef.current = clamped;
      // Pure DOM write — no React, no store, no localStorage. The width var on
      // both carriers overrides home-client's inline default for the duration
      // of the drag; on commit we set the store, which re-establishes the inline
      // style with the same value (no visible jump).
      setLiveSidebarWidth(clamped);
    },
    [collapseFromDrag, setLiveSidebarWidth],
  );

  const endDrag = React.useCallback(
    (pointerId?: number, handle?: HTMLElement | null) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      removeWindowDragListeners();
      // Re-enable the transition + commit the final width ONCE (the only
      // persisted write of a non-collapsing drag). Collapse is handled
      // immediately in updateDragWidth when the threshold is crossed.
      document.documentElement.removeAttribute(RESIZING_ATTR);
      setSidebarWidth(lastWidthRef.current);
      setSidebarDragging(false);
      wrapperRef.current = null;
      appShellRef.current = null;
      if (pointerId != null && handle) {
        try {
          handle.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
      }
    },
    [
      removeWindowDragListeners,
      setSidebarWidth,
      setSidebarDragging,
    ],
  );

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!sidebarOpen) return;
      e.preventDefault();
      const handle = e.currentTarget;
      const pointerId = e.pointerId;
      const state = useFrameLayoutStore.getState();
      const workspaceState = useWorkspaceStore.getState();
      const currentStoredWidth = state.sidebarWidth;
      const currentRightPane = activeRightPaneModule({
        inspectorOpen: state.inspectorOpen,
        notesOpen: state.notesPaneOpen,
        styleEditorOpen: state.styleEditorOpen,
        transitSearchPane: workspaceState.transitSearchPane,
        transitListPane: workspaceState.transitListPane,
        directionsPane: workspaceState.directionsPane,
        timeLordPane: workspaceState.timeLordPane,
        zodiacalReleasingPane: workspaceState.zodiacalReleasingPane,
        firdariaPane: workspaceState.firdariaPane,
        decennialsPane: workspaceState.decennialsPane,
        profectionsPane: workspaceState.profectionsPane,
        eclipsesPane: workspaceState.eclipsesPane,
        lunarMansionsPane: workspaceState.lunarMansionsPane,
        synodicCyclesPane: workspaceState.synodicCyclesPane,
        ascensionalTransitsPane: workspaceState.ascensionalTransitsPane,
        featureCatalogPane: workspaceState.featureCatalogPane,
      });
      const currentVisualWidth = currentRightPane
        ? rightPanePriorityLayout(
            state.sidebarOpen,
            currentStoredWidth,
            state.rightPaneWidth,
            currentRightPane,
          ).sidebarWidth
        : currentStoredWidth;
      leftEdgeRef.current = 0;
      lastWidthRef.current = currentVisualWidth;
      dragStartWidthRef.current = currentVisualWidth;
      // Resolve the CSS-var carriers for the pane and the unified titlebar.
      wrapperRef.current = document.querySelector<HTMLElement>(
        '[data-slot="sidebar-wrapper"]',
      );
      appShellRef.current =
        handle.closest<HTMLElement>(".app-shell") ??
        document.querySelector<HTMLElement>(".app-shell");
      activeRef.current = true;
      // Kill the width transition SYNCHRONOUSLY, before the first pointermove —
      // a React state flag would land a frame late and animate the first moves.
      document.documentElement.setAttribute(RESIZING_ATTR, "");
      setSidebarDragging(true); // drives the hairline highlight only

      const onWindowMove = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        event.preventDefault();
        updateDragWidth(event.clientX);
      };
      const onWindowEnd = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        event.preventDefault();
        endDrag(event.pointerId, handle);
      };
      windowMoveHandlerRef.current = onWindowMove;
      windowEndHandlerRef.current = onWindowEnd;
      window.addEventListener("pointermove", onWindowMove, { passive: false });
      window.addEventListener("pointerup", onWindowEnd, { passive: false });
      window.addEventListener("pointercancel", onWindowEnd, { passive: false });

      try {
        handle.setPointerCapture(pointerId);
      } catch {
        /* synthetic events may lack a real pointer to capture */
      }
    },
    [endDrag, sidebarOpen, setSidebarDragging, updateDragWidth],
  );

  React.useEffect(() => {
    return () => {
      removeWindowDragListeners();
      if (!collapseInProgressRef.current) {
        document.documentElement.removeAttribute(RESIZING_ATTR);
        setSidebarDragging(false);
      }
    };
  }, [removeWindowDragListeners, setSidebarDragging]);

  React.useEffect(() => {
    const setReadySoon = (ready: boolean) => {
      window.queueMicrotask(() => setSashReady(ready));
    };
    if (!sidebarOpen) {
      setReadySoon(false);
      return;
    }
    const sidebar = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
    if (!sidebar) {
      setReadySoon(true);
      return;
    }

    const rect = sidebar.getBoundingClientRect();
    if (Math.abs(rect.left) < 1) {
      setReadySoon(true);
      return;
    }

    setReadySoon(false);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setSashReady(true);
    };
    const onTransitionDone = (event: TransitionEvent) => {
      if (
        event.target === sidebar &&
        (event.propertyName === "left" || event.propertyName === "right")
      ) {
        finish();
      }
    };
    sidebar.addEventListener("transitionend", onTransitionDone);
    sidebar.addEventListener("transitioncancel", onTransitionDone);

    const timeout = window.setTimeout(finish, transitionTotalMs(sidebar) + 50);
    return () => {
      window.clearTimeout(timeout);
      sidebar.removeEventListener("transitionend", onTransitionDone);
      sidebar.removeEventListener("transitioncancel", onTransitionDone);
    };
  }, [sidebarOpen]);

  if (!sidebarOpen || !sashReady) return null;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("a11y.resizeSidebar")}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={visualWidth}
      onPointerDown={onPointerDown}
      onDoubleClick={resetSidebarWidth}
      // 12px fixed hit zone straddling the structural sidebar split. No grip.
      className={cn(
        "fixed inset-y-0 left-[var(--sidebar-width)] z-50 w-3 -translate-x-1/2 cursor-col-resize select-none transition-[left] duration-[var(--aries-motion-shell-duration)] ease-[var(--aries-motion-shell-ease)]",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-[var(--aries-sash-rule-size)] after:-translate-x-1/2 after:bg-[color:var(--aries-sash-idle-color)] after:content-['']",
        "hover:after:bg-[color:var(--aries-sash-hover-color)]",
        dragging && "transition-none",
        dragging && "after:bg-[color:var(--aries-sash-active-color)]",
      )}
    />
  );
}

function transitionTotalMs(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  const durations = parseTimeList(style.transitionDuration);
  const delays = parseTimeList(style.transitionDelay);
  const count = Math.max(durations.length, delays.length, 1);
  let max = 0;
  for (let i = 0; i < count; i += 1) {
    max = Math.max(
      max,
      (durations[i % durations.length] ?? 0) + (delays[i % delays.length] ?? 0),
    );
  }
  return max;
}

function parseTimeList(value: string): number[] {
  const times = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.endsWith("ms")) return Number.parseFloat(part);
      if (part.endsWith("s")) return Number.parseFloat(part) * 1000;
      return Number.parseFloat(part) || 0;
    });
  return times.length > 0 ? times : [0];
}
