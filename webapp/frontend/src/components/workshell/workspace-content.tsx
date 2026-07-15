// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { ChevronLeft, ChevronRight, Coffee, PanelLeft, NotebookPen, Pencil, ScrollText, Search, Settings } from "lucide-react";

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
import type { ChartPalette, ChartRenderSnapshot, OverlayInfoRow } from "@/lib/chart/types";
import { useT, type TFunc } from "@/lib/i18n/i18n";
import { resolveListFocusDatetime } from "@/lib/list-follow-policy";
import { cn } from "@/lib/utils";

import { ChartCanvas } from "./chart-canvas";
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
import { useAstrocartMapUrl } from "@/hooks/use-astrocart-map-url";
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
  type AstrocartHereAction,
  type AstrocartLineMode,
  type AstrocartViewState,
  type OptionsPayload,
} from "@/lib/daemon/client";
import { isAbortError, isTransientDaemonFetchError } from "@/lib/abort-error";
import { resolveShellHost } from "@/lib/shell-host";
import type { SettingsTabId } from "./settings-dialog";

const AstrolabeView = dynamic(
  () => import("./astrolabe-view").then((mod) => mod.AstrolabeView),
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
const GraphEphemerisView = dynamic(
  () => import("./graph-ephemeris-view").then((mod) => mod.GraphEphemerisView),
  { loading: () => null },
);
const InspectorPanel = dynamic(
  () => import("./inspector-panel").then((mod) => mod.InspectorPanel),
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

type Props = {
  chart: ChartRenderSnapshot | null;
  activeDoc: WorkspaceDocument | null;
  navbar?: ModeHintRailProps | null;
};

function isTimeLordTableId(value: string | null | undefined): value is TimeLordTableId {
  return (
    value === "firdaria" ||
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

type AstrocartModeCacheEntry = {
  sessionRevision: number;
  precision: "preview" | "precise";
  payload: AstrocartGeoJsonPayload;
};

type AstrocartModeRequest = {
  sessionRevision: number;
  controller: AbortController;
};

function composeAstrocartModePayload(
  modes: AstrocartLineMode[],
  sessionRevision: number,
  cache: Map<AstrocartLineMode, AstrocartModeCacheEntry>,
  fallbackMeta?: AstrocartGeoJsonMeta,
): { payload: AstrocartGeoJsonPayload; complete: boolean } {
  const features: unknown[] = [];
  let meta = { ...(fallbackMeta ?? {}) };
  let complete = true;
  for (const mode of modes) {
    const entry = cache.get(mode);
    if (!entry || entry.sessionRevision !== sessionRevision) {
      complete = false;
      continue;
    }
    features.push(...entry.payload.features);
    meta = { ...meta, ...(entry.payload.meta ?? {}) };
  }
  meta = {
    ...meta,
    composite: true,
    modes: [...modes],
    localSpaceAdditive: modes.includes("local_space"),
  };
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
              "absolute inset-0 flex min-h-0",
              active ? "z-10 visible" : "pointer-events-none invisible",
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
      <GraphEphemerisView
        key={activeDoc.id}
        documentId={activeDoc.id}
        sourceName={activeDoc.sourceName}
      />
    );
  }
  if (activeDoc?.kind === "transit-search") {
    return (
      <TransitSearchView
        key={activeDoc.id}
        documentId={activeDoc.id}
        sourceName={activeDoc.sourceName}
      />
    );
  }
  if (activeDoc?.kind === "table" && isTimeLordTableId(activeDoc.tableId)) {
    return (
      <TimeLordPaneView
        key={activeDoc.id}
        documentId={activeDoc.id}
        parentDocumentId={activeDoc.parentDocumentId}
        tableId={activeDoc.tableId}
        sourceName={activeDoc.sourceName}
      />
    );
  }
  if (activeDoc?.kind === "table" && activeDoc.tableId === "eclipses") {
    return (
      <EclipsesView
        key={activeDoc.id}
        documentId={activeDoc.id}
        parentDocumentId={activeDoc.parentDocumentId}
        sourceName={activeDoc.sourceName}
      />
    );
  }
  if (activeDoc?.kind === "table" && activeDoc.tableId === "synodic_cycles") {
    return (
      <SynodicCycleListView
        key={activeDoc.id}
        documentId={activeDoc.id}
        parentDocumentId={activeDoc.parentDocumentId}
        sourceName={activeDoc.sourceName}
      />
    );
  }
  if (activeDoc?.kind === "table" && activeDoc.tableId) {
    return (
      <GenericTableView
        key={activeDoc.id}
        documentId={activeDoc.id}
        parentDocumentId={activeDoc.parentDocumentId}
        tableId={activeDoc.tableId}
      />
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
    <div className="relative flex h-full w-full flex-1 min-h-0 items-center justify-center bg-background">
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
        <div className="mt-[5px] text-[13px] leading-tight">{splash.subtitle}</div>
        {/* Info lines — faithful to wx's mtexts 'FreeSoft' + 'Description'. */}
        <div className="mt-[10px] flex flex-col text-[9px] leading-[1.5] text-[color:var(--aries-text-muted)]">
          {splash.infoLines.map((line, index) => (
            <span key={`${index}:${line}`}>{line}</span>
          ))}
        </div>
        <a
          href={splash.supportUrl}
          onClick={handleSupportClick}
          className="mt-[10px] inline-flex items-center gap-1 text-[9px] leading-[1.5] text-[color:var(--aries-text-muted)] opacity-80 hover:underline"
        >
          <Coffee aria-hidden className="size-3" strokeWidth={1.6} />
          {splash.supportText}
        </a>
      </div>
    </div>
  );
}

function AstrocartSurface({
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
  const lastSessionChange = useDaemonWorkspaceStore((state) => state.lastSessionChange);
  const lastOptionsChange = useDaemonWorkspaceStore((state) => state.lastOptionsChange);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const latestViewStateRef = React.useRef<AstrocartViewState | null>(null);
  const saveViewStateTimerRef = React.useRef<number | null>(null);
  const completedEclipseKeyRef = React.useRef<string | null>(null);
  const completedDisplayStyleKeyRef = React.useRef<string | null>(null);
  const latestDisplayStyleRef = React.useRef<unknown>(null);
  const displayStyleRequestRef = React.useRef<AbortController | null>(null);
  const handledSessionChangeSeqRef = React.useRef(lastSessionChange?.seq ?? 0);
  const handledOptionsChangeSeqRef = React.useRef(lastOptionsChange?.seq ?? 0);
  const activeLineModesRef = React.useRef<AstrocartLineMode[]>(ASTROCART_DEFAULT_LINE_MODES);
  const activeDataContextRef = React.useRef<{
    dataGenerationKey: string;
    lineModes: AstrocartLineMode[];
    sessionRevision: number;
  } | null>(null);
  const modeDataCacheRef = React.useRef(new Map<AstrocartLineMode, AstrocartModeCacheEntry>());
  const modeDataRequestsRef = React.useRef(new Map<AstrocartLineMode, AstrocartModeRequest>());
  const astrocartMetaCacheRef = React.useRef<{
    sessionRevision: number;
    meta: AstrocartGeoJsonMeta;
  } | null>(null);
  const emptyMetaRequestRef = React.useRef<AstrocartModeRequest | null>(null);
  const modeDataDocumentRef = React.useRef(documentId);
  const lastRenderedSessionRevisionRef = React.useRef<number | null>(null);
  const initialCenterAppliedRef = React.useRef(false);
  const [readyUrl, setReadyUrl] = React.useState<string | null>(null);
  const [linesPushedFor, setLinesPushedFor] = React.useState<string | null>(null);
  const [sessionRevision, setSessionRevision] = React.useState(0);
  const [displayStyleRevision, setDisplayStyleRevision] = React.useState(1);
  const [lineModes, setLineModes] = React.useState<AstrocartLineMode[]>(ASTROCART_DEFAULT_LINE_MODES);
  const [viewStateReadyFor, setViewStateReadyFor] = React.useState<string | null>(null);
  const theme = useThemeStore((s) => s.theme);
  const bootTheme = theme?.mode === "light" ? "light" : "dark";
  const bootPageBg = bootTheme === "light" ? "#d9dde1" : "#1a1d21";
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
    titlebarSafeTop: 34,
  } as const));
  const url = useAstrocartMapUrl(mapBootOptions, { allowTileAdoption: !active });
  const lineModesKey = lineModes.join(",");
  const mapInstanceKey = `${documentId}:${url ?? "pending"}`;
  const dataGenerationKey = `${mapInstanceKey}:${lineModesKey}:${sessionRevision}`;
  const viewStateKey = `${documentId}:${url ?? "pending"}`;
  const iframeReady = !!url && readyUrl === url;
  const viewStateReady = iframeReady && viewStateReadyFor === viewStateKey;
  const linesPushed = linesPushedFor === dataGenerationKey;

  React.useEffect(() => {
    const documentChanged = modeDataDocumentRef.current !== documentId;
    modeDataDocumentRef.current = documentId;
    for (const request of modeDataRequestsRef.current.values()) {
      request.controller.abort();
    }
    modeDataRequestsRef.current.clear();
    emptyMetaRequestRef.current?.controller.abort();
    emptyMetaRequestRef.current = null;
    modeDataCacheRef.current.clear();
    astrocartMetaCacheRef.current = null;
    if (documentChanged) {
      lastRenderedSessionRevisionRef.current = null;
      initialCenterAppliedRef.current = false;
    }
    return () => {
      for (const request of modeDataRequestsRef.current.values()) {
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
      sessionRevision,
    };
  }, [dataGenerationKey, lineModes, sessionRevision]);

  React.useEffect(() => {
    const change = lastSessionChange;
    if (!change) return;
    if (handledSessionChangeSeqRef.current === change.seq) return;
    handledSessionChangeSeqRef.current = change.seq;
    if (change.changeReason === "display-overlay") return;
    const relevantIds = [documentId, parentDocumentId].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    const relevant =
      relevantIds.includes(change.docId ?? "") ||
      change.rebuiltChildIds.some((id) => relevantIds.includes(id));
    if (!relevant) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSessionRevision((revision) => revision + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, lastSessionChange, parentDocumentId]);

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
    iframeRef.current?.contentWindow?.postMessage(
      { type: "aries.setTheme", theme: bootTheme, pageBg: bootPageBg },
      "*",
    );
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "aries.setUiLabels",
        labels: { birthplaceMarker: t("astrocart.birthplaceMarker.title") },
      },
      "*",
    );
  }, [active, bootPageBg, bootTheme, iframeReady, t]);

  React.useEffect(() => {
    if (!active || !iframeReady || !url || viewStateReadyFor === viewStateKey) return;
    const controller = new AbortController();
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return;
    targetWindow.postMessage(
      { type: "aries.setStatePersistence", enabled: false },
      "*",
    );
    fetchAstrocartViewState(documentId, controller.signal)
      .then((viewState) => {
        if (controller.signal.aborted || iframeRef.current?.contentWindow !== targetWindow) return;
        latestViewStateRef.current = viewState;
        const restoredModes = normalizeAstrocartLineModes(viewState?.lineModes);
        activeLineModesRef.current = restoredModes;
        setLineModes(restoredModes);
        if (viewState) {
          targetWindow.postMessage({ type: "aries.applyState", state: viewState }, "*");
        }
        setViewStateReadyFor(viewStateKey);
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        console.error("[acg-view-state]", err);
        const fallbackModes = [...ASTROCART_DEFAULT_LINE_MODES];
        activeLineModesRef.current = fallbackModes;
        setLineModes(fallbackModes);
        setViewStateReadyFor(viewStateKey);
      });
    return () => controller.abort();
  }, [active, documentId, iframeReady, url, viewStateKey, viewStateReadyFor]);

  React.useEffect(() => {
    if (!active || !iframeReady || !url) return;
    const styleKey = `${documentId}:${url}:${displayStyleRevision}`;
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
        return response.json();
      })
      .then((payload) => {
        if (controller.signal.aborted || iframeRef.current?.contentWindow !== targetWindow) return;
        latestDisplayStyleRef.current = payload;
        targetWindow.postMessage({ type: "aries.setDisplayStyle", payload }, "*");
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
  }, [active, displayStyleRevision, documentId, iframeReady, url]);

  const persistViewState = React.useCallback((state: AstrocartViewState, immediate = false) => {
    latestViewStateRef.current = state;
    if (saveViewStateTimerRef.current != null) {
      window.clearTimeout(saveViewStateTimerRef.current);
      saveViewStateTimerRef.current = null;
    }
    const save = () => {
      saveViewStateTimerRef.current = null;
      const current = latestViewStateRef.current;
      if (!current) return;
      void storeAstrocartViewState(documentId, current).catch((err) => {
        console.error("[acg-view-state]", err);
      });
    };
    if (immediate) {
      save();
      return;
    }
    saveViewStateTimerRef.current = window.setTimeout(save, 240);
  }, [documentId]);

  const handleLineModeClick = React.useCallback((
    mode: AstrocartLineMode,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    const nextModes = toggleAstrocartLineMode(lineModes, mode, event.metaKey);
    activeLineModesRef.current = nextModes;
    setLineModes(nextModes);
    persistViewState(
      { ...(latestViewStateRef.current ?? {}), lineModes: nextModes },
      true,
    );
  }, [lineModes, persistViewState]);

  React.useEffect(() => {
    return () => {
      if (saveViewStateTimerRef.current != null) {
        window.clearTimeout(saveViewStateTimerRef.current);
        saveViewStateTimerRef.current = null;
      }
      const current = latestViewStateRef.current;
      if (current) {
        void storeAstrocartViewState(documentId, current).catch(() => undefined);
      }
    };
  }, [documentId]);

  const pushCachedModeData = React.useCallback(() => {
    const context = activeDataContextRef.current;
    const targetWindow = iframeRef.current?.contentWindow;
    if (!context || !targetWindow) return;

    let fallbackMeta = astrocartMetaCacheRef.current?.sessionRevision === context.sessionRevision
      ? astrocartMetaCacheRef.current.meta
      : undefined;
    if (!fallbackMeta) {
      for (const entry of modeDataCacheRef.current.values()) {
        if (entry.sessionRevision === context.sessionRevision && entry.payload.meta) {
          fallbackMeta = entry.payload.meta;
          break;
        }
      }
    }
    const composed = composeAstrocartModePayload(
      context.lineModes,
      context.sessionRevision,
      modeDataCacheRef.current,
      fallbackMeta,
    );
    const readyForRevision = composed.complete && (
      context.lineModes.length > 0 || fallbackMeta != null
    );
    const previousRevision = lastRenderedSessionRevisionRef.current;
    if (
      !readyForRevision &&
      previousRevision != null &&
      previousRevision !== context.sessionRevision
    ) {
      // A session rebuild keeps its previous coherent map until all selected
      // preview layers are ready. Mode toggles inside one session still repaint
      // immediately from whatever independent layers are already cached.
      setLinesPushedFor(null);
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
    lastRenderedSessionRevisionRef.current = context.sessionRevision;
    setLinesPushedFor(readyForRevision ? context.dataGenerationKey : null);
  }, []);

  React.useEffect(() => {
    if (!active || !viewStateReady) return;
    pushCachedModeData();

    const fetchModePayload = async (
      mode: AstrocartLineMode | null,
      precision: "preview" | "precise",
      signal: AbortSignal,
    ): Promise<AstrocartGeoJsonPayload> => {
      const params = new URLSearchParams({ modes: mode ?? "", precision });
      const response = await daemonFetch(
        `${daemonBaseUrl()}/api/workspace/document/${encodeURIComponent(documentId)}/astrocart?${params.toString()}`,
        { cache: "no-store", signal },
      );
      if (!response.ok) throw new Error(`astrocart fetch failed: ${response.status}`);
      const raw = await response.json() as Partial<AstrocartGeoJsonPayload>;
      return {
        type: "FeatureCollection",
        features: Array.isArray(raw.features) ? raw.features : [],
        meta: raw.meta,
      };
    };

    const ensureModeData = (mode: AstrocartLineMode) => {
      const cached = modeDataCacheRef.current.get(mode);
      if (cached?.sessionRevision === sessionRevision && cached.precision === "precise") return;
      const existing = modeDataRequestsRef.current.get(mode);
      if (existing?.sessionRevision === sessionRevision) return;
      existing?.controller.abort();

      const request: AstrocartModeRequest = {
        sessionRevision,
        controller: new AbortController(),
      };
      modeDataRequestsRef.current.set(mode, request);
      const requestIsCurrent = () => (
        !request.controller.signal.aborted &&
        modeDataRequestsRef.current.get(mode) === request &&
        activeDataContextRef.current?.sessionRevision === sessionRevision
      );

      void (async () => {
        try {
          let entry = modeDataCacheRef.current.get(mode);
          if (!entry || entry.sessionRevision !== sessionRevision) {
            const preview = await fetchModePayload(mode, "preview", request.controller.signal);
            if (!requestIsCurrent()) return;
            entry = { sessionRevision, precision: "preview", payload: preview };
            modeDataCacheRef.current.set(mode, entry);
            if (preview.meta) {
              astrocartMetaCacheRef.current = { sessionRevision, meta: preview.meta };
            }
            pushCachedModeData();
          }

          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, ASTROCART_REFINEMENT_DELAY_MS);
          });
          if (!requestIsCurrent()) return;
          if (!activeDataContextRef.current?.lineModes.includes(mode)) return;
          const precise = await fetchModePayload(mode, "precise", request.controller.signal);
          if (!requestIsCurrent()) return;
          modeDataCacheRef.current.set(mode, {
            sessionRevision,
            precision: "precise",
            payload: precise,
          });
          if (precise.meta) {
            astrocartMetaCacheRef.current = { sessionRevision, meta: precise.meta };
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
      if (astrocartMetaCacheRef.current?.sessionRevision === sessionRevision) return;
      const existing = emptyMetaRequestRef.current;
      if (existing?.sessionRevision === sessionRevision) return;
      existing?.controller.abort();
      const request: AstrocartModeRequest = {
        sessionRevision,
        controller: new AbortController(),
      };
      emptyMetaRequestRef.current = request;
      void fetchModePayload(null, "preview", request.controller.signal)
        .then((payload) => {
          if (
            request.controller.signal.aborted ||
            emptyMetaRequestRef.current !== request ||
            activeDataContextRef.current?.sessionRevision !== sessionRevision
          ) return;
          astrocartMetaCacheRef.current = {
            sessionRevision,
            meta: payload.meta ?? {},
          };
          pushCachedModeData();
        })
        .catch((err) => {
          if (isAbortError(err, request.controller.signal)) return;
          console.error("[acg:meta]", err);
        })
        .finally(() => {
          if (emptyMetaRequestRef.current === request) emptyMetaRequestRef.current = null;
        });
    };

    if (lineModes.length === 0) ensureEmptyMeta();
    for (const mode of lineModes) ensureModeData(mode);
  }, [active, dataGenerationKey, documentId, lineModes, pushCachedModeData, sessionRevision, viewStateReady]);

  // Eclipse shadow-path overlay — fetch the daemon-computed GeoJSON
  // (eclipsepath.build_solar_eclipse_path_geojson via /api/astrocart/
  // eclipse-path) and push it through the postMessage twin of wx's
  // RunScript setEclipseData (astrocartframe.py:442-456). map.html owns the
  // shadow/fill/limits/center/max layers and fits the view to the path
  // (pushEclipseData({fit:true})), exactly as under wx.
  React.useEffect(() => {
    if (!active || !iframeReady || !linesPushed || !eclipseEvent) return;
    const eclipseKey = `${dataGenerationKey}:${eclipseEvent.jdUt}:${eclipseEvent.retflag ?? 0}`;
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
  }, [active, dataGenerationKey, eclipseEvent, iframeReady, linesPushed]);

  // Right-click "here" actions. map.html's #acg-menu posts outbound intents up
  // to this parent ({source:'aries-acg', payload:{type:'here', action, lon,
  // lat, placeName}}) — the iframe twin of wx's morinus://acg/ navigation
  // bridge (astrocartframe.py:534). The four 'here' actions route to the daemon
  // (workspaceAstrocartHere -> on_astrocart_here_request parity), then we
  // activate the new child document so it opens focused like every other
  // launcher (relocation/solar_return/transit open a child; set_pob mutates the
  // radix in place while this retained map stays active and refreshes from the
  // daemon's session.changed event). 'click'/'shortcut' payloads
  // from the same channel are not consumed here (line-click + in-map keyboard
  // forwarding remain deferred, astrocart.md §7).
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
            };
          }
        | undefined;
      if (!data || data.source !== "aries-acg") return;
      const payload = data.payload;
      if (!payload) return;
      if (payload.type === "perf") {
        console.info("[acg-perf]", payload.reason ?? "snapshot", payload.state);
        return;
      }
      if (payload.type === "ready") {
        if (url) setReadyUrl(url);
        return;
      }
      if (payload.type === "state" && payload.state) {
        persistViewState({
          ...payload.state,
          lineModes: activeLineModesRef.current,
        });
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
  }, [documentId, persistViewState, url]);

  return (
    <div className="relative flex flex-1 min-h-0 bg-background">
      {url ? (
        <iframe
          key={url}
          ref={iframeRef}
          src={url}
          title={t("toolbar.astrocartography")}
          className="h-full w-full border-0 bg-background"
          style={{ backgroundColor: "var(--background, #232428)" }}
          onLoad={() => {
            setReadyUrl(url);
            iframeRef.current?.contentWindow?.postMessage(
              { type: "aries.getReady" },
              "*",
            );
          }}
        />
      ) : null}
      <div
        className="absolute bottom-3 left-1/2 z-20 inline-flex h-7 -translate-x-1/2 items-center rounded-[5px] border border-[color:var(--aries-border-subtle)] bg-[color:var(--aries-surface)] p-0.5 text-[11px] shadow-sm"
        role="group"
        aria-label={t("toolbar.astrocartLineMode")}
      >
        {ASTROCART_LINE_MODES.map((mode) => {
          const active = lineModes.includes(mode.id);
          const geodetic = ASTROCART_GEODETIC_MODES.has(mode.id);
          return (
            <button
              key={mode.id}
              type="button"
              title={t(`astrocart.mode.${mode.id}.title`)}
              aria-pressed={active}
              onClick={(event) => handleLineModeClick(mode.id, event)}
              className={cn(
                "flex h-6 min-w-[72px] flex-col items-center justify-center rounded-[3px] px-2 text-[color:var(--aries-text-muted)] transition-colors",
                active
                  ? "bg-[color:var(--aries-accent)] text-[color:var(--aries-text-primary)]"
                  : "hover:bg-[color:var(--aries-list-hover-bg)]",
              )}
            >
              <span className="text-[11px] leading-[11px]">
                {t(`astrocart.mode.${mode.id}.label`)}
              </span>
              {geodetic ? (
                <span className="text-[7px] font-medium uppercase leading-[8px] tracking-[0.08em] opacity-70">
                  {t("astrocart.mode.geodetic.badge")}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
  overlay = false,
  onOptionsPatched,
  onOpenSettings,
}: {
  chart: ChartRenderSnapshot | null;
  activeDoc: WorkspaceDocument | null;
  // Full-bleed surfaces (astrocart map) want the title controls floating over
  // the content with no opaque bar — the wx WebView panel fills under the title
  // region (astrocartframe._titlebar_safe_top) and shows no separate bar. When
  // overlay, the bar is absolutely positioned, its shell background is dropped,
  // and the centred title text is hidden (only the traffic-light drag
  // region + control buttons remain over the map).
  overlay?: boolean;
  onOptionsPatched?: (next?: OptionsPayload) => void;
  onOpenSettings?: (tab?: SettingsTabId) => void;
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
  const t = useT();
  const parts = buildTitleParts(chart, activeDoc, t);
  // Mark <html> as running under Tauri so globals.css insets the traffic-light
  // padding on this bar (no lights in a plain browser, so no inset there).
  useLayoutEffect(() => {
    if (!resolveShellHost().capabilities.nativeWindowChrome) return;
    document.documentElement.classList.add("is-tauri");
    return () => document.documentElement.classList.remove("is-tauri");
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
      className={cn(
        "absolute inset-x-0 top-0 z-50 grid h-[var(--titlebar-h)] select-none grid-cols-[minmax(var(--titlebar-side-min-w),1fr)_minmax(0,2fr)_minmax(var(--titlebar-side-min-w),1fr)] items-center px-1.5 text-[color:var(--aries-header-text)] sm:px-2",
        overlay
          ? "bg-transparent"
          : "unified-titlebar",
      )}
    >
      {/* Left cluster starts after the native macOS traffic-light area. Native
          lights are outside the DOM, so this is pinned instead of spacer-driven. */}
      <div data-tauri-drag-region className="absolute left-[var(--titlebar-left-controls-x)] top-0 z-10 flex h-[var(--titlebar-h)] min-w-0 translate-y-[var(--titlebar-content-offset-y)] items-center justify-start gap-0.5 sm:gap-1">
        <HeaderButton label={t("toolbar.toggleSidebar")} onClick={toggleSidebar} pressed={sidebarOpen}>
          <PanelLeft className="size-[var(--morinus-header-icon-size)]" />
        </HeaderButton>
      </div>
      <div
        data-tauri-drag-region
        className="relative z-10 col-start-2 flex min-w-0 translate-y-[var(--titlebar-content-offset-y)] items-center justify-center px-2 text-[length:var(--aries-font-size-titlebar)] font-normal leading-none tracking-normal text-[color:var(--aries-titlebar-text)]"
      >
        {overlay ? null : <TitleText parts={parts} />}
      </div>
      {/* Right cluster — search + edit + right-pane toggles. */}
      <div data-tauri-drag-region className="relative z-10 col-start-3 flex min-w-0 translate-y-[var(--titlebar-content-offset-y)] items-center justify-end gap-0.5 sm:gap-1">
        <TitlebarOptionsMenu
          onOptionsPatched={onOptionsPatched}
          onOpenSettings={onOpenSettings}
          pdChartOrientationDisabled={
            activeDoc?.launcherKind === "pd_in_chart" && activeDoc.chartVisualMode === "mundane"
          }
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

function buildTitleParts(
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

type NavigationHintGroup = {
  id: string;
  label: string;
  modifiers?: { shift?: boolean; alt?: boolean };
  backwardLabel: string;
  forwardLabel: string;
};

export type KeyHintPlacement = "top" | "bottom";

export type ModeHintRailProps = {
  visible: boolean;
  placement?: KeyHintPlacement;
  overlay: boolean;
  hasChart: boolean;
  hasComparisonChart?: boolean;
  parentDocumentId?: string | null;
  comparisonSourceName?: string | null;
  viewMode?: number | null;
  chartVisualMode: WorkspaceDocument["chartVisualMode"] | null | undefined;
  launcherKind: WorkspaceDocument["launcherKind"] | null | undefined;
  compoundKind: WorkspaceDocument["compoundKind"] | null | undefined;
  kind: WorkspaceDocument["kind"] | null | undefined;
  supplementaryFeatureKind: WorkspaceDocument["supplementaryFeatureKind"] | null | undefined;
  onToggleComparison?: () => void;
  onNavigateHint?: (
    key: "left" | "right" | "up" | "down",
    modifiers?: { shift?: boolean; alt?: boolean },
  ) => void;
  onHintInteraction?: () => void;
};

const STEP_HINT_HOLD_DELAY_MS = 260;
const STEP_HINT_HOLD_KEEPALIVE_MS = 700;
const STEP_HINT_HOLD_REPEAT_MS = 95;

export const ModeHintRail = React.memo(function ModeHintRail({
  visible,
  placement = "top",
  overlay,
  hasChart,
  hasComparisonChart,
  parentDocumentId,
  comparisonSourceName,
  viewMode,
  chartVisualMode,
  launcherKind,
  compoundKind,
  kind,
  supplementaryFeatureKind,
  onToggleComparison,
  onNavigateHint,
  onHintInteraction,
}: ModeHintRailProps) {
  const t = useT();
  const showModeHint = Boolean(
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
  const targetModeLabel = viewMode === 1 ? t("toolbar.viewSingle") : t("toolbar.viewBiwheel");
  const targetModeTitle = t("toolbar.switchToView", { mode: targetModeLabel });
  const stepHintGroups = React.useMemo(
    () => navigationHintGroups({
      chartVisualMode,
      launcherKind,
      compoundKind,
      kind,
      supplementaryFeatureKind,
    }),
    [chartVisualMode, launcherKind, compoundKind, kind, supplementaryFeatureKind],
  );
  const showNavigationHints = Boolean(hasChart && onNavigateHint && stepHintGroups.length > 0);
  const active = Boolean(visible && !overlay && (showModeHint || showNavigationHints));
  const tooltipSide = placement === "bottom" ? "top" : "bottom";
  const handleModeHintClick = React.useCallback(() => {
    onHintInteraction?.();
    onToggleComparison?.();
  }, [onHintInteraction, onToggleComparison]);
  const handleNavigateHintClick = React.useCallback(
    (
      key: "left" | "right",
      modifiers?: { shift?: boolean; alt?: boolean },
    ) => {
      onHintInteraction?.();
      onNavigateHint?.(key, modifiers);
    },
    [onHintInteraction, onNavigateHint],
  );
  return (
    <div
      className={cn(
        "aries-mode-hint",
        placement === "bottom" ? "aries-mode-hint--bottom" : "aries-mode-hint--top",
        !active && "aries-mode-hint--hidden",
      )}
      role="group"
      aria-label={t("toolbar.chartNavbar")}
      aria-hidden={!active}
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
            <ShortcutFlag label={targetModeTitle} shortcut="Tab" />
          </TooltipContent>
        </Tooltip>
      ) : null}
      {onNavigateHint && stepHintGroups.length > 0 ? (
        <div className="aries-step-hints" aria-label={t("toolbar.timeNavigationControls")}>
          {stepHintGroups.map((group) => (
            <div className="aries-step-hint-group" key={group.id}>
              <span className="aries-step-unit">{group.label}</span>
              <span className="aries-step-arrows">
                <StepHintArrowButton
                  direction="left"
                  group={group}
                  tooltipSide={tooltipSide}
                  onPointerEnter={onHintInteraction}
                  onClick={handleNavigateHintClick}
                />
                <StepHintArrowButton
                  direction="right"
                  group={group}
                  tooltipSide={tooltipSide}
                  onPointerEnter={onHintInteraction}
                  onClick={handleNavigateHintClick}
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
  direction,
  group,
  tooltipSide,
  onPointerEnter,
  onClick,
}: {
  direction: "left" | "right";
  group: NavigationHintGroup;
  tooltipSide: "top" | "bottom";
  onPointerEnter?: () => void;
  onClick: (
    key: "left" | "right",
    modifiers?: { shift?: boolean; alt?: boolean },
  ) => void;
}) {
  const label = direction === "left" ? group.backwardLabel : group.forwardLabel;
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
    onClick(direction, modifiers);
  }, [direction, modifiers, onClick]);
  const stopHold = React.useCallback(() => {
    const wasHolding = holdActiveRef.current;
    holdActiveRef.current = false;
    clearHold();
    if (wasHolding) onPointerEnter?.();
  }, [clearHold, onPointerEnter]);
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
    },
    [fireStep],
  );
  React.useEffect(() => clearHold, [clearHold]);
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
        {direction === "left" ? <ChevronLeft /> : <ChevronRight />}
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="aries-mode-hint-flag">
        <ShortcutFlag
          label={label}
          shortcut={shortcutTextForStep(direction, modifiers)}
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

function shortcutTextForStep(
  direction: "left" | "right",
  modifiers?: { shift?: boolean; alt?: boolean },
): string {
  const parts: string[] = [];
  if (modifiers?.alt) parts.push("Option");
  if (modifiers?.shift) parts.push("Shift");
  parts.push(direction === "left" ? "Left" : "Right");
  return parts.join(" + ");
}

function navigationHintGroups({
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
}): NavigationHintGroup[] {
  if (!isChartBearingSurfaceKind(kind)) return [];
  if (launcherKind === "pd_in_chart") {
    return buildLeftRightHintGroups([
      ["week", { alt: true }],
      ["month", { shift: true }],
      ["year", undefined],
    ]);
  }
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
    ]);
  }

  const featureKind = supplementaryFeatureKind;
  if (!featureKind || featureKind === "transits" || featureKind === "synastry" || compoundKind) {
    return buildLeftRightHintGroups([
      ["minute", { alt: true }],
      ["hour", { shift: true }],
      ["day", undefined],
    ]);
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
    ]);
  }
  if (featureKind === "profections") {
    return buildLeftRightHintGroups([
      ["day", { alt: true }],
      ["month", { shift: true }],
      ["year", undefined],
    ]);
  }
  if (featureKind === "solar-revolution") {
    return buildLeftRightHintGroups([
      ["1 deg", { alt: true }],
      ["30 deg", { shift: true }],
      ["year", undefined],
    ]);
  }
  if (featureKind === "lunar-revolution") {
    return buildLeftRightHintGroups([["cycle", undefined]]);
  }
  if (featureKind === "planetary-return") {
    return buildLeftRightHintGroups([
      ["event", { shift: true }],
      ["cycle", undefined],
    ]);
  }
  return [];
}

function buildLeftRightHintGroups(
  entries: Array<[label: string, modifiers: { shift?: boolean; alt?: boolean } | undefined]>,
): NavigationHintGroup[] {
  return entries.map(([label, modifiers]) => ({
    id: `${label}:${modifiers?.shift ? "shift" : ""}:${modifiers?.alt ? "alt" : ""}`,
    label,
    modifiers,
    backwardLabel: `Previous ${label}`,
    forwardLabel: `Next ${label}`,
  }));
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
  const element = target instanceof HTMLElement ? target : null;
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
  const sidebarOpen = useFrameLayoutStore((s) => s.sidebarOpen);
  const sidebarWidth = useFrameLayoutStore((s) => s.sidebarWidth);
  const rightPaneWidth = useFrameLayoutStore((s) => s.rightPaneWidth);
  const rightPaneDragging = useFrameLayoutStore((s) => s.rightPaneDragging);
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
  const ascensionalTransitsPane = useWorkspaceStore((s) => s.ascensionalTransitsPane);
  const featureCatalogPane = useWorkspaceStore((s) => s.featureCatalogPane);
  const activeRightPane = activeRightPaneModule({
    inspectorOpen,
    notesOpen,
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
    ascensionalTransitsPane,
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
    : 0;
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
        "right-pane-split relative grid flex-1 min-h-0 bg-background transition-[grid-template-columns] duration-[var(--aries-motion-shell-duration)] ease-[var(--aries-motion-shell-ease)]",
        rightPaneDragging && "transition-none",
      )}
      style={{
        "--right-pane-width": `${effectiveRightPaneWidth}px`,
        gridTemplateColumns: rightPaneOpen
          ? "minmax(0, 1fr) var(--right-pane-width)"
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
          <EmptyWorkspace />
        ))}
        {navbar ? <ModeHintRail {...navbar} /> : null}
      </div>
      {rightPaneOpen ? (
        <RightPaneSash
          width={effectiveRightPaneWidth}
          minWidth={rightPanePolicy.minContentWidth}
          maxWidth={rightPanePolicy.maxWidth}
          onCollapse={closeRightPane}
        />
      ) : null}
      <aside
        aria-hidden={!rightPaneOpen}
        data-right-pane-module={activeRightPane ?? undefined}
        data-right-pane-role={rightPaneOpen ? rightPanePolicy.role : undefined}
        className={cn(
          "box-border min-w-0 overflow-hidden border-l border-[color:var(--aries-titlebar-seam-rule)] bg-background pt-[var(--titlebar-pane-pad-top)]",
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

function RightPaneSash({
  width,
  minWidth,
  maxWidth,
  onCollapse,
}: {
  width: number;
  minWidth: number;
  maxWidth: number;
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
      const clamped = clampRightPaneWidth(raw, { minContentWidth: minWidth, maxWidth });
      lastWidthRef.current = clamped;
      setLiveRightPaneWidth(clamped);
    },
    [finishCollapse, maxWidth, minWidth, setLiveRightPaneWidth],
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
      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      const split = handle.closest<HTMLElement>(".right-pane-split");
      if (!split) return;
      const rect = split.getBoundingClientRect();
      splitRef.current = split;
      containerRightRef.current = rect.right;
      lastWidthRef.current = width;
      dragStartWidthRef.current = width;
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
    [endDrag, setRightPaneDragging, updateDragWidth, width],
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
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      onPointerDown={onPointerDown}
      onDoubleClick={resetRightPaneWidth}
      className={cn(
        "absolute inset-y-0 z-50 w-3 -translate-x-1/2 cursor-col-resize select-none outline-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-[color:var(--aries-titlebar-seam-rule)] after:content-['']",
        dragging && "after:bg-sidebar-border/80",
      )}
      style={{ left: "calc(100% - var(--right-pane-width))" }}
    />
  );
}

/**
 * The chart canvas plus its four corner-overlay clusters. Hosts the sizing
 * element so the canvas re-measures when the panel is dragged (the
 * ResizeObserver in useElementSize fires on width change automatically).
 */
const WX_OVERLAY_ROW_HEIGHT_FACTOR = 0.94;
const WX_OVERLAY_GAP_AFTER_DAYHOUR = 0.3;
const WX_OVERLAY_GAP_BETWEEN_GROUPS = 0.3;
const WX_OVERLAY_ICON_SCALE = 0.83;
const WX_OVERLAY_LABEL_SCALE = 1.08;
const WX_OVERLAY_GAP_LABEL_GLYPH = 0.19;
const WX_TITLEBAR_OVERLAY_SAFE_TOP = 14;
// wx derives row height from measured rendered glyph/text boxes. CSS font-size
// underestimates the Morinus glyph box, so compensate before applying wx's row factor.
const DOM_OVERLAY_FONT_BOX_SCALE = 1.2;

function ChartSurface({ chart }: { chart: ChartRenderSnapshot }) {
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const viewport = useElementSize(hostElement);

  const primaryChart = chart.primaryChart;
  const displayChart = isPlainSynastryBiwheel(chart)
    ? primaryChart
    : chart.comparisonChart ?? primaryChart;
  const primaryCornerLines = primaryChart.meta.cornerLines;
  const cornerChart =
    primaryCornerLines?.topLeft?.length || primaryCornerLines?.bottomLeft?.length
      ? primaryChart
      : displayChart;
  const palette = resolvePalette(primaryChart);
  // Partial overlay modes keep the live wheel cheap while the snapshot cache
  // retains previous stable rows until the next full overlay replaces them.
  const overlayRows = displayChart.overlay?.rows ?? [];
  const overlaySections = splitOverlayRows(overlayRows);
  const hasOverlayRows = overlayRows.length > 0;
  const chartSize = Math.min(viewport.width, viewport.height);
  const compactPhone = viewport.width > 0 && viewport.width <= 390;
  const symbolSize = chartSize > 0 ? chartSize / 32 : 0;
  const infoFontSize = Math.max(compactPhone ? 11 : 10, symbolSize * (compactPhone ? 0.86 : 0.75));
  const infoGap = 0;
  const overlayIconSize = Math.max(
    compactPhone ? 12 : 10,
    ((2 * symbolSize) / 3) * (compactPhone ? 1.02 : WX_OVERLAY_ICON_SCALE),
  );
  const overlayLabelSize = Math.max(
    compactPhone ? 9.5 : 8,
    symbolSize * (compactPhone ? 0.52 : 0.38 * WX_OVERLAY_LABEL_SCALE),
  );
  const overlayLineHeight = Math.max(
    1,
    Math.round(
      Math.max(overlayIconSize, overlayLabelSize) *
      DOM_OVERLAY_FONT_BOX_SCALE *
      WX_OVERLAY_ROW_HEIGHT_FACTOR,
    ),
  );
  const overlayGapAfterDayHour = Math.round(overlayLineHeight * WX_OVERLAY_GAP_AFTER_DAYHOUR);
  const overlayGapBetweenGroups = Math.round(overlayLineHeight * WX_OVERLAY_GAP_BETWEEN_GROUPS);
  const overlayColumnGap = Math.max(2, Math.floor(symbolSize * WX_OVERLAY_GAP_LABEL_GLYPH));
  const edgeInset = chartSize > 0 ? Math.max(compactPhone ? 10 : 0, chartSize / 25) : 0;
  const topEdgeInset = compactPhone ? edgeInset : edgeInset + WX_TITLEBAR_OVERLAY_SAFE_TOP;

  return (
    <div ref={setHostElement} className="font-morinus-text relative flex h-full w-full min-w-0 overflow-hidden">
      <ChartCanvas chart={chart} />
      {cornerChart.options.showInformation ? (
        <CornerLines
          lines={
            cornerChart.meta.cornerLines?.topLeft ??
            [cornerChart.meta.dateDisplay, cornerChart.meta.timeDisplay]
          }
          color={palette.textDim}
          fontSize={infoFontSize}
          gap={infoGap}
          style={{ top: topEdgeInset, left: edgeInset, textAlign: "left" }}
        />
      ) : null}
      {hasOverlayRows ? (
        <OverlayCorner
          sections={overlaySections}
          palette={palette}
          labelSize={overlayLabelSize}
          iconSize={overlayIconSize}
          lineHeight={overlayLineHeight}
          gapAfterDayHour={overlayGapAfterDayHour}
          gapBetweenGroups={overlayGapBetweenGroups}
          columnGap={overlayColumnGap}
          style={{ top: topEdgeInset, right: edgeInset }}
        />
      ) : null}
      {cornerChart.options.showInformation ? (
        <CornerLines
          lines={
            cornerChart.meta.cornerLines?.bottomLeft ??
            [cornerChart.meta.place, cornerChart.meta.placeCoords]
          }
          color={palette.textDim}
          fontSize={infoFontSize}
          gap={infoGap}
          style={{ bottom: edgeInset, left: edgeInset, textAlign: "left" }}
        />
      ) : null}
      {displayChart.options.showHouseSystem ? (
        <CornerLines
          lines={displayChart.meta.houseSystemLines ?? []}
          color={palette.textDim}
          fontSize={infoFontSize}
          gap={infoGap}
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
    activeDoc?.supplementaryFeatureKind === "transits";
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
  // Presentation memory of the last live focus. A row-link open must not move
  // the list AT ALL — including snapping back to the pane's open-time focus
  // after live follow has drifted (stepping). Hold whatever the list was
  // following just before the click; reset when the pane itself is reopened.
  const [lastDirectionsLiveFocus, setLastDirectionsLiveFocus] = useState<string | null>(null);
  const [lastTransitListLiveFocus, setLastTransitListLiveFocus] = useState<string | null>(null);
  const [lastSynodicCyclesLiveFocus, setLastSynodicCyclesLiveFocus] = useState<string | null>(null);
  const directionsPaneIdentity = directionsPane
    ? `${directionsPane.documentId}:${directionsPane.openSeq ?? 0}`
    : null;
  const transitListPaneIdentity = transitListPane
    ? `${transitListPane.documentId}:${transitListPane.openSeq ?? 0}`
    : null;
  const synodicCyclesPaneIdentity = synodicCyclesPane
    ? `${synodicCyclesPane.documentId}:${synodicCyclesPane.openSeq ?? 0}`
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

  if (featureCatalogPane) {
    return (
      <RightInspectorPaneFrame kind="feature-catalog">
        {featureCatalogPane.content === "help" ? (
          <HelpView
            key={featureCatalogPane.openSeq}
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
      data-right-inspector-pane={kind}
      data-right-pane-role={policy.role}
      className="h-full w-full min-w-0 overflow-hidden"
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

function CornerLines({
  lines,
  color,
  fontSize,
  gap,
  style,
}: {
  lines: string[];
  color: string;
  fontSize: number;
  gap: number;
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
        color,
        fontSize,
        lineHeight: 1.1,
      }}
    >
      <div className="flex flex-col" style={{ gap }}>
        {lines.map((line) => (
          <div key={`${line}-${fontSize}`}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function OverlayCorner({
  sections,
  palette,
  labelSize,
  iconSize,
  lineHeight,
  gapAfterDayHour,
  gapBetweenGroups,
  columnGap,
  style,
}: {
  sections: ReturnType<typeof splitOverlayRows>;
  palette: ChartPalette;
  labelSize: number;
  iconSize: number;
  lineHeight: number;
  gapAfterDayHour: number;
  gapBetweenGroups: number;
  columnGap: number;
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
    <div className="pointer-events-none absolute z-10 select-none font-ui" style={style}>
      <div
        className="grid max-w-[42vw] items-center justify-end sm:max-w-none"
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
              row={row}
              palette={palette}
              labelSize={labelSize}
              iconSize={iconSize}
              lineHeight={lineHeight}
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

function OverlayRow({
  row,
  palette,
  labelSize,
  iconSize,
  lineHeight,
}: {
  row: OverlayInfoRow;
  palette: ChartPalette;
  labelSize: number;
  iconSize: number;
  lineHeight: number;
}) {
  const firstGlyph = row.glyphs[0] ?? null;
  const secondGlyph = row.group === "header" ? (row.glyphs[1] ?? null) : null;
  const trailingText = row.group === "header" ? "" : (row.trailing ?? "");
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
        style={{ ...rowBoxStyle, color: palette.textDim, fontSize: labelSize }}
      >
        {row.label}
      </div>
      <div
        className="justify-self-start whitespace-nowrap font-symbols leading-none"
        style={rowBoxStyle}
      >
        {firstGlyph ? (
          <span
            style={{
              color: overlayGlyphColor(firstGlyph, palette),
              fontSize: iconSize,
              lineHeight: 1,
            }}
          >
            {firstGlyph.char}
          </span>
        ) : null}
      </div>
      <div
        className="justify-self-start whitespace-nowrap"
        style={{ ...rowBoxStyle, color: palette.textDim, fontSize: labelSize }}
      >
        {secondGlyph ? (
          <span
            className="font-symbols leading-none"
            style={{
              color: overlayGlyphColor(secondGlyph, palette),
              fontSize: iconSize,
              lineHeight: 1,
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
      className="relative z-20 flex h-[var(--morinus-status-height)] w-full shrink-0 select-none overflow-hidden bg-[color:var(--aries-background)] text-[length:var(--aries-font-size-statusbar)] font-normal leading-none text-[color:var(--aries-statusbar-text)]"
    >
      <div
        className="flex h-full shrink-0 items-center gap-[4px] overflow-hidden bg-[color:var(--aries-background)] px-[var(--morinus-nav-side-margin)]"
        style={{ width: leftCellWidth }}
      >
        {sidebarOpen ? (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={t("toolbar.settings")}
            title={t("toolbar.settings")}
            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-[length:var(--aries-font-size-nav)] text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Settings className="size-3.5 shrink-0" />
          </button>
        ) : null}
        {sidebarOpen && buildField ? <StatusText>{buildField}</StatusText> : null}
      </div>
      <div
        className="flex h-full items-center overflow-hidden bg-[color:var(--aries-background)]"
        style={{ flex: "1 1 0%", minWidth: 0 }}
      >
        <StatusField style={{ flex: "0 0 160px" }}>{nameField}</StatusField>
        <StatusField style={{ flex: "0 0 80px" }}>{typeField}</StatusField>
        <StatusField style={{ flex: "3 1 0%" }}>{datetimeField}</StatusField>
        <StatusField style={{ flex: "2 1 0%" }}>{detailField}</StatusField>
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
      className="flex h-full items-center overflow-hidden px-[6px] leading-none"
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
