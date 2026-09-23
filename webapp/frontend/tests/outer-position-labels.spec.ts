// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { drawSnapshotLayer, computeHitRegions, resolveChartOuterPaintEnvelope, resolveChartOuterPaintEnvelopeScale, type ChartHitRegion } from "../src/lib/chart/draw-chart";
import { DEFAULT_WHEEL_RENDER_STYLE } from "../src/lib/chart/wheel-render-style";
import type { CanvasDraw, TextOpts } from "../src/lib/chart/canvas-draw";
import type { Chart, ChartRenderSnapshot } from "../src/lib/chart/types";

const measure = (text: string, opts: TextOpts = {}): [number, number] =>
  [text.length * (opts.size ?? 12) * 0.55, opts.size ?? 12];
const drawOptions = { width: 800, height: 800, chartSize: 800, renderStyle: DEFAULT_WHEEL_RENDER_STYLE };
function fixture(theme: number, on: boolean): ChartRenderSnapshot {
  const chart = (outer: boolean) => ({
    planets: outer ? [
      { id: "sun", seId: 0, glyph: "a", longitude: 42.575, degText: "12", minText: "34" },
      { id: "moon", seId: 1, glyph: "b", longitude: 43.75, degText: "13", minText: "45", motion: "R" },
    ] : [{ id: "mars", seId: 4, glyph: "e", longitude: 140, degText: "20", minText: "00" }],
    angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
    houses: { cusps: Array.from({ length: 12 }, (_, i) => i * 30) },
    aspects: [], meta: {},
    options: { theme, signVariant: 0, showHouses: false, showOuterHouseLines: false,
      showPositions: false, showOuterPositions: on, showAspects: false, showSymbols: false,
      showTerms: false, showDecans: false, showCusplessAscMcLabels: false },
  }) as unknown as Chart;
  return { primaryChart: chart(false), comparisonChart: chart(true),
    displayDatetime: "2026-09-15T12:00:00", renderVariant: "round-classic",
    overlayRenderMode: "full", outerRingMode: "none" } as ChartRenderSnapshot;
}
function render(snapshot: ChartRenderSnapshot) {
  const scale = resolveChartOuterPaintEnvelopeScale(snapshot, DEFAULT_WHEEL_RENDER_STYLE);
  const options = { ...drawOptions, chartSize: drawOptions.chartSize / scale };
  const texts: { x: number; y: number; text: string; opts: TextOpts }[] = [];
  const geometry: unknown[] = [];
  const record = ([x, y]: number[], text: string, opts: TextOpts) => texts.push({ x, y, text, opts });
  const ctx = new Proxy({}, { get: () => () => undefined });
  const draw = new Proxy({ ctx, text: record, textAtInkTop: record, textsize: measure,
    textbounds: (text: string, opts: TextOpts) => {
      const [w, h] = measure(text, opts);
      return { x: 0, y: 0, w, h };
    },
    measure: (_name: string, run: () => unknown) => run(),
  }, { get: (obj, key) => key in obj ? obj[key as keyof typeof obj] : (...args: unknown[]) => geometry.push([key, ...args]) }) as unknown as CanvasDraw;
  for (const layer of ["geometry", "dynamic", "outer-label"] as const) drawSnapshotLayer(draw, snapshot, layer, options);
  const regions = computeHitRegions(snapshot, { ...options, textsize: measure, includeStyleTargets: true });
  return { texts, geometry, regions, scale };
}
function contains(region: ChartHitRegion, x: number, y: number) {
  const box = region as unknown as { left: number; top: number; width: number; height: number };
  return x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;
}

type Box = { x: number; y: number; w: number; h: number };
function segmentCrossesBox(a: number[], b: number[], box: Box) {
  let enter = 0, leave = 1;
  for (const [start, delta, lo, hi] of [
    [a[0], b[0] - a[0], box.x, box.x + box.w],
    [a[1], b[1] - a[1], box.y, box.y + box.h],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (start < lo || start > hi) return false;
    } else {
      enter = Math.max(enter, Math.min((lo - start) / delta, (hi - start) / delta));
      leave = Math.min(leave, Math.max((lo - start) / delta, (hi - start) / delta));
    }
  }
  return enter <= leave;
}

