// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

"use client";

import * as React from "react";
import { ArrowDownRight, ArrowUpRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  corpusDisciplinesCached,
  fetchAlerts,
  fetchGenericTablePayload,
  fetchInspectorPayload,
  fetchPassages,
  invalidateCorpusDisciplines,
  type CorpusDiscipline,
  type GenericTableCell,
  type GenericTablePayload,
  type InspectorAlert,
  type InspectorAlertsPayload,
  type InspectorAspectItem,
  type InspectorDignityItem,
  type InspectorLunarExactState,
  type InspectorManzil,
  type InspectorPassagesPayload,
  type InspectorPassageParagraph,
  type InspectorPassageRun,
  type InspectorPassageSection,
  type InspectorPayload,
  type InspectorLensPayload,
  type RGB,
  workspaceMirrorLens,
} from "@/lib/daemon/client";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import { isAbortError } from "@/lib/abort-error";
import {
  getCachedGenericTablePayload,
  rememberGenericTablePayload,
} from "@/lib/table/payload-cache";
import {
  useWorkspaceStore,
  type HoverRegion,
  type WorkspaceDocument,
} from "@/stores/workspace-store";
import {
  findDaemonRadixAncestor,
  useDaemonWorkspaceView,
} from "@/stores/daemon-workspace-adapter";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { cn } from "@/lib/utils";
import {
  useSettledWorkspaceRefreshSeq,
  useStepSettledValue,
  type WorkspaceOptionsChange,
  type WorkspaceSessionChange,
} from "./step-refresh";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useLocale, useT, useTFallback } from "@/lib/i18n/i18n";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { CellView } from "./generic-table-view";
import { tableCellText } from "./table-text-export";

const INSPECTOR_PAYLOAD_KINDS = new Set([
  "planet",
  "vertex",
  "fortune",
  "syzygy",
  "eclipse",
  "angle",
  "house",
  "sign",
  "secondary_ring",
  "aspect",
  "drishti",
  "pd_event",
]);

const TEXT_BASE = "text-[length:var(--aries-font-size-base)]";
const TEXT_READING = "text-[length:var(--aries-font-size-reading)]";
const TEXT_SMALL = "text-[length:var(--aries-font-size-small)]";
const TEXT_SECTION = "text-[length:var(--aries-font-size-section)]";
const TEXT_ARABIC = "text-[length:var(--aries-font-size-arabic)]";
const INSPECTOR_TITLE_TEXT = "text-[length:var(--aries-inspector-title-size)]";
const INSPECTOR_GLYPH_TEXT = "text-[length:var(--aries-inspector-glyph-size)]";
const INSPECTOR_ALERT_GLYPH_TEXT = "text-[length:var(--aries-inspector-alert-glyph-size)]";
const INSPECTOR_TITLE_COLOR = "text-[color:var(--aries-inspector-title-color)]";
const INSPECTOR_STRONG_COLOR = "text-[color:var(--aries-inspector-strong-color)]";
const INSPECTOR_VALUE_COLOR = "text-[color:var(--aries-inspector-value-color)]";
const INSPECTOR_READING_COLOR = "text-[color:var(--aries-inspector-reading-color)]";
const INSPECTOR_LABEL_COLOR = "text-[color:var(--aries-inspector-label-color)]";
const INSPECTOR_MUTED_COLOR = "text-[color:var(--aries-inspector-muted-color)]";
const INSPECTOR_INTERACTIVE_COLOR = "text-[color:var(--aries-inspector-interactive-color)]";
const INSPECTOR_TERTIARY_COLOR = "text-[color:var(--aries-inspector-tertiary-color)]";
const INSPECTOR_DIVIDER_BORDER = "border-[color:var(--aries-inspector-divider-color)]";
const INSPECTOR_SECTION_BOX =
  "border-t border-[color:var(--aries-inspector-divider-color)] px-[var(--aries-inspector-padding-x)] pb-[var(--aries-inspector-padding-bottom)] pt-[var(--aries-inspector-padding-top)]";
const INSPECTOR_WRAP_STYLE: React.CSSProperties = {
  overflowWrap: "anywhere",
  wordBreak: "normal",
};

function isDaemonStatusError(err: unknown, prefix: string, status: number): boolean {
  return err instanceof Error && err.message.startsWith(`${prefix}: ${status}`);
}

type HoraryLensMirrorQueue = {
  enqueue: (documentId: string, lens: InspectorLensPayload | null) => Promise<void>;
  flush: (documentId: string) => Promise<void>;
};

export type LatestWinsWriteResult<Input, Output> =
  | { committed: true; input: Input; output: Output; revision: number }
  | { committed: false; input: Input; revision: number };

export type LatestWinsWriteQueue<Input, Output> = {
  enqueue: (input: Input) => Promise<LatestWinsWriteResult<Input, Output>>;
  isIdle: () => boolean;
  revision: () => number;
};

function lensSemanticKey(lens: InspectorLensPayload | null): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return value;
  };
  return JSON.stringify(normalize(lens));
}

/**
 * Marks a store mutation as document adoption so the lens-keyed mirror effect
 * can consume it without writing it back. Adoption is navigation, not an edit;
 * the guard intentionally follows the adopted value even if a rapid tab switch
 * changes the active document before React performs the follow-up render.
 */
export function createHoraryLensAdoptionGuard() {
  let pendingLensKey: string | null = null;
  return {
    mark(lens: InspectorLensPayload): void {
      pendingLensKey = lensSemanticKey(lens);
    },
    consumeIfAdopted(lens: InspectorLensPayload | null): boolean {
      if (pendingLensKey === null) return false;
      const adopted = pendingLensKey === lensSemanticKey(lens);
      pendingLensKey = null;
      return adopted;
    },
  };
}

/**
 * Serialize a replaceable setting write while retaining only the newest
 * waiting choice. A completion is canonical only when no newer choice arrived
 * while it was in flight; callers therefore cannot publish stale response
 * state or trigger consumers from an obsolete selection.
 */
export function createLatestWinsWriteQueue<Input, Output>(
  write: (input: Input) => Promise<Output>,
): LatestWinsWriteQueue<Input, Output> {
  type Pending = {
    input: Input;
    revision: number;
    resolve: (result: LatestWinsWriteResult<Input, Output>) => void;
    reject: (reason: unknown) => void;
  };

  let pending: Pending | null = null;
  let running = false;
  let requestedRevision = 0;

  const pump = async () => {
    if (running) return;
    running = true;
    while (pending) {
      const current = pending;
      pending = null;
      try {
        const output = await write(current.input);
        if (pending) {
          current.resolve({
            committed: false,
            input: current.input,
            revision: current.revision,
          });
        } else {
          current.resolve({
            committed: true,
            input: current.input,
            output,
            revision: current.revision,
          });
        }
      } catch (err) {
        if (pending) {
          current.resolve({
            committed: false,
            input: current.input,
            revision: current.revision,
          });
        } else {
          current.reject(err);
        }
      }
    }
    running = false;
  };

  return {
    enqueue: (input) => {
      requestedRevision += 1;
      return new Promise((resolve, reject) => {
        if (pending) {
          pending.resolve({
            committed: false,
            input: pending.input,
            revision: pending.revision,
          });
        }
        pending = { input, revision: requestedRevision, resolve, reject };
        void pump();
      });
    },
    isIdle: () => !running && pending === null,
    revision: () => requestedRevision,
  };
}

/**
 * Keep lens persistence ordered per horary chart. Fetch completion order is not
 * mutation order: without this queue, a slow earlier context POST can land
 * after a newer one and put stale interpretation state back on the daemon
 * chart. A rejected write is absorbed only by the sequencing tail so the next
 * mutation still runs; the caller still receives and reports that rejection.
 */
export function createHoraryLensMirrorQueue(
  write: (
    documentId: string,
    lens: InspectorLensPayload | null,
  ) => Promise<unknown>,
): HoraryLensMirrorQueue {
  const sequencingTails = new Map<string, Promise<void>>();
  const latestWrites = new Map<string, Promise<void>>();
  const failedLenses = new Map<string, InspectorLensPayload | null>();

  const enqueue = (
    documentId: string,
    lens: InspectorLensPayload | null,
  ): Promise<void> => {
    const previous = sequencingTails.get(documentId) ?? Promise.resolve();
    const writePromise = previous.then(() => write(documentId, lens).then(() => undefined));
    const settledTail = writePromise.catch(() => undefined);
    failedLenses.delete(documentId);
    sequencingTails.set(documentId, settledTail);
    latestWrites.set(documentId, writePromise);
    void settledTail.then(() => {
      if (sequencingTails.get(documentId) === settledTail) {
        sequencingTails.delete(documentId);
      }
    });
    void writePromise.then(
      () => {
        if (latestWrites.get(documentId) === writePromise) {
          latestWrites.delete(documentId);
          failedLenses.delete(documentId);
        }
      },
      () => {
        if (latestWrites.get(documentId) === writePromise) {
          latestWrites.delete(documentId);
          failedLenses.set(documentId, lens);
        }
      },
    );
    return writePromise;
  };

  return {
    enqueue,
    flush: (documentId) => {
      const pending = latestWrites.get(documentId);
      if (pending) return pending;
      if (failedLenses.has(documentId)) {
        return enqueue(documentId, failedLenses.get(documentId) ?? null);
      }
      return Promise.resolve();
    },
  };
}

