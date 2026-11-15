// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable react-hooks/preserve-manual-memoization -- Virtualized table scroll anchoring intentionally uses manual memoization and mutable refs. */
"use client";

import { useTablePrecision } from "./table-precision-menu";
import * as React from "react";
import { useRetainedListRequests } from "@/lib/table/use-retained-list-requests";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

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
  fetchEclipseTableRange,
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
import { astronomicalToCivilYear, civilToAstronomicalYear, coerceDateConvention, formatAstronomicalDateTriple, parseIsoDateTriple, type DateConvention } from "@/lib/date-display";
import { LIST_PANE_CLASSES, LIST_ROLE_CLASSES, LIST_ROW_CLASSES, useListRowHeight } from "@/lib/list-tokens";
import {
  getCachedGenericTablePayload,
  rememberGenericTablePayload,
} from "@/lib/table/payload-cache";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n/i18n";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { beginWorkspaceSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";

import { TimedChartContextMenu } from "./directions-view";
import { CellView } from "./generic-table-view";
import {
  isListDateColumn,
  listColumnDisplayOrder,
  useListLayoutPreset,
} from "./list-column-layout";
import { ListHeadLabel, type ListHeadAlign } from "./list-head-label";
import { buildTableExportDocument } from "./table-pdf-export";
import { TextExportActions } from "./text-export-actions";
import { useSettledWorkspaceRefreshSeq } from "./step-refresh";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";
import { RetainedPaneShell } from "./retained-pane-shell";
import { PaneInfoBar, PaneToolbarButton } from "./list-controls";

type Props = {
  documentId: string;
  parentDocumentId?: string | null;
  sourceName?: string;
  onClose?: () => void;
};

type EclipseCapabilities = {
  calendar?: "mixed_1582";
  calendarNote?: string;
  longitudeNote?: string;
  fromLabel?: string;
  toLabel?: string;
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
  seriesMode?: boolean;
  sarosKind?: "solar" | "lunar" | null;
  sarosKindLabel?: string | null;
  sarosSeries?: number | null;
  sarosSpanYears?: number | null;
  sarosAgeYears?: number | null;
};

const TABLE_ID = "eclipses";

const ECLIPSE_FOCUS_ANCHOR = 0.25;
const VIRTUAL_OVERSCAN_ROWS = 18;
const ECLIPSE_VIRTUAL_SCROLL_SYNC_EVENT = "aries:eclipse-virtual-scroll-sync";

type ScrollPlan =
  | { kind: "focus" }
  | { kind: "preserve"; anchor: ScrollAnchor | null }
  | {
      kind: "preservePrepend";
      count: number;
      rowHeight: number;
    };

type ScrollAnchor = {
  rowId: string;
  rowIndex: number;
  offsetTop: number;
};

