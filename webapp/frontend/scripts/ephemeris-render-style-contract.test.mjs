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
  EPHEMERIS_BODY_COLOR_VARS,
  EPHEMERIS_DIGNITY_COLOR_VARS,
  EPHEMERIS_RENDER_BASE_PALETTE_ROLES,
  EPHEMERIS_RENDER_TOKEN_SPECS,
  EPHEMERIS_THEME_COLOR_ROLES,
  resolveEphemerisInkColors,
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
  planetFontDivisor: 48,
  planetFontMin: 10,
  planetFontMax: 16,
  spaceDivisor: 3,
  plateInsetScale: 1.25,
  headerBandScale: 2.3,
  wrapBandScale: 2.75,
  timeBandScale: 3.2,
  signTableScale: 2.3,
  modalityCellPadSpaces: 2,
  startGutterPadSpaces: 1,
  degreeRulerScale: 2.3,
  limbWidthSpaces: 2,
  limbBarShare: 0.45,
  headerFontScale: 0.95,
  textFontScale: 0.88,
  tableFontScale: 0.73,
  signFontScale: 1.15,
  modalityGlyphScale: 0.77,
  edgeSignFontScale: 0.8,
  startSignFontScale: 0.77,
  stationFontScale: 0.65,
  frameSmallMax: 400,
  frameMediumMax: 600,
  frameWidthSmall: 1,
  frameWidthMedium: 1,
  frameWidthLarge: 1,
  plateFrameWidth: 1,
  hairlineWidth: 0.75,
  curveWidthSun: 1.6,
  curveWidthInner: 1.15,
  curveWidthOuter: 1,
  curveWidthMoon: 0.8,
  curveWidthHighlight: 2,
  tierOuterWidthScale: 0.9,
  gridLineWidth: 1,
  gridDashOn: 1,
  gridDashOff: 3,
  guideOpacity: 0.65,
  outOfBoundsTintOpacity: 0.14,
  inkContrastRatioMin: 2.2,
  eventGlyphScale: 0.9,
  eventGlyphMin: 6,
  eventGlyphMax: 10,
  eventCodeOffsetYMin: 1,
  stationLetterOffsetScale: 0.65,
  turnDotScale: 0.22,
  startSignOffsetScale: 1.15,
  startLabelGapScale: 1,
  edgeLabelGapScale: 1,
  edgeLabelMaxShiftScale: 1.5,
  labelYGapSpaces: 1,
  stationSnapX: 10,
  stationSnapY: 16,
  tickWidth: 0.75,
  minorTickWidth: 0.75,
  rulerMajorTickScale: 0.7,
  rulerMediumTickScale: 0.38,
  rulerMinorTickScale: 0.3,
  rulerFineTickScale: 0.2,
  rulerTickMin: 2,
  rulerTickMinSpacing: 3.5,
  rulerLabelScale: 0.8,
  rulerLabelGapSpaces: 0.5,
  lunationDiscScale: 0.5,
  lunationDiscMin: 5,
  lunationDiscMax: 9,
  lunationDiscOutlineWidth: 1,
  eclipseLetterScale: 0.72,
  radixColumnScale: 3.6,
  radixLineWidth: 1.25,
  radixMidpointLineWidth: 1,
  radixMidpointDashOn: 6,
  radixMidpointDashOff: 6,
  radixLineOpacity: 0.85,
  radixRingScale: 0.2,
  radixRingWidth: 1.25,
  radixLabelScale: 0.9,
  radixPairLabelScale: 0.78,
  radixAngleLineScale: 1.6,
  radixOuterWidthScale: 0.75,
  radixBandOpacity: 0.1,
  radixFocusBandScale: 1.4,
  radixRecedeOpacity: 0.4,
  radixRecedeFadeMs: 160,
  radixRecedeDelayMs: 80,
  radixFocusWidthScale: 1.6,
  radixFocusRingScale: 1.35,
  radixReadingGlyphScale: 0.7,
  radixContourGlyphScale: 0.75,
  radixContourCount: 2,
  planetContactGlyphScale: 0.85,
  planetContactKnockoutScale: 0.55,
  nowLineWidth: 1,
  nowLineOpacity: 0.55,
  nowTagPadScale: 0.5,
};

