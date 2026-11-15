// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTablePrecision } from "./table-precision-menu";
import { formatTableDegrees } from "@/lib/table/angle-precision";
import * as React from "react";
import { useRetainedListRevision, useHouseFreeListOptionsRevision } from "./step-refresh";
import { useRetainedListRequests } from "@/lib/table/use-retained-list-requests";
import { flushSync } from "react-dom";

import { Calendar, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ListPaneSplit } from "./list-pane-split";
import {
  fetchSynodicCycles,
  type SynodicCyclePayload,
  type SynodicCycleRow,
  type SynodicLunarItem,
  type SynodicPlanetItem,
} from "@/lib/daemon/client";
import { eventListBodyViewportHeight } from "@/lib/event-list-time";
import { observeSynodicEventFit } from "@/lib/synodic-event-fit";
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
import { useWorkspaceStore } from "@/stores/workspace-store";

import { DateTransitLink, TimedChartContextMenu } from "./directions-view";
import {
  ListCalendarStepper,
  ListToggleDrawer,
  type ListCalendarJumpOptions,
} from "./list-controls";
import { useStepBurst } from "@/lib/chart/step-burst";
import {
  mergeTemporalCoverageBounds,
  temporalCoverageBounds,
  temporalCoverageFromJdBounds,
  type TemporalCoverageBounds,
  useTemporalConfluenceLensReporter,
  useTemporalConfluenceRows,
  useTemporalPinnedRowId,
  useTemporalRowHighlight,
} from "./temporal-confluence-context";
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
  coverageJdUt: TemporalCoverageBounds | null;
  islandNonce: number;
  summary: string;
  truncated: boolean;
  planetItems: SynodicPlanetItem[];
  lunarItems: SynodicLunarItem[];
  currentDatetime: string;
  birthDatetime: string;
  optionsSeq: number;
  filterKey: string;
  filterKeys: string[];
  activeIngressPlanetIds: number[];
  activeSynodicPlanetIds: number[];
  activeLunarCycleIds: string[];
  exhaustedPrevious: boolean;
  exhaustedNext: boolean;
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
const SYNODIC_SCROLL_EXTEND_DEBOUNCE_MS = 320;
const SYNODIC_STITCH_PREFETCH_MONTHS = 2;
const SYNODIC_STITCH_CHUNK_MONTHS = 1;
const SYNODIC_FILTER_MIN_BACKGROUND_ROWS = 8;
const SYNODIC_MIN_MONTH_INDEX = 12; // January, year 1
const SYNODIC_MAX_MONTH_INDEX = 9999 * 12 + 11;
const SYNODIC_FOCUS_ANCHOR = 0.25;
const SYNODIC_SEED_MONTHS = 1;
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
  embedded = false,
  includeTemporal = false,
  onClose,
}: {
  documentId: string;
  parentDocumentId?: string | null;
  sourceName?: string | null;
  focusDatetime?: string | null;
  embedded?: boolean;
  includeTemporal?: boolean;
  onClose?: () => void;
}) {
  const t = useT();
  const viewStateKey = includeTemporal ? `${documentId}:temporal-confluence` : documentId;
  const rowHeight = useListRowHeight("symbolic");
  const rowHeightRef = React.useRef(rowHeight);
  React.useLayoutEffect(() => {
    rowHeightRef.current = rowHeight;
  }, [rowHeight]);
  const optionsSeq = useSynodicOptionsSeq(documentId);
  const synodicListPreferences = useWorkspaceStore(
    (state) =>
      state.synodicListPreferencesByDocument[documentId] ??
      state.sidebarListPreferenceDefaults?.synodicList,
  );
  const sidebarListPreferencesHydrated = useWorkspaceStore(
    (state) => state.sidebarListPreferencesHydrated,
  );
  const setSynodicListPreferences = useWorkspaceStore(
    (state) => state.setSynodicListPreferences,
  );
  const cachedViewState = React.useMemo(
    () => synodicListViewStateCache.get(viewStateKey) ?? null,
    [viewStateKey],
  );
  const initialFocusDatetime = embedded
    ? focusDatetime ?? cachedViewState?.requestFocusDatetime ?? localWallclockIso()
    : localWallclockIso();
  const [requestFocusDatetime, setRequestFocusDatetime] = React.useState(
    initialFocusDatetime,
  );
  const [visibleMonthIndex, setVisibleMonthIndex] = React.useState(
    embedded
      ? cachedViewState?.visibleMonthIndex ?? monthIndexForDate(initialFocusDatetime)
      : monthIndexForDate(initialFocusDatetime),
  );
  const [activeIngressPlanetIds, setActiveIngressPlanetIds] = React.useState<number[] | null>(
    cachedViewState?.activeIngressPlanetIds ?? synodicListPreferences?.ingressPlanetIds ?? null,
  );
  const [activeSynodicPlanetIds, setActiveSynodicPlanetIds] = React.useState<number[] | null>(
    cachedViewState?.activeSynodicPlanetIds ?? synodicListPreferences?.synodicPlanetIds ?? null,
  );
  const [activeLunarCycleIds, setActiveLunarCycleIds] = React.useState<string[] | null>(
    cachedViewState?.activeLunarCycleIds ?? synodicListPreferences?.lunarCycleIds ?? null,
  );
  // Reuse the persisted drawer flags so any previously open group opens the unified pane.
  const filterDrawerOpen = Boolean(
    synodicListPreferences?.ingressDrawerOpen
    || synodicListPreferences?.synodicDrawerOpen
    || synodicListPreferences?.lunarDrawerOpen,
  );
  const [island, setIsland] = React.useState({ nonce: 0, bypassCache: false });
  const [store, setStore] = React.useState<SynodicMonthStore | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [edgeCheckNonce, setEdgeCheckNonce] = React.useState(0);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const [requests, requestsIdle] = useRetainedListRequests<SynodicMonthStore>(null);
  const activeIngressPlanetIdsRef = React.useRef<number[] | null>(activeIngressPlanetIds);
  const activeSynodicPlanetIdsRef = React.useRef<number[] | null>(activeSynodicPlanetIds);
  const activeLunarCycleIdsRef = React.useRef<string[] | null>(activeLunarCycleIds);
  const visibleMonthIndexRef = React.useRef(visibleMonthIndex);
  const requestFocusDatetimeRef = React.useRef(requestFocusDatetime);
  const rowsRef = React.useRef<SynodicCycleRow[]>([]);
  const scrollPlanRef = React.useRef<{ kind: "prepend"; count: number } | null>(null);
  const pendingMonthJumpRef = React.useRef<number | null>(null);
  const pendingReplacementFocusRef = React.useRef<string | null>(null);
  const filterAnchorRef = React.useRef<string | null>(null);
  const stitchKeyRef = React.useRef("");
  // Opening seeds Current. Merely receiving the source chart's initial (often
  // birth) cursor must not override it; subsequent source changes still follow.
  const sourceFocusDatetimeRef = React.useRef(focusDatetime ?? null);

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
  React.useEffect(() => {
    if (
      cachedViewState ||
      !sidebarListPreferencesHydrated ||
      !synodicListPreferences
    ) return;
    const ingress = [...synodicListPreferences.ingressPlanetIds];
    const synodic = [...synodicListPreferences.synodicPlanetIds];
    const lunar = [...synodicListPreferences.lunarCycleIds];
    if (
      sameSelection(activeIngressPlanetIds, ingress)
      && sameSelection(activeSynodicPlanetIds, synodic)
      && sameSelection(activeLunarCycleIds, lunar)
    ) return;
    activeIngressPlanetIdsRef.current = ingress;
    activeSynodicPlanetIdsRef.current = synodic;
    activeLunarCycleIdsRef.current = lunar;
    const frame = requestAnimationFrame(() => {
      setActiveIngressPlanetIds(ingress);
      setActiveSynodicPlanetIds(synodic);
      setActiveLunarCycleIds(lunar);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    activeIngressPlanetIds,
    activeLunarCycleIds,
    activeSynodicPlanetIds,
    cachedViewState,
    sidebarListPreferencesHydrated,
    synodicListPreferences,
  ]);

  const activeFilterKey = React.useMemo(
    () => [
      activeIngressPlanetIds ? activeIngressPlanetIds.join(",") : "ingress:default",
      activeSynodicPlanetIds ? activeSynodicPlanetIds.join(",") : "synodic:default",
      activeLunarCycleIds ? activeLunarCycleIds.join(",") : "lunar:default",
    ].join("|"),
    [activeIngressPlanetIds, activeLunarCycleIds, activeSynodicPlanetIds],
  );
  const stitchKey = React.useMemo(
    () => listCacheKey({ documentId, includeTemporal, optionsSeq, activeFilterKey }),
    [activeFilterKey, documentId, includeTemporal, optionsSeq],
  );
  React.useEffect(() => {
    stitchKeyRef.current = stitchKey;
  }, [stitchKey]);

  React.useEffect(() => {
    const retainedStore = requests.accepted();
    const refreshingOptions = retainedStore != null && retainedStore.optionsSeq !== optionsSeq;
    const jumpFocus = pendingReplacementFocusRef.current ??
      (pendingMonthJumpRef.current != null ? requestFocusDatetimeRef.current : null);
    const filterFocus = retainedStore?.filterKey !== activeFilterKey
      ? filterAnchorRef.current
      : null;
    const refreshFocus = refreshingOptions && !jumpFocus
      ? filterFocus ?? viewportSynodicFocusIso(
          rowsRef.current,
          scrollerRef.current,
          visibleMonthIndexRef.current,
          rowHeightRef.current,
        )
      : null;
    // Resident jumps can move the cursor without replacing the island.
    // Resolve the seed month and cursor date together for every replacement.
    const requestFocus = jumpFocus ?? filterFocus ?? refreshFocus ?? requestFocusDatetimeRef.current;
    const requestedWindow = synodicSeedWindowForFocus(requestFocus, SYNODIC_SEED_MONTHS);
    const replacementNonce = refreshingOptions
      ? (retainedStore?.islandNonce ?? island.nonce) + 1
      : island.nonce;
    if (refreshFocus) {
      const retainedMonth = monthIndexForDate(refreshFocus);
      pendingMonthJumpRef.current = null;
      requestFocusDatetimeRef.current = refreshFocus;
      visibleMonthIndexRef.current = retainedMonth;
    }
    const request = requests.replace();
    scrollPlanRef.current = null;
    const cleanup = request.cancel;
    const cached = getCachedListPayload<SynodicMonthStore>(SYNODIC_STITCHED_CACHE, stitchKey);
    if (
      !island.bypassCache &&
      !refreshingOptions &&
      cached?.optionsSeq === optionsSeq &&
      stitchedSynodicStoreCoversSpan(cached, requestedWindow)
    ) {
      queueMicrotask(() => {
        if (request.signal.aborted || !request.current()) return;
        request.publish(cached);
        request.finish();
        setStore(cached);
        setLoading(false);
        setError(null);
      });
      return cleanup;
    }

    queueMicrotask(() => {
      if (request.signal.aborted) return;
      setLoading(true);
      setError(null);
      if (refreshFocus) {
        const retainedMonth = monthIndexForDate(refreshFocus);
        setRequestFocusDatetime(refreshFocus);
        setVisibleMonthIndex(retainedMonth);
      }
    });
    fetchSynodicChunk({
      documentId,
      includeTemporal,
      span: requestedWindow,
      ingressPlanetIds: activeIngressPlanetIdsRef.current,
      synodicPlanetIds: activeSynodicPlanetIdsRef.current,
      lunarCycleIds: activeLunarCycleIdsRef.current,
      cursorDirection: "around",
      cursorRowBudget: synodicFocusCursorRowBudget(
        scrollerRef.current,
        rowHeightRef.current,
      ),
      cursorAnchorDate: requestFocus.slice(0, 10),
      signal: request.signal,
    })
      .then((data) => {
        if (request.signal.aborted || !request.current()) return;
        const span = monthSpanFromPayload(data);
        const next: SynodicMonthStore = {
          rows: data.rows,
          coverage: span,
          coverageJdUt: temporalCoverageBounds(
            data.meta.coverageStartJdUt,
            data.meta.coverageEndJdUt,
          ),
          islandNonce: replacementNonce,
          summary: data.summary,
          truncated: data.truncated,
          planetItems: data.meta.planetItems,
          lunarItems: data.meta.lunarItems,
          currentDatetime: data.meta.currentDatetime,
          birthDatetime: data.meta.birthDatetime,
          optionsSeq,
          filterKey: activeFilterKey,
          filterKeys: activeSynodicFilterKeys(
            data.meta.planetItems,
            data.meta.lunarItems,
            data.meta.activeIngressPlanetIds,
            data.meta.activeSynodicPlanetIds,
            data.meta.activeLunarCycleIds,
          ),
          activeIngressPlanetIds: data.meta.activeIngressPlanetIds,
          activeSynodicPlanetIds: data.meta.activeSynodicPlanetIds,
          activeLunarCycleIds: data.meta.activeLunarCycleIds,
          exhaustedPrevious:
            data.cursor?.exhaustedPrevious ??
            !hasActiveSynodicSources(data),
          exhaustedNext:
            data.cursor?.exhaustedNext ??
            !hasActiveSynodicSources(data),
        };
        // Publish request authority with the accepted payload. An effect or a
        // deferred transition would let edge requests use the previous island.
        request.publish(next);
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
          setStore(next);
        }
        rememberSynodicStitchStore(stitchKey, next);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        if (request.signal.aborted || !request.current()) return;
        pendingReplacementFocusRef.current = null;
        setError((err as Error).message || t("synodic.loadFailed"));
      })
      .finally(() => {
        if (request.finish()) {
            setLoading(false);
        }
      });

    return cleanup;
  }, [activeFilterKey, documentId, includeTemporal, island, optionsSeq, requests, stitchKey, t]);

  const extendCoverage = React.useCallback(
    (loadDirection: "previous" | "next") => {
      const current = requests.accepted();
      if (!current || requests.busy) return;
      let span: SynodicSpan;
      if (loadDirection === "previous") {
        if (current.exhaustedPrevious || current.coverage.start <= SYNODIC_MIN_MONTH_INDEX) return;
        span = {
          start: Math.max(
            SYNODIC_MIN_MONTH_INDEX,
            current.coverage.start - SYNODIC_STITCH_CHUNK_MONTHS,
          ),
          end: current.coverage.start,
        };
      } else {
        if (current.exhaustedNext || current.coverage.end > SYNODIC_MAX_MONTH_INDEX) return;
        span = {
          start: current.coverage.end,
          end: Math.min(
            SYNODIC_MAX_MONTH_INDEX + 1,
            current.coverage.end + SYNODIC_STITCH_CHUNK_MONTHS,
          ),
        };
      }
      const request = requests.extend();
      if (!request) return;
      fetchSynodicChunk({
        documentId,
        includeTemporal,
        span,
        ingressPlanetIds: activeIngressPlanetIdsRef.current,
        synodicPlanetIds: activeSynodicPlanetIdsRef.current,
        lunarCycleIds: activeLunarCycleIdsRef.current,
        cursorDirection: loadDirection,
        cursorRowBudget: synodicCursorRowBudget(
          scrollerRef.current,
          rowHeightRef.current,
        ),
        cursorAnchorDate: monthSpanAnchorIso(span).slice(0, 10),
        signal: request.signal,
      })
        .then((data) => {
          if (
            request.signal.aborted ||
            !request.current()
          ) return;
          const base = requests.accepted();
          if (base !== current) return;
          const returnedSpan = monthSpanFromPayload(data);
          const { next, prependedCount } = stitchRows(
            base,
            data.rows,
            returnedSpan,
            synodicStitchRowKey,
          );
          const nextStore: SynodicMonthStore = {
            ...next,
            coverageJdUt: mergeTemporalCoverageBounds(
              base.coverageJdUt,
              temporalCoverageBounds(
                data.meta.coverageStartJdUt,
                data.meta.coverageEndJdUt,
              ),
            ),
            summary: data.summary,
            truncated: base.truncated || data.truncated,
            planetItems: data.meta.planetItems,
            lunarItems: data.meta.lunarItems,
            currentDatetime: data.meta.currentDatetime,
            birthDatetime: data.meta.birthDatetime,
            optionsSeq: base.optionsSeq,
            filterKey: base.filterKey,
            filterKeys: base.filterKeys,
            activeIngressPlanetIds: base.activeIngressPlanetIds,
            activeSynodicPlanetIds: base.activeSynodicPlanetIds,
            activeLunarCycleIds: base.activeLunarCycleIds,
            exhaustedPrevious: loadDirection === "previous"
              ? (data.cursor?.exhaustedPrevious ?? base.exhaustedPrevious)
              : base.exhaustedPrevious,
            exhaustedNext: loadDirection === "next"
              ? (data.cursor?.exhaustedNext ?? base.exhaustedNext)
              : base.exhaustedNext,
          };
          const visiblePrependedCount = visiblePrependedRowCount(
            next.rows,
            prependedCount,
            nextStore.filterKeys,
            synodicRowFilterKey,
          );
          if (visiblePrependedCount > 0) {
            scrollPlanRef.current = { kind: "prepend", count: visiblePrependedCount };
          }
          request.publish(nextStore);
          if (request.finish()) {
            setEdgeCheckNonce((value) => value + 1);
          }
          setStore(nextStore);
          rememberSynodicStitchStore(stitchKeyRef.current, nextStore);
        })
        .catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          console.error("[synodic-stitch-extend]", err);
        })
        .finally(() => {
          if (request.finish()) {
          }
        });
    },
    [documentId, includeTemporal, requests],
  );

  // Coverage for a scrolled-to month: a short scroll debounce, and never
  // while a chart step burst is still moving the focus.
  const { active: stepBurstActive } = useStepBurst();
  React.useEffect(() => {
    if (!store || stepBurstActive) return;
    const timer = window.setTimeout(() => {
      if (requests.busy) return;
      const desired = synodicDesiredCoverageForMonth(visibleMonthIndex);
      if (!store.exhaustedPrevious && store.coverage.start > desired.start) {
        extendCoverage("previous");
      } else if (!store.exhaustedNext && store.coverage.end < desired.end) {
        extendCoverage("next");
      }
    }, SYNODIC_SCROLL_EXTEND_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [extendCoverage, requests, requestsIdle, store, stepBurstActive, visibleMonthIndex]);

  React.useEffect(() => {
    if (!focusDatetime) return;
    const focusSpan = synodicSeedWindowForFocus(focusDatetime, SYNODIC_SEED_MONTHS);
    const focusMonth = focusSpan.start;
    // Resident months follow every step frame; a new island waits for the
    // step burst's completion edge.
    if (stepBurstActive && !monthSpanContainsSpan(requests.accepted()?.coverage, focusSpan)) return;
    const previousSourceFocus = sourceFocusDatetimeRef.current;
    sourceFocusDatetimeRef.current = focusDatetime;
    if (previousSourceFocus === focusDatetime || (!embedded && !previousSourceFocus)) return;
    const commitFocus = () => {
      pendingMonthJumpRef.current = null;
      pendingReplacementFocusRef.current = null;
      filterAnchorRef.current = null;
      requestFocusDatetimeRef.current = focusDatetime;
      visibleMonthIndexRef.current = focusMonth;
      setRequestFocusDatetime((prev) => (prev === focusDatetime ? prev : focusDatetime));
      setVisibleMonthIndex((prev) => (prev === focusMonth ? prev : focusMonth));
      const current = requests.accepted();
      if (current && monthSpanContainsSpan(current.coverage, focusSpan)) return;
      setIsland((prev) => ({
        nonce: prev.nonce + 1,
        bypassCache: false,
      }));
    };
    queueMicrotask(commitFocus);
  }, [requests, embedded, focusDatetime, stepBurstActive]);

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
  const effectiveIngressPlanetIds = React.useMemo(
    () => activeIngressPlanetIds ?? store?.activeIngressPlanetIds ?? [],
    [activeIngressPlanetIds, store?.activeIngressPlanetIds],
  );
  const effectiveSynodicPlanetIds = React.useMemo(
    () => activeSynodicPlanetIds ?? store?.activeSynodicPlanetIds ?? [],
    [activeSynodicPlanetIds, store?.activeSynodicPlanetIds],
  );
  const effectiveLunarCycleIds = React.useMemo(
    () => activeLunarCycleIds ?? store?.activeLunarCycleIds ?? [],
    [activeLunarCycleIds, store?.activeLunarCycleIds],
  );
  const selectedPlanetIds = synodicListPreferences?.planetIds
    ?? Array.from(new Set([...effectiveIngressPlanetIds, ...effectiveSynodicPlanetIds]));
  const ingressesEnabled = synodicListPreferences?.ingressesEnabled
    ?? effectiveIngressPlanetIds.length > 0;
  const synodicsEnabled = synodicListPreferences?.synodicsEnabled
    ?? effectiveSynodicPlanetIds.length > 0;
  const activeFilterKeys = React.useMemo(
    () => activeSynodicFilterKeys(
      planetItems,
      lunarItems,
      effectiveIngressPlanetIds,
      effectiveSynodicPlanetIds,
      effectiveLunarCycleIds,
    ),
    [
      effectiveIngressPlanetIds,
      effectiveLunarCycleIds,
      effectiveSynodicPlanetIds,
      lunarItems,
      planetItems,
    ],
  );
  const storeMatchesActiveFilter = store?.filterKey === activeFilterKey;
  const displayedFilterKeys = storeMatchesActiveFilter
    ? activeFilterKeys
    : store?.filterKeys ?? activeFilterKeys;
  const reportTemporalLens = useTemporalConfluenceLensReporter();
  React.useEffect(() => {
    if (
      !store
      || activeIngressPlanetIds == null
      || activeSynodicPlanetIds == null
      || activeLunarCycleIds == null
    ) return;
    reportTemporalLens({ filterIds: displayedFilterKeys });
  }, [
    displayedFilterKeys,
    activeIngressPlanetIds,
    activeLunarCycleIds,
    activeSynodicPlanetIds,
    reportTemporalLens,
    store,
  ]);
  const rows = React.useMemo(
    () => storeMatchesActiveFilter
      ? filterRetainedRows(sourceRows, activeFilterKeys, synodicRowFilterKey)
      : sourceRows,
    [activeFilterKeys, sourceRows, storeMatchesActiveFilter],
  );
  const temporalCoverage = React.useMemo(
    () =>
      temporalCoverageFromJdBounds(
        store?.optionsSeq === optionsSeq ? store.coverageJdUt : null,
        store?.optionsSeq === optionsSeq && store?.truncated === false,
      ),
    [optionsSeq, store],
  );
  useTemporalConfluenceRows(rows, temporalCoverage);
  React.useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
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
      synodicListViewStateCache.set(viewStateKey, {
        activeIngressPlanetIds: activeIngressPlanetIdsRef.current,
        activeSynodicPlanetIds: activeSynodicPlanetIdsRef.current,
        activeLunarCycleIds: activeLunarCycleIdsRef.current,
        requestFocusDatetime: viewportFocus,
        visibleMonthIndex: monthIndexForDate(viewportFocus),
      });
    };
  }, [viewStateKey]);

  const rowKeys = React.useMemo(() => buildStableRowKeys(rows, synodicStitchRowKey), [rows]);
  const focusTargetMs = React.useMemo(() => resolveDateMs(requestFocusDatetime), [requestFocusDatetime]);
  const pinnedTemporalRowId = useTemporalPinnedRowId();
  const focusIndex = React.useMemo(() => {
    if (pinnedTemporalRowId) {
      const pinnedIndex = rows.findIndex((row) => row.temporal?.rowId === pinnedTemporalRowId);
      if (pinnedIndex >= 0) return pinnedIndex;
    }
    return nearestSynodicDateIndex(rows, focusTargetMs);
  }, [focusTargetMs, pinnedTemporalRowId, rows]);
  useFixedRowHeightAnchor(scrollerRef, rows.length, rowHeight, {
    syncEvent: VIRTUAL_SCROLL_SYNC_EVENT,
  });

  useEdgeExtend({
    scrollerRef,
    rowCount: rows.length,
    thresholdPx: rowHeight * 6,
    canExtendBackward:
      !store?.exhaustedPrevious &&
      (store?.coverage.start ?? SYNODIC_MIN_MONTH_INDEX) > SYNODIC_MIN_MONTH_INDEX,
    canExtendForward:
      !store?.exhaustedNext &&
      (store?.coverage.end ?? SYNODIC_MAX_MONTH_INDEX + 1) <= SYNODIC_MAX_MONTH_INDEX,
    onExtend: extendCoverage,
    recheckToken: `${edgeCheckNonce}:${requestsIdle}`,
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
    if (!anchor || !storeMatchesActiveFilter) return;
    filterAnchorRef.current = null;
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
      scrollerRef.current?.dispatchEvent(new Event(VIRTUAL_SCROLL_SYNC_EVENT));
    }
  }, [rowHeight, rows, storeMatchesActiveFilter]);

  const focusSignature = pinnedTemporalRowId
    ? `temporal:${pinnedTemporalRowId}`
    : `ms:${focusTargetMs}`;
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
          const current = requests.accepted();
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
  }, [requests, rowHeight, rows]);

  const monthLabel = React.useMemo(() => formatMonthIndexLabel(visibleMonthIndex), [visibleMonthIndex]);
  const ensureSourceWindowForFocus = React.useCallback((nextFocus: string, force = false) => {
    const desired = synodicSeedWindowForFocus(nextFocus, SYNODIC_SEED_MONTHS);
    const current = requests.accepted();
    if (!force && current && monthSpanContainsSpan(current.coverage, desired)) return;
    setIsland((prev) => ({ nonce: prev.nonce + 1, bypassCache: force }));
  }, [requests]);

  const jumpByMonths = React.useCallback((delta: number, options?: ListCalendarJumpOptions) => {
    const nextMonth = clampMonthIndex((pendingMonthJumpRef.current ?? visibleMonthIndexRef.current) + delta);
    const nextFocus = monthSpanAnchorIso(synodicSeedWindowForMonth(nextMonth));
    pendingReplacementFocusRef.current = null;
    filterAnchorRef.current = null;
    pendingMonthJumpRef.current = nextMonth;
    visibleMonthIndexRef.current = nextMonth;
    requestFocusDatetimeRef.current = nextFocus;
    setVisibleMonthIndex(nextMonth);
    setRequestFocusDatetime(nextFocus);
    // A held chevron loads once on release (onJumpSettle) instead of per step.
    if (!options?.deferLoad) ensureSourceWindowForFocus(nextFocus);
  }, [ensureSourceWindowForFocus]);
  const settleMonthJump = React.useCallback(() => {
    ensureSourceWindowForFocus(requestFocusDatetimeRef.current);
  }, [ensureSourceWindowForFocus]);

  const jumpToViewportTarget = React.useCallback((nextFocus: string) => {
    const nextMonth = monthIndexForDate(nextFocus);
    filterAnchorRef.current = null;
    pendingReplacementFocusRef.current = nextFocus;
    pendingMonthJumpRef.current = nextMonth;
    requestFocusDatetimeRef.current = nextFocus;
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
    const nextFocus = pendingMonthJumpRef.current != null
      ? requestFocusDatetimeRef.current
      : viewportSynodicFocusIso(rows, scrollerRef.current, visibleMonthIndex, rowHeight);
    filterAnchorRef.current = nextFocus;
  }, [rowHeight, rows, visibleMonthIndex]);

  const setPlanetFilters = (
    ids: number[],
    ingressEnabled = ingressesEnabled,
    synodicEnabled = synodicsEnabled,
  ) => {
    prepareFilterChange();
    const sorted = sortPlanetIds(ids, planetItems);
    const ingress = ingressEnabled
      ? sorted.filter((id) => ingressPlanetItems.some((item) => item.id === id))
      : [];
    const synodic = synodicEnabled
      ? sorted.filter((id) => synodicPlanetItems.some((item) => item.id === id))
      : [];
    activeIngressPlanetIdsRef.current = ingress;
    activeSynodicPlanetIdsRef.current = synodic;
    setActiveIngressPlanetIds(ingress);
    setActiveSynodicPlanetIds(synodic);
    setSynodicListPreferences(documentId, {
      planetIds: sorted,
      ingressesEnabled: ingressEnabled,
      synodicsEnabled: synodicEnabled,
      ingressPlanetIds: ingress,
      synodicPlanetIds: synodic,
    });
  };
  const toggleLunarCycle = React.useCallback(
    (cycleId: string, checked: boolean) => {
      prepareFilterChange();
      const next = checked
        ? Array.from(new Set([...effectiveLunarCycleIds, cycleId]))
        : effectiveLunarCycleIds.filter((id) => id !== cycleId);
      const sorted = sortLunarCycleIds(next, lunarItems);
      activeLunarCycleIdsRef.current = sorted;
      setActiveLunarCycleIds(sorted);
      setSynodicListPreferences(documentId, { lunarCycleIds: sorted });
    },
    [
      documentId,
      effectiveLunarCycleIds,
      lunarItems,
      prepareFilterChange,
      setSynodicListPreferences,
    ],
  );
  const setLunarCycleSelection = React.useCallback(
    (checked: boolean) => {
      prepareFilterChange();
      const next = checked ? lunarItems.map((item) => item.id) : [];
      activeLunarCycleIdsRef.current = next;
      setActiveLunarCycleIds(next);
      setSynodicListPreferences(documentId, { lunarCycleIds: next });
    },
    [documentId, lunarItems, prepareFilterChange, setSynodicListPreferences],
  );

  return (
    <div className={cn("font-morinus-text", LIST_PANE_CLASSES.root)}>
      <div className={LIST_PANE_CLASSES.standardHeader}>
        {!embedded ? (
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
        ) : null}
        <div className={LIST_PANE_CLASSES.controlRow}>
          <ListCalendarStepper
            label={monthLabel}
            onJump={jumpByMonths}
            onJumpSettle={settleMonthJump}
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
          <Button
            type="button"
            {...LIST_BUTTON_PROPS.command}
            onClick={() => setSynodicListPreferences(documentId, {
              ingressDrawerOpen: !filterDrawerOpen,
              synodicDrawerOpen: false,
              lunarDrawerOpen: false,
            })}
            aria-expanded={filterDrawerOpen}
          >
            {t("aspectList.filter")}
          </Button>
        </div>
      </div>
      <ListPaneSplit
        autoSaveId="aries.synodic-list-filters-vs-results"
        label={t("aspectList.filter")}
        onCloseControls={() => setSynodicListPreferences(documentId, { ingressDrawerOpen: false })}
        controls={filterDrawerOpen ? (
          <div role="group" aria-label={t("aspectList.filter")} className="w-full">
            <div className="mb-[var(--aries-control-gap)] flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="mr-1 min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">
                {t("aspectList.include")}
              </span>
              <Button
                type="button"
                size="xs"
                variant={ingressesEnabled ? "default" : "outline"}
                aria-pressed={ingressesEnabled}
                onClick={() => setPlanetFilters(selectedPlanetIds, !ingressesEnabled, synodicsEnabled)}
              >
                {t("synodic.ingresses")}
              </Button>
              <Button
                type="button"
                size="xs"
                variant={synodicsEnabled ? "default" : "outline"}
                aria-pressed={synodicsEnabled}
                onClick={() => setPlanetFilters(selectedPlanetIds, ingressesEnabled, !synodicsEnabled)}
              >
                {t("synodic.synodics")}
              </Button>
            </div>
            <ListToggleDrawer
              embedded
              label={t("astrocart.config.planets")}
              items={planetItems}
              isActive={(item) => selectedPlanetIds.includes(item.id)}
              onToggle={(item, active) => setPlanetFilters(active
                ? [...selectedPlanetIds, item.id]
                : selectedPlanetIds.filter((id) => id !== item.id))}
              deselectAllLabel={t("listFilters.deselectAll")}
              selectAllLabel={t("listFilters.selectAll")}
              onDeselectAll={() => setPlanetFilters([])}
              onSelectAll={() => setPlanetFilters(planetItems.map((item) => item.id))}
            />
            <ListToggleDrawer
              embedded
              label={t("synodic.lunar")}
              items={lunarItems}
              isActive={(item) => effectiveLunarCycleIds.includes(item.id)}
              onToggle={(item, active) => toggleLunarCycle(item.id, active)}
              deselectAllLabel={t("listFilters.deselectAll")}
              selectAllLabel={t("listFilters.selectAll")}
              onDeselectAll={() => setLunarCycleSelection(false)}
              onSelectAll={() => setLunarCycleSelection(true)}
            />
          </div>
        ) : null}
      >
        {error && store ? (
          <div className={cn(LIST_PANE_CLASSES.error, "shrink-0 border-b border-border py-2")}>
            {error}
          </div>
        ) : null}
        <div ref={scrollerRef} className={LIST_PANE_CLASSES.scroller}>
          {error && !store ? (
            <div className={LIST_PANE_CLASSES.error}>{error}</div>
          ) : (
            <SidebarListTable profile="transit-cursor" ref={observeSynodicEventFit}>
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
      </ListPaneSplit>
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
  const temporalHighlight = useTemporalRowHighlight(row.temporal);
  const eventTitle = row.cazimiLabel ? `${row.eventLabel} (${row.cazimiLabel})` : row.eventLabel;
  return (
    <TimedChartContextMenu
      anglePrecision
      documentId={documentId}
      eventDatetime={row.openDatetime}
      eventJd={row.eventJd}
      sessionLabel={row.sessionLabel}
    >
      <SidebarListRow
        className={SYNODIC_ROW_CLASS}
        data-initial-focus={focused || undefined}
        {...temporalHighlight.dataAttributes}
        style={{ height: rowHeight, ...temporalHighlight.style }}
        onClick={temporalHighlight.onClick}
      >
        <SidebarListCell className="text-center">
          <span className="inline-flex items-center justify-center gap-1" title={row.eventGlyph ? row.eventLabel : row.planetLabel}>
            <Glyph
              ch={row.eventGlyph || row.planetGlyph}
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
          title={row.eventType === "ingress" ? (row.motionMarker === "R" ? t("synodic.retrogradeIngress") : t("synodic.directIngress")) : eventTitle}
          aria-label={row.eventShortLabel ? eventTitle : undefined}
        >
          <span className="inline-flex items-center justify-center gap-1">
            {row.eventType === "eclipse" ? <EclipseMark /> : null}
            {row.eventShortLabel ? (
              <>
                <span data-synodic-event-label="full">{row.eventLabel}</span>
                <span data-synodic-event-label="short" aria-hidden="true">{row.eventShortLabel}</span>
              </>
            ) : row.eventLabel}
            {row.cazimiLabel ? (
              <span className="aries-list-secondary-text">({row.cazimiLabel})</span>
            ) : null}
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
  const precision = useTablePrecision();
  const longitude = row.longitudeDegrees;
  const longitudeText = longitude == null ? row.longitudeText : formatTableDegrees(longitude, precision);
  const fullLongitude = longitude == null ? row.longitudeText : formatTableDegrees(longitude, "seconds");
  const detailLabel = row.detailLabel.trim() === row.eventLabel.trim() ? "" : row.detailLabel;
  const title = [detailLabel, row.sign?.label, fullLongitude].filter(Boolean).join(" ");
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
      {longitudeText ? (
        <span className="text-muted-foreground">{longitudeText}</span>
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

function synodicSeedWindowForFocus(value: string, sourceMonths: number): SynodicSpan {
  // The daemon interprets the anchor as a civil date, including for a focus
  // timestamp with an offset that would fall in another local month.
  const civilNoon = `${value.slice(0, 10)}T12:00:00`;
  return synodicSeedWindowForMonth(monthIndexForDate(civilNoon), sourceMonths);
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

function monthSpanAnchorIso(span: SynodicSpan): string {
  return `${isoDate(dateFromMonthIndex(span.start))}T12:00:00`;
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
  const toDate = dateFromMonthIndex(span.end);
  toDate.setDate(0);
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
  const date = new Date(2000, 0, 1, 12, 0, 0, 0);
  date.setFullYear(year, month, 1);
  return date;
}

function isoDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, "0");
  return `${year}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
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

function sameSelection<T>(
  left: readonly T[] | null,
  right: readonly T[],
): boolean {
  return left != null
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
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

function synodicCursorRowBudget(
  scroller: HTMLDivElement | null,
  rowHeight: number,
): number {
  return Math.max(
    SYNODIC_FILTER_MIN_BACKGROUND_ROWS,
    viewportSynodicRowCount(scroller, rowHeight),
  );
}

function synodicFocusCursorRowBudget(
  scroller: HTMLDivElement | null,
  rowHeight: number,
): number {
  const viewportRows = viewportSynodicRowCount(scroller, rowHeight);
  return Math.max(
    SYNODIC_FILTER_MIN_BACKGROUND_ROWS,
    Math.ceil(viewportRows * 2 * (1 - SYNODIC_FOCUS_ANCHOR)) + 1,
  );
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

function useSynodicOptionsSeq(documentId: string): number {
  // Ingresses, synodic phases and lunar cycles never read houses or cusps.
  return useHouseFreeListOptionsRevision() + useRetainedListRevision([documentId]);
}

async function fetchSynodicChunk({
  documentId,
  includeTemporal,
  span,
  ingressPlanetIds,
  synodicPlanetIds,
  lunarCycleIds,
  cursorDirection,
  cursorRowBudget,
  cursorAnchorDate,
  signal,
}: {
  documentId: string;
  includeTemporal: boolean;
  span: SynodicSpan;
  ingressPlanetIds: readonly number[] | null;
  synodicPlanetIds: readonly number[] | null;
  lunarCycleIds: readonly string[] | null;
  cursorDirection: "around" | "previous" | "next";
  cursorRowBudget: number;
  cursorAnchorDate: string;
  signal: AbortSignal;
}): Promise<SynodicCyclePayload> {
  return fetchSynodicCycles(
    {
      documentId,
      ...monthSpanRange(span),
      ...(ingressPlanetIds == null ? {} : { ingressPlanetIds: [...ingressPlanetIds] }),
      ...(synodicPlanetIds == null ? {} : { synodicPlanetIds: [...synodicPlanetIds] }),
      ...(lunarCycleIds == null ? {} : { lunarCycleIds: [...lunarCycleIds] }),
      includeStations: true,
      includeCazimis: true,
      includeIngresses: true,
      includeTemporal,
      cursorDirection,
      cursorRowBudget,
      cursorAnchorDate,
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

function hasActiveSynodicSources(payload: SynodicCyclePayload): boolean {
  return (
    payload.meta.activeIngressPlanetIds.length > 0 ||
    payload.meta.activeSynodicPlanetIds.length > 0 ||
    payload.meta.activeLunarCycleIds.length > 0
  );
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
