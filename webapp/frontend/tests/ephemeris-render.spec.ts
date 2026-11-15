// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { monthIndexDays, monthIndexStartJd, monthStartJd, yearCamera } from "../src/lib/chart/ephemeris-camera";
import { decimatePolyline } from "../src/lib/chart/ephemeris-decimate";
import {
  computeEphemerisGeometry,
  forEachSegmentBreak,
  mapEphemerisY,
  modalityDegrees,
  modalityRowStep,
  valueAtEphemerisY,
} from "../src/lib/chart/ephemeris-geometry";
import { paintEphemerisChrome } from "../src/lib/chart/ephemeris-chrome-paint";
import { ephemerisInkTable, ephemerisPlanetInk, ephemerisPaintOrder } from "../src/lib/chart/ephemeris-ink";
import { hitTestEphemeris } from "../src/lib/chart/ephemeris-hit-test";
import { ephemerisLabelJd, ephemerisValueAt, paintEphemerisPlot, placeEdgeLabels } from "../src/lib/chart/ephemeris-plot-paint";
import { ephemerisCentredInkAnchor, ephemerisKnockoutRadius, paintEphemerisContacts, paintEphemerisKnockoutMark, paintEphemerisRadix, snapToDevicePixel, type EphemerisRadixPoint } from "../src/lib/chart/ephemeris-radix";
import { createEphemerisRenderStyle, resolveEphemerisInkColors } from "../src/lib/chart/ephemeris-render-style";
import type { EphemerisScene } from "../src/lib/chart/ephemeris-scene";
import { buildTimeRuler } from "../src/lib/chart/ephemeris-time-ticks";
import { decodeEphemerisBlocks, decodeEphemerisStationYear } from "../src/lib/chart/ephemeris-wire";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function rulerFor(spanDays: number, startJd = monthStartJd(2026, 1), plotWidth = 1000) {
  return buildTimeRuler({
    camera: { startJd, spanDays },
    xOrig: 100,
    plotWidth,
    monthLabels: MONTHS,
    measureText: (text) => text.length * 7,
    measureRuler: (text) => text.length * 6,
    minSpacing: 3.5,
    labelGap: 6,
  });
}

test("M4 decimation keeps each device column's first, last, lowest and highest point", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < 5000; i++) {
    xs.push(i * 0.07);
    ys.push(Math.sin(i / 40) * 100 + random() * 30);
  }
  const dpr = 2;
  const out = decimatePolyline(xs, ys, dpr);
  expect(out.xs.length).toBeLessThan(xs.length / 2);
  const columns = (px: number[], py: number[]) => {
    const map = new Map<number, { min: number; max: number; first: number; last: number }>();
    px.forEach((x, i) => {
      const c = Math.floor(x * dpr);
      const entry = map.get(c);
      if (!entry) map.set(c, { min: py[i], max: py[i], first: py[i], last: py[i] });
      else {
        entry.min = Math.min(entry.min, py[i]);
        entry.max = Math.max(entry.max, py[i]);
        entry.last = py[i];
      }
    });
    return map;
  };
  expect(columns(out.xs, out.ys)).toEqual(columns(xs, ys));
  // Every emitted point is an input point, in input order.
  const inputs = new Set(xs.map((x, i) => `${x},${ys[i]}`));
  expect(out.xs.every((x, i) => inputs.has(`${x},${out.ys[i]}`))).toBe(true);
  expect(out.xs.every((x, i) => i === 0 || x >= out.xs[i - 1])).toBe(true);
  // Sparse input (fewer than one sample per column) passes through unchanged.
  const sparse = decimatePolyline([0, 3, 6, 9], [1, 5, 2, 8], 2);
  expect(sparse).toEqual({ xs: [0, 3, 6, 9], ys: [1, 5, 2, 8] });
});

test("time-ruler ladder selects days, five days, months, quarters, years by scale", () => {
  expect(rulerFor(28).level).toBe("days");
  expect(rulerFor(90).level).toBe("five-days");
  expect(rulerFor(365).level).toBe("months");
  expect(rulerFor(5 * 365.25).level).toBe("quarters");
  expect(rulerFor(3653).level).toBe("years");
});

test("a month-aligned twelve-month camera draws the classic plate ruler", () => {
  const camera = yearCamera(2026);
  const ruler = rulerFor(camera.spanDays, camera.startJd);
  const months = ruler.labels.filter((l) => l.row === "month" && l.font === "text").map((l) => l.text);
  expect(months).toEqual([...MONTHS, "jan"]);
  expect(ruler.labels.filter((l) => l.row === "year").map((l) => l.text)).toEqual(["2027", "2026"]);
  expect(ruler.labels.filter((l) => l.font === "ruler")).toEqual([]);
  expect(ruler.gridXs).toHaveLength(11);
  expect(ruler.ticks.filter((t) => t.level === "major")).toHaveLength(13);
  expect(ruler.ticks.filter((t) => t.level === "medium")).toHaveLength(24); // 11th and 21st
});

test("time-ruler labels never collide at any zoom or offset", () => {
  for (let span = 28; span <= 3653; span *= 1.17) {
    for (const offset of [0, 3.3, 17.8]) {
      const ruler = rulerFor(span, monthStartJd(2026, 1) + offset * (span / 100));
      for (const row of ["month", "year"] as const) {
        const boxes = ruler.labels.filter((l) => l.row === row).map((l) => [l.x - l.width / 2, l.x + l.width / 2]).sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < boxes.length; i++) expect(boxes[i][0]).toBeGreaterThanOrEqual(boxes[i - 1][1]);
      }
      expect(ruler.labels.length).toBeGreaterThan(0);
    }
  }
});

