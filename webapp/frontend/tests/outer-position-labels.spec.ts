// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { drawSnapshotLayer, computeHitRegions, resolveChartOuterPaintEnvelope, resolveChartOuterPaintEnvelopeScale, type ChartHitRegion } from "../src/lib/chart/draw-chart";
import { DEFAULT_WHEEL_RENDER_STYLE } from "../src/lib/chart/wheel-render-style";
import { WHEEL_FACTORY_SETTINGS, moveWheelRing, type WheelComposition } from "../src/lib/chart/wheel-composition";
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
function render(snapshot: ChartRenderSnapshot, renderStyle = DEFAULT_WHEEL_RENDER_STYLE, numberBearing = 0) {
  const scale = resolveChartOuterPaintEnvelopeScale(snapshot, renderStyle);
  const options = { ...drawOptions, renderStyle, chartSize: drawOptions.chartSize / scale };
  const texts: { x: number; y: number; text: string; opts: TextOpts }[] = [];
  const geometry: unknown[] = [];
  const record = ([x, y]: number[], text: string, opts: TextOpts) => texts.push({ x, y, text, opts });
  const ctx = new Proxy({}, { get: () => () => undefined });
  const textbounds = (text: string, opts?: TextOpts) => {
    const [w, h] = measure(text, opts);
    const bearing = text.includes("°") ? numberBearing : 0;
    return { x: bearing, y: 0, w: w - bearing * 2, h };
  };
  const draw = new Proxy({ ctx, text: record,
    textAtInkTop: ([x, y]: number[], text: string, opts: TextOpts) =>
      record([x + (text.includes("°") ? numberBearing : 0), y], text, opts),
    textsize: measure, textbounds,
    // Measurement, not paint: the fake measurer has no ink outline, so it
    // must not fall through to the recorded geometry commands below.
    textcontour: undefined,
    measure: (_name: string, run: () => unknown) => run(),
  }, { get: (obj, key) => key in obj ? obj[key as keyof typeof obj] : (...args: unknown[]) => geometry.push([key, ...args]) }) as unknown as CanvasDraw;
  for (const layer of ["geometry", "dynamic", "outer-label"] as const) drawSnapshotLayer(draw, snapshot, layer, options);
  const regions = computeHitRegions(snapshot, { ...options, textsize: measure, textbounds, includeStyleTargets: true });
  return { texts, geometry, regions, scale };
}
function contains(region: ChartHitRegion, x: number, y: number) {
  const box = region as unknown as { left: number; top: number; width: number; height: number };
  return x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;
}

test("twelve-part glyph paint follows projected dignity and the active palette", () => {
  const snapshot = fixture(0, false);
  snapshot.comparisonChart = undefined;
  snapshot.primaryChart.planets = [{
    id: "jupiter", seId: 5, longitude: 105, latitude: 0, speed: 1,
    glyph: "f", color: "rgb(1 2 3)", dignity: "exal",
  }];
  snapshot.outerRingMode = "dodecatemoria";
  snapshot.outerRingItems = { dodecatemoria: [{
    id: "dodec-planet-5", family: "dodecatemoria", longitude: 270, label: "Jupiter",
    segments: [{ text: "f", kind: "planet", seId: 5, dignity: "casus" }],
  }] };
  expect(render(snapshot).texts.filter(item => item.text === "f").map(item => item.opts.fill))
    .toContain(DEFAULT_WHEEL_RENDER_STYLE.palette.casus);
  const changedTheme = {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    palette: { ...DEFAULT_WHEEL_RENDER_STYLE.palette, casus: "rgb(9 8 7)" },
  };
  expect(render(snapshot, changedTheme).texts.filter(item => item.text === "f").map(item => item.opts.fill))
    .toContain("rgb(9 8 7)");
  snapshot.primaryChart.options.useDignityColors = true;
  expect(render(snapshot).texts.filter(item => item.text === "f").map(item => item.opts.fill))
    .toContain(DEFAULT_WHEEL_RENDER_STYLE.palette.planets[5]);
  // Explicit export paint remains authoritative.
  snapshot.outerRingItems.dodecatemoria![0].segments![0].color = "rgb(0 0 0)";
  expect(render(snapshot).texts.filter(item => item.text === "f").map(item => item.opts.fill))
    .toContain("rgb(0 0 0)");
});

