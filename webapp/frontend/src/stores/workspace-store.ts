// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

import { create } from "zustand";

import type {
  DignityKind,
  PdDirectionState,
  PlanetId,
  RingLabelSegment,
  SymbolicTimeReadout,
} from "@/lib/chart/types";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import {
  patchSidebarListPreferences,
  type SidebarListPreferencesPatch,
  type SidebarListPreferencesPayload,
  type DirectionCustomSignificator,
  type SupplementaryBindingPayload,
  type WorkspaceOpenResult,
} from "@/lib/daemon/client";
import {
  sourceLiveFollowPolicy,
  type ListFollowPolicy,
} from "@/lib/list-follow-policy";
import { sameRetainedPaneActivation } from "@/lib/retained-pane-activation.mjs";

export type HoverRegion =
  | {
      kind: "planet";
      planetId: PlanetId;
      seId: number;
      longitude: number;
      latitude: number;
      speed: number;
      house?: number;
      dignity?: DignityKind;
      abovehorizon?: boolean;
      // 'outer' for a biwheel/synastry/transit OUTER-ring body, 'primary' for
      // the inner radix. Mirrors graphchart's region.chart_role (graphchart.py:
      // 2151) — the daemon resolves an outer body against the comparison chart,
      // not the inner one. Absent ⇒ 'primary'.
      chartRole?: "primary" | "outer";
      /** Zero-based chart index when the body belongs to a multi-wheel. */
      ringIndex?: number;
    }
  // Vertex is its OWN region kind, not a planet — graphchart draws it via
  // _iter_draw_body_ids with object_id = CHART_OBJECT_VERTEX (graphchart.py:
  // 2879). Registering it as a distinct kind keeps build_flag_payload from
  // falling through to sign 0 (the prior bug: no vertex branch in hitToHover).
  | { kind: "vertex"; longitude: number; house?: number; chartRole?: "primary" | "outer"; ringIndex?: number }
  | { kind: "fortune"; longitude: number; chartRole?: "primary" | "outer"; ringIndex?: number }
  | { kind: "syzygy"; longitude: number; house?: number; label?: string; chartRole?: "primary" | "outer"; ringIndex?: number }
  | { kind: "eclipse"; longitude: number; house?: number; label?: string; chartRole?: "primary" | "outer"; ringIndex?: number }
  | { kind: "angle"; angleId: "asc" | "mc" | "dsc" | "ic"; longitude: number; chartRole?: "primary" | "outer"; ringIndex?: number }
  | { kind: "house"; houseIndex: number; longitude: number }
  | { kind: "sign"; signIndex: number; longitude: number }
  | {
      kind: "secondary_ring";
      family: string;
      itemId: string;
      label: string;
      longitude: number;
      chartRole?: "primary" | "outer";
      searchObjectId?: string;
      segments?: RingLabelSegment[];
    }
  | { kind: "aspect"; p1: string; p2: string; aspectType: number; scope?: "primary" | "interchart" }
  | { kind: "drishti"; relationId: string; method: "parashari" | "jaimini" }
  | {
      kind: "pd_event";
      eventId: string;
      eventKind: "body-aspect-to-angle" | "angle-to-body-aspect";
      component: "direction-ray" | "directed-angle" | "directed-angle-label";
      partyRole: "promissor" | "significator";
      sourceRole: "primary" | "outer";
      track: "inner" | "outer";
      motion: "fixed" | "moving";
      exactNow: boolean;
      longitude: number;
      nativeCoordinate: number;
      directionState: PdDirectionState;
    };

export function hoverRegionKey(region: HoverRegion | null): string | null {
  if (!region) return null;
  // chartRole disambiguates inner vs outer body in a biwheel so hovering the
  // outer Sun doesn't share a key with the inner Sun (graphchart keys hover by
  // (kind, object_id, chart_role)).
  const role = "chartRole" in region && region.chartRole === "outer" ? ":outer" : "";
  const ring = "ringIndex" in region && region.ringIndex != null
    ? `:ring:${region.ringIndex}`
    : "";
  switch (region.kind) {
    case "planet":
      return `planet:${region.seId}${role}${ring}`;
    case "vertex":
      return `vertex${role}${ring}`;
    case "fortune":
      return `fortune${role}${ring}`;
    case "syzygy":
      return `syzygy${role}${ring}`;
    case "eclipse":
      return `eclipse${role}${ring}`;
    case "angle":
      return `angle:${region.angleId}${role}${ring}`;
    case "house":
      return `house:${region.houseIndex}`;
    case "sign":
      return `sign:${region.signIndex}`;
    case "secondary_ring":
      return `secondary_ring:${region.family}:${region.itemId}:${region.searchObjectId ?? ""}:${region.label}${role}`;
    case "aspect":
      return `aspect:${region.scope ?? "primary"}:${region.p1}:${region.p2}:${region.aspectType}`;
    case "drishti":
      return `drishti:${region.relationId}`;
    case "pd_event":
      return `pd_event:${region.eventId}:${region.component}:${region.partyRole}:${region.sourceRole}:${region.track}`;
  }
}

export type TransitSearchPaneState = {
  documentId: string;
  followPolicy?: ListFollowPolicy;
  significatorId?: string | null;
  chartRole?: "primary" | "outer" | null;
  customPoints?: Record<string, unknown>[];
  label?: string;
  glyph?: string;
};

export type TransitListPaneState = {
  documentId: string;
  sourceName: string;
  followPolicy?: ListFollowPolicy;
  openSeq?: number;
  focusDatetime?: string | null;
};

export type TransitListPreferences = {
  selectedPromittorId: string | null;
  promittorDrawerOpen: boolean;
  direction: "direct" | "converse" | "both";
};

export type DirectionsPaneState = {
  documentId: string;
  followPolicy?: ListFollowPolicy;
  openSeq?: number;
  cursorDocumentId?: string;
  sourceName: string;
  source?: string;
  focusDatetime?: string;
  initialTab?: "primary" | "secondary" | "circumambulation";
  initialPrimaryMode?: "radix" | "sr" | "lr";
  initialPrimaryDirection?: number;
  secondaryMethod?: "secondary" | "minor" | "tertiary";
  customSignificator?: DirectionCustomSignificator | null;
};

export type TimeLordTableId =
  | "firdaria"
  | "vimshottari"
  | "decennials"
  | "triplicity_directions"
  | "zodiacal_releasing"
  | "profections_table";

export type TimeLordPaneState = {
  documentId: string;
  sourceName: string;
  tableId: TimeLordTableId;
  followPolicy?: ListFollowPolicy;
};

export type VimshottariPreferences =
  SidebarListPreferencesPayload["vimshottari"];

// Zodiacal Releasing right pane — the webapp surface for the wx in-frame ZR
// table (zodiacalreleasingwnd.ZRWnd hosted by morin._workspace_table_zodiacal_releasing,
// morin.py:17129-17159). documentId is the radix document the pane is bound to.
export type ZodiacalReleasingPaneState = {
  documentId: string;
  sourceName: string;
  followPolicy?: ListFollowPolicy;
};

