// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { CanvasDraw, setCanvasDeviceFrame } from "../src/lib/chart/canvas-draw";
import {
  POSTER_CONTENT_K,
  POSTER_COUNTS_DEFAULT,
  posterLayout,
  type PosterContent,
  type PosterLayout,
} from "../src/components/workshell/astrolabe-poster";
import {
  posterStaggerLayout,
  posterTitleFromChart,
  type PosterTitle,
} from "../src/components/workshell/poster-stagger";
import type { ChartMeta } from "../src/lib/chart/types";

function recordingCanvas() {
  const calls: Array<[string, ...number[]]> = [];
  const context = {
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "top",
    globalAlpha: 1,
    save() {},
    restore() {},
    setTransform(...m: number[]) { calls.push(["setTransform", ...m]); },
    fillRect(...r: number[]) { calls.push(["fillRect", ...r]); },
    measureText() { return { width: 10, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 3 } as TextMetrics; },
    fillText(_text: string, x: number, y: number) { calls.push(["fillText", x, y]); },
  };
  const canvas = { width: 0, height: 0, style: {}, getContext: () => context } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

test("poster sheets are ISO sizes at 300 dpi with the plate centred on device pixels", () => {
  const a1 = posterLayout("A1");
  const plate = a1.plate!;
  expect([a1.width, a1.height]).toEqual([7016, 9933]);
  expect(a1.page.width).toBeCloseTo(1100);
  expect(Number.isInteger(plate.x) && Number.isInteger(plate.y)).toBe(true);
  expect(plate.x * 2 + plate.side * a1.dpr).toBeCloseTo(a1.width, 0);

  const a3 = posterLayout("A3");
  expect([a3.width, a3.height]).toEqual([3508, 4961]);
  expect(a3.page.width).toBeCloseTo(1100);
});

type Box = { x: number; y: number; w: number; h: number };
type Disc = { cx: number; cy: number; r: number };
const discOf = (r: Box): Disc => ({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, r: r.w / 2 });
const DISCS = new Set(["plate", "wheel"]);

function inside(layout: PosterLayout, rect: Box) {
  const edge = layout.frame;
  expect(rect.x).toBeGreaterThanOrEqual(edge - 0.01);
  expect(rect.y).toBeGreaterThanOrEqual(edge - 0.01);
  expect(rect.x + rect.w).toBeLessThanOrEqual(layout.page.width - edge + 0.01);
  expect(rect.y + rect.h).toBeLessThanOrEqual(layout.page.height - edge + 0.01);
}

const rectsOverlap = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
const discRectOverlap = (d: Disc, r: Box) => {
  const dx = Math.max(r.x - d.cx, 0, d.cx - r.x - r.w);
  const dy = Math.max(r.y - d.cy, 0, d.cy - r.y - r.h);
  return Math.hypot(dx, dy) < d.r - 0.5;
};
const discsOverlap = (a: Disc, b: Disc) => Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r - 0.5;

/** The aspect grid as the staircase it paints (its diagonal stays free). */
function gridRows(layout: PosterLayout): Box[] {
  const grid = layout.modules?.grid;
  if (!grid) return [];
  const rows = Math.round(grid.size / layout.modules!.cell);
  const cell = grid.size / rows;
  return Array.from({ length: rows }, (_, row) => ({ x: grid.left, y: grid.bottom - grid.size + row * cell, w: (row + 1) * cell, h: cell }));
}

function expectApart(layout: PosterLayout, label: string) {
  const shapes = layout.boxes.flatMap((box) => (
    box.id === "aspectGrid" ? gridRows(layout).map((rect) => ({ id: box.id, rect, disc: null as Disc | null }))
      : [{ id: box.id, rect: box.rect, disc: DISCS.has(box.id) ? discOf(box.rect) : null }]
  ));
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i];
      const b = shapes[j];
      if (a.id === b.id) continue;
      const hit = a.disc && b.disc ? discsOverlap(a.disc, b.disc)
        : a.disc ? discRectOverlap(a.disc, b.rect)
          : b.disc ? discRectOverlap(b.disc, a.rect)
            : rectsOverlap(a.rect, b.rect);
      expect(hit, `${label}: ${a.id} × ${b.id}`).toBe(false);
    }
  }
}

