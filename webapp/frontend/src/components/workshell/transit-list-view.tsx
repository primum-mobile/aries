// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { Clipboard, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import {
  cancelTransitSearch,
  exportSearchRows,
  fetchTransitSearchContextCatalog,
  fetchTransitSearchProgress,
  openDirectionsTimedChart,
  startTransitSearchContext,
  type TimedChartAction,
  type TransitSearchCatalog,
  type TransitSearchObject,
  type TransitSearchObjectSegment,
  type TransitSearchProgressResult,
  type TransitSearchRow,
} from "@/lib/daemon/client";
import { eventListBodyViewportHeight } from "@/lib/event-list-time";
import {
  LIST_BUTTON_PROPS,
  LIST_PANE_CLASSES,
  LIST_ROLE_CLASSES,
  LIST_ROW_CLASSES,
  useFixedRowHeightAnchor,
  useListRowHeight,
} from "@/lib/list-tokens";
import {
  getCachedListPayload,
  rememberListPayload,
} from "@/lib/table/payload-cache";
import { useT, type TFunc } from "@/lib/i18n/i18n";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { cn } from "@/lib/utils";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { beginWorkspaceSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";

import { ListCalendarStepper, ListSegmentedControl } from "./list-controls";
import {
  buildStableRowKeys,
  stitchRows,
  useEdgeExtend,
  visiblePrependedRowCount,
  type AgeSpan,
} from "./stitched-list-harness";

type TransitDirectionMode = "direct" | "converse" | "both";
type TransitColumnKey = "prom" | "aspect" | "sig" | "date" | "time" | "dc";
type SearchDisplay = TransitSearchRow["promDisplay"];
type TransitSpan = AgeSpan;
type TransitPromittorItem = {
  id: string | null;
  label: string;
  glyph: string;
  marker: string;
  group: string;
};

type TransitMonthStore = {
  rows: TransitSearchRow[];
  coverage: TransitSpan;
  islandNonce: number;
  summary: string;
  truncated: boolean;
};

type TransitListViewState = {
  direction: TransitDirectionMode;
  selectedPromittorId: string | null;
  requestFocusDatetime: string;
  visibleMonthIndex: number;
};

const TRANSIT_COLUMNS: readonly TransitColumnKey[] = ["prom", "aspect", "sig", "date", "time", "dc"];
const TRANSIT_ROW_CLASS = LIST_ROW_CLASSES.flagged;
const TRANSIT_STITCHED_CACHE = "transits:stitched-list";
const TRANSIT_STITCH_CACHE_MAX_ROWS = 12000;
const TRANSIT_STITCH_PREFETCH_MONTHS = 2;
const TRANSIT_POINT_MIN_BACKGROUND_ROWS = 16;
const TRANSIT_MIN_MONTH_INDEX = 0;
const TRANSIT_MAX_MONTH_INDEX = 9999 * 12 + 11;
const TRANSIT_FOCUS_ANCHOR = 0.25;
const VIRTUAL_OVERSCAN_ROWS = 12;
const VIRTUAL_SCROLL_SYNC_EVENT = "aries:virtual-scroll-sync";
const TRANSIT_PROGRESS_POLL_MS = 180;
const TRANSIT_LIST_FALLBACK_ASPECTS = ["conjunction", "sextile", "square", "trine", "opposition"];
const transitListViewStateCache = new Map<string, TransitListViewState>();

function listCacheKey(parts: Record<string, unknown>): string {
  return JSON.stringify(parts);
}

export function TransitListView({
  documentId,
  focusDatetime,
  onClose,
}: {
  documentId: string;
  sourceName?: string;
  focusDatetime?: string | null;
  onClose?: () => void;
}) {
  const t = useT();
  const rowHeight = useListRowHeight("symbolic");
  const rowHeightRef = React.useRef(rowHeight);
  React.useLayoutEffect(() => {
    rowHeightRef.current = rowHeight;
  }, [rowHeight]);
  const [fallbackFocusDatetime] = React.useState(localWallclockIso);
  const effectiveFocusDatetime = focusDatetime ?? fallbackFocusDatetime;
  const directionOptions = React.useMemo(
    () =>
      [
        { value: "direct", label: t("tlview.directionDirect") },
        { value: "converse", label: t("tlview.directionConverse") },
        { value: "both", label: t("tlview.directionBoth") },
      ] as const,
    [t],
  );
  const cachedViewState = React.useMemo(
    () => transitListViewStateCache.get(documentId) ?? null,
    [documentId],
  );
  const initialRequestFocusDatetime = cachedViewState?.requestFocusDatetime ?? effectiveFocusDatetime;
  const effectiveFocusDatetimeRef = React.useRef(effectiveFocusDatetime);
  React.useEffect(() => {
    effectiveFocusDatetimeRef.current = effectiveFocusDatetime;
  }, [effectiveFocusDatetime]);

  const [direction, setDirection] = React.useState<TransitDirectionMode>(
    cachedViewState?.direction ?? "direct",
  );
  const [catalog, setCatalog] = React.useState<TransitSearchCatalog | null>(null);
  const [catalogOptionsSeq, setCatalogOptionsSeq] = React.useState(-1);
  const [selectedPromittorId, setSelectedPromittorId] = React.useState<string | null>(
    cachedViewState?.selectedPromittorId ?? null,
  );
  const [promittorDrawerOpen, setPromittorDrawerOpen] = React.useState(false);
  const [requestFocusDatetime, setRequestFocusDatetime] = React.useState(initialRequestFocusDatetime);
  const [island, setIsland] = React.useState<{ nonce: number; window: TransitSpan }>(() => ({
    nonce: 0,
    window: transitSeedWindowForFocus(initialRequestFocusDatetime),
  }));
  const [store, setStore] = React.useState<TransitMonthStore | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [visibleMonthIndex, setVisibleMonthIndex] = React.useState(() =>
    cachedViewState?.visibleMonthIndex ?? monthIndexForDate(initialRequestFocusDatetime),
  );
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const currentSessionRef = React.useRef<string | null>(null);
  const storeRef = React.useRef(store);
  const stitchKeyRef = React.useRef("");
  const worldSeqRef = React.useRef(0);
  const initialInFlightRef = React.useRef(false);
  const extendInFlightRef = React.useRef(false);
  const extendControllerRef = React.useRef<AbortController | null>(null);
  const extendCooldownUntilRef = React.useRef(0);
  const scrollPlanRef = React.useRef<{ kind: "prepend"; count: number } | null>(null);
  const selectedPromittorIdRef = React.useRef<string | null>(null);
  const pointFillDirectionRef = React.useRef<"previous" | "next">("previous");
  const optionsSeq = useTransitOptionsSeq();
  const directionRef = React.useRef(direction);
  const rowsRef = React.useRef<TransitSearchRow[]>([]);
  const visibleMonthIndexRef = React.useRef(visibleMonthIndex);
  const requestFocusDatetimeRef = React.useRef(requestFocusDatetime);
  const pendingMonthJumpRef = React.useRef<number | null>(null);
  const restoredCachedViewStateRef = React.useRef(Boolean(cachedViewState));
  const skipInitialFocusSyncRef = React.useRef(Boolean(cachedViewState));

  React.useEffect(() => {
    storeRef.current = store;
  }, [store]);
  React.useEffect(() => {
    selectedPromittorIdRef.current = selectedPromittorId;
  }, [selectedPromittorId]);
  React.useEffect(() => {
    directionRef.current = direction;
  }, [direction]);
  React.useEffect(() => {
    visibleMonthIndexRef.current = visibleMonthIndex;
  }, [visibleMonthIndex]);
  React.useEffect(() => {
    requestFocusDatetimeRef.current = requestFocusDatetime;
  }, [requestFocusDatetime]);

  const stitchKey = React.useMemo(
    () =>
      listCacheKey({
        documentId,
        direction,
        promittorId: selectedPromittorId ?? "all",
        optionsSeq,
        catalogOptionsSeq,
      }),
    [catalogOptionsSeq, direction, documentId, optionsSeq, selectedPromittorId],
  );
  React.useEffect(() => {
    stitchKeyRef.current = stitchKey;
  }, [stitchKey]);

  React.useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setError(null);
    });
    fetchTransitSearchContextCatalog({ documentId }, controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return;
        setCatalog(payload);
        setCatalogOptionsSeq(optionsSeq);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError((err as Error).message || t("tlview.loadFailed"));
      });
    return () => controller.abort();
  }, [documentId, optionsSeq, t]);

  React.useEffect(() => {
    if (restoredCachedViewStateRef.current) {
      restoredCachedViewStateRef.current = false;
      return;
    }
    queueMicrotask(() => {
      const focus = effectiveFocusDatetimeRef.current;
      pendingMonthJumpRef.current = null;
      setSelectedPromittorId(null);
      setPromittorDrawerOpen(false);
      setRequestFocusDatetime(focus);
      setIsland((prev) => ({
        nonce: prev.nonce + 1,
        window: transitSeedWindowForFocus(focus),
      }));
    });
  }, [optionsSeq]);

  React.useEffect(() => {
    if (skipInitialFocusSyncRef.current) {
      skipInitialFocusSyncRef.current = false;
      return;
    }
    queueMicrotask(() => {
      const focusMonth = monthIndexForDate(effectiveFocusDatetime);
      const current = storeRef.current;
      pendingMonthJumpRef.current = null;
      setRequestFocusDatetime((prev) => (prev === effectiveFocusDatetime ? prev : effectiveFocusDatetime));
      const desired = transitSeedWindowForMonth(focusMonth);
      if (current && monthSpanContainsSpan(current.coverage, desired)) return;
      setIsland((prev) => ({
        nonce: prev.nonce + 1,
        window: desired,
      }));
    });
  }, [effectiveFocusDatetime]);

  React.useEffect(() => {
    if (!catalog) return undefined;
    const worldSeq = worldSeqRef.current + 1;
    worldSeqRef.current = worldSeq;
    extendCooldownUntilRef.current = 0;
    extendInFlightRef.current = false;
    extendControllerRef.current?.abort();
    extendControllerRef.current = null;
    scrollPlanRef.current = null;
    cancelCurrentSearch(currentSessionRef);
    const controller = new AbortController();
    const cached = getCachedListPayload<TransitMonthStore>(TRANSIT_STITCHED_CACHE, stitchKey);
    if (stitchedTransitStoreCoversSpan(cached, island.window)) {
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
    fetchTransitChunk({
      catalog,
      documentId,
      direction,
      promittorId: selectedPromittorId,
      span: island.window,
      signal: controller.signal,
      sessionRef: currentSessionRef,
      onRows: (payload) => {
        if (controller.signal.aborted || worldSeqRef.current !== worldSeq || payload.rows.length === 0) return;
        const next: TransitMonthStore = {
          rows: payload.rows,
          coverage: island.window,
          islandNonce: island.nonce,
          summary: payload.summary || "No transits.",
          truncated: payload.truncated,
        };
        React.startTransition(() => setStore(next));
      },
    })
      .then((data) => {
        if (controller.signal.aborted || worldSeqRef.current !== worldSeq) return;
        const next: TransitMonthStore = {
          rows: data.rows,
          coverage: island.window,
          islandNonce: island.nonce,
          summary: data.summary,
          truncated: data.truncated,
        };
        React.startTransition(() => setStore(next));
        rememberTransitStitchStore(stitchKey, next);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        if (controller.signal.aborted || worldSeqRef.current !== worldSeq) return;
        setError((err as Error).message || t("tlview.loadFailed"));
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
      extendControllerRef.current?.abort();
      extendControllerRef.current = null;
      extendInFlightRef.current = false;
      cancelCurrentSearch(currentSessionRef);
    };
  }, [catalog, direction, documentId, island, selectedPromittorId, stitchKey, t]);

  const extendCoverage = React.useCallback(
    (loadDirection: "previous" | "next") => {
      const current = storeRef.current;
      if (!catalog || !current || extendInFlightRef.current || initialInFlightRef.current) return;
      if (Date.now() < extendCooldownUntilRef.current) return;
      let span: TransitSpan;
      if (loadDirection === "previous") {
        if (current.coverage.start <= TRANSIT_MIN_MONTH_INDEX) return;
        span = {
          start: Math.max(TRANSIT_MIN_MONTH_INDEX, current.coverage.start - 1),
          end: current.coverage.start,
        };
      } else {
        if (current.coverage.end > TRANSIT_MAX_MONTH_INDEX) return;
        span = {
          start: current.coverage.end,
          end: Math.min(TRANSIT_MAX_MONTH_INDEX + 1, current.coverage.end + 1),
        };
      }
      const worldSeq = worldSeqRef.current;
      const controller = new AbortController();
      extendInFlightRef.current = true;
      extendControllerRef.current = controller;
      fetchTransitChunk({
        catalog,
        documentId,
        direction,
        promittorId: selectedPromittorIdRef.current,
        span,
        signal: controller.signal,
        sessionRef: currentSessionRef,
      })
        .then((data) => {
          if (worldSeqRef.current !== worldSeq) return;
          const base = storeRef.current;
          if (!base) return;
          const { next, prependedCount } = stitchRows(
            base,
            data.rows,
            span,
            transitStitchRowKey,
          );
          const nextStore: TransitMonthStore = {
            ...next,
            summary: data.summary,
            truncated: base.truncated || data.truncated,
          };
          const activePromittorId = selectedPromittorIdRef.current;
          const visiblePrependedCount = visiblePrependedRowCount(
            next.rows,
            prependedCount,
            activePromittorId ? [activePromittorId] : null,
            (row) => row.promittorId,
          );
          if (visiblePrependedCount > 0) {
            scrollPlanRef.current = { kind: "prepend", count: visiblePrependedCount };
          }
          if (extendControllerRef.current === controller) {
            extendControllerRef.current = null;
            extendInFlightRef.current = false;
          }
          setStore(nextStore);
          rememberTransitStitchStore(stitchKeyRef.current, nextStore);
        })
        .catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          extendCooldownUntilRef.current = Date.now() + 4000;
          console.error("[transit-stitch-extend]", err);
        })
        .finally(() => {
          if (extendControllerRef.current === controller) {
            extendControllerRef.current = null;
            extendInFlightRef.current = false;
          }
        });
    },
    [catalog, direction, documentId],
  );

  React.useEffect(() => {
    if (!store) return;
    if (extendInFlightRef.current || initialInFlightRef.current) return;
    const desired = transitDesiredCoverageForMonth(visibleMonthIndex);
    if (store.coverage.start > desired.start) extendCoverage("previous");
    else if (store.coverage.end < desired.end) extendCoverage("next");
  }, [extendCoverage, store, visibleMonthIndex]);

  const sourceRows = React.useMemo(() => store?.rows ?? [], [store]);
  const rows = React.useMemo(
    () =>
      selectedPromittorId
        ? sourceRows.filter((row) => row.promittorId === selectedPromittorId)
        : sourceRows,
    [selectedPromittorId, sourceRows],
  );
  React.useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    return () => {
      const viewportFocus =
        viewportTransitFocusIso(
          rowsRef.current,
          scroller,
          visibleMonthIndexRef.current,
          rowHeightRef.current,
        ) || requestFocusDatetimeRef.current;
      transitListViewStateCache.set(documentId, {
        direction: directionRef.current,
        selectedPromittorId: selectedPromittorIdRef.current,
        requestFocusDatetime: viewportFocus,
        visibleMonthIndex: monthIndexForDate(viewportFocus),
      });
    };
  }, [documentId]);

  React.useEffect(() => {
    if (!selectedPromittorId || !store) return;
    if (extendInFlightRef.current || initialInFlightRef.current) return;
    const targetRows = Math.max(
      TRANSIT_POINT_MIN_BACKGROUND_ROWS,
      viewportTransitRowCount(scrollerRef.current, rowHeightRef.current) * 2,
    );
    if (rows.length >= targetRows) return;
    const canPrevious = store.coverage.start > TRANSIT_MIN_MONTH_INDEX;
    const canNext = store.coverage.end <= TRANSIT_MAX_MONTH_INDEX;
    if (!canPrevious && !canNext) return;
    const edge = transitScrollEdgeDirection(scrollerRef.current, rowHeightRef.current * 6);
    if (edge === "previous" && canPrevious) {
      extendCoverage("previous");
      return;
    }
    if (edge === "next" && canNext) {
      extendCoverage("next");
      return;
    }
    const preferred = pointFillDirectionRef.current;
    const loadDirection =
      preferred === "previous"
        ? canPrevious
          ? "previous"
          : "next"
        : canNext
          ? "next"
          : "previous";
    pointFillDirectionRef.current = loadDirection === "previous" ? "next" : "previous";
    extendCoverage(loadDirection);
  }, [extendCoverage, rows.length, selectedPromittorId, store]);
  const rowKeys = React.useMemo(() => buildStableRowKeys(rows, transitStitchRowKey), [rows]);
  const focusTargetMs = React.useMemo(
    () => resolveDateMs(requestFocusDatetime),
    [requestFocusDatetime],
  );
  const focusIndex = React.useMemo(
    () => nearestTransitDateIndex(rows, focusTargetMs),
    [focusTargetMs, rows],
  );
  useFixedRowHeightAnchor(scrollerRef, rows.length, rowHeight, {
    syncEvent: VIRTUAL_SCROLL_SYNC_EVENT,
  });

  useEdgeExtend({
    scrollerRef,
    rowCount: rows.length,
    thresholdPx: rowHeight * 6,
    canExtendBackward: (store?.coverage.start ?? TRANSIT_MIN_MONTH_INDEX) > TRANSIT_MIN_MONTH_INDEX,
    canExtendForward: (store?.coverage.end ?? TRANSIT_MAX_MONTH_INDEX + 1) <= TRANSIT_MAX_MONTH_INDEX,
    onExtend: extendCoverage,
  });

  React.useEffect(() => {
    if (!store) return;
    if (extendInFlightRef.current || initialInFlightRef.current) return;
    const edge = transitScrollEdgeDirection(scrollerRef.current, rowHeightRef.current * 6);
    if (edge === "previous" && store.coverage.start > TRANSIT_MIN_MONTH_INDEX) {
      extendCoverage("previous");
    } else if (edge === "next" && store.coverage.end <= TRANSIT_MAX_MONTH_INDEX) {
      extendCoverage("next");
    }
  }, [extendCoverage, rows.length, store]);

  const focusIndexRef = React.useRef(focusIndex);
  const rowCountRef = React.useRef(rows.length);
  React.useLayoutEffect(() => {
    focusIndexRef.current = focusIndex;
    rowCountRef.current = rows.length;
  });

  React.useLayoutEffect(() => {
    const plan = scrollPlanRef.current;
    if (!plan) return;
    const scroller = scrollerRef.current;
    if (!scroller || scroller.clientHeight <= 0) return;
    scrollPlanRef.current = null;
    scroller.scrollTop += plan.count * rowHeight;
    scroller.dispatchEvent(new Event(VIRTUAL_SCROLL_SYNC_EVENT));
  }, [rowHeight, store]);

  const focusSignature = `ms:${focusTargetMs}`;
  const islandSignature = store ? `${store.islandNonce}` : "empty";
  React.useLayoutEffect(() => {
    if (rowCountRef.current === 0) return undefined;
    scrollPlanRef.current = null;
    return scheduleFocusedTransitScroll(
      scrollerRef,
      focusIndexRef.current,
      rowCountRef.current,
      TRANSIT_FOCUS_ANCHOR,
      rowHeightRef.current,
    );
  }, [focusSignature, islandSignature, selectedPromittorId]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || rows.length === 0) return undefined;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const row = rows[visibleTransitMonthAnchorIndex(scroller, rows.length, rowHeight)];
      const month = monthIndexForTransitRow(row);
      if (month != null) {
        const pendingMonth = pendingMonthJumpRef.current;
        if (pendingMonth != null) {
          const current = storeRef.current;
          const pendingSpan = transitSeedWindowForMonth(pendingMonth);
          if (!current || !monthSpanContainsSpan(current.coverage, pendingSpan) || month !== pendingMonth) {
            return;
          }
          pendingMonthJumpRef.current = null;
        }
        setVisibleMonthIndex((prev) => (prev === month ? prev : month));
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    schedule();
    scroller.addEventListener("scroll", schedule, { passive: true });
    scroller.addEventListener(VIRTUAL_SCROLL_SYNC_EVENT, schedule);
    return () => {
      scroller.removeEventListener("scroll", schedule);
      scroller.removeEventListener(VIRTUAL_SCROLL_SYNC_EVENT, schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [rowHeight, rows]);

  const monthLabel = React.useMemo(
    () => formatMonthIndexLabel(visibleMonthIndex),
    [visibleMonthIndex],
  );
  const promittorItems = React.useMemo(() => transitPromittorItems(catalog, t), [catalog, t]);
  const selectedPromittorLabel = React.useMemo(
    () => transitPromittorLabel(promittorItems, selectedPromittorId, t),
    [promittorItems, selectedPromittorId, t],
  );
  const ensureSourceWindowForFocus = React.useCallback(
    (nextFocus: string, force = false) => {
      const desired = transitSeedWindowForFocus(nextFocus);
      const current = storeRef.current;
      if (!force && current && monthSpanContainsSpan(current.coverage, desired)) return;
      setIsland((prev) =>
        monthSpansEqual(prev.window, desired)
          ? prev
          : {
              nonce: prev.nonce + 1,
              window: desired,
            },
      );
    },
    [],
  );
  const changePromittor = React.useCallback(
    (promittorId: string | null) => {
      if (promittorId === selectedPromittorId) {
        setPromittorDrawerOpen(false);
        return;
      }
      const nextFocus = viewportTransitFocusIso(
        rows,
        scrollerRef.current,
        visibleMonthIndex,
        rowHeight,
      );
      const nextMonth = monthIndexForDate(nextFocus);
      pendingMonthJumpRef.current = null;
      visibleMonthIndexRef.current = nextMonth;
      requestFocusDatetimeRef.current = nextFocus;
      setVisibleMonthIndex(nextMonth);
      setRequestFocusDatetime(nextFocus);
      pointFillDirectionRef.current = "previous";
      setSelectedPromittorId(promittorId);
      ensureSourceWindowForFocus(nextFocus, true);
      setPromittorDrawerOpen(false);
    },
    [ensureSourceWindowForFocus, rowHeight, rows, selectedPromittorId, visibleMonthIndex],
  );
  const jumpByMonths = React.useCallback((delta: number) => {
    const nextMonth = clampMonthIndex((pendingMonthJumpRef.current ?? visibleMonthIndexRef.current) + delta);
    const nextFocus = monthSpanAnchorIso(transitSeedWindowForMonth(nextMonth));
    pendingMonthJumpRef.current = nextMonth;
    visibleMonthIndexRef.current = nextMonth;
    requestFocusDatetimeRef.current = nextFocus;
    setVisibleMonthIndex(nextMonth);
    setRequestFocusDatetime(nextFocus);
    ensureSourceWindowForFocus(nextFocus);
  }, [ensureSourceWindowForFocus]);
  const jumpToCurrent = React.useCallback(() => {
    const nextFocus = localWallclockIso();
    const nextMonth = monthIndexForDate(nextFocus);
    pendingMonthJumpRef.current = nextMonth;
    visibleMonthIndexRef.current = nextMonth;
    requestFocusDatetimeRef.current = nextFocus;
    setVisibleMonthIndex(nextMonth);
    setRequestFocusDatetime(nextFocus);
    ensureSourceWindowForFocus(nextFocus);
  }, [ensureSourceWindowForFocus]);
  const changeDirection = React.useCallback(
    (nextDirection: TransitDirectionMode) => {
      if (nextDirection === direction) return;
      const nextFocus = viewportTransitFocusIso(
        rows,
        scrollerRef.current,
        visibleMonthIndex,
        rowHeight,
      );
      const nextMonth = monthIndexForDate(nextFocus);
      pendingMonthJumpRef.current = null;
      visibleMonthIndexRef.current = nextMonth;
      requestFocusDatetimeRef.current = nextFocus;
      setVisibleMonthIndex(nextMonth);
      setRequestFocusDatetime(nextFocus);
      ensureSourceWindowForFocus(nextFocus, true);
      setDirection(nextDirection);
    },
    [direction, ensureSourceWindowForFocus, rowHeight, rows, visibleMonthIndex],
  );

  return (
    <div className={LIST_PANE_CLASSES.root}>
      <div className={LIST_PANE_CLASSES.compactHeader}>
        <div className={LIST_PANE_CLASSES.compactControlRow}>
          <ListSegmentedControl
            label={t("tlview.direction")}
            options={directionOptions}
            value={direction}
            onChange={changeDirection}
            labelPlacement="inline"
          />
          <Button
            type="button"
            {...LIST_BUTTON_PROPS.command}
            onClick={() => setPromittorDrawerOpen((open) => !open)}
          >
            {t("tlview.point")}: {selectedPromittorLabel}
          </Button>
          <ListCalendarStepper
            label={monthLabel}
            onJump={jumpByMonths}
            previousYearLabel={t("tlview.previousYear")}
            previousMonthLabel={t("tlview.previousMonth")}
            nextMonthLabel={t("tlview.nextMonth")}
            nextYearLabel={t("tlview.nextYear")}
          />
          <Button type="button" {...LIST_BUTTON_PROPS.command} onClick={jumpToCurrent}>
            {t("tlview.current")}
          </Button>
        </div>
        {onClose ? (
          <Button type="button" {...LIST_BUTTON_PROPS.icon} onClick={onClose} aria-label={t("tlview.closeTransits")}>
            <X className="size-3.5" />
          </Button>
        ) : null}
        {promittorDrawerOpen ? (
          <TransitPromittorDrawer
            items={promittorItems}
            activeId={selectedPromittorId ?? "all"}
            onSelect={changePromittor}
          />
        ) : null}
      </div>
      <div ref={scrollerRef} className={LIST_PANE_CLASSES.scroller}>
        {error ? (
          <div className={LIST_PANE_CLASSES.error}>{error}</div>
        ) : (
          <table className={cn("aries-list caption-bottom border-collapse", LIST_ROLE_CLASSES.symbolic)}>
            <VirtualizedTableRows
              rows={rows}
              loading={loading}
              emptyLabel={t("tlview.noTransits")}
              colSpan={TRANSIT_COLUMNS.length}
              scrollerRef={scrollerRef}
              initialIndex={focusIndex}
              rowHeight={rowHeight}
              renderRow={(row, index) => (
                <TransitRow
                  key={rowKeys[index] ?? `${row.key}:${index}`}
                  row={row}
                  documentId={documentId}
                  focused={index === focusIndex}
                  rowHeight={rowHeight}
                />
              )}
            />
          </table>
        )}
      </div>
    </div>
  );
}

function TransitRow({
  row,
  documentId,
  focused,
  rowHeight,
}: {
  row: TransitSearchRow;
  documentId: string;
  focused?: boolean;
  rowHeight: number;
}) {
  const dc = row.technique === "converse_transits" ? "C" : "D";
  return (
    <TransitRowContextMenu row={row} documentId={documentId}>
      <TableRow
        className={TRANSIT_ROW_CLASS}
        data-initial-focus={focused || undefined}
        style={{ height: rowHeight }}
      >
        <TableCell className="text-center">
          <TransitObjectCell
            glyph={row.promittorGlyph}
            label={row.promittorLabel}
            marker={row.promittorMarker}
            segments={row.promittorSegments}
            display={row.promDisplay}
          />
        </TableCell>
        <TableCell className="text-center text-muted-foreground">
          <TransitAspectCell row={row} />
        </TableCell>
        <TableCell className="text-center">
          <TransitObjectCell
            glyph={row.significatorGlyph}
            label={row.significatorLabel}
            marker={row.significatorMarker}
            segments={row.significatorSegments}
            display={row.sigDisplay}
          />
        </TableCell>
        <TableCell className="text-center tabular-nums">
          <TransitDateButton row={row} documentId={documentId} />
        </TableCell>
        <TableCell className="text-right tabular-nums" title={row.displayTime}>
          {shortDisplayTime(row)}
        </TableCell>
        <TableCell className="text-center text-muted-foreground [text-overflow:clip]">{dc}</TableCell>
      </TableRow>
    </TransitRowContextMenu>
  );
}

function TransitAspectCell({ row }: { row: TransitSearchRow }) {
  const aspectColor = semanticChartColor(
    stringValue(row.metadata.aspect_color_role),
    stringValue(row.metadata.aspect_color),
  );
  if (row.isSignChange) {
    return <span className="aries-search-ingress-arrow" aria-hidden="true">→</span>;
  }
  if (row.aspectGlyph) {
    return <Glyph ch={row.aspectGlyph} title={row.aspectLabel} className="aries-search-glyph" color={aspectColor} />;
  }
  return <span>{row.aspectLabel}</span>;
}

function TransitObjectCell({
  glyph,
  label,
  marker,
  segments,
  display,
}: {
  glyph: string;
  label: string;
  marker?: string;
  segments?: TransitSearchObjectSegment[];
  display: SearchDisplay;
}) {
  const hasSegments = Boolean(segments?.length);
  const color = semanticChartColor(
    stringValue(display.glyph_color_role),
    stringValue(display.glyph_color_css),
  );
  const motionMarker = stringValue(display.motion_marker);
  const suffix = label.match(/\s\(([^)]+)\)$/)?.[1] ?? "";
  const stateMarker = suffix || motionMarker;
  const baseLabel = suffix ? label.replace(/\s\([^)]+\)$/, "") : label;
  return (
    <span className="inline-flex items-center justify-center gap-1" title={label}>
      {hasSegments ? (
        <SegmentToken segments={segments ?? []} color={color} />
      ) : glyph ? (
        <Glyph ch={glyph} className="aries-search-glyph shrink-0" color={color} />
      ) : (
        <span>{baseLabel}</span>
      )}
      {marker ? <span className="aries-search-marker shrink-0 text-muted-foreground">{marker}</span> : null}
      {stateMarker ? <span className="aries-search-marker shrink-0 text-muted-foreground">{stateMarker}</span> : null}
    </span>
  );
}

