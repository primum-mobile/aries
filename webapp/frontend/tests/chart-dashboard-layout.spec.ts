// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  MAX_CELL,
  MIN_CELL,
  RESERVED_TOP_LEFT_LINES,
  RESERVED_TOP_RIGHT_ROWS,
  dashboardCell,
  dashboardTextSize,
  fitModulesToCornerText,
  moonListHeight,
  reservedDashboardCorners,
  solveDashboardLayout,
  solveWheelCircle,
  dashboardModuleBoxes,
  gridInk,
  moonInk,
  oneSidedBarInkHeight,
  type DashRect,
  type DashboardLayout,
  type DashboardLayoutInput,
} from "../src/lib/chart/dashboard-layout";
import { VOID_NEXT_ALPHA, barGeometry, declinationGlyphs, estimateScaleMetrics, fitRunsToWidth, moonListRows, orbWithPhaseMetrics, paintDashboard, paintMoonList, parallelMark, spreadLabels, textRightLimit } from "../src/lib/chart/dashboard-paint";
import { printDashboard } from "../src/lib/chart/chart-export-dashboard";
import { cornerOuterLabelBounds, cornerReservationMetrics, dashboardObstaclesKey, dashboardOuterLabelBounds, dashboardTextObstacles, moonListRowCount } from "../src/lib/chart/dashboard-canvas";
import { DEFAULT_WHEEL_RENDER_STYLE, resolveWheelOverlayMetrics } from "../src/lib/chart/wheel-render-style";

const OVERLAYS = DEFAULT_WHEEL_RENDER_STYLE.overlays;

// The app's solver input for a surface: reserved corners and inset from the shipped overlay style.
function input(width: number, height: number, overrides: Partial<DashboardLayoutInput> = {}): DashboardLayoutInput {
  const metrics = cornerReservationMetrics(OVERLAYS, { width, height });
  return {
    width,
    height,
    inset: metrics.edgeInset,
    corners: reservedDashboardCorners(width, height, metrics),
    bodies: 13,
    modules: { aspectGrid: true, declination: true, moon: true },
    mirrored: false,
    moonRows: 6,
    ...overrides,
  };
}

const solve = (width: number, height: number, overrides: Partial<DashboardLayoutInput> = {}) =>
  solveDashboardLayout(input(width, height, overrides));

test("larger aspect grid changes its cells without resizing the other dashboard modules", () => {
  const regular = solve(1580, 1030);
  const large = solve(1580, 1030, { gridLarge: true });
  expect(large.cell).toBeCloseTo(regular.cell * 1.2);
  expect(large.grid!.size).toBeCloseTo(regular.grid!.size * 1.2);
  expect(large.glyph).toBe(regular.glyph);
  expect(large.text).toBe(regular.text);
  expect(large).not.toBe(regular);
});

// Brute force (mockup `dashboard-a-shrink.ts` `solve`): 2 px radius steps
// from the short half side, 2 px centre grid, most central centre per radius.
type Pt = { x: number; y: number };
const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const polyDist = (p: Pt, poly: Pt[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? 0 : Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length])));
};
function bruteForce(W: number, H: number, obstacles: Array<Pt[]>, gap: number) {
  for (let r = Math.min(W, H) / 2; r > 100; r -= 2) {
    let pick: { cx: number; cy: number; d: number } | null = null;
    for (let cy = r; cy <= H - r; cy += 2) {
      for (let cx = r; cx <= W - r; cx += 2) {
        if (obstacles.some((poly) => polyDist({ x: cx, y: cy }, poly) < r + gap)) continue;
        const d = Math.abs(cx - W / 2) + Math.abs(cy - H / 2) * 0.2;
        if (!pick || d < pick.d) pick = { cx, cy, d };
      }
    }
    if (pick) return { cx: pick.cx, cy: pick.cy, r };
  }
  return null;
}

