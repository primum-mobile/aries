// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  GenericTableCell,
  GenericTableColumn,
  GenericTablePayload,
  GenericTableRow,
} from "@/lib/daemon/client";
import { fetchOptions } from "@/lib/daemon/client";
import type {
  TableExportDialogLabels,
  TableExportDocument,
} from "./table-pdf-export";
import { exportTextContent } from "./text-export";

const DMS_SECONDS_RE = /(\d{1,3}\s*°\s*\d{1,2}\s*(?:['′]|’))\s*\d{1,2}\s*(?:"|″)/g;

export function compactListAngleText(text: string): string {
  return text.replace(DMS_SECONDS_RE, "$1");
}

export type TableTextExportOptions = {
  useAstrologicalGlyphs?: boolean;
};

export type TableAlignedTextOptions = TableTextExportOptions & {
  title?: string;
  columns?: GenericTableColumn[];
  headerLines?: string[];
};

export type AdHocTableTextDocument = {
  title: string;
  sourceName?: string;
  columns: Array<
    Pick<GenericTableColumn, "label" | "align"> &
      Partial<
        Pick<
          GenericTableColumn,
          | "exportLabel"
          | "exportSymbolLabel"
          | "headerGlyph"
          | "widthFactor"
          | "colorHex"
          | "colorRole"
        >
      >
  >;
  rows: GenericTableCell[][];
  headerLines?: string[];
  notes?: string[];
};

export async function loadTableTextExportOptions(): Promise<TableTextExportOptions> {
  try {
    const options = await fetchOptions();
    return { useAstrologicalGlyphs: options.export.listExportAspectSymbols };
  } catch {
    return { useAstrologicalGlyphs: false };
  }
}

export async function tableToConfiguredAlignedText(
  payload: GenericTablePayload,
  rows: GenericTableRow[],
  options?: Omit<TableAlignedTextOptions, "useAstrologicalGlyphs">,
) {
  const preference = await loadTableTextExportOptions();
  return tableToAlignedText(payload, rows, { ...options, ...preference });
}

export async function adHocTableToConfiguredAlignedText(
  document: AdHocTableTextDocument,
): Promise<string> {
  const payload: GenericTablePayload = {
    tableId: "text-export",
    title: document.title,
    sourceName: document.sourceName ?? "",
    columns: document.columns.map((column, index) => ({
      id: `column-${index}`,
      ...column,
    })),
    rows: document.rows.map((cells, index) => ({ id: `row-${index}`, cells })),
    notes: document.notes,
  };
  return tableToConfiguredAlignedText(payload, payload.rows, {
    title: document.title,
    headerLines: document.headerLines,
  });
}

/** Save the label-safe, tab-delimited representation. This is intentionally
 * independent from the structured PDF renderer. */
export async function exportTableTextDocument(
  document: TableExportDocument,
  labels: TableExportDialogLabels,
): Promise<boolean> {
  return exportTextContent({
    filename: document.fileStem,
    text: document.text,
    extension: "txt",
    mimeType: "text/plain;charset=utf-8",
    title: labels.title,
    filters: [{ name: labels.textFiles, extensions: ["txt"] }],
  });
}

export function tableToAlignedText(
  payload: GenericTablePayload,
  rows: GenericTableRow[],
  options?: TableAlignedTextOptions,
) {
  const columns = options?.columns ?? payload.columns;
  const lines: string[] = [];
  const title = options?.title ?? payload.title;
  if (title) lines.push(title);
  if (payload.sourceName && !title.includes(payload.sourceName)) lines.push(payload.sourceName);
  if (options?.headerLines?.length) {
    lines.push(...options.headerLines);
  }
  if (lines.length) lines.push("");

  if (!options?.columns && payload.capabilities?.sections === true && payload.sections?.length) {
    payload.sections.forEach((section, index) => {
      if (index > 0) lines.push("");
      if (section.title) lines.push(section.title);
      lines.push(...alignedTableLines(section.columns, section.rows, options));
    });
  } else {
    lines.push(...alignedTableLines(columns, rows, options));
  }
  return lines.join("\n");
}

function alignedTableLines(
  columns: GenericTableColumn[],
  rows: GenericTableRow[],
  options?: TableAlignedTextOptions,
): string[] {
  if (!columns.length) return ["  (no columns)"];
  const labels = columns.map((column) => tableColumnExportLabel(column, options));
  const valueRows = rows.map((row) =>
    columns.map((_, index) => tableCellText(row.cells[index], options)),
  );
  const tableRows = labels.some(Boolean) ? [labels, ...valueRows] : valueRows;
  const lines = formatTabularRows(tableRows, columns);
  return rows.length ? lines : [...lines, "  (no rows)"];
}

export function tableCellText(
  cell?: GenericTableCell,
  options?: TableTextExportOptions,
): string {
  if (!cell) return "";
  if (options?.useAstrologicalGlyphs && cell.exportSymbolText != null) {
    return compactListAngleText(cell.exportSymbolText);
  }
  if (cell.exportText != null) return compactListAngleText(cell.exportText);
  if (cell.text) return compactListAngleText(cell.text);
  if (cell.runs?.length) {
    return compactListAngleText(
      cell.runs
        .map((run) =>
          options?.useAstrologicalGlyphs
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
  if (options?.useAstrologicalGlyphs && column.exportSymbolLabel) {
    return column.exportSymbolLabel;
  }
  return column.exportLabel ?? column.label;
}

function formatTabularRows(values: string[][], columns: GenericTableColumn[]): string[] {
  const sanitizedRows = values.map((row) => row.map(sanitizeTextField));
  const widths = columns.map((_, columnIndex) =>
    sanitizedRows.reduce(
      (width, row) => Math.max(width, monospaceTextWidth(row[columnIndex] ?? "")),
      0,
    ),
  );
  return sanitizedRows.map((row) => formatTabRow(row, columns, widths));
}

function formatTabRow(
  values: string[],
  columns: GenericTableColumn[],
  widths: number[],
) {
  return values
    .map((value, index) =>
      padMonospaceField(
        value,
        widths[index] ?? 0,
        columns[index]?.align,
        index === values.length - 1,
      ),
    )
    .join("\t");
}

function padMonospaceField(
  value: string,
  width: number,
  align: GenericTableColumn["align"],
  isLast: boolean,
): string {
  const padding = Math.max(0, width - monospaceTextWidth(value));
  if (align === "right") return `${" ".repeat(padding)}${value}`;
  if (align === "center") {
    const before = Math.floor(padding / 2);
    return `${" ".repeat(before)}${value}${isLast ? "" : " ".repeat(padding - before)}`;
  }
  return `${value}${isLast ? "" : " ".repeat(padding)}`;
}

/** Approximate terminal/editor cell width without introducing another runtime
 * dependency. This keeps localized CJK labels and common symbols aligned in
 * the same plain-text table as Latin labels. */
function monospaceTextWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      /\p{Mark}/u.test(character) ||
      codePoint === 0x200d ||
      (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
      (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
    ) {
      continue;
    }
    width += isWideTextCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

function isWideTextCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function sanitizeTextField(value: string) {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}