function SegmentToken({
  segments,
  color,
}: {
  segments: TransitSearchObjectSegment[];
  color?: string;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {segments.map((segment, index) =>
        segment.kind === "planet" || segment.kind === "glyph" ? (
          <Glyph key={`${index}:${segment.text}`} ch={segment.text} className="aries-search-glyph shrink-0" color={color} />
        ) : (
          <span key={`${index}:${segment.text}`} className="shrink-0">
            {segment.text}
          </span>
        ),
      )}
    </span>
  );
}

function TransitDateButton({
  row,
  documentId,
}: {
  row: TransitSearchRow;
  documentId: string;
}) {
  const applyTimedChartOpenResult = useWorkspaceStore((s) => s.applyTimedChartOpenResult);
  const showRadix = useWorkspaceStore((s) => s.timedChartShowRadix);
  const disabled = !row.canOpenChart || !row.openDatetime;
  const openTransit = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;
      const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
      void openDirectionsTimedChart(documentId, "transits", row.openDatetime, null, null, null, showRadix)
        .then((result) => applyTimedChartOpenResult(result))
        .catch((err) => console.error("[transit-list-open]", err))
        .finally(finishSnapshotCommand);
    },
    [applyTimedChartOpenResult, disabled, documentId, row.openDatetime, showRadix],
  );
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={openTransit}
      className="inline-flex justify-end tabular-nums underline-offset-2 hover:text-primary hover:underline disabled:pointer-events-none"
    >
      {row.displayDate}
    </button>
  );
}