for (const theme of [0, 1, 2, 3, 4]) {
  test(`outer readouts keep their values, geometry, and hit ownership in recipe ${theme}`, () => {
    const off = render(fixture(theme, false));
    const on = render(fixture(theme, true));
    const labels = on.texts.filter(t => ["12°34′", "13°45′"].includes(t.text));
    expect(labels).toHaveLength(2);
    expect(off.texts.some(t => t.text === "12°34′")).toBe(false);
    // Numbers are the only paint allowed to change: the existing viewport fit,
    // glyphs, motion markers, circles and leaders are bit-identical.
    expect(on.scale).toBe(off.scale);
    expect(on.geometry).toEqual(off.geometry);
    expect(on.texts.filter(t => !labels.includes(t))).toEqual(off.texts);
    for (const label of labels) {
      expect(label.opts.size).toBeGreaterThanOrEqual(8);
      expect(label.opts.size).toBeLessThanOrEqual(12.5);
      const [w, h] = measure(label.text, label.opts);
      expect(on.regions.some(r => r.kind === "planet" && r.chartRole === "outer" && contains(r, label.x + w / 2, label.y + h / 2))).toBe(true);
      expect(on.regions.some(r => r.kind === "style_target" && r.classId === "bodies.outer.position"
        && Math.abs(r.x - (label.x + w / 2)) < 1 && Math.abs(r.y - (label.y + h / 2)) < 1)).toBe(true);
    }
    const boxes = labels.map(t => ({ ...t, w: measure(t.text, t.opts)[0], h: measure(t.text, t.opts)[1] }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
      }
    }
  });

  test(`outer readouts clear the rim, leaders, and canvas edges around recipe ${theme}`, () => {
    for (let longitude = 0; longitude < 360; longitude += 5) {
      const snapshot = fixture(theme, true);
      snapshot.primaryChart.options.showHouses = true;
      snapshot.primaryChart.options.showOuterHouseLines = true;
      snapshot.comparisonChart!.options.showHouses = true;
      snapshot.comparisonChart!.options.showOuterHouseLines = true;
      snapshot.comparisonChart!.planets = [{
        id: "sun", seId: 0, glyph: "a", longitude, degText: "12", minText: "34",
        motion: longitude % 30 === 0 ? "R" : undefined,
      }] as Chart["planets"];
      const result = render(snapshot);
      const labels = result.texts.filter(t => t.text === "12°" || t.text === "12°34′");
      expect(labels).toHaveLength(1);
      for (const label of labels) {
        const [w, h] = measure(label.text, label.opts);
        const box = { x: label.x, y: label.y, w, h };
        const context = `recipe ${theme}, longitude ${longitude}, ${label.text}`;
        expect(box.x, context).toBeGreaterThanOrEqual(0);
        expect(box.y, context).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w, context).toBeLessThanOrEqual(drawOptions.width);
        expect(box.y + box.h, context).toBeLessThanOrEqual(drawOptions.height);
        const crossings: string[] = [];
        for (const other of result.texts) {
          if (other === label) continue;
          const [ow, oh] = measure(other.text, other.opts);
          if (box.x < other.x + ow && other.x < box.x + w && box.y < other.y + oh && other.y < box.y + h) {
            crossings.push(`text ${other.text}`);
          }
        }
        for (const raw of result.geometry) {
          const command = raw as unknown[];
          if (command[0] === "circle") {
            const [, [cx, cy], radius] = command as [string, [number, number], number];
            const near = Math.hypot(Math.max(box.x - cx, 0, cx - box.x - w), Math.max(box.y - cy, 0, cy - box.y - h));
            const far = Math.max(...[[box.x, box.y], [box.x + w, box.y], [box.x, box.y + h], [box.x + w, box.y + h]]
              .map(([x, y]) => Math.hypot(x - cx, y - cy)));
            if (radius >= near && radius <= far) crossings.push(`circle ${radius}`);
          } else if (command[0] === "line") {
            const points = command[1] as number[][];
            for (let i = 1; i < points.length; i++) {
              if (segmentCrossesBox(points[i - 1], points[i], box)) crossings.push(`line ${JSON.stringify(points)}`);
            }
          }
        }
        expect(crossings, context).toEqual([]);
      }
    }
  });
}

