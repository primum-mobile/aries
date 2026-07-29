// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { flushSync } from "react-dom";

import { Calendar, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  fetchSynodicCycles,
  type SynodicCyclePayload,
  type SynodicCycleRow,
  type SynodicLunarItem,
  type SynodicPlanetItem,
} from "@/lib/daemon/client";
import { eventListBodyViewportHeight } from "@/lib/event-list-time";
import {
  LIST_BUTTON_PROPS,
  LIST_PANE_CLASSES,
  LIST_ROW_CLASSES,
  useFixedRowHeightAnchor,
  useListRowHeight,
} from "@/lib/list-tokens";
import {
  getCachedListPayload,
  rememberListPayload,
} from "@/lib/table/payload-cache";
import { useT } from "@/lib/i18n/i18n";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { cn } from "@/lib/utils";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";

import { DateTransitLink, TimedChartContextMenu } from "./directions-view";
import { ListCalendarStepper, ListToggleDrawer } from "./list-controls";
import {
  SidebarListBody,
  SidebarListCell,
  SidebarListRow,
  SidebarListSpacerRow,
  SidebarListTable,
} from "./sidebar-list-table";
import {
  buildStableRowKeys,
  filterRetainedRows,
  stitchRows,
  useEdgeExtend,
  visiblePrependedRowCount,
  type AgeSpan,
} from "./stitched-list-harness";

type SynodicSpan = AgeSpan;

type SynodicMonthStore = {
  rows: SynodicCycleRow[];
  coverage: SynodicSpan;
  islandNonce: number;
  summary: string;
  truncated: boolean;
  planetItems: SynodicPlanetItem[];
  lunarItems: SynodicLunarItem[];
  currentDatetime: string;
  birthDatetime: string;
  optionsSeq: number;
};

type SynodicListViewState = {
  requestFocusDatetime: string;
  visibleMonthIndex: number;
  activeIngressPlanetIds: number[] | null;
  activeSynodicPlanetIds: number[] | null;
  activeLunarCycleIds: string[] | null;
};

const SYNODIC_ROW_CLASS = LIST_ROW_CLASSES.flagged;
const SYNODIC_STITCHED_CACHE = "synodic:stitched-list";
const SYNODIC_STITCH_CACHE_MAX_ROWS = 12000;
const SYNODIC_STITCH_PREFETCH_MONTHS = 2;
const SYNODIC_STITCH_CHUNK_MONTHS = 6;
const SYNODIC_FILTER_MIN_BACKGROUND_ROWS = 8;
const SYNODIC_MIN_MONTH_INDEX = 0;
const SYNODIC_MAX_MONTH_INDEX = 9999 * 12 + 11;
const SYNODIC_FOCUS_ANCHOR = 0.25;
const SYNODIC_SEED_MONTHS = 5;
const VIRTUAL_OVERSCAN_ROWS = 24;
const VIRTUAL_SCROLL_SYNC_EVENT = "aries:virtual-scroll-sync";
const synodicListViewStateCache = new Map<string, SynodicListViewState>();

type SynodicFilterGroup = "ingress" | "synodic" | "lunar";

function listCacheKey(parts: Record<string, unknown>): string {
  return JSON.stringify(parts);
}

