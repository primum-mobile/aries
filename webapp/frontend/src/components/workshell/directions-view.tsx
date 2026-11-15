// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { TablePrecisionChoices, useTablePrecision } from "./table-precision-menu";
import { formatTableDegrees } from "@/lib/table/angle-precision";
import * as React from "react";
import { useRadixListRevision, useRetainedListOptionsRevision } from "./step-refresh";
import { useRetainedListRequests } from "@/lib/table/use-retained-list-requests";
import type { RetainedListRequest } from "@/lib/table/retained-list-requests";
import { flushSync } from "react-dom";

import { ChevronLeft, ChevronRight, Settings as SettingsIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ListPaneSplit } from "./list-pane-split";
import { PointAspectFilters } from "./point-aspect-filters";
import {
  resolveSecondaryPointRoles,
  sameRoleIds,
  secondaryDefaultPointRoles,
  secondaryPointRolesMatch,
} from "@/lib/secondary-progression-filters";
import { setPointRoleIds, togglePointRoleIds, type PointRoleSelection, type PointRoleSide } from "@/lib/point-role-selection";
import { AppliedFilterTokens, type AppliedFilterToken } from "./applied-filter-tokens";
import { RolePointChooser, type RolePointItem } from "./role-point-chooser";
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
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
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
  LIST_DATE_LINK_CLASSES,
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
  fetchSecondaryDirectionsDataKey,
  RadixRetargetError,
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
  semanticChartColor,
} from "@/lib/theme/semantic-color";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useAstrolabeStore } from "@/stores/astrolabe-store";
import {
  useFrameLayoutStore,
  type PrimaryDirectionsSettingsDock,
} from "@/stores/frame-layout-store";
import { useWorkspaceStore, type DirectionsPaneView } from "@/stores/workspace-store";
import { beginWorkspaceSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";

import { PrimDirSettingsBody, type PrimaryDirectionGlobals } from "./primdir-settings";
import { DirectedSignificatorsPanel } from "./pd-positions-view";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import { ListSegmentedControl } from "./list-controls";
import { RetainedPaneVisibleContext } from "./touch-pane-chrome";
import { createRadixRevisionGate, type RadixRevisionGate } from "./radix-revision-gate";
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
        colorRole: colorize ? part.colorRole : undefined,
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
      colorRole: colorize ? colorRole : undefined,
    }],
  };
}

const PRIMARY_DIRECTION_COLUMN_KEYS = ["mz", "prom", "dc", "sig", "arc", "date"] as const;
type PrimaryDirectionColumnKey = typeof PRIMARY_DIRECTION_COLUMN_KEYS[number];

const SECONDARY_DIRECTION_COLUMN_KEYS = ["age", "direction", "prom", "aspect", "sig", "date"] as const;
type SecondaryDirectionColumnKey = typeof SECONDARY_DIRECTION_COLUMN_KEYS[number];

// Full-word header labels, shown in place of the abbreviations when the column has room.
function directionFullColumnLabels(t: TFunc): Partial<Record<PrimaryDirectionColumnKey | SecondaryDirectionColumnKey, string>> {
  return {
    prom: t("primdir.szPromissor"),
    sig: t("primdir.szSignificator"),
    aspect: t("picker.aspect"),
    direction: t("dirview.direction"),
  };
}

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

/**
 * Column header that shows the full word (`full`) whenever the column is wide
 * enough and falls back to the abbreviation (`children`) otherwise. The
 * abbreviation is also kept in flow as an invisible floor so auto table layout
 * never squeezes the column below it.
 */
