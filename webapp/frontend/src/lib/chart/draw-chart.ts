/**
 * Literal-ish port of the classic single-wheel path in graphchart.py.
 * Geometry, draw order, integer-ish placement, and overlap shifting follow the
 * desktop renderer closely enough for the web canvas to line up the same way.
 */

import { CanvasDraw, polar, type TextOpts } from "./canvas-draw";
import { DEFAULT_MORINUS_TEXT_FONT } from "./chart-fonts";
import {
  resolveScaledWheelStroke,
  resolveWheelRenderStyle,
  resolveWheelStrokeMetrics,
  resolveWheelTypographyMetrics,
  type WheelRenderStyle,
  type WheelRenderStyleSource,
  type WheelTypographyProfile,
} from "./wheel-render-style";
import {
  FORTUNE_GLYPH,
  HOUSE_GLYPHS_ROMAN,
  aspectGlyph,
  signGlyph,
} from "./glyphs";
import type {
  Chart,
  ChartAspect,
  AspectBodyKey,
  ChartPalette,
  ChartPlanet,
  DignityKind,
  FixedStar,
  ChartRenderSnapshot,
  InterChartAspect,
  InterChartBodyAspectsMap,
  OuterRingItem,
  PlanetId,
  RingLabelSegment,
  SurveilMark,
} from "./types";

type Pt = [number, number];
type Bounds = { x: number; y: number; w: number; h: number };
type BodyKey = PlanetId | "__fortune" | "__vertex" | "__syzygy";
type AngleLayoutKey = "__asc" | "__mc";
type LayoutKey = BodyKey | AngleLayoutKey;
type TextMeasurer = { textsize(text: string, opts?: TextOpts): Pt };
type BodyLayout = {
  bodyShifts: Map<LayoutKey, number>;
  labelYoffs: Map<LayoutKey, number>;
};
export type DrawLayer = "geometry" | "dynamic" | "outer-label";

interface DrawOptionsBase {
  width: number;
  height: number;
  chartSize?: number;
  // Click-to-toggle aspect selection (owned by the workspace store). When the
  // chart's clickAspectFlags.exclusiveOnClick is false this is ignored and
  // aspects render as today. See resolveAspectsForDraw.
  clickAspectState?: ClickAspectState;
}

/**
 * Typed callers pass a complete renderStyle. Legacy website/export callers
 * omit it and must continue to provide palette (with optional font/revision).
 */
export type DrawOptions = DrawOptionsBase & WheelRenderStyleSource;

const PROJECTED_GLYPH_FAMILIES = new Set(["antiscia", "contra_antiscia", "dodecatemoria"]);
const OUTER_BODY_GLYPH_FAMILIES = new Set(["parallel_transits"]);
let bodyShiftCache = new WeakMap<Chart, Map<string, Map<LayoutKey, number>>>();
let bodyLayoutCache = new WeakMap<Chart, Map<string, BodyLayout>>();
let outerItemLayoutCache = new WeakMap<ChartRenderSnapshot, Map<string, ReturnType<typeof prepareOuterRingItems>>>();
let fixedStarLayoutCache = new WeakMap<Chart, Map<string, ReturnType<typeof prepareFixedStars>>>();
let cachedStyleRevision: DrawOptions["styleRevision"];
let hitTextMeasureCanvas: HTMLCanvasElement | null = null;

function applyStyleRevision(styleRevision: DrawOptions["styleRevision"]): void {
  if (styleRevision === undefined || styleRevision === cachedStyleRevision) return;
  cachedStyleRevision = styleRevision;
  bodyShiftCache = new WeakMap();
  bodyLayoutCache = new WeakMap();
  outerItemLayoutCache = new WeakMap();
  fixedStarLayoutCache = new WeakMap();
}

function wheelStyleRevisionKey(style: WheelRenderStyle): string {
  return `${style.schemaVersion}:${style.revision}`;
}

function resolveDrawStyle(opts: DrawOptions): WheelRenderStyle {
  return resolveWheelRenderStyle(opts);
}

function cacheNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "nan";
}

function cachePoint(point: Pt): string {
  return `${cacheNumber(point[0])},${cacheNumber(point[1])}`;
}

function boundedMapSet<K, V>(map: Map<K, V>, key: K, value: V, max = 64): void {
  if (map.size >= max && !map.has(key)) {
    const first = map.keys().next().value as K | undefined;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, value);
}

function fallbackTextsize(text: string, opts?: TextOpts): Pt {
  const size = Math.max(1, Math.round(opts?.size ?? 14));
  if (typeof document !== "undefined") {
    hitTextMeasureCanvas = hitTextMeasureCanvas ?? document.createElement("canvas");
    const ctx = hitTextMeasureCanvas.getContext("2d");
    if (ctx) {
      const family = opts?.font ?? "FreeSans, sans-serif";
      const weight = opts?.weight ?? 400;
      ctx.font = `${weight} ${size}px ${family}`;
      const metrics = ctx.measureText(text);
      const h =
        (metrics.actualBoundingBoxAscent || 0) +
        (metrics.actualBoundingBoxDescent || 0) ||
        size;
      return [Math.round(metrics.width), Math.round(h)];
    }
  }
  return [Math.round(String(text).length * size * 0.58), size];
}

function normalize(lon: number): number {
  return ((lon % 360) + 360) % 360;
}

function sameLongitude(a: number, b: number, epsilon = 1e-4): boolean {
  const delta = Math.abs(normalize(a - b));
  return Math.min(delta, 360 - delta) <= epsilon;
}

function angleSharesHouseCusp(chart: Chart, key: AngleLayoutKey): boolean {
  const cuspIndex = key === "__asc" ? 0 : 9;
  const angle = key === "__asc" ? chart.angles.asc : chart.angles.mc;
  return sameLongitude(chart.houses.cusps[cuspIndex], angle);
}

function angleArrowheadsVisible(chart: Chart): boolean {
  return chart.options.showAngleArrowheads !== false;
}

function cusplessAscMcLabelsVisible(chart: Chart): boolean {
  return chart.options.showCusplessAscMcLabels !== false;
}

// Continuous proportional scaling — port of graphchart.py:_scaled_line_w
// (commit e6f61bb, 2026-05-20). `requested` is the pen width intended at the
// reference chart side (720 px); the actual stroke scales linearly with
// chartSize/720, rounded to the nearest pixel, never below 1.
// Replaces the pre-fork stepwise PHONE/SMALL/MEDIUM buckets which produced
// abrupt thickening just below each threshold.
function scaledLineWidth(style: WheelRenderStyle, chartSize: number, requested: number): number {
  return resolveScaledWheelStroke(style, chartSize, requested);
}

function thickPenWidth(style: WheelRenderStyle, chartSize: number, base: number): number {
  return scaledLineWidth(style, chartSize, base);
}

function chartRingPenWidth(style: WheelRenderStyle, chart: Chart, chartSize: number): number {
  const rawBase = Number.isFinite(chart.options.chartRingThickness)
    ? Number(chart.options.chartRingThickness)
    : 3;
  const base = Math.min(3, Math.max(1, Math.round(rawBase)));

  return thickPenWidth(style, chartSize, base);
}

function mediumPenWidth(style: WheelRenderStyle, chartSize: number): number {
  return resolveWheelStrokeMetrics(style, chartSize).medium;
}

function degreeTickPenWidth(style: WheelRenderStyle, chartSize: number): number {
  // graphchart.py:1694-1699 uses the old bucket for 10-degree wheel ticks:
  // 2 px above MEDIUM_SIZE, otherwise 1 px.
  return resolveWheelStrokeMetrics(style, chartSize).degreeTick;
}

function ascmcPenWidth(style: WheelRenderStyle, chart: Chart, chartSize: number): number {
  const rawBase = Number.isFinite(chart.options.ascmcSize)
    ? Number(chart.options.ascmcSize)
    : style.strokes.ascMcDefaultBase;
  const base = Math.max(1, Math.round(rawBase));

  // graphchart.py:_scaled_line_w applies the proportional scaler directly. Do
  // not cap at the slider value: large web/Tauri panes should thicken like wx.
  return scaledLineWidth(style, chartSize, base);
}

function bodyKeys(chart: Chart): BodyKey[] {
  const keys = chart.planets.map((planet) => planet.id as BodyKey);
  if (chart.fortune) {
    keys.push("__fortune");
  }
  // Vertex is a drawable body when the daemon shipped it (options.showvertex);
  // mirrors graphchart._iter_draw_body_ids appending CHART_OBJECT_VERTEX.
  if (chart.vertex) {
    keys.push("__vertex");
  }
  if (chart.syzygy) {
    keys.push("__syzygy");
  }
  return keys;
}

function layoutKeys(
  chart: Chart,
  includeAngles: boolean,
  includeSharedAngles = true,
): LayoutKey[] {
  const keys: LayoutKey[] = bodyKeys(chart);
  if (includeAngles && isAngloWheel(chart)) {
    if (
      chart.angles.ascDegMin &&
      (includeSharedAngles || !angleSharesHouseCusp(chart, "__asc"))
    ) {
      keys.push("__asc");
    }
    if (
      chart.angles.mcDegMin &&
      (includeSharedAngles || !angleSharesHouseCusp(chart, "__mc"))
    ) {
      keys.push("__mc");
    }
  }
  return keys;
}

function planetById(chart: Chart): Map<PlanetId, ChartPlanet> {
  return new Map(chart.planets.map((planet) => [planet.id, planet]));
}

function bodyLongitude(chart: Chart, planets: Map<PlanetId, ChartPlanet>, key: BodyKey): number | null {
  if (key === "__fortune") {
    return chart.fortune?.longitude ?? null;
  }
  if (key === "__vertex") {
    return chart.vertex?.longitude ?? null;
  }
  if (key === "__syzygy") {
    return chart.syzygy?.longitude ?? null;
  }
  return planets.get(key)?.longitude ?? null;
}

function layoutLongitude(
  chart: Chart,
  planets: Map<PlanetId, ChartPlanet>,
  key: LayoutKey,
): number | null {
  if (key === "__asc") return chart.angles.asc;
  if (key === "__mc") return chart.angles.mc;
  return bodyLongitude(chart, planets, key);
}

function layoutGlyph(
  chart: Chart,
  planets: Map<PlanetId, ChartPlanet>,
  key: LayoutKey,
): string {
  if (key === "__asc") return "AC";
  if (key === "__mc") return "MC";
  return bodyGlyph(chart, planets, key);
}

function layoutGlyphFont(
  chart: Chart,
  key: LayoutKey,
  fontSymbols: string,
  fontUi: string,
): string {
  if (key === "__asc" || key === "__mc") return fontUi;
  return bodyGlyphFont(chart, key, fontSymbols, fontUi);
}

function layoutGlyphSize(
  key: LayoutKey,
  symbolSize: number,
  style: WheelRenderStyle,
): number {
  if (key === "__asc" || key === "__mc") {
    return symbolSize * style.typography.ratios.angleLabelScale;
  }
  return bodyGlyphSize(key, symbolSize, style);
}

function bodyDegMin(
  chart: Chart,
  planets: Map<PlanetId, ChartPlanet>,
  key: BodyKey,
): [string, string] | null {
  // Resolved deg/min-in-sign strings ship from the daemon
  // (export_chart_json.deg_min_payload); the skin only prints them.
  if (key === "__fortune") {
    const f = chart.fortune;
    return f?.degText != null && f?.minText != null ? [f.degText, f.minText] : null;
  }
  if (key === "__vertex") {
    const v = chart.vertex;
    return v?.degText != null && v?.minText != null ? [v.degText, v.minText] : null;
  }
  if (key === "__syzygy") {
    const s = chart.syzygy;
    return s?.degText != null && s?.minText != null ? [s.degText, s.minText] : null;
  }
  const planet = planets.get(key);
  return planet?.degText != null && planet?.minText != null
    ? [planet.degText, planet.minText]
    : null;
}

function bodyGlyph(chart: Chart, planets: Map<PlanetId, ChartPlanet>, key: BodyKey): string {
  // Resolved glyph char ships from the daemon (ChartPlanet.glyph /
  // ChartFortune.glyph / ChartVertex.glyph). FORTUNE_GLYPH is the raw codepoint
  // fallback only; the Vertex glyph ('!') always ships resolved.
  if (key === "__fortune") {
    return chart.fortune?.glyph ?? FORTUNE_GLYPH;
  }
  if (key === "__vertex") {
    return chart.vertex?.glyph ?? "";
  }
  if (key === "__syzygy") {
    return chart.syzygy?.glyph ?? "Sy";
  }
  const planet = planets.get(key);
  return planet?.glyph ?? "";
}

function bodyGlyphFont(chart: Chart, key: BodyKey, fontSymbols: string, fontUi: string): string {
  if (key === "__syzygy" && chart.syzygy?.glyphFont === "text") {
    return fontUi;
  }
  return fontSymbols;
}

function bodyGlyphSize(key: BodyKey, symbolSize: number, style: WheelRenderStyle): number {
  return key === "__syzygy" ? symbolSize * style.typography.ratios.syzygyScale : symbolSize;
}

function bodyColor(
  chart: Chart,
  planets: Map<PlanetId, ChartPlanet>,
  key: BodyKey,
  palette: ChartPalette,
): string {
  // Daemon ships a resolved per-body color (inspector_service._body_colour).
  if (key === "__fortune") {
    return chart.fortune?.color ?? palette.fortune;
  }
  if (key === "__vertex") {
    // Desktop vertex colour is clrperegrin (graphchart.py:2927-2928).
    return chart.vertex?.color ?? palette.peregrin;
  }
  if (key === "__syzygy") {
    return chart.syzygy?.color ?? palette.fortune;
  }
  const planet = planets.get(key);
  return planet?.color ?? palette.positions;
}

function overlap(
  x1: number,
  y1: number,
  w1: number,
  h1: number,
  x2: number,
  y2: number,
  w2: number,
  h2: number,
): boolean {
  const xOverlap = (x1 <= x2 && x2 <= x1 + w1) || (x2 <= x1 && x1 <= x2 + w2);
  const yOverlap = (y1 <= y2 && y2 <= y1 + h1) || (y2 <= y1 && y1 <= y2 + h2);
  return xOverlap && yOverlap;
}

function drawRotatedLines(
  draw: CanvasDraw,
  center: Pt,
  shift: number,
  stepDeg: number,
  r1: number,
  r2: number,
  color: string,
  width = 1,
) {
  for (let deg = 0; deg < 360; deg += stepDeg) {
    const a = Math.PI + ((shift - deg) * Math.PI) / 180;
    const p1: Pt = [center[0] + Math.cos(a) * r1, center[1] + Math.sin(a) * r1];
    const p2: Pt = [center[0] + Math.cos(a) * r2, center[1] + Math.sin(a) * r2];
    draw.line([p1, p2], { fill: color, width });
  }
}

function roundedDegMinInSign(lon: number): [number, number] {
  const signDeg = normalize(lon) % 30;
  let deg = Math.floor(signDeg);
  let min = Math.round((signDeg - deg) * 60);
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  if (deg >= 30) {
    deg -= 30;
  }
  return [deg, min];
}

function buildFixedStarLabel(star: FixedStar): string {
  const [deg, min] = roundedDegMinInSign(star.longitude);
  return `${star.name} ${deg}\u00B0${String(min).padStart(2, "0")}'`;
}

function ensureTextOutsideOuterWheel(
  center: Pt,
  outerLineRadius: number,
  rad: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rText: number,
  padPx = 2,
): [number, number, number] {
  const corners: Pt[] = [
    [x, y - h / 2],
    [x + w, y - h / 2],
    [x, y + h / 2],
    [x + w, y + h / 2],
  ];
  const minDistance = Math.min(
    ...corners.map(([px, py]) => Math.hypot(px - center[0], py - center[1])),
  );
  const target = outerLineRadius + padPx;
  if (minDistance >= target) {
    return [x, y, rText];
  }
  const delta = target - minDistance;
  const nextRadius = rText + delta;
  let nextX = center[0] + Math.cos(rad) * nextRadius;
  const nextY = center[1] + Math.sin(rad) * nextRadius;
  const pos = normalize((rad * 180) / Math.PI);
  if (pos > 90 && pos < 270) {
    nextX -= w;
  }
  return [nextX, nextY, nextRadius];
}

/** Ratios from graphchart.py classic single-wheel path. */
function rings(maxRadius: number) {
  const deg01510len = 0.01;
  const signsectorlen = 0.15;
  const planetsectorlen = 0.15;
  const termssectorlen = 0.08;
  const decanssectorlen = 0.08;
  const signoffs = (signsectorlen / 2) * maxRadius;
  const planetoffs = (planetsectorlen / 2) * maxRadius;
  const planetlinelen = 0.03;
  const retrdiff = 0.01;
  const arrowlen = 0.04;
  const rHousesectorlen = 0.06;

  const r30 = maxRadius * 0.83;
  const rOuterLine = maxRadius * 0.86;
  const rAntis = maxRadius * 0.90;
  const rAntisLines = maxRadius * 0.86;
  const rOuter0 = r30;
  const rOuter1 = rOuter0 - deg01510len * maxRadius;
  const rOuter5 = rOuter1 - deg01510len * maxRadius;
  const rOuter10 = rOuter5 - deg01510len * maxRadius;
  const rSign = r30 - signoffs;
  const r0 = r30 - signsectorlen * maxRadius;
  const r1 = r0 + deg01510len * maxRadius;
  const r5 = r1 + deg01510len * maxRadius;
  const r10 = r5 + deg01510len * maxRadius;
  const rASCMC = rSign;
  const rArrow = rASCMC + arrowlen * maxRadius;
  const rTerms = r0;
  const rTermsPlanet = r0 - (termssectorlen / 2) * maxRadius;
  const rDecans = rTerms - termssectorlen * maxRadius;
  const rDecansPlanet = rDecans - (decanssectorlen / 2) * maxRadius;
  const rInner = rDecans - decanssectorlen * maxRadius;
  const rLLine = rInner - planetlinelen * maxRadius;
  const rPlanet = rInner - planetoffs;
  const rAsp = rInner - planetsectorlen * maxRadius;
  const rLLine2 = rAsp + planetlinelen * maxRadius;
  const rRetr = rLLine2 + retrdiff * maxRadius;
  const rPos = maxRadius * 0.48;
  const rAspAscMC = maxRadius * 0.43;
  const rPosAscMC = maxRadius * 0.41;
  const rPosHouses = maxRadius * 0.32;
  const rBase = maxRadius * 0.11;
  const rHouse = rBase + rHousesectorlen * maxRadius;
  const rHouseName = maxRadius * 0.14;

  return {
    r30,
    rOuter0,
    rOuter1,
    rOuter5,
    rOuter10,
    rOuterLine,
    rAntis,
    rAntisLines,
    rSign,
    r0,
    r1,
    r5,
    r10,
    rASCMC,
    rArrow,
    rTerms,
    rTermsPlanet,
    rDecans,
    rDecansPlanet,
    rInner,
    rLLine,
    rLLine2,
    rRetr,
    rPlanet,
    rAsp,
    rPos,
    rAspAscMC,
    rPosAscMC,
    rPosHouses,
    rBase,
    rHouse,
    rHouseName,
  };
}

type RingSet = ReturnType<typeof rings> &
  Partial<ReturnType<typeof comparisonRings>> & {
    rPosDeg?: number;
    rPosMin?: number;
    rPosAscMCMin?: number;
    rPosHousesMin?: number;
    rCuspOuter?: number;
    rCuspLabelOuter?: number;
    rCuspLabel?: number;
    rOuterMax?: number;
    rOuterHouse?: number;
    rOuterHouseName?: number;
    rOuterPlanet?: number;
    rOuterASCMC?: number;
    rOuterArrow?: number;
    rOuterRetr?: number;
    rOuterMin?: number;
  };

function isCompactWheel(chart: Chart): boolean {
  return chart.options.theme === 1;
}

function isAngloWheel(chart: Chart): boolean {
  return chart.options.theme === 2;
}

function wheelTypographyProfile(chart: Chart): WheelTypographyProfile {
  return isAngloWheel(chart) ? "anglo" : isCompactWheel(chart) ? "compact" : "classic";
}

function comparisonUsesOuterHouses(snapshot: ChartRenderSnapshot, chart: Chart): boolean {
  if (!snapshot.comparisonChart || !chart.options.showHouses) return false;
  if (!isAngloWheel(chart)) return true;
  return snapshot.comparisonLayout === "with-houses";
}

/**
 * House-centred Anglo/American wheel geometry.
 *
 * The defining constraint is the small aspect circle plus a broad readable
 * house field, with the zodiac pushed to the outside. Terms and decans consume
 * narrow bands instead of the classic renderer's large 0.08R bands. These are
 * presentation ratios only: the daemon remains the source of houses, zodiac,
 * bodies, dignities, positions, aspects and colours.
 */
