// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { X } from "lucide-react";

import {
  fetchGenericTablePayload,
  workspaceUpdateTableBinding,
  type GenericTablePayload,
  type GenericTableRow,
} from "@/lib/daemon/client";
import { isAbortError } from "@/lib/abort-error";
import {
  getCachedGenericTablePayload,
  rememberGenericTablePayload,
} from "@/lib/table/payload-cache";
import { LIST_PANE_CLASSES, LIST_ROW_CLASSES } from "@/lib/list-tokens";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import { semanticChartColor } from "@/lib/theme/semantic-color";

import { TimedChartContextMenu } from "./directions-view";
import { buildTableExportDocument } from "./table-pdf-export";
import { TextExportActions } from "./text-export-actions";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";
import { RetainedPaneShell } from "./retained-pane-shell";
import {
  PANE_CONTROL_CLASSES,
  PaneControlBar,
  PaneInfoBar,
  PaneSelect,
} from "./list-controls";
import { useSettledWorkspaceRefreshSeq } from "./step-refresh";
import {
  SidebarListBody,
  SidebarListCell,
  SidebarListHead,
  SidebarListHeader,
  SidebarListRow,
  SidebarListTable,
} from "./sidebar-list-table";

// ---------------------------------------------------------------------------
// Zodiacal Releasing — the webapp surface for the wx IN-FRAME variant
// (zodiacalreleasingwnd.ZRWnd hosted by morin._workspace_table_zodiacal_releasing,
// morin.py:17129-17159; the popup twin zodiacalreleasingframe/ZRDrillDlg is
// superseded). The daemon owns ALL computation (zodiacalreleasing.py via
// tables_service._zodiacal_releasing): the period tree, releaser resolution,
// LoB/peak/current flags, per-level period + length formatting, header text and
// the element/planet colours. This view renders that payload and forwards raw
// intents:
//   - releaser select / manual sign / Spirit-shift toggle -> table-binding POST
//     (ZRWnd._on_select_releaser/_on_select_manual_sign/_on_toggle_shift,
//      zodiacalreleasingwnd.py:329-356)
//   - L2 row click -> drill_l2_start binding (ZRWnd._open_drill /
//     get_state drill_l2_start, zodiacalreleasingwnd.py:894-950,249-292)
//   - row right-click -> the shared Timed-chart actions (commonwnd.py:63-85 via
//     zodiacalreleasingwnd.py:197-199,863-879)
// Live current-period highlighting tracks the chart cursor by refetching on
// session.changed (the wx _refresh_open_zr_views path, morin.py:4119-4147).
// ---------------------------------------------------------------------------

type ZrHeader = {
  releaser?: string;
  labelToken?: string;
  releaserHeading?: string;
  releaserLabel?: string;
  inLabel?: string;
  signIndex?: number;
  signGlyph?: string;
  signName?: string;
  signNames?: string[];
  degreeText?: string;
  shiftLabel?: string;
  signColors?: string[];
  signColorRoles?: Array<string | null>;
  planetColors?: string[];
  planetColorRoles?: Array<string | null>;
};

type BindingOption = { value: string | number | boolean; label?: string; glyph?: string };

type Props = {
  documentId: string;
  parentDocumentId?: string | null;
  sourceName?: string;
  /** Set when hosted as the right pane; renders the close button. */
  onClose?: () => void;
};

const TABLE_ID = "zodiacal_releasing";
const ZR_COLUMN_IDS = ["ribbon", "level", "sign", "start", "age", "length", "ruler", "flags"] as const;