// Firdaria right pane — the webapp surface for the wx in-frame Firdaria table
// (firdariawnd.FirdariaWnd wrapped by firdariaframe.FirdariaFrame, hosted by
// morin._workspace_table_firdaria, morin.py:16764-16769). documentId is the
// radix document the pane is bound to.
export type FirdariaPaneState = {
  documentId: string;
  sourceName: string;
  followPolicy?: ListFollowPolicy;
};

// Decennials right pane — the webapp surface for the wx in-frame Decennials
// table (decennialswnd.DecWnd hosted by morin._workspace_table_decennials,
// morin.py:17161-17179, wrapped by decennialsframe.DecennialsFrame:6-26).
// documentId is the radix document the pane is bound to.
export type DecennialsPaneState = {
  documentId: string;
  sourceName: string;
  followPolicy?: ListFollowPolicy;
};

// Profections TABLE right pane — the webapp surface for the wx in-frame
// annual-profections table (profectionswnd.ProfectionsWnd hosted by
// morin._workspace_table_profections, morin.py:16991-17010, incl. the monthly
// drill profectionsmonwnd.ProfectionsMonWnd reached via onMonthly,
// profectionswnd.py:337-346). documentId is the radix document the pane is
// bound to.
export type ProfectionsPaneState = {
  documentId: string;
  sourceName: string;
  followPolicy?: ListFollowPolicy;
};

// Eclipses right pane — the webapp surface for the wx EclipsesFrame/EclipsesWnd
// range-scrolling consultation table (eclipsesframe.py / eclipseswnd.py).
// documentId is the radix document the pane is bound to.
export type EclipsesPaneState = {
  documentId: string;
  sourceName: string;
  followPolicy?: ListFollowPolicy;
};

export type LunarMansionsPaneState = {
  documentId: string;
  sourceName: string;
};

export type SynodicCyclesPaneState = {
  documentId: string;
  sourceName: string;
  focusDatetime?: string | null;
  followPolicy?: ListFollowPolicy;
  openSeq?: number;
};

export type SynodicListPreferences = {
  ingressPlanetIds: number[];
  synodicPlanetIds: number[];
  lunarCycleIds: string[];
  ingressDrawerOpen: boolean;
  synodicDrawerOpen: boolean;
  lunarDrawerOpen: boolean;
};

export type SecondaryProgressionsPreferences =
  SidebarListPreferencesPayload["secondaryProgressions"];

export type AspectListMode =
  | "primary"
  | "outer"
  | "outerToPrimary"
  | "primaryToOuter";

export type AspectListPaneState = {
  documentId: string;
  sourceName: string;
  focusDatetime?: string | null;
  followPolicy?: ListFollowPolicy;
  openSeq?: number;
};

export type AspectListPreferences = {
  mode: AspectListMode | null;
  maxOrb: number;
  sortBy: "body" | "orb" | "exact";
  sortDirection: "asc" | "desc";
  /** Positive display focus; empty means every ordinary point. */
  focusedFilterIds: string[];
  /** Relationship rule for two or more focused endpoints. */
  focusMatchMode: "or" | "and";
  /** Motion constraint for rows with an R, SR, or SD endpoint. */
  rxFocusEnabled: boolean;
  /** Retained inclusion overrides keyed by the active secondary-ring mode. */
  secondaryRingEnabledByMode: Record<string, boolean>;
  filterDrawerOpen: boolean;
};

const DEFAULT_SIDEBAR_LIST_PREFERENCES: SidebarListPreferencesPayload = {
  schemaVersion: 2,
  aspectList: {
    mode: null,
    maxOrb: 10,
    sortBy: "orb",
    sortDirection: "asc",
    focusedFilterIds: [],
    focusMatchMode: "or",
    rxFocusEnabled: false,
    secondaryRingEnabledByMode: {},
    filterDrawerOpen: false,
  },
  transitList: {
    selectedPromittorId: null,
    promittorDrawerOpen: false,
    direction: "direct",
  },
  synodicList: {
    ingressPlanetIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15],
    synodicPlanetIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15],
    lunarCycleIds: ["draconic", "anomalistic"],
    ingressDrawerOpen: false,
    synodicDrawerOpen: false,
    lunarDrawerOpen: false,
  },
  secondaryProgressions: {
    planetIds: null,
    aspectIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    filterDrawerOpen: false,
  },
  vimshottari: {
    anchor: "moon",
    startStar: "janma",
    yearDays: 365.25,
    ayanamsha: "follow_chart",
  },
};

let pendingSidebarListPreferencePatch: SidebarListPreferencesPatch | null = null;
let sidebarListPreferenceWrite: Promise<void> | null = null;

function mergeSidebarListPreferencePatches(
  current: SidebarListPreferencesPatch | null,
  patch: SidebarListPreferencesPatch,
): SidebarListPreferencesPatch {
  return {
    ...(current?.aspectList || patch.aspectList
      ? {
          aspectList: {
            ...current?.aspectList,
            ...patch.aspectList,
          },
        }
      : {}),
    ...(current?.transitList || patch.transitList
      ? {
          transitList: {
            ...current?.transitList,
            ...patch.transitList,
          },
        }
      : {}),
    ...(current?.synodicList || patch.synodicList
      ? {
          synodicList: {
            ...current?.synodicList,
            ...patch.synodicList,
          },
        }
      : {}),
    ...(current?.secondaryProgressions || patch.secondaryProgressions
      ? {
          secondaryProgressions: {
            ...current?.secondaryProgressions,
            ...patch.secondaryProgressions,
          },
        }
      : {}),
    ...(current?.vimshottari || patch.vimshottari
      ? {
          vimshottari: {
            ...current?.vimshottari,
            ...patch.vimshottari,
          },
        }
      : {}),
  };
}

async function drainSidebarListPreferenceWrites(): Promise<void> {
  while (pendingSidebarListPreferencePatch) {
    const patch = pendingSidebarListPreferencePatch;
    pendingSidebarListPreferencePatch = null;
    try {
      await patchSidebarListPreferences(patch);
    } catch (error) {
      pendingSidebarListPreferencePatch = mergeSidebarListPreferencePatches(
        patch,
        pendingSidebarListPreferencePatch ?? {},
      );
      throw error;
    }
  }
}

function startSidebarListPreferenceWrite(): Promise<void> {
  const write = drainSidebarListPreferenceWrites();
  sidebarListPreferenceWrite = write;
  const clearWrite = () => {
    if (sidebarListPreferenceWrite === write) {
      sidebarListPreferenceWrite = null;
    }
  };
  // Clear the active slot on either outcome without replacing the rejection
  // returned to callers. A pending patch is retained by the drain on failure.
  void write.then(clearWrite, clearWrite);
  return write;
}

