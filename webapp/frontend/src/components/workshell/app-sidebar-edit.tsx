// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

// Edit Sidebar mode and the "Hidden · Undo" notice (design A2). Which launchers are hidden is
// daemon state carried on the manifest; this file only renders it and
// forwards toggles.

import * as React from "react";

import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { SidebarGroup as ManifestGroup } from "@/lib/daemon/client";
import { useTFallback } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  resetSidebarLaunchers,
  setSidebarLaunchersHidden,
  undoHiddenNotice,
  useSidebarVisibilityStore,
} from "@/stores/sidebar-visibility-store";

const NOTICE_MS = 6000;

export function SidebarEditBar() {
  const tf = useTFallback();
  const setEditing = useSidebarVisibilityStore((s) => s.setEditing);
  return (
    <div className="flex shrink-0 items-center justify-between gap-[var(--aries-control-gap-compact)] px-[var(--morinus-nav-side-margin)] pb-[var(--aries-control-gap-compact)]">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-[color:var(--aries-text-dim)]"
        onClick={() => void resetSidebarLaunchers()}
      >
        {tf("sidebar.editReset", "Reset")}
      </Button>
      <Button type="button" size="xs" onClick={() => setEditing(false)}>
        {tf("sidebar.editDone", "Done")}
      </Button>
    </div>
  );
}

type EditRow = { groupLabel: string; actionId: string; label: string; hidden: boolean };