export function SynodicCycleListView({
  documentId,
  focusDatetime,
  onClose,
}: {
  documentId: string;
  parentDocumentId?: string | null;
  sourceName?: string | null;
  focusDatetime?: string | null;
  onClose?: () => void;
}) {
  const t = useT();
  const rowHeight = useListRowHeight("symbolic");
  const rowHeightRef = React.useRef(rowHeight);
  React.useLayoutEffect(() => {
    rowHeightRef.current = rowHeight;
  }, [rowHeight]);
  const optionsSeq = useSynodicOptionsSeq();
  const cachedViewState = React.useMemo(
    () => synodicListViewStateCache.get(documentId) ?? null,
    [documentId],
  );
  const initialFocusDatetime = focusDatetime ?? cachedViewState?.requestFocusDatetime ?? localWallclockIso();
  const [requestFocusDatetime, setRequestFocusDatetime] = React.useState(
    initialFocusDatetime,
  );
  const [visibleMonthIndex, setVisibleMonthIndex] = React.useState(
    cachedViewState?.visibleMonthIndex ?? monthIndexForDate(initialFocusDatetime),
  );
  const [activeIngressPlanetIds, setActiveIngressPlanetIds] = React.useState<number[] | null>(
    cachedViewState?.activeIngressPlanetIds ?? null,
  );
  const [activeSynodicPlanetIds, setActiveSynodicPlanetIds] = React.useState<number[] | null>(
    cachedViewState?.activeSynodicPlanetIds ?? null,
  );
  const [activeLunarCycleIds, setActiveLunarCycleIds] = React.useState<string[] | null>(
    cachedViewState?.activeLunarCycleIds ?? null,
  );
  const [ingressDrawerOpen, setIngressDrawerOpen] = React.useState(false);
  const [synodicDrawerOpen, setSynodicDrawerOpen] = React.useState(false);
  const [lunarDrawerOpen, setLunarDrawerOpen] = React.useState(false);
  const [island, setIsland] = React.useState<{
    nonce: number;
    window: SynodicSpan | null;
    bypassCache: boolean;
  }>(() => ({
    nonce: 0,
    bypassCache: false,
    window: synodicSeedWindowForFocus(initialFocusDatetime, SYNODIC_SEED_MONTHS),
  }));
  const [store, setStore] = React.useState<SynodicMonthStore | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const storeRef = React.useRef<SynodicMonthStore | null>(null);
  const activeIngressPlanetIdsRef = React.useRef<number[] | null>(activeIngressPlanetIds);
  const activeSynodicPlanetIdsRef = React.useRef<number[] | null>(activeSynodicPlanetIds);
  const activeLunarCycleIdsRef = React.useRef<string[] | null>(activeLunarCycleIds);
  const visibleMonthIndexRef = React.useRef(visibleMonthIndex);
  const requestFocusDatetimeRef = React.useRef(requestFocusDatetime);
  const rowsRef = React.useRef<SynodicCycleRow[]>([]);
  const worldSeqRef = React.useRef(0);
  const initialInFlightRef = React.useRef(false);
  const extendInFlightRef = React.useRef(false);
  const extendControllerRef = React.useRef<AbortController | null>(null);
  const scrollPlanRef = React.useRef<{ kind: "prepend"; count: number } | null>(null);
  const pendingMonthJumpRef = React.useRef<number | null>(null);
  const pendingReplacementFocusRef = React.useRef<string | null>(null);
  const filterFillDirectionRef = React.useRef<"previous" | "next">("previous");
  const filterAnchorRef = React.useRef<string | null>(null);
  const stitchKeyRef = React.useRef("");
  const skipInitialFocusSyncRef = React.useRef(Boolean(cachedViewState && !focusDatetime));

  React.useEffect(() => {
    storeRef.current = store;
  }, [store]);
  React.useEffect(() => {
    activeIngressPlanetIdsRef.current = activeIngressPlanetIds;
  }, [activeIngressPlanetIds]);
  React.useEffect(() => {
    activeSynodicPlanetIdsRef.current = activeSynodicPlanetIds;
  }, [activeSynodicPlanetIds]);
  React.useEffect(() => {
    activeLunarCycleIdsRef.current = activeLunarCycleIds;
  }, [activeLunarCycleIds]);
  React.useEffect(() => {
    visibleMonthIndexRef.current = visibleMonthIndex;
  }, [visibleMonthIndex]);
  React.useEffect(() => {
    requestFocusDatetimeRef.current = requestFocusDatetime;
  }, [requestFocusDatetime]);

  const activeFilterKey = React.useMemo(
    () => [
      activeIngressPlanetIds ? activeIngressPlanetIds.join(",") : "ingress:default",
      activeSynodicPlanetIds ? activeSynodicPlanetIds.join(",") : "synodic:default",
      activeLunarCycleIds ? activeLunarCycleIds.join(",") : "lunar:default",
    ].join("|"),
    [activeIngressPlanetIds, activeLunarCycleIds, activeSynodicPlanetIds],
  );
  const stitchKey = React.useMemo(
    () => listCacheKey({ documentId, optionsSeq }),
    [documentId, optionsSeq],
  );
  React.useEffect(() => {
    stitchKeyRef.current = stitchKey;
  }, [stitchKey]);

  React.useEffect(() => {
    const retainedStore = storeRef.current;
    const refreshingOptions = retainedStore != null && retainedStore.optionsSeq !== optionsSeq;
    const retainedFocus = refreshingOptions
      ? viewportSynodicFocusIso(
          rowsRef.current,
          scrollerRef.current,
          visibleMonthIndexRef.current,
          rowHeightRef.current,
        )
      : null;
    const requestedWindow = retainedFocus
      ? synodicSeedWindowForFocus(retainedFocus, SYNODIC_SEED_MONTHS)
      : island.window;
    const replacementNonce = refreshingOptions
      ? (retainedStore?.islandNonce ?? island.nonce) + 1
      : island.nonce;
    if (retainedFocus) {
      const retainedMonth = monthIndexForDate(retainedFocus);
      pendingMonthJumpRef.current = null;
      requestFocusDatetimeRef.current = retainedFocus;
      visibleMonthIndexRef.current = retainedMonth;
    }
    const worldSeq = worldSeqRef.current + 1;
    worldSeqRef.current = worldSeq;
    extendInFlightRef.current = false;
    extendControllerRef.current?.abort();
    extendControllerRef.current = null;
    scrollPlanRef.current = null;
    const controller = new AbortController();
    const cached = getCachedListPayload<SynodicMonthStore>(SYNODIC_STITCHED_CACHE, stitchKey);
    if (
      !island.bypassCache &&
      !refreshingOptions &&
      requestedWindow &&
      cached?.optionsSeq === optionsSeq &&
      stitchedSynodicStoreCoversSpan(cached, requestedWindow)
    ) {
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
      if (retainedFocus) {
        const retainedMonth = monthIndexForDate(retainedFocus);
        setRequestFocusDatetime(retainedFocus);
        setVisibleMonthIndex(retainedMonth);
      }
    });
    fetchSynodicChunk({
      documentId,
      span: requestedWindow,
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted || worldSeqRef.current !== worldSeq) return;
        const span = monthSpanFromPayload(data);
        const next: SynodicMonthStore = {
          rows: data.rows,
          coverage: span,
          islandNonce: replacementNonce,
          summary: data.summary,
          truncated: data.truncated,
          planetItems: data.meta.planetItems,
          lunarItems: data.meta.lunarItems,
          currentDatetime: data.meta.currentDatetime,
          birthDatetime: data.meta.birthDatetime,
          optionsSeq,
        };
        if (activeIngressPlanetIdsRef.current == null) {
          setActiveIngressPlanetIds(
            data.meta.activePlanetIds.filter((planetId) =>
              data.meta.planetItems.some(
                (item) =>
                  item.id === planetId &&
                  supportsSynodicFilterGroup(item, "ingress") &&
                  item.objectId !== "planet:moon",
              ),
            ),
          );
        }
        if (activeSynodicPlanetIdsRef.current == null) {
          setActiveSynodicPlanetIds(
            data.meta.activePlanetIds.filter((planetId) =>
              data.meta.planetItems.some(
                (item) =>
                  item.id === planetId &&
                  supportsSynodicFilterGroup(item, "synodic"),
              ),
            ),
          );
        }
        if (activeLunarCycleIdsRef.current == null) {
          setActiveLunarCycleIds(data.meta.activeLunarCycleIds);
        }
        if (requestedWindow == null) {
          const focus = data.meta.focusDatetime || monthSpanAnchorIso(span);
          const month = monthIndexForDate(focus);
          requestFocusDatetimeRef.current = focus;
          visibleMonthIndexRef.current = month;
          setRequestFocusDatetime(focus);
          setVisibleMonthIndex(month);
        }
        const replacementFocus = pendingReplacementFocusRef.current;
        if (replacementFocus) {
          const replacementMonth = monthIndexForDate(replacementFocus);
          const active = activeSynodicFilterKeys(
            data.meta.planetItems,
            data.meta.lunarItems,
            activeIngressPlanetIdsRef.current,
            activeSynodicPlanetIdsRef.current,
            activeLunarCycleIdsRef.current,
          );
          const replacementRows = filterRetainedRows(next.rows, active, synodicRowFilterKey);
          const replacementIndex = nearestSynodicDateIndex(
            replacementRows,
            resolveDateMs(replacementFocus),
          );
          pendingReplacementFocusRef.current = null;
          pendingMonthJumpRef.current = replacementMonth;
          requestFocusDatetimeRef.current = replacementFocus;
          visibleMonthIndexRef.current = replacementMonth;
          storeRef.current = next;
          flushSync(() => {
            setRequestFocusDatetime(replacementFocus);
            setVisibleMonthIndex(replacementMonth);
            setStore(next);
          });
          if (
            scrollFocusedSynodicRow(
              scrollerRef.current,
              replacementRows.length,
              SYNODIC_FOCUS_ANCHOR,
              replacementIndex,
              rowHeightRef.current,
            )
          ) {
            flushSync(() => {
              scrollerRef.current?.dispatchEvent(new Event(VIRTUAL_SCROLL_SYNC_EVENT));
            });
          }
        } else {
          React.startTransition(() => setStore(next));
        }
        rememberSynodicStitchStore(stitchKey, next);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        if (controller.signal.aborted || worldSeqRef.current !== worldSeq) return;
        pendingReplacementFocusRef.current = null;
        setError((err as Error).message || t("synodic.loadFailed"));
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
    };
  }, [documentId, island, optionsSeq, stitchKey, t]);

  const extendCoverage = React.useCallback(
    (loadDirection: "previous" | "next") => {
      const current = storeRef.current;
      if (!current || extendInFlightRef.current || initialInFlightRef.current) return;
      let span: SynodicSpan;
      if (loadDirection === "previous") {
        if (current.coverage.start <= SYNODIC_MIN_MONTH_INDEX) return;
        span = {
          start: Math.max(
            SYNODIC_MIN_MONTH_INDEX,
            current.coverage.start - SYNODIC_STITCH_CHUNK_MONTHS,
          ),
          end: current.coverage.start,
        };
      } else {
        if (current.coverage.end > SYNODIC_MAX_MONTH_INDEX) return;
        span = {
          start: current.coverage.end,
          end: Math.min(
            SYNODIC_MAX_MONTH_INDEX + 1,
            current.coverage.end + SYNODIC_STITCH_CHUNK_MONTHS,
          ),
        };
      }
      const worldSeq = worldSeqRef.current;
      const controller = new AbortController();
      extendInFlightRef.current = true;
      extendControllerRef.current = controller;
      fetchSynodicChunk({
        documentId,
        span,
        signal: controller.signal,
      })
        .then((data) => {
          if (worldSeqRef.current !== worldSeq) return;
          const base = storeRef.current;
          if (!base) return;
          const { next, prependedCount } = stitchRows(
            base,
            data.rows,
            span,
            synodicStitchRowKey,
          );
          const nextStore: SynodicMonthStore = {
            ...next,
            summary: data.summary,
            truncated: base.truncated || data.truncated,
            planetItems: data.meta.planetItems,
            lunarItems: data.meta.lunarItems,
            currentDatetime: data.meta.currentDatetime,
            birthDatetime: data.meta.birthDatetime,
            optionsSeq: base.optionsSeq,
          };
          const active = activeSynodicFilterKeys(
            data.meta.planetItems,
            data.meta.lunarItems,
            activeIngressPlanetIdsRef.current,
            activeSynodicPlanetIdsRef.current,
            activeLunarCycleIdsRef.current,
          );
          const visiblePrependedCount = visiblePrependedRowCount(
            next.rows,
            prependedCount,
            active,
            synodicRowFilterKey,
          );
          if (visiblePrependedCount > 0) {
            scrollPlanRef.current = { kind: "prepend", count: visiblePrependedCount };
          }
          if (extendControllerRef.current === controller) {
            extendControllerRef.current = null;
            extendInFlightRef.current = false;
          }
          setStore(nextStore);
          rememberSynodicStitchStore(stitchKeyRef.current, nextStore);
        })
        .catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          console.error("[synodic-stitch-extend]", err);
        })
        .finally(() => {
          if (extendControllerRef.current === controller) {
            extendControllerRef.current = null;
            extendInFlightRef.current = false;
          }
        });
    },
    [documentId],
  );

  React.useEffect(() => {
    if (!store) return;
    if (extendInFlightRef.current || initialInFlightRef.current) return;
    const desired = synodicDesiredCoverageForMonth(visibleMonthIndex);
    if (store.coverage.start > desired.start) extendCoverage("previous");
    else if (store.coverage.end < desired.end) extendCoverage("next");
  }, [extendCoverage, store, visibleMonthIndex]);

  React.useEffect(() => {
    if (!focusDatetime) return;
    if (skipInitialFocusSyncRef.current) {
      skipInitialFocusSyncRef.current = false;
      return;
    }
    queueMicrotask(() => {
      const focusMonth = monthIndexForDate(focusDatetime);
      const desired = synodicSeedWindowForMonth(focusMonth, SYNODIC_SEED_MONTHS);
      pendingMonthJumpRef.current = null;
      requestFocusDatetimeRef.current = focusDatetime;
      visibleMonthIndexRef.current = focusMonth;
      setRequestFocusDatetime((prev) => (prev === focusDatetime ? prev : focusDatetime));
      setVisibleMonthIndex((prev) => (prev === focusMonth ? prev : focusMonth));
      const current = storeRef.current;
      if (current && monthSpanContainsSpan(current.coverage, desired)) return;
      setIsland((prev) => ({
        nonce: prev.nonce + 1,
        window: desired,
        bypassCache: false,
      }));
    });
  }, [focusDatetime]);

  const sourceRows = React.useMemo(() => store?.rows ?? [], [store]);
  const planetItems = React.useMemo(() => store?.planetItems ?? [], [store]);
  const lunarItems = React.useMemo(() => store?.lunarItems ?? [], [store]);
  const ingressPlanetItems = React.useMemo(
    () => planetItems.filter((item) => supportsSynodicFilterGroup(item, "ingress")),
    [planetItems],
  );
  const synodicPlanetItems = React.useMemo(
    () => planetItems.filter((item) => supportsSynodicFilterGroup(item, "synodic")),
    [planetItems],
  );
  const activeFilterKeys = React.useMemo(
    () => activeSynodicFilterKeys(
      planetItems,
      lunarItems,
      activeIngressPlanetIds,
      activeSynodicPlanetIds,
      activeLunarCycleIds,
    ),
    [
      activeIngressPlanetIds,
      activeLunarCycleIds,
      activeSynodicPlanetIds,
      lunarItems,
      planetItems,
    ],
  );
  const rows = React.useMemo(
    () => filterRetainedRows(sourceRows, activeFilterKeys, synodicRowFilterKey),
    [activeFilterKeys, sourceRows],
  );
  const filterActive =
    (activeIngressPlanetIds != null && activeIngressPlanetIds.length < ingressPlanetItems.length) ||
    (activeSynodicPlanetIds != null && activeSynodicPlanetIds.length < synodicPlanetItems.length) ||
    (activeLunarCycleIds != null && activeLunarCycleIds.length < lunarItems.length);
  React.useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  React.useEffect(() => {
    if (!filterActive || !store) return;
    if (extendInFlightRef.current || initialInFlightRef.current) return;
    const targetRows = Math.max(
      SYNODIC_FILTER_MIN_BACKGROUND_ROWS,
      viewportSynodicRowCount(scrollerRef.current, rowHeightRef.current),
    );
    if (rows.length >= targetRows) return;
    const canPrevious = store.coverage.start > SYNODIC_MIN_MONTH_INDEX;
    const canNext = store.coverage.end <= SYNODIC_MAX_MONTH_INDEX;
    if (!canPrevious && !canNext) return;
    const edge = synodicScrollEdgeDirection(scrollerRef.current, rowHeightRef.current * 6);
    if (edge === "previous" && canPrevious) {
      extendCoverage("previous");
      return;
    }
    if (edge === "next" && canNext) {
      extendCoverage("next");
      return;
    }
    const preferred = filterFillDirectionRef.current;
    const direction = preferred === "previous"
      ? canPrevious ? "previous" : "next"
      : canNext ? "next" : "previous";
    filterFillDirectionRef.current = direction === "previous" ? "next" : "previous";
    extendCoverage(direction);
  }, [extendCoverage, filterActive, rows.length, store]);
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    return () => {
      const viewportFocus =
        viewportSynodicFocusIso(
          rowsRef.current,
          scroller,
          visibleMonthIndexRef.current,
          rowHeightRef.current,
        ) ||
        requestFocusDatetimeRef.current;
      synodicListViewStateCache.set(documentId, {
        activeIngressPlanetIds: activeIngressPlanetIdsRef.current,
        activeSynodicPlanetIds: activeSynodicPlanetIdsRef.current,
        activeLunarCycleIds: activeLunarCycleIdsRef.current,
        requestFocusDatetime: viewportFocus,
        visibleMonthIndex: monthIndexForDate(viewportFocus),
      });
    };
  }, [documentId]);

  const rowKeys = React.useMemo(() => buildStableRowKeys(rows, synodicStitchRowKey), [rows]);
  const focusTargetMs = React.useMemo(() => resolveDateMs(requestFocusDatetime), [requestFocusDatetime]);
  const focusIndex = React.useMemo(() => nearestSynodicDateIndex(rows, focusTargetMs), [focusTargetMs, rows]);
  useFixedRowHeightAnchor(scrollerRef, rows.length, rowHeight, {
    syncEvent: VIRTUAL_SCROLL_SYNC_EVENT,
  });

  useEdgeExtend({
    scrollerRef,
    rowCount: rows.length,
    thresholdPx: rowHeight * 6,
    canExtendBackward: (store?.coverage.start ?? SYNODIC_MIN_MONTH_INDEX) > SYNODIC_MIN_MONTH_INDEX,
    canExtendForward: (store?.coverage.end ?? SYNODIC_MAX_MONTH_INDEX + 1) <= SYNODIC_MAX_MONTH_INDEX,
    onExtend: extendCoverage,
  });

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

  React.useLayoutEffect(() => {
    const anchor = filterAnchorRef.current;
    if (!anchor || rows.length === 0) return;
    const targetIndex = nearestSynodicDateIndex(rows, resolveDateMs(anchor));
    if (targetIndex < 0) return;
    if (
      scrollFocusedSynodicRow(
        scrollerRef.current,
        rows.length,
        SYNODIC_FOCUS_ANCHOR,
        targetIndex,
        rowHeight,
      )
    ) {
      filterAnchorRef.current = null;
    }
  }, [activeFilterKey, rowHeight, rows]);

  const focusSignature = `ms:${focusTargetMs}`;
  const islandSignature = store ? `${store.islandNonce}` : "empty";
  const rowsReadySignature = rows.length > 0 ? "ready" : "empty";
  React.useLayoutEffect(() => {
    if (rowCountRef.current === 0) return undefined;
    scrollPlanRef.current = null;
    return scheduleFocusedSynodicScroll(
      scrollerRef,
      focusIndexRef.current,
      rowCountRef.current,
      SYNODIC_FOCUS_ANCHOR,
      rowHeightRef.current,
    );
  }, [focusSignature, islandSignature, rowsReadySignature]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || rows.length === 0) return undefined;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const row = rows[visibleSynodicMonthAnchorIndex(scroller, rows.length, rowHeight)];
      const month = monthIndexForSynodicRow(row);
      if (month != null) {
        const pendingMonth = pendingMonthJumpRef.current;
        if (pendingMonth != null) {
          const current = storeRef.current;
          const pendingSpan = synodicSeedWindowForMonth(pendingMonth);
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

  const monthLabel = React.useMemo(() => formatMonthIndexLabel(visibleMonthIndex), [visibleMonthIndex]);
  const ingressActiveCount = activeIngressPlanetIds?.length ?? ingressPlanetItems.length;
  const synodicActiveCount = activeSynodicPlanetIds?.length ?? synodicPlanetItems.length;
  const lunarActiveCount = activeLunarCycleIds?.length ?? lunarItems.length;
  const ingressLabel = ingressActiveCount === ingressPlanetItems.length
    ? t("synodic.all")
    : `${ingressActiveCount}/${ingressPlanetItems.length}`;
  const synodicLabel = synodicActiveCount === synodicPlanetItems.length
    ? t("synodic.all")
    : `${synodicActiveCount}/${synodicPlanetItems.length}`;
  const lunarLabel = lunarActiveCount === lunarItems.length
    ? t("synodic.all")
    : `${lunarActiveCount}/${lunarItems.length}`;
  const ensureSourceWindowForFocus = React.useCallback((nextFocus: string, force = false) => {
    const desired = synodicSeedWindowForFocus(nextFocus, SYNODIC_SEED_MONTHS);
    const current = storeRef.current;
    if (!force && current && monthSpanContainsSpan(current.coverage, desired)) return;
    setIsland((prev) =>
      !force && monthSpansEqual(prev.window, desired)
        ? prev
        : {
            nonce: prev.nonce + 1,
            window: desired,
            bypassCache: force,
          },
    );
  }, []);

  const jumpByMonths = React.useCallback((delta: number) => {
    const nextMonth = clampMonthIndex((pendingMonthJumpRef.current ?? visibleMonthIndexRef.current) + delta);
    const nextFocus = monthSpanAnchorIso(synodicSeedWindowForMonth(nextMonth));
    pendingMonthJumpRef.current = nextMonth;
    visibleMonthIndexRef.current = nextMonth;
    requestFocusDatetimeRef.current = nextFocus;
    setVisibleMonthIndex(nextMonth);
    setRequestFocusDatetime(nextFocus);
    ensureSourceWindowForFocus(nextFocus);
  }, [ensureSourceWindowForFocus]);

  const jumpToViewportTarget = React.useCallback((nextFocus: string) => {
    const nextMonth = monthIndexForDate(nextFocus);
    pendingReplacementFocusRef.current = nextFocus;
    pendingMonthJumpRef.current = nextMonth;
    ensureSourceWindowForFocus(nextFocus, true);
  }, [ensureSourceWindowForFocus]);

  const focusedOnBirth = sameIsoDate(requestFocusDatetime, store?.birthDatetime);
  const viewportToggleTarget = focusedOnBirth
    ? store?.currentDatetime
    : store?.birthDatetime;
  const viewportToggleLabel = focusedOnBirth
    ? t("listViewport.current")
    : t("listViewport.birth");
  const currentViewportLabel = t("listViewport.current");
  const birthViewportLabel = t("listViewport.birth");

  const prepareFilterChange = React.useCallback(() => {
    const nextFocus = viewportSynodicFocusIso(
      rows,
      scrollerRef.current,
      visibleMonthIndex,
      rowHeight,
    );
    filterAnchorRef.current = nextFocus;
    pendingMonthJumpRef.current = null;
    filterFillDirectionRef.current = "previous";
  }, [rowHeight, rows, visibleMonthIndex]);

  const togglePlanet = React.useCallback(
    (
      group: Exclude<SynodicFilterGroup, "lunar">,
      planetId: number,
      checked: boolean,
    ) => {
      prepareFilterChange();
      const items = group === "ingress" ? ingressPlanetItems : synodicPlanetItems;
      const setActiveIds = group === "ingress" ? setActiveIngressPlanetIds : setActiveSynodicPlanetIds;
      const activeIdsRef = group === "ingress" ? activeIngressPlanetIdsRef : activeSynodicPlanetIdsRef;
      setActiveIds((prev) => {
        const base = prev ?? items.map((item) => item.id);
        const next = checked
          ? Array.from(new Set([...base, planetId]))
          : base.filter((id) => id !== planetId);
        const sorted = sortPlanetIds(next, items);
        activeIdsRef.current = sorted;
        return sorted;
      });
    },
    [ingressPlanetItems, prepareFilterChange, synodicPlanetItems],
  );
  const setPlanetGroupSelection = React.useCallback(
    (
      group: Exclude<SynodicFilterGroup, "lunar">,
      checked: boolean,
    ) => {
      prepareFilterChange();
      const items = group === "ingress" ? ingressPlanetItems : synodicPlanetItems;
      const setActiveIds = group === "ingress" ? setActiveIngressPlanetIds : setActiveSynodicPlanetIds;
      const activeIdsRef = group === "ingress" ? activeIngressPlanetIdsRef : activeSynodicPlanetIdsRef;
      const next = checked ? items.map((item) => item.id) : [];
      activeIdsRef.current = next;
      setActiveIds(next);
    },
    [ingressPlanetItems, prepareFilterChange, synodicPlanetItems],
  );
  const toggleLunarCycle = React.useCallback(
    (cycleId: string, checked: boolean) => {
      prepareFilterChange();
      setActiveLunarCycleIds((prev) => {
        const base = prev ?? lunarItems.map((item) => item.id);
        const next = checked
          ? Array.from(new Set([...base, cycleId]))
          : base.filter((id) => id !== cycleId);
        const sorted = sortLunarCycleIds(next, lunarItems);
        activeLunarCycleIdsRef.current = sorted;
        return sorted;
      });
    },
    [lunarItems, prepareFilterChange],
  );
  const setLunarCycleSelection = React.useCallback(
    (checked: boolean) => {
      prepareFilterChange();
      const next = checked ? lunarItems.map((item) => item.id) : [];
      activeLunarCycleIdsRef.current = next;
      setActiveLunarCycleIds(next);
    },
    [lunarItems, prepareFilterChange],
  );

  return (
    <div className={cn("font-morinus-text", LIST_PANE_CLASSES.root)}>
      <div className={LIST_PANE_CLASSES.standardHeader}>
        <div className={LIST_PANE_CLASSES.titleRow}>
          <div className={LIST_PANE_CLASSES.titleLeading}>
            {onClose ? (
              <Button
                type="button"
                {...LIST_BUTTON_PROPS.icon}
                onClick={onClose}
                aria-label={t("synodic.close")}
              >
                <X className="size-3.5" />
              </Button>
            ) : null}
            <h2 className={LIST_PANE_CLASSES.title}>{t("table.synodic_cycles")}</h2>
          </div>
        </div>
        <div className={LIST_PANE_CLASSES.controlRow}>
          <Button
            type="button"
            {...LIST_BUTTON_PROPS.command}
            onClick={() => {
              setIngressDrawerOpen((open) => !open);
              setSynodicDrawerOpen(false);
              setLunarDrawerOpen(false);
            }}
            aria-expanded={ingressDrawerOpen}
          >
            {t("synodic.ingresses")}: {ingressLabel}
          </Button>
          <Button
            type="button"
            {...LIST_BUTTON_PROPS.command}
            onClick={() => {
              setSynodicDrawerOpen((open) => !open);
              setIngressDrawerOpen(false);
              setLunarDrawerOpen(false);
            }}
            aria-expanded={synodicDrawerOpen}
          >
            {t("synodic.synodics")}: {synodicLabel}
          </Button>
          <Button
            type="button"
            {...LIST_BUTTON_PROPS.command}
            onClick={() => {
              setLunarDrawerOpen((open) => !open);
              setIngressDrawerOpen(false);
              setSynodicDrawerOpen(false);
            }}
            aria-expanded={lunarDrawerOpen}
          >
            {t("synodic.lunar")}: {lunarLabel}
          </Button>
        </div>
        <div className={LIST_PANE_CLASSES.controlRow}>
          <ListCalendarStepper
            label={monthLabel}
            onJump={jumpByMonths}
            previousYearLabel={t("synodic.previousYear")}
            previousMonthLabel={t("synodic.previousMonth")}
            nextMonthLabel={t("synodic.nextMonth")}
            nextYearLabel={t("synodic.nextYear")}
          />
          <Button
            type="button"
            {...LIST_BUTTON_PROPS.command}
            onClick={() => {
              if (viewportToggleTarget) jumpToViewportTarget(viewportToggleTarget);
            }}
            disabled={!viewportToggleTarget}
            title={t("listViewport.switchCurrentBirth")}
          >
            <Calendar className="size-[var(--aries-control-icon-size)]" />
            <span className="grid">
              <span aria-hidden="true" className="invisible col-start-1 row-start-1">{currentViewportLabel}</span>
              <span aria-hidden="true" className="invisible col-start-1 row-start-1">{birthViewportLabel}</span>
              <span className="col-start-1 row-start-1">{viewportToggleLabel}</span>
            </span>
          </Button>
        </div>
        {ingressDrawerOpen ? (
          <ListToggleDrawer
            label={t("synodic.ingresses")}
            items={ingressPlanetItems}
            isActive={(item) =>
              (activeIngressPlanetIds ?? ingressPlanetItems.map((planet) => planet.id)).includes(item.id)
            }
            onToggle={(item, active) => togglePlanet("ingress", item.id, active)}
            deselectAllLabel={t("listFilters.deselectAll")}
            selectAllLabel={t("listFilters.selectAll")}
            onDeselectAll={() => setPlanetGroupSelection("ingress", false)}
            onSelectAll={() => setPlanetGroupSelection("ingress", true)}
          />
        ) : null}
        {synodicDrawerOpen ? (
          <ListToggleDrawer
            label={t("synodic.synodics")}
            items={synodicPlanetItems}
            isActive={(item) =>
              (activeSynodicPlanetIds ?? synodicPlanetItems.map((planet) => planet.id)).includes(item.id)
            }
            onToggle={(item, active) => togglePlanet("synodic", item.id, active)}
            deselectAllLabel={t("listFilters.deselectAll")}
            selectAllLabel={t("listFilters.selectAll")}
            onDeselectAll={() => setPlanetGroupSelection("synodic", false)}
            onSelectAll={() => setPlanetGroupSelection("synodic", true)}
          />
        ) : null}
        {lunarDrawerOpen ? (
          <ListToggleDrawer
            label={t("synodic.lunar")}
            items={lunarItems}
            isActive={(item) =>
              (activeLunarCycleIds ?? lunarItems.map((cycle) => cycle.id)).includes(item.id)
            }
            onToggle={(item, active) => toggleLunarCycle(item.id, active)}
            deselectAllLabel={t("listFilters.deselectAll")}
            selectAllLabel={t("listFilters.selectAll")}
            onDeselectAll={() => setLunarCycleSelection(false)}
            onSelectAll={() => setLunarCycleSelection(true)}
          />
        ) : null}
      </div>
      {error && store ? (
        <div className={cn(LIST_PANE_CLASSES.error, "shrink-0 border-b border-border py-2")}>
          {error}
        </div>
      ) : null}
      <div ref={scrollerRef} className={LIST_PANE_CLASSES.scroller}>
        {error && !store ? (
          <div className={LIST_PANE_CLASSES.error}>{error}</div>
        ) : (
          <SidebarListTable profile="transit-cursor">
            <VirtualizedTableRows
              rows={rows}
              loading={loading}
              emptyLabel={t("synodic.noEvents")}
              colSpan={5}
              scrollerRef={scrollerRef}
              initialIndex={focusIndex}
              rowHeight={rowHeight}
              renderRow={(row, index) => (
                <SynodicRow
                  key={rowKeys[index] ?? `${row.key}:${index}`}
                  row={row}
                  documentId={documentId}
                  focused={index === focusIndex}
                  rowHeight={rowHeight}
                />
              )}
            />
          </SidebarListTable>
        )}
      </div>
    </div>
  );
}

function SynodicRow({
  row,
  documentId,
  focused,
  rowHeight,
}: {
  row: SynodicCycleRow;
  documentId: string;
  focused?: boolean;
  rowHeight: number;
}) {
  const t = useT();
  return (
    <TimedChartContextMenu
      documentId={documentId}
      eventDatetime={row.openDatetime}
      eventJd={row.eventJd}
      sessionLabel={row.sessionLabel}
    >
      <SidebarListRow
        className={SYNODIC_ROW_CLASS}
        data-initial-focus={focused || undefined}
        style={{ height: rowHeight }}
      >
        <SidebarListCell className="text-center">
          <span className="inline-flex items-center justify-center gap-1" title={row.planetLabel}>
            <Glyph
              ch={row.planetGlyph}
              className="aries-search-glyph shrink-0"
              color={semanticChartColor(row.planetColorRole, row.planetColor)}
            />
            {row.motionMarker ? (
              <span className="aries-search-marker shrink-0 text-muted-foreground">
                {row.motionMarker}
              </span>
            ) : null}
          </span>
        </SidebarListCell>
        <SidebarListCell
          className="text-center text-muted-foreground"
          title={row.eventType === "ingress" ? (row.motionMarker === "R" ? t("synodic.retrogradeIngress") : t("synodic.directIngress")) : row.eventLabel}
        >
          <span className="inline-flex items-center justify-center gap-1">
            {row.eventType === "eclipse" ? <EclipseMark /> : null}
            {row.eventLabel}
          </span>
        </SidebarListCell>
        <SidebarListCell className="text-center">
          <SynodicDetailCell row={row} />
        </SidebarListCell>
        <SidebarListCell className="text-center tabular-nums">
          <DateTransitLink
            documentId={documentId}
            eventDatetime={row.openDatetime}
            eventJd={row.eventJd}
            sessionLabel={row.sessionLabel}
          >
            {row.displayDate}
          </DateTransitLink>
        </SidebarListCell>
        <SidebarListCell className="aries-search-time-text text-right tabular-nums" title={row.displayTime}>
          {shortDisplayTime(row)}
        </SidebarListCell>
      </SidebarListRow>
    </TimedChartContextMenu>
  );
}

function EclipseMark() {
  return (
    <span className="relative inline-flex h-3 w-5 shrink-0" aria-hidden="true">
      <span className="absolute left-0 top-0 size-3 rounded-full border border-current" />
      <span className="absolute right-0 top-0 size-3 rounded-full border border-current" />
    </span>
  );
}

function SynodicDetailCell({ row }: { row: SynodicCycleRow }) {
  const detailLabel = row.detailLabel.trim() === row.eventLabel.trim() ? "" : row.detailLabel;
  const title = [detailLabel, row.sign?.label, row.longitudeText].filter(Boolean).join(" ");
  return (
    <span className="inline-flex items-center justify-center gap-1" title={title}>
      {row.sign ? (
        <Glyph
          ch={row.sign.glyph}
          className="aries-search-glyph shrink-0"
          color={semanticChartColor(row.sign.colorRole, row.sign.color)}
        />
      ) : null}
      {detailLabel ? <span>{detailLabel}</span> : null}
      {row.longitudeText ? (
        <span className="text-muted-foreground">{row.longitudeText}</span>
      ) : null}
    </span>
  );
}

function Glyph({
  ch,
  color,
  className,
}: {
  ch: string;
  color?: string | null;
  className?: string;
}) {
  if (!ch) return null;
  return (
    <span
      className={cn("inline-block leading-none", className)}
      style={{ fontFamily: "'AriesMorinus'", color: color || undefined }}
      aria-hidden="true"
    >
      {ch}
    </span>
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
      <SidebarListBody data-rendered-row-count={0} data-total-row-count={0}>
        <SidebarListRow>
          <SidebarListCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
            {emptyLabel}
          </SidebarListCell>
        </SidebarListRow>
      </SidebarListBody>
    );
  }

  return (
    <SidebarListBody data-rendered-row-count={visibleRows.length} data-total-row-count={rows.length}>
      {virtual.paddingTop > 0 ? <SidebarListSpacerRow colSpan={colSpan} height={virtual.paddingTop} /> : null}
      {visibleRows.map((row, offset) => renderRow(row, virtual.startIndex + offset))}
      {virtual.paddingBottom > 0 ? <SidebarListSpacerRow colSpan={colSpan} height={virtual.paddingBottom} /> : null}
      {rows.length === 0 && loading ? (
        <SidebarListRow>
          <SidebarListCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
            {t("synodic.computing")}
          </SidebarListCell>
        </SidebarListRow>
      ) : null}
    </SidebarListBody>
  );
}

