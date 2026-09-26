// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import {
  cancelTransitSearch,
  followTransitSearchProgress,
  startTransitMonthExport,
  type GenericTableCell,
  type GenericTableCellRun,
  type TransitMonthExportRequest,
  type TransitSearchRow,
  type TransitSearchResult,
  type TransitSearchProgressResult,
} from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import { LIST_PANE_CLASSES } from "@/lib/list-tokens";
import { buildAdHocTableExportDocument } from "./table-pdf-export";
import { TextExportActions } from "./text-export-actions";

export type TransitExportCoverage = {
  from: string;
  to: string;
  timeDisplay: TransitSearchResult["timeDisplay"];
};

export function transitExportCoverage(payload: TransitSearchProgressResult): TransitExportCoverage | undefined {
  const from = payload.cursor?.displayCoverageFrom;
  const to = payload.cursor?.displayCoverageTo;
  if (!from || !to || payload.truncated || payload.error || payload.cancelled) return;
  return { from, to, timeDisplay: payload.timeDisplay };
}

export function mergeTransitExportCoverage(a?: TransitExportCoverage, b?: TransitExportCoverage): TransitExportCoverage | undefined {
  if (!a || !b || a.to < b.from || b.to < a.from) return;
  return {
    from: a.from < b.from ? a.from : b.from,
    to: a.to > b.to ? a.to : b.to,
    timeDisplay: { ...a.timeDisplay, offsetsMinutes: [...new Set([
      ...a.timeDisplay.offsetsMinutes, ...b.timeDisplay.offsetsMinutes,
    ])].sort((x, y) => x - y) },
  };
}

/** Slice only daemon-certified full civil coverage. Partial/stale buffers
 * use the month job; the scrolling viewport never defines export scope. */
