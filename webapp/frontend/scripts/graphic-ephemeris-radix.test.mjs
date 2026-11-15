// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris radix layer (Tab): natal lines, the label column beyond
// the degree ruler, exact-crossing rings and their hover. The daemon owns
// every point and crossing; the frontend filters by the scene and paints.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: [
      "export * from './src/lib/chart/ephemeris-radix';",
      "export { hitTestEphemeris } from './src/lib/chart/ephemeris-hit-test';",
      "export { ephemerisHoverGlyphPaint } from './src/lib/chart/ephemeris-hover-colors';",
      "export { computeEphemerisGeometry, mapEphemerisY } from './src/lib/chart/ephemeris-geometry';",
      "export { createEphemerisRenderStyle } from './src/lib/chart/ephemeris-render-style';",
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
  alias: { "@": "./src" },
});
const radix = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const {
  decodeEphemerisContactsYear,
  computeEphemerisGeometry,
  createEphemerisRenderStyle,
  decodeEphemerisRadixPoints,
  decodeEphemerisRadixYear,
  ephemerisHoverGlyphPaint,
  ephemerisRadixLayer,
  hitTestEphemeris,
  mapEphemerisY,
  radixAspectGlyph,
  radixPointParts,
  radixYearsOf,
} = radix;

const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const measure = (text, px) => text.length * px * 0.6;
const style = createEphemerisRenderStyle();

function f64(values) {
  return Buffer.from(new Float64Array(values).buffer).toString("base64");
}

const { points } = decodeEphemerisRadixPoints({
  radixKey: "radix-v1:x",
  points: [
    { key: "sun", kind: "planet", lon: 334.2, glyphs: ["A"], glyphFonts: ["morinus"], label: "Sun", defaultVisible: true },
    { key: "vertex", kind: "vertex", lon: 191, glyphs: ["!"], glyphFonts: ["morinus"], label: "Vertex", defaultVisible: false },
    { key: "sun/moon", kind: "midpoint", lon: 340.5, glyphs: ["A", "B"], glyphFonts: ["morinus", "morinus"], label: "Sun/Moon", defaultVisible: true, pair: ["sun", "moon"] },
  ],
});
const rows = decodeEphemerisRadixYear({
  dataKey: "d", radixKey: "radix-v1:x", year: 2026,
  points: ["sun", "vertex", "sun/moon"],
  jd: f64([2461050, 2461060, 2461070, 2461080, 2461090, 2461100]),
  planet: [6, 6, 0, 7, 6, 6],
  point: [0, 0, 0, 2, 1, 0],
  aspect: [90, 45, 0, 180, 0, 60],
});
const visible = { 0: true, 6: true, 7: true };
const byDefault = (p) => p.defaultVisible;

test("the wire decodes to points and per-row point keys", () => {
  assert.equal(points.length, 3);
  assert.deepEqual(points[2].glyphs, ["A", "B"]);
  assert.deepEqual(rows.map((r) => r.pointKey), ["sun", "sun", "sun", "sun/moon", "vertex", "sun"]);
  assert.equal(rows[0].jd, 2461050);
  assert.deepEqual(radixYearsOf({ startJd: 2461300, spanDays: 200 }), [2026, 2027]);
});

test("the layer keeps aspects on the plate's modulus, visible lines and curves, fast planets on request", () => {
  const on45 = ephemerisRadixLayer(points, byDefault, rows, { visible, modulus: 45 }, false);
  assert.deepEqual(on45.points.map((p) => p.key), ["sun", "sun/moon"]);
  // Sun (fast) hidden, Vertex line off, 60° is not a multiple of 45.
  assert.deepEqual(on45.crossings.map((r) => r.aspect), [90, 45, 180]);
  const on90 = ephemerisRadixLayer(points, byDefault, rows, { visible, modulus: 90 }, true);
  assert.deepEqual(on90.crossings.map((r) => [r.planet, r.aspect]), [[6, 90], [0, 0], [7, 180]]);
  const on30 = ephemerisRadixLayer(points, () => true, rows, { visible, modulus: 30 }, true);
  assert.deepEqual(on30.crossings.map((r) => r.aspect), [90, 0, 180, 0, 60]);
  const saturnHidden = ephemerisRadixLayer(points, byDefault, rows, { visible: { ...visible, 6: false }, modulus: 45 }, false);
  assert.deepEqual(saturnHidden.crossings.map((r) => r.planet), [7]);
});

