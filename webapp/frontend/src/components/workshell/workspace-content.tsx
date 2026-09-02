// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { Bell, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Coffee, PanelLeft, NotebookPen, Pencil, ScrollText, Search, Settings, SlidersHorizontal } from "lucide-react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ChartPalette,
  ChartRenderSnapshot,
  OverlayInfoRow,
} from "@/lib/chart/types";
import { morinusTextFontFromTokens } from "@/lib/chart/chart-fonts";
import { radixOverlayTopLeftLines } from "@/lib/chart/chart-overlay-lines";
import {
  readPaletteFromTheme,
  readPaletteProfileOverrides,
} from "@/lib/chart/palette";
import {
  projectWheelAuthoringStyle,
  resolveWheelOverlayMetrics,
  resolveWheelRenderStyleFromTokens,
  resolveWheelTypographyPaint,
  type WheelChartOverlayClass,
  type WheelRenderStyle,
  type WheelTypographyProfile,
} from "@/lib/chart/wheel-render-style";
import { registerChartExportRenderer } from "@/lib/chart/chart-export-registry";
import { ChartCopyControl } from "@/components/workshell/chart-copy-control";
import { renderChartSurfaceExport } from "@/lib/chart/chart-export-renderer";
import {
  ASTROCART_TITLEBAR_SAFE_TOP,
  createAstrocartStyleMessage,
} from "@/lib/chart/astrocart-style";
import { useT, useTFallback, type TFunc } from "@/lib/i18n/i18n";
import { resolveListFocusDatetime } from "@/lib/list-follow-policy";
import { LIST_PANE_CLASSES } from "@/lib/list-tokens";
import { cn } from "@/lib/utils";

import { ChartCanvas } from "./chart-canvas";
import type { GraphicEphemerisDisplayMode } from "./graph-ephemeris-view";
import {
  AstrocartControls,
  type AstrocartConfigurationChange,
  type AstrocartParanIntent,
} from "./astrocart-controls";
import { activeRightPaneModule } from "./right-pane-layout";
import {
  closeInspectorAndNotes,
  closeWorkspaceTransientPanes,
} from "./workspace-ui-commands";
import {
  localizedWorkspaceDocumentTitle,
  useWorkspaceStore,
  type TimeLordTableId,
  type WorkspaceDocument,
} from "@/stores/workspace-store";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useThemeStore } from "@/stores/theme-store";
import { useUpdateNotificationStore } from "@/stores/update-notification-store";
import { useAstrocartMapUrl } from "@/hooks/use-astrocart-map-url";
import {
  useDraggableOverlay,
  type OverlayOffset,
} from "@/hooks/use-draggable-overlay";
import { useStyleRevision } from "@/hooks/use-style-revision";
import { EMBEDDED_MANIFEST_SHORTCUT_EVENT } from "@/shortcuts/manifest-shortcuts";
import { TitlebarOptionsMenu } from "./titlebar-options-menu";
import {
  RIGHT_PANE_COLLAPSE_THRESHOLD,
  SIDEBAR_STARTUP_WIDTH,
  clampRightPaneWidth,
  rightPanePriorityLayout,
  rightPaneWidthPolicy,
  useFrameLayoutStore,
  type RightPaneModuleKind,
} from "@/stores/frame-layout-store";
import {
  daemonBaseUrl,
  daemonFetch,
  fetchAstrocartViewState,
  fetchAppSplash,
  storeAstrocartViewState,
  workspaceActivate,
  workspaceAstrocartHere,
  type AppSplashPayload,
  type AstrocartConfigurationPayload,
  type AstrocartMapSpec,
  type AstrocartHereAction,
  type AstrocartLineMode,
  type AstrocartPdfPageFormat,
  type AstrocartPdfSelection,
  type AstrocartPrintAtlas,
  type AstrocartViewState,
  type AstrocartViewStateScope,
  type ThemeState,
  type WorkspaceManifest,
} from "@/lib/daemon/client";
import { isAbortError, isTransientDaemonFetchError } from "@/lib/abort-error";
import {
  resolveNativeShellPlatform,
  resolveShellHost,
  resolveWindowsCaptionInset,
} from "@/lib/shell-host";
import type { SettingsTabId } from "./settings-dialog";
import {
  chartNavbarHoverZoneFromRect,
  setChartNavbarHoverZone,
} from "./chart-navbar-hover-zone";

const AstrolabeView = dynamic(
  () => import("./astrolabe-view").then((mod) => mod.AstrolabeView),
  { loading: () => null },
);
const CalendarPrototypeView = dynamic(
  () =>
    import("./calendar-prototype-view").then(
      (mod) => mod.CalendarPrototypeView,
    ),
  { loading: () => null },
);
const AstrologSphereView = dynamic(
  () => import("./astrolog-sphere-view").then((mod) => mod.AstrologSphereView),
  { loading: () => null },
);
const SquareChartView = dynamic(
  () => import("./square-chart-view").then((mod) => mod.SquareChartView),
  { loading: () => null },
);
const MundaneChartView = dynamic(
  () => import("./mundane-chart-view").then((mod) => mod.MundaneChartView),
  { loading: () => null },
);
const AscensionalTransitsPane = dynamic(
  () => import("./ascensional-transits-view").then((mod) => mod.AscensionalTransitsPane),
  { loading: () => null },
);
const AscensionalTransitsView = dynamic(
  () => import("./ascensional-transits-view").then((mod) => mod.AscensionalTransitsView),
  { loading: () => null },
);
const DirectionsView = dynamic(
  () => import("./directions-view").then((mod) => mod.DirectionsView),
  { loading: () => null },
);
const GenericTableView = dynamic(
  () => import("./generic-table-view").then((mod) => mod.GenericTableView),
  { loading: () => null },
);
const TemporalConfluenceView = dynamic(
  () => import("./temporal-confluence-view").then((mod) => mod.TemporalConfluenceView),
  { loading: () => null },
);
const GraphEphemerisView = dynamic(
  () => import("./graph-ephemeris-view").then((mod) => mod.GraphEphemerisView),
  { loading: () => null },
);
const InspectorPanel = dynamic(
  () => import("./inspector-panel").then((mod) => mod.InspectorPanel),
  { loading: () => null },
);
const ChartStylePanel = dynamic(
  () => import("./chart-style-panel").then((mod) => mod.ChartStylePanel),
  { loading: () => null },
);
const NotesPanel = dynamic(
  () => import("./notes-panel").then((mod) => mod.NotesPanel),
  { loading: () => null },
);
const TransitSearchView = dynamic(
  () => import("./transit-search-view").then((mod) => mod.TransitSearchView),
  { loading: () => null },
);
const TransitListView = dynamic(
  () => import("./transit-list-view").then((mod) => mod.TransitListView),
  { loading: () => null },
);
const SynodicCycleListView = dynamic(
  () => import("./synodic-cycle-list-view").then((mod) => mod.SynodicCycleListView),
  { loading: () => null },
);
const AspectListPanel = dynamic(
  () => import("./aspect-list-panel").then((mod) => mod.AspectListPanel),
  { loading: () => null },
);
const EclipsesView = dynamic(
  () => import("./eclipses-view").then((mod) => mod.EclipsesView),
  { loading: () => null },
);
const LunarMansionsView = dynamic(
  () => import("./lunar-mansions-view").then((mod) => mod.LunarMansionsView),
  { loading: () => null },
);
const TimeLordPaneView = dynamic(
  () => import("./time-lord-pane-view").then((mod) => mod.TimeLordPaneView),
  { loading: () => null },
);
const FeatureCatalogView = dynamic(
  () => import("./feature-catalog-view").then((mod) => mod.FeatureCatalogView),
  { loading: () => null },
);
const HelpView = dynamic(
  () => import("./help-dialog").then((mod) => mod.HelpView),
  { loading: () => null },
);
const LegalDocumentView = dynamic(
  () => import("./legal-document-view").then((mod) => mod.LegalDocumentView),
  { loading: () => null },
);
const WhatsNewView = dynamic(
  () => import("./whats-new-view").then((mod) => mod.WhatsNewView),
  { loading: () => null },
);

type Props = {
  chart: ChartRenderSnapshot | null;
  activeDoc: WorkspaceDocument | null;
  navbar?: ModeHintRailProps | null;
};

function isTimeLordTableId(value: string | null | undefined): value is TimeLordTableId {
  return (
    value === "firdaria" ||
    value === "vimshottari" ||
    value === "decennials" ||
    value === "zodiacal_releasing" ||
    value === "profections_table"
  );
}

function isMdoVisualMode(mode: string | null | undefined): boolean {
  return mode === "mdo" || mode === "mundane" || mode === "ascensional_transits";
}

function isChartBearingSurfaceDocument(doc: WorkspaceDocument | null | undefined): boolean {
  return isChartBearingSurfaceKind(doc?.kind);
}

function isAspectListQueryHostDocument(
  doc: WorkspaceDocument | null | undefined,
): doc is WorkspaceDocument {
  // Aspect List follows every live chart-session document. The AT child is a
  // chart-backed special surface even though it owns additional right-pane
  // chrome; the remaining exclusions are view-only documents with no chart
  // session to query.
  return isChartBearingSurfaceDocument(doc) || doc?.kind === "ascensional-transits";
}

function aspectListContextRevision(
  chart: ChartRenderSnapshot | null,
  documentId: string,
): string | null {
  if (!chart || chart.document?.documentId !== documentId) return null;
  return JSON.stringify({
    viewMode: chart.document.viewMode,
    comparisonName: chart.document.comparisonName ?? null,
    compoundKind: chart.document.compoundKind ?? null,
    compositeVariant: chart.document.compositeVariant ?? null,
    showRadixComparison: chart.document.showRadixComparison ?? null,
    hasComparisonChart: chart.comparisonChart != null,
  });
}

function isChartBearingSurfaceKind(kind: WorkspaceDocument["kind"] | null | undefined): boolean {
  if (!kind) return false;
  return ![
    "astrocart",
    "directions",
    "astrolabe",
    "astrolog-sphere",
    "square-chart",
    "mundane-chart",
    "ephemeris",
    "transit-search",
    "table",
    "ascensional-transits",
  ].includes(kind);
}

const ASTROCART_LINE_MODES: ReadonlyArray<{ id: AstrocartLineMode }> = [
  { id: "standard" },
  { id: "geodetic_greenwich" },
  { id: "geodetic_giza" },
  { id: "local_space" },
];
const ASTROCART_GEODETIC_MODES = new Set<AstrocartLineMode>([
  "geodetic_greenwich",
  "geodetic_giza",
]);
const ASTROCART_PRIMARY_MODES = new Set<AstrocartLineMode>([
  "standard",
  ...ASTROCART_GEODETIC_MODES,
]);
const ASTROCART_DEFAULT_LINE_MODES: AstrocartLineMode[] = ["standard"];
const ASTROCART_REFINEMENT_DELAY_MS = 220;
const ASTROCART_ASPECT_IDS = [
  "semisextile",
  "semisquare",
  "septile",
  "sextile",
  "quintile",
  "square",
  "trine",
  "sesquisquare",
  "biquintile",
  "quincunx",
  "opposition",
] as const;
const ASTROCART_DYNAMIC_TECHNIQUE_IDS = [
  "transit",
  "secondary_progression",
  "minor_progression",
  "tertiary_progression",
  "solar_arc",
] as const;

type AstrocartGeoJsonMeta = {
  lat?: number;
  lon?: number;
  theme?: string;
  pageBg?: string;
  [key: string]: unknown;
};

type AstrocartGeoJsonPayload = {
  type: "FeatureCollection";
  features: unknown[];
  meta?: AstrocartGeoJsonMeta;
};

type AstrocartGeoJsonFeature = {
  id?: unknown;
  geometry?: unknown;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

type AstrocartModeSpecKeys = Partial<Record<AstrocartLineMode, string>>;

type AstrocartGeometryPrecision = "preview" | "interactive" | "precise";
type AstrocartRetainedPrecision = Exclude<AstrocartGeometryPrecision, "precise">;
const ASTROCART_RETAINED_TERMINAL_PRECISION: AstrocartRetainedPrecision =
  "interactive";

type AstrocartModeCacheEntry = {
  sessionRevision: number;
  modeSpecKey: string | null;
  precision: AstrocartGeometryPrecision;
  payload: AstrocartGeoJsonPayload;
};

type AstrocartRetainedModeCacheEntry = Omit<
  AstrocartModeCacheEntry,
  "precision"
> & {
  precision: AstrocartRetainedPrecision;
};

type AstrocartModeRequest = {
  sessionRevision: number;
  modeSpecKey: string | null;
  controller: AbortController;
};

type AstrocartMetaRequest = {
  sessionRevision: number;
  configurationRevision: number;
  controller: AbortController;
};

type AstrocartEmptyModeCacheEntry = {
  sessionRevision: number;
  configurationRevision: number;
  precision: AstrocartRetainedPrecision;
  payload: AstrocartGeoJsonPayload;
};

type AstrocartPrintAtlasRequest = {
  resolve: (atlas: AstrocartPrintAtlas | null) => void;
  dataGenerationKey: string;
  timeoutId: number;
  signal: AbortSignal;
  controller: AbortController;
  abortListener: () => void;
  cancelChild: () => void;
};

type AstrocartPhysicalOverlayAccumulator = {
  featureIndex: number;
  modes: Set<AstrocartLineMode>;
  displayLineSystemByMode: Partial<Record<AstrocartLineMode, string>>;
};

async function fetchAstrocartModePayload(
  documentId: string,
  mode: AstrocartLineMode | null,
  precision: AstrocartGeometryPrecision,
  signal: AbortSignal,
): Promise<AstrocartGeoJsonPayload> {
  const params = new URLSearchParams({ modes: mode ?? "", precision });
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/workspace/document/${encodeURIComponent(documentId)}/astrocart?${params.toString()}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    throw new Error(`astrocart fetch failed: ${response.status}`);
  }
  const raw = await response.json() as Partial<AstrocartGeoJsonPayload>;
  return {
    type: "FeatureCollection",
    features: Array.isArray(raw.features) ? raw.features : [],
    meta: raw.meta,
  };
}

function astrocartFeatureProperties(
  feature: unknown,
): Record<string, unknown> | null {
  if (typeof feature !== "object" || feature == null || Array.isArray(feature)) {
    return null;
  }
  const properties = (feature as AstrocartGeoJsonFeature).properties;
  if (
    typeof properties !== "object" ||
    properties == null ||
    Array.isArray(properties)
  ) {
    return null;
  }
  return properties;
}

function astrocartPropertyText(
  properties: Record<string, unknown>,
  key: string,
): string {
  const value = properties[key];
  return typeof value === "string" ? value : "";
}

function appendUniqueAstrocartStrings(target: string[], value: unknown): void {
  const values = Array.isArray(value) ? value : [value];
  for (const candidate of values) {
    if (
      typeof candidate === "string" &&
      candidate.length > 0 &&
      !target.includes(candidate)
    ) {
      target.push(candidate);
    }
  }
}

function astrocartDisplayLineSystemForMode(
  properties: Record<string, unknown>,
  mode: AstrocartLineMode,
  meta?: AstrocartGeoJsonMeta,
): string {
  const explicitByMode = properties.display_line_system_by_mode;
  if (
    typeof explicitByMode === "object" &&
    explicitByMode != null &&
    !Array.isArray(explicitByMode)
  ) {
    const explicit = (explicitByMode as Record<string, unknown>)[mode];
    if (typeof explicit === "string" && explicit.length > 0) return explicit;
  }
  return (
    astrocartPropertyText(properties, "display_line_system") ||
    (typeof meta?.lineSystem === "string" ? meta.lineSystem : "")
  );
}

function astrocartPhysicalOverlayIdentity(
  feature: unknown,
  mode: AstrocartLineMode,
): string | null {
  if (!ASTROCART_PRIMARY_MODES.has(mode)) return null;
  const properties = astrocartFeatureProperties(feature);
  if (!properties) return null;
  const kind = astrocartPropertyText(properties, "kind").toUpperCase();
  if (kind !== "PARAN" && kind !== "ZENITH") return null;

  const layer = astrocartPropertyText(properties, "astrocart_layer") || "natal";
  const layerId =
    astrocartPropertyText(properties, "astrocart_layer_id") || layer;
  const technique = astrocartPropertyText(properties, "astrocart_technique");
  const cursor = astrocartPropertyText(properties, "astrocart_cursor_iso");
  let semantic: string | string[][];
  if (kind === "ZENITH") {
    const point = astrocartPropertyText(properties, "point");
    if (!point) return null;
    semantic = point;
  } else {
    const endpoints = [
      [
        astrocartPropertyText(properties, "a_point"),
        astrocartPropertyText(properties, "a_angle"),
      ],
      [
        astrocartPropertyText(properties, "b_point"),
        astrocartPropertyText(properties, "b_angle"),
      ],
    ];
    if (endpoints.some(([point, angle]) => !point || !angle)) return null;
    semantic = endpoints.sort((left, right) => (
      left[0].localeCompare(right[0]) || left[1].localeCompare(right[1])
    ));
  }

  const geometry = (feature as AstrocartGeoJsonFeature).geometry;
  if (geometry == null) return null;
  try {
    return JSON.stringify([
      layerId,
      layer,
      technique,
      cursor,
      kind,
      semantic,
      geometry,
    ]);
  } catch {
    return null;
  }
}

