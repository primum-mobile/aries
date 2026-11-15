// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Moving plate layer, repainted every camera frame: the header line, month
// guides, decimated curves folded into the longitude modulus (split into
// colour runs at sign ingresses when coloured by dignity), sign-event glyphs,
// station letters, lunation discs, out-of-bounds markers, the plot rules over
// the curve ends, the time axis, the edge labels where a curve leaves and
// re-enters the plot, and the start labels at the camera's left edge.
// Pure: (surface, geometry, camera, resident blocks, scene, style) -> pixels.
// Missing blocks are simply not drawn.

import type { EphemerisCamera } from "./ephemeris-camera";
import { DecimatedPath, type PathSink } from "./ephemeris-decimate";
import type { EphemerisFrameData } from "./ephemeris-block-store";
import {
  clamp,
  crossesMultiple,
  DECLINATION_LIMIT,
  eventGlyphSize,
  forEachSegmentBreak,
  longitudeDelta,
  lunationDiscRadius,
  lunationVisibility,
  mapEphemerisY,
  MOON_ID,
  norm360,
  PlateRules,
  PlateText,
  signOf,
  SIGN_NUM,
  tickLength,
  TickBuckets,
  type EphemerisDisplayMode,
  type EphemerisGeometry,
  type TextMeasure,
} from "./ephemeris-geometry";
import { ephemerisInkTable, ephemerisPaintOrder } from "./ephemeris-ink";
import type { EphemerisRenderStyle } from "./ephemeris-render-style";
import type { EphemerisScene, EphemerisScenePlanet, EphemerisSurface } from "./ephemeris-scene";
import { buildTimeRuler } from "./ephemeris-time-ticks";
import type { EphemerisBlock } from "./ephemeris-wire";

export type EphemerisPlotStats = { curvePoints: number; samples: number };

/** The modulus the plot folds longitude into (declination ignores it). */
export function sceneModulus(scene: Pick<EphemerisScene, "mode" | "modulus">): number {
  return scene.mode === "declination" ? 360 : scene.modulus || 360;
}

/** Sample of `planetId` at `jd`, linearly interpolated between the daily
 * samples (shortest way round in longitude); null when not resident. */
export function ephemerisValueAt(
  blocks: readonly EphemerisBlock[],
  planetId: number,
  mode: EphemerisDisplayMode,
  jd: number,
): number | null {
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b];
    if (jd < block.startJd || jd >= block.startJd + block.days) continue;
    const row = block.rows.get(planetId)?.[mode];
    if (!row) return null;
    const t = jd - block.startJd;
    const i = Math.min(row.length - 1, Math.floor(t));
    const v0 = row[i];
    if (!Number.isFinite(v0)) return null;
    let v1 = i + 1 < row.length ? row[i + 1] : Number.NaN;
    if (i + 1 >= row.length) {
      const next = blocks[b + 1];
      if (next && next.monthIndex === block.monthIndex + 1) v1 = next.rows.get(planetId)?.[mode][0] ?? Number.NaN;
    }
    const frac = t - i;
    if (!Number.isFinite(v1) || frac === 0) return v0;
    if (mode === "declination") return v0 + (v1 - v0) * frac;
    return norm360(v0 + longitudeDelta(v0, v1) * frac);
  }
  return null;
}

/** Keep sorted labels at least `gap` apart and inside [lo, hi], order kept. */
function packWithin(items: Array<{ y: number }>, lo: number, hi: number, gap: number) {
  items.sort((a, b) => a.y - b.y);
  for (let i = 0; i < items.length; i++) {
    items[i].y = Math.max(items[i].y, i === 0 ? lo : items[i - 1].y + gap);
  }
  for (let i = items.length - 1; i >= 0; i--) {
    items[i].y = Math.min(items[i].y, i === items.length - 1 ? hi : items[i + 1].y - gap);
  }
}

export type EphemerisStartLabel = {
  planetId: number;
  /** Placed (de-collided) centre. */
  y: number;
  /** The curve's own y at the camera's left edge. */
  anchorY: number;
  glyph: string;
  /** Sign index of the planet's longitude there. */
  sign: number;
};

/** The moment the planet labels name: the camera's left edge, or its right
 * edge on a mirrored plate, where each label leads its curve like a comet's
 * head with the past trailing behind it. */
export function ephemerisLabelJd(geo: EphemerisGeometry, camera: Readonly<{ startJd: number; spanDays: number }>): number {
  return geo.mirrored ? camera.startJd + camera.spanDays : camera.startJd;
}

/** The moment under the reading line: the camera centre, which is the
 * document's current moment (the daemon centres the camera on the cursor). */
