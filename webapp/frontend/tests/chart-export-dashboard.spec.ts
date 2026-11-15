// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  exportDashboardPlacement,
  cssAlpha,
  printDashboard,
  printDashboardColor,
  substituteCssVars,
  unionRect,
} from "../src/lib/chart/chart-export-dashboard";
import { cornerReservationMetrics, dashboardWheelTarget, solveDashboardSurface } from "../src/lib/chart/dashboard-canvas";
import {
  dashboardTextSize,
  dashboardTopLeftLines,
  fitModulesToCornerText,
  reservedDashboardCorners,
  solveDashboardLayout,
  type DashboardCorners,
} from "../src/lib/chart/dashboard-layout";
import { drawSurfaceOverlays } from "../src/lib/chart/chart-export-renderer";
import { DEFAULT_WHEEL_RENDER_STYLE } from "../src/lib/chart/wheel-render-style";
import type { ChartDashboard } from "../src/lib/chart/types";

const ENVELOPE = { paintRadiusScale: 1.08, targetScale: 1.04 };

function dashboard(overrides: Partial<ChartDashboard> = {}): ChartDashboard {
  return {
    eligible: true,
    enabled: true,
    modules: { aspectGrid: true, declination: true, moon: true },
    gridOrbs: true,
    declinationMirrored: false,
    bodies: Array.from({ length: 12 }, (_, planet) => ({
      id: `p${planet}`, planet, glyph: "a", color: "#c03030", colorRole: `--aries-planet-${planet}`,
    })),
    grid: { cells: { "planet:0:planet:1": { glyph: "b", aspectType: 0, color: "#3060c0", colorRole: "--aries-aspect-0" } } },
    ...overrides,
  };
}

// Export corner text as drawSurfaceOverlays paints it (PDF page, 900 × 1200).
function corners(width: number, height: number): DashboardCorners {
  return {
    topLeft: { x: 18, y: 18, w: 180, h: 60 },
    topRight: { x: width - 18 - 140, y: 18, w: 140, h: 70 },
    bottomLeft: { x: 18, y: height - 18 - 36, w: 170, h: 36 },
    bottomRight: { x: width - 18 - 110, y: height - 18 - 36, w: 110, h: 36 },
  };
}

const OVERLAYS = DEFAULT_WHEEL_RENDER_STYLE.overlays;