function frameFixture() {
  const b64 = (values: number[]) => Buffer.from(new Float64Array(values).buffer).toString("base64");
  const index = 2026 * 12;
  const blocks = [0, 1].map((k) => {
    const days = monthIndexDays(index + k);
    const startJd = monthIndexStartJd(index + k);
    const lon = [...Array.from({ length: days }, (_, d) => 350 + (k * 31 + d) * 0.5), ...Array.from({ length: days }, () => 45)];
    return {
      year: 2026, month: k + 1, startJd, days,
      longitude: b64(lon.map((v) => v % 360)),
      declination: b64(lon.map(() => 5)),
      signEvents: [], outOfBounds: [],
      declinationStations: [{ planet: 2, jd: startJd + 10, value: 5, code: "DN", date: "decl" }],
      lunations: k === 0 ? [{ kind: "new", jd: startJd + 18.25, longitude: 120, declination: 10, date: "lun" }] : [],
    };
  });
  const decoded = decodeEphemerisBlocks({ dataKey: "k", planetIds: [0, 2], blocks });
  const stations = decodeEphemerisStationYear({
    dataKey: "k", year: 2026, longitude: [{ planet: 2, jd: monthStartJd(2026, 1) + 20.4, value: 45.5, code: "SR", date: "Jan 21" }],
  });
  return { dataKey: "k", blocks: decoded, stationYears: [stations] };
}

const scene: EphemerisScene = {
  mode: "longitude",
  planets: [{ id: 0, glyph: "S", color: "#f00" }, { id: 2, glyph: "M", color: "#0f0" }, { id: 1, glyph: "L", color: "#00f" }],
  visible: { 0: true, 2: true, 1: true },
  signGlyphs: Array.from({ length: 12 }, (_, i) => `g${i}`),
  signNames: Array.from({ length: 12 }, (_, i) => `n${i}`),
  monthLabels: MONTHS,
  showGrid: true,
  showEventGlyphs: false,
  showLunations: true,
  lunationLabels: { new: "New Moon", full: "Full Moon" },
  outOfBoundsLabel: "OOB",
  modulus: 360,
  inkMode: "tiers",
  highlightPlanetId: null,
  dignityBySign: {},
  usePlanetColors: false,
  headerText: () => "",
};

test("hover snaps to stations and lunations, else reads the free cursor", () => {
  const style = createEphemerisRenderStyle({});
  const geo = computeEphemerisGeometry(1200, 800, "longitude", (t, s) => t.length * s * 0.6, style);
  const camera = { startJd: monthStartJd(2026, 1), spanDays: 59 };
  const data = frameFixture();
  const xOf = (jd: number) => geo.xOrig + ((jd - camera.startJd) / camera.spanDays) * geo.plotWidth;
  const stationX = xOf(monthStartJd(2026, 1) + 20.4);
  const stationY = mapEphemerisY(geo, "longitude", 45.5);
  const snapped = hitTestEphemeris(stationX + 4, stationY - 6, camera, geo, data, scene, style);
  expect(snapped?.info).toMatchObject({ date: "Jan 21", stationCode: "SR", planetGlyph: "M", sign: "g1", degree: 15, minute: 30 });
  expect(snapped?.jd).toBe(monthStartJd(2026, 1) + 20.4);
  expect(snapped?.x).toBeCloseTo(stationX, 9);
  // Hidden planets do not snap.
  const hidden = hitTestEphemeris(stationX, stationY, camera, geo, data, { ...scene, visible: { 0: true } }, style);
  expect(hidden?.info.stationCode).toBeUndefined();

  const lunationX = xOf(monthStartJd(2026, 1) + 18.25);
  const lunationY = mapEphemerisY(geo, "longitude", 120);
  const lunation = hitTestEphemeris(lunationX - 3, lunationY + 2, camera, geo, data, scene, style);
  expect(lunation?.info).toMatchObject({ date: "lun", eventLabel: "New Moon", planetGlyph: "L", sign: "g4", degree: 0 });
  const noLunations = hitTestEphemeris(lunationX, lunationY, camera, geo, data, { ...scene, showLunations: false }, style);
  expect(noLunations?.info.eventLabel).toBeUndefined();

  const declination = hitTestEphemeris(xOf(monthStartJd(2026, 1) + 10), mapEphemerisY(geo, "declination", 5), camera, geo, data, { ...scene, mode: "declination" }, style);
  expect(declination?.info).toMatchObject({ stationCode: "DN", declination: true, declSign: "+", degree: 5 });

  const free = hitTestEphemeris(xOf(monthStartJd(2026, 2) + 4.5), mapEphemerisY(geo, "longitude", 75.26), camera, geo, data, scene, style);
  expect(free?.info).toMatchObject({ date: "Feb 5", sign: "g2", degree: 15, minute: 15 });
  expect(free?.info.stationCode).toBeUndefined();
  expect(hitTestEphemeris(geo.xOrig - 10, 300, camera, geo, data, scene, style)).toBeNull();
});

test("left-edge labels interpolate across days and the 0° Aries seam", () => {
  const data = frameFixture();
  const start = monthStartJd(2026, 1);
  expect(ephemerisValueAt(data.blocks, 0, "longitude", start)).toBe(350);
  expect(ephemerisValueAt(data.blocks, 0, "longitude", start + 0.5)).toBeCloseTo(350.25, 9);
  // 359.5 -> 0.0 crosses the seam the short way.
  expect(ephemerisValueAt(data.blocks, 0, "longitude", start + 19.5)).toBeCloseTo(359.75, 9);
  // Across the block boundary into February.
  expect(ephemerisValueAt(data.blocks, 0, "longitude", start + 30.5)).toBeCloseTo((350 + 15.25) % 360, 9);
  expect(ephemerisValueAt(data.blocks, 0, "longitude", monthStartJd(2026, 4))).toBeNull();
});

