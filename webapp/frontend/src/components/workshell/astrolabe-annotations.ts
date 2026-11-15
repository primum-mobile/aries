// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Display-only annotations shared with the viewport-culled astrolabe painter.
// Contact existence and directed angles remain daemon-owned.
import { colorWithOpacity, type AstrolabeRenderStyle } from "@/lib/chart/astrolabe-render-style";
import type { AstrolabeContact, AstrolabeGeometry } from "@/lib/daemon/client";
import { mapPoint, type Layout } from "./astrolabe-canvas";

const HOUSE_NUMBER_SAMPLES = 8;

/** Damped growth with zoom: min(cap, k^exponent); 1 at the fitted plate. */
export function zoomGrow(k: number, curve: { exponent: number; cap: number }): number {
  return Math.max(1, Math.min(curve.cap, Math.pow(k, curve.exponent)));
}

/** 0 below zoom `start`, 1 above `end`, linear between. */
export function zoomRamp(k: number, start: number, end: number): number {
  if (end <= start) return k >= end ? 1 : 0;
  return Math.min(1, Math.max(0, (k - start) / (end - start)));
}

type ContactAnchor = { x: number; y: number; tx: number; ty: number };

/** Where a contact lights its line: the point on the touched line nearest
 * the body (or its ecliptic degree), with the line's direction there. Display
 * placement only; the PD list decides that the contact exists. */
export function contactAnchor(geo: AstrolabeGeometry, contact: AstrolabeContact): ContactAnchor | null {
  const body = geo.bodies.find((b) => b.id === contact.pointId);
  if (!body) return null;
  const { x: px, y: py } = contact.point === "body" ? body.sphere : body.ecliptic;
  const target = contact.target;
  if (target.kind === "meridian") {
    return { x: geo.tympan.meridian.x1, y: py, tx: 0, ty: 1 };
  }
  if (target.kind === "horizon") {
    const h = geo.tympan.horizon;
    const dx = px - h.cx;
    const dy = py - h.cy;
    const d = Math.hypot(dx, dy) || 1;
    return { x: h.cx + dx / d * h.r, y: h.cy + dy / d * h.r, tx: -dy / d, ty: dx / d };
  }
  const line = geo.tympan.houseLines.find((l) => l.house === target.house);
  let best: ContactAnchor | null = null;
  let bestDistance = Infinity;
  for (const path of line?.paths ?? []) {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      const sx = b.x - a.x;
      const sy = b.y - a.y;
      const len2 = sx * sx + sy * sy;
      if (len2 <= 0) continue;
      const t = Math.min(1, Math.max(0, ((px - a.x) * sx + (py - a.y) * sy) / len2));
      const x = a.x + sx * t;
      const y = a.y + sy * t;
      const distance = Math.hypot(px - x, py - y);
      if (distance < bestDistance) {
        const len = Math.sqrt(len2);
        bestDistance = distance;
        best = { x, y, tx: sx / len, ty: sy / len };
      }
    }
  }
  return best;
}

/** A lit stretch of the touched line around the contact point: width and
 * opacity follow the strength, the ends fade into the line. */
export function paintContactCue(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  anchor: ContactAnchor,
  strength: number,
  ink: string,
  width: number,
  cue: AstrolabeRenderStyle["zoom"]["contact"],
) {
  const [x, y] = mapPoint(layout, anchor.x, anchor.y);
  const tx = anchor.tx * cue.halfLength;
  const ty = anchor.ty * cue.halfLength;
  const gradient = ctx.createLinearGradient(x - tx, y - ty, x + tx, y + ty);
  const clear = colorWithOpacity(ink, 0);
  gradient.addColorStop(0, clear);
  gradient.addColorStop(0.3, ink);
  gradient.addColorStop(0.7, ink);
  gradient.addColorStop(1, clear);
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.strokeStyle = gradient;
  ctx.lineWidth = width * (1 + strength);
  ctx.lineCap = "round";
  ctx.shadowColor = ink;
  ctx.shadowBlur = cue.glow;
  ctx.beginPath();
  ctx.moveTo(x - tx, y - ty);
  ctx.lineTo(x + tx, y + ty);
  ctx.stroke();
  ctx.restore();
}

/** The strongest live contact of one point kind for a body, if any. */
export function strongestContact(
  contacts: readonly LiveContact[],
  pointId: number,
  point: AstrolabeContact["point"],
): LiveContact | null {
  let best: LiveContact | null = null;
  for (const live of contacts) {
    if (live.contact.pointId !== pointId || live.contact.point !== point) continue;
    if (!best || live.strength > best.strength) best = live;
  }
  return best;
}

export type LiveContact = { contact: AstrolabeContact; strength: number; anchor: ContactAnchor | null };

/** Where a zoomed house number sits on its own line: first where the line
 * crosses just outside the ecliptic (the cusp's zodiac end), offset off the
 * line; otherwise the visible sample nearest the fitted anchor. */
export function stickyHouseNumber(
  paths: Array<Array<[number, number]>>,
  eclipticCentre: [number, number],
  targetRadius: number,
  fittedAnchor: [number, number],
  size: number,
  visible: (x: number, y: number) => boolean,
): [number, number] | null {
  const [ecx, ecy] = eclipticCentre;
  for (const path of paths) {
    for (let i = 0; i + 1 < path.length; i++) {
      const [x0, y0] = path[i];
      const [x1, y1] = path[i + 1];
      const d0 = Math.hypot(x0 - ecx, y0 - ecy) - targetRadius;
      const d1 = Math.hypot(x1 - ecx, y1 - ecy) - targetRadius;
      if (d0 === d1 || Math.sign(d0) === Math.sign(d1)) continue;
      const t = d0 / (d0 - d1);
      const sx = x1 - x0;
      const sy = y1 - y0;
      const len = Math.hypot(sx, sy) || 1;
      const x = x0 + sx * t - sy / len * size * 0.7;
      const y = y0 + sy * t + sx / len * size * 0.7;
      if (visible(x, y)) return [x, y];
    }
  }
  let best: [number, number] | null = null;
  let bestDistance = Infinity;
  for (const path of paths) {
    for (let i = 0; i + 1 < path.length; i++) {
      const [x0, y0] = path[i];
      const [x1, y1] = path[i + 1];
      for (let s = 0; s <= HOUSE_NUMBER_SAMPLES; s++) {
        const x = x0 + (x1 - x0) * s / HOUSE_NUMBER_SAMPLES;
        const y = y0 + (y1 - y0) * s / HOUSE_NUMBER_SAMPLES;
        if (!visible(x, y)) continue;
        const distance = Math.hypot(x - fittedAnchor[0], y - fittedAnchor[1]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = [x, y];
        }
      }
    }
  }
  return best;
}
