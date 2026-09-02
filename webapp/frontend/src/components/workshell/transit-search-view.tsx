// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { ArrowDown, ArrowUp, Clipboard, ListFilter, Search, Settings2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  cancelTransitSearch,
  fetchTransitSearchCatalog,
  fetchTransitSearchContextCatalog,
  followTransitSearchProgress,
  openDirectionsTimedChart,
  saveTransitSearchContextSettings,
  saveTransitSearchSettings,
  startTransitSearch,
  startTransitSearchContext,
  type EventTimeDisplayMeta,
  type MoonPhaseFilter,
  type TimedChartAction,
  type TransitSearchCatalog,
  type TransitSearchMotionFilter,
  type TransitSearchProgressResult,
  type TransitSearchRequest,
  type TransitSearchTechnique,
  type TransitSearchObject,
  type TransitSearchObjectSegment,
  type TransitSearchRow,
  exportSearchRows,
  updateSearchContextDefaultRange,
  updateSearchDefaultRange,
} from "@/lib/daemon/client";
import {
  coerceDateConvention,
  formatIsoDateDisplay,
  parseDateDisplayInput,
  type DateConvention,
} from "@/lib/date-display";
import { eventListBodyViewportHeight } from "@/lib/event-list-time";
import {
  LIST_ROLE_CLASSES,
  useFixedRowHeightAnchor,
  useListRowHeight,
} from "@/lib/list-tokens";
import { useT, useTFallback, type TFunc } from "@/lib/i18n/i18n";
import {
  getCachedListPayload,
  rememberListPayload,
} from "@/lib/table/payload-cache";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { cn } from "@/lib/utils";
import { type ListFollowPolicy } from "@/lib/list-follow-policy";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useFrameLayoutStore, type SearchFiltersDock } from "@/stores/frame-layout-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { beginWorkspaceSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";
import {
  ListLayoutPresetControl,
  listKeyDisplayOrder,
  useListLayoutPreset,
} from "./list-column-layout";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";
import { useEdgeExtend } from "./stitched-list-harness";

type SearchForm = {
  fromDate: string;
  toDate: string;
  techniques: string[];
  promittorIds: string[];
  significatorIds: string[];
  aspects: string[];
  includeSignChanges: boolean;
  promittorMotion: TransitSearchMotionFilter;
  significatorMotion: TransitSearchMotionFilter;
  moonPhase: MoonPhaseFilter;
  lunationOrb: number;
  partFilter: string;
  limit: number;
};

type SelectionKey = "techniques" | "promittorIds" | "significatorIds" | "aspects";
type SearchColumnKey = "date" | "time" | "aspect" | "mz" | "dc" | "from" | "to" | "technique";
type SearchSortState = {
  column: SearchColumnKey;
  ascending: boolean;
};
type SearchDisplay = TransitSearchRow["promDisplay"];
type TransitSearchCacheEntry = {
  optionsSeq: number;
  catalog: TransitSearchCatalog;
  form: SearchForm;
  rows: TransitSearchRow[];
  summary: string;
  timeDisplay: EventTimeDisplayMeta | null;
  rangeStream: SearchRangeStream | null;
};
type SearchRangeStream = {
  queryKey: string;
  queryForm?: SearchForm;
  rangeFrom: string;
  rangeTo: string;
  coverageFrom: string;
  coverageTo: string;
  exhaustedNext: boolean;
};
type RetainedSearchDeltaPlan = {
  universeForm: SearchForm;
  deltaForms: SearchForm[];
  rangeForms: SearchForm[];
  extendsRangeBefore: boolean;
  extendsRangeAfter: boolean;
};
type SearchObjectFilterAnchor = {
  rowKey: string;
  eventJd: number | null;
  sourceIndex: number;
  withinRowOffset: number;
};
type SearchOpenTimedChart = (row: TransitSearchRow, action: TimedChartAction) => void;

const TRANSIT_SEARCH_CACHE = "transit-search";
const EMPTY_SEARCH_ROWS: TransitSearchRow[] = [];
const SEARCH_VIRTUAL_OVERSCAN_ROWS = 12;
const SEARCH_VIRTUAL_SCROLL_SYNC_EVENT = "aries:search-virtual-scroll-sync";
const SEARCH_INITIAL_MIN_ROWS = 96;
const SEARCH_EDGE_MIN_ROWS = 48;
const SEARCH_RETAINED_LUNATION_ORB = 15;
const SEARCH_LUNAR_TECHNIQUES = new Set(["lunations", "eclipses"]);
const SEARCH_NON_ASPECT_TECHNIQUES = new Set(["heliacal_phases"]);

const SEARCH_COLUMNS: Record<SearchColumnKey, { labelKey: string; headClass: string }> = {
  date: { labelKey: "search.date", headClass: "text-center" },
  time: { labelKey: "search.time", headClass: "text-center" },
  aspect: { labelKey: "search.fromTo", headClass: "text-center" },
  mz: { labelKey: "search.mz", headClass: "text-center" },
  dc: { labelKey: "search.dc", headClass: "text-center" },
  from: { labelKey: "search.from", headClass: "text-center" },
  to: { labelKey: "search.to", headClass: "text-center" },
  technique: { labelKey: "search.tech", headClass: "text-center" },
};

const TECHNIQUE_DISPLAY_LABEL_KEYS: Record<string, string> = {
  transits: "search.techTransits",
  converse_transits: "search.techConverseTransits",
  profections: "search.techProfections",
  secondary_directions: "search.techSecondaryProgressions",
  primary_directions: "search.techPrimaryDirections",
  mundane_weather: "search.techCelestialWeather",
  heliacal_phases: "search.techHeliacalPhases",
  lunations: "search.techLunations",
  eclipses: "search.techEclipses",
  sign_changes: "search.techIngressSynodic",
};

type TransitSearchViewProps =
  | {
      mode?: "document";
      documentId: string;
      sourceName: string;
      followPolicy?: ListFollowPolicy;
      onClose?: () => void;
    }
  | {
      mode: "context";
      documentId: string;
      sourceName?: string;
      significatorId?: string | null;
      chartRole?: "primary" | "outer" | null;
      customPoints?: Record<string, unknown>[];
      label?: string;
      glyph?: string;
      followPolicy?: ListFollowPolicy;
      onClose?: () => void;
    };

