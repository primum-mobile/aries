// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Check, ChevronRight, Menu, PanelLeft, ScrollText } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import type { NativeMenuNode, RecentChartItem, WorkspaceManifest } from "@/lib/daemon/client";
import { useT, useTFallback } from "@/lib/i18n/i18n";
import {
  getServerShellMenuStateSnapshot,
  getShellMenuStateSnapshot,
  subscribeShellMenuState,
  type ShellMenuStateSnapshot,
} from "@/lib/shell-host";
import { cn } from "@/lib/utils";
import { manifestMenuChildren } from "./browser-menu-bar";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { minimizeTouchPane, touchPaneOpenedByCurrentAction } from "@/stores/touch-pane-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { setMobileNavSlot } from "./mobile-nav-slot";
import { currentTouchPaneToken } from "./touch-pane-chrome";
import { closeWorkspaceTransientPanes } from "./workspace-ui-commands";

type Props = {
  manifest: WorkspaceManifest | null;
  recentCharts: RecentChartItem[];
  activeDocumentId: string | null;
  onMenuCommand: (command: string) => void | Promise<boolean>;
  isMenuCommandEnabled: (command: string) => boolean;
};

/**
 * Touch chrome for the browser build (phones and tablets): a bottom navigation
 * bar whose tabs open the existing launcher sidebar (the shadcn mobile sheet),
 * the Inspector (a sheet under the wheel, see ChartArea), and the daemon's
 * native menu manifest, with the chart's stepping controls in its centre.
 * Other right panes open full screen with their own Back button. It owns no
 * workspace state of its own.
 */
export function MobileWorkspaceNav({
  manifest,
  recentCharts,
  activeDocumentId,
  onMenuCommand,
  isMenuCommandEnabled,
}: Props) {
  const t = useT();
  const { openMobile, setOpenMobile } = useSidebar();
  const inspectorOpen = useFrameLayoutStore((s) => s.inspectorOpen);
  const [menuOpen, setMenuOpen] = React.useState(false);

  // A chart chosen in the launcher sheet becomes the visible surface: touch
  // layouts open every chart on its wheel. An open full-screen view (a list
  // whose row opened this chart, or one left open behind the launcher) is
  // minimized to its bar, mounted and scrolled where it was, unless the same
  // action opened it (a launcher list that first returns to its radix). The
  // desktop default of a new radix restoring its Inspector would cover the
  // wheel, so the Inspector and other sheets close; they keep their state for
  // the next open.
  React.useEffect(() => {
    setOpenMobile(false);
    const token = currentTouchPaneToken();
    if (token === null) {
      closeWorkspaceTransientPanes();
      return;
    }
    if (touchPaneOpenedByCurrentAction(token)) return;
    const frame = useFrameLayoutStore.getState();
    if (frame.inspectorOpen) frame.setInspectorOpen(false);
    minimizeTouchPane(token);
  }, [activeDocumentId, setOpenMobile]);

  const showCharts = React.useCallback(() => {
    setMenuOpen(false);
    setOpenMobile(!openMobile);
  }, [openMobile, setOpenMobile]);
  // The Inspector button shows or hides the Inspector sheet. It replaces a
  // minimized view (one right pane at a time), never reopens another list.
  const showInspector = React.useCallback(() => {
    setOpenMobile(false);
    setMenuOpen(false);
    const frame = useFrameLayoutStore.getState();
    if (frame.inspectorOpen) {
      frame.setInspectorOpen(false);
      return;
    }
    useWorkspaceStore.getState().closeAllRightPanes();
    useFrameLayoutStore.setState({ inspectorOpen: true, styleEditorOpen: false });
  }, [setOpenMobile]);
  const showMenu = React.useCallback(() => {
    setOpenMobile(false);
    setMenuOpen((open) => !open);
  }, [setOpenMobile]);
  const runMenuCommand = React.useCallback((command: string) => {
    setMenuOpen(false);
    void onMenuCommand(command);
  }, [onMenuCommand]);

  return (
    <>
      <nav className="aries-mobile-nav" aria-label={t("mobile.nav.label")}>
        <MobileNavButton label={t("mobile.nav.charts")} active={openMobile} onClick={showCharts}>
          <PanelLeft aria-hidden />
        </MobileNavButton>
        {/* The chart's stepping controls (ModeHintRail) portal in here. */}
        <div ref={setMobileNavSlot} className="aries-mobile-nav-slot" />
        <MobileNavButton
          label={t("mobile.nav.inspector")}
          active={inspectorOpen && !openMobile && !menuOpen}
          onClick={showInspector}
        >
          <ScrollText aria-hidden />
        </MobileNavButton>
        <MobileNavButton label={t("mobile.nav.menu")} active={menuOpen} onClick={showMenu}>
          <Menu aria-hidden />
        </MobileNavButton>
      </nav>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="bottom" className="aries-mobile-menu-sheet">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("mobile.nav.menu")}</SheetTitle>
            <SheetDescription>{t("a11y.applicationMenu")}</SheetDescription>
          </SheetHeader>
          <MobileManifestMenu
            menus={manifest?.nativeMenu?.menus ?? []}
            recentCharts={recentCharts}
            onCommand={runMenuCommand}
            isCommandEnabled={isMenuCommandEnabled}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

function MobileNavButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="aries-mobile-nav-button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

/** The native menu manifest as an inline, touch-sized disclosure list. */
export function MobileManifestMenu({
  menus,
  recentCharts,
  onCommand,
  isCommandEnabled,
  separateActions = true,
  children,
}: {
  menus: NativeMenuNode[];
  recentCharts: RecentChartItem[];
  onCommand: (command: string) => void;
  isCommandEnabled: (command: string) => boolean;
  /** Keep extra rows in the manifest's last group when false. */
  separateActions?: boolean;
  /** Extra rows after the manifest (use MobileMenuAction). */
  children?: React.ReactNode;
}) {
  const menuState = React.useSyncExternalStore(
    subscribeShellMenuState,
    getShellMenuStateSnapshot,
    getServerShellMenuStateSnapshot,
  );
  return (
    <div className="aries-mobile-menu" role="menu">
      <MobileMenuNodes
        items={menus}
        recentCharts={recentCharts}
        onCommand={onCommand}
        isCommandEnabled={isCommandEnabled}
        menuState={menuState}
      />
      {children ? (
        <>
          {separateActions ? <hr className="aries-mobile-menu-separator" /> : null}
          {children}
        </>
      ) : null}
    </div>
  );
}

/** A plain touch-sized action row for MobileManifestMenu's trailing section. */
export function MobileMenuAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="aries-mobile-menu-row" onClick={onClick}>
      <span className="flex-1">{label}</span>
    </button>
  );
}

