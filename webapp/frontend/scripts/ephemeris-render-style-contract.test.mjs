// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const styleSource = await readSource(
  new URL("../src/lib/chart/ephemeris-render-style.ts", import.meta.url),
);
const styleJavascript = ts.transpileModule(styleSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  applyEphemerisPlanetProfileColors,
  DEFAULT_EPHEMERIS_RENDER_PALETTE,
  DEFAULT_EPHEMERIS_RENDER_TOKENS,
  EPHEMERIS_RENDER_BASE_PALETTE_ROLES,
  EPHEMERIS_RENDER_TOKEN_SPECS,
  createEphemerisRenderStyle,
  ephemerisPlanetColorIndex,
  resolveEphemerisRenderPalette,
  resolveEphemerisRenderStyle,
  resolveEphemerisRenderTokens,
} = await import(
  `data:text/javascript;base64,${Buffer.from(styleJavascript).toString("base64")}`
);

const EXPECTED_DEFAULTS = {
  minCanvasWidth: 40,
  minCanvasHeight: 40,
  planetFontDivisor: 40,
  borderPlanetScale: 1,
  spaceDivisor: 3,
  plotLeftBorderScale: 2,
  plotRightBorderScale: 2,
  axisXBorderScale: 2,
  axisSignXBorderScale: 2,
  outerBorderScale: 1,
  bottomAxisBorderScale: 4,
  signOuterMarginRows: 2,
  axisReserveSignScale: 0.5,
  signFontScale: 1,
  monthColumns: 13,
  textFontDivisor: 3,
  frameSmallMax: 400,
  frameMediumMax: 600,
  frameWidthSmall: 2,
  frameWidthMedium: 3,
  frameWidthLarge: 4,
  curveSmallMax: 500,
  curveWidthSmall: 1,
  curveWidthLarge: 2,
  gridLineWidth: 1,
  gridDashOn: 6,
  gridDashOff: 3,
  stationTickScale: 0.22,
  stationTickMin: 4,
  stationTickMax: 9,
  stationTickLineWidth: 1,
  eventGlyphScale: 0.9,
  eventGlyphMin: 6,
  eventGlyphMax: 10,
  eventCodeOffsetXMin: 2,
  eventCodeOffsetYMin: 1,
  leftPlanetLabelGapSpaces: 3,
  edgeWrapLabelGapSpaces: 2,
  labelYGapSpaces: 1,
  relaxIterations: 30,
  stationSnapX: 10,
  stationSnapY: 16,
};

function flattenStyle(style) {
  return {
    minCanvasWidth: style.layout.minCanvasWidth,
    minCanvasHeight: style.layout.minCanvasHeight,
    planetFontDivisor: style.typography.planetFontDivisor,
    borderPlanetScale: style.layout.borderPlanetScale,
    spaceDivisor: style.layout.spaceDivisor,
    plotLeftBorderScale: style.layout.plotLeftBorderScale,
    plotRightBorderScale: style.layout.plotRightBorderScale,
    axisXBorderScale: style.layout.axisXBorderScale,
    axisSignXBorderScale: style.layout.axisSignXBorderScale,
    outerBorderScale: style.layout.outerBorderScale,
    bottomAxisBorderScale: style.layout.bottomAxisBorderScale,
    signOuterMarginRows: style.layout.signOuterMarginRows,
    axisReserveSignScale: style.layout.axisReserveSignScale,
    signFontScale: style.typography.signFontScale,
    monthColumns: style.layout.monthColumns,
    textFontDivisor: style.typography.textFontDivisor,
    frameSmallMax: style.strokes.frameSmallMax,
    frameMediumMax: style.strokes.frameMediumMax,
    frameWidthSmall: style.strokes.frameWidthSmall,
    frameWidthMedium: style.strokes.frameWidthMedium,
    frameWidthLarge: style.strokes.frameWidthLarge,
    curveSmallMax: style.strokes.curveSmallMax,
    curveWidthSmall: style.strokes.curveWidthSmall,
    curveWidthLarge: style.strokes.curveWidthLarge,
    gridLineWidth: style.strokes.gridLineWidth,
    gridDashOn: style.strokes.gridDashOn,
    gridDashOff: style.strokes.gridDashOff,
    stationTickScale: style.markers.stationTickScale,
    stationTickMin: style.markers.stationTickMin,
    stationTickMax: style.markers.stationTickMax,
    stationTickLineWidth: style.strokes.stationTickLineWidth,
    eventGlyphScale: style.markers.eventGlyphScale,
    eventGlyphMin: style.markers.eventGlyphMin,
    eventGlyphMax: style.markers.eventGlyphMax,
    eventCodeOffsetXMin: style.markers.eventCodeOffsetXMin,
    eventCodeOffsetYMin: style.markers.eventCodeOffsetYMin,
    leftPlanetLabelGapSpaces: style.labels.leftPlanetLabelGapSpaces,
    edgeWrapLabelGapSpaces: style.labels.edgeWrapLabelGapSpaces,
    labelYGapSpaces: style.labels.labelYGapSpaces,
    relaxIterations: style.labels.relaxIterations,
    stationSnapX: style.interaction.stationSnapX,
    stationSnapY: style.interaction.stationSnapY,
  };
}