const horaryLensMirrorQueue = createHoraryLensMirrorQueue(
  (documentId, lens) => workspaceMirrorLens(documentId, lens),
);

/** Await the canonical daemon mirror before a persistence boundary such as Save. */
export function flushHoraryLensMirror(documentId: string): Promise<void> {
  return horaryLensMirrorQueue.flush(documentId);
}

function snapshotDisplayDatetime(
  chart: ChartRenderSnapshot | null,
  activeDoc: WorkspaceDocument | null,
): string | null {
  return (
    chart?.document?.displayDatetime ??
    chart?.displayDatetime ??
    activeDoc?.displayDatetime ??
    null
  );
}

/**
 * Inspector pane — FAITHFUL translation of the wx WorkspaceInspectorPane hover
 * zone (workspace_shell.py:1376). The content is built ENTIRELY by
 * chartinspector.build_payload (chartinspector.py:922) and served by the daemon
 * at GET /api/inspector. This component fetches that payload on hover/pin and
 * renders it verbatim — header glyph+title+role, smart_rows summary, dignity
 * items (with colours + mutual reception), detail rows (label/value), and
 * aspect items (prefix + Morinus glyph + suffix, coloured). NO field is
 * re-derived client-side (the earlier stub that did so is deleted).
 *
 * Zone B (Valens source-text passages + pack alerts) renders BELOW Zone A,
 * keyed to the SAME active region + chart identity. Its content comes verbatim
 * from the daemon (GET /api/inspector/passages + /api/inspector/alerts); the
 * skin computes/fabricates nothing. Spec:
 * doc/migration/surfaces/inspector-zone-b.md.
 */
export function InspectorPanel({ chart }: { chart: ChartRenderSnapshot | null }) {
  const t = useT();
  const hovered = useWorkspaceStore((s) => s.hoveredRegion);
  const pinned = useWorkspaceStore((s) => s.inspectorActiveRegion);
  const setInspectorOpen = useFrameLayoutStore((s) => s.setInspectorOpen);
  const { documents, activeDocument: activeDoc, lastSessionChange } = useDaemonWorkspaceView();
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastOptionsChange);
  // A clicked inspector target is a real focus, not a hover fallback. Keep it
  // authoritative while the pointer and the stepped glyph move underneath it;
  // clicking another target or empty chart space still replaces/clears it.
  const region = pinned ?? hovered;
  const radixBranchId = findDaemonRadixAncestor(documents, activeDoc?.id ?? null)?.id ?? null;
  const snapshotDocumentId = chart?.document?.documentId ?? null;
  const speculumDocument = snapshotDocumentId
    ? documents.find((document) => document.id === snapshotDocumentId) ?? null
    : activeDoc;

  const payload = useInspectorPayload(
    region,
    activeDoc,
    chart,
    radixBranchId,
    lastSessionChange,
    lastOptionsChange,
  );
  const passages = usePassages(region, activeDoc, chart, radixBranchId);
  const alerts = useAlerts(activeDoc, chart, lastSessionChange);

  const closeInspector = React.useCallback(() => {
    useWorkspaceStore.getState().setInspectorActiveRegion(null);
    setInspectorOpen(false);
  }, [setInspectorOpen]);

  return (
    <aside
      data-aries-surface="inspector"
      className={cn("relative flex h-full w-full min-w-0 flex-col gap-0 overflow-y-auto bg-[var(--aries-inspector-background)]", INSPECTOR_VALUE_COLOR, TEXT_BASE)}
    >
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={closeInspector}
        aria-label={t("inspector.closeInspector")}
        className={cn("absolute right-[var(--aries-inspector-close-inset)] top-[var(--aries-inspector-close-inset)] z-10 hover:text-[color:var(--aries-inspector-title-color)]", INSPECTOR_INTERACTIVE_COLOR)}
      >
        <X className="size-[var(--aries-inspector-close-icon-size)]" />
      </Button>
      {region ? (
        <RegionPayload payload={payload} />
      ) : (
        <ChartSummary chart={chart} />
      )}
      {chart && speculumDocument ? (
        <InspectorSpeculum
          visible={!region}
          documentId={speculumDocument.id}
          parentDocumentId={speculumDocument.parentDocumentId}
          lastSessionChange={lastSessionChange}
          lastOptionsChange={lastOptionsChange}
        />
      ) : null}
      {/* Zone B — source-text passages (keyed to the active region) + pack
          alerts (keyed to the active chart's lens). Rendered verbatim. */}
      {region ? <PassagesZone passages={passages} /> : null}
      <InterpretationSelector />
      <AlertsZone alerts={alerts} />
    </aside>
  );
}

/**
 * Fetch the inspector payload for the current region from the daemon. Keyed on
 * the region's identity + the active doc's chart identity. Aborts in-flight
 * requests when the region changes (rapid hover).
 */
function useInspectorPayload(
  region: HoverRegion | null,
  activeDoc: WorkspaceDocument | null,
  chart: ChartRenderSnapshot | null,
  radixBranchId: string | null,
  lastSessionChange: WorkspaceSessionChange | null,
  lastOptionsChange: WorkspaceOptionsChange | null,
): InspectorPayload | null {
  const locale = useLocale();
  const [payloadState, setPayloadState] = React.useState<{
    identity: string;
    payload: InspectorPayload;
  } | null>(null);

  // Stable identity key so we only refetch when the meaningful inputs change.
  const objectId = region ? regionObjectId(region) : null;
  const kind = region?.kind ?? null;
  const sourceName = activeDoc?.sourceName ?? null;
  const hereNow = activeDoc?.kind === "here-now";
  const supplementaryKind = activeDoc?.supplementaryFeatureKind;
  const comparisonName = activeDoc?.comparisonSourceName;
  const viewMode = chart?.document?.viewMode;
  const deferSignals = chart?.overlayRenderMode === "step_fast";
  // Match ChartHoverFlag's live path: the POST-pushed step_fast snapshot is the
  // immediate cursor/binding source. The stable payload identity below keeps
  // the old focused card mounted until this request swaps in its new values.
  const when = snapshotDisplayDatetime(chart, activeDoc);
  const liveBinding = chart?.document?.binding ?? activeDoc?.supplementaryBinding;
  const bindingJson = liveBinding
    ? JSON.stringify(liveBinding)
    : null;
  const docId = activeDoc?.id ?? undefined;
  const chartRole = region && "chartRole" in region ? region.chartRole : undefined;
  const ringIndex = region && "ringIndex" in region ? region.ringIndex : undefined;
  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId: docId ?? "",
    lastSessionChange,
    lastOptionsChange,
    refreshOnInspectorDataChange: true,
  });

  const canFetch = Boolean(
    region && kind && INSPECTOR_PAYLOAD_KINDS.has(kind) && objectId != null && sourceName,
  );
  const primaryChartIdentity = stableRenderChartIdentity(chart?.primaryChart);
  const partnerSensitive =
    chartRole === "outer"
    || ringIndex != null
    || region?.kind === "pd_event"
    || (region?.kind === "aspect" && region.scope === "interchart");
  // Sibling biwheels share their inner chart, so only outer/interchart regions
  // need the changing child document in their retained-content identity.
  const inspectedChartIdentity = partnerSensitive
    ? [radixBranchId, docId ?? null, primaryChartIdentity, stableRenderChartIdentity(chart?.comparisonChart)]
    : [radixBranchId, primaryChartIdentity];
  const payloadIdentity = canFetch
    ? JSON.stringify([
        inspectedChartIdentity,
        kind,
        objectId,
        chartRole ?? null,
        ringIndex ?? null,
        locale,
      ])
    : null;

  React.useEffect(() => {
    if (!canFetch || !payloadIdentity || !kind || objectId == null || !sourceName) return;
    const controller = new AbortController();
    const binding = bindingJson ? JSON.parse(bindingJson) : undefined;
    fetchInspectorPayload(
      {
        kind,
        objectId,
        docId,
        chartRole,
        ringIndex,
        name: sourceName,
        hereNow,
        // Synastry passes a comparison ring; transit/SR/etc pass the feature
        // kind. Synastry's feature kind is "synastry" (not a supplementary
        // chart build) — the comparisonName alone drives the partner ring.
        supplementaryKind:
          supplementaryKind && supplementaryKind !== "synastry" ? supplementaryKind : undefined,
        comparisonName: comparisonName ?? undefined,
        viewMode,
        when: when ?? undefined,
        binding,
        deferSignals,
      },
      controller.signal,
    )
      .then((payload) => {
        if (controller.signal.aborted) return;
        setPayloadState((current) => ({
          identity: payloadIdentity,
          payload: retainDeferredInspectorSlots(
            current?.identity === payloadIdentity ? current.payload : null,
            payload,
          ),
        }));
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        if (isDaemonStatusError(err, "inspector request failed", 404)) {
          setPayloadState((current) =>
            current?.identity === payloadIdentity ? null : current,
          );
          return;
        }
        console.error("[inspector]", err);
      });
    // Stale-while-refresh: keep the complete previous object visible while a
    // newly clicked object loads, then swap the daemon payload in one commit.
    // This is retained inspector chrome, so an identity change must not expose
    // the empty hint or collapse the pane between the click and response.
    return () => controller.abort();
  }, [canFetch, payloadIdentity, kind, objectId, docId, chartRole, ringIndex, sourceName, hereNow, supplementaryKind, comparisonName, viewMode, when, bindingJson, deferSignals, refreshSeq]);

  return canFetch ? payloadState?.payload ?? null : null;
}

