// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { flushSync } from "react-dom";

import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ASPECT_GLYPHS,
  ASP_CONJUNCTION,
  ASP_MIDPOINT,
  ASP_RAPTCONTRAPARALLEL,
  ASP_RAPTPARALLEL,
  PLANET_GLYPH_SEQUENCE,
  PRIMDIR_LOF,
} from "@/lib/chart/glyphs";
import {
  LIST_PANE_CLASSES,
  LIST_ROLE_CLASSES,
  LIST_ROW_CLASSES,
  LIST_TEXT_CLASSES,
  useFixedRowHeightAnchor,
  useListRowHeight,
} from "@/lib/list-tokens";
import {
  getCachedListPayload,
  rememberListPayload,
} from "@/lib/table/payload-cache";
import {
  fetchAnnualDirections,
  fetchCircumambulations,
  fetchDirections,
  fetchOptions,
  fetchSecondaryDirections,
  openDirectionsTimedChart,
  openDirectionsSecondaryChart,
  openDirectionsPdInChart,
  patchOptions,
  workspaceRectifyRadixTime,
  type CircumambulationPayload,
  type CircumambulationParticipator,
  type CircumambulationSignificatorItem,
  type DirectionCellPart,
  type DirectionCustomSignificator,
  type DirectionRow,
  type DirectionRowFields,
  type DirectionsAgeSeek,
  type DirectionsPayload,
  type OptionsCatalog,
  type OptionsColors,
  type OptionsPatch,
  type OptionsPrimaryDirections,
  type SecondaryDirectionRow,
  type SecondaryDirectionsPayload,
  type TimedChartAction,
  type TemporalRowMeta,
} from "@/lib/daemon/client";
import { cn } from "@/lib/utils";
import { useT, useTFallback, type TFunc } from "@/lib/i18n/i18n";
import { type ListFollowPolicy } from "@/lib/list-follow-policy";
import {
  resolvedSemanticChartColor,
  semanticChartColor,
} from "@/lib/theme/semantic-color";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { beginWorkspaceSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";

import { PrimDirSettingsSheet } from "./primdir-settings";
import { ListSegmentedControl } from "./list-controls";
import {
  buildStableRowKeys,
  filterRetainedRows,
  spanContainsAge,
  stitchRows,
  useEdgeExtend,
  type AgeSpan,
  type StitchedRows,
} from "./stitched-list-harness";
import {
  ListLayoutPresetControl,
  listKeyDisplayOrder,
  useListLayoutPreset,
} from "./list-column-layout";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";
import {
  temporalCoverageFromRows,
  useTemporalConfluenceLensReporter,
  useTemporalConfluenceRows,
  useTemporalPinnedRowId,
  useTemporalRowHighlight,
  type TemporalCoverage,
} from "./temporal-confluence-context";
import {
  useStepSettledValue,
} from "./step-refresh";
import { buildAdHocTableExportDocument } from "./table-pdf-export";
import { TextExportActions } from "./text-export-actions";
import type { GenericTableCell } from "@/lib/daemon/client";

function directionPartsTextCell(
  parts: DirectionCellPart[] | null | undefined,
  fallbackGlyph: string | null | undefined,
  fallbackText: string,
  colorize: boolean,
): GenericTableCell {
  if (parts?.length && parts.some((part) => part.glyph)) {
    const exportSymbolText = parts.reduce((value, part) => {
      if (!part.exportText || !part.exportSymbolText) return value;
      return value.replace(part.exportText, part.exportSymbolText);
    }, fallbackText);
    return {
      exportText: fallbackText,
      exportSymbolText,
      runs: parts.map((part) => ({
        text: part.text,
        glyph: part.glyph,
        exportText: part.exportText,
        exportSymbolText: part.exportSymbolText,
        color: colorize
          ? resolvedSemanticChartColor(part.colorRole, part.color)
          : undefined,
      })),
    };
  }
  if (fallbackGlyph) {
    return {
      exportText: fallbackText,
      exportSymbolText: fallbackText,
      runs: [{ text: fallbackGlyph, glyph: true }],
    };
  }
  return { text: fallbackText };
}

function directionGlyphTextCell(
  text: string,
  glyph: string | null | undefined,
  color: string | null | undefined,
  colorRole: string | null | undefined,
  colorize: boolean,
  exportSymbolText?: string,
): GenericTableCell {
  if (!glyph) return { text };
  return {
    exportText: text,
    exportSymbolText: exportSymbolText || text,
    runs: [{
      text: glyph,
      glyph: true,
      exportText: text,
      exportSymbolText: exportSymbolText || undefined,
      color: colorize ? resolvedSemanticChartColor(colorRole, color) : undefined,
    }],
  };
}

const PRIMARY_DIRECTION_COLUMN_KEYS = ["mz", "prom", "dc", "sig", "arc", "date"] as const;
type PrimaryDirectionColumnKey = typeof PRIMARY_DIRECTION_COLUMN_KEYS[number];

const SECONDARY_DIRECTION_COLUMN_KEYS = ["age", "direction", "prom", "aspect", "sig", "date"] as const;
type SecondaryDirectionColumnKey = typeof SECONDARY_DIRECTION_COLUMN_KEYS[number];

const CIRCUM_COLUMN_KEYS = ["degree", "bound", "participator", "age", "date"] as const;
type CircumColumnKey = typeof CIRCUM_COLUMN_KEYS[number];
type DirectionHeadAlign = "left" | "center" | "right";

const DIRECTION_PLANET_LABEL_KEYS = [
  "primdir.planetSun",
  "primdir.planetMoon",
  "primdir.planetMercury",
  "primdir.planetVenus",
  "primdir.planetMars",
  "primdir.planetJupiter",
  "primdir.planetSaturn",
  "primdir.planetUranus",
  "primdir.planetNeptune",
  "primdir.planetPluto",
  "primdir.planetAscNode",
  "primdir.planetDscNode",
] as const;

function directionPlanetLabel(planetId: number | null | undefined, t: TFunc): string {
  const key = planetId == null ? undefined : DIRECTION_PLANET_LABEL_KEYS[planetId];
  return key ? t(key) : planetId == null ? "" : String(planetId);
}

function directionPointExportSymbol(
  symbol: string | null | undefined,
  fallbackText: string,
): string {
  if (!symbol) return fallbackText;
  const motionSuffix = fallbackText.match(/\s+\([^)]*\)$/u)?.[0] ?? "";
  return `${symbol}${motionSuffix}`;
}

function DirectionHeadLabel({
  children,
  align = "center",
}: {
  children: string;
  align?: DirectionHeadAlign;
}) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-y-0 left-[var(--aries-list-cell-x)] right-[calc(var(--aries-list-cell-x)+0.25rem)] flex min-w-0 items-center",
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

function primaryHeadClass(columnKey: PrimaryDirectionColumnKey) {
  return cn(
    "text-center",
    columnKey === "arc" && "text-right",
  );
}

function primaryHeadAlign(columnKey: PrimaryDirectionColumnKey): DirectionHeadAlign {
  return columnKey === "arc" ? "right" : "center";
}

function secondaryColumnClass(columnKey: SecondaryDirectionColumnKey) {
  switch (columnKey) {
    case "prom":
    case "aspect":
    case "sig":
      return "text-center";
    case "direction":
      return "text-center text-muted-foreground";
    case "age":
      return "text-right tabular-nums";
    case "date":
      return "text-center tabular-nums";
  }
}

function secondaryHeadClass(columnKey: SecondaryDirectionColumnKey) {
  return secondaryColumnClass(columnKey);
}

function secondaryHeadAlign(columnKey: SecondaryDirectionColumnKey): DirectionHeadAlign {
  return columnKey === "age" ? "right" : "center";
}

function circumAlignClass(columnKey: CircumColumnKey) {
  switch (columnKey) {
    case "bound":
      return "text-right";
    case "participator":
      return "text-left";
    default:
      return "text-center";
  }
}

function circumHeadClass(columnKey: CircumColumnKey) {
  return cn(
    circumAlignClass(columnKey),
    columnKey === "date" && "font-semibold tabular-nums",
    columnKey === "age" && "tabular-nums",
  );
}

function circumHeadAlign(columnKey: CircumColumnKey): DirectionHeadAlign {
  switch (columnKey) {
    case "bound":
      return "right";
    case "participator":
      return "left";
    default:
      return "center";
  }
}

// ---------------------------------------------------------------------------
// Directions companion popups, migrated as ONE tabbed surface (the three wx
// popups that subclass DirectionCompanionFrame): Primary Directions
// (primdirslistwnd.py), Secondary Directions (secdirframe.py), and
// Circumambulations (circumambulationframe.py). Each tab is a daemon-owned row
// list with its right-click Timed-chart context menu (commonwnd.py:63 — Open
// containing Solar Revolution / Open as Transit / Open as Chart, which open REAL
// child documents). Primary adds the live PrimDirsLiveFrame settings
// (primarydirsdlg.py) committed live with no OK/Cancel. The daemon owns all
// computation + the option state; this view holds only presentation state.
// ---------------------------------------------------------------------------

const PRIMARY_DIRECTION_DIRECT = 0;
const PRIMARY_DIRECTION_CONVERSE = 1;
const PRIMARY_DIRECTION_BOTH = 2;

function normalizePrimaryDirection(value: number | null | undefined): number | null {
  return value === PRIMARY_DIRECTION_DIRECT ||
    value === PRIMARY_DIRECTION_CONVERSE ||
    value === PRIMARY_DIRECTION_BOTH
    ? value
    : null;
}

function defaultPrimaryDirectionFromSettings(settings: OptionsPrimaryDirections | null): number | null {
  return normalizePrimaryDirection(settings?.pddefaultdirection);
}

const QUARTER_OPTIONS = [
  { value: 0, label: "Q1" },
  { value: 1, label: "Q2" },
  { value: 2, label: "Q3" },
  { value: 3, label: "Q4" },
] as const;

const AGE_ANCHOR_RANGES = [
  [0, 25],
  [25, 50],
  [50, 75],
  [75, 100],
  [100, 150],
] as const;

const AGE_RANGE_PAGE_YEARS = 125;

const VIRTUAL_OVERSCAN_ROWS = 12;
const VIRTUAL_SCROLL_SYNC_EVENT = "aries:virtual-scroll-sync";

function dispatchVirtualScrollSync(scroller: HTMLDivElement, beforePaint = false): void {
  scroller.dispatchEvent(
    new CustomEvent(VIRTUAL_SCROLL_SYNC_EVENT, { detail: { beforePaint } }),
  );
}
const DIRECTION_ROW_CLASS = LIST_ROW_CLASSES.flagged;
const PRIMARY_SETTINGS_PATCH_DEBOUNCE_MS = 350;
const DIRECTION_LIST_REFRESH_DEBOUNCE_MS = 220;
const RECTIFICATION_SESSION_ECHO_SUPPRESS_MS = 800;

// Parity target: the current/nearest event lands near the top quarter so a
// little past context is visible and most of the pane shows upcoming events.
const PRIMARY_FOCUS_ANCHOR = 0.25;
const SECONDARY_FOCUS_ANCHOR = 0.25;
const CIRCUMAMBULATION_FOCUS_ANCHOR = 0.25;

type Mode = "radix" | "sr" | "lr";
type DirectionsTab = "primary" | "secondary" | "circumambulation";
type DirectionsTopTab = "primary" | "secondary";
type PrimaryDirectionsSurface = "directions" | "circumambulation";
type SecondaryMethod = "secondary" | "minor" | "tertiary";
type SecondaryDirectionMode = "direct" | "converse" | "both";

const PRIMARY_SETTINGS_PLANET_GLYPHS = PLANET_GLYPH_SEQUENCE;
const PRIMARY_DIRECTIONS_CACHE = "directions:primary";
const CIRCUMAMBULATIONS_CACHE = "directions:circumambulation";
const RECTIFICATION_STEP_OPTIONS = [
  { label: "1s", seconds: 1 },
  { label: "5s", seconds: 5 },
  { label: "10s", seconds: 10 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "10m", seconds: 600 },
] as const;

function primaryFallbackGlyph(pointId: number, glyph?: string | null): string | null {
  if (glyph) return glyph;
  if (pointId >= 0 && pointId < PRIMARY_SETTINGS_PLANET_GLYPHS.length) {
    return PRIMARY_SETTINGS_PLANET_GLYPHS[pointId] ?? null;
  }
  return null;
}

function glyphRun(
  text: string | null | undefined,
  color?: string | null,
  colorRole?: string | null,
): DirectionCellPart | null {
  if (!text) return null;
  return { text, glyph: true, color: color ?? null, colorRole: colorRole ?? null };
}

function compactParts(parts: Array<DirectionCellPart | null>): DirectionCellPart[] {
  return parts.filter((part): part is DirectionCellPart => !!part && !!part.text);
}

function listCacheKey(parts: Record<string, unknown>): string {
  return JSON.stringify(parts);
}

function customSignificatorCacheKey(sig?: DirectionCustomSignificator | null): string | null {
  if (!sig) return null;
  return listCacheKey({
    id: sig.id,
    label: sig.label,
    longitude: sig.longitude,
    latitude: sig.latitude ?? 0,
    only: sig.only ?? true,
  });
}

function topTabFromInitial(initialTab: DirectionsTab): DirectionsTopTab {
  return initialTab === "secondary" ? "secondary" : "primary";
}

function primarySurfaceFromInitial(initialTab: DirectionsTab): PrimaryDirectionsSurface {
  return initialTab === "circumambulation" ? "circumambulation" : "directions";
}

function primarySettingsPlanetGlyphs(catalog: OptionsCatalog): string[] {
  const byIndex = new Map(catalog.individualColors.map((item) => [item.index, item.glyph]));
  return PRIMARY_SETTINGS_PLANET_GLYPHS.map((fallback, index) =>
    index <= 9 ? (byIndex.get(index) ?? fallback) : fallback,
  );
}

function parseDateMs(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isFinite(ms) ? ms : null;
}

function resolveFocusDateMs(value?: string | null): number {
  // wx source fallback:
  // primdirslistwnd._current_focus_date / circumambulationframe._current_focus_date
  // use the active ChartSession display date when present, otherwise today.
  return parseDateMs(value) ?? Date.now();
}

function localTodayNoonMs(): number {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return now.getTime();
}

function localWallclockIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settledValue, setSettledValue] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      React.startTransition(() => setSettledValue(value));
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return settledValue;
}

function compactDirectionKeyLabel(value?: string | null): string {
  if (!value) return "";
  return value
    .replace(/\s+\d+\s*deg\s+\d+\s*min\s+\d+\s*sec\s*$/i, "")
    .replace(/\s+\d+°\d+'\d+''\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rowDateRangeMs<T>(
  rows: readonly T[],
  dateOf: (row: T) => string | null | undefined,
): { first: number; last: number } | null {
  let first: number | null = null;
  let last: number | null = null;
  rows.forEach((row) => {
    const ms = parseDateMs(dateOf(row));
    if (ms == null) return;
    if (first == null) first = ms;
    last = ms;
  });
  return first == null || last == null ? null : { first, last };
}

function directionFocusTargetMsForRange(
  range: { first: number; last: number } | null,
  focusDatetime: string | null | undefined,
): number {
  const focusMs = resolveFocusDateMs(focusDatetime);
  if (range == null) return focusMs;

  const todayMs = localTodayNoonMs();
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (
    todayMs >= range.first &&
    todayMs <= range.last &&
    focusMs <= range.first + oneDayMs
  ) {
    return todayMs;
  }
  return focusMs;
}

function directionFocusTargetMs<T>(
  rows: readonly T[],
  focusDatetime: string | null | undefined,
  dateOf: (row: T) => string | null | undefined,
): number {
  return directionFocusTargetMsForRange(rowDateRangeMs(rows, dateOf), focusDatetime);
}

function dateRangeCoversFocusDate(
  range: { first: number; last: number } | null,
  focusDatetime: string | null | undefined,
): boolean {
  const focusMs = parseDateMs(focusDatetime);
  if (focusMs == null) return false;
  return range != null && focusMs >= range.first && focusMs <= range.last;
}

function nearestDateIndex<T>(
  rows: T[],
  targetMs: number,
  dateOf: (row: T) => string | null | undefined,
): number {
  if (!rows.length) return -1;
  let bestIndex = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    const ms = parseDateMs(dateOf(row));
    if (ms == null) return;
    const delta = Math.abs(ms - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function ageRangeTargetIndex<T>(
  rows: readonly T[],
  range: AgeRange,
  ageOf: (row: T) => number | null | undefined,
  seek: DirectionsAgeSeek = "exact",
): number {
  if (!rows.length) return -1;
  if (seek === "previous") {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const age = ageOf(rows[index]);
      if (age != null && age >= range.start && age < range.end) return index;
    }
  } else {
    const inRange = rows.findIndex((row) => {
      const age = ageOf(row);
      return age != null && age >= range.start && age < range.end;
    });
    if (inRange >= 0) return inRange;
  }
  let bestIndex = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  const targetAge = seek === "previous" ? range.end : range.start;
  rows.forEach((row, index) => {
    const age = ageOf(row);
    if (age == null) return;
    const delta = Math.abs(age - targetAge);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  });
  return bestIndex;
}

type AgeRange = { start: number; end: number; label: string };
type AgeRangeLoadDirection = "previous" | "next";

function ageRangeLabel(start: number, end: number): string {
  return `${Math.round(start)}–${Math.round(end)}`;
}

function adjacentAgeRange(range: AgeRange, direction: AgeRangeLoadDirection): AgeRange | null {
  const span = Math.max(0.1, range.end - range.start);
  if (direction === "previous") {
    const end = Math.max(0, range.start);
    if (end <= 0) return null;
    const start = Math.max(0, end - span);
    return { start, end, label: ageRangeLabel(start, end) };
  }
  const start = range.end;
  const end = start + span;
  return { start, end, label: ageRangeLabel(start, end) };
}

function ageRangesForPage(pageStart: number): AgeRange[] {
  if (pageStart <= 0) {
    return AGE_ANCHOR_RANGES.map(([start, end]) => ({
      start,
      end,
      label: ageRangeLabel(start, end),
    }));
  }
  return Array.from({ length: 5 }, (_, index) => {
    const start = pageStart + index * 25;
    const end = start + 25;
    return { start, end, label: ageRangeLabel(start, end) };
  });
}

function ageRangeIndexForAge(ranges: readonly AgeRange[], age?: number | null): number {
  if (age == null || !Number.isFinite(age)) return 0;
  const index = ranges.findIndex((range) => age >= range.start && age < range.end);
  return index >= 0 ? index : age >= ranges[ranges.length - 1].end ? ranges.length - 1 : 0;
}

function previousAgeRangePageStart(pageStart: number): number {
  return Math.max(0, pageStart <= 150 ? 0 : pageStart - AGE_RANGE_PAGE_YEARS);
}

function nextAgeRangePageStart(pageStart: number): number {
  return pageStart <= 0 ? 150 : pageStart + AGE_RANGE_PAGE_YEARS;
}

function ageRangePageStartForAge(age: number): number {
  if (!Number.isFinite(age) || age < 150) return 0;
  return 150 + Math.floor((age - 150) / AGE_RANGE_PAGE_YEARS) * AGE_RANGE_PAGE_YEARS;
}

function ControlTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="group"
            aria-label={label}
            className="inline-flex items-center"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function NatalParticipatorsToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <ControlTooltip label={t("dirview.natalParticipators")}>
      <Button
        type="button"
        size="xs"
        variant={active ? "default" : "outline"}
        aria-pressed={active}
        onClick={onToggle}
      >
        {t("dirview.natalParticipators")}
      </Button>
    </ControlTooltip>
  );
}

