// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cellBox, moonRowBand, moonRowBaseline, moonRowHeight, type DashboardLayout, type DashRect } from "./dashboard-layout";
import { aspectGridBodies } from "./dashboard-canvas";
import { SE_TRUE_NODE } from "./glyphs";
import { fitOuterLabelPrefix } from "./outer-label-names";
import type { ChartDashboard, ChartDashboardBody } from "./types";

/**
 * Chart dashboard module painters. Pixel reference: the accepted design-lab
 * painters (`design-lab/paint/aspect-grid.ts`, `declination-strip.ts`,
 * `declination-bar.ts`, `moon-status.ts`). Every astrological value is daemon
 * data (`snapshot.dashboard`); only display formatting happens here.
 */

export type DashboardPaint = {
  ctx: CanvasRenderingContext2D;
  dashboard: ChartDashboard;
  /** Resolve any CSS colour expression (var(), color-mix()) to a canvas colour. */
  color: (expression: string) => string;
  /** body/aspect: the wheel's per-role glyph font tokens (default: symbols). */
  fonts: { ui: string; symbols: string; body?: string; aspect?: string };
  t: (key: string, params?: Record<string, string | number>) => string;
  /**
   * Painted objects the Moon text must not cross (wheel rim, outer-ring
   * labels, other modules, corner text). Text runs freely past its box into
   * empty space and shortens only where it would hit one. Without them the
   * text stays inside its box.
   */
  obstacles?: DashObstacles;
};

export type DashObstacles = {
  rects: readonly DashRect[];
  discs: readonly { x: number; y: number; r: number }[];
  /** Right edge of the drawable surface (canvas width less the inset). */
  right: number;
};

/**
 * Right limit for text starting at `x` within the band [top, bottom]: the
 * nearest object edge, less `pad`; the box's own right edge when nothing is
 * known about the surroundings.
 */
export function textRightLimit(obstacles: DashObstacles | undefined, box: DashRect, x: number, top: number, bottom: number, pad: number): number {
  if (!obstacles) return box.x + box.w;
  let limit = obstacles.right;
  for (const rect of obstacles.rects) {
    if (rect.y >= bottom || rect.y + rect.h <= top || rect.x + rect.w <= x) continue;
    limit = Math.min(limit, rect.x - pad);
  }
  for (const disc of obstacles.discs) {
    const dy = top <= disc.y && disc.y <= bottom ? 0 : Math.min(Math.abs(disc.y - top), Math.abs(disc.y - bottom));
    if (dy >= disc.r) continue;
    const left = disc.x - Math.sqrt(disc.r * disc.r - dy * dy);
    if (disc.x + Math.sqrt(disc.r * disc.r - dy * dy) <= x) continue;
    limit = Math.min(limit, left - pad);
  }
  return Math.max(x, limit);
}

type Lines = { rule: string; frame: string; ruleWidth: number; frameWidth: number };
type Body = { planet: number; dec: number; glyph: string; color: string; motion?: string };
// The chart's second logical node (SE_TRUE_NODE slot) is its south node.
// Keep it in daemon data, but omit it from the aspect grid and scale paint/hover.
const onDeclinationScale = (planet: number) => planet !== SE_TRUE_NODE;
/**
 * `fit`: the run yields to the module width, prefix + "." like outer-ring
 * names, and drops out with its leading `separator` when nothing fits.
 */
type Run = { text: string; symbol?: boolean; subscript?: boolean; color?: string; fontFamily?: string; weight?: number; fit?: boolean; separator?: string; arrow?: "up" | "down" };

/** The Inspector's lunar-mansion face for the Arabic-script name. */
const ARABIC_FONT = "'AriesArabicAcademic'";

const MODULE_RULE = "var(--aries-chart-module-rule-color)";
const OUT_OF_BOUNDS = "color-mix(in srgb, var(--aries-text-dim) 14%, transparent)";

/** The wheel's body-glyph font token, else its general symbol font. */
const bodyFont = (p: Pick<DashboardPaint, "fonts">) => p.fonts.body ?? p.fonts.symbols;

const bodyColor = (p: DashboardPaint, entry: { color?: string; colorRole?: string } | undefined) =>
  p.color(entry?.colorRole ? `var(${entry.colorRole}, ${entry.color ?? "currentColor"})` : entry?.color ?? "var(--aries-text-muted)");

function moduleLines(p: DashboardPaint, widths: { rule: number; frame: number }): Lines {
  const rule = p.color(MODULE_RULE);
  return { rule, frame: rule, ruleWidth: widths.rule, frameWidth: widths.frame };
}

/**
 * Print setting of the modules on a poster sheet (the title-block Stagger):
 * aspect figures at the tables' type instead of a share of the cell, a
 * quieter lattice than the staircase, and the Moon list under a caption the
 * sheet sets itself.
 */
export type DashboardPrint = {
  /** Aspect glyph and orb sizes in CSS px (capped by the cell). */
  gridGlyph: number;
  gridOrb: number;
  /** Lattice and staircase inks (CSS colour expressions) and widths. */
  lattice: string;
  outline: string;
  ruleWidth: number;
  frameWidth: number;
  /** false: the Moon list paints its rows only. */
  moonHeading: boolean;
};

export function paintDashboard(p: DashboardPaint, layout: DashboardLayout, widths = { rule: 1, frame: 2 }, print?: DashboardPrint): void {
  const lines = moduleLines(p, widths);
  if (layout.grid) {
    paintAspectGrid(p, layout, print ? {
      rule: p.color(print.lattice), frame: p.color(print.outline), ruleWidth: print.ruleWidth, frameWidth: print.frameWidth,
    } : lines, print);
  }
  if (layout.scale) {
    const { rect, kind } = layout.scale;
    if (kind === "strip") paintDeclinationStrip(p, rect, layout.glyph, lines);
    else if (kind === "folded-bar") paintFoldedDeclinationBar(p, rect, layout.glyph, lines);
    else paintDeclinationBar(p, rect, layout.glyph, lines);
  }
  if (layout.moon) paintMoonList(p, layout.moon, layout.text, lines, print?.moonHeading ?? true);
}

/** Device-pixel scale and offset of the context's current transform (1, 0 without one). */
type Axis = { scale: number; offset: number };