export function ephemerisNowLineJd(camera: Readonly<{ startJd: number; spanDays: number }>): number {
  return camera.startJd + camera.spanDays / 2;
}

/** Plot x of the reading line (fixed: the plate slides under it). */
export function ephemerisNowLineX(geo: EphemerisGeometry): number {
  return geo.xOrig + geo.plotWidth / 2;
}

/** The reading line: a signal hairline through the plot and the bottom wrap
 * band down to the time axis. */
function paintNowLine(ctx: CanvasRenderingContext2D, dpr: number, geo: EphemerisGeometry, style: EphemerisRenderStyle) {
  ctx.save();
  ctx.globalAlpha = style.now.nowLineOpacity;
  new PlateRules(ctx, style.colors.accent, dpr).vertical(ephemerisNowLineX(geo), geo.yTop, geo.rulerY + geo.tickMajor, style.now.nowLineWidth);
  ctx.restore();
}

/** The reading line's date on the time axis: a paper tag over the month
 * labels, its text in the signal colour, kept inside the plot's width. */
function paintNowLineTag(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  geo: EphemerisGeometry,
  style: EphemerisRenderStyle,
  label: string,
  measure: TextMeasure,
) {
  if (!label) return;
  const size = geo.txtFontPx;
  const pad = geo.spaceSize * style.now.nowTagPadScale * 2;
  const width = measure(label, size) + pad * 2;
  const top = geo.rulerY + geo.tickMajor + style.labels.labelYGapSpaces * geo.spaceSize - pad / 2;
  const height = size * 1.15 + pad;
  const center = clamp(ephemerisNowLineX(geo), geo.xOrig + width / 2, Math.max(geo.xOrig + width / 2, geo.plotRight - width / 2));
  const snap = (value: number) => Math.round(value * dpr) / dpr;
  ctx.save();
  ctx.fillStyle = style.colors.paper;
  ctx.fillRect(snap(center - width / 2), snap(top), snap(width), snap(height));
  ctx.restore();
  new PlateText(ctx, style.typography.fontUi, 1).draw(center, top + pad / 2, label, {
    size,
    fill: style.colors.accent,
    align: "center",
    baseline: "top",
  });
}

/** Planet glyph + sign at each curve's y at the labelled edge, in the gutter
 * between the table and the plot, pushed apart vertically: the painter draws
 * these and the body hit test reads the same layout. */
export function ephemerisStartLabels(
  geo: EphemerisGeometry,
  style: EphemerisRenderStyle,
  data: EphemerisFrameData,
  scene: EphemerisScene,
  startJd: number,
): { labels: EphemerisStartLabel[]; x: number; signX: number } {
  const modulus = sceneModulus(scene);
  const labels: EphemerisStartLabel[] = [];
  for (const planet of scene.planets) {
    if (!scene.visible[planet.id]) continue;
    const value = ephemerisValueAt(data.blocks, planet.id, scene.mode, startJd);
    if (value == null) continue;
    const longitude = scene.mode === "longitude" ? value : ephemerisValueAt(data.blocks, planet.id, "longitude", startJd);
    const y = mapEphemerisY(geo, scene.mode, value, modulus);
    labels.push({ planetId: planet.id, y, anchorY: y, glyph: planet.glyph, sign: signOf(longitude ?? 0) });
  }
  const gap = geo.planetFontPx * style.labels.startLabelGapScale;
  packWithin(labels, geo.yTop + gap / 2, geo.yBottom - gap / 2, gap);
  return { labels, x: geo.gutterX, signX: geo.gutterX + geo.planetFontPx * style.labels.startSignOffsetScale };
}

type EdgeLabel = { x: number; px: number; planetId: number; sign: number };

/** mockup placeRow: left to right, each label at least `gap` after the last;
 * one pushed further than `maxShift` from its crossing is dropped. */
export function placeEdgeLabels<T extends { x: number; px: number }>(list: T[], gap: number, maxShift: number, lo: number, hi: number): T[] {
  list.sort((a, b) => a.x - b.x);
  const placed: T[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const label of list) {
    const px = Math.max(label.x, last + gap);
    if (px - label.x > maxShift || px < lo || px > hi) continue;
    label.px = px;
    last = px;
    placed.push(label);
  }
  return placed;
}

/** Reusable path command buffer (move/line + x, y), one per colour run, so a
 * curve is walked once and each colour still strokes as one path. Pooled
 * across frames: no per-frame allocation once warm. */
class PathBuffer implements PathSink {
  data = new Float64Array(3 * 1024);
  length = 0;

  reset() {
    this.length = 0;
  }