export function bufferedTransitMonth(request: TransitMonthExportRequest, rows: TransitSearchRow[], coverage?: TransitExportCoverage): TransitSearchResult | undefined {
  if (!coverage) return;
  const prefix = `${String(request.year).padStart(4, "0")}-${String(request.month).padStart(2, "0")}-`;
  const nextYear = request.month === 12 ? request.year + 1 : request.year;
  const nextMonth = request.month === 12 ? 1 : request.month + 1;
  const end = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01T00:00:00`;
  // A multi-offset buffer may span a DST change outside the requested month.
  // Ask the daemon for month-specific clock metadata in that case.
  if (coverage.from > `${prefix}01T00:00:00` || coverage.to < end || coverage.timeDisplay.offsetsMinutes.length !== 1) return;
  return { rows: rows.filter((row) => row.displayDatetime.startsWith(prefix)),
    timeDisplay: coverage.timeDisplay, truncated: false, summary: "" };
}

/** Preserve the same identity/markers as the list, with semantic text for TXT. */
function objectCell(row: TransitSearchRow, role: "promittor" | "significator"): GenericTableCell {
  const display = role === "promittor" ? row.promDisplay : row.sigDisplay;
  const label = row[`${role}Label`];
  const glyph = row[`${role}Glyph`];
  const marker = row[`${role}Marker`];
  const segments = row[`${role}Segments`];
  const suffix = label.match(/\s\(([^)]+)\)$/)?.[1] ?? "";
  const state = suffix || display.motion_marker || "";
  const color = display.glyph_color_css ?? undefined;
  const colorRole = display.glyph_color_role;
  const runs: GenericTableCellRun[] = segments.length
    ? segments.map((segment) => ({
      text: segment.text,
      glyph: segment.kind === "planet" || segment.kind === "glyph",
      color, colorRole,
    }))
    : [{
      text: glyph || (suffix ? label.replace(/\s\([^)]+\)$/, "") : label),
      glyph: Boolean(glyph) && row[`${role}GlyphFont`] !== "text",
      color, colorRole,
    }];
  if (marker) runs.push({ text: ` ${marker}` });
  if (state) runs.push({ text: ` ${state}` });
  return { exportText: [label, !suffix ? state : ""].filter(Boolean).join(" "), runs };
}

export function transitExportCells(row: TransitSearchRow): GenericTableCell[] {
  return [
    objectCell(row, "promittor"),
    {
      text: row.aspectGlyph ? undefined : row.aspectLabel,
      glyph: row.aspectGlyph || undefined,
      exportText: row.aspectLabel,
      exportSymbolText: String(row.metadata.aspect_export_symbol_text ?? row.aspectLabel),
      color: typeof row.metadata.aspect_color === "string" ? row.metadata.aspect_color : undefined,
      colorRole: typeof row.metadata.aspect_color_role === "string" ? row.metadata.aspect_color_role : undefined,
    },
    objectCell(row, "significator"),
    { text: row.displayDate },
    { text: row.displayTime },
    { text: row.technique === "converse_transits" ? "C" : "D" },
  ];
}

export function TransitListExport({ request, monthLabel, sourceName, disabled, bufferedRows, coverage }: {
  request: TransitMonthExportRequest;
  monthLabel: string;
  sourceName?: string;
  disabled: boolean;
  bufferedRows?: TransitSearchRow[];
  coverage?: TransitExportCoverage;
}) {
  const t = useT();
  const [error, setError] = React.useState(false);
  const controllerRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => controllerRef.current?.abort(), [request.documentId]);

  const buildDocument = React.useCallback(async () => {
    setError(false);
    const controller = new AbortController();
    controllerRef.current = controller;
    // Receive the job id even if the pane closes during startup, then cancel it.
    const buffered = bufferedTransitMonth(request, bufferedRows ?? [], coverage);
    const initial = buffered ? null : await startTransitMonthExport(request);
    const cancel = () => { if (initial) void cancelTransitSearch(initial.sessionId).catch(() => undefined); };
    controller.signal.addEventListener("abort", cancel, { once: true });
    try {
      if (controller.signal.aborted) {
        cancel();
        throw new DOMException("Aborted", "AbortError");
      }
      let result = buffered;
      if (!result) {
        const completed = await followTransitSearchProgress(initial!, controller.signal, () => undefined);
        if (completed.error || completed.cancelled || completed.truncated || !completed.complete) {
          throw new Error(completed.error || t("textExport.failed"));
        }
        result = completed;
      }
      const zone = result.timeDisplay.zoneId;
      const offsets = result.timeDisplay.offsetsMinutes.map((minutes) => {
        const absolute = Math.abs(minutes);
        return `UTC${minutes < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
      }).join(" / ");
      const document = await buildAdHocTableExportDocument({
        title: `${t("sidebar.action.transits")} · ${monthLabel}`,
        fileStem: `transits-${request.year}-${String(request.month).padStart(2, "0")}`,
        sourceName,
        pdfProfile: "directions",
        headerLines: [
          [zone, offsets].filter(Boolean).join(" · "),
          `${t("tlview.directionDirect")} (D) · ${t("tlview.directionConverse")} (C)`,
        ],
        columns: [
          { label: t("search.from"), align: "left", widthFactor: 2.5 },
          { label: t("search.aspects"), align: "center" },
          { label: t("search.to"), align: "left", widthFactor: 2.5 },
          { label: t("search.date"), align: "center", widthFactor: 1.5 },
          { label: t("search.time"), align: "center", widthFactor: 1.5 },
          { label: t("tlview.direction"), align: "center" },
        ],
        rows: result.rows.length ? result.rows.map(transitExportCells)
          : [[{ text: t("tlview.noTransits") }, {}, {}, {}, {}, {}]],
      });
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      return document;
    } finally {
      controller.signal.removeEventListener("abort", cancel);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [bufferedRows, coverage, monthLabel, request, sourceName, t]);

  return <>
    <TextExportActions
      buildDocument={buildDocument}
      fileStem={`transits-${request.year}-${String(request.month).padStart(2, "0")}`}
      sourceName={sourceName}
      disabled={disabled}
      scopeLabel={monthLabel}
      onError={(failure) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError")) setError(true);
      }}
    />
    {error ? <span role="alert" className={LIST_PANE_CLASSES.error}>{t("textExport.failed")}</span> : null}
  </>;
}
