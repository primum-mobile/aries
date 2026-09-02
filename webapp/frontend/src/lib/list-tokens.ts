// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { useThemeStore } from "@/stores/theme-store";

const LIST_ROW_HEIGHT_FALLBACK_PX = {
  dense: 28,
  standard: 31,
  symbolic: 37,
} as const;

export type ListDensity = keyof typeof LIST_ROW_HEIGHT_FALLBACK_PX;

export const LIST_ROW_HEIGHT_CSS_VAR: Readonly<Record<ListDensity, string>> = Object.freeze({
  dense: "--aries-list-row-height-dense",
  standard: "--aries-list-row-height-standard",
  symbolic: "--aries-list-row-height-symbolic",
});

export type ListCssValueReader = (cssVar: string) => string;

/** Resolve one fixed-row virtualization height from the same public CSS role
 * that paints the table. The numeric map above is only the SSR/invalid-value
 * fallback; it is never a second runtime style authority. */
export function resolveListRowHeight(
  density: ListDensity,
  readCssValue: ListCssValueReader = () => "",
): number {
  const value = Number.parseFloat(readCssValue(LIST_ROW_HEIGHT_CSS_VAR[density]).trim());
  return Number.isFinite(value) && value > 0 ? value : LIST_ROW_HEIGHT_FALLBACK_PX[density];
}

export function readListRowHeight(
  density: ListDensity,
  root: Element | null = typeof document === "undefined" ? null : document.documentElement,
): number {
  const computed = root && typeof window !== "undefined" ? window.getComputedStyle(root) : null;
  return resolveListRowHeight(density, (cssVar) => computed?.getPropertyValue(cssVar) ?? "");
}

function subscribeListRootStyle(onStoreChange: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  return () => observer.disconnect();
}

/** Live fixed-row height for virtualized lists. ThemeProvider writes the same
 * effective daemon/profile value to :root; selecting it here updates geometry
 * in the very render that receives a profile change. The pre-paint DOM read then
 * covers cached boot CSS and any non-theme host without creating an SSR split. */
export function useListRowHeight(density: ListDensity): number {
  const cssVar = LIST_ROW_HEIGHT_CSS_VAR[density];
  const themeValue = useThemeStore((state) => state.theme?.appTokens[cssVar] ?? "");
  const themedHeight = resolveListRowHeight(density, () => themeValue);
  const computedHeight = React.useSyncExternalStore(
    subscribeListRootStyle,
    () => readListRowHeight(density),
    () => LIST_ROW_HEIGHT_FALLBACK_PX[density],
  );

  return themeValue.trim() ? themedHeight : computedHeight;
}

/** Translate old-height scroll geometry before paint so a profile change keeps
 * the same top visible row and within-row fraction. */
export function useFixedRowHeightAnchor<T extends HTMLElement>(
  scrollerRef: React.RefObject<T | null>,
  rowCount: number,
  rowHeight: number,
  {
    enabled = true,
    syncEvent,
  }: {
    enabled?: boolean;
    syncEvent?: string;
  } = {},
) {
  const previousRowHeightRef = React.useRef(rowHeight);

  React.useLayoutEffect(() => {
    if (!enabled) return;
    const previousRowHeight = previousRowHeightRef.current;
    if (previousRowHeight === rowHeight) return;
    if (rowCount <= 0) {
      previousRowHeightRef.current = rowHeight;
      return;
    }
    const scroller = scrollerRef.current;
    if (!scroller || scroller.clientHeight <= 0) return;
    previousRowHeightRef.current = rowHeight;
    const headerHeight = scroller.querySelector<HTMLElement>("thead")?.offsetHeight ?? 0;
    const bodyViewportHeight = Math.max(0, scroller.clientHeight - headerHeight);
    const anchorUnits = scroller.scrollTop / previousRowHeight;
    // A sticky table header remains in normal flow. ``scrollTop`` is already
    // the body-relative row offset below that header, while the maximum body
    // offset must subtract only the viewport left beneath it.
    const maxTop = Math.max(0, rowCount * rowHeight - bodyViewportHeight);
    scroller.dataset.ariesRowHeightAnchorUntil = String(Date.now() + 250);
    scroller.scrollTop = Math.max(
      0,
      Math.min(maxTop, anchorUnits * rowHeight),
    );
    if (syncEvent) scroller.dispatchEvent(new Event(syncEvent));
  }, [enabled, rowCount, rowHeight, scrollerRef, syncEvent]);
}

