// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChartDashboardModules } from "./types";

/**
 * Chart dashboard layout. Every
 * size follows the surface continuously, without steps: the module grid cell
 * (and with it gap and text sizes) comes from the surface's short side
 * alone, so modules never shrink while the surface grows; the wheel then takes
 * the largest circle that clears the corner text and the modules. Every input
 * is continuous, so the wheel grows smoothly too (no pumping).
 *
 * Rhythm (decisions 2026-10-23, A): module bottoms sit at the side edge
 * inset, neighbouring modules are one gap apart, and the wheel clears the
 * modules' painted ink (grid glyph ink, Moon heading ink), not their boxes.
 *
 * Placement: the triangular aspect grid in the bottom-left corner (or, with
 * the corner setting, turned 90° clockwise into the top-left corner while the
 * chart-data block moves to the bottom left); the
 * declination scale as a bar beside the grid (Moon list above its right end)
 * or as a strip in the right column (Moon list top left, or bottom right
 * where that keeps a clearly larger wheel). Bar or strip is whichever keeps
 * the larger wheel; the surface's aspect breaks ties. The "always horizontal"
 * setting keeps the bar.
 *
 * All values are CSS px. Pure and cached: the same inputs return the same
 * layout object, on screen, in export and for hover.
 */

export type DashRect = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };

export type DashboardCorners = Record<"topLeft" | "topRight" | "bottomLeft" | "bottomRight", DashRect | null>;
/** Corner areas the wheel and modules keep clear: the top corners. */
export type ReservedCorners = Pick<DashboardCorners, "topLeft" | "topRight">;

export type DashboardLayoutInput = {
  width: number;
  height: number;
  /** Corner overlay edge inset. */
  inset: number;
  corners: ReservedCorners;
  /** Further boxes the wheel must clear (title bar). */
  obstacles?: readonly DashRect[];
  /** Grid bodies (rows of the triangle). */
  bodies: number;
  modules: ChartDashboardModules;
  /** Larger aspect grid cells; other module typography retains its own scale. */
  gridLarge?: boolean;
  mirrored: boolean;
  /** Keep the horizontal bar on every surface (setting; placement A2). */
  horizontal?: boolean;
  /** Moon list value rows (six; five without the mansion row). */
  moonRows?: number;
};

export type DashboardScaleKind = "bar" | "folded-bar" | "strip";

export type DashboardLayout = {
  cell: number;
  gap: number;
  /** Body glyph size on the declination scale. */
  glyph: number;
  /** Moon list text size. */
  text: number;
  /** The grid's bounding square (cellBox maps cells). */
  grid: { left: number; bottom: number; size: number } | null;
  scale: { rect: DashRect; kind: DashboardScaleKind } | null;
  moon: DashRect | null;
  /** Painted wheel envelope (outer labels included). */
  wheel: { cx: number; cy: number; r: number } | null;
};

/** Grid cell range over the short-side ramp. */
export const MIN_CELL = 20;
export const MAX_CELL = 28;
const CELL_RAMP_FROM = 700;
const CELL_RAMP_TO = 1100;

/** Grid cell for the surface: 20 px up to a 700 px short side, 28 px from 1100 px, linear between. */
export function dashboardCell(width: number, height: number): number {
  const t = (Math.min(width, height) - CELL_RAMP_FROM) / (CELL_RAMP_TO - CELL_RAMP_FROM);
  return MIN_CELL + (MAX_CELL - MIN_CELL) * Math.max(0, Math.min(1, t));
}

/** Module text size (Moon list, merged chart-data block): max(11, 0.55 × cell). */
export const dashboardTextSize = (width: number, height: number) =>
  Math.max(11, dashboardCell(width, height) * 0.55);

/**
 * Screen box of grid cell (row, col), col ≤ row, row/col in body order (the
 * diagonal col = row holds the axis glyph): row r runs down, col right.
 */
