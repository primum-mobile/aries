// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { flushSync } from "react-dom";

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
  followTransitSearchProgress,
  openDirectionsTimedChart,
  startTransitSearchContext,
  type TimedChartAction,
  type TransitSearchCatalog,
  type TransitSearchCursorState,
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
  forgetListPayload,
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
  buildStableRowKeys,
  useEdgeExtend,
  type AgeSpan,
} from "./stitched-list-harness";
import { STEP_SETTLE_REFRESH_MS } from "./step-refresh";

type TransitDirectionMode = "direct" | "converse" | "both";
type TransitColumnKey = "prom" | "aspect" | "sig" | "date" | "time" | "dc";
type SearchDisplay = TransitSearchRow["promDisplay"];
type TransitSpan = AgeSpan;
type TransitPromittorItem = {
  id: string;
  label: string;
  glyph: string;
  marker: string;
  group: string;
};

type TransitMonthStore = {
  rows: TransitSearchRow[];
  coverage: TransitSpan;
  coverageJdUt: TemporalCoverageBounds | null;
  islandNonce: number;
  streamKey: string;
  summary: string;
  truncated: boolean;
  exhaustedPrevious: boolean;
  exhaustedNext: boolean;
};

type TransitListViewState = {
  direction: TransitDirectionMode;
  requestFocusDatetime: string;
  visibleMonthIndex: number;
};

type TransitIsland = {
  nonce: number;
  window: TransitSpan;
  anchorDatetime: string;
};

type TransitFrameExtensionRequest = {
  anchorDatetime: string;
};

type TransitFrameFocusOverride = {
  datetime: string;
  sourceCursor: string;
};

const TRANSIT_COLUMNS: readonly TransitColumnKey[] = ["prom", "aspect", "sig", "date", "time", "dc"];
const TRANSIT_ROW_CLASS = LIST_ROW_CLASSES.flagged;
const TRANSIT_STITCHED_CACHE = "transits:cursor-list:v1";
const TRANSIT_STITCH_CACHE_MAX_ROWS = 12000;
const TRANSIT_INITIAL_MIN_ROWS = 96;
const TRANSIT_EDGE_MIN_ROWS = 48;
const TRANSIT_EDGE_RETRY_BASE_MS = 1000;
const TRANSIT_EDGE_MAX_AUTO_RETRIES = 3;
const TRANSIT_MIN_MONTH_INDEX = 12;
const TRANSIT_MAX_MONTH_INDEX = 9999 * 12 + 11;
const TRANSIT_FOCUS_ANCHOR = 0.25;
const VIRTUAL_OVERSCAN_ROWS = 12;
const VIRTUAL_SCROLL_SYNC_EVENT = "aries:virtual-scroll-sync";
const TRANSIT_FRAME_EDGE_ROWS = 6;
const TRANSIT_LIST_FALLBACK_ASPECTS = ["conjunction", "sextile", "square", "trine", "opposition"];
const transitListViewStateCache = new Map<string, TransitListViewState>();
const transitStreamViewportCache = new Map<string, Omit<TransitListViewState, "direction">>();
const EMPTY_PROMITTOR_IDS: readonly string[] = Object.freeze([]);
const EMPTY_TIMESTAMPS: readonly number[] = Object.freeze([]);

function dispatchVirtualScrollSync(scroller: HTMLDivElement, beforePaint = false): void {
  scroller.dispatchEvent(
    new CustomEvent(VIRTUAL_SCROLL_SYNC_EVENT, { detail: { beforePaint } }),
  );
}

function listCacheKey(parts: Record<string, unknown>): string {
  return JSON.stringify(parts);
}