function DirectionHeadLabel({
  children,
  full,
  align = "center",
}: {
  children: string;
  full?: string;
  align?: DirectionHeadAlign;
}) {
  const boxRef = React.useRef<HTMLSpanElement>(null);
  const probeRef = React.useRef<HTMLSpanElement>(null);
  const [fullFits, setFullFits] = React.useState(false);
  React.useLayoutEffect(() => {
    const box = boxRef.current;
    const probe = probeRef.current;
    if (!box || !probe) return;
    const update = () => setFullFits(probe.offsetWidth <= box.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [full]);
  const label = full && fullFits ? full : children;
  return (
    <>
      <span aria-hidden className="invisible block h-0 overflow-hidden pr-1">
        {children}
      </span>
      <span
        ref={boxRef}
        className={cn(
          "pointer-events-none absolute inset-y-0 left-[var(--aries-list-cell-x)] right-[calc(var(--aries-list-cell-x)+0.25rem)] flex min-w-0 items-center",
          align === "right" ? "justify-end text-right" : align === "left" ? "justify-start text-left" : "justify-center text-center",
        )}
        title={full ?? children}
      >
        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {label}
        </span>
        {full ? (
          <span ref={probeRef} aria-hidden className="invisible absolute whitespace-nowrap">
            {full}
          </span>
        ) : null}
      </span>
    </>
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

// Progression rows are glyph sentences at the standard list tier, centred like
// the other direction lists (decided 2026-10-23, list-language survey §10).
// Spare pane width goes to Prom (a fifth, which insets the leading glyph) and
// Date (the rest); Aspect and Sig stay at content width so the contact reads
// as one unit.
function secondaryColumnClass(columnKey: SecondaryDirectionColumnKey) {
  switch (columnKey) {
    case "prom":
      return "w-[20%] text-center whitespace-nowrap";
    case "sig":
      return "text-center whitespace-nowrap";
    case "aspect":
      return "text-center whitespace-nowrap";
    case "direction":
      return "text-center whitespace-nowrap text-muted-foreground";
    case "age":
      return cn(LIST_TEXT_CLASSES.secondary, "text-right whitespace-nowrap tabular-nums");
    case "date":
      return "w-[80%] text-center whitespace-nowrap tabular-nums";
  }
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
// A lifetime PD list can hold thousands of rows. Its first paint shows the
// directions this many years either side of the focus, then the full list
// replaces it so stepping keeps scrolling resident rows.
const PRIMARY_FIRST_PAINT_YEARS = 6;
const VIRTUAL_SCROLL_SYNC_EVENT = "aries:virtual-scroll-sync";

function dispatchVirtualScrollSync(scroller: HTMLDivElement, beforePaint = false): void {
  scroller.dispatchEvent(
    new CustomEvent(VIRTUAL_SCROLL_SYNC_EVENT, { detail: { beforePaint } }),
  );
}
const DIRECTION_ROW_CLASS = LIST_ROW_CLASSES.flagged;
const PRIMARY_SETTINGS_PATCH_DEBOUNCE_MS = 350;
const RECTIFICATION_SESSION_ECHO_SUPPRESS_MS = 800;
// A settled step's focus echo arrives with the next chart snapshot, which can
// queue behind the replacement list request.
const RECTIFICATION_FOCUS_ECHO_MS = 2000;

// Parity target: the current/nearest event lands near the top quarter so a
// little past context is visible and most of the pane shows upcoming events.
const PRIMARY_FOCUS_ANCHOR = 0.25;
const SECONDARY_FOCUS_ANCHOR = 0.25;
const CIRCUMAMBULATION_FOCUS_ANCHOR = 0.25;

type Mode = "radix" | "sr" | "lr";
type DirectionsTab = "primary" | "secondary" | "circumambulation";
type DirectionsTopTab = "primary" | "secondary";
type PrimaryDirectionsSurface = "directions" | "circumambulation" | "significators";
type SecondaryMethod = "secondary" | "minor" | "tertiary";
type SecondaryDirectionMode = "direct" | "converse" | "both";
type PrimarySettingsPaneProps = {
  settingsOpen: boolean;
  settingsDock: PrimaryDirectionsSettingsDock;
  onSettingsOpenChange: (open: boolean) => void;
};

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

function PrimarySettingsControl({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-pressed={open}
      aria-label={t("primdir.settingsTitle")}
      title={t("primdir.settingsTitle")}
      onClick={() => onOpenChange(!open)}
    >
      <SettingsIcon className="size-[var(--aries-control-icon-size)]" />
    </Button>
  );
}

function PrimarySettingsDockLayout({
  children,
  open,
  dock,
  settings,
  globals,
  planetGlyphs,
  onClose,
  onPatch,
}: {
  children: React.ReactNode;
  open: boolean;
  dock: PrimaryDirectionsSettingsDock;
  settings: OptionsPrimaryDirections | null;
  globals: PrimaryDirectionGlobals | null;
  planetGlyphs: readonly string[];
  onClose: () => void;
  onPatch: (patch: Partial<OptionsPrimaryDirections>, optionsPatch?: OptionsPatch) => void | Promise<boolean>;
}) {
  const t = useT();
  return (
    <ResizablePanelGroup
      autoSaveId={`aries.primary-directions-results-vs-settings-${dock}`}
      direction={dock === "right" ? "horizontal" : "vertical"}
      className="min-h-0 min-w-0"
    >
      <ResizablePanel
        id="primary-directions-results"
        order={1}
        defaultSize={60}
        minSize={20}
        className="min-h-0 min-w-0"
      >
        {children}
      </ResizablePanel>
      {open ? (
        <>
          <ResizableHandle />
          <ResizablePanel
            id={`primary-directions-settings-${dock}`}
            order={2}
            defaultSize={40}
            minSize={dock === "right" ? 30 : 20}
            className="min-h-0 min-w-0"
          >
            <div data-aries-surface="panel" className="flex h-full min-h-0 flex-col bg-background">
              <div className="flex shrink-0 items-center justify-between px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-control-gap-compact)]">
                <h2 className="aries-search-panel-heading text-xs">{t("primdir.settingsTitle")}</h2>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={onClose}
                  aria-label={t("settings.close")}
                >
                  <X className="size-[var(--aries-control-icon-size)]" />
                </Button>
              </div>
              {settings == null ? (
                <div className="min-h-0 flex-1 px-[var(--aries-pane-header-compact-padding-x)] pb-[var(--aries-pane-title-gap)] text-xs text-muted-foreground">
                  {t("primdir.loading")}
                </div>
              ) : (
                <PrimDirSettingsBody
                  settings={settings}
                  globals={globals ?? undefined}
                  planetGlyphs={planetGlyphs}
                  dock={dock}
                  onPatch={onPatch}
                />
              )}
            </div>
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}

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
  rows: readonly T[],
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

/** Local rectification commits refresh ahead of their suppressed daemon echo.
 * Negative tokens never collide with daemon session seqs, across remounts. */
let directionsRectificationToken = 0;

/** The radix data identity in every Directions cache key. It seeds from the
 * store's durable per-document revision, so a list remounted after a pane
 * switch never re-keys onto rows cached before an edit made meanwhile. */
function useDirectionsRadixRefreshSeq(
  documentId: string,
  cursorDocumentId?: string | null,
  suppressEditRef?: { current: boolean },
  suppressEditUntilRef?: { current: number },
): [number, () => void] {
  const idsKey = `${documentId}\u0000${cursorDocumentId ?? ""}`;
  // A radix step (`listDataChanged: true`) lands once, when its burst settles.
  const durableSeq = useRadixListRevision([documentId, cursorDocumentId]);
  const [live, setLive] = React.useState(() => ({ idsKey, seq: durableSeq }));
  const idsKeyRef = React.useRef(idsKey);
  React.useLayoutEffect(() => {
    idsKeyRef.current = idsKey;
  }, [idsKey]);
  // Local rectification publishes its own token before the daemon echo; the
  // gate holds that echo back but applies any other revision of the window
  // once it has passed, so a real edit is never lost.
  const gateRef = React.useRef<RadixRevisionGate | null>(null);
  React.useLayoutEffect(() => {
    const gate = createRadixRevisionGate({
      suppressedForMs: () => suppressEditRef?.current
        ? Number.POSITIVE_INFINITY
        : Math.max(0, (suppressEditUntilRef?.current ?? 0) - Date.now()),
      apply: (seq) => setLive({ idsKey: idsKeyRef.current, seq }),
    });
    gateRef.current = gate;
    return () => {
      gate.dispose();
      if (gateRef.current === gate) gateRef.current = null;
    };
  }, [suppressEditRef, suppressEditUntilRef]);
  const observedSeqRef = React.useRef(durableSeq);
  React.useLayoutEffect(() => {
    // The store retains every semantic edit, even if later events overtake it.
    if (observedSeqRef.current === durableSeq) return;
    observedSeqRef.current = durableSeq;
    if (gateRef.current) gateRef.current.observe(durableSeq);
    else setLive({ idsKey: idsKeyRef.current, seq: durableSeq });
  }, [durableSeq]);
  const bumpLocal = React.useCallback(() => {
    directionsRectificationToken -= 1;
    setLive({ idsKey, seq: directionsRectificationToken });
    gateRef.current?.expectEcho();
  }, [idsKey]);
  return [live.idsKey === idsKey ? live.seq : durableSeq, bumpLocal];
}

/** Saved Directions glyph colouring, shared by every resident Directions list. */
function useSyncedDirectionGlyphColors(apply: (enabled: boolean) => void): void {
  const enabled = useDaemonWorkspaceStore(
    (state) => state.retainedListDisplay.directionGlyphColors,
  );
  React.useEffect(() => {
    if (enabled != null) apply(enabled);
  }, [apply, enabled]);
}

function useDirectionsOptionsSeq(): number {
  return useRetainedListOptionsRevision();
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
    display:
      base?.display || patch.display
        ? { ...(base?.display ?? {}), ...(patch.display ?? {}) }
        : undefined,
    primaryDirections:
      base?.primaryDirections || patch.primaryDirections
        ? { ...(base?.primaryDirections ?? {}), ...(patch.primaryDirections ?? {}) }
        : undefined,
  };
}

function primaryDirectionsPreviewOptionsPatch(
  settings: OptionsPrimaryDirections | null,
): OptionsPatch | null {
  if (!settings) return null;
  const primaryDirections = { ...settings } as Record<string, unknown>;
  delete primaryDirections.userPresets;
  delete primaryDirections.pdFixStarCatalog;
  delete primaryDirections.pdFixStarMaxSelected;
  delete primaryDirections.pdkeycoeff;
  delete primaryDirections.arabicPartNames;
  delete primaryDirections.pdAsteroidCatalog;
  // PDs-in-Chart controls affect only charts opened from row commands; they do
  // not define a new Directions-list calculation world.
  delete primaryDirections.pdinchartsecmotion;
  delete primaryDirections.pdinchartterrsecmotion;
  // Glyph colouring only paints resident rows (retained list display).
  delete primaryDirections.pdlistglyphcolors;
  // The chart's node and Moon parallax correction reach the list through the
  // daemon's options context, not this preview.
  return {
    primaryDirections: primaryDirections as Partial<OptionsPrimaryDirections>,
  };
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
  secondary: 10,
  tertiary: 1,
  minor: 0.5,
};

/** The daemon's fetch chunk (it shrinks for dense angle methods); the table above seeds the first request. */
function secondaryChunkYears(meta: SecondaryDirectionsPayload["meta"] | null | undefined, method: SecondaryMethod): number {
  const chunk = meta?.chunkYears;
  return typeof chunk === "number" && chunk > 0 ? chunk : SECONDARY_STITCH_CHUNK_YEARS[method];
}

/** Years of life a filtered list loads beyond the island centre, and beyond the
 * visible rows while scrolling: about a screen of stations per method. Fixed in
 * years, so a dense angle method's small fetch chunk cannot shrink it. */
const SECONDARY_FILTERED_REACH_YEARS: Record<SecondaryMethod, number> = {
  secondary: 100,
  tertiary: 10,
  minor: 5,
};
/** An unfilled viewport cannot scroll, so it keeps loading until it fills, up
 * to a lifetime either side of the island centre (never before birth). */
const SECONDARY_FILTERED_FILL_YEARS = 120;
const SECONDARY_FILTERED_REACH_EPSILON = 0.01;

type SecondaryVisibleAgeSpan = {
  /** The rows overflow the viewport, so the viewer can scroll to an edge. */
  overflow: boolean;
  firstVisibleAge: number | null;
  lastVisibleAge: number | null;
};

function secondaryVisibleAgeSpan(
  scroller: HTMLDivElement | null,
  rows: readonly { age?: number | null }[],
  rowHeight: number,
): SecondaryVisibleAgeSpan {
  if (!scroller || rows.length === 0 || rowHeight <= 0 || scroller.clientHeight <= 0) {
    return { overflow: false, firstVisibleAge: null, lastVisibleAge: null };
  }
  const overflow = scroller.scrollHeight - scroller.clientHeight > 0;
  if (!overflow) return { overflow, firstVisibleAge: null, lastVisibleAge: null };
  const clamp = (index: number) => Math.max(0, Math.min(rows.length - 1, index));
  const ageAt = (index: number) => {
    const age = rows[clamp(index)]?.age;
    return typeof age === "number" && Number.isFinite(age) ? age : null;
  };
  return {
    overflow,
    firstVisibleAge: ageAt(Math.floor(scroller.scrollTop / rowHeight)),
    lastVisibleAge: ageAt(Math.floor((scroller.scrollTop + scroller.clientHeight) / rowHeight)),
  };
}

/** Which side a filtered list may grow toward. An unfilled viewport grows
 * around the island centre until it fills (up to the lifetime fill bound);
 * a scrollable one loads its per-method reach and also follows the visible rows,
 * so the reach moves with the viewer instead of stalling at a fixed distance
 * from the first fetch. A side already loaded to its reach hands over to the
 * other: a short list is near both edges, and both stay bounded. */
function secondaryFilteredExtendDirection(
  direction: AgeRangeLoadDirection,
  context: SecondaryVisibleAgeSpan & { coverage: AgeSpan; center: number; reachYears: number },
): AgeRangeLoadDirection | null {
  const { coverage, center, overflow } = context;
  const reachYears = overflow ? context.reachYears : Math.max(context.reachYears, SECONDARY_FILTERED_FILL_YEARS);
  const lowest = Math.min(center, (overflow ? context.firstVisibleAge : null) ?? center) - reachYears;
  const highest = Math.max(center, (overflow ? context.lastVisibleAge : null) ?? center) + reachYears;
  const allowed = (side: AgeRangeLoadDirection) => side === "previous"
    ? coverage.start > Math.max(0, lowest) + SECONDARY_FILTERED_REACH_EPSILON
    : coverage.end < highest - SECONDARY_FILTERED_REACH_EPSILON;
  if (allowed(direction)) return direction;
  const other: AgeRangeLoadDirection = direction === "previous" ? "next" : "previous";
  return allowed(other) ? other : null;
}
const SECONDARY_STITCHED_CACHE = "directions:secondary-stitched";
/** Retries of a failed or incomplete in-place reload or key check: 0.5 s, 1 s,
 * 2 s … at most six, until a success or a new key resets the budget. */
const SECONDARY_RETRY_LIMIT = 6;
const SECONDARY_RETRY_BASE_MS = 500;
/** The latest rows of each list apart from their data revision. */
const SECONDARY_RESIDENT_CACHE = "directions:secondary-resident";
/** How far outside a reload piece a resident row still counts as its neighbour
 * when deduplicating refined instants that jitter across the piece edge. */
const SECONDARY_BOUNDARY_TOLERANCE_YEARS = 0.01;
const SECONDARY_STITCH_CACHE_MAX_ROWS = 25000;
const SECONDARY_STATION_FILTER_IDS: readonly boolean[] = Object.freeze([true]);
const SECONDARY_MAJOR_ASPECT_FILTER_IDS = Object.freeze([0, 3, 5, 6, 10]);
/** At most this many glyphs/labels read as a run in an applied-filter token; more read as a count. */
const FILTER_TOKEN_RUN_LIMIT = 6;

type SecondaryStitchStore = StitchedRows<SecondaryDirectionRow> & {
  /** Frozen initial-chunk meta — title/columns/referenceAge are identical for
   * every chunk of one stitched world; coverage lives on the store itself. */
  meta: SecondaryDirectionsPayload["meta"];
  /** False once any resident chunk hit the daemon row cap. */
  coverageAuthoritative: boolean;
  /** Exact daemon-owned JD coverage for the contiguous stitched age range. */
  temporalCoverage: TemporalCoverage | null;
  /** The daemon `dataKey` of every resident row outside `stalePieces`. */
  dataKey: string | null;
  /** Spans whose rows are still of an older key (an in-place reload that
   * failed, was cut short or is still running); empty when every row is of
   * `dataKey`. They are re-requested, never relabelled. */
  stalePieces: readonly SecondaryReloadPiece[];
  /** The chart the document hosted when these rows were built. */
  radixIdentity: string | null;
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

function secondaryStitchCacheKey(worldKey: string, dataKey: string): string {
  return `${worldKey}\u0000${dataKey}`;
}

/** Remember a store under its daemon `dataKey` and, apart from the key, as the
 * latest rows of that list, which a remount shows while it checks the key. */
function rememberStitchedSecondaryStore(worldKey: string, store: SecondaryStitchStore): void {
  if (store.rows.length > SECONDARY_STITCH_CACHE_MAX_ROWS) return;
  // Only a complete store answers for its key; one with stale pieces may seed
  // a remount (below), which then re-requests those pieces.
  if (store.dataKey && secondaryStoreComplete(store)) {
    rememberListPayload(SECONDARY_STITCHED_CACHE, secondaryStitchCacheKey(worldKey, store.dataKey), store);
  }
  rememberListPayload(SECONDARY_RESIDENT_CACHE, worldKey, store);
}

/** The cached store of `dataKey`, only when every row of it is of that key. */
function completeCachedSecondaryStore(worldKey: string, dataKey: string): SecondaryStitchStore | null {
  const cached = getCachedListPayload<SecondaryStitchStore>(
    SECONDARY_STITCHED_CACHE,
    secondaryStitchCacheKey(worldKey, dataKey),
  );
  return secondaryStoreComplete(cached) ? cached : null;
}

/** Every row of the store is of its `dataKey`. */
function secondaryStoreComplete(store: SecondaryStitchStore | null): store is SecondaryStitchStore {
  return store != null && store.stalePieces.length === 0;
}

/** The rows a list shows first: those of `dataKey` when cached, else the last
 * ones of the same list (any key), which then reload in place if stale. */
function cachedSecondaryStore(
  worldKey: string,
  dataKey: string | null,
  focusDatetime: string | null | undefined,
): SecondaryStitchStore | null {
  for (const cached of [
    dataKey
      ? completeCachedSecondaryStore(worldKey, dataKey)
      : null,
    getCachedListPayload<SecondaryStitchStore>(SECONDARY_RESIDENT_CACHE, worldKey),
  ]) {
    if (stitchedStoreCoversFocus(cached, focusDatetime)) return cached;
  }
  return null;
}

/** One request of an in-place reload. Rows with lower <= age < upper belong to
 * it; the outermost pieces are open-ended so no resident row is orphaned. */
type SecondaryReloadPiece = AgeSpan & { lower: number; upper: number };

const SECONDARY_RELOAD_EPSILON = 1e-6;

/** Split the loaded span into requests no larger than a growth chunk: first
 * those covering the visible ages, then outward, alternating later/earlier. */
function secondaryReloadPieces(
  coverage: AgeSpan,
  chunkYears: number,
  visible: { first: number; last: number },
): SecondaryReloadPiece[] {
  const { start, end } = coverage;
  if (!(end - start > SECONDARY_RELOAD_EPSILON)) {
    return [{ start, end, lower: Number.NEGATIVE_INFINITY, upper: Number.POSITIVE_INFINITY }];
  }
  const chunk = Math.max(chunkYears > 0 ? chunkYears : end - start, SECONDARY_RELOAD_EPSILON * 10);
  const clamp = (age: number) => Math.min(end, Math.max(start, age));
  let lo = clamp(Math.min(visible.first, visible.last));
  let hi = clamp(Math.max(visible.first, visible.last));
  if (hi - lo < chunk) {
    const mid = (lo + hi) / 2;
    lo = mid - chunk / 2;
    hi = mid + chunk / 2;
    if (lo < start) { hi += start - lo; lo = start; }
    if (hi > end) { lo = Math.max(start, lo - (hi - end)); hi = end; }
  }
  const piece = (from: number, to: number): SecondaryReloadPiece => ({
    start: from,
    end: to,
    lower: from <= start + SECONDARY_RELOAD_EPSILON ? Number.NEGATIVE_INFINITY : from,
    upper: to >= end - SECONDARY_RELOAD_EPSILON ? Number.POSITIVE_INFINITY : to,
  });
  const pieces: SecondaryReloadPiece[] = [];
  const visibleCount = Math.max(1, Math.ceil((hi - lo) / chunk - SECONDARY_RELOAD_EPSILON));
  const visibleStep = (hi - lo) / visibleCount;
  for (let index = 0; index < visibleCount; index += 1) {
    pieces.push(piece(lo + index * visibleStep, index === visibleCount - 1 ? hi : lo + (index + 1) * visibleStep));
  }
  let before = lo;
  let after = hi;
  while (before > start + SECONDARY_RELOAD_EPSILON || after < end - SECONDARY_RELOAD_EPSILON) {
    if (after < end - SECONDARY_RELOAD_EPSILON) {
      const next = Math.min(end, after + chunk);
      pieces.push(piece(after, next));
      after = next;
    }
    if (before > start + SECONDARY_RELOAD_EPSILON) {
      const next = Math.max(start, before - chunk);
      pieces.push(piece(next, before));
      before = next;
    }
  }
  return pieces;
}

/** Swap one reload piece's rows into the resident rows (sorted by age). Rows
 * outside it stay as they are; a refined boundary row that jittered across the
 * piece edge is not duplicated. */
function replaceSecondaryRowsInSpan(
  rows: readonly SecondaryDirectionRow[],
  fresh: readonly SecondaryDirectionRow[],
  lower: number,
  upper: number,
): SecondaryDirectionRow[] {
  let from = rows.length;
  let to = rows.length;
  let lastAge = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < rows.length; index += 1) {
    const age = rows[index].age ?? lastAge;
    lastAge = age;
    if (from === rows.length && age >= lower) from = index;
    if (age >= upper) {
      to = index;
      break;
    }
  }
  if (from > to) from = to;
  const neighbours = new Set<string>();
  for (let index = from - 1; index >= 0; index -= 1) {
    const age = rows[index].age;
    if (age != null && age < lower - SECONDARY_BOUNDARY_TOLERANCE_YEARS) break;
    neighbours.add(secondaryStitchRowKey(rows[index]));
  }
  for (let index = to; index < rows.length; index += 1) {
    const age = rows[index].age;
    if (age != null && age > upper + SECONDARY_BOUNDARY_TOLERANCE_YEARS) break;
    neighbours.add(secondaryStitchRowKey(rows[index]));
  }
  const incoming = fresh.filter((row) =>
    (row.age == null || (row.age >= lower && row.age < upper)) &&
    !neighbours.has(secondaryStitchRowKey(row)));
  return [...rows.slice(0, from), ...incoming, ...rows.slice(to)];
}

/** The ages a reload should refresh first: the viewport a remount is about to
 * restore, else the rows on screen, else the row the list anchors at focus. */
function secondaryReloadViewAges({
  rows,
  scroller,
  rowHeight,
  restoreAnchor,
  measureScroller,
  focusDatetime,
}: {
  rows: readonly SecondaryDirectionRow[];
  scroller: HTMLDivElement | null;
  rowHeight: number;
  restoreAnchor: DirectionViewportAnchor | null;
  measureScroller: boolean;
  focusDatetime: string | null | undefined;
}): { first: number; last: number } | null {
  if (!rows.length || rowHeight <= 0) return null;
  const ageAt = (index: number) => {
    const age = rows[Math.max(0, Math.min(rows.length - 1, index))]?.age;
    return typeof age === "number" && Number.isFinite(age) ? age : null;
  };
  const span = (firstIndex: number, lastIndex: number) => {
    const first = ageAt(firstIndex);
    const last = ageAt(lastIndex);
    return first != null && last != null ? { first, last } : null;
  };
  const viewportRows = Math.max(1, Math.ceil((scroller?.clientHeight ?? 0) / rowHeight));
  if (restoreAnchor) {
    const anchorRowHeight = restoreAnchor.rowHeight > 0 ? restoreAnchor.rowHeight : rowHeight;
    const firstIndex = Math.floor(restoreAnchor.scrollTop / anchorRowHeight);
    return span(firstIndex, firstIndex + viewportRows);
  }
  if (measureScroller) {
    const visible = secondaryVisibleAgeSpan(scroller, rows, rowHeight);
    if (visible.firstVisibleAge != null && visible.lastVisibleAge != null) {
      return { first: visible.firstVisibleAge, last: visible.lastVisibleAge };
    }
  }
  const dateOf = (row: SecondaryDirectionRow) => row.eventDatetime ?? row.date;
  const focusIndex = nearestDateIndex(rows, directionFocusTargetMs(rows, focusDatetime, dateOf), dateOf);
  return focusIndex >= 0 ? span(focusIndex, focusIndex) : null;
}

/** Order reload pieces nearest the visible ages first. */
function secondaryPiecesVisibleFirst(
  pieces: readonly SecondaryReloadPiece[],
  visible: { first: number; last: number },
): SecondaryReloadPiece[] {
  const lo = Math.min(visible.first, visible.last);
  const hi = Math.max(visible.first, visible.last);
  const distance = (piece: SecondaryReloadPiece) =>
    piece.end < lo ? lo - piece.end : piece.start > hi ? piece.start - hi : 0;
  return [...pieces].sort((a, b) => distance(a) - distance(b));
}

/** Bounded exponential backoff for a request that failed or made no progress:
 * at most `limit` scheduled retries until `reset` (success or a new key). */
function createSecondaryRetry(limit: number, baseMs: number) {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
  };
  return {
    /** Schedule `run` once; false when a retry is pending or the budget is spent. */
    schedule(run: () => void): boolean {
      if (timer != null || attempt >= limit) return false;
      const delay = baseMs * 2 ** attempt;
      attempt += 1;
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delay);
      return true;
    },
    reset() {
      attempt = 0;
      clear();
    },
    dispose: clear,
    get attempts() { return attempt; },
  };
}

/**
 * Reload `pieces` of a resident span in place under `dataKey`, one
 * growth-sized request at a time in order. Each landed piece swaps its rows;
 * the others stay on screen until theirs land. Coverage never shrinks: a piece
 * cut at the daemon row cap keeps its unread rows and re-requests the
 * remainder next. Every published store is exact about its rows: those in
 * `stalePieces` are still of an older key (or unread), every other row is of
 * `dataKey`. A failure or a piece that made no progress ends the chain with
 * those pieces stale (`incomplete`); the caller resumes them with backoff.
 * A piece built under another key is never mixed in: `restart` hands that key
 * over. Cancelling `request` (a newer revision, another list) stops the chain.
 */
function reloadSecondarySpanInPlace({
  resident,
  request,
  dataKey,
  pieces,
  wholeSpan,
  fetchPiece,
  commit,
  restart,
  fail,
}: {
  resident: SecondaryStitchStore;
  request: RetainedListRequest<SecondaryStitchStore>;
  dataKey: string;
  pieces: readonly SecondaryReloadPiece[];
  /** The pieces cover all of `resident.coverage` (not a resume of stale ones). */
  wholeSpan: boolean;
  fetchPiece: (
    piece: SecondaryReloadPiece,
    radixIdentity: string | null,
    signal: AbortSignal,
  ) => Promise<SecondaryDirectionsPayload>;
  /** `done`: the chain ended; `next.stalePieces` says whether it is complete. */
  commit: (store: SecondaryStitchStore, done: boolean) => void;
  restart: (dataKey: string) => void;
  fail: (err: unknown, store: SecondaryStitchStore) => void;
}): void {
  const queue = [...pieces];
  // Pieces whose rows were not read this run: they stay of an older key.
  const unread: SecondaryReloadPiece[] = [];
  let rows = resident.rows;
  let radixIdentity = resident.radixIdentity;
  let meta: SecondaryDirectionsPayload["meta"] | null = null;
  const unavailable = new Map<string, { id: string; label: string }>();
  let authoritative = true;
  let temporal: TemporalCoverage | null = null;
  let temporalWhole = wholeSpan;
  const snapshot = (done: boolean): SecondaryStitchStore => {
    const stalePieces = [...unread, ...queue];
    const complete = done && stalePieces.length === 0;
    return {
      rows,
      coverage: resident.coverage,
      islandNonce: resident.islandNonce,
      meta: meta
        ? {
            ...meta,
            // The growth centre belongs to the island, not to this reload.
            referenceAge: resident.meta.referenceAge,
            startAge: resident.coverage.start,
            endAge: resident.coverage.end,
            unavailableEphemeris: [...unavailable.values()],
          }
        : resident.meta,
      // Until every piece has landed, part of the rows is of an older key.
      coverageAuthoritative: complete && authoritative,
      temporalCoverage: complete ? (temporalWhole ? temporal : null) : resident.temporalCoverage,
      dataKey,
      stalePieces,
      radixIdentity,
    };
  };
  const publish = (done: boolean): boolean => {
    const next = snapshot(done);
    if (!request.publish(next)) return false;
    if (done) request.finish();
    commit(next, done);
    return true;
  };
  const step = (): void => {
    if (!queue.length) {
      publish(true);
      return;
    }
    const piece = queue[0];
    fetchPiece(piece, radixIdentity, request.signal)
      .then((data) => {
        if (!request.current()) return;
        if (data.dataKey && data.dataKey !== dataKey) {
          // The world moved on mid-reload: never mix two keys' rows.
          request.finish();
          restart(data.dataKey);
          return;
        }
        queue.shift();
        radixIdentity = data.radixIdentity ?? radixIdentity;
        meta ??= data.meta;
        for (const body of data.meta.unavailableEphemeris ?? []) unavailable.set(body.id, body);
        if (data.meta.unavailableEphemeris?.length) authoritative = false;
        let upper = piece.upper;
        if (data.meta.truncated) {
          temporalWhole = false;
          const lastAge = lastSecondaryRowAge(data.directions);
          if (lastAge == null || lastAge <= piece.start + SECONDARY_RELOAD_EPSILON) {
            // No progress: its rows stay of the older key and stay stale.
            console.warn("[secondary-reload] truncated piece made no progress", piece);
            unread.push(piece);
            step();
            return;
          }
          // Swap what was read; the rest of the piece is requested next.
          upper = lastAge;
          queue.unshift({ start: lastAge, end: piece.end, lower: lastAge, upper: piece.upper });
        } else if (temporalWhole) {
          const merged = mergeContiguousTemporalCoverage(temporal, data.meta.temporalCoverage);
          if (merged && authoritativeTemporalCoverage(data.meta.temporalCoverage)) temporal = merged;
          else temporalWhole = false;
        }
        rows = replaceSecondaryRowsInSpan(rows, data.directions, piece.lower, upper);
        if (!queue.length) {
          publish(true);
          return;
        }
        if (publish(false)) step();
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        if (!request.current()) return;
        // The rows on screen stay, exact about which pieces are still stale.
        const next = snapshot(true);
        request.publish(next);
        request.finish();
        fail(err, next);
      });
  };
  step();
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
  chunkYears: number,
): AgeSpan {
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
  chunkYears: number,
): number {
  const window = secondarySeedWindowForAgeRange(range, seek, chunkYears);
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

/** The chart's node and Moon parallax correction the PD engine directs. */
function primaryDirectionGlobals(options: OptionsPatchPayload): PrimaryDirectionGlobals {
  return { meannode: options.planetsPoints.meannode, topocentric: options.display.topocentric };
}

function withPatchedGlobals(
  globals: PrimaryDirectionGlobals | null,
  patch: OptionsPatch | null | undefined,
): PrimaryDirectionGlobals | null {
  if (!globals) return globals;
  return {
    meannode: patch?.planetsPoints?.meannode ?? globals.meannode,
    topocentric: patch?.display?.topocentric ?? globals.topocentric,
  };
}

function useQueuedPrimaryDirectionSettingsPatch({
  setSettings,
  setSettingsGlobals,
  optionsSeq,
  onLoaded,
  onCommitted,
}: {
  setSettings: React.Dispatch<React.SetStateAction<OptionsPrimaryDirections | null>>;
  setSettingsGlobals: React.Dispatch<React.SetStateAction<PrimaryDirectionGlobals | null>>;
  optionsSeq: number;
  onLoaded: (options: OptionsPatchPayload) => void;
  onCommitted?: (options: OptionsPatchPayload) => void;
}) {
  type QueuedWrite = { patch: OptionsPatch; reply?: (ok: boolean) => void };
  const queueRef = React.useRef<QueuedWrite[]>([]);
  const timerRef = React.useRef<number | null>(null);
  const inFlightRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const revisionRef = React.useRef(0);
  const flushRef = React.useRef<() => void>(() => {});

  const flush = React.useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlightRef.current) return;
    const write = queueRef.current.shift();
    if (!write) return;
    inFlightRef.current = true;
    void patchOptions(write.patch)
      .then(options => {
        revisionRef.current += 1;
        if (mountedRef.current) {
          const pending = queueRef.current.reduce<OptionsPatch | null>(
            (fields, item) => mergeOptionsPatch(fields, item.patch), null);
          setSettings({ ...options.primaryDirections, ...pending?.primaryDirections });
          setSettingsGlobals(withPatchedGlobals(primaryDirectionGlobals(options), pending));
          if (!queueRef.current.length) onCommitted?.(options);
        }
        write.reply?.(true);
      })
      .catch(async () => {
        if (write.patch.primaryDirectionPreset) {
          try {
            const options = await fetchOptions();
            if (mountedRef.current) setSettings(previous => previous
              ? { ...previous, userPresets: options.primaryDirections.userPresets } : previous);
          } catch { /* Keep current controls available while disconnected. */ }
        }
        write.reply?.(false);
      })
      .finally(() => {
        inFlightRef.current = false;
        if (queueRef.current.length) flushRef.current();
      });
  }, [onCommitted, setSettings, setSettingsGlobals]);

  React.useEffect(() => { flushRef.current = flush; }, [flush]);
  React.useEffect(() => {
    // A write response owns reconciliation while edits are pending. Reading
    // options here would race that response and roll newer toggles backwards.
    if (inFlightRef.current || queueRef.current.length) return;
    const controller = new AbortController();
    const revision = revisionRef.current;
    fetchOptions(controller.signal)
      .then(options => {
        if (controller.signal.aborted || revision !== revisionRef.current) return;
        setSettings(options.primaryDirections);
        setSettingsGlobals(primaryDirectionGlobals(options));
        onLoaded(options);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [onLoaded, optionsSeq, setSettings, setSettingsGlobals]);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      // Persist already-issued intent even if the settings pane closes.
      flushRef.current();
    };
  }, []);

  return React.useCallback(
    (patch: Partial<OptionsPrimaryDirections>, optionsPatch?: OptionsPatch) => {
      revisionRef.current += 1;
      const primaryDirections = { ...optionsPatch?.primaryDirections, ...patch };
      const request: OptionsPatch = { ...optionsPatch };
      if (hasPatchKeys(primaryDirections)) request.primaryDirections = primaryDirections;
      setSettings(prev => prev ? { ...prev, ...primaryDirections } : prev);
      setSettingsGlobals(prev => withPatchedGlobals(prev, optionsPatch));
      const queue = queueRef.current;
      const last = queue[queue.length - 1];
      let reply: Promise<boolean> | undefined;
      if (request.primaryDirectionPreset) {
        // Preset actions are ordered barriers: a save captures preceding edits,
        // never later clicks, and cannot be coalesced into another action.
        reply = new Promise<boolean>(resolve => queue.push({ patch: request, reply: resolve }));
      } else if (last && !last.patch.primaryDirectionPreset) {
        last.patch = mergeOptionsPatch(last.patch, request) ?? request;
      } else {
        queue.push({ patch: request });
      }
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      if (request.primaryDirectionPreset) flushRef.current();
      else timerRef.current = window.setTimeout(() => flushRef.current(), PRIMARY_SETTINGS_PATCH_DEBOUNCE_MS);
      return reply;
    }, [setSettings, setSettingsGlobals],
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
  beforePaint = true,
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
    dispatchVirtualScrollSync(scroller, beforePaint);
  }
  return applied;
}

type DirectionViewportAnchor = {
  scrollTop: number;
  rowHeight: number;
};

type PrimaryViewportAnchor = {
  timeMs: number;
  rowOffset: number;
};

type PrimaryTimeViewportAnchor = PrimaryViewportAnchor & {
  focusDatetime: string | undefined;
};

type PrimaryRectificationContact = {
  contactKey: string;
  timeMs: number;
  rowOffset: number;
};

/** The middle row's time (fallback) plus every contact on screen. */
type PrimaryRectificationViewportAnchor = PrimaryViewportAnchor & {
  contacts: readonly PrimaryRectificationContact[];
  sourceRows: readonly DirectionRow[];
};

function primaryDirectionContactKey(row: DirectionRow): string {
  // The daemon signature is append-only. Arc and event JD (slots 8/9) move
  // during rectification; all remaining fields identify the actual contact,
  // including dynamic points, aspect offsets, system and source provenance.
  return JSON.stringify([...row.signature.slice(0, 8), ...row.signature.slice(10)]);
}

/** A rectification step rebuilds the radix, so the live focus time (its display
 * or signified datetime) echoes the step. That echo is not navigation: hold
 * focus-follow while a step is pending, then absorb its first focus change. */
type RectificationFocusHold = {
  pending: boolean;
  focusDatetime: string | null | undefined;
  until: number;
};

function createRectificationFocusHold(): RectificationFocusHold {
  return { pending: false, focusDatetime: undefined, until: 0 };
}

function startRectificationFocusHold(hold: RectificationFocusHold): void {
  hold.pending = true;
}

function settleRectificationFocusHold(
  hold: RectificationFocusHold,
  focusDatetime: string | null | undefined,
  now = Date.now(),
): void {
  hold.pending = false;
  hold.focusDatetime = focusDatetime;
  hold.until = now + RECTIFICATION_FOCUS_ECHO_MS;
}

function releaseRectificationFocusHold(hold: RectificationFocusHold): void {
  hold.until = 0;
}

/** The echo can queue behind a slow replacement list; an unabsorbed hold keeps
 * its window open from the moment the new rows land, not from the step. */
function extendRectificationFocusHold(hold: RectificationFocusHold, now = Date.now()): void {
  if (hold.until > 0) hold.until = Math.max(hold.until, now + RECTIFICATION_FOCUS_ECHO_MS);
}

function rectificationFocusHeld(
  hold: RectificationFocusHold,
  focusDatetime: string | null | undefined,
  now = Date.now(),
): boolean {
  if (hold.pending) return true;
  if (now >= hold.until) return false;
  if (focusDatetime !== hold.focusDatetime) releaseRectificationFocusHold(hold);
  return true;
}

function capturePrimaryRectificationViewport(
  scroller: HTMLDivElement | null,
  rows: readonly DirectionRow[],
  rowHeight: number,
): PrimaryRectificationViewportAnchor | null {
  const index = scrollAnchorRowIndex(scroller, rows.length, 0.5, rowHeight);
  if (!scroller || index < 0 || rowHeight <= 0) return null;
  const timeMs = parseDateMs(rows[index].date);
  if (timeMs == null) return null;
  const top = scroller.scrollTop / rowHeight;
  const first = Math.max(0, Math.floor(top));
  const last = Math.min(rows.length - 1, Math.ceil(top + scroller.clientHeight / rowHeight));
  const contacts: PrimaryRectificationContact[] = [];
  for (let visible = first; visible <= last; visible += 1) {
    const visibleMs = parseDateMs(rows[visible].date);
    if (visibleMs == null) continue;
    contacts.push({
      contactKey: primaryDirectionContactKey(rows[visible]),
      timeMs: visibleMs,
      rowOffset: visible - top,
    });
  }
  return { contacts, sourceRows: rows, timeMs, rowOffset: index - top };
}

function restorePrimaryRectificationViewport(
  scroller: HTMLDivElement | null,
  rows: readonly DirectionRow[],
  rowHeight: number,
  anchor: PrimaryRectificationViewportAnchor,
): boolean {
  // Cursor/chrome updates may commit before the replacement list arrives.
  if (rows === anchor.sourceRows) return false;
  // A step moves angle and cusp contacts by months while most others barely
  // move. Hold the on-screen contact whose date moved least, so the lines in
  // view stay put and only the moving contacts travel through them.
  const wanted = new Map(anchor.contacts.map((contact) => [contact.contactKey, contact]));
  let heldIndex = -1;
  let heldOffset = anchor.rowOffset;
  let leastMoved = Number.POSITIVE_INFINITY;
  let leastFromMiddle = Number.POSITIVE_INFINITY;
  for (let index = 0; index < rows.length; index += 1) {
    const contact = wanted.get(primaryDirectionContactKey(rows[index]));
    const timeMs = contact ? parseDateMs(rows[index].date) : null;
    if (!contact || timeMs == null) continue;
    const moved = Math.abs(timeMs - contact.timeMs);
    const fromMiddle = Math.abs(contact.rowOffset - anchor.rowOffset);
    if (moved < leastMoved || (moved === leastMoved && fromMiddle < leastFromMiddle)) {
      heldIndex = index;
      heldOffset = contact.rowOffset;
      leastMoved = moved;
      leastFromMiddle = fromMiddle;
    }
  }
  // Every contact in view can leave the requested range; retain the time then.
  return heldIndex >= 0
    ? restorePrimaryTimeViewport(scroller, rows, rowHeight, { ...anchor, rowOffset: heldOffset }, heldIndex)
    : restorePrimaryTimeViewport(scroller, rows, rowHeight, anchor);
}

function capturePrimaryTimeViewport(
  scroller: HTMLDivElement | null,
  rows: readonly DirectionRow[],
  rowHeight: number,
  focusDatetime: string | undefined,
): PrimaryTimeViewportAnchor | null {
  const index = scrollAnchorRowIndex(scroller, rows.length, PRIMARY_FOCUS_ANCHOR, rowHeight);
  if (!scroller || index < 0 || rowHeight <= 0) return null;
  const timeMs = parseDateMs(rows[index].date);
  if (timeMs == null) return null;
  return { timeMs, rowOffset: index - scroller.scrollTop / rowHeight, focusDatetime };
}

function restorePrimaryTimeViewport(
  scroller: HTMLDivElement | null,
  rows: readonly DirectionRow[],
  rowHeight: number,
  anchor: PrimaryViewportAnchor,
  index = nearestDateIndex(rows, anchor.timeMs, (row) => row.date),
): boolean {
  if (!scroller || scroller.clientHeight <= 0 || rowHeight <= 0) return false;
  if (index < 0) return false;
  const maxTop = Math.max(0, rows.length * rowHeight - scroller.clientHeight);
  scroller.scrollTop = Math.max(0, Math.min(maxTop, (index - anchor.rowOffset) * rowHeight));
  // This runs in a layout effect: update the virtual slice before paint without
  // nesting flushSync inside React's commit.
  dispatchVirtualScrollSync(scroller);
  return true;
}

function captureDirectionViewport(
  scroller: HTMLDivElement | null,
  rowHeight: number,
): DirectionViewportAnchor | null {
  if (!scroller) return null;
  return { scrollTop: scroller.scrollTop, rowHeight };
}

type SecondaryTabViewport = {
  rowKey: string;
  /** The row's top relative to the scroller's top edge, in CSS px. */
  rowOffset: number;
  focusSignature: string;
  islandSignature: string;
};

function captureSecondaryTabViewport(
  scroller: HTMLDivElement | null,
  rows: readonly SecondaryDirectionRow[],
  rowHeight: number,
  signature: { focusSignature: string; islandSignature: string },
): SecondaryTabViewport | null {
  if (!scroller || scroller.clientHeight <= 0 || rowHeight <= 0) return null;
  const index = scrollAnchorRowIndex(scroller, rows.length, SECONDARY_FOCUS_ANCHOR, rowHeight);
  const row = index >= 0 ? rows[index] : undefined;
  if (!row) return null;
  return {
    rowKey: secondaryStitchRowKey(row),
    rowOffset: index * rowHeight - scroller.scrollTop,
    ...signature,
  };
}

/** Put the kept row back where it sat, at once (before paint). False when the
 * focus target or island moved since, or the row is gone: re-anchor on focus. */
function restoreSecondaryTabViewport(
  scroller: HTMLDivElement | null,
  viewport: SecondaryTabViewport | null,
  rows: readonly SecondaryDirectionRow[],
  rowHeight: number,
  signature: { focusSignature: string; islandSignature: string },
): boolean {
  if (
    !scroller ||
    !viewport ||
    scroller.clientHeight <= 0 ||
    viewport.focusSignature !== signature.focusSignature ||
    viewport.islandSignature !== signature.islandSignature
  ) return false;
  const index = rows.findIndex((row) => secondaryStitchRowKey(row) === viewport.rowKey);
  if (index < 0) return false;
  const maxTop = Math.max(0, rows.length * rowHeight - scroller.clientHeight);
  scroller.scrollTop = Math.max(0, Math.min(maxTop, index * rowHeight - viewport.rowOffset));
  // Called from the tab-activation layout effect: the slice update is already
  // pre-paint and must not nest flushSync inside React's commit.
  dispatchVirtualScrollSync(scroller);
  return true;
}

function restoreDirectionViewport(
  scroller: HTMLDivElement | null,
  anchor: DirectionViewportAnchor,
  rowCount: number,
  rowHeight: number,
  beforePaint = true,
): boolean {
  if (!scroller || scroller.clientHeight <= 0) return false;
  const sourceRowHeight = anchor.rowHeight > 0 ? anchor.rowHeight : rowHeight;
  const translatedTop = (anchor.scrollTop / sourceRowHeight) * rowHeight;
  const maxTop = Math.max(0, rowCount * rowHeight - scroller.clientHeight);
  scroller.scrollTop = Math.max(0, Math.min(maxTop, translatedTop));
  dispatchVirtualScrollSync(scroller, beforePaint);
  return true;
}

function scheduleDirectionViewportRestore(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  anchor: DirectionViewportAnchor,
  rowCount: number,
  rowHeight: number,
  inCommit = false,
): () => void {
  let frame = 0;
  let attempts = 0;
  let cancelled = false;
  // The first attempt runs in the caller's turn. Inside a layout effect the
  // slice update is already pre-paint, and flushSync there would nest inside
  // React's commit; retries run from animation frames and do need the flush.
  let beforePaint = !inCommit;
  const tick = () => {
    if (cancelled) return;
    const restored = restoreDirectionViewport(
      scrollerRef.current, anchor, rowCount, rowHeight, beforePaint,
    );
    beforePaint = true;
    if (restored) return;
    attempts += 1;
    if (attempts < 30) {
      frame = requestAnimationFrame(tick);
    }
  };
  // At once when the scroller can take it (a layout effect: before paint),
  // else on the next frames.
  tick();
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
  inCommit = false,
): () => void {
  if (rowIndex < 0 || rowCount <= 0) return () => {};
  let frame = 0;
  let attempts = 0;
  let cancelled = false;
  // See scheduleDirectionViewportRestore: no flushSync on a first attempt made
  // inside a layout effect; frame retries flush before paint.
  let beforePaint = !inCommit;
  const tick = () => {
    if (cancelled) return;
    const scroller = scrollerRef.current;
    const scrolled = scrollFocusedDirectionRow(
      scroller, rowCount, anchorRatio, rowIndex, rowHeight, beforePaint,
    );
    beforePaint = true;
    if (scrolled) return;
    attempts += 1;
    if (attempts < 30) {
      frame = requestAnimationFrame(tick);
    }
  };
  // At once when the scroller can take it (a layout effect: before paint, so
  // an activated tab never paints its old position), else on the next frames.
  tick();
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
    const visibleCount = Math.max(
      1,
      Math.ceil(viewport.height / rowHeight),
    );
    const rawVisibleStart =
      viewport.height > 0
        ? Math.floor(viewport.scrollTop / rowHeight)
        : seededStart;
    const visibleStart = Math.max(
      0,
      Math.min(rawVisibleStart, Math.max(0, rowCount - visibleCount)),
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
        LIST_DATE_LINK_CLASSES,
        disabled ? "pointer-events-none cursor-default" : "",
      )}
    >
      {children}
    </button>
  );
}

/** Date link of a direct row while an Astrolabe is the list's cursor: turns
 * that Astrolabe's rete to the row's arc (the view persists it in the daemon). */
function AstrolabeArcLink({
  documentId,
  arc,
  children,
}: {
  documentId: string;
  arc: number;
  children: React.ReactNode;
}) {
  const requestArc = useAstrolabeStore((s) => s.requestArc);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        requestArc(documentId, Math.abs(arc));
      }}
      className={cn(
        LIST_TEXT_CLASSES.date,
        "inline-block cursor-pointer whitespace-nowrap tabular-nums underline-offset-2 hover:text-primary hover:underline",
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
  anglePrecision = false,
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
  anglePrecision?: boolean;
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
        {anglePrecision ? <><ContextMenuSeparator /><TablePrecisionChoices /></> : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// --- "PDs in Chart" row action. Aries maps a calculated Z row to the
// celestial projection and an M row to the terrestrial projection. Zodiacal
// and ascensional display share that construction and its complete outer ring.
// It is present only for a radix PD list, never the return lists.
function PdInChartMenuItem({
  documentId,
  arc,
  mode,
  coordinateMode,
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
  coordinateMode: "zodiacal" | "ascensional";
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
      coordinateMode,
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
  }, [applyTimedChartOpenResult, arc, coordinateMode, direct, directionEvent, documentId, eventDatetime, eventJd, mode, onActionError, sessionLabel, tf]);
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
  significatorsDocumentId,
  chart = null,
  retainedView,
  onViewChange,
  onClose,
}: {
  sourceName: string;
  source?: string;
  documentId: string;
  cursorDocumentId?: string;
  /** Chart whose PD arc (or cursor arc) the Speculum view directs by. */
  significatorsDocumentId?: string;
  chart?: ChartRenderSnapshot | null;
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
  /** Tab and Primary surface held by the retained pane; wins over initialTab. */
  retainedView?: DirectionsPaneView;
  onViewChange?: (view: DirectionsPaneView) => void;
  onClose?: () => void;
}) {
  const t = useT();
  const rowHeight = useListRowHeight("symbolic");
  // Progressions read as headerless glyph sentences at the standard tier
  // (list-language survey §10).
  const secondaryRowHeight = useListRowHeight("standard");
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const settingsDock = useFrameLayoutStore((state) => state.primaryDirectionsSettingsDock);
  const [tab, setTabState] = React.useState<DirectionsTopTab>(
    () => retainedView?.tab ?? topTabFromInitial(initialTab),
  );
  const [primarySurface, setPrimarySurface] = React.useState<PrimaryDirectionsSurface>(
    () => retainedView?.surface ?? primarySurfaceFromInitial(initialTab),
  );
  // Surfaces stay mounted once visited, so switching back keeps their mode,
  // filters and viewport; the Speculum's moment is daemon-held.
  const [visitedSurfaces, setVisitedSurfaces] = React.useState<ReadonlySet<PrimaryDirectionsSurface>>(
    () => new Set([retainedView?.surface ?? primarySurfaceFromInitial(initialTab)]),
  );
  // Tabs, likewise: a visited tab stays mounted (hidden) beside the one on
  // screen and keeps its rows current, so switching back shows them at once.
  // An unvisited tab mounts nothing and sends nothing.
  const [visitedTabs, setVisitedTabs] = React.useState<ReadonlySet<DirectionsTopTab>>(
    () => new Set([retainedView?.tab ?? topTabFromInitial(initialTab)]),
  );
  const applyView = React.useCallback((view: DirectionsPaneView) => {
    setTabState(view.tab);
    setPrimarySurface(view.surface);
    setVisitedSurfaces((visited) => (
      visited.has(view.surface) ? visited : new Set([...visited, view.surface])
    ));
    setVisitedTabs((visited) => (
      visited.has(view.tab) ? visited : new Set([...visited, view.tab])
    ));
  }, []);
  const setTab = React.useCallback((next: DirectionsTopTab) => {
    const view = { tab: next, surface: primarySurface };
    applyView(view);
    onViewChange?.(view);
  }, [applyView, onViewChange, primarySurface]);
  const showPrimarySurface = React.useCallback((surface: PrimaryDirectionsSurface) => {
    const view = { tab, surface };
    applyView(view);
    onViewChange?.(view);
  }, [applyView, onViewChange, tab]);
  // A new open seeds the view; a restored pane keeps its remembered one.
  const seedView = React.useEffectEvent(() => {
    applyView(retainedView ?? {
      tab: topTabFromInitial(initialTab),
      surface: primarySurfaceFromInitial(initialTab),
    });
  });
  const primarySurfaceOptions = React.useMemo(
    () => [
      { value: "directions" as PrimaryDirectionsSurface, label: t("dirview.pdList") },
      { value: "circumambulation" as PrimaryDirectionsSurface, label: t("dirview.circum") },
      { value: "significators" as PrimaryDirectionsSurface, label: t("dirview.significators") },
    ],
    [t],
  );
  const rectificationInFlightRef = React.useRef(false);
  const suppressRectificationSessionUntilRef = React.useRef(0);
  const [directionRadixRefreshSeq, bumpRectificationRefresh] = useDirectionsRadixRefreshSeq(
    documentId,
    cursorDocumentId ?? documentId,
    rectificationInFlightRef,
    suppressRectificationSessionUntilRef,
  );
  const handleRectificationStepStart = React.useCallback(() => {
    rectificationInFlightRef.current = true;
  }, []);
  const handleRectificationCommitted = React.useCallback(() => {
    rectificationInFlightRef.current = false;
    suppressRectificationSessionUntilRef.current =
      Date.now() + RECTIFICATION_SESSION_ECHO_SUPPRESS_MS;
    bumpRectificationRefresh();
  }, [bumpRectificationRefresh]);
  const handleRectificationSettled = React.useCallback(() => {
    rectificationInFlightRef.current = false;
  }, []);
  const settledFocusDatetime = useStepSettledValue(focusDatetime ?? null);
  const renderedFocusDatetime = followStepBursts
    ? focusDatetime ?? null
    : settledFocusDatetime;
  React.useEffect(() => {
    queueMicrotask(seedView);
  }, [documentId, initialTab, openSeq]);
  const primaryActive = tab === "primary";
  const secondaryActive = tab === "secondary";
  // A tab behind its sibling is not a hidden surface: inside a visible view it
  // keeps its rows current in the background. Only the view itself being off
  // screen (a minimized touch pane) idles both tabs until it shows again.
  const viewVisible = React.useContext(RetainedPaneVisibleContext);
  // The tab behind follows the settled focus only, so a step burst followed
  // live by the tab on screen never re-renders the one behind it.
  const primaryFocusDatetime = (primaryActive ? renderedFocusDatetime : settledFocusDatetime) ?? undefined;
  const secondaryFocusDatetime = (secondaryActive ? renderedFocusDatetime : settledFocusDatetime) ?? undefined;

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
          {primaryActive ? (
            <ListSegmentedControl
              label={t("dirview.primaryView")}
              options={primarySurfaceOptions}
              value={primarySurface}
              onChange={showPrimarySurface}
            />
          ) : null}
        </div>
      ) : null}
      <TabsContent
        value="primary"
        keepMounted
        className={cn("flex flex-1 min-h-0 flex-col", !primaryActive && "hidden")}
      >
        {visitedTabs.has("primary") && visitedSurfaces.has("directions") ? (
          <div className={cn("flex flex-1 min-h-0 flex-col", primarySurface !== "directions" && "hidden")}>
            <MemoPrimaryDirectionsPanel
              sourceName={sourceName}
              source={source}
              documentId={documentId}
              cursorDocumentId={cursorDocumentId ?? documentId}
              focusDatetime={primaryFocusDatetime}
              openSeq={openSeq}
              initialMode={initialPrimaryMode}
              initialDirection={initialPrimaryDirection}
              customSignificator={customSignificator}
              includeTemporal={includeTemporal}
              lockMode={lockTechnique}
              radixRefreshSeq={directionRadixRefreshSeq}
              active={primaryActive && primarySurface === "directions"}
              onRectificationStepStart={handleRectificationStepStart}
              onRectificationCommitted={handleRectificationCommitted}
              onRectificationSettled={handleRectificationSettled}
              rowHeight={rowHeight}
              settingsOpen={settingsOpen}
              settingsDock={settingsDock}
              onSettingsOpenChange={setSettingsOpen}
            />
          </div>
        ) : null}
        {visitedTabs.has("primary") && visitedSurfaces.has("circumambulation") ? (
          <div className={cn("flex flex-1 min-h-0 flex-col", primarySurface !== "circumambulation" && "hidden")}>
            <MemoCircumambulationPanel
              sourceName={sourceName}
              source={source}
              documentId={documentId}
              cursorDocumentId={cursorDocumentId ?? documentId}
              focusDatetime={primaryFocusDatetime}
              openSeq={openSeq}
              initialMode={initialPrimaryMode}
              customSignificator={customSignificator}
              includeTemporal={includeTemporal}
              lockMode={lockTechnique}
              radixRefreshSeq={directionRadixRefreshSeq}
              active={primaryActive && primarySurface === "circumambulation"}
              onRectificationStepStart={handleRectificationStepStart}
              onRectificationCommitted={handleRectificationCommitted}
              onRectificationSettled={handleRectificationSettled}
              rowHeight={rowHeight}
              settingsOpen={settingsOpen}
              settingsDock={settingsDock}
              onSettingsOpenChange={setSettingsOpen}
            />
          </div>
        ) : null}
        {primarySurface === "significators" ? (
          <DirectedSpeculumSurface
            documentId={significatorsDocumentId ?? cursorDocumentId ?? documentId}
            chart={chart}
            settingsOpen={settingsOpen}
            settingsDock={settingsDock}
            onSettingsOpenChange={setSettingsOpen}
          />
        ) : null}
      </TabsContent>
      <TabsContent
        value="secondary"
        keepMounted
        className={cn("flex flex-1 min-h-0 flex-col", !secondaryActive && "hidden")}
      >
        {visitedTabs.has("secondary") ? (
          <MemoSecondaryDirectionsPanel
            sourceName={sourceName}
            source={source}
            documentId={documentId}
            cursorDocumentId={cursorDocumentId ?? documentId}
            focusDatetime={secondaryFocusDatetime}
            initialMethod={secondaryMethod}
            includeTemporal={includeTemporal}
            lockMethod={lockTechnique}
            radixRefreshSeq={directionRadixRefreshSeq}
            active={secondaryActive}
            dataActive={viewVisible}
            onRectificationStepStart={handleRectificationStepStart}
            onRectificationCommitted={handleRectificationCommitted}
            onRectificationSettled={handleRectificationSettled}
            rowHeight={secondaryRowHeight}
          />
        ) : null}
      </TabsContent>
    </Tabs>
  );
}