test("longitude folds into the modulus: 0 on the top rule, increasing downward", () => {
  const style = createEphemerisRenderStyle({});
  const measure = (t: string, size: number) => t.length * size * 0.6;
  const geo = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 45);
  expect(geo.modulus).toBe(45);
  expect(mapEphemerisY(geo, "longitude", 0, 45)).toBe(geo.yTop);
  expect(mapEphemerisY(geo, "longitude", 45, 45)).toBe(geo.yTop);
  expect(mapEphemerisY(geo, "longitude", 22.5, 45)).toBeCloseTo(geo.yTop + geo.plotHeight / 2, 9);
  // 0° Aries, 15° Taurus, 0° Cancer ... all fold together at 45°.
  expect(mapEphemerisY(geo, "longitude", 225 + 10, 45)).toBeCloseTo(mapEphemerisY(geo, "longitude", 10, 45), 9);
  expect(mapEphemerisY(geo, "longitude", -5, 45)).toBeCloseTo(mapEphemerisY(geo, "longitude", 40, 45), 9);
  expect(valueAtEphemerisY(geo, "longitude", mapEphemerisY(geo, "longitude", 31.25, 45), 45)).toBeCloseTo(31.25, 9);
  // Declination ignores the modulus.
  expect(mapEphemerisY(geo, "declination", 0, 45)).toBeCloseTo(geo.yTop + geo.plotHeight / 2, 9);
  // The harmonic table is wider than the sign column; the plot gives way.
  const geo360 = computeEphemerisGeometry(1200, 800, "longitude", measure, style);
  expect(geo.tableRight - geo.tableLeft).toBeGreaterThan(geo360.tableRight - geo360.tableLeft);
  expect(geo.xOrig).toBeGreaterThan(geo360.xOrig);
  expect(geo.plotRight).toBe(geo360.plotRight);
});

test("segment breaks find every wrap and ingress in travel order, half-open", () => {
  const breaks = (from: number, delta: number, modulus: number, ingresses: boolean) => {
    const out: Array<[number, number, boolean, boolean]> = [];
    forEachSegmentBreak(from, delta, modulus, ingresses, (t, value, wrap, ingress) => out.push([Number(t.toFixed(6)), value, wrap, ingress]));
    return out;
  };
  // A fast Moon step crossing two multiples of 30.
  expect(breaks(25, 40, 30, false)).toEqual([[0.125, 30, true, false], [0.875, 60, true, false]]);
  // At 45° with ingresses: 30 (sign), 45 (wrap), 60 (sign) in order.
  expect(breaks(25, 40, 45, true)).toEqual([[0.125, 30, false, true], [0.5, 45, true, false], [0.875, 60, false, true]]);
  // 90 is both a wrap and an ingress.
  expect(breaks(85, 10, 90, true)).toEqual([[0.5, 90, true, true]]);
  // Retrograde: in travel order, the start counts and the end does not.
  expect(breaks(91, -3, 45, false)).toEqual([[1 / 3, 90, true, false].map((v, i) => (i === 0 ? Number((1 / 3).toFixed(6)) : v)) as [number, number, boolean, boolean]]);
  expect(breaks(90, -1, 45, false)).toEqual([[0, 90, true, false]]);
  expect(breaks(91, -1, 45, false)).toEqual([]);
  // Direct: the end counts and the start does not.
  expect(breaks(89, 1, 45, false)).toEqual([[1, 90, true, false]]);
  expect(breaks(90, 1, 45, false)).toEqual([]);
  // Across 0° Aries the shortest way.
  expect(breaks(358, 4, 360, true)).toEqual([[0.5, 360, true, true]]);
});

test("the modality table names the sign degree folding onto each row", () => {
  // 90°: the four signs folding onto a row share one modality.
  expect(modalityDegrees(0, 90)).toEqual([[0], [], []]);
  // Plotted 40 at 90°: 40, 130, 220, 310 = 10° Taurus, Leo, Scorpio, Aquarius (fixed).
  expect(modalityDegrees(40, 90)).toEqual([[], [10], []]);
  // 45°: two modalities per row, 15° apart in sign degree.
  expect(modalityDegrees(10, 45)).toEqual([[10], [25], []]);
  expect(modalityDegrees(20, 45)).toEqual([[20], [], [5]]);
  expect(modalityDegrees(40, 45)).toEqual([[], [10], [25]]);
  // Rows thin out so figures never collide.
  expect(modalityRowStep(45, 600, 9)).toBe(1);
  expect(modalityRowStep(45, 450, 9)).toBe(3);
  expect(modalityRowStep(90, 450, 9)).toBe(3);
  expect(modalityRowStep(90, 200, 9)).toBe(5);
  expect(modalityRowStep(30, 450, 9)).toBe(1);
});

function inkStyle() {
  const palette = { background: "#ffffff", frame: "#555555", texts: "#111111", signs: "#222222", outOfBounds: "#ff0000" };
  const css = new Map([
    ["--aries-text-muted", "#777777"],
    ["--aries-border-subtle", "#cccccc"],
    ["--aries-signal", "#0055ff"],
    ["--morinus-body-sun", "#aa0000"],
    ["--morinus-body-moon", "#fefefe"],
    ["--morinus-dignity-domicil", "#008800"],
    ["--morinus-dignity-exal", "#886600"],
    ["--morinus-dignity-exil", "#cc0000"],
    ["--morinus-dignity-casus", "#880088"],
    ["--morinus-peregrin", "#444444"],
  ]);
  return createEphemerisRenderStyle({ palette, colors: resolveEphemerisInkColors(palette, (name) => css.get(name) ?? "") });
}

const SUN_DIGNITY = ["peregrine", "peregrine", "peregrine", "peregrine", "domicile", "peregrine", "fall", "peregrine", "peregrine", "peregrine", "detriment", "peregrine"] as const;
const SUN_DIGNITY_EXALTED = SUN_DIGNITY.map((d, i) => (i === 0 ? "exaltation" : d));