export function EclipsesView({ documentId, parentDocumentId, sourceName, onClose }: Props) {
  const t = useT();
  const locale = useLocale();
  const rowHeight = useListRowHeight("standard");
  const rowHeightRef = React.useRef(rowHeight);
  React.useLayoutEffect(() => {
    rowHeightRef.current = rowHeight;
  }, [rowHeight]);
  const [payload, setPayload] = React.useState<GenericTablePayload | null>(() =>
    getCachedGenericTablePayload(TABLE_ID, documentId),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastRetainedDataOptionsChange);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const scrollPlanRef = React.useRef<ScrollPlan | null>({ kind: "focus" });
  const hasFocusedInitialRef = React.useRef(false);
  // The command that showed the busy state is the only one that clears it.
  const pendingRef = React.useRef<object | null>(null);
  const scrollExtendArmedRef = React.useRef(false);
  const finiteSeriesRequestedRef = React.useRef(false);
  const finiteSeriesRequestIdRef = React.useRef(0);
  const [requests, requestsIdle] = useRetainedListRequests<GenericTablePayload>(payload);
  const payloadDocumentIdRef = React.useRef(documentId);
  const layoutPreset = useListLayoutPreset();

  React.useLayoutEffect(() => {
    if (payloadDocumentIdRef.current !== documentId) {
      payloadDocumentIdRef.current = documentId;
      finiteSeriesRequestIdRef.current += 1;
      finiteSeriesRequestedRef.current = false;
      const cached = getCachedGenericTablePayload(TABLE_ID, documentId);
      requests.reset(cached);
      setPayload(cached);
      scrollPlanRef.current = { kind: "focus" };
      hasFocusedInitialRef.current = false;
      return;
    }
  }, [documentId, payload, requests]);

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

  const fetchRetainedPayload = React.useCallback(
    async (signal?: AbortSignal) => {
      const current = payloadDocumentIdRef.current === documentId ? requests.accepted() : null;
      const currentEclipses = asRecord(asRecord(current?.capabilities).eclipses);
      if (finiteSeriesRequestedRef.current || currentEclipses.seriesMode === true) {
        return fetchGenericTablePayload(TABLE_ID, documentId, signal);
      }
      const currentFrom = asDateTriple(currentEclipses.from);
      const currentTo = asDateTriple(currentEclipses.to);
      if (currentFrom && currentTo) {
        return fetchEclipseTableRange(documentId, currentFrom[0], currentTo[0], signal);
      }
      return fetchGenericTablePayload(TABLE_ID, documentId, signal);
    },
    [requests, documentId],
  );

  React.useEffect(() => {
    const request = requests.replace();
    if (hasFocusedInitialRef.current && listRef.current) {
      scrollPlanRef.current = { kind: "preserve", anchor: captureScrollAnchor(listRef.current) };
    }
    fetchRetainedPayload(request.signal)
      .then((next) => {
        if (!request.publish(next)) return;
        request.finish();
        rememberGenericTablePayload(TABLE_ID, documentId, next);
        setPayload(next);
        setError(null);
        setActionError(null);
      })
      .catch((err) => {
        if (isAbortError(err, request.signal)) return;
        setError(err instanceof Error ? err.message : String(err));
      }).finally(request.finish);
    return request.cancel;
  }, [documentId, fetchRetainedPayload, refreshSeq, requests]);

  React.useEffect(() => requests.cancel, [requests]);

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
  const seriesMode = eclipses.seriesMode === true;
  const seriesKind = eclipses.sarosKind === "solar" || eclipses.sarosKind === "lunar"
    ? eclipses.sarosKind
    : null;
  const seriesKindLabel = typeof eclipses.sarosKindLabel === "string" ? eclipses.sarosKindLabel : null;
  const seriesNumber = typeof eclipses.sarosSeries === "number" ? eclipses.sarosSeries : null;
  const viewportKey = seriesMode && seriesKind && seriesNumber != null
    ? `saros:${seriesKind}:${seriesNumber}`
    : "all-eclipses";
  const lastViewportKeyRef = React.useRef(viewportKey);
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
  const virtualRows = useVirtualRows(listRef, rows.length, focusIndex, rowHeight, !seriesMode);
  const visibleRows = rows.slice(virtualRows.startIndex, virtualRows.endIndex);
  const previousRowHeightRef = React.useRef(rowHeight);
  React.useLayoutEffect(() => {
    const previousRowHeight = previousRowHeightRef.current;
    previousRowHeightRef.current = rowHeight;
    if (previousRowHeight === rowHeight) return;
    const container = listRef.current;
    if (!container || rows.length === 0) return;
    const headerHeight = getTableHeaderHeight(container);
    const bodyScrollTop = Math.max(0, container.scrollTop - headerHeight);
    const anchorUnits = Math.max(
      0,
      Math.min(rows.length, bodyScrollTop / previousRowHeight),
    );
    scrollExtendArmedRef.current = false;
    container.dataset.ariesRowHeightAnchorUntil = String(Date.now() + 250);
    clampScrollTop(
      container,
      container.scrollTop <= headerHeight
        ? container.scrollTop
        : headerHeight + anchorUnits * rowHeight,
      rows.length,
      rowHeight,
    );
    if (!seriesMode) armScrollExtension();
  }, [armScrollExtension, rowHeight, rows.length, seriesMode]);
  React.useLayoutEffect(() => {
    if (!listRef.current || !from || !to || !rows.length) return;
    const enteredNewViewport = lastViewportKeyRef.current !== viewportKey;
    lastViewportKeyRef.current = viewportKey;
    const plan = scrollPlanRef.current;
    scrollPlanRef.current = null;
    if (
      enteredNewViewport &&
      focusIndex >= 0 &&
      scrollEclipseRowToAnchor(listRef.current, rows.length, focusIndex, rowHeight)
    ) {
      hasFocusedInitialRef.current = true;
      return;
    }
    if (plan?.kind === "preserve") {
      restoreScrollAnchor(listRef.current, plan.anchor, rows, rowHeight);
      if (!seriesMode) armScrollExtension();
      return;
    }
    if (plan?.kind === "preservePrepend") {
      restorePrependedScroll(listRef.current, plan, rows, rowHeight);
      if (!seriesMode) armScrollExtension();
      return;
    }
    if (plan?.kind !== "focus" && hasFocusedInitialRef.current) return;
    if (
      focusIndex >= 0 &&
      scrollEclipseRowToAnchor(listRef.current, rows.length, focusIndex, rowHeight)
    ) {
      hasFocusedInitialRef.current = true;
      if (!seriesMode) armScrollExtension();
    }
  }, [armScrollExtension, chartMoment, documentId, focusIndex, from, rowHeight, rows, seriesMode, to, viewportKey]);

  const updateBinding = React.useCallback(
    async (
      binding: Record<string, unknown>,
      scrollPlan: ScrollPlan,
    ) => {
      const request = requests.replace();
      scrollPlanRef.current = scrollPlan;
      pendingRef.current = request;
      setPending(true);
      let bindingUpdated = false;
      try {
        await workspaceUpdateTableBinding(documentId, binding, TABLE_ID);
        bindingUpdated = true;
        if (!request.current()) return bindingUpdated;
        const refreshed = await fetchGenericTablePayload(TABLE_ID, documentId, request.signal);
        if (payloadDocumentIdRef.current !== documentId) return true;
        if (!request.publish(refreshed)) return bindingUpdated;
        rememberGenericTablePayload(TABLE_ID, documentId, refreshed);

        setPayload(refreshed);
        setError(null);
        setActionError(null);
        return true;
      } catch (err) {
        if (!request.current()) return bindingUpdated;
        if (scrollPlanRef.current === scrollPlan) {
          scrollPlanRef.current = null;
        }
        setError(err instanceof Error ? err.message : String(err));
        return bindingUpdated;
      } finally {
        request.finish();
        if (pendingRef.current === request) {
          pendingRef.current = null;
          setPending(false);
        }
      }
    },
    [requests, documentId],
  );

  // -10y/+10y and the year box re-CENTRE the window: wx _shift_range /
  // _apply_year_from_control reset the range to a symmetric year+/-10 and focus
  // mid-year (year, 7, 1) — eclipsesframe.py:465-470, 529-536 — even if endless
  // scrolling had previously widened the range asymmetrically.
  const recenterOnYear = React.useCallback(
    (year: number) => {
      scrollExtendArmedRef.current = false;
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
    if (!Number.isFinite(year) || year === 0) {
      return false;
    }
    recenterOnYear(civilToAstronomicalYear(year));
    return true;
  }, [recenterOnYear]);

  // Edge scrolling reads only the adjacent 10-year island. It must not mutate
  // the canonical table binding: that broadcasts a document change and makes
  // the daemon rebuild every decade already loaded into the pane.
  const extendRange = React.useCallback(
    (direction: "before" | "after") => {
      if (
        !scrollExtendArmedRef.current ||
        finiteSeriesRequestedRef.current ||
        seriesMode ||
        requests.busy ||
        pendingRef.current ||
        !from ||
        !to ||
        !listRef.current
      ) {
        return;
      }
      const request = requests.extend();
      if (!request) return;
      const fromYear = direction === "before" ? from[0] - chunkYears : to[0] + 1;
      const toYear = direction === "before" ? from[0] - 1 : to[0] + chunkYears;
      void fetchEclipseTableRange(documentId, fromYear, toYear, request.signal)
        .then((chunk) => {
          if (!request.current()) return;
          const current = requests.accepted();
          if (!current) return;
          const stitched = stitchEclipsePayload(current, chunk, direction);
          scrollPlanRef.current = direction === "before"
            ? {
                kind: "preservePrepend",
                count: stitched.prependedCount,
                rowHeight: rowHeightRef.current,
              }
            : {
                kind: "preserve",
                anchor: null,
              };
          // Release before React commits the rows so the layout correction and
          // continued trackpad input never contend with a stale in-flight gate.
          request.publish(stitched.payload);
          request.finish();
          rememberGenericTablePayload(TABLE_ID, documentId, stitched.payload);
          setPayload(stitched.payload);
          setError(null);
          setActionError(null);
        })
        .catch((err) => {
          if (isAbortError(err, request.signal)) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          request.finish();
        });
    },
    [chunkYears, documentId, from, requests, seriesMode, to],
  );

  const checkScrollEdges = React.useCallback(() => {
    const el = listRef.current;
    if (
      !el ||
      seriesMode ||
      !scrollExtendArmedRef.current ||
      requests.busy ||
      pendingRef.current ||
      Number(el.dataset.ariesRowHeightAnchorUntil ?? 0) > Date.now() ||
      !rows.length
    ) {
      return;
    }
    const rowTop = getTableHeaderHeight(el);
    const bodyScrollTop = Math.max(0, el.scrollTop - rowTop);
    const bodyViewportHeight = Math.max(rowHeightRef.current, el.clientHeight - rowTop);
    const viewportRows = Math.max(
      1,
      Math.ceil(bodyViewportHeight / rowHeightRef.current),
    );
    // Eclipse chunks take longer to materialize than the denser retained lists.
    // Start the adjacent fetch one viewport before the hard edge so trackpad
    // momentum never stalls there and resumes against newly appended rows.
    const triggerRows = Math.max(edgeRows, viewportRows);
    const firstVis = Math.max(0, Math.floor(bodyScrollTop / rowHeightRef.current));
    const lastVis = Math.min(
      rows.length - 1,
      firstVis + viewportRows - 1,
    );
    if (firstVis <= triggerRows) {
      extendRange("before");
      return;
    }
    if ((rows.length - 1 - lastVis) <= triggerRows) {
      extendRange("after");
    }
  }, [requests, edgeRows, extendRange, rows.length, seriesMode]);

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
  }, [checkScrollEdges, payload, requestsIdle]);

  const changeChartMoment = React.useCallback(
    async (mode: EclipseChartMomentMode) => {
      if (mode === chartMoment) return;
      const request = requests.replace();
      scrollPlanRef.current = {
        kind: "preserve",
        anchor: listRef.current ? captureScrollAnchor(listRef.current) : null,
      };
      pendingRef.current = request;
      setPending(true);
      try {
        await setEclipseChartMoment(mode);
        if (!request.current()) return;
        const refreshed = await fetchRetainedPayload(request.signal);
        if (!request.publish(refreshed)) return;
        rememberGenericTablePayload(TABLE_ID, documentId, refreshed);

        setPayload(refreshed);
        setError(null);
        setActionError(null);
      } catch (err) {
        if (!request.current()) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        request.finish();
        if (pendingRef.current === request) {
          pendingRef.current = null;
          setPending(false);
        }
      }
    },
    [requests, chartMoment, documentId, fetchRetainedPayload],
  );

  const ordinaryRangeBinding = React.useMemo<Record<string, unknown>>(() => ({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    year: centerYear,
    ...(focusDate ? { focus: focusDate } : {}),
  }), [centerYear, focusDate, from, to]);
  const showSarosSeries = React.useCallback((selection: {
    kind: "solar" | "lunar";
    series: number;
    member: number;
    eventJd: number;
  }) => {
    const previousFiniteRequest = finiteSeriesRequestedRef.current;
    const requestId = ++finiteSeriesRequestIdRef.current;
    finiteSeriesRequestedRef.current = true;
    void updateBinding({
      ...ordinaryRangeBinding,
      saros_kind: selection.kind,
      saros_series: selection.series,
      saros_member: selection.member,
      saros_event_jd: selection.eventJd,
    }, { kind: "focus" }).then((bindingAccepted) => {
      if (!bindingAccepted && finiteSeriesRequestIdRef.current === requestId) {
        finiteSeriesRequestedRef.current = previousFiniteRequest;
      }
    });
  }, [ordinaryRangeBinding, updateBinding]);
  const backToAllEclipses = React.useCallback(() => {
    finiteSeriesRequestIdRef.current += 1;
    finiteSeriesRequestedRef.current = false;
    void updateBinding(ordinaryRangeBinding, { kind: "focus" });
  }, [ordinaryRangeBinding, updateBinding]);
  const focusEclipseDate = React.useCallback((date: [number, number, number]) => {
    if (seriesMode) {
      if (listRef.current) {
        scrollEclipseRowToAnchor(listRef.current, rows.length, 0, rowHeight);
      }
      return;
    }
    recenterOnDate(date);
  }, [recenterOnDate, rowHeight, rows.length, seriesMode]);

  if (error && !payload) {
    return (
      <RetainedPaneShell
        title={t("eclipsesView.eclipses")}
        sourceName={sourceName}
        closeLabel={t("eclipsesView.closeEclipses")}
        onClose={onClose}
        closePosition="leading"
        wrapHeader
        closeSize="small"
      >
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {error}
        </div>
      </RetainedPaneShell>
    );
  }

  if (!payload || !from || !to) {
    return (
      <RetainedPaneShell
        title={t("eclipsesView.eclipses")}
        sourceName={sourceName}
        closeLabel={t("eclipsesView.closeEclipses")}
        onClose={onClose}
        closePosition="leading"
        wrapHeader
        closeSize="small"
      >
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {t("eclipsesView.loadingEclipses")}
        </div>
      </RetainedPaneShell>
    );
  }

  const isEmpty = rows.length === 0 && payload.rows.length === 1 && payload.rows[0]?.id === "empty";
  const exportPayload = orderedTablePayload(payload, displayColumnOrder);
  const rangeLabel = eclipses.fromLabel && eclipses.toLabel
    ? `${eclipses.fromLabel} - ${eclipses.toLabel}`
    : formatRange(from, to, dateConvention);
  const viewHeaderLabel = seriesMode && seriesKindLabel && seriesNumber != null
    ? t("eclipsesView.sarosSeriesLabel", { kind: seriesKindLabel, series: seriesNumber })
    : rangeLabel;
  const seriesSpanLabel = seriesMode && typeof eclipses.sarosSpanYears === "number" && Number.isFinite(eclipses.sarosSpanYears)
    ? t("eclipsesView.sarosTotalSpan", {
        years: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(eclipses.sarosSpanYears),
      })
    : null;
  const seriesAgeLabel = seriesMode && typeof eclipses.sarosAgeYears === "number" && Number.isFinite(eclipses.sarosAgeYears)
    ? t("eclipsesView.sarosCurrentAge", {
        years: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(eclipses.sarosAgeYears),
      })
    : null;

  return (
    <RetainedPaneShell
      title={t("eclipsesView.eclipses")}
      sourceName={sourceName}
      closeLabel={t("eclipsesView.closeEclipses")}
      onClose={onClose}
      closePosition="leading"
      wrapHeader
      closeSize="small"
      toolbar={
        <>
          {!seriesMode ? (
            <>
              <PaneToolbarButton
                type="button"
                density="small"
                square
                onClick={() => shiftRange(-rangeYears)}
                disabled={pending}
                aria-label={t("eclipsesView.previousEclipseRange")}
              >
                <ChevronLeft />
              </PaneToolbarButton>
              <input
                data-aries-control-appearance="local"
                key={centerYear}
                aria-label={t("eclipsesView.eclipseCenterYear")}
                className="h-[var(--aries-control-height-small)] w-20 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-border-subtle)] bg-background px-[var(--aries-control-padding-x-compact)] text-center text-[length:var(--aries-font-size-small)]"
                defaultValue={String(astronomicalToCivilYear(centerYear))}
                disabled={pending}
                onBlur={(event) => {
                  if (!jumpToYear(event.currentTarget.value)) {
                    event.currentTarget.value = String(astronomicalToCivilYear(centerYear));
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!jumpToYear(event.currentTarget.value)) {
                      event.currentTarget.value = String(astronomicalToCivilYear(centerYear));
                    }
                  }
                }}
              />
              <PaneToolbarButton
                type="button"
                density="small"
                square
                onClick={() => shiftRange(rangeYears)}
                disabled={pending}
                aria-label={t("eclipsesView.nextEclipseRange")}
              >
                <ChevronRight />
              </PaneToolbarButton>
              <PaneToolbarButton
                type="button"
                density="small"
                onClick={() => {
                  if (viewportToggleTarget) {
                    recenterOnDate(viewportToggleTarget);
                  }
                }}
                disabled={pending || !viewportToggleTarget}
                title={t("eclipsesView.switchViewportTitle")}
              >
                <Calendar />
                {viewportToggleLabel}
              </PaneToolbarButton>
            </>
          ) : null}
          <TextExportActions
            sourceName={sourceName}
            fileStem="eclipses"
            buildDocument={() =>
              buildTableExportDocument(exportPayload, exportPayload.rows, {
                fileStem: "eclipses",
                title: exportPayload.title ?? t("eclipsesView.eclipses"),
                headerLines: [
                  viewHeaderLabel,
                  ...(eclipses.calendarNote ? [eclipses.calendarNote] : []),
                  ...(eclipses.longitudeNote ? [eclipses.longitudeNote] : []),
                  ...(seriesSpanLabel ? [seriesSpanLabel] : []),
                  ...(seriesAgeLabel ? [seriesAgeLabel] : []),
                ],
              })
            }
          />
        </>
      }
    >
      <PaneInfoBar className="justify-between text-[color:var(--aries-text-muted)]">
        {seriesMode && seriesKind && seriesKindLabel && seriesNumber != null ? (
          <span className="flex items-center gap-[var(--aries-control-gap)]">
            <PaneToolbarButton type="button" density="compact" onClick={backToAllEclipses} disabled={pending}>
              <ChevronLeft />
              {t("eclipsesView.backToAllEclipses")}
            </PaneToolbarButton>
            <span>{t("eclipsesView.sarosSeriesLabel", { kind: seriesKindLabel, series: seriesNumber })}</span>
          </span>
        ) : (
          <span>{rangeLabel}</span>
        )}
        <span>{chartMoment === "eclipse_maximum" ? t("eclipsesView.eclipseMaximum") : t("eclipsesView.exactConjunction")}</span>
      </PaneInfoBar>
      {seriesSpanLabel ? (
        <PaneInfoBar className="flex-wrap justify-between text-[color:var(--aries-text-muted)]">
          <span>{seriesSpanLabel}</span>
          {seriesAgeLabel ? <span>{seriesAgeLabel}</span> : null}
        </PaneInfoBar>
      ) : null}
      {actionError ? (
        <div className="shrink-0 border-b border-[color:var(--aries-border-subtle)] px-3 py-1.5 text-[length:var(--aries-font-size-small)] text-destructive">
          {actionError}
        </div>
      ) : null}
      <div
        key={viewportKey}
        ref={listRef}
        className={LIST_PANE_CLASSES.scroller}
      >
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
                    title={column.id === "date" ? eclipses.calendarNote : column.id === "longitude" ? eclipses.longitudeNote : undefined}
                    aria-description={column.id === "date" ? eclipses.calendarNote : column.id === "longitude" ? eclipses.longitudeNote : undefined}
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
                    onFocusDate={focusEclipseDate}
                    onShowSarosSeries={showSarosSeries}
                    onActionError={setActionError}
                    dateConvention={dateConvention}
                    rowHeight={rowHeight}
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
    </RetainedPaneShell>
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
  onShowSarosSeries,
  onActionError,
  dateConvention,
  rowHeight,
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
  onShowSarosSeries: (selection: {
    kind: "solar" | "lunar";
    series: number;
    member: number;
    eventJd: number;
  }) => void;
  onActionError: (message: string | null) => void;
  dateConvention: DateConvention;
  rowHeight: number;
}) {
  const precision = useTablePrecision();
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
  const sarosSeries = typeof meta.sarosSeries === "number" ? meta.sarosSeries : null;
  const sarosKind = meta.kind === "solar" || meta.kind === "lunar" ? meta.kind : null;
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
  const eventDateLabel = typeof meta.eventDateLabel === "string" ? meta.eventDateLabel : null;
  const eventTimeLabel = eventDatetime?.split("T")[1]?.slice(0, 8);
  const opensAtLabel = eventDatetime ? `${chartMomentLabel}: ${eventDateLabel && eventTimeLabel
    ? `${eventDateLabel} ${eventTimeLabel}` : formatDateTimeLabel(eventDatetime, dateConvention)}` : null;
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
    <TimedChartContextMenu anglePrecision
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
          {sarosKind && sarosSeries != null && sarosMember != null && eventJd != null ? (
            <ContextMenuItem
              onClick={() => onShowSarosSeries({
                kind: sarosKind,
                series: sarosSeries,
                member: sarosMember,
                eventJd,
              })}
            >
              {t("eclipsesView.showSarosSeries")}
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem
            className="block text-balance"
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
        style={{ height: rowHeight }}
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
                  <CellView cell={cell} precision={precision} />
                </button>
              ) : (
                <CellView cell={cell} precision={precision} />
              )}
            </td>
          );
        })}
      </tr>
    </TimedChartContextMenu>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stitchEclipsePayload(
  current: GenericTablePayload,
  chunk: GenericTablePayload,
  direction: "before" | "after",
): { payload: GenericTablePayload; prependedCount: number } {
  const currentRows = current.rows.length === 1 && current.rows[0]?.id === "empty"
    ? []
    : current.rows;
  const chunkRows = chunk.rows.length === 1 && chunk.rows[0]?.id === "empty"
    ? []
    : chunk.rows;
  const seen = new Set(currentRows.map((row) => row.id));
  const freshRows = chunkRows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  const rows = direction === "before"
    ? [...freshRows, ...currentRows]
    : [...currentRows, ...freshRows];
  const currentCapabilities = asRecord(current.capabilities);
  const chunkCapabilities = asRecord(chunk.capabilities);
  const currentEclipses = asRecord(currentCapabilities.eclipses);
  const chunkEclipses = asRecord(chunkCapabilities.eclipses);
  const nextFrom = direction === "before"
    ? asDateTriple(chunkEclipses.from) ?? asDateTriple(currentEclipses.from)
    : asDateTriple(currentEclipses.from) ?? asDateTriple(chunkEclipses.from);
  const nextTo = direction === "after"
    ? asDateTriple(chunkEclipses.to) ?? asDateTriple(currentEclipses.to)
    : asDateTriple(currentEclipses.to) ?? asDateTriple(chunkEclipses.to);

  return {
    payload: {
      ...current,
      rows: rows.length ? rows : current.rows,
      capabilities: {
        ...currentCapabilities,
        eclipses: {
          ...currentEclipses,
          ...(nextFrom ? { from: nextFrom } : {}),
          ...(nextTo ? { to: nextTo } : {}),
        },
      },
    },
    prependedCount: direction === "before" ? freshRows.length : 0,
  };
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

function sameDateTriple(a: [number, number, number], b: [number, number, number]) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function formatRange(from: [number, number, number], to: [number, number, number], convention: DateConvention) {
  return `${formatDate(from, convention)} - ${formatDate(to, convention)}`;
}

function formatDate(values: [number, number, number], convention: DateConvention) {
  return formatAstronomicalDateTriple(values, convention);
}

function formatDateTimeLabel(value: string, convention: DateConvention) {
  const [date, time = ""] = value.split("T");
  const values = parseIsoDateTriple(date);
  return values ? `${formatDate(values, convention)} ${time.slice(0, 8)}`.trim() : value;
}

function useVirtualRows(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  rowCount: number,
  seedIndex: number,
  rowHeight: number,
  enabled: boolean,
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
    if (!enabled) return undefined;
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
    const measureSync = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      measureNow();
    };
    scroller.addEventListener(ECLIPSE_VIRTUAL_SCROLL_SYNC_EVENT, measureSync);
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    resizeObserver?.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", scheduleMeasure);
      scroller.removeEventListener(ECLIPSE_VIRTUAL_SCROLL_SYNC_EVENT, measureSync);
      resizeObserver?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, measureNow, rowCount, scrollerRef]);

  return React.useMemo(() => {
    return eclipseVirtualWindow(rowCount, seedIndex, rowHeight, viewport, enabled);
  }, [enabled, rowCount, rowHeight, seedIndex, viewport]);
}

