// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Canvas pieces shared by the astrolabe's two plate projections (the
// stereographic astrolabe and the polar azimuthal equidistant plate): the
// projection-space mapping, the graduated limb and the rete arc on it. Chart
// information and the primary-direction rows are DOM corners
// (astrolabe-corners.tsx). The daemon owns every value drawn here.

import type { AstrolabeRenderStyle } from "@/lib/chart/astrolabe-render-style";
import type { CanvasDraw } from "@/lib/chart/canvas-draw";
import type { AstrolabeAsterisms, AstrolabeStarPointer, AstrolabeZodiacDivision } from "@/lib/daemon/client";
import type { HoverRegion } from "@/stores/workspace-store";
import { resolveAstrolabeStrokeWidths } from "@/lib/chart/astrolabe-render-style";
import { resolveChartPaintTarget } from "@/lib/chart/outer-glyph-lane";
import { ANGLO_WHEEL_GEOMETRY_PROFILE } from "@/lib/chart/wheel-render-style";

/** A painted point the pointer can hover: its CSS-pixel centre and the
 * daemon-supplied caption (localized name, chart-zodiac position). */
export type AstrolabeHoverTarget = {
  x: number;
  y: number;
  width?: number;
  height?: number;
  name: string;
  detail?: string;
  /** Keep the coordinate-role caption visible while retaining inspector intent. */
  pdReprojection?: boolean;
  /** A PD significator mark on the natal ring: clicking it toggles its focus. */
  pdSignificator?: string;
  position?: string;
  inspector?: { kind: "planet"; seId: number } | { kind: "fixed_star"; code: string; longitude: number } | { kind: "fortune"; longitude: number }
    | Extract<HoverRegion, { kind: "term" | "decan" }>;
};

/** Display-only grab geometry, published with the coherent plate paint. */
export type AstrolabeReteSurface = {
  center: [number, number];
  band?: { x: number; y: number; inner: number; outer: number; padding?: number };
  rings: Array<{ x: number; y: number; inner: number; outer: number; padding?: number }>;
  segments: Array<[number, number, number, number, number?, number?]>;
  markers: Array<{ x: number; y: number; size: number }>;
  /** Set only while a solid (100%) earth is drawn in front: true where the
   * ground hides the rete, so only visible rete starts a time drag. */
  ground?: (x: number, y: number) => boolean;
};

export function createAstrolabeReteSurface(): AstrolabeReteSurface {
  return { center: [0, 0], rings: [], segments: [], markers: [] };
}

/** Renderers publish continuous bands and their edge clearances. Individual
 * glyph targets retain a five-pixel margin; outer rulers own their padding. */
export function hitAstrolabeRete(surface: AstrolabeReteSurface, x: number, y: number, zodiacPad = 5): boolean {
  if (surface.ground?.(x, y)) return false;
  if (Math.hypot(x - surface.center[0], y - surface.center[1]) < 16) return false;
  for (const marker of surface.markers) {
    const half = marker.size / 2 + zodiacPad;
    if (Math.abs(x - marker.x) <= half && Math.abs(y - marker.y) <= half) return true;
  }
  for (const { x: cx, y: cy, inner, outer, padding = 8 } of surface.rings) {
    const radius = Math.hypot(x - cx, y - cy);
    if (radius >= inner - padding && radius <= outer + padding) return true;
  }
  if (surface.band) {
    const { x: cx, y: cy, inner, outer, padding = zodiacPad } = surface.band;
    const radius = Math.hypot(x - cx, y - cy);
    if (radius >= inner - padding && radius <= outer + padding) return true;
  }
  for (const [ax, ay, bx, by, halfWidth = 0, padding = zodiacPad] of surface.segments) {
    const reach = padding + halfWidth + 1e-6; // Include the exact edge despite floating-point roundoff.
    if (x < Math.min(ax, bx) - reach || x > Math.max(ax, bx) + reach
      || y < Math.min(ay, by) - reach || y > Math.max(ay, by) + reach) continue;
    const dx = bx - ax, dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const along = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared)) : 0;
    if (Math.hypot(x - ax - along * dx, y - ay - along * dy) <= reach) return true;
  }
  return false;
}