test("ink modes pick ink, tiers, body colours or dignity colours", () => {
  const style = inkStyle();
  const sun = { id: 0, glyph: "S", color: "#123456" };
  const moon = { id: 1, glyph: "L", color: "#123456" };
  const jupiter = { id: 5, glyph: "J", color: "#123456" };
  const base = { dignityBySign: { 0: SUN_DIGNITY_EXALTED }, usePlanetColors: false };
  expect(ephemerisPlanetInk(sun, 0, { ...base, inkMode: "tiers" }, style)).toBe("#111111");
  expect(ephemerisPlanetInk(moon, 0, { ...base, inkMode: "tiers" }, style)).toBe("#111111");
  expect(ephemerisPlanetInk(jupiter, 0, { ...base, inkMode: "tiers" }, style)).toBe("#777777");
  // Dignity colours stay dignity colours even where the theme paints bodies.
  expect(ephemerisPlanetInk(sun, 0, { ...base, inkMode: "dignity", usePlanetColors: true }, style)).toBe("#886600");
  // Planet colours: the theme token first, the daemon colour without one.
  expect(ephemerisPlanetInk(sun, 4, { ...base, inkMode: "planets" }, style)).toBe("#aa0000");
  expect(ephemerisPlanetInk(jupiter, 4, { ...base, inkMode: "planets" }, style)).toBe("#123456");
  // A near-white Moon on white paper falls back to ink.
  expect(ephemerisPlanetInk(moon, 0, { ...base, inkMode: "planets" }, style)).toBe("#111111");
  // Dignity colours by sign; a planet without a table is peregrine.
  const chart = { ...base, inkMode: "dignity" as const };
  expect(ephemerisPlanetInk(sun, 0, chart, style)).toBe("#886600");
  expect(ephemerisPlanetInk(sun, 4, chart, style)).toBe("#008800");
  expect(ephemerisPlanetInk(sun, 6, chart, style)).toBe("#880088");
  expect(ephemerisPlanetInk(sun, 10, chart, style)).toBe("#cc0000");
  expect(ephemerisPlanetInk(sun, 1, chart, style)).toBe("#444444");
  expect(ephemerisPlanetInk(jupiter, 4, chart, style)).toBe("#444444");

  // The highlight keeps its own ink and only gains weight; the rest is untouched.
  const lit: EphemerisScene = { ...scene, inkMode: "dignity", dignityBySign: { 0: SUN_DIGNITY_EXALTED }, highlightPlanetId: 2 };
  const table = ephemerisInkTable(lit, style);
  expect(table.get(2)).toMatchObject({ highlighted: true, runs: ["#444444"], width: style.strokes.curveWidthHighlight });
  expect(table.get(0)).toMatchObject({ highlighted: false, width: style.strokes.curveWidthSun });
  expect(table.get(0)).not.toHaveProperty("alpha");
  expect(table.get(0)?.runs).toEqual(["#886600", "#444444", "#008800", "#880088", "#cc0000"]);
  expect(table.get(1)?.width).toBe(style.strokes.curveWidthMoon);
  expect(ephemerisInkTable(lit, style)).toBe(table);
  expect(ephemerisPaintOrder(lit.planets, 2).map((p) => p.id)).toEqual([0, 1, 2]);
  expect(ephemerisPaintOrder(lit.planets, 0).map((p) => p.id)).toEqual([2, 1, 0]);
});

type Op = [string, ...number[]];
function recordingContext() {
  const strokes: Array<{ color: string; alpha: number; width: number; ops: Op[] }> = [];
  const texts: Array<{ text: string; x: number; y: number; fill: string }> = [];
  let ops: Op[] = [];
  const state = { strokeStyle: "", fillStyle: "", globalAlpha: 1, lineWidth: 1 };
  const stack: Array<typeof state> = [];
  const target: Record<string, unknown> = {
    canvas: { width: 2400, height: 1600 },
    font: "",
    save: () => stack.push({ ...state }),
    restore: () => Object.assign(state, stack.pop()),
    beginPath: () => { ops = []; },
    moveTo: (x: number, y: number) => ops.push(["M", x, y]),
    lineTo: (x: number, y: number) => ops.push(["L", x, y]),
    stroke: () => strokes.push({ color: state.strokeStyle, alpha: state.globalAlpha, width: state.lineWidth, ops }),
    fillText: (text: string, x: number, y: number) => texts.push({ text, x, y, fill: state.fillStyle }),
    measureText: (text: string) => ({ width: text.length * 7 }),
  };
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop in state) return state[prop as keyof typeof state];
      if (prop in t) return t[prop];
      return () => {};
    },
    set(t, prop: string, value) {
      if (prop in state) (state as Record<string, unknown>)[prop] = value;
      else t[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes, texts };
}

function sunFixture(lon: (day: number) => number) {
  const b64 = (values: number[]) => Buffer.from(new Float64Array(values).buffer).toString("base64");
  const index = 2026 * 12;
  const days = monthIndexDays(index);
  const startJd = monthIndexStartJd(index);
  const values = Array.from({ length: days }, (_, d) => lon(d));
  const blocks = decodeEphemerisBlocks({
    dataKey: "k",
    planetIds: [0],
    blocks: [{
      year: 2026, month: 1, startJd, days,
      longitude: b64(values.map((v) => ((v % 360) + 360) % 360)), declination: b64(values.map(() => 0)),
      signEvents: [], outOfBounds: [], declinationStations: [], lunations: [],
    }],
  });
  return { data: { dataKey: "k", blocks, stationYears: [] }, startJd, days };
}