/**
 * Await every queued retained-list preference write before native teardown.
 *
 * Recheck the queue after each active request settles. A user change can land
 * in the promise-reaction handoff after the drain's final empty check but
 * before its active slot clears; returning that old promise directly strands
 * the new patch and makes the following app launch appear to reset the flag.
 */
export async function flushSidebarListPreferenceWrites(): Promise<void> {
  while (pendingSidebarListPreferencePatch || sidebarListPreferenceWrite) {
    const write =
      sidebarListPreferenceWrite ?? startSidebarListPreferenceWrite();
    await write;
  }
}

function persistSidebarListPreferencePatch(
  patch: SidebarListPreferencesPatch,
): void {
  pendingSidebarListPreferencePatch = mergeSidebarListPreferencePatches(
    pendingSidebarListPreferencePatch,
    patch,
  );
  void flushSidebarListPreferenceWrites().catch((error) => {
    console.warn("[sidebar-list-preferences]", error);
  });
}

// Ascensional Transits right pane — companion list/options for the
// chart-backed AT child. The chart stays in the main document surface; the
// daemon-owned AT list lives in the same closable/resizable right pane ontology
// as Directions/Transit Search.
export type AscensionalTransitsPaneState = {
  documentId: string;
  sourceName: string;
  followPolicy?: ListFollowPolicy;
  ascensionalEventJd?: number | null;
  ascensionalEventPlace?: Record<string, unknown> | null;
  ascensionalFilterToActiveMoment?: boolean | null;
  ascensionalApplyPrecession?: boolean | null;
};

export type AstrocartControlsPaneState = {
  documentId: string;
};

export type CalendarPaneState = {
  documentId: string;
};

export type CalendarView = "month" | "week" | "day";

export type CalendarEventState = {
  id: string | number;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  color?: string;
  backgroundColor?: string;
  description?: string;
  location?: string;
};

export type FeatureCatalogPaneState = {
  content: "features" | "help" | "license" | "notices" | "whats-new";
  openSeq: number;
  version?: string;
  notes?: string;
};

export type RightInspectorPaneState =
  | { kind: "transit-search"; state: TransitSearchPaneState }
  | { kind: "transit-list"; state: TransitListPaneState }
  | { kind: "directions"; state: DirectionsPaneState }
  | { kind: "time-lords"; state: TimeLordPaneState }
  | { kind: "zodiacal-releasing"; state: ZodiacalReleasingPaneState }
  | { kind: "firdaria"; state: FirdariaPaneState }
  | { kind: "decennials"; state: DecennialsPaneState }
  | { kind: "profections"; state: ProfectionsPaneState }
  | { kind: "eclipses"; state: EclipsesPaneState }
  | { kind: "lunar-mansions"; state: LunarMansionsPaneState }
  | { kind: "synodic-cycles"; state: SynodicCyclesPaneState }
  | { kind: "aspect-list"; state: AspectListPaneState }
  | { kind: "ascensional-transits"; state: AscensionalTransitsPaneState }
  | { kind: "calendar"; state: CalendarPaneState }
  | { kind: "astrocart-controls"; state: AstrocartControlsPaneState }
  | { kind: "feature-catalog"; state: FeatureCatalogPaneState };

export type RightInspectorPaneKind = RightInspectorPaneState["kind"];

type RightPaneKey =
  | "transitSearchPane"
  | "transitListPane"
  | "directionsPane"
  | "timeLordPane"
  | "zodiacalReleasingPane"
  | "firdariaPane"
  | "decennialsPane"
  | "profectionsPane"
  | "eclipsesPane"
  | "lunarMansionsPane"
  | "synodicCyclesPane"
  | "aspectListPane"
  | "ascensionalTransitsPane"
  | "calendarPane"
  | "astrocartControlsPane"
  | "featureCatalogPane";

const RIGHT_PANE_KEYS = [
  "transitSearchPane",
  "transitListPane",
  "directionsPane",
  "timeLordPane",
  "zodiacalReleasingPane",
  "firdariaPane",
  "decennialsPane",
  "profectionsPane",
  "eclipsesPane",
  "lunarMansionsPane",
  "synodicCyclesPane",
  "aspectListPane",
  "ascensionalTransitsPane",
  "calendarPane",
  "astrocartControlsPane",
  "featureCatalogPane",
] as const satisfies readonly RightPaneKey[];

// ---------------------------------------------------------------------------
// Workspace document tree — direct port of WorkspaceState (workspace_model.py).
//   • Each chart is a WorkspaceDocument.
//   • Supplementary charts (transit/SR/LR/progression/solar-arc/synastry)
//     attach to their parent radix via parentDocumentId. Lifetime tied to
//     the parent — closing a parent cascade-closes descendants
//     (matches morin.py:_handle_workspace_document_close).
//   • Sidebar renders the tree with depth-based indentation.
//   • Tabs reorder among siblings only (parent branch preserved).
// ---------------------------------------------------------------------------

export type SupplementaryKind =
  | "transits"
  | "converse-transits"
  | "solar-revolution"
  | "lunar-revolution"
  | "planetary-return"
  | "secondary-progression"
  | "tertiary-progression"
  | "minor-progression"
  | "solar-arc"
  | "solar-average"
  | "harmonic"
  | "profections"
  | "synastry";

export const SUPPLEMENTARY_KIND_LABELS: Record<SupplementaryKind, string> = {
  "transits": "Transits",
  "converse-transits": "Converse Transits",
  "solar-revolution": "Solar Revolution",
  "lunar-revolution": "Lunar Revolution",
  "planetary-return": "Planetary Return",
  "secondary-progression": "Secondary Progression",
  "tertiary-progression": "Tertiary Progression",
  "minor-progression": "Minor Progression",
  "solar-arc": "Solar Arc",
  "solar-average": "Average Returns",
  "harmonic": "Harmonic chart",
  "profections": "Profections",
  "synastry": "Synastry",
};