test("asteroid rings paint the supplied retrograde marker", () => {
  for (const mode of ["asteroids", "hybrid_hits"] as const) {
    const snapshot = fixture(0, true);
    snapshot.comparisonChart = undefined;
    snapshot.outerRingMode = mode;
    snapshot.outerRingItems = { [mode]: [
      { id: "eros", family: "asteroid", longitude: 75, label: "Eros", motion: "R", degText: "4", minText: "00" },
      { id: "juno", family: "asteroid", longitude: 120, label: "Juno" },
    ] };
    const painted = render(snapshot);
    const marker = painted.texts.filter((item) => item.text.trim() === "R");
    const label = painted.texts.find((item) => item.text === "Eros");
    const position = painted.texts.find((item) => item.text.includes("4°"));
    expect(marker).toHaveLength(1);
    expect(label).toBeDefined();
    expect(position).toBeDefined();
    // On the left rim the shared word-label contract reads name, motion,
    // position; the opposite hemisphere reverses that run order.
    expect(marker[0].x).toBeGreaterThanOrEqual(label!.x + measure(label!.text, label!.opts)[0] - 0.5);
    expect(position!.x).toBeGreaterThanOrEqual(marker[0].x + measure(marker[0].text, marker[0].opts)[0] - 0.5);
    expect(marker[0].opts.size).toBeGreaterThanOrEqual(label!.opts.size!);
    expect(marker[0].opts.fill).toBe(DEFAULT_WHEEL_RENDER_STYLE.palette.textBright);
    expect(painted.regions.some((region) => region.kind === "style_target"
      && region.classId === "secondaryRing.asteroid.motion")).toBe(true);

    const edgeSnapshot = structuredClone(snapshot);
    edgeSnapshot.outerRingItems![mode]![0].label = "Astrowizard with a deliberately long outer label";
    edgeSnapshot.outerRingItems![mode]![0].segments = [
      { kind: "text", text: edgeSnapshot.outerRingItems![mode]![0].label },
    ];
    expect(render(edgeSnapshot).texts.filter((item) => item.text.trim() === "R")).toHaveLength(1);
  }
});

type Box = { x: number; y: number; w: number; h: number };