function deviceAxes(ctx: CanvasRenderingContext2D): { x: Axis; y: Axis } {
  const m = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  const sx = m && Math.abs(m.a) > 0 ? Math.abs(m.a) : 1;
  const sy = m && Math.abs(m.d) > 0 ? Math.abs(m.d) : 1;
  return { x: { scale: sx, offset: m?.e ?? 0 }, y: { scale: sy, offset: m?.f ?? 0 } };
}

/**
 * Line width rounded to whole device pixels (at least one), in CSS pixels.
 * Uses the smaller axis scale so a uniform DPR gives the same answer on both.
 */
export function deviceLineWidth(width: number, scale: number): number {
  return Math.max(1, Math.round(width * scale)) / scale;
}

/**
 * Centre for a line of `width` CSS px near `value`, so its stroke covers whole
 * device pixels: odd device widths sit on a pixel centre, even ones on a
 * pixel edge. Works for any DPR and for fractional `value`.
 */
export function snapLine(value: number, width: number, axis: Axis): number {
  const device = value * axis.scale + axis.offset;
  const deviceWidth = Math.max(1, Math.round(width * axis.scale));
  const snapped = deviceWidth % 2 ? Math.floor(device) + 0.5 : Math.round(device);
  return (snapped - axis.offset) / axis.scale;
}

type Segment = { x1: number; y1: number; x2: number; y2: number };

/**
 * Aspect-grid line geometry in grid units: interior cell rules, each shared
 * edge once (rows k ≥ 2 run left to the previous row's last cell, columns
 * j ≥ 1 run down from their first lower cell), and the closed staircase
 * outline. Rules never lie on the outline, so no edge is stroked twice.
 */
export function aspectGridLines(n: number): { rules: Segment[]; outline: { x: number; y: number }[] } {
  const rules: Segment[] = [];
  for (let k = 2; k < n; k += 1) rules.push({ x1: 0, y1: k, x2: k - 1, y2: k });
  for (let j = 1; j < n - 1; j += 1) rules.push({ x1: j, y1: j + 1, x2: j, y2: n });
  const outline = [{ x: 0, y: 1 }];
  for (let row = 1; row < n; row += 1) outline.push({ x: row, y: row }, { x: row, y: row + 1 });
  outline.push({ x: 0, y: n });
  return { rules, outline: n > 1 ? outline : [] };
}

/**
 * Grid lines in one pass per weight: every boundary k is snapped once to
 * device pixels for the current transform, so all 1px rules (and all 2px
 * outline edges) land on the same pixel grid whatever the cell size or DPR.
 * `part` "rules" paints under the cell content, "outline" over it.
 */
function strokeAspectGridLines(ctx: CanvasRenderingContext2D, left: number, top: number, c: number, n: number, lines: Lines, part: "rules" | "outline") {
  const axes = deviceAxes(ctx);
  const scale = Math.min(axes.x.scale, axes.y.scale);
  const { rules, outline } = aspectGridLines(n);
  const at = (width: number) => ({
    x: Array.from({ length: n + 1 }, (_, k) => snapLine(left + k * c, width, axes.x)),
    y: Array.from({ length: n + 1 }, (_, k) => snapLine(top + k * c, width, axes.y)),
  });
  ctx.lineCap = "butt";
  if (part === "rules") {
    if (!rules.length) return;
    const ruleAt = at(lines.ruleWidth);
    ctx.strokeStyle = lines.rule;
    ctx.lineWidth = deviceLineWidth(lines.ruleWidth, scale);
    ctx.beginPath();
    for (const s of rules) {
      ctx.moveTo(ruleAt.x[s.x1], ruleAt.y[s.y1]);
      ctx.lineTo(ruleAt.x[s.x2], ruleAt.y[s.y2]);
    }
    ctx.stroke();
    return;
  }
  if (!outline.length) return;
  const frameAt = at(lines.frameWidth);
  ctx.strokeStyle = lines.frame;
  ctx.lineWidth = deviceLineWidth(lines.frameWidth, scale);
  ctx.lineJoin = "miter";
  ctx.beginPath();
  outline.forEach((point, index) => {
    if (index) ctx.lineTo(frameAt.x[point.x], frameAt.y[point.y]);
    else ctx.moveTo(frameAt.x[point.x], frameAt.y[point.y]);
  });
  ctx.closePath();
  ctx.stroke();
}

/** Planet triangle, axis glyphs open on the diagonal, staircase outline. */
function paintAspectGrid(p: DashboardPaint, layout: DashboardLayout, lines: Lines, print?: DashboardPrint) {
  const bodies = aspectGridBodies(p.dashboard);
  const cells = p.dashboard.grid?.cells ?? {};
  const grid = layout.grid!;
  const { ctx } = p;
  const c = layout.cell;
  const n = bodies.length;
  const left = grid.left;
  const bottom = grid.bottom;
  const top = bottom - n * c;
  const orbs = p.dashboard.gridOrbs;
  const parallels = p.dashboard.gridParallels !== false;
  const dim = p.color("var(--aries-text-dim)");
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  strokeAspectGridLines(ctx, left, top, c, n, lines, "rules");
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      const { x, y } = cellBox(grid, n, c, row, col);
      if (col === row) {
        ctx.fillStyle = bodyColor(p, bodies[row]);
        ctx.font = `${Math.round(c * 0.5)}px ${p.fonts.symbols}`;
        ctx.fillText(bodies[row].glyph ?? "", x + c / 2, y + c / 2);
        continue;
      }
      const cell = cells[`planet:${bodies[col].planet}:planet:${bodies[row].planet}`];
      if (parallels && cell?.parallel) paintParallelMark(p, cell.parallel, cell.parallelColor, x + c, y, c);
      if (!cell?.glyph) continue;
      ctx.fillStyle = bodyColor(p, cell);
      if (!orbs) {
        ctx.font = `${Math.round(print ? Math.min(c * 0.62, print.gridGlyph) : c * 0.6)}px ${p.fonts.symbols}`;
        ctx.fillText(cell.glyph, x + c / 2, y + c / 2);
        continue;
      }
      ctx.font = `${Math.round(print ? Math.min(c * 0.62, print.gridGlyph) : c * 0.42)}px ${p.fonts.symbols}`;
      ctx.fillText(cell.glyph, x + c / 2, y + c * 0.36);
      paintOrbWithPhase(p, cell, x + c / 2, y, c, dim, print ? Math.min(c * 0.36, print.gridOrb) : undefined);
    }
  }
  strokeAspectGridLines(ctx, left, top, c, n, lines, "outline");
  ctx.restore();
}