  private push(op: number, x: number, y: number) {
    if (this.length + 3 > this.data.length) {
      const grown = new Float64Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = op;
    this.data[this.length++] = x;
    this.data[this.length++] = y;
  }

  moveTo(x: number, y: number) {
    this.push(0, x, y);
  }

  lineTo(x: number, y: number) {
    this.push(1, x, y);
  }

  replay(sink: PathSink) {
    const d = this.data;
    for (let i = 0; i < this.length; i += 3) {
      if (d[i] === 0) sink.moveTo(d[i + 1], d[i + 2]);
      else sink.lineTo(d[i + 1], d[i + 2]);
    }
  }
}

const pathBufferPool: PathBuffer[] = [];

function pooledBuffer(index: number): PathBuffer {
  let buffer = pathBufferPool[index];
  if (!buffer) {
    buffer = new PathBuffer();
    pathBufferPool[index] = buffer;
  }
  buffer.reset();
  return buffer;
}

/** One walk of a planet's daily samples: folds longitude into the modulus,
 * breaks at wraps (and at sign ingresses while coloured by sign) and sends
 * each piece to the decimated path of its colour run. */
class CurveWalker {
  private current = -1;
  private x0 = 0;
  private x1 = 0;
  private v0 = 0;
  private v1 = 0;
  private lon0 = 0;
  private delta = 0;
  private pieceT = 0;
  private pieceStartEdge: number | null = null;
  private readonly onBreak = (t: number, value: number, wrap: boolean) => this.breakAt(t, value, wrap);
  /** Wrap crossings (x, boundary value, direction), when collected. */
  wraps: Array<{ x: number; value: number; direct: boolean }> | null = null;

  constructor(
    private readonly paths: readonly DecimatedPath[],
    private readonly runBySign: readonly number[],
    private readonly geo: EphemerisGeometry,
    private readonly mode: EphemerisDisplayMode,
    private readonly modulus: number,
  ) {}

  private y(value: number) {
    return mapEphemerisY(this.geo, this.mode, value, this.modulus);
  }

  /** Plotted value at fraction t of the current step. */
  private valueAt(t: number) {
    return this.mode === "declination" ? this.v0 + (this.v1 - this.v0) * t : this.lon0 + this.delta * t;
  }

  penUp() {
    if (this.current >= 0) this.paths[this.current].end();
    this.current = -1;
  }

  private penDown(run: number, x: number, y: number) {
    this.penUp();
    this.paths[run].moveTo(x, y);
    this.current = run;
  }

  /** First sample after a gap. */
  start(x: number, value: number, longitude: number) {
    this.penDown(this.runBySign[signOf(longitude)], x, this.y(value));
  }

  private piece(tb: number, endEdge: number | null) {
    const ta = this.pieceT;
    const run = this.runBySign[signOf(this.lon0 + this.delta * ((ta + tb) / 2))];
    if (run !== this.current) {
      const ya = this.pieceStartEdge ?? this.y(this.valueAt(ta));
      this.penDown(run, this.x0 + (this.x1 - this.x0) * ta, ya);
    }
    const yb = endEdge ?? this.y(this.valueAt(tb));
    this.paths[run].lineTo(this.x0 + (this.x1 - this.x0) * tb, yb);
  }

  private breakAt(t: number, value: number, wrap: boolean) {
    const direct = this.delta > 0;
    const visualWrap = wrap && this.mode === "longitude";
    const g = this.geo;
    this.piece(t, visualWrap ? (direct ? g.yBottom : g.yTop) : null);
    if (visualWrap) {
      // Leave at one edge, re-enter at the other: a new subpath.
      this.penUp();
      this.wraps?.push({ x: this.x0 + (this.x1 - this.x0) * t, value, direct });
    }
    this.pieceT = t;
    this.pieceStartEdge = visualWrap ? (direct ? g.yTop : g.yBottom) : null;
  }