test("secondary glyphs and named points receive positions without duplicating fixed-star labels", () => {
  const snapshot = fixture(0, true);
  snapshot.comparisonChart = undefined;
  snapshot.outerRingMode = "antiscia";
  snapshot.outerRingItems = { antiscia: [
    { id: "projected", family: "antiscia", longitude: 42.575, label: "Sun", degText: "12", minText: "34", segments: [{ kind: "planet", text: "a", seId: 0 }] },
    { id: "lot", family: "arabic_part", longitude: 90, label: "Spirit", degText: "0", minText: "00" },
    { id: "star", family: "fixstar", longitude: 250, label: "Star 0°00′", degText: "0", minText: "00", positionInLabel: true },
  ] };
  const result = render(snapshot);
  expect(result.texts.filter(t => t.text === "12°34′")).toHaveLength(1);
  expect(result.texts.filter(t => t.text === " 0°00′")).toHaveLength(1);
  expect(result.texts.filter(t => t.text === "Star 0°00′")).toHaveLength(1);
  const label = result.texts.find(t => t.text === "12°34′")!;
  const [w, h] = measure(label.text, label.opts);
  expect(result.regions.some(r => r.kind === "secondary_ring" && r.itemId === "projected"
    && contains(r, label.x + w / 2, label.y + h / 2))).toBe(true);
});

test("dense outer groups preserve full values and deterministic placement after H and stepping", () => {
  for (const theme of [0, 1, 2, 3, 4]) {
    for (const longitude of [0, 43, 89, 179, 269, 357]) {
      const snapshot = fixture(theme, true);
      snapshot.comparisonChart!.planets = ["sun", "moon", "mercury", "venus", "mars"].map((id, i) => ({
        id, seId: i, glyph: "ABCDE"[i], longitude: (longitude + i * 0.7) % 360,
        degText: String(10 + i), minText: "59", motion: i % 2 ? "SR" : "R",
      })) as Chart["planets"];
      const labels = (result: ReturnType<typeof render>) => result.texts
        .filter(t => /^1[0-4]°59′$/.test(t.text));
      const original = render(snapshot);
      const numbersOff = structuredClone(snapshot);
      numbersOff.primaryChart.options.showOuterPositions = false;
      numbersOff.comparisonChart!.options.showOuterPositions = false;
      const withoutNumbers = render(numbersOff);
      expect(original.scale).toBe(withoutNumbers.scale);
      expect(original.geometry).toEqual(withoutNumbers.geometry);
      expect(original.texts.filter(t => !/^1[0-4]°59′$/.test(t.text))).toEqual(withoutNumbers.texts);
      expect(labels(original)).toHaveLength(5);
      const all = labels(original).map(t => ({ ...t, w: measure(t.text, t.opts)[0], h: measure(t.text, t.opts)[1] }));
      all.forEach((a, i) => {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x + a.w).toBeLessThanOrEqual(800);
        for (const b of all.slice(i + 1)) {
          expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
            `recipe ${theme}, cluster ${longitude}: ${JSON.stringify(all)}`).toBe(true);
        }
      });
      snapshot.primaryChart.options.showHouses = true;
      render(snapshot);
      snapshot.primaryChart.options.showHouses = false;
      render(fixture(theme, true));
      expect(labels(render(snapshot))).toEqual(labels(original));
    }
  }
});

test("outer label viewport reservation stays constant as values and positions change", () => {
  for (const theme of [0, 1, 2, 3, 4]) {
    const snapshot = fixture(theme, true);
    const scale = resolveChartOuterPaintEnvelopeScale(snapshot, DEFAULT_WHEEL_RENDER_STYLE);
    expect(scale).toBeGreaterThanOrEqual(1);
    snapshot.comparisonChart!.planets[0] = {
      ...snapshot.comparisonChart!.planets[0], longitude: 359.999, degText: "29", minText: "59",
    };
    expect(resolveChartOuterPaintEnvelopeScale(snapshot, DEFAULT_WHEEL_RENDER_STYLE)).toBe(scale);
  }
});

