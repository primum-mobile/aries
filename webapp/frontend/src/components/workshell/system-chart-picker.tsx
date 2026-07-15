// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteChartPickerRows,
  fetchChartPickerSearchCatalog,
  renameChartPickerRow,
  searchChartPickerRows,
  workspaceActivate,
  workspaceOpen,
  workspaceOpenSynastry,
  type ChartPickerAspectClause,
  type ChartPickerChoice,
  type ChartPickerMatchRun,
  type ChartPickerPlacementClause,
  type ChartPickerRow,
  type ChartPickerRowsPayload,
  type ChartPickerSearchCatalog,
  type ChartPickerSearchRow,
} from "@/lib/daemon/client";
import {
  CHART_PICKER_ROWS_REFRESH_MIN_INTERVAL_MS,
  getCachedChartPickerRows,
  loadChartPickerRows,
  replaceCachedChartPickerRows,
  shouldRefreshChartPickerRows,
  syncChartPickerRowsFromStorage,
} from "@/lib/chart-picker/rows-cache";
import { perfNow, recordChartPerf } from "@/lib/chart/perf";
import { resolveShellHost } from "@/lib/shell-host";
import { safeShellUnlisten } from "@/lib/shell/unlisten";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import {
  requestMainWorkspaceCommand,
  runBroadcastWorkspaceCommand,
  type WorkspaceCommandOpenRow,
  type WorkspaceCommandRequestPayload,
  type WorkspaceCommandResult,
} from "@/stores/workspace-command-bus";

import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";

type Mode = "open-radix" | "synastry-partner";

type Props = {
  mode: Mode;
  parentRadixId?: string | null;
  excludeNames?: string[];
};

type SortState = {
  column: keyof ChartPickerRow;
  ascending: boolean;
};

const DEFAULT_SORT: SortState = {
  column: "lastOpened",
  ascending: false,
};

function chartPickerDefaultSort(payload?: ChartPickerRowsPayload | null): SortState {
  if (payload?.defaultSort?.column === "lastOpened") {
    return {
      column: payload.defaultSort.column,
      ascending: payload.defaultSort.ascending,
    };
  }
  return DEFAULT_SORT;
}

const COLUMN_DEFS: Array<{
  key: keyof ChartPickerRow;
  labelKey: string;
}> = [
  { key: "name", labelKey: "picker.colName" },
  { key: "date", labelKey: "picker.colBirthDate" },
  { key: "time", labelKey: "picker.colTime" },
  { key: "type", labelKey: "picker.colType" },
  { key: "place", labelKey: "picker.colLocation" },
  { key: "gender", labelKey: "picker.colGender" },
  { key: "collection", labelKey: "picker.colCollection" },
  { key: "modified", labelKey: "picker.colModified" },
  { key: "lastOpened", labelKey: "picker.colLastOpened" },
];
const CHART_PICKER_COLUMN_IDS = COLUMN_DEFS.map((column) => column.key);

const SEARCH_COLUMNS = [
  { key: "name", labelKey: "picker.colName" },
  { key: "date", labelKey: "picker.colDate" },
  { key: "time", labelKey: "picker.colTime" },
  { key: "type", labelKey: "picker.colType" },
  { key: "collection", labelKey: "picker.colCollection" },
  { key: "place", labelKey: "picker.colPlace" },
  { key: "matches", labelKey: "picker.colMatches" },
] as const;
const CHART_SEARCH_COLUMN_IDS = SEARCH_COLUMNS.map((column) => column.key);
type ChartSearchColumnKey = (typeof SEARCH_COLUMNS)[number]["key"];
type ChartSearchSortState = {
  column: ChartSearchColumnKey;
  ascending: boolean;
};

const PICKER_ROW_HEIGHT = 24;
const PICKER_ROW_OVERSCAN = 12;
const PICKER_BACKGROUND_REFRESH_DELAY_MS = 120;

function prewarmPickerShellApi(): void {
  const shellHost = resolveShellHost();
  if (!shellHost.capabilities.chartPickerWindow) return;
  void shellHost.prewarmNativeApi();
}

async function hidePickerWindowForCommand(): Promise<boolean> {
  const shellHost = resolveShellHost();
  if (!shellHost.capabilities.chartPickerWindow) return false;
  const startedAt = perfNow();
  try {
    await shellHost.closeChartPickerWindow();
    recordChartPerf("chart-picker-hide", {
      phase: "before-command",
      ms: perfNow() - startedAt,
    });
    return true;
  } catch (error) {
    console.warn("[chart-picker-hide]", error);
    recordChartPerf("chart-picker-hide", {
      phase: "before-command",
      failed: true,
      ms: perfNow() - startedAt,
    });
    return false;
  }
}

async function restorePickerWindowAfterFailedCommand(): Promise<void> {
  const shellHost = resolveShellHost();
  if (!shellHost.capabilities.chartPickerWindow) return;
  try {
    await shellHost.restoreCurrentChartPickerWindow();
  } catch (error) {
    console.warn("[chart-picker-restore]", error);
  }
}

function toWorkspaceCommandRow(row: ChartPickerRow): WorkspaceCommandOpenRow {
  return {
    name: row.name,
    source: row.source,
    recordIndex: row.recordIndex,
  };
}

async function requestOrRunWorkspaceCommand<T extends WorkspaceCommandResult>(
  payload: WorkspaceCommandRequestPayload,
  runLocal: () => Promise<T>,
  fallbackDocumentId?: string | null,
): Promise<T> {
  const startedAt = perfNow();
  const shellHost = resolveShellHost();
  const requiresMainAck = !shellHost.capabilities.crossWindowCommandAckOptional;
  try {
    const result = await requestMainWorkspaceCommand<T>(payload, {
      requireAck: requiresMainAck,
    });
    recordChartPerf("chart-picker-main-command", {
      kind: payload.kind,
      path: "main",
      ms: perfNow() - startedAt,
    });
    return result;
  } catch (error) {
    if (!requiresMainAck) {
      recordChartPerf("chart-picker-main-command", {
        kind: payload.kind,
        path: "main-required",
        failed: true,
        error: error instanceof Error ? error.message : String(error),
        ms: perfNow() - startedAt,
      });
      throw error;
    }
    recordChartPerf("chart-picker-main-command", {
      kind: payload.kind,
      path: "fallback-local",
      failed: true,
      error: error instanceof Error ? error.message : String(error),
      ms: perfNow() - startedAt,
    });
    return runBroadcastWorkspaceCommand(runLocal, fallbackDocumentId);
  }
}