function angloRings(
  chart: Chart,
  maxRadius: number,
  hasOuterRing: boolean,
  r30Ratio?: number,
) {
  const base = rings(maxRadius);
  // Ratios measured from matched Astro.com 2.ANZ exports of the same radix,
  // both with and without Chaldean decans / Egyptian terms. Each subdivision
  // band is 0.047 of the visible wheel radius. Astro shares that cost evenly:
  // half narrows the central wheel and half narrows the zodiac-sign band.
  // Keep the primary Anglo wheel at one stable diameter. Adding/removing a
  // secondary ring must add an outer lane, not resize the radix geometry.
  const r30 = maxRadius * (r30Ratio ?? 0.895);
  const subdivisionSector = r30 * 0.047;
  const termSector = chart.options.showTerms ? subdivisionSector : 0;
  const decanSector = chart.options.showDecans ? subdivisionSector : 0;
  const subdivisionInset = (termSector + decanSector) / 2;
  const r0 = r30 * 0.881 + subdivisionInset;
  const rTerms = r0;
  const rDecans = rTerms - termSector;
  const rCuspOuter = rDecans - decanSector;
  // The degree ticks hang inward from rCuspOuter. rCuspLabelOuter is a layout
  // radius, not another visible circle; drawing that circle produced the false
  // double ruler seen in the first implementation.
  const subdivisionCount = Number(Boolean(chart.options.showTerms)) + Number(Boolean(chart.options.showDecans));
  const rulerSector = r30 * (0.058 - 0.014 * subdivisionCount);
  const rCuspLabelOuter = rCuspOuter - rulerSector;
  // Give the inward ruler hairs a small optical gutter before the tangent
  // degree/sign/minute run. At the matched 335 px wheel this is ~3 px.
  const rCuspLabel = r30 * 0.817 - subdivisionInset;
  const rInner = r30 * 0.763 - subdivisionInset;
  const rPlanet = r30 * 0.695 - subdivisionInset;
  const rAsp = r30 * 0.352 - subdivisionInset;
  const rBase = rAsp;
  const rHouse = r30 * 0.44 - subdivisionInset;

  return {
    ...base,
    r30,
    rOuter0: hasOuterRing ? maxRadius * 0.964 : r30,
    rOuter1: hasOuterRing ? maxRadius * 0.956 : r30 - 0.008 * maxRadius,
    rOuter5: hasOuterRing ? maxRadius * 0.948 : r30 - 0.016 * maxRadius,
    rOuter10: hasOuterRing ? maxRadius * 0.94 : r30 - 0.024 * maxRadius,
    rOuterLine: hasOuterRing ? maxRadius * 0.93 : r30 + 0.03 * maxRadius,
    rAntis: maxRadius * 0.985,
    rAntisLines: hasOuterRing ? maxRadius * 0.93 : r30 + 0.03 * maxRadius,
    rSign: (r30 + r0) / 2,
    r0,
    r1: r0 + 0.008 * maxRadius,
    r5: r0 + 0.016 * maxRadius,
    r10: r0 + 0.024 * maxRadius,
    rASCMC: r30,
    rArrow: Math.min(maxRadius * 0.995, r30 + 0.035 * maxRadius),
    rTerms,
    rTermsPlanet: rTerms - termSector / 2,
    rDecans,
    rDecansPlanet: rDecans - decanSector / 2,
    rCuspOuter,
    rCuspLabelOuter,
    rCuspLabel,
    rInner,
    rLLine: rInner - 0.026 * r30,
    rPlanet,
    rAsp,
    rLLine2: rAsp - 0.03 * r30,
    rRetr: rPlanet - 0.036 * r30,
    rPos: rPlanet - 0.083 * r30,
    rAspAscMC: rAsp,
    rPosAscMC: r30 * 0.521,
    rPosHouses: rCuspLabel,
    rBase,
    rHouse,
    rHouseName: (rAsp + rHouse) / 2,
  };
}

function angloComparisonRings(
  chart: Chart,
  maxRadius: number,
  withOuterHouses: boolean,
) {
  if (!withOuterHouses) {
    return {
      ...angloRings(chart, maxRadius, true),
      rOuterPlanet: maxRadius * 0.95,
      rOuterASCMC: maxRadius * 0.965,
      rOuterArrow: maxRadius * 0.985,
      rOuterRetr: maxRadius * 0.93,
      rOuterMin: maxRadius * 0.94,
    };
  }

  // Astro's "with houses" comparison is a separate biwheel: the radix wheel,
  // return bodies, return degree ruler, and return-house annulus each own a
  // non-overlapping lane. The former 0.895-0.99 squeeze made all four collide.
  const core = angloRings(chart, maxRadius, true, 0.8);
  const rOuterMax = maxRadius * 0.99;
  const rOuterHouse = maxRadius * 0.94;
  return {
    ...core,
    rOuter0: maxRadius * 0.925,
    rOuter1: maxRadius * 0.917,
    rOuter5: maxRadius * 0.909,
    rOuter10: maxRadius * 0.901,
    rOuterMax,
    rOuterHouse,
    rOuterHouseName: maxRadius * 0.965,
    rOuterPlanet: maxRadius * 0.86,
    rOuterASCMC: rOuterMax,
    rOuterArrow: rOuterMax,
    rOuterLine: maxRadius * 0.825,
    rAntis: maxRadius * 0.885,
    rAntisLines: maxRadius * 0.825,
    rOuterRetr: maxRadius * 0.835,
    rOuterMin: rOuterHouse,
  };
}

function compactBaseOffset(chart: Chart, maxRadius: number, hasOuterRing: boolean) {
  let density = 0;
  if (chart.options.showDecans) density += 1;
  if (chart.options.showTerms) density += 1;
  if (hasOuterRing) density += 1;
  if (chart.options.showPositions) {
    if (density === 1) return maxRadius * 0.02;
    if (density === 2) return maxRadius * 0.08;
    if (density === 3) return maxRadius * 0.12;
  } else if (density === 3) {
    return maxRadius * 0.05;
  }
  return 0;
}

function effectiveRings(chart: Chart, maxRadius: number, hasOuterRing = false) {
  if (isAngloWheel(chart)) {
    return angloRings(chart, maxRadius, hasOuterRing);
  }
  const base = rings(maxRadius);
  const showTerms = Boolean(chart.options.showTerms);
  const showDecans = Boolean(chart.options.showDecans);
  const termSector = showTerms ? 0.08 : 0;
  const decanSector = showDecans ? 0.08 : 0;
  const rTermsPlanet = base.r0 - (termSector / 2) * maxRadius;
  const rDecans = base.rTerms - termSector * maxRadius;
  const rInner = rDecans - decanSector * maxRadius;
  const rDecansPlanet = rInner + (decanSector / 2) * maxRadius;
  const rPlanet = rInner - (0.15 / 2) * maxRadius;

  if (isCompactWheel(chart)) {
    let posAscMc = 0.36;
    let posHouses = 0.36;
    if (showTerms && showDecans) {
      posAscMc = 0.24;
      posHouses = 0.24;
    } else if (showTerms || showDecans) {
      posAscMc = 0.30;
      posHouses = 0.30;
    }
    const rPosDeg = rInner - 0.15 * maxRadius;
    const rPosMin = rPosDeg - (hasOuterRing ? 0.04 : 0.05) * maxRadius;
    const rBase = maxRadius * 0.24 - compactBaseOffset(chart, maxRadius, hasOuterRing);
    return {
      ...base,
      rTermsPlanet,
      rDecans,
      rDecansPlanet,
      rInner,
      rLLine: rInner - 0.03 * maxRadius,
      rPlanet,
      rAsp: rInner - 0.15 * maxRadius,
      rLLine2: rInner - 0.15 * maxRadius + 0.03 * maxRadius,
      rRetr: rPosMin - 0.05 * maxRadius,
      rPos: rPosDeg,
      rPosDeg,
      rPosMin,
      rAspAscMC: maxRadius * posAscMc,
      rPosAscMC: maxRadius * posAscMc,
      rPosAscMCMin: maxRadius * posAscMc - maxRadius * 0.05,
      rPosHouses: maxRadius * posHouses,
      rPosHousesMin: maxRadius * posHouses - maxRadius * 0.05,
      rBase,
      rHouse: rBase + 0.06 * maxRadius,
      rHouseName: maxRadius * 0.27 - compactBaseOffset(chart, maxRadius, hasOuterRing),
    };
  }

  let rPos = maxRadius * 0.48;
  let rAspAscMC = maxRadius * 0.43;
  let rPosAscMC = maxRadius * 0.41;
  let rPosHouses = maxRadius * 0.32;
  if (showTerms && showDecans) {
    rPos = maxRadius * 0.32;
    rAspAscMC = maxRadius * 0.28;
    rPosAscMC = maxRadius * 0.27;
    rPosHouses = maxRadius * 0.21;
  } else if (showTerms || showDecans) {
    rPos = maxRadius * 0.40;
    rAspAscMC = maxRadius * 0.36;
    rPosAscMC = maxRadius * 0.34;
    rPosHouses = maxRadius * 0.25;
  }

  return {
    ...base,
    rTermsPlanet,
    rDecans,
    rDecansPlanet,
    rInner,
    rLLine: rInner - 0.03 * maxRadius,
    rPlanet,
    rAsp: rInner - 0.15 * maxRadius,
    rLLine2: rInner - 0.15 * maxRadius + 0.03 * maxRadius,
    rRetr: rInner - 0.15 * maxRadius + 0.04 * maxRadius,
    rPos,
    rAspAscMC,
    rPosAscMC,
    rPosHouses,
  };
}

function comparisonRings(chart: Chart, maxRadius: number, withOuterHouses = false) {
  if (isAngloWheel(chart)) {
    return angloComparisonRings(chart, maxRadius, withOuterHouses);
  }
  const showTerms = Boolean(chart.options.showTerms);
  const showDecans = Boolean(chart.options.showDecans);
  const termSector = showTerms ? 0.08 : 0;
  const decanSector = showDecans ? 0.08 : 0;
  const outerHouseSector = chart.options.showHouses ? 0.06 * maxRadius : 0;
  const rOuterMax = maxRadius * 0.97;
  const r30 = chart.options.showHouses
    ? rOuterMax - outerHouseSector - 0.12 * maxRadius
    : rOuterMax - 0.12 * maxRadius;
  const rOuterHouseName = rOuterMax - outerHouseSector / 2;
  const rOuterHouse = rOuterMax - outerHouseSector;
  const rOuterPlanet = r30 + (0.15 / 2) * maxRadius;
  const rOuterASCMC = maxRadius * 0.92;
  const rOuterArrow = rOuterASCMC + 0.04 * maxRadius;
  const rOuterLine = r30 + 0.03 * maxRadius;
  const rAntis = maxRadius * 0.90;
  const rAntisLines = rOuterLine;
  const rOuterRetr = rOuterLine + 0.01 * maxRadius;
  const rOuter0 = r30;
  const rOuter1 = rOuter0 - 0.01 * maxRadius;
  const rOuter5 = rOuter1 - 0.01 * maxRadius;
  const rOuter10 = rOuter5 - 0.01 * maxRadius;
  const rOuterMin = maxRadius * 0.78;
  const rSign = r30 - (0.15 / 2) * maxRadius;
  const r0 = r30 - 0.15 * maxRadius;
  const r1 = r0 + 0.01 * maxRadius;
  const r5 = r1 + 0.01 * maxRadius;
  const r10 = r5 + 0.01 * maxRadius;
  const rTerms = r0;
  const rTermsPlanet = r0 - (termSector / 2) * maxRadius;
  const rDecans = rTerms - termSector * maxRadius;
  const rInner = rDecans - decanSector * maxRadius;
  const rDecansPlanet = rInner + (decanSector / 2) * maxRadius;
  const rLLine = rInner - 0.03 * maxRadius;
  const rPlanet = rInner - (0.15 / 2) * maxRadius;
  const rAsp = rInner - 0.15 * maxRadius;
  const rLLine2 = rAsp + 0.03 * maxRadius;
  const rRetr = rLLine2 + 0.01 * maxRadius;

  if (isCompactWheel(chart)) {
    let posAscMc = 0.34;
    let posHouses = 0.34;
    if (showTerms && showDecans) {
      posAscMc = 0.20;
      posHouses = 0.20;
    } else if (showTerms || showDecans) {
      posAscMc = 0.26;
      posHouses = 0.26;
    }
    const rPosDeg = rInner - 0.15 * maxRadius;
    const rPosMin = rPosDeg - 0.05 * maxRadius;
    const rBase = maxRadius * 0.24 - compactBaseOffset(chart, maxRadius, true);
    return {
      r30,
      rOuterMax,
      rOuterHouseName,
      rOuterHouse,
      rOuterPlanet,
      rOuterASCMC,
      rOuterArrow,
      rOuterLine,
      rAntis,
      rAntisLines,
      rOuterRetr,
      rOuter0,
      rOuter1,
      rOuter5,
      rOuter10,
      rOuterMin,
      rSign,
      r0,
      r1,
      r5,
      r10,
      rASCMC: rSign,
      rArrow: rSign + 0.04 * maxRadius,
      rTerms,
      rTermsPlanet,
      rDecans,
      rDecansPlanet,
      rInner,
      rLLine,
      rLLine2,
      rRetr: rPosMin - 0.05 * maxRadius,
      rPlanet,
      rAsp,
      rPos: rPosDeg,
      rPosDeg,
      rPosMin,
      rAspAscMC: maxRadius * posAscMc,
      rPosAscMC: maxRadius * posAscMc,
      rPosAscMCMin: maxRadius * posAscMc - maxRadius * 0.05,
      rPosHouses: maxRadius * posHouses,
      rPosHousesMin: maxRadius * posHouses - maxRadius * 0.05,
      rBase,
      rHouse: rBase + 0.06 * maxRadius,
      rHouseName: maxRadius * 0.27 - compactBaseOffset(chart, maxRadius, true),
    };
  }

  // Biwheel inner-ring radii — must use the desktop BIWHEEL constants
  // (graphchart.py:367-380), not the single-wheel ones, or the inner
  // position/aspect ring sits too far out.
  let rPos = maxRadius * 0.45;
  let rAspAscMC = maxRadius * 0.41;
  let rPosAscMC = maxRadius * 0.41;
  let rPosHouses = maxRadius * 0.32;
  if (showTerms && showDecans) {
    rPos = maxRadius * 0.3;
    rAspAscMC = maxRadius * 0.25;
    rPosAscMC = maxRadius * 0.25;
    rPosHouses = maxRadius * 0.2;
  } else if (showTerms || showDecans) {
    rPos = maxRadius * 0.37;
    rAspAscMC = maxRadius * 0.32;
    rPosAscMC = maxRadius * 0.32;
    rPosHouses = maxRadius * 0.24;
  }

  return {
    r30,
    rOuterMax,
    rOuterHouseName,
    rOuterHouse,
    rOuterPlanet,
    rOuterASCMC,
    rOuterArrow,
    rOuterLine,
    rAntis,
    rAntisLines,
    rOuterRetr,
    rOuter0,
    rOuter1,
    rOuter5,
    rOuter10,
    rOuterMin,
    rSign,
    r0,
    r1,
    r5,
    r10,
    rASCMC: rSign,
    rArrow: rSign + 0.04 * maxRadius,
    rTerms,
    rTermsPlanet,
    rDecans,
    rDecansPlanet,
    rInner,
    rLLine,
    rLLine2,
    rRetr,
    rPlanet,
    rAsp,
    rPos,
    rAspAscMC,
    rPosAscMC,
    rPosHouses,
    rBase: maxRadius * 0.11,
    rHouse: maxRadius * 0.17,
    rHouseName: maxRadius * 0.14,
  };
}

function drawCircles(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  chartSize: number,
  palette: ChartPalette,
  asc: number,
  chart: Chart,
  hasOuterRing: boolean,
  showOuterHouseBand: boolean,
  style: WheelRenderStyle,
) {
  // The Anglo sheet is deliberately hairline-led. Reusing Morinus' heavy
  // configurable ring pen makes the small central figure and subdivision
  // bands look like another classic wheel.
  const thick = isAngloWheel(chart) ? 1 : chartRingPenWidth(style, chart, chartSize);
  const drawOuterDegreeRuler =
    hasOuterRing && (!isAngloWheel(chart) || showOuterHouseBand);

  // graphchart.py:1575-1583 draws the compound/biwheel outer house band
  // boundaries before the zodiac degree rings whenever houses are visible.
  if (showOuterHouseBand && ringset.rOuterMax && ringset.rOuterHouse) {
    draw.circle(center, ringset.rOuterMax, { outline: palette.frame, width: 1 });
    draw.circle(center, ringset.rOuterHouse, { outline: palette.frame, width: 1 });
  }

  draw.circle(center, ringset.r30, { outline: palette.frame, width: thick });
  if (drawOuterDegreeRuler) {
    draw.circle(center, ringset.rOuter10, { outline: palette.frame, width: 1 });
  }

  if (!isAngloWheel(chart)) {
    draw.circle(center, ringset.r10, { outline: palette.frame, width: 1 });
  }
  if (chart.options.showTerms || chart.options.showDecans) {
    draw.circle(center, ringset.r0, { outline: palette.frame, width: 1 });
    if (chart.options.showTerms) {
      draw.circle(center, ringset.rDecans, { outline: palette.frame, width: 1 });
    }
  }
  const deferAngloInnerBoundaries = isAngloWheel(chart) && chart.options.showHouses;
  if (!deferAngloInnerBoundaries) {
    if (isAngloWheel(chart) && ringset.rCuspOuter != null) {
      draw.circle(center, ringset.rCuspOuter, { outline: palette.frame, width: 1 });
    }
    draw.circle(center, ringset.rInner, { outline: palette.frame, width: thick });
    if (!isCompactWheel(chart) && !isAngloWheel(chart)) {
      draw.circle(center, ringset.rAsp, { outline: palette.frame, width: 1 });
    }
    if (chart.options.showHouses) {
      draw.circle(center, ringset.rHouse, {
        outline: isAngloWheel(chart) ? palette.frame : palette.houses,
        width: 1,
      });
    }
    draw.circle(center, ringset.rBase, {
      outline: isAngloWheel(chart) ? palette.frame : palette.angles,
      width: isAngloWheel(chart) ? 1 : ascmcPenWidth(style, chart, chartSize),
    });
  }

  if (isAngloWheel(chart)) {
    for (let deg = 0; deg < 360; deg += 30) {
      draw.line(
        [
          polar(center, ringset.rCuspOuter ?? ringset.rInner, deg, asc),
          polar(center, ringset.r30, deg, asc),
        ],
        { fill: palette.frame, width: thick },
      );
    }
  } else {
    drawRotatedLines(
      draw,
      center,
      asc,
      30,
      ringset.rInner,
      ringset.r30,
      palette.frame,
      thick,
    );
  }
  if (!isAngloWheel(chart)) {
    drawRotatedLines(draw, center, asc, 10, ringset.r0, ringset.r10, palette.frame, degreeTickPenWidth(style, chartSize));
    drawRotatedLines(draw, center, asc, 5, ringset.r0, ringset.r5, palette.frame, 1);
    drawRotatedLines(draw, center, asc, 1, ringset.r0, ringset.r1, palette.frame, 1);
  }

  if (drawOuterDegreeRuler) {
    if (isAngloWheel(chart)) {
      for (let deg = 0; deg < 360; deg += 1) {
        const innerRadius =
          deg % 10 === 0
            ? ringset.rOuter10
            : deg % 5 === 0
              ? ringset.rOuter5
              : ringset.rOuter1;
        draw.line(
          [polar(center, ringset.rOuter0, deg, asc), polar(center, innerRadius, deg, asc)],
          { fill: palette.frame, width: 1 },
        );
      }
    } else {
      drawRotatedLines(
        draw,
        center,
        asc,
        10,
        ringset.rOuter0,
        ringset.rOuter10,
        palette.frame,
        degreeTickPenWidth(style, chartSize),
      );
      drawRotatedLines(draw, center, asc, 5, ringset.rOuter0, ringset.rOuter5, palette.frame, 1);
      drawRotatedLines(draw, center, asc, 1, ringset.rOuter0, ringset.rOuter1, palette.frame, 1);
    }
  }
}

function drawHouses(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
) {
  const angleLongitudes = [chart.angles.asc, chart.angles.dsc, chart.angles.mc, chart.angles.ic];
  for (let i = 0; i < 12; i++) {
    const cusp = chart.houses.cusps[i];
    if (isAngloWheel(chart) && angleLongitudes.some((angle) => sameLongitude(cusp, angle))) {
      continue;
    }
    const p1 = polar(center, ringset.rBase, cusp, asc);
    const p2 = polar(center, ringset.rInner, cusp, asc);
    draw.line([p1, p2], { fill: palette.houses, width: 1 });
  }
}

function drawAngloHouseCuspTicks(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
) {
  if (!isAngloWheel(chart)) return;
  const rulerTick = ringset.r30 * 0.015;
  const rulerDirection = chart.options.showTerms || chart.options.showDecans ? -1 : 1;
  const angleLongitudes = [chart.angles.asc, chart.angles.dsc, chart.angles.mc, chart.angles.ic];
  for (const cusp of chart.houses.cusps) {
    // A shared angular cusp is already expressed by its heavier structural
    // ray; adding the ordinary inward cusp marker makes a false double tick.
    if (angleLongitudes.some((angle) => sameLongitude(cusp, angle))) continue;
    const color = palette.angles;
    if (ringset.rCuspOuter != null) {
      draw.line(
        [
          polar(center, ringset.rCuspOuter, cusp, asc),
          polar(center, ringset.rCuspOuter + rulerDirection * rulerTick, cusp, asc),
        ],
        { fill: color, width: 2 },
      );
    }
  }
}

function redrawMainCircles(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  chartSize: number,
  palette: ChartPalette,
  chart: Chart,
  style: WheelRenderStyle,
) {
  draw.circle(center, ringset.rInner, {
    outline: palette.frame,
    width: isAngloWheel(chart) ? 1 : chartRingPenWidth(style, chart, chartSize),
  });
  draw.circle(center, ringset.rBase, {
    outline: isAngloWheel(chart) ? palette.frame : palette.angles,
    width: isAngloWheel(chart) ? 1 : ascmcPenWidth(style, chart, chartSize),
  });
  if (isAngloWheel(chart) && chart.options.showHouses) {
    // Redraw the house-number boundary after cusp spokes so the intermediate
    // ring stays continuous and legible on dark themes.
    draw.circle(center, ringset.rHouse, { outline: palette.frame, width: 1 });
  }
  if (isAngloWheel(chart) && ringset.rCuspOuter != null) {
    draw.circle(center, ringset.rCuspOuter, { outline: palette.frame, width: 1 });
  }
}

function drawTermsLines(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
) {
  if (!chart.options.showTerms || !chart.options.terms?.length) {
    return;
  }
  for (let signIndex = 0; signIndex < chart.options.terms.length; signIndex += 1) {
    for (const segment of chart.options.terms[signIndex]) {
      // Boundary longitude resolved daemon-side (ChartTermSegment.boundaryLon).
      const deg = segment.boundaryLon ?? signIndex * 30 + segment.size;
      const p1 = polar(center, ringset.rTerms, deg, asc);
      const p2 = polar(center, ringset.rDecans, deg, asc);
      draw.line([p1, p2], { fill: palette.frame, width: 1 });
    }
  }
}

