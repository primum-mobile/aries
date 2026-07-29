// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

type Props = {
  manifest: WorkspaceManifest | null;
  onCommand: (command: string) => void;
  isCommandEnabled: (command: string) => boolean;
  onOpenStyleLab?: () => void;
  onOpenSettings?: (tab?: SettingsTabId) => void;
};

function optionsMenuFromManifest(
  manifest: WorkspaceManifest | null,
): Extract<NativeMenuNode, { type: "submenu" }> | null {
  const node = manifest?.nativeMenu?.menus.find((item) =>
    item.type === "submenu" && item.id === "menu.options",
  );
  return node?.type === "submenu" ? node : null;
}

/**
 * Upper-right quick-options drawer.
 *
 * This intentionally renders the daemon's native Options subtree instead of a
 * second hand-maintained React menu.  Native menu, browser titlebar menu, and
 * this drawer therefore share order, hierarchy, labels, command ids, checked
 * state, and enablement automatically.
 */
export function TitlebarOptionsMenu({
  manifest,
  onCommand,
  isCommandEnabled,
  onOpenStyleLab,
  onOpenSettings,
}: Props) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const menuState = React.useSyncExternalStore(
    subscribeShellMenuState,
    getShellMenuStateSnapshot,
    getServerShellMenuStateSnapshot,
  );
  const optionsMenu = optionsMenuFromManifest(manifest);

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

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        aria-label={t("quickopt.quickOptions")}
        title={t("quickopt.quickOptions")}
        className={cn(
          "flex h-[var(--morinus-header-btn-h)] w-[var(--morinus-header-btn-w)] items-center justify-center rounded-[var(--morinus-header-btn-radius)] text-[color:var(--aries-titlebar-icon)] outline-none transition-colors duration-[var(--aries-motion-shell-duration)] ease-[var(--aries-motion-shell-ease)] hover:bg-sidebar-accent hover:text-[color:var(--aries-titlebar-icon-hover)] focus-visible:bg-sidebar-accent focus-visible:text-[color:var(--aries-titlebar-icon-hover)]",
          open && "bg-sidebar-accent text-[color:var(--aries-titlebar-icon-active)]",
        )}
      >
        <SlidersHorizontal className="size-[var(--morinus-header-icon-size)]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[min(var(--aries-menu-quick-viewport-max-height),var(--aries-menu-quick-max-height))] w-[var(--aries-menu-quick-width)] rounded-[var(--aries-radius-control)]"
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenStyleLab}>
          {t("styleLab.title")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onOpenSettings?.("appearance")}>
          {t("quickopt.openFullSettings")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
