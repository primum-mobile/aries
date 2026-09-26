// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const styleSource = await readFile(
  new URL("../src/lib/chart/astrocart-style.ts", import.meta.url),
  "utf8",
);
const rendererContract = JSON.parse(await readFile(
  new URL("../src/styles/renderer-style-contract.generated.json", import.meta.url),
  "utf8",
));
const styleJavascript = ts.transpileModule(styleSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  ASTROCART_CHROME_NUMBER_BOUNDS,
  ASTROCART_CHROME_NUMBER_FIELDS,
  ASTROCART_CHROME_STRING_FIELDS,
  ASTROCART_POINT_LINE_OPACITY_BOUNDS,
  ASTROCART_POINT_LINE_WIDTH_SCALE_BOUNDS,
  ASTROCART_RENDER_TOKEN_SPECS,
  ASTROCART_RENDERER_BOOLEAN_FIELDS,
  ASTROCART_RENDERER_NUMBER_BOUNDS,
  ASTROCART_RENDERER_NUMBER_FIELDS,
  ASTROCART_RENDERER_STRING_FIELDS,
  ASTROCART_STYLE_SCHEMA_VERSION,
  ASTROCART_TITLEBAR_SAFE_TOP,
  createAstrocartStyleMessage,
  parseAstrocartStyle,
} = await import(
  `data:text/javascript;base64,${Buffer.from(styleJavascript).toString("base64")}`
);

function fixture() {
  const chrome = { titlebarSafeTop: ASTROCART_TITLEBAR_SAFE_TOP };
  for (const field of ASTROCART_CHROME_STRING_FIELDS) chrome[field] = `${field}-value`;
  for (const field of ASTROCART_CHROME_NUMBER_FIELDS) {
    const [minimum, maximum] = ASTROCART_CHROME_NUMBER_BOUNDS[field];
    chrome[field] = (minimum + maximum) / 2;
  }
  const renderer = {};
  for (const field of ASTROCART_RENDERER_STRING_FIELDS) renderer[field] = `${field}-value`;
  for (const field of ASTROCART_RENDERER_NUMBER_FIELDS) {
    const [minimum, maximum] = ASTROCART_RENDERER_NUMBER_BOUNDS[field];
    renderer[field] = (minimum + maximum) / 2;
  }
  for (const field of ASTROCART_RENDERER_BOOLEAN_FIELDS) renderer[field] = true;
  return {
    schemaVersion: ASTROCART_STYLE_SCHEMA_VERSION,
    styleRevision: "revision-1",
    styleHash: "hash-1",
    mode: "dark",
    chrome,
    renderer,
    points: {
      sun: {
        label: "Sun",
        color: "#ffcc66",
        glyphMorinus: "A",
        lineWidthScale: 1,
        lineOpacity: 1,
      },
    },
    behavior: {
      showEcliptic: true,
      showEquator: true,
      showAscCircle: true,
      showMcCircle: true,
      showHouseLines: true,
      showZodiacLines: true,
      lineLabelGlyphs: false,
      localSpaceBearings: true,
    },
  };
}

test("the adapter validates and freezes the complete chrome and renderer values", () => {
  assert.equal(
    ASTROCART_CHROME_STRING_FIELDS.length + ASTROCART_CHROME_NUMBER_FIELDS.length + 1,
    30,
  );
  assert.equal(
    ASTROCART_RENDERER_STRING_FIELDS.length +
      ASTROCART_RENDERER_NUMBER_FIELDS.length +
      ASTROCART_RENDERER_BOOLEAN_FIELDS.length,
    169,
  );
  const style = parseAstrocartStyle(fixture());
  assert.equal(style.schemaVersion, 10);
  assert.equal(style.chrome.titlebarSafeTop, 34);
  assert.equal(Object.keys(style.renderer).length, 169);
  for (const group of [style, style.chrome, style.renderer, style.points, style.points.sun, style.behavior]) {
    assert.ok(Object.isFrozen(group));
  }
});

