// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

"use client";

import { regionObjectId } from "@/lib/inspector-region-identity";

import * as React from "react";
import { ArrowDownRight, ArrowUpRight, ChevronDown, Clipboard, Repeat2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InspectorValueSpans } from "./inspector-value-spans";
import { CorpusGlyph, CorpusSignColorModeContext } from "./corpus-glyph";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  corpusDisciplinesCached,
  fetchAlerts,
  fetchGenericTablePayload,
  fetchInspectorAscensionalTransits,
  fetchInspectorPayload,
  fetchPassages,
  invalidateCorpusDisciplines,
  type CorpusDiscipline,
  type GenericTableCell,
  type GenericTablePayload,
  type GenericTableRow,
  type InspectorAlert,
  type InspectorAlertsPayload,
  type InspectorAscensionalGlyph,
  type InspectorAscensionalRow,
  type InspectorAscensionalTransitsPayload,
  type InspectorAspectEndpoint,
  type InspectorAspectItem,
  type InspectorDignityItem,
  type InspectorFlagSpan,
  type InspectorLunarExactState,
  type InspectorManzil,
  type InspectorPassagesPayload,
  type InspectorPassageParagraph,
  type InspectorPassageRun,
  type InspectorPassageSection,
  type InspectorPayload,
  type InspectorLensPayload,
  type InspectorSpeculumPrecision,
  type InspectorTextSize,
  type RGB,
  setAscensionalMethod,
  workspaceMirrorLens,
} from "@/lib/daemon/client";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import { SE_MOON } from "@/lib/chart/glyphs";
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
import { useThemeStore } from "@/stores/theme-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { useInspectorCardStore } from "@/stores/inspector-card-store";
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
import { CellView, VoidOfCourseSuffix } from "./generic-table-view";
import { InspectorSpeculumAngle, InspectorSpeculumSpeed } from "./speculum-table-cells";
import { saveTableDisplay, TablePrecisionChoices, useTablePrecision } from "./table-precision-menu";
import { tableCellText } from "./table-text-export";
import { copyTextToClipboard } from "./text-export";
import { observeInspectorSpeculumFit } from "@/lib/inspector-speculum-layout";
import { useStepBurst } from "@/lib/chart/step-burst";
import {
  LIVE_SURFACE_PRIORITY,
  liveSurfaceResult,
  useFreshLivePayload,
  useLiveSurfaceRequest,
} from "@/lib/live-surfaces";

const INSPECTOR_PAYLOAD_KINDS = new Set([
  "planet",
  "vertex",
  "fortune",
  "syzygy",
  "eclipse",
  "angle",
  "house",
  "sign",
  "term",
  "decan",
  "secondary_ring",
  "aspect",
  "drishti",
]);

const InspectorTextSizeContext = React.createContext<((size: InspectorTextSize) => void) | null>(null);

const TEXT_BASE = "text-[length:calc(var(--aries-font-size-base)*var(--aries-inspector-text-scale,1))]";
const TEXT_READING = "text-[length:calc(var(--aries-font-size-reading)*var(--aries-inspector-text-scale,1))]";
const TEXT_SMALL = "text-[length:calc(var(--aries-font-size-small)*var(--aries-inspector-text-scale,1))]";
const TEXT_SECTION = "text-[length:calc(var(--aries-font-size-section)*var(--aries-inspector-text-scale,1))]";
const TEXT_ARABIC = "text-[length:calc(var(--aries-font-size-arabic)*var(--aries-inspector-text-scale,1))]";
const INSPECTOR_TITLE_TEXT = "text-[length:calc(var(--aries-inspector-title-size)*var(--aries-inspector-text-scale,1))]";
const INSPECTOR_ALERT_GLYPH_TEXT = "text-[length:calc(var(--aries-inspector-alert-glyph-size)*var(--aries-inspector-text-scale,1))]";
const INSPECTOR_TITLE_COLOR = "text-[color:var(--aries-inspector-title-color)]";
const INSPECTOR_STRONG_COLOR = "text-[color:var(--aries-inspector-strong-color)]";
const INSPECTOR_VALUE_COLOR = "text-[color:var(--aries-inspector-value-color)]";
const INSPECTOR_READING_COLOR = "text-[color:var(--aries-inspector-reading-color)]";
const INSPECTOR_LABEL_COLOR = "text-[color:var(--aries-inspector-label-color)]";
const INSPECTOR_ROW_LABEL = "w-[calc(var(--aries-inspector-label-width)*var(--aries-inspector-text-scale,1))] max-w-[40%] shrink-0 whitespace-normal [overflow-wrap:anywhere]";
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
 * skin computes/fabricates nothing.
 */
