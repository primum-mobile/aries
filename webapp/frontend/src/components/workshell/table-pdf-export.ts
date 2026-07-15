// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  decodeBase64Bytes,
  exportTablePdf,
  exportTablePdfBytes,
  type GenericTableCell,
  type GenericTablePayload,
  type GenericTableRow,
} from "@/lib/daemon/client";
import { resolveShellHost } from "@/lib/shell-host";
import { exportFileBaseName } from "./text-export";

/** Sanitize a title into a default filename stem (matches home-client's
 * exportBaseName chrome-strip + path-char scrub). */
export function pdfExportBaseName(title: string): string {
  return exportFileBaseName(title, "table");
}

/** Open the native Save dialog (Tauri dialog:allow-save — the same flow the
 * chart export uses) defaulted to a .pdf next to the export, returning the chosen
 * path or null when cancelled. */
async function selectTablePdfPath(defaultStem: string): Promise<string | null> {
  return resolveShellHost().selectSavePath({
    title: "Export PDF...",
    defaultPath: `${defaultStem}.pdf`,
    filters: [{ name: "PDF Files", extensions: ["pdf"] }],
  });
}

/** Render the supplied table payload (the rows the view is showing) to a PDF via
 * the daemon. `rows` is passed explicitly so views can export the sorted /
 * filtered view exactly as displayed. Returns false when the user cancels. */
export async function exportTablePayloadPdf(
  payload: GenericTablePayload,
  rows: GenericTableRow[],
  options?: { fileStem?: string; title?: string; headerLines?: string[] },
): Promise<boolean> {
  const title = options?.title ?? payload.title ?? "Table";
  const stem = options?.fileStem ?? payload.tableId ?? pdfExportBaseName(title);
  const columns = payload.columns.map((column) => ({
    label: column.label,
    align: column.align,
    width: column.widthFactor,
    glyph: column.headerGlyph,
  }));
  const exportRows = rows.map((row) => row.cells);
  const host = resolveShellHost();
  if (!host.capabilities.nativeFileDialogs) {
    const result = await exportTablePdfBytes({
      filename: `${stem}.pdf`,
      title,
      columns,
      rows: exportRows,
      headerLines: options?.headerLines,
    });
    await host.downloadBytes(
      result.filename,
      decodeBase64Bytes(result.dataBase64),
      result.mimeType,
    );
    return true;
  }
  const path = await selectTablePdfPath(stem);
  if (!path) return false;
  await writeTablePayloadPdf(path, payload, rows, options);
  return true;
}

export async function writeTablePayloadPdf(
  path: string,
  payload: GenericTablePayload,
  rows: GenericTableRow[],
  options?: { title?: string; headerLines?: string[] },
): Promise<void> {
  const title = options?.title ?? payload.title ?? "Table";
  const columns = payload.columns.map((column) => ({
    label: column.label,
    align: column.align,
    width: column.widthFactor,
    glyph: column.headerGlyph,
  }));
  const exportRows = rows.map((row) => row.cells);
  await exportTablePdf({
    path,
    title,
    columns,
    rows: exportRows,
    headerLines: options?.headerLines,
  });
}

/** Export an ad-hoc column/row table that is not a GenericTablePayload (e.g. the
 * directions lists, which the daemon builds as its own row shape). */
export async function exportAdHocTablePdf(params: {
  title: string;
  fileStem: string;
  columns: { label: string; align?: string; width?: number; glyph?: boolean }[];
  rows: GenericTableCell[][];
  headerLines?: string[];
}): Promise<boolean> {
  const host = resolveShellHost();
  if (!host.capabilities.nativeFileDialogs) {
    const result = await exportTablePdfBytes({
      filename: `${params.fileStem}.pdf`,
      title: params.title,
      columns: params.columns,
      rows: params.rows,
      headerLines: params.headerLines,
    });
    await host.downloadBytes(
      result.filename,
      decodeBase64Bytes(result.dataBase64),
      result.mimeType,
    );
    return true;
  }
  const path = await selectTablePdfPath(params.fileStem);
  if (!path) return false;
  await exportTablePdf({
    path,
    title: params.title,
    columns: params.columns,
    rows: params.rows,
    headerLines: params.headerLines,
  });
  return true;
}
