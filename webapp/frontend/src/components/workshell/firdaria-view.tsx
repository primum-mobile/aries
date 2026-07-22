"use client";

import * as React from "react";
import { Copy, Download } from "lucide-react";

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
import { semanticChartColor } from "@/lib/theme/semantic-color";

import { TimedChartContextMenu } from "./directions-view";
import { downloadText, tableToTsv } from "./generic-table-view";
import { exportTablePayloadPdf } from "./table-pdf-export";
import { exportTextContent } from "./text-export";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";
import { RetainedPaneShell } from "./retained-pane-shell";
import {
  ListSegmentedControl,
  PaneControlBar,
  PaneToolbarButton,
} from "./list-controls";
import { useSettledWorkspaceRefreshSeq } from "./step-refresh";

// ---------------------------------------------------------------------------
// Firdaria — the webapp surface for the wx IN-FRAME variant
// (firdariawnd.FirdariaWnd, wrapped by firdariaframe.FirdariaFrame:6-15 and
// hosted by morin._workspace_table_firdaria, morin.py:16764-16769). The daemon
// owns ALL computation (firdaria.Firdaria via tables_service._firdaria): the
// diurnal/nocturnal mode (auto from chart sect, chart.abovehorizonwithorb —
// firdariawnd.py:92-100), the planetary-year tables, the main/sub period
// structure with node-period handling, the wx date-range formatting, the
// glyph colours (clrindividual / dignity, firdariawnd.py:403-411) and the
// current-period metadata from the ACTIVE chart session cursor. This view renders that payload
// and forwards raw intents:
//   - 'Use Bonatti nocturnal order' toggle -> table-binding POST
//     (FirdariaWnd.onToggleNocturnalMode, firdariawnd.py:126-135; per-radix
//      persistence morin.py:16017-16020 via _persist_binding, 102-105)
//   - row right-click -> the shared Timed-chart actions (commonwnd.py:63-85
//     via firdariawnd.py:72-76,115-124,217-248)
// ---------------------------------------------------------------------------

type FirdariaHeader = {
  titleText?: string;
  sectLabel?: string;
  isDaily?: boolean;
  isFirBonatti?: boolean;
  bonattiToggleLabel?: string;
};

type Props = {
  documentId: string;
  parentDocumentId?: string | null;
  sourceName?: string;
  /** Set when hosted as the right pane; renders the close button. */
  onClose?: () => void;
};

const TABLE_ID = "firdaria";