export function ZodiacalReleasingView({ documentId, parentDocumentId, sourceName, onClose }: Props) {
  const t = useT();
  const [payload, setPayload] = React.useState<GenericTablePayload | null>(() =>
    getCachedGenericTablePayload(TABLE_ID, documentId),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const requestSeqRef = React.useRef(0);
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastRetainedDataOptionsChange);

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
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    fetchGenericTablePayload(TABLE_ID, documentId, controller.signal)
      .then((next) => {
        if (requestSeq !== requestSeqRef.current) return;
        rememberGenericTablePayload(TABLE_ID, documentId, next);
        setPayload(next);
        setError(null);
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        if (requestSeq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [documentId, refreshSeq]);

  const capabilities = (payload?.capabilities ?? {}) as Record<string, unknown>;
  const bindings = asRecord(capabilities.bindings);
  const bindingOptions = asRecord(capabilities.bindingOptions);
  const zr = (asRecord(capabilities.zr) as ZrHeader) ?? {};
  const releaser = String(bindings.releaser ?? "spirit");
  const startSign = asNumber(bindings.start_sign, 0);
  const applyShift = Boolean(bindings.apply_spirit_shift);
  const drilledRowId = typeof bindings.drilled_row_id === "string" ? bindings.drilled_row_id : null;
  const tableResize = useResizableTableColumns({ storageKey: TABLE_ID, columnIds: ZR_COLUMN_IDS });

  const updateBinding = React.useCallback(
    async (next: Record<string, unknown>) => {
      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;
      setPending(true);
      try {
        // NOTE: drill_l2_start is intentionally NOT carried over — any
        // releaser/sign/shift change recomputes the table and closes the drill
        // panel, exactly like ZRWnd.compute_and_draw (zodiacalreleasingwnd.py:295-297).
        // Only the explicit drill toggle passes drill_l2_start in `next`.
        await workspaceUpdateTableBinding(
          documentId,
          {
            releaser,
            apply_spirit_shift: applyShift,
            start_sign: startSign,
            ...next,
          },
          TABLE_ID,
        );
        const refreshed = await fetchGenericTablePayload(TABLE_ID, documentId);
        if (requestSeq !== requestSeqRef.current) return;
        rememberGenericTablePayload(TABLE_ID, documentId, refreshed);
        setPayload(refreshed);
        setError(null);
      } catch (err) {
        if (requestSeq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [documentId, releaser, applyShift, startSign],
  );

  // Drill toggle — the L2 click model (ZRWnd._onLeftDown row-hit branch,
  // zodiacalreleasingwnd.py:926-932). The selection key is the L2 start
  // datetime, stable across recomputes (get_state, line 249-266).
  const toggleDrill = React.useCallback(
    (row: GenericTableRow) => {
      if (pending) return;
      const periodStart = typeof row.meta?.periodStart === "string" ? row.meta.periodStart : null;
      if (!periodStart) return;
      void updateBinding({ drill_l2_start: row.id === drilledRowId ? null : periodStart });
    },
    [updateBinding, drilledRowId, pending],
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

  // Scroll the current L2 chapter into view when the payload (re)loads.
  const currentMainId = React.useMemo(() => {
    const current = mainRows.find((row) => asNumber(row.meta?.level, 0) === 2 && (row.current || row.meta?.current));
    return current?.id ?? null;
  }, [mainRows]);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const scrolledForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!currentMainId || !listRef.current) return;
    if (scrolledForRef.current === documentId) return;
    const el = listRef.current.querySelector(`[data-zr-row="${CSS.escape(currentMainId)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      scrolledForRef.current = documentId;
    }
  }, [currentMainId, documentId]);

  if (error && !payload) {
    return (
      <RetainedPaneShell
        title={t("zrview.zodiacalReleasing")}
        sourceName={sourceName}
        closeLabel={t("zrview.closeZodiacalReleasing")}
        onClose={onClose}
        titleSize="large"
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
        title={t("zrview.zodiacalReleasing")}
        sourceName={sourceName}
        closeLabel={t("zrview.closeZodiacalReleasing")}
        onClose={onClose}
        titleSize="large"
      >
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {t("zrview.loading")}
        </div>
      </RetainedPaneShell>
    );
  }
  // BC charts: the daemon returns the unavailable payload
  // (morin.py:17133-17137 gate).
  if (payload.unavailable) {
    return (
      <RetainedPaneShell
        title={t("zrview.zodiacalReleasing")}
        sourceName={sourceName}
        closeLabel={t("zrview.closeZodiacalReleasing")}
        onClose={onClose}
        titleSize="large"
      >
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {payload.notes?.[0] ?? t("zrview.unavailable")}
        </div>
      </RetainedPaneShell>
    );
  }

  const releaserOptions = asOptions(bindingOptions.releaser);
  const signOptions = asOptions(bindingOptions.sign);
  const signColors = zr.signColors ?? [];
  const signColorRoles = zr.signColorRoles ?? [];
  const planetColors = zr.planetColors ?? [];
  const planetColorRoles = zr.planetColorRoles ?? [];
  const signNames = zr.signNames ?? [];

  return (
    <RetainedPaneShell
      title={t("zrview.zodiacalReleasing")}
      sourceName={sourceName}
      closeLabel={t("zrview.closeZodiacalReleasing")}
      onClose={onClose}
      titleSize="large"
      toolbar={
        <TextExportActions
          buildDocument={() =>
            buildTableExportDocument(payload, payload.rows, {
              fileStem: "zodiacal_releasing",
              title: payload.title ?? t("zrview.zodiacalReleasing"),
            })
          }
        />
      }
    >
      {/* Binding controls — releaser / manual sign / Spirit-shift toggle
          (the ZRWnd context-menu + header-click model,
          zodiacalreleasingwnd.py:159-200,894-924). */}
      <PaneControlBar>
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="zr-pane-releaser">
          {zr.releaserHeading ?? t("zrview.releaser")}
        </label>
        <PaneSelect
          id="zr-pane-releaser"
          value={releaser}
          disabled={pending}
          onChange={(event) => void updateBinding({ releaser: event.target.value })}
        >
          {releaserOptions.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </PaneSelect>
        {releaser === "sign" ? (
          <PaneSelect
            aria-label={t("zrview.manualSign")}
            value={String(startSign)}
            disabled={pending}
            onChange={(event) => void updateBinding({ start_sign: Number(event.target.value) })}
          >
            {signOptions.map((option) => (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label ?? String(option.value)}
              </option>
            ))}
          </PaneSelect>
        ) : null}
        {releaser === "spirit" ? (
          <label
            className={cn(
              PANE_CONTROL_CLASSES.checkboxLabel,
              "gap-[var(--aries-control-gap-compact)]",
            )}
          >
            <input
              type="checkbox"
              checked={applyShift}
              disabled={pending}
              onChange={(event) => void updateBinding({ apply_spirit_shift: event.target.checked })}
            />
            {zr.shiftLabel ?? t("zrview.applyShift")}
          </label>
        ) : null}
      </PaneControlBar>

      {/* Releaser info line — "Releaser: <label> in <glyph> <name> <deg>"
          (ZRWnd._draw_releaser_header, zodiacalreleasingwnd.py:518-566). */}
      <PaneInfoBar>
        <span>
          {zr.releaserHeading ?? t("zrview.releaser")}: {zr.releaserLabel ?? ""}
        </span>
        <span className="text-[color:var(--aries-text-muted)]">{zr.inLabel ?? t("zrview.in")}</span>
        <span
          style={{
            fontFamily: "'AriesMorinus'",
            color: semanticChartColor(
              signColorRoles[zr.signIndex ?? 0],
              signColors[zr.signIndex ?? 0],
            ),
          }}
        >
          {zr.signGlyph ?? ""}
        </span>
        <span
          style={{
            color: semanticChartColor(
              signColorRoles[zr.signIndex ?? 0],
              signColors[zr.signIndex ?? 0],
            ),
          }}
        >
          {zr.signName ?? ""}
        </span>
        {zr.degreeText ? <span>{zr.degreeText}</span> : null}
      </PaneInfoBar>

      {/* Main table: interleaved L1 + L2 (build_main; click L2 to drill). */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
        <SidebarListTable
          profile="directions-titled"
          className={tableResize.tableClassName}
          style={tableResize.tableStyle}
        >
          {tableResize.colGroup}
          <ZrHeaderRow columns={payload.columns.map((c) => c.label)} tableResize={tableResize} />
          <SidebarListBody>
            {mainRows.map((row) => (
              <ZrRow
                key={row.id}
                row={row}
                documentId={documentId}
                signColors={signColors}
                signColorRoles={signColorRoles}
                planetColors={planetColors}
                planetColorRoles={planetColorRoles}
                selected={row.id === drilledRowId}
                onClick={asNumber(row.meta?.level, 0) === 2 ? () => toggleDrill(row) : undefined}
              />
            ))}
          </SidebarListBody>
        </SidebarListTable>
      </div>

      {/* Inline drill panel: L3 + L4 of the selected L2
          (ZRWnd._draw_drill_panel, zodiacalreleasingwnd.py:704-776). */}
      {drilledL2 ? (
        <div className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t border-[color:var(--aries-border-subtle)]">
          <PaneInfoBar className="border-b-0">
            <span className="text-[color:var(--aries-text-muted)]">L2:</span>
            <span
              style={{
                fontFamily: "'AriesMorinus'",
                color: semanticChartColor(
                  signColorRoles[asNumber(drilledL2.meta?.sign, 0)],
                  signColors[asNumber(drilledL2.meta?.sign, 0)],
                ),
              }}
            >
              {drilledL2.cells[0]?.glyph ?? ""}
            </span>
            <span
              style={{
                color: semanticChartColor(
                  signColorRoles[asNumber(drilledL2.meta?.sign, 0)],
                  signColors[asNumber(drilledL2.meta?.sign, 0)],
                ),
              }}
            >
              {signNames[asNumber(drilledL2.meta?.sign, 0)] ?? ""}
            </span>
            <span>{formatDrillDate(drilledL2.meta?.periodStart)}</span>
            {flagText(drilledL2) ? <span className="font-semibold">{flagText(drilledL2)}</span> : null}
            <button
              type="button"
              className={cn(PANE_CONTROL_CLASSES.microIconButton, "ml-auto")}
              onClick={() => void updateBinding({ drill_l2_start: null })}
              aria-label={t("zrview.closeDrill")}
            >
              <X />
            </button>
          </PaneInfoBar>
          <div className="min-h-0 flex-1 overflow-auto">
            <SidebarListTable
              profile="directions-titled"
              className={tableResize.tableClassName}
              style={tableResize.tableStyle}
            >
              {tableResize.colGroup}
              <SidebarListBody>
                {drillRows.map((row) => (
                  <ZrRow
                    key={row.id}
                    row={row}
                    documentId={documentId}
                    signColors={signColors}
                    signColorRoles={signColorRoles}
                    planetColors={planetColors}
                    planetColorRoles={planetColorRoles}
                  />
                ))}
              </SidebarListBody>
            </SidebarListTable>
          </div>
        </div>
      ) : null}
    </RetainedPaneShell>
  );
}

// Compact table: ribbon | bullet | sign | start | age | length | ruler | flags.
// Level is row structure, not a separate data column.
const ZR_CELL_NOWRAP = "whitespace-nowrap";

function ZrHeaderRow({
  columns,
  tableResize,
}: {
  columns: string[];
  tableResize: ReturnType<typeof useResizableTableColumns>;
}) {
  // Ribbon + bullet columns are headerless visual indicators
  // (zodiacalreleasingwnd.py:573-582). columns = [Sign, Start, Age, Length, Ruler, flags].
  return (
    <SidebarListHeader className={cn(LIST_PANE_CLASSES.stickyHeader, "text-[color:var(--aries-text-muted)]")}>
      <SidebarListRow>
        {ZR_COLUMN_IDS.map((columnId, index) => {
          const label = index < 2 ? "" : columns[index - 2] ?? (index === 7 ? "" : columnId);
          const align = index === 4 || index === 5 ? "text-right" : "text-center";
          return (
            <SidebarListHead key={columnId} className={cn("relative font-medium", align)}>
              {label}
              <ColumnResizeHandle columnId={columnId} getResizeHandleProps={tableResize.getResizeHandleProps} />
            </SidebarListHead>
          );
        })}
      </SidebarListRow>
    </SidebarListHeader>
  );
}

// Level bullets — ZRWnd._draw_row bullet column (zodiacalreleasingwnd.py:649-656).
const LEVEL_BULLET: Record<number, string> = { 1: "●", 2: "○", 3: "◦", 4: "·" };

function ZrRow({
  row,
  documentId,
  signColors,
  signColorRoles,
  planetColors,
  planetColorRoles,
  selected,
  onClick,
}: {
  row: GenericTableRow;
  documentId: string;
  signColors: string[];
  signColorRoles: Array<string | null>;
  planetColors: string[];
  planetColorRoles: Array<string | null>;
  selected?: boolean;
  onClick?: () => void;
}) {
  const meta = row.meta ?? {};
  const level = asNumber(meta.level, 2);
  const sign = asNumber(meta.sign, 0);
  const ruler = asNumber(meta.ruler, 0);
  const parentSign = meta.parentSign == null ? null : asNumber(meta.parentSign, sign);
  const repeatsParent = Boolean(meta.repeatsParent);
  const isLob = Boolean(meta.isLob);
  const isCurrent = Boolean(row.current || meta.current);
  const isL1 = level === 1;
  // Ribbon = the chain identity: L1 its own sign, children the parent's sign
  // (zodiacalreleasingwnd.py:628-633).
  const ribbonSign = isL1 ? sign : parentSign ?? sign;
  const eventDate = typeof meta.eventDate === "string" ? meta.eventDate : null;
  const quietAge = !isL1 && Boolean(row.cells[2]?.text);

  return (
    <TimedChartContextMenu documentId={documentId} eventDatetime={eventDate}>
      <SidebarListRow
        data-zr-row={row.id}
        data-state={selected ? "selected" : undefined}
        className={cn(
          "relative text-[color:var(--aries-text-primary)]",
          LIST_ROW_CLASSES.flagged,
          isL1 && "font-semibold",
          selected && LIST_ROW_CLASSES.selected,
          isCurrent && LIST_ROW_CLASSES.current,
          onClick && cn(LIST_ROW_CLASSES.hover, "cursor-pointer"),
        )}
        onClick={onClick}
      >
        {/* Ribbon stripe (full row height). */}
        <SidebarListCell className="!p-0">
          <span
            className="block min-h-[var(--aries-list-row-height)] w-[6px]"
            style={{
              backgroundColor: semanticChartColor(
                signColorRoles[ribbonSign],
                signColors[ribbonSign],
              ),
            }}
          />
        </SidebarListCell>
        {/* Bullet + indent (level indicator). */}
        <SidebarListCell className={cn(ZR_CELL_NOWRAP, "text-center")} style={{ paddingLeft: `${(level - 1) * 5}px` }}>
          {LEVEL_BULLET[level] ?? "·"}
        </SidebarListCell>
        {/* Sign glyph — hidden when the row repeats its parent chain
            (zodiacalreleasingwnd.py:658-664). */}
        <SidebarListCell
          className={cn(ZR_CELL_NOWRAP, "text-center")}
          style={{
            fontFamily: "'AriesMorinus'",
            color: semanticChartColor(signColorRoles[sign], signColors[sign]),
          }}
        >
          {repeatsParent ? "" : row.cells[0]?.glyph ?? ""}
        </SidebarListCell>
        {/* Period (compact per-level format, daemon-built). */}
        <SidebarListCell className={cn(ZR_CELL_NOWRAP, "text-center")}>{row.cells[1]?.text ?? ""}</SidebarListCell>
        {/* Age at period start. */}
        <SidebarListCell className={cn(ZR_CELL_NOWRAP, "text-right", quietAge && "text-[color:var(--aries-text-muted)]")}>
          {row.cells[2]?.text ?? ""}
        </SidebarListCell>
        {/* Length. */}
        <SidebarListCell className={cn(ZR_CELL_NOWRAP, "text-right")}>{row.cells[3]?.text ?? ""}</SidebarListCell>
        {/* Ruler glyph — hidden when repeats parent (zodiacalreleasingwnd.py:680-686). */}
        <SidebarListCell
          className={cn(ZR_CELL_NOWRAP, "text-center")}
          style={{
            fontFamily: "'AriesMorinus'",
            color: semanticChartColor(planetColorRoles[ruler], planetColors[ruler]),
          }}
        >
          {repeatsParent ? "" : row.cells[4]?.glyph ?? ""}
        </SidebarListCell>
        {/* Flags: current rows are highlighted; LB and peak markers remain compact. */}
        <SidebarListCell className={cn(ZR_CELL_NOWRAP, "text-center", (isLob || isCurrent) && "font-semibold")}>
          {row.cells[5]?.text ?? ""}
        </SidebarListCell>
      </SidebarListRow>
    </TimedChartContextMenu>
  );
}

function flagText(row: GenericTableRow): string {
  return row.cells[5]?.text ?? "";
}

function formatDrillDate(value: unknown): string {
  // The drill info bar date — fmt_date + year-zero strip
  // (zodiacalreleasingwnd.py:712 / 391-407).
  if (typeof value !== "string" || !value) return "";
  const [datePart] = value.split("T");
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return datePart;
  return `${Number(y)}.${m}.${d}`;
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
