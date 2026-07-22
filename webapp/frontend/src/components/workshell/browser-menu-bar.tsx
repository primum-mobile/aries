// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

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
import { cn } from "@/lib/utils";
import { useT, useTFallback } from "@/lib/i18n/i18n";

type Props = {
  manifest: WorkspaceManifest | null;
  recentCharts: RecentChartItem[];
  onCommand: (command: string) => void;
  isCommandEnabled: (command: string) => boolean;
};

type RenderableNode = NativeMenuNode;

function BrowserMenuBarComponent({
  manifest,
  recentCharts,
  onCommand,
  isCommandEnabled,
}: Props) {
  const enabled = useBrowserMenuEnabled();
  const t = useT();
  const menuState = React.useSyncExternalStore(
    subscribeShellMenuState,
    getShellMenuStateSnapshot,
    getServerShellMenuStateSnapshot,
  );
  if (!enabled) return null;
  const menus = manifest?.nativeMenu?.menus ?? [];
  if (menus.length === 0) return null;

  return (
    <nav
      className="no-scrollbar fixed left-[calc(var(--titlebar-left-controls-x)+2rem)] right-[9rem] top-0 z-[60] flex h-[var(--titlebar-h)] items-center gap-0.5 overflow-x-auto overflow-y-visible px-1 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-titlebar-text)]"
      aria-label={t("a11y.applicationMenu")}
    >
      {menus.map((node) =>
        node.type === "submenu" ? (
          <TopMenu
            key={node.id}
            node={node}
            recentCharts={recentCharts}
            onCommand={onCommand}
            isCommandEnabled={isCommandEnabled}
            menuState={menuState}
          />
        ) : null,
      )}
    </nav>
  );
}

export const BrowserMenuBar = React.memo(BrowserMenuBarComponent);

function browserShellSnapshot(): boolean {
  return !resolveShellHost().capabilities.nativeMenu;
}

function useBrowserMenuEnabled(): boolean {
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    const update = () => {
      if (!cancelled) setEnabled(browserShellSnapshot());
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

function TopMenu({
  node,
  recentCharts,
  onCommand,
  isCommandEnabled,
  menuState,
}: {
  node: Extract<NativeMenuNode, { type: "submenu" }>;
  recentCharts: RecentChartItem[];
  onCommand: (command: string) => void;
  isCommandEnabled: (command: string) => boolean;
  menuState: ShellMenuStateSnapshot;
}) {
  const disabled = !submenuHasEnabledItem(node, recentCharts, isCommandEnabled, menuState);
  const tf = useTFallback();
  const label = node.labelKey ? tf(node.labelKey, node.label) : node.label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "h-6 whitespace-nowrap rounded-xs px-2 leading-6 outline-none transition-colors",
          "hover:bg-[color:var(--aries-list-hover-bg)] focus-visible:bg-[color:var(--aries-list-hover-bg)] data-disabled:opacity-50",
        )}
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56 rounded-[var(--aries-radius-control)]">
        <ManifestMenuItems
          items={menuChildren(node, recentCharts)}
          onCommand={onCommand}
          isCommandEnabled={isCommandEnabled}
          menuState={menuState}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ManifestMenuItems({
  items,
  onCommand,
  isCommandEnabled,
  menuState,
}: {
  items: RenderableNode[];
  onCommand: (command: string) => void;
  isCommandEnabled: (command: string) => boolean;
  menuState: ShellMenuStateSnapshot;
}) {
  return items.map((item, index) => (
    <MenuNode
      key={item.type === "separator" ? `separator-${index}` : item.id}
      item={item}
      onCommand={onCommand}
      isCommandEnabled={isCommandEnabled}
      menuState={menuState}
    />
  ));
}

function MenuNode({
  item,
  onCommand,
  isCommandEnabled,
  menuState,
}: {
  item: RenderableNode;
  onCommand: (command: string) => void;
  isCommandEnabled: (command: string) => boolean;
  menuState: ShellMenuStateSnapshot;
}) {
  const tf = useTFallback();
  if (item.type === "separator") return <DropdownMenuSeparator />;
  const label = item.labelKey ? tf(item.labelKey, item.label) : item.label;
  if (item.type === "submenu") {
    const disabled = !submenuHasEnabledItem(item, [], isCommandEnabled, menuState);
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={disabled}>{label}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-56 rounded-[var(--aries-radius-control)]">
          <ManifestMenuItems
            items={item.children}
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
  if (item.type === "check") {
    const checked = menuState.checked[item.id] ?? Boolean(item.checked);
    return (
      <DropdownMenuCheckboxItem
        checked={checked}
        disabled={!enabled}
        onCheckedChange={run}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {item.accelerator ? <DropdownMenuShortcut>{item.accelerator}</DropdownMenuShortcut> : null}
      </DropdownMenuCheckboxItem>
    );
  }
  return (
    <DropdownMenuItem disabled={!enabled} onClick={run}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {item.accelerator ? <DropdownMenuShortcut>{item.accelerator}</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  );
}

function submenuHasEnabledItem(
  node: Extract<NativeMenuNode, { type: "submenu" }>,
  recentCharts: RecentChartItem[],
  isCommandEnabled: (command: string) => boolean,
  menuState: ShellMenuStateSnapshot,
): boolean {
  return menuChildren(node, recentCharts).some((child) => {
    if (child.type === "separator") return false;
    if (child.type === "submenu") return submenuHasEnabledItem(child, [], isCommandEnabled, menuState);
    if (child.id.startsWith("menu.recent-charts.entry:")) return true;
    return menuState.enabled[child.id] ?? isCommandEnabled(child.id);
  });
}

function menuChildren(
  node: Extract<NativeMenuNode, { type: "submenu" }>,
  recentCharts: RecentChartItem[],
): RenderableNode[] {
  if (node.id !== "menu.recent-charts") return node.children;
  if (recentCharts.length === 0) return node.children;
  return recentCharts.map((item, index) => ({
    type: "item",
    id: `menu.recent-charts.entry:${index}`,
    label: item.label,
    enabled: true,
  }));
}
