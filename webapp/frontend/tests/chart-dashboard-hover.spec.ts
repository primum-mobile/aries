// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { dashboardContainsPoint, dashboardHitRegions } from "../src/lib/chart/dashboard-hover";
import { moonRowBand, solveDashboardLayout } from "../src/lib/chart/dashboard-layout";
import { declinationGlyphs } from "../src/lib/chart/dashboard-paint";
import { findHitRegion, type ChartHitRegion } from "../src/lib/chart/draw-chart";
import type { ChartDashboard } from "../src/lib/chart/types";

// The dashboard modules duplicate the wheel's hover zones: same region kinds
// and identities, on the modules' painted geometry.

const planetIds = new Map([[0, "sun"], [1, "moon"], [2, "mercury"]]);
const wheel = [
  { kind: "planet", planetId: "sun", seId: 0, x: 500, y: 300, r: 9, longitude: 10, latitude: 0, speed: 1, house: 1, dignity: "peregrin" },
  { kind: "planet", planetId: "moon", seId: 1, x: 520, y: 320, r: 9, longitude: 70, latitude: 0, speed: 13, house: 3, dignity: "peregrin" },
  { kind: "planet", planetId: "mercury", seId: 2, x: 540, y: 340, r: 9, longitude: 20, latitude: 0, speed: 1, house: 1, dignity: "peregrin" },
  { kind: "aspect", p1: "sun", p2: "moon", aspectType: 3, scope: "primary", x: 510, y: 310, r: 4, shape: "line", x1: 500, y1: 300, x2: 520, y2: 320, tolerance: 3, priority: 18 },
] as unknown as ChartHitRegion[];

const dashboard: ChartDashboard = {
  eligible: true,
  enabled: true,
  modules: { aspectGrid: true, declination: true, moon: true },
  gridOrbs: true,
  declinationMirrored: false,
  bodies: [0, 1, 2].map((planet) => ({ id: `planet:${planet}`, planet, glyph: "a" })),
  grid: { cells: {
    "planet:0:planet:1": { glyph: "s", aspectType: 3, orb: "1.0" },
    "planet:0:planet:2": { orb: "10.0", parallel: "parallel" },
  } },
  declination: { obliquity: 23.44, points: [
    { planet: 0, declination: 10 }, { planet: 1, declination: -5 }, { planet: 2, declination: 10.4 },
  ] },
  moon: {
    elongation: 60, increasingInLight: true, increasingInLatitude: true, swift: true, longitudeSpeed: 13,
    latitude: 1, lunarDay: { day: 5, meanDay: null }, mansion: null,
    voidOfCourse: { isVoid: false },
    last: { planet: 0, aspectType: 3, glyph: "s", orb: 1, applying: false }, next: null,
  },
};

function setup(width = 1008, height = 860, data: ChartDashboard = dashboard) {
  const layout = solveDashboardLayout({
    width, height, inset: 16, corners: { topLeft: null, topRight: null },
    bodies: 3, modules: dashboard.modules, mirrored: false, moonRows: 5,
  });
  const regions = [...wheel, ...dashboardHitRegions(layout, data, wheel, planetIds)];
  return { layout, regions };
}