test("angles are written, midpoints mix glyph and text runs", () => {
  const { points: angled } = decodeEphemerisRadixPoints({
    radixKey: "k",
    points: [
      { key: "asc", kind: "angle", lon: 27, glyphs: ["Asc"], glyphFonts: ["text"], label: "Asc", defaultVisible: true },
      { key: "sun/asc", kind: "midpoint", lon: 1, glyphs: ["A", "Asc"], glyphFonts: ["morinus", "text"], label: "Sun/Asc", defaultVisible: false },
    ],
  });
  assert.deepEqual(radixPointParts(angled[0]), [{ text: "Asc", font: "text" }]);
  assert.deepEqual(radixPointParts(angled[1]), [
    { text: "A", font: "morinus" },
    { text: "/", font: "text" },
    { text: "Asc", font: "text" },
  ]);
});

test("aspect glyphs read either side of the circle", () => {
  for (const [angle, glyph] of [[0, "M"], [45, "O"], [315, "O"], [90, "R"], [270, "R"], [135, "T"], [225, "T"], [180, "W"], [60, "P"], [120, "S"], [150, "V"], [30, "N"]]) {
    assert.equal(radixAspectGlyph(angle), glyph, String(angle));
  }
});

test("the label column sits beyond the degree ruler and narrows the plot, in longitude only", () => {
  const plain = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 45, false, false, false);
  const radix = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 45, false, false, true);
  const u = radix.planetFontPx;
  const column = u * style.radix.radixColumnScale;
  assert.equal(plain.radixColumnRight - plain.radixColumnLeft, 0);
  assert.ok(Math.abs(radix.radixColumnRight - radix.radixColumnLeft - column) < 1e-9);
  assert.equal(radix.radixColumnRight, radix.plateRight);
  assert.ok(Math.abs(plain.plotRight - radix.plotRight - column) < 1e-9);
  assert.equal(radix.xOrig, plain.xOrig);
  const mirrored = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 45, true, false, true);
  assert.equal(mirrored.radixColumnLeft, mirrored.outer);
  assert.ok(mirrored.xOrig - mirrored.radixColumnRight > 0, "ruler between column and plot");
  const declination = computeEphemerisGeometry(1200, 800, "declination", measure, style, 45, false, false, true);
  assert.equal(declination.radixColumnRight - declination.radixColumnLeft, 0);
});

test("a ring snaps the hover to the transit planet with the contact glyphs", () => {
  const geo = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 45, false, false, true);
  const camera = { startJd: 2461040, spanDays: 365 };
  const layer = ephemerisRadixLayer(points, byDefault, rows, { visible, modulus: 45 }, false);
  const scene = {
    mode: "longitude", modulus: 45, visible, planets: [{ id: 6, glyph: "G", color: "#000" }, { id: 7, glyph: "H", color: "#000" }],
    signGlyphs: "abcdefghijkl".split(""), signNames: Array(12).fill(""), monthLabels: Array(12).fill("jan"),
    showLunations: false,
  };
  const x = geo.xOrig + ((2461050 - camera.startJd) / camera.spanDays) * geo.plotWidth;
  const y = mapEphemerisY(geo, "longitude", 334.2, 45);
  const data = { dataKey: "d", blocks: [], stationYears: [] };
  const hit = hitTestEphemeris(x + 2, y - 2, camera, geo, data, scene, style, layer);
  assert.equal(hit.planet, 6);
  assert.equal(hit.jd, 2461050);
  assert.deepEqual(hit.info.contact, { aspectGlyph: "R", aspectIndex: 5, point: [{ text: "A", font: "morinus" }] });
  assert.equal(hit.info.planetGlyph, "G");
  // Transit longitude at the exact square: the line plus 90°.
  assert.ok(Math.abs(hit.value - (334.2 + 90 - 360)) < 1e-9);
  // Without the layer the same point is the free readout.
  assert.equal(hitTestEphemeris(x + 2, y - 2, camera, geo, data, scene, style, null).planet, undefined);
});

