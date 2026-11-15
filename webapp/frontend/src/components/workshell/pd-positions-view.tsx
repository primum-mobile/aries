// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import { useStepBurst } from "@/lib/chart/step-burst";
import { Button } from "@/components/ui/button";
import {
  fetchGenericTablePayload,
  openDirectionsPdInChart,
  workspaceActivate,
  workspaceOpenTable,
  workspaceSetPdSpeculumMoment,
  type GenericTableCell,
  type GenericTableColumn,
  type GenericTablePayload,
  type GenericTableRow,
  type InspectorSpeculumPrecision,
} from "@/lib/daemon/client";
import { isAbortError } from "@/lib/abort-error";
import { coerceDateConvention } from "@/lib/date-display";
import { useT } from "@/lib/i18n/i18n";
import { formatTableDegrees } from "@/lib/table/angle-precision";
import { TablePrecisionMenu, useTablePrecision } from "./table-precision-menu";
import { observeInspectorSpeculumFit } from "@/lib/inspector-speculum-layout";
import { LIVE_SURFACE_PRIORITY, liveSurfaceResult, useFreshLivePayload, useLiveSurfaceRequest } from "@/lib/live-surfaces";
import { LIST_PANE_CLASSES } from "@/lib/list-tokens";
import { getCachedGenericTablePayload, rememberGenericTablePayload } from "@/lib/table/payload-cache";
import { runImmediateWorkspaceCommand } from "@/stores/daemon-workspace-adapter";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { beginWorkspaceSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { CellView, VoidOfCourseSuffix } from "./generic-table-view";
import { isSpeculumBodyRowVisible, useSpeculumVisibility } from "./inspector-panel";
import { InspectorSpeculumAngle, InspectorSpeculumSpeed } from "./speculum-table-cells";
import { ListMomentStepper, type ListMomentUnit } from "./list-controls";
import { RetainedPaneShell } from "./retained-pane-shell";
import { SidebarListTable, SidebarListHeader, SidebarListBody, SidebarListRow, SidebarListHead, SidebarListCell } from "./sidebar-list-table";
import { useSettledWorkspaceRefreshSeq } from "./step-refresh";
import { tableCellText } from "./table-text-export";
import { buildTableExportDocument, tableExportBaseName } from "./table-pdf-export";
import { TextExportActions } from "./text-export-actions";

const TABLE_ID = "pd_positions";
const refreshSeqByDocument = new Map<string, string>();

type Props = {
  documentId: string;
  sourceName: string;
  chart: ChartRenderSnapshot | null;
  onClose: () => void;
};

/** Morinus' PDs-in-Chart Positions: significators directed by the current arc.
 * Compact Speculum layout; exports retain every column of the PD system's Speculum. */
export function PdPositionsView({ documentId, sourceName, chart, onClose }: Props) {
  const t = useT();
  const { payload, error } = useDirectedSignificatorsPayload(documentId, chart);
  return (
    <RetainedPaneShell title={t("table.pd_positions")} sourceName={payload?.sourceName ?? sourceName}
      closeLabel={t("pdPositions.close")} onClose={onClose} closePosition="leading" closeAppearance="list"
      toolbar={payload ? <DirectedSignificatorsExport payload={payload} /> : null}>
      <div className={`${LIST_PANE_CLASSES.controlRow} border-b border-border px-[var(--aries-pane-header-padding-x)] py-[var(--aries-pane-header-padding-y)]`}>
        <DirectedSpeculumMoment documentId={documentId} payload={payload} />
      </div>
      <DirectedSignificatorsTable payload={payload} chart={chart} error={error} />
    </RetainedPaneShell>
  );
}

/** The Primary tab's Speculum view: the same live list beside the directions. */
export function DirectedSignificatorsPanel({ documentId, chart, settingsControl = null }: {
  documentId: string;
  chart: ChartRenderSnapshot | null;
  /** The Primary Directions settings toggle shared with the PD list and Circum. */
  settingsControl?: React.ReactNode;
}) {
  const t = useT();
  const { payload, error } = useDirectedSignificatorsPayload(documentId, chart);
  // A PDs-in-Chart chart already is the directed chart; offer it otherwise.
  const readsPdChart = useDaemonWorkspaceStore((state) => state.documents.some(
    (doc) => doc.documentId === documentId && doc.launcherKind === "pd_in_chart",
  ));
  const applyTimedChartOpenResult = useWorkspaceStore((state) => state.applyTimedChartOpenResult);
  const signedArc = payload?.pdPositions?.signedArc ?? null;
  const momentDatetime = payload?.pdPositions?.momentDatetime ?? null;
  // Technique · key, as the PD list and Circum headers read.
  const directionMetadata = [payload?.pdPositions?.systemLabel, payload?.pdPositions?.keyLabel]
    .filter(Boolean).join(" · ");
  const openTable = React.useCallback(() => {
    void workspaceOpenTable(documentId, "pd_speculum")
      .then((result) => { if (result.documentId) void workspaceActivate(result.documentId); })
      .catch((err: unknown) => console.error("[pd-speculum-open]", err));
  }, [documentId]);
  const openPdChart = React.useCallback(() => {
    if (signedArc == null) return;
    const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
    void openDirectionsPdInChart(documentId, Math.abs(signedArc), {
      direct: signedArc >= 0,
      whenIso: momentDatetime,
    })
      .then((result) => applyTimedChartOpenResult(result))
      .catch((err: unknown) => console.error("[pd-speculum-pd-chart]", err))
      .finally(finishSnapshotCommand);
  }, [applyTimedChartOpenResult, documentId, momentDatetime, signedArc]);
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className={LIST_PANE_CLASSES.standardHeader}>
        <div className={LIST_PANE_CLASSES.titleRow}>
          <div className={LIST_PANE_CLASSES.titleGroup}>
            <h2 className={LIST_PANE_CLASSES.title}>{t("table.pd_positions")}</h2>
            {directionMetadata ? (
              <span className={LIST_PANE_CLASSES.metadata}>{directionMetadata}</span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {!readsPdChart ? (
              <Button type="button" size="xs" variant="outline" disabled={signedArc == null} onClick={openPdChart}>
                {t("primdir.pdsInChart")}
              </Button>
            ) : null}
            <Button type="button" size="xs" variant="outline" title={t("dirview.openSpeculumTable")} onClick={openTable}>
              {t("dirview.fullTable")}
            </Button>
            {settingsControl}
            {payload ? <DirectedSignificatorsExport payload={payload} /> : null}
          </div>
        </div>
        <div className={LIST_PANE_CLASSES.controlRow}>
          <DirectedSpeculumMoment documentId={documentId} payload={payload} />
        </div>
      </div>
      <DirectedSignificatorsTable payload={payload} chart={chart} error={error} />
    </div>
  );
}


type SpeculumMomentRequest = { unit?: ListMomentUnit; delta?: number; date?: string };

/** The directed speculum's moment: the radix branch's primary-direction time.
 * Steps and typed dates go to the daemon, which moves every chart directed
 * from the radix (PDs-in-Chart charts, the Astrolabe) with it. Steps made
 * while a request is in flight fold into one pending step. */
function DirectedSpeculumMoment({ documentId, payload }: {
  documentId: string;
  payload: GenericTablePayload | null;
}) {
  const t = useT();
  const precision = useTablePrecision();
  const moment = payload?.pdPositions?.momentDatetime ?? null;
  const day = moment ? moment.slice(0, 10) : null;
  const documentRef = React.useRef(documentId);
  const pendingRef = React.useRef<SpeculumMomentRequest[]>([]);
  const drainingRef = React.useRef(false);
  React.useEffect(() => {
    documentRef.current = documentId;
  }, [documentId]);

  const drain = React.useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      for (let request = pendingRef.current.shift(); request; request = pendingRef.current.shift()) {
        try {
          await runImmediateWorkspaceCommand(
            workspaceSetPdSpeculumMoment({ docId: documentRef.current, ...request }),
          );
        } catch (err: unknown) {
          console.error("[pd-speculum-moment]", err);
        }
      }
    } finally {
      drainingRef.current = false;
    }
  }, []);
  const send = React.useCallback((request: SpeculumMomentRequest) => {
    const queue = pendingRef.current;
    const last = queue[queue.length - 1];
    if (last && request.unit && last.unit === request.unit) {
      last.delta = (last.delta ?? 0) + (request.delta ?? 0);
    } else {
      queue.push({ ...request });
    }
    void drain();
  }, [drain]);
  const commitDate = React.useCallback((date: string) => send({ date }), [send]);
  const step = React.useCallback(
    (unit: ListMomentUnit, delta: number) => send({ unit, delta }),
    [send],
  );

  const signedArc = payload?.pdPositions?.signedArc;
  return (
    <>
      <ListMomentStepper
        value={day}
        convention={coerceDateConvention(payload?.capabilities?.dateConvention)}
        onStep={step}
        onCommitDate={commitDate}
        dateLabel={t("pdPositions.date")}
        previousYearLabel={t("pdPositions.previousYear")}
        previousMonthLabel={t("pdPositions.previousMonth")}
        nextMonthLabel={t("pdPositions.nextMonth")}
        nextYearLabel={t("pdPositions.nextYear")}
      />
      {signedArc !== undefined ? (
        <span className={LIST_PANE_CLASSES.labeledControl}>
          <span className={LIST_PANE_CLASSES.controlLabel}>{t("dirview.arc")}</span>
          <span className="tabular-nums">{formatTableDegrees(Math.abs(signedArc), precision)}</span>
        </span>
      ) : null}
    </>
  );
}