function drawTerms(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  fontSymbols: string,
  smallSymbolSize: number,
) {
  if (!chart.options.showTerms || !chart.options.terms?.length) {
    return;
  }
  for (let signIndex = 0; signIndex < chart.options.terms.length; signIndex += 1) {
    for (const segment of chart.options.terms[signIndex]) {
      // Ruler longitude + glyph resolved daemon-side.
      const midDeg = segment.rulerLon ?? signIndex * 30 + segment.size / 2;
      const pt = polar(center, ringset.rTermsPlanet, midDeg, asc);
      draw.text([pt[0] - smallSymbolSize / 2, pt[1] - smallSymbolSize / 2], segment.rulerGlyph ?? "", {
        fill: palette.signs,
        font: fontSymbols,
        size: smallSymbolSize,
      });
    }
  }
}

function drawDecanLines(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
) {
  if (!chart.options.showDecans) {
    return;
  }
  // graphchart.py:3765-3773 starts at the current sign boundary (0 degrees)
  // and then advances by 10-degree decans, so sign-boundary decan ticks overdraw
  // the existing 30-degree spokes.
  for (let deg = 0; deg < 360; deg += 10) {
    const p1 = polar(center, ringset.rCuspOuter ?? ringset.rInner, deg, asc);
    const p2 = polar(center, ringset.rDecans, deg, asc);
    draw.line([p1, p2], { fill: palette.frame, width: 1 });
  }
}

function drawAngloCuspRuler(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
) {
  if (!isAngloWheel(chart) || ringset.rCuspOuter == null) return;
  const inward = Boolean(chart.options.showTerms || chart.options.showDecans);
  const direction = inward ? -1 : 1;
  const shortTick = ringset.r30 * 0.018;
  const mediumTick = ringset.r30 * 0.03;
  const longTick = ringset.r30 * 0.05;
  for (let deg = 0; deg < 360; deg += 1) {
    if (!inward && deg % 30 === 0) continue;
    const length = deg % 10 === 0 ? longTick : deg % 5 === 0 ? mediumTick : shortTick;
    draw.line(
      [
        polar(center, ringset.rCuspOuter, deg, asc),
        polar(center, ringset.rCuspOuter + direction * length, deg, asc),
      ],
      { fill: palette.frame, width: 1 },
    );
  }
}

function drawDecans(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  fontSymbols: string,
  smallSymbolSize: number,
) {
  if (!chart.options.showDecans || !chart.options.decans?.length) {
    return;
  }
  // Ruler longitude + glyph resolved daemon-side (ChartDecanRuler).
  for (const signDecan of chart.options.decans) {
    for (const ruler of signDecan.rulers ?? []) {
      const pt = polar(center, ringset.rDecansPlanet, ruler.rulerLon, asc);
      draw.text([pt[0] - smallSymbolSize / 2, pt[1] - smallSymbolSize / 2], ruler.rulerGlyph, {
        fill: palette.signs,
        font: fontSymbols,
        size: smallSymbolSize,
      });
    }
  }
}

function drawHouseNames(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  fontUi: string,
  symbolSize: number,
) {
  const fontSize = symbolSize / 2;
  for (let i = 0; i < 12; i++) {
    const cusp = chart.houses.cusps[i];
    const nextCusp = chart.houses.cusps[(i + 1) % 12];
    const width = ((nextCusp - cusp + 360) % 360) || 30;
    const pt = polar(center, ringset.rHouseName, cusp + width / 2, asc);
    if (isAngloWheel(chart)) {
      const label = String(i + 1);
      const [labelWidth, labelHeight] = draw.textsize(label, { font: fontUi, size: fontSize });
      draw.text([pt[0] - labelWidth / 2, pt[1] - labelHeight / 2], label, {
        fill: palette.textDim,
        font: fontUi,
        size: fontSize,
      });
      continue;
    }
    let xOffset = symbolSize / 4;
    let yOffset = symbolSize / 4;
    if (i === 0 || i === 1) {
      xOffset = 0;
      yOffset = symbolSize / 4;
      if (i === 1) {
        xOffset = symbolSize / 8;
      }
    }
    draw.text([pt[0] - xOffset, pt[1] - yOffset], HOUSE_GLYPHS_ROMAN[i], {
      fill: palette.houseNums,
      font: fontUi,
      size: fontSize,
    });
  }
}

function drawSigns(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  fontSymbols: string,
  signSize: number,
) {
  for (let i = 0; i < 12; i++) {
    const pt = polar(center, ringset.rSign, i * 30 + 15, asc);
    draw.text([pt[0] - signSize / 2, pt[1] - signSize / 2], signGlyph(i, chart.options.signVariant), {
      fill: chart.options.signColors?.[i] ?? palette.signs,
      font: fontSymbols,
      size: signSize,
    });
  }
}

function drawArrow(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  lon: number,
  color: string,
  width: number,
) {
  const left = polar(center, ringset.rASCMC, lon - 0.5, asc);
  const right = polar(center, ringset.rASCMC, lon + 0.5, asc);
  const apex = polar(center, ringset.rArrow, lon, asc);
  draw.line([left, right], { fill: color, width, lineCap: "round", lineJoin: "round" });
  draw.line([right, apex], { fill: color, width, lineCap: "round", lineJoin: "round" });
  draw.line([apex, left], { fill: color, width, lineCap: "round", lineJoin: "round" });
}