function astrocartModeSpecKey(
  modeSpecKeys: AstrocartModeSpecKeys,
  mode: AstrocartLineMode,
): string | null {
  const value = modeSpecKeys[mode];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function composeAstrocartModePayload(
  modes: AstrocartLineMode[],
  sessionRevision: number,
  modeSpecKeys: AstrocartModeSpecKeys,
  cache: ReadonlyMap<AstrocartLineMode, AstrocartModeCacheEntry>,
  fallbackMeta?: AstrocartGeoJsonMeta,
  canonicalSpec?: Pick<
    AstrocartConfigurationPayload,
    "spec" | "specKey" | "specRevision" | "cacheKey"
  > | null,
  emptyModePayload?: AstrocartGeoJsonPayload,
): { payload: AstrocartGeoJsonPayload; complete: boolean } {
  const orderedModes = normalizeAstrocartLineModes(modes);
  const features: unknown[] = [];
  const physicalOverlays = new Map<string, AstrocartPhysicalOverlayAccumulator>();
  let meta = { ...(fallbackMeta ?? {}) };
  let complete = true;
  if (orderedModes.length === 0 && emptyModePayload) {
    features.push(...emptyModePayload.features);
    meta = { ...meta, ...(emptyModePayload.meta ?? {}) };
  }
  for (const mode of orderedModes) {
    const entry = cache.get(mode);
    const expectedModeSpecKey = astrocartModeSpecKey(modeSpecKeys, mode);
    if (
      !entry ||
      entry.sessionRevision !== sessionRevision ||
      (
        expectedModeSpecKey != null &&
        entry.modeSpecKey !== expectedModeSpecKey
      )
    ) {
      complete = false;
      continue;
    }
    for (const feature of entry.payload.features) {
      const identity = astrocartPhysicalOverlayIdentity(feature, mode);
      if (identity == null) {
        features.push(feature);
        continue;
      }
      const existing = physicalOverlays.get(identity);
      if (existing) {
        existing.modes.add(mode);
        const properties = astrocartFeatureProperties(
          features[existing.featureIndex],
        );
        const incomingProperties = astrocartFeatureProperties(feature);
        if (properties && incomingProperties) {
          const incomingDisplaySystem = astrocartDisplayLineSystemForMode(
            incomingProperties,
            mode,
            entry.payload.meta,
          );
          if (incomingDisplaySystem) {
            existing.displayLineSystemByMode[mode] = incomingDisplaySystem;
          }
          properties.astrocart_modes = orderedModes.filter(
            (candidate) => existing.modes.has(candidate),
          );
          const displayLineSystems: string[] = [];
          const displayLineSystemByMode: Record<string, string> = {};
          for (const candidate of orderedModes) {
            const system = existing.displayLineSystemByMode[candidate];
            if (!existing.modes.has(candidate) || !system) continue;
            displayLineSystemByMode[candidate] = system;
            appendUniqueAstrocartStrings(displayLineSystems, system);
          }
          if (displayLineSystems.length > 0) {
            properties.display_line_systems = displayLineSystems;
            properties.display_line_system_by_mode = displayLineSystemByMode;
          }
        }
        continue;
      }

      const properties = astrocartFeatureProperties(feature);
      const featureCopy: AstrocartGeoJsonFeature = {
        ...(feature as AstrocartGeoJsonFeature),
        properties: { ...(properties ?? {}) },
      };
      features.push(featureCopy);
      const displayLineSystem = astrocartDisplayLineSystemForMode(
        featureCopy.properties ?? {},
        mode,
        entry.payload.meta,
      );
      physicalOverlays.set(identity, {
        featureIndex: features.length - 1,
        modes: new Set([mode]),
        displayLineSystemByMode: displayLineSystem
          ? { [mode]: displayLineSystem }
          : {},
      });
    }
    meta = { ...meta, ...(entry.payload.meta ?? {}) };
  }
  meta = {
    ...meta,
    composite: true,
    modes: [...orderedModes],
    localSpaceAdditive: orderedModes.includes("local_space"),
  };
  if (canonicalSpec) {
    meta = {
      ...meta,
      specKey: canonicalSpec.specKey,
      specRevision: canonicalSpec.specRevision,
      cacheKey: canonicalSpec.cacheKey,
      coordinateSystem: canonicalSpec.spec.coordinateSystem,
    };
  }
  return {
    payload: { type: "FeatureCollection", features, meta },
    complete,
  };
}

function normalizeAstrocartLineModes(value: unknown): AstrocartLineMode[] {
  if (!Array.isArray(value)) return [...ASTROCART_DEFAULT_LINE_MODES];
  const requested = new Set(value.filter(
    (mode): mode is AstrocartLineMode => ASTROCART_LINE_MODES.some((item) => item.id === mode),
  ));
  return ASTROCART_LINE_MODES.map((item) => item.id).filter((mode) => requested.has(mode));
}

function toggleAstrocartLineMode(
  current: AstrocartLineMode[],
  mode: AstrocartLineMode,
  allowPrimaryOverlay: boolean,
): AstrocartLineMode[] {
  const next = new Set(current);
  if (next.has(mode)) {
    next.delete(mode);
  } else {
    if (mode !== "local_space" && !allowPrimaryOverlay) {
      for (const primaryMode of ASTROCART_PRIMARY_MODES) next.delete(primaryMode);
    }
    next.add(mode);
  }
  return ASTROCART_LINE_MODES.map((item) => item.id).filter((item) => next.has(item));
}

/**
 * Workspace shell — header + chart canvas + corner labels + (optional) inspector.
 * Chart fetch lifecycle is owned by HomeClient; this shell keeps the scene/pane
 * tree stable so activation updates the relevant leaf instead of remounting the
 * whole workspace.
 */
export function WorkspaceContent({ chart, activeDoc, navbar }: Props) {
  // The header is now the global UnifiedTitleBar (rendered once by HomeClient,
  // spanning sidebar + content); the content surface only renders the chart.
  return (
    <SurfaceArea chart={chart} activeDoc={activeDoc} navbar={navbar} />
  );
}

function SurfaceArea({
  chart,
  activeDoc,
  navbar,
}: {
  chart: ChartRenderSnapshot | null;
  activeDoc: WorkspaceDocument | null;
  navbar?: ModeHintRailProps | null;
}) {
  const daemonDocuments = useDaemonWorkspaceStore((state) => state.documents);
  const [retainedAstrocartIds, setRetainedAstrocartIds] = React.useState<string[]>([]);
  const activeAstrocartId = activeDoc?.kind === "astrocart" ? activeDoc.id : null;
  React.useEffect(() => {
    const openIds = new Set(
      daemonDocuments
        .filter((document) => document.launcherKind === "astrocart")
        .map((document) => document.documentId),
    );
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setRetainedAstrocartIds((current) => {
        const next = current.filter(
          (documentId) => openIds.has(documentId) && documentId !== activeAstrocartId,
        );
        if (activeAstrocartId && openIds.has(activeAstrocartId)) next.push(activeAstrocartId);
        // Keep recent maps warm without eagerly allocating one WebGL context and
        // two line calculations for every restored astrocart tab.
        const bounded = next.slice(-3);
        return bounded.length === current.length && bounded.every((id, index) => id === current[index])
          ? current
          : bounded;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activeAstrocartId, daemonDocuments]);
  const mountedAstrocartIds = React.useMemo(() => {
    const ids = new Set(retainedAstrocartIds);
    if (activeAstrocartId) ids.add(activeAstrocartId);
    return ids;
  }, [activeAstrocartId, retainedAstrocartIds]);
  const astrocartDocuments = React.useMemo(
    () => daemonDocuments.filter(
      (document) => document.launcherKind === "astrocart" && mountedAstrocartIds.has(document.documentId),
    ),
    [daemonDocuments, mountedAstrocartIds],
  );

  return (
    <div className="relative flex min-h-0 flex-1">
      {astrocartDocuments.map((document) => {
        const active = document.documentId === activeAstrocartId;
        return (
          <div
            key={document.documentId}
            className={cn(
              "absolute inset-0 min-h-0",
              active ? "z-10 flex" : "pointer-events-none hidden",
            )}
            aria-hidden={!active}
          >
            <AstrocartSurface
              documentId={document.documentId}
              parentDocumentId={document.parentDocumentId}
              active={active}
              eclipseEvent={document.eclipseEvent ?? null}
            />
          </div>
        );
      })}
      {activeAstrocartId == null ? (
        <ActiveSurfaceArea chart={chart} activeDoc={activeDoc} navbar={navbar} />
      ) : null}
    </div>
  );
}

function ActiveSurfaceArea({
  chart,
  activeDoc,
  navbar,
}: {
  chart: ChartRenderSnapshot | null;
  activeDoc: WorkspaceDocument | null;
  navbar?: ModeHintRailProps | null;
}) {
  const openAscensionalTransitsPane = useWorkspaceStore(
    (s) => s.openAscensionalTransitsPane,
  );
  const lastAutoOpenedAscensionalPaneRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const isAscensionalMode =
      activeDoc?.kind === "ascensional-transits" ||
      activeDoc?.chartVisualMode === "ascensional_transits";
    if (!isAscensionalMode) {
      lastAutoOpenedAscensionalPaneRef.current = null;
      return;
    }
    if (lastAutoOpenedAscensionalPaneRef.current === activeDoc.id) return;
    lastAutoOpenedAscensionalPaneRef.current = activeDoc.id;
    openAscensionalTransitsPane({
      documentId: activeDoc.id,
      sourceName: activeDoc.sourceName,
      ascensionalEventJd: activeDoc.ascensionalEventJd ?? null,
      ascensionalEventPlace: activeDoc.ascensionalEventPlace ?? null,
      ascensionalFilterToActiveMoment: activeDoc.ascensionalFilterToActiveMoment ?? true,
      ascensionalApplyPrecession: activeDoc.ascensionalApplyPrecession ?? true,
    });
    closeInspectorAndNotes();
  }, [
    activeDoc?.ascensionalApplyPrecession,
    activeDoc?.ascensionalEventJd,
    activeDoc?.ascensionalEventPlace,
    activeDoc?.ascensionalFilterToActiveMoment,
    activeDoc?.id,
    activeDoc?.kind,
    activeDoc?.chartVisualMode,
    activeDoc?.sourceName,
    openAscensionalTransitsPane,
  ]);

  if (activeDoc?.kind === "directions") {
    return (
      <WorkspaceDocumentSurface>
        <DirectionsView
          key={activeDoc.id}
          sourceName={activeDoc.sourceName}
          source={activeDoc.fpath}
          documentId={activeDoc.id}
          cursorDocumentId={activeDoc.parentDocumentId ?? activeDoc.id}
          focusDatetime={activeDoc.displayDatetime}
          customSignificator={activeDoc.directionsCustomSignificator ?? null}
          initialPrimaryDirection={activeDoc.directionsDefaultDirection ?? undefined}
        />
      </WorkspaceDocumentSurface>
    );
  }
  if (activeDoc?.kind === "astrolabe") {
    return (
      <AstrolabeView
        key={activeDoc.id}
        documentId={activeDoc.id}
        sourceName={activeDoc.sourceName}
        source={activeDoc.fpath}
      />
    );
  }
  if (activeDoc?.kind === "astrolog-sphere") {
    return (
      <AstrologSphereView
        key={activeDoc.id}
        documentId={activeDoc.id}
        sourceName={activeDoc.sourceName}
        source={activeDoc.fpath}
      />
    );
  }
  if (activeDoc?.kind === "square-chart") {
    return (
      <SquareChartView
        key={activeDoc.id}
        documentId={activeDoc.id}
        parentDocumentId={activeDoc.parentDocumentId}
        sourceName={activeDoc.sourceName}
        source={activeDoc.fpath}
      />
    );
  }
  if (activeDoc?.kind === "mundane-chart") {
    return (
      <MundaneChartView
        key={activeDoc.id}
        documentId={activeDoc.id}
        parentDocumentId={activeDoc.parentDocumentId}
        sourceName={activeDoc.sourceName}
        source={activeDoc.fpath}
      />
    );
  }
  if (activeDoc?.kind === "ephemeris") {
    return (
      <GraphicEphemerisArea
        chart={chart}
        activeDoc={activeDoc}
        navbar={navbar}
      />
    );
  }
  if (activeDoc?.kind === "transit-search") {
    return (
      <WorkspaceDocumentSurface>
        <TransitSearchView
          key={activeDoc.id}
          documentId={activeDoc.id}
          sourceName={activeDoc.sourceName}
        />
      </WorkspaceDocumentSurface>
    );
  }
  if (activeDoc?.kind === "table" && isTimeLordTableId(activeDoc.tableId)) {
    return (
      <WorkspaceDocumentSurface>
        <TimeLordPaneView
          key={activeDoc.id}
          documentId={activeDoc.id}
          parentDocumentId={activeDoc.parentDocumentId}
          tableId={activeDoc.tableId}
          sourceName={activeDoc.sourceName}
        />
      </WorkspaceDocumentSurface>
    );
  }
  if (activeDoc?.kind === "table" && activeDoc.tableId === "eclipses") {
    return (
      <WorkspaceDocumentSurface>
        <EclipsesView
          key={activeDoc.id}
          documentId={activeDoc.id}
          parentDocumentId={activeDoc.parentDocumentId}
          sourceName={activeDoc.sourceName}
        />
      </WorkspaceDocumentSurface>
    );
  }
  if (activeDoc?.kind === "table" && activeDoc.tableId === "synodic_cycles") {
    return (
      <WorkspaceDocumentSurface>
        <SynodicCycleListView
          key={activeDoc.id}
          documentId={activeDoc.id}
          parentDocumentId={activeDoc.parentDocumentId}
          sourceName={activeDoc.sourceName}
        />
      </WorkspaceDocumentSurface>
    );
  }
  if (activeDoc?.kind === "table" && activeDoc.tableId === "temporal_confluence") {
    return (
      <WorkspaceDocumentSurface>
        <TemporalConfluenceView
          key={activeDoc.id}
          documentId={activeDoc.id}
          parentDocumentId={activeDoc.parentDocumentId}
          sourceName={activeDoc.sourceName}
          focusDatetime={activeDoc.displayDatetime}
        />
      </WorkspaceDocumentSurface>
    );
  }
  if (activeDoc?.kind === "table" && activeDoc.tableId) {
    return (
      <WorkspaceDocumentSurface>
        <GenericTableView
          key={activeDoc.id}
          documentId={activeDoc.id}
          parentDocumentId={activeDoc.parentDocumentId}
          tableId={activeDoc.tableId}
        />
      </WorkspaceDocumentSurface>
    );
  }
  if (
    activeDoc &&
    isChartBearingSurfaceDocument(activeDoc) &&
    isMdoVisualMode(activeDoc.chartVisualMode)
  ) {
    return (
      <ChartArea
        chart={chart}
        activeDoc={activeDoc}
        navbar={navbar}
        surface={
          <MundaneChartView
            key={`${activeDoc.id}:${activeDoc.chartVisualMode}`}
            documentId={activeDoc.id}
            parentDocumentId={activeDoc.parentDocumentId}
            sourceName={activeDoc.sourceName}
            source={activeDoc.fpath}
            refreshKey={activeDoc.displayDatetime ?? activeDoc.chartVisualMode}
          />
        }
      />
    );
  }
  if (activeDoc?.kind === "ascensional-transits") {
    return (
      <ChartArea
        chart={chart}
        activeDoc={activeDoc}
        navbar={navbar}
        surface={<AscensionalTransitsView key={activeDoc.id} document={activeDoc} />}
      />
    );
  }
  return (
    <ChartArea chart={chart} activeDoc={activeDoc} navbar={navbar} />
  );
}

export function graphicEphemerisModeButtonLabelKey(
  mode: GraphicEphemerisDisplayMode,
): "ephem.modeLonDecl" | "ephem.modeDeclLon" {
  return mode === "longitude" ? "ephem.modeLonDecl" : "ephem.modeDeclLon";
}

function GraphicEphemerisArea({
  chart,
  activeDoc,
  navbar,
}: {
  chart: ChartRenderSnapshot | null;
  activeDoc: WorkspaceDocument;
  navbar?: ModeHintRailProps | null;
}) {
  const t = useT();
  const [displayMode, setDisplayMode] = React.useState<
    GraphicEphemerisDisplayMode | null
  >(null);
  const displayModeToggleRef = React.useRef<(() => void) | null>(null);
  const handleDisplayModeChange = React.useCallback(
    (next: GraphicEphemerisDisplayMode) => {
      setDisplayMode(next);
    },
    [],
  );
  const registerDisplayModeToggle = React.useCallback((toggle: () => void) => {
    displayModeToggleRef.current = toggle;
    return () => {
      if (displayModeToggleRef.current === toggle) {
        displayModeToggleRef.current = null;
      }
    };
  }, []);
  const requestAlternateDisplayMode = React.useCallback(() => {
    displayModeToggleRef.current?.();
  }, []);
  const modeButtonLabel = displayMode
    ? t(graphicEphemerisModeButtonLabelKey(displayMode))
    : null;
  const ephemerisNavbar: ModeHintRailProps | null | undefined = navbar
    ? {
        ...navbar,
        modeHintLabel: modeButtonLabel,
        modeHintTitle: modeButtonLabel,
        onToggleModeHint: displayMode ? requestAlternateDisplayMode : undefined,
      }
    : navbar;

  return (
    <ChartArea
      chart={chart}
      activeDoc={activeDoc}
      navbar={ephemerisNavbar}
      surface={
        <GraphEphemerisView
          key={activeDoc.id}
          documentId={activeDoc.id}
          registerDisplayModeToggle={registerDisplayModeToggle}
          onDisplayModeChange={handleDisplayModeChange}
        />
      }
    />
  );
}

function WorkspaceDocumentSurface({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-aries-surface="canvas"
      className="relative box-border flex h-full w-full min-h-0 flex-1 pt-[var(--titlebar-h)] [&>*]:bg-transparent"
    >
      {children}
    </div>
  );
}

/**
 * Branded splash for an empty workspace — the web port of wx drawSplash
 * (morin.py:21558) / CentralChartHost._paint_splash (workspace_shell.py:4831).
 * wx shows Res/Morinus.jpg, the "ARIES" wordmark, and the info lines
 * (mtexts 'FreeSoft' / 'Description') centred in the chart pane whenever no
 * chart is open (e.g. after closing the last document). This mirrors that
 * behaviour instead of the bare "No chart open" text. The photo is served by
 * the daemon at /Res/Morinus.jpg (same mount that serves the astrocart assets).
 */
function EmptyWorkspace() {
  const t = useT();
  const deferredUpdate = useUpdateNotificationStore((state) => state.deferred);
  const requestUpdateOffer = useUpdateNotificationStore((state) => state.requestOffer);
  // Served same-origin from the frontend's public/ (copied from Res/Morinus.jpg)
  // — loading it cross-origin from the daemon (:8765) failed to render in the
  // Tauri webview even though the daemon returns 200.
  const splashSrc = `/aries-splash.jpg`;
  const [splash, setSplash] = React.useState<AppSplashPayload>({
    title: "ARIES",
    subtitle: "Aries dev",
    infoLines: [
      "Open Source Software",
      "An easy to use, highly accurate astrology program.",
      "Swiss Ephemeris Version:",
    ],
    supportUrl: "https://buymeacoffee.com/primum.mobile",
    supportText: "Support the Development of Aries",
  });
  const daemonConnection = useDaemonWorkspaceStore((state) => state.connection);

  React.useEffect(() => {
    if (daemonConnection !== "open") return;
    const controller = new AbortController();
    fetchAppSplash(controller.signal)
      .then((payload) => setSplash(payload))
      .catch((error) => {
        if (isTransientDaemonFetchError(error)) return;
        if (!controller.signal.aborted) {
          console.error("[app-splash]", error);
        }
      });
    return () => controller.abort();
  }, [daemonConnection]);

  const handleSupportClick = React.useCallback(
    async (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      const shellHost = resolveShellHost();
      try {
        await shellHost.openExternal(splash.supportUrl);
      } catch (error) {
        console.error("[app-splash-support]", error);
        window.open(splash.supportUrl, "_blank", "noopener,noreferrer");
      }
    },
    [splash.supportUrl],
  );

  return (
    <div className="relative flex h-full w-full flex-1 min-h-0 items-center justify-center bg-transparent">
      <div className="flex flex-col items-center px-8 text-center text-[color:var(--aries-text-primary)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={splashSrc}
          alt=""
          aria-hidden
          className="mb-[10px] max-h-[min(40vh,335px)] w-auto select-none object-contain"
          draggable={false}
        />
        {/* "ARIES" wordmark — wx shears the A 19deg from its lower edge, then
            positions RIES from measured text width plus a small kern. */}
        <div
          className="whitespace-nowrap text-[26px] font-normal leading-none tracking-normal"
          aria-label={splash.title}
        >
          <span aria-hidden className="inline-block origin-bottom-left skew-x-[-19deg]">
            {splash.title.slice(0, 1)}
          </span>
          <span aria-hidden className="ml-[0.18em]">
            {splash.title.slice(1)}
          </span>
        </div>
        <div className="mt-[5px] text-[length:var(--aries-font-size-reading)] leading-tight">{splash.subtitle}</div>
        {/* Info lines — faithful to wx's mtexts 'FreeSoft' + 'Description'. */}
        <div className="mt-[10px] flex flex-col text-[length:var(--aries-font-size-micro)] leading-[1.5] text-[color:var(--aries-text-muted)]">
          {splash.infoLines.map((line, index) => (
            <span key={`${index}:${line}`}>{line}</span>
          ))}
        </div>
        <a
          href={splash.supportUrl}
          onClick={handleSupportClick}
          className="mt-[10px] inline-flex items-center gap-1 text-[length:var(--aries-font-size-micro)] leading-[1.5] text-[color:var(--aries-text-muted)] opacity-80 hover:underline"
        >
          <Coffee aria-hidden className="size-3" strokeWidth={1.6} />
          {splash.supportText}
        </a>
        {deferredUpdate ? (
          <button
            type="button"
            className="mt-[var(--aries-pane-title-gap)] inline-flex h-[var(--aries-control-height-small)] items-center gap-[var(--aries-control-gap)] rounded-[var(--aries-radius-control)] border border-border/70 bg-muted/40 px-[var(--aries-control-padding-x)] text-[length:var(--aries-font-size-section)] text-foreground hover:bg-muted/70"
            onClick={requestUpdateOffer}
          >
            <Bell aria-hidden className="size-[var(--aries-control-icon-size)]" />
            {t("license.splashUpdateAvailable", { version: deferredUpdate.version })}
          </button>
        ) : null}
      </div>
    </div>
  );
}

const AstrocartSurface = React.memo(function AstrocartSurface({
  documentId,
  parentDocumentId,
  active,
  eclipseEvent,
}: {
  documentId: string;
  parentDocumentId: string | null;
  active: boolean;
  // Solar-eclipse shadow-path overlay request, set when the doc was opened
  // via "Show Eclipse Path on Map" (wx morin.show_eclipse_path_on_map ->
  // AstrocartPanel.set_eclipse_event, morin.py:16211-16227 /
  // astrocartframe.py:326-342).
  eclipseEvent?: { jdUt: number; retflag: number } | null;
}) {
  // Loads Res/astrocart/map.html from the daemon (same origin so the
  // Morinus.ttf @font-face resolves cleanly via /Res/Morinus.ttf). On
  // iframe load: fetch ACG GeoJSON through the workspace document route and
  // push it + recenter the map on the birthplace via the postMessage bridge
  // baked into map.html (window.addEventListener('message', …)).
  const t = useT();
  const tf = useTFallback();
  // A retained hidden map must not re-render for every active chart time step.
  // On reactivation the selector immediately exposes the latest event and the
  // existing sequence/relevance logic performs one coherent refresh.
  const lastSessionChange = useDaemonWorkspaceStore((state) =>
    active ? state.lastSessionChange : null,
  );
  const lastOptionsChange = useDaemonWorkspaceStore((state) =>
    active ? state.lastOptionsChange : null,
  );
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const printAtlasRequestSequenceRef = React.useRef(0);
  const printAtlasRequestsRef =
    React.useRef(new Map<string, AstrocartPrintAtlasRequest>());
  const latestViewStateRef = React.useRef<AstrocartViewState | null>(null);
  const viewStateIntentRevisionRef = React.useRef(0);
  const mapHostActiveRef = React.useRef(active);
  const saveViewStateTimerRefs = React.useRef<
    Record<AstrocartViewStateScope, number | null>
  >({
    camera: null,
    global: null,
    all: null,
  });
  const paranIntentSequenceRef = React.useRef(0);
  const configurationActivationGenerationRef = React.useRef(0);
  const completedEclipseKeyRef = React.useRef<string | null>(null);
  const completedAsterismKeyRef = React.useRef<string | null>(null);
  const asterismDataCacheRef = React.useRef<{
    documentId: string;
    sessionRevision: number;
    referenceGeometryRevision: number;
    payload: unknown;
  } | null>(null);
  const completedDisplayStyleKeyRef = React.useRef<string | null>(null);
  const completedDirectThemeKeyRef = React.useRef<string | null>(null);
  const latestDisplayStyleRef = React.useRef<unknown>(null);
  const displayStyleRequestRef = React.useRef<AbortController | null>(null);
  const handledSessionChangeSeqRef = React.useRef(lastSessionChange?.seq ?? 0);
  const pendingSessionRefreshRef = React.useRef(false);
  const handledOptionsChangeSeqRef = React.useRef(lastOptionsChange?.seq ?? 0);
  const activeLineModesRef = React.useRef<AstrocartLineMode[]>(ASTROCART_DEFAULT_LINE_MODES);
  const modeSpecKeysRef = React.useRef<AstrocartModeSpecKeys>({});
  const activeDataContextRef = React.useRef<{
    dataGenerationKey: string;
    lineModes: AstrocartLineMode[];
    modeSpecKeys: AstrocartModeSpecKeys;
    sessionRevision: number;
    configurationRevision: number;
  } | null>(null);
  const modeDataCacheRef = React.useRef(
    new Map<AstrocartLineMode, AstrocartRetainedModeCacheEntry>(),
  );
  const modeDataRequestsRef = React.useRef(new Map<AstrocartLineMode, AstrocartModeRequest>());
  const astrocartMetaCacheRef = React.useRef<{
    sessionRevision: number;
    configurationRevision: number;
    meta: AstrocartGeoJsonMeta;
  } | null>(null);
  const emptyModeDataCacheRef =
    React.useRef<AstrocartEmptyModeCacheEntry | null>(null);
  const emptyMetaRequestRef = React.useRef<AstrocartMetaRequest | null>(null);
  const modeDataDocumentRef = React.useRef(documentId);
  const lastRenderedDataGenerationRef = React.useRef<string | null>(null);
  const lastRenderedDataSignatureRef = React.useRef<string | null>(null);
  const canonicalAstrocartSpecRef = React.useRef<AstrocartMapSpec | null>(null);
  const lastCanonicalAstrocartSpecKeyRef = React.useRef<string | null>(null);
  const astrocartConfigurationRef =
    React.useRef<AstrocartConfigurationPayload | null>(null);
  const lastVisibilitySignatureRef = React.useRef<string | null>(null);
  const lastUiLabelsSignatureRef = React.useRef<string | null>(null);
  const initialCenterAppliedRef = React.useRef(false);
  const [readyUrl, setReadyUrl] = React.useState<string | null>(null);
  const [presentedMapUrl, setPresentedMapUrl] = React.useState<string | null>(null);
  const [iframeLoadRevision, setIframeLoadRevision] = React.useState(0);
  const [linesPushedFor, setLinesPushedFor] = React.useState<string | null>(null);
  const [sessionRevision, setSessionRevision] = React.useState(0);
  const [configurationRevision, setConfigurationRevision] = React.useState(0);
  const [displayStyleRevision, setDisplayStyleRevision] = React.useState(1);
  const [astrocartLabelRevision, setAstrocartLabelRevision] = React.useState(0);
  const [paranIntent, setParanIntent] =
    React.useState<AstrocartParanIntent | null>(null);
  const [lineModes, setLineModes] = React.useState<AstrocartLineMode[]>(ASTROCART_DEFAULT_LINE_MODES);
  const [natalLayerVisible, setNatalLayerVisible] = React.useState(true);
  const [viewStateReadyFor, setViewStateReadyFor] = React.useState<string | null>(null);
  const astrocartControlsPane = useWorkspaceStore((state) => state.astrocartControlsPane);
  const openAstrocartControlsPane = useWorkspaceStore(
    (state) => state.openAstrocartControlsPane,
  );
  const closeAstrocartControlsPane = useWorkspaceStore(
    (state) => state.closeAstrocartControlsPane,
  );
  const sidebarOpen = useFrameLayoutStore((state) => state.sidebarOpen);
  const sidebarWidth = useFrameLayoutStore((state) => state.sidebarWidth);
  const rightPaneWidth = useFrameLayoutStore((state) => state.rightPaneWidth);
  const theme = useThemeStore((s) => s.theme);
  const bootTheme = theme?.mode === "light" ? "light" : "dark";
  const bootPageBg = bootTheme === "light" ? "#d9dde1" : "#1a1d21";
  const themeStyleKey = `${theme?.styleRevision ?? "pending"}:${theme?.styleHash ?? "pending"}`;
  // Pass the cached app theme immediately in the URL so map.html's first paint
  // is not the browser/provider default. The daemon still sends the authoritative
  // theme from the cheap display-style endpoint, mirroring
  // astrocartframe._is_dark_theme without coupling style to line geometry.
  // The surface is full-bleed: the map fills under the floating title bar (no
  // opaque bar, no status bar — see WorkspaceFrame `fullBleed`). Pass
  // titlebarSafeTop = --titlebar-h (34px, globals.css) so map.html insets its
  // top-left zoom control, legend and mode buttons below the traffic lights —
  // the wx-free twin of astrocartframe._load_map_html's `titlebarSafeTop` query.
  // Online keeps the provider's established label hierarchy; places=auto adds
  // bundled Aries labels only when the local/minimal offline basemap is active.
  // Keep the URL's boot theme stable and push later theme changes live so the
  // iframe never remounts just for colors.
  // titlebarSafeTop=34 mirrors astrocartframe._load_map_html's titlebar inset.
  const [mapBootOptions] = React.useState(() => ({
    theme: bootTheme,
    pageBg: bootPageBg,
    places: "auto",
    titlebarSafeTop: ASTROCART_TITLEBAR_SAFE_TOP,
  } as const));
  const url = useAstrocartMapUrl(mapBootOptions, { allowTileAdoption: !active });
  const lineModesKey = lineModes.join(",");
  // WKWebView can discard and reload a retained map after several WebGL-backed
  // chart surfaces have been visited. The URL and React component stay the
  // same, so include the actual iframe load generation in every replay key.
  // Otherwise the new page is empty while the parent still thinks data/style
  // were completed for the previous iframe document.
  const mapInstanceKey = `${documentId}:${url ?? "pending"}:${iframeLoadRevision}`;
  const dataGenerationKey =
    `${mapInstanceKey}:${lineModesKey}:${sessionRevision}:${configurationRevision}`;
  const viewStateKey = mapInstanceKey;
  const iframeReady = !!url && readyUrl === url;
  const viewStateReady = iframeReady && viewStateReadyFor === viewStateKey;
  const linesPushed = linesPushedFor === dataGenerationKey;
  const controlsOpen =
    active && astrocartControlsPane?.documentId === documentId;
  const controlsPanePolicy = rightPaneWidthPolicy("astrocart-controls");
  const effectiveControlsPaneWidth = rightPanePriorityLayout(
    sidebarOpen,
    sidebarWidth,
    rightPaneWidth,
    "astrocart-controls",
  ).rightPaneWidth;
  const controlsPaneTrack = useCoherentRightPaneTrack(
    controlsOpen,
    effectiveControlsPaneWidth,
  );
  // View-only Astrocartography documents are not themselves rebuilt by a
  // global house-system change, even though their reference geometry depends
  // on the parent radix's new houses. Include that option event explicitly so
  // the retained map replaces its house planes without requiring a retoggle.
  const referenceGeometryRevision =
    lastOptionsChange?.refreshMode === "house-system" ? lastOptionsChange.seq : 0;
  const catalogRevision =
    lastOptionsChange &&
    lastOptionsChange.styleOnly !== true &&
    lastOptionsChange.listDataChanged !== false &&
    lastOptionsChange.refreshedDocumentIds.some(
      (id) => id === documentId || id === parentDocumentId,
    )
      ? lastOptionsChange.seq
      : 0;
  const settlePrintAtlasRequest = React.useCallback((
    requestId: string,
    atlas: AstrocartPrintAtlas | null,
  ) => {
    const request = printAtlasRequestsRef.current.get(requestId);
    if (!request) return;
    printAtlasRequestsRef.current.delete(requestId);
    window.clearTimeout(request.timeoutId);
    request.signal.removeEventListener("abort", request.abortListener);
    request.controller.abort();
    request.resolve(
      atlas &&
      mapHostActiveRef.current &&
      activeDataContextRef.current?.dataGenerationKey ===
        request.dataGenerationKey
        ? atlas
        : null,
    );
  }, []);

  const requestPrintAtlas = React.useCallback(async (
    pageFormat: AstrocartPdfPageFormat,
    selection: AstrocartPdfSelection,
    signal: AbortSignal,
  ): Promise<AstrocartPrintAtlas | null> => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!active || !iframeReady || !targetWindow || signal.aborted) {
      return null;
    }
    const activeContext = activeDataContextRef.current;
    const captureConfiguration = astrocartConfigurationRef.current;
    if (!activeContext || !captureConfiguration) return null;
    const captureContext = {
      ...activeContext,
      lineModes: [...activeContext.lineModes],
      modeSpecKeys: { ...captureConfiguration.modeSpecKeys },
    };
    const captureSpecKey = captureConfiguration.specKey;

    printAtlasRequestSequenceRef.current += 1;
    const requestId =
      `${mapInstanceKey}:atlas:${printAtlasRequestSequenceRef.current}`;
    return new Promise((resolve) => {
      const controller = new AbortController();
      let capturePosted = false;
      const cancelChild = () => {
        if (!capturePosted) return;
        targetWindow.postMessage({
          type: "aries.cancelPrintAtlas",
          requestId,
        }, "*");
      };
      const abortListener = () => {
        controller.abort();
        cancelChild();
        settlePrintAtlasRequest(requestId, null);
      };
      const timeoutId = window.setTimeout(
        () => {
          cancelChild();
          settlePrintAtlasRequest(requestId, null);
        },
        240_000,
      );
      printAtlasRequestsRef.current.set(requestId, {
        resolve,
        dataGenerationKey: captureContext.dataGenerationKey,
        timeoutId,
        signal,
        controller,
        abortListener,
        cancelChild,
      });
      signal.addEventListener("abort", abortListener, { once: true });
      if (signal.aborted) {
        abortListener();
        return;
      }

      const requestIsCurrent = () => (
        !controller.signal.aborted &&
        mapHostActiveRef.current &&
        iframeRef.current?.contentWindow === targetWindow &&
        printAtlasRequestsRef.current.get(requestId)?.controller === controller &&
        activeDataContextRef.current?.dataGenerationKey ===
          captureContext.dataGenerationKey &&
        astrocartConfigurationRef.current?.specKey === captureSpecKey
      );
      const payloadMatchesCapture = (
        payload: AstrocartGeoJsonPayload,
        mode: AstrocartLineMode | null,
      ) => {
        if (
          payload.meta?.precision !== "precise" ||
          payload.meta.specKey !== captureSpecKey
        ) {
          return false;
        }
        if (mode == null) return true;
        const expectedModeSpecKey = astrocartModeSpecKey(
          captureContext.modeSpecKeys,
          mode,
        );
        return (
          expectedModeSpecKey != null &&
          payload.meta.modeSpecKey === expectedModeSpecKey
        );
      };

      void (async () => {
        try {
          const preciseModeCache = new Map<
            AstrocartLineMode,
            AstrocartModeCacheEntry
          >();
          let preciseEmptyModePayload: AstrocartGeoJsonPayload | undefined;
          if (captureContext.lineModes.length === 0) {
            const payload = await fetchAstrocartModePayload(
              documentId,
              null,
              "precise",
              controller.signal,
            );
            if (
              !requestIsCurrent() ||
              !payloadMatchesCapture(payload, null)
            ) {
              settlePrintAtlasRequest(requestId, null);
              return;
            }
            preciseEmptyModePayload = payload;
          } else {
            for (const mode of captureContext.lineModes) {
              if (!requestIsCurrent()) {
                settlePrintAtlasRequest(requestId, null);
                return;
              }
              const payload = await fetchAstrocartModePayload(
                documentId,
                mode,
                "precise",
                controller.signal,
              );
              if (
                !requestIsCurrent() ||
                !payloadMatchesCapture(payload, mode)
              ) {
                settlePrintAtlasRequest(requestId, null);
                return;
              }
              preciseModeCache.set(mode, {
                sessionRevision: captureContext.sessionRevision,
                modeSpecKey: astrocartModeSpecKey(
                  captureContext.modeSpecKeys,
                  mode,
                ),
                precision: "precise",
                payload,
              });
            }
          }
          if (!requestIsCurrent()) {
            settlePrintAtlasRequest(requestId, null);
            return;
          }
          const fallbackMeta =
            preciseEmptyModePayload?.meta ??
            captureContext.lineModes
              .map((mode) => preciseModeCache.get(mode)?.payload.meta)
              .find((meta): meta is AstrocartGeoJsonMeta => meta != null);
          const composed = composeAstrocartModePayload(
            captureContext.lineModes,
            captureContext.sessionRevision,
            captureContext.modeSpecKeys,
            preciseModeCache,
            fallbackMeta,
            captureConfiguration,
            preciseEmptyModePayload,
          );
          if (
            !composed.complete ||
            composed.payload.meta?.precision !== "precise" ||
            composed.payload.meta.specKey !== captureSpecKey ||
            !requestIsCurrent()
          ) {
            settlePrintAtlasRequest(requestId, null);
            return;
          }
          capturePosted = true;
          targetWindow.postMessage({
            type: "aries.capturePrintAtlas",
            requestId,
            pageFormat,
            selection,
            geojson: composed.payload,
          }, "*");
        } catch (err) {
          if (!isAbortError(err, controller.signal)) {
            console.error("[acg-print]", err);
          }
          settlePrintAtlasRequest(requestId, null);
        }
      })();
    });
  }, [
    active,
    documentId,
    iframeReady,
    mapInstanceKey,
    settlePrintAtlasRequest,
  ]);

  const cancelPrintAtlasRequests = React.useCallback(() => {
    for (const [requestId, request] of printAtlasRequestsRef.current) {
      request.controller.abort();
      request.cancelChild();
      settlePrintAtlasRequest(requestId, null);
    }
  }, [settlePrintAtlasRequest]);

  React.useEffect(() => {
    if (!active) cancelPrintAtlasRequests();
    return cancelPrintAtlasRequests;
  }, [
    active,
    cancelPrintAtlasRequests,
    dataGenerationKey,
  ]);

  React.useLayoutEffect(() => {
    const wasActive = mapHostActiveRef.current;
    mapHostActiveRef.current = active;
    if (wasActive === active) return;
    configurationActivationGenerationRef.current += 1;
    // Geometry stays painted, but its preference snapshot is no longer safe
    // as a write base: another retained map may change the global static spec
    // before this one is used again.
    canonicalAstrocartSpecRef.current = null;
    astrocartConfigurationRef.current = null;
    modeSpecKeysRef.current = {};
  }, [active]);

  const applyAstrocartSpecVisibility = React.useCallback((
    spec: AstrocartMapSpec,
    force = false,
  ) => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return;
    const enabledDynamicLayers = spec.dynamicLayers.filter((layer) => layer.enabled);
    const enabledAspects = spec.aspects.definitions
      .filter((definition) => definition.enabled)
      .map((definition) => definition.id);
    const previousOverlays = latestViewStateRef.current?.overlays;
    const natalVisible = previousOverlays?.layers?.natal ?? true;
    const layers = {
      natal: natalVisible,
      transit: enabledDynamicLayers.some((layer) => layer.technique === "transit"),
      progression: enabledDynamicLayers.some((layer) => layer.technique !== "transit"),
    };
    const overlays = {
      ...(previousOverlays ?? {}),
      parans: spec.paran.enabled,
      aspects: enabledAspects.length > 0,
      zeniths: spec.zenithEnabled,
      localSpaceOppositions: spec.localSpace.oppositionEnabled,
      layers,
      filters: {
        ...(previousOverlays?.filters ?? {}),
        aspects: enabledAspects,
        techniques: null,
      },
    };
    const nextViewState: AstrocartViewState = {
      ...(latestViewStateRef.current ?? {}),
      overlays,
    };
    latestViewStateRef.current = nextViewState;
    const filters = {
      parans: spec.paran.enabled,
      aspects: enabledAspects.length > 0,
      aspectNames: enabledAspects,
      techniques: null,
      zeniths: spec.zenithEnabled,
      localSpaceOppositions: spec.localSpace.oppositionEnabled,
      layers,
    };
    const visibilitySignature = `${mapInstanceKey}:${JSON.stringify(filters)}`;
    if (!force && lastVisibilitySignatureRef.current === visibilitySignature) return;
    lastVisibilitySignatureRef.current = visibilitySignature;
    // Keep view-only filtering instant while a new daemon geometry snapshot is
    // prepared. This bridge updates chrome only: a first-open map has no saved
    // camera yet, so it must never be routed through the camera restore path.
    targetWindow.postMessage(
      {
        type: "aries.setVisibilityFilters",
        filters,
      },
      "*",
    );
  }, [mapInstanceKey]);

  const handleAstrocartConfigurationPreview = React.useCallback((
    spec: AstrocartMapSpec,
  ) => {
    canonicalAstrocartSpecRef.current = spec;
    applyAstrocartSpecVisibility(spec);
  }, [applyAstrocartSpecVisibility]);

  const handleAstrocartConfigurationChange = React.useCallback((
    change: AstrocartConfigurationChange,
  ) => {
    const previousSpecKey = lastCanonicalAstrocartSpecKeyRef.current;
    astrocartConfigurationRef.current = change.payload;
    lastCanonicalAstrocartSpecKeyRef.current = change.payload.specKey;
    modeSpecKeysRef.current = change.payload.modeSpecKeys;
    setAstrocartLabelRevision((revision) => revision + 1);
    canonicalAstrocartSpecRef.current = change.payload.spec;
    applyAstrocartSpecVisibility(change.payload.spec);
    if (previousSpecKey != null && previousSpecKey !== change.payload.specKey) {
      setConfigurationRevision((revision) => revision + 1);
    }
  }, [applyAstrocartSpecVisibility]);

  const queueAstrocartParanIntent = React.useCallback((enabled: boolean) => {
    const optimisticBase =
      canonicalAstrocartSpecRef.current ?? astrocartConfigurationRef.current?.spec;
    if (optimisticBase) {
      const optimisticSpec: AstrocartMapSpec = {
        ...optimisticBase,
        paran: {
          ...optimisticBase.paran,
          enabled,
        },
      };
      canonicalAstrocartSpecRef.current = optimisticSpec;
      applyAstrocartSpecVisibility(optimisticSpec);
    }
    paranIntentSequenceRef.current += 1;
    setParanIntent({
      revision: paranIntentSequenceRef.current,
      enabled,
    });
  }, [applyAstrocartSpecVisibility]);

  React.useEffect(() => {
    if (!iframeReady) return;
    const targetWindow = iframeRef.current?.contentWindow;
    targetWindow?.postMessage({ type: "aries.setActive", active }, "*");
    if (!active) {
      // A delayed camera-state notification must not wake the daemon after the
      // retained map has become invisible. Cancel both sides of the debounce:
      // map.html's pending postMessage and this surface's pending persistence.
      targetWindow?.postMessage(
        { type: "aries.setStatePersistence", enabled: false },
        "*",
      );
      for (const scope of ["camera", "global", "all"] as const) {
        const timer = saveViewStateTimerRefs.current[scope];
        if (timer == null) continue;
        window.clearTimeout(timer);
        saveViewStateTimerRefs.current[scope] = null;
      }
      // Static map preferences are global. Mark this retained copy stale while
      // hidden so reactivation quietly merges the latest global view with this
      // document's own camera and dynamic timing state.
      queueMicrotask(() => {
        if (!mapHostActiveRef.current) setViewStateReadyFor(null);
      });
    }
  }, [active, iframeReady]);

  React.useEffect(() => {
    const documentChanged = modeDataDocumentRef.current !== documentId;
    const modeDataRequests = modeDataRequestsRef.current;
    modeDataDocumentRef.current = documentId;
    for (const request of modeDataRequests.values()) {
      request.controller.abort();
    }
    modeDataRequests.clear();
    emptyMetaRequestRef.current?.controller.abort();
    emptyMetaRequestRef.current = null;
    modeDataCacheRef.current.clear();
    astrocartMetaCacheRef.current = null;
    emptyModeDataCacheRef.current = null;
    if (documentChanged) {
      lastRenderedDataGenerationRef.current = null;
      canonicalAstrocartSpecRef.current = null;
      lastCanonicalAstrocartSpecKeyRef.current = null;
      astrocartConfigurationRef.current = null;
      modeSpecKeysRef.current = {};
      initialCenterAppliedRef.current = false;
    }
    return () => {
      for (const request of modeDataRequests.values()) {
        request.controller.abort();
      }
      emptyMetaRequestRef.current?.controller.abort();
    };
  }, [documentId, sessionRevision]);

  React.useEffect(() => {
    activeLineModesRef.current = lineModes;
    activeDataContextRef.current = {
      dataGenerationKey,
      lineModes,
      modeSpecKeys: modeSpecKeysRef.current,
      sessionRevision,
      configurationRevision,
    };
  }, [configurationRevision, dataGenerationKey, lineModes, sessionRevision]);

  React.useEffect(() => {
    if (active) return;
    // Deactivation is a scheduling boundary: retained map state and completed
    // caches remain, but unfinished map work must not compete with the active
    // chart's key-repeat path.
    displayStyleRequestRef.current?.abort();
    displayStyleRequestRef.current = null;
    for (const request of modeDataRequestsRef.current.values()) {
      request.controller.abort();
    }
    modeDataRequestsRef.current.clear();
    emptyMetaRequestRef.current?.controller.abort();
    emptyMetaRequestRef.current = null;
  }, [active]);

  React.useEffect(() => {
    const change = lastSessionChange;
    if (change && handledSessionChangeSeqRef.current !== change.seq) {
      handledSessionChangeSeqRef.current = change.seq;
      if (change.changeReason !== "display-overlay") {
        const relevantIds = [documentId, parentDocumentId].filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        );
        const relevant =
          relevantIds.includes(change.docId ?? "") ||
          change.rebuiltChildIds.some((id) => relevantIds.includes(id));
        if (relevant) pendingSessionRefreshRef.current = true;
      }
    }
    // Retained maps stay mounted for an immediate tab return, but an invisible
    // WebGL iframe must not churn React state or discard large GeoJSON caches on
    // every parent-chart key repeat. Collapse all hidden session changes into a
    // single refresh when the map becomes active again.
    if (!active || !pendingSessionRefreshRef.current) return;
    pendingSessionRefreshRef.current = false;
    queueMicrotask(() => setSessionRevision((revision) => revision + 1));
  }, [active, documentId, lastSessionChange, parentDocumentId]);

  React.useEffect(() => {
    const change = lastOptionsChange;
    if (!change || handledOptionsChangeSeqRef.current === change.seq) return;
    handledOptionsChangeSeqRef.current = change.seq;
    if (change.refreshMode !== "display-overlay") return;
    const relevantIds = [documentId, parentDocumentId].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (!change.refreshedDocumentIds.some((id) => relevantIds.includes(id))) return;
    // A line-mode request started before this options event may still complete
    // with the old palette. Do not let its subsequent data push replay the last
    // display-style payload while the authoritative replacement is in flight.
    displayStyleRequestRef.current?.abort();
    displayStyleRequestRef.current = null;
    latestDisplayStyleRef.current = null;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDisplayStyleRevision((revision) => revision + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, lastOptionsChange, parentDocumentId]);

  React.useEffect(() => {
    latestViewStateRef.current = null;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "aries.setStatePersistence", enabled: false },
      "*",
    );
  }, [documentId]);

  React.useEffect(() => {
    if (!active || !iframeReady) return;
    const directThemeKey = `${mapInstanceKey}:${themeStyleKey}:${bootTheme}:${bootPageBg}`;
    if (completedDirectThemeKeyRef.current === directThemeKey) return;
    // The direct mode message restores the old immediate theme behavior while
    // the authoritative versioned map style is fetched. Never replay a full
    // renderer from the previous theme over that new mode in the meantime.
    displayStyleRequestRef.current?.abort();
    displayStyleRequestRef.current = null;
    latestDisplayStyleRef.current = null;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "aries.setTheme", theme: bootTheme, pageBg: bootPageBg, resetStyle: true },
      "*",
    );
    completedDirectThemeKeyRef.current = directThemeKey;
  }, [active, bootPageBg, bootTheme, iframeReady, mapInstanceKey, themeStyleKey]);

  React.useEffect(() => {
    if (!active || !iframeReady) return;
    const pointLabels: Record<string, string> = {};
    for (const point of astrocartConfigurationRef.current?.catalog.points ?? []) {
      const label = point.labelKey ? tf(point.labelKey, point.label) : point.label;
      pointLabels[point.semanticId] = label;
      if (point.point?.id) pointLabels[point.point.id] = label;
    }
    const labels = {
      birthplaceMarker: t("astrocart.birthplaceMarker.title"),
      asterisms: t("astrocart.overlay.asterisms"),
      aspect: t("astrocart.overlay.aspect"),
      zenith: t("astrocart.overlay.zenith"),
      localSpaceOpposition: t("astrocart.overlay.localSpaceOpposition"),
      natalLayer: t("astrocart.overlay.natalLayer"),
      transitLayer: t("astrocart.overlay.transitLayer"),
      progressionLayer: t("astrocart.overlay.progressionLayer"),
      techniqueLabels: Object.fromEntries(
        ASTROCART_DYNAMIC_TECHNIQUE_IDS.map((technique) => [
          technique,
          t(`astrocart.dynamic.${technique}`),
        ]),
      ),
      pointLabels,
      aspectLabels: Object.fromEntries(ASTROCART_ASPECT_IDS.flatMap((aspectId) => {
        const labelKey = `optmenu.${aspectId}`;
        const label = t(labelKey);
        return [
          [aspectId, label],
          [labelKey, label],
        ];
      })),
    };
    const labelsSignature = `${mapInstanceKey}:${JSON.stringify(labels)}`;
    if (lastUiLabelsSignatureRef.current === labelsSignature) return;
    lastUiLabelsSignatureRef.current = labelsSignature;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "aries.setUiLabels",
        labels,
      },
      "*",
    );
  }, [active, astrocartLabelRevision, iframeReady, mapInstanceKey, t, tf]);

  React.useEffect(() => {
    if (!active || !iframeReady || !url || viewStateReadyFor === viewStateKey) return;
    const controller = new AbortController();
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return;
    const intentRevision = viewStateIntentRevisionRef.current;
    targetWindow.postMessage(
      { type: "aries.setStatePersistence", enabled: false },
      "*",
    );
    fetchAstrocartViewState(documentId, controller.signal)
      .then((viewState) => {
        if (controller.signal.aborted || iframeRef.current?.contentWindow !== targetWindow) return;
        // An explicit map-chrome click made while this quiet restore was in
        // flight wins over its older snapshot.
        if (viewStateIntentRevisionRef.current !== intentRevision) {
          setViewStateReadyFor(viewStateKey);
          return;
        }
        const restoredViewState = viewState ? {
          ...viewState,
          overlays: {
            ...(viewState.overlays ?? {}),
            filters: {
              ...(viewState.overlays?.filters ?? {}),
              techniques: null,
            },
          },
        } : null;
        latestViewStateRef.current = restoredViewState;
        setNatalLayerVisible(
          restoredViewState?.overlays?.layers?.natal ?? true,
        );
        const restoredModes = normalizeAstrocartLineModes(restoredViewState?.lineModes);
        activeLineModesRef.current = restoredModes;
        setLineModes(restoredModes);
        if (restoredViewState) {
          targetWindow.postMessage(
            { type: "aries.applyState", state: restoredViewState },
            "*",
          );
        }
        setViewStateReadyFor(viewStateKey);
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        console.error("[acg-view-state]", err);
        const retainedState = latestViewStateRef.current;
        const fallbackModes = retainedState
          ? [...activeLineModesRef.current]
          : [...ASTROCART_DEFAULT_LINE_MODES];
        activeLineModesRef.current = fallbackModes;
        setLineModes(fallbackModes);
        setNatalLayerVisible((current) => retainedState ? current : true);
        setViewStateReadyFor(viewStateKey);
      });
    return () => controller.abort();
  }, [active, documentId, iframeReady, url, viewStateKey, viewStateReadyFor]);

  React.useEffect(() => {
    if (!active || !viewStateReady || !canonicalAstrocartSpecRef.current) return;
    applyAstrocartSpecVisibility(canonicalAstrocartSpecRef.current, true);
  }, [active, applyAstrocartSpecVisibility, viewStateReady]);

  React.useEffect(() => {
    if (!active || !iframeReady || !url) return;
    const styleKey = `${mapInstanceKey}:${displayStyleRevision}:${themeStyleKey}`;
    if (completedDisplayStyleKeyRef.current === styleKey) return;
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return;
    const controller = new AbortController();
    displayStyleRequestRef.current = controller;
    daemonFetch(
      `${daemonBaseUrl()}/api/workspace/document/${encodeURIComponent(documentId)}/astrocart/style`,
      { cache: "no-store", signal: controller.signal },
    )
      .then((response) => {
        if (!response.ok) throw new Error(`astrocart style fetch failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (controller.signal.aborted || iframeRef.current?.contentWindow !== targetWindow) return;
        const styleMessage = createAstrocartStyleMessage(payload);
        // A request that crossed a preset transition must not install the
        // previous full renderer after the new direct light/dark paint.
        if (styleMessage.payload.mode !== bootTheme) return;
        latestDisplayStyleRef.current = styleMessage.payload;
        targetWindow.postMessage(styleMessage, "*");
        completedDisplayStyleKeyRef.current = styleKey;
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        console.error("[acg-style]", err);
      });
    return () => {
      controller.abort();
      if (displayStyleRequestRef.current === controller) {
        displayStyleRequestRef.current = null;
      }
    };
  }, [active, bootTheme, displayStyleRevision, documentId, iframeReady, mapInstanceKey, themeStyleKey, url]);

  React.useEffect(() => {
    if (!active || !viewStateReady) return;
    const asterismKey = `${mapInstanceKey}:${sessionRevision}:${referenceGeometryRevision}`;
    if (completedAsterismKeyRef.current === asterismKey) return;
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return;
    const cached = asterismDataCacheRef.current;
    if (
      cached?.documentId === documentId &&
      cached.sessionRevision === sessionRevision &&
      cached.referenceGeometryRevision === referenceGeometryRevision
    ) {
      targetWindow.postMessage({ type: "aries.setAsterismData", payload: cached.payload }, "*");
      completedAsterismKeyRef.current = asterismKey;
      return;
    }

    const controller = new AbortController();
    void (async () => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await daemonFetch(
            `${daemonBaseUrl()}/api/workspace/document/${encodeURIComponent(documentId)}/astrocart/asterisms`,
            { cache: "no-store", signal: controller.signal },
          );
          if (!response.ok) {
            throw new Error(`astrocart asterisms fetch failed: ${response.status}`);
          }
          const payload = await response.json() as unknown;
          if (controller.signal.aborted || iframeRef.current?.contentWindow !== targetWindow) return;
          asterismDataCacheRef.current = {
            documentId,
            sessionRevision,
            referenceGeometryRevision,
            payload,
          };
          targetWindow.postMessage({ type: "aries.setAsterismData", payload }, "*");
          completedAsterismKeyRef.current = asterismKey;
          return;
        } catch (err) {
          if (isAbortError(err, controller.signal)) return;
          lastError = err;
          if (attempt < 2) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 120 * (attempt + 1));
            });
            if (controller.signal.aborted) return;
          }
        }
      }
      console.error("[acg-asterisms]", lastError);
    })();
    return () => controller.abort();
  }, [
    active,
    documentId,
    mapInstanceKey,
    referenceGeometryRevision,
    sessionRevision,
    viewStateReady,
  ]);

  const persistViewState = React.useCallback((
    state: AstrocartViewState,
    immediate = false,
    scope: AstrocartViewStateScope = "all",
  ) => {
    latestViewStateRef.current = state;
    const pendingTimer = saveViewStateTimerRefs.current[scope];
    if (pendingTimer != null) {
      window.clearTimeout(pendingTimer);
      saveViewStateTimerRefs.current[scope] = null;
    }
    const save = () => {
      saveViewStateTimerRefs.current[scope] = null;
      const current = latestViewStateRef.current;
      if (!current) return;
      void storeAstrocartViewState(documentId, current, scope).catch((err) => {
        console.error("[acg-view-state]", err);
      });
    };
    if (immediate) {
      save();
      return;
    }
    saveViewStateTimerRefs.current[scope] = window.setTimeout(save, 240);
  }, [documentId]);

  const applyAstrocartLineModes = React.useCallback((
    nextModes: AstrocartLineMode[],
  ) => {
    const currentModes = activeLineModesRef.current;
    if (
      currentModes.length === nextModes.length &&
      nextModes.every((mode, index) => currentModes[index] === mode)
    ) {
      return;
    }
    for (const [requestedMode, request] of modeDataRequestsRef.current) {
      if (nextModes.includes(requestedMode)) continue;
      request.controller.abort();
      modeDataRequestsRef.current.delete(requestedMode);
    }
    if (nextModes.length > 0) {
      emptyMetaRequestRef.current?.controller.abort();
      emptyMetaRequestRef.current = null;
    }
    activeLineModesRef.current = nextModes;
    setLineModes(nextModes);
    viewStateIntentRevisionRef.current += 1;
    setViewStateReadyFor(viewStateKey);
    persistViewState(
      { ...(latestViewStateRef.current ?? {}), lineModes: nextModes },
      true,
      "global",
    );
  }, [persistViewState, viewStateKey]);

  const handleLineModeClick = React.useCallback((
    mode: AstrocartLineMode,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    applyAstrocartLineModes(
      toggleAstrocartLineMode(lineModes, mode, event.metaKey),
    );
  }, [applyAstrocartLineModes, lineModes]);

  const handleAstrocartNatalLayerVisibility = React.useCallback((
    natal: boolean,
  ) => {
    const current = latestViewStateRef.current ?? {};
    const overlays = current.overlays ?? {};
    const nextViewState: AstrocartViewState = {
      ...current,
      overlays: {
        ...overlays,
        layers: {
          ...(overlays.layers ?? {}),
          natal,
        },
      },
    };
    latestViewStateRef.current = nextViewState;
    setNatalLayerVisible(natal);
    viewStateIntentRevisionRef.current += 1;
    setViewStateReadyFor(viewStateKey);
    lastVisibilitySignatureRef.current = null;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "aries.setVisibilityFilters",
        filters: { layers: { natal } },
      },
      "*",
    );
    persistViewState(nextViewState, true, "global");
  }, [persistViewState, viewStateKey]);

  const handleAstrocartStandardViewReset = React.useCallback(() => {
    const standardModes = [...ASTROCART_DEFAULT_LINE_MODES];
    for (const [requestedMode, request] of modeDataRequestsRef.current) {
      if (standardModes.includes(requestedMode)) continue;
      request.controller.abort();
      modeDataRequestsRef.current.delete(requestedMode);
    }
    const current = latestViewStateRef.current ?? {};
    const nextViewState: AstrocartViewState = {
      ...current,
      projection: "globe",
      lineModes: standardModes,
      overlays: {
        ...(current.overlays ?? {}),
        parans: false,
        asterisms: false,
        aspects: false,
        zeniths: false,
        localSpaceOppositions: false,
        layers: {
          natal: true,
          transit: false,
          progression: false,
        },
        filters: {
          points: null,
          kinds: null,
          aspects: null,
          techniques: null,
        },
      },
      legend: {
        collapsed: true,
        userSet: false,
      },
    };
    activeLineModesRef.current = standardModes;
    latestViewStateRef.current = nextViewState;
    setLineModes(standardModes);
    setNatalLayerVisible(true);
    viewStateIntentRevisionRef.current += 1;
    setViewStateReadyFor(viewStateKey);
    lastVisibilitySignatureRef.current = null;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "aries.applyState", state: nextViewState },
      "*",
    );
    persistViewState(nextViewState, true, "all");
  }, [persistViewState, viewStateKey]);

  const handleAstrocartMapViewReset = React.useCallback(() => {
    if (!active || !viewStateReady) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "aries.resetView" },
      "*",
    );
  }, [active, viewStateReady]);

  React.useEffect(() => {
    const timerRefs = saveViewStateTimerRefs.current;
    return () => {
      for (const scope of ["camera", "global", "all"] as const) {
        const timer = timerRefs[scope];
        if (timer == null) continue;
        window.clearTimeout(timer);
        timerRefs[scope] = null;
      }
      const current = latestViewStateRef.current;
      if (current) {
        void storeAstrocartViewState(documentId, current, "camera")
          .catch(() => undefined);
      }
    };
  }, [documentId]);

  const pushCachedModeData = React.useCallback(() => {
    const context = activeDataContextRef.current;
    const targetWindow = iframeRef.current?.contentWindow;
    if (!mapHostActiveRef.current || !context || !targetWindow) return;

    const emptyModeEntry =
      context.lineModes.length === 0 &&
      emptyModeDataCacheRef.current?.sessionRevision === context.sessionRevision &&
      emptyModeDataCacheRef.current.configurationRevision ===
        context.configurationRevision
        ? emptyModeDataCacheRef.current
        : null;
    let fallbackMeta =
      emptyModeEntry?.payload.meta ??
      (
        astrocartMetaCacheRef.current?.sessionRevision === context.sessionRevision &&
        astrocartMetaCacheRef.current.configurationRevision ===
          context.configurationRevision
          ? astrocartMetaCacheRef.current.meta
          : undefined
      );
    if (!fallbackMeta) {
      for (const [mode, entry] of modeDataCacheRef.current) {
        const expectedModeSpecKey = astrocartModeSpecKey(
          context.modeSpecKeys,
          mode,
        );
        if (
          entry.sessionRevision === context.sessionRevision &&
          (
            expectedModeSpecKey == null ||
            entry.modeSpecKey === expectedModeSpecKey
          ) &&
          entry.payload.meta
        ) {
          fallbackMeta = entry.payload.meta;
          break;
        }
      }
    }
    const composed = composeAstrocartModePayload(
      context.lineModes,
      context.sessionRevision,
      context.modeSpecKeys,
      modeDataCacheRef.current,
      fallbackMeta,
      astrocartConfigurationRef.current,
      emptyModeEntry?.payload,
    );
    const readyForRevision = composed.complete && (
      context.lineModes.length > 0 || emptyModeEntry != null
    );
    const previousGeneration = lastRenderedDataGenerationRef.current;
    if (
      !readyForRevision &&
      previousGeneration != null &&
      previousGeneration !== context.dataGenerationKey
    ) {
      // A session/spec rebuild keeps its previous coherent map until all
      // selected previews are ready. Removing a mode can reuse the remaining
      // independent caches immediately; adding one waits for that preview.
      setLinesPushedFor(null);
      return;
    }

    const dataSignature = [
      context.dataGenerationKey,
      ...context.lineModes.map((mode) => {
        const entry = modeDataCacheRef.current.get(mode);
        return `${mode}:${entry?.precision ?? "missing"}`;
      }),
      context.lineModes.length === 0
        ? `dynamic-only:${emptyModeEntry?.precision ?? "missing"}`
        : "",
    ].join("|");
    if (lastRenderedDataSignatureRef.current === dataSignature) {
      setLinesPushedFor(readyForRevision ? context.dataGenerationKey : null);
      return;
    }

    const meta = composed.payload.meta;
    // Line payloads are geometry snapshots and can finish out of order (Local
    // Space is intentionally independent). Theme ownership stays with the live
    // theme store + display-style endpoint so stale geometry cannot roll it back.
    targetWindow.postMessage({ type: "aries.setData", payload: composed.payload }, "*");
    if (latestDisplayStyleRef.current) {
      targetWindow.postMessage(
        { type: "aries.setDisplayStyle", payload: latestDisplayStyleRef.current },
        "*",
      );
    }
    const savedCenter = latestViewStateRef.current?.center;
    const hasSavedCenter = typeof savedCenter?.lng === "number" && typeof savedCenter.lat === "number";
    if (
      !initialCenterAppliedRef.current &&
      !hasSavedCenter &&
      typeof meta?.lat === "number" &&
      typeof meta.lon === "number"
    ) {
      targetWindow.postMessage({ type: "aries.setCenter", lat: meta.lat, lon: meta.lon }, "*");
      initialCenterAppliedRef.current = true;
    }
    targetWindow.postMessage({ type: "aries.setStatePersistence", enabled: true }, "*");
    lastRenderedDataGenerationRef.current = context.dataGenerationKey;
    lastRenderedDataSignatureRef.current = dataSignature;
    setLinesPushedFor(readyForRevision ? context.dataGenerationKey : null);
  }, []);

  React.useEffect(() => {
    if (!active || !viewStateReady) return;
    pushCachedModeData();

    const payloadMatchesCurrentSpec = (
      payload: AstrocartGeoJsonPayload,
      mode: AstrocartLineMode | null = null,
    ): boolean => {
      if (mode) {
        const expectedModeSpecKey = astrocartModeSpecKey(
          modeSpecKeysRef.current,
          mode,
        );
        const receivedModeSpecKey = payload.meta?.modeSpecKey;
        if (
          expectedModeSpecKey != null &&
          typeof receivedModeSpecKey === "string"
        ) {
          return expectedModeSpecKey === receivedModeSpecKey;
        }
      }
      const expected = astrocartConfigurationRef.current?.specKey;
      const received = payload.meta?.specKey;
      return (
        typeof expected !== "string" ||
        typeof received !== "string" ||
        expected === received
      );
    };

    const ensureModeData = (mode: AstrocartLineMode) => {
      const expectedModeSpecKey = astrocartModeSpecKey(
        modeSpecKeysRef.current,
        mode,
      );
      const cached = modeDataCacheRef.current.get(mode);
      if (
        cached?.sessionRevision === sessionRevision &&
        (
          expectedModeSpecKey == null ||
          cached.modeSpecKey === expectedModeSpecKey
        ) &&
        cached.precision === ASTROCART_RETAINED_TERMINAL_PRECISION
      ) return;
      const existing = modeDataRequestsRef.current.get(mode);
      if (
        existing?.sessionRevision === sessionRevision &&
        (
          expectedModeSpecKey == null ||
          existing.modeSpecKey == null ||
          existing.modeSpecKey === expectedModeSpecKey
        )
      ) return;
      existing?.controller.abort();

      const request: AstrocartModeRequest = {
        sessionRevision,
        modeSpecKey: expectedModeSpecKey,
        controller: new AbortController(),
      };
      modeDataRequestsRef.current.set(mode, request);
      const requestIsCurrent = () => {
        const currentModeSpecKey = astrocartModeSpecKey(
          modeSpecKeysRef.current,
          mode,
        );
        return (
          !request.controller.signal.aborted &&
          modeDataRequestsRef.current.get(mode) === request &&
          mapHostActiveRef.current &&
          activeDataContextRef.current?.sessionRevision === sessionRevision &&
          (
            request.modeSpecKey == null ||
            currentModeSpecKey == null ||
            request.modeSpecKey === currentModeSpecKey
          )
        );
      };
      const responseModeSpecKey = (
        payload: AstrocartGeoJsonPayload,
      ): string | null => {
        const value = payload.meta?.modeSpecKey;
        return typeof value === "string" && value.length > 0
          ? value
          : request.modeSpecKey;
      };

      void (async () => {
        try {
          let entry = modeDataCacheRef.current.get(mode);
          if (
            !entry ||
            entry.sessionRevision !== sessionRevision ||
            (
              expectedModeSpecKey != null &&
              entry.modeSpecKey !== expectedModeSpecKey
            )
          ) {
            const preview = await fetchAstrocartModePayload(
              documentId,
              mode,
              "preview",
              request.controller.signal,
            );
            if (!requestIsCurrent() || !payloadMatchesCurrentSpec(preview, mode)) return;
            entry = {
              sessionRevision,
              modeSpecKey: responseModeSpecKey(preview),
              precision: "preview",
              payload: preview,
            };
            modeDataCacheRef.current.set(mode, entry);
            if (preview.meta) {
              astrocartMetaCacheRef.current = {
                sessionRevision,
                configurationRevision,
                meta: preview.meta,
              };
            }
            pushCachedModeData();
          }

          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, ASTROCART_REFINEMENT_DELAY_MS);
          });
          if (!requestIsCurrent()) return;
          if (!activeDataContextRef.current?.lineModes.includes(mode)) return;
          const interactive = await fetchAstrocartModePayload(
            documentId,
            mode,
            ASTROCART_RETAINED_TERMINAL_PRECISION,
            request.controller.signal,
          );
          if (
            !requestIsCurrent() ||
            !payloadMatchesCurrentSpec(interactive, mode)
          ) return;
          modeDataCacheRef.current.set(mode, {
            sessionRevision,
            modeSpecKey: responseModeSpecKey(interactive),
            precision: ASTROCART_RETAINED_TERMINAL_PRECISION,
            payload: interactive,
          });
          if (interactive.meta) {
            astrocartMetaCacheRef.current = {
              sessionRevision,
              configurationRevision,
              meta: interactive.meta,
            };
          }
          pushCachedModeData();
        } catch (err) {
          if (isAbortError(err, request.controller.signal)) return;
          console.error(`[acg:${mode}]`, err);
        } finally {
          if (modeDataRequestsRef.current.get(mode) === request) {
            modeDataRequestsRef.current.delete(mode);
          }
        }
      })();
    };

    const ensureEmptyMeta = () => {
      const cached = emptyModeDataCacheRef.current;
      if (
        cached?.sessionRevision === sessionRevision &&
        cached.configurationRevision === configurationRevision &&
        cached.precision === ASTROCART_RETAINED_TERMINAL_PRECISION
      ) return;
      const existing = emptyMetaRequestRef.current;
      if (
        existing?.sessionRevision === sessionRevision &&
        existing.configurationRevision === configurationRevision
      ) return;
      existing?.controller.abort();
      const request: AstrocartMetaRequest = {
        sessionRevision,
        configurationRevision,
        controller: new AbortController(),
      };
      emptyMetaRequestRef.current = request;
      const requestIsCurrent = () => (
        !request.controller.signal.aborted &&
        mapHostActiveRef.current &&
        emptyMetaRequestRef.current === request &&
        activeDataContextRef.current?.sessionRevision === sessionRevision &&
        activeDataContextRef.current.configurationRevision ===
          configurationRevision &&
        activeDataContextRef.current.lineModes.length === 0
      );
      void (async () => {
        try {
          let entry = emptyModeDataCacheRef.current;
          if (
            !entry ||
            entry.sessionRevision !== sessionRevision ||
            entry.configurationRevision !== configurationRevision
          ) {
            const preview = await fetchAstrocartModePayload(
              documentId,
              null,
              "preview",
              request.controller.signal,
            );
            if (!requestIsCurrent() || !payloadMatchesCurrentSpec(preview)) return;
            entry = {
              sessionRevision,
              configurationRevision,
              precision: "preview",
              payload: preview,
            };
            emptyModeDataCacheRef.current = entry;
            if (preview.meta) {
              astrocartMetaCacheRef.current = {
                sessionRevision,
                configurationRevision,
                meta: preview.meta,
              };
            }
            pushCachedModeData();
          }

          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, ASTROCART_REFINEMENT_DELAY_MS);
          });
          if (!requestIsCurrent()) return;
          const interactive = await fetchAstrocartModePayload(
            documentId,
            null,
            ASTROCART_RETAINED_TERMINAL_PRECISION,
            request.controller.signal,
          );
          if (
            !requestIsCurrent() ||
            !payloadMatchesCurrentSpec(interactive)
          ) return;
          emptyModeDataCacheRef.current = {
            sessionRevision,
            configurationRevision,
            precision: ASTROCART_RETAINED_TERMINAL_PRECISION,
            payload: interactive,
          };
          if (interactive.meta) {
            astrocartMetaCacheRef.current = {
              sessionRevision,
              configurationRevision,
              meta: interactive.meta,
            };
          }
          pushCachedModeData();
        } catch (err) {
          if (isAbortError(err, request.controller.signal)) return;
          console.error("[acg:dynamic-only]", err);
        } finally {
          if (emptyMetaRequestRef.current === request) emptyMetaRequestRef.current = null;
        }
      })();
    };

    if (lineModes.length === 0) ensureEmptyMeta();
    for (const mode of lineModes) ensureModeData(mode);
  }, [
    active,
    configurationRevision,
    dataGenerationKey,
    documentId,
    lineModes,
    pushCachedModeData,
    sessionRevision,
    viewStateReady,
  ]);

  // Eclipse shadow-path overlay — fetch the daemon-computed GeoJSON
  // (eclipsepath.build_solar_eclipse_path_geojson via /api/astrocart/
  // eclipse-path) and push it through the postMessage twin of wx's
  // RunScript setEclipseData (astrocartframe.py:442-456). map.html owns the
  // shadow/fill/limits/center/max layers and fits a newly opened eclipse once.
  // ACG line-mode changes reuse that eclipse payload and preserve the camera.
  React.useEffect(() => {
    if (!active || !iframeReady || !linesPushed || !eclipseEvent) return;
    const eclipseKey = `${mapInstanceKey}:${eclipseEvent.jdUt}:${eclipseEvent.retflag ?? 0}`;
    if (completedEclipseKeyRef.current === eclipseKey) return;
    const controller = new AbortController();
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return;
    const search = new URLSearchParams({
      jd: String(eclipseEvent.jdUt),
      retflag: String(eclipseEvent.retflag ?? 0),
    });
    daemonFetch(`${daemonBaseUrl()}/api/astrocart/eclipse-path?${search.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`eclipse path fetch failed: ${r.status}`);
        return r.json();
      })
      .then((geojson) => {
        if (controller.signal.aborted || iframeRef.current?.contentWindow !== targetWindow) return;
        targetWindow.postMessage({ type: "aries.setEclipseData", payload: geojson }, "*");
        completedEclipseKeyRef.current = eclipseKey;
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        console.error("[acg-eclipse]", err);
      });
    return () => controller.abort();
  }, [active, eclipseEvent, iframeReady, linesPushed, mapInstanceKey]);

  // Right-click "here" actions. map.html's #acg-menu posts outbound intents up
  // to this parent ({source:'aries-acg', payload:{type:'here', action, lon,
  // lat, placeName}}) — the iframe twin of wx's morinus://acg/ navigation
  // bridge (astrocartframe.py:534). The four 'here' actions route to the daemon
  // (workspaceAstrocartHere -> on_astrocart_here_request parity), then we
  // activate the new child document so it opens focused like every other
  // launcher (relocation/solar_return/transit open a child; set_pob mutates the
  // radix in place while this retained map stays active and refreshes from the
  // daemon's session.changed event). Shortcut payloads re-enter the canonical
  // manifest dispatcher so iframe focus does not create a second key model;
  // line-click payloads remain deferred.
  React.useEffect(() => {
    function onMessage(event: MessageEvent) {
      const win = iframeRef.current?.contentWindow;
      // Only trust messages from THIS map iframe's window.
      if (!win || event.source !== win) return;
      const data = event.data as
        | {
            source?: string;
            payload?: {
              type?: string;
              action?: string;
              lon?: number;
              lat?: number;
              placeName?: string;
              state?: AstrocartViewState;
              reason?: string;
              eventType?: "keydown" | "keyup";
              key?: string;
              metaKey?: boolean;
              ctrlKey?: boolean;
              altKey?: boolean;
              repeat?: boolean;
              requestId?: string;
              ok?: boolean;
              atlas?: AstrocartPrintAtlas;
            };
          }
        | undefined;
      if (!data || data.source !== "aries-acg") return;
      const payload = data.payload;
      if (!payload) return;
      if (payload.type === "print-atlas" && payload.requestId) {
        const atlas = payload.ok === true &&
          Array.isArray(payload.atlas?.pages) &&
          payload.atlas.pages.length >= 2 &&
          payload.atlas.pages.every((page) =>
            typeof page.dataUrl === "string" &&
            page.dataUrl.startsWith("data:image/png;base64,") &&
            page.containsAstrology === true
          )
          ? payload.atlas
          : null;
        settlePrintAtlasRequest(payload.requestId, atlas);
        return;
      }
      if (payload.type === "ambient-key") {
        window.dispatchEvent(
          new CustomEvent("aries://embedded-ambient-key", { detail: payload }),
        );
        return;
      }
      if (payload.type === "shortcut") {
        window.dispatchEvent(
          new CustomEvent(EMBEDDED_MANIFEST_SHORTCUT_EVENT, {
            detail: payload,
          }),
        );
        return;
      }
      if (payload.type === "perf") {
        console.info("[acg-perf]", payload.reason ?? "snapshot", payload.state);
        return;
      }
      if (payload.type === "ready") {
        if (url) setReadyUrl(url);
        const canonicalSpec = canonicalAstrocartSpecRef.current;
        if (mapHostActiveRef.current && canonicalSpec) {
          // The child emits ready only after MapLibre replays any queued
          // applyState payload. Reassert canonical spec visibility here so a
          // stale retained overlay snapshot can never win that final race.
          applyAstrocartSpecVisibility(canonicalSpec, true);
        }
        return;
      }
      if (payload.type === "presented") {
        if (url) setPresentedMapUrl(url);
        return;
      }
      if (payload.type === "state" && payload.state) {
        const reason = payload.reason ?? "state";
        const scope: AstrocartViewStateScope =
          reason === "moveend" || reason === "reset-view"
            ? "camera"
            : (
              reason === "projection" ||
              reason === "legend" ||
              reason === "overlay-parans" ||
              reason === "overlay-asterisms"
            )
              ? "global"
              : "all";
        if (!active && scope !== "global") return;
        const nextViewState: AstrocartViewState = {
          ...payload.state,
          lineModes: activeLineModesRef.current,
        };
        if (scope === "global") {
          viewStateIntentRevisionRef.current += 1;
          // Explicit chrome intent can arrive during first restore. It already
          // painted in the child, so let it become the current retained state
          // instead of waiting for an older GET to finish.
          if (active) setViewStateReadyFor(viewStateKey);
        }
        persistViewState(nextViewState, scope === "global", scope);
        if (
          reason === "overlay-parans" &&
          typeof payload.state.overlays?.parans === "boolean"
        ) {
          queueAstrocartParanIntent(payload.state.overlays.parans);
        }
        if (active) {
          setNatalLayerVisible((current) =>
            payload.state?.overlays?.layers?.natal ?? current
          );
        }
        return;
      }
      if (payload.type !== "here") return;
      const action = payload.action as AstrocartHereAction | undefined;
      if (
        action !== "relocation" &&
        action !== "solar_return" &&
        action !== "transit" &&
        action !== "set_pob"
      ) {
        return;
      }
      if (typeof payload.lon !== "number" || typeof payload.lat !== "number") return;
      void workspaceAstrocartHere(
        documentId,
        action,
        payload.lon,
        payload.lat,
        payload.placeName ?? "",
      )
        .then((res) => {
          if (action === "set_pob") {
            return;
          }
          if (res.documentId) void workspaceActivate(res.documentId);
        })
        .catch((err) => console.error("[acg-here]", err));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    active,
    applyAstrocartSpecVisibility,
    documentId,
    persistViewState,
    queueAstrocartParanIntent,
    settlePrintAtlasRequest,
    url,
    viewStateKey,
  ]);

  return (
    <div
      className={cn(
        "right-pane-split relative grid flex-1 min-h-0 bg-transparent",
        controlsPaneTrack.transitioning &&
          "transition-[grid-template-columns] duration-[var(--aries-motion-shell-duration)] ease-[var(--aries-motion-shell-ease)]",
      )}
      onTransitionEnd={controlsPaneTrack.onTransitionEnd}
      style={{
        "--right-pane-width": `${controlsPaneTrack.width}px`,
        gridTemplateColumns: controlsPaneTrack.open
          ? "minmax(0, 1fr) min(var(--right-pane-width), 50vw)"
          : "minmax(0, 1fr) 0px",
      } as React.CSSProperties}
    >
      <div className="relative min-w-0 overflow-hidden bg-background">
        {url ? (
          <iframe
            key={url}
            ref={iframeRef}
            src={url}
            title={t("toolbar.astrocartography")}
            className="h-full w-full border-0 bg-background"
            style={{ backgroundColor: "var(--background, #232428)" }}
            onLoad={() => {
              setPresentedMapUrl(null);
              setIframeLoadRevision((revision) => revision + 1);
              iframeRef.current?.contentWindow?.postMessage(
                { type: "aries.getReady" },
                "*",
              );
            }}
          />
        ) : null}
        {url && presentedMapUrl !== url ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 bg-background"
          />
        ) : null}
        <div
          className={cn(
            LIST_PANE_CLASSES.segmented,
            "absolute bottom-[var(--aries-pane-title-gap)] left-1/2 z-20 -translate-x-1/2 bg-background text-[length:var(--aries-font-size-small)]",
          )}
          role="group"
          aria-label={t("toolbar.astrocartLineMode")}
        >
          {ASTROCART_LINE_MODES.map((mode) => {
            const selected = lineModes.includes(mode.id);
            return (
              <button
                key={mode.id}
                type="button"
                title={t(`astrocart.mode.${mode.id}.title`)}
                aria-pressed={selected}
                onClick={(event) => handleLineModeClick(mode.id, event)}
                className={cn(
                  LIST_PANE_CLASSES.segmentedButton,
                  "min-w-[var(--aries-segmented-control-item-min-width)] text-xs",
                  selected
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t(`astrocart.mode.${mode.id}.label`)}
              </button>
            );
          })}
          <span aria-hidden className="mx-0.5 h-4 w-px self-center bg-border" />
          <button
            type="button"
            aria-label={t("astrocart.config.open")}
            title={t("astrocart.config.open")}
            aria-pressed={controlsOpen}
            onClick={() => {
              if (controlsOpen) {
                closeAstrocartControlsPane();
              } else {
                openAstrocartControlsPane({ documentId });
              }
            }}
            className={cn(
              LIST_PANE_CLASSES.segmentedButton,
              "flex w-[var(--aries-control-height-compact)] items-center justify-center px-0",
              controlsOpen
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <SlidersHorizontal aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      {controlsOpen ? (
        <RightPaneSash
          width={effectiveControlsPaneWidth}
          minWidth={controlsPanePolicy.minContentWidth}
          onResizeStart={controlsPaneTrack.stopTransition}
          onCollapse={closeAstrocartControlsPane}
        />
      ) : null}
      <aside
        hidden={!controlsOpen}
        aria-hidden={!controlsOpen}
        data-aries-surface="panel"
        data-right-pane-module="astrocart-controls"
        data-right-pane-role={controlsPanePolicy.role}
        className="box-border min-w-0 overflow-hidden border-l border-[color:var(--aries-titlebar-seam-rule)] bg-[var(--aries-panel-background)] pt-[var(--titlebar-pane-pad-top)] text-[color:var(--aries-panel-text)] [&>*]:bg-transparent"
        style={
          {
            "--right-pane-min-content-width": `${controlsPanePolicy.minContentWidth}px`,
            "--right-pane-preferred-width": `${controlsPanePolicy.preferredWidth}px`,
          } as React.CSSProperties
        }
      >
        <AstrocartControls
          documentId={documentId}
          active={active}
          visible={controlsOpen}
          catalogRevision={catalogRevision}
          optionsRevision={lastOptionsChange?.seq ?? 0}
          paranIntent={paranIntent}
          lineModes={lineModes}
          natalLayerVisible={natalLayerVisible}
          mapViewReady={viewStateReady}
          onClose={closeAstrocartControlsPane}
          onMapViewReset={handleAstrocartMapViewReset}
          onPreviewChange={handleAstrocartConfigurationPreview}
          onCanonicalChange={handleAstrocartConfigurationChange}
          onNatalLayerVisibilityChange={handleAstrocartNatalLayerVisibility}
          onStandardViewReset={handleAstrocartStandardViewReset}
          onRequestPrintAtlas={requestPrintAtlas}
        />
      </aside>
    </div>
  );
});

/**
 * The single unified macOS-style title bar — one full-width overlay holding the
 * window controls + the chart title, with the native traffic lights overlaid on
 * its left (Tauri `titleBarStyle: "Overlay"`). This matches the wx desktop's
 * unified titlebar and the standard modern desktop-app pattern: lights · sidebar
 * toggle · centred "Name · Kind · datetime · Age" · edit/inspector/notes. The
 * bar floats over the app grid, spanning sidebar + content. The shadcn sidebar
 * interior is padded below that compact plane in CSS.
 * `data-tauri-drag-region` makes the empty areas drag the window; the buttons
 * stay clickable. In a plain browser there are no lights — it's just the header.
 */
export function UnifiedTitleBar({
  chart,
  activeDoc,
  manifest,
  overlay = false,
  onOpenSettings,
  onOpenStyleLab,
  onMenuCommand,
  isMenuCommandEnabled,
  canCopyChart = false,
  onCopyChart,
}: {
  chart: ChartRenderSnapshot | null;
  activeDoc: WorkspaceDocument | null;
  manifest: WorkspaceManifest | null;
  // Full-bleed surfaces (astrocart map) want the title controls floating over
  // the content with no opaque bar — the wx WebView panel fills under the title
  // region (astrocartframe._titlebar_safe_top) and shows no separate bar. When
  // overlay, the bar is absolutely positioned, its shell background is dropped,
  // and the centred title text is hidden (only the traffic-light drag
  // region + control buttons remain over the map).
  overlay?: boolean;
  onOpenSettings?: (tab?: SettingsTabId) => void;
  onOpenStyleLab?: () => void;
  onMenuCommand: (command: string) => void;
  isMenuCommandEnabled: (command: string) => boolean;
  canCopyChart?: boolean;
  onCopyChart?: () => void | Promise<boolean>;
}) {
  const toggleSidebar = useFrameLayoutStore((s) => s.toggleSidebar);
  const sidebarOpen = useFrameLayoutStore((s) => s.sidebarOpen);
  const toggleInspector = useFrameLayoutStore((s) => s.toggleInspector);
  const inspectorOpen = useFrameLayoutStore((s) => s.inspectorOpen);
  const toggleNotesPane = useFrameLayoutStore((s) => s.toggleNotesPane);
  const notesPaneOpen = useFrameLayoutStore((s) => s.notesPaneOpen);
  const requestEditChart = useWorkspaceStore((s) => s.requestEditChart);
  const transitSearchPane = useWorkspaceStore((s) => s.transitSearchPane);
  const openTransitSearchPane = useWorkspaceStore((s) => s.openTransitSearchPane);
  const closeTransitSearchPane = useWorkspaceStore((s) => s.closeTransitSearchPane);
  const closeAllRightPanes = useWorkspaceStore((s) => s.closeAllRightPanes);
  const captionActionsRef = useRef<HTMLDivElement>(null);
  const t = useT();
  const parts = buildTitleParts(chart, activeDoc, t);
  const transparentBackplate = overlay || isChartBearingSurfaceDocument(activeDoc);
  // Mark the native platform explicitly: macOS reserves the leading traffic
  // lights, while Windows reserves the measured trailing caption controls.
  useLayoutEffect(() => {
    if (!resolveShellHost().capabilities.nativeWindowChrome) return;
    const root = document.documentElement;
    const platform = resolveNativeShellPlatform();
    const captionActions = captionActionsRef.current;
    root.classList.add("is-tauri");
    if (platform) root.classList.add(`is-${platform}`);
    if (platform === "windows") {
      captionActions?.style.setProperty(
        "margin-right",
        `${resolveWindowsCaptionInset()}px`,
      );
    }
    return () => {
      root.classList.remove("is-tauri");
      if (platform) root.classList.remove(`is-${platform}`);
      captionActions?.style.removeProperty("margin-right");
    };
  }, []);
  // The pencil edits the active chart's data (the wx-free twin of the radix
  // context menu's "Edit chart data", morin.py:14813). View-only docs
  // (astrocart/directions/astrolabe) have no editable chart record.
  const canEdit =
    !!activeDoc &&
    activeDoc.kind !== "astrocart" &&
    activeDoc.kind !== "directions" &&
    activeDoc.kind !== "astrolabe" &&
    activeDoc.kind !== "astrolog-sphere" &&
    activeDoc.kind !== "square-chart" &&
    activeDoc.kind !== "mundane-chart" &&
    activeDoc.kind !== "ephemeris" &&
    activeDoc.kind !== "transit-search" &&
    activeDoc.kind !== "ascensional-transits" &&
    activeDoc.kind !== "table";
  const canOpenSearch = canEdit;
  const searchActive = Boolean(
    activeDoc && transitSearchPane?.documentId === activeDoc.id,
  );
  const handleToggleSearchPane = () => {
    if (!activeDoc || !canOpenSearch) return;
    if (searchActive) {
      closeTransitSearchPane();
      return;
    }
    openTransitSearchPane({ documentId: activeDoc.id });
    closeInspectorAndNotes();
  };
  const handleToggleInspector = () => {
    closeAllRightPanes();
    toggleInspector();
  };
  const handleToggleNotesPane = () => {
    closeAllRightPanes();
    toggleNotesPane();
  };
  return (
    <header
      data-tauri-drag-region
      className="absolute inset-x-0 top-0 grid h-[var(--titlebar-h)] select-none grid-cols-[minmax(var(--titlebar-side-min-w),1fr)_minmax(0,2fr)_minmax(var(--titlebar-side-min-w),1fr)] items-center px-[var(--aries-titlebar-padding-x)] text-[color:var(--aries-header-text)]"
    >
      <div
        data-tauri-drag-region
        data-aries-titlebar-backplate=""
        data-aries-surface={transparentBackplate ? undefined : "titlebar"}
        aria-hidden="true"
        className={cn(
          "absolute inset-0 z-[40]",
          transparentBackplate
            ? "bg-transparent"
            : "isolate bg-[var(--aries-titlebar-background)]",
        )}
      />
      {/* On macOS this starts after the native traffic lights; Windows uses the
          default leading inset and reserves its native controls on the right. */}
      <div data-tauri-drag-region className="absolute left-[var(--titlebar-left-controls-x)] top-0 z-[42] flex h-[var(--titlebar-h)] min-w-0 translate-y-[var(--titlebar-content-offset-y)] items-center justify-start gap-[var(--aries-titlebar-cluster-gap)]">
        <HeaderButton label={t("toolbar.toggleSidebar")} onClick={toggleSidebar} pressed={sidebarOpen}>
          <PanelLeft className="size-[var(--morinus-header-icon-size)]" />
        </HeaderButton>
      </div>
      <div
        data-tauri-drag-region
        className="relative z-[42] col-start-2 flex min-w-0 translate-y-[var(--titlebar-content-offset-y)] items-center justify-center px-[var(--aries-titlebar-title-padding-x)] text-[length:var(--aries-font-size-titlebar)] font-normal leading-none tracking-normal text-[color:var(--aries-titlebar-text)]"
      >
        {overlay ? null : (
          <ChartCopyControl
            enabled={canCopyChart && onCopyChart != null}
            onCopy={onCopyChart}
          >
            <TitleText parts={parts} />
          </ChartCopyControl>
        )}
      </div>
      {/* Right cluster — search + edit + right-pane toggles. */}
      <div
        ref={captionActionsRef}
        data-tauri-drag-region
        className="relative z-[42] col-start-3 flex min-w-0 translate-y-[var(--titlebar-content-offset-y)] items-center justify-end gap-[var(--aries-titlebar-cluster-gap)]"
      >
        <TitlebarOptionsMenu
          manifest={manifest}
          onCommand={onMenuCommand}
          isCommandEnabled={isMenuCommandEnabled}
          onOpenStyleLab={onOpenStyleLab}
          onOpenSettings={onOpenSettings}
        />
        {canOpenSearch ? (
          <HeaderButton label={t("toolbar.search")} onClick={handleToggleSearchPane} pressed={searchActive}>
            <Search className="size-[var(--morinus-header-icon-size)]" />
          </HeaderButton>
        ) : null}
        {canEdit ? (
          <HeaderButton label={t("toolbar.editChartData")} onClick={() => requestEditChart(activeDoc)}>
            <Pencil className="size-[var(--morinus-header-icon-size)]" />
          </HeaderButton>
        ) : null}
        {activeDoc?.kind !== "astrocart" ? (
          <>
            <HeaderButton label={t("toolbar.toggleInspector")} onClick={handleToggleInspector} pressed={inspectorOpen}>
              <ScrollText className="size-[var(--morinus-header-icon-size)]" />
            </HeaderButton>
            <HeaderButton label={t("toolbar.toggleNotes")} onClick={handleToggleNotesPane} pressed={notesPaneOpen}>
              <NotebookPen className="size-[var(--morinus-header-icon-size)]" />
            </HeaderButton>
          </>
        ) : null}
      </div>
    </header>
  );
}

type TitlePart = string | { text: string; glyph?: boolean; title?: string };

function cleanDocumentTitle(doc: WorkspaceDocument | null, t?: TFunc): string {
  return doc ? localizedWorkspaceDocumentTitle(doc, t) : "";
}

export function buildTitleParts(
  chart: ChartRenderSnapshot | null,
  activeDoc: WorkspaceDocument | null,
  t: TFunc,
): TitlePart[] {
  // Astrocart docs have no chart payload — title from the doc itself.
  if (activeDoc?.kind === "astrocart") {
    return [activeDoc.sourceName, t("toolbar.astrocartography")];
  }
  // Primary Directions docs are view-only too — title from the doc itself.
  if (activeDoc?.kind === "directions") {
    return [activeDoc.sourceName, t("toolbar.primaryDirections")];
  }
  // Astrolabe docs are view-only too — title from the doc itself.
  if (activeDoc?.kind === "astrolabe") {
    return [activeDoc.sourceName, t("toolbar.astrolabe")];
  }
  if (activeDoc?.kind === "astrolog-sphere") {
    return [activeDoc.sourceName, t("toolbar.astrologSphere")];
  }
  // Graphic Ephemeris docs are view-only too — title from the doc itself.
  if (activeDoc?.kind === "ephemeris") {
    return [activeDoc.sourceName, t("toolbar.graphicEphemeris")];
  }
  if (activeDoc?.kind === "transit-search") {
    const parts: TitlePart[] = [activeDoc.sourceName];
    if (activeDoc.searchInitialGlyph) {
      parts.push({
        text: activeDoc.searchInitialGlyph,
        glyph: true,
        title: activeDoc.searchInitialLabel,
      });
    } else if (activeDoc.searchInitialLabel) {
      parts.push(activeDoc.searchInitialLabel);
    }
    parts.push(t("toolbar.transitSearch"));
    return parts;
  }
  if (activeDoc?.kind === "table") {
    // Prefer the localized catalog name (table.<id>) over the baked English
    // "<Title> — <source>"; the source already renders as the first part.
    const tableTitle = activeDoc.titleKey ? t(activeDoc.titleKey) : activeDoc.title;
    return [activeDoc.sourceName, tableTitle || t("toolbar.table")];
  }
  if (activeDoc?.kind === "ascensional-transits") {
    return [activeDoc.sourceName, t("toolbar.ascensionalTransits")];
  }
  if (!activeDoc) return [t("toolbar.noChartOpen")];
  if (!chart) return [cleanDocumentTitle(activeDoc, t) || activeDoc.sourceName || t("toolbar.chart")];
  const documentTitle = cleanDocumentTitle(activeDoc, t);
  if (activeDoc.isHorary) {
    const suffix = chart.document?.titleSuffix;
    if (chart.primaryChart.options.showRadixNameInCanvas) {
      return [suffix || t("toolbar.horary")];
    }
    return suffix ? [documentTitle || activeDoc.sourceName || t("toolbar.horary"), suffix] : [documentTitle || t("toolbar.horary")];
  }
  if (activeDoc.launcherKind === "pd_in_chart") {
    const parts: TitlePart[] = [documentTitle || activeDoc.sourceName || t("toolbar.chart")];
    const suffix = chart.document?.titleSuffix ?? supplementaryAnchorLabel(chart, activeDoc);
    if (suffix) parts.push(suffix);
    return parts;
  }
  // Supplementary chart document — daemon session title · daemon date/age
  // suffix. The chart object's name may intentionally remain the radix name
  // (wx event transits do this), so titlebar text must come from the document.
  if (activeDoc?.kind === "supplementary" && activeDoc.supplementaryFeatureKind) {
    const parts: TitlePart[] = [
      documentTitle || t(`supplementary.${activeDoc.supplementaryFeatureKind}`),
    ];
    const suffix = chart.document?.titleSuffix ?? supplementaryAnchorLabel(chart, activeDoc);
    if (suffix) {
      parts.push(suffix);
    }
    return parts;
  }
  if (
    (activeDoc.kind === "radix" || activeDoc.kind === "here-now") &&
    chart.primaryChart.options.showRadixNameInCanvas
  ) {
    const titleParts = chart.primaryChart.meta.titleParts ?? [chart.primaryChart.meta.name];
    return titleParts[0] === chart.primaryChart.meta.name
      ? titleParts.slice(1)
      : titleParts;
  }
  if (!chart.primaryChart.meta.name && documentTitle) {
    const suffix = chart.document?.titleSuffix;
    return suffix ? [documentTitle, suffix] : [documentTitle];
  }
  return chart.primaryChart.meta.titleParts ?? [chart.primaryChart.meta.name];
}

function supplementaryAnchorLabel(
  chart: ChartRenderSnapshot,
  activeDoc: WorkspaceDocument,
): string {
  // For a symbolic-progression child the meaningful anchor is the SIGNIFIED
  // real datetime + age (the desktop title shows Real-date/Age, derived via
  // symbolic_time — morin.py:5562). The daemon ships the prebuilt strings in
  // document.symbolicTime; prefer them so the title reads e.g. "2026-06-04 ·
  // Age 38" instead of the progressed ephemeris date.
  const symbolicTime = chart.document?.symbolicTime ?? null;
  if (symbolicTime) {
    return `${symbolicTime.signifiedDateText} · ${symbolicTime.ageText}`;
  }
  // The anchor label is the daemon-formatted comparison datetime. The daemon
  // ships meta.anchorDisplay (and dateDisplay/timeDisplay); the skin no longer
  // formats an ISO string itself.
  if (isPlainSynastryBiwheel(chart)) {
    return (
      chart.primaryChart.meta.anchorDisplay ??
      `${chart.primaryChart.meta.dateDisplay} ${chart.primaryChart.meta.timeDisplay}`
    );
  }
  if (chart.comparisonChart) {
    return (
      chart.comparisonChart.meta.anchorDisplay ??
      `${chart.comparisonChart.meta.dateDisplay} ${chart.comparisonChart.meta.timeDisplay}`
    );
  }
  return activeDoc.displayDatetime ?? chart.displayDatetime;
}

function isPlainSynastryBiwheel(chart: ChartRenderSnapshot): boolean {
  return chart.document?.compoundKind === "synastry" && Boolean(chart.comparisonChart);
}

type NavigationHintKey = "left" | "right" | "up" | "down";

type NavigationHintGroup = {
  id: string;
  label: string;
  modifiers?: { shift?: boolean; alt?: boolean };
  backwardKey: NavigationHintKey;
  forwardKey: NavigationHintKey;
  backwardLabel: string;
  forwardLabel: string;
};

export type KeyHintPlacement = "top" | "bottom";

export type ModeHintRailProps = {
  visible: boolean;
  placement?: KeyHintPlacement;
  revealToken?: number;
  autoHideMs?: number;
  overlay: boolean;
  hasChart: boolean;
  hasComparisonChart?: boolean;
  parentDocumentId?: string | null;
  comparisonSourceName?: string | null;
  viewMode?: number | null;
  chartVisualMode: WorkspaceDocument["chartVisualMode"] | null | undefined;
  launcherKind: WorkspaceDocument["launcherKind"] | null | undefined;
  compoundKind: WorkspaceDocument["compoundKind"] | null | undefined;
  compositeVariant?: WorkspaceDocument["compositeVariant"] | null;
  kind: WorkspaceDocument["kind"] | null | undefined;
  supplementaryFeatureKind: WorkspaceDocument["supplementaryFeatureKind"] | null | undefined;
  harmonicNumber?: number | null;
  harmonicProjectionMode?: "harmonic" | "varga" | null;
  modeHintLabel?: string | null;
  modeHintTitle?: string | null;
  onToggleModeHint?: () => void;
  onToggleComparison?: () => void;
  onSwitchRelationshipMode?: (variant: "midpoint" | "davison" | "synastry") => void;
  onNavigateHint?: (
    key: NavigationHintKey,
    modifiers?: { shift?: boolean; alt?: boolean },
  ) => void;
  onNavigateHintEnd?: (key: NavigationHintKey) => void;
  onHarmonicNumberChange?: (harmonicNumber: number) => void;
  onHintInteraction?: () => void;
};

const STEP_HINT_HOLD_DELAY_MS = 260;
const STEP_HINT_HOLD_KEEPALIVE_MS = 700;
const STEP_HINT_HOLD_REPEAT_MS = 95;

export const ModeHintRail = React.memo(function ModeHintRail({
  visible,
  placement = "top",
  revealToken = 0,
  autoHideMs = 0,
  overlay,
  hasChart,
  hasComparisonChart,
  parentDocumentId,
  comparisonSourceName,
  viewMode,
  chartVisualMode,
  launcherKind,
  compoundKind,
  compositeVariant,
  kind,
  supplementaryFeatureKind,
  harmonicNumber,
  harmonicProjectionMode,
  modeHintLabel,
  modeHintTitle,
  onToggleModeHint,
  onToggleComparison,
  onSwitchRelationshipMode,
  onNavigateHint,
  onNavigateHintEnd,
  onHarmonicNumberChange,
  onHintInteraction,
}: ModeHintRailProps) {
  const t = useT();
  const [hiddenRevealToken, setHiddenRevealToken] = React.useState<number | null>(null);
  const [pointerInside, setPointerInside] = React.useState(false);
  React.useEffect(() => {
    if (!visible || autoHideMs <= 0 || pointerInside) return;
    const token = revealToken;
    const timer = window.setTimeout(() => setHiddenRevealToken(token), autoHideMs);
    return () => window.clearTimeout(timer);
  }, [autoHideMs, pointerInside, revealToken, visible]);
  const autoVisible = Boolean(
    visible && (pointerInside || autoHideMs <= 0 || hiddenRevealToken !== revealToken),
  );
  const showCustomModeHint = Boolean(hasChart && modeHintLabel && onToggleModeHint);
  const showComparisonModeHint = Boolean(
    hasChart &&
    onToggleComparison &&
    canToggleSingleBiwheel({
      kind,
      parentDocumentId,
      supplementaryFeatureKind,
      comparisonSourceName,
      compoundKind,
      hasComparisonChart,
      viewMode,
    }),
  );
  const showModeHint = showCustomModeHint || showComparisonModeHint;
  const showRelationshipControls = Boolean(
    hasChart &&
    onSwitchRelationshipMode &&
    (compoundKind === "synastry" || compoundKind === "composite_from_synastry"),
  );
  const chartTargetModeLabel = viewMode === 1
    ? t("toolbar.viewSingle")
    : t("toolbar.viewBiwheel");
  const targetModeLabel = showCustomModeHint && modeHintLabel
    ? modeHintLabel
    : chartTargetModeLabel;
  const targetModeTitle = showCustomModeHint
    ? (modeHintTitle ?? targetModeLabel)
    : t("toolbar.switchToView", { mode: targetModeLabel });
  const stepHintGroups = React.useMemo(
    () => navigationHintGroups({
      chartVisualMode,
      launcherKind,
      compoundKind,
      kind,
      supplementaryFeatureKind,
    }, t),
    [chartVisualMode, launcherKind, compoundKind, kind, supplementaryFeatureKind, t],
  );
  const showHarmonicControls = Boolean(
    hasChart &&
    supplementaryFeatureKind === "harmonic" &&
    harmonicNumber != null &&
    onNavigateHint &&
    onHarmonicNumberChange,
  );
  const harmonicHintGroup = React.useMemo(
    () => ({
      ...buildNavigationHintGroup("harmonic", "left", "right", undefined, t),
      label: harmonicProjectionMode === "varga"
        ? t("toolbar.navbar.unit.vargas")
        : t("toolbar.navbar.unit.harmonic"),
    }),
    [harmonicProjectionMode, t],
  );
  const [editingHarmonic, setEditingHarmonic] = React.useState(false);
  const [harmonicDraft, setHarmonicDraft] = React.useState("");
  const commitHarmonicDraft = React.useCallback(() => {
    const parsed = Number(harmonicDraft.trim());
    const allowed = harmonicProjectionMode === "varga"
      ? [1, 2, 3, 4, 7, 9, 10, 12, 16, 20, 24, 27, 30, 40, 45, 60].includes(parsed)
      : Number.isFinite(parsed) && parsed >= 1 && parsed <= 360;
    if (allowed) {
      onHarmonicNumberChange?.(parsed);
    }
    setEditingHarmonic(false);
  }, [harmonicDraft, harmonicProjectionMode, onHarmonicNumberChange]);
  const showNavigationHints = Boolean(
    hasChart && onNavigateHint && (stepHintGroups.length > 0 || showHarmonicControls),
  );
  const active = Boolean(
    autoVisible && !overlay && (showModeHint || showRelationshipControls || showNavigationHints),
  );
  const tooltipSide = placement === "bottom" ? "top" : "bottom";
  const handlePositionSettled = React.useCallback((
    element: HTMLDivElement,
    offset: OverlayOffset,
  ) => {
    setChartNavbarHoverZone(chartNavbarHoverZoneFromRect(
      element.getBoundingClientRect(),
      offset,
      placement,
    ));
  }, [placement]);
  const {
    overlayRef,
    handlePointerDown: handleOverlayPointerDown,
    handlePointerMove: handleOverlayPointerMove,
    handlePointerUp: handleOverlayPointerUp,
    handlePointerCancel: handleOverlayPointerCancel,
    handleLostPointerCapture: handleOverlayLostPointerCapture,
    handleDoubleClick: handleOverlayDoubleClick,
  } = useDraggableOverlay({
    disabled: !active,
    resetKey: placement,
    isBlockedTarget: isInteractivePointerTarget,
    onInteraction: onHintInteraction,
    onPositionSettled: handlePositionSettled,
  });
  const handleModeHintClick = React.useCallback(() => {
    onHintInteraction?.();
    if (showCustomModeHint) onToggleModeHint?.();
    else onToggleComparison?.();
  }, [onHintInteraction, onToggleComparison, onToggleModeHint, showCustomModeHint]);
  const handlePointerEnter = React.useCallback(() => {
    setPointerInside(true);
    onHintInteraction?.();
  }, [onHintInteraction]);
  const handlePointerLeave = React.useCallback(() => {
    setPointerInside(false);
  }, []);
  const handleNavigateHintClick = React.useCallback(
    (
      key: NavigationHintKey,
      modifiers?: { shift?: boolean; alt?: boolean },
    ) => {
      onHintInteraction?.();
      onNavigateHint?.(key, modifiers);
    },
    [onHintInteraction, onNavigateHint],
  );
  const handleNavigateHintEnd = React.useCallback(
    (key: NavigationHintKey) => {
      onNavigateHintEnd?.(key);
    },
    [onNavigateHintEnd],
  );
  return (
    <div
      ref={overlayRef}
      className={cn(
        "aries-mode-hint",
        placement === "bottom" ? "aries-mode-hint--bottom" : "aries-mode-hint--top",
        !active && "aries-mode-hint--hidden",
      )}
      role="group"
      aria-label={kind === "ephemeris" ? t("toolbar.timeNavigationControls") : t("toolbar.chartNavbar")}
      aria-hidden={!active}
      onPointerDown={handleOverlayPointerDown}
      onPointerMove={handleOverlayPointerMove}
      onPointerUp={handleOverlayPointerUp}
      onPointerCancel={handleOverlayPointerCancel}
      onLostPointerCapture={handleOverlayLostPointerCapture}
      onDoubleClick={handleOverlayDoubleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {showModeHint ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="aries-mode-hint-button aries-mode-hint-main"
                onClick={handleModeHintClick}
                onPointerEnter={onHintInteraction}
                aria-label={targetModeTitle}
                title={targetModeTitle}
              />
            }
          >
            <span className="aries-mode-hint-label">{targetModeLabel}</span>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide} className="aries-mode-hint-flag">
            {showCustomModeHint ? (
              <span>{targetModeTitle}</span>
            ) : (
              <ShortcutFlag label={targetModeTitle} shortcut="Tab" />
            )}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {showRelationshipControls && onSwitchRelationshipMode ? (
        <div className="aries-step-hints" aria-label={t("toolbar.navbar.relationshipControls")}>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="aries-mode-hint-button aries-mode-hint-main"
                  onClick={() => {
                    onHintInteraction?.();
                    onSwitchRelationshipMode(
                      compoundKind === "synastry" ? "midpoint" : "synastry",
                    );
                  }}
                  aria-label={t("toolbar.switchToView", {
                    mode: compoundKind === "synastry"
                      ? t("toolbar.navbar.composite")
                      : t("toolbar.navbar.synastry"),
                  })}
                >
                  <span className="aries-mode-hint-label">
                    {compoundKind === "synastry"
                      ? t("toolbar.navbar.composite")
                      : t("toolbar.navbar.synastry")}
                  </span>
                </button>
              }
            >
            </TooltipTrigger>
            <TooltipContent side={tooltipSide} className="aries-mode-hint-flag">
              {t("toolbar.switchToView", {
                mode: compoundKind === "synastry"
                  ? t("toolbar.navbar.composite")
                  : t("toolbar.navbar.synastry"),
              })}
            </TooltipContent>
          </Tooltip>
          {compoundKind === "composite_from_synastry" ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="aries-mode-hint-button aries-mode-hint-main"
                    onClick={() => {
                      onHintInteraction?.();
                      onSwitchRelationshipMode(
                        compositeVariant === "davison" ? "midpoint" : "davison",
                      );
                    }}
                    aria-label={t("toolbar.switchToView", {
                      mode: compositeVariant === "davison"
                        ? t("toolbar.navbar.midpoint")
                        : t("toolbar.navbar.davison"),
                    })}
                  >
                    <span className="aries-mode-hint-label">
                      {compositeVariant === "davison"
                        ? t("toolbar.navbar.midpoint")
                        : t("toolbar.navbar.davison")}
                    </span>
                  </button>
                }
              >
              </TooltipTrigger>
              <TooltipContent side={tooltipSide} className="aries-mode-hint-flag">
                {t("toolbar.switchToView", {
                  mode: compositeVariant === "davison"
                    ? t("toolbar.navbar.midpoint")
                    : t("toolbar.navbar.davison"),
                })}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : showHarmonicControls && onNavigateHint ? (
        <div className="aries-step-hints" aria-label={t("toolbar.timeNavigationControls")}>
          <div className="aries-step-hint-group aries-harmonic-stepper">
            <span className="aries-step-unit">{harmonicHintGroup.label}</span>
            <span className="aries-step-arrows aries-harmonic-stepper-controls">
              <StepHintArrowButton
                action="backward"
                navigationKey="left"
                group={harmonicHintGroup}
                tooltipSide={tooltipSide}
                onPointerEnter={onHintInteraction}
                onClick={handleNavigateHintClick}
                onEnd={handleNavigateHintEnd}
              />
              {editingHarmonic ? (
                <input
                  className="aries-harmonic-input"
                  data-aries-control-appearance="local"
                  type="text"
                  inputMode={harmonicProjectionMode === "varga" ? "numeric" : "decimal"}
                  value={harmonicDraft}
                  aria-label={harmonicProjectionMode === "varga"
                    ? t("toolbar.navbar.vargaInput")
                    : t("toolbar.navbar.harmonicInput")}
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setHarmonicDraft(event.target.value)}
                  onBlur={commitHarmonicDraft}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitHarmonicDraft();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setEditingHarmonic(false);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="aries-harmonic-value"
                  aria-label={harmonicProjectionMode === "varga"
                    ? t("toolbar.navbar.editVarga")
                    : t("toolbar.navbar.editHarmonic")}
                  title={harmonicProjectionMode === "varga"
                    ? t("toolbar.navbar.editVarga")
                    : t("toolbar.navbar.editHarmonic")}
                  onClick={() => {
                    onHintInteraction?.();
                    setHarmonicDraft(formatHarmonicNumber(harmonicNumber));
                    setEditingHarmonic(true);
                  }}
                >
                  {harmonicProjectionMode === "varga" ? "D" : "H"}{formatHarmonicNumber(harmonicNumber)}
                </button>
              )}
              <StepHintArrowButton
                action="forward"
                navigationKey="right"
                group={harmonicHintGroup}
                tooltipSide={tooltipSide}
                onPointerEnter={onHintInteraction}
                onClick={handleNavigateHintClick}
                onEnd={handleNavigateHintEnd}
              />
            </span>
          </div>
        </div>
      ) : onNavigateHint && stepHintGroups.length > 0 ? (
        <div className="aries-step-hints" aria-label={t("toolbar.timeNavigationControls")}>
          {stepHintGroups.map((group) => (
            <div className="aries-step-hint-group" key={group.id}>
              <span className="aries-step-unit">{group.label}</span>
              <span className="aries-step-arrows">
                <StepHintArrowButton
                  action="backward"
                  navigationKey={group.backwardKey}
                  group={group}
                  tooltipSide={tooltipSide}
                  onPointerEnter={onHintInteraction}
                  onClick={handleNavigateHintClick}
                  onEnd={handleNavigateHintEnd}
                />
                <StepHintArrowButton
                  action="forward"
                  navigationKey={group.forwardKey}
                  group={group}
                  tooltipSide={tooltipSide}
                  onPointerEnter={onHintInteraction}
                  onClick={handleNavigateHintClick}
                  onEnd={handleNavigateHintEnd}
                />
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});

function canToggleSingleBiwheel({
  kind,
  parentDocumentId,
  supplementaryFeatureKind,
  comparisonSourceName,
  compoundKind,
  hasComparisonChart,
  viewMode,
}: {
  kind: WorkspaceDocument["kind"] | null | undefined;
  parentDocumentId?: string | null;
  supplementaryFeatureKind: WorkspaceDocument["supplementaryFeatureKind"] | null | undefined;
  comparisonSourceName?: string | null;
  compoundKind: WorkspaceDocument["compoundKind"] | null | undefined;
  hasComparisonChart?: boolean;
  viewMode?: number | null;
}): boolean {
  if (!isChartBearingSurfaceKind(kind)) return false;
  if (compoundKind) return false;
  if (kind === "supplementary") {
    if (supplementaryFeatureKind === "synastry") return false;
    return Boolean(parentDocumentId && supplementaryFeatureKind);
  }
  if (viewMode === 1) return Boolean(hasComparisonChart || comparisonSourceName);
  return Boolean(comparisonSourceName);
}

function StepHintArrowButton({
  action,
  navigationKey,
  group,
  tooltipSide,
  onPointerEnter,
  onClick,
  onEnd,
}: {
  action: "backward" | "forward";
  navigationKey: NavigationHintKey;
  group: NavigationHintGroup;
  tooltipSide: "top" | "bottom";
  onPointerEnter?: () => void;
  onClick: (
    key: NavigationHintKey,
    modifiers?: { shift?: boolean; alt?: boolean },
  ) => void;
  onEnd: (key: NavigationHintKey) => void;
}) {
  const label = action === "backward" ? group.backwardLabel : group.forwardLabel;
  const modifiers = group.modifiers;
  const holdDelayRef = React.useRef<number | null>(null);
  const holdKeepAliveRef = React.useRef<number | null>(null);
  const holdIntervalRef = React.useRef<number | null>(null);
  const holdActiveRef = React.useRef(false);
  const suppressNextClickRef = React.useRef(false);
  const clearHold = React.useCallback(() => {
    if (holdDelayRef.current != null) {
      window.clearTimeout(holdDelayRef.current);
      holdDelayRef.current = null;
    }
    if (holdIntervalRef.current != null) {
      window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    if (holdKeepAliveRef.current != null) {
      window.clearInterval(holdKeepAliveRef.current);
      holdKeepAliveRef.current = null;
    }
  }, []);
  const fireStep = React.useCallback(() => {
    onClick(navigationKey, modifiers);
  }, [modifiers, navigationKey, onClick]);
  const stopHold = React.useCallback(() => {
    const wasHolding = holdActiveRef.current;
    holdActiveRef.current = false;
    clearHold();
    if (wasHolding) {
      onEnd(navigationKey);
      onPointerEnter?.();
    }
  }, [clearHold, navigationKey, onEnd, onPointerEnter]);
  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      suppressNextClickRef.current = true;
      holdActiveRef.current = true;
      clearHold();
      onPointerEnter?.();
      fireStep();
      holdKeepAliveRef.current = window.setInterval(
        () => onPointerEnter?.(),
        STEP_HINT_HOLD_KEEPALIVE_MS,
      );
      holdDelayRef.current = window.setTimeout(() => {
        holdDelayRef.current = null;
        fireStep();
        holdIntervalRef.current = window.setInterval(fireStep, STEP_HINT_HOLD_REPEAT_MS);
      }, STEP_HINT_HOLD_DELAY_MS);
    },
    [clearHold, fireStep, onPointerEnter],
  );
  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        event.preventDefault();
        return;
      }
      fireStep();
      onEnd(navigationKey);
    },
    [fireStep, navigationKey, onEnd],
  );
  React.useEffect(() => () => {
    const wasHolding = holdActiveRef.current;
    holdActiveRef.current = false;
    clearHold();
    if (wasHolding) onEnd(navigationKey);
  }, [clearHold, navigationKey, onEnd]);
  const ArrowIcon = navigationKey === "left"
    ? ChevronLeft
    : navigationKey === "right"
      ? ChevronRight
      : navigationKey === "up"
        ? ChevronUp
        : ChevronDown;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="aries-step-arrow-button"
            onClick={handleClick}
            onPointerDown={handlePointerDown}
            onPointerUp={stopHold}
            onPointerCancel={stopHold}
            onPointerLeave={stopHold}
            onPointerEnter={onPointerEnter}
            onBlur={stopHold}
            aria-label={label}
            title={label}
          />
        }
      >
        <ArrowIcon />
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="aries-mode-hint-flag">
        <ShortcutFlag
          label={label}
          shortcut={shortcutTextForStep(navigationKey, modifiers)}
        />
      </TooltipContent>
    </Tooltip>
  );
}

function ShortcutFlag({ label, shortcut }: { label: string; shortcut: string }) {
  return (
    <>
      <span>{label}</span>
      <kbd data-slot="kbd">{shortcut}</kbd>
    </>
  );
}

export function shortcutTextForStep(
  direction: NavigationHintKey,
  modifiers?: { shift?: boolean; alt?: boolean },
): string {
  const parts: string[] = [];
  if (modifiers?.alt) parts.push("⌥");
  if (modifiers?.shift) parts.push("⇧");
  parts.push({ left: "←", right: "→", up: "↑", down: "↓" }[direction]);
  return parts.join(" + ");
}

type NavigationHintUnit =
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "year"
  | "degree"
  | "oneDegree"
  | "thirtyDegrees"
  | "cycle"
  | "event"
  | "harmonic";

export function navigationHintGroups({
  chartVisualMode,
  launcherKind,
  compoundKind,
  kind,
  supplementaryFeatureKind,
}: {
  chartVisualMode: WorkspaceDocument["chartVisualMode"] | null | undefined;
  launcherKind: WorkspaceDocument["launcherKind"] | null | undefined;
  compoundKind: WorkspaceDocument["compoundKind"] | null | undefined;
  kind: WorkspaceDocument["kind"] | null | undefined;
  supplementaryFeatureKind: WorkspaceDocument["supplementaryFeatureKind"] | null | undefined;
}, t: TFunc): NavigationHintGroup[] {
  if (kind === "ephemeris") {
    return [
      buildNavigationHintGroup("month", "left", "right", undefined, t),
      buildNavigationHintGroup("year", "down", "up", undefined, t),
    ];
  }
  if (!isChartBearingSurfaceKind(kind)) return [];
  if (launcherKind === "pd_in_chart") {
    return buildLeftRightHintGroups([
      ["week", { alt: true }],
      ["month", { shift: true }],
      ["year", undefined],
    ], t);
  }
  if (compoundKind) return [];
  if (
    kind === "ascensional-transits" ||
    chartVisualMode === "mdo" ||
    chartVisualMode === "mundane" ||
    chartVisualMode === "ascensional_transits"
  ) {
    return buildLeftRightHintGroups([
      ["second", { alt: true }],
      ["minute", { shift: true }],
      ["degree", undefined],
    ], t);
  }

  const featureKind = supplementaryFeatureKind;
  if (
    !featureKind ||
    featureKind === "transits" ||
    featureKind === "converse-transits" ||
    featureKind === "synastry"
  ) {
    return buildLeftRightHintGroups([
      ["minute", { alt: true }],
      ["hour", { shift: true }],
      ["day", undefined],
    ], t);
  }
  if (
    featureKind === "secondary-progression" ||
    featureKind === "tertiary-progression" ||
    featureKind === "minor-progression" ||
    featureKind === "solar-arc"
  ) {
    return buildLeftRightHintGroups([
      ["day", { alt: true }],
      ["week", { shift: true }],
      ["month", undefined],
    ], t);
  }
  if (featureKind === "profections") {
    return buildLeftRightHintGroups([
      ["day", { alt: true }],
      ["month", { shift: true }],
      ["year", undefined],
    ], t);
  }
  if (featureKind === "solar-revolution") {
    return buildLeftRightHintGroups([
      ["oneDegree", { alt: true }],
      ["thirtyDegrees", { shift: true }],
      ["year", undefined],
    ], t);
  }
  if (featureKind === "lunar-revolution") {
    return buildLeftRightHintGroups([["cycle", undefined]], t);
  }
  if (featureKind === "planetary-return") {
    return buildLeftRightHintGroups([
      ["event", { shift: true }],
      ["cycle", undefined],
    ], t);
  }
  return [];
}

function buildLeftRightHintGroups(
  entries: Array<[
    unit: NavigationHintUnit,
    modifiers: { shift?: boolean; alt?: boolean } | undefined,
  ]>,
  t: TFunc,
): NavigationHintGroup[] {
  return entries.map(([unit, modifiers]) =>
    buildNavigationHintGroup(unit, "left", "right", modifiers, t));
}

function buildNavigationHintGroup(
  unit: NavigationHintUnit,
  backwardKey: NavigationHintKey,
  forwardKey: NavigationHintKey,
  modifiers: { shift?: boolean; alt?: boolean } | undefined,
  t: TFunc,
): NavigationHintGroup {
  const label = navigationHintUnitLabel(unit, t);
  return {
    id: `${unit}:${backwardKey}:${forwardKey}:${modifiers?.shift ? "shift" : ""}:${modifiers?.alt ? "alt" : ""}`,
    label,
    modifiers,
    backwardKey,
    forwardKey,
    backwardLabel: t("toolbar.navbar.stepBackward", { unit: label }),
    forwardLabel: t("toolbar.navbar.stepForward", { unit: label }),
  };
}

function navigationHintUnitLabel(unit: NavigationHintUnit, t: TFunc): string {
  switch (unit) {
    case "second": return t("toolbar.navbar.unit.second");
    case "minute": return t("toolbar.navbar.unit.minute");
    case "hour": return t("toolbar.navbar.unit.hour");
    case "day": return t("toolbar.navbar.unit.day");
    case "week": return t("toolbar.navbar.unit.week");
    case "month": return t("toolbar.navbar.unit.month");
    case "year": return t("toolbar.navbar.unit.year");
    case "degree": return t("toolbar.navbar.unit.degree");
    case "oneDegree": return t("toolbar.navbar.unit.oneDegree");
    case "thirtyDegrees": return t("toolbar.navbar.unit.thirtyDegrees");
    case "cycle": return t("toolbar.navbar.unit.cycle");
    case "event": return t("toolbar.navbar.unit.event");
    case "harmonic": return t("toolbar.navbar.unit.harmonic");
  }
}

function formatHarmonicNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "9";
  return Number(value.toFixed(6)).toString();
}

