// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import {
  fetchGenericTablePayload,
  workspaceUpdateTableBinding,
  type GenericTableCell,
  type GenericTableColumn,
  type GenericTablePayload,
  type GenericTableRow,
} from "@/lib/daemon/client";
import { isAbortError } from "@/lib/abort-error";
import { LIST_ROLE_CLASSES } from "@/lib/list-tokens";
import {
  getCachedGenericTablePayload,
  rememberGenericTablePayload,
} from "@/lib/table/payload-cache";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { TimeLordTableView } from "./time-lord-table-view";
import { AspectMatrixView } from "./aspect-matrix-view";
import { SectionedTableView } from "./sectioned-table-view";
import { StripView } from "./strip-view";
import {
  hasListDateTimeColumns,
  isListDateColumn,
  ListLayoutPresetControl,
  listColumnDisplayOrder,
  useListLayoutPreset,
} from "./list-column-layout";
import { useSettledWorkspaceRefreshSeq } from "./step-refresh";
import { buildTableExportDocument } from "./table-pdf-export";
import { TextExportActions } from "./text-export-actions";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";
import {
  compactListAngleText,
  tableCellText,
} from "./table-text-export";

export {
  tableToConfiguredAlignedText,
  tableToAlignedText,
} from "./table-text-export";

type Props = {
  documentId: string;
  parentDocumentId?: string | null;
  tableId: string;
};

