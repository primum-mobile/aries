// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChartHitRegion, OuterLabelCollisionBounds } from "./draw-chart";
import { dashboardModuleBoxes, reservedDashboardCorners, solveDashboardLayout, type CornerReservationMetrics, type DashboardCorners, type DashboardLayout, type DashRect } from "./dashboard-layout";
import { resolveWheelOverlayMetrics, type WheelRenderStyle } from "./wheel-render-style";
import type { DashObstacles } from "./dashboard-paint";
import { SE_TRUE_NODE } from "./glyphs";
import type { ChartDashboard, ChartDashboardBody, ChartRenderSnapshot } from "./types";

/** Select a layout without replacing any daemon-owned chart or module data. */
export function withDashboardView(snapshot: ChartRenderSnapshot, visible: boolean | null): ChartRenderSnapshot {
  return snapshot.dashboard?.eligible && visible !== null && snapshot.dashboard.enabled !== visible
    ? { ...snapshot, dashboard: { ...snapshot.dashboard, enabled: visible } }
    : snapshot;
}

/** Moon list value rows: the mansion row shows only where the Inspector shows mansions. */
export function moonListRowCount(dashboard: ChartDashboard): number {
  return dashboard.moon?.mansion ? 6 : 5;
}

/** Aspect grid rows: every dashboard body except the south node (SE_TRUE_NODE slot). */
export function aspectGridBodies(dashboard: ChartDashboard): ChartDashboardBody[] {
  return (dashboard.bodies ?? []).filter((body) => body.planet !== SE_TRUE_NODE);
}

/** The dashboard replaces the centred wheel only while a module shows. */
export function dashboardShown(dashboard: ChartDashboard | null | undefined): dashboard is ChartDashboard {
  return Boolean(
    dashboard?.enabled
    && dashboard.bodies
    && (dashboard.modules.aspectGrid || dashboard.modules.declination || dashboard.modules.moon),
  );
}

/**
 * Corner text boxes as the DOM overlays paint them (workspace-content
 * `CornerLines` / `OverlayCorner`, `data-aries-chart-corner`), relative to the
 * chart host. The overlays keep their own implementation and positions.
 */
export function measureCornerBoxes(wrap: HTMLElement, host: DOMRect): DashboardCorners {
  const corners: DashboardCorners = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  const scope = wrap.parentElement ?? wrap;
  for (const element of scope.querySelectorAll<HTMLElement>("[data-aries-chart-corner]")) {
    const key = element.dataset.ariesChartCorner as keyof DashboardCorners;
    if (!(key in corners)) continue;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    corners[key] = { x: box.left - host.left, y: box.top - host.top, w: box.width, h: box.height };
  }
  return corners;
}

/**
 * The solver's circle is the painted envelope (outer labels included); the
 * wheel target square is the envelope shrunk by the same budget the centred
 * fit uses (`resolveChartPaintTarget`: side = base / max(targetScale, paintScale)).
 */
export function dashboardWheelTarget(
  layout: DashboardLayout,
  envelope: { paintRadiusScale: number; targetScale: number },
): { x: number; y: number; side: number } | null {
  const wheel = layout.wheel;
  if (!wheel) return null;
  const scale = Math.max(1, envelope.paintRadiusScale || 1, envelope.targetScale || 1);
  const side = (wheel.r * 2) / scale;
  return { x: wheel.cx - side / 2, y: wheel.cy - side / 2, side };
}

/**
 * Resolve CSS colour expressions (var(), color-mix()) in the element's theme
 * scope. A caller that retains `cache` for an unchanged theme scope resolves
 * repeated paints without touching the DOM; the probe exists only on a miss.
 */
export function cssColorResolver(
  element: HTMLElement,
  cache = new Map<string, string>(),
): { color: (expression: string) => string; dispose: () => void } {
  let probe: HTMLSpanElement | null = null;
  return {
    color: (expression) => {
      const hit = cache.get(expression);
      if (hit) return hit;
      if (!probe) {
        probe = document.createElement("span");
        probe.style.cssText = "position:absolute;width:0;height:0;visibility:hidden;pointer-events:none";
        element.appendChild(probe);
      }
      probe.style.color = "";
      probe.style.color = expression;
      const value = getComputedStyle(probe).color;
      cache.set(expression, value);
      return value;
    },
    dispose: () => probe?.remove(),
  };
}