test("the default contract preserves all 42 established Canvas values", () => {
  assert.equal(Object.keys(EPHEMERIS_RENDER_TOKEN_SPECS).length, 42);
  assert.equal(new Set(Object.values(EPHEMERIS_RENDER_TOKEN_SPECS).map(([name]) => name)).size, 42);
  assert.deepEqual(DEFAULT_EPHEMERIS_RENDER_TOKENS, EXPECTED_DEFAULTS);
  assert.ok(Object.isFrozen(EPHEMERIS_RENDER_TOKEN_SPECS));
  assert.ok(Object.values(EPHEMERIS_RENDER_TOKEN_SPECS).every(Object.isFrozen));
  assert.ok(Object.isFrozen(DEFAULT_EPHEMERIS_RENDER_TOKENS));

  const style = createEphemerisRenderStyle();
  assert.equal(style.schemaVersion, 1);
  assert.deepEqual(flattenStyle(style), EXPECTED_DEFAULTS);
  for (const group of [style, style.palette, style.typography, style.strokes, style.markers, style.labels, style.layout, style.interaction]) {
    assert.ok(Object.isFrozen(group));
  }
  assert.equal("tokens" in style, false);
});

test("active profile palette roles overlay retained colors and deactivate exactly", () => {
  const retained = Object.freeze({
    background: "retained-background",
    frame: "retained-frame",
    texts: "retained-texts",
    grid: "retained-grid",
    signs: "retained-signs",
  });
  assert.deepEqual(EPHEMERIS_RENDER_BASE_PALETTE_ROLES, {
    background: "--morinus-background",
    frame: "--morinus-frame",
    texts: "--morinus-text-bright",
    grid: "--morinus-houses",
    signs: "--morinus-signs",
    outOfBounds: "--aries-destructive",
  });

  const active = resolveEphemerisRenderPalette(retained, {
    "--morinus-background": " profile-background ",
    "--morinus-frame": "profile-frame",
    "--morinus-text-bright": "profile-texts",
    "--morinus-houses": "profile-grid",
    "--morinus-signs": "profile-signs",
    "--aries-destructive": "profile-out-of-bounds",
    "--aries-background": "must-not-leak-from-app-chrome",
  });
  assert.deepEqual(active, {
    background: "profile-background",
    frame: "profile-frame",
    texts: "profile-texts",
    grid: "profile-grid",
    signs: "profile-signs",
    outOfBounds: "profile-out-of-bounds",
  });
  assert.ok(Object.isFrozen(active));

  const deactivated = resolveEphemerisRenderPalette(retained, {});
  assert.deepEqual(deactivated, {
    ...retained,
    outOfBounds: DEFAULT_EPHEMERIS_RENDER_PALETTE.outOfBounds,
  });
  assert.ok(Object.isFrozen(deactivated));
  assert.deepEqual(resolveEphemerisRenderPalette(), DEFAULT_EPHEMERIS_RENDER_PALETTE);
});

