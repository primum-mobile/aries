// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const styleSource = await readFile(
  new URL("../src/lib/chart/astrolabe-render-style.ts", import.meta.url),
  "utf8",
);
const styleJavascript = ts.transpileModule(styleSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  ASTROLABE_RENDER_PALETTE_SPECS,
  ASTROLABE_RENDER_TOKEN_SPECS,
  DEFAULT_ASTROLABE_RENDER_PALETTE,
  DEFAULT_ASTROLABE_RENDER_TOKENS,
  createAstrolabeRenderStyle,
  resolveAstrolabeRenderPalette,
  resolveAstrolabeRenderStyle,
  resolveAstrolabeRenderTokens,
  resolveAstrolabeStrokeWidths,
} = await import(
  `data:text/javascript;base64,${Buffer.from(styleJavascript).toString("base64")}`
);

const EXPECTED_DEFAULTS = {
  capricornFill: 0.83,
  fineStrokeMin: 0.75,
  fineStrokeDivisor: 960,
  mediumStrokeMin: 1,
  mediumStrokeDivisor: 720,
  mainStrokeMin: 1.5,
  mainStrokeDivisor: 720,
  tropicDashOn: 1,
  tropicDashOff: 3,
  equatorDashOn: 1,
  equatorDashOff: 3,
  regioDashOn: 1,
  regioDashOff: 4,
  meridianDashOn: 2,
  meridianDashOff: 4,
  capricornDashOn: 1,
  capricornDashOff: 2,
  connectorDashOn: 1,
  connectorDashOff: 3,
  connectorOpacity: 0.42,
  atmosphericFillOpacity: 0.32,
  sphereOutlineWidth: 0.75,
  bandWidthScale: 0.12,
  tickStepScale: 0.008,
  innerRadiusMin: 1,
  starRadiusMin: 1,
  starRadiusDivisor: 360,
  signFontDivisor: 24,
  signCullScale: 0.03,
  sphereRadiusMin: 1.5,
  sphereRadiusDivisor: 190,
  planetFontDivisor: 18,
  bodyLabelPadScale: 0.018,
  bodyCullScale: 1.1,
  collisionMarginScale: 0.15,
  collisionIterations: 40,
  collisionMinDelta: 0.5,
  collisionTieDelta: 1,
  collisionPushScale: 0.5,
  collisionMoveScale: 0.5,
  sunSphereScale: 1.5,
  circleLabelFontDivisor: 36,
  circleLabelOffsetX: 4,
  circleLabelOffsetY: 2,
  cardinalPadScale: 0.04,
  cardinalFontDivisor: 24,
  infoFontDivisor: 16,
  infoFontScale: 0.75,
  infoInsetDivisor: 25,
  infoLineHeightScale: 1.2,
  pdRowFontDivisor: 30,
  pdRowHeightScale: 1.3,
  pdTokenGapScale: 0.35,
};

const EXPECTED_PALETTE = {
  background: "rgb(35 36 40)",
  horizon: "rgb(205 205 209 / 86%)",
  ecliptic: "rgb(220 220 221)",
  equator: "rgb(138 139 141 / 78%)",
  equatorLabel: "rgb(138 139 141)",
  tropic: "rgb(138 139 141 / 58%)",
  meridian: "rgb(205 205 209 / 62%)",
  regio: "rgb(138 139 141 / 46%)",
  almucantar: "rgb(138 139 141 / 34%)",
  azimuth: "rgb(138 139 141 / 28%)",
  hour: "rgb(205 205 209 / 25%)",
  capricorn: "rgb(220 220 221)",
  star: "rgb(255 255 255 / 88%)",
  cardinal: "rgb(205 205 209)",
  sunFill: "rgb(255 215 0)",
  infoAtmospheric: "rgb(255 255 255)",
  infoSchematic: "rgb(255 255 255)",
};

function assertDeepFrozen(value) {
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") assertDeepFrozen(child);
  }
}