function useVirtualRows(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  rowCount: number,
  seedIndex: number,
  rowHeight: number,
) {
  const [viewport, setViewport] = React.useState({ scrollTop: 0, height: 0 });
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      setViewport({
        scrollTop: scroller.scrollTop,
        height: eventListBodyViewportHeight(scroller),
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    const readSync = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      read();
    };
    read();
    scroller.addEventListener("scroll", schedule, { passive: true });
    scroller.addEventListener(VIRTUAL_SCROLL_SYNC_EVENT, readSync);
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", schedule);
      scroller.removeEventListener(VIRTUAL_SCROLL_SYNC_EVENT, readSync);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollerRef]);

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
  }, [rowCount, rowHeight, scrollerRef]);

  if (rowCount <= 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const visibleCount = Math.max(1, Math.ceil(viewport.height / rowHeight));
  const seededStart = seedIndex >= 0 ? Math.max(0, Math.min(rowCount - 1, seedIndex)) : 0;
  const rawVisibleStart =
    viewport.height > 0 ? Math.floor(viewport.scrollTop / rowHeight) : seededStart;
  const maxVisibleStart = Math.max(0, rowCount - visibleCount);
  const visibleStart = Math.max(0, Math.min(rawVisibleStart, maxVisibleStart));
  const startIndex = Math.min(rowCount, Math.max(0, visibleStart - VIRTUAL_OVERSCAN_ROWS));
  const endIndex = Math.max(
    startIndex,
    Math.min(rowCount, visibleStart + visibleCount + VIRTUAL_OVERSCAN_ROWS),
  );
  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * rowHeight,
    paddingBottom: Math.max(0, rowCount - endIndex) * rowHeight,
  };
}