test("projected outer glyphs keep complete inline positions inside the canvas", () => {
  for (const theme of [0, 1, 2, 3, 4]) {
    for (const mode of ["antiscia", "contra_antiscia", "dodecatemoria", "parallel_transits"] as const) {
      const snapshot = fixture(theme, true);
      snapshot.comparisonChart = undefined;
      snapshot.outerRingMode = mode;
      snapshot.outerRingItems = { [mode]: [0, 89, 179, 269, 357].map((longitude, i) => ({
        id: `point-${i}`, family: mode, longitude, label: "Body",
        degText: String(10 + i), minText: "59",
        segments: [{ kind: "planet", text: "ABCDE"[i], seId: i }],
      })) };
      const result = render(snapshot);
      const off = structuredClone(snapshot);
      off.primaryChart.options.showOuterPositions = false;
      const before = render(off);
      expect(resolveChartOuterPaintEnvelope(snapshot, DEFAULT_WHEEL_RENDER_STYLE))
        .toEqual(resolveChartOuterPaintEnvelope(off, DEFAULT_WHEEL_RENDER_STYLE));
      expect(result.geometry).toEqual(before.geometry);
      expect(result.texts.filter(t => !/^1[0-4]°59′$/.test(t.text))).toEqual(before.texts);
      const labels = result.texts.filter(t => /^1[0-4]°59′$/.test(t.text));
      expect(labels).toHaveLength(5);
      labels.forEach(label => {
        const [w, h] = measure(label.text, label.opts);
        expect(label.x).toBeGreaterThanOrEqual(0);
        expect(label.y).toBeGreaterThanOrEqual(0);
        expect(label.x + w).toBeLessThanOrEqual(800);
        expect(label.y + h).toBeLessThanOrEqual(800);
        expect(result.regions.some(r => r.kind === "secondary_ring"
          && contains(r, label.x + w / 2, label.y + h / 2))).toBe(true);
      });
    }
  }
});


test("dense secondary numbers do not repack their glyphs or ticks", () => {
  for (const theme of [0, 1, 2, 3, 4]) {
    for (const mode of ["antiscia", "contra_antiscia", "dodecatemoria", "parallel_transits"] as const) {
      for (const start of [0, 90, 180, 270]) {
        const snapshot = fixture(theme, true);
        snapshot.comparisonChart = undefined;
        snapshot.outerRingMode = mode;
        snapshot.outerRingItems = { [mode]: Array.from({ length: 5 }, (_, i) => ({
          id: `cluster-${i}`, family: mode, longitude: start + i * 0.7, label: "Body",
          degText: String(10 + i), minText: "59", motion: i % 2 ? "SR" : "R",
          segments: [{ kind: "planet", text: "ABCDE"[i], seId: i }],
        })) };
        const on = render(snapshot);
        const offSnapshot = structuredClone(snapshot);
        offSnapshot.primaryChart.options.showOuterPositions = false;
        const off = render(offSnapshot);
        expect(on.scale).toBe(off.scale);
        expect(on.geometry).toEqual(off.geometry);
        expect(on.texts.filter(t => !/^1[0-4]°59′$/.test(t.text))).toEqual(off.texts);
        const numbers = on.texts.filter(t => /^1[0-4]°59′$/.test(t.text));
        expect(numbers).toHaveLength(5);
        const boxes = numbers.map(t => ({ x: t.x, y: t.y, w: measure(t.text, t.opts)[0], h: measure(t.text, t.opts)[1] }));
        for (let i = 0; i < boxes.length; i++) {
          const a = boxes[i];
          expect(a.x).toBeGreaterThanOrEqual(0);
          expect(a.y).toBeGreaterThanOrEqual(0);
          expect(a.x + a.w).toBeLessThanOrEqual(800);
          expect(a.y + a.h).toBeLessThanOrEqual(800);
          for (const b of boxes.slice(i + 1)) expect(a.x + a.w <= b.x || b.x + b.w <= a.x
            || a.y + a.h <= b.y || b.y + b.h <= a.y, `recipe ${theme}, ${mode}, cluster ${start}`).toBe(true);
        }
      }
    }
  }
});
