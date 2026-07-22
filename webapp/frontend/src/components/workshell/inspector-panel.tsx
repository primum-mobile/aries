"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  corpusDisciplinesCached,
  invalidateCorpusDisciplines,
  fetchAlerts,
  type CorpusDiscipline,
  fetchInspectorPayload,
  fetchPassages,
  type InspectorAlert,
  type InspectorAlertsPayload,
  type InspectorAspectItem,
  type InspectorDignityItem,
  type InspectorManzil,
  type InspectorPassagesPayload,
  type InspectorPassageParagraph,
  type InspectorPassageRun,
  type InspectorPassageSection,
  type InspectorPayload,
  type RGB,
  workspaceMirrorLens,
} from "@/lib/daemon/client";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
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
import { useLocale, useT } from "@/lib/i18n/i18n";
import { semanticChartColor } from "@/lib/theme/semantic-color";
const INSPECTOR_PAYLOAD_KINDS = new Set([
  "planet",
  "vertex",
  "fortune",
  "syzygy",
  "angle",
  "house",
  "sign",
  "secondary_ring",
  "aspect",
]);

const TEXT_BASE = "text-[length:var(--aries-font-size-base)]";
const TEXT_READING = "text-[length:var(--aries-font-size-reading)]";
const TEXT_SMALL = "text-[length:var(--aries-font-size-small)]";
const TEXT_SECTION = "text-[length:var(--aries-font-size-section)]";
const TEXT_HEADER = "text-[length:var(--aries-font-size-header)]";
const TEXT_ARABIC = "text-[length:var(--aries-font-size-arabic)]";
const INSPECTOR_TITLE_TEXT = "text-[length:var(--aries-inspector-title-size)]";
const INSPECTOR_GLYPH_TEXT = "text-[length:var(--aries-inspector-glyph-size)]";
const INSPECTOR_ALERT_GLYPH_TEXT = "text-[length:var(--aries-inspector-alert-glyph-size)]";
const INSPECTOR_PACK_TAG_TEXT = "text-[length:var(--aries-inspector-pack-tag-size)]";
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
  useHoraryLensPersistence(activeDoc);

  const closeInspector = React.useCallback(() => {
    useWorkspaceStore.getState().setInspectorActiveRegion(null);
    setInspectorOpen(false);
  }, [setInspectorOpen]);

  return (
    <aside className={cn("relative flex h-full w-full min-w-0 flex-col gap-0 overflow-y-auto bg-[var(--aries-inspector-background)]", INSPECTOR_VALUE_COLOR, TEXT_BASE)}>
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
      {/* Zone B — source-text passages (keyed to the active region) + pack
          alerts (keyed to the active chart's lens). Rendered verbatim. */}
      {region ? <PassagesZone passages={passages} /> : null}
      <LensPickerSection />
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
  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId: docId ?? "",
    lastSessionChange,
    lastOptionsChange,
  });

  const canFetch = Boolean(
    region && kind && INSPECTOR_PAYLOAD_KINDS.has(kind) && objectId != null && sourceName,
  );
  const primaryChartIdentity = stableRenderChartIdentity(chart?.primaryChart);
  const partnerSensitive =
    chartRole === "outer" || (region?.kind === "aspect" && region.scope === "interchart");
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
      },
      controller.signal,
    )
      .then((payload) => {
        if (controller.signal.aborted) return;
        setPayloadState({ identity: payloadIdentity, payload });
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
  }, [canFetch, payloadIdentity, kind, objectId, docId, chartRole, sourceName, hereNow, supplementaryKind, comparisonName, viewMode, when, bindingJson, refreshSeq]);

  return canFetch ? payloadState?.payload ?? null : null;
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
  // Planet/sign source text is standing content. A live document id already
  // resolves the current session chart, so its changing cursor must not refetch
  // and rerender the passage on every step. The fallback loader still needs a
  // datetime when no live document exists.
  const when = docId ? undefined : snapshotDisplayDatetime(chart, activeDoc);

  const canFetch = Boolean(region && kind && objectId != null && sourceName);
  const passagesIdentity = canFetch
    ? JSON.stringify([radixBranchId, kind, objectId, locale])
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
  }, [canFetch, passagesIdentity, kind, objectId, docId, sourceName, hereNow, supplementaryKind, comparisonName, viewMode, when, bindingJson]);

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
  }, [canFetch, alertsIdentity, discipline, theme, context, docId, sourceName, hereNow, supplementaryKind, viewMode, when, bindingJson, packsVersion, refreshSeq]);

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
 * stays reachable (the web skin has no discipline picker yet).
 */