test("the radix toggles persist, stay display-only, and Tab toggles them on the ephemeris", async () => {
  const view = await read("components/workshell/graph-ephemeris-view.tsx");
  for (const [field, setter] of [["show_radix", "setShowRadix"], ["show_fast_contacts", "setShowFastContacts"]]) {
    assert.match(view, new RegExp(`React\\.useState\\(\\(\\) => cachedState\\?\\.${field} \\?\\? false\\)`));
    assert.match(view, new RegExp(`if \\(typeof state\\.${field} === "boolean"\\) ${setter}\\(state\\.${field}\\);`));
  }
  assert.match(view, /radix_points: toggles\.radixPointOverrides,/);
  for (const name of ["toggleRadix", "toggleFastContacts", "setRadixPointVisibility"]) {
    const start = view.indexOf(`const ${name} = React.useCallback(`);
    assert.ok(start > 0, name);
    const body = view.slice(start, view.indexOf("\n  );\n", start));
    assert.match(body, /persistViewState\(/);
    assert.doesNotMatch(body, /fetch[A-Z]|moveCamera|cameraRef|initialCameraRef|tweenRef|ephemerisStore|setMeta/);
  }
  assert.match(view, /registerGraphicEphemerisRadixToggle\(documentId, \(\) => \{\s*if \(togglesRef\.current\.mode !== "longitude"\) return;\s*toggleRadix\(!togglesRef\.current\.showRadix\);/);
  // Both toggles live in the View drawer; the per-point list is its own submenu.
  const drawerStart = view.indexOf('<ContextMenuSubTrigger>{t("ephem.view")}</ContextMenuSubTrigger>');
  const drawer = view.slice(drawerStart, view.indexOf("</ContextMenuSub>", drawerStart));
  assert.ok(drawer.includes('t("ephem.radixLines")') && drawer.includes('t("ephem.fastContacts")'));
  assert.match(view, /<ContextMenuSubTrigger>\{t\("ephem\.radix"\)\}<\/ContextMenuSubTrigger>/);
  const home = await read("components/workshell/home-client.tsx");
  assert.match(home, /const toggleTabView = useCallback\(\(\) => \{\s*\/\/[^\n]*\n\s*const activeDoc = activeDocRef\.current;\s*if \(activeDoc\?\.kind === "ephemeris"\) \{\s*toggleGraphicEphemerisRadix\(activeDoc\.id\);\s*return;/);
  const en = JSON.parse(await read("locales/en.json"));
  for (const key of ["ephem.radix", "ephem.radixLines", "ephem.fastContacts"]) assert.ok(en[key], key);
});


const contacts = decodeEphemerisContactsYear({
  dataKey: "d", year: 2026,
  jd: f64([2461100, 2461120, 2461140, 2461160]),
  lon: f64([12.5, 370, 200, 90]),
  a: [6, 6, 0, 5],
  b: [8, 7, 6, 7],
  aspect: [0, 45, 90, 315],
});

test("planet contacts decode and keep visible slow pairs on the modulus", () => {
  assert.equal(contacts.length, 4);
  assert.equal(contacts[1].lon, 10);
  const all = { 0: true, 5: true, 6: true, 7: true, 8: true };
  const on45 = ephemerisRadixLayer([], byDefault, [], { visible: all, modulus: 45 }, false, contacts);
  // The Sun's contact waits for the fast toggle; 315° is a semisquare.
  assert.deepEqual(on45.contacts.map((c) => [c.a, c.b]), [[6, 8], [6, 7], [5, 7]]);
  const on90 = ephemerisRadixLayer([], byDefault, [], { visible: all, modulus: 90 }, true, contacts);
  assert.deepEqual(on90.contacts.map((c) => c.aspect), [0, 90]);
  const neptuneOff = ephemerisRadixLayer([], byDefault, [], { visible: { ...all, 8: false }, modulus: 45 }, false, contacts);
  assert.deepEqual(neptuneOff.contacts.map((c) => c.b), [7, 7]);
});

test("a planet contact snaps the hover to both planets and the aspect", () => {
  const geo = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 45, false, false, false);
  const camera = { startJd: 2461040, spanDays: 365 };
  const all = { 6: true, 8: true };
  const layer = ephemerisRadixLayer([], byDefault, [], { visible: all, modulus: 45 }, false, contacts);
  const scene = {
    mode: "longitude", modulus: 45, visible: all,
    planets: [{ id: 6, glyph: "G", color: "#000" }, { id: 8, glyph: "I", color: "#000" }],
    signGlyphs: "abcdefghijkl".split(""), signNames: Array(12).fill(""), monthLabels: Array(12).fill("apr"),
    showLunations: false,
  };
  const x = geo.xOrig + ((2461100 - camera.startJd) / camera.spanDays) * geo.plotWidth;
  const y = mapEphemerisY(geo, "longitude", 12.5, 45);
  const hit = hitTestEphemeris(x, y + 1, camera, geo, { dataKey: "d", blocks: [], stationYears: [] }, scene, style, layer);
  assert.equal(hit.planet, 6);
  assert.equal(hit.jd, 2461100);
  assert.equal(hit.info.planetGlyph, "G");
  assert.deepEqual(hit.info.contact, {
    aspectGlyph: "M", aspectIndex: 0, point: [{ text: "I", font: "morinus" }], planetId: 8, planetSign: 0,
  });
  assert.equal(hit.info.planetId, 6);
  assert.equal(hit.info.planetSign, 0);
  assert.equal(hit.info.signIndex, 0);
});

test("hover flag glyphs: app colours by role, planets optionally in their curve's ink", () => {
  const app = {
    planets: {
      6: { bySign: Array(12).fill("#111111"), roleBySign: ["--morinus-dignity-domicil", ...Array(11).fill("--morinus-peregrin")] },
      8: { bySign: Array(12).fill("#222222"), roleBySign: Array(12).fill(null) },
    },
    signs: { colors: Array(12).fill("#333333"), roles: ["--morinus-element-fire", ...Array(11).fill(null)] },
    aspects: { colors: ["#444444"], roles: ["--morinus-aspect-conjunction"] },
  };
  const info = {
    date: "", sign: "a", signName: "", degree: 0, minute: 0, declination: false,
    planetId: 6, planetSign: 0, signIndex: 0,
    contact: { aspectGlyph: "M", aspectIndex: 0, point: [{ text: "I", font: "morinus" }], planetId: 8, planetSign: 0 },
  };
  const inks = new Map([[6, { bySign: Array(12).fill("#aa0000") }], [8, { bySign: Array(12).fill("#00aa00") }]]);
  const appPaint = ephemerisHoverGlyphPaint(info, { lineColors: false, app, inks });
  assert.equal(appPaint.planet, "var(--morinus-dignity-domicil, #111111)");
  assert.equal(appPaint.sign, "var(--morinus-element-fire, #333333)");
  assert.equal(appPaint.aspect, "var(--morinus-aspect-conjunction, #444444)");
  assert.deepEqual(appPaint.point, ["#222222"]);
  const linePaint = ephemerisHoverGlyphPaint(info, { lineColors: true, app, inks });
  assert.equal(linePaint.planet, "#aa0000");
  assert.deepEqual(linePaint.point, ["#00aa00"]);
  // Sign and aspect glyphs keep the app colours either way.
  assert.equal(linePaint.sign, appPaint.sign);
  assert.equal(linePaint.aspect, appPaint.aspect);

  const natal = { ...info, contact: { aspectGlyph: "R", aspectIndex: 0, point: radixPointParts({ glyphs: ["A"], glyphFonts: ["morinus"], glyphColors: ["#555555"], glyphColorRoles: ["--morinus-body-sun"] }) } };
  assert.deepEqual(ephemerisHoverGlyphPaint(natal, { lineColors: false, app, inks }).point, ["var(--morinus-body-sun, #555555)"]);
  // Natal lines are painted in the list colour, so either way the mark keeps it.
  assert.deepEqual(ephemerisHoverGlyphPaint(natal, { lineColors: true, app, inks }).point, ["var(--morinus-body-sun, #555555)"]);
});

test("the planet-contacts toggle persists, stays display-only and works without the radix", async () => {
  const view = await read("components/workshell/graph-ephemeris-view.tsx");
  assert.match(view, /React\.useState\(\(\) => cachedState\?\.show_planet_contacts \?\? false\)/);
  assert.match(view, /if \(typeof state\.show_planet_contacts === "boolean"\) setShowPlanetContacts\(state\.show_planet_contacts\);/);
  assert.match(view, /show_planet_contacts: toggles\.showPlanetContacts,/);
  const start = view.indexOf("const togglePlanetContacts = React.useCallback(");
  const body = view.slice(start, view.indexOf("\n  );\n", start));
  assert.match(body, /setShowPlanetContacts\(checked\);\s*persistViewState\(\{ show_planet_contacts: checked \}\);/);
  assert.doesNotMatch(body, /fetch[A-Z]|moveCamera|cameraRef|tweenRef|ephemerisStore|setMeta/);
  assert.match(view, /if \(!currentScene\.showRadix && !currentScene\.showPlanetContacts\) return EMPTY_RADIX_LAYER;/);
  const plate = await read("lib/chart/ephemeris-plate-paint.ts");
  assert.match(plate, /if \(scene\.showPlanetContacts\) paintEphemerisContacts\(/);
  const drawerStart = view.indexOf('<ContextMenuSubTrigger>{t("ephem.view")}</ContextMenuSubTrigger>');
  const drawer = view.slice(drawerStart, view.indexOf("</ContextMenuSub>", drawerStart));
  assert.ok(drawer.includes('t("ephem.planetContacts")'));
  const en = JSON.parse(await read("locales/en.json"));
  assert.equal(en["ephem.planetContacts"], "Mundane transits");
});

test("natal lines take the chart colour of their list mark, angles the plate ink", () => {
  const { radixPointColors } = radix;
  const colored = createEphemerisRenderStyle({
    colors: {
      ...style.colors,
      paper: "#ffffff",
      ink: "#101010",
      angles: "#3060a0",
      bodies: ["#c00000", "#0000c0", "", "", "", "", "#202020", "", "", "", "", "", ""],
      dignity: { ...style.colors.dignity, domicile: "#008000" },
    },
  });
  const point = (glyphColorRoles, glyphColors = glyphColorRoles.map(() => "#777777")) => ({
    glyphs: glyphColorRoles.map(() => "A"),
    glyphColors,
    glyphColorRoles,
  });
  assert.deepEqual(radixPointColors(point(["--morinus-body-sun"]), colored), ["#c00000"]);
  assert.deepEqual(radixPointColors(point(["--morinus-dignity-domicil"]), colored), ["#008000"]);
  // A written angle (Asc, MC) takes the chart's angle colour; other plain-ink marks stay ink.
  assert.deepEqual(radixPointColors({ ...point(["--morinus-text-bright"]), glyphFonts: ["text"] }, colored), ["#3060a0"]);
  assert.deepEqual(radixPointColors({ ...point(["--morinus-text-bright"]), glyphFonts: ["morinus"] }, colored), ["#101010"]);
  // A midpoint carries both parents' colours.
  assert.deepEqual(radixPointColors(point(["--morinus-body-sun", "--morinus-body-moon"]), colored), ["#c00000", "#0000c0"]);
  // No role: the daemon's literal; a colour too faint on the paper: ink.
  assert.deepEqual(radixPointColors(point([null], ["#335577"]), colored), ["#335577"]);
  assert.deepEqual(radixPointColors(point([null], ["#fefefe"]), colored), ["#101010"]);
});

test("natal lines take one radix ink; Colour natal labels colours only the label marks by ink mode", async () => {
  const { radixInk, radixLabelColors } = radix;
  const colored = createEphemerisRenderStyle({
    colors: {
      ...style.colors,
      paper: "#ffffff",
      ink: "#101010",
      muted: "#606060",
      signs: "#2030c0",
      angles: "#3060a0",
      bodies: ["#c00000", "#0000c0", "", "", "", "", "#202020", "", "", "", "", "", ""],
      dignity: { ...style.colors.dignity, domicile: "#008000", peregrine: "#505050" },
    },
  });
  assert.equal(radixInk(colored), "#2030c0");
  const sun = { key: "sun", kind: "planet", lon: 130, seId: 0, glyphs: ["a"], glyphFonts: ["morinus"], glyphColors: ["#777777"], glyphColorRoles: ["--morinus-body-sun"] };
  const asc = { key: "asc", kind: "angle", lon: 10, glyphs: ["Asc"], glyphFonts: ["text"], glyphColors: [""], glyphColorRoles: ["--morinus-text-bright"] };
  const mid = { key: "sun/asc", kind: "midpoint", lon: 70, glyphs: ["a", "Asc"], glyphFonts: ["morinus", "text"], glyphColors: ["#777777", ""], glyphColorRoles: ["--morinus-body-sun", "--morinus-text-bright"] };
  const byKey = new Map([sun, asc, mid].map((p) => [p.key, p]));
  const scene = (inkMode) => ({ inkMode, usePlanetColors: false, dignityBySign: { 0: Array.from({ length: 12 }, (_, i) => (i === 4 ? "domicile" : "peregrine")) } });
  assert.deepEqual(radixLabelColors(sun, byKey, scene("planets"), colored), ["#c00000"]);
  // Dignity ink: the Sun's dignity in its natal sign (Leo, domicile).
  assert.deepEqual(radixLabelColors(sun, byKey, scene("dignity"), colored), ["#008000"]);
  assert.deepEqual(radixLabelColors(sun, byKey, scene("tiers"), colored), ["#101010"]);
  assert.deepEqual(radixLabelColors(mid, byKey, scene("planets"), colored), ["#c00000", "#3060a0"]);
  // The paint keeps lines, leaders and plate marks in the radix ink; only the
  // label column reads the option.
  const source = await read("lib/chart/ephemeris-radix.ts");
  assert.match(source, /const labelInks = scene\.colorRadixLabels \? radixLabelColors\(/);
  assert.equal((source.match(/radixLabelColors\(item\.point/g) ?? []).length, 1);
  const view = await read("components/workshell/graph-ephemeris-view.tsx");
  assert.match(view, /cachedState\?\.color_radix_labels \?\? false/);
  assert.ok(view.includes('t("ephem.colorRadixLabels")'));
});

test("the focused line's contour glyphs stay clear of the reading line", () => {
  const { radixContourFractions } = radix;
  assert.deepEqual(radixContourFractions(0), []);
  for (const n of [1, 2, 3, 4]) {
    const f = radixContourFractions(n);
    assert.equal(f.length, n);
    assert.ok(f.every((x) => x > 0 && x < 1 && Math.abs(x - 0.5) > 0.05), `n=${n}: ${f}`);
  }
  assert.deepEqual(radixContourFractions(2).map((x) => Math.round(x * 100)), [24, 76]);
  assert.equal(style.radix.radixContourCount, 2);
});

test("a natal line is hit near its y in the plot or the label column, only with the radix on", () => {
  const { hitTestEphemerisRadixLine } = radix;
  const geo = computeEphemerisGeometry(1200, 800, "longitude", measure, style, 45, false, false, true);
  const layer = ephemerisRadixLayer(points, (p) => p.defaultVisible, [], { visible: {}, modulus: 45 }, false);
  const scene = { mode: "longitude", modulus: 45, showRadix: true };
  const y = mapEphemerisY(geo, "longitude", 334.2, 45);
  const x = geo.xOrig + geo.plotWidth / 3;
  assert.equal(hitTestEphemerisRadixLine(x, y + 2, geo, layer, scene, 6), "sun");
  assert.equal(hitTestEphemerisRadixLine((geo.radixColumnLeft + geo.radixColumnRight) / 2, y, geo, layer, scene, 6), "sun");
  assert.equal(hitTestEphemerisRadixLine(x, y + 40, geo, layer, scene, 6), null);
  assert.equal(hitTestEphemerisRadixLine(x, y, geo, layer, { ...scene, showRadix: false }, 6), null);
  assert.equal(hitTestEphemerisRadixLine(geo.xOrig - 20, y, geo, layer, scene, 6), null);
});

test("Orb bands: a persisted, display-only view option painted under the curves at the served orb", async () => {
  assert.equal(decodeEphemerisRadixPoints({ radixKey: "k", points: [], orb: 1.5 }).orb, 1.5);
  assert.equal(decodeEphemerisRadixPoints({ radixKey: "k", points: [] }).orb, 0);
  const view = await read("components/workshell/graph-ephemeris-view.tsx");
  assert.match(view, /React\.useState\(\(\) => cachedState\?\.show_radix_bands \?\? false\)/);
  assert.match(view, /if \(typeof state\.show_radix_bands === "boolean"\) setShowRadixBands\(state\.show_radix_bands\);/);
  assert.match(view, /show_radix_bands: toggles\.showRadixBands,/);
  const start = view.indexOf("const toggleRadixBands = React.useCallback(");
  const body = view.slice(start, view.indexOf("\n  );\n", start));
  assert.match(body, /setShowRadixBands\(checked\);\s*persistViewState\(\{ show_radix_bands: checked \}\);/);
  assert.doesNotMatch(body, /fetch[A-Z]|moveCamera|cameraRef|tweenRef|ephemerisStore|setMeta/);
  const plate = await read("lib/chart/ephemeris-plate-paint.ts");
  assert.match(plate, /paintEphemerisRadixBands\(ctx, geo, radix, scene, style, recede\)/);
  assert.match(plate, /paintEphemerisPlot\(plot, geo, camera, data, scene, style, measure, bands\)/);
  const plot = await read("lib/chart/ephemeris-plot-paint.ts");
  assert.ok(plot.indexOf("underCurves?.(ctx)") < plot.indexOf("=== Curves, decimated"), "bands paint before the curves");
  for (const locale of ["de", "en", "es", "fr", "hu", "it", "ja", "ko", "ru", "tr", "zh-Hans", "zh-Hant"]) {
    const catalog = JSON.parse(await read(`locales/${locale}.json`));
    assert.ok(catalog["ephem.radixOrbBands"], `${locale} has ephem.radixOrbBands`);
  }
});

test("Radix glyphs on the date line: a persisted display-only option, on by default", async () => {
  const view = await read("components/workshell/graph-ephemeris-view.tsx");
  assert.match(view, /React\.useState\(\(\) => cachedState\?\.show_radix_reading_glyphs \?\? true\)/);
  assert.match(view, /if \(typeof state\.show_radix_reading_glyphs === "boolean"\) setShowRadixReadingGlyphs\(state\.show_radix_reading_glyphs\);/);
  assert.match(view, /show_radix_reading_glyphs: toggles\.showRadixReadingGlyphs,/);
  const start = view.indexOf("const toggleRadixReadingGlyphs = React.useCallback(");
  const body = view.slice(start, view.indexOf("\n  );\n", start));
  assert.match(body, /setShowRadixReadingGlyphs\(checked\);\s*persistViewState\(\{ show_radix_reading_glyphs: checked \}\);/);
  assert.doesNotMatch(body, /fetch[A-Z]|moveCamera|cameraRef|tweenRef|ephemerisStore|setMeta/);
  assert.match(view, /disabled=\{!showRadix \|\| !showNowLine\}/);
  const painter = await read("lib/chart/ephemeris-radix.ts");
  assert.match(painter, /const readingGlyphs = Boolean\(scene\.showNowLine\) && scene\.showRadixReadingGlyphs !== false;/);
  assert.match(painter, /if \(readingGlyphs\) \{/);
  // A clicked line moves its name from the date line to the sides; a hovered
  // one gets side glyphs only when the date line does not name it.
  assert.match(painter, /const pinned = focus != null && Boolean\(scene\.radixFocusPinned\);/);
  assert.match(painter, /if \(pinned && point\.key === focus\) continue;/);
  assert.match(painter, /const focused = focus != null && \(pinned \|\| !readingGlyphs\) \? byKey\.get\(focus\) : undefined;/);
  assert.match(view, /radixFocusKey: pinnedRadixKey \?\? hoverRadixKey, radixFocusPinned: pinnedRadixKey != null \}/);
  for (const locale of ["de", "en", "es", "fr", "hu", "it", "ja", "ko", "ru", "tr", "zh-Hans", "zh-Hant"]) {
    const catalog = JSON.parse(await read(`locales/${locale}.json`));
    assert.ok(catalog["ephem.radixReadingGlyphs"], `${locale} has ephem.radixReadingGlyphs`);
  }
});

test("natal lines: hover never dims the others, a pin recedes them", () => {
  // A recording context: the alpha each line stroke and band fill paints at.
  function recorder() {
    const marks = [];
    const stack = [];
    const state = { globalAlpha: 1, strokeStyle: "", fillStyle: "", lineWidth: 1, font: "" };
    const ctx = new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === "save") return () => stack.push(target.globalAlpha);
        if (prop === "restore") return () => { target.globalAlpha = stack.pop() ?? 1; };
        if (prop === "measureText") return (s) => ({ width: String(s).length * 8 });
        if (prop === "stroke") return () => marks.push({ kind: "line", alpha: target.globalAlpha, width: target.lineWidth });
        if (prop === "fillRect") return () => marks.push({ kind: "fill", alpha: target.globalAlpha });
        return () => {};
      },
      set(target, prop, value) { target[prop] = value; return true; },
    });
    return { ctx, marks };
  }
  const point = (key, lon) => ({
    key, kind: "planet", lon, glyphs: ["A"], glyphFonts: ["morinus"], glyphColors: [""], glyphColorRoles: [null],
    label: key, defaultVisible: true,
  });
  const layer = { points: [point("sun", 30), point("moon", 120), point("mars", 250)], crossings: [], contacts: [] };
  const geo = {
    xOrig: 0, plotWidth: 600, plotRight: 600, plotHeight: 360, yTop: 0, yBottom: 360,
    planetFontPx: 14, tableFontPx: 12, radixColumnLeft: 0, radixColumnRight: 0, mirrored: false, spaceSize: 4,
  };
  const camera = { startJd: 2460000, spanDays: 30 };
  const base = { mode: "longitude", modulus: 360, showRadix: true, showRadixBands: true, radixBandOrb: 2, showNowLine: true, planets: [] };
  const paint = (focus, recede) => {
    const lines = recorder();
    radix.paintEphemerisRadix({ ctx: lines.ctx, width: 600, height: 360, dpr: 1 }, geo, camera, layer, { ...base, ...focus }, style, recede);
    const bands = recorder();
    radix.paintEphemerisRadixBands(bands.ctx, geo, layer, { ...base, ...focus }, style, recede);
    return { lines: lines.marks.filter((m) => m.kind === "line").slice(0, 3), bands: bands.marks };
  };
  const rest = paint({});
  const hovered = paint({ radixFocusKey: "moon", radixFocusPinned: false });
  const pinned = paint({ radixFocusKey: "moon", radixFocusPinned: true });
  const lineAlpha = style.radix.radixLineOpacity;
  // Hover: the hovered line comes forward (full alpha, heavier); the others are untouched.
  assert.deepEqual(hovered.lines.map((m) => m.alpha), [lineAlpha, 1, lineAlpha]);
  assert.ok(hovered.lines[1].width > rest.lines[1].width);
  assert.equal(hovered.bands[0].alpha, rest.bands[0].alpha);
  assert.equal(hovered.bands[2].alpha, rest.bands[2].alpha);
  // Pin: the others recede to the recede opacity until released.
  const recede = style.radix.radixRecedeOpacity;
  assert.deepEqual(pinned.lines.map((m) => m.alpha), [lineAlpha * recede, 1, lineAlpha * recede]);
  assert.ok(Math.abs(pinned.bands[0].alpha - rest.bands[0].alpha * recede) < 1e-9);
  assert.deepEqual(paint({ radixFocusKey: null, radixFocusPinned: false }).lines.map((m) => m.alpha), rest.lines.map((m) => m.alpha));
  // Mid-fade after release: the released line is spared, the others part-way.
  const half = 1 - 0.5 * (1 - recede);
  const fading = paint({ radixFocusKey: null, radixFocusPinned: false }, { amount: 0.5, key: "moon" });
  assert.deepEqual(fading.lines.map((m) => m.alpha), [lineAlpha * half, lineAlpha, lineAlpha * half]);
  assert.ok(Math.abs(fading.bands[2].alpha - rest.bands[2].alpha * half) < 1e-9);
  // Hovering while a fade runs still never adds dimming of its own.
  const hoverFade = paint({ radixFocusKey: "sun", radixFocusPinned: false }, { amount: 0, key: "moon" });
  assert.deepEqual(hoverFade.lines.map((m) => m.alpha), [1, lineAlpha, lineAlpha]);
});

test("the Radix menu names the angles in full, midpoints included", async () => {
  const view = await readFile(new URL("../src/components/workshell/graph-ephemeris-view.tsx", import.meta.url), "utf8");
  assert.match(view, /asc: t\("astrocart\.point\.ascendant"\)[\s\S]*?mc: t\("astrocart\.point\.midheaven"\)[\s\S]*?dsc: t\("astrocart\.point\.descendant"\)[\s\S]*?ic: t\("astrocart\.point\.imumCoeli"\)/);
  assert.match(view, /<RadixPointMark parts=\{radixPointParts\(point\)\} \/>\s*\{radixPointMenuLabel\(point\)\}/);
});