test("dignity colouring splits the decimated curve into colour runs at the ingress", () => {
  const style = inkStyle();
  const measure = (t: string, size: number) => t.length * size * 0.6;
  // The Sun from 20° Pisces at 1°/day: 0° Aries (exaltation) on day 10.
  const { data, startJd } = sunFixture((d) => 350 + d);
  const geo = computeEphemerisGeometry(1200, 800, "longitude", measure, style);
  const camera = { startJd, spanDays: 28 };
  const sunScene: EphemerisScene = {
    ...scene,
    planets: [{ id: 0, glyph: "S", color: "#123456" }],
    visible: { 0: true },
    showLunations: false,
    inkMode: "dignity",
    dignityBySign: { 0: SUN_DIGNITY_EXALTED },
  };
  const { ctx, strokes, texts } = recordingContext();
  paintEphemerisPlot({ ctx, width: 1200, height: 800, dpr: 2 }, geo, camera, data, sunScene, style, measure);
  const curves = strokes.filter((s) => s.width === style.strokes.curveWidthSun);
  const xIngress = geo.xOrig + 10 * (geo.plotWidth / 28);
  const peregrine = curves.find((s) => s.color === "#444444");
  const exalted = curves.find((s) => s.color === "#886600");
  expect(peregrine && exalted).toBeTruthy();
  // Pisces runs to the bottom edge at the ingress; Aries starts on the top rule there.
  const lastPisces = peregrine!.ops.filter((op) => op[1] <= xIngress + 1e-6).at(-1)!;
  expect(lastPisces[1]).toBeCloseTo(xIngress, 6);
  expect(lastPisces[2]).toBeCloseTo(geo.yBottom, 6);
  const firstAries = exalted!.ops[0];
  expect(firstAries[0]).toBe("M");
  expect(firstAries[1]).toBeCloseTo(xIngress, 6);
  expect(firstAries[2]).toBeCloseTo(geo.yTop, 6);
  // Edge labels name the sign on each side: Pisces below, Aries above, in that sign's colour.
  const inBands = (y: number) => y < geo.yTop || (y > geo.yBottom && y < geo.rulerY);
  const edge = texts.filter((t) => Math.abs(t.x - xIngress) <= 0.5 && inBands(t.y));
  expect(edge.map((t) => [t.text, t.fill]).sort()).toEqual([["S", "#444444"], ["S", "#886600"], ["g0", "#886600"], ["g11", "#444444"]]);
  // The start label: Sun in Pisces in the gutter, in its Pisces colour.
  expect(texts.filter((t) => Math.abs(t.x - geo.gutterX) <= 0.5).map((t) => [t.text, t.fill])).toEqual([["S", "#444444"]]);

  // Hover is local and calm: the hovered curve keeps its own colour runs and
  // labels and only gains weight; nothing dims, and another planet's hover
  // leaves this curve exactly as it was.
  const lit = recordingContext();
  paintEphemerisPlot({ ctx: lit.ctx, width: 1200, height: 800, dpr: 2 }, geo, camera, data, { ...sunScene, highlightPlanetId: 0 }, style, measure);
  expect(lit.strokes.every((s) => s.alpha === 1)).toBe(true);
  expect(lit.strokes.filter((s) => s.width === style.strokes.curveWidthHighlight).map((s) => [s.color, s.ops]))
    .toEqual(curves.map((s) => [s.color, s.ops]));
  expect(lit.texts).toEqual(texts);
  const other = recordingContext();
  paintEphemerisPlot({ ctx: other.ctx, width: 1200, height: 800, dpr: 2 }, geo, camera, data, { ...sunScene, highlightPlanetId: 4 }, style, measure);
  expect(other.strokes).toEqual(strokes);
  expect(other.texts).toEqual(texts);

  // Two-tier ink: a single run per pass, same wrap.
  const one = recordingContext();
  paintEphemerisPlot({ ctx: one.ctx, width: 1200, height: 800, dpr: 2 }, geo, camera, data, { ...sunScene, inkMode: "tiers" }, style, measure);
  expect(one.strokes.filter((s) => s.width === style.strokes.curveWidthSun).map((s) => s.color)).toEqual(["#111111"]);
});

test("several wraps in one step at 30° and edge labels de-collide or drop", () => {
  const style = inkStyle();
  const measure = (t: string, size: number) => t.length * size * 0.6;
  // 40°/day: every sample step crosses one or two multiples of 30.
  const { data, startJd } = sunFixture((d) => 5 + d * 40);
  const geo = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 30);
  const camera = { startJd, spanDays: 28 };
  const fast: EphemerisScene = { ...scene, planets: [{ id: 0, glyph: "S", color: "#123456" }], visible: { 0: true }, showLunations: false, modulus: 30 };
  const { ctx, strokes } = recordingContext();
  paintEphemerisPlot({ ctx, width: 1200, height: 800, dpr: 1 }, geo, camera, data, fast, style, measure);
  const curve = strokes.find((s) => s.width === style.strokes.curveWidthSun)!;
  // Every point stays inside the plot; each wrap ends on an edge and restarts on the other.
  expect(curve.ops.every((op) => op[2] >= geo.yTop - 1e-6 && op[2] <= geo.yBottom + 1e-6)).toBe(true);
  const restarts = curve.ops.filter((op, i) => op[0] === "M" && i > 0);
  expect(restarts.length).toBeGreaterThan(28);
  expect(restarts.every((op) => Math.abs(op[2] - geo.yTop) < 1e-6)).toBe(true);

  const labels = [10, 12, 30, 31, 32, 60].map((x) => ({ x, px: x }));
  const placed = placeEdgeLabels(labels, 5, 7.5, 0, 100);
  expect(placed.map((l) => l.px)).toEqual([10, 15, 30, 35, 60]);
});

test("mirrored plate puts ruler left, labels and table right, labelled at the latest date", () => {
  const style = createEphemerisRenderStyle();
  const measure = (text: string, size: number) => text.length * size * 0.6;
  const normal = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 45);
  const mirrored = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 45, true);
  expect(normal.tableInner).toBeLessThan(normal.xOrig);
  expect(normal.rulerInner).toBe(normal.plotRight);
  expect(normal.rulerDir).toBe(1);
  expect(mirrored.rulerInner).toBe(mirrored.xOrig);
  expect(mirrored.rulerDir).toBe(-1);
  expect(mirrored.plotRight).toBeLessThan(mirrored.gutterX);
  expect(mirrored.gutterX).toBeLessThan(mirrored.tableInner);
  expect(mirrored.tableRight).toBeCloseTo(mirrored.plateRight, 6);
  // Same plot width either way: the columns only swap sides.
  expect(mirrored.plotWidth).toBeCloseTo(normal.plotWidth, 6);
  const camera = { startJd: 2461000.5, spanDays: 365 };
  expect(ephemerisLabelJd(normal, camera)).toBe(2461000.5);
  expect(ephemerisLabelJd(mirrored, camera)).toBe(2461365.5);
});

// --- Declination decan limbs (commit 648eb8d0 design) ----------------------