function flattenStyle(style) {
  return {
    capricornFill: style.layout.capricornFill,
    fineStrokeMin: style.strokes.fine.min,
    fineStrokeDivisor: style.strokes.fine.divisor,
    mediumStrokeMin: style.strokes.medium.min,
    mediumStrokeDivisor: style.strokes.medium.divisor,
    mainStrokeMin: style.strokes.main.min,
    mainStrokeDivisor: style.strokes.main.divisor,
    tropicDashOn: style.strokes.dashes.tropic[0],
    tropicDashOff: style.strokes.dashes.tropic[1],
    equatorDashOn: style.strokes.dashes.equator[0],
    equatorDashOff: style.strokes.dashes.equator[1],
    regioDashOn: style.strokes.dashes.regio[0],
    regioDashOff: style.strokes.dashes.regio[1],
    meridianDashOn: style.strokes.dashes.meridian[0],
    meridianDashOff: style.strokes.dashes.meridian[1],
    capricornDashOn: style.strokes.dashes.capricorn[0],
    capricornDashOff: style.strokes.dashes.capricorn[1],
    connectorDashOn: style.strokes.dashes.connector[0],
    connectorDashOff: style.strokes.dashes.connector[1],
    connectorOpacity: style.strokes.connectorOpacity,
    atmosphericFillOpacity: style.effects.atmosphericFillOpacity,
    sphereOutlineWidth: style.strokes.sphereOutlineWidth,
    bandWidthScale: style.layout.bandWidthScale,
    tickStepScale: style.layout.tickStepScale,
    innerRadiusMin: style.layout.innerRadiusMin,
    starRadiusMin: style.markers.starRadiusMin,
    starRadiusDivisor: style.markers.starRadiusDivisor,
    signFontDivisor: style.typography.signFontDivisor,
    signCullScale: style.layout.signCullScale,
    sphereRadiusMin: style.markers.sphereRadiusMin,
    sphereRadiusDivisor: style.markers.sphereRadiusDivisor,
    planetFontDivisor: style.typography.planetFontDivisor,
    bodyLabelPadScale: style.layout.bodyLabelPadScale,
    bodyCullScale: style.layout.bodyCullScale,
    collisionMarginScale: style.collision.marginScale,
    collisionIterations: style.collision.iterations,
    collisionMinDelta: style.collision.minDelta,
    collisionTieDelta: style.collision.tieDelta,
    collisionPushScale: style.collision.pushScale,
    collisionMoveScale: style.collision.moveScale,
    sunSphereScale: style.markers.sunSphereScale,
    circleLabelFontDivisor: style.typography.circleLabelFontDivisor,
    circleLabelOffsetX: style.layout.circleLabelOffsetX,
    circleLabelOffsetY: style.layout.circleLabelOffsetY,
    cardinalPadScale: style.layout.cardinalPadScale,
    cardinalFontDivisor: style.typography.cardinalFontDivisor,
    infoFontDivisor: style.typography.infoFontDivisor,
    infoFontScale: style.typography.infoFontScale,
    infoInsetDivisor: style.layout.infoInsetDivisor,
    infoLineHeightScale: style.layout.infoLineHeightScale,
    pdRowFontDivisor: style.typography.pdRowFontDivisor,
    pdRowHeightScale: style.layout.pdRowHeightScale,
    pdTokenGapScale: style.layout.pdTokenGapScale,
  };
}

test("schema v3 preserves the refined Astrolabe paint hierarchy", () => {
  assert.equal(Object.keys(ASTROLABE_RENDER_TOKEN_SPECS).length, 53);
  assert.equal(new Set(Object.values(ASTROLABE_RENDER_TOKEN_SPECS).map(([name]) => name)).size, 53);
  assert.equal(Object.keys(ASTROLABE_RENDER_PALETTE_SPECS).length, 17);
  assert.deepEqual(DEFAULT_ASTROLABE_RENDER_TOKENS, EXPECTED_DEFAULTS);
  assert.deepEqual(DEFAULT_ASTROLABE_RENDER_PALETTE, EXPECTED_PALETTE);

  assert.ok(Object.values(ASTROLABE_RENDER_PALETTE_SPECS).every(([, fallback]) => (
    fallback.startsWith("var(--morinus-")
  )));

  const style = createAstrolabeRenderStyle();
  assert.equal(style.schemaVersion, 3);
  assert.deepEqual(flattenStyle(style), EXPECTED_DEFAULTS);
  assert.deepEqual(style.palette, EXPECTED_PALETTE);
  assertDeepFrozen(style);
  assertDeepFrozen(ASTROLABE_RENDER_TOKEN_SPECS);
  assertDeepFrozen(ASTROLABE_RENDER_PALETTE_SPECS);
});

