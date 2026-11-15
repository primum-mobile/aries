// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasDraw } from "@/lib/chart/canvas-draw";
import type { AstrolabeRenderStyle } from "@/lib/chart/astrolabe-render-style";
import type {
  AstrolabeGeometry, AstrolabePdArc, AstrolabePdPair, AstrolabePoint, PolarAzimuthalGeometry,
} from "@/lib/daemon/client";
import {
  astrolabeZoomDetail, mapPoint, pointInView, traceVisiblePolyline,
  type AstrolabeHoverTarget, type AstrolabeReteSurface, type Layout, type ViewRect,
} from "./astrolabe-canvas";

type Geometry = AstrolabeGeometry | PolarAzimuthalGeometry;

/** Paint-only eligibility, after the daemon resolved the full point universe. */
function isDrawn(geo: Geometry, pair: AstrolabePdPair, targets: readonly AstrolabeHoverTarget[]): boolean {
  const ref = pair.metadata?.motionRef;
  if (geo.projection === "stereographic") {
    if (ref?.kind === "fixedStar") return targets.some((target) =>
      target.inspector?.kind === "fixed_star" && target.inspector.code === ref.code);
    return geo.bodies.some((body) => ref?.kind === "fortune" ? body.id === -1
      : ref?.kind === "planet" && body.id === ref.bodyId);
  }
  return geo.objects.some((object) =>
    (ref?.bodyId != null && object.bodyId === ref.bodyId)
    || (ref?.code != null && object.starCode === ref.code)
    || object.id === `point:${pair.key}`
    || (pair.metadata?.semanticId != null && object.id === pair.metadata.semanticId));
}

/** Unit normal away from the pole, which the natal ecliptic encloses in both
 * projections; mapPoint is a uniform scale, so it holds on screen too. */
function outwardNormal(p: { x: number; y: number; tx: number; ty: number }): [number, number] {
  const nx = -p.ty, ny = p.tx;
  return nx * p.x + ny * p.y < 0 ? [-nx, -ny] : [nx, ny];
}

function inspectorForPair(pair: AstrolabePdPair): AstrolabeHoverTarget["inspector"] {
  const ref = pair.metadata?.motionRef;
  if (ref?.kind === "planet" && ref.bodyId != null) return { kind: "planet", seId: ref.bodyId };
  const longitude = pair.metadata?.longitude;
  if (ref?.kind === "fortune" && longitude != null) return { kind: "fortune", longitude };
  if (ref?.kind === "fixedStar" && ref.code && longitude != null) {
    return { kind: "fixed_star", code: ref.code, longitude };
  }
}

/** Catmull-Rom through the daemon's sparse locus samples: the path passes
 * every engine sample exactly and only rounds the polyline between them. */
function smoothLocus(points: ReadonlyArray<readonly [number, number]>, steps = 4): Array<[number, number]> {
  const out: Array<[number, number]> = [[points[0][0], points[0][1]]];
  const last = points.length - 1;
  for (let i = 0; i < last; i++) {
    const [p0, p1, p2, p3] = [points[Math.max(0, i - 1)], points[i], points[i + 1], points[Math.min(last, i + 2)]];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const at = (k: 0 | 1) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t
        + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t
        + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t * t * t);
      out.push(s === steps ? [p2[0], p2[1]] : [at(0), at(1)]);
    }
  }
  return out;
}

/** Readable overlay glyphs (focus, arcs, contact labels) as a share of the
 * renderer's body glyph, so they follow its zoom and theme sizing. */
const OVERLAY_GLYPH_SCALE = 0.6;

const degreesMinutes = (deg: number) => {
  const minutes = Math.round(Math.abs(deg) * 60);
  return `${Math.floor(minutes / 60)}°${String(minutes % 60).padStart(2, "0")}′`;
};