export const LIST_ROLE_CLASSES = {
  dense: "aries-list aries-list--dense",
  standard: "aries-list aries-list--standard",
  symbolic: "aries-list aries-list--symbolic",
} as const;

export const LIST_PANE_CLASSES = {
  root: "relative flex h-full min-h-0 flex-col bg-background",
  standardHeader:
    "flex flex-col gap-[var(--aries-pane-control-gap-y)] border-b border-border px-[var(--aries-pane-header-padding-x)] py-[var(--aries-pane-header-padding-y)]",
  compactHeader:
    "flex flex-wrap items-center justify-between gap-x-[var(--aries-pane-control-compact-gap-x)] gap-y-[var(--aries-pane-control-gap-y)] border-b border-border px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-compact-padding-y)]",
  controlRow:
    "flex flex-wrap items-center gap-x-[var(--aries-pane-control-gap-x)] gap-y-[var(--aries-pane-control-gap-y)]",
  compactControlRow:
    "flex flex-wrap items-center gap-x-[var(--aries-pane-control-compact-gap-x)] gap-y-[var(--aries-pane-control-gap-y)]",
  titleRow: "flex items-start justify-between gap-[var(--aries-pane-title-gap)]",
  titleLeading: "flex min-w-0 items-center gap-[var(--aries-control-gap)]",
  titleGroup: "flex items-baseline gap-[var(--aries-pane-title-gap)]",
  title: "text-sm font-semibold",
  metadata: "text-[length:var(--aries-font-size-small)] text-muted-foreground",
  scroller: "flex-1 min-h-0 overflow-auto",
  loading:
    "px-[var(--aries-pane-header-padding-x)] py-[var(--aries-pane-state-padding)] text-[length:var(--aries-font-size-base)] text-muted-foreground",
  error:
    "px-[var(--aries-pane-header-padding-x)] py-[var(--aries-pane-state-padding)] text-[length:var(--aries-font-size-base)] text-destructive",
  stickyHeader: "sticky top-0 z-10 bg-background",
  calendarStepper: "inline-flex items-center rounded-md border border-border bg-background",
  calendarLabel:
    "inline-flex min-w-[8.75rem] items-center justify-center gap-1 text-xs tabular-nums",
  segmented: "inline-flex rounded-md border border-border bg-background p-[var(--aries-segmented-control-padding)]",
  segmentedButton:
    "h-[var(--aries-control-height-compact)] rounded-[var(--aries-segmented-control-item-radius)] px-[var(--aries-control-padding-x-compact)]",
  labeledControl: "inline-flex items-center gap-2 text-[length:var(--aries-font-size-small)]",
  controlLabel: "text-muted-foreground",
} as const;

export const LIST_ROW_CLASSES = {
  hover: "aries-list-row--hover",
  selected: "aries-list-row--selected",
  current: "aries-list-row--current",
  flagged: "aries-list-row--flagged",
} as const;

export const LIST_TEXT_CLASSES = {
  date: "aries-list-date-text",
  secondary: "aries-list-secondary-text",
} as const;

export const LIST_BUTTON_PROPS = {
  command: { size: "xs", variant: "outline" },
  icon: { size: "icon-xs", variant: "ghost" },
} as const;

export const TABLE_ROLE_CLASSES = {
  standard: "aries-table aries-table--standard",
} as const;