test("profile planet arrays follow daemon color indexes without mutating retained series", () => {
  assert.deepEqual(
    [-2, 0, 9, 10, 11, 11.9, 12, 14, 15, 99].map(ephemerisPlanetColorIndex),
    [0, 0, 9, 10, 10, 11, 11, 11, 12, 11],
  );

  const retained = Object.freeze([
    Object.freeze({ id: 0, color: "retained-sun", label: "Sun" }),
    Object.freeze({ id: 9, color: "retained-pluto", label: "Pluto" }),
    Object.freeze({ id: 11, color: "retained-true-node", label: "True node" }),
    Object.freeze({ id: 15, color: "retained-chiron", label: "Chiron" }),
    Object.freeze({ id: 99, color: "retained-unknown", label: "Unknown" }),
  ]);
  const profileColors = Array.from({ length: 13 }, (_, index) => `profile-${index}`);
  const active = applyEphemerisPlanetProfileColors(retained, profileColors);
  assert.deepEqual(active.map(({ color }) => color), [
    "profile-0",
    "profile-9",
    "profile-10",
    "profile-12",
    "profile-11",
  ]);
  assert.deepEqual(retained.map(({ color }) => color), [
    "retained-sun",
    "retained-pluto",
    "retained-true-node",
    "retained-chiron",
    "retained-unknown",
  ]);
  assert.ok(Object.isFrozen(active));
  assert.notEqual(active, retained);

  const shortProfile = applyEphemerisPlanetProfileColors(retained, ["sun-only"]);
  assert.deepEqual(shortProfile.map(({ color }) => color), [
    "sun-only",
    "sun-only",
    "sun-only",
    "sun-only",
    "sun-only",
  ]);
  assert.equal(applyEphemerisPlanetProfileColors(retained, undefined), retained);
  assert.equal(applyEphemerisPlanetProfileColors(retained, []), retained);
});

test("the pure CSS resolver preserves parseFloat, zero, and fallback behavior", () => {
  const values = new Map([
    ["--aries-ephem-min-canvas-width", "72px"],
    ["--aries-ephem-grid-dash-on", "0"],
    ["--aries-ephem-frame-width-large", "4.75px trailing"],
    ["--aries-ephem-station-snap-x", "-3px"],
    ["--aries-ephem-event-glyph-max", "not-a-number"],
  ]);
  const resolved = resolveEphemerisRenderTokens((name) => values.get(name) ?? "");

  assert.equal(resolved.minCanvasWidth, 72);
  assert.equal(resolved.gridDashOn, 0);
  assert.equal(resolved.frameWidthLarge, 4.75);
  assert.equal(resolved.stationSnapX, EXPECTED_DEFAULTS.stationSnapX);
  assert.equal(resolved.eventGlyphMax, EXPECTED_DEFAULTS.eventGlyphMax);
  assert.ok(Object.isFrozen(resolved));
});

test("active profile metrics win stale CSS directly and deactivation returns to CSS", () => {
  const cssValues = new Map([
    ["--aries-ephem-planet-font-divisor", "40"],
    ["--aries-ephem-grid-line-width", "1px"],
  ]);
  const readCss = (name) => cssValues.get(name) ?? "";
  const active = resolveEphemerisRenderTokens(readCss, {
    "--aries-ephem-planet-font-divisor": "52",
    "--aries-ephem-grid-line-width": "2.5px",
  });
  assert.equal(active.planetFontDivisor, 52);
  assert.equal(active.gridLineWidth, 2.5);

  const deactivated = resolveEphemerisRenderTokens(readCss, {});
  assert.equal(deactivated.planetFontDivisor, 40);
  assert.equal(deactivated.gridLineWidth, 1);
});

test("pure tokens and the grouped style are exactly equivalent", () => {
  const cssValues = new Map();
  let next = 0.25;
  for (const [, [cssVar]] of Object.entries(EPHEMERIS_RENDER_TOKEN_SPECS)) {
    cssValues.set(cssVar, `${next}px`);
    next += 0.25;
  }
  const tokens = resolveEphemerisRenderTokens((name) => cssValues.get(name) ?? "");
  const palette = { ...DEFAULT_EPHEMERIS_RENDER_PALETTE, background: "custom-background" };
  const style = createEphemerisRenderStyle({
    revision: 17,
    palette,
    fontUi: "Custom UI",
    fontSymbols: "Custom Symbols",
    tokens,
  });

  palette.background = "mutated";
  assert.deepEqual(flattenStyle(style), tokens);
  assert.equal(style.revision, 17);
  assert.equal(style.palette.background, "custom-background");
  assert.equal(style.typography.fontUi, "Custom UI");
  assert.equal(style.typography.fontSymbols, "Custom Symbols");
});