export function TransitSearchView(props: TransitSearchViewProps) {
  const t = useT();
  const tf = useTFallback();
  const {
    documentId,
    onClose,
  } = props;
  const contextMode = props.mode === "context";
  const sourceName = props.sourceName ?? "";
  const significatorId = contextMode ? props.significatorId ?? null : null;
  const chartRole = contextMode ? props.chartRole ?? null : null;
  const rawCustomPoints = contextMode ? props.customPoints : undefined;
  const customPointsKey = React.useMemo(() => JSON.stringify(rawCustomPoints ?? []), [rawCustomPoints]);
  const customPoints = React.useMemo<Record<string, unknown>[]>(() => {
    try {
      const parsed = JSON.parse(customPointsKey) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    } catch {
      return [];
    }
  }, [customPointsKey]);
  const catalogContextKey = React.useMemo(
    () => JSON.stringify({ contextMode, documentId, significatorId, chartRole, customPointsKey }),
    [chartRole, contextMode, customPointsKey, documentId, significatorId],
  );
  const cachedForContext = React.useMemo(
    () => getCachedListPayload<TransitSearchCacheEntry>(TRANSIT_SEARCH_CACHE, catalogContextKey),
    [catalogContextKey],
  );
  const optionsSeq = useTransitSearchOptionsSeq(cachedForContext?.optionsSeq ?? 0);
  const initialCache = React.useMemo(
    () => cachedForContext?.optionsSeq === optionsSeq ? cachedForContext : null,
    [cachedForContext, optionsSeq],
  );
  const [catalog, setCatalog] = React.useState<TransitSearchCatalog | null>(() => initialCache?.catalog ?? null);
  const [form, setForm] = React.useState<SearchForm | null>(() => initialCache?.form ?? null);
  const [rows, setRows] = React.useState<TransitSearchRow[]>(() => initialCache?.rows ?? []);
  const [timeDisplay, setTimeDisplay] = React.useState<EventTimeDisplayMeta | null>(
    () => initialCache?.timeDisplay ?? initialCache?.catalog.timeDisplay ?? null,
  );
  const [rangeStream, setRangeStream] = React.useState<SearchRangeStream | null>(
    () => initialCache?.rangeStream ?? null,
  );
  const [sort, setSort] = React.useState<SearchSortState | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = React.useState<Set<string>>(() => new Set());
  const [contextRowKey, setContextRowKey] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState(initialCache?.summary ?? t("search.noResults"));
  const [catalogOptionsSeq, setCatalogOptionsSeq] = React.useState(() => (initialCache ? optionsSeq : -1));
  const [catalogLoading, setCatalogLoading] = React.useState(false);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [filtersOpen, setFiltersOpen] = React.useState(true);
  const filtersDock = useFrameLayoutStore((state) => state.searchFiltersDock);
  const setFiltersDock = useFrameLayoutStore((state) => state.setSearchFiltersDock);
  const [rangeDraft, setRangeDraft] = React.useState({ offsetMonths: -2, rangeMonths: 12, lifetimeYears: 100 });
  const catalogRef = React.useRef<TransitSearchCatalog | null>(initialCache?.catalog ?? null);
  const searchControllerRef = React.useRef<AbortController | null>(null);
  const rangeExtendControllerRef = React.useRef<AbortController | null>(null);
  const rangeExtendInFlightRef = React.useRef(false);
  const rangeStreamRef = React.useRef<SearchRangeStream | null>(initialCache?.rangeStream ?? null);
  const rowsRef = React.useRef<TransitSearchRow[]>(initialCache?.rows ?? []);
  const [edgeCheckNonce, setEdgeCheckNonce] = React.useState(0);
  const currentSearchSessionRef = React.useRef<string | null>(null);
  const searchRequestSeqRef = React.useRef(0);
  const settingsControllerRef = React.useRef<AbortController | null>(null);
  const lastAutoRequestKeyRef = React.useRef("");
  const lastCatalogContextKeyRef = React.useRef("");
  const searchScrollerRef = React.useRef<HTMLDivElement | null>(null);
  const objectFilterAnchorRef = React.useRef<SearchObjectFilterAnchor | null>(null);
  const applyTimedChartOpenResult = useWorkspaceStore((s) => s.applyTimedChartOpenResult);
  const showRadix = useWorkspaceStore((s) => s.timedChartShowRadix);

  const rememberSearchState = React.useCallback(
    (entry: TransitSearchCacheEntry) => {
      rememberListPayload(TRANSIT_SEARCH_CACHE, catalogContextKey, { ...entry, optionsSeq });
    },
    [catalogContextKey, optionsSeq],
  );

  React.useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);
  React.useEffect(() => {
    rangeStreamRef.current = rangeStream;
  }, [rangeStream]);
  React.useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  React.useEffect(() => {
    if (!catalog || !form) return;
    rememberSearchState({ optionsSeq, catalog, form, rows, summary, timeDisplay, rangeStream });
  }, [catalog, form, optionsSeq, rangeStream, rememberSearchState, rows, summary, timeDisplay]);

  const buildRequest = React.useCallback(
    (nextForm: SearchForm, persistSettings = true) => ({
      documentId,
      fromDate: nextForm.fromDate,
      toDate: nextForm.toDate,
      techniques: nextForm.techniques,
      promittorIds: nextForm.promittorIds,
      significatorIds: nextForm.significatorIds,
      aspects: nextForm.aspects,
      includeSignChanges: nextForm.includeSignChanges,
      promittorMotion: nextForm.promittorMotion,
      significatorMotion: nextForm.significatorMotion,
      moonPhase: nextForm.moonPhase,
      lunationOrb: nextForm.lunationOrb,
      partFilter: nextForm.partFilter,
      limit: nextForm.limit,
      persistSettings,
    }),
    [documentId],
  );

  const startSearchRequest = React.useCallback(
    (request: TransitSearchRequest, signal: AbortSignal) =>
      contextMode
        ? startTransitSearchContext(
            {
              ...request,
              significatorId,
              chartRole,
              customPoints,
            },
            signal,
          )
        : startTransitSearch(request, signal),
    [chartRole, contextMode, customPoints, significatorId],
  );

  const executeSearch = React.useCallback(
    (nextForm: SearchForm, options?: { persistSettings?: boolean; displayForm?: SearchForm }) => {
      const requestSeq = searchRequestSeqRef.current + 1;
      searchRequestSeqRef.current = requestSeq;
      lastAutoRequestKeyRef.current = buildAutoRequestKey({
        contextMode,
        significatorId,
        chartRole,
        customPointsKey,
        optionsSeq,
        form: nextForm,
      });
      const previousSessionId = currentSearchSessionRef.current;
      if (previousSessionId) {
        currentSearchSessionRef.current = null;
        void cancelTransitSearch(previousSessionId).catch(() => undefined);
      }
      searchControllerRef.current?.abort();
      rangeExtendControllerRef.current?.abort();
      rangeExtendControllerRef.current = null;
      rangeExtendInFlightRef.current = false;
      const controller = new AbortController();
      searchControllerRef.current = controller;
      setSearchLoading(true);
      setError(null);
      const seed = searchSeedRange(nextForm.fromDate, nextForm.toDate);
      const nextRangeStream = seed
        ? {
            queryKey: searchRangeQueryKey(nextForm),
            queryForm: nextForm,
            rangeFrom: nextForm.fromDate,
            rangeTo: nextForm.toDate,
            coverageFrom: seed.fromDate,
            coverageTo: "",
            exhaustedNext: false,
          }
        : null;
      rangeStreamRef.current = nextRangeStream;
      setRangeStream(nextRangeStream);
      const request: TransitSearchRequest = {
        ...buildRequest(nextForm, options?.persistSettings ?? true),
        ...(seed
          ? {
              fromDate: seed.fromDate,
              toDate: seed.toDate,
              ownerScope: "search:range",
              cursorDirection: "next" as const,
              cursorRowBudget: SEARCH_INITIAL_MIN_ROWS,
              cursorAnchorDate: seed.fromDate,
              cursorRangeFrom: nextForm.fromDate,
              cursorRangeTo: nextForm.toDate,
            }
          : {}),
      };
      let lastProgressKey = "";
      let swappedRangeRows = false;
      const applyProgress = (result: TransitSearchProgressResult) => {
        if (controller.signal.aborted || searchRequestSeqRef.current !== requestSeq) return;
        if (result.error) {
          throw new Error(result.error);
        }
        if (result.rows.length === 0 && !result.cursor && !result.complete) return;
        const progressKey = [
          result.phase,
          result.rows.length,
          result.truncated ? "1" : "0",
          result.complete ? "1" : "0",
          result.summary,
          result.timeDisplay?.columnLabel ?? "",
          result.timeDisplay?.offsetsMinutes.join(",") ?? "",
          result.cursor?.coverageFrom ?? "",
          result.cursor?.coverageTo ?? "",
        ].join(":");
        if (progressKey === lastProgressKey) return;
        lastProgressKey = progressKey;
        const nextTimeDisplay = result.timeDisplay ?? catalogRef.current?.timeDisplay ?? null;
        const nextRows = normalizeSearchStreamRows(result.rows);
        const cursor = result.cursor;
        const stream = cursor
          ? {
              queryKey: searchRangeQueryKey(nextForm),
              queryForm: nextForm,
              rangeFrom: cursor.rangeFrom,
              rangeTo: cursor.rangeTo,
              coverageFrom: cursor.coverageFrom,
              coverageTo: cursor.coverageTo,
              exhaustedNext: cursor.exhaustedNext,
            }
          : nextRangeStream;
        rangeStreamRef.current = stream;
        React.startTransition(() => {
          setRows((current) => (
            searchRequestSeqRef.current === requestSeq ? nextRows : current
          ));
          setSelectedRowKeys((current) => (
            searchRequestSeqRef.current === requestSeq ? new Set() : current
          ));
          setSummary((current) => {
            if (searchRequestSeqRef.current !== requestSeq) return current;
            if (!options?.displayForm) return result.summary;
            const visibleCount = projectTransitSearchRows(nextRows, options.displayForm).length;
            return t("search.resultCount").replace("{count}", String(visibleCount));
          });
          setTimeDisplay((current) => (
            searchRequestSeqRef.current === requestSeq ? nextTimeDisplay : current
          ));
          setRangeStream((current) => (
            searchRequestSeqRef.current === requestSeq ? stream : current
          ));
        });
        if (nextRows.length > 0 && !swappedRangeRows) {
          swappedRangeRows = true;
          requestAnimationFrame(() => {
            const scroller = searchScrollerRef.current;
            if (!scroller || controller.signal.aborted) return;
            scroller.scrollTop = 0;
            scroller.dispatchEvent(new Event(SEARCH_VIRTUAL_SCROLL_SYNC_EVENT));
          });
        }
      };
      const startPromise = startSearchRequest(request, controller.signal);
      let startedSessionId = "";
      void startPromise
        .then(async (initial) => {
          if (controller.signal.aborted) {
            void cancelTransitSearch(initial.sessionId).catch(() => undefined);
            return;
          }
          startedSessionId = initial.sessionId;
          currentSearchSessionRef.current = initial.sessionId;
          await followTransitSearchProgress(initial, controller.signal, applyProgress);
        })
        .catch((err) => {
          if (
            (err as { name?: string }).name === "AbortError"
            || searchRequestSeqRef.current !== requestSeq
          ) return;
          setError((err as Error).message);
          setSelectedRowKeys(new Set());
          setSummary(t("search.searchFailed"));
        })
        .finally(() => {
          if (searchControllerRef.current === controller) {
            setSearchLoading(false);
          }
          if (startedSessionId && currentSearchSessionRef.current === startedSessionId) {
            currentSearchSessionRef.current = null;
          }
        });
    },
    [buildRequest, chartRole, contextMode, customPointsKey, optionsSeq, significatorId, startSearchRequest, t],
  );

  const saveSettings = React.useCallback(
    (nextForm: SearchForm) => {
      settingsControllerRef.current?.abort();
      const controller = new AbortController();
      settingsControllerRef.current = controller;
      const request = buildRequest(nextForm);
      const promise = contextMode
        ? saveTransitSearchContextSettings(
            {
              ...request,
              significatorId,
              chartRole,
              customPoints,
            },
            controller.signal,
          )
        : saveTransitSearchSettings(request, controller.signal);
      void promise
        .catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          setError((err as Error).message);
        })
        .finally(() => {
          if (settingsControllerRef.current === controller) {
            settingsControllerRef.current = null;
          }
        });
    },
    [buildRequest, chartRole, contextMode, customPoints, significatorId],
  );

  const extendRetainedSearchUniverse = React.useCallback(
    (activeForm: SearchForm, plan: RetainedSearchDeltaPlan) => {
      const current = rangeStreamRef.current;
      if (
        !current?.coverageFrom
        || !current.coverageTo
        || (plan.deltaForms.length === 0 && plan.rangeForms.length === 0)
      ) {
        return false;
      }
      const requestSeq = searchRequestSeqRef.current + 1;
      searchRequestSeqRef.current = requestSeq;
      const previousSessionId = currentSearchSessionRef.current;
      if (previousSessionId) {
        currentSearchSessionRef.current = null;
        void cancelTransitSearch(previousSessionId).catch(() => undefined);
      }
      searchControllerRef.current?.abort();
      rangeExtendControllerRef.current?.abort();
      rangeExtendControllerRef.current = null;
      rangeExtendInFlightRef.current = false;
      const controller = new AbortController();
      searchControllerRef.current = controller;
      setSearchLoading(true);
      setError(null);
      saveSettings(activeForm);

      const load = async () => {
        let mergedRows = rowsRef.current;
        let nextTimeDisplay = catalogRef.current?.timeDisplay ?? null;
        let prependedCoverageTo = "";
        const slices = [
          ...plan.deltaForms.map((deltaForm) => ({
            form: deltaForm,
            fromDate: current.coverageFrom,
            toDate: current.coverageTo,
            fillEntireSlice: true,
          })),
          ...plan.rangeForms.map((rangeForm) => ({
            form: rangeForm,
            fromDate: rangeForm.fromDate,
            toDate: rangeForm.toDate,
            fillEntireSlice: false,
          })),
        ];
        for (const slice of slices) {
          let nextFrom = slice.fromDate;
          while (nextFrom <= slice.toDate) {
            if (controller.signal.aborted || searchRequestSeqRef.current !== requestSeq) return;
            const seed = searchSeedRange(nextFrom, slice.toDate);
            if (!seed) break;
            const request: TransitSearchRequest = {
              ...buildRequest(slice.form, false),
              fromDate: seed.fromDate,
              toDate: seed.toDate,
              ownerScope: "search:range",
              cursorDirection: "next",
              cursorRowBudget: slice.fillEntireSlice ? 500 : SEARCH_INITIAL_MIN_ROWS,
              cursorAnchorDate: seed.fromDate,
              cursorRangeFrom: slice.fromDate,
              cursorRangeTo: slice.toDate,
            };
            const initial = await startSearchRequest(request, controller.signal);
            if (controller.signal.aborted || searchRequestSeqRef.current !== requestSeq) {
              void cancelTransitSearch(initial.sessionId).catch(() => undefined);
              return;
            }
            currentSearchSessionRef.current = initial.sessionId;
            const final = await followTransitSearchProgress(
              initial,
              controller.signal,
              (result) => {
                if (controller.signal.aborted || searchRequestSeqRef.current !== requestSeq) return;
                if (result.error) throw new Error(result.error);
                mergedRows = mergeSearchStreamRows(mergedRows, result.rows);
                nextTimeDisplay = result.timeDisplay ?? nextTimeDisplay;
              },
            );
            if (final.error) throw new Error(final.error);
            const coverageTo = final.cursor?.coverageTo ?? slice.toDate;
            if (!slice.fillEntireSlice) {
              prependedCoverageTo = coverageTo;
              break;
            }
            if (coverageTo >= slice.toDate || final.cursor?.exhaustedNext) break;
            const following = nextIsoDate(coverageTo);
            if (!following || following <= nextFrom) break;
            nextFrom = following;
          }
        }
        if (controller.signal.aborted || searchRequestSeqRef.current !== requestSeq) return;
        const nextStream: SearchRangeStream = {
          ...current,
          queryKey: searchRangeQueryKey(plan.universeForm),
          queryForm: plan.universeForm,
          rangeFrom: plan.universeForm.fromDate,
          rangeTo: plan.universeForm.toDate,
          coverageFrom: plan.extendsRangeBefore
            ? plan.universeForm.fromDate
            : current.coverageFrom,
          coverageTo: plan.extendsRangeBefore && prependedCoverageTo
            ? prependedCoverageTo
            : current.coverageTo,
          exhaustedNext: plan.extendsRangeAfter ? false : current.exhaustedNext,
        };
        rowsRef.current = mergedRows;
        rangeStreamRef.current = nextStream;
        React.startTransition(() => {
          setRows(mergedRows);
          setSummary(t("search.resultCount").replace(
            "{count}",
            String(projectTransitSearchRows(mergedRows, activeForm).length),
          ));
          setTimeDisplay(nextTimeDisplay);
          setRangeStream(nextStream);
        });
      };

      void load()
        .catch((err) => {
          if (
            (err as { name?: string }).name === "AbortError"
            || searchRequestSeqRef.current !== requestSeq
          ) return;
          setError((err as Error).message);
        })
        .finally(() => {
          if (searchControllerRef.current === controller) {
            setSearchLoading(false);
          }
          const sessionId = currentSearchSessionRef.current;
          if (sessionId) {
            currentSearchSessionRef.current = null;
          }
        });
      return true;
    },
    [buildRequest, saveSettings, startSearchRequest, t],
  );

  const refreshRetainedSearch = React.useCallback(
    (activeForm: SearchForm, options?: { persistSettings?: boolean }) => {
      const sourceForm = rangeStreamRef.current?.queryForm ?? null;
      const plan = retainedSearchDeltaPlan(sourceForm, activeForm);
      if (plan && plan.deltaForms.length === 0 && plan.rangeForms.length === 0) {
        if (options?.persistSettings ?? true) saveSettings(activeForm);
        setSummary(t("search.resultCount").replace(
          "{count}",
          String(projectTransitSearchRows(rowsRef.current, activeForm).length),
        ));
        const current = rangeStreamRef.current;
        if (current && searchRangeQueryKey(current.queryForm ?? activeForm) !== searchRangeQueryKey(plan.universeForm)) {
          const nextStream: SearchRangeStream = {
            ...current,
            queryKey: searchRangeQueryKey(plan.universeForm),
            queryForm: plan.universeForm,
            rangeFrom: plan.universeForm.fromDate,
            rangeTo: plan.universeForm.toDate,
            exhaustedNext: plan.extendsRangeAfter ? false : current.exhaustedNext,
          };
          rangeStreamRef.current = nextStream;
          setRangeStream(nextStream);
        }
        return;
      }
      if (plan && extendRetainedSearchUniverse(activeForm, plan)) return;
      if (options?.persistSettings ?? true) saveSettings(activeForm);
      executeSearch(retainedSearchSourceForm(activeForm), {
        persistSettings: false,
        displayForm: activeForm,
      });
    },
    [executeSearch, extendRetainedSearchUniverse, saveSettings, t],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    searchRequestSeqRef.current += 1;
    searchControllerRef.current?.abort();
    const cachedEntry = getCachedListPayload<TransitSearchCacheEntry>(TRANSIT_SEARCH_CACHE, catalogContextKey);
    const cached = cachedEntry?.optionsSeq === optionsSeq ? cachedEntry : null;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setCatalogLoading(true);
      setError(null);
      if (cached) {
        catalogRef.current = cached.catalog;
        setCatalog(cached.catalog);
        setForm(cached.form);
        setRows(cached.rows);
        setRangeStream(cached.rangeStream ?? null);
        setSummary(cached.summary);
        const cachedTimeDisplay = cached.timeDisplay ?? cached.catalog.timeDisplay ?? null;
        setTimeDisplay(cachedTimeDisplay);
      } else {
        setRows([]);
        setRangeStream(null);
        setTimeDisplay(null);
        setSummary(catalogOptionsSeq === optionsSeq ? t("search.noResults") : t("search.updatingSearch"));
      }
      setSelectedRowKeys(new Set());
    });
    const promise = contextMode
      ? fetchTransitSearchContextCatalog(
          {
            documentId,
            significatorId,
            chartRole,
            customPoints,
          },
          controller.signal,
        )
      : fetchTransitSearchCatalog(documentId, controller.signal);
    promise
      .then((data) => {
        const workbenchRange = data.defaults.hasSavedState
          && data.defaults.workbenchFromDate
          && data.defaults.workbenchToDate
          ? {
              fromDate: data.defaults.workbenchFromDate,
              toDate: data.defaults.workbenchToDate,
            }
          : {
              fromDate: data.defaults.fromDate,
              toDate: data.defaults.toDate,
            };
        const defaults = {
          ...workbenchRange,
          techniques: data.defaults.techniques,
          promittorIds: data.defaults.promittorIds,
          significatorIds: data.defaults.significatorIds,
          aspects: data.defaults.aspects,
          includeSignChanges: data.defaults.includeSignChanges,
          promittorMotion: data.defaults.promittorMotion,
          significatorMotion: data.defaults.significatorMotion,
          moonPhase: data.defaults.moonPhase,
          lunationOrb: data.defaults.lunationOrb,
          partFilter: data.defaults.partFilter,
          limit: data.defaults.limit,
        };
        catalogRef.current = data;
        setCatalog(data);
        setTimeDisplay(cached?.timeDisplay ?? data.timeDisplay ?? null);
        setCatalogOptionsSeq(optionsSeq);
        setForm((prev) => {
          const sameCatalogContext = lastCatalogContextKeyRef.current === catalogContextKey;
          lastCatalogContextKeyRef.current = catalogContextKey;
          return sameCatalogContext && prev ? preserveCatalogSelections(defaults, prev, data) : defaults;
        });
        setRangeDraft({
          offsetMonths: data.defaults.defaultOffsetMonths,
          rangeMonths: data.defaults.defaultRangeMonths,
          lifetimeYears: data.defaults.lifetimeYears,
        });
        if (contextMode && data.initialSignificatorId && canRunSearch(defaults)) {
          lastAutoRequestKeyRef.current = buildAutoRequestKey({
            contextMode,
            significatorId,
            chartRole,
            customPointsKey,
            optionsSeq,
            form: defaults,
          });
          refreshRetainedSearch(defaults, { persistSettings: false });
        }
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setError((err as Error).message);
      })
      .finally(() => setCatalogLoading(false));
    return () => controller.abort();
  }, [
    catalogContextKey,
    catalogOptionsSeq,
    chartRole,
    contextMode,
    customPoints,
    customPointsKey,
    documentId,
    refreshRetainedSearch,
    optionsSeq,
    significatorId,
    t,
  ]);

  React.useEffect(() => {
    return () => {
      searchRequestSeqRef.current += 1;
      const sessionId = currentSearchSessionRef.current;
      if (sessionId) {
        currentSearchSessionRef.current = null;
        void cancelTransitSearch(sessionId).catch(() => undefined);
      }
      searchControllerRef.current?.abort();
      rangeExtendControllerRef.current?.abort();
      settingsControllerRef.current?.abort();
    };
  }, []);

  React.useEffect(() => {
    if (!catalog || !form) return;
    if (catalogOptionsSeq !== optionsSeq) return;
    const key = buildAutoRequestKey({
      contextMode,
      significatorId,
      chartRole,
      customPointsKey,
      optionsSeq,
      form,
    });
    if (lastAutoRequestKeyRef.current === key) return;
    lastAutoRequestKeyRef.current = key;
    const timer = window.setTimeout(() => {
      if (canRunSearch(form)) {
        refreshRetainedSearch(form);
      } else {
        saveSettings(form);
        setSummary(t("search.noValidCombinations"));
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    catalog,
    catalogOptionsSeq,
    contextMode,
    customPointsKey,
    refreshRetainedSearch,
    form,
    saveSettings,
    significatorId,
    chartRole,
    optionsSeq,
    t,
  ]);

  const objectsById = React.useMemo(() => {
    const map = new Map<string, TransitSearchObject>();
    for (const obj of catalog?.objects ?? []) map.set(obj.id, obj);
    return map;
  }, [catalog]);

  const promittors = React.useMemo(
    () => (catalog?.promittorIds ?? []).map((id) => objectsById.get(id)).filter(isObject),
    [catalog, objectsById],
  );
  const techniques = catalog?.techniques ?? [];
  const significators = React.useMemo(
    () => (catalog?.significatorIds ?? []).map((id) => objectsById.get(id)).filter(isObject),
    [catalog, objectsById],
  );
  const partObjects = React.useMemo(
    () => (catalog?.partIds ?? []).map((id) => objectsById.get(id)).filter(isObject),
    [catalog, objectsById],
  );
  const builtinSignificators = React.useMemo(() => {
    const builtinSet = new Set(catalog?.builtinSignificatorIds ?? []);
    return significators.filter((obj) => builtinSet.has(obj.id));
  }, [catalog, significators]);
  const createdSignificators = React.useMemo(() => {
    const builtinSet = new Set(catalog?.builtinSignificatorIds ?? []);
    const partSet = new Set(catalog?.partIds ?? []);
    return significators.filter((obj) => !builtinSet.has(obj.id) && !partSet.has(obj.id));
  }, [catalog, significators]);
  const filteredPartObjects = React.useMemo(() => {
    const filter = (form?.partFilter ?? "").trim().toLowerCase();
    if (!filter) return partObjects;
    return partObjects.filter((obj) => obj.label.toLowerCase().includes(filter));
  }, [form?.partFilter, partObjects]);

  const layoutPreset = useListLayoutPreset();
  const searchRowHeight = useListRowHeight("dense");
  const sortedSourceRows = React.useMemo(() => sortTransitSearchRows(rows, sort), [rows, sort]);
  const sortedRows = React.useMemo(
    () => projectTransitSearchRows(sortedSourceRows, form),
    [form, sortedSourceRows],
  );

  const prepareObjectFilterChange = React.useCallback(() => {
    const scroller = searchScrollerRef.current;
    if (!scroller || sortedRows.length === 0) {
      objectFilterAnchorRef.current = null;
      return;
    }
    const sourceIndex = Math.max(
      0,
      Math.min(sortedRows.length - 1, Math.floor(scroller.scrollTop / searchRowHeight)),
    );
    const row = sortedRows[sourceIndex];
    objectFilterAnchorRef.current = {
      rowKey: row.key,
      eventJd: row.eventJd,
      sourceIndex,
      withinRowOffset: scroller.scrollTop - sourceIndex * searchRowHeight,
    };
  }, [searchRowHeight, sortedRows]);

  const updateForm = React.useCallback((patch: Partial<SearchForm>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const changeFiltersDock = React.useCallback(
    (dock: SearchFiltersDock) => {
      setFiltersDock(dock);
      setFiltersOpen(true);
    },
    [setFiltersDock],
  );

  const setSelected = React.useCallback((key: SelectionKey, ids: string[]) => {
    if (!form) return;
    const next = { ...form, [key]: ids };
    prepareObjectFilterChange();
    setForm(next);
  }, [form, prepareObjectFilterChange]);

  const toggleSelected = React.useCallback((key: SelectionKey, id: string, checked: boolean) => {
    if (!form) return;
    const current = new Set(form[key]);
    if (checked) current.add(id);
    else current.delete(id);
    const next = { ...form, [key]: Array.from(current) };
    prepareObjectFilterChange();
    setForm(next);
  }, [form, prepareObjectFilterChange]);

  const togglePromittor = React.useCallback((id: string, checked: boolean) => {
    if (!form) return;
    const selected = new Set(form.promittorIds);
    if (checked) selected.add(id);
    else selected.delete(id);
    const next = {
      ...form,
      promittorIds: Array.from(selected),
    };
    prepareObjectFilterChange();
    setForm(next);
  }, [form, prepareObjectFilterChange]);

  const toggleFixedStarSignificators = React.useCallback(() => {
    if (!catalog || !form) return;
    const fixedStarIds = catalog.presets.significators.fixedStars;
    const selected = new Set(form.significatorIds);
    const remove = fixedStarIds.length > 0 && fixedStarIds.every((id) => selected.has(id));
    for (const id of fixedStarIds) {
      if (remove) selected.delete(id);
      else selected.add(id);
    }
    const next = { ...form, significatorIds: [...selected] };
    prepareObjectFilterChange();
    setForm(next);
  }, [catalog, form, prepareObjectFilterChange]);

  const changePartFilter = React.useCallback((partFilter: string) => {
    if (!form) return;
    const next = { ...form, partFilter };
    setForm(next);
    saveSettings(next);
  }, [form, saveSettings]);

  const changeMotionFilter = React.useCallback(
    (key: "promittorMotion" | "significatorMotion", value: TransitSearchMotionFilter) => {
      if (!form) return;
      const next = { ...form, [key]: value };
      prepareObjectFilterChange();
      setForm(next);
      if (canRunSearch(next)) refreshRetainedSearch(next);
      else saveSettings(next);
    },
    [form, prepareObjectFilterChange, refreshRetainedSearch, saveSettings],
  );

  const changeMoonPhase = React.useCallback(
    (moonPhase: MoonPhaseFilter) => {
      if (!form) return;
      const promittorIds = moonPhase && !form.promittorIds.includes("planet:moon")
        ? [...form.promittorIds, "planet:moon"]
        : form.promittorIds;
      const next = { ...form, moonPhase, promittorIds };
      prepareObjectFilterChange();
      setForm(next);
      if (canRunSearch(next)) refreshRetainedSearch(next);
      else saveSettings(next);
    },
    [form, prepareObjectFilterChange, refreshRetainedSearch, saveSettings],
  );

  const changeIncludeSignChanges = React.useCallback((includeSignChanges: boolean) => {
    prepareObjectFilterChange();
    updateForm({ includeSignChanges });
  }, [prepareObjectFilterChange, updateForm]);

  const changeLunationOrb = React.useCallback((lunationOrb: number) => {
    prepareObjectFilterChange();
    updateForm({ lunationOrb });
  }, [prepareObjectFilterChange, updateForm]);

  const runDateRangeSearch = React.useCallback(
    (fromDate: string, toDate: string) => {
      prepareObjectFilterChange();
      setForm((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          fromDate,
          toDate,
        };
        if (canRunSearch(next)) refreshRetainedSearch(next);
        return next;
      });
    },
    [prepareObjectFilterChange, refreshRetainedSearch],
  );

  const runYearSearch = React.useCallback(
    (year: number) => runDateRangeSearch(`${year}-01-01`, `${year}-12-31`),
    [runDateRangeSearch],
  );

  const runThisMonthSearch = React.useCallback(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const fromDate = isoDate(year, month + 1, 1);
    const toDate = isoDate(year, month + 1, new Date(year, month + 1, 0).getDate());
    runDateRangeSearch(fromDate, toDate);
  }, [runDateRangeSearch]);

  const runThisYearSearch = React.useCallback(() => {
    const year = new Date().getFullYear();
    runYearSearch(year);
  }, [runYearSearch]);

  const runLifetimeSearch = React.useCallback(() => {
    if (!catalog?.lifetimeFrom || !catalog.lifetimeTo) return;
    prepareObjectFilterChange();
    setForm((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        fromDate: catalog.lifetimeFrom ?? prev.fromDate,
        toDate: catalog.lifetimeTo ?? prev.toDate,
      };
      if (canRunSearch(next)) {
        refreshRetainedSearch(next);
      }
      return next;
    });
  }, [catalog, prepareObjectFilterChange, refreshRetainedSearch]);

  const saveDefaultRange = React.useCallback(() => {
    setError(null);
    const request = contextMode
      ? updateSearchContextDefaultRange({
          documentId,
          significatorId,
          chartRole,
          customPoints,
          ...rangeDraft,
        })
      : updateSearchDefaultRange({ documentId, ...rangeDraft });
    void request
      .then((result) => {
        setRangeDraft({
          offsetMonths: result.defaultOffsetMonths,
          rangeMonths: result.defaultRangeMonths,
          lifetimeYears: result.lifetimeYears,
        });
        setCatalog((prev) =>
          prev
            ? {
                ...prev,
                defaults: {
                  ...prev.defaults,
                  defaultOffsetMonths: result.defaultOffsetMonths,
                  defaultRangeMonths: result.defaultRangeMonths,
                  lifetimeYears: result.lifetimeYears,
                  fromDate: result.fromDate,
                  toDate: result.toDate,
                },
                lifetimeFrom: result.lifetimeFrom,
                lifetimeTo: result.lifetimeTo,
              }
            : prev,
        );
        setSettingsOpen(false);
      })
      .catch((err) => setError((err as Error).message));
  }, [chartRole, contextMode, customPoints, documentId, rangeDraft, significatorId]);

  const resetStandardSettings = React.useCallback(() => {
    if (!catalog || !form) return;
    const next: SearchForm = {
      ...form,
      fromDate: catalog.defaults.fromDate,
      toDate: catalog.defaults.toDate,
      techniques: catalog.presets.techniques.standard,
      promittorIds: catalog.presets.promittors.standard,
      significatorIds: catalog.presets.significators.standard,
      aspects: catalog.presets.aspects.standard,
      includeSignChanges: false,
      promittorMotion: "",
      significatorMotion: "",
      moonPhase: "",
      lunationOrb: 3,
      partFilter: "",
    };
    prepareObjectFilterChange();
    setForm(next);
  }, [catalog, form, prepareObjectFilterChange]);

  const currentYear = React.useMemo(() => {
    const value = Number((form?.fromDate ?? "").slice(0, 4));
    return Number.isFinite(value) && value > 0 ? value : new Date().getFullYear();
  }, [form?.fromDate]);
  const activeRangeStream = React.useMemo(
    () =>
      rangeStream
      && form
      && retainedSearchSourceCoversForm(rangeStream.queryForm ?? form, form)
        ? rangeStream
        : null,
    [form, rangeStream],
  );
  const extendRange = React.useCallback(
    (direction: "previous" | "next") => {
      if (direction !== "next" || !form || rangeExtendInFlightRef.current) return;
      const current = rangeStreamRef.current;
      if (
        !current
        || current.exhaustedNext
        || !current.coverageTo
        || !retainedSearchSourceCoversForm(current.queryForm ?? form, form)
      ) return;
      const nextFrom = nextIsoDate(current.coverageTo);
      if (!nextFrom || nextFrom > form.toDate) return;
      const seed = searchSeedRange(nextFrom, form.toDate);
      if (!seed) return;

      const controller = new AbortController();
      rangeExtendInFlightRef.current = true;
      rangeExtendControllerRef.current = controller;
      setSearchLoading(true);
      setError(null);
      const sourceForm = current.queryForm ?? form;
      const request: TransitSearchRequest = {
        ...buildRequest(sourceForm, false),
        fromDate: seed.fromDate,
        toDate: seed.toDate,
        ownerScope: "search:range",
        cursorDirection: "next",
        cursorRowBudget: Math.max(
          SEARCH_EDGE_MIN_ROWS,
          searchViewportRowCount(searchScrollerRef.current, searchRowHeight) * 2,
        ),
        cursorAnchorDate: seed.fromDate,
        cursorRangeFrom: current.rangeFrom,
        cursorRangeTo: form.toDate,
      };
      let startedSessionId = "";
      const applyProgress = (result: TransitSearchProgressResult) => {
        if (controller.signal.aborted || result.cancelled) return;
        if (result.error) throw new Error(result.error);
        if (!result.cursor) return;
        const live = rangeStreamRef.current;
        if (!live || live.queryKey !== current.queryKey) return;
        const nextRows = mergeSearchStreamRows(rowsRef.current, result.rows);
        const nextStream: SearchRangeStream = {
          ...live,
          coverageFrom: live.coverageFrom || result.cursor.coverageFrom,
          coverageTo: result.cursor.coverageTo,
          exhaustedNext: result.cursor.coverageTo >= live.rangeTo
            ? result.cursor.exhaustedNext
            : false,
        };
        rowsRef.current = nextRows;
        rangeStreamRef.current = nextStream;
        React.startTransition(() => {
          setRows(nextRows);
          setSummary(t("search.resultCount").replace("{count}", String(nextRows.length)));
          setTimeDisplay(result.timeDisplay ?? catalogRef.current?.timeDisplay ?? null);
          setRangeStream(nextStream);
        });
      };

      void startSearchRequest(request, controller.signal)
        .then(async (initial) => {
          if (controller.signal.aborted) {
            void cancelTransitSearch(initial.sessionId).catch(() => undefined);
            return;
          }
          startedSessionId = initial.sessionId;
          await followTransitSearchProgress(initial, controller.signal, applyProgress);
        })
        .catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          setError((err as Error).message);
        })
        .finally(() => {
          if (rangeExtendControllerRef.current === controller) {
            rangeExtendControllerRef.current = null;
            rangeExtendInFlightRef.current = false;
            setSearchLoading(false);
            setEdgeCheckNonce((value) => value + 1);
          }
          if (controller.signal.aborted && startedSessionId) {
            void cancelTransitSearch(startedSessionId).catch(() => undefined);
          }
        });
    },
    [buildRequest, form, searchRowHeight, startSearchRequest, t],
  );
  useFixedRowHeightAnchor(searchScrollerRef, sortedRows.length, searchRowHeight, {
    syncEvent: SEARCH_VIRTUAL_SCROLL_SYNC_EVENT,
  });
  React.useLayoutEffect(() => {
    const anchor = objectFilterAnchorRef.current;
    if (!anchor) return;
    const scroller = searchScrollerRef.current;
    if (!scroller) return;
    objectFilterAnchorRef.current = null;
    if (sortedRows.length === 0) {
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event(SEARCH_VIRTUAL_SCROLL_SYNC_EVENT));
      return;
    }
    const survivingIndex = sortedRows.findIndex((row) => row.key === anchor.rowKey);
    const targetIndex = survivingIndex >= 0
      ? survivingIndex
      : nearestTransitSearchRowIndex(sortedRows, anchor.eventJd, anchor.sourceIndex);
    const viewportHeight = eventListBodyViewportHeight(scroller, searchRowHeight * 12);
    const maxTop = Math.max(0, sortedRows.length * searchRowHeight - viewportHeight);
    scroller.scrollTop = Math.max(
      0,
      Math.min(maxTop, targetIndex * searchRowHeight + anchor.withinRowOffset),
    );
    scroller.dispatchEvent(new Event(SEARCH_VIRTUAL_SCROLL_SYNC_EVENT));
  }, [searchRowHeight, sortedRows]);
  useEdgeExtend({
    scrollerRef: searchScrollerRef,
    rowCount: sortedRows.length,
    thresholdPx: searchRowHeight * 6,
    canExtendBackward: false,
    canExtendForward: Boolean(
      activeRangeStream
      && form
      && activeRangeStream.coverageTo < form.toDate
      && !activeRangeStream.exhaustedNext
    ),
    onExtend: extendRange,
    recheckToken: edgeCheckNonce,
  });
  const sourceQueryForm = rangeStream?.queryForm ?? form;
  const visibleColumns = React.useMemo(
    () =>
      listKeyDisplayOrder(getVisibleColumns(rows, sourceQueryForm, t), layoutPreset, {
        dateKeys: ["date"],
        timeKeys: ["time"],
        eventKeys: ["aspect"],
      }),
    [layoutPreset, rows, sourceQueryForm, t],
  );
  const tableResize = useResizableTableColumns({
    storageKey: "transit-search",
    columnIds: visibleColumns,
  });
  const selectedRows = React.useMemo(
    () => sortedRows.filter((row) => selectedRowKeys.has(row.key)),
    [selectedRowKeys, sortedRows],
  );
  const selectRow = React.useCallback((row: TransitSearchRow, event?: React.MouseEvent) => {
    setSelectedRowKeys((prev) => {
      if (event?.metaKey || event?.ctrlKey) {
        const next = new Set(prev);
        if (next.has(row.key)) {
          next.delete(row.key);
        } else {
          next.add(row.key);
        }
        return next;
      }
      return new Set([row.key]);
    });
  }, []);
  const selectRowForContextMenu = React.useCallback((row: TransitSearchRow) => {
    setContextRowKey(row.key);
    setSelectedRowKeys((prev) => (prev.has(row.key) ? prev : new Set([row.key])));
  }, []);
  const selectAllRows = React.useCallback(() => {
    setSelectedRowKeys(new Set(sortedRows.map((row) => row.key)));
  }, [sortedRows]);
  const openTimedChart = React.useCallback<SearchOpenTimedChart>(
    (row, action) => {
      if (!row.canOpenChart || !row.openDatetime) return;
      setError(null);
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
        .then((result) => {
          applyTimedChartOpenResult(result);
          if (!result.documentId) {
            throw new Error(tf("search.timedChartNoDocument", "Timed chart action did not open a document."));
          }
        })
        .catch((err) => {
          const message = (err as Error).message || tf("search.timedChartFailed", "Timed chart action failed");
          setError(message);
          console.error("[search-timed-chart]", err);
        })
        .finally(finishSnapshotCommand);
    },
    [applyTimedChartOpenResult, documentId, showRadix, tf],
  );

  if (!catalog || !form) {
    return (
      <div className="relative flex h-full min-h-0 w-full items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">
          {catalogLoading ? <LoadingLabel label={t("search.loadingSearch")} /> : error ?? <LoadingLabel label={t("search.loadingSearch")} />}
        </span>
      </div>
    );
  }

  const canSearch = canRunSearch(form);
  const dateConvention = coerceDateConvention(catalog.dateConvention);
  const rangeStatus = activeRangeStream
    ? activeRangeStream.exhaustedNext
      ? t("search.rangeComplete")
      : activeRangeStream.coverageTo
        ? t("search.rangeLoadedThrough").replace(
            "{date}",
            formatIsoDateDisplay(activeRangeStream.coverageTo, dateConvention),
          )
        : t("search.computing")
    : "";
  const projectedSummary = sortedRows.length === rows.length
    ? summary
    : t("search.resultCount").replace("{count}", String(sortedRows.length));
  const displayedSummary = rangeStatus ? `${projectedSummary} · ${rangeStatus}` : projectedSummary;
  const paneSeedGlyph = props.mode === "context" ? (props.glyph ?? "") : "";
  const paneSeedLabel = props.mode === "context" ? (props.label ?? "") : "";
  const seedGlyph = catalog.initialSignificatorGlyph || paneSeedGlyph;
  const seedGlyphFont = catalog.initialSignificatorGlyph
    ? catalog.initialSignificatorGlyphFont
    : "morinus";
  const seedLabel = catalog.initialSignificatorLabel || paneSeedLabel;
  const filterGroups = (
    <>
      <TechniqueGroup
        techniques={techniques}
        selected={form.techniques}
        includeSignChanges={form.includeSignChanges}
        onToggle={(id, checked) => toggleSelected("techniques", id, checked)}
        onIncludeSignChanges={changeIncludeSignChanges}
      />
      <AspectGroup
        selected={form.aspects}
        catalog={catalog}
        lunationOrb={form.lunationOrb}
        lunarEventsEnabled={form.techniques.includes("lunations") || form.techniques.includes("eclipses")}
        onToggle={(id, checked) => toggleSelected("aspects", id, checked)}
        onSetAll={() => setSelected("aspects", catalog.presets.aspects.all)}
        onSetMajor={() => setSelected("aspects", catalog.presets.aspects.major)}
        onClear={() => setSelected("aspects", catalog.presets.aspects.clear)}
        onLunationOrbChange={changeLunationOrb}
      />
      <SelectionGroup
        title={t("search.promissors")}
        selected={form.promittorIds}
        items={promittors}
        compact
        motionFilter={form.promittorMotion}
        moonPhase={form.moonPhase}
        onMotionFilterChange={(value) => changeMotionFilter("promittorMotion", value)}
        onMoonPhaseChange={changeMoonPhase}
        onToggle={togglePromittor}
        actions={[
          [t("search.all"), () => setSelected("promittorIds", catalog.presets.promittors.all)],
          [t("search.planets"), () => setSelected("promittorIds", catalog.presets.promittors.planets)],
          [t("search.core7"), () => setSelected("promittorIds", catalog.presets.promittors.core7)],
          [t("search.clear"), () => setSelected("promittorIds", catalog.presets.promittors.clear)],
        ]}
      />
      <SelectionGroup
        title={t("search.significators")}
        selected={form.significatorIds}
        items={builtinSignificators}
        compact
        motionFilter={form.significatorMotion}
        onMotionFilterChange={(value) => changeMotionFilter("significatorMotion", value)}
        onToggle={(id, checked) => toggleSelected("significatorIds", id, checked)}
        actions={[
          [t("search.builtins"), () => setSelected("significatorIds", catalog.presets.significators.builtins)],
          [t("search.planets"), () => setSelected("significatorIds", catalog.presets.significators.planets)],
          [t("table.fixed_stars"), toggleFixedStarSignificators],
          [t("search.clear"), () => setSelected("significatorIds", catalog.presets.significators.clear)],
        ]}
      />
      {createdSignificators.length > 0 ? (
        <SelectionGroup
          title={t("search.createdPoints")}
          selected={form.significatorIds}
          items={createdSignificators}
          compact
          onToggle={(id, checked) => toggleSelected("significatorIds", id, checked)}
          actions={[
            [
              t("search.all"),
              () => setSelected("significatorIds", uniqueIds([...form.significatorIds, ...createdSignificators.map((obj) => obj.id)])),
            ],
            [
              t("search.clear"),
              () =>
                setSelected(
                  "significatorIds",
                  form.significatorIds.filter((id) => !createdSignificators.some((obj) => obj.id === id)),
                ),
            ],
          ]}
        />
      ) : null}
      {partObjects.length > 0 ? (
        <SelectionGroup
          title={t("search.arabicParts")}
          selected={form.significatorIds}
          items={filteredPartObjects}
          compact
          filterValue={form.partFilter}
          onFilterChange={changePartFilter}
          onToggle={(id, checked) => toggleSelected("significatorIds", id, checked)}
          actions={[
            [t("search.all"), () => setSelected("significatorIds", uniqueIds([...form.significatorIds, ...catalog.partIds]))],
            [t("search.clear"), () =>
              setSelected(
                "significatorIds",
                form.significatorIds.filter((id) => !catalog.partIds.includes(id)),
              )],
          ]}
        />
      ) : null}
    </>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="grid gap-[var(--aries-control-gap)] border-b border-border px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-padding-y)]">
        <div className="flex min-w-0 items-end gap-[var(--aries-control-gap)]">
          {onClose ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onClose}
              aria-label={t("search.closeSearch")}
              className="mb-0.5"
            >
              <X className="size-[var(--aries-control-icon-size)]" />
            </Button>
          ) : null}
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-[var(--aries-control-gap)]">
            <DateField
              label={t("search.from")}
              value={form.fromDate}
              convention={dateConvention}
              onChange={(fromDate) => updateForm({ fromDate })}
            />
            <DateField
              label={t("search.to")}
              value={form.toDate}
              convention={dateConvention}
              onChange={(toDate) => updateForm({ toDate })}
            />
          </div>
          <Button
            type="button"
            size="xs"
            className="mb-0.5 shrink-0"
            disabled={!canSearch || searchLoading}
            onClick={() => refreshRetainedSearch(form)}
          >
            <Search className="size-[var(--aries-control-icon-size)]" />
            {t("search.search")}
          </Button>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-[var(--aries-form-field-gap)]">
          <div className="flex min-w-0 flex-1 items-center gap-[var(--aries-form-field-gap)] overflow-hidden text-[length:var(--aries-font-size-small)] text-muted-foreground">
            <span className="min-w-0 max-w-28 truncate">{catalog.sourceName || sourceName}</span>
            {contextMode && seedGlyph ? (
              <span className="inline-flex min-w-0 shrink-0 items-center gap-[var(--aries-control-gap-compact)]">
                <Glyph ch={seedGlyph} font={seedGlyphFont} className="text-sm" title={seedLabel} />
                {seedLabel ? <span className="max-w-20 truncate">{seedLabel}</span> : null}
              </span>
            ) : null}
            <span className="shrink-0 whitespace-nowrap">
              {searchLoading ? <LoadingLabel label={rows.length > 0 ? displayedSummary : t("search.computing")} /> : displayedSummary}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-[var(--aries-control-gap-compact)]">
            <ListLayoutPresetControl />
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] tabular-nums whitespace-nowrap"
              onClick={runThisMonthSearch}
            >
              {t("search.thisMonth")}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] tabular-nums whitespace-nowrap"
              onClick={runThisYearSearch}
            >
              {t("search.thisYear")}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] whitespace-nowrap"
              disabled={!catalog.lifetimeFrom || !catalog.lifetimeTo || searchLoading}
              onClick={runLifetimeSearch}
              title={t("search.lifetimeTooltip").replace("{years}", String(catalog.defaults.lifetimeYears))}
            >
              {t("search.lifetime")}
            </Button>
            {[currentYear - 1, currentYear, currentYear + 1].map((year) => (
              <Button
                key={year}
                type="button"
                size="xs"
                variant="ghost"
                className="px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] tabular-nums"
                onClick={() => runYearSearch(year)}
              >
                {year}
              </Button>
            ))}
            <Button
              type="button"
              size="xs"
              variant={filtersOpen ? "default" : "outline"}
              aria-pressed={filtersOpen}
              aria-label={t("search.filters")}
              title={t("search.filters")}
              className="px-[var(--aries-control-gap)]"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <ListFilter className="size-[var(--aries-control-icon-size)]" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    aria-label={t("search.searchSettingsAria")}
                    title={t("search.searchSettingsAria")}
                    className="px-[var(--aries-control-gap)]"
                  />
                }
              >
                <Settings2 className="size-[var(--aries-control-icon-size)]" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuItem onClick={resetStandardSettings}>
                  {t("search.resetToStandard")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{t("search.filtersPane")}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={filtersDock}
                      onValueChange={(value) => {
                        if (value === "right" || value === "bottom") changeFiltersDock(value);
                      }}
                    >
                      <DropdownMenuRadioItem value="right">
                        {t("search.filtersPaneRight")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="bottom">
                        {t("search.filtersPaneBottom")}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                  {t("search.searchSettingsItem")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <ResizablePanelGroup
          autoSaveId={`aries.search-results-vs-filters-${filtersDock}`}
          direction={filtersDock === "right" ? "horizontal" : "vertical"}
          className="min-h-0 min-w-0"
        >
          <ResizablePanel id="search-results" order={1} defaultSize={55} minSize={20} className="min-h-0 min-w-0">
            <div className="flex h-full min-h-0 min-w-0 flex-col">
              {error ? (
                <div className="border-b border-border px-[var(--aries-pane-content-padding)] py-[var(--aries-pane-header-padding-y)] text-xs text-destructive">
                  {error}
                </div>
              ) : null}
              <div ref={searchScrollerRef} className="aries-search-results-scroller flex-1 min-h-0 overflow-auto">
                <table
                  className={cn(LIST_ROLE_CLASSES.dense, "border-collapse leading-tight", tableResize.tableClassName)}
                  style={tableResize.tableStyle}
                >
                  {tableResize.colGroup}
                  <thead className="sticky top-0 z-10 bg-background">
                    <tr className="aries-list-row border-b">
                      {visibleColumns.map((column) => (
                        <th
                          key={column}
                          className={cn(
                            "aries-list-head-cell relative border-0 font-medium",
                            column === "mz" || column === "dc" ? "px-0.5" : "",
                            SEARCH_COLUMNS[column].headClass,
                          )}
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-[var(--aries-control-gap-compact)]"
                            onClick={() =>
                              setSort((current) => ({
                                column,
                                ascending: current?.column === column ? !current.ascending : true,
                              }))
                            }
                          >
                            <span>{searchColumnLabel(t, column, visibleColumns, timeDisplay?.columnLabel)}</span>
                            {sort?.column === column ? (
                              sort.ascending ? (
                                <ArrowUp className="size-3 shrink-0" />
                              ) : (
                                <ArrowDown className="size-3 shrink-0" />
                              )
                            ) : null}
                          </button>
                          <ColumnResizeHandle
                            columnId={column}
                            getResizeHandleProps={tableResize.getResizeHandleProps}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <VirtualizedSearchRows
                    rows={sortedRows}
                    loading={searchLoading}
                    emptyLabel={t("search.noResultsSetRange")}
                    loadingLabel={t("search.searching")}
                    colSpan={visibleColumns.length}
                    scrollerRef={searchScrollerRef}
                    rowHeight={searchRowHeight}
                    renderRow={(row) => (
                        <SearchRow
                          key={row.key}
                          row={row}
                          rowHeight={searchRowHeight}
                          selected={selectedRowKeys.has(row.key)}
                          contextMenuActive={contextRowKey === row.key}
                          contextMenuRows={contextRowKey === row.key ? selectedRows : EMPTY_SEARCH_ROWS}
                          visibleColumns={visibleColumns}
                          onSelect={selectRow}
                          onContextSelect={selectRowForContextMenu}
                          onSelectAll={selectAllRows}
                          onOpenTimedChart={openTimedChart}
                          onActionError={setError}
                        />
                    )}
                  />
                </table>
              </div>
            </div>
          </ResizablePanel>
          {filtersOpen ? (
            <>
              <ResizableHandle />
              <ResizablePanel
                id={`search-filters-${filtersDock}`}
                order={2}
                defaultSize={45}
                minSize={filtersDock === "right" ? 30 : 20}
                className="min-h-0 min-w-0"
              >
                <div data-aries-surface="panel" className="flex h-full min-h-0 flex-col bg-background">
                  <div className="flex shrink-0 items-center justify-between px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-control-gap-compact)]">
                    <h2 className="aries-search-panel-heading text-xs">{t("search.filters")}</h2>
                    <Button type="button" size="icon-xs" variant="ghost" onClick={() => setFiltersOpen(false)} aria-label={t("search.closeFilters")}>
                      <X className="size-[var(--aries-control-icon-size)]" />
                    </Button>
                  </div>
                  <div
                    className={cn(
                      "min-h-0 flex-1 items-start gap-[var(--aries-pane-content-padding)] overflow-auto px-[var(--aries-pane-header-compact-padding-x)] pb-[var(--aries-pane-title-gap)]",
                      filtersDock === "bottom" ? "grid grid-cols-2" : "flex flex-col",
                    )}
                  >
                    {filterGroups}
                  </div>
                </div>
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      </div>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("search.searchSettingsTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-[var(--aries-form-row-gap)]">
            <label className="grid gap-[var(--aries-control-gap-compact)]">
              <span className="text-xs text-muted-foreground">{t("search.offsetMonths")}</span>
              <Input
                type="number"
                min={-120}
                max={120}
                defaultValue={rangeDraft.offsetMonths}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setRangeDraft((prev) => ({
                    ...prev,
                    offsetMonths: clampInteger(value, -120, 120, prev.offsetMonths),
                  }));
                }}
              />
            </label>
            <label className="grid gap-[var(--aries-control-gap-compact)]">
              <span className="text-xs text-muted-foreground">{t("search.rangeMonths")}</span>
              <Input
                type="number"
                min={1}
                max={120}
                value={rangeDraft.rangeMonths}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setRangeDraft((prev) => ({
                    ...prev,
                    rangeMonths: clampInteger(value, 1, 120, prev.rangeMonths),
                  }));
                }}
              />
            </label>
            <label className="grid gap-[var(--aries-control-gap-compact)]">
              <span className="text-xs text-muted-foreground">{t("search.lifetimeRangeYears")}</span>
              <Input
                type="number"
                min={1}
                max={500}
                value={rangeDraft.lifetimeYears}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setRangeDraft((prev) => ({
                    ...prev,
                    lifetimeYears: clampInteger(value, 1, 500, prev.lifetimeYears),
                  }));
                }}
              />
            </label>
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("search.cancel")}
            </DialogClose>
            <Button type="button" onClick={saveDefaultRange}>
              {t("search.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function sortTransitSearchRows(
  rows: TransitSearchRow[],
  sort: SearchSortState | null,
): TransitSearchRow[] {
  if (!sort) return rows;
  return rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((a, b) => {
      const cmp = compareSearchValues(
        transitSearchSortValue(a.row, sort.column),
        transitSearchSortValue(b.row, sort.column),
      );
      if (cmp !== 0) return sort.ascending ? cmp : -cmp;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ row }) => row);
}

function VirtualizedSearchRows({
  rows,
  loading,
  emptyLabel,
  loadingLabel,
  colSpan,
  scrollerRef,
  rowHeight,
  renderRow,
}: {
  rows: readonly TransitSearchRow[];
  loading: boolean;
  emptyLabel: string;
  loadingLabel: string;
  colSpan: number;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  rowHeight: number;
  renderRow: (row: TransitSearchRow, index: number) => React.ReactNode;
}) {
  const virtual = useSearchVirtualRows(scrollerRef, rows.length, rowHeight);
  const visibleRows = rows.slice(virtual.startIndex, virtual.endIndex);

  if (rows.length === 0) {
    return (
      <tbody data-rendered-row-count={0} data-total-row-count={0}>
        <tr>
          <td
            className="px-[var(--aries-control-padding-x-compact)] py-[var(--aries-pane-title-gap)] text-center text-muted-foreground"
            colSpan={colSpan}
          >
            {loading ? <LoadingLabel label={loadingLabel} /> : emptyLabel}
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody
      data-rendered-row-count={visibleRows.length}
      data-total-row-count={rows.length}
    >
      {virtual.paddingTop > 0 ? (
        <SearchVirtualSpacerRow colSpan={colSpan} height={virtual.paddingTop} />
      ) : null}
      {visibleRows.map((row, offset) => renderRow(row, virtual.startIndex + offset))}
      {virtual.paddingBottom > 0 ? (
        <SearchVirtualSpacerRow colSpan={colSpan} height={virtual.paddingBottom} />
      ) : null}
    </tbody>
  );
}

function SearchVirtualSpacerRow({ colSpan, height }: { colSpan: number; height: number }) {
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

function useSearchVirtualRows(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  rowCount: number,
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
    setViewport((previous) =>
      previous.scrollTop === next.scrollTop && previous.height === next.height
        ? previous
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
    scroller.addEventListener(SEARCH_VIRTUAL_SCROLL_SYNC_EVENT, measureSync);
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    resizeObserver?.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", scheduleMeasure);
      scroller.removeEventListener(SEARCH_VIRTUAL_SCROLL_SYNC_EVENT, measureSync);
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
    scroller.dispatchEvent(new Event(SEARCH_VIRTUAL_SCROLL_SYNC_EVENT));
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
    const visibleCount = Math.max(1, Math.ceil(viewport.height / rowHeight));
    const rawVisibleStart =
      viewport.height > 0 ? Math.floor(viewport.scrollTop / rowHeight) : 0;
    const maxVisibleStart = Math.max(0, rowCount - visibleCount);
    const visibleStart = Math.max(0, Math.min(rawVisibleStart, maxVisibleStart));
    const startIndex = Math.min(
      rowCount,
      Math.max(0, visibleStart - SEARCH_VIRTUAL_OVERSCAN_ROWS),
    );
    const endIndex = Math.max(
      startIndex,
      Math.min(
        rowCount,
        visibleStart + visibleCount + SEARCH_VIRTUAL_OVERSCAN_ROWS,
      ),
    );
    return {
      startIndex,
      endIndex,
      paddingTop: startIndex * rowHeight,
      paddingBottom: (rowCount - endIndex) * rowHeight,
    };
  }, [rowCount, rowHeight, viewport.height, viewport.scrollTop]);
}

function LoadingLabel({ label }: { label: string }) {
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <span>{label}</span>
      <LoadingDots />
    </span>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex w-4 justify-start" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="inline-block animate-bounce"
          style={{ animationDelay: `${index * 120}ms` }}
        >
          .
        </span>
      ))}
    </span>
  );
}

