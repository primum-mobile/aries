// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const LIST_ROW_HEIGHT = {
  dense: 28,
  standard: 31,
  symbolic: 37,
} as const;

export const LIST_ROLE_CLASSES = {
  dense: "aries-list aries-list--dense",
  standard: "aries-list aries-list--standard",
  symbolic: "aries-list aries-list--symbolic",
} as const;

export const LIST_PANE_CLASSES = {
  root: "relative flex h-full min-h-0 flex-col bg-background",
  standardHeader: "flex flex-col gap-2 border-b border-border px-4 py-2",
  compactHeader:
    "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-3 py-1.5",
  controlRow: "flex flex-wrap items-center gap-x-4 gap-y-2",
  compactControlRow: "flex flex-wrap items-center gap-x-3 gap-y-2",
  titleRow: "flex items-start justify-between gap-3",
  titleGroup: "flex items-baseline gap-3",
  title: "text-sm font-semibold",
  metadata: "text-[11px] text-muted-foreground",
  scroller: "flex-1 min-h-0 overflow-auto",
  loading: "px-4 py-6 text-[12px] text-muted-foreground",
  error: "px-4 py-6 text-[12px] text-destructive",
  stickyHeader: "sticky top-0 z-10 bg-background",
  calendarStepper: "inline-flex items-center rounded-md border border-border bg-background",
  calendarLabel:
    "inline-flex min-w-[8.75rem] items-center justify-center gap-1 text-xs tabular-nums",
  segmented: "inline-flex rounded-md border border-border bg-background p-[2px]",
  labeledControl: "inline-flex items-center gap-2 text-[11px]",
  controlLabel: "text-muted-foreground",
} as const;

export const LIST_ROW_CLASSES = {
  hover: "aries-list-row--hover",
  selected: "aries-list-row--selected",
  striped: "aries-list-row--striped",
  current: "aries-list-row--current",
  flagged: "aries-list-row--flagged",
} as const;

export const LIST_BUTTON_PROPS = {
  command: { size: "xs", variant: "outline" },
  icon: { size: "icon-xs", variant: "ghost" },
} as const;

export const TABLE_ROLE_CLASSES = {
  standard: "aries-table aries-table--standard",
} as const;
