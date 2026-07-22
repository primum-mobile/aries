// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Copy, Download } from "lucide-react";

import {
  fetchGenericTablePayload,
  patchOptions,
  workspaceUpdateTableBinding,
  type GenericTablePayload,
  type GenericTableRow,
} from "@/lib/daemon/client";
import { isAbortError } from "@/lib/abort-error";
import {
  getCachedGenericTablePayload,
  rememberGenericTablePayload,
} from "@/lib/table/payload-cache";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useT } from "@/lib/i18n/i18n";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { cn } from "@/lib/utils";

import { TimedChartContextMenu } from "./directions-view";
import { CellView, downloadText, tableToTsv } from "./generic-table-view";
import { exportTablePayloadPdf } from "./table-pdf-export";
import { exportTextContent } from "./text-export";
import { useSettledWorkspaceRefreshSeq } from "./step-refresh";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";
import { RetainedPaneShell } from "./retained-pane-shell";
import {
  PANE_CONTROL_CLASSES,
  PaneControlBar,
  PaneSelect,
  PaneToolbarButton,
} from "./list-controls";

// ---------------------------------------------------------------------------
// Profections TABLE — the webapp surface for the wx IN-FRAME variant
// (profectionswnd.ProfectionsWnd hosted by morin._workspace_table_profections,
// morin.py:16991-17010; rows from morin._build_profections_table_rows,
// morin.py:17012-17033). The monthly drill it opens on left-click
// (ProfectionsWnd.onMonthly, profectionswnd.py:337-346 ->
// profectionsmonwnd.ProfectionsMonWnd) is in scope and renders here as inline
// tree children of each annual row. The daemon owns ALL computation
// (profections.py / munprofections.py / profectionsmonthly.py /
// profectiontable.py via tables_service._profections_table): the 12 annual
// charts, the monthly dates, the column model with widths/header colours,
// hour-lord chaldean walk + colours, lon cells with ayanamsha rebase, and the
// NOW flags from the ACTIVE chart session cursor. This view renders that
// payload and forwards raw intents:
//   - Zodiacal/Placidian radio + UseZodProjs check (the wx Profections
//     context submenu, profectionswnd.py:48-60,146-169,256-281) ->
//     patchOptions({profections:{...}}) — the same persistent
//     options.saveProfections write wx performed.
//   - Display Main/All + Monthly 12/13 steps (profectionswnd.py:52-59,283-301)
//     -> per-radix table-binding POST (mainsigs / monthly_steps12).
//   - annual-row expand (the wx onMonthly drill) -> shows the daemon-built
//     monthly child rows.
//   - row right-click -> the shared Timed-chart actions (commonwnd.py:63-85
//     via profectionswnd.py:62-65,303-334).
// ---------------------------------------------------------------------------

type ProfectionsHeader = {
  zodprof?: boolean;
  useZodProjs?: boolean;
  zodLabel?: string;
  munLabel?: string;
  useZodProjsLabel?: string;
  displayLabel?: string;
  monthlyLabel?: string;
  modeLabel?: string;
};

type BindingOption = { value: string | number | boolean; label?: string };

type Props = {
  documentId: string;
  parentDocumentId?: string | null;
  sourceName?: string;
  /** Set when hosted as the right pane; renders the close button. */
  onClose?: () => void;
};

const TABLE_ID = "profections_table";

