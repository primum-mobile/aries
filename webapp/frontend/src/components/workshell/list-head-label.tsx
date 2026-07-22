// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type ListHeadAlign = "left" | "center" | "right";

export function ListHeadLabel({
  children,
  align = "center",
}: {
  children: string;
  align?: ListHeadAlign;
}) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-y-0 left-[var(--aries-list-cell-x)] right-[calc(var(--aries-list-cell-x)+var(--aries-control-gap-compact))] flex min-w-0 items-center",
        align === "right" ? "justify-end text-right" : align === "left" ? "justify-start text-left" : "justify-center text-center",
      )}
      title={children}
    >
      <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {children}
      </span>
    </span>
  );
}