/**
 * Declination parallel in orb: heavy Morinus ∥ ("X") or # ("Y") in the cell's
 * top-right corner, full colour, filled then stroked 0.6 px for weight. Also
 * on cells without an aspect glyph.
 */
export function parallelMark(kind: "parallel" | "contraparallel", right: number, top: number, c: number) {
  return {
    glyph: kind === "contraparallel" ? "Y" : "X",
    ink: kind === "contraparallel" ? "var(--morinus-aspect-contraparallel)" : "var(--morinus-aspect-parallel)",
    size: Math.max(8, Math.round(c * 0.42)),
    x: right - 2,
    y: top + 2,
  };
}

function paintParallelMark(p: DashboardPaint, kind: "parallel" | "contraparallel", printInk: string | undefined, right: number, top: number, c: number) {
  const { ctx } = p;
  const mark = parallelMark(kind, right, top, c);
  const ink = printInk ?? p.color(mark.ink);
  ctx.save();
  ctx.font = `${mark.size}px ${p.fonts.symbols}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.fillStyle = ink;
  ctx.fillText(mark.glyph, mark.x, mark.y);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.6;
  ctx.strokeText(mark.glyph, mark.x, mark.y);
  ctx.restore();
}

/** Orb at 74 % of the cell, then a smaller a/s (applying/separating) at 76 %, centred as one unit. */
export function orbWithPhaseMetrics(
  p: Pick<DashboardPaint, "ctx" | "fonts" | "t">,
  cell: { orb?: string; applying?: boolean },
  centerX: number,
  c: number,
  /** Orb size in px (default: a share of the cell). */
  size = c * 0.36,
) {
  const { ctx } = p;
  const orbSize = Math.max(9, Math.round(size));
  const tagSize = Math.max(8, Math.round(size * 0.8));
  const tag = p.t(cell.applying ? "dashboard.grid.applyingShort" : "dashboard.grid.separatingShort");
  ctx.font = `${orbSize}px ${p.fonts.ui}`;
  const orbWidth = ctx.measureText(cell.orb ?? "").width;
  ctx.font = `${tagSize}px ${p.fonts.ui}`;
  const tagWidth = ctx.measureText(tag).width;
  const left = centerX - (orbWidth + tagWidth + 1) / 2;
  return { tag, orbSize, tagSize, orbX: left, tagX: left + orbWidth + 1 };
}

function paintOrbWithPhase(p: DashboardPaint, cell: { orb?: string; applying?: boolean }, centerX: number, y: number, c: number, dim: string, size?: number) {
  const { ctx } = p;
  const m = orbWithPhaseMetrics(p, cell, centerX, c, size);
  const ink = ctx.fillStyle;
  ctx.save();
  ctx.textAlign = "left";
  ctx.font = `${m.orbSize}px ${p.fonts.ui}`;
  ctx.fillStyle = ink;
  ctx.fillText(cell.orb ?? "", m.orbX, y + c * 0.74);
  ctx.font = `${m.tagSize}px ${p.fonts.ui}`;
  ctx.fillStyle = dim;
  ctx.fillText(m.tag, m.tagX, y + c * 0.76);
  ctx.restore();
}

function declinationBodies(p: DashboardPaint): { bodies: Body[]; obliquity: number; extent: number } {
  const entries = new Map<number, ChartDashboardBody>((p.dashboard.bodies ?? []).map((b) => [b.planet, b]));
  const bodies = (p.dashboard.declination?.points ?? []).flatMap((point) => {
    if (!onDeclinationScale(point.planet)) return [];
    const entry = entries.get(point.planet);
    return entry?.glyph ? [{ planet: point.planet, dec: point.declination, glyph: entry.glyph, color: bodyColor(p, entry), motion: entry.motion }] : [];
  });
  return { bodies, ...scaleExtent(p.dashboard) };
}

/** Degree-label size on the declination scales. */
const scaleLabelSize = (g: number) => Math.max(9, Math.round(g * 0.45));
/** Space between an axis and its labels: the longest (10°) tick plus a hairline of air. */
const labelGap = (g: number) => g * 0.45;

/**
 * Measured type metrics the declination scales are laid out from: alignment
 * follows the ink, not em boxes. Glyph depth comes from the chart's whole
 * body set and labels from the scale's whole range, so stepping (bodies
 * changing hemisphere) never moves a row.
 */
export type ScaleMetrics = {
  /** Degree-label font size. */
  label: number;
  /** Height of digits above the baseline. */
  digitAscent: number;
  /** Widest degree label of the scale. */
  widestLabel: number;
  /** Widest of the hemisphere words (N / S) on the mirrored bar. */
  hemisphereWidth: number;
  /** Deepest ink below a body glyph's middle line, and highest above it. */
  glyphDescent: number;
  glyphAscent: number;
};

const scaleLabels = (t: DashboardPaint["t"], extent: number) => {
  const north = t("dashboard.declination.north");
  const south = t("dashboard.declination.south");
  const labels: string[] = [];
  for (let dec = 10; dec <= extent; dec += 10) labels.push(`${dec}°${north}`, `${dec}°${south}`);
  return { labels, north, south };
};

const metricsCache = new Map<string, ScaleMetrics>();

/** Measure the scale's type with the painting context (cached per font, size and body set). */
export function measureScaleMetrics(
  ctx: CanvasRenderingContext2D,
  p: Pick<DashboardPaint, "fonts" | "t" | "dashboard">,
  g: number,
): ScaleMetrics {
  const label = scaleLabelSize(g);
  const { extent } = scaleExtent(p.dashboard);
  const { labels, north, south } = scaleLabels(p.t, extent);
  const glyphs = (p.dashboard.bodies ?? []).filter((body) => onDeclinationScale(body.planet)).map((body) => body.glyph ?? "").filter(Boolean);
  const key = [p.fonts.ui, bodyFont(p), g, extent, north, south, glyphs.join("")].join("|");
  const hit = metricsCache.get(key);
  if (hit) return hit;
  const fallback = estimateScaleMetrics(g);
  ctx.save();
  ctx.font = `${label}px ${p.fonts.ui}`;
  ctx.textBaseline = "alphabetic";
  const width = (text: string) => ctx.measureText(text).width;
  const digitAscent = ctx.measureText("0123456789").actualBoundingBoxAscent;
  const widestLabel = Math.max(width("0°"), ...labels.map(width));
  const hemisphereWidth = Math.max(width(north), width(south));
  ctx.font = `${g}px ${bodyFont(p)}`;
  ctx.textBaseline = "middle";
  let glyphAscent = 0;
  let glyphDescent = 0;
  for (const glyph of glyphs) {
    const m = ctx.measureText(glyph);
    glyphAscent = Math.max(glyphAscent, m.actualBoundingBoxAscent ?? 0);
    glyphDescent = Math.max(glyphDescent, m.actualBoundingBoxDescent ?? 0);
  }
  ctx.restore();
  const measured: ScaleMetrics = {
    label,
    digitAscent: Number.isFinite(digitAscent) && digitAscent > 0 ? digitAscent : fallback.digitAscent,
    widestLabel: widestLabel > 0 ? widestLabel : fallback.widestLabel,
    hemisphereWidth: hemisphereWidth > 0 ? hemisphereWidth : fallback.hemisphereWidth,
    glyphAscent: glyphAscent > 0 ? glyphAscent : fallback.glyphAscent,
    glyphDescent: glyphDescent > 0 ? glyphDescent : fallback.glyphDescent,
  };
  if (metricsCache.size > 32) metricsCache.clear();
  metricsCache.set(key, measured);
  return measured;
}

/** Typical proportions, for callers without a canvas (hover before the first paint, tests). */
export function estimateScaleMetrics(g: number): ScaleMetrics {
  const label = scaleLabelSize(g);
  return { label, digitAscent: label * 0.72, widestLabel: label * 2.4, hemisphereWidth: label * 0.7, glyphAscent: g * 0.4, glyphDescent: g * 0.4 };
}

function scaleExtent(dashboard: ChartDashboard) {
  const points = (dashboard.declination?.points ?? []).filter((point) => onDeclinationScale(point.planet));
  const obliquity = dashboard.declination?.obliquity ?? 23.44;
  return { obliquity, extent: Math.max(30, Math.ceil(Math.max(obliquity, ...points.map((b) => Math.abs(b.declination))) / 5) * 5) };
}

/**
 * Horizontal bars, laid out from the bottom: the rect's bottom edge sits on
 * the aspect grid's bottom outline, and the lowest ink stands on it — the
 * degree labels' baseline (default bar) or the south glyph row's deepest
 * glyph (mirrored bar). Left and right, the axis spans the rect and the
 * outermost labels sit flush inside its ends.
 */
export function barGeometry(kind: "bar" | "folded-bar", rect: DashRect, g: number, m: ScaleMetrics) {
  const bottom = rect.y + rect.h;
  const right = rect.x + rect.w;
  if (kind === "bar") {
    const axisY = bottom - m.digitAscent - labelGap(g);
    return { axisY, x0: rect.x, x1: right, labelBaseline: bottom, northY: axisY - g * 1.9, southY: axisY - g * 1.9, labelBottom: bottom };
  }
  const southY = bottom - m.glyphDescent;
  const axisY = southY - g * 1.6;
  const labelBaseline = axisY + m.digitAscent + labelGap(g);
  const labelBottom = labelBaseline + g * 0.25;
  // The hemisphere words sit flush left, one label-space before the axis.
  const x0 = rect.x + m.hemisphereWidth + m.label * 0.6;
  return { axisY, x0, x1: right, labelBaseline, northY: axisY - g * 1.6, southY, labelBottom };
}

/** Upright strip: labels flush with the rect's right edge, axis one label-gap left of the widest. */
export function stripGeometry(rect: DashRect, g: number, m: ScaleMetrics) {
  const axisX = rect.x + rect.w - m.widestLabel - g * 0.5;
  return { axisX, labelRight: rect.x + rect.w, top: rect.y, bottom: rect.y + rect.h };
}

/** Text alignment that keeps the outermost scale labels inside the axis ends. */
const flushAlign = (dec: number, extent: number, ends: [CanvasTextAlign, CanvasTextAlign]): CanvasTextAlign =>
  dec === -extent ? ends[0] : dec === extent ? ends[1] : "center";

/**
 * Where each body glyph sits on the declination scale (centre point), for
 * the painters and the dashboard hover zones alike.
 */
export function declinationGlyphs(
  dashboard: ChartDashboard,
  kind: "bar" | "folded-bar" | "strip",
  rect: DashRect,
  g: number,
  metrics: ScaleMetrics = estimateScaleMetrics(g),
): Array<{ planet: number; dec: number; x: number; y: number }> {
  const entries = new Map<number, ChartDashboardBody>((dashboard.bodies ?? []).map((b) => [b.planet, b]));
  const bodies = (dashboard.declination?.points ?? [])
    .filter((point) => onDeclinationScale(point.planet) && entries.get(point.planet)?.glyph)
    .map((point) => ({ planet: point.planet, dec: point.declination }));
  const { extent } = scaleExtent(dashboard);
  if (kind === "strip") {
    const { axisX } = stripGeometry(rect, g, metrics);
    const yOf = (dec: number) => rect.y + rect.h / 2 - (dec / extent) * (rect.h / 2);
    const sorted = [...bodies].sort((a, b) => b.dec - a.dec);
    const ys = spreadLabels(sorted.map((b) => yOf(b.dec)), g * 1.05, rect.y + g / 2, rect.y + rect.h - g / 2);
    return sorted.map((body, i) => ({ ...body, x: axisX - g * 1.9, y: ys[i] }));
  }
  const bar = barGeometry(kind, rect, g, metrics);
  if (kind === "bar") {
    const xOf = (dec: number) => rect.x + rect.w / 2 + (dec / extent) * (rect.w / 2);
    const sorted = [...bodies].sort((a, b) => a.dec - b.dec);
    const minX = rect.x + g / 2;
    const maxX = rect.x + rect.w - g / 2;
    const spacing = Math.min(g * 1.1, sorted.length > 1 ? Math.max(0, (maxX - minX) / (sorted.length - 1)) : Infinity);
    const xs = spreadLabels(sorted.map((b) => xOf(b.dec)), spacing, minX, maxX);
    return sorted.map((body, i) => ({ ...body, x: xs[i], y: bar.northY }));
  }
  const xOf = (dec: number) => bar.x0 + (Math.abs(dec) / extent) * (bar.x1 - bar.x0);
  return [true, false].flatMap((north) => {
    const row = bodies.filter((b) => (b.dec >= 0) === north).sort((a, b) => Math.abs(a.dec) - Math.abs(b.dec));
    const minX = bar.x0 + g / 2;
    const maxX = bar.x1 - g / 2;
    const spacing = Math.min(g * 1.1, row.length > 1 ? Math.max(0, (maxX - minX) / (row.length - 1)) : Infinity);
    const xs = spreadLabels(row.map((b) => xOf(b.dec)), spacing, minX, maxX);
    const y = north ? bar.northY : bar.southY;
    return row.map((body, i) => ({ ...body, x: xs[i], y }));
  });
}

/**
 * Module line positions on whole device pixels, as the aspect grid's: scale
 * axes at the frame width; ticks, ε marks, leader ends and rules at the rule width.
 */
function moduleLineSnap(ctx: CanvasRenderingContext2D, lines: Lines) {
  const axes = deviceAxes(ctx);
  const scale = Math.min(axes.x.scale, axes.y.scale);
  return {
    frameWidth: deviceLineWidth(lines.frameWidth, scale),
    ruleWidth: deviceLineWidth(lines.ruleWidth, scale),
    axisX: (v: number) => snapLine(v, lines.frameWidth, axes.x),
    axisY: (v: number) => snapLine(v, lines.frameWidth, axes.y),
    ruleX: (v: number) => snapLine(v, lines.ruleWidth, axes.x),
    ruleY: (v: number) => snapLine(v, lines.ruleWidth, axes.y),
  };
}

const tickLength = (dec: number, g: number) => (dec % 10 === 0 ? g * 0.4 : dec % 5 === 0 ? g * 0.22 : g * 0.11);

function degreeLabel(p: DashboardPaint, dec: number) {
  const hemisphere = dec > 0 ? p.t("dashboard.declination.north") : dec < 0 ? p.t("dashboard.declination.south") : "";
  return `${Math.abs(dec)}°${hemisphere}`;
}

const motionMarkerSize = (g: number) => Math.round(g * 0.5);

/** A body's motion marker (R, SR/SD) at its scale glyph's lower right, as on the wheel. */
function paintMotionMarker(p: DashboardPaint, body: Body, x: number, y: number, g: number) {
  if (!body.motion) return;
  const { ctx } = p;
  ctx.save();
  ctx.font = `${motionMarkerSize(g)}px ${p.fonts.ui}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = body.color;
  ctx.fillText(body.motion, x + g * 0.5, y + g * 0.35);
  ctx.restore();
}

