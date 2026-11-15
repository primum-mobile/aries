// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { aspectGridLines, deviceLineWidth, paintDeclinationBar, paintDeclinationStrip, paintFoldedDeclinationBar, snapLine } from "../src/lib/chart/dashboard-paint";
import type { ChartDashboard } from "../src/lib/chart/types";

const unitEdges = (x1: number, y1: number, x2: number, y2: number) => {
  const edges: string[] = [];
  if (y1 === y2) for (let x = Math.min(x1, x2); x < Math.max(x1, x2); x += 1) edges.push(`h${x},${y1}`);
  else for (let y = Math.min(y1, y2); y < Math.max(y1, y2); y += 1) edges.push(`v${x1},${y}`);
  return edges;
};

test("aspect grid strokes every cell edge exactly once", () => {
  for (const n of [2, 3, 12, 14]) {
    const { rules, outline } = aspectGridLines(n);
    const stroked = rules.flatMap((s) => unitEdges(s.x1, s.y1, s.x2, s.y2));
    outline.forEach((point, i) => {
      const next = outline[(i + 1) % outline.length];
      stroked.push(...unitEdges(point.x, point.y, next.x, next.y));
    });
    // Expected: the four sides of every lower-triangle cell (col < row).
    const expected = new Set<string>();
    for (let row = 1; row < n; row += 1) {
      for (let col = 0; col < row; col += 1) {
        expected.add(`h${col},${row}`).add(`h${col},${row + 1}`).add(`v${col},${row}`).add(`v${col + 1},${row}`);
      }
    }
    expect(new Set(stroked).size).toBe(stroked.length);
    expect(new Set(stroked)).toEqual(expected);
  }
});

test("grid lines sit on device pixels at any cell size and DPR", () => {
  for (const scale of [1, 2, 3]) {
    for (const offset of [0, 0.3]) {
      const axis = { scale, offset };
      for (const width of [1, 2]) {
        const w = deviceLineWidth(width, scale) * scale;
        expect(Number.isInteger(w)).toBe(true);
        const widths = new Set<number>();
        for (let k = 0; k <= 14; k += 1) {
          const centre = snapLine(13.37 + k * 23.71, width, axis) * scale + offset;
          const start = centre - w / 2;
          expect(Math.abs(start - Math.round(start))).toBeLessThan(1e-9);
          widths.add(w);
        }
        expect(widths.size).toBe(1);
      }
    }
  }
});

/** Records strokes (device-space line edges) and fillText calls under a DPR transform. */
function scaleRecorder(dpr: number) {
  const strokes: Array<{ x1: number; y1: number; x2: number; y2: number; width: number }> = [];
  const texts: string[] = [];
  let path: Array<[number, number]> = [];
  const state: Record<string, unknown> = { font: "", fillStyle: "", strokeStyle: "", lineWidth: 1, textAlign: "", textBaseline: "" };
  const ctx = new Proxy({}, {
    get: (_t, key: string) => {
      if (key in state) return state[key];
      if (key === "getTransform") return () => ({ a: dpr, d: dpr, e: 0, f: 0 });
      if (key === "measureText") return (text: string) => ({ width: text.length * 5, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 3 });
      if (key === "beginPath") return () => { path = []; };
      if (key === "moveTo" || key === "lineTo") return (x: number, y: number) => path.push([x, y]);
      if (key === "stroke") return () => {
        for (let i = 1; i < path.length; i++) {
          strokes.push({ x1: path[i - 1][0], y1: path[i - 1][1], x2: path[i][0], y2: path[i][1], width: Number(state.lineWidth) });
        }
      };
      if (key === "fillText") return (text: string) => texts.push(text);
      return () => undefined;
    },
    set: (_t, key: string, value) => { state[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, strokes, texts };
}

const scaleDashboard = {
  eligible: true, enabled: true, modules: { aspectGrid: true, declination: true, moon: true },
  gridOrbs: true, declinationMirrored: false,
  bodies: [{ planet: 0, glyph: "A" }, { planet: 4, glyph: "E", motion: "R" }],
  declination: { obliquity: 23.44, points: [{ planet: 0, declination: -12.3 }, { planet: 4, declination: 17.8 }], contacts: {} },
} as unknown as ChartDashboard;

test("declination scale axes and ticks sit on device pixels at fractional DPR", () => {
  const lines = { rule: "r", frame: "f", ruleWidth: 1, frameWidth: 2 };
  for (const dpr of [1, 1.5, 2]) {
    const onPixels = (v: number, width: number) => {
      const start = v * dpr - (width * dpr) / 2;
      return Math.abs(start - Math.round(start)) < 1e-6;
    };
    const p = (ctx: CanvasRenderingContext2D) => ({ ctx, dashboard: scaleDashboard, color: (v: string) => v, fonts: { ui: "ui", symbols: "sym" }, t: (k: string) => k.slice(-1) });
    const bar = scaleRecorder(dpr);
    paintDeclinationBar(p(bar.ctx), { x: 300.37, y: 600.21, w: 311.3, h: 80.4 }, 18.7, lines);
    const strip = scaleRecorder(dpr);
    paintDeclinationStrip(p(strip.ctx), { x: 900.41, y: 100.13, w: 74.9, h: 503.7 }, 18.7, lines);
    for (const { strokes } of [bar, strip]) {
      // Straight strokes (axis, ticks, ε marks, leader feet) only; slanted leaders are free.
      const straight = strokes.filter((s) => s.x1 === s.x2 || s.y1 === s.y2);
      expect(straight.length).toBeGreaterThan(60);
      for (const s of straight) {
        expect(Number.isInteger(s.width * dpr)).toBe(true);
        if (s.x1 === s.x2) expect(onPixels(s.x1, s.width)).toBe(true);
        else expect(onPixels(s.y1, s.width)).toBe(true);
      }
    }
  }
});

test("horizontal bars carry the motion marker like the strip and the wheel", () => {
  const lines = { rule: "r", frame: "f", ruleWidth: 1, frameWidth: 2 };
  for (const paint of [paintDeclinationBar, paintFoldedDeclinationBar, paintDeclinationStrip]) {
    const { ctx, texts } = scaleRecorder(2);
    const p = { ctx, dashboard: scaleDashboard, color: (v: string) => v, fonts: { ui: "ui", symbols: "sym" }, t: (k: string) => k.slice(-1) };
    paint(p, { x: 300, y: 300, w: 311, h: 300 }, 18, lines);
    expect(texts.filter((text) => text === "R")).toHaveLength(1);
  }
});