test("the astrolabe leads: the wheel is smaller and sits below the plate, between the tables", () => {
  const layout = posterLayout("A1");
  const plate = layout.plate!;
  const wheel = layout.wheel!;
  expect(wheel.w).toBeLessThan(plate.side);
  expect(wheel.y).toBeGreaterThan(plate.y / layout.dpr + plate.side / 2);
  expect(plate.side).toBeCloseTo(layout.page.width * 0.72);
  expect(layout.speculum!.x).toBeLessThan(wheel.x);
  expect(layout.cusps!.x).toBeGreaterThan(wheel.x + wheel.w - 1);
  // The wheel's layers are clipped to its own disc, which clears the plate.
  const clip = layout.wheelClip!;
  const plateDisc = discOf({ x: plate.x / layout.dpr, y: plate.y / layout.dpr, w: plate.side, h: plate.side });
  expect(discsOverlap(clip, plateDisc)).toBe(false);
});

test("the composition fills the sheet: centred, the lower disc as large as its band allows", () => {
  const layout = posterLayout("A1");
  const top = Math.min(...layout.boxes.map((box) => box.rect.y));
  const bottom = Math.max(...layout.boxes.map((box) => box.rect.y + box.rect.h));
  // Equal margins above and below.
  expect(top - layout.frame).toBeCloseTo(layout.page.height - layout.frame - bottom, 0);
  // Width-bound: the wheel comes close to the tables on both sides.
  const wheel = layout.wheel!;
  const specRight = layout.speculum!.x + layout.type * 10.2;
  expect(wheel.x - specRight).toBeLessThan(layout.type * 4);
});

const ALL: PosterContent = { ...POSTER_CONTENT_K, aspectGrid: true, declination: true, moon: true };

test("every combination keeps its elements inside the neatline and apart", () => {
  const keys = ["plate", "wheel", "speculum", "cusps", "aspectGrid", "declination", "moon"] as const;
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    for (const lead of ["astrolabe", "chart"] as const) {
      for (const leadShare of [0.4, 0.72, 0.84]) {
        const content: PosterContent = { ...POSTER_CONTENT_K, lead, leadShare };
        keys.forEach((key, bit) => { content[key] = Boolean(mask & (1 << bit)); });
        // Every sheet is composed at the same CSS width and aspect, so A1 stands for all.
        for (const sheet of ["A1"] as const) {
          const layout = posterLayout(sheet, content, POSTER_COUNTS_DEFAULT);
          const ids = layout.boxes.map((box) => box.id).sort();
          const label = `${ids.join()} ${lead} ${leadShare} ${sheet}`;
          expect(ids, label).toEqual(keys.filter((key) => content[key]).slice().sort());
          for (const box of layout.boxes) {
            expect(box.rect.w).toBeGreaterThan(0);
            inside(layout, box.rect);
          }
          expectApart(layout, label);
        }
      }
    }
  }
});

test("the chart can lead: the wheel on top, the plate below between the tables", () => {
  const layout = posterLayout("A1", { ...POSTER_CONTENT_K, lead: "chart" });
  const plate = layout.plate!;
  const wheel = layout.wheel!;
  expect(wheel.y).toBeLessThan(plate.y / layout.dpr);
  expect(wheel.w).toBeGreaterThan(plate.side);
  const plateDisc = discOf({ x: plate.x / layout.dpr, y: plate.y / layout.dpr, w: plate.side, h: plate.side });
  expect(discsOverlap(layout.wheelClip!, plateDisc)).toBe(false);
});