function TitleText({ parts }: { parts: TitlePart[] }) {
  const compact = parts.slice(0, Math.min(2, parts.length));
  const partText = (part: TitlePart) => (typeof part === "string" ? part : part.text);
  const partTitle = (part: TitlePart) => (typeof part === "string" ? undefined : part.title);
  const partStyle = (part: TitlePart): React.CSSProperties | undefined =>
    typeof part === "string" || !part.glyph ? undefined : { fontFamily: "'AriesMorinus'" };
  const renderRun = (runParts: TitlePart[], keyPrefix: string) =>
    runParts.map((part, i) => (
      <React.Fragment key={`${keyPrefix}-${i}`}>
        {i > 0 ? (
          <span className="text-[color:var(--aries-titlebar-text)]" aria-hidden>
            {" • "}
          </span>
        ) : null}
        <span
          className="font-normal text-[color:var(--aries-titlebar-text)]"
          style={partStyle(part)}
          title={partTitle(part)}
        >
          {partText(part)}
        </span>
      </React.Fragment>
    ));
  return (
    <>
      <span className="pointer-events-none block min-w-0 max-w-full truncate whitespace-nowrap sm:hidden">
        {renderRun(compact, "compact")}
      </span>
      <span className="pointer-events-none hidden min-w-0 max-w-full truncate whitespace-nowrap sm:block">
        {renderRun(parts, "full")}
      </span>
    </>
  );
}