function flattenStyle(style) {
  return {
    minCanvasWidth: style.layout.minCanvasWidth,
    minCanvasHeight: style.layout.minCanvasHeight,
    planetFontDivisor: style.typography.planetFontDivisor,
    planetFontMin: style.typography.planetFontMin,
    planetFontMax: style.typography.planetFontMax,
    spaceDivisor: style.layout.spaceDivisor,
    plateInsetScale: style.layout.plateInsetScale,
    headerBandScale: style.layout.headerBandScale,
    wrapBandScale: style.layout.wrapBandScale,
    timeBandScale: style.layout.timeBandScale,
    signTableScale: style.layout.signTableScale,
    modalityCellPadSpaces: style.layout.modalityCellPadSpaces,
    startGutterPadSpaces: style.layout.startGutterPadSpaces,
    degreeRulerScale: style.layout.degreeRulerScale,
    limbWidthSpaces: style.layout.limbWidthSpaces,
    limbBarShare: style.layout.limbBarShare,
    headerFontScale: style.typography.headerFontScale,
    textFontScale: style.typography.textFontScale,
    tableFontScale: style.typography.tableFontScale,
    signFontScale: style.typography.signFontScale,
    modalityGlyphScale: style.typography.modalityGlyphScale,
    edgeSignFontScale: style.typography.edgeSignFontScale,
    startSignFontScale: style.typography.startSignFontScale,
    stationFontScale: style.typography.stationFontScale,
    frameSmallMax: style.strokes.frameSmallMax,
    frameMediumMax: style.strokes.frameMediumMax,
    frameWidthSmall: style.strokes.frameWidthSmall,
    frameWidthMedium: style.strokes.frameWidthMedium,
    frameWidthLarge: style.strokes.frameWidthLarge,
    plateFrameWidth: style.strokes.plateFrameWidth,
    hairlineWidth: style.strokes.hairlineWidth,
    curveWidthSun: style.strokes.curveWidthSun,
    curveWidthInner: style.strokes.curveWidthInner,
    curveWidthOuter: style.strokes.curveWidthOuter,
    curveWidthMoon: style.strokes.curveWidthMoon,
    curveWidthHighlight: style.strokes.curveWidthHighlight,
    tierOuterWidthScale: style.strokes.tierOuterWidthScale,
    gridLineWidth: style.strokes.gridLineWidth,
    gridDashOn: style.strokes.gridDashOn,
    gridDashOff: style.strokes.gridDashOff,
    guideOpacity: style.strokes.guideOpacity,
    outOfBoundsTintOpacity: style.strokes.outOfBoundsTintOpacity,
    inkContrastRatioMin: style.strokes.inkContrastRatioMin,
    eventGlyphScale: style.markers.eventGlyphScale,
    eventGlyphMin: style.markers.eventGlyphMin,
    eventGlyphMax: style.markers.eventGlyphMax,
    eventCodeOffsetYMin: style.markers.eventCodeOffsetYMin,
    stationLetterOffsetScale: style.markers.stationLetterOffsetScale,
    turnDotScale: style.markers.turnDotScale,
    startSignOffsetScale: style.labels.startSignOffsetScale,
    startLabelGapScale: style.labels.startLabelGapScale,
    edgeLabelGapScale: style.labels.edgeLabelGapScale,
    edgeLabelMaxShiftScale: style.labels.edgeLabelMaxShiftScale,
    labelYGapSpaces: style.labels.labelYGapSpaces,
    stationSnapX: style.interaction.stationSnapX,
    stationSnapY: style.interaction.stationSnapY,
    tickWidth: style.strokes.tickWidth,
    minorTickWidth: style.strokes.minorTickWidth,
    rulerMajorTickScale: style.ruler.majorTickScale,
    rulerMediumTickScale: style.ruler.mediumTickScale,
    rulerMinorTickScale: style.ruler.minorTickScale,
    rulerFineTickScale: style.ruler.fineTickScale,
    rulerTickMin: style.ruler.tickMin,
    rulerTickMinSpacing: style.ruler.tickMinSpacing,
    rulerLabelScale: style.ruler.labelScale,
    rulerLabelGapSpaces: style.ruler.labelGapSpaces,
    lunationDiscScale: style.markers.lunationDiscScale,
    lunationDiscMin: style.markers.lunationDiscMin,
    lunationDiscMax: style.markers.lunationDiscMax,
    lunationDiscOutlineWidth: style.strokes.lunationDiscOutlineWidth,
    eclipseLetterScale: style.markers.eclipseLetterScale,
    radixColumnScale: style.radix.radixColumnScale,
    radixLineWidth: style.radix.radixLineWidth,
    radixMidpointLineWidth: style.radix.radixMidpointLineWidth,
    radixMidpointDashOn: style.radix.radixMidpointDashOn,
    radixMidpointDashOff: style.radix.radixMidpointDashOff,
    radixLineOpacity: style.radix.radixLineOpacity,
    radixRingScale: style.radix.radixRingScale,
    radixRingWidth: style.radix.radixRingWidth,
    radixLabelScale: style.radix.radixLabelScale,
    radixPairLabelScale: style.radix.radixPairLabelScale,
    radixAngleLineScale: style.radix.radixAngleLineScale,
    radixOuterWidthScale: style.radix.radixOuterWidthScale,
    radixBandOpacity: style.radix.radixBandOpacity,
    radixFocusBandScale: style.radix.radixFocusBandScale,
    radixRecedeOpacity: style.radix.radixRecedeOpacity,
    radixRecedeFadeMs: style.radix.radixRecedeFadeMs,
    radixRecedeDelayMs: style.radix.radixRecedeDelayMs,
    radixFocusWidthScale: style.radix.radixFocusWidthScale,
    radixFocusRingScale: style.radix.radixFocusRingScale,
    radixReadingGlyphScale: style.radix.radixReadingGlyphScale,
    radixContourGlyphScale: style.radix.radixContourGlyphScale,
    radixContourCount: style.radix.radixContourCount,
    planetContactGlyphScale: style.radix.planetContactGlyphScale,
    planetContactKnockoutScale: style.radix.planetContactKnockoutScale,
    nowLineWidth: style.now.nowLineWidth,
    nowLineOpacity: style.now.nowLineOpacity,
    nowTagPadScale: style.now.nowTagPadScale,
  };
}