/**
 * Step-fast keeps the previous expensive semantic slot visible while every
 * cheap inspector field continues to update from the live stepped chart.
 */
function retainDeferredInspectorSlots(
  current: InspectorPayload | null,
  next: InspectorPayload,
): InspectorPayload {
  let retained = next;
  if (next.deferred_slots?.includes("phasis") && current?.phasis_row) {
    const phasisRow = current.phasis_row;
    retained = {
      ...retained,
      phasis_row: phasisRow,
      smart_rows: [...retained.smart_rows, phasisRow],
      rows: [...(retained.rows ?? retained.smart_rows), phasisRow],
    };
  }
  if (next.deferred_slots?.includes("stations") && current?.station_rows?.length) {
    const stationRows = current.station_rows;
    retained = {
      ...retained,
      station_rows: stationRows,
      detail_rows: [...(retained.detail_rows ?? []), ...stationRows],
    };
  }
  return retained;
}

/**
 * Identity of the chart being inspected, deliberately excluding its datetime.
 * Time is refresh data, not object identity: including it made every step hide
 * the focused payload until the replacement request completed.
 */
function stableRenderChartIdentity(
  chart: ChartRenderSnapshot["primaryChart"] | null | undefined,
): readonly unknown[] | null {
  if (!chart) return null;
  const { meta } = chart;
  return [meta.name, meta.kind, meta.place, meta.latitude, meta.longitude];
}

/** Region → the object_id the daemon route expects (planet SE id / angle key). */
function regionObjectId(region: HoverRegion): string | null {
  if (region.kind === "planet") return String(region.seId);
  if (region.kind === "vertex") return "vertex";
  if (region.kind === "fortune") return "fortune";
  if (region.kind === "syzygy") return "syzygy";
  if (region.kind === "eclipse") return "eclipse";
  if (region.kind === "angle") return region.angleId;
  if (region.kind === "house") return String(region.houseIndex);
  if (region.kind === "sign") return String(region.signIndex);
  // Daemon rebuilds graphchart's secondary_ring data dict from family +
  // longitude (fixstar nature / formula lookup) + label (title).
  if (region.kind === "secondary_ring") {
    return `${region.family}|${region.longitude}|${region.label}`;
  }
  // Daemon recomputes the Asp via the same accessors export_aspects used.
  if (region.kind === "aspect") {
    if (region.scope === "interchart") {
      return `interchart:${region.p1}:${region.p2}:${region.aspectType}`;
    }
    return `${region.p1}:${region.p2}:${region.aspectType}`;
  }
  if (region.kind === "drishti") return region.relationId;
  if (region.kind === "pd_event") return region.eventId;
  return null;
}

/**
 * Fetch the Zone B Valens definition for the current region — keyed to the SAME
 * region identity + chart identity Zone A uses. Aborts in-flight requests on
 * region change.
 */
function usePassages(
  region: HoverRegion | null,
  activeDoc: WorkspaceDocument | null,
  chart: ChartRenderSnapshot | null,
  radixBranchId: string | null,
): InspectorPassagesPayload | null {
  const locale = useLocale();
  const packsVersion = useWorkspaceStore((state) => state.packsVersion);
  const [passagesState, setPassagesState] = React.useState<{
    identity: string;
    passages: InspectorPassagesPayload;
  } | null>(null);

  const objectId = region ? regionObjectId(region) : null;
  const kind = region?.kind ?? null;
  const sourceName = activeDoc?.sourceName ?? null;
  const hereNow = activeDoc?.kind === "here-now";
  const supplementaryKind = activeDoc?.supplementaryFeatureKind;
  const comparisonName = activeDoc?.comparisonSourceName;
  const viewMode = chart?.document?.viewMode;
  const bindingJson = activeDoc?.supplementaryBinding
    ? JSON.stringify(activeDoc.supplementaryBinding)
    : null;
  const docId = activeDoc?.id ?? undefined;
  const chartRole = region && "chartRole" in region ? region.chartRole : undefined;
  const ringIndex = region && "ringIndex" in region ? region.ringIndex : undefined;
  // Inspector source text is standing content. A live document id already
  // resolves the current session chart, so its changing cursor must not refetch
  // and rerender the passage on every step. The fallback loader still needs a
  // datetime when no live document exists.
  const when = docId ? undefined : snapshotDisplayDatetime(chart, activeDoc);

  const canFetch = Boolean(
    region
    && region.kind !== "pd_event"
    && kind
    && objectId != null
    && sourceName,
  );
  const passagesIdentity = canFetch
    ? JSON.stringify([radixBranchId, kind, objectId, chartRole, ringIndex, locale, packsVersion])
    : null;

  React.useEffect(() => {
    if (!canFetch || !passagesIdentity || !kind || objectId == null || !sourceName) return;
    const controller = new AbortController();
    const binding = bindingJson ? JSON.parse(bindingJson) : undefined;
    fetchPassages(
      {
        kind,
        objectId,
        docId,
        chartRole,
        ringIndex,
        name: sourceName,
        hereNow,
        supplementaryKind:
          supplementaryKind && supplementaryKind !== "synastry" ? supplementaryKind : undefined,
        comparisonName: comparisonName ?? undefined,
        viewMode,
        when: when ?? undefined,
        binding,
      },
      controller.signal,
    )
      .then((passages) => {
        if (controller.signal.aborted) return;
        setPassagesState({ identity: passagesIdentity, passages });
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        if (isDaemonStatusError(err, "passages request failed", 404)) {
          setPassagesState((current) =>
            current?.identity === passagesIdentity ? null : current,
          );
          return;
        }
        console.error("[inspector:passages]", err);
      });
    return () => controller.abort();
  }, [canFetch, passagesIdentity, kind, objectId, docId, chartRole, ringIndex, sourceName, hereNow, supplementaryKind, comparisonName, viewMode, when, bindingJson]);

  // Keep the standing source section mounted across a planet-to-planet swap;
  // the matching replacement arrives with the Zone A payload instead of the
  // lower inspector disappearing and reappearing around the request.
  return canFetch ? passagesState?.passages ?? null : null;
}

/**
 * Fetch Zone B pack alerts for the active chart's interpretation lens. Keyed to
 * the chart identity + the presentation lens (discipline/theme/context) — NOT
 * the hovered region (alerts are chart-wide, not body-specific). No lens → no
 * fetch (the daemon returns an empty list anyway; matches the wx oracle).
 */
function useAlerts(
  activeDoc: WorkspaceDocument | null,
  chart: ChartRenderSnapshot | null,
  lastSessionChange: WorkspaceSessionChange | null,
): InspectorAlertsPayload | null {
  const lens = useWorkspaceStore((s) => s.inspectorLens);
  // Refetch when the daemon-side active-pack filter changes (pack toggle) —
  // wx re-fires the interpretation callback in _on_pack_toggled
  // (workspace_shell.py:2566-2569) for the same reason.
  const packsVersion = useWorkspaceStore((s) => s.packsVersion);
  const semanticProfileVersion = useWorkspaceStore(
    (s) => s.semanticProfileVersion,
  );
  const [alertsState, setAlertsState] = React.useState<{
    identity: string;
    alerts: InspectorAlertsPayload;
  } | null>(null);

  const discipline = lens?.discipline ?? null;
  const theme = lens?.theme ?? null;
  const context = lens?.context;
  const sourceName = activeDoc?.sourceName ?? null;
  const hereNow = activeDoc?.kind === "here-now";
  const supplementaryKind = activeDoc?.supplementaryFeatureKind;
  const viewMode = chart?.document?.viewMode;
  const when = useStepSettledValue(
    snapshotDisplayDatetime(chart, activeDoc),
    activeDoc?.id ?? null,
    lastSessionChange,
  );
  const bindingJson = activeDoc?.supplementaryBinding
    ? JSON.stringify(activeDoc.supplementaryBinding)
    : null;
  // Session-truth chart resolution — same as usePassages. Without it, alerts
  // 404 for any document whose name-based file lookup fails (edited/unsaved,
  // derived, or renamed charts; inspector_service.resolve_chart docstring).
  const docId = activeDoc?.id ?? undefined;
  // Full wx refresh matrix for pack alerts (morin._refresh_pack_alerts call
  // sites): step-settled (morin.py:3520-3532), every non-step session change
  // on the active doc (morin.py:8946-8947), and any chart-invalidating options
  // change (morin.py:3435-3439). `when` alone misses session changes that keep
  // the cursor (variant/rebind/edit) and all options changes (house system!).
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastOptionsChange);
  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId: docId ?? "",
    lastSessionChange,
    lastOptionsChange,
  });

  const canFetch = Boolean(discipline && theme && (sourceName || docId));
  const alertsIdentity = canFetch
    ? JSON.stringify([docId ?? sourceName, discipline, theme, context ?? null])
    : null;

  React.useEffect(() => {
    if (!canFetch || !alertsIdentity || !discipline || !theme || (!sourceName && !docId)) return;
    const controller = new AbortController();
    const binding = bindingJson ? JSON.parse(bindingJson) : undefined;
    fetchAlerts(
      {
        discipline,
        theme,
        context,
        docId,
        name: sourceName ?? "Morinus",
        hereNow,
        supplementaryKind:
          supplementaryKind && supplementaryKind !== "synastry" ? supplementaryKind : undefined,
        viewMode,
        when: when ?? undefined,
        binding,
      },
      controller.signal,
    )
      .then((alerts) => setAlertsState({ identity: alertsIdentity, alerts }))
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        if (isDaemonStatusError(err, "alerts request failed", 404)) {
          setAlertsState((current) =>
            current?.identity === alertsIdentity ? null : current,
          );
          return;
        }
        console.error("[inspector:alerts]", err);
      });
    // Preserve the current cards during same-chart refreshes. Removing them in
    // cleanup collapsed the lower inspector and made the whole pane jump.
    return () => controller.abort();
  }, [canFetch, alertsIdentity, discipline, theme, context, docId, sourceName, hereNow, supplementaryKind, viewMode, when, bindingJson, packsVersion, semanticProfileVersion, refreshSeq]);

  return canFetch && alertsState?.identity === alertsIdentity
    ? alertsState.alerts
    : null;
}