export type WorkspaceDocument = {
  id: string;
  parentDocumentId: string | null;
  /** Stable semantic title key for daemon documents (table.<id>, supplementary.*).
   * When present, chrome renders the live locale instead of a baked title. */
  titleKey?: string | null;
  /**
   * Radix = a chart loaded from disk by name.
   * Here-now = File -> Here and Now horary/current chart.
   * Supplementary = derived from a parent radix (transit/SR/LR/progression/arc/synastry).
   * Astrocart = a map view of the radix's planetary lines (iframe surface, not a wheel).
   * Directions = the Primary Directions list (a dated-directions table, not a wheel).
   * Astrolabe = the planispheric astrolabe (a Canvas2D projection surface, not a wheel).
   * Astrolog sphere = Astrolog-style chart sphere projection surface (not a wheel).
   * Ephemeris = the Graphic Ephemeris (a Canvas2D year plot, not a wheel).
   * Transit search = a result table/form surface backed by the Python search engine.
   * Ascensional transits = chart-backed AT child with a daemon-owned list payload.
   * Table = a generic embedded Morinus table whose rows come from the daemon.
   */
  kind:
    | "radix"
    | "here-now"
    | "supplementary"
    | "astrocart"
    | "directions"
    | "astrolabe"
    | "astrolog-sphere"
    | "square-chart"
    | "mundane-chart"
    | "ephemeris"
    | "transit-search"
    | "ascensional-transits"
    | "table";
  /** Hors.jsonl chart name for the root radix of this branch. */
  sourceName: string;
  /** Supplementary feature for derived docs. */
  supplementaryFeatureKind?: SupplementaryKind;
  /** Daemon-owned chart rendering layer. "zodiac" is the ordinary wheel. */
  chartVisualMode?: "zodiac" | "mdo" | "mundane" | "ascensional_transits" | string;
  /** Internal daemon launch route for chart-session specializations. */
  launcherKind?: string;
  /** For synastry: the second radix's source name (outer ring). */
  comparisonSourceName?: string;
  /** Daemon-owned relationship mode for synastry/composite documents. */
  compoundKind?: string | null;
  /** Daemon-owned composite variant, when compoundKind is composite_from_synastry. */
  compositeVariant?: string | null;
  /** Optional anchor datetime (ISO) — null/undefined means "now". Used for
   * time-stepped supplementary kinds (transit/SR/LR/progression/arc). */
  displayDatetime?: string;
  /** Signified real cursor for symbolic progression/PD children, daemon-owned. */
  symbolicTime?: SymbolicTimeReadout | null;
  /** Daemon-formatted wx-style runtime suffix for sidebar document rows. */
  tabSuffix?: string;
  /** Horary/here-now docs use the wx "Name (suffix)" tab format. */
  isHorary?: boolean;
  /** Saved horary lens (chrt.interpretation) — adopted into inspectorLens on
   * activation (morin.py:9073-9083). Horary docs only. */
  interpretation?: {
    discipline: string;
    theme: string;
    context?: Record<string, unknown> | null;
  } | null;
  supplementaryBinding?: SupplementaryBindingPayload;
  /** Transit-search tabs may be seeded from a clicked chart glyph. */
  searchInitialSignificatorId?: string | null;
  searchInitialLabel?: string;
  searchInitialGlyph?: string;
  directionsCustomSignificator?: DirectionCustomSignificator | null;
  directionsDefaultDirection?: number | null;
  tableId?: string | null;
  /** Astrocart docs opened via "Show Eclipse Path on Map" carry the solar
   * eclipse to overlay (wx AstrocartPanel eclipse_event, morin.py:16198-16227). */
  eclipseEvent?: { jdUt: number; retflag: number } | null;
  ascensionalEventJd?: number | null;
  ascensionalEventPlace?: Record<string, unknown> | null;
  ascensionalFilterToActiveMoment?: boolean | null;
  ascensionalApplyPrecession?: boolean | null;
  title: string;
  /** Daemon-reported unsaved-changes flag (slice 3). Drives the sidebar dirty
   * dot. Absent on client-overlay docs (synastry/astrocart never dirty). */
  dirty?: boolean;
  /** Daemon-reported backing file path (empty for ephemeral charts). Used to
   * mirror the close-prompt "file-backed" predicate (morin.py:11536). */
  fpath?: string;
  /** Daemon runtime launcher gate for this document's session. View-only
   * children may have no chart session; callers can fall back to their parent
   * radix document's gate for sidebar/menu launchers. */
  enabledActions?: Record<string, boolean>;
};

/** Resolve a daemon document's stable semantic title in the active locale.
 * Raw titles remain the fallback for user names and data-bearing titles. */
export function localizedWorkspaceDocumentTitle(
  doc: WorkspaceDocument,
  translate?: (key: string) => string,
): string {
  const raw = doc.title.replace(/\s*\*$/, "").trim();
  if (!translate || !doc.titleKey) return raw;
  const localized = translate(doc.titleKey);
  return localized && localized !== doc.titleKey ? localized : raw;
}