test("the iframe adapter rejects partial, malformed, and future schemas", () => {
  const missing = fixture();
  delete missing.renderer.solidWidth;
  assert.throws(() => parseAstrocartStyle(missing), /solidWidth/);

  const malformed = fixture();
  malformed.chrome.titlebarSafeTop = Number.NaN;
  assert.throws(() => parseAstrocartStyle(malformed), /titlebarSafeTop/);

  const negativeInset = fixture();
  negativeInset.chrome.titlebarSafeTop = -1;
  assert.throws(() => parseAstrocartStyle(negativeInset), /titlebarSafeTop/);

  const negativeWidth = fixture();
  negativeWidth.renderer.solidWidth = -0.1;
  assert.throws(() => parseAstrocartStyle(negativeWidth), /solidWidth/);

  const excessiveOpacity = fixture();
  excessiveOpacity.renderer.solidOpacity = 1.01;
  assert.throws(() => parseAstrocartStyle(excessiveOpacity), /solidOpacity/);

  const hiddenLabels = fixture();
  hiddenLabels.renderer.labelSize = 0;
  assert.throws(() => parseAstrocartStyle(hiddenLabels), /labelSize/);

  for (const [field, value] of [
    ["lineWidthScale", ASTROCART_POINT_LINE_WIDTH_SCALE_BOUNDS[0] - 0.01],
    ["lineWidthScale", ASTROCART_POINT_LINE_WIDTH_SCALE_BOUNDS[1] + 0.01],
    ["lineOpacity", ASTROCART_POINT_LINE_OPACITY_BOUNDS[0] - 0.01],
    ["lineOpacity", ASTROCART_POINT_LINE_OPACITY_BOUNDS[1] + 0.01],
  ]) {
    const invalidPoint = fixture();
    invalidPoint.points.sun[field] = value;
    assert.throws(() => parseAstrocartStyle(invalidPoint), new RegExp(field));
  }

  const extendedPoint = fixture();
  extendedPoint.points.sun.unversionedSetting = true;
  assert.throws(() => parseAstrocartStyle(extendedPoint), /unversionedSetting is not part of schema v10/);

  const future = fixture();
  future.schemaVersion = 11;
  assert.throws(() => parseAstrocartStyle(future), /unsupported AstrocartStyle schema/);

  const extended = fixture();
  extended.renderer.unversionedSetting = true;
  assert.throws(() => parseAstrocartStyle(extended), /unversionedSetting is not part of schema v10/);
});

test("only a validated immutable style crosses the iframe message boundary", () => {
  const message = createAstrocartStyleMessage(fixture());
  assert.equal(message.type, "aries.setDisplayStyle");
  assert.equal(message.payload.styleHash, "hash-1");
  assert.ok(Object.isFrozen(message));
  assert.ok(Object.isFrozen(message.payload));
});

test("the host's live UI font replaces the daemon fallback in map chrome", () => {
  const fallback = createAstrocartStyleMessage(fixture());
  const themed = createAstrocartStyleMessage(fixture(), {
    fontUi: "'Kosugi Aries', 'FreeSans', sans-serif",
  });
  assert.equal(themed.payload.chrome.fontUi, "'Kosugi Aries', 'FreeSans', sans-serif");
  assert.notEqual(fallback.payload.chrome.fontUi, themed.payload.chrome.fontUi);
  assert.ok(Object.isFrozen(themed.payload.chrome));
  assert.equal(
    createAstrocartStyleMessage(fixture(), { fontUi: "  " }).payload.chrome.fontUi,
    fallback.payload.chrome.fontUi,
  );
});

