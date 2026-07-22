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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  cancelTransitSearch,
  fetchTransitSearchCatalog,
  fetchTransitSearchProgress,
  fetchTransitSearchContextCatalog,
  openDirectionsTimedChart,
  saveTransitSearchContextSettings,
  saveTransitSearchSettings,
  startTransitSearch,
  startTransitSearchContext,
  type EventTimeDisplayMeta,
  type TimedChartAction,
  type TransitSearchCatalog,
  type TransitSearchProgressResult,
  type TransitSearchTechnique,
  type TransitSearchObject,
  type TransitSearchObjectSegment,
  type TransitSearchRow,
  exportSearchRows,
  updateSearchDefaultRange,
} from "@/lib/daemon/client";
import {
  coerceDateConvention,
  formatIsoDateDisplay,
  parseDateDisplayInput,
  type DateConvention,
} from "@/lib/date-display";
import { LIST_ROLE_CLASSES } from "@/lib/list-tokens";
import { useT, useTFallback, type TFunc } from "@/lib/i18n/i18n";
import {
  getCachedListPayload,
  rememberListPayload,
} from "@/lib/table/payload-cache";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { cn } from "@/lib/utils";
import { type ListFollowPolicy } from "@/lib/list-follow-policy";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { beginWorkspaceSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";
import {
  ListLayoutPresetControl,
  listKeyDisplayOrder,
  useListLayoutPreset,
} from "./list-column-layout";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";

type SearchForm = {
  fromDate: string;
  toDate: string;
  techniques: string[];
  promittorIds: string[];
  significatorIds: string[];
  aspects: string[];
  includeSignChanges: boolean;
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
};
type SearchOpenTimedChart = (row: TransitSearchRow, action: TimedChartAction) => void;

const TRANSIT_SEARCH_CACHE = "transit-search";
const SEARCH_PROGRESS_POLL_MS = 180;
const EMPTY_SEARCH_ROWS: TransitSearchRow[] = [];

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
  const [sort, setSort] = React.useState<SearchSortState | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = React.useState<Set<string>>(() => new Set());
  const [contextRowKey, setContextRowKey] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState(initialCache?.summary ?? t("search.noResults"));
  const [catalogOptionsSeq, setCatalogOptionsSeq] = React.useState(() => (initialCache ? optionsSeq : -1));
  const [catalogLoading, setCatalogLoading] = React.useState(false);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [rangeDraft, setRangeDraft] = React.useState({ offsetMonths: -2, rangeMonths: 12 });
  const catalogRef = React.useRef<TransitSearchCatalog | null>(initialCache?.catalog ?? null);
  const searchControllerRef = React.useRef<AbortController | null>(null);
  const currentSearchSessionRef = React.useRef<string | null>(null);
  const settingsControllerRef = React.useRef<AbortController | null>(null);
  const lastAutoRequestKeyRef = React.useRef("");
  const lastCatalogContextKeyRef = React.useRef("");
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
    if (!catalog || !form) return;
    rememberSearchState({ optionsSeq, catalog, form, rows, summary, timeDisplay });
  }, [catalog, form, optionsSeq, rememberSearchState, rows, summary, timeDisplay]);

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
      partFilter: nextForm.partFilter,
      limit: nextForm.limit,
      persistSettings,
    }),
    [documentId],
  );

  const executeSearch = React.useCallback(
    (nextForm: SearchForm, options?: { persistSettings?: boolean }) => {
      const previousSessionId = currentSearchSessionRef.current;
      if (previousSessionId) {
        currentSearchSessionRef.current = null;
        void cancelTransitSearch(previousSessionId).catch(() => undefined);
      }
      searchControllerRef.current?.abort();
      const controller = new AbortController();
      searchControllerRef.current = controller;
      setSearchLoading(true);
      setError(null);
      const request = buildRequest(nextForm, options?.persistSettings ?? true);
      let lastProgressKey = "";
      const applyProgress = (result: TransitSearchProgressResult) => {
        if (controller.signal.aborted) return;
        if (result.error) {
          throw new Error(result.error);
        }
        const progressKey = [
          result.phase,
          result.rows.length,
          result.truncated ? "1" : "0",
          result.complete ? "1" : "0",
          result.summary,
          result.timeDisplay?.columnLabel ?? "",
          result.timeDisplay?.offsetsMinutes.join(",") ?? "",
        ].join(":");
        if (progressKey === lastProgressKey) return;
        lastProgressKey = progressKey;
        const nextTimeDisplay = result.timeDisplay ?? catalogRef.current?.timeDisplay ?? null;
        React.startTransition(() => {
          setRows(result.rows);
          setSelectedRowKeys(new Set());
          setSummary(result.summary);
          setTimeDisplay(nextTimeDisplay);
        });
        const currentCatalog = catalogRef.current;
        if (currentCatalog) {
          rememberSearchState({
            optionsSeq,
            catalog: currentCatalog,
            form: nextForm,
            rows: result.rows,
            summary: result.summary,
            timeDisplay: nextTimeDisplay,
          });
        }
      };
      const startPromise = contextMode
        ? startTransitSearchContext(
            {
              ...request,
              significatorId,
              chartRole,
              customPoints,
            },
            controller.signal,
          )
        : startTransitSearch(request, controller.signal);
      let startedSessionId = "";
      void startPromise
        .then(async (initial) => {
          if (controller.signal.aborted) {
            void cancelTransitSearch(initial.sessionId).catch(() => undefined);
            return;
          }
          startedSessionId = initial.sessionId;
          currentSearchSessionRef.current = initial.sessionId;
          applyProgress(initial);
          let current = initial;
          while (!controller.signal.aborted && !current.complete) {
            await delay(SEARCH_PROGRESS_POLL_MS, controller.signal);
            current = await fetchTransitSearchProgress(current.sessionId, controller.signal);
            applyProgress(current);
          }
        })
        .catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
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
    [buildRequest, chartRole, contextMode, customPoints, optionsSeq, rememberSearchState, significatorId, t],
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

  React.useEffect(() => {
    const controller = new AbortController();
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
        setSummary(cached.summary);
        const cachedTimeDisplay = cached.timeDisplay ?? cached.catalog.timeDisplay ?? null;
        setTimeDisplay(cachedTimeDisplay);
      } else {
        setRows([]);
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
        const defaults = {
          fromDate: data.defaults.fromDate,
          toDate: data.defaults.toDate,
          techniques: data.defaults.techniques,
          promittorIds: data.defaults.promittorIds,
          significatorIds: data.defaults.significatorIds,
          aspects: data.defaults.aspects,
          includeSignChanges: data.defaults.includeSignChanges,
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
          executeSearch(defaults, { persistSettings: false });
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
    executeSearch,
    optionsSeq,
    significatorId,
    t,
  ]);

  React.useEffect(() => {
    return () => {
      const sessionId = currentSearchSessionRef.current;
      if (sessionId) {
        currentSearchSessionRef.current = null;
        void cancelTransitSearch(sessionId).catch(() => undefined);
      }
      searchControllerRef.current?.abort();
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
        executeSearch(form);
      } else {
        saveSettings(form);
        setRows([]);
        setSelectedRowKeys(new Set());
        setSummary(t("search.noValidCombinations"));
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    catalog,
    catalogOptionsSeq,
    contextMode,
    customPointsKey,
    executeSearch,
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

  const updateForm = React.useCallback((patch: Partial<SearchForm>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const setSelected = React.useCallback((key: SelectionKey, ids: string[]) => {
    setForm((prev) => (prev ? { ...prev, [key]: ids } : prev));
  }, []);

  const toggleSelected = React.useCallback((key: SelectionKey, id: string, checked: boolean) => {
    setForm((prev) => {
      if (!prev) return prev;
      const current = new Set(prev[key]);
      if (checked) current.add(id);
      else current.delete(id);
      return { ...prev, [key]: Array.from(current) };
    });
  }, []);

  const runDateRangeSearch = React.useCallback(
    (fromDate: string, toDate: string) => {
      setForm((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          fromDate,
          toDate,
        };
        if (canRunSearch(next)) executeSearch(next);
        return next;
      });
    },
    [executeSearch],
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

  const applyDefaultRange = React.useCallback(() => {
    if (!catalog) return;
    updateForm({
      fromDate: catalog.defaults.fromDate,
      toDate: catalog.defaults.toDate,
    });
    setRows([]);
    setSelectedRowKeys(new Set());
    setSummary(t("search.noResultsSetRange"));
  }, [catalog, updateForm, t]);

  const saveDefaultRange = React.useCallback(() => {
    void updateSearchDefaultRange(rangeDraft)
      .then((result) => {
        setRangeDraft({
          offsetMonths: result.defaultOffsetMonths,
          rangeMonths: result.defaultRangeMonths,
        });
        setCatalog((prev) =>
          prev
            ? {
                ...prev,
                defaults: {
                  ...prev.defaults,
                  defaultOffsetMonths: result.defaultOffsetMonths,
                  defaultRangeMonths: result.defaultRangeMonths,
                  fromDate: result.fromDate,
                  toDate: result.toDate,
                },
              }
            : prev,
        );
        updateForm({ fromDate: result.fromDate, toDate: result.toDate });
        setSettingsOpen(false);
        setRows([]);
        setSelectedRowKeys(new Set());
        setSummary(t("search.noResultsSetRange"));
      })
      .catch((err) => setError((err as Error).message));
  }, [rangeDraft, updateForm, t]);

  const resetPlanetSelection = React.useCallback(() => {
    if (!catalog || !form) return;
    const selectedParts = form.significatorIds.filter((id) => catalog.partIds.includes(id));
    const next = {
      ...form,
      promittorIds: catalog.presets.promittors.standard,
      significatorIds: uniqueIds([...catalog.presets.significators.standard, ...selectedParts]),
    };
    setForm(next);
    saveSettings(next);
    if (canRunSearch(next)) executeSearch(next);
  }, [catalog, executeSearch, form, saveSettings]);

  const currentYear = React.useMemo(() => {
    const value = Number((form?.fromDate ?? "").slice(0, 4));
    return Number.isFinite(value) && value > 0 ? value : new Date().getFullYear();
  }, [form?.fromDate]);
  const layoutPreset = useListLayoutPreset();
  const sortedRows = React.useMemo(() => sortTransitSearchRows(rows, sort), [rows, sort]);
  const visibleColumns = React.useMemo(
    () =>
      listKeyDisplayOrder(getVisibleColumns(rows, form, t), layoutPreset, {
        dateKeys: ["date"],
        timeKeys: ["time"],
        eventKeys: ["aspect"],
      }),
    [form, layoutPreset, rows, t],
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
      void openDirectionsTimedChart(documentId, action, row.openDatetime, null, null, null, showRadix)
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
  const paneSeedGlyph = props.mode === "context" ? (props.glyph ?? "") : "";
  const paneSeedLabel = props.mode === "context" ? (props.label ?? "") : "";
  const seedGlyph = catalog.initialSignificatorGlyph || paneSeedGlyph;
  const seedLabel = catalog.initialSignificatorLabel || paneSeedLabel;

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
            onClick={() => executeSearch(form)}
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
                <Glyph ch={seedGlyph} className="text-sm" title={seedLabel} />
                {seedLabel ? <span className="max-w-20 truncate">{seedLabel}</span> : null}
              </span>
            ) : null}
            <span className="shrink-0 whitespace-nowrap">
              {searchLoading ? <LoadingLabel label={rows.length > 0 ? summary : t("search.computing")} /> : summary}
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
                <DropdownMenuItem onClick={applyDefaultRange}>
                  {t("search.applyDefaultDateRange")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={resetPlanetSelection}>
                  {t("search.resetPlanetSelection")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                  {t("search.searchSettingsItem")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error ? (
            <div className="border-b border-border px-[var(--aries-pane-content-padding)] py-[var(--aries-pane-header-padding-y)] text-xs text-destructive">
              {error}
            </div>
          ) : null}
          <div className="flex-1 min-h-0 overflow-auto">
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
              <tbody>
                {rows.length === 0 && !searchLoading ? (
                  <tr>
                    <td className="px-[var(--aries-control-padding-x-compact)] py-[var(--aries-pane-title-gap)] text-center text-muted-foreground" colSpan={visibleColumns.length}>
                      {t("search.noResultsSetRange")}
                    </td>
                  </tr>
                ) : rows.length === 0 && searchLoading ? (
                  <tr>
                    <td className="px-[var(--aries-control-padding-x-compact)] py-[var(--aries-pane-title-gap)] text-center text-muted-foreground" colSpan={visibleColumns.length}>
                      <LoadingLabel label={t("search.searching")} />
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((row) => (
                    <SearchRow
                      key={row.key}
                      row={row}
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        {filtersOpen ? (
          <aside className="absolute inset-y-0 right-0 z-20 flex w-[var(--aries-pane-drawer-width)] flex-col gap-[var(--aries-pane-title-gap)] overflow-auto border-l border-border bg-background/95 px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-title-gap)] shadow-xl backdrop-blur-sm">
            <div className="mb-1 flex items-center justify-end">
              <Button type="button" size="icon-xs" variant="ghost" onClick={() => setFiltersOpen(false)} aria-label={t("search.closeFilters")}>
                <X className="size-[var(--aries-control-icon-size)]" />
              </Button>
            </div>
            <TechniqueGroup
              techniques={techniques}
              selected={form.techniques}
              includeSignChanges={form.includeSignChanges}
              onToggle={(id, checked) => toggleSelected("techniques", id, checked)}
              onIncludeSignChanges={(includeSignChanges) => updateForm({ includeSignChanges })}
            />
            <AspectGroup
              selected={form.aspects}
              catalog={catalog}
              onToggle={(id, checked) => toggleSelected("aspects", id, checked)}
              onSetAll={() => setSelected("aspects", catalog.presets.aspects.all)}
              onSetMajor={() => setSelected("aspects", catalog.presets.aspects.major)}
              onClear={() => setSelected("aspects", catalog.presets.aspects.clear)}
            />
            <SelectionGroup
              title={t("search.promissors")}
              selected={form.promittorIds}
              items={promittors}
              compact
              onToggle={(id, checked) => toggleSelected("promittorIds", id, checked)}
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
              onToggle={(id, checked) => toggleSelected("significatorIds", id, checked)}
              actions={[
                [t("search.builtins"), () => setSelected("significatorIds", catalog.presets.significators.builtins)],
                [t("search.planets"), () => setSelected("significatorIds", catalog.presets.significators.planets)],
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
                onFilterChange={(partFilter) => updateForm({ partFilter })}
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
          </aside>
        ) : null}
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
                value={rangeDraft.offsetMonths}
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
            <div className="flex items-center justify-between gap-[var(--aries-form-row-gap)] border-t border-border pt-[var(--aries-form-row-gap)]">
              <span className="text-xs text-muted-foreground">{t("search.planetSelection")}</span>
              <Button type="button" size="sm" variant="outline" onClick={resetPlanetSelection}>
                {t("search.resetToStandard")}
              </Button>
            </div>
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
  filterValue,
  onFilterChange,
  onToggle,
  actions,
}: {
  title: string;
  selected: string[];
  items: TransitSearchObject[];
  compact?: boolean;
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
            marker={obj.displayMarker}
            segments={obj.displaySegments}
            meta={obj.longitudeText}
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
    byId.get("secondary_directions"),
    byId.get("primary_directions"),
  ].filter(Boolean) as Array<TransitSearchTechnique | { id: "sign_changes"; label: string }>;
  return (
    <section className="grid gap-[var(--aries-form-field-gap)]">
      <h2 className="aries-search-panel-heading text-xs">{t("search.techniques")}</h2>
      <div className="grid grid-cols-2 gap-x-[var(--aries-pane-content-padding)] gap-y-[var(--aries-control-gap-compact)]">
        {orderedRows.map((item) => (
          <CheckRow
            key={item.id}
            checked={item.id === "sign_changes" ? includeSignChanges : selectedSet.has(item.id)}
            label={techniqueFilterLabel(item, t)}
            onChange={(checked) =>
              item.id === "sign_changes" ? onIncludeSignChanges(checked) : onToggle(item.id, checked)
            }
          />
        ))}
      </div>
    </section>
  );
}

function AspectGroup({
  selected,
  catalog,
  onToggle,
  onSetAll,
  onSetMajor,
  onClear,
}: {
  selected: string[];
  catalog: TransitSearchCatalog;
  onToggle: (id: string, checked: boolean) => void;
  onSetAll: () => void;
  onSetMajor: () => void;
  onClear: () => void;
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
        {catalog.aspects.map((aspect) => (
          <button
            key={aspect.id}
            type="button"
            title={aspect.label}
            aria-pressed={selectedSet.has(aspect.id)}
            onClick={() => onToggle(aspect.id, !selectedSet.has(aspect.id))}
            className={cn(
              "flex h-[var(--aries-control-height)] items-center justify-center border-r border-border text-[16px] last:border-r-0 hover:bg-muted/70",
              selectedSet.has(aspect.id) && "bg-primary/20 text-primary",
            )}
          >
            <Glyph ch={aspect.glyph} title={aspect.label} />
          </button>
        ))}
      </div>
    </section>
  );
}

function GroupHeader({
  title,
  selected,
  total,
  actions,
}: {
  title: string;
  selected: number;
  total: number;
  actions: Array<[string, () => void]>;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-[var(--aries-control-gap)]">
      <div className="min-w-0">
        <h2 className="aries-search-panel-heading truncate text-xs">{title}</h2>
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

function CheckRow({
  checked,
  label,
  glyph,
  marker,
  segments,
  meta,
  onChange,
}: {
  checked: boolean;
  label: string;
  glyph?: string;
  marker?: string;
  segments?: TransitSearchObjectSegment[];
  meta?: string;
  onChange: (checked: boolean) => void;
}) {
  const hasSegments = Boolean(segments?.length);
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
          {glyph ? <Glyph ch={glyph} className="aries-search-glyph w-4 text-center" /> : null}
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
    <span className="inline-flex items-center gap-[var(--aries-control-gap-compact)] whitespace-nowrap">
      <ObjectToken
        glyph={row.promittorGlyph}
        label={row.promittorLabel}
        marker={row.promittorMarker}
        segments={row.promittorSegments}
        display={row.promDisplay}
        suppressStateMarker={isStation}
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
          label={row.significatorLabel}
          marker={row.significatorMarker}
          segments={row.significatorSegments}
          display={row.sigDisplay}
          suppressStateMarker={isStation}
        />
      )}
    </span>
  );
}

function StationEventLabel({ code, label }: { code: string; label: string }) {
  const t = useT();
  const rx = code === "SR" || /\bRx\b/i.test(label);
  const direct = code === "SD" || /\bD\b/.test(label);
  const marker = rx ? "Rx" : direct ? "D" : "";
  return (
    <span className="inline-flex items-center" title={label}>
      <span>{marker ? `${t("search.station")} ${marker}` : t("search.station")}</span>
    </span>
  );
}

function ObjectToken({
  glyph,
  label,
  marker,
  segments,
  display,
  suppressStateMarker,
}: {
  glyph: string;
  label: string;
  marker?: string;
  segments?: TransitSearchObjectSegment[];
  display: SearchDisplay;
  suppressStateMarker?: boolean;
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
    <span className="inline-flex items-center gap-[var(--aries-control-gap-compact)]" title={label}>
      {hasSegments ? (
        <SegmentToken segments={segments ?? []} color={color} />
      ) : objectGlyph ? (
        <Glyph ch={objectGlyph} className="aries-search-glyph" color={color} />
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
}: {
  segments: TransitSearchObjectSegment[];
  color?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-[calc(var(--aries-control-gap-compact)/2)]", className)}>
      {segments.map((segment, index) =>
        segment.kind === "planet" || segment.kind === "glyph" ? (
          <Glyph key={`${index}:${segment.text}`} ch={segment.text} className="aries-search-glyph" color={color} />
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
  const lastOptionsChange = useDaemonWorkspaceStore((state) => state.lastOptionsChange);
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
  const nonHeliacalTechniques = form.techniques.filter((technique) => technique !== "heliacal_phases");
  if (nonHeliacalTechniques.length === 0) return false;
  const hasAspectTargets = form.aspects.length > 0 && form.significatorIds.length > 0;
  const hasSignChangeTargets =
    form.includeSignChanges &&
    (form.techniques.includes("transits") || form.techniques.includes("mundane_weather"));
  return hasAspectTargets || hasSignChangeTargets;
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

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
  return JSON.stringify(params);
}

function canRunSearch(form: SearchForm): boolean {
  if (form.techniques.length === 0 || form.promittorIds.length === 0) return false;
  const hasAspectCombinations = form.aspects.length > 0 && form.significatorIds.length > 0;
  const supportsSignChanges =
    form.techniques.includes("transits") || form.techniques.includes("mundane_weather");
  const supportsHeliacal = form.techniques.includes("heliacal_phases");
  return hasAspectCombinations || (form.includeSignChanges && supportsSignChanges) || supportsHeliacal;
}

function clampInteger(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