export function DirectedSignificatorsExport({ payload }: { payload: GenericTablePayload }) {
  return <TextExportActions sourceName={payload.sourceName} fileStem={tableExportBaseName(payload.title)}
    buildDocument={() => buildTableExportDocument(payload, payload.rows)} />;
}

/** The live directed-significator payload for a PD chart, or a chart under a radix at its cursor's arc. */
export function useDirectedSignificatorsPayload(documentId: string, chart: ChartRenderSnapshot | null) {
  const [payloadState, setPayloadState] = React.useState(() => ({
    documentId,
    payload: getCachedGenericTablePayload(TABLE_ID, documentId),
  }));
  const payload = payloadState.documentId === documentId
    ? payloadState.payload
    : getCachedGenericTablePayload(TABLE_ID, documentId) ?? payloadState.payload;
  const [error, setError] = React.useState(false);
  const requestSeqRef = React.useRef(0);
  const inFlightRef = React.useRef<AbortController | null>(null);
  const [restartTick, setRestartTick] = React.useState(0);
  const { active: stepBurstActive } = useStepBurst();
  const lastSessionChange = useDaemonWorkspaceStore((s) => s.lastSessionChange);
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastSpeculumOptionsChange);
  const sessionRefreshSeq = useSettledWorkspaceRefreshSeq({ documentId, lastSessionChange, lastOptionsChange });
  // The radix branch's PD time can move without a session change of this
  // document (speculum chevrons, a turned rete, Space on the radix).
  const pdBranchRevision = useDaemonWorkspaceStore((s) => s.pdBranchRevision);
  const refreshSeq = `${sessionRefreshSeq}:${pdBranchRevision}`;
  const liveKey = `pd-positions:${documentId}`;
  useLiveSurfaceRequest({ key: liveKey, kind: "table", documentId, tableId: TABLE_ID }, LIVE_SURFACE_PRIORITY.speculum);
  useFreshLivePayload<GenericTablePayload>(liveSurfaceResult(chart, liveKey), (next) => {
    requestSeqRef.current += 1;
    if (inFlightRef.current) {
      inFlightRef.current.abort();
      inFlightRef.current = null;
      setRestartTick((tick) => tick + 1);
    }
    rememberGenericTablePayload(TABLE_ID, documentId, next);
    setPayloadState({ documentId, payload: next });
    setError(false);
  });
  React.useEffect(() => {
    if (stepBurstActive) return;
    if (getCachedGenericTablePayload(TABLE_ID, documentId) && refreshSeqByDocument.get(documentId) === refreshSeq) return;
    const controller = new AbortController();
    const requestSeq = ++requestSeqRef.current;
    inFlightRef.current = controller;
    fetchGenericTablePayload(TABLE_ID, documentId, controller.signal)
      .then((next) => {
        if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
        rememberGenericTablePayload(TABLE_ID, documentId, next);
        refreshSeqByDocument.set(documentId, refreshSeq);
        setPayloadState({ documentId, payload: next });
        setError(false);
      })
      .catch((err: unknown) => {
        if (!isAbortError(err, controller.signal) && requestSeq === requestSeqRef.current) setError(true);
      })
      .finally(() => { if (inFlightRef.current === controller) inFlightRef.current = null; });
    return () => controller.abort();
  }, [documentId, refreshSeq, restartTick, stepBurstActive]);
  return { payload, error };
}