type WorkspaceState = {
  // Per-chart-canvas UX state (client-only)
  hoveredRegion: HoverRegion | null;
  inspectorActiveRegion: HoverRegion | null;
  transitSearchPane: TransitSearchPaneState | null;
  transitListPane: TransitListPaneState | null;
  transitListPreferencesByDocument: Record<string, TransitListPreferences>;
  sidebarListPreferenceDefaults: SidebarListPreferencesPayload | null;
  sidebarListPreferencesHydrated: boolean;
  directionsPane: DirectionsPaneState | null;
  secondaryProgressionsPreferencesByDocument: Record<string, SecondaryProgressionsPreferences>;
  timeLordPane: TimeLordPaneState | null;
  zodiacalReleasingPane: ZodiacalReleasingPaneState | null;
  firdariaPane: FirdariaPaneState | null;
  decennialsPane: DecennialsPaneState | null;
  profectionsPane: ProfectionsPaneState | null;
  eclipsesPane: EclipsesPaneState | null;
  lunarMansionsPane: LunarMansionsPaneState | null;
  synodicCyclesPane: SynodicCyclesPaneState | null;
  synodicListPreferencesByDocument: Record<string, SynodicListPreferences>;
  aspectListPane: AspectListPaneState | null;
  aspectListPreferencesByDocument: Record<string, AspectListPreferences>;
  ascensionalTransitsPane: AscensionalTransitsPaneState | null;
  calendarPane: CalendarPaneState | null;
  calendarViewDate: string | null;
  calendarView: CalendarView;
  calendarEvents: CalendarEventState[] | null;
  astrocartControlsPane: AstrocartControlsPaneState | null;
  featureCatalogPane: FeatureCatalogPaneState | null;
  timedChartListRowLinkDocumentIds: Record<string, true>;

  // Click-to-toggle aspects selection state — PURE UI interaction state (the
  // desktop's morin._click_aspect_planet equivalent). The daemon owns the
  // option flags + aspect data; the skin owns which body is selected and
  // whether all aspects are hidden. Ephemeral (session-only).
  //   • selectedAspectBody: body/point key whose aspects render exclusively, or null.
  //   • hideAllAspects: the midband_empty / A "hide all" gate.
  //   • minorOnlyAspects: M's inner-wheel exception while that gate stays shut
  //     for comparison/transit aspects.
  // Selecting a target clears hideAllAspects and vice-versa (mutually exclusive,
  // mirroring morin._on_chart_click_for_aspects' single _click_aspect_planet).
  selectedAspectBody: string | null;
  hideAllAspects: boolean;
  minorOnlyAspects: boolean;

  // Inspector Zone B — the active interpretation lens (discipline/theme/context)
  // that pack alerts evaluate against. PRESENTATION-only cursor: the daemon owns
  // the alert CONTENT (elections/horary rule-engine verdicts); the skin owns
  // only which lens is selected. Null == no lens → no alerts section (valid;
  // matches morin._refresh_pack_alerts clearing on no discipline/theme). A lens
  // picker surface can drive this later — it is not built here.
  inspectorLens: { discipline: string; theme: string; context?: Record<string, unknown> } | null;

  // Corpus rule-pack filter version. Bumped after a successful pack toggle
  // (POST /api/corpus/packs/active) so consumers of the daemon-side active-pack
  // filter (Zone B pack alerts) refetch — the web twin of wx re-firing the
  // interpretation callback in _on_pack_toggled (workspace_shell.py:2558-2569).
  // The filter ITSELF lives in the daemon (rule_engine); this is a cache nonce.
  packsVersion: number;

  // Corpus semantic-profile version. This is separate from packsVersion:
  // changing geometry/orb doctrine must re-evaluate visible alerts, but it
  // does not change which disciplines or themes the active packs provide.
  semanticProfileVersion: number;

  // Runtime state for timed-list row actions. The saved QuickCharts option only
  // seeds this default; the chart context-menu "Show Radix" item can flip it
  // during a work session without mutating chart/session truth.
  timedChartShowRadix: boolean;

  // Daemon-owned Options default for primary Aspect List perfection links.
  aspectListPerfectionLinkMode: "transits" | "secondary";

  // Synastry-partner picker bridge. The picker is a standalone Tauri window,
  // but the radix-wheel context menu still needs to trigger it without
  // prop-drilling through the chart-surface tree. home-client registers its
  // picker opener here; the menu calls requestSynastryPartner. Ephemeral.
  synastryPartnerRequester:
    | ((radix: WorkspaceDocument) => void)
    | null;

  // Edit-chart bridge. The Personal Data editor dialog is local React state in
  // home-client; the radix-wheel context menu's "Edit chart data" item triggers
  // it without prop-drilling. home-client registers its editor opener here; the
  // menu calls requestEditChart with the radix to edit. Ephemeral (a function).
  editChartRequester:
    | ((radix: WorkspaceDocument) => void)
    | null;

  // UX-state actions
  setHoveredRegion: (region: HoverRegion | null) => void;
  setInspectorActiveRegion: (region: HoverRegion | null) => void;
  openTransitSearchPane: (state: TransitSearchPaneState) => void;
  closeTransitSearchPane: () => void;
  openTransitListPane: (state: TransitListPaneState) => void;
  closeTransitListPane: () => void;
  setTransitListPreferences: (
    documentId: string,
    patch: Partial<TransitListPreferences>,
  ) => void;
  hydrateSidebarListPreferences: (
    preferences: SidebarListPreferencesPayload,
  ) => void;
  openDirectionsPane: (state: DirectionsPaneState) => void;
  closeDirectionsPane: () => void;
  setSecondaryProgressionsPreferences: (
    documentId: string,
    patch: Partial<SecondaryProgressionsPreferences>,
  ) => void;
  openTimeLordPane: (state: TimeLordPaneState) => void;
  closeTimeLordPane: () => void;
  setVimshottariPreferences: (
    patch: Partial<VimshottariPreferences>,
  ) => void;
  openZodiacalReleasingPane: (state: ZodiacalReleasingPaneState) => void;
  closeZodiacalReleasingPane: () => void;
  openFirdariaPane: (state: FirdariaPaneState) => void;
  closeFirdariaPane: () => void;
  openDecennialsPane: (state: DecennialsPaneState) => void;
  closeDecennialsPane: () => void;
  openProfectionsPane: (state: ProfectionsPaneState) => void;
  closeProfectionsPane: () => void;
  openEclipsesPane: (state: EclipsesPaneState) => void;
  closeEclipsesPane: () => void;
  openLunarMansionsPane: (state: LunarMansionsPaneState) => void;
  closeLunarMansionsPane: () => void;
  openSynodicCyclesPane: (state: SynodicCyclesPaneState) => void;
  closeSynodicCyclesPane: () => void;
  setSynodicListPreferences: (
    documentId: string,
    patch: Partial<SynodicListPreferences>,
  ) => void;
  openAspectListPane: (state: AspectListPaneState) => void;
  closeAspectListPane: () => void;
  setAspectListPreferences: (
    documentId: string,
    patch: Partial<AspectListPreferences>,
  ) => void;
  openAscensionalTransitsPane: (state: AscensionalTransitsPaneState) => void;
  closeAscensionalTransitsPane: () => void;
  openCalendarPane: (state: CalendarPaneState) => void;
  closeCalendarPane: () => void;
  setCalendarViewDate: (date: string) => void;
  setCalendarView: (view: CalendarView) => void;
  setCalendarEvents: (events: CalendarEventState[]) => void;
  openAstrocartControlsPane: (state: AstrocartControlsPaneState) => void;
  closeAstrocartControlsPane: () => void;
  openFeatureCatalogPane: () => void;
  openHelpPane: () => void;
  openLegalDocumentPane: (document: "license" | "notices") => void;
  openWhatsNewPane: (version: string, notes: string) => void;
  closeFeatureCatalogPane: () => void;
  closeAllRightPanes: () => void;
  reconcileWorkspaceChrome: (documents: WorkspaceDocument[]) => void;
  applyWorkspaceOpenResult: (
    result: WorkspaceOpenResult,
    options?: { preserveRightPane?: boolean },
  ) => void;
  /** Apply a timed-chart open (list row link / row context menu). The retained
   * source pane stays open for both successful and unsuccessful opens. The
   * opened document id is marked so cursor-aware lists do not adopt its datetime as their focus.
   * Stepping the opened chart later clears the mark so source-live follow
   * resumes from its meaningful cursor. */
  applyTimedChartOpenResult: (result: WorkspaceOpenResult) => void;

  /** Toggle the exclusive-aspect click target for a body key. Same body → clear
   * (toggle off); different body → switch; either way clears hideAllAspects.
   * Port of morin._on_chart_click_for_aspects body branch (morin.py:4286-4293). */
  toggleSelectedAspectBody: (bodyKey: string) => void;
  /** Toggle the midband_empty "hide all aspects" state; clears any body
   * selection. Port of the hide_all branch (morin.py:4257-4258). */
  toggleHideAllAspects: () => void;
  /** Toggle M's inner-wheel minor-only exception without opening A's
   * comparison/transit gate. Has an effect only while hideAllAspects is set. */
  toggleMinorOnlyAspects: () => void;
  /** Clear all click-aspect selection (back to normal render). */
  clearAspectSelection: () => void;

  /** Set (or clear) the active Zone B interpretation lens. Presentation-only. */
  setInspectorLens: (
    lens: { discipline: string; theme: string; context?: Record<string, unknown> } | null,
  ) => void;

  /** Set the chart-context "Show Radix" comparison lens for timed opens. */
  setTimedChartShowRadix: (value: boolean) => void;
  setAspectListPerfectionLinkMode: (value: "transits" | "secondary") => void;

  /** Signal that the daemon-side active-pack filter changed (after a toggle)
   * so pack-alert consumers refetch. */
  bumpPacksVersion: () => void;

  /** Signal that corpus geometry/orb doctrine changed without invalidating
   * the active-pack-gated discipline/theme catalog. */
  bumpSemanticProfileVersion: () => void;

  /** Register (or clear) the synastry-partner picker opener. home-client sets
   * this to its setPicker-based opener on mount. */
  setSynastryPartnerRequester: (
    fn: ((radix: WorkspaceDocument) => void) | null,
  ) => void;
  /** Invoke the registered synastry-partner picker for a radix (no-op if none
   * registered). Called by the radix-wheel context menu's Synastry item. */
  requestSynastryPartner: (radix: WorkspaceDocument) => void;

  /** Register (or clear) the edit-chart editor opener. home-client sets this to
   * its editor-dialog opener on mount. */
  setEditChartRequester: (
    fn: ((radix: WorkspaceDocument) => void) | null,
  ) => void;
  /** Invoke the registered edit-chart editor for a radix (no-op if none
   * registered). Called by the radix-wheel context menu's "Edit chart data". */
  requestEditChart: (radix: WorkspaceDocument) => void;
};

