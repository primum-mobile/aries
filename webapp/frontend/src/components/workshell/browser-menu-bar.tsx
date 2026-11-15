// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Menu as MenuIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NativeMenuNode, RecentChartItem, WorkspaceManifest } from "@/lib/daemon/client";
import {
  getServerShellMenuStateSnapshot,
  getShellMenuStateSnapshot,
  resolveShellHost,
  subscribeShellMenuState,
  type ShellMenuStateSnapshot,
} from "@/lib/shell-host";
import {
  acceleratorAvailable,
  menuAcceleratorLabel,
  useAppleShortcuts,
  useShortcutModifierLabels,
} from "@/lib/shortcut-display";
import {
  SUPPORT_DIAGNOSTICS_COMMAND,
  SUPPORT_OPEN_LOGS_COMMAND,
  supportDiagnosticsAvailable,
} from "@/lib/shell/support-diagnostics";
import { cn } from "@/lib/utils";
import { useMenuKeyActivation } from "@/shortcuts/menu-key-activation";
import { useT, useTFallback } from "@/lib/i18n/i18n";
import { refreshWorkspaceManifest } from "@/stores/use-workspace-manifest";

type Props = {
  manifest: WorkspaceManifest | null;
  recentCharts: RecentChartItem[];
  onCommand: (command: string) => void;
  isCommandEnabled: (command: string) => boolean;
};

type SubmenuNode = Extract<NativeMenuNode, { type: "submenu" }>;

/** File > Exit, appended where the desktop app has no native menu bar. */
export const APP_EXIT_COMMAND = "menu.file.exit";

/**
 * In-page application menu.
 *
 * Tauri on macOS and Linux renders the daemon's menu tree as the native OS
 * menu bar. A browser tab has no such bar, and Windows draws its menu inside
 * the unified titlebar, so there the same daemon tree folds into one titlebar
 * button: each top-level menu (File, Tables, Charts, ...) becomes a submenu of
 * this popup. Command ids, order, labels, checked state, and enablement are
 * the manifest's, and dispatch goes through the same manifest command path as
 * the native menu. The desktop variant adds File > Exit, which the native
 * app menu provides elsewhere.
 */