type EclipseVirtualViewport = Readonly<{
  scrollTop: number;
  height: number;
  headerHeight: number;
}>;

export function eclipseVirtualWindow(
  rowCount: number,
  seedIndex: number,
  rowHeight: number,
  viewport: EclipseVirtualViewport,
  enabled: boolean,
) {
  if (rowCount <= 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
  }
  if (!enabled) {
    return { startIndex: 0, endIndex: rowCount, paddingTop: 0, paddingBottom: 0 };
  }
  const seededStart = seedIndex >= 0
    ? Math.max(0, Math.min(rowCount - 1, seedIndex))
    : 0;
  const bodyViewportHeight = Math.max(0, viewport.height - viewport.headerHeight);
  const visibleCount = Math.max(1, Math.ceil(bodyViewportHeight / rowHeight));
  const bodyScrollTop = Math.max(0, viewport.scrollTop - viewport.headerHeight);
  const rawVisibleStart = viewport.height > 0
    ? Math.floor(bodyScrollTop / rowHeight)
    : seededStart;
  const maxVisibleStart = Math.max(0, rowCount - visibleCount);
  const visibleStart = Math.max(0, Math.min(rawVisibleStart, maxVisibleStart));
  const startIndex = Math.min(
    rowCount,
    Math.max(0, visibleStart - VIRTUAL_OVERSCAN_ROWS),
  );
  const endIndex = Math.max(
    startIndex,
    Math.min(rowCount, visibleStart + visibleCount + VIRTUAL_OVERSCAN_ROWS),
  );
  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * rowHeight,
    paddingBottom: (rowCount - endIndex) * rowHeight,
  };
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