export function InspectorPanel({ chart }: { chart: ChartRenderSnapshot | null }) {
  const t = useT();
  const textSize = useThemeStore((s) => s.theme?.inspectorTextSize ?? "normal");
  const speculumPrecision = useTablePrecision();
  const setTextSize = React.useCallback((size: InspectorTextSize) => {
    if (size !== useThemeStore.getState().theme?.inspectorTextSize) {
      saveTableDisplay({ inspector_text_size: size }, { inspectorTextSize: size });
    }
  }, []);
  const hovered = useWorkspaceStore((s) => s.hoveredRegion);
  const pinned = useWorkspaceStore((s) => s.inspectorActiveRegion);
  const setInspectorOpen = useFrameLayoutStore((s) => s.setInspectorOpen);
  const { documents, activeDocument: focusedDoc, lastSessionChange } = useDaemonWorkspaceView();
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastOptionsChange);
  // A clicked inspector target is a real focus, not a hover fallback. Keep it
  // authoritative while the pointer and the stepped glyph move underneath it;
  // clicking another target or empty chart space still replaces/clears it.
  const selectedRegion = pinned ?? hovered;
  const coordinateMode = chart?.document?.chartPresentation?.coordinateMode;
  const differentCoordinates = selectedRegion?.viewDocumentId === chart?.document?.documentId
    && selectedRegion?.coordinateMode && coordinateMode && selectedRegion.coordinateMode !== coordinateMode;
  // Preserve the pinned semantic target while each pane reads its own frame.
  // A coordinate-specific contact/sign resumes when its matching view returns.
  const region = differentCoordinates && selectedRegion
    ? selectedRegion.kind === "aspect" || selectedRegion.kind === "sign" ? null : { ...selectedRegion, coordinateMode }
    : selectedRegion;
  const activeDoc = region?.viewDocumentId
    ? documents.find(doc => doc.id === region.viewDocumentId) ?? focusedDoc : focusedDoc;
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

  // Phone: the sheet is closed to see the whole wheel, not to discard the
  // selection, so the pinned target stays for the next open. Desktop clears it.
  const mobile = useMobileLayout();
  const closeInspector = React.useCallback(() => {
    if (!mobile) useWorkspaceStore.getState().setInspectorActiveRegion(null);
    setInspectorOpen(false);
  }, [mobile, setInspectorOpen]);

  return (
    <InspectorTextSizeContext.Provider value={setTextSize}>
    <ContextMenu>
      <ContextMenuTrigger render={<aside
      data-aries-surface="inspector"
      data-inspector-text-size={textSize}
      style={{
        "--aries-inspector-text-scale": textSize === "larger" ? 15 / 13 : textSize === "extra-large" ? 17 / 13 : 1,
      } as React.CSSProperties}
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
      {chart?.ascensionalScene && ["mdo", "ascensional-transits"].includes(chart.ascensionalScene.contactMethod) && chart.document?.documentId && speculumDocument ? (
        <InspectorAscensionalTransits
          documentId={chart.document.documentId}
          viewSide={chart.viewSide}
          scene={chart.ascensionalScene}
          parentDocumentId={speculumDocument?.parentDocumentId}
          lastSessionChange={lastSessionChange}
          lastOptionsChange={lastOptionsChange}
        />
      ) : null}
      {chart && speculumDocument ? (
        <InspectorSpeculum
          chart={chart}
          precision={speculumPrecision}
          visible={!region}
          documentId={speculumDocument.id}
          parentDocumentId={speculumDocument.parentDocumentId}
          lastSessionChange={lastSessionChange}
          lastOptionsChange={lastOptionsChange}
        />
      ) : null}
      {/* Zone B — source-text passages (keyed to the active region) + pack
          alerts (keyed to the active chart's lens). Rendered verbatim. */}
      <CorpusSignColorModeContext.Provider value={Boolean(chart?.primaryChart.options.useZodiacElementColors)}>
        {region ? <PassagesZone passages={passages} /> : null}
        <InterpretationSelector />
        <AlertsZone alerts={alerts} />
      </CorpusSignColorModeContext.Provider>
    </aside>} />
      <ContextMenuContent align="start" className="min-w-44">
        <InspectorTextSizeChoices />
        {chart && speculumDocument ? (
          <>
            <ContextMenuSeparator />
            <TablePrecisionChoices />
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
    </InspectorTextSizeContext.Provider>
  );
}

function InspectorTextSizeChoices() {
  const t = useT();
  const value = useThemeStore((s) => s.theme?.inspectorTextSize ?? "normal");
  const onChange = React.useContext(InspectorTextSizeContext);
  if (!onChange) return null;
  return (
    <ContextMenuRadioGroup value={value} onValueChange={(next) => onChange(next as InspectorTextSize)}>
      <ContextMenuRadioItem value="normal">{t("inspector.textSize.normal")}</ContextMenuRadioItem>
      <ContextMenuRadioItem value="larger">{t("inspector.textSize.larger")}</ContextMenuRadioItem>
      <ContextMenuRadioItem value="extra-large">{t("inspector.textSize.extraLarge")}</ContextMenuRadioItem>
    </ContextMenuRadioGroup>
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
  const docId = region?.viewDocumentId ?? activeDoc?.id ?? undefined;
  const chartRole = region && "chartRole" in region ? region.chartRole : undefined;
  const ringIndex = region && "ringIndex" in region ? region.ringIndex : undefined;
  // A hovered moment (Graphic Ephemeris) is its own transit sky, not the view's
  // live chart: it has no step snapshot and its identity includes the moment.
  const atJd = region?.kind === "planet" ? region.atJd : undefined;
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
    || (region?.kind === "aspect" && region.scope === "interchart");
  // Sibling biwheels share their inner chart, so only outer/interchart regions
  // need the changing child document in their retained-content identity.
  const inspectedChartIdentity = partnerSensitive
    ? [radixBranchId, docId ?? null, primaryChartIdentity, stableRenderChartIdentity(chart?.comparisonChart)]
    : [radixBranchId, primaryChartIdentity];
  const payloadIdentity = canFetch
    ? JSON.stringify([
        inspectedChartIdentity,
        chart?.viewSide ?? null,
        chart?.document?.chartPresentation?.coordinateMode ?? "zodiacal",
        kind,
        objectId,
        chartRole ?? null,
        ringIndex ?? null,
        atJd ?? null,
        locale,
      ])
    : null;

  // Follow arrow stepping from the step snapshot itself (live_surface_service):
  // the stepped wheel and this object's values commit together, with no second
  // request after the paint. Options and settle refreshes still fetch below.
  const liveKey = canFetch && atJd == null && docId && kind && objectId != null
    ? `inspector:${JSON.stringify([docId, kind, objectId, chartRole ?? "primary", ringIndex ?? null])}`
    : null;
  useLiveSurfaceRequest(
    liveKey && docId && kind && objectId != null
      ? { key: liveKey, kind: "inspector", documentId: docId, regionKind: kind, objectId: String(objectId), chartRole, ringIndex }
      : null,
    LIVE_SURFACE_PRIORITY.inspectorRegion,
  );
  const liveResult = liveSurfaceResult(chart, liveKey);
  const liveShownRef = React.useRef<{ result: unknown; identity: string } | null>(null);
  useFreshLivePayload<InspectorPayload>(liveResult, (livePayload, result) => {
    if (!payloadIdentity) return;
    liveShownRef.current = { result, identity: payloadIdentity };
    setPayloadState((current) => ({
      identity: payloadIdentity,
      payload: retainDeferredInspectorSlots(
        current?.identity === payloadIdentity ? current.payload : null,
        livePayload,
      ),
    }));
  });
  const requestedRefreshSeqRef = React.useRef(refreshSeq);

  React.useEffect(() => {
    if (!canFetch || !payloadIdentity || !kind || objectId == null || !sourceName) return;
    const refreshRequested = requestedRefreshSeqRef.current !== refreshSeq;
    requestedRefreshSeqRef.current = refreshSeq;
    // This step's own payload is already shown; only a semantic refresh refetches.
    const liveShown = liveShownRef.current;
    if (
      !refreshRequested &&
      liveShown?.result === liveResult &&
      liveShown?.identity === payloadIdentity
    ) {
      return;
    }
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
        atJd,
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
  }, [canFetch, payloadIdentity, kind, objectId, docId, chartRole, ringIndex, atJd, sourceName, hereNow, supplementaryKind, comparisonName, viewMode, when, bindingJson, deferSignals, refreshSeq, liveResult]);

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
  if (next.deferred_slots?.includes("void-course") && current?.void_course_row) {
    const voidCourseRow = current.void_course_row;
    retained = {
      ...retained,
      void_course_row: voidCourseRow,
      smart_rows: [...retained.smart_rows, voidCourseRow],
      rows: [...(retained.rows ?? retained.smart_rows), voidCourseRow],
    };
  }
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
      station_items: current.station_items,
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
  const docId = region?.viewDocumentId ?? activeDoc?.id ?? undefined;
  const chartRole = region && "chartRole" in region ? region.chartRole : undefined;
  const ringIndex = region && "ringIndex" in region ? region.ringIndex : undefined;
  const atJd = region?.kind === "planet" ? region.atJd : undefined;
  // Inspector source text is standing content. A live document id already
  // resolves the current session chart, so its changing cursor must not refetch
  // and rerender the passage on every step. The fallback loader still needs a
  // datetime when no live document exists.
  const when = docId ? undefined : snapshotDisplayDatetime(chart, activeDoc);

  const canFetch = Boolean(
    region
    && !(region.coordinateMode === "ascensional" && (region.kind === "sign" || region.kind === "aspect"))
    && kind
    && objectId != null
    && sourceName,
  );
  const passagesIdentity = canFetch
    ? JSON.stringify([radixBranchId, docId, region?.coordinateMode, kind, objectId, chartRole, ringIndex, atJd ?? null, locale, packsVersion])
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
        atJd,
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
  }, [canFetch, passagesIdentity, kind, objectId, docId, chartRole, ringIndex, atJd, sourceName, hereNow, supplementaryKind, comparisonName, viewMode, when, bindingJson]);

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
  const when = useStepSettledValue(snapshotDisplayDatetime(chart, activeDoc));
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
    "h-auto min-h-[var(--aries-control-height-compact)] min-w-0 flex-1 py-[0.25em] leading-normal rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-transparent px-[var(--aries-control-gap)] outline-none",
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
      <div className="aries-inspector-interpretation-controls flex items-center gap-[var(--aries-inspector-heading-gap)]">
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
  const mobile = useMobileLayout();
  if (!payload) {
    return <div className={cn("px-[var(--aries-inspector-padding-x)] pb-[var(--aries-inspector-padding-bottom)]", INSPECTOR_LABEL_COLOR, TEXT_SMALL)}>{t(mobile ? "inspector.tap" : "inspector.hover")}</div>;
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
  const summaryBlock = summaryRows.length ? (
    <div className="flex flex-col gap-[var(--aries-inspector-row-gap)]">
      {summaryRows.map((row, i) => {
        const spans = payload.summary_items?.find((item) => item.text === row)?.spans;
        return (
          <div key={`smart-${i}`} className={cn("whitespace-pre-line tabular-nums leading-snug", INSPECTOR_VALUE_COLOR, TEXT_BASE)} style={INSPECTOR_WRAP_STYLE}>
            {spans?.length ? <InspectorValueSpans spans={spans} /> : row}
          </div>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-0 px-[var(--aries-inspector-padding-x)] pb-[var(--aries-inspector-padding-bottom)] pt-[var(--aries-inspector-padding-top)]" style={INSPECTOR_WRAP_STYLE}>
      <InspectorIdentityHeader
        glyph={payload.glyph}
        signGlyph={payload.signGlyph}
        signLabel={payload.signLabel}
        signColourRole={payload.signColourRole}
        title={payload.title}
        motionGlyph={payload.motionGlyph ?? ""}
        motionUsesSymbolFont={Boolean(payload.motionUsesSymbolFont)}
        motionLabel={payload.motionLabel ?? ""}
        meta={showMeta ? meta : null}
        aspects={payload.header_aspect_items}
        accent={accent}
        summary={payload.signGlyph ? summaryBlock : null}
      />

      {/* Summary block — smart_rows, in order. */}
      {!payload.signGlyph && summaryBlock ? (
        <div className="mt-[var(--aries-inspector-section-gap)]">
          {summaryBlock}
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
          <DetailAspectColumns
            details={detailRows.length ? (
              <>
                {detailRows.map((row, i) => (
                  <DetailRow
                    key={`det-${i}`}
                    text={row}
                    valueSpans={(
                      payload.station_items?.find((item) => item.text === row)
                      ?? payload.ruler_items?.find((item) => item.text === row)
                    )?.spans ?? undefined}
                    status={i === 0 ? lunarSpeedStatus : undefined}
                  />
                ))}
              </>
            ) : null}
            aspects={aspectItems.length ? aspectItems.map((item, i) => (
              <AspectRow key={`asp-${i}`} item={item} />
            )) : null}
          />
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
  signGlyph,
  signLabel,
  signColourRole,
  title,
  motionGlyph,
  motionUsesSymbolFont,
  motionLabel,
  meta,
  aspects,
  accent,
  summary,
}: {
  glyph: string;
  signGlyph?: string;
  signLabel?: string;
  signColourRole?: string | null;
  title: string;
  motionGlyph: string;
  motionUsesSymbolFont: boolean;
  motionLabel: string;
  meta: string | null;
  aspects?: InspectorAspectItem[];
  accent: string | null;
  summary?: React.ReactNode;
}) {
  return (
    <div className={cn(
      "min-w-0 gap-x-[var(--aries-inspector-heading-gap)] pr-[var(--aries-inspector-close-reserve)]",
      signGlyph
        ? "grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-y-[var(--aries-control-gap-compact)]"
        : "flex flex-wrap items-baseline",
    )}>
      {signGlyph || glyph ? (
        <span
          className="inline-flex shrink-0 items-center gap-[var(--aries-control-gap-compact)] leading-none"
          style={{
            fontFamily: "'AriesMorinus'",
            fontSize: signGlyph
              ? "calc(var(--aries-inspector-title-size) * var(--aries-inspector-text-scale, 1) * 6 / 5)"
              : "calc(var(--aries-inspector-glyph-size) * var(--aries-inspector-text-scale, 1))",
          }}
        >
          {signGlyph ? (
            <span
              style={{ color: semanticChartColor(signColourRole, null) }}
              aria-label={signLabel}
              title={signLabel}
            >
              {signGlyph}
            </span>
          ) : null}
          {glyph ? (
            <span style={{ color: accent ?? undefined }} aria-hidden>
              {glyph}
            </span>
          ) : null}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0 font-semibold tracking-tight",
          "leading-tight",
          INSPECTOR_TITLE_COLOR,
          INSPECTOR_TITLE_TEXT,
        )}
        style={INSPECTOR_WRAP_STYLE}
        title={title}
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
        <span className={cn("min-w-0 max-w-full", INSPECTOR_LABEL_COLOR, TEXT_SECTION)}>{meta}</span>
      ) : null}
      {aspects?.map((item, index) => (
        <AspectRow key={`header-aspect-${index}`} item={item} inline />
      ))}
      {summary ? <div className="col-start-2 min-w-0">{summary}</div> : null}
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
          className={cn("min-w-0 flex-1 text-left", INSPECTOR_MUTED_COLOR, TEXT_SECTION)}
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
      <div className={cn("flex min-w-0 flex-wrap items-baseline gap-[var(--aries-inspector-heading-gap)]", TEXT_BASE)}>
        <span className={cn(INSPECTOR_ROW_LABEL, INSPECTOR_LABEL_COLOR)} title={item.label}>{item.label}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-[var(--aries-control-gap)]" aria-label={item.value_text}>
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
      <div className={cn("flex min-w-0 flex-wrap items-baseline gap-[var(--aries-control-gap-compact)]", TEXT_BASE)}>
        <span className={cn(INSPECTOR_ROW_LABEL, INSPECTOR_LABEL_COLOR)} title={item.label ?? undefined}>{item.label ?? ""}</span>
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
    <div className={cn("flex min-w-0 flex-wrap items-baseline gap-x-[var(--aries-inspector-heading-gap)] gap-y-[var(--aries-inspector-row-gap)]", TEXT_BASE)}>
      <span className={cn(INSPECTOR_ROW_LABEL, INSPECTOR_LABEL_COLOR)} title={item.label}>{item.label}</span>
      <span className={cn("min-w-0", item.bold && "font-semibold")} style={{ color: colour ?? undefined, ...INSPECTOR_WRAP_STYLE }}>
        {item.value}
      </span>
    </div>
  );
}

/** Details beside aspects when both fit. Intrinsic column bases move aspects
 * below the details before squeezing values; once wrapped, the aspects take an
 * "Aspects:" label so they sit in the same label/value grid as the detail rows. */
function DetailAspectColumns({ details, aspects }: { details: React.ReactNode; aspects: React.ReactNode }) {
  const t = useT();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const detailsRef = React.useRef<HTMLDivElement>(null);
  const aspectsRef = React.useRef<HTMLDivElement>(null);
  const stackedLabelRef = React.useRef<HTMLSpanElement>(null);
  const [stacked, setStacked] = React.useState(false);
  const hasBoth = Boolean(details && aspects);
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !hasBoth) {
      setStacked(false);
      return;
    }
    const update = () => {
      const detailsEl = detailsRef.current;
      const aspectsEl = aspectsRef.current;
      const labelEl = stackedLabelRef.current;
      // Measure the same two columns in both directions of resize. The label
      // belongs to the stacked layout and must not set its own wrap threshold.
      if (labelEl && !labelEl.hidden) labelEl.style.display = "none";
      const shouldStack = Boolean(detailsEl && aspectsEl && aspectsEl.offsetTop > detailsEl.offsetTop);
      if (labelEl) labelEl.style.display = "";
      setStacked(shouldStack);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [hasBoth]);
  return (
    <div
      ref={containerRef}
      className="flex min-w-0 flex-wrap items-start gap-x-[var(--aries-inspector-column-gap)] gap-y-[var(--aries-inspector-row-gap)]"
    >
      {details ? (
        <div ref={detailsRef} className="flex min-w-0 flex-auto flex-col gap-[var(--aries-inspector-row-gap)]">
          {details}
        </div>
      ) : null}
      {aspects ? (
        <div
          ref={aspectsRef}
          className={cn("flex min-w-0 flex-auto items-baseline gap-x-[var(--aries-inspector-heading-gap)]", TEXT_SMALL)}
        >
          <span ref={stackedLabelRef} hidden={!stacked} className={cn(INSPECTOR_ROW_LABEL, INSPECTOR_LABEL_COLOR)}>{t("inspector.aspectsLabel")}</span>
          <div className="flex min-w-0 flex-auto flex-col gap-[var(--aries-inspector-row-gap)]">{aspects}</div>
        </div>
      ) : null}
    </div>
  );
}

/** A detail row: "Label: value" split on the first colon (matches the wx
 * FlexGrid split, workspace_shell.py:1760-1766); no-colon rows render whole. */
function DetailRow({
  text,
  valueSpans,
  status,
}: {
  text: string;
  valueSpans?: InspectorFlagSpan[];
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
    <div className={cn("flex min-w-0 flex-wrap items-baseline gap-x-[var(--aries-inspector-heading-gap)] gap-y-[var(--aries-inspector-row-gap)]", TEXT_SMALL)}>
      <span className={cn(INSPECTOR_ROW_LABEL, INSPECTOR_LABEL_COLOR)} title={label}>{label}</span>
      <span
        className={cn("min-w-0 tabular-nums", INSPECTOR_VALUE_COLOR)}
        style={INSPECTOR_WRAP_STYLE}
      >{valueSpans?.length ? <InspectorValueSpans spans={valueSpans} /> : value}</span>
      {status ? (
        <span className="inline-flex min-w-0 max-w-full items-baseline gap-[var(--aries-control-gap-compact)]">
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
          <span className="min-w-0 font-medium" style={{ color: status.color, ...INSPECTOR_WRAP_STYLE }}>
            {status.label}
          </span>
        </span>
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
function AspectRow({ item, inline = false }: { item: InspectorAspectItem; inline?: boolean }) {
  const colour = semanticChartColor(item.aspect_colour_role, rgb(item.aspect_colour));
  const [suffixLead, suffixTail] = splitLeadingToken(item.suffix_text ?? "");
  const Tag = inline ? "span" : "div";
  if (item.left && item.right && item.orb_text) {
    return (
      <Tag
        className={cn("min-w-0 tabular-nums leading-snug", INSPECTOR_VALUE_COLOR, inline ? TEXT_SECTION : TEXT_SMALL)}
        style={INSPECTOR_WRAP_STYLE}
        title={item.full_text}
        aria-label={item.full_text}
      >
        <span className="whitespace-nowrap" aria-hidden>
          <AspectEndpoint endpoint={item.left} />
          {"\u00a0"}
          <span style={{ fontFamily: "'AriesMorinus'", color: colour ?? undefined }}>{item.aspect_glyph}</span>
          {"\u00a0"}
          <AspectEndpoint endpoint={item.right} />
        </span>
        <span aria-hidden>
          {item.state_text ? ` ${item.state_text}` : null}{" "}
          <span className={item.exact ? "font-semibold" : undefined}>{item.orb_text}</span>
        </span>
      </Tag>
    );
  }
  return (
    <Tag className={cn("min-w-0 tabular-nums leading-snug", INSPECTOR_VALUE_COLOR, inline ? TEXT_SECTION : TEXT_SMALL)} style={INSPECTOR_WRAP_STYLE}>
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
    </Tag>
  );
}

/** One side of a glyph aspect row: ring numeral + dignity-coloured glyph, else its short label;
 * the inspected object's own side is faded by --aries-inspector-own-glyph-opacity. */
function AspectEndpoint({ endpoint }: { endpoint: InspectorAspectEndpoint }) {
  const colour = semanticChartColor(endpoint.colour_role, rgb(endpoint.colour));
  return (
    <span style={endpoint.own ? { opacity: "var(--aries-inspector-own-glyph-opacity)" } : undefined}>
      {endpoint.ring ? `${endpoint.ring}\u00a0` : null}
      {endpoint.glyph ? (
        <span style={{ fontFamily: "var(--aries-font-symbols)", color: colour ?? undefined }}>{endpoint.glyph}</span>
      ) : endpoint.text}
    </span>
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
  const sections = passages.sections ?? (section ? [{ packId: passages.packId, section }] : []);

  if (!section) {
    return (
      <div className={cn(INSPECTOR_SECTION_BOX, INSPECTOR_LABEL_COLOR, TEXT_SMALL)}>
        {t("inspector.sourceHint")}
      </div>
    );
  }

  return (
    <>
      {sections.map(({ packId, section }) => (
        <div key={packId} className={INSPECTOR_SECTION_BOX}>
          <SignificationText packId={packId} section={section} />
        </div>
      ))}
    </>
  );
});

/** Plain Valens definition text shaped like wx QuoteTextPane. */
function SignificationText({ packId, section }: { packId: string; section: InspectorPassageSection }) {
  const cardId = `passage:${packId}`;
  const open = useInspectorCardStore((state) => !state.collapsed[cardId]);
  const setOpen = useInspectorCardStore((state) => state.setOpen);
  const paragraphs = section.paragraphs ?? [];

  return (
    <Collapsible open={open} onOpenChange={(nextOpen) => setOpen(cardId, nextOpen)} className={cn("min-w-0 leading-relaxed", INSPECTOR_VALUE_COLOR, TEXT_READING)} style={INSPECTOR_WRAP_STYLE}>
      <CollapsibleTrigger className={cn("flex w-full items-start gap-[var(--aries-inspector-heading-gap)] whitespace-normal text-left leading-snug italic focus-visible:outline-ring/50 focus-visible:outline-2", open && "mb-[var(--aries-inspector-citation-gap)]", INSPECTOR_LABEL_COLOR, TEXT_SMALL)}>
        <span className="min-w-0 flex-1">
          <PassageRuns runs={section.citation_runs} fallback={section.citation_label || section.source} />
        </span>
        <CardChevron open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        {section.paragraphs != null ? (
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
              <div key={`footnote-${index}`}><PassageRuns runs={section.footnote_runs?.[index]} fallback={note} /></div>
            ))}
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function CardChevron({ open }: { open: boolean }) {
  return <ChevronDown aria-hidden="true" className={cn("size-[1em] shrink-0 self-center", INSPECTOR_MUTED_COLOR, !open && "-rotate-90")} />;
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
      return <CorpusGlyph text={run.text} colors={run.signColors} />;
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
    <div className={INSPECTOR_SECTION_BOX} style={INSPECTOR_WRAP_STYLE}>
      <SectionLabel>{heading || t("inspector.packAlerts")}</SectionLabel>
      <div className="flex flex-col gap-[var(--aries-inspector-padding-bottom)]">
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
  const cardId = `alert:${alert.pack ?? "inline"}:${alert.ruleId ?? alert.titleKey ?? alert.title}`;
  const open = useInspectorCardStore((state) => !state.collapsed[cardId]);
  const setOpen = useInspectorCardStore((state) => state.setOpen);
  const dot = (alert.status && ALERT_STATUS_COLOUR[alert.status]) || "var(--aries-status-neutral)";
  const title = alert.titleKey ? tf(alert.titleKey, alert.title) : alert.title;
  const body = alert.bodyKey ? tf(alert.bodyKey, alert.body) : alert.body;
  return (
    <Collapsible open={open} onOpenChange={(nextOpen) => setOpen(cardId, nextOpen)} style={INSPECTOR_WRAP_STYLE} className="min-w-0 bg-[var(--aries-inspector-card-background)] px-[var(--aries-inspector-card-padding-x)]">
      <CollapsibleTrigger className={cn("flex w-full items-start gap-[var(--aries-inspector-heading-gap)] py-[var(--aries-inspector-card-padding-y)] whitespace-normal text-left leading-snug focus-visible:outline-ring/50 focus-visible:outline-2", TEXT_READING)}>
        <span className="flex h-[1lh] shrink-0 items-center" aria-hidden>
          <span
            className="size-[var(--aries-inspector-status-dot-size)] rounded-full"
            data-aries-true-color=""
            style={{ backgroundColor: dot }}
          />
        </span>
        <span className="flex h-[1lh] min-w-[length:calc(var(--aries-inspector-alert-glyph-size)*var(--aries-inspector-text-scale,1))] shrink-0 items-center justify-center" aria-hidden>
          {alert.glyph ? (
            <CorpusGlyph
              text={alert.glyph}
              colors={alert.glyphColors}
              className={cn("leading-none", INSPECTOR_READING_COLOR, INSPECTOR_ALERT_GLYPH_TEXT)}
            />
          ) : null}
        </span>
        <span className={cn("min-w-0 flex-1 font-semibold leading-snug", INSPECTOR_TITLE_COLOR, TEXT_READING)}>
          {title}
        </span>
        <span className="flex h-[1lh] shrink-0 items-center">
          <CardChevron open={open} />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted className="pb-[var(--aries-inspector-card-padding-y)]">
        {body ? (
          <p className={cn("leading-relaxed whitespace-pre-line", INSPECTOR_VALUE_COLOR, TEXT_READING)}>{body}</p>
        ) : null}
        {alert.cite ? (
          <div className={cn("mt-[var(--aries-inspector-heading-gap)] leading-snug italic", INSPECTOR_MUTED_COLOR, TEXT_SMALL)}>{alert.cite}</div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

const inspectorAscensionalPayloads = new Map<string, InspectorAscensionalTransitsPayload>();

/**
 * Ascensional transits of an AT event document: the event frame, in-orb
 * contacts (each the wheel contact it is drawn as) and approaching contacts.
 * The two-transit rule marks the rows it supports; it never hides a row.
 */
const InspectorAscensionalTransits = React.memo(function InspectorAscensionalTransits({
  documentId,
  viewSide,
  scene,
  parentDocumentId,
  lastSessionChange,
  lastOptionsChange,
}: {
  documentId: string;
  viewSide?: "left" | "right";
  scene: NonNullable<ChartRenderSnapshot["ascensionalScene"]>;
  parentDocumentId?: string | null;
  lastSessionChange: WorkspaceSessionChange | null;
  lastOptionsChange: WorkspaceOptionsChange | null;
}) {
  const t = useT();
  const cacheKey = `${documentId}:${viewSide ?? "document"}`;
  const [payloadState, setPayloadState] = React.useState<{
    documentId: string;
    payload: InspectorAscensionalTransitsPayload;
  } | null>(null);
  const [methodPending, setMethodPending] = React.useState(false);
  const [contextRowId, setContextRowId] = React.useState<string | null>(null);
  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId,
    parentDocumentId,
    lastSessionChange,
    lastOptionsChange,
    refreshOnInspectorDataChange: true,
  });

  React.useEffect(() => {
    const controller = new AbortController();
    fetchInspectorAscensionalTransits(documentId, controller.signal, viewSide)
      .then((payload) => {
        // Null while the snapshot that still shows this section is replaced.
        if (controller.signal.aborted || !payload) return;
        inspectorAscensionalPayloads.set(cacheKey, payload);
        setPayloadState({ documentId: cacheKey, payload });
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        console.error("[inspector:ascensional-transits]", err);
      });
    return () => controller.abort();
  }, [documentId, refreshSeq, viewSide, scene.contactMethod, cacheKey]);

  const payload = payloadState?.documentId === cacheKey
    ? payloadState.payload
    : inspectorAscensionalPayloads.get(cacheKey) ?? null;
  if (!payload) return null;

  const changeMethod = (applyPrecession: boolean) => {
    setPayloadState({ documentId: cacheKey, payload: { ...payload, precession: { ...payload.precession, applied: applyPrecession } } });
    setMethodPending(true);
    setAscensionalMethod(documentId, applyPrecession)
      .catch((err) => {
        setPayloadState({ documentId: cacheKey, payload });
        console.error("[inspector:ascensional-method]", err);
      })
      .finally(() => setMethodPending(false));
  };
  const eventText = payload.supportsEvent ? `${t("inspector.ascensional.eventTime")} ${payload.event.datetimeText} · ${t("inspector.ascensional.ramc")} ${payload.event.ramcText}` : null;

  return (
    <div className={INSPECTOR_SECTION_BOX} data-aries-inspector-section="ascensional-transits">
      {/* Event header only for AT event documents; an ordinary ascensional
          view lists its contacts directly under one heading. */}
      {payload.supportsEvent ? <>
      <SectionLabel>{t("inspector.ascensional.title")}</SectionLabel>
      <div className="flex flex-col gap-[var(--aries-inspector-row-gap)]">
        <InspectorLabeledValue label={t("inspector.ascensional.eventTime")} value={payload.event.datetimeText} />
        <InspectorLabeledValue label={t("inspector.ascensional.ramc")} value={payload.event.ramcText} />
        <AscensionalPrecessionToggle precession={payload.precession} pending={methodPending} onChange={changeMethod} />
        <div className={cn("flex items-center gap-[var(--aries-inspector-heading-gap)]", INSPECTOR_LABEL_COLOR, TEXT_SMALL)}>
          <Repeat2 className="size-[1em] shrink-0" aria-hidden />
          <span>
            {payload.twoTransit.isActiveMoment
              ? t("inspector.ascensional.activeMoment", { count: payload.twoTransit.activeAspectCount })
              : t("inspector.ascensional.passiveMoment")}
          </span>
        </div>
      </div>
      </> : payload.precession.available ? (
        <AscensionalPrecessionToggle precession={payload.precession} pending={methodPending} onChange={changeMethod} />
      ) : null}
      {payload.sections.map((section, index) => (
        <React.Fragment key={section.id}>
          {payload.supportsEvent || payload.precession.available || index > 0 ? <Divider /> : null}
          <SectionLabel>{section.title}</SectionLabel>
          {section.rows.length ? (
            <table
              aria-label={section.title}
              className={cn("w-full table-auto border-collapse leading-snug", TEXT_BASE)}
            >
              <tbody>
                {section.rows.map((row) => (
                  <AscensionalTransitRowMenu
                    key={row.id}
                    row={row}
                    eventText={eventText}
                    active={contextRowId === row.id}
                  >
                    <AscensionalTransitRow
                      row={row}
                      onMenuOpen={() => setContextRowId(row.id)}
                    />
                  </AscensionalTransitRowMenu>
                ))}
              </tbody>
            </table>
          ) : section.emptyText ? (
            <div className={cn(INSPECTOR_MUTED_COLOR, TEXT_SMALL)}>{section.emptyText}</div>
          ) : null}
        </React.Fragment>
      ))}
    </div>
  );
});

/** The single precession switch of every ascensional view; the measure lives in Settings. */
function AscensionalPrecessionToggle({ precession, pending, onChange }: {
  precession: InspectorAscensionalTransitsPayload["precession"];
  pending: boolean;
  onChange: (applyPrecession: boolean) => void;
}) {
  const t = useT();
  const measure = t(precession.measure === "equatorial"
    ? "inspector.ascensional.precessionEquatorial"
    : "inspector.ascensional.precessionEcliptic");
  const detail = [
    `${measure} ${precession.rateText}`,
    precession.applied ? precession.correctionText : "",
    precession.experimental ? t("inspector.ascensional.precessionExperimental") : "",
  ].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col">
      <label className={cn("flex items-center gap-[var(--aries-inspector-heading-gap)]", INSPECTOR_VALUE_COLOR, TEXT_SMALL)}>
        <input
          type="checkbox"
          checked={precession.applied}
          disabled={pending}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span>{t("asctransit.precessionCorrection")}</span>
      </label>
      <span className={cn(INSPECTOR_LABEL_COLOR, TEXT_SMALL)} style={INSPECTOR_WRAP_STYLE}>{detail}</span>
    </div>
  );
}

function InspectorLabeledValue({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("flex min-w-0 items-baseline gap-[var(--aries-inspector-heading-gap)]", TEXT_SMALL)}>
      <span className={cn(INSPECTOR_ROW_LABEL, INSPECTOR_LABEL_COLOR)} title={label}>{label}</span>
      <span className={cn("min-w-0 tabular-nums", INSPECTOR_VALUE_COLOR)} style={INSPECTOR_WRAP_STYLE}>{value}</span>
    </div>
  );
}

function ascensionalRowLabel(row: InspectorAscensionalRow): string {
  return [row.transit.label, row.aspect.label, row.radix.label, row.orbText, row.statusText]
    .filter(Boolean)
    .join(" ");
}

/** Localized explanation of a row's two-transit cue; null when the rule does not hold. */
function useTwoTransitCue(row: InspectorAscensionalRow): string | null {
  const t = useT();
  if (!row.twoTransit.length) return null;
  return t("inspector.ascensional.twoTransitCue", {
    body: row.transit.label,
    aspects: row.twoTransit
      .map((aspect) => `${aspect.radixLabel} ${aspect.aspectLabel ?? `${aspect.aspectDeg}°`} (${aspect.orbText})`)
      .join(", "),
  });
}

function AscensionalGlyph({ item }: { item: InspectorAscensionalGlyph }) {
  return (
    <span
      className="whitespace-nowrap"
      style={item.font === "morinus" ? { fontFamily: "'AriesMorinus'" } : undefined}
      title={item.label}
      aria-hidden
    >
      {item.glyph}
    </span>
  );
}

const AscensionalTransitRow = React.forwardRef<
  HTMLTableRowElement,
  {
    row: InspectorAscensionalRow;
    onMenuOpen: () => void;
  } & React.HTMLAttributes<HTMLTableRowElement>
>(function AscensionalTransitRow({ row, onMenuOpen, className, ...props }, ref) {
  const cue = useTwoTransitCue(row);
  const cell = "pr-[var(--aries-control-gap-compact)] align-baseline whitespace-nowrap last:pr-0";
  return (
    <tr
      {...props}
      ref={ref}
      aria-label={ascensionalRowLabel(row)}
      data-two-transit={cue ? "true" : undefined}
      onContextMenu={(event) => {
        onMenuOpen();
        props.onContextMenu?.(event);
      }}
      className={className}
    >
      <td className={cn(cell, "w-[1.25em] text-center")}>
        {cue ? (
          <span
            role="img"
            aria-label={cue}
            title={cue}
            className={cn("inline-flex align-middle", INSPECTOR_STRONG_COLOR)}
          >
            <Repeat2 className="size-[0.9em]" aria-hidden />
          </span>
        ) : null}
      </td>
      <td className={cn(cell, INSPECTOR_VALUE_COLOR)}>
        <span className="inline-flex items-baseline gap-[var(--aries-control-gap-compact)]">
          <AscensionalGlyph item={row.transit} />
          <AscensionalGlyph item={row.aspect} />
          <AscensionalGlyph item={row.radix} />
        </span>
      </td>
      <td className={cn(cell, "text-right tabular-nums", INSPECTOR_VALUE_COLOR)}>{row.orbText}</td>
      <td className={cn(cell, "text-right", INSPECTOR_MUTED_COLOR, TEXT_SMALL)}>{row.statusText}</td>
    </tr>
  );
});

/** One lazy menu, built only for the row that was right-clicked. */
function AscensionalTransitRowMenu({
  row,
  eventText,
  active,
  children,
}: {
  row: InspectorAscensionalRow;
  eventText: string | null;
  active: boolean;
  children: React.ReactElement;
}) {
  const t = useT();
  const copy = (text: string) => {
    void copyTextToClipboard(text).catch((err) => console.error("[inspector:ascensional-copy]", err));
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      {active ? (
        <ContextMenuContent className="w-64">
          <ContextMenuItem onClick={() => copy(ascensionalRowLabel(row))}>
            <Clipboard className="size-[var(--aries-control-icon-size)]" />
            {t("inspector.ascensional.copyContact")}
          </ContextMenuItem>
          {eventText ? <ContextMenuItem onClick={() => copy(eventText)}>
            <Clipboard className="size-[var(--aries-control-icon-size)]" />
            {t("inspector.ascensional.copyEvent")}
          </ContextMenuItem> : null}
          <ContextMenuSeparator />
          <InspectorTextSizeChoices />
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
}

type InspectorSpeculumRow = {
  id: string;
  label: string;
  isMoon: boolean;
  voidOfCourse: boolean;
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
  if (cell.glyph) return { ...cell, text: undefined, voidOfCourse: false };
  const glyphRuns = cell.runs?.filter((run) => run.glyph);
  return glyphRuns?.length ? { ...cell, text: undefined, runs: glyphRuns } : undefined;
}

/** The wheel's visible layers as a lens over Speculum body rows. */
export type SpeculumVisibility = {
  bodyIds: ReadonlySet<number>;
  showFortune: boolean;
  showVertex: boolean;
  showSyzygy: boolean;
  showEclipse: boolean;
};

/** Visibility from the chart snapshot, stable while only positions move. */
export function useSpeculumVisibility(chart: ChartRenderSnapshot | null): SpeculumVisibility | null {
  const primary = chart?.primaryChart;
  const bodyKey = primary ? primary.planets.map((planet) => planet.seId).join(",") : null;
  const showFortune = Boolean(primary?.fortune) && primary?.options.showLoF !== false;
  const showVertex = Boolean(primary?.vertex) && primary?.options.showVertex !== false;
  const showSyzygy = primary?.options.showPrenatalSyzygy === true;
  const showEclipse = primary?.options.showPrenatalEclipse === true;
  return React.useMemo(
    () => bodyKey === null ? null : {
      bodyIds: new Set(bodyKey ? bodyKey.split(",").map(Number) : []),
      showFortune,
      showVertex,
      showSyzygy,
      showEclipse,
    },
    [bodyKey, showFortune, showVertex, showSyzygy, showEclipse],
  );
}

/** Whether one Speculum "planets" section row is on the wheel. Angles and
 * other sections are not body layers and always pass. */
export function isSpeculumBodyRowVisible(
  sectionId: string,
  row: GenericTableRow,
  bodyCell: GenericTableCell | undefined,
  visibility: SpeculumVisibility,
): boolean {
  if (sectionId !== "planets") return true;
  if (row.id === "fortune") return visibility.showFortune;
  if (row.id === "vertex") return visibility.showVertex;
  if (row.id === "syzygy") return visibility.showSyzygy;
  if (row.id === "eclipse") return visibility.showEclipse;
  return visibility.bodyIds.has(bodyCell?.planet ?? NaN);
}

function inspectorSpeculumRows(
  payload: GenericTablePayload,
  visibility: SpeculumVisibility,
): InspectorSpeculumRow[] {
  // The full table can intentionally include hidden bodies (the “in tables”
  // preference). The inspector is a display lens over those retained rows.
  const textOptions = {
    preserveAngleSeconds: payload.capabilities?.anglePrecision === "seconds",
  };
  return (payload.speculumInspector?.sections ?? payload.sections ?? [])
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
        if (!isSpeculumBodyRowVisible(section.id, row, row.cells[bodyIndex], visibility)) return [];
        const bodyCell = row.cells[bodyIndex];
        const longitudeCell = row.cells[longitudeIndex];
        const latitudeCell = latitudeIndex >= 0 ? row.cells[latitudeIndex] : undefined;
        const declinationCell = declinationIndex >= 0 ? row.cells[declinationIndex] : undefined;
        const speedCell = speedIndex >= 0 ? row.cells[speedIndex] : undefined;
        const houseCell = houseIndex >= 0 ? row.cells[houseIndex] : undefined;
        const label = tableCellText(bodyCell, textOptions).trim();
        if (!bodyCell || !longitudeCell || !label) return [];
        return [{
          id: `${section.id}:${row.id}`,
          label,
          isMoon: bodyCell.planet === SE_MOON,
          voidOfCourse: bodyCell.voidOfCourse === true,
          bodyGlyphCell: speculumBodyGlyphCell(bodyCell),
          longitudeCell,
          longitudeText: tableCellText(longitudeCell, textOptions),
          latitudeCell,
          latitudeText: tableCellText(latitudeCell, textOptions),
          declinationCell,
          declinationText: tableCellText(declinationCell, textOptions),
          declinationOutOfBounds: row.meta?.declinationOutOfBounds === true,
          speedCell,
          speedText: tableCellText(speedCell, textOptions),
          houseCell,
          houseText: tableCellText(houseCell, textOptions),
        }];
      });
    });
}

function InspectorSpeculum({
  chart,
  precision,
  visible,
  documentId,
  parentDocumentId,
  lastSessionChange,
  lastOptionsChange,
}: {
  chart: ChartRenderSnapshot;
  precision: InspectorSpeculumPrecision;
  visible: boolean;
  documentId: string;
  parentDocumentId?: string | null;
  lastSessionChange: WorkspaceSessionChange | null;
  lastOptionsChange: WorkspaceOptionsChange | null;
}) {
  const t = useT();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const tableRef = React.useRef<HTMLTableElement>(null);
  const [payloadState, setPayloadState] = React.useState<{
    documentId: string;
    payload: GenericTablePayload;
  } | null>(() => {
    const payload = getCachedGenericTablePayload("positions", documentId);
    return payload ? { documentId, payload } : null;
  });
  const requestSeqRef = React.useRef(0);
  const inFlightRef = React.useRef<AbortController | null>(null);
  const [restartTick, setRestartTick] = React.useState(0);
  const { active: stepBurstActive } = useStepBurst();
  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId,
    parentDocumentId,
    lastSessionChange,
    lastOptionsChange,
    refreshOnInspectorDataChange: true,
  });
  // Follow arrow stepping: the step snapshot brings this table's rows. The
  // settled refresh below still catches up options and non-step changes.
  const liveKey = `speculum:${documentId}`;
  useLiveSurfaceRequest(
    visible
      ? { key: liveKey, kind: "table", documentId, tableId: "positions", view: "speculum-inspector" }
      : null,
    LIVE_SURFACE_PRIORITY.speculum,
  );
  useFreshLivePayload<GenericTablePayload>(
    liveSurfaceResult(chart, liveKey),
    // The slim Inspector view stays out of the shared table cache, which holds
    // full Speculum payloads; the settled refresh re-caches the full one.
    (livePayload) => {
      // A fetch already in flight may predate this step and must not land on
      // top of it. Supersede it now; the fetch effect waits for the burst's
      // completion edge before restarting. Browser abort cannot stop work
      // already running in the daemon, so never restart between live steps.
      requestSeqRef.current += 1;
      if (inFlightRef.current) {
        inFlightRef.current.abort();
        inFlightRef.current = null;
        setRestartTick((tick) => tick + 1);
      }
      setPayloadState({ documentId, payload: livePayload });
    },
  );

  React.useEffect(() => {
    if (!visible) return;
    if (stepBurstActive) return;
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
    inFlightRef.current = controller;
    fetchGenericTablePayload("positions", documentId, controller.signal)
      .finally(() => {
        if (inFlightRef.current === controller) inFlightRef.current = null;
      })
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
  }, [documentId, refreshSeq, visible, restartTick, stepBurstActive]);

  const payload = payloadState?.documentId === documentId
    ? payloadState.payload
    : getCachedGenericTablePayload("positions", documentId);
  const preserveAngleSeconds = payload?.capabilities?.anglePrecision === "seconds";
  // The wheel's changing positions do not change this projection. Preserve
  // row identity until table data or visibility changes, so memoized rows do
  // not render the old table again on each urgent wheel publication.
  const visibility = useSpeculumVisibility(chart);
  const rows = React.useMemo(
    () => payload && visibility ? inspectorSpeculumRows(payload, visibility) : [],
    [payload, visibility],
  );
  // Re-arm the fit when the row set or display preferences change. Stepped values that change a
  // column's width reach the observer through the table's own resize, so a live
  // step never resets the fit steps and re-measures the whole table.
  const rowSignature = rows.map((row) => row.id).join("\u0000");
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const table = tableRef.current;
    if (!visible || !container || !table) return;
    return observeInspectorSpeculumFit(container, table);
  }, [visible, rowSignature, lastOptionsChange, precision]);
  if (!visible || !rows.length) return null;
  const columns = (payload?.speculumInspector?.sections ?? payload?.sections)?.find(
    (section) => section.id === "ascmc" || section.id === "planets",
  )?.columns ?? payload?.speculumInspector?.columns ?? payload?.columns ?? [];
  const columnLabel = (id: string) => {
    const column = columns.find((candidate) => candidate.id === id);
    return column?.exportLabel ?? column?.label ?? "";
  };

  return (
    <div ref={containerRef} className={cn(INSPECTOR_SECTION_BOX, "aries-inspector-speculum")}>
      <div className="min-w-0 max-w-full">
      <table
        ref={tableRef}
        aria-label={t("sidebar.action.table:positions")}
        className={cn(
          "w-full max-w-full table-auto border-collapse leading-snug",
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
                  <span className="aries-inspector-speculum-heading">{label}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <InspectorSpeculumTableRow key={row.id} row={row} precision={precision} preserveAngleSeconds={preserveAngleSeconds} />
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/** Memoized per row: a parent render with an unchanged payload (every stepped
 * chart re-renders the Inspector) reuses the rows instead of reconciling them. */
const InspectorSpeculumTableRow = React.memo(function InspectorSpeculumTableRow({
  row,
  precision,
  preserveAngleSeconds,
}: {
  row: InspectorSpeculumRow;
  precision: InspectorSpeculumPrecision;
  preserveAngleSeconds: boolean;
}) {
  return (
    <tr>
      <td
        title={row.label}
        className="pr-[var(--aries-control-gap-compact)] align-baseline whitespace-nowrap last:pr-0"
      >
        <span className="inline-flex items-baseline gap-[var(--aries-control-gap-compact)]">
          <span className="inline-flex w-[1.25em] shrink-0 justify-center leading-none" aria-hidden>
            <CellView cell={row.bodyGlyphCell} preserveAngleSeconds={preserveAngleSeconds} />
          </span>
          <span
            className={cn(INSPECTOR_VALUE_COLOR, "aries-inspector-speculum-body-label")}
            data-long-word={/\p{L}{8,}|[\p{sc=Han}\p{sc=Hira}\p{sc=Kana}ー]{6,}/u.test(row.label) || undefined}
          >
            {row.label}
            {row.isMoon ? <VoidOfCourseSuffix visible={row.voidOfCourse} /> : null}
          </span>
        </span>
      </td>
      <td
        aria-label={row.longitudeText}
        title={row.longitudeText}
        className={cn("pr-[var(--aries-control-gap-compact)] whitespace-nowrap text-right tabular-nums last:pr-0", INSPECTOR_VALUE_COLOR)}
      >
        <span aria-hidden><InspectorSpeculumAngle cell={row.longitudeCell} column="lon" precision={precision} /></span>
      </td>
      <td
        aria-label={row.latitudeText || undefined}
        title={row.latitudeText || undefined}
        className={cn("pr-[var(--aries-control-gap-compact)] whitespace-nowrap text-right tabular-nums last:pr-0", INSPECTOR_VALUE_COLOR)}
      >
        <span aria-hidden><InspectorSpeculumAngle cell={row.latitudeCell} column="lat" precision={precision} /></span>
      </td>
      <td
        aria-label={row.declinationText || undefined}
        title={row.declinationText || undefined}
        className={cn(
          "pr-[var(--aries-control-gap-compact)] whitespace-nowrap text-right tabular-nums last:pr-0",
          row.declinationOutOfBounds ? "text-destructive" : INSPECTOR_VALUE_COLOR,
        )}
      >
        <span aria-hidden><InspectorSpeculumAngle cell={row.declinationCell} column="decl" precision={precision} /></span>
      </td>
      <td
        aria-label={row.speedText || undefined}
        title={row.speedText || undefined}
        className={cn("pr-[var(--aries-control-gap-compact)] whitespace-nowrap text-right tabular-nums last:pr-0", INSPECTOR_VALUE_COLOR)}
      >
        <span aria-hidden><InspectorSpeculumSpeed cell={row.speedCell} precision={precision} /></span>
      </td>
      <td
        aria-label={row.houseText || undefined}
        className={cn("whitespace-nowrap text-right tabular-nums", INSPECTOR_VALUE_COLOR)}
      >
        <span aria-hidden><CellView cell={row.houseCell} preserveAngleSeconds={preserveAngleSeconds} /></span>
      </td>
    </tr>
  );
});

function ChartSummary({ chart }: { chart: ChartRenderSnapshot | null }) {
  const t = useT();
  const mobile = useMobileLayout();
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
    <div className="flex flex-col gap-0 px-[var(--aries-inspector-padding-x)] pb-[var(--aries-inspector-padding-bottom)] pr-[var(--aries-inspector-summary-close-reserve)] pt-[var(--aries-inspector-padding-top)]" style={INSPECTOR_WRAP_STYLE}>
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
      <div className={cn("mt-[var(--aries-inspector-section-gap)]", INSPECTOR_LABEL_COLOR, TEXT_SMALL)}>{t(mobile ? "inspector.tap" : "inspector.hover")}</div>
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