  /** One sample step: (x0, v0, lon0) -> (x1, v1, lon1). */
  step(x0: number, v0: number, lon0: number, x1: number, v1: number, lon1: number, split: boolean) {
    const delta = longitudeDelta(lon0, lon1);
    const splitHere = split && signOf(lon0) !== signOf(lon1);
    const wrapHere = this.mode === "longitude" && crossesMultiple(lon0, delta, this.modulus);
    if (!splitHere && !wrapHere) {
      // Fast path: one piece in the run already drawing.
      const run = this.runBySign[signOf(lon1)];
      if (run !== this.current) this.penDown(run, x0, this.y(v0));
      this.paths[run].lineTo(x1, this.y(v1));
      return;
    }
    this.x0 = x0;
    this.x1 = x1;
    this.v0 = v0;
    this.v1 = v1;
    this.lon0 = lon0;
    this.delta = delta;
    this.pieceT = 0;
    this.pieceStartEdge = null;
    forEachSegmentBreak(lon0, delta, this.mode === "longitude" ? this.modulus : 360, split, this.onBreak);
    if (this.pieceT < 1) this.piece(1, null);
  }
}

/** The declination scale of the month block holding `jd` (else the nearest
 * resident one): the year's out-of-bounds limit and sign ranges. */
function declinationScaleAt(data: EphemerisFrameData, jd: number) {
  let best: EphemerisBlock["declinationScale"] = null;
  let bestDistance = Infinity;
  for (const block of data.blocks) {
    if (!block.declinationScale) continue;
    const distance = jd < block.startJd ? block.startJd - jd : Math.max(0, jd - (block.startJd + block.days));
    if (distance < bestDistance) {
      best = block.declinationScale;
      bestDistance = distance;
      if (distance === 0) break;
    }
  }
  return best;
}

/** Declination layers that read the year's scale data, so they follow the
 * camera: the out-of-bounds range (±limit ruled on the table and limbs,
 * tinted beyond, dashed through the plot) and the sign bands (the two
 * signs reaching each band between sign-cusp declinations). */
function paintDeclinationRange(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  geo: EphemerisGeometry,
  data: EphemerisFrameData,
  scene: EphemerisScene,
  style: EphemerisRenderStyle,
  centreJd: number,
): void {
  const showRange = scene.showOutOfBoundsRange ?? false;
  const showSigns = (scene.showSignBands ?? false) && geo.declSignWidth > 0;
  if (!showRange && !showSigns) return;
  const scale = declinationScaleAt(data, centreJd);
  if (!scale) return;
  const colors = style.colors;
  const strokes = style.strokes;
  const hair = strokes.hairlineWidth;
  const yOf = (value: number) => mapEphemerisY(geo, "declination", value);
  const rules = new PlateRules(ctx, colors.rule, dpr);
  const limit = Math.min(scale.limit, DECLINATION_LIMIT);
  // The table spans tableLeft..tableRight; the second limb grows from the ruler edge.
  const limbLeft = Math.min(geo.rulerInner, geo.rulerInner + geo.rulerDir * geo.limbWidth);
  const spans: Array<[number, number]> = [
    [geo.tableLeft, geo.tableRight],
    [limbLeft, limbLeft + geo.limbWidth],
  ];
  if (showRange) {
    ctx.save();
    ctx.globalAlpha = strokes.outOfBoundsTintOpacity;
    ctx.fillStyle = colors.outOfBounds;
    for (const [left, right] of spans) {
      ctx.fillRect(left, geo.yTop, right - left, yOf(limit) - geo.yTop);
      ctx.fillRect(left, yOf(-limit), right - left, geo.yBottom - yOf(-limit));
    }
    ctx.restore();
    for (const value of [limit, -limit]) {
      for (const [left, right] of spans) rules.horizontal(left, right, yOf(value), hair, undefined, colors.outOfBounds);
    }
    ctx.save();
    ctx.globalAlpha = strokes.guideOpacity;
    for (const value of [limit, -limit]) {
      rules.horizontal(geo.xOrig, geo.plotRight, yOf(value), hair, [strokes.gridDashOn, strokes.gridDashOff], colors.outOfBounds);
    }
    ctx.restore();
  }
  if (showSigns) {
    // Sign column at the table's frame side.
    const left = geo.mirrored ? geo.tableRight - geo.declSignWidth : geo.tableLeft;
    const right = left + geo.declSignWidth;
    const inner = geo.mirrored ? left : right;
    rules.vertical(inner, geo.yTop, geo.yBottom, hair);
    const bounds = [...new Set(scale.signRanges.flat().map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => b - a);
    const text = new PlateText(ctx, style.typography.fontSymbols, 1);
    const glyph = geo.modalityGlyphPx;
    for (let i = 0; i < bounds.length - 1; i++) {
      const hi = bounds[i];
      const lo = bounds[i + 1];
      if (hi !== bounds[0]) rules.horizontal(left, right, yOf(hi), hair);
      if (Math.abs(yOf(lo) - yOf(hi)) < glyph) continue;
      const mid = (hi + lo) / 2;
      const signs = scale.signRanges
        .map(([from, to], sign) => (from <= mid && mid <= to ? sign : -1))
        .filter((sign) => sign >= 0);
      text.draw((left + right) / 2, (yOf(hi) + yOf(lo)) / 2, signs.map((sign) => scene.signGlyphs[sign] ?? "").join(""), {
        size: glyph,
        fill: colors.signs,
        align: "center",
        baseline: "middle",
      });
    }
  }
}

type DeclinationMarkContext = {
  xOf: (jd: number) => number;
  yOf: (value: number) => number;
  inView: (jd: number) => boolean;
  isVisible: (id: number) => boolean;
  glyphSize: number;
  stationInk: (planet: number, jd: number) => string;
};

/** Declination's marks, quiet and collision-free. Out of bounds: with the
 * range band on, the band and its dashed limit already show it, so no text;
 * without it one label at each excursion's furthest point, the deepest
 * first, dropped where it would cover a label already placed. Turns (the
 * curve's northern or southern extremum) carry no letter: with Event glyphs
 * on, a small dot in the curve's ink on the extremum, skipped under a label. */
function paintDeclinationMarks(
  ctx: CanvasRenderingContext2D,
  text: PlateText,
  geo: EphemerisGeometry,
  data: EphemerisFrameData,
  scene: EphemerisScene,
  style: EphemerisRenderStyle,
  measure: TextMeasure,
  marks: DeclinationMarkContext,
): void {
  const { xOf, yOf, inView, isVisible, glyphSize } = marks;
  const placed: Array<[number, number, number, number]> = [];
  const hits = (l: number, t: number, r: number, b: number) => placed.some(([pl, pt, pr, pb]) => l < pr && r > pl && t < pb && b > pt);
  if (!(scene.showOutOfBoundsRange ?? false) && scene.outOfBoundsLabel) {
    const gap = Math.max(style.markers.eventCodeOffsetYMin, geo.spaceSize);
    const width = measure(scene.outOfBoundsLabel, glyphSize);
    const height = glyphSize * 1.2;
    const excursions = data.blocks
      .flatMap((block) => block.outOfBounds)
      .filter((marker) => isVisible(marker.planet) && inView(marker.jd))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    for (const marker of excursions) {
      const north = marker.value >= 0;
      const x = xOf(marker.jd);
      const y = yOf(marker.value);
      const top = clamp(north ? y - gap - height : y + gap, geo.yTop, geo.yBottom - height);
      const left = x - width / 2;
      if (hits(left - gap, top, left + width + gap, top + height)) continue;
      placed.push([left - gap, top, left + width + gap, top + height]);
      text.draw(x, top + height / 2, scene.outOfBoundsLabel, {
        font: style.typography.fontUi,
        size: glyphSize,
        fill: style.colors.outOfBounds,
        align: "center",
        baseline: "middle",
      });
    }
  }
  if (!scene.showEventGlyphs) return;
  const radius = Math.max(style.markers.eventCodeOffsetYMin, geo.stationFontPx * style.markers.turnDotScale);
  ctx.save();
  for (const st of data.blocks.flatMap((block) => block.declinationStations)) {
    if (st.code === "EQ" || !isVisible(st.planet) || !inView(st.jd)) continue;
    const x = xOf(st.jd);
    const y = yOf(st.value);
    if (hits(x - radius, y - radius, x + radius, y + radius)) continue;
    ctx.fillStyle = marks.stationInk(st.planet, st.jd);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function paintEphemerisPlot(
  surface: EphemerisSurface,
  geo: EphemerisGeometry,
  camera: EphemerisCamera,
  data: EphemerisFrameData,
  scene: EphemerisScene,
  style: EphemerisRenderStyle,
  measure: TextMeasure,
  /** Painted under the curves, inside the plot clip (the radix Orb bands). */
  underCurves?: (ctx: CanvasRenderingContext2D) => void,
): EphemerisPlotStats {
  const { ctx, dpr } = surface;
  const stats: EphemerisPlotStats = { curvePoints: 0, samples: 0 };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  if (geo.w < style.layout.minCanvasWidth || geo.h < style.layout.minCanvasHeight || geo.plotWidth <= 0) return stats;

  const colors = style.colors;
  const strokes = style.strokes;
  const markers = style.markers;
  const labels = style.labels;
  const ruler = style.ruler;
  const mode = scene.mode;
  const modulus = sceneModulus(scene);
  const frameRules = new PlateRules(ctx, colors.frame, dpr);
  const hairRules = new PlateRules(ctx, colors.rule, dpr);
  const mutedRules = new PlateRules(ctx, colors.muted, dpr);
  const text = new PlateText(ctx, style.typography.fontUi, dpr);
  const staticText = new PlateText(ctx, style.typography.fontUi, 1);
  const pxPerDay = geo.plotWidth / camera.spanDays;
  const startJd = camera.startJd;
  const endJd = startJd + camera.spanDays;
  const xOf = (jd: number) => geo.xOrig + (jd - startJd) * pxPerDay;
  const yOf = (value: number) => mapEphemerisY(geo, mode, value, modulus);
  // Events whose glyphs could reach into the plot.
  const pad = (geo.planetFontPx * 2) / pxPerDay;
  const inView = (jd: number) => jd >= startJd - pad && jd <= endJd + pad;
  const planetById = new Map<number, EphemerisScenePlanet>(scene.planets.map((p) => [p.id, p]));
  const isVisible = (id: number) => Boolean(scene.visible[id]) && planetById.has(id);
  const inkTable = ephemerisInkTable(scene, style);
  const inkOf = (id: number, sign: number) => inkTable.get(id)?.bySign[((sign % SIGN_NUM) + SIGN_NUM) % SIGN_NUM] ?? colors.ink;
  const symbols = (size: number, fill: string) => ({ font: style.typography.fontSymbols, size, fill }) as const;

  // === Header line: the localized technical caption, moving with the camera;
  // with the reading line it names the line's date ===
  const header = scene.headerText?.(scene.showNowLine ? ephemerisNowLineJd(camera) : startJd);
  if (header) {
    staticText.draw(geo.outer + geo.spaceSize * 2, (geo.outer + geo.headerBottom) / 2, header, {
      size: geo.headerFontPx,
      fill: colors.ink,
      align: "left",
      baseline: "middle",
    });
  }

  if (mode === "declination") paintDeclinationRange(ctx, dpr, geo, data, scene, style, startJd + camera.spanDays / 2);

  const timeRuler = buildTimeRuler({
    camera,
    xOrig: geo.xOrig,
    plotWidth: geo.plotWidth,
    monthLabels: scene.monthLabels,
    measureText: (value) => measure(value, geo.txtFontPx),
    measureRuler: (value) => measure(value, geo.rulerFontPx),
    minSpacing: ruler.tickMinSpacing,
    labelGap: ruler.labelGapSpaces * geo.spaceSize * 2,
  });

  // Everything that moves with time inside the plot is clipped to it.
  ctx.save();
  ctx.beginPath();
  ctx.rect(geo.xOrig, geo.yTop - 0.5, geo.plotWidth, geo.plotHeight + 1);
  ctx.clip();

  if (scene.showGrid && timeRuler.gridXs.length) {
    ctx.save();
    ctx.globalAlpha = strokes.guideOpacity;
    hairRules.verticals(timeRuler.gridXs, geo.yTop, geo.yBottom, strokes.gridLineWidth, [strokes.gridDashOn, strokes.gridDashOff]);
    ctx.restore();
  }

  underCurves?.(ctx);

  // === Reading line under the curves: fixed at the plot centre ===
  if (scene.showNowLine) paintNowLine(ctx, dpr, geo, style);

  // === Curves, decimated to device columns; the highlight paints last ===
  const topMarks: EdgeLabel[] = [];
  const bottomMarks: EdgeLabel[] = [];
  const sink: PathSink = {
    moveTo: (x: number, y: number) => {
      stats.curvePoints++;
      ctx.moveTo(x, y);
    },
    lineTo: (x: number, y: number) => {
      stats.curvePoints++;
      ctx.lineTo(x, y);
    },
  };
  const order = ephemerisPaintOrder(scene.planets.filter((p) => scene.visible[p.id]), scene.highlightPlanetId);
  for (const planet of order) {
    const ink = inkTable.get(planet.id);
    if (!ink) continue;
    const runs = ink.runs.length;
    const split = runs > 1;
    // One run strokes straight into the context; several collect into pooled
    // buffers and stroke one path per colour after the single walk.
    const buffers = split ? ink.runs.map((_, i) => pooledBuffer(i)) : null;
    const paths = buffers ? buffers.map((b) => new DecimatedPath(b, dpr)) : [new DecimatedPath(sink, dpr)];
    const walker = new CurveWalker(paths, ink.runBySign, geo, mode, modulus);
    const wraps: CurveWalker["wraps"] = mode === "longitude" && planet.id !== MOON_ID ? [] : null;
    walker.wraps = wraps;
    ctx.save();
    ctx.lineWidth = ink.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (!split) {
      ctx.strokeStyle = ink.runs[0];
      ctx.beginPath();
    }
    let havePrev = false;
    let prevX = 0;
    let prevV = 0;
    let prevLon = 0;
    let prevMonth = Number.NaN;
    for (const block of data.blocks) {
      const rows = block.rows.get(planet.id);
      const row = rows?.[mode];
      const lonRow = rows?.longitude;
      if (!row || !lonRow || block.monthIndex !== prevMonth + 1) {
        walker.penUp();
        havePrev = false;
      }
      prevMonth = block.monthIndex;
      if (!row || !lonRow) continue;
      const i0 = Math.max(0, Math.floor(startJd - 1 - block.startJd));
      const i1 = Math.min(row.length - 1, Math.ceil(endJd + 1 - block.startJd));
      for (let i = i0; i <= i1; i++) {
        const v = row[i];
        const lon = lonRow[i];
        if (!Number.isFinite(v) || !Number.isFinite(lon)) {
          walker.penUp();
          havePrev = false;
          continue;
        }
        stats.samples++;
        const x = xOf(block.startJd + i);
        if (!havePrev) walker.start(x, v, lon);
        else walker.step(prevX, prevV, prevLon, x, v, lon, split);
        havePrev = true;
        prevX = x;
        prevV = v;
        prevLon = lon;
      }
    }
    walker.penUp();
    if (buffers) {
      for (let run = 0; run < runs; run++) {
        ctx.strokeStyle = ink.runs[run];
        ctx.beginPath();
        buffers[run].replay(sink);
        ctx.stroke();
      }
    } else {
      ctx.stroke();
    }
    ctx.restore();
    if (wraps) {
      for (const wrap of wraps) {
        if (wrap.x < geo.xOrig || wrap.x > geo.plotRight) continue;
        // The sign on each side of the crossing: the bottom band names the
        // sign below the wrap value, the top band the sign above it.
        bottomMarks.push({ x: wrap.x, px: wrap.x, planetId: planet.id, sign: signOf(wrap.value - 1e-6) });
        topMarks.push({ x: wrap.x, px: wrap.x, planetId: planet.id, sign: signOf(wrap.value + 1e-6) });
      }
    }
  }

  // === Optional event glyphs: ingress/outgress sign glyphs (daemon events) ===
  const glyphSize = eventGlyphSize(geo, style);
  if (scene.showEventGlyphs && mode === "longitude") {
    for (const block of data.blocks) {
      for (const ev of block.signEvents) {
        if (!isVisible(ev.planet) || !inView(ev.jd)) continue;
        const sign = ((ev.eventSign % SIGN_NUM) + SIGN_NUM) % SIGN_NUM;
        text.draw(xOf(ev.jd), yOf(ev.value), scene.signGlyphs[sign] ?? "", {
          ...symbols(glyphSize, inkOf(ev.planet, sign)),
          align: "center",
          baseline: "middle",
        });
      }
    }
  }

  // === Stations (longitude): a small bold letter, below a turn to
  // retrograde (the curve's lowest point) and above a turn to direct ===
  const letterOffset = geo.planetFontPx * markers.stationLetterOffsetScale;
  // The hovered curve's letters take its own ink; the others stay muted.
  const stationInk = (planet: number, jd: number) =>
    inkOf(planet, signOf(ephemerisValueAt(data.blocks, planet, "longitude", jd) ?? 0));
  if (mode === "longitude") {
    for (const st of data.stationYears.flatMap((layer) => layer.longitude)) {
      if (st.code.length < 2 || !isVisible(st.planet) || !inView(st.jd)) continue;
      const below = st.code === "SR";
      text.draw(xOf(st.jd), yOf(st.value) + (below ? letterOffset : -letterOffset), st.code.slice(1), {
        size: geo.stationFontPx,
        weight: 700,
        fill: scene.highlightPlanetId === st.planet ? stationInk(st.planet, st.jd) : colors.muted,
        align: "center",
        baseline: "middle",
      });
    }
  } else {
    paintDeclinationMarks(ctx, text, geo, data, scene, style, measure, { xOf, yOf, inView, isVisible, glyphSize, stationInk });
  }

  // === Lunation discs on the Moon's degree: New Moon filled with ink, Full
  // Moon paper with an ink ring. An eclipse carries its letter on the disc
  // (S solar, L lunar in English), in the disc's contrasting colour ===
  if (scene.showLunations && lunationVisibility(geo, style, pxPerDay)) {
    const snapDevice = (value: number) => Math.round(value * dpr) / dpr;
    const radius = lunationDiscRadius(geo, style);
    const letterPx = 2 * radius * markers.eclipseLetterScale;
    for (const block of data.blocks) {
      for (const lunation of block.lunations) {
        if (!inView(lunation.jd)) continue;
        const x = snapDevice(xOf(lunation.jd));
        const y = snapDevice(yOf(mode === "declination" ? lunation.declination : lunation.longitude));
        // A disc is a mark, not plot ink: whole while its centre is on the plot.
        if (x < geo.xOrig || x > geo.plotRight || y < geo.yTop || y > geo.yBottom) continue;
        const dark = lunation.kind === "new";
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = dark ? colors.ink : colors.paper;
        ctx.fill();
        ctx.strokeStyle = colors.ink;
        ctx.lineWidth = Math.max(0.25, strokes.lunationDiscOutlineWidth);
        ctx.stroke();
        ctx.restore();
        const letter =
          lunation.eclipse === "solar" ? scene.eclipseLetters?.solar : lunation.eclipse === "lunar" ? scene.eclipseLetters?.lunar : undefined;
        if (letter) {
          text.draw(x, y, letter, {
            font: style.typography.fontUi,
            size: letterPx,
            weight: 700,
            fill: dark ? colors.paper : colors.ink,
            align: "center",
            baseline: "middle",
          });
        }
      }
    }
  }
  ctx.restore();

  // === Plot rules over the curve ends, so every edge stays crisp ===
  frameRules.horizontal(geo.xOrig, geo.plotRight, geo.yTop, geo.frameW);
  frameRules.horizontal(geo.xOrig, geo.plotRight, geo.yBottom, geo.frameW);
  hairRules.vertical(geo.xOrig, geo.yTop, geo.rulerY, strokes.hairlineWidth);
  hairRules.vertical(geo.plotRight, geo.yTop, geo.rulerY, strokes.hairlineWidth);

  // === Time axis below the bottom wrap band ===
  ctx.save();
  ctx.beginPath();
  ctx.rect(geo.xOrig - geo.border, geo.rulerY, geo.plotWidth + geo.border * 2, geo.plateBottom - geo.rulerY);
  ctx.clip();
  const ticks = new TickBuckets(style);
  for (const tick of timeRuler.ticks) {
    ticks.add(tick.level, [tick.x, geo.rulerY, geo.rulerY + tickLength(geo, tick.level)]);
  }
  ticks.stroke(mutedRules, "vertical");
  const monthLabelY = geo.rulerY + geo.tickMajor + labels.labelYGapSpaces * geo.spaceSize;
  const yearLabelY = monthLabelY + geo.txtFontPx * 1.15;
  for (const label of timeRuler.labels) {
    const primary = label.row === "month" && label.font === "text";
    text.draw(label.x, label.row === "year" ? yearLabelY : monthLabelY, label.text, {
      size: label.font === "ruler" ? geo.rulerFontPx : geo.txtFontPx,
      fill: primary ? colors.ink : colors.muted,
      align: "center",
      baseline: "top",
    });
  }
  ctx.restore();
  if (scene.showNowLine) paintNowLineTag(ctx, dpr, geo, style, scene.nowLineLabel?.(ephemerisNowLineJd(camera)) ?? "", measure);

  // === Edge labels: planet glyph above the sign on that side of the crossing ===
  const gap = geo.planetFontPx * labels.edgeLabelGapScale;
  const maxShift = gap * labels.edgeLabelMaxShiftScale;
  const half = geo.planetFontPx / 2;
  const signHalf = geo.edgeSignFontPx / 2;
  const rowGap = geo.spaceSize * 0.5;
  const topSignY = geo.yTop - geo.spaceSize - signHalf;
  const topGlyphY = topSignY - signHalf - rowGap - half;
  const bottomGlyphY = geo.yBottom + geo.spaceSize + half;
  const bottomSignY = bottomGlyphY + half + rowGap + signHalf;
  for (const [marks, glyphY, signY] of [
    [topMarks, topGlyphY, topSignY],
    [bottomMarks, bottomGlyphY, bottomSignY],
  ] as const) {
    for (const mark of placeEdgeLabels(marks, gap, maxShift, geo.xOrig, geo.plotRight)) {
      const fill = inkOf(mark.planetId, mark.sign);
      text.draw(mark.px, glyphY, planetById.get(mark.planetId)?.glyph ?? "", { ...symbols(geo.planetFontPx, fill), align: "center", baseline: "middle" });
      text.draw(mark.px, signY, scene.signGlyphs[mark.sign] ?? "", { ...symbols(geo.edgeSignFontPx, fill), align: "center", baseline: "middle" });
    }
  }

  // === Planet labels in the gutter, at each curve's y at the labelled edge ===
  const start = ephemerisStartLabels(geo, style, data, scene, ephemerisLabelJd(geo, camera));
  for (const label of start.labels) {
    const fill = inkOf(label.planetId, label.sign);
    text.draw(start.x, label.y, label.glyph, { ...symbols(geo.planetFontPx, fill), align: "left", baseline: "middle" });
    if (mode === "longitude") {
      text.draw(start.signX, label.y, scene.signGlyphs[label.sign] ?? "", {
        ...symbols(geo.startSignFontPx, fill),
        align: "left",
        baseline: "middle",
      });
    }
  }
  return stats;
}