test("CSS validation preserves parseFloat, safe zero, bounds, and integer iterations", () => {
  const values = new Map([
    ["--aries-astrolabe-capricorn-fill", "0.9 trailing"],
    ["--aries-astrolabe-tropic-dash-on", "0"],
    ["--aries-astrolabe-main-stroke-divisor", "-2"],
    ["--aries-astrolabe-connector-opacity", "1.2"],
    ["--aries-astrolabe-collision-iterations", "19.6"],
  ]);
  const tokens = resolveAstrolabeRenderTokens((name) => values.get(name) ?? "");
  assert.equal(tokens.capricornFill, 0.9);
  assert.equal(tokens.tropicDashOn, 0);
  assert.equal(tokens.mainStrokeDivisor, EXPECTED_DEFAULTS.mainStrokeDivisor);
  assert.equal(tokens.connectorOpacity, EXPECTED_DEFAULTS.connectorOpacity);
  assert.equal(tokens.collisionIterations, 20);
  assertDeepFrozen(tokens);
});

test("canonical chart roles drive theme switching while Astrolabe overrides still win", () => {
  const darkTheme = new Map([
    ["--morinus-background", "#101820"],
    ["--morinus-frame", "#dfe7ef"],
    ["--morinus-angles", "#a0b0c0"],
    ["--morinus-houses", "rgb(90 100 110)"],
    ["--morinus-positions", "#f0f4f8"],
    ["--morinus-body-sun", "#ffd700"],
    ["--morinus-text-bright", "#ffffff"],
  ]);
  const lightTheme = new Map([
    ["--morinus-background", "#f4f0e8"],
    ["--morinus-frame", "#302820"],
    ["--morinus-angles", "#123456"],
    ["--morinus-houses", "rgb(70 80 90)"],
    ["--morinus-positions", "#654321"],
    ["--morinus-body-sun", "#abcdef"],
    ["--morinus-text-bright", "#17130f"],
  ]);
  const darkPalette = resolveAstrolabeRenderPalette((name) => darkTheme.get(name) ?? "");
  const lightPalette = resolveAstrolabeRenderPalette((name) => lightTheme.get(name) ?? "");
  assert.notDeepEqual(lightPalette, darkPalette);
  assert.equal(lightPalette.background, "#f4f0e8");
  assert.equal(lightPalette.horizon, "rgb(18 52 86 / 86%)");
  assert.equal(lightPalette.equator, "rgb(70 80 90 / 78%)");
  assert.equal(lightPalette.star, "rgb(101 67 33 / 88%)");
  assert.equal(lightPalette.sunFill, "#abcdef");

  lightTheme.set("--aries-astrolabe-horizon", "rgb(1 2 3 / 40%)");
  const overridden = resolveAstrolabeRenderPalette((name) => lightTheme.get(name) ?? "");
  assert.equal(overridden.horizon, "rgb(1 2 3 / 40%)");
  assertDeepFrozen(overridden);
});

test("stroke helper preserves the smooth fine/medium/main hierarchy", () => {
  const style = createAstrolabeRenderStyle();
  assert.deepEqual(resolveAstrolabeStrokeWidths(style, 200), { fine: 0.75, medium: 1, main: 1.5 });
  assert.deepEqual(resolveAstrolabeStrokeWidths(style, 720), { fine: 0.75, medium: 1, main: 1.5 });
  assert.deepEqual(resolveAstrolabeStrokeWidths(style, 1440), { fine: 1.5, medium: 2, main: 2 });
});