const EMPTY_RIGHT_PANES = {
  transitSearchPane: null,
  transitListPane: null,
  directionsPane: null,
  timeLordPane: null,
  zodiacalReleasingPane: null,
  firdariaPane: null,
  decennialsPane: null,
  profectionsPane: null,
  eclipsesPane: null,
  lunarMansionsPane: null,
  synodicCyclesPane: null,
  aspectListPane: null,
  ascensionalTransitsPane: null,
  calendarPane: null,
  astrocartControlsPane: null,
  featureCatalogPane: null,
} satisfies Pick<WorkspaceState, RightPaneKey>;

function openExclusiveRightPane<K extends RightPaneKey>(
  key: K,
  value: WorkspaceState[K],
): Pick<WorkspaceState, RightPaneKey> {
  return { ...EMPTY_RIGHT_PANES, [key]: value } as Pick<WorkspaceState, RightPaneKey>;
}

function activateRetainedRightPane<K extends RightPaneKey>(
  current: WorkspaceState,
  key: K,
  requested: Exclude<WorkspaceState[K], null>,
  remountOnSemanticChange = false,
): WorkspaceState | Pick<WorkspaceState, RightPaneKey> {
  const active = current[key] as Record<string, unknown> | null;
  const next = (
    remountOnSemanticChange
      ? {
          ...requested,
          openSeq: Number(active?.openSeq ?? 0) + 1,
        }
      : requested
  ) as Exclude<WorkspaceState[K], null>;
  if (
    active &&
    sameRetainedPaneActivation(
      active,
      next as Record<string, unknown>,
    )
  ) {
    return current;
  }
  return openExclusiveRightPane(key, next as WorkspaceState[K]);
}

function applyDaemonWorkspaceOpenResult(
  result: WorkspaceOpenResult,
  options?: { preserveRightPane?: boolean; incrementalDocuments?: boolean },
): Partial<WorkspaceState> {
  const activeDocumentId = result.activeDocumentId ?? result.documentId ?? null;
  if (result.documents) {
    if (options?.incrementalDocuments) {
      useDaemonWorkspaceStore.getState()._applyOpenedDocument({
        documents: result.documents,
        documentId: result.documentId,
        activeDocumentId,
      });
    } else {
      useDaemonWorkspaceStore.getState()._applyState(result.documents, activeDocumentId);
    }
  }
  if (activeDocumentId && result.snapshot) {
    useDaemonWorkspaceStore.getState().pushCommandSnapshot(activeDocumentId, result.snapshot);
  }
  return options?.preserveRightPane ? {} : EMPTY_RIGHT_PANES;
}

function defaultFollowPolicyForPane(
  documentId: string,
  cursorDocumentId?: string | null,
  focusDatetime?: string | null,
): ListFollowPolicy {
  return sourceLiveFollowPolicy({
    sourceDocumentId: documentId,
    cursorDocumentId: cursorDocumentId ?? documentId,
    focusDatetime: focusDatetime ?? null,
  });
}