export function TransitListView({
  documentId,
  focusDatetime,
  embedded = false,
  includeTemporal = false,
  includeOrbTemporal = false,
  onClose,
}: {
  documentId: string;
  sourceName?: string;
  focusDatetime?: string | null;
  embedded?: boolean;
  includeTemporal?: boolean;
  includeOrbTemporal?: boolean;
  onClose?: () => void;
}) {
  const t = useT();
  const temporalRequested = includeTemporal || includeOrbTemporal;
  const viewStateKey = temporalRequested ? `${documentId}:temporal-confluence` : documentId;
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
    () => transitListViewStateCache.get(viewStateKey) ?? null,
    [viewStateKey],
  );
  const transitListPreferences = useWorkspaceStore(
    (state) =>
      state.transitListPreferencesByDocument[documentId] ??
      state.sidebarListPreferenceDefaults?.transitList,
  );
  const sidebarListPreferencesHydrated = useWorkspaceStore(
    (state) => state.sidebarListPreferencesHydrated,
  );
  const setTransitListPreferences = useWorkspaceStore(
    (state) => state.setTransitListPreferences,
  );
  const initialRequestFocusDatetime = cachedViewState?.requestFocusDatetime ?? effectiveFocusDatetime;
  const effectiveFocusDatetimeRef = React.useRef(effectiveFocusDatetime);
  React.useEffect(() => {
    effectiveFocusDatetimeRef.current = effectiveFocusDatetime;
  }, [effectiveFocusDatetime]);

  const [direction, setDirection] = React.useState<TransitDirectionMode>(
    cachedViewState?.direction ?? transitListPreferences?.direction ?? "direct",
  );
  const [catalog, setCatalog] = React.useState<TransitSearchCatalog | null>(null);
  const [catalogOptionsSeq, setCatalogOptionsSeq] = React.useState(-1);
  const configuredPromittorId = transitListPreferences?.selectedPromittorId ?? null;
  const promittorDrawerOpen = transitListPreferences?.promittorDrawerOpen ?? false;
  const availablePromittorIds = React.useMemo(
    () => (catalog ? transitListPromittorIds(catalog) : EMPTY_PROMITTOR_IDS),
    [catalog],
  );
  const selectedPromittorId =
    configuredPromittorId && availablePromittorIds.includes(configuredPromittorId)
      ? configuredPromittorId
      : null;
  const activePromittorIds = React.useMemo<readonly string[] | null>(
    () => (selectedPromittorId ? [selectedPromittorId] : null),
    [selectedPromittorId],
  );
  const activePromittorKey = selectedPromittorId ?? "all";
  const [requestFocusDatetime, setRequestFocusDatetime] = React.useState(
    initialRequestFocusDatetime,
  );
  const [frameFocusOverride, setFrameFocusOverride] =
    React.useState<TransitFrameFocusOverride | null>(
      () =>
        cachedViewState
          ? {
              datetime: cachedViewState.requestFocusDatetime,
              sourceCursor: effectiveFocusDatetime,
            }
          : null,
  );
  const frameFocusDatetime =
    frameFocusOverride && sameTransitFocusInstant(frameFocusOverride.sourceCursor, effectiveFocusDatetime)
      ? frameFocusOverride.datetime
      : effectiveFocusDatetime;
  const [island, setIsland] = React.useState<TransitIsland>(() => ({
    nonce: 0,
    window: transitSeedWindowForFocus(initialRequestFocusDatetime),
    anchorDatetime: initialRequestFocusDatetime,
  }));
  const [store, setStore] = React.useState<TransitMonthStore | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [edgeCheckNonce, setEdgeCheckNonce] = React.useState(0);
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
  const extendCooldownUntilRef = React.useRef({ previous: 0, next: 0 });
  const extendRetryTimerRef = React.useRef<number | null>(null);
  const extendRetryAttemptsRef = React.useRef({ previous: 0, next: 0 });
  const extendCoverageRef = React.useRef<(direction: "previous" | "next") => void>(() => undefined);
  const scrollPlanRef = React.useRef<{ kind: "prepend"; count: number } | null>(null);
  const programmaticFrameFollowRef = React.useRef(false);
  const programmaticFrameFollowGenerationRef = React.useRef(0);
  const pendingFrameFocusRef = React.useRef<string | null>(null);
  const frameFocusSettleTimerRef = React.useRef<number | null>(null);
  const runSettledFrameFocusRef = React.useRef<() => void>(() => undefined);
  const frameFocusEffectMountedRef = React.useRef(false);
  const activePromittorIdsRef = React.useRef<readonly string[] | null>(activePromittorIds);
  const optionsSeq = useTransitOptionsSeq();
  const reportTemporalLens = useTemporalConfluenceLensReporter();
  React.useEffect(() => {
    if (!catalog) return;
    reportTemporalLens({
      direction,
      ...(activePromittorIds ? { promittorIds: [...activePromittorIds] } : {}),
    });
  }, [activePromittorIds, catalog, direction, reportTemporalLens]);
  const directionRef = React.useRef(direction);
  const rowsRef = React.useRef<TransitSearchRow[]>([]);
  const visibleMonthIndexRef = React.useRef(visibleMonthIndex);
  const requestFocusDatetimeRef = React.useRef(requestFocusDatetime);
  const pendingMonthJumpRef = React.useRef<number | null>(null);
  const restoredCachedViewStateRef = React.useRef(Boolean(cachedViewState));

  const cancelFrameFocusSettle = React.useCallback(() => {
    pendingFrameFocusRef.current = null;
    if (frameFocusSettleTimerRef.current !== null) {
      window.clearTimeout(frameFocusSettleTimerRef.current);
      frameFocusSettleTimerRef.current = null;
    }
  }, []);
  const queueFrameFocusSettle = React.useCallback((delay = STEP_SETTLE_REFRESH_MS) => {
    if (frameFocusSettleTimerRef.current !== null) {
      window.clearTimeout(frameFocusSettleTimerRef.current);
    }
    frameFocusSettleTimerRef.current = window.setTimeout(() => {
      frameFocusSettleTimerRef.current = null;
      runSettledFrameFocusRef.current();
    }, delay);
  }, []);
  const markProgrammaticFrameFollow = React.useCallback((scroller: HTMLDivElement) => {
    const generation = programmaticFrameFollowGenerationRef.current + 1;
    programmaticFrameFollowGenerationRef.current = generation;
    programmaticFrameFollowRef.current = true;
    scroller.dataset.transitListFrameFollow = "true";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (programmaticFrameFollowGenerationRef.current !== generation) return;
        programmaticFrameFollowRef.current = false;
        delete scroller.dataset.transitListFrameFollow;
      });
    });
  }, []);

  React.useEffect(
    () => () => {
      cancelFrameFocusSettle();
      programmaticFrameFollowGenerationRef.current += 1;
      programmaticFrameFollowRef.current = false;
    },
    [cancelFrameFocusSettle],
  );

  React.useEffect(() => {
    storeRef.current = store;
  }, [store]);
  React.useEffect(() => {
    activePromittorIdsRef.current = activePromittorIds;
  }, [activePromittorIds]);
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
        promittorScope: activePromittorKey,
        includeTemporal: temporalRequested,
        includeOrbTemporal,
        optionsSeq,
        catalogOptionsSeq,
      }),
    [
      activePromittorKey,
      catalogOptionsSeq,
      direction,
      documentId,
      includeOrbTemporal,
      optionsSeq,
      temporalRequested,
    ],
  );
  const viewportKey = React.useMemo(
    () => transitViewportKey(viewStateKey, direction, activePromittorKey),
    [activePromittorKey, direction, viewStateKey],
  );
  const viewportKeyRef = React.useRef(viewportKey);
  React.useEffect(() => {
    stitchKeyRef.current = stitchKey;
    viewportKeyRef.current = viewportKey;
  }, [stitchKey, viewportKey]);

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
      const focus = viewportTransitFocusIso(
        rowsRef.current,
        scrollerRef.current,
        visibleMonthIndexRef.current,
        rowHeightRef.current,
      ) || requestFocusDatetimeRef.current || effectiveFocusDatetimeRef.current;
      cancelFrameFocusSettle();
      setRequestFocusDatetime(focus);
      setFrameFocusOverride({
        datetime: focus,
        sourceCursor: effectiveFocusDatetimeRef.current,
      });
      pendingMonthJumpRef.current = null;
      requestFocusDatetimeRef.current = focus;
      setIsland((prev) => ({
        nonce: prev.nonce + 1,
        window: transitSeedWindowForFocus(focus),
        anchorDatetime: focus,
      }));
    });
  }, [cancelFrameFocusSettle, optionsSeq]);

  React.useEffect(() => {
    if (!catalog || catalogOptionsSeq !== optionsSeq) return undefined;
    const worldSeq = worldSeqRef.current + 1;
    worldSeqRef.current = worldSeq;
    extendCooldownUntilRef.current = { previous: 0, next: 0 };
    extendInFlightRef.current = false;
    extendControllerRef.current?.abort();
    extendControllerRef.current = null;
    if (extendRetryTimerRef.current !== null) {
      window.clearTimeout(extendRetryTimerRef.current);
      extendRetryTimerRef.current = null;
    }
    extendRetryAttemptsRef.current = { previous: 0, next: 0 };
    scrollPlanRef.current = null;
    cancelCurrentSearch(currentSessionRef);
    const controller = new AbortController();
    const cleanupCurrentWorld = () => {
      controller.abort();
      if (worldSeqRef.current === worldSeq) {
        initialInFlightRef.current = false;
      }
      extendControllerRef.current?.abort();
      extendControllerRef.current = null;
      extendInFlightRef.current = false;
      if (extendRetryTimerRef.current !== null) {
        window.clearTimeout(extendRetryTimerRef.current);
        extendRetryTimerRef.current = null;
      }
      cancelCurrentSearch(currentSessionRef);
    };
    const cached = getCachedListPayload<TransitMonthStore>(TRANSIT_STITCHED_CACHE, stitchKey);
    if (cached && stitchedTransitStoreCoversFocus(cached, island.window, island.anchorDatetime)) {
      initialInFlightRef.current = false;
      queueMicrotask(() => {
        if (controller.signal.aborted || worldSeqRef.current !== worldSeq) return;
        const next = normalizeTransitStore(cached, stitchKey, island.nonce);
        storeRef.current = next;
        setStore(next);
        setLoading(false);
        setError(null);
      });
      return cleanupCurrentWorld;
    }

    initialInFlightRef.current = true;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(null);
    });
    const applyPayload = (payload: TransitSearchProgressResult) => {
      if (controller.signal.aborted || worldSeqRef.current !== worldSeq) return;
      if (!cursorPayloadReadyForSwap(payload)) return;
      const next = transitStoreFromCursorPayload(
        payload,
        island,
        stitchKey,
      );
      if (!next) return;
      storeRef.current = next;
      React.startTransition(() => setStore(next));
      rememberTransitStitchStore(stitchKey, next);
    };
    fetchTransitCursor({
      catalog,
      documentId,
      direction,
      includeTemporal: temporalRequested,
      includeOrbTemporal,
      promittorIds: activePromittorIds,
      span: island.window,
      loadDirection: "around",
      rowBudget: Math.max(
        TRANSIT_INITIAL_MIN_ROWS,
        viewportTransitRowCount(scrollerRef.current, rowHeightRef.current) * 4,
      ),
      anchorDatetime: island.anchorDatetime,
      signal: controller.signal,
      sessionRef: currentSessionRef,
      onRows: applyPayload,
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

    return cleanupCurrentWorld;
  }, [
    activePromittorIds,
    catalog,
    catalogOptionsSeq,
    direction,
    documentId,
    includeOrbTemporal,
    island,
    optionsSeq,
    stitchKey,
    t,
    temporalRequested,
  ]);

  const extendCoverage = React.useCallback(
    (
      loadDirection: "previous" | "next",
      frameRequest?: TransitFrameExtensionRequest,
    ): boolean => {
      const current = storeRef.current;
      if (
        !catalog
        || !current
        || extendInFlightRef.current
        || initialInFlightRef.current
        || (!frameRequest && programmaticFrameFollowRef.current)
      ) return false;
      if (current.streamKey !== stitchKeyRef.current) return false;
      if (current.islandNonce !== island.nonce) return false;
      if (Date.now() < extendCooldownUntilRef.current[loadDirection]) return false;
      if (
        (loadDirection === "previous" && current.exhaustedPrevious)
        || (loadDirection === "next" && current.exhaustedNext)
      ) return false;
      let span: TransitSpan;
      if (loadDirection === "previous") {
        if (current.coverage.start <= TRANSIT_MIN_MONTH_INDEX) return false;
        span = {
          start: Math.max(TRANSIT_MIN_MONTH_INDEX, current.coverage.start - 1),
          end: current.coverage.start,
        };
      } else {
        if (current.coverage.end > TRANSIT_MAX_MONTH_INDEX) return false;
        span = {
          start: current.coverage.end,
          end: Math.min(TRANSIT_MAX_MONTH_INDEX + 1, current.coverage.end + 1),
        };
      }
      const worldSeq = worldSeqRef.current;
      const controller = new AbortController();
      if (extendRetryTimerRef.current !== null) {
        window.clearTimeout(extendRetryTimerRef.current);
        extendRetryTimerRef.current = null;
      }
      extendInFlightRef.current = true;
      extendControllerRef.current = controller;
      const applyPayload = (payload: TransitSearchProgressResult) => {
        if (
          controller.signal.aborted
          || worldSeqRef.current !== worldSeq
          || payload.cancelled
          || payload.error
          || !payload.cursor
        ) return;
        const base = storeRef.current;
        if (!base || base.streamKey !== stitchKeyRef.current) return;
        const chunkSpan = transitSpanForCursor(payload.cursor);
        const { rows: stitchedRows, prependedCount } = stitchTransitCursorRows(
          base.rows,
          payload.rows,
          loadDirection,
        );
        const nextStore: TransitMonthStore = {
          ...base,
          rows: stitchedRows,
          coverage: {
            start: Math.min(base.coverage.start, chunkSpan.start),
            end: Math.max(base.coverage.end, chunkSpan.end),
          },
          coverageJdUt: mergeTemporalCoverageBounds(
            base.coverageJdUt,
            temporalCoverageBounds(
              payload.cursor.coverageStartJdUt,
              payload.cursor.coverageEndJdUt,
            ),
          ),
          summary: payload.summary,
          truncated: base.truncated || payload.truncated,
          exhaustedPrevious:
            loadDirection === "previous"
              ? payload.cursor.exhaustedPrevious
              : base.exhaustedPrevious,
          exhaustedNext:
            loadDirection === "next"
              ? payload.cursor.exhaustedNext
              : base.exhaustedNext,
        };
        if (prependedCount > 0) {
          const pending = scrollPlanRef.current;
          scrollPlanRef.current = {
            kind: "prepend",
            count: prependedCount + (pending?.kind === "prepend" ? pending.count : 0),
          };
        }
        storeRef.current = nextStore;
        setStore(nextStore);
        rememberTransitStitchStore(stitchKeyRef.current, nextStore);
      };
      fetchTransitCursor({
        catalog,
        documentId,
        direction,
        includeTemporal: temporalRequested,
        includeOrbTemporal,
        promittorIds: activePromittorIdsRef.current,
        span,
        loadDirection,
        rowBudget: Math.max(
          TRANSIT_EDGE_MIN_ROWS,
          viewportTransitRowCount(scrollerRef.current, rowHeightRef.current) * 2,
        ),
        anchorDatetime: frameRequest?.anchorDatetime ?? monthSpanAnchorIso(span),
        signal: controller.signal,
        sessionRef: currentSessionRef,
        onRows: applyPayload,
      })
        .then(() => {
          if (controller.signal.aborted || worldSeqRef.current !== worldSeq) return;
          extendRetryAttemptsRef.current[loadDirection] = 0;
          extendCooldownUntilRef.current[loadDirection] = 0;
          setError(null);
        })
        .catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          if (controller.signal.aborted || worldSeqRef.current !== worldSeq) return;
          if (frameRequest) {
            setError((err as Error).message || t("tlview.loadFailed"));
            console.error("[transit-frame-settle-extend]", err);
            return;
          }
          const attempt = extendRetryAttemptsRef.current[loadDirection] + 1;
          extendRetryAttemptsRef.current[loadDirection] = attempt;
          const retryDelay = transitEdgeRetryDelay(attempt);
          extendCooldownUntilRef.current[loadDirection] = Date.now() + retryDelay;
          if (attempt <= TRANSIT_EDGE_MAX_AUTO_RETRIES) {
            extendRetryTimerRef.current = window.setTimeout(() => {
              extendRetryTimerRef.current = null;
              if (
                controller.signal.aborted
                || worldSeqRef.current !== worldSeq
                || !transitScrollerAtEdge(
                  scrollerRef.current,
                  loadDirection,
                  rowHeightRef.current * 6,
                )
              ) return;
              extendCooldownUntilRef.current[loadDirection] = 0;
              extendCoverageRef.current(loadDirection);
            }, retryDelay);
          } else {
            setError((err as Error).message || t("tlview.loadFailed"));
          }
          console.error("[transit-stitch-extend]", err);
        })
        .finally(() => {
          if (extendControllerRef.current === controller) {
            extendControllerRef.current = null;
            extendInFlightRef.current = false;
            if (
              !frameRequest
              && !controller.signal.aborted
              && worldSeqRef.current === worldSeq
            ) {
              setEdgeCheckNonce((value) => value + 1);
            }
            if (pendingFrameFocusRef.current) {
              queueFrameFocusSettle(0);
            }
          }
        });
      return true;
    },
    [
      catalog,
      direction,
      documentId,
      includeOrbTemporal,
      island.nonce,
      queueFrameFocusSettle,
      t,
      temporalRequested,
    ],
  );
  React.useLayoutEffect(() => {
    extendCoverageRef.current = extendCoverage;
  }, [extendCoverage]);

  const runSettledFrameFocus = React.useCallback(() => {
    const settledFocus = pendingFrameFocusRef.current;
    if (!settledFocus) return;
    const current = storeRef.current;
    if (!current) {
      if (initialInFlightRef.current) queueFrameFocusSettle();
      else {
        const desired = transitSeedWindowForFocus(settledFocus);
        pendingFrameFocusRef.current = null;
        setIsland((prev) =>
          monthSpansEqual(prev.window, desired) && prev.anchorDatetime === settledFocus
            ? prev
            : {
                nonce: prev.nonce + 1,
                window: desired,
                anchorDatetime: settledFocus,
              },
        );
      }
      return;
    }
    if (
      current.streamKey !== stitchKeyRef.current
      || current.islandNonce !== island.nonce
      || initialInFlightRef.current
      || extendInFlightRef.current
    ) {
      queueFrameFocusSettle();
      return;
    }

    const desired = transitSeedWindowForFocus(settledFocus);
    const settledFocusMs = resolveDateMs(settledFocus);
    const currentRowTimestamps = transitRowsTimestamps(current.rows);
    let extensionDirection: "previous" | "next" | null = null;
    if (monthSpanContainsSpan(current.coverage, desired)) {
      const focusPosition = transitFocusResidentPosition(
        currentRowTimestamps,
        settledFocusMs,
      );
      if (focusPosition !== "inside") {
        if (
          transitFocusInsideResidentRows(
            currentRowTimestamps,
            settledFocusMs,
            current.exhaustedPrevious,
            current.exhaustedNext,
          )
        ) {
          pendingFrameFocusRef.current = null;
          return;
        }
        if (focusPosition === "before") extensionDirection = "previous";
        else if (focusPosition === "after") extensionDirection = "next";
        else {
          pendingFrameFocusRef.current = null;
          setIsland((prev) =>
            monthSpansEqual(prev.window, desired) && prev.anchorDatetime === settledFocus
              ? prev
              : {
                  nonce: prev.nonce + 1,
                  window: desired,
                  anchorDatetime: settledFocus,
                },
          );
          return;
        }
      }
      if (extensionDirection === null) {
        const focusIndex = nearestTransitTimestampIndex(
          currentRowTimestamps,
          settledFocusMs,
        );
        if (
          focusIndex >= 0
          && focusIndex < TRANSIT_FRAME_EDGE_ROWS
          && !current.exhaustedPrevious
          && current.coverage.start > TRANSIT_MIN_MONTH_INDEX
        ) {
          extensionDirection = "previous";
        } else if (
          focusIndex >= Math.max(0, current.rows.length - TRANSIT_FRAME_EDGE_ROWS)
          && !current.exhaustedNext
          && current.coverage.end <= TRANSIT_MAX_MONTH_INDEX
        ) {
          extensionDirection = "next";
        } else {
          pendingFrameFocusRef.current = null;
          return;
        }
      }
    } else if (desired.end === current.coverage.start) {
      extensionDirection = "previous";
    } else if (desired.start === current.coverage.end) {
      extensionDirection = "next";
    } else {
      pendingFrameFocusRef.current = null;
      setIsland((prev) =>
        monthSpansEqual(prev.window, desired) && prev.anchorDatetime === settledFocus
          ? prev
          : {
              nonce: prev.nonce + 1,
              window: desired,
              anchorDatetime: settledFocus,
            },
      );
      return;
    }

    if (
      (extensionDirection === "previous"
        && (current.exhaustedPrevious || current.coverage.start <= TRANSIT_MIN_MONTH_INDEX))
      || (extensionDirection === "next"
        && (current.exhaustedNext || current.coverage.end > TRANSIT_MAX_MONTH_INDEX))
    ) {
      pendingFrameFocusRef.current = null;
      return;
    }
    if (!extendCoverage(extensionDirection, { anchorDatetime: settledFocus })) {
      pendingFrameFocusRef.current = settledFocus;
      queueFrameFocusSettle();
    }
  }, [extendCoverage, island.nonce, queueFrameFocusSettle, setIsland]);
  React.useLayoutEffect(() => {
    runSettledFrameFocusRef.current = runSettledFrameFocus;
  }, [runSettledFrameFocus]);

  React.useEffect(() => {
    if (!frameFocusEffectMountedRef.current) {
      frameFocusEffectMountedRef.current = true;
      return;
    }
    pendingFrameFocusRef.current = effectiveFocusDatetime;
    runSettledFrameFocusRef.current();
  }, [effectiveFocusDatetime]);

  const sourceRows = React.useMemo(() => store?.rows ?? [], [store]);
  const authoritativeStream = store?.streamKey === stitchKey;
  const authoritativeIsland =
    authoritativeStream && store?.islandNonce === island.nonce;
  const rows = React.useMemo(
    () =>
      authoritativeStream
        ? sourceRows
        : bootstrapTransitRows(sourceRows, activePromittorIds),
    [activePromittorIds, authoritativeStream, sourceRows],
  );
  const temporalCoverage = React.useMemo(
    () =>
      temporalCoverageFromJdBounds(
        authoritativeStream ? store?.coverageJdUt : null,
        authoritativeStream && store?.truncated === false,
      ),
    [authoritativeStream, store?.coverageJdUt, store?.truncated],
  );
  useTemporalConfluenceRows(rows, temporalCoverage);
  const authoritativeRowTimestamps = React.useMemo(
    () => transitRowsTimestamps(sourceRows),
    [sourceRows],
  );
  const residentRowTimestamps = authoritativeIsland
    ? authoritativeRowTimestamps
    : EMPTY_TIMESTAMPS;
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
      const viewState = {
        requestFocusDatetime: viewportFocus,
        visibleMonthIndex: monthIndexForDate(viewportFocus),
      };
      transitStreamViewportCache.set(viewportKeyRef.current, viewState);
      transitListViewStateCache.set(viewStateKey, {
        direction: directionRef.current,
        ...viewState,
      });
    };
  }, [viewStateKey]);

  const rowKeys = React.useMemo(() => buildStableRowKeys(rows, transitStitchRowKey), [rows]);
  const focusTargetMs = resolveDateMs(frameFocusDatetime);
  const pinnedTemporalRowId = useTemporalPinnedRowId();
  const pinnedTemporalIndex = React.useMemo(
    () =>
      pinnedTemporalRowId
        ? rows.findIndex((row) => row.temporal?.rowId === pinnedTemporalRowId)
        : -1,
    [pinnedTemporalRowId, rows],
  );
  const focusIndex =
    pinnedTemporalIndex >= 0
      ? pinnedTemporalIndex
      : nearestTransitTimestampIndex(residentRowTimestamps, focusTargetMs);
  const focusIsResident =
    pinnedTemporalIndex >= 0 ||
    (authoritativeIsland
      && rows.length > 0
      && Number.isFinite(focusTargetMs)
      && monthSpanContainsMonth(store?.coverage, monthIndexForDate(frameFocusDatetime))
      && transitFocusInsideResidentRows(
        residentRowTimestamps,
        focusTargetMs,
        store?.exhaustedPrevious,
        store?.exhaustedNext,
      ));
  useFixedRowHeightAnchor(scrollerRef, rows.length, rowHeight, {
    syncEvent: VIRTUAL_SCROLL_SYNC_EVENT,
  });

  useEdgeExtend({
    scrollerRef,
    rowCount: rows.length,
    thresholdPx: rowHeight * 6,
    canExtendBackward:
      authoritativeIsland
      && !store?.exhaustedPrevious
      && (store?.coverage.start ?? TRANSIT_MIN_MONTH_INDEX) > TRANSIT_MIN_MONTH_INDEX,
    canExtendForward:
      authoritativeIsland
      && !store?.exhaustedNext
      && (store?.coverage.end ?? TRANSIT_MAX_MONTH_INDEX + 1) <= TRANSIT_MAX_MONTH_INDEX,
    onExtend: extendCoverage,
    recheckToken: edgeCheckNonce,
  });

  React.useLayoutEffect(() => {
    const plan = scrollPlanRef.current;
    if (!plan) return;
    const scroller = scrollerRef.current;
    if (!scroller || scroller.clientHeight <= 0) return;
    scrollPlanRef.current = null;
    scroller.scrollTop += plan.count * rowHeight;
    dispatchVirtualScrollSync(scroller);
  }, [rowHeight, store]);

  const islandSignature = authoritativeIsland && store ? `${store.islandNonce}` : "pending";
  React.useLayoutEffect(() => {
    if (!focusIsResident || rows.length === 0) return undefined;
    scrollPlanRef.current = null;
    return scheduleFocusedTransitScroll(
      scrollerRef,
      focusIndex,
      rows.length,
      TRANSIT_FOCUS_ANCHOR,
      rowHeightRef.current,
      markProgrammaticFrameFollow,
    );
  }, [
    activePromittorKey,
    focusIndex,
    focusIsResident,
    islandSignature,
    markProgrammaticFrameFollow,
    rows.length,
  ]);

  const syncVisibleMonthFromRow = React.useCallback((row: TransitSearchRow | undefined) => {
    const month = monthIndexForTransitRow(row);
    if (month == null) return;
    const pendingMonth = pendingMonthJumpRef.current;
    if (pendingMonth != null) {
      const current = storeRef.current;
      const pendingSpan = transitSeedWindowForMonth(pendingMonth);
      if (
        !current
        || current.streamKey !== stitchKeyRef.current
        || !monthSpanContainsSpan(current.coverage, pendingSpan)
      ) {
        return;
      }
      if (month !== pendingMonth) return;
      pendingMonthJumpRef.current = null;
    }
    visibleMonthIndexRef.current = month;
    setVisibleMonthIndex((prev) => (prev === month ? prev : month));
  }, [setVisibleMonthIndex]);

  React.useEffect(() => {
    if (!focusIsResident || focusIndex < 0) return;
    syncVisibleMonthFromRow(rows[focusIndex]);
  }, [focusIndex, focusIsResident, rows, syncVisibleMonthFromRow]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!authoritativeIsland || !scroller || rows.length === 0) return undefined;
    let frame = 0;
    const sync = () => {
      frame = 0;
      if (programmaticFrameFollowRef.current) return;
      const row = rows[visibleTransitMonthAnchorIndex(scroller, rows.length, rowHeight)];
      syncVisibleMonthFromRow(row);
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
  }, [authoritativeIsland, rowHeight, rows, syncVisibleMonthFromRow]);

  const monthLabel = React.useMemo(
    () => formatMonthIndexLabel(visibleMonthIndex),
    [visibleMonthIndex],
  );
  const promittorItems = React.useMemo(() => transitPromittorItems(catalog, t), [catalog, t]);
  const selectedPromittorItem = React.useMemo(
    () => promittorItems.find((item) => item.id === selectedPromittorId) ?? null,
    [promittorItems, selectedPromittorId],
  );
  const promittorSelectionLabel = selectedPromittorItem?.label ?? t("tlview.all");
  const captureCurrentViewport = React.useCallback(() => {
    const nextFocus = viewportTransitFocusIso(
      rows,
      scrollerRef.current,
      visibleMonthIndex,
      rowHeight,
    );
    const viewState = {
      requestFocusDatetime: nextFocus,
      visibleMonthIndex: monthIndexForDate(nextFocus),
    };
    transitStreamViewportCache.set(viewportKey, viewState);
    transitListViewStateCache.set(viewStateKey, { direction, ...viewState });
    return viewState;
  }, [direction, rowHeight, rows, viewStateKey, viewportKey, visibleMonthIndex]);
  const activateStreamViewport = React.useCallback(
    (
      nextViewportKey: string,
      fallback: Omit<TransitListViewState, "direction">,
    ) => {
      const restored = transitStreamViewportCache.get(nextViewportKey) ?? fallback;
      const nextFocus = restored.requestFocusDatetime;
      const nextMonth = restored.visibleMonthIndex;
      cancelFrameFocusSettle();
      setRequestFocusDatetime(nextFocus);
      setFrameFocusOverride({
        datetime: nextFocus,
        sourceCursor: effectiveFocusDatetimeRef.current,
      });
      pendingMonthJumpRef.current = null;
      visibleMonthIndexRef.current = nextMonth;
      requestFocusDatetimeRef.current = nextFocus;
      setVisibleMonthIndex(nextMonth);
      setIsland((prev) => ({
        nonce: prev.nonce + 1,
        window: transitSeedWindowForFocus(nextFocus),
        anchorDatetime: nextFocus,
      }));
    },
    [cancelFrameFocusSettle],
  );
  const selectPromittor = React.useCallback(
    (promittorId: string | null) => {
      const nextPromittorKey = promittorId ?? "all";
      if (nextPromittorKey === activePromittorKey) {
        setTransitListPreferences(documentId, {
          selectedPromittorId: promittorId,
          promittorDrawerOpen: false,
        });
        return;
      }
      const currentView = captureCurrentViewport();
      activateStreamViewport(
        transitViewportKey(viewStateKey, direction, nextPromittorKey),
        currentView,
      );
      setTransitListPreferences(documentId, {
        selectedPromittorId: promittorId,
        promittorDrawerOpen: false,
      });
    },
    [
      activateStreamViewport,
      activePromittorKey,
      captureCurrentViewport,
      direction,
      documentId,
      setTransitListPreferences,
      viewStateKey,
    ],
  );
  const jumpByMonths = React.useCallback((delta: number) => {
    const nextMonth = clampMonthIndex((pendingMonthJumpRef.current ?? visibleMonthIndexRef.current) + delta);
    const nextFocus = monthSpanAnchorIso(transitSeedWindowForMonth(nextMonth));
    cancelFrameFocusSettle();
    setRequestFocusDatetime(nextFocus);
    setFrameFocusOverride({
      datetime: nextFocus,
      sourceCursor: effectiveFocusDatetimeRef.current,
    });
    pendingMonthJumpRef.current = nextMonth;
    visibleMonthIndexRef.current = nextMonth;
    requestFocusDatetimeRef.current = nextFocus;
    setVisibleMonthIndex(nextMonth);
    pendingFrameFocusRef.current = nextFocus;
    runSettledFrameFocusRef.current();
  }, [cancelFrameFocusSettle]);
  const jumpToCurrent = React.useCallback(() => {
    const nextFocus = localWallclockIso();
    const nextMonth = monthIndexForDate(nextFocus);
    cancelFrameFocusSettle();
    setRequestFocusDatetime(nextFocus);
    setFrameFocusOverride({
      datetime: nextFocus,
      sourceCursor: effectiveFocusDatetimeRef.current,
    });
    pendingMonthJumpRef.current = nextMonth;
    visibleMonthIndexRef.current = nextMonth;
    requestFocusDatetimeRef.current = nextFocus;
    setVisibleMonthIndex(nextMonth);
    pendingFrameFocusRef.current = nextFocus;
    runSettledFrameFocusRef.current();
  }, [cancelFrameFocusSettle]);
  const changeDirection = React.useCallback(
    (nextDirection: TransitDirectionMode) => {
      if (nextDirection === direction) return;
      const currentView = captureCurrentViewport();
      activateStreamViewport(
        transitViewportKey(viewStateKey, nextDirection, activePromittorKey),
        currentView,
      );
      setDirection(nextDirection);
      setTransitListPreferences(documentId, { direction: nextDirection });
    },
    [
      activateStreamViewport,
      activePromittorKey,
      captureCurrentViewport,
      direction,
      documentId,
      setDirection,
      setTransitListPreferences,
      viewStateKey,
    ],
  );
  React.useEffect(() => {
    if (
      cachedViewState ||
      !sidebarListPreferencesHydrated ||
      !transitListPreferences?.direction ||
      transitListPreferences.direction === direction
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      changeDirection(transitListPreferences.direction);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    cachedViewState,
    changeDirection,
    direction,
    sidebarListPreferencesHydrated,
    transitListPreferences?.direction,
  ]);

  return (
    <div className={LIST_PANE_CLASSES.root}>
      <div className={LIST_PANE_CLASSES.standardHeader}>
        {!embedded ? (
          <div className={LIST_PANE_CLASSES.titleRow}>
            <div className={LIST_PANE_CLASSES.titleLeading}>
              {onClose ? (
                <Button
                  type="button"
                  {...LIST_BUTTON_PROPS.icon}
                  onClick={onClose}
                  aria-label={t("tlview.closeTransits")}
                >
                  <X className="size-3.5" />
                </Button>
              ) : null}
              <h2 className={LIST_PANE_CLASSES.title}>{t("sidebar.action.transits")}</h2>
            </div>
          </div>
        ) : null}
        <div className={LIST_PANE_CLASSES.controlRow}>
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
            onClick={() =>
              setTransitListPreferences(documentId, {
                promittorDrawerOpen: !promittorDrawerOpen,
              })
            }
            aria-expanded={promittorDrawerOpen}
          >
            {t("tlview.point")}: {promittorSelectionLabel}
          </Button>
        </div>
        <div className={LIST_PANE_CLASSES.controlRow}>
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
        {promittorDrawerOpen ? (
          <TransitPromittorDrawer
            items={promittorItems}
            activeId={selectedPromittorId}
            onSelect={selectPromittor}
          />
        ) : null}
        {error && rows.length > 0 ? (
          <div
            role="status"
            className="w-full text-[length:var(--aries-font-size-small)] text-destructive"
          >
            {error}
          </div>
        ) : null}
      </div>
      <div
        ref={scrollerRef}
        className={LIST_PANE_CLASSES.scroller}
        data-transit-list-focus-index={focusIndex}
        data-transit-list-focus-resident={focusIsResident ? "true" : "false"}
        data-transit-list-focus-target-ms={Math.trunc(focusTargetMs)}
      >
        {error && rows.length === 0 ? (
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
  const temporalHighlight = useTemporalRowHighlight(row.temporal);
  return (
    <TransitRowContextMenu row={row} documentId={documentId}>
      <TableRow
        className={TRANSIT_ROW_CLASS}
        data-initial-focus={focused || undefined}
        {...temporalHighlight.dataAttributes}
        style={{ height: rowHeight, ...temporalHighlight.style }}
        onClick={temporalHighlight.onClick}
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
      void openDirectionsTimedChart(
        documentId,
        "transits",
        row.openDatetime,
        null,
        null,
        null,
        showRadix,
        row.technique === "converse_transits"
          ? {
              sourceTechnique: row.technique,
              symbolicWhenIso: row.displayDatetime,
              symbolicEventJd: row.eventJd,
            }
          : null,
      )
        .then((result) => applyTimedChartOpenResult(result))
        .catch((err) => console.error("[transit-list-open]", err))
        .finally(finishSnapshotCommand);
    },
    [applyTimedChartOpenResult, disabled, documentId, row, showRadix],
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
      void openDirectionsTimedChart(
        documentId,
        action,
        row.openDatetime,
        null,
        null,
        null,
        showRadix,
        row.technique === "converse_transits"
          ? {
              sourceTechnique: row.technique,
              symbolicWhenIso: row.displayDatetime,
              symbolicEventJd: row.eventJd,
            }
          : null,
      )
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
  activeId: string | null;
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
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="mr-1 min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">
            {t("tlview.point")}
          </span>
          <Button
            type="button"
            size="xs"
            variant={activeId === null ? "default" : "outline"}
            aria-pressed={activeId === null}
            onClick={() => onSelect(null)}
            className="h-6 max-w-44 justify-start gap-1 px-2 text-[length:var(--aries-font-size-small)]"
          >
            {t("tlview.all")}
          </Button>
        </div>
        {groups.map((group) => (
          <div key={group.group} className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="mr-1 min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">
              {group.group}
            </span>
            {group.items.map((item) => {
              const active = item.id === activeId;
              return (
                <Button
                  key={item.id}
                  type="button"
                  size="xs"
                  variant={active ? "default" : "outline"}
                  aria-pressed={active}
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
    const measureSync = (event: Event) => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if ((event as CustomEvent<{ beforePaint?: boolean }>).detail?.beforePaint) {
        flushSync(measureNow);
      } else {
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

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const maxTop = Math.max(
      0,
      rowCount * rowHeight - eventListBodyViewportHeight(scroller),
    );
    if (scroller.scrollTop <= maxTop) return;
    scroller.scrollTop = maxTop;
    dispatchVirtualScrollSync(scroller);
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

async function fetchTransitCursor({
  catalog,
  documentId,
  direction,
  includeTemporal,
  includeOrbTemporal,
  promittorIds,
  span,
  loadDirection,
  rowBudget,
  anchorDatetime,
  signal,
  sessionRef,
  onRows,
}: {
  catalog: TransitSearchCatalog;
  documentId: string;
  direction: TransitDirectionMode;
  includeTemporal: boolean;
  includeOrbTemporal: boolean;
  promittorIds: readonly string[] | null;
  span: TransitSpan;
  loadDirection: "around" | "previous" | "next";
  rowBudget: number;
  anchorDatetime: string;
  signal: AbortSignal;
  sessionRef: React.MutableRefObject<string | null>;
  onRows?: (payload: TransitSearchProgressResult) => void;
}): Promise<TransitSearchProgressResult> {
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
    promittorIds:
      promittorIds === null ? transitListPromittorIds(catalog) : [...promittorIds],
    significatorIds: transitListSignificatorIds(catalog),
    aspects: transitListAspectIds(catalog),
    includeSignChanges: false,
    includeTemporal,
    includeOrbTemporal,
    partFilter: "",
    limit: catalog.defaults.limit,
    persistSettings: false,
    ownerScope:
      includeTemporal || includeOrbTemporal
        ? "transit-list:temporal-confluence"
        : "transit-list",
    cursorDirection: loadDirection,
    cursorRowBudget: rowBudget,
    cursorAnchorDate: cursorAnchorDateForSpan(anchorDatetime, span),
  };
  const initial = await startTransitSearchContext(request, signal);
  let current = initial;
  const sessionId = current.sessionId;
  if (signal.aborted) {
    void cancelTransitSearch(sessionId).catch(() => undefined);
    throw new DOMException("Aborted", "AbortError");
  }
  sessionRef.current = current.complete ? null : sessionId;
  const cancelOnAbort = () => {
    if (sessionRef.current === sessionId) sessionRef.current = null;
    void cancelTransitSearch(sessionId).catch(() => undefined);
  };
  signal.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    current = await followTransitSearchProgress(
      current,
      signal,
      (next) => {
        current = next;
        if (sessionRef.current === sessionId) {
          sessionRef.current = current.complete ? null : sessionId;
        }
        onRows?.(current);
      },
    );
    if (current.cancelled || signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (current.error) {
      throw new Error(current.error);
    }
    return current;
  } finally {
    signal.removeEventListener("abort", cancelOnAbort);
    if (sessionRef.current === sessionId) sessionRef.current = null;
  }
}

function useTransitOptionsSeq(): number {
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastRetainedDataOptionsChange);
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

function normalizeTransitStore(
  store: TransitMonthStore,
  streamKey: string,
  islandNonce: number,
): TransitMonthStore {
  return {
    ...store,
    streamKey,
    islandNonce,
    exhaustedPrevious: store.exhaustedPrevious ?? false,
    exhaustedNext: store.exhaustedNext ?? false,
  };
}

function cursorPayloadReadyForSwap(payload: TransitSearchProgressResult): boolean {
  if (payload.cancelled || payload.error) return false;
  return (
    payload.complete
    || payload.cursor?.satisfied === true
    || payload.cursor?.exhausted === true
  );
}

function transitStoreFromCursorPayload(
  payload: TransitSearchProgressResult,
  island: { nonce: number; window: TransitSpan },
  streamKey: string,
): TransitMonthStore | null {
  if (!payload.cursor) {
    if (!payload.complete) return null;
    return {
      rows: [],
      coverage: island.window,
      coverageJdUt: null,
      islandNonce: island.nonce,
      streamKey,
      summary: payload.summary,
      truncated: payload.truncated,
      exhaustedPrevious: true,
      exhaustedNext: true,
    };
  }
  if (payload.rows.length === 0 && !payload.complete && !payload.cursor.exhausted) return null;
  return {
    rows: payload.rows,
    coverage: transitSpanForCursor(payload.cursor),
    coverageJdUt: temporalCoverageBounds(
      payload.cursor.coverageStartJdUt,
      payload.cursor.coverageEndJdUt,
    ),
    islandNonce: island.nonce,
    streamKey,
    summary: payload.summary,
    truncated: payload.truncated,
    exhaustedPrevious: payload.cursor.exhaustedPrevious,
    exhaustedNext: payload.cursor.exhaustedNext,
  };
}

function transitSpanForCursor(cursor: TransitSearchCursorState): TransitSpan {
  return {
    start: monthIndexForDate(cursor.coverageFrom),
    end: Math.min(
      TRANSIT_MAX_MONTH_INDEX + 1,
      monthIndexForDate(cursor.coverageTo) + 1,
    ),
  };
}

function stitchTransitCursorRows(
  currentRows: readonly TransitSearchRow[],
  cursorRows: readonly TransitSearchRow[],
  loadDirection: "previous" | "next",
): { rows: TransitSearchRow[]; prependedCount: number } {
  const seen = new Set(currentRows.map(transitStitchRowKey));
  const fresh = cursorRows.filter((row) => !seen.has(transitStitchRowKey(row)));
  const rows = [...currentRows, ...fresh].sort(compareTransitRows);
  const firstRetainedKey = currentRows.length > 0 ? transitStitchRowKey(currentRows[0]) : null;
  const firstRetainedIndex =
    firstRetainedKey === null
      ? 0
      : rows.findIndex((row) => transitStitchRowKey(row) === firstRetainedKey);
  return {
    rows,
    prependedCount:
      loadDirection === "previous" && firstRetainedIndex > 0 ? firstRetainedIndex : 0,
  };
}

function compareTransitRows(left: TransitSearchRow, right: TransitSearchRow): number {
  const leftMs = transitRowDateMs(left) ?? Number.POSITIVE_INFINITY;
  const rightMs = transitRowDateMs(right) ?? Number.POSITIVE_INFINITY;
  if (leftMs !== rightMs) return leftMs - rightMs;
  return transitStitchRowKey(left).localeCompare(transitStitchRowKey(right));
}

function bootstrapTransitRows(
  sourceRows: readonly TransitSearchRow[],
  activePromittorIds: readonly string[] | null,
): TransitSearchRow[] {
  if (activePromittorIds === null) return sourceRows.slice();
  const active = new Set(activePromittorIds);
  const filtered = sourceRows.filter((row) => active.has(row.promittorId));
  return filtered.length === sourceRows.length
    ? filtered
    : sourceRows.slice();
}

function transitScrollerAtEdge(
  scroller: HTMLDivElement | null,
  direction: "previous" | "next",
  thresholdPx: number,
): boolean {
  if (!scroller || scroller.clientHeight <= 0) return false;
  const maxTop = scroller.scrollHeight - scroller.clientHeight;
  if (maxTop <= 0) return false;
  return direction === "previous"
    ? scroller.scrollTop <= thresholdPx
    : maxTop - scroller.scrollTop <= thresholdPx;
}

function transitEdgeRetryDelay(attempt: number): number {
  const exponent = Math.max(
    0,
    Math.min(TRANSIT_EDGE_MAX_AUTO_RETRIES - 1, Math.trunc(attempt) - 1),
  );
  return TRANSIT_EDGE_RETRY_BASE_MS * 2 ** exponent;
}

function transitViewportKey(
  documentId: string,
  direction: TransitDirectionMode,
  promittorKey: string,
): string {
  return listCacheKey({ documentId, direction, promittorScope: promittorKey });
}

function cursorAnchorDateForSpan(value: string, span: TransitSpan): string {
  const range = monthSpanRange(span);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return range.fromDate;
  const candidate = isoDate(parsed);
  if (candidate < range.fromDate) return range.fromDate;
  if (candidate > range.toDate) return range.toDate;
  return candidate;
}

function rememberTransitStitchStore(key: string, store: TransitMonthStore): void {
  if (store.rows.length > TRANSIT_STITCH_CACHE_MAX_ROWS) {
    forgetListPayload(TRANSIT_STITCHED_CACHE, key);
    return;
  }
  rememberListPayload(TRANSIT_STITCHED_CACHE, key, store);
}

function stitchedTransitStoreCoversFocus(
  store: TransitMonthStore | null,
  span: TransitSpan,
  focusDatetime: string,
): boolean {
  if (!stitchedTransitStoreCoversSpan(store, span)) return false;
  const rowTimestamps = store ? transitRowsTimestamps(store.rows) : [];
  return transitFocusInsideResidentRows(
    rowTimestamps,
    resolveDateMs(focusDatetime),
    store?.exhaustedPrevious,
    store?.exhaustedNext,
  );
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
  const items: TransitPromittorItem[] = [];
  for (const id of transitListPromittorIds(catalog)) {
    const obj = objects.get(id);
    if (!obj) continue;
    items.push({
      id,
      label: obj.label,
      glyph: obj.glyph,
      marker: obj.displayMarker,
      group: transitPromittorGroupLabel(obj.family, t),
    });
  }
  return items;
}

function transitPromittorGroupLabel(family: string, t: TFunc): string {
  if (family === "planet") return t("tlview.planets");
  if (family === "node") return t("common.nodes");
  if (family === "angle") return t("styleLab.scene.angles");
  if (family === "fortune") return t("common.fortune");
  if (family === "fixed_star") return t("common.fixedStars");
  if (family === "syzygy") return t("common.syzygy");
  return t("dirview.points");
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

function monthSpanContainsMonth(
  outer: TransitSpan | null | undefined,
  monthIndex: number,
): boolean {
  return !!outer && outer.start <= monthIndex && monthIndex < outer.end;
}

function monthSpansEqual(left: TransitSpan, right: TransitSpan): boolean {
  return left.start === right.start && left.end === right.end;
}

function monthSpanAnchorIso(span: TransitSpan): string {
  const date = dateFromMonthIndex(span.start);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-01T12:00:00`;
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
  const toDate = new Date(0);
  toDate.setFullYear(last.getFullYear(), last.getMonth() + 1, 0);
  toDate.setHours(12, 0, 0, 0);
  return { fromDate: isoDate(first), toDate: isoDate(toDate) };
}

function dateFromMonthIndex(index: number): Date {
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const date = new Date(0);
  date.setFullYear(year, month, 1);
  date.setHours(12, 0, 0, 0);
  return date;
}

function isoDate(value: Date): string {
  return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
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

function sameTransitFocusInstant(left?: string | null, right?: string | null): boolean {
  const leftMs = parseDateMs(left);
  const rightMs = parseDateMs(right);
  if (leftMs != null && rightMs != null) return Math.abs(leftMs - rightMs) < 1000;
  return (left ?? null) === (right ?? null);
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

function transitRowsTimestamps(rows: readonly TransitSearchRow[]): number[] {
  return rows.map((row) => transitRowDateMs(row) ?? Number.POSITIVE_INFINITY);
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

type TransitFocusResidentPosition = "inside" | "before" | "after" | "empty" | "invalid";

function transitFocusResidentPosition(
  rowTimestamps: readonly number[],
  targetMs: number,
): TransitFocusResidentPosition {
  if (!Number.isFinite(targetMs)) return "invalid";
  let firstTimestamp = Number.POSITIVE_INFINITY;
  let lastTimestamp = Number.NEGATIVE_INFINITY;
  for (const value of rowTimestamps) {
    if (!Number.isFinite(value)) continue;
    if (firstTimestamp === Number.POSITIVE_INFINITY) firstTimestamp = value;
    lastTimestamp = value;
  }
  if (firstTimestamp === Number.POSITIVE_INFINITY) return "empty";
  if (targetMs < firstTimestamp) return "before";
  if (targetMs > lastTimestamp) return "after";
  return "inside";
}

function transitFocusInsideResidentRows(
  rowTimestamps: readonly number[],
  targetMs: number,
  exhaustedPrevious = false,
  exhaustedNext = false,
): boolean {
  const position = transitFocusResidentPosition(rowTimestamps, targetMs);
  return (
    position === "inside"
    || (position === "before" && exhaustedPrevious)
    || (position === "after" && exhaustedNext)
  );
}

function nearestTransitTimestampIndex(
  rowTimestamps: readonly number[],
  targetMs: number,
): number {
  if (!rowTimestamps.length) return -1;
  let low = 0;
  let high = rowTimestamps.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (rowTimestamps[mid] < targetMs) low = mid + 1;
    else high = mid;
  }
  if (low <= 0) return 0;
  if (low >= rowTimestamps.length) return rowTimestamps.length - 1;
  const before = rowTimestamps[low - 1];
  const after = rowTimestamps[low];
  return targetMs - before <= after - targetMs ? low - 1 : low;
}

function scrollFocusedTransitRow(
  scroller: HTMLDivElement | null,
  rowCount: number,
  anchorRatio: number,
  targetIndex: number,
  rowHeight: number,
  markProgrammaticScroll: (scroller: HTMLDivElement) => void,
): boolean {
  const viewportHeight = eventListBodyViewportHeight(scroller);
  if (
    !scroller
    || rowCount <= 0
    || targetIndex < 0
    || rowHeight <= 0
    || viewportHeight <= 0
  ) {
    return false;
  }
  const rowTop = targetIndex * rowHeight;
  const rowBottom = rowTop + rowHeight;
  const viewportTop = scroller.scrollTop;
  const viewportBottom = viewportTop + viewportHeight;
  if (rowTop >= viewportTop && rowBottom <= viewportBottom) return true;
  const targetTop = rowTop - viewportHeight * anchorRatio + rowHeight / 2;
  const maxTop = Math.max(0, rowCount * rowHeight - viewportHeight);
  const nextTop = Math.max(0, Math.min(maxTop, targetTop));
  if (Math.abs(scroller.scrollTop - nextTop) <= 1) return true;
  markProgrammaticScroll(scroller);
  scroller.scrollTop = nextTop;
  dispatchVirtualScrollSync(scroller, true);
  return true;
}

function scheduleFocusedTransitScroll(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  rowIndex: number,
  rowCount: number,
  anchorRatio: number,
  rowHeight: number,
  markProgrammaticScroll: (scroller: HTMLDivElement) => void,
): () => void {
  if (rowIndex < 0 || rowCount <= 0) return () => {};
  let frame = 0;
  let attempts = 0;
  let cancelled = false;
  const tick = () => {
    if (cancelled) return;
    const scroller = scrollerRef.current;
    if (
      scrollFocusedTransitRow(
        scroller,
        rowCount,
        anchorRatio,
        rowIndex,
        rowHeight,
        markProgrammaticScroll,
      )
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