export function GenericTableView({ documentId, parentDocumentId, tableId }: Props) {
  const t = useT();
  const [payload, setPayload] = React.useState<GenericTablePayload | null>(() =>
    getCachedGenericTablePayload(tableId, documentId),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [sortState, setSortState] = React.useState<{ columnId: string; direction: "asc" | "desc" } | null>(null);
  const requestSeqRef = React.useRef(0);
  const lastSessionChange = useDaemonWorkspaceStore((s) => s.lastSessionChange);
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastRetainedDataOptionsChange);
  const layoutPreset = useListLayoutPreset();

  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId,
    parentDocumentId,
    lastSessionChange,
    lastOptionsChange,
  });
  React.useEffect(() => {
    const controller = new AbortController();
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    fetchGenericTablePayload(tableId, documentId, controller.signal)
      .then((nextPayload) => {
        if (requestSeq !== requestSeqRef.current) return;
        rememberGenericTablePayload(tableId, documentId, nextPayload);
        setPayload(nextPayload);
        setError(null);
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        if (requestSeq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [documentId, tableId, refreshSeq]);

  const updateTableBinding = React.useCallback(
    async (binding: Record<string, unknown>) => {
      await workspaceUpdateTableBinding(documentId, binding);
      const nextPayload = await fetchGenericTablePayload(tableId, documentId);
      rememberGenericTablePayload(tableId, documentId, nextPayload);
      setPayload(nextPayload);
      setError(null);
    },
    [documentId, tableId],
  );

  const displayColumnOrder = React.useMemo(
    () => (payload ? listColumnDisplayOrder(payload.columns, layoutPreset) : []),
    [layoutPreset, payload],
  );
  const flatColumnIds = React.useMemo(
    () => (payload ? displayColumnOrder.map((columnIndex) => payload.columns[columnIndex].id) : []),
    [displayColumnOrder, payload],
  );
  const flatResize = useResizableTableColumns({
    storageKey: `generic:${tableId}`,
    columnIds: flatColumnIds,
  });

  if (error && !payload) {
    return (
      <div className="font-morinus-text flex h-full min-h-0 items-center justify-center bg-background p-[var(--aries-pane-state-padding)] text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
        {error}
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="font-morinus-text flex h-full min-h-0 items-center justify-center bg-background p-[var(--aries-pane-state-padding)] text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
        {t("table.loadingTable")}
      </div>
    );
  }

  const sortingEnabled = payload.capabilities?.sorting !== false;
  const sortedRows = sortingEnabled ? sortRows(payload.rows, payload.columns, sortState) : payload.rows;
  const flatLayout =
    payload.capabilities?.timeLord !== true &&
    payload.capabilities?.matrix !== true &&
    payload.capabilities?.strip !== true &&
    !(payload.capabilities?.sections === true && payload.sections?.length);
  const showLayoutControl = flatLayout && hasListDateTimeColumns(payload.columns);
  return (
    <div className="font-morinus-text flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-[var(--aries-pane-control-gap-y)] border-b border-[color:var(--aries-border-subtle)] bg-background px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-padding-y)]">
        <div className="flex min-w-0 items-center gap-[var(--aries-pane-control-gap-y)]">
          {showLayoutControl ? <ListLayoutPresetControl /> : null}
          {error ? (
            <span
              className="truncate text-[length:var(--aries-font-size-small)] text-destructive"
              title={error}
            >
              {t("table.refreshFailed")}
            </span>
          ) : null}
        </div>
        <TextExportActions
          buildDocument={() =>
            buildTableExportDocument(payload, sortedRows, {
              columnIndexes: flatLayout ? displayColumnOrder : undefined,
            })
          }
        />
      </div>
      {payload.capabilities?.timeLord === true ? (
        <TimeLordTableView documentId={documentId} payload={payload} onBindingChange={updateTableBinding} />
      ) : payload.capabilities?.matrix === true && payload.matrix ? (
        <AspectMatrixView payload={payload} />
      ) : payload.capabilities?.strip === true && payload.strip ? (
        <StripView payload={payload} />
      ) : payload.capabilities?.sections === true && payload.sections?.length ? (
        <SectionedTableView payload={payload} onBindingChange={updateTableBinding} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-[var(--aries-pane-content-padding)]">
          <table
            className={cn(LIST_ROLE_CLASSES.standard, "border-collapse", flatResize.tableClassName)}
            style={flatResize.tableStyle}
          >
            {flatResize.colGroup}
            <thead className="sticky top-0 z-10 bg-background">
              <tr>
                {displayColumnOrder.map((columnIndex) => {
                  const column = payload.columns[columnIndex];
                  return (
                    <th
                      key={column.id}
                      className={cn(
                        "aries-list-head-cell relative border-b p-0 font-medium",
                        alignClass(column.align),
                      )}
                      style={{
                        color: semanticChartColor(column.colorRole, column.colorHex),
                        fontFamily: column.headerGlyph ? "'AriesMorinus'" : undefined,
                      }}
                    >
                      {sortingEnabled ? (
                        <button
                          type="button"
                          className={cn(
                            "inline-flex items-center gap-[var(--aries-control-gap-compact)] px-[var(--aries-list-cell-x)] py-[var(--aries-list-cell-y)]",
                            alignFlexClass(column.align),
                          )}
                          onClick={() => setSortState(nextSortState(sortState, column.id))}
                        >
                          <span>{column.label}</span>
                          {sortState?.columnId === column.id ? (
                            <span className="text-[color:var(--aries-text-muted)]">
                              {sortState.direction === "asc" ? "▲" : "▼"}
                            </span>
                          ) : null}
                        </button>
                      ) : (
                        <span
                          className={cn(
                          "inline-flex items-center gap-[var(--aries-control-gap-compact)] px-[var(--aries-list-cell-x)] py-[var(--aries-list-cell-y)]",
                          alignFlexClass(column.align),
                        )}
                        >
                        {column.label}
                      </span>
                    )}
                    <ColumnResizeHandle
                      columnId={column.id}
                      getResizeHandleProps={flatResize.getResizeHandleProps}
                    />
                  </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "aries-list-row border-b border-x-0 border-t-0",
                    row.current && "aries-list-row--current",
                    row.emphasis === "strong" && "font-semibold",
                  )}
                >
                  {displayColumnOrder.map((columnIndex) => {
                    const column = payload.columns[columnIndex];
                    const cell = row.cells[columnIndex];
                    return (
                      <td
                        key={`${row.id}:${column.id}`}
                        className={cn(
                          "aries-list-cell align-middle",
                          alignClass(cell?.align ?? column.align),
                          isListDateColumn(column) && "font-medium",
                          payload.unavailable && "text-[color:var(--aries-text-muted)]",
                        )}
                      >
                        <CellView cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {payload.notes?.length ? (
            <div className="mt-3 space-y-1 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]">
              {payload.notes.map((note, index) => (
                <div key={`${index}:${note}`}>{note}</div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function CellView({ cell }: { cell?: GenericTableCell }) {
  if (!cell) return null;
  // Cross-cutting channels every daemon builder can use: per-planet color
  // identity (wx useplanetcolors/dignity palette) and bold emphasis.
  const color = semanticChartColor(cell.colorRole, cell.color);
  const channelStyle: React.CSSProperties | undefined =
    color || cell.emphasis === "strong" || cell.fontRole === "arabic"
      ? {
          color,
          fontWeight: cell.emphasis === "strong" ? 600 : undefined,
          fontFamily: cell.fontRole === "arabic" ? "'AriesArabicAcademic'" : undefined,
        }
      : undefined;
  if (cell.runs?.length) {
    return (
      <span style={channelStyle}>
        {cell.runs.map((run, index) => (
          <span
            key={`${index}:${run.text}`}
            style={
              run.glyph || run.color || run.colorRole
                ? {
                    // Run-level color: wx multi-planet cells color each glyph
                    // independently (midpointswnd.py:202-228).
                    fontFamily: run.glyph ? "'AriesMorinus'" : undefined,
                    color: semanticChartColor(run.colorRole, run.color),
                  }
                : undefined
            }
          >
            {compactListAngleText(run.text)}
          </span>
        ))}
      </span>
    );
  }
  if (cell.glyph) {
    return (
      <span style={channelStyle}>
        <span style={{ fontFamily: "'AriesMorinus'" }}>{cell.glyph}</span>
        {cell.text ? <span>{compactListAngleText(cell.text)}</span> : null}
      </span>
    );
  }
  if (channelStyle || cell.dir) {
    return <span dir={cell.dir} style={channelStyle}>{compactListAngleText(cell.text ?? "")}</span>;
  }
  return <>{compactListAngleText(cell.text ?? "")}</>;
}

function nextSortState(
  state: { columnId: string; direction: "asc" | "desc" } | null,
  columnId: string,
) {
  if (state?.columnId !== columnId) return { columnId, direction: "asc" as const };
  if (state.direction === "asc") return { columnId, direction: "desc" as const };
  return null;
}

function sortRows(
  rows: GenericTableRow[],
  columns: GenericTableColumn[],
  state: { columnId: string; direction: "asc" | "desc" } | null,
) {
  if (!state) return rows;
  const index = columns.findIndex((column) => column.id === state.columnId);
  if (index < 0) return rows;
  return rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((a, b) => {
      const left = cellSortValue(a.row.cells[index]);
      const right = cellSortValue(b.row.cells[index]);
      const cmp = compareSortValues(left, right);
      if (cmp !== 0) return state.direction === "asc" ? cmp : -cmp;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ row }) => row);
}

function cellSortValue(cell?: GenericTableCell): string | number {
  if (!cell) return "";
  if (typeof cell.sortValue === "number" || typeof cell.sortValue === "string") {
    return cell.sortValue;
  }
  return tableCellText(cell);
}

function compareSortValues(left: string | number, right: string | number): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function alignClass(align?: string) {
  if (align === "center") return "text-center";
  if (align === "right") return "text-right";
  return "text-left";
}

function alignFlexClass(align?: string) {
  if (align === "center") return "justify-center";
  if (align === "right") return "justify-end";
  return "justify-start";
}