function transitSearchSortValue(row: TransitSearchRow, column: SearchColumnKey): string | number {
  switch (column) {
    case "date":
      return typeof row.eventJd === "number" ? row.eventJd : sortableDateTime(row.eventDate, row.eventTime);
    case "time":
      return sortableTime(row.displayTime);
    case "aspect":
      return `${row.promittorLabel} ${row.aspectLabel} ${row.significatorLabel}`;
    case "from":
      return displayLongitudeSortValue(row.promDisplay);
    case "to":
      return displayLongitudeSortValue(row.sigDisplay);
    case "technique":
      return row.techniqueLabel;
    case "mz":
      return row.primaryMode;
    case "dc":
      return row.primaryDirection;
  }
}

function displayLongitudeSortValue(display: SearchDisplay): string | number {
  const raw = display.display_longitude;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return String(display.lon_text ?? "");
}

function compareSearchValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortableDateTime(date: string, time = ""): number | string {
  const dateParts = String(date).match(/-?\d+/g)?.map(Number) ?? [];
  if (dateParts.length < 3) return `${date} ${time}`;
  const timeParts = String(time).match(/\d+/g)?.map(Number) ?? [];
  const [year, month, day] = dateParts;
  const [hour = 0, minute = 0, second = 0] = timeParts;
  return (((year * 13 + month) * 32 + day) * 24 + hour) * 3600 + minute * 60 + second;
}