export function SidebarEditContent({ groups }: { groups: ManifestGroup[] }) {
  const tLabel = useTFallback();
  const setEditing = useSidebarVisibilityStore((s) => s.setEditing);
  const rows = React.useMemo<EditRow[]>(
    () =>
      groups.flatMap((group) =>
        group.actions.map((action) => ({
          groupLabel: group.label,
          actionId: action.id,
          label: tLabel(`sidebar.action.${action.id}`, action.label),
          hidden: Boolean(action.hidden),
        })),
      ),
    [groups, tLabel],
  );
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const rowRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const focusIndex = Math.max(
    0,
    rows.findIndex((row) => rowKey(row) === focusKey),
  );

  // Entering edit mode (also from the View menu) puts keyboard focus on the
  // first row so ↑/↓, Space and Return/Esc work at once.
  const initialFocusDone = React.useRef(false);
  React.useEffect(() => {
    const first = rows[0];
    if (initialFocusDone.current || !first) return;
    initialFocusDone.current = true;
    rowRefs.current.get(rowKey(first))?.focus({ preventScroll: true });
  }, [rows]);

  const toggleRow = React.useCallback((row: EditRow) => {
    void setSidebarLaunchersHidden(row.groupLabel, [row.actionId], !row.hidden);
  }, []);

  const toggleSection = React.useCallback((group: ManifestGroup) => {
    const anyShown = group.actions.some((action) => !action.hidden);
    void setSidebarLaunchersHidden(
      group.label,
      group.actions.map((action) => action.id),
      anyShown,
    );
  }, []);

  const moveFocus = React.useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const next = rows[Math.min(rows.length - 1, Math.max(0, focusIndex + delta))];
      setFocusKey(rowKey(next));
      rowRefs.current.get(rowKey(next))?.focus();
    },
    [focusIndex, rows],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      let handled = true;
      if (event.key === "ArrowDown") moveFocus(1);
      else if (event.key === "ArrowUp") moveFocus(-1);
      else if (event.key === " ") {
        const row = rows[focusIndex];
        if (row) toggleRow(row);
      } else if (event.key === "Enter" || event.key === "Escape") setEditing(false);
      else handled = false;
      if (!handled) return;
      // Edit mode owns these keys: no chart stepping or menu accelerators.
      event.preventDefault();
      event.stopPropagation();
    },
    [focusIndex, moveFocus, rows, setEditing, toggleRow],
  );

  return (
    <div onKeyDown={onKeyDown}>
      {groups.map((group) =>
        group.actions.length === 0 ? null : (
          <SidebarGroup
            key={group.id}
            className="px-0 pb-[var(--aries-sidebar-group-padding-end)] pt-[var(--aries-sidebar-group-padding-start)]"
          >
            <SidebarGroupLabel className="h-[var(--aries-sidebar-section-header-height)] px-0">
              <button
                type="button"
                tabIndex={-1}
                className="flex h-[var(--aries-sidebar-section-header-height)] w-full items-center rounded-[var(--morinus-row-radius)] px-[var(--morinus-row-pad-x)] text-left text-[length:var(--aries-font-size-nav-section)] font-normal leading-none text-[color:var(--aries-text-dim)] hover:bg-[color:var(--aries-sidebar-row-soft)]"
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey) toggleSection(group);
                }}
              >
                <span className="block h-[var(--aries-sidebar-section-line-box)] min-w-0 truncate leading-[var(--aries-sidebar-section-line-box)]">
                  {tLabel(`sidebar.group.${group.id}`, group.label)}
                </span>
              </button>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0">
                {group.actions.map((action) => {
                  const row = rows.find(
                    (r) => r.groupLabel === group.label && r.actionId === action.id,
                  );
                  if (!row) return null;
                  const key = rowKey(row);
                  const focused = rows[focusIndex] === row;
                  return (
                    <SidebarMenuItem key={action.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={!row.hidden}
                        tabIndex={focused ? 0 : -1}
                        ref={(node) => {
                          if (node) rowRefs.current.set(key, node);
                          else rowRefs.current.delete(key);
                        }}
                        onFocus={() => setFocusKey(key)}
                        onClick={() => toggleRow(row)}
                        className={cn(
                          "aries-desktop-focus flex h-[var(--morinus-row-min-height)] w-full min-w-0 items-center gap-[var(--aries-control-gap-compact)] rounded-[var(--morinus-row-radius)] px-[var(--morinus-row-pad-x)] py-[var(--morinus-row-pad-y)] text-left text-[length:var(--aries-font-size-nav)] leading-none outline-none transition-colors duration-75 hover:bg-[color:var(--aries-sidebar-row-hover)]",
                          "focus-visible:ring-1 focus-visible:ring-[color:var(--aries-focus-ring)]",
                          row.hidden
                            ? "text-[color:color-mix(in_srgb,var(--aries-text-dim)_55%,var(--aries-sidebar-background))]"
                            : "text-sidebar-foreground",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex size-[var(--aries-sidebar-action-icon-size)] shrink-0 items-center justify-center rounded-[var(--aries-radius-control-compact)]",
                            row.hidden
                              ? "border border-[color:var(--aries-text-dim)]"
                              : "bg-sidebar-foreground text-sidebar",
                          )}
                        >
                          {row.hidden ? null : <Check className="size-[80%]" strokeWidth={3} />}
                        </span>
                        <span className="block h-[var(--aries-sidebar-row-line-box)] min-w-0 flex-1 truncate leading-[var(--aries-sidebar-row-line-box)]">
                          {row.label}
                        </span>
                      </button>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ),
      )}
    </div>
  );
}

function rowKey(row: EditRow): string {
  return `${row.groupLabel}\u0000${row.actionId}`;
}

export function SidebarHiddenNotice() {
  const tf = useTFallback();
  const notice = useSidebarVisibilityStore((s) => s.notice);
  const dismissNotice = useSidebarVisibilityStore((s) => s.dismissNotice);
  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => dismissNotice(notice.token), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [dismissNotice, notice]);
  if (!notice) return null;
  return (
    <div className="shrink-0 px-[var(--morinus-nav-side-margin)] pb-[var(--morinus-nav-side-margin)]">
      <div
        role="status"
        className="flex h-[var(--aries-control-height)] items-center justify-between gap-[var(--aries-control-gap-compact)] rounded-[var(--aries-radius-popover)] border border-border bg-popover pl-[var(--aries-control-padding-x)] text-[length:var(--aries-font-size-nav)] text-popover-foreground shadow-md"
      >
        <span className="min-w-0 truncate">{tf("sidebar.hiddenNotice", "Hidden")}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="font-semibold"
          onClick={() => undoHiddenNotice(notice)}
        >
          {tf("sidebar.hiddenUndo", "Undo")}
        </Button>
      </div>
    </div>
  );
}
