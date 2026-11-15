// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { useRetainedTablePayload } from "@/lib/table/use-retained-table-payload";
import { SPECULUM_LAYER_TABLE_IDS, withSpeculumLayers } from "@/lib/table/speculum-layers";

import {
  workspaceUpdateTableBinding,
  type GenericTableCell,
  type GenericTableColumn,
  type GenericTableRow,
  type InspectorSpeculumPrecision,
} from "@/lib/daemon/client";
import { formatTableAngleText } from "@/lib/table/angle-precision";
import { LIST_ROLE_CLASSES } from "@/lib/list-tokens";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { AsteroidTableSearch } from "./asteroid-table-search";
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
import { buildTableExportDocument, tableExportBaseName } from "./table-pdf-export";
import { TablePrecisionMenu, useTablePrecision } from "./table-precision-menu";
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
  onOpenAsteroidSettings?: () => void;
};

export function GenericTableView({ documentId, parentDocumentId, tableId, onOpenAsteroidSettings }: Props) {
  const t = useT();
  const precision = useTablePrecision();
  const [sortState, setSortState] = React.useState<{ columnId: string; direction: "asc" | "desc" } | null>(null);
  const lastSessionChange = useDaemonWorkspaceStore((s) => s.lastSessionChange);
  const lastOptionsChange = useDaemonWorkspaceStore((s) =>
    tableId === "positions" || tableId === "pd_speculum" ? s.lastSpeculumOptionsChange : s.lastRetainedDataOptionsChange,
  );
  const layoutPreset = useListLayoutPreset();

  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId,
    parentDocumentId,
    lastSessionChange,
    lastOptionsChange,
  });
  const { payload: sourcePayload, error, refresh: refreshPayload } = useRetainedTablePayload(tableId, documentId, refreshSeq);
  // Speculum layer rows are a display lens: a layer toggle repaints them.
  const hiddenObjectIds = useDaemonWorkspaceStore((s) => s.retainedListDisplay.hiddenObjectIds);
  const extraPointsTitle = t("pdPositions.extraPoints");
  const payload = React.useMemo(
    () => sourcePayload && SPECULUM_LAYER_TABLE_IDS.has(tableId)
      ? withSpeculumLayers(sourcePayload, hiddenObjectIds, extraPointsTitle)
      : sourcePayload,
    [extraPointsTitle, hiddenObjectIds, sourcePayload, tableId],
  );

  const updateTableBinding = React.useCallback(
    async (binding: Record<string, unknown>) => {
      await refreshPayload(() => workspaceUpdateTableBinding(documentId, binding));
    },
    [documentId, refreshPayload],
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
    fitWidth: tableId === "user_speculum",
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
    <TablePrecisionMenu><div className="font-morinus-text flex h-full w-full min-h-0 min-w-0 flex-col bg-background">
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
        <div className="flex shrink-0 items-center gap-[var(--aries-control-gap-compact)]">
          {tableId === "asteroids" ? <AsteroidTableSearch onOpenSettings={onOpenAsteroidSettings} /> : null}
          <TextExportActions
            sourceName={payload.sourceName}
            fileStem={tableExportBaseName(payload.title)}
            buildDocument={() =>
              buildTableExportDocument(payload, sortedRows, {
                columnIndexes: flatLayout ? displayColumnOrder : undefined,
              })
            }
          />
        </div>
      </div>
      {payload.capabilities?.timeLord === true ? (
        <TimeLordTableView documentId={documentId} payload={payload} onBindingChange={updateTableBinding} />
      ) : payload.capabilities?.matrix === true && payload.matrix ? (
        <AspectMatrixView payload={payload} />
      ) : payload.capabilities?.strip === true && payload.strip ? (
        <StripView payload={payload} />
      ) : payload.capabilities?.sections === true && payload.sections?.length ? (
        <SectionedTableView payload={payload} precision={precision} speculum={SPECULUM_LAYER_TABLE_IDS.has(tableId)} onBindingChange={updateTableBinding} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-[var(--aries-pane-content-padding)]">
          <table
            className={cn(LIST_ROLE_CLASSES.standard, "border-collapse", tableId === "user_speculum" && "w-full max-w-full table-auto", flatResize.tableClassName)}
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
                        <CellView cell={cell} precision={precision} />
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
    </div></TablePrecisionMenu>
  );
}

/** Localized parenthetical suffix after the Speculum Moon name. */
export function VoidOfCourseSuffix({ visible = true }: { visible?: boolean }) {
  const t = useT();
  const title = t("voc.title");
  return (
    <span
      className={cn("text-[color:var(--aries-text-muted)]", !visible && "invisible")}
      title={visible ? title : undefined}
      aria-label={visible ? title : undefined}
      aria-hidden={!visible}
    >
      {"\u00a0("}{t("voc.marker")}{")"}
    </span>
  );
}

export function CellView({
  cell,
  preserveAngleSeconds = false,
  precision,
}: {
  cell?: GenericTableCell;
  preserveAngleSeconds?: boolean;
  precision?: InspectorSpeculumPrecision;
}) {
  if (!cell) return null;
  const angleText = precision
    ? (text: string) => formatTableAngleText(text, precision, cell.angleTime === true)
    : preserveAngleSeconds ? (text: string) => text : compactListAngleText;
  const shortened = precision && precision !== "seconds" && (
    (cell.text && cell.text !== angleText(cell.text)) ||
    cell.runs?.some((run) => !run.glyph && run.text !== angleText(run.text))
  );
  const title = shortened ? tableCellText(cell, { preserveAngleSeconds: true }) : undefined;
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
      <span style={channelStyle} title={title}>
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
            {run.glyph ? run.text : angleText(run.text)}
          </span>
        ))}
      </span>
    );
  }
  if (cell.glyph) {
    return (
      <span style={channelStyle} title={title}>
        <span style={{ fontFamily: "'AriesMorinus'" }}>{cell.glyph}</span>
        {cell.text ? <span>{angleText(cell.text)}</span> : cell.voidOfCourse ? <span>{" "}{cell.exportText}</span> : null}
        {cell.voidOfCourse ? <VoidOfCourseSuffix /> : null}
      </span>
    );
  }
  if (channelStyle || cell.dir || title) {
    return <span dir={cell.dir} style={channelStyle} title={title}>{angleText(cell.text ?? "")}</span>;
  }
  return <>{angleText(cell.text ?? "")}</>;
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
