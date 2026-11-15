// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChartHitRegion } from "./draw-chart";
import { aspectGridBodies, moonListRowCount } from "./dashboard-canvas";
import { cellBox, dashboardModuleBoxes, moonRowBand, type DashboardLayout, type DashRect } from "./dashboard-layout";
import { declinationGlyphs, type ScaleMetrics } from "./dashboard-paint";
import type { ChartDashboard } from "./types";

/**
 * Chart dashboard hover zones. The modules duplicate the wheel's own hit
 * regions (same kinds, same hover flag and daemon content) on their painted
 * geometry for this frame:
 *
 * - aspect grid: axis glyphs → that body's planet region; cells with an
 *   aspect → the wheel's region for that pair and type (or the same aspect
 *   identity when the wheel draws no line); cells with only a parallel mark →
 *   the pair's declination contact (none while the marks are hidden);
 * - declination scale: body glyphs → the body's declination contacts;
 * - Moon list: the whole module (heading, rows, gaps) → the Moon's planet
 *   region, so hover and click show the Moon as on the wheel; Last / Next
 *   rows → that pair's aspect, including outside drawing orbs.
 *
 * Zones sit above the wheel's priorities; modules never overlap the wheel.
 */

const DASHBOARD_PRIORITY = 40;

/** Include empty cells, but leave the grid's unpainted upper triangle free. */
export function dashboardContainsPoint(layout: DashboardLayout | null, x: number, y: number): boolean {
  return Boolean(layout && dashboardModuleBoxes(layout).some((box) =>
    x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h,
  ));
}

type Planetish = Extract<ChartHitRegion, { kind: "planet" }>;
type Aspectish = Extract<ChartHitRegion, { kind: "aspect" }>;

/** A wheel region moved onto a module box (a box hit test, no line shape). */
function onBox<T extends ChartHitRegion>(region: T, box: DashRect, priority = DASHBOARD_PRIORITY): T {
  const moved = {
    ...region,
    x: box.x + box.w / 2,
    y: box.y + box.h / 2,
    r: Math.min(box.w, box.h) / 2,
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
    priority,
  } as T & Record<string, unknown>;
  for (const key of ["shape", "x1", "y1", "x2", "y2", "tolerance", "leaderSegments", "excludedDisc"]) delete moved[key];
  return moved;
}

function samePair(region: Aspectish, a: string, b: string, aspectType: number) {
  return region.aspectType === aspectType && !region.contactId && region.scope !== "interchart"
    && ((region.p1 === a && region.p2 === b) || (region.p1 === b && region.p2 === a));
}

export function dashboardHitRegions(
  layout: DashboardLayout,
  dashboard: ChartDashboard,
  wheel: readonly ChartHitRegion[],
  /** Snapshot planet ids by SE id (export_chart_json PLANET_ID_MAP). */
  planetIds: ReadonlyMap<number, string>,
  /** The scale painter's measured type metrics (`measureScaleMetrics`), so zones sit on the painted glyphs. */
  scaleMetrics?: ScaleMetrics,
): ChartHitRegion[] {
  const planets = new Map<number, Planetish>();
  const aspects: Aspectish[] = [];
  for (const region of wheel) {
    if (region.styleOnly) continue;
    if (region.kind === "planet" && region.chartRole !== "outer" && !planets.has(region.seId)) planets.set(region.seId, region);
    if (region.kind === "aspect") aspects.push(region);
  }
  const aspectRegion = (a: number, b: number, aspectType: number): Aspectish | null => {
    const p1 = planetIds.get(a);
    const p2 = planetIds.get(b);
    if (!p1 || !p2) return null;
    return aspects.find((region) => samePair(region, p1, p2, aspectType)) ?? null;
  };
  const out: ChartHitRegion[] = [];

  const bodies = aspectGridBodies(dashboard);
  const cells = dashboard.grid?.cells ?? {};
  if (layout.grid) {
    const c = layout.cell;
    const grid = layout.grid;
    const n = bodies.length;
    bodies.forEach((rowBody, row) => {
      const axis = planets.get(rowBody.planet);
      if (axis) out.push(onBox(axis, cellBox(grid, n, c, row, row)));
      for (let col = 0; col < row; col++) {
        const colBody = bodies[col];
        const box = cellBox(grid, n, c, row, col);
        const cell = cells[`planet:${colBody.planet}:planet:${rowBody.planet}`];
        if (cell?.glyph && cell.aspectType != null) {
          const wheelAspect = aspectRegion(colBody.planet, rowBody.planet, cell.aspectType);
          const p1 = planetIds.get(colBody.planet);
          const p2 = planetIds.get(rowBody.planet);
          const region: Aspectish | null = wheelAspect
            ?? (p1 && p2 ? { kind: "aspect", p1, p2, aspectType: cell.aspectType, scope: "primary", x: 0, y: 0, r: 0 } : null);
          if (region) out.push(onBox(region, box));
        } else if (cell?.parallel && dashboard.gridParallels !== false) {
          out.push(onBox({ kind: "declination", seId: rowBody.planet, partner: colBody.planet, x: 0, y: 0, r: 0 }, box));
        }
      }
    });
  }

  if (layout.scale && dashboard.declination) {
    const g = layout.glyph;
    for (const glyph of declinationGlyphs(dashboard, layout.scale.kind, layout.scale.rect, g, scaleMetrics)) {
      out.push(onBox(
        { kind: "declination", seId: glyph.planet, x: 0, y: 0, r: 0 },
        { x: glyph.x - g / 2, y: glyph.y - g / 2, w: g, h: g },
      ));
    }
  }

  const moon = dashboard.moon;
  if (layout.moon && moon) {
    // One step below the rows, so a Last / Next row keeps its aspect.
    const moonBody = planets.get(1);
    if (moonBody) out.push(onBox(moonBody, layout.moon, DASHBOARD_PRIORITY - 1));
    const count = moonListRowCount(dashboard);
    const contacts: Array<[typeof moon.last, number]> = [[moon.last, count - 2], [moon.next, count - 1]];
    for (const [contact, index] of contacts) {
      if (!contact) continue;
      const p1 = planetIds.get(1);
      const p2 = planetIds.get(contact.planet);
      const region: Aspectish | null = aspectRegion(1, contact.planet, contact.aspectType)
        ?? (p1 && p2 ? { kind: "aspect", p1, p2, aspectType: contact.aspectType, scope: "primary", x: 0, y: 0, r: 0 } : null);
      if (!region) continue;
      out.push(onBox(region, moonRowBand(layout.moon, layout.text, index, count)));
    }
  }
  return out;
}