function sortableTime(time: string): number | string {
  const parts = String(time).match(/\d+/g)?.map(Number) ?? [];
  if (!parts.length) return time;
  const [hour = 0, minute = 0, second = 0] = parts;
  return hour * 3600 + minute * 60 + second;
}

function DateField({
  label,
  value,
  convention,
  onChange,
}: {
  label: string;
  value: string;
  convention: DateConvention;
  onChange: (value: string) => void;
}) {
  const formatValue = React.useCallback(
    (nextValue: string) => formatIsoDateDisplay(nextValue, convention),
    [convention],
  );
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const formattedValue = formatValue(value);
  const [draft, setDraft] = React.useState(formattedValue);

  React.useEffect(() => {
    const input = inputRef.current;
    if (!input || document.activeElement === input) return;
    setDraft(formattedValue);
  }, [formattedValue]);

  const commitInput = React.useCallback(
    (nextDraft: string, reformat: boolean) => {
      const iso = parseDateDisplayInput(nextDraft, convention);
      if (iso) {
        if (iso !== value) onChange(iso);
        if (reformat) setDraft(formatValue(iso));
        return true;
      }
      if (reformat) setDraft(formattedValue);
      return false;
    },
    [convention, formatValue, formattedValue, onChange, value],
  );

  return (
    <label className="grid min-w-0 gap-[calc(var(--aries-control-gap-compact)/2)]">
      <span className="truncate text-[length:var(--aries-font-size-small)] text-muted-foreground">
        {label}
      </span>
      <Input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={draft}
        placeholder={convention === "dmy" ? "DD.MM.YYYY" : "YYYY-MM-DD"}
        onChange={(event) => {
          const nextDraft = event.currentTarget.value;
          setDraft(nextDraft);
          commitInput(nextDraft, false);
        }}
        onBlur={(event) => {
          commitInput(event.currentTarget.value, true);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.currentTarget.blur();
        }}
        className="h-[var(--aries-control-height-small)] min-w-0 px-[var(--aries-control-padding-x-compact)] text-xs"
      />
    </label>
  );
}