export function ProfectionsView({ documentId, parentDocumentId, sourceName, onClose }: Props) {
  const t = useT();
  const [payload, setPayload] = React.useState<GenericTablePayload | null>(() =>
    getCachedGenericTablePayload(TABLE_ID, documentId),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
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
  const header = (asRecord(capabilities.profections) as ProfectionsHeader) ?? {};
  const mainsigs = Boolean(bindings.mainsigs ?? true);
  const monthlySteps12 = Boolean(bindings.monthly_steps12 ?? true);
  const ageOffset = asNumber(bindings.age_offset, 0);

  // Expansion = the wx monthly drill (onMonthly opened one floating monthly
  // window per clicked year row). Reset when the payload identity changes
  // (binding/options rebuild), seeded with the daemon's current-month row.
  const payloadKey = React.useMemo(
    () =>
      JSON.stringify({
        bindings: capabilities.bindings ?? null,
        doc: documentId,
        rows: payload?.rows.length ?? 0,
      }),
    [capabilities.bindings, documentId, payload],
  );
  const initialIds = React.useMemo(
    () =>
      new Set(
        (Array.isArray(capabilities.initialExpandedRowIds) ? capabilities.initialExpandedRowIds : []).filter(
          (id): id is string => typeof id === "string",
        ),
      ),
    [capabilities.initialExpandedRowIds],
  );
  const [expandedState, setExpandedState] = React.useState<{ key: string; ids: Set<string> }>(() => ({
    key: payloadKey,
    ids: initialIds,
  }));
  const expanded = expandedState.key === payloadKey ? expandedState.ids : initialIds;
  const toggleExpanded = React.useCallback(
    (rowId: string) => {
      setExpandedState(() => {
        const ids = new Set(expanded);
        if (ids.has(rowId)) ids.delete(rowId);
        else ids.add(rowId);
        return { key: payloadKey, ids };
      });
    },
    [expanded, payloadKey],
  );

  // Display / Monthly-steps binding change — per-radix table_bindings, the wx
  // per-window mainsigs/monthly_steps12 state (profectionswnd.py:283-301).
  const updateBinding = React.useCallback(
    async (next: Record<string, unknown>) => {
      setPending(true);
      try {
        await workspaceUpdateTableBinding(
          documentId,
          { mainsigs, monthly_steps12: monthlySteps12, age_offset: ageOffset, ...next },
          TABLE_ID,
        );
        const refreshed = await fetchGenericTablePayload(TABLE_ID, documentId);
        rememberGenericTablePayload(TABLE_ID, documentId, refreshed);
        setPayload(refreshed);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [documentId, mainsigs, monthlySteps12, ageOffset],
  );

  // Zodiacal/Mundane + UseZodProjs — PERSISTENT options through the canonical
  // options path (ProfectionsWnd._apply_profections_options wrote
  // options.zodprof/usezodprojsprof + saveProfections, profectionswnd.py:256-281).
  const updateProfectionsOptions = React.useCallback(
    async (fields: { zodiacal?: boolean; useZodProjs?: boolean }) => {
      setPending(true);
      try {
        await patchOptions({ profections: fields });
        const refreshed = await fetchGenericTablePayload(TABLE_ID, documentId);
        rememberGenericTablePayload(TABLE_ID, documentId, refreshed);
        setPayload(refreshed);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [documentId],
  );

  const visibleRows = React.useMemo(() => {
    const rows = payload?.rows ?? [];
    return rows.filter((row) => {
      const parentId = typeof row.meta?.parentId === "string" ? row.meta.parentId : null;
      return parentId === null || expanded.has(parentId);
    });
  }, [payload, expanded]);

  // Scroll the current annual row into view on first load (sibling-pane
  // behaviour; wx restored a saved scroll offset instead).
  const currentAnnualId = React.useMemo(() => {
    const current = (payload?.rows ?? []).filter(
      (row) => asNumber(row.meta?.level, 1) === 1 && Boolean(row.current || row.meta?.current),
    );
    return current.length > 0 ? current[0].id : null;
  }, [payload]);
  const tableColumnIds = React.useMemo(
    () => payload?.columns.map((column) => column.id) ?? [],
    [payload],
  );
  const tableResize = useResizableTableColumns({
    storageKey: TABLE_ID,
    columnIds: tableColumnIds,
  });
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const scrolledForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!currentAnnualId || !listRef.current) return;
    if (scrolledForRef.current === documentId) return;
    const el = listRef.current.querySelector(`[data-prof-row="${CSS.escape(currentAnnualId)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      scrolledForRef.current = documentId;
    }
  }, [currentAnnualId, documentId]);

  if (error && !payload) {
    return (
      <RetainedPaneShell
        title={t("profview.profections")}
        sourceName={sourceName}
        closeLabel={t("profview.closeProfections")}
        onClose={onClose}
        headerSurface="surface"
      >
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {error}
        </div>
      </RetainedPaneShell>
    );
  }
  if (!payload) {
    return (
      <RetainedPaneShell
        title={t("profview.profections")}
        sourceName={sourceName}
        closeLabel={t("profview.closeProfections")}
        onClose={onClose}
        headerSurface="surface"
      >
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {t("profview.loadingProfections")}
        </div>
      </RetainedPaneShell>
    );
  }
  // BC charts: the daemon returns the unavailable payload (morin.py:16993-16997).
  if (payload.unavailable) {
    return (
      <RetainedPaneShell
        title={t("profview.profections")}
        sourceName={sourceName}
        closeLabel={t("profview.closeProfections")}
        onClose={onClose}
        headerSurface="surface"
      >
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {payload.notes?.[0] ?? t("profview.unavailable")}
        </div>
      </RetainedPaneShell>
    );
  }

  const displayOptions = asOptions(bindingOptions.mainsigs);
  const monthlyOptions = asOptions(bindingOptions.monthlySteps);
  const zodprof = Boolean(header.zodprof ?? true);

  return (
    <RetainedPaneShell
      title={t("profview.profections")}
      sourceName={sourceName}
      closeLabel={t("profview.closeProfections")}
      onClose={onClose}
      headerSurface="surface"
      toolbar={
        <>
          <PaneToolbarButton
            type="button"
            onClick={() => {
              const text = tableToTsv(payload, payload.rows);
              void navigator.clipboard?.writeText(text).catch(() => {
                downloadText("profections.tsv", text, "text/tab-separated-values");
              });
            }}
            title={t("profview.copyRows")}
          >
            <Copy />
          </PaneToolbarButton>
          <PaneToolbarButton
            type="button"
            onClick={() =>
              void exportTextContent({
                filename: "profections",
                extension: "tsv",
                mimeType: "text/tab-separated-values;charset=utf-8",
                text: tableToTsv(payload, payload.rows),
                title: t("profview.exportTsvDialog"),
                filters: [{ name: t("profview.tsvFiles"), extensions: ["tsv"] }],
              }).catch(() => {})
            }
            title={t("profview.exportTsv")}
          >
            <Download />
          </PaneToolbarButton>
          <PaneToolbarButton
            type="button"
            onClick={() =>
              void exportTablePayloadPdf(payload, payload.rows, {
                fileStem: "profections",
                title: payload.title ?? t("profview.profections"),
              }).catch(() => {})
            }
            title={t("profview.exportPdf")}
          >
            <Download />
            PDF
          </PaneToolbarButton>
        </>
      }
    >
      {/* Controls — the wx Profections context submenu, flattened to native
          selects (profectionswnd.py:48-60). */}
      <PaneControlBar density="grouped" surface>
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="prof-pane-mode">
          {t("profview.mode")}
        </label>
        <PaneSelect
          id="prof-pane-mode"
          surface
          value={zodprof ? "zodiacal" : "mundane"}
          disabled={pending}
          onChange={(event) =>
            // wx onSetZodiacalProfections also clears UseZodProjs
            // (profectionswnd.py:272-273 passes usezodprojs=False).
            void updateProfectionsOptions(
              event.target.value === "zodiacal" ? { zodiacal: true, useZodProjs: false } : { zodiacal: false },
            )
          }
        >
          <option value="zodiacal">{header.zodLabel ?? t("profview.zodiacal")}</option>
          <option value="mundane">{header.munLabel ?? t("profview.placidianMundane")}</option>
        </PaneSelect>
        {/* UseZodProjs — enabled only in mundane mode (item_proj.Enable(not
            zodprof), profectionswnd.py:159-161,278-281). */}
        <label
          className={cn(
            PANE_CONTROL_CLASSES.checkboxLabel,
            zodprof ? "text-[color:var(--aries-text-muted)] opacity-60" : "text-[color:var(--aries-text-primary)]",
          )}
        >
          <input
            type="checkbox"
            checked={Boolean(header.useZodProjs)}
            disabled={pending || zodprof}
            onChange={(event) => void updateProfectionsOptions({ useZodProjs: event.target.checked })}
          />
          {header.useZodProjsLabel ?? t("profview.useZodiacalProjections")}
        </label>
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="prof-pane-display">
          {header.displayLabel ?? t("profview.display")}
        </label>
        <PaneSelect
          id="prof-pane-display"
          surface
          value={String(mainsigs)}
          disabled={pending}
          onChange={(event) => void updateBinding({ mainsigs: event.target.value === "true" })}
        >
          {displayOptions.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </PaneSelect>
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="prof-pane-monthly">
          {header.monthlyLabel ?? t("profview.monthly")}
        </label>
        <PaneSelect
          id="prof-pane-monthly"
          surface
          value={String(monthlySteps12)}
          disabled={pending}
          onChange={(event) => void updateBinding({ monthly_steps12: event.target.value === "true" })}
        >
          {monthlyOptions.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </PaneSelect>
        {/* Age paging (the popup stepper's 12-year window, retained from the
            daemon age_offset binding). */}
        <div className={PANE_CONTROL_CLASSES.rangeStepper}>
          <button
            type="button"
            className={PANE_CONTROL_CLASSES.rangeStepperButton}
            disabled={pending || ageOffset <= 0}
            onClick={() => void updateBinding({ age_offset: Math.max(0, ageOffset - 12) })}
          >
            -12
          </button>
          <span className={PANE_CONTROL_CLASSES.rangeStepperValue}>
            {t("profview.age", { age: ageOffset })}
          </span>
          <button
            type="button"
            className={PANE_CONTROL_CLASSES.rangeStepperButton}
            disabled={pending || ageOffset >= 144}
            onClick={() => void updateBinding({ age_offset: Math.min(144, ageOffset + 12) })}
          >
            +12
          </button>
        </div>
      </PaneControlBar>

      {/* The table — columns from profectiontable.build_columns with body-header
          colours; annual rows expand to the monthly drill rows (the wx
          onMonthly window). */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
        <table
          className={cn(
            "border-collapse text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)]",
            tableResize.tableClassName,
          )}
          style={tableResize.tableStyle}
        >
          {tableResize.colGroup}
          <thead className="sticky top-0 z-10 bg-[color:var(--aries-surface)]">
            <tr>
              {payload.columns.map((column) => (
                <th
                  key={column.id}
                  className="relative border border-[color:var(--aries-border-subtle)] px-1.5 py-1.5 text-center font-medium"
                  style={{
                    fontFamily: column.headerGlyph ? "'AriesMorinus'" : undefined,
                    fontWeight: column.headerGlyph ? 400 : undefined,
                    color: semanticChartColor(column.colorRole, column.colorHex),
                  }}
                >
                  {column.label}
                  <ColumnResizeHandle
                    columnId={column.id}
                    getResizeHandleProps={tableResize.getResizeHandleProps}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <ProfRow
                key={row.id}
                row={row}
                documentId={documentId}
                expanded={expanded.has(row.id)}
                onToggle={asNumber(row.meta?.level, 1) === 1 ? () => toggleExpanded(row.id) : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>
    </RetainedPaneShell>
  );
}

function ProfRow({
  row,
  documentId,
  expanded,
  onToggle,
}: {
  row: GenericTableRow;
  documentId: string;
  expanded: boolean;
  onToggle?: () => void;
}) {
  const meta = row.meta ?? {};
  const level = asNumber(meta.level, 1);
  const isCurrent = Boolean(row.current || meta.current);
  const eventDate = typeof meta.eventDate === "string" ? meta.eventDate : null;
  return (
    <TimedChartContextMenu documentId={documentId} eventDatetime={eventDate}>
      <tr
        data-prof-row={row.id}
        className={cn(
          level === 2 && "bg-[color:var(--aries-surface-subtle)]",
          isCurrent && "bg-accent text-accent-foreground",
          onToggle && "cursor-pointer hover:bg-primary/10",
        )}
        onClick={onToggle}
      >
        {row.cells.map((cell, index) => (
          <td
            key={index}
            className="whitespace-nowrap border border-[color:var(--aries-border-subtle)] px-1.5 py-0.5 text-center"
          >
            {index === 0 && onToggle ? (
              <span className="inline-flex items-center gap-0.5">
                {expanded ? (
                  <ChevronDown className="size-3 shrink-0 text-[color:var(--aries-text-muted)]" />
                ) : (
                  <ChevronRight className="size-3 shrink-0 text-[color:var(--aries-text-muted)]" />
                )}
                <CellView cell={cell} />
              </span>
            ) : (
              <CellView cell={cell} />
            )}
          </td>
        ))}
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
