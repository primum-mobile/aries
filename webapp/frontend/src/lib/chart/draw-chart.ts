// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

/**
 * Literal-ish port of the classic single-wheel path in graphchart.py.
 * Geometry, draw order, integer-ish placement, and overlap shifting follow the
 * desktop renderer closely enough for the web canvas to line up the same way.
 */

import { CanvasDraw, polar, type LineOpts, type TextOpts } from "./canvas-draw";
import { DEFAULT_MORINUS_TEXT_FONT } from "./chart-fonts";
import {
  createDitherRasterPatternTile,
  sampleDitherNoise,
} from "../render/dither-pattern";
import {
  resolveScaledWheelStroke,
  projectWheelAuthoringStyle,
  resolveWheelLinePaint,
  resolveWheelFillPaint,
  resolveWheelOverlayMetrics,
  resolveWheelRingSet,
  resolveWheelRenderStyle,
  resolveCanonicalWheelRingSet,
  resolveWheelScale,
  resolveWheelSecondaryRingClassIds,
  resolveWheelStrokeMetrics,
  resolveWheelTypographyMetrics,
  resolveWheelTypographyPaint,
  type WheelRenderStyle,
  type WheelAuthoringFillClass,
  type WheelAuthoringFillPattern,
  type WheelAuthoringLineClass,
  type WheelAuthoringTypographyClass,
  type WheelChartOverlayClass,
  type WheelLinePaintRole,
  type WheelRenderStyleSource,
  type WheelRingSet,
  type WheelTypographyProfile,
  type ResolvedWheelTypographyPaint,
  type ResolvedWheelTypographyMetrics,
  resolveWheelTickLength,
} from "./wheel-render-style";
import {
  resolveWheelBandLayout,
  resolveWheelClassFontSizeCeiling,
  type ResolvedWheelBand,
} from "./wheel-layout-model";
import {
  resolveBodyTrackRadius,
  resolveComparisonBodyLayoutPlan,
  resolvePdRingPresentation,
  type BodyRingTrack,
  type ComparisonBodyLayoutPlan,
  type PdRingPresentation,
} from "./pd-ring-presentation";
import {
  resolvePdEventLayout,
  type PdEventLayout,
} from "./pd-event-presentation";
import {
  resolveOuterGlyphLane,
  resolveOuterPaintEnvelopeScale as resolvePaintEnvelopeScale,
} from "./outer-glyph-lane";
import {
  FORTUNE_GLYPH,
  HOUSE_GLYPHS_ROMAN,
  aspectGlyph,
  signGlyph,
} from "./glyphs";
import type {
  Chart,
  ChartAspect,
  ChartDrishti,
  AspectBodyKey,
  ChartPalette,
  ChartPlanet,
  DignityKind,
  FixedStar,
  ChartRenderSnapshot,
  InterChartAspect,
  InterChartBodyAspectsMap,
  OuterRingItem,
  OverlayInfoRow,
  PdDirectionState,
  PlanetId,
  RingLabelSegment,
  SurveilMark,
} from "./types";

type Pt = [number, number];
export type OuterLabelCollisionBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};
type Bounds = OuterLabelCollisionBounds;
type PositionedText = Bounds & {
  text: string;
  font: string;
  size: number;
  fill: string;
  weight?: number;
  style?: string;
  tracking?: number;
  opacity?: number;
  classId: WheelAuthoringTypographyClass;
  signIndex?: number;
};
type BodyKey = PlanetId | "__fortune" | "__vertex" | "__syzygy" | "__eclipse";
type AngleLayoutKey = "__asc" | "__mc";
type LayoutKey = BodyKey | AngleLayoutKey;
type TextMeasurer = { textsize(text: string, opts?: TextOpts): Pt };
type BodyLayout = {
  bodyShifts: Map<LayoutKey, number>;
  labelYoffs: Map<LayoutKey, number>;
  componentBounds: Map<LayoutKey, Bounds[]>;
};
type BodyLayoutInputs = Pick<
  ComparisonBodyLayoutPlan<Chart>,
  | "includeAngles"
  | "includePositionStacks"
  | "includeSharedAngles"
  | "includeHouseCuspRays"
  | "outerTypography"
  | "usePrimaryGlyphSize"
>;
export type DrawLayer = "fill" | "geometry" | "dynamic" | "outer-label";

interface DrawOptionsBase {
  width: number;
  height: number;
  chartSize?: number;
  /** Rigid wheel origin. Defaults to the host centre. */
  center?: readonly [number, number];
  /** Screen-only chrome rectangles that outer labels must bend around. */
  outerLabelCollisionBounds?: readonly OuterLabelCollisionBounds[];
  // Click-to-toggle aspect selection (owned by the workspace store). When the
  // chart's clickAspectFlags.exclusiveOnClick is false this is ignored and
  // aspects render as today. See resolveAspectsForDraw.
  clickAspectState?: ClickAspectState;
  /** Retained multi-canvas callers paint the opaque surface on the fill layer. */
  geometryOwnsBackground?: boolean;
}

/**
 * Typed callers pass a complete renderStyle. Legacy website/export callers
 * omit it and must continue to provide palette (with optional font/revision).
 */
export type DrawOptions = DrawOptionsBase & WheelRenderStyleSource;

const PROJECTED_GLYPH_FAMILIES = new Set(["antiscia", "contra_antiscia", "dodecatemoria"]);
const OUTER_BODY_GLYPH_FAMILIES = new Set(["parallel_transits"]);

function isOuterGlyphFamily(family: string): boolean {
  return PROJECTED_GLYPH_FAMILIES.has(family)
    || OUTER_BODY_GLYPH_FAMILIES.has(family);
}
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

function fallbackTextsize(text: string, opts: TextOpts | undefined, widthScale: number): Pt {
  const size = Math.max(1, Math.round(opts?.size ?? 14));
  if (typeof document !== "undefined") {
    hitTextMeasureCanvas = hitTextMeasureCanvas ?? document.createElement("canvas");
    const ctx = hitTextMeasureCanvas.getContext("2d");
    if (ctx) {
      const family = opts?.font ?? "FreeSans, sans-serif";
      const weight = opts?.weight ?? 400;
      const requestedStyle = opts?.style?.trim().toLowerCase();
      const fontStyle =
        requestedStyle === "italic" || requestedStyle?.startsWith("oblique")
          ? requestedStyle
          : "normal";
      ctx.font = `${fontStyle} ${weight} ${size}px ${family}`;
      const metrics = ctx.measureText(text);
      const tracking = Number.isFinite(opts?.tracking)
        ? Number(opts?.tracking)
        : 0;
      const glyphs = Array.from(text);
      const width =
        tracking === 0 || glyphs.length < 2
          ? metrics.width
          : Math.max(
              0,
              glyphs.reduce(
                (sum, glyph) => sum + ctx.measureText(glyph).width,
                0,
              ) + (glyphs.length - 1) * tracking,
            );
      const h =
        (metrics.actualBoundingBoxAscent || 0) +
        (metrics.actualBoundingBoxDescent || 0) ||
        size;
      return [Math.round(width), Math.round(h)];
    }
  }
  const tracking = Number.isFinite(opts?.tracking)
    ? Number(opts?.tracking)
    : 0;
  const glyphCount = Array.from(String(text)).length;
  return [
    Math.round(
      glyphCount * size * widthScale
      + Math.max(0, glyphCount - 1) * tracking,
    ),
    size,
  ];
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
  const ring = style.strokes.chartRing;
  const rawBase = Number.isFinite(chart.options.chartRingThickness)
    ? Number(chart.options.chartRingThickness)
    : ring.fallbackBase;
  const base = Math.min(ring.maxBase, Math.max(ring.minBase, Math.round(rawBase)));

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
  if (chart.syzygy && !chart.eclipse?.coincidesWithSyzygy) {
    keys.push("__syzygy");
  }
  if (chart.eclipse) {
    keys.push("__eclipse");
  }
  return keys;
}

function layoutKeys(
  chart: Chart,
  includeAngles: boolean,
  includeSharedAngles = true,
  frameworkChart: Chart = chart,
): LayoutKey[] {
  const keys: LayoutKey[] = bodyKeys(chart);
  if (includeAngles && isAngloWheel(chart)) {
    if (
      frameworkChart.angles.ascDegMin &&
      (includeSharedAngles || !angleSharesHouseCusp(frameworkChart, "__asc"))
    ) {
      keys.push("__asc");
    }
    if (
      frameworkChart.angles.mcDegMin &&
      (includeSharedAngles || !angleSharesHouseCusp(frameworkChart, "__mc"))
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
  if (key === "__eclipse") {
    return chart.eclipse?.longitude ?? null;
  }
  return planets.get(key)?.longitude ?? null;
}

function layoutLongitude(
  chart: Chart,
  planets: Map<PlanetId, ChartPlanet>,
  key: LayoutKey,
  frameworkChart: Chart = chart,
): number | null {
  if (key === "__asc") return frameworkChart.angles.asc;
  if (key === "__mc") return frameworkChart.angles.mc;
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
  bodySize: number,
  angleLabelSize: number,
  syzygyScale: number,
): number {
  if (key === "__asc" || key === "__mc") {
    return angleLabelSize;
  }
  return bodyGlyphSize(key, bodySize, syzygyScale);
}

function layoutGlyphClassId(
  key: LayoutKey,
  outer: boolean,
): WheelAuthoringTypographyClass {
  if (key === "__asc" || key === "__mc") {
    return outer ? "angles.outer.label" : "angles.inner.label";
  }
  return bodyGlyphClassId(key, outer);
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
  if (key === "__eclipse") {
    const e = chart.eclipse;
    return e?.degText != null && e?.minText != null ? [e.degText, e.minText] : null;
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
  if (key === "__eclipse") {
    return chart.eclipse?.glyph ?? "Ec";
  }
  const planet = planets.get(key);
  return planet?.glyph ?? "";
}

function bodyGlyphFont(chart: Chart, key: BodyKey, fontSymbols: string, fontUi: string): string {
  if (
    (key === "__syzygy" && chart.syzygy?.glyphFont === "text") ||
    (key === "__eclipse" && chart.eclipse?.glyphFont === "text")
  ) {
    return fontUi;
  }
  return fontSymbols;
}

function bodyGlyphSize(key: BodyKey, symbolSize: number, syzygyScale: number): number {
  return key === "__syzygy" || key === "__eclipse"
    ? symbolSize * syzygyScale
    : symbolSize;
}

function bodyGlyphClassId(
  key: BodyKey,
  outer: boolean,
): WheelAuthoringTypographyClass {
  // Fortune, the Vertex and the syzygy are body glyphs: one class, one set of
  // typography, and their individual colours still come from `bodyColor` per
  // occurrence. `bodyGlyphSize` keeps the syzygy's own scale multiplier.
  return outer ? "bodies.outer.glyph" : "bodies.inner.glyph";
}

function bodyColor(
  chart: Chart,
  planets: Map<PlanetId, ChartPlanet>,
  key: BodyKey,
  palette: Readonly<{
    fortune: string;
    peregrin: string;
    positions: string;
    planets: readonly string[];
  }>,
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
  if (key === "__eclipse") {
    return chart.eclipse?.color ?? palette.fortune;
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

function nudgeOuterLabelsAroundCollisionBounds(
  shifts: number[],
  yOffsets: number[],
  labelBounds: (index: number, shift: number, yOffset: number) => Bounds,
  collisionBounds: readonly OuterLabelCollisionBounds[],
  style: WheelRenderStyle,
): void {
  for (let index = 0; index < yOffsets.length; index += 1) {
    for (const obstacle of collisionBounds) {
      const intersects = (bounds: Bounds) => overlap(
        bounds.x,
        bounds.y,
        bounds.w,
        bounds.h,
        obstacle.x,
        obstacle.y,
        obstacle.w,
        obstacle.h,
      );
      let bounds = labelBounds(index, shifts[index], yOffsets[index]);
      if (!intersects(bounds)) continue;
      const minimumDiagonalShift =
        style.collision.shiftStepDegrees * 15;
      if (Math.abs(shifts[index]) < minimumDiagonalShift) {
        if (shifts[index] !== 0) {
          shifts[index] =
            Math.sign(shifts[index]) * minimumDiagonalShift;
        } else {
          const centerX = bounds.x + bounds.w / 2;
          const backward = labelBounds(
            index,
            -minimumDiagonalShift,
            yOffsets[index],
          );
          const forward = labelBounds(
            index,
            minimumDiagonalShift,
            yOffsets[index],
          );
          shifts[index] =
            Math.abs(backward.x + backward.w / 2 - centerX)
              <= Math.abs(forward.x + forward.w / 2 - centerX)
              ? -minimumDiagonalShift
              : minimumDiagonalShift;
        }
        bounds = labelBounds(index, shifts[index], yOffsets[index]);
      }
      if (intersects(bounds)) {
        yOffsets[index] += obstacle.y + obstacle.h - bounds.y + 1;
      }
    }
  }
}

function drawRotatedLines(
  draw: CanvasDraw,
  center: Pt,
  shift: number,
  stepDeg: number,
  r1: number,
  r2: number,
  opts: LineOpts,
) {
  for (let deg = 0; deg < 360; deg += stepDeg) {
    const a = Math.PI + ((shift - deg) * Math.PI) / 180;
    const p1: Pt = [center[0] + Math.cos(a) * r1, center[1] + Math.sin(a) * r1];
    const p2: Pt = [center[0] + Math.cos(a) * r2, center[1] + Math.sin(a) * r2];
    draw.line([p1, p2], opts);
  }
}

function semanticLinePaint(
  style: WheelRenderStyle,
  role: WheelLinePaintRole,
  baseWidth: number,
  defaults: Omit<LineOpts, "fill" | "width"> = {},
  authoringClass?: WheelAuthoringLineClass,
): ReturnType<typeof resolveWheelLinePaint> {
  return resolveWheelLinePaint(style, role, baseWidth, defaults, authoringClass);
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
  padPx: number,
): [number, number, number] {
  const corners: Pt[] = [
    [x, y - h / 2],
    [x + w, y - h / 2],
    [x, y + h / 2],
    [x + w, y + h / 2],
  ];
  const target = outerLineRadius + padPx;
  if (
    corners.every(
      ([px, py]) => Math.hypot(px - center[0], py - center[1]) >= target,
    )
  ) {
    return [x, y, rText];
  }

  // Translate the complete label rectangle along its radial leader. Solving
  // the circle intersection for every corner makes the outer-wheel clearance
  // exact even for long word labels and large projected glyphs. A simple
  // target-minus-nearest-corner offset is insufficient because a wide label's
  // nearest corner does not move parallel to its own radius.
  const unitX = Math.cos(rad);
  const unitY = Math.sin(rad);
  let delta = 0;
  for (const [px, py] of corners) {
    const relativeX = px - center[0];
    const relativeY = py - center[1];
    const distanceSquared =
      relativeX * relativeX + relativeY * relativeY;
    if (distanceSquared >= target * target) {
      continue;
    }
    const radialProjection = relativeX * unitX + relativeY * unitY;
    const discriminant =
      radialProjection * radialProjection
      - (distanceSquared - target * target);
    delta = Math.max(
      delta,
      -radialProjection + Math.sqrt(Math.max(0, discriminant)),
    );
  }
  const clearanceEpsilon = 0.01;
  const radialDelta = delta + clearanceEpsilon;
  return [
    x + unitX * radialDelta,
    y + unitY * radialDelta,
    rText + radialDelta,
  ];
}

type RingSet = WheelRingSet;

function isCompactWheel(chart: Chart): boolean {
  return chart.options.theme === 1;
}

function isAngloWheel(chart: Chart): boolean {
  return chart.options.theme === 2;
}

function motionMarkerSize(
  chart: Chart,
  marker: string,
  baseSize: number,
  outer = false,
): number {
  if (marker !== "SR" && marker !== "SD") return baseSize;
  if (outer && !isCompactWheel(chart) && !isAngloWheel(chart)) return baseSize;
  if (!outer && isCompactWheel(chart)) return baseSize * (2 / 3);
  return baseSize * (4 / 3);
}

type AngloDenseLabelLayout = "leader-columns" | "routed-cusps" | "sign-locked";

function angloDenseLabelLayout(chart: Chart): AngloDenseLabelLayout {
  const requested = chart.options.angloDenseLabelLayout;
  return requested === "leader-columns" || requested === "sign-locked"
    ? requested
    : "routed-cusps";
}

/**
 * True when ordinary cusps yield paint to bodies instead of the reverse: the
 * cusp is broken across the label column and the sign boundary, not the cusp,
 * walls the body packer. This is the one presentation mode that also changes
 * body layout; `leader-columns` and `routed-cusps` remain layout-identical.
 */
function usesSignLockedLayout(chart: Chart): boolean {
  return angloDenseLabelLayout(chart) === "sign-locked";
}

function usesColumnAwareCusps(chart: Chart): boolean {
  const layout = angloDenseLabelLayout(chart);
  return layout === "routed-cusps" || layout === "sign-locked";
}

function wheelTypographyProfile(chart: Chart): WheelTypographyProfile {
  return isAngloWheel(chart) ? "anglo" : isCompactWheel(chart) ? "compact" : "classic";
}

function comparisonShowsHouseCusps(snapshot: ChartRenderSnapshot, chart: Chart): boolean {
  const presentation = resolvePdRingPresentation(snapshot);
  return Boolean(
    snapshot.comparisonChart &&
    presentation.showComparisonHouses &&
    chart.options.showHouses &&
    chart.options.showOuterHouseLines !== false,
  );
}

function comparisonUsesOuterHouseBand(snapshot: ChartRenderSnapshot, chart: Chart): boolean {
  return comparisonShowsHouseCusps(snapshot, chart) && !isAngloWheel(chart);
}

function usesRestrainedAngloComparison(
  snapshot: ChartRenderSnapshot,
  chart: Chart,
): boolean {
  return Boolean(
    snapshot.comparisonChart &&
    isAngloWheel(chart) &&
    snapshot.document?.compoundKind === "synastry",
  );
}

function effectiveRings(
  style: WheelRenderStyle,
  chart: Chart,
  maxRadius: number,
  hasOuterRing = false,
): RingSet {
  return resolveWheelRingSet(style, {
    profile: wheelTypographyProfile(chart),
    mode: "single",
    maxRadius,
    hasOuterRing,
    showTerms: Boolean(chart.options.showTerms),
    showDecans: Boolean(chart.options.showDecans),
    showHouses: Boolean(chart.options.showHouses),
    showPositions: Boolean(chart.options.showPositions),
    comparisonWithOuterHouses: false,
  });
}

function comparisonRings(
  style: WheelRenderStyle,
  chart: Chart,
  maxRadius: number,
  withOuterHouses = false,
  restrainedAngloComparison = false,
): RingSet {
  return resolveWheelRingSet(style, {
    profile: wheelTypographyProfile(chart),
    mode: "comparison",
    maxRadius,
    hasOuterRing: true,
    showTerms: Boolean(chart.options.showTerms),
    showDecans: Boolean(chart.options.showDecans),
    showHouses: Boolean(chart.options.showHouses),
    showPositions: Boolean(chart.options.showPositions),
    comparisonWithOuterHouses: withOuterHouses,
    restrainedAngloComparison,
  });
}

function bodyTrackRings(ringset: RingSet, track: BodyRingTrack): RingSet {
  if (track === "inner") return ringset;
  const radius = resolveBodyTrackRadius(
    { sourceRole: "outer", track },
    {
      inner: ringset.rPlanet,
      outer: ringset.rOuterPlanet ?? ringset.rPlanet,
    },
  );
  return {
    ...ringset,
    rPlanet: radius,
    rRetr: ringset.rOuterRetr ?? ringset.rRetr,
    rPos: radius,
  } as RingSet;
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
  const hairline = style.strokes.hairline;
  const thick = isAngloWheel(chart) ? hairline : chartRingPenWidth(style, chart, chartSize);
  const drawOuterDegreeRuler =
    hasOuterRing && (!isAngloWheel(chart) || showOuterHouseBand);

  // graphchart.py:1575-1583 draws the compound/biwheel outer house band
  // boundaries before the zodiac degree rings whenever houses are visible.
  if (showOuterHouseBand && ringset.rOuterMax && ringset.rOuterHouse) {
    draw.circle(center, ringset.rOuterMax, {
      outline: style.elementColors.outerMaximumRing,
      ...semanticLinePaint(style, "outerMaximumRing", hairline),
    });
    draw.circle(center, ringset.rOuterHouse, {
      outline: style.elementColors.outerHouseRing,
      ...semanticLinePaint(style, "outerHouseRing", hairline),
    });
  }

  draw.circle(center, ringset.r30, {
    outline: style.elementColors.zodiacOuterRing,
    ...semanticLinePaint(style, "zodiacOuterRing", thick),
  });
  if (drawOuterDegreeRuler) {
    draw.circle(center, ringset.rOuter10, {
      outline: style.elementColors.outerDegreeRing,
      ...semanticLinePaint(style, "outerDegreeRing", hairline),
    });
  }

  if (!isAngloWheel(chart)) {
    draw.circle(center, ringset.r10, {
      outline: style.elementColors.innerDegreeRing,
      ...semanticLinePaint(style, "innerDegreeRing", hairline),
    });
  }
  if (chart.options.showTerms || chart.options.showDecans) {
    draw.circle(center, ringset.r0, {
      outline: style.elementColors.zodiacInnerRing,
      ...semanticLinePaint(style, "zodiacInnerRing", hairline),
    });
    if (chart.options.showTerms) {
      draw.circle(center, ringset.rDecans, {
        outline: style.elementColors.termRing,
        ...semanticLinePaint(style, "termRing", hairline),
      });
    }
  }
  const deferAngloInnerBoundaries = isAngloWheel(chart) && chart.options.showHouses;
  if (!deferAngloInnerBoundaries) {
    if (isAngloWheel(chart) && ringset.rCuspOuter != null) {
      draw.circle(center, ringset.rCuspOuter, {
        outline: style.elementColors.cuspOuterRing,
        ...semanticLinePaint(style, "cuspOuterRing", hairline),
      });
    }
    draw.circle(center, ringset.rInner, {
      outline: style.elementColors.innerBoundaryRing,
      ...semanticLinePaint(style, "innerBoundaryRing", thick),
    });
    if (!isCompactWheel(chart) && !isAngloWheel(chart)) {
      draw.circle(center, ringset.rAsp, {
        outline: style.elementColors.aspectBoundaryRing,
        ...semanticLinePaint(style, "aspectBoundaryRing", hairline),
      });
    }
    if (chart.options.showHouses) {
      draw.circle(center, ringset.rHouse, {
        outline: isAngloWheel(chart)
          ? style.elementColors.angloHouseBoundaryRing
          : style.elementColors.houseBoundaryRing,
        ...semanticLinePaint(style, "houseBoundaryRing", hairline),
      });
    }
    draw.circle(center, ringset.rBase, {
      outline: isAngloWheel(chart)
        ? style.elementColors.angloBaseRing
        : style.elementColors.baseRing,
      ...semanticLinePaint(
        style,
        "baseRing",
        isAngloWheel(chart) ? hairline : ascmcPenWidth(style, chart, chartSize),
      ),
    });
  }

  if (isAngloWheel(chart)) {
    for (let deg = 0; deg < 360; deg += 30) {
      draw.line(
        [
          polar(center, ringset.rCuspOuter ?? ringset.rInner, deg, asc),
          polar(center, ringset.r30, deg, asc),
        ],
        { fill: style.elementColors.zodiacSpoke, ...semanticLinePaint(style, "zodiacSpoke", thick) },
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
      { fill: style.elementColors.zodiacSpoke, ...semanticLinePaint(style, "zodiacSpoke", thick) },
    );
  }
  if (!isAngloWheel(chart)) {
    drawRotatedLines(draw, center, asc, 10, ringset.r0, ringset.r10, {
      fill: palette.frame,
      ...semanticLinePaint(
        style,
        "degreeTick",
        degreeTickPenWidth(style, chartSize),
        {},
        "zodiac.tick.inner.10deg",
      ),
    });
    drawRotatedLines(draw, center, asc, 5, ringset.r0, ringset.r5, {
      fill: palette.frame,
      ...semanticLinePaint(style, "degreeTick", hairline, {}, "zodiac.tick.inner.5deg"),
    });
    drawRotatedLines(draw, center, asc, 1, ringset.r0, ringset.r1, {
      fill: palette.frame,
      ...semanticLinePaint(style, "degreeTick", hairline, {}, "zodiac.tick.inner.1deg"),
    });
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
          {
            fill: palette.frame,
            ...semanticLinePaint(
              style,
              "degreeTick",
              hairline,
              {},
              deg % 10 === 0
                ? "zodiac.tick.outer.10deg"
                : deg % 5 === 0
                  ? "zodiac.tick.outer.5deg"
                  : "zodiac.tick.outer.1deg",
            ),
          },
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
        {
          fill: palette.frame,
          ...semanticLinePaint(
            style,
            "degreeTick",
            degreeTickPenWidth(style, chartSize),
            {},
            "zodiac.tick.outer.10deg",
          ),
        },
      );
      drawRotatedLines(draw, center, asc, 5, ringset.rOuter0, ringset.rOuter5, {
        fill: palette.frame,
        ...semanticLinePaint(style, "degreeTick", hairline, {}, "zodiac.tick.outer.5deg"),
      });
      drawRotatedLines(draw, center, asc, 1, ringset.rOuter0, ringset.rOuter1, {
        fill: palette.frame,
        ...semanticLinePaint(style, "degreeTick", hairline, {}, "zodiac.tick.outer.1deg"),
      });
    }
  }
}

type RoutedLinePaint = NonNullable<Parameters<CanvasDraw["line"]>[1]>;

type RoutedBodyColumn = {
  key: BodyKey;
  // The foot is immutable semantic truth: true longitude and therefore house.
  footLongitude: number;
  // The painted column may move for legibility, but it never changes the foot.
  displayedLongitude: number;
  components: readonly Bounds[];
};

type RoutedCuspContext = {
  columns: readonly RoutedBodyColumn[];
  previousCusp: number;
  nextCusp: number;
  structuralLongitudes: readonly number[];
  structuralLineWidth?: number;
  /**
   * Sign-locked paint: never route around a column, always break the cusp
   * across it. The rooted turn is reserved for the modes that own it.
   */
  breakAcrossColumns?: boolean;
  /** Extra clearance carved out of the cusp on each side of a column. */
  breakGapPx?: number;
};

function boundsTouchWithin(left: Bounds, right: Bounds, clearance: number): boolean {
  return (
    left.x <= right.x + right.w + clearance &&
    left.x + left.w + clearance >= right.x &&
    left.y <= right.y + right.h + clearance &&
    left.y + left.h + clearance >= right.y
  );
}

function longitudeOnForwardArc(
  longitude: number,
  start: number,
  end: number,
  epsilon = 1e-9,
): boolean {
  const span = normalize(end - start);
  const progress = normalize(longitude - start);
  return progress > epsilon && progress <= span + epsilon;
}

function footSideOfCusp(
  footLongitude: number,
  cusp: number,
  previousCusp: number,
  nextCusp: number,
): -1 | 1 | null {
  // A foot is the immutable semantic anchor. Resolve its side from the two
  // houses adjacent to this cusp, not from the displaced glyph column. The
  // existing exact-on-ray convention assigns a nanoscale equality to the
  // preceding house.
  if (sameLongitude(footLongitude, cusp, 1e-9)) return -1;
  if (longitudeOnForwardArc(footLongitude, cusp, nextCusp)) return 1;
  if (longitudeOnForwardArc(footLongitude, previousCusp, cusp)) return -1;
  // A body from a non-adjacent house cannot give this cusp a truthful side.
  // Keep the exact cusp and omit only its occupied span instead of guessing.
  return null;
}

function segmentBoundsInterval(
  from: Pt,
  to: Pt,
  box: Bounds,
): [number, number] | null {
  let entry = 0;
  let exit = 1;
  for (const axis of [0, 1] as const) {
    const origin = from[axis];
    const direction = to[axis] - origin;
    const minimum = axis === 0 ? box.x : box.y;
    const maximum = minimum + (axis === 0 ? box.w : box.h);
    if (Math.abs(direction) < 1e-9) {
      if (origin < minimum || origin > maximum) return null;
      continue;
    }
    const first = (minimum - origin) / direction;
    const second = (maximum - origin) / direction;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry > exit) return null;
  }
  return [entry, exit];
}

function segmentIntersectsBounds(from: Pt, to: Pt, box: Bounds): boolean {
  return segmentBoundsInterval(from, to, box) != null;
}

function segmentsIntersect(
  firstFrom: Pt,
  firstTo: Pt,
  secondFrom: Pt,
  secondTo: Pt,
): boolean {
  const cross = (left: Pt, right: Pt) => left[0] * right[1] - left[1] * right[0];
  const firstVector: Pt = [
    firstTo[0] - firstFrom[0],
    firstTo[1] - firstFrom[1],
  ];
  const secondVector: Pt = [
    secondTo[0] - secondFrom[0],
    secondTo[1] - secondFrom[1],
  ];
  const betweenStarts: Pt = [
    secondFrom[0] - firstFrom[0],
    secondFrom[1] - firstFrom[1],
  ];
  const denominator = cross(firstVector, secondVector);
  const epsilon = 1e-9;
  if (Math.abs(denominator) <= epsilon) {
    if (Math.abs(cross(betweenStarts, firstVector)) > epsilon) return false;
    const firstLengthSquared =
      firstVector[0] * firstVector[0] + firstVector[1] * firstVector[1];
    if (firstLengthSquared <= epsilon) return false;
    const startProjection =
      (betweenStarts[0] * firstVector[0] + betweenStarts[1] * firstVector[1]) /
      firstLengthSquared;
    const endProjection = startProjection +
      (secondVector[0] * firstVector[0] + secondVector[1] * firstVector[1]) /
      firstLengthSquared;
    return Math.max(Math.min(startProjection, endProjection), 0) <=
      Math.min(Math.max(startProjection, endProjection), 1) + epsilon;
  }
  const firstProgress = cross(betweenStarts, secondVector) / denominator;
  const secondProgress = cross(betweenStarts, firstVector) / denominator;
  return (
    firstProgress >= -epsilon &&
    firstProgress <= 1 + epsilon &&
    secondProgress >= -epsilon &&
    secondProgress <= 1 + epsilon
  );
}

function pointSegmentDistance(point: Pt, from: Pt, to: Pt): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(point[0] - from[0], point[1] - from[1]);
  const progress = Math.max(
    0,
    Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared),
  );
  return Math.hypot(
    point[0] - (from[0] + dx * progress),
    point[1] - (from[1] + dy * progress),
  );
}

function segmentDistance(firstFrom: Pt, firstTo: Pt, secondFrom: Pt, secondTo: Pt): number {
  if (segmentsIntersect(firstFrom, firstTo, secondFrom, secondTo)) return 0;
  return Math.min(
    pointSegmentDistance(firstFrom, secondFrom, secondTo),
    pointSegmentDistance(firstTo, secondFrom, secondTo),
    pointSegmentDistance(secondFrom, firstFrom, firstTo),
    pointSegmentDistance(secondTo, firstFrom, firstTo),
  );
}

function segmentWithinDistanceOfBounds(
  from: Pt,
  to: Pt,
  box: Bounds,
  distance: number,
): boolean {
  if (segmentIntersectsBounds(from, to, box)) return true;
  const topLeft: Pt = [box.x, box.y];
  const topRight: Pt = [box.x + box.w, box.y];
  const bottomRight: Pt = [box.x + box.w, box.y + box.h];
  const bottomLeft: Pt = [box.x, box.y + box.h];
  return [
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ].some(([edgeFrom, edgeTo]) =>
    segmentDistance(from, to, edgeFrom, edgeTo) <= distance + 1e-9
  );
}

function drawRoutedRadialLine(
  draw: CanvasDraw,
  center: Pt,
  asc: number,
  longitude: number,
  radiusA: number,
  radiusB: number,
  paint: RoutedLinePaint,
  context?: RoutedCuspContext,
  onPolyline?: (points: readonly Pt[]) => void,
) {
  const innerRadius = Math.min(radiusA, radiusB);
  const outerRadius = Math.max(radiusA, radiusB);
  const snapPoint = ([x, y]: Pt): Pt => [Math.round(x), Math.round(y)];
  const straightStart = snapPoint(polar(center, innerRadius, longitude, asc));
  const straightEnd = snapPoint(polar(center, outerRadius, longitude, asc));
  const paintLine = (points: [Pt, Pt, ...Pt[]]) => {
    draw.line(points, paint);
    onPolyline?.(points);
  };
  const straight = () => paintLine([straightStart, straightEnd]);
  if (!context?.columns.length) {
    straight();
    return;
  }

  const radialVector: Pt = [
    straightEnd[0] - straightStart[0],
    straightEnd[1] - straightStart[1],
  ];
  const rayLength = Math.hypot(radialVector[0], radialVector[1]);
  if (rayLength < 1e-9) {
    straight();
    return;
  }
  // Use the exact snapped chord Canvas paints as the one geometry frame for
  // hit tests, projections, and route construction. In screen coordinates this
  // perpendicular points toward increasing zodiac longitude.
  const radialUnit: Pt = [radialVector[0] / rayLength, radialVector[1] / rayLength];
  const tangentUnit: Pt = [radialUnit[1], -radialUnit[0]];
  const corners = (box: Bounds): Pt[] => [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ];
  const lineHalfWidth = Math.max(0.25, paint.width ?? 1) / 2;
  const breakHalfWidth = lineHalfWidth + Math.max(0, context.breakGapPx ?? 0);
  const expandBounds = (box: Bounds, amount: number): Bounds => ({
    x: box.x - amount,
    y: box.y - amount,
    w: box.w + amount * 2,
    h: box.h + amount * 2,
  });
  type ProjectedBox = Bounds & {
    sMin: number;
    sMax: number;
    tMin: number;
    tMax: number;
  };
  const projectBox = (box: Bounds): ProjectedBox => {
    const projected = corners(box).map(([x, y]) => {
      const dx = x - straightStart[0];
      const dy = y - straightStart[1];
      return {
        s: dx * radialUnit[0] + dy * radialUnit[1],
        t: dx * tangentUnit[0] + dy * tangentUnit[1],
      };
    });
    return {
      ...box,
      sMin: Math.min(...projected.map(({ s }) => s)),
      sMax: Math.max(...projected.map(({ s }) => s)),
      tMin: Math.min(...projected.map(({ t }) => t)),
      tMax: Math.max(...projected.map(({ t }) => t)),
    };
  };
  const columns = context.columns.filter(({ components }) => components.length);
  const boxes = columns.flatMap(({ components }) => components);
  const strokedBoxes = boxes.map((box) => expandBounds(box, breakHalfWidth));
  const seedIndices = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) =>
      column.components.some((box) =>
        segmentWithinDistanceOfBounds(
          straightStart,
          straightEnd,
          box,
          breakHalfWidth,
        )
      )
    )
    .map(({ index }) => index);
  if (!seedIndices.length) {
    straight();
    return;
  }

  const drawSegmentedFallback = () => {
    const pointAt = (progress: number): Pt => [
      straightStart[0] + (straightEnd[0] - straightStart[0]) * progress,
      straightStart[1] + (straightEnd[1] - straightStart[1]) * progress,
    ];
    const gaps = strokedBoxes
      .map((box) => segmentBoundsInterval(straightStart, straightEnd, box))
      .filter((interval): interval is [number, number] => Boolean(interval))
      .filter(([start, end]) => end > start)
      .sort((left, right) => left[0] - right[0]);
    const merged: Array<[number, number]> = [];
    for (const gap of gaps) {
      const previous = merged[merged.length - 1];
      if (previous && gap[0] <= previous[1]) previous[1] = Math.max(previous[1], gap[1]);
      else merged.push([...gap]);
    }
    let cursor = 0;
    for (const [gapStart, gapEnd] of merged) {
      if (gapStart > cursor + 1e-6) {
        paintLine([pointAt(cursor), pointAt(gapStart)]);
      }
      cursor = Math.max(cursor, gapEnd);
    }
    if (cursor < 1 - 1e-6) {
      paintLine([pointAt(cursor), straightEnd]);
    }
  };

  // Sign-locked paint never bends a cusp: the body owns its column and the
  // cusp is the thing that yields, exactly where it crosses.
  if (context.breakAcrossColumns) {
    drawSegmentedFallback();
    return;
  }

  const visualClearancePx = 2;
  const routeClearancePx = visualClearancePx + lineHalfWidth;
  // Columns whose clearance halos touch are one current painted obstruction;
  // this is geometric and frame-local, never a historical collision group.
  const clusterGapPx = routeClearancePx * 2;
  const localPoint = (s: number, t: number): Pt => [
    straightStart[0] + radialUnit[0] * s + tangentUnit[0] * t,
    straightStart[1] + radialUnit[1] * s + tangentUnit[1] * t,
  ];
  const sides = columns.map(({ footLongitude }) =>
    footSideOfCusp(
      footLongitude,
      longitude,
      context.previousCusp,
      context.nextCusp,
    )
  );
  const connected = (leftIndex: number, rightIndex: number): boolean =>
    columns[leftIndex].components.some((left) =>
      columns[rightIndex].components.some((right) =>
        boundsTouchWithin(left, right, clusterGapPx)
      )
    );
  const expandLocalClosure = (indices: Set<number>) => {
    const queue = [...indices];
    while (queue.length) {
      const current = queue.shift()!;
      for (let candidate = 0; candidate < columns.length; candidate += 1) {
        if (indices.has(candidate) || !connected(current, candidate)) continue;
        indices.add(candidate);
        queue.push(candidate);
      }
    }
  };
  const routeIndices = new Set(seedIndices);
  expandLocalClosure(routeIndices);

  const structuralSegments = context.structuralLongitudes
    .filter((candidate, index, values) =>
      !sameLongitude(candidate, longitude) &&
      values.findIndex((value) => sameLongitude(value, candidate)) === index
    )
    .map((candidate) => [
      snapPoint(polar(center, innerRadius, candidate, asc)),
      snapPoint(polar(center, outerRadius, candidate, asc)),
    ] as [Pt, Pt]);

  // Each pass can add only a column hit by the candidate shaft. This makes the
  // search bounded by the app's finite body set and prevents collision-history
  // chains from changing an unrelated cusp.
  for (let pass = 0; pass <= columns.length; pass += 1) {
    const routeSides = new Set([...routeIndices].map((index) => sides[index]));
    if (routeSides.size !== 1 || routeSides.has(null)) {
      drawSegmentedFallback();
      return;
    }
    const footSide = [...routeSides][0]!;
    const routeSide = -footSide;
    const routeBoxes = [...routeIndices]
      .flatMap((index) => columns[index].components)
      .map(projectBox);
    const turnS = Math.max(
      0,
      Math.min(...routeBoxes.map((box) => box.sMin)) - routeClearancePx,
    );
    const routeT = routeSide < 0
      ? Math.min(...routeBoxes.map((box) => box.tMin)) - routeClearancePx
      : Math.max(...routeBoxes.map((box) => box.tMax)) + routeClearancePx;
    const rootFromCenter: Pt = [
      straightStart[0] - center[0],
      straightStart[1] - center[1],
    ];
    const rootS = rootFromCenter[0] * radialUnit[0] + rootFromCenter[1] * radialUnit[1];
    const rootT = rootFromCenter[0] * tangentUnit[0] + rootFromCenter[1] * tangentUnit[1];
    const outerS2 = outerRadius * outerRadius - (rootT + routeT) ** 2;
    if (outerS2 <= 0) {
      drawSegmentedFallback();
      return;
    }
    const outerS = -rootS + Math.sqrt(outerS2);
    if (outerS <= turnS + 0.5) {
      drawSegmentedFallback();
      return;
    }
    const candidate = [
      straightStart,
      snapPoint(localPoint(turnS, 0)),
      snapPoint(localPoint(turnS, routeT)),
      snapPoint(localPoint(outerS, routeT)),
    ].filter((point, index, points) =>
      index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]
    );
    if (candidate.length < 3) {
      drawSegmentedFallback();
      return;
    }
    const segments = candidate.slice(1).map((point, index) => [
      candidate[index],
      point,
    ] as [Pt, Pt]);
    const structuralHalfWidth = Math.max(
      0.25,
      context.structuralLineWidth ?? paint.width ?? 1,
    ) / 2;
    if (structuralSegments.some(([from, to]) =>
      segments.some(([candidateFrom, candidateTo]) =>
        segmentDistance(candidateFrom, candidateTo, from, to) <=
          lineHalfWidth + structuralHalfWidth + 1e-9
      )
    )) {
      drawSegmentedFallback();
      return;
    }
    const hitIndices = columns
      .map((column, index) => ({ column, index }))
      .filter(({ column }) =>
        column.components.some((box) =>
          segments.some(([from, to]) =>
            segmentWithinDistanceOfBounds(from, to, box, lineHalfWidth)
          )
        )
      )
      .map(({ index }) => index);
    if (!hitIndices.length) {
      paintLine(candidate as [Pt, Pt, ...Pt[]]);
      return;
    }
    if (hitIndices.some((index) => sides[index] !== footSide)) {
      drawSegmentedFallback();
      return;
    }
    const previousSize = routeIndices.size;
    hitIndices.forEach((index) => routeIndices.add(index));
    expandLocalClosure(routeIndices);
    if (routeIndices.size === previousSize) break;
  }
  drawSegmentedFallback();
}