function ringNormal(points: readonly AstrolabePoint[], i: number): [number, number] {
  const [a, b] = [points[Math.max(0, i - 1)], points[Math.min(points.length - 1, i + 1)]];
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return outwardNormal({ ...points[i], tx: (b.x - a.x) / d, ty: (b.y - a.y) / d });
}

/** An aspect as it lies on the fixed natal ring: a solid arc in the point's
 * colour, a short tick where it starts, the aspect glyph at mid-arc. Hover
 * names the aspect and gives its real width on the ring. */
function paintRingArc(
  draw: CanvasDraw,
  arc: AstrolabePdArc,
  layout: Layout,
  view: ViewRect,
  style: AstrolabeRenderStyle,
  color: string,
  width: number,
  r: number,
  size: number,
  glyph: string | undefined,
  name: string,
  inspector: AstrolabeHoverTarget["inspector"],
  hoverTargets: AstrolabeHoverTarget[],
  opacity = 1,
) {
  if (arc.points.length < 2) return;
  const ctx = draw.ctx;
  const [sx, sy] = mapPoint(layout, arc.points[0].x, arc.points[0].y);
  const [nx, ny] = ringNormal(arc.points, 0);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = width * 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  traceVisiblePolyline(ctx, arc.points.map((p) => mapPoint(layout, p.x, p.y)), view);
  if (pointInView(view, sx, sy, r * 1.5)) {
    ctx.moveTo(sx - nx * r * 1.5, sy - ny * r * 1.5);
    ctx.lineTo(sx + nx * r * 1.5, sy + ny * r * 1.5);
  }
  ctx.stroke();
  ctx.restore();
  if (!glyph) return;
  const middle = Math.floor((arc.points.length - 1) / 2);
  const [mx, my] = mapPoint(layout, arc.points[middle].x, arc.points[middle].y);
  const [ox, oy] = ringNormal(arc.points, middle);
  const [gx, gy] = [mx + ox * (r * 2 + size * 0.7), my + oy * (r * 2 + size * 0.7)];
  if (!pointInView(view, gx, gy, size)) return;
  draw.text([gx, gy], glyph, { font: style.typography.fontSymbols, size, fill: color, opacity,
    align: "center", baseline: "middle" });
  hoverTargets.push({ x: gx, y: gy, width: size, height: size, name, detail: degreesMinutes(arc.span),
    pdReprojection: true, inspector });
}

/** Wheel-style click focus: a significator mark focuses it, the same mark
 * again clears, the empty plate clears, any other target keeps the focus. */
export function nextPdFocus(current: string | null, target: AstrolabeHoverTarget | null): string | null {
  if (!target) return null;
  if (target.pdSignificator) return target.pdSignificator === current ? null : target.pdSignificator;
  return current;
}

/** PD significators as fixed natal targets: short inward ticks in each
 * point's colour where the diamonds make contact. Glyphs fade in on zoom;
 * the focused significator keeps its glyph and shows its aspect points. */
