// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris plate geometry and the shared paint primitives (crisp
// device-pixel rules, text). Pure: everything derives from the canvas size,
// the display mode, the longitude modulus and the resolved render style.
//
// The instrument plate, top to bottom inside one outer frame: header band,
// top wrap band, plot, bottom wrap band, time axis. Left to right: the scale
// table, the start-label gutter, the plot, the degree ruler.

import type { EphemerisRenderStyle } from "./ephemeris-render-style";
import type { EphemerisModulus } from "./ephemeris-scene";

export type EphemerisDisplayMode = "longitude" | "declination";

export const SIGN_NUM = 12;
export const DECLINATION_LIMIT = 30.0; // GraphEphemWnd.DECLINATION_LIMIT
export const MOON_ID = 1; // astrology.SE_MOON
export const HALF_SYNODIC_MONTH_DAYS = 29.530589 / 2;
export const EPHEMERIS_MODULI: readonly EphemerisModulus[] = [360, 90, 45, 30];

export type EphemerisGeometry = Readonly<{
  w: number;
  h: number;
  /** Plate unit: the planet glyph size; tick lengths key to it. */
  border: number;
  spaceSize: number;
  planetFontPx: number;
  /** Sign glyphs of the 360° table. */
  signFontPx: number;
  headerFontPx: number;
  /** Month names on the time axis. */
  txtFontPx: number;
  /** Day numbers on the time axis, figures on the degree ruler. */
  rulerFontPx: number;
  tableFontPx: number;
  modalityGlyphPx: number;
  edgeSignFontPx: number;
  startSignFontPx: number;
  stationFontPx: number;
  modulus: EphemerisModulus;
  outer: number; // plate frame inset from the canvas edge
  plateRight: number;
  plateBottom: number;
  headerBottom: number; // rule under the header band
  /** Table, gutter and labels on the right, degree ruler on the left. */
  mirrored: boolean;
  tableLeft: number;
  tableRight: number;
  /** The table's edge facing the plot. */
  tableInner: number;
  gutterX: number; // planet labels begin here
  xOrig: number; // plot origin (camera start)
  plotRight: number;
  /** The plot edge the degree ruler grows out of, and its direction. */
  rulerInner: number;
  rulerDir: 1 | -1;
  /** Declination: the decan limb on each side of the plot (0 in longitude),
   * the figure column beside the table's limb, and the sign-band column
   * at the table's frame side (0 when hidden). */
  limbWidth: number;
  declFigureWidth: number;
  declSignWidth: number;
  /** Radix layer: the column of natal labels beyond the degree ruler
   * (right edge, or left when mirrored); equal edges when absent. */
  radixColumnLeft: number;
  radixColumnRight: number;
  yTop: number;
  yBottom: number;
  plotHeight: number;
  rulerY: number; // time-axis baseline: bottom rule of the bottom wrap band
  plotWidth: number;
  frameW: number; // plot top/bottom rules
  tickMajor: number;
  tickMedium: number;
  tickMinor: number;
  tickFine: number;
}>;

export type TextMeasure = (text: string, sizePx: number, font?: string) => number;