function drawHouses(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  style: WheelRenderStyle,
  bodyLayout?: BodyLayout,
  onCuspPolyline?: (houseIndex: number, points: readonly Pt[]) => void,
) {
  const angleLongitudes = [chart.angles.asc, chart.angles.dsc, chart.angles.mc, chart.angles.ic];
  const linePaint = {
    fill: style.elementColors.houseCusp,
    ...semanticLinePaint(
      style,
      "houseCusp" as const,
      style.strokes.hairline,
      {},
      "houses.inner.cusp",
    ),
  };
  const structuralLineWidth = Math.max(
    linePaint.width ?? 1,
    semanticLinePaint(
      style,
      "angle" as const,
      style.strokes.angloStructural,
    ).width ?? 1,
  );
  const routedLayout =
    isAngloWheel(chart) && usesColumnAwareCusps(chart) && bodyLayout;
  const breakAcrossColumns = usesSignLockedLayout(chart);
  const planets = planetById(chart);
  const routedColumns: RoutedBodyColumn[] = routedLayout
    ? bodyKeys(chart).flatMap((key) => {
        const footLongitude = bodyLongitude(chart, planets, key);
        const components = routedLayout.componentBounds.get(key);
        if (footLongitude == null || !components?.length) return [];
        return [{
          key,
          footLongitude,
          displayedLongitude: footLongitude + (routedLayout.bodyShifts.get(key) ?? 0),
          components,
        }];
      })
    : [];
  const structuralLongitudes = [...chart.houses.cusps, ...angleLongitudes];
  for (let i = 0; i < 12; i++) {
    const cusp = chart.houses.cusps[i];
    if (isAngloWheel(chart) && angleLongitudes.some((angle) => sameLongitude(cusp, angle))) {
      continue;
    }
    const startRadius = Math.min(ringset.rBase, ringset.rInner);
    const endRadius = Math.max(ringset.rBase, ringset.rInner);
    if (!routedLayout) {
      const points: [Pt, Pt] = [
        polar(center, startRadius, cusp, asc),
        polar(center, endRadius, cusp, asc),
      ];
      draw.line(points, linePaint);
      onCuspPolyline?.(i + 1, points);
      continue;
    }

    drawRoutedRadialLine(
      draw,
      center,
      asc,
      cusp,
      startRadius,
      endRadius,
      linePaint,
      {
        columns: routedColumns,
        previousCusp: chart.houses.cusps[(i + 11) % 12],
        nextCusp: chart.houses.cusps[(i + 1) % 12],
        structuralLongitudes,
        structuralLineWidth,
        breakAcrossColumns,
        breakGapPx: breakAcrossColumns ? style.collision.cuspBreakGapPx : 0,
      },
      (points) => onCuspPolyline?.(i + 1, points),
    );
  }
}

function drawAngloHouseCuspTicks(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  style: WheelRenderStyle,
) {
  if (!isAngloWheel(chart)) return;
  const rulerTick = ringset.r30 * style.geometry.anglo.houseCuspTickScale;
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
        {
          fill: color,
          ...semanticLinePaint(
            style,
            "subdivision",
            style.strokes.angloStructural,
            {},
            "zodiac.tick.angloHouseCusp",
          ),
        },
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
    outline: style.elementColors.innerBoundaryRing,
    ...semanticLinePaint(
      style,
      "innerBoundaryRing",
      isAngloWheel(chart)
        ? style.strokes.hairline
        : chartRingPenWidth(style, chart, chartSize),
    ),
  });
  draw.circle(center, ringset.rBase, {
    outline: isAngloWheel(chart)
      ? style.elementColors.angloBaseRing
      : style.elementColors.baseRing,
    ...semanticLinePaint(
      style,
      "baseRing",
      isAngloWheel(chart)
        ? style.strokes.hairline
        : ascmcPenWidth(style, chart, chartSize),
    ),
  });
  if (isAngloWheel(chart) && chart.options.showHouses) {
    // Redraw the house-number boundary after cusp spokes so the intermediate
    // ring stays continuous and legible on dark themes.
    draw.circle(center, ringset.rHouse, {
      outline: style.elementColors.angloHouseBoundaryRing,
      ...semanticLinePaint(style, "houseBoundaryRing", style.strokes.hairline),
    });
  }
  if (isAngloWheel(chart) && ringset.rCuspOuter != null) {
    draw.circle(center, ringset.rCuspOuter, {
      outline: style.elementColors.cuspOuterRing,
      ...semanticLinePaint(style, "cuspOuterRing", style.strokes.hairline),
    });
  }
}

/**
 * Cap a band-dwelling glyph at the thickness of the band that holds it.
 *
 * A subdivision glyph is centred inside its ring, so a font size larger than
 * the ring is thick cannot be contained by it and spills into the neighbouring
 * rings — the overlap seen when a term ruler glyph is scaled up. The size is
 * authored, so the value itself is legitimate; what was missing is the
 * container constraint.
 *
 * resolveWheelClassFontSizeCeiling already knows which band owns a class, but
 * it is used only by the editor to widen a slider's bound and takes the larger
 * of the two values, so it can never reduce a size. This applies the band as
 * an actual ceiling at paint time.
 */
function bandClampedGlyphSize(
  classId: string,
  size: number,
  bands: readonly ResolvedWheelBand[],
  canonicalBands?: readonly ResolvedWheelBand[],
): number {
  const ceiling = resolveWheelClassFontSizeCeiling(classId, bands);
  if (ceiling == null || !(ceiling > 0)) return size;
  // A subdivision glyph follows the band that holds it: it grows as the band is
  // fattened and shrinks as the band closes, keeping the proportion the design
  // specifies at every thickness.
  //
  // Clamping alone was worse, not merely different. A glyph held one size while
  // its band shrank — so it grew steadily larger *relative* to the band — and
  // then snapped to tracking the band exactly once the ceiling bit, filling it
  // completely. That kink is what reads as pumping.
  //
  // This is a deliberate exception to "contents scale only on a scale gesture".
  // It is confined to the two subdivision glyphs, which sit alone in a band
  // narrow enough that the alternative is either a glyph swimming in space or
  // one jammed against both boundaries. Every other seated run keeps the
  // scale/resize separation.
  //
  // A global scale does not double-apply: canonical bands are resolved at the
  // same already-scaled wheel radius, so the ratio stays exactly 1 and only the
  // radius carries the scale.
  const canonicalCeiling = canonicalBands
    ? resolveWheelClassFontSizeCeiling(classId, canonicalBands)
    : null;
  const scaled = canonicalCeiling != null && canonicalCeiling > 0
    ? size * (ceiling / canonicalCeiling)
    : size;
  // The clamp stays, and is what makes containment absolute: whatever the
  // proportion works out to, the glyph never crosses its own band's edges.
  return Math.min(scaled, ceiling);
}

