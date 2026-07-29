// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LIST_ROLE_CLASSES, LIST_TEXT_CLASSES } from "@/lib/list-tokens";
import { cn } from "@/lib/utils";

export type SidebarListTableProfile = "directions-titled" | "transit-cursor";

const SIDEBAR_LIST_TABLE_PROFILE_CLASSES: Record<SidebarListTableProfile, string> = {
  "directions-titled": cn(
    LIST_ROLE_CLASSES.symbolic,
    "[--aries-list-cell-x:4px]",
  ),
  "transit-cursor": LIST_ROLE_CLASSES.symbolic,
};

/**
 * Wrapperless native table for retained sidebar lists. Unlike the generic
 * Table component, this keeps the pane's one vertical scroller authoritative.
 * Its exported structural children are mandatory: the table role establishes
 * density, while the children supply canonical padding, rules, and row rhythm.
 */
export function SidebarListTable({
  profile,
  className,
  ...props
}: React.ComponentProps<"table"> & { profile: SidebarListTableProfile }) {
  return (
    <table
      data-slot="sidebar-list-table"
      className={cn(
        "aries-sidebar-list-table caption-bottom w-full table-auto border-collapse",
        SIDEBAR_LIST_TABLE_PROFILE_CLASSES[profile],
        className,
      )}
      {...props}
    />
  );
}

export function SidebarListSpacerRow({
  colSpan,
  height,
}: {
  colSpan: number;
  height: number;
}) {
  return (
    <TableRow
      aria-hidden="true"
      data-virtual-spacer
      className="pointer-events-none border-0"
    >
      <TableCell colSpan={colSpan} className="border-0 p-0" style={{ height }} />
    </TableRow>
  );
}

export function SidebarListDateCell({
  className,
  ...props
}: React.ComponentProps<"td">) {
  return (
    <TableCell
      className={cn(LIST_TEXT_CLASSES.date, "text-right tabular-nums", className)}
      {...props}
    />
  );
}

export function SidebarListTimeCell({
  className,
  ...props
}: React.ComponentProps<"td">) {
  return (
    <TableCell
      className={cn(LIST_TEXT_CLASSES.secondary, "text-left tabular-nums", className)}
      {...props}
    />
  );
}

export function SidebarListSortHeader({
  label,
  ariaLabel,
  direction,
  align = "left",
  onClick,
}: {
  label: React.ReactNode;
  ariaLabel: string;
  direction: "asc" | "desc" | null;
  align?: "left" | "center" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-full w-full items-center gap-[var(--aries-control-gap-compact)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        align === "right"
          ? "justify-end text-right"
          : align === "center"
            ? "justify-center text-center"
            : "justify-start text-left",
      )}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <span>{label}</span>
      {direction === "asc" ? (
        <ArrowUp className="size-3 shrink-0 text-[color:var(--aries-text-muted)]" />
      ) : direction === "desc" ? (
        <ArrowDown className="size-3 shrink-0 text-[color:var(--aries-text-muted)]" />
      ) : null}
    </button>
  );
}

export {
  TableBody as SidebarListBody,
  TableCell as SidebarListCell,
  TableHead as SidebarListHead,
  TableHeader as SidebarListHeader,
  TableRow as SidebarListRow,
};
