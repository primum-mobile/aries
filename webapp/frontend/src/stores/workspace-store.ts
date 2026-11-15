// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

import { create } from "zustand";
import { changeAspectView, type AspectViewState } from "@/lib/chart/aspect-view-state";

import type {
  DignityKind,
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
  type EditorCursorSeed,
} from "@/lib/daemon/client";
import {
  sourceLiveFollowPolicy,
  type ListFollowPolicy,
} from "@/lib/list-follow-policy";
import { sameRetainedPaneActivation } from "@/lib/retained-pane-activation.mjs";
import { hasRadixPane, livePane, radixPaneOwner, retainRadixPanes } from "@/lib/radix-pane-state";
import { noteTouchPaneOpened, restoreTouchPane } from "@/stores/touch-pane-store";
import { rightPaneWidthPolicy, useFrameLayoutStore } from "@/stores/frame-layout-store";
import { activeRightPaneModule } from "@/components/workshell/right-pane-layout";

export type HoverRegion = {
  viewDocumentId?: string;
  coordinateRevision?: number;
  coordinateMode?: "zodiacal" | "ascensional";
} & (
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
      /** Hovered moment (JD UT) of a view that plots time (Graphic Ephemeris):
       * the body in the transit sky at that moment over the view's radix. */
      atJd?: number;
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
  | { kind: "house"; houseIndex: number; longitude: number; chartRole?: "primary" | "outer" }
  | { kind: "sign"; signIndex: number; longitude: number }
  | { kind: "term"; signIndex: number; rulerSeId: number; longitude: number }
  | { kind: "decan"; signIndex: number; decanIndex: number; rulerSeId: number; longitude: number }
  | {
      kind: "secondary_ring";
      family: string;
      itemId: string;
      label: string;
      longitude: number;
      chartRole?: "primary" | "outer";
      searchObjectId?: string;
      /** Exact catalog identity for an astrolabe star outside the chart selection. */
      starCode?: string;
      segments?: RingLabelSegment[];
    }
  | { kind: "aspect"; p1: string; p2: string; aspectType: number; scope?: "primary" | "interchart"; method?: string; contactId?: string }
  | { kind: "drishti"; relationId: string; method: "parashari" | "jaimini" }
  /** Chart dashboard: a body's parallels / contraparallels in orb, or one pair. */
  | { kind: "declination"; seId: number; partner?: number });

export function hoverRegionKey(region: HoverRegion | null): string | null {
  const semantic = semanticHoverRegionKey(region);
  return semantic && region?.viewDocumentId
    ? `${region.viewDocumentId}:${region.coordinateMode ?? "zodiacal"}:${region.coordinateRevision ?? 0}:${semantic}` : semantic;
}