function drawTermsLines(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  style: WheelRenderStyle,
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
      draw.line([p1, p2], {
        fill: style.elementColors.termBoundary,
        ...semanticLinePaint(style, "termBoundary", style.strokes.hairline),
      });
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
  style: WheelRenderStyle,
) {
  if (!chart.options.showTerms || !chart.options.terms?.length) {
    return;
  }
  const paint = semanticTypographyPaint(style, "subdivisions.term.glyph", {
    font: fontSymbols,
    size: smallSymbolSize,
    color: style.elementColors.termGlyph,
  });
  for (let signIndex = 0; signIndex < chart.options.terms.length; signIndex += 1) {
    for (const segment of chart.options.terms[signIndex]) {
      // Ruler longitude + glyph resolved daemon-side.
      const midDeg = segment.rulerLon ?? signIndex * 30 + segment.size / 2;
      const pt = polar(center, ringset.rTermsPlanet, midDeg, asc);
      draw.text(
        [pt[0] - paint.size / 2, pt[1] - paint.size / 2],
        segment.rulerGlyph ?? "",
        typographyTextOpts(paint),
      );
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
  style: WheelRenderStyle,
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
    draw.line([p1, p2], {
      fill: style.elementColors.decanBoundary,
      ...semanticLinePaint(style, "decanBoundary", style.strokes.hairline),
    });
  }
}

function drawAngloCuspRuler(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  canonicalRingset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  style: WheelRenderStyle,
) {
  if (!isAngloWheel(chart) || ringset.rCuspOuter == null) return;
  const inward = Boolean(chart.options.showTerms || chart.options.showDecans);
  const direction = inward ? -1 : 1;
  const rulerTicks = style.geometry.anglo.cuspRulerTicks;
  // Each tick length is a share of the cusp ruler's own band, so widening the
  // band lengthens the ticks with it. Canonically these were fractions of the
  // whole wheel (`r30 * 0.018`), which is why they never responded to the room
  // their ruler actually had; unauthored, that exact value is what comes back.
  const rulerBand = (ringset.rCuspOuter ?? 0) - (ringset.rCuspLabelOuter ?? 0);
  const canonicalRulerBand =
    (canonicalRingset.rCuspOuter ?? 0) - (canonicalRingset.rCuspLabelOuter ?? 0);
  const tickLength = (classId: string, canonical: number) =>
    resolveWheelTickLength(
      style, "anglo", classId, rulerBand, canonicalRulerBand, canonical,
    );
  const shortTick = tickLength(
    "zodiac.tick.angloCuspRuler.1deg",
    ringset.r30 * rulerTicks.short,
  );
  const mediumTick = tickLength(
    "zodiac.tick.angloCuspRuler.5deg",
    ringset.r30 * rulerTicks.medium,
  );
  const longTick = tickLength(
    "zodiac.tick.angloCuspRuler.10deg",
    ringset.r30 * rulerTicks.long,
  );
  for (let deg = 0; deg < 360; deg += 1) {
    if (!inward && deg % 30 === 0) continue;
    const length = deg % 10 === 0 ? longTick : deg % 5 === 0 ? mediumTick : shortTick;
    draw.line(
      [
        polar(center, ringset.rCuspOuter, deg, asc),
        polar(center, ringset.rCuspOuter + direction * length, deg, asc),
      ],
      {
        fill: palette.frame,
        ...semanticLinePaint(
          style,
          "subdivision",
          style.strokes.hairline,
          {},
          deg % 10 === 0
            ? "zodiac.tick.angloCuspRuler.10deg"
            : deg % 5 === 0
              ? "zodiac.tick.angloCuspRuler.5deg"
              : "zodiac.tick.angloCuspRuler.1deg",
        ),
      },
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
  style: WheelRenderStyle,
) {
  if (!chart.options.showDecans || !chart.options.decans?.length) {
    return;
  }
  const paint = semanticTypographyPaint(style, "subdivisions.decan.glyph", {
    font: fontSymbols,
    size: smallSymbolSize,
    color: style.elementColors.decanGlyph,
  });
  // Ruler longitude + glyph resolved daemon-side (ChartDecanRuler).
  for (const signDecan of chart.options.decans) {
    for (const ruler of signDecan.rulers ?? []) {
      const pt = polar(center, ringset.rDecansPlanet, ruler.rulerLon, asc);
      draw.text(
        [pt[0] - paint.size / 2, pt[1] - paint.size / 2],
        ruler.rulerGlyph,
        typographyTextOpts(paint),
      );
    }
  }
}

function layoutHouseName(
  draw: TextMeasurer,
  center: Pt,
  radius: number,
  asc: number,
  chart: Chart,
  houseIndex: number,
  fontUi: string,
  fontSize: number,
  layoutUnit: number,
  style: WheelRenderStyle,
  classId: "houses.inner.label" | "houses.outer.label",
): PositionedText {
  const cusp = chart.houses.cusps[houseIndex];
  const nextCusp = chart.houses.cusps[(houseIndex + 1) % 12];
  const width = ((nextCusp - cusp + 360) % 360) || 30;
  const pt = polar(center, radius, cusp + width / 2, asc);
  const paint = semanticTypographyPaint(style, classId, {
    font: fontUi,
    size: fontSize,
    color: isAngloWheel(chart)
      ? style.elementColors.angloHouseLabel
      : style.elementColors.houseLabel,
  });
  if (isAngloWheel(chart)) {
    const text = String(houseIndex + 1);
    const [w, h] = draw.textsize(text, typographyTextOpts(paint));
    return {
      x: pt[0] - w / 2,
      y: pt[1] - h / 2,
      w,
      h,
      text,
      ...positionedTextPaint(paint),
      classId,
    };
  }
  let xOffset = layoutUnit * style.labels.houseClassicOffsetScale;
  let yOffset = layoutUnit * style.labels.houseClassicOffsetScale;
  if (houseIndex === 0 || houseIndex === 1) {
    xOffset = 0;
    yOffset = layoutUnit * style.labels.houseClassicOffsetScale;
    if (houseIndex === 1) {
      xOffset = layoutUnit * style.labels.houseSecondOffsetScale;
    }
  }
  const text = HOUSE_GLYPHS_ROMAN[houseIndex];
  const [w, h] = draw.textsize(text, typographyTextOpts(paint));
  return {
    x: pt[0] - xOffset,
    y: pt[1] - yOffset,
    w,
    h,
    text,
    ...positionedTextPaint(paint),
    classId,
  };
}

function drawHouseNames(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  fontUi: string,
  fontSize: number,
  layoutUnit: number,
  style: WheelRenderStyle,
  classId: "houses.inner.label" | "houses.outer.label",
) {
  void palette;
  for (let i = 0; i < 12; i++) {
    paintPositionedText(draw, [
      layoutHouseName(
        draw,
        center,
        ringset.rHouseName,
        asc,
        chart,
        i,
        fontUi,
        fontSize,
        layoutUnit,
        style,
        classId,
      ),
    ]);
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
  style: WheelRenderStyle,
) {
  for (let i = 0; i < 12; i++) {
    const pt = polar(center, ringset.rSign, i * 30 + 15, asc);
    const paint = semanticTypographyPaint(style, "zodiac.signGlyph", {
      font: fontSymbols,
      size: signSize,
      color: chart.options.signColors?.[i] ?? palette.signs,
    });
    draw.text(
      [pt[0] - paint.size / 2, pt[1] - paint.size / 2],
      signGlyph(i, chart.options.signVariant),
      typographyTextOpts(paint),
    );
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
  style: WheelRenderStyle,
  authoringClass: WheelAuthoringLineClass = "angles.inner.arrowhead",
) {
  const arrows = style.strokes.arrows;
  const left = polar(center, ringset.rASCMC, lon - arrows.halfAngleDegrees, asc);
  const right = polar(center, ringset.rASCMC, lon + arrows.halfAngleDegrees, asc);
  const apex = polar(center, ringset.rArrow, lon, asc);
  const paint = semanticLinePaint(style, "angle", width, {
    lineCap: arrows.lineCap,
    lineJoin: arrows.lineJoin,
  }, authoringClass);
  draw.line([left, right], {
    fill: color,
    ...paint,
  });
  draw.line([right, apex], {
    fill: color,
    ...paint,
  });
  draw.line([apex, left], {
    fill: color,
    ...paint,
  });
}

function drawAngloCuspArrow(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  lon: number,
  color: string,
  style: WheelRenderStyle,
) {
  const arrows = style.strokes.arrows;
  const apex = polar(center, ringset.rInner, lon, asc);
  const baseRadius = ringset.rInner - ringset.r30 * arrows.angloBaseInsetScale;
  const left = polar(center, baseRadius, lon - arrows.angloHalfAngleDegrees, asc);
  const right = polar(center, baseRadius, lon + arrows.angloHalfAngleDegrees, asc);
  const paint = semanticLinePaint(
    style,
    "angle",
    1,
    {},
    "angles.inner.arrowhead",
  );
  const ctx = draw.ctx;
  ctx.save();
  ctx.fillStyle = paint.fill ?? color;
  ctx.globalAlpha = paint.opacity ?? 1;
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
  bodyLayout?: BodyLayout,
) {
  const width = isAngloWheel(chart)
    ? style.strokes.hairline
    : ascmcPenWidth(style, chart, chartSize);
  const lons = [chart.angles.asc, chart.angles.dsc, chart.angles.mc, chart.angles.ic];
  const anglePlanets = planetById(chart);
  const angleColumns: RoutedBodyColumn[] =
    isAngloWheel(chart) && usesSignLockedLayout(chart) && bodyLayout
      ? bodyKeys(chart).flatMap((key) => {
          const footLongitude = bodyLongitude(chart, anglePlanets, key);
          const components = bodyLayout.componentBounds.get(key);
          if (footLongitude == null || !components?.length) return [];
          return [{
            key,
            footLongitude,
            displayedLongitude: footLongitude + (bodyLayout.bodyShifts.get(key) ?? 0),
            // The glyph alone. A cusp yields to the whole column, but an angle
            // carrying its own arrowhead must stay legible as one line, so it
            // notches around the opaque glyph and passes behind the thin
            // numeric rows instead of opening a column-long hole.
            components: components.slice(0, 1),
          }];
        })
      : [];
  for (let index = 0; index < lons.length; index += 1) {
    const lon = lons[index];
    if (isAngloWheel(chart)) {
      const isAscMc = index === 0 || index === 2;
      const sharedCusp =
        isAscMc && angleSharesHouseCusp(chart, index === 0 ? "__asc" : "__mc");
      const axisPaint = {
        fill: style.elementColors.angleRay,
        ...semanticLinePaint(style, "angle" as const, style.strokes.angloStructural),
      };
      // Sign-locked lets a label stand on an angle, so the axis has to yield
      // exactly like an ordinary cusp does. Every other mode keeps angle ink
      // whole and unbroken.
      if (angleColumns.length) {
        drawRoutedRadialLine(
          draw,
          center,
          asc,
          lon,
          ringset.rBase,
          ringset.rInner,
          axisPaint,
          {
            columns: angleColumns,
            previousCusp: lon - 90,
            nextCusp: lon + 90,
            structuralLongitudes: [],
            breakAcrossColumns: true,
            breakGapPx: style.collision.angleBreakGapPx,
          },
        );
      } else {
        draw.line(
          [polar(center, ringset.rBase, lon, asc), polar(center, ringset.rInner, lon, asc)],
          axisPaint,
        );
      }
      if (sharedCusp && angleArrowheadsVisible(chart)) {
        drawAngloCuspArrow(
          draw,
          center,
          ringset,
          asc,
          lon,
          style.elementColors.angleRay,
          style,
        );
      }
    } else {
      const p1 = polar(center, ringset.rBase, lon, asc);
      const p2 = polar(center, ringset.rASCMC, lon, asc);
      draw.line([p1, p2], {
        fill: style.elementColors.angleRay,
        ...semanticLinePaint(style, "angle", width),
      });
    }
  }
  if (!isAngloWheel(chart) && angleArrowheadsVisible(chart)) {
    drawArrow(draw, center, ringset, asc, chart.angles.asc, style.elementColors.angleRay, width, style);
    drawArrow(draw, center, ringset, asc, chart.angles.mc, style.elementColors.angleRay, width, style);
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
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
  includeAngles = false,
  includePositionStacks = false,
  includeSharedAngles = true,
  includeHouseCuspRays = Boolean(chart.options.showHouses),
  outerTypography = false,
  usePrimaryGlyphSize = false,
  motionMarkerRadius?: number,
  frameworkChart: Chart = chart,
): Map<LayoutKey, number> {
  // Retained in the established call contract, but ordinary cusp visibility
  // must never alter body packing; only hard angle sectors constrain it.
  void includeHouseCuspRays;
  const bodySize =
    outerTypography && !usePrimaryGlyphSize
      ? typography.outerSize
      : typography.bodySize;
  const layoutUnit = outerTypography
    ? typography.outerLayoutUnit
    : typography.layoutUnit;
  const angleLabelSize = outerTypography
    ? typography.outerAngleLabelSize
    : typography.angleLabelSize;
  const planets = planetById(chart);
  const anglo = isAngloWheel(chart);
  const ordered = layoutKeys(
    chart, includeAngles, includeSharedAngles, frameworkChart,
  )
    .map((key) => ({
      key,
      longitude: layoutLongitude(chart, planets, key, frameworkChart),
    }))
    .filter((entry): entry is { key: LayoutKey; longitude: number } => entry.longitude != null)
    .sort((a, b) => a.longitude - b.longitude);

  const shifts = new Map<LayoutKey, number>(
    ordered.map((entry) => [entry.key, 0] as const),
  );
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
  const rawBoxCache = ordered.map(() => new Map<string, LayoutRect[]>());
  const rawBoxesAt = (idx: number): LayoutRect[] => {
    const entry = ordered[idx];
    const shift = shifts.get(entry.key) ?? 0;
    const cacheKey = `${shift}`;
    const cached = rawBoxCache[idx].get(cacheKey);
    if (cached) return cached;
    const remember = (boxes: LayoutRect[]) => {
      rawBoxCache[idx].set(cacheKey, boxes);
      return boxes;
    };
    const shiftedLon = entry.longitude + shift;
    const pt = polar(center, rPlanet, shiftedLon, asc);
    const glyph = layoutGlyph(chart, planets, entry.key);
    const glyphSize = layoutGlyphSize(
      entry.key,
      bodySize,
      angleLabelSize,
      typography.syzygyScale,
    );
    const angleLabel = entry.key === "__asc" || entry.key === "__mc";
    const glyphPaint = semanticTypographyPaint(
      style,
      layoutGlyphClassId(entry.key, outerTypography),
      {
        font: layoutGlyphFont(chart, entry.key, fontSymbols, fontUi),
        size: glyphSize,
        weight:
          angleLabel
            ? style.typography.ratios.angleLabelWeight
            : undefined,
        color:
          angleLabel
            ? style.elementColors.angleLabel
            : bodyColor(chart, planets, entry.key as BodyKey, style.palette),
      },
    );
    const [w, h] = draw.textsize(
      glyph,
      typographyTextOpts(glyphPaint),
    );
    const glyphRect = angleLabel
      ? { x: pt[0] - w / 2, y: pt[1] - h / 2, w, h }
      : {
          x: pt[0] - glyphPaint.size / 2,
          y: pt[1] - glyphPaint.size / 2,
          w,
          h,
        };
    const position = style.typography.ratios.angloBodyPosition;
    const boxes = [glyphRect];

    if (!anglo) return remember(boxes);
    if (entry.key === "__asc" || entry.key === "__mc") {
      return remember(boxes);
    }
    if (includePositionStacks) {
      const bodyPosition = bodyDegMin(chart, planets, entry.key);
      if (bodyPosition) {
        const [degText, minText] = bodyPosition;
        const positionRows = [
          {
            text: `${degText}°`,
            radius: rPlanet - layoutUnit * position.degreeRadiusOffset,
            font: fontUi,
            size: typography.angloBodyPosition.degreeSize,
            classId: "bodies.inner.position.degree" as const,
          },
          {
            text: signGlyph(
              Math.floor(normalize(entry.longitude) / 30),
              chart.options.signVariant,
            ),
            radius: rPlanet - layoutUnit * position.signRadiusOffset,
            font: fontSymbols,
            size: typography.angloBodyPosition.signSize,
            classId: "bodies.inner.position.sign" as const,
          },
          {
            text: minText,
            radius: rPlanet - layoutUnit * position.minuteRadiusOffset,
            font: fontUi,
            size: typography.angloBodyPosition.minuteSize,
            classId: "bodies.inner.position.minute" as const,
          },
        ];
        for (const row of positionRows) {
          const rowPt = polar(center, row.radius, shiftedLon, asc);
          const rowPaint = semanticTypographyPaint(style, row.classId, {
            font: row.font,
            size: row.size,
            color: style.palette.positions,
          });
          const [rowW, rowH] = draw.textsize(
            row.text,
            typographyTextOpts(rowPaint),
          );
          boxes.push({
            x: rowPt[0] - rowW / 2,
            y: rowPt[1] - rowH / 2,
            w: rowW,
            h: rowH,
          });
        }
      }
    }
    const marker =
      entry.key === "__fortune" || entry.key === "__vertex" || entry.key === "__syzygy" || entry.key === "__eclipse"
        ? ""
        : planets.get(entry.key)?.motion ?? "";
    if (marker && motionMarkerRadius != null) {
      boxes.push(
        resolveMotionMarkerBounds(
          draw,
          marker,
          fontUi,
          motionMarkerSize(
            chart,
            marker,
            outerTypography ? typography.outerMotionSize : typography.motionSize,
            outerTypography,
          ),
          style,
          outerTypography ? "bodies.outer.motion" : "bodies.inner.motion",
          glyphRect,
          glyphPaint.size,
        ),
      );
    }
    return remember(boxes);
  };
  const boxCache = ordered.map(() => new Map<string, LayoutRect[]>());
  const boxesAt = (idx: number): LayoutRect[] => {
    const shift = shifts.get(ordered[idx].key) ?? 0;
    const cacheKey = `${shift}`;
    const cached = boxCache[idx].get(cacheKey);
    if (cached) return cached;
    const collision = style.collision;
    const pad = anglo
      ? Math.max(collision.bodyPadMin, layoutUnit * collision.bodyPadScale)
      : 0;
    const boxes = rawBoxesAt(idx).map((box, boxIdx) =>
      expandRect(box, boxIdx === 0 ? pad : pad * collision.positionRowPadScale),
    );
    boxCache[idx].set(cacheKey, boxes);
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

  // Angles are hard semantic boundaries. Ordinary house cusps are paint only:
  // they never perturb body placement, so showing/routing them cannot change
  // a stepped chart's label columns.
  const angleRayLongitudes = anglo
    ? [
        frameworkChart.angles.asc,
        frameworkChart.angles.dsc,
        frameworkChart.angles.mc,
        frameworkChart.angles.ic,
      ].filter(
        (lon, index, values) =>
          values.findIndex((candidate) => sameLongitude(candidate, lon)) === index,
      )
    : [];
  const fixedRayLongitudes = angleRayLongitudes;
  const fixedRays = fixedRayLongitudes.map((longitude) => {
    const rayPt = polar(center, 1, longitude, asc);
    const ux = rayPt[0] - center[0];
    const uy = rayPt[1] - center[1];
    return { longitude, ux, uy, nx: -uy, ny: ux };
  });
  const sortedSectorLongitudes = (longitudes: number[]) => longitudes
    .map((longitude) => normalize(longitude))
    .sort((left, right) => left - right);
  const hardSectorLongitudes = sortedSectorLongitudes(fixedRayLongitudes);
  // Sign-locked layout adds the twelve sign boundaries as *soft* sector walls.
  // The packer already distinguishes hard rays (angles, which reserve real
  // clearance) from soft ones, so a glyph may sit flush against a sign line but
  // never past it, and a stellium packs as one block inside its own sign.
  const signLocked = anglo && !outerTypography && usesSignLockedLayout(chart);
  // Sign-locked inverts which boundary is strict. The sign wall holds the whole
  // label column; an angle keeps only its centre line, which no body may cross,
  // while the ink itself yields and breaks. Without this the clearance an angle
  // reserves for its own label pins a dense cluster and forces it to spread
  // backwards, out of the very signs this mode exists to hold.
  const anglesArePermeable = signLocked;
  const signSectorLongitudes = signLocked
    ? sortedSectorLongitudes([
        ...fixedRayLongitudes,
        ...Array.from({ length: 12 }, (_, index) => index * 30).filter(
          (boundary) =>
            !fixedRayLongitudes.some((ray) => sameLongitude(ray, boundary)),
        ),
      ])
    : [];
  const isHardRay = (longitude: number) =>
    fixedRayLongitudes.some((ray) => sameLongitude(ray, longitude));
  // A sign whose members cannot fit inside it opens its walls rather than
  // returning the whole wheel to angle-only packing. Which wall opens is the
  // decision that matters visually: a cluster that must overflow should spill
  // in the direction that leaves the fewest bodies standing in a sign they do
  // not occupy, so opening one wall is always preferred to opening both.
  const withoutSoftWalls = (
    rays: number[],
    sectorIdx: number,
    side: "start" | "end" | "both",
  ): number[] => {
    const startIdx = sectorIdx;
    const endIdx = (sectorIdx + 1) % rays.length;
    return rays.filter((ray, index) => {
      const opened =
        (side !== "end" && index === startIdx) ||
        (side !== "start" && index === endIdx);
      return !opened || isHardRay(ray);
    });
  };
  const sectorIndexFor = (rays: number[], longitude: number): number => {
    const foot = normalize(longitude);
    let result = rays.length - 1;
    for (let idx = 0; idx < rays.length; idx += 1) {
      // Exact-on-ray belongs to the preceding sector. Use the same nanoscale
      // threshold in both the ordered packer and its bounded fallback so a
      // body can change sides only after its true longitude crosses the ray.
      if (rays[idx] < foot - 1e-9) result = idx;
      else break;
    }
    return result;
  };
  const sectorBoundsFor = (rays: number[], entry: { key: LayoutKey; longitude: number }) => {
    if (
      entry.key === "__asc" ||
      entry.key === "__mc" ||
      rays.length < 2
    ) {
      return { minimum: Number.NEGATIVE_INFINITY, maximum: Number.POSITIVE_INFINITY };
    }
    const foot = normalize(entry.longitude);
    const sectorIdx = sectorIndexFor(rays, foot);
    const start = rays[sectorIdx];
    const end = start + normalize(
      rays[(sectorIdx + 1) % rays.length] - start,
    );
    const ideal = start + normalize(foot - start);
    return { minimum: start - ideal, maximum: end - ideal };
  };
  const trueRaySectorBounds = ordered.map((entry) =>
    sectorBoundsFor(hardSectorLongitudes, entry)
  );
  const shiftStaysInTrueRaySector = (
    idx: number,
    candidateShift: number,
  ): boolean => {
    const bounds = trueRaySectorBounds[idx];
    return (
      candidateShift >= bounds.minimum - 1e-9 &&
      candidateShift <= bounds.maximum + 1e-9
    );
  };
  const boxIntersectsRay = (
    box: LayoutRect,
    ray: { ux: number; uy: number; nx: number; ny: number },
    padding = Math.max(
      style.collision.fixedRayPadMin,
      layoutUnit * style.collision.fixedRayPadScale,
    ),
  ): boolean => {
    const { ux, uy, nx, ny } = ray;
    const boxCenterX = box.x + box.w / 2;
    const boxCenterY = box.y + box.h / 2;
    const dx = boxCenterX - center[0];
    const dy = boxCenterY - center[1];
    const along = dx * ux + dy * uy;
    if (along <= 0) return false;
    const cross = Math.abs(dx * nx + dy * ny);
    const crossExtent = Math.abs(nx) * box.w / 2 + Math.abs(ny) * box.h / 2;
    return (
      cross <=
      crossExtent + padding
    );
  };
  // `infeasibleSector` names the one sector whose members could not fit, so a
  // sign-locked retry can relax exactly that sign. Audit failures report null:
  // they are not attributable to a single sector.
  type SectorPackResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly infeasibleSector: number | null };
  const packFailed = (infeasibleSector: number | null): SectorPackResult => {
    ordered.forEach((entry) => shifts.set(entry.key, 0));
    return { ok: false, infeasibleSector };
  };
  const packAngloSectors = (rays: number[]): SectorPackResult => {
    if (!anglo || outerTypography || rays.length < 2) {
      return { ok: false, infeasibleSector: null };
    }

    const bodyIndices = ordered
      .map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => entry.key !== "__asc" && entry.key !== "__mc")
      .map(({ idx }) => idx);
    if (!bodyIndices.length) return { ok: false, infeasibleSector: null };

    // Anglo body rows are a polar typesetting problem: longitude supplies the
    // desired tangent coordinate while the selected structural boundaries
    // constrain label centres. Solve every sector once with ordered isotonic projection instead
    // of repeatedly jostling pairs. The solve is linear per sector, followed by
    // one exact bounded validation over the app's fixed body set; it returns
    // clear bodies to their true feet and has no density-dependent loop.
    const tangentGapPx = Math.max(1, layoutUnit * 0.02);
    const rayGapPx = tangentGapPx;
    const position = style.typography.ratios.angloBodyPosition;
    const minimumRowRadius = includePositionStacks
      ? Math.max(1, rPlanet - layoutUnit * position.minuteRadiusOffset)
      : Math.max(1, rPlanet);
    const rayGapDegrees = Math.atan2(rayGapPx, minimumRowRadius) * 180 / Math.PI;
    const signedDelta = (left: number, right: number) =>
      ((left - right + 540) % 360) - 180;
    const longitudeAt = (x: number, y: number) =>
      normalize(
        asc + Math.atan2(center[1] - y, x - center[0]) * 180 / Math.PI - 180,
      );
    const footprintAt = (
      idx: number,
      candidateLongitude: number,
      firstBox = 0,
    ): { left: number; right: number } => {
      const entry = ordered[idx];
      const saved = shifts.get(entry.key) ?? 0;
      shifts.set(entry.key, candidateLongitude - entry.longitude);
      let minimum = 0;
      let maximum = 0;
      for (const box of rawBoxesAt(idx).slice(firstBox)) {
        const padded = expandRect(box, tangentGapPx / 2);
        for (const [x, y] of [
          [padded.x, padded.y],
          [padded.x + padded.w, padded.y],
          [padded.x, padded.y + padded.h],
          [padded.x + padded.w, padded.y + padded.h],
        ] as Pt[]) {
          const delta = signedDelta(longitudeAt(x, y), normalize(candidateLongitude));
          minimum = Math.min(minimum, delta);
          maximum = Math.max(maximum, delta);
        }
      }
      shifts.set(entry.key, saved);
      return { left: -minimum, right: maximum };
    };
    const isotonicProjection = (values: number[]): number[] => {
      type Block = { start: number; end: number; sum: number; count: number; mean: number };
      const blocks: Block[] = [];
      for (let idx = 0; idx < values.length; idx += 1) {
        blocks.push({ start: idx, end: idx, sum: values[idx], count: 1, mean: values[idx] });
        while (
          blocks.length > 1 &&
          blocks[blocks.length - 2].mean > blocks[blocks.length - 1].mean
        ) {
          const right = blocks.pop()!;
          const left = blocks.pop()!;
          const sum = left.sum + right.sum;
          const count = left.count + right.count;
          blocks.push({
            start: left.start,
            end: right.end,
            sum,
            count,
            mean: sum / count,
          });
        }
      }
      const projected = new Array<number>(values.length);
      for (const block of blocks) {
        for (let idx = block.start; idx <= block.end; idx += 1) {
          projected[idx] = block.mean;
        }
      }
      return projected;
    };
    const angleObstacle = (longitude: number, side: "left" | "right") => {
      const angleIdx = ordered.findIndex(
        (entry) =>
          (entry.key === "__asc" || entry.key === "__mc") &&
          sameLongitude(entry.longitude, longitude),
      );
      if (angleIdx < 0) return 0;
      const footprint = footprintAt(angleIdx, longitude);
      return side === "left" ? footprint.right : footprint.left;
    };

    for (let sectorIdx = 0; sectorIdx < rays.length; sectorIdx += 1) {
      const start = rays[sectorIdx];
      const end = start + normalize(rays[(sectorIdx + 1) % rays.length] - start);
      const members = bodyIndices
        .filter((idx) => sectorIndexFor(rays, ordered[idx].longitude) === sectorIdx)
        .map((idx) => ({
          idx,
          ideal: start + normalize(ordered[idx].longitude - start),
        }))
        .sort((left, right) => {
          const angularOrder = left.ideal - right.ideal;
          if (angularOrder) return angularOrder;
          const leftKey = String(ordered[left.idx].key);
          const rightKey = String(ordered[right.idx].key);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        });
      if (!members.length) continue;

      const footprintsFor = (
        firstBox = 0,
        longitudes = members.map((member) => member.ideal),
      ) => members.map(({ idx }, memberIdx) =>
        footprintAt(idx, longitudes[memberIdx], firstBox)
      );
      const firstLayoutBox = 0;
      let footprints = footprintsFor(firstLayoutBox);
      const geometry = () => {
        const cumulative = new Array<number>(members.length).fill(0);
        for (let idx = 1; idx < members.length; idx += 1) {
          cumulative[idx] =
            cumulative[idx - 1] + footprints[idx - 1].right + footprints[idx].left;
        }
        const leftWall = footprintAt(members[0].idx, start, firstLayoutBox);
        const rightWall = footprintAt(
          members[members.length - 1].idx,
          end,
          firstLayoutBox,
        );
        // Three kinds of wall, not two. A guarded angle reserves room for its
        // own label and a visible gap. A permeable angle reserves nothing: the
        // centre still cannot be crossed, but a label may stand on the line and
        // notch it. A sign wall reserves the member's own footprint, so the
        // whole column stays inside the sign.
        const clearanceAt = (ray: number, side: "left" | "right", wall: number) => {
          if (fixedRayLongitudes.some((candidate) => sameLongitude(candidate, ray))) {
            return anglesArePermeable
              ? 1e-9
              : angleObstacle(ray, side) + rayGapDegrees + wall;
          }
          return wall + 1e-9;
        };
        return {
          cumulative,
          // A hard ray additionally reserves room for the angle's own label and
          // a visible gap. A soft ray reserves only the member's footprint, so
          // the whole column sits inside its sign and cannot collide with the
          // neighbouring sign's column across the boundary.
          lower: start + clearanceAt(start, "left", leftWall.left),
          upper:
            end -
            clearanceAt(end, "right", rightWall.right) -
            cumulative[cumulative.length - 1],
        };
      };
      let { cumulative, lower, upper } = geometry();
      if (lower > upper + 1e-9) return packFailed(sectorIdx);
      const project = () => {
        const projected = isotonicProjection(
          members.map((member, idx) => member.ideal - cumulative[idx]),
        );
        if (lower > upper) {
          // Angular envelopes are deliberately conservative unions of several
          // independent radial rows. When they exceed the sector by a sliver,
          // use the minimum-span centered projection and let the exact 2-D box
          // and ray audit below decide; no heuristic relaxation is retained.
          const centered = (lower + upper) / 2;
          return projected.map(() => centered);
        }
        return projected.map((value) => Math.min(upper, Math.max(lower, value)));
      };
      let projected = project();
      let displayedLongitudes = projected.map((value, idx) => value + cumulative[idx]);
      // Axis-aligned Canvas boxes change angular footprint slightly after the
      // projection. One fixed refinement at the projected coordinates keeps
      // the solve exact without an unbounded relaxation loop.
      footprints = footprintsFor(firstLayoutBox, displayedLongitudes);
      ({ cumulative, lower, upper } = geometry());
      if (lower > upper + 1e-9) return packFailed(sectorIdx);
      projected = project();
      displayedLongitudes = projected.map((value, idx) => value + cumulative[idx]);
      members.forEach((member, idx) => {
        const displayed = displayedLongitudes[idx];
        shifts.set(ordered[member.idx].key, displayed - member.ideal);
      });
    }

    const packedBoxes = ordered.map((_, idx) =>
      rawBoxesAt(idx).map((box) => expandRect(box, tangentGapPx / 2)),
    );
    for (let leftIdx = 0; leftIdx < count - 1; leftIdx += 1) {
      for (let rightIdx = leftIdx + 1; rightIdx < count; rightIdx += 1) {
        if (boxSetsOverlap(packedBoxes[leftIdx], packedBoxes[rightIdx])) {
          return packFailed(null);
        }
      }
    }
    const packedSectorBounds = ordered.map((entry) => sectorBoundsFor(rays, entry));
    for (const idx of bodyIndices) {
      const shift = shifts.get(ordered[idx].key) ?? 0;
      const bounds = packedSectorBounds[idx];
      if (
        shift < bounds.minimum - 1e-9 ||
        shift > bounds.maximum + 1e-9 ||
        (!anglesArePermeable &&
          fixedRays.some((ray) =>
            rawBoxesAt(idx).some((box) => boxIntersectsRay(box, ray, rayGapPx)),
          ))
      ) {
        return packFailed(null);
      }
    }
    return { ok: true };
  };
  // The packer minimizes displacement from true feet; it has no notion that
  // standing in the wrong sign costs anything. When a solved sector has room
  // left over, slide it as one rigid block toward the side that returns bodies
  // to their own sign. Order, spacing, and every true foot are untouched: only
  // the block's position inside its own sector changes.
  const improveSignResidency = (rays: number[]) => {
    if (rays.length < 2) return;
    const bodyIndices = ordered
      .map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => entry.key !== "__asc" && entry.key !== "__mc")
      .map(({ idx }) => idx);
    if (!bodyIndices.length) return;
    const bounds = ordered.map((entry) => sectorBoundsFor(rays, entry));
    const signOf = (longitude: number) => Math.floor(normalize(longitude) / 30);
    // How far past its own sign a body stands. Two placements can strand the
    // same number of bodies while one keeps them hard against their own sign
    // and the other flings them a whole sign away; this is what separates them,
    // and it is what makes the block travel toward residency rather than
    // settling for the least movement.
    const exileOf = (foot: number, shift: number) => {
      const home = Math.floor(normalize(foot) / 30) * 30;
      const offset = ((normalize(foot + shift) - home + 540) % 360) - 180;
      if (offset >= 0 && offset < 30) return 0;
      return offset < 0 ? -offset : offset - 30;
    };
    // A rigid translation cannot change spacing inside the moved block, so only
    // the moved members can newly collide, leave their sector, or reach an
    // angle. Everything else is already known good from the solve.
    const stateIsLegal = (moved: readonly number[]): boolean => {
      const isMoved = new Set(moved);
      for (const idx of moved) {
        const boxes = rawBoxesAt(idx);
        const shift = shifts.get(ordered[idx].key) ?? 0;
        if (
          shift < bounds[idx].minimum - 1e-9 ||
          shift > bounds[idx].maximum + 1e-9 ||
          (!anglesArePermeable &&
            fixedRays.some((ray) => boxes.some((box) => boxIntersectsRay(box, ray))))
        ) {
          return false;
        }
        for (let other = 0; other < count; other += 1) {
          if (isMoved.has(other)) continue;
          if (boxSetsOverlap(boxes, rawBoxesAt(other))) return false;
        }
      }
      return true;
    };
    type Residency = { strays: number; exile: number; worst: number; travel: number };
    const score = (): Residency => {
      let strays = 0;
      let exile = 0;
      let worst = 0;
      let travel = 0;
      for (const idx of bodyIndices) {
        const shift = shifts.get(ordered[idx].key) ?? 0;
        travel += Math.abs(shift);
        const beyond = exileOf(ordered[idx].longitude, shift);
        if (beyond > 0) {
          strays += 1;
          exile += beyond;
          worst = Math.max(worst, beyond);
        }
      }
      return { strays, exile, worst, travel };
    };
    // An over-full sign has a flat optimum: every position that strands the
    // same bodies costs the same total exile, because one body's gain is
    // another's loss. Least travel picks the end of that plateau nearest the
    // solver's own starting point, which is how a cluster ends up flung a whole
    // sign backwards while an equally optimal placement sat beside its sign.
    // Settle the plateau on the smallest worst case instead, so no single body
    // is stranded far from the sign it occupies.
    const better = (candidate: Residency, incumbent: Residency) => {
      const ladder: ReadonlyArray<(value: Residency) => number> = [
        (value) => value.strays,
        (value) => value.exile,
        (value) => value.worst,
        (value) => value.travel,
      ];
      for (const rung of ladder) {
        const delta = rung(candidate) - rung(incumbent);
        if (delta < -1e-9) return true;
        if (delta > 1e-9) return false;
      }
      return false;
    };

    // Nothing to rescue on an ordinary chart, and this is the common case.
    if (score().strays === 0) return;

    for (let sectorIdx = 0; sectorIdx < rays.length; sectorIdx += 1) {
      const members = bodyIndices.filter(
        (idx) => sectorIndexFor(rays, ordered[idx].longitude) === sectorIdx,
      );
      if (!members.length) continue;
      const strayingHere = members.some((idx) => {
        const shift = shifts.get(ordered[idx].key) ?? 0;
        return signOf(ordered[idx].longitude + shift) !== signOf(ordered[idx].longitude);
      });
      if (!strayingHere) continue;
      const base = members.map((idx) => shifts.get(ordered[idx].key) ?? 0);
      // Two finite families of offers, and between them they contain every
      // position worth testing. Sign edges are where the stray count can
      // change; the crossings are where two bodies are exiled equally far,
      // which is where the worst case is smallest. Without the crossings the
      // search can only land on an edge and the balanced placement between two
      // edges is unreachable.
      const margin = style.collision.signResidencyMarginDegrees;
      const wrap = (value: number) => ((value + 540) % 360) - 180;
      const edges = members.map((idx, memberIdx) => {
        const home = signOf(ordered[idx].longitude) * 30;
        return {
          displayed: ordered[idx].longitude + base[memberIdx],
          lower: home + margin,
          upper: home + 30 - margin,
        };
      });
      // The block can only travel as far as its most constrained member allows.
      // Establishing that window first turns the candidate families into a
      // handful of real offers instead of a long list that is mostly rejected
      // by the audits one expensive validation at a time.
      let travelMin = Number.NEGATIVE_INFINITY;
      let travelMax = Number.POSITIVE_INFINITY;
      members.forEach((idx, memberIdx) => {
        travelMin = Math.max(travelMin, bounds[idx].minimum - base[memberIdx]);
        travelMax = Math.min(travelMax, bounds[idx].maximum - base[memberIdx]);
      });
      const deltas = new Set<number>();
      const offer = (value: number) => {
        const delta = wrap(value);
        if (delta < travelMin - 1e-9 || delta > travelMax + 1e-9) return;
        // Coarse enough to collapse duplicates, fine enough that the balanced
        // placement is not rounded away.
        deltas.add(Math.round(delta * 1000) / 1000);
      };
      for (const edge of edges) {
        offer(edge.lower - edge.displayed);
        offer(edge.upper - edge.displayed);
      }
      for (const below of edges) {
        for (const above of edges) {
          if (below === above) continue;
          offer((below.lower - below.displayed + above.upper - above.displayed) / 2);
        }
      }
      const apply = (delta: number) => {
        members.forEach((idx, memberIdx) => {
          shifts.set(ordered[idx].key, base[memberIdx] + delta);
        });
      };
      let incumbent = score();
      let bestDelta = 0;
      for (const delta of [...deltas].sort((left, right) => left - right)) {
        if (Math.abs(delta) < 1e-9) continue;
        apply(delta);
        if (stateIsLegal(members)) {
          const candidate = score();
          if (better(candidate, incumbent)) {
            incumbent = candidate;
            bestDelta = delta;
          }
        }
        apply(bestDelta);
      }
      apply(bestDelta);
    }
  };

  if (signLocked) {
    const readShifts = () => ordered.map((entry) => shifts.get(entry.key) ?? 0);
    const writeShifts = (values: readonly number[]) => {
      ordered.forEach((entry, idx) => shifts.set(entry.key, values[idx]));
    };
    // The objective a reader actually sees: a body standing in a sign it does
    // not occupy. Ties break on total travel, so an overflow stays as close to
    // its true feet as the walls allow.
    const displacementCost = (): { strays: number; travel: number } => {
      let strays = 0;
      let travel = 0;
      ordered.forEach((entry, idx) => {
        if (entry.key === "__asc" || entry.key === "__mc") return;
        const shift = shifts.get(entry.key) ?? 0;
        travel += Math.abs(shift);
        if (
          Math.floor(normalize(entry.longitude) / 30) !==
            Math.floor(normalize(entry.longitude + shift) / 30)
        ) {
          strays += 1;
        }
        void idx;
      });
      return { strays, travel };
    };
    // Bounded by the twelve sign walls: every retry strictly shrinks the ray
    // set and the worst case converges on the angle-only sectors below.
    let rays = signSectorLongitudes;
    for (let attempt = 0; rays.length >= 2 && attempt <= 12; attempt += 1) {
      const result = packAngloSectors(rays);
      if (result.ok) {
        improveSignResidency(rays);
        return shifts;
      }
      if (result.infeasibleSector == null) break;
      // Prefer spilling over exactly one wall. Both single-wall openings are
      // solved and scored; opening both walls is the last resort.
      let best: { rays: number[]; shifts: number[]; strays: number; travel: number } | null =
        null;
      for (const side of ["start", "end"] as const) {
        const candidateRays = withoutSoftWalls(rays, result.infeasibleSector, side);
        if (candidateRays.length === rays.length || candidateRays.length < 2) continue;
        if (!packAngloSectors(candidateRays).ok) continue;
        const { strays, travel } = displacementCost();
        if (
          !best ||
          strays < best.strays ||
          (strays === best.strays && travel < best.travel - 1e-9)
        ) {
          best = { rays: candidateRays, shifts: readShifts(), strays, travel };
        }
      }
      if (best) {
        writeShifts(best.shifts);
        improveSignResidency(best.rays);
        return shifts;
      }
      const opened = withoutSoftWalls(rays, result.infeasibleSector, "both");
      if (opened.length === rays.length) break;
      rays = opened;
    }
  }
  // The bounded shift search below is the degraded last resort and keeps the
  // angle-only walls in every mode; sign locking is a packer guarantee, not a
  // constraint the fallback can honour without risking an unsolvable frame.
  if (packAngloSectors(hardSectorLongitudes).ok) {
    if (signLocked) improveSignResidency(hardSectorLongitudes);
    return shifts;
  }

  const layoutIsCoherent = (): boolean => {
    const currentBoxes = ordered.map((_, idx) => boxesAt(idx));
    const boxesByLeft = currentBoxes
      .flatMap((boxes, owner) => boxes.map((box) => ({ box, owner })))
      .sort((left, right) => left.box.x - right.box.x);
    for (let leftIdx = 0; leftIdx < boxesByLeft.length - 1; leftIdx += 1) {
      const left = boxesByLeft[leftIdx];
      const leftEdge = left.box.x + left.box.w;
      for (let rightIdx = leftIdx + 1; rightIdx < boxesByLeft.length; rightIdx += 1) {
        const right = boxesByLeft[rightIdx];
        if (right.box.x >= leftEdge) break;
        if (
          left.owner !== right.owner &&
          overlap(
            left.box.x,
            left.box.y,
            left.box.w,
            left.box.h,
            right.box.x,
            right.box.y,
            right.box.w,
            right.box.h,
          )
        ) {
          return false;
        }
      }
    }
    return ordered.every((entry, idx) =>
      entry.key === "__asc" || entry.key === "__mc"
        ? true
        : shiftStaysInTrueRaySector(
            idx,
            shifts.get(entry.key) ?? 0,
          ) &&
          fixedRays.every((ray) =>
            currentBoxes[idx].every((box) => !boxIntersectsRay(box, ray)),
          ),
    );
  };
  const shiftPathCrossesBody = (
    idx: number,
    startShift: number,
    delta: number,
    excluded = new Set<number>([idx]),
  ): boolean => {
    const direction = Math.sign(delta);
    const distance = Math.abs(delta);
    if (!direction) return false;
    const start = normalize(ordered[idx].longitude + startShift);
    return ordered.some((other, otherIdx) => {
      if (excluded.has(otherIdx)) return false;
      const otherLongitude = normalize(
        other.longitude + (shifts.get(other.key) ?? 0),
      );
      const towardBody = direction > 0
        ? normalize(otherLongitude - start)
        : normalize(start - otherLongitude);
      return towardBody > 1e-9 && towardBody < distance - 1e-9;
    });
  };

  const releaseClearShift = (idx: number): boolean => {
    const entry = ordered[idx];
    const currentShift = shifts.get(entry.key) ?? 0;
    if (currentShift === 0) return false;

    shifts.set(entry.key, 0);
    const trueBoxes = boxesAt(idx);
    const clearsBodies = ordered.every(
      (_, otherIdx) =>
        otherIdx === idx || !boxSetsOverlap(trueBoxes, boxesAt(otherIdx)),
    );
    const clearsFixedRays =
      entry.key === "__asc" ||
      entry.key === "__mc" ||
      fixedRays.every((ray) =>
        trueBoxes.every((box) => !boxIntersectsRay(box, ray)),
      );
    if (clearsBodies && clearsFixedRays) return true;

    shifts.set(entry.key, currentShift);
    return false;
  };
  const collisionClusters = (): number[][] => {
    // Spacing may be necessary inside a dense group, but a shared translation
    // of that whole group is never semantic. Derive groups from collisions at
    // their true longitudes so independent bodies and clusters cannot pull one
    // another away from their own ticks. This graph is private to body
    // recentering; structural paint reads only current painted geometry.
    const savedShifts = ordered.map((entry) => shifts.get(entry.key) ?? 0);
    ordered.forEach((entry) => shifts.set(entry.key, 0));
    const trueBoxes = ordered.map((_, idx) => boxesAt(idx));
    ordered.forEach((entry, idx) => shifts.set(entry.key, savedShifts[idx]));

    const parents = ordered.map((_, idx) => idx);
    const find = (idx: number): number => {
      let root = idx;
      while (parents[root] !== root) root = parents[root];
      while (parents[idx] !== idx) {
        const parent = parents[idx];
        parents[idx] = root;
        idx = parent;
      }
      return root;
    };
    const unite = (leftIdx: number, rightIdx: number) => {
      const leftRoot = find(leftIdx);
      const rightRoot = find(rightIdx);
      if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
    };
    for (let leftIdx = 0; leftIdx < count - 1; leftIdx += 1) {
      for (let rightIdx = leftIdx + 1; rightIdx < count; rightIdx += 1) {
        if (boxSetsOverlap(trueBoxes[leftIdx], trueBoxes[rightIdx])) {
          unite(leftIdx, rightIdx);
        }
      }
    }
    const byRoot = new Map<number, number[]>();
    for (let idx = 0; idx < count; idx += 1) {
      const root = find(idx);
      const cluster = byRoot.get(root) ?? [];
      cluster.push(idx);
      byRoot.set(root, cluster);
    }
    return [...byRoot.values()].filter((cluster) => cluster.length > 1);
  };
  const recenterCollisionClusters = (clusters: number[][]) => {
    if (!layoutIsCoherent()) return;
    for (const cluster of clusters) {
      const baseShifts = cluster.map((idx) => shifts.get(ordered[idx].key) ?? 0);
      const commonShift =
        baseShifts.reduce((sum, shift) => sum + shift, 0) / baseShifts.length;
      const targetDelta = -commonShift;
      if (Math.abs(targetDelta) < 1e-9) continue;

      const applyDelta = (delta: number) => {
        cluster.forEach((idx, clusterIdx) =>
          shifts.set(ordered[idx].key, baseShifts[clusterIdx] + delta),
        );
      };
      const crossesIndependentBody = (delta: number): boolean => {
        const clusterSet = new Set(cluster);
        return cluster.some((idx, clusterIdx) =>
          shiftPathCrossesBody(idx, baseShifts[clusterIdx], delta, clusterSet),
        );
      };
      const deltaIsClear = (delta: number): boolean => {
        if (
          cluster.some((idx, clusterIdx) =>
            !shiftStaysInTrueRaySector(
              idx,
              baseShifts[clusterIdx] + delta,
            ),
          )
        ) {
          return false;
        }
        applyDelta(delta);
        return (
          !crossesIndependentBody(delta) &&
          layoutIsCoherent()
        );
      };

      if (deltaIsClear(targetDelta)) continue;

      // A cusp, angle, or independent body can bound recentering. Move only
      // as far as the first valid side permits; never teleport the current
      // group across fixed structural geometry or another label.
      let clearDelta = 0;
      let blockedDelta = targetDelta;
      while (
        Math.abs(blockedDelta - clearDelta) > style.collision.shiftStepDegrees
      ) {
        const candidate = (clearDelta + blockedDelta) / 2;
        if (deltaIsClear(candidate)) clearDelta = candidate;
        else blockedDelta = candidate;
      }
      applyDelta(clearDelta);
    }
  };
  const tightenCollisionClusters = (clusters: number[][]) => {
    if (!layoutIsCoherent()) return;
    for (const cluster of clusters) {
      const baseShifts = cluster.map((idx) => shifts.get(ordered[idx].key) ?? 0);
      const maximumShift = Math.max(...baseShifts.map(Math.abs));
      if (maximumShift < style.collision.shiftStepDegrees) continue;

      const applyScale = (scale: number) => {
        cluster.forEach((idx, clusterIdx) =>
          shifts.set(ordered[idx].key, baseShifts[clusterIdx] * scale),
        );
      };

      // A solved cluster can be collision-free yet wider than this frame
      // requires. First prove that one canonical 0.1-degree contraction is
      // safe; an already-tight cluster then remains bit-stable on every pass.
      const oneStepScale = Math.max(
        0,
        1 - style.collision.shiftStepDegrees / maximumShift,
      );
      applyScale(oneStepScale);
      if (!layoutIsCoherent()) {
        applyScale(1);
        continue;
      }

      let blockedScale = 0;
      let clearScale = oneStepScale;
      applyScale(blockedScale);
      if (layoutIsCoherent()) continue;
      while (
        (clearScale - blockedScale) * maximumShift >
        style.collision.shiftStepDegrees
      ) {
        const candidate = (blockedScale + clearScale) / 2;
        applyScale(candidate);
        if (layoutIsCoherent()) clearScale = candidate;
        else blockedScale = candidate;
      }
      applyScale(clearScale);
    }
  };
  const normalizedShifts = (): Map<LayoutKey, number> => {
    // A nonzero offset may survive only while the body's true longitude is
    // obstructed in this frame. Sweep both ways so releasing one body can free
    // its neighbor, then remove any non-semantic translation shared by a
    // collision cluster.
    // Members of a true-longitude collision cluster move as one group here:
    // releasing one member against the group's old translated positions can
    // manufacture a false "clear" result and tear the group apart. Isolated
    // bodies, by contrast, return directly to zero whenever their true tick is
    // clear; their historical path is not an obstruction.
    const clusters = collisionClusters();
    const clustered = new Set(clusters.flat());
    for (let idx = 0; idx < count; idx += 1) {
      if (!clustered.has(idx)) releaseClearShift(idx);
    }
    for (let idx = count - 1; idx >= 0; idx -= 1) {
      if (!clustered.has(idx)) releaseClearShift(idx);
    }
    recenterCollisionClusters(clusters);
    tightenCollisionClusters(clusters);
    // All write paths are sector-guarded. Keep a final fail-safe at the return
    // boundary so impossible geometry falls back to its truthful foot instead
    // of ever painting a body on the far side of a cusp or angle.
    ordered.forEach((entry, idx) => {
      const shift = shifts.get(entry.key) ?? 0;
      if (!shiftStaysInTrueRaySector(idx, shift)) shifts.set(entry.key, 0);
    });
    return shifts;
  };

  // The old solver advanced by 0.1° and remeasured every box at every tick,
  // turning a single dense conflict into thousands of Canvas text probes. Find
  // the same first clear tick with exponential bracketing plus integer binary
  // search. Local angular separation is monotonic until these neighboring boxes
  // clear, so this preserves the 0.1° endpoint with logarithmic probe count.
  const firstClearAttempt = (
    collidesAt: (attempt: number) => boolean,
    maxAttempts = style.collision.maxShiftAttempts,
  ): number => {
    if (maxAttempts <= 0) return 0;
    let low = 0;
    let high = Math.min(1, maxAttempts);
    while (high < maxAttempts && collidesAt(high)) {
      low = high;
      high = Math.min(maxAttempts, high * 2);
    }
    if (collidesAt(high)) return maxAttempts;
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (collidesAt(mid)) low = mid;
      else high = mid;
    }
    return high;
  };

  const maximumSectorSafeAttempts = (
    idx: number,
    baseShift: number,
    direction: -1 | 1,
  ): number => {
    const bounds = trueRaySectorBounds[idx];
    const available = direction > 0
      ? bounds.maximum - baseShift
      : baseShift - bounds.minimum;
    if (!Number.isFinite(available)) return style.collision.maxShiftAttempts;
    return Math.max(
      0,
      Math.min(
        style.collision.maxShiftAttempts,
        Math.floor((available - 1e-9) / style.collision.shiftStepDegrees),
      ),
    );
  };

  const avoidFixedRays = (): boolean => {
    if (!fixedRays.length) return false;
    let shifted = false;
    for (let idx = 0; idx < count; idx += 1) {
      const key = ordered[idx].key;
      if (key === "__asc" || key === "__mc") continue;
      const collidingRayAtCurrentShift = () => {
        const boxes = boxesAt(idx);
        return fixedRays.find((ray) =>
          boxes.some((box) => boxIntersectsRay(box, ray)),
        );
      };
      if (collidingRayAtCurrentShift() == null) continue;

      const baseShift = shifts.get(key) ?? 0;
      const firstClearShift = (direction: -1 | 1): number | null => {
        let candidateShift = baseShift;
        shifts.set(key, candidateShift);
        for (let round = 0; round < fixedRays.length; round += 1) {
          const collidingRay = collidingRayAtCurrentShift();
          if (collidingRay == null) return candidateShift;
          const rayBaseShift = candidateShift;
          const applyAttempt = (attempt: number) => {
            candidateShift =
              rayBaseShift + direction * attempt * style.collision.shiftStepDegrees;
            shifts.set(key, candidateShift);
          };
          const maximumAttempts = maximumSectorSafeAttempts(
            idx,
            rayBaseShift,
            direction,
          );
          const attempts = firstClearAttempt(
            (attempt) => {
              applyAttempt(attempt);
              return boxesAt(idx).some((box) => boxIntersectsRay(box, collidingRay));
            },
            maximumAttempts,
          );
          applyAttempt(attempts);
          if (
            attempts === maximumAttempts &&
            boxesAt(idx).some((box) => boxIntersectsRay(box, collidingRay))
          ) {
            return null;
          }
        }
        return collidingRayAtCurrentShift() == null ? candidateShift : null;
      };

      const candidateOverlapCount = (candidateShift: number): number => {
        shifts.set(key, candidateShift);
        const candidateBoxes = boxesAt(idx);
        let overlaps = 0;
        for (let otherIdx = 0; otherIdx < count; otherIdx += 1) {
          if (otherIdx === idx) continue;
          if (boxSetsOverlap(candidateBoxes, boxesAt(otherIdx))) overlaps += 1;
        }
        return overlaps;
      };
      const candidates = [firstClearShift(-1), firstClearShift(1)]
        .filter((candidate): candidate is number => candidate != null)
        .filter((candidate) => shiftStaysInTrueRaySector(idx, candidate))
        .map((candidate) => ({
          shift: candidate,
          overlaps: candidateOverlapCount(candidate),
        }))
        .sort(
          (left, right) =>
            left.overlaps - right.overlaps ||
            Math.abs(left.shift) - Math.abs(right.shift) ||
            Math.abs(left.shift - baseShift) - Math.abs(right.shift - baseShift) ||
            left.shift - right.shift,
        );
      const resolvedShift = candidates[0]?.shift ?? baseShift;
      shifts.set(key, resolvedShift);
      shifted = shifted || resolvedShift !== baseShift;
    }
    return shifted;
  };

  const doShift = (
    leftIdx: number,
    rightIdx: number,
    forward = false,
    extraGap = 0,
  ): boolean => {
    const initialLeft = boxesAt(leftIdx);
    const initialRight = boxesAt(rightIdx);
    if (!boxSetsOverlap(initialLeft, initialRight, extraGap)) return false;
    const leftKey = ordered[leftIdx].key;
    const rightKey = ordered[rightIdx].key;
    const baseLeftShift = shifts.get(leftKey) ?? 0;
    const baseRightShift = shifts.get(rightKey) ?? 0;
    const leftCapacity = maximumSectorSafeAttempts(leftIdx, baseLeftShift, -1);
    const rightCapacity = maximumSectorSafeAttempts(rightIdx, baseRightShift, 1);
    const maximumAttempts = forward
      ? Math.min(
          style.collision.maxShiftAttempts,
          rightCapacity + leftCapacity,
        )
      : Math.max(leftCapacity, rightCapacity);
    const applyAttempt = (attempt: number) => {
      // Preserve the ordinary symmetric solve. At a sector boundary, freeze
      // only that side and let the other body absorb the remaining separation.
      // Forward cascades retain their historical right-first priority, using
      // the left side only after the right reaches its hard ray boundary.
      const rightAttempt = Math.min(attempt, rightCapacity);
      const leftAttempt = forward
        ? Math.min(Math.max(0, attempt - rightCapacity), leftCapacity)
        : Math.min(attempt, leftCapacity);
      shifts.set(
        leftKey,
        baseLeftShift - leftAttempt * style.collision.shiftStepDegrees,
      );
      shifts.set(
        rightKey,
        baseRightShift + rightAttempt * style.collision.shiftStepDegrees,
      );
    };
    const attempts = firstClearAttempt(
      (attempt) => {
        applyAttempt(attempt);
        return boxSetsOverlap(boxesAt(leftIdx), boxesAt(rightIdx), extraGap);
      },
      maximumAttempts,
    );
    applyAttempt(attempts);
    if (
      !boxSetsOverlap(boxesAt(leftIdx), boxesAt(rightIdx), extraGap) &&
      shiftStaysInTrueRaySector(leftIdx, shifts.get(leftKey) ?? 0) &&
      shiftStaysInTrueRaySector(rightIdx, shifts.get(rightKey) ?? 0)
    ) {
      return true;
    }
    shifts.set(leftKey, baseLeftShift);
    shifts.set(rightKey, baseRightShift);
    return false;
  };

  const doArrange = (forward = false) => {
    // A pair whose boxes are larger than the available ring can remain
    // overlapped after maxShiftAttempts. Recursing while `doShift` merely
    // reports that it moved would then overflow the stack. A bounded number of
    // settling passes preserves the normal cascade while making impossible
    // geometry terminate predictably.
    for (let pass = 0; pass < count + 1; pass += 1) {
      let shifted = false;
      for (let i = 0; i < count - 1; i++) {
        shifted = doShift(i, i + 1, forward) || shifted;
      }
      if (!shifted) return;
    }
  };

  const recheckCircularEdge = () => {
    // A later fixed-ray pass can push the first Aries body backward after the
    // initial Pisces↔Aries check. Recheck only that circular seam, then cascade
    // any resulting displacement forward through the linear neighbors.
    const seamGap = Math.max(1, layoutUnit * 0.08);
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
    return normalizedShifts();
  }

  if (
    ordered[count - 1].longitude > style.collision.wrapUpperDegrees &&
    ordered[0].longitude < style.collision.wrapLowerDegrees
  ) {
    const lastLon = ordered[count - 1].longitude + (shifts.get(ordered[count - 1].key) ?? 0);
    const firstLon = ordered[0].longitude + 360 + (shifts.get(ordered[0].key) ?? 0);
    if (lastLon > firstLon) {
      const distance = lastLon - firstLon;
      const firstShift = (shifts.get(ordered[0].key) ?? 0) + distance;
      if (shiftStaysInTrueRaySector(0, firstShift)) {
        shifts.set(ordered[0].key, firstShift);
      }
      doShift(count - 1, 0, true);
      for (let i = 0; i < count - 1; i++) {
        const lon1 = ordered[i].longitude + (shifts.get(ordered[i].key) ?? 0);
        const lon2 = ordered[i + 1].longitude + (shifts.get(ordered[i + 1].key) ?? 0);
        if (
          lon1 < style.collision.halfCircleDegrees &&
          lon2 < style.collision.halfCircleDegrees
        ) {
          if (lon1 > lon2) {
            const distance2 = lon1 - lon2;
            const nextShift =
              (shifts.get(ordered[i + 1].key) ?? 0) + distance2;
            if (shiftStaysInTrueRaySector(i + 1, nextShift)) {
              shifts.set(ordered[i + 1].key, nextShift);
            }
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

  return normalizedShifts();
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
  degreeSize: number,
  minuteSize: number,
  style: WheelRenderStyle,
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

  const degreePaint = semanticTypographyPaint(
    style,
    "bodies.inner.position.degree",
    {
      font: fontUi,
      size: degreeSize,
      color: style.palette.positions,
    },
  );
  const minutePaint = semanticTypographyPaint(
    style,
    "bodies.inner.position.minute",
    {
      font: fontUi,
      size: minuteSize,
      color: style.palette.positions,
    },
  );
  const [, degTextH] = draw.textsize(
    "00",
    typographyTextOpts(degreePaint),
  );
  const layerOffset = degTextH + style.collision.labelLayerGap;

  const [degW, degH] = draw.textsize(
    "29",
    typographyTextOpts(degreePaint),
  );
  const [minW, minH] = draw.textsize(
    "59",
    typographyTextOpts(minutePaint),
  );
  const labelW = Math.max(degW, minW) + style.collision.labelWidthPad;
  const labelH = Math.max(degH, minH) + style.collision.labelHeightPad;

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
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
  includeAngles = false,
  includePositionStacks = false,
  includeSharedAngles = true,
  includeHouseCuspRays = Boolean(chart.options.showHouses),
  outerTypography = false,
  usePrimaryGlyphSize = false,
  motionMarkerRadius?: number,
  frameworkChart: Chart = chart,
): Map<LayoutKey, number> {
  const bodySize =
    outerTypography && !usePrimaryGlyphSize
      ? typography.outerSize
      : typography.bodySize;
  const layoutUnit = outerTypography
    ? typography.outerLayoutUnit
    : typography.layoutUnit;
  const key = [
    cachePoint(center),
    cacheNumber(asc),
    cacheNumber(rPlanet),
    fontSymbols,
    fontUi,
    cacheNumber(bodySize),
    cacheNumber(layoutUnit),
    cacheNumber(
      outerTypography ? typography.outerMotionSize : typography.motionSize,
    ),
    cacheNumber(motionMarkerRadius ?? -1),
    cacheNumber(style.labels.motionGapMin),
    cacheNumber(style.labels.motionGapScale),
    cacheNumber(style.labels.motionRadialNudgeScale),
    cacheNumber(style.labels.motionTangentNudgeScale),
    includeAngles ? "angles:on" : "angles:off",
    includePositionStacks ? "stacks:on" : "stacks:off",
    includeSharedAngles ? "shared-angles:on" : "shared-angles:off",
    includeHouseCuspRays ? "cusp-rays:on" : "cusp-rays:off",
    usePrimaryGlyphSize ? "primary-glyph-size:on" : "primary-glyph-size:off",
    cacheNumber(frameworkChart.angles.asc),
    cacheNumber(frameworkChart.angles.dsc),
    cacheNumber(frameworkChart.angles.mc),
    cacheNumber(frameworkChart.angles.ic),
    cacheNumber(frameworkChart.houses.cusps[0]),
    cacheNumber(frameworkChart.houses.cusps[9]),
    frameworkChart.angles.ascDegMin ? "framework-asc-label:on" : "framework-asc-label:off",
    frameworkChart.angles.mcDegMin ? "framework-mc-label:on" : "framework-mc-label:off",
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
    typography,
    style,
    includeAngles,
    includePositionStacks,
    includeSharedAngles,
    includeHouseCuspRays,
    outerTypography,
    usePrimaryGlyphSize,
    motionMarkerRadius,
    frameworkChart,
  );
  boundedMapSet(chartCache, key, shifts);
  return shifts;
}

function resolveMotionMarkerBounds(
  draw: TextMeasurer,
  marker: string,
  fontUi: string,
  markerSize: number,
  style: WheelRenderStyle,
  classId: "bodies.inner.motion" | "bodies.outer.motion",
  glyphBounds: Bounds,
  glyphPaintSize: number,
): Bounds {
  const paint = {
    ...semanticTypographyPaint(style, classId, {
      font: fontUi,
      size: markerSize,
      color: style.palette.positions,
    }),
    // `markerSize` already combines any authored class size with the wx
    // R-versus-station ratio, so keep it as the final painted size.
    size: markerSize,
  };
  const [markerW, markerH] = draw.textsize(
    marker,
    typographyTextOpts(paint),
  );
  // Motion is a property of the painted glyph, not a separate radial label.
  // Attach it to the measured glyph right edge and align the two font-box
  // bottoms so asymmetric Morinus ink metrics cannot leave R/SR/SD behind.
  return {
    x: glyphBounds.x + glyphBounds.w,
    y: glyphBounds.y + glyphPaintSize - markerSize,
    w: markerW,
    h: markerH,
  };
}

function measureAngloComponentBounds(
  draw: TextMeasurer,
  chart: Chart,
  center: Pt,
  asc: number,
  rPlanet: number,
  shifts: Map<LayoutKey, number>,
  fontSymbols: string,
  fontUi: string,
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
  includeAngles = Boolean(chart.options.showHouses) || cusplessAscMcLabelsVisible(chart),
  includeSharedAngles = !chart.options.showHouses && cusplessAscMcLabelsVisible(chart),
  frameworkChart: Chart = chart,
): Map<LayoutKey, Bounds[]> {
  const bounds = new Map<LayoutKey, Bounds[]>();
  if (!isAngloWheel(chart)) return bounds;
  const planets = planetById(chart);
  const position = style.typography.ratios.angloBodyPosition;
  const snappedTextBounds = (box: Bounds): Bounds => ({
    ...box,
    x: Math.round(box.x),
    y: Math.round(box.y),
  });

  for (const key of layoutKeys(
    chart, includeAngles, includeSharedAngles, frameworkChart,
  )) {
    const lon = layoutLongitude(chart, planets, key, frameworkChart);
    if (lon == null) continue;
    const displayedLon = lon + (shifts.get(key) ?? 0);
    const glyph = layoutGlyph(chart, planets, key);
    const glyphSize = layoutGlyphSize(
      key,
      typography.bodySize,
      typography.angleLabelSize,
      typography.syzygyScale,
    );
    const angleLabel = key === "__asc" || key === "__mc";
    const glyphPaint = semanticTypographyPaint(
      style,
      layoutGlyphClassId(key, false),
      {
        font: layoutGlyphFont(chart, key, fontSymbols, fontUi),
        size: glyphSize,
        weight:
          angleLabel
            ? style.typography.ratios.angleLabelWeight
            : undefined,
        color:
          angleLabel
            ? style.elementColors.angleLabel
            : bodyColor(chart, planets, key as BodyKey, style.palette),
      },
    );
    const [glyphW, glyphH] = draw.textsize(
      glyph,
      typographyTextOpts(glyphPaint),
    );
    const glyphPt = polar(center, rPlanet, displayedLon, asc);
    const rawGlyphBounds = angleLabel
      ? {
          x: glyphPt[0] - glyphW / 2,
          y: glyphPt[1] - glyphH / 2,
          w: glyphW,
          h: glyphH,
        }
      : {
          x: glyphPt[0] - glyphPaint.size / 2,
          y: glyphPt[1] - glyphPaint.size / 2,
          w: glyphW,
          h: glyphH,
        };
    const paintedGlyphBounds = snappedTextBounds(rawGlyphBounds);
    const components: Bounds[] = [paintedGlyphBounds];
    if (!angleLabel) {
      const bodyPosition = bodyDegMin(chart, planets, key);
      if (bodyPosition) {
        const [degText, minText] = bodyPosition;
        const rows = [
          {
            text: `${degText}°`,
            radius: rPlanet - typography.layoutUnit * position.degreeRadiusOffset,
            font: fontUi,
            size: typography.angloBodyPosition.degreeSize,
            classId: "bodies.inner.position.degree" as const,
          },
          {
            text: signGlyph(
              Math.floor(normalize(lon) / 30),
              chart.options.signVariant,
            ),
            radius: rPlanet - typography.layoutUnit * position.signRadiusOffset,
            font: fontSymbols,
            size: typography.angloBodyPosition.signSize,
            classId: "bodies.inner.position.sign" as const,
          },
          {
            text: minText,
            radius: rPlanet - typography.layoutUnit * position.minuteRadiusOffset,
            font: fontUi,
            size: typography.angloBodyPosition.minuteSize,
            classId: "bodies.inner.position.minute" as const,
          },
        ];
        for (const row of rows) {
          const rowPt = polar(center, row.radius, displayedLon, asc);
          const rowPaint = semanticTypographyPaint(style, row.classId, {
            font: row.font,
            size: row.size,
            color: style.palette.positions,
          });
          const [rowW, rowH] = draw.textsize(
            row.text,
            typographyTextOpts(rowPaint),
          );
          const rowBounds = {
            x: rowPt[0] - rowW / 2,
            y: rowPt[1] - rowH / 2,
            w: rowW,
            h: rowH,
          };
          const paintedRowBounds = snappedTextBounds(rowBounds);
          components.push(paintedRowBounds);
        }
      }
      const marker =
        key === "__fortune" || key === "__vertex" || key === "__syzygy" || key === "__eclipse"
          ? ""
          : planets.get(key)?.motion ?? "";
      if (marker) {
        const markerBounds = resolveMotionMarkerBounds(
          draw,
          marker,
          fontUi,
          motionMarkerSize(chart, marker, typography.motionSize),
          style,
          "bodies.inner.motion",
          rawGlyphBounds,
          glyphPaint.size,
        );
        const paintedMarkerBounds = snappedTextBounds(markerBounds);
        components.push(paintedMarkerBounds);
      }
    }
    bounds.set(key, components);
  }
  return bounds;
}

function getBodyLayout(
  draw: TextMeasurer,
  chart: Chart,
  center: Pt,
  asc: number,
  rPlanet: number,
  rPos: number,
  rRetr: number,
  fontSymbols: string,
  fontUi: string,
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
  includeFrameworkAngles = true,
  includeFrameworkHouseRays = true,
  frameworkChart: Chart = chart,
  layoutInputs?: BodyLayoutInputs,
): BodyLayout {
  const anglo = isAngloWheel(chart);
  const includeCusplessAngles = layoutInputs?.includeAngles ?? Boolean(
    includeFrameworkAngles &&
      (frameworkChart.options.showHouses || cusplessAscMcLabelsVisible(frameworkChart)),
  );
  const includeSharedAngles = layoutInputs?.includeSharedAngles ?? Boolean(
    includeFrameworkAngles &&
      !frameworkChart.options.showHouses &&
      cusplessAscMcLabelsVisible(frameworkChart),
  );
  const includePositionStacks = layoutInputs?.includePositionStacks ?? anglo;
  const includeHouseCuspRays = layoutInputs?.includeHouseCuspRays ?? Boolean(
    includeFrameworkHouseRays && frameworkChart.options.showHouses,
  );
  const outerTypography = layoutInputs?.outerTypography ?? false;
  const usePrimaryGlyphSize = layoutInputs?.usePrimaryGlyphSize ?? false;
  const key = [
    cachePoint(center),
    cacheNumber(asc),
    cacheNumber(rPlanet),
    cacheNumber(rPos),
    cacheNumber(rRetr),
    fontSymbols,
    fontUi,
    cacheNumber(typography.bodySize),
    cacheNumber(typography.layoutUnit),
    cacheNumber(typography.motionSize),
    cacheNumber(typography.syzygyScale),
    cacheNumber(typography.angloBodyPosition.degreeSize),
    cacheNumber(typography.angloBodyPosition.signSize),
    cacheNumber(typography.angloBodyPosition.minuteSize),
    cacheNumber(style.labels.motionGapMin),
    cacheNumber(style.labels.motionGapScale),
    cacheNumber(style.labels.motionRadialNudgeScale),
    cacheNumber(style.labels.motionTangentNudgeScale),
    isCompactWheel(chart) ? "theme:compact" : isAngloWheel(chart) ? "theme:anglo" : "theme:classic",
    chart.options.showTerms ? "terms:on" : "terms:off",
    chart.options.showDecans ? "decans:on" : "decans:off",
    chart.options.showHouses ? "houses:on" : "houses:off",
    chart.options.showPositions ? "positions:on" : "positions:off",
    chart.options.showCusplessAscMcLabels === false ? "cuspless-angles:off" : "cuspless-angles:on",
    includeFrameworkAngles ? "framework-angles:on" : "framework-angles:off",
    includeFrameworkHouseRays ? "framework-house-rays:on" : "framework-house-rays:off",
    includePositionStacks ? "position-stacks:on" : "position-stacks:off",
    includeSharedAngles ? "shared-angles:on" : "shared-angles:off",
    includeHouseCuspRays ? "cusp-rays:on" : "cusp-rays:off",
    outerTypography ? "outer-typography:on" : "outer-typography:off",
    usePrimaryGlyphSize ? "primary-glyph-size:on" : "primary-glyph-size:off",
    cacheNumber(frameworkChart.angles.asc),
    cacheNumber(frameworkChart.angles.dsc),
    cacheNumber(frameworkChart.angles.mc),
    cacheNumber(frameworkChart.angles.ic),
    cacheNumber(frameworkChart.houses.cusps[0]),
    cacheNumber(frameworkChart.houses.cusps[9]),
  ].join("|");
  let chartCache = bodyLayoutCache.get(chart);
  if (!chartCache) {
    chartCache = new Map();
    bodyLayoutCache.set(chart, chartCache);
  }
  const cached = chartCache.get(key);
  if (cached) return cached;
  const bodyShifts = anglo
    ? arrangeBodies(
        draw,
        chart,
        center,
        asc,
        rPlanet,
        fontSymbols,
        fontUi,
        typography,
        style,
        includeCusplessAngles,
        includePositionStacks,
        includeSharedAngles,
        includeHouseCuspRays,
        outerTypography,
        usePrimaryGlyphSize,
        rRetr,
        frameworkChart,
      )
    : getBodyShifts(
        draw,
        chart,
        center,
        asc,
        rPlanet,
        fontSymbols,
        fontUi,
        typography,
        style,
        false,
        includePositionStacks,
        includeSharedAngles,
        includeHouseCuspRays,
        outerTypography,
        usePrimaryGlyphSize,
        rRetr,
        frameworkChart,
      );
  const labelYoffs = isAngloWheel(chart)
    ? new Map<LayoutKey, number>()
    : computeLabelYoffs(
        draw,
        chart,
        center,
        asc,
        rPos,
        bodyShifts,
        fontUi,
        typography.bodyPosition.degreeSize,
        typography.bodyPosition.minuteSize,
        style,
      );
  const componentBounds = anglo
    ? measureAngloComponentBounds(
        draw,
        chart,
        center,
        asc,
        rPlanet,
        bodyShifts,
        fontSymbols,
        fontUi,
        typography,
        style,
        includeCusplessAngles,
        includeSharedAngles,
        frameworkChart,
      )
    : new Map<LayoutKey, Bounds[]>();
  const layout = {
    bodyShifts,
    labelYoffs,
    componentBounds,
  };
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
  const width = anglo ? style.strokes.angloStructural : mediumPenWidth(style, chartSize);
  const color = anglo
    ? style.elementColors.angloBodyLeader
    : style.elementColors.bodyLeader;
  for (const key of bodyKeys(chart)) {
    const lon = bodyLongitude(chart, planets, key);
    if (lon == null) {
      continue;
    }
    const shift = shifts.get(key) ?? 0;
    const p1 = polar(center, ringset.rInner, lon, asc);
    const p2 = polar(center, ringset.rLLine, anglo ? lon : lon + shift, asc);
    draw.line([p1, p2], {
      fill: color,
      ...semanticLinePaint(style, "bodyLeader", width),
    });

    if (!isCompactWheel(chart)) {
      // Keep the mathematical aspect endpoint at the true longitude. Only the
      // leader tip follows displacement, making the inner tick diagonal when a
      // body is shifted.
      const p3 = polar(center, ringset.rAsp, lon, asc);
      const p4 = polar(center, ringset.rLLine2, anglo ? lon : lon + shift, asc);
      draw.line([p3, p4], {
        fill: color,
        ...semanticLinePaint(style, "bodyLeader", width),
      });
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
  style: WheelRenderStyle,
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
        {
          fill: style.elementColors.angleRay,
          ...semanticLinePaint(style, "angle", style.strokes.angloStructural),
        },
      );
      draw.line(
        [
          polar(center, ringset.rAsp, lon, asc),
          polar(center, ringset.rLLine2, lon, asc),
        ],
        {
          fill: style.elementColors.angleRay,
          ...semanticLinePaint(style, "angle", style.strokes.angloStructural),
        },
      );
    }
    // The true-longitude ruler marker and degree run remain even when the
    // optional floating AC/MC label is hidden in a cuspless chart.
    draw.line(
      [
        polar(center, rulerRadius, lon, asc),
        polar(
          center,
          rulerRadius +
            rulerDirection * ringset.r30 * style.geometry.anglo.angleRulerTickScale,
          lon,
          asc,
        ),
      ],
      {
        fill: style.elementColors.angleRay,
        ...semanticLinePaint(
          style,
          "angle",
          style.strokes.angloStructural,
          {},
          "zodiac.tick.angloAngleRuler",
        ),
      },
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
  glyphSize: number,
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
) {
  const planets = planetById(chart);
  const anglo = isAngloWheel(chart);
  const width = anglo ? style.strokes.angloStructural : mediumPenWidth(style, chartSize);
  const color = anglo
    ? style.elementColors.angloOuterLeader
    : style.elementColors.outerLeader;
  const lane = outerGlyphLane(ringset, glyphSize, typography, style);
  for (const key of bodyKeys(chart)) {
    const lon = bodyLongitude(chart, planets, key);
    if (lon == null) {
      continue;
    }
    const shift = shifts.get(key) ?? 0;
    const p1 = polar(center, ringset.r30, lon, asc);
    const p2 = polar(center, lane.leaderRadius, anglo ? lon : lon + shift, asc);
      draw.line([p1, p2], {
        fill: color,
        ...semanticLinePaint(style, "outerLeader", width, {}, "bodies.outer.leader"),
      });
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
  style: WheelRenderStyle,
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
      {
        fill: style.elementColors.angleRay,
        ...semanticLinePaint(
          style,
          "angle",
          style.strokes.angloStructural,
          {},
          "angles.outer.ray",
        ),
      },
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
  angleLabelSize: number,
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
    const size = layoutGlyphSize(
      key,
      angleLabelSize,
      angleLabelSize,
      style.typography.ratios.syzygyScale,
    );
    const weight = style.typography.ratios.angleLabelWeight;
    const paint = semanticTypographyPaint(style, "angles.outer.label", {
      font: fontUi,
      size,
      weight,
      color: style.elementColors.angleLabel,
    });
    const [w, h] = draw.textsize(label, typographyTextOpts(paint));
    draw.text(
      [pt[0] - w / 2, pt[1] - h / 2],
      label,
      typographyTextOpts(paint),
    );
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
  // M may reopen only inner-wheel minor aspects while hideAll continues to
  // suppress every comparison/transit aspect.
  minorOnly?: boolean;
}

const MINOR_ASPECT_TYPES = new Set([1, 2, 4, 7, 8, 9, 11]);

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
  if (clickState?.hideAll) {
    return clickState.minorOnly
      ? chart.aspects.filter((aspect) => MINOR_ASPECT_TYPES.has(aspect.type))
      : null;
  }
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
  track: BodyRingTrack = "inner",
): Pt | null {
  // Both body tracks project their aspect rays onto the shared central aspect
  // figure. Keeping the track explicit prevents source-role inversion from
  // silently selecting the wrong chart/key when traditional converse swaps
  // the radial body lanes.
  const bodyAspectRadius = track === "outer" ? ringset.rAsp : ringset.rAsp;
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
    return polar(center, bodyAspectRadius, chart.fortune.longitude, asc);
  }
  if (key === "vertex") {
    // Desktop draws vertex aspect endpoints at rAsp (graphchart.py:2555),
    // i.e. like a body, not at the Asc/MC radius.
    const vlon = chart.vertex?.longitude ?? chart.angles.vertex;
    return vlon == null ? null : polar(center, bodyAspectRadius, vlon, asc);
  }
  if (key === "syzygy") {
    const slon = chart.syzygy?.longitude;
    return slon == null ? null : polar(center, bodyAspectRadius, slon, asc);
  }
  if (key.startsWith("point:")) {
    const lon = clickPointLongitude(key);
    return lon == null ? null : polar(center, bodyAspectRadius, lon, asc);
  }
  const lon = planets.get(key as PlanetId)?.longitude;
  return lon == null ? null : polar(center, bodyAspectRadius, lon, asc);
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
  style: WheelRenderStyle,
  authoringClass: WheelAuthoringLineClass = "aspects.primary.line",
): { fill: string; width: number; dash?: number[]; opacity?: number } {
  const fill = palette.aspects[aspect.type] ?? palette.frame;
  const aspects = style.strokes.aspects;
  const anglo = isAngloWheel(chart);
  const standardWidth = anglo ? aspects.angloWidth : aspects.classicWidth;
  let base: { width: number; dash?: number[]; opacity?: number };
  if (chart.options.aspectThicknessMode || chart.options.aspectOpacityMode) {
    const maxOrb = Number(aspect.maxOrb ?? 0);
    if (maxOrb > 0) {
      const orbRatio = Math.min(Math.max(Number(aspect.orb ?? 0) / maxOrb, 0), 1);
      if (anglo) {
        base = {
          width: chart.options.aspectThicknessMode
            ? aspects.angloThicknessMin + aspects.angloThicknessSpan * (1 - orbRatio)
            : aspects.angloWidth,
          opacity: chart.options.aspectOpacityMode
            ? aspects.angloOpacityMin + aspects.angloOpacitySpan * (1 - orbRatio)
            : 1,
        };
      } else {
        base = {
          width: chart.options.aspectThicknessMode
            ? Math.max(
                aspects.classicThicknessMin,
                Math.round(aspects.classicThicknessMax * (1 - orbRatio)),
              )
            : aspects.classicWidth,
          opacity: chart.options.aspectOpacityMode
            ? aspects.classicOpacityMin + aspects.classicOpacitySpan * (1 - orbRatio)
            : 1,
        };
      }
    } else {
      base = {
        width: chart.options.aspectThicknessMode
          ? anglo
            ? aspects.angloThicknessNoOrb
            : aspects.classicThicknessNoOrb
          : standardWidth,
        opacity: 1,
      };
    }
  } else {
    base = {
      width: standardWidth,
      dash: aspect.exact
        ? undefined
        : [...(anglo ? aspects.angloDash : aspects.classicDash)],
    };
  }
  const themed = semanticLinePaint(style, "aspect", standardWidth, {
    dash: base.dash,
    opacity: base.opacity,
  }, authoringClass);
  const thicknessScale = chart.options.aspectThicknessMode && standardWidth > 0
    ? base.width / standardWidth
    : 1;
  return {
    fill,
    ...themed,
    width: themed.width * thicknessScale,
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
  style: WheelRenderStyle,
) {
  const planets = planetById(chart);
  for (const aspect of aspects) {
    const p1 = aspectEndpoint(chart, planets, center, ringset, asc, aspect.p1);
    const p2 = aspectEndpoint(chart, planets, center, ringset, asc, aspect.p2);
    if (!p1 || !p2) {
      continue;
    }
    draw.line([p1, p2], {
      ...aspectLineStyle(chart, palette, aspect, style),
    });
  }
}

function pdEventLayoutForSnapshot(
  snapshot: ChartRenderSnapshot,
  presentation: PdRingPresentation,
  center: Pt,
  ringset: RingSet,
  asc: number,
): PdEventLayout | null {
  return resolvePdEventLayout(snapshot.pdEventOverlay, presentation, {
    center,
    ascendantDegrees: asc,
    outerRayInnerRadius: ringset.r30,
    outerRayOuterRadius: ringset.rOuterLine,
    innerMarkerInnerRadius: ringset.rAsp,
    innerMarkerOuterRadius: ringset.rLLine2,
    innerMarkerLabelRadius: ringset.rPlanet,
    outerMarkerLabelRadius: ringset.rOuterPlanet ?? ringset.rOuterLine,
  });
}

function drawPdEventOverlay(
  draw: CanvasDraw,
  layout: PdEventLayout,
  chart: Chart,
  chartSize: number,
  fontUi: string,
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
) {
  const promissorColor = layout.promissorColor
    ?? style.elementColors.outerLeader;
  const significatorColor = layout.significatorColor
    ?? style.elementColors.bodyLeader;
  for (const primitive of [layout.directionRay, layout.directedAngle]) {
    const width = isAngloWheel(chart)
      ? style.strokes.angloStructural
      : mediumPenWidth(style, chartSize);
    const isAngle = primitive.primitiveKind === "directed-angle";
    const lineRole = isAngle
      ? "angle"
      : primitive.track === "outer" ? "outerLeader" : "bodyLeader";
    const classId = isAngle
      ? primitive.track === "outer" ? "angles.outer.ray" : "angles.inner.ray"
      : primitive.track === "outer" ? "bodies.outer.leader" : "bodies.inner.leader";
    const partyColor = primitive.partyRole === "promissor"
      ? promissorColor
      : significatorColor;
    draw.line(
      [primitive.start as Pt, primitive.end as Pt],
      {
        ...semanticLinePaint(style, lineRole, width, {}, classId),
        fill: isAngle ? style.elementColors.angleRay : partyColor,
      },
    );
  }
  if (layout.directedAngleLabel) {
    const outer = layout.directedAngle.track === "outer";
    const paint = semanticTypographyPaint(
      style,
      outer ? "angles.outer.label" : "angles.inner.label",
      {
        font: fontUi,
        size: outer
          ? typography.outerAngleLabelSize
          : typography.angleLabelSize,
        weight: style.typography.ratios.angleLabelWeight,
        color: style.elementColors.angleLabel,
      },
    );
    const [width, height] = draw.textsize(
      layout.directedAngleLabel.text,
      typographyTextOpts(paint),
    );
    draw.text(
      [
        layout.directedAngleLabel.anchor[0] - width / 2,
        layout.directedAngleLabel.anchor[1] - height / 2,
      ],
      layout.directedAngleLabel.text,
      typographyTextOpts(paint),
    );
  }
}

function drishtiEndpoints(
  chart: Chart,
  relation: ChartDrishti,
  planets: Map<PlanetId, ChartPlanet>,
  center: Pt,
  ringset: RingSet,
  asc: number,
): { start: Pt; end: Pt } | null {
  const actorLongitude = relation.actorKind === "planet"
    ? (relation.actorKey ? planets.get(relation.actorKey)?.longitude : undefined)
    : relation.actorSign * 30 + 15;
  if (actorLongitude == null) return null;
  return {
    start: polar(center, ringset.rAsp, actorLongitude, asc),
    end: polar(center, ringset.rAsp, relation.targetSign * 30 + 15, asc),
  };
}

function drishtiLineStyle(
  chart: Chart,
  relation: ChartDrishti,
  planets: Map<PlanetId, ChartPlanet>,
  palette: ChartPalette,
  style: WheelRenderStyle,
): LineOpts {
  const standardWidth = isAngloWheel(chart)
    ? style.strokes.aspects.angloWidth
    : style.strokes.aspects.classicWidth;
  const themed = semanticLinePaint(
    style,
    "aspect",
    standardWidth,
    { opacity: relation.method === "jaimini" ? 0.68 : 0.82 },
    "aspects.primary.line",
  );
  let fill = chart.options.signColors?.[relation.actorSign] ?? palette.signs;
  if (relation.actorKind === "planet" && relation.actorKey) {
    fill = bodyColor(
      chart,
      planets,
      relation.actorKey,
      palette,
    );
  }
  return { fill, ...themed };
}

function drawDirectedDrishtiHead(
  draw: CanvasDraw,
  start: Pt,
  end: Pt,
  paint: LineOpts,
  style: WheelRenderStyle,
) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < 1) return;
  const ux = dx / length;
  const uy = dy / length;
  const size = Math.max(
    style.strokes.hairline * 4,
    style.authoringTargetRadius * 0.018,
  );
  const wing = size * 0.58;
  const anchor: Pt = [end[0] - ux * 2, end[1] - uy * 2];
  const base: Pt = [anchor[0] - ux * size, anchor[1] - uy * size];
  const perpendicular: Pt = [-uy, ux];
  draw.line([
    [base[0] + perpendicular[0] * wing, base[1] + perpendicular[1] * wing],
    anchor,
    [base[0] - perpendicular[0] * wing, base[1] - perpendicular[1] * wing],
  ], paint);
}

function drawDrishtiLines(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  style: WheelRenderStyle,
) {
  const planets = planetById(chart);
  for (const relation of chart.drishti ?? []) {
    const endpoints = drishtiEndpoints(chart, relation, planets, center, ringset, asc);
    if (!endpoints) continue;
    const paint = drishtiLineStyle(chart, relation, planets, palette, style);
    draw.line([endpoints.start, endpoints.end], paint);
    if (relation.method === "parashari") {
      drawDirectedDrishtiHead(draw, endpoints.start, endpoints.end, paint, style);
    }
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
  fontSize: number,
  offset: number,
  aspects: ChartAspect[],
  style: WheelRenderStyle,
) {
  const planets = planetById(chart);
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
    const paint = semanticTypographyPaint(style, "aspects.primary.glyph", {
      font: fontSymbols,
      size: fontSize,
      color: palette.aspects[aspect.type] ?? palette.frame,
    });
    draw.text(
      [
        (p1[0] + p2[0]) / 2 - offset,
        (p1[1] + p2[1]) / 2 - offset,
      ],
      glyph,
      typographyTextOpts(paint),
    );
  }
}

type PositionClassIds = Readonly<{
  degree: WheelAuthoringTypographyClass;
  sign: WheelAuthoringTypographyClass;
  minute: WheelAuthoringTypographyClass;
}>;

function semanticTypographyPaint(
  style: WheelRenderStyle,
  classId: WheelAuthoringTypographyClass,
  defaults: Readonly<{
    font: string;
    size: number;
    color: string;
    weight?: number;
    style?: string;
    tracking?: number;
    opacity?: number;
  }>,
): ResolvedWheelTypographyPaint {
  return resolveWheelTypographyPaint(
    style,
    style.authoringTargetProfile,
    classId,
    style.authoringTargetRadius,
    defaults,
  );
}

function typographyTextOpts(
  paint: ResolvedWheelTypographyPaint,
): TextOpts {
  return {
    fill: paint.color,
    font: paint.font,
    size: paint.size,
    weight: paint.weight,
    style: paint.style,
    tracking: paint.tracking,
    opacity: paint.opacity,
  };
}

function positionedTextPaint(
  paint: ResolvedWheelTypographyPaint,
): Pick<
  PositionedText,
  "fill" | "font" | "size" | "weight" | "style" | "tracking" | "opacity"
> {
  return {
    fill: paint.color,
    font: paint.font,
    size: paint.size,
    weight: paint.weight,
    style: paint.style,
    tracking: paint.tracking,
    opacity: paint.opacity,
  };
}

function paintPositionedText(draw: CanvasDraw, components: readonly PositionedText[]): void {
  for (const component of components) {
    draw.text([component.x, component.y], component.text, {
      fill: component.fill,
      font: component.font,
      size: component.size,
      weight: component.weight,
      style: component.style,
      tracking: component.tracking,
      opacity: component.opacity,
    });
  }
}

function layoutDegMinPair(
  draw: TextMeasurer,
  x: number,
  y: number,
  degText: string,
  minText: string,
  fill: string,
  fontUi: string,
  degSize: number,
  minSize: number,
  classIds: Pick<PositionClassIds, "degree" | "minute">,
  style: WheelRenderStyle,
): PositionedText[] {
  const degreePaint = semanticTypographyPaint(style, classIds.degree, {
    font: fontUi,
    size: degSize,
    color: fill,
  });
  const minutePaint = semanticTypographyPaint(style, classIds.minute, {
    font: fontUi,
    size: minSize,
    color: fill,
  });
  const [degWidth, degHeight] = draw.textsize(
    degText,
    typographyTextOpts(degreePaint),
  );
  const [minWidth, minHeight] = draw.textsize(
    minText,
    typographyTextOpts(minutePaint),
  );
  // wx (graphchart.py:2215-2218, restored in commit 4b7bbaa) centers the
  // degree text around x and butts the minute text directly after — no gap.
  const xDeg = x - degWidth / 2;
  const yDeg = y - degHeight / 2;
  return [
    {
      x: xDeg,
      y: yDeg,
      w: degWidth,
      h: degHeight,
      text: degText,
      ...positionedTextPaint(degreePaint),
      classId: classIds.degree,
    },
    {
      x: xDeg + degWidth,
      y: yDeg,
      w: minWidth,
      h: minHeight,
      text: minText,
      ...positionedTextPaint(minutePaint),
      classId: classIds.minute,
    },
  ];
}

function drawDegMinPair(
  draw: CanvasDraw,
  x: number,
  y: number,
  degText: string,
  minText: string,
  palette: ChartPalette,
  fontUi: string,
  degSize: number,
  minSize: number,
  classIds: Pick<PositionClassIds, "degree" | "minute">,
  style: WheelRenderStyle,
): Bounds {
  const components = layoutDegMinPair(
    draw,
    x,
    y,
    degText,
    minText,
    palette.positions,
    fontUi,
    degSize,
    minSize,
    classIds,
    style,
  );
  paintPositionedText(draw, components);
  const [degree, minute] = components;
  return {
    x: degree.x,
    y: degree.y,
    w: degree.w + minute.w,
    h: Math.max(degree.h, minute.h),
  };
}

function layoutDegMinStack(
  draw: TextMeasurer,
  center: Pt,
  degRadius: number,
  minRadius: number,
  lon: number,
  asc: number,
  yoff: number,
  degText: string,
  minText: string,
  fill: string,
  fontUi: string,
  degSize: number,
  minSize: number,
  classIds: Pick<PositionClassIds, "degree" | "minute">,
  style: WheelRenderStyle,
): PositionedText[] {
  const degLabel = `${degText}°`;
  const minLabel = `${minText}'`;
  const degPt = polar(center, degRadius - yoff, lon, asc);
  const degreePaint = semanticTypographyPaint(style, classIds.degree, {
    font: fontUi,
    size: degSize,
    color: fill,
  });
  const minutePaint = semanticTypographyPaint(style, classIds.minute, {
    font: fontUi,
    size: minSize,
    color: fill,
  });
  const [degWidth, degHeight] = draw.textsize(
    degLabel,
    typographyTextOpts(degreePaint),
  );
  const minPt = polar(center, minRadius - yoff, lon, asc);
  const [minWidth, minHeight] = draw.textsize(
    minLabel,
    typographyTextOpts(minutePaint),
  );
  return [
    {
      x: degPt[0] - degWidth / 2,
      y: degPt[1] - degHeight / 2,
      w: degWidth,
      h: degHeight,
      text: degLabel,
      ...positionedTextPaint(degreePaint),
      classId: classIds.degree,
    },
    {
      x: minPt[0] - minWidth / 2,
      y: minPt[1] - minHeight / 2,
      w: minWidth,
      h: minHeight,
      text: minLabel,
      ...positionedTextPaint(minutePaint),
      classId: classIds.minute,
    },
  ];
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
  degSize: number,
  minSize: number,
  classIds: Pick<PositionClassIds, "degree" | "minute">,
  style: WheelRenderStyle,
): Bounds[] {
  const components = layoutDegMinStack(
    draw,
    center,
    degRadius,
    minRadius,
    lon,
    asc,
    yoff,
    degText,
    minText,
    palette.positions,
    fontUi,
    degSize,
    minSize,
    classIds,
    style,
  );
  paintPositionedText(draw, components);
  return components;
}

function layoutAngloBodyPosition(
  draw: TextMeasurer,
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
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
): PositionedText[] {
  const position = style.typography.ratios.angloBodyPosition;
  const sizes = typography.angloBodyPosition;
  const signIndex = Math.floor(normalize(trueLon) / 30);
  const rows: Array<{
    text: string;
    radius: number;
    font: string;
    size: number;
    fill: string;
    classId: WheelAuthoringTypographyClass;
    signIndex?: number;
  }> = [
    {
      text: `${degText}°`,
      radius: ringset.rPlanet - typography.layoutUnit * position.degreeRadiusOffset - yoff,
      font: fontUi,
      size: sizes.degreeSize,
      fill: palette.positions,
      classId: "bodies.inner.position.degree" as const,
    },
    {
      text: signGlyph(signIndex, chart.options.signVariant),
      radius: ringset.rPlanet - typography.layoutUnit * position.signRadiusOffset - yoff,
      font: fontSymbols,
      size: sizes.signSize,
      // A position readout is one printed value, so its sign takes the
      // positions colour with its degree and minute. Explicit zodiac element
      // colouring is a deliberate instruction and still wins. signColors alone
      // cannot distinguish the two: the daemon fills it with clrsigns repeated
      // twelve times when element colours are off.
      fill: chart.options.useZodiacElementColors
        ? chart.options.signColors?.[signIndex] ?? palette.signs
        : palette.positions,
      classId: "bodies.inner.position.sign" as const,
      signIndex,
    },
    {
      text: minText,
      radius: ringset.rPlanet - typography.layoutUnit * position.minuteRadiusOffset - yoff,
      font: fontUi,
      size: sizes.minuteSize,
      fill: palette.positions,
      classId: "bodies.inner.position.minute" as const,
    },
  ];
  return rows.map((row) => {
    const paint = semanticTypographyPaint(style, row.classId, {
      font: row.font,
      size: row.size,
      color: row.fill,
    });
    const pt = polar(center, row.radius, shiftedLon, asc);
    const [w, h] = draw.textsize(row.text, typographyTextOpts(paint));
    return {
      x: pt[0] - w / 2,
      y: pt[1] - h / 2,
      w,
      h,
      text: row.text,
      ...positionedTextPaint(paint),
      classId: row.classId,
      ...(row.signIndex != null ? { signIndex: row.signIndex } : {}),
    };
  });
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
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
): Bounds[] {
  const components = layoutAngloBodyPosition(
    draw,
    center,
    ringset,
    trueLon,
    shiftedLon,
    asc,
    yoff,
    degText,
    minText,
    chart,
    palette,
    fontUi,
    fontSymbols,
    typography,
    style,
  );
  paintPositionedText(draw, components);
  return components;
}

function layoutAngloLongitudeRun(
  draw: TextMeasurer,
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
  typographySizes: Readonly<{
    degreeSize: number;
    signSize: number;
    minuteSize: number;
    gap: number;
  }>,
  classIds: PositionClassIds,
  style: WheelRenderStyle,
): PositionedText[] {
  const signIndex = Math.floor(normalize(lon) / 30);
  const parts: Array<{
    text: string;
    font: string;
    size: number;
    fill: string;
    classId: WheelAuthoringTypographyClass;
    signIndex?: number;
  }> = [
    {
      text: `${degText}°`,
      font: fontUi,
      size: typographySizes.degreeSize,
      fill: palette.positions,
      classId: classIds.degree,
    },
    {
      text: signGlyph(signIndex, chart.options.signVariant),
      font: fontSymbols,
      size: typographySizes.signSize,
      // A position readout is one printed value, so its sign takes the
      // positions colour with its degree and minute. Explicit zodiac element
      // colouring is a deliberate instruction and still wins. signColors alone
      // cannot distinguish the two: the daemon fills it with clrsigns repeated
      // twelve times when element colours are off.
      fill: chart.options.useZodiacElementColors
        ? chart.options.signColors?.[signIndex] ?? palette.signs
        : palette.positions,
      classId: classIds.sign,
      signIndex,
    },
    {
      text: minText,
      font: fontUi,
      size: typographySizes.minuteSize,
      fill: palette.positions,
      classId: classIds.minute,
    },
  ];
  const gap = typographySizes.gap;
  const paints = parts.map((part) =>
    semanticTypographyPaint(style, part.classId, {
      font: part.font,
      size: part.size,
      color: part.fill,
    })
  );
  const measurements = parts.map((part, index) =>
    draw.textsize(part.text, typographyTextOpts(paints[index]))
  );
  const pt = polar(center, radius, lon, asc);
  const radialX = (pt[0] - center[0]) / Math.max(1, radius);
  const radialY = (pt[1] - center[1]) / Math.max(1, radius);
  const [tangentX, tangentY] = readingOrderTangent(radialX, radialY);
  const extents = measurements.map(
    ([w, h]) => (Math.abs(tangentX) * w + Math.abs(tangentY) * h) / 2,
  );
  const totalSpan = extents.reduce((sum, extent) => sum + extent * 2, 0) + gap * (parts.length - 1);
  let cursor = -totalSpan / 2;
  const components: PositionedText[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const [w, h] = measurements[i];
    const centerOffset = cursor + extents[i];
    const x = pt[0] + tangentX * centerOffset;
    const y = pt[1] + tangentY * centerOffset;
    components.push({
      x: x - w / 2,
      y: y - h / 2,
      w,
      h,
      text: part.text,
      ...positionedTextPaint(paints[i]),
      classId: part.classId,
      ...(part.signIndex != null ? { signIndex: part.signIndex } : {}),
    });
    cursor += extents[i] * 2 + gap;
  }
  return components;
}

/**
 * Orient a wheel tangent so a degree/sign/minute run advances in screen
 * reading order. The geometrically equivalent tangent reverses below the
 * center, which otherwise makes lower-hemisphere cusp runs read right-to-left.
 */
export function readingOrderTangent(radialX: number, radialY: number): Pt {
  const tangentX = -radialY;
  const tangentY = radialX;
  return tangentX < 0 ? [-tangentX, -tangentY] : [tangentX, tangentY];
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
  typographySizes: Readonly<{
    degreeSize: number;
    signSize: number;
    minuteSize: number;
    gap: number;
  }>,
  classIds: PositionClassIds,
  style: WheelRenderStyle,
): Bounds[] {
  const components = layoutAngloLongitudeRun(
    draw,
    center,
    radius,
    lon,
    asc,
    degText,
    minText,
    chart,
    palette,
    fontUi,
    fontSymbols,
    typographySizes,
    classIds,
    style,
  );
  paintPositionedText(draw, components);
  return components;
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
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
  outer = false,
  usePrimaryGlyphSize = false,
) {
  const symbolSize =
    outer && !usePrimaryGlyphSize
      ? typography.outerSize
      : typography.bodySize;
  const motionSize = outer
    ? typography.outerMotionSize
    : typography.motionSize;
  const planets = planetById(chart);
  for (const key of bodyKeys(chart)) {
    const lon = bodyLongitude(chart, planets, key);
    if (lon == null) {
      continue;
    }
    const shift = shifts.get(key) ?? 0;
    const pt = polar(center, ringset.rPlanet, lon + shift, asc);
    const glyphSize = bodyGlyphSize(key, symbolSize, typography.syzygyScale);
    const glyph = bodyGlyph(chart, planets, key);
    const glyphPaint = semanticTypographyPaint(
      style,
      bodyGlyphClassId(key, outer),
      {
        font: bodyGlyphFont(chart, key, fontSymbols, fontUi),
        size: glyphSize,
        color: bodyColor(chart, planets, key, palette),
      },
    );
    draw.text(
      [pt[0] - glyphPaint.size / 2, pt[1] - glyphPaint.size / 2],
      glyph,
      typographyTextOpts(glyphPaint),
    );

    if (!outer) {
      const yoff = labelYoffs.get(key) ?? 0;
      const degMin = bodyDegMin(chart, planets, key);
      if (degMin) {
        if (isAngloWheel(chart)) {
          // Full degree/sign/minute stacks are intrinsic to the Anglo grammar;
          // do not mutate the user's global Positions preference merely to
          // make this one layout complete.
          drawAngloBodyPosition(
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
            typography,
            style,
          );
        } else if (isCompactWheel(chart) && ringset.rPosDeg && ringset.rPosMin) {
          drawDegMinStack(
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
            typography.bodyPosition.degreeSize,
            typography.bodyPosition.minuteSize,
            {
              degree: "bodies.inner.position.degree",
              minute: "bodies.inner.position.minute",
            },
            style,
          );
        } else if (chart.options.showPositions) {
          const posPt = polar(center, ringset.rPos - yoff, lon + shift, asc);
          drawDegMinPair(
            draw,
            posPt[0],
            posPt[1],
            degMin[0],
            degMin[1],
            palette,
            fontUi,
            typography.bodyPosition.degreeSize,
            typography.bodyPosition.minuteSize,
            {
              degree: "bodies.inner.position.degree",
              minute: "bodies.inner.position.minute",
            },
            style,
          );
        }
      }
    }

    // Motion marker (retrograde/station) resolved daemon-side. The authored
    // marker radius is the glyph's shared subscript lane in every wheel theme.
    const marker =
      key === "__fortune" || key === "__vertex" || key === "__syzygy" || key === "__eclipse" ? "" : planets.get(key)?.motion ?? "";
    if (marker) {
      const [glyphW, glyphH] = draw.textsize(
        glyph,
        typographyTextOpts(glyphPaint),
      );
      const glyphBounds = {
        x: pt[0] - glyphPaint.size / 2,
        y: pt[1] - glyphPaint.size / 2,
        w: glyphW,
        h: glyphH,
      };
      const resolvedMotionSize = motionMarkerSize(
        chart,
        marker,
        motionSize,
        outer,
      );
      const markerBounds = resolveMotionMarkerBounds(
        draw,
        marker,
        fontUi,
        resolvedMotionSize,
        style,
        outer ? "bodies.outer.motion" : "bodies.inner.motion",
        glyphBounds,
        glyphPaint.size,
      );
      const motionPaint = {
        ...semanticTypographyPaint(
          style,
          outer ? "bodies.outer.motion" : "bodies.inner.motion",
          {
            font: fontUi,
            size: resolvedMotionSize,
            color: bodyColor(chart, planets, key, palette),
          },
        ),
        size: resolvedMotionSize,
      };
      draw.text(
        [markerBounds.x, markerBounds.y],
        marker,
        typographyTextOpts(motionPaint),
      );
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
  typography: ResolvedWheelTypographyMetrics,
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
        const labelSize = layoutGlyphSize(
          layoutKey,
          typography.bodySize,
          typography.angleLabelSize,
          typography.syzygyScale,
        );
        const labelWeight = style.typography.ratios.angleLabelWeight;
        const paint = semanticTypographyPaint(style, "angles.inner.label", {
          font: fontUi,
          size: labelSize,
          weight: labelWeight,
          color: style.elementColors.angleLabel,
        });
        const [labelWidth, labelHeight] = draw.textsize(
          angleLabel,
          typographyTextOpts(paint),
        );
        draw.text(
          [labelPt[0] - labelWidth / 2, labelPt[1] - labelHeight / 2],
          angleLabel,
          typographyTextOpts(paint),
        );
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
        typography.angloAnglePosition,
        {
          degree: "angles.inner.position.degree",
          sign: "angles.inner.position.sign",
          minute: "angles.inner.position.minute",
        },
        style,
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
        typography.anglePosition.degreeSize,
        typography.anglePosition.minuteSize,
        {
          degree: "angles.inner.position.degree",
          minute: "angles.inner.position.minute",
        },
        style,
      );
    } else {
      const pt = polar(center, ringset.rPosAscMC, lon, asc);
      drawDegMinPair(
        draw,
        pt[0],
        pt[1],
        degMin.degText,
        degMin.minText,
        palette,
        fontUi,
        typography.anglePosition.degreeSize,
        typography.anglePosition.minuteSize,
        {
          degree: "angles.inner.position.degree",
          minute: "angles.inner.position.minute",
        },
        style,
      );
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
  fontSymbols: string,
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
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
        fontSymbols,
        typography.angloHousePosition,
        {
          degree: "houses.inner.position.degree",
          sign: "houses.inner.position.sign",
          minute: "houses.inner.position.minute",
        },
        style,
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
        typography.housePosition.degreeSize,
        typography.housePosition.minuteSize,
        {
          degree: "houses.inner.position.degree",
          minute: "houses.inner.position.minute",
        },
        style,
      );
    } else {
      const pt = polar(center, ringset.rPosHouses, lon, asc);
      drawDegMinPair(
        draw,
        pt[0],
        pt[1],
        degMin.degText,
        degMin.minText,
        palette,
        fontUi,
        typography.housePosition.degreeSize,
        typography.housePosition.minuteSize,
        {
          degree: "houses.inner.position.degree",
          minute: "houses.inner.position.minute",
        },
        style,
      );
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
  style: WheelRenderStyle,
  restrainedAngloComparison = false,
) {
  const outerRadius = restrainedAngloComparison
    ? ringset.rOuterHouse
    : ringset.rOuterHouseName ?? ringset.rOuterASCMC ?? ringset.rOuterArrow;
  if (!outerRadius) {
    return;
  }
  for (let i = 0; i < 12; i++) {
    const cusp = chart.houses.cusps[i];
    const p1 = polar(center, ringset.r30, cusp, asc);
    const p2 = polar(center, outerRadius, cusp, asc);
    draw.line([p1, p2], {
      fill: style.elementColors.houseCusp,
      ...semanticLinePaint(
        style,
        "houseCusp",
        style.strokes.hairline,
        {},
        "houses.outer.cusp",
      ),
    });
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
  const width = ascmcPenWidth(style, chart, chartSize);
  const lons = [chart.angles.asc, chart.angles.dsc, chart.angles.mc, chart.angles.ic];
  for (let idx = 0; idx < lons.length; idx += 1) {
    const lon = lons[idx];
    const p1 = polar(center, ringset.rOuterMin, lon, asc);
    const p2 = polar(center, idx === 1 || idx === 3 ? ringset.rOuterArrow : ringset.rOuterASCMC, lon, asc);
    draw.line([p1, p2], {
      fill: style.elementColors.angleRay,
      ...semanticLinePaint(style, "angle", width, {}, "angles.outer.ray"),
    });
  }
  if (angleArrowheadsVisible(chart)) {
    drawArrow(
      draw,
      center,
      { ...ringset, rASCMC: ringset.rOuterASCMC, rArrow: ringset.rOuterArrow } as RingSet,
      asc,
      chart.angles.asc,
      style.elementColors.angleRay,
      width,
      style,
      "angles.outer.arrowhead",
    );
    drawArrow(
      draw,
      center,
      { ...ringset, rASCMC: ringset.rOuterASCMC, rArrow: ringset.rOuterArrow } as RingSet,
      asc,
      chart.angles.mc,
      style.elementColors.angleRay,
      width,
      style,
      "angles.outer.arrowhead",
    );
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
  primaryChart: Chart,
  comparisonChart: Chart,
  interChartAspects: InterChartAspect[],
  chartSize: number,
  palette: ChartPalette,
  style: WheelRenderStyle,
  presentation: PdRingPresentation,
) {
  const primaryPlanets = planetById(primaryChart);
  const comparisonPlanets = planetById(comparisonChart);
  const markerSource =
    presentation.primaryBodies.track === "outer"
      ? { chart: primaryChart, planets: primaryPlanets, key: "inner" as const }
      : { chart: comparisonChart, planets: comparisonPlanets, key: "outer" as const };
  const markerItems = uniqueByLongitude(
    interChartAspects
      .map((aspect) => {
        const longitude = aspectEndpointLongitude(
          markerSource.chart,
          markerSource.planets,
          aspect[markerSource.key],
        );
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
      {
        fill: anglo
          ? style.elementColors.angloBodyLeader
          : style.elementColors.bodyLeader,
        ...semanticLinePaint(
          style,
          "bodyLeader",
          anglo ? style.strokes.angloStructural : mediumPenWidth(style, chartSize),
          {},
          "aspects.interchart.endpointMarker",
        ),
      },
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
  style: WheelRenderStyle,
  presentation: PdRingPresentation,
) {
  const primaryPlanets = planetById(primaryChart);
  const comparisonPlanets = planetById(comparisonChart);
  for (const aspect of interChartAspects) {
    const p1 = aspectEndpoint(
      primaryChart, primaryPlanets, center, ringset, asc, aspect.inner,
      presentation.primaryBodies.track,
    );
    const p2 = aspectEndpoint(
      comparisonChart, comparisonPlanets, center, ringset, asc, aspect.outer,
      presentation.comparisonBodies.track,
    );
    if (!p1 || !p2) {
      continue;
    }
    draw.line(
      [p1, p2],
      aspectLineStyle(
        primaryChart,
        palette,
        aspect,
        style,
        "aspects.interchart.line",
      ),
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
  fontSize: number,
  offset: number,
  style: WheelRenderStyle,
  presentation: PdRingPresentation,
) {
  const primaryPlanets = planetById(primaryChart);
  const comparisonPlanets = planetById(comparisonChart);
  for (const aspect of interChartAspects) {
    const glyph = aspectGlyph(aspect.type);
    if (!glyph) {
      continue;
    }
    const p1 = aspectEndpoint(
      primaryChart, primaryPlanets, center, ringset, asc, aspect.inner,
      presentation.primaryBodies.track,
    );
    const p2 = aspectEndpoint(
      comparisonChart, comparisonPlanets, center, ringset, asc, aspect.outer,
      presentation.comparisonBodies.track,
    );
    if (!p1 || !p2) {
      continue;
    }
    const paint = semanticTypographyPaint(style, "aspects.interchart.glyph", {
      font: fontSymbols,
      size: fontSize,
      color: palette.aspects[aspect.type] ?? palette.frame,
    });
    draw.text(
      [
        (p1[0] + p2[0]) / 2 - offset,
        (p1[1] + p2[1]) / 2 - offset,
      ],
      glyph,
      typographyTextOpts(paint),
    );
  }
}

type OuterLabelRun = {
  text: string;
  font: "ui" | "symbols";
  fontFamily: string;
  color: string;
  size: number;
  weight: number;
  style: string;
  tracking: number;
  opacity: number;
  classId?: WheelAuthoringTypographyClass;
};

function legacyOuterRingItemFontSize(
  item: OuterRingItem,
  typography: ResolvedWheelTypographyMetrics,
): number {
  // graphchart.drawAntis draws antiscia / contra-antiscia / dodecatemoria
  // projected glyphs with fntMorinus/fntAntisText at full symbolSize
  // (graphchart.py:437-449, 4619-4691), unlike fixed-star/AP text labels
  // which use fntText at symbolSize / 2.
  return isOuterGlyphFamily(item.family)
    ? typography.outerProjectedGlyphSize
    : typography.outerLabelSize;
}

function outerRingRunClassId(
  item: OuterRingItem,
  segment?: RingLabelSegment,
): WheelAuthoringTypographyClass | undefined {
  const classes = resolveWheelSecondaryRingClassIds(item.family);
  if (!classes) return undefined;
  if (classes.label) return classes.label;
  if (segment?.kind === "text") return classes.text ?? classes.glyph;
  return classes.glyph ?? classes.text;
}

function buildOuterItemLabel(
  item: OuterRingItem,
  chart: Chart,
  palette: ChartPalette,
  typography: ResolvedWheelTypographyMetrics,
  fontUi: string,
  fontSymbols: string,
  style: WheelRenderStyle,
): OuterLabelRun[] {
  const fallbackSize = legacyOuterRingItemFontSize(item, typography);
  const createRun = (
    text: string,
    font: "ui" | "symbols",
    color: string,
    segment?: RingLabelSegment,
  ): OuterLabelRun => {
    const classId = outerRingRunClassId(item, segment);
    const defaults = {
      font: font === "symbols" ? fontSymbols : fontUi,
      size:
        (classId ? typography.secondaryRing[classId] : undefined)
        ?? fallbackSize,
      color,
    };
    const paint = classId
      ? semanticTypographyPaint(style, classId, defaults)
      : Object.freeze({
          ...defaults,
          weight: 400,
          style: "normal",
          tracking: 0,
          opacity: 1,
        });
    return {
      text,
      font,
      fontFamily: paint.font,
      color: paint.color,
      size: paint.size,
      weight: paint.weight,
      style: paint.style,
      tracking: paint.tracking,
      opacity: paint.opacity,
      ...(classId ? { classId } : {}),
    };
  };
  if (!item.segments?.length) {
    const classes = resolveWheelSecondaryRingClassIds(item.family);
    const font = classes?.glyph && !classes.label ? "symbols" : "ui";
    return [createRun(item.label, font, palette.textDim)];
  }
  return item.segments.map((segment) => {
    if (segment.kind === "glyph") {
      return createRun(
        segment.text,
        "symbols",
        segment.color ?? palette.textDim,
        segment,
      );
    }
    if (segment.kind !== "planet" || segment.seId == null) {
      return createRun(
        segment.text,
        "ui",
        segment.color ?? palette.textDim,
        segment,
      );
    }
    // Daemon-resolved per-body color when the body is present in the chart;
    // otherwise the indexed palette color for that SE id.
    const resolved = chart.planets.find((planet) => planet.seId === segment.seId)?.color;
    return createRun(
      segment.text,
      "symbols",
      segment.color ?? resolved ?? palette.planets[segment.seId] ?? palette.textDim,
      segment,
    );
  });
}

function labelRunsBounds(
  draw: TextMeasurer,
  runs: readonly OuterLabelRun[],
  fontUi: string,
): Pt {
  const fallbackSize = runs[0]?.size ?? 1;
  const fallbackHeight = draw.textsize("Ag", {
    font: runs[0]?.fontFamily ?? fontUi,
    size: fallbackSize,
    weight: runs[0]?.weight,
    style: runs[0]?.style,
    tracking: runs[0]?.tracking,
  })[1];
  let width = 0;
  let height = fallbackHeight;
  for (const run of runs) {
    const [runWidth, runHeight] = draw.textsize(run.text, {
      font: run.fontFamily,
      size: run.size,
      weight: run.weight,
      style: run.style,
      tracking: run.tracking,
    });
    width += runWidth;
    height = Math.max(height, runHeight);
  }
  return [width, height];
}

function outerRingItemFontSize(
  item: OuterRingItem,
  typography: ResolvedWheelTypographyMetrics,
): number {
  const classId = outerRingRunClassId(item, item.segments?.[0]);
  return (classId ? typography.secondaryRing[classId] : undefined)
    ?? legacyOuterRingItemFontSize(item, typography);
}

function outerGlyphCenterRadius(
  ringset: RingSet,
  outerLayoutUnit: number,
  style: WheelRenderStyle,
): number {
  return ringset.rOuterPlanet
    ?? ringset.rAntis
    ?? ringset.rOuterLine
      + outerLayoutUnit * style.labels.outerRadiusOffsetScale;
}

function outerGlyphLane(
  ringset: RingSet,
  glyphSize: number,
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
) {
  return resolveOuterGlyphLane(
    outerGlyphCenterRadius(ringset, typography.outerLayoutUnit, style),
    glyphSize,
    Math.round(
      typography.outerLayoutUnit * style.labels.outerOutsidePadScale,
    ),
    ringset.r30,
  );
}

function outerRingItemLabelRadius(
  item: OuterRingItem,
  ringset: RingSet,
  outerLayoutUnit: number,
  style: WheelRenderStyle,
): number {
  const radiusOffset = outerLayoutUnit * style.labels.outerRadiusOffsetScale;
  if (isOuterGlyphFamily(item.family)) {
    return outerGlyphCenterRadius(ringset, outerLayoutUnit, style);
  }
  return ringset.rOuterLine + radiusOffset;
}

// Port of graphchart.py:_ellipsize_text_to_width (commit dcae93d). Returns
// the longest prefix of `text` that, with a trailing "..." marker, fits
// within `maxWidth`. Binary-searches the cut point. Falls back to 2 or 1
// dots if even "..." doesn't fit. Returns "" if nothing fits.
function ellipsizeTextToWidth(
  draw: TextMeasurer,
  text: string,
  textOpts: TextOpts,
  maxWidth: number,
): string {
  const t = text ?? "";
  if (maxWidth <= 0) return "";
  if (draw.textsize(t, textOpts)[0] <= maxWidth) return t;
  const marker = "...";
  if (draw.textsize(marker, textOpts)[0] > maxWidth) {
    for (const count of [2, 1]) {
      const dots = ".".repeat(count);
      if (draw.textsize(dots, textOpts)[0] <= maxWidth) return dots;
    }
    return "";
  }
  let lo = 0;
  let hi = t.length;
  let best = marker;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = t.slice(0, mid).trimEnd() + marker;
    if (draw.textsize(candidate, textOpts)[0] <= maxWidth) {
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
  runs: OuterLabelRun[],
  x: number,
  totalWidth: number,
  textHeight: number,
  canvasWidth: number,
  outerLayoutUnit: number,
  fontUi: string,
  fontSize: number,
  palette: ChartPalette,
  style: WheelRenderStyle,
): {
  runs: OuterLabelRun[];
  x: number;
  w: number;
  h: number;
} {
  const pad = Math.max(0, Math.round(outerLayoutUnit * style.outerLabels.edgePadFactor));
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
  const sourceRun = runs.find((run) => run.font === "ui") ?? runs[0];
  const textOpts: TextOpts = {
    font: sourceRun?.fontFamily ?? fontUi,
    size: sourceRun?.size ?? fontSize,
    weight: sourceRun?.weight,
    style: sourceRun?.style,
    tracking: sourceRun?.tracking,
  };
  const fitted = ellipsizeTextToWidth(draw, combined, textOpts, maxWidth);
  const fw = fitted ? draw.textsize(fitted, textOpts)[0] : 0;
  const newRuns = fitted
    ? [{
        text: fitted,
        font: "ui" as const,
        fontFamily: sourceRun?.fontFamily ?? fontUi,
        color: sourceRun?.color ?? palette.textDim,
        size: sourceRun?.size ?? fontSize,
        weight: sourceRun?.weight ?? 400,
        style: sourceRun?.style ?? "normal",
        tracking: sourceRun?.tracking ?? 0,
        opacity: sourceRun?.opacity ?? 1,
        ...(sourceRun?.classId
          ? { classId: sourceRun.classId }
          : {}),
      }]
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
  typography: ResolvedWheelTypographyMetrics,
  chart: Chart,
  palette: ChartPalette,
  style: WheelRenderStyle,
  collisionBounds: readonly OuterLabelCollisionBounds[] = [],
) {
  const ordered = items.slice().sort((a, b) => a.longitude - b.longitude);
  const effectiveCollisionBounds = ordered.every((item) => isOuterGlyphFamily(item.family))
    ? []
    : collisionBounds;
  const shifts = ordered.map(() => 0);
  const yOffsets = ordered.map(() => 0);
  const count = ordered.length;
  if (count < 2 && effectiveCollisionBounds.length === 0) {
    return { items: ordered, shifts, yOffsets };
  }

  const labelBox = (
    idx: number,
    yOffset = 0,
    shift = shifts[idx],
  ) => {
    const item = ordered[idx];
    const lon = item.longitude + shift;
    const glyphLane = isOuterGlyphFamily(item.family);
    const itemLabelRadius = glyphLane
      ? projectedLabelRadius
      : labelRadius;
    const pt = polar(center, itemLabelRadius, lon, asc);
    const rad = Math.PI + ((asc - lon) * Math.PI) / 180;
    const runs = buildOuterItemLabel(
      item,
      chart,
      palette,
      typography,
      fontUi,
      fontSymbols,
      style,
    );
    const [w, h] = labelRunsBounds(draw, runs, fontUi);
    let x = pt[0];
    let y = pt[1] + yOffset;
    const pos = normalize(180 + asc - lon);
    if (glyphLane) {
      x -= w / 2;
    } else if (pos > 90 && pos < 270) {
      x -= w;
    }
    if (!glyphLane) {
      [x, y] = ensureTextOutsideOuterWheel(
        center,
        outerLineRadius,
        rad,
        x,
        y,
        w,
        h,
        itemLabelRadius,
        Math.round(typography.outerLayoutUnit * style.labels.outerOutsidePadScale),
      );
    }
    return { x, y, w, h };
  };

  const doShift = (leftIdx: number, rightIdx: number, forward = false): boolean => {
    let shifted = false;
    let left = labelBox(leftIdx);
    let right = labelBox(rightIdx);
    let attempts = 0;
    while (
      overlap(left.x, left.y - left.h / 2, left.w, left.h, right.x, right.y - right.h / 2, right.w, right.h) &&
      attempts < style.collision.maxShiftAttempts
    ) {
      if (!forward) {
        shifts[leftIdx] -= style.collision.shiftStepDegrees;
      }
      shifts[rightIdx] += style.collision.shiftStepDegrees;
      left = labelBox(leftIdx);
      right = labelBox(rightIdx);
      shifted = true;
      attempts += 1;
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
        const verticalStep = style.collision.outerVerticalStep;
        yOffsets[i] += left.y > center[1] ? verticalStep : -verticalStep;
        yOffsets[i + 1] += right.y > center[1] ? verticalStep : -verticalStep;
        changed = true;
        break;
      }
    }
    if (!changed) {
      break;
    }
  }

  nudgeOuterLabelsAroundCollisionBounds(
    shifts,
    yOffsets,
    (index, shift, yOffset) => {
      const bounds = labelBox(index, yOffset, shift);
      return {
        x: bounds.x,
        y: bounds.y - bounds.h / 2,
        w: bounds.w,
        h: bounds.h,
      };
    },
    effectiveCollisionBounds,
    style,
  );

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
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
) {
  for (let i = 0; i < layout.items.length; i += 1) {
    const item = layout.items[i];
    const classIds = resolveWheelSecondaryRingClassIds(item.family);
    const outerLine = isOuterGlyphFamily(item.family)
      ? outerGlyphLane(
          ringset,
          outerRingItemFontSize(item, typography),
          typography,
          style,
        ).leaderRadius
      : ringset.rOuterLine;
    draw.line(
      [
        polar(center, ringset.r30, item.longitude, asc),
        polar(center, outerLine, item.longitude + layout.shifts[i], asc),
      ],
      {
        fill: style.elementColors.outerLeader,
        ...semanticLinePaint(
          style,
          "outerLeader",
          isAngloWheel(chart)
            ? style.strokes.hairline
            : mediumPenWidth(style, chartSize),
          {},
          classIds?.leader,
        ),
      },
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
  typography: ResolvedWheelTypographyMetrics,
  canvasWidth: number,
  style: WheelRenderStyle,
) {
  for (let i = 0; i < layout.items.length; i += 1) {
    const item = layout.items[i];
    const labelRadius = outerRingItemLabelRadius(
      item,
      ringset,
      typography.outerLayoutUnit,
      style,
    );
    const itemFontSize = outerRingItemFontSize(item, typography);
    const glyphLane = isOuterGlyphFamily(item.family);
    let runs = buildOuterItemLabel(
      item,
      chart,
      palette,
      typography,
      fontUi,
      fontSymbols,
      style,
    );
    let [w, h] = labelRunsBounds(draw, runs, fontUi);
    const shiftedLon = item.longitude + layout.shifts[i];
    const pt = polar(center, labelRadius, shiftedLon, asc);
    const rad = Math.PI + ((asc - shiftedLon) * Math.PI) / 180;
    let x = pt[0];
    let y = pt[1] + layout.yOffsets[i];
    const pos = normalize((rad * 180) / Math.PI);
    if (glyphLane) {
      x -= w / 2;
    } else if (pos > 90 && pos < 270) {
      x -= w;
    }
    if (item.fitPolicy !== "none") {
      const fit = fitOuterLabelToBitmap(
        draw,
        runs,
        x,
        w,
        h,
        canvasWidth,
        typography.outerLayoutUnit,
        fontUi,
        itemFontSize,
        palette,
        style,
      );
      runs = fit.runs;
      x = fit.x;
      w = fit.w;
      h = fit.h;
    }
    if (!runs.length) {
      continue;
    }
    if (!glyphLane) {
      [x, y] = ensureTextOutsideOuterWheel(
        center,
        ringset.rOuterLine,
        rad,
        x,
        y,
        w,
        h,
        labelRadius,
        Math.round(
          typography.outerLayoutUnit * style.labels.outerOutsidePadScale,
        ),
      );
    }
    let cursor = x;
    const yBase = y - h / 2;
    const firstRunColor = runs[0]?.color ?? palette.textDim;
    for (const run of runs) {
      const [runWidth, runHeight] = draw.textsize(run.text, {
        font: run.fontFamily,
        size: run.size,
        weight: run.weight,
        style: run.style,
        tracking: run.tracking,
      });
      draw.text([cursor, yBase + (h - runHeight) / 2], run.text, {
        fill: run.color,
        font: run.fontFamily,
        size: run.size,
        weight: run.weight,
        style: run.style,
        tracking: run.tracking,
        opacity: run.opacity,
      });
      cursor += runWidth;
    }
    if (OUTER_BODY_GLYPH_FAMILIES.has(item.family) && item.motion) {
      const markerRadius =
        ringset.rOuterRetr ??
        ringset.rOuterLine
          + typography.outerLayoutUnit * style.labels.outerMotionRadiusScale;
      const markerPt = polar(center, markerRadius, shiftedLon, asc);
      const markerOffset =
        typography.outerLayoutUnit * style.labels.outerMotionOffsetScale;
      const resolvedMotionSize = motionMarkerSize(
        chart,
        item.motion,
        typography.secondaryRing["secondaryRing.parallelTransit.motion"]
          ?? typography.outerMotionSize,
        true,
      );
      const motionPaint = {
        ...semanticTypographyPaint(
          style,
          "secondaryRing.parallelTransit.motion",
          {
            font: fontUi,
            size: resolvedMotionSize,
            color: firstRunColor,
          },
        ),
        size: resolvedMotionSize,
      };
      draw.text(
        [markerPt[0] - markerOffset, markerPt[1] - markerOffset],
        item.motion,
        typographyTextOpts(motionPaint),
      );
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
type SurveilMarkLayout = {
  tickStart: Pt;
  tickEnd: Pt;
  marker: PositionedText;
  source?: PositionedText;
};

function layoutSurveilMark(
  draw: TextMeasurer,
  center: Pt,
  ringset: RingSet,
  asc: number,
  mark: SurveilMark,
  palette: ChartPalette,
  fontUi: string,
  fontSymbols: string,
  symbolSize: number,
  style: WheelRenderStyle,
): SurveilMarkLayout | null {
  const lon = mark.longitude;
  if (!Number.isFinite(lon)) return null;
  void palette;
  const accent = style.elementColors.surveilAccent;
  const surveil = style.labels.surveil;
  const rWheel = ringset.r30;
  const tickLen = Math.max(
    surveil.tickLengthMin,
    Math.round(symbolSize * surveil.tickLengthScale),
  );
  const rTickEnd = Math.max(ringset.rOuterLine, rWheel + tickLen);
  const glyphGap = Math.max(
    surveil.glyphGapMin,
    Math.round(symbolSize * surveil.glyphGapScale),
  );
  const fallbackSize = Math.max(
    surveil.glyphSizeMin,
    Math.round(symbolSize * surveil.glyphSizeScale),
  );
  const labelGap = Math.max(
    surveil.labelGapMin,
    Math.round(symbolSize * surveil.labelGapScale),
  );

  let markerText = (mark.glyph ?? "").trim();
  const isMorinusGlyph = markerText.length > 0 && mark.glyphFont === "morinus";
  let markerFont = isMorinusGlyph ? fontSymbols : fontUi;
  const markerClass: "surveil.marker.glyph" | "surveil.marker.label" =
    isMorinusGlyph ? "surveil.marker.glyph" : "surveil.marker.label";
  if (!markerText) {
    markerText = ((mark.label ?? "").split(" (", 1)[0] || "").trim() || "Marker";
    markerFont = fontUi;
  }
  if (markerText.length > surveil.maxTextLength) {
    markerText = `${markerText.slice(0, surveil.truncatedPrefixLength)}...`;
  }
  let sourceName = (mark.sourceName ?? "").trim();
  if (sourceName.length > surveil.maxTextLength) {
    sourceName = `${sourceName.slice(0, surveil.truncatedPrefixLength)}...`;
  }
  const sourceText = sourceName ? ` (${sourceName})` : "";
  const markerPaint = semanticTypographyPaint(style, markerClass, {
    font: markerFont,
    size: fallbackSize,
    color: accent,
  });
  const sourcePaint = semanticTypographyPaint(style, "surveil.sourceLabel", {
    font: fontUi,
    size: fallbackSize,
    color: accent,
  });
  const [gw, gh] = draw.textsize(
    markerText,
    typographyTextOpts(markerPaint),
  );
  const [tw, th] = sourceText
    ? draw.textsize(sourceText, typographyTextOpts(sourcePaint))
    : [0, 0];
  const totalW = gw + (sourceText ? labelGap : 0) + tw;
  const totalH = Math.max(gh, th);
  const anchor = polar(center, rTickEnd + glyphGap, lon, asc);
  // Web polar() puts ASC at left with Y flipped vs wx; the cos/sin below use
  // the same wx-space angle (pi + (asc - lon)) so left/right placement matches.
  const cosA = Math.cos(Math.PI + ((asc - lon) * Math.PI) / 180);
  const left = cosA > surveil.horizontalThreshold
    ? anchor[0]
    : cosA < -surveil.horizontalThreshold
      ? anchor[0] - totalW
      : anchor[0] - totalW / 2;
  const top = anchor[1] - totalH / 2;
  const marker: PositionedText = {
    x: left,
    y: top + (totalH - gh) / 2,
    w: gw,
    h: gh,
    text: markerText,
    ...positionedTextPaint(markerPaint),
    classId: markerClass,
  };
  const source = sourceText
    ? {
        x: left + gw + labelGap,
        y: top + (totalH - th) / 2,
        w: tw,
        h: th,
        text: sourceText,
        ...positionedTextPaint(sourcePaint),
        classId: "surveil.sourceLabel" as const,
      }
    : undefined;
  return {
    tickStart: polar(center, rWheel, lon, asc),
    tickEnd: polar(center, rTickEnd, lon, asc),
    marker,
    source,
  };
}

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
  style: WheelRenderStyle,
) {
  if (!marks.length) {
    return;
  }
  for (const mark of marks) {
    const layout = layoutSurveilMark(
      draw,
      center,
      ringset,
      asc,
      mark,
      palette,
      fontUi,
      fontSymbols,
      symbolSize,
      style,
    );
    if (!layout) continue;
    draw.line([layout.tickStart, layout.tickEnd], {
      fill: layout.marker.fill,
      ...semanticLinePaint(
        style,
        "outerLeader",
        style.strokes.hairline,
        {},
        "surveil.tick",
      ),
    });
    paintPositionedText(draw, layout.source ? [layout.marker, layout.source] : [layout.marker]);
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
  style: WheelRenderStyle,
): { stars: FixedStar[]; shifts: number[]; yOffsets: number[] } {
  const ordered = stars.slice().sort((a, b) => a.longitude - b.longitude);
  const shifts = ordered.map(() => 0);
  const yOffsets = ordered.map(() => 0);
  const labelPaint = semanticTypographyPaint(
    style,
    "secondaryRing.fixedStar.label",
    {
      font: fontUi,
      size: fontSize,
      color: style.palette.textDim,
    },
  );
  const count = ordered.length;
  if (count < 2) {
    return { stars: ordered, shifts, yOffsets };
  }

  const labelBox = (idx: number, yOffset = 0) => {
    const star = ordered[idx];
    const lon = star.longitude + shifts[idx];
    const pt = polar(center, labelRadius, lon, asc);
    const label = buildFixedStarLabel(star);
    const [w, h] = draw.textsize(label, typographyTextOpts(labelPaint));
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
    let attempts = 0;
    while (
      overlap(left.x, left.y, left.w, left.h, right.x, right.y, right.w, right.h) &&
      attempts < style.collision.maxShiftAttempts
    ) {
      if (!forward) {
        shifts[leftIdx] -= style.collision.shiftStepDegrees;
      }
      shifts[rightIdx] += style.collision.shiftStepDegrees;
      left = labelBox(leftIdx);
      right = labelBox(rightIdx);
      shifted = true;
      attempts += 1;
    }
    return shifted;
  };

  const doArrange = (forward = false) => {
    // Oversized labels can remain overlapped after maxShiftAttempts. Keep the
    // collision cascade bounded instead of recursively retrying an impossible
    // layout until the browser exhausts its call stack.
    for (let pass = 0; pass < count + 1; pass += 1) {
      let shifted = false;
      for (let i = 0; i < count - 1; i++) {
        shifted = doShift(i, i + 1, forward) || shifted;
      }
      if (!shifted) return;
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
  } else if (
    ordered[count - 1].longitude > style.collision.wrapUpperDegrees &&
    ordered[0].longitude < style.collision.wrapLowerDegrees
  ) {
    const lastLon = ordered[count - 1].longitude + shifts[count - 1];
    const firstLon = ordered[0].longitude + 360 + shifts[0];
    if (lastLon > firstLon) {
      const distance = lastLon - firstLon;
      shifts[0] += distance;
      doShift(count - 1, 0, true);
      for (let i = 0; i < count - 1; i++) {
        const lon1 = ordered[i].longitude + shifts[i];
        const lon2 = ordered[i + 1].longitude + shifts[i + 1];
        if (
          lon1 < style.collision.halfCircleDegrees &&
          lon2 < style.collision.halfCircleDegrees
        ) {
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
        if (
          left.pos > style.collision.fixedStarDownwardStart &&
          left.pos < style.collision.fixedStarDownwardEnd
        ) {
          yOffsets[i + 1] += style.collision.outerVerticalStep;
        } else {
          yOffsets[i + 1] -= style.collision.outerVerticalStep;
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

function outerLabelCollisionBoundsKey(
  bounds: readonly OuterLabelCollisionBounds[],
): string {
  return bounds
    .map((box) =>
      [box.x, box.y, box.w, box.h].map(cacheNumber).join(",")
    )
    .join(";");
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
  typography: ResolvedWheelTypographyMetrics,
  outerItemsChart: Chart,
  palette: ChartPalette,
  style: WheelRenderStyle,
  collisionBounds: readonly OuterLabelCollisionBounds[] = [],
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
    cacheNumber(typography.outerLayoutUnit),
    cacheNumber(typography.outerLabelSize),
    cacheNumber(typography.outerProjectedGlyphSize),
    Object.values(typography.secondaryRing).map(cacheNumber).join(","),
    outerLabelCollisionBoundsKey(collisionBounds),
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
    ringset.rOuterLine + typography.outerLayoutUnit * style.labels.outerRadiusOffsetScale,
    outerGlyphCenterRadius(ringset, typography.outerLayoutUnit, style),
    fontUi,
    fontSymbols,
    typography,
    outerItemsChart,
    palette,
    style,
    collisionBounds,
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
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
): ReturnType<typeof prepareFixedStars> {
  const stars = chart.fixedStars ?? [];
  const fixedStarLabelSize =
    typography.secondaryRing["secondaryRing.fixedStar.label"]
    ?? typography.outerLabelSize;
  const key = [
    stars.length,
    cachePoint(center),
    cacheNumber(asc),
    cacheNumber(ringset.rOuterLine),
    fontUi,
    cacheNumber(typography.outerLayoutUnit),
    cacheNumber(fixedStarLabelSize),
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
    ringset.rOuterLine + typography.outerLayoutUnit * style.labels.outerRadiusOffsetScale,
    fontUi,
    fixedStarLabelSize,
    style,
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
  const width = isAngloWheel(chart)
    ? style.strokes.hairline
    : mediumPenWidth(style, chartSize);
  for (let i = 0; i < fixedStarLayout.stars.length; i++) {
    const star = fixedStarLayout.stars[i];
    const p1 = polar(center, ringset.r30, star.longitude, asc);
    const p2 = polar(center, ringset.rOuterLine, star.longitude + fixedStarLayout.shifts[i], asc);
    draw.line([p1, p2], {
      fill: style.elementColors.outerLeader,
      ...semanticLinePaint(
        style,
        "outerLeader",
        width,
        {},
        "secondaryRing.fixedStar.leader",
      ),
    });
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
  outerLayoutUnit: number,
  style: WheelRenderStyle,
) {
  const labelPaint = semanticTypographyPaint(
    style,
    "secondaryRing.fixedStar.label",
    {
      font: fontUi,
      size: fontSize,
      color: palette.textDim,
    },
  );
  let labelRadius = ringset.rOuterLine + outerLayoutUnit * style.labels.outerRadiusOffsetScale;
  for (let i = 0; i < fixedStarLayout.stars.length; i++) {
    const star = fixedStarLayout.stars[i];
    const shift = fixedStarLayout.shifts[i];
    const label = buildFixedStarLabel(star);
    const [w, h] = draw.textsize(label, typographyTextOpts(labelPaint));
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
      Math.round(outerLayoutUnit * style.labels.outerOutsidePadScale),
    );
    draw.text(
      [x, y - h / 2],
      label,
      typographyTextOpts(labelPaint),
    );
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

const fillTextureTileCache = new Map<string, HTMLCanvasElement>();

function fillRasterPatternSide(
  algorithm: Exclude<
    WheelAuthoringFillPattern,
    "none" | "solid" | "paper" | "hatch" | "crosshatch" | "scanline"
  >,
): number {
  if (algorithm === "bayer2") return 2;
  if (algorithm === "stipple" || algorithm === "bayer4") return 4;
  if (algorithm === "bayer8" || algorithm === "newsprint") return 8;
  if (algorithm === "noise") return 16;
  return 32;
}

function fillTexturePattern(
  draw: CanvasDraw,
  algorithm: Exclude<WheelAuthoringFillPattern, "none" | "solid">,
  color: string,
  cellSizePx: number,
  dotSizePx: number,
  density: number,
  angle: number,
  seed: number,
): CanvasPattern | null {
  if (typeof document === "undefined" || density <= 0) return null;
  const dpr = Math.max(1, draw.ctx.getTransform().a || 1);
  const cell = Math.max(0.5, cellSizePx);
  const dot = Math.max(0.25, Math.min(cell, dotSizePx));
  const directionalAngle =
    algorithm === "hatch"
    || algorithm === "crosshatch"
    || algorithm === "scanline"
      ? angle
      : 0;
  const key = [
    algorithm,
    color,
    cell,
    dot,
    density,
    directionalAngle,
    seed,
    dpr,
  ].join("\u0000");
  let tile = fillTextureTileCache.get(key);
  let patternScale = 1 / dpr;
  let patternRotation = 0;
  if (!tile) {
    let tileSide = 1;
    let rasterSide = 0;
    let rasterCell = 1;
    let rasterShape: "circle" | "square" = "square";
    let rasterMask: Uint8Array | null = null;
    const rasterPattern =
      algorithm === "stipple"
      || algorithm === "bayer2"
      || algorithm === "bayer4"
      || algorithm === "bayer8"
      || algorithm === "noise"
      || algorithm === "blueNoise"
      || algorithm === "newsprint"
      || algorithm === "atkinson"
      || algorithm === "floydSteinberg";
    if (rasterPattern) {
      const raster = createDitherRasterPatternTile(
        algorithm,
        density,
        seed,
      );
      rasterSide = raster.side;
      rasterShape = raster.shape;
      rasterMask = raster.mask;
      rasterCell = Math.max(
        1,
        Math.min(Math.round(cell * dpr), Math.floor(768 / rasterSide)),
      );
      tileSide = rasterSide * rasterCell;
      patternScale = cell / rasterCell;
    } else if (algorithm === "paper") {
      rasterSide = 24;
      rasterCell = Math.max(
        1,
        Math.min(Math.round(cell * dpr), Math.floor(768 / rasterSide)),
      );
      tileSide = rasterSide * rasterCell;
      patternScale = cell / rasterCell;
    } else {
      const period = Math.max(dot, cell * (100 / density));
      tileSide = Math.max(1, Math.min(1024, Math.round(period * dpr)));
      patternScale = period / tileSide;
      patternRotation = algorithm === "scanline" ? angle + 90 : angle;
    }
    tile = document.createElement("canvas");
    tile.width = tileSide;
    tile.height = tileSide;
    const tileContext = tile.getContext("2d");
    if (!tileContext) return null;
    tileContext.imageSmoothingEnabled = false;
    tileContext.fillStyle = color;
    if (rasterMask) {
      const dotDevicePx = Math.max(
        1,
        Math.min(rasterCell, Math.round((dot / cell) * rasterCell)),
      );
      const inset = (rasterCell - dotDevicePx) / 2;
      for (let index = 0; index < rasterMask.length; index += 1) {
        if (!rasterMask[index]) continue;
        const column = index % rasterSide;
        const row = Math.floor(index / rasterSide);
        const x = column * rasterCell + inset;
        const y = row * rasterCell + inset;
        if (rasterShape === "circle") {
          tileContext.beginPath();
          tileContext.arc(
            x + dotDevicePx / 2,
            y + dotDevicePx / 2,
            dotDevicePx / 2,
            0,
            Math.PI * 2,
          );
          tileContext.fill();
        } else {
          tileContext.fillRect(x, y, dotDevicePx, dotDevicePx);
        }
      }
    } else if (algorithm === "paper") {
      const dotDevicePx = Math.max(
        1,
        Math.min(rasterCell, (dot / cell) * rasterCell),
      );
      for (let row = 0; row < rasterSide; row += 1) {
        for (let column = 0; column < rasterSide; column += 1) {
          const presence = sampleDitherNoise(column, row, seed);
          if (presence * 100 >= density) continue;
          const fine = sampleDitherNoise(
            column * 3 + 7,
            row * 5 + 11,
            seed ^ 0x4f31,
          );
          const coarse = sampleDitherNoise(
            Math.floor(column / 4),
            Math.floor(row / 4),
            seed ^ 0x7123,
          );
          tileContext.globalAlpha = 0.15 + fine * 0.55 + coarse * 0.3;
          tileContext.beginPath();
          tileContext.arc(
            (column + 0.5) * rasterCell,
            (row + 0.5) * rasterCell,
            dotDevicePx * (0.2 + fine * 0.3),
            0,
            Math.PI * 2,
          );
          tileContext.fill();
        }
      }
      tileContext.globalAlpha = 1;
    } else {
      const lineWidth = Math.max(
        1,
        Math.min(tileSide, (dot / Math.max(dot, cell * (100 / density))) * tileSide),
      );
      tileContext.fillRect(0, 0, lineWidth, tileSide);
      if (algorithm === "crosshatch") {
        tileContext.fillRect(0, 0, tileSide, lineWidth);
      }
    }
    if (fillTextureTileCache.size >= 64) {
      fillTextureTileCache.clear();
    }
    fillTextureTileCache.set(key, tile);
  }
  const pattern = draw.ctx.createPattern(tile, "repeat");
  if (pattern && typeof pattern.setTransform === "function" && typeof DOMMatrix !== "undefined") {
    if (tile.width > 0) {
      if (
        algorithm === "hatch"
        || algorithm === "crosshatch"
        || algorithm === "scanline"
      ) {
        const period = Math.max(dot, cell * (100 / density));
        patternScale = period / tile.width;
        patternRotation = algorithm === "scanline" ? angle + 90 : angle;
      } else {
        const side =
          algorithm === "paper"
            ? 24
            : fillRasterPatternSide(algorithm);
        patternScale = (side * cell) / tile.width;
      }
    }
    pattern.setTransform(
      new DOMMatrix()
        .rotate(patternRotation)
        .scale(patternScale),
    );
  }
  return pattern;
}

function paintFillRegion(
  draw: CanvasDraw,
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  classId: WheelAuthoringFillClass,
  center: Pt,
  outerRadius: number,
  innerRadius = 0,
  sunAngleDegrees: number | null = null,
): void {
  const paint = resolveWheelFillPaint(
    style,
    profile,
    classId,
    style.authoringTargetRadius,
  );
  const hasMaterial = (
    paint.fillPattern !== "none"
    || paint.backgroundEnabled
    || paint.gradientType !== "none"
  );
  const hasShadow = (
    paint.shadowPattern !== "none"
    && (
      paint.shadowXpx !== 0
      || paint.shadowYpx !== 0
      || paint.shadowBlurPx !== 0
    )
  );
  if (
    (!hasMaterial && !hasShadow)
    || paint.opacity <= 0
    || outerRadius <= innerRadius
  ) {
    return;
  }
  const { ctx } = draw;
  ctx.save();
  ctx.globalAlpha = paint.opacity;
  const appendRegionPath = () => {
    ctx.moveTo(center[0] + outerRadius, center[1]);
    ctx.arc(center[0], center[1], outerRadius, 0, Math.PI * 2);
    if (innerRadius > 0) {
      ctx.moveTo(center[0] + innerRadius, center[1]);
      ctx.arc(center[0], center[1], innerRadius, 0, Math.PI * 2, true);
    }
  };
  const fillCurrentPath = () => {
    if (innerRadius > 0) ctx.fill("evenodd");
    else ctx.fill();
  };
  if (hasShadow) {
    /*
     * Cast the region's alpha mask into a clip that excludes the source
     * region. The retained fill layer therefore receives only the shadow,
     * never a dark duplicate beneath transparent materials. Patterned alpha
     * creates a genuine stippled/noisy print shadow; `solid` plus blur creates
     * the ordinary soft Canvas shadow defined by the HTML standard.
     */
    ctx.save();
    const clipExtent =
      outerRadius * 4
      + Math.abs(paint.shadowXpx)
      + Math.abs(paint.shadowYpx)
      + paint.shadowBlurPx * 4
      + 32;
    ctx.beginPath();
    ctx.rect(
      center[0] - clipExtent,
      center[1] - clipExtent,
      clipExtent * 2,
      clipExtent * 2,
    );
    appendRegionPath();
    ctx.clip("evenodd");
    ctx.beginPath();
    appendRegionPath();
    ctx.shadowColor = paint.shadowColor;
    ctx.shadowOffsetX = paint.shadowXpx;
    ctx.shadowOffsetY = paint.shadowYpx;
    ctx.shadowBlur = paint.shadowBlurPx;
    if (paint.shadowPattern === "solid") {
      ctx.fillStyle = paint.shadowColor;
      fillCurrentPath();
    } else {
      const shadowTexture = fillTexturePattern(
        draw,
        paint.shadowPattern,
        paint.shadowColor,
        paint.cellSizePx,
        paint.dotSizePx,
        paint.density,
        paint.angle,
        paint.seed,
      );
      if (shadowTexture) {
        ctx.fillStyle = shadowTexture;
        fillCurrentPath();
      }
    }
    ctx.restore();
  }
  ctx.beginPath();
  appendRegionPath();
  if (paint.backgroundEnabled) {
    ctx.fillStyle = paint.backgroundColor;
    fillCurrentPath();
  }
  if (paint.gradientType !== "none") {
    const directionDegrees =
      (paint.gradientDirection === "sun" ? sunAngleDegrees ?? 0 : 0)
      + paint.gradientAngle;
    const radians = directionDegrees * Math.PI / 180;
    const x = Math.cos(radians);
    const y = Math.sin(radians);
    const gradient = paint.gradientType === "linear"
      ? ctx.createLinearGradient(
          center[0] + x * outerRadius,
          center[1] + y * outerRadius,
          center[0] - x * outerRadius,
          center[1] - y * outerRadius,
        )
      : ctx.createRadialGradient(
          center[0] + x * outerRadius * 0.34,
          center[1] + y * outerRadius * 0.34,
          0,
          center[0],
          center[1],
          outerRadius * 1.15,
        );
    gradient.addColorStop(0, paint.gradientStartColor);
    gradient.addColorStop(1, paint.gradientEndColor);
    ctx.fillStyle = gradient;
    fillCurrentPath();
  }
  const paintTexture = () => {
    if (paint.fillPattern === "solid") {
      ctx.fillStyle = paint.patternColor;
      fillCurrentPath();
    } else if (paint.fillPattern !== "none") {
      const fillStyle = fillTexturePattern(
        draw,
        paint.fillPattern,
        paint.patternColor,
        paint.cellSizePx,
        paint.dotSizePx,
        paint.density,
        paint.angle,
        paint.seed,
      );
      if (fillStyle) {
        ctx.fillStyle = fillStyle;
        fillCurrentPath();
      }
    }
  };
  if (
    paint.textureMask === "crescent"
    && paint.fillPattern !== "none"
  ) {
    const directionDegrees =
      (paint.maskDirection === "sun" ? sunAngleDegrees ?? 0 : 0)
      + paint.maskAngle;
    const radians = directionDegrees * Math.PI / 180;
    const shift = outerRadius * 2 * paint.maskAmount / 100;
    ctx.save();
    ctx.beginPath();
    ctx.arc(center[0], center[1], outerRadius, 0, Math.PI * 2);
    if (innerRadius > 0) {
      ctx.moveTo(center[0] + innerRadius, center[1]);
      ctx.arc(center[0], center[1], innerRadius, 0, Math.PI * 2, true);
    }
    ctx.moveTo(
      center[0] + Math.cos(radians) * shift + outerRadius,
      center[1] + Math.sin(radians) * shift,
    );
    ctx.arc(
      center[0] + Math.cos(radians) * shift,
      center[1] + Math.sin(radians) * shift,
      outerRadius,
      0,
      Math.PI * 2,
    );
    ctx.clip("evenodd");
    ctx.beginPath();
    appendRegionPath();
    paintTexture();
    ctx.restore();
  } else {
    paintTexture();
  }
  ctx.restore();
}

function paintCanvasBackgroundMaterial(
  draw: CanvasDraw,
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  width: number,
  height: number,
  sunAngleDegrees: number | null,
): void {
  const paint = resolveWheelFillPaint(
    style,
    profile,
    "canvas.background",
    style.authoringTargetRadius,
  );
  if (
    (
      paint.fillPattern === "none"
      && !paint.backgroundEnabled
      && paint.gradientType === "none"
    )
    || paint.opacity <= 0
  ) {
    return;
  }
  const { ctx } = draw;
  ctx.save();
  ctx.globalAlpha = paint.opacity;
  if (paint.backgroundEnabled) {
    ctx.fillStyle = paint.backgroundColor;
    ctx.fillRect(0, 0, width, height);
  }
  if (paint.gradientType !== "none") {
    const directionDegrees =
      (paint.gradientDirection === "sun" ? sunAngleDegrees ?? 0 : 0)
      + paint.gradientAngle;
    const radians = directionDegrees * Math.PI / 180;
    const x = Math.cos(radians);
    const y = Math.sin(radians);
    const center: Pt = [width / 2, height / 2];
    const extent = Math.hypot(width, height) / 2;
    const gradient = paint.gradientType === "linear"
      ? ctx.createLinearGradient(
          center[0] + x * extent,
          center[1] + y * extent,
          center[0] - x * extent,
          center[1] - y * extent,
        )
      : ctx.createRadialGradient(
          center[0] + x * extent * 0.22,
          center[1] + y * extent * 0.22,
          0,
          center[0],
          center[1],
          extent * 1.15,
        );
    gradient.addColorStop(0, paint.gradientStartColor);
    gradient.addColorStop(1, paint.gradientEndColor);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  if (paint.fillPattern === "solid") {
    ctx.fillStyle = paint.patternColor;
    ctx.fillRect(0, 0, width, height);
  } else if (paint.fillPattern !== "none") {
    const fillStyle = fillTexturePattern(
      draw,
      paint.fillPattern,
      paint.patternColor,
      paint.cellSizePx,
      paint.dotSizePx,
      paint.density,
      paint.angle,
      paint.seed,
    );
    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.fillRect(0, 0, width, height);
    }
  }
  ctx.restore();
}

function drawRetainedFillLayer(
  draw: CanvasDraw,
  chart: Chart,
  style: WheelRenderStyle,
  center: Pt,
  ringset: RingSet,
  width: number,
  height: number,
): void {
  draw.fillBackground(style.palette.background);
  const profile = wheelTypographyProfile(chart);
  const sun = chart.planets.find((planet) => planet.id === "sun");
  const sunPoint = sun == null ? null : polar([0, 0], 1, sun.longitude, chart.angles.asc);
  const sunAngleDegrees = sunPoint == null
    ? null
    : Math.atan2(sunPoint[1], sunPoint[0]) * 180 / Math.PI;
  paintCanvasBackgroundMaterial(
    draw,
    style,
    profile,
    width,
    height,
    sunAngleDegrees,
  );
  paintFillRegion(
    draw,
    style,
    profile,
    "fills.chartField",
    center,
    ringset.rOuterMax ?? ringset.r30,
    0,
    sunAngleDegrees,
  );
  paintFillRegion(
    draw,
    style,
    profile,
    "fills.houseField",
    center,
    ringset.rInner,
    ringset.rAsp,
    sunAngleDegrees,
  );
  paintFillRegion(
    draw,
    style,
    profile,
    "fills.centerField",
    center,
    ringset.rAsp,
    0,
    sunAngleDegrees,
  );
  paintFillRegion(
    draw,
    style,
    profile,
    "fills.subdivisionBand",
    center,
    chart.options.showTerms || chart.options.showDecans ? ringset.r0 : 0,
    ringset.rInner,
    sunAngleDegrees,
  );
  paintFillRegion(
    draw,
    style,
    profile,
    "fills.zodiacBand",
    center,
    ringset.r30,
    ringset.r0,
    sunAngleDegrees,
  );
}

/**
 * The wheel radius one paint actually uses, after the authored global scale.
 *
 * A scale is applied here — as a smaller wheel radius — and nowhere else.
 * Canonical radii are fractions of this value, authored radii project through
 * it, and typography metrics derive from it, so substituting it scales the
 * geometry and everything drawn inside it by a single factor. That is exactly
 * what a scale gesture means, and exactly what a boundary drag must not do.
 *
 * The alternative, rescaling the solved geometry afterwards, fights the solver:
 * its walls and floors are expressed against the unscaled radius, so scaled
 * output would sit outside the interval the drag was clamped to. Substituting
 * the radius instead keeps one consistent world, and it is already proven at
 * every size — a scale is indistinguishable from the same wheel in a smaller
 * pane, which the ring units are unit-correct for.
 *
 * The centre is deliberately not scaled: the wheel shrinks about the middle of
 * the pane rather than towards a corner.
 */
function scaledWheelRadius(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  chartSize: number,
): number {
  return chartSize / 2 * resolveWheelScale(style, profile);
}

function outerModeGlyphSize(
  mode: ChartRenderSnapshot["outerRingMode"],
  typography: ResolvedWheelTypographyMetrics,
): number | null {
  if (!isOuterGlyphFamily(mode)) return null;
  const classId = resolveWheelSecondaryRingClassIds(mode)?.glyph;
  return (classId ? typography.secondaryRing[classId] : undefined)
    ?? typography.outerProjectedGlyphSize;
}

/**
 * Constant-time radial paint budget for the current outer family. It reads
 * semantic mode/style state rather than chart objects or measured text, and a
 * chart without an outer ring keeps the historical full target square.
 */
export function resolveChartOuterPaintEnvelopeScale(
  snapshot: ChartRenderSnapshot,
  sourceStyle: WheelRenderStyle,
): number {
  return resolveChartOuterPaintEnvelope(snapshot, sourceStyle).targetScale;
}

export type ChartOuterPaintEnvelope = Readonly<{
  targetScale: number;
  paintRadiusScale: number;
  avoidTitlebar: boolean;
}>;

export function resolveChartOuterPaintEnvelope(
  snapshot: ChartRenderSnapshot,
  sourceStyle: WheelRenderStyle,
): ChartOuterPaintEnvelope {
  const chart = snapshot.primaryChart;
  const profile = wheelTypographyProfile(chart);
  const referenceRadius = Number.isFinite(sourceStyle.authoringOverrides.referenceRadius)
    && sourceStyle.authoringOverrides.referenceRadius > 0
    ? sourceStyle.authoringOverrides.referenceRadius
    : 400;
  const hasComparison = Boolean(snapshot.comparisonChart);
  const hasOuterRing = hasComparison || snapshot.outerRingMode !== "none";
  if (!hasOuterRing) {
    return Object.freeze({
      targetScale: 1,
      paintRadiusScale: 1,
      avoidTitlebar: false,
    });
  }
  const style = projectWheelAuthoringStyle(sourceStyle, referenceRadius, profile);
  const restrainedAngloComparison = usesRestrainedAngloComparison(snapshot, chart);
  const ringset = hasComparison
    ? comparisonRings(
        style,
        chart,
        referenceRadius,
        comparisonUsesOuterHouseBand(snapshot, chart),
        restrainedAngloComparison,
      )
    : effectiveRings(
        style,
        chart,
        referenceRadius,
        true,
      );
  const typography = resolveWheelTypographyMetrics(style, profile, referenceRadius);
  let outerPaintRadius = Math.max(
    ringset.r30,
    ringset.rOuterLine,
    ringset.rAntis,
    ringset.rOuterMax ?? 0,
    ringset.rOuterASCMC ?? 0,
    ringset.rOuterArrow ?? 0,
  );

  if (hasComparison) {
    const bodyGlyphSize = restrainedAngloComparison
      ? Math.max(typography.bodySize, typography.outerSize)
      : typography.outerSize;
    outerPaintRadius = Math.max(
      outerPaintRadius,
      outerGlyphLane(ringset, bodyGlyphSize, typography, style).outerRadius,
    );
    const presentation = resolvePdRingPresentation(snapshot);
    if (presentation.showComparisonAxes && ringset.rOuterASCMC != null) {
      outerPaintRadius = Math.max(
        outerPaintRadius,
        ringset.rOuterASCMC + typography.outerAngleLabelSize / 2,
      );
    }
    if (ringset.rOuterHouseName != null) {
      outerPaintRadius = Math.max(
        outerPaintRadius,
        ringset.rOuterHouseName + typography.outerHouseLabelSize / 2,
      );
    }
  }

  const modeGlyphSize = outerModeGlyphSize(snapshot.outerRingMode, typography);
  if (modeGlyphSize != null) {
    outerPaintRadius = Math.max(
      outerPaintRadius,
      outerGlyphLane(ringset, modeGlyphSize, typography, style).outerRadius,
    );
    if (snapshot.outerRingMode === "parallel_transits" && ringset.rOuterRetr != null) {
      const motionSize = typography.secondaryRing["secondaryRing.parallelTransit.motion"]
        ?? typography.outerMotionSize;
      outerPaintRadius = Math.max(
        outerPaintRadius,
        ringset.rOuterRetr + motionSize / 2,
      );
    }
  }

  const paintRadiusScale =
    outerPaintRadius * resolveWheelScale(sourceStyle, profile) / referenceRadius;
  return Object.freeze({
    targetScale: resolvePaintEnvelopeScale(
      outerPaintRadius * resolveWheelScale(sourceStyle, profile),
      referenceRadius,
    ),
    paintRadiusScale,
    avoidTitlebar: true,
  });
}

export function drawSnapshotLayer(
  draw: CanvasDraw,
  snapshot: ChartRenderSnapshot,
  layer: DrawLayer,
  opts: DrawOptions,
) {
  const chart = snapshot.primaryChart;
  const comparisonChart = snapshot.comparisonChart ?? undefined;
  const { width, height } = opts;
  const chartSize = opts.chartSize ?? Math.min(width, height);
  // Classic/compact preserve the wx maxradius/16 scale; Anglo has its own
  // tighter print-oriented typography profile.
  const drawStyle = resolveDrawStyle(opts);
  const maxRadius = scaledWheelRadius(
    drawStyle,
    wheelTypographyProfile(chart),
    chartSize,
  );
  const style = projectWheelAuthoringStyle(
    drawStyle,
    maxRadius,
    wheelTypographyProfile(chart),
  );
  applyStyleRevision(wheelStyleRevisionKey(style));
  const palette = style.palette as ChartPalette;
  const center: Pt = opts.center
    ? [opts.center[0], opts.center[1]]
    : [Math.floor(width / 2), Math.floor(height / 2)];
  const asc = chart.angles.asc;
  const hasComparison = Boolean(comparisonChart);
  const ringPresentation = resolvePdRingPresentation(snapshot);
  // wx graphchart.drawCircles draws the outer degree ring whenever the
  // secondary-ring mode is enabled (`showfixstars != NONE`), even when that
  // mode currently has no visible objects (graphchart.py:1601-1611, 1721-1735).
  const outerRingModeEnabled = snapshot.outerRingMode !== "none";
  const hasOuterRing = hasComparison || outerRingModeEnabled;
  const showOuterHouseCusps = comparisonShowsHouseCusps(snapshot, chart);
  const showOuterHouseBand = comparisonUsesOuterHouseBand(snapshot, chart);
  const restrainedAngloComparison = usesRestrainedAngloComparison(snapshot, chart);
  const directedBodyPlan = comparisonChart
    ? resolveComparisonBodyLayoutPlan(
        ringPresentation,
        chart,
        comparisonChart,
        {
          anglo: isAngloWheel(comparisonChart),
          primaryShowsHouses: Boolean(chart.options.showHouses),
          primaryShowsCusplessAscMcLabels: cusplessAscMcLabelsVisible(chart),
          showOuterHouseCusps,
          restrainedAngloComparison,
        },
      )
    : null;
  const showInterChartAspectFigure = Boolean(comparisonChart);
  const ringset: RingSet = hasComparison
    ? comparisonRings(
        style,
        chart,
        maxRadius,
        showOuterHouseBand,
        restrainedAngloComparison,
      )
    : effectiveRings(style, chart, maxRadius, hasOuterRing);
  // Resolved bands, so a glyph can be capped by the ring that holds it rather
  // than spilling into its neighbours when scaled up.
  const wheelBandInput = {
      profile: wheelTypographyProfile(chart),
      mode: hasComparison ? "comparison" : "single",
      maxRadius,
      hasOuterRing: hasComparison ? true : hasOuterRing,
      showTerms: Boolean(chart.options.showTerms),
      showDecans: Boolean(chart.options.showDecans),
      showHouses: Boolean(chart.options.showHouses),
      showPositions: Boolean(chart.options.showPositions),
      comparisonWithOuterHouses: hasComparison ? showOuterHouseBand : false,
      restrainedAngloComparison,
  } as const;
  const wheelBands: readonly ResolvedWheelBand[] = resolveWheelBandLayout(
    style,
    wheelBandInput,
    ringset,
  ).bands;
  // The same bands at their canonical thickness, so a band's contents can keep
  // the proportion the design specifies as the band is resized.
  // Kept, not just its bands: a band-seated run that is not a boundary — the
  // cusp ruler's ticks — needs its band's canonical thickness to hold the
  // proportion the design shipped.
  const canonicalRingset = resolveCanonicalWheelRingSet(style, wheelBandInput);
  const canonicalWheelBands: readonly ResolvedWheelBand[] = resolveWheelBandLayout(
    style,
    wheelBandInput,
    canonicalRingset,
  ).bands;
  draw.clear();
  if (layer === "fill") {
    drawRetainedFillLayer(draw, chart, style, center, ringset, width, height);
    return;
  }
  const typography = resolveWheelTypographyMetrics(
    style,
    wheelTypographyProfile(chart),
    maxRadius,
  );
  // Contained by the zodiac band, like the subdivision glyphs. Measured across
  // the preview matrix the shipped sign glyph peaks at 0.79 of its band, so
  // this changes nothing that ships and only binds once the band is dragged
  // thinner than the glyph.
  const signSize = bandClampedGlyphSize(
    "zodiac.signGlyph", typography.signSize, wheelBands, canonicalWheelBands,
  );
  const fontSymbols = style.typography.families.symbols;
  const fontBodySymbols = style.typography.families.bodySymbols;
  const fontSignSymbols = style.typography.families.signSymbols;
  const fontTermSymbols = style.typography.families.termSymbols;
  const fontDecanSymbols = style.typography.families.decanSymbols;
  const fontAspectSymbols = style.typography.families.aspectSymbols;
  const fontUi = style.typography.families.ui;

  if (layer === "geometry") {
    const routedBodyLayout =
      isAngloWheel(chart) && usesColumnAwareCusps(chart)
        ? draw.measure("body-layout", () =>
            getBodyLayout(
              draw,
              ringPresentation.traditionalConverse && comparisonChart
                ? comparisonChart
                : chart,
              center,
              asc,
              ringset.rPlanet,
              ringset.rPos,
              ringset.rRetr,
              fontBodySymbols,
              fontUi,
              typography,
              style,
              true,
              true,
              chart,
              ringPresentation.traditionalConverse
                ? directedBodyPlan ?? undefined
                : undefined,
            ),
          )
        : undefined;
    if (opts.geometryOwnsBackground !== false) {
      draw.fillBackground(palette.background);
    }
    drawCircles(
      draw,
      center,
      ringset,
      chartSize,
      palette,
      asc,
      chart,
      hasOuterRing,
      showOuterHouseBand,
      style,
    );
    drawTermsLines(draw, center, ringset, asc, chart, palette, style);
    drawDecanLines(draw, center, ringset, asc, chart, palette, style);
    drawAngloCuspRuler(
      draw, center, ringset, canonicalRingset, asc, chart, palette, style,
    );
    if (chart.options.showHouses) {
      drawHouses(
        draw,
        center,
        ringset,
        asc,
        chart,
        palette,
        style,
        routedBodyLayout,
      );
      if (comparisonChart && showOuterHouseCusps) {
        drawOuterHouses(
          draw,
          center,
          ringset,
          asc,
          comparisonChart,
          palette,
          style,
          restrainedAngloComparison,
        );
      }
      redrawMainCircles(draw, center, ringset, chartSize, palette, chart, style);
      drawAngloHouseCuspTicks(draw, center, ringset, asc, chart, palette, style);
      drawHouseNames(
        draw,
        center,
        ringset,
        asc,
        chart,
        palette,
        fontUi,
        typography.houseLabelSize,
        typography.layoutUnit,
        style,
        "houses.inner.label",
      );
      const outerHouseNameRadius =
        ringset.rOuterHouseName ?? ringset.rOuterArrow ?? ringset.rOuterASCMC;
      if (
        comparisonChart &&
        showOuterHouseCusps &&
        (showOuterHouseBand || restrainedAngloComparison) &&
        outerHouseNameRadius
      ) {
        drawHouseNames(
          draw,
          center,
          { ...ringset, rHouseName: outerHouseNameRadius } as RingSet,
          asc,
          comparisonChart,
          palette,
          fontUi,
          typography.outerHouseLabelSize,
          typography.outerLayoutUnit,
          style,
          "houses.outer.label",
        );
      }
    }
    drawSigns(
      draw,
      center,
      ringset,
      asc,
      chart,
      palette,
      fontSignSymbols,
      signSize,
      style,
    );
    drawAscMC(
      draw,
      center,
      ringset,
      asc,
      chart,
      chartSize,
      palette,
      style,
      routedBodyLayout,
    );
    if (comparisonChart && ringPresentation.showComparisonAxes) {
      drawOuterAscMC(draw, center, ringset, asc, comparisonChart, chartSize, palette, style);
    }
    return;
  }

  if (layer === "dynamic") {
    // Collision placement is a pure function of this snapshot. Positional
    // corrections are never carried across frames: a clear body therefore
    // returns to its true foot, and H/resize/history cannot change a result.
    const primaryBodyRings = bodyTrackRings(
      ringset,
      ringPresentation.primaryBodies.track,
    );
    const comparisonBodyRings = bodyTrackRings(
      ringset,
      ringPresentation.comparisonBodies.track,
    );
    const primaryBodyLayout = draw.measure("body-layout", () => {
      if (!ringPresentation.traditionalConverse) {
        return getBodyLayout(
          draw,
          chart,
          center,
          asc,
          primaryBodyRings.rPlanet,
          primaryBodyRings.rPos,
          primaryBodyRings.rRetr,
          fontBodySymbols,
          fontUi,
          typography,
          style,
        );
      }
      return {
        bodyShifts: getBodyShifts(
          draw,
          chart,
          center,
          asc,
          primaryBodyRings.rPlanet,
          fontBodySymbols,
          fontUi,
          typography,
          style,
          false,
          false,
          false,
          false,
          true,
          false,
          primaryBodyRings.rRetr,
          chart,
        ),
        labelYoffs: new Map<LayoutKey, number>(),
        componentBounds: new Map<LayoutKey, Bounds[]>(),
      };
    });
    const { bodyShifts, labelYoffs } = primaryBodyLayout;
    const directedBodyLayout =
      directedBodyPlan && ringPresentation.traditionalConverse
        ? getBodyLayout(
            draw,
            directedBodyPlan.bodyChart,
            center,
            asc,
            comparisonBodyRings.rPlanet,
            comparisonBodyRings.rPos,
            comparisonBodyRings.rRetr,
            fontBodySymbols,
            fontUi,
            typography,
            style,
            true,
            true,
            directedBodyPlan.frameworkChart,
            directedBodyPlan,
          )
        : null;
    const comparisonBodyShifts = directedBodyPlan
      ? directedBodyLayout?.bodyShifts ??
        getBodyShifts(
          draw,
          directedBodyPlan.bodyChart,
          center,
          asc,
          comparisonBodyRings.rPlanet,
          fontBodySymbols,
          fontUi,
          typography,
          style,
          directedBodyPlan.includeAngles,
          directedBodyPlan.includePositionStacks,
          directedBodyPlan.includeSharedAngles,
          directedBodyPlan.includeHouseCuspRays,
          directedBodyPlan.outerTypography,
          directedBodyPlan.usePrimaryGlyphSize,
          comparisonBodyRings.rRetr,
          directedBodyPlan.frameworkChart,
        )
      : null;
    const frameworkAngleShifts =
      ringPresentation.traditionalConverse && comparisonBodyShifts
        ? comparisonBodyShifts
        : bodyShifts;
    const comparisonLabelYoffs =
      directedBodyLayout?.labelYoffs ?? new Map<LayoutKey, number>();

    if (ringPresentation.primaryBodies.track === "outer") {
      drawOuterPlanetLines(
        draw, center, ringset, asc, chart, bodyShifts, chartSize, palette,
        typography.outerSize, typography, style,
      );
      drawAngloAngleLabelLines(
        draw, center, ringset, asc, chart, frameworkAngleShifts, palette, style,
      );
    } else {
      drawPlanetLines(
        draw, center, ringset, asc, chart, bodyShifts, chartSize, palette, style,
      );
      drawAngloAngleLabelLines(
        draw, center, ringset, asc, chart, bodyShifts, palette, style,
      );
    }
    if (comparisonChart && comparisonBodyShifts) {
      if (ringPresentation.comparisonBodies.track === "outer") {
        drawOuterPlanetLines(
          draw, center, ringset, asc, comparisonChart, comparisonBodyShifts,
          chartSize, palette,
          restrainedAngloComparison ? typography.bodySize : typography.outerSize,
          typography, style,
        );
        drawAngloOuterAngleLines(
          draw, center, ringset, asc, comparisonChart, comparisonBodyShifts,
          palette, style,
        );
      } else {
        drawPlanetLines(
          draw, center, ringset, asc, comparisonChart, comparisonBodyShifts,
          chartSize, palette, style,
        );
      }
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
          drawAspectLines(draw, center, ringset, asc, chart, palette, drawOuterPointAspects, style);
        } else {
          drawInterChartAspectMarkers(
            draw, center, ringset, asc, chart, comparisonChart,
            drawInterChartAspects, chartSize, palette, style, ringPresentation,
          );
          drawInterChartAspectLines(
            draw, center, ringset, asc, chart, comparisonChart,
            drawInterChartAspects, palette, style, ringPresentation,
          );
        }
      } else if (drawAspects) {
        drawAspectLines(draw, center, ringset, asc, chart, palette, drawAspects, style);
      }
    }
    const pdEventLayout = pdEventLayoutForSnapshot(
      snapshot,
      ringPresentation,
      center,
      ringset,
      asc,
    );
    if (pdEventLayout) {
      drawPdEventOverlay(
        draw,
        pdEventLayout,
        chart,
        chartSize,
        fontUi,
        typography,
        style,
      );
    }
    if (!comparisonChart && chart.drishti?.length) {
      drawDrishtiLines(draw, center, ringset, asc, chart, palette, style);
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
          typography,
          outerItemsChart,
          palette,
          style,
          opts.outerLabelCollisionBounds,
        );
        drawOuterRingItemLines(
          draw, center, ringset, asc, outerItemLayout, chart, chartSize,
          palette, typography, style,
        );
      } else {
        const fixedStarLayout = getFixedStarLayout(
          draw,
          chart,
          center,
          ringset,
          asc,
          fontUi,
          typography,
          style,
        );
        drawFixstarLines(draw, center, ringset, asc, chart, chartSize, fixedStarLayout, palette, style);
      }
    }

    drawPlanets(
      draw,
      center,
      primaryBodyRings,
      asc,
      chart,
      bodyShifts,
      labelYoffs,
      palette,
      fontBodySymbols,
      fontUi,
      typography,
      style,
      ringPresentation.primaryBodies.track === "outer",
    );
    if (comparisonChart && comparisonBodyShifts) {
      drawPlanets(
        draw,
        center,
        comparisonBodyRings,
        asc,
        comparisonChart,
        comparisonBodyShifts,
        comparisonLabelYoffs,
        palette,
        fontBodySymbols,
        fontUi,
        typography,
        style,
        ringPresentation.comparisonBodies.track === "outer",
        ringPresentation.comparisonBodies.track === "outer" && restrainedAngloComparison,
      );
      if (ringPresentation.showComparisonAxes) {
        drawAngloOuterAngleLabels(
          draw,
          center,
          ringset,
          asc,
          comparisonChart,
          comparisonBodyShifts,
          palette,
          fontUi,
          typography.outerAngleLabelSize,
          style,
        );
      }
    }
    drawTerms(
      draw, center, ringset, asc, chart, palette, fontTermSymbols,
      bandClampedGlyphSize(
        "subdivisions.term.glyph", typography.termSize, wheelBands, canonicalWheelBands,
      ),
      style,
    );
    drawDecans(
      draw, center, ringset, asc, chart, palette, fontDecanSymbols,
      bandClampedGlyphSize(
        "subdivisions.decan.glyph", typography.decanSize, wheelBands, canonicalWheelBands,
      ),
      style,
    );
    if (chart.options.showSymbols && chart.options.showAspects && drawAspects) {
      drawAspectSymbols(
        draw,
        center,
        ringset,
        asc,
        chart,
        palette,
        fontAspectSymbols,
        typography.aspectGlyphSize,
        typography.aspectGlyphOffset,
        drawAspects,
        style,
      );
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
        fontAspectSymbols,
        typography.interchartAspectGlyphSize,
        typography.aspectGlyphOffset,
        style,
        ringPresentation,
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
        fontSignSymbols,
        typography,
        frameworkAngleShifts,
        style,
      );
      if (chart.options.showHouses) {
        drawHousePos(
          draw,
          center,
          ringset,
          asc,
          chart,
          palette,
          fontUi,
          fontSignSymbols,
          typography,
          style,
        );
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
      typography,
      outerItemsChart,
      palette,
      style,
      opts.outerLabelCollisionBounds,
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
      typography,
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
      typography,
      style,
    );
    drawFixstars(
      draw,
      center,
      ringset,
      asc,
      fixedStarLayout,
      palette,
      fontUi,
      typography.secondaryRing["secondaryRing.fixedStar.label"]
        ?? typography.outerLabelSize,
      typography.outerLayoutUnit,
      style,
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
    typography.outerLayoutUnit,
    style,
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
  /** Style-editor-only geometry is excluded from astrology hover/click routing. */
  styleOnly?: boolean;
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
      leaderSegments?: readonly { start: Pt; end: Pt }[];
      // 'outer' for a biwheel/synastry/transit outer-ring body (graphchart.py:
      // 2151). The daemon resolves these against the comparison chart.
      chartRole?: "primary" | "outer";
    }
  | { kind: "fortune"; x: number; y: number; r: number; longitude: number; chartRole?: "primary" | "outer"; leaderSegments?: readonly { start: Pt; end: Pt }[] }
  | {
      kind: "vertex";
      x: number;
      y: number;
      r: number;
      longitude: number;
      house?: number;
      chartRole?: "primary" | "outer";
      leaderSegments?: readonly { start: Pt; end: Pt }[];
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
      leaderSegments?: readonly { start: Pt; end: Pt }[];
    }
  | {
      kind: "eclipse";
      x: number;
      y: number;
      r: number;
      longitude: number;
      house?: number;
      label?: string;
      chartRole?: "primary" | "outer";
      leaderSegments?: readonly { start: Pt; end: Pt }[];
    }
  | {
      kind: "angle";
      angleId: "asc" | "mc" | "dsc" | "ic";
      x: number;
      y: number;
      r: number;
      longitude: number;
      chartRole?: "primary" | "outer";
      // Non-label angles keep their existing generous endpoint disc and also
      // expose the exact painted ray, so a bare DC/IC line is as practical to
      // select as the arrowheaded AC/MC lines.
      shape?: "line";
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
      tolerance?: number;
    }
  | {
      kind: "drishti";
      relationId: string;
      method: "parashari" | "jaimini";
      x: number;
      y: number;
      r: number;
      shape: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      tolerance: number;
    }
  | { kind: "house"; houseIndex: number; x: number; y: number; r: number; longitude: number }
  | {
      kind: "subdivision";
      family: "term" | "decan";
      component: "boundary" | "glyph";
      itemId: string;
      glyph?: string;
      x: number;
      y: number;
      r: number;
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
      tolerance?: number;
    }
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
      leader?: {
        start: Pt;
        end: Pt;
      };
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
      angleId?: number;
      label?: "AC" | "DC" | "MC" | "IC";
      /** Exact event semantics supplied by the daemon, never derived here. */
      directionState: PdDirectionState;
      interactive: true;
      shape: "line" | "rect";
      x: number;
      y: number;
      r: number;
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
  | {
      /** Exact, occurrence-level geometry consumed only by the Style Lab. */
      kind: "style_target";
      classId:
        | WheelAuthoringTypographyClass
        | WheelAuthoringLineClass
        | WheelChartOverlayClass;
      itemId: string;
      ownerId?: string;
      bodyId?: string;
      colorValue?: string;
      compactOverlay?: boolean;
      shape: "rect" | "line";
      x: number;
      y: number;
      r: number;
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
      tolerance?: number;
      signIndex?: number;
  }
);

type WheelStyleTargetClass =
  | WheelAuthoringTypographyClass
  | WheelAuthoringLineClass
  | WheelChartOverlayClass;

function pushStyleRectTarget(
  regions: ChartHitRegion[],
  classId: WheelStyleTargetClass,
  itemId: string,
  bounds: Bounds & { signIndex?: number },
  metadata: Readonly<{
    ownerId?: string;
    bodyId?: string;
    colorValue?: string;
    compactOverlay?: boolean;
  }> = {},
): void {
  const left = Math.round(bounds.x);
  const top = Math.round(bounds.y);
  const width = Math.max(1, bounds.w);
  const height = Math.max(1, bounds.h);
  regions.push({
    kind: "style_target",
    classId,
    itemId,
    shape: "rect",
    left,
    top,
    width,
    height,
    x: left + width / 2,
    y: top + height / 2,
    r: Math.hypot(width, height) / 2,
    styleOnly: true,
    ...metadata,
    ...(bounds.signIndex != null
      ? { signIndex: bounds.signIndex }
      : {}),
  });
}

function pushStyleTextTarget(
  regions: ChartHitRegion[],
  classId: WheelAuthoringTypographyClass | WheelChartOverlayClass,
  itemId: string,
  bounds: Bounds & { signIndex?: number },
  metadata: Readonly<{
    ownerId?: string;
    bodyId?: string;
    colorValue?: string;
    compactOverlay?: boolean;
  }> = {},
): void {
  pushStyleRectTarget(regions, classId, itemId, bounds, metadata);
}

function pushStyleLineTarget(
  regions: ChartHitRegion[],
  classId: WheelAuthoringLineClass,
  itemId: string,
  start: Pt,
  end: Pt,
  tolerance: number,
  ownerId?: string,
): void {
  regions.push({
    kind: "style_target",
    classId,
    itemId,
    shape: "line",
    x: (start[0] + end[0]) / 2,
    y: (start[1] + end[1]) / 2,
    r: tolerance,
    x1: start[0],
    y1: start[1],
    x2: end[0],
    y2: end[1],
    tolerance,
    styleOnly: true,
    ...(ownerId ? { ownerId } : {}),
  });
}

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
  style: WheelRenderStyle,
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
      priority: style.hit.priorities.aspectGlyph,
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
    priority: style.hit.priorities.aspectLine,
  });
}

interface ComputeHitRegionsOptionsBase {
  width: number;
  height: number;
  chartSize?: number;
  /** Rigid wheel origin. Defaults to the host centre. */
  center?: readonly [number, number];
  outerLabelCollisionBounds?: readonly OuterLabelCollisionBounds[];
  textsize?: (text: string, opts?: TextOpts) => Pt;
  clickAspectState?: ClickAspectState;
  /** Emit exact semantic occurrences for Style Lab selection. Defaults off. */
  includeStyleTargets?: boolean;
}

export type ComputeHitRegionsOptions = ComputeHitRegionsOptionsBase & WheelRenderStyleSource;

export function computeHitRegions(
  snapshot: ChartRenderSnapshot,
  opts: ComputeHitRegionsOptions,
): ChartHitRegion[] {
  const chart = snapshot.primaryChart;
  const width = opts.width;
  const height = opts.height;
  if (width <= 0 || height <= 0) return [];
  const chartSize = opts.chartSize ?? Math.min(width, height);
  // Hit regions are solved in the same scaled world the paint uses, or a scaled
  // wheel would keep its hover and click targets at full size.
  const hitStyle = resolveWheelRenderStyle(opts);
  const maxRadius = scaledWheelRadius(
    hitStyle,
    wheelTypographyProfile(chart),
    chartSize,
  );
  const style = projectWheelAuthoringStyle(
    hitStyle,
    maxRadius,
    wheelTypographyProfile(chart),
  );
  applyStyleRevision(wheelStyleRevisionKey(style));
  const center: Pt = opts.center
    ? [opts.center[0], opts.center[1]]
    : [Math.floor(width / 2), Math.floor(height / 2)];
  const asc = chart.angles.asc;
  const palette = style.palette as ChartPalette;
  const fontUi = style.typography.families.ui;
  const fontSymbols = style.typography.families.symbols;
  const fontBodySymbols = style.typography.families.bodySymbols;
  const fontSignSymbols = style.typography.families.signSymbols;
  const fontTermSymbols = style.typography.families.termSymbols;
  const fontDecanSymbols = style.typography.families.decanSymbols;
  const measurer: TextMeasurer = {
    textsize:
      opts.textsize ??
      ((text, textOpts) =>
        fallbackTextsize(
          text,
          textOpts,
          style.typography.ratios.fallbackMeasureWidthScale,
        )),
  };
  const comparisonChart = snapshot.comparisonChart ?? undefined;
  const hasComparison = Boolean(comparisonChart);
  const ringPresentation = resolvePdRingPresentation(snapshot);
  const hasOuterRing = hasComparison || snapshot.outerRingMode !== "none";
  const showOuterHouseCusps = comparisonShowsHouseCusps(snapshot, chart);
  const showOuterHouseBand = comparisonUsesOuterHouseBand(snapshot, chart);
  const restrainedAngloComparison = usesRestrainedAngloComparison(snapshot, chart);
  const showInterChartAspectFigure = Boolean(comparisonChart);
  const ringset: RingSet = hasComparison
    ? comparisonRings(
        style,
        chart,
        maxRadius,
        showOuterHouseBand,
        restrainedAngloComparison,
      )
    : effectiveRings(style, chart, maxRadius, hasOuterRing);
  const typography = resolveWheelTypographyMetrics(
    style,
    wheelTypographyProfile(chart),
    maxRadius,
  );
  const symbolSize = typography.bodySize;
  const outerSymbolSize = restrainedAngloComparison
    ? typography.bodySize
    : typography.outerSize;
  // Hit testing sizes the sign glyph exactly as paint does. Reading the
  // unclamped size here would leave hover targets at full size over a glyph the
  // band had already shrunk — the desync appears precisely when a band is
  // squeezed, which is when someone is looking closely.
  const hitBandInput = {
    profile: wheelTypographyProfile(chart),
    mode: hasComparison ? "comparison" : "single",
    maxRadius,
    hasOuterRing: hasComparison ? true : hasOuterRing,
    showTerms: Boolean(chart.options.showTerms),
    showDecans: Boolean(chart.options.showDecans),
    showHouses: Boolean(chart.options.showHouses),
    showPositions: Boolean(chart.options.showPositions),
    comparisonWithOuterHouses: hasComparison ? showOuterHouseBand : false,
    restrainedAngloComparison,
  } as const;
  const signSize = bandClampedGlyphSize(
    "zodiac.signGlyph",
    typography.signSize,
    resolveWheelBandLayout(style, hitBandInput, ringset).bands,
    resolveWheelBandLayout(
      style, hitBandInput, resolveCanonicalWheelRingSet(style, hitBandInput),
    ).bands,
  );
  const hit = style.hit;
  const priorities = hit.priorities;
  const hitRadius = Math.max(hit.bodyRadiusMin, maxRadius / hit.bodyRadiusDivisor);
  const angleLineTolerance = Math.max(
    hit.aspectLineToleranceMin,
    hitRadius * 0.5,
  );
  const pdEventHitTolerance = Math.max(
    4,
    Math.min(10, mediumPenWidth(style, chartSize) * 2.5),
  );
  const planets = planetById(chart);
  const primaryBodyRings = bodyTrackRings(
    ringset,
    ringPresentation.primaryBodies.track,
  );
  const comparisonBodyRings = bodyTrackRings(
    ringset,
    ringPresentation.comparisonBodies.track,
  );
  const directedBodyPlan = comparisonChart
    ? resolveComparisonBodyLayoutPlan(
        ringPresentation,
        chart,
        comparisonChart,
        {
          anglo: isAngloWheel(comparisonChart),
          primaryShowsHouses: Boolean(chart.options.showHouses),
          primaryShowsCusplessAscMcLabels: cusplessAscMcLabelsVisible(chart),
          showOuterHouseCusps,
          restrainedAngloComparison,
        },
      )
    : null;
  const bodyLayout = ringPresentation.traditionalConverse
    ? {
        bodyShifts: getBodyShifts(
          measurer,
          chart,
          center,
          asc,
          primaryBodyRings.rPlanet,
          fontBodySymbols,
          fontUi,
          typography,
          style,
          false,
          false,
          false,
          false,
          true,
          false,
          primaryBodyRings.rRetr,
          chart,
        ),
        labelYoffs: new Map<LayoutKey, number>(),
        componentBounds: new Map<LayoutKey, Bounds[]>(),
      }
    : getBodyLayout(
        measurer,
        chart,
        center,
        asc,
        primaryBodyRings.rPlanet,
        primaryBodyRings.rPos,
        primaryBodyRings.rRetr,
        fontBodySymbols,
        fontUi,
        typography,
        style,
      );
  const { bodyShifts, labelYoffs } = bodyLayout;
  const directedBodyLayoutForHits =
    directedBodyPlan && ringPresentation.traditionalConverse
      ? getBodyLayout(
          measurer,
          directedBodyPlan.bodyChart,
          center,
          asc,
          comparisonBodyRings.rPlanet,
          comparisonBodyRings.rPos,
          comparisonBodyRings.rRetr,
          fontBodySymbols,
          fontUi,
          typography,
          style,
          true,
          true,
          directedBodyPlan.frameworkChart,
          directedBodyPlan,
        )
      : null;
  const frameworkRoutedBodyLayout = directedBodyLayoutForHits ?? bodyLayout;
  const frameworkAngleShiftsForHits = ringPresentation.traditionalConverse
    ? frameworkRoutedBodyLayout.bodyShifts
    : bodyShifts;

  const regions: ChartHitRegion[] = [];
  const pdEventLayout = pdEventLayoutForSnapshot(
    snapshot,
    ringPresentation,
    center,
    ringset,
    asc,
  );
  const pdDirectionState = snapshot.pdDirectionState;
  const pdEventIsInteractive = Boolean(
    pdEventLayout
    && pdDirectionState
    && pdDirectionState.schemaVersion === 1
    && pdDirectionState.eventId === pdEventLayout.eventId
    && typeof pdDirectionState.eventKind === "string"
    && pdDirectionState.eventKind.trim().length > 0
    && pdDirectionState.direction === pdEventLayout.direction
    && pdDirectionState.exactNow === pdEventLayout.exactNow
    && (pdDirectionState.domain === "zodiacal" || pdDirectionState.domain === "mundane")
    && (snapshot.pdEventOverlay?.domain == null
      || pdDirectionState.domain === snapshot.pdEventOverlay.domain)
    && (pdDirectionState.direction === "direct" || pdDirectionState.direction === "converse")
    && (pdDirectionState.system === null || Number.isFinite(pdDirectionState.system))
    && (pdDirectionState.eventJd === null || Number.isFinite(pdDirectionState.eventJd))
    && typeof pdDirectionState.eventLabel === "string"
    && pdDirectionState.eventLabel.trim().length > 0
    && (pdDirectionState.phase === "applying"
      || pdDirectionState.phase === "exact"
      || pdDirectionState.phase === "separating")
    && (pdDirectionState.exactNow === (pdDirectionState.phase === "exact"))
    && Number.isFinite(pdDirectionState.exactArcDegrees)
    && Number.isFinite(pdDirectionState.exactArcDegreesSigned)
    && Number.isFinite(pdDirectionState.currentArcDegreesSigned)
    && Number.isFinite(pdDirectionState.remainingArcDegreesSigned)
    && Number.isFinite(pdDirectionState.remainingArcDegrees)
    && pdDirectionState.remainingArcDegrees >= 0
  );
  if (pdEventLayout && pdDirectionState && pdEventIsInteractive) {
    for (const primitive of [
      pdEventLayout.directionRay,
      pdEventLayout.directedAngle,
    ]) {
      const x = (primitive.start[0] + primitive.end[0]) / 2;
      const y = (primitive.start[1] + primitive.end[1]) / 2;
      regions.push({
        kind: "pd_event",
        eventId: pdEventLayout.eventId,
        eventKind: pdEventLayout.eventKind,
        component: primitive.primitiveKind,
        partyRole: primitive.partyRole,
        sourceRole: primitive.sourceRole,
        track: primitive.track,
        motion: primitive.motion,
        exactNow: pdEventLayout.exactNow,
        longitude: primitive.longitude,
        nativeCoordinate: primitive.nativeCoordinate,
        ...(primitive.angleId == null ? {} : { angleId: primitive.angleId }),
        directionState: pdDirectionState,
        interactive: true,
        shape: "line",
        x,
        y,
        r: pdEventHitTolerance,
        x1: primitive.start[0],
        y1: primitive.start[1],
        x2: primitive.end[0],
        y2: primitive.end[1],
        tolerance: pdEventHitTolerance,
        priority: primitive.primitiveKind === "directed-angle"
          ? priorities.angle
          : primitive.track === "outer"
            ? priorities.outerBody
            : priorities.planet,
      });
    }
    if (pdEventLayout.directedAngleLabel) {
      const outer = pdEventLayout.directedAngle.track === "outer";
      const labelPaint = semanticTypographyPaint(
        style,
        outer ? "angles.outer.label" : "angles.inner.label",
        {
          font: fontUi,
          size: outer
            ? typography.outerAngleLabelSize
            : typography.angleLabelSize,
          weight: style.typography.ratios.angleLabelWeight,
          color: style.elementColors.angleLabel,
        },
      );
      const [width, height] = measurer.textsize(
        pdEventLayout.directedAngleLabel.text,
        typographyTextOpts(labelPaint),
      );
      const left = pdEventLayout.directedAngleLabel.anchor[0] - width / 2;
      const top = pdEventLayout.directedAngleLabel.anchor[1] - height / 2;
      regions.push({
        kind: "pd_event",
        eventId: pdEventLayout.eventId,
        eventKind: pdEventLayout.eventKind,
        component: "directed-angle-label",
        partyRole: pdEventLayout.directedAngle.partyRole,
        sourceRole: pdEventLayout.directedAngle.sourceRole,
        track: pdEventLayout.directedAngle.track,
        motion: pdEventLayout.directedAngle.motion,
        exactNow: pdEventLayout.exactNow,
        longitude: pdEventLayout.directedAngle.longitude,
        nativeCoordinate: pdEventLayout.directedAngle.nativeCoordinate,
        angleId: pdEventLayout.directedAngleLabel.angleId,
        label: pdEventLayout.directedAngleLabel.text,
        directionState: pdDirectionState,
        interactive: true,
        shape: "rect",
        left,
        top,
        width,
        height,
        x: left + width / 2,
        y: top + height / 2,
        r: pdEventHitTolerance,
        priority: priorities.angle,
      });
    }
  }
  const comparisonPlanetMapForPaint = comparisonChart
    ? planetById(comparisonChart)
    : null;

  const bodyGlyphPaintBounds = (
    x: number,
    y: number,
    bodyChart: Chart,
    key: BodyKey,
    glyph: string,
    baseSize = symbolSize,
    outer = false,
  ) => {
    const glyphSize = bodyGlyphSize(key, baseSize, typography.syzygyScale);
    const glyphPaint = semanticTypographyPaint(
      style,
      bodyGlyphClassId(key, outer),
      {
        font: bodyGlyphFont(bodyChart, key, fontBodySymbols, fontUi),
        size: glyphSize,
        color: bodyColor(
          bodyChart,
          bodyChart === chart
            ? planets
            : comparisonPlanetMapForPaint ?? planets,
          key,
          palette,
        ),
      },
    );
    const [glyphWidth, glyphHeight] = measurer.textsize(glyph, {
      ...typographyTextOpts(glyphPaint),
    });
    return {
      x: x - glyphPaint.size / 2,
      y: y - glyphPaint.size / 2,
      w: Math.max(1, glyphWidth),
      h: Math.max(1, glyphHeight),
      paintSize: glyphPaint.size,
    };
  };
  const bodyGlyphBox = (
    x: number,
    y: number,
    bodyChart: Chart,
    key: BodyKey,
    glyph: string,
    baseSize = symbolSize,
    outer = false,
  ) => {
    const bounds = bodyGlyphPaintBounds(
      x,
      y,
      bodyChart,
      key,
      glyph,
      baseSize,
      outer,
    );
    const bodyHitPad = Math.max(
      hit.bodyPadMin,
      Math.round(bounds.paintSize * hit.bodyPadScale),
    );
    return {
      left: bounds.x - bodyHitPad,
      top: bounds.y - bodyHitPad,
      width: bounds.w + bodyHitPad * 2,
      height: bounds.h + bodyHitPad * 2,
    };
  };
  const bodyDiscRadius = (baseSize: number) =>
    Math.max(hit.glyphRadiusMin, baseSize * hit.glyphRadiusScale);
  const bodyLeaderSegments = (
    track: BodyRingTrack,
    bodyChart: Chart,
    longitude: number,
    shift: number,
  ) => {
    const shiftedLongitude = isAngloWheel(bodyChart) ? longitude : longitude + shift;
    if (track === "outer") {
      const lane = outerGlyphLane(ringset, outerSymbolSize, typography, style);
      return [{
        start: polar(center, ringset.r30, longitude, asc),
        end: polar(center, lane.leaderRadius, shiftedLongitude, asc),
      }];
    }
    const segments = [{
      start: polar(center, ringset.rInner, longitude, asc),
      end: polar(center, ringset.rLLine, shiftedLongitude, asc),
    }];
    if (!isCompactWheel(bodyChart)) {
      segments.push({
        start: polar(center, ringset.rAsp, longitude, asc),
        end: polar(center, ringset.rLLine2, shiftedLongitude, asc),
      });
    }
    return segments;
  };

  for (const planet of chart.planets) {
    if (!Number.isFinite(planet.longitude)) continue;
    const shift = bodyShifts.get(planet.id) ?? 0;
    const [x, y] = polar(
      center, primaryBodyRings.rPlanet, planet.longitude + shift, asc,
    );
    const glyph = bodyGlyph(chart, planets, planet.id);
    regions.push({
      kind: "planet",
      planetId: planet.id,
      seId: planet.seId,
      x,
      y,
      r: bodyDiscRadius(
        ringPresentation.primaryBodies.track === "outer"
          ? outerSymbolSize
          : symbolSize,
      ),
      ...bodyGlyphBox(
        x,
        y,
        chart,
        planet.id,
        glyph,
        ringPresentation.primaryBodies.track === "outer"
          ? outerSymbolSize
          : symbolSize,
        ringPresentation.primaryBodies.track === "outer",
      ),
      longitude: planet.longitude,
      latitude: planet.latitude,
      speed: planet.speed,
      house: planet.house,
      dignity: planet.dignity,
      leaderSegments: bodyLeaderSegments(
        ringPresentation.primaryBodies.track, chart, planet.longitude, shift,
      ),
      priority:
        ringPresentation.primaryBodies.track === "outer"
          ? priorities.outerBody
          : priorities.planet,
    });
  }

  if (chart.fortune && Number.isFinite(chart.fortune.longitude)) {
    const shift = bodyShifts.get("__fortune") ?? 0;
    const [x, y] = polar(center, primaryBodyRings.rPlanet, chart.fortune.longitude + shift, asc);
    const glyph = bodyGlyph(chart, planets, "__fortune");
    regions.push({
      kind: "fortune",
      x, y,
      r: bodyDiscRadius(ringPresentation.primaryBodies.track === "outer" ? outerSymbolSize : symbolSize),
      ...bodyGlyphBox(x, y, chart, "__fortune", glyph,
        ringPresentation.primaryBodies.track === "outer" ? outerSymbolSize : symbolSize,
        ringPresentation.primaryBodies.track === "outer"),
      longitude: chart.fortune.longitude,
      leaderSegments: bodyLeaderSegments(ringPresentation.primaryBodies.track, chart, chart.fortune.longitude, shift),
      priority: ringPresentation.primaryBodies.track === "outer" ? priorities.outerBody : priorities.fortune,
    });
  }

  if (chart.vertex && Number.isFinite(chart.vertex.longitude)) {
    const shift = bodyShifts.get("__vertex") ?? 0;
    const [x, y] = polar(center, primaryBodyRings.rPlanet, chart.vertex.longitude + shift, asc);
    const glyph = bodyGlyph(chart, planets, "__vertex");
    regions.push({
      kind: "vertex",
      x, y,
      r: bodyDiscRadius(ringPresentation.primaryBodies.track === "outer" ? outerSymbolSize : symbolSize),
      ...bodyGlyphBox(x, y, chart, "__vertex", glyph,
        ringPresentation.primaryBodies.track === "outer" ? outerSymbolSize : symbolSize,
        ringPresentation.primaryBodies.track === "outer"),
      longitude: chart.vertex.longitude,
      house: chart.vertex.house,
      leaderSegments: bodyLeaderSegments(ringPresentation.primaryBodies.track, chart, chart.vertex.longitude, shift),
      // Inner-ring body priority 40 (graphchart.py:2182, `not outer`).
      priority: ringPresentation.primaryBodies.track === "outer" ? priorities.outerBody : priorities.planet,
    });
  }

  if (chart.syzygy && !chart.eclipse?.coincidesWithSyzygy && Number.isFinite(chart.syzygy.longitude)) {
    const shift = bodyShifts.get("__syzygy") ?? 0;
    const [x, y] = polar(center, primaryBodyRings.rPlanet, chart.syzygy.longitude + shift, asc);
    const glyph = bodyGlyph(chart, planets, "__syzygy");
    regions.push({
      kind: "syzygy",
      x, y,
      r: bodyDiscRadius(ringPresentation.primaryBodies.track === "outer" ? outerSymbolSize : symbolSize),
      ...bodyGlyphBox(x, y, chart, "__syzygy", glyph,
        ringPresentation.primaryBodies.track === "outer" ? outerSymbolSize : symbolSize,
        ringPresentation.primaryBodies.track === "outer"),
      longitude: chart.syzygy.longitude,
      house: chart.syzygy.house,
      label: chart.syzygy.label,
      leaderSegments: bodyLeaderSegments(ringPresentation.primaryBodies.track, chart, chart.syzygy.longitude, shift),
      priority: ringPresentation.primaryBodies.track === "outer" ? priorities.outerBody : priorities.planet,
    });
  }

  if (chart.eclipse && Number.isFinite(chart.eclipse.longitude)) {
    const shift = bodyShifts.get("__eclipse") ?? 0;
    const [x, y] = polar(center, primaryBodyRings.rPlanet, chart.eclipse.longitude + shift, asc);
    const glyph = bodyGlyph(chart, planets, "__eclipse");
    regions.push({
      kind: "eclipse",
      x, y,
      r: bodyDiscRadius(ringPresentation.primaryBodies.track === "outer" ? outerSymbolSize : symbolSize),
      ...bodyGlyphBox(x, y, chart, "__eclipse", glyph,
        ringPresentation.primaryBodies.track === "outer" ? outerSymbolSize : symbolSize,
        ringPresentation.primaryBodies.track === "outer"),
      longitude: chart.eclipse.longitude,
      house: chart.eclipse.house,
      label: chart.eclipse.label,
      leaderSegments: bodyLeaderSegments(ringPresentation.primaryBodies.track, chart, chart.eclipse.longitude, shift),
      priority: ringPresentation.primaryBodies.track === "outer" ? priorities.outerBody : priorities.planet,
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
  if (comparisonChart && directedBodyPlan) {
    const comparisonBodyRadius = resolveBodyTrackRadius(
      ringPresentation.comparisonBodies,
      {
        inner: ringset.rPlanet,
        outer: ringset.rOuterPlanet ?? ringset.rPlanet,
      },
    );
    const comparisonPlanets = planetById(comparisonChart);
    const outerBodyShifts = directedBodyLayoutForHits?.bodyShifts ??
      getBodyShifts(
        measurer,
        directedBodyPlan.bodyChart,
        center,
        asc,
        comparisonBodyRadius,
        fontBodySymbols,
        fontUi,
        typography,
        style,
        directedBodyPlan.includeAngles,
        directedBodyPlan.includePositionStacks,
        directedBodyPlan.includeSharedAngles,
        directedBodyPlan.includeHouseCuspRays,
        directedBodyPlan.outerTypography,
        directedBodyPlan.usePrimaryGlyphSize,
        comparisonBodyRings.rRetr,
        directedBodyPlan.frameworkChart,
      );
    outerBodyShiftsForHits = outerBodyShifts;
    const comparisonSymbolSize =
      ringPresentation.comparisonBodies.track === "outer"
        ? outerSymbolSize
        : symbolSize;
    for (const planet of comparisonChart.planets) {
      if (!Number.isFinite(planet.longitude)) continue;
      const shift = outerBodyShifts.get(planet.id) ?? 0;
      const [x, y] = polar(center, comparisonBodyRadius, planet.longitude + shift, asc);
      const glyph = bodyGlyph(comparisonChart, comparisonPlanets, planet.id);
      regions.push({
        kind: "planet",
        planetId: planet.id,
        seId: planet.seId,
        x,
        y,
        r: bodyDiscRadius(comparisonSymbolSize),
        ...bodyGlyphBox(
          x,
          y,
          comparisonChart,
          planet.id,
          glyph,
          comparisonSymbolSize,
          ringPresentation.comparisonBodies.track === "outer",
        ),
        longitude: planet.longitude,
        latitude: planet.latitude,
        speed: planet.speed,
        house: planet.house,
        dignity: planet.dignity,
        chartRole: "outer",
        leaderSegments: bodyLeaderSegments(
          ringPresentation.comparisonBodies.track,
          comparisonChart,
          planet.longitude,
          shift,
        ),
        priority:
          ringPresentation.comparisonBodies.track === "outer"
            ? priorities.outerBody
            : priorities.planet,
      });
    }
    if (comparisonChart.fortune && Number.isFinite(comparisonChart.fortune.longitude)) {
      const shift = outerBodyShifts.get("__fortune") ?? 0;
      const [x, y] = polar(center, comparisonBodyRadius, comparisonChart.fortune.longitude + shift, asc);
      const glyph = bodyGlyph(comparisonChart, comparisonPlanets, "__fortune");
      regions.push({
        kind: "fortune",
        x,
        y,
        r: bodyDiscRadius(comparisonSymbolSize),
        ...bodyGlyphBox(
          x,
          y,
          comparisonChart,
          "__fortune",
          glyph,
          comparisonSymbolSize,
          ringPresentation.comparisonBodies.track === "outer",
        ),
        longitude: comparisonChart.fortune.longitude,
        chartRole: "outer",
        leaderSegments: bodyLeaderSegments(ringPresentation.comparisonBodies.track, comparisonChart, comparisonChart.fortune.longitude, shift),
        priority: ringPresentation.comparisonBodies.track === "outer" ? priorities.outerBody : priorities.fortune,
      });
    }
    if (comparisonChart.vertex && Number.isFinite(comparisonChart.vertex.longitude)) {
      const shift = outerBodyShifts.get("__vertex") ?? 0;
      const [x, y] = polar(center, comparisonBodyRadius, comparisonChart.vertex.longitude + shift, asc);
      const glyph = bodyGlyph(comparisonChart, comparisonPlanets, "__vertex");
      regions.push({
        kind: "vertex",
        x,
        y,
        r: bodyDiscRadius(comparisonSymbolSize),
        ...bodyGlyphBox(
          x,
          y,
          comparisonChart,
          "__vertex",
          glyph,
          comparisonSymbolSize,
          ringPresentation.comparisonBodies.track === "outer",
        ),
        longitude: comparisonChart.vertex.longitude,
        house: comparisonChart.vertex.house,
        chartRole: "outer",
        leaderSegments: bodyLeaderSegments(ringPresentation.comparisonBodies.track, comparisonChart, comparisonChart.vertex.longitude, shift),
        priority: ringPresentation.comparisonBodies.track === "outer" ? priorities.outerBody : priorities.planet,
      });
    }
    if (comparisonChart.syzygy && !comparisonChart.eclipse?.coincidesWithSyzygy && Number.isFinite(comparisonChart.syzygy.longitude)) {
      const shift = outerBodyShifts.get("__syzygy") ?? 0;
      const [x, y] = polar(center, comparisonBodyRadius, comparisonChart.syzygy.longitude + shift, asc);
      const glyph = bodyGlyph(comparisonChart, comparisonPlanets, "__syzygy");
      regions.push({
        kind: "syzygy",
        x,
        y,
        r: bodyDiscRadius(comparisonSymbolSize),
        ...bodyGlyphBox(
          x,
          y,
          comparisonChart,
          "__syzygy",
          glyph,
          comparisonSymbolSize,
          ringPresentation.comparisonBodies.track === "outer",
        ),
        longitude: comparisonChart.syzygy.longitude,
        house: comparisonChart.syzygy.house,
        label: comparisonChart.syzygy.label,
        chartRole: "outer",
        leaderSegments: bodyLeaderSegments(ringPresentation.comparisonBodies.track, comparisonChart, comparisonChart.syzygy.longitude, shift),
        priority: ringPresentation.comparisonBodies.track === "outer" ? priorities.outerBody : priorities.planet,
      });
    }
    if (comparisonChart.eclipse && Number.isFinite(comparisonChart.eclipse.longitude)) {
      const shift = outerBodyShifts.get("__eclipse") ?? 0;
      const [x, y] = polar(center, comparisonBodyRadius, comparisonChart.eclipse.longitude + shift, asc);
      const glyph = bodyGlyph(comparisonChart, comparisonPlanets, "__eclipse");
      regions.push({
        kind: "eclipse",
        x,
        y,
        r: bodyDiscRadius(comparisonSymbolSize),
        ...bodyGlyphBox(
          x,
          y,
          comparisonChart,
          "__eclipse",
          glyph,
          comparisonSymbolSize,
          ringPresentation.comparisonBodies.track === "outer",
        ),
        longitude: comparisonChart.eclipse.longitude,
        house: comparisonChart.eclipse.house,
        label: comparisonChart.eclipse.label,
        chartRole: "outer",
        leaderSegments: bodyLeaderSegments(ringPresentation.comparisonBodies.track, comparisonChart, comparisonChart.eclipse.longitude, shift),
        priority: ringPresentation.comparisonBodies.track === "outer" ? priorities.outerBody : priorities.planet,
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
      if (frameworkAngleShiftsForHits.has(layoutKey)) {
        const label = angleId === "asc" ? "AC" : "MC";
        const shiftedLon = lon + (frameworkAngleShiftsForHits.get(layoutKey) ?? 0);
        const [x, y] = polar(center, ringset.rPlanet, shiftedLon, asc);
        const labelSize = layoutGlyphSize(
          layoutKey,
          typography.bodySize,
          typography.angleLabelSize,
          typography.syzygyScale,
        );
        const labelPaint = semanticTypographyPaint(style, "angles.inner.label", {
          font: fontUi,
          size: labelSize,
          weight: style.typography.ratios.angleLabelWeight,
          color: style.elementColors.angleLabel,
        });
        const [labelWidth, labelHeight] = measurer.textsize(
          label,
          typographyTextOpts(labelPaint),
        );
        const pad = Math.max(
          hit.angleLabelPadMin,
          typography.layoutUnit * hit.angleLabelPadScale,
        );
        regions.push({
          kind: "angle",
          angleId,
          x,
          y,
          r: Math.max(hitRadius, labelPaint.size / 2),
          left: x - labelWidth / 2 - pad,
          top: y - labelHeight / 2 - pad,
          width: labelWidth + pad * 2,
          height: labelHeight + pad * 2,
          longitude: lon,
          priority: priorities.angloAngle,
        });
      } else {
        const [x1, y1] = polar(center, ringset.rBase, lon, asc);
        const [x, y] = polar(center, ringset.rInner, lon, asc);
        regions.push({
          kind: "angle",
          angleId,
          x,
          y,
          r: hitRadius,
          shape: "line",
          x1,
          y1,
          x2: x,
          y2: y,
          tolerance: angleLineTolerance,
          longitude: lon,
          priority: priorities.angloAngle,
        });
      }
      continue;
    }
    const [x1, y1] = polar(center, ringset.rBase, lon, asc);
    const [x, y] = polar(center, ringset.rASCMC, lon, asc);
    regions.push({
      kind: "angle",
      angleId,
      x,
      y,
      r: hitRadius,
      shape: "line",
      x1,
      y1,
      x2: x,
      y2: y,
      tolerance: angleLineTolerance,
      longitude: lon,
      priority: priorities.angle,
    });
  }

  // Outer-ring angles (drawOuterAscMC). graphchart registers them with
  // chart_role='outer', priority 30 at x2/y2 (graphchart.py:1843/1866-1877):
  // outer Asc/MC use rOuterASCMC; outer Dsc/IC extend to rOuterArrow.
  if (comparisonChart && ringPresentation.showComparisonAxes) {
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
        const labelSize = layoutGlyphSize(
          layoutKey,
          typography.outerSize,
          typography.outerAngleLabelSize,
          typography.syzygyScale,
        );
        const labelPaint = semanticTypographyPaint(style, "angles.outer.label", {
          font: fontUi,
          size: labelSize,
          weight: style.typography.ratios.angleLabelWeight,
          color: style.elementColors.angleLabel,
        });
        const [labelWidth, labelHeight] = measurer.textsize(
          label,
          typographyTextOpts(labelPaint),
        );
        const pad = Math.max(
          hit.angleLabelPadMin,
          typography.outerLayoutUnit * hit.angleLabelPadScale,
        );
        regions.push({
          kind: "angle",
          angleId,
          x,
          y,
          r: Math.max(hitRadius, labelPaint.size / 2),
          left: x - labelWidth / 2 - pad,
          top: y - labelHeight / 2 - pad,
          width: labelWidth + pad * 2,
          height: labelHeight + pad * 2,
          longitude: lon,
          chartRole: "outer",
          priority: priorities.angloAngle,
        });
        continue;
      }
      const radius =
        angleId === "dsc" || angleId === "ic"
          ? (ringset.rOuterArrow ?? ringset.rOuterASCMC ?? ringset.rBase)
          : (ringset.rOuterASCMC ?? ringset.rBase);
      const [x1, y1] = polar(center, ringset.rOuterMin ?? ringset.rBase, lon, asc);
      const [x, y] = polar(center, radius, lon, asc);
      regions.push({
        kind: "angle",
        angleId,
        x,
        y,
        r: hitRadius,
        shape: "line",
        x1,
        y1,
        x2: x,
        y2: y,
        tolerance: angleLineTolerance,
        longitude: lon,
        chartRole: "outer",
        priority: priorities.angle,
      });
    }
  }

  if (chart.options.showHouses) {
    const houseHitRadius = Math.max(
      hit.houseRadiusMin,
      maxRadius / hit.houseRadiusDivisor,
    );
    for (let i = 0; i < 12; i += 1) {
      const cusp = chart.houses.cusps[i];
      const nextCusp = chart.houses.cusps[(i + 1) % 12];
      if (!Number.isFinite(cusp) || !Number.isFinite(nextCusp)) continue;
      const width = ((nextCusp - cusp + 360) % 360) || 30;
      const lon = normalize(cusp + width / 2);
      const [x, y] = polar(center, ringset.rHouseName, lon, asc);
      regions.push({
        kind: "house",
        houseIndex: i + 1,
        x,
        y,
        r: houseHitRadius,
        longitude: cusp,
        priority: priorities.house,
      });
    }
  }

  // Sign band = the full 30-deg sector (graphchart._sign_hover_radii +
  // _register_sector_hover_region, graphchart.py:1150-1152/1777-1788), NOT a
  // small glyph disc. Keep this hit tolerance on the stable layout unit so
  // changing body-glyph size cannot silently resize zodiac selection bands.
  // about rSign. Visible glyph metrics follow the selected wheel profile.
  {
    const signPad = Math.max(
      hit.signPadMin,
      Math.round(typography.layoutUnit * hit.signPadScale),
    );
    const halfBand = Math.max(
      signSize * hit.signHalfBandSignScale,
      typography.layoutUnit * hit.signHalfBandBodyScale,
      signPad * hit.signHalfBandPadScale,
    );
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
        priority: priorities.sign,
      });
    }
  }

  if (opts.includeStyleTargets) {
    // Exact style-editor primitives for subdivision lines and ruler glyphs.
    // They share production longitudes, radii, fonts, and measured bounds, but
    // remain excluded from astrology hover/click routing via `styleOnly`.
    const subdivisionTolerance = Math.max(4, maxRadius * 0.008);
    const pushSubdivisionBoundary = (
    family: "term" | "decan",
    itemId: string,
    longitude: number,
    innerRadius: number,
    outerRadius: number,
  ) => {
    const start = polar(center, innerRadius, longitude, asc);
    const end = polar(center, outerRadius, longitude, asc);
    regions.push({
      kind: "subdivision",
      family,
      component: "boundary",
      itemId,
      x: (start[0] + end[0]) / 2,
      y: (start[1] + end[1]) / 2,
      r: subdivisionTolerance,
      x1: start[0],
      y1: start[1],
      x2: end[0],
      y2: end[1],
      tolerance: subdivisionTolerance,
      priority: priorities.sign + 4,
      styleOnly: true,
    });
    };
    const pushSubdivisionGlyph = (
    family: "term" | "decan",
    itemId: string,
    longitude: number,
    radius: number,
    glyph: string,
  ) => {
    const classId = family === "term"
      ? "subdivisions.term.glyph"
      : "subdivisions.decan.glyph";
    const paint = semanticTypographyPaint(style, classId, {
      font: family === "term" ? fontTermSymbols : fontDecanSymbols,
      size: family === "term" ? typography.termSize : typography.decanSize,
      color:
        family === "term"
          ? style.elementColors.termGlyph
          : style.elementColors.decanGlyph,
    });
    const point = polar(center, radius, longitude, asc);
    const [width, height] = measurer.textsize(glyph, {
      ...typographyTextOpts(paint),
    });
    const pad = Math.max(2, paint.size * 0.12);
    regions.push({
      kind: "subdivision",
      family,
      component: "glyph",
      itemId,
      glyph,
      x: point[0],
      y: point[1],
      r: Math.max(width, height, paint.size) / 2 + pad,
      left: point[0] - paint.size / 2 - pad,
      top: point[1] - paint.size / 2 - pad,
      width: Math.max(1, width) + pad * 2,
      height: Math.max(1, height) + pad * 2,
      priority: priorities.sign + 5,
      styleOnly: true,
    });
    };
    if (chart.options.showTerms && chart.options.terms?.length) {
      chart.options.terms.forEach((segments, signIndex) => {
        segments.forEach((segment, segmentIndex) => {
          const itemId = `${signIndex}.${segmentIndex}`;
          const boundary = segment.boundaryLon ?? signIndex * 30 + segment.size;
          const ruler = segment.rulerLon ?? signIndex * 30 + segment.size / 2;
          pushSubdivisionBoundary("term", itemId, boundary, ringset.rTerms, ringset.rDecans);
          pushSubdivisionGlyph(
            "term",
            itemId,
            ruler,
            ringset.rTermsPlanet,
            segment.rulerGlyph ?? "",
          );
        });
      });
    }
    if (chart.options.showDecans) {
      for (let longitude = 0; longitude < 360; longitude += 10) {
        pushSubdivisionBoundary(
          "decan",
          String(longitude),
          longitude,
          ringset.rCuspOuter ?? ringset.rInner,
          ringset.rDecans,
        );
      }
      for (const [signIndex, signDecan] of (chart.options.decans ?? []).entries()) {
        for (const [rulerIndex, ruler] of (signDecan.rulers ?? []).entries()) {
          pushSubdivisionGlyph(
            "decan",
            `${signIndex}.${rulerIndex}`,
            ruler.rulerLon,
            ringset.rDecansPlanet,
            ruler.rulerGlyph,
          );
        }
      }
    }
  }

  // Empty inner band → "hide all aspects" toggle. This uses the wheel's
  // existing aspect/planet radii in every theme, including compact, so enabling
  // the interaction never changes the wheel geometry.
  const pad = Math.max(
    hit.signPadMin,
    Math.round(typography.layoutUnit * hit.signPadScale),
  );
  const rInnerBand = Math.max(0, ringset.rAsp - pad * hit.midbandPadScale);
  const rOuterBand = Math.max(
    rInnerBand,
    ringset.rInner + pad * hit.midbandPadScale,
  );
  regions.push({
    kind: "midband_empty",
    x: center[0],
    y: center[1],
    r: rOuterBand,
    rInner: rInnerBand,
    rOuter: rOuterBand,
    priority: priorities.midband,
  });

  // Aspect glyphs + lines (dynamic layer). The renderer already projects the
  // two endpoints; we reuse the same geometry. Glyph target at the midpoint
  // (priority 32, graphchart.py:851); line target uses true point-to-segment
  // proximity over the whole stroke (priority 18, graphchart.py:1126-1137).
  if (chart.options.showAspects !== false && !hasComparison) {
    const planetMap = planetById(chart);
    const aspectHitRadius = Math.max(
      hit.aspectRadiusMin,
      maxRadius / hit.aspectRadiusDivisor,
    );
    const aspectPad = Math.max(
      hit.signPadMin,
      Math.round(typography.layoutUnit * hit.signPadScale),
    );
    // graphchart._draw_aspect_line tolerance: max(4, hover_pad*0.8).
    const lineTolerance = Math.max(
      hit.aspectLineToleranceMin,
      aspectPad * hit.aspectLineTolerancePadScale,
    );
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
      }, style);
    }
  }

  if (!hasComparison && chart.drishti?.length) {
    const planets = planetById(chart);
    const aspectPad = Math.max(
      hit.signPadMin,
      Math.round(typography.layoutUnit * hit.signPadScale),
    );
    const lineTolerance = Math.max(
      hit.aspectLineToleranceMin,
      aspectPad * hit.aspectLineTolerancePadScale,
    );
    for (const relation of chart.drishti) {
      const endpoints = drishtiEndpoints(chart, relation, planets, center, ringset, asc);
      if (!endpoints) continue;
      regions.push({
        kind: "drishti",
        relationId: relation.id,
        method: relation.method,
        shape: "line",
        x: (endpoints.start[0] + endpoints.end[0]) / 2,
        y: (endpoints.start[1] + endpoints.end[1]) / 2,
        r: 0,
        x1: endpoints.start[0],
        y1: endpoints.start[1],
        x2: endpoints.end[0],
        y2: endpoints.end[1],
        tolerance: lineTolerance,
        priority: style.hit.priorities.aspectLine,
      });
    }
  }

  // Inter-chart aspect hover parity. wx registers hover data for both
  // drawInterChartAspectLines and drawInterChartAspectSymbols, carrying inner
  // and outer body identities into chartinspector.build_flag_payload.
  if (chart.options.showAspects !== false && comparisonChart && showInterChartAspectFigure) {
    const primaryPlanets = planetById(chart);
    const comparisonPlanets = planetById(comparisonChart);
    const aspectHitRadius = Math.max(
      hit.aspectRadiusMin,
      maxRadius / hit.aspectRadiusDivisor,
    );
    const aspectPad = Math.max(
      hit.signPadMin,
      Math.round(typography.layoutUnit * hit.signPadScale),
    );
    const lineTolerance = Math.max(
      hit.aspectLineToleranceMin,
      aspectPad * hit.aspectLineTolerancePadScale,
    );
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
        }, style);
      }
    }
    for (const aspect of outerPointAspects === undefined ? interChartAspectsForHits : []) {
      const p1 = aspectEndpoint(
        chart, primaryPlanets, center, ringset, asc, aspect.inner,
        ringPresentation.primaryBodies.track,
      );
      const p2 = aspectEndpoint(
        comparisonChart, comparisonPlanets, center, ringset, asc, aspect.outer,
        ringPresentation.comparisonBodies.track,
      );
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
      }, style);
    }
  }

  if (opts.includeStyleTargets) {
    const styleLineTolerance = Math.max(4, maxRadius * 0.008);
    if (chart.options.showHouses) {
      const lineRecorder = { line: () => undefined } as unknown as CanvasDraw;
      const cuspSegmentCounters = new Map<number, number>();
      drawHouses(
        lineRecorder,
        center,
        ringset,
        asc,
        chart,
        palette,
        style,
        frameworkRoutedBodyLayout,
        (houseIndex, points) => {
          let segmentOrdinal = cuspSegmentCounters.get(houseIndex) ?? 0;
          for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
            pushStyleLineTarget(
              regions,
              "houses.inner.cusp",
              `house:${houseIndex}:cusp:${segmentOrdinal}`,
              points[segmentIndex - 1],
              points[segmentIndex],
              styleLineTolerance,
              `house:${houseIndex}:cusp`,
            );
            segmentOrdinal += 1;
          }
          cuspSegmentCounters.set(houseIndex, segmentOrdinal);
        },
      );
    }

    const pushAngleRayTarget = (
      classId: "angles.inner.ray" | "angles.outer.ray",
      itemId: string,
      start: Pt,
      end: Pt,
    ) => pushStyleLineTarget(
      regions,
      classId,
      itemId,
      start,
      end,
      styleLineTolerance,
    );
    const innerAngleEntries = [
      ["asc", chart.angles.asc],
      ["dsc", chart.angles.dsc],
      ["mc", chart.angles.mc],
      ["ic", chart.angles.ic],
    ] as const;
    for (const [angleId, longitude] of innerAngleEntries) {
      pushAngleRayTarget(
        "angles.inner.ray",
        `angle:${angleId}:ray`,
        polar(center, ringset.rBase, longitude, asc),
        polar(
          center,
          isAngloWheel(chart) ? ringset.rInner : ringset.rASCMC,
          longitude,
          asc,
        ),
      );
    }
    if (comparisonChart && ringPresentation.showComparisonAxes) {
      if (isAngloWheel(comparisonChart)) {
        const outerAngloEntries = [
          ["asc", "__asc", comparisonChart.angles.asc],
          ["mc", "__mc", comparisonChart.angles.mc],
        ] as const;
        for (const [angleId, layoutKey, longitude] of outerAngloEntries) {
          if (!outerBodyShiftsForHits?.has(layoutKey)) continue;
          pushAngleRayTarget(
            "angles.outer.ray",
            `outer-angle:${angleId}:ray`,
            polar(center, ringset.r30, longitude, asc),
            polar(center, ringset.rOuterLine, longitude, asc),
          );
        }
      } else if (
        ringset.rOuterASCMC
        && ringset.rOuterMin
        && ringset.rOuterArrow
      ) {
        const outerEntries = [
          ["asc", comparisonChart.angles.asc, ringset.rOuterASCMC],
          ["dsc", comparisonChart.angles.dsc, ringset.rOuterArrow],
          ["mc", comparisonChart.angles.mc, ringset.rOuterASCMC],
          ["ic", comparisonChart.angles.ic, ringset.rOuterArrow],
        ] as const;
        for (const [angleId, longitude, outerRadius] of outerEntries) {
          pushAngleRayTarget(
            "angles.outer.ray",
            `outer-angle:${angleId}:ray`,
            polar(center, ringset.rOuterMin, longitude, asc),
            polar(center, outerRadius, longitude, asc),
          );
        }
      }
    }

    const pushOpenArrowTargets = (
      classId: "angles.inner.arrowhead" | "angles.outer.arrowhead",
      itemPrefix: string,
      longitude: number,
      baseRadius: number,
      apexRadius: number,
    ) => {
      const left = polar(
        center,
        baseRadius,
        longitude - style.strokes.arrows.halfAngleDegrees,
        asc,
      );
      const right = polar(
        center,
        baseRadius,
        longitude + style.strokes.arrows.halfAngleDegrees,
        asc,
      );
      const apex = polar(center, apexRadius, longitude, asc);
      [[left, right], [right, apex], [apex, left]].forEach(
        ([start, end], segmentIndex) => pushStyleLineTarget(
          regions,
          classId,
          `${itemPrefix}:${segmentIndex}`,
          start,
          end,
          styleLineTolerance,
        ),
      );
    };
    if (angleArrowheadsVisible(chart)) {
      if (isAngloWheel(chart)) {
        const baseRadius =
          ringset.rInner
          - ringset.r30 * style.strokes.arrows.angloBaseInsetScale;
        const pushFilledArrow = (
          angleId: "asc" | "mc",
          key: AngleLayoutKey,
          longitude: number,
        ) => {
          if (!angleSharesHouseCusp(chart, key)) return;
          const vertices = [
            polar(center, ringset.rInner, longitude, asc),
            polar(
              center,
              baseRadius,
              longitude - style.strokes.arrows.angloHalfAngleDegrees,
              asc,
            ),
            polar(
              center,
              baseRadius,
              longitude + style.strokes.arrows.angloHalfAngleDegrees,
              asc,
            ),
          ];
          const xs = vertices.map(([x]) => x);
          const ys = vertices.map(([, y]) => y);
          pushStyleRectTarget(
            regions,
            "angles.inner.arrowhead",
            `angle:${angleId}:arrowhead`,
            {
              x: Math.min(...xs),
              y: Math.min(...ys),
              w: Math.max(...xs) - Math.min(...xs),
              h: Math.max(...ys) - Math.min(...ys),
            },
          );
        };
        pushFilledArrow("asc", "__asc", chart.angles.asc);
        pushFilledArrow("mc", "__mc", chart.angles.mc);
      } else {
        pushOpenArrowTargets(
          "angles.inner.arrowhead",
          "angle:asc:arrowhead",
          chart.angles.asc,
          ringset.rASCMC,
          ringset.rArrow,
        );
        pushOpenArrowTargets(
          "angles.inner.arrowhead",
          "angle:mc:arrowhead",
          chart.angles.mc,
          ringset.rASCMC,
          ringset.rArrow,
        );
      }
      if (
        comparisonChart
        && ringPresentation.showComparisonAxes
        && !isAngloWheel(comparisonChart)
        && ringset.rOuterASCMC
        && ringset.rOuterArrow
      ) {
        pushOpenArrowTargets(
          "angles.outer.arrowhead",
          "outer-angle:asc:arrowhead",
          comparisonChart.angles.asc,
          ringset.rOuterASCMC,
          ringset.rOuterArrow,
        );
        pushOpenArrowTargets(
          "angles.outer.arrowhead",
          "outer-angle:mc:arrowhead",
          comparisonChart.angles.mc,
          ringset.rOuterASCMC,
          ringset.rOuterArrow,
        );
      }
    }

    const overlayMetrics = resolveWheelOverlayMetrics(
      style.overlays,
      { width, height },
    );
    const overlayPaint = (
      classId: WheelChartOverlayClass,
      defaults: Readonly<{
        font: string;
        size: number;
        color: string;
      }>,
    ) => semanticTypographyPaint(style, classId, defaults);
    const overlayTargetMetadata = (
      paint: ResolvedWheelTypographyPaint,
      bodyId?: string,
    ) => ({
      ...(bodyId ? { bodyId } : {}),
      colorValue: paint.color,
      compactOverlay: overlayMetrics.compact,
    });
    const displayChart =
      snapshot.document?.compoundKind === "synastry" && comparisonChart
        ? chart
        : comparisonChart ?? chart;
    const primaryCornerLines = chart.meta.cornerLines;
    const cornerChart =
      primaryCornerLines?.topLeft?.length
      || primaryCornerLines?.bottomLeft?.length
        ? chart
        : displayChart;
    const addCornerTargets = (
      classId:
        | "chartOverlay.information.topLeft"
        | "chartOverlay.information.bottomLeft"
        | "chartOverlay.houseSystem.bottomRight",
      lines: readonly string[],
      horizontal: "left" | "right",
      vertical: "top" | "bottom",
    ) => {
      if (!lines.length || overlayMetrics.infoFontSize <= 0) return;
      const paint = overlayPaint(classId, {
        font: fontUi,
        size: overlayMetrics.infoFontSize,
        color: palette.textDim,
      });
      const lineHeight = paint.size * style.overlays.cornerLineHeight;
      const groupHeight =
        lines.length * lineHeight
        + Math.max(0, lines.length - 1) * style.overlays.infoGap;
      const top = vertical === "top"
        ? overlayMetrics.topEdgeInset
        : height - overlayMetrics.edgeInset - groupHeight;
      lines.forEach((line, index) => {
        const [lineWidth] = measurer.textsize(
          line,
          typographyTextOpts(paint),
        );
        const left = horizontal === "left"
          ? overlayMetrics.edgeInset
          : width - overlayMetrics.edgeInset - lineWidth;
        pushStyleTextTarget(
          regions,
          classId,
          `chart-overlay:${classId}:${index}`,
          {
            x: left,
            y:
              top
              + index * (lineHeight + style.overlays.infoGap),
            w: lineWidth,
            h: lineHeight,
          },
          overlayTargetMetadata(paint),
        );
      });
    };
    if (cornerChart.options.showInformation) {
      addCornerTargets(
        "chartOverlay.information.topLeft",
        cornerChart.meta.cornerLines?.topLeft
          ?? [cornerChart.meta.dateDisplay, cornerChart.meta.timeDisplay],
        "left",
        "top",
      );
      addCornerTargets(
        "chartOverlay.information.bottomLeft",
        cornerChart.meta.cornerLines?.bottomLeft
          ?? [cornerChart.meta.place, cornerChart.meta.placeCoords],
        "left",
        "bottom",
      );
    }
    if (displayChart.options.showHouseSystem) {
      addCornerTargets(
        "chartOverlay.houseSystem.bottomRight",
        displayChart.meta.houseSystemLines ?? [],
        "right",
        "bottom",
      );
    }

    const eventRows = displayChart.overlay?.rows ?? [];
    const groupedEventRows = {
      dayhour: eventRows.filter((row) => row.group === "dayhour"),
      header: eventRows.filter((row) => row.group === "header"),
      signal: eventRows.filter((row) => row.group === "signal"),
    };
    type OverlayLayoutRow =
      | { readonly row: OverlayInfoRow; readonly rowIndex: number }
      | { readonly spacer: number };
    const overlayLayoutRows: OverlayLayoutRow[] = [];
    let sourceRowIndex = 0;
    const appendOverlayRows = (rows: readonly OverlayInfoRow[]) => {
      for (const row of rows) {
        overlayLayoutRows.push({ row, rowIndex: sourceRowIndex });
        sourceRowIndex += 1;
      }
    };
    appendOverlayRows(groupedEventRows.dayhour);
    if (
      groupedEventRows.dayhour.length
      && groupedEventRows.header.length
    ) {
      overlayLayoutRows.push({ spacer: overlayMetrics.gapAfterDayHour });
    }
    appendOverlayRows(groupedEventRows.header);
    if (
      (groupedEventRows.dayhour.length || groupedEventRows.header.length)
      && groupedEventRows.signal.length
    ) {
      overlayLayoutRows.push({ spacer: overlayMetrics.gapBetweenGroups });
    }
    appendOverlayRows(groupedEventRows.signal);
    const overlayGroupName = (
      group: OverlayInfoRow["group"],
    ): "dayHour" | "header" | "signal" =>
      group === "dayhour" ? "dayHour" : group === "header" ? "header" : "signal";
    const overlayClassId = (
      row: OverlayInfoRow,
      component: "label" | "glyph" | "trailing",
    ): WheelChartOverlayClass =>
      `chartOverlay.events.${overlayGroupName(row.group)}.${component}`;
    const overlayBodies = new Map<number, string>();
    for (const body of [
      ...chart.planets,
      ...(comparisonChart?.planets ?? []),
    ]) {
      if (!overlayBodies.has(body.seId)) {
        overlayBodies.set(body.seId, String(body.id));
      }
    }
    const eventLayouts = overlayLayoutRows.map((layoutRow) => {
      if ("spacer" in layoutRow) return layoutRow;
      const { row } = layoutRow;
      const firstGlyph = row.glyphs[0] ?? null;
      const secondGlyph =
        row.group === "header" ? row.glyphs[1] ?? null : null;
      const trailingText =
        row.group === "header" ? "" : row.trailing ?? "";
      const labelClass = overlayClassId(row, "label");
      const glyphClass = overlayClassId(row, "glyph");
      const trailingClass = overlayClassId(row, "trailing");
      const labelPaint = overlayPaint(labelClass, {
        font: fontUi,
        size: overlayMetrics.labelSize,
        color: palette.textDim,
      });
      const glyphDefaultColor = firstGlyph
        ? firstGlyph.color
          ?? (
            firstGlyph.kind === "planet" && firstGlyph.seId != null
              ? palette.planets[firstGlyph.seId] ?? palette.textDim
              : palette.textDim
          )
        : palette.textDim;
      const glyphPaint = overlayPaint(glyphClass, {
        font: fontSymbols,
        size: overlayMetrics.iconSize,
        color: glyphDefaultColor,
      });
      const trailingDefaultColor = secondGlyph
        ? secondGlyph.color
          ?? (
            secondGlyph.kind === "planet" && secondGlyph.seId != null
              ? palette.planets[secondGlyph.seId] ?? palette.textDim
              : palette.textDim
          )
        : palette.textDim;
      const trailingPaint = overlayPaint(trailingClass, {
        font: secondGlyph ? fontSymbols : fontUi,
        size: secondGlyph
          ? overlayMetrics.iconSize
          : overlayMetrics.labelSize,
        color: trailingDefaultColor,
      });
      const [labelWidth] = measurer.textsize(
        row.label,
        typographyTextOpts(labelPaint),
      );
      const [glyphWidth] = firstGlyph
        ? measurer.textsize(
            firstGlyph.char,
            typographyTextOpts(glyphPaint),
          )
        : [0, 0];
      const trailingContent = secondGlyph?.char ?? trailingText;
      const [trailingWidth] = trailingContent
        ? measurer.textsize(
            trailingContent,
            typographyTextOpts(trailingPaint),
          )
        : [0, 0];
      return {
        ...layoutRow,
        firstGlyph,
        secondGlyph,
        trailingText,
        labelClass,
        glyphClass,
        trailingClass,
        labelPaint,
        glyphPaint,
        trailingPaint,
        labelWidth,
        glyphWidth,
        trailingWidth,
      };
    });
    const paintedEventLayouts = eventLayouts.filter(
      (layout): layout is Exclude<typeof layout, { readonly spacer: number }> =>
        !("spacer" in layout),
    );
    if (paintedEventLayouts.length) {
      const labelColumn = Math.max(
        ...paintedEventLayouts.map((layout) => layout.labelWidth),
      );
      const glyphColumn = Math.max(
        ...paintedEventLayouts.map((layout) => layout.glyphWidth),
      );
      const trailingColumn = Math.max(
        ...paintedEventLayouts.map((layout) => layout.trailingWidth),
      );
      const gridWidth =
        labelColumn
        + glyphColumn
        + trailingColumn
        + overlayMetrics.columnGap * 2;
      const gridLeft =
        width - overlayMetrics.edgeInset - gridWidth;
      let rowTop = overlayMetrics.topEdgeInset;
      for (const layout of eventLayouts) {
        if ("spacer" in layout) {
          rowTop += layout.spacer;
          continue;
        }
        const ownerId = `chart-overlay:event:${layout.row.group ?? "signal"}:${layout.rowIndex}`;
        if (layout.row.label) {
          pushStyleTextTarget(
            regions,
            layout.labelClass,
            `${ownerId}:label`,
            {
              x: gridLeft,
              y: rowTop,
              w: layout.labelWidth,
              h: overlayMetrics.lineHeight,
            },
            {
              ownerId,
              ...overlayTargetMetadata(layout.labelPaint),
            },
          );
        }
        if (layout.firstGlyph) {
          const bodyId =
            layout.firstGlyph.kind === "planet"
            && layout.firstGlyph.seId != null
              ? overlayBodies.get(layout.firstGlyph.seId)
              : undefined;
          pushStyleTextTarget(
            regions,
            layout.glyphClass,
            `${ownerId}:glyph`,
            {
              x:
                gridLeft
                + labelColumn
                + overlayMetrics.columnGap,
              y: rowTop,
              w: layout.glyphWidth,
              h: overlayMetrics.lineHeight,
            },
            {
              ownerId,
              ...overlayTargetMetadata(layout.glyphPaint, bodyId),
            },
          );
        }
        const trailingContent =
          layout.secondGlyph?.char ?? layout.trailingText;
        if (trailingContent) {
          const bodyId =
            layout.secondGlyph?.kind === "planet"
            && layout.secondGlyph.seId != null
              ? overlayBodies.get(layout.secondGlyph.seId)
              : undefined;
          pushStyleTextTarget(
            regions,
            layout.trailingClass,
            `${ownerId}:trailing`,
            {
              x:
                gridLeft
                + labelColumn
                + overlayMetrics.columnGap
                + glyphColumn
                + overlayMetrics.columnGap,
              y: rowTop,
              w: layout.trailingWidth,
              h: overlayMetrics.lineHeight,
            },
            {
              ownerId,
              ...overlayTargetMetadata(layout.trailingPaint, bodyId),
            },
          );
        }
        rowTop += overlayMetrics.lineHeight;
      }
    }

    const addPositionComponents = (
      itemPrefix: string,
      components: readonly PositionedText[],
    ) => {
      for (const component of components) {
        const componentName = component.classId.split(".").at(-1) ?? "text";
        pushStyleTextTarget(
          regions,
          component.classId,
          `${itemPrefix}:${componentName}`,
          component,
        );
      }
    };
    const bodyPositionClasses = {
      degree: "bodies.inner.position.degree",
      sign: "bodies.inner.position.sign",
      minute: "bodies.inner.position.minute",
    } as const;
    for (const key of bodyKeys(chart)) {
      const lon = bodyLongitude(chart, planets, key);
      if (lon == null) continue;
      const shiftedLon = lon + (bodyShifts.get(key) ?? 0);
      const yoff = labelYoffs.get(key) ?? 0;
      const degMin = bodyDegMin(chart, planets, key);
      let positionBounds: PositionedText[] = [];
      if (degMin && ringPresentation.primaryBodies.track === "inner") {
        if (isAngloWheel(chart)) {
          positionBounds = layoutAngloBodyPosition(
            measurer,
            center,
            ringset,
            lon,
            shiftedLon,
            asc,
            yoff,
            degMin[0],
            degMin[1],
            chart,
            palette,
            fontUi,
            fontBodySymbols,
            typography,
            style,
          );
        } else if (isCompactWheel(chart) && ringset.rPosDeg && ringset.rPosMin) {
          positionBounds = layoutDegMinStack(
            measurer,
            center,
            ringset.rPosDeg,
            ringset.rPosMin,
            shiftedLon,
            asc,
            yoff,
            degMin[0],
            degMin[1],
            palette.positions,
            fontUi,
            typography.bodyPosition.degreeSize,
            typography.bodyPosition.minuteSize,
            bodyPositionClasses,
            style,
          );
        } else if (chart.options.showPositions) {
          const point = polar(center, ringset.rPos - yoff, shiftedLon, asc);
          positionBounds = layoutDegMinPair(
            measurer,
            point[0],
            point[1],
            degMin[0],
            degMin[1],
            palette.positions,
            fontUi,
            typography.bodyPosition.degreeSize,
            typography.bodyPosition.minuteSize,
            bodyPositionClasses,
            style,
          );
        }
        addPositionComponents(`body:${String(key)}:position`, positionBounds);
      }
      const marker =
        key === "__fortune" || key === "__vertex" || key === "__syzygy" || key === "__eclipse"
          ? ""
          : planets.get(key)?.motion ?? "";
      if (marker) {
        const glyph = bodyGlyph(chart, planets, key);
        const primaryOnOuterTrack = ringPresentation.primaryBodies.track === "outer";
        const glyphPoint = polar(center, primaryBodyRings.rPlanet, shiftedLon, asc);
        const glyphBounds = bodyGlyphPaintBounds(
          glyphPoint[0],
          glyphPoint[1],
          chart,
          key,
          glyph,
          primaryOnOuterTrack ? outerSymbolSize : symbolSize,
          primaryOnOuterTrack,
        );
        const motionClass = primaryOnOuterTrack
          ? "bodies.outer.motion" as const
          : "bodies.inner.motion" as const;
        const motionSize = primaryOnOuterTrack
          ? typography.outerMotionSize
          : typography.motionSize;
        pushStyleTextTarget(
          regions,
          motionClass,
          `body:${String(key)}:motion`,
          resolveMotionMarkerBounds(
            measurer,
            marker,
            fontUi,
            motionMarkerSize(chart, marker, motionSize, primaryOnOuterTrack),
            style,
            motionClass,
            glyphBounds,
            glyphBounds.paintSize,
          ),
        );
      }
    }

    if (comparisonChart && outerBodyShiftsForHits) {
      const comparisonPlanets = planetById(comparisonChart);
      for (const key of bodyKeys(comparisonChart)) {
        if (key === "__fortune" || key === "__vertex" || key === "__syzygy" || key === "__eclipse") continue;
        const lon = bodyLongitude(comparisonChart, comparisonPlanets, key);
        const marker = comparisonPlanets.get(key)?.motion ?? "";
        if (lon == null || !marker) continue;
        const shiftedLon = lon + (outerBodyShiftsForHits.get(key) ?? 0);
        const glyph = bodyGlyph(comparisonChart, comparisonPlanets, key);
        const comparisonOnOuterTrack =
          ringPresentation.comparisonBodies.track === "outer";
        const glyphPoint = polar(center, comparisonBodyRings.rPlanet, shiftedLon, asc);
        const comparisonGlyphSize = comparisonOnOuterTrack
          ? outerSymbolSize
          : symbolSize;
        const glyphBounds = bodyGlyphPaintBounds(
          glyphPoint[0],
          glyphPoint[1],
          comparisonChart,
          key,
          glyph,
          comparisonGlyphSize,
          comparisonOnOuterTrack,
        );
        const motionClass = comparisonOnOuterTrack
          ? "bodies.outer.motion" as const
          : "bodies.inner.motion" as const;
        const motionSize = comparisonOnOuterTrack
          ? typography.outerMotionSize
          : typography.motionSize;
        pushStyleTextTarget(
          regions,
          motionClass,
          `outer-body:${String(key)}:motion`,
          resolveMotionMarkerBounds(
            measurer,
            marker,
            fontUi,
            motionMarkerSize(
              comparisonChart,
              marker,
              motionSize,
              comparisonOnOuterTrack,
            ),
            style,
            motionClass,
            glyphBounds,
            glyphBounds.paintSize,
          ),
        );
      }
    }

    if (chart.options.showPositions || isAngloWheel(chart)) {
      const anglePositionClasses = {
        degree: "angles.inner.position.degree",
        sign: "angles.inner.position.sign",
        minute: "angles.inner.position.minute",
      } as const;
      const anglePositions = [
        ["asc", "__asc", chart.angles.asc, chart.angles.ascDegMin],
        ["mc", "__mc", chart.angles.mc, chart.angles.mcDegMin],
      ] as const;
      for (const [angleId, layoutKey, lon, degMin] of anglePositions) {
        if (!degMin) continue;
        let components: PositionedText[];
        if (isAngloWheel(chart)) {
          const hasFloatingLabel = bodyShifts.has(layoutKey);
          if (!hasFloatingLabel && chart.options.showHouses) continue;
          components = layoutAngloLongitudeRun(
            measurer,
            center,
            ringset.rPosHouses,
            lon,
            asc,
            degMin.degText,
            degMin.minText,
            chart,
            palette,
            fontUi,
            fontSignSymbols,
            typography.angloAnglePosition,
            anglePositionClasses,
            style,
          );
        } else if (isCompactWheel(chart) && ringset.rPosHousesMin) {
          components = layoutDegMinStack(
            measurer,
            center,
            ringset.rPosHouses,
            ringset.rPosHousesMin,
            lon,
            asc,
            0,
            degMin.degText,
            degMin.minText,
            palette.positions,
            fontUi,
            typography.anglePosition.degreeSize,
            typography.anglePosition.minuteSize,
            anglePositionClasses,
            style,
          );
        } else {
          const point = polar(center, ringset.rPosAscMC, lon, asc);
          components = layoutDegMinPair(
            measurer,
            point[0],
            point[1],
            degMin.degText,
            degMin.minText,
            palette.positions,
            fontUi,
            typography.anglePosition.degreeSize,
            typography.anglePosition.minuteSize,
            anglePositionClasses,
            style,
          );
        }
        addPositionComponents(`angle:${angleId}:position`, components);
      }

      if (chart.options.showHouses) {
        const housePositionClasses = {
          degree: "houses.inner.position.degree",
          sign: "houses.inner.position.sign",
          minute: "houses.inner.position.minute",
        } as const;
        const skipAsc = sameLongitude(chart.houses.cusps[0], chart.angles.asc);
        const skipMc = sameLongitude(chart.houses.cusps[9], chart.angles.mc);
        const houseIndices = isAngloWheel(chart)
          ? Array.from({ length: 12 }, (_, index) => index)
          : [0, 1, 2, 9, 10, 11];
        for (const houseIndex of houseIndices) {
          if (
            !isAngloWheel(chart)
            && ((skipAsc && houseIndex === 0) || (skipMc && houseIndex === 9))
          ) {
            continue;
          }
          const lon = chart.houses.cusps[houseIndex];
          const degMin = chart.houses.cuspDegMin?.[houseIndex];
          if (!degMin) continue;
          let components: PositionedText[];
          if (isAngloWheel(chart)) {
            components = layoutAngloLongitudeRun(
              measurer,
              center,
              ringset.rPosHouses,
              lon,
              asc,
              degMin.degText,
              degMin.minText,
              chart,
              palette,
              fontUi,
              fontSignSymbols,
              typography.angloHousePosition,
              housePositionClasses,
              style,
            );
          } else if (isCompactWheel(chart) && ringset.rPosHousesMin) {
            components = layoutDegMinStack(
              measurer,
              center,
              ringset.rPosHouses,
              ringset.rPosHousesMin,
              lon,
              asc,
              0,
              degMin.degText,
              degMin.minText,
              palette.positions,
              fontUi,
              typography.housePosition.degreeSize,
              typography.housePosition.minuteSize,
              housePositionClasses,
              style,
            );
          } else {
            const point = polar(center, ringset.rPosHouses, lon, asc);
            components = layoutDegMinPair(
              measurer,
              point[0],
              point[1],
              degMin.degText,
              degMin.minText,
              palette.positions,
              fontUi,
              typography.housePosition.degreeSize,
              typography.housePosition.minuteSize,
              housePositionClasses,
              style,
            );
          }
          addPositionComponents(`house:${houseIndex + 1}:position`, components);
        }
      }
    }

    if (chart.options.showHouses && comparisonChart && showOuterHouseCusps) {
      const lineTolerance = Math.max(4, maxRadius * 0.008);
      const outerCuspRadius = restrainedAngloComparison
        ? ringset.rOuterHouse
        : ringset.rOuterHouseName ?? ringset.rOuterASCMC ?? ringset.rOuterArrow;
      if (outerCuspRadius) {
        comparisonChart.houses.cusps.forEach((cusp, index) => {
          pushStyleLineTarget(
            regions,
            "houses.outer.cusp",
            `outer-house:${index + 1}:cusp`,
            polar(center, ringset.r30, cusp, asc),
            polar(center, outerCuspRadius, cusp, asc),
            lineTolerance,
          );
        });
      }
      const outerHouseNameRadius =
        ringset.rOuterHouseName ?? ringset.rOuterArrow ?? ringset.rOuterASCMC;
      if (
        outerHouseNameRadius
        && (showOuterHouseBand || restrainedAngloComparison)
      ) {
        for (let index = 0; index < 12; index += 1) {
          pushStyleTextTarget(
            regions,
            "houses.outer.label",
            `outer-house:${index + 1}:label`,
            layoutHouseName(
              measurer,
              center,
              outerHouseNameRadius,
              asc,
              comparisonChart,
              index,
              fontUi,
              typography.outerHouseLabelSize,
              typography.outerLayoutUnit,
              style,
              "houses.outer.label",
            ),
          );
        }
      }
    }

    for (const mark of chart.surveilMarks ?? []) {
      const layout = layoutSurveilMark(
        measurer,
        center,
        ringset,
        asc,
        mark,
        palette,
        fontUi,
        fontSymbols,
        typography.outerLayoutUnit,
        style,
      );
      if (!layout) continue;
      pushStyleLineTarget(
        regions,
        "surveil.tick",
        `surveil:${mark.id}:tick`,
        layout.tickStart,
        layout.tickEnd,
        Math.max(4, maxRadius * 0.008),
      );
      pushStyleTextTarget(
        regions,
        layout.marker.classId,
        `surveil:${mark.id}:marker`,
        layout.marker,
      );
      if (layout.source) {
        pushStyleTextTarget(
          regions,
          "surveil.sourceLabel",
          `surveil:${mark.id}:source`,
          layout.source,
        );
      }
    }
  }

  // Outer-ring items (secondary_ring): every active item the chart draws,
  // projected to the outer-label radius band (graphchart.py:3879-4710,
  // priority 46). family + id + longitude + label drive the daemon objectId.
  const activeOuterItems = visibleOuterItems(snapshot);
  if (activeOuterItems.length > 0) {
    const outerHitRadius = Math.max(
      style.hit.outerRadiusMin,
      typography.outerLayoutUnit * style.hit.outerRadiusScale,
    );
    const outerItemsChart = comparisonChart ?? chart;
    const labelRadius =
      ringset.rOuterLine +
      typography.outerLayoutUnit * style.labels.outerRadiusOffsetScale;
    const outerItemLayout = prepareOuterRingItems(
      measurer,
      center,
      ringset.rOuterLine,
      asc,
      activeOuterItems,
      labelRadius,
      outerGlyphCenterRadius(ringset, typography.outerLayoutUnit, style),
      fontUi,
      fontSymbols,
      typography,
      outerItemsChart,
      palette,
      style,
      opts.outerLabelCollisionBounds,
    );
    for (let i = 0; i < outerItemLayout.items.length; i += 1) {
      const item = outerItemLayout.items[i];
      if (!Number.isFinite(item.longitude)) continue;
      const itemLabelRadius = outerRingItemLabelRadius(
        item,
        ringset,
        typography.outerLayoutUnit,
        style,
      );
      const itemFontSize = outerRingItemFontSize(item, typography);
      const glyphLane = isOuterGlyphFamily(item.family);
      let runs = buildOuterItemLabel(
        item,
        outerItemsChart,
        palette,
        typography,
        fontUi,
        fontSymbols,
        style,
      );
      let [textWidth, textHeight] = labelRunsBounds(
        measurer,
        runs,
        fontUi,
      );
      const shiftedLon = item.longitude + outerItemLayout.shifts[i];
      const pt = polar(center, itemLabelRadius, shiftedLon, asc);
      const rad = Math.PI + ((asc - shiftedLon) * Math.PI) / 180;
      let x = pt[0];
      let y = pt[1] + outerItemLayout.yOffsets[i];
      const pos = normalize((rad * 180) / Math.PI);
      if (glyphLane) {
        x -= textWidth / 2;
      } else if (pos > 90 && pos < 270) {
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
          typography.outerLayoutUnit,
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
      if (!glyphLane) {
        [x, y] = ensureTextOutsideOuterWheel(
          center,
          ringset.rOuterLine,
          rad,
          x,
          y,
          textWidth,
          textHeight,
          itemLabelRadius,
          Math.round(
            typography.outerLayoutUnit * style.labels.outerOutsidePadScale,
          ),
        );
      }
      const pad = Math.max(
        hit.outerLabelPadMin,
        Math.round(itemFontSize * hit.outerLabelPadScale),
      );
      const left = x - pad;
      const top = y - textHeight / 2 - pad;
      const boxWidth = textWidth + pad * 2;
      const boxHeight = textHeight + pad * 2;
      const ownerId = `secondary:${item.family}:${item.id}`;
      const leaderStart = polar(
        center,
        ringset.r30,
        item.longitude,
        asc,
      );
      const leaderEnd = polar(
        center,
        glyphLane
          ? outerGlyphLane(ringset, itemFontSize, typography, style).leaderRadius
          : ringset.rOuterLine,
        shiftedLon,
        asc,
      );
      if (opts.includeStyleTargets) {
        let runCursor = x;
        const runY = y - textHeight / 2;
        runs.forEach((run, runIndex) => {
          const [runWidth, runHeight] = measurer.textsize(run.text, {
            font: run.fontFamily,
            size: run.size,
            weight: run.weight,
            style: run.style,
            tracking: run.tracking,
          });
          if (run.classId) {
            pushStyleTextTarget(
              regions,
              run.classId,
              `${ownerId}:run:${runIndex}`,
              {
                x: runCursor,
                y: runY + (textHeight - runHeight) / 2,
                w: runWidth,
                h: runHeight,
              },
              { ownerId },
            );
          }
          runCursor += runWidth;
        });
        const secondaryClasses = resolveWheelSecondaryRingClassIds(item.family);
        if (secondaryClasses) {
          pushStyleLineTarget(
            regions,
            secondaryClasses.leader,
            `${ownerId}:leader`,
            leaderStart,
            leaderEnd,
            Math.max(4, maxRadius * 0.008),
            ownerId,
          );
        }
        if (
          item.motion
          && secondaryClasses?.motion
          && OUTER_BODY_GLYPH_FAMILIES.has(item.family)
        ) {
          const motionSize = motionMarkerSize(
            chart,
            item.motion,
            typography.secondaryRing[secondaryClasses.motion]
              ?? typography.outerMotionSize,
            true,
          );
          const markerRadius =
            ringset.rOuterRetr
            ?? ringset.rOuterLine
              + typography.outerLayoutUnit
              * style.labels.outerMotionRadiusScale;
          const markerPoint = polar(center, markerRadius, shiftedLon, asc);
          const markerOffset =
            typography.outerLayoutUnit * style.labels.outerMotionOffsetScale;
          const motionPaint = {
            ...semanticTypographyPaint(
              style,
              secondaryClasses.motion,
              {
                font: fontUi,
                size: motionSize,
                color: runs[0]?.color ?? palette.textDim,
              },
            ),
            size: motionSize,
          };
          const [motionWidth, motionHeight] = measurer.textsize(
            item.motion,
            typographyTextOpts(motionPaint),
          );
          pushStyleTextTarget(
            regions,
            secondaryClasses.motion,
            `${ownerId}:motion`,
            {
              x: markerPoint[0] - markerOffset,
              y: markerPoint[1] - markerOffset,
              w: motionWidth,
              h: motionHeight,
            },
            { ownerId },
          );
        }
      }
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
        leader: { start: leaderStart, end: leaderEnd },
        priority: priorities.secondaryRing,
      });
    }
  } else if (
    hasOuterRing
    && opts.includeStyleTargets
    && (chart.fixedStars?.length ?? 0) > 0
  ) {
    const fixedStarLayout = getFixedStarLayout(
      measurer,
      chart,
      center,
      ringset,
      asc,
      fontUi,
      typography,
      style,
    );
    const fontSize =
      typography.secondaryRing["secondaryRing.fixedStar.label"]
      ?? typography.outerLabelSize;
    const labelPaint = semanticTypographyPaint(
      style,
      "secondaryRing.fixedStar.label",
      {
        font: fontUi,
        size: fontSize,
        color: palette.textDim,
      },
    );
    let labelRadius =
      ringset.rOuterLine
      + typography.outerLayoutUnit * style.labels.outerRadiusOffsetScale;
    fixedStarLayout.stars.forEach((star, index) => {
      const shiftedLon = star.longitude + fixedStarLayout.shifts[index];
      const ownerId = `secondary:fixed_stars:${star.name}`;
      const start = polar(center, ringset.r30, star.longitude, asc);
      const end = polar(center, ringset.rOuterLine, shiftedLon, asc);
      pushStyleLineTarget(
        regions,
        "secondaryRing.fixedStar.leader",
        `${ownerId}:leader`,
        start,
        end,
        Math.max(4, maxRadius * 0.008),
        ownerId,
      );
      const label = buildFixedStarLabel(star);
      const [labelWidth, labelHeight] = measurer.textsize(
        label,
        typographyTextOpts(labelPaint),
      );
      const point = polar(center, labelRadius, shiftedLon, asc);
      const rad = Math.PI + ((asc - shiftedLon) * Math.PI) / 180;
      let labelX = point[0];
      let labelY = point[1] + fixedStarLayout.yOffsets[index];
      const pos = normalize((rad * 180) / Math.PI);
      if (pos > 90 && pos < 270) labelX -= labelWidth;
      [labelX, labelY, labelRadius] = ensureTextOutsideOuterWheel(
        center,
        ringset.rOuterLine,
        rad,
        labelX,
        labelY,
        labelWidth,
        labelHeight,
        labelRadius,
        Math.round(
          typography.outerLayoutUnit * style.labels.outerOutsidePadScale,
        ),
      );
      pushStyleTextTarget(
        regions,
        "secondaryRing.fixedStar.label",
        `${ownerId}:label`,
        {
          x: labelX,
          y: labelY - labelHeight / 2,
          w: labelWidth,
          h: labelHeight,
        },
        { ownerId },
      );
    });
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
    if (
      region.styleOnly
      || (region.kind === "pd_event" && !region.interactive)
    ) continue;
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
    } else if (
      (
        region.kind === "aspect"
        || region.kind === "drishti"
        || region.kind === "angle"
        || region.kind === "pd_event"
      ) &&
      region.shape === "line"
    ) {
      // True point-to-segment proximity over the whole stroke
      // (graphchart._register_line_hover_region). Angle rays additionally keep
      // their endpoint disc so the former AC/MC arrow-tip target is unchanged.
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
      const segmentDistSq = ddx * ddx + ddy * ddy;
      if (region.kind === "angle") {
        const tipDx = mouseX - region.x;
        const tipDy = mouseY - region.y;
        const tipDistSq = tipDx * tipDx + tipDy * tipDy;
        distSq = Math.min(segmentDistSq, tipDistSq);
        inside = segmentDistSq <= tol * tol || tipDistSq <= region.r * region.r;
      } else {
        distSq = segmentDistSq;
        inside = segmentDistSq <= tol * tol;
      }
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

function chartFontKey(
  fontText?: string,
  fontSymbols?: string,
  additionalFonts: readonly string[] = [],
): string {
  const text = (fontText || DEFAULT_MORINUS_TEXT_FONT).replace(/\s+/g, " ").trim();
  const symbols = (fontSymbols || '"AriesMorinus"').replace(/\s+/g, " ").trim();
  const extras = [...new Set(
    additionalFonts
      .map((font) => font.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  )].sort();
  return [text, symbols, ...extras].join("\u0000");
}

export function chartFontsAreReady(
  fontText?: string,
  fontSymbols?: string,
  additionalFonts: readonly string[] = [],
): boolean {
  return loadedChartFontKeys.has(chartFontKey(fontText, fontSymbols, additionalFonts));
}

export function warmChartFonts(fontText?: string, fontSymbols?: string): void {
  void awaitFonts(fontText, fontSymbols);
}

export async function awaitFonts(
  fontText?: string,
  fontSymbols?: string,
  additionalFonts: readonly string[] = [],
): Promise<void> {
  const key = chartFontKey(fontText, fontSymbols, additionalFonts);
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
  const [textFont, symbolFont, ...roleFonts] = key.split("\u0000");
  const pending = pendingChartFontLoads.get(key);
  if (pending) {
    await pending;
    return;
  }
  const loadPromise = Promise.allSettled([
    document.fonts.load(`32px ${symbolFont || '"AriesMorinus"'}`),
    ...roleFonts.map((font) => document.fonts.load(`32px ${font}`)),
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