test("the map registers the app UI font faces the host sends", async () => {
  const [map, workspace] = await Promise.all([
    readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8"),
    readFile(new URL("../src/components/workshell/workspace-content.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(map, /case 'aries\.setUiFontFaces':/);
  assert.match(map, /new FontFace\(face\.family, face\.data, descriptors\)/);
  assert.match(workspace, /createAstrocartStyleMessage\(payload, \{\s*fontUi: appUiFontStack\(\),/);
  assert.match(workspace, /type: "aries\.setUiFontFaces", payload: \{ faces \}/);
});

test("glyph line labels are upright chrome chips drawn as map icons", async () => {
  const map = await readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8");
  assert.match(map, /'showHouseLines', 'showZodiacLines', 'lineLabelGlyphs', 'localSpaceBearings',/);
  // Upright, collision-managed icons instead of rotated text with inline images.
  assert.match(map, /'icon-rotation-alignment': 'viewport'/);
  // One chip per line and paran, anchored on its own point source.
  assert.match(map, /const ACG_CHIP_SOURCE_ID = 'acg-chip-anchors';/);
  assert.match(map, /if \(motionSettled\) scheduleAcgChipAnchors\(\);/);
  // Point glyphs are never inline images in rotated text any more.
  assert.doesNotMatch(map, /acgGlyphImagePrefix|acg-glyph\|/);
  // Parans carry both glyphs, keyed to each body's colour.
  assert.match(map, /side\('a'\)[\s\S]*side\('b'\)/);
  assert.match(map, /if \(a\.color\) props\.a_color = a\.color;/);
  // The card wears the map chrome tokens; only the glyph is coloured.
  for (const token of ["--chrome-bg", "--chrome-border", "--chrome-text", "--chrome-panel-radius"]) {
    assert.ok(map.includes(`acgChipToken('${token}'`), `chip reads ${token}`);
  }
  assert.match(map, /background: print \? PRINT_ATLAS_OVERLAY_HALO : acgChipToken\('--chrome-bg'/);
  assert.match(map, /border: print \? 'rgba\(0,0,0,0\.12\)' : acgChipToken\('--chrome-border'/);
  assert.doesNotMatch(map, /id="acg-dom-labels"/);
  // Both the live and the print map draw chips on demand, only once Morinus is ready.
  assert.match(map, /map\.on\('styleimagemissing', \(event\) => \{\s*provideAcgChipImage\(map,/);
  assert.match(map, /printMap\.on\('styleimagemissing', \(event\) => \{\s*provideAcgChipImage\(printMap,/);
  assert.match(map, /document\.fonts\.check\('12px Morinus'\)/);
});

test("chip glyph colours are lifted to readable contrast on the card", async () => {
  const map = await readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8");
  const start = map.indexOf("function acgChipLuminance");
  const end = map.indexOf("function acgChipSegments", start);
  assert.ok(start >= 0 && end > start);
  const colours = { "#000080": [0, 0, 128, 255], "rgba(29,30,33,0.88)": [29, 30, 33, 224], "#ffd700": [255, 215, 0, 255], "rgba(255,255,255,0.94)": [255, 255, 255, 240] };
  const readable = new Function("colours", `
    const acgChipColorCache = new Map();
    function acgChipRgba(value) { const c = colours[value]; return c ? [c[0], c[1], c[2], c[3] / 255] : null; }
    ${map.slice(start, end)}
    return { acgChipReadableColor, acgChipLuminance };
  `)(colours);
  const ratio = (rgb, bg) => {
    const a = readable.acgChipLuminance(rgb);
    const b = readable.acgChipLuminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const parse = (value) => value.match(/\d+/g).slice(0, 3).map(Number);
  // Navy on the dark chrome card is lightened; yellow on a print card is darkened.
  const navy = parse(readable.acgChipReadableColor("#000080", "rgba(29,30,33,0.88)"));
  assert.ok(ratio(navy, [29, 30, 33]) >= 3);
  const gold = parse(readable.acgChipReadableColor("#ffd700", "rgba(255,255,255,0.94)"));
  assert.ok(ratio(gold, [255, 255, 255]) >= 3);
});

test("copy as PNG captures the live map viewport without UI chrome", async () => {
  const [map, workspace] = await Promise.all([
    readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8"),
    readFile(new URL("../src/components/workshell/workspace-content.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(map, /case 'aries\.captureViewport':/);
  assert.match(map, /map\.once\('render', \(\) => \{/);
  assert.match(map, /'#map \.maplibregl-marker, #map \.maplibregl-marker \*'/);
  assert.doesNotMatch(map, /#place-labels \*|#acg-dom-labels \*/);
  assert.doesNotMatch(map.slice(map.indexOf("async function captureViewportPng"), map.indexOf("function postToParent")), /top-controls|#legend/);
  assert.match(workspace, /registerChartExportRenderer\(id, renderViewport\)/);
  assert.match(workspace, /const ids = \[documentId, \.\.\.layerDocumentIdsKey\.split\(","\)\.filter\(Boolean\)\];/);
});

test("all generated profile bounds equal the strict iframe envelope", () => {
  const publicTokens = rendererContract.publicTokens;
  const entries = Object.entries(ASTROCART_RENDER_TOKEN_SPECS);
  assert.equal(entries.length, 149);
  for (const [key, [cssVar]] of entries) {
    let field = key.startsWith("map")
      ? key.slice(3, 4).toLowerCase() + key.slice(4)
      : key.startsWith("chrome")
        ? key.slice(6, 7).toLowerCase() + key.slice(7)
      : key;
    if (field === "paranLineOpacity") field = "paranOpacity";
    let expected = ASTROCART_RENDERER_NUMBER_BOUNDS[field] ?? ASTROCART_CHROME_NUMBER_BOUNDS[field];
    if (!expected && field.endsWith("LineWidthScale")) {
      expected = ASTROCART_POINT_LINE_WIDTH_SCALE_BOUNDS;
    }
    if (!expected && field.endsWith("LineOpacity")) {
      expected = ASTROCART_POINT_LINE_OPACITY_BOUNDS;
    }
    assert.ok(expected, `${key} has no strict runtime bound`);
    assert.deepEqual(
      { min: publicTokens[cssVar].bounds.min, max: publicTokens[cssVar].bounds.max },
      { min: expected[0], max: expected[1] },
      cssVar,
    );
  }
});

test("the bundled iframe script remains syntactically valid", async () => {
  const html = await readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((source) => source.trim());
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0]));
  const contractStart = scripts[0].indexOf("const ASTROCART_STYLE_SCHEMA_VERSION");
  const contractEnd = scripts[0].indexOf("function applyAstrocartChrome", contractStart);
  const iframeContract = new Function(
    `${scripts[0].slice(contractStart, contractEnd)}\nreturn { normalizeAstrocartStyle };`,
  )();
  assert.ok(iframeContract.normalizeAstrocartStyle(fixture()));
  for (const mutate of [
    (value) => { value.chrome.titlebarSafeTop = -1; },
    (value) => { value.renderer.solidWidth = -0.1; },
    (value) => { value.renderer.solidOpacity = 1.01; },
    (value) => { value.renderer.labelSize = 0; },
    (value) => { value.points.sun.lineWidthScale = 0.24; },
    (value) => { value.points.sun.lineOpacity = 1.01; },
  ]) {
    const malformed = fixture();
    mutate(malformed);
    assert.equal(iframeContract.normalizeAstrocartStyle(malformed), null);
  }
  const boundsStart = scripts[0].indexOf("const ASTROCART_RENDERER_NUMBER_BOUNDS");
  const boundsEnd = scripts[0].indexOf("});", boundsStart);
  const boundsBlock = scripts[0].slice(boundsStart, boundsEnd);
  const iframeBounds = Object.fromEntries(
    [...boundsBlock.matchAll(/([A-Za-z][A-Za-z0-9]*): Object\.freeze\(\[([0-9.]+), ([0-9.]+)\]\)/g)]
      .map((match) => [match[1], [Number(match[2]), Number(match[3])]]),
  );
  assert.deepEqual(iframeBounds, ASTROCART_RENDERER_NUMBER_BOUNDS);
  assert.match(
    scripts[0],
    /const ASTROCART_TITLEBAR_SAFE_TOP_BOUNDS = Object\.freeze\(\[0, 256\]\)/,
  );
  assert.match(
    scripts[0],
    /const ASTROCART_POINT_LINE_WIDTH_SCALE_BOUNDS = Object\.freeze\(\[0\.25, 3\]\)/,
  );
  assert.match(
    scripts[0],
    /const ASTROCART_POINT_LINE_OPACITY_BOUNDS = Object\.freeze\(\[0, 1\]\)/,
  );
  assert.match(scripts[0], /const ASTROCART_RENDERER_NUMBER_BOUNDS = Object\.freeze/);
  assert.match(
    scripts[0],
    /renderer\[key\] < bounds\[0\] \|\| renderer\[key\] > bounds\[1\]/,
  );
  assert.match(
    scripts[0],
    /chrome\.titlebarSafeTop < ASTROCART_TITLEBAR_SAFE_TOP_BOUNDS\[0\]/,
  );
  assert.match(
    scripts[0],
    /const ONLINE_BASEMAP_SOURCE_IDS = new Set\(\['openmaptiles', 'ne2_shaded'\]\)/,
  );
  assert.match(
    scripts[0],
    /!mapReady && ONLINE_BASEMAP_SOURCE_IDS\.has\(sourceId\)/,
  );
  assert.doesNotMatch(
    scripts[0],
    /if \(!mapReady\) switchToOfflineFallback\(\)/,
  );
  const parkLoopStart = scripts[0].indexOf("for (const id of PARK_LAYER_IDS)");
  const parkLoopEnd = scripts[0].indexOf("for (const id of HOSPITAL_FILL_LAYER_IDS)", parkLoopStart);
  const parkLoop = scripts[0].slice(parkLoopStart, parkLoopEnd);
  assert.match(parkLoop, /setLayerVisibility\(id, false\)/);
  assert.doesNotMatch(parkLoop, /setLayerVisibility\(id, true\)/);
  const prepareStyleStart = scripts[0].indexOf("function prepareBaseStyleForTheme");
  const prepareStyleEnd = scripts[0].indexOf("function loadBaseVectorStyle", prepareStyleStart);
  const prepareStyle = scripts[0].slice(prepareStyleStart, prepareStyleEnd);
  assert.match(
    prepareStyle,
    /HIDE_LAYER_IDS\.has\(layerId\) \|\| hasHiddenPrefix\(layerId\)/,
  );
  assert.match(prepareStyle, /visibility: 'none'/);

  const setterStart = scripts[0].indexOf("setDisplayStyle(payload) {");
  const setterEnd = scripts[0].indexOf("    setUiLabels(", setterStart);
  const setterContract = scripts[0].slice(setterStart, setterEnd);
  assert.ok(
    setterContract.indexOf("!mapReady") < setterContract.indexOf("applyDisplayStyle(style)"),
  );

});

test("the globe overlay clips source lines into both polar caps", async () => {
  const html = await readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8");
  const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((script) => script.includes("function clipLineToPolarCap"));
  assert.ok(source);
  const cutoff = Number(source.match(/const POLAR_OVERLAY_LATITUDE = ([0-9.]+);/)?.[1]);
  const helperStart = source.indexOf("function interpolateWrappedCoordinate");
  const helperEnd = source.indexOf("function geometryLineStrings", helperStart);
  const { clipLineToPolarCap, clipLineToMapBand } = new Function(
    `const POLAR_OVERLAY_LATITUDE = ${cutoff};\n${source.slice(helperStart, helperEnd)}\n` +
      "return { clipLineToPolarCap, clipLineToMapBand };",
  )();

  const meridianCaps = clipLineToPolarCap([[12, -89.999], [12, 89.999]]);
  assert.deepEqual(meridianCaps, [
    [[12, cutoff], [12, 89.999]],
    [[12, -89.999], [12, -cutoff]],
  ]);
  assert.deepEqual(clipLineToPolarCap([[0, 84], [10, 86]]), [
    [[5, cutoff], [10, 86]],
  ]);
  assert.deepEqual(clipLineToPolarCap([[-20, -40], [20, 40]]), []);
  assert.deepEqual(clipLineToMapBand([[12, -89.999], [12, 89.999]]), [
    [[12, -cutoff], [12, cutoff]],
  ]);
  assert.deepEqual(clipLineToMapBand([[0, 84], [10, 86]]), [
    [[0, 84], [5, cutoff]],
  ]);
  assert.deepEqual(clipLineToMapBand([[-180, 60], [180, 60]]), [
    [[-180, 60], [180, 60]],
  ]);
  assert.deepEqual(clipLineToMapBand([[0, 86], [20, 88]]), []);
});

test("polar asterism stars leave only the globe map copy and keep magnitude sizing", async () => {
  const html = await readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8");
  const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((script) => script.includes("function isPolarOverlayPoint"));
  assert.ok(source);
  const cutoff = Number(source.match(/const POLAR_OVERLAY_LATITUDE = ([0-9.]+);/)?.[1]);
  const pointHelpersStart = source.indexOf("function geometryLineStrings");
  const pointHelpersEnd = source.indexOf("function appendPolarOverlayPaths", pointHelpersStart);
  const radiusStart = source.indexOf("function asterismStarRadius(");
  const radiusEnd = source.indexOf("function hideAsterismStarPopup", radiusStart);
  const {
    isPolarOverlayPoint,
    clipFeatureCollectionToMapBand,
    asterismStarRadius,
  } = new Function(
    `const POLAR_OVERLAY_LATITUDE = ${cutoff};\n` +
      `${source.slice(radiusStart, radiusEnd)}\n` +
      `${source.slice(pointHelpersStart, pointHelpersEnd)}\n` +
      "return { isPolarOverlayPoint, clipFeatureCollectionToMapBand, asterismStarRadius };",
  )();

  const polarStar = {
    type: "Feature",
    properties: { id: "polaris", kind: "ASTERISM_STAR", magnitude: 1.98 },
    geometry: { type: "Point", coordinates: [12.25, 89.25] },
  };
  const ordinaryStar = {
    type: "Feature",
    properties: { id: "ordinary", kind: "ASTERISM_STAR", magnitude: 4.2 },
    geometry: { type: "Point", coordinates: [18, 84.5] },
  };
  const polarLabel = {
    type: "Feature",
    properties: { id: "label", kind: "ASTERISM_LABEL" },
    geometry: { type: "Point", coordinates: [12.25, 89.25] },
  };
  const data = { type: "FeatureCollection", features: [polarStar, ordinaryStar, polarLabel] };

  assert.equal(isPolarOverlayPoint(polarStar), true);
  assert.equal(isPolarOverlayPoint(ordinaryStar), false);
  assert.equal(isPolarOverlayPoint(polarLabel), false);
  assert.deepEqual(
    clipFeatureCollectionToMapBand(data, { omitPolarPoints: true }).features,
    [ordinaryStar, polarLabel],
  );
  assert.deepEqual(
    clipFeatureCollectionToMapBand(data, { omitPolarPoints: false }).features,
    [polarStar, ordinaryStar, polarLabel],
  );
  assert.deepEqual(polarStar.geometry.coordinates, [12.25, 89.25]);

  const settings = { asterismStarRadiusMin: 0.85, asterismStarRadiusMax: 3.8 };
  assert.equal(asterismStarRadius(-1.5, settings), settings.asterismStarRadiusMax);
  assert.equal(asterismStarRadius(6.7, settings), settings.asterismStarRadiusMin);
  const middleRadius = asterismStarRadius(2.5, settings);
  assert.ok(middleRadius > settings.asterismStarRadiusMin);
  assert.ok(middleRadius < settings.asterismStarRadiusMax);
});

test("polar eclipse support polygons clip cleanly across the wrapped cap boundary", async () => {
  const html = await readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8");
  const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((script) => script.includes("function clipRingToPolarCap"));
  assert.ok(source);
  const helperStart = source.indexOf("function interpolateWrappedCoordinate");
  const helperEnd = source.indexOf("function isPolarOverlayPoint", helperStart);
  const { clipRingToPolarCap } = new Function(
    `const POLAR_OVERLAY_LATITUDE = 85;\n${source.slice(helperStart, helperEnd)}\n` +
      "return { clipRingToPolarCap };",
  )();

  assert.deepEqual(
    clipRingToPolarCap([[0, 80], [10, 84], [20, 86], [30, 80], [0, 80]], 82),
    [[[5, 82], [10, 84], [20, 86], [26.66666666666663, 82], [5, 82]]],
  );
  assert.deepEqual(
    clipRingToPolarCap([[170, 80], [-170, 84], [-160, 86], [160, 80], [170, 80]], 82),
    [[[-180, 82], [-170, 84], [-160, 86], [173.33333333333337, 82], [-180, 82]]],
  );
  assert.deepEqual(
    clipRingToPolarCap([[0, -80], [10, -84], [20, -86], [30, -80], [0, -80]], 82),
    [[[5, -82], [10, -84], [20, -86], [26.66666666666663, -82], [5, -82]]],
  );
});

test("eclipse framing wraps the dateline and anchors the maximum point", async () => {
  const html = await readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8");
  const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((script) => script.includes("function minimalWrappedLongitudeBounds"));
  assert.ok(source);
  const helperStart = source.indexOf("function forEachGeojsonCoord");
  const helperEnd = source.indexOf("function applyVectorBasemapStyle", helperStart);
  const cameraCalls = [];
  const fakeMap = {
    cameraForBounds(bounds, options) {
      cameraCalls.push({ type: "cameraForBounds", bounds, options });
      return { zoom: 3.25 };
    },
    easeTo(options) {
      cameraCalls.push({ type: "easeTo", options });
    },
    fitBounds() {
      assert.fail("maximum-point eclipse framing must use the resolved camera");
    },
  };
  const { minimalWrappedLongitudeBounds, fitFeatureCollection } = new Function(
    "map",
    `function globeZoomForViewport() { return 2; }\n${source.slice(helperStart, helperEnd)}\n` +
      "return { minimalWrappedLongitudeBounds, fitFeatureCollection };",
  )(fakeMap);

  assert.deepEqual(minimalWrappedLongitudeBounds([170, -170]), [170, 190]);
  assert.deepEqual(minimalWrappedLongitudeBounds([-170, -160]), [-170, -160]);
  assert.deepEqual(minimalWrappedLongitudeBounds([-10, 10]), [-10, 10]);

  fitFeatureCollection({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "ECLIPSE_CENTER" },
        geometry: { type: "MultiLineString", coordinates: [[[170, -44], [180, -42]], [[-180, -42], [-160, -38]]] },
      },
      {
        type: "Feature",
        properties: { kind: "ECLIPSE_MAX" },
        geometry: { type: "Point", coordinates: [176.5, -41.25] },
      },
    ],
  });

  assert.deepEqual(cameraCalls[0].bounds, [[170, -44], [200, -38]]);
  assert.deepEqual(cameraCalls[1], {
    type: "easeTo",
    options: { center: [176.5, -41.25], zoom: 3.25, duration: 500 },
  });
});

async function loadChipPlacement() {
  const map = await readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8");
  const slice = (startMarker, endMarker) => {
    const start = map.indexOf(startMarker);
    const end = map.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
    return map.slice(start, end);
  };
  const source = [
    slice("  function acgChipRunPosition", "  // Screen box a chip will occupy"),
    slice("  const ACG_CHIP_FRACTIONS", "  // options.shown(properties)"),
    slice("  function acgChipAnchorFilter", "  function acgNamedLabelLayout"),
  ].join("\n");
  return new Function(`
    ${source}
    return { acgChipRunPosition, acgChipRunPointAtRadius, acgChipCandidatePoints, acgChipAnchorFilter, ACG_CHIP_RADIAL_BANDS };
  `)();
}

function screenRun(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return { points, length };
}

test("local space chips ring the birthplace at one screen radius", async () => {
  const chips = await loadChipPlacement();
  const origin = { x: 500, y: 400, radius: 150 };
  // Spokes leave the birthplace toward the frame at different lengths; a
  // mid-run rule would trace the rectangle, the ring keeps one radius.
  for (const [dx, dy, reach] of [[1, 0, 480], [0, -1, 340], [0.8, 0.6, 520], [-0.6, 0.8, 300]]) {
    const run = screenRun(Array.from({ length: 41 }, (_, index) => ({
      x: origin.x + dx * reach * (index / 40),
      y: origin.y + dy * reach * (index / 40),
    })));
    const [first, ...bands] = chips.acgChipCandidatePoints({ kind: "LOCAL_SPACE" }, run, origin);
    assert.ok(Math.abs(Math.hypot(first.x - origin.x, first.y - origin.y) - 150) < 0.5);
    // Crowded spokes step to other bands rather than sliding along freely.
    for (const point of bands) {
      const factor = Math.hypot(point.x - origin.x, point.y - origin.y) / 150;
      assert.ok(chips.ACG_CHIP_RADIAL_BANDS.some((band) => Math.abs(band - factor) < 0.01));
    }
  }
});

test("other line chips sit at half the visible run, then step outward", async () => {
  const chips = await loadChipPlacement();
  const run = screenRun([{ x: 0, y: 100 }, { x: 400, y: 100 }]);
  const candidates = chips.acgChipCandidatePoints({ kind: "MC" }, run, { x: 0, y: 100, radius: 50 });
  assert.deepEqual(candidates.slice(0, 3).map((point) => point.x), [200, 152, 248]);
  // Without a visible birthplace, local space falls back to the midpoint too.
  assert.equal(chips.acgChipCandidatePoints({ kind: "LOCAL_SPACE" }, run, null)[0].x, 200);
});

test("chip anchor layers mirror their line filters with the stamped geometry", async () => {
  const chips = await loadChipPlacement();
  const filter = ["all", ["==", ["geometry-type"], "LineString"], ["match", ["get", "kind"], ["MC"], true, false]];
  assert.deepEqual(chips.acgChipAnchorFilter(filter), [
    "all",
    ["==", ["get", "acg_anchor_geometry"], "LineString"],
    ["match", ["get", "kind"], ["MC"], true, false],
  ]);
});

test("local space opposition labels carry the Morinus opposition glyph, not a word", async () => {
  const [map, service] = await Promise.all([
    readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8"),
    readFile(new URL("../../daemon/astrocart_service.py", import.meta.url), "utf8"),
  ]);
  // The daemon stamps the glyph (common.py Aspects[10]) on opposition features.
  assert.match(service, /_MORINUS_OPPOSITION_GLYPH = "W"/);
  assert.match(
    service,
    /if kind == localspace\.KIND_LOCAL_SPACE_OPPOSITION:\s+props\["aspect_glyph_morinus"\] = _MORINUS_OPPOSITION_GLYPH/,
  );
  // No label path appends the localized word any more.
  assert.doesNotMatch(map, /` \$\{uiLabels\.localSpaceOpposition\}`/);
  assert.doesNotMatch(map, /const opposition = kind === 'LOCAL_SPACE_OPPOSITION'/);
  // Names mode, vector: trailing Morinus glyph as an inline image, print-coloured in print.
  assert.match(map, /\['image', \['concat', acgInlineGlyphImagePrefix\(print\), \['get', 'aspect_glyph_morinus'\]\]\]/);
  assert.match(map, /lineLabels\.layout\['text-field'\] = acgLineLabelExpression\(true\);/);
  assert.match(map, /provideAcgInlineGlyphImage\(printMap, event && event\.id, pixelRatio\);/);
  assert.match(map, /provideAcgInlineGlyphImage\(map, event && event\.id, window\.devicePixelRatio \|\| 1\);/);
  // Glyph mode chips: fifth content field, drawn in the Morinus face.
  assert.match(map, /\['coalesce', \['get', 'aspect_glyph_morinus'\], ''\],\n    \];/);
  assert.match(map, /if \(kindGlyph\) segments\.push\(segment\(kindGlyph, labelColor, \{ glyph: true \}\)\);/);
  // The native chip image carries the same glyph on offline maps.
  assert.match(map, /\['coalesce', \['get', 'aspect_glyph_morinus'\], ''\]/);
  assert.match(map, /if \(kindGlyph\) segments\.push\(segment\(kindGlyph, labelColor, \{ glyph: true \}\)\);/);
  // The legend pairs the glyph with the explanatory word.
  assert.match(map, /id="legend-local-space-opposition-row"[^\n]*<span class="glyph legend-kind-glyph"><\/span>/);
});

test("local space bearing degrees follow the ACG Appearance switch", async () => {
  const [map, controls, service] = await Promise.all([
    readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8"),
    readFile(new URL("../src/components/workshell/astrocart-controls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../daemon/astrocart_service.py", import.meta.url), "utf8"),
  ]);
  // Daemon style behaviour carries the persisted view preference (default off).
  assert.match(service, /"localSpaceBearings": normalized_astrocart_local_space_bearings\(/);
  assert.match(service, /def normalized_astrocart_local_space_bearings\(value: Any\) -> bool:\n    return value is True/);
  assert.match(controls, /astrocart_local_space_bearings \?\? false/);
  // Appearance toggle writes the canonical display option.
  assert.match(controls, /updateAppearanceOption\("astrocart_local_space_bearings", shown\)/);
  assert.match(controls, /t\("astrocart\.config\.localSpaceBearings"\)/);
  // Map: vector and chip suffixes, plus the empty-suffix join, follow it.
  assert.match(map, /return referenceBehavior\(\)\.localSpaceBearings === true;/);
  assert.match(map, /const bearing = acgLocalSpaceBearings\(\)\n      \? \['coalesce', \['get', 'bearing_label'\]/);
  assert.match(map, /const bearing = acgLocalSpaceBearings\(\)\n        \? String\(p\.bearing_label/);
  assert.match(map, /acgChipImageExpression\(imageLayerId, print\)/);
  assert.match(map, /\['case', \['==', suffix, ''\], '', \['concat', ' ', suffix\]\]/);
  // A glyph-only chip still draws through the native symbol layer.
  assert.match(map, /'icon-image': acgChipImageExpression\(imageLayerId, print\)/);
});

test("a paran's single −180→180 segment is clipped into the view, not collapsed", async () => {
  const map = await readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8");
  const start = map.indexOf("  function acgChipSegmentWindows");
  const end = map.indexOf("  // Screen-space runs of the feature", start);
  assert.ok(start >= 0 && end > start);
  const windows = new Function(`${map.slice(start, end)}\nreturn acgChipSegmentWindows;`)();
  const camera = { west: 5, east: 20, south: 40, north: 55 };
  const [window] = windows([-180, 48], [180, 48], camera);
  assert.equal(window.shift, 0);
  assert.ok(Math.abs(-180 + 360 * window.t0 - 5) < 1e-9);
  assert.ok(Math.abs(-180 + 360 * window.t1 - 20) < 1e-9);
  // Across the antimeridian the adjacent world copy supplies the rest.
  const wrapped = windows([-180, 48], [180, 48], { west: 170, east: 200, south: 40, north: 55 });
  assert.deepEqual(wrapped.map((entry) => entry.shift).sort(), [0, 360]);
  // Off-latitude parans stay out.
  assert.deepEqual(windows([-180, 70], [180, 70], camera), []);
});

test("paran chips are the quieter secondary tier", async () => {
  const map = await readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8");
  assert.match(map, /const ACG_PARAN_CHIP_SIZE_STEP = 2;/);
  assert.match(map, /kind === 'paran' \? acgParanChipSize\(s\) : s\.labelSize/);
  assert.match(map, /const textWeight = secondary \? 500 : 600;/);
  assert.match(map, /ACG_PARAN_CHIP_OPACITY = 0\.85/);
  assert.match(map, /sourceLayerId === 'acg-paran-labels'[\s\S]*ACG_PARAN_CHIP_OPACITY/);
});

test("overlapping local space pills step along their line instead of hiding", async () => {
  const map = await readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8");
  // Ring spots continue out and in along the spoke, so a conjunction offsets.
  const bands = /const ACG_CHIP_RADIAL_BANDS = \[([^\]]+)\]/.exec(map);
  assert.ok(bands, "radial bands declared");
  const values = bands[1].split(",").map((value) => Number(value.trim())).filter(Number.isFinite);
  assert.ok(values.length >= 12, "enough ring spots to clear a conjunction");
  assert.ok(Math.max(...values) >= 3, "steps well out along the line");
  // Native chip anchors try each band and reserve a box before MapLibre's
  // collision pass, so nearby spokes can keep separate labels.
  assert.match(map, /for \(const band of ACG_CHIP_RADIAL_BANDS\)/);
  assert.match(map, /for \(const point of acgChipCandidatePoints\(entry\.properties, entry\.run, origin\)\)/);
  assert.match(map, /const box = acgChipEstimatedBox\(entry\.properties, candidate\.point\)/);
  assert.match(map, /if \(placed\.some\(\(other\) => acgChipBoxesOverlap\(box, other\)\)\) continue;/);
});