test("synastry degrees sit radially outside glyphs with a tiny gap in hidden and reordered bands", () => {
  for (const layout of ["legacy", "factory", "reordered"] as const) {
    for (const longitude of [0, 20, 75, 90, 145, 180, 210, 270, 280, 340]) {
      const snapshot = fixture(2, true);
      snapshot.document = { compoundKind: "synastry" } as ChartRenderSnapshot["document"];
      snapshot.primaryChart.options.showOuterMinutes = false;
      snapshot.comparisonChart!.options.showOuterMinutes = false;
      // The drawing framework owns visibility, even when the participant's
      // own house preference differs.
      snapshot.comparisonChart!.options.showHouses = true;
      snapshot.comparisonChart!.planets = [{
        id: "sun", seId: 0, glyph: "a", longitude, degText: "12", minText: "34",
      }] as Chart["planets"];
      if (layout !== "legacy") {
        const source = WHEEL_FACTORY_SETTINGS.layouts.anglo.composition as WheelComposition;
        let composition: WheelComposition = { ...source, rings: source.rings.map(ring => ({
          ...ring, enabled: !["degree", "houses", "decans"].includes(ring.archetypeId),
        })) };
        if (layout === "reordered") {
          composition = moveWheelRing(composition, "anglo-terms", "anglo-zodiac")!;
          expect(composition).not.toBeNull();
        }
        snapshot.primaryChart.options.wheelComposition = composition;
        snapshot.comparisonChart!.options.wheelComposition = composition;
      }
      const result = render(snapshot);
      // The same Morinus code can also appear as a smaller term-ruler glyph.
      const glyph = result.texts.filter(item => item.text === "a")
        .sort((a, b) => (b.opts.size ?? 0) - (a.opts.size ?? 0))[0];
      const label = result.texts.find(item => item.text === "12°")!;
      expect(glyph).toBeDefined();
      expect(label).toBeDefined();
      const [gw, gh] = measure(glyph.text, glyph.opts);
      const [w, h] = measure(label.text, label.opts);
      const gx = glyph.x + gw / 2, gy = glyph.y + gh / 2;
      const lx = label.x + w / 2, ly = label.y + h / 2;
      const radius = Math.hypot(gx - 400, gy - 400);
      expect(Math.abs((gx - 400) * (ly - gy) - (gy - 400) * (lx - gx)) / radius,
        `${layout}, longitude ${longitude}: radial alignment`).toBeLessThan(0.01);
      expect((gx - 400) * (lx - gx) + (gy - 400) * (ly - gy)).toBeGreaterThan(0);
      const separation = Math.hypot(
        Math.max(glyph.x - label.x - w, label.x - glyph.x - gw, 0),
        Math.max(glyph.y - label.y - h, label.y - glyph.y - gh, 0),
      );
      if (layout !== "reordered") {
        // The +3 px radial gap was chosen from 1/2/3 px variants.
        expect(separation, `${layout}, longitude ${longitude}`).toBeCloseTo(label.opts.size! / 3 + 3, 6);
      }
      for (const raw of result.geometry) {
        const command = raw as unknown[];
        if (command[0] !== "circle") continue;
        const [, [cx, cy], r] = command as [string, [number, number], number];
        const near = Math.hypot(Math.max(label.x - cx, 0, cx - label.x - w), Math.max(label.y - cy, 0, cy - label.y - h));
        const far = Math.max(...[[label.x, label.y], [label.x + w, label.y], [label.x, label.y + h], [label.x + w, label.y + h]]
          .map(([x, y]) => Math.hypot(x - cx, y - cy)));
        expect(r < near || r > far, `${layout}, longitude ${longitude}: visible ring clearance`).toBe(true);
      }
      expect(result.regions.some(region => region.kind === "style_target"
        && region.classId === "bodies.outer.position"
        && Math.abs(region.x - (label.x + w / 2)) < 1
        && Math.abs(region.y - (label.y + h / 2)) < 1)).toBe(true);
      const off = structuredClone(snapshot);
      off.primaryChart.options.showOuterPositions = false;
      off.comparisonChart!.options.showOuterPositions = false;
      const before = render(off);
      expect(result.geometry).toEqual(before.geometry);
      expect(result.texts.filter(item => item !== label)).toEqual(before.texts);
    }
  }
});

test("Black Moon readouts do not jump a whole row outward to clear a small retrograde marker", () => {
  for (const longitude of [164, 172, 178]) {
    const snapshot = fixture(2, true);
    snapshot.document = { compoundKind: "synastry" } as ChartRenderSnapshot["document"];
    snapshot.primaryChart.options.showOuterMinutes = false;
    snapshot.comparisonChart!.planets = [{
      id: "apogee", seId: 12, glyph: "Z", longitude, degText: "26", minText: "00", motion: "R",
    }] as Chart["planets"];
    const result = render(snapshot);
    const glyph = result.texts.find(item => item.text === "Z")!;
    const number = result.texts.find(item => item.text === "26°")!;
    const [gw, gh] = measure(glyph.text, glyph.opts);
    const [w, h] = measure(number.text, number.opts);
    const gap = Math.hypot(Math.max(glyph.x - number.x - w, number.x - glyph.x - gw, 0),
      Math.max(glyph.y - number.y - h, number.y - glyph.y - gh, 0));
    expect(gap).toBeLessThan(number.opts.size!);
    const marker = result.texts.find(item => item.text === "R")!;
    const [mw, mh] = measure(marker.text, marker.opts);
    expect(number.x + w <= marker.x || marker.x + mw <= number.x
      || number.y + h <= marker.y || marker.y + mh <= number.y).toBe(true);
  }
});

