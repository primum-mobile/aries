// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type InkPoint = readonly [number, number];
export type InkContour = readonly InkPoint[];
const cross = (a: InkPoint, b: InkPoint, c: InkPoint) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Outer ink envelope; holes inside a symbol do not provide label space. */
export function convexInkHull(points: InkContour): InkContour {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (items: InkPoint[]) => {
    const hull: InkPoint[] = [];
    for (const point of items) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  };
  return sorted.length < 3 ? sorted : [...half(sorted), ...half(sorted.reverse())];
}

const pairHulls = new WeakMap<InkContour, WeakMap<InkContour, InkContour>>();

/** Fit one radial translation to a true edge-to-edge gap. The cached
 * difference hull turns two-outline separation into point-to-outline distance;
 * ten bounded refinements keep the result within a fraction of a CSS pixel. */
export function radialInkGapDistance(
  glyph: InkContour, number: InkContour, glyphSize: {w: number; h: number},
  numberSize: {w: number; h: number}, direction: InkPoint, gap: number, upper: number,
): number {
  let pairs = pairHulls.get(glyph);
  if (!pairs) { pairs = new WeakMap(); pairHulls.set(glyph, pairs); }
  let hull = pairs.get(number);
  if (!hull) {
    hull = convexInkHull(glyph.flatMap(a => number.map(b => [
      a[0] - glyphSize.w / 2 - b[0] + numberSize.w / 2,
      a[1] - glyphSize.h / 2 - b[1] + numberSize.h / 2,
    ] as InkPoint)));
    pairs.set(number, hull);
  }
  const clearance = (distance: number) => {
    const p: InkPoint = [direction[0] * distance, direction[1] * distance];
    let inside = true, nearest = Infinity;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      if (cross(a, b, p) < 0) inside = false;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      nearest = Math.min(nearest, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    }
    return inside ? 0 : nearest;
  };
  let low = 0, high = upper + 2; // Include the raster envelope's subpixel fringe.
  for (let i = 0; i < 10; i++) {
    const mid = (low + high) / 2;
    if (clearance(mid) < gap) low = mid;
    else high = mid;
  }
  return high;
}