export function cellBox(grid: NonNullable<DashboardLayout["grid"]>, n: number, c: number, row: number, col: number): DashRect {
  const top = grid.bottom - grid.size;
  return { x: grid.left + col * c, y: top + row * c, w: c, h: c };
}

/**
 * While the dashboard shows, one top-left block carries the chart data:
 * date and time, then place and coordinates, then the house system. The
 * bottom-left and bottom-right corner blocks are not shown. With the corner
 * grid the same block sits bottom left instead.
 */
export function dashboardTopLeftLines(top: readonly string[], place: readonly string[], house: readonly string[]): string[] {
  return [...top, ...place, ...house].filter((line) => Boolean(line));
}

/**
 * Wheel-first corner reservations. The wheel's circle comes only from stable
 * inputs (surface, modules, settings, body count, title bar): corner text gets
 * a fixed area from its type sizes and a fixed row count, never its measured
 * box, so stepping (more retrograde or phasis rows), live text and pane drags
 * cannot move the wheel. Text beyond its area draws over the chart.
 */
export const RESERVED_TOP_LEFT_LINES = 5; // date, time, place, coordinates, house system
export const RESERVED_TOP_LEFT_EMS = 12;
export const RESERVED_TOP_RIGHT_ROWS = 6; // day/hour pair, header, three signal rows
export const RESERVED_TOP_RIGHT_EMS = 13;

export type CornerReservationMetrics = {
  edgeInset: number;
  topEdgeInset: number;
  /** Event-row height and label size of the top-right overlay. */
  lineHeight: number;
  labelSize: number;
  gapAfterDayHour: number;
  gapBetweenGroups: number;
  /** Corner-text line height factor and line gap (WheelOverlayStyle). */
  cornerLineHeight: number;
  infoGap: number;
};

export function reservedDashboardCorners(width: number, height: number, metrics: CornerReservationMetrics): ReservedCorners {
  const text = dashboardTextSize(width, height);
  const topLeftH = RESERVED_TOP_LEFT_LINES * text * metrics.cornerLineHeight + (RESERVED_TOP_LEFT_LINES - 1) * metrics.infoGap;
  const topRightW = metrics.labelSize * RESERVED_TOP_RIGHT_EMS;
  const topRightH = RESERVED_TOP_RIGHT_ROWS * metrics.lineHeight + metrics.gapAfterDayHour + metrics.gapBetweenGroups;
  const info = { x: metrics.edgeInset, y: metrics.topEdgeInset, w: text * RESERVED_TOP_LEFT_EMS, h: topLeftH };
  const topRight = { x: width - metrics.edgeInset - topRightW, y: metrics.topEdgeInset, w: topRightW, h: topRightH };
  return { topLeft: info, topRight };
}

const fitted = new WeakMap<DashboardLayout, { key: string; layout: DashboardLayout }>();

/**
 * After the wheel is fixed, modules yield to the painted corner text: the
 * strip starts below the top-right text (and drops out when too short), and a
 * top-left Moon list moves below the top-left text where it stays clear of
 * the wheel and the grid. The wheel is unchanged. The same painted boxes
 * return the same layout object, so retained paint can skip unchanged frames.
 */