function reconcileWorkspaceChromeState(
  state: WorkspaceState,
  documents: WorkspaceDocument[],
): Partial<WorkspaceState> {
  // Persistent workshell rule: the chart frame may activate any document, but
  // companion panes live until their owning document leaves the daemon tree.
  const documentIds = new Set(documents.map((doc) => doc.id));
  const next: Partial<WorkspaceState> = {};
  let changed = false;

  for (const key of RIGHT_PANE_KEYS) {
    const pane = state[key];
    if (!pane) continue;
    if (!("documentId" in pane) || documentIds.has(pane.documentId)) continue;
    next[key] = null;
    changed = true;
  }

  // Row-link marks for documents that left the tree are dead — prune them so
  // the map cannot grow across a long session.
  const staleLinkIds = Object.keys(state.timedChartListRowLinkDocumentIds).filter(
    (id) => !documentIds.has(id),
  );
  if (staleLinkIds.length > 0) {
    const pruned = { ...state.timedChartListRowLinkDocumentIds };
    for (const id of staleLinkIds) delete pruned[id];
    next.timedChartListRowLinkDocumentIds = pruned;
    changed = true;
  }

  return changed ? next : {};
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  hoveredRegion: null,
  inspectorActiveRegion: null,
  transitSearchPane: null,
  transitListPane: null,
  transitListPreferencesByDocument: {},
  sidebarListPreferenceDefaults: null,
  sidebarListPreferencesHydrated: false,
  directionsPane: null,
  secondaryProgressionsPreferencesByDocument: {},
  timeLordPane: null,
  zodiacalReleasingPane: null,
  firdariaPane: null,
  decennialsPane: null,
  profectionsPane: null,
  eclipsesPane: null,
  lunarMansionsPane: null,
  synodicCyclesPane: null,
  synodicListPreferencesByDocument: {},
  aspectListPane: null,
  aspectListPreferencesByDocument: {},
  ascensionalTransitsPane: null,
  calendarPane: null,
  calendarViewDate: null,
  calendarView: "month",
  calendarEvents: null,
  astrocartControlsPane: null,
  featureCatalogPane: null,
  timedChartListRowLinkDocumentIds: {},
  selectedAspectBody: null,
  hideAllAspects: false,
  minorOnlyAspects: false,
  inspectorLens: null,
  packsVersion: 0,
  semanticProfileVersion: 0,
  timedChartShowRadix: false,
  aspectListPerfectionLinkMode: "transits",
  synastryPartnerRequester: null,
  editChartRequester: null,

  setHoveredRegion: (region) => {
    if (hoverRegionKey(get().hoveredRegion) === hoverRegionKey(region)) return;
    set({ hoveredRegion: region });
  },
  setInspectorActiveRegion: (region) => set({ inspectorActiveRegion: region }),
  openTransitSearchPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "transitSearchPane", {
        ...state,
        followPolicy: state.followPolicy ?? defaultFollowPolicyForPane(state.documentId),
        significatorId: state.significatorId ?? null,
        chartRole: state.chartRole ?? null,
        customPoints: state.customPoints ?? [],
      }),
    ),
  closeTransitSearchPane: () => set({ transitSearchPane: null }),
  openTransitListPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "transitListPane", {
        ...state,
        followPolicy: state.followPolicy ?? defaultFollowPolicyForPane(state.documentId),
        focusDatetime: state.focusDatetime ?? null,
      }, true),
    ),
  closeTransitListPane: () => set({ transitListPane: null }),
  setTransitListPreferences: (documentId, patch) => {
    set((current) => {
      const defaults =
        current.sidebarListPreferenceDefaults ?? DEFAULT_SIDEBAR_LIST_PREFERENCES;
      const next = {
        ...(current.transitListPreferencesByDocument[documentId] ??
          defaults.transitList),
        ...patch,
      };
      return {
        transitListPreferencesByDocument: {
          ...current.transitListPreferencesByDocument,
          [documentId]: next,
        },
        sidebarListPreferenceDefaults: {
          ...defaults,
          transitList: {
            ...defaults.transitList,
            ...patch,
          },
        },
      };
    });
    persistSidebarListPreferencePatch({ transitList: patch });
  },
  hydrateSidebarListPreferences: (preferences) =>
    set((current) => ({
      sidebarListPreferenceDefaults:
        current.sidebarListPreferenceDefaults ?? preferences,
      sidebarListPreferencesHydrated: true,
    })),
  openDirectionsPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "directionsPane", {
        ...state,
        followPolicy:
          state.followPolicy ??
          defaultFollowPolicyForPane(
            state.documentId,
            state.cursorDocumentId ?? state.documentId,
            state.focusDatetime ?? null,
          ),
      }, true),
    ),
  closeDirectionsPane: () => set({ directionsPane: null }),
  setSecondaryProgressionsPreferences: (documentId, patch) => {
    set((current) => {
      const defaults =
        current.sidebarListPreferenceDefaults ?? DEFAULT_SIDEBAR_LIST_PREFERENCES;
      const next = {
        ...(current.secondaryProgressionsPreferencesByDocument[documentId] ??
          defaults.secondaryProgressions),
        ...patch,
      };
      return {
        secondaryProgressionsPreferencesByDocument: {
          ...current.secondaryProgressionsPreferencesByDocument,
          [documentId]: next,
        },
        sidebarListPreferenceDefaults: {
          ...defaults,
          secondaryProgressions: {
            ...defaults.secondaryProgressions,
            ...patch,
          },
        },
      };
    });
    persistSidebarListPreferencePatch({ secondaryProgressions: patch });
  },
  openTimeLordPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "timeLordPane", {
        ...state,
        followPolicy: state.followPolicy ?? defaultFollowPolicyForPane(state.documentId),
      }),
    ),
  closeTimeLordPane: () => set({ timeLordPane: null }),
  setVimshottariPreferences: (patch) => {
    set((current) => {
      const defaults =
        current.sidebarListPreferenceDefaults ?? DEFAULT_SIDEBAR_LIST_PREFERENCES;
      return {
        sidebarListPreferenceDefaults: {
          ...defaults,
          vimshottari: {
            ...defaults.vimshottari,
            ...patch,
          },
        },
      };
    });
    persistSidebarListPreferencePatch({ vimshottari: patch });
  },
  openZodiacalReleasingPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "zodiacalReleasingPane", {
        ...state,
        followPolicy: state.followPolicy ?? defaultFollowPolicyForPane(state.documentId),
      }),
    ),
  closeZodiacalReleasingPane: () => set({ zodiacalReleasingPane: null }),
  openFirdariaPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "firdariaPane", {
        ...state,
        followPolicy: state.followPolicy ?? defaultFollowPolicyForPane(state.documentId),
      }),
    ),
  closeFirdariaPane: () => set({ firdariaPane: null }),
  openDecennialsPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "decennialsPane", {
        ...state,
        followPolicy: state.followPolicy ?? defaultFollowPolicyForPane(state.documentId),
      }),
    ),
  closeDecennialsPane: () => set({ decennialsPane: null }),
  openProfectionsPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "profectionsPane", {
        ...state,
        followPolicy: state.followPolicy ?? defaultFollowPolicyForPane(state.documentId),
      }),
    ),
  closeProfectionsPane: () => set({ profectionsPane: null }),
  openEclipsesPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "eclipsesPane", {
        ...state,
        followPolicy: state.followPolicy ?? defaultFollowPolicyForPane(state.documentId),
      }),
    ),
  closeEclipsesPane: () => set({ eclipsesPane: null }),
  openLunarMansionsPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "lunarMansionsPane", state),
    ),
  closeLunarMansionsPane: () => set({ lunarMansionsPane: null }),
  openSynodicCyclesPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "synodicCyclesPane", {
        ...state,
        followPolicy: state.followPolicy ?? defaultFollowPolicyForPane(state.documentId),
        focusDatetime: state.focusDatetime ?? null,
      }, true),
    ),
  closeSynodicCyclesPane: () => set({ synodicCyclesPane: null }),
  setSynodicListPreferences: (documentId, patch) => {
    set((current) => {
      const defaults =
        current.sidebarListPreferenceDefaults ?? DEFAULT_SIDEBAR_LIST_PREFERENCES;
      const next = {
        ...(current.synodicListPreferencesByDocument[documentId] ??
          defaults.synodicList),
        ...patch,
      };
      return {
        synodicListPreferencesByDocument: {
          ...current.synodicListPreferencesByDocument,
          [documentId]: next,
        },
        sidebarListPreferenceDefaults: {
          ...defaults,
          synodicList: {
            ...defaults.synodicList,
            ...patch,
          },
        },
      };
    });
    persistSidebarListPreferencePatch({ synodicList: patch });
  },
  openAspectListPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "aspectListPane", {
        ...state,
        followPolicy: state.followPolicy ?? defaultFollowPolicyForPane(state.documentId),
        focusDatetime: state.focusDatetime ?? null,
      }, true),
    ),
  closeAspectListPane: () => set({ aspectListPane: null }),
  setAspectListPreferences: (documentId, patch) => {
    set((current) => {
      const defaults =
        current.sidebarListPreferenceDefaults ?? DEFAULT_SIDEBAR_LIST_PREFERENCES;
      const next = {
        ...(current.aspectListPreferencesByDocument[documentId] ??
          defaults.aspectList),
        ...patch,
      };
      return {
        aspectListPreferencesByDocument: {
          ...current.aspectListPreferencesByDocument,
          [documentId]: next,
        },
        sidebarListPreferenceDefaults: {
          ...defaults,
          aspectList: {
            ...defaults.aspectList,
            ...patch,
          },
        },
      };
    });
    persistSidebarListPreferencePatch({ aspectList: patch });
  },
  openAscensionalTransitsPane: (state) =>
    set((current) =>
      activateRetainedRightPane(current, "ascensionalTransitsPane", {
        ...state,
        followPolicy: state.followPolicy ?? defaultFollowPolicyForPane(state.documentId),
      }),
    ),
  closeAscensionalTransitsPane: () => set({ ascensionalTransitsPane: null }),
  openCalendarPane: (state) =>
    set((current) => activateRetainedRightPane(current, "calendarPane", state)),
  closeCalendarPane: () => set({ calendarPane: null }),
  setCalendarViewDate: (date) =>
    set((current) => (current.calendarViewDate === date ? current : { calendarViewDate: date })),
  setCalendarView: (view) =>
    set((current) => (current.calendarView === view ? current : { calendarView: view })),
  setCalendarEvents: (events) => set({ calendarEvents: events }),
  openAstrocartControlsPane: (state) =>
    set(openExclusiveRightPane("astrocartControlsPane", state)),
  closeAstrocartControlsPane: () => set({ astrocartControlsPane: null }),
  openFeatureCatalogPane: () =>
    set((current) =>
      openExclusiveRightPane("featureCatalogPane", {
        content: "features",
        openSeq: (current.featureCatalogPane?.openSeq ?? 0) + 1,
      }),
    ),
  openHelpPane: () =>
    set((current) =>
      openExclusiveRightPane("featureCatalogPane", {
        content: "help",
        openSeq: (current.featureCatalogPane?.openSeq ?? 0) + 1,
      }),
    ),
  openLegalDocumentPane: (document) =>
    set((current) =>
      openExclusiveRightPane("featureCatalogPane", {
        content: document,
        openSeq: (current.featureCatalogPane?.openSeq ?? 0) + 1,
      }),
    ),
  openWhatsNewPane: (version, notes) =>
    set((current) =>
      openExclusiveRightPane("featureCatalogPane", {
        content: "whats-new",
        version,
        notes,
        openSeq: (current.featureCatalogPane?.openSeq ?? 0) + 1,
      }),
    ),
  closeFeatureCatalogPane: () => set({ featureCatalogPane: null }),
  closeAllRightPanes: () => set(EMPTY_RIGHT_PANES),
  reconcileWorkspaceChrome: (documents) =>
    set((state) =>
      reconcileWorkspaceChromeState(state, documents),
    ),
  applyWorkspaceOpenResult: (result, options) =>
    set(applyDaemonWorkspaceOpenResult(result, options)),
  applyTimedChartOpenResult: (result) => {
    const openedDocumentId = result.activeDocumentId ?? result.documentId ?? null;
    const workspaceOpenPatch = applyDaemonWorkspaceOpenResult(result, {
      preserveRightPane: true,
      incrementalDocuments: true,
    });
    set((state) => ({
      ...workspaceOpenPatch,
      ...(openedDocumentId && !state.timedChartListRowLinkDocumentIds[openedDocumentId]
        ? {
            timedChartListRowLinkDocumentIds: {
              ...state.timedChartListRowLinkDocumentIds,
              [openedDocumentId]: true as const,
            },
          }
        : {}),
    }));
  },
  toggleSelectedAspectBody: (bodyKey) =>
    set((state) => ({
      selectedAspectBody: state.selectedAspectBody === bodyKey ? null : bodyKey,
      hideAllAspects: false,
      minorOnlyAspects: false,
    })),
  toggleHideAllAspects: () =>
    set((state) => ({
      hideAllAspects: !state.hideAllAspects,
      selectedAspectBody: null,
      minorOnlyAspects: false,
    })),
  toggleMinorOnlyAspects: () =>
    set((state) => (
      state.hideAllAspects
        ? { minorOnlyAspects: !state.minorOnlyAspects, selectedAspectBody: null }
        : {}
    )),
  clearAspectSelection: () =>
    set({ selectedAspectBody: null, hideAllAspects: false, minorOnlyAspects: false }),
  setInspectorLens: (lens) => set({ inspectorLens: lens }),
  setTimedChartShowRadix: (value) => set({ timedChartShowRadix: value }),
  setAspectListPerfectionLinkMode: (value) => set({ aspectListPerfectionLinkMode: value }),
  bumpPacksVersion: () => set((state) => ({ packsVersion: state.packsVersion + 1 })),
  bumpSemanticProfileVersion: () => set((state) => ({
    semanticProfileVersion: state.semanticProfileVersion + 1,
  })),
  setSynastryPartnerRequester: (fn) => set({ synastryPartnerRequester: fn }),
  requestSynastryPartner: (radix) => {
    const fn = useWorkspaceStore.getState().synastryPartnerRequester;
    if (fn) fn(radix);
  },
  setEditChartRequester: (fn) => set({ editChartRequester: fn }),
  requestEditChart: (radix) => {
    const fn = useWorkspaceStore.getState().editChartRequester;
    if (fn) fn(radix);
  },
}));