test("dashboard modules take their screen places along the foot and the wheel nests among them", () => {
  const layout = posterLayout("A1", ALL);
  const modules = layout.modules!;
  expect(modules.grid && modules.scale && modules.moon).toBeTruthy();
  const wheel = layout.wheel!;
  expect(modules.grid!.left).toBeLessThan(wheel.x);
  expect(modules.moon!.x).toBeGreaterThan(wheel.x + wheel.w / 2);
  expect(modules.grid!.bottom).toBeGreaterThan(wheel.y + wheel.h / 2);
  expect(wheel.w).toBeGreaterThanOrEqual(layout.page.width * 0.3);
});

test("a lone element is centred and as large as the sheet allows", () => {
  const layout = posterLayout("A1", { ...POSTER_CONTENT_K, wheel: false, speculum: false, cusps: false });
  const plate = layout.plate!;
  const top = plate.y / layout.dpr;
  expect(top + plate.side / 2).toBeCloseTo(layout.page.height / 2, 0);
  expect(plate.side).toBeGreaterThan(layout.page.width * 0.8);
  expect(layout.wheel).toBeNull();
  expect(layout.speculum).toBeNull();
});

const TITLE: PosterTitle = {
  name: "Morinus",
  facts: [
    { text: "23 February 1583", primary: true },
    { text: "08:47:00 LC", primary: true },
    { text: "Villefranche-sur-Saône", primary: false },
    { text: "45°59′ N\u20024°43′ E", primary: false },
    { text: "Placidus", primary: false },
  ],
  mark: "aries.sh",
};
const BOTH = { aspectGrid: true, moon: true };

test("stagger: the plate's ink on the top and left margins, the wheel's rim toward the right and bottom", () => {
  const layout = posterStaggerLayout("A1", POSTER_COUNTS_DEFAULT, TITLE, "sans-serif", BOTH);
  const plate = layout.boxes.find((box) => box.id === "plate")!.rect;
  const wheel = layout.wheel!;
  const margin = layout.frame;
  expect(plate.x).toBeCloseTo(margin);
  expect(plate.y).toBeCloseTo(margin);
  expect(plate.w).toBeCloseTo(wheel.w);
  // The wheel's square passes the margin by its rim inset, never past ¾ of it.
  const over = wheel.x + wheel.w - (layout.page.width - margin);
  expect(over).toBeGreaterThan(0);
  expect(over).toBeLessThanOrEqual(margin * 0.75 + 0.01);
  expect(wheel.y + wheel.h - (layout.page.height - margin)).toBeCloseTo(over);
  // The plate renders past its ink, the wheel's paper stays clear of it.
  expect(layout.plate!.side).toBeGreaterThan(plate.w);
  expect(discsOverlap(layout.wheelClip!, discOf(plate))).toBe(false);
  expect(layout.stagger).not.toBeNull();
  expect(layout.modulesPrint?.moonHeading).toBe(false);
});

test("stagger: every element stays inside the margins and apart, for any name, row count and module set", () => {
  const names = ["Morinus", "Jean-Baptiste Morin de Villefranche, astrologer royal to Louis XIII", ""];
  for (const name of names) {
    for (const speculumRows of [10, 13, 22]) {
      for (const moonRows of [5, 6]) {
        for (const modules of [BOTH, { aspectGrid: false, moon: true }, { aspectGrid: true, moon: false }, { aspectGrid: false, moon: false }]) {
          for (const sheet of ["A1", "A3"] as const) {
            const counts = { ...POSTER_COUNTS_DEFAULT, speculumRows, moonRows };
            const layout = posterStaggerLayout(sheet, counts, { ...TITLE, name }, "sans-serif", modules);
            const label = `${name.length} ${speculumRows} ${moonRows} ${JSON.stringify(modules)} ${sheet}`;
            for (const box of layout.boxes) if (box.id !== "wheel") inside(layout, box.rect);
            expect(layout.boxes.some((box) => box.id === "aspectGrid"), label).toBe(modules.aspectGrid);
            expect(layout.boxes.some((box) => box.id === "moon"), label).toBe(modules.moon);
            expectApart(layout, label);
          }
        }
      }
    }
  }
});