function drawAngloCuspArrow(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  lon: number,
  color: string,
) {
  const apex = polar(center, ringset.rInner, lon, asc);
  const baseRadius = ringset.rInner - ringset.r30 * 0.022;
  const left = polar(center, baseRadius, lon - 0.9, asc);
  const right = polar(center, baseRadius, lon + 0.9, asc);
  const ctx = draw.ctx;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(Math.round(apex[0]), Math.round(apex[1]));
  ctx.lineTo(Math.round(left[0]), Math.round(left[1]));
  ctx.lineTo(Math.round(right[0]), Math.round(right[1]));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawAscMC(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  chartSize: number,
  palette: ChartPalette,
  style: WheelRenderStyle,
) {
  const width = isAngloWheel(chart) ? 1 : ascmcPenWidth(style, chart, chartSize);
  const lons = [chart.angles.asc, chart.angles.dsc, chart.angles.mc, chart.angles.ic];
  for (let index = 0; index < lons.length; index += 1) {
    const lon = lons[index];
    if (isAngloWheel(chart)) {
      const isAscMc = index === 0 || index === 2;
      const sharedCusp =
        isAscMc && angleSharesHouseCusp(chart, index === 0 ? "__asc" : "__mc");
      draw.line(
        [polar(center, ringset.rBase, lon, asc), polar(center, ringset.rInner, lon, asc)],
        { fill: palette.angles, width: 2 },
      );
      if (sharedCusp && angleArrowheadsVisible(chart)) {
        drawAngloCuspArrow(draw, center, ringset, asc, lon, palette.angles);
      }
    } else {
      const p1 = polar(center, ringset.rBase, lon, asc);
      const p2 = polar(center, ringset.rASCMC, lon, asc);
      draw.line([p1, p2], { fill: palette.angles, width });
    }
  }
  if (!isAngloWheel(chart) && angleArrowheadsVisible(chart)) {
    drawArrow(draw, center, ringset, asc, chart.angles.asc, palette.angles, width);
    drawArrow(draw, center, ringset, asc, chart.angles.mc, palette.angles, width);
  }
}

function arrangeBodies(
  draw: TextMeasurer,
  chart: Chart,
  center: Pt,
  asc: number,
  rPlanet: number,
  fontSymbols: string,
  fontUi: string,
  symbolSize: number,
  style: WheelRenderStyle,
  includeAngles = false,
  includePositionStacks = false,
  includeSharedAngles = true,
  includeHouseCuspRays = Boolean(chart.options.showHouses),
): Map<LayoutKey, number> {
  const planets = planetById(chart);
  const ordered = layoutKeys(chart, includeAngles, includeSharedAngles)
    .map((key) => ({ key, longitude: layoutLongitude(chart, planets, key) }))
    .filter((entry): entry is { key: LayoutKey; longitude: number } => entry.longitude != null)
    .sort((a, b) => a.longitude - b.longitude);

  const shifts = new Map<LayoutKey, number>(ordered.map((entry) => [entry.key, 0]));
  const count = ordered.length;
  if (count < 2) {
    return shifts;
  }

  type LayoutRect = { x: number; y: number; w: number; h: number };
  const expandRect = (rect: LayoutRect, pad: number): LayoutRect => ({
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.w + pad * 2,
    h: rect.h + pad * 2,
  });
  const boxesAt = (idx: number): LayoutRect[] => {
    const entry = ordered[idx];
    const shift = shifts.get(entry.key) ?? 0;
    const shiftedLon = entry.longitude + shift;
    const pt = polar(center, rPlanet, shiftedLon, asc);
    const glyph = layoutGlyph(chart, planets, entry.key);
    const glyphSize = layoutGlyphSize(entry.key, symbolSize, style);
    const [w, h] = draw.textsize(glyph, {
      font: layoutGlyphFont(chart, entry.key, fontSymbols, fontUi),
      size: glyphSize,
      weight:
        entry.key === "__asc" || entry.key === "__mc"
          ? style.typography.ratios.angleLabelWeight
          : undefined,
    });
    const angleLabel = entry.key === "__asc" || entry.key === "__mc";
    const glyphRect = angleLabel
      ? { x: pt[0] - w / 2, y: pt[1] - h / 2, w, h }
      : { x: pt[0] - glyphSize / 2, y: pt[1] - glyphSize / 2, w, h };
    const pad = isAngloWheel(chart) ? Math.max(1, symbolSize * 0.06) : 0;
    const boxes = [expandRect(glyphRect, pad)];

    if (!isAngloWheel(chart) || !includePositionStacks) return boxes;
    if (entry.key === "__asc" || entry.key === "__mc") {
      return boxes;
    }
    const bodyPosition = bodyDegMin(chart, planets, entry.key);
    if (!bodyPosition) return boxes;
    const [degText, minText] = bodyPosition;
    const positionRows = [
      { text: `${degText}°`, radius: rPlanet - symbolSize, font: fontUi, size: symbolSize * 0.46 },
      {
        text: signGlyph(Math.floor(normalize(entry.longitude) / 30), chart.options.signVariant),
        radius: rPlanet - symbolSize * 1.65,
        font: fontSymbols,
        size: symbolSize * 0.56,
      },
      { text: minText, radius: rPlanet - symbolSize * 2.32, font: fontUi, size: symbolSize * 0.36 },
    ];
    for (const row of positionRows) {
      const rowPt = polar(center, row.radius, shiftedLon, asc);
      const [rowW, rowH] = draw.textsize(row.text, { font: row.font, size: row.size });
      boxes.push(
        expandRect(
          { x: rowPt[0] - rowW / 2, y: rowPt[1] - rowH / 2, w: rowW, h: rowH },
          pad * 0.6,
        ),
      );
    }
    return boxes;
  };

  const boxSetsOverlap = (left: LayoutRect[], right: LayoutRect[], extraGap = 0) => {
    const halfGap = extraGap / 2;
    const expandedLeft = halfGap ? left.map((box) => expandRect(box, halfGap)) : left;
    const expandedRight = halfGap ? right.map((box) => expandRect(box, halfGap)) : right;
    return expandedLeft.some((a) =>
      expandedRight.some((b) => overlap(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h)),
    );
  };

  // Anglo angle and house-cusp rays are fixed structural geometry. They must
  // stay at their exact longitudes, so reserve those radial lanes and move
  // nearby body labels/position stacks around them instead.
  const fixedRayLongitudes = isAngloWheel(chart)
    ? [
        chart.angles.asc,
        chart.angles.dsc,
        chart.angles.mc,
        chart.angles.ic,
        ...(includeHouseCuspRays ? chart.houses.cusps : []),
      ].filter(
        (lon, index, values) =>
          values.findIndex((candidate) => sameLongitude(candidate, lon)) === index,
      )
    : [];
  const boxIntersectsRay = (box: LayoutRect, rayLon: number): boolean => {
    const rayPt = polar(center, 1, rayLon, asc);
    const ux = rayPt[0] - center[0];
    const uy = rayPt[1] - center[1];
    const nx = -uy;
    const ny = ux;
    const boxCenterX = box.x + box.w / 2;
    const boxCenterY = box.y + box.h / 2;
    const dx = boxCenterX - center[0];
    const dy = boxCenterY - center[1];
    const along = dx * ux + dy * uy;
    if (along <= 0) return false;
    const cross = Math.abs(dx * nx + dy * ny);
    const crossExtent = Math.abs(nx) * box.w / 2 + Math.abs(ny) * box.h / 2;
    return cross <= crossExtent + Math.max(1, symbolSize * 0.08);
  };
  const avoidFixedRays = (): boolean => {
    if (!fixedRayLongitudes.length) return false;
    let shifted = false;
    for (let idx = 0; idx < count; idx += 1) {
      const key = ordered[idx].key;
      if (key === "__asc" || key === "__mc") continue;
      let attempts = 0;
      while (attempts < 3600) {
        const boxes = boxesAt(idx);
        const collidingRay = fixedRayLongitudes.find((rayLon) =>
          boxes.some((box) => boxIntersectsRay(box, rayLon)),
        );
        if (collidingRay == null) break;
        const displayedLon = ordered[idx].longitude + (shifts.get(key) ?? 0);
        const signedDelta = ((displayedLon - collidingRay + 540) % 360) - 180;
        shifts.set(key, (shifts.get(key) ?? 0) + (signedDelta < 0 ? -0.1 : 0.1));
        shifted = true;
        attempts += 1;
      }
    }
    return shifted;
  };

  const doShift = (
    leftIdx: number,
    rightIdx: number,
    forward = false,
    extraGap = 0,
  ): boolean => {
    let shifted = false;
    let left = boxesAt(leftIdx);
    let right = boxesAt(rightIdx);
    let attempts = 0;
    while (boxSetsOverlap(left, right, extraGap) && attempts < 3600) {
      const leftKey = ordered[leftIdx].key;
      const rightKey = ordered[rightIdx].key;
      if (!forward) {
        shifts.set(leftKey, (shifts.get(leftKey) ?? 0) - 0.1);
      }
      shifts.set(rightKey, (shifts.get(rightKey) ?? 0) + 0.1);
      left = boxesAt(leftIdx);
      right = boxesAt(rightIdx);
      shifted = true;
      attempts += 1;
    }
    return shifted;
  };

  const doArrange = (forward = false) => {
    let shifted = false;
    for (let i = 0; i < count - 1; i++) {
      shifted = doShift(i, i + 1, forward) || shifted;
    }
    if (shifted) {
      doArrange(forward);
    }
  };

  const recheckCircularEdge = () => {
    // A later fixed-ray pass can push the first Aries body backward after the
    // initial Pisces↔Aries check. Recheck only that circular seam, then cascade
    // any resulting displacement forward through the linear neighbors.
    const seamGap = Math.max(1, symbolSize * 0.08);
    for (let i = 0; i < count + 1; i++) {
      const moved = doShift(count - 1, 0, true, seamGap);
      if (!moved) return;
      doArrange(true);
    }
    // Preserve the seam as the final priority if an exceptionally dense full
    // ring exhausts the bounded settling passes.
    doShift(count - 1, 0, true, seamGap);
  };

  const settleFixedRays = () => {
    for (let round = 0; round < count + 1; round += 1) {
      if (!avoidFixedRays()) break;
      doArrange(false);
    }
    // Structural rays win the final tie: never leave a glyph sitting on a
    // true angle/cusp merely to preserve a marginal label-to-label gap.
    avoidFixedRays();
    recheckCircularEdge();
  };

  for (let i = 0; i < count + 1; i++) {
    doArrange(false);
  }

  const wrapped = doShift(count - 1, 0, true);
  if (wrapped) {
    for (let i = 0; i < count; i++) {
      doArrange(true);
    }
    settleFixedRays();
    return shifts;
  }

  if (ordered[count - 1].longitude > 300 && ordered[0].longitude < 60) {
    const lastLon = ordered[count - 1].longitude + (shifts.get(ordered[count - 1].key) ?? 0);
    const firstLon = ordered[0].longitude + 360 + (shifts.get(ordered[0].key) ?? 0);
    if (lastLon > firstLon) {
      const distance = lastLon - firstLon;
      shifts.set(ordered[0].key, (shifts.get(ordered[0].key) ?? 0) + distance);
      doShift(count - 1, 0, true);
      for (let i = 0; i < count - 1; i++) {
        const lon1 = ordered[i].longitude + (shifts.get(ordered[i].key) ?? 0);
        const lon2 = ordered[i + 1].longitude + (shifts.get(ordered[i + 1].key) ?? 0);
        if (lon1 < 180 && lon2 < 180) {
          if (lon1 > lon2) {
            const distance2 = lon1 - lon2;
            shifts.set(ordered[i + 1].key, (shifts.get(ordered[i + 1].key) ?? 0) + distance2);
            doShift(i, i + 1, true);
          } else {
            break;
          }
        } else {
          break;
        }
      }
      for (let i = 0; i < count; i++) {
        doArrange(true);
      }
    }
  }

  settleFixedRays();

  return shifts;
}

// Port of graphchart.py:_compute_label_yoffs (commits 2db6f4d + f488447).
// For tight planet clusters, alternate adjacent bodies' deg/min labels at
// two radial levels (outer layer at rPos, inner layer at rPos − layerOffset)
// so labels never pixel-overlap. Cluster-scoped A/B/A/B zig-zag — once a
// body is connected (overlaps prev or next at default radius) it joins the
// cluster, and indexes from cluster start drive even=outer / odd=inner.
// Singletons stay outer. Outer ring is skipped (only the inner radix wheel
// has the rPos stack).
function computeLabelYoffs(
  draw: TextMeasurer,
  chart: Chart,
  center: Pt,
  asc: number,
  rPos: number,
  shifts: Map<LayoutKey, number>,
  fontUi: string,
  symbolSize: number,
): Map<LayoutKey, number> {
  const yoffs = new Map<LayoutKey, number>();
  if (!chart.options.showPositions && !isCompactWheel(chart) && !isAngloWheel(chart)) {
    return yoffs;
  }
  const planets = planetById(chart);
  const ordered = layoutKeys(chart, isAngloWheel(chart))
    .map((key) => ({ key, longitude: layoutLongitude(chart, planets, key) }))
    .filter((entry): entry is { key: LayoutKey; longitude: number } => entry.longitude != null)
    .sort((a, b) => a.longitude - b.longitude);
  const count = ordered.length;
  if (count < 2) {
    return yoffs;
  }

  const [, degTextH] = draw.textsize("00", { font: fontUi, size: symbolSize / 2 });
  const layerOffset = degTextH + 1;

  const [degW, degH] = draw.textsize("29", { font: fontUi, size: symbolSize / 2 });
  const [minW, minH] = draw.textsize("59", { font: fontUi, size: symbolSize / 4 });
  const labelW = Math.max(degW, minW) + 2;
  const labelH = Math.max(degH, minH) + 1;

  const rectAt = (idx: number, yoff: number) => {
    const entry = ordered[idx];
    const shift = shifts.get(entry.key) ?? 0;
    const r = rPos - yoff;
    const pt = polar(center, r, entry.longitude + shift, asc);
    return { x: pt[0] - labelW / 2, y: pt[1] - labelH / 2, w: labelW, h: labelH };
  };

  // Pass 1: pairwise overlap at the default radius.
  const overlapFlags: boolean[] = [];
  for (let i = 0; i < count - 1; i++) {
    const a = rectAt(i, 0);
    const b = rectAt(i + 1, 0);
    overlapFlags.push(overlap(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h));
  }

  // Pass 2: cluster-scoped A/B/A/B zig-zag from each cluster's start index.
  let clusterStart: number | null = null;
  for (let i = 0; i < count; i++) {
    const connectsPrev = i > 0 && overlapFlags[i - 1];
    const connectsNext = i < count - 1 && overlapFlags[i];
    const inCluster = connectsPrev || connectsNext;
    if (inCluster) {
      if (clusterStart === null) {
        clusterStart = i;
      }
      const offsetInCluster = i - clusterStart;
      yoffs.set(ordered[i].key, offsetInCluster % 2 === 0 ? 0 : layerOffset);
    } else {
      clusterStart = null;
      yoffs.set(ordered[i].key, 0);
    }
  }

  return yoffs;
}

function getBodyShifts(
  draw: TextMeasurer,
  chart: Chart,
  center: Pt,
  asc: number,
  rPlanet: number,
  fontSymbols: string,
  fontUi: string,
  symbolSize: number,
  style: WheelRenderStyle,
  includeAngles = false,
  includePositionStacks = false,
  includeSharedAngles = true,
  includeHouseCuspRays = Boolean(chart.options.showHouses),
): Map<LayoutKey, number> {
  const key = [
    cachePoint(center),
    cacheNumber(asc),
    cacheNumber(rPlanet),
    fontSymbols,
    fontUi,
    cacheNumber(symbolSize),
    includeAngles ? "angles:on" : "angles:off",
    includePositionStacks ? "stacks:on" : "stacks:off",
    includeSharedAngles ? "shared-angles:on" : "shared-angles:off",
    includeHouseCuspRays ? "cusp-rays:on" : "cusp-rays:off",
  ].join("|");
  let chartCache = bodyShiftCache.get(chart);
  if (!chartCache) {
    chartCache = new Map();
    bodyShiftCache.set(chart, chartCache);
  }
  const cached = chartCache.get(key);
  if (cached) return cached;
  const shifts = arrangeBodies(
    draw,
    chart,
    center,
    asc,
    rPlanet,
    fontSymbols,
    fontUi,
    symbolSize,
    style,
    includeAngles,
    includePositionStacks,
    includeSharedAngles,
    includeHouseCuspRays,
  );
  boundedMapSet(chartCache, key, shifts);
  return shifts;
}

function getBodyLayout(
  draw: TextMeasurer,
  chart: Chart,
  center: Pt,
  asc: number,
  rPlanet: number,
  rPos: number,
  fontSymbols: string,
  fontUi: string,
  symbolSize: number,
  style: WheelRenderStyle,
): BodyLayout {
  const key = [
    cachePoint(center),
    cacheNumber(asc),
    cacheNumber(rPlanet),
    cacheNumber(rPos),
    fontSymbols,
    fontUi,
    cacheNumber(symbolSize),
    isCompactWheel(chart) ? "theme:compact" : isAngloWheel(chart) ? "theme:anglo" : "theme:classic",
    chart.options.showTerms ? "terms:on" : "terms:off",
    chart.options.showDecans ? "decans:on" : "decans:off",
    chart.options.showHouses ? "houses:on" : "houses:off",
    chart.options.showPositions ? "positions:on" : "positions:off",
    chart.options.showCusplessAscMcLabels === false ? "cuspless-angles:off" : "cuspless-angles:on",
  ].join("|");
  let chartCache = bodyLayoutCache.get(chart);
  if (!chartCache) {
    chartCache = new Map();
    bodyLayoutCache.set(chart, chartCache);
  }
  const cached = chartCache.get(key);
  if (cached) return cached;
  const anglo = isAngloWheel(chart);
  const includeCusplessAngles = Boolean(chart.options.showHouses) || cusplessAscMcLabelsVisible(chart);
  const bodyShifts = getBodyShifts(
    draw,
    chart,
    center,
    asc,
    rPlanet,
    fontSymbols,
    fontUi,
    symbolSize,
    style,
    anglo && includeCusplessAngles,
    anglo && includeCusplessAngles,
    !chart.options.showHouses && cusplessAscMcLabelsVisible(chart),
  );
  const labelYoffs = isAngloWheel(chart)
    ? new Map<LayoutKey, number>()
    : computeLabelYoffs(draw, chart, center, asc, rPos, bodyShifts, fontUi, symbolSize);
  const layout = { bodyShifts, labelYoffs };
  boundedMapSet(chartCache, key, layout);
  return layout;
}

function drawPlanetLines(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  shifts: Map<LayoutKey, number>,
  chartSize: number,
  palette: ChartPalette,
  style: WheelRenderStyle,
) {
  const planets = planetById(chart);
  const anglo = isAngloWheel(chart);
  const width = anglo ? 2 : mediumPenWidth(style, chartSize);
  const color = anglo ? palette.angles : palette.frame;
  for (const key of bodyKeys(chart)) {
    const lon = bodyLongitude(chart, planets, key);
    if (lon == null) {
      continue;
    }
    const shift = shifts.get(key) ?? 0;
    const p1 = polar(center, ringset.rInner, lon, asc);
    const p2 = polar(center, ringset.rLLine, anglo ? lon : lon + shift, asc);
    draw.line([p1, p2], { fill: color, width });

    if (!isCompactWheel(chart)) {
      // Keep the mathematical aspect endpoint at the true longitude. Only the
      // leader tip follows displacement, making the inner tick diagonal when a
      // body is shifted.
      const p3 = polar(center, ringset.rAsp, lon, asc);
      const p4 = polar(center, ringset.rLLine2, anglo ? lon : lon + shift, asc);
      draw.line([p3, p4], { fill: color, width });
    }
  }
}

function drawAngloAngleLabelLines(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  shifts: Map<LayoutKey, number>,
  palette: ChartPalette,
) {
  if (!isAngloWheel(chart)) return;
  const rulerRadius = ringset.rCuspOuter ?? ringset.r0;
  const rulerDirection = chart.options.showTerms || chart.options.showDecans ? -1 : 1;
  const entries: Array<[AngleLayoutKey, number]> = [
    ["__asc", chart.angles.asc],
    ["__mc", chart.angles.mc],
  ];
  for (const [key, lon] of entries) {
    if (angleSharesHouseCusp(chart, key)) continue;
    if (shifts.has(key)) {
      draw.line(
        [
          polar(center, ringset.rInner, lon, asc),
          polar(center, ringset.rLLine, lon, asc),
        ],
        { fill: palette.angles, width: 2 },
      );
      draw.line(
        [
          polar(center, ringset.rAsp, lon, asc),
          polar(center, ringset.rLLine2, lon, asc),
        ],
        { fill: palette.angles, width: 2 },
      );
    }
    // The true-longitude ruler marker and degree run remain even when the
    // optional floating AC/MC label is hidden in a cuspless chart.
    draw.line(
      [
        polar(center, rulerRadius, lon, asc),
        polar(center, rulerRadius + rulerDirection * ringset.r30 * 0.02, lon, asc),
      ],
      { fill: palette.angles, width: 2 },
    );
  }
}

function drawOuterPlanetLines(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  shifts: Map<LayoutKey, number>,
  chartSize: number,
  palette: ChartPalette,
  style: WheelRenderStyle,
) {
  const planets = planetById(chart);
  const anglo = isAngloWheel(chart);
  const width = anglo ? 2 : mediumPenWidth(style, chartSize);
  const color = anglo ? palette.angles : palette.frame;
  for (const key of bodyKeys(chart)) {
    const lon = bodyLongitude(chart, planets, key);
    if (lon == null) {
      continue;
    }
    const shift = shifts.get(key) ?? 0;
    const p1 = polar(center, ringset.r30, lon, asc);
    const p2 = polar(center, ringset.rOuterLine, anglo ? lon : lon + shift, asc);
    draw.line([p1, p2], { fill: color, width });
  }
}

function drawAngloOuterAngleLines(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  shifts: Map<LayoutKey, number>,
  palette: ChartPalette,
) {
  if (!isAngloWheel(chart)) return;
  const entries: Array<[AngleLayoutKey, number]> = [
    ["__asc", chart.angles.asc],
    ["__mc", chart.angles.mc],
  ];
  for (const [key, lon] of entries) {
    if (!shifts.has(key)) continue;
    draw.line(
      [polar(center, ringset.r30, lon, asc), polar(center, ringset.rOuterLine, lon, asc)],
      { fill: palette.angles, width: 2 },
    );
  }
}

function drawAngloOuterAngleLabels(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  shifts: Map<LayoutKey, number>,
  palette: ChartPalette,
  fontUi: string,
  symbolSize: number,
  style: WheelRenderStyle,
) {
  if (!isAngloWheel(chart) || ringset.rOuterPlanet == null) return;
  const entries: Array<[AngleLayoutKey, "AC" | "MC", number]> = [
    ["__asc", "AC", chart.angles.asc],
    ["__mc", "MC", chart.angles.mc],
  ];
  for (const [key, label, lon] of entries) {
    const shift = shifts.get(key);
    if (shift == null) continue;
    const pt = polar(center, ringset.rOuterPlanet, lon + shift, asc);
    const size = layoutGlyphSize(key, symbolSize, style);
    const weight = style.typography.ratios.angleLabelWeight;
    const [w, h] = draw.textsize(label, { font: fontUi, size, weight });
    draw.text([pt[0] - w / 2, pt[1] - h / 2], label, {
      fill: palette.angles,
      font: fontUi,
      size,
      weight,
    });
  }
}

// ---------------------------------------------------------------------------
// Click-to-toggle aspect filtering.
//   The daemon owns ALL aspect meaning: snapshot.clickAspectFlags (whether
//   click-exclusive mode is active) and snapshot.bodyAspects, where each entry
//   already carries the engine's `showsOnClick` verdict — the major-only gate
//   plus the ayanamsha-correct whole-sign traditional filter, decided in the
//   chart's chosen zodiac (export_chart_json._click_filter_pass /
//   graphchart._should_show_aspect). The skin owns only the click SELECTION
//   (selectedBody / hideAll) and which lines to draw — it never recomputes a
//   sign distance, so sidereal charts stay correct.
// ---------------------------------------------------------------------------

export interface ClickAspectState {
  // selectedBody is active only in exclusive-on-click mode. hideAll is the
  // shared transient wheel gate used by both the empty-band click and A.
  selectedBody: string | null;
  hideAll: boolean;
}

// Build the exclusive aspect list when a body is selected — the force-show
// path. Reads bodyAspects[selected] and keeps the entries the engine already
// flagged `showsOnClick`, yielding ChartAspect records the existing draw loops
// consume. Mirrors drawAspectSymbols' click loop (graphchart.py:2300-2328); the
// filter itself lives in the export brain (no aspect meaning in the skin).
function buildClickAspects(
  chart: Chart,
  selectedBody: string,
): ChartAspect[] {
  const bodyAspects = chart.bodyAspects?.[selectedBody as AspectBodyKey];
  if (!bodyAspects) return [];
  const out: ChartAspect[] = [];
  for (const entry of bodyAspects) {
    if (!entry.showsOnClick) continue;
    out.push({
      p1: selectedBody as AspectBodyKey,
      p2: entry.other,
      type: entry.type,
      orb: entry.orb,
      maxOrb: entry.maxOrb,
      exact: entry.exact,
    });
  }
  return out;
}

// Resolve which aspect list the dynamic layer should draw, given the click
// state. Returns null to mean "draw nothing" (hide_all). Otherwise returns the
// list (exclusive when a body is selected, else the normal filtered list).
// Mirrors morin._on_chart_click_for_aspects → graphchart render dispatch.
function resolveAspectsForDraw(
  chart: Chart,
  clickState: ClickAspectState | undefined,
): ChartAspect[] | null {
  const flags = chart.clickAspectFlags;
  if (clickState?.hideAll) return null; // shared A/click gate: hide ALL aspects
  // Gate the whole behavior on exclusiveOnClick. When OFF, normal behavior.
  if (!clickState || !flags?.exclusiveOnClick) {
    return chart.aspects;
  }
  if (clickState.selectedBody) {
    return buildClickAspects(chart, clickState.selectedBody);
  }
  return chart.aspects;
}

function resolveOuterPointAspectsForDraw(
  chart: Chart,
  clickState: ClickAspectState | undefined,
): ChartAspect[] | undefined {
  const flags = chart.clickAspectFlags;
  if (clickState?.hideAll) {
    return [];
  }
  if (!clickState || !flags?.exclusiveOnClick) {
    return undefined;
  }
  const selected = clickState.selectedBody;
  if (!selected?.startsWith("point:outer:")) {
    return undefined;
  }
  return buildClickAspects(chart, selected);
}

function resolveInterChartAspectsForDraw(
  chart: Chart,
  interChartAspects: InterChartAspect[],
  interChartBodyAspects: InterChartBodyAspectsMap | undefined,
  clickState: ClickAspectState | undefined,
): InterChartAspect[] {
  const flags = chart.clickAspectFlags;
  if (clickState?.hideAll) {
    return [];
  }
  if (!clickState || !flags?.exclusiveOnClick) {
    return interChartAspects.filter((aspect) => aspect.showsNormally !== false);
  }
  const selected = clickState.selectedBody;
  if (!selected) {
    return interChartAspects.filter((aspect) => aspect.showsNormally !== false);
  }
  if (selected.startsWith("point:")) {
    return [];
  }
  const selectedKey = canonicalInterChartSelectionKey(selected);
  const mapped = interChartBodyAspects?.[selectedKey];
  const candidates = mapped ?? filterInterChartAspectsBySelection(interChartAspects, selected);
  return candidates.filter((aspect) => aspect.showsOnClick !== false);
}

function canonicalAngleAspectKey(key: string): string {
  return key === "dsc" ? "dc" : key;
}

function canonicalInterChartSelectionKey(key: string): keyof InterChartBodyAspectsMap {
  if (key.startsWith("outer:")) {
    return `outer:${canonicalAngleAspectKey(key.slice("outer:".length))}` as keyof InterChartBodyAspectsMap;
  }
  return canonicalAngleAspectKey(key) as keyof InterChartBodyAspectsMap;
}

function filterInterChartAspectsBySelection(
  interChartAspects: InterChartAspect[],
  selected: string,
): InterChartAspect[] {
  if (selected.startsWith("outer:")) {
    const outer = canonicalAngleAspectKey(selected.slice("outer:".length));
    return interChartAspects.filter((aspect) => aspect.outer === outer);
  }
  const inner = canonicalAngleAspectKey(selected);
  return interChartAspects.filter((aspect) => aspect.inner === inner);
}

function clickPointLongitude(key: string): number | null {
  // Encoded by chart-canvas from the daemon-exported secondary_ring item:
  // point:<role>:<family>:<id>:<longitude>. The longitude is presentation
  // geometry only; aspect existence/type/orb remains exporter-computed.
  const match = /^point:.*:([-+]?\d+(?:\.\d+)?)$/.exec(key);
  if (!match) return null;
  const lon = Number(match[1]);
  return Number.isFinite(lon) ? lon : null;
}

function aspectEndpoint(
  chart: Chart,
  planets: Map<PlanetId, ChartPlanet>,
  center: Pt,
  ringset: RingSet,
  asc: number,
  key: string,
): Pt | null {
  if (key === "asc") {
    return polar(center, ringset.rAspAscMC, chart.angles.asc, asc);
  }
  if (key === "mc") {
    return polar(center, ringset.rAspAscMC, chart.angles.mc, asc);
  }
  if (key === "dc" || key === "dsc") {
    return polar(center, ringset.rAspAscMC, chart.angles.dsc, asc);
  }
  if (key === "ic") {
    return polar(center, ringset.rAspAscMC, chart.angles.ic, asc);
  }
  if (key === "fortune") {
    if (!chart.fortune) {
      return null;
    }
    return polar(center, ringset.rAsp, chart.fortune.longitude, asc);
  }
  if (key === "vertex") {
    // Desktop draws vertex aspect endpoints at rAsp (graphchart.py:2555),
    // i.e. like a body, not at the Asc/MC radius.
    const vlon = chart.vertex?.longitude ?? chart.angles.vertex;
    return vlon == null ? null : polar(center, ringset.rAsp, vlon, asc);
  }
  if (key === "syzygy") {
    const slon = chart.syzygy?.longitude;
    return slon == null ? null : polar(center, ringset.rAsp, slon, asc);
  }
  if (key.startsWith("point:")) {
    const lon = clickPointLongitude(key);
    return lon == null ? null : polar(center, ringset.rAsp, lon, asc);
  }
  const lon = planets.get(key as PlanetId)?.longitude;
  return lon == null ? null : polar(center, ringset.rAsp, lon, asc);
}

function aspectEndpointLongitude(
  chart: Chart,
  planets: Map<PlanetId, ChartPlanet>,
  key: string,
): number | null {
  if (key === "asc") return chart.angles.asc;
  if (key === "mc") return chart.angles.mc;
  if (key === "dc" || key === "dsc") return chart.angles.dsc;
  if (key === "ic") return chart.angles.ic;
  if (key === "fortune") return chart.fortune?.longitude ?? null;
  if (key === "vertex") return chart.vertex?.longitude ?? chart.angles.vertex ?? null;
  if (key === "syzygy") return chart.syzygy?.longitude ?? null;
  if (key.startsWith("point:")) return clickPointLongitude(key);
  return planets.get(key as PlanetId)?.longitude ?? null;
}

function aspectLineStyle(
  chart: Chart,
  palette: ChartPalette,
  aspect: { type: number; orb: number; maxOrb?: number; exact?: boolean },
): { fill: string; width: number; dash?: number[]; opacity?: number } {
  const fill = palette.aspects[aspect.type] ?? palette.frame;
  if (chart.options.aspectThicknessMode || chart.options.aspectOpacityMode) {
    const maxOrb = Number(aspect.maxOrb ?? 0);
    if (maxOrb > 0) {
      const orbRatio = Math.min(Math.max(Number(aspect.orb ?? 0) / maxOrb, 0), 1);
      if (isAngloWheel(chart)) {
        return {
          fill,
          width: chart.options.aspectThicknessMode ? 0.75 + 1.25 * (1 - orbRatio) : 0.85,
          opacity: chart.options.aspectOpacityMode ? 0.45 + 0.55 * (1 - orbRatio) : 1,
        };
      }
      return {
        fill,
        width: chart.options.aspectThicknessMode ? Math.max(1, Math.round(4 * (1 - orbRatio))) : 1,
        opacity: chart.options.aspectOpacityMode ? 0.3 + 0.7 * (1 - orbRatio) : 1,
      };
    }
    return {
      fill,
      width: chart.options.aspectThicknessMode ? (isAngloWheel(chart) ? 1.25 : 2) : (isAngloWheel(chart) ? 0.85 : 1),
      opacity: 1,
    };
  }
  return {
    fill,
    width: isAngloWheel(chart) ? 0.85 : 1,
    dash: aspect.exact ? undefined : isAngloWheel(chart) ? [5, 5] : [10, 10],
  };
}

function drawAspectLines(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  aspects: ChartAspect[],
) {
  const planets = planetById(chart);
  for (const aspect of aspects) {
    const p1 = aspectEndpoint(chart, planets, center, ringset, asc, aspect.p1);
    const p2 = aspectEndpoint(chart, planets, center, ringset, asc, aspect.p2);
    if (!p1 || !p2) {
      continue;
    }
    draw.line([p1, p2], {
      ...aspectLineStyle(chart, palette, aspect),
    });
  }
}

function drawAspectSymbols(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  fontSymbols: string,
  symbolSize: number,
  aspects: ChartAspect[],
) {
  const planets = planetById(chart);
  const fontSize = symbolSize / 2;
  for (const aspect of aspects) {
    const glyph = aspectGlyph(aspect.type);
    if (!glyph) {
      continue;
    }
    const p1 = aspectEndpoint(chart, planets, center, ringset, asc, aspect.p1);
    const p2 = aspectEndpoint(chart, planets, center, ringset, asc, aspect.p2);
    if (!p1 || !p2) {
      continue;
    }
    draw.text(
      [
        (p1[0] + p2[0]) / 2 - symbolSize / 4,
        (p1[1] + p2[1]) / 2 - symbolSize / 4,
      ],
      glyph,
      {
        fill: palette.aspects[aspect.type] ?? palette.frame,
        font: fontSymbols,
        size: fontSize,
      },
    );
  }
}

function drawDegMinPair(
  draw: CanvasDraw,
  x: number,
  y: number,
  degText: string,
  minText: string,
  palette: ChartPalette,
  fontUi: string,
  symbolSize: number,
): Bounds {
  const degSize = symbolSize / 2;
  const minSize = symbolSize / 4;
  const [degWidth, degHeight] = draw.textsize(degText, { font: fontUi, size: degSize });
  const [minWidth, minHeight] = draw.textsize(minText, { font: fontUi, size: minSize });
  // wx (graphchart.py:2215-2218, restored in commit 4b7bbaa) centers the
  // degree text around x and butts the minute text directly after — no gap.
  const xDeg = x - degWidth / 2;
  const yDeg = y - degHeight / 2;
  draw.text([xDeg, yDeg], degText, {
    fill: palette.positions,
    font: fontUi,
    size: degSize,
  });
  draw.text([xDeg + degWidth, yDeg], minText, {
    fill: palette.positions,
    font: fontUi,
    size: minSize,
  });
  return { x: xDeg, y: yDeg, w: degWidth + minWidth, h: Math.max(degHeight, minHeight) };
}

function drawDegMinStack(
  draw: CanvasDraw,
  center: Pt,
  degRadius: number,
  minRadius: number,
  lon: number,
  asc: number,
  yoff: number,
  degText: string,
  minText: string,
  palette: ChartPalette,
  fontUi: string,
  symbolSize: number,
): Bounds[] {
  const degSize = symbolSize / 2;
  const minSize = symbolSize / 4;
  const degLabel = `${degText}°`;
  const minLabel = `${minText}'`;
  const degPt = polar(center, degRadius - yoff, lon, asc);
  const [degWidth, degHeight] = draw.textsize(degLabel, { font: fontUi, size: degSize });
  draw.text([degPt[0] - degWidth / 2, degPt[1] - degHeight / 2], degLabel, {
    fill: palette.positions,
    font: fontUi,
    size: degSize,
  });

  const minPt = polar(center, minRadius - yoff, lon, asc);
  const [minWidth, minHeight] = draw.textsize(minLabel, { font: fontUi, size: minSize });
  draw.text([minPt[0] - minWidth / 2, minPt[1] - minHeight / 2], minLabel, {
    fill: palette.positions,
    font: fontUi,
    size: minSize,
  });
  return [
    { x: degPt[0] - degWidth / 2, y: degPt[1] - degHeight / 2, w: degWidth, h: degHeight },
    { x: minPt[0] - minWidth / 2, y: minPt[1] - minHeight / 2, w: minWidth, h: minHeight },
  ];
}

function drawAngloBodyPosition(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  trueLon: number,
  shiftedLon: number,
  asc: number,
  yoff: number,
  degText: string,
  minText: string,
  chart: Chart,
  palette: ChartPalette,
  fontUi: string,
  fontSymbols: string,
  symbolSize: number,
): Bounds[] {
  const rows = [
    {
      text: `${degText}°`,
      radius: ringset.rPlanet - symbolSize * 1.0 - yoff,
      font: fontUi,
      size: symbolSize * 0.46,
      fill: palette.positions,
    },
    {
      text: signGlyph(Math.floor(normalize(trueLon) / 30), chart.options.signVariant),
      radius: ringset.rPlanet - symbolSize * 1.65 - yoff,
      font: fontSymbols,
      size: symbolSize * 0.56,
      fill: chart.options.signColors?.[Math.floor(normalize(trueLon) / 30)] ?? palette.signs,
    },
    {
      text: minText,
      radius: ringset.rPlanet - symbolSize * 2.32 - yoff,
      font: fontUi,
      size: symbolSize * 0.36,
      fill: palette.positions,
    },
  ];
  const bounds: Bounds[] = [];
  for (const row of rows) {
    const pt = polar(center, row.radius, shiftedLon, asc);
    const [w, h] = draw.textsize(row.text, { font: row.font, size: row.size });
    draw.text([pt[0] - w / 2, pt[1] - h / 2], row.text, {
      fill: row.fill,
      font: row.font,
      size: row.size,
    });
    bounds.push({ x: pt[0] - w / 2, y: pt[1] - h / 2, w, h });
  }
  return bounds;
}

function drawAngloLongitudeRun(
  draw: CanvasDraw,
  center: Pt,
  radius: number,
  lon: number,
  asc: number,
  degText: string,
  minText: string,
  chart: Chart,
  palette: ChartPalette,
  fontUi: string,
  fontSymbols: string,
  symbolSize: number,
) {
  const signIndex = Math.floor(normalize(lon) / 30);
  const parts = [
    { text: `${degText}°`, font: fontUi, size: symbolSize * 0.4, fill: palette.positions },
    {
      text: signGlyph(signIndex, chart.options.signVariant),
      font: fontSymbols,
      size: symbolSize * 0.52,
      fill: chart.options.signColors?.[signIndex] ?? palette.signs,
    },
    { text: minText, font: fontUi, size: symbolSize * 0.34, fill: palette.positions },
  ];
  const gap = symbolSize * 0.08;
  const sizes = parts.map((part) => draw.textsize(part.text, { font: part.font, size: part.size }));
  const pt = polar(center, radius, lon, asc);
  const radialX = (pt[0] - center[0]) / Math.max(1, radius);
  const radialY = (pt[1] - center[1]) / Math.max(1, radius);
  const tangentX = -radialY;
  const tangentY = radialX;
  const extents = sizes.map(
    ([w, h]) => (Math.abs(tangentX) * w + Math.abs(tangentY) * h) / 2,
  );
  const totalSpan = extents.reduce((sum, extent) => sum + extent * 2, 0) + gap * (parts.length - 1);
  let cursor = -totalSpan / 2;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const [w, h] = sizes[i];
    const centerOffset = cursor + extents[i];
    const x = pt[0] + tangentX * centerOffset;
    const y = pt[1] + tangentY * centerOffset;
    draw.text([x - w / 2, y - h / 2], part.text, {
      fill: part.fill,
      font: part.font,
      size: part.size,
    });
    cursor += extents[i] * 2 + gap;
  }
}

