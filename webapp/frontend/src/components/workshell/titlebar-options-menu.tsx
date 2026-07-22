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
import { ManifestMenuItems } from "./browser-menu-bar";
import type { SettingsTabId } from "./settings-dialog";

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

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
        className="max-h-[min(76vh,620px)] w-72 rounded-[var(--aries-radius-control)]"
      >
        <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
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
        <DropdownMenuItem onClick={() => onOpenSettings?.("appearance")}>
          {t("quickopt.openFullSettings")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
