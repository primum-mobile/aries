// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Per-frame cost of the Graphic Ephemeris moving layer (not part of test:unit).
// Node has no canvas here, so a counting 2D context stands in: the numbers
// are the pure geometry / decimation / tick-ladder path plus the draw-op
// count the browser would execute. Run:
//   npx playwright test tests/ephemeris-frame-bench.spec.ts --reporter=line

import { test } from "@playwright/test";

import { monthIndexDays, monthIndexStartJd, monthStartJd } from "../src/lib/chart/ephemeris-camera";
import { computeEphemerisGeometry } from "../src/lib/chart/ephemeris-geometry";
import { paintEphemerisPlot } from "../src/lib/chart/ephemeris-plot-paint";
import { createEphemerisRenderStyle, DEFAULT_EPHEMERIS_RENDER_PALETTE, resolveEphemerisInkColors } from "../src/lib/chart/ephemeris-render-style";
import type { EphemerisScene } from "../src/lib/chart/ephemeris-scene";
import { decodeEphemerisBlocks } from "../src/lib/chart/ephemeris-wire";

const PLANETS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15];
const SPEEDS = [0.9856, 13.18, 1.2, 1.1, 0.52, 0.083, 0.033, 0.0117, 0.006, 0.004, -0.053, 0.02];

function counting() {
  const counts: Record<string, number> = {};
  const ctx = new Proxy(
    { canvas: { width: 2400, height: 1600 }, font: "", measureText: (text: string) => ({ width: text.length * 7 }) } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        return () => {
          counts[prop] = (counts[prop] ?? 0) + 1;
        };
      },
      set(target, prop: string, value) {
        target[prop] = value;
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, counts };
}

function blocks(first: number, count: number) {
  const b64 = (values: number[]) => Buffer.from(new Float64Array(values).buffer).toString("base64");
  const wire = Array.from({ length: count }, (_, k) => {
    const index = first + k;
    const days = monthIndexDays(index);
    const startJd = monthIndexStartJd(index);
    const lon: number[] = [];
    const decl: number[] = [];
    PLANETS.forEach((_, p) => {
      for (let d = 0; d < days; d++) {
        const t = startJd + d - 2451545;
        lon.push((((p * 37 + t * SPEEDS[p] + 3 * Math.sin(t / 58 + p)) % 360) + 360) % 360);
        decl.push(23.4 * Math.sin((t * SPEEDS[p] * Math.PI) / 180 + p));
      }
    });
    return {
      year: Math.floor(index / 12), month: (index % 12) + 1, startJd, days,
      longitude: b64(lon), declination: b64(decl),
      signEvents: [], declinationStations: [], outOfBounds: [],
      lunations: [
        { kind: "new", jd: startJd + 5, longitude: 10, declination: 2, date: "" },
        { kind: "full", jd: startJd + 20, longitude: 190, declination: -2, date: "" },
      ],
    };
  });
  return decodeEphemerisBlocks({ dataKey: "bench", planetIds: PLANETS, blocks: wire });
}

test("frame cost at 1 month, 12 months and 10 years with all bodies", () => {
  // Distinct dignity colours, so "chart" splits every curve into colour runs.
  const dignityCss = new Map([
    ["--morinus-dignity-domicil", "#008800"], ["--morinus-dignity-exal", "#886600"],
    ["--morinus-dignity-exil", "#cc0000"], ["--morinus-dignity-casus", "#880088"], ["--morinus-peregrin", "#444444"],
  ]);
  const style = createEphemerisRenderStyle({
    colors: resolveEphemerisInkColors(DEFAULT_EPHEMERIS_RENDER_PALETTE, (name) => dignityCss.get(name) ?? ""),
  });
  const measure = (text: string, size: number) => Math.round(text.length * size * 0.6);
  const geo = computeEphemerisGeometry(1200, 800, "longitude", measure, style);
  const geo30 = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 30);
  const scene: EphemerisScene = {
    mode: "longitude",
    planets: PLANETS.map((id) => ({ id, glyph: "x", color: "#888" })),
    visible: Object.fromEntries(PLANETS.map((id) => [id, true])),
    signGlyphs: Array(12).fill("s"), signNames: Array(12).fill("n"),
    monthLabels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    showGrid: true, showEventGlyphs: true, showLunations: true,
    lunationLabels: { new: "N", full: "F" }, outOfBoundsLabel: "OOB",
    modulus: 360, inkMode: "dignity", highlightPlanetId: null, usePlanetColors: false,
    dignityBySign: Object.fromEntries(PLANETS.map((id) => [id, Array.from({ length: 12 }, (_, s) => (["domicile", "exaltation", "detriment", "fall", "peregrine"] as const)[(s + id) % 5])])),
    headerText: () => "header",
  };
  const rows: string[] = [];
  for (const [label, months] of [["1 month", 1], ["12 months", 12], ["10 years", 120]] as const) {
    const first = 2026 * 12;
    const data = { dataKey: "bench", blocks: blocks(first, months + 1), stationYears: [] };
    const camera = { startJd: monthStartJd(2026, 1) + 0.37, spanDays: monthIndexStartJd(first + months) - monthIndexStartJd(first) };
    for (const [mode, modulus, inkMode] of [
      ["longitude", 360, "tiers"], ["longitude", 360, "dignity"], ["longitude", 30, "dignity"], ["declination", 360, "dignity"],
    ] as const) {
      const sceneMode: EphemerisScene = { ...scene, mode, modulus, inkMode };
      const { ctx, counts } = counting();
      const surface = { ctx, width: 1200, height: 800, dpr: 2 };
      const g = modulus === 30 ? geo30 : geo;
      for (let i = 0; i < 20; i++) paintEphemerisPlot(surface, g, camera, data, sceneMode, style, measure);
      for (const key of Object.keys(counts)) delete counts[key];
      const frames = 200;
      const started = performance.now();
      let stats = { curvePoints: 0, samples: 0 };
      for (let i = 0; i < frames; i++) {
        stats = paintEphemerisPlot(surface, g, { ...camera, startJd: camera.startJd + i * 0.01 }, data, sceneMode, style, measure);
      }
      const ms = (performance.now() - started) / frames;
      const ops = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.round(v / frames)]));
      rows.push(
        `${label.padEnd(10)} ${mode.padEnd(11)} ${String(modulus).padEnd(3)} ${inkMode.padEnd(5)} ${ms.toFixed(3)} ms/frame  samples ${stats.samples}  path points ${stats.curvePoints}  ` +
          `lineTo ${ops.lineTo ?? 0} moveTo ${ops.moveTo ?? 0} stroke ${ops.stroke ?? 0} fillText ${ops.fillText ?? 0} arc ${ops.arc ?? 0}`,
      );
    }
  }
  console.log(`\n${rows.join("\n")}`);
});