const TROPICAL_SIGN_RANGES: Array<[number, number]> = [
  [0, 11.47], [11.47, 20.15], [20.15, 23.44], [20.15, 23.44], [11.47, 20.15], [0, 11.47],
  [-11.47, 0], [-20.15, -11.47], [-23.44, -20.15], [-23.44, -20.15], [-20.15, -11.47], [-11.47, 0],
];

function declinationFixture(scale: unknown) {
  const b64 = (values: number[]) => Buffer.from(new Float64Array(values).buffer).toString("base64");
  const index = 2026 * 12;
  const days = monthIndexDays(index);
  const startJd = monthIndexStartJd(index);
  const blocks = decodeEphemerisBlocks({
    dataKey: "k",
    planetIds: [0],
    blocks: [{
      year: 2026, month: 1, startJd, days,
      longitude: b64(Array.from({ length: days }, (_, d) => 280 + d)),
      declination: b64(Array.from({ length: days }, () => -20)),
      signEvents: [], outOfBounds: [], declinationStations: [], lunations: [],
      ...(scale === undefined ? {} : { declinationScale: scale }),
    }],
  });
  return { data: { dataKey: "k", blocks, stationYears: [] }, startJd };
}

test("declination table holds signed figures and the decan limb; sign bands widen it", () => {
  const style = inkStyle();
  const measure = (t: string, size: number) => t.length * size * 0.6;
  const geo = computeEphemerisGeometry(1200, 800, "declination", measure, style);
  expect(geo.limbWidth).toBeCloseTo(geo.spaceSize * style.layout.limbWidthSpaces, 6);
  expect(geo.declSignWidth).toBe(0);
  expect(geo.tableRight - geo.tableLeft).toBeCloseTo(geo.declFigureWidth + geo.limbWidth, 6);
  const withSigns = computeEphemerisGeometry(1200, 800, "declination", measure, style, 360, false, true);
  expect(withSigns.declSignWidth).toBeGreaterThan(0);
  expect(withSigns.tableRight - withSigns.tableLeft).toBeCloseTo(geo.declFigureWidth + geo.limbWidth + withSigns.declSignWidth, 6);
  // Longitude keeps its tables; sign bands only apply to declination.
  const lon = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 360, false, true);
  expect([lon.limbWidth, lon.declFigureWidth, lon.declSignWidth]).toEqual([0, 0, 0]);
});

test("declination chrome: figures beside the table limb, zebra limbs both sides, dashed equator", () => {
  const style = inkStyle();
  const measure = (t: string, size: number) => t.length * size * 0.6;
  const declScene: EphemerisScene = { ...scene, mode: "declination", showGrid: false };
  for (const mirrored of [false, true]) {
    const geo = computeEphemerisGeometry(1200, 800, "declination", measure, style, 360, mirrored);
    const { ctx, strokes, texts } = recordingContext();
    paintEphemerisChrome({ ctx, width: 1200, height: 800, dpr: 2 }, geo, { ...declScene, mirrored }, style);
    const figures = texts.filter((t) => /^[+-]?\d+$/.test(t.text));
    expect(figures.map((t) => t.text)).toEqual(["-30", "-20", "-10", "0", "+10", "+20", "+30"]);
    for (const figure of figures) {
      // The ±30 end figures hang one space inside the plot edge.
      const decl = Number(figure.text);
      const hang = Math.abs(decl) === 30 ? Math.sign(decl) * geo.spaceSize : 0;
      expect(figure.y).toBeCloseTo(mapEphemerisY(geo, "declination", decl) + hang, 0);
      // Outside the table's limb, inside the table.
      if (mirrored) expect(figure.x).toBeGreaterThanOrEqual(geo.tableInner + geo.limbWidth);
      else expect(figure.x).toBeLessThanOrEqual(geo.tableInner - geo.limbWidth);
    }
    // Graduations grow from both limb inner edges: the table side and the ruler side.
    const tickXs = (edge: number) =>
      strokes.filter((s) => s.ops.some(([, x]) => Math.abs(x - edge) < 1)).length;
    expect(tickXs(geo.tableInner)).toBeGreaterThan(0);
    expect(tickXs(geo.rulerInner)).toBeGreaterThan(0);
    // The equator: dashed in the frame colour across the whole plot.
    const y0 = mapEphemerisY(geo, "declination", 0);
    const equator = strokes.filter((s) => s.color === style.colors.frame && s.ops.length === 2 && Math.abs(s.ops[0][2] - y0) < 1
      && Math.abs(s.ops[0][1] - geo.xOrig) < 1 && Math.abs(s.ops[1][1] - geo.plotRight) < 1);
    expect(equator.length).toBe(1);
    // Off: no rule through the plot at 0.
    const off = recordingContext();
    paintEphemerisChrome({ ctx: off.ctx, width: 1200, height: 800, dpr: 2 }, geo, { ...declScene, mirrored, showEquator: false }, style);
    expect(off.strokes.filter((s) => s.ops.length === 2 && Math.abs(s.ops[0][2] - y0) < 1
      && Math.abs(s.ops[0][1] - geo.xOrig) < 1 && Math.abs(s.ops[1][1] - geo.plotRight) < 1)).toHaveLength(0);
  }
});

