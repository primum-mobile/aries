import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const styleSource = await readFile(
  new URL("../src/lib/chart/ephemeris-render-style.ts", import.meta.url),
  "utf8",
);
const styleJavascript = ts.transpileModule(styleSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  DEFAULT_EPHEMERIS_RENDER_PALETTE,
  DEFAULT_EPHEMERIS_RENDER_TOKENS,
  EPHEMERIS_RENDER_TOKEN_SPECS,
  createEphemerisRenderStyle,
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
  const source = await readFile(
    new URL("../src/components/workshell/graph-ephemeris-view.tsx", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/resolveEphemerisRenderStyle\(/g) ?? []).length, 1);
  assert.match(source, /const renderStyle = resolveEphemerisRenderStyle\(wrap,/);
  assert.match(source, /render\([\s\S]*?showEventGlyphs,[\s\S]*?renderStyle,/);
  assert.match(source, /computeGeometry\(cssW, cssH, mode, measure, style\)/);
  assert.match(source, /renderStyleRef\.current = renderStyle/);
  assert.match(source, /const renderStyle = renderStyleRef\.current;[\s\S]*?renderStyle\.interaction\.stationSnapX/);
  assert.doesNotMatch(source, /readEphemerisRenderTokens|renderTokensRef|style\.tokens/);

  const saveBlock = source.match(/const savePng = React\.useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[payload\]\);/);
  assert.ok(saveBlock);
  assert.match(saveBlock[1], /canvas\.toBlob\(/);
  assert.doesNotMatch(saveBlock[1], /render\(|resolveEphemerisRenderStyle\(/);
});