function TransitRowContextMenu({
  row,
  documentId,
  children,
}: {
  row: TransitSearchRow;
  documentId: string;
  children: React.ReactElement;
}) {
  const t = useT();
  const applyTimedChartOpenResult = useWorkspaceStore((s) => s.applyTimedChartOpenResult);
  const showRadix = useWorkspaceStore((s) => s.timedChartShowRadix);
  const openChart = React.useCallback(
    (action: TimedChartAction) => {
      if (!row.canOpenChart || !row.openDatetime) return;
      const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
      void openDirectionsTimedChart(documentId, action, row.openDatetime, null, null, null, showRadix)
        .then((result) => applyTimedChartOpenResult(result))
        .catch((err) => console.error("[transit-list-timed-chart]", err))
        .finally(finishSnapshotCommand);
    },
    [applyTimedChartOpenResult, documentId, row, showRadix],
  );
  const copyTime = React.useCallback(() => {
    void exportSearchRows([row], "clipboard")
      .then((result) => copyText(result.text))
      .catch((err) => console.error("[transit-list-copy]", err));
  }, [row]);
  const timedDisabled = !row.canOpenChart || !row.openDatetime;
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-64">
        <ContextMenuItem disabled={timedDisabled} onClick={() => openChart("solar")}>
          {t("tlview.openSolarRevolution")}
        </ContextMenuItem>
        <ContextMenuItem disabled={timedDisabled} onClick={() => openChart("transits")}>
          {t("tlview.openAsTransit")}
        </ContextMenuItem>
        <ContextMenuItem disabled={timedDisabled} onClick={() => openChart("chart")}>
          {t("tlview.openAsChart")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!row.canExportTime} onClick={copyTime}>
          <Clipboard className="size-3.5" />
          {t("tlview.copyTimeDate")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TransitPromittorDrawer({
  items,
  activeId,
  onSelect,
}: {
  items: TransitPromittorItem[];
  activeId: string;
  onSelect: (id: string | null) => void;
}) {
  const t = useT();
  const groups = React.useMemo(() => {
    const ordered: Array<{ group: string; items: TransitPromittorItem[] }> = [];
    for (const item of items) {
      let bucket = ordered.find((entry) => entry.group === item.group);
      if (!bucket) {
        bucket = { group: item.group, items: [] };
        ordered.push(bucket);
      }
      bucket.items.push(item);
    }
    return ordered;
  }, [items]);

  if (!items.length) {
    return (
      <div className="w-full border-t border-border/70 pt-2">
        <Button type="button" size="xs" variant="ghost" disabled>
          {t("tlview.loading")}
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-h-48 overflow-auto border-t border-border/70 pt-2">
      <div className="flex flex-col gap-2">
        {groups.map((group) => (
          <div key={group.group} className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="mr-1 min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">
              {group.group}
            </span>
            {group.items.map((item) => {
              const id = item.id ?? "all";
              const selected = id === activeId;
              return (
                <Button
                  key={id}
                  type="button"
                  size="xs"
                  variant={selected ? "default" : "outline"}
                  onClick={() => onSelect(item.id)}
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
  const t = useT();
  const virtual = useVirtualRows(scrollerRef, rows.length, initialIndex, rowHeight);
  const visibleRows = rows.slice(virtual.startIndex, virtual.endIndex);

  if (rows.length === 0 && !loading) {
    return (
      <TableBody data-rendered-row-count={0} data-total-row-count={0}>
        <TableRow>
          <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
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
      {rows.length === 0 && loading ? (
        <TableRow>
          <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
            {t("tlview.computing")}
          </TableCell>
        </TableRow>
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
      height: eventListBodyViewportHeight(scroller),
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
    const measureSync = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      measureNow();
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

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const maxTop = Math.max(
      0,
      rowCount * rowHeight - eventListBodyViewportHeight(scroller),
    );
    if (scroller.scrollTop <= maxTop) return;
    scroller.scrollTop = maxTop;
    scroller.dispatchEvent(new Event(VIRTUAL_SCROLL_SYNC_EVENT));
    measureNow();
  }, [measureNow, rowCount, rowHeight, scrollerRef]);

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
    const maxVisibleStart = Math.max(0, rowCount - visibleCount);
    const visibleStart = Math.max(
      0,
      Math.min(rawVisibleStart, maxVisibleStart),
    );
    const startIndex = Math.min(
      rowCount,
      Math.max(0, visibleStart - VIRTUAL_OVERSCAN_ROWS),
    );
    const endIndex = Math.max(
      startIndex,
      Math.min(
        rowCount,
        visibleStart + visibleCount + VIRTUAL_OVERSCAN_ROWS,
      ),
    );
    return {
      startIndex,
      endIndex,
      paddingTop: startIndex * rowHeight,
      paddingBottom: (rowCount - endIndex) * rowHeight,
    };
  }, [rowCount, rowHeight, seedIndex, viewport.height, viewport.scrollTop]);
}

function Glyph({
  ch,
  className,
  title,
  color,
}: {
  ch: string;
  className?: string;
  title?: string;
  color?: string;
}) {
  return (
    <span
      style={{ fontFamily: "'AriesMorinus'", color: color || undefined }}
      className={className}
      title={title}
      aria-hidden={!title}
    >
      {ch}
    </span>
  );
}

async function fetchTransitChunk({
  catalog,
  documentId,
  direction,
  promittorId,
  span,
  signal,
  sessionRef,
  onRows,
}: {
  catalog: TransitSearchCatalog;
  documentId: string;
  direction: TransitDirectionMode;
  promittorId?: string | null;
  span: TransitSpan;
  signal: AbortSignal;
  sessionRef: React.MutableRefObject<string | null>;
  onRows?: (payload: TransitSearchProgressResult) => void;
}): Promise<{
  rows: TransitSearchRow[];
  summary: string;
  truncated: boolean;
}> {
  const previousSessionId = sessionRef.current;
  if (previousSessionId) {
    sessionRef.current = null;
    void cancelTransitSearch(previousSessionId).catch(() => undefined);
  }
  const range = monthSpanRange(span);
  const request = {
    documentId,
    fromDate: range.fromDate,
    toDate: range.toDate,
    techniques: directionTechniques(direction),
    promittorIds: promittorId ? [promittorId] : transitListPromittorIds(catalog),
    significatorIds: transitListSignificatorIds(catalog),
    aspects: transitListAspectIds(catalog),
    includeSignChanges: false,
    partFilter: "",
    limit: catalog.defaults.limit,
    persistSettings: false,
  };
  const initial = await startTransitSearchContext(request, signal);
  let current = initial;
  sessionRef.current = current.complete ? null : current.sessionId;
  onRows?.(current);
  while (!signal.aborted && !current.complete) {
    await delay(TRANSIT_PROGRESS_POLL_MS, signal);
    current = await fetchTransitSearchProgress(current.sessionId, signal);
    sessionRef.current = current.complete ? null : current.sessionId;
    onRows?.(current);
  }
  if (current.error) {
    throw new Error(current.error);
  }
  return {
    rows: current.rows,
    summary: current.summary || "No transits.",
    truncated: current.truncated,
  };
}

function useTransitOptionsSeq(): number {
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastOptionsChange);
  const [seq, setSeq] = React.useState(0);

  React.useEffect(() => {
    if (!lastOptionsChange) return;
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

function cancelCurrentSearch(sessionRef: React.MutableRefObject<string | null>): void {
  const sessionId = sessionRef.current;
  if (!sessionId) return;
  sessionRef.current = null;
  void cancelTransitSearch(sessionId).catch(() => undefined);
}

function rememberTransitStitchStore(key: string, store: TransitMonthStore): void {
  if (store.rows.length > TRANSIT_STITCH_CACHE_MAX_ROWS) return;
  rememberListPayload(TRANSIT_STITCHED_CACHE, key, store);
}

function stitchedTransitStoreCoversSpan(
  store: TransitMonthStore | null,
  span: TransitSpan,
): boolean {
  if (!store) return false;
  return monthSpanContainsSpan(store.coverage, span);
}

function transitStitchRowKey(row: TransitSearchRow): string {
  return [
    row.technique,
    row.openDatetime,
    row.promittorId,
    row.aspect,
    row.significatorId,
    row.isSignChange ? 1 : 0,
    row.notes,
  ].join("\u0000");
}

function transitPromittorItems(
  catalog: TransitSearchCatalog | null,
  t: TFunc,
): TransitPromittorItem[] {
  if (!catalog) return [];
  const objects = new Map<string, TransitSearchObject>();
  for (const obj of catalog.objects) objects.set(obj.id, obj);
  const ids = catalog.presets.promittors.planets.length
    ? catalog.presets.promittors.planets
    : catalog.defaults.promittorIds;
  const items: TransitPromittorItem[] = [
    { id: null, label: t("tlview.all"), glyph: "", marker: "", group: t("tlview.point") },
  ];
  for (const id of ids) {
    const obj = objects.get(id);
    if (!obj) continue;
    items.push({
      id,
      label: obj.label,
      glyph: obj.glyph,
      marker: obj.displayMarker,
      group: t("tlview.planets"),
    });
  }
  return items;
}

function transitPromittorLabel(
  items: readonly TransitPromittorItem[],
  selectedId: string | null,
  t: TFunc,
): string {
  if (!selectedId) return t("tlview.all");
  return items.find((item) => item.id === selectedId)?.label ?? t("tlview.all");
}

function transitListPromittorIds(catalog: TransitSearchCatalog): string[] {
  return nonEmptyIds(catalog.presets.promittors.standard, catalog.defaults.promittorIds);
}

function transitListSignificatorIds(catalog: TransitSearchCatalog): string[] {
  return nonEmptyIds(catalog.presets.significators.standard, catalog.defaults.significatorIds);
}

function transitListAspectIds(catalog: TransitSearchCatalog): string[] {
  return nonEmptyIds(catalog.presets.aspects.major, TRANSIT_LIST_FALLBACK_ASPECTS);
}

function nonEmptyIds(primary: readonly string[], fallback: readonly string[]): string[] {
  return primary.length ? [...primary] : [...fallback];
}

function transitDesiredCoverageForMonth(monthIndex: number): TransitSpan {
  const base = transitSeedWindowForMonth(monthIndex);
  return {
    start: Math.max(TRANSIT_MIN_MONTH_INDEX, base.start - TRANSIT_STITCH_PREFETCH_MONTHS),
    end: Math.min(TRANSIT_MAX_MONTH_INDEX + 1, base.end + TRANSIT_STITCH_PREFETCH_MONTHS),
  };
}

function transitSeedWindowForFocus(value?: string | null, sourceMonths = 1): TransitSpan {
  return transitSeedWindowForMonth(monthIndexForDate(value), sourceMonths);
}

function transitSeedWindowForMonth(monthIndex: number, sourceMonths = 1): TransitSpan {
  const count = Math.max(1, Math.trunc(sourceMonths));
  const anchor = clampMonthIndex(monthIndex);
  if (count === 1) {
    return {
      start: anchor,
      end: Math.min(TRANSIT_MAX_MONTH_INDEX + 1, anchor + 1),
    };
  }
  const maxEnd = TRANSIT_MAX_MONTH_INDEX + 1;
  const rawStart = anchor - Math.floor(count / 2);
  const start = Math.max(
    TRANSIT_MIN_MONTH_INDEX,
    Math.min(rawStart, Math.max(TRANSIT_MIN_MONTH_INDEX, maxEnd - count)),
  );
  return {
    start,
    end: Math.min(maxEnd, start + count),
  };
}

function monthSpanContainsSpan(outer: TransitSpan | null | undefined, inner: TransitSpan): boolean {
  return !!outer && outer.start <= inner.start && outer.end >= inner.end;
}

function monthSpansEqual(left: TransitSpan, right: TransitSpan): boolean {
  return left.start === right.start && left.end === right.end;
}

function monthSpanAnchorIso(span: TransitSpan): string {
  const date = dateFromMonthIndex(span.start);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01T12:00:00`;
}

function formatMonthIndexLabel(monthIndex: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    dateFromMonthIndex(monthIndex),
  );
}

function monthIndexForDate(value?: string | null): number {
  const parsed = value ? new Date(value) : new Date();
  const base = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  return clampMonthIndex(base.getFullYear() * 12 + base.getMonth());
}

function clampMonthIndex(index: number): number {
  return Math.max(TRANSIT_MIN_MONTH_INDEX, Math.min(TRANSIT_MAX_MONTH_INDEX, Math.trunc(index)));
}

function monthSpanRange(span: TransitSpan): { fromDate: string; toDate: string } {
  const first = dateFromMonthIndex(span.start);
  const last = dateFromMonthIndex(Math.max(span.start, span.end - 1));
  const toDate = new Date(last.getFullYear(), last.getMonth() + 1, 0, 12, 0, 0, 0);
  return { fromDate: isoDate(first), toDate: isoDate(toDate) };
}

function dateFromMonthIndex(index: number): Date {
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  return new Date(year, month, 1, 12, 0, 0, 0);
}

function isoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function directionTechniques(direction: TransitDirectionMode): string[] {
  if (direction === "direct") return ["transits"];
  if (direction === "converse") return ["converse_transits"];
  return ["transits", "converse_transits"];
}

function resolveDateMs(value?: string | null): number {
  const ms = parseDateMs(value);
  return ms ?? Date.now();
}

function parseDateMs(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isFinite(ms) ? ms : null;
}

function transitRowDateMs(row: TransitSearchRow): number | null {
  return (
    parseDateMs(row.displayDatetime) ??
    parseDateMs(row.eventDate ? `${row.eventDate}T${row.eventTime || "12:00:00"}` : null) ??
    parseDateMs(row.eventDate) ??
    parseDateMs(row.openDatetime) ??
    parseDateMs(`${row.displayDate}T${shortDisplayTime(row)}`)
  );
}

function transitRowEventIso(row: TransitSearchRow | undefined): string | null {
  if (!row) return null;
  if (row.displayDatetime) return row.displayDatetime;
  if (row.eventDate) {
    return `${row.eventDate}T${row.eventTime || "12:00:00"}`;
  }
  return row.openDatetime || null;
}

function monthIndexForTransitRow(row: TransitSearchRow | undefined): number | null {
  if (!row) return null;
  const ms = transitRowDateMs(row);
  if (ms == null) return null;
  const date = new Date(ms);
  return monthIndexForDate(date.toISOString());
}

function viewportTransitRowCount(scroller: HTMLDivElement | null, rowHeight: number): number {
  const height = eventListBodyViewportHeight(scroller, rowHeight * 12);
  return Math.max(1, Math.ceil(height / rowHeight));
}

function transitScrollEdgeDirection(
  scroller: HTMLDivElement | null,
  thresholdPx: number,
): "previous" | "next" | null {
  if (!scroller || scroller.clientHeight <= 0) return null;
  const maxTop = scroller.scrollHeight - scroller.clientHeight;
  if (maxTop <= 0) return null;
  if (scroller.scrollTop <= thresholdPx) return "previous";
  if (maxTop - scroller.scrollTop <= thresholdPx) return "next";
  return null;
}

function visibleTransitMonthAnchorIndex(
  scroller: HTMLDivElement,
  rowCount: number,
  rowHeight: number,
): number {
  if (rowCount <= 0) return 0;
  const anchorTop =
    scroller.scrollTop + eventListBodyViewportHeight(scroller) * TRANSIT_FOCUS_ANCHOR;
  return Math.max(0, Math.min(rowCount - 1, Math.floor(anchorTop / rowHeight)));
}

function viewportTransitFocusIso(
  rows: readonly TransitSearchRow[],
  scroller: HTMLDivElement | null,
  fallbackMonthIndex: number,
  rowHeight: number,
): string {
  if (scroller && rows.length > 0) {
    const index = visibleTransitMonthAnchorIndex(scroller, rows.length, rowHeight);
    const iso = transitRowEventIso(rows[index]);
    if (iso) return iso;
  }
  return monthSpanAnchorIso(transitSeedWindowForMonth(fallbackMonthIndex));
}

function nearestTransitDateIndex(rows: readonly TransitSearchRow[], targetMs: number): number {
  if (!rows.length) return -1;
  let bestIndex = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    const ms = transitRowDateMs(row);
    if (ms == null) return;
    const delta = Math.abs(ms - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function scrollFocusedTransitRow(
  scroller: HTMLDivElement | null,
  rowCount: number,
  anchorRatio: number,
  targetIndex: number,
  rowHeight: number,
): boolean {
  const viewportHeight = eventListBodyViewportHeight(scroller);
  if (!scroller || rowCount <= 0 || targetIndex < 0 || viewportHeight <= 0) {
    return false;
  }
  const rowTop = targetIndex * rowHeight;
  const targetTop = rowTop - viewportHeight * anchorRatio + rowHeight / 2;
  const maxTop = Math.max(0, rowCount * rowHeight - viewportHeight);
  const nextTop = Math.max(0, Math.min(maxTop, targetTop));
  if (Math.abs(scroller.scrollTop - nextTop) <= 1) return true;
  scroller.scrollTop = nextTop;
  scroller.dispatchEvent(new Event(VIRTUAL_SCROLL_SYNC_EVENT));
  return true;
}

function scheduleFocusedTransitScroll(
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
    if (scrollFocusedTransitRow(scroller, rowCount, anchorRatio, rowIndex, rowHeight)) return;
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

function shortDisplayTime(row: TransitSearchRow): string {
  const match = row.displayTime.match(/^(\d{1,2}:\d{2})/);
  return match?.[1] ?? row.displayTime;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function localWallclockIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  document.execCommand("copy");
  area.remove();
}