/** Wide surfaces: upright strip, north up, glyphs left of the axis, labels flush right. */
export function paintDeclinationStrip(p: DashboardPaint, rect: DashRect, g: number, lines: Lines) {
  const { ctx } = p;
  const { bodies, obliquity, extent } = declinationBodies(p);
  const m = measureScaleMetrics(ctx, p, g);
  const { axisX: rawAxisX, labelRight, top, bottom } = stripGeometry(rect, g, m);
  const snap = moduleLineSnap(ctx, lines);
  const axisX = snap.axisX(rawAxisX);
  const yOf = (dec: number) => rect.y + rect.h / 2 - (dec / extent) * (rect.h / 2);
  ctx.save();
  ctx.fillStyle = p.color(OUT_OF_BOUNDS);
  ctx.fillRect(axisX - g * 0.6, rect.y, g * 0.6, yOf(obliquity) - rect.y);
  ctx.fillRect(axisX - g * 0.6, yOf(-obliquity), g * 0.6, rect.y + rect.h - yOf(-obliquity));
  ctx.strokeStyle = lines.frame;
  ctx.lineWidth = snap.frameWidth;
  ctx.beginPath();
  ctx.moveTo(axisX, rect.y);
  ctx.lineTo(axisX, rect.y + rect.h);
  ctx.stroke();
  ctx.lineWidth = snap.ruleWidth;
  ctx.strokeStyle = lines.rule;
  ctx.fillStyle = p.color("var(--aries-text-muted)");
  ctx.font = `${m.label}px ${p.fonts.ui}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  for (let dec = -extent; dec <= extent; dec += 1) {
    const y = snap.ruleY(yOf(dec));
    ctx.beginPath();
    ctx.moveTo(axisX, y);
    ctx.lineTo(axisX + tickLength(dec, g), y);
    ctx.stroke();
    if (dec % 10 !== 0) continue;
    // Digits centred on their tick; the end labels stay inside the strip.
    const baseline = Math.min(bottom, Math.max(top + m.digitAscent, yOf(dec) + m.digitAscent / 2));
    ctx.fillText(degreeLabel(p, dec), labelRight, baseline);
  }
  ctx.setLineDash([4, 3]);
  for (const dec of [obliquity, -obliquity]) {
    ctx.beginPath();
    ctx.moveTo(axisX - g * 0.6, snap.ruleY(yOf(dec)));
    ctx.lineTo(axisX + g * 0.6, snap.ruleY(yOf(dec)));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const byPlanet = new Map(bodies.map((body) => [body.planet, body]));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const motionSize = motionMarkerSize(g);
  for (const glyph of declinationGlyphs(p.dashboard, "strip", rect, g, m)) {
    const body = byPlanet.get(glyph.planet)!;
    const y = snap.ruleY(yOf(body.dec));
    // The motion marker sits at the glyph's lower right, as on the wheel;
    // the leader then starts past it.
    ctx.font = `${motionSize}px ${p.fonts.ui}`;
    const motionW = body.motion ? ctx.measureText(body.motion).width : 0;
    ctx.strokeStyle = lines.rule;
    ctx.beginPath();
    ctx.moveTo(glyph.x + g * 0.6 + motionW, glyph.y);
    ctx.lineTo(axisX - g * 0.6, y);
    ctx.lineTo(axisX, y);
    ctx.stroke();
    ctx.fillStyle = body.color;
    ctx.font = `${g}px ${bodyFont(p)}`;
    ctx.fillText(body.glyph, glyph.x, glyph.y);
    paintMotionMarker(p, body, glyph.x, glyph.y, g);
  }
  ctx.restore();
}

/** Default horizontal bar: one-sided, south left, north right, glyphs above, labels on the bottom line. */
export function paintDeclinationBar(p: DashboardPaint, rect: DashRect, g: number, lines: Lines) {
  const { ctx } = p;
  const { bodies, obliquity, extent } = declinationBodies(p);
  const m = measureScaleMetrics(ctx, p, g);
  const geometry = barGeometry("bar", rect, g, m);
  const snap = moduleLineSnap(ctx, lines);
  const axisY = snap.axisY(geometry.axisY);
  const { labelBaseline } = geometry;
  const xOf = (dec: number) => rect.x + rect.w / 2 + (dec / extent) * (rect.w / 2);
  const band = g * 0.6;
  ctx.save();
  ctx.fillStyle = p.color(OUT_OF_BOUNDS);
  // As painted in the accepted bar mockup: the band spans the axis.
  ctx.fillRect(rect.x, axisY - band, xOf(-obliquity) - rect.x, band * 2);
  ctx.fillRect(xOf(obliquity), axisY - band, rect.x + rect.w - xOf(obliquity), band * 2);
  ctx.strokeStyle = lines.frame;
  ctx.lineWidth = snap.frameWidth;
  ctx.beginPath();
  ctx.moveTo(rect.x, axisY);
  ctx.lineTo(rect.x + rect.w, axisY);
  ctx.stroke();
  ctx.lineWidth = snap.ruleWidth;
  ctx.strokeStyle = lines.rule;
  ctx.fillStyle = p.color("var(--aries-text-muted)");
  ctx.font = `${m.label}px ${p.fonts.ui}`;
  ctx.textBaseline = "alphabetic";
  for (let dec = -extent; dec <= extent; dec += 1) {
    const x = snap.ruleX(xOf(dec));
    ctx.beginPath();
    ctx.moveTo(x, axisY);
    ctx.lineTo(x, axisY + tickLength(dec, g));
    ctx.stroke();
    if (dec % 10 !== 0) continue;
    ctx.textAlign = flushAlign(dec, extent, ["left", "right"]);
    ctx.fillText(degreeLabel(p, dec), dec === -extent ? rect.x : dec === extent ? rect.x + rect.w : x, labelBaseline);
  }
  ctx.setLineDash([4, 3]);
  for (const dec of [obliquity, -obliquity]) {
    const x = snap.ruleX(xOf(dec));
    ctx.beginPath();
    ctx.moveTo(x, axisY - band);
    ctx.lineTo(x, axisY + band);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const byPlanet = new Map(bodies.map((body) => [body.planet, body]));
  ctx.font = `${g}px ${bodyFont(p)}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const glyph of declinationGlyphs(p.dashboard, "bar", rect, g, m)) {
    const body = byPlanet.get(glyph.planet)!;
    const x = snap.ruleX(xOf(body.dec));
    ctx.strokeStyle = lines.rule;
    ctx.beginPath();
    ctx.moveTo(glyph.x, glyph.y + g * 0.6);
    ctx.lineTo(x, axisY - band);
    ctx.lineTo(x, axisY);
    ctx.stroke();
    ctx.fillStyle = body.color;
    ctx.fillText(body.glyph, glyph.x, glyph.y);
    paintMotionMarker(p, body, glyph.x, glyph.y, g);
  }
  ctx.restore();
}