test("declination plot: out-of-bounds range and sign bands read the block's declination scale", () => {
  const style = inkStyle();
  const measure = (t: string, size: number) => t.length * size * 0.6;
  const scale = { limit: 23.44, signRanges: TROPICAL_SIGN_RANGES };
  const { data, startJd } = declinationFixture(scale);
  expect(data.blocks[0].declinationScale).toEqual(scale);
  const geo = computeEphemerisGeometry(1200, 800, "declination", measure, style, 360, false, true);
  const camera = { startJd, spanDays: 28 };
  const declScene: EphemerisScene = { ...scene, mode: "declination", planets: [{ id: 0, glyph: "S", color: "#123456" }], visible: { 0: true }, showLunations: false };
  const limitRules = (strokes: ReturnType<typeof recordingContext>["strokes"]) =>
    strokes.filter((s) => s.color === style.colors.outOfBounds && s.ops.length === 2
      && [23.44, -23.44].some((v) => Math.abs(s.ops[0][2] - mapEphemerisY(geo, "declination", v)) < 1));

  const off = recordingContext();
  paintEphemerisPlot({ ctx: off.ctx, width: 1200, height: 800, dpr: 2 }, geo, camera, data, declScene, style, measure);
  expect(limitRules(off.strokes)).toHaveLength(0);
  expect(off.texts.filter((t) => /^g\d+g\d+$/.test(t.text))).toHaveLength(0);

  const on = recordingContext();
  paintEphemerisPlot({ ctx: on.ctx, width: 1200, height: 800, dpr: 2 }, geo, camera, data,
    { ...declScene, showOutOfBoundsRange: true, showSignBands: true }, style, measure);
  // ±limit on the table, the ruler limb and dashed through the plot.
  expect(limitRules(on.strokes).length).toBe(6);
  // Six bands, each naming the two signs that reach it, north to south.
  expect(on.texts.filter((t) => /^g\d+g\d+$/.test(t.text)).map((t) => t.text))
    .toEqual(["g2g3", "g1g4", "g0g5", "g6g11", "g7g10", "g8g9"]);

  // No scale in the block: nothing to rule.
  const bare = declinationFixture(undefined);
  expect(bare.data.blocks[0].declinationScale).toBeNull();
  const none = recordingContext();
  paintEphemerisPlot({ ctx: none.ctx, width: 1200, height: 800, dpr: 2 }, geo, camera, bare.data,
    { ...declScene, showOutOfBoundsRange: true, showSignBands: true }, style, measure);
  expect(limitRules(none.strokes)).toHaveLength(0);
});

test("reading line: signal hairline fixed at the plot centre, date tag on the axis, header at its date", () => {
  const style = inkStyle();
  const measure = (t: string, size: number) => t.length * size * 0.6;
  const { data, startJd } = sunFixture((d) => 350 + d);
  const geo = computeEphemerisGeometry(1200, 800, "longitude", measure, style);
  const headerJds: number[] = [];
  const lineScene: EphemerisScene = {
    ...scene,
    planets: [{ id: 0, glyph: "S", color: "#123456" }],
    visible: { 0: true },
    showLunations: false,
    showNowLine: true,
    nowLineLabel: (jd) => `line ${jd}`,
    headerText: (jd) => {
      headerJds.push(jd);
      return "header";
    },
  };
  const centreX = geo.xOrig + geo.plotWidth / 2;
  const lineStrokes = (strokes: ReturnType<typeof recordingContext>["strokes"]) =>
    strokes.filter((s) => s.color === style.colors.accent && s.width === style.now.nowLineWidth);
  for (const camera of [{ startJd, spanDays: 28 }, { startJd: startJd + 3.5, spanDays: 20 }]) {
    const { ctx, strokes, texts } = recordingContext();
    paintEphemerisPlot({ ctx, width: 1200, height: 800, dpr: 2 }, geo, camera, data, lineScene, style, measure);
    const [line] = lineStrokes(strokes);
    expect(line).toBeTruthy();
    expect(line.alpha).toBe(style.now.nowLineOpacity);
    // The same x whatever the camera: the plate slides under the line.
    expect(Math.abs(line.ops[0][1] - centreX)).toBeLessThanOrEqual(0.5);
    expect(line.ops[0][2]).toBeCloseTo(geo.yTop, 0);
    const centreJd = camera.startJd + camera.spanDays / 2;
    const tag = texts.find((t) => t.text === `line ${centreJd}`);
    expect(tag?.fill).toBe(style.colors.accent);
    expect(tag!.y).toBeGreaterThan(geo.rulerY);
    expect(headerJds.at(-1)).toBe(centreJd);
  }
  // Off: no line, no tag, the header names the left edge.
  const off = recordingContext();
  paintEphemerisPlot({ ctx: off.ctx, width: 1200, height: 800, dpr: 2 }, geo, { startJd, spanDays: 28 }, data, { ...lineScene, showNowLine: false }, style, measure);
  expect(lineStrokes(off.strokes)).toEqual([]);
  expect(off.texts.some((t) => t.text.startsWith("line "))).toBe(false);
  expect(headerJds.at(-1)).toBe(startJd);
});

