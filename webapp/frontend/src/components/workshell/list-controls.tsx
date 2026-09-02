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

type PaneControlDensity = "compact" | "grouped" | "standard" | "wide";

export function PaneControlBar({
  density = "standard",
  surface = false,
  wrap = true,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  density?: PaneControlDensity;
  surface?: boolean;
  wrap?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center border-b border-[color:var(--aries-border-subtle)]",
        wrap && "flex-wrap",
        surface && "bg-[color:var(--aries-surface-subtle)]",
        density === "compact" &&
          "gap-[var(--aries-control-gap)] px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-compact-padding-y)]",
        density === "grouped" &&
          "gap-x-[var(--aries-pane-control-compact-gap-x)] gap-y-[var(--aries-pane-control-gap-y)] px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-padding-y)]",
        density === "standard" &&
          "gap-[var(--aries-pane-control-gap-y)] px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-padding-y)]",
        density === "wide" &&
          "gap-x-[var(--aries-pane-control-gap-x)] gap-y-[var(--aries-pane-control-gap-y)] px-[var(--aries-pane-header-padding-x)] py-[var(--aries-pane-header-padding-y)]",
        className,
      )}
      {...props}
    />
  );
}

export function PaneInfoBar({
  surface = false,
  className,
  ...props
}: React.ComponentProps<"div"> & { surface?: boolean }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-[var(--aries-control-gap)] border-b border-[color:var(--aries-border-subtle)] px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-compact-padding-y)] text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)]",
        surface && "bg-[color:var(--aries-surface-subtle)]",
        className,
      )}
      {...props}
    />
  );
}

export function PaneSelect({
  className,
  surface = false,
  ...props
}: React.ComponentProps<"select"> & { surface?: boolean }) {
  return (
    <select
      data-aries-control-appearance="local"
      className={cn(
        "h-[var(--aries-control-height-small)] rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-border-subtle)] px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-small)]",
        surface ? "bg-[color:var(--aries-surface)]" : "bg-background",
        className,
      )}
      {...props}
    />
  );
}

export function PaneToolbarButton({
  density = "compact",
  appearance = "outline",
  square = false,
  className,
  variant,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size"> & {
  density?: "compact" | "small";
  appearance?: "ghost" | "outline";
  square?: boolean;
}) {
  return (
    <Button
      size={density === "small" ? "sm" : "xs"}
      variant={variant ?? "ghost"}
      className={cn(
        "gap-[var(--aries-control-gap-compact)] rounded-[var(--aries-radius-control-compact)] bg-transparent font-normal text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)] [&_svg:not([class*='size-'])]:size-[var(--aries-control-icon-size)]",
        appearance === "outline"
          ? "border-[color:var(--aries-border-subtle)]"
          : "border-transparent text-[color:var(--aries-text-muted)] hover:border-[color:var(--aries-border-subtle)] hover:text-[color:var(--aries-text-primary)]",
        density === "compact" &&
          "h-[var(--aries-control-height-compact)] px-[var(--aries-control-icon-padding-x-compact)]",
        density === "small" &&
          "h-[var(--aries-control-height-small)] px-[var(--aries-control-padding-x-compact)]",
        square &&
          (density === "small"
            ? "w-[var(--aries-control-height-small)] px-0 [&_svg:not([class*='size-'])]:size-[var(--aries-control-icon-size-default)]"
            : "w-[var(--aries-control-height-compact)] px-0 [&_svg:not([class*='size-'])]:size-[var(--aries-control-icon-size-default)]"),
        className,
      )}
      {...props}
    />
  );
}

export const PANE_CONTROL_CLASSES = {
  checkboxLabel:
    "inline-flex h-[var(--aries-control-height-small)] items-center gap-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)]",
  rangeStepper:
    "inline-flex h-[var(--aries-control-height-small)] items-center overflow-hidden rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-border-subtle)]",
  rangeStepperButton:
    "h-full px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-small)] hover:bg-accent/40 disabled:opacity-50",
  rangeStepperValue:
    "h-full border-x border-[color:var(--aries-border-subtle)] px-[var(--aries-control-padding-x-compact)] py-[var(--aries-control-padding-y)] text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)]",
  microIconButton:
    "inline-flex size-[var(--aries-control-height-micro)] shrink-0 items-center justify-center rounded-[var(--aries-radius-control-compact)] hover:bg-accent/40 [&_svg]:size-[var(--aries-control-icon-size)]",
  stackedHeader:
    "shrink-0 space-y-[var(--aries-pane-control-gap-y)] border-b border-[color:var(--aries-border-subtle)] px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-padding-y)] text-[length:var(--aries-font-size-small)]",
} as const;

