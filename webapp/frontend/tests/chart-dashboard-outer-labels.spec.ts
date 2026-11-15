// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { drawSnapshotLayer, type OuterLabelCollisionBounds } from "../src/lib/chart/draw-chart";
import { DEFAULT_WHEEL_RENDER_STYLE } from "../src/lib/chart/wheel-render-style";
import type { CanvasDraw, TextOpts } from "../src/lib/chart/canvas-draw";
import type { Chart, ChartRenderSnapshot, OuterRingItem } from "../src/lib/chart/types";

// Chart dashboard modules are outer-label obstacles with fit "abbreviate":
// word labels (fixed stars, Lots, Arabic Parts) shorten through their
// abbreviation chain instead of crossing a module, exactly as at the canvas edge.

const measure = (text: string, opts: TextOpts = {}): [number, number] =>
  [text.length * (opts.size ?? 12) * 0.55, opts.size ?? 12];

function snapshot(items: OuterRingItem[]): ChartRenderSnapshot {
  const chart = {
    planets: [{ id: "mars", seId: 4, glyph: "e", longitude: 140, degText: "20", minText: "00" }],
    angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
    houses: { cusps: Array.from({ length: 12 }, (_, i) => i * 30) },
    aspects: [], meta: {},
    options: { theme: 0, signVariant: 0, showHouses: false, showOuterHouseLines: false,
      showPositions: false, showOuterPositions: false, showAspects: false, showSymbols: false,
      showTerms: false, showDecans: false, showCusplessAscMcLabels: false },
  } as unknown as Chart;
  return { primaryChart: chart, displayDatetime: "2026-10-16T12:00:00", renderVariant: "round-classic",
    overlayRenderMode: "full", outerRingMode: "fixstars", outerRingItems: { fixstars: items } } as ChartRenderSnapshot;
}

function render(snap: ChartRenderSnapshot, outerLabelCollisionBounds: OuterLabelCollisionBounds[] = [], center: [number, number] = [450, 450]) {
  const texts: { x: number; y: number; text: string; opts: TextOpts }[] = [];
  const record = ([x, y]: number[], text: string, opts: TextOpts) => texts.push({ x, y, text, opts });
  const ctx = new Proxy({}, { get: () => () => undefined });
  const draw = new Proxy({ ctx, text: record, textAtInkTop: record, textsize: measure,
    textbounds: (text: string, opts?: TextOpts) => { const [w, h] = measure(text, opts); return { x: 0, y: 0, w, h }; },
    measure: (_name: string, run: () => unknown) => run(),
  }, { get: (obj, key) => key in obj ? obj[key as keyof typeof obj] : () => undefined }) as unknown as CanvasDraw;
  for (const layer of ["dynamic", "outer-label"] as const) {
    drawSnapshotLayer(draw, snap, layer, {
      width: 900, height: 900, chartSize: 640, center,
      renderStyle: DEFAULT_WHEEL_RENDER_STYLE, outerLabelCollisionBounds,
    });
  }
  return texts;
}

const star: OuterRingItem = { id: "star", family: "fixstar", longitude: 0, label: "Zubenelgenubi" } as OuterRingItem;
const lot: OuterRingItem = { id: "lot", family: "arabic_part", longitude: 180, label: "Lot of Necessity" } as OuterRingItem;

function labelOf(texts: ReturnType<typeof render>, full: string) {
  const prefix = full.slice(0, 3);
  return texts.filter((t) => t.text.startsWith(prefix) || full.startsWith(t.text.replace(/\.$/, "")));
}

test("word labels shorten where they would cross a dashboard module", () => {
  const snap = snapshot([star, lot]);
  const free = render(snap);
  for (const item of [star, lot]) {
    const runs = labelOf(free, item.label!);
    expect(runs.map((t) => t.text).join("")).toBe(item.label);
    const first = runs[0];
    const [w] = measure(item.label!, first.opts);
    // A module box over the far half of the label, away from the wheel.
    const leftSide = first.x < 450;
    const box = leftSide
      ? { x: first.x - 40, y: first.y - 20, w: 40 + w / 2, h: 60, fit: "abbreviate" as const }
      : { x: first.x + w / 2, y: first.y - 20, w: w, h: 60, fit: "abbreviate" as const };
    const blocked = labelOf(render(snap, [box]), item.label!);
    const text = blocked.map((t) => t.text).join("");
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(item.label!.length);
    // Shortened in place, not nudged away from its anchor.
    expect(Math.abs(blocked[0].y - first.y)).toBeLessThan(2);
    const [shortWidth] = measure(text, blocked[0].opts);
    const right = blocked[0].x + shortWidth;
    expect(blocked[0].x >= box.x + box.w || right <= box.x).toBe(true);
  }
});

test("labels clear of every module keep their full text", () => {
  const snap = snapshot([star, lot]);
  const texts = render(snap, [{ x: 0, y: 0, w: 60, h: 60, fit: "abbreviate" }]);
  expect(labelOf(texts, star.label!).map((t) => t.text).join("")).toBe(star.label);
  expect(labelOf(texts, lot.label!).map((t) => t.text).join("")).toBe(lot.label);
});

test("a label past the surface's top edge shortens against the edge strip", () => {
  // MC at the top; the wheel sits high, so the star's label pokes above y = 0.
  const top: OuterRingItem = { id: "top", family: "fixstar", longitude: 275, label: "Zubenelgenubi" } as OuterRingItem;
  const snap = snapshot([top]);
  const center: [number, number] = [450, 240];
  const free = labelOf(render(snap, [], center), top.label!);
  expect(free.map((t) => t.text).join("")).toBe(top.label);
  expect(free[0].y - 6).toBeLessThan(0);
  const strip = { x: -4096, y: -4096, w: 900 + 8192, h: 4096, fit: "abbreviate" as const };
  const fitted = labelOf(render(snap, [strip], center), top.label!).map((t) => t.text).join("");
  expect(fitted.length).toBeLessThan(top.label!.length);
});