function AgeRangePager({
  ranges,
  value,
  onRange,
  onPreviousPage,
  onNextPage,
  previousDisabled,
  nextDisabled,
}: {
  ranges: readonly AgeRange[];
  value: number;
  onRange: (range: AgeRange) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  const t = useT();
  return (
    <ControlTooltip label={t("dirview.age")}>
      <div className="inline-flex items-center rounded-md border border-border bg-background p-[var(--aries-segmented-control-padding)]">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="h-6 w-6"
          disabled={previousDisabled}
          onClick={onPreviousPage}
          aria-label={t("dirview.previousAgeRanges")}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        {ranges.map((range, index) => (
          <Button
            key={`${range.start}-${range.end}`}
            type="button"
            size="xs"
            variant={index === value ? "secondary" : "ghost"}
            className="h-6 rounded-sm px-2 text-xs tabular-nums"
            onClick={() => onRange(range)}
          >
            {range.label}
          </Button>
        ))}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="h-6 w-6"
          disabled={nextDisabled}
          onClick={onNextPage}
          aria-label={t("dirview.nextAgeRanges")}
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </ControlTooltip>
  );
}

function RectificationStepper({
  docId,
  onStepStart,
  onStepped,
  onStepSettled,
  onError,
}: {
  docId: string;
  onStepStart?: () => void;
  onStepped?: () => void;
  onStepSettled?: () => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const [stepSeconds, setStepSeconds] = React.useState(60);
  const [pending, setPending] = React.useState(false);

  const step = React.useCallback(
    (direction: -1 | 1) => {
      if (pending) return;
      onStepStart?.();
      setPending(true);
      void workspaceRectifyRadixTime(docId, direction * stepSeconds)
        .then(() => {
          onStepped?.();
        })
        .catch((err) => {
          onError((err as Error).message);
        })
        .finally(() => {
          onStepSettled?.();
          setPending(false);
        });
    },
    [docId, onError, onStepSettled, onStepStart, onStepped, pending, stepSeconds],
  );

  return (
    <ControlTooltip label={t("dirview.rectification")}>
      <div className="inline-flex h-[var(--aries-control-height)] items-center rounded-[var(--aries-radius-md)] border border-border bg-background p-[var(--aries-segmented-control-padding)]">
        <span className="px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-section)] font-medium text-muted-foreground">
          {t("dirview.step")}
        </span>
        <select
          data-aries-control-appearance="local"
          aria-label={t("dirview.rectificationStep")}
          className="h-[var(--aries-control-height-compact)] w-[46px] rounded-[var(--aries-radius-sm)] border-0 bg-transparent px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-base)] tabular-nums text-foreground outline-none disabled:opacity-50"
          disabled={pending}
          value={stepSeconds}
          onChange={(event) => setStepSeconds(Number(event.target.value) || 60)}
        >
          {RECTIFICATION_STEP_OPTIONS.map((option) => (
            <option key={option.seconds} value={option.seconds}>
              {option.label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="text-[length:var(--aries-font-size-control)]"
          disabled={pending}
          onClick={() => step(-1)}
          aria-label={t("dirview.rectifyBackward")}
        >
          -
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="text-[length:var(--aries-font-size-control)]"
          disabled={pending}
          onClick={() => step(1)}
          aria-label={t("dirview.rectifyForward")}
        >
          +
        </Button>
      </div>
    </ControlTooltip>
  );
}

function useDirectionsRadixRefreshSeq(
  documentId: string,
  cursorDocumentId?: string | null,
  suppressEditRef?: { current: boolean },
  suppressEditUntilRef?: { current: number },
): number {
  const lastSessionChange = useDaemonWorkspaceStore((s) => s.lastSessionChange);
  const [seq, setSeq] = React.useState(0);
  React.useEffect(() => {
    if (!lastSessionChange) return;
    if (lastSessionChange.changeReason === "display-overlay") return;
    if (lastSessionChange.changeReason === "step") return;
    let cancelled = false;
    const ids = [documentId, cursorDocumentId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    const touched =
      (lastSessionChange.docId != null && ids.includes(lastSessionChange.docId)) ||
      lastSessionChange.rebuiltChildIds.some((id) => ids.includes(id));
    if (touched) {
      if (
        lastSessionChange.changeReason === "edit" &&
        (suppressEditRef?.current ||
          (suppressEditUntilRef != null && suppressEditUntilRef.current > Date.now()))
      ) {
        return;
      }
      queueMicrotask(() => {
        if (!cancelled) setSeq(lastSessionChange.seq);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [cursorDocumentId, documentId, lastSessionChange, suppressEditRef, suppressEditUntilRef]);
  return seq;
}

function useDirectionsOptionsSeq(): number {
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastRetainedDataOptionsChange);
  const [seq, setSeq] = React.useState(() => lastOptionsChange?.seq ?? 0);

  React.useEffect(() => {
    if (!lastOptionsChange) return;
    // Profile/token edits and explicitly list-neutral chart display commands
    // are paint-only here. Other options events can change row semantics, so
    // they keep the normal options refresh path.
    if (
      lastOptionsChange.styleOnly === true ||
      lastOptionsChange.listDataChanged === false
    ) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSeq(lastOptionsChange.seq);
    });
    return () => {
      cancelled = true;
    };
  }, [lastOptionsChange]);

  return seq;
}

type OptionsPatchPayload = Awaited<ReturnType<typeof patchOptions>>;

function hasPatchKeys(value: object | null | undefined): boolean {
  return !!value && Object.values(value).some((entry) => {
    if (entry === undefined) return false;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.values(entry).some((nested) => nested !== undefined);
    }
    return true;
  });
}

function mergeOptionsPatch(base: OptionsPatch | null, patch?: OptionsPatch): OptionsPatch | null {
  if (!patch) return base;
  return {
    ...(base ?? {}),
    ...patch,
    planetsPoints:
      base?.planetsPoints || patch.planetsPoints
        ? { ...(base?.planetsPoints ?? {}), ...(patch.planetsPoints ?? {}) }
        : undefined,
    primaryDirections:
      base?.primaryDirections || patch.primaryDirections
        ? { ...(base?.primaryDirections ?? {}), ...(patch.primaryDirections ?? {}) }
        : undefined,
  };
}

function primaryDirectionsPreviewOptionsPatch(
  settings: OptionsPrimaryDirections | null,
  meanNode: boolean | null,
): OptionsPatch | null {
  if (!settings) return null;
  const primaryDirections = { ...settings } as Record<string, unknown>;
  delete primaryDirections.pdFixStarCatalog;
  delete primaryDirections.pdFixStarMaxSelected;
  delete primaryDirections.pdkeycoeff;
  delete primaryDirections.arabicPartNames;
  // PDs-in-Chart controls affect only charts opened from row commands; they do
  // not define a new Directions-list calculation world.
  delete primaryDirections.pdincharttyp;
  delete primaryDirections.pdinchartsecmotion;
  delete primaryDirections.pdinchartterrsecmotion;
  delete primaryDirections.pdinchartreverse;
  const patch: OptionsPatch = {
    primaryDirections: primaryDirections as Partial<OptionsPrimaryDirections>,
  };
  if (meanNode != null) {
    patch.planetsPoints = { meannode: meanNode };
  }
  return patch;
}

function primaryDirectionRowKey(row: DirectionRow, index: number): string {
  const f = row.fields;
  return [
    "primary-row",
    index,
    f.mundane ? 1 : 0,
    f.direct ? 1 : 0,
    f.prom,
    f.prom2,
    f.promasp,
    f.sigPoint,
    f.sigasp,
    f.parallelaxis,
  ].join(":");
}

// ---------------------------------------------------------------------------
// Secondary/tertiary/minor stitched scroll. The daemon list stays windowed
// (these lists are huge — tertiary ≈ 109 rows/yr, minor ≈ 214 rows/yr), but the
// client accumulates adjacent age windows into ONE stitched rows array so the
// pane reads as a single smooth lifetime scroll. Chunk sizes keep each fetch
// well under the daemon's 10k-row truncation cap and under ~300 ms.
// ---------------------------------------------------------------------------
const SECONDARY_STITCH_CHUNK_YEARS: Record<SecondaryMethod, number> = {
  secondary: 25,
  tertiary: 10,
  minor: 5,
};
const SECONDARY_STITCH_MAX_AGE = 150;
const SECONDARY_STITCHED_CACHE = "directions:secondary-stitched";
const SECONDARY_STITCH_CACHE_MAX_ROWS = 25000;
const SECONDARY_STATION_FILTER_IDS: readonly boolean[] = Object.freeze([true]);
const SECONDARY_DEFAULT_ASPECT_FILTER_IDS = Object.freeze(
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
);
const SECONDARY_MAJOR_ASPECT_FILTER_IDS = Object.freeze([0, 3, 5, 6, 10]);

type SecondaryStitchStore = StitchedRows<SecondaryDirectionRow> & {
  /** Frozen initial-chunk meta — title/columns/referenceAge are identical for
   * every chunk of one stitched world; coverage lives on the store itself. */
  meta: SecondaryDirectionsPayload["meta"];
  /** False once any resident chunk hit the daemon row cap. */
  coverageAuthoritative: boolean;
  /** Exact daemon-owned JD coverage for the contiguous stitched age range. */
  temporalCoverage: TemporalCoverage | null;
};

function authoritativeTemporalCoverage(
  coverage: TemporalCoverage | null | undefined,
): TemporalCoverage | null {
  if (
    !coverage?.authoritative
    || !Number.isFinite(coverage.startJdUt)
    || !Number.isFinite(coverage.endJdUt)
    || coverage.endJdUt <= coverage.startJdUt
  ) return null;
  return coverage;
}

function mergeContiguousTemporalCoverage(
  left: TemporalCoverage | null,
  right: TemporalCoverage | null | undefined,
): TemporalCoverage | null {
  const next = authoritativeTemporalCoverage(right);
  if (!left) return next;
  if (!next) return left;
  const epsilonDays = 1 / 86_400;
  if (
    next.startJdUt > left.endJdUt + epsilonDays
    || left.startJdUt > next.endJdUt + epsilonDays
  ) return null;
  return {
    startJdUt: Math.min(left.startJdUt, next.startJdUt),
    endJdUt: Math.max(left.endJdUt, next.endJdUt),
    authoritative: true,
  };
}

/** Display identity of a row — the stitch dedupe/React key. Never jd or time:
 * refined instants jitter by seconds between fit windows (parity-checked
 * against the daemon: adjacent windows concatenate row-for-row on this key). */
function secondaryStitchRowKey(row: SecondaryDirectionRow): string {
  return [row.date, row.motionCode ?? "", row.prom, row.aspect, row.sig].join("\u0000");
}

function secondaryStationFilterKey(row: SecondaryDirectionRow): boolean {
  return row.isStation === true;
}

function rememberStitchedSecondaryStore(key: string, store: SecondaryStitchStore): void {
  if (store.rows.length > SECONDARY_STITCH_CACHE_MAX_ROWS) return;
  rememberListPayload(SECONDARY_STITCHED_CACHE, key, store);
}

function spanFromSecondaryMeta(
  meta: SecondaryDirectionsPayload["meta"],
  fallback: AgeSpan,
): AgeSpan {
  const start = typeof meta.startAge === "number" ? meta.startAge : fallback.start;
  const end = typeof meta.endAge === "number" ? meta.endAge : fallback.end;
  return { start, end };
}

function secondarySeedWindowForAgeRange(
  range: AgeRange,
  seek: DirectionsAgeSeek,
  method: SecondaryMethod,
): AgeSpan {
  const chunkYears = SECONDARY_STITCH_CHUNK_YEARS[method];
  const span = Math.max(0, range.end - range.start);
  if (span <= chunkYears) return { start: range.start, end: range.end };
  if (seek === "previous") {
    return {
      start: Math.max(range.start, range.end - chunkYears),
      end: range.end,
    };
  }
  return {
    start: range.start,
    end: Math.min(range.end, range.start + chunkYears),
  };
}

function secondarySeedAnchorAge(
  range: AgeRange,
  seek: DirectionsAgeSeek,
  method: SecondaryMethod,
): number {
  const window = secondarySeedWindowForAgeRange(range, seek, method);
  return seek === "previous" ? Math.max(window.start, window.end - 0.001) : window.start;
}

function lastSecondaryRowAge(rows: readonly SecondaryDirectionRow[]): number | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const age = rows[index]?.age;
    if (typeof age === "number" && Number.isFinite(age)) return age;
  }
  return null;
}

function spanFromSecondaryPayload(
  meta: SecondaryDirectionsPayload["meta"],
  fallback: AgeSpan,
  rows: readonly SecondaryDirectionRow[],
): AgeSpan {
  const span = spanFromSecondaryMeta(meta, fallback);
  if (!meta.truncated) return span;
  const lastAge = lastSecondaryRowAge(rows);
  if (lastAge == null || lastAge <= span.start) return span;
  return { ...span, end: Math.max(span.start, Math.min(span.end, lastAge)) };
}

function stitchedStoreCoversFocus(
  store: SecondaryStitchStore | null,
  focusDatetime: string | null | undefined,
): boolean {
  if (!store) return false;
  const range = rowDateRangeMs(store.rows, (row) => row.eventDatetime ?? row.date);
  if (range == null) return false;
  const targetMs = directionFocusTargetMsForRange(range, focusDatetime);
  return targetMs >= range.first && targetMs <= range.last;
}

function secondaryDirectionRowKey(row: SecondaryDirectionsPayload["directions"][number], index: number): string {
  return [
    "secondary-row",
    index,
    row.fields.promPlanet ?? row.prom,
    row.fields.aspectIndex ?? row.aspect,
    row.fields.sigPlanet ?? row.sig,
  ].join(":");
}

function circumambulationDisplayRowKey(row: CircumDisplayRow, index: number): string {
  if (row.kind === "participator") {
    return [
      "circum-row",
      index,
      row.kind,
      row.part.source ?? "",
      row.part.planetGlyph ?? row.part.planet ?? "",
      row.part.aspectDegree ?? "",
      row.term.signIndex ?? "",
    ].join(":");
  }
  return [
    "circum-row",
    index,
    row.kind,
    row.term.signIndex ?? "",
    row.term.termRulerPid ?? "",
  ].join(":");
}

function useQueuedPrimaryDirectionSettingsPatch({
  setSettings,
  setSettingsMeanNode,
  onCommitted,
}: {
  setSettings: React.Dispatch<React.SetStateAction<OptionsPrimaryDirections | null>>;
  setSettingsMeanNode: React.Dispatch<React.SetStateAction<boolean | null>>;
  onCommitted?: (options: OptionsPatchPayload) => void;
}) {
  const queuedPrimaryPatchRef = React.useRef<Partial<OptionsPrimaryDirections> | null>(null);
  const queuedOptionsPatchRef = React.useRef<OptionsPatch | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const inFlightRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const flushRef = React.useRef<() => void>(() => {});

  const flush = React.useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlightRef.current) return;
    const primaryPatch = queuedPrimaryPatchRef.current;
    const optionsPatch = queuedOptionsPatchRef.current;
    if (!hasPatchKeys(primaryPatch) && !hasPatchKeys(optionsPatch)) return;

    queuedPrimaryPatchRef.current = null;
    queuedOptionsPatchRef.current = null;
    inFlightRef.current = true;
    const requestPatch: OptionsPatch = { ...(optionsPatch ?? {}) };
    if (hasPatchKeys(primaryPatch)) {
      requestPatch.primaryDirections = {
        ...(requestPatch.primaryDirections ?? {}),
        ...primaryPatch,
      };
    }

    void patchOptions(requestPatch)
      .then((options) => {
        if (!mountedRef.current) return;
        const pendingPrimary = queuedPrimaryPatchRef.current;
        const hasPending =
          hasPatchKeys(pendingPrimary) || hasPatchKeys(queuedOptionsPatchRef.current);
        setSettings(
          hasPatchKeys(pendingPrimary)
            ? { ...options.primaryDirections, ...pendingPrimary }
            : options.primaryDirections,
        );
        setSettingsMeanNode(options.planetsPoints.meannode);
        if (!hasPending) {
          onCommitted?.(options);
        }
      })
      .catch(() => {})
      .finally(() => {
        inFlightRef.current = false;
        if (
          mountedRef.current &&
          (hasPatchKeys(queuedPrimaryPatchRef.current) || hasPatchKeys(queuedOptionsPatchRef.current))
        ) {
          timerRef.current = window.setTimeout(() => flushRef.current(), 0);
        }
      });
  }, [onCommitted, setSettings, setSettingsMeanNode]);

  React.useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return React.useCallback(
    (patch: Partial<OptionsPrimaryDirections>, optionsPatch?: OptionsPatch) => {
      const mergedPrimaryPatch = {
        ...(optionsPatch?.primaryDirections ?? {}),
        ...patch,
      };
      setSettings((prev) => (prev ? { ...prev, ...mergedPrimaryPatch } : prev));
      if (optionsPatch?.planetsPoints?.meannode != null) {
        setSettingsMeanNode(optionsPatch.planetsPoints.meannode);
      }
      queuedPrimaryPatchRef.current = {
        ...(queuedPrimaryPatchRef.current ?? {}),
        ...mergedPrimaryPatch,
      };
      if (optionsPatch) {
        const restPatch: OptionsPatch = { ...optionsPatch };
        delete restPatch.primaryDirections;
        queuedOptionsPatchRef.current = mergeOptionsPatch(queuedOptionsPatchRef.current, restPatch);
      }
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => flushRef.current(), PRIMARY_SETTINGS_PATCH_DEBOUNCE_MS);
    },
    [setSettings, setSettingsMeanNode],
  );
}

function scrollAnchorRowIndex(
  scroller: HTMLDivElement | null,
  rowCount: number,
  anchorRatio: number,
  rowHeight: number,
): number {
  if (!scroller || rowCount <= 0 || scroller.clientHeight <= 0) return -1;
  const raw =
    (scroller.scrollTop + scroller.clientHeight * anchorRatio - rowHeight / 2) /
    rowHeight;
  return Math.max(0, Math.min(rowCount - 1, Math.round(raw)));
}

function useScrollAgeAnchor<T>(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  rows: readonly T[],
  focusIndex: number,
  anchorRatio: number,
  rowHeight: number,
  ranges: readonly AgeRange[],
  ageOf: (row: T) => number | null | undefined,
): number {
  const [scrollAnchorIndex, setScrollAnchorIndex] = React.useState(-1);

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const nextIndex = scrollAnchorRowIndex(scroller, rows.length, anchorRatio, rowHeight);
      setScrollAnchorIndex((prev) => (prev === nextIndex ? prev : nextIndex));
    };
    const scheduleMeasure = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    scroller.addEventListener("scroll", scheduleMeasure, { passive: true });
    scroller.addEventListener(VIRTUAL_SCROLL_SYNC_EVENT, measure);
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    resizeObserver?.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", scheduleMeasure);
      scroller.removeEventListener(VIRTUAL_SCROLL_SYNC_EVENT, measure);
      resizeObserver?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [anchorRatio, rowHeight, rows.length, scrollerRef]);

  const anchorRow =
    scrollAnchorIndex >= 0 && scrollAnchorIndex < rows.length ? rows[scrollAnchorIndex] : undefined;
  if (anchorRow) return ageRangeIndexForAge(ranges, ageOf(anchorRow));
  const focusRow = focusIndex >= 0 && focusIndex < rows.length ? rows[focusIndex] : undefined;
  return ageRangeIndexForAge(ranges, focusRow ? ageOf(focusRow) : null);
}

function useAgeRangeEdgeLoader({
  active,
  enabled,
  scrollerRef,
  rowCount,
  loading,
  currentRange,
  hasPrevious = true,
  hasNext = true,
  rowHeight,
  onLoadRange,
}: {
  active: boolean;
  enabled: boolean;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  rowCount: number;
  loading: boolean;
  currentRange: AgeRange | null;
  hasPrevious?: boolean;
  hasNext?: boolean;
  rowHeight: number;
  onLoadRange: (range: AgeRange, direction: AgeRangeLoadDirection) => void;
}) {
  const lastRequestRef = React.useRef<string | null>(null);
  const edgeLatchRef = React.useRef<AgeRangeLoadDirection | null>(null);

  React.useEffect(() => {
    lastRequestRef.current = null;
    edgeLatchRef.current = null;
  }, [active, enabled]);

  React.useEffect(() => {
    if (!active || !enabled || !currentRange || rowCount <= 1) return undefined;
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;

    let wheelFrame = 0;
    const edgeIntentForWheel = (event: WheelEvent): AgeRangeLoadDirection | null => {
      if (Math.abs(event.deltaY) < 1) return null;
      return event.deltaY < 0 ? "previous" : "next";
    };
    const isAwayFromEdges = () => {
      const edgePx = rowHeight * 3;
      const maxTop = scroller.scrollHeight - scroller.clientHeight;
      return (
        maxTop > edgePx &&
        scroller.scrollTop > edgePx &&
        maxTop - scroller.scrollTop > edgePx
      );
    };
    const maybeLoad = (intent: AgeRangeLoadDirection) => {
      wheelFrame = 0;
      if (loading) return;
      const edgePx = rowHeight * 3;
      const maxTop = scroller.scrollHeight - scroller.clientHeight;
      if (maxTop <= edgePx) return;

      let direction: AgeRangeLoadDirection | null = null;
      if (
        intent === "previous" &&
        scroller.scrollTop <= edgePx &&
        hasPrevious &&
        currentRange.start > 0
      ) {
        direction = "previous";
      } else if (
        intent === "next" &&
        maxTop - scroller.scrollTop <= edgePx &&
        hasNext
      ) {
        direction = "next";
      }
      if (!direction) return;
      if (edgeLatchRef.current === direction) return;

      const range = adjacentAgeRange(currentRange, direction);
      if (!range) return;
      const key = `${direction}:${range.start}:${range.end}`;
      if (lastRequestRef.current === key) return;
      lastRequestRef.current = key;
      edgeLatchRef.current = direction;
      onLoadRange(range, direction);
    };
    const onWheel = (event: WheelEvent) => {
      const intent = edgeIntentForWheel(event);
      if (!intent || wheelFrame) return;
      wheelFrame = requestAnimationFrame(() => maybeLoad(intent));
    };
    const onScroll = () => {
      if (isAwayFromEdges()) {
        lastRequestRef.current = null;
        edgeLatchRef.current = null;
      }
    };

    scroller.addEventListener("wheel", onWheel, { passive: true });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("scroll", onScroll);
      if (wheelFrame) cancelAnimationFrame(wheelFrame);
    };
  }, [
    active,
    currentRange,
    enabled,
    hasNext,
    hasPrevious,
    loading,
    onLoadRange,
    rowHeight,
    rowCount,
    scrollerRef,
  ]);
}

function circumambulationFocusIndex(
  rows: CircumambulationPayload["directions"],
  targetMs: number,
): number {
  if (!rows.length) return -1;
  let nearestIndex = 0;
  let nearestDelta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const startMs = parseDateMs(row.dateStart);
    const endMs = parseDateMs(row.dateEnd);
    if (startMs != null && endMs != null && startMs <= targetMs && targetMs <= endMs) {
      return index;
    }
    const delta = Math.min(
      startMs == null ? Number.POSITIVE_INFINITY : Math.abs(startMs - targetMs),
      endMs == null ? Number.POSITIVE_INFINITY : Math.abs(endMs - targetMs),
    );
    if (delta < nearestDelta) {
      nearestDelta = delta;
      nearestIndex = index;
    }
  }
  return nearestIndex;
}

function scrollFocusedDirectionRow(
  scroller: HTMLDivElement | null,
  rowCount: number,
  anchorRatio: number,
  rowIndex: number | undefined,
  rowHeight: number,
): boolean {
  if (
    !scroller ||
    rowCount <= 0 ||
    rowIndex == null ||
    rowIndex < 0 ||
    rowHeight <= 0 ||
    scroller.clientHeight <= 0
  ) {
    return false;
  }
  const targetIndex = Math.max(0, Math.min(rowCount - 1, rowIndex));
  const rowTop = targetIndex * rowHeight;
  const targetTop = rowTop - scroller.clientHeight * anchorRatio + rowHeight / 2;
  const maxTop = Math.max(0, rowCount * rowHeight - scroller.clientHeight);
  const desiredTop = Math.max(0, Math.min(maxTop, targetTop));
  scroller.scrollTop = desiredTop;
  const applied = Math.abs(scroller.scrollTop - desiredTop) <= 2;
  if (applied) {
    dispatchVirtualScrollSync(scroller, true);
  }
  return applied;
}

type DirectionViewportAnchor = {
  scrollTop: number;
  rowHeight: number;
};

function captureDirectionViewport(
  scroller: HTMLDivElement | null,
  rowHeight: number,
): DirectionViewportAnchor | null {
  if (!scroller) return null;
  return { scrollTop: scroller.scrollTop, rowHeight };
}

function restoreDirectionViewport(
  scroller: HTMLDivElement | null,
  anchor: DirectionViewportAnchor,
  rowCount: number,
  rowHeight: number,
): boolean {
  if (!scroller || scroller.clientHeight <= 0) return false;
  const sourceRowHeight = anchor.rowHeight > 0 ? anchor.rowHeight : rowHeight;
  const translatedTop = (anchor.scrollTop / sourceRowHeight) * rowHeight;
  const maxTop = Math.max(0, rowCount * rowHeight - scroller.clientHeight);
  scroller.scrollTop = Math.max(0, Math.min(maxTop, translatedTop));
  dispatchVirtualScrollSync(scroller, true);
  return true;
}

function scheduleDirectionViewportRestore(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  anchor: DirectionViewportAnchor,
  rowCount: number,
  rowHeight: number,
): () => void {
  let frame = 0;
  let attempts = 0;
  let cancelled = false;
  const tick = () => {
    if (cancelled) return;
    if (restoreDirectionViewport(scrollerRef.current, anchor, rowCount, rowHeight)) return;
    attempts += 1;
    if (attempts < 30) {
      frame = requestAnimationFrame(tick);
    }
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}

function scheduleFocusedDirectionScroll(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  rowIndex: number,
  rowCount: number,
  anchorRatio: number,
  rowHeight: number,
): () => void {
  if (rowIndex < 0 || rowCount <= 0) return () => {};
  let frame = 0;
  let attempts = 0;
  let cancelled = false;
  const tick = () => {
    if (cancelled) return;
    const scroller = scrollerRef.current;
    if (scrollFocusedDirectionRow(scroller, rowCount, anchorRatio, rowIndex, rowHeight)) return;
    attempts += 1;
    if (attempts < 30) {
      frame = requestAnimationFrame(tick);
    }
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}

function useVirtualRows(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  rowCount: number,
  seedIndex: number,
  rowHeight: number,
) {
  const [viewport, setViewport] = React.useState({ scrollTop: 0, height: 0 });

  const measureNow = React.useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = {
      scrollTop: scroller.scrollTop,
      height: scroller.clientHeight,
    };
    setViewport((prev) =>
      prev.scrollTop === next.scrollTop && prev.height === next.height ? prev : next,
    );
  }, [scrollerRef]);

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;

    let frame = 0;
    const measure = () => {
      frame = 0;
      measureNow();
    };
    const measureSync = (event: Event) => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      // A programmatic long jump changes scrollTop before the virtual rows for
      // that viewport exist. Commit the new slice in the same event turn so the
      // browser never paints the old slice at the new offset (the PD-list flash).
      if ((event as CustomEvent<{ beforePaint?: boolean }>).detail?.beforePaint) {
        flushSync(measureNow);
      } else {
        // Prepend compensation runs inside a layout effect; its state update is
        // already pre-paint and must not nest flushSync inside React's commit.
        measureNow();
      }
    };
    const scheduleMeasure = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    scheduleMeasure();
    scroller.addEventListener("scroll", scheduleMeasure, { passive: true });
    scroller.addEventListener(VIRTUAL_SCROLL_SYNC_EVENT, measureSync);
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    resizeObserver?.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", scheduleMeasure);
      scroller.removeEventListener(VIRTUAL_SCROLL_SYNC_EVENT, measureSync);
      resizeObserver?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [measureNow, rowCount, scrollerRef]);

  return React.useMemo(() => {
    if (rowCount <= 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        paddingTop: 0,
        paddingBottom: 0,
      };
    }
    const seededStart =
      seedIndex >= 0 ? Math.max(0, Math.min(rowCount - 1, seedIndex)) : 0;
    const visibleStart =
      viewport.height > 0
        ? Math.floor(viewport.scrollTop / rowHeight)
        : seededStart;
    const visibleCount = Math.max(
      1,
      Math.ceil(viewport.height / rowHeight),
    );
    const startIndex = Math.max(0, visibleStart - VIRTUAL_OVERSCAN_ROWS);
    const endIndex = Math.min(
      rowCount,
      visibleStart + visibleCount + VIRTUAL_OVERSCAN_ROWS,
    );
    return {
      startIndex,
      endIndex,
      paddingTop: startIndex * rowHeight,
      paddingBottom: (rowCount - endIndex) * rowHeight,
    };
  }, [rowCount, rowHeight, seedIndex, viewport.height, viewport.scrollTop]);
}