function positive(value: number, fallback: number): number {
  return value > 0 ? value : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** The glyphs the table header and the start labels draw, so their columns
 * hug what is painted; without them a glyph is taken as one em wide. */
export type EphemerisLabelGlyphs = Readonly<{ planets: readonly string[]; signs: readonly string[] }>;

export function computeEphemerisGeometry(
  w: number,
  h: number,
  mode: EphemerisDisplayMode,
  measure: TextMeasure,
  style: EphemerisRenderStyle,
  modulus: EphemerisModulus = 360,
  mirrored = false,
  declinationSignBands = false,
  radixColumn = false,
  glyphs?: EphemerisLabelGlyphs,
): EphemerisGeometry {
  const layout = style.layout;
  const type = style.typography;
  const strokes = style.strokes;
  const ruler = style.ruler;
  const tableSize = Math.min(w, h);
  const u = clamp(
    tableSize / positive(type.planetFontDivisor, 48),
    Math.min(type.planetFontMin, type.planetFontMax),
    Math.max(type.planetFontMin, type.planetFontMax),
  );
  const spaceSize = u / positive(layout.spaceDivisor, 3);
  const txtFontPx = u * type.textFontScale;
  const tableFontPx = u * type.tableFontScale;
  const tickLength = (scale: number) => Math.max(ruler.tickMin, u * scale);

  const outer = u * layout.plateInsetScale;
  const plateRight = w - outer;
  const plateBottom = h - outer;
  const headerBottom = outer + u * layout.headerBandScale;
  // Wrap bands carry longitude's crossing labels; declination has no wraps,
  // so its plot runs from the header rule to the time axis.
  const wrapBand = mode === "declination" ? 0 : u * layout.wrapBandScale;
  const yTop = headerBottom + wrapBand;
  const rulerY = plateBottom - u * layout.timeBandScale;
  const yBottom = rulerY - wrapBand;

  // Scale table: sign glyphs (360°), plain degrees (30°), three modality
  // columns (90°/45°) — never narrower than its widest entry — or, in
  // declination, [sign bands] + signed figures + the decan limb.
  const harmonic = mode === "longitude" && (modulus === 90 || modulus === 45);
  const pad = spaceSize * 2;
  const declination = mode === "declination";
  const limbWidth = declination ? spaceSize * layout.limbWidthSpaces : 0;
  const declFigureWidth = declination ? Math.max(measure("+30", tableFontPx), measure("-30", tableFontPx)) + pad * 2.5 : 0;
  const declSignWidth = declination && declinationSignBands ? u * type.modalityGlyphScale * 2.2 + pad : 0;
  const symbolWidth = (text: string, sizePx: number, glyphCount: number) =>
    glyphs ? measure(text, sizePx, style.typography.fontSymbols) : glyphCount * sizePx;
  // 90°/45°: three columns, each its two-digit figures plus cell padding,
  // never narrower than the sign-glyph pairs heading it.
  const modalityColumn = harmonic
    ? Math.max(
        measure("29", tableFontPx) + spaceSize * layout.modalityCellPadSpaces,
        ...[0, 1, 2, 6, 7, 8].map(
          (q) => symbolWidth(`${glyphs?.signs[q] ?? ""}${glyphs?.signs[q + 3] ?? ""}`, u * type.modalityGlyphScale, 2) + spaceSize,
        ),
      )
    : 0;
  const tableWidth = declination
    ? declSignWidth + declFigureWidth + limbWidth
    : harmonic
      ? 3 * modalityColumn
      : u * layout.signTableScale;
  // Start labels: the widest planet glyph, or the sign beside it at its
  // offset (longitude only), with the padding on each side.
  const widestOf = (texts: readonly string[] | undefined, sizePx: number) =>
    texts && texts.length ? Math.max(...texts.map((text) => symbolWidth(text, sizePx, 1))) : sizePx;
  const startPair = Math.max(
    widestOf(glyphs?.planets, u),
    mode === "longitude" ? u * style.labels.startSignOffsetScale + widestOf(glyphs?.signs, u * type.startSignFontScale) : 0,
  );
  const gutterPad = spaceSize * layout.startGutterPadSpaces;
  const gutterWidth = startPair + 2 * gutterPad;
  const rulerWidth = Math.max(u * layout.degreeRulerScale, measure("45", u * ruler.labelScale) + tickLength(ruler.majorTickScale) + pad);
  // Normal: table | gutter | plot | ruler [| radix]. Mirrored: [radix |]
  // ruler | plot | gutter | table, so each planet's label leads its curve at
  // the latest date shown and the radix labels sit beyond the ruler.
  const radixWidth = radixColumn && mode === "longitude" ? u * style.radix.radixColumnScale : 0;
  const tableLeft = mirrored ? plateRight - tableWidth : outer;
  const tableRight = tableLeft + tableWidth;
  const xOrig = mirrored ? outer + radixWidth + rulerWidth : tableRight + gutterWidth;
  const plotRight = Math.max(xOrig, mirrored ? tableLeft - gutterWidth : plateRight - radixWidth - rulerWidth);
  const radixColumnLeft = mirrored ? outer : plateRight - radixWidth;

  const frameW =
    tableSize <= strokes.frameSmallMax
      ? strokes.frameWidthSmall
      : tableSize <= strokes.frameMediumMax
        ? strokes.frameWidthMedium
        : strokes.frameWidthLarge;

  return {
    w,
    h,
    border: u,
    spaceSize,
    planetFontPx: u,
    signFontPx: u * type.signFontScale,
    headerFontPx: u * type.headerFontScale,
    txtFontPx,
    rulerFontPx: txtFontPx * ruler.labelScale,
    tableFontPx,
    modalityGlyphPx: u * type.modalityGlyphScale,
    edgeSignFontPx: u * type.edgeSignFontScale,
    startSignFontPx: u * type.startSignFontScale,
    stationFontPx: u * type.stationFontScale,
    modulus: mode === "declination" ? 360 : modulus,
    outer,
    plateRight,
    plateBottom,
    headerBottom,
    mirrored,
    tableLeft,
    tableRight,
    tableInner: mirrored ? tableLeft : tableRight,
    gutterX: (mirrored ? plotRight : tableRight) + gutterPad,
    xOrig,
    plotRight,
    rulerInner: mirrored ? xOrig : plotRight,
    rulerDir: mirrored ? -1 : 1,
    limbWidth,
    declFigureWidth,
    declSignWidth,
    radixColumnLeft,
    radixColumnRight: radixColumnLeft + radixWidth,
    yTop,
    yBottom,
    plotHeight: Math.max(0, yBottom - yTop),
    rulerY,
    plotWidth: Math.max(0, plotRight - xOrig),
    frameW,
    tickMajor: tickLength(ruler.majorTickScale),
    tickMedium: tickLength(ruler.mediumTickScale),
    tickMinor: tickLength(ruler.minorTickScale),
    tickFine: tickLength(ruler.fineTickScale),
  };
}

export function norm360(v: number): number {
  let x = v % 360;
  if (x < 0) x += 360;
  return x;
}

/** Longitude folded into the modulus: [0, M). */
export function modulusValue(value: number, modulus: number): number {
  let x = norm360(value) % modulus;
  if (x < 0) x += modulus;
  return x;
}

/** Plot y of a value: declination ±30° bottom to top; longitude folded into
 * the modulus, 0 on the top rule and increasing downward like a printed
 * plate, so direct motion descends. */
export function mapEphemerisY(
  geo: EphemerisGeometry,
  mode: EphemerisDisplayMode,
  value: number,
  modulus: number = geo.modulus,
): number {
  if (mode === "declination") {
    return geo.yBottom - ((value + DECLINATION_LIMIT) * geo.plotHeight) / (2 * DECLINATION_LIMIT);
  }
  return geo.yTop + (modulusValue(value, modulus) / modulus) * geo.plotHeight;
}

/** Inverse of mapEphemerisY: declination, or the value within [0, M). */
export function valueAtEphemerisY(
  geo: EphemerisGeometry,
  mode: EphemerisDisplayMode,
  y: number,
  modulus: number = geo.modulus,
): number {
  if (geo.plotHeight <= 0) return 0;
  if (mode === "declination") {
    return ((geo.yBottom - y) * (2 * DECLINATION_LIMIT)) / geo.plotHeight - DECLINATION_LIMIT;
  }
  return ((y - geo.yTop) * modulus) / geo.plotHeight;
}

export type SegmentBreak = Readonly<{
  /** Fraction along the sample step, in (0, 1]. */
  t: number;
  /** The boundary value crossed (unwrapped longitude). */
  value: number;
  /** A multiple of the modulus: the curve leaves at one edge, re-enters at the other. */
  wrap: boolean;
  /** A multiple of 30°: a sign ingress. */
  ingress: boolean;
}>;

/** Every boundary a longitude step from `from` by `delta` (shortest way,
 * |delta| < 180) crosses, in travel order: multiples of `modulus` (wraps)
 * and, with `ingresses`, multiples of 30° (sign changes). Several per step
 * are normal for the Moon at small moduli. Intervals are half-open the way
 * the fold is: a multiple belongs to the band below it, so direct motion
 * crosses b when from < b <= to and retrograde motion when to < b <= from. */
export function forEachSegmentBreak(
  from: number,
  delta: number,
  modulus: number,
  ingresses: boolean,
  visit: (t: number, value: number, wrap: boolean, ingress: boolean) => void,
): void {
  if (delta === 0 || !Number.isFinite(delta)) return;
  const to = from + delta;
  const step = ingresses ? gcdStep(modulus) : modulus;
  const emit = (value: number) => {
    const wrap = isMultiple(value, modulus);
    const ingress = ingresses && isMultiple(value, 30);
    if (wrap || ingress) visit(clamp((value - from) / delta, 0, 1), value, wrap, ingress);
  };
  if (delta > 0) {
    for (let k = Math.floor(from / step + BREAK_EPS) + 1; k * step <= to + BREAK_EPS; k++) emit(k * step);
  } else {
    for (let k = Math.floor(from / step + BREAK_EPS); k * step > to + BREAK_EPS; k--) emit(k * step);
  }
}

const BREAK_EPS = 1e-9;

/** Whether a step crosses a multiple of `modulus` (same half-open rule). */
export function crossesMultiple(from: number, delta: number, modulus: number): boolean {
  if (delta === 0 || !Number.isFinite(delta)) return false;
  const k = Math.floor(from / modulus + BREAK_EPS);
  return delta > 0 ? (k + 1) * modulus <= from + delta + BREAK_EPS : k * modulus > from + delta + BREAK_EPS;
}

function gcdStep(modulus: number): number {
  let a = Math.round(modulus);
  let b = 30;
  while (b) [a, b] = [b, a % b];
  return a || 30;
}

function isMultiple(value: number, step: number): boolean {
  return Math.abs(value / step - Math.round(value / step)) < BREAK_EPS;
}

/** Shortest signed longitude step from a to b, in (-180, 180]. */
export function longitudeDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Sign index 0..11 of a longitude. */
export function signOf(value: number): number {
  return Math.min(11, Math.floor(norm360(value) / 30));
}

/** Left-table rows for 90°/45°: the sign degrees of each modality (cardinal,
 * fixed, mutable) that fold onto plotted degree `degree`. */
export function modalityDegrees(degree: number, modulus: number): [number[], number[], number[]] {
  const out: [number[], number[], number[]] = [[], [], []];
  for (let lon = degree; lon < 360; lon += modulus) {
    const sign = Math.floor(lon / 30);
    const quality = sign % 3;
    const deg = Math.round(lon - sign * 30);
    if (!out[quality].includes(deg)) out[quality].push(deg);
  }
  return out;
}

/** Row step (degrees) of the modality table so figures never collide. */
export function modalityRowStep(modulus: number, plotHeight: number, fontPx: number): number {
  const pxPerDegree = plotHeight / modulus;
  for (const step of [1, 2, 3, 5, 6, 9, 10, 15]) {
    if (modulus % step === 0 && pxPerDegree * step >= fontPx * 1.2) return step;
  }
  return 15;
}

export function eventGlyphSize(geo: EphemerisGeometry, style: EphemerisRenderStyle): number {
  const markers = style.markers;
  return clamp(geo.edgeSignFontPx * markers.eventGlyphScale, markers.eventGlyphMin, markers.eventGlyphMax);
}

export function lunationDiscRadius(geo: EphemerisGeometry, style: EphemerisRenderStyle): number {
  const markers = style.markers;
  return clamp(geo.border * markers.lunationDiscScale, markers.lunationDiscMin, markers.lunationDiscMax);
}

/** Lunation discs hide while neighbouring syzygies would touch. (The plates'
 * dotted verticals are month lines — the grid — never lunations.) */
export function lunationVisibility(geo: EphemerisGeometry, style: EphemerisRenderStyle, pxPerDay: number): boolean {
  const pxPerSyzygy = pxPerDay * HALF_SYNODIC_MONTH_DAYS;
  return pxPerSyzygy >= lunationDiscRadius(geo, style) * 2 + style.ruler.tickMinSpacing;
}

/** Place an axis-aligned stroke so its width covers whole device pixels. */
export function crispAt(value: number, width: number, dpr: number): number {
  const devicePixels = Math.max(1, Math.round(width * dpr));
  return devicePixels % 2 === 1 ? (Math.floor(value * dpr) + 0.5) / dpr : Math.round(value * dpr) / dpr;
}

export type RuleLevel = "major" | "medium" | "minor" | "fine";

export function tickLength(geo: EphemerisGeometry, level: RuleLevel): number {
  if (level === "major") return geo.tickMajor;
  if (level === "medium") return geo.tickMedium;
  if (level === "minor") return geo.tickMinor;
  return geo.tickFine;
}

export function tickWidth(style: EphemerisRenderStyle, level: RuleLevel): number {
  return level === "major" || level === "medium" ? style.strokes.tickWidth : style.strokes.minorTickWidth;
}

/** [x1, x2, y] (horizontal) or [x, y1, y2] (vertical). */
export type TickSegment = readonly [number, number, number];

/** Plate rules on a raw 2D context: crisp hairline frames, band rules, ticks. */
export class PlateRules {
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly color: string,
    private readonly dpr: number,
  ) {}

  private device(value: number): number {
    return Math.round(value * this.dpr) / this.dpr;
  }

  private stroke(width: number, color: string, dash: number[] | undefined, path: () => void) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.25, width);
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    path();
    ctx.stroke();
    ctx.restore();
  }

  horizontal(x1: number, x2: number, y: number, width: number, dash?: number[], color = this.color) {
    if (width <= 0) return;
    const cy = crispAt(y, width, this.dpr);
    this.stroke(width, color, dash, () => {
      this.ctx.moveTo(this.device(x1), cy);
      this.ctx.lineTo(this.device(x2), cy);
    });
  }

  vertical(x: number, y1: number, y2: number, width: number, dash?: number[], color = this.color) {
    if (width <= 0) return;
    const cx = crispAt(x, width, this.dpr);
    this.stroke(width, color, dash, () => {
      this.ctx.moveTo(cx, this.device(y1));
      this.ctx.lineTo(cx, this.device(y2));
    });
  }

  /** Many same-width verticals (lunation lines, grid) in one path. */
  verticals(xs: readonly number[], y1: number, y2: number, width: number, dash?: number[], color = this.color) {
    if (width <= 0 || xs.length === 0) return;
    const top = this.device(y1);
    const bottom = this.device(y2);
    this.stroke(width, color, dash, () => {
      for (const x of xs) {
        const cx = crispAt(x, width, this.dpr);
        this.ctx.moveTo(cx, top);
        this.ctx.lineTo(cx, bottom);
      }
    });
  }

  ticks(segments: readonly TickSegment[], width: number, orientation: "horizontal" | "vertical") {
    if (width <= 0 || segments.length === 0) return;
    this.stroke(width, this.color, undefined, () => {
      for (const [a, b, c] of segments) {
        if (orientation === "horizontal") {
          const y = crispAt(c, width, this.dpr);
          this.ctx.moveTo(this.device(a), y);
          this.ctx.lineTo(this.device(b), y);
        } else {
          const x = crispAt(a, width, this.dpr);
          this.ctx.moveTo(x, this.device(b));
          this.ctx.lineTo(x, this.device(c));
        }
      }
    });
  }

  rect(x0: number, y0: number, x1: number, y1: number, width: number) {
    if (width <= 0) return;
    const left = crispAt(x0, width, this.dpr);
    const top = crispAt(y0, width, this.dpr);
    const right = crispAt(x1, width, this.dpr);
    const bottom = crispAt(y1, width, this.dpr);
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = width;
    ctx.lineJoin = "miter";
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.restore();
  }
}