export function fitModulesToCornerText(layout: DashboardLayout, painted: Partial<ReservedCorners> | null | undefined): DashboardLayout {
  const topRight = painted?.topRight ?? null;
  const topLeft = painted?.topLeft ?? null;
  const strip = layout.scale?.kind === "strip" ? layout.scale.rect : null;
  const stripFloor = strip && topRight ? topRight.y + topRight.h + layout.gap : -Infinity;
  const moon = layout.moon;
  const moonFloor = moon && topLeft && moon.x < (layout.wheel?.cx ?? 0) ? topLeft.y + topLeft.h + layout.gap : -Infinity;
  const moveStrip = Boolean(strip && stripFloor > strip.y);
  const moveMoon = Boolean(moon && moonFloor > moon.y);
  if (!moveStrip && !moveMoon) return layout;
  const key = `${Math.round(stripFloor * 2)}|${Math.round(moonFloor * 2)}`;
  const hit = fitted.get(layout);
  if (hit?.key === key) return hit.layout;
  let scale = layout.scale;
  if (moveStrip && strip && layout.scale) {
    const bottom = strip.y + strip.h;
    scale = bottom - stripFloor >= layout.glyph * 3 ? { ...layout.scale, rect: { ...strip, y: stripFloor, h: bottom - stripFloor } } : null;
  }
  let nextMoon = moon;
  if (moveMoon && moon) {
    const candidate = { ...moon, y: moonFloor };
    const gridTop = layout.grid ? layout.grid.bottom - layout.grid.size : Infinity;
    const wheel = layout.wheel;
    const clear = candidate.y + candidate.h + layout.gap <= gridTop
      && (!wheel || rectDist({ x: wheel.cx, y: wheel.cy }, candidate) >= wheel.r + layout.gap);
    if (clear) nextMoon = candidate;
  }
  const out = scale === layout.scale && nextMoon === moon ? layout : { ...layout, scale, moon: nextMoon };
  fitted.set(layout, { key, layout: out });
  return out;
}

/**
 * Moon list rows: heading, rule, then value rows, set on baselines counted up
 * from the box's bottom edge (the last row's baseline is the bottom edge).
 */
export const moonRowHeight = (text: number) => text * 1.6;
export const moonRowBaseline = (rect: DashRect, text: number, index: number, count: number) =>
  rect.y + rect.h - moonRowHeight(text) * (count - 1 - index);
/** A row's band (hover, text room): one row height, its baseline at the usual four-fifths. */
export const moonRowBand = (rect: DashRect, text: number, index: number, count: number): DashRect => {
  const row = moonRowHeight(text);
  return { x: rect.x, y: moonRowBaseline(rect, text, index, count) - row * 0.8, w: rect.w, h: row };
};
/** Heading plus value rows (phase, speed, latitude, [mansion], last, next). */
export const moonListHeight = (text: number, rows = 6) => moonRowHeight(text) * (rows + 1.4);

const GAP_PER_CELL = 0.6;
/** Morinus scale symbols need a larger em than Moon text for similar ink height. */
const MIN_SCALE_GLYPH_PER_TEXT = 1.25;
/** The original glyph size remains the target when the scale has room. */
const SCALE_GLYPH_PER_CELL = 0.9;
const BAR_GLYPHS = 4.4;
const STRIP_GLYPHS = 4;
/** Keep every glyph centre and its leader inside even when bodies crowd one row. */
const BAR_MIN_SLOT = 1.1;
const MOON_WIDE_WIDTH = 17;
const MOON_PORTRAIT_WIDTH = 20;
const MIN_WHEEL = 100;
/** Placements whose wheels differ by less than this are equal; the preferred one wins. */
const RADIUS_TIE = 1;
/**
 * Ink-true reservations: axis glyphs leave the grid's top edge and its
 * diagonal (and right) edge open by about this share of a cell; the Moon
 * heading's ink starts this share of the text size below the list's box.
 */
const GRID_INK_TOP = 0.25;
const GRID_INK_DIAGONAL = 0.3;
const MOON_INK_TOP = 0.35;
/** The Moon list stands this many gaps above the one-sided bar's ink (decision 2026-10-23). */
const ONE_SIDED_BAR_MOON_GAPS = 1.5;

/**
 * Painted height of the one-sided bar (dashboard-paint `barGeometry`), from
 * the degree labels' baseline up: digit ascent, label gap (0.45 g), the glyph
 * row above the axis (1.9 g) and the glyphs' ascent, at the painter's typical
 * proportions (`estimateScaleMetrics`).
 */
export function oneSidedBarInkHeight(g: number): number {
  const label = Math.max(9, Math.round(g * 0.45));
  return label * 0.72 + g * 0.45 + g * 1.9 + g * 0.4;
}
/** Surfaces taller than this aspect prefer the bar among equal placements. */
const PORTRAIT_ASPECT = 1.15;

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function polyDist(p: Pt, poly: readonly Pt[]): number {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    best = Math.min(best, segDist(p, a, b));
  }
  return inside ? 0 : best;
}