function VirtualizedTableRows<T>({
  rows,
  loading,
  emptyLabel,
  colSpan,
  scrollerRef,
  initialIndex,
  rowHeight,
  renderRow,
}: {
  rows: readonly T[];
  loading: boolean;
  emptyLabel: string;
  colSpan: number;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  initialIndex: number;
  rowHeight: number;
  renderRow: (row: T, index: number) => React.ReactNode;
}) {
  const virtual = useVirtualRows(scrollerRef, rows.length, initialIndex, rowHeight);
  const visibleRows = rows.slice(virtual.startIndex, virtual.endIndex);

  if (rows.length === 0 && !loading) {
    return (
      <TableBody data-rendered-row-count={0} data-total-row-count={0}>
        <TableRow>
          <TableCell colSpan={colSpan} className="text-center text-muted-foreground">
            {emptyLabel}
          </TableCell>
        </TableRow>
      </TableBody>
    );
  }

  return (
    <TableBody
      data-rendered-row-count={visibleRows.length}
      data-total-row-count={rows.length}
    >
      {virtual.paddingTop > 0 ? (
        <VirtualSpacerRow colSpan={colSpan} height={virtual.paddingTop} />
      ) : null}
      {visibleRows.map((row, offset) => renderRow(row, virtual.startIndex + offset))}
      {virtual.paddingBottom > 0 ? (
        <VirtualSpacerRow colSpan={colSpan} height={virtual.paddingBottom} />
      ) : null}
    </TableBody>
  );
}

function VirtualSpacerRow({ colSpan, height }: { colSpan: number; height: number }) {
  return (
    <TableRow
      aria-hidden="true"
      data-virtual-spacer
      className="border-0 hover:bg-transparent"
      style={{ height }}
    >
      <TableCell colSpan={colSpan} className="border-0 p-0" style={{ height }} />
    </TableRow>
  );
}

function isTwinPromissor(promasp: number, sigasp: number): boolean {
  return (
    promasp === ASP_MIDPOINT ||
    sigasp === ASP_RAPTPARALLEL ||
    sigasp === ASP_RAPTCONTRAPARALLEL
  );
}

function aspectGlyph(aspId: number): string | null {
  if (aspId === ASP_CONJUNCTION) return null;
  return ASPECT_GLYPHS[aspId] ?? null;
}

function primaryPromDisplayParts(fields: DirectionRowFields): DirectionCellPart[] | null {
  if (fields.promParts?.length) return fields.promParts;
  const promGlyph = primaryFallbackGlyph(fields.prom, fields.promGlyph);
  const prom2Glyph = primaryFallbackGlyph(fields.prom2, fields.prom2Glyph);
  if (isTwinPromissor(fields.promasp, fields.sigasp)) {
    const parts = compactParts([
      glyphRun(promGlyph, fields.promColor, fields.promColorRole),
      glyphRun(prom2Glyph, fields.prom2Color, fields.prom2ColorRole),
    ]);
    if (parts.length) return parts;
    return fields.promParts ?? null;
  }
  if (promGlyph) {
    return compactParts([
      glyphRun(aspectGlyph(fields.promasp), fields.promAspectColor, fields.promAspectColorRole),
      glyphRun(promGlyph, fields.promColor, fields.promColorRole),
    ]);
  }
  return fields.promParts ?? null;
}

function primarySigDisplayParts(fields: DirectionRowFields): DirectionCellPart[] | null {
  if (fields.sigParts?.length) return fields.sigParts;
  const sigGlyph = primaryFallbackGlyph(fields.sigPoint, fields.sigGlyph);
  if (sigGlyph) {
    return compactParts([
      glyphRun(aspectGlyph(fields.sigasp), fields.sigAspectColor, fields.sigAspectColorRole),
      glyphRun(sigGlyph, fields.sigColor, fields.sigColorRole),
    ]);
  }
  if (fields.sigPoint === PRIMDIR_LOF && fields.sigGlyph) {
    return compactParts([
      glyphRun(aspectGlyph(fields.sigasp), fields.sigAspectColor, fields.sigAspectColorRole),
      glyphRun(fields.sigGlyph, fields.sigColor, fields.sigColorRole),
    ]);
  }
  return fields.sigParts ?? null;
}

function Glyph({
  ch,
  color,
  colorRole,
  className,
}: {
  ch: string;
  color?: string | null;
  colorRole?: string | null;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{ fontFamily: "'AriesMorinus'", color: semanticChartColor(colorRole, color) }}
      aria-hidden
    >
      {ch}
    </span>
  );
}

function NatalMarker({
  color,
  colorRole,
}: {
  color?: string | null;
  colorRole?: string | null;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center text-[length:var(--aries-font-size-section)] font-semibold italic leading-none text-muted-foreground"
      style={{ color: semanticChartColor(colorRole, color) }}
      aria-hidden
    >
      n
    </span>
  );
}

const DEFAULT_SIGN_ELEMENT_COLORS = ["#d6523c", "#76924a", "#588ad6", "#44a4ac"] as const;