function HeaderButton({
  label,
  onClick,
  active,
  pressed = active,
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
            className={cn(
              "flex h-[var(--morinus-header-btn-h)] w-[var(--morinus-header-btn-w)] items-center justify-center rounded-[var(--morinus-header-btn-radius)] text-[color:var(--aries-titlebar-icon)] transition-colors duration-[var(--aries-motion-shell-duration)] ease-[var(--aries-motion-shell-ease)] hover:bg-sidebar-accent hover:text-[color:var(--aries-titlebar-icon-hover)]",
              active && "bg-sidebar-accent text-[color:var(--aries-titlebar-icon-active)]",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function shouldRestoreChartPaneFocus(chartPaneElement: HTMLElement): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) {
    return true;
  }
  if (!(active instanceof HTMLElement)) return true;
  if (!active.isConnected) return true;
  if (active === chartPaneElement) return false;
  if (active.closest('[role="dialog"], [role="alertdialog"]')) return false;
  if (isEditableFocusTarget(active)) return false;
  return true;
}

function isEditableFocusTarget(element: HTMLElement): boolean {
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

function isInteractivePointerTarget(target: EventTarget | null): boolean {
  // Pointer targets inside icon buttons are often SVGElement/path nodes rather
  // than HTMLElement. Treat every DOM Element as eligible for closest() so a
  // button's pointer sequence can never leak into parent drag/focus handling.
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  return Boolean(
    element.closest(
      'button, input, textarea, select, a[href], [role="button"], [contenteditable="true"]',
    ),
  );
}

function ChartArea({
  chart,
  activeDoc,
  surface,
  navbar,
}: {
  chart: ChartRenderSnapshot | null;
  activeDoc: WorkspaceDocument | null;
  surface?: React.ReactNode;
  navbar?: ModeHintRailProps | null;
}) {
  const inspectorOpen = useFrameLayoutStore((s) => s.inspectorOpen);
  const notesOpen = useFrameLayoutStore((s) => s.notesPaneOpen);
  const styleEditorOpen = useFrameLayoutStore((s) => s.styleEditorOpen);
  const sidebarOpen = useFrameLayoutStore((s) => s.sidebarOpen);
  const sidebarWidth = useFrameLayoutStore((s) => s.sidebarWidth);
  const rightPaneWidth = useFrameLayoutStore((s) => s.rightPaneWidth);
  const transitSearchPane = useWorkspaceStore((s) => s.transitSearchPane);
  const transitListPane = useWorkspaceStore((s) => s.transitListPane);
  const directionsPane = useWorkspaceStore((s) => s.directionsPane);
  const timeLordPane = useWorkspaceStore((s) => s.timeLordPane);
  const zodiacalReleasingPane = useWorkspaceStore((s) => s.zodiacalReleasingPane);
  const firdariaPane = useWorkspaceStore((s) => s.firdariaPane);
  const decennialsPane = useWorkspaceStore((s) => s.decennialsPane);
  const profectionsPane = useWorkspaceStore((s) => s.profectionsPane);
  const eclipsesPane = useWorkspaceStore((s) => s.eclipsesPane);
  const lunarMansionsPane = useWorkspaceStore((s) => s.lunarMansionsPane);
  const synodicCyclesPane = useWorkspaceStore((s) => s.synodicCyclesPane);
  const aspectListPane = useWorkspaceStore((s) => s.aspectListPane);
  const ascensionalTransitsPane = useWorkspaceStore((s) => s.ascensionalTransitsPane);
  const calendarPane = useWorkspaceStore((s) => s.calendarPane);
  const featureCatalogPane = useWorkspaceStore((s) => s.featureCatalogPane);
  const activeRightPane = activeRightPaneModule({
    inspectorOpen,
    notesOpen,
    styleEditorOpen,
    transitSearchPane,
    transitListPane,
    directionsPane,
    timeLordPane,
    zodiacalReleasingPane,
    firdariaPane,
    decennialsPane,
    profectionsPane,
    eclipsesPane,
    lunarMansionsPane,
    synodicCyclesPane,
    aspectListPane,
    ascensionalTransitsPane,
    calendarPane,
    featureCatalogPane,
  });
  const rightPaneOpen = activeRightPane !== null;
  const rightPanePolicy = rightPaneWidthPolicy(activeRightPane);
  const effectiveRightPaneWidth = activeRightPane
    ? rightPanePriorityLayout(
        sidebarOpen,
        sidebarWidth,
        rightPaneWidth,
        activeRightPane,
      ).rightPaneWidth
    : rightPaneWidth;
  const rightPaneTrack = useCoherentRightPaneTrack(
    rightPaneOpen,
    effectiveRightPaneWidth,
  );
  const closeRightPane = React.useCallback(() => {
    closeWorkspaceTransientPanes();
  }, []);
  const [chartPaneElement, setChartPaneElement] = useState<HTMLDivElement | null>(null);
  const chartPaneViewport = useElementSize(chartPaneElement);
  const chartPaneSize = Math.min(chartPaneViewport.width, chartPaneViewport.height);
  const navbarScale = chartNavbarScaleForPane(chartPaneSize);
  const focusKey = [
    chart?.document?.documentId ?? activeDoc?.id ?? (chart ? "chart" : "empty"),
    chart?.displayDatetime ?? "",
  ].join(":");

  useEffect(() => {
    if (!chartPaneElement) return;
    if (!shouldRestoreChartPaneFocus(chartPaneElement)) return;
    const frame = window.requestAnimationFrame(() => {
      if (shouldRestoreChartPaneFocus(chartPaneElement)) {
        chartPaneElement.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chartPaneElement, focusKey]);

  const focusChartPane = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isInteractivePointerTarget(event.target)) return;
    if (!chartPaneElement || !shouldRestoreChartPaneFocus(chartPaneElement)) return;
    chartPaneElement.focus({ preventScroll: true });
  }, [chartPaneElement]);

  return (
    <div
      className={cn(
        "right-pane-split relative grid flex-1 min-h-0 bg-transparent",
        rightPaneTrack.transitioning &&
          "transition-[grid-template-columns] duration-[var(--aries-motion-shell-duration)] ease-[var(--aries-motion-shell-ease)]",
      )}
      onTransitionEnd={rightPaneTrack.onTransitionEnd}
      style={{
        "--right-pane-width": `${rightPaneTrack.width}px`,
        gridTemplateColumns: rightPaneTrack.open
          ? "minmax(0, 1fr) min(var(--right-pane-width), 50vw)"
          : "minmax(0, 1fr) 0px",
      } as React.CSSProperties}
    >
      <div
        ref={setChartPaneElement}
        tabIndex={-1}
        data-workspace-focus-anchor=""
        className="relative min-w-0 overflow-hidden outline-none"
        onPointerDown={focusChartPane}
        style={{ "--aries-navbar-scale": navbarScale.toFixed(3) } as React.CSSProperties}
      >
        {surface ?? (chart ? (
          <ChartSurface chart={chart} />
        ) : (
          <WorkspaceDocumentSurface>
            <EmptyWorkspace />
          </WorkspaceDocumentSurface>
        ))}
        {navbar ? <ModeHintRail {...navbar} /> : null}
      </div>
      {rightPaneOpen ? (
        <RightPaneSash
          width={effectiveRightPaneWidth}
          minWidth={rightPanePolicy.minContentWidth}
          onResizeStart={rightPaneTrack.stopTransition}
          onCollapse={closeRightPane}
        />
      ) : null}
      <aside
        aria-hidden={!rightPaneOpen}
        data-right-pane-module={activeRightPane ?? undefined}
        data-right-pane-role={rightPaneOpen ? rightPanePolicy.role : undefined}
        className={cn(
          // The mounted pane owns the one material boundary: Inspector/Notes
          // paint themselves, while other retained panes use
          // RightInspectorPaneFrame. An opaque shell here would block their
          // authored alpha and backdrop filter.
          "box-border min-w-0 overflow-hidden border-l border-[color:var(--aries-titlebar-seam-rule)] bg-transparent pt-[var(--titlebar-pane-pad-top)] text-[color:var(--aries-panel-text)]",
          !rightPaneOpen && "pointer-events-none",
        )}
        style={
          {
            "--right-pane-min-content-width": `${rightPanePolicy.minContentWidth}px`,
            "--right-pane-preferred-width": `${rightPanePolicy.preferredWidth}px`,
          } as React.CSSProperties
        }
      >
        {rightPaneOpen ? <RightPaneStack chart={chart} activeDoc={activeDoc} /> : null}
      </aside>
    </div>
  );
}

const CHART_NAVBAR_SCALE_REFERENCE = 760;
const CHART_NAVBAR_MIN_SCALE = 0.78;

function chartNavbarScaleForPane(chartPaneSize: number): number {
  if (!Number.isFinite(chartPaneSize) || chartPaneSize <= 0) return 1;
  return Math.max(
    CHART_NAVBAR_MIN_SCALE,
    Math.min(1, chartPaneSize / CHART_NAVBAR_SCALE_REFERENCE),
  );
}

const RIGHT_PANE_RESIZING_ATTR = "data-right-pane-resizing";

/**
 * Synchronize right-pane reveal/conceal with the left sidebar's existing CSS
 * width transition. The desired pane mounts immediately, but the grid retains
 * its previously painted track until this layout effect advances both tracks
 * in the same pre-paint browser update.
 *
 * Transition styling exists only for that visibility handoff. Once it ends,
 * window resizing and direct sash writes remain completely fluid and do not
 * inherit a persistent `grid-template-columns` transition.
 */
function useCoherentRightPaneTrack(open: boolean, width: number) {
  const [layoutOpen, setLayoutOpen] = useState(open);
  const [transitioning, setTransitioning] = useState(false);

  useLayoutEffect(() => {
    if (open === layoutOpen) return;
    // This is the deliberate pre-paint handoff between the two grid tracks;
    // deferring it would expose one frame with mismatched chart/pane widths.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTransitioning(true);
    setLayoutOpen(open);
  }, [layoutOpen, open]);

  const onTransitionEnd = React.useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (
        event.currentTarget !== event.target ||
        event.propertyName !== "grid-template-columns"
      ) {
        return;
      }
      setTransitioning(false);
    },
    [],
  );

  const stopTransition = React.useCallback(() => {
    setTransitioning(false);
  }, []);

  return {
    open: layoutOpen,
    width,
    transitioning,
    onTransitionEnd,
    stopTransition,
  };
}

function RightPaneSash({
  width,
  minWidth,
  onResizeStart,
  onCollapse,
}: {
  width: number;
  minWidth: number;
  onResizeStart?: () => void;
  onCollapse: () => void;
}) {
  const t = useT();
  const setRightPaneWidth = useFrameLayoutStore((s) => s.setRightPaneWidth);
  const resetRightPaneWidth = useFrameLayoutStore((s) => s.resetRightPaneWidth);
  const setRightPaneDragging = useFrameLayoutStore((s) => s.setRightPaneDragging);
  const dragging = useFrameLayoutStore((s) => s.rightPaneDragging);
  const activeRef = useRef(false);
  const collapseInProgressRef = useRef(false);
  const splitRef = useRef<HTMLElement | null>(null);
  const containerRightRef = useRef(0);
  const maxWidthRef = useRef(Number.POSITIVE_INFINITY);
  const lastWidthRef = useRef(width);
  const dragStartWidthRef = useRef(width);
  const windowMoveHandlerRef = useRef<((event: PointerEvent) => void) | null>(null);
  const windowEndHandlerRef = useRef<((event: PointerEvent) => void) | null>(null);

  const setLiveRightPaneWidth = React.useCallback((nextWidth: number) => {
    splitRef.current?.style.setProperty("--right-pane-width", `${nextWidth}px`);
  }, []);

  const removeWindowDragListeners = React.useCallback(() => {
    if (windowMoveHandlerRef.current) {
      window.removeEventListener("pointermove", windowMoveHandlerRef.current);
      windowMoveHandlerRef.current = null;
    }
    if (windowEndHandlerRef.current) {
      window.removeEventListener("pointerup", windowEndHandlerRef.current);
      window.removeEventListener("pointercancel", windowEndHandlerRef.current);
      windowEndHandlerRef.current = null;
    }
  }, []);

  const finishCollapse = React.useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    removeWindowDragListeners();
    setLiveRightPaneWidth(dragStartWidthRef.current);
    setRightPaneWidth(dragStartWidthRef.current);
    collapseInProgressRef.current = true;
    onCollapse();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        collapseInProgressRef.current = false;
        setRightPaneDragging(false);
        splitRef.current = null;
        document.documentElement.removeAttribute(RIGHT_PANE_RESIZING_ATTR);
      });
    });
  }, [
    onCollapse,
    removeWindowDragListeners,
    setLiveRightPaneWidth,
    setRightPaneDragging,
    setRightPaneWidth,
  ]);

  const updateDragWidth = React.useCallback(
    (clientX: number) => {
      if (!activeRef.current) return;
      const raw = containerRightRef.current - clientX;
      if (raw < RIGHT_PANE_COLLAPSE_THRESHOLD) {
        finishCollapse();
        return;
      }
      const clamped = Math.min(
        maxWidthRef.current,
        clampRightPaneWidth(raw, { minContentWidth: minWidth }),
      );
      lastWidthRef.current = clamped;
      setLiveRightPaneWidth(clamped);
    },
    [finishCollapse, minWidth, setLiveRightPaneWidth],
  );

  const endDrag = React.useCallback(
    (pointerId?: number, handle?: HTMLElement | null) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      removeWindowDragListeners();
      document.documentElement.removeAttribute(RIGHT_PANE_RESIZING_ATTR);
      setRightPaneWidth(lastWidthRef.current);
      setRightPaneDragging(false);
      splitRef.current = null;
      if (pointerId != null && handle) {
        try {
          handle.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
      }
    },
    [removeWindowDragListeners, setRightPaneDragging, setRightPaneWidth],
  );

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      onResizeStart?.();
      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      const split = handle.closest<HTMLElement>(".right-pane-split");
      if (!split) return;
      const rect = split.getBoundingClientRect();
      const maxWidth = window.innerWidth * 0.5;
      const visibleWidth = Math.min(width, maxWidth);
      splitRef.current = split;
      containerRightRef.current = rect.right;
      maxWidthRef.current = maxWidth;
      lastWidthRef.current = visibleWidth;
      dragStartWidthRef.current = visibleWidth;
      activeRef.current = true;
      document.documentElement.setAttribute(RIGHT_PANE_RESIZING_ATTR, "");
      setRightPaneDragging(true);

      const onWindowMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        updateDragWidth(moveEvent.clientX);
      };
      const onWindowEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        endEvent.preventDefault();
        endDrag(endEvent.pointerId, handle);
      };
      windowMoveHandlerRef.current = onWindowMove;
      windowEndHandlerRef.current = onWindowEnd;
      window.addEventListener("pointermove", onWindowMove, { passive: false });
      window.addEventListener("pointerup", onWindowEnd, { passive: false });
      window.addEventListener("pointercancel", onWindowEnd, { passive: false });

      try {
        handle.setPointerCapture(pointerId);
      } catch {
        /* synthetic events may lack a real pointer to capture */
      }
    },
    [endDrag, onResizeStart, setRightPaneDragging, updateDragWidth, width],
  );

  useEffect(() => {
    return () => {
      removeWindowDragListeners();
      if (!collapseInProgressRef.current) {
        document.documentElement.removeAttribute(RIGHT_PANE_RESIZING_ATTR);
        setRightPaneDragging(false);
      }
    };
  }, [removeWindowDragListeners, setRightPaneDragging]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("toolbar.resizeRightSidebar")}
      onPointerDown={onPointerDown}
      onDoubleClick={resetRightPaneWidth}
      className={cn(
        "absolute inset-y-0 z-50 w-3 -translate-x-1/2 cursor-col-resize select-none outline-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-[var(--aries-sash-rule-size)] after:-translate-x-1/2 after:bg-[color:var(--aries-sash-idle-color)] after:content-['']",
        dragging && "after:bg-[color:var(--aries-sash-active-color)]",
      )}
      style={{ left: "calc(100% - min(var(--right-pane-width), 50vw))" }}
    />
  );
}

