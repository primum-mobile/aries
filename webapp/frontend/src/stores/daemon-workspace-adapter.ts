// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

"use client";

import { useCallback, useEffect, useMemo } from "react";

import {
  workspaceActivate,
  workspaceClose,
  workspaceNavigate,
  workspaceOpen,
  workspaceOpenAscensionalTransits,
  workspaceOpenAstrocart,
  workspaceOpenAstrologSphere,
  workspaceOpenAstrolabe,
  workspaceOpenSquareChart,
  workspaceOpenMundaneChart,
  workspaceOpenDirections,
  workspaceOpenEphemeris,
  workspaceOpenHereNow,
  workspaceOpenLensHereNow,
  workspaceOpenSynastry,
  workspaceOpenTable,
  workspaceOpenTransitSearch,
  type DaemonDocumentSummary,
  type SupplementaryBindingPayload,
  type WorkspaceCloseResult,
  type WorkspaceOpenResult,
  type WorkspaceStatePayload,
} from "@/lib/daemon/client";
import {
  invalidateDocumentSnapshots,
  rememberDocumentSnapshot,
} from "@/lib/chart/document-snapshot-cache";
import { recordChartPerf } from "@/lib/chart/perf";
import {
  acquireDaemonWorkspace,
  useDaemonWorkspaceStore,
  type DaemonWorkspaceState,
} from "@/stores/daemon-workspace-store";
import { beginWorkspaceSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";
import {
  SUPPLEMENTARY_KIND_LABELS,
  useWorkspaceStore,
  type SupplementaryKind,
  type WorkspaceDocument,
} from "@/stores/workspace-store";

// ---------------------------------------------------------------------------
// Daemon → existing-component adapter.
//
// The chart-fetch + content components (home-client, workspace-content,
// app-sidebar) consume `WorkspaceDocument` with public-kind feature ids,
// sourceName, comparisonSourceName, displayDatetime, supplementaryBinding.
// This adapter projects the daemon's canonical per-doc summary into that exact
// shape so the components render the daemon tree without modification.
//
// EVERY workspace document is daemon-owned — root radix, the 7 supplementary
// kinds, synastry (a COMPOUND child), astrocart (a view-only child), and
// here-now (a self-anchored root). There is NO client overlay: the skin holds
// no document tree of its own; it renders whatever daemon summaries arrive,
// keyed by document id.
// ---------------------------------------------------------------------------

// Engine feature_kind -> public kind the snapshot endpoint + UI labels expect.
// Mirror of supplementary_service.FEATURE_TO_PUBLIC_KIND (the daemon summary
// reports the engine feature_kind, e.g. "solar_return").
const FEATURE_TO_PUBLIC: Record<string, SupplementaryKind> = {
  transits: "transits",
  converse_transits: "converse-transits",
  solar_return: "solar-revolution",
  lunar_return: "lunar-revolution",
  planetary_return: "planetary-return",
  secondary: "secondary-progression",
  tertiary: "tertiary-progression",
  minor: "minor-progression",
  solar_arc: "solar-arc",
  solar_average: "solar-average",
  harmonic: "harmonic",
  profections: "profections",
};

export function publicFeatureKind(engineFeatureKind: string | null): SupplementaryKind | undefined {
  if (!engineFeatureKind) return undefined;
  return FEATURE_TO_PUBLIC[engineFeatureKind];
}

// ---------------------------------------------------------------------------
// Projection: daemon summaries -> WorkspaceDocument[].
//
// Synastry and astrocart arrive as REAL daemon summaries distinguished by
// `launcherKind` (the COMPOUND synastry doc + the view-only astrocart doc both
// report featureKind=null). here-now is just a self-anchored root radix.
// ---------------------------------------------------------------------------

const projectedDocumentCache = new WeakMap<DaemonDocumentSummary, WorkspaceDocument>();

function buildDocumentFromSummary(summary: DaemonDocumentSummary): WorkspaceDocument {
  const daemonTitle = summary.title.replace(/\s*\*$/, "");
  const sourceName = summary.sourceName || summary.comparisonName || summary.subtitle || daemonTitle;
  // Astrocart — a view-only daemon child with no chart session.
  if (summary.launcherKind === "astrocart") {
    return {
      id: summary.documentId,
      parentDocumentId: summary.parentDocumentId,
      kind: "astrocart",
      sourceName,
      displayDatetime: summary.displayDatetime ?? undefined,
      tabSuffix: summary.tabSuffix ?? undefined,
      title: daemonTitle || "Astrocartography",
      // Solar-eclipse shadow-path overlay request (wx AstrocartPanel
      // eclipse_event, morin.py:16198-16227).
      eclipseEvent: summary.eclipseEvent ?? null,
      dirty: summary.dirty,
      fpath: summary.fpath,
      enabledActions: summary.enabledActions,
    };
  }
  // Primary Directions — a view-only daemon child (PD list table), no session.
  if (summary.launcherKind === "directions") {
    return {
      id: summary.documentId,
      parentDocumentId: summary.parentDocumentId,
      kind: "directions",
      sourceName,
      displayDatetime: summary.displayDatetime ?? undefined,
      tabSuffix: summary.tabSuffix ?? undefined,
      title: daemonTitle || "Primary Directions",
      directionsCustomSignificator: summary.directionsCustomSignificator ?? null,
      directionsDefaultDirection: summary.directionsDefaultDirection ?? null,
      dirty: summary.dirty,
      fpath: summary.fpath,
      enabledActions: summary.enabledActions,
    };
  }
  // Astrolabe — a view-only daemon child (planispheric astrolabe), no session.
  if (summary.launcherKind === "astrolabe") {
    return {
      id: summary.documentId,
      parentDocumentId: summary.parentDocumentId,
      kind: "astrolabe",
      sourceName,
      displayDatetime: summary.displayDatetime ?? undefined,
      tabSuffix: summary.tabSuffix ?? undefined,
      title: daemonTitle || "Astrolabe",
      dirty: summary.dirty,
      fpath: summary.fpath,
      enabledActions: summary.enabledActions,
    };
  }
  // Astrolog Sphere — a view-only daemon child (3D-style sphere projection), no session.
  if (summary.launcherKind === "astrolog_sphere") {
    return {
      id: summary.documentId,
      parentDocumentId: summary.parentDocumentId,
      kind: "astrolog-sphere",
      sourceName,
      displayDatetime: summary.displayDatetime ?? undefined,
      tabSuffix: summary.tabSuffix ?? undefined,
      title: daemonTitle || "Astrolog Sphere",
      dirty: summary.dirty,
      fpath: summary.fpath,
      enabledActions: summary.enabledActions,
    };
  }
  // Square Chart — a view-only daemon child (medieval square diagram), no session.
  if (summary.launcherKind === "square_chart") {
    return {
      id: summary.documentId,
      parentDocumentId: summary.parentDocumentId,
      kind: "square-chart",
      sourceName,
      displayDatetime: summary.displayDatetime ?? undefined,
      tabSuffix: summary.tabSuffix ?? undefined,
      title: daemonTitle || "Square Chart",
      dirty: summary.dirty,
      fpath: summary.fpath,
      enabledActions: summary.enabledActions,
    };
  }
  // Mundane Chart — a view-only daemon child (planets by mundane position), no session.
  if (summary.launcherKind === "mundane_chart") {
    return {
      id: summary.documentId,
      parentDocumentId: summary.parentDocumentId,
      kind: "mundane-chart",
      sourceName,
      displayDatetime: summary.displayDatetime ?? undefined,
      tabSuffix: summary.tabSuffix ?? undefined,
      title: daemonTitle || "Mundane Chart",
      dirty: summary.dirty,
      fpath: summary.fpath,
      enabledActions: summary.enabledActions,
    };
  }
  // Graphic Ephemeris — a view-only daemon child (Canvas2D year plot), no session.
  if (summary.launcherKind === "ephemeris") {
    return {
      id: summary.documentId,
      parentDocumentId: summary.parentDocumentId,
      kind: "ephemeris",
      sourceName,
      displayDatetime: summary.displayDatetime ?? undefined,
      tabSuffix: summary.tabSuffix ?? undefined,
      title: daemonTitle || "Graphic Ephemeris",
      dirty: summary.dirty,
      fpath: summary.fpath,
      enabledActions: summary.enabledActions,
    };
  }
  // Transit Search — a view-only daemon child (table/form), no session.
  if (summary.launcherKind === "transit_search") {
    return {
      id: summary.documentId,
      parentDocumentId: summary.parentDocumentId,
      kind: "transit-search",
      sourceName,
      displayDatetime: summary.displayDatetime ?? undefined,
      tabSuffix: summary.tabSuffix ?? undefined,
      title: daemonTitle || "Transit Search",
      searchInitialSignificatorId: summary.searchInitialSignificatorId,
      searchInitialLabel: summary.searchInitialLabel,
      searchInitialGlyph: summary.searchInitialGlyph,
      dirty: summary.dirty,
      fpath: summary.fpath,
      enabledActions: summary.enabledActions,
    };
  }
  // Generic embedded table — a view-only daemon child, no session.
  if (summary.launcherKind === "table") {
    return {
      id: summary.documentId,
      parentDocumentId: summary.parentDocumentId,
      kind: "table",
      sourceName,
      displayDatetime: summary.displayDatetime ?? undefined,
      tabSuffix: summary.tabSuffix ?? undefined,
      title: daemonTitle || "Table",
      titleKey: summary.titleKey ?? null,
      tableId: summary.tableId,
      dirty: summary.dirty,
      fpath: summary.fpath,
      enabledActions: summary.enabledActions,
    };
  }
  // Ascensional Transits — a chart visual mode plus daemon AT list pane.
  if (summary.launcherKind === "ascensional_transits") {
    return {
      id: summary.documentId,
      parentDocumentId: summary.parentDocumentId,
      kind: "ascensional-transits",
      sourceName,
      displayDatetime: summary.displayDatetime ?? undefined,
      tabSuffix: summary.tabSuffix ?? undefined,
      title: daemonTitle || "Asc. Transits",
      ascensionalEventJd: summary.ascensionalEventJd ?? null,
      ascensionalEventPlace: summary.ascensionalEventPlace ?? null,
      ascensionalFilterToActiveMoment: summary.ascensionalFilterToActiveMoment ?? true,
      ascensionalApplyPrecession: summary.ascensionalApplyPrecession ?? true,
      dirty: summary.dirty,
      fpath: summary.fpath,
      enabledActions: summary.enabledActions,
    };
  }
  // Synastry — a COMPOUND daemon child rendered as a center+partner biwheel.
  if (summary.launcherKind === "synastry") {
    const comparison = summary.comparisonName ?? "";
    return {
      id: summary.documentId,
      parentDocumentId: summary.parentDocumentId,
      kind: "supplementary",
      sourceName,
      supplementaryFeatureKind: "synastry",
      comparisonSourceName: comparison,
      compoundKind: summary.compoundKind ?? null,
      compositeVariant: summary.compositeVariant ?? null,
      displayDatetime: summary.displayDatetime ?? undefined,
      tabSuffix: summary.tabSuffix ?? undefined,
      titleKey:
        summary.titleKey ??
        (summary.compoundKind === "synastry" ? "supplementary.synastry" : null),
      title: daemonTitle || SUPPLEMENTARY_KIND_LABELS.synastry,
      dirty: summary.dirty,
      fpath: summary.fpath,
      enabledActions: summary.enabledActions,
    };
  }
  const publicKind = publicFeatureKind(summary.featureKind);
  const isSupplementary = publicKind != null;
  // Stable semantic title keys keep already-open derived documents live-localized.
  // Planetary returns and solar averages retain daemon titles because those carry
  // body/range-specific data (for example "Mars Return" / an age span).
  const supplementaryTitleKey =
    summary.titleKey ?? (isSupplementary && publicKind !== "planetary-return" && publicKind !== "solar-average"
      ? `supplementary.${publicKind}`
      : null);
  const title = isSupplementary
    ? daemonTitle || SUPPLEMENTARY_KIND_LABELS[publicKind]
    : daemonTitle || sourceName || summary.subtitle || "Horoscope";
  return {
    id: summary.documentId,
    parentDocumentId: summary.parentDocumentId,
    kind: isSupplementary ? "supplementary" : "radix",
    sourceName,
    supplementaryFeatureKind: publicKind,
    titleKey: supplementaryTitleKey,
    displayDatetime: summary.displayDatetime ?? undefined,
    symbolicTime: summary.symbolicTime ?? null,
    tabSuffix: summary.tabSuffix ?? undefined,
    isHorary: summary.isHorary === true,
    interpretation: summary.interpretation ?? null,
    title,
    dirty: summary.dirty,
    fpath: summary.fpath,
    enabledActions: summary.enabledActions,
  };
}

function summaryToDocument(summary: DaemonDocumentSummary): WorkspaceDocument {
  const cached = projectedDocumentCache.get(summary);
  if (cached) return cached;
  const projected = {
    ...buildDocumentFromSummary(summary),
    chartVisualMode: summary.chartVisualMode ?? "zodiac",
    launcherKind: summary.launcherKind ?? undefined,
  };
  projectedDocumentCache.set(summary, projected);
  return projected;
}

/** Project the daemon tree (summaries in document order) to WorkspaceDocument[]. */
function projectDocuments(summaries: DaemonDocumentSummary[]): WorkspaceDocument[] {
  return summaries.map(summaryToDocument);
}

type SnapshotCommandResult = (WorkspaceOpenResult | WorkspaceStatePayload | WorkspaceCloseResult) & {
  documentId?: string | null;
  snapshotInvalidatedIds?: string[];
};

function applyImmediateWorkspaceResult(
  result: SnapshotCommandResult,
  fallbackDocumentId?: string | null,
): void {
  if (result.snapshotInvalidatedIds?.length) {
    invalidateDocumentSnapshots(result.snapshotInvalidatedIds);
  }
  const activeDocumentId =
    result.activeDocumentId ?? result.documentId ?? fallbackDocumentId ?? null;
  if (activeDocumentId && result.snapshot) {
    rememberDocumentSnapshot(activeDocumentId, result.snapshot);
    recordChartPerf("chart-command-snapshot", {
      docId: activeDocumentId,
      resultDocId: result.documentId ?? null,
      fallbackDocumentId: fallbackDocumentId ?? null,
      overlayRenderMode: result.snapshot.overlayRenderMode,
    });
    useDaemonWorkspaceStore.getState().pushCommandSnapshot(activeDocumentId, result.snapshot);
  }
  useDaemonWorkspaceStore.getState()._applyState(result.documents, activeDocumentId);
}

export function applyImmediateWorkspaceCommandResult(
  result: SnapshotCommandResult,
  fallbackDocumentId?: string | null,
): void {
  applyImmediateWorkspaceResult(result, fallbackDocumentId);
}

function runImmediateWorkspaceCommand<T extends SnapshotCommandResult>(
  command: Promise<T>,
  fallbackDocumentId?: string | null,
): Promise<T> {
  const finish = beginWorkspaceSnapshotCommand();
  return command
    .then((result) => {
      applyImmediateWorkspaceResult(result, fallbackDocumentId);
      return result;
    })
    .finally(finish);
}

// ---------------------------------------------------------------------------
// Public hook: the daemon-mirrored workspace, projected to WorkspaceDocument[].
// ---------------------------------------------------------------------------

export type DaemonWorkspaceView = {
  documents: WorkspaceDocument[];
  activeDocumentId: string | null;
  activeDocument: WorkspaceDocument | null;
  /** RUNTIME enabled gate (skin dispatch id -> allowed) for the ACTIVE
   * document's session — verbatim from the daemon summary's enabledActions
   * (workspace_service._enabled_actions). Empty when no active document. The
   * skin reads this instead of recomputing has_chart in TS. */
  activeEnabledActions: Record<string, boolean>;
  connection: "connecting" | "open" | "closed";
  /** rebuiltChildIds from the latest session.changed (step C live-refresh). */
  lastSessionChange: DaemonWorkspaceState["lastSessionChange"];
};

export function useDaemonWorkspaceView(): DaemonWorkspaceView {
  const summaries = useDaemonWorkspaceStore((s) => s.documents);
  const daemonActiveId = useDaemonWorkspaceStore((s) => s.activeDocumentId);
  const connection = useDaemonWorkspaceStore((s) => s.connection);
  const lastSessionChange = useDaemonWorkspaceStore((s) => s.lastSessionChange);

  const documents = useMemo(() => projectDocuments(summaries), [summaries]);

  const activeDocumentId = daemonActiveId;
  const activeDocument = useMemo(
    () => documents.find((d) => d.id === activeDocumentId) ?? null,
    [documents, activeDocumentId],
  );

  // The active document's runtime gate, read straight off the daemon summary
  // (never recomputed). Empty map when nothing is active.
  const activeEnabledActions = useMemo(() => {
    const summary = summaries.find((s) => s.documentId === activeDocumentId);
    return summary?.enabledActions ?? {};
  }, [summaries, activeDocumentId]);

  return {
    documents,
    activeDocumentId,
    activeDocument,
    activeEnabledActions,
    connection,
    lastSessionChange,
  };
}

/** Mount-time subscribe. Call once at the workspace root. The daemon tree is
 * adopted as-is; an empty daemon stays empty until the user opens a chart. */
export function useDaemonWorkspaceConnection(): void {
  useEffect(() => acquireDaemonWorkspace(), []);
}

// ---------------------------------------------------------------------------
// Command actions — every action is a daemon command. The skin holds no local
// document state: open/activate/close all mutate the daemon tree, which
// broadcasts documents.changed and refreshes the React mirror.
// ---------------------------------------------------------------------------

export function useDaemonWorkspaceActions() {
  const summaries = useDaemonWorkspaceStore((s) => s.documents);

  const activate = useCallback((id: string) => {
    void runImmediateWorkspaceCommand(workspaceActivate(id), id)
      .catch((e) => console.error("[ws-activate]", e));
  }, []);

  const openRadix = useCallback(
    (sourceName: string) => {
      // Dedupe against an already-open root radix (controller appends blindly).
      const existing = summaries.find(
        (s) => s.parentDocumentId == null && s.subtitle === sourceName,
      );
      if (existing) {
        void runImmediateWorkspaceCommand(workspaceActivate(existing.documentId), existing.documentId)
          .catch((e) => console.error("[ws-activate]", e));
        return;
      }
      void runImmediateWorkspaceCommand(workspaceOpen({ sourceName }))
        .catch((e) => console.error("[ws-open]", e));
    },
    [summaries],
  );

  const openSupplementaryChild = useCallback(
    (
      parentDaemonId: string,
      kind: SupplementaryKind,
      options?: number | {
        planetType?: number | null;
        binding?: SupplementaryBindingPayload | null;
        /** ISO source datetime — the user-chosen quick-chart date (the wx
         * ProfDlg prompt, morin.py:19176-19192). Threads to the daemon's
         * /api/workspace/open `when` and on to the adapter's source_datetime. */
        when?: string | null;
      },
    ) => {
      if (kind === "synastry") return; // synastry opens via the dedicated route
      const planetType = typeof options === "number" ? options : options?.planetType;
      const binding = typeof options === "object" ? options.binding : undefined;
      const when = typeof options === "object" ? options.when : undefined;
      // Always enter the daemon child-open path for supplementary charts. The
      // daemon owns Antikythera launch context (immediate parent cursor,
      // explicit source overrides, and launcher singleton reuse). A client-side
      // "same kind under same parent" shortcut can activate a stale child
      // without the daemon's parent/session checks.
      void runImmediateWorkspaceCommand(
        workspaceOpen({
          parentDocumentId: parentDaemonId,
          featureKind: kind,
          planetType: planetType ?? null,
          binding: binding ?? null,
          when: when ?? null,
          reuseExisting: true,
        }),
      )
        .catch((e) => console.error("[ws-open-child]", e));
    },
    [],
  );

  const closeDocument = useCallback(
    async (id: string): Promise<WorkspaceCloseResult | null> => {
      // Close may change a branch-owned multi-wheel without changing the active
      // document id, so consume its replacement snapshot like every other
      // immediate workspace command.
      try {
        return await runImmediateWorkspaceCommand(workspaceClose(id, true), id);
      } catch (e) {
        console.error("[ws-close]", e);
        return null;
      }
    },
    [],
  );

  const navigate = useCallback((docId: string, unit: string, delta: number) => {
    return workspaceNavigate({ docId, unit, delta });
  }, []);

  return {
    activate,
    openRadix,
    openSupplementaryChild,
    closeDocument,
    navigate,
  };
}

/** Find the nearest radix ancestor id for a projected doc id (daemon or overlay). */
export function findDaemonRadixAncestor(
  documents: WorkspaceDocument[],
  id: string | null,
): WorkspaceDocument | null {
  if (!id) return null;
  let current = documents.find((d) => d.id === id) ?? null;
  while (current) {
    if (current.kind === "radix") return current;
    if (!current.parentDocumentId) return null;
    current = documents.find((d) => d.id === current!.parentDocumentId) ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Chart launchers — the synastry / astrocart / here-now daemon routes shared by
// every chart-launch surface (sidebar handleSelect, the radix-wheel context
// menu). These open REAL daemon documents (open-synastry / open-astrocart /
// open-here-now), then activate the returned doc id so the daemon broadcast
// refreshes the tree. Lifted out of home-client so both surfaces dispatch the
// SAME way — neither holds its own launch logic.
// ---------------------------------------------------------------------------

export type ChartLaunchers = {
  /** Open "Here and Now" as a self-anchored root document. */
  openHereNow: () => void;
  /** No-chart fallback for an Elections/Horary theme pick: open the wx
   * here-and-now TRANSIT (elections) or HORARY chart (morin.py:19057-19114,
   * 18979-19032). The lens itself is store state, not this door's business. */
  openLensHereNow: (discipline: string, theme?: string) => void;
  /** Open a synastry biwheel child under `parentRadixId` against `comparisonName`. */
  openSynastryChild: (parentRadixId: string, comparisonName: string) => void;
  /** Open astrocartography as a view-only child under `parentRadixId`. */
  openAstrocartChild: (parentRadixId: string) => void;
  /** Open the Primary Directions list as a view-only child under `parentRadixId`. */
  openDirectionsChild: (parentRadixId: string) => void;
  /** Open the planispheric astrolabe as a view-only child under `parentRadixId`. */
  openAstrolabeChild: (parentRadixId: string) => void;
  /** Open the Astrolog-style chart sphere as a view-only child under `parentRadixId`. */
  openAstrologSphereChild: (parentRadixId: string) => void;
  /** Open the Square Chart as a view-only child under `parentRadixId`. */
  openSquareChartChild: (parentRadixId: string) => void;
  /** Open the Mundane Chart as a view-only child under `parentRadixId`. */
  openMundaneChartChild: (parentRadixId: string) => void;
  /** Open the Graphic Ephemeris as a view-only child under `parentRadixId`. */
  openEphemerisChild: (parentRadixId: string) => void;
  /** Open the transit search engine as a view-only child under `parentRadixId`. */
  openTransitSearchChild: (parentRadixId: string) => void;
  /** Open a generic embedded table as a view-only child under `parentRadixId`. */
  openTableChild: (
    parentRadixId: string,
    tableId: string,
    binding?: Record<string, unknown> | null,
  ) => void;
  /** Open or recall Ascensional Transits under `parentRadixId`. */
  openAscensionalTransitsChild: (parentRadixId: string, sourceDocumentId?: string | null) => void;
};

export function useChartLaunchers(): ChartLaunchers {
  const openHereNow = useCallback(() => {
    void runImmediateWorkspaceCommand(workspaceOpenHereNow())
      .catch((err) => console.error("[ws-here-now]", err));
  }, []);

  const openLensHereNow = useCallback((discipline: string, theme?: string) => {
    void runImmediateWorkspaceCommand(workspaceOpenLensHereNow(discipline, theme))
      .catch((err) => console.error("[ws-lens-here-now]", err));
  }, []);

  const openSynastryChild = useCallback(
    (parentRadixId: string, comparisonName: string) => {
      void runImmediateWorkspaceCommand(workspaceOpenSynastry(parentRadixId, comparisonName))
        .catch((err) => console.error("[ws-open-synastry]", err));
    },
    [],
  );

  const openAstrocartChild = useCallback((parentRadixId: string) => {
    // open_astrocart already activates (or recalls) the daemon document. Adopt
    // that command result immediately; a second activate round-trip delayed the
    // first map mount and duplicated workspace events.
    void runImmediateWorkspaceCommand(workspaceOpenAstrocart(parentRadixId))
      .catch((err) => console.error("[ws-open-astrocart]", err));
  }, []);

  const openDirectionsChild = useCallback((parentRadixId: string) => {
    void workspaceOpenDirections(parentRadixId)
      .then((res) => {
        if (res.documentId) void workspaceActivate(res.documentId);
      })
      .catch((err) => console.error("[ws-open-directions]", err));
  }, []);

  const openAstrolabeChild = useCallback((parentRadixId: string) => {
    void workspaceOpenAstrolabe(parentRadixId)
      .then((res) => {
        if (res.documentId) void workspaceActivate(res.documentId);
      })
      .catch((err) => console.error("[ws-open-astrolabe]", err));
  }, []);

  const openAstrologSphereChild = useCallback((parentRadixId: string) => {
    void workspaceOpenAstrologSphere(parentRadixId)
      .then((res) => {
        if (res.documentId) void workspaceActivate(res.documentId);
      })
      .catch((err) => console.error("[ws-open-astrolog-sphere]", err));
  }, []);

  const openSquareChartChild = useCallback((parentRadixId: string) => {
    void workspaceOpenSquareChart(parentRadixId)
      .then((res) => {
        if (res.documentId) void workspaceActivate(res.documentId);
      })
      .catch((err) => console.error("[ws-open-square-chart]", err));
  }, []);

  const openMundaneChartChild = useCallback((parentRadixId: string) => {
    void workspaceOpenMundaneChart(parentRadixId)
      .then((res) => {
        if (res.documentId) void workspaceActivate(res.documentId);
      })
      .catch((err) => console.error("[ws-open-mundane-chart]", err));
  }, []);

  const openEphemerisChild = useCallback((parentRadixId: string) => {
    void workspaceOpenEphemeris(parentRadixId)
      .then((res) => {
        if (res.documentId) void workspaceActivate(res.documentId);
      })
      .catch((err) => console.error("[ws-open-ephemeris]", err));
  }, []);

  const openTransitSearchChild = useCallback((parentRadixId: string) => {
    void workspaceOpenTransitSearch(parentRadixId)
      .then((res) => {
        if (res.documentId) void workspaceActivate(res.documentId);
      })
      .catch((err) => console.error("[ws-open-transit-search]", err));
  }, []);

  const openTableChild = useCallback((
    parentRadixId: string,
    tableId: string,
    binding?: Record<string, unknown> | null,
  ) => {
    void workspaceOpenTable(parentRadixId, tableId, binding)
      .then((res) => {
        if (res.documentId) void workspaceActivate(res.documentId);
      })
      .catch((err) => console.error("[ws-open-table]", err));
  }, []);

  const openAscensionalTransitsChild = useCallback((parentRadixId: string, sourceDocumentId?: string | null) => {
    void runImmediateWorkspaceCommand(workspaceOpenAscensionalTransits(parentRadixId, sourceDocumentId))
      .then((res) => {
        const documentId = res.activeDocumentId ?? res.documentId ?? null;
        const summary = res.documents.find(
          (doc) =>
            doc.documentId === documentId &&
            (doc.launcherKind === "ascensional_transits" ||
              doc.chartVisualMode === "ascensional_transits"),
        );
        if (!summary) {
          useWorkspaceStore.getState().closeAscensionalTransitsPane();
          return;
        }
        const sourceName =
          summary.sourceName ||
          summary.comparisonName ||
          summary.subtitle ||
          summary.title.replace(/\s*\*$/, "");
        useWorkspaceStore.getState().openAscensionalTransitsPane({
          documentId: summary.documentId,
          sourceName,
          ascensionalEventJd: summary.ascensionalEventJd ?? null,
          ascensionalEventPlace: summary.ascensionalEventPlace ?? null,
          ascensionalFilterToActiveMoment: summary.ascensionalFilterToActiveMoment ?? true,
          ascensionalApplyPrecession: summary.ascensionalApplyPrecession ?? true,
        });
      })
      .catch((err) => console.error("[ws-open-ascensional]", err));
  }, []);

  return {
    openHereNow,
    openLensHereNow,
    openSynastryChild,
    openAstrocartChild,
    openDirectionsChild,
    openAstrolabeChild,
    openAstrologSphereChild,
    openSquareChartChild,
    openMundaneChartChild,
    openEphemerisChild,
    openTransitSearchChild,
    openTableChild,
    openAscensionalTransitsChild,
  };
}
