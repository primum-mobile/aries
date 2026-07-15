// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable react-hooks/preserve-manual-memoization -- Virtualized table scroll anchoring intentionally uses manual memoization and mutable refs. */
"use client";

import * as React from "react";
import { Calendar, ChevronLeft, ChevronRight, Copy, Download, FileText, X } from "lucide-react";

import {
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  fetchGenericTablePayload,
  openDirectionsTimedChart,
  setEclipseChartMoment,
  workspaceActivate,
  workspaceOpenAstrocart,
  workspaceUpdateTableBinding,
  type EclipseChartMomentMode,
  type GenericTableColumn,
  type GenericTablePayload,
  type GenericTableRow,
} from "@/lib/daemon/client";
import { isAbortError } from "@/lib/abort-error";
import { coerceDateConvention, formatDateTriple, formatIsoDateTimeDisplay, type DateConvention } from "@/lib/date-display";
import { LIST_ROLE_CLASSES, LIST_ROW_CLASSES, LIST_ROW_HEIGHT } from "@/lib/list-tokens";
import {
  getCachedGenericTablePayload,
  rememberGenericTablePayload,
} from "@/lib/table/payload-cache";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { beginWorkspaceSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";

import { TimedChartContextMenu } from "./directions-view";
import { CellView, downloadText, tableToAlignedText, tableToTsv } from "./generic-table-view";
import {
  isListDateColumn,
  listColumnDisplayOrder,
  useListLayoutPreset,
} from "./list-column-layout";
import { ListHeadLabel, type ListHeadAlign } from "./list-head-label";
import { exportTablePayloadPdf } from "./table-pdf-export";
import { exportTextContent } from "./text-export";
import { useSettledWorkspaceRefreshSeq } from "./step-refresh";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";

type Props = {
  documentId: string;
  parentDocumentId?: string | null;
  sourceName?: string;
  onClose?: () => void;
};

type EclipseCapabilities = {
  from?: number[];
  to?: number[];
  currentDate?: number[];
  birthDate?: number[];
  centerYear?: number;
  focusDate?: number[];
  focusRowId?: string | null;
  focusRowIndex?: number | null;
  chartMoment?: EclipseChartMomentMode;
  chartMomentOptions?: Array<{ value: EclipseChartMomentMode; label: string }>;
  rangeYears?: number;
  chunkYears?: number;
  edgeTriggerRows?: number;
  noRowsLabel?: string;
};

const TABLE_ID = "eclipses";

const ROW_HEIGHT = LIST_ROW_HEIGHT.standard;
const FOCUS_CONTEXT_ROWS = 5;
const VIRTUAL_OVERSCAN_ROWS = 18;
const ECLIPSE_VIRTUAL_SCROLL_SYNC_EVENT = "aries:eclipse-virtual-scroll-sync";

type ScrollPlan =
  | { kind: "focus" }
  | { kind: "preserve"; anchor: ScrollAnchor | null }
  | { kind: "preservePrepend"; scrollTop: number; firstRowId: string | null };

type ScrollAnchor = {
  rowId: string;
  rowIndex: number;
  offsetTop: number;
};

export function EclipsesView({ documentId, parentDocumentId, sourceName, onClose }: Props) {
  const t = useT();
  const [payload, setPayload] = React.useState<GenericTablePayload | null>(() =>
    getCachedGenericTablePayload(TABLE_ID, documentId),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastOptionsChange);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const scrollPlanRef = React.useRef<ScrollPlan | null>({ kind: "focus" });
  const hasFocusedInitialRef = React.useRef(false);
  const pendingRef = React.useRef(false);
  const scrollExtendArmedRef = React.useRef(false);
  const scrollExtendInFlightRef = React.useRef(false);
  const layoutPreset = useListLayoutPreset();

  const armScrollExtension = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollExtendArmedRef.current = true;
      });
    });
  }, []);

  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId,
    parentDocumentId,
    lastSessionChange: null,
    lastOptionsChange,
  });
  const displayColumnOrder = React.useMemo(
    () => (payload ? listColumnDisplayOrder(payload.columns, layoutPreset, ["kind", "type"]) : []),
    [layoutPreset, payload],
  );
  const visibleColumnIds = React.useMemo(
    () => (payload ? displayColumnOrder.map((columnIndex) => payload.columns[columnIndex].id) : []),
    [displayColumnOrder, payload],
  );
  const tableResize = useResizableTableColumns({
    storageKey: TABLE_ID,
    columnIds: visibleColumnIds,
  });

  const fetchPayload = React.useCallback(
    async (signal?: AbortSignal) => {
      return fetchGenericTablePayload(TABLE_ID, documentId, signal);
    },
    [documentId],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    if (hasFocusedInitialRef.current && listRef.current) {
      scrollPlanRef.current = { kind: "preserve", anchor: captureScrollAnchor(listRef.current) };
    }
    fetchPayload(controller.signal)
      .then((next) => {
        rememberGenericTablePayload(TABLE_ID, documentId, next);
        setPayload(next);
        setError(null);
        setActionError(null);
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [documentId, fetchPayload, refreshSeq]);

  const capabilities = asRecord(payload?.capabilities);
  const dateConvention = coerceDateConvention(capabilities.dateConvention);
  const eclipses = asRecord(capabilities.eclipses) as EclipseCapabilities;
  const from = asDateTriple(eclipses.from);
  const to = asDateTriple(eclipses.to);
  const currentDate = asDateTriple(eclipses.currentDate);
  const birthDate = asDateTriple(eclipses.birthDate);
  const focusDate = asDateTriple(eclipses.focusDate);
  const rangeYears = asNumber(eclipses.rangeYears, 10);
  const chunkYears = asNumber(eclipses.chunkYears, 10);
  const edgeRows = asNumber(eclipses.edgeTriggerRows, 4);
  const centerYear = asNumber(eclipses.centerYear, from ? Math.floor((from[0] + (to?.[0] ?? from[0])) / 2) : new Date().getFullYear());
  const focusRowId = typeof eclipses.focusRowId === "string" ? eclipses.focusRowId : null;
  const focusRowIndex = eclipses.focusRowIndex == null ? null : asNumber(eclipses.focusRowIndex, -1);
  const chartMoment = eclipses.chartMoment === "eclipse_maximum" ? "eclipse_maximum" : "exact_conjunction";
  const chartMomentOptions = Array.isArray(eclipses.chartMomentOptions) && eclipses.chartMomentOptions.length
    ? eclipses.chartMomentOptions
    : [
        { value: "exact_conjunction" as const, label: t("eclipsesView.exactConjunction") },
        { value: "eclipse_maximum" as const, label: t("eclipsesView.eclipseMaximum") },
      ];
  const rows = React.useMemo(() => (
    payload?.rows.length === 1 && payload.rows[0]?.id === "empty" ? [] : payload?.rows ?? []
  ), [payload]);
  const focusIndex = React.useMemo(() => {
    if (!rows.length) return -1;
    if (focusRowId) {
      const rowIndex = rows.findIndex((row) => row.id === focusRowId);
      if (rowIndex >= 0) return rowIndex;
    }
    if (focusRowIndex != null && focusRowIndex >= 0) {
      return Math.max(0, Math.min(rows.length - 1, Math.trunc(focusRowIndex)));
    }
    return 0;
  }, [focusRowId, focusRowIndex, rows]);
  const virtualRows = useVirtualRows(listRef, rows.length, focusIndex);
  const visibleRows = rows.slice(virtualRows.startIndex, virtualRows.endIndex);
  React.useLayoutEffect(() => {
    if (!listRef.current || !from || !to || !rows.length) return;
    const plan = scrollPlanRef.current;
    scrollPlanRef.current = null;
    if (plan?.kind === "preserve") {
      restoreScrollAnchor(listRef.current, plan.anchor, rows);
      armScrollExtension();
      return;
    }
    if (plan?.kind === "preservePrepend") {
      restorePrependedScroll(listRef.current, plan, rows);
      armScrollExtension();
      return;
    }
    if (plan?.kind !== "focus" && hasFocusedInitialRef.current) return;
    if (focusIndex >= 0 && scrollEclipseRowToAnchor(listRef.current, rows.length, focusIndex)) {
      hasFocusedInitialRef.current = true;
      armScrollExtension();
    }
  }, [armScrollExtension, chartMoment, documentId, focusIndex, from, rows, to]);

  const updateBinding = React.useCallback(
    async (binding: Record<string, unknown>, scrollPlan: ScrollPlan) => {
      scrollPlanRef.current = scrollPlan;
      pendingRef.current = true;
      setPending(true);
      try {
        await workspaceUpdateTableBinding(documentId, binding, TABLE_ID);
        const refreshed = await fetchPayload();
        rememberGenericTablePayload(TABLE_ID, documentId, refreshed);
        setPayload(refreshed);
        setError(null);
        setActionError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [documentId, fetchPayload],
  );

  // -10y/+10y and the year box re-CENTRE the window: wx _shift_range /
  // _apply_year_from_control reset the range to a symmetric year+/-10 and focus
  // mid-year (year, 7, 1) — eclipsesframe.py:465-470, 529-536 — even if endless
  // scrolling had previously widened the range asymmetrically.
  const recenterOnYear = React.useCallback(
    (year: number) => {
      scrollExtendArmedRef.current = false;
      scrollExtendInFlightRef.current = false;
      void updateBinding({
        from: [year - rangeYears, 1, 1],
        to: [year + rangeYears, 12, 31],
        year,
        focus: [year, 7, 1],
      }, { kind: "focus" });
    },
    [rangeYears, updateBinding],
  );

  const recenterOnDate = React.useCallback(
    (date: [number, number, number]) => {
      const year = date[0];
      scrollExtendArmedRef.current = false;
      scrollExtendInFlightRef.current = false;
      void updateBinding({
        from: [year - rangeYears, 1, 1],
        to: [year + rangeYears, 12, 31],
        year,
        focus: date,
      }, { kind: "focus" });
    },
    [rangeYears, updateBinding],
  );

  const focusedOnBirth = Boolean(focusDate && birthDate && sameDateTriple(focusDate, birthDate));
  const focusedOnCurrent = Boolean(focusDate && currentDate && sameDateTriple(focusDate, currentDate));
  const viewportToggleTarget = focusedOnBirth ? currentDate : birthDate;
  const viewportToggleLabel = focusedOnBirth
    ? t("eclipsesView.birthToCurrent")
    : focusedOnCurrent
      ? t("eclipsesView.currentToBirth")
      : t("eclipsesView.goBirth");

  const shiftRange = React.useCallback(
    (delta: number) => {
      recenterOnYear(centerYear + delta);
    },
    [centerYear, recenterOnYear],
  );

  const jumpToYear = React.useCallback((rawYear: string) => {
    const year = Number.parseInt(rawYear, 10);
    if (!Number.isFinite(year)) {
      return;
    }
    recenterOnYear(year);
  }, [recenterOnYear]);

  // wx _maybe_extend_range_for_scroll extends by one cached 10-year chunk when
  // the first/last visible row is within EDGE_TRIGGER_ROWS. On prepend it
  // restores old_view_y + inserted_rows * LINE_HEIGHT. Do the same using stable
  // row ids instead of DOM height, because virtualization changes DOM height.
  const extendRange = React.useCallback(
    (direction: "before" | "after") => {
      if (
        !scrollExtendArmedRef.current ||
        scrollExtendInFlightRef.current ||
        pendingRef.current ||
        !from ||
        !to ||
        !listRef.current
      ) {
        return;
      }
      scrollExtendInFlightRef.current = true;
      const sticky: Record<string, unknown> = { year: centerYear };
      if (Array.isArray(eclipses.focusDate) && eclipses.focusDate.length >= 3) {
        sticky.focus = eclipses.focusDate.slice(0, 3);
      }
      const plan: ScrollPlan =
        direction === "before"
          ? {
              kind: "preservePrepend",
              scrollTop: listRef.current.scrollTop,
              firstRowId: rows[0]?.id ?? null,
            }
          : {
              kind: "preserve",
              anchor: captureScrollAnchor(listRef.current),
            };
      const binding = direction === "before"
        ? {
            ...sticky,
            from: [from[0] - chunkYears, 1, 1],
            to: [to[0], to[1], to[2]],
          }
        : {
            ...sticky,
            from: [from[0], from[1], from[2]],
            to: [to[0] + chunkYears, 12, 31],
          };
      void updateBinding(binding, plan).finally(() => {
        scrollExtendInFlightRef.current = false;
      });
    },
    [centerYear, chunkYears, eclipses.focusDate, from, rows, to, updateBinding],
  );

  const checkScrollEdges = React.useCallback(() => {
    const el = listRef.current;
    if (
      !el ||
      !scrollExtendArmedRef.current ||
      scrollExtendInFlightRef.current ||
      pendingRef.current ||
      !rows.length
    ) {
      return;
    }
    const rowTop = getTableHeaderHeight(el);
    const bodyScrollTop = Math.max(0, el.scrollTop - rowTop);
    const firstVis = Math.max(0, Math.floor(bodyScrollTop / ROW_HEIGHT));
    const lastVis = Math.min(
      rows.length - 1,
      firstVis + Math.max(1, Math.floor(el.clientHeight / ROW_HEIGHT)),
    );
    if (firstVis <= edgeRows) {
      extendRange("before");
      return;
    }
    if ((rows.length - 1 - lastVis) <= edgeRows) {
      extendRange("after");
    }
  }, [edgeRows, extendRange, rows.length]);

  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    let frame = 0;
    const scheduleCheck = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        checkScrollEdges();
      });
    };
    el.addEventListener("scroll", scheduleCheck, { passive: true });
    return () => {
      el.removeEventListener("scroll", scheduleCheck);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [checkScrollEdges]);

  React.useEffect(() => {
    if (!payload) return;
    const id = window.requestAnimationFrame(() => checkScrollEdges());
    return () => window.cancelAnimationFrame(id);
  }, [checkScrollEdges, payload]);

  const changeChartMoment = React.useCallback(
    async (mode: EclipseChartMomentMode) => {
      if (mode === chartMoment) return;
      scrollPlanRef.current = {
        kind: "preserve",
        anchor: listRef.current ? captureScrollAnchor(listRef.current) : null,
      };
      setPending(true);
      try {
        await setEclipseChartMoment(mode);
        const refreshed = await fetchPayload();
        rememberGenericTablePayload(TABLE_ID, documentId, refreshed);
        setPayload(refreshed);
        setError(null);
        setActionError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [chartMoment, documentId, fetchPayload],
  );

  if (error && !payload) {
    return (
      <PaneShell sourceName={sourceName} onClose={onClose}>
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {error}
        </div>
      </PaneShell>
    );
  }

  if (!payload || !from || !to) {
    return (
      <PaneShell sourceName={sourceName} onClose={onClose}>
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {t("eclipsesView.loadingEclipses")}
        </div>
      </PaneShell>
    );
  }

  const isEmpty = rows.length === 0 && payload.rows.length === 1 && payload.rows[0]?.id === "empty";
  const exportPayload = orderedTablePayload(payload, displayColumnOrder);

  return (
    <PaneShell
      sourceName={sourceName}
      onClose={onClose}
      toolbar={
        <>
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded border border-[color:var(--aries-border-subtle)] hover:bg-accent/40 disabled:opacity-50"
            onClick={() => shiftRange(-rangeYears)}
            disabled={pending}
            aria-label={t("eclipsesView.previousEclipseRange")}
          >
            <ChevronLeft className="size-4" />
          </button>
          <input
            key={centerYear}
            aria-label={t("eclipsesView.eclipseCenterYear")}
            className="h-7 w-20 rounded border border-[color:var(--aries-border-subtle)] bg-background px-2 text-center text-[length:var(--aries-font-size-small)]"
            defaultValue={String(centerYear)}
            disabled={pending}
            onBlur={(event) => jumpToYear(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                jumpToYear(event.currentTarget.value);
              }
            }}
          />
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded border border-[color:var(--aries-border-subtle)] hover:bg-accent/40 disabled:opacity-50"
            onClick={() => shiftRange(rangeYears)}
            disabled={pending}
            aria-label={t("eclipsesView.nextEclipseRange")}
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-2 text-[length:var(--aries-font-size-small)] hover:bg-accent/40 disabled:opacity-50"
            onClick={() => {
              if (viewportToggleTarget) {
                recenterOnDate(viewportToggleTarget);
              }
            }}
            disabled={pending || !viewportToggleTarget}
            title={t("eclipsesView.switchViewportTitle")}
          >
            <Calendar className="size-3.5" />
            {viewportToggleLabel}
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-2 text-[length:var(--aries-font-size-small)] hover:bg-accent/40"
            onClick={() => {
              const text = tableToTsv(exportPayload, exportPayload.rows);
              void navigator.clipboard?.writeText(text).catch(() => {
                downloadText("eclipses.tsv", text, "text/tab-separated-values");
              });
            }}
          >
            <Copy className="size-3.5" />
            {t("eclipsesView.copy")}
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-2 text-[length:var(--aries-font-size-small)] hover:bg-accent/40"
            onClick={() =>
              void exportTextContent({
                filename: "eclipses",
                extension: "tsv",
                mimeType: "text/tab-separated-values;charset=utf-8",
                text: tableToTsv(exportPayload, exportPayload.rows),
                title: t("eclipsesView.exportTsvTitle"),
                filters: [{ name: t("eclipsesView.tsvFiles"), extensions: ["tsv"] }],
              }).catch(() => {})
            }
          >
            <Download className="size-3.5" />
            TSV
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-2 text-[length:var(--aries-font-size-small)] hover:bg-accent/40"
            onClick={() =>
              void exportTextContent({
                filename: "eclipses",
                extension: "txt",
                text: tableToAlignedText(exportPayload, exportPayload.rows, {
                  title: exportPayload.title ?? t("eclipsesView.eclipses"),
                  headerLines: [formatRange(from, to, dateConvention)],
                }),
                title: t("eclipsesView.exportTextTitle"),
                filters: [{ name: t("eclipsesView.textFiles"), extensions: ["txt"] }],
              }).catch(() => {})
            }
          >
            <FileText className="size-3.5" />
            TXT
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-2 text-[length:var(--aries-font-size-small)] hover:bg-accent/40"
            onClick={() =>
              void exportTablePayloadPdf(exportPayload, exportPayload.rows, {
                fileStem: "eclipses",
                title: exportPayload.title ?? t("eclipsesView.eclipses"),
                headerLines: [formatRange(from, to, dateConvention)],
              }).catch(() => {})
            }
          >
            <Download className="size-3.5" />
            PDF
          </button>
        </>
      }
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--aries-border-subtle)] px-3 py-1.5 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]">
        <span>{formatRange(from, to, dateConvention)}</span>
        <span>{chartMoment === "eclipse_maximum" ? t("eclipsesView.eclipseMaximum") : t("eclipsesView.exactConjunction")}</span>
      </div>
      {actionError ? (
        <div className="shrink-0 border-b border-[color:var(--aries-border-subtle)] px-3 py-1.5 text-[length:var(--aries-font-size-small)] text-destructive">
          {actionError}
        </div>
      ) : null}
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
        <table
          className={cn(LIST_ROLE_CLASSES.standard, "border-collapse", tableResize.tableClassName)}
          style={tableResize.tableStyle}
        >
          {tableResize.colGroup}
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              {displayColumnOrder.map((columnIndex) => {
                const column = payload.columns[columnIndex];
                return (
                  <th
                    key={column.id}
                    className={cn(
                      "aries-list-head-cell relative border font-medium",
                      "border-x-0 border-t-0 border-b",
                      column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "text-left",
                    )}
                  >
                    <ListHeadLabel align={columnAlign(column.align)}>{column.label}</ListHeadLabel>
                    <ColumnResizeHandle
                      columnId={column.id}
                      getResizeHandleProps={tableResize.getResizeHandleProps}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isEmpty ? (
              <tr>
                <td
                  colSpan={displayColumnOrder.length}
                  className="border-b border-[color:var(--aries-border-subtle)] px-3 py-8 text-center text-[color:var(--aries-text-muted)]"
                >
                  {eclipses.noRowsLabel ?? t("eclipsesView.noEclipsesInRange")}
                </td>
              </tr>
            ) : (
              <>
                {virtualRows.paddingTop > 0 ? (
                  <VirtualSpacerRow colSpan={displayColumnOrder.length} height={virtualRows.paddingTop} />
                ) : null}
                {visibleRows.map((row, offset) => (
                  <EclipseRow
                    key={row.id}
                    row={row}
                    rowIndex={virtualRows.startIndex + offset}
                    documentId={documentId}
                    radixDocumentId={parentDocumentId ?? documentId}
                    chartMoment={chartMoment}
                    chartMomentOptions={chartMomentOptions}
                    columns={payload.columns}
                    columnOrder={displayColumnOrder}
                    onChartMomentChange={changeChartMoment}
                    onFocusDate={recenterOnDate}
                    onActionError={setActionError}
                    dateConvention={dateConvention}
                  />
                ))}
                {virtualRows.paddingBottom > 0 ? (
                  <VirtualSpacerRow colSpan={displayColumnOrder.length} height={virtualRows.paddingBottom} />
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
    </PaneShell>
  );
}

function EclipseRow({
  row,
  rowIndex,
  documentId,
  radixDocumentId,
  chartMoment,
  chartMomentOptions,
  columns,
  columnOrder,
  onChartMomentChange,
  onFocusDate,
  onActionError,
  dateConvention,
}: {
  row: GenericTableRow;
  rowIndex: number;
  documentId: string;
  radixDocumentId: string;
  chartMoment: EclipseChartMomentMode;
  chartMomentOptions: Array<{ value: EclipseChartMomentMode; label: string }>;
  columns: readonly GenericTableColumn[];
  columnOrder: readonly number[];
  onChartMomentChange: (mode: EclipseChartMomentMode) => void;
  onFocusDate: (date: [number, number, number]) => void;
  onActionError: (message: string | null) => void;
  dateConvention: DateConvention;
}) {
  const t = useT();
  const meta = asRecord(row.meta);
  const eventDatetime = typeof meta.eventDatetime === "string" ? meta.eventDatetime : null;
  const timeContext = asRecordOrNull(meta.timeContext);
  const kindLabel = typeof meta.kindLabel === "string" ? meta.kindLabel : "Eclipse";
  const sessionLabel = typeof meta.sessionLabel === "string" ? meta.sessionLabel : kindLabel;
  const hasPath = Boolean(meta.hasEclipsePath);
  const eventJd = typeof meta.eventJd === "number" ? meta.eventJd : null;
  const retflag = typeof meta.retflag === "number" ? meta.retflag : 0;
  const sarosMember = typeof meta.sarosMember === "number" ? meta.sarosMember : null;
  const sarosFirstDate = parseIsoDateTriple(typeof meta.sarosFirstDate === "string" ? meta.sarosFirstDate : null);
  const sarosFirstLabel = typeof meta.sarosFirstLabel === "string" ? meta.sarosFirstLabel : (
    sarosFirstDate ? formatDate(sarosFirstDate, dateConvention) : null
  );
  const applyTimedChartOpenResult = useWorkspaceStore((s) => s.applyTimedChartOpenResult);

  // wx onShowEclipsePathOnMap (eclipseswnd.py:397-404) -> morin
  // .show_eclipse_path_on_map (morin.py:16211-16227): open the astrocart
  // workspace child for the radix carrying the eclipse event, then focus it.
  // Enabled only for central solar eclipses (eclipseswnd.py:333-341, 355-357).
  const showEclipsePath = () => {
    if (!hasPath || eventJd == null) return;
    const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
    void workspaceOpenAstrocart(radixDocumentId, { jdUt: eventJd, retflag })
      .then(async (res) => {
        if (!res.documentId) {
          throw new Error(t("eclipsesView.eclipsePathNoMap"));
        }
        // Match the regular Astrocart launcher path: open the daemon child,
        // then explicitly activate it and apply that active tree immediately.
        const activated = await workspaceActivate(res.documentId);
        onActionError(null);
        applyTimedChartOpenResult({
          documentId: res.documentId,
          activeDocumentId: activated.activeDocumentId ?? res.documentId,
          documents: activated.documents,
        });
      })
      .catch((err) => {
        onActionError(err instanceof Error ? err.message : String(err));
      })
      .finally(finishSnapshotCommand);
  };
  const chartMomentLabel = chartMomentOptions.find((option) => option.value === chartMoment)?.label ?? (
    chartMoment === "eclipse_maximum" ? t("eclipsesView.eclipseMaximum") : t("eclipsesView.exactConjunction")
  );
  const opensAtLabel = eventDatetime ? `${chartMomentLabel}: ${formatDateTimeLabel(eventDatetime, dateConvention)}` : null;
  const showRadix = useWorkspaceStore((s) => s.timedChartShowRadix);
  const openTransitForDate = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!eventDatetime) return;
      const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
      void openDirectionsTimedChart(
        documentId,
        "transits",
        eventDatetime,
        undefined,
        timeContext,
        sessionLabel,
        showRadix,
      )
        .then((result) => applyTimedChartOpenResult(result))
        .catch((err) => {
          onActionError(err instanceof Error ? err.message : String(err));
        })
        .finally(finishSnapshotCommand);
    },
    [applyTimedChartOpenResult, documentId, eventDatetime, onActionError, sessionLabel, showRadix, timeContext],
  );
  const rowTitle = row.current
    ? [opensAtLabel, t("eclipsesView.lastEclipseBeforeNow")].filter(Boolean).join("\n")
    : opensAtLabel ?? undefined;
  return (
    <TimedChartContextMenu
      documentId={documentId}
      eventDatetime={eventDatetime}
      timeContext={timeContext}
      sessionLabel={sessionLabel}
      onActionError={onActionError}
      beforeTimedItems={
        opensAtLabel ? (
          <>
            <ContextMenuItem disabled>{opensAtLabel}</ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null
      }
      afterTimedItems={
        <>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t("eclipsesView.eclipseChartMoment")}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-48">
              <ContextMenuRadioGroup
                value={chartMoment}
                onValueChange={(value) => onChartMomentChange(value as EclipseChartMomentMode)}
              >
                {chartMomentOptions.map((option) => (
                  <ContextMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!sarosFirstDate || (sarosMember != null && sarosMember <= 1)}
            onClick={() => {
              if (sarosFirstDate) {
                onFocusDate(sarosFirstDate);
              }
            }}
          >
            {sarosFirstLabel ? t("eclipsesView.goToFirstSarosWith", { label: sarosFirstLabel }) : t("eclipsesView.goToFirstSaros")}
          </ContextMenuItem>
          <ContextMenuItem disabled={!hasPath || eventJd == null} onClick={showEclipsePath}>
            {t("eclipsesView.showEclipsePathOnMap")}
          </ContextMenuItem>
        </>
      }
    >
      <tr
        data-eclipse-row={row.id}
        data-eclipse-index={rowIndex}
        title={rowTitle}
        className={cn(
          "aries-list-row border-b",
          LIST_ROW_CLASSES.hover,
          LIST_ROW_CLASSES.flagged,
          row.current && LIST_ROW_CLASSES.current,
          row.emphasis === "strong" && "font-semibold",
        )}
        style={{ height: ROW_HEIGHT }}
      >
        {columnOrder.map((sourceIndex, visualIndex) => {
          const cell = row.cells[sourceIndex];
          const column = columns[sourceIndex];
          const isDate = isListDateColumn(column);
          const cellStyle: React.CSSProperties | undefined =
            row.current && visualIndex === 0
              ? { boxShadow: "inset var(--aries-list-hover-flag-width) 0 0 var(--primary)" }
              : undefined;
          return (
            <td
              key={`${sourceIndex}:${column?.id ?? "cell"}`}
              className={cn(
                "aries-list-cell whitespace-nowrap align-middle",
                cell?.align === "right" ? "text-right" : cell?.align === "center" ? "text-center" : "text-left",
                isDate && "font-medium",
              )}
              style={cellStyle}
            >
              {isDate && eventDatetime ? (
                <button
                  type="button"
                  onClick={openTransitForDate}
                  className="inline-flex font-medium underline-offset-2 hover:text-primary hover:underline"
                >
                  <CellView cell={cell} />
                </button>
              ) : (
                <CellView cell={cell} />
              )}
            </td>
          );
        })}
      </tr>
    </TimedChartContextMenu>
  );
}

function PaneShell({
  sourceName,
  onClose,
  toolbar,
  children,
}: {
  sourceName?: string;
  onClose?: () => void;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="font-morinus-text flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[color:var(--aries-border-subtle)] bg-background px-3 py-2">
        <div className="min-w-0 truncate text-[length:var(--aries-font-size-small)] font-medium text-[color:var(--aries-text-primary)]">
          {t("eclipsesView.eclipses")}
          {sourceName ? (
            <span className="ml-1 font-normal text-[color:var(--aries-text-muted)]">{sourceName}</span>
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {toolbar}
          {onClose ? (
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded hover:bg-accent/40"
              onClick={onClose}
              aria-label={t("eclipsesView.closeEclipses")}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function columnAlign(align?: string): ListHeadAlign {
  return align === "right" ? "right" : align === "left" ? "left" : "center";
}

function orderedTablePayload(
  payload: GenericTablePayload,
  columnOrder: readonly number[],
): GenericTablePayload {
  const validOrder = columnOrder.filter((index) => payload.columns[index] != null);
  if (
    validOrder.length === payload.columns.length &&
    validOrder.every((columnIndex, displayIndex) => columnIndex === displayIndex)
  ) {
    return payload;
  }
  return {
    ...payload,
    columns: validOrder.map((columnIndex) => payload.columns[columnIndex]),
    rows: payload.rows.map((row) => ({
      ...row,
      cells: validOrder.map((columnIndex) => row.cells[columnIndex] ?? { text: "" }),
    })),
  };
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return Object.keys(record).length ? record : null;
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asDateTriple(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const y = Number(value[0]);
  const m = Number(value[1]);
  const d = Number(value[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return [Math.trunc(y), Math.trunc(m), Math.trunc(d)];
}

function parseIsoDateTriple(value: string | null): [number, number, number] | null {
  if (!value) return null;
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const year = Number.parseInt(parts[0] ?? "", 10);
  const month = Number.parseInt(parts[1] ?? "", 10);
  const day = Number.parseInt(parts[2] ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return [year, month, day];
}

function sameDateTriple(a: [number, number, number], b: [number, number, number]) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function formatRange(from: [number, number, number], to: [number, number, number], convention: DateConvention) {
  return `${formatDate(from, convention)} - ${formatDate(to, convention)}`;
}

function formatDate(values: [number, number, number], convention: DateConvention) {
  return formatDateTriple(values, convention);
}

function formatDateTimeLabel(value: string, convention: DateConvention) {
  return formatIsoDateTimeDisplay(value, convention);
}

function useVirtualRows(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  rowCount: number,
  seedIndex: number,
) {
  const [viewport, setViewport] = React.useState({ scrollTop: 0, height: 0, headerHeight: 0 });

  const measureNow = React.useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = {
      scrollTop: scroller.scrollTop,
      height: scroller.clientHeight,
      headerHeight: getTableHeaderHeight(scroller),
    };
    setViewport((prev) =>
      prev.scrollTop === next.scrollTop &&
      prev.height === next.height &&
      prev.headerHeight === next.headerHeight
        ? prev
        : next,
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
    const scheduleMeasure = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    scheduleMeasure();
    scroller.addEventListener("scroll", scheduleMeasure, { passive: true });
    scroller.addEventListener(ECLIPSE_VIRTUAL_SCROLL_SYNC_EVENT, measureNow);
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    resizeObserver?.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", scheduleMeasure);
      scroller.removeEventListener(ECLIPSE_VIRTUAL_SCROLL_SYNC_EVENT, measureNow);
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
    const bodyScrollTop = Math.max(0, viewport.scrollTop - viewport.headerHeight);
    const visibleStart =
      viewport.height > 0
        ? Math.floor(bodyScrollTop / ROW_HEIGHT)
        : seededStart;
    const visibleCount = Math.max(1, Math.ceil(viewport.height / ROW_HEIGHT));
    const startIndex = Math.max(0, visibleStart - VIRTUAL_OVERSCAN_ROWS);
    const endIndex = Math.min(rowCount, visibleStart + visibleCount + VIRTUAL_OVERSCAN_ROWS);
    return {
      startIndex,
      endIndex,
      paddingTop: startIndex * ROW_HEIGHT,
      paddingBottom: (rowCount - endIndex) * ROW_HEIGHT,
    };
  }, [rowCount, seedIndex, viewport.headerHeight, viewport.height, viewport.scrollTop]);
}

function VirtualSpacerRow({ colSpan, height }: { colSpan: number; height: number }) {
  return (
    <tr
      aria-hidden="true"
      data-virtual-spacer
      className="border-0 hover:bg-transparent"
      style={{ height }}
    >
      <td colSpan={colSpan} className="border-0 p-0" style={{ height }} />
    </tr>
  );
}

function getTableHeaderHeight(container: HTMLElement): number {
  const header = container.querySelector<HTMLElement>("thead");
  return header?.offsetHeight ?? 0;
}

function clampScrollTop(container: HTMLElement, scrollTop: number, rowCount: number) {
  const maxTop = Math.max(0, getTableHeaderHeight(container) + rowCount * ROW_HEIGHT - container.clientHeight);
  container.scrollTop = Math.max(0, Math.min(maxTop, scrollTop));
  container.dispatchEvent(new Event(ECLIPSE_VIRTUAL_SCROLL_SYNC_EVENT));
}

function scrollEclipseRowToAnchor(
  container: HTMLElement,
  rowCount: number,
  rowIndex: number,
): boolean {
  if (rowCount <= 0 || rowIndex < 0 || container.clientHeight <= 0) return false;
  const targetIndex = Math.max(0, Math.min(rowCount - 1, rowIndex));
  const targetTop =
    getTableHeaderHeight(container) +
    Math.max(0, targetIndex - FOCUS_CONTEXT_ROWS) * ROW_HEIGHT;
  clampScrollTop(container, targetTop, rowCount);
  return Math.abs(container.scrollTop - Math.max(0, targetTop)) <= 2 || container.scrollTop >= 0;
}

function captureScrollAnchor(container: HTMLElement): ScrollAnchor | null {
  const containerRect = container.getBoundingClientRect();
  const rows = Array.from(container.querySelectorAll<HTMLElement>("tbody tr[data-eclipse-row]"));
  for (const row of rows) {
    const rowRect = row.getBoundingClientRect();
    if (rowRect.bottom < containerRect.top) continue;
    const rowId = row.dataset.eclipseRow;
    if (!rowId) continue;
    const rowIndex = Number(row.dataset.eclipseIndex);
    return {
      rowId,
      rowIndex: Number.isFinite(rowIndex) ? rowIndex : 0,
      offsetTop: rowRect.top - containerRect.top,
    };
  }
  return null;
}

function restoreScrollAnchor(
  container: HTMLElement,
  anchor: ScrollAnchor | null,
  rows: readonly GenericTableRow[],
) {
  if (!anchor) return;
  const row = container.querySelector<HTMLElement>(`tbody tr[data-eclipse-row="${CSS.escape(anchor.rowId)}"]`);
  if (row) {
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const delta = rowRect.top - containerRect.top - anchor.offsetTop;
    clampScrollTop(container, container.scrollTop + delta, rows.length);
    return;
  }
  const rowIndex = rows.findIndex((candidate) => candidate.id === anchor.rowId);
  const nextIndex = rowIndex >= 0 ? rowIndex : anchor.rowIndex;
  clampScrollTop(
    container,
    getTableHeaderHeight(container) + Math.max(0, nextIndex) * ROW_HEIGHT - anchor.offsetTop,
    rows.length,
  );
}

function restorePrependedScroll(
  container: HTMLElement,
  plan: Extract<ScrollPlan, { kind: "preservePrepend" }>,
  rows: readonly GenericTableRow[],
) {
  const prependRows = plan.firstRowId
    ? rows.findIndex((candidate) => candidate.id === plan.firstRowId)
    : 0;
  clampScrollTop(
    container,
    plan.scrollTop + Math.max(0, prependRows) * ROW_HEIGHT,
    rows.length,
  );
}