/**
 * Corpus rule-pack toggles — web twin of the wx inspector pack strip
 * (workspace_shell.py:2455 _populate_pack_toggles): one checkbox per pack,
 * display name shown, pack id as tooltip, checked == pack in the global
 * active filter. The filter itself lives in the daemon (rule_engine); each
 * toggle POSTs the flip and the daemon applies the preserve-others /
 * collapse-to-all semantics and persists (morin.py:9005). When a lens
 * discipline is selected the list is scoped to it (packs_for_discipline,
 * workspace_shell.py:2472); with no lens all packs are shown so the surface
 * stays reachable through the compact interpretation selector below.
 */
/**
 * Keep only the quick discipline/theme selector in the inspector. Semantic
 * profile definitions and question-specific context controls belong to
 * Settings > Interpretation; both surfaces mutate the same canonical lens.
 */
const InterpretationSelector = React.memo(function InterpretationSelector() {
  const t = useT();
  const lens = useWorkspaceStore((state) => state.inspectorLens);
  const packsVersion = useWorkspaceStore((state) => state.packsVersion);
  const [catalog, setCatalog] = React.useState<CorpusDiscipline[] | null>(null);
  const [pickedDiscipline, setPickedDiscipline] = React.useState("");
  const [previousLensDiscipline, setPreviousLensDiscipline] = React.useState<string | null>(null);
  const lensDiscipline = lens?.discipline ?? null;

  if (lensDiscipline !== previousLensDiscipline) {
    setPreviousLensDiscipline(lensDiscipline);
    if (lensDiscipline) setPickedDiscipline(lensDiscipline);
  }

  React.useEffect(() => {
    let cancelled = false;
    if (packsVersion > 0) invalidateCorpusDisciplines();
    corpusDisciplinesCached()
      .then((payload) => {
        if (!cancelled) setCatalog(payload.disciplines);
      })
      .catch((error) => console.error("[inspector:disciplines]", error));
    return () => {
      cancelled = true;
    };
  }, [packsVersion]);

  if (!catalog?.length) return null;

  const discipline = pickedDiscipline;
  const themes = catalog.find((item) => item.slug === discipline)?.themes ?? [];
  const activeTheme = themes.find(
    (theme) => theme.label === lens?.theme || theme.aliases.includes(lens?.theme ?? ""),
  );
  const selectClass = cn(
    "h-[var(--aries-control-height-compact)] min-w-0 flex-1 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-transparent px-[var(--aries-control-gap)] outline-none",
    INSPECTOR_VALUE_COLOR,
    TEXT_SMALL,
  );

  const selectDiscipline = (slug: string) => {
    setPickedDiscipline(slug);
    useWorkspaceStore.getState().setInspectorLens(null);
  };
  const selectTheme = (label: string) => {
    if (!discipline || !label) {
      useWorkspaceStore.getState().setInspectorLens(null);
      return;
    }
    const theme = themes.find((item) => item.label === label);
    useWorkspaceStore.getState().setInspectorLens({
      discipline,
      theme: label,
      context: theme?.defaultContext ?? undefined,
    });
  };

  return (
    <div className={INSPECTOR_SECTION_BOX}>
      <SectionLabel>{t("inspector.interpretation")}</SectionLabel>
      <div className="flex items-center gap-[var(--aries-inspector-heading-gap)]">
        <select
          data-aries-control-appearance="local"
          aria-label={t("inspector.discipline")}
          className={selectClass}
          value={discipline}
          onChange={(event) => selectDiscipline(event.target.value)}
        >
          <option value="">—</option>
          {catalog.map((item) => (
            <option key={item.slug} value={item.slug}>{item.displayName}</option>
          ))}
        </select>
        <select
          data-aries-control-appearance="local"
          aria-label={t("inspector.theme")}
          className={selectClass}
          value={lens?.discipline === discipline ? activeTheme?.label ?? "" : ""}
          disabled={!discipline}
          onChange={(event) => selectTheme(event.target.value)}
        >
          <option value="">—</option>
          {themes.map((theme) => (
            <option key={theme.label} value={theme.label} title={theme.tooltip || undefined}>
              {theme.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
});

/**
 * Horary lens persistence — the interpretation round-trip (slice 4).
 *
 * Adoption (wx _adopt_lens_for_active_chart, morin.py:9073-9083): when the
 * ACTIVE document changes and the new doc is horary AND carries a saved
 * `chrt.interpretation`, hoist it into the global lens. Non-horary docs and
 * horary docs without a saved question leave the lens alone — it is a global
 * cursor that follows the user.
 *
 * Mirror (wx _mirror_lens_to_horary_session, morin.py:9062-9071): every lens
 * MUTATION (theme pick, context change, clear) is forwarded to the daemon,
 * which writes it onto the active horary chart so Save round-trips the
 * question (chartfile.py:154-165). wx mirrors only on explicit lens changes,
 * never on tab switch — so the effect keys on the lens value alone and reads
 * the active doc through a ref.
 */
export function useHoraryLensPersistence(activeDoc: WorkspaceDocument | null) {
  const lens = useWorkspaceStore((s) => s.inspectorLens);
  const docRef = React.useRef(activeDoc);
  const [adoptionGuard] = React.useState(createHoraryLensAdoptionGuard);
  const docId = activeDoc?.id ?? null;
  // Keep the latest active doc readable from the lens-keyed mirror effect
  // without making it a dependency (wx never mirrors on tab switch). Declared
  // FIRST so it runs before the adoption/mirror effects below.
  React.useLayoutEffect(() => {
    docRef.current = activeDoc;
  });

  React.useLayoutEffect(() => {
    const doc = docRef.current;
    if (!doc || doc.id !== docId) return;
    if (doc.isHorary && doc.interpretation) {
      const adoptedLens = {
        discipline: doc.interpretation.discipline,
        theme: doc.interpretation.theme,
        context: doc.interpretation.context ?? undefined,
      };
      const currentLens = useWorkspaceStore.getState().inspectorLens;
      if (lensSemanticKey(currentLens) === lensSemanticKey(adoptedLens)) return;
      adoptionGuard.mark(adoptedLens);
      useWorkspaceStore.getState().setInspectorLens(adoptedLens);
    }
  }, [adoptionGuard, docId]);

  // Skip the mount run: mirroring the initial (possibly null) lens would
  // wrongly clear a saved question before adoption lands.
  const mirrorReady = React.useRef(false);
  // Register the pending mirror in the same commit as the picker change. Save
  // may be the very next native command, so a passive effect is too late to be
  // a reliable persistence boundary.
  React.useLayoutEffect(() => {
    if (!mirrorReady.current) {
      mirrorReady.current = true;
      return;
    }
    const doc = docRef.current;
    if (!doc?.isHorary) return;
    if (adoptionGuard.consumeIfAdopted(lens ?? null)) return;
    horaryLensMirrorQueue.enqueue(doc.id, lens ?? null).catch((err) =>
      console.error("[inspector:lens-mirror]", err),
    );
  }, [adoptionGuard, lens]);
}

function RegionPayload({ payload }: { payload: InspectorPayload | null }) {
  const t = useT();
  if (!payload) {
    return <div className={cn("px-[var(--aries-inspector-padding-x)] pb-[var(--aries-inspector-padding-bottom)]", INSPECTOR_LABEL_COLOR, TEXT_SMALL)}>{t("inspector.hover")}</div>;
  }

  const accent = semanticChartColor(payload.accentRole, rgb(payload.accent)) ?? null;
  const dignityItems = payload.dignity_items ?? [];
  const detailRows = payload.detail_rows ?? [];
  const aspectItems = payload.aspect_items ?? [];
  const meta = payload.meta?.trim() ?? "";
  const showMeta = meta.length > 0 && meta.toLowerCase() !== "secondary ring";
  const lunarConditions = payload.lunar_conditions;
  const exactLunarLabels = lunarConditions
    ? lunarConditions.exact_states
        .map((state) => LUNAR_EXACT_STATE_KEYS[state])
        .filter((key): key is string => Boolean(key))
        .map((key) => t(key))
    : [];
  const atLongitudeSpeedExtremum =
    lunarConditions?.exact_states.some(
      (state) => state === "slowest" || state === "fastest",
    ) ?? false;
  const atLatitudeBending =
    lunarConditions?.exact_states.some(
      (state) => state === "north_bending" || state === "south_bending",
    ) ?? false;
  const lunarIncreasingItems: string[] = [];
  const lunarDecreasingItems: string[] = [];
  if (lunarConditions) {
    const addCondition = (increasing: boolean, label: string) => {
      (increasing ? lunarIncreasingItems : lunarDecreasingItems).push(label);
    };
    addCondition(
      lunarConditions.increasing_in_light,
      t("lunarCondition.light"),
    );
    if (!atLatitudeBending) {
      addCondition(
        lunarConditions.increasing_in_latitude,
        t("lunarCondition.latitude"),
      );
    }
    if (!atLongitudeSpeedExtremum) {
      addCondition(
        lunarConditions.increasing_in_number,
        t("lunarCondition.speed"),
      );
    }
  }
  const lunarConditionGroups = [
    ...(lunarIncreasingItems.length
      ? [
          t("lunarCondition.increasingGroup", {
            items: lunarIncreasingItems.join(", "),
          }),
        ]
      : []),
    ...(lunarDecreasingItems.length
      ? [
          t("lunarCondition.decreasingGroup", {
            items: lunarDecreasingItems.join(", "),
          }),
        ]
      : []),
  ];
  const lunarSpeedStatus = lunarConditions
    ? {
        label: lunarConditions.swift
          ? t("lunarCondition.swift")
          : t("lunarCondition.slow"),
        color: lunarConditions.swift
          ? "var(--aries-status-good)"
          : "var(--aries-status-avoid)",
        trend: !atLongitudeSpeedExtremum
          ? {
              direction: lunarConditions.increasing_in_number
                ? ("up" as const)
                : ("down" as const),
              label: lunarConditions.increasing_in_number
                ? t("lunarCondition.increasingGroup", {
                    items: t("lunarCondition.speed"),
                  })
                : t("lunarCondition.decreasingGroup", {
                    items: t("lunarCondition.speed"),
                  }),
            }
          : undefined,
      }
    : undefined;
  const summaryRows = [
    ...payload.smart_rows,
    ...(exactLunarLabels.length ? [exactLunarLabels.join(" · ")] : []),
    ...(lunarConditionGroups.length ? [lunarConditionGroups.join(" · ")] : []),
  ];

  return (
    <div className="flex flex-col gap-0 px-[var(--aries-inspector-padding-x)] pb-[var(--aries-inspector-padding-bottom)] pt-[var(--aries-inspector-padding-top)]">
      <InspectorIdentityHeader
        glyph={payload.glyph}
        title={payload.title}
        motionGlyph={payload.motionGlyph ?? ""}
        motionUsesSymbolFont={Boolean(payload.motionUsesSymbolFont)}
        motionLabel={payload.motionLabel ?? ""}
        meta={showMeta ? meta : null}
        accent={accent}
      />

      {/* Summary block — smart_rows, in order. */}
      {summaryRows.length ? (
        <div className="mt-[var(--aries-inspector-section-gap)] flex flex-col gap-[var(--aries-inspector-row-gap)]">
          {summaryRows.map((row, i) => (
            <div key={`smart-${i}`} className={cn("tabular-nums leading-snug", INSPECTOR_VALUE_COLOR, TEXT_BASE)} style={INSPECTOR_WRAP_STYLE}>
              {row}
            </div>
          ))}
        </div>
      ) : null}

      {payload.manzil ? <ManzilSummary manzil={payload.manzil} /> : null}

      {/* Dignity block. */}
      {dignityItems.length ? (
        <>
          <Divider />
          <div className="flex flex-col gap-[var(--aries-inspector-row-gap)]">
            {dignityItems.map((item, i) => (
              <DignityRow key={`dig-${i}`} item={item} />
            ))}
          </div>
        </>
      ) : null}

      {/* Detail rows + aspect items. */}
      {detailRows.length || aspectItems.length ? (
        <>
          <Divider />
          <div className="flex min-w-0 gap-[var(--aries-inspector-column-gap)]">
            {detailRows.length ? (
              <div className="flex min-w-0 flex-1 flex-col gap-[var(--aries-inspector-row-gap)]">
                {detailRows.map((row, i) => (
                  <DetailRow
                    key={`det-${i}`}
                    text={row}
                    status={i === 0 ? lunarSpeedStatus : undefined}
                  />
                ))}
              </div>
            ) : null}
            {aspectItems.length ? (
              <div className="flex min-w-0 flex-1 flex-col gap-[var(--aries-inspector-row-gap)]">
                {aspectItems.map((item, i) => (
                  <AspectRow key={`asp-${i}`} item={item} />
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

const LUNAR_EXACT_STATE_KEYS: Record<InspectorLunarExactState, string> = {
  slowest: "lunarCondition.slowest",
  fastest: "lunarCondition.fastest",
  north_bending: "lunarCondition.northBending",
  south_bending: "lunarCondition.southBending",
};

/** Stable focused-object chrome; React skips it while only live rows change. */
const InspectorIdentityHeader = React.memo(function InspectorIdentityHeader({
  glyph,
  title,
  motionGlyph,
  motionUsesSymbolFont,
  motionLabel,
  meta,
  accent,
}: {
  glyph: string;
  title: string;
  motionGlyph: string;
  motionUsesSymbolFont: boolean;
  motionLabel: string;
  meta: string | null;
  accent: string | null;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-[var(--aries-inspector-heading-gap)] pr-[var(--aries-inspector-close-reserve)]">
      {glyph ? (
        <span
          className={cn("shrink-0 leading-none", INSPECTOR_GLYPH_TEXT)}
          style={{ fontFamily: "'AriesMorinus'", color: accent ?? undefined }}
          aria-hidden
        >
          {glyph}
        </span>
      ) : null}
      <span
        className={cn("min-w-0 font-semibold tracking-tight", INSPECTOR_TITLE_COLOR, INSPECTOR_TITLE_TEXT)}
        style={INSPECTOR_WRAP_STYLE}
      >
        {title}
      </span>
      {motionGlyph ? (
        <span
          className={cn("shrink-0 leading-none", INSPECTOR_LABEL_COLOR, TEXT_BASE)}
          style={{
            fontFamily:
              motionUsesSymbolFont ? "var(--aries-font-symbols)" : undefined,
            color: accent ?? undefined,
          }}
          aria-label={motionLabel || undefined}
          title={motionLabel || undefined}
        >
          {motionGlyph}
        </span>
      ) : null}
      {meta ? (
        <span className={cn("shrink-0", INSPECTOR_LABEL_COLOR, TEXT_SECTION)}>{meta}</span>
      ) : null}
    </div>
  );
});

function ManzilSummary({ manzil }: { manzil: InspectorManzil }) {
  const t = useT();
  const gloss = t(manzil.gloss_key);
  return (
    <div className={cn("mt-[var(--aries-inspector-section-gap)] border-t pt-[var(--aries-inspector-section-gap)]", INSPECTOR_DIVIDER_BORDER)}>
      <div className="flex min-w-0 items-start gap-[var(--aries-inspector-column-gap)]">
        <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-[var(--aries-inspector-padding-top)] gap-y-[var(--aries-inspector-row-gap)]">
          <span className={cn("tabular-nums", INSPECTOR_MUTED_COLOR, TEXT_BASE)}>
            {manzil.label} {manzil.index} · {manzil.degree_within}
          </span>
          <span
            lang="ar"
            dir="rtl"
            className={cn("justify-self-start leading-none", INSPECTOR_STRONG_COLOR, TEXT_ARABIC)}
            style={{ fontFamily: "'AriesArabicAcademic'" }}
          >
            {manzil.name_ar}
          </span>
          <span />
          <span className={cn("min-w-0", INSPECTOR_READING_COLOR, TEXT_SECTION)} style={INSPECTOR_WRAP_STYLE}>
            {manzil.name_translit}
          </span>
        </div>
        <span
          className={cn("min-w-0 flex-1 truncate text-left", INSPECTOR_MUTED_COLOR, TEXT_SECTION)}
          title={gloss}
        >
          {gloss}
        </span>
      </div>
    </div>
  );
}

/** A dignity item: labelled value (coloured) or a mutual-reception glyph pair. */
function DignityRow({ item }: { item: InspectorDignityItem }) {
  if (item.kind === "triplicity_lords") {
    return (
      <div className={cn("flex min-w-0 items-center gap-[var(--aries-inspector-heading-gap)]", TEXT_BASE)}>
        <span className={cn("w-[var(--aries-inspector-label-width)] shrink-0", INSPECTOR_LABEL_COLOR)}>{item.label}</span>
        <span className="flex min-w-0 items-center gap-[var(--aries-control-gap)]" aria-label={item.value_text}>
          {item.lords.map((lord, index) => (
            <span
              key={`${lord.planet_id}-${index}`}
              title={lord.name}
              className={cn("leading-none", lord.current && "font-semibold")}
              style={{
                fontFamily: "'AriesMorinus'",
                color: semanticChartColor(lord.colour_role, rgb(lord.colour)) ?? undefined,
              }}
              aria-hidden
            >
              {lord.glyph}
            </span>
          ))}
        </span>
      </div>
    );
  }
  if (item.kind === "mutual_reception") {
    return (
      <div className={cn("flex items-center gap-[var(--aries-control-gap-compact)]", TEXT_BASE)}>
        <span className={cn("w-[var(--aries-inspector-label-width)] shrink-0", INSPECTOR_LABEL_COLOR)}>{item.label ?? ""}</span>
        <span
          style={{
            fontFamily: "'AriesMorinus'",
            color: semanticChartColor(item.left_colour_role, rgb(item.left_colour)),
          }}
          aria-hidden
        >
          {item.left}
        </span>
        <span className={cn("px-[var(--aries-control-gap-compact)]", INSPECTOR_MUTED_COLOR)}>{item.arrow}</span>
        <span
          style={{
            fontFamily: "'AriesMorinus'",
            color: semanticChartColor(item.right_colour_role, rgb(item.right_colour)),
          }}
          aria-hidden
        >
          {item.right}
        </span>
      </div>
    );
  }
  const colour = semanticChartColor(item.colour_role, rgb(item.colour));
  return (
    <div className={cn("flex min-w-0 items-baseline gap-[var(--aries-inspector-heading-gap)]", TEXT_BASE)}>
      <span className={cn("w-[var(--aries-inspector-label-width)] shrink-0", INSPECTOR_LABEL_COLOR)}>{item.label}</span>
      <span className={cn("min-w-0", item.bold && "font-semibold")} style={{ color: colour ?? undefined, ...INSPECTOR_WRAP_STYLE }}>
        {item.value}
      </span>
    </div>
  );
}

/** A detail row: "Label: value" split on the first colon (matches the wx
 * FlexGrid split, workspace_shell.py:1760-1766); no-colon rows render whole. */
function DetailRow({
  text,
  status,
}: {
  text: string;
  status?: {
    label: string;
    color: string;
    trend?: {
      direction: "up" | "down";
      label: string;
    };
  };
}) {
  const idx = text.indexOf(":");
  if (idx === -1) {
    return <div className={cn("tabular-nums", INSPECTOR_VALUE_COLOR, TEXT_SMALL)} style={INSPECTOR_WRAP_STYLE}>{text}</div>;
  }
  const label = text.slice(0, idx + 1);
  const value = text.slice(idx + 1).trim();
  return (
    <div className={cn("flex min-w-0 items-baseline gap-[var(--aries-inspector-heading-gap)]", TEXT_SMALL)}>
      <span className={cn("w-[var(--aries-inspector-label-width)] shrink-0", INSPECTOR_LABEL_COLOR)}>{label}</span>
      <span className={cn("min-w-0 tabular-nums", INSPECTOR_VALUE_COLOR)} style={INSPECTOR_WRAP_STYLE}>{value}</span>
      {status ? (
        <>
          {status.trend ? (
            <span
              className={cn("inline-flex shrink-0 items-center", INSPECTOR_MUTED_COLOR)}
              aria-label={status.trend.label}
              title={status.trend.label}
            >
              {status.trend.direction === "up" ? (
                <ArrowUpRight className="size-[0.9em]" strokeWidth={2} aria-hidden />
              ) : (
                <ArrowDownRight className="size-[0.9em]" strokeWidth={2} aria-hidden />
              )}
            </span>
          ) : null}
          <span className="shrink-0 font-medium" style={{ color: status.color }}>
            {status.label}
          </span>
        </>
      ) : null}
    </div>
  );
}

function splitLeadingToken(text: string): [string, string] {
  const trimmed = text.trimStart();
  if (!trimmed) return ["", ""];
  const match = trimmed.match(/^(\S+)(\s+)?([\s\S]*)$/);
  if (!match) return [trimmed, ""];
  return [match[1] ?? "", match[3] ?? ""];
}

/** An aspect row: prefix + Morinus glyph (coloured) + suffix. Wraps within its
 * column at narrow widths, but keeps the aspect glyph joined to the first text
 * token so it never lands alone on a line. */
function AspectRow({ item }: { item: InspectorAspectItem }) {
  const colour = semanticChartColor(item.aspect_colour_role, rgb(item.aspect_colour));
  const [suffixLead, suffixTail] = splitLeadingToken(item.suffix_text ?? "");
  return (
    <div className={cn("min-w-0 tabular-nums leading-snug", INSPECTOR_VALUE_COLOR, TEXT_SMALL)} style={INSPECTOR_WRAP_STYLE}>
      {item.prefix_text ? <span>{item.prefix_text}</span> : null}
      {item.aspect_glyph || suffixLead ? (
        <span className="whitespace-nowrap">
          {item.aspect_glyph ? (
            <span style={{ fontFamily: "'AriesMorinus'", color: colour ?? undefined }} aria-hidden>
              {item.aspect_glyph}
            </span>
          ) : null}
          {item.aspect_glyph && suffixLead ? "\u00a0" : null}
          {suffixLead ? <span>{suffixLead}</span> : null}
        </span>
      ) : null}
      {suffixTail ? <span> {suffixTail}</span> : null}
    </div>
  );
}

/**
 * Zone B — passive source text from the active inspector-content pack. It is
 * independent of interpretation disciplines and contributes no alert cards.
 */
const PassagesZone = React.memo(function PassagesZone({ passages }: { passages: InspectorPassagesPayload | null }) {
  const t = useT();
  if (!passages?.packId) return null;
  const section = passages.section;

  if (!section) {
    // Matches the wx empty hint (workspace_shell.py:1506) for bodies Valens
    // doesn't cover (Uranus/Neptune/Pluto/Chiron) and non-passage region kinds.
    return (
      <div className={cn(INSPECTOR_SECTION_BOX, INSPECTOR_LABEL_COLOR, TEXT_SMALL)}>
        {t("inspector.valensHint")}
      </div>
    );
  }

  return (
    <div className={INSPECTOR_SECTION_BOX}>
      <SignificationText section={section} />
    </div>
  );
});

/** Plain Valens definition text shaped like wx QuoteTextPane. */
function SignificationText({ section }: { section: InspectorPassageSection }) {
  const paragraphs = section.paragraphs ?? [];

  return (
    <div className={cn("leading-relaxed", INSPECTOR_VALUE_COLOR, TEXT_READING)}>
      {section.citation_label ? (
        <div className={cn("mb-[var(--aries-inspector-citation-gap)] italic", INSPECTOR_LABEL_COLOR)}>
          <PassageRuns runs={section.citation_runs} fallback={section.citation_label} />
        </div>
      ) : null}
      {paragraphs.length ? (
        <div className="flex flex-col gap-[var(--aries-inspector-padding-top)]">
          {paragraphs.map((paragraph, index) => (
            <PassageParagraphView key={`paragraph-${index}`} paragraph={paragraph} />
          ))}
        </div>
      ) : (
        <p className="whitespace-pre-line">
          <PassageText section={section} />
        </p>
      )}
      {section.footnotes.length ? (
        <div className={cn("mt-[var(--aries-inspector-padding-top)] flex flex-col gap-[var(--aries-control-gap-compact)] italic", INSPECTOR_LABEL_COLOR, TEXT_SECTION)}>
          {section.footnotes.map((note, index) => (
            <div key={`footnote-${index}`}>{note}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PassageParagraphView({ paragraph }: { paragraph: InspectorPassageParagraph }) {
  const body = (
    <span className="whitespace-pre-line">
      <PassageRuns runs={paragraph.runs} fallback={paragraph.text} />
    </span>
  );
  return (
    <div>
      {paragraph.label ? (
        <div className={cn("font-semibold", INSPECTOR_VALUE_COLOR)}>{paragraph.label}</div>
      ) : null}
      <div>
        {paragraph.bullet ? <span aria-hidden>• </span> : null}
        {body}
      </div>
    </div>
  );
}

/**
 * The passage prose, rendered with desktop-parity formatting. When the daemon
 * supplies styled `runs` (corpus_text.styled_runs, mirroring corpuspane), we
 * render each run with its styling — italic / bold emphasis, editorial-colour
 * spans, and Morinus-glyph spans for the astro symbols. If `runs` is absent
 * (e.g. an older daemon), we fall back to the verbatim `text` exactly as before.
 */
function PassageText({ section }: { section: InspectorPassageSection }) {
  return <PassageRuns runs={section.runs} fallback={section.text} />;
}

function PassageRuns({
  runs,
  fallback,
}: {
  runs: InspectorPassageRun[] | undefined;
  fallback: string;
}) {
  if (!runs || runs.length === 0) {
    return <>{fallback}</>;
  }
  return (
    <>
      {runs.map((run, i) => (
        <PassageRunSpan key={`run-${i}`} run={run} />
      ))}
    </>
  );
}

/** A single styled passage run. `glyph` runs carry Morinus PUA chars and render
 * in the Morinus font; `editorial` (Kroll/Pingree insertions) renders dimmer,
 * matching corpuspane._editorial_colour intent. */
function PassageRunSpan({ run }: { run: InspectorPassageRun }) {
  switch (run.kind) {
    case "glyph":
      return (
        <span style={{ fontFamily: "'AriesMorinus'" }} aria-hidden>
          {run.text}
        </span>
      );
    case "italic":
      return <em className="italic">{run.text}</em>;
    case "bold":
      return <strong className="font-semibold">{run.text}</strong>;
    case "editorial":
      return <span className={INSPECTOR_MUTED_COLOR}>{run.text}</span>;
    default:
      return <>{run.text}</>;
  }
}

const DEFAULT_READING_KINDS = new Set([
  "verdict",
  "predicate_verdict",
  "moon_sign_lookup",
  "finding",
  "predicate_finding",
  "axis_assignment",
]);

export function isDefaultReadingAlert(
  alert: Pick<InspectorAlert, "kind">,
): boolean {
  return DEFAULT_READING_KINDS.has(alert.kind || "verdict");
}

export function defaultReadingAlerts<T extends Pick<InspectorAlert, "kind">>(
  alerts: readonly T[],
  limit = 12,
): T[] {
  return alerts.filter(isDefaultReadingAlert).slice(0, limit);
}

export function detailAlerts<T extends Pick<InspectorAlert, "evidence" | "technicalDetails">>(
  alerts: readonly T[],
  visibleReadings: readonly T[],
): T[] {
  const visibleReadingSet = new Set(visibleReadings);
  return alerts.filter((alert) => (
    !visibleReadingSet.has(alert)
    || Boolean(alert.technicalDetails?.trim())
    || Boolean(alert.evidence?.trim())
  ));
}

/**
 * Zone B — pack readings. Complete verdicts, source findings, and literal axis
 * assignments remain ordinary cards. Constituent conditions, source notes,
 * unknown kinds, and all engine diagnostics stay in one closed disclosure.
 */
const AlertsZone = React.memo(function AlertsZone({ alerts }: { alerts: InspectorAlertsPayload | null }) {
  const t = useT();
  const tf = useTFallback();
  if (!alerts || alerts.alerts.length === 0) return null;
  const heading = [alerts.discipline, alerts.theme]
    .filter(Boolean)
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s))
    .join(" · ");
  const visibleReadings = defaultReadingAlerts(alerts.alerts);
  const visibleReadingSet = new Set(visibleReadings);
  const auditAlerts = detailAlerts(alerts.alerts, visibleReadings);

  return (
    <div className={INSPECTOR_SECTION_BOX}>
      <SectionLabel>{heading || t("inspector.packAlerts")}</SectionLabel>
      <div className="flex flex-col gap-[var(--aries-inspector-card-gap)]">
        {/* wx caps the visible cards at 12 (workspace_shell.py:2635). */}
        {visibleReadings.map((alert, i) => (
          <AlertCard
            key={`${alert.pack ?? "inline"}:${alert.ruleId ?? i}`}
            alert={alert}
          />
        ))}
      </div>
      {auditAlerts.length > 0 ? (
        <details className={cn("mt-[var(--aries-inspector-card-gap)]", INSPECTOR_TERTIARY_COLOR, TEXT_SECTION)}>
          <summary className="w-fit cursor-pointer select-none">
            {t("inspector.technicalDetails")}
          </summary>
          <div className="mt-[var(--aries-control-gap-compact)] space-y-[var(--aries-inspector-card-gap)]">
            {auditAlerts.map((alert, i) => {
              const title = alert.titleKey ? tf(alert.titleKey, alert.title) : alert.title;
              const body = alert.bodyKey ? tf(alert.bodyKey, alert.body) : alert.body;
              const hiddenFromReadings = !visibleReadingSet.has(alert);
              const kindLabel = alert.kind === "source_note"
                ? t("inspector.sourceNote")
                : alert.kind === "condition" || alert.kind === "predicate_condition"
                  ? t("inspector.condition")
                  : alert.kind === "finding" || alert.kind === "predicate_finding"
                    ? t("inspector.finding")
                    : hiddenFromReadings ? alert.kind : "";
              const auditId = [alert.pack, alert.ruleId].filter(Boolean).join(":");
              return (
                <div key={`${alert.pack ?? "inline"}:${alert.ruleId ?? i}`}>
                  <div className={cn("font-semibold", INSPECTOR_READING_COLOR)}>{title}</div>
                  {kindLabel || auditId ? (
                    <div className="font-mono">
                      {[kindLabel, auditId ? `[${auditId}]` : ""].filter(Boolean).join(" · ")}
                    </div>
                  ) : null}
                  {hiddenFromReadings && body ? (
                    <div className={cn("whitespace-pre-line", INSPECTOR_READING_COLOR)}>{body}</div>
                  ) : null}
                  {hiddenFromReadings && alert.cite ? (
                    <div className={cn("italic", INSPECTOR_LABEL_COLOR)}>{alert.cite}</div>
                  ) : null}
                  {alert.technicalDetails ? (
                    <div className="whitespace-pre-line">{alert.technicalDetails}</div>
                  ) : null}
                  {alert.evidence ? (
                    <div className="whitespace-pre-line font-mono">{alert.evidence}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
});

/** Status → dot colour. Presentation mapping mirroring the wx oracle's
 * _election_status_colour (workspace_shell.py:2391); no content is derived. */
const ALERT_STATUS_COLOUR: Record<string, string> = {
  good: "var(--aries-status-good)",
  caution: "var(--aries-status-caution)",
  avoid: "var(--aries-status-avoid)",
};

/** A single source-reading card. Authored title/body/citation stay primary;
 * engine provenance is collected once in the zone-level audit disclosure. */
function AlertCard({ alert }: { alert: InspectorAlert }) {
  const tf = useTFallback();
  const dot = (alert.status && ALERT_STATUS_COLOUR[alert.status]) || "var(--aries-status-neutral)";
  const title = alert.titleKey ? tf(alert.titleKey, alert.title) : alert.title;
  const body = alert.bodyKey ? tf(alert.bodyKey, alert.body) : alert.body;
  return (
    <div className="rounded-[var(--aries-radius-md)] border border-[color:var(--aries-inspector-card-border-color)] bg-[var(--aries-inspector-card-background)] px-[var(--aries-inspector-card-padding-x)] py-[var(--aries-inspector-card-padding-y)]">
      <div className="flex items-center gap-[var(--aries-inspector-heading-gap)]">
        <span
          className="size-[var(--aries-inspector-status-dot-size)] shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
          aria-hidden
        />
        {alert.glyph ? (
          <span className={cn("leading-none", INSPECTOR_READING_COLOR, INSPECTOR_ALERT_GLYPH_TEXT)} style={{ fontFamily: "'AriesMorinus'" }} aria-hidden>
            {alert.glyph}
          </span>
        ) : null}
        <span className={cn("min-w-0 flex-1 font-semibold tracking-tight", INSPECTOR_STRONG_COLOR, TEXT_SMALL)}>
          {title}
        </span>
      </div>
      {body ? (
        <p className={cn("mt-[var(--aries-control-gap-compact)] leading-relaxed whitespace-pre-line", INSPECTOR_READING_COLOR, TEXT_SMALL)}>{body}</p>
      ) : null}
      {alert.cite ? (
        <div className={cn("mt-[var(--aries-control-gap-compact)] italic", INSPECTOR_LABEL_COLOR, TEXT_SECTION)}>{alert.cite}</div>
      ) : null}
    </div>
  );
}

type InspectorSpeculumRow = {
  id: string;
  label: string;
  bodyGlyphCell?: GenericTableCell;
  longitudeCell: GenericTableCell;
  longitudeText: string;
  latitudeCell?: GenericTableCell;
  latitudeText: string;
  declinationCell?: GenericTableCell;
  declinationText: string;
  declinationOutOfBounds: boolean;
  speedCell?: GenericTableCell;
  speedText: string;
  houseCell?: GenericTableCell;
  houseText: string;
};

const inspectorSpeculumRefreshSeqByDocument = new Map<string, number>();

function speculumBodyGlyphCell(cell: GenericTableCell): GenericTableCell | undefined {
  if (cell.glyph) return { ...cell, text: undefined };
  const glyphRuns = cell.runs?.filter((run) => run.glyph);
  return glyphRuns?.length ? { ...cell, text: undefined, runs: glyphRuns } : undefined;
}

function inspectorSpeculumRows(payload: GenericTablePayload): InspectorSpeculumRow[] {
  return (payload.sections ?? [])
    .filter((section) => section.id === "ascmc" || section.id === "planets")
    .flatMap((section) => {
      const bodyIndex = section.columns.findIndex((column) => column.id === "body");
      const longitudeIndex = section.columns.findIndex((column) => column.id === "lon");
      const latitudeIndex = section.columns.findIndex((column) => column.id === "lat");
      const declinationIndex = section.columns.findIndex((column) => column.id === "decl");
      const speedIndex = section.columns.findIndex((column) => column.id === "speed");
      const houseIndex = section.columns.findIndex((column) => column.id === "house");
      if (bodyIndex < 0 || longitudeIndex < 0) return [];
      return section.rows.flatMap((row) => {
        const bodyCell = row.cells[bodyIndex];
        const longitudeCell = row.cells[longitudeIndex];
        const latitudeCell = latitudeIndex >= 0 ? row.cells[latitudeIndex] : undefined;
        const declinationCell = declinationIndex >= 0 ? row.cells[declinationIndex] : undefined;
        const speedCell = speedIndex >= 0 ? row.cells[speedIndex] : undefined;
        const houseCell = houseIndex >= 0 ? row.cells[houseIndex] : undefined;
        const label = tableCellText(bodyCell).trim();
        if (!bodyCell || !longitudeCell || !label) return [];
        return [{
          id: `${section.id}:${row.id}`,
          label,
          bodyGlyphCell: speculumBodyGlyphCell(bodyCell),
          longitudeCell,
          longitudeText: tableCellText(longitudeCell),
          latitudeCell,
          latitudeText: tableCellText(latitudeCell),
          declinationCell,
          declinationText: tableCellText(declinationCell),
          declinationOutOfBounds: row.meta?.declinationOutOfBounds === true,
          speedCell,
          speedText: tableCellText(speedCell),
          houseCell,
          houseText: tableCellText(houseCell),
        }];
      });
    });
}

function InspectorSpeculum({
  visible,
  documentId,
  parentDocumentId,
  lastSessionChange,
  lastOptionsChange,
}: {
  visible: boolean;
  documentId: string;
  parentDocumentId?: string | null;
  lastSessionChange: WorkspaceSessionChange | null;
  lastOptionsChange: WorkspaceOptionsChange | null;
}) {
  const t = useT();
  const [payloadState, setPayloadState] = React.useState<{
    documentId: string;
    payload: GenericTablePayload;
  } | null>(() => {
    const payload = getCachedGenericTablePayload("positions", documentId);
    return payload ? { documentId, payload } : null;
  });
  const requestSeqRef = React.useRef(0);
  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId,
    parentDocumentId,
    lastSessionChange,
    lastOptionsChange,
    refreshOnInspectorDataChange: true,
  });

  React.useEffect(() => {
    if (!visible) return;
    const cachedPayload = getCachedGenericTablePayload("positions", documentId);
    if (
      cachedPayload &&
      inspectorSpeculumRefreshSeqByDocument.get(documentId) === refreshSeq
    ) {
      return;
    }
    const controller = new AbortController();
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    fetchGenericTablePayload("positions", documentId, controller.signal)
      .then((payload) => {
        if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
        rememberGenericTablePayload("positions", documentId, payload);
        inspectorSpeculumRefreshSeqByDocument.set(documentId, refreshSeq);
        setPayloadState({ documentId, payload });
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        console.error("[inspector:positions]", err);
      });
    return () => controller.abort();
  }, [documentId, refreshSeq, visible]);

  const payload = payloadState?.documentId === documentId
    ? payloadState.payload
    : getCachedGenericTablePayload("positions", documentId);
  const rows = React.useMemo(
    () => payload ? inspectorSpeculumRows(payload) : [],
    [payload],
  );
  if (!visible || !rows.length) return null;
  const columns = payload?.sections?.find(
    (section) => section.id === "ascmc" || section.id === "planets",
  )?.columns ?? payload?.columns ?? [];
  const columnLabel = (id: string) => {
    const column = columns.find((candidate) => candidate.id === id);
    return column?.exportLabel ?? column?.label ?? "";
  };

  return (
    <div className={INSPECTOR_SECTION_BOX}>
      <table
        aria-label={t("table.positions")}
        className={cn(
          "w-full table-auto border-collapse leading-snug",
          TEXT_BASE,
        )}
      >
        <thead className={cn(INSPECTOR_MUTED_COLOR, TEXT_SMALL)}>
          <tr>
            {(["body", "lon", "lat", "decl", "speed", "house"] as const).map((columnId) => {
              const label = columnLabel(columnId);
              return (
                <th
                  key={columnId}
                  scope="col"
                  title={label}
                  className={cn(
                    "pr-[var(--aries-control-gap-compact)] pb-[var(--aries-inspector-row-gap)] font-normal whitespace-nowrap last:pr-0",
                    columnId === "body" ? "text-left" : "text-right",
                  )}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td
                title={row.label}
                className="pr-[var(--aries-control-gap-compact)] align-baseline whitespace-nowrap last:pr-0"
              >
                <span className="inline-flex items-baseline gap-[var(--aries-control-gap-compact)]">
                  <span className="inline-flex w-[1.25em] shrink-0 justify-center leading-none" aria-hidden>
                    <CellView cell={row.bodyGlyphCell} />
                  </span>
                  <span className={INSPECTOR_VALUE_COLOR}>{row.label}</span>
                </span>
              </td>
              <td
                aria-label={row.longitudeText}
                className={cn("pr-[var(--aries-control-gap-compact)] whitespace-nowrap text-right tabular-nums last:pr-0", INSPECTOR_VALUE_COLOR)}
              >
                <span aria-hidden><CellView cell={row.longitudeCell} /></span>
              </td>
              <td
                aria-label={row.latitudeText || undefined}
                className={cn("pr-[var(--aries-control-gap-compact)] whitespace-nowrap text-right tabular-nums last:pr-0", INSPECTOR_VALUE_COLOR)}
              >
                <span aria-hidden><CellView cell={row.latitudeCell} /></span>
              </td>
              <td
                aria-label={row.declinationText || undefined}
                className={cn(
                  "pr-[var(--aries-control-gap-compact)] whitespace-nowrap text-right tabular-nums last:pr-0",
                  row.declinationOutOfBounds ? "text-destructive" : INSPECTOR_VALUE_COLOR,
                )}
              >
                <span aria-hidden><CellView cell={row.declinationCell} /></span>
              </td>
              <td
                aria-label={row.speedText || undefined}
                className={cn("pr-[var(--aries-control-gap-compact)] whitespace-nowrap text-right tabular-nums last:pr-0", INSPECTOR_VALUE_COLOR)}
              >
                <span aria-hidden><CellView cell={row.speedCell} /></span>
              </td>
              <td
                aria-label={row.houseText || undefined}
                className={cn("whitespace-nowrap text-right tabular-nums", INSPECTOR_VALUE_COLOR)}
              >
                <span aria-hidden><CellView cell={row.houseCell} /></span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartSummary({ chart }: { chart: ChartRenderSnapshot | null }) {
  const t = useT();
  if (!chart) {
    return <div className={cn("px-[var(--aries-inspector-padding-x)] pb-[var(--aries-inspector-padding-bottom)]", INSPECTOR_MUTED_COLOR)}>{t("inspector.noChart")}</div>;
  }
  const meta = chart.primaryChart.meta;
  const summaryLines = [
    meta.dateDisplay,
    meta.timeDisplay,
    meta.place,
    meta.placeCoords,
    meta.age,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="flex flex-col gap-0 px-[var(--aries-inspector-padding-x)] pb-[var(--aries-inspector-padding-bottom)] pr-[var(--aries-inspector-summary-close-reserve)] pt-[var(--aries-inspector-padding-top)]">
      <div className={cn("font-semibold tracking-tight", INSPECTOR_TITLE_COLOR, INSPECTOR_TITLE_TEXT)}>{meta.name}</div>
      {summaryLines.length ? (
        <div className="mt-[var(--aries-inspector-section-gap)] flex flex-col gap-[var(--aries-inspector-row-gap)]">
          {summaryLines.map((line, index) => (
            <div
              key={`chart-summary-${index}`}
              className={cn("text-left tabular-nums leading-snug", INSPECTOR_VALUE_COLOR, TEXT_BASE)}
              style={INSPECTOR_WRAP_STYLE}
            >
              {line}
            </div>
          ))}
        </div>
      ) : null}
      <div className={cn("mt-[var(--aries-inspector-section-gap)]", INSPECTOR_LABEL_COLOR, TEXT_SMALL)}>{t("inspector.hover")}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className={cn("pb-[var(--aries-inspector-row-gap)]", INSPECTOR_LABEL_COLOR, TEXT_SECTION)}>{children}</div>;
}

function Divider() {
  return <div className={cn("my-[var(--aries-inspector-section-gap)] border-t", INSPECTOR_DIVIDER_BORDER)} />;
}

function rgb(c: RGB | null | undefined): string | null {
  if (!c || c.length !== 3) return null;
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}