function clampScrollTop(
  container: HTMLElement,
  scrollTop: number,
  rowCount: number,
  rowHeight: number,
): number {
  const maxTop = Math.max(
    0,
    getTableHeaderHeight(container) + rowCount * rowHeight - container.clientHeight,
  );
  const desiredTop = Math.max(0, Math.min(maxTop, scrollTop));
  container.scrollTop = desiredTop;
  container.dispatchEvent(new Event(ECLIPSE_VIRTUAL_SCROLL_SYNC_EVENT));
  return desiredTop;
}

export function scrollEclipseRowToAnchor(
  container: HTMLElement,
  rowCount: number,
  rowIndex: number,
  rowHeight: number,
): boolean {
  if (rowCount <= 0 || rowIndex < 0 || container.clientHeight <= 0) return false;
  const targetIndex = Math.max(0, Math.min(rowCount - 1, rowIndex));
  const headerHeight = getTableHeaderHeight(container);
  const viewportHeight = Math.max(rowHeight, container.clientHeight - headerHeight);
  const targetTop =
    targetIndex * rowHeight -
    viewportHeight * ECLIPSE_FOCUS_ANCHOR + rowHeight / 2;
  const desiredTop = clampScrollTop(container, targetTop, rowCount, rowHeight);
  return Math.abs(container.scrollTop - desiredTop) <= 2;
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
  rowHeight: number,
) {
  if (!anchor) return;
  const row = container.querySelector<HTMLElement>(`tbody tr[data-eclipse-row="${CSS.escape(anchor.rowId)}"]`);
  if (row) {
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const delta = rowRect.top - containerRect.top - anchor.offsetTop;
    clampScrollTop(container, container.scrollTop + delta, rows.length, rowHeight);
    return;
  }
  const rowIndex = rows.findIndex((candidate) => candidate.id === anchor.rowId);
  const nextIndex = rowIndex >= 0 ? rowIndex : anchor.rowIndex;
  clampScrollTop(
    container,
    getTableHeaderHeight(container) + Math.max(0, nextIndex) * rowHeight - anchor.offsetTop,
    rows.length,
    rowHeight,
  );
}

function restorePrependedScroll(
  container: HTMLElement,
  plan: Extract<ScrollPlan, { kind: "preservePrepend" }>,
  rows: readonly GenericTableRow[],
  rowHeight: number,
) {
  const sourceRowHeight = plan.rowHeight > 0 ? plan.rowHeight : rowHeight;
  const headerHeight = getTableHeaderHeight(container);
  // Use the live position at commit time. A trackpad burst can continue while
  // the adjacent chunk is loading; restoring the request-start position fights
  // that newer input and produces a visible snap.
  const currentScrollTop = container.scrollTop;
  const bodyScrollTop = Math.max(0, currentScrollTop - headerHeight);
  const anchorUnits = bodyScrollTop / sourceRowHeight;
  const translatedTop = currentScrollTop <= headerHeight
    ? currentScrollTop
    : headerHeight + anchorUnits * rowHeight;
  clampScrollTop(
    container,
    translatedTop + Math.max(0, plan.count) * rowHeight,
    rows.length,
    rowHeight,
  );
}