// Every tab and surface panel stays mounted once visited; memoised, a re-render
// of the view (a focus prop that a hidden panel does not follow) leaves the
// panels whose own props did not change alone.
const MemoPrimaryDirectionsPanel = React.memo(PrimaryDirectionsPanel);
const MemoCircumambulationPanel = React.memo(CircumambulationPanel);
const MemoSecondaryDirectionsPanel = React.memo(SecondaryDirectionsPanel);

/** The Primary tab's Speculum surface: the directed speculum beside the same
 * live Primary Directions settings dock as the PD list and Circum. */
function DirectedSpeculumSurface({
  documentId,
  chart,
  settingsOpen,
  settingsDock,
  onSettingsOpenChange,
}: {
  documentId: string;
  chart: ChartRenderSnapshot | null;
} & PrimarySettingsPaneProps) {
  const [settings, setSettings] = React.useState<OptionsPrimaryDirections | null>(null);
  const [settingsGlobals, setSettingsGlobals] = React.useState<PrimaryDirectionGlobals | null>(null);
  const [settingsPlanetGlyphs, setSettingsPlanetGlyphs] = React.useState<readonly string[]>(
    PRIMARY_SETTINGS_PLANET_GLYPHS,
  );
  const optionsSeq = useDirectionsOptionsSeq();
  const onSettingsLoaded = React.useCallback((options: OptionsPatchPayload) => {
    setSettingsPlanetGlyphs(primarySettingsPlanetGlyphs(options.catalog));
  }, []);
  const onPatchSettings = useQueuedPrimaryDirectionSettingsPatch({
    setSettings,
    setSettingsGlobals,
    optionsSeq,
    onLoaded: onSettingsLoaded,
  });
  return (
    <PrimarySettingsDockLayout
      open={settingsOpen}
      dock={settingsDock}
      settings={settings}
      globals={settingsGlobals}
      planetGlyphs={settingsPlanetGlyphs}
      onClose={() => onSettingsOpenChange(false)}
      onPatch={onPatchSettings}
    >
      <DirectedSignificatorsPanel
        documentId={documentId}
        chart={chart}
        settingsControl={
          <PrimarySettingsControl open={settingsOpen} onOpenChange={onSettingsOpenChange} />
        }
      />
    </PrimarySettingsDockLayout>
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
  rowHeight,
  settingsOpen,
  settingsDock,
  onSettingsOpenChange,
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
  rowHeight: number;
} & PrimarySettingsPaneProps) {
  const t = useT();
  // An Astrolabe is a primary-direction chart of this radix: when it is the
  // list's cursor, a direct row's date turns its rete to the row's arc.
  const astrolabeCursorId = useDaemonWorkspaceStore((state) => (
    cursorDocumentId
    && state.documents.some((doc) => doc.documentId === cursorDocumentId && doc.launcherKind === "astrolabe")
      ? cursorDocumentId
      : null
  ));
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
  const [settingsGlobals, setSettingsGlobals] = React.useState<PrimaryDirectionGlobals | null>(null);
  const [optionsContextKey, setOptionsContextKey] = React.useState<string | null>(null);
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
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const rectificationViewportRef = React.useRef<PrimaryRectificationViewportAnchor | null>(null);
  const rectificationFocusHoldRef = React.useRef(createRectificationFocusHold());
  const settingsViewportRef = React.useRef<PrimaryTimeViewportAnchor | null>(null);
  const payloadRef = React.useRef(payload);
  const previousRequestRef = React.useRef<
    { navigationKey: string; cacheKey: string; radixRefreshSeq?: number } | null
  >(null);
  React.useLayoutEffect(() => {
    payloadRef.current = payload;
  }, [payload]);
  const requestSeqRef = React.useRef(0);
  const optionsSeq = useDirectionsOptionsSeq();
  const layoutPreset = useListLayoutPreset();
  const rectificationDocumentId = cursorDocumentId ?? documentId;
  const optionsPreviewKey = React.useMemo(
    () => JSON.stringify(primaryDirectionsPreviewOptionsPatch(settings)),
    [settings],
  );
  // Preset names/dirty markers are metadata, not a new query. Keep the request
  // object stable while its semantic settings remain identical.
  const optionsPreview = React.useMemo<OptionsPatch | null>(
    () => JSON.parse(optionsPreviewKey) as OptionsPatch | null,
    [optionsPreviewKey],
  );
  const settingsDefaultDirection = defaultPrimaryDirectionFromSettings(settings);
  const direction =
    selectedDirection ?? settingsDefaultDirection ?? PRIMARY_DIRECTION_DIRECT;
  const primaryRequestReady = settings != null;
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
        optionsContextKey,
        ageWindow,
        ageSeek,
        referenceDatetime: payloadReferenceDatetime,
        radixRefreshSeq,
        customSignificator: customSignificatorKey,
        includeTemporal,
      }),
    [ageSeek, ageWindow, customSignificatorKey, direction, documentId, includeTemporal, mode, optionsContextKey, optionsPreviewKey, payloadReferenceDatetime, radixRefreshSeq, source, sourceName, year],
  );
  // Explicit calendar/mode navigation follows its requested target. Settings
  // (including direction changes) replace rows around the retained visible time.
  const navigationKey = listCacheKey({
    documentId, sourceName, source, mode, year, ageWindow, ageSeek,
    referenceDatetime: payloadReferenceDatetime,
    customSignificator: customSignificatorKey,
  });
  const focusDatetimeRef = React.useRef(focusDatetime);
  React.useLayoutEffect(() => {
    focusDatetimeRef.current = focusDatetime;
  }, [focusDatetime]);
  const captureRectificationViewport = React.useCallback(() => {
    onRectificationStepStart();
    startRectificationFocusHold(rectificationFocusHoldRef.current);
    settingsViewportRef.current = null;
    rectificationViewportRef.current = capturePrimaryRectificationViewport(
      scrollerRef.current, payloadRef.current?.directions ?? [], rowHeight,
    );
  }, [onRectificationStepStart, rowHeight]);
  const settleRectificationStep = React.useCallback(() => {
    settleRectificationFocusHold(rectificationFocusHoldRef.current, focusDatetimeRef.current);
    onRectificationSettled();
  }, [onRectificationSettled]);

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
    const previousRequest = previousRequestRef.current;
    const preserveTimeViewport = previousRequest?.navigationKey === navigationKey
      && previousRequest.cacheKey !== payloadCacheKey;
    // A radix revision of the same list (a rectification step's daemon echo,
    // a chart edit) re-sorts contacts like the step itself: hold the contacts
    // in view, not the time, when no step anchor is already waiting.
    const radixRevision = preserveTimeViewport
      && previousRequest.radixRefreshSeq !== radixRefreshSeq;
    if (previousRequest?.navigationKey !== navigationKey) {
      settingsViewportRef.current = null;
      releaseRectificationFocusHold(rectificationFocusHoldRef.current);
    }
    previousRequestRef.current = { navigationKey, cacheKey: payloadCacheKey, radixRefreshSeq };
    const captureSettingsViewport = () => {
      if (!preserveTimeViewport || rectificationViewportRef.current) return;
      if (radixRevision) {
        rectificationViewportRef.current = capturePrimaryRectificationViewport(
          scrollerRef.current, payloadRef.current?.directions ?? [], rowHeightRef.current,
        );
        if (rectificationViewportRef.current) return;
      }
      settingsViewportRef.current = capturePrimaryTimeViewport(
        scrollerRef.current,
        payloadRef.current?.directions ?? [],
        rowHeightRef.current,
        focusDatetimeRef.current,
      ) ?? settingsViewportRef.current;
    };
    const cached = getCachedListPayload<DirectionsPayload>(PRIMARY_DIRECTIONS_CACHE, payloadCacheKey);
    // Defer the "loading" flag out of the synchronous effect body (React 19
    // rule react-hooks/set-state-in-effect): the request itself is async.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      if (cached) {
        captureSettingsViewport();
        setPayload(cached);
      }
      setLoading(!cached);
      setError(null);
    });
    const isReturnMode = mode !== "radix";
    const radixParams = {
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
    };
    // Nothing resident for this world yet: paint the years around the focus
    // first. A rectification step keeps its retained viewport instead.
    let complete = false;
    const firstPaint =
      !isReturnMode && !ageWindow && !cached && !rectificationViewportRef.current
        && !payloadRef.current?.directions.length
        && !settingsViewportRef.current
        ? fetchDirections(
            sourceName,
            {
              ...radixParams,
              focusSpanYears: PRIMARY_FIRST_PAINT_YEARS,
              focusDatetime: focusDatetimeRef.current ?? undefined,
            },
            controller.signal,
          )
            .then((data) => {
              if (controller.signal.aborted) return;
              if (complete || requestSeq !== requestSeqRef.current || !data.directions.length) return;
              React.startTransition(() => setPayload(data));
            })
            .catch(() => {})
        : Promise.resolve();
    const request = firstPaint.then(() =>
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
        : fetchDirections(sourceName, radixParams, controller.signal),
    );
    request
      .then((data) => {
        complete = true;
        if (requestSeq !== requestSeqRef.current || controller.signal.aborted) return;
        rememberListPayload(PRIMARY_DIRECTIONS_CACHE, payloadCacheKey, data);
        captureSettingsViewport();
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
        rectificationViewportRef.current = null;
        setError((err as Error).message);
      })
      .finally(() => {
        if (requestSeq === requestSeqRef.current) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [sourceName, source, documentId, direction, mode, year, ageWindow, ageSeek, payloadReferenceDatetime, optionsPreview, radixRefreshSeq, customSignificator, includeTemporal, payloadCacheKey, navigationKey, primaryRequestReady]);

  const onPrimarySettingsLoaded = React.useCallback((options: OptionsPatchPayload) => {
    setOptionsContextKey(options.primaryDirectionsContextKey);
    setSettingsPlanetGlyphs(primarySettingsPlanetGlyphs(options.catalog));
  }, []);
  const commitPrimarySettingsPatch = useQueuedPrimaryDirectionSettingsPatch({
    setSettings,
    setSettingsGlobals,
    optionsSeq,
    onLoaded: onPrimarySettingsLoaded,
    onCommitted: onPrimarySettingsLoaded,
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
      return commitPrimarySettingsPatch(patch, optionsPatch);
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
  const fullColumnLabels = React.useMemo(() => directionFullColumnLabels(t), [t]);
  const rows = React.useMemo(() => payload?.directions ?? [], [payload]);
  const temporalCoverage = React.useMemo(
    () =>
      authoritativeTemporalCoverage(payload?.meta.temporalCoverage)
      ?? temporalCoverageFromRows(rows),
    [payload?.meta.temporalCoverage, rows],
  );
  useTemporalConfluenceRows(rows, temporalCoverage);
  const applySavedGlyphColors = React.useCallback((enabled: boolean) => {
    setSettings((prev) =>
      prev && prev.pdlistglyphcolors !== enabled ? { ...prev, pdlistglyphcolors: enabled } : prev,
    );
  }, []);
  useSyncedDirectionGlyphColors(applySavedGlyphColors);
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
  const firstPaintOnly = payload?.meta.focusWindow != null;
  const scrollOrLoadAgeRange = React.useCallback(
    (range: AgeRange, seek: DirectionsAgeSeek = "exact") => {
      if (firstPaintOnly) {
        // The full list is on its way; aim at the range instead of
        // replacing that request with a windowed one.
        setTargetAgeRange(range);
        setTargetAgeSeek(seek);
        return;
      }
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
    [ageWindow, firstPaintOnly, rowHeight, rows],
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
      headerLines: payload?.meta.exportParameters ? [payload.meta.exportParameters] : undefined,
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
    if (rectificationFocusHeld(rectificationFocusHoldRef.current, focusDatetimeRef.current)) {
      return undefined;
    }
    const anchor = settingsViewportRef.current;
    if (anchor && anchor.focusDatetime === focusDatetimeRef.current) return undefined;
    settingsViewportRef.current = null;
    return scheduleFocusedDirectionScroll(
      scrollerRef,
      focusIndex,
      rows.length,
      PRIMARY_FOCUS_ANCHOR,
      rowHeightRef.current,
      true,
    );
  }, [active, focusDatetime, focusIndex, mode, rows.length]);

  React.useLayoutEffect(() => {
    const anchor = settingsViewportRef.current;
    if (!active || !anchor || rectificationViewportRef.current) return;
    if (anchor.focusDatetime !== focusDatetimeRef.current) {
      settingsViewportRef.current = null;
      return;
    }
    if (restorePrimaryTimeViewport(scrollerRef.current, rows, rowHeightRef.current, anchor)) {
      settingsViewportRef.current = null;
    }
  }, [active, focusDatetime, rows]);

  React.useLayoutEffect(() => {
    if (!active) return;
    const anchor = rectificationViewportRef.current;
    if (!anchor) return;
    if (restorePrimaryRectificationViewport(scrollerRef.current, rows, rowHeight, anchor)) {
      rectificationViewportRef.current = null;
      extendRectificationFocusHold(rectificationFocusHoldRef.current);
    }
  }, [active, rows, rowHeight]);

  const directionKeyLabel = payload?.meta.key ?? "";
  const customSignificatorLabel =
    payload?.meta.customSignificator?.label ?? customSignificator?.label ?? null;

  if (!primaryRequestReady) {
    return (
      <div className="relative flex flex-1 min-h-0 flex-col bg-background">
        <div className={LIST_PANE_CLASSES.standardHeader}>
          <div className={LIST_PANE_CLASSES.titleRow}>
            <div className={LIST_PANE_CLASSES.titleGroup}>
              <h2 className={LIST_PANE_CLASSES.title}>{t("dirview.primaryDirections")}</h2>
              <span className={LIST_PANE_CLASSES.metadata}>{t("dirview.computing")}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PrimarySettingsDockLayout
      open={settingsOpen}
      dock={settingsDock}
      settings={settings}
      globals={settingsGlobals}
      planetGlyphs={settingsPlanetGlyphs}
      onClose={() => onSettingsOpenChange(false)}
      onPatch={onPatchSettings}
    >
      <div className="relative flex h-full min-h-0 flex-col bg-background">
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
            <PrimarySettingsControl
              open={settingsOpen}
              onOpenChange={onSettingsOpenChange}
            />
            <TextExportActions
              sourceName={sourceName}
              fileStem="primary-directions"
              disabled={!rows.length || firstPaintOnly}
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
            onStepSettled={settleRectificationStep}
            onError={(message) => {
              rectificationViewportRef.current = null;
              setError(message);
            }}
          />
          <ListLayoutPresetControl />
        </div>
        {isReturnMode && returnLabel ? (
          <span className="text-[length:var(--aries-font-size-small)] text-muted-foreground">
            {returnLabel}
          </span>
        ) : null}
      </div>

      <div ref={scrollerRef} className={LIST_PANE_CLASSES.scroller}>
        {error ? (
          <div className="px-4 py-6 text-[length:var(--aries-font-size-base)] text-destructive">{error}</div>
        ) : (
          <Table
            wrapperless
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
                    <DirectionHeadLabel align={primaryHeadAlign(columnKey)} full={fullColumnLabels[columnKey]}>
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
                    astrolabeDocumentId={mode === "radix" ? astrolabeCursorId : null}
                    glyphColorRows={glyphColorRows}
                    columnOrder={primaryColumnOrder}
                    rowHeight={rowHeight}
                  />
              )}
            />
          </Table>
        )}
      </div>
      </div>
    </PrimarySettingsDockLayout>
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
  astrolabeDocumentId,
  glyphColorRows,
  columnOrder,
  rowHeight,
}: {
  row: DirectionRow;
  documentId: string;
  initialFocus: boolean;
  rowIndex: number;
  menuExtras: () => React.ReactNode;
  pdInChartEnabled: boolean;
  astrolabeDocumentId: string | null;
  glyphColorRows: boolean;
  columnOrder: readonly PrimaryDirectionColumnKey[];
  rowHeight: number;
}) {
  const t = useT();
  const precision = useTablePrecision();
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
        return <TableCell className="text-right tabular-nums" title={formatTableDegrees(row.arc, "seconds")}>{formatTableDegrees(row.arc, precision)}</TableCell>;
      case "date":
        return (
          <TableCell className="text-center tabular-nums">
            {astrolabeDocumentId && f.direct ? (
              <AstrolabeArcLink documentId={astrolabeDocumentId} arc={f.arc}>
                {dateLabel}
              </AstrolabeArcLink>
            ) : (
              <DateTransitLink
                documentId={documentId}
                eventDatetime={eventDatetime}
                eventJd={row.fields.jd}
                sessionLabel={row.sessionLabel}
              >
                {dateLabel}
              </DateTransitLink>
            )}
          </TableCell>
        );
    }
  };
  return (
    <TimedChartContextMenu
      anglePrecision
      documentId={documentId}
      eventDatetime={eventDatetime}
      eventJd={row.fields.jd}
      sessionLabel={row.sessionLabel}
      beforeTimedItems={
        <>
          {pdInChartEnabled ? (
            <>
              {(["zodiacal", "ascensional"] as const).map(coordinateMode => <PdInChartMenuItem
                key={coordinateMode}
                documentId={documentId}
                arc={f.arc}
                mode={f.mundane ? "terrestrial" : "celestial"}
                coordinateMode={coordinateMode}
                direct={f.direct}
                eventJd={f.jd}
                eventDatetime={eventDatetime}
                sessionLabel={row.sessionLabel}
                directionEvent={f}
              >
                {coordinateMode === "zodiacal"
                  ? t("dirview.pdsInChartZodiacal")
                  : t("dirview.pdsInChartAscensional")}
              </PdInChartMenuItem>)}
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
  // Glyph only; the name stays in the title and accessible label. A motion
  // state carried in the label ("Uranus (SR)") stays visible as a marker.
  const marker = text.match(/\s\(([^)]+)\)$/)?.[1] ?? "";
  return (
    <span className="inline-flex items-center justify-center gap-1" title={text} aria-label={text} role="img">
      <Glyph
        ch={glyph}
        className="aries-search-glyph"
        color={glyphColorRows ? color : null}
        colorRole={glyphColorRows ? colorRole : null}
      />
      {marker ? (
        <span className="aries-search-marker text-muted-foreground" aria-hidden>{marker}</span>
      ) : null}
    </span>
  );
}

/** Whole years and months of an age, for the muted Age cell. */
function secondaryAgeYearsMonths(age: number): { sign: string; years: number; months: number } {
  const totalMonths = Math.floor(Math.abs(age) * 12 + 1e-6);
  return {
    sign: age < 0 ? "\u2212" : "",
    years: Math.floor(totalMonths / 12),
    months: totalMonths % 12,
  };
}

function SecondaryAgeCell({ age, className }: { age: number | null | undefined; className: string }) {
  const t = useT();
  if (age == null) return <TableCell className={className} />;
  const { sign, years, months } = secondaryAgeYearsMonths(age);
  // The cell shows whole years and months; the exact fractional age stays in
  // the title and accessible label.
  const exact = t("dirview.ageExact", { age: age.toFixed(4) });
  return (
    <TableCell className={className} title={exact} aria-label={exact}>
      {t("dirview.ageYearsMonths", { years: `${sign}${years}`, months })}
    </TableCell>
  );
}

type SecondaryRow = SecondaryDirectionsPayload["directions"][number];

/** Direct/converse cell: the daemon's motion code ("re" = converse) as D / C. */
function secondaryMotionLabel(code: string | null | undefined, t: TFunc): { text: string; title: string } | null {
  if (!code) return null;
  const converse = code === "re";
  return {
    text: t(converse ? "dirview.converseAbbr" : "dirview.directAbbr"),
    title: t(converse ? "dirview.converse" : "dirview.direct"),
  };
}

/** What decides a cell's width in each progression column. */
function secondarySizerKey(row: SecondaryRow, columnKey: SecondaryDirectionColumnKey): string {
  switch (columnKey) {
    case "prom":
      return `${row.fields.promGlyph ?? ""}|${row.prom}`;
    case "aspect":
      return `${row.fields.aspectGlyph ?? ""}|${row.aspect}`;
    case "sig":
      return `${row.fields.sigGlyph ?? ""}|${row.sig}`;
    case "direction":
      return row.motionCode ?? "";
    case "date":
      return String(secondaryRowDateLabel(row).length);
    case "age": {
      if (row.age == null) return "";
      const { sign, years, months } = secondaryAgeYearsMonths(row.age);
      return `${sign}${years}|${months}`;
    }
  }
}

/**
 * Zero-height row holding each column's distinct contents from every loaded
 * row. The list renders only the rows near the viewport, so without it native
 * auto layout would size columns from whichever rows are mounted, and a wide
 * station label or glyph-less name scrolling in would shift every column.
 */
function SecondaryColumnSizer({
  rows,
  columnOrder,
  renderContent,
}: {
  rows: readonly SecondaryRow[];
  columnOrder: readonly SecondaryDirectionColumnKey[];
  renderContent: (row: SecondaryRow, columnKey: SecondaryDirectionColumnKey) => React.ReactNode;
}) {
  const samples = React.useMemo(
    () => columnOrder.map((columnKey) => {
      const seen = new Map<string, SecondaryRow>();
      for (const row of rows) {
        const key = secondarySizerKey(row, columnKey);
        if (!seen.has(key)) seen.set(key, row);
      }
      return [...seen.values()];
    }),
    [columnOrder, rows],
  );
  if (!rows.length) return null;
  return (
    <tbody aria-hidden="true" data-column-sizer>
      <tr className="border-0">
        {columnOrder.map((columnKey, index) => (
          <td key={columnKey} className={cn("aries-list-cell border-0 py-0", secondaryColumnClass(columnKey))}>
            <div className="pointer-events-none invisible h-0 overflow-hidden">
              {samples[index].map((row, i) => (
                <div key={i}>{renderContent(row, columnKey)}</div>
              ))}
            </div>
          </td>
        ))}
      </tr>
    </tbody>
  );
}

function SecondaryAgeText({ age }: { age: number }) {
  const t = useT();
  const { sign, years, months } = secondaryAgeYearsMonths(age);
  return <>{t("dirview.ageYearsMonths", { years: `${sign}${years}`, months })}</>;
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
  /** Viewport anchor, valid only while the pane focus is still this one. */
  viewport: DirectionViewportAnchor | null;
  viewportFocusDatetime: string | null;
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
  dataActive,
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
  /** This tab is the one on screen: viewport anchoring and measurement. */
  active: boolean;
  /** The Directions view is on screen (this tab or its sibling): data work.
   * A tab behind its sibling stays current; a hidden view idles. */
  dataActive: boolean;
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
  const selectedAspectIds = secondaryPreferences?.aspectIds ??
    SECONDARY_MAJOR_ASPECT_FILTER_IDS;
  const filterDrawerOpen = secondaryPreferences?.filterDrawerOpen ?? false;
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
  // The options part of the daemon's `dataKey`, from the options payload and
  // every options event. An options change that leaves it unchanged (a display
  // toggle, an unrelated group) is not a new revision and sends nothing.
  const optionsDataKey = useDaemonWorkspaceStore((state) => state.secondaryProgressionsDataKey);
  // The list a viewer is looking at, apart from its data revision. The daemon
  // resolves the radix by document, so the pane's open-time source name is not
  // part of it. A new revision replaces the loaded span in place; only a
  // different list starts over around the focus.
  const worldKey = React.useMemo(
    () => listCacheKey({ documentId, method, directionMode, includeTemporal }),
    [directionMode, documentId, includeTemporal, method],
  );
  // A remount shows the last rows of this list at once, whatever their data
  // revision; the key check below reloads them in place only if it moved on.
  const [store, setStore] = React.useState<SecondaryStitchStore | null>(
    () => cachedSecondaryStore(worldKey, null, effectiveFocusDatetime),
  );
  // The daemon `dataKey` the list should show: the resident rows' own key
  // until a revision resolves another one, which then reloads in place.
  const [targetDataKey, setTargetDataKey] = React.useState<string | null>(
    () => store?.dataKey ?? null,
  );
  const residentWorldRef = React.useRef<string | null>(store ? worldKey : null);
  // The first request already targets the current focus unless resident rows
  // cover it, so the focus effect never restarts it on open.
  const [requestFocusDatetime, setRequestFocusDatetime] = React.useState(
    () => (store ? cachedViewState?.requestFocusDatetime : null) ?? effectiveFocusDatetime,
  );
  const [targetAgeRange, setTargetAgeRange] = React.useState<AgeRange | null>(
    cachedViewState?.targetAgeRange ?? null,
  );
  const [targetAgeSeek, setTargetAgeSeek] = React.useState<DirectionsAgeSeek>(
    cachedViewState?.targetAgeSeek ?? "exact",
  );
  const [ageRangePageStart, setAgeRangePageStart] = React.useState(
    cachedViewState?.ageRangePageStart ?? 0,
  );
  // Today overrides the chart-cursor focus target until the cursor, method or
  // direction moves the focus again.
  const [todayFocusMs, setTodayFocusMs] = React.useState<number | null>(null);
  // Island = which contiguous stitched region we are building. A long pager
  // jump or an out-of-coverage focus move starts a new island (window != null
  // fetches that explicit span; null lets the daemon pick the focus window
  // from requestFocusDatetime). Coverage then grows around the island by
  // adjacent-chunk stitching — the list itself never rebuilds.
  const [island, setIsland] = React.useState<{
    nonce: number;
    window: AgeSpan | null;
  }>(() => ({ nonce: store?.islandNonce ?? 0, window: null }));
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [glyphColorRows, setGlyphColorRows] = React.useState(false);
  useSyncedDirectionGlyphColors(setGlyphColorRows);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  /** The rows on screen after display filters, for visible-first reloads. */
  const visibleRowsRef = React.useRef<readonly SecondaryRow[]>(store?.rows ?? []);
  const layoutPreset = useListLayoutPreset();
  const rectificationDocumentId = cursorDocumentId ?? documentId;
  const applyTimedChartOpenResult = useWorkspaceStore((s) => s.applyTimedChartOpenResult);
  const savedPointRoles = secondaryPreferences?.pointRoles;
  const legacyPlanetIds = secondaryPreferences?.planetIds;
  const legacyAngleIds = secondaryPreferences?.angleIds;
  const pointSelection = React.useMemo(
    () => resolveSecondaryPointRoles(store?.meta.filterPoints ?? [], {
      pointRoles: savedPointRoles, planetIds: legacyPlanetIds, angleIds: legacyAngleIds,
    }),
    [store?.meta.filterPoints, savedPointRoles, legacyPlanetIds, legacyAngleIds],
  );
  const selectedFromIds = React.useMemo(() => new Set(pointSelection.fromIds), [pointSelection.fromIds]);
  const selectedToIds = React.useMemo(() => new Set(pointSelection.toIds), [pointSelection.toIds]);
  const selectedRolesRef = React.useRef({ from: selectedFromIds, to: selectedToIds });
  React.useLayoutEffect(() => {
    selectedRolesRef.current = { from: selectedFromIds, to: selectedToIds };
  }, [selectedFromIds, selectedToIds]);
  const [requests, requestsIdle] = useRetainedListRequests<SecondaryStitchStore>(store);
  const worldKeyRef = React.useRef(worldKey);
  // The chart the resident rows were built for, sent with every request.
  const radixIdentityRef = React.useRef<string | null>(store?.radixIdentity ?? null);
  const islandLoadInFlightRef = React.useRef(false);
  const keyCheckPendingRef = React.useRef(false);
  const [keyCheckNonce, setKeyCheckNonce] = React.useState(0);
  // A hidden view does no data work: a key check, in-place reload, new island
  // or growth that falls due while the view is off screen waits until it shows
  // again, then runs once. The sibling tab showing is not hidden: this list
  // keeps itself current behind it, so switching to it shows current rows.
  const dataActiveRef = React.useRef(dataActive);
  React.useLayoutEffect(() => {
    dataActiveRef.current = dataActive;
  }, [dataActive]);
  const keyCheckDeferredRef = React.useRef(false);
  const reloadDeferredRef = React.useRef(false);
  // Re-runs the load effect: a retry, a deferred reload, or a restart under a
  // key the list may already name.
  const [reloadNonce, setReloadNonce] = React.useState(0);
  const [reloadRetry] = React.useState(() =>
    createSecondaryRetry(SECONDARY_RETRY_LIMIT, SECONDARY_RETRY_BASE_MS));
  const [keyCheckRetry] = React.useState(() =>
    createSecondaryRetry(SECONDARY_RETRY_LIMIT, SECONDARY_RETRY_BASE_MS));
  React.useEffect(() => () => {
    reloadRetry.dispose();
    keyCheckRetry.dispose();
  }, [keyCheckRetry, reloadRetry]);
  const loadEffectRanRef = React.useRef(false);
  const extendCooldownUntilRef = React.useRef(0);
  const scrollPlanRef = React.useRef<{ kind: "prepend"; count: number } | null>(null);
  // A cursor that moved while another pane was showing re-anchors on focus;
  // the old scroll position would show rows around the previous moment.
  const restoredViewportRef = React.useRef<DirectionViewportAnchor | null>(
    cachedViewState?.viewportFocusDatetime === (focusDatetime ?? null)
      ? cachedViewState?.viewport ?? null
      : null,
  );
  const focusDatetimeRef = React.useRef(focusDatetime ?? null);
  React.useEffect(() => {
    focusDatetimeRef.current = focusDatetime ?? null;
  }, [focusDatetime]);
  const stationFilterAnchorMsRef = React.useRef<number | null>(null);
  const methodRef = React.useRef(method);
  const directionModeRef = React.useRef(directionMode);
  const stationsOnlyRef = React.useRef(stationsOnly);
  const selectedAspectIdsRef = React.useRef(selectedAspectIds);
  const requestFocusDatetimeRef = React.useRef(requestFocusDatetime);
  const targetAgeRangeRef = React.useRef(targetAgeRange);
  const targetAgeSeekRef = React.useRef(targetAgeSeek);
  const ageRangePageStartRef = React.useRef(ageRangePageStart);
  // The mounted state already reflects this method (fresh or restored), so
  // only a later change resets the view; resetting on open would restart the
  // first request.
  const seededInitialMethodRef = React.useRef(initialMethod);
  const islandRef = React.useRef(island);
  React.useEffect(() => {
    worldKeyRef.current = worldKey;
  }, [worldKey]);
  React.useEffect(() => {
    islandRef.current = island;
  }, [island]);
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
    if (seededInitialMethodRef.current === initialMethod) return;
    seededInitialMethodRef.current = initialMethod;
    queueMicrotask(() => {
      setMethod(initialMethod);
      setDirectionMode("direct");
      setTodayFocusMs(null);
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
        viewportFocusDatetime: focusDatetimeRef.current,
      });
    };
  }, [viewStateKey]);

  React.useEffect(() => {
    queueMicrotask(() => {
      setTargetAgeRange(null);
      setTargetAgeSeek("exact");
      setTodayFocusMs(null);
      const rowsRange = rowDateRangeMs(
        requests.accepted()?.rows ?? [],
        (row) => row.eventDatetime ?? row.date,
      );
      if (dateRangeCoversFocusDate(rowsRange, effectiveFocusDatetime)) return;
      // The focus island for this moment is already the one requested (the
      // first open, or a focus that came back before its rows landed).
      if (
        islandRef.current.window == null &&
        requestFocusDatetimeRef.current === effectiveFocusDatetime
      ) return;
      setRequestFocusDatetime((prev) =>
        prev === effectiveFocusDatetime ? prev : effectiveFocusDatetime,
      );
      setIsland((prev) => ({ nonce: prev.nonce + 1, window: null }));
    });
  }, [requests, effectiveFocusDatetime]);

  // The pane follows its document's live chart. A 409 radix-retarget means the
  // document now hosts another chart: these rows are another list, so drop the
  // remembered identity and load the live chart around the focus.
  const retargetToLiveChart = React.useCallback(() => {
    radixIdentityRef.current = null;
    residentWorldRef.current = null;
    setTargetDataKey(null);
    setRequestFocusDatetime(effectiveFocusDatetimeRef.current);
    setIsland((prev) => ({ nonce: prev.nonce + 1, window: null }));
  }, []);
  // Reload in place under `dataKey`, even when the list already names it.
  const restartReload = React.useCallback((dataKey: string) => {
    setTargetDataKey(dataKey);
    setReloadNonce((n) => n + 1);
  }, []);

  React.useEffect(() => {
    if (!dataActive) return;
    if (keyCheckDeferredRef.current) {
      // The key check decides whether the deferred reload is still needed.
      keyCheckDeferredRef.current = false;
      queueMicrotask(() => setKeyCheckNonce((n) => n + 1));
    } else if (reloadDeferredRef.current) {
      reloadDeferredRef.current = false;
      queueMicrotask(() => setReloadNonce((n) => n + 1));
    }
  }, [dataActive]);

  // A data revision (options key, chart edit, rectification, radix step)
  // asks the daemon for the list's current key, cheaply and without rows. Only
  // a key other than the one on screen reloads, in place.
  const keyCheckRef = React.useRef<{
    optionsDataKey: string | null;
    radixRefreshSeq: number;
    nonce: number;
  } | null>(null);
  React.useEffect(() => {
    const previous = keyCheckRef.current;
    keyCheckRef.current = { optionsDataKey, radixRefreshSeq, nonce: keyCheckNonce };
    // First knowledge of the options key is not a change of it.
    if (
      previous &&
      previous.optionsDataKey === null &&
      previous.radixRefreshSeq === radixRefreshSeq &&
      previous.nonce === keyCheckNonce
    ) return undefined;
    const resident = requests.accepted();
    if (!resident || islandLoadInFlightRef.current) {
      // A first open's rows carry their own key; a load still in flight is
      // checked once it lands.
      if (previous) keyCheckPendingRef.current = true;
      return undefined;
    }
    if (!dataActiveRef.current) {
      keyCheckDeferredRef.current = true;
      return undefined;
    }
    const controller = new AbortController();
    fetchSecondaryDirectionsDataKey(
      sourceName,
      { documentId, source, radixIdentity: resident.radixIdentity ?? radixIdentityRef.current },
      controller.signal,
    )
      .then((current) => {
        if (controller.signal.aborted) return;
        keyCheckRetry.reset();
        setTargetDataKey((prev) => (prev === current.dataKey ? prev : current.dataKey));
        if (reloadDeferredRef.current) {
          reloadDeferredRef.current = false;
          setReloadNonce((n) => n + 1);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof RadixRetargetError) {
          retargetToLiveChart();
          return;
        }
        // The rows on screen stay; ask again with backoff until it answers.
        console.warn("[secondary-key-check]", err);
        keyCheckRetry.schedule(() => setKeyCheckNonce((n) => n + 1));
      });
    return () => controller.abort();
  }, [documentId, keyCheckNonce, keyCheckRetry, optionsDataKey, radixRefreshSeq, requests, retargetToLiveChart, source, sourceName]);

  // Initial chunk for the current stitched world/island. Identity changes keep
  // the previous rows on screen (stale-while-refresh) and swap when the new
  // chunk lands; the coverage then re-grows via extendCoverage below.
  React.useEffect(() => {
    const resident = requests.accepted();
    const request = requests.replace();
    const firstRun = !loadEffectRanRef.current;
    loadEffectRanRef.current = true;
    extendCooldownUntilRef.current = 0;
    scrollPlanRef.current = null;
    islandLoadInFlightRef.current = false;
    const cached =
      island.window == null && targetDataKey
        ? completeCachedSecondaryStore(worldKey, targetDataKey)
        : null;
    if (stitchedStoreCoversFocus(cached, requestFocusDatetime)) {
      queueMicrotask(() => {
        if (request.signal.aborted || !request.current()) return;
        if (!cached || !request.publish(cached)) return;
        request.finish();
        residentWorldRef.current = worldKey;
        setStore(cached);
        setLoading(false);
        setError(null);
      });
      return request.cancel;
    }
    // Same list, same island: the rows on screen stay. Under the key the list
    // should show there is nothing to request; under another key (a new data
    // revision) exactly the span on screen reloads in place, one growth chunk
    // per request, visible ages first, swapped in as each lands. Nothing
    // collapses to a first window, reloads over the rows or moves.
    if (resident && resident.islandNonce === island.nonce && residentWorldRef.current === worldKey) {
      const sameKey = targetDataKey == null || resident.dataKey === targetDataKey;
      const keepResident = () => {
        queueMicrotask(() => {
          if (!request.current() || !request.publish(resident)) return;
          request.finish();
        });
        return request.cancel;
      };
      if (sameKey && resident.stalePieces.length === 0) {
        reloadRetry.reset();
        return keepResident();
      }
      if (!dataActiveRef.current) {
        reloadDeferredRef.current = true;
        return keepResident();
      }
      // A new key starts a fresh retry budget; a resume spends the current one.
      if (!sameKey) reloadRetry.reset();
      const reloadKey = sameKey ? resident.dataKey ?? targetDataKey : targetDataKey;
      if (!reloadKey) return keepResident();
      const centre = typeof resident.meta.referenceAge === "number"
        ? resident.meta.referenceAge
        : (resident.coverage.start + resident.coverage.end) / 2;
      const viewAges = secondaryReloadViewAges({
        rows: visibleRowsRef.current,
        scroller: scrollerRef.current,
        rowHeight: rowHeightRef.current,
        // A remount has not restored its viewport yet: read the anchor
        // it is about to restore, else the focus it will scroll to.
        restoreAnchor: firstRun ? restoredViewportRef.current : null,
        measureScroller: !firstRun,
        focusDatetime: effectiveFocusDatetimeRef.current,
      }) ?? { first: centre, last: centre };
      const retry = () => reloadRetry.schedule(() => setReloadNonce((n) => n + 1));
      reloadSecondarySpanInPlace({
        resident,
        request,
        dataKey: reloadKey,
        // Under the same key only the stale pieces are re-requested.
        wholeSpan: !sameKey,
        pieces: sameKey
          ? secondaryPiecesVisibleFirst(resident.stalePieces, viewAges)
          : secondaryReloadPieces(resident.coverage, secondaryChunkYears(resident.meta, method), viewAges),
        fetchPiece: (piece, radixIdentity, signal) => fetchSecondaryDirections(sourceName, {
          method,
          direction: directionMode,
          source,
          documentId,
          startAge: piece.start,
          endAge: piece.end,
          includeTemporal,
          radixIdentity,
        }, signal),
        commit: (next, done) => {
          radixIdentityRef.current = next.radixIdentity;
          setStore(next);
          if (!done) return;
          rememberStitchedSecondaryStore(worldKey, next);
          // A piece that made no progress is re-requested, with backoff.
          if (next.stalePieces.length) retry();
          else reloadRetry.reset();
        },
        restart: restartReload,
        fail: (err, next) => {
          radixIdentityRef.current = next.radixIdentity;
          setStore(next);
          // A remount shows these rows and re-requests their stale pieces.
          rememberStitchedSecondaryStore(worldKey, next);
          if (err instanceof RadixRetargetError) {
            retargetToLiveChart();
            return;
          }
          // The rows stay on screen, exact about their stale pieces; the
          // reload resumes those with backoff, never at once.
          console.warn("[secondary-reload]", err);
          retry();
        },
      });
      return request.cancel;
    }
    // A new island (focus moved out of the rows, another list) waits for a
    // hidden view to show; the rows on screen stay until then.
    if (!dataActiveRef.current) {
      reloadDeferredRef.current = true;
      if (!resident) {
        queueMicrotask(() => request.finish());
        return request.cancel;
      }
      queueMicrotask(() => {
        if (!request.current() || !request.publish(resident)) return;
        request.finish();
      });
      return request.cancel;
    }
    queueMicrotask(() => {
      if (request.signal.aborted) return;
      setLoading(true);
      setError(null);
    });
    islandLoadInFlightRef.current = true;
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
        radixIdentity: radixIdentityRef.current,
      },
      request.signal,
    )
      .then((data) => {
        if (!request.current()) return;
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
          island.window ?? { start: 0, end: secondaryChunkYears(data.meta, method) },
          data.directions,
        );
        const next: SecondaryStitchStore = {
          rows: data.directions,
          coverage,
          islandNonce: island.nonce,
          meta: data.meta,
          coverageAuthoritative: !data.meta.truncated && !data.meta.unavailableEphemeris?.length,
          temporalCoverage: authoritativeTemporalCoverage(data.meta.temporalCoverage),
          dataKey: data.dataKey ?? null,
          stalePieces: [],
          radixIdentity: data.radixIdentity ?? null,
        };
        islandLoadInFlightRef.current = false;
        request.publish(next);
        request.finish();
        residentWorldRef.current = worldKey;
        radixIdentityRef.current = next.radixIdentity;
        setStore(next);
        // These rows name the key on screen; the list now shows that key.
        if (next.dataKey) setTargetDataKey(next.dataKey);
        setAgeRangePageStart((prev) => {
          const nextPageStart = ageRangePageStartForAge(coverage.start);
          return prev === nextPageStart ? prev : nextPageStart;
        });
        rememberStitchedSecondaryStore(worldKey, next);
        // A revision that arrived while these rows were being built.
        if (keyCheckPendingRef.current) {
          keyCheckPendingRef.current = false;
          setKeyCheckNonce((n) => n + 1);
        }
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        if (!request.current()) return;
        if (err instanceof RadixRetargetError && radixIdentityRef.current) {
          retargetToLiveChart();
          return;
        }
        setError((err as Error).message);
      })
      .finally(() => {
        if (request.current()) {
          islandLoadInFlightRef.current = false;
          request.finish();
          setLoading(false);
        }
      });
    return request.cancel;
  }, [requests, targetDataKey, reloadNonce, reloadRetry, restartReload, worldKey, island, sourceName, source, documentId, method, directionMode, requestFocusDatetime, includeTemporal, retargetToLiveChart]);

  // Grow coverage by one adjacent chunk. Append never moves the viewport;
  // prepend schedules a scroll compensation consumed before paint.
  const extendCoverage = React.useCallback(
    (direction: AgeRangeLoadDirection) => {
      const current = requests.accepted();
      if (!current || requests.busy) return;
      if (Date.now() < extendCooldownUntilRef.current) return;
      // A hidden view does not grow, nor do rows waiting for an in-place
      // reload on activation.
      if (!dataActiveRef.current || reloadDeferredRef.current) return;
      // Coverage doubles per fetch (up to one daemon chunk): the small first
      // window paints at once and the lifetime fills in a few cheap steps.
      const stepYears = Math.min(
        secondaryChunkYears(current.meta, method),
        Math.max(current.coverage.end - current.coverage.start, 0.01),
      );
      let span: AgeSpan;
      if (direction === "previous") {
        if (current.coverage.start <= 0) return;
        span = {
          start: Math.max(0, current.coverage.start - stepYears),
          end: current.coverage.start,
        };
      } else {
        span = {
          start: current.coverage.end,
          end: current.coverage.end + stepYears,
        };
      }
      const request = requests.extend();
      if (!request) return;
      fetchSecondaryDirections(sourceName, {
        method,
        direction: directionMode,
        source,
        documentId,
        startAge: span.start,
        endAge: span.end,
        includeTemporal,
        radixIdentity: current.radixIdentity,
      }, request.signal)
        .then((data) => {
          if (!request.current()) return;
          const base = requests.accepted();
          if (!base) return;
          if (data.dataKey && base.dataKey && data.dataKey !== base.dataKey) {
            // A newer revision: never stitch it onto older rows. The list
            // reloads its span in place under that key, even if it already
            // names it. That reload keeps the list busy (no growth), and
            // whatever it publishes, complete or failed, names the new key,
            // so the next extension cannot meet this mismatch again.
            request.finish();
            restartReload(data.dataKey);
            return;
          }
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
            meta: {
              ...base.meta,
              unavailableEphemeris: Array.from(new Map(
                [...(base.meta.unavailableEphemeris ?? []), ...(data.meta.unavailableEphemeris ?? [])]
                  .map((body) => [body.id, body]),
              ).values()),
            },
            coverageAuthoritative: base.coverageAuthoritative && !data.meta.truncated && !data.meta.unavailableEphemeris?.length,
            temporalCoverage: data.meta.truncated
              ? base.temporalCoverage
              : mergeContiguousTemporalCoverage(
                  base.temporalCoverage,
                  data.meta.temporalCoverage,
                ),
            dataKey: base.dataKey ?? data.dataKey ?? null,
            stalePieces: base.stalePieces,
            radixIdentity: base.radixIdentity ?? data.radixIdentity ?? null,
          };
          if (prependedCount > 0) {
            const { from, to } = selectedRolesRef.current;
            const aspects = new Set(selectedAspectIdsRef.current);
            const visibleCount = nextStore.rows.slice(0, prependedCount).filter((row) => {
              if (
                stationsOnlyRef.current &&
                !SECONDARY_STATION_FILTER_IDS.includes(secondaryStationFilterKey(row))
              ) return false;
              return secondaryPointRolesMatch(row.fields, from, to) &&
                (row.fields.aspectIndex == null || aspects.has(row.fields.aspectIndex));
            }).length;
            scrollPlanRef.current =
              visibleCount > 0 ? { kind: "prepend", count: visibleCount } : null;
          }
          request.publish(nextStore);
          request.finish();
          setStore(nextStore);
          rememberStitchedSecondaryStore(worldKeyRef.current, nextStore);
        })
        .catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          if (!request.current()) return;
          if (err instanceof RadixRetargetError) {
            request.finish();
            retargetToLiveChart();
            return;
          }
          extendCooldownUntilRef.current = Date.now() + 4000;
          console.error("[secondary-stitch-extend]", err);
        })
        .finally(() => {
          request.finish();
        });
    },
    [directionMode, documentId, includeTemporal, method, requests, restartReload, retargetToLiveChart, source, sourceName],
  );

  // Prefetch a bounded neighbourhood of the seed window, at any age. Scrolling
  // extends it lazily; a historical radix must never prefetch centuries back
  // to birth or stop at a primary-direction lifetime limit.
  React.useEffect(() => {
    if (!store) return;
    if (requests.busy) return;
    const center = typeof store.meta.referenceAge === "number"
      ? store.meta.referenceAge
      : (store.meta.startAge + store.meta.endAge) / 2;
    const half = secondaryChunkYears(store.meta, method) * 2;
    const desired: AgeSpan = {
      start: Math.max(0, center - half),
      end: center + half,
    };
    // Grow the nearer side first so the rows around the focus fill in before
    // distant ones.
    const needPrevious = store.coverage.start > desired.start + 0.01;
    const needNext = store.coverage.end < desired.end - 0.01;
    if (needPrevious && (!needNext || center - store.coverage.start <= store.coverage.end - center)) {
      extendCoverage("previous");
    } else if (needNext) {
      extendCoverage("next");
    }
  }, [store, method, extendCoverage, requests, requestsIdle, dataActive]);

  const sourceRows = React.useMemo(() => store?.rows ?? [], [store]);
  const pointFilterItems = React.useMemo(() => store?.meta.filterPoints ?? [], [store?.meta.filterPoints]);
  const defaultPointRoles = React.useMemo(() => secondaryDefaultPointRoles(pointFilterItems), [pointFilterItems]);
  const defaultAspectIds = store?.meta.defaultAspectIds ?? SECONDARY_MAJOR_ASPECT_FILTER_IDS;
  const rolePointItems = React.useMemo<RolePointItem[]>(() => pointFilterItems.map((item) => ({
    id: item.id,
    label: item.label,
    glyph: item.glyph,
    groupId: item.groupId,
    group: item.groupId === "asteroid" ? t("chartmenu.asteroids") : "",
    from: item.from,
    to: item.to,
  })), [pointFilterItems, t]);
  const aspectFilterItems = fallbackAspectFilterItems;
  const rows = React.useMemo(
    () => {
      const stationRows = filterRetainedRows(
        sourceRows,
        stationsOnly ? SECONDARY_STATION_FILTER_IDS : null,
        secondaryStationFilterKey,
      );
      const aspects = new Set(selectedAspectIds);
      return stationRows.filter((row) => {
        const aspect = row.fields.aspectIndex;
        return secondaryPointRolesMatch(row.fields, selectedFromIds, selectedToIds) &&
          (aspect == null || aspects.has(aspect));
      });
    },
    [selectedAspectIds, selectedFromIds, selectedToIds, sourceRows, stationsOnly],
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
    () => todayFocusMs ?? directionFocusTargetMs(rows, effectiveFocusDatetime, (row) => row.eventDatetime ?? row.date),
    [effectiveFocusDatetime, rows, todayFocusMs],
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
      setTodayFocusMs(null);
      setTargetAgeRange(range);
      setTargetAgeSeek(seek);
      setAgeRangePageStart(ageRangePageStartForAge(range.start));
      // Within coverage the jump is a pure scroll (focus anchoring below).
      // Outside it, start a fresh island at the requested span — stitching
      // then re-grows the neighbourhood around it.
      const chunkYears = secondaryChunkYears(requests.accepted()?.meta, method);
      const anchorAge = secondarySeedAnchorAge(range, seek, chunkYears);
      if (!spanContainsAge(requests.accepted()?.coverage ?? null, anchorAge)) {
        const window = secondarySeedWindowForAgeRange(range, seek, chunkYears);
        setIsland((prev) => ({
          nonce: prev.nonce + 1,
          window,
        }));
      }
    },
    [requests, method],
  );
  const jumpToAgeAnchor = React.useCallback(
    (index: number) => {
      const range = ageRanges[index] ?? ageRanges[0];
      loadSecondaryAgeRange(range);
    },
    [ageRanges, loadSecondaryAgeRange],
  );
  // Today reuses the initial-focus path: within coverage it is a pure scroll
  // to the row nearest now; outside it, a fresh island seeds at now and
  // adjacent chunks stitch around it as scrolling continues.
  const jumpToToday = React.useCallback(() => {
    const nowIso = localWallclockIso();
    setTargetAgeRange(null);
    setTargetAgeSeek("exact");
    setTodayFocusMs(resolveFocusDateMs(nowIso));
    const rowsRange = rowDateRangeMs(
      requests.accepted()?.rows ?? [],
      (row) => row.eventDatetime ?? row.date,
    );
    if (dateRangeCoversFocusDate(rowsRange, nowIso)) return;
    setRequestFocusDatetime(nowIso);
    setIsland((prev) => ({ nonce: prev.nonce + 1, window: null }));
  }, [requests]);
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
    pointRoles?: PointRoleSelection | null;
    planetIds?: null;
    angleIds?: null;
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
  // Both roles stay visible: Progressed acts, Natal receives; no exposed-side mode.
  const roleIdsFor = (side: PointRoleSide) => pointFilterItems.filter((item) => item[side]).map((item) => item.id);
  const defaultRoleIds = (side: PointRoleSide) => side === "from" ? defaultPointRoles.fromIds : defaultPointRoles.toIds;
  const roleFilterSections = (["from", "to"] as const).map((side: PointRoleSide) => {
    const selected = side === "from" ? selectedFromIds : selectedToIds;
    return {
      key: side,
      label: side === "from" ? t("listFilters.progressed") : t("listFilters.natal"),
      noneSelected: !roleIdsFor(side).some((id) => selected.has(id)),
      isDefault: sameRoleIds([...selected], defaultRoleIds(side), new Set(roleIdsFor(side))),
    };
  });
  const pointRun = (ids: ReadonlySet<string>, side: PointRoleSide): React.ReactNode => {
    const chosen = pointFilterItems.filter((item) => item[side] && ids.has(item.id));
    if (chosen.length === 0) return t("listFilters.noPoints");
    if (chosen.length > FILTER_TOKEN_RUN_LIMIT) return t("listFilters.pointCount", { count: chosen.length });
    return chosen.map((item) => item.glyph
      ? <Glyph key={item.id} ch={item.glyph} />
      : <span key={item.id} className="px-0.5">{item.label}</span>);
  };
  const filterTokens: AppliedFilterToken[] = [];
  for (const side of ["from", "to"] as const) {
    const selectedIds = side === "from" ? pointSelection.fromIds : pointSelection.toIds;
    if (!pointFilterItems.length || sameRoleIds(selectedIds, defaultRoleIds(side), new Set(roleIdsFor(side)))) continue;
    filterTokens.push({
      key: side,
      caption: side === "from" ? t("listFilters.progressed") : t("listFilters.natal"),
      value: pointRun(side === "from" ? selectedFromIds : selectedToIds, side),
    });
  }
  const aspectIdSet = new Set(selectedAspectIds);
  if (aspectIdSet.size !== defaultAspectIds.length || defaultAspectIds.some((id) => !aspectIdSet.has(id))) {
    const chosenAspects = aspectFilterItems.filter((item) => aspectIdSet.has(item.id));
    filterTokens.push({
      key: "aspects",
      caption: t("search.aspects"),
      value: chosenAspects.length
        ? chosenAspects.map((item) => <Glyph key={item.id} ch={item.glyph} />)
        : t("listFilters.noPoints"),
    });
  }
  const removeSecondaryFilter = (key: string) => {
    if (key === "aspects") setSecondaryPreferences({ aspectIds: [...defaultAspectIds] });
    else setSecondaryPreferences({
      pointRoles: { ...pointSelection, [key === "from" ? "fromIds" : "toIds"]: defaultRoleIds(key as PointRoleSide) },
    });
  };
  const resetSecondaryFilters = () => setSecondaryPreferences({
    pointRoles: null, planetIds: null, angleIds: null, aspectIds: [...defaultAspectIds],
  });
  // Display filters (Stations only, point roles, aspects) can leave too few
  // rows to scroll, so no edge is ever reached. A filtered list keeps growing
  // until the viewport fills, and while scrolling it loads a bounded reach
  // beyond the visible rows, so sparse rows never stream centuries of fetches
  // yet never stall where the viewer is reading.
  const filteredRows = stationsOnly || rows.length < sourceRows.length;
  React.useLayoutEffect(() => {
    visibleRowsRef.current = rows;
  }, [rows]);
  const extendFilteredCoverage = React.useCallback(
    (direction: AgeRangeLoadDirection) => {
      const current = requests.accepted();
      if (!current) return;
      const next = secondaryFilteredExtendDirection(direction, {
        coverage: current.coverage,
        center: typeof current.meta.referenceAge === "number"
          ? current.meta.referenceAge
          : (current.meta.startAge + current.meta.endAge) / 2,
        reachYears: SECONDARY_FILTERED_REACH_YEARS[method],
        ...secondaryVisibleAgeSpan(scrollerRef.current, visibleRowsRef.current, rowHeightRef.current),
      });
      if (next) extendCoverage(next);
    },
    [extendCoverage, method, requests],
  );
  useEdgeExtend({
    scrollerRef,
    rowCount: rows.length,
    thresholdPx: rowHeight * 30,
    canExtendBackward: (store?.coverage.start ?? 0) > 0,
    canExtendForward: store != null,
    onExtend: filteredRows ? extendFilteredCoverage : extendCoverage,
    recheckToken: requestsIdle,
    fillViewport: filteredRows,
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
  // The viewport this tab returns to: the row under the focus anchor, where it
  // sat, and the focus target and island it was read under. Kept while the tab
  // shows, so the moment the sibling takes over it is already current.
  const tabViewportRef = React.useRef<SecondaryTabViewport | null>(null);
  const viewportSignatureRef = React.useRef({ focusSignature, islandSignature });
  React.useLayoutEffect(() => {
    viewportSignatureRef.current = { focusSignature, islandSignature };
  }, [focusSignature, islandSignature]);
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!active || !scroller) return undefined;
    const keep = () => {
      const viewport = captureSecondaryTabViewport(
        scroller,
        visibleRowsRef.current,
        rowHeightRef.current,
        viewportSignatureRef.current,
      );
      if (viewport) tabViewportRef.current = viewport;
    };
    scroller.addEventListener("scroll", keep, { passive: true });
    return () => scroller.removeEventListener("scroll", keep);
  }, [active]);
  const wasActiveRef = React.useRef(false);
  React.useLayoutEffect(() => {
    const activated = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    if (!active || rowCountRef.current === 0) return undefined;
    // An absolute focus anchor supersedes any pending prepend compensation.
    scrollPlanRef.current = null;
    // Back from the sibling tab with the focus where it was: the rows the
    // viewer left, wherever reloads or growth behind the sibling moved them.
    if (
      activated &&
      restoreSecondaryTabViewport(
        scrollerRef.current,
        tabViewportRef.current,
        visibleRowsRef.current,
        rowHeightRef.current,
        { focusSignature, islandSignature },
      )
    ) return undefined;
    return scheduleFocusedDirectionScroll(
      scrollerRef,
      focusIndexRef.current,
      rowCountRef.current,
      SECONDARY_FOCUS_ANCHOR,
      rowHeightRef.current,
      true,
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
      true,
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
      true,
    );
  }, [active, rows, selectedAspectIds, selectedFromIds, selectedToIds, stationsOnly]);

  // Retained rows keep their loaded method while a new selection is loading.
  const rowMethod: SecondaryMethod = store?.meta.method === "tertiary" ? "tertiary"
    : store?.meta.method === "minor" ? "minor" : "secondary";
  const secondaryMenuBefore = React.useCallback(
    (eventDatetime: string | null, sessionLabel: string, motionCode?: string | null) => (
      <>
        <ContextMenuItem
          disabled={!eventDatetime}
          onClick={() => {
            if (!eventDatetime) return;
            const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
            void openDirectionsSecondaryChart(documentId, eventDatetime, sessionLabel, {
              method: rowMethod,
              direction: motionCode === "re" ? "converse" : "direct",
            })
              .then((result) => applyTimedChartOpenResult(result))
              .catch(() => {})
              .finally(finishSnapshotCommand);
          }}
        >
          {t(rowMethod === "tertiary" ? "dirview.openStepTertiaryChart"
            : rowMethod === "minor" ? "dirview.openStepMinorChart"
              : "dirview.openStepSecondaryChart")}
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
    [ageRanges, applyTimedChartOpenResult, documentId, jumpToAgeAnchor, rowMethod, t, visibleAgeAnchorIdx],
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
      headerLines: store?.meta.exportParameters ? [store.meta.exportParameters] : undefined,
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
              return { text: secondaryMotionLabel(row.motionCode, t)?.text ?? "" };
            case "prom":
              return directionGlyphTextCell(
                row.prom,
                row.fields.promGlyph,
                row.fields.promColorRole,
                glyphColorRows,
                directionPointExportSymbol(row.fields.promExportSymbolText, row.prom),
              );
            case "aspect":
              return directionGlyphTextCell(
                row.aspect,
                row.fields.aspectGlyph,
                row.fields.aspectColorRole,
                glyphColorRows,
                row.fields.aspectExportSymbolText ?? undefined,
              );
            case "sig":
              return directionGlyphTextCell(
                row.sig,
                row.fields.sigGlyph,
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

  // Glyph and text content of one progression cell; the row renders it inside
  // its TableCell, and the column sizer reuses it for widths.
  const renderSecondaryContent = React.useCallback(
    (row: SecondaryRow, columnKey: SecondaryDirectionColumnKey): React.ReactNode => {
      switch (columnKey) {
        case "age":
          return row.age == null ? null : <SecondaryAgeText age={row.age} />;
        case "direction": {
          const motion = secondaryMotionLabel(row.motionCode, t);
          return motion ? <span title={motion.title}>{motion.text}</span> : "";
        }
        case "prom":
          return (
            <SecondaryGlyphCell
              text={row.prom}
              glyph={row.fields.promGlyph}
              color={row.fields.promColor}
              colorRole={row.fields.promColorRole}
              glyphColorRows={glyphColorRows}
            />
          );
        case "aspect":
          return (
            <SecondaryGlyphCell
              text={row.aspect}
              glyph={row.fields.aspectGlyph}
              color={row.fields.aspectColor}
              colorRole={row.fields.aspectColorRole}
              glyphColorRows={glyphColorRows}
            />
          );
        case "sig":
          return (
            <SecondaryGlyphCell
              text={row.sig}
              glyph={row.fields.sigGlyph}
              color={row.fields.sigColor}
              colorRole={row.fields.sigColorRole}
              glyphColorRows={glyphColorRows}
            />
          );
        case "date":
          return secondaryRowDateLabel(row);
      }
    },
    [glyphColorRows, t],
  );

  const renderSecondaryCell = React.useCallback(
    (row: SecondaryRow, columnKey: SecondaryDirectionColumnKey) => {
      switch (columnKey) {
        case "age":
          return (
            <SecondaryAgeCell age={row.age} className={secondaryColumnClass("age")} />
          );
        case "aspect":
          return (
            <TableCell className={cn(secondaryColumnClass("aspect"), "text-muted-foreground")}>
              {renderSecondaryContent(row, columnKey)}
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
        default:
          return (
            <TableCell className={secondaryColumnClass(columnKey)}>
              {renderSecondaryContent(row, columnKey)}
            </TableCell>
          );
      }
    },
    [documentId, renderSecondaryContent],
  );

  return (
    <div className="relative flex flex-1 min-h-0 flex-col bg-background">
      <div className={LIST_PANE_CLASSES.standardHeader}>
        <div className={LIST_PANE_CLASSES.titleRow}>
          <div className={cn(LIST_PANE_CLASSES.titleGroup, "min-w-0")}>
            <h2 className={cn(LIST_PANE_CLASSES.title, "min-w-0 truncate")}>
              {store?.meta.title ?? t("dirview.secondaryProgressions")}
            </h2>
            {store?.meta.conversionKey ? (
              <span className={cn(LIST_PANE_CLASSES.metadata, "shrink-0 whitespace-nowrap")}>
                {store.meta.conversionKey}
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <TextExportActions
              sourceName={sourceName}
              fileStem="secondary-directions"
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
                setTodayFocusMs(null);
                setRequestFocusDatetime(effectiveFocusDatetime);
                setTargetAgeRange(null);
                setTargetAgeSeek("exact");
                setAgeRangePageStart(0);
                setIsland((prev) => ({ nonce: prev.nonce + 1, window: null }));
              }}
            />
          ) : null}
          <div className="ml-auto flex items-center gap-x-[var(--aries-pane-control-gap-x)]">
            <Button type="button" size="xs" variant="outline" onClick={jumpToToday}>
              {t("dirview.today")}
            </Button>
            <RectificationStepper
              docId={rectificationDocumentId}
              onStepStart={onRectificationStepStart}
              onStepped={onRectificationCommitted}
              onStepSettled={onRectificationSettled}
              onError={setError}
            />
          </div>
        </div>
        <div className={LIST_PANE_CLASSES.controlRow}>
          <ListSegmentedControl
            label={t("dirview.direction")}
            options={secondaryDirectionModes}
            value={directionMode}
            onChange={(v) => {
              setDirectionMode(v);
              setTodayFocusMs(null);
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
            variant={filterTokens.length ? "default" : "outline"}
            aria-expanded={filterDrawerOpen}
            onClick={() => setSecondaryPreferences({
              filterDrawerOpen: !filterDrawerOpen,
            })}
          >
            {t("search.filter")}
          </Button>
          <ListLayoutPresetControl />
        </div>
        <AppliedFilterTokens
          tokens={filterTokens}
          drawerOpen={filterDrawerOpen}
          onToggleDrawer={() => setSecondaryPreferences({ filterDrawerOpen: !filterDrawerOpen })}
          onRemove={removeSecondaryFilter}
          onReset={resetSecondaryFilters}
        />
        {store?.meta.unavailableEphemeris?.length ? (
          <p className="aries-list-secondary-text" role="status">
            {t("dirview.unavailableEphemeris", {
              bodies: store.meta.unavailableEphemeris.map((body) => body.label).join(", "),
            })}
          </p>
        ) : null}
      </div>
      <ListPaneSplit
        autoSaveId="aries.secondary-directions-filters-vs-results"
        label={t("search.filter")}
        onCloseControls={() => setSecondaryPreferences({ filterDrawerOpen: false })}
        controls={filterDrawerOpen ? (
          <div>
            <PointAspectFilters
              sections={roleFilterSections}
              renderChoices={(key) => {
                const side = key as PointRoleSide;
                return (
                  <RolePointChooser items={rolePointItems} side={side} hideUnsupported
                    selected={side === "from" ? selectedFromIds : selectedToIds}
                    onToggle={(ids) => setSecondaryPreferences({ pointRoles: togglePointRoleIds(pointSelection, side, ids) })} />
                );
              }}
              onClearSection={(side) => setSecondaryPreferences({
                pointRoles: setPointRoleIds(pointSelection, side as PointRoleSide, roleIdsFor(side as PointRoleSide), false),
              })}
              onDefaultSection={(side) => setSecondaryPreferences({
                pointRoles: { ...pointSelection, [side === "from" ? "fromIds" : "toIds"]: defaultRoleIds(side as PointRoleSide) },
              })}
              aspects={aspectFilterItems}
              selectedAspectIds={selectedAspectIds}
              onToggleAspect={(id) => setSecondaryPreferences({
                aspectIds: selectedAspectIds.includes(id)
                  ? selectedAspectIds.filter((selected) => selected !== id)
                  : [...selectedAspectIds, id],
              })}
              onAllAspects={() => setSecondaryPreferences({ aspectIds: aspectFilterItems.map((item) => item.id) })}
              onMajorAspects={() => setSecondaryPreferences({ aspectIds: [...SECONDARY_MAJOR_ASPECT_FILTER_IDS] })}
              onClearAspects={() => setSecondaryPreferences({ aspectIds: [] })}
            />
          </div>
        ) : null}
      >
        <div ref={scrollerRef} className={LIST_PANE_CLASSES.scroller}>
          {error ? (
            <div className="px-4 py-6 text-[length:var(--aries-font-size-base)] text-destructive">{error}</div>
          ) : (
            // Headerless, time-ordered list: the contact reads as a sentence and
            // sortable headings add nothing (decided layout 2026-10-23).
            <table
              aria-label={store?.meta.title ?? t("dirview.secondaryProgressions")}
              className={cn(
                // The facade's outer gutter, set to the header inset, keeps the
                // centred Prom glyphs on one edge whatever the column holds.
                "aries-sidebar-list-table caption-bottom border-collapse [--aries-list-outer-x:var(--aries-pane-header-padding-x)]",
                LIST_ROLE_CLASSES.standard,
              )}
            >
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
                      beforeTimedItems={secondaryMenuBefore(row.eventDatetime, row.sessionLabel, row.motionCode)}
                      afterTimedItems={secondaryRowMenu(row)}
                    >
                      <TemporalHighlightedTableRow
                        temporal={row.temporal}
                        className={DIRECTION_ROW_CLASS}
                        data-initial-focus={i === focusIndex || undefined}
                        data-row-index={i}
                        style={{ height: rowHeight }}
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
              <SecondaryColumnSizer
                rows={rows}
                columnOrder={secondaryColumnOrder}
                renderContent={renderSecondaryContent}
              />
            </table>
          )}
        </div>
      </ListPaneSplit>
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
  rowHeight,
  settingsOpen,
  settingsDock,
  onSettingsOpenChange,
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
  rowHeight: number;
} & PrimarySettingsPaneProps) {
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
  const [settingsGlobals, setSettingsGlobals] = React.useState<PrimaryDirectionGlobals | null>(null);
  const [settingsPlanetGlyphs, setSettingsPlanetGlyphs] = React.useState<readonly string[]>(
    PRIMARY_SETTINGS_PLANET_GLYPHS,
  );
  const [glyphColorRows, setGlyphColorRows] = React.useState(false);
  useSyncedDirectionGlyphColors(setGlyphColorRows);
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
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const requestSeqRef = React.useRef(0);
  const optionsSeq = useDirectionsOptionsSeq();
  // The daemon's content key for the saved options Circum reads. An options
  // event that leaves it unchanged (a displayed house system, wheel display)
  // is not a new calculation world.
  const [optionsDataKey, setOptionsDataKey] = React.useState<string | null>(null);
  const layoutPreset = useListLayoutPreset();
  const rectificationDocumentId = cursorDocumentId ?? documentId;
  const rectificationViewportRef = React.useRef<DirectionViewportAnchor | null>(null);
  const rectificationFocusHoldRef = React.useRef(createRectificationFocusHold());
  const focusDatetimeRef = React.useRef(focusDatetime);
  React.useLayoutEffect(() => {
    focusDatetimeRef.current = focusDatetime;
  }, [focusDatetime]);
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
        optionsDataKey,
        radixRefreshSeq,
        customSignificator: selectedSignificatorKey,
        includeTemporal,
      }),
    [documentId, focusDatetime, includeTemporal, maxAge, mode, optionsDataKey, promissorProfile, radixRefreshSeq, selectedSignificatorKey, source, sourceName, useExactOa, year],
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

  const commitCircumSettingsPatch = useQueuedPrimaryDirectionSettingsPatch({
    setSettings,
    setSettingsGlobals,
    optionsSeq,
    onLoaded: React.useCallback((o: OptionsPatchPayload) => {
      setOptionsDataKey(o.primaryDirectionsDataKey);
      setSettingsPlanetGlyphs(primarySettingsPlanetGlyphs(o.catalog));
      setUseExactOa(o.primaryDirections.pdcircumoa === 1 ? 1 : 0);
      setPromissorProfile(o.primaryDirections.pdcircumprommode === 1 ? 1 : 0);
      setGlyphColorRows(!!o.primaryDirections.pdlistglyphcolors);
      setCircumSignColors(signElementColors(o.colors));
    }, []),
    onCommitted: React.useCallback((o: OptionsPatchPayload) => {
      setOptionsDataKey(o.primaryDirectionsDataKey);
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
    return commitCircumSettingsPatch(patch, optionsPatch);
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
    startRectificationFocusHold(rectificationFocusHoldRef.current);
    rectificationViewportRef.current = captureDirectionViewport(scrollerRef.current, rowHeight);
  }, [onRectificationStepStart, rowHeight]);
  const settleRectificationStep = React.useCallback(() => {
    settleRectificationFocusHold(rectificationFocusHoldRef.current, focusDatetimeRef.current);
    onRectificationSettled();
  }, [onRectificationSettled]);

  React.useEffect(() => {
    // Wait for the options world, as the PD list waits for its settings.
    if (optionsDataKey == null) return;
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
  }, [sourceName, source, documentId, useExactOa, promissorProfile, maxAge, mode, year, focusDatetime, optionsDataKey, radixRefreshSeq, selectedSignificator, includeTemporal, payloadCacheKey]);

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
            const signColorRole = dr.kind === "term"
              ? dr.term.signColorRole : dr.part.degreeSignColorRole;
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
                  colorRole: glyphColorRows ? signColorRole : undefined,
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
                  colorRole: glyphColorRows ? dr.term.signColorRole : undefined,
                } : null,
                dr.term.termRulerGlyph ? {
                  text: `${dr.term.signGlyph ? " " : ""}${dr.term.termRulerGlyph}`,
                  glyph: true,
                  colorRole: glyphColorRows ? dr.term.termRulerColorRole : undefined,
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
                  colorRole: glyphColorRows ? dr.part.planetColorRole : undefined,
                } : null,
                dr.part.aspectGlyph ? {
                  text: dr.part.aspectGlyph,
                  glyph: true,
                  colorRole: glyphColorRows ? dr.part.aspectColorRole : undefined,
                } : null,
                dr.part.planetGlyph ? {
                  text: `${dr.part.aspectGlyph ? " " : ""}${dr.part.planetGlyph}`,
                  glyph: true,
                  colorRole: glyphColorRows ? dr.part.planetColorRole : undefined,
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
    [circumColumnLabels, circumColumnOrder, displayRows, glyphColorRows, payload, sourceName, t],
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
    if (rectificationFocusHeld(rectificationFocusHoldRef.current, focusDatetimeRef.current)) {
      return undefined;
    }
    return scheduleFocusedDirectionScroll(
      scrollerRef,
      focusIndex,
      displayRows.length,
      CIRCUMAMBULATION_FOCUS_ANCHOR,
      rowHeightRef.current,
      true,
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
      true,
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
  // The rate the rows were directed by: ascensional times, or the PD key,
  // after the PD system, as the PD list header reads.
  const circumRateLabel = payload
    ? payload.meta.useExactOa
      ? payload.meta.key || null
      : t("dirview.ascensionalTimes")
    : null;
  const circumMetadata = [payload?.meta.system, circumRateLabel].filter(Boolean).join(" · ");

  return (
    <PrimarySettingsDockLayout
      open={settingsOpen}
      dock={settingsDock}
      settings={settings}
      globals={settingsGlobals}
      planetGlyphs={settingsPlanetGlyphs}
      onClose={() => onSettingsOpenChange(false)}
      onPatch={onPatchSettings}
    >
      <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className={LIST_PANE_CLASSES.standardHeader}>
        <div className={LIST_PANE_CLASSES.titleRow}>
          <div className={LIST_PANE_CLASSES.titleGroup}>
            <h2 className={LIST_PANE_CLASSES.title}>
              {payload?.meta.title ?? t("dirview.circumambulations")}
            </h2>
            {circumMetadata ? (
              <span className={LIST_PANE_CLASSES.metadata}>{circumMetadata}</span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <PrimarySettingsControl
              open={settingsOpen}
              onOpenChange={onSettingsOpenChange}
            />
            <TextExportActions
              sourceName={sourceName}
              fileStem="circumambulations"
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
            {t("dirview.releaserLabel", { label: selectedSignificatorLabel })}
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
            onStepSettled={settleRectificationStep}
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
      <ListPaneSplit
        autoSaveId="aries.circumambulations-points-vs-results"
        label={t("dirview.points")}
        onCloseControls={() => setSignificatorDrawerOpen(false)}
        controls={significatorDrawerOpen ? (
          <CircumSignificatorDrawer
            items={significatorItems}
            activeId={activeSignificatorId}
            onSelect={selectCircumSignificator}
          />
        ) : null}
      >
        <div ref={scrollerRef} className={LIST_PANE_CLASSES.scroller}>
          {error ? (
            <div className="px-4 py-6 text-[length:var(--aries-font-size-base)] text-destructive">{error}</div>
          ) : (
            <Table
              wrapperless
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
      </ListPaneSplit>
      </div>
    </PrimarySettingsDockLayout>
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
    <div className="w-full">
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

const SIGN_NAMES = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
] as const;