function semanticHoverRegionKey(region: HoverRegion | null): string | null {
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
      return `planet:${region.seId}${role}${ring}${region.atJd != null ? `:at:${region.atJd}` : ""}`;
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
    case "term":
      return `term:${region.signIndex}:${region.rulerSeId}`;
    case "decan":
      return `decan:${region.signIndex}:${region.decanIndex}`;
    case "secondary_ring":
      return `secondary_ring:${region.family}:${region.itemId}:${region.starCode ?? ""}:${region.searchObjectId ?? ""}:${region.label}${role}`;
    case "declination":
      return `declination:${region.seId}:${region.partner ?? ""}`;
    case "aspect":
      return region.contactId ? `aspect:${region.method}:${region.contactId}`
        : `aspect:${region.scope ?? "primary"}:${region.p1}:${region.p2}:${region.aspectType}`;
    case "drishti":
      return `drishti:${region.relationId}`;
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

export type TransitListPreferences = SidebarListPreferencesPayload["transitList"];

/** The pane's selected technique tab and Primary surface. Part of the
 * retained pane object, so leaving and re-entering a radix restores it. */
export type DirectionsPaneView = {
  tab: "primary" | "secondary";
  surface: "directions" | "circumambulation" | "significators";
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
  view?: DirectionsPaneView;
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

export type PdPositionsPaneState = {
  documentId: string;
  sourceName: string;
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
  planetIds: number[];
  ingressesEnabled: boolean;
  synodicsEnabled: boolean;
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
  /** Display-only applying/separating phase projection; Both keeps every row. */
  phaseFilter: "applying" | "separating" | "both";
  /** Positive display focus; empty means every ordinary point. */
  focusedFilterIds: string[];
  /** Relationship rule for two or more focused endpoints. */
  focusMatchMode: "or" | "and";
  /** Motion constraint for rows with an R, SR, or SD endpoint. */
  rxFocusEnabled: boolean;
  /** Independent display inclusion for house cusp contacts. */
  includeHouseCusps: boolean;
  /** Display inclusion for minor-aspect rows (always calculated). */
  includeMinorAspects: boolean;
  /** Display inclusion for parallel/contraparallel rows (always calculated). */
  includeDeclination: boolean;
  /** Ascensional view's own orb choice, in arcminutes. */
  ascensionalMaxOrbArcmin: number;
  /** Retained inclusion overrides keyed by the active secondary-ring mode. */
  secondaryRingEnabledByMode: Record<string, boolean>;
  filterDrawerOpen: boolean;
};

const DEFAULT_SIDEBAR_LIST_PREFERENCES: SidebarListPreferencesPayload = {
  schemaVersion: 3,
  aspectList: {
    mode: null,
    maxOrb: 10,
    sortBy: "orb",
    sortDirection: "asc",
    phaseFilter: "both",
    focusedFilterIds: [],
    focusMatchMode: "or",
    rxFocusEnabled: false,
    includeHouseCusps: true,
    includeMinorAspects: false,
    includeDeclination: false,
    ascensionalMaxOrbArcmin: 25,
    secondaryRingEnabledByMode: {},
    filterDrawerOpen: false,
  },
  transitList: {
    pointFilterSide: "from",
    selectedPointIds: null,
    selectedAspectIds: null,
    filterDrawerOpen: false,
    direction: "direct",
  },
  synodicList: {
    planetIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15],
    ingressesEnabled: true,
    synodicsEnabled: true,
    ingressPlanetIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15],
    synodicPlanetIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15],
    lunarCycleIds: ["draconic", "anomalistic", "void-course"],
    ingressDrawerOpen: false,
    synodicDrawerOpen: false,
    lunarDrawerOpen: false,
  },
  secondaryProgressions: {
    planetIds: null,
    angleIds: null,
    aspectIds: [0, 3, 5, 6, 10],
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

export type ChartEventsPaneState = { documentId: string };

export type RightInspectorPaneState =
  | { kind: "chart-events"; state: ChartEventsPaneState }
  | { kind: "transit-search"; state: TransitSearchPaneState }
  | { kind: "transit-list"; state: TransitListPaneState }
  | { kind: "directions"; state: DirectionsPaneState }
  | { kind: "time-lords"; state: TimeLordPaneState }
  | { kind: "zodiacal-releasing"; state: ZodiacalReleasingPaneState }
  | { kind: "firdaria"; state: FirdariaPaneState }
  | { kind: "decennials"; state: DecennialsPaneState }
  | { kind: "profections"; state: ProfectionsPaneState }
  | { kind: "eclipses"; state: EclipsesPaneState }
  | { kind: "pd-positions"; state: PdPositionsPaneState }
  | { kind: "lunar-mansions"; state: LunarMansionsPaneState }
  | { kind: "synodic-cycles"; state: SynodicCyclesPaneState }
  | { kind: "aspect-list"; state: AspectListPaneState }
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
  | "pdPositionsPane"
  | "lunarMansionsPane"
  | "synodicCyclesPane"
  | "chartEventsPane"
  | "aspectListPane"
  | "calendarPane"
  | "astrocartControlsPane"
  | "featureCatalogPane";

export const RIGHT_PANE_KEYS = [
  "transitSearchPane",
  "transitListPane",
  "directionsPane",
  "timeLordPane",
  "zodiacalReleasingPane",
  "firdariaPane",
  "decennialsPane",
  "profectionsPane",
  "eclipsesPane",
  "pdPositionsPane",
  "lunarMansionsPane",
  "synodicCyclesPane",
  "chartEventsPane",
  "aspectListPane",
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
  /** This document's saved event identity; descendants may only inherit notes. */
  savedEventId?: string | null;
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
  chartPresentation?: import("@/lib/chart/types").ChartPresentation;
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
  ascensionalApplyPrecession?: boolean | null;
  title: string;
  /** Daemon-reported unsaved-changes flag (slice 3). Drives the sidebar dirty
   * dot. Absent on client-overlay docs (synastry/astrocart never dirty). */
  dirty?: boolean;
  /** Daemon-reported backing file path (empty for ephemeral charts). Used to
   * mirror the close-prompt "file-backed" predicate (morin.py:11536). */
  fpath?: string;
  saveName?: string;
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
  pdPositionsPane: PdPositionsPaneState | null;
  lunarMansionsPane: LunarMansionsPaneState | null;
  synodicCyclesPane: SynodicCyclesPaneState | null;
  synodicListPreferencesByDocument: Record<string, SynodicListPreferences>;
  chartEventsPane: ChartEventsPaneState | null;
  aspectListPane: AspectListPaneState | null;
  aspectListPreferencesByDocument: Record<string, AspectListPreferences>;
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
  aspectViews: Record<string, AspectViewState>;

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
  eventEditorRequester: ((documentId: string, seed?: EditorCursorSeed) => void) | null;
  setEventEditorRequester: (fn: ((documentId: string, seed?: EditorCursorSeed) => void) | null) => void;

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
  setDirectionsPaneView: (view: DirectionsPaneView) => void;
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
  openPdPositionsPane: (state: PdPositionsPaneState) => void;
  closePdPositionsPane: () => void;
  openLunarMansionsPane: (state: LunarMansionsPaneState) => void;
  closeLunarMansionsPane: () => void;
  openSynodicCyclesPane: (state: SynodicCyclesPaneState) => void;
  closeSynodicCyclesPane: () => void;
  setSynodicListPreferences: (
    documentId: string,
    patch: Partial<SynodicListPreferences>,
  ) => void;
  openChartEventsPane: (state: ChartEventsPaneState) => void;
  closeChartEventsPane: () => void;
  openAspectListPane: (state: AspectListPaneState) => void;
  closeAspectListPane: () => void;
  setAspectListPreferences: (
    documentId: string,
    patch: Partial<AspectListPreferences>,
  ) => void;
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
  /** Hide frame panes when another pane takes over. */
  suspendFramePanes: () => boolean;
  reopenRightPane: (options?: { skipStyleEditor?: boolean }) => boolean;
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
  toggleSelectedAspectBody: (bodyKey: string, documentId?: string) => void;
  /** Toggle the midband_empty "hide all aspects" state; clears any body
   * selection. Port of the hide_all branch (morin.py:4257-4258). */
  toggleHideAllAspects: (documentId?: string) => void;
  /** Toggle M's inner-wheel minor-only exception without opening A's
   * comparison/transit gate. Has an effect only while hideAllAspects is set. */
  toggleMinorOnlyAspects: (documentId?: string) => void;
  /** Clear all click-aspect selection (back to normal render). */
  clearAspectSelection: (documentId?: string) => void;

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
  pdPositionsPane: null,
  lunarMansionsPane: null,
  synodicCyclesPane: null,
  chartEventsPane: null,
  aspectListPane: null,
  calendarPane: null,
  astrocartControlsPane: null,
  featureCatalogPane: null,
} satisfies Pick<WorkspaceState, RightPaneKey>;

// Both helpers serve explicit pane opens only (radix restores write the store
// directly), so an open also brings a minimized touch-layout view back.
function openExclusiveRightPane<K extends RightPaneKey>(
  key: K,
  value: WorkspaceState[K],
): Pick<WorkspaceState, RightPaneKey> {
  restoreTouchPane();
  noteTouchPaneOpened(value);
  return { ...EMPTY_RIGHT_PANES, [key]: value } as Pick<WorkspaceState, RightPaneKey>;
}

function activateRetainedRightPane<K extends RightPaneKey>(
  current: WorkspaceState,
  key: K,
  requested: Exclude<WorkspaceState[K], null>,
  remountOnSemanticChange = false,
): WorkspaceState | Pick<WorkspaceState, RightPaneKey> {
  restoreTouchPane();
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
  const originPanes = options?.preserveRightPane
    ? Object.fromEntries(RIGHT_PANE_KEYS.map((key) => [key, useWorkspaceStore.getState()[key]])) as Pick<WorkspaceState, RightPaneKey>
    : null;
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
  // The daemon activation restores the destination radix's chrome. Clearing
  // here would erase that restored pane after an open command completes.
  return originPanes ?? {};
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
    const live = livePane(pane, documentIds);
    if (live === pane) continue;
    (next as Record<RightPaneKey, unknown>)[key] = live;
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

  const liveAspectViews = Object.fromEntries(Object.entries(state.aspectViews).filter(([id]) => documentIds.has(id)));
  if (Object.keys(liveAspectViews).length !== Object.keys(state.aspectViews).length) {
    next.aspectViews = liveAspectViews;
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
  pdPositionsPane: null,
  lunarMansionsPane: null,
  synodicCyclesPane: null,
  synodicListPreferencesByDocument: {},
  chartEventsPane: null,
  aspectListPane: null,
  aspectListPreferencesByDocument: {},
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
  aspectViews: {},
  inspectorLens: null,
  packsVersion: 0,
  semanticProfileVersion: 0,
  timedChartShowRadix: false,
  aspectListPerfectionLinkMode: "transits",
  synastryPartnerRequester: null,
  editChartRequester: null,
  eventEditorRequester: null,
  setEventEditorRequester: (fn) => set({ eventEditorRequester: fn }),

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
  setDirectionsPaneView: (view) =>
    set((current) => {
      const pane = current.directionsPane;
      if (!pane || (pane.view?.tab === view.tab && pane.view?.surface === view.surface)) return current;
      // A view patch, not a new activation: no openSeq bump or remount.
      return { directionsPane: { ...pane, view } };
    }),
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
  openPdPositionsPane: (state) =>
    set((current) => activateRetainedRightPane(current, "pdPositionsPane", state)),
  closePdPositionsPane: () => set({ pdPositionsPane: null }),
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
  openChartEventsPane: (state) => set((current) => activateRetainedRightPane(current, "chartEventsPane", state)),
  closeChartEventsPane: () => set({ chartEventsPane: null }),
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
  suspendFramePanes: () => suspendFramePanes(),
  reopenRightPane: (options) => reopenRememberedRadixPane(options),
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
  toggleSelectedAspectBody: (bodyKey, documentId) =>
    set((state) => changeAspectView(state, documentId ?? useDaemonWorkspaceStore.getState().activeDocumentId, "body", bodyKey)),
  toggleHideAllAspects: (documentId) =>
    set((state) => changeAspectView(state, documentId ?? useDaemonWorkspaceStore.getState().activeDocumentId, "hide")),
  toggleMinorOnlyAspects: (documentId) =>
    set((state) => changeAspectView(state, documentId ?? useDaemonWorkspaceStore.getState().activeDocumentId, "minor")),
  clearAspectSelection: (documentId) =>
    set((state) => changeAspectView(state, documentId ?? useDaemonWorkspaceStore.getState().activeDocumentId, "clear")),
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

// Remember radix content; keep an open sidebar useful with Inspector wherever
// the destination has no content. Inspector has no per-tab visibility policy.
type RadixPaneChrome = Pick<WorkspaceState, RightPaneKey> & {
  inspectorPane: object | null;
  notesPane: object | null;
  stylePane: object | null;
};
type FramePaneState = Pick<ReturnType<typeof useFrameLayoutStore.getState>,
  "inspectorOpen" | "notesPaneOpen" | "styleEditorOpen">;
const OPEN_FRAME_PANE = {};
const EMPTY_RADIX_CHROME: RadixPaneChrome = {
  ...EMPTY_RIGHT_PANES, inspectorPane: null, notesPane: null, stylePane: null,
};

function radixPaneChrome(
  workspace: WorkspaceState,
  frame: FramePaneState = useFrameLayoutStore.getState(),
): RadixPaneChrome {
  const panes = Object.fromEntries(RIGHT_PANE_KEYS.map((key) => [key, workspace[key]])) as Pick<WorkspaceState, RightPaneKey>;
  const listOpen = hasRadixPane(panes);
  return {
    ...panes,
    inspectorPane: !listOpen && frame.inspectorOpen ? OPEN_FRAME_PANE : null,
    notesPane: !listOpen && frame.notesPaneOpen ? OPEN_FRAME_PANE : null,
    stylePane: !listOpen && frame.styleEditorOpen ? OPEN_FRAME_PANE : null,
  };
}

function compatibleRadixPane(chrome: RadixPaneChrome, owner: string | null): RadixPaneChrome {
  if (chrome.chartEventsPane && owner) {
    return { ...EMPTY_RADIX_CHROME, chartEventsPane: { documentId: owner } };
  }
  if (chrome.inspectorPane || chrome.notesPane || chrome.stylePane) {
    return {
      ...EMPTY_RADIX_CHROME,
      inspectorPane: chrome.inspectorPane,
      notesPane: chrome.notesPane,
      stylePane: chrome.stylePane,
    };
  }
  return { ...EMPTY_RADIX_CHROME, inspectorPane: OPEN_FRAME_PANE };
}

function radixPaneModule(chrome: RadixPaneChrome) {
  const daemon = useDaemonWorkspaceStore.getState();
  const active = daemon.documents.find((doc) => doc.documentId === daemon.activeDocumentId);
  const map = active?.kind === "astrocart" ? active : daemon.documents.find(
    (doc) => doc.documentId === active?.parentDocumentId && doc.kind === "astrocart",
  );
  return activeRightPaneModule({
    ...chrome,
    inspectorOpen: chrome.inspectorPane !== null,
    notesOpen: chrome.notesPane !== null,
    styleEditorOpen: chrome.stylePane !== null,
    activeAstrocartDocumentId: map?.documentId ?? null,
  });
}

function preservePaneWidth(chrome: RadixPaneChrome): void {
  const kind = radixPaneModule(chrome);
  if (!kind) return;
  const frame = useFrameLayoutStore.getState();
  const width = Math.max(frame.rightPaneWidth, rightPaneWidthPolicy(kind).minContentWidth);
  if (width !== frame.rightPaneWidth) frame.setRightPaneWidth(width);
}

let activePaneRadix = radixPaneOwner(
  useDaemonWorkspaceStore.getState().documents,
  useDaemonWorkspaceStore.getState().activeDocumentId,
);
let panesByRadix: Record<string, RadixPaneChrome> = {};
let restoringRadixPane = false;

function contentChrome(chrome: RadixPaneChrome): RadixPaneChrome {
  // Inspector alone is the global fallback, not remembered radix content.
  // Keep the combined Inspector/Notes view as real content.
  return chrome.inspectorPane && !chrome.notesPane && !chrome.stylePane
    ? { ...chrome, inspectorPane: null } : chrome;
}

function rememberRadixPane(): void {
  if (restoringRadixPane) return;
  const chrome = contentChrome(radixPaneChrome(useWorkspaceStore.getState()));
  if (activePaneRadix && hasRadixPane(chrome)) panesByRadix[activePaneRadix] = chrome;
  preservePaneWidth(chrome);
}

function applyRadixPaneChrome(next: RadixPaneChrome): void {
  const current = useWorkspaceStore.getState();
  const frame = useFrameLayoutStore.getState();
  const framePatch = {
    inspectorOpen: next.inspectorPane !== null,
    notesPaneOpen: next.notesPane !== null,
    styleEditorOpen: next.stylePane !== null,
  };
  const frameChanged = frame.inspectorOpen !== framePatch.inspectorOpen ||
    frame.notesPaneOpen !== framePatch.notesPaneOpen || frame.styleEditorOpen !== framePatch.styleEditorOpen;
  const panesChanged = RIGHT_PANE_KEYS.some((key) => current[key] !== next[key]);
  if (!frameChanged && !panesChanged) return;
  restoringRadixPane = true;
  try {
    preservePaneWidth(next);
    if (frameChanged) useFrameLayoutStore.setState({ ...framePatch, notesFocusRequest: null });
    if (panesChanged) {
      useWorkspaceStore.setState(Object.fromEntries(RIGHT_PANE_KEYS.map((key) => [key, next[key]])) as Pick<WorkspaceState, RightPaneKey>);
    }
  } finally {
    restoringRadixPane = false;
  }
}

function suspendFramePanes(): boolean {
  const frame = useFrameLayoutStore.getState();
  if (!frame.inspectorOpen && !frame.notesPaneOpen && !frame.styleEditorOpen) return false;
  restoringRadixPane = true;
  try {
    useFrameLayoutStore.setState({ inspectorOpen: false, notesPaneOpen: false, styleEditorOpen: false, notesFocusRequest: null });
  } finally {
    restoringRadixPane = false;
  }
  return true;
}

function reopenRememberedRadixPane(options?: { skipStyleEditor?: boolean }): boolean {
  if (hasRadixPane(radixPaneChrome(useWorkspaceStore.getState()))) return false;
  const daemon = useDaemonWorkspaceStore.getState();
  const restored = retainRadixPanes(
    daemon.documents, null, activePaneRadix, EMPTY_RADIX_CHROME, panesByRadix, EMPTY_RADIX_CHROME,
  );
  panesByRadix = restored.retained;
  const next = restored.panes;
  if (!hasRadixPane(next)) return false;
  if (next.astrocartControlsPane && !radixPaneModule(next)) return false;
  // Inspector intent must not revive the editor; branch navigation still can.
  if (options?.skipStyleEditor && next.stylePane) return false;
  // Reopen the saved object directly: no activation counter, new launch seed,
  // preference write, or Inspector selection replaces the remembered list.
  applyRadixPaneChrome(next);
  return true;
}

useWorkspaceStore.subscribe((state, previous) => {
  if (!RIGHT_PANE_KEYS.some((key) => state[key] !== previous[key])) return;
  if (restoringRadixPane) return;
  // Also covers timed row opens which restore their originating list after
  // daemon activation has temporarily selected a destination fallback.
  if (RIGHT_PANE_KEYS.some((key) => state[key] !== null)) {
    // A list takes over the shared frame.
    suspendFramePanes();
  }
  rememberRadixPane();
});
useFrameLayoutStore.subscribe((state, previous) => {
  if (state.inspectorOpen === previous.inspectorOpen &&
      state.notesPaneOpen === previous.notesPaneOpen &&
      state.styleEditorOpen === previous.styleEditorOpen) return;
  if (restoringRadixPane) return;
  const chrome = radixPaneChrome(useWorkspaceStore.getState(), state);
  if (activePaneRadix && chrome.inspectorPane && !chrome.notesPane && !chrome.stylePane) {
    // Explicit Inspector intent selects the default instead of restoring the
    // previous list/editor on the next visit. Automatic fallback is guarded.
    delete panesByRadix[activePaneRadix];
  }
  rememberRadixPane();
});

useDaemonWorkspaceStore.subscribe((state, previous) => {
  if (state.documents === previous.documents && state.activeDocumentId === previous.activeDocumentId) return;
  const nextOwner = radixPaneOwner(state.documents, state.activeDocumentId);
  const current = useWorkspaceStore.getState();
  const chrome = radixPaneChrome(current);
  const wasOpen = hasRadixPane(chrome);
  const changedTab = state.activeDocumentId !== previous.activeDocumentId;
  if (changedTab && useFrameLayoutStore.getState().notesFocusRequest) {
    useFrameLayoutStore.setState({ notesFocusRequest: null });
  }
  const restored = retainRadixPanes(state.documents, activePaneRadix, nextOwner, contentChrome(chrome), panesByRadix, EMPTY_RADIX_CHROME);
  panesByRadix = restored.retained;
  const sameRadix = activePaneRadix === nextOwner;
  activePaneRadix = nextOwner;
  let next = !wasOpen && changedTab && nextOwner
    ? panesByRadix[nextOwner] ?? restored.panes : restored.panes;
  if (next.astrocartControlsPane && !radixPaneModule(next)) {
    next = EMPTY_RADIX_CHROME;
  }
  // Same-tab updates never undo a close. Keep visible Inspector chrome even
  // though it is deliberately absent from the retained radix content.
  if (!changedTab && sameRadix && (hasRadixPane(next) || !wasOpen)) {
    applyRadixPaneChrome({ ...next, inspectorPane: chrome.inspectorPane });
    return;
  }
  if (!hasRadixPane(next) && wasOpen) next = compatibleRadixPane(chrome, nextOwner);
  applyRadixPaneChrome(next);
});

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