/** Even-odd crossing parity of a point against closed screen polygons. */
export function insideEvenOdd(polygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, x: number, y: number): boolean {
  let inside = false;
  for (const polygon of polygons) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Signed clockwise travel in screen coordinates, continuous across ±π. */
export function astrolabeReteTurn(previousAngle: number, nextAngle: number): number {
  const delta = nextAngle - previousAngle;
  const turn = Math.atan2(Math.sin(delta), Math.cos(delta)) * 180 / Math.PI;
  return Math.abs(turn) < 1e-10 ? 0 : turn;
}

/** Both plate projections use the chart wheel's semantic division identity. */
export function divisionHoverTarget(
  entry: AstrolabeZodiacDivision,
  kind: "term" | "decan",
  x: number,
  y: number,
  size: number,
  name: string,
): AstrolabeHoverTarget {
  const region = { signIndex: entry.sign, rulerSeId: entry.planetId, longitude: (entry.start + entry.end) / 2 };
  return { x, y, width: size, height: size, name,
    inspector: kind === "term" ? { kind, ...region } : { kind, ...region, decanIndex: entry.index } };
}

/** Nearest hover target within `radius` CSS px of (x, y). */
export function findHoverTarget(
  targets: readonly AstrolabeHoverTarget[],
  x: number,
  y: number,
  radius: number,
): AstrolabeHoverTarget | null {
  let best: AstrolabeHoverTarget | null = null;
  let bestDistance = radius;
  for (const target of targets) {
    const dx = Math.max(0, Math.abs(target.x - x) - (target.width ?? 0) / 2);
    const dy = Math.max(0, Math.abs(target.y - y) - (target.height ?? 0) / 2);
    const distance = Math.hypot(dx, dy);
    if (distance <= bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

export type StarLabelMode = "all" | "settings" | "none";

/** One semantic identity for field, marked and asterism star hit targets. */
export function starHoverTarget(
  star: Pick<AstrolabeStarPointer, "name" | "lon" | "position"> & { nom: string },
  x: number,
  y: number,
  radius: number,
): AstrolabeHoverTarget {
  return { x, y, width: radius * 2, height: radius * 2,
    name: star.name, detail: star.nom, position: star.position,
    inspector: { kind: "fixed_star", code: star.nom, longitude: star.lon } };
}

/** The caller supplies its plate clip; both projections use the same ink. */
export function drawAsterisms(
  draw: CanvasDraw,
  layout: Layout,
  view: ViewRect,
  figures: AstrolabeAsterisms | undefined,
  style: AstrolabeRenderStyle,
  size: number,
  zoom: number,
  hoverTargets: AstrolabeHoverTarget[],
) {
  if (!figures) return;
  const ctx = draw.ctx;
  ctx.save();
  ctx.strokeStyle = style.palette.starFaint;
  ctx.lineWidth = resolveAstrolabeStrokeWidths(style, size).fine;
  ctx.globalAlpha = style.markers.starFaintOpacity;
  ctx.beginPath();
  for (const path of figures.paths) {
    traceVisiblePolyline(ctx, path.map(([x, y]) => mapPoint(layout, x, y)), view);
  }
  ctx.stroke();
  ctx.restore();
  const radius = Math.max(style.markers.starRadiusMin, size / style.markers.starRadiusDivisor)
    * astrolabeZoomMetrics(zoom, style).star * 2.5;
  for (const star of figures.stars) {
    const [x, y] = mapPoint(layout, star.x, star.y);
    const metrics = starPointerMetrics(radius, star.mag, 0, style);
    if (starPointerInView(view, x, y, metrics, "")) {
      drawStarPointer(draw, x, y, radius, star.mag, "", 0, style);
      hoverTargets.push(starHoverTarget(star, x, y, metrics.radius));
    }
  }
}

/** Whether a star pointer carries its name under the chosen label mode. */
export function starLabelShown(mode: StarLabelMode | undefined, inSettings: boolean | undefined): boolean {
  if (mode === "none") return false;
  if (mode === "all") return true;
  return Boolean(inSettings);
}

/** Star size by visual magnitude, after d3-celestial's exponential mapping
 * (r = base * exp(-k * (mag - m0))): magnitude 1 draws at the base size,
 * each brighter magnitude ~1.35x larger, clamped to the style's range.
 * Unknown magnitude draws as a star at the bright limit. */
export function starMagnitudeScale(
  mag: number | null | undefined,
  markers: AstrolabeRenderStyle["markers"],
): number {
  const m = mag == null || !Number.isFinite(mag) ? markers.starBrightLimit : mag;
  const scale = Math.exp(-markers.starMagnitudeExponent * (m - 1));
  return Math.min(markers.starScaleMax, Math.max(markers.starScaleMin, scale));
}

/** Screen-space metrics shared by painting, viewport culling and hover bounds. */
export function starPointerMetrics(
  baseRadius: number,
  mag: number | null | undefined,
  labelSize: number,
  style: AstrolabeRenderStyle,
  forceGlyph = false,
): Readonly<{ radius: number; bright: boolean; labelSize: number; labelOffset: number }> {
  const { markers } = style;
  const magnitudeRadius = baseRadius * starMagnitudeScale(mag, markers);
  const bright = forceGlyph || mag == null || !Number.isFinite(mag) || mag <= markers.starBrightLimit;
  return {
    radius: bright ? magnitudeRadius : Math.max(markers.starRadiusMin * 0.75, magnitudeRadius * 0.45),
    bright,
    labelSize: bright ? labelSize : labelSize * 0.85,
    labelOffset: Math.max(magnitudeRadius, 2) * 1.3,
  };
}

/** Conservative culling before text measurement: names extend to the right,
 * and a two-em allowance per character also covers long/localized names. */
export function starPointerInView(
  view: ViewRect,
  x: number,
  y: number,
  metrics: ReturnType<typeof starPointerMetrics>,
  label: string,
): boolean {
  const rightReach = Math.max(metrics.radius, label ? metrics.labelOffset + label.length * metrics.labelSize * 2 : 0);
  const verticalReach = Math.max(metrics.radius, metrics.labelSize);
  return x + rightReach >= view.x0 && x - metrics.radius <= view.x1
    && y + verticalReach >= view.y0 && y - verticalReach <= view.y1;
}

/** A fixed star at its magnitude. Bright stars (at or above the style's
 * bright limit) are four-pointed pointers with their engraved name, like a
 * real astrolabe rete; fainter stars are dots in the faint star colour that
 * also fade toward magnitude 6 (Astrolog's grey ramp, Stellarium's
 * fade-instead-of-vanish). `forceGlyph` keeps a user-marked star a pointer. */
export function drawStarPointer(
  draw: CanvasDraw,
  x: number,
  y: number,
  baseRadius: number,
  mag: number | null | undefined,
  name: string,
  labelSize: number,
  style: AstrolabeRenderStyle,
  forceGlyph = false,
) {
  const { markers, palette } = style;
  const metrics = starPointerMetrics(baseRadius, mag, labelSize, style, forceGlyph);
  const { radius, bright } = metrics;
  const ctx = draw.ctx;
  ctx.save();
  if (bright) {
    const inner = radius * 0.35;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? radius : inner;
      const a = (Math.PI / 4) * i - Math.PI / 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = palette.star;
    ctx.fill();
  } else {
    // Linear fade from the bright limit to magnitude 6, floored so the
    // faintest catalogue stars stay visible on the plate.
    const span = Math.max(0.1, 6 - markers.starBrightLimit);
    const t = Math.min(1, Math.max(0, ((mag as number) - markers.starBrightLimit) / span));
    ctx.globalAlpha = 1 - t * (1 - markers.starFaintOpacity);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = palette.starFaint;
    ctx.fill();
  }
  ctx.restore();
  if (name) {
    ctx.save();
    if (!bright) ctx.globalAlpha = Math.max(markers.starFaintOpacity, 0.6);
    draw.text([x + metrics.labelOffset, y], name, {
      size: metrics.labelSize,
      fill: bright ? palette.star : palette.starFaint,
      align: "left",
      baseline: "middle",
    });
    ctx.restore();
  }
}

export type Layout = {
  cx: number; // NCP screen x
  cy: number; // NCP screen y
  scale: number; // px per R_eq unit
};

/** Display zoom over the fitted plate: screen = fitted * k + (x, y). Settled
 * viewport state is saved in normalized form per radix; it does not alter
 * astrology, the rete arc or export semantics. Geometry follows k, symbols
 * use their gentler growth curves, and stroke widths stay in CSS pixels. */
export type AstrolabeZoom = { k: number; x: number; y: number };

export const ASTROLABE_ZOOM_IDENTITY: AstrolabeZoom = { k: 1, x: 0, y: 0 };
export const ASTROLABE_ZOOM_MAX = 12;

/** Quiet close-up detail shared by polar degree labels and PD point glyphs. */
export function astrolabeZoomDetail(k: number): Readonly<{ size: number; opacity: number }> {
  const zoom = Math.max(2, Number.isFinite(k) ? k : 2);
  return {
    size: Math.min(9, 7.5 * Math.pow(zoom / 2, 0.2)),
    opacity: Math.min(1, (zoom - 2) / 0.8) * 0.68,
  };
}

/** Geometry follows the full zoom. Identifying symbols grow more slowly, so
 * close body/degree contacts separate while their marks become easier to see. */
export function astrolabeZoomMetrics(k: number, style: AstrolabeRenderStyle): Readonly<{
  sphere: number;
  glyph: number;
  star: number;
  starLabel: number;
  houseNumber: number;
}> {
  const zoom = Math.min(ASTROLABE_ZOOM_MAX, Math.max(1, Number.isFinite(k) ? k : 1));
  const grow = ({ exponent, cap }: { exponent: number; cap: number }) => (
    Math.max(1, Math.min(cap, Math.pow(zoom, exponent)))
  );
  return {
    sphere: grow(style.zoom.sphere),
    glyph: grow(style.zoom.glyph),
    star: grow(style.zoom.star),
    starLabel: grow(style.zoom.starLabel),
    houseNumber: grow(style.zoom.houseNumber),
  };
}

/** Clamp the zoom range and keep the fitted viewport covered, so panning can
 * never slide the plate out of view. */
export function clampAstrolabeZoom(zoom: AstrolabeZoom, cssW: number, cssH: number): AstrolabeZoom {
  const k = Math.min(ASTROLABE_ZOOM_MAX, Math.max(1, Number.isFinite(zoom.k) ? zoom.k : 1));
  if (k === 1) return ASTROLABE_ZOOM_IDENTITY;
  const x = Math.min(0, Math.max(cssW * (1 - k), zoom.x));
  const y = Math.min(0, Math.max(cssH * (1 - k), zoom.y));
  return { k, x, y };
}

/** Zoom by `factor` keeping the screen point (px, py) fixed. */
export function zoomAstrolabeAt(
  zoom: AstrolabeZoom,
  factor: number,
  px: number,
  py: number,
  cssW: number,
  cssH: number,
): AstrolabeZoom {
  const k = Math.min(ASTROLABE_ZOOM_MAX, Math.max(1, zoom.k * factor));
  const f = k / zoom.k;
  return clampAstrolabeZoom({ k, x: px - (px - zoom.x) * f, y: py - (py - zoom.y) * f }, cssW, cssH);
}

/** The fitted plate layout seen through the zoom. */
export function zoomLayout(layout: Layout, zoom: AstrolabeZoom): Layout {
  return {
    cx: layout.cx * zoom.k + zoom.x,
    cy: layout.cy * zoom.k + zoom.y,
    scale: layout.scale * zoom.k,
  };
}

/** The visible canvas area (CSS px), grown by a margin for stroke widths. */
export type ViewRect = { x0: number; y0: number; x1: number; y1: number };

export function viewRect(cssW: number, cssH: number, margin = 8): ViewRect {
  return { x0: -margin, y0: -margin, x1: cssW + margin, y1: cssH + margin };
}

/** A term/decan ruler glyph's ink, as the chart wheel paints it: the ruler's
 * colour when subdivisions inherit planet colours, else the sign colour. */
export function divisionGlyphColor(
  entry: { color: string; colorRole?: string | null },
  inheritPlanetColors: boolean | undefined,
  signColor: string,
  resolveColor: (role: string | null, fallback: string) => string | null | undefined,
): string {
  if (inheritPlanetColors === false) return signColor;
  return resolveColor(entry.colorRole ?? null, entry.color) ?? entry.color;
}

export function pointInView(view: ViewRect, x: number, y: number, pad = 0): boolean {
  return x >= view.x0 - pad && x <= view.x1 + pad && y >= view.y0 - pad && y <= view.y1 + pad;
}

/** Reject wholly offscreen ruler ticks before Canvas setup/stroke. Keep the
 * original snapped endpoints of visible ticks, including crossing segments,
 * so culling cannot change their pixel alignment or antialiasing. */
export function drawVisibleRulerTick(
  draw: CanvasDraw, view: ViewRect, a: [number, number], b: [number, number],
  color: string, width: number,
) {
  const ax = Math.round(a[0]), ay = Math.round(a[1]);
  const bx = Math.round(b[0]), by = Math.round(b[1]);
  const pad = Math.max(0.25, width) / 2 + 1;
  if (Math.max(ax, bx) < view.x0 - pad || Math.min(ax, bx) > view.x1 + pad
    || Math.max(ay, by) < view.y0 - pad || Math.min(ay, by) > view.y1 + pad) return;
  draw.line([a, b], { fill: color, width });
}

/** Liang–Barsky: the part of segment a→b inside the view, or null. */
function clipSegment(
  view: ViewRect, ax: number, ay: number, bx: number, by: number,
): [number, number, number, number] | null {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, ax - view.x0], [dx, view.x1 - ax], [-dy, ay - view.y0], [dy, view.y1 - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

/** Trace only the on-screen part of a polyline. Zoomed, a plate line can be
 * thousands of px long; stroking (and above all dashing) the off-screen
 * length is what makes deep-zoom frames slow. */
export function traceVisiblePolyline(
  ctx: CanvasRenderingContext2D, points: ReadonlyArray<readonly [number, number]>, view: ViewRect,
) {
  let penX = NaN;
  let penY = NaN;
  for (let i = 0; i + 1 < points.length; i++) {
    const seg = clipSegment(view, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    if (!seg) continue;
    if (seg[0] !== penX || seg[1] !== penY) ctx.moveTo(seg[0], seg[1]);
    ctx.lineTo(seg[2], seg[3]);
    penX = seg[2];
    penY = seg[3];
  }
}

/** Trace only the visible arcs. Rectangle-edge intersections bound the work;
 * never sample a whole circumference whose length grows with zoom. */
export function traceVisibleCircle(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, view: ViewRect,
) {
  if (!(r > 0) || !Number.isFinite(r)) return;
  if (cx - r >= view.x0 && cx + r <= view.x1 && cy - r >= view.y0 && cy + r <= view.y1) {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    return;
  }
  const nx = Math.max(view.x0, Math.min(cx, view.x1));
  const ny = Math.max(view.y0, Math.min(cy, view.y1));
  if (Math.hypot(nx - cx, ny - cy) > r) return; // view entirely outside the circle
  const fx = Math.max(Math.abs(view.x0 - cx), Math.abs(view.x1 - cx));
  const fy = Math.max(Math.abs(view.y0 - cy), Math.abs(view.y1 - cy));
  if (Math.hypot(fx, fy) < r) return; // view entirely inside the circle
  const tau = Math.PI * 2;
  const cuts = [0, tau];
  for (const x of [view.x0, view.x1]) {
    const offset = (x - cx) / r;
    if (offset < -1 || offset > 1) continue;
    const angle = Math.acos(offset);
    cuts.push(angle, tau - angle);
  }
  for (const y of [view.y0, view.y1]) {
    const offset = (y - cy) / r;
    if (offset < -1 || offset > 1) continue;
    const angle = Math.asin(offset);
    cuts.push(angle < 0 ? angle + tau : angle, Math.PI - angle);
  }
  cuts.sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const start = cuts[i];
    const end = cuts[i + 1];
    if (end <= start) continue;
    const middle = (start + end) / 2;
    if (!pointInView(view, cx + Math.cos(middle) * r, cy + Math.sin(middle) * r)) continue;
    ctx.moveTo(cx + Math.cos(start) * r, cy + Math.sin(start) * r);
    traceArc(ctx, cx, cy, r, start, end);
  }
}

// The canvas rasterises arcs in single precision: past this radius (CSS or
// device px) a near-straight circle, such as an equatorial plate's horizon,
// is traced as a polyline computed in double precision instead.
const EXACT_ARC_RADIUS = 1e6;

/** Continue the path along the circle from angle `start` to `end` (radians, either way). */
function traceArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, start: number, end: number) {
  if (r <= EXACT_ARC_RADIUS) {
    ctx.arc(cx, cy, r, start, end, end < start);
    return;
  }
  const steps = Math.min(4096, Math.max(2, Math.ceil(r * Math.abs(end - start) / 2)));
  for (let i = 1; i <= steps; i++) {
    const angle = start + (end - start) * i / steps;
    ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
}

/** Add the part of the disc (cx, cy, r) inside `box` as one closed subpath,
 * exact at any radius: the whole circle when it is small, else its arc inside
 * the box closed along the box edges, so a fill or clip limited to the box
 * sees the same disc. */
export function traceDiscInBox(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, box: ViewRect,
) {
  if (!(r > 0) || !Number.isFinite(r)) return;
  if (r <= EXACT_ARC_RADIUS) {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    return;
  }
  // The box perimeter clockwise from its top-left corner, parameter t in [0, 4).
  const { x0, y0, x1, y1 } = box;
  const perimeter = (t: number): [number, number] => {
    const f = t - Math.floor(t);
    switch (Math.floor(t) % 4) {
      case 0: return [x0 + f * (x1 - x0), y0];
      case 1: return [x1, y0 + f * (y1 - y0)];
      case 2: return [x1 - f * (x1 - x0), y1];
      default: return [x0, y1 - f * (y1 - y0)];
    }
  };
  const inside = ([x, y]: [number, number]) => Math.hypot(x - cx, y - cy) < r;
  // Where the circle crosses each edge (y = y0, x = x1, y = y1, x = x0).
  const crossings: number[] = [];
  const sides: Array<[number, number, number, number, boolean]> = [
    [0, y0, x0, x1, true], [1, x1, y0, y1, false], [2, y1, x1, x0, true], [3, x0, y1, y0, false],
  ];
  for (const [side, level, from, to, horizontal] of sides) {
    const offset = level - (horizontal ? cy : cx);
    const half = Math.sqrt((r - offset) * (r + offset));
    if (!Number.isFinite(half)) continue;
    for (const position of [(horizontal ? cx : cy) - half, (horizontal ? cx : cy) + half]) {
      const f = (position - from) / (to - from);
      if (f >= 0 && f < 1 && !crossings.some((t) => Math.abs(t - side - f) < 1e-9)) crossings.push(side + f);
    }
  }
  if (crossings.length < 2) {
    // The box lies wholly inside the disc or wholly outside it.
    if (inside(perimeter(0.5))) ctx.rect(x0, y0, x1 - x0, y1 - y0);
    return;
  }
  // A circle this large crosses a box at most twice. Trace the short arc
  // from one crossing to the other, then return along the perimeter part
  // that lies inside the disc.
  const [a, b] = crossings.sort((p, q) => p - q);
  const [from, to] = inside(perimeter((a + b) / 2)) ? [b, a + 4] : [a, b];
  const angle = (t: number) => {
    const [x, y] = perimeter(t);
    return Math.atan2(y - cy, x - cx);
  };
  const start = angle(from);
  let sweep = angle(to) - start;
  sweep -= Math.round(sweep / (Math.PI * 2)) * Math.PI * 2;
  ctx.moveTo(...perimeter(from));
  traceArc(ctx, cx, cy, r, start, start + sweep);
  for (let corner = Math.floor(to) + 1; corner < from + (from < to ? 4 : 0); corner++) ctx.lineTo(...perimeter(corner));
  ctx.closePath();
}

/** Stroke the on-screen part of a circle. */
export function strokeVisibleCircle(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number, view: ViewRect,
  color: string, width: number, dash?: readonly number[], opacity?: number,
) {
  ctx.save();
  if (opacity != null) ctx.globalAlpha = opacity;
  ctx.beginPath();
  traceVisibleCircle(ctx, cx, cy, r, view);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.25, width);
  if (dash?.some((value) => value > 0)) ctx.setLineDash([...dash]);
  ctx.stroke();
  ctx.restore();
}

// Aries' common chart ring: the single Anglo wheel's outer zodiac ring, as a
// fraction of the chart target's half side (the same token the wheel reads).
const COMMON_RING_CSS_VAR = "--aries-wheel-anglo-zodiac-single";

export function readCommonRingFill(host: HTMLElement): number {
  const value = Number.parseFloat(window.getComputedStyle(host).getPropertyValue(COMMON_RING_CSS_VAR));
  return Number.isFinite(value) && value > 0 && value <= 1
    ? value
    : ANGLO_WHEEL_GEOMETRY_PROFILE.zodiacSingle;
}

export type CommonRingPlateFit = {
  ringFill: number; // common ring, fraction of the target half side
  limbFill: number; // plate limb (outermost engraved ring), fraction of plate radius
  paintFill: number; // outermost painted label, fraction of plate radius
  marginFill: number; // clear edge, fraction of the target half side
  topBoundary: number; // titlebar bottom in host px
};

/** Size a plate so its outermost engraved ring lands on the common chart ring
 * and every other proportion follows from the returned radius.
 *
 * Like the wheel's paint envelope, the labels outside the limb must stay
 * clear of the titlebar. The plate keeps the wheel's size and centre when it
 * fits; otherwise it drops only as far as the titlebar requires, and shrinks
 * only when the pane is too short for its painted envelope even then. */
export function resolveCommonRingPlate(
  cssW: number,
  cssH: number,
  fit: CommonRingPlateFit,
): { maxRadiusPx: number; centerY: number } | null {
  const target = resolveChartPaintTarget(cssW, cssH, 1);
  if (target.side <= 0 || fit.limbFill <= 0 || fit.paintFill <= 0) return null;
  const half = target.side / 2;
  const margin = fit.marginFill * half;
  const top = Math.max(0, fit.topBoundary) + margin;
  const bottom = cssH - margin;
  const fitPaintR = Math.max(1, Math.min((bottom - top) / 2, cssW / 2 - margin));
  let maxRadiusPx = (fit.ringFill * half) / fit.limbFill;
  let paintR = fit.paintFill * maxRadiusPx;
  if (paintR > fitPaintR) {
    maxRadiusPx *= fitPaintR / paintR;
    paintR = fitPaintR;
  }
  const centerY = Math.min(bottom - paintR, Math.max(target.centerY, top + paintR));
  return { maxRadiusPx, centerY };
}

export function mapPoint(layout: Layout, x: number, y: number): [number, number] {
  // Projection space: NCP=(0,0), +y down, units of R_eq -> screen pixels.
  return [layout.cx + x * layout.scale, layout.cy + y * layout.scale];
}

/** The earth's own fill: the plate background and, on the atmospheric plate,
 * the daemon's ground colour over it at the plate's fill opacity, then the
 * physical sky's dithered ground (`paintGround`, astrolabe-sky.ts). */
export type AstrolabeEarthFill = {
  background: string; ground?: string; groundOpacity: number;
  paintGround?: (ctx: CanvasRenderingContext2D) => void;
};

let earthLayer: HTMLCanvasElement | null = null;

/** A cleared device-pixel layer the size of `ctx`'s canvas, under its transform. */
function earthLayerContext(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D | null {
  earthLayer ??= document.createElement("canvas");
  const { width, height } = ctx.canvas;
  if (earthLayer.width !== width) earthLayer.width = width;
  if (earthLayer.height !== height) earthLayer.height = height;
  const layer = earthLayer.getContext("2d");
  if (!layer) return null;
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.clearRect(0, 0, width, height);
  layer.setTransform(ctx.getTransform());
  return layer;
}

/**
 * Earth in front: the ground, and the picture standing on it, painted over
 * everything drawn so far inside the plate disc (lattice, rete, bodies), so
 * whatever is below the horizon, or behind the picture's skyline, goes
 * behind the earth. `traceGround` adds the horizon to a path that already
 * holds the plate's bounding square, so an even-odd fill is the ground.
 * Below full opacity the earth is composed on its own layer first and laid,
 * as one, over the same earth painted under the plate: the earth keeps its
 * full strength and only what was drawn between the two shows through, at
 * 1 − opacity. `erasePictureHoles` takes the ground back out where the
 * picture's own cut-out is empty below the horizon, so that emptiness stays
 * see-through instead of an opaque fill; the earth is then composed on its
 * own layer at any opacity.
 */
export function paintEarthInFront(
  ctx: CanvasRenderingContext2D,
  disc: { cx: number; cy: number; r: number },
  traceGround: (ctx: CanvasRenderingContext2D) => void,
  fill: AstrolabeEarthFill,
  opacity: number,
  paintPicture?: (ctx: CanvasRenderingContext2D) => void,
  erasePictureHoles?: (ctx: CanvasRenderingContext2D) => void,
) {
  const solid = opacity >= 1 && !erasePictureHoles;
  const target = solid ? ctx : earthLayerContext(ctx);
  if (!target) return;
  target.save();
  target.beginPath();
  target.arc(disc.cx, disc.cy, disc.r, 0, Math.PI * 2);
  target.clip();
  target.beginPath();
  target.rect(disc.cx - disc.r, disc.cy - disc.r, disc.r * 2, disc.r * 2);
  traceGround(target);
  target.fillStyle = fill.background;
  target.fill("evenodd");
  if (fill.ground) {
    target.globalAlpha = fill.groundOpacity;
    target.fillStyle = fill.ground;
    target.fill("evenodd");
    target.globalAlpha = 1;
  }
  if (fill.paintGround) {
    target.save();
    target.clip("evenodd");
    fill.paintGround(target);
    target.restore();
  }
  erasePictureHoles?.(target);
  paintPicture?.(target);
  target.restore();
  if (solid) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.max(0, opacity);
  ctx.drawImage(target.canvas, 0, 0);
  ctx.restore();
}

/** The mater's raised limb: the plate boundary is the inner rule and its 360°
 * scale projects outward to a separate rim. This keeps the usable plate clear
 * for projected bodies. Batched paths keep the decorative precision cheap. */
export function drawGraduatedLimb(
  draw: CanvasDraw,
  cx: number,
  cy: number,
  plateR: number,
  tickStep: number,
  color: string,
  fineWidth: number,
  mediumWidth: number,
  mainWidth: number,
  innerDash?: readonly number[],
) {
  const outerR = plateR + tickStep * 3;
  draw.circle([cx, cy], outerR, { outline: color, width: fineWidth });
  const dash = innerDash?.some((value) => value > 0) ? [...innerDash] : undefined;
  if (dash) draw.ctx.setLineDash(dash);
  draw.circle([cx, cy], plateR, { outline: color, width: mainWidth });
  if (dash) draw.ctx.setLineDash([]);

  const ctx = draw.ctx;
  const paintTicks = (modulo: number, length: number, width: number) => {
    ctx.save();
    ctx.beginPath();
    for (let degree = 0; degree < 360; degree++) {
      if (degree % modulo !== 0) continue;
      if (modulo === 1 && degree % 5 === 0) continue;
      if (modulo === 5 && degree % 10 === 0) continue;
      const angle = (degree - 90) * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.moveTo(cx + cos * plateR, cy + sin * plateR);
      ctx.lineTo(cx + cos * (plateR + length), cy + sin * (plateR + length));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  };
  paintTicks(1, tickStep, fineWidth);
  paintTicks(5, tickStep * 2, fineWidth);
  paintTicks(10, tickStep * 3, mediumWidth);
}

/** The rete arc on the limb: a band from the upper meridian (hour angle 0) to
 * where the radix meridian has turned (hour angle = arc, westward/clockwise),
 * with the daemon's arc label just inside the plate at the band's middle. */
export function drawReteArcSpan(
  draw: CanvasDraw,
  cx: number,
  cy: number,
  plateR: number,
  tickStep: number,
  arcDeg: number,
  label: string,
  size: number,
  color: string,
  width: number,
) {
  const outerR = plateR + tickStep * 3;
  const toCanvas = (deg: number) => (deg - 90) * Math.PI / 180;
  const ctx = draw.ctx;
  if (arcDeg > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + width * 1.5, toCanvas(0), toCanvas(arcDeg), false);
    ctx.strokeStyle = color;
    ctx.lineWidth = width * 3;
    ctx.lineCap = "butt";
    ctx.stroke();
    ctx.restore();
    const end = toCanvas(arcDeg);
    draw.line([
      [cx + Math.cos(end) * plateR, cy + Math.sin(end) * plateR],
      [cx + Math.cos(end) * (outerR + width * 3), cy + Math.sin(end) * (outerR + width * 3)],
    ], { fill: color, width });
  }
  if (!label || size <= 0) return;
  const mid = toCanvas(arcDeg / 2);
  const labelR = plateR - size * 1.1;
  draw.text([cx + Math.cos(mid) * labelR, cy + Math.sin(mid) * labelR], label, {
    size,
    fill: color,
    align: "center",
    baseline: "middle",
  });
}