function SelectionGroup({
  title,
  selected,
  items,
  compact,
  motionFilter,
  moonPhase,
  onMotionFilterChange,
  onMoonPhaseChange,
  filterValue,
  onFilterChange,
  onToggle,
  actions,
}: {
  title: string;
  selected: string[];
  items: TransitSearchObject[];
  compact?: boolean;
  motionFilter?: TransitSearchMotionFilter;
  moonPhase?: MoonPhaseFilter;
  onMotionFilterChange?: (value: TransitSearchMotionFilter) => void;
  onMoonPhaseChange?: (value: MoonPhaseFilter) => void;
  filterValue?: string;
  onFilterChange?: (value: string) => void;
  onToggle: (id: string, checked: boolean) => void;
  actions: Array<[string, () => void]>;
}) {
  const t = useT();
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  return (
    <section className="grid gap-[var(--aries-form-field-gap)]">
      <GroupHeader
        title={title}
        selected={items.filter((obj) => selectedSet.has(obj.id)).length}
        total={items.length}
        actions={actions}
        headingControl={
          onMotionFilterChange ? (
            <MotionFilterToggle
              label={title}
              value={motionFilter ?? ""}
              onChange={onMotionFilterChange}
            />
          ) : null
        }
      />
      {onFilterChange ? (
        <Input
          value={filterValue ?? ""}
          onChange={(event) => onFilterChange(event.currentTarget.value)}
          placeholder={t("search.filter")}
          className="h-[var(--aries-control-height-small)] text-xs"
        />
      ) : null}
      <div className={cn("grid gap-[var(--aries-control-gap-compact)]", compact && "max-h-36 overflow-auto pr-[var(--aries-control-gap-compact)]")}>
        {items.map((obj) => (
          <CheckRow
            key={obj.id}
            checked={selectedSet.has(obj.id)}
            label={obj.label}
            glyph={obj.glyph}
            glyphFont={obj.glyphFont}
            marker={obj.displayMarker}
            segments={obj.displaySegments}
            meta={obj.longitudeText}
            inlineControl={obj.id === "planet:moon" && onMoonPhaseChange ? (
              <MoonPhaseToggle value={moonPhase ?? ""} onChange={onMoonPhaseChange} />
            ) : null}
            onChange={(checked) => onToggle(obj.id, checked)}
          />
        ))}
      </div>
    </section>
  );
}

