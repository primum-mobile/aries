// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Copy, Download, X } from "lucide-react";

import {
  fetchGenericTablePayload,
  workspaceUpdateTableBinding,
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

import { TimedChartContextMenu } from "./directions-view";
import { downloadText, tableToTsv } from "./generic-table-view";
import { exportTablePayloadPdf } from "./table-pdf-export";
import { exportTextContent } from "./text-export";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";
import { useSettledWorkspaceRefreshSeq } from "./step-refresh";

// ---------------------------------------------------------------------------
// Decennials — the webapp surface for the wx IN-FRAME variant
// (decennialswnd.DecWnd hosted by morin._workspace_table_decennials,
// morin.py:17161-17179, wrapped by decennialsframe.DecennialsFrame:6-26; the
// legacy popup twin decennials_popup.DecennialsPopup is out of scope). The
// daemon owns ALL computation (decennials.py via tables_service._decennials):
// the L1/L2 main rows (build_main, 2 cycles), the Valens L3/L4 redistribution
// (build_children_combo_valens), date/length formatting (fmt_date with the
// year-zero strip, fmt_length), glyph colours (clrindividual / dignity,
// decennialswnd.py:452-463), the "Start: <glyph|text>" info row model
// (decennialswnd.py:348-413) and current-period metadata from the ACTIVE chart
// session cursor. This view renders that payload and forwards raw intents:
//   - Start selector -> table-binding POST (the wx context-menu radio submenu
//     DecWnd._on_select_start_selector + per-radix persistence,
//     decennialswnd.py:22-31,100-106 / morin.py:16014-16015,17179)
//   - L2 row click (or L1 click -> its first L2, DecWnd._l2_row_for_l1,
//     decennialswnd.py:214-277) -> inline L3+L4 drill panel (the wx
//     DecPopupFrame combo popup, build_children_combo_valens). The drill
//     selection is presentation-only state: wx never persisted it
//     (get_state stores only start_token + scroll, decennialswnd.py:108-114).
//   - row right-click -> the shared Timed-chart actions (commonwnd.py:63-85
//     via decennialswnd.py:18-20,63-77,198-213)
// ---------------------------------------------------------------------------

type DecennialsHeader = {
  startLabel?: string;
  startToken?: string;
  startIsPlanet?: boolean;
  startGlyph?: string;
  startText?: string;
  startColorHex?: string | null;
};

type BindingOption = { value: string | number | boolean; label?: string; glyph?: string };

type Props = {
  documentId: string;
  parentDocumentId?: string | null;
  sourceName?: string;
  /** Set when hosted as the right pane; renders the close button. */
  onClose?: () => void;
};

const TABLE_ID = "decennials";

export function DecennialsView({ documentId, parentDocumentId, sourceName, onClose }: Props) {
  const t = useT();
  const [payload, setPayload] = React.useState<GenericTablePayload | null>(() =>
    getCachedGenericTablePayload(TABLE_ID, documentId),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  // Drill selection (the open DecPopupFrame in wx) — presentation-only, keyed
  // by the L2 row id. wx does not persist it across rebuilds either.
  const [drilledRowId, setDrilledRowId] = React.useState<string | null>(null);
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastOptionsChange);

  // Refresh on relevant options only. Table controls below fetch explicitly;
  // chart/session activation must not invalidate the source list.
  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId,
    parentDocumentId,
    lastSessionChange: null,
    lastOptionsChange,
  });

  React.useEffect(() => {
    const controller = new AbortController();
    fetchGenericTablePayload(TABLE_ID, documentId, controller.signal)
      .then((next) => {
        rememberGenericTablePayload(TABLE_ID, documentId, next);
        setPayload(next);
        setError(null);
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [documentId, refreshSeq]);

  const capabilities = (payload?.capabilities ?? {}) as Record<string, unknown>;
  const bindings = asRecord(capabilities.bindings);
  const bindingOptions = asRecord(capabilities.bindingOptions);
  const header = (asRecord(capabilities.decennials) as DecennialsHeader) ?? {};
  const startToken = String(bindings.start_token ?? "sect");
  const tableColumnIds = React.useMemo(
    () => payload?.columns.map((column) => column.id) ?? ["ruler", "start", "age", "length"],
    [payload?.columns],
  );
  const tableResize = useResizableTableColumns({ storageKey: TABLE_ID, columnIds: tableColumnIds });

  // Start-selector change — DecWnd._on_select_start_selector
  // (decennialswnd.py:100-106): rebuild with the new token and persist the
  // per-radix binding (morin.store_table_binding_for_radix, morin.py:17179).
  // wx rebuilds the table and the open drill popups go stale; here the drill
  // panel simply closes (compute_and_draw resets rows).
  const updateBinding = React.useCallback(
    async (next: Record<string, unknown>) => {
      setPending(true);
      try {
        await workspaceUpdateTableBinding(documentId, { start_token: startToken, ...next }, TABLE_ID);
        const refreshed = await fetchGenericTablePayload(TABLE_ID, documentId);
        rememberGenericTablePayload(TABLE_ID, documentId, refreshed);
        setPayload(refreshed);
        setDrilledRowId(null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [documentId, startToken],
  );

  const mainRows = React.useMemo(
    () => (payload?.rows ?? []).filter((row) => asNumber(row.meta?.level, 0) <= 2),
    [payload],
  );
  const drillRows = React.useMemo(
    () =>
      drilledRowId
        ? (payload?.rows ?? []).filter((row) => row.id.startsWith(`${drilledRowId}:l3`))
        : [],
    [payload, drilledRowId],
  );
  const drilledL2 = React.useMemo(
    () => (drilledRowId ? mainRows.find((row) => row.id === drilledRowId) ?? null : null),
    [mainRows, drilledRowId],
  );

  // L1 click drills the same-start L2 (the wx _l2_row_for_l1 model,
  // decennialswnd.py:214-277: the first L2 of the L1 block shares its start).
  const toggleDrill = React.useCallback(
    (row: GenericTableRow) => {
      const level = asNumber(row.meta?.level, 2);
      let targetId = row.id;
      if (level === 1) {
        targetId = `${row.id}:l2:0`;
      }
      setDrilledRowId((current) => (current === targetId ? null : targetId));
    },
    [],
  );

  // Scroll the current period into view when the payload (re)loads — prefer
  // the current L2 row.
  const currentMainId = React.useMemo(() => {
    const current = mainRows.filter((row) => Boolean(row.current || row.meta?.current));
    return current.length > 0 ? current[current.length - 1].id : null;
  }, [mainRows]);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const scrolledForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!currentMainId || !listRef.current) return;
    if (scrolledForRef.current === documentId) return;
    const el = listRef.current.querySelector(`[data-dec-row="${CSS.escape(currentMainId)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      scrolledForRef.current = documentId;
    }
  }, [currentMainId, documentId]);

  if (error && !payload) {
    return (
      <PaneShell sourceName={sourceName} onClose={onClose}>
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {error}
        </div>
      </PaneShell>
    );
  }
  if (!payload) {
    return (
      <PaneShell sourceName={sourceName} onClose={onClose}>
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {t("decview.loading")}
        </div>
      </PaneShell>
    );
  }
  // BC charts: the daemon returns the unavailable payload
  // (morin.py:17165-17169 gate).
  if (payload.unavailable) {
    return (
      <PaneShell sourceName={sourceName} onClose={onClose}>
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {payload.notes?.[0] ?? t("decview.unavailable")}
        </div>
      </PaneShell>
    );
  }

  const startOptions = asOptions(bindingOptions.startToken);

  return (
    <PaneShell
      sourceName={sourceName}
      onClose={onClose}
      toolbar={
        <>
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-1.5 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)]"
            onClick={() => {
              const text = tableToTsv(payload, payload.rows);
              void navigator.clipboard?.writeText(text).catch(() => {
                downloadText("decennials.tsv", text, "text/tab-separated-values");
              });
            }}
            title={t("decview.copyRows")}
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-1.5 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)]"
            onClick={() =>
              void exportTextContent({
                filename: "decennials",
                extension: "tsv",
                mimeType: "text/tab-separated-values;charset=utf-8",
                text: tableToTsv(payload, payload.rows),
                title: t("decview.exportTsvTitle"),
                filters: [{ name: t("decview.tsvFiles"), extensions: ["tsv"] }],
              }).catch(() => {})
            }
            title={t("decview.exportTsv")}
          >
            <Download className="size-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-1.5 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)]"
            onClick={() =>
              void exportTablePayloadPdf(payload, payload.rows, {
                fileStem: "decennials",
                title: payload.title ?? t("decview.decennials"),
              }).catch(() => {})
            }
            title={t("decview.exportPdf")}
          >
            <Download className="size-3.5" />
            PDF
          </button>
        </>
      }
    >
      {/* Start selector — the wx context-menu radio submenu
          (DecWnd._start_selector_labels, decennialswnd.py:22-31,82-94). */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[color:var(--aries-border-subtle)] bg-background px-3 py-2">
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="dec-pane-start">
          {header.startLabel ?? t("decview.start")}
        </label>
        <select
          id="dec-pane-start"
          className="h-7 rounded border border-[color:var(--aries-border-subtle)] bg-background px-2 text-[length:var(--aries-font-size-small)]"
          value={startToken}
          disabled={pending}
          onChange={(event) => void updateBinding({ start_token: event.target.value })}
        >
          {startOptions.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </select>
        {/* Info value — "Start: <glyph|text>", glyph in Morinus font with the
            wx colour rule (DecWnd._drawDC [A], decennialswnd.py:348-413). */}
        {header.startIsPlanet ? (
          <span style={{ fontFamily: "'AriesMorinus'", color: header.startColorHex ?? undefined }}>
            {header.startGlyph ?? ""}
          </span>
        ) : (
          <span className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)]">
            {header.startText ?? ""}
          </span>
        )}
      </div>

      {/* Main table: interleaved L1 + L2 (decennials.build_main, 2 cycles;
          DecWnd.compute_and_draw, decennialswnd.py:177-181). Click a row to
          open the L3+L4 drill (the wx DecPopupFrame combo popup). */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
        <table
          className={cn(LIST_ROLE_CLASSES.symbolic, "border-collapse", tableResize.tableClassName)}
          style={tableResize.tableStyle}
        >
          {tableResize.colGroup}
          <DecHeaderRow
            columns={payload.columns.map((c) => c.label)}
            columnIds={tableColumnIds}
            tableResize={tableResize}
          />
          <tbody>
            {mainRows.map((row) => (
              <DecRow
                key={row.id}
                row={row}
                documentId={documentId}
                selected={row.id === drilledRowId}
                onClick={() => toggleDrill(row)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Inline drill panel: L3 + L4 of the selected L2, Valens redistribution
          (build_children_combo_valens, decennials.py:186-197; popup window
          decennialswnd.py:813-961 "Decennials L3+L4"). */}
      {drilledL2 ? (
        <div className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t border-[color:var(--aries-border-subtle)]">
          <div className="flex shrink-0 items-center gap-1.5 bg-background px-3 py-1.5 text-[length:var(--aries-font-size-small)]">
            <span className="text-[color:var(--aries-text-muted)]">L2:</span>
            <span
              style={{
                fontFamily: "'AriesMorinus'",
                color: typeof drilledL2.meta?.colorHex === "string" ? drilledL2.meta.colorHex : undefined,
              }}
            >
              {drilledL2.cells[0]?.glyph ?? ""}
            </span>
            <span>{drilledL2.cells[1]?.text ?? ""}</span>
            <span className="text-[color:var(--aries-text-muted)]">{drilledL2.cells[3]?.text ?? ""}</span>
            <button
              type="button"
              className="ml-auto inline-flex size-5 items-center justify-center rounded hover:bg-accent/40"
              onClick={() => setDrilledRowId(null)}
              aria-label={t("decview.closeDrill")}
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table
              className={cn(LIST_ROLE_CLASSES.symbolic, "border-collapse", tableResize.tableClassName)}
              style={tableResize.tableStyle}
            >
              {tableResize.colGroup}
              <tbody>
                {drillRows.map((row) => (
                  <DecRow key={row.id} row={row} documentId={documentId} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </PaneShell>
  );
}

function PaneShell({
  sourceName,
  onClose,
  toolbar,
  children,
}: {
  sourceName?: string;
  onClose?: () => void;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="font-morinus-text flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--aries-border-subtle)] bg-background px-3 py-2">
        <div className="min-w-0 truncate text-[length:var(--aries-font-size-small)] font-medium text-[color:var(--aries-text-primary)]">
          {t("decview.decennials")}
          {sourceName ? (
            <span className="ml-1 font-normal text-[color:var(--aries-text-muted)]">{sourceName}</span>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {toolbar}
          {onClose ? (
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded hover:bg-accent/40"
              onClick={onClose}
              aria-label={t("decview.closeDecennials")}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

// Compact list table: planet glyph | start | age | length. Level is row structure.
function DecHeaderRow({
  columns,
  columnIds,
  tableResize,
}: {
  columns: string[];
  columnIds: readonly string[];
  tableResize: ReturnType<typeof useResizableTableColumns>;
}) {
  const t = useT();
  return (
    <thead className="sticky top-0 z-10 bg-background text-[color:var(--aries-text-muted)]">
      <tr>
        <th className="aries-list-head-cell relative border-b font-medium text-center">
          {columns[0] ?? t("decview.ruler")}
          <ColumnResizeHandle columnId={columnIds[0] ?? "ruler"} getResizeHandleProps={tableResize.getResizeHandleProps} />
        </th>
        <th className="aries-list-head-cell relative border-b font-medium text-center">
          {columns[1] ?? t("decview.start")}
          <ColumnResizeHandle columnId={columnIds[1] ?? "start"} getResizeHandleProps={tableResize.getResizeHandleProps} />
        </th>
        <th className="aries-list-head-cell relative border-b font-medium text-right">
          {columns[2] ?? t("decview.age")}
          <ColumnResizeHandle columnId={columnIds[2] ?? "age"} getResizeHandleProps={tableResize.getResizeHandleProps} />
        </th>
        <th className="aries-list-head-cell relative border-b font-medium text-right">
          {columns[3] ?? t("decview.length")}
          <ColumnResizeHandle columnId={columnIds[3] ?? "length"} getResizeHandleProps={tableResize.getResizeHandleProps} />
        </th>
      </tr>
    </thead>
  );
}

function DecRow({
  row,
  documentId,
  selected,
  onClick,
}: {
  row: GenericTableRow;
  documentId: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const meta = row.meta ?? {};
  const level = asNumber(meta.level, 2);
  // L1 bold in the main table, L3 bold in the drill (DecWnd._drawDC isL1,
  // decennialswnd.py:465-466; _DecPopupWnd isBold, decennialswnd.py:1016-1017).
  const isBold = level === 1 || level === 3;
  const colorHex = typeof meta.colorHex === "string" ? meta.colorHex : undefined;
  const eventDate = typeof meta.eventDate === "string" ? meta.eventDate : null;

  return (
    <TimedChartContextMenu documentId={documentId} eventDatetime={eventDate}>
      <tr
        data-dec-row={row.id}
        data-state={selected ? "selected" : undefined}
        className={cn(
          "aries-list-row aries-list-row--flagged border-b border-x-0 border-t-0",
          isBold && "font-semibold",
          selected && "aries-list-row--selected",
          onClick && "aries-list-row--hover cursor-pointer",
        )}
        onClick={onClick}
      >
        {/* Ruler glyph — Morinus font, wx colour from the daemon
            (clrindividual / dignity, decennialswnd.py:452-463). */}
        <td
          className="aries-list-cell whitespace-nowrap text-center"
          style={{
            fontFamily: "'AriesMorinus'",
            color: colorHex,
            paddingLeft: `${Math.max(0, level - (level >= 3 ? 3 : 1)) * 6}px`,
          }}
        >
          {row.cells[0]?.glyph ?? ""}
        </td>
        {/* Start date (fmt_date + year-zero strip, daemon-built). */}
        <td className="aries-list-cell whitespace-nowrap text-center">{row.cells[1]?.text ?? ""}</td>
        {/* Age at period start. */}
        <td className="aries-list-cell whitespace-nowrap text-right">{row.cells[2]?.text ?? ""}</td>
        {/* Length (fmt_length: Years / Months / Days per level). */}
        <td className="aries-list-cell whitespace-nowrap text-right">{row.cells[3]?.text ?? ""}</td>
      </tr>
    </TimedChartContextMenu>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asOptions(value: unknown): BindingOption[] {
  return (Array.isArray(value) ? value : []).filter(
    (item): item is BindingOption => item !== null && typeof item === "object" && "value" in item,
  );
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
