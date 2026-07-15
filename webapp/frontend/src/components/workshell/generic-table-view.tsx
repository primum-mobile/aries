// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Copy, Download, FileText } from "lucide-react";

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
import { exportTablePayloadPdf } from "./table-pdf-export";
import { exportTextContent } from "./text-export";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";

type Props = {
  documentId: string;
  parentDocumentId?: string | null;
  tableId: string;
};

const DMS_SECONDS_RE = /(\d{1,3}\s*°\s*\d{1,2}\s*(?:['′]|’))\s*\d{1,2}\s*(?:"|″)/g;

function compactListAngleText(text: string): string {
  return text.replace(DMS_SECONDS_RE, "$1");
}

export function GenericTableView({ documentId, parentDocumentId, tableId }: Props) {
  const t = useT();
  const [payload, setPayload] = React.useState<GenericTablePayload | null>(() =>
    getCachedGenericTablePayload(tableId, documentId),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [sortState, setSortState] = React.useState<{ columnId: string; direction: "asc" | "desc" } | null>(null);
  const requestSeqRef = React.useRef(0);
  const lastSessionChange = useDaemonWorkspaceStore((s) => s.lastSessionChange);
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastOptionsChange);
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
      <div className="font-morinus-text flex h-full min-h-0 items-center justify-center bg-background p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
        {error}
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="font-morinus-text flex h-full min-h-0 items-center justify-center bg-background p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
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
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--aries-border-subtle)] bg-[color:var(--aries-surface)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
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
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)]"
            onClick={() => copyRows(payload, sortedRows)}
          >
            <Copy className="size-3.5" />
            {t("table.copy")}
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)]"
            onClick={() =>
              void exportTextContent({
                filename: payload.tableId,
                extension: "tsv",
                mimeType: "text/tab-separated-values;charset=utf-8",
                text: tableToTsv(payload, sortedRows),
                title: t("table.exportTsvTitle"),
                filters: [{ name: t("table.tsvFiles"), extensions: ["tsv"] }],
              }).catch(() => {})
            }
          >
            <Download className="size-3.5" />
            TSV
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)]"
            onClick={() =>
              void exportTextContent({
                filename: payload.tableId,
                extension: "txt",
                text: tableToAlignedText(payload, sortedRows),
                title: t("table.exportTextTitle"),
                filters: [{ name: t("table.textFiles"), extensions: ["txt"] }],
              }).catch(() => {})
            }
          >
            <FileText className="size-3.5" />
            TXT
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)]"
            onClick={() =>
              void exportTextContent({
                filename: payload.tableId,
                extension: "json",
                mimeType: "application/json;charset=utf-8",
                text: JSON.stringify(payload, null, 2),
                title: t("table.exportJsonTitle"),
                filters: [{ name: t("table.jsonFiles"), extensions: ["json"] }],
              }).catch(() => {})
            }
          >
            <Download className="size-3.5" />
            JSON
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)]"
            onClick={() => void exportTablePayloadPdf(payload, sortedRows).catch(() => {})}
          >
            <Download className="size-3.5" />
            PDF
          </button>
        </div>
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
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <table
            className={cn(LIST_ROLE_CLASSES.standard, "border-collapse", flatResize.tableClassName)}
            style={flatResize.tableStyle}
          >
            {flatResize.colGroup}
            <thead className="sticky top-0 z-10 bg-[color:var(--aries-surface)]">
              <tr>
                {displayColumnOrder.map((columnIndex) => {
                  const column = payload.columns[columnIndex];
                  return (
                    <th
                      key={column.id}
                      className={cn(
                        "aries-list-head-cell relative border p-0 font-medium",
                        alignClass(column.align),
                      )}
                    >
                      {sortingEnabled ? (
                        <button
                          type="button"
                          className={cn(
                            "inline-flex items-center gap-1 px-[var(--aries-list-cell-x)] py-[var(--aries-list-cell-y)]",
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
                          "inline-flex items-center gap-1 px-[var(--aries-list-cell-x)] py-[var(--aries-list-cell-y)]",
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
                    "aries-list-row aries-list-row--striped",
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
                          "aries-list-cell border align-middle",
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
  const channelStyle: React.CSSProperties | undefined =
    cell.color || cell.emphasis === "strong" || cell.fontRole === "arabic"
      ? {
          color: cell.color,
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
              run.glyph || run.color
                ? {
                    // Run-level color: wx multi-planet cells color each glyph
                    // independently (midpointswnd.py:202-228).
                    fontFamily: run.glyph ? "'AriesMorinus'" : undefined,
                    color: run.color,
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

function copyRows(payload: GenericTablePayload, rows: GenericTableRow[]) {
  const text = tableToTsv(payload, rows);
  void navigator.clipboard?.writeText(text).catch(() => {
    downloadText(`${payload.tableId}.tsv`, text, "text/tab-separated-values");
  });
}

export function tableToTsv(payload: GenericTablePayload, rows: GenericTableRow[]) {
  const header = payload.columns.map((column) => column.label).join("\t");
  const body = rows.map((row) => row.cells.map(cellText).join("\t"));
  return [header, ...body].join("\n");
}

export function tableToAlignedText(
  payload: GenericTablePayload,
  rows: GenericTableRow[],
  options?: {
    title?: string;
    columns?: GenericTableColumn[];
    headerLines?: string[];
  },
) {
  const columns = options?.columns ?? payload.columns;
  const widths = columns.map((column, index) => {
    const cells = rows.map((row) => cellText(row.cells[index]));
    return Math.max(displayLength(column.label), ...cells.map(displayLength));
  });
  const lines: string[] = [];
  const title = options?.title ?? payload.title;
  if (title) lines.push(title);
  if (payload.sourceName && !title.includes(payload.sourceName)) lines.push(`  ${payload.sourceName}`);
  if (options?.headerLines?.length) {
    lines.push(...options.headerLines.map((line) => `  ${line}`));
  }
  if (lines.length) lines.push("");
  if (!columns.length) {
    lines.push("  (no columns)");
    return lines.join("\n");
  }
  lines.push(formatAlignedRow(columns.map((column) => column.label), columns, widths));
  if (!rows.length) {
    lines.push("  (no rows)");
  } else {
    lines.push(
      ...rows.map((row) =>
        formatAlignedRow(
          columns.map((_, index) => cellText(row.cells[index])),
          columns,
          widths,
        ),
      ),
    );
  }
  if (payload.notes?.length) {
    lines.push("", ...payload.notes.map((note) => `... ${note}`));
  }
  if (payload.deferrals?.length) {
    lines.push("", ...payload.deferrals.map((note) => `... ${note}`));
  }
  return lines.join("\n");
}

function cellText(cell?: GenericTableCell): string {
  if (!cell) return "";
  if (cell.runs?.length) return compactListAngleText(cell.runs.map((run) => run.text).join(""));
  return compactListAngleText(`${cell.glyph ?? ""}${cell.text ?? ""}`);
}

function cellSortValue(cell?: GenericTableCell): string | number {
  if (!cell) return "";
  if (typeof cell.sortValue === "number" || typeof cell.sortValue === "string") {
    return cell.sortValue;
  }
  return cellText(cell);
}

function compareSortValues(left: string | number, right: string | number): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function formatAlignedRow(values: string[], columns: GenericTableColumn[], widths: number[]) {
  return `  ${values.map((value, index) => alignText(value, widths[index] ?? 0, columns[index]?.align)).join("   ")}`;
}

function alignText(value: string, width: number, align?: string) {
  const padding = Math.max(0, width - displayLength(value));
  if (align === "right") return `${" ".repeat(padding)}${value}`;
  if (align === "center") {
    const left = Math.floor(padding / 2);
    return `${" ".repeat(left)}${value}${" ".repeat(padding - left)}`;
  }
  return `${value}${" ".repeat(padding)}`;
}

function displayLength(value: string) {
  return Array.from(value).length;
}

export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