function TechniqueGroup({
  techniques,
  selected,
  includeSignChanges,
  onToggle,
  onIncludeSignChanges,
}: {
  techniques: TransitSearchTechnique[];
  selected: string[];
  includeSignChanges: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onIncludeSignChanges: (checked: boolean) => void;
}) {
  const t = useT();
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const byId = React.useMemo(() => {
    const map = new Map<string, TransitSearchTechnique>();
    for (const item of techniques) map.set(item.id, item);
    return map;
  }, [techniques]);
  const orderedRows: Array<TransitSearchTechnique | { id: "sign_changes"; label: string }> = [
    byId.get("transits"),
    byId.get("converse_transits"),
    { id: "sign_changes", label: t("search.techIngressSynodic") },
    byId.get("profections"),
    byId.get("mundane_weather"),
    byId.get("heliacal_phases"),
    byId.get("lunations"),
    byId.get("eclipses"),
    byId.get("secondary_directions"),
    byId.get("primary_directions"),
  ].filter(Boolean) as Array<TransitSearchTechnique | { id: "sign_changes"; label: string }>;
  return (
    <section className="grid gap-[var(--aries-form-field-gap)]">
      <h2 className="aries-search-panel-heading text-xs">{t("search.techniques")}</h2>
      <div className="grid grid-cols-2 gap-x-[var(--aries-pane-content-padding)] gap-y-[var(--aries-control-gap-compact)]">
        {orderedRows.map((item) => {
          return (
            <CheckRow
              key={item.id}
              checked={item.id === "sign_changes" ? includeSignChanges : selectedSet.has(item.id)}
              label={techniqueFilterLabel(item, t)}
              onChange={(checked) =>
                item.id === "sign_changes" ? onIncludeSignChanges(checked) : onToggle(item.id, checked)
              }
            />
          );
        })}
      </div>
    </section>
  );
}

function AspectGroup({
  selected,
  catalog,
  lunationOrb,
  lunarEventsEnabled,
  onToggle,
  onSetAll,
  onSetMajor,
  onClear,
  onLunationOrbChange,
}: {
  selected: string[];
  catalog: TransitSearchCatalog;
  lunationOrb: number;
  lunarEventsEnabled: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onSetAll: () => void;
  onSetMajor: () => void;
  onClear: () => void;
  onLunationOrbChange: (orb: number) => void;
}) {
  const t = useT();
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  return (
    <section className="grid gap-[var(--aries-form-field-gap)]">
      <GroupHeader
        title={t("search.aspects")}
        selected={selected.length}
        total={catalog.aspects.length}
        actions={[
          [t("search.all"), onSetAll],
          [t("search.major"), onSetMajor],
          [t("search.clear"), onClear],
        ]}
      />
      <div className="grid grid-cols-6 overflow-hidden rounded-md border border-border">
        {catalog.aspects.map((aspect, index) => (
          <Tooltip key={aspect.id}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={aspect.label}
                  aria-pressed={selectedSet.has(aspect.id)}
                  onClick={() => onToggle(aspect.id, !selectedSet.has(aspect.id))}
                  className={cn(
                    "flex h-[var(--aries-control-height)] items-center justify-center text-[16px] hover:bg-muted/70",
                    index % 6 !== 5 && "border-r border-border",
                    index >= 6 && "border-t border-border",
                    selectedSet.has(aspect.id) && "bg-primary/20 text-primary",
                  )}
                />
              }
            >
              <Glyph ch={aspect.glyph} />
            </TooltipTrigger>
            <TooltipContent side="bottom">{aspect.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <label className="flex items-center gap-[var(--aries-control-gap-compact)] text-xs text-muted-foreground">
        <span className="min-w-0">{t("search.lunationOrb")}</span>
        <span className="inline-flex shrink-0 items-center gap-[var(--aries-control-gap-compact)]">
          <Input
            type="number"
            min={0}
            max={15}
            step={0.5}
            value={lunationOrb}
            disabled={!lunarEventsEnabled}
            aria-label={t("search.lunationOrb")}
            className="h-[var(--aries-control-height-small)] w-16"
            onChange={(event) => {
              const parsed = Number.parseFloat(event.currentTarget.value);
              if (Number.isFinite(parsed)) onLunationOrbChange(Math.min(15, Math.max(0, parsed)));
            }}
          />
          <span aria-hidden="true">°</span>
        </span>
      </label>
    </section>
  );
}

function GroupHeader({
  title,
  selected,
  total,
  actions,
  headingControl,
}: {
  title: string;
  selected: number;
  total: number;
  actions: Array<[string, () => void]>;
  headingControl?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-[var(--aries-control-gap)]">
      <div className="min-w-0">
        <div className="flex items-center gap-[var(--aries-control-gap)]">
          <h2 className="aries-search-panel-heading truncate text-xs">{title}</h2>
          {headingControl}
        </div>
        <span className="text-[length:var(--aries-font-size-small)] text-muted-foreground">
          {selected}/{total}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-[var(--aries-control-gap-compact)]">
        {actions.map(([label, onClick]) => (
          <Button key={label} type="button" size="xs" variant="ghost" className="px-[var(--aries-control-gap)]" onClick={onClick}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function MotionFilterToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TransitSearchMotionFilter;
  onChange: (value: TransitSearchMotionFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-border"
    >
      {(["rx", "d"] as const).map((motion) => {
        const active = value === motion;
        return (
          <button
            key={motion}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? "" : motion)}
            className={cn(
              "h-[var(--aries-control-height-small)] border-r border-border px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] last:border-r-0 hover:bg-muted/70",
              active && "bg-primary/20 text-primary",
            )}
          >
            {motion === "rx" ? "Rx" : "D"}
          </button>
        );
      })}
    </div>
  );
}

function MoonPhaseToggle({
  value,
  onChange,
}: {
  value: MoonPhaseFilter;
  onChange: (value: MoonPhaseFilter) => void;
}) {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t("search.moonPhase")}
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-border"
    >
      {(["waxing", "waning"] as const).map((phase) => {
        const active = value === phase;
        return (
          <button
            key={phase}
            type="button"
            aria-pressed={active}
            title={phase === "waxing" ? t("search.moonWaxing") : t("search.moonWaning")}
            onClick={() => onChange(active ? "" : phase)}
            className={cn(
              "h-[var(--aries-control-height-small)] border-r border-border px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] last:border-r-0 hover:bg-muted/70",
              active && "bg-primary/20 text-primary",
            )}
          >
            {phase === "waxing" ? t("search.moonWaxingShort") : t("search.moonWaningShort")}
          </button>
        );
      })}
    </div>
  );
}

function CheckRow({
  checked,
  label,
  glyph,
  glyphFont,
  marker,
  segments,
  meta,
  inlineControl,
  onChange,
}: {
  checked: boolean;
  label: string;
  glyph?: string;
  glyphFont?: "morinus" | "text";
  marker?: string;
  segments?: TransitSearchObjectSegment[];
  meta?: string;
  inlineControl?: React.ReactNode;
  onChange: (checked: boolean) => void;
}) {
  const hasSegments = Boolean(segments?.length);
  if (inlineControl) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-[var(--aries-form-field-gap)] gap-y-[var(--aries-control-gap-compact)] rounded-md px-[var(--aries-control-gap)] py-[var(--aries-control-gap-compact)] text-xs hover:bg-muted/60">
        <label className="flex shrink-0 cursor-pointer items-center gap-[var(--aries-form-field-gap)]">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.currentTarget.checked)}
            className="size-[var(--aries-control-icon-size)] shrink-0 accent-primary"
          />
          {glyph ? <Glyph ch={glyph} font={glyphFont} className="aries-search-glyph w-4 text-center" /> : null}
          <span className="shrink-0">{label}</span>
        </label>
        {inlineControl}
        {marker ? <span className="aries-search-marker shrink-0 text-muted-foreground">{marker}</span> : null}
        {meta ? <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{meta}</span> : null}
      </div>
    );
  }
  return (
    <label className="flex min-w-0 cursor-pointer items-center gap-[var(--aries-form-field-gap)] rounded-md px-[var(--aries-control-gap)] py-[var(--aries-control-gap-compact)] text-xs hover:bg-muted/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="size-[var(--aries-control-icon-size)] shrink-0 accent-primary"
      />
      {hasSegments ? (
        <SegmentToken segments={segments ?? []} className="min-w-0 flex-1" />
      ) : (
        <>
          {glyph ? <Glyph ch={glyph} font={glyphFont} className="aries-search-glyph w-4 text-center" /> : null}
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </>
      )}
      {marker ? <span className="aries-search-marker shrink-0 text-muted-foreground">{marker}</span> : null}
      {meta ? <span className="shrink-0 tabular-nums text-muted-foreground">{meta}</span> : null}
    </label>
  );
}

const SearchRow = React.memo(function SearchRow({
  row,
  rowHeight,
  selected,
  contextMenuActive,
  contextMenuRows,
  visibleColumns,
  onSelect,
  onContextSelect,
  onSelectAll,
  onOpenTimedChart,
  onActionError,
}: {
  row: TransitSearchRow;
  rowHeight: number;
  selected: boolean;
  contextMenuActive: boolean;
  contextMenuRows: TransitSearchRow[];
  visibleColumns: SearchColumnKey[];
  onSelect: (row: TransitSearchRow, event?: React.MouseEvent) => void;
  onContextSelect: (row: TransitSearchRow) => void;
  onSelectAll: () => void;
  onOpenTimedChart: SearchOpenTimedChart;
  onActionError: (message: string | null) => void;
}) {
  return (
    <SearchRowContextMenu
      row={row}
      active={contextMenuActive}
      selectedRows={contextMenuRows}
      onSelectAll={onSelectAll}
      onOpenTimedChart={onOpenTimedChart}
      onActionError={onActionError}
    >
      <tr
        data-state={selected ? "selected" : undefined}
        className="aries-list-row aries-list-row--hover aries-list-row--selected cursor-context-menu border-b"
        style={{ height: rowHeight }}
        onClick={(event) => onSelect(row, event)}
        onContextMenu={() => onContextSelect(row)}
      >
        {renderSearchCells(row, visibleColumns, onOpenTimedChart)}
      </tr>
    </SearchRowContextMenu>
  );
});

function SearchCell({
  column,
  row,
  colSpan,
  onOpenTimedChart,
}: {
  column: SearchColumnKey;
  row: TransitSearchRow;
  colSpan?: number;
  onOpenTimedChart: SearchOpenTimedChart;
}) {
  const t = useT();
  switch (column) {
    case "date":
      return (
        <td className="aries-list-cell aries-search-date-text border-0 text-center tabular-nums" colSpan={colSpan}>
          <SearchDateTransitLink row={row} onOpenTimedChart={onOpenTimedChart} />
        </td>
      );
    case "time":
      return (
        <td className="aries-list-cell aries-search-time-text border-0 text-center tabular-nums" title={row.displayTime} colSpan={colSpan}>
          {shortDisplayTime(row)}
        </td>
      );
    case "aspect":
      return (
        <td className="aries-list-cell border-0 text-center" colSpan={colSpan}>
          <AspectCell row={row} />
        </td>
      );
    case "mz":
      return <td className="aries-list-cell border-0 text-center text-muted-foreground" colSpan={colSpan}>{row.primaryMode}</td>;
    case "dc":
      return <td className="aries-list-cell border-0 text-center text-muted-foreground" colSpan={colSpan}>{row.primaryDirection}</td>;
    case "from": {
      const fromDisplay = signChangeDisplay(row, "from");
      return (
        <td className="aries-list-cell border-0 text-center tabular-nums" title={fromDisplay.lon_text ?? ""} colSpan={colSpan}>
          <LongitudeValue display={fromDisplay} />
        </td>
      );
    }
    case "to": {
      const toDisplay = signChangeDisplay(row, "to");
      return (
        <td className="aries-list-cell border-0 text-center tabular-nums" title={toDisplay.lon_text ?? ""} colSpan={colSpan}>
          <LongitudeValue display={toDisplay} />
        </td>
      );
    }
    case "technique": {
      const displayLabel = techniqueDisplayLabel(row, t);
      return (
        <td className="aries-list-cell border-0 text-center text-muted-foreground" title={row.techniqueLabel} colSpan={colSpan}>
          {displayLabel}
        </td>
      );
    }
  }
}

function renderSearchCells(
  row: TransitSearchRow,
  visibleColumns: SearchColumnKey[],
  onOpenTimedChart: SearchOpenTimedChart,
) {
  const singleObject = isSingleObjectSearchRow(row);
  const spansTargetTrack = singleObject && visibleColumns.includes("from") && visibleColumns.includes("to");
  return visibleColumns.flatMap((column) => {
    if (singleObject && column === "to") return [];
    const colSpan = spansTargetTrack && column === "from" ? 2 : undefined;
    return (
      <SearchCell
        key={column}
        column={column}
        row={row}
        colSpan={colSpan}
        onOpenTimedChart={onOpenTimedChart}
      />
    );
  });
}

function SearchDateTransitLink({
  row,
  onOpenTimedChart,
}: {
  row: TransitSearchRow;
  onOpenTimedChart: SearchOpenTimedChart;
}) {
  const disabled = !row.canOpenChart || !row.openDatetime;
  const openTransit = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled || !row.openDatetime) return;
      onOpenTimedChart(row, "transits");
    },
    [disabled, onOpenTimedChart, row],
  );
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={openTransit}
      className="aries-search-date-text inline-flex justify-end tabular-nums underline-offset-2 hover:text-primary hover:underline disabled:pointer-events-none"
    >
      {row.displayDate}
    </button>
  );
}