test.describe("chart export dashboard", () => {
  test("off or empty dashboards keep the centred wheel", () => {
    const surface = { width: 900, height: 1200 };
    expect(exportDashboardPlacement(null, surface, OVERLAYS, ENVELOPE)).toBeNull();
    expect(exportDashboardPlacement(dashboard({ enabled: false }), surface, OVERLAYS, ENVELOPE)).toBeNull();
    expect(exportDashboardPlacement(
      dashboard({ modules: { aspectGrid: false, declination: false, moon: false } }),
      surface, OVERLAYS, ENVELOPE,
    )).toBeNull();
  });

  for (const [kind, width, height] of [["pdf", 900, 1200], ["png", 1344, 1200]] as const) {
    test(`${kind} places the wheel at the live solver's target`, () => {
      const surface = { width, height };
      const box = corners(width, height);
      const placement = exportDashboardPlacement(dashboard(), surface, OVERLAYS, ENVELOPE, box)!;
      // The screen's layout for the same surface, yielding to the export's painted text.
      const live = fitModulesToCornerText(solveDashboardSurface(dashboard(), surface, OVERLAYS), box);
      expect(placement.layout).toBe(live);
      expect(placement.layout.scale!.kind).toBe(kind === "pdf" ? "bar" : "strip");
      const target = dashboardWheelTarget(live, ENVELOPE)!;
      expect(placement.wheel).toEqual({
        chartSize: target.side,
        center: [target.x + target.side / 2, target.y + target.side / 2],
      });
      // The wheel's painted envelope clears the reserved corner areas.
      const wheel = placement.layout.wheel!;
      const reserved = reservedDashboardCorners(width, height, cornerReservationMetrics(OVERLAYS, surface));
      for (const rect of Object.values(reserved)) {
        const dx = Math.max(rect!.x - wheel.cx, 0, wheel.cx - rect!.x - rect!.w);
        const dy = Math.max(rect!.y - wheel.cy, 0, wheel.cy - rect!.y - rect!.h);
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(wheel.r);
      }
    });
  }

  test("painted corner text and the PNG watermark never move the wheel", () => {
    const text = { x: 18, y: 18, w: 180, h: 60 };
    expect(unionRect(text, null)).toEqual(text);
    expect(unionRect(null, text)).toEqual(text);
    expect(unionRect(text, { x: 18, y: 84, w: 240, h: 30 })).toEqual({ x: 18, y: 18, w: 240, h: 96 });
    const base = corners(1344, 1200);
    const marked = { ...base, topLeft: unionRect(base.topLeft, { x: 18, y: 84, w: 240, h: 30 }) };
    const surface = { width: 1344, height: 1200 };
    const plain = exportDashboardPlacement(dashboard(), surface, OVERLAYS, ENVELOPE, base)!;
    const withMark = exportDashboardPlacement(dashboard(), surface, OVERLAYS, ENVELOPE, marked)!;
    expect(withMark.layout.wheel).toEqual(plain.layout.wheel);
    expect(withMark.wheel).toEqual(plain.wheel);
  });

  test("print appearance inks the payload like the printed wheel", () => {
    const black = "rgb(0 0 0)";
    const colors = new Map([[0, "rgb(200 40 40)"]]);
    const mono = printDashboard(dashboard(), colors, false, black);
    expect(mono.bodies![0]).toMatchObject({ color: "rgb(200 40 40)", colorRole: undefined });
    expect(mono.bodies![1]).toMatchObject({ color: black, colorRole: undefined });
    expect(mono.grid!.cells["planet:0:planet:1"]).toMatchObject({ color: black, colorRole: undefined });
    const colored = printDashboard(dashboard(), colors, true, black);
    expect(colored.grid!.cells["planet:0:planet:1"].colorRole).toBe("--aries-aspect-0");
  });

  test("token substitution resolves nested var() from the export theme", () => {
    const tokens: Record<string, string> = {
      "--aries-text-dim": "#808080",
      "--aries-planet-0": "var(--aries-accent)",
      "--aries-accent": "#123456",
    };
    const read = (name: string) => tokens[name];
    expect(substituteCssVars("var(--aries-planet-0, rgb(1, 2, 3))", read)).toBe("#123456");
    expect(substituteCssVars("var(--missing, rgb(1, 2, 3))", read)).toBe("rgb(1, 2, 3)");
    expect(substituteCssVars("color-mix(in srgb, var(--aries-text-dim) 14%, transparent)", read))
      .toBe("color-mix(in srgb, #808080 14%, transparent)");
    expect(substituteCssVars("var(--unknown)", read)).toBe("var(--unknown)");
    expect(substituteCssVars("var(--loop)", (name) => (name === "--loop" ? "var(--loop)" : undefined))).toBe("var(--loop)");
  });

  test("print ink blackens theme tokens, keeps their alpha and passes payload colours", () => {
    const computed: Record<string, string> = {
      "var(--aries-text-muted)": "rgb(140, 120, 100)",
      "color-mix(in srgb, var(--aries-text-dim) 14%, transparent)": "color(srgb 0.5 0.5 0.5 / 0.14)",
      "rgb(200 40 40)": "rgb(200, 40, 40)",
    };
    const color = printDashboardColor((expression) => computed[expression], "rgb(0 0 0)");
    expect(color("var(--aries-text-muted)")).toBe("rgb(0 0 0)");
    expect(color("color-mix(in srgb, var(--aries-text-dim) 14%, transparent)")).toBe("rgb(0 0 0 / 0.14)");
    expect(color("rgb(200 40 40)")).toBe("rgb(200, 40, 40)");
    expect(cssAlpha("rgba(1, 2, 3, 0.5)")).toBe(0.5);
    expect(cssAlpha("rgb(1 2 3 / 40%)")).toBe(0.4);
    expect(cssAlpha("rgb(1, 2, 3)")).toBe(1);
  });
});