function BrowserAppMenuComponent({ manifest, recentCharts, onCommand, isCommandEnabled }: Props) {
  const enabled = useBrowserHostMenu();
  const t = useT();
  const tf = useTFallback();
  const appleShortcuts = useAppleShortcuts();
  const modifierLabels = useShortcutModifierLabels();
  const acceleratorLabel = React.useCallback(
    (accelerator: string) => acceleratorAvailable(accelerator, appleShortcuts)
      ? menuAcceleratorLabel(accelerator, appleShortcuts, modifierLabels)
      : "",
    [appleShortcuts, modifierLabels],
  );
  const [open, setOpen] = React.useState(false);
  const menuState = React.useSyncExternalStore(
    subscribeShellMenuState,
    getShellMenuStateSnapshot,
    getServerShellMenuStateSnapshot,
  );

  React.useEffect(() => {
    if (!open) return;
    // Retained workspace iframes swallow outside presses; focusing one blurs
    // the shell window, so close the transient menu at that boundary.
    const dismissOnWindowBlur = () => setOpen(false);
    window.addEventListener("blur", dismissOnWindowBlur);
    return () => window.removeEventListener("blur", dismissOnWindowBlur);
  }, [open]);

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    // Open from the retained tree immediately, then refresh it quietly (as the
    // quick-options drawer does) so profiles saved elsewhere appear.
    if (nextOpen) void refreshWorkspaceManifest();
  }, []);
  // The desktop app on Windows: a lone Alt tap or F10 opens this menu, as
  // it would a native menu bar.
  const toggleFromKeyboard = React.useCallback(
    () => handleOpenChange(!open),
    [handleOpenChange, open],
  );
  useMenuKeyActivation(
    enabled && !appleShortcuts && resolveShellHost().kind === "tauri",
    toggleFromKeyboard,
  );

  if (!enabled) return null;
  const menus = withDesktopSupport(withDesktopExit(
    (manifest?.nativeMenu?.menus ?? []).filter(
      (node): node is SubmenuNode => node.type === "submenu",
    ),
  ));
  if (menus.length === 0) return null;
  const label = t("a11y.applicationMenu");

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        aria-label={label}
        title={label}
        data-aries-browser-app-menu=""
        className={cn(
          "flex h-[var(--morinus-header-btn-h)] w-[var(--morinus-header-btn-w)] items-center justify-center rounded-[var(--morinus-header-btn-radius)] text-[color:var(--aries-titlebar-icon)] outline-none transition-colors duration-[var(--aries-motion-shell-duration)] ease-[var(--aries-motion-shell-ease)] hover:bg-sidebar-accent hover:text-[color:var(--aries-titlebar-icon-hover)] focus-visible:bg-sidebar-accent focus-visible:text-[color:var(--aries-titlebar-icon-hover)]",
          open && "bg-sidebar-accent text-[color:var(--aries-titlebar-icon-active)]",
        )}
      >
        <MenuIcon className="size-[var(--morinus-header-icon-size)]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={label}
        className="w-max min-w-[min(var(--aries-menu-dropdown-min-width),var(--available-width))] max-w-(--available-width) whitespace-nowrap rounded-[var(--aries-radius-control)]"
      >
        {menus.map((node) => {
          const disabled = !manifestSubmenuHasEnabledItem(node, recentCharts, isCommandEnabled, menuState);
          return (
            <DropdownMenuSub key={node.id}>
              <DropdownMenuSubTrigger disabled={disabled} className="data-disabled:opacity-50">
                {node.labelKey ? tf(node.labelKey, node.label) : node.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-max min-w-[min(var(--aries-menu-dropdown-submenu-min-width),var(--available-width))] max-w-(--available-width) overflow-x-auto whitespace-nowrap rounded-[var(--aries-radius-control)]">
                <ManifestMenuItems
                  items={manifestMenuChildren(node, recentCharts)}
                  recentCharts={recentCharts}
                  acceleratorLabel={acceleratorLabel}
                  onCommand={onCommand}
                  isCommandEnabled={isCommandEnabled}
                  menuState={menuState}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const BrowserAppMenu = React.memo(BrowserAppMenuComponent);

/** True only for hosts without a native OS menu bar (the browser/WASM build
 * and the Windows desktop app). */
function useBrowserHostMenu(): boolean {
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    // Tauri injects its runtime globals early but not necessarily before the
    // first effect; re-check briefly so desktop never flashes the web menu.
    const update = () => {
      if (!cancelled) setEnabled(!resolveShellHost().capabilities.nativeMenu);
    };
    update();
    const animationFrame = window.requestAnimationFrame(update);
    const timers = [0, 50, 250, 1000].map((delay) => window.setTimeout(update, delay));
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);
  return enabled;
}

/** The desktop app without a native menu bar quits from File > Exit. */
function withDesktopExit(menus: SubmenuNode[]): SubmenuNode[] {
  if (resolveShellHost().kind !== "tauri") return menus;
  return menus.map((node) => node.id !== "menu.file" ? node : {
    ...node,
    children: [
      ...node.children,
      { type: "separator" },
      { type: "item", id: APP_EXIT_COMMAND, label: "Exit", labelKey: "nativeMenu.exit", enabled: true },
    ],
  });
}

/** The Windows desktop app: Help > Diagnostics… and Open logs folder, so a
 * tester can send what cannot be reproduced without a Windows machine. */
export function withDesktopSupport(menus: SubmenuNode[]): SubmenuNode[] {
  if (!supportDiagnosticsAvailable()) return menus;
  return menus.map((node) => node.id !== "menu.help" ? node : {
    ...node,
    children: [
      ...node.children,
      { type: "separator" },
      {
        type: "item",
        id: SUPPORT_DIAGNOSTICS_COMMAND,
        label: "Diagnostics…",
        labelKey: "supportDiagnostics.menuItem",
        enabled: true,
      },
      {
        type: "item",
        id: SUPPORT_OPEN_LOGS_COMMAND,
        label: "Open logs folder",
        labelKey: "supportDiagnostics.openLogsMenuItem",
        enabled: true,
      },
    ],
  });
}

const NO_RECENT_CHARTS: RecentChartItem[] = [];
const rawAccelerator = (accelerator: string) => accelerator;

export function ManifestMenuItems({
  items,
  recentCharts = NO_RECENT_CHARTS,
  acceleratorLabel = rawAccelerator,
  onCommand,
  isCommandEnabled,
  menuState,
}: {
  items: NativeMenuNode[];
  recentCharts?: RecentChartItem[];
  /** In-page display of a manifest accelerator; defaults to the raw string. */
  acceleratorLabel?: (accelerator: string) => string;
  onCommand: (command: string) => void;
  isCommandEnabled: (command: string) => boolean;
  menuState: ShellMenuStateSnapshot;
}) {
  return items.map((item, index) => (
    <MenuNode
      key={item.type === "separator" ? `separator-${index}` : item.id}
      item={item}
      recentCharts={recentCharts}
      acceleratorLabel={acceleratorLabel}
      onCommand={onCommand}
      isCommandEnabled={isCommandEnabled}
      menuState={menuState}
    />
  ));
}

function MenuNode({
  item,
  recentCharts,
  acceleratorLabel,
  onCommand,
  isCommandEnabled,
  menuState,
}: {
  item: NativeMenuNode;
  recentCharts: RecentChartItem[];
  acceleratorLabel: (accelerator: string) => string;
  onCommand: (command: string) => void;
  isCommandEnabled: (command: string) => boolean;
  menuState: ShellMenuStateSnapshot;
}) {
  const tf = useTFallback();
  if (item.type === "separator") return <DropdownMenuSeparator />;
  const label = item.labelKey ? tf(item.labelKey, item.label) : item.label;
  if (item.type === "submenu") {
    const disabled = !manifestSubmenuHasEnabledItem(item, recentCharts, isCommandEnabled, menuState);
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={disabled}>{label}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-max min-w-[min(var(--aries-menu-dropdown-submenu-min-width),var(--available-width))] max-w-(--available-width) overflow-x-auto whitespace-nowrap rounded-[var(--aries-radius-control)]">
          <ManifestMenuItems
            items={manifestMenuChildren(item, recentCharts)}
            recentCharts={recentCharts}
            acceleratorLabel={acceleratorLabel}
            onCommand={onCommand}
            isCommandEnabled={isCommandEnabled}
            menuState={menuState}
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  const enabled = item.id.startsWith("menu.recent-charts.entry:")
    ? true
    : (menuState.enabled[item.id] ?? isCommandEnabled(item.id));
  const run = () => {
    if (enabled) onCommand(item.id);
  };
  const shortcut = item.accelerator ? acceleratorLabel(item.accelerator) : "";
  if (item.type === "check") {
    const checked = menuState.checked[item.id] ?? Boolean(item.checked);
    return (
      <DropdownMenuCheckboxItem
        checked={checked}
        disabled={!enabled}
        onCheckedChange={run}
      >
        {item.glyph ? (
          <span
            aria-hidden="true"
            className={cn(
              "inline-block w-[var(--aries-control-icon-size-default)] shrink-0 text-center text-foreground/70",
              item.glyphFont !== "text" && "font-symbols",
            )}
          >
            {item.glyph}
          </span>
        ) : null}
        <span className="flex-1 whitespace-nowrap">{label}</span>
        {shortcut ? <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut> : null}
      </DropdownMenuCheckboxItem>
    );
  }
  return (
    <DropdownMenuItem disabled={!enabled} onClick={run}>
      <span className="flex-1 whitespace-nowrap">{label}</span>
      {shortcut ? <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  );
}

export function manifestSubmenuHasEnabledItem(
  node: SubmenuNode,
  recentCharts: RecentChartItem[],
  isCommandEnabled: (command: string) => boolean,
  menuState: ShellMenuStateSnapshot,
): boolean {
  return manifestMenuChildren(node, recentCharts).some((child) => {
    if (child.type === "separator") return false;
    if (child.type === "submenu") {
      return manifestSubmenuHasEnabledItem(child, recentCharts, isCommandEnabled, menuState);
    }
    if (child.id.startsWith("menu.recent-charts.entry:")) return true;
    return menuState.enabled[child.id] ?? isCommandEnabled(child.id);
  });
}

/** The runtime recent-chart entries replace the manifest's placeholder child. */
export function manifestMenuChildren(
  node: SubmenuNode,
  recentCharts: RecentChartItem[],
): NativeMenuNode[] {
  if (node.id !== "menu.recent-charts") return node.children;
  if (recentCharts.length === 0) return node.children;
  return recentCharts.map((item, index) => ({
    type: "item",
    id: `menu.recent-charts.entry:${index}`,
    label: item.label,
    enabled: true,
  }));
}
