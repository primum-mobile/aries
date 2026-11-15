// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { solveDashboardSurface } from "../src/lib/chart/dashboard-canvas";
import type { DashboardLayout } from "../src/lib/chart/dashboard-layout";
import { DEFAULT_WHEEL_RENDER_STYLE } from "../src/lib/chart/wheel-render-style";
import type { ChartDashboard } from "../src/lib/chart/types";

/**
 * Fluid resizing without pumping. Sweeps grow one side of the surface through the app's own
 * solver input (`solveDashboardSurface`, shipped overlay style) and require:
 * - the wheel never visibly shrinks (at most the solver's 1 px tie tolerance);
 * - module size (grid cell) never shrinks and grows smoothly, by at most
 *   0.05 px per pixel of resize;
 * - no placement (bar or strip, Moon list left or right) comes back once
 *   the sweep has left it, so nothing flickers back and forth.
 */

const OVERLAYS = DEFAULT_WHEEL_RENDER_STYLE.overlays;
/** RADIUS_TIE in dashboard-layout.ts. */
const RADIUS_SLACK = 1;
const CELL_PER_PIXEL = 0.05;

function dashboard(overrides: Partial<ChartDashboard> = {}): ChartDashboard {
  return {
    eligible: true,
    enabled: true,
    modules: { aspectGrid: true, declination: true, moon: true },
    gridOrbs: true,
    declinationMirrored: false,
    declinationHorizontal: false,
    bodies: Array.from({ length: 13 }, (_, planet) => ({ id: `planet:${planet}`, planet, glyph: "a" })),
    moon: { mansion: { number: 1 } } as ChartDashboard["moon"],
    ...overrides,
  };
}

const placement = (layout: DashboardLayout) =>
  `${layout.scale?.kind ?? "-"}/${!layout.moon ? "-" : layout.moon.x < (layout.wheel?.cx ?? 0) ? "left" : "right"}`;

function sweep(axis: "width" | "height", fixed: number, from: number, to: number, step: number, dash: ChartDashboard) {
  const failures: string[] = [];
  const runs: string[] = [];
  let previous: DashboardLayout | null = null;
  for (let value = from; value <= to; value += step) {
    const surface = axis === "width" ? { width: value, height: fixed } : { width: fixed, height: value };
    const layout = solveDashboardSurface(dash, surface, OVERLAYS);
    if (!layout.wheel) {
      failures.push(`${value}: no wheel`);
      continue;
    }
    if (previous?.wheel) {
      const drop = previous.wheel.r - layout.wheel.r;
      if (drop > RADIUS_SLACK) failures.push(`${value}: wheel −${drop.toFixed(2)} px`);
      const grown = layout.cell - previous.cell;
      if (grown < 0 || grown > CELL_PER_PIXEL * step) failures.push(`${value}: cell ${previous.cell.toFixed(2)} → ${layout.cell.toFixed(2)}`);
    }
    if (runs.at(-1) !== placement(layout)) runs.push(placement(layout));
    previous = layout;
  }
  return { failures, runs };
}

const cases: Array<[string, ChartDashboard]> = [
  ["default", dashboard()],
  ["always horizontal", dashboard({ declinationHorizontal: true })],
];

test.describe("dashboard resizing is fluid: nothing shrinks, nothing jumps", () => {
  for (const [label, dash] of cases) {
    for (const height of [800, 1000, 1100]) {
      test(`${label}: width 600–1800 at height ${height}`, () => {
        const { failures, runs } = sweep("width", height, 600, 1800, 2, dash);
        expect(failures).toEqual([]);
        expect(new Set(runs).size).toBe(runs.length);
      });
    }
    for (const width of [700, 1000, 1600]) {
      test(`${label}: height 600–1400 at width ${width}`, () => {
        const { failures, runs } = sweep("height", width, 600, 1400, 3, dash);
        expect(failures).toEqual([]);
        expect(new Set(runs).size).toBe(runs.length);
      });
    }
  }

  test("mirrored scale and modules switched off resize fluidly too", () => {
    for (const dash of [
      dashboard({ declinationMirrored: true }),
      dashboard({ modules: { aspectGrid: true, declination: true, moon: false } }),
      dashboard({ modules: { aspectGrid: true, declination: false, moon: true } }),
      dashboard({ modules: { aspectGrid: false, declination: true, moon: true } }),
    ]) {
      expect(sweep("width", 1000, 600, 1800, 4, dash).failures).toEqual([]);
    }
  });

  test("the always-horizontal setting never leaves the bar", () => {
    const { runs } = sweep("width", 1000, 600, 1800, 4, dashboard({ declinationHorizontal: true }));
    expect(runs).toEqual(["bar/right"]);
  });
});