test("reading line glyphs sit on the planet contacts' round paper knock-out", () => {
  const style = inkStyle();
  const measure = (t: string, size: number) => t.length * size * 0.6;
  const { startJd } = sunFixture((d) => 350 + d);
  const geo = computeEphemerisGeometry(1200, 800, "longitude", measure, style);
  const camera = { startJd, spanDays: 28 };
  const point = (key: string, kind: string, lon: number, glyphs: string[], fonts: ("morinus" | "text")[]): EphemerisRadixPoint => ({
    key, kind, lon, glyphs, glyphFonts: fonts, glyphColors: glyphs.map(() => "#aa0000"), glyphColorRoles: glyphs.map(() => null),
    label: key, defaultVisible: true,
  });
  const layer = {
    points: [point("sun", "body", 40, ["S"], ["morinus"]), point("asc", "angle", 200, ["Ascendant"], ["text"])],
    crossings: [],
    contacts: [{ jd: startJd + 10, lon: 120, a: 0, b: 1, aspect: 90 }],
  };
  type Shape = { arcs: Array<[number, number, number]>; fill: string; texts: Array<{ text: string; x: number; y: number; fill: string }> };
  const record = () => {
    const shapes: Shape[] = [];
    const rects: string[] = [];
    let arcs: Shape["arcs"] = [];
    const state = { fillStyle: "", globalAlpha: 1, font: "" };
    const stack: Array<typeof state> = [];
    const target: Record<string, unknown> = {
      save: () => stack.push({ ...state }),
      restore: () => Object.assign(state, stack.pop()),
      beginPath: () => { arcs = []; },
      arc: (x: number, y: number, r: number) => arcs.push([x, y, r]),
      fill: () => shapes.push({ arcs, fill: state.fillStyle, texts: [] }),
      fillRect: () => rects.push(state.fillStyle),
      fillText: (text: string, x: number, y: number) => shapes.at(-1)?.texts.push({ text, x, y, fill: state.fillStyle }),
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
    const ctx = new Proxy(target, {
      get: (t, prop: string) => (prop in state ? state[prop as keyof typeof state] : prop in t ? t[prop] : () => {}),
      set: (t, prop: string, value) => {
        if (prop in state) (state as Record<string, unknown>)[prop] = value;
        else t[prop] = value;
        return true;
      },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, shapes, rects };
  };
  const radixScene: EphemerisScene = { ...scene, showNowLine: true, showRadixReadingGlyphs: true };

  const contacts = record();
  paintEphemerisContacts({ ctx: contacts.ctx, width: 1200, height: 800, dpr: 2 }, geo, camera, layer, radixScene, style);
  const contactSize = geo.planetFontPx * style.radix.planetContactGlyphScale;
  expect(contacts.shapes[0].arcs).toHaveLength(1);
  expect(contacts.shapes[0].arcs[0][2]).toBeCloseTo(ephemerisKnockoutRadius(contactSize, style));

  const reading = record();
  paintEphemerisRadix({ ctx: reading.ctx, width: 1200, height: 800, dpr: 2 }, geo, camera, layer, radixScene, style);
  const size = geo.planetFontPx * style.radix.radixReadingGlyphScale;
  const r = ephemerisKnockoutRadius(size, style);
  const centreX = geo.xOrig + geo.plotWidth / 2;
  const marks = reading.shapes.filter((s) => s.fill === style.colors.paper && s.texts.length > 0);
  expect(marks.map((m) => m.texts[0].text)).toEqual(["S", "Ascendant"]);
  // No rectangular tags: the reading line marks are all round knock-outs.
  expect(reading.rects).toEqual([]);
  for (const mark of marks) {
    for (const [, , radius] of mark.arcs) expect(radius).toBeCloseTo(r);
    // Glyph in its own colour, vertically centred in the disc, just right of the line.
    expect(mark.texts[0].fill).not.toBe(style.colors.paper);
    expect(Math.abs(mark.texts[0].y - mark.arcs[0][1])).toBeLessThanOrEqual(0.5);
    expect(Math.min(...mark.arcs.map(([x]) => x)) - r).toBeGreaterThan(centreX);
  }
  // A single glyph: one disc centred on it. A wide written mark: a capsule
  // whose two round ends share the disc's radius and span the text.
  const [glyph, word] = marks;
  expect(glyph.arcs).toHaveLength(1);
  expect(word.arcs).toHaveLength(2);
  const wordWidth = "Ascendant".length * 7;
  expect(word.arcs[1][0] - word.arcs[0][0] + 2 * r).toBeCloseTo(wordWidth);
  expect(Math.abs(word.texts[0].x - ((word.arcs[0][0] + word.arcs[1][0]) / 2 - wordWidth / 2))).toBeLessThanOrEqual(0.5);
});

test("knock-out marks centre the glyph's ink box on a device-pixel-snapped disc", () => {
  // Pure math: a glyph whose ink sits right of and above its anchor.
  const ink = { left: -1, right: 9, ascent: 12, descent: -2 };
  const anchor = ephemerisCentredInkAnchor(50, 40, [{ advance: 10, ink }]);
  // Ink box x: anchor+1 .. anchor+9, y: anchor-12 .. anchor-2 -> centred on (50, 40).
  expect(anchor.x + (1 + 9) / 2).toBeCloseTo(50);
  expect(anchor.y + (-12 - 2) / 2).toBeCloseTo(40);
  expect(anchor.inkWidth).toBeCloseTo(8);
  // Two runs: the union of both ink boxes is centred.
  const pair = ephemerisCentredInkAnchor(0, 0, [
    { advance: 10, ink: { left: 0, right: 10, ascent: 8, descent: 0 } },
    { advance: 6, ink: { left: 0, right: 6, ascent: 10, descent: 2 } },
  ]);
  expect(pair.x).toBeCloseTo(-8);
  expect(pair.y).toBeCloseTo(4);
  expect(snapToDevicePixel(10.3, 2)).toBe(10.5);

  // The painter: disc centre snapped once, glyph ink centred on the same point.
  const style = inkStyle();
  const arcs: Array<[number, number, number]> = [];
  const texts: Array<{ x: number; y: number; align: string; baseline: string }> = [];
  const state: Record<string, unknown> = { font: "", fillStyle: "", textAlign: "start", textBaseline: "alphabetic" };
  const target: Record<string, unknown> = {
    beginPath: () => {},
    arc: (x: number, y: number, r: number) => arcs.push([x, y, r]),
    fill: () => {},
    closePath: () => {},
    measureText: () => ({ width: 10, actualBoundingBoxLeft: -1, actualBoundingBoxRight: 9, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: -2 }),
    fillText: (_t: string, x: number, y: number) => texts.push({ x, y, align: String(state.textAlign), baseline: String(state.textBaseline) }),
  };
  const ctx = new Proxy(target, {
    get: (t, prop: string) => (prop in state ? state[prop] : prop in t ? t[prop] : () => {}),
    set: (t, prop: string, value) => {
      if (prop in state) state[prop] = value;
      else t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  paintEphemerisKnockoutMark(ctx, style, 2, 100.3, 60.8, 14, [{ text: "ink-centring-probe", family: "AriesMorinus", size: 14, color: "#000" }]);
  expect(arcs).toHaveLength(1);
  const [cx, cy] = arcs[0];
  expect(cx).toBe(100.5);
  expect(cy).toBe(61);
  expect(texts[0].align).toBe("left");
  expect(texts[0].baseline).toBe("alphabetic");
  expect(texts[0].x + (1 + 9) / 2).toBeCloseTo(cx);
  expect(texts[0].y + (-12 - 2) / 2).toBeCloseTo(cy);
});