async function activateIfNeeded(opened: {
  documentId?: string | null;
  activeDocumentId?: string | null;
}): Promise<void> {
  if (
    !opened.documentId ||
    opened.activeDocumentId == null ||
    opened.activeDocumentId === opened.documentId
  ) {
    return;
  }
  await runBroadcastWorkspaceCommand(
    () => workspaceActivate(opened.documentId as string),
    opened.documentId,
  );
}

export function SystemChartPicker({
  mode,
  parentRadixId,
  excludeNames = [],
}: Props) {
  const t = useT();
  const [view, setView] = React.useState<"list" | "search">("list");
  const [rows, setRows] = React.useState<ChartPickerRow[]>([]);
  const [directory, setDirectory] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const [sort, setSort] = React.useState<SortState>(DEFAULT_SORT);
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(() => new Set());
  const [anchorKey, setAnchorKey] = React.useState<string | null>(null);
  const [contextRow, setContextRow] = React.useState<ChartPickerRow | null>(null);
  const [renameDialog, setRenameDialog] = React.useState<{
    row: ChartPickerRow;
    value: string;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = React.useState<ChartPickerRow[] | null>(null);
  const [mutatingRows, setMutatingRows] = React.useState(false);
  const listRef = React.useRef<HTMLElement | null>(null);
  const openingRef = React.useRef(false);
  const deferredFilter = React.useDeferredValue(filter);
  const listResize = useResizableTableColumns({
    storageKey: "chart-picker:list",
    columnIds: CHART_PICKER_COLUMN_IDS,
  });

  const applyRowsPayload = React.useCallback(
    (
      payload: ChartPickerRowsPayload,
      options: { resetSort?: boolean } = {},
    ) => {
      const { resetSort = true } = options;
      setRows(payload.rows);
      setDirectory(payload.directory);
      if (resetSort) {
        setSort(chartPickerDefaultSort(payload));
      }
      setError(null);
    },
    [],
  );

  React.useEffect(() => {
    prewarmPickerShellApi();
  }, []);

  React.useLayoutEffect(() => {
    let cancelled = false;
    const cached = getCachedChartPickerRows();
    if (cached && !shouldRefreshChartPickerRows(CHART_PICKER_ROWS_REFRESH_MIN_INTERVAL_MS)) {
      // Hydration must match the server, but the retained picker should adopt
      // its warm cache before first paint so opening the chrome does not flash.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      applyRowsPayload(cached);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    loadChartPickerRows(Boolean(cached))
      .then((payload) => {
        if (!cancelled) applyRowsPayload(payload);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [applyRowsPayload]);

  React.useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | null = null;
    function refreshOnFocus() {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      const refreshNow = rows.length === 0;
      if (!refreshNow && !shouldRefreshChartPickerRows(CHART_PICKER_ROWS_REFRESH_MIN_INTERVAL_MS)) return;
      const run = () => {
        loadChartPickerRows(true)
          .then((payload) => {
            if (!cancelled) {
              React.startTransition(() => {
                applyRowsPayload(payload, { resetSort: false });
              });
            }
          })
          .catch((err) => {
            if (!cancelled && rows.length === 0) setError((err as Error).message);
          });
      };
      if (refreshNow) run();
      else refreshTimer = window.setTimeout(run, PICKER_BACKGROUND_REFRESH_DELAY_MS);
    }
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      cancelled = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [applyRowsPayload, rows.length]);

  const visibleRows = React.useMemo(() => {
    const q = deferredFilter.trim().toLowerCase();
    const excluded = new Set(excludeNames);
    const base = rows.filter((row) => {
      if (excluded.has(row.name)) return false;
      if (!q) return true;
      return [
        row.name,
        row.date,
        row.time,
        row.type,
        row.place,
        row.gender,
        row.collection,
        row.modified,
        row.lastOpened,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    return sortRows(base, sort);
  }, [rows, deferredFilter, sort, excludeNames]);

  const virtualRows = useVirtualPickerRows(listRef, visibleRows.length);
  const renderedRows = React.useMemo(
    () => visibleRows.slice(virtualRows.startIndex, virtualRows.endIndex),
    [visibleRows, virtualRows.startIndex, virtualRows.endIndex],
  );

  const selectedRows = React.useMemo(
    () => visibleRows.filter((row) => selectedKeys.has(row.key)),
    [visibleRows, selectedKeys],
  );

  const selectRow = React.useCallback(
    (row: ChartPickerRow, event: React.MouseEvent) => {
      setSelectedKeys((current) => {
        const next = new Set(current);
        if (event.shiftKey && anchorKey) {
          next.clear();
          const a = visibleRows.findIndex((item) => item.key === anchorKey);
          const b = visibleRows.findIndex((item) => item.key === row.key);
          if (a >= 0 && b >= 0) {
            const [start, end] = a < b ? [a, b] : [b, a];
            for (let i = start; i <= end; i += 1) next.add(visibleRows[i].key);
            return next;
          }
        }
        if (event.metaKey || event.ctrlKey) {
          if (next.has(row.key)) next.delete(row.key);
          else next.add(row.key);
          return next;
        }
        return new Set([row.key]);
      });
      setAnchorKey(row.key);
    },
    [anchorKey, visibleRows],
  );

  const ensureContextSelection = React.useCallback((row: ChartPickerRow) => {
    setSelectedKeys((current) => {
      if (current.has(row.key)) return current;
      return new Set([row.key]);
    });
    setAnchorKey(row.key);
    setContextRow(row);
  }, []);

  const refreshRows = React.useCallback((nextRows: ChartPickerRow[]) => {
    replaceCachedChartPickerRows(nextRows);
    setRows(nextRows);
    setSelectedKeys(new Set());
    setAnchorKey(null);
  }, []);

  const resetPickerState = React.useCallback(() => {
    setView("list");
    setFilter("");
    setSort(DEFAULT_SORT);
    setSelectedKeys(new Set());
    setAnchorKey(null);
    setContextRow(null);
    setRenameDialog(null);
    setDeleteDialog(null);
    listRef.current?.scrollTo({ top: 0 });
  }, []);

  const closeAndReset = React.useCallback(() => {
    resetPickerState();
    void closePickerWindow();
  }, [resetPickerState]);

  React.useEffect(() => {
    const shellHost = resolveShellHost();
    if (!shellHost.capabilities.chartPickerWindow) return undefined;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    shellHost
      .listenChartPickerWindowEvents((payload) => {
        if (payload.phase === "open" && payload.visible === true) {
          resetPickerState();
          const cached = syncChartPickerRowsFromStorage();
          if (cached) {
            applyRowsPayload(cached);
            setLoading(false);
          }
        }
      })
      .then((cleanup) => {
        if (disposed) safeShellUnlisten(cleanup);
        else unlisten = cleanup;
      })
      .catch((err) => console.warn("[chart-picker-window-event]", err));
    return () => {
      disposed = true;
      safeShellUnlisten(unlisten);
    };
  }, [applyRowsPayload, resetPickerState]);

  const openRows = React.useCallback(
    async (targets: ChartPickerRow[], asSynastry = false) => {
      if (!targets.length) return;
      if (openingRef.current) return;
      if (mode === "synastry-partner" && !parentRadixId) return;
      openingRef.current = true;
      recordChartPerf("chart-picker-open-intent", {
        mode,
        asSynastry,
        targets: targets.length,
      });
      const hidePromise = hidePickerWindowForCommand();
      let succeeded = false;
      try {
        if (mode === "synastry-partner") {
          const row = targets[0];
          const commandRow = toWorkspaceCommandRow(row);
          const opened = await requestOrRunWorkspaceCommand(
            {
              kind: "open-synastry-partner",
              parentRadixId: parentRadixId as string,
              row: commandRow,
            },
            () => workspaceOpenSynastry(
              parentRadixId as string,
              commandRow.name,
              commandRow.source,
              commandRow.recordIndex,
            ),
          );
          await activateIfNeeded(opened);
          succeeded = true;
          return;
        }
        if (asSynastry && targets.length === 2) {
          const [center, partner] = targets;
          const centerRow = toWorkspaceCommandRow(center);
          const partnerRow = toWorkspaceCommandRow(partner);
          const opened = await requestOrRunWorkspaceCommand(
            {
              kind: "open-two-synastry",
              center: centerRow,
              partner: partnerRow,
            },
            async () => {
              const root = await workspaceOpen({
                sourceName: centerRow.name,
                source: centerRow.source,
                recordIndex: centerRow.recordIndex,
              });
              if (!root.documentId) return root;
              return workspaceOpenSynastry(
                root.documentId,
                partnerRow.name,
                partnerRow.source,
                partnerRow.recordIndex,
              );
            },
          );
          await activateIfNeeded(opened);
          succeeded = true;
          return;
        }
        for (const row of targets) {
          const commandRow = toWorkspaceCommandRow(row);
          await requestOrRunWorkspaceCommand(
            { kind: "open-radix", row: commandRow },
            () =>
              workspaceOpen({
                sourceName: commandRow.name,
                source: commandRow.source,
                recordIndex: commandRow.recordIndex,
              }),
          );
        }
        succeeded = true;
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
        if (await hidePromise.catch(() => false)) {
          await restorePickerWindowAfterFailedCommand();
        }
        throw error;
      } finally {
        openingRef.current = false;
        const hiddenBeforeCommand = await hidePromise.catch(() => false);
        if (succeeded && !hiddenBeforeCommand) {
          await closePickerWindow();
        }
      }
    },
    [mode, parentRadixId],
  );

  const openSelected = React.useCallback(
    async (asSynastry = false) => {
      const targets = selectedRows.length ? selectedRows : visibleRows.slice(0, 1);
      await openRows(targets, asSynastry);
    },
    [openRows, selectedRows, visibleRows],
  );

  const renameRows = React.useCallback((targets: ChartPickerRow[]) => {
    if (targets.length !== 1) return;
    const row = targets[0];
    setRenameDialog({ row, value: row.name });
  }, []);

  const deleteRows = React.useCallback((targets: ChartPickerRow[]) => {
    if (!targets.length) return;
    setDeleteDialog([...targets]);
  }, []);

  const commitRename = React.useCallback(async () => {
    if (!renameDialog || mutatingRows) return;
    const trimmed = renameDialog.value.trim();
    if (!trimmed || trimmed === renameDialog.row.name) {
      setRenameDialog(null);
      return;
    }
    setMutatingRows(true);
    setError(null);
    try {
      const result = await renameChartPickerRow(renameDialog.row, trimmed);
      refreshRows(result.rows);
      setRenameDialog(null);
    } catch (err) {
      setError((err as Error).message);
      setRenameDialog(null);
    } finally {
      setMutatingRows(false);
    }
  }, [mutatingRows, refreshRows, renameDialog]);

  const commitDelete = React.useCallback(async () => {
    if (!deleteDialog?.length || mutatingRows) return;
    setMutatingRows(true);
    setError(null);
    try {
      const result = await deleteChartPickerRows(deleteDialog);
      refreshRows(result.rows);
      setDeleteDialog(null);
    } catch (err) {
      setError((err as Error).message);
      setDeleteDialog(null);
    } finally {
      setMutatingRows(false);
    }
  }, [deleteDialog, mutatingRows, refreshRows]);

  const deleteSelected = React.useCallback(() => deleteRows(selectedRows), [deleteRows, selectedRows]);

  const contextRows = React.useMemo(() => {
    if (!contextRow) return [];
    if (selectedKeys.has(contextRow.key) && selectedRows.length) return selectedRows;
    return [contextRow];
  }, [contextRow, selectedKeys, selectedRows]);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const editing =
        target?.tagName === "INPUT" ||
        target?.tagName === "SELECT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (editing && event.key !== "Escape") return;
      if (event.key === "Escape") {
        if (renameDialog) {
          setRenameDialog(null);
          event.preventDefault();
          return;
        }
        if (deleteDialog) {
          setDeleteDialog(null);
          event.preventDefault();
          return;
        }
        if (view === "search") setView("list");
        else closeAndReset();
        event.preventDefault();
        return;
      }
      if (renameDialog || deleteDialog) return;
      if (view !== "list") return;
      if (event.key === "Enter") {
        void openSelected(selectedRows.length === 2);
        event.preventDefault();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        void deleteSelected();
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    view,
    openSelected,
    deleteSelected,
    selectedRows.length,
    closeAndReset,
    renameDialog,
    deleteDialog,
  ]);

  const canOpen = selectedRows.length > 0;
  const canSynastry = mode === "open-radix" && selectedRows.length === 2;

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      {view === "list" ? (
        <>
          <header className="flex shrink-0 items-center gap-4 px-5 pb-2 pt-4">
            <div className="min-w-0 flex-1 truncate text-[18px] leading-none">
              {directory || t("picker.chartCollections")}
            </div>
            <Button
              variant="outline"
              className="h-8 min-w-[128px] rounded-md text-[14px] font-normal"
              onClick={() => setView("search")}
            >
              {t("picker.search")}
            </Button>
          </header>
          <div className="flex shrink-0 items-center gap-3 px-5 pb-2">
            <div className="relative w-[240px]">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t("picker.quickFilter")}
                className="h-7 pl-7 text-[13px]"
              />
            </div>
            <div className="text-[12px] text-muted-foreground">
              {t("picker.rowCount", { visible: visibleRows.length, total: rows.length })}
              {selectedRows.length ? t("picker.selectedSuffix", { count: selectedRows.length }) : ""}
            </div>
          </div>

          <main ref={listRef} className="mx-5 min-h-0 flex-1 overflow-auto border border-border bg-background">
            {loading ? (
              <div className="px-4 py-6 text-[length:var(--aries-font-size-small)] text-muted-foreground">
                {t("picker.loadingCharts")}
              </div>
            ) : error ? (
              <div className="px-4 py-6 text-[length:var(--aries-font-size-small)] text-destructive">
                {error}
              </div>
            ) : (
              <ContextMenu onOpenChange={(open) => { if (!open) setContextRow(null); }}>
                <ContextMenuTrigger
                  render={
                    <div
                      onContextMenu={(event) => {
                        const target = event.target as HTMLElement | null;
                        if (!target?.closest("[data-chart-picker-row-key]")) {
                          setContextRow(null);
                        }
                      }}
                    >
                      <Table
                        className={cn("border-collapse text-[13px] leading-tight", listResize.tableClassName)}
                        style={listResize.tableStyle}
                      >
                        {listResize.colGroup}
                        <TableHeader className="sticky top-0 z-10 bg-background">
                          <TableRow>
                            {COLUMN_DEFS.map((column) => (
                              <TableHead
                                key={column.key}
                                className="relative h-6 select-none whitespace-nowrap border-r border-border px-2 text-left text-[13px] font-normal"
                              >
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-left"
                                  onClick={() =>
                                    setSort((current) => ({
                                      column: column.key,
                                      ascending:
                                        current.column === column.key
                                          ? !current.ascending
                                          : column.key !== "lastOpened",
                                    }))
                                  }
                                >
                                  <span>{t(column.labelKey)}</span>
                                  {sort.column === column.key ? (
                                    sort.ascending ? (
                                      <ArrowUp className="size-3 shrink-0" />
                                    ) : (
                                      <ArrowDown className="size-3 shrink-0" />
                                    )
                                  ) : null}
                                </button>
                                <ColumnResizeHandle
                                  columnId={column.key}
                                  getResizeHandleProps={listResize.getResizeHandleProps}
                                />
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {virtualRows.topPad > 0 ? (
                            <TableRow aria-hidden="true">
                              <TableCell
                                colSpan={COLUMN_DEFS.length}
                                className="border-0 p-0"
                                style={{ height: virtualRows.topPad }}
                              />
                            </TableRow>
                          ) : null}
                          {renderedRows.map((row) => (
                            <PickerRow
                              key={row.key}
                              row={row}
                              selected={selectedKeys.has(row.key)}
                              onSelect={selectRow}
                              onOpen={() => openRows([row], false)}
                              onContext={() => ensureContextSelection(row)}
                            />
                          ))}
                          {virtualRows.bottomPad > 0 ? (
                            <TableRow aria-hidden="true">
                              <TableCell
                                colSpan={COLUMN_DEFS.length}
                                className="border-0 p-0"
                                style={{ height: virtualRows.bottomPad }}
                              />
                            </TableRow>
                          ) : null}
                          {!visibleRows.length ? (
                            <TableRow>
                              <TableCell
                                colSpan={COLUMN_DEFS.length}
                                className="h-24 text-center text-muted-foreground"
                              >
                                {t("picker.noChartsFound")}
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </TableBody>
                      </Table>
                    </div>
                  }
                />
                <ContextMenuContent className="w-48">
                  <ContextMenuItem
                    onClick={() => void renameRows(contextRows)}
                    disabled={contextRow === null || contextRows.length !== 1}
                  >
                    {t("picker.renameChartMenu")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => void deleteRows(contextRows)}
                    disabled={contextRow === null || contextRows.length === 0}
                    variant="destructive"
                  >
                    {contextRows.length > 1 ? t("picker.deleteChartsCount", { count: contextRows.length }) : t("picker.deleteChart")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )}
          </main>

          <footer className="flex shrink-0 items-center justify-end gap-3 px-5 py-3">
            {canSynastry ? (
              <Button
                variant="outline"
                className="h-8 min-w-[110px] rounded-md text-[14px] font-normal"
                onClick={() => void openSelected(true)}
              >
                {t("picker.synastry")}
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="h-8 min-w-[128px] rounded-md text-[14px] font-normal"
              onClick={() => void openSelected(false)}
              disabled={!canOpen}
            >
              {t("picker.ok")}
            </Button>
            <Button
              variant="outline"
              className="h-8 min-w-[128px] rounded-md text-[14px] font-normal"
              onClick={closeAndReset}
            >
              {t("picker.cancel")}
            </Button>
          </footer>
        </>
      ) : (
        <ChartSearchPanel
          mode={mode}
          parentRadixId={parentRadixId}
          onBack={() => setView("list")}
          onOpenRows={(targets) => openRows(targets, false)}
        />
      )}
      {renameDialog ? (
        <RenameChartDialog
          value={renameDialog.value}
          busy={mutatingRows}
          onValueChange={(value) => setRenameDialog((current) => current ? { ...current, value } : current)}
          onCancel={() => setRenameDialog(null)}
          onConfirm={() => void commitRename()}
        />
      ) : null}
      {deleteDialog ? (
        <DeleteChartsDialog
          rows={deleteDialog}
          busy={mutatingRows}
          onCancel={() => setDeleteDialog(null)}
          onConfirm={() => void commitDelete()}
        />
      ) : null}
    </div>
  );
}

function RenameChartDialog({
  value,
  busy,
  onValueChange,
  onCancel,
  onConfirm,
}: {
  value: string;
  busy: boolean;
  onValueChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--aries-overlay-scrim)] px-5">
      <form
        className="w-full max-w-[360px] rounded-md border border-border bg-background p-4 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <div className="mb-3 text-[14px] font-medium">{t("picker.renameChartTitle")}</div>
        <Input
          autoFocus
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className="h-8 text-[13px]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-8 min-w-[86px]" onClick={onCancel} disabled={busy}>
            {t("picker.cancel")}
          </Button>
          <Button type="submit" className="h-8 min-w-[86px]" disabled={busy || !value.trim()}>
            {t("picker.rename")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function DeleteChartsDialog({
  rows,
  busy,
  onCancel,
  onConfirm,
}: {
  rows: ChartPickerRow[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const title = rows.length > 1 ? t("picker.deleteChartsCount", { count: rows.length }) : t("picker.deleteChart");
  const body =
    rows.length > 1
      ? t("picker.deleteBodyMany")
      : t("picker.deleteBodyOne", { name: rows[0]?.name ?? t("picker.chartFallback") });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--aries-overlay-scrim)] px-5">
      <div className="w-full max-w-[380px] rounded-md border border-border bg-background p-4 shadow-xl">
        <div className="mb-2 text-[14px] font-medium">{title}</div>
        <p className="text-[13px] leading-5 text-muted-foreground">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-8 min-w-[86px]" onClick={onCancel} disabled={busy}>
            {t("picker.cancel")}
          </Button>
          <Button type="button" variant="destructive" className="h-8 min-w-[86px]" onClick={onConfirm} disabled={busy}>
            {t("picker.delete")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function useVirtualPickerRows(
  containerRef: React.RefObject<HTMLElement | null>,
  rowCount: number,
): {
  startIndex: number;
  endIndex: number;
  topPad: number;
  bottomPad: number;
} {
  const [viewport, setViewport] = React.useState({ scrollTop: 0, height: 0 });

  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const update = () => {
      const next = { scrollTop: node.scrollTop, height: node.clientHeight };
      React.startTransition(() => setViewport(next));
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [containerRef]);

  const startIndex = Math.max(
    0,
    Math.floor(viewport.scrollTop / PICKER_ROW_HEIGHT) - PICKER_ROW_OVERSCAN,
  );
  const visibleCount =
    Math.ceil(Math.max(0, viewport.height) / PICKER_ROW_HEIGHT) + PICKER_ROW_OVERSCAN * 2;
  const endIndex = Math.min(rowCount, startIndex + Math.max(visibleCount, PICKER_ROW_OVERSCAN));
  return {
    startIndex,
    endIndex,
    topPad: startIndex * PICKER_ROW_HEIGHT,
    bottomPad: Math.max(0, (rowCount - endIndex) * PICKER_ROW_HEIGHT),
  };
}

function PickerRow({
  row,
  selected,
  onSelect,
  onOpen,
  onContext,
}: {
  row: ChartPickerRow;
  selected: boolean;
  onSelect: (row: ChartPickerRow, event: React.MouseEvent) => void;
  onOpen: () => void;
  onContext: () => void;
}) {
  return (
    <TableRow
      aria-selected={selected}
      data-chart-picker-row-key={row.key}
      className={cn(
        "h-[24px] cursor-default select-none",
        selected && "bg-accent text-accent-foreground",
      )}
      onClick={(event) => onSelect(row, event)}
      onContextMenu={onContext}
      onDoubleClick={onOpen}
    >
      <TableCell className="px-2">{row.name}</TableCell>
      <TableCell className="whitespace-nowrap px-2 tabular-nums">{row.date}</TableCell>
      <TableCell className="whitespace-nowrap px-2 tabular-nums">{row.time}</TableCell>
      <TableCell className="whitespace-nowrap px-2">{row.type}</TableCell>
      <TableCell className="px-2">{row.place}</TableCell>
      <TableCell className="whitespace-nowrap px-2">{row.gender}</TableCell>
      <TableCell className="px-2">{row.collection}</TableCell>
      <TableCell className="whitespace-nowrap px-2 tabular-nums">{row.modified}</TableCell>
      <TableCell className="whitespace-nowrap px-2 tabular-nums">{row.lastOpened}</TableCell>
    </TableRow>
  );
}

function ChartSearchPanel({
  mode,
  parentRadixId,
  onBack,
  onOpenRows,
}: {
  mode: Mode;
  parentRadixId?: string | null;
  onBack: () => void;
  onOpenRows: (targets: ChartPickerRow[]) => Promise<void>;
}) {
  const t = useT();
  const [catalog, setCatalog] = React.useState<ChartPickerSearchCatalog | null>(null);
  const [stationWindowDays, setStationWindowDays] = React.useState("2");
  const [placements, setPlacements] = React.useState<ChartPickerPlacementClause[]>([
    emptyPlacement(),
  ]);
  const [aspects, setAspects] = React.useState<ChartPickerAspectClause[]>([
    emptyAspect(),
  ]);
  const [rows, setRows] = React.useState<ChartPickerSearchRow[]>([]);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<ChartSearchSortState | null>(null);
  const [summary, setSummary] = React.useState(() => t("picker.search"));
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [placementDrawerOpen, setPlacementDrawerOpen] = React.useState(true);
  const [aspectDrawerOpen, setAspectDrawerOpen] = React.useState(true);

  React.useEffect(() => {
    const controller = new AbortController();
    fetchChartPickerSearchCatalog(controller.signal)
      .then((payload) => {
        setCatalog(payload);
        setStationWindowDays(String(payload.defaultStationWindowDays));
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setError((err as Error).message);
      });
    return () => controller.abort();
  }, []);

  const sortedRows = React.useMemo(() => sortChartSearchRows(rows, sort), [rows, sort]);
  const selectedRow = sortedRows.find((row) => row.key === selectedKey) ?? null;
  const activePlacementCount = React.useMemo(() => activePlacements(placements).length, [placements]);
  const activeAspectCount = React.useMemo(() => activeAspects(aspects).length, [aspects]);
  const searchResize = useResizableTableColumns({
    storageKey: "chart-picker:search",
    columnIds: CHART_SEARCH_COLUMN_IDS,
  });

  const runSearch = React.useCallback(async () => {
    setSearching(true);
    setError(null);
    setSummary(t("picker.searching"));
    setRows([]);
    setSelectedKey(null);
    try {
      const result = await searchChartPickerRows({
        stationWindowDays,
        placements: activePlacements(placements),
        aspects: activeAspects(aspects),
      });
      setRows(result.rows);
      const text = t("picker.matchesSummary", {
        matched: result.summary.matched,
        scanned: result.summary.scanned,
      });
      setSummary(
        result.summary.errors
          ? `${text}${t("picker.skippedSuffix", { errors: result.summary.errors })}`
          : result.summary.truncated
            ? `${text}${t("picker.limitedSuffix")}`
            : text,
      );
    } catch (err) {
      setError((err as Error).message);
      setSummary(t("picker.searchFailed"));
    } finally {
      setSearching(false);
    }
  }, [stationWindowDays, placements, aspects, t]);

  const openingRef = React.useRef(false);
  const openResult = React.useCallback(async () => {
    if (!selectedRow || openingRef.current) return;
    openingRef.current = true;
    const target: ChartPickerRow = {
      key: selectedRow.key,
      source: selectedRow.source,
      recordIndex: selectedRow.recordIndex,
      chartId: "",
      name: selectedRow.name,
      date: selectedRow.date,
      time: selectedRow.time,
      type: selectedRow.type,
      place: selectedRow.place,
      gender: "",
      collection: selectedRow.collection,
      modified: "",
      lastOpened: "",
      recentRank: 10 ** 9,
    };
    try {
      if (mode === "synastry-partner" && parentRadixId) {
        const opened = await runBroadcastWorkspaceCommand(
          () => workspaceOpenSynastry(
            parentRadixId,
            target.name,
            target.source,
            target.recordIndex,
          ),
        );
        await activateIfNeeded(opened);
        await closePickerWindow();
        return;
      }
      await onOpenRows([target]);
    } finally {
      openingRef.current = false;
    }
  }, [mode, parentRadixId, onOpenRows, selectedRow]);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === "Enter" && selectedRow) {
        void openResult();
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openResult, selectedRow]);

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <Button variant="outline" size="sm" className="h-8 min-w-[92px]" onClick={onBack}>
          <ArrowLeft className="mr-1 size-3.5" />
          {t("picker.back")}
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-semibold leading-5">
            {t("picker.chartCollectionSearch")}
          </h1>
          <p className="truncate text-[11px] leading-4 text-[color:var(--aries-text-muted)]">
            {summary}
            {activePlacementCount || activeAspectCount
              ? t("picker.filterSummary", { placement: activePlacementCount, aspect: activeAspectCount })
              : ""}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {t("picker.stationDays")}
          <Input
            value={stationWindowDays}
            onChange={(event) => setStationWindowDays(event.target.value)}
            className="h-7 w-14 text-center text-[12px] tabular-nums"
          />
        </label>
        <Button size="sm" className="h-8 min-w-[86px]" onClick={() => void runSearch()} disabled={searching || !catalog}>
          {t("picker.search")}
        </Button>
        <Button
          size="sm"
          className="h-8 min-w-[78px]"
          onClick={() => void openResult()}
          disabled={!selectedRow}
        >
          {t("picker.open")}
        </Button>
      </header>

      <section className="grid shrink-0 gap-2 border-b border-border bg-muted/10 px-4 py-2">
        <ClauseDrawer
          title={t("picker.placements")}
          subtitle={t("picker.placementsSubtitle")}
          count={activePlacementCount}
          open={placementDrawerOpen}
          onToggle={() => setPlacementDrawerOpen((open) => !open)}
          onAdd={() => {
            setPlacementDrawerOpen(true);
            setPlacements((items) => [...items, emptyPlacement()]);
          }}
          gridClass="grid-cols-[minmax(112px,1.25fr)_minmax(92px,1fr)_52px_52px_70px_minmax(118px,1.1fr)_28px]"
          columns={[t("picker.object"), t("picker.sign"), t("picker.deg"), t("picker.orb"), t("picker.house"), t("picker.motion"), ""]}
        >
          {placements.map((placement, index) => (
            <PlacementRow
              key={index}
              value={placement}
              catalog={catalog}
              canRemove={placements.length > 1}
              onChange={(next) => setPlacements((items) => replaceAt(items, index, next))}
              onRemove={() => setPlacements((items) => removeAt(items, index))}
            />
          ))}
        </ClauseDrawer>
        <ClauseDrawer
          title={t("picker.aspects")}
          subtitle={t("picker.aspectsSubtitle")}
          count={activeAspectCount}
          open={aspectDrawerOpen}
          onToggle={() => setAspectDrawerOpen((open) => !open)}
          onAdd={() => {
            setAspectDrawerOpen(true);
            setAspects((items) => [...items, emptyAspect()]);
          }}
          gridClass="grid-cols-[minmax(126px,1.25fr)_minmax(100px,0.9fr)_minmax(126px,1.25fr)_52px_28px]"
          columns={[t("picker.bodyA"), t("picker.aspect"), t("picker.bodyB"), t("picker.orb"), ""]}
        >
          {aspects.map((aspect, index) => (
            <AspectRow
              key={index}
              value={aspect}
              catalog={catalog}
              canRemove={aspects.length > 1}
              onChange={(next) => setAspects((items) => replaceAt(items, index, next))}
              onRemove={() => setAspects((items) => removeAt(items, index))}
            />
          ))}
        </ClauseDrawer>
      </section>

      {error ? (
        <div className="border-b border-border px-4 py-2 text-[length:var(--aries-font-size-small)] text-destructive">
          {error}
        </div>
      ) : null}

      <main className="min-h-0 flex-1 overflow-auto">
        <Table
          className={cn("text-[length:var(--aries-font-size-small)]", searchResize.tableClassName)}
          style={searchResize.tableStyle}
        >
          {searchResize.colGroup}
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              {SEARCH_COLUMNS.map((column) => (
                <TableHead
                  key={column.key}
                  className="relative h-8 whitespace-nowrap px-2 text-left font-medium"
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-left"
                    onClick={() =>
                      setSort((current) => ({
                        column: column.key,
                        ascending: current?.column === column.key ? !current.ascending : true,
                      }))
                    }
                  >
                    <span>{t(column.labelKey)}</span>
                    {sort?.column === column.key ? (
                      sort.ascending ? (
                        <ArrowUp className="size-3 shrink-0" />
                      ) : (
                        <ArrowDown className="size-3 shrink-0" />
                      )
                    ) : null}
                  </button>
                  <ColumnResizeHandle
                    columnId={column.key}
                    getResizeHandleProps={searchResize.getResizeHandleProps}
                  />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => (
              <TableRow
                key={row.key}
                aria-selected={row.key === selectedKey}
                className={cn(
                  "h-8 cursor-default select-none",
                  row.key === selectedKey && "bg-accent text-accent-foreground",
                )}
                onClick={() => setSelectedKey(row.key)}
                onDoubleClick={() => void openResult()}
              >
                <TableCell className="px-2">{row.name}</TableCell>
                <TableCell className="whitespace-nowrap px-2 tabular-nums">{row.date}</TableCell>
                <TableCell className="whitespace-nowrap px-2 tabular-nums">{row.time}</TableCell>
                <TableCell className="whitespace-nowrap px-2">{row.type}</TableCell>
                <TableCell className="px-2">{row.collection}</TableCell>
                <TableCell className="px-2">{row.place}</TableCell>
                <TableCell className="px-2">
                  <ChartMatchRuns matches={row.matchRuns} fallback={row.matches} />
                </TableCell>
              </TableRow>
            ))}
            {!sortedRows.length ? (
              <TableRow>
                <TableCell
                  colSpan={SEARCH_COLUMNS.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {t("picker.noSearchResults")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </main>
    </>
  );
}

function ClauseDrawer({
  title,
  subtitle,
  count,
  open,
  onToggle,
  onAdd,
  gridClass,
  columns,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  gridClass: string;
  columns: string[];
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-border bg-background">
      <div className="flex min-h-9 items-center gap-2 px-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0">
            <span className="mr-2 text-[12px] font-semibold">{title}</span>
            <span className="text-[11px] text-muted-foreground">{subtitle}</span>
          </span>
          <span className="ml-auto rounded-sm border border-border px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {count}
          </span>
        </button>
        <Button variant="ghost" size="xs" className="h-6 px-1.5" onClick={onAdd}>
          <Plus className="size-3" />
          {t("picker.add")}
        </Button>
      </div>
      {open ? (
        <div className="border-t border-border/70 px-2 pb-2 pt-1.5">
          <div className={cn("mb-1 grid gap-1 px-1 text-[10px] uppercase tracking-wide text-muted-foreground", gridClass)}>
            {columns.map((column, index) => (
              <span key={`${column}-${index}`} className="truncate">
                {column}
              </span>
            ))}
          </div>
          <div className="grid max-h-[118px] gap-1.5 overflow-auto pr-1">{children}</div>
        </div>
      ) : null}
    </section>
  );
}

function PlacementRow({
  value,
  catalog,
  canRemove,
  onChange,
  onRemove,
}: {
  value: ChartPickerPlacementClause;
  catalog: ChartPickerSearchCatalog | null;
  canRemove: boolean;
  onChange: (value: ChartPickerPlacementClause) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-[minmax(112px,1.25fr)_minmax(92px,1fr)_52px_52px_70px_minmax(118px,1.1fr)_28px] gap-1">
      <Choice value={value.objectIds[0] ?? ""} choices={catalog?.objects} ariaLabel={t("picker.ariaPlacementObject")} onChange={(next) => onChange({ ...value, objectIds: next ? [next] : [] })} />
      <Choice value={value.signIndices[0] ?? ""} choices={catalog?.signs} ariaLabel={t("picker.ariaPlacementSign")} onChange={(next) => onChange({ ...value, signIndices: next ? [next] : [] })} />
      <Input value={value.degree} aria-label={t("picker.ariaPlacementDegree")} placeholder={t("picker.deg")} onChange={(event) => onChange({ ...value, degree: event.target.value })} className="h-7 text-center text-[12px] tabular-nums" />
      <Input value={value.degreeOrb} aria-label={t("picker.ariaPlacementOrb")} placeholder={t("picker.orb")} onChange={(event) => onChange({ ...value, degreeOrb: event.target.value })} className="h-7 text-center text-[12px] tabular-nums" />
      <Choice value={value.houseNumbers[0] ?? ""} choices={catalog?.houses} ariaLabel={t("picker.ariaPlacementHouse")} onChange={(next) => onChange({ ...value, houseNumbers: next ? [next] : [] })} />
      <Choice value={value.motion} choices={catalog?.motions} ariaLabel={t("picker.ariaPlacementMotion")} onChange={(next) => onChange({ ...value, motion: next })} />
      <Button variant="ghost" size="icon-xs" onClick={onRemove} disabled={!canRemove} aria-label={t("picker.ariaRemovePlacement")}>
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}

function AspectRow({
  value,
  catalog,
  canRemove,
  onChange,
  onRemove,
}: {
  value: ChartPickerAspectClause;
  catalog: ChartPickerSearchCatalog | null;
  canRemove: boolean;
  onChange: (value: ChartPickerAspectClause) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-[minmax(126px,1.25fr)_minmax(100px,0.9fr)_minmax(126px,1.25fr)_52px_28px] gap-1">
      <Choice value={value.objectAIds[0] ?? ""} choices={catalog?.objects} ariaLabel={t("picker.ariaAspectFirstBody")} onChange={(next) => onChange({ ...value, objectAIds: next ? [next] : [] })} />
      <Choice value={value.aspectType} choices={catalog?.aspects} ariaLabel={t("picker.ariaAspectType")} onChange={(next) => onChange({ ...value, aspectType: next })} />
      <Choice value={value.objectBIds[0] ?? ""} choices={catalog?.objects} ariaLabel={t("picker.ariaAspectSecondBody")} onChange={(next) => onChange({ ...value, objectBIds: next ? [next] : [] })} />
      <Input
        value={value.orb}
        aria-label={t("picker.ariaAspectOrb")}
        placeholder={t("picker.orb")}
        onChange={(event) => onChange({ ...value, orb: event.target.value })}
        disabled={value.aspectType === "-2"}
        className="h-7 text-center text-[12px] tabular-nums"
      />
      <Button variant="ghost" size="icon-xs" onClick={onRemove} disabled={!canRemove} aria-label={t("picker.ariaRemoveAspect")}>
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}

function Choice({
  value,
  choices = [],
  ariaLabel,
  onChange,
}: {
  value: string;
  choices?: ChartPickerChoice[];
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 min-w-0 rounded-md border border-input bg-background px-2 text-[12px]"
    >
      {(choices.length ? choices : [{ value: "", label: t("picker.any") }]).map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

function ChartMatchRuns({
  matches,
  fallback,
}: {
  matches?: ChartPickerMatchRun[][];
  fallback: string;
}) {
  if (!matches?.length) {
    return <span title={fallback}>{fallback}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" title={fallback}>
      {matches.map((match, index) => (
        <React.Fragment key={index}>
          {index > 0 ? <span className="text-muted-foreground">;</span> : null}
          <span className="inline-flex items-center gap-1">
            {match.map((run, runIndex) =>
              run.kind === "glyph" ? (
                <ChartMatchGlyph
                  key={`${runIndex}:${run.text}:${run.title ?? ""}`}
                  ch={run.text}
                  title={run.title}
                  color={run.color}
                />
              ) : (
                <span key={`${runIndex}:${run.text}`} className="shrink-0">
                  {run.text}
                </span>
              ),
            )}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

function ChartMatchGlyph({
  ch,
  title,
  color,
}: {
  ch: string;
  title?: string;
  color?: string;
}) {
  return (
    <span
      className="shrink-0 text-[15px]"
      style={{ fontFamily: "'AriesMorinus'", color: color || undefined }}
      title={title}
      aria-hidden={!title}
    >
      {ch}
    </span>
  );
}

function sortChartSearchRows(
  rows: ChartPickerSearchRow[],
  sort: ChartSearchSortState | null,
): ChartPickerSearchRow[] {
  if (!sort) return rows;
  return rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((a, b) => {
      const value = compareValues(
        chartSearchSortValue(a.row, sort.column),
        chartSearchSortValue(b.row, sort.column),
      );
      if (value !== 0) return sort.ascending ? value : -value;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ row }) => row);
}

function chartSearchSortValue(
  row: ChartPickerSearchRow,
  column: ChartSearchColumnKey,
): string | number {
  if (column === "date") return sortableDateTime(row.date, row.time);
  if (column === "time") return sortableTime(row.time);
  if (column === "matches" && typeof row.matchSortValue === "number") return row.matchSortValue;
  return row[column] ?? "";
}

function sortRows(rows: ChartPickerRow[], sort: SortState): ChartPickerRow[] {
  const sorted = [...rows];
  if (sort.column === "lastOpened") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
    sorted.sort((a, b) => {
      const aHas = Boolean(a.lastOpened);
      const bHas = Boolean(b.lastOpened);
      if (aHas !== bHas) return aHas ? -1 : 1;
      const value = compareValues(a.lastOpened, b.lastOpened);
      if (value !== 0) return sort.ascending ? value : -value;
      return a.recentRank - b.recentRank;
    });
    return sorted;
  }
  sorted.sort((a, b) => {
    const value = compareValues(a[sort.column], b[sort.column]);
    return sort.ascending ? value : -value;
  });
  return sorted;
}

function compareValues(a: unknown, b: unknown): number {
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

function emptyPlacement(): ChartPickerPlacementClause {
  return {
    objectIds: [],
    signIndices: [],
    degree: "",
    degreeOrb: "1",
    houseNumbers: [],
    motion: "",
  };
}

function emptyAspect(): ChartPickerAspectClause {
  return {
    objectAIds: [],
    aspectType: "-1",
    objectBIds: [],
    orb: "1",
  };
}

function activePlacements(items: ChartPickerPlacementClause[]): ChartPickerPlacementClause[] {
  return items.filter(
    (item) =>
      item.objectIds.length ||
      item.signIndices.length ||
      item.degree.trim() ||
      item.houseNumbers.length ||
      item.motion,
  );
}

function activeAspects(items: ChartPickerAspectClause[]): ChartPickerAspectClause[] {
  return items.filter((item) => item.aspectType && item.aspectType !== "-1");
}

function replaceAt<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? value : item));
}

function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_item, itemIndex) => itemIndex !== index);
}

async function closePickerWindow(): Promise<void> {
  try {
    await resolveShellHost().closeChartPickerWindow();
    return;
  } catch {
    // Browser preview or pre-reload Tauri builds fall through to the local API.
  }
  try {
    await resolveShellHost().closeCurrentChartPickerWindow();
  } catch {
    window.close();
  }
}
