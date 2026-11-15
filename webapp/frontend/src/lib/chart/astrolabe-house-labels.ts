// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

type Point = Readonly<{ x: number; y: number }>;

/** Place a house number on its supplied line at 80% of the plate radius.
 * This is paint layout over daemon geometry; disjoint branches stay separate.
 * Short branches use their nearest visible point to that radius. */
export function astrolabeHouseLabelAnchor(
  paths: readonly (readonly Point[])[],
  plateRadius: number,
): Point | null {
  const radius = plateRadius * 0.8;
  if (!Number.isFinite(radius) || radius <= 0) return null;
  let closest: Point | null = null;
  let closestDistance = Infinity;
  const consider = (point: Point) => {
    const distance = Math.abs(Math.hypot(point.x, point.y) - radius);
    if (distance < closestDistance) {
      closest = point;
      closestDistance = distance;
    }
  };
  for (const path of paths) {
    for (let index = 0; index < path.length; index++) {
      const start = path[index];
      consider(start);
      const end = path[index + 1];
      if (!end) continue;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const a = dx * dx + dy * dy;
      if (a === 0) continue;
      const b = 2 * (start.x * dx + start.y * dy);
      const c = start.x * start.x + start.y * start.y - radius * radius;
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) {
        for (const t of [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)]) {
          if (t >= 0 && t <= 1) return { x: start.x + t * dx, y: start.y + t * dy };
        }
      }
      const nearest = Math.max(0, Math.min(1, -b / (2 * a)));
      consider({ x: start.x + nearest * dx, y: start.y + nearest * dy });
    }
  }
  return closest;
}