function synodicDesiredCoverageForMonth(monthIndex: number): SynodicSpan {
  const base = synodicSeedWindowForMonth(monthIndex);
  return {
    start: Math.max(SYNODIC_MIN_MONTH_INDEX, base.start - SYNODIC_STITCH_PREFETCH_MONTHS),
    end: Math.min(SYNODIC_MAX_MONTH_INDEX + 1, base.end + SYNODIC_STITCH_PREFETCH_MONTHS),
  };
}

function synodicSeedWindowForFocus(
  value?: string | null,
  sourceMonths = 1,
): SynodicSpan {
  return synodicSeedWindowForMonth(monthIndexForDate(value), sourceMonths);
}

function synodicSeedWindowForMonth(monthIndex: number, sourceMonths = 1): SynodicSpan {
  const count = Math.max(1, Math.trunc(sourceMonths));
  const anchor = clampMonthIndex(monthIndex);
  if (count === 1) {
    return { start: anchor, end: Math.min(SYNODIC_MAX_MONTH_INDEX + 1, anchor + 1) };
  }
  const maxEnd = SYNODIC_MAX_MONTH_INDEX + 1;
  const rawStart = anchor - Math.floor(count / 2);
  const start = Math.max(
    SYNODIC_MIN_MONTH_INDEX,
    Math.min(rawStart, Math.max(SYNODIC_MIN_MONTH_INDEX, maxEnd - count)),
  );
  return { start, end: Math.min(maxEnd, start + count) };
}

