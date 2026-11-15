// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris hover -> Inspector: a snapped body becomes the same
// hovered-region the wheel writes, carrying the hovered moment, while the
// plate keeps its own flag.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { build } from "esbuild";

import { ephemerisInspectorRegion } from "../src/lib/chart/ephemeris-inspector-region.ts";

const bundle = await build({
  stdin: { contents: "export {hitTestEphemerisBody, ephemerisDayJd} from './src/lib/chart/ephemeris-body-hit';", resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
});
const { hitTestEphemerisBody, ephemerisDayJd } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);

const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

const station = { x: 10, y: 20, jd: 2461234.75, planet: 4, value: 123.5, info: { date: "Jan 1" } };

test("a snapped body is that planet at the hovered moment on the outer ring", () => {
  assert.deepEqual(ephemerisInspectorRegion(station, "ephem-1", "longitude"), {
    kind: "planet",
    planetId: "mars",
    seId: 4,
    longitude: 123.5,
    latitude: 0,
    speed: 0,
    chartRole: "outer",
    atJd: 2461234.75,
    viewDocumentId: "ephem-1",
  });
  assert.equal(ephemerisInspectorRegion({ ...station, planet: 1 }, "e", "declination").longitude, 0);
  assert.equal(ephemerisInspectorRegion({ ...station, planet: 15 }, "e", "longitude").planetId, "chiron");
});

test("the free readout and unknown bodies name no region", () => {
  assert.equal(ephemerisInspectorRegion(null, "e", "longitude"), null);
  assert.equal(ephemerisInspectorRegion({ ...station, planet: undefined }, "e", "longitude"), null);
  assert.equal(ephemerisInspectorRegion({ ...station, planet: 99 }, "e", "longitude"), null);
});

test("snapped hits carry the body; the view feeds the shared hovered region", async () => {
  const hitTest = await read("lib/chart/ephemeris-hit-test.ts");
  assert.equal((hitTest.match(/planet: snapped\.planet,/g) ?? []).length, 2);

  const view = await read("components/workshell/graph-ephemeris-view.tsx");
  assert.match(view, /useFrameLayoutStore\.getState\(\)\.inspectorOpen \? inspectorRegionAt\(hit, clientX, clientY\) : null;/);
  assert.match(view, /const body = ephemerisInspectorRegion\(/);
  assert.match(view, /if \(currentKey === key\) return;/);
  assert.match(view, /if \(region \|\| own\) \{\n\s*ownHoverKeyRef\.current = key;\n\s*workspace\.setHoveredRegion\(region\);/);
  // Every flag update also follows the Inspector.
  const flagUpdates = view.match(/showHover\(hit \? hoverOf\(hit\) : null\);\n\s*followInspector\(hit, (pointer\.x, pointer\.y|e\.clientX, e\.clientY)\);/g) ?? [];
  assert.equal(flagUpdates.length, 2);
  assert.match(view, /showHover\(null\);\n\s*followInspector\(null\);/);
});

test("the hovered moment reaches the daemon and keys the inspector identity", async () => {
  const store = await read("stores/workspace-store.ts");
  assert.match(store, /`planet:\$\{region\.seId\}\$\{role\}\$\{ring\}\$\{region\.atJd != null \? `:at:\$\{region\.atJd\}` : ""\}`/);

  const client = await read("lib/daemon/client.ts");
  assert.equal((client.match(/if \(query\.atJd != null\) search\.set\("atJd", String\(query\.atJd\)\);/g) ?? []).length, 2);

  const panel = await read("components/workshell/inspector-panel.tsx");
  assert.match(panel, /ringIndex \?\? null,\n\s*atJd \?\? null,\n\s*locale,/);
  assert.match(panel, /const liveKey = canFetch && atJd == null && docId/);
  assert.match(panel, /deferSignals,\n\s*atJd,\n\s*\},/);
  assert.match(panel, /ringIndex, atJd \?\? null, locale, packsVersion\]/);
});

