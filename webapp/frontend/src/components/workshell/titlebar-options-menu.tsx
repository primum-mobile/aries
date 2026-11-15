// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NativeMenuNode, WorkspaceManifest } from "@/lib/daemon/client";
import {
  getServerShellMenuStateSnapshot,
  getShellMenuStateSnapshot,
  subscribeShellMenuState,
} from "@/lib/shell-host";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import { refreshWorkspaceManifest } from "@/stores/use-workspace-manifest";
import { ManifestMenuItems } from "./browser-menu-bar";
import type { SettingsTabId } from "./settings-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { MobileManifestMenu, MobileMenuAction } from "./mobile-workspace-nav";

type Props = {
  manifest: WorkspaceManifest | null;
  onCommand: (command: string) => void;
  isCommandEnabled: (command: string) => boolean;
  onOpenSettings?: (tab?: SettingsTabId) => void;
};

function optionsMenuFromManifest(
  manifest: WorkspaceManifest | null,
): Extract<NativeMenuNode, { type: "submenu" }> | null {
  const node = manifest?.nativeMenu?.menus.find((item) =>
    item.type === "submenu" && item.id === "menu.options",
  );
  if (node?.type !== "submenu") return null;
  // The menu bar is the complete catalog; this drawer stays the quick surface
  // and keeps its own Full settings row instead of the pane index.
  return {
    ...node,
    children: node.children.filter((child) => !(child.type === "submenu" && child.menuBarOnly)),
  };
}

/**
 * Upper-right quick-options drawer.
 *
 * This intentionally renders the daemon's native Options subtree instead of a
 * second hand-maintained React menu.  Native menu, browser app menu, and
 * this drawer therefore share order, hierarchy, labels, command ids, checked
 * state, and enablement automatically.
 */
export function TitlebarOptionsMenu({
  manifest,
  onCommand,
  isCommandEnabled,
  onOpenSettings,
}: Props) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const menuState = React.useSyncExternalStore(
    subscribeShellMenuState,
    getShellMenuStateSnapshot,
    getServerShellMenuStateSnapshot,
  );
  const optionsMenu = React.useMemo(() => optionsMenuFromManifest(manifest), [manifest]);

  React.useEffect(() => {
    if (!open) return;
    // Pointer events inside retained workspace iframes do not reach Base UI's
    // outside-press listener. Focusing an embedded surface does blur the shell
    // window, so dismiss the same transient menu at that document boundary.
    const dismissOnWindowBlur = () => setOpen(false);
    window.addEventListener("blur", dismissOnWindowBlur);
    return () => window.removeEventListener("blur", dismissOnWindowBlur);
  }, [open]);

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      // Keep the retained menu immediate, then refresh it quietly so profiles
      // saved by the standalone Style Lab appear without restarting Aries.
      void refreshWorkspaceManifest();
    }
  }, []);

  const mobile = useMobileLayout();
  const triggerClass = cn(
    "flex h-[var(--morinus-header-btn-h)] w-[var(--morinus-header-btn-w)] items-center justify-center rounded-[var(--morinus-header-btn-radius)] text-[color:var(--aries-titlebar-icon)] outline-none transition-colors duration-[var(--aries-motion-shell-duration)] ease-[var(--aries-motion-shell-ease)] hover:bg-sidebar-accent hover:text-[color:var(--aries-titlebar-icon-hover)] focus-visible:bg-sidebar-accent focus-visible:text-[color:var(--aries-titlebar-icon-hover)]",
    open && "bg-sidebar-accent text-[color:var(--aries-titlebar-icon-active)]",
  );

  if (mobile) {
    // Phone: hover submenus cannot open by touch, so the same Options subtree
    // is the touch-sized disclosure list the Menu sheet uses.
    const runAndClose = (run: () => void) => {
      setOpen(false);
      run();
    };
    return (
      <>
        <button
          type="button"
          aria-label={t("quickopt.quickOptions")}
          aria-expanded={open}
          className={triggerClass}
          onClick={() => handleOpenChange(!open)}
        >
          <SlidersHorizontal className="size-[var(--morinus-header-icon-size)]" />
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="aries-mobile-menu-sheet">
            <SheetHeader className="sr-only">
              <SheetTitle>{t("quickopt.quickOptions")}</SheetTitle>
              <SheetDescription>{t("quickopt.options")}</SheetDescription>
            </SheetHeader>
            {optionsMenu ? (
              <MobileManifestMenu
                menus={optionsMenu.children}
                recentCharts={[]}
                onCommand={(command) => runAndClose(() => onCommand(command))}
                isCommandEnabled={isCommandEnabled}
                separateActions={false}
              >
                <MobileMenuAction
                  label={t("quickopt.openFullSettings")}
                  onClick={() => runAndClose(() => onOpenSettings?.("appearance"))}
                />
              </MobileManifestMenu>
            ) : (
              <div className="aries-mobile-menu">
                <div className="aries-mobile-menu-row opacity-50">{t("quickopt.optionsUnavailable")}</div>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        aria-label={t("quickopt.quickOptions")}
        title={t("quickopt.quickOptions")}
        className={triggerClass}
      >
        <SlidersHorizontal className="size-[var(--morinus-header-icon-size)]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-max min-w-[min(var(--aries-menu-quick-width),var(--available-width))] max-w-(--available-width) overflow-x-auto whitespace-nowrap rounded-[var(--aries-radius-control)]"
      >
        <div className="px-[var(--aries-menu-label-padding-x)] py-[var(--aries-menu-label-padding-y)] text-[length:var(--aries-font-size-small)] font-medium text-muted-foreground">
          {t("quickopt.options")}
        </div>
        {optionsMenu ? (
          <ManifestMenuItems
            items={optionsMenu.children}
            onCommand={onCommand}
            isCommandEnabled={isCommandEnabled}
            menuState={menuState}
          />
        ) : (
          <DropdownMenuItem disabled>{t("quickopt.optionsUnavailable")}</DropdownMenuItem>
        )}
        {/* Joins the tree's closing Default Location group. */}
        <DropdownMenuItem onClick={() => onOpenSettings?.("appearance")}>
          {t("quickopt.openFullSettings")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