function paintSignificators(
  draw: CanvasDraw,
  overlay: NonNullable<Geometry["pdReprojection"]>,
  layout: Layout,
  view: ViewRect,
  style: AstrolabeRenderStyle,
  r: number,
  width: number,
  hoverTargets: AstrolabeHoverTarget[],
  t: (key: string) => string,
  resolveColor: (role: string | null | undefined, fallback: string | null | undefined) => string | null | undefined,
  detail: Readonly<{ size: number; opacity: number }>,
  focus: string | null,
  strongSize: number,
) {
  const tick = r * 2.5;
  const caption = `${t("astrolabe.pdNatalTarget")} · ${overlay.systemLabel}`;
  for (const significator of overlay.significators ?? []) {
    if (!significator.mark) continue;
    const focused = significator.key === focus;
    const color = resolveColor(significator.metadata?.colorRole, significator.metadata?.color) ?? style.palette.ecliptic;
    const name = significator.metadata?.name ?? significator.key;
    const glyph = significator.metadata?.glyphFont !== "text" ? significator.metadata?.glyph : undefined;
    const inspector = inspectorForPair({ metadata: significator.metadata, capability: significator.capability });
    const marks = [{ mark: significator.mark, symbol: glyph, label: name, ink: color }];
    if (focused) for (const aspect of significator.aspects) {
      if (!aspect.mark) continue;
      // The theme's aspect colour, as on the wheel's aspect lines.
      const ink = resolveColor(aspect.aspectColorRole, aspect.aspectColor) ?? color;
      const label = `${name} ${aspect.offset != null && aspect.offset > 0 ? "+" : ""}${Number((aspect.offset ?? 0).toFixed(2))}°`;
      marks.push({ mark: aspect.mark, symbol: aspect.aspectGlyph, label, ink });
      if (aspect.arc) paintRingArc(draw, aspect.arc, layout, view, style, ink, width, r, strongSize,
        aspect.aspectGlyph, label, inspector, hoverTargets);
    }
    const size = focused ? strongSize : detail.size;
    const opacity = focused ? 1 : detail.opacity;
    for (const { mark, symbol, label, ink } of marks) {
      const [mx, my] = mapPoint(layout, mark.x, mark.y);
      const [nx, ny] = outwardNormal(mark);
      const [ex, ey] = [mx - nx * tick, my - ny * tick];
      if (!pointInView(view, mx, my, tick)) continue;
      draw.line([[mx, my], [ex, ey]], { fill: ink, width: focused ? width * 2 : width, pixelSnap: false });
      const target = { x: (mx + ex) / 2, y: (my + ey) / 2, width: tick, height: tick, name: label,
        detail: caption, position: mark.position, pdReprojection: true, pdSignificator: significator.key, inspector };
      hoverTargets.push(target);
      if (!symbol || opacity <= 0) continue;
      const gap = tick + size * 0.7;
      const [gx, gy] = [mx - nx * gap, my - ny * gap];
      if (!pointInView(view, gx, gy, size)) continue;
      draw.text([gx, gy], symbol, { font: style.typography.fontSymbols, size, fill: ink, opacity,
        align: "center", baseline: "middle" });
      hoverTargets.push({ ...target, x: gx, y: gy, width: size, height: size });
    }
  }
}

/** Small hollow diamonds distinguish PD representatives from body spheres
 * and ordinary rete longitude feet. Dotted links follow the system's own
 * zero-arc locus (circle of position, or the Placidian line) from the turned
 * point to its representative; without a daemon locus they stay straight. */