// A 30-day plate: 1 px per day from x=100, longitude 0..360 over y=0..360;
// start labels in the gutter from x=80.
const START = 2461000.5;
const geo = { plotWidth: 30, xOrig: 100, plotRight: 130, gutterX: 80, yTop: 0, yBottom: 360, plotHeight: 360, modulus: 360, planetFontPx: 10, spaceSize: 2 };
const camera = { startJd: START, spanDays: 30 };
const style = { labels: { startLabelGapScale: 1, startSignOffsetScale: 1 }, interaction: { stationSnapY: 6 } };
const row = (from, perDay) => Float64Array.from({ length: 31 }, (_, i) => from + perDay * i);
const data = {
  blocks: [{
    startJd: START, days: 31, monthIndex: 0,
    rows: new Map([
      [0, { longitude: row(100, 1), declination: row(0, 0) }],
      [4, { longitude: row(200, 0.5), declination: row(0, 0) }],
    ]),
  }],
  stationYears: [],
};
const scene = { mode: "longitude", modulus: 360, planets: [{ id: 0, glyph: "a" }, { id: 4, glyph: "e" }], visible: { 0: true, 4: true } };

test("the nearest curve at the pointer's date is that planet on that day", () => {
  // x=110.4 -> day 10.4 -> Sun at 110.4°, Mars at 205.2°; quantized to day 10.
  const sun = hitTestEphemerisBody(110.4, 112, camera, geo, data, scene, style);
  assert.deepEqual(sun, { planet: 0, jd: START + 10, value: 110 });
  assert.equal(hitTestEphemerisBody(110.4, 203, camera, geo, data, scene, style).planet, 4);
  assert.equal(hitTestEphemerisBody(110.4, 160, camera, geo, data, scene, style), null);
  // Moving within one day keeps the same moment: no new Inspector request.
  assert.equal(hitTestEphemerisBody(110.1, 110, camera, geo, data, scene, style).jd, hitTestEphemerisBody(110.45, 110, camera, geo, data, scene, style).jd);
  assert.equal(ephemerisDayJd(START + 10.49), START + 10);
});

test("a folded curve is found across the plot edge in a harmonic modulus", () => {
  // Modulus 90 over 360 px: 4 px per degree. Mars at day 10 is 205°, 25° in
  // the modulus (y 100); the Sun at day 20 is 120°, 30° (y 120).
  const harmonic = { ...scene, modulus: 90 };
  assert.equal(hitTestEphemerisBody(110, 101, camera, geo, data, harmonic, style).planet, 4);
  assert.equal(hitTestEphemerisBody(120, 119, camera, geo, data, harmonic, style).planet, 0);
  const edge = { ...data, blocks: [{ ...data.blocks[0], rows: new Map([[0, { longitude: row(89.9, 0), declination: row(0, 0) }]]) }] };
  // 89.9° folds to y 359.6 at the bottom edge; a pointer at y 1 is 1.4 px away across the wrap.
  assert.equal(hitTestEphemerisBody(110, 1, camera, geo, edge, harmonic, style).planet, 0);
});

test("a start label is its planet at the left-edge moment", () => {
  // Labels sit in the gutter at x 80, at the left-edge values (Sun 100, Mars 200).
  const label = hitTestEphemerisBody(83, 100, camera, geo, data, scene, style);
  assert.equal(label.planet, 0);
  assert.equal(label.jd, ephemerisDayJd(START));
  assert.equal(hitTestEphemerisBody(83, 201, camera, geo, data, scene, style).planet, 4);
  assert.equal(hitTestEphemerisBody(83, 150, camera, geo, data, scene, style), null);
});

test("the painter and the hit test share one start-label layout", async () => {
  const paint = await read("lib/chart/ephemeris-plot-paint.ts");
  assert.match(paint, /= ephemerisStartLabels\(geo, style, data, scene, ephemerisLabelJd\(geo, camera\)\);/);
  const hit = await read("lib/chart/ephemeris-body-hit.ts");
  assert.match(hit, /const labelJd = ephemerisLabelJd\(geo, camera\);\s*const start = ephemerisStartLabels\(geo, style, data, scene, labelJd\)/);
  const view = await read("components/workshell/graph-ephemeris-view.tsx");
  assert.match(view, /hit\?\.planet != null \|\| clientX == null \|\| clientY == null \? hit : bodyAt\(clientX, clientY\)/);
});