test("the default contract preserves all 98 Canvas values", () => {
  assert.equal(Object.keys(EPHEMERIS_RENDER_TOKEN_SPECS).length, 98);
  assert.equal(new Set(Object.values(EPHEMERIS_RENDER_TOKEN_SPECS).map(([name]) => name)).size, 98);
  assert.deepEqual(DEFAULT_EPHEMERIS_RENDER_TOKENS, EXPECTED_DEFAULTS);
  assert.ok(Object.isFrozen(EPHEMERIS_RENDER_TOKEN_SPECS));
  assert.ok(Object.values(EPHEMERIS_RENDER_TOKEN_SPECS).every(Object.isFrozen));
  assert.ok(Object.isFrozen(DEFAULT_EPHEMERIS_RENDER_TOKENS));

  const style = createEphemerisRenderStyle();
  assert.equal(style.schemaVersion, 2);
  assert.deepEqual(flattenStyle(style), EXPECTED_DEFAULTS);
  for (const group of [style, style.palette, style.colors, style.typography, style.strokes, style.markers, style.labels, style.ruler, style.layout, style.interaction, style.radix, style.now]) {
    assert.ok(Object.isFrozen(group));
  }
  assert.equal("tokens" in style, false);
});

test("active profile palette roles overlay retained colors and deactivate exactly", () => {
  const retained = Object.freeze({
    background: "retained-background",
    frame: "retained-frame",
    texts: "retained-texts",
    signs: "retained-signs",
  });
  assert.deepEqual(EPHEMERIS_RENDER_BASE_PALETTE_ROLES, {
    background: "--morinus-background",
    frame: "--morinus-frame",
    texts: "--morinus-text-bright",
    signs: "--morinus-signs",
    outOfBounds: "--aries-destructive",
  });

  const active = resolveEphemerisRenderPalette(retained, {
    "--morinus-background": " profile-background ",
    "--morinus-frame": "profile-frame",
    "--morinus-text-bright": "profile-texts",
    "--morinus-signs": "profile-signs",
    "--aries-destructive": "profile-out-of-bounds",
    "--aries-background": "must-not-leak-from-app-chrome",
  });
  assert.deepEqual(active, {
    background: "profile-background",
    frame: "profile-frame",
    texts: "profile-texts",
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

test("ink colours come from the theme roles, profile first, with ink fallbacks", async () => {
  assert.deepEqual(EPHEMERIS_THEME_COLOR_ROLES, {
    muted: "--aries-text-muted",
    rule: "--aries-border-subtle",
    accent: "--aries-signal",
    angles: "--morinus-angles",
  });
  assert.deepEqual(EPHEMERIS_DIGNITY_COLOR_VARS, {
    domicile: "--morinus-dignity-domicil",
    exaltation: "--morinus-dignity-exal",
    detriment: "--morinus-dignity-exil",
    fall: "--morinus-dignity-casus",
    peregrine: "--morinus-peregrin",
  });
  // The body roles are exactly the wheel's (palette.ts BODY_COLOR_VARS).
  const paletteSource = await readSource(new URL("../src/lib/chart/palette.ts", import.meta.url));
  const wheelBodies = paletteSource.match(/const BODY_COLOR_VARS = \[([\s\S]*?)\] as const;/)[1].match(/"--[^"]+"/g).map((v) => v.slice(1, -1));
  assert.deepEqual([...EPHEMERIS_BODY_COLOR_VARS], wheelBodies);
  for (const name of [...Object.values(EPHEMERIS_THEME_COLOR_ROLES), ...Object.values(EPHEMERIS_DIGNITY_COLOR_VARS), ...EPHEMERIS_BODY_COLOR_VARS]) {
    const globals = await readSource(new URL("../src/app/globals.css", import.meta.url));
    assert.match(globals, new RegExp(`${name}:`), `${name} is a theme token`);
  }

  const palette = { background: "paper", frame: "frame", texts: "ink", signs: "signs", outOfBounds: "oob" };
  const css = new Map([
    ["--aries-text-muted", " muted "],
    ["--aries-signal", "signal"],
    ["--morinus-body-sun", "css-sun"],
    ["--morinus-dignity-domicil", "css-domicile"],
    ["--morinus-peregrin", "css-peregrine"],
  ]);
  const colors = resolveEphemerisInkColors(palette, (name) => css.get(name) ?? "", { "--morinus-body-sun": "profile-sun" });
  assert.equal(colors.paper, "paper");
  assert.equal(colors.ink, "ink");
  assert.equal(colors.muted, "muted");
  assert.equal(colors.rule, "frame");
  assert.equal(colors.accent, "signal");
  assert.equal(colors.bodies[0], "profile-sun");
  assert.equal(colors.bodies[1], "");
  assert.equal(colors.dignity.domicile, "css-domicile");
  assert.equal(colors.dignity.fall, "css-peregrine");
  const bare = resolveEphemerisInkColors(palette);
  assert.equal(bare.muted, "ink");
  assert.equal(bare.accent, "ink");
  assert.equal(bare.dignity.peregrine, "ink");
  assert.ok(Object.isFrozen(colors) && Object.isFrozen(colors.bodies) && Object.isFrozen(colors.dignity));
});

test("profile planet arrays follow daemon color indexes without mutating retained series", () => {
  assert.deepEqual(
    [-2, 0, 9, 10, 11, 11.9, 12, 13, 14, 15, 99].map(ephemerisPlanetColorIndex),
    [0, 0, 9, 10, 10, 11, 1, 1, 11, 12, 11],
  );

  const retained = Object.freeze([
    Object.freeze({ id: 0, color: "retained-sun", label: "Sun" }),
    Object.freeze({ id: 9, color: "retained-pluto", label: "Pluto" }),
    Object.freeze({ id: 11, color: "retained-true-node", label: "True node" }),
    Object.freeze({ id: 12, color: "retained-mean-apogee", label: "Mean apogee" }),
    Object.freeze({ id: 13, color: "retained-true-apogee", label: "True apogee" }),
    Object.freeze({ id: 15, color: "retained-chiron", label: "Chiron" }),
    Object.freeze({ id: 99, color: "retained-unknown", label: "Unknown" }),
  ]);
  const profileColors = Array.from({ length: 13 }, (_, index) => `profile-${index}`);
  const active = applyEphemerisPlanetProfileColors(retained, profileColors);
  assert.deepEqual(active.map(({ color }) => color), [
    "profile-0",
    "profile-9",
    "profile-10",
    "profile-1",
    "profile-1",
    "profile-12",
    "profile-11",
  ]);
  assert.deepEqual(retained.map(({ color }) => color), [
    "retained-sun",
    "retained-pluto",
    "retained-true-node",
    "retained-mean-apogee",
    "retained-true-apogee",
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
  const plotSource = await readSource(new URL("../src/lib/chart/ephemeris-plot-paint.ts", import.meta.url));
  const chromeSource = await readSource(new URL("../src/lib/chart/ephemeris-chrome-paint.ts", import.meta.url));
  const hitSource = await readSource(new URL("../src/lib/chart/ephemeris-hit-test.ts", import.meta.url));
  assert.equal((source.match(/resolveEphemerisRenderStyle\(/g) ?? []).length, 1);
  assert.match(source, /const renderStyle = resolveEphemerisRenderStyle\(wrap,/);
  assert.match(source, /styleRef\.current = renderStyle/);
  assert.match(source, /theme\?\.profileOverrides\.chartPalette/);
  assert.match(source, /theme\?\.profileOverrides\.chartData\.planets/);
  assert.match(source, /resolveEphemerisRenderPalette\(/);
  assert.match(source, /applyEphemerisPlanetProfileColors\(meta\.planets, profilePlanetColors\)/);
  assert.match(source, /palette: effectivePalette/);
  assert.match(source, /profileOverrides: chartProfileOverrides/);
  // Paint, geometry, hit test and export all take the same resolved style.
  // The live frame and the export share one plate paint (ephemeris-plate-paint).
  const plateSource = await readSource(new URL("../src/lib/chart/ephemeris-plate-paint.ts", import.meta.url));
  assert.match(plateSource, /computeEphemerisGeometry\(size\.w, size\.h, scene\.mode, measure, style[,)]/);
  assert.match(plateSource, /paintEphemerisChrome\(chrome, geo, scene, style\)/);
  assert.match(plateSource, /paintEphemerisPlot\(plot, geo, camera, data, scene, style, measure, bands\)/);
  assert.match(source, /ephemerisPlateGeometry\(size, currentScene, style, measure\)/);
  assert.match(source, /paintEphemerisPlate\(chromeDirty \? chrome : null, plot, \{[\s\S]*?scene: currentScene,\s*style,\s*measure,/);
  assert.match(source, /hitTestEphemeris\([\s\S]*?currentScene, style\)/);
  assert.match(hitSource, /style\.interaction\.stationSnapX/);
  assert.match(source, /paintEphemerisPlate\(base, top, \{[\s\S]*?scene: currentScene,\s*style,\s*measure,/);
  assert.match(
    plotSource,
    /\.flatMap\(\(block\) => block\.outOfBounds\)[\s\S]*?const north = marker\.value >= 0;[\s\S]*?if \(hits\([\s\S]*?scene\.outOfBoundsLabel, \{[\s\S]*?font: style\.typography\.fontUi,[\s\S]*?size: glyphSize,[\s\S]*?fill: style\.colors\.outOfBounds,/,
  );
  assert.match(chromeSource, /const colors = style\.colors;/);
  assert.match(plotSource, /const colors = style\.colors;/);
  assert.match(
    source,
    /style=\{meta\?\.colors\?\.background \? \{ backgroundColor: effectivePalette\.background \} : undefined\}/,
  );
  assert.match(source, /colors=\{effectivePalette\}/);
  assert.match(source, /effectivePlanets\.map\(\(p\) =>/);
  assert.doesNotMatch(source + plotSource + chromeSource, /readEphemerisRenderTokens|renderTokensRef|style\.tokens/);

  assert.match(source, /const ephemerisDataKey = useEphemerisDataKey\(\)/);
  const ephemerisDataKeyHook = source.slice(
    source.indexOf("function useEphemerisDataKey"),
    source.indexOf("function positive"),
  );
  assert.match(ephemerisDataKeyHook, /lastOptionsChange\?\.ephemerisDataKey/);
  assert.doesNotMatch(ephemerisDataKeyHook, /listDataChanged|styleOnly/);
  assert.doesNotMatch(
    source,
    /activeProfileFingerprint|themeStyleHash|pendingProfileStyleHashesRef/,
  );
  // The meta fetch keys on the options revision only, never on style inputs.
  const metaBlock = source.slice(source.indexOf("// --- Meta:"), source.indexOf("// --- Persisted per-radix"));
  assert.match(metaBlock, /fetchEphemerisMeta\(controller\.signal\)/);
  assert.doesNotMatch(metaBlock, /chartProfileOverrides|profilePlanetColors|effectivePalette|effectivePlanets/);
  assert.match(metaBlock, /\}, \[ephemerisDataKey, metaNonce\]\);/);
  assert.doesNotMatch(source, /refresh_all_sessions|recalc/);

  const saveBlock = source.match(/const savePng = React\.useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[composeSettledImage, targetCamera\]\);/);
  assert.ok(saveBlock);
  assert.match(saveBlock[1], /canvas\.toBlob\(/);
  assert.doesNotMatch(saveBlock[1], /resolveEphemerisRenderStyle\(/);
});

async function readSource(url) {
  return (await readFile(url, "utf8")).replace(/\r\n?/g, "\n");
}