export function DirectedSignificatorsTable({ payload, chart, error }: {
  payload: GenericTablePayload | null;
  chart: ChartRenderSnapshot | null;
  error: boolean;
}) {
  const t = useT();
  const precision = useTablePrecision();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const tableRef = React.useRef<HTMLTableElement>(null);
  const compact = payload?.speculumInspector;
  const columns = compact?.columns ?? [];
  // The daemon sends every significator; the wheel's visible layers are a
  // display lens here, so a layer toggle never refetches or recalculates.
  const visibility = useSpeculumVisibility(chart);
  const { rows, extraRows } = React.useMemo(() => {
    const bodyIndex = (compact?.columns ?? []).findIndex((column) => column.id === "body");
    const main: GenericTableRow[] = [];
    const extra: GenericTableRow[] = [];
    for (const section of compact?.sections ?? []) {
      if (section.id === "extra") {
        extra.push(...section.rows);
        continue;
      }
      main.push(...(visibility
        ? section.rows.filter((row) => isSpeculumBodyRowVisible(section.id, row, row.cells[bodyIndex], visibility))
        : section.rows));
    }
    return { rows: main, extraRows: extra };
  }, [compact, visibility]);
  const rowSignature = [...rows, ...extraRows].map((row) => row.id).join("\u0000");
  React.useLayoutEffect(() => {
    if (!containerRef.current || !tableRef.current) return;
    return observeInspectorSpeculumFit(containerRef.current, tableRef.current);
  }, [precision, rowSignature]);

  return (
    <>
      {error ? <div className={LIST_PANE_CLASSES.error}>{t("table.refreshFailed")}</div> : null}
      {!payload ? <div className={LIST_PANE_CLASSES.loading}>{t("table.loadingTable")}</div> : (
        <TablePrecisionMenu><div ref={containerRef} className="aries-inspector-speculum flex min-h-0 min-w-0 max-w-full flex-1 flex-col">
          <div className={LIST_PANE_CLASSES.scroller}>
            <SidebarListTable profile="directions-titled" ref={tableRef} className="max-w-full" aria-label={t("table.pd_positions")}>
              <SidebarListHeader className={LIST_PANE_CLASSES.stickyHeader}>
                <SidebarListRow>{columns.map((column) => <SidebarListHead key={column.id}
                  title={column.label} className={column.id === "body" ? "text-left" : "text-right"}>
                  <span className="aries-inspector-speculum-heading">{column.label}</span>
                </SidebarListHead>)}</SidebarListRow>
              </SidebarListHeader>
              <SidebarListBody>
                {rows.map((row) => <PdPositionRow key={row.id} row={row} columns={columns} precision={precision} />)}
                {extraRows.length ? <SidebarListRow>
                  <SidebarListCell colSpan={columns.length} className="whitespace-normal text-left text-muted-foreground">
                    {t("pdPositions.extraPoints")}
                  </SidebarListCell>
                </SidebarListRow> : null}
                {extraRows.map((row) => <PdPositionRow key={row.id} row={row} columns={columns} precision={precision} />)}
              </SidebarListBody>
            </SidebarListTable>
          </div>
        </div></TablePrecisionMenu>
      )}
    </>
  );
}

