// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Save as image and chart export paint the plate on screen: the live frame's
// own plate paint, geometry, scene, style and radix layer, at the live
// device-pixel size, without the hover highlight.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents:
      "export {ephemerisChromeInputs, ephemerisExportScene, sameEphemerisChromeInputs} from './src/lib/chart/ephemeris-plate-paint';" +
      "export {computeEphemerisGeometry} from './src/lib/chart/ephemeris-geometry';" +
      "export {resolveEphemerisRenderStyle} from './src/lib/chart/ephemeris-render-style';" +
      "export {EphemerisRadixStore} from './src/lib/chart/ephemeris-radix';" +
      "export {EphemerisBlockStore} from './src/lib/chart/ephemeris-block-store';",
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
});
const { ephemerisChromeInputs, ephemerisExportScene, sameEphemerisChromeInputs, EphemerisRadixStore, EphemerisBlockStore, computeEphemerisGeometry, resolveEphemerisRenderStyle } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);

const view = await readFile(new URL("../src/components/workshell/graph-ephemeris-view.tsx", import.meta.url), "utf8");
const body = (name) => {
  const start = view.indexOf(`const ${name} = React.useCallback(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = view.indexOf("\n  }, [", start);
  return view.slice(start, end);
};

test("live frame and export share one plate paint and geometry call", () => {
  for (const painter of ["paintEphemerisChrome(", "paintEphemerisPlot(", "paintEphemerisRadix(", "computeEphemerisGeometry("]) {
    assert.equal(view.includes(painter), false, `${painter} is called only through ephemeris-plate-paint`);
  }
  const frame = view.slice(view.indexOf("frameRef.current = () => {"), view.indexOf("recordEphemerisFrame(started);"));
  assert.match(frame, /ephemerisChromeInputs\(size, style, currentScene\)/);
  assert.match(frame, /ephemerisPlateGeometry\(size, currentScene, style, measure\)/);
  assert.match(frame, /paintEphemerisPlate\(/);
  const compose = body("composeImage");
  // Same live size (device pixels), scene, style, text measure and radix inputs.
  assert.match(compose, /sizeRef\.current/);
  assert.match(compose, /sceneRef\.current/);
  assert.match(compose, /styleRef\.current/);
  assert.match(compose, /measureRef\.current/);
  assert.match(compose, /fitCanvas\(out, size\)/);
  assert.match(compose, /ephemerisExportScene\(liveScene\)/);
  assert.match(compose, /geoRef\.current/);
  assert.match(compose, /ephemerisPlateGeometry\(size, currentScene, style, measure\)/);
  assert.match(compose, /paintEphemerisPlate\(base, top,/);
  assert.match(compose, /radixLayerFor\(currentScene, camera\)/);
});

test("Save as image and chart export wait for the same resident data", () => {
  const settled = body("composeSettledImage");
  assert.match(settled, /ephemerisStore\.whenResident/);
  assert.match(settled, /radixStore\.ready\(radixYearsOf\(camera\)\)/);
  assert.match(body("savePng"), /await composeSettledImage\(\)/);
  assert.match(view, /registerChartExportRenderer\(documentId, async \(request\) => \{\s*const image = await composeSettledImage\(\);/);
  // File -> Export keeps the pane's shape: no square page, no letterbox.
  assert.match(view, /renderCanvasChartExport\(image, request, "source"\)/);
});

test("an export drops the pointer's highlight and keeps every other scene field", () => {
  const planets = [];
  const scene = Object.freeze({ mode: "longitude", modulus: 90, mirrored: true, inkMode: "dignity", planets, highlightPlanetId: 4 });
  const exported = ephemerisExportScene(scene);
  assert.equal(exported.highlightPlanetId, null);
  for (const key of ["mode", "modulus", "mirrored", "inkMode", "planets"]) assert.equal(exported[key], scene[key]);
  const plain = { ...scene, highlightPlanetId: null };
  assert.equal(ephemerisExportScene(plain), plain, "nothing to drop: the live scene itself");
  // A hovered or pinned natal line is pointer state too.
  const focused = ephemerisExportScene({ ...plain, radixFocusKey: "saturn", showRadixBands: true });
  assert.equal(focused.radixFocusKey, null);
  assert.equal(focused.showRadixBands, true);
});

test("the retained geometry is reused only for the same chrome inputs", () => {
  const style = {};
  const signGlyphs = ["a"];
  const scene = { mode: "declination", showGrid: true, signGlyphs, modulus: 360, mirrored: false, showEquator: true, showSignBands: true, showRadix: false };
  const size = { w: 800, h: 500, dpr: 2 };
  const live = ephemerisChromeInputs(size, style, scene);
  assert.equal(sameEphemerisChromeInputs(live, ephemerisChromeInputs({ ...size }, style, { ...scene, highlightPlanetId: 3 })), true);
  assert.equal(sameEphemerisChromeInputs(live, ephemerisChromeInputs(size, style, { ...scene, mirrored: true })), false);
  assert.equal(sameEphemerisChromeInputs(live, ephemerisChromeInputs(size, {}, scene)), false, "another style object");
  assert.equal(sameEphemerisChromeInputs(live, ephemerisChromeInputs({ ...size, dpr: 1 }, style, scene)), false);
  assert.equal(sameEphemerisChromeInputs(null, live), false);
});

test("radix store ready() settles once the wanted years load", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loader = new EphemerisBlockStore({ fetchBlocks: () => new Promise(() => {}), fetchStationYear: () => new Promise(() => {}) });
  const store = new EphemerisRadixStore(loader, "radix:doc", async () => {
    await gate;
    return { year: 2026, rows: [] };
  });
  store.setKey("k");
  let done = false;
  const ready = store.ready([2026]).then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  release();
  await ready;
  assert.equal(done, true);
  await store.ready([]);
});

test("a source-framed PNG is the plate's own pixels under the watermark band", async () => {
  const registry = await readFile(new URL("../src/lib/chart/chart-export-registry.ts", import.meta.url), "utf8");
  assert.match(registry, /frame: CanvasExportFrame = "square"/);
  assert.match(registry, /canvas\.width = squarePng \? PNG_EXPORT_PIXEL_SIZE : sourceWidth;/);
  assert.match(registry, /canvas\.height = squarePng \? PNG_EXPORT_PIXEL_SIZE : sourceHeight \+ sourceHeader;/);
});

test("the modality table hugs its figures and the start gutter its widest label", () => {
  const style = resolveEphemerisRenderStyle(null);
  // Figures 0.5 em per character; symbol glyphs 0.8 em each.
  const measure = (text, size, font) => [...text].length * size * (font === style.typography.fontSymbols ? 0.8 : 0.5);
  const glyphs = { planets: ["A", "B", "CC"], signs: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"] };
  const geo = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 45, false, false, false, glyphs);
  const u = geo.planetFontPx;
  const s = geo.spaceSize;
  const figure = 2 * geo.tableFontPx * 0.5 + s * style.layout.modalityCellPadSpaces;
  const pair = 2 * geo.modalityGlyphPx * 0.8 + s;
  assert.ok(Math.abs(geo.tableRight - geo.tableLeft - 3 * Math.max(figure, pair)) < 1e-9, "three hugging columns");
  const label = Math.max(2 * u * 0.8, u * style.labels.startSignOffsetScale + geo.startSignFontPx * 0.8);
  const gutter = label + 2 * s * style.layout.startGutterPadSpaces;
  assert.ok(Math.abs(geo.xOrig - geo.tableRight - gutter) < 1e-9, "gutter = widest label pair + a space each side");
  assert.equal(geo.gutterX, geo.tableRight + s * style.layout.startGutterPadSpaces);
  // Mirrored: the same widths on the other side.
  const mirrored = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 45, true, false, false, glyphs);
  assert.ok(Math.abs((mirrored.tableRight - mirrored.tableLeft) - (geo.tableRight - geo.tableLeft)) < 1e-9);
  assert.ok(Math.abs(mirrored.tableLeft - mirrored.plotRight - gutter) < 1e-9);
  assert.equal(mirrored.gutterX, mirrored.plotRight + s * style.layout.startGutterPadSpaces);
  // 360° keeps its sign-glyph table; declination labels carry no sign.
  const geo360 = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 360, false, false, false, glyphs);
  assert.ok(Math.abs(geo360.tableRight - geo360.tableLeft - u * style.layout.signTableScale) < 1e-9);
  const decl = computeEphemerisGeometry(1200, 800, "declination", measure, style, 360, false, false, false, glyphs);
  assert.ok(Math.abs(decl.xOrig - decl.tableRight - (2 * u * 0.8 + 2 * s * style.layout.startGutterPadSpaces)) < 1e-9);
});

test("declination uses the plate's height: no empty wrap bands, quiet turn and out-of-bounds marks", async () => {
  const style = resolveEphemerisRenderStyle();
  const measure = (text, size) => text.length * size * 0.6;
  const decl = computeEphemerisGeometry(1200, 800, "declination", measure, style, 360);
  const lon = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 360);
  assert.equal(decl.yTop, decl.headerBottom);
  assert.equal(decl.yBottom, decl.rulerY);
  assert.ok(lon.yTop > lon.headerBottom && lon.yBottom < lon.rulerY);
  const plot = await readFile(new URL("../src/lib/chart/ephemeris-plot-paint.ts", import.meta.url), "utf8");
  // Turns carry no N/S letter: a dot only with Event glyphs on; no OOB text over the range band.
  assert.doesNotMatch(plot, /st\.code === "DN"/);
  assert.match(plot, /if \(!\(scene\.showOutOfBoundsRange \?\? false\) && scene\.outOfBoundsLabel\)/);
  assert.match(plot, /if \(!scene\.showEventGlyphs\) return;[\s\S]*?block\.declinationStations[\s\S]*?ctx\.arc\(/);
});