const rectPoly = (r: DashRect): Pt[] => [
  { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
];

function obstaclesOf(layout: DashboardLayout, inp: DashboardLayoutInput): Array<Pt[]> {
  const out: Array<Pt[]> = Object.values(inp.corners).filter((b): b is DashRect => Boolean(b)).map(rectPoly);
  if (layout.grid) {
    const { left: gx, bottom, size: L } = layout.grid;
    out.push(gridInk(gx, bottom - L, L, layout.cell));
  }
  if (layout.scale) out.push(rectPoly(layout.scale.rect));
  if (layout.moon) out.push(rectPoly(moonInk(layout.moon, layout.text)));
  return out;
}

function overlaps(a: DashRect, b: DashRect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const clearance = (box: DashRect, wheel: { cx: number; cy: number }) => Math.hypot(
  Math.max(box.x - wheel.cx, 0, wheel.cx - box.x - box.w),
  Math.max(box.y - wheel.cy, 0, wheel.cy - box.y - box.h),
);

test.describe("chart dashboard layout", () => {
  test("the cell cap and text size ramp continuously with the short side", () => {
    expect(dashboardCell(600, 900)).toBe(MIN_CELL);
    expect(dashboardCell(700, 1000)).toBe(MIN_CELL);
    expect(dashboardCell(1000, 900)).toBe(24);
    expect(dashboardCell(1400, 1100)).toBe(MAX_CELL);
    expect(dashboardCell(1800, 1300)).toBe(MAX_CELL);
    expect(dashboardTextSize(648, 860)).toBe(11);
    expect(dashboardTextSize(1600, 1000)).toBeCloseTo(26 * 0.55);
    for (let short = 600; short < 1200; short++) {
      expect(dashboardCell(short + 1, 2000) - dashboardCell(short, 2000)).toBeLessThanOrEqual(0.03);
    }
  });

  for (const [W, H] of [[600, 1000], [700, 1000]] as const) {
    test(`tall surface ${W}×${H}: bar beside the grid, Moon list above its right end`, () => {
      const layout = solve(W, H);
      const inset = input(W, H).inset;
      expect(layout.scale?.kind).toBe("bar");
      const bar = layout.scale!.rect;
      expect(bar.x).toBeGreaterThanOrEqual(layout.grid!.left + layout.grid!.size + layout.gap - 0.01);
      expect(bar.x + bar.w).toBeCloseTo(W - inset);
      expect(bar.y + bar.h).toBeCloseTo(layout.grid!.bottom);
      expect(bar.h).toBeCloseTo(oneSidedBarInkHeight(layout.glyph));
      expect(layout.moon!.y + layout.moon!.h).toBeCloseTo(bar.y - 1.5 * layout.gap);
      expect(layout.moon!.h).toBeCloseTo(moonListHeight(layout.text));
      expect(layout.moon!.x + layout.moon!.w).toBeCloseTo(bar.x + bar.w);
    });
  }

  test("one-sided bar box is its ink, Moon 1.5 gaps above; the mirrored bar keeps 4.4 glyphs and one gap", () => {
    const normal = solve(600, 1000);
    const folded = solve(600, 1000, { mirrored: true });
    expect(folded.scale?.kind).toBe("folded-bar");
    expect(folded.scale!.rect.h).toBeCloseTo(folded.glyph * 4.4);
    expect(folded.moon!.y + folded.moon!.h).toBeCloseTo(folded.scale!.rect.y - folded.gap);
    expect(normal.scale!.rect.h).toBeCloseTo(oneSidedBarInkHeight(normal.glyph));
    expect(normal.scale!.rect.h).toBeLessThan(folded.scale!.rect.h);
    expect(normal.scale!.rect.y + normal.scale!.rect.h).toBeCloseTo(folded.scale!.rect.y + folded.scale!.rect.h);
    expect(normal.moon!.y + normal.moon!.h).toBeCloseTo(normal.scale!.rect.y - 1.5 * normal.gap);
    expect(normal.wheel!.r).toBeGreaterThanOrEqual(folded.wheel!.r - 0.5);
    expect(solve(1008, 860, { mirrored: true }).scale?.kind).toBe("strip");
  });

  test("the one-sided bar's box covers its painted ink: labels up to the glyph row", () => {
    for (const g of [12, 18, 25.2]) {
      const m = estimateScaleMetrics(g);
      const rect = { x: 0, y: 0, w: 400, h: oneSidedBarInkHeight(g) };
      const bar = barGeometry("bar", rect, g, m);
      expect(bar.northY - m.glyphAscent).toBeCloseTo(rect.y);
      expect(bar.labelBaseline).toBeCloseTo(rect.y + rect.h);
    }
  });

  for (const [W, H] of [[600, 1000], [1008, 860], [1096, 1050]] as const) {
    test(`wheel matches the mockup brute force at ${W}×${H}`, () => {
      const inp = input(W, H, { modules: { aspectGrid: true, declination: true, moon: false } });
      const layout = solveDashboardLayout(inp);
      const reference = bruteForce(W, H, obstaclesOf(layout, inp), layout.gap)!;
      expect(layout.wheel).not.toBeNull();
      // The brute force samples centres and radii every 2 px, so it may fall
      // short of a narrow optimum; the solver's circle must still be valid.
      const { cx, cy, r } = layout.wheel!;
      expect(r).toBeGreaterThanOrEqual(reference.r - 2.5);
      for (const poly of obstaclesOf(layout, inp)) expect(polyDist({ x: cx, y: cy }, poly)).toBeGreaterThanOrEqual(r + layout.gap - 0.5);
      expect(Math.min(cx, W - cx, cy, H - cy)).toBeGreaterThanOrEqual(r - 0.5);
      expect(Math.hypot(layout.wheel!.cx - reference.cx, layout.wheel!.cy - reference.cy)).toBeLessThanOrEqual(12);
    });
  }

  test("wide windows put the Moon list top left; bottom right only where the wheel gains", () => {
    for (const [W, H] of [[1280, 800], [1600, 1000]] as const) {
      const layout = solve(W, H);
      const inp = input(W, H);
      expect(layout.scale?.kind).toBe("strip");
      expect(layout.moon!.x).toBeCloseTo(inp.inset);
      expect(layout.moon!.y).toBeGreaterThanOrEqual(inp.corners.topLeft!.y + inp.corners.topLeft!.h);
      // The strip keeps the whole right column.
      expect(layout.scale!.rect.y + layout.scale!.rect.h).toBeCloseTo(layout.grid!.bottom);
      expect(layout.moon!.y + layout.moon!.h + layout.gap).toBeLessThanOrEqual(layout.grid!.bottom - layout.grid!.size + 0.01);
    }
    // Near-square: the top-left Moon would cost the wheel, so it sits at the bottom of the right column.
    const square = solve(1008, 860);
    const inset = input(1008, 860).inset;
    expect(square.moon!.x + square.moon!.w).toBeCloseTo(1008 - inset);
    expect(overlaps(square.moon!, square.scale!.rect)).toBe(false);
    expect(square.moon!.y).toBeGreaterThan(square.scale!.rect.y);
  });

  test("wheel envelope clears every module's ink and corner box by the gap", () => {
    for (const horizontal of [false, true]) {
      for (const [W, H] of [[600, 1000], [648, 860], [744, 920], [1008, 860], [1096, 1050], [1280, 800], [1600, 1000]] as const) {
        const inp = input(W, H, { horizontal });
        const layout = solveDashboardLayout(inp);
        const { cx, cy, r } = layout.wheel!;
        // Corner areas, the scale, the Moon list's and the grid staircase's painted ink.
        for (const poly of obstaclesOf(layout, inp)) {
          expect(polyDist({ x: cx, y: cy }, poly)).toBeGreaterThanOrEqual(r + layout.gap - 0.5);
        }
      }
    }
  });

  test("rhythm A: bottoms at the side inset, neighbours one gap apart, ink-true reservations", () => {
    for (const [W, H, horizontal, gridLarge, mirrored] of [
      [664, 900, true, false, false], [1008, 860, true, false, false], [1440, 820, true, false, false], [1008, 860, false, false, false], [1440, 820, false, false, false],
      // Larger grid, forced and mirrored horizontal scale.
      [664, 900, true, true, true], [1008, 860, true, true, true], [1440, 820, true, true, true],
    ] as const) {
      const inp = input(W, H, { horizontal, gridLarge, mirrored });
      const layout = solveDashboardLayout(inp);
      const grid = layout.grid!;
      const scale = layout.scale!.rect;
      expect(grid.bottom).toBeCloseTo(H - inp.inset);
      // The strip shares the right column with a bottom-right Moon list.
      const rightColumn = [scale, ...(layout.moon && layout.moon.x > W / 2 ? [layout.moon] : [])];
      expect(Math.max(...rightColumn.map((box) => box.y + box.h))).toBeCloseTo(H - inp.inset);
      if (layout.scale!.kind !== "strip") {
        expect(scale.x).toBeGreaterThanOrEqual(grid.left + grid.size + layout.gap - 0.01);
        const moonGaps = layout.scale!.kind === "bar" ? 1.5 : 1;
        expect(layout.moon!.y + layout.moon!.h).toBeCloseTo(scale.y - moonGaps * layout.gap);
      }
    }
    // The wheel may reach into the grid's and Moon list's open edges, never their ink.
    const ink = gridInk(0, 0, 200, 20);
    expect(ink[0].y).toBeCloseTo(5);
    expect(ink[3].x).toBeCloseTo(194);
    expect(moonInk({ x: 0, y: 100, w: 200, h: 100 }, 12).y).toBeCloseTo(104.2);
  });

  test("module sizes come from the surface alone, never from the wheel", () => {
    for (const [W, H] of [[537, 896], [600, 1000], [1008, 860], [1096, 1050], [1600, 1000]] as const) {
      for (const horizontal of [false, true]) {
        const layout = solve(W, H, { horizontal });
        expect(layout.cell).toBe(dashboardCell(W, H));
        if (layout.scale?.kind === "strip") {
          expect(layout.glyph).toBeCloseTo(dashboardCell(W, H) * 0.9);
        } else {
          expect(layout.glyph).toBeGreaterThanOrEqual(layout.text * 1.25 - 0.001);
          expect(layout.glyph).toBeLessThanOrEqual(dashboardCell(W, H) * 0.9 + 0.001);
        }
        expect(layout.gap).toBeCloseTo(layout.cell * 0.6);
        expect(layout.text).toBe(dashboardTextSize(W, H));
      }
    }
    expect(solve(537, 896, { horizontal: true, mirrored: true }).glyph).toBeGreaterThanOrEqual(13.75);
    expect(solve(1600, 1000, { horizontal: true }).glyph).toBeCloseTo(23.4);
    expect(solve(1600, 1000).cell).toBe(26);
    expect(solve(1600, 1000).scale?.kind).toBe("strip");
    expect(solve(1600, 1000).glyph).toBeCloseTo(23.4);
  });

  test("solver is cached and fast", () => {
    const inp = input(1100, 900);
    const started = performance.now();
    const first = solveDashboardLayout(inp);
    const cold = performance.now() - started;
    expect(solveDashboardLayout({ ...inp })).toBe(first);
    expect(cold).toBeLessThan(60);
  });

  test("an unobstructed surface keeps the centred wheel", () => {
    const circle = solveWheelCircle(800, 600, [], 10)!;
    expect(circle.cx).toBeCloseTo(400, 1);
    expect(circle.cy).toBeCloseTo(300, 1);
    expect(circle.r).toBeCloseTo(300, 1);
  });
});

test.describe("chart dashboard painters", () => {
  test("declination labels keep order, spacing and the least shift", () => {
    expect(spreadLabels([10, 50, 90], 20, 0, 200)).toEqual([10, 50, 90]);
    const crowded = spreadLabels([100, 101, 102], 20, 0, 400);
    expect(crowded).toEqual([81, 101, 121]);
    // Clamped at the band edge, still spaced.
    expect(spreadLabels([2, 3], 20, 0, 100)).toEqual([0, 20]);
    // Descending targets (strip, north up) stay descending.
    expect(spreadLabels([300, 299], 20, 0, 400)).toEqual([309.5, 289.5]);
  });

  test("crowded bar glyph centres stay inside the ruler at the Moon-text floor", () => {
    const rect = { x: 10, y: 0, w: 120, h: 80 };
    const g = 13.75;
    const bodies = Array.from({ length: 13 }, (_, planet) => ({ id: `planet:${planet}`, planet, glyph: "a" }));
    const dashboard = {
      bodies,
      declination: { obliquity: 23.44, points: bodies.map(({ planet }) => ({ planet, declination: planet * 0.1 })) },
    } as Parameters<typeof declinationGlyphs>[0];
    for (const kind of ["bar", "folded-bar"] as const) {
      for (const glyph of declinationGlyphs(dashboard, kind, rect, g)) {
        expect(glyph.x).toBeGreaterThanOrEqual(rect.x + g / 2 - 0.001);
        expect(glyph.x).toBeLessThanOrEqual(rect.x + rect.w - g / 2 + 0.001);
      }
    }
  });

  test("Moon rows format daemon values and localize every word", () => {
    const keys: string[] = [];
    const rows = moonListRows({
      ctx: {} as CanvasRenderingContext2D,
      color: (value) => value,
      fonts: { ui: "ui", symbols: "sym" },
      t: (key, params) => {
        keys.push(key);
        return params ? `${key}:${JSON.stringify(params)}` : key;
      },
      dashboard: {
        eligible: true,
        enabled: true,
        modules: { aspectGrid: true, declination: true, moon: true },
        gridOrbs: true,
        declinationMirrored: false,
        bodies: [{ id: "planet:1", planet: 1, glyph: "B" }, { id: "planet:4", planet: 4, glyph: "E" }],
        moon: {
          elongation: 271.5,
          increasingInLight: false,
          increasingInLatitude: true,
          swift: true,
          longitudeSpeed: 14.3875,
          latitude: -4.5,
          lunarDay: { day: 23, meanDay: null },
          mansion: { number: 26, arabic: "الفرغ المؤخر", transliteration: "al-Fargh al-Muʾakhkhar" },
          voidOfCourse: { isVoid: false },
          last: null,
          next: { planet: 4, aspectType: 3, glyph: "q", orb: 1.25, applying: true },
        },
      },
    });
    expect(rows.map(([label]) => label)).toEqual([
      "dashboard.moon.phase", "dashboard.moon.speed", "dashboard.moon.latitude", "dashboard.moon.mansion",
      "dashboard.moon.last", "dashboard.moon.next",
    ]);
    expect(rows[0][1][0].text).toBe("271°30′ · dashboard.moon.waning · dashboard.moon.day:{\"day\":23}");
    expect(rows[2][1][0].text).toContain("4°30′ dashboard.declination.south");
    expect(rows[4][1]).toEqual([{ text: "—" }]);
    expect(rows[5][1].map((run) => run.text)).toEqual(["q", "E", "1°15′"]);
    // Mansion as the Inspector shows it: number, then the Arabic-script name in its face.
    expect(rows[3][1]).toEqual([
      { text: "26 " },
      { text: "الفرغ المؤخر", fontFamily: "'AriesArabicAcademic'" },
      { text: "al-Fargh al-Muʾakhkhar", separator: " · ", color: "var(--aries-text-muted)", fit: true },
    ]);
    expect(keys.every((key) => key.startsWith("dashboard."))).toBe(true);
  });
});

test.describe("aspect grid applying / separating letter", () => {
  // Fixed-width fake font: every character is 0.5 × the font size wide.
  const fake = { font: "", measureText: (text: string) => ({ width: text.length * Number.parseFloat(fake.font) * 0.5 }) };
  const ctx = fake as unknown as CanvasRenderingContext2D;
  const t = (key: string) => (key.endsWith("applyingShort") ? "a" : "s");

  test("orb and letter centre as one unit with the decided sizes", () => {
    const m = orbWithPhaseMetrics({ ctx, fonts: { ui: "ui", symbols: "sym" }, t }, { orb: "1.2", applying: true }, 100, 24);
    expect(m.tag).toBe("a");
    expect(m.orbSize).toBe(9);
    expect(m.tagSize).toBe(8);
    const orbWidth = 3 * 9 * 0.5;
    const tagWidth = 8 * 0.5;
    expect(m.tagX).toBe(m.orbX + orbWidth + 1);
    expect(m.orbX + (orbWidth + 1 + tagWidth) / 2).toBeCloseTo(100);
  });

  test("separating cells and larger cells", () => {
    const m = orbWithPhaseMetrics({ ctx, fonts: { ui: "ui", symbols: "sym" }, t }, { orb: "0.4" }, 50, 28);
    expect(m.tag).toBe("s");
    expect(m.orbSize).toBe(Math.round(28 * 0.36));
    expect(m.tagSize).toBe(Math.max(8, Math.round(28 * 0.36 * 0.8)));
  });
});

test.describe("Moon list mansion row follows the Inspector's lunar-mansion setting", () => {
  test("hidden mansion drops the row and one row of reserved height", () => {
    expect(moonListHeight(11, 5)).toBeLessThan(moonListHeight(11, 6));
    expect(moonListHeight(11)).toBe(moonListHeight(11, 6));
    const base = input(600, 1000);
    const six = solveDashboardLayout(base);
    const five = solveDashboardLayout({ ...base, moonRows: 5 });
    expect(five.moon!.h).toBeCloseTo(moonListHeight(six.text, 5));
    expect(five.moon!.y + five.moon!.h).toBeCloseTo(six.moon!.y + six.moon!.h);
  });

  test("rows without a mansion", () => {
    const rows = moonListRows({
      ctx: {} as CanvasRenderingContext2D,
      color: (value) => value,
      fonts: { ui: "ui", symbols: "sym" },
      t: (key) => key,
      dashboard: {
        eligible: true, enabled: true,
        modules: { aspectGrid: true, declination: true, moon: true },
        gridOrbs: true, declinationMirrored: false, bodies: [],
        moon: {
          elongation: 10, increasingInLight: true, increasingInLatitude: true, swift: false,
          longitudeSpeed: 12, latitude: 1, lunarDay: { day: 2, meanDay: null }, mansion: null,
          voidOfCourse: { isVoid: false }, last: null, next: null,
        },
      },
    });
    expect(rows.map(([label]) => label)).not.toContain("dashboard.moon.mansion");
    expect(rows).toHaveLength(5);
    expect(moonListRowCount({ moon: { mansion: null } } as never)).toBe(5);
  });
});


test.describe("Moon text yields only where it would hit a painted object", () => {
  const ctx = (() => {
    const state = { font: "11px ui" };
    return new Proxy({}, {
      get: (_t, key) => key === "font" ? state.font
        : key === "measureText" ? (text: string) => ({ width: [...text].length * Number(/(\d+)px/.exec(state.font)![1]) * 0.5 })
          : () => undefined,
      set: (_t, key, value) => { if (key === "font") state.font = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
  })();
  const p = { ctx, fonts: { ui: "ui", symbols: "sym" } };
  const width = (runs: Array<{ text: string; fontFamily?: string }>, size = 11) =>
    runs.reduce((sum, run) => sum + [...run.text].length * (run.fontFamily ? Math.round(size * 1.15) : size) * 0.5, 0);
  const mansion = (transliteration: string) => [
    { text: "22 " },
    { text: "سعد الذابح", fontFamily: "'AriesArabicAcademic'" },
    { text: transliteration, separator: " · ", color: "muted", fit: true },
  ];

  test("a long transliteration shortens with a full stop and stays inside", () => {
    const runs = fitRunsToWidth(p, mansion("Saʿd al-Dhābiḥ wa-al-Suʿūd"), 11, 150);
    expect(runs[1].text).toBe("سعد الذابح");
    expect(runs[2].text.startsWith(" · Saʿd")).toBe(true);
    expect(runs[2].text.endsWith(".")).toBe(true);
    expect(width(runs)).toBeLessThanOrEqual(150.5);
  });

  test("it drops with its separator when nothing fits, and stays whole when it fits", () => {
    const narrow = fitRunsToWidth(p, mansion("Saʿd al-Dhābiḥ"), 11, 80);
    expect(narrow.map((run) => run.text)).toEqual(["22 ", "سعد الذابح"]);
    const roomy = fitRunsToWidth(p, mansion("Saʿd al-Dhābiḥ"), 11, 400);
    expect(roomy[2].text).toBe(" · Saʿd al-Dhābiḥ");
  });

  test("right limit: the box without knowledge, else the nearest object in the band", () => {
    const box = { x: 100, y: 100, w: 200, h: 100 };
    expect(textRightLimit(undefined, box, 150, 120, 140, 5)).toBe(300);
    const open = { rects: [], discs: [], right: 990 };
    expect(textRightLimit(open, box, 150, 120, 140, 5)).toBe(990);
    const label = { rects: [{ x: 400, y: 125, w: 60, h: 12 }], discs: [], right: 990 };
    expect(textRightLimit(label, box, 150, 120, 140, 5)).toBe(395);
    // A label above or below the row's band is not in the way.
    expect(textRightLimit(label, box, 150, 150, 170, 5)).toBe(990);
    // The wheel rim: the chord edge at the band's nearest height.
    const rim = { rects: [], discs: [{ x: 700, y: 130, r: 200 }], right: 990 };
    expect(textRightLimit(rim, box, 150, 120, 140, 5)).toBe(495);
  });

  test("a long mansion runs into empty space whole and shortens only before a label", () => {
    const drawn: Array<{ text: string; x: number }> = [];
    const state = { font: "11px ui" };
    const paintCtx = new Proxy({}, {
      get: (_t, key) => key === "font" ? state.font
        : key === "measureText" ? (text: string) => ({ width: [...text].length * Number(/(\d+)px/.exec(state.font)![1]) * 0.5 })
          : key === "fillText" ? (text: string, x: number) => drawn.push({ text, x })
            : () => undefined,
      set: (_t, key, value) => { if (key === "font") state.font = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const translit = "Saʿd al-Dhābiḥ wa-al-Suʿūd al-Kubrā";
    const dashboard = {
      eligible: true, enabled: true, modules: { aspectGrid: true, declination: true, moon: true },
      gridOrbs: true, declinationMirrored: false, bodies: [],
      moon: {
        elongation: 59, increasingInLight: true, increasingInLatitude: true, swift: true,
        longitudeSpeed: 14, latitude: 2, lunarDay: { day: 5, meanDay: null },
        mansion: { number: 22, arabic: "سعد الذابح", transliteration: translit },
        voidOfCourse: { isVoid: false }, last: null, next: null,
      },
    } as unknown as Parameters<typeof moonListRows>[0]["dashboard"];
    const box = { x: 16, y: 100, w: 190, h: 120 };
    const lines = { rule: "r", frame: "f", ruleWidth: 1, frameWidth: 2 };
    const base = { ctx: paintCtx, dashboard, color: (v: string) => v, fonts: { ui: "ui", symbols: "sym" }, t: (k: string) => k.split(".").pop()! };
    const mansionText = () => drawn.find((d) => d.text.includes("Saʿd"))!.text;

    paintMoonList({ ...base, obstacles: { rects: [], discs: [], right: 990 } }, box, 11, lines);
    expect(mansionText()).toBe(` · ${translit}`);

    drawn.length = 0;
    // An outer-ring label sits on the mansion row a little past the box.
    const mansionY = box.y + 11 * 1.6 * (1.5 + 3) + 11 * 1.6 / 2;
    const label = { x: 330, y: mansionY - 6, w: 80, h: 12 };
    paintMoonList({ ...base, obstacles: { rects: [label], discs: [], right: 990 } }, box, 11, lines);
    const shortened = drawn.find((d) => d.text.includes("Saʿd"))!;
    expect(shortened.text.endsWith(".")).toBe(true);
    expect(shortened.x + [...shortened.text].length * 5.5).toBeLessThanOrEqual(label.x - 5.5 + 0.5);
    // Other rows are untouched.
    expect(drawn.some((d) => d.text.includes("waxing"))).toBe(true);
  });

  test("a void Moon sets back only its Next value", () => {
    const drawn: Array<{ text: string; alpha: number }> = [];
    const state: Record<string, unknown> = { font: "11px ui", globalAlpha: 1 };
    const paintCtx = new Proxy({}, {
      get: (_t, key) => key in state ? state[key as string]
        : key === "measureText" ? (text: string) => ({ width: [...text].length * 5.5 })
          : key === "fillText" ? (text: string) => drawn.push({ text, alpha: state.globalAlpha as number })
            : () => undefined,
      set: (_t, key, value) => { state[key as string] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const contact = (orb: number) => ({ applying: true, aspectType: 0, glyph: "q", planet: 4, orb });
    const moon = {
      elongation: 59, increasingInLight: true, increasingInLatitude: true, swift: true,
      longitudeSpeed: 14, latitude: 2, lunarDay: { day: 5, meanDay: null }, mansion: null,
      last: contact(4.5), next: contact(21.25),
    };
    const lines = { rule: "r", frame: "f", ruleWidth: 1, frameWidth: 2 };
    const paint = (isVoid: boolean) => {
      drawn.length = 0;
      const dashboard = {
        eligible: true, enabled: true, modules: { aspectGrid: true, declination: true, moon: true },
        gridOrbs: true, declinationMirrored: false, bodies: [],
        moon: { ...moon, voidOfCourse: { isVoid } },
      } as unknown as Parameters<typeof moonListRows>[0]["dashboard"];
      paintMoonList({
        ctx: paintCtx, dashboard, color: (v: string) => v, fonts: { ui: "ui", symbols: "sym" },
        t: (k: string) => k.split(".").pop()!, obstacles: { rects: [], discs: [], right: 990 },
      }, { x: 16, y: 100, w: 190, h: 120 }, 11, lines);
      return (text: string) => drawn.filter((d) => d.text.includes(text)).map((d) => d.alpha);
    };

    let alphaOf = paint(false);
    expect(alphaOf("21°15′")).toEqual([1]);
    alphaOf = paint(true);
    expect(alphaOf("21°15′")).toEqual([VOID_NEXT_ALPHA]);
    expect(alphaOf("4°30′")).toEqual([1]);
    expect(alphaOf("next")).toEqual([1]);
    expect(state.globalAlpha).toBe(1);
  });

  test("obstacles: rim from the sectors, labels, other modules, never the Moon box", () => {
    const layout = solveDashboardLayout(input(1008, 860));
    const regions = [
      { kind: "sign", x: 0, y: 0, r: 300, cx: 500, cy: 430, innerRadius: 250, outerRadius: 300 },
      { kind: "sign", x: 0, y: 0, r: 320, cx: 500, cy: 430, innerRadius: 300, outerRadius: 320 },
      { kind: "secondary_ring", x: 0, y: 0, r: 5, left: 700, top: 100, width: 40, height: 10 },
      { kind: "planet", x: 520, y: 200, r: 8 },
      { kind: "secondary_ring", x: 0, y: 0, r: 5, left: 1, top: 1, width: 1, height: 1, styleOnly: true },
    ] as unknown as Parameters<typeof dashboardTextObstacles>[0];
    const corners = { topLeft: { x: 16, y: 14, w: 120, h: 80 }, topRight: null, bottomLeft: null, bottomRight: null };
    const obstacles = dashboardTextObstacles(regions, layout, corners, { width: 1008, inset: 16 });
    expect(obstacles.discs).toContainEqual({ x: 500, y: 430, r: 320 });
    expect(obstacles.discs).toContainEqual({ x: 520, y: 200, r: 8 });
    expect(obstacles.rects).toContainEqual({ x: 700, y: 100, w: 40, h: 10 });
    expect(obstacles.rects).not.toContainEqual({ x: 1, y: 1, w: 1, h: 1 });
    expect(obstacles.rects).toContainEqual(corners.topLeft);
    expect(obstacles.rects).toContainEqual(layout.scale!.rect);
    expect(obstacles.rects).not.toContain(layout.moon);
    expect(obstacles.right).toBe(992);
  });

  test("obstacles compare by value, so unchanged frames keep the retained layer", () => {
    const layout = solveDashboardLayout(input(1008, 860));
    const regions = [
      { kind: "sign", x: 0, y: 0, r: 320, cx: 500, cy: 430, innerRadius: 300, outerRadius: 320 },
      { kind: "secondary_ring", x: 0, y: 0, r: 5, left: 700, top: 100, width: 40, height: 10 },
    ] as unknown as Parameters<typeof dashboardTextObstacles>[0];
    const corners = { topLeft: { x: 16, y: 14, w: 120, h: 80 }, topRight: null, bottomLeft: null, bottomRight: null };
    const build = () => dashboardTextObstacles(regions, layout, corners, { width: 1008, inset: 16 });
    const a = build();
    const b = build();
    expect(a).not.toBe(b);
    expect(dashboardObstaclesKey(a)).toBe(dashboardObstaclesKey(b));
    const moved = dashboardTextObstacles([regions[0], { ...regions[1], left: 690 }] as typeof regions, layout, corners, { width: 1008, inset: 16 });
    expect(dashboardObstaclesKey(moved)).not.toBe(dashboardObstaclesKey(a));
    expect(dashboardObstaclesKey(undefined)).toBe("-");
  });
});

test.describe("aspect grid declination parallel marks", () => {
  type Call = { op: string; text?: string; x?: number; y?: number; font?: string; style?: string; width?: number; align?: string; baseline?: string };
  function recorder() {
    const calls: Call[] = [];
    const state: Record<string, unknown> = { font: "", fillStyle: "", strokeStyle: "", lineWidth: 1, textAlign: "", textBaseline: "" };
    const ctx = new Proxy({}, {
      get: (_t, key: string) => {
        if (key in state) return state[key];
        if (key === "fillText" || key === "strokeText") {
          return (text: string, x: number, y: number) => calls.push({
            op: key, text, x, y, font: String(state.font),
            style: String(key === "fillText" ? state.fillStyle : state.strokeStyle),
            width: Number(state.lineWidth), align: String(state.textAlign), baseline: String(state.textBaseline),
          });
        }
        if (key === "measureText") return (text: string) => ({ width: text.length * 5 });
        return () => undefined;
      },
      set: (_t, key: string, value) => { state[key] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }

  test("parallel and contraparallel marks sit top-right, heavy, also on cells without a glyph", () => {
    const layout = solveDashboardLayout(input(648, 860, { bodies: 3 }));
    const c = layout.cell;
    const { ctx, calls } = recorder();
    paintDashboard({
      ctx, color: (value) => value, fonts: { ui: "ui", symbols: "sym" }, t: (key) => key,
      dashboard: {
        eligible: true, enabled: true, modules: { aspectGrid: true, declination: false, moon: false },
        gridOrbs: true, declinationMirrored: false,
        bodies: [0, 1, 2].map((planet) => ({ id: `planet:${planet}`, planet, glyph: "a" })),
        grid: { cells: {
          "planet:0:planet:1": { glyph: "q", aspectType: 0, orb: "1.0", parallel: "parallel" },
          "planet:0:planet:2": { orb: "88.0", parallel: "contraparallel" },
          "planet:1:planet:2": { glyph: "r", aspectType: 3, orb: "2.0" },
        } },
      },
    }, { ...layout, scale: null, moon: null });
    const top = layout.grid!.bottom - 3 * c;
    const left = layout.grid!.left;
    const marks = calls.filter((call) => call.text === "X" || call.text === "Y");
    // Row 1, col 0: parallel; row 2, col 0: contraparallel (no aspect glyph).
    expect(marks.filter((call) => call.op === "fillText")).toEqual([
      expect.objectContaining({ text: "X", x: left + c - 2, y: top + c + 2, style: "var(--morinus-aspect-parallel)", align: "right", baseline: "top" }),
      expect.objectContaining({ text: "Y", x: left + c - 2, y: top + 2 * c + 2, style: "var(--morinus-aspect-contraparallel)" }),
    ]);
    expect(marks.filter((call) => call.op === "strokeText").every((call) => call.width === 0.6)).toBe(true);
    expect(marks[0].font).toBe(`${Math.max(8, Math.round(c * 0.42))}px sym`);
    expect(parallelMark("parallel", 100, 50, 24)).toEqual({
      glyph: "X", ink: "var(--morinus-aspect-parallel)", size: 10, x: 98, y: 52,
    });
  });

  test("print appearance inks marks like aspect glyphs", () => {
    const dash = {
      eligible: true, enabled: true, modules: { aspectGrid: true, declination: false, moon: false },
      gridOrbs: true, declinationMirrored: false, bodies: [],
      grid: { cells: { "planet:0:planet:1": { orb: "1.0", parallel: "parallel" as const } } },
    };
    expect(printDashboard(dash, new Map(), false, "#000").grid!.cells["planet:0:planet:1"].parallelColor).toBe("#000");
    expect(printDashboard(dash, new Map(), true, "#000").grid!.cells["planet:0:planet:1"].parallelColor).toBeUndefined();
  });
});

test.describe("wheel-first dashboard", () => {
  test("reservations are a pure function of surface and type metrics", () => {
    const metrics = cornerReservationMetrics(OVERLAYS, { width: 1008, height: 860 });
    const a = reservedDashboardCorners(1008, 860, metrics);
    expect(reservedDashboardCorners(1008, 860, { ...metrics })).toEqual(a);
    expect(Object.keys(a)).toEqual(["topLeft", "topRight"]);
    expect(a.topRight!.h).toBeCloseTo(RESERVED_TOP_RIGHT_ROWS * metrics.lineHeight + metrics.gapAfterDayHour + metrics.gapBetweenGroups);
    expect(a.topLeft!.h).toBeCloseTo(RESERVED_TOP_LEFT_LINES * dashboardTextSize(1008, 860) * OVERLAYS.cornerLineHeight);
  });

  test("reserved rows cover the painted rows and change smoothly with the surface", () => {
    let previous = cornerReservationMetrics(OVERLAYS, { width: 700, height: 700 });
    for (let side = 701; side <= 1400; side++) {
      const metrics = cornerReservationMetrics(OVERLAYS, { width: side, height: side });
      const painted = resolveWheelOverlayMetrics(OVERLAYS, { width: side, height: side });
      expect(metrics.lineHeight).toBeGreaterThanOrEqual(painted.lineHeight);
      expect(metrics.gapAfterDayHour).toBeGreaterThanOrEqual(painted.gapAfterDayHour);
      expect(metrics.gapBetweenGroups).toBeGreaterThanOrEqual(painted.gapBetweenGroups);
      expect(Math.abs(metrics.lineHeight - previous.lineHeight)).toBeLessThan(0.1);
      previous = metrics;
    }
  });
});

test.describe("always horizontal declination scale (A2)", () => {
  const layoutFor = (width: number, height: number, horizontal: boolean, mirrored = false) =>
    solve(width, height, { horizontal, mirrored });

  for (const [W, H] of [[1280, 800], [1600, 1000]] as const) {
    test(`${W}×${H}: bar beside the grid, Moon above it at the lower right, both clear the wheel`, () => {
      const layout = layoutFor(W, H, true);
      const vertical = layoutFor(W, H, false);
      const inset = input(W, H).inset;
      expect(layout.scale!.kind).toBe("bar");
      const bar = layout.scale!.rect;
      expect(bar.y + bar.h).toBeCloseTo(layout.grid!.bottom);
      expect(bar.h).toBeCloseTo(oneSidedBarInkHeight(layout.glyph));
      expect(bar.x).toBeGreaterThanOrEqual(layout.grid!.left + layout.grid!.size + layout.gap - 0.01);
      expect(bar.x + bar.w).toBeCloseTo(W - inset);
      const { r, cx, cy } = layout.wheel!;
      expect(clearance(bar, { cx, cy })).toBeGreaterThanOrEqual(r + layout.gap - 0.5);
      const moon = layout.moon!;
      expect(moon.x + moon.w).toBeCloseTo(W - inset);
      expect(moon.y + moon.h).toBeCloseTo(bar.y - 1.5 * layout.gap);
      expect(clearance(moon, { cx, cy })).toBeGreaterThanOrEqual(r + layout.gap - 0.5);
      // The wheel gives up little or nothing against the vertical strip layout.
      expect(layout.wheel!.r).toBeGreaterThanOrEqual(vertical.wheel!.r - 12);
    });
  }

  test("near-square panes keep at least the minimum bar and a clear wheel", () => {
    for (const [W, H, minRadius] of [[928, 920, 315], [1005, 1095, 380]] as const) {
      const layout = layoutFor(W, H, true);
      const bar = layout.scale!.rect;
      expect(bar.x + bar.w).toBeCloseTo(W - input(W, H).inset);
      expect(bar.w).toBeGreaterThanOrEqual(13 * layout.glyph * 0.9 - 0.5);
      expect(layout.moon!.y + layout.moon!.h).toBeCloseTo(bar.y - 1.5 * layout.gap);
      const { r, cx, cy } = layout.wheel!;
      expect(r).toBeGreaterThanOrEqual(minRadius);
      expect(cx + r).toBeLessThanOrEqual(W);
      expect(clearance(bar, { cx, cy })).toBeGreaterThanOrEqual(r + layout.gap - 0.5);
      expect(clearance(moonInk(layout.moon!, layout.text), { cx, cy })).toBeGreaterThanOrEqual(r + layout.gap - 0.5);
    }
  });

  test("Moon module off: the bar keeps its reserved minimum and clears the wheel", () => {
    for (const mirrored of [false, true]) {
      for (const [W, H] of [[1150, 1090], [1005, 1095], [1280, 800], [1600, 1000]] as const) {
        const layout = solve(W, H, { modules: { aspectGrid: true, declination: true, moon: false }, mirrored, horizontal: true });
        const bar = layout.scale!.rect;
        expect(layout.moon).toBeNull();
        expect(bar.x + bar.w).toBeCloseTo(W - input(W, H).inset);
        expect(bar.w).toBeGreaterThanOrEqual(13 * layout.glyph * 0.9 - 0.5);
        const { r, cx, cy } = layout.wheel!;
        expect(clearance(bar, { cx, cy })).toBeGreaterThanOrEqual(r + layout.gap - 0.5);
      }
    }
  });

  test("mirrored uses the folded bar; tall surfaces keep the bar either way", () => {
    expect(layoutFor(1280, 800, true, true).scale!.kind).toBe("folded-bar");
    expect(layoutFor(600, 1000, true).scale!.kind).toBe("bar");
    expect(layoutFor(600, 1000, false).scale!.kind).toBe("bar");
  });
});

test.describe("modules yield to the painted corner text", () => {
  test("a taller top-right overlay pushes the strip down; the wheel stays put", () => {
    const base = solve(1600, 1000);
    const strip = base.scale!.rect;
    const painted = { x: 1400, y: 30, w: 180, h: 11 * 18 + 14 };
    const fitted = fitModulesToCornerText(base, { topRight: painted });
    expect(fitted.wheel).toEqual(base.wheel);
    const moved = fitted.scale!.rect;
    expect(moved.y).toBeCloseTo(painted.y + painted.h + base.gap);
    expect(moved.y + moved.h).toBeCloseTo(strip.y + strip.h);
    expect(moved.x).toBe(strip.x);
    // The same painted box returns the same object (retained paint skips it).
    expect(fitModulesToCornerText(base, { topRight: { ...painted } })).toBe(fitted);
    // A short overlay changes nothing.
    expect(fitModulesToCornerText(base, { topRight: { x: 1400, y: 30, w: 100, h: 20 } })).toBe(base);
  });

  test("a squeezed strip drops out; bars ignore the top-right text", () => {
    const base = solve(1600, 1000);
    expect(fitModulesToCornerText(base, { topRight: { x: 1400, y: 14, w: 180, h: 1000 } }).scale).toBeNull();
    const tall = solve(600, 1000);
    expect(fitModulesToCornerText(tall, { topRight: { x: 400, y: 14, w: 130, h: 400 } })).toBe(tall);
    const a2 = solve(1280, 800, { horizontal: true });
    expect(fitModulesToCornerText(a2, { topRight: { x: 1100, y: 14, w: 160, h: 260 } })).toBe(a2);
  });

  test("a top-left Moon list moves below taller chart-data text while it stays clear", () => {
    const base = solve(1600, 1000);
    const moon = base.moon!;
    const painted = { x: moon.x, y: 30, w: 200, h: moon.y - 30 + 20 };
    const fitted = fitModulesToCornerText(base, { topLeft: painted });
    expect(fitted.moon!.y).toBeCloseTo(painted.y + painted.h + base.gap);
    expect(fitted.wheel).toEqual(base.wheel);
    // Text reaching the grid: the Moon list keeps its place.
    const blocked = fitModulesToCornerText(base, { topLeft: { ...painted, h: 800 } });
    expect(blocked.moon).toBe(base.moon);
  });
});

test.describe("modules share the margins and the grid's bottom line", () => {
  // Every edge is checked on what the painters draw, through a canvas with
  // known type metrics: digits rise 0.7 em; symbol glyphs reach 0.42 em above
  // and 0.38 em below their middle line.
  const dash = {
    eligible: true, enabled: true, modules: { aspectGrid: true, declination: true, moon: true },
    gridOrbs: true, declinationMirrored: false,
    bodies: [0, 1, 2, 3].map((planet) => ({ id: `planet:${planet}`, planet, glyph: "a" })),
    declination: { obliquity: 23.44, points: [
      { planet: 0, declination: 12 }, { planet: 1, declination: -18 }, { planet: 2, declination: -3 }, { planet: 3, declination: 25 },
    ] },
    moon: {
      elongation: 59, increasingInLight: true, increasingInLatitude: true, swift: true, longitudeSpeed: 14, latitude: 2,
      lunarDay: { day: 5, meanDay: null }, mansion: null, voidOfCourse: { isVoid: false }, last: null, next: null,
    },
  } as unknown as Parameters<typeof paintDashboard>[0]["dashboard"];
  type Call = { text: string; x: number; y: number; align: string; baseline: string; size: number; symbols: boolean };

  function painted(layout: DashboardLayout) {
    const calls: Call[] = [];
    const state: Record<string, unknown> = { font: "10px ui", textBaseline: "alphabetic", textAlign: "start" };
    const size = () => Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))![1]);
    const ctx = new Proxy({}, {
      get: (_t, key: string) => key in state ? state[key]
        : key === "fillText" ? (text: string, x: number, y: number) => calls.push({
          text, x, y, align: String(state.textAlign), baseline: String(state.textBaseline), size: size(), symbols: String(state.font).includes("sym"),
        })
          : key === "measureText" ? (text: string) => {
            const em = size();
            const symbols = String(state.font).includes("sym");
            return {
              width: [...text].length * em * 0.55,
              actualBoundingBoxAscent: symbols ? em * 0.42 : em * 0.7,
              actualBoundingBoxDescent: symbols ? em * 0.38 : 0,
            };
          }
            : key === "save" || key === "restore" ? () => undefined
              : () => undefined,
      set: (_t, key: string, value) => { state[key] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    paintDashboard({ ctx, dashboard: dash, color: (v) => v, fonts: { ui: "ui", symbols: "sym" }, t: (k) => k.split(".").pop()!.slice(0, 1).toUpperCase() },
      { ...layout, grid: null });
    return calls;
  }
  const degreeLabels = (calls: Call[]) => calls.filter((call) => /°/.test(call.text));

  for (const [label, W, H, horizontal] of [["smallest pane", 537, 896, true], ["tall pane", 600, 1000, false], ["always horizontal", 1280, 800, true]] as const) {
    test(`${label}: the default bar stands on the grid's line, its end labels flush with its ends`, () => {
      const layout = solve(W, H, { horizontal });
      const { rect, kind } = layout.scale!;
      expect(kind).toBe("bar");
      const bottom = layout.grid!.bottom;
      expect(rect.y + rect.h).toBeCloseTo(bottom);
      expect(rect.x + rect.w).toBeCloseTo(W - input(W, H).inset);
      const labels = degreeLabels(painted({ ...layout, moon: null }));
      for (const call of labels) {
        expect(call.baseline).toBe("alphabetic");
        expect(call.y).toBeCloseTo(bottom);
      }
      const first = labels.reduce((a, b) => (b.x < a.x ? b : a));
      const last = labels.reduce((a, b) => (b.x > a.x ? b : a));
      expect(first).toMatchObject({ align: "left", x: rect.x });
      expect(last).toMatchObject({ align: "right" });
      expect(last.x).toBeCloseTo(rect.x + rect.w);
    });

    test(`${label}: the mirrored bar is symmetric and its south glyphs reach the grid bottom`, () => {
      const layout = solve(W, H, { horizontal, mirrored: true });
      const { rect, kind } = layout.scale!;
      expect(kind).toBe("folded-bar");
      const geometry = barGeometry("folded-bar", rect, layout.glyph, estimateScaleMetrics(layout.glyph));
      expect(geometry.axisY - geometry.northY).toBeCloseTo(geometry.southY - geometry.axisY);
      expect(rect.y + rect.h).toBeCloseTo(layout.grid!.bottom);
      const calls = painted({ ...layout, moon: null });
      const glyphs = calls.filter((call) => call.symbols);
      expect(Math.min(...glyphs.map((call) => call.y - layout.glyph * 0.42))).toBeGreaterThanOrEqual(rect.y);
      expect(Math.abs(Math.max(...glyphs.map((call) => call.y)) - geometry.southY)).toBeLessThan(layout.glyph * 0.05);
      expect(Math.max(...glyphs.map((call) => call.y)) + layout.glyph * 0.38).toBeCloseTo(layout.grid!.bottom);
      const words = calls.filter((call) => call.text === "N" || call.text === "S");
      expect(words).toHaveLength(2);
      for (const word of words) expect(word).toMatchObject({ align: "left", x: rect.x });
      const ends = degreeLabels(calls);
      const last = ends.reduce((a, b) => (b.x > a.x ? b : a));
      expect(last.align).toBe("right");
      expect(last.x).toBeCloseTo(rect.x + rect.w);
    });
  }

  test("the strip's labels end on the right margin and its range stays inside its ends", () => {
    const layout = solve(1600, 1000);
    const { rect, kind } = layout.scale!;
    expect(kind).toBe("strip");
    expect(rect.x + rect.w).toBeCloseTo(1600 - input(1600, 1000).inset);
    expect(rect.y + rect.h).toBeCloseTo(layout.grid!.bottom);
    const labels = degreeLabels(painted({ ...layout, moon: null }));
    for (const call of labels) expect(call).toMatchObject({ align: "right", baseline: "alphabetic" });
    for (const call of labels) expect(call.x).toBeCloseTo(rect.x + rect.w);
    const top = Math.min(...labels.map((call) => call.y));
    const bottom = Math.max(...labels.map((call) => call.y));
    expect(top - labels[0].size * 0.7).toBeCloseTo(rect.y);
    expect(bottom).toBeCloseTo(rect.y + rect.h);
  });

  test("a Moon list in the right column stands on the grid's line at the right margin", () => {
    const layout = solve(1008, 860);
    const moon = layout.moon!;
    expect(moon.x).toBeGreaterThan(layout.wheel!.cx);
    expect(moon.x + moon.w).toBeCloseTo(1008 - input(1008, 860).inset);
    expect(moon.y + moon.h).toBeCloseTo(layout.grid!.bottom);
    const calls = painted({ ...layout, scale: null });
    // Row labels and the heading start on the list's left edge.
    const rows = calls.filter((call) => call.x === moon.x);
    const lastBaseline = Math.max(...rows.map((call) => call.y));
    expect(lastBaseline).toBeCloseTo(moon.y + moon.h);
    expect(rows.every((call) => call.baseline === "alphabetic")).toBe(true);
  });
});

test.describe("outer labels shorten against modules, corner reservations and the surface edges", () => {
  for (const [W, H] of [[664, 900], [1008, 860], [1440, 820]] as const) {
    test(`${W}×${H}: one abbreviate list for screen and export`, () => {
      const inp = input(W, H, { horizontal: true });
      const layout = solveDashboardLayout(inp);
      const bounds = dashboardOuterLabelBounds(layout, { width: W, height: H }, OVERLAYS);
      expect(bounds.every((box) => box.fit === "abbreviate")).toBe(true);
      const has = (box: DashRect | null) => Boolean(box) && bounds.some((b) => b.x === box!.x && b.y === box!.y && b.w === box!.w && b.h === box!.h);
      // The same stable corner areas the solver reserves (never measured text).
      expect(has(inp.corners.topLeft)).toBe(true);
      expect(has(inp.corners.topRight)).toBe(true);
      for (const box of dashboardModuleBoxes(layout)) expect(has(box)).toBe(true);
      // Four strips just outside the surface, touching each edge.
      const outside = bounds.filter((b) => b.x + b.w <= 0 || b.x >= W || b.y + b.h <= 0 || b.y >= H);
      expect(outside).toHaveLength(4);
      expect(outside.some((b) => b.y + b.h === 0)).toBe(true);
      expect(outside.some((b) => b.y === H)).toBe(true);
      expect(outside.some((b) => b.x + b.w === 0)).toBe(true);
      expect(outside.some((b) => b.x === W)).toBe(true);
    });
  }
});

test("painted corner text past its reservation (more event rows) joins the outer-label boxes", () => {
  const [W, H] = [1174, 1792];
  const inp = input(W, H, { horizontal: true });
  const layout = solveDashboardLayout(inp);
  const surface = { width: W, height: H };
  const reserved = inp.corners.topRight!;
  const base = dashboardOuterLabelBounds(layout, surface, OVERLAYS);
  // Inside its reservation: nothing new.
  const inside = { ...reserved, y: reserved.y + 2, h: reserved.h - 4 };
  expect(dashboardOuterLabelBounds(layout, surface, OVERLAYS, { topRight: inside })).toHaveLength(base.length);
  // Nine rows instead of six: the painted block is a further box.
  const tall = { ...reserved, h: reserved.h * 1.5 };
  const bounds = dashboardOuterLabelBounds(layout, surface, OVERLAYS, { topRight: tall, topLeft: null });
  expect(bounds).toHaveLength(base.length + 1);
  expect(bounds.some((b) => b.y <= tall.y && b.y + b.h >= tall.y + tall.h && b.h < tall.h + 2 && b.fit === "abbreviate")).toBe(true);
});

test("plain wheel: outer labels shorten against every painted corner block and the surface edges", () => {
  const surface = { width: 1344, height: 1200 };
  const painted = {
    topLeft: { x: 48.4, y: 66.2, w: 170.3, h: 132.5 },
    topRight: { x: 1125.6, y: 66, w: 170, h: 124.7 },
    bottomLeft: { x: 48, y: 1092, w: 228, h: 60 },
    bottomRight: { x: 1150, y: 1124, w: 146, h: 30 },
  };
  const bounds = cornerOuterLabelBounds(painted, surface);
  expect(bounds).toHaveLength(8);
  expect(bounds.every((box) => box.fit === "abbreviate")).toBe(true);
  // Whole pixels, covering the painted text.
  expect(bounds[0]).toEqual({ x: 48, y: 66, w: 171, h: 133, fit: "abbreviate" });
  expect(bounds[1]).toEqual({ x: 1125, y: 66, w: 171, h: 125, fit: "abbreviate" });
  const outside = bounds.filter((b) => b.x + b.w <= 0 || b.x >= surface.width || b.y + b.h <= 0 || b.y >= surface.height);
  expect(outside).toHaveLength(4);
  // Missing corners add nothing; the edges stay.
  expect(cornerOuterLabelBounds({ topLeft: null, topRight: painted.topRight }, surface)).toHaveLength(5);
  expect(cornerOuterLabelBounds(null, surface)).toHaveLength(4);
});