function PdPositionRow({ row, columns, precision }: { row: GenericTableRow; columns: GenericTableColumn[]; precision: InspectorSpeculumPrecision }) {
  return <SidebarListRow>
    {columns.map((column, index) => <PdPositionCell key={column.id} column={column.id}
      cell={row.cells[index]} precision={precision} outOfBounds={column.id === "decl" && row.meta?.declinationOutOfBounds === true} />)}
  </SidebarListRow>;
}

function PdPositionCell({ column, cell, outOfBounds, precision }: { column: string; cell?: GenericTableCell; outOfBounds: boolean; precision: InspectorSpeculumPrecision }) {
  const text = tableCellText(cell, { preserveAngleSeconds: true });
  return (
    <SidebarListCell title={text} aria-label={text} className={column === "body" ? "text-left" : `text-right tabular-nums${outOfBounds ? " text-destructive" : ""}`}>
      {column === "lon" || column === "lat" || column === "ra" || column === "decl" ? <InspectorSpeculumAngle cell={cell} column={column} precision={precision} />
        : column === "speed" ? <InspectorSpeculumSpeed cell={cell} precision={precision} />
          : column === "body" ? <span className="inline-flex items-baseline gap-[var(--aries-control-gap-compact)]">
            {cell?.glyph ? <CellView cell={{ glyph: cell.glyph, color: cell.color, colorRole: cell.colorRole }} /> : null}
            <span className="aries-inspector-speculum-body-label"
              data-long-word={/\p{L}{8,}|[\p{sc=Han}\p{sc=Hira}\p{sc=Kana}ー]{6,}/u.test(text) || undefined}>
              {text}{cell?.voidOfCourse ? <VoidOfCourseSuffix /> : null}
            </span>
          </span> : <CellView cell={cell} preserveAngleSeconds />}
    </SidebarListCell>
  );
}