export function ListSegmentedControl<T extends number | string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  labelPlacement = "tooltip",
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
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
              LIST_PANE_CLASSES.segmentedButton,
              "text-xs",
              active ? "" : "text-muted-foreground",
            )}
            disabled={disabled}
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
        className="[&_svg]:size-[var(--aries-control-icon-size)]"
        onClick={() => onJump(-12)}
        aria-label={previousYearLabel}
      >
        <ChevronsLeft />
      </Button>
      <Button
        type="button"
        {...LIST_BUTTON_PROPS.icon}
        className="[&_svg]:size-[var(--aries-control-icon-size)]"
        onClick={() => onJump(-1)}
        aria-label={previousMonthLabel}
      >
        <ChevronLeft />
      </Button>
      <span className={LIST_PANE_CLASSES.calendarLabel}>
        <CalendarDays className="size-[var(--aries-control-icon-size)] text-muted-foreground" />
        {label}
      </span>
      <Button
        type="button"
        {...LIST_BUTTON_PROPS.icon}
        className="[&_svg]:size-[var(--aries-control-icon-size)]"
        onClick={() => onJump(1)}
        aria-label={nextMonthLabel}
      >
        <ChevronRight />
      </Button>
      <Button
        type="button"
        {...LIST_BUTTON_PROPS.icon}
        className="[&_svg]:size-[var(--aries-control-icon-size)]"
        onClick={() => onJump(12)}
        aria-label={nextYearLabel}
      >
        <ChevronsRight />
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

type ListToggleDrawerAction = {
  id: string | number;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

export function ListToggleDrawer<T extends ListToggleDrawerItem>({
  label,
  items,
  isActive,
  onToggle,
  deselectAllLabel,
  selectAllLabel,
  onDeselectAll,
  onSelectAll,
  actions = [],
}: {
  label: string;
  items: readonly T[];
  isActive: (item: T) => boolean;
  onToggle: (item: T, active: boolean) => void;
  deselectAllLabel?: string;
  selectAllLabel?: string;
  onDeselectAll?: () => void;
  onSelectAll?: () => void;
  actions?: readonly ListToggleDrawerAction[];
}) {
  const activeCount = items.reduce(
    (count, item) => count + (isActive(item) ? 1 : 0),
    0,
  );
  const showBulkActions = Boolean(
    deselectAllLabel &&
    selectAllLabel &&
    onDeselectAll &&
    onSelectAll,
  );
  return (
    <div className="max-h-[var(--aries-pane-drawer-list-max-height)] w-full overflow-auto border-t border-border/70 pt-[var(--aries-pane-header-padding-y)]">
      <div className="mb-[var(--aries-control-gap)] flex min-w-0 items-center justify-between gap-[var(--aries-control-gap)]">
        <span className="min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">{label}</span>
        {showBulkActions ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={activeCount === 0}
              onClick={onDeselectAll}
            >
              {deselectAllLabel}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={activeCount === items.length}
              onClick={onSelectAll}
            >
              {selectAllLabel}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-[var(--aries-control-gap)]">
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
              className="h-[var(--aries-control-height-compact)] max-w-44 justify-start gap-[var(--aries-control-gap-compact)] px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-small)]"
            >
              {item.glyph ? (
                <span className="aries-search-glyph shrink-0" style={{ fontFamily: "'AriesMorinus'" }}>
                  {item.glyph}
                </span>
              ) : null}
              <span className="truncate">{item.label}</span>
              {item.marker ? (
                <span className="text-[length:var(--aries-font-size-section)] text-muted-foreground">{item.marker}</span>
              ) : null}
            </Button>
          );
        })}
        {actions.map((action) => (
          <Button
            key={action.id}
            type="button"
            size="xs"
            variant="outline"
            disabled={action.disabled}
            onClick={action.onClick}
            className="h-[var(--aries-control-height-compact)] max-w-44 justify-start gap-[var(--aries-control-gap-compact)] px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-small)]"
          >
            {action.icon}
            <span className="truncate">{action.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