function rectDist(p: Pt, r: DashRect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - r.x - r.w);
  const dy = Math.max(r.y - p.y, 0, p.y - r.y - r.h);
  return Math.hypot(dx, dy);
}

type Obstacle = { rect: DashRect } | { poly: Pt[] };
type Circle = { cx: number; cy: number; r: number };

const DIRECTIONS = Array.from({ length: 16 }, (_, i) => [Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)] as const);
/** Weight of centrality against clearance: a 300 px move from the centre costs about 1 px of radius. */
const CENTRALITY_WEIGHT = 0.003;
/** Minimum distance between solver seeds. */
const SEED_SPREAD = 48;

/**
 * Largest circle inside `W × H` clearing every obstacle by `gap`, preferring
 * the centre: the maximum of one smooth objective, clearance minus a small
 * centrality term (|dx| + 0.2|dy|), so the centre is unique and moves
 * continuously as the surface changes. Seeds sit on a grid anchored to the
 * surface origin; 16-direction pattern search, then the active obstacles'
 * gradients follow a ridge between two obstacles.
 */
export function solveWheelCircle(W: number, H: number, obstacles: readonly Obstacle[], gap: number): Circle | null {
  const clearance = (x: number, y: number) => {
    let f = Math.min(x, W - x, y, H - y);
    for (const o of obstacles) {
      const d = ("rect" in o ? rectDist({ x, y }, o.rect) : polyDist({ x, y }, o.poly)) - gap;
      if (d < f) f = d;
    }
    return f;
  };
  const score = (x: number, y: number) =>
    clearance(x, y) - CENTRALITY_WEIGHT * (Math.abs(x - W / 2) + Math.abs(y - H / 2) * 0.2);
  const ascend = (x0: number, y0: number) => {
    let cur = { x: x0, y: y0, s: score(x0, y0) };
    for (const step of [8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625]) {
      for (let moved = true, guard = 0; moved && guard < 300; guard++) {
        moved = false;
        for (const [dx, dy] of DIRECTIONS) {
          const x = cur.x + dx * step;
          const y = cur.y + dy * step;
          const s = score(x, y);
          if (s > cur.s + 1e-9) {
            cur = { x, y, s };
            moved = true;
          }
        }
      }
    }
    return cur;
  };
  // Pattern search stalls on a ridge between two obstacles whose direction
  // is none of the sixteen; follow it from the active constraints' gradients.
  const terms = (x: number, y: number) => [
    x, W - x, y, H - y,
    ...obstacles.map((o) => ("rect" in o ? rectDist({ x, y }, o.rect) : polyDist({ x, y }, o.poly)) - gap),
  ];
  const ridge = (start: { x: number; y: number; s: number }) => {
    let cur = start;
    for (let iter = 0; iter < 80; iter++) {
      const h = 0.01;
      const at = terms(cur.x, cur.y);
      const dx = terms(cur.x + h, cur.y);
      const dy = terms(cur.x, cur.y + h);
      const low = Math.min(...at);
      const grads = at.flatMap((v, i) => (v <= low + 0.5 ? [[(dx[i] - v) / h, (dy[i] - v) / h] as const] : []));
      const cg = [
        CENTRALITY_WEIGHT * Math.sign(cur.x - W / 2),
        CENTRALITY_WEIGHT * 0.2 * Math.sign(cur.y - H / 2),
      ];
      const dirs: Array<readonly [number, number]> = [[-cg[0], -cg[1]]];
      for (let i = 0; i < grads.length; i++) {
        dirs.push(grads[i]);
        for (let j = i + 1; j < grads.length; j++) {
          const [ux, uy] = [grads[i][0] - grads[j][0], grads[i][1] - grads[j][1]];
          dirs.push([grads[i][0] + grads[j][0], grads[i][1] + grads[j][1]], [-uy, ux], [uy, -ux]);
        }
      }
      let bestDir: readonly [number, number] | null = null;
      let bestRate = 1e-7;
      for (const [vx, vy] of dirs) {
        const len = Math.hypot(vx, vy);
        if (len < 1e-9) continue;
        const [ux, uy] = [vx / len, vy / len];
        const rate = Math.min(...grads.map(([gx, gy]) => gx * ux + gy * uy)) - (cg[0] * ux + cg[1] * uy);
        if (rate > bestRate) {
          bestRate = rate;
          bestDir = [ux, uy];
        }
      }
      if (!bestDir) break;
      let moved = false;
      for (let step = 4; step >= 1 / 64; step /= 2) {
        const x = cur.x + bestDir[0] * step;
        const y = cur.y + bestDir[1] * step;
        const s = score(x, y);
        if (s > cur.s + 1e-9) {
          cur = { x, y, s };
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
    return cur;
  };
  const step = 16;
  const seeds: Array<{ x: number; y: number; s: number }> = [];
  for (let x = step / 2; x < W; x += step) {
    for (let y = step / 2; y < H; y += step) seeds.push({ x, y, s: score(x, y) });
  }
  seeds.sort((a, b) => b.s - a.s);
  // The best seeds, spread out so that every near-best position is tried.
  const picked: typeof seeds = [];
  for (const seed of seeds) {
    if (picked.length >= 8) break;
    if (picked.every((p) => Math.hypot(p.x - seed.x, p.y - seed.y) >= SEED_SPREAD)) picked.push(seed);
  }
  let best = { x: W / 2, y: H / 2, s: -Infinity };
  for (const seed of picked) {
    const cur = ridge(ascend(seed.x, seed.y));
    if (cur.s > best.s) best = cur;
  }
  const r = clearance(best.x, best.y);
  return r < MIN_WHEEL ? null : { cx: best.x, cy: best.y, r };
}

/**
 * Boxes the modules occupy, as outer-label obstacles: the grid as one box per
 * staircase row (its empty diagonal, where the wheel nests, stays free), then
 * the declination scale and the Moon list.
 */
export function dashboardModuleBoxes(layout: DashboardLayout): DashRect[] {
  const boxes: DashRect[] = [];
  if (layout.grid) {
    const { left, bottom, size } = layout.grid;
    const c = layout.cell;
    const rows = Math.round(size / c);
    for (let row = 0; row < rows; row++) {
      boxes.push({ x: left, y: bottom - size + row * c, w: (row + 1) * c, h: c });
    }
  }
  if (layout.scale) boxes.push(layout.scale.rect);
  if (layout.moon) boxes.push(layout.moon);
  return boxes;
}

function layoutKey(input: DashboardLayoutInput): string {
  const q = (v: number) => Math.round(v * 2) / 2;
  const box = (r: DashRect | null) => (r ? `${q(r.x)},${q(r.y)},${q(r.w)},${q(r.h)}` : "-");
  return [
    q(input.width), q(input.height), q(input.inset), input.bodies,
    Number(input.modules.aspectGrid), Number(input.modules.declination), Number(input.modules.moon), Number(Boolean(input.gridLarge)), Number(input.mirrored), Number(Boolean(input.horizontal)), input.moonRows ?? 6,
    box(input.corners.topLeft), box(input.corners.topRight),
    ...(input.obstacles ?? []).map(box),
  ].join("|");
}

const cache = new Map<string, DashboardLayout>();
const CACHE_LIMIT = 24;

export function solveDashboardLayout(input: DashboardLayoutInput): DashboardLayout {
  const key = layoutKey(input);
  const hit = cache.get(key);
  if (hit) return hit;
  const layout = computeDashboardLayout(input);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, layout);
  return layout;
}

/**
 * The grid staircase the wheel clears: its painted ink, inside the cell
 * lattice, for the `L`-wide square at (left, top). Axis glyphs leave the top
 * edge and the falling diagonal open.
 */
export function gridInk(left: number, top: number, L: number, cell: number): Pt[] {
  const t = cell * GRID_INK_TOP;
  const s = cell * GRID_INK_DIAGONAL;
  const local: Pt[] = [{ x: 0, y: t }, { x: cell - s, y: t }, { x: L - s, y: L - cell + t }, { x: L - s, y: L }, { x: 0, y: L }];
  return local.map((p) => ({ x: left + p.x, y: top + p.y }));
}

/** The Moon list the wheel clears: from its heading ink down. */
export const moonInk = (rect: DashRect, text: number): DashRect => {
  const top = text * MOON_INK_TOP;
  return { ...rect, y: rect.y + top, h: rect.h - top };
};

type Kind = "bar" | "strip";
type MoonSlot = "topLeft" | "bottomRight";
type Placement = { grid: Pt[] | null; gridTop: number; scale: DashRect | null; moon: DashRect | null; barMin: number };

function computeDashboardLayout(input: DashboardLayoutInput): DashboardLayout {
  const { width: W, height: H, inset, corners, modules } = input;
  const c = dashboardCell(W, H);
  const gridCell = c * (input.gridLarge ? 1.2 : 1);
  const gap = c * GAP_PER_CELL;
  const text = dashboardTextSize(W, H);
  const minGlyph = text * MIN_SCALE_GLYPH_PER_TEXT;
  const naturalGlyph = c * SCALE_GLYPH_PER_CELL;
  // Left limit of the bottom row (bar, Moon list): right of the grid.
  const gridRight = modules.aspectGrid ? inset + input.bodies * gridCell + gap : inset;
  const barRoom = Math.max(0, W - inset - gridRight);
  const barGlyph = Math.max(minGlyph, Math.min(naturalGlyph, barRoom / Math.max(1, input.bodies * BAR_MIN_SLOT)));
  const stripGlyph = naturalGlyph;
  const moonH = moonListHeight(text, input.moonRows ?? 6);
  const gx = inset;
  const gridBottom = H - inset;
  const fixed: Obstacle[] = [corners.topLeft, corners.topRight, ...(input.obstacles ?? [])]
    .filter((b): b is DashRect => Boolean(b && b.w > 0 && b.h > 0))
    .map((rect) => ({ rect }));
  const columnTop = Math.max(...[corners.topRight, corners.topLeft].map((b) => (b ? b.y + b.h : 0))) + gap;
  const moonTopLeftY = (corners.topLeft ? corners.topLeft.y + corners.topLeft.h : inset) + gap;

  // Module rects. Without a wheel the bar is its minimum
  // width at the right end (the reservation); with one, the bar starts where
  // its top edge clears the wheel by gap (never left of the grid).
  const place = (kind: Kind, slot: MoonSlot, wheel: Circle | null): Placement => {
    const g = kind === "strip" ? stripGlyph : barGlyph;
    const L = modules.aspectGrid ? input.bodies * gridCell : 0;
    const grid = L > 0 ? gridInk(gx, gridBottom - L, L, gridCell) : null;
    const gridTop = L > 0 ? gridBottom - L : Infinity;
    const gridRight = L > 0 ? gx + L + gap : gx;
    if (kind === "bar") {
      // The mirrored bar fills 4.4 glyphs; the one-sided bar's box is its ink,
      // and its Moon list keeps 1.5 gaps so both settings read alike.
      const h = input.mirrored ? g * BAR_GLYPHS : Math.min(g * BAR_GLYPHS, oneSidedBarInkHeight(g));
      const barTop = gridBottom - h;
      const barMin = Math.max(0, Math.min(input.bodies * g * BAR_MIN_SLOT, W - inset - gridRight));
      let scale: DashRect | null = null;
      if (modules.declination) {
        let x = W - inset - barMin;
        if (wheel) {
          const dy = Math.max(0, barTop - wheel.cy);
          const reach = wheel.r + gap;
          x = dy < reach ? Math.max(gridRight, wheel.cx + Math.sqrt(reach * reach - dy * dy)) : gridRight;
        }
        scale = { x, y: barTop, w: Math.max(0, W - inset - x), h };
      }
      const moonW = Math.min(W - inset - gridRight, text * (input.horizontal ? MOON_WIDE_WIDTH : MOON_PORTRAIT_WIDTH));
      const moonBottom = modules.declination ? barTop - gap * (input.mirrored ? 1 : ONE_SIDED_BAR_MOON_GAPS) : gridBottom;
      const moon = modules.moon ? { x: W - inset - moonW, y: moonBottom - moonH, w: moonW, h: moonH } : null;
      return { grid, gridTop, scale, moon, barMin };
    }
    const w = g * STRIP_GLYPHS;
    const column: DashRect = { x: W - inset - w, y: columnTop, w, h: gridBottom - columnTop };
    const moonW = text * MOON_WIDE_WIDTH;
    if (!modules.moon) return { grid, gridTop, scale: modules.declination ? column : null, moon: null, barMin: 0 };
    if (slot === "topLeft") {
      return { grid, gridTop, scale: modules.declination ? column : null, moon: { x: gx, y: moonTopLeftY, w: moonW, h: moonH }, barMin: 0 };
    }
    const shared = moonH + gap;
    return {
      grid,
      gridTop,
      scale: modules.declination ? { ...column, h: column.h - shared } : null,
      moon: { x: W - inset - moonW, y: column.y + column.h - moonH, w: moonW, h: moonH },
      barMin: 0,
    };
  };

  const reservation = (p: Placement, kind: Kind): Obstacle[] => [
    ...fixed,
    ...(p.grid ? [{ poly: p.grid }] : []),
    ...(p.scale ? [{ rect: kind === "bar" ? { ...p.scale, x: W - inset - p.barMin, w: p.barMin } : p.scale }] : []),
    ...(p.moon ? [{ rect: moonInk(p.moon, text) }] : []),
  ];
  // A top-left Moon list must also clear the grid below it.
  const moonFits = (p: Placement, kind: Kind, slot: MoonSlot) =>
    kind === "bar" || slot !== "topLeft" || !p.moon || p.moon.y + p.moon.h + gap <= p.gridTop;

  // The wheel takes the largest circle that clears the modules, for each
  // candidate placement.
  const candidate = (kind: Kind, slot: MoonSlot) => {
    const p = place(kind, slot, null);
    return { kind, slot, wheel: moonFits(p, kind, slot) ? solveWheelCircle(W, H, reservation(p, kind), gap) : null };
  };
  // Every placement within RADIUS_TIE of the largest wheel counts as equal;
  // among those the preferred one wins: the bar on tall surfaces, otherwise
  // the strip with the Moon list top left, then bottom right.
  const radius = (o: { wheel: Circle | null }) => o.wheel?.r ?? -Infinity;
  const bar = candidate("bar", "bottomRight");
  const options = [bar];
  if (!input.horizontal && (modules.declination || modules.moon)) {
    options.unshift(candidate("strip", "topLeft"));
    if (modules.moon) options.splice(1, 0, candidate("strip", "bottomRight"));
    if (H > W * PORTRAIT_ASPECT) options.unshift(options.pop()!);
  }
  const largest = Math.max(...options.map(radius));
  const pick = options.find((o) => radius(o) >= largest - RADIUS_TIE) ?? bar;
  const wheel = pick.wheel;
  const final = place(pick.kind, pick.slot, wheel);
  const L = modules.aspectGrid ? input.bodies * gridCell : 0;
  return {
    cell: gridCell,
    gap,
    glyph: pick.kind === "strip" ? stripGlyph : barGlyph,
    text,
    grid: L > 0
      ? { left: gx, bottom: gridBottom, size: L }
      : null,
    scale: final.scale ? { rect: final.scale, kind: pick.kind === "strip" ? "strip" : input.mirrored ? "folded-bar" : "bar" } : null,
    moon: final.moon,
    wheel,
  };
}