/**
 * Interpretation lens picker — web twin of the wx inspector control strip's
 * Discipline / Theme inline pickers (workspace_shell.py:2441-2454, built
 * :1519-1602). Items come from GET /api/corpus/disciplines
 * (rule_engine.registered_disciplines / theme_labels_for); the em-dash row
 * clears the selection, exactly like the wx pickers. Committing a lens follows
 * morin._on_inspector_interpretation_change (morin.py:9026-9042): the lens is
 * set only when BOTH discipline and theme are chosen; horary themes seed the
 * default significator context shipped by the catalog. The lens may also be
 * set externally (Charts > Elections / Horary native menu) — the pickers
 * follow it, mirroring wx set_pack_alerts syncing the strip
 * (workspace_shell.py:2594-2596).
 */
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
function useHoraryLensPersistence(activeDoc: WorkspaceDocument | null) {
  const lens = useWorkspaceStore((s) => s.inspectorLens);
  const docRef = React.useRef(activeDoc);
  const docId = activeDoc?.id ?? null;
  // Keep the latest active doc readable from the lens-keyed mirror effect
  // without making it a dependency (wx never mirrors on tab switch). Declared
  // FIRST so it runs before the adoption/mirror effects below.
  React.useEffect(() => {
    docRef.current = activeDoc;
  });

  React.useEffect(() => {
    const doc = docRef.current;
    if (!doc || doc.id !== docId) return;
    if (doc.isHorary && doc.interpretation) {
      useWorkspaceStore.getState().setInspectorLens({
        discipline: doc.interpretation.discipline,
        theme: doc.interpretation.theme,
        context: doc.interpretation.context ?? undefined,
      });
    }
  }, [docId]);

  // Skip the mount run: mirroring the initial (possibly null) lens would
  // wrongly clear a saved question before adoption lands.
  const mirrorReady = React.useRef(false);
  React.useEffect(() => {
    if (!mirrorReady.current) {
      mirrorReady.current = true;
      return;
    }
    const doc = docRef.current;
    if (!doc?.isHorary) return;
    workspaceMirrorLens(doc.id, lens ?? null).catch((err) =>
      console.error("[inspector:lens-mirror]", err),
    );
  }, [lens]);
}