test.describe("dashboard corners: one top-left chart-data block", () => {
  const W = 1008;
  const H = 860;
  type Line = { text: string; x: number; y: number; size: number };

  function chartFixture(dash: ChartDashboard | null) {
    const options = { theme: 0, showInformation: true, showHouseSystem: true };
    const meta = {
      name: "Morinus", dateDisplay: "1583-02-23", timeDisplay: "08:40:00", anchorDisplay: "1583-02-23 08:40:00",
      place: "Villefranche", placeCoords: "45N59 4E43", houseSystemLines: ["Placidus"],
      cornerLines: { topLeft: ["1583-02-23", "08:40:00"], bottomLeft: ["Villefranche", "45N59 4E43"] },
    };
    return {
      primaryChart: { options, meta, planets: [] },
      displayDatetime: "1583-02-23T08:40:00", renderVariant: "round-classic",
      overlayRenderMode: "full", outerRingMode: "none",
      ...(dash ? { dashboard: dash } : {}),
    } as unknown as Parameters<typeof drawSurfaceOverlays>[1];
  }

  function paint(dash: ChartDashboard | null) {
    const lines: Line[] = [];
    const draw = {
      ctx: new Proxy({}, { get: () => () => undefined }),
      text: ([x, y]: number[], text: string, opts: { size?: number }) => lines.push({ text, x, y, size: opts.size ?? 0 }),
      textsize: (text: string, opts: { size?: number } = {}) => [text.length * (opts.size ?? 12) * 0.5, opts.size ?? 12],
    } as unknown as Parameters<typeof drawSurfaceOverlays>[0];
    const request = { kind: "pdf", includeOverlays: true, colorMode: "screen" } as Parameters<typeof drawSurfaceOverlays>[5];
    const boxes = drawSurfaceOverlays(draw, chartFixture(dash), DEFAULT_WHEEL_RENDER_STYLE, W, H, request);
    return { lines, boxes };
  }

  test("pure helpers: order and module text size", () => {
    expect(dashboardTopLeftLines(["date", "time"], ["place", "coords"], ["Placidus"]))
      .toEqual(["date", "time", "place", "coords", "Placidus"]);
    expect(dashboardTopLeftLines(["date"], [], ["Placidus"])).toEqual(["date", "Placidus"]);
    expect(dashboardTextSize(1280, 800)).toBeCloseTo(22 * 0.55);
    expect(dashboardTextSize(1008, 860)).toBeCloseTo(23.2 * 0.55);
    expect(dashboardTextSize(648, 860)).toBe(11);
  });

  test("export merges place and house system into the top-left block while the dashboard shows", () => {
    const { lines, boxes } = paint(dashboard());
    expect(boxes.bottomLeft).toBeNull();
    expect(boxes.bottomRight).toBeNull();
    const top = lines.filter((line) => line.x === lines[0].x).map((line) => line.text);
    expect(top).toEqual(expect.arrayContaining(["Villefranche", "45N59 4E43", "Placidus"]));
    const place = lines.find((line) => line.text === "Villefranche")!;
    const house = lines.find((line) => line.text === "Placidus")!;
    expect(place.y).toBeLessThan(house.y);
    expect(house.y).toBeLessThan(H / 2);
    expect(place.size).toBe(dashboardTextSize(W, H));
    // The layout's grid then sits on the bottom inset.
    const inset = 16;
    const layout = solveDashboardLayout({ width: W, height: H, inset, corners: { topLeft: boxes.topLeft, topRight: boxes.topRight }, bodies: 12,
      modules: { aspectGrid: true, declination: true, moon: true }, mirrored: false });
    expect(layout.grid!.bottom).toBeCloseTo(H - inset);
  });

  test("outside the dashboard the corners stay as they are", () => {
    const { lines, boxes } = paint(null);
    expect(boxes.bottomLeft).not.toBeNull();
    expect(boxes.bottomRight).not.toBeNull();
    expect(lines.find((line) => line.text === "Placidus")!.y).toBeGreaterThan(H / 2);
  });
});
