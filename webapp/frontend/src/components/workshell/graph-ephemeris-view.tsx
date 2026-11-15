// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  registerChartExportRenderer,
  renderCanvasChartExport,
} from "@/lib/chart/chart-export-registry";
import {
  registerGraphicEphemerisCamera,
  registerGraphicEphemerisNavigator,
  registerGraphicEphemerisRadixToggle,
  type GraphicEphemerisNavigationKey,
  type GraphicEphemerisStepKey,
} from "@/lib/chart/graphic-ephemeris-navigation.mjs";
import { morinusTextFontFromTokens } from "@/lib/chart/chart-fonts";
import { awaitFonts } from "@/lib/chart/draw-chart";
import { EphemerisBlockStore } from "@/lib/chart/ephemeris-block-store";
import {
  calendarOfJd,
  cameraCenterJd,
  cameraEndJd,
  camerasEqual,
  cameraTweenAt,
  clampCamera,
  defaultCameraAround,
  EPHEMERIS_TICK_MS,
  EPHEMERIS_TWEEN_MS,
  normalizeEphemerisCamera,
  panCamera,
  resetZoomCamera,
  resetZoomCameraCenter,
  stepCamera,
  stepCameraCenter,
  zoomCameraAround,
  type EphemerisCamera,
  type EphemerisCameraTween,
} from "@/lib/chart/ephemeris-camera";
import {
  createTextMeasure,
  type EphemerisDisplayMode,
  type EphemerisGeometry,
  type TextMeasure,
} from "@/lib/chart/ephemeris-geometry";
import { hitTestEphemeris, type EphemerisHit, type EphemerisHoverInfo } from "@/lib/chart/ephemeris-hit-test";
import {
  ephemerisHoverGlyphPaint,
  type EphemerisHoverGlyphPaint,
} from "@/lib/chart/ephemeris-hover-colors";
import { ephemerisInkTable } from "@/lib/chart/ephemeris-ink";
import {
  ephemerisInspectorRegion,
  ephemerisRadixInspectorRegion,
  nextEphemerisPin,
} from "@/lib/chart/ephemeris-inspector-region";
import { hitTestEphemerisBody } from "@/lib/chart/ephemeris-body-hit";
import {
  ephemerisNow,
  recordEphemerisFetch,
  recordEphemerisFirstPaint,
  recordEphemerisFrame,
} from "@/lib/chart/ephemeris-perf";
import {
  ephemerisChromeInputs,
  ephemerisExportScene,
  ephemerisPlateGeometry,
  paintEphemerisPlate,
  sameEphemerisChromeInputs,
} from "@/lib/chart/ephemeris-plate-paint";
import { ephemerisRecedeAmount, ephemerisRecedeDone, retargetEphemerisRecede, type EphemerisRecedeFade } from "@/lib/chart/ephemeris-recede-fade";
import {
  decodeEphemerisRadixPoints,
  EphemerisContactStore,
  EphemerisRadixStore,
  ephemerisRadixLayer,
  hitTestEphemerisRadixLine,
  radixPointParts,
  radixYearsOf,
  type EphemerisRadixLabelPart,
  type EphemerisRadixLayer,
  type EphemerisRadixPoint,
} from "@/lib/chart/ephemeris-radix";
import {
  applyEphemerisPlanetProfileColors,
  DEFAULT_EPHEMERIS_RENDER_PALETTE,
  resolveEphemerisRenderPalette,
  resolveEphemerisRenderStyle,
  type EphemerisRenderStyle,
} from "@/lib/chart/ephemeris-render-style";
import type {
  EphemerisDignity,
  EphemerisInkMode,
  EphemerisModulus,
  EphemerisScene,
  EphemerisSurface,
} from "@/lib/chart/ephemeris-scene";
import { useStyleRevision } from "@/hooks/use-style-revision";
import {
  fetchEphemerisMarks,
  fetchEphemerisContacts,
  fetchEphemerisMeta,
  fetchEphemerisSeries,
  fetchEphemerisNatal,
  fetchEphemerisNatalCrossings,
  fetchEphemerisViewState,
  fetchEphemerisYearStations,
  openDirectionsTimedChart,
  storeEphemerisViewState,
  type EphemerisColors,
  type EphemerisMeta,
  type EphemerisViewState,
  type TimedChartAction,
} from "@/lib/daemon/client";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useRadixListRevision } from "./step-refresh";
import { hoverRegionKey, useWorkspaceStore } from "@/stores/workspace-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { mobileLayoutMatches } from "@/hooks/use-mobile-layout";
import { beginWorkspaceSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";
import { useThemeStore } from "@/stores/theme-store";
import { useT } from "@/lib/i18n/i18n";

// ---------------------------------------------------------------------------
// Graphic Ephemeris — daemon-owned view-only child (launcherKind "ephemeris").
// A continuous camera (left-edge JD + visible days) lives in refs; every pan,
// zoom or arrow step repaints the moving layer in requestAnimationFrame from
// the shared block store, with no React state change, fetch or remount. The
// static plate (frame, sign scale, degree ruler) is its own canvas, repainted
// only on resize, style, mode or grid changes. Nothing astrological is
// computed here: the daemon ships daily samples and exact events per month.
// Oracle: graphephemwnd.py drawBkg (plot semantics) + graphephemframe.py
// (context-menu model, stepping, per-radix state).
// ---------------------------------------------------------------------------

export type GraphicEphemerisDisplayMode = EphemerisDisplayMode;
type DisplayMode = GraphicEphemerisDisplayMode;

// Continuous time-axis zoom: pinch ratio, or ctrl/⌘ wheel distance (a
// trackpad pinch arrives as ctrl+wheel in Chromium).
const WHEEL_ZOOM_PER_PX = 0.01;
const WHEEL_ZOOM_MAX_PX = 50;
const WHEEL_LINE_PX = 16;
const KEY_ZOOM_FACTOR = 1.5;
const DRAG_THRESHOLD_PX = 3;
const CAMERA_PERSIST_MS = 400;
const MOTION_SETTLE_MS = 140;
/** Longest a step waits for its months before it lands on whatever is there. */
const PENDING_STEP_MAX_WAIT_MS = 1500;
const EMPTY_EPHEMERIS_PROFILE_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({});

/** One block store for every Graphic Ephemeris: reopening is warm. */
const ephemerisStore = new EphemerisBlockStore(
  {
    fetchSeries: (year, month, count, signal) => fetchEphemerisSeries(year, month, count, signal),
    fetchBlocks: (year, month, count, signal) => fetchEphemerisMarks(year, month, count, signal),
    fetchStationYear: (year, signal) => fetchEphemerisYearStations(year, signal),
  },
  { onFetch: recordEphemerisFetch },
);
/** Last meta per options revision and last view state per document, so a
 * warm reopen paints its first frame without waiting on the daemon. */
let ephemerisMetaCache: { revision: string; meta: EphemerisMeta } | null = null;
const ephemerisViewStateCache = new Map<string, EphemerisViewState>();
/** Radix lines and per-year crossings per ephemeris document (warm reopen).
 * `revision` is the lines' identity on the frontend: the options payload key
 * plus the radix's own revision (a rebuilt parent radix keeps its
 * document id), so a warm reopen never paints an older radix's lines. */
const ephemerisRadixPointCache = new Map<string, { revision: string; radixKey: string; points: EphemerisRadixPoint[]; orb: number }>();
/** Backoff for a failed radix-lines fetch (daemon reloading, dropped link). */
const RADIX_POINTS_RETRY_MS = 1000;
const RADIX_POINTS_RETRY_MAX_MS = 30000;
const ephemerisRadixStores = new Map<string, EphemerisRadixStore>();
const EMPTY_RADIX_POINTS: readonly EphemerisRadixPoint[] = Object.freeze([]);
const EMPTY_RADIX_LAYER: EphemerisRadixLayer = Object.freeze({
  points: EMPTY_RADIX_POINTS,
  crossings: Object.freeze([]),
  contacts: Object.freeze([]),
});
/** Planet-to-planet contacts: one year layer for every ephemeris (chart
 * independent), loaded by the block store with the curves. */
const ephemerisContactStore = new EphemerisContactStore(ephemerisStore, "contacts", (year, signal) =>
  fetchEphemerisContacts(year, signal),
);
const NO_YEAR_LAYERS: readonly string[] = Object.freeze([]);

/** Each ephemeris document's radix crossings: a year layer of the same loader. */
function radixStoreFor(documentId: string): EphemerisRadixStore {
  let store = ephemerisRadixStores.get(documentId);
  if (!store) {
    store = new EphemerisRadixStore(ephemerisStore, `radix:${documentId}`, (year, signal) =>
      fetchEphemerisNatalCrossings(documentId, year, signal),
    );
    ephemerisRadixStores.set(documentId, store);
  }
  return store;
}

function seededRadixPoints(state: EphemerisViewState | undefined): Record<string, boolean> {
  const seeded: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(state?.radix_points ?? {})) seeded[k] = Boolean(v);
  return seeded;
}

function useEphemerisDataKey(): string {
  return useDaemonWorkspaceStore(
    (state) => state.lastOptionsChange?.ephemerisDataKey ?? "ephemeris-startup",
  );
}

/** The parent radix's revision: moves when the radix itself is rebuilt
 * (edited, rebuilt, its moment stepped — once per burst), not on display
 * changes. The radix lines and their crossings key on it. */
function useEphemerisRadixRevision(documentId: string): number {
  const parentDocumentId = useDaemonWorkspaceStore(
    (state) => state.documents.find((doc) => doc.documentId === documentId)?.parentDocumentId ?? null,
  );
  return useRadixListRevision([documentId, parentDocumentId]);
}

/** The live radix document the plate's natal lines belong to: the parent's
 * radix (a derived parent names it), else the parent itself. A clicked natal
 * line opens that document's point, as its wheel glyph does. */
function useEphemerisRadixDocumentId(documentId: string): string | null {
  return useDaemonWorkspaceStore((state) => {
    const parentId = state.documents.find((doc) => doc.documentId === documentId)?.parentDocumentId ?? null;
    if (!parentId) return null;
    return state.documents.find((doc) => doc.documentId === parentId)?.radixDocumentId ?? parentId;
  });
}

function positive(value: number, fallback: number): number {
  return value > 0 ? value : fallback;
}

function seededMode(state: EphemerisViewState | undefined): DisplayMode {
  return state?.display_mode === "declination" ? "declination" : "longitude";
}

const EPHEMERIS_MODULI: readonly EphemerisModulus[] = [360, 90, 45, 30];
const DEFAULT_EPHEMERIS_MODULUS: EphemerisModulus = 45;
const EPHEMERIS_INK_MODES: readonly EphemerisInkMode[] = ["tiers", "planets", "dignity"];
const DEFAULT_EPHEMERIS_INK_MODE: EphemerisInkMode = "planets";
const EPHEMERIS_INK_LABEL_KEYS: Record<EphemerisInkMode, string> = {
  tiers: "ephem.inkTiers",
  planets: "ephem.inkPlanets",
  dignity: "ephem.inkDignity",
};
const EPHEMERIS_DIGNITIES: ReadonlySet<string> = new Set<EphemerisDignity>([
  "domicile",
  "exaltation",
  "detriment",
  "fall",
  "peregrine",
]);
const EMPTY_DIGNITY_BY_SIGN: Readonly<Record<number, readonly EphemerisDignity[]>> = Object.freeze({});

function seededModulus(state: EphemerisViewState | undefined): EphemerisModulus {
  const value = Number(state?.modulus);
  return EPHEMERIS_MODULI.find((m) => m === value) ?? DEFAULT_EPHEMERIS_MODULUS;
}