function drawPlanets(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  shifts: Map<LayoutKey, number>,
  labelYoffs: Map<LayoutKey, number>,
  palette: ChartPalette,
  fontSymbols: string,
  fontUi: string,
  symbolSize: number,
  style: WheelRenderStyle,
  outer = false,
) {
  const planets = planetById(chart);
  for (const key of bodyKeys(chart)) {
    const lon = bodyLongitude(chart, planets, key);
    if (lon == null) {
      continue;
    }
    const shift = shifts.get(key) ?? 0;
    const pt = polar(center, ringset.rPlanet, lon + shift, asc);
    const glyphSize = bodyGlyphSize(key, symbolSize, style);
    draw.text([pt[0] - glyphSize / 2, pt[1] - glyphSize / 2], bodyGlyph(chart, planets, key), {
      fill: bodyColor(chart, planets, key, palette),
      font: bodyGlyphFont(chart, key, fontSymbols, fontUi),
      size: glyphSize,
    });

    const positionBounds: Bounds[] = [];
    if (!outer) {
      const yoff = labelYoffs.get(key) ?? 0;
      const degMin = bodyDegMin(chart, planets, key);
      if (degMin) {
        if (isAngloWheel(chart)) {
          // Full degree/sign/minute stacks are intrinsic to the Anglo grammar;
          // do not mutate the user's global Positions preference merely to
          // make this one layout complete.
          positionBounds.push(...drawAngloBodyPosition(
            draw,
            center,
            ringset,
            lon,
            lon + shift,
            asc,
            yoff,
            degMin[0],
            degMin[1],
            chart,
            palette,
            fontUi,
            fontSymbols,
            symbolSize,
          ));
        } else if (isCompactWheel(chart) && ringset.rPosDeg && ringset.rPosMin) {
          positionBounds.push(...drawDegMinStack(
            draw,
            center,
            ringset.rPosDeg,
            ringset.rPosMin,
            lon + shift,
            asc,
            yoff,
            degMin[0],
            degMin[1],
            palette,
            fontUi,
            symbolSize,
          ));
        } else if (chart.options.showPositions) {
          const posPt = polar(center, ringset.rPos - yoff, lon + shift, asc);
          positionBounds.push(
            drawDegMinPair(draw, posPt[0], posPt[1], degMin[0], degMin[1], palette, fontUi, symbolSize),
          );
        }
      }
    }

    // Motion marker (retrograde/station) resolved daemon-side. Keep its
    // normal radial position, but move it sideways when that lane meets the
    // planet's own degree/minute label at this wheel angle.
    const marker =
      key === "__fortune" || key === "__vertex" || key === "__syzygy" ? "" : planets.get(key)?.motion ?? "";
    if (marker) {
      const markerSize = symbolSize / 4;
      const [markerW, markerH] = draw.textsize(marker, { font: fontUi, size: markerSize });
      const gap = Math.max(1, symbolSize * 0.04);
      let markerRadius = ringset.rRetr;
      let markerPt = polar(center, markerRadius, lon + shift, asc);
      let markerX = markerPt[0] - markerW / 2;
      let markerY = markerPt[1] - markerH / 2;
      const direction = ringset.rRetr <= ringset.rPlanet ? -1 : 1;
      const glyphBounds: Bounds = {
        x: pt[0] - glyphSize / 2 - gap,
        y: pt[1] - glyphSize / 2 - gap,
        w: glyphSize + gap * 2,
        h: glyphSize + gap * 2,
      };
      const collides = (x: number, y: number, bounds: Bounds[]) =>
        bounds.some((box) => overlap(x, y, markerW, markerH, box.x, box.y, box.w, box.h));

      let nudge = 0;
      while (nudge < symbolSize && collides(markerX, markerY, [glyphBounds])) {
        markerRadius += direction;
        markerPt = polar(center, markerRadius, lon + shift, asc);
        markerX = markerPt[0] - markerW / 2;
        markerY = markerPt[1] - markerH / 2;
        nudge += 1;
      }

      const protectedBounds = [glyphBounds, ...positionBounds];
      if (collides(markerX, markerY, protectedBounds)) {
        const radialX = (markerPt[0] - center[0]) / Math.max(1, markerRadius);
        const radialY = (markerPt[1] - center[1]) / Math.max(1, markerRadius);
        const tangentX = -radialY;
        const tangentY = radialX;
        for (let sideNudge = 1; sideNudge <= symbolSize * 2; sideNudge += 1) {
          const sides = [sideNudge, -sideNudge];
          const clearSide = sides.find((side) =>
            !collides(markerX + tangentX * side, markerY + tangentY * side, protectedBounds));
          if (clearSide != null) {
            markerX += tangentX * clearSide;
            markerY += tangentY * clearSide;
            break;
          }
        }
      }

      draw.text([markerX, markerY], marker, {
        fill: bodyColor(chart, planets, key, palette),
        font: fontUi,
        size: markerSize,
      });
    }
  }
}

function drawAscMCPos(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  fontUi: string,
  fontSymbols: string,
  symbolSize: number,
  shifts: Map<LayoutKey, number>,
  style: WheelRenderStyle,
) {
  const angleEntries: Array<
    [AngleLayoutKey, "AC" | "MC", number, { degText: string; minText: string } | undefined]
  > = [
    ["__asc", "AC", chart.angles.asc, chart.angles.ascDegMin],
    ["__mc", "MC", chart.angles.mc, chart.angles.mcDegMin],
  ];
  for (const [layoutKey, angleLabel, lon, degMin] of angleEntries) {
    if (!degMin) {
      continue;
    }
    if (isAngloWheel(chart)) {
      const hasFloatingLabel = shifts.has(layoutKey);
      if (!hasFloatingLabel && chart.options.showHouses) continue;
      const shift = shifts.get(layoutKey) ?? 0;
      if (hasFloatingLabel) {
        const shiftedLon = lon + shift;
        const labelPt = polar(center, ringset.rPlanet, shiftedLon, asc);
        const labelSize = layoutGlyphSize(layoutKey, symbolSize, style);
        const labelWeight = style.typography.ratios.angleLabelWeight;
        const [labelWidth, labelHeight] = draw.textsize(angleLabel, {
          font: fontUi,
          size: labelSize,
          weight: labelWeight,
        });
        draw.text([labelPt[0] - labelWidth / 2, labelPt[1] - labelHeight / 2], angleLabel, {
          fill: palette.angles,
          font: fontUi,
          size: labelSize,
          weight: labelWeight,
        });
      }
      drawAngloLongitudeRun(
        draw,
        center,
        ringset.rPosHouses,
        lon,
        asc,
        degMin.degText,
        degMin.minText,
        chart,
        palette,
        fontUi,
        fontSymbols,
        symbolSize,
      );
    } else if (isCompactWheel(chart) && ringset.rPosHousesMin) {
      drawDegMinStack(
        draw,
        center,
        ringset.rPosHouses,
        ringset.rPosHousesMin,
        lon,
        asc,
        0,
        degMin.degText,
        degMin.minText,
        palette,
        fontUi,
        symbolSize,
      );
    } else {
      const pt = polar(center, ringset.rPosAscMC, lon, asc);
      drawDegMinPair(draw, pt[0], pt[1], degMin.degText, degMin.minText, palette, fontUi, symbolSize);
    }
  }
}

function drawHousePos(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  fontUi: string,
  symbolSize: number,
) {
  const skipAsc = sameLongitude(chart.houses.cusps[0], chart.angles.asc);
  const skipMc = sameLongitude(chart.houses.cusps[9], chart.angles.mc);
  const houseIndices = isAngloWheel(chart)
    ? Array.from({ length: 12 }, (_, index) => index)
    : [0, 1, 2, 9, 10, 11];
  for (const houseIndex of houseIndices) {
    // Anglo quadrant charts put AC/MC on cusps 1/10; those cusp runs belong in
    // the middle annulus and replace the floating angle labels. Other themes
    // retain their established dedicated-angle labels.
    if (
      !isAngloWheel(chart) &&
      ((skipAsc && houseIndex === 0) || (skipMc && houseIndex === 9))
    ) {
      continue;
    }
    const lon = chart.houses.cusps[houseIndex];
    const degMin = chart.houses.cuspDegMin?.[houseIndex];
    if (!degMin) {
      continue;
    }
    if (isAngloWheel(chart)) {
      drawAngloLongitudeRun(
        draw,
        center,
        ringset.rPosHouses,
        lon,
        asc,
        degMin.degText,
        degMin.minText,
        chart,
        palette,
        fontUi,
        '"AriesMorinus"',
        symbolSize,
      );
    } else if (isCompactWheel(chart) && ringset.rPosHousesMin) {
      drawDegMinStack(
        draw,
        center,
        ringset.rPosHouses,
        ringset.rPosHousesMin,
        lon,
        asc,
        0,
        degMin.degText,
        degMin.minText,
        palette,
        fontUi,
        symbolSize,
      );
    } else {
      const pt = polar(center, ringset.rPosHouses, lon, asc);
      drawDegMinPair(draw, pt[0], pt[1], degMin.degText, degMin.minText, palette, fontUi, symbolSize);
    }
  }
}

function drawOuterHouses(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
) {
  if (!ringset.rOuterMax) {
    return;
  }
  for (let i = 0; i < 12; i++) {
    const cusp = chart.houses.cusps[i];
    const p1 = polar(
      center,
      isAngloWheel(chart) ? ringset.rOuterHouse ?? ringset.r30 : ringset.r30,
      cusp,
      asc,
    );
    const p2 = polar(center, ringset.rOuterMax, cusp, asc);
    draw.line([p1, p2], { fill: palette.houses, width: 1 });
  }
}

function drawOuterAscMC(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  chartSize: number,
  palette: ChartPalette,
  style: WheelRenderStyle,
) {
  if (!ringset.rOuterASCMC || !ringset.rOuterMin || !ringset.rOuterArrow) {
    return;
  }
  if (isAngloWheel(chart)) {
    return;
  }
  const width = isAngloWheel(chart)
    ? Math.min(2, ascmcPenWidth(style, chart, chartSize))
    : ascmcPenWidth(style, chart, chartSize);
  const lons = [chart.angles.asc, chart.angles.dsc, chart.angles.mc, chart.angles.ic];
  for (let idx = 0; idx < lons.length; idx += 1) {
    const lon = lons[idx];
    const p1 = polar(center, ringset.rOuterMin, lon, asc);
    const p2 = polar(center, idx === 1 || idx === 3 ? ringset.rOuterArrow : ringset.rOuterASCMC, lon, asc);
    draw.line([p1, p2], { fill: palette.angles, width });
  }
  if (angleArrowheadsVisible(chart)) {
    drawArrow(draw, center, { ...ringset, rASCMC: ringset.rOuterASCMC, rArrow: ringset.rOuterArrow } as RingSet, asc, chart.angles.asc, palette.angles, width);
    drawArrow(draw, center, { ...ringset, rASCMC: ringset.rOuterASCMC, rArrow: ringset.rOuterArrow } as RingSet, asc, chart.angles.mc, palette.angles, width);
  }
}