export function cssPixels(element: HTMLElement, name: string, fallback: number): number {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * What the Moon text must not cross, from what is actually painted: every
 * hit region with a box (outer-ring labels, angle labels, glyphs), the wheel
 * rim as a disc (the outermost sector radius), the other modules and the
 * corner text. The Moon list's own box is not an obstacle to itself.
 */
export function dashboardTextObstacles(
  regions: readonly ChartHitRegion[],
  layout: DashboardLayout,
  corners: DashboardCorners,
  surface: { width: number; inset: number },
): DashObstacles {
  const rects: DashRect[] = [];
  const discs: Array<{ x: number; y: number; r: number }> = [];
  let rim: { x: number; y: number; r: number } | null = null;
  for (const region of regions) {
    if (region.styleOnly) continue;
    if ("outerRadius" in region && "cx" in region) {
      if (!rim || region.outerRadius > rim.r) rim = { x: region.cx, y: region.cy, r: region.outerRadius };
      continue;
    }
    if (region.left != null && region.top != null && region.width != null && region.height != null) {
      rects.push({ x: region.left, y: region.top, w: region.width, h: region.height });
    } else if ("r" in region && "x" in region && "y" in region) {
      discs.push({ x: region.x, y: region.y, r: region.r });
    }
  }
  // No sector regions (rare wheel styles): the solver's envelope circle.
  const wheel = layout.wheel;
  if (rim) discs.push(rim);
  else if (wheel) discs.push({ x: wheel.cx, y: wheel.cy, r: wheel.r });
  const own = layout.moon;
  for (const box of dashboardModuleBoxes(layout)) if (box !== own) rects.push(box);
  for (const box of Object.values(corners)) if (box) rects.push(box);
  return { rects, discs, right: surface.width - surface.inset };
}

/**
 * Value key for text obstacles (half-pixel steps): every render builds a new
 * obstacles object, so the retained dashboard layer compares this key, and
 * repaints only when an obstacle actually moved.
 */
export function dashboardObstaclesKey(obstacles: DashObstacles | undefined): string {
  if (!obstacles) return "-";
  const q = (v: number) => Math.round(v * 2) / 2;
  return [
    q(obstacles.right),
    obstacles.rects.map((r) => `${q(r.x)},${q(r.y)},${q(r.w)},${q(r.h)}`).join(";"),
    obstacles.discs.map((d) => `${q(d.x)},${q(d.y)},${q(d.r)}`).join(";"),
  ].join("|");
}

/**
 * Corner reservation metrics from the overlay style for a surface (stable
 * inputs only). Row heights and gaps stay unrounded, plus half a pixel so the
 * reservation still covers the painted (rounded) rows: rounding would step
 * the reservation every ~50 px of surface and nudge the wheel smaller.
 */
export function cornerReservationMetrics(
  overlays: WheelRenderStyle["overlays"],
  viewport: { width: number; height: number },
): CornerReservationMetrics {
  const metrics = resolveWheelOverlayMetrics(overlays, viewport);
  const row = Math.max(metrics.iconSize, metrics.labelSize) * overlays.fontBoxScale * overlays.rowHeightFactor;
  return {
    edgeInset: metrics.edgeInset,
    topEdgeInset: metrics.topEdgeInset,
    lineHeight: Math.max(1, row) + 0.5,
    labelSize: metrics.labelSize,
    gapAfterDayHour: (row + 0.5) * overlays.gapAfterDayHourScale + 0.5,
    gapBetweenGroups: (row + 0.5) * overlays.groupGapScale + 0.5,
    cornerLineHeight: overlays.cornerLineHeight,
    infoGap: overlays.infoGap,
  };
}

/**
 * The dashboard layout for a surface: one call for screen, export and hover.
 * The solver sees reserved corner areas from stable inputs, never measured
 * corner text; `obstacles` are further fixed boxes (the screen's title bar).
 */
export function solveDashboardSurface(
  dashboard: ChartDashboard,
  surface: { width: number; height: number },
  overlays: WheelRenderStyle["overlays"],
  obstacles: readonly DashRect[] = [],
): DashboardLayout {
  const viewport = { width: surface.width, height: surface.height };
  const metrics = cornerReservationMetrics(overlays, viewport);
  return solveDashboardLayout({
    width: surface.width,
    height: surface.height,
    inset: metrics.edgeInset,
    corners: reservedDashboardCorners(surface.width, surface.height, metrics),
    obstacles,
    bodies: aspectGridBodies(dashboard).length,
    modules: dashboard.modules,
    gridLarge: dashboard.gridLarge,
    mirrored: dashboard.declinationMirrored,
    horizontal: dashboard.declinationHorizontal,
    moonRows: moonListRowCount(dashboard),
  });
}

/** Thickness of the strips just outside the surface that outer labels may not cross. */
const EDGE_STRIP = 4096;

function surfaceEdgeStrips({ width: W, height: H }: { width: number; height: number }): DashRect[] {
  return [
    { x: -EDGE_STRIP, y: -EDGE_STRIP, w: W + 2 * EDGE_STRIP, h: EDGE_STRIP },
    { x: -EDGE_STRIP, y: H, w: W + 2 * EDGE_STRIP, h: EDGE_STRIP },
    { x: -EDGE_STRIP, y: 0, w: EDGE_STRIP, h: H },
    { x: W, y: 0, w: EDGE_STRIP, h: H },
  ];
}

/** Painted boxes on whole pixels, so sub-pixel text metrics keep the label layout cache key stable. */
const wholePixels = (box: DashRect): DashRect => {
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  return { x, y, w: Math.ceil(box.x + box.w) - x, h: Math.ceil(box.y + box.h) - y };
};

const abbreviate = (boxes: ReadonlyArray<DashRect | null | undefined>): OuterLabelCollisionBounds[] => boxes
  .filter((box): box is DashRect => Boolean(box && box.w > 0 && box.h > 0))
  .map((box) => ({ ...box, fit: "abbreviate" as const }));

/**
 * The plain wheel's outer word labels shorten against every painted corner
 * block (chart data, events, place, house system) and the surface edges, on
 * screen and in export alike.
 */
export function cornerOuterLabelBounds(
  painted: Partial<DashboardCorners> | null | undefined,
  surface: { width: number; height: number },
): OuterLabelCollisionBounds[] {
  const corners = Object.values(painted ?? {}).map((box) => (box ? wholePixels(box) : null));
  return abbreviate([...corners, ...surfaceEdgeStrips(surface)]);
}

/**
 * What outer word labels shorten against while the dashboard shows, on
 * screen and in export alike: the modules, both corner reservations (the
 * stable areas the solver keeps the wheel out of), the painted corner text
 * where it runs past its reservation (more event rows), and the surface edges.
 */
export function dashboardOuterLabelBounds(
  layout: DashboardLayout,
  surface: { width: number; height: number },
  overlays: WheelRenderStyle["overlays"],
  painted?: Partial<DashboardCorners> | null,
): OuterLabelCollisionBounds[] {
  const corners = reservedDashboardCorners(surface.width, surface.height, cornerReservationMetrics(overlays, surface));
  // Painted text inside its reservation adds nothing; only an overflow is a further box.
  const beyond = (box: DashRect | null | undefined, reserved: DashRect | null) =>
    box && !(reserved && box.x >= reserved.x && box.y >= reserved.y
      && box.x + box.w <= reserved.x + reserved.w && box.y + box.h <= reserved.y + reserved.h) ? wholePixels(box) : null;
  return abbreviate([
    ...dashboardModuleBoxes(layout), corners.topLeft, corners.topRight,
    beyond(painted?.topLeft, corners.topLeft), beyond(painted?.topRight, corners.topRight),
    ...surfaceEdgeStrips(surface),
  ]);
}

export type { DashRect };