function monthSpanContainsSpan(outer: SynodicSpan | null | undefined, inner: SynodicSpan): boolean {
  return !!outer && outer.start <= inner.start && outer.end >= inner.end;
}

function monthSpansEqual(left: SynodicSpan | null, right: SynodicSpan): boolean {
  return !!left && left.start === right.start && left.end === right.end;
}

function monthSpanAnchorIso(span: SynodicSpan): string {
  const date = dateFromMonthIndex(span.start);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-01T12:00:00`;
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
  return Math.max(SYNODIC_MIN_MONTH_INDEX, Math.min(SYNODIC_MAX_MONTH_INDEX, Math.trunc(index)));
}

function monthSpanRange(span: SynodicSpan): { fromDate: string; toDate: string } {
  const first = dateFromMonthIndex(span.start);
  const last = dateFromMonthIndex(Math.max(span.start, span.end - 1));
  const toDate = new Date(last.getFullYear(), last.getMonth() + 1, 0, 12, 0, 0, 0);
  return { fromDate: isoDate(first), toDate: isoDate(toDate) };
}

function monthSpanFromPayload(payload: SynodicCyclePayload): SynodicSpan {
  const start = monthIndexForDate(`${payload.meta.fromDate}T12:00:00`);
  const end = monthIndexForDate(`${payload.meta.toDate}T12:00:00`);
  return { start, end: Math.min(SYNODIC_MAX_MONTH_INDEX + 1, end + 1) };
}

function dateFromMonthIndex(index: number): Date {
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  return new Date(year, month, 1, 12, 0, 0, 0);
}

function isoDate(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function sameIsoDate(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (!Number.isFinite(leftDate.getTime()) || !Number.isFinite(rightDate.getTime())) return false;
  return leftDate.getFullYear() === rightDate.getFullYear()
    && leftDate.getMonth() === rightDate.getMonth()
    && leftDate.getDate() === rightDate.getDate();
}

function monthIndexForSynodicRow(row: SynodicCycleRow | undefined): number | null {
  if (!row) return null;
  const ms = synodicRowDateMs(row);
  if (ms == null) return null;
  return monthIndexForDate(new Date(ms).toISOString());
}

function viewportSynodicRowCount(scroller: HTMLDivElement | null, rowHeight: number): number {
  const height = eventListBodyViewportHeight(scroller, rowHeight * 12);
  return Math.max(1, Math.ceil(height / rowHeight));
}

function synodicScrollEdgeDirection(
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

function visibleSynodicMonthAnchorIndex(
  scroller: HTMLDivElement,
  rowCount: number,
  rowHeight: number,
): number {
  if (rowCount <= 0) return 0;
  const anchorTop =
    scroller.scrollTop + eventListBodyViewportHeight(scroller) * SYNODIC_FOCUS_ANCHOR;
  return Math.max(0, Math.min(rowCount - 1, Math.floor(anchorTop / rowHeight)));
}

function viewportSynodicFocusIso(
  rows: readonly SynodicCycleRow[],
  scroller: HTMLDivElement | null,
  fallbackMonthIndex: number,
  rowHeight: number,
): string {
  if (scroller && rows.length > 0) {
    const index = visibleSynodicMonthAnchorIndex(scroller, rows.length, rowHeight);
    const iso = synodicRowEventIso(rows[index]);
    if (iso) return iso;
  }
  return monthSpanAnchorIso(synodicSeedWindowForMonth(fallbackMonthIndex));
}

function nearestSynodicDateIndex(rows: readonly SynodicCycleRow[], targetMs: number): number {
  if (!rows.length) return -1;
  let bestIndex = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    const ms = synodicRowDateMs(row);
    if (ms == null) return;
    const delta = Math.abs(ms - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function scrollFocusedSynodicRow(
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

function scheduleFocusedSynodicScroll(
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
    if (
      scrollFocusedSynodicRow(scrollerRef.current, rowCount, anchorRatio, rowIndex, rowHeight)
    ) return;
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

function useSynodicOptionsSeq(): number {
  const lastOptionsChange = useDaemonWorkspaceStore(
    (state) => state.lastRetainedDataOptionsChange,
  );
  const [seq, setSeq] = React.useState(0);

  React.useEffect(() => {
    if (
      !lastOptionsChange ||
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

async function fetchSynodicChunk({
  documentId,
  span,
  signal,
}: {
  documentId: string;
  span: SynodicSpan | null;
  signal: AbortSignal;
}): Promise<SynodicCyclePayload> {
  const range = span ? monthSpanRange(span) : null;
  return fetchSynodicCycles(
    {
      documentId,
      fromDate: range?.fromDate,
      toDate: range?.toDate,
      includeStations: true,
      includeCazimis: true,
      includeIngresses: true,
    },
    signal,
  );
}

function synodicStitchRowKey(row: SynodicCycleRow): string {
  return [
    Math.round(Number(row.eventJd ?? 0) * 86400),
    row.planetObjectId,
    row.eventType,
    row.detailLabel,
    row.sign?.index ?? "",
  ].join(":");
}

function synodicRowFilterKey(row: SynodicCycleRow): string {
  if (row.filterGroup && row.filterId != null) {
    return `${row.filterGroup}:${row.filterId}`;
  }
  const group: SynodicFilterGroup = row.eventType === "ingress" ? "ingress" : "synodic";
  return `${group}:${row.planetId}`;
}

function activeSynodicFilterKeys(
  planetItems: readonly SynodicPlanetItem[],
  lunarItems: readonly SynodicLunarItem[],
  activeIngressPlanetIds: readonly number[] | null,
  activeSynodicPlanetIds: readonly number[] | null,
  activeLunarCycleIds: readonly string[] | null,
): string[] {
  const ingressPlanetItems = planetItems.filter((item) =>
    supportsSynodicFilterGroup(item, "ingress")
  );
  const ingressIds = activeIngressPlanetIds ?? ingressPlanetItems.map((item) => item.id);
  const synodicPlanetItems = planetItems.filter((item) =>
    supportsSynodicFilterGroup(item, "synodic")
  );
  const synodicIds = activeSynodicPlanetIds ?? synodicPlanetItems.map((item) => item.id);
  const lunarIds = activeLunarCycleIds ?? lunarItems.map((item) => item.id);
  return [
    ...ingressIds.map((planetId) => `ingress:${planetId}`),
    ...synodicIds.map((planetId) => `synodic:${planetId}`),
    ...lunarIds.map((cycleId) => `lunar:${cycleId}`),
  ];
}

function supportsSynodicFilterGroup(
  item: SynodicPlanetItem,
  group: Exclude<SynodicFilterGroup, "lunar">,
): boolean {
  if (item.eventGroups) return item.eventGroups.includes(group);
  if (group === "ingress") return true;
  return item.objectId !== "planet:sun";
}

function stitchedSynodicStoreCoversSpan(
  store: SynodicMonthStore | null,
  span: SynodicSpan,
): store is SynodicMonthStore {
  return !!store && monthSpanContainsSpan(store.coverage, span);
}

function rememberSynodicStitchStore(key: string, store: SynodicMonthStore): void {
  if (store.rows.length > SYNODIC_STITCH_CACHE_MAX_ROWS) return;
  rememberListPayload(SYNODIC_STITCHED_CACHE, key, store);
}

function synodicRowDateMs(row: SynodicCycleRow): number | null {
  const value = synodicRowEventIso(row);
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function synodicRowEventIso(row: SynodicCycleRow | undefined): string | null {
  if (!row) return null;
  if (row.displayDatetime) return row.displayDatetime;
  return row.openDatetime || (row.eventDate ? `${row.eventDate}T${row.eventTime || "12:00:00"}` : null);
}

function resolveDateMs(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function sortPlanetIds(ids: number[], items: readonly SynodicPlanetItem[]): number[] {
  const order = new Map(items.map((item, index) => [item.id, index]));
  return Array.from(new Set(ids)).sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}

function sortLunarCycleIds(
  ids: string[],
  items: readonly SynodicLunarItem[],
): string[] {
  const order = new Map(items.map((item, index) => [item.id, index]));
  return Array.from(new Set(ids)).sort(
    (a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999),
  );
}

function shortDisplayTime(row: SynodicCycleRow): string {
  const match = row.displayTime.match(/^(\d{1,2}:\d{2})/);
  return match?.[1] ?? row.displayTime;
}

function localWallclockIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}