export function paintPdReprojection(
  draw: CanvasDraw,
  geo: Geometry,
  layout: Layout,
  view: ViewRect,
  style: AstrolabeRenderStyle,
  radius: number,
  width: number,
  hoverTargets: AstrolabeHoverTarget[],
  reteSurface: AstrolabeReteSurface | undefined,
  t: (key: string) => string,
  resolveColor: (role: string | null | undefined, fallback: string | null | undefined) => string | null | undefined,
  zoom = 1,
  focus: string | null = null,
  glyphSize?: number,
) {
  const overlay = geo.pdReprojection;
  if (!overlay || Math.abs(overlay.signedArc) < 1e-9) return;
  // Focus is exclusive, as aspect focus on the wheel: every significator mark
  // stays, but only the focused significator's nearest contacts draw. Until
  // its payload arrives, its in-orb rows stand in.
  const rows = !focus ? overlay.events
    : overlay.focus?.key === focus ? overlay.focus.events
      : overlay.events.filter((event) => event.significator === focus);
  const promissors = new Set(rows.map((event) => event.promissor));
  const pairs: AstrolabePdPair[] = overlay.points
    .filter((point) => isDrawn(geo, { ...point, capability: point.capabilities.reprojection }, hoverTargets)
      && (!focus || promissors.has(point.key)))
    .map((point) => ({ ...point, capability: point.capabilities.reprojection }));
  for (const event of rows) pairs.push(...event.rays);
  // The focused significator's contacts name their promissor and aspect.
  const emphasized = new Set(focus ? rows.flatMap((event) => event.rays) : []);
  // Contacts fade in toward the orb and out after it (daemon strength); a
  // focused significator's nearest contacts stay faintly readable when far.
  const fades = new Map<AstrolabePdPair, number>();
  for (const event of rows) {
    const strength = event.strength ?? 1;
    const fade = focus ? Math.max(strength, style.strokes.connectorOpacity) : strength;
    for (const ray of event.rays) fades.set(ray, fade);
  }
  const r = Math.max(style.markers.sphereRadiusMin, radius * 0.8);
  const strongSize = glyphSize ? glyphSize * OVERLAY_GLYPH_SCALE : r * 4;
  const detail = astrolabeZoomDetail(zoom);
  const glyphLabels = new Set<string>();
  const ctx = draw.ctx;
  ctx.save();
  ctx.strokeStyle = style.palette.ecliptic;
  ctx.lineWidth = width;
  ctx.globalAlpha = style.strokes.connectorOpacity;
  ctx.setLineDash([...style.strokes.dashes.connector]);
  ctx.beginPath();
  traceVisiblePolyline(ctx, overlay.natalEcliptic.map((p) => mapPoint(layout, p.x, p.y)), view);
  ctx.stroke();
  // The radix zodiac stays quiet: solid sign-start ticks across the fixed
  // circle, with sign glyphs fading in at the same close-up detail as below.
  const tick = r * 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const { start } of overlay.natalSigns ?? []) {
    const [sx, sy] = mapPoint(layout, start.x, start.y);
    if (!pointInView(view, sx, sy, tick)) continue;
    const [nx, ny] = outwardNormal(start);
    ctx.moveTo(sx - nx * tick, sy - ny * tick);
    ctx.lineTo(sx + nx * tick, sy + ny * tick);
  }
  ctx.stroke();
  ctx.restore();
  if (detail.opacity > 0) {
    const gap = tick + detail.size * 0.7;
    for (const sign of overlay.natalSigns ?? []) {
      const [mx, my] = mapPoint(layout, sign.middle.x, sign.middle.y);
      const [nx, ny] = outwardNormal(sign.middle);
      const [gx, gy] = [mx + nx * gap, my + ny * gap];
      if (!pointInView(view, gx, gy, detail.size)) continue;
      draw.text([gx, gy], sign.glyph, {
        font: style.typography.fontSymbols, size: detail.size, fill: style.palette.ecliptic,
        opacity: Math.min(detail.opacity, style.strokes.connectorOpacity), align: "center", baseline: "middle",
      });
    }
  }
  paintSignificators(draw, overlay, layout, view, style, r, width, hoverTargets, t, resolveColor, detail, focus,
    strongSize);
  for (const pair of pairs) {
    const actual = pair.actual;
    if (!actual) continue;
    const color = resolveColor(pair.metadata?.colorRole, pair.metadata?.color) ?? style.palette.ecliptic;
    const aspectAngle = pair.offset ? `${pair.offset > 0 ? "+" : ""}${Number(pair.offset.toFixed(2))}°` : null;
    const name = [pair.metadata?.name, aspectAngle].filter(Boolean).join(" ");
    const [ax, ay] = mapPoint(layout, actual.x, actual.y);
    const foot = pair.representative;
    const inspector = inspectorForPair(pair);
    if (!foot) {
      if (pointInView(view, ax, ay, r)) hoverTargets.push({ x: ax, y: ay, name, pdReprojection: true,
        detail: t("astrolabe.pdReprojectionUnavailable"), inspector });
      continue;
    }
    const [fx, fy] = mapPoint(layout, foot.x, foot.y);
    const fade = fades.get(pair) ?? 1;
    // An aspect ray's own marks take the theme's aspect colour; the planet
    // glyph keeps the planet's. Conjunction rays are the body itself.
    const ink = pair.aspect ? resolveColor(pair.aspectColorRole, pair.aspectColor) ?? color : color;
    if (pair.aspectArc) paintRingArc(draw, pair.aspectArc, layout, view, style, ink, width, r, strongSize,
      pair.aspectGlyph, name, inspector, hoverTargets, fade);
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineWidth = width;
    ctx.globalAlpha = style.strokes.connectorOpacity * fade;
    ctx.setLineDash([...style.strokes.dashes.connector]);
    ctx.beginPath();
    traceVisiblePolyline(ctx, pair.locus?.length
      ? smoothLocus([[ax, ay], ...pair.locus.map((p) => mapPoint(layout, p.x, p.y)), [fx, fy]])
      : [[ax, ay], [fx, fy]], view);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = fade;
    // Native row termini can differ from the planet's actual latitude, so
    // give those rays their own open point without relocating the body.
    if (pair.role && pointInView(view, ax, ay, r)) {
      draw.circle([ax, ay], r, { outline: ink, width, opacity: fade });
      if (pair.aspect && pair.aspectGlyph) draw.text([ax + r * 2, ay - r * 2], pair.aspectGlyph, {
        font: style.typography.fontSymbols, size: strongSize, fill: ink, opacity: fade,
      });
    }
    if (pointInView(view, fx, fy, r)) {
      ctx.beginPath();
      ctx.moveTo(fx, fy - r); ctx.lineTo(fx + r, fy);
      ctx.lineTo(fx, fy + r); ctx.lineTo(fx - r, fy); ctx.closePath();
      ctx.stroke();
      hoverTargets.push({ x: fx, y: fy, width: r * 2, height: r * 2, name, pdReprojection: true,
        detail: `${t(pair.role === "significator" ? "astrolabe.pdNatalTarget" : "astrolabe.pdRepresentative")} · ${overlay.systemLabel}`,
        position: foot.position, inspector });
      const glyph = pair.metadata?.glyphFont !== "text" ? pair.metadata?.glyph : undefined;
      const strong = emphasized.has(pair);
      const labelSize = strong ? strongSize : detail.size;
      if (glyph && (strong || detail.opacity > 0)) {
        const symbols = glyph + (pair.aspect ? pair.aspectGlyph ?? "" : "");
        const labelKey = `${fx}:${fy}:${symbols}`;
        const gx = fx + r + labelSize * 0.4;
        const gy = fy + r + labelSize * 0.4;
        if (!glyphLabels.has(labelKey) && pointInView(view, gx, gy, labelSize)) {
          glyphLabels.add(labelKey);
          const opacity = (strong ? 1 : detail.opacity) * fade;
          draw.text([gx, gy], glyph, { font: style.typography.fontSymbols,
            size: labelSize, opacity, fill: color, baseline: "middle" });
          if (pair.aspect && pair.aspectGlyph) draw.text([gx + labelSize, gy], pair.aspectGlyph, {
            font: style.typography.fontSymbols, size: labelSize, opacity, fill: ink, baseline: "middle" });
          const label = { x: gx + labelSize * symbols.length / 2, y: gy,
            width: labelSize * symbols.length, height: labelSize };
          hoverTargets.push({ ...hoverTargets[hoverTargets.length - 1], ...label });
          if (pair.role !== "significator") reteSurface?.markers.push({
            x: label.x, y: label.y, size: Math.max(label.width, label.height),
          });
        }
      }
      // The linked point reuses the existing rete drag/pan hit contract.
      if (pair.role !== "significator") reteSurface?.markers.push({ x: fx, y: fy, size: r * 2 });
    }
    if (pair.role && pointInView(view, ax, ay, r)) {
      hoverTargets.push({ x: ax, y: ay, width: r * 2, height: r * 2, name, pdReprojection: true,
        detail: t(pair.role === "significator" ? "astrolabe.pdNatalTarget" : "astrolabe.pdActualRay"), inspector });
      if (pair.role === "promissor") reteSurface?.markers.push({ x: ax, y: ay, size: r * 2 });
    }
    ctx.restore();
  }
}