/** Mirrored setting: 0–30° ruler, north above, south below; both rows connect to the ruler. */
export function paintFoldedDeclinationBar(p: DashboardPaint, rect: DashRect, g: number, lines: Lines) {
  const { ctx } = p;
  const { bodies, obliquity, extent } = declinationBodies(p);
  const m = measureScaleMetrics(ctx, p, g);
  const geometry = barGeometry("folded-bar", rect, g, m);
  const snap = moduleLineSnap(ctx, lines);
  const axisY = snap.axisY(geometry.axisY);
  const { x0, x1, labelBaseline, northY, southY } = geometry;
  const xOf = (dec: number) => x0 + (Math.abs(dec) / extent) * (x1 - x0);
  const band = g * 0.6;
  const muted = p.color("var(--aries-text-muted)");
  ctx.save();
  ctx.fillStyle = p.color(OUT_OF_BOUNDS);
  ctx.fillRect(xOf(obliquity), axisY - band, x1 - xOf(obliquity), band * 2);
  ctx.strokeStyle = lines.frame;
  ctx.lineWidth = snap.frameWidth;
  ctx.beginPath();
  ctx.moveTo(x0, axisY);
  ctx.lineTo(x1, axisY);
  ctx.stroke();
  ctx.lineWidth = snap.ruleWidth;
  ctx.strokeStyle = lines.rule;
  ctx.fillStyle = muted;
  ctx.font = `${m.label}px ${p.fonts.ui}`;
  ctx.textBaseline = "alphabetic";
  for (let dec = 0; dec <= extent; dec += 1) {
    const x = snap.ruleX(xOf(dec));
    ctx.beginPath();
    ctx.moveTo(x, axisY);
    ctx.lineTo(x, axisY + tickLength(dec, g));
    ctx.stroke();
  }
  ctx.setLineDash([4, 3]);
  const ex = snap.ruleX(xOf(obliquity));
  ctx.beginPath();
  ctx.moveTo(ex, axisY - band);
  ctx.lineTo(ex, axisY + band);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(p.t("dashboard.declination.north"), rect.x, northY);
  ctx.fillText(p.t("dashboard.declination.south"), rect.x, southY);
  ctx.font = `${g}px ${bodyFont(p)}`;
  ctx.textAlign = "center";
  const byPlanet = new Map(bodies.map((body) => [body.planet, body]));
  for (const glyph of declinationGlyphs(p.dashboard, "folded-bar", rect, g, m)) {
    const body = byPlanet.get(glyph.planet)!;
    const north = body.dec >= 0;
    const bend = axisY + (north ? -band : band);
    const x = snap.ruleX(xOf(body.dec));
    ctx.strokeStyle = lines.rule;
    ctx.beginPath();
    ctx.moveTo(glyph.x, glyph.y + (north ? 1 : -1) * g * 0.6);
    ctx.lineTo(x, bend);
    ctx.lineTo(x, axisY);
    ctx.stroke();
    ctx.fillStyle = body.color;
    ctx.fillText(body.glyph, glyph.x, glyph.y);
    paintMotionMarker(p, body, glyph.x, glyph.y, g);
  }
  // Keep ruler numbers in front of the southern leaders where their paths cross.
  ctx.font = `${m.label}px ${p.fonts.ui}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = muted;
  for (let dec = 0; dec <= extent; dec += 10) {
    const x = snap.ruleX(xOf(dec));
    ctx.textAlign = dec === extent ? "right" : "center";
    ctx.fillText(`${dec}°`, dec === extent ? x1 : x, labelBaseline);
  }
  ctx.restore();
}

/** 1-D label spreading: keep order, at least `spacing` apart, least total shift. */
export function spreadLabels(targets: number[], spacing: number, min: number, max: number): number[] {
  const sign = targets.length > 1 && targets[0] > targets[targets.length - 1] ? -1 : 1;
  const values = targets.map((t) => t * sign);
  const lo = sign > 0 ? min : -max;
  const hi = sign > 0 ? max : -min;
  type Cluster = { start: number; count: number };
  const first = (c: Cluster) => {
    let mean = 0;
    for (let k = 0; k < c.count; k++) mean += values[c.start + k] - k * spacing;
    return Math.min(hi - (c.count - 1) * spacing, Math.max(lo, mean / c.count));
  };
  const clusters: Cluster[] = [];
  values.forEach((_, i) => {
    clusters.push({ start: i, count: 1 });
    while (clusters.length > 1) {
      const last = clusters[clusters.length - 1];
      const prev = clusters[clusters.length - 2];
      if (first(prev) + prev.count * spacing <= first(last)) break;
      prev.count += last.count;
      clusters.pop();
    }
  });
  return clusters.flatMap((c) => Array.from({ length: c.count }, (_, k) => (first(c) + k * spacing) * sign));
}

const dm = (deg: number) => {
  const minutes = Math.round(Math.abs(deg) * 60);
  return `${Math.floor(minutes / 60)}°${String(minutes % 60).padStart(2, "0")}′`;
};

/**
 * The Inspector's speed-trend arrow (lucide ArrowUpRight / ArrowDownRight at
 * 0.9em, stroke 2 on its 24-unit grid), standing on the text baseline.
 */
function paintTrendArrow(ctx: CanvasRenderingContext2D, direction: "up" | "down", x: number, y: number, size: number, color: string) {
  const s = size * 0.9;
  const top = y - s * 0.8;
  const at = (u: number, v: number): [number, number] => [x + (u / 24) * s, top + (v / 24) * s];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = (2 * s) / 24;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (direction === "up") {
    ctx.moveTo(...at(7, 17)); ctx.lineTo(...at(17, 7));
    ctx.moveTo(...at(7, 7)); ctx.lineTo(...at(17, 7)); ctx.lineTo(...at(17, 17));
  } else {
    ctx.moveTo(...at(7, 7)); ctx.lineTo(...at(17, 17));
    ctx.moveTo(...at(17, 7)); ctx.lineTo(...at(17, 17)); ctx.lineTo(...at(7, 17));
  }
  ctx.stroke();
  ctx.restore();
}

/** Paint runs left to right and return the end x (`paint: false` only measures). */
function drawRuns(p: Pick<DashboardPaint, "ctx" | "fonts">, runs: Run[], x: number, y: number, size: number, color: string, paint = true) {
  const { ctx } = p;
  runs.forEach((run, i) => {
    if (run.arrow) {
      if (paint) paintTrendArrow(ctx, run.arrow, x, y, size, run.color ?? color);
      x += size * 0.9 + size * 0.3;
      return;
    }
    // A subscript (a planet's R / station marker) sits on its glyph's lower
    // right, as on the wheel; the glyph's trailing gap then follows it.
    ctx.font = run.subscript
      ? `${Math.round(size * 0.6)}px ${p.fonts.ui}`
      : run.symbol
        ? `${Math.round(size * 1.15)}px ${run.fontFamily ?? p.fonts.symbols}`
        : run.fontFamily ? `${Math.round(size * 1.15)}px ${run.fontFamily}` : `${run.weight ?? 400} ${size}px ${p.fonts.ui}`;
    if (paint) {
      ctx.fillStyle = run.color ?? color;
      ctx.fillText(run.text, x, run.subscript ? y + size * 0.2 : y);
    }
    const gap = (run.symbol || run.subscript) && !runs[i + 1]?.subscript ? size * 0.25 : 0;
    x += ctx.measureText(run.text).width + gap;
  });
  return x;
}

const runText = (run: Run) => (run.separator ?? "") + run.text;

/**
 * The layout never depends on the Moon text and the wheel keeps priority: a
 * row wider than its room (up to the nearest painted object) shortens its
 * `fit` run by the outer-label prefix rule and never moves anything else.
 */
export function fitRunsToWidth(p: Pick<DashboardPaint, "ctx" | "fonts">, runs: Run[], size: number, width: number): Run[] {
  const shown = (list: Run[]) => list.map((run) => ({ ...run, text: runText(run), separator: undefined }));
  const total = (list: Run[]) => drawRuns(p, shown(list), 0, 0, size, "", false);
  const index = runs.findIndex((run) => run.fit);
  if (index < 0 || total(runs) <= width + 0.5) return shown(runs);
  const fits = (text: string, abbreviated: boolean) => total(runs.map((run, i) => (
    i === index ? { ...run, text: abbreviated ? `${text}.` : text } : run))) <= width + 0.5;
  const { prefix, abbreviated } = fitOuterLabelPrefix(runs[index].text, fits);
  if (!prefix) return shown(runs.filter((_, i) => i !== index));
  return shown(runs.map((run, i) => (i === index ? { ...run, text: abbreviated ? `${prefix}.` : prefix } : run)));
}

/** Opacity of the Moon's Next contact value while the Moon is void of course. */
export const VOID_NEXT_ALPHA = 0.6;

/** Moon status rows: label (muted) and value (primary). */
export function moonListRows(p: DashboardPaint): Array<[string, Run[]]> {
  const moon = p.dashboard.moon;
  if (!moon) return [];
  const { t } = p;
  const entries = new Map<number, ChartDashboardBody>((p.dashboard.bodies ?? []).map((b) => [b.planet, b]));
  const planetRuns = (planet: number): Run[] => {
    const entry = entries.get(planet);
    const color = bodyColor(p, entry);
    const glyph: Run = { text: entry?.glyph ?? "", symbol: true, fontFamily: bodyFont(p), color };
    return entry?.motion ? [glyph, { text: entry.motion, subscript: true, color }] : [glyph];
  };
  const contact = (c: typeof moon.last): Run[] =>
    c ? [
      { text: c.glyph, symbol: true, fontFamily: p.fonts.aspect, color: bodyColor(p, c) },
      ...planetRuns(c.planet),
      { text: dm(c.orb) },
    ] : [{ text: "—" }];
  const day = moon.lunarDay.meanDay != null
    ? t("dashboard.moon.dayWithMean", { day: moon.lunarDay.day, mean: moon.lunarDay.meanDay })
    : t("dashboard.moon.day", { day: moon.lunarDay.day });
  const sep = " · ";
  // Shown only where the Inspector shows lunar mansions: number, Arabic name,
  // then the transliteration, muted as in the Inspector.
  const mansionRow: Array<[string, Run[]]> = moon.mansion ? [[t("dashboard.moon.mansion"), [
    { text: `${moon.mansion.number} ` },
    { text: moon.mansion.arabic, fontFamily: ARABIC_FONT },
    { text: moon.mansion.transliteration, separator: sep, color: p.color("var(--aries-text-muted)"), fit: true },
  ]]] : [];
  // Speed, the trend arrow (as in the Inspector), then swift or slow.
  const perDay = t("dashboard.moon.perDay", { value: dm(moon.longitudeSpeed) });
  const pace = t(moon.swift ? "dashboard.moon.swift" : "dashboard.moon.slow");
  const speedRuns: Run[] = moon.speedTrend
    ? [{ text: `${perDay} ` }, { text: "", arrow: moon.speedTrend, color: p.color("var(--aries-text-muted)") }, { text: pace }]
    : [{ text: [perDay, pace].join(sep) }];
  const hemisphere = moon.latitude >= 0 ? t("dashboard.declination.north") : t("dashboard.declination.south");
  return [
    [t("dashboard.moon.phase"), [{ text: [dm(moon.elongation), t(moon.increasingInLight ? "dashboard.moon.waxing" : "dashboard.moon.waning"), day].join(sep) }]],
    [t("dashboard.moon.speed"), speedRuns],
    [t("dashboard.moon.latitude"), [{ text: [`${dm(moon.latitude)} ${hemisphere}`, t(moon.increasingInLatitude ? "dashboard.moon.rising" : "dashboard.moon.falling")].join(sep) }]],
    ...mansionRow,
    [t("dashboard.moon.last"), contact(moon.last)],
    [t("dashboard.moon.next"), contact(moon.next)],
  ];
}

export function paintMoonList(p: DashboardPaint, rect: DashRect, size: number, lines: Lines, heading = true) {
  const { ctx } = p;
  const rows = moonListRows(p);
  if (!rows.length) return;
  const text = p.color("var(--aries-text-primary)");
  const muted = p.color("var(--aries-text-muted)");
  const row = moonRowHeight(size);
  const entries = new Map<number, ChartDashboardBody>((p.dashboard.bodies ?? []).map((b) => [b.planet, b]));
  const moonEntry = entries.get(1);
  const moonVoid = p.dashboard.moon?.voidOfCourse.isVoid === true;
  ctx.save();
  // Rows stand on baselines counted up from the box's bottom edge: the last
  // row's baseline is the box's bottom, so beside the grid or the scale the
  // list shares their bottom line (descenders hang below, as in type).
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `${size}px ${p.fonts.ui}`;
  const ascent = ctx.measureText("Hx").actualBoundingBoxAscent || size * 0.72;
  const baselines = rows.map((_, i) => moonRowBaseline(rect, size, i, rows.length));
  if (heading) {
    const headingBaseline = baselines[0] - row * 1.5;
    const headingSize = Math.round(size * 1.05);
    // Void of course is named in the title, only while the Moon is void.
    drawRuns(p, [
      { text: moonEntry?.glyph ?? "", symbol: true, fontFamily: bodyFont(p), color: bodyColor(p, moonEntry) },
      {
        text: p.t(p.dashboard.moon?.voidOfCourse.isVoid ? "dashboard.moon.headingVoid" : "dashboard.moon.heading"),
        color: text,
        weight: 500,
      },
    ], rect.x, headingBaseline, headingSize, text);
    // The rule halves the space between the heading's baseline and the first row's ink.
    const snap = moduleLineSnap(ctx, lines);
    const ruleY = snap.ruleY((headingBaseline + baselines[0] - ascent) / 2);
    ctx.strokeStyle = lines.rule;
    ctx.lineWidth = snap.ruleWidth;
    ctx.beginPath();
    ctx.moveTo(rect.x, ruleY);
    ctx.lineTo(rect.x + rect.w, ruleY);
    ctx.stroke();
  }
  ctx.font = `${size}px ${p.fonts.ui}`;
  const labelW = Math.max(...rows.map(([label]) => ctx.measureText(label).width)) + size;
  rows.forEach(([label, runs], i) => {
    const y = baselines[i];
    ctx.font = `${size}px ${p.fonts.ui}`;
    ctx.fillStyle = muted;
    ctx.fillText(label, rect.x, y);
    const valueX = rect.x + labelW;
    // Only a row that would reach a painted object shortens (wheel first).
    const band = moonRowBand(rect, size, i, rows.length);
    const limit = textRightLimit(p.obstacles, rect, valueX, band.y, band.y + band.h, size * 0.5);
    // While the Moon is void its Next contact (the last row) stays legible
    // but set back: it shows what comes next, not a contact that counts.
    const setBack = moonVoid && i === rows.length - 1;
    if (setBack) ctx.globalAlpha = VOID_NEXT_ALPHA;
    drawRuns(p, fitRunsToWidth(p, runs, size, limit - valueX), valueX, y, size, text);
    if (setBack) ctx.globalAlpha = 1;
  });
  ctx.restore();
}
