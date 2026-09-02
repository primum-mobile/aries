// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  decodeBase64Bytes,
  exportTablePdf,
  exportTablePdfBytes,
  type GenericTableCell,
  type GenericTableColumn,
  type GenericTablePayload,
  type GenericTableRow,
  type AspectMatrixPayload,
  type StripPayload,
  type TablePdfColumn,
  type TablePdfDocument,
  type TablePdfRow,
} from "@/lib/daemon/client";
import { resolveShellHost } from "@/lib/shell-host";
import { resolvedSemanticChartColor } from "@/lib/theme/semantic-color";
import { exportFileBaseName } from "./text-export";
import {
  adHocTableToConfiguredAlignedText,
  tableToConfiguredAlignedText,
  type AdHocTableTextDocument,
} from "./table-text-export";

export type TableExportDocument = {
  title: string;
  fileStem: string;
  text: string;
  pdf: TablePdfDocument;
};

export type TableExportDialogLabels = {
  title: string;
  pdfFiles: string;
  textFiles: string;
};

const PDF_NEUTRAL_GLYPH_ROLES = new Set([
  "--morinus-peregrin",
  "--morinus-signs",
  "--morinus-text-bright",
]);

function isNeutralRgb(color: string): boolean {
  const match = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return false;
  const value = Number.parseInt(match[1], 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  return Math.max(...channels) - Math.min(...channels) <= 12;
}

/** Paper has no dark-theme neutral foreground. Preserve authored dignity,
 * body, element, and aspect colours, but print neutral/peregrine and any
 * achromatic fallback glyph in black instead of carrying a pale screen grey
 * onto white paper. */
function resolvedPdfGlyphColor(
  role: string | null | undefined,
  fallback: string | null | undefined,
): string | undefined {
  const resolved = resolvedSemanticChartColor(role, fallback);
  if (PDF_NEUTRAL_GLYPH_ROLES.has(role ?? "") || (resolved && isNeutralRgb(resolved))) {
    return "#000000";
  }
  return resolved;
}

/** Sanitize a title into a default filename stem (matches home-client's
 * exportBaseName chrome-strip + path-char scrub). */
export function tableExportBaseName(title: string): string {
  return exportFileBaseName(title, "table");
}

async function selectTablePdfPath(
  defaultStem: string,
  labels: TableExportDialogLabels,
): Promise<string | null> {
  return resolveShellHost().selectSavePath({
    title: labels.title,
    defaultPath: `${defaultStem}.pdf`,
    filters: [{ name: labels.pdfFiles, extensions: ["pdf"] }],
  });
}

export async function exportTablePdfDocument(
  document: TableExportDocument,
  labels: TableExportDialogLabels,
): Promise<boolean> {
  const host = resolveShellHost();
  if (!host.capabilities.nativeFileDialogs) {
    const result = await exportTablePdfBytes({
      filename: `${document.fileStem}.pdf`,
      title: document.title,
      document: document.pdf,
    });
    await host.downloadBytes(
      result.filename,
      decodeBase64Bytes(result.dataBase64),
      result.mimeType,
    );
    return true;
  }
  const path = await selectTablePdfPath(document.fileStem, labels);
  if (!path) return false;
  await exportTablePdf({
    path,
    title: document.title,
    document: document.pdf,
  });
  return true;
}

export async function buildTableExportDocument(
  payload: GenericTablePayload,
  rows: GenericTableRow[],
  options?: {
    fileStem?: string;
    title?: string;
    headerLines?: string[];
    columnIndexes?: number[];
  },
): Promise<TableExportDocument> {
  const title = options?.title ?? payload.title ?? "Table";
  const columnIndexes = options?.columnIndexes?.filter(
    (index) => Number.isInteger(index) && index >= 0 && index < payload.columns.length,
  );
  const exportPayload = columnIndexes?.length
    ? { ...payload, columns: columnIndexes.map((index) => payload.columns[index]) }
    : payload;
  const exportRows = columnIndexes?.length
      ? rows.map((row) => ({
        ...row,
        cells: columnIndexes.map((index) => row.cells[index] ?? { text: "" }),
      }))
    : rows;
  return {
    title,
    fileStem: options?.fileStem ?? payload.tableId ?? tableExportBaseName(title),
    text: await tableToConfiguredAlignedText(exportPayload, exportRows, {
      title,
      headerLines: options?.headerLines,
    }),
    pdf: tablePayloadPdfDocument(exportPayload, exportRows, options?.headerLines),
  };
}

export async function buildAdHocTableExportDocument(
  params: AdHocTableTextDocument & {
    fileStem: string;
    pdfProfile?: TablePdfDocument["profile"];
    pdfRows?: TablePdfRow[];
  },
): Promise<TableExportDocument> {
  return {
    title: params.title,
    fileStem: params.fileStem,
    text: await adHocTableToConfiguredAlignedText(params),
    pdf: {
      profile: params.pdfProfile ?? "standard",
      headerLines: compactHeaderLines(params.sourceName, params.headerLines),
      columns: params.columns.map(pdfColumn),
      rows: params.pdfRows ?? params.rows.map((cells) => ({ cells: resolveCellsForPdf(cells) })),
    },
  };
}

export async function writeTablePayloadPdf(
  path: string,
  payload: GenericTablePayload,
  rows: GenericTableRow[],
  options?: { title?: string; headerLines?: string[] },
): Promise<void> {
  const document = await buildTableExportDocument(payload, rows, options);
  await exportTablePdf({
    path,
    title: document.title,
    document: document.pdf,
  });
}

function compactHeaderLines(sourceName?: string, headerLines?: string[]): string[] {
  return [sourceName, ...(headerLines ?? [])]
    .map((line) => String(line ?? "").trim())
    .filter(Boolean);
}

function pdfColumn(column: GenericTableColumn | AdHocTableTextDocument["columns"][number]): TablePdfColumn {
  return {
    ...("id" in column && column.id ? { id: column.id } : {}),
    label: column.label,
    align: column.align,
    width: column.widthFactor,
    glyph: column.headerGlyph,
    color: resolvedPdfGlyphColor(column.colorRole, column.colorHex),
  };
}

function resolveCellForPdf(cell: GenericTableCell): GenericTableCell {
  const runs = cell.runs?.map((run) => ({
    ...run,
    color: resolvedPdfGlyphColor(run.colorRole, run.color),
  }));
  return {
    ...cell,
    color: resolvedPdfGlyphColor(cell.colorRole, cell.color),
    ...(runs ? { runs } : {}),
  };
}

function resolveCellsForPdf(cells: GenericTableCell[]): GenericTableCell[] {
  return cells.map(resolveCellForPdf);
}

function resolveRowForPdf(row: GenericTableRow, timeLord = false): TablePdfRow {
  const level = Number(row.meta?.level);
  const resolvedLevel = Number.isFinite(level) ? level : undefined;
  const hierarchyEmphasis = timeLord && (resolvedLevel === 1 || resolvedLevel === 3);
  return {
    cells: resolveCellsForPdf(row.cells),
    ...(row.emphasis || hierarchyEmphasis ? { emphasis: row.emphasis ?? "strong" } : {}),
    ...(row.current || row.meta?.current === true ? { current: true } : {}),
    ...(resolvedLevel != null ? { level: resolvedLevel } : {}),
    ...(timeLord && resolvedLevel === 1 ? { kind: "group" } : {}),
  };
}

function resolveMatrixForPdf(matrix: AspectMatrixPayload): AspectMatrixPayload {
  return {
    ...matrix,
    planets: matrix.planets.map((entry) => ({
      ...entry,
      color: resolvedPdfGlyphColor(entry.colorRole, entry.color),
    })),
    ascmc: matrix.ascmc.map((entry) => ({
      ...entry,
      color: resolvedPdfGlyphColor(entry.colorRole, entry.color),
    })),
    houses: matrix.houses.map((entry) => ({
      ...entry,
      color: resolvedPdfGlyphColor(entry.colorRole, entry.color),
    })),
    ...(matrix.rows ? {
      rows: matrix.rows.map((entry) => ({
        ...entry,
        color: resolvedPdfGlyphColor(entry.colorRole, entry.color),
      })),
    } : {}),
    ...(matrix.cols ? {
      cols: matrix.cols.map((entry) => ({
        ...entry,
        color: resolvedPdfGlyphColor(entry.colorRole, entry.color),
      })),
    } : {}),
    cells: Object.fromEntries(
      Object.entries(matrix.cells).map(([key, cell]) => [
        key,
        {
          ...cell,
          color: resolvedPdfGlyphColor(cell.colorRole, cell.color),
        },
      ]),
    ),
  };
}

function resolveStripForPdf(strip: StripPayload): StripPayload {
  return {
    signs: strip.signs.map((sign) => ({
      ...sign,
      bodies: sign.bodies.map((body) => ({
        ...body,
        colorHex: resolvedPdfGlyphColor(body.colorRole, body.colorHex),
      })),
    })),
  };
}

function tablePayloadPdfDocument(
  payload: GenericTablePayload,
  rows: GenericTableRow[],
  headerLines?: string[],
): TablePdfDocument {
  const document: TablePdfDocument = {
    headerLines: compactHeaderLines(payload.sourceName, headerLines),
  };
  if (payload.capabilities?.matrix === true && payload.matrix) {
    document.profile = "matrix";
    document.matrix = resolveMatrixForPdf(payload.matrix);
  } else if (payload.capabilities?.strip === true && payload.strip) {
    document.profile = "strip";
    document.strip = resolveStripForPdf(payload.strip);
  } else if (payload.capabilities?.sections === true && payload.sections?.length) {
    document.profile = payload.tableId === "almuten_chart" ? "almuten-chart" : "standard";
    document.sections = payload.sections.map((section) => ({
      title: section.title,
      columns: section.columns.map(pdfColumn),
      rows: section.rows.map((row) => resolveRowForPdf(row)),
    }));
  } else {
    const timeLord = payload.capabilities?.timeLord === true;
    document.profile = timeLord ? "time-lord" : "standard";
    document.columns = payload.columns.map(pdfColumn);
    document.rows = rows.map((row) => resolveRowForPdf(row, timeLord));
  }
  return document;
}