function MobileMenuNodes({
  items,
  recentCharts,
  onCommand,
  isCommandEnabled,
  menuState,
}: {
  items: NativeMenuNode[];
  recentCharts: RecentChartItem[];
  onCommand: (command: string) => void;
  isCommandEnabled: (command: string) => boolean;
  menuState: ShellMenuStateSnapshot;
}) {
  const tf = useTFallback();
  return items.map((item, index) => {
    if (item.type === "separator") {
      return <hr key={`separator-${index}`} className="aries-mobile-menu-separator" />;
    }
    const label = item.labelKey ? tf(item.labelKey, item.label) : item.label;
    if (item.type === "submenu") {
      return (
        <details key={item.id} className="aries-mobile-menu-group">
          <summary className="aries-mobile-menu-row" role="menuitem">
            <span className="flex-1">{label}</span>
            <ChevronRight aria-hidden className="aries-mobile-menu-chevron" />
          </summary>
          <div className="aries-mobile-menu-children">
            <MobileMenuNodes
              items={manifestMenuChildren(item, recentCharts)}
              recentCharts={recentCharts}
              onCommand={onCommand}
              isCommandEnabled={isCommandEnabled}
              menuState={menuState}
            />
          </div>
        </details>
      );
    }
    const enabled = menuState.enabled[item.id] ?? isCommandEnabled(item.id);
    const checked = item.type === "check"
      ? (menuState.checked[item.id] ?? Boolean(item.checked))
      : undefined;
    return (
      <button
        key={item.id}
        type="button"
        role={item.type === "check" ? "menuitemcheckbox" : "menuitem"}
        aria-checked={checked}
        disabled={!enabled}
        className={cn("aries-mobile-menu-row", !enabled && "opacity-50")}
        onClick={() => onCommand(item.id)}
      >
        <span className="flex-1">{label}</span>
        {checked ? <Check aria-hidden className="aries-mobile-menu-check" /> : null}
      </button>
    );
  });
}