/**
 * The chart canvas plus its four corner-overlay clusters. Hosts the sizing
 * element so the canvas re-measures when the panel is dragged (the
 * ResizeObserver in useElementSize fires on width change automatically).
 */
export function ChartSurface({
  chart,
  appControlsEnabled = true,
  inheritAppTheme = true,
  resolvedTheme,
  exportRegistrationEnabled = true,
}: {
  chart: ChartRenderSnapshot;
  appControlsEnabled?: boolean;
  inheritAppTheme?: boolean;
  resolvedTheme?: ThemeState | null;
  exportRegistrationEnabled?: boolean;
}) {
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const viewport = useElementSize(hostElement);
  const viewportWidth = viewport.width;
  const viewportHeight = viewport.height;
  const appTheme = useThemeStore((state) => state.theme);
  const appStyleRevision = useStyleRevision();
  const selectedAspectBody = useWorkspaceStore((state) => state.selectedAspectBody);
  const hideAllAspects = useWorkspaceStore((state) => state.hideAllAspects);
  const minorOnlyAspects = useWorkspaceStore((state) => state.minorOnlyAspects);
  const theme = resolvedTheme === undefined ? appTheme : resolvedTheme;
  const styleRevision = resolvedTheme === undefined
    ? appStyleRevision
    : `${theme?.schemaVersion ?? 0}:${theme?.styleRevision ?? 0}:${theme?.styleHash ?? "none"}`;

  useEffect(() => {
    if (!exportRegistrationEnabled) return;
    if ((chart.rings?.length ?? 0) >= 3) return;
    const documentId = chart.document?.documentId;
    if (!documentId || viewportWidth <= 0 || viewportHeight <= 0) return;
    return registerChartExportRenderer(documentId, (request) =>
      renderChartSurfaceExport(
        chart,
        theme,
        { width: viewportWidth, height: viewportHeight },
        request,
        {
          selectedBody: selectedAspectBody,
          hideAll: hideAllAspects,
          minorOnly: minorOnlyAspects,
        },
      ),
    );
  }, [
    chart,
    exportRegistrationEnabled,
    hideAllAspects,
    minorOnlyAspects,
    selectedAspectBody,
    theme,
    viewportHeight,
    viewportWidth,
  ]);

  const primaryChart = chart.primaryChart;
  const isMultiwheel = (chart.rings?.length ?? 0) >= 3;
  const displayChart = isPlainSynastryBiwheel(chart)
    ? primaryChart
    : chart.comparisonChart ?? primaryChart;
  const primaryCornerLines = primaryChart.meta.cornerLines;
  const cornerChart =
    primaryCornerLines?.topLeft?.length || primaryCornerLines?.bottomLeft?.length
      ? primaryChart
      : displayChart;
  const palette = React.useMemo(
    () => ({
      ...readPaletteFromTheme(theme),
      ...resolvePalette(primaryChart),
      ...readPaletteProfileOverrides(theme),
    }),
    [primaryChart, theme],
  );
  const chartTextFont = morinusTextFontFromTokens(theme?.appTokens);
  const wheelStyle = React.useMemo(
    () =>
      resolveWheelRenderStyleFromTokens(
        (cssVar) => theme?.chartPalette?.[cssVar],
        {
          palette,
          revision: styleRevision,
          fontSymbols: '"AriesMorinus"',
          fontUi: chartTextFont,
        },
      ),
    [chartTextFont, palette, styleRevision, theme?.chartPalette],
  );
  const overlayStyle = wheelStyle.overlays;
  // Partial overlay modes keep the live wheel cheap while the snapshot cache
  // retains previous stable rows until the next full overlay replaces them.
  const overlayRows = displayChart.overlay?.rows ?? [];
  const overlaySections = splitOverlayRows(overlayRows);
  const hasOverlayRows = overlayRows.length > 0;
  const overlayMetrics = resolveWheelOverlayMetrics(overlayStyle, viewport);
  const {
    infoFontSize,
    iconSize: overlayIconSize,
    labelSize: overlayLabelSize,
    lineHeight: overlayLineHeight,
    gapAfterDayHour: overlayGapAfterDayHour,
    gapBetweenGroups: overlayGapBetweenGroups,
    columnGap: overlayColumnGap,
    edgeInset,
    topEdgeInset,
    maxWidth: overlayMaxWidth,
  } = overlayMetrics;
  const wheelProfile: WheelTypographyProfile =
    primaryChart.options.theme === 2
      ? "anglo"
      : primaryChart.options.theme === 1
        ? "compact"
        : "classic";
  const projectedOverlayStyle = projectWheelAuthoringStyle(
    wheelStyle,
    overlayMetrics.chartSize / 2,
    wheelProfile,
  );

  return (
    <div ref={setHostElement} className="font-morinus-text relative flex h-full w-full min-w-0 overflow-hidden">
      <ChartCanvas
        chart={chart}
        appControlsEnabled={appControlsEnabled}
        inheritAppTheme={inheritAppTheme}
      />
      {!isMultiwheel && cornerChart.options.showInformation ? (
        <CornerLines
          semanticClassId="chartOverlay.information.topLeft"
          wheelStyle={projectedOverlayStyle}
          lines={radixOverlayTopLeftLines(cornerChart, chart.radixChart)}
          color={palette.textDim}
          fontSize={infoFontSize}
          gap={overlayStyle.infoGap}
          lineHeight={overlayStyle.cornerLineHeight}
          style={{ top: topEdgeInset, left: edgeInset, textAlign: "left" }}
        />
      ) : null}
      {!isMultiwheel && hasOverlayRows ? (
        <OverlayCorner
          wheelStyle={projectedOverlayStyle}
          sections={overlaySections}
          palette={palette}
          labelSize={overlayLabelSize}
          iconSize={overlayIconSize}
          lineHeight={overlayLineHeight}
          gapAfterDayHour={overlayGapAfterDayHour}
          gapBetweenGroups={overlayGapBetweenGroups}
          columnGap={overlayColumnGap}
          glyphLineHeight={overlayStyle.glyphLineHeight}
          maxWidth={overlayMaxWidth}
          style={{ top: topEdgeInset, right: edgeInset }}
        />
      ) : null}
      {!isMultiwheel && cornerChart.options.showInformation ? (
        <CornerLines
          semanticClassId="chartOverlay.information.bottomLeft"
          wheelStyle={projectedOverlayStyle}
          lines={
            cornerChart.meta.cornerLines?.bottomLeft ??
            [cornerChart.meta.place, cornerChart.meta.placeCoords]
          }
          color={palette.textDim}
          fontSize={infoFontSize}
          gap={overlayStyle.infoGap}
          lineHeight={overlayStyle.cornerLineHeight}
          style={{ bottom: edgeInset, left: edgeInset, textAlign: "left" }}
        />
      ) : null}
      {!isMultiwheel && displayChart.options.showHouseSystem ? (
        <CornerLines
          semanticClassId="chartOverlay.houseSystem.bottomRight"
          wheelStyle={projectedOverlayStyle}
          lines={displayChart.meta.houseSystemLines ?? []}
          color={palette.textDim}
          fontSize={infoFontSize}
          gap={overlayStyle.infoGap}
          lineHeight={overlayStyle.cornerLineHeight}
          style={{ right: edgeInset, bottom: edgeInset, textAlign: "right" }}
        />
      ) : null}
    </div>
  );
}

