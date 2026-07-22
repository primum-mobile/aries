/**
 * Literal-ish port of the classic single-wheel path in graphchart.py.
 * Geometry, draw order, integer-ish placement, and overlap shifting follow the
 * desktop renderer closely enough for the web canvas to line up the same way.
 */

import { CanvasDraw, polar, type LineOpts, type TextOpts } from "./canvas-draw";
import { DEFAULT_MORINUS_TEXT_FONT } from "./chart-fonts";
import {
  resolveScaledWheelStroke,
  projectWheelAuthoringStyle,
  resolveWheelLinePaint,
  resolveWheelRingSet,
  resolveWheelRenderStyle,
  resolveWheelStrokeMetrics,
  resolveWheelTypographyMetrics,
  type WheelRenderStyle,
  type WheelAuthoringLineClass,
  type WheelLinePaintRole,
  type WheelRenderStyleSource,
  type WheelRingSet,
  type WheelTypographyProfile,
  type ResolvedWheelTypographyMetrics,
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
  componentBounds: Map<LayoutKey, Bounds[]>;
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

function fallbackTextsize(text: string, opts: TextOpts | undefined, widthScale: number): Pt {
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
  return [Math.round(String(text).length * size * widthScale), size];
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
  bodySize: number,
  angleLabelSize: number,
): number {
  if (key === "__asc" || key === "__mc") {
    return angleLabelSize;
  }
  return bodyGlyphSize(bodySize);
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

function bodyGlyphSize(symbolSize: number): number {
  // Fortuna, Vertex, and the prenatal syzygy are body occurrences, not
  // independent typography classes. Their palette roles remain distinct, but
  // their rendered size follows the same resolved inner/outer body size.
  return symbolSize;
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

type RingSet = WheelRingSet;

function isCompactWheel(chart: Chart): boolean {
  return chart.options.theme === 1;
}

function isAngloWheel(chart: Chart): boolean {
  return chart.options.theme === 2;
}

type AngloDenseLabelLayout = "leader-columns" | "routed-cusps";

function angloDenseLabelLayout(chart: Chart): AngloDenseLabelLayout {
  return chart.options.angloDenseLabelLayout === "leader-columns"
    ? "leader-columns"
    : "routed-cusps";
}

function wheelTypographyProfile(chart: Chart): WheelTypographyProfile {
  return isAngloWheel(chart) ? "anglo" : isCompactWheel(chart) ? "compact" : "classic";
}

function comparisonUsesOuterHouses(snapshot: ChartRenderSnapshot, chart: Chart): boolean {
  if (!snapshot.comparisonChart || !chart.options.showHouses) return false;
  if (!isAngloWheel(chart)) return true;
  return snapshot.comparisonLayout === "with-houses";
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
  });
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

function radialBoxInterval(
  center: Pt,
  asc: number,
  longitude: number,
  box: Bounds,
): [number, number] | null {
  const unitPt = polar(center, 1, longitude, asc);
  const unit: Pt = [unitPt[0] - center[0], unitPt[1] - center[1]];
  let entry = Number.NEGATIVE_INFINITY;
  let exit = Number.POSITIVE_INFINITY;
  for (const [origin, direction, minimum, maximum] of [
    [center[0], unit[0], box.x, box.x + box.w],
    [center[1], unit[1], box.y, box.y + box.h],
  ] as Array<[number, number, number, number]>) {
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
  return exit > 0 ? [Math.max(0, entry), exit] : null;
}

function drawRoutedRadialLine(
  draw: CanvasDraw,
  center: Pt,
  asc: number,
  longitude: number,
  radiusA: number,
  radiusB: number,
  paint: RoutedLinePaint,
  componentBounds?: Map<LayoutKey, Bounds[]>,
) {
  const innerRadius = Math.min(radiusA, radiusB);
  const outerRadius = Math.max(radiusA, radiusB);
  const straight = () => draw.line(
    [
      polar(center, innerRadius, longitude, asc),
      polar(center, outerRadius, longitude, asc),
    ],
    paint,
  );
  if (!componentBounds?.size) {
    straight();
    return;
  }

  const corners = (box: Bounds): Pt[] => [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ];
  const radialUnitPoint = polar(center, 1, longitude, asc);
  const tangentUnitPoint = polar(center, 1, longitude + 90, asc);
  const radialUnit: Pt = [
    radialUnitPoint[0] - center[0],
    radialUnitPoint[1] - center[1],
  ];
  const tangentUnit: Pt = [
    tangentUnitPoint[0] - center[0],
    tangentUnitPoint[1] - center[1],
  ];
  type ProjectedBox = Bounds & {
    sMin: number;
    sMax: number;
    tMin: number;
    tMax: number;
    tCenter: number;
  };
  const projectBox = (box: Bounds): ProjectedBox => {
    const projected = corners(box).map(([x, y]) => {
      const dx = x - center[0];
      const dy = y - center[1];
      return {
        s: dx * radialUnit[0] + dy * radialUnit[1],
        t: dx * tangentUnit[0] + dy * tangentUnit[1],
      };
    });
    const centerDx = box.x + box.w / 2 - center[0];
    const centerDy = box.y + box.h / 2 - center[1];
    return {
      ...box,
      sMin: Math.min(...projected.map(({ s }) => s)),
      sMax: Math.max(...projected.map(({ s }) => s)),
      tMin: Math.min(...projected.map(({ t }) => t)),
      tMax: Math.max(...projected.map(({ t }) => t)),
      tCenter: centerDx * tangentUnit[0] + centerDy * tangentUnit[1],
    };
  };
  // AC/MC labels sit on their own rays by design; the structural line should
  // route body columns, not manufacture a detour around its own label.
  const boxes = [...componentBounds.entries()]
    .filter(([key]) => key !== "__asc" && key !== "__mc")
    .flatMap(([, bounds]) => bounds.map(projectBox));
  const blocking = boxes.filter(
    (box) =>
      box.sMax > innerRadius &&
      box.sMin < outerRadius &&
      box.tMin <= 0 &&
      box.tMax >= 0,
  );
  if (!blocking.length) {
    straight();
    return;
  }

  const drawSegmentedFallback = () => {
    const gaps = boxes
      .map((box) => radialBoxInterval(center, asc, longitude, box))
      .filter((interval): interval is [number, number] => Boolean(interval))
      .map(([start, end]) => [
        Math.max(innerRadius, start),
        Math.min(outerRadius, end),
      ] as [number, number])
      .filter(([start, end]) => end > start)
      .sort((left, right) => left[0] - right[0]);
    const merged: Array<[number, number]> = [];
    for (const gap of gaps) {
      const previous = merged[merged.length - 1];
      if (previous && gap[0] <= previous[1]) previous[1] = Math.max(previous[1], gap[1]);
      else merged.push([...gap]);
    }
    let cursor = innerRadius;
    for (const [gapStart, gapEnd] of merged) {
      if (gapStart > cursor + 0.5) {
        draw.line(
          [polar(center, cursor, longitude, asc), polar(center, gapStart, longitude, asc)],
          paint,
        );
      }
      cursor = Math.max(cursor, gapEnd);
    }
    if (cursor < outerRadius - 0.5) {
      draw.line(
        [polar(center, cursor, longitude, asc), polar(center, outerRadius, longitude, asc)],
        paint,
      );
    }
  };

  const sideEpsilon = 1e-6;
  const sides = new Set(
    blocking.map((box) =>
      box.tCenter > sideEpsilon ? 1 : box.tCenter < -sideEpsilon ? -1 : 0
    ),
  );
  if (sides.size !== 1 || sides.has(0)) {
    drawSegmentedFallback();
    return;
  }

  const routePadPx = 2;
  const occupiedSide = [...sides][0];
  const routeInner = Math.max(
    innerRadius,
    Math.min(...blocking.map((box) => box.sMin)) - routePadPx,
  );
  const routeOuter = Math.min(
    outerRadius,
    Math.max(...blocking.map((box) => box.sMax)) + routePadPx,
  );
  const routeT = occupiedSide > 0
    ? Math.min(...blocking.map((box) => box.tMin)) - routePadPx
    : Math.max(...blocking.map((box) => box.tMax)) + routePadPx;
  const routeTMin = Math.min(0, routeT);
  const routeTMax = Math.max(0, routeT);
  const routeBlocked = boxes.some((box) => {
    const crossesDetour =
      box.sMax > routeInner &&
      box.sMin < routeOuter &&
      box.tMin <= routeT &&
      box.tMax >= routeT;
    const crossesInnerTurn =
      box.sMin <= routeInner &&
      box.sMax >= routeInner &&
      box.tMax >= routeTMin &&
      box.tMin <= routeTMax;
    const crossesOuterTurn =
      box.sMin <= routeOuter &&
      box.sMax >= routeOuter &&
      box.tMax >= routeTMin &&
      box.tMin <= routeTMax;
    return crossesDetour || crossesInnerTurn || crossesOuterTurn;
  });
  if (routeBlocked) {
    drawSegmentedFallback();
    return;
  }

  const localPoint = (s: number, t: number): Pt => [
    center[0] + radialUnit[0] * s + tangentUnit[0] * t,
    center[1] + radialUnit[1] * s + tangentUnit[1] * t,
  ];
  draw.line(
    [
      localPoint(innerRadius, 0),
      localPoint(routeInner, 0),
      localPoint(routeInner, routeT),
      localPoint(routeOuter, routeT),
      localPoint(routeOuter, 0),
      localPoint(outerRadius, 0),
    ],
    paint,
  );
}

function drawHouses(
  draw: CanvasDraw,
  center: Pt,
  ringset: RingSet,
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  style: WheelRenderStyle,
  componentBounds?: Map<LayoutKey, Bounds[]>,
) {
  const angleLongitudes = [chart.angles.asc, chart.angles.dsc, chart.angles.mc, chart.angles.ic];
  const linePaint = {
    fill: style.elementColors.houseCusp,
    ...semanticLinePaint(
      style,
      "houseCusp" as const,
      style.strokes.hairline,
      {},
      "houses.outer.cusp",
    ),
  };
  const routedBounds =
    isAngloWheel(chart) &&
    angloDenseLabelLayout(chart) === "routed-cusps" &&
    componentBounds;
  for (let i = 0; i < 12; i++) {
    const cusp = chart.houses.cusps[i];
    if (isAngloWheel(chart) && angleLongitudes.some((angle) => sameLongitude(cusp, angle))) {
      continue;
    }
    const startRadius = Math.min(ringset.rBase, ringset.rInner);
    const endRadius = Math.max(ringset.rBase, ringset.rInner);
    if (!routedBounds) {
      draw.line(
        [polar(center, startRadius, cusp, asc), polar(center, endRadius, cusp, asc)],
        linePaint,
      );
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
      routedBounds,
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
  for (let signIndex = 0; signIndex < chart.options.terms.length; signIndex += 1) {
    for (const segment of chart.options.terms[signIndex]) {
      // Ruler longitude + glyph resolved daemon-side.
      const midDeg = segment.rulerLon ?? signIndex * 30 + segment.size / 2;
      const pt = polar(center, ringset.rTermsPlanet, midDeg, asc);
      draw.text([pt[0] - smallSymbolSize / 2, pt[1] - smallSymbolSize / 2], segment.rulerGlyph ?? "", {
        fill: style.elementColors.termGlyph,
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
  asc: number,
  chart: Chart,
  palette: ChartPalette,
  style: WheelRenderStyle,
) {
  if (!isAngloWheel(chart) || ringset.rCuspOuter == null) return;
  const inward = Boolean(chart.options.showTerms || chart.options.showDecans);
  const direction = inward ? -1 : 1;
  const rulerTicks = style.geometry.anglo.cuspRulerTicks;
  const shortTick = ringset.r30 * rulerTicks.short;
  const mediumTick = ringset.r30 * rulerTicks.medium;
  const longTick = ringset.r30 * rulerTicks.long;
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
  // Ruler longitude + glyph resolved daemon-side (ChartDecanRuler).
  for (const signDecan of chart.options.decans) {
    for (const ruler of signDecan.rulers ?? []) {
      const pt = polar(center, ringset.rDecansPlanet, ruler.rulerLon, asc);
      draw.text([pt[0] - smallSymbolSize / 2, pt[1] - smallSymbolSize / 2], ruler.rulerGlyph, {
        fill: style.elementColors.decanGlyph,
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
  fontSize: number,
  layoutUnit: number,
  style: WheelRenderStyle,
) {
  for (let i = 0; i < 12; i++) {
    const cusp = chart.houses.cusps[i];
    const nextCusp = chart.houses.cusps[(i + 1) % 12];
    const width = ((nextCusp - cusp + 360) % 360) || 30;
    const pt = polar(center, ringset.rHouseName, cusp + width / 2, asc);
    if (isAngloWheel(chart)) {
      const label = String(i + 1);
      const [labelWidth, labelHeight] = draw.textsize(label, { font: fontUi, size: fontSize });
      draw.text([pt[0] - labelWidth / 2, pt[1] - labelHeight / 2], label, {
        fill: style.elementColors.angloHouseLabel,
        font: fontUi,
        size: fontSize,
      });
      continue;
    }
    let xOffset = layoutUnit * style.labels.houseClassicOffsetScale;
    let yOffset = layoutUnit * style.labels.houseClassicOffsetScale;
    if (i === 0 || i === 1) {
      xOffset = 0;
      yOffset = layoutUnit * style.labels.houseClassicOffsetScale;
      if (i === 1) {
        xOffset = layoutUnit * style.labels.houseSecondOffsetScale;
      }
    }
    draw.text([pt[0] - xOffset, pt[1] - yOffset], HOUSE_GLYPHS_ROMAN[i], {
      fill: style.elementColors.houseLabel,
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
  const ctx = draw.ctx;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = semanticLinePaint(
    style,
    "angle",
    1,
    {},
    "angles.inner.arrowhead",
  ).opacity ?? 1;
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
  componentBounds?: Map<LayoutKey, Bounds[]>,
) {
  const width = isAngloWheel(chart)
    ? style.strokes.hairline
    : ascmcPenWidth(style, chart, chartSize);
  const lons = [chart.angles.asc, chart.angles.dsc, chart.angles.mc, chart.angles.ic];
  for (let index = 0; index < lons.length; index += 1) {
    const lon = lons[index];
    if (isAngloWheel(chart)) {
      const isAscMc = index === 0 || index === 2;
      const sharedCusp =
        isAscMc && angleSharesHouseCusp(chart, index === 0 ? "__asc" : "__mc");
      const anglePaint = {
        fill: style.elementColors.angleRay,
        ...semanticLinePaint(style, "angle" as const, style.strokes.angloStructural),
      };
      drawRoutedRadialLine(
        draw,
        center,
        asc,
        lon,
        ringset.rBase,
        ringset.rInner,
        anglePaint,
        angloDenseLabelLayout(chart) === "routed-cusps"
          ? componentBounds
          : undefined,
      );
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
): Map<LayoutKey, number> {
  const bodySize = outerTypography ? typography.outerSize : typography.bodySize;
  const layoutUnit = outerTypography
    ? typography.outerLayoutUnit
    : typography.layoutUnit;
  const angleLabelSize = outerTypography
    ? typography.outerAngleLabelSize
    : typography.angleLabelSize;
  const planets = planetById(chart);
  const anglo = isAngloWheel(chart);
  const ordered = layoutKeys(chart, includeAngles, includeSharedAngles)
    .map((key) => ({ key, longitude: layoutLongitude(chart, planets, key) }))
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
    const glyphSize = layoutGlyphSize(entry.key, bodySize, angleLabelSize);
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
    const position = style.typography.ratios.angloBodyPosition;
    const boxes = [glyphRect];

    if (!anglo || !includePositionStacks) return remember(boxes);
    if (entry.key === "__asc" || entry.key === "__mc") {
      return remember(boxes);
    }
    const bodyPosition = bodyDegMin(chart, planets, entry.key);
    if (!bodyPosition) return remember(boxes);
    const [degText, minText] = bodyPosition;
    const positionRows = [
      {
        text: `${degText}°`,
        radius: rPlanet - layoutUnit * position.degreeRadiusOffset,
        font: fontUi,
        size: typography.angloBodyPosition.degreeSize,
      },
      {
        text: signGlyph(Math.floor(normalize(entry.longitude) / 30), chart.options.signVariant),
        radius: rPlanet - layoutUnit * position.signRadiusOffset,
        font: fontSymbols,
        size: typography.angloBodyPosition.signSize,
      },
      {
        text: minText,
        radius: rPlanet - layoutUnit * position.minuteRadiusOffset,
        font: fontUi,
        size: typography.angloBodyPosition.minuteSize,
      },
    ];
    for (const row of positionRows) {
      const rowPt = polar(center, row.radius, shiftedLon, asc);
      const [rowW, rowH] = draw.textsize(row.text, { font: row.font, size: row.size });
      boxes.push({ x: rowPt[0] - rowW / 2, y: rowPt[1] - rowH / 2, w: rowW, h: rowH });
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
    ? [chart.angles.asc, chart.angles.dsc, chart.angles.mc, chart.angles.ic].filter(
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
  const packAngloSectors = (rays: number[]): boolean => {
    if (!anglo || outerTypography || rays.length < 2) return false;

    const bodyIndices = ordered
      .map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => entry.key !== "__asc" && entry.key !== "__mc")
      .map(({ idx }) => idx);
    if (!bodyIndices.length) return false;

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
        const startIsHard = fixedRayLongitudes.some((ray) => sameLongitude(ray, start));
        const endIsHard = fixedRayLongitudes.some((ray) => sameLongitude(ray, end));
        return {
          cumulative,
          lower:
            start +
            (startIsHard
              ? angleObstacle(start, "left") + rayGapDegrees + leftWall.left
              : 1e-9),
          upper:
            end -
            (endIsHard
              ? angleObstacle(end, "right") + rayGapDegrees + rightWall.right
              : 1e-9) -
            cumulative[cumulative.length - 1],
        };
      };
      let { cumulative, lower, upper } = geometry();
      if (lower > upper + 1e-9) {
        ordered.forEach((entry) => shifts.set(entry.key, 0));
        return false;
      }
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
      if (lower > upper + 1e-9) {
        ordered.forEach((entry) => shifts.set(entry.key, 0));
        return false;
      }
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
          ordered.forEach((entry) => shifts.set(entry.key, 0));
          return false;
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
        fixedRays.some((ray) =>
          rawBoxesAt(idx).some((box) => boxIntersectsRay(box, ray, rayGapPx)),
        )
      ) {
        ordered.forEach((entry) => shifts.set(entry.key, 0));
        return false;
      }
    }
    return true;
  };
  if (packAngloSectors(hardSectorLongitudes)) return shifts;

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
    // another away from their own ticks.
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

  const [, degTextH] = draw.textsize("00", { font: fontUi, size: degreeSize });
  const layerOffset = degTextH + style.collision.labelLayerGap;

  const [degW, degH] = draw.textsize("29", { font: fontUi, size: degreeSize });
  const [minW, minH] = draw.textsize("59", { font: fontUi, size: minuteSize });
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
): Map<LayoutKey, number> {
  const bodySize = outerTypography ? typography.outerSize : typography.bodySize;
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
    typography,
    style,
    includeAngles,
    includePositionStacks,
    includeSharedAngles,
    includeHouseCuspRays,
    outerTypography,
  );
  boundedMapSet(chartCache, key, shifts);
  return shifts;
}

function resolveMotionMarkerBounds(
  draw: TextMeasurer,
  center: Pt,
  asc: number,
  displayedLongitude: number,
  rPlanet: number,
  rRetr: number,
  glyphSize: number,
  marker: string,
  fontUi: string,
  markerSize: number,
  layoutUnit: number,
  style: WheelRenderStyle,
  positionBounds: Bounds[],
): Bounds {
  const [markerW, markerH] = draw.textsize(marker, { font: fontUi, size: markerSize });
  const gap = Math.max(style.labels.motionGapMin, layoutUnit * style.labels.motionGapScale);
  const glyphPt = polar(center, rPlanet, displayedLongitude, asc);
  let markerRadius = rRetr;
  let markerPt = polar(center, markerRadius, displayedLongitude, asc);
  let markerX = markerPt[0] - markerW / 2;
  let markerY = markerPt[1] - markerH / 2;
  const direction = rRetr <= rPlanet ? -1 : 1;
  const glyphBounds: Bounds = {
    x: glyphPt[0] - glyphSize / 2 - gap,
    y: glyphPt[1] - glyphSize / 2 - gap,
    w: glyphSize + gap * 2,
    h: glyphSize + gap * 2,
  };
  const collides = (x: number, y: number, bounds: Bounds[]) =>
    bounds.some((box) => overlap(x, y, markerW, markerH, box.x, box.y, box.w, box.h));

  let nudge = 0;
  while (
    nudge < layoutUnit * style.labels.motionRadialNudgeScale &&
    collides(markerX, markerY, [glyphBounds])
  ) {
    markerRadius += direction;
    markerPt = polar(center, markerRadius, displayedLongitude, asc);
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
    for (
      let sideNudge = 1;
      sideNudge <= layoutUnit * style.labels.motionTangentNudgeScale;
      sideNudge += 1
    ) {
      const clearSide = [sideNudge, -sideNudge].find((side) =>
        !collides(markerX + tangentX * side, markerY + tangentY * side, protectedBounds));
      if (clearSide != null) {
        markerX += tangentX * clearSide;
        markerY += tangentY * clearSide;
        break;
      }
    }
  }
  return { x: markerX, y: markerY, w: markerW, h: markerH };
}

function measureAngloComponentBounds(
  draw: TextMeasurer,
  chart: Chart,
  center: Pt,
  asc: number,
  rPlanet: number,
  rRetr: number,
  shifts: Map<LayoutKey, number>,
  fontSymbols: string,
  fontUi: string,
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
): Map<LayoutKey, Bounds[]> {
  const bounds = new Map<LayoutKey, Bounds[]>();
  if (!isAngloWheel(chart)) return bounds;
  const planets = planetById(chart);
  const includeAngles = Boolean(chart.options.showHouses) || cusplessAscMcLabelsVisible(chart);
  const includeSharedAngles =
    !chart.options.showHouses && cusplessAscMcLabelsVisible(chart);
  const position = style.typography.ratios.angloBodyPosition;
  const pad = Math.max(1, typography.layoutUnit * 0.02);

  for (const key of layoutKeys(chart, includeAngles, includeSharedAngles)) {
    const lon = layoutLongitude(chart, planets, key);
    if (lon == null) continue;
    const displayedLon = lon + (shifts.get(key) ?? 0);
    const glyph = layoutGlyph(chart, planets, key);
    const glyphSize = layoutGlyphSize(
      key,
      typography.bodySize,
      typography.angleLabelSize,
    );
    const weight =
      key === "__asc" || key === "__mc"
        ? style.typography.ratios.angleLabelWeight
        : undefined;
    const [glyphW, glyphH] = draw.textsize(glyph, {
      font: layoutGlyphFont(chart, key, fontSymbols, fontUi),
      size: glyphSize,
      weight,
    });
    const glyphPt = polar(center, rPlanet, displayedLon, asc);
    const angleLabel = key === "__asc" || key === "__mc";
    const rawGlyphBounds = angleLabel
      ? {
          x: glyphPt[0] - glyphW / 2,
          y: glyphPt[1] - glyphH / 2,
          w: glyphW,
          h: glyphH,
        }
      : {
          x: glyphPt[0] - glyphSize / 2,
          y: glyphPt[1] - glyphSize / 2,
          w: glyphW,
          h: glyphH,
        };
    const components: Bounds[] = [{
      x: rawGlyphBounds.x - pad,
      y: rawGlyphBounds.y - pad,
      w: rawGlyphBounds.w + pad * 2,
      h: rawGlyphBounds.h + pad * 2,
    }];
    const rawPositionBounds: Bounds[] = [];

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
          },
          {
            text: signGlyph(
              Math.floor(normalize(lon) / 30),
              chart.options.signVariant,
            ),
            radius: rPlanet - typography.layoutUnit * position.signRadiusOffset,
            font: fontSymbols,
            size: typography.angloBodyPosition.signSize,
          },
          {
            text: minText,
            radius: rPlanet - typography.layoutUnit * position.minuteRadiusOffset,
            font: fontUi,
            size: typography.angloBodyPosition.minuteSize,
          },
        ];
        for (const row of rows) {
          const rowPt = polar(center, row.radius, displayedLon, asc);
          const [rowW, rowH] = draw.textsize(row.text, {
            font: row.font,
            size: row.size,
          });
          const rowBounds = {
            x: rowPt[0] - rowW / 2,
            y: rowPt[1] - rowH / 2,
            w: rowW,
            h: rowH,
          };
          rawPositionBounds.push(rowBounds);
          components.push({
            x: rowBounds.x - pad,
            y: rowBounds.y - pad,
            w: rowBounds.w + pad * 2,
            h: rowBounds.h + pad * 2,
          });
        }
      }
      const marker =
        key === "__fortune" || key === "__vertex" || key === "__syzygy"
          ? ""
          : planets.get(key)?.motion ?? "";
      if (marker) {
        const markerBounds = resolveMotionMarkerBounds(
          draw,
          center,
          asc,
          displayedLon,
          rPlanet,
          rRetr,
          glyphSize,
          marker,
          fontUi,
          typography.motionSize,
          typography.layoutUnit,
          style,
          rawPositionBounds,
        );
        components.push({
          x: markerBounds.x - pad,
          y: markerBounds.y - pad,
          w: markerBounds.w + pad * 2,
          h: markerBounds.h + pad * 2,
        });
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
): BodyLayout {
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
    cacheNumber(typography.angloBodyPosition.degreeSize),
    cacheNumber(typography.angloBodyPosition.signSize),
    cacheNumber(typography.angloBodyPosition.minuteSize),
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
        true,
        !chart.options.showHouses && cusplessAscMcLabelsVisible(chart),
        Boolean(chart.options.showHouses),
        false,
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
        false,
        true,
        false,
        false,
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
        rRetr,
        bodyShifts,
        fontSymbols,
        fontUi,
        typography,
        style,
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
  style: WheelRenderStyle,
) {
  const planets = planetById(chart);
  const anglo = isAngloWheel(chart);
  const width = anglo ? style.strokes.angloStructural : mediumPenWidth(style, chartSize);
  const color = anglo
    ? style.elementColors.angloOuterLeader
    : style.elementColors.outerLeader;
  for (const key of bodyKeys(chart)) {
    const lon = bodyLongitude(chart, planets, key);
    if (lon == null) {
      continue;
    }
    const shift = shifts.get(key) ?? 0;
    const p1 = polar(center, ringset.r30, lon, asc);
    const p2 = polar(center, ringset.rOuterLine, anglo ? lon : lon + shift, asc);
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
        ...semanticLinePaint(style, "angle", style.strokes.angloStructural),
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
    const size = layoutGlyphSize(key, angleLabelSize, angleLabelSize);
    const weight = style.typography.ratios.angleLabelWeight;
    const [w, h] = draw.textsize(label, { font: fontUi, size, weight });
    draw.text([pt[0] - w / 2, pt[1] - h / 2], label, {
      fill: style.elementColors.angleLabel,
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
  style: WheelRenderStyle,
  authoringClass: WheelAuthoringLineClass = "aspects.primary.line",
): { fill: string; width: number; dash?: number[]; opacity?: number } {
  const fill = palette.aspects[aspect.type] ?? palette.frame;
  const aspects = style.strokes.aspects;
  let base: { width: number; dash?: number[]; opacity?: number };
  if (chart.options.aspectThicknessMode || chart.options.aspectOpacityMode) {
    const maxOrb = Number(aspect.maxOrb ?? 0);
    if (maxOrb > 0) {
      const orbRatio = Math.min(Math.max(Number(aspect.orb ?? 0) / maxOrb, 0), 1);
      if (isAngloWheel(chart)) {
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
          ? isAngloWheel(chart)
            ? aspects.angloThicknessNoOrb
            : aspects.classicThicknessNoOrb
          : isAngloWheel(chart)
            ? aspects.angloWidth
            : aspects.classicWidth,
        opacity: 1,
      };
    }
  } else {
    base = {
      width: isAngloWheel(chart) ? aspects.angloWidth : aspects.classicWidth,
      dash: aspect.exact
        ? undefined
        : [...(isAngloWheel(chart) ? aspects.angloDash : aspects.classicDash)],
    };
  }
  return {
    fill,
    ...semanticLinePaint(style, "aspect", base.width, {
      dash: base.dash,
      opacity: base.opacity,
    }, authoringClass),
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
    draw.text(
      [
        (p1[0] + p2[0]) / 2 - offset,
        (p1[1] + p2[1]) / 2 - offset,
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
  degSize: number,
  minSize: number,
): Bounds {
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
  degSize: number,
  minSize: number,
): Bounds[] {
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
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
): Bounds[] {
  const position = style.typography.ratios.angloBodyPosition;
  const sizes = typography.angloBodyPosition;
  const rows = [
    {
      text: `${degText}°`,
      radius: ringset.rPlanet - typography.layoutUnit * position.degreeRadiusOffset - yoff,
      font: fontUi,
      size: sizes.degreeSize,
      fill: palette.positions,
    },
    {
      text: signGlyph(Math.floor(normalize(trueLon) / 30), chart.options.signVariant),
      radius: ringset.rPlanet - typography.layoutUnit * position.signRadiusOffset - yoff,
      font: fontSymbols,
      size: sizes.signSize,
      fill: chart.options.signColors?.[Math.floor(normalize(trueLon) / 30)] ?? palette.signs,
    },
    {
      text: minText,
      radius: ringset.rPlanet - typography.layoutUnit * position.minuteRadiusOffset - yoff,
      font: fontUi,
      size: sizes.minuteSize,
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
  typographySizes: Readonly<{
    degreeSize: number;
    signSize: number;
    minuteSize: number;
    gap: number;
  }>,
) {
  const signIndex = Math.floor(normalize(lon) / 30);
  const parts = [
    { text: `${degText}°`, font: fontUi, size: typographySizes.degreeSize, fill: palette.positions },
    {
      text: signGlyph(signIndex, chart.options.signVariant),
      font: fontSymbols,
      size: typographySizes.signSize,
      fill: chart.options.signColors?.[signIndex] ?? palette.signs,
    },
    { text: minText, font: fontUi, size: typographySizes.minuteSize, fill: palette.positions },
  ];
  const gap = typographySizes.gap;
  const measurements = parts.map((part) =>
    draw.textsize(part.text, { font: part.font, size: part.size })
  );
  const pt = polar(center, radius, lon, asc);
  const radialX = (pt[0] - center[0]) / Math.max(1, radius);
  const radialY = (pt[1] - center[1]) / Math.max(1, radius);
  const tangentX = -radialY;
  const tangentY = radialX;
  const extents = measurements.map(
    ([w, h]) => (Math.abs(tangentX) * w + Math.abs(tangentY) * h) / 2,
  );
  const totalSpan = extents.reduce((sum, extent) => sum + extent * 2, 0) + gap * (parts.length - 1);
  let cursor = -totalSpan / 2;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const [w, h] = measurements[i];
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
  typography: ResolvedWheelTypographyMetrics,
  style: WheelRenderStyle,
  outer = false,
) {
  const symbolSize = outer ? typography.outerSize : typography.bodySize;
  const layoutUnit = outer
    ? typography.outerLayoutUnit
    : typography.layoutUnit;
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
    const glyphSize = bodyGlyphSize(symbolSize);
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
            typography,
            style,
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
            typography.bodyPosition.degreeSize,
            typography.bodyPosition.minuteSize,
          ));
        } else if (chart.options.showPositions) {
          const posPt = polar(center, ringset.rPos - yoff, lon + shift, asc);
          positionBounds.push(
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
            ),
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
      const markerBounds = resolveMotionMarkerBounds(
        draw,
        center,
        asc,
        lon + shift,
        ringset.rPlanet,
        ringset.rRetr,
        glyphSize,
        marker,
        fontUi,
        motionSize,
        layoutUnit,
        style,
        positionBounds,
      );
      draw.text([markerBounds.x, markerBounds.y], marker, {
        fill: bodyColor(chart, planets, key, palette),
        font: fontUi,
        size: motionSize,
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
        );
        const labelWeight = style.typography.ratios.angleLabelWeight;
        const [labelWidth, labelHeight] = draw.textsize(angleLabel, {
          font: fontUi,
          size: labelSize,
          weight: labelWeight,
        });
        draw.text([labelPt[0] - labelWidth / 2, labelPt[1] - labelHeight / 2], angleLabel, {
          fill: style.elementColors.angleLabel,
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
        typography.angloAnglePosition,
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
    draw.line([p1, p2], {
      fill: style.elementColors.houseCusp,
      ...semanticLinePaint(style, "houseCusp", style.strokes.hairline),
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
) {
  const primaryPlanets = planetById(primaryChart);
  const comparisonPlanets = planetById(comparisonChart);
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
        (p1[0] + p2[0]) / 2 - offset,
        (p1[1] + p2[1]) / 2 - offset,
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

function outerRingItemFontSize(
  item: OuterRingItem,
  projectedGlyphSize: number,
  labelFontSize: number,
): number {
  // graphchart.drawAntis draws antiscia / contra-antiscia / dodecatemoria
  // projected glyphs with fntMorinus/fntAntisText at full symbolSize
  // (graphchart.py:437-449, 4619-4691), unlike fixed-star/AP text labels
  // which use fntText at symbolSize / 2.
  return PROJECTED_GLYPH_FAMILIES.has(item.family) || OUTER_BODY_GLYPH_FAMILIES.has(item.family)
    ? projectedGlyphSize
    : labelFontSize;
}

function outerRingItemLabelRadius(
  item: OuterRingItem,
  ringset: RingSet,
  outerLayoutUnit: number,
  style: WheelRenderStyle,
): number {
  const radiusOffset = outerLayoutUnit * style.labels.outerRadiusOffsetScale;
  if (OUTER_BODY_GLYPH_FAMILIES.has(item.family)) {
    return ringset.rOuterPlanet ?? ringset.rAntis ?? ringset.rOuterLine + radiusOffset;
  }
  // wx projected glyph rings sit at rAntis, with tick lines ending at
  // rAntisLines (0.90 / 0.86 maxradius; graphchart.py:144-145, 1397-1408).
  if (PROJECTED_GLYPH_FAMILIES.has(item.family)) {
    return ringset.rAntis ?? ringset.rOuterLine + radiusOffset;
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
  outerLayoutUnit: number,
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
  outerLayoutUnit: number,
  projectedGlyphSize: number,
  chart: Chart,
  palette: ChartPalette,
  style: WheelRenderStyle,
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
    const itemFontSize = outerRingItemFontSize(item, projectedGlyphSize, labelFontSize);
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
      Math.round(outerLayoutUnit * style.labels.outerOutsidePadScale),
    );
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
      {
        fill: style.elementColors.outerLeader,
        ...semanticLinePaint(
          style,
          "outerLeader",
          isAngloWheel(chart)
            ? style.strokes.hairline
            : mediumPenWidth(style, chartSize),
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
  fontSize: number,
  outerLayoutUnit: number,
  projectedGlyphSize: number,
  motionSize: number,
  canvasWidth: number,
  style: WheelRenderStyle,
) {
  for (let i = 0; i < layout.items.length; i += 1) {
    const item = layout.items[i];
    const labelRadius = outerRingItemLabelRadius(item, ringset, outerLayoutUnit, style);
    const itemFontSize = outerRingItemFontSize(item, projectedGlyphSize, fontSize);
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
        draw, runs, x, w, h, canvasWidth, outerLayoutUnit, fontUi, itemFontSize, palette, style,
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
      Math.round(outerLayoutUnit * style.labels.outerOutsidePadScale),
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
      const markerRadius =
        ringset.rOuterRetr ??
        ringset.rOuterLine + outerLayoutUnit * style.labels.outerMotionRadiusScale;
      const markerPt = polar(center, markerRadius, shiftedLon, asc);
      const markerOffset = outerLayoutUnit * style.labels.outerMotionOffsetScale;
      draw.text([markerPt[0] - markerOffset, markerPt[1] - markerOffset], item.motion, {
        fill: firstRunColor,
        font: fontUi,
        size: motionSize,
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
  style: WheelRenderStyle,
) {
  if (!marks.length) {
    return;
  }
  const accent = palette.surveilAccent ?? "rgb(229,146,70)";
  const rWheel = ringset.r30;
  const rOuter = ringset.rOuterLine;
  const surveil = style.labels.surveil;
  const tickLen = Math.max(
    surveil.tickLengthMin,
    Math.round(symbolSize * surveil.tickLengthScale),
  );
  const rTickEnd = Math.max(rOuter, rWheel + tickLen);
  const glyphGap = Math.max(
    surveil.glyphGapMin,
    Math.round(symbolSize * surveil.glyphGapScale),
  );
  // wx uses symbolSize*0.34*_dpi_scale; the web symbolSize (maxRadius/16) is the
  // same base wx uses, so no extra DPI factor is applied here.
  const glyphSize = Math.max(
    surveil.glyphSizeMin,
    Math.round(symbolSize * surveil.glyphSizeScale),
  );
  const labelGap = Math.max(
    surveil.labelGapMin,
    Math.round(symbolSize * surveil.labelGapScale),
  );

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
      {
        fill: accent,
        ...semanticLinePaint(style, "outerLeader", style.strokes.hairline),
      },
    );

    let markerText = (mark.glyph ?? "").trim();
    let markerFont = mark.glyphFont === "morinus" ? fontSymbols : fontUi;
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

    const [gw, gh] = draw.textsize(markerText, { font: markerFont, size: glyphSize });
    const [tw, th] = sourceText
      ? draw.textsize(sourceText, { font: fontUi, size: glyphSize })
      : [0, 0];
    const totalW = gw + (sourceText ? labelGap : 0) + tw;
    const totalH = Math.max(gh, th);

    const rLabel = rTickEnd + glyphGap;
    const anchor = polar(center, rLabel, lon, asc);
    let left: number;
    if (cosA > surveil.horizontalThreshold) {
      left = anchor[0];
    } else if (cosA < -surveil.horizontalThreshold) {
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
  style: WheelRenderStyle,
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
    ringset.rAntis ??
      ringset.rOuterLine + typography.outerLayoutUnit * style.labels.outerRadiusOffsetScale,
    fontUi,
    fontSymbols,
    typography.outerLabelSize,
    typography.outerLayoutUnit,
    typography.outerProjectedGlyphSize,
    outerItemsChart,
    palette,
    style,
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
  const key = [
    stars.length,
    cachePoint(center),
    cacheNumber(asc),
    cacheNumber(ringset.rOuterLine),
    fontUi,
    cacheNumber(typography.outerLayoutUnit),
    cacheNumber(typography.outerLabelSize),
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
    typography.outerLabelSize,
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
      ...semanticLinePaint(style, "outerLeader", width),
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
  let labelRadius = ringset.rOuterLine + outerLayoutUnit * style.labels.outerRadiusOffsetScale;
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
      Math.round(outerLayoutUnit * style.labels.outerOutsidePadScale),
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
  const chart = snapshot.primaryChart;
  const comparisonChart = snapshot.comparisonChart ?? undefined;
  const { width, height } = opts;
  const chartSize = opts.chartSize ?? Math.min(width, height);
  // Classic/compact preserve the wx maxradius/16 scale; Anglo has its own
  // tighter print-oriented typography profile.
  const maxRadius = chartSize / 2;
  const style = projectWheelAuthoringStyle(
    resolveDrawStyle(opts),
    maxRadius,
    wheelTypographyProfile(chart),
  );
  applyStyleRevision(wheelStyleRevisionKey(style));
  const palette = style.palette as ChartPalette;
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
    ? comparisonRings(style, chart, maxRadius, showOuterHouseGeometry)
    : effectiveRings(style, chart, maxRadius, hasOuterRing);
  const typography = resolveWheelTypographyMetrics(
    style,
    wheelTypographyProfile(chart),
    maxRadius,
  );
  const signSize = typography.signSize;
  const fontSymbols = style.typography.families.symbols;
  const fontBodySymbols = style.typography.families.bodySymbols;
  const fontSignSymbols = style.typography.families.signSymbols;
  const fontTermSymbols = style.typography.families.termSymbols;
  const fontDecanSymbols = style.typography.families.decanSymbols;
  const fontAspectSymbols = style.typography.families.aspectSymbols;
  const fontUi = style.typography.families.ui;

  draw.clear();
  if (layer === "geometry") {
    const routedComponentBounds =
      isAngloWheel(chart) &&
      angloDenseLabelLayout(chart) === "routed-cusps"
        ? draw.measure("body-layout", () =>
            getBodyLayout(
              draw,
              chart,
              center,
              asc,
              ringset.rPlanet,
              ringset.rPos,
              ringset.rRetr,
              fontBodySymbols,
              fontUi,
              typography,
              style,
            ).componentBounds,
          )
        : undefined;
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
    drawTermsLines(draw, center, ringset, asc, chart, palette, style);
    drawDecanLines(draw, center, ringset, asc, chart, palette, style);
    drawAngloCuspRuler(draw, center, ringset, asc, chart, palette, style);
    if (chart.options.showHouses) {
      drawHouses(
        draw,
        center,
        ringset,
        asc,
        chart,
        palette,
        style,
        routedComponentBounds,
      );
      if (comparisonChart && showOuterHouseGeometry) {
        drawOuterHouses(draw, center, ringset, asc, comparisonChart, palette, style);
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
      );
      if (comparisonChart && showOuterHouseGeometry && ringset.rOuterHouseName) {
        drawHouseNames(
          draw,
          center,
          { ...ringset, rHouseName: ringset.rOuterHouseName } as RingSet,
          asc,
          comparisonChart,
          palette,
          fontUi,
          typography.outerHouseLabelSize,
          typography.outerLayoutUnit,
          style,
        );
      }
    }
    drawSigns(draw, center, ringset, asc, chart, palette, fontSignSymbols, signSize);
    drawAscMC(
      draw,
      center,
      ringset,
      asc,
      chart,
      chartSize,
      palette,
      style,
      routedComponentBounds,
    );
    if (comparisonChart) {
      drawOuterAscMC(draw, center, ringset, asc, comparisonChart, chartSize, palette, style);
    }
    return;
  }

  if (layer === "dynamic") {
    // Collision placement is a pure function of this snapshot. Positional
    // corrections are never carried across frames: a clear body therefore
    // returns to its true foot, and H/resize/history cannot change a result.
    const { bodyShifts, labelYoffs } = draw.measure("body-layout", () =>
      getBodyLayout(
        draw,
        chart,
        center,
        asc,
        ringset.rPlanet,
        ringset.rPos,
        ringset.rRetr,
        fontBodySymbols,
        fontUi,
        typography,
        style,
      ),
    );
    const outerBodyShifts = comparisonChart
      ? getBodyShifts(
          draw,
          comparisonChart,
          center,
          asc,
          ringset.rOuterPlanet ?? ringset.rPlanet,
          fontBodySymbols,
          fontUi,
          typography,
          style,
          isAngloWheel(comparisonChart),
          false,
          true,
          showOuterHouseGeometry,
          true,
        )
      : null;
    drawPlanetLines(
      draw,
      center,
      ringset,
      asc,
      chart,
      bodyShifts,
      chartSize,
      palette,
      style,
    );
    drawAngloAngleLabelLines(draw, center, ringset, asc, chart, bodyShifts, palette, style);
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
        style,
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
          drawAspectLines(draw, center, ringset, asc, chart, palette, drawOuterPointAspects, style);
        } else {
          drawInterChartAspectMarkers(draw, center, ringset, asc, comparisonChart, drawInterChartAspects, chartSize, palette, style);
          drawInterChartAspectLines(draw, center, ringset, asc, chart, comparisonChart, drawInterChartAspects, palette, style);
        }
      } else if (drawAspects) {
        drawAspectLines(draw, center, ringset, asc, chart, palette, drawAspects, style);
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
          typography,
          outerItemsChart,
          palette,
          style,
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
          typography,
          style,
        );
        drawFixstarLines(draw, center, ringset, asc, chart, chartSize, fixedStarLayout, palette, style);
      }
    }

    drawPlanets(
      draw,
      center,
      ringset,
      asc,
      chart,
      bodyShifts,
      labelYoffs,
      palette,
      fontBodySymbols,
      fontUi,
      typography,
      style,
    );
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
        fontBodySymbols,
        fontUi,
        typography,
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
        typography.outerAngleLabelSize,
        style,
      );
    }
    drawTerms(draw, center, ringset, asc, chart, palette, fontTermSymbols, typography.termSize, style);
    drawDecans(draw, center, ringset, asc, chart, palette, fontDecanSymbols, typography.decanSize, style);
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
        typography.aspectGlyphSize,
        typography.aspectGlyphOffset,
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
        bodyShifts,
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
      typography.outerLabelSize,
      typography.outerLayoutUnit,
      typography.outerProjectedGlyphSize,
      typography.outerMotionSize,
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
      typography.outerLabelSize,
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
  textsize?: (text: string, opts?: TextOpts) => Pt;
  clickAspectState?: ClickAspectState;
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
  const maxRadius = chartSize / 2;
  const style = projectWheelAuthoringStyle(
    resolveWheelRenderStyle(opts),
    maxRadius,
    wheelTypographyProfile(chart),
  );
  applyStyleRevision(wheelStyleRevisionKey(style));
  const center: Pt = [Math.floor(width / 2), Math.floor(height / 2)];
  const asc = chart.angles.asc;
  const palette = style.palette as ChartPalette;
  const fontUi = style.typography.families.ui;
  const fontSymbols = style.typography.families.symbols;
  const fontBodySymbols = style.typography.families.bodySymbols;
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
  const hasOuterRing = hasComparison || snapshot.outerRingMode !== "none";
  const showOuterHouseGeometry = comparisonUsesOuterHouses(snapshot, chart);
  const showInterChartAspectFigure = Boolean(
    comparisonChart && (!isAngloWheel(chart) || !showOuterHouseGeometry),
  );
  const ringset: RingSet = hasComparison
    ? comparisonRings(style, chart, maxRadius, showOuterHouseGeometry)
    : effectiveRings(style, chart, maxRadius, hasOuterRing);
  const typography = resolveWheelTypographyMetrics(
    style,
    wheelTypographyProfile(chart),
    maxRadius,
  );
  const symbolSize = typography.bodySize;
  const outerSymbolSize = typography.outerSize;
  const signSize = typography.signSize;
  const hit = style.hit;
  const priorities = hit.priorities;
  const hitRadius = Math.max(hit.bodyRadiusMin, maxRadius / hit.bodyRadiusDivisor);
  const planets = planetById(chart);
  const { bodyShifts } = getBodyLayout(
    measurer,
    chart,
    center,
    asc,
    ringset.rPlanet,
    ringset.rPos,
    ringset.rRetr,
    fontBodySymbols,
    fontUi,
    typography,
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
    const bodyHitPad = Math.max(hit.bodyPadMin, Math.round(baseSize * hit.bodyPadScale));
    const glyphSize = bodyGlyphSize(baseSize);
    const [glyphWidth, glyphHeight] = measurer.textsize(glyph, {
      font: bodyGlyphFont(bodyChart, key, fontBodySymbols, fontUi),
      size: glyphSize,
    });
    return {
      left: x - glyphSize / 2 - bodyHitPad,
      top: y - glyphSize / 2 - bodyHitPad,
      width: Math.max(1, glyphWidth) + bodyHitPad * 2,
      height: Math.max(1, glyphHeight) + bodyHitPad * 2,
    };
  };
  const bodyDiscRadius = (baseSize: number) =>
    Math.max(hit.glyphRadiusMin, baseSize * hit.glyphRadiusScale);
  const primaryLeaderSegments = (longitude: number, shift: number) => {
    const shiftedLongitude = isAngloWheel(chart) ? longitude : longitude + shift;
    const segments = [{
      start: polar(center, ringset.rInner, longitude, asc),
      end: polar(center, ringset.rLLine, shiftedLongitude, asc),
    }];
    if (!isCompactWheel(chart)) {
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
    const [x, y] = polar(center, ringset.rPlanet, planet.longitude + shift, asc);
    const glyph = bodyGlyph(chart, planets, planet.id);
    regions.push({
      kind: "planet",
      planetId: planet.id,
      seId: planet.seId,
      x,
      y,
      r: bodyDiscRadius(symbolSize),
      ...bodyGlyphBox(x, y, chart, planet.id, glyph),
      longitude: planet.longitude,
      latitude: planet.latitude,
      speed: planet.speed,
      house: planet.house,
      dignity: planet.dignity,
      leaderSegments: primaryLeaderSegments(planet.longitude, shift),
      priority: priorities.planet, // graphchart.py:2182
    });
  }

  if (chart.fortune && Number.isFinite(chart.fortune.longitude)) {
    const shift = bodyShifts.get("__fortune") ?? 0;
    const [x, y] = polar(center, ringset.rPlanet, chart.fortune.longitude + shift, asc);
    const glyph = bodyGlyph(chart, planets, "__fortune");
    regions.push({
      kind: "fortune",
      x, y, r: bodyDiscRadius(symbolSize), ...bodyGlyphBox(x, y, chart, "__fortune", glyph), longitude: chart.fortune.longitude,
      leaderSegments: primaryLeaderSegments(chart.fortune.longitude, shift),
      priority: priorities.fortune, // graphchart.py:1943
    });
  }

  if (chart.vertex && Number.isFinite(chart.vertex.longitude)) {
    const shift = bodyShifts.get("__vertex") ?? 0;
    const [x, y] = polar(center, ringset.rPlanet, chart.vertex.longitude + shift, asc);
    const glyph = bodyGlyph(chart, planets, "__vertex");
    regions.push({
      kind: "vertex",
      x, y, r: bodyDiscRadius(symbolSize), ...bodyGlyphBox(x, y, chart, "__vertex", glyph), longitude: chart.vertex.longitude,
      house: chart.vertex.house,
      leaderSegments: primaryLeaderSegments(chart.vertex.longitude, shift),
      // Inner-ring body priority 40 (graphchart.py:2182, `not outer`).
      priority: priorities.planet,
    });
  }

  if (chart.syzygy && Number.isFinite(chart.syzygy.longitude)) {
    const shift = bodyShifts.get("__syzygy") ?? 0;
    const [x, y] = polar(center, ringset.rPlanet, chart.syzygy.longitude + shift, asc);
    const glyph = bodyGlyph(chart, planets, "__syzygy");
    regions.push({
      kind: "syzygy",
      x, y, r: bodyDiscRadius(symbolSize), ...bodyGlyphBox(x, y, chart, "__syzygy", glyph), longitude: chart.syzygy.longitude,
      house: chart.syzygy.house,
      label: chart.syzygy.label,
      leaderSegments: primaryLeaderSegments(chart.syzygy.longitude, shift),
      priority: priorities.planet,
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
      fontBodySymbols,
      fontUi,
      typography,
      style,
      isAngloWheel(comparisonChart),
      false,
      true,
      showOuterHouseGeometry,
      true,
    );
    outerBodyShiftsForHits = outerBodyShifts;
    const outerLeaderSegments = (longitude: number, shift: number) => [{
      start: polar(center, ringset.r30, longitude, asc),
      end: polar(
        center,
        ringset.rOuterLine,
        isAngloWheel(comparisonChart) ? longitude : longitude + shift,
        asc,
      ),
    }];
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
        r: bodyDiscRadius(outerSymbolSize),
        ...bodyGlyphBox(x, y, comparisonChart, planet.id, glyph, outerSymbolSize),
        longitude: planet.longitude,
        latitude: planet.latitude,
        speed: planet.speed,
        house: planet.house,
        dignity: planet.dignity,
        chartRole: "outer",
        leaderSegments: outerLeaderSegments(planet.longitude, shift),
        priority: priorities.outerBody, // graphchart.py:2182 (`outer`)
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
        r: bodyDiscRadius(outerSymbolSize),
        ...bodyGlyphBox(x, y, comparisonChart, "__fortune", glyph, outerSymbolSize),
        longitude: comparisonChart.fortune.longitude,
        chartRole: "outer",
        leaderSegments: outerLeaderSegments(comparisonChart.fortune.longitude, shift),
        priority: priorities.outerBody,
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
        r: bodyDiscRadius(outerSymbolSize),
        ...bodyGlyphBox(x, y, comparisonChart, "__vertex", glyph, outerSymbolSize),
        longitude: comparisonChart.vertex.longitude,
        house: comparisonChart.vertex.house,
        chartRole: "outer",
        leaderSegments: outerLeaderSegments(comparisonChart.vertex.longitude, shift),
        priority: priorities.outerBody,
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
        r: bodyDiscRadius(outerSymbolSize),
        ...bodyGlyphBox(x, y, comparisonChart, "__syzygy", glyph, outerSymbolSize),
        longitude: comparisonChart.syzygy.longitude,
        house: comparisonChart.syzygy.house,
        label: comparisonChart.syzygy.label,
        chartRole: "outer",
        leaderSegments: outerLeaderSegments(comparisonChart.syzygy.longitude, shift),
        priority: priorities.outerBody,
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
        const labelSize = layoutGlyphSize(
          layoutKey,
          typography.bodySize,
          typography.angleLabelSize,
        );
        const [labelWidth, labelHeight] = measurer.textsize(label, {
          font: fontUi,
          size: labelSize,
          weight: style.typography.ratios.angleLabelWeight,
        });
        const pad = Math.max(
          hit.angleLabelPadMin,
          typography.layoutUnit * hit.angleLabelPadScale,
        );
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
          priority: priorities.angloAngle,
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
          priority: priorities.angloAngle,
        });
      }
      continue;
    }
    // wx graphchart.drawAscMC registers the hover at the visible angle-line tip
    // (x2/y2, graphchart.py:1866-1877), not at the inner/base radius.
    const [x, y] = polar(center, ringset.rASCMC, lon, asc);
    regions.push({
      kind: "angle",
      angleId,
      x,
      y,
      r: hitRadius,
      longitude: lon,
      priority: priorities.angle,
    });
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
        const labelSize = layoutGlyphSize(
          layoutKey,
          typography.outerSize,
          typography.outerAngleLabelSize,
        );
        const [labelWidth, labelHeight] = measurer.textsize(label, {
          font: fontUi,
          size: labelSize,
          weight: style.typography.ratios.angleLabelWeight,
        });
        const pad = Math.max(
          hit.angleLabelPadMin,
          typography.outerLayoutUnit * hit.angleLabelPadScale,
        );
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
          priority: priorities.angloAngle,
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
    const subdivisionSize = family === "term" ? typography.termSize : typography.decanSize;
    const subdivisionFont = family === "term" ? fontTermSymbols : fontDecanSymbols;
    const point = polar(center, radius, longitude, asc);
    const [width, height] = measurer.textsize(glyph, {
      font: subdivisionFont,
      size: subdivisionSize,
    });
    const pad = Math.max(2, subdivisionSize * 0.12);
    regions.push({
      kind: "subdivision",
      family,
      component: "glyph",
      itemId,
      glyph,
      x: point[0],
      y: point[1],
      r: Math.max(width, height, subdivisionSize) / 2 + pad,
      left: point[0] - subdivisionSize / 2 - pad,
      top: point[1] - subdivisionSize / 2 - pad,
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
      }, style);
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
      ringset.rAntis ?? labelRadius,
      fontUi,
      fontSymbols,
      typography.outerLabelSize,
      typography.outerLayoutUnit,
      typography.outerProjectedGlyphSize,
      outerItemsChart,
      palette,
      style,
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
      const itemFontSize = outerRingItemFontSize(
        item,
        typography.outerProjectedGlyphSize,
        typography.outerLabelSize,
      );
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
      const pad = Math.max(
        hit.outerLabelPadMin,
        Math.round(itemFontSize * hit.outerLabelPadScale),
      );
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
        leader: {
          start: polar(center, ringset.r30, item.longitude, asc),
          end: polar(
            center,
            PROJECTED_GLYPH_FAMILIES.has(item.family)
              ? ringset.rAntisLines ?? ringset.rOuterLine
              : ringset.rOuterLine,
            item.longitude + outerItemLayout.shifts[i],
            asc,
          ),
        },
        priority: priorities.secondaryRing,
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
    if (region.styleOnly) continue;
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

function chartFontKey(fontText?: string, fontSymbols?: string): string {
  const text = (fontText || DEFAULT_MORINUS_TEXT_FONT).replace(/\s+/g, " ").trim();
  const symbols = (fontSymbols || '"AriesMorinus"').replace(/\s+/g, " ").trim();
  return `${text}\u0000${symbols}`;
}

export function chartFontsAreReady(fontText?: string, fontSymbols?: string): boolean {
  return loadedChartFontKeys.has(chartFontKey(fontText, fontSymbols));
}

export function warmChartFonts(fontText?: string, fontSymbols?: string): void {
  void awaitFonts(fontText, fontSymbols);
}

export async function awaitFonts(fontText?: string, fontSymbols?: string): Promise<void> {
  const key = chartFontKey(fontText, fontSymbols);
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
  const [textFont, symbolFont] = key.split("\u0000");
  const pending = pendingChartFontLoads.get(key);
  if (pending) {
    await pending;
    return;
  }
  const loadPromise = Promise.allSettled([
    document.fonts.load(`32px ${symbolFont || '"AriesMorinus"'}`),
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