const LensPickerSection = React.memo(function LensPickerSection() {
  const t = useT();
  const lens = useWorkspaceStore((s) => s.inspectorLens);
  const [catalog, setCatalog] = React.useState<CorpusDiscipline[] | null>(null);
  // Local picker state: a discipline can be picked before a theme; the lens
  // stays null until the theme lands (morin.py:9031-9032). When the lens is
  // set EXTERNALLY (Charts menu dispatch) the picker adopts its discipline via
  // the render-time state-adjust pattern (React 19: no setState in effects).
  const [picked, setPicked] = React.useState<string>("");
  const [prevLensDiscipline, setPrevLensDiscipline] = React.useState<string | null>(null);
  const lensDiscipline = lens?.discipline ?? null;
  if (lensDiscipline !== prevLensDiscipline) {
    setPrevLensDiscipline(lensDiscipline);
    if (lensDiscipline) setPicked(lensDiscipline);
  }
  const discipline = picked;

  // The discipline/theme catalog is gated by the active Corpus Packs filter, so
  // it must re-pull whenever a pack is toggled (packsVersion bumps). Invalidate
  // the shared cache first so we get the freshly-filtered catalog, not the stale
  // one. UNISON with the title-bar Corpus Packs menu.
  const packsVersion = useWorkspaceStore((s) => s.packsVersion);
  React.useEffect(() => {
    let cancelled = false;
    if (packsVersion > 0) invalidateCorpusDisciplines();
    corpusDisciplinesCached()
      .then((payload) => {
        if (!cancelled) setCatalog(payload.disciplines);
      })
      .catch((err) => console.error("[inspector:disciplines]", err));
    return () => {
      cancelled = true;
    };
  }, [packsVersion]);

  if (!catalog || catalog.length === 0) return null;
  const themes = catalog.find((d) => d.slug === discipline)?.themes ?? [];

  const onDiscipline = (slug: string) => {
    setPicked(slug);
    // Theme resets on discipline change; no lens until a theme is picked.
    useWorkspaceStore.getState().setInspectorLens(null);
  };
  const onTheme = (label: string) => {
    const store = useWorkspaceStore.getState();
    if (!discipline || !label) {
      store.setInspectorLens(null);
      return;
    }
    const theme = themes.find((t) => t.label === label);
    store.setInspectorLens({
      discipline,
      theme: label,
      context: theme?.defaultContext ?? undefined,
    });
  };

  // Horary per-question context — quesited/querent house pickers (slice 3).
  // wx twin: workspace_shell.py:1560-1602 (build, 1-12 choices, quesited
  // first), :2526 _on_context_choice firing morin._on_inspector_context_change
  // (morin.py:9013-9024 — merge into the lens context, then alerts refetch).
  // Shown only while the active lens is horary (workspace_shell.py:2598-2602).
  const onContextHouse = (key: "quesited_house" | "querent_house", value: string) => {
    const store = useWorkspaceStore.getState();
    const current = store.inspectorLens;
    if (!current) return;
    const house = parseInt(value, 10);
    if (!Number.isFinite(house)) return;
    store.setInspectorLens({
      ...current,
      context: { ...(current.context ?? {}), [key]: house },
    });
  };
  const contextHouse = (key: "quesited_house" | "querent_house"): string => {
    const value = lens?.context?.[key];
    return typeof value === "number" && value >= 1 && value <= 12 ? String(value) : "";
  };
  const houseLabels = Array.from({ length: 12 }, (_, i) => String(i + 1));

  const selectClass = cn(
    "h-[var(--aries-inspector-control-height)] min-w-0 flex-1 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-[var(--aries-inspector-control-padding-x)]",
    INSPECTOR_VALUE_COLOR,
    TEXT_SMALL,
  );

  return (
    <div className={cn(INSPECTOR_SECTION_BOX, "pb-[var(--aries-inspector-control-section-padding-bottom)]")}>
      <SectionLabel>{t("inspector.interpretation")}</SectionLabel>
      <div className="flex items-center gap-[var(--aries-inspector-heading-gap)]">
        <select
          aria-label={t("inspector.discipline")}
          className={selectClass}
          value={discipline}
          onChange={(e) => onDiscipline(e.target.value)}
        >
          <option value="">{"—"}</option>
          {catalog.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.displayName}
            </option>
          ))}
        </select>
        <select
          aria-label={t("inspector.theme")}
          className={selectClass}
          value={lens?.discipline === discipline ? lens?.theme ?? "" : ""}
          onChange={(e) => onTheme(e.target.value)}
          disabled={!discipline}
        >
          <option value="">{"—"}</option>
          {themes.map((th) => (
            <option key={th.label} value={th.label} title={th.tooltip || undefined}>
              {th.label}
            </option>
          ))}
        </select>
      </div>
      {lens?.discipline === "horary" ? (
        <div className="mt-[var(--aries-inspector-section-gap)] flex items-center gap-[var(--aries-inspector-heading-gap)]">
          <label className={cn("flex min-w-0 flex-1 items-center gap-[var(--aries-control-gap-compact)]", INSPECTOR_MUTED_COLOR, TEXT_SMALL)}>
            {t("inspector.quesited")}:
            <select
              aria-label={t("inspector.quesitedHouse")}
              className={selectClass}
              value={contextHouse("quesited_house")}
              onChange={(e) => onContextHouse("quesited_house", e.target.value)}
            >
              <option value="" disabled hidden />
              {houseLabels.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className={cn("flex min-w-0 flex-1 items-center gap-[var(--aries-control-gap-compact)]", INSPECTOR_MUTED_COLOR, TEXT_SMALL)}>
            {t("inspector.querent")}:
            <select
              aria-label={t("inspector.querentHouse")}
              className={selectClass}
              value={contextHouse("querent_house")}
              onChange={(e) => onContextHouse("querent_house", e.target.value)}
            >
              <option value="" disabled hidden />
              {houseLabels.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
});

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
      {payload.smart_rows.length ? (
        <div className="mt-[var(--aries-inspector-section-gap)] flex flex-col gap-[var(--aries-inspector-row-gap)]">
          {payload.smart_rows.map((row, i) => (
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
                  <DetailRow key={`det-${i}`} text={row} />
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
function DetailRow({ text }: { text: string }) {
  const idx = text.indexOf(":");
  if (idx === -1) {
    return <div className={cn("tabular-nums", INSPECTOR_VALUE_COLOR, TEXT_SMALL)} style={INSPECTOR_WRAP_STYLE}>{text}</div>;
  }
  const label = text.slice(0, idx + 1);
  const value = text.slice(idx + 1).trim();
  return (
    <div className={cn("flex min-w-0 items-baseline gap-[var(--aries-control-gap)]", TEXT_SMALL)}>
      <span className={INSPECTOR_LABEL_COLOR}>{label}</span>
      <span className={cn("min-w-0 tabular-nums", INSPECTOR_VALUE_COLOR)} style={INSPECTOR_WRAP_STYLE}>{value}</span>
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
 * Zone B — fixed Valens planet/sign definitions. This mirrors the current wx
 * inspector hover path: one standing planet/sign section, no legacy corpus
 * browser cards and no pin controls.
 */
const PassagesZone = React.memo(function PassagesZone({ passages }: { passages: InspectorPassagesPayload | null }) {
  const t = useT();
  if (!passages) return null;
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
        <div className={cn("mb-3 italic", INSPECTOR_LABEL_COLOR)}>
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

/**
 * Zone B — pack alerts. Renders the active-lens rule-engine verdicts as one
 * card per alert: a status dot + Morinus glyph + bold title + prose body +
 * citation, all verbatim from the daemon. Empty / no-lens → nothing rendered
 * (matches the wx oracle hiding the whole section, workspace_shell.py:2618).
 */
const AlertsZone = React.memo(function AlertsZone({ alerts }: { alerts: InspectorAlertsPayload | null }) {
  const t = useT();
  if (!alerts || alerts.alerts.length === 0) return null;
  const heading = [alerts.discipline, alerts.theme]
    .filter(Boolean)
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s))
    .join(" · ");

  return (
    <div className={INSPECTOR_SECTION_BOX}>
      <SectionLabel>{heading || t("inspector.packAlerts")}</SectionLabel>
      <div className="flex flex-col gap-[var(--aries-inspector-card-gap)]">
        {/* wx caps the visible cards at 12 (workspace_shell.py:2635). */}
        {/* Pack tag only when >1 pack ships rules for the discipline — the
            cite alone attributes single-pack rules (workspace_shell.py:2660-2669). */}
        {alerts.alerts.slice(0, 12).map((alert, i) => (
          <AlertCard key={`alert-${i}`} alert={alert} showPackTag={(alerts.packCount ?? 0) > 1} />
        ))}
      </div>
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

/** A single pack-alert card — status dot + Morinus glyph + title + body + cite,
 * plus the authoring pack tag. Rendered verbatim. */
function AlertCard({ alert, showPackTag }: { alert: InspectorAlert; showPackTag?: boolean }) {
  const dot = (alert.status && ALERT_STATUS_COLOUR[alert.status]) || "var(--aries-status-neutral)";
  return (
    <div className="rounded-md border border-[color:var(--aries-inspector-card-border-color)] bg-[var(--aries-inspector-card-background)] px-[var(--aries-inspector-card-padding-x)] py-[var(--aries-inspector-card-padding-y)]">
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
          {alert.title}
        </span>
        {alert.pack && showPackTag ? (
          <span className={cn("shrink-0", INSPECTOR_TERTIARY_COLOR, INSPECTOR_PACK_TAG_TEXT)}>
            {alert.pack}
          </span>
        ) : null}
      </div>
      {alert.body ? (
        <p className={cn("mt-[var(--aries-control-gap-compact)] leading-relaxed whitespace-pre-line", INSPECTOR_READING_COLOR, TEXT_SMALL)}>{alert.body}</p>
      ) : null}
      {alert.cite ? (
        <div className={cn("mt-[var(--aries-control-gap-compact)] italic", INSPECTOR_LABEL_COLOR, TEXT_SECTION)}>{alert.cite}</div>
      ) : null}
    </div>
  );
}

function ChartSummary({ chart }: { chart: ChartRenderSnapshot | null }) {
  const t = useT();
  if (!chart) {
    return <div className={cn("px-[var(--aries-inspector-padding-x)] pb-[var(--aries-inspector-padding-bottom)]", INSPECTOR_MUTED_COLOR)}>{t("inspector.noChart")}</div>;
  }
  const meta = chart.primaryChart.meta;
  return (
    <div className="flex flex-col gap-[var(--aries-inspector-section-gap)] px-[var(--aries-inspector-padding-x)] pb-[var(--aries-inspector-padding-bottom)] pr-[var(--aries-inspector-summary-close-reserve)] pt-[var(--aries-inspector-padding-top)]">
      <div className={cn("font-medium tracking-tight", INSPECTOR_TITLE_COLOR, TEXT_HEADER)}>{meta.name}</div>
      <SummaryRow label={t("inspector.date")} value={meta.dateDisplay} />
      <SummaryRow label={t("inspector.time")} value={meta.timeDisplay} />
      <SummaryRow label={t("inspector.place")} value={meta.place} />
      <SummaryRow label={t("inspector.coords")} value={meta.placeCoords} />
      <SummaryRow label={t("inspector.age")} value={meta.age} />
      <div className={cn("pt-[var(--aries-inspector-padding-top)]", INSPECTOR_LABEL_COLOR, TEXT_SMALL)}>{t("inspector.hover")}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-[var(--aries-inspector-padding-top)]">
      <span className={cn(INSPECTOR_LABEL_COLOR, TEXT_SECTION)}>{label}</span>
      <span className="text-right tabular-nums">{value}</span>
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