function AspectCell({ row }: { row: TransitSearchRow }) {
  const t = useT();
  const aspectColor = semanticChartColor(
    stringValue(row.metadata.aspect_color_role),
    stringValue(row.metadata.aspect_color),
  );
  const isStation = Boolean(row.metadata.station);
  const singleObject = isSingleObjectSearchRow(row);
  const singleObjectTitle = singleObject ? heliacalRowTitle(row, t) : row.aspectLabel;
  const eventGlyphLabel = row.eventGlyph ? techniqueDisplayLabel(row, t) : row.promittorLabel;
  if (row.isSignChange) {
    const toDisplay = signChangeDisplay(row, "to");
    const targetGlyph = stringValue(toDisplay.sign_glyph);
    const targetColor = semanticChartColor(
      stringValue(toDisplay.sign_color_role),
      stringValue(toDisplay.sign_color),
    );
    return (
      <span className="inline-flex items-center justify-center gap-[var(--aries-control-gap)] whitespace-nowrap align-middle">
        <ObjectToken
          glyph={row.promittorGlyph}
          glyphFont={row.promittorGlyphFont}
          label={row.promittorLabel}
          marker={row.promittorMarker}
          segments={row.promittorSegments}
          display={row.promDisplay}
        />
        <span className="aries-search-ingress-arrow shrink-0" aria-hidden="true">→</span>
        {targetGlyph ? (
          <Glyph ch={targetGlyph} className="aries-search-glyph shrink-0" color={targetColor} title={row.significatorLabel.replace(/\|/g, " / ")} />
        ) : (
          <span>{row.significatorLabel.replace(/\|/g, "/")}</span>
        )}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "items-center gap-[var(--aries-control-gap-compact)] whitespace-nowrap",
        singleObject
          ? "inline-flex"
          : "grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
      )}
    >
      <ObjectToken
        glyph={row.eventGlyph || row.promittorGlyph}
        glyphFont={row.eventGlyph ? row.eventGlyphFont : row.promittorGlyphFont}
        label={eventGlyphLabel}
        marker={row.promittorMarker}
        segments={row.promittorSegments}
        display={row.promDisplay}
        suppressStateMarker={isStation}
        className={singleObject ? undefined : "justify-self-end"}
      />
      {isStation ? (
        <StationEventLabel code={stringValue(row.metadata.station_code)} label={row.aspectLabel} />
      ) : singleObject ? (
        <span className="text-muted-foreground" title={singleObjectTitle}>
          {row.aspectLabel}
        </span>
      ) : row.aspectGlyph ? (
        <Glyph ch={row.aspectGlyph} title={row.aspectLabel} className="aries-search-glyph" color={aspectColor} />
      ) : (
        <span className="text-muted-foreground">{row.aspectLabel}</span>
      )}
      {singleObject ? null : (
        <ObjectToken
          glyph={row.significatorGlyph}
          glyphFont={row.significatorGlyphFont}
          label={row.significatorLabel}
          marker={row.significatorMarker}
          segments={row.significatorSegments}
          display={row.sigDisplay}
          suppressStateMarker={isStation}
          className="justify-self-start"
        />
      )}
    </span>
  );
}

function StationEventLabel({ code, label }: { code: string; label: string }) {
  const t = useT();
  const marker = code === "SR" || code === "SD" ? code : "";
  return (
    <span className="inline-flex items-center gap-[var(--aries-control-gap-compact)]" title={label}>
      <span>{t("search.station")}</span>
      {marker ? <span className="aries-search-marker shrink-0 text-muted-foreground">{marker}</span> : null}
    </span>
  );
}

function ObjectToken({
  glyph,
  glyphFont,
  label,
  marker,
  segments,
  display,
  suppressStateMarker,
  className,
}: {
  glyph: string;
  glyphFont?: "morinus" | "text";
  label: string;
  marker?: string;
  segments?: TransitSearchObjectSegment[];
  display: SearchDisplay;
  suppressStateMarker?: boolean;
  className?: string;
}) {
  const suffix = label.match(/\s\(([^)]+)\)$/)?.[1] ?? "";
  const hasSegments = Boolean(segments?.length);
  const objectGlyph = glyph;
  const color = semanticChartColor(
    stringValue(display.glyph_color_role),
    stringValue(display.glyph_color_css),
  );
  const motionMarker = stringValue(display.motion_marker);
  const stateMarker = suppressStateMarker ? "" : suffix || motionMarker;
  const baseLabel = suffix ? label.replace(/\s\([^)]+\)$/, "") : label;
  const labelText = hasSegments ? "" : !objectGlyph ? baseLabel : "";
  return (
    <span className={cn("inline-flex items-center gap-[var(--aries-control-gap-compact)]", className)} title={label}>
      {hasSegments ? (
        <SegmentToken segments={segments ?? []} color={color} normalizeGlyphs />
      ) : objectGlyph ? (
        <Glyph ch={objectGlyph} font={glyphFont} className="aries-search-glyph aries-search-object-glyph" color={color} />
      ) : null}
      {labelText ? <span>{labelText}</span> : null}
      {marker ? <span className="aries-search-marker shrink-0 text-muted-foreground">{marker}</span> : null}
      {stateMarker ? <span className="aries-search-marker shrink-0 text-muted-foreground">{stateMarker}</span> : null}
    </span>
  );
}

function SegmentToken({
  segments,
  color,
  className,
  normalizeGlyphs = false,
}: {
  segments: TransitSearchObjectSegment[];
  color?: string;
  className?: string;
  normalizeGlyphs?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-[calc(var(--aries-control-gap-compact)/2)]", className)}>
      {segments.map((segment, index) =>
        segment.kind === "planet" || segment.kind === "glyph" ? (
          <Glyph
            key={`${index}:${segment.text}`}
            ch={segment.text}
            className={cn("aries-search-glyph", normalizeGlyphs && "aries-search-object-glyph")}
            color={color}
          />
        ) : (
          <span key={`${index}:${segment.text}`} className="shrink-0">
            {segment.text}
          </span>
        ),
      )}
    </span>
  );
}

function LongitudeValue({ display }: { display: SearchDisplay }) {
  const degreeText = stringValue(display.degree_text);
  const signGlyph = stringValue(display.sign_glyph);
  const signColor = semanticChartColor(
    stringValue(display.sign_color_role),
    stringValue(display.sign_color),
  );
  if (degreeText && signGlyph) {
    return (
      <span className="inline-flex items-center gap-[var(--aries-control-gap-compact)]">
        <span>{degreeText}</span>
        <Glyph ch={signGlyph} className="aries-search-sign-glyph shrink-0" color={signColor} />
      </span>
    );
  }
  return <>{display.lon_text ?? ""}</>;
}