/** Collect ticks per stroke width so each ruler paints in one or two paths. */
export class TickBuckets {
  private readonly byWidth = new Map<number, TickSegment[]>();

  constructor(private readonly style: EphemerisRenderStyle) {}

  add(level: RuleLevel, segment: TickSegment) {
    const width = tickWidth(this.style, level);
    const bucket = this.byWidth.get(width);
    if (bucket) bucket.push(segment);
    else this.byWidth.set(width, [segment]);
  }

  stroke(rules: PlateRules, orientation: "horizontal" | "vertical") {
    for (const [width, segments] of this.byWidth) rules.ticks(segments, width, orientation);
  }
}

export type TextPaint = Readonly<{
  size: number;
  fill: string;
  font?: string;
  weight?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
}>;

/** Text painter matching CanvasDraw.text: integer px font size, the plate's
 * UI font by default, origin snapped to `snapScale` pixels per CSS px (1 for
 * static chrome, the device ratio for anything that moves with the camera). */
export class PlateText {
  private lastFont = "";

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly defaultFont: string,
    private readonly snapScale: number,
  ) {}

  static fontSpec(size: number, family: string, weight = 400): string {
    return `normal ${weight} ${Math.max(1, Math.round(size))}px ${family}`;
  }

  draw(x: number, y: number, text: string, paint: TextPaint) {
    if (!text) return;
    const ctx = this.ctx;
    const font = PlateText.fontSpec(paint.size, paint.font ?? this.defaultFont, paint.weight);
    if (font !== this.lastFont || ctx.font !== font) {
      ctx.font = font;
      this.lastFont = font;
    }
    ctx.fillStyle = paint.fill;
    ctx.textAlign = paint.align ?? "left";
    ctx.textBaseline = paint.baseline ?? "top";
    const s = this.snapScale;
    ctx.fillText(text, Math.round(x * s) / s, Math.round(y * s) / s);
  }
}

/** Cached text widths (CanvasDraw.textsize twin: rounded advance width). */
export function createTextMeasure(ctx: CanvasRenderingContext2D, defaultFont: string): TextMeasure {
  const cache = new Map<string, number>();
  return (text, sizePx, font) => {
    const spec = PlateText.fontSpec(sizePx, font ?? defaultFont);
    const key = `${spec}\n${text}`;
    const cached = cache.get(key);
    if (cached != null) return cached;
    ctx.save();
    ctx.font = spec;
    const width = Math.round(ctx.measureText(text).width);
    ctx.restore();
    if (cache.size > 512) cache.clear();
    cache.set(key, width);
    return width;
  };
}