test("host resolution reads computed style once and returns one immutable paint snapshot", () => {
  const originalWindow = globalThis.window;
  let computedStyleReads = 0;
  const values = new Map([
    ["--aries-astrolabe-capricorn-fill", "0.88"],
    ["--aries-astrolabe-background", "custom-background"],
  ]);
  globalThis.window = {
    getComputedStyle: () => {
      computedStyleReads += 1;
      return { getPropertyValue: (name) => values.get(name) ?? "" };
    },
  };
  try {
    const style = resolveAstrolabeRenderStyle({}, {
      revision: 13,
      fontUi: "UI",
      fontSymbols: "Symbols",
    });
    assert.equal(computedStyleReads, 1);
    assert.equal(style.revision, 13);
    assert.equal(style.layout.capricornFill, 0.88);
    assert.equal(style.palette.background, "custom-background");
    assert.equal(style.typography.fontUi, "UI");
    assert.equal(style.typography.fontSymbols, "Symbols");
    assertDeepFrozen(style);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("one style feeds retained Astrolabe paint while interaction mechanics stay intact", async () => {
  const source = await readFile(
    new URL("../src/components/workshell/astrolabe-view.tsx", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/resolveAstrolabeRenderStyle\(/g) ?? []).length, 1);
  assert.match(source, /const renderStyle = resolveAstrolabeRenderStyle\(wrap,/);
  assert.match(source, /astrolabeTitlebarTopBoundary\(rect\)/);
  assert.match(source, /resolveAstrolabeStrokeWidths\(style, size\)/);
  assert.match(source, /ctx\.fillStyle = geo\.atmospheric\.ground/);
  assert.match(source, /ctx\.fillStyle = geo\.atmospheric\.sky/);
  assert.doesNotMatch(source, /payloadColors/);
  assert.match(source, /createResolvedSemanticChartColorResolver\(\)/);
  assert.match(source, /fill: resolveColor\(g\.colorRole, g\.color\) \?\? g\.color/);
  assert.match(source, /color: resolveColor\(b\.colorRole, b\.color\) \?\? b\.color/);
  assert.doesNotMatch(source, /const CLR_|const CAPRICORN_FILL/);

  assert.match(source, /const degPerPx = 360 \/ \(ds\.w \|\| 1\)/);
  assert.match(source, /Math\.max\(0, Math\.round\(next \* 4\) \/ 4\)/);
  assert.match(source, /const snap = geo\.pd\.snapArcs/);
  assert.match(source, /if \(arc > next \+ 0\.001\)/);
  assert.match(source, /drawGraduatedLimb\(/);
  assert.match(source, /const outerR = plateR \+ tickStep \* 3/);
  assert.match(source, /ctx\.moveTo\(cx \+ cos \* plateR, cy \+ sin \* plateR\)/);
  assert.match(source, /ctx\.lineTo\(cx \+ cos \* \(plateR \+ length\), cy \+ sin \* \(plateR \+ length\)\)/);
  assert.match(source, /const limbOuterR = chartRpx \+ tickStep \* 3/);
  assert.match(
    source,
    /resolveChartPaintTarget\(cssW, cssH, 1, paintTopBoundary, true\)/,
  );
  assert.match(source, /cy: target\.centerY/);
  assert.match(source, /const bodyLabelTop = Math\.max\(paintTopBoundary, 0\) \+ viewportClearance/);
  assert.match(source, /const labelDirection = outwardCrossesLimb \? -1 : 1/);
  assert.match(source, /chartRpx - limbClearance - Math\.hypot\(item\.tw, item\.th\) \/ 2/);
  assert.match(source, /clampBodyLabel\(si\);\s*clampBodyLabel\(sj\);/);
  assert.match(source, /fetchAstrolabeViewState\(documentId/);
  assert.match(source, /storeAstrolabeViewState\(documentId, state\)/);
  assert.match(
    source,
    /<ContextMenuGroup>\s*<ContextMenuLabel>\{t\("astrolabe\.viewSettings"\)\}<\/ContextMenuLabel>/,
  );
  assert.doesNotMatch(source, /function LayerBar/);

  const fetchBlock = source.slice(
    source.indexOf("// Geometry fetch"),
    source.indexOf("// Draw on geometry"),
  );
  assert.match(source, /const geometryRevision = String\(sessionRefreshSeq\)/);
  assert.match(fetchBlock, /\}, \[sourceName, source, documentId\]\);/);
  assert.match(fetchBlock, /\}, \[delta, geometryRevision, pumpFetch\]\);/);
  assert.doesNotMatch(fetchBlock, /\bstyleRevision\b/);
  assert.doesNotMatch(fetchBlock, /\bpaintRevision\b/);
  assert.doesNotMatch(fetchBlock, /\bliveStylePreviewRevision\b/);

  const paintBlock = source.slice(
    source.indexOf("// Draw on geometry"),
    source.indexOf("const toggle", source.indexOf("// Draw on geometry")),
  );
  assert.match(paintBlock, /revision: paintRevision/);
  assert.match(
    paintBlock,
    /\}, \[chartSymbolFont, chartTextFont, geo, fontsReady, toggles, t, paintRevision\]\);/,
  );
  assert.match(source, /state\.liveAppThemePreview \? `live:\$\{state\.revision\}` : "live:off"/);
  assert.match(source, /const ro = new ResizeObserver\(schedulePaint\)/);
  assert.match(source, /window\.requestAnimationFrame\(paint\)/);
});