function rgbToCss(rgb: readonly number[] | null | undefined): string | null {
  if (!rgb || rgb.length < 3) return null;
  const [r, g, b] = rgb;
  return `#${[r, g, b]
    .map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function signElementColors(colors?: OptionsColors | null): readonly string[] {
  if (!colors) return DEFAULT_SIGN_ELEMENT_COLORS;
  return [
    rgbToCss(colors.clrsignelementfire) ?? DEFAULT_SIGN_ELEMENT_COLORS[0],
    rgbToCss(colors.clrsignelementearth) ?? DEFAULT_SIGN_ELEMENT_COLORS[1],
    rgbToCss(colors.clrsignelementair) ?? DEFAULT_SIGN_ELEMENT_COLORS[2],
    rgbToCss(colors.clrsignelementwater) ?? DEFAULT_SIGN_ELEMENT_COLORS[3],
  ];
}

function listSignColor(
  color: string | null | undefined,
  signIndex: number | null | undefined,
  elementColors: readonly string[],
): string | null {
  const trimmed = (color ?? "").trim().toLowerCase();
  const compact = trimmed.replace(/\s+/g, "");
  const isBlack = compact === "#000" || compact === "#000000" || compact === "black" || compact === "rgb(0,0,0)";
  if (trimmed && !isBlack) return color ?? null;
  if (signIndex == null || !Number.isFinite(signIndex)) return color ?? null;
  return elementColors[((Math.trunc(signIndex) % 12) + 12) % 12 % 4] ?? color ?? null;
}

function LiveHoverSummary({ value }: { value: string }) {
  return (
    <span
      title={value}
      className="block h-5 w-48 max-w-[32vw] overflow-hidden text-right text-[length:var(--aries-font-size-small)] leading-5 text-muted-foreground"
      style={{
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 1,
      }}
    >
      {value}
    </span>
  );
}

function DirectionParts({
  parts,
  title,
  colorize = false,
}: {
  parts?: DirectionCellPart[] | null;
  title?: string | null;
  colorize?: boolean;
}) {
  if (!parts?.length) return null;
  return (
    <span
      className="inline-flex items-center justify-center gap-1 align-middle"
      title={title ?? undefined}
    >
      {parts.map((part, index) =>
        part.marker === "natal" ? (
          <NatalMarker
            key={`${part.text}:${index}`}
            color={colorize ? part.color : null}
            colorRole={colorize ? part.colorRole : null}
          />
        ) : part.glyph ? (
          <Glyph
            key={`${part.text}:${index}`}
            ch={part.text}
            color={colorize ? part.color : null}
            colorRole={colorize ? part.colorRole : null}
            className="shrink-0"
          />
        ) : (
          <span
            key={`${part.text}:${index}`}
            style={{ color: colorize ? semanticChartColor(part.colorRole, part.color) : undefined }}
          >
            {part.text}
          </span>
        ),
      )}
    </span>
  );
}

export function DateTransitLink({
  documentId,
  eventDatetime,
  eventJd,
  sessionLabel,
  children,
}: {
  documentId: string;
  eventDatetime?: string | null;
  eventJd?: number | null;
  sessionLabel?: string | null;
  children: React.ReactNode;
}) {
  const applyTimedChartOpenResult = useWorkspaceStore((s) => s.applyTimedChartOpenResult);
  const showRadix = useWorkspaceStore((s) => s.timedChartShowRadix);
  const disabled = !eventDatetime && eventJd == null;
  const openTransit = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;
      // Gate the open like transit-search does: workspace WS events that arrive
      // mid-POST are deferred, then tree + active document apply atomically from
      // the response. Without the gate, active_document.changed lands before the
      // tree contains the new doc — activeDoc goes null for one commit and the
      // whole workspace (chart surface + right pane) unmounts and remounts.
      const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
      void openDirectionsTimedChart(
        documentId,
        "transits",
        eventDatetime ?? "",
        eventJd,
        null,
        sessionLabel,
        showRadix,
      )
        .then((result) => applyTimedChartOpenResult(result))
        .catch((err) => console.error("[direction-date-transit]", err))
        .finally(finishSnapshotCommand);
    },
    [applyTimedChartOpenResult, disabled, documentId, eventDatetime, eventJd, sessionLabel, showRadix],
  );
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={openTransit}
      className={cn(
        LIST_TEXT_CLASSES.date,
        "inline-block cursor-pointer whitespace-nowrap tabular-nums underline-offset-2 hover:text-primary hover:underline",
        disabled ? "pointer-events-none cursor-default" : "",
      )}
    >
      {children}
    </button>
  );
}

function PromCell({
  promGlyph,
  prom2Glyph,
  promasp,
  sigasp,
  text,
  parts,
  colorize,
  color,
  prom2Color,
  aspectColor,
  colorRole,
  prom2ColorRole,
  aspectColorRole,
}: {
  promGlyph?: string | null;
  prom2Glyph?: string | null;
  promasp: number;
  sigasp: number;
  text: string;
  parts?: DirectionCellPart[] | null;
  colorize?: boolean;
  color?: string | null;
  prom2Color?: string | null;
  aspectColor?: string | null;
  colorRole?: string | null;
  prom2ColorRole?: string | null;
  aspectColorRole?: string | null;
}) {
  if (parts?.length && parts.some((part) => part.glyph)) {
    return <DirectionParts parts={parts} title={text} colorize={colorize} />;
  }
  if (isTwinPromissor(promasp, sigasp)) {
    if (promGlyph && prom2Glyph) {
      return (
        <span className="inline-flex items-center gap-1" title={text}>
          <Glyph ch={promGlyph} color={color} colorRole={colorRole} />
          <Glyph ch={prom2Glyph} color={prom2Color} colorRole={prom2ColorRole} />
        </span>
      );
    }
    if (parts?.length) return <DirectionParts parts={parts} title={text} colorize={colorize} />;
    return <span>{text}</span>;
  }
  return (
    <PointCell
      glyph={promGlyph}
      aspId={promasp}
      text={text}
      color={color}
      aspectColor={aspectColor}
      colorRole={colorRole}
      aspectColorRole={aspectColorRole}
    />
  );
}

function PointCell({
  glyph,
  aspId,
  text,
  parts,
  colorize,
  color,
  aspectColor,
  colorRole,
  aspectColorRole,
}: {
  glyph?: string | null;
  aspId: number;
  text: string;
  parts?: DirectionCellPart[] | null;
  colorize?: boolean;
  color?: string | null;
  aspectColor?: string | null;
  colorRole?: string | null;
  aspectColorRole?: string | null;
}) {
  if (parts?.length && parts.some((part) => part.glyph)) {
    return <DirectionParts parts={parts} title={text} colorize={colorize} />;
  }
  if (!glyph) return <span>{text}</span>;
  const asp = aspectGlyph(aspId);
  return (
    <span className="inline-flex items-center gap-1">
      {asp != null ? <Glyph ch={asp} color={aspectColor} colorRole={aspectColorRole} /> : null}
      <Glyph ch={glyph} color={color} colorRole={colorRole} />
    </span>
  );
}

// --- Timed-chart context menu (shared across all three tabs, and reused by the
// Zodiacal Releasing pane — ZRWnd binds the same commonwnd actions,
// zodiacalreleasingwnd.py:197-199,863-879). The three items mirror
// commonwnd.add_timed_chart_menu_actions (commonwnd.py:63-85). Each opens
// a REAL child document via POST /api/directions/timed-chart.
export function TimedChartContextMenu({
  documentId,
  eventDatetime,
  eventJd,
  timeContext,
  sessionLabel,
  beforeTimedItems,
  afterTimedItems,
  onActionError,
  children,
}: {
  documentId: string;
  eventDatetime: string | null;
  eventJd?: number | null;
  timeContext?: Record<string, unknown> | null;
  sessionLabel?: string | null;
  beforeTimedItems?: React.ReactNode;
  afterTimedItems?: React.ReactNode;
  onActionError?: (message: string | null) => void;
  children: React.ReactElement;
}) {
  const t = useT();
  const tf = useTFallback();
  const applyTimedChartOpenResult = useWorkspaceStore((s) => s.applyTimedChartOpenResult);
  const showRadix = useWorkspaceStore((s) => s.timedChartShowRadix);
  const fire = React.useCallback(
    (action: TimedChartAction) => {
      if (!eventDatetime && eventJd == null) return;
      onActionError?.(null);
      const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
      void openDirectionsTimedChart(
        documentId,
        action,
        eventDatetime ?? "",
        eventJd,
        timeContext,
        sessionLabel,
        showRadix,
      )
        .then((result) => {
          applyTimedChartOpenResult(result);
          if (!result.documentId) {
            throw new Error(tf("dirview.timedChartNoDocument", "Timed chart action did not open a document."));
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          onActionError?.(message || tf("dirview.timedChartFailed", "Timed chart action failed."));
          console.error("[timed-chart-action]", err);
        })
        .finally(finishSnapshotCommand);
    },
    [applyTimedChartOpenResult, documentId, eventDatetime, eventJd, onActionError, timeContext, sessionLabel, showRadix, tf],
  );
  const disabled = !eventDatetime && eventJd == null;
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-64">
        {beforeTimedItems}
        <ContextMenuItem disabled={disabled} onClick={() => fire("solar")}>
          {t("dirview.openContainingSolarRevolution")}
        </ContextMenuItem>
        <ContextMenuItem disabled={disabled} onClick={() => fire("transits")}>
          {t("dirview.openAsTransit")}
        </ContextMenuItem>
        <ContextMenuItem disabled={disabled} onClick={() => fire("chart")}>
          {t("dirview.openAsChart")}
        </ContextMenuItem>
        {afterTimedItems}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// --- "PDs in Chart" row action. Aries maps a calculated Z row to the
// celestial projection and an M row to the terrestrial projection, preserving
// the row's own coordinate system instead of exposing incompatible choices.
// It is present only for a radix PD list, never the return lists.
function PdInChartMenuItem({
  documentId,
  arc,
  mode,
  direct,
  eventJd,
  eventDatetime,
  sessionLabel,
  directionEvent,
  children,
  onActionError,
}: {
  documentId: string;
  arc: number;
  mode: "celestial" | "terrestrial";
  direct: boolean;
  eventJd: number;
  eventDatetime: string | null;
  sessionLabel: string;
  directionEvent: DirectionRowFields;
  children: React.ReactNode;
  onActionError?: (message: string | null) => void;
}) {
  const tf = useTFallback();
  const applyTimedChartOpenResult = useWorkspaceStore((s) => s.applyTimedChartOpenResult);
  const open = React.useCallback(() => {
    onActionError?.(null);
    const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
    void openDirectionsPdInChart(documentId, arc, {
      mode,
      direct,
      eventJd,
      whenIso: eventDatetime,
      directionEvent,
      sessionLabel,
    })
      .then((result) => {
        applyTimedChartOpenResult(result);
        if (!result.documentId) throw new Error(tf("dirview.pdsInChartNoDocument", "PDs-in-Chart did not open a document."));
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        onActionError?.(message || tf("dirview.pdsInChartFailed", "PDs-in-Chart failed."));
        console.error("[pd-in-chart-action]", err);
      })
      .finally(finishSnapshotCommand);
  }, [applyTimedChartOpenResult, arc, direct, directionEvent, documentId, eventDatetime, eventJd, mode, onActionError, sessionLabel, tf]);
  return (
    <ContextMenuItem onClick={open}>
      {children}
    </ContextMenuItem>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the textarea path; Tauri/Chromium can reject focused menu writes.
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) throw new Error("Clipboard write was blocked");
}

// --- Live PrimDirs settings (the desktop PrimDirsLiveFrame, primarydirsdlg.py).
// Committed live via POST /api/options {primaryDirections:{…}} — no OK/Cancel.
// The daemon's options.changed re-fetch is wired in the PD panel below.

export function DirectionsView({
  sourceName,
  source,
  documentId,
  cursorDocumentId,
  focusDocumentId,
  focusDatetime,
  followStepBursts = false,
  openSeq,
  initialTab = "primary",
  initialPrimaryMode = "radix",
  initialPrimaryDirection,
  secondaryMethod = "secondary",
  customSignificator,
  lockTechnique = false,
  includeTemporal = false,
  onClose,
}: {
  sourceName: string;
  source?: string;
  documentId: string;
  cursorDocumentId?: string;
  focusDocumentId?: string;
  focusDatetime?: string;
  followStepBursts?: boolean;
  followPolicy?: ListFollowPolicy;
  openSeq?: number;
  initialTab?: DirectionsTab;
  initialPrimaryMode?: Mode;
  initialPrimaryDirection?: number;
  secondaryMethod?: SecondaryMethod;
  customSignificator?: DirectionCustomSignificator | null;
  lockTechnique?: boolean;
  includeTemporal?: boolean;
  onClose?: () => void;
}) {
  const t = useT();
  const rowHeight = useListRowHeight("symbolic");
  const [tab, setTab] = React.useState<DirectionsTopTab>(() => topTabFromInitial(initialTab));
  const [primarySurface, setPrimarySurface] = React.useState<PrimaryDirectionsSurface>(() =>
    primarySurfaceFromInitial(initialTab),
  );
  const lastSessionChange = useDaemonWorkspaceStore((s) => s.lastSessionChange);
  const rectificationInFlightRef = React.useRef(false);
  const suppressRectificationSessionUntilRef = React.useRef(0);
  const radixRefreshSeq = useDirectionsRadixRefreshSeq(
    documentId,
    cursorDocumentId ?? documentId,
    rectificationInFlightRef,
    suppressRectificationSessionUntilRef,
  );
  const [localRectificationSeq, setLocalRectificationSeq] = React.useState(0);
  const handleRectificationStepStart = React.useCallback(() => {
    rectificationInFlightRef.current = true;
  }, []);
  const handleRectificationCommitted = React.useCallback(() => {
    rectificationInFlightRef.current = false;
    suppressRectificationSessionUntilRef.current =
      Date.now() + RECTIFICATION_SESSION_ECHO_SUPPRESS_MS;
    setLocalRectificationSeq((seq) => seq + 1);
  }, []);
  const handleRectificationSettled = React.useCallback(() => {
    rectificationInFlightRef.current = false;
  }, []);
  const directionRadixRefreshSeq = radixRefreshSeq + localRectificationSeq;
  const settledFocusDatetime = useStepSettledValue(
    focusDatetime ?? null,
    focusDocumentId ?? cursorDocumentId ?? documentId,
    lastSessionChange,
  );
  const renderedFocusDatetime = followStepBursts
    ? focusDatetime ?? null
    : settledFocusDatetime;
  React.useEffect(() => {
    queueMicrotask(() => {
      setTab(topTabFromInitial(initialTab));
      setPrimarySurface(primarySurfaceFromInitial(initialTab));
    });
  }, [documentId, initialTab, openSeq]);

  return (
    <Tabs
      value={tab}
      onValueChange={lockTechnique ? undefined : (value) => setTab(value as DirectionsTopTab)}
      className="font-morinus-text flex h-full min-h-0 w-full flex-col gap-0 bg-background"
    >
      {!lockTechnique ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          {onClose ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onClose}
              aria-label={t("dirview.closeDirections")}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
          <TabsList className="self-start">
            <TabsTrigger value="primary">{t("dirview.primary")}</TabsTrigger>
            <TabsTrigger value="secondary">{t("dirview.secondary")}</TabsTrigger>
          </TabsList>
        </div>
      ) : null}
      <TabsContent value="primary" className="flex flex-1 min-h-0 flex-col">
        {primarySurface === "circumambulation" ? (
          <CircumambulationPanel
            sourceName={sourceName}
            source={source}
            documentId={documentId}
            cursorDocumentId={cursorDocumentId ?? documentId}
            focusDatetime={renderedFocusDatetime ?? undefined}
            openSeq={openSeq}
            initialMode={initialPrimaryMode}
            customSignificator={customSignificator}
            includeTemporal={includeTemporal}
            lockMode={lockTechnique}
            radixRefreshSeq={directionRadixRefreshSeq}
            active={tab === "primary"}
            onRectificationStepStart={handleRectificationStepStart}
            onRectificationCommitted={handleRectificationCommitted}
            onRectificationSettled={handleRectificationSettled}
            onShowPrimaryDirections={
              lockTechnique ? undefined : () => setPrimarySurface("directions")
            }
            rowHeight={rowHeight}
          />
        ) : (
          <PrimaryDirectionsPanel
            sourceName={sourceName}
            source={source}
            documentId={documentId}
            cursorDocumentId={cursorDocumentId ?? documentId}
            focusDatetime={renderedFocusDatetime ?? undefined}
            openSeq={openSeq}
            initialMode={initialPrimaryMode}
            initialDirection={initialPrimaryDirection}
            customSignificator={customSignificator}
            includeTemporal={includeTemporal}
            lockMode={lockTechnique}
            radixRefreshSeq={directionRadixRefreshSeq}
            active={tab === "primary"}
            onRectificationStepStart={handleRectificationStepStart}
            onRectificationCommitted={handleRectificationCommitted}
            onRectificationSettled={handleRectificationSettled}
            onShowCircumambulations={
              lockTechnique ? undefined : () => setPrimarySurface("circumambulation")
            }
            rowHeight={rowHeight}
          />
        )}
      </TabsContent>
      <TabsContent value="secondary" className="flex flex-1 min-h-0 flex-col">
        <SecondaryDirectionsPanel
          sourceName={sourceName}
          source={source}
          documentId={documentId}
          cursorDocumentId={cursorDocumentId ?? documentId}
          focusDatetime={renderedFocusDatetime ?? undefined}
          initialMethod={secondaryMethod}
          includeTemporal={includeTemporal}
          lockMethod={lockTechnique}
          radixRefreshSeq={directionRadixRefreshSeq}
          active={tab === "secondary"}
          onRectificationStepStart={handleRectificationStepStart}
          onRectificationCommitted={handleRectificationCommitted}
          onRectificationSettled={handleRectificationSettled}
          rowHeight={rowHeight}
        />
      </TabsContent>
    </Tabs>
  );
}

function PrimaryDirectionsPanel({
  sourceName,
  source,
  documentId,
  cursorDocumentId,
  focusDatetime,
  openSeq,
  initialMode,
  initialDirection,
  customSignificator,
  includeTemporal,
  lockMode,
  radixRefreshSeq,
  active,
  onRectificationStepStart,
  onRectificationCommitted,
  onRectificationSettled,
  onShowCircumambulations,
  rowHeight,
}: {
  sourceName: string;
  source?: string;
  documentId: string;
  cursorDocumentId?: string;
  focusDatetime?: string;
  openSeq?: number;
  initialMode: Mode;
  initialDirection?: number;
  customSignificator?: DirectionCustomSignificator | null;
  includeTemporal: boolean;
  lockMode: boolean;
  radixRefreshSeq: number;
  active: boolean;
  onRectificationStepStart: () => void;
  onRectificationCommitted: () => void;
  onRectificationSettled: () => void;
  onShowCircumambulations?: () => void;
  rowHeight: number;
}) {
  const t = useT();
  const rowHeightRef = React.useRef(rowHeight);
  React.useLayoutEffect(() => {
    rowHeightRef.current = rowHeight;
  }, [rowHeight]);
  const directionOptions = React.useMemo(
    () => [
      { value: PRIMARY_DIRECTION_DIRECT, label: t("dirview.direct") },
      { value: PRIMARY_DIRECTION_CONVERSE, label: t("dirview.converse") },
      { value: PRIMARY_DIRECTION_BOTH, label: t("dirview.both") },
    ],
    [t],
  );
  const primaryModeOptions = React.useMemo(
    () => [
      { value: "radix" as Mode, label: t("dirview.radixList") },
      { value: "sr" as Mode, label: t("dirview.annual") },
      { value: "lr" as Mode, label: t("dirview.monthly") },
    ],
    [t],
  );
  const customSignificatorKey = customSignificatorCacheKey(customSignificator);
  const initialDirectionValue = normalizePrimaryDirection(initialDirection);
  const initialReferenceDatetime = initialMode === "radix" ? null : focusDatetime ?? null;
  const initialPayloadCacheKey = initialDirectionValue == null
    ? null
    : listCacheKey({
        documentId,
        sourceName,
        source,
        direction: initialDirectionValue,
        mode: initialMode,
        year: null,
        ageWindow: null,
        ageSeek: "exact",
        referenceDatetime: initialReferenceDatetime,
        customSignificator: customSignificatorKey,
        includeTemporal,
      });
  const [selectedDirection, setSelectedDirection] = React.useState<number | null>(
    () => initialDirectionValue,
  );
  const [mode, setMode] = React.useState<Mode>(initialMode);
  const [year, setYear] = React.useState<number | null>(null);
  const [payload, setPayload] = React.useState<DirectionsPayload | null>(() =>
    initialPayloadCacheKey == null
      ? null
      : getCachedListPayload<DirectionsPayload>(PRIMARY_DIRECTIONS_CACHE, initialPayloadCacheKey),
  );
  const [settings, setSettings] = React.useState<OptionsPrimaryDirections | null>(null);
  const [settingsMeanNode, setSettingsMeanNode] = React.useState<boolean | null>(null);
  const [settingsPlanetGlyphs, setSettingsPlanetGlyphs] = React.useState<readonly string[]>(
    PRIMARY_SETTINGS_PLANET_GLYPHS,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [ageWindow, setAgeWindow] = React.useState<AgeWindow>(null);
  const [ageSeek, setAgeSeek] = React.useState<DirectionsAgeSeek>("exact");
  const [targetAgeRange, setTargetAgeRange] = React.useState<AgeRange | null>(null);
  const [targetAgeSeek, setTargetAgeSeek] = React.useState<DirectionsAgeSeek>("exact");
  const [ageRangePageStart, setAgeRangePageStart] = React.useState(0);
  const [hoverSummary, setHoverSummary] = React.useState<string | null>(null);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const rectificationViewportRef = React.useRef<DirectionViewportAnchor | null>(null);
  const requestSeqRef = React.useRef(0);
  const optionsSeq = useDirectionsOptionsSeq();
  const layoutPreset = useListLayoutPreset();
  const rectificationDocumentId = cursorDocumentId ?? documentId;
  const optionsPreview = React.useMemo(
    () => primaryDirectionsPreviewOptionsPatch(settings, settingsMeanNode),
    [settings, settingsMeanNode],
  );
  const optionsPreviewKey = React.useMemo(
    () => listCacheKey(optionsPreview ?? {}),
    [optionsPreview],
  );
  const settingsDefaultDirection = defaultPrimaryDirectionFromSettings(settings);
  const direction =
    selectedDirection ?? settingsDefaultDirection ?? PRIMARY_DIRECTION_DIRECT;
  const primaryRequestReady = selectedDirection != null || settings != null;
  const reportTemporalLens = useTemporalConfluenceLensReporter();
  React.useEffect(() => {
    if (!primaryRequestReady) return;
    reportTemporalLens({
      direction:
        direction === PRIMARY_DIRECTION_CONVERSE
          ? "converse"
          : direction === PRIMARY_DIRECTION_BOTH
            ? "both"
            : "direct",
      mode,
    });
  }, [direction, mode, primaryRequestReady, reportTemporalLens]);
  const payloadReferenceDatetime =
    mode === "radix" || (mode === "sr" && year != null) ? null : focusDatetime ?? null;
  const payloadCacheKey = React.useMemo(
    () =>
      listCacheKey({
        documentId,
        sourceName,
        source,
        direction,
        mode,
        year,
        optionsPreviewKey,
        ageWindow,
        ageSeek,
        referenceDatetime: payloadReferenceDatetime,
        radixRefreshSeq,
        customSignificator: customSignificatorKey,
        includeTemporal,
      }),
    [ageSeek, ageWindow, customSignificatorKey, direction, documentId, includeTemporal, mode, optionsPreviewKey, payloadReferenceDatetime, radixRefreshSeq, source, sourceName, year],
  );
  React.useEffect(() => {
    const controller = new AbortController();
    fetchOptions(controller.signal)
      .then((o) => {
        setSettings(o.primaryDirections);
        setSettingsMeanNode(o.planetsPoints.meannode);
        setSettingsPlanetGlyphs(primarySettingsPlanetGlyphs(o.catalog));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [optionsSeq]);

  const captureRectificationViewport = React.useCallback(() => {
    onRectificationStepStart();
    rectificationViewportRef.current = captureDirectionViewport(scrollerRef.current, rowHeight);
  }, [onRectificationStepStart, rowHeight]);

  React.useEffect(() => {
    queueMicrotask(() => {
      setMode(initialMode);
      setSelectedDirection(normalizePrimaryDirection(initialDirection));
      setAgeWindow(null);
      setTargetAgeRange(null);
      setTargetAgeSeek("exact");
      setAgeSeek("exact");
      if (initialMode !== "sr") setYear(null);
    });
  }, [documentId, initialDirection, initialMode, openSeq]);

  React.useEffect(() => {
    if (!primaryRequestReady) {
      queueMicrotask(() => {
        setPayload(null);
        setLoading(true);
        setError(null);
      });
      return;
    }
    const controller = new AbortController();
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    const cached = getCachedListPayload<DirectionsPayload>(PRIMARY_DIRECTIONS_CACHE, payloadCacheKey);
    // Defer the "loading" flag out of the synchronous effect body (React 19
    // rule react-hooks/set-state-in-effect): the request itself is async.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      if (cached) {
        setPayload(cached);
      }
      setLoading(!cached);
      setError(null);
    });
    const isReturnMode = mode !== "radix";
    const request =
      isReturnMode
        ? fetchAnnualDirections(
            sourceName,
            {
              direction,
              returnKind: mode === "lr" ? "lunar" : "solar",
              referenceDatetime: payloadReferenceDatetime ?? undefined,
              ...(mode === "sr" && year != null ? { year } : {}),
              source,
              documentId,
              customSignificator,
              optionsPreview,
              includeTemporal,
            },
            controller.signal,
          )
        : fetchDirections(
            sourceName,
            {
              range: 4,
              direction,
              source,
              documentId,
              ...(ageWindow
                ? { startAge: ageWindow.start, endAge: ageWindow.end, seek: ageSeek }
                : {}),
              customSignificator,
              optionsPreview,
              includeTemporal,
            },
            controller.signal,
          );
    request
      .then((data) => {
        if (requestSeq !== requestSeqRef.current) return;
        rememberListPayload(PRIMARY_DIRECTIONS_CACHE, payloadCacheKey, data);
        React.startTransition(() => {
          setPayload(data);
          if (
            mode === "radix" &&
            data.meta.windowed &&
            typeof data.meta.startAge === "number" &&
            typeof data.meta.endAge === "number"
          ) {
            const nextRange = {
              start: data.meta.startAge,
              end: data.meta.endAge,
              label: ageRangeLabel(data.meta.startAge, data.meta.endAge),
            };
            setAgeWindow((prev) =>
              prev == null || (prev.start === nextRange.start && prev.end === nextRange.end)
                ? prev
                : { start: nextRange.start, end: nextRange.end },
            );
            setTargetAgeRange((prev) =>
              prev?.start === nextRange.start && prev.end === nextRange.end ? prev : nextRange,
            );
            setAgeRangePageStart((prev) => {
              const nextPageStart = ageRangePageStartForAge(nextRange.start);
              return prev === nextPageStart ? prev : nextPageStart;
            });
            setAgeSeek((prev) => (prev === "exact" ? prev : "exact"));
          }
        });
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        if (requestSeq !== requestSeqRef.current) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (requestSeq === requestSeqRef.current) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [sourceName, source, documentId, direction, mode, year, ageWindow, ageSeek, payloadReferenceDatetime, optionsPreview, radixRefreshSeq, customSignificator, includeTemporal, payloadCacheKey, primaryRequestReady]);

  const commitPrimarySettingsPatch = useQueuedPrimaryDirectionSettingsPatch({
    setSettings,
    setSettingsMeanNode,
  });
  const onPatchSettings = React.useCallback(
    (patch: Partial<OptionsPrimaryDirections>, optionsPatch?: OptionsPatch) => {
      if (
        patch.primarydir === 4 ||
        optionsPatch?.primaryDirections?.primarydir === 4 ||
        patch.pdmorinpromittorset === true ||
        optionsPatch?.primaryDirections?.pdmorinpromittorset === true
      ) {
        setSelectedDirection(PRIMARY_DIRECTION_BOTH);
      }
      commitPrimarySettingsPatch(patch, optionsPatch);
    },
    [commitPrimarySettingsPatch],
  );

  const columns = React.useMemo(
    () =>
      payload?.meta.columns ?? [
        t("dirview.mz"),
        t("dirview.prom"),
        t("dirview.dc"),
        t("dirview.sig"),
        t("dirview.arc"),
        t("dirview.date"),
      ],
    [payload, t],
  );
  const primaryColumnOrder = React.useMemo(
    () =>
      listKeyDisplayOrder(PRIMARY_DIRECTION_COLUMN_KEYS, layoutPreset, {
        dateKeys: ["date"],
        eventKeys: ["prom", "sig"],
      }),
    [layoutPreset],
  );
  const primaryResize = useResizableTableColumns({
    storageKey: "directions:primary",
    columnIds: primaryColumnOrder,
  });
  const primaryColumnLabels = React.useMemo<Record<PrimaryDirectionColumnKey, string>>(
    () => ({
      mz: columns[0],
      prom: columns[1],
      dc: columns[2],
      sig: columns[3],
      arc: columns[4],
      date: columns[5],
    }),
    [columns],
  );
  const rows = React.useMemo(() => payload?.directions ?? [], [payload]);
  const temporalCoverage = React.useMemo(
    () =>
      authoritativeTemporalCoverage(payload?.meta.temporalCoverage)
      ?? temporalCoverageFromRows(rows),
    [payload?.meta.temporalCoverage, rows],
  );
  useTemporalConfluenceRows(rows, temporalCoverage);
  const glyphColorRows = settings?.pdlistglyphcolors ?? payload?.meta.listGlyphColors ?? false;
  const isReturnMode = mode !== "radix";
  const showNatalPromissors = settings?.pdrevshownatalpromissors ?? payload?.meta.showNatalPromissors ?? false;
  const returnLabel = payload?.meta.returnLabel ?? payload?.meta.solarRevolutionLabel;
  const ageRanges = React.useMemo(() => ageRangesForPage(ageRangePageStart), [ageRangePageStart]);
  const focusTargetMs = React.useMemo(
    () => directionFocusTargetMs(rows, focusDatetime, (row) => row.date),
    [focusDatetime, rows],
  );
  const pinnedTemporalRowId = useTemporalPinnedRowId();
  const pinnedTemporalIndex = pinnedTemporalRowId
    ? rows.findIndex((row) => row.temporal?.rowId === pinnedTemporalRowId)
    : -1;
  const focusIndex =
    pinnedTemporalIndex >= 0
      ? pinnedTemporalIndex
      : targetAgeRange
        ? ageRangeTargetIndex(rows, targetAgeRange, (row) => row.age, targetAgeSeek)
        : nearestDateIndex(rows, focusTargetMs, (row) => row.date);
  useFixedRowHeightAnchor(scrollerRef, rows.length, rowHeight, {
    enabled: active,
    syncEvent: VIRTUAL_SCROLL_SYNC_EVENT,
  });
  const visibleAgeAnchorIdx = useScrollAgeAnchor(
    scrollerRef,
    rows,
    focusIndex,
    PRIMARY_FOCUS_ANCHOR,
    rowHeight,
    ageRanges,
    (row) => row.age,
  );
  const currentPrimaryAgeRange = React.useMemo<AgeRange>(() => {
    if (ageWindow) {
      return {
        start: ageWindow.start,
        end: ageWindow.end,
        label: ageRangeLabel(ageWindow.start, ageWindow.end),
      };
    }
    return ageRanges[visibleAgeAnchorIdx] ?? ageRanges[0];
  }, [ageRanges, ageWindow, visibleAgeAnchorIdx]);
  const scrollOrLoadAgeRange = React.useCallback(
    (range: AgeRange, seek: DirectionsAgeSeek = "exact") => {
      const rowIndex = ageRangeTargetIndex(rows, range, (row) => row.age, seek);
      if (rowIndex >= 0) {
        if (ageWindow) {
          setTargetAgeRange(range);
          setTargetAgeSeek(seek);
          setAgeWindow(null);
          setAgeSeek("exact");
          return;
        }
        setTargetAgeRange(null);
        setTargetAgeSeek("exact");
        void scheduleFocusedDirectionScroll(
          scrollerRef,
          rowIndex,
          rows.length,
          PRIMARY_FOCUS_ANCHOR,
          rowHeight,
        );
        return;
      }
      setTargetAgeRange(range);
      setTargetAgeSeek(seek);
      setAgeWindow({ start: range.start, end: range.end });
      setAgeSeek(seek);
    },
    [ageWindow, rowHeight, rows],
  );
  const jumpToAgeAnchor = React.useCallback(
    (index: number) => {
      const range = ageRanges[index] ?? ageRanges[0];
      scrollOrLoadAgeRange(range);
    },
    [ageRanges, scrollOrLoadAgeRange],
  );
  const showPreviousAgeRanges = React.useCallback(() => {
    const end = Math.max(0, currentPrimaryAgeRange.start);
    const target = {
      start: Math.max(0, end - 25),
      end,
      label: ageRangeLabel(Math.max(0, end - 25), end),
    };
    setAgeRangePageStart(ageRangePageStartForAge(target.start));
    scrollOrLoadAgeRange(target, "previous");
  }, [currentPrimaryAgeRange, scrollOrLoadAgeRange]);
  const showNextAgeRanges = React.useCallback(() => {
    const target = {
      start: currentPrimaryAgeRange.end,
      end: currentPrimaryAgeRange.end + 25,
      label: ageRangeLabel(currentPrimaryAgeRange.end, currentPrimaryAgeRange.end + 25),
    };
    setAgeRangePageStart(ageRangePageStartForAge(target.start));
    scrollOrLoadAgeRange(target, "next");
  }, [currentPrimaryAgeRange, scrollOrLoadAgeRange]);
  useAgeRangeEdgeLoader({
    active,
    enabled: mode === "radix",
    scrollerRef,
    rowCount: rows.length,
    loading,
    currentRange: mode === "radix" ? currentPrimaryAgeRange : null,
    hasPrevious: currentPrimaryAgeRange.start > 0,
    rowHeight,
    onLoadRange: scrollOrLoadAgeRange,
  });
  const scrollToFraction = React.useCallback((fraction: number) => {
    if (rows.length === 0) return;
    const targetIndex = Math.max(0, Math.min(rows.length - 1, Math.floor(rows.length * fraction)));
    void scheduleFocusedDirectionScroll(
      scrollerRef,
      targetIndex,
      rows.length,
      PRIMARY_FOCUS_ANCHOR,
      rowHeight,
    );
  }, [rowHeight, rows.length]);

  const primaryMenuExtras = React.useCallback(
    () => (
      <>
        {isReturnMode ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t("dirview.quarter")}</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {QUARTER_OPTIONS.map((opt) => (
                <ContextMenuItem key={opt.value} onClick={() => scrollToFraction(opt.value / 4)}>
                  {opt.label}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t("dirview.age")}</ContextMenuSubTrigger>
            <ContextMenuSubContent>
            <ContextMenuRadioGroup
                value={String(visibleAgeAnchorIdx)}
                onValueChange={(value) => jumpToAgeAnchor(Number(value))}
              >
                {ageRanges.map((range, index) => (
                  <ContextMenuRadioItem key={`${range.start}-${range.end}`} value={String(index)}>
                    {range.label}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("dirview.direction")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={String(direction)}
              onValueChange={(value) => setSelectedDirection(Number(value))}
            >
              {directionOptions.map((opt) => (
                <ContextMenuRadioItem key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
      </>
    ),
    [ageRanges, direction, directionOptions, isReturnMode, jumpToAgeAnchor, scrollToFraction, t, visibleAgeAnchorIdx],
  );

  const primaryExportDocument = React.useCallback(
    () => buildAdHocTableExportDocument({
      title: payload?.meta.title ?? t("dirview.primaryDirections"),
      fileStem: "primary-directions",
      pdfProfile: "directions",
      sourceName,
      columns: primaryColumnOrder.map((columnKey) => ({
        label: primaryColumnLabels[columnKey],
        align:
          columnKey === "arc"
            ? "right" as const
            : columnKey === "prom" || columnKey === "sig"
              ? "left" as const
              : "center" as const,
        widthFactor:
          columnKey === "prom" || columnKey === "sig"
            ? 2.5
            : columnKey === "arc" || columnKey === "date"
              ? 1.5
              : 1,
      })),
      rows: rows.map((row): GenericTableCell[] =>
        primaryColumnOrder.map((columnKey): GenericTableCell => {
          switch (columnKey) {
            case "mz":
              return { text: row.mz };
            case "prom":
              return directionPartsTextCell(
                primaryPromDisplayParts(row.fields),
                row.fields.promGlyph,
                row.prom,
                glyphColorRows,
              );
            case "dc":
              return { text: row.dc };
            case "sig":
              return directionPartsTextCell(
                primarySigDisplayParts(row.fields),
                row.fields.sigGlyph,
                row.sig,
                glyphColorRows,
              );
            case "arc":
              return { text: `${row.arc.toFixed(4)}°` };
            case "date":
              return { text: primaryRowDateLabel(row) };
          }
        }),
      ),
    }),
    [glyphColorRows, payload, primaryColumnLabels, primaryColumnOrder, rows, sourceName, t],
  );

  React.useLayoutEffect(() => {
    if (!active || rectificationViewportRef.current) return undefined;
    return scheduleFocusedDirectionScroll(
      scrollerRef,
      focusIndex,
      rows.length,
      PRIMARY_FOCUS_ANCHOR,
      rowHeightRef.current,
    );
  }, [active, direction, focusIndex, mode, rows.length]);

  React.useLayoutEffect(() => {
    if (!active) return undefined;
    const anchor = rectificationViewportRef.current;
    if (!anchor) return undefined;
    rectificationViewportRef.current = null;
    return scheduleDirectionViewportRestore(
      scrollerRef,
      anchor,
      rows.length,
      rowHeightRef.current,
    );
  }, [active, payload, rows.length]);

  const directionKeyLabel = compactDirectionKeyLabel(payload?.meta.key);
  const customSignificatorLabel =
    payload?.meta.customSignificator?.label ?? customSignificator?.label ?? null;

  if (!primaryRequestReady) {
    return (
      <div className="relative flex flex-1 min-h-0 flex-col bg-background">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <h2 className="text-sm font-semibold">{t("dirview.primaryDirections")}</h2>
          <LiveHoverSummary value={t("dirview.computing")} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 min-h-0 flex-col bg-background">
      <div className={LIST_PANE_CLASSES.standardHeader}>
        <div className={LIST_PANE_CLASSES.titleRow}>
          <div className={LIST_PANE_CLASSES.titleGroup}>
            <h2 className={LIST_PANE_CLASSES.title}>
              {payload?.meta.title ?? t("dirview.primaryDirections")}
            </h2>
            {payload ? (
              <span className="text-[length:var(--aries-font-size-small)] text-muted-foreground">
                {payload.meta.system}
                {directionKeyLabel ? ` · ${directionKeyLabel}` : ""}
                {customSignificatorLabel ? ` · ${t("dirview.sigWithLabel", { label: customSignificatorLabel })}` : ""}
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <LiveHoverSummary
              value={hoverSummary ?? (loading ? t("dirview.computing") : "")}
            />
            {onShowCircumambulations ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={onShowCircumambulations}
              >
                {t("dirview.circum")}
              </Button>
            ) : null}
            <PrimDirSettingsSheet
              settings={settings}
              planetGlyphs={settingsPlanetGlyphs}
              presetGlobalState={
                settingsMeanNode == null ? undefined : { planetsPoints: { meannode: settingsMeanNode } }
              }
              onPatch={onPatchSettings}
            />
            <TextExportActions
              disabled={!rows.length}
              buildDocument={primaryExportDocument}
            />
          </div>
        </div>
        <div className={LIST_PANE_CLASSES.controlRow}>
          {!lockMode ? (
            <ListSegmentedControl
              label={t("dirview.mode")}
              options={primaryModeOptions}
              value={mode}
              onChange={(v) => {
                setMode(v);
                setAgeWindow(null);
                setTargetAgeRange(null);
                setTargetAgeSeek("exact");
                setAgeSeek("exact");
                setYear(null);
              }}
            />
          ) : null}
          <ListSegmentedControl
            label={t("dirview.direction")}
            options={directionOptions}
            value={direction}
            onChange={(v) => setSelectedDirection(v)}
          />
          {mode === "radix" ? (
            <AgeRangePager
              ranges={ageRanges}
              value={visibleAgeAnchorIdx}
              onRange={(range) => scrollOrLoadAgeRange(range)}
              onPreviousPage={showPreviousAgeRanges}
              onNextPage={showNextAgeRanges}
              previousDisabled={currentPrimaryAgeRange.start <= 0}
            />
          ) : mode === "sr" ? (
            <YearStepper
              year={year ?? payload?.meta.solarRevolutionYear ?? null}
              onChange={(y) => setYear(y)}
            />
          ) : null}
          {isReturnMode ? (
            <NatalParticipatorsToggle
              active={showNatalPromissors}
              onToggle={() => onPatchSettings({ pdrevshownatalpromissors: !showNatalPromissors })}
            />
          ) : null}
          <RectificationStepper
            docId={rectificationDocumentId}
            onStepStart={captureRectificationViewport}
            onStepped={onRectificationCommitted}
            onStepSettled={onRectificationSettled}
            onError={setError}
          />
          <ListLayoutPresetControl />
        </div>
        {isReturnMode && returnLabel ? (
          <span className="text-[length:var(--aries-font-size-small)] text-muted-foreground">
            {returnLabel}
          </span>
        ) : null}
      </div>

      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-auto">
        {error ? (
          <div className="px-4 py-6 text-[length:var(--aries-font-size-base)] text-destructive">{error}</div>
        ) : (
          <Table
            className={cn(
              LIST_ROLE_CLASSES.symbolic,
              "border-collapse [--aries-list-cell-x:5px] [--aries-list-outer-x:8px]",
              primaryResize.tableClassName,
            )}
            style={primaryResize.tableStyle}
          >
            {primaryResize.colGroup}
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {primaryColumnOrder.map((columnKey) => (
                  <TableHead key={columnKey} className={cn("relative", primaryHeadClass(columnKey))}>
                    <DirectionHeadLabel align={primaryHeadAlign(columnKey)}>
                      {primaryColumnLabels[columnKey]}
                    </DirectionHeadLabel>
                    <ColumnResizeHandle
                      columnId={columnKey}
                      getResizeHandleProps={primaryResize.getResizeHandleProps}
                    />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <VirtualizedTableRows
              rows={rows}
              loading={loading}
              emptyLabel={t("dirview.noDirections")}
              colSpan={primaryColumnOrder.length}
              scrollerRef={scrollerRef}
              initialIndex={focusIndex}
              rowHeight={rowHeight}
              renderRow={(row, i) => (
                  <PrimaryRowCells
                    key={primaryDirectionRowKey(row, i)}
                    row={row}
                    documentId={documentId}
                    initialFocus={i === focusIndex}
                    rowIndex={i}
                    menuExtras={primaryMenuExtras}
                    pdInChartEnabled={mode === "radix"}
                    glyphColorRows={glyphColorRows}
                    columnOrder={primaryColumnOrder}
                    onHover={setHoverSummary}
                    rowHeight={rowHeight}
                  />
              )}
            />
          </Table>
        )}
      </div>
    </div>
  );
}

function YearStepper({
  year,
  onChange,
}: {
  year: number | null;
  onChange: (year: number) => void;
}) {
  const t = useT();
  const current = year ?? new Date().getFullYear();
  return (
    <ControlTooltip label={t("dirview.srYear")}>
      <div className="inline-flex items-center rounded-md border border-border bg-background">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => onChange(current - 1)}
          aria-label={t("dirview.previousYear")}
        >
          −
        </Button>
        <span className="min-w-[3.5rem] text-center text-xs tabular-nums">{current}</span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => onChange(current + 1)}
          aria-label={t("dirview.nextYear")}
        >
          +
        </Button>
      </div>
    </ControlTooltip>
  );
}

function TemporalHighlightedTableRow({
  temporal,
  style,
  onClick,
  ...props
}: React.ComponentProps<typeof TableRow> & {
  temporal?: TemporalRowMeta | null;
}) {
  const temporalHighlight = useTemporalRowHighlight(temporal);
  return (
    <TableRow
      {...props}
      {...temporalHighlight.dataAttributes}
      style={{ ...style, ...temporalHighlight.style }}
      onClick={(event) => {
        onClick?.(event);
        temporalHighlight.onClick?.(event);
      }}
    />
  );
}

function PrimaryRowCells({
  row,
  documentId,
  initialFocus,
  rowIndex,
  menuExtras,
  pdInChartEnabled,
  glyphColorRows,
  columnOrder,
  onHover,
  rowHeight,
}: {
  row: DirectionRow;
  documentId: string;
  initialFocus: boolean;
  rowIndex: number;
  menuExtras: () => React.ReactNode;
  pdInChartEnabled: boolean;
  glyphColorRows: boolean;
  columnOrder: readonly PrimaryDirectionColumnKey[];
  onHover: (summary: string | null) => void;
  rowHeight: number;
}) {
  const t = useT();
  const f = row.fields;
  const promParts = primaryPromDisplayParts(f);
  const sigParts = primarySigDisplayParts(f);
  const eventDatetime = row.date ? `${row.date}T00:00:00` : null;
  const dateLabel = primaryRowDateLabel(row);
  const renderCell = (columnKey: PrimaryDirectionColumnKey) => {
    switch (columnKey) {
      case "mz":
        return <TableCell className="text-center text-muted-foreground">{row.mz}</TableCell>;
      case "prom":
        return (
          <TableCell className="text-center">
            <div className="mx-auto whitespace-nowrap">
              <PromCell
                promGlyph={f.promGlyph}
                prom2Glyph={f.prom2Glyph}
                promasp={f.promasp}
                sigasp={f.sigasp}
                text={row.prom}
                parts={promParts}
                colorize={glyphColorRows}
                color={glyphColorRows ? f.promColor : null}
                prom2Color={glyphColorRows ? f.prom2Color : null}
                aspectColor={glyphColorRows ? f.promAspectColor : null}
                colorRole={glyphColorRows ? f.promColorRole : null}
                prom2ColorRole={glyphColorRows ? f.prom2ColorRole : null}
                aspectColorRole={glyphColorRows ? f.promAspectColorRole : null}
              />
            </div>
          </TableCell>
        );
      case "dc":
        return <TableCell className="text-center text-muted-foreground">{row.dc}</TableCell>;
      case "sig":
        return (
          <TableCell className="text-center">
            <div className="mx-auto whitespace-nowrap">
              <PointCell
                glyph={f.sigGlyph}
                aspId={f.sigasp}
                text={row.sig}
                parts={sigParts}
                colorize={glyphColorRows}
                color={glyphColorRows ? f.sigColor : null}
                aspectColor={glyphColorRows ? f.sigAspectColor : null}
                colorRole={glyphColorRows ? f.sigColorRole : null}
                aspectColorRole={glyphColorRows ? f.sigAspectColorRole : null}
              />
            </div>
          </TableCell>
        );
      case "arc":
        return <TableCell className="text-right tabular-nums">{row.arc.toFixed(4)}°</TableCell>;
      case "date":
        return (
          <TableCell className="text-center tabular-nums">
            <DateTransitLink
              documentId={documentId}
              eventDatetime={eventDatetime}
              eventJd={row.fields.jd}
              sessionLabel={row.sessionLabel}
            >
              {dateLabel}
            </DateTransitLink>
          </TableCell>
        );
    }
  };
  return (
    <TimedChartContextMenu
      documentId={documentId}
      eventDatetime={eventDatetime}
      eventJd={row.fields.jd}
      sessionLabel={row.sessionLabel}
      beforeTimedItems={
        <>
          {pdInChartEnabled ? (
            <>
              <PdInChartMenuItem
                documentId={documentId}
                arc={f.arc}
                mode={f.mundane ? "terrestrial" : "celestial"}
                direct={f.direct}
                eventJd={f.jd}
                eventDatetime={eventDatetime}
                sessionLabel={row.sessionLabel}
                directionEvent={f}
              >
                {f.mundane
                  ? t("dirview.pdsInChartTerrestrial")
                  : t("dirview.pdsInChartCelestial")}
              </PdInChartMenuItem>
              <ContextMenuSeparator />
            </>
          ) : null}
          {menuExtras()}
        </>
      }
    >
      <TemporalHighlightedTableRow
        temporal={row.temporal}
        className={DIRECTION_ROW_CLASS}
        data-initial-focus={initialFocus || undefined}
        data-row-index={rowIndex}
        style={{ height: rowHeight }}
        onMouseEnter={() => onHover(primaryHoverSummary(row))}
        onMouseLeave={() => onHover(null)}
      >
        {columnOrder.map((columnKey) => (
          <React.Fragment key={columnKey}>{renderCell(columnKey)}</React.Fragment>
        ))}
      </TemporalHighlightedTableRow>
    </TimedChartContextMenu>
  );
}

function primaryRowDateLabel(row: DirectionRow): string {
  return row.displayDate ?? row.date;
}

function primaryHoverSummary(row: DirectionRow): string {
  const age = row.age != null ? ` · age ${row.age.toFixed(2)}` : "";
  return `${primaryRowDateLabel(row)}${age} · ${row.mz}/${row.dc} · ${row.arc.toFixed(4)}°`;
}

function SecondaryGlyphCell({
  text,
  glyph,
  color,
  colorRole,
  glyphColorRows,
}: {
  text: string;
  glyph?: string | null;
  color?: string | null;
  colorRole?: string | null;
  glyphColorRows: boolean;
}) {
  if (!glyph) return <span>{text}</span>;
  return (
    <Glyph
      ch={glyph}
      color={glyphColorRows ? color : null}
      colorRole={glyphColorRows ? colorRole : null}
    />
  );
}

function secondaryHoverSummary(row: SecondaryDirectionsPayload["directions"][number]): string {
  const age = row.age != null ? ` · age ${row.age.toFixed(2)}` : "";
  return `${secondaryRowDateLabel(row)}${age}`;
}

function secondaryRowDateLabel(row: SecondaryDirectionsPayload["directions"][number]): string {
  return row.displayDate ?? row.date;
}

function secondaryVisibleColumns(
  columns: readonly string[] | undefined,
  fallback: readonly string[],
): readonly string[] {
  if (!columns?.length) return fallback;
  if (columns.length === 6 && columns[2] === "Time") {
    return [columns[0], columns[3], columns[4], columns[5], columns[1]];
  }
  return columns;
}

function secondaryHasDirectionColumn(columns: readonly string[]): boolean {
  return columns.length >= 6 && columns[1]?.toLowerCase() === "dir";
}

// --- Secondary / tertiary / minor directions tab ---------------------------

type AgeWindow = { start: number; end: number } | null;

type SecondaryDirectionsViewState = {
  method: SecondaryMethod;
  directionMode: SecondaryDirectionMode;
  stationsOnly: boolean;
  requestFocusDatetime: string;
  targetAgeRange: AgeRange | null;
  targetAgeSeek: DirectionsAgeSeek;
  ageRangePageStart: number;
  viewport: DirectionViewportAnchor | null;
};

const secondaryDirectionsViewStateCache = new Map<string, SecondaryDirectionsViewState>();

function secondaryDirectionsViewStateKey(
  documentId: string,
  initialMethod: SecondaryMethod,
  includeTemporal: boolean,
): string {
  return `${documentId}:${initialMethod}:temporal-${includeTemporal ? "yes" : "no"}`;
}

function SecondaryDirectionsPanel({
  sourceName,
  source,
  documentId,
  cursorDocumentId,
  focusDatetime,
  initialMethod,
  includeTemporal,
  lockMethod,
  radixRefreshSeq,
  active,
  onRectificationStepStart,
  onRectificationCommitted,
  onRectificationSettled,
  rowHeight,
}: {
  sourceName: string;
  source?: string;
  documentId: string;
  cursorDocumentId?: string;
  focusDatetime?: string;
  initialMethod: SecondaryMethod;
  includeTemporal: boolean;
  lockMethod: boolean;
  radixRefreshSeq: number;
  active: boolean;
  onRectificationStepStart: () => void;
  onRectificationCommitted: () => void;
  onRectificationSettled: () => void;
  rowHeight: number;
}) {
  const t = useT();
  const rowHeightRef = React.useRef(rowHeight);
  React.useLayoutEffect(() => {
    rowHeightRef.current = rowHeight;
  }, [rowHeight]);
  const secondaryMethodOptions = React.useMemo(
    () => [
      { value: "secondary" as SecondaryMethod, label: t("dirview.secondary") },
      { value: "tertiary" as SecondaryMethod, label: t("dirview.tertiary") },
      { value: "minor" as SecondaryMethod, label: t("dirview.minor") },
    ],
    [t],
  );
  const secondaryDirectionModes = React.useMemo(
    () => [
      { value: "direct" as SecondaryDirectionMode, label: t("dirview.direct") },
      { value: "converse" as SecondaryDirectionMode, label: t("dirview.converse") },
      { value: "both" as SecondaryDirectionMode, label: t("dirview.both") },
    ],
    [t],
  );
  const [fallbackFocusDatetime] = React.useState(localWallclockIso);
  const effectiveFocusDatetime = focusDatetime ?? fallbackFocusDatetime;
  const viewStateKey = React.useMemo(
    () => secondaryDirectionsViewStateKey(documentId, initialMethod, includeTemporal),
    [documentId, includeTemporal, initialMethod],
  );
  const cachedViewState = React.useMemo(
    () => secondaryDirectionsViewStateCache.get(viewStateKey) ?? null,
    [viewStateKey],
  );
  const initialRequestFocusDatetime = cachedViewState?.requestFocusDatetime ?? effectiveFocusDatetime;
  const effectiveFocusDatetimeRef = React.useRef(effectiveFocusDatetime);
  React.useEffect(() => {
    effectiveFocusDatetimeRef.current = effectiveFocusDatetime;
  }, [effectiveFocusDatetime]);
  const [method, setMethod] = React.useState<SecondaryMethod>(
    cachedViewState?.method ?? initialMethod,
  );
  const [directionMode, setDirectionMode] = React.useState<SecondaryDirectionMode>(
    cachedViewState?.directionMode ?? "direct",
  );
  const [stationsOnly, setStationsOnly] = React.useState(
    cachedViewState?.stationsOnly ?? false,
  );
  const secondaryPreferences = useWorkspaceStore((s) =>
    s.secondaryProgressionsPreferencesByDocument[documentId] ??
    s.sidebarListPreferenceDefaults?.secondaryProgressions ?? null,
  );
  const persistSecondaryPreferences = useWorkspaceStore(
    (s) => s.setSecondaryProgressionsPreferences,
  );
  const selectedPlanetIds = secondaryPreferences?.planetIds ?? null;
  const selectedAspectIds = secondaryPreferences?.aspectIds ??
    SECONDARY_DEFAULT_ASPECT_FILTER_IDS;
  const filterDrawerOpen = secondaryPreferences?.filterDrawerOpen ?? false;
  const fallbackPlanetFilterItems = React.useMemo(() => {
    const keys = [
      "primdir.planetSun", "primdir.planetMoon", "primdir.planetMercury",
      "primdir.planetVenus", "primdir.planetMars", "primdir.planetJupiter",
      "primdir.planetSaturn", "primdir.planetUranus", "primdir.planetNeptune",
      "primdir.planetPluto", "primdir.planetAscNode", "primdir.planetDscNode",
    ];
    return keys.map((key, id) => ({ id, label: t(key), glyph: PLANET_GLYPH_SEQUENCE[id] }));
  }, [t]);
  const fallbackAspectFilterItems = React.useMemo(() => {
    const keys = [
      "primdir.aspectConjunction", "primdir.aspectSemisextile",
      "primdir.aspectSemisquare", "primdir.aspectSextile",
      "primdir.aspectQuintile", "primdir.aspectSquare", "primdir.aspectTrine",
      "primdir.aspectSesquisquare", "primdir.aspectBiquintile",
      "primdir.aspectQuincunx", "primdir.aspectOpposition", "primdir.aspectSeptile",
    ];
    return keys.map((key, id) => ({ id, label: t(key), glyph: ASPECT_GLYPHS[id] }));
  }, [t]);
  const reportTemporalLens = useTemporalConfluenceLensReporter();
  React.useEffect(() => {
    reportTemporalLens({
      method,
      direction: directionMode,
      stationsOnly,
    });
  }, [directionMode, method, reportTemporalLens, stationsOnly]);
  const [requestFocusDatetime, setRequestFocusDatetime] = React.useState(initialRequestFocusDatetime);
  const [targetAgeRange, setTargetAgeRange] = React.useState<AgeRange | null>(
    cachedViewState?.targetAgeRange ?? null,
  );
  const [targetAgeSeek, setTargetAgeSeek] = React.useState<DirectionsAgeSeek>(
    cachedViewState?.targetAgeSeek ?? "exact",
  );
  const [ageRangePageStart, setAgeRangePageStart] = React.useState(
    cachedViewState?.ageRangePageStart ?? 0,
  );
  // Island = which contiguous stitched region we are building. A long pager
  // jump or an out-of-coverage focus move starts a new island (window != null
  // fetches that explicit span; null lets the daemon pick the focus window
  // from requestFocusDatetime). Coverage then grows around the island by
  // adjacent-chunk stitching — the list itself never rebuilds.
  const [island, setIsland] = React.useState<{
    nonce: number;
    window: AgeSpan | null;
  }>({ nonce: 0, window: null });
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [glyphColorRows, setGlyphColorRows] = React.useState(false);
  const [hoverSummary, setHoverSummary] = React.useState<string | null>(null);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  // Settings changes (e.g. the secondary-progression calc options in the
  // Supplementary tab) broadcast options.changed; the rows are computed from
  // the live options object, so re-fetch on every bump.
  const optionsSeq = useDirectionsOptionsSeq();
  const optionsRefreshKey = useDebouncedValue(
    optionsSeq,
    DIRECTION_LIST_REFRESH_DEBOUNCE_MS,
  );
  const layoutPreset = useListLayoutPreset();
  const rectificationDocumentId = cursorDocumentId ?? documentId;
  const applyTimedChartOpenResult = useWorkspaceStore((s) => s.applyTimedChartOpenResult);
  // Identity of the stitched world — any of these changing invalidates every
  // loaded chunk (different method/direction/options/radix ⇒ different rows).
  const stitchKey = React.useMemo(
    () =>
      listCacheKey({
        documentId,
        sourceName,
        source,
        method,
        directionMode,
        optionsRefreshKey,
        radixRefreshSeq,
        includeTemporal,
      }),
    [directionMode, documentId, includeTemporal, method, optionsRefreshKey, radixRefreshSeq, source, sourceName],
  );
  const [store, setStore] = React.useState<SecondaryStitchStore | null>(() => {
    const cached = getCachedListPayload<SecondaryStitchStore>(SECONDARY_STITCHED_CACHE, stitchKey);
    return stitchedStoreCoversFocus(cached, effectiveFocusDatetime) ? cached : null;
  });
  const storeRef = React.useRef(store);
  const stitchKeyRef = React.useRef(stitchKey);
  const worldSeqRef = React.useRef(0);
  const initialInFlightRef = React.useRef(false);
  const extendInFlightRef = React.useRef(false);
  const extendCooldownUntilRef = React.useRef(0);
  const scrollPlanRef = React.useRef<{ kind: "prepend"; count: number } | null>(null);
  const restoredViewportRef = React.useRef<DirectionViewportAnchor | null>(
    cachedViewState?.viewport ?? null,
  );
  const stationFilterAnchorMsRef = React.useRef<number | null>(null);
  const methodRef = React.useRef(method);
  const directionModeRef = React.useRef(directionMode);
  const stationsOnlyRef = React.useRef(stationsOnly);
  const selectedPlanetIdsRef = React.useRef(selectedPlanetIds);
  const selectedAspectIdsRef = React.useRef(selectedAspectIds);
  const requestFocusDatetimeRef = React.useRef(requestFocusDatetime);
  const targetAgeRangeRef = React.useRef(targetAgeRange);
  const targetAgeSeekRef = React.useRef(targetAgeSeek);
  const ageRangePageStartRef = React.useRef(ageRangePageStart);
  const restoredCachedViewStateRef = React.useRef(Boolean(cachedViewState));
  React.useEffect(() => {
    storeRef.current = store;
  }, [store]);
  React.useEffect(() => {
    stitchKeyRef.current = stitchKey;
  }, [stitchKey]);
  React.useEffect(() => {
    methodRef.current = method;
  }, [method]);
  React.useEffect(() => {
    directionModeRef.current = directionMode;
  }, [directionMode]);
  React.useEffect(() => {
    stationsOnlyRef.current = stationsOnly;
  }, [stationsOnly]);
  React.useEffect(() => {
    selectedPlanetIdsRef.current = selectedPlanetIds;
  }, [selectedPlanetIds]);
  React.useEffect(() => {
    selectedAspectIdsRef.current = selectedAspectIds;
  }, [selectedAspectIds]);
  React.useEffect(() => {
    requestFocusDatetimeRef.current = requestFocusDatetime;
  }, [requestFocusDatetime]);
  React.useEffect(() => {
    targetAgeRangeRef.current = targetAgeRange;
  }, [targetAgeRange]);
  React.useEffect(() => {
    targetAgeSeekRef.current = targetAgeSeek;
  }, [targetAgeSeek]);
  React.useEffect(() => {
    ageRangePageStartRef.current = ageRangePageStart;
  }, [ageRangePageStart]);

  React.useEffect(() => {
    if (restoredCachedViewStateRef.current) {
      restoredCachedViewStateRef.current = false;
      return;
    }
    queueMicrotask(() => {
      setMethod(initialMethod);
      setDirectionMode("direct");
      setRequestFocusDatetime(effectiveFocusDatetimeRef.current);
      setTargetAgeRange(null);
      setTargetAgeSeek("exact");
      setAgeRangePageStart(0);
      setIsland((prev) => ({ nonce: prev.nonce + 1, window: null }));
    });
  }, [initialMethod]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    return () => {
      secondaryDirectionsViewStateCache.set(viewStateKey, {
        method: methodRef.current,
        directionMode: directionModeRef.current,
        stationsOnly: stationsOnlyRef.current,
        requestFocusDatetime: requestFocusDatetimeRef.current,
        targetAgeRange: targetAgeRangeRef.current,
        targetAgeSeek: targetAgeSeekRef.current,
        ageRangePageStart: ageRangePageStartRef.current,
        viewport: captureDirectionViewport(scroller, rowHeightRef.current),
      });
    };
  }, [viewStateKey]);

  React.useEffect(() => {
    queueMicrotask(() => {
      setTargetAgeRange(null);
      setTargetAgeSeek("exact");
      const rowsRange = rowDateRangeMs(
        storeRef.current?.rows ?? [],
        (row) => row.eventDatetime ?? row.date,
      );
      if (dateRangeCoversFocusDate(rowsRange, effectiveFocusDatetime)) return;
      setRequestFocusDatetime((prev) =>
        prev === effectiveFocusDatetime ? prev : effectiveFocusDatetime,
      );
      setIsland((prev) => ({ nonce: prev.nonce + 1, window: null }));
    });
  }, [effectiveFocusDatetime]);

  React.useEffect(() => {
    const controller = new AbortController();
    fetchOptions(controller.signal)
      .then((o) => setGlyphColorRows(!!o.primaryDirections.pdlistglyphcolors))
      .catch(() => {});
    return () => controller.abort();
  }, [optionsSeq]);

  // Initial chunk for the current stitched world/island. Identity changes keep
  // the previous rows on screen (stale-while-refresh) and swap when the new
  // chunk lands; the coverage then re-grows via extendCoverage below.
  React.useEffect(() => {
    const worldSeq = worldSeqRef.current + 1;
    worldSeqRef.current = worldSeq;
    extendCooldownUntilRef.current = 0;
    scrollPlanRef.current = null;
    const controller = new AbortController();
    const cached =
      island.window == null
        ? getCachedListPayload<SecondaryStitchStore>(SECONDARY_STITCHED_CACHE, stitchKey)
        : null;
    if (stitchedStoreCoversFocus(cached, requestFocusDatetime)) {
      initialInFlightRef.current = false;
      queueMicrotask(() => {
        if (controller.signal.aborted || worldSeqRef.current !== worldSeq) return;
        setStore(cached);
        setLoading(false);
        setError(null);
      });
      return () => controller.abort();
    }
    initialInFlightRef.current = true;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(null);
    });
    fetchSecondaryDirections(
      sourceName,
      {
        method,
        direction: directionMode,
        source,
        documentId,
        ...(island.window
          ? { startAge: island.window.start, endAge: island.window.end }
          : { referenceDatetime: requestFocusDatetime }),
        includeTemporal,
      },
      controller.signal,
    )
      .then((data) => {
        if (worldSeqRef.current !== worldSeq) return;
        // Birth-focus redirect: an unstepped radix hands the pane its BIRTH
        // datetime as focus, but age lists anchor at the current moment (the
        // today-clamp in directionFocusTargetMs). The dense methods' tiny
        // default windows (1y tertiary / 0.25y minor) would otherwise build
        // the island at age 0 where the viewport will never sit — rebuild it
        // around now instead.
        if (
          island.window == null &&
          typeof data.meta.referenceAge === "number" &&
          data.meta.referenceAge <= 0.02
        ) {
          const focusMs = parseDateMs(requestFocusDatetime);
          if (focusMs != null && Date.now() - focusMs > 30 * 24 * 60 * 60 * 1000) {
            setRequestFocusDatetime(localWallclockIso());
            setIsland((prev) => ({ nonce: prev.nonce + 1, window: null }));
            return;
          }
        }
        const coverage = spanFromSecondaryPayload(
          data.meta,
          island.window ?? { start: 0, end: SECONDARY_STITCH_CHUNK_YEARS[method] },
          data.directions,
        );
        const next: SecondaryStitchStore = {
          rows: data.directions,
          coverage,
          islandNonce: island.nonce,
          meta: data.meta,
          coverageAuthoritative: !data.meta.truncated,
          temporalCoverage: authoritativeTemporalCoverage(data.meta.temporalCoverage),
        };
        React.startTransition(() => {
          setStore(next);
          setAgeRangePageStart((prev) => {
            const nextPageStart = ageRangePageStartForAge(coverage.start);
            return prev === nextPageStart ? prev : nextPageStart;
          });
        });
        rememberStitchedSecondaryStore(stitchKey, next);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        if (worldSeqRef.current !== worldSeq) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (worldSeqRef.current === worldSeq) {
          initialInFlightRef.current = false;
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      if (worldSeqRef.current === worldSeq) {
        initialInFlightRef.current = false;
      }
    };
  }, [stitchKey, island, sourceName, source, documentId, method, directionMode, requestFocusDatetime, includeTemporal]);

  // Grow coverage by one adjacent chunk. Append never moves the viewport;
  // prepend schedules a scroll compensation consumed before paint.
  const extendCoverage = React.useCallback(
    (direction: AgeRangeLoadDirection) => {
      const current = storeRef.current;
      if (!current || extendInFlightRef.current || initialInFlightRef.current) return;
      if (Date.now() < extendCooldownUntilRef.current) return;
      const chunkYears = SECONDARY_STITCH_CHUNK_YEARS[method];
      let span: AgeSpan;
      if (direction === "previous") {
        if (current.coverage.start <= 0) return;
        span = {
          start: Math.max(0, current.coverage.start - chunkYears),
          end: current.coverage.start,
        };
      } else {
        if (current.coverage.end >= SECONDARY_STITCH_MAX_AGE) return;
        span = {
          start: current.coverage.end,
          end: Math.min(SECONDARY_STITCH_MAX_AGE, current.coverage.end + chunkYears),
        };
      }
      const worldSeq = worldSeqRef.current;
      extendInFlightRef.current = true;
      fetchSecondaryDirections(sourceName, {
        method,
        direction: directionMode,
        source,
        documentId,
        startAge: span.start,
        endAge: span.end,
        includeTemporal,
      })
        .then((data) => {
          if (worldSeqRef.current !== worldSeq) return;
          const base = storeRef.current;
          if (!base) return;
          const chunkSpan = spanFromSecondaryPayload(data.meta, span, data.directions);
          if (data.meta.truncated) {
            if (direction === "previous") {
              // A truncated prepend chunk is missing its TAIL — the rows next
              // to current coverage. Stitching it would tear the island.
              console.warn("[secondary-stitch] truncated prepend chunk dropped", span);
              extendCooldownUntilRef.current = Date.now() + 10000;
              return;
            }
          }
          const { next, prependedCount } = stitchRows(
            base,
            data.directions,
            chunkSpan,
            secondaryStitchRowKey,
          );
          const nextStore: SecondaryStitchStore = {
            ...next,
            meta: base.meta,
            coverageAuthoritative: base.coverageAuthoritative && !data.meta.truncated,
            temporalCoverage: data.meta.truncated
              ? base.temporalCoverage
              : mergeContiguousTemporalCoverage(
                  base.temporalCoverage,
                  data.meta.temporalCoverage,
                ),
          };
          if (prependedCount > 0) {
            const selectedPlanets = selectedPlanetIdsRef.current;
            const planets = new Set(selectedPlanets ?? []);
            const aspects = new Set(selectedAspectIdsRef.current);
            const visibleCount = nextStore.rows.slice(0, prependedCount).filter((row) => {
              if (
                stationsOnlyRef.current &&
                !SECONDARY_STATION_FILTER_IDS.includes(secondaryStationFilterKey(row))
              ) return false;
              return (row.fields.promPlanet == null || selectedPlanets == null || planets.has(row.fields.promPlanet)) &&
                (row.fields.aspectIndex == null || aspects.has(row.fields.aspectIndex));
            }).length;
            scrollPlanRef.current =
              visibleCount > 0 ? { kind: "prepend", count: visibleCount } : null;
          }
          extendInFlightRef.current = false;
          setStore(nextStore);
          rememberStitchedSecondaryStore(stitchKeyRef.current, nextStore);
        })
        .catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          extendCooldownUntilRef.current = Date.now() + 4000;
          console.error("[secondary-stitch-extend]", err);
        })
        .finally(() => {
          extendInFlightRef.current = false;
        });
    },
    [directionMode, documentId, includeTemporal, method, source, sourceName],
  );

  // Idle prefetch until the island's neighbourhood is covered: secondary is
  // cheap enough to hold the whole life (≈89 ms / 292 KB measured), the denser
  // methods pre-cover ±2 chunks around the island centre. One request at a
  // time; each stitch re-runs the effect and chains the next chunk.
  React.useEffect(() => {
    if (!store) return;
    if (extendInFlightRef.current || initialInFlightRef.current) return;
    const desired: AgeSpan =
      method === "secondary"
        ? { start: 0, end: 100 }
        : (() => {
            const center =
              store.meta.referenceAge ?? (store.meta.startAge + store.meta.endAge) / 2;
            const half = SECONDARY_STITCH_CHUNK_YEARS[method] * 2;
            return {
              start: Math.max(0, center - half),
              end: Math.min(SECONDARY_STITCH_MAX_AGE, center + half),
            };
          })();
    if (store.coverage.start > desired.start + 0.01) extendCoverage("previous");
    else if (store.coverage.end < desired.end - 0.01) extendCoverage("next");
  }, [store, method, extendCoverage]);

  const sourceRows = React.useMemo(() => store?.rows ?? [], [store]);
  const planetFilterItems: Array<{ id: number; label: string; glyph?: string }> =
    (store?.meta.filterPlanets ?? fallbackPlanetFilterItems).map((item) => ({
      ...item,
      glyph: item.glyph ?? undefined,
    }));
  const aspectFilterItems = fallbackAspectFilterItems;
  const rows = React.useMemo(
    () => {
      const stationRows = filterRetainedRows(
        sourceRows,
        stationsOnly ? SECONDARY_STATION_FILTER_IDS : null,
        secondaryStationFilterKey,
      );
      const planets = new Set(selectedPlanetIds ?? []);
      const aspects = new Set(selectedAspectIds);
      return stationRows.filter((row) => {
        const prom = row.fields.promPlanet;
        const aspect = row.fields.aspectIndex;
        return (prom == null || selectedPlanetIds == null || planets.has(prom)) &&
          (aspect == null || aspects.has(aspect));
      });
    },
    [selectedAspectIds, selectedPlanetIds, sourceRows, stationsOnly],
  );
  const temporalCoverage = React.useMemo(
    () =>
      store?.temporalCoverage
      ?? authoritativeTemporalCoverage(store?.meta.temporalCoverage)
      ?? temporalCoverageFromRows(sourceRows, store?.coverageAuthoritative === true),
    [sourceRows, store?.coverageAuthoritative, store?.meta, store?.temporalCoverage],
  );
  useTemporalConfluenceRows(rows, temporalCoverage);
  const rowKeys = React.useMemo(() => buildStableRowKeys(rows, secondaryStitchRowKey), [rows]);
  const secondaryDefaultColumns = React.useMemo(
    () => [
      t("dirview.age"),
      t("dirview.prom"),
      t("dirview.asp"),
      t("dirview.sig"),
      t("dirview.date"),
    ],
    [t],
  );
  const columns = React.useMemo(
    () => secondaryVisibleColumns(store?.meta.columns, secondaryDefaultColumns),
    [store, secondaryDefaultColumns],
  );
  const showSecondaryDirectionColumn = React.useMemo(
    () => secondaryHasDirectionColumn(columns),
    [columns],
  );
  const secondaryColumnKeys = React.useMemo<readonly SecondaryDirectionColumnKey[]>(
    () =>
      (showSecondaryDirectionColumn
        ? SECONDARY_DIRECTION_COLUMN_KEYS
        : SECONDARY_DIRECTION_COLUMN_KEYS.filter((columnKey) => columnKey !== "direction")) as readonly SecondaryDirectionColumnKey[],
    [showSecondaryDirectionColumn],
  );
  const secondaryColumnOrder = React.useMemo(
    () =>
      listKeyDisplayOrder(secondaryColumnKeys, layoutPreset, {
        dateKeys: ["date"],
        eventKeys: ["prom", "aspect", "sig"],
      }),
    [layoutPreset, secondaryColumnKeys],
  );
  const secondaryResize = useResizableTableColumns({
    storageKey: "directions:secondary",
    columnIds: secondaryColumnOrder,
  });
  const secondaryColumnLabels = React.useMemo<Record<SecondaryDirectionColumnKey, string>>(
    () => ({
      age: columns[0],
      direction: showSecondaryDirectionColumn ? columns[1] : t("dirview.dir"),
      prom: showSecondaryDirectionColumn ? columns[2] : columns[1],
      aspect: showSecondaryDirectionColumn ? columns[3] : columns[2],
      sig: showSecondaryDirectionColumn ? columns[4] : columns[3],
      date: showSecondaryDirectionColumn ? columns[5] : columns[4],
    }),
    [columns, showSecondaryDirectionColumn, t],
  );
  const ageRanges = React.useMemo(() => ageRangesForPage(ageRangePageStart), [ageRangePageStart]);
  // Focus target over the LIVE stitched range. The birth-focus → today clamp
  // flips at most once per island (when forward coverage first reaches today)
  // and can never flip back — ages stop at 0, so backward growth cannot raise
  // the range start above the birth row. Stitches therefore leave the focus
  // signature (and the viewport) alone after that single early flip.
  const focusTargetMs = React.useMemo(
    () => directionFocusTargetMs(rows, effectiveFocusDatetime, (row) => row.eventDatetime ?? row.date),
    [effectiveFocusDatetime, rows],
  );
  const pinnedTemporalRowId = useTemporalPinnedRowId();
  const focusIndex = React.useMemo(
    () => {
      if (pinnedTemporalRowId) {
        const pinnedIndex = rows.findIndex(
          (row) => row.temporal?.rowId === pinnedTemporalRowId,
        );
        if (pinnedIndex >= 0) return pinnedIndex;
      }
      return targetAgeRange
        ? ageRangeTargetIndex(rows, targetAgeRange, (row) => row.age, targetAgeSeek)
        : nearestDateIndex(rows, focusTargetMs, (row) => row.eventDatetime ?? row.date);
    },
    [focusTargetMs, pinnedTemporalRowId, rows, targetAgeRange, targetAgeSeek],
  );
  useFixedRowHeightAnchor(scrollerRef, rows.length, rowHeight, {
    enabled: active,
    syncEvent: VIRTUAL_SCROLL_SYNC_EVENT,
  });
  const scrollAgeAnchorIdx = useScrollAgeAnchor(
    scrollerRef,
    rows,
    focusIndex,
    SECONDARY_FOCUS_ANCHOR,
    rowHeight,
    ageRanges,
    (row) => row.age,
  );
  const visibleAgeAnchorIdx =
    rows.length > 0
      ? scrollAgeAnchorIdx
      : ageRangeIndexForAge(ageRanges, store?.meta.referenceAge ?? store?.coverage.start ?? 0);
  const loadSecondaryAgeRange = React.useCallback(
    (range: AgeRange, seek: DirectionsAgeSeek = "exact") => {
      setTargetAgeRange(range);
      setTargetAgeSeek(seek);
      setAgeRangePageStart(ageRangePageStartForAge(range.start));
      // Within coverage the jump is a pure scroll (focus anchoring below).
      // Outside it, start a fresh island at the requested span — stitching
      // then re-grows the neighbourhood around it.
      const anchorAge = secondarySeedAnchorAge(range, seek, method);
      if (!spanContainsAge(storeRef.current?.coverage ?? null, anchorAge)) {
        const window = secondarySeedWindowForAgeRange(range, seek, method);
        setIsland((prev) => ({
          nonce: prev.nonce + 1,
          window,
        }));
      }
    },
    [method],
  );
  const jumpToAgeAnchor = React.useCallback(
    (index: number) => {
      const range = ageRanges[index] ?? ageRanges[0];
      loadSecondaryAgeRange(range);
    },
    [ageRanges, loadSecondaryAgeRange],
  );
  const showPreviousAgeRanges = React.useCallback(() => {
    const pageStart = previousAgeRangePageStart(ageRangePageStart);
    const ranges = ageRangesForPage(pageStart);
    const target = ranges[ranges.length - 1];
    loadSecondaryAgeRange(target, "previous");
  }, [ageRangePageStart, loadSecondaryAgeRange]);
  const showNextAgeRanges = React.useCallback(() => {
    const pageStart = nextAgeRangePageStart(ageRangePageStart);
    const target = ageRangesForPage(pageStart)[0];
    loadSecondaryAgeRange(target, "next");
  }, [ageRangePageStart, loadSecondaryAgeRange]);
  const toggleStationsOnly = React.useCallback(() => {
    const anchorIndex = scrollAnchorRowIndex(
      scrollerRef.current,
      rows.length,
      SECONDARY_FOCUS_ANCHOR,
      rowHeightRef.current,
    );
    const anchorRow = anchorIndex >= 0 ? rows[anchorIndex] : null;
    stationFilterAnchorMsRef.current = anchorRow
      ? parseDateMs(anchorRow.eventDatetime ?? anchorRow.date)
      : null;
    const next = !stationsOnlyRef.current;
    stationsOnlyRef.current = next;
    setStationsOnly(next);
  }, [rows]);
  const setSecondaryPreferences = React.useCallback((patch: {
    planetIds?: number[] | null;
    aspectIds?: number[];
    filterDrawerOpen?: boolean;
  }) => {
    const anchorIndex = scrollAnchorRowIndex(
      scrollerRef.current,
      rows.length,
      SECONDARY_FOCUS_ANCHOR,
      rowHeightRef.current,
    );
    const anchorRow = anchorIndex >= 0 ? rows[anchorIndex] : null;
    stationFilterAnchorMsRef.current = anchorRow
      ? parseDateMs(anchorRow.eventDatetime ?? anchorRow.date)
      : null;
    persistSecondaryPreferences(documentId, patch);
  }, [documentId, persistSecondaryPreferences, rows]);
  useEdgeExtend({
    scrollerRef,
    rowCount: rows.length,
    thresholdPx: rowHeight * 30,
    canExtendBackward: (store?.coverage.start ?? 0) > 0,
    canExtendForward: (store?.coverage.end ?? Number.POSITIVE_INFINITY) < SECONDARY_STITCH_MAX_AGE,
    onExtend: extendCoverage,
  });

  // Mirrors for the anchoring effects below — they must read the CURRENT
  // focus/rows at fire time without re-firing when a stitch shifts indexes.
  const focusIndexRef = React.useRef(focusIndex);
  const rowCountRef = React.useRef(rows.length);
  React.useLayoutEffect(() => {
    focusIndexRef.current = focusIndex;
    rowCountRef.current = rows.length;
  });

  // Prepend compensation — consumed before paint on the commit that prepended
  // rows, so the content under the viewport does not move. Held while the
  // scroller is hidden (tab inactive ⇒ zero heights).
  React.useLayoutEffect(() => {
    const plan = scrollPlanRef.current;
    if (!plan) return;
    const scroller = scrollerRef.current;
    if (!scroller || scroller.clientHeight <= 0) return;
    scrollPlanRef.current = null;
    scroller.scrollTop += plan.count * rowHeight;
    dispatchVirtualScrollSync(scroller);
  }, [rowHeight, store]);

  // Focus anchoring fires only when the focus TARGET changes (live follow,
  // pager jump, island swap, tab activation) — never because coverage grew.
  const focusSignature = pinnedTemporalRowId
    ? `temporal:${pinnedTemporalRowId}`
    : targetAgeRange
      ? `age:${targetAgeRange.start}:${targetAgeRange.end}:${targetAgeSeek}`
      : `ms:${focusTargetMs}`;
  const islandSignature = store ? `${store.islandNonce}` : "empty";
  React.useLayoutEffect(() => {
    if (!active || rowCountRef.current === 0) return undefined;
    // An absolute focus anchor supersedes any pending prepend compensation.
    scrollPlanRef.current = null;
    return scheduleFocusedDirectionScroll(
      scrollerRef,
      focusIndexRef.current,
      rowCountRef.current,
      SECONDARY_FOCUS_ANCHOR,
      rowHeightRef.current,
    );
  }, [active, focusSignature, islandSignature]);

  React.useLayoutEffect(() => {
    if (!active) return undefined;
    const anchor = restoredViewportRef.current;
    if (!anchor || rowCountRef.current === 0) return undefined;
    restoredViewportRef.current = null;
    return scheduleDirectionViewportRestore(
      scrollerRef,
      anchor,
      rowCountRef.current,
      rowHeightRef.current,
    );
  }, [active, islandSignature, rows.length]);

  React.useLayoutEffect(() => {
    const anchorMs = stationFilterAnchorMsRef.current;
    if (!active || anchorMs == null || rows.length === 0) return undefined;
    const targetIndex = nearestDateIndex(
      rows,
      anchorMs,
      (row) => row.eventDatetime ?? row.date,
    );
    stationFilterAnchorMsRef.current = null;
    return scheduleFocusedDirectionScroll(
      scrollerRef,
      targetIndex,
      rows.length,
      SECONDARY_FOCUS_ANCHOR,
      rowHeightRef.current,
    );
  }, [active, rows, selectedAspectIds, selectedPlanetIds, stationsOnly]);

  const secondaryMenuBefore = React.useCallback(
    (eventDatetime: string | null, sessionLabel: string) => (
      <>
        <ContextMenuItem
          disabled={!eventDatetime}
          onClick={() => {
            if (!eventDatetime) return;
            const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
            void openDirectionsSecondaryChart(documentId, eventDatetime, sessionLabel)
              .then((result) => applyTimedChartOpenResult(result))
              .catch(() => {})
              .finally(finishSnapshotCommand);
          }}
        >
          {t("dirview.openStepSecondaryChart")}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("dirview.age")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={String(visibleAgeAnchorIdx)}
              onValueChange={(value) => jumpToAgeAnchor(Number(value))}
            >
              {ageRanges.map((range, i) => (
                <ContextMenuRadioItem key={`${range.start}-${range.end}`} value={String(i)}>
                  {range.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </>
    ),
    [ageRanges, applyTimedChartOpenResult, documentId, jumpToAgeAnchor, t, visibleAgeAnchorIdx],
  );

  const secondaryRowMenu = React.useCallback(
    (row: SecondaryDirectionsPayload["directions"][number]) => {
      // wx onCopyTime (secdirframe.py:1218) copies 'YYYY-MM-DD HH:MM:SS' from
      // the refined display tuple — the daemon serializes date/time from that
      // same tuple (engine.secondary_directions.serialize_secondary_rows), so
      // joining them reproduces the wx clipboard string exactly.
      const copyValue = row.date && row.time ? `${secondaryRowDateLabel(row)} ${row.time}` : "";
      return (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!copyValue}
            onClick={() => {
              if (!copyValue) return;
              void copyText(copyValue).catch(() => {});
            }}
          >
            {t("dirview.copyTimeDate")}
          </ContextMenuItem>
        </>
      );
    },
    [t],
  );

  const secondaryExportDocument = React.useCallback(
    () => buildAdHocTableExportDocument({
      title: store?.meta.title ?? t("dirview.secondaryDirections"),
      fileStem: "secondary-directions",
      pdfProfile: "directions",
      sourceName,
      columns: secondaryColumnOrder.map((columnKey) => ({
        label: secondaryColumnLabels[columnKey],
        align: columnKey === "age" ? "right" as const : columnKey === "date" ? "center" as const : "left" as const,
      })),
      rows: rows.map((row): GenericTableCell[] =>
        secondaryColumnOrder.map((columnKey): GenericTableCell => {
          switch (columnKey) {
            case "age":
              return { text: row.age != null ? String(row.age) : "" };
            case "direction":
              return { text: row.motionCode ?? "" };
            case "prom":
              return directionGlyphTextCell(
                row.prom,
                row.fields.promGlyph,
                row.fields.promColor,
                row.fields.promColorRole,
                glyphColorRows,
                directionPointExportSymbol(row.fields.promExportSymbolText, row.prom),
              );
            case "aspect":
              return directionGlyphTextCell(
                row.aspect,
                row.fields.aspectGlyph,
                row.fields.aspectColor,
                row.fields.aspectColorRole,
                glyphColorRows,
                row.fields.aspectExportSymbolText ?? undefined,
              );
            case "sig":
              return directionGlyphTextCell(
                row.sig,
                row.fields.sigGlyph,
                row.fields.sigColor,
                row.fields.sigColorRole,
                glyphColorRows,
                directionPointExportSymbol(row.fields.sigExportSymbolText, row.sig),
              );
            case "date":
              return { text: secondaryRowDateLabel(row) };
          }
        }),
      ),
    }),
    [glyphColorRows, rows, secondaryColumnLabels, secondaryColumnOrder, sourceName, store, t],
  );

  const renderSecondaryCell = React.useCallback(
    (row: SecondaryDirectionsPayload["directions"][number], columnKey: SecondaryDirectionColumnKey) => {
      switch (columnKey) {
        case "age":
          return (
            <TableCell className={secondaryColumnClass("age")}>
              {row.age != null ? row.age.toFixed(2) : ""}
            </TableCell>
          );
        case "direction":
          return (
            <TableCell className={secondaryColumnClass("direction")}>
              {row.motionCode ?? ""}
            </TableCell>
          );
        case "prom":
          return (
            <TableCell className={secondaryColumnClass("prom")}>
              <SecondaryGlyphCell
                text={row.prom}
                glyph={row.fields.promGlyph}
                color={row.fields.promColor}
                colorRole={row.fields.promColorRole}
                glyphColorRows={glyphColorRows}
              />
            </TableCell>
          );
        case "aspect":
          return (
            <TableCell className={cn(secondaryColumnClass("aspect"), "text-muted-foreground")}>
              <SecondaryGlyphCell
                text={row.aspect}
                glyph={row.fields.aspectGlyph}
                color={row.fields.aspectColor}
                colorRole={row.fields.aspectColorRole}
                glyphColorRows={glyphColorRows}
              />
            </TableCell>
          );
        case "sig":
          return (
            <TableCell className={secondaryColumnClass("sig")}>
              <SecondaryGlyphCell
                text={row.sig}
                glyph={row.fields.sigGlyph}
                color={row.fields.sigColor}
                colorRole={row.fields.sigColorRole}
                glyphColorRows={glyphColorRows}
              />
            </TableCell>
          );
        case "date":
          return (
            <TableCell className={secondaryColumnClass("date")}>
              <div className="mx-auto whitespace-nowrap">
                <DateTransitLink
                  documentId={documentId}
                  eventDatetime={row.eventDatetime}
                  eventJd={row.jd}
                  sessionLabel={row.sessionLabel}
                >
                  {secondaryRowDateLabel(row)}
                </DateTransitLink>
              </div>
            </TableCell>
          );
      }
    },
    [documentId, glyphColorRows],
  );

  return (
    <div className="relative flex flex-1 min-h-0 flex-col bg-background">
      <div className={LIST_PANE_CLASSES.standardHeader}>
        <div className={LIST_PANE_CLASSES.titleRow}>
          <div className={LIST_PANE_CLASSES.titleGroup}>
            <h2 className={LIST_PANE_CLASSES.title}>{store?.meta.title ?? t("dirview.secondaryProgressions")}</h2>
            {store?.meta.conversionKey ? (
              <span className="text-[length:var(--aries-font-size-small)] text-muted-foreground">
                {store.meta.conversionKey}
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <LiveHoverSummary
              value={hoverSummary ?? (loading
                ? t("dirview.computing")
                : "")}
            />
            <TextExportActions
              disabled={!rows.length}
              buildDocument={secondaryExportDocument}
            />
          </div>
        </div>
        <div className={LIST_PANE_CLASSES.controlRow}>
          {!lockMethod ? (
            <ListSegmentedControl
              label={t("dirview.method")}
              options={secondaryMethodOptions}
              value={method}
              onChange={(v) => {
                setMethod(v);
                setRequestFocusDatetime(effectiveFocusDatetime);
                setTargetAgeRange(null);
                setTargetAgeSeek("exact");
                setAgeRangePageStart(0);
                setIsland((prev) => ({ nonce: prev.nonce + 1, window: null }));
              }}
            />
          ) : null}
          <ListSegmentedControl
            label={t("dirview.direction")}
            options={secondaryDirectionModes}
            value={directionMode}
            onChange={(v) => {
              setDirectionMode(v);
              setRequestFocusDatetime(effectiveFocusDatetime);
              setTargetAgeRange(null);
              setTargetAgeSeek("exact");
              setAgeRangePageStart(0);
              setIsland((prev) => ({ nonce: prev.nonce + 1, window: null }));
            }}
          />
          <Button
            type="button"
            size="xs"
            variant={stationsOnly ? "default" : "outline"}
            aria-pressed={stationsOnly}
            onClick={toggleStationsOnly}
          >
            {t("dirview.stationsOnly")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            aria-expanded={filterDrawerOpen}
            onClick={() => setSecondaryPreferences({
              filterDrawerOpen: !filterDrawerOpen,
            })}
          >
            {t("search.filter")}
          </Button>
          <AgeRangePager
            ranges={ageRanges}
            value={visibleAgeAnchorIdx}
            onRange={loadSecondaryAgeRange}
            onPreviousPage={showPreviousAgeRanges}
            onNextPage={showNextAgeRanges}
            previousDisabled={ageRangePageStart <= 0}
          />
          <RectificationStepper
            docId={rectificationDocumentId}
            onStepStart={onRectificationStepStart}
            onStepped={onRectificationCommitted}
            onStepSettled={onRectificationSettled}
            onError={setError}
          />
          <ListLayoutPresetControl />
        </div>
        {filterDrawerOpen ? (
          <div className="border-t border-border/70 pt-2">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <div className="flex min-w-0 items-center justify-between gap-[var(--aries-control-gap)]">
                  <span className="min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">
                    {t("tlview.planets")}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="px-[var(--aries-control-gap)]"
                      disabled={Array.isArray(selectedPlanetIds) && selectedPlanetIds.length === 0}
                      onClick={() => setSecondaryPreferences({ planetIds: [] })}
                    >
                      {t("listFilters.deselectAll")}
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="px-[var(--aries-control-gap)]"
                      disabled={selectedPlanetIds == null}
                      onClick={() => setSecondaryPreferences({ planetIds: null })}
                    >
                      {t("listFilters.selectAll")}
                    </Button>
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {planetFilterItems.map((item) => {
                    const selected = selectedPlanetIds == null || selectedPlanetIds.includes(item.id);
                    return (
                      <Button
                        key={item.id}
                        type="button"
                        size="xs"
                        variant={selected ? "default" : "outline"}
                        aria-pressed={selected}
                        onClick={() => setSecondaryPreferences({
                          planetIds: selected
                            ? (selectedPlanetIds ?? planetFilterItems.map((choice) => choice.id))
                                .filter((id) => id !== item.id)
                            : [...(selectedPlanetIds ?? []), item.id],
                        })}
                        className="h-6 max-w-44 justify-start gap-1 px-2 text-[length:var(--aries-font-size-small)]"
                      >
                        {item.glyph ? <Glyph ch={item.glyph} /> : null}
                        <span className="truncate">{item.label}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
              <section className="grid gap-[var(--aries-control-gap)]">
                <div className="flex flex-wrap items-center justify-between gap-[var(--aries-control-gap)]">
                  <span className="mr-1 min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">
                    {t("search.aspects")}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-[var(--aries-control-gap-compact)]">
                    <Button type="button" size="xs" variant="ghost" className="px-[var(--aries-control-gap)]" onClick={() => setSecondaryPreferences({
                      aspectIds: aspectFilterItems.map((item) => item.id),
                    })}>
                      {t("search.all")}
                    </Button>
                    <Button type="button" size="xs" variant="ghost" className="px-[var(--aries-control-gap)]" onClick={() => setSecondaryPreferences({
                      aspectIds: [...SECONDARY_MAJOR_ASPECT_FILTER_IDS],
                    })}>
                      {t("search.major")}
                    </Button>
                    <Button type="button" size="xs" variant="ghost" className="px-[var(--aries-control-gap)]" onClick={() => setSecondaryPreferences({ aspectIds: [] })}>
                      {t("search.clear")}
                    </Button>
                  </div>
                </div>
                <div
                  className="grid w-full overflow-hidden rounded-md border border-border"
                  style={{
                    gridTemplateColumns: `repeat(${aspectFilterItems.length}, minmax(0, 1fr))`,
                  }}
                >
                  {aspectFilterItems.map((aspect, index) => {
                    const selected = selectedAspectIds.includes(aspect.id);
                    return (
                      <Tooltip key={aspect.id}>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-label={aspect.label}
                              aria-pressed={selected}
                              onClick={() => setSecondaryPreferences({
                                aspectIds: selected
                                  ? selectedAspectIds.filter((id) => id !== aspect.id)
                                  : [...selectedAspectIds, aspect.id],
                              })}
                              className={cn(
                                "flex h-6 items-center justify-center text-[length:var(--aries-font-size-control)]",
                                LIST_ROW_CLASSES.hover,
                                index !== aspectFilterItems.length - 1 && "border-r border-border",
                                selected && "bg-primary/20 text-primary",
                              )}
                            />
                          }
                        >
                          <Glyph ch={aspect.glyph} />
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{aspect.label}</TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </div>
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-auto">
        {error ? (
          <div className="px-4 py-6 text-[length:var(--aries-font-size-base)] text-destructive">{error}</div>
        ) : (
          <table
            className={cn(
              "aries-list caption-bottom border-collapse",
              LIST_ROLE_CLASSES.symbolic,
              secondaryResize.tableClassName,
            )}
            style={secondaryResize.tableStyle}
          >
            {secondaryResize.colGroup}
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {secondaryColumnOrder.map((columnKey) => (
                  <TableHead key={columnKey} className={cn("relative", secondaryHeadClass(columnKey))}>
                    <DirectionHeadLabel align={secondaryHeadAlign(columnKey)}>
                      {secondaryColumnLabels[columnKey]}
                    </DirectionHeadLabel>
                    <ColumnResizeHandle
                      columnId={columnKey}
                      getResizeHandleProps={secondaryResize.getResizeHandleProps}
                    />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <VirtualizedTableRows
              rows={rows}
              loading={loading}
              emptyLabel={t("dirview.noHits")}
              colSpan={secondaryColumnOrder.length}
              scrollerRef={scrollerRef}
              initialIndex={focusIndex}
              rowHeight={rowHeight}
              renderRow={(row, i) => (
                  <TimedChartContextMenu
                    key={rowKeys[i] ?? secondaryDirectionRowKey(row, i)}
                    documentId={documentId}
                    eventDatetime={row.eventDatetime}
                    sessionLabel={row.sessionLabel}
                    beforeTimedItems={secondaryMenuBefore(row.eventDatetime, row.sessionLabel)}
                    afterTimedItems={secondaryRowMenu(row)}
                  >
                    <TemporalHighlightedTableRow
                      temporal={row.temporal}
                      className={DIRECTION_ROW_CLASS}
                      data-initial-focus={i === focusIndex || undefined}
                      data-row-index={i}
                      style={{ height: rowHeight }}
                      onMouseEnter={() => setHoverSummary(secondaryHoverSummary(row))}
                      onMouseLeave={() => setHoverSummary(null)}
                    >
                      {secondaryColumnOrder.map((columnKey) => (
                        <React.Fragment key={columnKey}>
                          {renderSecondaryCell(row, columnKey)}
                        </React.Fragment>
                      ))}
                    </TemporalHighlightedTableRow>
                  </TimedChartContextMenu>
              )}
            />
          </table>
        )}
      </div>
    </div>
  );
}

// --- Circumambulations tab -------------------------------------------------

// Column header set: wx CircumWnd columns are Age | Degree | TermLord |
// Participator | Date (circumambulationframe.py:1005). The webapp keeps the
// event-first inspector hierarchy, with each term/hit carrying its degree
// position before the term-lord and participator event columns.
const CIRCUM_EMPTY = "";

// One flattened display row: either a term period or a participating-planet hit
// inside it. Mirrors wx CircumWnd.set_data (circumambulationframe.py:733-776).
type CircumTermRow = CircumambulationPayload["directions"][number];
type CircumDisplayRow =
  | { kind: "term"; term: CircumTermRow; termIndex: number }
  | {
      kind: "participator";
      term: CircumTermRow;
      termIndex: number;
      part: CircumambulationParticipator;
    };

function circumVisibleColumns(
  columns: readonly string[],
  fallback: readonly string[],
): readonly string[] {
  if (columns.length === fallback.length && columns[4] === "Date") return columns;
  return fallback;
}

function CircumambulationPanel({
  sourceName,
  source,
  documentId,
  cursorDocumentId,
  focusDatetime,
  openSeq,
  initialMode,
  customSignificator,
  includeTemporal,
  lockMode,
  radixRefreshSeq,
  active,
  onRectificationStepStart,
  onRectificationCommitted,
  onRectificationSettled,
  onShowPrimaryDirections,
  rowHeight,
}: {
  sourceName: string;
  source?: string;
  documentId: string;
  cursorDocumentId?: string;
  focusDatetime?: string;
  openSeq?: number;
  initialMode: Mode;
  customSignificator?: DirectionCustomSignificator | null;
  includeTemporal: boolean;
  lockMode: boolean;
  radixRefreshSeq: number;
  active: boolean;
  onRectificationStepStart: () => void;
  onRectificationCommitted: () => void;
  onRectificationSettled: () => void;
  onShowPrimaryDirections?: () => void;
  rowHeight: number;
}) {
  const t = useT();
  const rowHeightRef = React.useRef(rowHeight);
  React.useLayoutEffect(() => {
    rowHeightRef.current = rowHeight;
  }, [rowHeight]);
  const primaryModeOptions = React.useMemo(
    () => [
      { value: "radix" as Mode, label: t("dirview.radixList") },
      { value: "sr" as Mode, label: t("dirview.annual") },
      { value: "lr" as Mode, label: t("dirview.monthly") },
    ],
    [t],
  );
  const circumMethodOptions = React.useMemo(
    () => [
      { value: 0, label: t("dirview.ascTimes") },
      { value: 1, label: t("dirview.pdKey") },
    ],
    [t],
  );
  const circumPromissorOptions = React.useMemo(
    () => [
      { value: 0, label: t("dirview.followPd") },
      { value: 1, label: t("dirview.traditional") },
    ],
    [t],
  );
  const initialCustomSignificatorKey = customSignificatorCacheKey(customSignificator);
  const initialPayloadCacheKey = listCacheKey({
    documentId,
    sourceName,
    source,
    useExactOa: 0,
    promissorProfile: 0,
    maxAge: 150,
    mode: initialMode,
    year: null,
    focusDatetime,
    customSignificator: initialCustomSignificatorKey,
    includeTemporal,
  });
  const [useExactOa, setUseExactOa] = React.useState<number>(0); // 0=ascensional,1=use PD
  const [promissorProfile, setPromissorProfile] = React.useState<number>(0); // 0=follow PD,1=traditional
  const [mode, setMode] = React.useState<Mode>(initialMode);
  const [year, setYear] = React.useState<number | null>(null);
  const [maxAge, setMaxAge] = React.useState(150);
  const [targetAgeRange, setTargetAgeRange] = React.useState<AgeRange | null>(null);
  const [targetAgeSeek, setTargetAgeSeek] = React.useState<DirectionsAgeSeek>("exact");
  const [ageRangePageStart, setAgeRangePageStart] = React.useState(0);
  const [payload, setPayload] = React.useState<CircumambulationPayload | null>(() =>
    getCachedListPayload<CircumambulationPayload>(CIRCUMAMBULATIONS_CACHE, initialPayloadCacheKey),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [settings, setSettings] = React.useState<OptionsPrimaryDirections | null>(null);
  const [settingsMeanNode, setSettingsMeanNode] = React.useState<boolean | null>(null);
  const [settingsPlanetGlyphs, setSettingsPlanetGlyphs] = React.useState<readonly string[]>(
    PRIMARY_SETTINGS_PLANET_GLYPHS,
  );
  const [glyphColorRows, setGlyphColorRows] = React.useState(false);
  const [circumSignColors, setCircumSignColors] = React.useState<readonly string[]>(DEFAULT_SIGN_ELEMENT_COLORS);
  const [selectedSignificator, setSelectedSignificator] = React.useState<DirectionCustomSignificator | null>(
    () => customSignificator ?? null,
  );
  const reportTemporalLens = useTemporalConfluenceLensReporter();
  React.useEffect(() => {
    if (!settings) return;
    reportTemporalLens({
      useExactOa: useExactOa === 1,
      mode,
      ...(selectedSignificator ? { customSignificator: selectedSignificator } : {}),
    });
  }, [mode, reportTemporalLens, selectedSignificator, settings, useExactOa]);
  const [significatorDrawerOpen, setSignificatorDrawerOpen] = React.useState(false);
  const [hoverSummary, setHoverSummary] = React.useState<string | null>(null);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const requestSeqRef = React.useRef(0);
  const optionsSeq = useDirectionsOptionsSeq();
  const optionsRefreshKey = useDebouncedValue(
    optionsSeq,
    DIRECTION_LIST_REFRESH_DEBOUNCE_MS,
  );
  const layoutPreset = useListLayoutPreset();
  const rectificationDocumentId = cursorDocumentId ?? documentId;
  const rectificationViewportRef = React.useRef<DirectionViewportAnchor | null>(null);
  const selectedSignificatorKey = customSignificatorCacheKey(selectedSignificator);
  const payloadCacheKey = React.useMemo(
    () =>
      listCacheKey({
        documentId,
        sourceName,
        source,
        useExactOa,
        promissorProfile,
        maxAge,
        mode,
        year,
        focusDatetime,
        optionsRefreshKey,
        radixRefreshSeq,
        customSignificator: selectedSignificatorKey,
        includeTemporal,
      }),
    [documentId, focusDatetime, includeTemporal, maxAge, mode, optionsRefreshKey, promissorProfile, radixRefreshSeq, selectedSignificatorKey, source, sourceName, useExactOa, year],
  );

  React.useEffect(() => {
    queueMicrotask(() => {
      setSelectedSignificator(customSignificator ?? null);
      setSignificatorDrawerOpen(false);
      setTargetAgeRange(null);
      setTargetAgeSeek("exact");
      setAgeRangePageStart(0);
    });
  }, [initialCustomSignificatorKey, customSignificator]);

  React.useEffect(() => {
    queueMicrotask(() => {
      setMode(initialMode);
      setTargetAgeRange(null);
      setTargetAgeSeek("exact");
      setAgeRangePageStart(0);
      if (initialMode !== "sr") setYear(null);
    });
  }, [documentId, initialMode, openSeq]);

  React.useEffect(() => {
    const controller = new AbortController();
    fetchOptions(controller.signal)
      .then((o) => {
        setSettings(o.primaryDirections);
        setSettingsMeanNode(o.planetsPoints.meannode);
        setSettingsPlanetGlyphs(primarySettingsPlanetGlyphs(o.catalog));
        setUseExactOa(o.primaryDirections.pdcircumoa === 1 ? 1 : 0);
        setPromissorProfile(o.primaryDirections.pdcircumprommode === 1 ? 1 : 0);
        setGlyphColorRows(!!o.primaryDirections.pdlistglyphcolors);
        setCircumSignColors(signElementColors(o.colors));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [optionsSeq]);

  const commitCircumSettingsPatch = useQueuedPrimaryDirectionSettingsPatch({
    setSettings,
    setSettingsMeanNode,
    onCommitted: React.useCallback((o: OptionsPatchPayload) => {
      setUseExactOa(o.primaryDirections.pdcircumoa === 1 ? 1 : 0);
      setPromissorProfile(o.primaryDirections.pdcircumprommode === 1 ? 1 : 0);
      setGlyphColorRows(!!o.primaryDirections.pdlistglyphcolors);
      setCircumSignColors(signElementColors(o.colors));
    }, []),
  });
  const onPatchSettings = React.useCallback((patch: Partial<OptionsPrimaryDirections>, optionsPatch?: OptionsPatch) => {
    const nextCircumMethod = patch.pdcircumoa ?? optionsPatch?.primaryDirections?.pdcircumoa;
    if (nextCircumMethod != null) {
      setUseExactOa(nextCircumMethod === 1 ? 1 : 0);
    }
    const nextPromissorProfile = patch.pdcircumprommode ?? optionsPatch?.primaryDirections?.pdcircumprommode;
    if (nextPromissorProfile != null) {
      setPromissorProfile(nextPromissorProfile === 1 ? 1 : 0);
    }
    if (patch.pdlistglyphcolors != null || optionsPatch?.primaryDirections?.pdlistglyphcolors != null) {
      setGlyphColorRows(!!(patch.pdlistglyphcolors ?? optionsPatch?.primaryDirections?.pdlistglyphcolors));
    }
    commitCircumSettingsPatch(patch, optionsPatch);
  }, [commitCircumSettingsPatch]);

  const setCircumMethod = React.useCallback((value: number) => {
    const normalized = value === 1 ? 1 : 0;
    setUseExactOa(normalized);
    void patchOptions({ primaryDirections: { pdcircumoa: normalized } }).catch(() => {});
  }, []);

  const setCircumPromissorProfile = React.useCallback((value: number) => {
    const normalized = value === 1 ? 1 : 0;
    setPromissorProfile(normalized);
    void patchOptions({ primaryDirections: { pdcircumprommode: normalized } }).catch(() => {});
  }, []);

  const captureRectificationViewport = React.useCallback(() => {
    onRectificationStepStart();
    rectificationViewportRef.current = captureDirectionViewport(scrollerRef.current, rowHeight);
  }, [onRectificationStepStart, rowHeight]);

  React.useEffect(() => {
    const controller = new AbortController();
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    const cached = getCachedListPayload<CircumambulationPayload>(CIRCUMAMBULATIONS_CACHE, payloadCacheKey);
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      if (cached) {
        setPayload(cached);
      }
      setLoading(!cached);
      setError(null);
    });
    fetchCircumambulations(
      sourceName,
      {
        useExactOa: useExactOa === 1,
        promissorProfile,
        maxAge,
        source,
        documentId,
        mode,
        returnKind: mode === "lr" ? "lunar" : "solar",
        referenceDatetime: focusDatetime,
        customSignificator: selectedSignificator,
        includeTemporal,
        ...(mode === "sr" && year != null ? { year } : {}),
      },
      controller.signal,
    )
      .then((data) => {
        if (requestSeq !== requestSeqRef.current) return;
        rememberListPayload(CIRCUMAMBULATIONS_CACHE, payloadCacheKey, data);
        React.startTransition(() => {
          setPayload(data);
        });
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        if (requestSeq !== requestSeqRef.current) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (requestSeq === requestSeqRef.current) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [sourceName, source, documentId, useExactOa, promissorProfile, maxAge, mode, year, focusDatetime, optionsRefreshKey, radixRefreshSeq, selectedSignificator, includeTemporal, payloadCacheKey]);

  const rows = React.useMemo(() => payload?.directions ?? [], [payload]);
  const isReturnMode = mode !== "radix";
  const showNatalPromissors = settings?.pdrevshownatalpromissors ?? payload?.meta.showNatalPromissors ?? false;
  // Flatten each term into a term-row followed by one sub-row per participating
  // planet hit, matching wx CircumWnd.set_data (circumambulationframe.py:733-776:
  // the Term-Lord row, then each Participator as its own row). Focus/age-range
  // math stays on the term rows; `termFocusToDisplay` maps a term index to its
  // display-row index so NOW highlighting and scroll still land on the term.
  const { displayRows, termFocusToDisplay } = React.useMemo(() => {
    const out: CircumDisplayRow[] = [];
    const map: number[] = [];
    rows.forEach((term, termIndex) => {
      map[termIndex] = out.length;
      out.push({ kind: "term", term, termIndex });
      for (const part of term.participating ?? []) {
        out.push({ kind: "participator", term, termIndex, part });
      }
    });
    return { displayRows: out, termFocusToDisplay: map };
  }, [rows]);
  const temporalRows = React.useMemo(
    () =>
      rows.flatMap((term) =>
        [term.temporal, ...(term.participating ?? []).map((part) => part.temporal)].filter(
          (temporal): temporal is TemporalRowMeta => Boolean(temporal),
        ),
      ),
    [rows],
  );
  const temporalCoverage = React.useMemo(
    () =>
      authoritativeTemporalCoverage(payload?.meta.temporalCoverage)
      ?? temporalCoverageFromRows(temporalRows),
    [payload?.meta.temporalCoverage, temporalRows],
  );
  useTemporalConfluenceRows(temporalRows, temporalCoverage);
  const circumDefaultColumns = React.useMemo(
    () => [
      t("dirview.degree"),
      t("dirview.termLord"),
      t("dirview.participator"),
      t("dirview.age"),
      t("dirview.date"),
    ],
    [t],
  );
  const columns = React.useMemo(
    () => circumVisibleColumns(payload?.meta.columns ?? circumDefaultColumns, circumDefaultColumns),
    [payload?.meta.columns, circumDefaultColumns],
  );
  const significatorItems = React.useMemo(
    () => payload?.meta.significators ?? [],
    [payload?.meta.significators],
  );
  const activeSignificatorId =
    selectedSignificator?.id === "custom:primary:angle:asc"
      ? "default:asc"
      : selectedSignificator?.id ?? "default:asc";
  const selectedSignificatorLabel =
    payload?.meta.customSignificator?.label ?? selectedSignificator?.label ?? "Asc";
  const selectCircumSignificator = React.useCallback((sig: DirectionCustomSignificator | null) => {
    setSelectedSignificator(sig);
    setTargetAgeRange(null);
    setTargetAgeSeek("exact");
    setAgeRangePageStart(0);
    setMaxAge(150);
  }, []);
  const circumColumnOrder = React.useMemo(
    () =>
      listKeyDisplayOrder(CIRCUM_COLUMN_KEYS, layoutPreset, {
        dateKeys: ["date"],
        eventKeys: ["degree", "bound", "participator"],
      }),
    [layoutPreset],
  );
  const circumResize = useResizableTableColumns({
    storageKey: "directions:circum",
    columnIds: circumColumnOrder,
  });
  const circumColumnLabels = React.useMemo<Record<CircumColumnKey, string>>(
    () => ({
      degree: columns[0],
      bound: columns[1],
      participator: columns[2],
      age: columns[3],
      date: columns[4],
    }),
    [columns],
  );
  const returnLabel = payload?.meta.returnLabel;
  const circumExportDocument = React.useCallback(
    () => {
      const exportCell = (dr: CircumDisplayRow, columnKey: CircumColumnKey): GenericTableCell => {
        switch (columnKey) {
          case "degree": {
            const signIndex = dr.kind === "term" ? dr.term.signIndex : dr.part.degreeSignIndex;
            const degree = dr.kind === "term" ? dr.term.degreeText : dr.part.degreeText;
            const signGlyph = dr.kind === "term" ? dr.term.signGlyph : dr.part.degreeSignGlyph;
            const signExportSymbol = dr.kind === "term"
              ? dr.term.signExportSymbolText
              : dr.part.degreeSignExportSymbolText;
            const signColor = dr.kind === "term"
              ? listSignColor(dr.term.signColor, dr.term.signIndex, circumSignColors)
              : listSignColor(dr.part.degreeSignColor, dr.part.degreeSignIndex, circumSignColors);
            const semantic = [SIGN_NAMES[signIndex ?? -1] ?? "", degree ?? ""].filter(Boolean).join(" ");
            if (!signGlyph) return { text: semantic };
            const symbolic = [signExportSymbol ?? "", degree ?? ""]
              .filter(Boolean)
              .join(" ");
            return {
              exportText: semantic,
              exportSymbolText: symbolic || semantic,
              runs: [
                {
                  text: signGlyph,
                  glyph: true,
                  exportText: SIGN_NAMES[signIndex ?? -1] ?? "",
                  exportSymbolText: signExportSymbol ?? undefined,
                  color: glyphColorRows ? signColor ?? undefined : undefined,
                },
                { text: degree ? ` ${degree}` : "" },
              ],
            };
          }
          case "bound":
            if (dr.kind !== "term") return { text: "" };
            {
              const semantic = [
                SIGN_NAMES[dr.term.signIndex ?? -1] ?? "",
                directionPlanetLabel(dr.term.termRulerPid, t),
              ].filter(Boolean).join(" ");
              const symbolic = [
                dr.term.signExportSymbolText ?? "",
                directionPointExportSymbol(
                  dr.term.termRulerExportSymbolText,
                  directionPlanetLabel(dr.term.termRulerPid, t),
                ),
              ].filter(Boolean).join(" ");
              const runs = [
                dr.term.signGlyph ? {
                  text: dr.term.signGlyph,
                  glyph: true,
                  color: glyphColorRows
                    ? listSignColor(dr.term.signColor, dr.term.signIndex, circumSignColors) ?? undefined
                    : undefined,
                } : null,
                dr.term.termRulerGlyph ? {
                  text: `${dr.term.signGlyph ? " " : ""}${dr.term.termRulerGlyph}`,
                  glyph: true,
                  color: glyphColorRows
                    ? resolvedSemanticChartColor(dr.term.termRulerColorRole, dr.term.termRulerColor) ?? undefined
                    : undefined,
                } : null,
              ].filter((run): run is NonNullable<typeof run> => Boolean(run));
              return runs.length
                ? { exportText: semantic, exportSymbolText: symbolic || semantic, runs }
                : { text: semantic };
            }
          case "participator":
            if (dr.kind !== "participator") return { text: "" };
            {
              const planetAlias = dr.part.planet ?? directionPlanetLabel(dr.part.planetId, t);
              const semantic = [
                dr.part.sourceMarker ?? "",
                dr.part.aspectExportText ?? "",
                planetAlias,
              ].filter(Boolean).join(" ");
              const symbolic = [
                dr.part.sourceMarker ?? "",
                dr.part.aspectExportSymbolText ?? "",
                directionPointExportSymbol(dr.part.planetExportSymbolText, planetAlias),
              ].filter(Boolean).join(" ");
              const runs = [
                dr.part.sourceMarker ? {
                  text: `${dr.part.sourceMarker} `,
                  color: glyphColorRows
                    ? resolvedSemanticChartColor(dr.part.planetColorRole, dr.part.planetColor) ?? undefined
                    : undefined,
                } : null,
                dr.part.aspectGlyph ? {
                  text: dr.part.aspectGlyph,
                  glyph: true,
                  color: glyphColorRows
                    ? resolvedSemanticChartColor(dr.part.aspectColorRole, dr.part.aspectColor) ?? undefined
                    : undefined,
                } : null,
                dr.part.planetGlyph ? {
                  text: `${dr.part.aspectGlyph ? " " : ""}${dr.part.planetGlyph}`,
                  glyph: true,
                  color: glyphColorRows
                    ? resolvedSemanticChartColor(dr.part.planetColorRole, dr.part.planetColor) ?? undefined
                    : undefined,
                } : null,
              ].filter((run): run is NonNullable<typeof run> => Boolean(run));
              return runs.length
                ? { exportText: semantic, exportSymbolText: symbolic || semantic, runs }
                : { text: semantic };
            }
          case "age":
            return {
              text:
                dr.kind === "term"
                  ? dr.term.ageStart != null ? dr.term.ageStart.toFixed(1) : ""
                  : dr.part.age != null ? dr.part.age.toFixed(1) : "",
            };
          case "date":
            return { text: dr.kind === "term" ? circumTermDateLabel(dr.term) : circumParticipatorDateLabel(dr.part) };
        }
      };
      return buildAdHocTableExportDocument({
        title: payload?.meta.title ?? t("dirview.circumambulations"),
        fileStem: "circumambulations",
        pdfProfile: "circumambulation",
        sourceName,
        columns: circumColumnOrder.map((columnKey) => ({
          label: circumColumnLabels[columnKey],
          align: columnKey === "age" ? "right" as const : "center" as const,
        })),
        rows: displayRows.map((dr): GenericTableCell[] =>
          circumColumnOrder.map((columnKey) => exportCell(dr, columnKey)),
        ),
        pdfRows: displayRows.map((dr) => ({
          kind: dr.kind === "term" ? "group" : "subordinate",
          emphasis: dr.kind === "term" ? "strong" : undefined,
          level: dr.kind === "term" ? 0 : 1,
          cells: circumColumnOrder.map((columnKey) => exportCell(dr, columnKey)),
        })),
      });
    },
    [circumColumnLabels, circumColumnOrder, circumSignColors, displayRows, glyphColorRows, payload, sourceName, t],
  );
  const ageRanges = React.useMemo(() => ageRangesForPage(ageRangePageStart), [ageRangePageStart]);
  const focusTargetMs = React.useMemo(
    () => directionFocusTargetMs(rows, focusDatetime, (row) => row.dateStart),
    [focusDatetime, rows],
  );
  const pinnedTemporalRowId = useTemporalPinnedRowId();
  const pinnedDisplayIndex = pinnedTemporalRowId
    ? displayRows.findIndex((row) =>
        (row.kind === "participator" ? row.part.temporal : row.term.temporal)?.rowId ===
        pinnedTemporalRowId,
      )
    : -1;
  const termFocusIndex = targetAgeRange
    ? ageRangeTargetIndex(rows, targetAgeRange, (row) => row.ageStart, targetAgeSeek)
    : circumambulationFocusIndex(rows, focusTargetMs);
  const focusIndex =
    pinnedDisplayIndex >= 0
      ? pinnedDisplayIndex
      : termFocusIndex >= 0
        ? termFocusToDisplay[termFocusIndex] ?? termFocusIndex
        : termFocusIndex;
  const focusAge = termFocusIndex >= 0 ? rows[termFocusIndex]?.ageStart : null;
  useFixedRowHeightAnchor(scrollerRef, displayRows.length, rowHeight, {
    enabled: active,
    syncEvent: VIRTUAL_SCROLL_SYNC_EVENT,
  });
  const scrollAgeAnchorIdx = useScrollAgeAnchor(
    scrollerRef,
    displayRows,
    focusIndex,
    CIRCUMAMBULATION_FOCUS_ANCHOR,
    rowHeight,
    ageRanges,
    (dr) => (dr.kind === "term" ? dr.term.ageStart : dr.part.age),
  );
  const visibleAgeAnchorIdx =
    displayRows.length > 0 ? scrollAgeAnchorIdx : ageRangeIndexForAge(ageRanges, focusAge);
  const currentCircumAgeRange = ageRanges[visibleAgeAnchorIdx] ?? ageRanges[0];
  const goToCircumAgeRange = React.useCallback((range: AgeRange, seek: DirectionsAgeSeek = "exact") => {
    setTargetAgeRange(range);
    setTargetAgeSeek(seek);
    setAgeRangePageStart(ageRangePageStartForAge(range.start));
    if (range.end > maxAge) {
      setMaxAge(Math.ceil(range.end));
    }
  }, [maxAge]);
  const showPreviousAgeRanges = React.useCallback(() => {
    const pageStart = previousAgeRangePageStart(ageRangePageStart);
    const ranges = ageRangesForPage(pageStart);
    const target = ranges[ranges.length - 1];
    goToCircumAgeRange(target, "previous");
  }, [ageRangePageStart, goToCircumAgeRange]);
  const showNextAgeRanges = React.useCallback(() => {
    const pageStart = nextAgeRangePageStart(ageRangePageStart);
    const target = ageRangesForPage(pageStart)[0];
    goToCircumAgeRange(target, "next");
  }, [ageRangePageStart, goToCircumAgeRange]);
  useAgeRangeEdgeLoader({
    active,
    enabled: !isReturnMode,
    scrollerRef,
    rowCount: displayRows.length,
    loading,
    currentRange: currentCircumAgeRange,
    hasPrevious: currentCircumAgeRange.start > 0,
    rowHeight,
    onLoadRange: goToCircumAgeRange,
  });

  React.useLayoutEffect(() => {
    if (!active || rectificationViewportRef.current) return undefined;
    return scheduleFocusedDirectionScroll(
      scrollerRef,
      focusIndex,
      displayRows.length,
      CIRCUMAMBULATION_FOCUS_ANCHOR,
      rowHeightRef.current,
    );
  }, [active, displayRows.length, focusIndex, useExactOa]);

  React.useLayoutEffect(() => {
    if (!active) return undefined;
    const anchor = rectificationViewportRef.current;
    if (!anchor) return undefined;
    rectificationViewportRef.current = null;
    return scheduleDirectionViewportRestore(
      scrollerRef,
      anchor,
      displayRows.length,
      rowHeightRef.current,
    );
  }, [active, displayRows.length, payload]);

  const circumMenuExtras = React.useCallback(
    () => (
      <>
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("dirview.circumambulation")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={String(useExactOa)}
              onValueChange={(value) => setCircumMethod(Number(value))}
            >
              <ContextMenuRadioItem value="0">{t("dirview.ascTimes")}</ContextMenuRadioItem>
              <ContextMenuRadioItem value="1">{t("dirview.pdKey")}</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
      </>
    ),
    [setCircumMethod, t, useExactOa],
  );

  const renderCircumCell = React.useCallback(
    (dr: CircumDisplayRow, columnKey: CircumColumnKey) => {
      switch (columnKey) {
        case "degree":
          return (
            <TableCell className="text-center tabular-nums">
              {dr.kind === "term" ? (
                <span className="inline-flex items-center justify-center gap-1">
                  {dr.term.signGlyph ? (
                    <Glyph
                      ch={dr.term.signGlyph}
                      color={glyphColorRows ? listSignColor(dr.term.signColor, dr.term.signIndex, circumSignColors) : null}
                      colorRole={glyphColorRows ? dr.term.signColorRole : null}
                    />
                  ) : null}
                  <span>{dr.term.degreeText ?? ""}</span>
                </span>
              ) : (
                <span className="inline-flex items-center justify-center gap-1">
                  {dr.part.degreeSignGlyph ? (
                    <Glyph
                      ch={dr.part.degreeSignGlyph}
                      color={glyphColorRows
                        ? listSignColor(dr.part.degreeSignColor, dr.part.degreeSignIndex, circumSignColors)
                        : null}
                      colorRole={glyphColorRows ? dr.part.degreeSignColorRole : null}
                    />
                  ) : null}
                  <span>{dr.part.degreeText ?? ""}</span>
                </span>
              )}
            </TableCell>
          );
        case "bound":
          return (
            <TableCell className={cn("text-right", dr.kind === "participator" && "text-muted-foreground")}>
              {dr.kind === "term" ? (
                <span className="inline-flex items-center justify-center gap-1">
                  <span className="inline-flex items-center">
                    {dr.term.signGlyph ? (
                      <Glyph
                        ch={dr.term.signGlyph}
                        color={glyphColorRows ? listSignColor(dr.term.signColor, dr.term.signIndex, circumSignColors) : null}
                        colorRole={glyphColorRows ? dr.term.signColorRole : null}
                      />
                    ) : (
                      SIGN_NAMES[dr.term.signIndex ?? -1] ?? ""
                    )}
                  </span>
                  <span className="inline-flex items-center">
                    {dr.term.termRulerGlyph ? (
                      <Glyph
                        ch={dr.term.termRulerGlyph}
                        color={glyphColorRows ? dr.term.termRulerColor : null}
                        colorRole={glyphColorRows ? dr.term.termRulerColorRole : null}
                      />
                    ) : null}
                  </span>
                </span>
              ) : (
                CIRCUM_EMPTY
              )}
            </TableCell>
          );
        case "participator":
          return (
            <TableCell className={cn("text-left", dr.kind === "term" && "text-muted-foreground")}>
              {dr.kind === "participator" ? (
                <span className="inline-flex items-center gap-1">
                  {dr.part.sourceMarker ? (
                    <NatalMarker
                      color={glyphColorRows ? dr.part.planetColor : null}
                      colorRole={glyphColorRows ? dr.part.planetColorRole : null}
                    />
                  ) : null}
                  {dr.part.aspectGlyph ? (
                    <Glyph
                      ch={dr.part.aspectGlyph}
                      color={glyphColorRows ? dr.part.aspectColor : null}
                      colorRole={glyphColorRows ? dr.part.aspectColorRole : null}
                    />
                  ) : null}
                  {dr.part.planetGlyph ? (
                    <Glyph
                      ch={dr.part.planetGlyph}
                      color={glyphColorRows ? dr.part.planetColor : null}
                      colorRole={glyphColorRows ? dr.part.planetColorRole : null}
                    />
                  ) : null}
                  {!dr.part.planetGlyph ? dr.part.planet ?? "" : null}
                </span>
              ) : (
                CIRCUM_EMPTY
              )}
            </TableCell>
          );
        case "age":
          return (
            <TableCell className="text-center tabular-nums">
              {dr.kind === "term"
                ? dr.term.ageStart != null ? dr.term.ageStart.toFixed(1) : ""
                : dr.part.age != null ? dr.part.age.toFixed(1) : ""}
            </TableCell>
          );
        case "date":
          return (
            <TableCell className="text-center font-medium tabular-nums">
              {dr.kind === "term" ? (
                <DateTransitLink
                  documentId={documentId}
                  eventDatetime={dr.term.eventDatetime}
                  sessionLabel={dr.term.sessionLabel}
                >
                  {circumTermDateLabel(dr.term)}
                </DateTransitLink>
              ) : (
                <DateTransitLink
                  documentId={documentId}
                  eventDatetime={dr.part.eventDatetime ?? dr.term.eventDatetime}
                  sessionLabel={dr.part.sessionLabel}
                >
                  {circumParticipatorDateLabel(dr.part)}
                </DateTransitLink>
              )}
            </TableCell>
          );
      }
    },
    [circumSignColors, documentId, glyphColorRows],
  );

  return (
    <div className="relative flex flex-1 min-h-0 flex-col bg-background">
      <div className={LIST_PANE_CLASSES.standardHeader}>
        <div className={LIST_PANE_CLASSES.titleRow}>
          <h2 className={LIST_PANE_CLASSES.title}>
            {payload?.meta.title ?? t("dirview.circumambulations")}
          </h2>
          <div className="flex min-w-0 items-center gap-2">
            <LiveHoverSummary value={hoverSummary ?? (loading ? t("dirview.computing") : "")} />
            {onShowPrimaryDirections ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={onShowPrimaryDirections}
              >
                {t("dirview.pdList")}
              </Button>
            ) : null}
            <PrimDirSettingsSheet
              settings={settings}
              planetGlyphs={settingsPlanetGlyphs}
              presetGlobalState={
                settingsMeanNode == null ? undefined : { planetsPoints: { meannode: settingsMeanNode } }
              }
              onPatch={onPatchSettings}
            />
            <TextExportActions
              disabled={!displayRows.length}
              buildDocument={circumExportDocument}
            />
          </div>
        </div>
        <div className={LIST_PANE_CLASSES.controlRow}>
          {!lockMode ? (
            <ListSegmentedControl
              label={t("dirview.mode")}
              options={primaryModeOptions}
              value={mode}
              onChange={(v) => {
                setMode(v);
                setTargetAgeRange(null);
                setTargetAgeSeek("exact");
                setAgeRangePageStart(0);
                setYear(null);
              }}
            />
          ) : null}
          <ListSegmentedControl
            label={t("dirview.method")}
            options={circumMethodOptions}
            value={useExactOa}
            onChange={(v) => {
              setTargetAgeRange(null);
              setTargetAgeSeek("exact");
              setAgeRangePageStart(0);
              setMaxAge(150);
              setCircumMethod(v);
            }}
          />
          <ListSegmentedControl
            label={t("primdir.promissors")}
            options={circumPromissorOptions}
            value={promissorProfile}
            onChange={(v) => {
              setTargetAgeRange(null);
              setTargetAgeSeek("exact");
              setAgeRangePageStart(0);
              setCircumPromissorProfile(v);
            }}
          />
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => setSignificatorDrawerOpen((open) => !open)}
          >
            {t("dirview.pointLabel", { label: selectedSignificatorLabel })}
          </Button>
          {!isReturnMode ? (
            <AgeRangePager
              ranges={ageRanges}
              value={visibleAgeAnchorIdx}
              onRange={goToCircumAgeRange}
              onPreviousPage={showPreviousAgeRanges}
              onNextPage={showNextAgeRanges}
              previousDisabled={ageRangePageStart <= 0}
            />
          ) : null}
          {mode === "sr" ? (
            <YearStepper
              year={year ?? payload?.meta.solarRevolutionYear ?? null}
              onChange={(y) => setYear(y)}
            />
          ) : null}
          {isReturnMode ? (
            <NatalParticipatorsToggle
              active={showNatalPromissors}
              onToggle={() => onPatchSettings({ pdrevshownatalpromissors: !showNatalPromissors })}
            />
          ) : null}
          <RectificationStepper
            docId={rectificationDocumentId}
            onStepStart={captureRectificationViewport}
            onStepped={onRectificationCommitted}
            onStepSettled={onRectificationSettled}
            onError={setError}
          />
          <ListLayoutPresetControl />
        </div>
        {significatorDrawerOpen ? (
          <CircumSignificatorDrawer
            items={significatorItems}
            activeId={activeSignificatorId}
            onSelect={selectCircumSignificator}
          />
        ) : null}
        {isReturnMode && returnLabel ? (
          <span className="text-[length:var(--aries-font-size-small)] text-muted-foreground">
            {returnLabel}
          </span>
        ) : null}
      </div>
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-auto">
        {error ? (
          <div className="px-4 py-6 text-[length:var(--aries-font-size-base)] text-destructive">{error}</div>
        ) : (
          <Table
            className={cn(
              LIST_ROLE_CLASSES.symbolic,
              "border-collapse [--aries-list-cell-x:4px] [--aries-list-outer-x:7px]",
              circumResize.tableClassName,
            )}
            style={circumResize.tableStyle}
          >
            {circumResize.colGroup}
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {circumColumnOrder.map((columnKey) => (
                  <TableHead key={columnKey} className={cn("relative", circumHeadClass(columnKey))}>
                    <DirectionHeadLabel align={circumHeadAlign(columnKey)}>
                      {circumColumnLabels[columnKey]}
                    </DirectionHeadLabel>
                    <ColumnResizeHandle
                      columnId={columnKey}
                      getResizeHandleProps={circumResize.getResizeHandleProps}
                    />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <VirtualizedTableRows
              rows={displayRows}
              loading={loading}
              emptyLabel={t("dirview.noCircumTerms")}
              colSpan={circumColumnOrder.length}
              scrollerRef={scrollerRef}
              initialIndex={focusIndex}
              rowHeight={rowHeight}
              renderRow={(dr, i) => {
                // Term rows carry the term-start event (its Timed-chart target);
                // a Participator sub-row carries its own planet-hit event date,
                // matching wx where each row owns its date (circumambulationframe.py:768-774).
                const eventDatetime =
                  dr.kind === "participator"
                    ? dr.part.eventDatetime ?? dr.term.eventDatetime
                    : dr.term.eventDatetime;
                const sessionLabel =
                  dr.kind === "participator"
                    ? dr.part.sessionLabel
                    : dr.term.sessionLabel;
                return (
                  <TimedChartContextMenu
                    key={circumambulationDisplayRowKey(dr, i)}
                    documentId={documentId}
                    eventDatetime={eventDatetime}
                    sessionLabel={sessionLabel}
                    beforeTimedItems={circumMenuExtras()}
                  >
                    <TemporalHighlightedTableRow
                      temporal={
                        dr.kind === "participator" ? dr.part.temporal : dr.term.temporal
                      }
                      className={DIRECTION_ROW_CLASS}
                      data-initial-focus={i === focusIndex || undefined}
                      data-row-index={i}
                      style={{ height: rowHeight }}
                      onMouseEnter={() => setHoverSummary(circumHoverSummary(dr))}
                      onMouseLeave={() => setHoverSummary(null)}
                    >
                      {circumColumnOrder.map((columnKey) => (
                        <React.Fragment key={columnKey}>
                          {renderCircumCell(dr, columnKey)}
                        </React.Fragment>
                      ))}
                    </TemporalHighlightedTableRow>
                  </TimedChartContextMenu>
                );
              }}
            />
          </Table>
        )}
      </div>
    </div>
  );
}

function CircumSignificatorDrawer({
  items,
  activeId,
  onSelect,
}: {
  items: CircumambulationSignificatorItem[];
  activeId: string;
  onSelect: (sig: DirectionCustomSignificator | null) => void;
}) {
  const t = useT();
  const groups = React.useMemo(() => {
    const ordered: Array<{ group: string; items: CircumambulationSignificatorItem[] }> = [];
    for (const item of items) {
      const group = item.group || t("dirview.points");
      let bucket = ordered.find((entry) => entry.group === group);
      if (!bucket) {
        bucket = { group, items: [] };
        ordered.push(bucket);
      }
      bucket.items.push(item);
    }
    return ordered;
  }, [items, t]);

  if (!items.length) {
    return (
      <div className="flex flex-wrap items-center gap-1 border-t border-border/70 pt-2">
        <Button type="button" size="xs" variant="ghost" disabled>
          {t("dirview.loading")}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-h-48 overflow-auto border-t border-border/70 pt-2">
      <div className="flex flex-col gap-2">
        {groups.map((group) => (
          <div key={group.group} className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="mr-1 min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">
              {group.group}
            </span>
            {group.items.map((item) => {
              const selected = item.id === activeId;
              return (
                <Button
                  key={item.id}
                  type="button"
                  size="xs"
                  variant={selected ? "default" : "outline"}
                  onClick={() => onSelect(item.customSignificator ?? null)}
                  className="h-6 max-w-44 justify-start gap-1 px-2 text-[length:var(--aries-font-size-small)]"
                >
                  {item.glyph ? <Glyph ch={item.glyph} /> : null}
                  <span className="truncate">{item.label}</span>
                  {item.marker ? <span className="text-[length:var(--aries-font-size-section)] text-muted-foreground">{item.marker}</span> : null}
                </Button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function circumTermDateLabel(row: CircumTermRow): string {
  return row.displayDateStart ?? row.dateStart ?? "";
}

function circumParticipatorDateLabel(row: CircumambulationParticipator): string {
  return row.displayDate ?? row.date ?? "";
}

function circumHoverSummary(row: CircumDisplayRow): string {
  if (row.kind === "participator") {
    const age = row.part.age != null ? ` · age ${row.part.age.toFixed(2)}` : "";
    return `${circumParticipatorDateLabel(row.part)}${age}`;
  }
  const age = row.term.ageStart != null ? ` · age ${row.term.ageStart.toFixed(2)}` : "";
  return `${circumTermDateLabel(row.term)}${age}`;
}

const SIGN_NAMES = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
] as const;
