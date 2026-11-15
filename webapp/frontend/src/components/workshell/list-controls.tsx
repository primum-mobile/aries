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
import { formatIsoDateDisplay, parseDateDisplayInput, type DateConvention } from "@/lib/date-display";
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
        "aries-desktop-focus h-[var(--aries-control-height-small)] rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-border-subtle)] px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-small)]",
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

// Press-and-hold repeat for the calendar chevrons: one step on press, then a
// steady repeat until release. Pointer steps pass `deferLoad` so the list only
// moves its label/cursor during the burst; `onJumpSettle` fires once on release
// to load the landed month (one fetch per burst, not per step).
const CALENDAR_BURST_DELAY_MS = 320;
const CALENDAR_BURST_INTERVAL_MS = 70;

export type ListCalendarJumpOptions = { deferLoad?: boolean };

function useCalendarBurst(
  onJump: (months: number, options?: ListCalendarJumpOptions) => void,
  onJumpSettle: (() => void) | undefined,
  onRelease?: () => void,
) {
  const onJumpRef = React.useRef(onJump);
  const onJumpSettleRef = React.useRef(onJumpSettle);
  const onReleaseRef = React.useRef(onRelease);
  React.useEffect(() => {
    onJumpRef.current = onJump;
    onJumpSettleRef.current = onJumpSettle;
    onReleaseRef.current = onRelease;
  }, [onJump, onJumpSettle, onRelease]);
  const timerRef = React.useRef<number | null>(null);
  const activeRef = React.useRef(false);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  const stop = React.useCallback(() => {
    clearTimer();
    if (!activeRef.current) return;
    activeRef.current = false;
    if (onJumpSettleRef.current) onJumpSettleRef.current();
    onReleaseRef.current?.();
  }, [clearTimer]);
  React.useEffect(() => stop, [stop]);

  return React.useCallback(
    (months: number) => {
      const deferLoad = Boolean(onJumpSettle);
      return {
        onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          clearTimer();
          activeRef.current = true;
          onJumpRef.current(months, { deferLoad });
          const repeat = () => {
            onJumpRef.current(months, { deferLoad });
            timerRef.current = window.setTimeout(repeat, CALENDAR_BURST_INTERVAL_MS);
          };
          timerRef.current = window.setTimeout(repeat, CALENDAR_BURST_DELAY_MS);
        },
        onPointerUp: stop,
        onPointerCancel: stop,
        onLostPointerCapture: stop,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          // Pointer presses already stepped on pointerdown; this is keyboard.
          if (event.detail === 0) {
            onJumpRef.current(months);
            onReleaseRef.current?.();
          }
        },
      };
    },
    [clearTimer, onJumpSettle, stop],
  );
}

export function ListCalendarStepper({
  label,
  onJump,
  onJumpSettle,
  previousYearLabel,
  previousMonthLabel,
  nextMonthLabel,
  nextYearLabel,
}: {
  label: string;
  onJump: (months: number, options?: ListCalendarJumpOptions) => void;
  onJumpSettle?: () => void;
  previousYearLabel: string;
  previousMonthLabel: string;
  nextMonthLabel: string;
  nextYearLabel: string;
}) {
  const burst = useCalendarBurst(onJump, onJumpSettle);
  return (
    <div className={LIST_PANE_CLASSES.calendarStepper}>
      <Button
        type="button"
        {...LIST_BUTTON_PROPS.icon}
        className="[&_svg]:size-[var(--aries-control-icon-size)]"
        {...burst(-12)}
        aria-label={previousYearLabel}
      >
        <ChevronsLeft />
      </Button>
      <Button
        type="button"
        {...LIST_BUTTON_PROPS.icon}
        className="[&_svg]:size-[var(--aries-control-icon-size)]"
        {...burst(-1)}
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
        {...burst(1)}
        aria-label={nextMonthLabel}
      >
        <ChevronRight />
      </Button>
      <Button
        type="button"
        {...LIST_BUTTON_PROPS.icon}
        className="[&_svg]:size-[var(--aries-control-icon-size)]"
        {...burst(12)}
        aria-label={nextYearLabel}
      >
        <ChevronsRight />
      </Button>
    </div>
  );
}

export type ListMomentUnit = "day" | "month" | "year";

/** The date field's segment under the caret, in display order. */
function momentUnitAtCaret(text: string, caret: number, convention: DateConvention): ListMomentUnit {
  const order: ListMomentUnit[] = convention === "dmy" ? ["day", "month", "year"] : ["year", "month", "day"];
  const spans = [...text.matchAll(/\d+/g)].map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
  const index = spans.findIndex(([, end]) => caret <= end);
  return order[Math.min(index < 0 ? spans.length - 1 : index, order.length - 1)] ?? "day";
}

