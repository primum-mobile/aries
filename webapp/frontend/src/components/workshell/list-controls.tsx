// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LIST_BUTTON_PROPS, LIST_PANE_CLASSES } from "@/lib/list-tokens";
import { cn } from "@/lib/utils";

export function ListSegmentedControl<T extends number | string>({
  label,
  options,
  value,
  onChange,
  labelPlacement = "tooltip",
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  labelPlacement?: "tooltip" | "inline";
}) {
  const control = (
    <div className={LIST_PANE_CLASSES.segmented} aria-label={label}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Button
            key={String(option.value)}
            type="button"
            size="xs"
            variant={active ? "secondary" : "ghost"}
            className={cn(
              "h-6 rounded-[6px] px-2 text-xs",
              active ? "" : "text-muted-foreground",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );

  if (labelPlacement === "inline") {
    return (
      <div className={LIST_PANE_CLASSES.labeledControl}>
        <span className={LIST_PANE_CLASSES.controlLabel}>{label}</span>
        {control}
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={<div role="group" aria-label={label} className="inline-flex items-center" />}
      >
        {control}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ListCalendarStepper({
  label,
  onJump,
  previousYearLabel,
  previousMonthLabel,
  nextMonthLabel,
  nextYearLabel,
}: {
  label: string;
  onJump: (months: number) => void;
  previousYearLabel: string;
  previousMonthLabel: string;
  nextMonthLabel: string;
  nextYearLabel: string;
}) {
  return (
    <div className={LIST_PANE_CLASSES.calendarStepper}>
      <Button
        type="button"
        {...LIST_BUTTON_PROPS.icon}
        onClick={() => onJump(-12)}
        aria-label={previousYearLabel}
      >
        <ChevronsLeft className="size-3.5" />
      </Button>
      <Button
        type="button"
        {...LIST_BUTTON_PROPS.icon}
        onClick={() => onJump(-1)}
        aria-label={previousMonthLabel}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <span className={LIST_PANE_CLASSES.calendarLabel}>
        <CalendarDays className="size-3.5 text-muted-foreground" />
        {label}
      </span>
      <Button
        type="button"
        {...LIST_BUTTON_PROPS.icon}
        onClick={() => onJump(1)}
        aria-label={nextMonthLabel}
      >
        <ChevronRight className="size-3.5" />
      </Button>
      <Button
        type="button"
        {...LIST_BUTTON_PROPS.icon}
        onClick={() => onJump(12)}
        aria-label={nextYearLabel}
      >
        <ChevronsRight className="size-3.5" />
      </Button>
    </div>
  );
}

type ListToggleDrawerItem = {
  id: string | number;
  label: string;
  glyph?: string;
  marker?: string;
};

export function ListToggleDrawer<T extends ListToggleDrawerItem>({
  label,
  items,
  isActive,
  onToggle,
}: {
  label: string;
  items: readonly T[];
  isActive: (item: T) => boolean;
  onToggle: (item: T, active: boolean) => void;
}) {
  return (
    <div className="w-full max-h-48 overflow-auto border-t border-border/70 pt-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="mr-1 min-w-14 text-[10px] text-muted-foreground">{label}</span>
        {items.map((item) => {
          const active = isActive(item);
          return (
            <Button
              key={item.id}
              type="button"
              size="xs"
              variant={active ? "default" : "outline"}
              aria-pressed={active}
              onClick={() => onToggle(item, !active)}
              className="h-6 max-w-44 justify-start gap-1 px-2 text-[11px]"
            >
              {item.glyph ? (
                <span className="aries-search-glyph shrink-0" style={{ fontFamily: "'AriesMorinus'" }}>
                  {item.glyph}
                </span>
              ) : null}
              <span className="truncate">{item.label}</span>
              {item.marker ? (
                <span className="text-[10px] text-muted-foreground">{item.marker}</span>
              ) : null}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