function seededInkMode(state: EphemerisViewState | undefined): EphemerisInkMode {
  return EPHEMERIS_INK_MODES.find((m) => m === state?.ink_mode) ?? DEFAULT_EPHEMERIS_INK_MODE;
}

/** Meta's string-keyed dignity table as numeric planet ids, unknown names
 * read as peregrine. */
function dignityTable(raw: EphemerisMeta["dignityBySign"]): Readonly<Record<number, readonly EphemerisDignity[]>> {
  if (!raw) return EMPTY_DIGNITY_BY_SIGN;
  const table: Record<number, readonly EphemerisDignity[]> = {};
  for (const [id, signs] of Object.entries(raw)) {
    if (!Array.isArray(signs)) continue;
    table[Number(id)] = signs.map((d) => (EPHEMERIS_DIGNITIES.has(d) ? (d as EphemerisDignity) : "peregrine"));
  }
  return table;
}

function seededVisible(state: EphemerisViewState | undefined): Record<number, boolean> {
  const seeded: Record<number, boolean> = {};
  for (const [k, v] of Object.entries(state?.visible_planets ?? {})) seeded[Number(k)] = Boolean(v);
  return seeded;
}

/** Saved camera (the daemon centres it on the cursor at every open), else
 * the standard three-month span around the wall clock. */
function seededCamera(state: EphemerisViewState | undefined): EphemerisCamera {
  return normalizeEphemerisCamera(state?.camera) ?? defaultCameraAround(Date.now() / 86400000 + 2440587.5);
}

/** +/= zoom in, −/- zoom out, 0 resets the span (the astrolabe's zoom keys). */
function zoomKey(key: string): "in" | "out" | "reset" | null {
  if (key === "+" || key === "=") return "in";
  if (key === "-" || key === "_" || key === "−") return "out";
  if (key === "0") return "reset";
  return null;
}

function stepKeyOf(key: string): GraphicEphemerisStepKey | null {
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  return null;
}

type HoverState = { x: number; y: number; info: EphemerisHoverInfo; paint: EphemerisHoverGlyphPaint } | null;
type Size = { w: number; h: number; dpr: number };

/** Size a canvas's backing store for CSS size × dpr; true when it changed. */
function fitCanvas(canvas: HTMLCanvasElement, size: Size): boolean {
  const width = Math.max(1, Math.round(size.w * size.dpr));
  const height = Math.max(1, Math.round(size.h * size.dpr));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

function surfaceOf(canvas: HTMLCanvasElement, size: Size): EphemerisSurface | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  return { ctx, width: size.w, height: size.h, dpr: size.dpr };
}