/**
 * A moment control: the date a state-at-one-time table is read at (the
 * directed speculum), unlike ListCalendarStepper, which only scrolls a list.
 * Chevrons step a month (‹ ›) or a year (« »), held to repeat; the date is a
 * typed field, and ↑/↓ step the day, month or year under the caret. Every
 * step is delivered at once (no batching); `onStepEnd` closes a burst, as a
 * released arrow key does.
 */
export function ListMomentStepper({
  value,
  convention,
  onStep,
  onStepEnd,
  onCommitDate,
  dateLabel,
  previousYearLabel,
  previousMonthLabel,
  nextMonthLabel,
  nextYearLabel,
}: {
  /** ISO day (YYYY-MM-DD), or null while unknown. */
  value: string | null;
  convention: DateConvention;
  onStep: (unit: ListMomentUnit, delta: number) => void;
  onStepEnd?: () => void;
  onCommitDate: (iso: string) => void;
  dateLabel: string;
  previousYearLabel: string;
  previousMonthLabel: string;
  nextMonthLabel: string;
  nextYearLabel: string;
}) {
  const jumpMonths = React.useCallback(
    (months: number) => (Math.abs(months) === 12 ? onStep("year", Math.sign(months)) : onStep("month", months)),
    [onStep],
  );
  const burst = useCalendarBurst(jumpMonths, undefined, onStepEnd);
  const formatted = value ? formatIsoDateDisplay(value, convention) : "";
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const editingRef = React.useRef(false);
  const caretRef = React.useRef<number | null>(null);
  const [draft, setDraft] = React.useState(formatted);
  const [invalid, setInvalid] = React.useState(false);

  React.useEffect(() => {
    if (editingRef.current) return;
    setDraft(formatted);
    setInvalid(false);
    const caret = caretRef.current;
    const input = inputRef.current;
    if (caret === null || !input || document.activeElement !== input) return;
    // Arrow steps keep the caret in the segment being stepped.
    requestAnimationFrame(() => input.setSelectionRange(caret, caret));
  }, [formatted]);

  const revert = React.useCallback(() => {
    editingRef.current = false;
    setDraft(formatted);
    setInvalid(false);
  }, [formatted]);
  const commit = React.useCallback(() => {
    if (!editingRef.current) return;
    const iso = parseDateDisplayInput(draft, convention, { partial: true });
    if (!iso) {
      revert();
      return;
    }
    editingRef.current = false;
    setDraft(formatIsoDateDisplay(iso, convention));
    setInvalid(false);
    if (iso !== value) onCommitDate(iso);
  }, [convention, draft, onCommitDate, revert, value]);

  const chevron = (months: number, label: string, icon: React.ReactNode) => (
    <Button
      type="button"
      {...LIST_BUTTON_PROPS.icon}
      className="[&_svg]:size-[var(--aries-control-icon-size)]"
      {...burst(months)}
      aria-label={label}
    >
      {icon}
    </Button>
  );
  return (
    <div className={LIST_PANE_CLASSES.calendarStepper}>
      {chevron(-12, previousYearLabel, <ChevronsLeft />)}
      {chevron(-1, previousMonthLabel, <ChevronLeft />)}
      <label className={LIST_PANE_CLASSES.calendarLabel}>
        <CalendarDays className="size-[var(--aries-control-icon-size)] text-muted-foreground" />
        <input
          data-aries-surface="control"
          ref={inputRef}
          type="text"
          inputMode="numeric"
          size={10}
          value={draft}
          aria-label={dateLabel}
          aria-invalid={invalid || undefined}
          placeholder={convention === "dmy" ? "DD.MM.YYYY" : "YYYY-MM-DD"}
          className={cn(
            "aries-desktop-focus min-w-0 rounded-sm bg-transparent text-center tabular-nums outline-none",
            invalid && "text-destructive",
          )}
          onChange={(event) => {
            const next = event.currentTarget.value;
            editingRef.current = true;
            caretRef.current = null;
            setDraft(next);
            setInvalid(!parseDateDisplayInput(next, convention, { partial: true }));
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              revert();
            } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !editingRef.current && value) {
              event.preventDefault();
              const caret = event.currentTarget.selectionStart ?? draft.length;
              caretRef.current = caret;
              onStep(momentUnitAtCaret(draft, caret, convention), event.key === "ArrowUp" ? 1 : -1);
              onStepEnd?.();
            }
          }}
        />
      </label>
      {chevron(1, nextMonthLabel, <ChevronRight />)}
      {chevron(12, nextYearLabel, <ChevronsRight />)}
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
  embedded = false,
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
  embedded?: boolean;
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
    <div className={embedded
      ? "w-full pb-[var(--aries-pane-header-padding-y)]"
      : "max-h-[var(--aries-pane-drawer-list-max-height)] w-full overflow-auto border-t border-border/70 pt-[var(--aries-pane-header-padding-y)]"}>
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