test("host resolution is equivalent to creating a style from the same pure tokens", () => {
  const originalWindow = globalThis.window;
  const cssValues = new Map([
    ["--aries-ephem-planet-font-divisor", "48"],
    ["--aries-ephem-station-snap-y", "21px"],
  ]);
  globalThis.window = {
    getComputedStyle: () => ({
      getPropertyValue: (name) => cssValues.get(name) ?? "",
    }),
  };
  try {
    const input = {
      revision: "test-revision",
      palette: DEFAULT_EPHEMERIS_RENDER_PALETTE,
      fontUi: "UI",
      fontSymbols: "Symbols",
    };
    const fromHost = resolveEphemerisRenderStyle({}, input);
    const fromPureTokens = createEphemerisRenderStyle({
      ...input,
      tokens: resolveEphemerisRenderTokens((name) => cssValues.get(name) ?? ""),
    });
    assert.deepEqual(fromHost, fromPureTokens);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("one resolved style object feeds paint, geometry, hit testing, and canvas export", async () => {
  const source = await readSource(
    new URL("../src/components/workshell/graph-ephemeris-view.tsx", import.meta.url),
  );
  assert.equal((source.match(/resolveEphemerisRenderStyle\(/g) ?? []).length, 1);
  assert.match(source, /const renderStyle = resolveEphemerisRenderStyle\(wrap,/);
  assert.match(source, /theme\?\.profileOverrides\.chartPalette/);
  assert.match(source, /theme\?\.profileOverrides\.chartData\.planets/);
  assert.match(source, /resolveEphemerisRenderPalette\(/);
  assert.match(source, /applyEphemerisPlanetProfileColors\(payload\.planets, profilePlanetColors\)/);
  assert.match(source, /palette: effectivePalette/);
  assert.match(source, /profileOverrides: chartProfileOverrides/);
  assert.match(source, /render\([\s\S]*?effectivePayload,[\s\S]*?showEventGlyphs,[\s\S]*?renderStyle,/);
  assert.match(source, /for \(const marker of payload\.outOfBounds \?\? \[\]\)[\s\S]*?const north = marker\.value >= 0;[\s\S]*?y \+ \(north \? -labelGap : labelGap\)[\s\S]*?outOfBoundsMarkerLabel,[\s\S]*?font: style\.typography\.fontUi,[\s\S]*?size: eventGlyphSize\(geo, style\),[\s\S]*?fill: colors\.outOfBounds,[\s\S]*?baseline: north \? "bottom" : "top"/);
  assert.doesNotMatch(source, /outOfBoundsMarkerLabel,[\s\S]{0,180}?morinus\(/);
  assert.match(source, /computeGeometry\(cssW, cssH, mode, measure, style\)/);
  assert.match(source, /renderStyleRef\.current = renderStyle/);
  assert.match(source, /const renderStyle = renderStyleRef\.current;[\s\S]*?renderStyle\.interaction\.stationSnapX/);
  assert.match(
    source,
    /style=\{payload\?\.colors\?\.background \? \{ backgroundColor: effectivePalette\.background \} : undefined\}/,
  );
  assert.match(source, /colors=\{effectivePalette\}/);
  assert.match(source, /\(effectivePayload\?\.planets \?\? \[\]\)\.map/);
  assert.doesNotMatch(source, /readEphemerisRenderTokens|renderTokensRef|style\.tokens/);

  assert.match(source, /const ephemerisDataKey = useEphemerisDataKey\(\)/);
  const ephemerisDataKeyHook = source.slice(
    source.indexOf("function useEphemerisDataKey"),
    source.indexOf("function positive"),
  );
  assert.match(ephemerisDataKeyHook, /lastOptionsChange\?\.ephemerisDataKey/);
  assert.doesNotMatch(ephemerisDataKeyHook, /listDataChanged|styleOnly/);
  assert.match(source, /ephemerisCacheKey\(ephemerisDataKey, target\.year, target\.month\)/);
  assert.doesNotMatch(
    source,
    /activeProfileFingerprint|themeStyleHash|pendingProfileStyleHashesRef/,
  );

  const fetchBlock = source.slice(
    source.indexOf("// --- Series fetch."),
    source.indexOf("// --- Paint"),
  );
  assert.doesNotMatch(
    fetchBlock,
    /chartProfileOverrides|profilePlanetColors|effectivePalette|effectivePayload/,
  );
  assert.match(
    fetchBlock,
    /\}, \[[\s\S]*anchorYear,[\s\S]*anchorMonth,[\s\S]*applyMarkers,[\s\S]*applyPayload,[\s\S]*ephemerisDataKey,[\s\S]*requiresEventMarkers,[\s\S]*\]\);/,
  );
  assert.doesNotMatch(source, /refresh_all_sessions|recalc/);

  const saveBlock = source.match(/const savePng = React\.useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[payload\]\);/);
  assert.ok(saveBlock);
  assert.match(saveBlock[1], /canvas\.toBlob\(/);
  assert.doesNotMatch(saveBlock[1], /render\(|resolveEphemerisRenderStyle\(/);
});

async function readSource(url) {
  return (await readFile(url, "utf8")).replace(/\r\n?/g, "\n");
}