export function GraphEphemerisView({
  documentId,
  registerDisplayModeToggle,
  onDisplayModeChange,
}: {
  documentId: string;
  registerDisplayModeToggle?: (toggle: () => void) => () => void;
  onDisplayModeChange?: (mode: GraphicEphemerisDisplayMode) => void;
}) {
  const t = useT();
  const outOfBoundsMarkerLabel = t("ephem.outOfBoundsMarker");
  const newMoonLabel = t("search.newMoon");
  const fullMoonLabel = t("search.fullMoon");
  const solarEclipseLetter = t("ephem.eclipseLetterSolar");
  const lunarEclipseLetter = t("ephem.eclipseLetterLunar");
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const chromeCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const applyTimedChartOpenResult = useWorkspaceStore((s) => s.applyTimedChartOpenResult);
  const timedChartShowRadix = useWorkspaceStore((s) => s.timedChartShowRadix);

  const cachedState = ephemerisViewStateCache.get(documentId);
  const [meta, setMeta] = React.useState<EphemerisMeta | null>(() => ephemerisMetaCache?.meta ?? null);
  const [metaNonce, setMetaNonce] = React.useState(0);
  const [fontsReadyFor, setFontsReadyFor] = React.useState<string | null>(null);
  const [blockError, setBlockError] = React.useState<string | null>(null);
  const [metaError, setMetaError] = React.useState<string | null>(null);
  const error = metaError ?? blockError;
  const [hasData, setHasData] = React.useState(() => ephemerisStore.stats().blocks > 0);
  const [mode, setMode] = React.useState<DisplayMode>(() => seededMode(cachedState));
  const [showGrid, setShowGrid] = React.useState(() => cachedState?.show_grid ?? true);
  const [showEventGlyphs, setShowEventGlyphs] = React.useState(() => cachedState?.show_event_glyphs ?? false);
  const [showLunations, setShowLunations] = React.useState(() => cachedState?.show_lunations ?? true);
  const [mirrored, setMirrored] = React.useState(() => cachedState?.mirrored ?? false);
  const [showEquator, setShowEquator] = React.useState(() => cachedState?.show_equator ?? true);
  const [showOutOfBoundsRange, setShowOutOfBoundsRange] = React.useState(() => cachedState?.show_oob_range ?? false);
  const [showSignBands, setShowSignBands] = React.useState(() => cachedState?.show_sign_bands ?? false);
  const [showRadix, setShowRadix] = React.useState(() => cachedState?.show_radix ?? false);
  const [showFastContacts, setShowFastContacts] = React.useState(() => cachedState?.show_fast_contacts ?? false);
  const [showPlanetContacts, setShowPlanetContacts] = React.useState(() => cachedState?.show_planet_contacts ?? false);
  // Hover flag planets in their curve's colour, else the app's chart colours.
  const [hoverLineColors, setHoverLineColors] = React.useState(() => cachedState?.hover_line_colors ?? false);
  // The reading line at the plot centre (the document's current moment).
  const [showNowLine, setShowNowLine] = React.useState(() => cachedState?.show_now_line ?? true);
  const [radixPointOverrides, setRadixPointOverrides] = React.useState<Record<string, boolean>>(() => seededRadixPoints(cachedState));
  const [radixPoints, setRadixPoints] = React.useState<readonly EphemerisRadixPoint[]>(
    () => ephemerisRadixPointCache.get(documentId)?.points ?? EMPTY_RADIX_POINTS,
  );
  /** Orb bands' half-width (the options' midpoint orb, served with the lines). */
  const [radixOrb, setRadixOrb] = React.useState(() => ephemerisRadixPointCache.get(documentId)?.orb ?? 0);
  const [showRadixBands, setShowRadixBands] = React.useState(() => cachedState?.show_radix_bands ?? false);
  const [showRadixReadingGlyphs, setShowRadixReadingGlyphs] = React.useState(() => cachedState?.show_radix_reading_glyphs ?? true);
  const [colorRadixLabels, setColorRadixLabels] = React.useState(() => cachedState?.color_radix_labels ?? false);
  /** Natal line under the pointer, or clicked (pinned until clicked again or
   * Escape): forward with its contour glyphs, the other lines receded. */
  const [hoverRadixKey, setHoverRadixKey] = React.useState<string | null>(null);
  const [pinnedRadixKey, setPinnedRadixKey] = React.useState<string | null>(null);
  /** Clicked curve: stays highlighted (its rings in front) until clicked again. */
  const [pinnedPlanetId, setPinnedPlanetId] = React.useState<number | null>(null);
  const [modulus, setModulus] = React.useState<EphemerisModulus>(() => seededModulus(cachedState));
  const [inkMode, setInkMode] = React.useState<EphemerisInkMode>(() => seededInkMode(cachedState));
  const [visibleOverrides, setVisibleOverrides] = React.useState<Record<number, boolean>>(() => seededVisible(cachedState));
  const [hover, setHover] = React.useState<HoverState>(null);
  // The curve under the pointer, merged into the scene after its heavy part so
  // hover repaints the plot layer only.
  const [highlightPlanetId, setHighlightPlanetId] = React.useState<number | null>(null);
  // Right-click moment for the timed-chart actions (greenwich jd; the daemon
  // converts to radix-local, workspace_service._timed_chart_when_iso).
  const [menuJd, setMenuJd] = React.useState<number | null>(null);

  // Camera and paint inputs live in refs: a frame reads them, never React.
  const [openingCamera] = React.useState<EphemerisCamera | null>(() => (cachedState ? seededCamera(cachedState) : null));
  const cameraRef = React.useRef<EphemerisCamera | null>(openingCamera);
  const initialCameraRef = React.useRef<EphemerisCamera | null>(openingCamera);
  const interactedRef = React.useRef(false);
  const tweenRef = React.useRef<EphemerisCameraTween | null>(null);
  /** A step waiting for its months to become resident (see stepBy). */
  const pendingStepRef = React.useRef<EphemerisCamera | null>(null);
  const pendingStepTimerRef = React.useRef<number | null>(null);
  /** Lands the waiting step; read by the store subscription. */
  const stepLandedRef = React.useRef<() => void>(() => {});
  const stepResidentRef = React.useRef<(camera: EphemerisCamera) => boolean>(() => false);
  const panDirectionRef = React.useRef<-1 | 0 | 1>(0);
  const lastStartRef = React.useRef<number | null>(null);
  const sizeRef = React.useRef<Size | null>(null);
  const sceneRef = React.useRef<EphemerisScene | null>(null);
  const hoverGlyphColorsRef = React.useRef<EphemerisMeta["hoverGlyphColors"]>(undefined);
  const styleRef = React.useRef<EphemerisRenderStyle | null>(null);
  const geoRef = React.useRef<EphemerisGeometry | null>(null);
  const measureRef = React.useRef<{ font: string; measure: TextMeasure } | null>(null);
  const chromeInputsRef = React.useRef<readonly unknown[] | null>(null);
  const fontsReadyRef = React.useRef(false);
  const frameRequestRef = React.useRef<number | null>(null);
  const frameRef = React.useRef<() => void>(() => {});
  const heldNavigationKeysRef = React.useRef(new Set<GraphicEphemerisStepKey>());
  const persistTimerRef = React.useRef<number | null>(null);
  const settleTimerRef = React.useRef<number | null>(null);
  const hoverRef = React.useRef<HoverState>(null);
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const dragRef = React.useRef<{ pointerId: number; startX: number; camera: EphemerisCamera; moved: boolean } | null>(null);
  const mountedAtRef = React.useRef(0);
  const warmOpenRef = React.useRef(false);
  const firstPaintRef = React.useRef(false);
  const hasDataRef = React.useRef(hasData);
  const radixStore = React.useMemo(() => radixStoreFor(documentId), [documentId]);
  /** Points, per-point choice and the fast-contacts toggle, readable per frame. */
  const radixInputsRef = React.useRef<{ points: readonly EphemerisRadixPoint[]; visible: (p: EphemerisRadixPoint) => boolean; fast: boolean }>({
    points: EMPTY_RADIX_POINTS,
    visible: () => false,
    fast: false,
  });
  const radixLayerRef = React.useRef<EphemerisRadixLayer>(EMPTY_RADIX_LAYER);
  const pinnedPlanetRef = React.useRef<number | null>(null);
  const pinnedRadixRef = React.useRef<string | null>(null);
  /** The pinned natal line's recede fade, sampled per plot frame. */
  const recedeFadeRef = React.useRef<EphemerisRecedeFade | null>(null);
  /** Inspector regions this view wrote: the hovered one, and the clicked one
   * it pinned (inspectorActiveRegion, the wheel's click pin). */
  const ownHoverKeyRef = React.useRef<string | null>(null);
  const ownPinKeyRef = React.useRef<string | null>(null);
  const radixDocumentId = useEphemerisRadixDocumentId(documentId);
  const viewId = React.useId();

  const theme = useThemeStore((s) => s.theme);
  const styleRevision = useStyleRevision();
  const ephemerisDataKey = useEphemerisDataKey();
  const chartTextFont = morinusTextFontFromTokens(theme?.appTokens);
  const chartSymbolFont =
    theme?.appTokens?.["--aries-font-symbols"]?.trim() || '"AriesMorinus"';
  const chartFontKey = `${chartTextFont}\u0000${chartSymbolFont}`;
  const fontsReady = fontsReadyFor === chartFontKey;
  const chartProfileOverrides =
    theme?.profileOverrides.chartPalette ?? EMPTY_EPHEMERIS_PROFILE_OVERRIDES;
  const ephemerisPaletteOverrides = React.useMemo(() => {
    const outOfBounds = theme?.appTokens?.["--aries-destructive"]?.trim();
    return outOfBounds
      ? { ...chartProfileOverrides, "--aries-destructive": outOfBounds }
      : chartProfileOverrides;
  }, [chartProfileOverrides, theme?.appTokens]);
  const profilePlanetColors = theme?.profileOverrides.chartData.planets;
  const effectivePalette = React.useMemo(
    () => resolveEphemerisRenderPalette(
      meta?.colors ?? DEFAULT_EPHEMERIS_RENDER_PALETTE,
      ephemerisPaletteOverrides,
    ),
    [ephemerisPaletteOverrides, meta?.colors],
  );
  const effectivePlanets = React.useMemo(
    () => (meta ? applyEphemerisPlanetProfileColors(meta.planets, profilePlanetColors) : []),
    [meta, profilePlanetColors],
  );
  // Planets without a stored choice follow the mode's factory default.
  const visible = React.useMemo(() => {
    const next: Record<number, boolean> = {};
    for (const planet of meta?.planets ?? []) {
      next[planet.id] = Object.prototype.hasOwnProperty.call(visibleOverrides, planet.id)
        ? Boolean(visibleOverrides[planet.id])
        : planet.defaultVisible[mode];
    }
    return next;
  }, [meta, mode, visibleOverrides]);

  const dignityBySign = React.useMemo(() => dignityTable(meta?.dignityBySign), [meta?.dignityBySign]);
  const zodiacLabel = meta?.zodiacLabel?.trim() ?? "";
  const monthLabels = meta?.monthLabels;
  // Calendar parts of a JD, the month capitalized like the hover flag's date
  // (ephemeris-hit-test).
  const dateParts = React.useCallback(
    (jd: number) => {
      const { year, month, day } = calendarOfJd(jd);
      const monthTxt = monthLabels?.[month - 1] ?? "";
      return { day, month: `${monthTxt.charAt(0).toUpperCase()}${monthTxt.slice(1)}`, year };
    },
    [monthLabels],
  );
  // Localized technical header: the reading line's date when it is shown
  // ("…At" keys), else "from" the plate's left edge date.
  const headerText = React.useCallback(
    (jd: number) => {
      const date = dateParts(jd);
      const modulusTxt = `${modulus}°`;
      if (showNowLine) {
        if (mode === "declination") return t("ephem.plateHeaderDeclinationAt", date);
        return zodiacLabel
          ? t("ephem.plateHeaderLongitudeAt", { ...date, zodiac: zodiacLabel, modulus: modulusTxt })
          : t("ephem.plateHeaderLongitudeNoZodiacAt", { ...date, modulus: modulusTxt });
      }
      if (mode === "declination") return t("ephem.plateHeaderDeclination", date);
      return zodiacLabel
        ? t("ephem.plateHeaderLongitude", { ...date, zodiac: zodiacLabel, modulus: modulusTxt })
        : t("ephem.plateHeaderLongitudeNoZodiac", { ...date, modulus: modulusTxt });
    },
    [dateParts, modulus, mode, showNowLine, t, zodiacLabel],
  );
  const nowLineLabel = React.useCallback((jd: number) => t("ephem.nowLineDate", dateParts(jd)), [dateParts, t]);

  const baseScene = React.useMemo<Omit<EphemerisScene, "highlightPlanetId"> | null>(
    () =>
      meta
        ? {
            mode,
            planets: effectivePlanets,
            visible,
            signGlyphs: meta.signGlyphs,
            signNames: meta.signNames,
            monthLabels: meta.monthLabels,
            showGrid,
            showEventGlyphs,
            showLunations,
            lunationLabels: { new: newMoonLabel, full: fullMoonLabel },
            eclipseLetters: { solar: solarEclipseLetter, lunar: lunarEclipseLetter },
            outOfBoundsLabel: outOfBoundsMarkerLabel,
            modulus,
            inkMode,
            mirrored,
            dignityBySign,
            usePlanetColors: meta.usePlanetColors ?? false,
            showEquator,
            showOutOfBoundsRange,
            showSignBands,
            showRadix: mode === "longitude" && showRadix,
            showPlanetContacts: mode === "longitude" && showPlanetContacts,
            showRadixBands,
            showRadixReadingGlyphs,
            colorRadixLabels,
            radixBandOrb: radixOrb,
            showNowLine,
            nowLineLabel,
            headerText,
          }
        : null,
    [colorRadixLabels, dignityBySign, effectivePlanets, fullMoonLabel, headerText, inkMode, lunarEclipseLetter, meta, mirrored, mode, modulus, newMoonLabel, nowLineLabel, outOfBoundsMarkerLabel, radixOrb, solarEclipseLetter, showEquator, showEventGlyphs, showGrid, showLunations, showNowLine, showOutOfBoundsRange, showPlanetContacts, showRadix, showRadixBands, showRadixReadingGlyphs, showSignBands, visible],
  );
  // Hover only re-spreads the finished scene: every heavy field keeps its
  // identity, so the chrome inputs stay equal and only the plot repaints.
  const scene = React.useMemo<EphemerisScene | null>(
    () =>
      baseScene
        ? { ...baseScene, highlightPlanetId: pinnedPlanetId ?? highlightPlanetId, radixFocusKey: pinnedRadixKey ?? hoverRadixKey, radixFocusPinned: pinnedRadixKey != null }
        : null,
    [baseScene, highlightPlanetId, hoverRadixKey, pinnedPlanetId, pinnedRadixKey],
  );

  React.useLayoutEffect(() => {
    radixInputsRef.current = {
      points: radixPoints,
      visible: (point) =>
        Object.prototype.hasOwnProperty.call(radixPointOverrides, point.key)
          ? Boolean(radixPointOverrides[point.key])
          : point.defaultVisible,
      fast: showFastContacts,
    };
    pinnedPlanetRef.current = pinnedPlanetId;
    pinnedRadixRef.current = pinnedRadixKey;
    requestFrameRef.current();
  }, [pinnedPlanetId, pinnedRadixKey, radixPointOverrides, radixPoints, showFastContacts]);

  // A natal-line pin fades the other lines down, its release back up, after
  // the style's short pause; the plot frame samples the fade (no React state
  // per frame). Reduced motion jumps. Hover never reaches this.
  React.useLayoutEffect(() => {
    const radix = styleRef.current?.radix;
    const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    recedeFadeRef.current = retargetEphemerisRecede(recedeFadeRef.current, pinnedRadixKey != null ? 1 : 0, pinnedRadixKey, ephemerisNow(), {
      delayMs: radix?.radixRecedeDelayMs ?? 0,
      durationMs: radix?.radixRecedeFadeMs ?? 0,
      reducedMotion,
    });
    requestFrameRef.current();
  }, [pinnedRadixKey]);

  // Everything the persisted state needs, readable from callbacks.
  const togglesRef = React.useRef({ mode, showGrid, showEventGlyphs, showLunations, visible, modulus, inkMode, mirrored, showEquator, showOutOfBoundsRange, showSignBands, showRadix, showFastContacts, showPlanetContacts, showRadixBands, showRadixReadingGlyphs, colorRadixLabels, radixPointOverrides, showNowLine, hoverLineColors });
  React.useLayoutEffect(() => {
    togglesRef.current = { mode, showGrid, showEventGlyphs, showLunations, visible, modulus, inkMode, mirrored, showEquator, showOutOfBoundsRange, showSignBands, showRadix, showFastContacts, showPlanetContacts, showRadixBands, showRadixReadingGlyphs, colorRadixLabels, radixPointOverrides, showNowLine, hoverLineColors };
  }, [colorRadixLabels, hoverLineColors, inkMode, mirrored, mode, modulus, radixPointOverrides, showEquator, showEventGlyphs, showFastContacts, showGrid, showLunations, showNowLine, showOutOfBoundsRange, showPlanetContacts, showRadix, showRadixBands, showRadixReadingGlyphs, showSignBands, visible]);

  const requestFrame = React.useCallback(() => {
    if (frameRequestRef.current != null) return;
    frameRequestRef.current = requestAnimationFrame(() => {
      frameRequestRef.current = null;
      frameRef.current();
    });
  }, []);
  const requestFrameRef = React.useRef(requestFrame);

  /** Year layers the scene draws (longitude only). The frame declares them
   * with its range; the block store loads them as overlays once the range
   * holds still (and ahead of it while idle). */
  const shownYearLayers = React.useCallback(
    (currentScene: EphemerisScene | null): readonly string[] => {
      if (!currentScene || currentScene.mode !== "longitude") return NO_YEAR_LAYERS;
      const layers: string[] = [];
      if (currentScene.showRadix) layers.push(radixStore.layerId);
      if (currentScene.showPlanetContacts) layers.push(ephemerisContactStore.layerId);
      return layers.length ? layers : NO_YEAR_LAYERS;
    },
    [radixStore],
  );
  /** Whether a step to `camera` lands on resident curves. Marks, station
   * letters, rings and contacts are overlays: they never hold a step back
   * and fill in once the burst stops (they are prefetched ahead while idle). */
  const stepResident = React.useCallback(
    (camera: EphemerisCamera) => ephemerisStore.isResident(camera.startJd, cameraEndJd(camera), false),
    [],
  );
  React.useLayoutEffect(() => {
    stepResidentRef.current = stepResident;
  }, [stepResident]);
  const radixLayerMemoRef = React.useRef<{ inputs: readonly unknown[]; layer: EphemerisRadixLayer } | null>(null);

  /** The radix layer and planet contacts for this camera: the resident rows
   * of the years it touches, filtered by the scene's toggles. Rows keep
   * their identity while nothing landed, so an unchanged filter input set
   * reuses the last layer (no per-frame filtering during a tween). */
  const radixLayerFor = React.useCallback(
    (currentScene: EphemerisScene, camera: EphemerisCamera): EphemerisRadixLayer => {
      if (!currentScene.showRadix && !currentScene.showPlanetContacts) return EMPTY_RADIX_LAYER;
      const inputs = radixInputsRef.current;
      const years = radixYearsOf(camera);
      const points = currentScene.showRadix ? inputs.points : EMPTY_RADIX_POINTS;
      const rows = currentScene.showRadix ? radixStore.rows(years) : EMPTY_RADIX_LAYER.crossings;
      const contacts = currentScene.showPlanetContacts ? ephemerisContactStore.rows(years) : EMPTY_RADIX_LAYER.contacts;
      const memoInputs = [points, inputs.visible, rows, currentScene.visible, currentScene.modulus, inputs.fast, contacts];
      const memo = radixLayerMemoRef.current;
      if (memo && memo.inputs.length === memoInputs.length && memo.inputs.every((v, i) => v === memoInputs[i])) {
        return memo.layer;
      }
      const layer = ephemerisRadixLayer(points, inputs.visible, rows, currentScene, inputs.fast, contacts);
      radixLayerMemoRef.current = { inputs: memoInputs, layer };
      return layer;
    },
    [radixStore],
  );

  // --- One frame: advance the tween, repaint chrome when its inputs moved,
  // declare the visible range to the store and paint the moving layer.
  React.useLayoutEffect(() => {
    frameRef.current = () => {
      const started = ephemerisNow();
      const size = sizeRef.current;
      const currentScene = sceneRef.current;
      const style = styleRef.current;
      const chromeCanvas = chromeCanvasRef.current;
      const plotCanvas = canvasRef.current;
      let camera = cameraRef.current;
      if (!camera) return;
      const tween = tweenRef.current;
      if (tween) {
        const at = cameraTweenAt(tween, started);
        camera = at.camera;
        cameraRef.current = camera;
        if (at.done) tweenRef.current = null;
        else requestFrame();
      }
      // Declare the range before anything can stop the paint, so blocks load
      // in parallel with meta, fonts and style on a cold open.
      const lastStart = lastStartRef.current;
      if (lastStart != null && camera.startJd !== lastStart) {
        panDirectionRef.current = camera.startJd > lastStart ? 1 : -1;
      }
      lastStartRef.current = camera.startJd;
      const endJd = cameraEndJd(camera);
      // While a step eases, ask for where the camera will stop: in a held
      // burst that is the range the step lands on, and the frames in between are
      // passing through it anyway.
      const heading = pendingStepRef.current ?? tweenRef.current?.to ?? camera;
      ephemerisStore.setInterest(viewId, {
        startJd: heading.startJd,
        endJd: cameraEndJd(heading),
        panDirection: panDirectionRef.current,
        layers: shownYearLayers(currentScene),
      });
      if (!size || !currentScene || !style || !chromeCanvas || !plotCanvas || !fontsReadyRef.current) return;
      const resizedChrome = fitCanvas(chromeCanvas, size);
      fitCanvas(plotCanvas, size);
      const chrome = surfaceOf(chromeCanvas, size);
      const plot = surfaceOf(plotCanvas, size);
      if (!chrome || !plot) return;
      if (measureRef.current?.font !== style.typography.fontUi) {
        measureRef.current = { font: style.typography.fontUi, measure: createTextMeasure(chrome.ctx, style.typography.fontUi) };
      }
      const measure = measureRef.current.measure;
      const chromeInputs = ephemerisChromeInputs(size, style, currentScene);
      const chromeDirty = resizedChrome || !sameEphemerisChromeInputs(chromeInputsRef.current, chromeInputs);
      if (chromeDirty || !geoRef.current) {
        geoRef.current = ephemerisPlateGeometry(size, currentScene, style, measure);
      }
      const geo = geoRef.current;
      radixLayerRef.current = radixLayerFor(currentScene, camera);
      const fade = recedeFadeRef.current;
      const recede = fade ? { amount: ephemerisRecedeAmount(fade, started), key: fade.key } : undefined;
      if (fade && !ephemerisRecedeDone(fade, started)) requestFrame();
      paintEphemerisPlate(chromeDirty ? chrome : null, plot, {
        geo,
        camera,
        data: ephemerisStore.frameData(camera.startJd, endJd),
        scene: currentScene,
        style,
        measure,
        radix: radixLayerRef.current,
        recede,
      });
      if (chromeDirty) chromeInputsRef.current = chromeInputs;
      if (!firstPaintRef.current && ephemerisStore.isResident(camera.startJd, endJd, false)) {
        firstPaintRef.current = true;
        recordEphemerisFirstPaint(warmOpenRef.current ? "warm" : "cold", mountedAtRef.current);
      }
      recordEphemerisFrame(started);
    };
  }, [radixLayerFor, requestFrame, shownYearLayers, viewId]);

  // Radix crossings and planet contacts land through the block store too:
  // its one subscription below repaints the frame for every kind.

  React.useEffect(() => {
    mountedAtRef.current = ephemerisNow();
    warmOpenRef.current = ephemerisStore.stats().blocks > 0;
    const unsubscribe = ephemerisStore.subscribe(() => {
      const pending = pendingStepRef.current;
      if (pending && stepResidentRef.current(pending)) stepLandedRef.current();
      requestFrame();
      // React state changes only here, when data lands, never in a frame.
      if (!hasDataRef.current && ephemerisStore.stats().blocks > 0) {
        hasDataRef.current = true;
        setHasData(true);
      }
      const storeError = ephemerisStore.error;
      setBlockError(storeError && !hasDataRef.current ? storeError : null);
      // Blocks came back under a data key the meta does not know: refresh it.
      const key = ephemerisStore.dataKey;
      if (key && ephemerisMetaCache && ephemerisMetaCache.meta.dataKey !== key) {
        ephemerisMetaCache = null;
        setMetaNonce((n) => n + 1);
      }
    });
    return () => {
      unsubscribe();
      if (pendingStepTimerRef.current != null) window.clearTimeout(pendingStepTimerRef.current);
      pendingStepTimerRef.current = null;
      pendingStepRef.current = null;
      ephemerisStore.setInterest(viewId, null);
      if (frameRequestRef.current != null) cancelAnimationFrame(frameRequestRef.current);
      frameRequestRef.current = null;
    };
  }, [requestFrame, viewId]);

  React.useLayoutEffect(() => {
    sceneRef.current = scene;
    requestFrame();
  }, [requestFrame, scene]);
  React.useLayoutEffect(() => {
    hoverGlyphColorsRef.current = meta?.hoverGlyphColors;
  }, [meta?.hoverGlyphColors]);

  React.useEffect(() => {
    let cancelled = false;
    void awaitFonts(chartTextFont, chartSymbolFont).then(() => {
      if (!cancelled) setFontsReadyFor(chartFontKey);
    });
    return () => {
      cancelled = true;
    };
  }, [chartFontKey, chartSymbolFont, chartTextFont]);

  // --- Resolved style: read once per style input change, not per frame.
  React.useLayoutEffect(() => {
    const wrap = wrapRef.current;
    fontsReadyRef.current = fontsReady;
    if (!wrap || !fontsReady) return;
    const renderStyle = resolveEphemerisRenderStyle(wrap, {
      revision: styleRevision,
      palette: effectivePalette,
      fontUi: chartTextFont,
      fontSymbols: chartSymbolFont,
      profileOverrides: chartProfileOverrides,
    });
    styleRef.current = renderStyle;
    requestFrame();
  }, [chartProfileOverrides, chartSymbolFont, chartTextFont, effectivePalette, fontsReady, requestFrame, styleRevision]);

  React.useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measureSize = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      sizeRef.current = {
        w: rect.width,
        h: rect.height,
        dpr: positive(window.devicePixelRatio || 1, 1),
      };
      requestFrame();
    };
    measureSize();
    const ro = new ResizeObserver(measureSize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [requestFrame]);

  // --- Meta: refetched when the options revision moves (payload_revision_key);
  // the store keeps drawing old blocks until the new data key covers the view.
  React.useEffect(() => {
    const cached = ephemerisMetaCache;
    if (cached && cached.revision === ephemerisDataKey) {
      ephemerisStore.setDataKey(cached.meta.dataKey);
      return;
    }
    const controller = new AbortController();
    void fetchEphemerisMeta(controller.signal)
      .then((next) => {
        ephemerisMetaCache = { revision: ephemerisDataKey, meta: next };
        ephemerisStore.setDataKey(next.dataKey);
        setMetaError(null);
        setMeta(next);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[ephemeris-meta]", err);
        setMetaError(String((err as Error).message ?? err));
      });
    return () => controller.abort();
  }, [ephemerisDataKey, metaNonce]);

  // --- Radix lines: refetched when the options revision or the parent
  // radix's revision moves, when the crossing store meets a year computed for
  // another point set, and (with backoff) after a failed fetch. The crossing
  // store keys on the point set and the block data key, so a new zodiac or a
  // rebuilt radix drops its years; the current lines stay until the new ones
  // land.
  const metaDataKey = meta?.dataKey ?? "";
  const radixRevision = useEphemerisRadixRevision(documentId);
  const [radixPointsNonce, setRadixPointsNonce] = React.useState(0);
  const radixPointsAttemptsRef = React.useRef(0);
  const staleRadixKeyRef = React.useRef("");
  const radixPointsRevision = `${ephemerisDataKey}|${radixRevision}|${radixPointsNonce}`;
  React.useEffect(() => {
    // The state was seeded from this cache; only a new revision refetches.
    const cached = ephemerisRadixPointCache.get(documentId);
    if (cached && cached.revision === radixPointsRevision) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | null = null;
    void fetchEphemerisNatal(documentId, controller.signal)
      .then((wire) => {
        const decoded = decodeEphemerisRadixPoints(wire);
        radixPointsAttemptsRef.current = 0;
        ephemerisRadixPointCache.set(documentId, { revision: radixPointsRevision, ...decoded });
        setRadixPoints(decoded.points);
        setRadixOrb(decoded.orb);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[ephemeris-radix-points]", err);
        const attempts = ++radixPointsAttemptsRef.current;
        retry = setTimeout(
          () => setRadixPointsNonce((n) => n + 1),
          Math.min(RADIX_POINTS_RETRY_MAX_MS, RADIX_POINTS_RETRY_MS * 2 ** (attempts - 1)),
        );
      });
    return () => {
      controller.abort();
      if (retry != null) clearTimeout(retry);
    };
  }, [documentId, radixPointsRevision]);
  // The daemon served crossings for another point set: the lines on screen
  // are stale. Refetch them once per served key.
  React.useEffect(
    () =>
      radixStore.onStaleRadix((served) => {
        if (staleRadixKeyRef.current === served) return;
        staleRadixKeyRef.current = served;
        setRadixPointsNonce((n) => n + 1);
      }),
    [radixStore],
  );
  React.useEffect(() => {
    const radixKey = ephemerisRadixPointCache.get(documentId)?.radixKey ?? "";
    radixStore.setRadix(radixKey, metaDataKey);
    requestFrame();
  }, [documentId, metaDataKey, radixPoints, radixStore, requestFrame]);
  // Planet contacts depend only on the block data (zodiac, planet set).
  React.useEffect(() => {
    ephemerisContactStore.setKey(metaDataKey);
    requestFrame();
  }, [metaDataKey, requestFrame]);

  // --- Persisted per-radix view state (graphephemframe.apply_state twin).
  const lastWriteRef = React.useRef<Promise<void>>(Promise.resolve());
  const persistViewState = React.useCallback(
    (next: Partial<EphemerisViewState>) => {
      const toggles = togglesRef.current;
      const camera = tweenRef.current?.to ?? cameraRef.current;
      const state: EphemerisViewState = {
        ...(camera ? { camera: { startJd: camera.startJd, spanDays: camera.spanDays } } : {}),
        show_grid: toggles.showGrid,
        show_event_glyphs: toggles.showEventGlyphs,
        show_lunations: toggles.showLunations,
        display_mode: toggles.mode,
        modulus: toggles.modulus,
        ink_mode: toggles.inkMode,
        mirrored: toggles.mirrored,
        show_equator: toggles.showEquator,
        show_oob_range: toggles.showOutOfBoundsRange,
        show_sign_bands: toggles.showSignBands,
        show_radix: toggles.showRadix,
        show_fast_contacts: toggles.showFastContacts,
        show_planet_contacts: toggles.showPlanetContacts,
        show_radix_bands: toggles.showRadixBands,
        show_radix_reading_glyphs: toggles.showRadixReadingGlyphs,
        color_radix_labels: toggles.colorRadixLabels,
        radix_points: toggles.radixPointOverrides,
        show_now_line: toggles.showNowLine,
        hover_line_colors: toggles.hoverLineColors,
        visible_planets: Object.fromEntries(Object.entries(toggles.visible).map(([k, v]) => [k, Boolean(v)])),
        ...next,
      };
      ephemerisViewStateCache.set(documentId, state);
      const write = storeEphemerisViewState(documentId, state).catch((err) =>
        console.error("[ephemeris-state-store]", err),
      );
      lastWriteRef.current = write;
      return write;
    },
    [documentId],
  );

  const flushCameraPersist = React.useCallback(async () => {
    if (persistTimerRef.current == null) {
      await lastWriteRef.current;
      return;
    }
    window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = null;
    await persistViewState({});
  }, [persistViewState]);

  const scheduleCameraPersist = React.useCallback(() => {
    if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current);
    // A held arrow burst writes once, after it ends.
    const arm = () => {
      persistTimerRef.current = window.setTimeout(() => {
        persistTimerRef.current = null;
        if (heldNavigationKeysRef.current.size > 0) {
          arm();
          return;
        }
        persistViewState({});
      }, CAMERA_PERSIST_MS);
    };
    arm();
  }, [persistViewState]);

  React.useEffect(() => {
    let cancelled = false;
    void fetchEphemerisViewState(documentId)
      .then((state) => {
        if (cancelled) return;
        ephemerisViewStateCache.set(documentId, state);
        const camera = seededCamera(state);
        if (!interactedRef.current) {
          if (!camerasEqual(cameraRef.current, camera)) cameraRef.current = camera;
          initialCameraRef.current = camera;
          setMode(seededMode(state));
          if (typeof state.show_grid === "boolean") setShowGrid(state.show_grid);
          if (typeof state.show_event_glyphs === "boolean") setShowEventGlyphs(state.show_event_glyphs);
          if (typeof state.show_lunations === "boolean") setShowLunations(state.show_lunations);
          if (typeof state.mirrored === "boolean") setMirrored(state.mirrored);
          if (typeof state.show_equator === "boolean") setShowEquator(state.show_equator);
          if (typeof state.show_oob_range === "boolean") setShowOutOfBoundsRange(state.show_oob_range);
          if (typeof state.show_sign_bands === "boolean") setShowSignBands(state.show_sign_bands);
          if (typeof state.show_radix === "boolean") setShowRadix(state.show_radix);
          if (typeof state.show_fast_contacts === "boolean") setShowFastContacts(state.show_fast_contacts);
          if (typeof state.show_planet_contacts === "boolean") setShowPlanetContacts(state.show_planet_contacts);
          if (typeof state.show_radix_bands === "boolean") setShowRadixBands(state.show_radix_bands);
          if (typeof state.show_radix_reading_glyphs === "boolean") setShowRadixReadingGlyphs(state.show_radix_reading_glyphs);
          if (typeof state.color_radix_labels === "boolean") setColorRadixLabels(state.color_radix_labels);
          if (typeof state.show_now_line === "boolean") setShowNowLine(state.show_now_line);
          if (typeof state.hover_line_colors === "boolean") setHoverLineColors(state.hover_line_colors);
          setRadixPointOverrides(seededRadixPoints(state));
          setModulus(seededModulus(state));
          setInkMode(seededInkMode(state));
          setVisibleOverrides(seededVisible(state));
        }
        requestFrame();
      })
      .catch((err) => {
        console.error("[ephemeris-state]", err);
        if (cancelled || cameraRef.current) return;
        cameraRef.current = seededCamera(undefined);
        initialCameraRef.current = cameraRef.current;
        requestFrame();
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, requestFrame]);

  React.useEffect(
    () => () => {
      void flushCameraPersist();
      if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
    },
    [flushCameraPersist],
  );

  React.useEffect(() => {
    onDisplayModeChange?.(mode);
  }, [mode, onDisplayModeChange]);

  // --- Hover: hit test straight from the store at the pointer.
  const hitAt = React.useCallback((clientX: number, clientY: number): EphemerisHit | null => {
    const canvas = canvasRef.current;
    const geo = geoRef.current;
    const style = styleRef.current;
    const camera = cameraRef.current;
    const currentScene = sceneRef.current;
    if (!canvas || !geo || !style || !camera || !currentScene) return null;
    const rect = canvas.getBoundingClientRect();
    const data = ephemerisStore.frameData(camera.startJd, cameraEndJd(camera));
    const radix = currentScene.showRadix || currentScene.showPlanetContacts ? radixLayerRef.current : null;
    return hitTestEphemeris(clientX - rect.left, clientY - rect.top, camera, geo, data, currentScene, style, radix);
  }, []);

  /** Inspector-only: a curve-head label or the nearest curve (ephemeris-body-hit). */
  const bodyAt = React.useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const geo = geoRef.current;
    const style = styleRef.current;
    const camera = cameraRef.current;
    const currentScene = sceneRef.current;
    if (!canvas || !geo || !style || !camera || !currentScene) return null;
    const rect = canvas.getBoundingClientRect();
    const data = ephemerisStore.frameData(camera.startJd, cameraEndJd(camera));
    return hitTestEphemerisBody(clientX - rect.left, clientY - rect.top, camera, geo, data, currentScene, style);
  }, []);

  /** The natal line under the pointer (radix on, longitude), plot or label column. */
  const radixLineAt = React.useCallback((clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    const geo = geoRef.current;
    const style = styleRef.current;
    const currentScene = sceneRef.current;
    if (!canvas || !geo || !style || !currentScene?.showRadix) return null;
    const rect = canvas.getBoundingClientRect();
    return hitTestEphemerisRadixLine(clientX - rect.left, clientY - rect.top, geo, radixLayerRef.current, currentScene, style.interaction.stationSnapY);
  }, []);

  /** The flag for a hit, its glyph colours resolved now (ephemeris-hover-colors). */
  const hoverOf = React.useCallback((hit: EphemerisHit): NonNullable<HoverState> => {
    const style = styleRef.current;
    const currentScene = sceneRef.current;
    const paint = ephemerisHoverGlyphPaint(hit.info, {
      lineColors: togglesRef.current.hoverLineColors,
      app: hoverGlyphColorsRef.current,
      inks: style && currentScene ? ephemerisInkTable(currentScene, style) : null,
    });
    return { x: hit.x, y: hit.y, info: hit.info, paint };
  }, []);

  const showHover = React.useCallback((next: HoverState) => {
    if (hoverRef.current === null && next === null) return;
    hoverRef.current = next;
    setHover(next);
  }, []);

  /** The hovered curve: the snapped body, else the curve under the pointer. */
  const highlightAt = React.useCallback(
    (hit: EphemerisHit | null, clientX: number | null, clientY: number | null) => {
      const planet =
        hit?.planet ?? (clientX != null && clientY != null ? bodyAt(clientX, clientY)?.planet : undefined) ?? null;
      setHighlightPlanetId((current) => (current === planet ? current : planet));
      // A natal line comes forward only where no curve is under the pointer.
      const radixKey = planet == null && clientX != null && clientY != null ? radixLineAt(clientX, clientY) : null;
      setHoverRadixKey((current) => (current === radixKey ? current : radixKey));
    },
    [bodyAt, radixLineAt],
  );

  /** The Inspector region of a plate target: a snapped body (or the curve
   * under the pointer) at its moment, else the natal point of the natal line
   * under the pointer (ephemeris-inspector-region). */
  const inspectorRegionAt = React.useCallback((hit: EphemerisHit | null, clientX?: number, clientY?: number) => {
    const mode = sceneRef.current?.mode ?? "longitude";
    const body = ephemerisInspectorRegion(
      hit?.planet != null || clientX == null || clientY == null ? hit : bodyAt(clientX, clientY),
      documentId,
      mode,
    );
    if (body || clientX == null || clientY == null) return body;
    const radixKey = radixLineAt(clientX, clientY);
    const point = radixKey != null ? radixLayerRef.current.points.find((p) => p.key === radixKey) : null;
    return ephemerisRadixInspectorRegion(point, radixDocumentId);
  }, [bodyAt, documentId, radixDocumentId, radixLineAt]);

  /** The open Inspector follows a plate target the way it follows wheel hover
   * (a pinned click target stays in front, inspector-panel). Writes only when
   * the target changes, and clears only a region this view set, so the plate's
   * own flag and other panes' hover stay untouched. */
  const followInspector = React.useCallback((hit: EphemerisHit | null, clientX?: number, clientY?: number) => {
    const workspace = useWorkspaceStore.getState();
    const region = useFrameLayoutStore.getState().inspectorOpen ? inspectorRegionAt(hit, clientX, clientY) : null;
    const current = workspace.hoveredRegion;
    const currentKey = hoverRegionKey(current);
    const key = hoverRegionKey(region);
    if (currentKey === key) return;
    const own = current?.viewDocumentId === documentId || (currentKey != null && currentKey === ownHoverKeyRef.current);
    if (region || own) {
      ownHoverKeyRef.current = key;
      workspace.setHoveredRegion(region);
    }
  }, [documentId, inspectorRegionAt]);
  React.useEffect(() => () => {
    const workspace = useWorkspaceStore.getState();
    const currentKey = hoverRegionKey(workspace.hoveredRegion);
    if (workspace.hoveredRegion?.viewDocumentId === documentId || (currentKey != null && currentKey === ownHoverKeyRef.current)) {
      workspace.setHoveredRegion(null);
    }
    ownHoverKeyRef.current = null;
  }, [documentId]);

  /** A click pins its target's region into the Inspector exactly as a wheel
   * click does (setInspectorActiveRegion, while the Inspector is open or on a
   * phone); releasing the plate pin releases it. */
  const pinInspector = React.useCallback((region: ReturnType<typeof inspectorRegionAt>, release: boolean) => {
    if (!useFrameLayoutStore.getState().inspectorOpen && !mobileLayoutMatches()) return;
    const workspace = useWorkspaceStore.getState();
    ownPinKeyRef.current = release ? null : hoverRegionKey(region);
    workspace.setInspectorActiveRegion(release ? null : region);
  }, []);
  // In sync both ways: a plate pin released elsewhere (Escape, radix layer
  // off) releases its Inspector pin, and an Inspector pin replaced or cleared
  // elsewhere (another target clicked, the Inspector closed) releases the plate.
  React.useEffect(() => {
    if (pinnedPlanetId != null || pinnedRadixKey != null || ownPinKeyRef.current == null) return;
    const workspace = useWorkspaceStore.getState();
    if (hoverRegionKey(workspace.inspectorActiveRegion) === ownPinKeyRef.current) workspace.setInspectorActiveRegion(null);
    ownPinKeyRef.current = null;
  }, [pinnedPlanetId, pinnedRadixKey]);
  React.useEffect(() => useWorkspaceStore.subscribe((state, previous) => {
    if (state.inspectorActiveRegion === previous.inspectorActiveRegion || ownPinKeyRef.current == null) return;
    if (hoverRegionKey(state.inspectorActiveRegion) === ownPinKeyRef.current) return;
    ownPinKeyRef.current = null;
    setPinnedPlanetId(null);
    setPinnedRadixKey(null);
  }), []);
  React.useEffect(() => () => {
    const workspace = useWorkspaceStore.getState();
    if (ownPinKeyRef.current != null && hoverRegionKey(workspace.inspectorActiveRegion) === ownPinKeyRef.current) {
      workspace.setInspectorActiveRegion(null);
    }
    ownPinKeyRef.current = null;
  }, [documentId]);

  /** A camera move hides the hover flag; it returns at the pointer once the
   * motion settles, and the camera is written back (debounced). */
  const cameraMoved = React.useCallback(() => {
    showHover(null);
    highlightAt(null, null, null);
    scheduleCameraPersist();
    if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      const pointer = pointerRef.current;
      if (pointer && !dragRef.current) {
        const hit = hitAt(pointer.x, pointer.y);
        highlightAt(hit, pointer.x, pointer.y);
        showHover(hit ? hoverOf(hit) : null);
        followInspector(hit, pointer.x, pointer.y);
      }
    }, EPHEMERIS_TWEEN_MS + MOTION_SETTLE_MS);
  }, [followInspector, highlightAt, hitAt, hoverOf, scheduleCameraPersist, showHover]);

  const moveCamera = React.useCallback(
    (next: EphemerisCamera, animate: boolean, durationMs: number = EPHEMERIS_TWEEN_MS) => {
      const current = cameraRef.current;
      if (!current) return;
      const target = clampCamera(next);
      interactedRef.current = true;
      // Any explicit move supersedes a step still waiting for its months.
      pendingStepRef.current = null;
      if (pendingStepTimerRef.current != null) window.clearTimeout(pendingStepTimerRef.current);
      pendingStepTimerRef.current = null;
      if (animate) {
        tweenRef.current = { from: current, to: target, startedAt: ephemerisNow(), durationMs };
      } else {
        tweenRef.current = null;
        cameraRef.current = target;
      }
      cameraMoved();
      requestFrame();
    },
    [cameraMoved, requestFrame],
  );

  /** Where the camera is heading (the tween target), for chained steps. */
  const targetCamera = React.useCallback(() => tweenRef.current?.to ?? cameraRef.current, []);

  const plotWidth = React.useCallback(() => geoRef.current?.plotWidth ?? 1, []);
  /** Plot x (0 = plot origin) under a client x; the plot centre without one. */
  const plotXAt = React.useCallback((clientX: number | null): number => {
    const geo = geoRef.current;
    const canvas = canvasRef.current;
    if (!geo || !canvas || clientX == null) return (geo?.plotWidth ?? 1) / 2;
    return clientX - canvas.getBoundingClientRect().left - geo.xOrig;
  }, []);

  // --- Stepping (graphephemframe.step_year/step_month): each step is a short clockwork tick.
  // A step lands only on resident months, so the plate never steps into a
  // blank: key repeat can outrun the daemon (≈30 years/s against ≈6 cold
  // years/s), so a step whose months are still loading waits for them, and
  // repeats that arrive meanwhile are dropped. A held burst therefore runs at
  // the speed data arrives. A step that cannot load in time lands anyway.
  const applyPendingStep = React.useCallback(() => {
    const pending = pendingStepRef.current;
    if (!pending) return;
    if (pendingStepTimerRef.current != null) window.clearTimeout(pendingStepTimerRef.current);
    pendingStepTimerRef.current = null;
    pendingStepRef.current = null;
    moveCamera(pending, true, EPHEMERIS_TICK_MS);
  }, [moveCamera]);
  React.useLayoutEffect(() => {
    stepLandedRef.current = applyPendingStep;
  }, [applyPendingStep]);

  const stepBy = React.useCallback(
    (key: GraphicEphemerisStepKey) => {
      if (pendingStepRef.current) return;
      const base = targetCamera();
      if (!base) return;
      // With the reading line the centre (the current moment) steps by
      // calendar months under the fixed line; without it both edges do.
      const next = clampCamera(togglesRef.current.showNowLine ? stepCameraCenter(base, key) : stepCamera(base, key));
      if (stepResident(next)) {
        moveCamera(next, true, EPHEMERIS_TICK_MS);
        return;
      }
      pendingStepRef.current = next;
      panDirectionRef.current = next.startJd > base.startJd ? 1 : -1;
      pendingStepTimerRef.current = window.setTimeout(applyPendingStep, PENDING_STEP_MAX_WAIT_MS);
      requestFrame();
    },
    [applyPendingStep, moveCamera, requestFrame, stepResident, targetCamera],
  );

  const resetToInitialCamera = React.useCallback(() => {
    const opening = initialCameraRef.current;
    if (!opening) return;
    // Space: the opening moment at the standard zoom, whatever span the
    // plate reopened at (a zoom kept from before the last close).
    const initial = defaultCameraAround(cameraCenterJd(opening));
    // Space is a barrier for an in-progress arrow burst.
    heldNavigationKeysRef.current.clear();
    moveCamera(initial, true, EPHEMERIS_TICK_MS);
    if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = null;
    persistViewState({ camera: { startJd: initial.startJd, spanDays: initial.spanDays } });
  }, [moveCamera, persistViewState]);

  const zoomBy = React.useCallback(
    (direction: "in" | "out" | "reset", anchorX: number) => {
      const base = targetCamera();
      if (!base) return;
      const width = plotWidth();
      const line = togglesRef.current.showNowLine;
      const anchor = line ? width / 2 : anchorX;
      const next =
        direction === "reset"
          ? line
            ? resetZoomCameraCenter(base)
            : resetZoomCamera(base, width, anchor)
          : zoomCameraAround(base, width, anchor, direction === "in" ? 1 / KEY_ZOOM_FACTOR : KEY_ZOOM_FACTOR);
      if (!camerasEqual(next, base)) moveCamera(next, true);
    },
    [moveCamera, plotWidth, targetCamera],
  );

  const pressNavigationKey = React.useCallback(
    (key: GraphicEphemerisNavigationKey) => {
      if (!cameraRef.current) return;
      if (key === "space") {
        resetToInitialCamera();
        return;
      }
      heldNavigationKeysRef.current.add(key);
      stepBy(key);
    },
    [resetToInitialCamera, stepBy],
  );

  const releaseNavigationKey = React.useCallback((key: GraphicEphemerisStepKey | null) => {
    if (key == null) heldNavigationKeysRef.current.clear();
    else heldNavigationKeysRef.current.delete(key);
  }, []);

  const navigationPressRef = React.useRef(pressNavigationKey);
  const navigationReleaseRef = React.useRef(releaseNavigationKey);
  React.useLayoutEffect(() => {
    navigationPressRef.current = pressNavigationKey;
    navigationReleaseRef.current = releaseNavigationKey;
  }, [pressNavigationKey, releaseNavigationKey]);

  // Spotlight "current": the daemon centred the stored camera on the typed
  // moment; travel there like a step, keeping the opening camera for Space.
  React.useLayoutEffect(() => {
    return registerGraphicEphemerisCamera(
      documentId,
      (camera) => {
        const next = normalizeEphemerisCamera(camera);
        if (next) moveCamera(next, true, EPHEMERIS_TICK_MS);
      },
      flushCameraPersist,
    );
  }, [documentId, flushCameraPersist, moveCamera]);

  React.useLayoutEffect(() => {
    return registerGraphicEphemerisNavigator(
      documentId,
      (key) => navigationPressRef.current(key),
      (key) => navigationReleaseRef.current(key),
    );
  }, [documentId]);

  React.useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      const key = stepKeyOf(event.key);
      if (key) navigationReleaseRef.current(key);
    };
    const closeBurst = () => navigationReleaseRef.current(null);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") closeBurst();
    };
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", closeBurst);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", closeBurst);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      closeBurst();
    };
  }, [documentId]);

  // --- Pinch and ctrl/⌘-scroll zoom around the reading line while it is
  // shown (so it never drifts), else around the pointer; two-finger
  // horizontal scroll pans. Continuous, painted per frame.
  React.useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const zoomAnchorX = (clientX: number) => (togglesRef.current.showNowLine ? plotWidth() / 2 : plotXAt(clientX));
    let gestureScale = 1;
    let gestureActive = false;
    const onWheel = (e: WheelEvent) => {
      const camera = cameraRef.current;
      if (!camera) return;
      const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? wrap.clientHeight : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (gestureActive) return;
        const delta = Math.max(-WHEEL_ZOOM_MAX_PX, Math.min(WHEEL_ZOOM_MAX_PX, (e.deltaY === 0 ? e.deltaX : e.deltaY) * unit));
        moveCamera(zoomCameraAround(camera, plotWidth(), zoomAnchorX(e.clientX), Math.exp(delta * WHEEL_ZOOM_PER_PX)), false);
        return;
      }
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      moveCamera(panCamera(camera, plotWidth(), -e.deltaX * unit), false);
    };
    type GestureEventLike = Event & { scale: number; clientX: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureActive = true;
      gestureScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as GestureEventLike;
      const camera = cameraRef.current;
      if (!camera || !Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
      const factor = gestureScale / gesture.scale;
      gestureScale = gesture.scale;
      moveCamera(zoomCameraAround(camera, plotWidth(), zoomAnchorX(gesture.clientX), factor), false);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureActive = false;
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    wrap.addEventListener("gesturestart", onGestureStart);
    wrap.addEventListener("gesturechange", onGestureChange);
    wrap.addEventListener("gestureend", onGestureEnd);
    return () => {
      wrap.removeEventListener("wheel", onWheel);
      wrap.removeEventListener("gesturestart", onGestureStart);
      wrap.removeEventListener("gesturechange", onGestureChange);
      wrap.removeEventListener("gestureend", onGestureEnd);
    };
  }, [moveCamera, plotWidth, plotXAt]);

  const onPlotKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.altKey || e.ctrlKey) return;
      if (e.key === "Escape" && (pinnedPlanetRef.current != null || pinnedRadixRef.current != null)) {
        e.preventDefault();
        e.stopPropagation();
        setPinnedPlanetId(null);
        setPinnedRadixKey(null);
        return;
      }
      const direction = zoomKey(e.key);
      if (!direction) return;
      e.preventDefault();
      e.stopPropagation();
      const pointer = pointerRef.current;
      zoomBy(direction, plotXAt(pointer?.x ?? null));
    },
    [plotXAt, zoomBy],
  );

  // --- Drag pan + hover.
  const onPointerDown = React.useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    wrapRef.current?.focus();
    const camera = cameraRef.current;
    if (e.button !== 0 || !camera) return;
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, camera: tweenRef.current?.to ?? camera, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const drag = dragRef.current;
      if (drag && drag.pointerId === e.pointerId) {
        const dx = e.clientX - drag.startX;
        if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        moveCamera(panCamera(drag.camera, plotWidth(), dx), false);
        return;
      }
      if (tweenRef.current) return;
      const hit = hitAt(e.clientX, e.clientY);
      highlightAt(hit, e.clientX, e.clientY);
      showHover(hit ? hoverOf(hit) : null);
      followInspector(hit, e.clientX, e.clientY);
    },
    [followInspector, highlightAt, hitAt, hoverOf, moveCamera, plotWidth, showHover],
  );

  const endDrag = React.useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // A drag moved time under the line: the document's current moment is the
    // camera centre, so write the camera now rather than after the debounce.
    if (drag.moved && togglesRef.current.showNowLine) void flushCameraPersist();
    // A click (no drag) pins the curve under the pointer, off every curve the
    // natal line, with its Inspector info at the clicked moment; clicking it
    // again or empty plate releases both (nextEphemerisPin).
    if (e.type !== "pointerup") return;
    const hit = drag.moved ? null : hitAt(e.clientX, e.clientY);
    const planet = drag.moved ? null : hit?.planet ?? bodyAt(e.clientX, e.clientY)?.planet ?? null;
    const radixKey = drag.moved || planet != null ? null : radixLineAt(e.clientX, e.clientY);
    const next = nextEphemerisPin(
      { planet: pinnedPlanetRef.current, radixKey: pinnedRadixRef.current },
      { planet, radixKey },
      drag.moved,
    );
    if (!next) return;
    const release = next.planet == null && next.radixKey == null;
    pinInspector(release ? null : inspectorRegionAt(hit, e.clientX, e.clientY), release);
    pinnedPlanetRef.current = next.planet;
    pinnedRadixRef.current = next.radixKey;
    setPinnedPlanetId(next.planet);
    setPinnedRadixKey(next.radixKey);
  }, [bodyAt, flushCameraPersist, hitAt, inspectorRegionAt, pinInspector, radixLineAt]);

  const onPointerLeave = React.useCallback(() => {
    pointerRef.current = null;
    highlightAt(null, null, null);
    showHover(null);
    followInspector(null);
  }, [followInspector, highlightAt, showHover]);

  const onContextCapture = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setMenuJd(hitAt(e.clientX, e.clientY)?.jd ?? null);
    },
    [hitAt],
  );

  const fireTimed = React.useCallback(
    (action: TimedChartAction) => {
      if (menuJd == null) return;
      const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
      void openDirectionsTimedChart(documentId, action, "", menuJd, null, null, timedChartShowRadix)
        .then((result) => {
          applyTimedChartOpenResult(result);
        })
        .catch((err) => console.error("[ephemeris-timed-chart]", err))
        .finally(finishSnapshotCommand);
    },
    [applyTimedChartOpenResult, documentId, menuJd, timedChartShowRadix],
  );

  // Mode switch with the wx factory-reset rule (graphephemwnd.set_display_mode):
  // if the visibility set still equals the OLD mode's factory defaults, reset it
  // to the NEW mode's defaults; a customised set is preserved.
  const selectMode = React.useCallback(
    (next: DisplayMode) => {
      if (!meta || next === mode) return;
      const factory = (m: DisplayMode) =>
        Object.fromEntries(meta.planets.map((p) => [p.id, p.defaultVisible[m]])) as Record<number, boolean>;
      const oldFactory = factory(mode);
      const isFactory = meta.planets.every((p) => Boolean(visible[p.id]) === Boolean(oldFactory[p.id]));
      const nextVisible = isFactory ? factory(next) : visible;
      setMode(next);
      onDisplayModeChange?.(next);
      setVisibleOverrides(nextVisible);
      persistViewState({ display_mode: next, visible_planets: nextVisible });
    },
    [meta, mode, onDisplayModeChange, persistViewState, visible],
  );

  React.useLayoutEffect(() => {
    if (!registerDisplayModeToggle) return;
    return registerDisplayModeToggle(() => {
      const next = togglesRef.current.mode === "longitude" ? "declination" : "longitude";
      selectMode(next);
    });
  }, [registerDisplayModeToggle, selectMode]);

  const setPlanetVisibility = React.useCallback(
    (next: Record<number, boolean>) => {
      setVisibleOverrides(next);
      persistViewState({ visible_planets: next });
    },
    [persistViewState],
  );

  const toggleGrid = React.useCallback(
    (checked: boolean) => {
      setShowGrid(checked);
      persistViewState({ show_grid: checked });
    },
    [persistViewState],
  );

  const toggleLunations = React.useCallback(
    (checked: boolean) => {
      setShowLunations(checked);
      persistViewState({ show_lunations: checked });
    },
    [persistViewState],
  );

  const toggleEquator = React.useCallback(
    (checked: boolean) => {
      setShowEquator(checked);
      persistViewState({ show_equator: checked });
    },
    [persistViewState],
  );

  const toggleOutOfBoundsRange = React.useCallback(
    (checked: boolean) => {
      setShowOutOfBoundsRange(checked);
      persistViewState({ show_oob_range: checked });
    },
    [persistViewState],
  );

  const toggleSignBands = React.useCallback(
    (checked: boolean) => {
      setShowSignBands(checked);
      persistViewState({ show_sign_bands: checked });
    },
    [persistViewState],
  );

  // Radix layer: display-only toggles (a frame repaint; crossings load per
  // visible year on first need).
  const toggleRadix = React.useCallback(
    (checked: boolean) => {
      setShowRadix(checked);
      if (!checked) {
        setPinnedPlanetId(null);
        setPinnedRadixKey(null);
        setHoverRadixKey(null);
      }
      persistViewState({ show_radix: checked });
    },
    [persistViewState],
  );

  const toggleHoverLineColors = React.useCallback(
    (checked: boolean) => {
      setHoverLineColors(checked);
      persistViewState({ hover_line_colors: checked });
    },
    [persistViewState],
  );

  const togglePlanetContacts = React.useCallback(
    (checked: boolean) => {
      setShowPlanetContacts(checked);
      persistViewState({ show_planet_contacts: checked });
    },
    [persistViewState],
  );

  // Display-only: the plot repaints with the bands under the curves.
  const toggleRadixBands = React.useCallback(
    (checked: boolean) => {
      setShowRadixBands(checked);
      persistViewState({ show_radix_bands: checked });
    },
    [persistViewState],
  );

  // Display-only: the radix layer repaints with or without the glyphs.
  const toggleRadixReadingGlyphs = React.useCallback(
    (checked: boolean) => {
      setShowRadixReadingGlyphs(checked);
      persistViewState({ show_radix_reading_glyphs: checked });
    },
    [persistViewState],
  );

  // Display-only: the label column repaints in the ink mode's colours.
  const toggleColorRadixLabels = React.useCallback(
    (checked: boolean) => {
      setColorRadixLabels(checked);
      persistViewState({ color_radix_labels: checked });
    },
    [persistViewState],
  );

  const toggleFastContacts = React.useCallback(
    (checked: boolean) => {
      setShowFastContacts(checked);
      persistViewState({ show_fast_contacts: checked });
    },
    [persistViewState],
  );

  const setRadixPointVisibility = React.useCallback(
    (key: string, checked: boolean) => {
      const next = { ...togglesRef.current.radixPointOverrides, [key]: checked };
      setRadixPointOverrides(next);
      persistViewState({ radix_points: next });
    },
    [persistViewState],
  );

  // Tab (home-client toggleTabView) shows or hides the radix in longitude.
  React.useLayoutEffect(
    () =>
      registerGraphicEphemerisRadixToggle(documentId, () => {
        if (togglesRef.current.mode !== "longitude") return;
        toggleRadix(!togglesRef.current.showRadix);
      }),
    [documentId, toggleRadix],
  );

  // Display-only: the plot layer repaints; the camera stays where it is.
  const toggleNowLine = React.useCallback(
    (checked: boolean) => {
      setShowNowLine(checked);
      persistViewState({ show_now_line: checked });
    },
    [persistViewState],
  );

  const toggleMirrored = React.useCallback(
    (checked: boolean) => {
      setMirrored(checked);
      persistViewState({ mirrored: checked });
    },
    [persistViewState],
  );

  // Display-only: the scene memo repaints through requestFrame; no fetch, no
  // camera move.
  const selectModulus = React.useCallback(
    (next: EphemerisModulus) => {
      setModulus(next);
      persistViewState({ modulus: next });
    },
    [persistViewState],
  );

  const selectInkMode = React.useCallback(
    (next: EphemerisInkMode) => {
      setInkMode(next);
      persistViewState({ ink_mode: next });
    },
    [persistViewState],
  );

  const toggleEventGlyphs = React.useCallback(
    (checked: boolean) => {
      setShowEventGlyphs(checked);
      persistViewState({ show_event_glyphs: checked });
    },
    [persistViewState],
  );

  /** Save as image and chart export: the plate on screen, painted fresh at
   * the live device-pixel size through the live frame's own plate paint,
   * geometry, scene, style and radix layer; only the pointer's highlight is
   * dropped. Lands on the camera's destination when a step is easing. */
  const composeImage = React.useCallback((): HTMLCanvasElement | null => {
    const size = sizeRef.current;
    const liveScene = sceneRef.current;
    const style = styleRef.current;
    const camera = targetCamera();
    const measure = measureRef.current?.font === style?.typography.fontUi ? measureRef.current?.measure : undefined;
    if (!size || !liveScene || !style || !camera || !measure || !fontsReadyRef.current) return null;
    const currentScene = ephemerisExportScene(liveScene);
    // The retained geometry when the chrome on screen was painted from these
    // inputs; otherwise the same call the next frame makes.
    const liveGeo = geoRef.current;
    const geo =
      liveGeo && sameEphemerisChromeInputs(chromeInputsRef.current, ephemerisChromeInputs(size, style, currentScene))
        ? liveGeo
        : ephemerisPlateGeometry(size, currentScene, style, measure);
    const out = document.createElement("canvas");
    const layer = document.createElement("canvas");
    fitCanvas(out, size);
    fitCanvas(layer, size);
    const base = surfaceOf(out, size);
    const top = surfaceOf(layer, size);
    if (!base || !top) return null;
    paintEphemerisPlate(base, top, {
      geo,
      camera,
      data: ephemerisStore.frameData(camera.startJd, cameraEndJd(camera)),
      scene: currentScene,
      style,
      measure,
      radix: radixLayerFor(currentScene, camera),
    });
    base.ctx.setTransform(1, 0, 0, 1, 0, 0);
    base.ctx.drawImage(layer, 0, 0);
    return out;
  }, [radixLayerFor, targetCamera]);

  /** The camera's blocks and radix years resident, then the composed plate. */
  const composeSettledImage = React.useCallback(async (): Promise<HTMLCanvasElement | null> => {
    const camera = targetCamera();
    if (camera) {
      await ephemerisStore.whenResident(camera.startJd, cameraEndJd(camera));
      if (sceneRef.current?.showRadix) await radixStore.ready(radixYearsOf(camera));
      if (sceneRef.current?.showPlanetContacts) await ephemerisContactStore.ready(radixYearsOf(camera));
    }
    return composeImage();
  }, [composeImage, radixStore, targetCamera]);

  const hasScene = scene != null;
  React.useEffect(() => {
    if (!hasScene) return;
    return registerChartExportRenderer(documentId, async (request) => {
      const image = await composeSettledImage();
      const wrap = wrapRef.current;
      if (!image || !wrap) throw new Error("visible ephemeris renderer unavailable");
      // The exporter reads the surface background from computed style.
      image.style.display = "none";
      image.style.backgroundColor = styleRef.current?.palette.background ?? "";
      wrap.appendChild(image);
      try {
        // The plate keeps the pane's shape at device pixels: no square page.
        return await renderCanvasChartExport(image, request, "source");
      } finally {
        image.remove();
      }
    });
  }, [composeSettledImage, documentId, hasScene]);

  // Save as PNG (graphephemwnd.onSaveAsBitmap — Ephem<year>.png).
  const savePng = React.useCallback(async () => {
    const camera = targetCamera();
    const canvas = await composeSettledImage();
    if (!canvas || !camera) return;
    const year = calendarOfJd(camera.startJd).year;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Ephem${year}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  }, [composeSettledImage, targetCamera]);

  const allPlanetsVisible = effectivePlanets.length > 0 && effectivePlanets.every((p) => visible[p.id]);
  // The Radix menu names an angle in full (its mark already shows Asc, MC…),
  // midpoints too: Sun/MC reads Sun/Midheaven.
  const radixAngleNames: Record<string, string> = {
    asc: t("astrocart.point.ascendant"),
    mc: t("astrocart.point.midheaven"),
    dsc: t("astrocart.point.descendant"),
    ic: t("astrocart.point.imumCoeli"),
  };
  const radixPointMenuLabel = (point: EphemerisRadixPoint) => {
    const keys = point.kind === "midpoint" ? point.key.split("/") : [point.key];
    const parts = point.kind === "midpoint" ? point.label.split("/") : [point.label];
    if (keys.length !== parts.length) return point.label;
    return keys.map((key, i) => radixAngleNames[key] ?? parts[i]).join("/");
  };
  const radixPointShown = (point: EphemerisRadixPoint) =>
    Object.prototype.hasOwnProperty.call(radixPointOverrides, point.key) ? Boolean(radixPointOverrides[point.key]) : point.defaultVisible;
  const timedDisabled = menuJd == null;
  const loading = !error && (!meta || !hasData);

  return (
    <div
      data-aries-true-color=""
      // The workspace titlebar is opaque over this view-only surface, so the
      // plate starts below it, like every other document surface.
      className="aries-graphic-ephemeris font-morinus-text relative box-border flex h-full w-full min-h-0 flex-1 flex-col bg-background pt-[var(--titlebar-h)]"
      style={meta?.colors?.background ? { backgroundColor: effectivePalette.background } : undefined}
    >
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              ref={wrapRef}
              tabIndex={0}
              onKeyDown={onPlotKeyDown}
              onContextMenuCapture={onContextCapture}
              className="relative flex-1 min-h-0 overflow-hidden outline-none"
            >
              <canvas ref={chromeCanvasRef} aria-hidden className="pointer-events-none absolute inset-0 block h-full w-full" />
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onPointerLeave={onPointerLeave}
                className="absolute inset-0 block h-full w-full touch-none"
              />
              {hover ? (
                <HoverFlag
                  hover={hover}
                  colors={effectivePalette}
                />
              ) : null}
              {error ? (
                <div
                  className="absolute inset-0 flex items-center justify-center text-destructive"
                  style={{ fontSize: "var(--aries-ephem-state-font-size)" }}
                >
                  {t("ephem.failed")}: {error}
                </div>
              ) : loading ? (
                <div
                  className="absolute inset-0 flex items-center justify-center text-muted-foreground"
                  style={{ fontSize: "var(--aries-ephem-state-font-size)" }}
                >
                  {t("ephem.loadingEphemeris")}
                </div>
              ) : null}
            </div>
          }
        />
        <ContextMenuContent className="w-64">
          {/* Timed open actions (graphephemframe.py:57-59,76-82), in one drawer */}
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={timedDisabled}>{t("ephem.openMenu")}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-56">
              <ContextMenuItem disabled={timedDisabled} onClick={() => fireTimed("solar")}>
                {t("ephem.openSolarRevolution")}
              </ContextMenuItem>
              <ContextMenuItem disabled={timedDisabled} onClick={() => fireTimed("transits")}>
                {t("ephem.openAsTransit")}
              </ContextMenuItem>
              <ContextMenuItem disabled={timedDisabled} onClick={() => fireTimed("chart")}>
                {t("ephem.openAsChart")}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuCheckboxItem
            checked={mode === "declination"}
            disabled={!meta}
            onCheckedChange={(checked) => selectMode(checked ? "declination" : "longitude")}
          >
            {t("ephem.declination")}
          </ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          {mode === "longitude" ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>{t("ephem.modulus")}</ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-32">
                <ContextMenuRadioGroup
                  value={String(modulus)}
                  onValueChange={(value) => {
                    const next = EPHEMERIS_MODULI.find((m) => String(m) === String(value));
                    if (next != null) selectModulus(next);
                  }}
                >
                  {EPHEMERIS_MODULI.map((m) => (
                    <ContextMenuRadioItem key={m} value={String(m)}>{`${m}°`}</ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t("ephem.planets")}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-44">
              <ContextMenuCheckboxItem
                checked={allPlanetsVisible}
                disabled={effectivePlanets.length === 0}
                onCheckedChange={(checked) => setPlanetVisibility(
                  Object.fromEntries(effectivePlanets.map((p) => [p.id, checked])),
                )}
              >
                {t("search.all")}
              </ContextMenuCheckboxItem>
              <ContextMenuSeparator />
              {effectivePlanets.map((p) => (
                <ContextMenuCheckboxItem
                  key={p.id}
                  checked={Boolean(visible[p.id])}
                  onCheckedChange={(checked) => setPlanetVisibility({ ...visible, [p.id]: checked })}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="font-symbols" style={{ color: p.color }}>{p.glyph}</span>
                    {p.label}
                  </span>
                </ContextMenuCheckboxItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          {mode === "longitude" && radixPoints.length > 0 ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>{t("ephem.radix")}</ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-56">
                {radixPoints.map((point) => (
                  <ContextMenuCheckboxItem
                    key={point.key}
                    checked={radixPointShown(point)}
                    disabled={!showRadix}
                    onCheckedChange={(checked) => setRadixPointVisibility(point.key, Boolean(checked))}
                  >
                    <span className="inline-flex items-center gap-2">
                      <RadixPointMark parts={radixPointParts(point)} />
                      {radixPointMenuLabel(point)}
                    </span>
                  </ContextMenuCheckboxItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
          <ContextMenuSeparator />
          {/* View settings: one drawer for every display toggle. */}
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t("ephem.view")}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-56">
              <ContextMenuCheckboxItem checked={showNowLine} onCheckedChange={(c) => toggleNowLine(Boolean(c))}>
                {t("ephem.showNowLine")}
              </ContextMenuCheckboxItem>
              <ContextMenuCheckboxItem checked={showGrid} onCheckedChange={(c) => toggleGrid(Boolean(c))}>
                {t("ephem.showGrid")}
              </ContextMenuCheckboxItem>
              <ContextMenuCheckboxItem checked={showEventGlyphs} onCheckedChange={(c) => toggleEventGlyphs(Boolean(c))}>
                {t("ephem.showEventGlyphs")}
              </ContextMenuCheckboxItem>
              <ContextMenuCheckboxItem checked={showLunations} onCheckedChange={(c) => toggleLunations(Boolean(c))}>
                {t("ephem.showLunations")}
              </ContextMenuCheckboxItem>
              <ContextMenuCheckboxItem checked={mirrored} onCheckedChange={(c) => toggleMirrored(Boolean(c))}>
                {t("ephem.labelsOnRight")}
              </ContextMenuCheckboxItem>
              {mode === "longitude" ? (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuCheckboxItem checked={showRadix} onCheckedChange={(c) => toggleRadix(Boolean(c))}>
                    {t("ephem.radixLines")}
                    <ContextMenuShortcut>⇥</ContextMenuShortcut>
                  </ContextMenuCheckboxItem>
                  <ContextMenuCheckboxItem
                    checked={showRadixBands}
                    disabled={!showRadix}
                    onCheckedChange={(c) => toggleRadixBands(Boolean(c))}
                  >
                    {t("ephem.radixOrbBands")}
                  </ContextMenuCheckboxItem>
                  <ContextMenuCheckboxItem
                    checked={showRadixReadingGlyphs}
                    disabled={!showRadix || !showNowLine}
                    onCheckedChange={(c) => toggleRadixReadingGlyphs(Boolean(c))}
                  >
                    {t("ephem.radixReadingGlyphs")}
                  </ContextMenuCheckboxItem>
                  <ContextMenuCheckboxItem
                    checked={colorRadixLabels}
                    disabled={!showRadix}
                    onCheckedChange={(c) => toggleColorRadixLabels(Boolean(c))}
                  >
                    {t("ephem.colorRadixLabels")}
                  </ContextMenuCheckboxItem>
                  <ContextMenuCheckboxItem checked={showPlanetContacts} onCheckedChange={(c) => togglePlanetContacts(Boolean(c))}>
                    {t("ephem.planetContacts")}
                  </ContextMenuCheckboxItem>
                  <ContextMenuCheckboxItem
                    checked={showFastContacts}
                    disabled={!showRadix && !showPlanetContacts}
                    onCheckedChange={(c) => toggleFastContacts(Boolean(c))}
                  >
                    {t("ephem.fastContacts")}
                  </ContextMenuCheckboxItem>
                </>
              ) : null}
              {mode === "declination" ? (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuCheckboxItem checked={showEquator} onCheckedChange={(c) => toggleEquator(Boolean(c))}>
                    {t("ephem.showEquator")}
                  </ContextMenuCheckboxItem>
                  <ContextMenuCheckboxItem checked={showOutOfBoundsRange} onCheckedChange={(c) => toggleOutOfBoundsRange(Boolean(c))}>
                    {t("ephem.showOutOfBoundsRange")}
                  </ContextMenuCheckboxItem>
                  <ContextMenuCheckboxItem checked={showSignBands} onCheckedChange={(c) => toggleSignBands(Boolean(c))}>
                    {t("ephem.showSignBands")}
                  </ContextMenuCheckboxItem>
                </>
              ) : null}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t("ephem.colors")}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-44">
              <ContextMenuRadioGroup
                value={inkMode}
                onValueChange={(value) => {
                  const next = EPHEMERIS_INK_MODES.find((m) => m === value);
                  if (next) selectInkMode(next);
                }}
              >
                {EPHEMERIS_INK_MODES.map((m) => (
                  <ContextMenuRadioItem key={m} value={m}>{t(EPHEMERIS_INK_LABEL_KEYS[m])}</ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
              <ContextMenuSeparator />
              <ContextMenuCheckboxItem checked={hoverLineColors} onCheckedChange={(c) => toggleHoverLineColors(Boolean(c))}>
                {t("ephem.hoverLineColors")}
              </ContextMenuCheckboxItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => void savePng()}>{t("ephem.saveAsImage")}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

/** Hover tooltip — the wx hover flag (graphephemwnd._draw_hover_flag) as a DOM
 * overlay: line 1 = date, line 2 = [planet glyph] [(code)] sign deg°min'. */
function HoverFlag({
  hover,
  colors,
}: {
  hover: NonNullable<HoverState>;
  colors: Pick<EphemerisColors, "background" | "frame" | "texts">;
}) {
  const { info, paint } = hover;
  const valueTxt = info.declination
    ? `${info.declSign ?? ""}${info.degree}°${String(info.minute).padStart(2, "0")}'`
    : `${info.degree}°${String(info.minute).padStart(2, "0")}'`;
  return (
    <div
      className="pointer-events-none absolute z-10 border border-border bg-popover text-popover-foreground"
      style={{
        left: `calc(${hover.x}px + var(--aries-ephem-hover-offset-x))`,
        top: `max(var(--aries-ephem-hover-edge-inset), calc(${hover.y}px - var(--aries-ephem-hover-offset-y)))`,
        padding: "var(--aries-ephem-hover-pad-y) var(--aries-ephem-hover-pad-x)",
        fontSize: "var(--aries-ephem-hover-font-size)",
        borderRadius: "var(--aries-ephem-hover-radius)",
        boxShadow: "var(--aries-ephem-hover-shadow)",
        backgroundColor: colors.background,
        borderColor: colors.frame,
        color: colors.texts,
      }}
    >
      <div>{info.date}</div>
      <div className="flex items-center" style={{ gap: "var(--aries-ephem-hover-gap)" }}>
        {info.planetGlyph ? (
          <span className="font-symbols" style={{ color: paint.planet }}>{info.planetGlyph}</span>
        ) : null}
        {info.contact ? (
          <>
            <span className="font-symbols" style={{ color: paint.aspect }}>{info.contact.aspectGlyph}</span>
            <RadixPointMark parts={info.contact.point} colors={paint.point} />
          </>
        ) : null}
        {info.stationCode ? <span>({info.stationCode})</span> : null}
        {info.eventLabel ? <span>{info.eventLabel}</span> : null}
        {!info.declination && info.sign ? (
          <span className="font-symbols" style={{ color: paint.sign }}>{info.sign}</span>
        ) : null}
        <span>{valueTxt}</span>
      </div>
    </div>
  );
}

/** A radix point's mark: Morinus glyphs, the angles written (Asc, MC);
 * `colors` per part in the hover flag. */
function RadixPointMark({
  parts,
  colors,
}: {
  parts: readonly EphemerisRadixLabelPart[];
  colors?: readonly (string | undefined)[];
}) {
  return (
    <span>
      {parts.map((part, i) => (
        <span
          key={i}
          className={part.font === "morinus" ? "font-symbols" : undefined}
          style={colors?.[i] ? { color: colors[i] } : undefined}
        >
          {part.text}
        </span>
      ))}
    </span>
  );
}