function uniqueByLongitude(items: Array<{ longitude: number }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.longitude.toFixed(6);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function drawInterChartAspectMarkers(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  comparisonChart: Chart,
  interChartAspects: InterChartAspect[],
  chartSize: number,
  palette: ChartPalette,
  style: WheelRenderStyle,
) {
  const comparisonPlanets = planetById(comparisonChart);
  const markerItems = uniqueByLongitude(
    interChartAspects
      .map((aspect) => {
        const longitude = aspectEndpointLongitude(comparisonChart, comparisonPlanets, aspect.outer);
        return longitude == null ? null : { longitude };
      })
      .filter((item): item is { longitude: number } => item != null),
  );
  for (const item of markerItems) {
    const anglo = isAngloWheel(comparisonChart);
    draw.line(
      [
        polar(center, ringset.rAsp, item.longitude, asc),
        polar(center, ringset.rLLine2, item.longitude, asc),
      ],
      { fill: anglo ? palette.angles : palette.frame, width: anglo ? 2 : mediumPenWidth(style, chartSize) },
    );
  }
}

function drawInterChartAspectLines(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  primaryChart: Chart,
  comparisonChart: Chart,
  interChartAspects: InterChartAspect[],
  palette: ChartPalette,
) {
  const primaryPlanets = planetById(primaryChart);
  const comparisonPlanets = planetById(comparisonChart);
  for (const aspect of interChartAspects) {
    const p1 = aspectEndpoint(primaryChart, primaryPlanets, center, ringset, asc, aspect.inner);
    const p2 = aspectEndpoint(comparisonChart, comparisonPlanets, center, ringset, asc, aspect.outer);
    if (!p1 || !p2) {
      continue;
    }
    draw.line(
      [p1, p2],
      aspectLineStyle(primaryChart, palette, aspect),
    );
  }
}

function drawInterChartAspectSymbols(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  primaryChart: Chart,
  comparisonChart: Chart,
  interChartAspects: InterChartAspect[],
  palette: ChartPalette,
  fontSymbols: string,
  symbolSize: number,
) {
  const primaryPlanets = planetById(primaryChart);
  const comparisonPlanets = planetById(comparisonChart);
  const fontSize = symbolSize / 2;
  for (const aspect of interChartAspects) {
    const glyph = aspectGlyph(aspect.type);
    if (!glyph) {
      continue;
    }
    const p1 = aspectEndpoint(primaryChart, primaryPlanets, center, ringset, asc, aspect.inner);
    const p2 = aspectEndpoint(comparisonChart, comparisonPlanets, center, ringset, asc, aspect.outer);
    if (!p1 || !p2) {
      continue;
    }
    draw.text(
      [
        (p1[0] + p2[0]) / 2 - symbolSize / 4,
        (p1[1] + p2[1]) / 2 - symbolSize / 4,
      ],
      glyph,
      {
        fill: palette.aspects[aspect.type] ?? palette.frame,
        font: fontSymbols,
        size: fontSize,
      },
    );
  }
}

function buildOuterItemLabel(
  item: OuterRingItem,
  chart: Chart,
  palette: ChartPalette,
): Array<{ text: string; font: "ui" | "symbols"; color: string }> {
  if (!item.segments?.length) {
    return [{ text: item.label, font: "ui", color: palette.textDim }];
  }
  return item.segments.map((segment) => {
    if (segment.kind === "glyph") {
      return { text: segment.text, font: "symbols" as const, color: segment.color ?? palette.textDim };
    }
    if (segment.kind !== "planet" || segment.seId == null) {
      return { text: segment.text, font: "ui" as const, color: segment.color ?? palette.textDim };
    }
    // Daemon-resolved per-body color when the body is present in the chart;
    // otherwise the indexed palette color for that SE id.
    const resolved = chart.planets.find((planet) => planet.seId === segment.seId)?.color;
    return {
      text: segment.text,
      font: "symbols" as const,
      color: segment.color ?? resolved ?? palette.planets[segment.seId] ?? palette.textDim,
    };
  });
}

function labelRunsBounds(
  draw: TextMeasurer,
  runs: Array<{ text: string; font: "ui" | "symbols"; color: string }>,
  fontUi: string,
  fontSymbols: string,
  fontSize: number,
): Pt {
  const fallbackHeight = draw.textsize("Ag", { font: fontUi, size: fontSize })[1];
  let width = 0;
  let height = fallbackHeight;
  for (const run of runs) {
    const [runWidth, runHeight] = draw.textsize(run.text, {
      font: run.font === "symbols" ? fontSymbols : fontUi,
      size: fontSize,
    });
    width += runWidth;
    height = Math.max(height, runHeight);
  }
  return [width, height];
}

function outerRingItemFontSize(item: OuterRingItem, symbolSize: number, labelFontSize: number): number {
  // graphchart.drawAntis draws antiscia / contra-antiscia / dodecatemoria
  // projected glyphs with fntMorinus/fntAntisText at full symbolSize
  // (graphchart.py:437-449, 4619-4691), unlike fixed-star/AP text labels
  // which use fntText at symbolSize / 2.
  return PROJECTED_GLYPH_FAMILIES.has(item.family) || OUTER_BODY_GLYPH_FAMILIES.has(item.family)
    ? symbolSize
    : labelFontSize;
}

function outerRingItemLabelRadius(item: OuterRingItem, ringset: RingSet, symbolSize: number): number {
  if (OUTER_BODY_GLYPH_FAMILIES.has(item.family)) {
    return ringset.rOuterPlanet ?? ringset.rAntis ?? ringset.rOuterLine + symbolSize * 0.2;
  }
  // wx projected glyph rings sit at rAntis, with tick lines ending at
  // rAntisLines (0.90 / 0.86 maxradius; graphchart.py:144-145, 1397-1408).
  if (PROJECTED_GLYPH_FAMILIES.has(item.family)) {
    return ringset.rAntis ?? ringset.rOuterLine + symbolSize * 0.2;
  }
  return ringset.rOuterLine + symbolSize * 0.2;
}

// Port of graphchart.py:_ellipsize_text_to_width (commit dcae93d). Returns
// the longest prefix of `text` that, with a trailing "..." marker, fits
// within `maxWidth`. Binary-searches the cut point. Falls back to 2 or 1
// dots if even "..." doesn't fit. Returns "" if nothing fits.
function ellipsizeTextToWidth(
  draw: TextMeasurer,
  text: string,
  font: string,
  size: number,
  maxWidth: number,
): string {
  const t = text ?? "";
  if (maxWidth <= 0) return "";
  if (draw.textsize(t, { font, size })[0] <= maxWidth) return t;
  const marker = "...";
  if (draw.textsize(marker, { font, size })[0] > maxWidth) {
    for (const count of [2, 1]) {
      const dots = ".".repeat(count);
      if (draw.textsize(dots, { font, size })[0] <= maxWidth) return dots;
    }
    return "";
  }
  let lo = 0;
  let hi = t.length;
  let best = marker;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = t.slice(0, mid).trimEnd() + marker;
    if (draw.textsize(candidate, { font, size })[0] <= maxWidth) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

// Port of graphchart.py:_fit_outer_word_label_to_bitmap. Given the laid-out
// runs for an outer-ring label and the canvas width, decide whether the
// label overflows the canvas edges; if so, collapse the runs into a single
// truncated UI-font run with a "..." marker that fits the available width.
// Multi-segment formatting (planet glyphs + text) is sacrificed when the
// label must be ellipsized; matches wx's whole-label fallback.
function fitOuterLabelToBitmap(
  draw: TextMeasurer,
  runs: Array<{ text: string; font: "ui" | "symbols"; color: string }>,
  x: number,
  totalWidth: number,
  textHeight: number,
  canvasWidth: number,
  symbolSize: number,
  fontUi: string,
  fontSize: number,
  palette: ChartPalette,
  style: WheelRenderStyle,
): {
  runs: Array<{ text: string; font: "ui" | "symbols"; color: string }>;
  x: number;
  w: number;
  h: number;
} {
  const pad = Math.max(0, Math.round(symbolSize * style.outerLabels.edgePadFactor));
  const left = pad;
  const right = Math.max(left, canvasWidth - pad);
  const labelRight = x + totalWidth;
  if (x >= left && labelRight <= right) {
    return { runs, x, w: totalWidth, h: textHeight };
  }
  const combined = runs.map((r) => r.text).join("");
  let maxWidth: number;
  let mode: "both" | "leftOnly" | "rightOnly";
  if (x < left && labelRight > right) {
    maxWidth = right - left;
    mode = "both";
  } else if (x < left) {
    maxWidth = labelRight - left;
    mode = "leftOnly";
  } else {
    maxWidth = right - x;
    mode = "rightOnly";
  }
  const fitted = ellipsizeTextToWidth(draw, combined, fontUi, fontSize, maxWidth);
  const fw = fitted ? draw.textsize(fitted, { font: fontUi, size: fontSize })[0] : 0;
  const newRuns = fitted
    ? [{ text: fitted, font: "ui" as const, color: palette.textDim }]
    : [];
  let newX = x;
  if (mode === "both") newX = left;
  else if (mode === "leftOnly") newX = labelRight - fw;
  return { runs: newRuns, x: newX, w: fw, h: textHeight };
}

function prepareOuterRingItems(
  draw: TextMeasurer,
  center: Pt,
  outerLineRadius: number,
  asc: number,
  items: OuterRingItem[],
  labelRadius: number,
  projectedLabelRadius: number,
  fontUi: string,
  fontSymbols: string,
  labelFontSize: number,
  symbolSize: number,
  chart: Chart,
  palette: ChartPalette,
) {
  const ordered = items.slice().sort((a, b) => a.longitude - b.longitude);
  const shifts = ordered.map(() => 0);
  const yOffsets = ordered.map(() => 0);
  const count = ordered.length;
  if (count < 2) {
    return { items: ordered, shifts, yOffsets };
  }

  const labelBox = (idx: number, yOffset = 0) => {
    const item = ordered[idx];
    const lon = item.longitude + shifts[idx];
    const itemFontSize = outerRingItemFontSize(item, symbolSize, labelFontSize);
    const itemLabelRadius = PROJECTED_GLYPH_FAMILIES.has(item.family) || OUTER_BODY_GLYPH_FAMILIES.has(item.family)
      ? projectedLabelRadius
      : labelRadius;
    const pt = polar(center, itemLabelRadius, lon, asc);
    const rad = Math.PI + ((asc - lon) * Math.PI) / 180;
    const runs = buildOuterItemLabel(item, chart, palette);
    const [w, h] = labelRunsBounds(draw, runs, fontUi, fontSymbols, itemFontSize);
    let x = pt[0];
    let y = pt[1] + yOffset;
    const pos = normalize(180 + asc - lon);
    if (pos > 90 && pos < 270) {
      x -= w;
    }
    [x, y] = ensureTextOutsideOuterWheel(
      center,
      outerLineRadius,
      rad,
      x,
      y,
      w,
      h,
      itemLabelRadius,
      Math.round(symbolSize * 0.1),
    );
    return { x, y, w, h };
  };

  const doShift = (leftIdx: number, rightIdx: number, forward = false): boolean => {
    let shifted = false;
    let left = labelBox(leftIdx);
    let right = labelBox(rightIdx);
    while (overlap(left.x, left.y - left.h / 2, left.w, left.h, right.x, right.y - right.h / 2, right.w, right.h)) {
      if (!forward) {
        shifts[leftIdx] -= 0.1;
      }
      shifts[rightIdx] += 0.1;
      left = labelBox(leftIdx);
      right = labelBox(rightIdx);
      shifted = true;
    }
    return shifted;
  };

  for (let pass = 0; pass < count + 1; pass += 1) {
    let shifted = false;
    for (let i = 0; i < count - 1; i += 1) {
      shifted = doShift(i, i + 1) || shifted;
    }
    if (!shifted) {
      break;
    }
  }

  for (let pass = 0; pass < count; pass += 1) {
    let changed = false;
    for (let i = 0; i < count - 1; i += 1) {
      const left = labelBox(i, yOffsets[i]);
      const right = labelBox(i + 1, yOffsets[i + 1]);
      while (overlap(left.x, left.y - left.h / 2, left.w, left.h, right.x, right.y - right.h / 2, right.w, right.h)) {
        yOffsets[i] += left.y > center[1] ? 1 : -1;
        yOffsets[i + 1] += right.y > center[1] ? 1 : -1;
        changed = true;
        break;
      }
    }
    if (!changed) {
      break;
    }
  }

  return { items: ordered, shifts, yOffsets };
}

function drawOuterRingItemLines(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  layout: ReturnType<typeof prepareOuterRingItems>,
  chart: Chart,
  chartSize: number,
  palette: ChartPalette,
  style: WheelRenderStyle,
) {
  for (let i = 0; i < layout.items.length; i += 1) {
    const item = layout.items[i];
    const outerLine = PROJECTED_GLYPH_FAMILIES.has(item.family)
      ? ringset.rAntisLines ?? ringset.rOuterLine
      : ringset.rOuterLine;
    draw.line(
      [
        polar(center, ringset.r30, item.longitude, asc),
        polar(center, outerLine, item.longitude + layout.shifts[i], asc),
      ],
      { fill: palette.frame, width: isAngloWheel(chart) ? 1 : mediumPenWidth(style, chartSize) },
    );
  }
}

function drawOuterRingItems(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  layout: ReturnType<typeof prepareOuterRingItems>,
  chart: Chart,
  palette: ChartPalette,
  fontUi: string,
  fontSymbols: string,
  fontSize: number,
  symbolSize: number,
  canvasWidth: number,
  style: WheelRenderStyle,
) {
  for (let i = 0; i < layout.items.length; i += 1) {
    const item = layout.items[i];
    const labelRadius = outerRingItemLabelRadius(item, ringset, symbolSize);
    const itemFontSize = outerRingItemFontSize(item, symbolSize, fontSize);
    let runs = buildOuterItemLabel(item, chart, palette);
    let [w, h] = labelRunsBounds(draw, runs, fontUi, fontSymbols, itemFontSize);
    const shiftedLon = item.longitude + layout.shifts[i];
    const pt = polar(center, labelRadius, shiftedLon, asc);
    const rad = Math.PI + ((asc - shiftedLon) * Math.PI) / 180;
    let x = pt[0];
    let y = pt[1] + layout.yOffsets[i];
    const pos = normalize((rad * 180) / Math.PI);
    if (pos > 90 && pos < 270) {
      x -= w;
    }
    if (item.fitPolicy !== "none") {
      const fit = fitOuterLabelToBitmap(
        draw, runs, x, w, h, canvasWidth, symbolSize, fontUi, itemFontSize, palette, style,
      );
      runs = fit.runs;
      x = fit.x;
      w = fit.w;
      h = fit.h;
    }
    if (!runs.length) {
      continue;
    }
    [x, y] = ensureTextOutsideOuterWheel(
      center,
      ringset.rOuterLine,
      rad,
      x,
      y,
      w,
      h,
      labelRadius,
      Math.round(symbolSize * 0.1),
    );
    let cursor = x;
    const yBase = y - h / 2;
    const firstRunColor = runs[0]?.color ?? palette.textDim;
    for (const run of runs) {
      const [runWidth, runHeight] = draw.textsize(run.text, {
        font: run.font === "symbols" ? fontSymbols : fontUi,
        size: itemFontSize,
      });
      draw.text([cursor, yBase + (h - runHeight) / 2], run.text, {
        fill: run.color,
        font: run.font === "symbols" ? fontSymbols : fontUi,
        size: itemFontSize,
      });
      cursor += runWidth;
    }
    if (OUTER_BODY_GLYPH_FAMILIES.has(item.family) && item.motion) {
      const markerRadius = ringset.rOuterRetr ?? ringset.rOuterLine + symbolSize * 0.16;
      const markerPt = polar(center, markerRadius, shiftedLon, asc);
      draw.text([markerPt[0] - symbolSize / 8, markerPt[1] - symbolSize / 8], item.motion, {
        fill: firstRunColor,
        font: fontUi,
        size: symbolSize / 4,
      });
    }
  }
}

// Port of graphchart.drawSurveilMarks (graphchart.py:5822). Renders each global
// Surveil study mark as a radial tick spanning the wheel edge to just outside
// the outer line, then the captured point's glyph/label (+ optional source name
// in parentheses) outside the tick. Color is the warm surveil accent. Marks are
// drawn on top of everything in the outer-label layer. The surveil SET itself is
// owned by the desktop study store and not yet exposed by the daemon, so this is
// inert until chart.surveilMarks is populated.
function drawSurveilMarks(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  marks: SurveilMark[],
  palette: ChartPalette,
  fontUi: string,
  fontSymbols: string,
  symbolSize: number,
) {
  if (!marks.length) {
    return;
  }
  const accent = palette.surveilAccent ?? "rgb(229,146,70)";
  const rWheel = ringset.r30;
  const rOuter = ringset.rOuterLine;
  const tickLen = Math.max(5, Math.round(symbolSize * 0.42));
  const rTickEnd = Math.max(rOuter, rWheel + tickLen);
  const glyphGap = Math.max(2, Math.round(symbolSize * 0.12));
  // wx uses symbolSize*0.34*_dpi_scale; the web symbolSize (maxRadius/16) is the
  // same base wx uses, so no extra DPI factor is applied here.
  const glyphSize = Math.max(5, Math.round(symbolSize * 0.34));
  const labelGap = Math.max(2, Math.round(symbolSize * 0.08));

  for (const mark of marks) {
    const lon = mark.longitude;
    if (!Number.isFinite(lon)) {
      continue;
    }
    // Web polar() puts ASC at left with Y flipped vs wx; the cos/sin below use
    // the same wx-space angle (pi + (asc - lon)) so left/right placement of the
    // label matches graphchart.drawSurveilMarks exactly.
    const ang = Math.PI + ((asc - lon) * Math.PI) / 180;
    const cosA = Math.cos(ang);

    draw.line(
      [polar(center, rWheel, lon, asc), polar(center, rTickEnd, lon, asc)],
      { fill: accent, width: 1 },
    );

    let markerText = (mark.glyph ?? "").trim();
    let markerFont = mark.glyphFont === "morinus" ? fontSymbols : fontUi;
    if (!markerText) {
      markerText = ((mark.label ?? "").split(" (", 1)[0] || "").trim() || "Marker";
      markerFont = fontUi;
    }
    if (markerText.length > 18) {
      markerText = `${markerText.slice(0, 17)}...`;
    }
    let sourceName = (mark.sourceName ?? "").trim();
    if (sourceName.length > 18) {
      sourceName = `${sourceName.slice(0, 17)}...`;
    }
    const sourceText = sourceName ? ` (${sourceName})` : "";

    const [gw, gh] = draw.textsize(markerText, { font: markerFont, size: glyphSize });
    const [tw, th] = sourceText
      ? draw.textsize(sourceText, { font: fontUi, size: glyphSize })
      : [0, 0];
    const totalW = gw + (sourceText ? labelGap : 0) + tw;
    const totalH = Math.max(gh, th);

    const rLabel = rTickEnd + glyphGap;
    const anchor = polar(center, rLabel, lon, asc);
    let left: number;
    if (cosA > 0.25) {
      left = anchor[0];
    } else if (cosA < -0.25) {
      left = anchor[0] - totalW;
    } else {
      left = anchor[0] - totalW / 2;
    }
    const top = anchor[1] - totalH / 2;
    const markerTop = top + (totalH - gh) / 2;
    draw.text([left, markerTop], markerText, { fill: accent, font: markerFont, size: glyphSize });
    if (sourceText) {
      const textTop = top + (totalH - th) / 2;
      draw.text([left + gw + labelGap, textTop], sourceText, {
        fill: accent,
        font: fontUi,
        size: glyphSize,
      });
    }
  }
}

function prepareFixedStars(
  draw: TextMeasurer,
  center: Pt,
  outerLineRadius: number,
  asc: number,
  stars: FixedStar[],
  labelRadius: number,
  fontUi: string,
  fontSize: number,
): { stars: FixedStar[]; shifts: number[]; yOffsets: number[] } {
  const ordered = stars.slice().sort((a, b) => a.longitude - b.longitude);
  const shifts = ordered.map(() => 0);
  const yOffsets = ordered.map(() => 0);
  const count = ordered.length;
  if (count < 2) {
    return { stars: ordered, shifts, yOffsets };
  }

  const labelBox = (idx: number, yOffset = 0) => {
    const star = ordered[idx];
    const lon = star.longitude + shifts[idx];
    const pt = polar(center, labelRadius, lon, asc);
    const label = buildFixedStarLabel(star);
    const [w, h] = draw.textsize(label, { font: fontUi, size: fontSize });
    let x = pt[0];
    const y = pt[1] + yOffset;
    const pos = normalize(180 + asc - lon);
    if (pos > 90 && pos < 270) {
      x -= w;
    }
    return { x, y, w, h, pos };
  };

  const doShift = (leftIdx: number, rightIdx: number, forward = false): boolean => {
    let shifted = false;
    let left = labelBox(leftIdx);
    let right = labelBox(rightIdx);
    while (overlap(left.x, left.y, left.w, left.h, right.x, right.y, right.w, right.h)) {
      if (!forward) {
        shifts[leftIdx] -= 0.1;
      }
      shifts[rightIdx] += 0.1;
      left = labelBox(leftIdx);
      right = labelBox(rightIdx);
      shifted = true;
    }
    return shifted;
  };

  const doArrange = (forward = false) => {
    let shifted = false;
    for (let i = 0; i < count - 1; i++) {
      shifted = doShift(i, i + 1, forward) || shifted;
    }
    if (shifted) {
      doArrange(forward);
    }
  };

  for (let i = 0; i < count + 1; i++) {
    doArrange(false);
  }

  const wrapped = doShift(count - 1, 0, true);
  if (wrapped) {
    for (let i = 0; i < count; i++) {
      doArrange(true);
    }
  } else if (ordered[count - 1].longitude > 300 && ordered[0].longitude < 60) {
    const lastLon = ordered[count - 1].longitude + shifts[count - 1];
    const firstLon = ordered[0].longitude + 360 + shifts[0];
    if (lastLon > firstLon) {
      const distance = lastLon - firstLon;
      shifts[0] += distance;
      doShift(count - 1, 0, true);
      for (let i = 0; i < count - 1; i++) {
        const lon1 = ordered[i].longitude + shifts[i];
        const lon2 = ordered[i + 1].longitude + shifts[i + 1];
        if (lon1 < 180 && lon2 < 180) {
          if (lon1 > lon2) {
            shifts[i + 1] += lon1 - lon2;
            doShift(i, i + 1, true);
          } else {
            break;
          }
        } else {
          break;
        }
      }
      for (let i = 0; i < count; i++) {
        doArrange(true);
      }
    }
  }

  for (let pass = 0; pass < count; pass++) {
    let changed = false;
    for (let i = 0; i < count - 1; i++) {
      let left = labelBox(i, yOffsets[i]);
      let right = labelBox(i + 1, yOffsets[i + 1]);
      while (overlap(left.x, left.y, left.w, left.h, right.x, right.y, right.w, right.h)) {
        if (left.pos > 65 && left.pos < 245) {
          yOffsets[i + 1] += 1;
        } else {
          yOffsets[i + 1] -= 1;
        }
        right = labelBox(i + 1, yOffsets[i + 1]);
        left = labelBox(i, yOffsets[i]);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  return { stars: ordered, shifts, yOffsets };
}

function outerItemsKey(items: OuterRingItem[]): string {
  if (!items.length) return "0";
  const first = items[0];
  const last = items[items.length - 1];
  return [
    items.length,
    first.family,
    first.id,
    cacheNumber(first.longitude),
    last.family,
    last.id,
    cacheNumber(last.longitude),
  ].join(":");
}

function getOuterRingItemLayout(
  draw: TextMeasurer,
  snapshot: ChartRenderSnapshot,
  center: Pt,
  ringset: RingSet,
  asc: number,
  activeOuterItems: OuterRingItem[],
  fontUi: string,
  fontSymbols: string,
  symbolSize: number,
  outerItemsChart: Chart,
  palette: ChartPalette,
): ReturnType<typeof prepareOuterRingItems> {
  const key = [
    snapshot.outerRingMode,
    outerItemsKey(activeOuterItems),
    cachePoint(center),
    cacheNumber(asc),
    cacheNumber(ringset.rOuterLine),
    cacheNumber(ringset.rAntis ?? 0),
    fontUi,
    fontSymbols,
    cacheNumber(symbolSize),
  ].join("|");
  let snapshotCache = outerItemLayoutCache.get(snapshot);
  if (!snapshotCache) {
    snapshotCache = new Map();
    outerItemLayoutCache.set(snapshot, snapshotCache);
  }
  const cached = snapshotCache.get(key);
  if (cached) return cached;
  const layout = prepareOuterRingItems(
    draw,
    center,
    ringset.rOuterLine,
    asc,
    activeOuterItems,
    ringset.rOuterLine + symbolSize * 0.2,
    ringset.rAntis ?? ringset.rOuterLine + symbolSize * 0.2,
    fontUi,
    fontSymbols,
    symbolSize / 2,
    symbolSize,
    outerItemsChart,
    palette,
  );
  boundedMapSet(snapshotCache, key, layout);
  return layout;
}

function getFixedStarLayout(
  draw: TextMeasurer,
  chart: Chart,
  center: Pt,
  ringset: RingSet,
  asc: number,
  fontUi: string,
  symbolSize: number,
): ReturnType<typeof prepareFixedStars> {
  const stars = chart.fixedStars ?? [];
  const key = [
    stars.length,
    cachePoint(center),
    cacheNumber(asc),
    cacheNumber(ringset.rOuterLine),
    fontUi,
    cacheNumber(symbolSize),
  ].join("|");
  let chartCache = fixedStarLayoutCache.get(chart);
  if (!chartCache) {
    chartCache = new Map();
    fixedStarLayoutCache.set(chart, chartCache);
  }
  const cached = chartCache.get(key);
  if (cached) return cached;
  const layout = prepareFixedStars(
    draw,
    center,
    ringset.rOuterLine,
    asc,
    stars,
    ringset.rOuterLine + symbolSize * 0.2,
    fontUi,
    symbolSize / 2,
  );
  boundedMapSet(chartCache, key, layout);
  return layout;
}

function drawFixstarLines(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  chartSize: number,
  fixedStarLayout: { stars: FixedStar[]; shifts: number[] },
  palette: ChartPalette,
  style: WheelRenderStyle,
) {
  const width = isAngloWheel(chart) ? 1 : mediumPenWidth(style, chartSize);
  for (let i = 0; i < fixedStarLayout.stars.length; i++) {
    const star = fixedStarLayout.stars[i];
    const p1 = polar(center, ringset.r30, star.longitude, asc);
    const p2 = polar(center, ringset.rOuterLine, star.longitude + fixedStarLayout.shifts[i], asc);
    draw.line([p1, p2], { fill: palette.frame, width });
  }
}

function drawFixstars(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  fixedStarLayout: { stars: FixedStar[]; shifts: number[]; yOffsets: number[] },
  palette: ChartPalette,
  fontUi: string,
  fontSize: number,
  symbolSize: number,
) {
  let labelRadius = ringset.rOuterLine + symbolSize * 0.2;
  for (let i = 0; i < fixedStarLayout.stars.length; i++) {
    const star = fixedStarLayout.stars[i];
    const shift = fixedStarLayout.shifts[i];
    const label = buildFixedStarLabel(star);
    const [w, h] = draw.textsize(label, { font: fontUi, size: fontSize });
    const shiftedLon = star.longitude + shift;
    const pt = polar(center, labelRadius, shiftedLon, asc);
    const rad = Math.PI + ((asc - shiftedLon) * Math.PI) / 180;
    let x = pt[0];
    let y = pt[1] + fixedStarLayout.yOffsets[i];
    const pos = normalize((rad * 180) / Math.PI);
    if (pos > 90 && pos < 270) {
      x -= w;
    }
    [x, y, labelRadius] = ensureTextOutsideOuterWheel(
      center,
      ringset.rOuterLine,
      rad,
      x,
      y,
      w,
      h,
      labelRadius,
      Math.round(symbolSize * 0.1),
    );
    draw.text([x, y - h / 2], label, {
      fill: palette.textDim,
      font: fontUi,
      size: fontSize,
    });
  }
}

function getActiveOuterItems(snapshot: ChartRenderSnapshot): OuterRingItem[] {
  if (snapshot.outerRingMode === "none") {
    return [];
  }
  return snapshot.outerRingItems?.[snapshot.outerRingMode] ?? [];
}

function visibleOuterItems(snapshot: ChartRenderSnapshot): OuterRingItem[] {
  const items = getActiveOuterItems(snapshot);
  if (!snapshot.comparisonChart) {
    return items;
  }
  return items.filter((item) => item.role !== "primary");
}

export function drawSnapshotLayer(
  draw: CanvasDraw,
  snapshot: ChartRenderSnapshot,
  layer: DrawLayer,
  opts: DrawOptions,
) {
  const style = resolveDrawStyle(opts);
  applyStyleRevision(wheelStyleRevisionKey(style));
  const chart = snapshot.primaryChart;
  const comparisonChart = snapshot.comparisonChart ?? undefined;
  const { width, height } = opts;
  const palette = style.palette as ChartPalette;
  const chartSize = opts.chartSize ?? Math.min(width, height);
  // Classic/compact preserve the wx maxradius/16 scale; Anglo has its own
  // tighter print-oriented typography profile.
  const maxRadius = chartSize / 2;
  const center: Pt = [Math.floor(width / 2), Math.floor(height / 2)];
  const asc = chart.angles.asc;
  const hasComparison = Boolean(comparisonChart);
  // wx graphchart.drawCircles draws the outer degree ring whenever the
  // secondary-ring mode is enabled (`showfixstars != NONE`), even when that
  // mode currently has no visible objects (graphchart.py:1601-1611, 1721-1735).
  const outerRingModeEnabled = snapshot.outerRingMode !== "none";
  const hasOuterRing = hasComparison || outerRingModeEnabled;
  const showOuterHouseGeometry = comparisonUsesOuterHouses(snapshot, chart);
  const showInterChartAspectFigure = Boolean(
    comparisonChart && (!isAngloWheel(chart) || !showOuterHouseGeometry),
  );
  const ringset: RingSet = hasComparison
    ? comparisonRings(chart, maxRadius, showOuterHouseGeometry)
    : effectiveRings(chart, maxRadius, hasOuterRing);
  const typography = resolveWheelTypographyMetrics(
    style,
    wheelTypographyProfile(chart),
    maxRadius,
  );
  const symbolSize = typography.bodySize;
  const outerSymbolSize = typography.outerSize;
  const smallSymbolSize = typography.subdivisionSize;
  const signSize = typography.signSize;
  const fontSymbols = style.typography.families.symbols;
  const fontUi = style.typography.families.ui;

  draw.clear();
  if (layer === "geometry") {
    draw.fillBackground(palette.background);
    drawCircles(
      draw,
      center,
      ringset,
      chartSize,
      palette,
      asc,
      chart,
      hasOuterRing,
      showOuterHouseGeometry,
      style,
    );
    drawTermsLines(draw, center, ringset, asc, chart, palette);
    drawDecanLines(draw, center, ringset, asc, chart, palette);
    drawAngloCuspRuler(draw, center, ringset, asc, chart, palette);
    if (chart.options.showHouses) {
      drawHouses(draw, center, ringset, asc, chart, palette);
      if (comparisonChart && showOuterHouseGeometry) {
        drawOuterHouses(draw, center, ringset, asc, comparisonChart, palette);
      }
      redrawMainCircles(draw, center, ringset, chartSize, palette, chart, style);
      drawAngloHouseCuspTicks(draw, center, ringset, asc, chart, palette);
      drawHouseNames(draw, center, ringset, asc, chart, palette, fontUi, symbolSize);
      if (comparisonChart && showOuterHouseGeometry && ringset.rOuterHouseName) {
        drawHouseNames(
          draw,
          center,
          { ...ringset, rHouseName: ringset.rOuterHouseName } as RingSet,
          asc,
          comparisonChart,
          palette,
          fontUi,
          outerSymbolSize,
        );
      }
    }
    drawSigns(draw, center, ringset, asc, chart, palette, fontSymbols, signSize);
    drawAscMC(draw, center, ringset, asc, chart, chartSize, palette, style);
    if (comparisonChart) {
      drawOuterAscMC(draw, center, ringset, asc, comparisonChart, chartSize, palette, style);
    }
    return;
  }

  if (layer === "dynamic") {
    const { bodyShifts, labelYoffs } = getBodyLayout(
      draw,
      chart,
      center,
      asc,
      ringset.rPlanet,
      ringset.rPos,
      fontSymbols,
      fontUi,
      symbolSize,
      style,
    );
    const outerBodyShifts = comparisonChart
      ? getBodyShifts(
          draw,
          comparisonChart,
          center,
          asc,
          ringset.rOuterPlanet ?? ringset.rPlanet,
          fontSymbols,
          fontUi,
          outerSymbolSize,
          style,
          isAngloWheel(comparisonChart),
          false,
          true,
          showOuterHouseGeometry,
        )
      : null;
    drawPlanetLines(draw, center, ringset, asc, chart, bodyShifts, chartSize, palette, style);
    drawAngloAngleLabelLines(draw, center, ringset, asc, chart, bodyShifts, palette);
    if (comparisonChart && outerBodyShifts) {
      drawOuterPlanetLines(
        draw,
        center,
        ringset,
        asc,
        comparisonChart,
        outerBodyShifts,
        chartSize,
        palette,
        style,
      );
      drawAngloOuterAngleLines(
        draw,
        center,
        ringset,
        asc,
        comparisonChart,
        outerBodyShifts,
        palette,
      );
    }
    // Click-to-toggle resolution. Single-wheel selection filters the normal
    // aspect matrix. In comparison/biwheel mode, planet selection filters the
    // interchart matrix by inner/outer role; an exported outer-role secondary
    // ring point (`point:outer:*`) draws daemon-computed point↔primary entries.
    const drawAspects = !comparisonChart
      ? resolveAspectsForDraw(chart, opts.clickAspectState)
      : null;
    const drawOuterPointAspects = showInterChartAspectFigure
      ? resolveOuterPointAspectsForDraw(chart, opts.clickAspectState)
      : undefined;
    const drawInterChartAspects = showInterChartAspectFigure
      ? resolveInterChartAspectsForDraw(
          chart,
          snapshot.interChartAspects ?? [],
          snapshot.interChartBodyAspects,
          opts.clickAspectState,
        )
      : [];
    if (chart.options.showAspects) {
      if (comparisonChart && showInterChartAspectFigure) {
        if (drawOuterPointAspects !== undefined) {
          drawAspectLines(draw, center, ringset, asc, chart, palette, drawOuterPointAspects);
        } else {
          drawInterChartAspectMarkers(draw, center, ringset, asc, comparisonChart, drawInterChartAspects, chartSize, palette, style);
          drawInterChartAspectLines(draw, center, ringset, asc, chart, comparisonChart, drawInterChartAspects, palette);
        }
      } else if (drawAspects) {
        drawAspectLines(draw, center, ringset, asc, chart, palette, drawAspects);
      }
    }
    if (hasOuterRing) {
      const activeOuterItems = visibleOuterItems(snapshot);
      if (activeOuterItems.length) {
        const outerItemsChart = comparisonChart ?? chart;
        const outerItemLayout = getOuterRingItemLayout(
          draw,
          snapshot,
          center,
          ringset,
          asc,
          activeOuterItems,
          fontUi,
          fontSymbols,
          outerSymbolSize,
          outerItemsChart,
          palette,
        );
        drawOuterRingItemLines(draw, center, ringset, asc, outerItemLayout, chart, chartSize, palette, style);
      } else {
        const fixedStarLayout = getFixedStarLayout(
          draw,
          chart,
          center,
          ringset,
          asc,
          fontUi,
          outerSymbolSize,
        );
        drawFixstarLines(draw, center, ringset, asc, chart, chartSize, fixedStarLayout, palette, style);
      }
    }

    drawPlanets(draw, center, ringset, asc, chart, bodyShifts, labelYoffs, palette, fontSymbols, fontUi, symbolSize, style);
    if (comparisonChart && outerBodyShifts) {
      // Outer ring skips the radial label stagger (graphchart.py: `if outer: return`).
      drawPlanets(
        draw,
        center,
        {
          ...ringset,
          rPlanet: ringset.rOuterPlanet ?? ringset.rPlanet,
          rRetr: ringset.rOuterRetr ?? ringset.rRetr,
          rPos: ringset.rOuterPlanet ?? ringset.rPlanet,
        } as RingSet,
        asc,
        comparisonChart,
        outerBodyShifts,
        new Map<LayoutKey, number>(),
        palette,
        fontSymbols,
        fontUi,
        outerSymbolSize,
        style,
        true,
      );
      drawAngloOuterAngleLabels(
        draw,
        center,
        ringset,
        asc,
        comparisonChart,
        outerBodyShifts,
        palette,
        fontUi,
        outerSymbolSize,
        style,
      );
    }
    drawTerms(draw, center, ringset, asc, chart, palette, fontSymbols, smallSymbolSize);
    drawDecans(draw, center, ringset, asc, chart, palette, fontSymbols, smallSymbolSize);
    if (chart.options.showSymbols && chart.options.showAspects && drawAspects) {
      drawAspectSymbols(draw, center, ringset, asc, chart, palette, fontSymbols, symbolSize, drawAspects);
    }
    if (
      chart.options.showSymbols &&
      chart.options.showAspects &&
      comparisonChart &&
      showInterChartAspectFigure
    ) {
      drawInterChartAspectSymbols(
        draw,
        center,
        ringset,
        asc,
        chart,
        comparisonChart,
        drawInterChartAspects,
        palette,
        fontSymbols,
        symbolSize,
      );
    }
    if (chart.options.showPositions || isAngloWheel(chart)) {
      drawAscMCPos(
        draw,
        center,
        ringset,
        asc,
        chart,
        palette,
        fontUi,
        fontSymbols,
        symbolSize,
        bodyShifts,
        style,
      );
      if (chart.options.showHouses) {
        drawHousePos(draw, center, ringset, asc, chart, palette, fontUi, symbolSize);
      }
    }
    return;
  }

  const activeOuterItems = visibleOuterItems(snapshot);
  if (activeOuterItems.length) {
    const outerItemsChart = comparisonChart ?? chart;
    const outerItemLayout = getOuterRingItemLayout(
      draw,
      snapshot,
      center,
      ringset,
      asc,
      activeOuterItems,
      fontUi,
      fontSymbols,
      outerSymbolSize,
      outerItemsChart,
      palette,
    );
    drawOuterRingItems(
      draw,
      center,
      ringset,
      asc,
      outerItemLayout,
      outerItemsChart,
      palette,
      fontUi,
      fontSymbols,
      outerSymbolSize / 2,
      outerSymbolSize,
      opts.width,
      style,
    );
  } else if (hasOuterRing) {
    const fixedStarLayout = getFixedStarLayout(
      draw,
      chart,
      center,
      ringset,
      asc,
      fontUi,
      outerSymbolSize,
    );
    drawFixstars(
      draw,
      center,
      ringset,
      asc,
      fixedStarLayout,
      palette,
      fontUi,
      outerSymbolSize / 2,
      outerSymbolSize,
    );
  }
  // Global Surveil study marks ride on top of the outer-ring labels, matching
  // graphchart.py's "draw on top" ordering (graphchart.py:1551-1553).
  drawSurveilMarks(
    draw,
    center,
    ringset,
    asc,
    chart.surveilMarks ?? [],
    palette,
    fontUi,
    fontSymbols,
    outerSymbolSize,
  );
}

// ---------------------------------------------------------------------------
// Hit regions — computed off the same ring geometry the renderer uses, so the
// inspector pane can hit-test mouse position against planet/angle/fortune glyphs
// without re-implementing the wheel layout in the React shell.
// ---------------------------------------------------------------------------
export type ChartHitRegion = {
  // Higher wins on overlap (port of graphchart hover-region priority). Optional;
  // defaults to 0. Distance breaks ties at equal priority.
  priority?: number;
  // Optional tight rectangular text/glyph target. If present, hit testing uses
  // this box instead of the fallback circular radius.
  left?: number;
  top?: number;
  width?: number;
  height?: number;
} & (
  | {
      kind: "planet";
      planetId: PlanetId;
      seId: number;
      x: number;
      y: number;
      r: number;
      longitude: number;
      latitude: number;
      speed: number;
      house?: number;
      dignity?: DignityKind;
      // 'outer' for a biwheel/synastry/transit outer-ring body (graphchart.py:
      // 2151). The daemon resolves these against the comparison chart.
      chartRole?: "primary" | "outer";
    }
  | { kind: "fortune"; x: number; y: number; r: number; longitude: number; chartRole?: "primary" | "outer" }
  | {
      kind: "vertex";
      x: number;
      y: number;
      r: number;
      longitude: number;
      house?: number;
      chartRole?: "primary" | "outer";
    }
  | {
      kind: "syzygy";
      x: number;
      y: number;
      r: number;
      longitude: number;
      house?: number;
      label?: string;
      chartRole?: "primary" | "outer";
    }
  | {
      kind: "angle";
      angleId: "asc" | "mc" | "dsc" | "ic";
      x: number;
      y: number;
      r: number;
      longitude: number;
      chartRole?: "primary" | "outer";
    }
  | { kind: "house"; houseIndex: number; x: number; y: number; r: number; longitude: number }
  | {
      // Sign band: the FULL 30-deg sector (graphchart._sign_hover_radii +
      // _register_sector_hover_region, graphchart.py:1150-1152/1777-1788), not
      // the small glyph disc. findHitRegion tests the radial band + the 30-deg
      // angular wedge so anywhere in the sign's slice resolves.
      kind: "sign";
      signIndex: number;
      x: number; // sign-glyph centre (for the generic distance tie-break)
      y: number;
      r: number; // = outerRadius, so the common bounding test admits the sector
      longitude: number; // sign-centre longitude (i*30 + 15)
      cx: number; // wheel centre
      cy: number;
      innerRadius: number;
      outerRadius: number;
      startLon: number; // sign start longitude (i*30)
      endLon: number; // sign end longitude (i*30 + 30)
      asc: number; // ascendant rotation, to map mouse → ecliptic longitude
    }
  | {
      // Outer-ring item (fixed star / lot / midpoint / asteroid / antiscia /
      // contra / dodecatemoria). objectId is built daemon-side from these.
      kind: "secondary_ring";
      family: string;
      itemId: string;
      label: string;
      chartRole?: "primary" | "outer";
      searchObjectId?: string;
      x: number;
      y: number;
      r: number;
      longitude: number;
      shape?: "disc" | "rect";
      left?: number;
      top?: number;
      width?: number;
      height?: number;
      segments?: RingLabelSegment[];
    }
  | {
      // Aspect glyph / line. p1/p2 are the snapshot endpoint keys
      // (planet id strings, or "asc"/"mc"/"fortune"); type is the aspect index.
      // shape='glyph' → disc at the midpoint glyph (priority 32, graphchart.py:
      // 851). shape='line' → true point-to-segment proximity over the whole
      // stroke (priority 18, graphchart._register_line_hover_region,
      // graphchart.py:1126-1137) — not the prior sampled-point approximation.
      kind: "aspect";
      p1: string;
      p2: string;
      aspectType: number;
      scope?: "primary" | "interchart";
      x: number;
      y: number;
      r: number;
      shape?: "glyph" | "line";
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
      tolerance?: number;
    }
  | {
      // Empty inner band inside the aspect circle (between rAsp and rInner) —
      // clicking here toggles "hide all aspects" (graphchart.py:709-728/:1456,
      // {'kind':'hide_all'}). An ANNULUS, not a disc: findHitRegion tests the
      // radial band. Lowest priority so any glyph/line/sign above it wins.
      kind: "midband_empty";
      x: number; // center (for the generic distance fields)
      y: number;
      r: number; // = rOuter, so the common bounding test admits the band
      rInner: number;
      rOuter: number;
    }
);

function pushAspectHitRegions(
  regions: ChartHitRegion[],
  {
    p1,
    p2,
    aspectType,
    start,
    end,
    hitRadius,
    lineTolerance,
    scope,
    includeGlyph,
  }: {
    p1: string;
    p2: string;
    aspectType: number;
    start: Pt;
    end: Pt;
    hitRadius: number;
    lineTolerance: number;
    scope?: "primary" | "interchart";
    includeGlyph: boolean;
  },
) {
  const mid: Pt = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  if (includeGlyph) {
    regions.push({
      kind: "aspect",
      shape: "glyph",
      p1,
      p2,
      aspectType,
      scope,
      x: mid[0],
      y: mid[1],
      r: hitRadius,
      priority: 32,
    });
  }
  regions.push({
    kind: "aspect",
    shape: "line",
    p1,
    p2,
    aspectType,
    scope,
    x: mid[0],
    y: mid[1],
    r: 0, // unused for line shape (segment test owns it)
    x1: start[0],
    y1: start[1],
    x2: end[0],
    y2: end[1],
    tolerance: lineTolerance,
    priority: 18,
  });
}

interface ComputeHitRegionsOptionsBase {
  width: number;
  height: number;
  chartSize?: number;
  textsize?: (text: string, opts?: TextOpts) => Pt;
  clickAspectState?: ClickAspectState;
}

export type ComputeHitRegionsOptions = ComputeHitRegionsOptionsBase & WheelRenderStyleSource;

export function computeHitRegions(
  snapshot: ChartRenderSnapshot,
  opts: ComputeHitRegionsOptions,
): ChartHitRegion[] {
  const style = resolveWheelRenderStyle(opts);
  applyStyleRevision(wheelStyleRevisionKey(style));
  const chart = snapshot.primaryChart;
  const width = opts.width;
  const height = opts.height;
  if (width <= 0 || height <= 0) return [];
  const chartSize = opts.chartSize ?? Math.min(width, height);
  const maxRadius = chartSize / 2;
  const center: Pt = [Math.floor(width / 2), Math.floor(height / 2)];
  const asc = chart.angles.asc;
  const palette = style.palette as ChartPalette;
  const fontUi = style.typography.families.ui;
  const fontSymbols = style.typography.families.symbols;
  const measurer: TextMeasurer = { textsize: opts.textsize ?? fallbackTextsize };
  const comparisonChart = snapshot.comparisonChart ?? undefined;
  const hasComparison = Boolean(comparisonChart);
  const hasOuterRing = hasComparison || snapshot.outerRingMode !== "none";
  const showOuterHouseGeometry = comparisonUsesOuterHouses(snapshot, chart);
  const showInterChartAspectFigure = Boolean(
    comparisonChart && (!isAngloWheel(chart) || !showOuterHouseGeometry),
  );
  const ringset: RingSet = hasComparison
    ? comparisonRings(chart, maxRadius, showOuterHouseGeometry)
    : effectiveRings(chart, maxRadius, hasOuterRing);
  const typography = resolveWheelTypographyMetrics(
    style,
    wheelTypographyProfile(chart),
    maxRadius,
  );
  const symbolSize = typography.bodySize;
  const outerSymbolSize = typography.outerSize;
  const signSize = typography.signSize;
  const hitRadius = Math.max(10, maxRadius / 14);
  const planets = planetById(chart);
  const { bodyShifts } = getBodyLayout(
    measurer,
    chart,
    center,
    asc,
    ringset.rPlanet,
    ringset.rPos,
    fontSymbols,
    fontUi,
    symbolSize,
    style,
  );

  const regions: ChartHitRegion[] = [];

  const bodyGlyphBox = (
    x: number,
    y: number,
    bodyChart: Chart,
    key: BodyKey,
    glyph: string,
    baseSize = symbolSize,
  ) => {
    const bodyHitPad = Math.max(1, Math.round(baseSize * 0.06));
    const glyphSize = bodyGlyphSize(key, baseSize, style);
    const [glyphWidth, glyphHeight] = measurer.textsize(glyph, {
      font: bodyGlyphFont(bodyChart, key, fontSymbols, fontUi),
      size: glyphSize,
    });
    return {
      left: x - glyphSize / 2 - bodyHitPad,
      top: y - glyphSize / 2 - bodyHitPad,
      width: Math.max(1, glyphWidth) + bodyHitPad * 2,
      height: Math.max(1, glyphHeight) + bodyHitPad * 2,
    };
  };

  for (const planet of chart.planets) {
    if (!Number.isFinite(planet.longitude)) continue;
    const shift = bodyShifts.get(planet.id) ?? 0;
    const [x, y] = polar(center, ringset.rPlanet, planet.longitude + shift, asc);
    const glyph = bodyGlyph(chart, planets, planet.id);
    regions.push({
      kind: "planet",
      planetId: planet.id,
      seId: planet.seId,
      x,
      y,
      r: Math.max(1, symbolSize / 2),
      ...bodyGlyphBox(x, y, chart, planet.id, glyph),
      longitude: planet.longitude,
      latitude: planet.latitude,
      speed: planet.speed,
      house: planet.house,
      dignity: planet.dignity,
      priority: 40, // graphchart.py:2182
    });
  }

  if (chart.fortune && Number.isFinite(chart.fortune.longitude)) {
    const shift = bodyShifts.get("__fortune") ?? 0;
    const [x, y] = polar(center, ringset.rPlanet, chart.fortune.longitude + shift, asc);
    const glyph = bodyGlyph(chart, planets, "__fortune");
    regions.push({
      kind: "fortune",
      x, y, r: Math.max(1, symbolSize / 2), ...bodyGlyphBox(x, y, chart, "__fortune", glyph), longitude: chart.fortune.longitude,
      priority: 34, // graphchart.py:1943
    });
  }

  if (chart.vertex && Number.isFinite(chart.vertex.longitude)) {
    const shift = bodyShifts.get("__vertex") ?? 0;
    const [x, y] = polar(center, ringset.rPlanet, chart.vertex.longitude + shift, asc);
    const glyph = bodyGlyph(chart, planets, "__vertex");
    regions.push({
      kind: "vertex",
      x, y, r: Math.max(1, symbolSize / 2), ...bodyGlyphBox(x, y, chart, "__vertex", glyph), longitude: chart.vertex.longitude,
      house: chart.vertex.house,
      // Inner-ring body priority 40 (graphchart.py:2182, `not outer`).
      priority: 40,
    });
  }

  if (chart.syzygy && Number.isFinite(chart.syzygy.longitude)) {
    const shift = bodyShifts.get("__syzygy") ?? 0;
    const [x, y] = polar(center, ringset.rPlanet, chart.syzygy.longitude + shift, asc);
    const glyph = bodyGlyph(chart, planets, "__syzygy");
    regions.push({
      kind: "syzygy",
      x, y, r: Math.max(1, symbolSize / 2), ...bodyGlyphBox(x, y, chart, "__syzygy", glyph), longitude: chart.syzygy.longitude,
      house: chart.syzygy.house,
      label: chart.syzygy.label,
      priority: 40,
    });
  }

  // OUTER-RING bodies (biwheel / synastry / transit). graphchart draws the
  // comparison chart via drawPlanets(chart2, ..., outer=True) and registers each
  // body's hover region with chart_role='outer', priority 38 (graphchart.py:
  // 2151/2182). They sit at rOuterPlanet, rotated by the INNER ascendant (the
  // renderer draws them with the same `asc`, draw-chart.ts:1983-2038). Without
  // these regions an outer body falls through to the sign sector beneath it
  // (the user-named gap). The daemon resolves each against the comparison chart.
  let outerBodyShiftsForHits: Map<LayoutKey, number> | null = null;
  if (comparisonChart) {
    const rOuterPlanet = ringset.rOuterPlanet ?? ringset.rPlanet;
    const comparisonPlanets = planetById(comparisonChart);
    const outerBodyShifts = getBodyShifts(
      measurer,
      comparisonChart,
      center,
      asc,
      rOuterPlanet,
      fontSymbols,
      fontUi,
      outerSymbolSize,
      style,
      isAngloWheel(comparisonChart),
      false,
      true,
      showOuterHouseGeometry,
    );
    outerBodyShiftsForHits = outerBodyShifts;
    for (const planet of comparisonChart.planets) {
      if (!Number.isFinite(planet.longitude)) continue;
      const shift = outerBodyShifts.get(planet.id) ?? 0;
      const [x, y] = polar(center, rOuterPlanet, planet.longitude + shift, asc);
      const glyph = bodyGlyph(comparisonChart, comparisonPlanets, planet.id);
      regions.push({
        kind: "planet",
        planetId: planet.id,
        seId: planet.seId,
        x,
        y,
        r: Math.max(1, outerSymbolSize / 2),
        ...bodyGlyphBox(x, y, comparisonChart, planet.id, glyph, outerSymbolSize),
        longitude: planet.longitude,
        latitude: planet.latitude,
        speed: planet.speed,
        house: planet.house,
        dignity: planet.dignity,
        chartRole: "outer",
        priority: 38, // graphchart.py:2182 (`outer`)
      });
    }
    if (comparisonChart.fortune && Number.isFinite(comparisonChart.fortune.longitude)) {
      const shift = outerBodyShifts.get("__fortune") ?? 0;
      const [x, y] = polar(center, rOuterPlanet, comparisonChart.fortune.longitude + shift, asc);
      const glyph = bodyGlyph(comparisonChart, comparisonPlanets, "__fortune");
      regions.push({
        kind: "fortune",
        x,
        y,
        r: Math.max(1, outerSymbolSize / 2),
        ...bodyGlyphBox(x, y, comparisonChart, "__fortune", glyph, outerSymbolSize),
        longitude: comparisonChart.fortune.longitude,
        chartRole: "outer",
        priority: 38,
      });
    }
    if (comparisonChart.vertex && Number.isFinite(comparisonChart.vertex.longitude)) {
      const shift = outerBodyShifts.get("__vertex") ?? 0;
      const [x, y] = polar(center, rOuterPlanet, comparisonChart.vertex.longitude + shift, asc);
      const glyph = bodyGlyph(comparisonChart, comparisonPlanets, "__vertex");
      regions.push({
        kind: "vertex",
        x,
        y,
        r: Math.max(1, outerSymbolSize / 2),
        ...bodyGlyphBox(x, y, comparisonChart, "__vertex", glyph, outerSymbolSize),
        longitude: comparisonChart.vertex.longitude,
        house: comparisonChart.vertex.house,
        chartRole: "outer",
        priority: 38,
      });
    }
    if (comparisonChart.syzygy && Number.isFinite(comparisonChart.syzygy.longitude)) {
      const shift = outerBodyShifts.get("__syzygy") ?? 0;
      const [x, y] = polar(center, rOuterPlanet, comparisonChart.syzygy.longitude + shift, asc);
      const glyph = bodyGlyph(comparisonChart, comparisonPlanets, "__syzygy");
      regions.push({
        kind: "syzygy",
        x,
        y,
        r: Math.max(1, outerSymbolSize / 2),
        ...bodyGlyphBox(x, y, comparisonChart, "__syzygy", glyph, outerSymbolSize),
        longitude: comparisonChart.syzygy.longitude,
        house: comparisonChart.syzygy.house,
        label: comparisonChart.syzygy.label,
        chartRole: "outer",
        priority: 38,
      });
    }
  }

  const angleEntries: Array<["asc" | "mc" | "dsc" | "ic", number]> = [
    ["asc", chart.angles.asc],
    ["mc", chart.angles.mc],
    ["dsc", chart.angles.dsc],
    ["ic", chart.angles.ic],
  ];
  for (const [angleId, lon] of angleEntries) {
    if (!Number.isFinite(lon)) continue;
    if (isAngloWheel(chart) && (angleId === "asc" || angleId === "mc")) {
      const layoutKey: AngleLayoutKey = angleId === "asc" ? "__asc" : "__mc";
      if (bodyShifts.has(layoutKey)) {
        const label = angleId === "asc" ? "AC" : "MC";
        const shiftedLon = lon + (bodyShifts.get(layoutKey) ?? 0);
        const [x, y] = polar(center, ringset.rPlanet, shiftedLon, asc);
        const labelSize = layoutGlyphSize(layoutKey, symbolSize, style);
        const [labelWidth, labelHeight] = measurer.textsize(label, {
          font: fontUi,
          size: labelSize,
          weight: style.typography.ratios.angleLabelWeight,
        });
        const pad = Math.max(2, symbolSize * 0.06);
        regions.push({
          kind: "angle",
          angleId,
          x,
          y,
          r: Math.max(hitRadius, labelSize / 2),
          left: x - labelWidth / 2 - pad,
          top: y - labelHeight / 2 - pad,
          width: labelWidth + pad * 2,
          height: labelHeight + pad * 2,
          longitude: lon,
          priority: 40,
        });
      } else {
        const [x, y] = polar(center, ringset.rInner, lon, asc);
        regions.push({
          kind: "angle",
          angleId,
          x,
          y,
          r: hitRadius,
          longitude: lon,
          priority: 40,
        });
      }
      continue;
    }
    // wx graphchart.drawAscMC registers the hover at the visible angle-line tip
    // (x2/y2, graphchart.py:1866-1877), not at the inner/base radius.
    const [x, y] = polar(center, ringset.rASCMC, lon, asc);
    regions.push({ kind: "angle", angleId, x, y, r: hitRadius, longitude: lon, priority: 30 });
  }

  // Outer-ring angles (drawOuterAscMC). graphchart registers them with
  // chart_role='outer', priority 30 at x2/y2 (graphchart.py:1843/1866-1877):
  // outer Asc/MC use rOuterASCMC; outer Dsc/IC extend to rOuterArrow.
  if (comparisonChart) {
    const outerAngles: Array<["asc" | "mc" | "dsc" | "ic", number]> = [
      ["asc", comparisonChart.angles.asc],
      ["mc", comparisonChart.angles.mc],
      ["dsc", comparisonChart.angles.dsc],
      ["ic", comparisonChart.angles.ic],
    ];
    for (const [angleId, lon] of outerAngles) {
      if (!Number.isFinite(lon)) continue;
      if (isAngloWheel(comparisonChart)) {
        if (angleId !== "asc" && angleId !== "mc") continue;
        const layoutKey: AngleLayoutKey = angleId === "asc" ? "__asc" : "__mc";
        const label = angleId === "asc" ? "AC" : "MC";
        const shiftedLon = lon + (outerBodyShiftsForHits?.get(layoutKey) ?? 0);
        const radius = ringset.rOuterPlanet ?? ringset.rPlanet;
        const [x, y] = polar(center, radius, shiftedLon, asc);
        const labelSize = layoutGlyphSize(layoutKey, outerSymbolSize, style);
        const [labelWidth, labelHeight] = measurer.textsize(label, {
          font: fontUi,
          size: labelSize,
          weight: style.typography.ratios.angleLabelWeight,
        });
        const pad = Math.max(2, outerSymbolSize * 0.06);
        regions.push({
          kind: "angle",
          angleId,
          x,
          y,
          r: Math.max(hitRadius, labelSize / 2),
          left: x - labelWidth / 2 - pad,
          top: y - labelHeight / 2 - pad,
          width: labelWidth + pad * 2,
          height: labelHeight + pad * 2,
          longitude: lon,
          chartRole: "outer",
          priority: 40,
        });
        continue;
      }
      const radius =
        angleId === "dsc" || angleId === "ic"
          ? (ringset.rOuterArrow ?? ringset.rOuterASCMC ?? ringset.rBase)
          : (ringset.rOuterASCMC ?? ringset.rBase);
      const [x, y] = polar(center, radius, lon, asc);
      regions.push({
        kind: "angle",
        angleId,
        x,
        y,
        r: hitRadius,
        longitude: lon,
        chartRole: "outer",
        priority: 30,
      });
    }
  }

  if (chart.options.showHouses) {
    const houseHitRadius = Math.max(8, maxRadius / 18);
    for (let i = 0; i < 12; i += 1) {
      const cusp = chart.houses.cusps[i];
      const nextCusp = chart.houses.cusps[(i + 1) % 12];
      if (!Number.isFinite(cusp) || !Number.isFinite(nextCusp)) continue;
      const width = ((nextCusp - cusp + 360) % 360) || 30;
      const lon = normalize(cusp + width / 2);
      const [x, y] = polar(center, ringset.rHouseName, lon, asc);
      regions.push({ kind: "house", houseIndex: i + 1, x, y, r: houseHitRadius, longitude: cusp, priority: 22 });
    }
  }

  // Sign band = the full 30-deg sector (graphchart._sign_hover_radii +
  // _register_sector_hover_region, graphchart.py:1150-1152/1777-1788), NOT a
  // small glyph disc. half_band = max(signSize*0.7, symbolSize*0.6, pad*1.5)
  // about rSign. Visible glyph metrics follow the selected wheel profile.
  {
    const signPad = Math.max(6, Math.round(symbolSize * 0.35));
    const halfBand = Math.max(signSize * 0.7, symbolSize * 0.6, signPad * 1.5);
    const innerRadius = Math.max(0, ringset.rSign - halfBand);
    const outerRadius = ringset.rSign + halfBand;
    for (let i = 0; i < 12; i += 1) {
      const lon = i * 30 + 15;
      const [x, y] = polar(center, ringset.rSign, lon, asc);
      regions.push({
        kind: "sign",
        signIndex: i,
        x,
        y,
        r: outerRadius,
        longitude: lon,
        cx: center[0],
        cy: center[1],
        innerRadius,
        outerRadius,
        startLon: i * 30,
        endLon: i * 30 + 30,
        asc,
        priority: 10,
      });
    }
  }

  // Empty inner band → "hide all aspects" toggle. This uses the wheel's
  // existing aspect/planet radii in every theme, including compact, so enabling
  // the interaction never changes the wheel geometry.
  const pad = Math.max(6, Math.round(symbolSize * 0.35));
  const rInnerBand = Math.max(0, ringset.rAsp - pad * 0.5);
  const rOuterBand = Math.max(rInnerBand, ringset.rInner + pad * 0.5);
  regions.push({
    kind: "midband_empty",
    x: center[0],
    y: center[1],
    r: rOuterBand,
    rInner: rInnerBand,
    rOuter: rOuterBand,
    priority: -10,
  });

  // Aspect glyphs + lines (dynamic layer). The renderer already projects the
  // two endpoints; we reuse the same geometry. Glyph target at the midpoint
  // (priority 32, graphchart.py:851); line target uses true point-to-segment
  // proximity over the whole stroke (priority 18, graphchart.py:1126-1137).
  if (chart.options.showAspects !== false && !hasComparison) {
    const planetMap = planetById(chart);
    const aspectHitRadius = Math.max(8, maxRadius / 22);
    const aspectPad = Math.max(6, Math.round(symbolSize * 0.35));
    // graphchart._draw_aspect_line tolerance: max(4, hover_pad*0.8).
    const lineTolerance = Math.max(4, aspectPad * 0.8);
    for (const aspect of resolveAspectsForDraw(chart, opts.clickAspectState) ?? []) {
      const p1 = aspectEndpoint(chart, planetMap, center, ringset, asc, aspect.p1);
      const p2 = aspectEndpoint(chart, planetMap, center, ringset, asc, aspect.p2);
      if (!p1 || !p2) continue;
      pushAspectHitRegions(regions, {
        p1: String(aspect.p1),
        p2: String(aspect.p2),
        aspectType: aspect.type,
        start: p1,
        end: p2,
        hitRadius: aspectHitRadius,
        lineTolerance,
        includeGlyph: Boolean(chart.options.showSymbols),
      });
    }
  }

  // Inter-chart aspect hover parity. wx registers hover data for both
  // drawInterChartAspectLines and drawInterChartAspectSymbols, carrying inner
  // and outer body identities into chartinspector.build_flag_payload.
  if (chart.options.showAspects !== false && comparisonChart && showInterChartAspectFigure) {
    const primaryPlanets = planetById(chart);
    const comparisonPlanets = planetById(comparisonChart);
    const aspectHitRadius = Math.max(8, maxRadius / 22);
    const aspectPad = Math.max(6, Math.round(symbolSize * 0.35));
    const lineTolerance = Math.max(4, aspectPad * 0.8);
    const outerPointAspects = resolveOuterPointAspectsForDraw(chart, opts.clickAspectState);
    const interChartAspectsForHits = resolveInterChartAspectsForDraw(
      chart,
      snapshot.interChartAspects ?? [],
      snapshot.interChartBodyAspects,
      opts.clickAspectState,
    );
    if (outerPointAspects !== undefined) {
      const planetMap = planetById(chart);
      for (const aspect of outerPointAspects) {
        const p1 = aspectEndpoint(chart, planetMap, center, ringset, asc, aspect.p1);
        const p2 = aspectEndpoint(chart, planetMap, center, ringset, asc, aspect.p2);
        if (!p1 || !p2) continue;
        pushAspectHitRegions(regions, {
          p1: String(aspect.p1),
          p2: String(aspect.p2),
          aspectType: aspect.type,
          start: p1,
          end: p2,
          hitRadius: aspectHitRadius,
          lineTolerance,
          includeGlyph: Boolean(chart.options.showSymbols),
        });
      }
    }
    for (const aspect of outerPointAspects === undefined ? interChartAspectsForHits : []) {
      const p1 = aspectEndpoint(chart, primaryPlanets, center, ringset, asc, aspect.inner);
      const p2 = aspectEndpoint(comparisonChart, comparisonPlanets, center, ringset, asc, aspect.outer);
      if (!p1 || !p2) continue;
      pushAspectHitRegions(regions, {
        p1: String(aspect.inner),
        p2: String(aspect.outer),
        aspectType: aspect.type,
        start: p1,
        end: p2,
        hitRadius: aspectHitRadius,
        lineTolerance,
        scope: "interchart",
        includeGlyph: Boolean(chart.options.showSymbols),
      });
    }
  }

  // Outer-ring items (secondary_ring): every active item the chart draws,
  // projected to the outer-label radius band (graphchart.py:3879-4710,
  // priority 46). family + id + longitude + label drive the daemon objectId.
  const activeOuterItems = visibleOuterItems(snapshot);
  if (activeOuterItems.length > 0) {
    const symbolSize = outerSymbolSize;
    const outerHitRadius = Math.max(10, symbolSize);
    const outerItemsChart = comparisonChart ?? chart;
    const labelRadius = ringset.rOuterLine + symbolSize * 0.2;
    const outerItemLayout = prepareOuterRingItems(
      measurer,
      center,
      ringset.rOuterLine,
      asc,
      activeOuterItems,
      labelRadius,
      ringset.rAntis ?? labelRadius,
      fontUi,
      fontSymbols,
      symbolSize / 2,
      symbolSize,
      outerItemsChart,
      palette,
    );
    for (let i = 0; i < outerItemLayout.items.length; i += 1) {
      const item = outerItemLayout.items[i];
      if (!Number.isFinite(item.longitude)) continue;
      const itemLabelRadius = outerRingItemLabelRadius(item, ringset, symbolSize);
      const itemFontSize = outerRingItemFontSize(item, symbolSize, symbolSize / 2);
      let runs = buildOuterItemLabel(item, outerItemsChart, palette);
      let [textWidth, textHeight] = labelRunsBounds(measurer, runs, fontUi, fontSymbols, itemFontSize);
      const shiftedLon = item.longitude + outerItemLayout.shifts[i];
      const pt = polar(center, itemLabelRadius, shiftedLon, asc);
      const rad = Math.PI + ((asc - shiftedLon) * Math.PI) / 180;
      let x = pt[0];
      let y = pt[1] + outerItemLayout.yOffsets[i];
      const pos = normalize((rad * 180) / Math.PI);
      if (pos > 90 && pos < 270) {
        x -= textWidth;
      }
      if (item.fitPolicy !== "none") {
        const fit = fitOuterLabelToBitmap(
          measurer,
          runs,
          x,
          textWidth,
          textHeight,
          width,
          symbolSize,
          fontUi,
          itemFontSize,
          palette,
          style,
        );
        runs = fit.runs;
        x = fit.x;
        textWidth = fit.w;
        textHeight = fit.h;
      }
      if (!runs.length || textWidth <= 0) {
        continue;
      }
      [x, y] = ensureTextOutsideOuterWheel(
        center,
        ringset.rOuterLine,
        rad,
        x,
        y,
        textWidth,
        textHeight,
        itemLabelRadius,
        Math.round(symbolSize * 0.1),
      );
      const pad = Math.max(4, Math.round(itemFontSize * 0.35));
      const left = x - pad;
      const top = y - textHeight / 2 - pad;
      const boxWidth = textWidth + pad * 2;
      const boxHeight = textHeight + pad * 2;
      regions.push({
        kind: "secondary_ring",
        family: item.family,
        itemId: item.id,
        label: item.label,
        chartRole: item.role === "outer" ? "outer" : "primary",
        searchObjectId: item.searchObjectId,
        x: left + boxWidth / 2,
        y: top + boxHeight / 2,
        r: outerHitRadius,
        longitude: item.longitude,
        shape: "rect",
        left,
        top,
        width: boxWidth,
        height: boxHeight,
        segments: item.segments,
        priority: 46,
      });
    }
  }

  return regions;
}

export function findHitRegion(
  regions: ChartHitRegion[],
  mouseX: number,
  mouseY: number,
): ChartHitRegion | null {
  // Port of graphchart hit-test resolution: higher priority wins on overlap
  // (smaller targets like outer-ring labels/aspect glyphs sit above lines and
  // signs); distance breaks ties at equal priority.
  let best: ChartHitRegion | null = null;
  let bestPriority = -Infinity;
  let bestDist = Infinity;
  for (const region of regions) {
    // Per-shape hit test → (inside, distSq-for-tie-break). Default is the disc
    // test on (region.x, region.y, region.r); sign sectors and aspect lines
    // override it (graphchart shapes: 'sector' / 'line').
    let inside = false;
    let distSq: number;
    if (region.kind === "sign") {
      // Full 30-deg sector (graphchart._register_sector_hover_region). Test the
      // radial band and the angular wedge by inverting polar() to recover the
      // mouse's (radius, ecliptic longitude).
      const sdx = mouseX - region.cx;
      const sdy = mouseY - region.cy;
      const radius = Math.hypot(sdx, sdy);
      // atan2(-screenDy, dx) === the polar() astro angle; lon = deg(astro)-180+asc.
      const lon = normalize((Math.atan2(-sdy, sdx) * 180) / Math.PI - 180 + region.asc);
      const inBand = radius >= region.innerRadius && radius <= region.outerRadius;
      const span = normalize(lon - region.startLon);
      const inWedge = span >= 0 && span <= normalize(region.endLon - region.startLon || 30);
      inside = inBand && inWedge;
      // Tie-break by distance to the sign-glyph centre.
      const gx = mouseX - region.x;
      const gy = mouseY - region.y;
      distSq = gx * gx + gy * gy;
    } else if (
      region.left != null &&
      region.top != null &&
      region.width != null &&
      region.height != null
    ) {
      const left = region.left;
      const top = region.top;
      const width = region.width;
      const height = region.height;
      inside = mouseX >= left && mouseX <= left + width && mouseY >= top && mouseY <= top + height;
      const cx = left + width / 2;
      const cy = top + height / 2;
      const dx = mouseX - cx;
      const dy = mouseY - cy;
      distSq = dx * dx + dy * dy;
    } else if (region.kind === "aspect" && region.shape === "line") {
      // True point-to-segment proximity over the whole stroke
      // (graphchart._register_line_hover_region).
      const x1 = region.x1 ?? region.x;
      const y1 = region.y1 ?? region.y;
      const x2 = region.x2 ?? region.x;
      const y2 = region.y2 ?? region.y;
      const tol = region.tolerance ?? 4;
      const vx = x2 - x1;
      const vy = y2 - y1;
      const lenSq = vx * vx + vy * vy;
      let t = lenSq > 0 ? ((mouseX - x1) * vx + (mouseY - y1) * vy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const px = x1 + vx * t;
      const py = y1 + vy * t;
      const ddx = mouseX - px;
      const ddy = mouseY - py;
      distSq = ddx * ddx + ddy * ddy;
      inside = distSq <= tol * tol;
    } else {
      const dx = mouseX - region.x;
      const dy = mouseY - region.y;
      distSq = dx * dx + dy * dy;
      inside = distSq <= region.r * region.r;
      // midband_empty is an annulus: also require the point be OUTSIDE the inner
      // radius (the empty band between the aspect circle and the planet ring).
      if (inside && region.kind === "midband_empty" && distSq < region.rInner * region.rInner) {
        inside = false;
      }
    }
    if (!inside) continue;
    const priority = region.priority ?? 0;
    if (priority > bestPriority || (priority === bestPriority && distSq < bestDist)) {
      best = region;
      bestPriority = priority;
      bestDist = distSq;
    }
  }
  return best;
}

export function drawChart(draw: CanvasDraw, chart: Chart, opts: DrawOptions) {
  drawSnapshotLayer(
    draw,
    {
      primaryChart: chart,
      displayDatetime: chart.meta.datetime,
      renderVariant: "round-classic",
      overlayRenderMode: "full",
      outerRingMode: "none",
    },
    "geometry",
    opts,
  );
  drawSnapshotLayer(
    draw,
    {
      primaryChart: chart,
      displayDatetime: chart.meta.datetime,
      renderVariant: "round-classic",
      overlayRenderMode: "full",
      outerRingMode: "none",
    },
    "dynamic",
    opts,
  );
}

const loadedChartFontKeys = new Set<string>();
const pendingChartFontLoads = new Map<string, Promise<void>>();

function chartFontKey(fontText?: string): string {
  return (fontText || DEFAULT_MORINUS_TEXT_FONT).replace(/\s+/g, " ").trim();
}

export function chartFontsAreReady(fontText?: string): boolean {
  return loadedChartFontKeys.has(chartFontKey(fontText));
}

export function warmChartFonts(fontText?: string): void {
  void awaitFonts(fontText);
}

export async function awaitFonts(fontText?: string): Promise<void> {
  const key = chartFontKey(fontText);
  if (typeof document === "undefined") {
    loadedChartFontKeys.add(key);
    return;
  }
  if (!("fonts" in document) || !document.fonts?.load) {
    loadedChartFontKeys.add(key);
    return;
  }
  if (loadedChartFontKeys.has(key)) {
    return;
  }
  const textFont = key || DEFAULT_MORINUS_TEXT_FONT;
  const pending = pendingChartFontLoads.get(key);
  if (pending) {
    await pending;
    return;
  }
  const loadPromise = Promise.allSettled([
    document.fonts.load('32px "AriesMorinus"'),
    document.fonts.load('14px "FreeSans"'),
    document.fonts.load('700 14px "FreeSans"'),
    document.fonts.load(`14px ${textFont}`),
    document.fonts.load(`700 14px ${textFont}`),
  ]).then(() => {
    loadedChartFontKeys.add(key);
    pendingChartFontLoads.delete(key);
  }).catch((err) => {
    pendingChartFontLoads.delete(key);
    throw err;
  });
  pendingChartFontLoads.set(key, loadPromise);
  await loadPromise;
}