function SearchRowContextMenu({
  row,
  active,
  selectedRows,
  onSelectAll,
  onOpenTimedChart,
  onActionError,
  children,
}: {
  row: TransitSearchRow;
  active: boolean;
  selectedRows: TransitSearchRow[];
  onSelectAll: () => void;
  onOpenTimedChart: SearchOpenTimedChart;
  onActionError: (message: string | null) => void;
  children: React.ReactElement;
}) {
  const t = useT();
  const tf = useTFallback();
  const menuRows = React.useMemo(
    () => (active && selectedRows.some((selected) => selected.key === row.key) ? selectedRows : [row]),
    [active, row, selectedRows],
  );
  const singleTimedRow = React.useMemo(
    () => (menuRows.length === 1 ? menuRows[0] : null),
    [menuRows],
  );
  const openChart = React.useCallback(
    (action: TimedChartAction) => {
      if (!singleTimedRow?.canOpenChart || !singleTimedRow.openDatetime) return;
      onActionError(null);
      onOpenTimedChart(singleTimedRow, action);
    },
    [onActionError, onOpenTimedChart, singleTimedRow],
  );
  // Clipboard/ICS strings come from the Python brains via /api/search/export
  // (searchbackend.build_clipboard_text / build_ics) — never assembled here.
  const copyTime = React.useCallback(() => {
    onActionError(null);
    void exportSearchRows(menuRows, "clipboard")
      .then((result) => copyText(result.text))
      .catch((err) => {
        const message = (err as Error).message || tf("search.copyFailed", "Copy failed");
        onActionError(message);
      });
  }, [menuRows, onActionError, tf]);
  const exportIcs = React.useCallback(() => {
    onActionError(null);
    void exportSearchRows(menuRows, "ics")
      .then((result) =>
        downloadTextFile(result.filename ?? "search.ics", "text/calendar;charset=utf-8", result.text),
      )
      .catch((err) => {
        const message = (err as Error).message || tf("search.icsExportFailed", "ICS export failed");
        onActionError(message);
      });
  }, [menuRows, onActionError, tf]);
  const timedDisabled = !singleTimedRow?.canOpenChart || !singleTimedRow.openDatetime;
  // wx gates: enabled only when EVERY selected row supports the action
  // (searchwnd._can_copy_selected_time:3248 / _can_export_selected_ics:3238).
  const copyDisabled = menuRows.length === 0 || !menuRows.every((selected) => selected.canExportTime);
  const icsDisabled = menuRows.length === 0 || !menuRows.every((selected) => selected.canExportIcs);
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      {active ? (
        <ContextMenuContent className="w-64">
          <ContextMenuItem onClick={onSelectAll}>{t("search.selectAll")}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={timedDisabled} onClick={() => openChart("solar")}>
            {t("search.openContainingSolarRevolution")}
          </ContextMenuItem>
          <ContextMenuItem disabled={timedDisabled} onClick={() => openChart("transits")}>
            {t("search.openAsTransit")}
          </ContextMenuItem>
          <ContextMenuItem disabled={timedDisabled} onClick={() => openChart("chart")}>
            {t("search.openAsChart")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={copyDisabled} onClick={copyTime}>
            <Clipboard className="size-[var(--aries-control-icon-size)]" />
            {t("search.copyTimeDate")}
          </ContextMenuItem>
          <ContextMenuItem disabled={icsDisabled} onClick={exportIcs}>
            {t("search.exportSelectedToIcs")}
          </ContextMenuItem>
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the textarea path; Chromium can reject clipboard writes
    // in localhost/Tauri focus edge cases even when the menu action is valid.
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
  if (!ok) {
    throw new Error("Clipboard write was blocked");
  }
}

function downloadTextFile(filename: string, type: string, content: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function useTransitSearchOptionsSeq(cachedSeq: number): number {
  const lastOptionsChange = useDaemonWorkspaceStore(
    (state) => state.lastRetainedDataOptionsChange,
  );
  const [seq, setSeq] = React.useState(() =>
    lastOptionsChange &&
    lastOptionsChange.styleOnly !== true &&
    lastOptionsChange.listDataChanged !== false
      ? lastOptionsChange.seq
      : cachedSeq,
  );

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

function Glyph({
  ch,
  className,
  title,
  color,
  font = "morinus",
}: {
  ch: string;
  className?: string;
  title?: string;
  color?: string;
  font?: "morinus" | "text";
}) {
  return (
    <span
      style={{ fontFamily: font === "morinus" ? "'AriesMorinus'" : undefined, color: color || undefined }}
      className={className}
      title={title}
      aria-hidden={!title}
    >
      {ch}
    </span>
  );
}

function getVisibleColumns(rows: TransitSearchRow[], form: SearchForm | null | undefined, t: TFunc): SearchColumnKey[] {
  const columns: SearchColumnKey[] = ["aspect"];
  const hasPrimaryMode = rows.some((row) => row.primaryMode);
  const hasPrimaryDirection = rows.some((row) => row.primaryDirection);
  if (hasPrimaryMode) columns.push("mz");
  if (hasPrimaryDirection) columns.push("dc");
  columns.push("from");
  if (searchCanProduceTargetColumn(form) || rows.some(rowHasTargetBody)) {
    columns.push("to");
  }
  const techniqueLabels = new Set(rows.map((row) => techniqueDisplayLabel(row, t)).filter(Boolean));
  if (techniqueLabels.size > 1) columns.push("technique");
  columns.push("date", "time");
  return columns;
}

function searchColumnLabel(
  t: TFunc,
  column: SearchColumnKey,
  visibleColumns: SearchColumnKey[],
  timeColumnLabel?: string,
): string {
  const singleObjectLayout = !visibleColumns.includes("to");
  if (singleObjectLayout && column === "aspect") return t("search.event");
  if (singleObjectLayout && column === "from") return t("search.position");
  if (column === "time" && timeColumnLabel) return timeColumnLabel;
  return t(SEARCH_COLUMNS[column].labelKey);
}

function searchCanProduceTargetColumn(form?: SearchForm | null): boolean {
  if (!form) return true;
  if (form.includeSignChanges) return true;
  const nonHeliacalTechniques = form.techniques.filter((technique) => technique !== "heliacal_phases");
  if (nonHeliacalTechniques.length === 0) return false;
  return form.aspects.length > 0 && form.significatorIds.length > 0;
}

function rowHasTargetBody(row: TransitSearchRow): boolean {
  if (isSingleObjectSearchRow(row)) return false;
  return Boolean(
    row.significatorId ||
      row.significatorLabel ||
      row.significatorGlyph ||
      row.significatorSegments.length ||
      row.sigDisplay.lon_text,
  );
}

function isSingleObjectSearchRow(row: TransitSearchRow): boolean {
  return Boolean(row.metadata.heliacal);
}

function heliacalRowTitle(row: TransitSearchRow, t: TFunc): string {
  const parts = [row.aspectLabel].filter(Boolean);
  const method = stringValue(row.metadata.heliacal_method_label);
  if (method) parts.push(method);
  const threshold = numberValue(row.metadata.heliacal_threshold_deg);
  if (threshold != null) parts.push(t("search.heliacalThreshold", { value: threshold.toFixed(1) }));
  const place = row.metadata.heliacal_calculation_place;
  if (isRecord(place)) {
    const name = stringValue(place.name);
    const lon = numberValue(place.longitude);
    const lat = numberValue(place.latitude);
    if (name) parts.push(t("search.heliacalChartPlace", { name }));
    else if (lon != null && lat != null) parts.push(t("search.heliacalChartPlaceCoords", { lon: lon.toFixed(2), lat: lat.toFixed(2) }));
  }
  return parts.join(" · ");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function shortDisplayTime(row: TransitSearchRow): string {
  const match = row.displayTime.match(/^(\d{1,2}:\d{2})/);
  return match?.[1] ?? row.displayTime;
}

function signChangeDisplay(row: TransitSearchRow, side: "from" | "to"): SearchDisplay {
  if (!row.isSignChange) return side === "from" ? row.promDisplay : row.sigDisplay;
  const key = side === "from" ? "sign_change_from_display" : "sign_change_to_display";
  const value = row.metadata[key];
  return isRecord(value) ? (value as SearchDisplay) : side === "from" ? row.promDisplay : row.sigDisplay;
}

function techniqueDisplayLabel(row: TransitSearchRow, t: TFunc): string {
  if (row.technique === "lunations" || row.technique === "eclipses") {
    if (row.metadata.eclipse_kind === "solar") return t("search.solarEclipse");
    if (row.metadata.eclipse_kind === "lunar") return t("search.lunarEclipse");
    if (row.metadata.lunation_kind === "new") return t("search.newMoon");
    if (row.metadata.lunation_kind === "full") return t("search.fullMoon");
  }
  const key = TECHNIQUE_DISPLAY_LABEL_KEYS[row.technique];
  const base = key ? t(key) : row.techniqueLabel;
  if (row.isSignChange || row.metadata.station || row.metadata.cazimi || row.metadata.heliacal || row.technique === "mundane_weather") {
    return base;
  }
  return row.techniqueLabel || base;
}

function techniqueFilterLabel(item: TransitSearchTechnique | { id: "sign_changes"; label: string }, t: TFunc): string {
  const key = TECHNIQUE_DISPLAY_LABEL_KEYS[item.id];
  return key ? t(key) : item.label;
}

function isObject(value: TransitSearchObject | undefined): value is TransitSearchObject {
  return value != null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function searchRangeQueryKey(form: SearchForm): string {
  return JSON.stringify({
    techniques: form.techniques,
    promittorIds: form.promittorIds,
    significatorIds: form.significatorIds,
    aspects: form.aspects,
    includeSignChanges: form.includeSignChanges,
    promittorMotion: form.promittorMotion,
    significatorMotion: form.significatorMotion,
    moonPhase: form.moonPhase,
    lunationOrb: form.lunationOrb,
    partFilter: form.partFilter,
  });
}

function searchSeedRange(
  fromDate: string,
  rangeTo: string,
): { fromDate: string; toDate: string } | null {
  if (!isIsoDate(fromDate) || !isIsoDate(rangeTo) || fromDate > rangeTo) return null;
  const candidateTo = addIsoDays(fromDate, 30);
  if (!candidateTo) return null;
  return { fromDate, toDate: candidateTo < rangeTo ? candidateTo : rangeTo };
}

function nextIsoDate(value: string): string | null {
  return addIsoDays(value, 1);
}

function previousIsoDate(value: string): string | null {
  if (!isIsoDate(value)) return null;
  let [year, month, day] = value.split("-").map(Number);
  day -= 1;
  if (day < 1) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    if (year < 1) return null;
    day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  }
  return isoDate(year, month, day);
}

function addIsoDays(value: string, days: number): string | null {
  if (!isIsoDate(value)) return null;
  let [year, month, day] = value.split("-").map(Number);
  for (let index = 0; index < days; index += 1) {
    day += 1;
    const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day <= monthDays) continue;
    day = 1;
    month += 1;
    if (month <= 12) continue;
    month = 1;
    year += 1;
  }
  if (year < 1 || year > 9999) return null;
  return isoDate(year, month, day);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function searchStreamRowKey(row: TransitSearchRow): string {
  const instant = row.eventJd == null
    ? `${row.eventDate}T${row.eventTime}`
    : String(Math.round(row.eventJd * 86400));
  return [
    instant,
    row.technique,
    row.aspect,
    row.promittorId,
    row.significatorId,
    row.notes,
  ].join("\u0000");
}

function normalizeSearchStreamRows(rows: readonly TransitSearchRow[]): TransitSearchRow[] {
  const byKey = new Map<string, TransitSearchRow>();
  for (const row of rows) {
    const key = searchStreamRowKey(row);
    byKey.set(key, row.key === key ? row : { ...row, key });
  }
  return [...byKey.values()].sort(compareSearchStreamRows);
}

function mergeSearchStreamRows(
  currentRows: readonly TransitSearchRow[],
  incomingRows: readonly TransitSearchRow[],
): TransitSearchRow[] {
  return normalizeSearchStreamRows([...currentRows, ...incomingRows]);
}

function compareSearchStreamRows(left: TransitSearchRow, right: TransitSearchRow): number {
  const leftJd = left.eventJd ?? Number.POSITIVE_INFINITY;
  const rightJd = right.eventJd ?? Number.POSITIVE_INFINITY;
  if (leftJd !== rightJd) return leftJd - rightJd;
  return searchStreamRowKey(left).localeCompare(searchStreamRowKey(right));
}

function searchViewportRowCount(scroller: HTMLDivElement | null, rowHeight: number): number {
  const height = eventListBodyViewportHeight(scroller, rowHeight * 12);
  return Math.max(1, Math.ceil(height / rowHeight));
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function preserveCatalogSelections(
  defaults: SearchForm,
  previous: SearchForm,
  catalog: TransitSearchCatalog,
): SearchForm {
  const techniqueIds = new Set(catalog.techniques.map((technique) => technique.id));
  const promittorIds = new Set(catalog.promittorIds);
  const significatorIds = new Set(catalog.significatorIds);
  const aspectIds = new Set(catalog.aspects.map((aspect) => aspect.id));
  return {
    ...defaults,
    ...previous,
    techniques: previous.techniques.filter((id) => techniqueIds.has(id)),
    promittorIds: previous.promittorIds.filter((id) => promittorIds.has(id)),
    significatorIds: previous.significatorIds.filter((id) => significatorIds.has(id)),
    aspects: previous.aspects.filter((id) => aspectIds.has(id)),
  };
}

function buildAutoRequestKey(params: {
  contextMode: boolean;
  significatorId: string | null;
  chartRole: "primary" | "outer" | null;
  customPointsKey: string;
  optionsSeq: number;
  form: SearchForm;
}): string {
  const { form, ...context } = params;
  return JSON.stringify({ ...context, query: searchSemanticQuery(form) });
}

function searchSemanticQuery(form: SearchForm) {
  return {
    fromDate: form.fromDate,
    toDate: form.toDate,
    techniques: form.techniques,
    promittorIds: form.promittorIds,
    significatorIds: form.significatorIds,
    aspects: form.aspects,
    includeSignChanges: form.includeSignChanges,
    promittorMotion: form.promittorMotion,
    significatorMotion: form.significatorMotion,
    moonPhase: form.moonPhase,
    lunationOrb: form.lunationOrb,
    limit: form.limit,
  };
}

function retainedSearchSourceForm(form: SearchForm): SearchForm {
  return {
    ...form,
    promittorMotion: "",
    significatorMotion: "",
    moonPhase: "",
    lunationOrb: SEARCH_RETAINED_LUNATION_ORB,
  };
}

function retainedSearchSourceCoversForm(source: SearchForm, active: SearchForm): boolean {
  return source.fromDate <= active.fromDate
    && source.toDate >= active.toDate
    && isIdSubset(active.techniques, source.techniques)
    && isIdSubset(active.promittorIds, source.promittorIds)
    && isIdSubset(active.significatorIds, source.significatorIds)
    && isIdSubset(active.aspects, source.aspects)
    && (!active.includeSignChanges || source.includeSignChanges)
    && (!source.promittorMotion || source.promittorMotion === active.promittorMotion)
    && (!source.significatorMotion || source.significatorMotion === active.significatorMotion)
    && (!source.moonPhase || source.moonPhase === active.moonPhase)
    && source.lunationOrb >= active.lunationOrb;
}

function retainedSearchDeltaPlan(
  currentSource: SearchForm | null,
  activeForm: SearchForm,
): RetainedSearchDeltaPlan | null {
  if (!currentSource) return null;
  const source = retainedSearchSourceForm(currentSource);
  const active = retainedSearchSourceForm(activeForm);
  const universeForm: SearchForm = {
    ...active,
    fromDate: source.fromDate < active.fromDate ? source.fromDate : active.fromDate,
    toDate: source.toDate > active.toDate ? source.toDate : active.toDate,
    techniques: unionIds(source.techniques, active.techniques),
    promittorIds: unionIds(source.promittorIds, active.promittorIds),
    significatorIds: unionIds(source.significatorIds, active.significatorIds),
    aspects: unionIds(source.aspects, active.aspects),
    includeSignChanges: source.includeSignChanges || active.includeSignChanges,
    limit: Math.max(source.limit, active.limit),
  };
  const newTechniques = differenceIds(active.techniques, source.techniques);
  const newPromittors = differenceIds(active.promittorIds, source.promittorIds);
  const newSignificators = differenceIds(active.significatorIds, source.significatorIds);
  const newAspects = differenceIds(active.aspects, source.aspects);
  const oldNonLunarTechniques = source.techniques.filter(
    (technique) => !SEARCH_LUNAR_TECHNIQUES.has(technique),
  );
  const oldAspectTechniques = source.techniques.filter(
    (technique) => !SEARCH_NON_ASPECT_TECHNIQUES.has(technique),
  );
  const deltaForms = [
    newTechniques.length > 0
      ? { ...universeForm, techniques: newTechniques, includeSignChanges: false }
      : null,
    newPromittors.length > 0
      ? {
          ...universeForm,
          techniques: oldNonLunarTechniques,
          promittorIds: newPromittors,
          includeSignChanges: source.includeSignChanges,
        }
      : null,
    newSignificators.length > 0
      ? {
          ...universeForm,
          techniques: oldAspectTechniques,
          promittorIds: source.promittorIds,
          significatorIds: newSignificators,
          includeSignChanges: false,
        }
      : null,
    newAspects.length > 0
      ? {
          ...universeForm,
          techniques: oldAspectTechniques,
          promittorIds: source.promittorIds,
          significatorIds: source.significatorIds,
          aspects: newAspects,
          includeSignChanges: false,
        }
      : null,
    active.includeSignChanges && !source.includeSignChanges
      ? {
          ...universeForm,
          techniques: [],
          promittorIds: active.promittorIds,
          significatorIds: [],
          aspects: [],
          includeSignChanges: true,
        }
      : null,
  ].filter((form): form is SearchForm => form != null && canRunSearch(form));

  const extendsRangeBefore = active.fromDate < source.fromDate;
  const extendsRangeAfter = active.toDate > source.toDate;
  const beforeTo = extendsRangeBefore ? previousIsoDate(source.fromDate) : null;
  const rangeForms = beforeTo && active.fromDate <= beforeTo
    ? [{ ...universeForm, fromDate: active.fromDate, toDate: beforeTo }]
    : [];
  return { universeForm, deltaForms, rangeForms, extendsRangeBefore, extendsRangeAfter };
}

function unionIds(left: readonly string[], right: readonly string[]): string[] {
  return uniqueIds([...left, ...right]);
}

function differenceIds(values: readonly string[], known: readonly string[]): string[] {
  const knownSet = new Set(known);
  return values.filter((value) => !knownSet.has(value));
}

function isIdSubset(values: readonly string[], universe: readonly string[]): boolean {
  const universeSet = new Set(universe);
  return values.every((value) => universeSet.has(value));
}

/** All Search controls are projections over a monotonically growing source.
 * Unknown combinations are fetched as deltas and merged into that source. */
function projectTransitSearchRows(
  sourceRows: readonly TransitSearchRow[],
  form: SearchForm | null,
): TransitSearchRow[] {
  if (!form) return sourceRows.slice();
  const techniques = new Set(form.techniques);
  const promittors = new Set(form.promittorIds);
  const significators = new Set(form.significatorIds);
  const aspects = new Set(form.aspects);
  return sourceRows.filter((row) => {
    if (row.eventDate < form.fromDate || row.eventDate > form.toDate) return false;
    if (row.technique === "sign_changes") {
      if (!form.includeSignChanges) return false;
    } else if (!techniques.has(row.technique)) {
      return false;
    }
    const lunarEvent = SEARCH_LUNAR_TECHNIQUES.has(row.technique);
    if (!lunarEvent && row.promittorId && !promittors.has(row.promittorId)) return false;
    if (row.significatorId && !significators.has(row.significatorId)) return false;
    if (
      row.technique !== "sign_changes"
      && !SEARCH_NON_ASPECT_TECHNIQUES.has(row.technique)
      && row.aspect
      && !aspects.has(row.aspect)
    ) return false;
    if (!searchRowMatchesMotion(row.promittorMarker, row.promDisplay.speed_lon, form.promittorMotion)) {
      return false;
    }
    if (!searchRowMatchesMotion(row.significatorMarker, row.sigDisplay.speed_lon, form.significatorMotion)) {
      return false;
    }
    if (
      form.moonPhase
      && row.promittorId === "planet:moon"
      && !lunarEvent
      && row.metadata.moon_phase !== form.moonPhase
    ) return false;
    const lunationContactOrb = numberValue(row.metadata.lunation_contact_orb);
    if (lunarEvent && lunationContactOrb != null && lunationContactOrb > form.lunationOrb) return false;
    return true;
  });
}

function searchRowMatchesMotion(
  markerValue: string,
  speedValue: unknown,
  filter: TransitSearchMotionFilter,
): boolean {
  if (!filter) return true;
  const marker = markerValue.toUpperCase();
  const speed = numberValue(speedValue);
  if (filter === "rx") return marker === "R" || marker === "SR" || marker === "SD";
  return marker === "" && speed != null && speed > 0;
}

function nearestTransitSearchRowIndex(
  rows: readonly TransitSearchRow[],
  eventJd: number | null,
  fallbackIndex: number,
): number {
  if (eventJd == null) return Math.max(0, Math.min(rows.length - 1, fallbackIndex));
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < rows.length; index += 1) {
    const rowJd = rows[index].eventJd;
    if (rowJd == null) continue;
    const distance = Math.abs(rowJd - eventJd);
    if (distance >= nearestDistance) continue;
    nearestDistance = distance;
    nearestIndex = index;
  }
  return nearestIndex;
}

function canRunSearch(form: SearchForm): boolean {
  const supportsLunarEvents = (
    form.techniques.includes("lunations") || form.techniques.includes("eclipses")
  )
    && form.aspects.length > 0
    && form.significatorIds.length > 0;
  const hasPromittors = form.promittorIds.length > 0;
  const hasAspectTechnique = form.techniques.some(
    (technique) => technique !== "heliacal_phases" && technique !== "lunations" && technique !== "eclipses",
  );
  const hasAspectCombinations =
    hasPromittors && hasAspectTechnique && form.aspects.length > 0 && form.significatorIds.length > 0;
  const supportsHeliacal = hasPromittors && form.techniques.includes("heliacal_phases");
  return hasAspectCombinations || (hasPromittors && form.includeSignChanges) || supportsHeliacal || supportsLunarEvents;
}

function clampInteger(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
