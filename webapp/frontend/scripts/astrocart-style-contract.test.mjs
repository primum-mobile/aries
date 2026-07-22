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
      localSpaceAdditive: false,
      showEcliptic: true,
      showEquator: true,
      showAscCircle: true,
      showMcCircle: true,
      showHouseLines: true,
      showZodiacLines: true,
      terrainRelief: true,
    },
  };
}

test("the adapter validates and freezes all 20 chrome plus 160 renderer values", () => {
  assert.equal(ASTROCART_CHROME_STRING_FIELDS.length + 1, 20);
  assert.equal(
    ASTROCART_RENDERER_STRING_FIELDS.length +
      ASTROCART_RENDERER_NUMBER_FIELDS.length +
      ASTROCART_RENDERER_BOOLEAN_FIELDS.length,
    160,
  );
  const style = parseAstrocartStyle(fixture());
  assert.equal(style.schemaVersion, 8);
  assert.equal(style.chrome.titlebarSafeTop, 34);
  assert.equal(Object.keys(style.renderer).length, 160);
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
  assert.throws(() => parseAstrocartStyle(extendedPoint), /unversionedSetting is not part of schema v8/);

  const future = fixture();
  future.schemaVersion = 9;
  assert.throws(() => parseAstrocartStyle(future), /unsupported AstrocartStyle schema/);

  const extended = fixture();
  extended.renderer.unversionedSetting = true;
  assert.throws(() => parseAstrocartStyle(extended), /unversionedSetting is not part of schema v8/);
});

test("only a validated immutable style crosses the iframe message boundary", () => {
  const message = createAstrocartStyleMessage(fixture());
  assert.equal(message.type, "aries.setDisplayStyle");
  assert.equal(message.payload.styleHash, "hash-1");
  assert.ok(Object.isFrozen(message));
  assert.ok(Object.isFrozen(message.payload));
});

test("all generated profile bounds equal the strict iframe envelope", () => {
  const publicTokens = rendererContract.publicTokens;
  const entries = Object.entries(ASTROCART_RENDER_TOKEN_SPECS);
  assert.equal(entries.length, 133);
  for (const [key, [cssVar]] of entries) {
    let field = key.startsWith("map")
      ? key.slice(3, 4).toLowerCase() + key.slice(4)
      : key;
    if (field === "paranLineOpacity") field = "paranOpacity";
    let expected = ASTROCART_RENDERER_NUMBER_BOUNDS[field];
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