test("radial degree gaps follow visible ink equally above, below, left, and right", () => {
  const gaps: number[] = [];
  const bearing = 2.3;
  for (const longitude of [0, 90, 180, 270]) {
    const snapshot = fixture(2, true);
    snapshot.document = { compoundKind: "synastry" } as ChartRenderSnapshot["document"];
    snapshot.primaryChart.options.showOuterMinutes = false;
    snapshot.comparisonChart!.planets = [{
      id: "sun", seId: 0, glyph: "a", longitude, degText: "12", minText: "34",
    }] as Chart["planets"];
    const result = render(snapshot, DEFAULT_WHEEL_RENDER_STYLE, bearing);
    const glyph = result.texts.filter(item => item.text === "a")
      .sort((a, b) => (b.opts.size ?? 0) - (a.opts.size ?? 0))[0];
    const number = result.texts.find(item => item.text === "12°")!;
    const width = measure(number.text, number.opts)[0] - bearing * 2;
    const [glyphWidth, glyphHeight] = measure(glyph.text, glyph.opts);
    const height = measure(number.text, number.opts)[1];
    const gap = Math.hypot(Math.max(glyph.x - number.x - width, number.x - glyph.x - glyphWidth, 0),
      Math.max(glyph.y - number.y - height, number.y - glyph.y - glyphHeight, 0));
    gaps.push(gap);
    // The decided radial gap: a third of the degree size plus 3 px (d521381b).
    expect(gap).toBeCloseTo(number.opts.size! / 3 + 3, 6);
    expect(result.regions.some(region => region.kind === "style_target"
      && region.classId === "bodies.outer.position"
      && Math.abs(region.x - (number.x + width / 2)) < 1)).toBe(true);
  }
  gaps.forEach(gap => expect(gap).toBeCloseTo(gaps[0], 6));
});

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
  expect(result.texts.filter(t => t.text.trim() === "0°00′")).toHaveLength(1);
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

test("crowded synastry radial readouts retain full values, clear each other, and own their hits", () => {
  for (const longitude of [0, 43, 90, 180, 270, 357]) {
    const snapshot = fixture(2, true);
    snapshot.document = { compoundKind: "synastry" } as ChartRenderSnapshot["document"];
    snapshot.comparisonChart!.planets = ["sun", "moon", "mercury", "venus", "mars"].map((id, i) => ({
      id, seId: i, glyph: "ABCDE"[i], longitude: (longitude + i * 0.7) % 360,
      degText: String(10 + i), minText: "59", motion: i % 2 ? "SR" : "R",
    })) as Chart["planets"];
    const result = render(snapshot);
    // Radial readouts stack the degree beside the glyph and the smaller
    // minute digits one step farther along the same spoke, like the inner
    // ring (d521381b).
    const degrees = result.texts.filter(item => /^1[0-4]°$/.test(item.text));
    const minutes = result.texts.filter(item => item.text === "59");
    expect(degrees).toHaveLength(5);
    expect(minutes).toHaveLength(5);
    const labels = [...degrees, ...minutes];
    const boxes = labels.map(item => ({ ...item, w: measure(item.text, item.opts)[0], h: measure(item.text, item.opts)[1] }));
    boxes.forEach((a, i) => {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(800);
      expect(a.y + a.h).toBeLessThanOrEqual(800);
      expect(result.regions.some(region => region.kind === "planet" && region.chartRole === "outer"
        && contains(region, a.x + a.w / 2, a.y + a.h / 2))).toBe(true);
      for (const b of boxes.slice(i + 1)) {
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
      }
    });
    const off = structuredClone(snapshot);
    off.primaryChart.options.showOuterPositions = false;
    off.comparisonChart!.options.showOuterPositions = false;
    const before = render(off);
    expect(result.scale).toBe(before.scale);
    expect(result.geometry).toEqual(before.geometry);
    expect(result.texts.filter(item => !labels.includes(item))).toEqual(before.texts);
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