/**
 * Right-side pane stack. Only mounted when the parent decides a right pane is
 * open. When BOTH inspector and notes are open they share the column as a
 * draggable vertical split; when only one is open it fills the column.
 */
function RightPaneStack({
  chart,
  activeDoc,
}: {
  chart: ChartRenderSnapshot | null;
  activeDoc: WorkspaceDocument | null;
}) {
  const inspectorOpen = useFrameLayoutStore((s) => s.inspectorOpen);
  const notesOpen = useFrameLayoutStore((s) => s.notesPaneOpen);
  const styleEditorOpen = useFrameLayoutStore((s) => s.styleEditorOpen);
  const setStyleEditorOpen = useFrameLayoutStore((s) => s.setStyleEditorOpen);
  const transitSearchPane = useWorkspaceStore((s) => s.transitSearchPane);
  const closeTransitSearchPane = useWorkspaceStore((s) => s.closeTransitSearchPane);
  const transitListPane = useWorkspaceStore((s) => s.transitListPane);
  const closeTransitListPane = useWorkspaceStore((s) => s.closeTransitListPane);
  const directionsPane = useWorkspaceStore((s) => s.directionsPane);
  const closeDirectionsPane = useWorkspaceStore((s) => s.closeDirectionsPane);
  const timeLordPane = useWorkspaceStore((s) => s.timeLordPane);
  const closeTimeLordPane = useWorkspaceStore((s) => s.closeTimeLordPane);
  const synodicCyclesPane = useWorkspaceStore((s) => s.synodicCyclesPane);
  const closeSynodicCyclesPane = useWorkspaceStore((s) => s.closeSynodicCyclesPane);
  const aspectListPane = useWorkspaceStore((s) => s.aspectListPane);
  const closeAspectListPane = useWorkspaceStore((s) => s.closeAspectListPane);
  const timedChartListRowLinkDocumentIds = useWorkspaceStore(
    (s) => s.timedChartListRowLinkDocumentIds,
  );
  const daemonDocuments = useDaemonWorkspaceStore((s) => s.documents);
  const eclipsesPane = useWorkspaceStore((s) => s.eclipsesPane);
  const closeEclipsesPane = useWorkspaceStore((s) => s.closeEclipsesPane);
  const lunarMansionsPane = useWorkspaceStore((s) => s.lunarMansionsPane);
  const closeLunarMansionsPane = useWorkspaceStore((s) => s.closeLunarMansionsPane);
  const ascensionalTransitsPane = useWorkspaceStore((s) => s.ascensionalTransitsPane);
  const closeAscensionalTransitsPane = useWorkspaceStore(
    (s) => s.closeAscensionalTransitsPane,
  );
  const calendarPane = useWorkspaceStore((s) => s.calendarPane);
  const closeCalendarPane = useWorkspaceStore((s) => s.closeCalendarPane);
  const featureCatalogPane = useWorkspaceStore((s) => s.featureCatalogPane);
  const closeFeatureCatalogPane = useWorkspaceStore((s) => s.closeFeatureCatalogPane);

  // --- Directions focus resolution (hooks stay above the early returns). ---
  // List row link = chart command only: a chart the user opened FROM a list row
  // must not feed its datetime back into that list's focus (the list would
  // scroll to the row that was just clicked). Once the user steps the chart,
  // source-live follow resumes from its meaningful/signified cursor; the list
  // rows stay retained and only the viewport anchor moves after step settle.
  const directionsCursorDocumentId = directionsPane
    ? directionsPane.cursorDocumentId ?? directionsPane.documentId
    : null;
  const directionsActiveDocFromListRow =
    directionsPane != null &&
    activeDoc?.id != null &&
    activeDoc.id !== directionsPane.documentId &&
    activeDoc.id !== directionsCursorDocumentId &&
    Boolean(timedChartListRowLinkDocumentIds[activeDoc.id]);
  const directionsActiveDocBelongs =
    directionsPane != null &&
    !directionsActiveDocFromListRow &&
    (activeDoc?.id === directionsPane.documentId ||
      activeDoc?.id === directionsCursorDocumentId ||
      activeDoc?.parentDocumentId === directionsPane.documentId);
  const directionsLiveFocusDatetime = directionsActiveDocBelongs
    ? (chart?.document?.documentId === activeDoc?.id
        ? chart?.document?.symbolicTime?.signifiedDatetime ?? chart?.document?.displayDatetime
        : null) ??
      activeDoc?.symbolicTime?.signifiedDatetime ??
      activeDoc?.displayDatetime ??
      null
    : null;
  const transitListActiveDocFromListRow =
    transitListPane != null &&
    activeDoc?.id != null &&
    activeDoc.id !== transitListPane.documentId &&
    Boolean(timedChartListRowLinkDocumentIds[activeDoc.id]);
  const transitListActiveDocBelongs =
    transitListPane != null &&
    !transitListActiveDocFromListRow &&
    activeDoc?.parentDocumentId === transitListPane.documentId &&
    (
      activeDoc?.supplementaryFeatureKind === "transits" ||
      activeDoc?.supplementaryFeatureKind === "converse-transits"
    );
  const transitListLiveFocusDatetime = transitListActiveDocBelongs
    ? (chart?.document?.documentId === activeDoc?.id
        ? chart?.document?.symbolicTime?.signifiedDatetime ?? chart?.document?.displayDatetime
        : null) ??
      activeDoc?.symbolicTime?.signifiedDatetime ??
      activeDoc?.displayDatetime ??
      null
    : null;
  const synodicCyclesActiveDocFromListRow =
    synodicCyclesPane != null &&
    activeDoc?.id != null &&
    activeDoc.id !== synodicCyclesPane.documentId &&
    Boolean(timedChartListRowLinkDocumentIds[activeDoc.id]);
  const synodicCyclesActiveDocBelongs =
    synodicCyclesPane != null &&
    !synodicCyclesActiveDocFromListRow &&
    (activeDoc?.id === synodicCyclesPane.documentId ||
      activeDoc?.parentDocumentId === synodicCyclesPane.documentId);
  const synodicCyclesLiveFocusDatetime = synodicCyclesActiveDocBelongs
    ? (chart?.document?.documentId === activeDoc?.id
        ? chart?.document?.symbolicTime?.signifiedDatetime ?? chart?.document?.displayDatetime
        : null) ??
      activeDoc?.symbolicTime?.signifiedDatetime ??
      activeDoc?.displayDatetime ??
      null
    : null;
  const aspectListActiveDocFromListRow =
    aspectListPane != null &&
    activeDoc?.id != null &&
    Boolean(timedChartListRowLinkDocumentIds[activeDoc.id]);
  const aspectListLiveContextDocument =
    aspectListPane != null &&
    !aspectListActiveDocFromListRow &&
    isAspectListQueryHostDocument(activeDoc)
      ? activeDoc
      : null;
  const aspectListLiveFocusDatetime = aspectListLiveContextDocument
    ? (chart?.document?.documentId === aspectListLiveContextDocument.id
        ? chart?.document?.symbolicTime?.signifiedDatetime ?? chart?.document?.displayDatetime
        : null) ??
      aspectListLiveContextDocument.symbolicTime?.signifiedDatetime ??
      aspectListLiveContextDocument.displayDatetime ??
      null
    : null;
  // Presentation memory of the last live focus. A row-link open must not move
  // the list AT ALL — including snapping back to the pane's open-time focus
  // after live follow has drifted (stepping). Hold whatever the list was
  // following just before the click; reset when the pane itself is reopened.
  const [lastDirectionsLiveFocus, setLastDirectionsLiveFocus] = useState<string | null>(null);
  const [lastTransitListLiveFocus, setLastTransitListLiveFocus] = useState<string | null>(null);
  const [lastSynodicCyclesLiveFocus, setLastSynodicCyclesLiveFocus] = useState<string | null>(null);
  const lastAspectListLiveFocusRef = useRef<{
    paneIdentity: string | null;
    focusDatetime: string | null;
  }>({ paneIdentity: null, focusDatetime: null });
  const [retainedAspectListFocus, setRetainedAspectListFocus] = useState<{
    paneIdentity: string;
    focusDatetime: string | null;
  } | null>(null);
  const [lastAspectListContext, setLastAspectListContext] = useState<{
    paneIdentity: string;
    documentId: string;
  } | null>(null);
  const directionsPaneIdentity = directionsPane
    ? `${directionsPane.documentId}:${directionsPane.openSeq ?? 0}`
    : null;
  const transitListPaneIdentity = transitListPane
    ? `${transitListPane.documentId}:${transitListPane.openSeq ?? 0}`
    : null;
  const synodicCyclesPaneIdentity = synodicCyclesPane
    ? `${synodicCyclesPane.documentId}:${synodicCyclesPane.openSeq ?? 0}`
    : null;
  const aspectListPaneIdentity = aspectListPane
    ? `${aspectListPane.documentId}:${aspectListPane.openSeq ?? 0}`
    : null;
  useEffect(() => {
    queueMicrotask(() => setLastDirectionsLiveFocus(null));
  }, [directionsPaneIdentity]);
  useEffect(() => {
    queueMicrotask(() => setLastTransitListLiveFocus(null));
  }, [transitListPaneIdentity]);
  useEffect(() => {
    queueMicrotask(() => setLastSynodicCyclesLiveFocus(null));
  }, [synodicCyclesPaneIdentity]);
  useEffect(() => {
    if (!directionsLiveFocusDatetime) return;
    queueMicrotask(() =>
      setLastDirectionsLiveFocus((prev) =>
        prev === directionsLiveFocusDatetime ? prev : directionsLiveFocusDatetime,
      ),
    );
  }, [directionsLiveFocusDatetime]);
  useEffect(() => {
    if (!transitListLiveFocusDatetime) return;
    queueMicrotask(() =>
      setLastTransitListLiveFocus((prev) =>
        prev === transitListLiveFocusDatetime ? prev : transitListLiveFocusDatetime,
      ),
    );
  }, [transitListLiveFocusDatetime]);
  useEffect(() => {
    if (!synodicCyclesLiveFocusDatetime) return;
    queueMicrotask(() =>
      setLastSynodicCyclesLiveFocus((prev) =>
        prev === synodicCyclesLiveFocusDatetime ? prev : synodicCyclesLiveFocusDatetime,
      ),
    );
  }, [synodicCyclesLiveFocusDatetime]);
  useLayoutEffect(() => {
    const tracked = lastAspectListLiveFocusRef.current;
    if (tracked.paneIdentity !== aspectListPaneIdentity) {
      lastAspectListLiveFocusRef.current = {
        paneIdentity: aspectListPaneIdentity,
        focusDatetime: aspectListLiveFocusDatetime,
      };
      return;
    }
    if (aspectListLiveFocusDatetime) {
      tracked.focusDatetime = aspectListLiveFocusDatetime;
    }
  }, [aspectListLiveFocusDatetime, aspectListPaneIdentity]);
  useEffect(() => {
    let cancelled = false;
    const retainCurrentFocus = aspectListPaneIdentity && !aspectListLiveContextDocument;
    const tracked = lastAspectListLiveFocusRef.current;
    const focusDatetime =
      tracked.paneIdentity === aspectListPaneIdentity
        ? tracked.focusDatetime
        : aspectListPane?.focusDatetime ?? null;
    queueMicrotask(() => {
      if (cancelled) return;
      setRetainedAspectListFocus((current) => {
        if (!retainCurrentFocus) return current === null ? current : null;
        if (
          current?.paneIdentity === aspectListPaneIdentity &&
          current.focusDatetime === focusDatetime
        ) {
          return current;
        }
        return { paneIdentity: aspectListPaneIdentity, focusDatetime };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [aspectListLiveContextDocument, aspectListPane?.focusDatetime, aspectListPaneIdentity]);
  useEffect(() => {
    if (!aspectListPaneIdentity || !aspectListLiveContextDocument) return;
    queueMicrotask(() =>
      setLastAspectListContext((previous) =>
        previous?.paneIdentity === aspectListPaneIdentity &&
        previous.documentId === aspectListLiveContextDocument.id
          ? previous
          : {
              paneIdentity: aspectListPaneIdentity,
              documentId: aspectListLiveContextDocument.id,
            },
      ),
    );
  }, [aspectListLiveContextDocument, aspectListPaneIdentity]);

  if (featureCatalogPane) {
    return (
      <RightInspectorPaneFrame kind="feature-catalog">
        {featureCatalogPane.content === "help" ? (
          <HelpView
            key={featureCatalogPane.openSeq}
            onClose={closeFeatureCatalogPane}
          />
        ) : featureCatalogPane.content === "whats-new" ? (
          <WhatsNewView
            key={featureCatalogPane.openSeq}
            version={featureCatalogPane.version ?? ""}
            notes={featureCatalogPane.notes ?? ""}
            onClose={closeFeatureCatalogPane}
          />
        ) : featureCatalogPane.content === "license" ||
          featureCatalogPane.content === "notices" ? (
          <LegalDocumentView
            key={featureCatalogPane.openSeq}
            document={featureCatalogPane.content}
            onClose={closeFeatureCatalogPane}
          />
        ) : (
          <FeatureCatalogView
            key={featureCatalogPane.openSeq}
            onClose={closeFeatureCatalogPane}
          />
        )}
      </RightInspectorPaneFrame>
    );
  }

  if (calendarPane) {
    return (
      <RightInspectorPaneFrame kind="calendar">
        <CalendarPrototypeView onClose={closeCalendarPane} />
      </RightInspectorPaneFrame>
    );
  }

  if (transitSearchPane) {
    const searchDocument = daemonDocuments.find(
      (doc) => doc.documentId === transitSearchPane.documentId,
    );
    const transitSearchPaneKey = JSON.stringify({
      documentId: transitSearchPane.documentId,
      significatorId: transitSearchPane.significatorId ?? null,
      chartRole: transitSearchPane.chartRole ?? null,
      customPoints: transitSearchPane.customPoints ?? [],
    });
    return (
      <RightInspectorPaneFrame kind="transit-search">
        <TransitSearchView
          key={transitSearchPaneKey}
          mode="context"
          documentId={transitSearchPane.documentId}
          sourceName={searchDocument?.sourceName ?? searchDocument?.subtitle ?? ""}
          significatorId={transitSearchPane.significatorId}
          chartRole={transitSearchPane.chartRole}
          customPoints={transitSearchPane.customPoints}
          label={transitSearchPane.label}
          glyph={transitSearchPane.glyph}
          followPolicy={transitSearchPane.followPolicy}
          onClose={closeTransitSearchPane}
        />
      </RightInspectorPaneFrame>
    );
  }

  if (transitListPane) {
    const transitListFocusDatetime = resolveListFocusDatetime(
      transitListPane.followPolicy,
      transitListLiveFocusDatetime,
      lastTransitListLiveFocus ?? transitListPane.focusDatetime,
    );
    return (
      <RightInspectorPaneFrame kind="directions">
        <TransitListView
          key={`${transitListPane.documentId}:${transitListPane.openSeq ?? 0}`}
          documentId={transitListPane.documentId}
          sourceName={transitListPane.sourceName}
          focusDatetime={transitListFocusDatetime ?? undefined}
          onClose={closeTransitListPane}
        />
      </RightInspectorPaneFrame>
    );
  }

  if (synodicCyclesPane) {
    const synodicCyclesFocusDatetime = resolveListFocusDatetime(
      synodicCyclesPane.followPolicy,
      synodicCyclesLiveFocusDatetime,
      lastSynodicCyclesLiveFocus ?? synodicCyclesPane.focusDatetime,
    );
    return (
      <RightInspectorPaneFrame kind="directions">
        <SynodicCycleListView
          key={`${synodicCyclesPane.documentId}:${synodicCyclesPane.openSeq ?? 0}`}
          documentId={synodicCyclesPane.documentId}
          sourceName={synodicCyclesPane.sourceName}
          focusDatetime={synodicCyclesFocusDatetime ?? undefined}
          onClose={closeSynodicCyclesPane}
        />
      </RightInspectorPaneFrame>
    );
  }

  if (aspectListPane) {
    const retainedContextDocumentId =
      lastAspectListContext?.paneIdentity === aspectListPaneIdentity
        ? lastAspectListContext.documentId
        : null;
    const contextDocumentId =
      aspectListLiveContextDocument?.id ??
      retainedContextDocumentId ??
      aspectListPane.documentId;
    const contextDocument =
      aspectListLiveContextDocument?.id === contextDocumentId
        ? aspectListLiveContextDocument
        : daemonDocuments.find((document) => document.documentId === contextDocumentId);
    const retainedAspectListLiveFocus =
      retainedAspectListFocus?.paneIdentity === aspectListPaneIdentity
        ? retainedAspectListFocus.focusDatetime
        : null;
    const aspectListFocusDatetime = resolveListFocusDatetime(
      aspectListPane.followPolicy,
      aspectListLiveFocusDatetime,
      retainedAspectListLiveFocus ?? aspectListPane.focusDatetime,
    );
    return (
      <RightInspectorPaneFrame kind="aspect-list">
        <AspectListPanel
          key={`${aspectListPane.documentId}:${aspectListPane.openSeq ?? 0}`}
          documentId={contextDocumentId}
          parentDocumentId={contextDocument?.parentDocumentId ?? null}
          preferencesDocumentId={aspectListPane.documentId}
          sourceName={contextDocument?.sourceName ?? aspectListPane.sourceName}
          focusDatetime={aspectListFocusDatetime ?? undefined}
          contextRevision={aspectListContextRevision(chart, contextDocumentId)}
          comparisonVisible={
            chart?.document?.documentId === contextDocumentId
              ? chart.comparisonChart != null
              : undefined
          }
          onClose={closeAspectListPane}
        />
      </RightInspectorPaneFrame>
    );
  }

  if (directionsPane) {
    const cursorDocumentId = directionsPane.cursorDocumentId ?? directionsPane.documentId;
    const focusDocumentId = directionsActiveDocBelongs
      ? activeDoc?.id ?? cursorDocumentId
      : cursorDocumentId;
    const directionsFocusDatetime = resolveListFocusDatetime(
      directionsPane.followPolicy,
      directionsLiveFocusDatetime,
      lastDirectionsLiveFocus ?? directionsPane.focusDatetime,
    );
    return (
      <RightInspectorPaneFrame kind="directions">
        <DirectionsView
          sourceName={directionsPane.sourceName}
          source={directionsPane.source}
          documentId={directionsPane.documentId}
          cursorDocumentId={cursorDocumentId}
          focusDocumentId={focusDocumentId}
          focusDatetime={directionsFocusDatetime ?? undefined}
          followStepBursts={
            directionsActiveDocBelongs && activeDoc?.launcherKind === "pd_in_chart"
          }
          openSeq={directionsPane.openSeq}
          initialTab={directionsPane.initialTab}
          initialPrimaryMode={directionsPane.initialPrimaryMode}
          initialPrimaryDirection={directionsPane.initialPrimaryDirection}
          secondaryMethod={directionsPane.secondaryMethod}
          customSignificator={directionsPane.customSignificator ?? null}
          followPolicy={directionsPane.followPolicy}
          onClose={closeDirectionsPane}
        />
      </RightInspectorPaneFrame>
    );
  }

  if (timeLordPane) {
    return (
      <RightInspectorPaneFrame kind="directions">
        <TimeLordPaneView
          documentId={timeLordPane.documentId}
          sourceName={timeLordPane.sourceName}
          tableId={timeLordPane.tableId}
          followPolicy={timeLordPane.followPolicy}
          onClose={closeTimeLordPane}
        />
      </RightInspectorPaneFrame>
    );
  }

  if (eclipsesPane) {
    return (
      <RightInspectorPaneFrame kind="eclipses">
        <EclipsesView
          documentId={eclipsesPane.documentId}
          sourceName={eclipsesPane.sourceName}
          onClose={closeEclipsesPane}
        />
      </RightInspectorPaneFrame>
    );
  }

  if (lunarMansionsPane) {
    return (
      <RightInspectorPaneFrame kind="lunar-mansions">
        <LunarMansionsView
          documentId={lunarMansionsPane.documentId}
          sourceName={lunarMansionsPane.sourceName}
          onClose={closeLunarMansionsPane}
        />
      </RightInspectorPaneFrame>
    );
  }

  if (ascensionalTransitsPane) {
    const ascensionalDocument = daemonDocuments.find(
      (doc) => doc.documentId === ascensionalTransitsPane.documentId,
    );
    const activeAscensionalDoc =
      activeDoc?.id === ascensionalTransitsPane.documentId ? activeDoc : null;
    return (
      <RightInspectorPaneFrame kind="ascensional-transits">
        <AscensionalTransitsPane
          key={ascensionalTransitsPane.documentId}
          documentId={ascensionalTransitsPane.documentId}
          sourceName={
            activeAscensionalDoc?.sourceName ??
            ascensionalDocument?.sourceName ??
            ascensionalDocument?.subtitle ??
            ascensionalTransitsPane.sourceName
          }
          ascensionalEventJd={
            activeAscensionalDoc?.ascensionalEventJd ??
            ascensionalDocument?.ascensionalEventJd ??
            ascensionalTransitsPane.ascensionalEventJd ??
            null
          }
          ascensionalEventPlace={
            activeAscensionalDoc?.ascensionalEventPlace ??
            ascensionalDocument?.ascensionalEventPlace ??
            ascensionalTransitsPane.ascensionalEventPlace ??
            null
          }
          ascensionalFilterToActiveMoment={
            activeAscensionalDoc?.ascensionalFilterToActiveMoment ??
            ascensionalDocument?.ascensionalFilterToActiveMoment ??
            ascensionalTransitsPane.ascensionalFilterToActiveMoment ??
            true
          }
          ascensionalApplyPrecession={
            activeAscensionalDoc?.ascensionalApplyPrecession ??
            ascensionalDocument?.ascensionalApplyPrecession ??
            ascensionalTransitsPane.ascensionalApplyPrecession ??
            true
          }
          onClose={closeAscensionalTransitsPane}
        />
      </RightInspectorPaneFrame>
    );
  }

  if (styleEditorOpen) {
    return (
      <RightInspectorPaneFrame kind="chart-style">
        <ChartStylePanel
          applyThemeToApp
          onClose={() => setStyleEditorOpen(false)}
        />
      </RightInspectorPaneFrame>
    );
  }

  if (!inspectorOpen && !notesOpen) return null;

  // Notes are anchored to the radix — derived docs (transits, SR, …) share the
  // radix's notes file. For a biwheel the radix is the inner/primary chart, so
  // its name resolves the notes file directly from the daemon chart payload
  // (no dependency on the workspace tree).
  const notesSourceName = chart?.primaryChart.meta.name ?? null;
  const showNotes = notesOpen && notesSourceName !== null;
  const notesDocumentId = activeDoc?.parentDocumentId ?? activeDoc?.id;
  const notesScratch = Boolean(activeDoc && activeDoc.parentDocumentId === null && !activeDoc.fpath);

  if (inspectorOpen && showNotes) {
    return (
      <ResizablePanelGroup autoSaveId="aries.inspector-vs-notes" direction="vertical" className="h-full">
        <ResizablePanel defaultSize={55} minSize={20} className="min-h-0">
          <InspectorPanel chart={chart} />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={45} minSize={20} className="min-h-0">
          <NotesPanel
            sourceName={notesSourceName}
            chart={chart}
            documentId={notesDocumentId}
            scratch={notesScratch}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  return (
    <div className="h-full w-full min-w-0">
      {inspectorOpen ? <InspectorPanel chart={chart} /> : null}
      {showNotes ? (
        <NotesPanel
          sourceName={notesSourceName}
          chart={chart}
          documentId={notesDocumentId}
          scratch={notesScratch}
        />
      ) : null}
    </div>
  );
}

function RightInspectorPaneFrame({
  kind,
  children,
}: {
  kind: RightPaneModuleKind;
  children: React.ReactNode;
}) {
  const policy = rightPaneWidthPolicy(kind);
  return (
    <div
      data-aries-surface="panel"
      data-right-inspector-pane={kind}
      data-right-pane-role={policy.role}
      className="h-full w-full min-w-0 overflow-hidden [&>*]:bg-transparent"
      style={
        {
          "--right-pane-min-content-width": `${policy.minContentWidth}px`,
          "--right-pane-preferred-width": `${policy.preferredWidth}px`,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

function useElementSize(element: HTMLElement | null) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!element) {
      return;
    }

    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return size;
}

function resolvePalette(chart: ChartRenderSnapshot["primaryChart"]): ChartPalette {
  return {
    background: chart.palette?.background ?? "rgb(35 36 40)",
    frame: chart.palette?.frame ?? "rgb(220 220 221)",
    signs: chart.palette?.signs ?? "rgb(215 215 217)",
    angles: chart.palette?.angles ?? "rgb(205 205 209)",
    houses: chart.palette?.houses ?? "rgb(138 139 141)",
    houseNums: chart.palette?.houseNums ?? "rgb(59 59 60)",
    positions: chart.palette?.positions ?? "rgb(255 255 255)",
    peregrin: chart.palette?.peregrin ?? "rgb(205 205 209)",
    domicil: chart.palette?.domicil ?? "rgb(2 191 2)",
    exil: chart.palette?.exil ?? "rgb(255 0 0)",
    exal: chart.palette?.exal ?? "rgb(255 215 0)",
    casus: chart.palette?.casus ?? "rgb(205 92 92)",
    textDim: chart.palette?.textDim ?? "rgb(153 154 156)",
    textBright: chart.palette?.textBright ?? "rgb(220 220 221)",
    fortune: chart.palette?.fortune ?? "rgb(205 205 209)",
    planets: chart.palette?.planets ?? [],
    aspects: chart.palette?.aspects ?? [],
  };
}

function splitOverlayRows(rows: OverlayInfoRow[]) {
  // The daemon ALWAYS tags `group` on overlay rows (export_chart_json
  // .export_overlay), so the skin consumes row.group directly — no inference.
  return {
    dayhour: rows.filter((row) => row.group === "dayhour"),
    header: rows.filter((row) => row.group === "header"),
    signal: rows.filter((row) => row.group === "signal"),
  };
}

function overlayTypographyCss(
  wheelStyle: WheelRenderStyle,
  classId: WheelChartOverlayClass,
  defaults: Readonly<{
    font: string;
    size: number;
    color: string;
  }>,
): React.CSSProperties {
  const paint = resolveWheelTypographyPaint(
    wheelStyle,
    wheelStyle.authoringTargetProfile,
    classId,
    wheelStyle.authoringTargetRadius,
    defaults,
  );
  return {
    color: paint.color,
    fontFamily: paint.font,
    fontSize: paint.size,
    fontWeight: paint.weight,
    fontStyle: paint.style,
    letterSpacing: paint.tracking,
    opacity: paint.opacity,
  };
}

function CornerLines({
  semanticClassId,
  wheelStyle,
  lines,
  color,
  fontSize,
  gap,
  lineHeight,
  style,
}: {
  semanticClassId: WheelChartOverlayClass;
  wheelStyle: WheelRenderStyle;
  lines: string[];
  color: string;
  fontSize: number;
  gap: number;
  lineHeight: number;
  style: React.CSSProperties;
}) {
  if (!lines.length || fontSize <= 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute z-10 select-none font-ui"
      style={{
        ...style,
        ...overlayTypographyCss(wheelStyle, semanticClassId, {
          font: wheelStyle.typography.families.ui,
          size: fontSize,
          color,
        }),
        lineHeight,
      }}
    >
      <div className="flex flex-col" style={{ gap }}>
        {lines.map((line) => (
          <div
            key={`${line}-${fontSize}`}
            data-aries-style-class={semanticClassId}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

function OverlayCorner({
  wheelStyle,
  sections,
  palette,
  labelSize,
  iconSize,
  lineHeight,
  gapAfterDayHour,
  gapBetweenGroups,
  columnGap,
  glyphLineHeight,
  maxWidth,
  style,
}: {
  wheelStyle: WheelRenderStyle;
  sections: ReturnType<typeof splitOverlayRows>;
  palette: ChartPalette;
  labelSize: number;
  iconSize: number;
  lineHeight: number;
  gapAfterDayHour: number;
  gapBetweenGroups: number;
  columnGap: number;
  glyphLineHeight: number;
  maxWidth?: string;
  style: React.CSSProperties;
}) {
  const hasRows = sections.dayhour.length || sections.header.length || sections.signal.length;
  if (!hasRows || labelSize <= 0 || iconSize <= 0) {
    return null;
  }

  const rows: Array<OverlayInfoRow | { spacer: true; height: number; key: string }> = [];
  rows.push(...sections.dayhour);
  if (sections.dayhour.length && sections.header.length) {
    rows.push({ spacer: true, height: gapAfterDayHour, key: "gap-dayhour-header" });
  }
  rows.push(...sections.header);
  if ((sections.dayhour.length || sections.header.length) && sections.signal.length) {
    rows.push({ spacer: true, height: gapBetweenGroups, key: "gap-header-signal" });
  }
  rows.push(...sections.signal);

  return (
    <div
      className="pointer-events-none absolute z-10 select-none font-ui"
      style={{ ...style, maxWidth }}
    >
      <div
        className="grid items-center justify-end"
        style={{
          gridTemplateColumns: "max-content max-content max-content",
          columnGap,
        }}
      >
        {rows.map((row, index) => {
          if ("spacer" in row) {
            return (
              <div
                key={row.key}
                style={{ gridColumn: "1 / -1", height: row.height }}
              />
            );
          }
          return (
            <OverlayRow
              key={`${overlayRowIdentity(row)}-${index}`}
              wheelStyle={wheelStyle}
              row={row}
              palette={palette}
              labelSize={labelSize}
              iconSize={iconSize}
              lineHeight={lineHeight}
              glyphLineHeight={glyphLineHeight}
            />
          );
        })}
      </div>
    </div>
  );
}

function overlayRowIdentity(row: OverlayInfoRow): string {
  const glyphs = row.glyphs
    .map((glyph) => `${glyph.kind ?? ""}:${glyph.seId ?? ""}:${glyph.char}`)
    .join("|");
  return `${row.group ?? "row"}:${row.label}:${glyphs}`;
}

function overlayEventClass(
  group: OverlayInfoRow["group"],
  component: "label" | "glyph" | "trailing",
): WheelChartOverlayClass {
  if (group === "dayhour") {
    return `chartOverlay.events.dayHour.${component}`;
  }
  if (group === "header") {
    return `chartOverlay.events.header.${component}`;
  }
  return `chartOverlay.events.signal.${component}`;
}

function OverlayRow({
  wheelStyle,
  row,
  palette,
  labelSize,
  iconSize,
  lineHeight,
  glyphLineHeight,
}: {
  wheelStyle: WheelRenderStyle;
  row: OverlayInfoRow;
  palette: ChartPalette;
  labelSize: number;
  iconSize: number;
  lineHeight: number;
  glyphLineHeight: number;
}) {
  const firstGlyph = row.glyphs[0] ?? null;
  const secondGlyph = row.group === "header" ? (row.glyphs[1] ?? null) : null;
  const trailingText = row.group === "header" ? "" : (row.trailing ?? "");
  const labelClass = overlayEventClass(row.group, "label");
  const glyphClass = overlayEventClass(row.group, "glyph");
  const trailingClass = overlayEventClass(row.group, "trailing");
  const rowBoxStyle: React.CSSProperties = {
    height: lineHeight,
    lineHeight: `${lineHeight}px`,
    display: "flex",
    alignItems: "center",
  };
  return (
    <>
      <div
        className="justify-self-start whitespace-nowrap"
        data-aries-style-class={labelClass}
        style={{
          ...rowBoxStyle,
          ...overlayTypographyCss(wheelStyle, labelClass, {
            font: wheelStyle.typography.families.ui,
            size: labelSize,
            color: palette.textDim,
          }),
        }}
      >
        {row.label}
      </div>
      <div
        className="justify-self-start whitespace-nowrap font-symbols leading-none"
        style={rowBoxStyle}
      >
        {firstGlyph ? (
          <span
            data-aries-style-class={glyphClass}
            style={{
              ...overlayTypographyCss(wheelStyle, glyphClass, {
                font: wheelStyle.typography.families.symbols,
                size: iconSize,
                color: overlayGlyphColor(firstGlyph, palette),
              }),
              lineHeight: glyphLineHeight,
            }}
          >
            {firstGlyph.char}
          </span>
        ) : null}
      </div>
      <div
        className="justify-self-start whitespace-nowrap"
        data-aries-style-class={
          secondGlyph || trailingText ? trailingClass : undefined
        }
        style={{
          ...rowBoxStyle,
          ...overlayTypographyCss(wheelStyle, trailingClass, {
            font: secondGlyph
              ? wheelStyle.typography.families.symbols
              : wheelStyle.typography.families.ui,
            size: secondGlyph ? iconSize : labelSize,
            color: secondGlyph
              ? overlayGlyphColor(secondGlyph, palette)
              : palette.textDim,
          }),
        }}
      >
        {secondGlyph ? (
          <span
            className="font-symbols leading-none"
            data-aries-style-class={trailingClass}
            style={{
              lineHeight: glyphLineHeight,
            }}
          >
            {secondGlyph.char}
          </span>
        ) : (
          trailingText
        )}
      </div>
    </>
  );
}

function overlayGlyphColor(
  glyph: OverlayInfoRow["glyphs"][number],
  palette: ChartPalette,
) {
  return glyph.color ?? (
    glyph.kind === "planet" && glyph.seId != null
      ? (palette.planets[glyph.seId] ?? palette.textDim)
      : palette.textDim
  );
}

export function StatusBar({
  chart,
  onOpenSettings,
}: {
  chart: ChartRenderSnapshot | null;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const sidebarOpen = useFrameLayoutStore((s) => s.sidebarOpen);
  const baseFields = chart
    ? (chart.comparisonChart?.meta.statusFields ?? chart.primaryChart.meta.statusFields ?? [t("toolbar.loadingChart")])
    : [];
  // Signified-real-time + age readout for an open progression/PD child. The daemon
  // derives these from the live symbolic chart/session (workspace_service
  // _symbolic_time_readout, matching morin.py:5562 "Real:"/chart_context_view
  // age status) so the skin only appends the prebuilt strings — no symbolic math
  // in TS. Mirrors the desktop status line which shows Real-date + Age for an
  // active progression session (chart_context_view.py:266-279).
  const symbolicTime = chart?.document?.symbolicTime ?? null;
  const fields = symbolicTime
    ? [...baseFields, symbolicTime.realText, symbolicTime.ageText]
    : baseFields;
  const buildField = fields[0] ?? "";
  const contentFields = fields.length > 1 ? fields.slice(1) : fields;
  const [nameField = "", typeField = "", datetimeField = "", longitudeField = "", latitudeField = "", ...extraFields] =
    contentFields;
  const coordinateField = [longitudeField, latitudeField].filter(Boolean).join(", ");
  const detailField = [coordinateField, ...extraFields].filter(Boolean).join("  ");
  // Status-bar sizing lives in INLINE STYLES, deliberately — not Tailwind
  // utilities and not a CSS grid. The previous grid used `var(--sidebar-width)
  // minmax(0,1fr)` columns plus inner `minmax(0,3fr) minmax(0,2fr)` fractional
  // tracks. That collapsed intermittently on cold start, verified live in
  // Tauri's WKWebView: (1) fr grid tracks are sized against the container width
  // at the first-paint frame and are not reliably recomputed when the window
  // reaches full size — the fields stayed pinned at ~12px until a style
  // mutation (e.g. moving the sidebar, which rewrites `--sidebar-width`) forced
  // a recalc; (2) the widths were arbitrary Tailwind values (`w-[160px]`,
  // `3fr/2fr` tracks) and the CSS pipeline can fail to emit newly-added
  // arbitrary utilities, leaving the tracks with no width at all. Inline flex
  // sidesteps both: flex main-size reflows on every resize, and inline style
  // always applies with zero dependency on class generation. The
  // `var(--sidebar-width, …)` fallback keeps the leader cell from collapsing if
  // the custom property is momentarily unresolved at first paint.
  const leftCellWidth = sidebarOpen
    ? `var(--sidebar-width, ${SIDEBAR_STARTUP_WIDTH}px)`
    : "0px";
  return (
    <footer
      data-aries-surface="statusbar"
      className="relative z-20 flex h-[var(--morinus-status-height)] w-full shrink-0 select-none overflow-hidden bg-[color:var(--aries-statusbar-background)] text-[length:var(--aries-font-size-statusbar)] font-normal leading-none text-[color:var(--aries-statusbar-text)]"
    >
      <div
        className="flex h-full shrink-0 items-center gap-[var(--aries-statusbar-gap)] overflow-hidden bg-transparent px-[var(--morinus-nav-side-margin)]"
        style={{ width: leftCellWidth }}
      >
        {sidebarOpen ? (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={t("toolbar.settings")}
            title={t("toolbar.settings")}
            className="flex size-[var(--aries-statusbar-action-size)] shrink-0 items-center justify-center rounded-[var(--aries-toolbar-control-radius)] text-[length:var(--aries-font-size-nav)] text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Settings className="size-[var(--aries-control-icon-size)] shrink-0" />
          </button>
        ) : null}
        {sidebarOpen && buildField ? <StatusText>{buildField}</StatusText> : null}
      </div>
      <div
        className="flex h-full items-center overflow-hidden bg-transparent"
        style={{ flex: "1 1 0%", minWidth: 0 }}
      >
        <StatusField style={{ flex: "0 0 var(--aries-statusbar-name-width)" }}>{nameField}</StatusField>
        <StatusField style={{ flex: "0 0 var(--aries-statusbar-kind-width)" }}>{typeField}</StatusField>
        <StatusField style={{ flex: "var(--aries-statusbar-datetime-grow) 1 0%" }}>{datetimeField}</StatusField>
        <StatusField style={{ flex: "var(--aries-statusbar-detail-grow) 1 0%" }}>{detailField}</StatusField>
      </div>
    </footer>
  );
}

function StatusField({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  // Sizing (flex-basis / grow) arrives via inline `style` so it never depends on
  // Tailwind emitting an arbitrary width/flex class. `minWidth: 0` lets the
  // growable fields shrink below content width so their text truncates.
  return (
    <span
      className="flex h-full items-center overflow-hidden px-[var(--aries-statusbar-field-padding-x)] leading-none"
      style={{ minWidth: 0, ...style }}
    >
      <StatusText>{children}</StatusText>
    </span>
  );
}

function StatusText({ children }: { children: React.ReactNode }) {
  return (
    <span className="block h-[var(--aries-statusbar-line-box)] w-full min-w-0 truncate leading-[var(--aries-statusbar-line-box)]">
      {children}
    </span>
  );
}