// A row-link mark freezes cursor-aware lists against the opened chart's
// datetime (list row link = chart command only). The moment the user steps that
// chart they are driving its meaningful cursor, so source-live follow resumes.
// The list remains retained; only its viewport anchor follows after step settle.
useDaemonWorkspaceStore.subscribe((state, prevState) => {
  const change = state.lastSessionChange;
  if (!change || change === prevState.lastSessionChange) return;
  if (change.changeReason !== "step") return;
  const marks = useWorkspaceStore.getState().timedChartListRowLinkDocumentIds;
  const steppedIds = [change.docId, ...change.rebuiltChildIds].filter(
    (id): id is string => typeof id === "string" && !!marks[id],
  );
  if (steppedIds.length === 0) return;
  const next = { ...marks };
  for (const id of steppedIds) delete next[id];
  useWorkspaceStore.setState({ timedChartListRowLinkDocumentIds: next });
});

/** Build a tree (root nodes + children) from the flat documents list. */
export type WorkspaceTreeNode = {
  doc: WorkspaceDocument;
  children: WorkspaceTreeNode[];
};

export function buildDocumentTree(docs: WorkspaceDocument[]): WorkspaceTreeNode[] {
  const childrenById = new Map<string | null, WorkspaceDocument[]>();
  for (const d of docs) {
    const k = d.parentDocumentId;
    if (!childrenById.has(k)) childrenById.set(k, []);
    childrenById.get(k)!.push(d);
  }
  const build = (parentId: string | null): WorkspaceTreeNode[] =>
    (childrenById.get(parentId) ?? []).map((doc) => ({
      doc,
      children: build(doc.id),
    }));
  return build(null);
}

/** Flatten the tree into ordered (node, depth) entries — for sidebar render. */
export function flattenDocumentTree(
  tree: WorkspaceTreeNode[],
  depth = 0,
): Array<{ node: WorkspaceTreeNode; depth: number }> {
  const out: Array<{ node: WorkspaceTreeNode; depth: number }> = [];
  for (const node of tree) {
    out.push({ node, depth });
    out.push(...flattenDocumentTree(node.children, depth + 1));
  }
  return out;
}
