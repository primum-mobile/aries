// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  GenericTableCell,
  GenericTableColumn,
  GenericTablePayload,
  GenericTableRow,
} from "@/lib/daemon/client";
import { fetchOptions } from "@/lib/daemon/client";

const DMS_SECONDS_RE = /(\d{1,3}\s*°\s*\d{1,2}\s*(?:['′]|’))\s*\d{1,2}\s*(?:"|″)/g;

export function compactListAngleText(text: string): string {
  return text.replace(DMS_SECONDS_RE, "$1");
}

export type TableTextExportOptions = {
  useAspectSymbols?: boolean;
};

export type TableAlignedTextOptions = TableTextExportOptions & {
  title?: string;
  columns?: GenericTableColumn[];
  headerLines?: string[];
};

export async function loadTableTextExportOptions(): Promise<TableTextExportOptions> {
  try {
    const options = await fetchOptions();
    return { useAspectSymbols: options.export.listExportAspectSymbols };
  } catch {
    return { useAspectSymbols: false };
  }
}

export async function tableToConfiguredTsv(
  payload: GenericTablePayload,
  rows: GenericTableRow[],
) {
  return tableToTsv(payload, rows, await loadTableTextExportOptions());
}

export async function tableToConfiguredAlignedText(
  payload: GenericTablePayload,
  rows: GenericTableRow[],
  options?: Omit<TableAlignedTextOptions, "useAspectSymbols">,
) {
  const preference = await loadTableTextExportOptions();
  return tableToAlignedText(payload, rows, { ...options, ...preference });
}

export function tableToTsv(
  payload: GenericTablePayload,
  rows: GenericTableRow[],
  options?: TableTextExportOptions,
) {
  const header = payload.columns
    .map((column) => tableColumnExportLabel(column, options))
    .join("\t");
  const body = rows.map((row) =>
    row.cells.map((cell) => tableCellText(cell, options)).join("\t")
  );
  return [header, ...body].join("\n");
}

export function tableToAlignedText(
  payload: GenericTablePayload,
  rows: GenericTableRow[],
  options?: TableAlignedTextOptions,
) {
  const columns = options?.columns ?? payload.columns;
  const labels = columns.map((column) => tableColumnExportLabel(column, options));
  const widths = columns.map((column, index) => {
    const cells = rows.map((row) => tableCellText(row.cells[index], options));
    return Math.max(displayLength(labels[index] ?? ""), ...cells.map(displayLength));
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
  lines.push(formatAlignedRow(labels, columns, widths));
  if (!rows.length) {
    lines.push("  (no rows)");
  } else {
    lines.push(
      ...rows.map((row) =>
        formatAlignedRow(
          columns.map((_, index) => tableCellText(row.cells[index], options)),
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

export function tableCellText(
  cell?: GenericTableCell,
  options?: TableTextExportOptions,
): string {
  if (!cell) return "";
  if (options?.useAspectSymbols && cell.exportSymbolText != null) {
    return compactListAngleText(cell.exportSymbolText);
  }
  if (cell.exportText != null) return compactListAngleText(cell.exportText);
  if (cell.text) return compactListAngleText(cell.text);
  if (cell.runs?.length) {
    return compactListAngleText(
      cell.runs
        .map((run) =>
          options?.useAspectSymbols
            ? run.exportSymbolText ?? run.exportText ?? run.text
            : run.exportText ?? run.text
        )
        .filter(Boolean)
        .join(" "),
    );
  }
  return compactListAngleText(cell.glyph ?? "");
}

function tableColumnExportLabel(
  column: GenericTableColumn,
  options?: TableTextExportOptions,
): string {
  if (options?.useAspectSymbols && column.exportSymbolLabel) {
    return column.exportSymbolLabel;
  }
  return column.exportLabel ?? column.label;
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