export function FirdariaView({ documentId, parentDocumentId, sourceName, onClose }: Props) {
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
  const header = (asRecord(capabilities.firdaria) as FirdariaHeader) ?? {};
  const isFirBonatti = Boolean(bindings.isfirbonatti);
  const tableColumnIds = React.useMemo(
    () => payload?.columns.map((column) => column.id) ?? ["ruler", "start", "age"],
    [payload?.columns],
  );
  const tableResize = useResizableTableColumns({ storageKey: TABLE_ID, columnIds: tableColumnIds });

  // The nocturnal-order toggle — FirdariaWnd.onToggleNocturnalMode
  // (firdariawnd.py:126-135): rebuild with the new order and persist the
  // per-radix binding (morin.store_table_binding_for_radix, morin.py:16017-16020).
  const updateBinding = React.useCallback(
    async (next: Record<string, unknown>) => {
      setPending(true);
      try {
        await workspaceUpdateTableBinding(documentId, { isfirbonatti: isFirBonatti, ...next }, TABLE_ID);
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
    [documentId, isFirBonatti],
  );

  // Scroll the current period into view when the payload (re)loads — prefer
  // the current sub-period.
  const currentRowId = React.useMemo(() => {
    const ids = Array.isArray(capabilities.currentRowIds)
      ? capabilities.currentRowIds.filter((id): id is string => typeof id === "string")
      : [];
    return ids.length > 0 ? ids[ids.length - 1] : null;
  }, [capabilities.currentRowIds]);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const scrolledForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!currentRowId || !listRef.current) return;
    if (scrolledForRef.current === documentId) return;
    const el = listRef.current.querySelector(`[data-firdaria-row="${CSS.escape(currentRowId)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      scrolledForRef.current = documentId;
    }
  }, [currentRowId, documentId]);

  if (error && !payload) {
    return (
      <RetainedPaneShell
        title={t("firdview.firdaria")}
        sourceName={sourceName}
        closeLabel={t("firdview.closeFirdaria")}
        onClose={onClose}
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
        title={t("firdview.firdaria")}
        sourceName={sourceName}
        closeLabel={t("firdview.closeFirdaria")}
        onClose={onClose}
      >
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {t("firdview.loading")}
        </div>
      </RetainedPaneShell>
    );
  }
  // BC charts: the daemon returns the unavailable payload
  // (morin.py:15883-15888 gate).
  if (payload.unavailable) {
    return (
      <RetainedPaneShell
        title={t("firdview.firdaria")}
        sourceName={sourceName}
        closeLabel={t("firdview.closeFirdaria")}
        onClose={onClose}
      >
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {payload.notes?.[0] ?? t("firdview.unavailable")}
        </div>
      </RetainedPaneShell>
    );
  }

  return (
    <RetainedPaneShell
      title={t("firdview.firdaria")}
      sourceName={sourceName}
      closeLabel={t("firdview.closeFirdaria")}
      onClose={onClose}
      toolbar={
        <>
          <PaneToolbarButton
            type="button"
            onClick={() => {
              const text = tableToTsv(payload, payload.rows);
              void navigator.clipboard?.writeText(text).catch(() => {
                downloadText("firdaria.tsv", text, "text/tab-separated-values");
              });
            }}
            title={t("firdview.copyRows")}
          >
            <Copy />
          </PaneToolbarButton>
          <PaneToolbarButton
            type="button"
            onClick={() =>
              void exportTextContent({
                filename: "firdaria",
                extension: "tsv",
                mimeType: "text/tab-separated-values;charset=utf-8",
                text: tableToTsv(payload, payload.rows),
                title: t("firdview.exportTsvTitle"),
                filters: [{ name: t("firdview.tsvFiles"), extensions: ["tsv"] }],
              }).catch(() => {})
            }
            title={t("firdview.exportTsv")}
          >
            <Download />
          </PaneToolbarButton>
          <PaneToolbarButton
            type="button"
            onClick={() =>
              void exportTablePayloadPdf(payload, payload.rows, {
                fileStem: "firdaria",
                title: header.titleText ?? t("firdview.firdaria"),
              }).catch(() => {})
            }
            title={t("firdview.exportPdf")}
          >
            <Download />
            PDF
          </PaneToolbarButton>
        </>
      }
    >
      {/* Compact control band — same visual language as the directions list
          controls. Sect is AUTO from the chart; only nocturnal order is a user
          toggle (firdariawnd.py:69-76,126-135). */}
      <PaneControlBar density="wide" surface={false}>
        <div className="min-w-0 text-sm font-semibold text-[color:var(--aries-text-primary)]">
          {t("firdview.firdaria")}
          <span className="ml-2 text-[length:var(--aries-font-size-small)] font-normal text-[color:var(--aries-text-muted)]">
            {header.sectLabel ?? ""}
          </span>
        </div>
        {header.isDaily === false ? (
          <ListSegmentedControl
            label={t("firdview.order")}
            value={isFirBonatti ? "bonatti" : "albiruni"}
            options={[
              { value: "bonatti", label: "Bonatti" },
              { value: "albiruni", label: "Al Biruni" },
            ]}
            disabled={pending}
            labelPlacement="inline"
            onChange={(value) => void updateBinding({ isfirbonatti: value === "bonatti" })}
          />
        ) : null}
      </PaneControlBar>

      {/* Flat interleaved list: each main period followed by its 7 sub-periods
          (node mains have none) — the FirdariaWnd table model
          (firdariawnd.py:190-207,393-428,556-615). */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
        <table
          className={cn(LIST_ROLE_CLASSES.symbolic, "border-collapse", tableResize.tableClassName)}
          style={tableResize.tableStyle}
        >
          {tableResize.colGroup}
          <FirdariaHeaderRow
            columns={payload.columns.map((c) => c.label)}
            columnIds={tableColumnIds}
            tableResize={tableResize}
          />
          <tbody>
            {payload.rows.map((row) => (
              <FirdariaRow key={row.id} row={row} documentId={documentId} />
            ))}
          </tbody>
        </table>
      </div>
    </RetainedPaneShell>
  );
}

// Row table: glyph | period start | age. Sub rows indent the glyph column —
// the wx nested-cell layout (mains at col 0, subs shifted one small cell,
// firdariawnd.py:528-540 vs 601-611).
const FIRDARIA_CELL_NOWRAP = "whitespace-nowrap";

function FirdariaHeaderRow({
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
          {columns[0] ?? t("firdview.ruler")}
          <ColumnResizeHandle columnId={columnIds[0] ?? "ruler"} getResizeHandleProps={tableResize.getResizeHandleProps} />
        </th>
        <th className="aries-list-head-cell relative border-b font-medium text-center">
          {columns[1] ?? t("firdview.start")}
          <ColumnResizeHandle columnId={columnIds[1] ?? "start"} getResizeHandleProps={tableResize.getResizeHandleProps} />
        </th>
        <th className="aries-list-head-cell relative border-b font-medium text-right">
          {columns[2] ?? t("firdview.age")}
          <ColumnResizeHandle columnId={columnIds[2] ?? "age"} getResizeHandleProps={tableResize.getResizeHandleProps} />
        </th>
      </tr>
    </thead>
  );
}

function FirdariaRow({ row, documentId }: { row: GenericTableRow; documentId: string }) {
  const meta = row.meta ?? {};
  const level = asNumber(meta.level, 1);
  const isMain = level === 1;
  const isCurrent = Boolean(row.current || meta.current);
  const colorHex = typeof meta.colorHex === "string" ? meta.colorHex : undefined;
  const colorRole = typeof meta.colorRole === "string" ? meta.colorRole : undefined;
  const eventDate = typeof meta.eventDate === "string" ? meta.eventDate : null;

  return (
    <TimedChartContextMenu documentId={documentId} eventDatetime={eventDate}>
      <tr
        data-firdaria-row={row.id}
        className={cn(
          "aries-list-row aries-list-row--flagged border-b border-x-0 border-t-0 text-[color:var(--aries-text-primary)]",
          isMain && "font-semibold",
        )}
      >
        {/* Ruler glyph — Morinus font, wx colour from the daemon
            (clrindividual / dignity, firdariawnd.py:403-411). */}
        <td
          className={cn("aries-list-cell", FIRDARIA_CELL_NOWRAP, "text-center")}
          style={{
            fontFamily: "'AriesMorinus'",
            color: semanticChartColor(colorRole, colorHex),
            paddingLeft: isMain ? 0 : "0.9rem",
          }}
        >
          {row.cells[0]?.glyph ?? ""}
        </td>
        {/* Start date (daemon-built, wx formatting verbatim). */}
        <td className={cn("aries-list-cell", FIRDARIA_CELL_NOWRAP, "text-center")}>{row.cells[1]?.text ?? ""}</td>
        {/* Age at period start. Current row is highlighted without a text label. */}
        <td className={cn("aries-list-cell", FIRDARIA_CELL_NOWRAP, "text-right", isCurrent && "font-semibold")}>
          {row.cells[2]?.text ?? ""}
        </td>
      </tr>
    </TimedChartContextMenu>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