test("stagger: a long name wraps in the column and the discs keep their size", () => {
  const short = posterStaggerLayout("A1", POSTER_COUNTS_DEFAULT, TITLE, "sans-serif", BOTH);
  const long = posterStaggerLayout("A1", POSTER_COUNTS_DEFAULT, { ...TITLE, name: "Jean-Baptiste Morin de Villefranche" }, "sans-serif", BOTH);
  const names = (layout: typeof long) => layout.stagger!.title.lines.filter((line) => line.name).length;
  expect(names(short)).toBe(1);
  expect(names(long)).toBeGreaterThan(1);
  expect(long.stagger!.title.h).toBeGreaterThan(short.stagger!.title.h);
  expect(long.wheel!.w).toBeCloseTo(short.wheel!.w);
});

test("stagger: the aspect grid nests into the wheel's curve with cells larger than the screen's share", () => {
  const layout = posterStaggerLayout("A1", POSTER_COUNTS_DEFAULT, TITLE, "sans-serif", BOTH);
  const modules = layout.modules!;
  expect(modules.grid!.left).toBeCloseTo(layout.frame);
  expect(modules.grid!.bottom).toBeCloseTo(layout.page.height - layout.frame);
  expect(modules.cell).toBeGreaterThan(layout.type * 1.2);
  // The Moon list sits between the plate and the aspects.
  const moon = layout.boxes.find((box) => box.id === "moon")!.rect;
  const plate = layout.boxes.find((box) => box.id === "plate")!.rect;
  expect(moon.y).toBeGreaterThan(layout.frame + plate.h / 2);
  expect(moon.y + moon.h).toBeLessThan(modules.grid!.bottom - modules.grid!.size);
});

test("stagger facts read as print: spaced date, no comma before the zone, latitude first with primes", () => {
  const meta = {
    name: " Morinus ",
    dateDisplay: "23.February.1583",
    timeDisplay: "08:47:00, LC",
    place: "Villefranche-sur-Saône",
    placeCoords: "04°43'E, 45°59'N",
    houseSystemLines: ["Placidus"],
  } as ChartMeta;
  const title = posterTitleFromChart(meta, null);
  expect(title.name).toBe("Morinus");
  expect(title.facts.map((fact) => fact.text)).toEqual([
    "23 February 1583", "08:47:00 LC", "Villefranche-sur-Saône", "45°59′ N\u20024°43′ E", "Placidus",
  ]);
  expect(title.mark).toBeNull();
  // A numeric date keeps its form; absent facts are left out.
  const numeric = posterTitleFromChart({ ...meta, dateDisplay: "1583.02.23", place: "", houseSystemLines: [] } as ChartMeta, "aries.sh");
  expect(numeric.facts.map((fact) => fact.text)).toEqual(["1583.02.23", "08:47:00 LC", "45°59′ N\u20024°43′ E"]);
  expect(numeric.mark).toBe("aries.sh");
});

test("a device frame paints one tile of the drawing and snaps to device pixels", () => {
  const { canvas, calls } = recordingCanvas();
  setCanvasDeviceFrame(canvas, { x: -4096, y: -100, width: 2000, height: 1500 });
  const draw = new CanvasDraw(canvas);
  draw.resize(1100, 1556, 6.4);
  draw.fillBackground("#000");
  draw.text([10.3, 20.26], "A", { size: 12 });

  expect([canvas.width, canvas.height]).toEqual([2000, 1500]);
  expect(calls[0]).toEqual(["setTransform", 6.4, 0, 0, 6.4, -4096, -100]);
  // The background fills the whole tile, whatever the drawing transform.
  expect(calls).toContainEqual(["fillRect", 0, 0, 2000, 1500]);
  const text = calls.find((call) => call[0] === "fillText")!;
  expect(text[1] * 6.4).toBeCloseTo(Math.round(10.3 * 6.4));
  expect(text[2] * 6.4).toBeCloseTo(Math.round(20.26 * 6.4));

  setCanvasDeviceFrame(canvas, null);
  draw.resize(100, 50, 2);
  expect([canvas.width, canvas.height]).toEqual([200, 100]);
});