test.describe("dashboard hover zones", () => {
  test("appearance menus cover modules, including empty cells, and exclude the wheel and empty space", () => {
    const { layout } = setup();
    const c = layout.cell;
    const grid = layout.grid!;
    const top = grid.bottom - grid.size;
    expect(dashboardContainsPoint(layout, grid.left + 1.5 * c, top + 2.5 * c)).toBe(true);
    expect(dashboardContainsPoint(layout, grid.left + 2.5 * c, top + 0.5 * c)).toBe(false);
    for (const box of [layout.scale!.rect, layout.moon!]) {
      expect(dashboardContainsPoint(layout, box.x + box.w / 2, box.y + box.h / 2)).toBe(true);
    }
    expect(dashboardContainsPoint(layout, layout.wheel!.cx, layout.wheel!.cy)).toBe(false);
    expect(dashboardContainsPoint(layout, 0, 0)).toBe(false);
    expect(dashboardContainsPoint(null, grid.left, top)).toBe(false);
  });

  test("an axis glyph and an aspect cell resolve to the wheel's own targets", () => {
    const { layout, regions } = setup();
    const c = layout.cell;
    const top = layout.grid!.bottom - 3 * c;
    const left = layout.grid!.left;
    // Row 1 diagonal = Moon's axis glyph.
    const axis = findHitRegion(regions, left + c * 1.5, top + c * 1.5)!;
    expect(axis).toMatchObject({ kind: "planet", seId: 1, planetId: "moon", house: 3 });
    // Row 1, col 0 = Sun–Moon sextile: the wheel's aspect identity.
    const cell = findHitRegion(regions, left + c * 0.5, top + c * 1.5)!;
    expect(cell).toMatchObject({ kind: "aspect", p1: "sun", p2: "moon", aspectType: 3, scope: "primary" });
    expect(cell).not.toHaveProperty("shape");
  });

  test("a parallel-only cell shows the pair's declination contact; an empty cell nothing", () => {
    const { layout, regions } = setup();
    const c = layout.cell;
    const top = layout.grid!.bottom - 3 * c;
    const left = layout.grid!.left;
    expect(findHitRegion(regions, left + c * 0.5, top + c * 2.5)).toMatchObject({ kind: "declination", seId: 2, partner: 0 });
    // Row 2, col 1: Moon–Mercury has no cell data.
    const empty = findHitRegion(regions, left + c * 1.5, top + c * 2.5);
    expect(empty?.kind === "declination" || empty?.kind === "aspect").toBe(false);
  });

  test("hidden parallel marks leave their cell without a declination hover", () => {
    const { layout, regions } = setup(1008, 860, { ...dashboard, gridParallels: false });
    const c = layout.cell;
    const top = layout.grid!.bottom - 3 * c;
    const hit = findHitRegion(regions, layout.grid!.left + c * 0.5, top + c * 2.5);
    expect(hit?.kind === "declination").toBe(false);
  });

  test("scale glyphs carry their body's declination hover", () => {
    const { layout, regions } = setup();
    const glyphs = declinationGlyphs(dashboard, layout.scale!.kind, layout.scale!.rect, layout.glyph);
    for (const glyph of glyphs) {
      expect(findHitRegion(regions, glyph.x, glyph.y)).toMatchObject({ kind: "declination", seId: glyph.planet });
      expect(findHitRegion(regions, glyph.x, glyph.y)).not.toHaveProperty("partner");
    }
  });

  test("all declination scale layouts omit the south node but retain the north node and other southern bodies", () => {
    const { layout } = setup();
    const data: ChartDashboard = {
      ...dashboard,
      bodies: [
        ...dashboard.bodies!,
        { id: "planet:10", planet: 10, glyph: "K" },
        { id: "planet:11", planet: 11, glyph: "L" },
      ],
      declination: {
        ...dashboard.declination!,
        points: [
          ...dashboard.declination!.points,
          { planet: 10, declination: 12 },
          { planet: 11, declination: -12 },
        ],
      },
    };
    for (const kind of ["bar", "folded-bar", "strip"] as const) {
      const ids = declinationGlyphs(data, kind, layout.scale!.rect, layout.glyph).map((glyph) => glyph.planet);
      expect(ids).toContain(10);
      expect(ids).toContain(1);
      expect(ids).not.toContain(11);
    }
  });

  test("Moon Last row reuses the wheel's aspect region; the rest of the module is the Moon", () => {
    const { layout, regions } = setup();
    const moon = layout.moon!;
    const lastBand = moonRowBand(moon, layout.text, 3, 5);
    const lastY = lastBand.y + lastBand.h / 2;
    expect(findHitRegion(regions, moon.x + 20, lastY)).toMatchObject({ kind: "aspect", p1: "sun", p2: "moon", aspectType: 3 });
    // An empty Next row, a status row and the heading all show the Moon.
    const nextBand = moonRowBand(moon, layout.text, 4, 5);
    const phaseBand = moonRowBand(moon, layout.text, 0, 5);
    for (const [x, y] of [[moon.x + 20, nextBand.y + nextBand.h / 2], [moon.x + moon.w - 4, phaseBand.y + 2], [moon.x + 4, moon.y + 2]]) {
      expect(findHitRegion(regions, x, y)).toMatchObject({ kind: "planet", seId: 1, planetId: "moon", house: 3 });
    }
  });

  test("Moon contacts outside drawing orbs still open their aspect", () => {
    const { layout } = setup();
    const data: ChartDashboard = {
      ...dashboard,
      moon: {
        ...dashboard.moon!,
        next: { planet: 2, aspectType: 10, glyph: "o", orb: 9.3, applying: true },
      },
    };
    const regions = dashboardHitRegions(layout, data, wheel, planetIds);
    const band = moonRowBand(layout.moon!, layout.text, 4, 5);
    expect(findHitRegion(regions, band.x + 20, band.y + band.h / 2)).toMatchObject({
      kind: "aspect", p1: "moon", p2: "mercury", aspectType: 10, scope: "primary",
    });
  });

  test("zones follow the painted geometry of this frame", () => {
    const a = setup(1008, 860);
    const b = setup(1280, 800);
    const zone = (regions: ChartHitRegion[]) => regions.find((r) => r.kind === "planet" && r.seId === 1 && r.priority === 40)!;
    expect(zone(a.regions).y).not.toBe(zone(b.regions).y);
  });
});
