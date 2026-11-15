// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { dashboardShown, dashboardWheelTarget, solveDashboardSurface } from "./dashboard-canvas";
import { fitModulesToCornerText, type DashboardCorners, type DashboardLayout, type DashRect } from "./dashboard-layout";
import type { WheelRenderStyle } from "./wheel-render-style";
import type { ChartDashboard, ChartDashboardCell, ChartDashboardMoonContact } from "./types";

/**
 * Chart dashboard in PNG/PDF export (`chart-export-renderer.ts`). The layout
 * is the screen's (`solveDashboardSurface`, reserved corners from stable
 * inputs); the export's own painted corner text only makes the modules yield,
 * as the DOM overlays do on screen. The wheel then takes the solver's circle
 * exactly as `chart-canvas.tsx` `resolveTarget` does.
 */

export type ExportDashboardPlacement = {
  layout: DashboardLayout;
  /** Wheel target square; null keeps the centred fit (no circle fits). */
  wheel: { chartSize: number; center: readonly [number, number] } | null;
};

export function exportDashboardPlacement(
  dashboard: ChartDashboard | null | undefined,
  surface: { width: number; height: number },
  overlays: WheelRenderStyle["overlays"],
  envelope: { paintRadiusScale: number; targetScale: number },
  painted?: DashboardCorners | null,
): ExportDashboardPlacement | null {
  if (!dashboardShown(dashboard)) return null;
  const layout = fitModulesToCornerText(solveDashboardSurface(dashboard, surface, overlays), painted);
  const target = dashboardWheelTarget(layout, envelope);
  return {
    layout,
    wheel: target ? { chartSize: target.side, center: [target.x + target.side / 2, target.y + target.side / 2] } : null,
  };
}

/** Smallest box holding both (either may be absent). */
export function unionRect(a: DashRect | null, b: DashRect | null): DashRect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * Print appearance for the dashboard payload, mirroring `printSnapshot`:
 * bodies take the printed wheel colour of the same planet, aspect glyphs keep
 * their colour only in coloured-details mode, everything else is black.
 */
export function printDashboard(
  dashboard: ChartDashboard,
  planetColors: ReadonlyMap<number, string>,
  keepAspectColors: boolean,
  black: string,
): ChartDashboard {
  const aspect = <T extends ChartDashboardCell | ChartDashboardMoonContact>(entry: T): T =>
    keepAspectColors ? entry : { ...entry, color: black, colorRole: undefined };
  const contact = (entry: ChartDashboardMoonContact | null) => (entry ? aspect(entry) : entry);
  return {
    ...dashboard,
    bodies: dashboard.bodies?.map((body) => ({ ...body, color: planetColors.get(body.planet) ?? black, colorRole: undefined })),
    grid: dashboard.grid
      ? { cells: Object.fromEntries(Object.entries(dashboard.grid.cells).map(([key, cell]) => [key, {
        ...aspect(cell),
        // Parallel marks print like aspect glyphs.
        ...(cell.parallel && !keepAspectColors ? { parallelColor: black } : {}),
      }])) }
      : dashboard.grid,
    moon: dashboard.moon ? { ...dashboard.moon, last: contact(dashboard.moon.last), next: contact(dashboard.moon.next) } : dashboard.moon,
  };
}

/**
 * Print ink for the painter's colours: theme-token expressions (rules, text,
 * out-of-bounds tint) print black with their own alpha, like the print
 * palette's text and frame; literal payload colours (already printed by
 * `printDashboard`) pass through.
 */
export function printDashboardColor(resolve: (expression: string) => string, black: string): (expression: string) => string {
  const ink = black.replace(/\)\s*$/, "");
  return (expression) => {
    const resolved = resolve(expression);
    if (!expression.includes("var(")) return resolved;
    const alpha = cssAlpha(resolved);
    return alpha >= 1 ? black : `${ink} / ${alpha})`;
  };
}

/** Alpha of a computed CSS colour (`rgba(…, a)`, `rgb(… / a)`, `color(… / a)`). */
export function cssAlpha(color: string): number {
  const raw = color.match(/\/\s*([\d.]+%?)\s*\)\s*$/)?.[1]
    ?? color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+%?)\s*\)$/)?.[1];
  if (!raw) return 1;
  const value = raw.endsWith("%") ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

/**
 * Replace every `var(--name[, fallback])` with the token value (overrides
 * first, then `read`), recursively. Unknown tokens without a fallback stay as
 * `var()` for the DOM to resolve in the root scope.
 */
export function substituteCssVars(
  expression: string,
  read: (name: string) => string | undefined,
  stack: ReadonlySet<string> = new Set(),
): string {
  let out = "";
  let index = 0;
  for (;;) {
    const start = expression.indexOf("var(", index);
    if (start < 0) return out + expression.slice(index);
    let depth = 0;
    let comma = -1;
    let end = -1;
    for (let i = start + 3; i < expression.length; i += 1) {
      const ch = expression[i];
      if (ch === "(") depth += 1;
      else if (ch === ")" && --depth === 0) {
        end = i;
        break;
      } else if (ch === "," && depth === 1 && comma < 0) comma = i;
    }
    if (end < 0) return out + expression.slice(index);
    const name = expression.slice(start + 4, comma < 0 ? end : comma).trim();
    const fallback = comma < 0 ? null : expression.slice(comma + 1, end).trim();
    const value = stack.has(name) ? "" : read(name)?.trim() ?? "";
    const next = new Set(stack).add(name);
    const resolved = value
      ? substituteCssVars(value, read, next)
      : fallback != null
        ? substituteCssVars(fallback, read, next)
        : expression.slice(start, end + 1);
    out += expression.slice(index, start) + resolved;
    index = end + 1;
  }
}
