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
  fineStrokeMin: 1,
  fineStrokeDivisor: 360,
  mediumStrokeMin: 1,
  mediumStrokeDivisor: 280,
  mainStrokeMin: 2,
  mainStrokeDivisor: 220,
  tropicDashOn: 4,
  tropicDashOff: 4,
  equatorDashOn: 5,
  equatorDashOff: 4,
  regioDashOn: 4,
  regioDashOff: 4,
  meridianDashOn: 2,
  meridianDashOff: 4,
  capricornDashOn: 2,
  capricornDashOff: 3,
  connectorDashOn: 2,
  connectorDashOff: 3,
  connectorOpacity: 0.55,
  sphereOutlineWidth: 1,
  bandWidthScale: 0.15,
  tickStepScale: 0.01,
  innerRadiusMin: 1,
  starRadiusMin: 1.5,
  starRadiusDivisor: 320,
  signFontDivisor: 22,
  signCullScale: 0.03,
  sphereRadiusMin: 2,
  sphereRadiusDivisor: 160,
  planetFontDivisor: 16,
  bodyLabelPadScale: 0.02,
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
  cardinalPadScale: 0.06,
  cardinalFontDivisor: 22,
  infoFontDivisor: 16,
  infoFontScale: 0.75,
  infoInsetDivisor: 25,
  infoLineHeightScale: 1.2,
  pdRowFontDivisor: 30,
  pdRowHeightScale: 1.3,
  pdTokenGapScale: 0.35,
};

const EXPECTED_PALETTE = {
  background: "#23242a",
  horizon: "#3e82c4",
  ecliptic: "#c68a22",
  equator: "#78828f",
  equatorLabel: "#788291",
  tropic: "rgba(200, 210, 220, 0.45)",
  meridian: "rgba(170, 178, 196, 0.55)",
  regio: "rgba(150, 165, 185, 0.42)",
  almucantar: "rgba(120, 150, 190, 0.30)",
  azimuth: "rgba(120, 150, 190, 0.24)",
  hour: "rgba(170, 150, 110, 0.30)",
  capricorn: "rgba(150, 150, 152, 0.55)",
  star: "rgba(220, 222, 230, 0.85)",
  cardinal: "rgba(160, 160, 162, 0.9)",
  sunFill: "#ffe066",
  infoAtmospheric: "#dcdcdc",
  infoSchematic: "#c8c8c8",
};

const PAYLOAD_COLORS = {
  atmospheric: { sky: "payload-sky", ground: "payload-ground" },
  circleLabels: {
    equator: "payload-equator",
    horizon: "payload-horizon",
    ecliptic: "payload-ecliptic",
  },
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

test("schema v1 preserves every established Astrolabe paint value", () => {
  assert.equal(Object.keys(ASTROLABE_RENDER_TOKEN_SPECS).length, 52);
  assert.equal(new Set(Object.values(ASTROLABE_RENDER_TOKEN_SPECS).map(([name]) => name)).size, 52);
  assert.equal(Object.keys(ASTROLABE_RENDER_PALETTE_SPECS).length, 17);
  assert.deepEqual(DEFAULT_ASTROLABE_RENDER_TOKENS, EXPECTED_DEFAULTS);
  assert.deepEqual(DEFAULT_ASTROLABE_RENDER_PALETTE, EXPECTED_PALETTE);

  const style = createAstrolabeRenderStyle({ payloadColors: PAYLOAD_COLORS });
  assert.equal(style.schemaVersion, 1);
  assert.deepEqual(flattenStyle(style), EXPECTED_DEFAULTS);
  assert.deepEqual(style.palette, EXPECTED_PALETTE);
  assert.deepEqual(style.data.atmospheric, PAYLOAD_COLORS.atmospheric);
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

test("CSS semantic colors override stale label payload while dynamic atmosphere remains data", () => {
  const noCss = resolveAstrolabeRenderPalette(() => "", PAYLOAD_COLORS);
  assert.equal(noCss.horizon, "payload-horizon");
  assert.equal(noCss.ecliptic, "payload-ecliptic");
  assert.equal(noCss.equatorLabel, "payload-equator");
  assert.equal(noCss.background, EXPECTED_PALETTE.background);

  const values = new Map([
    ["--aries-astrolabe-horizon", "css-horizon"],
    ["--aries-astrolabe-ecliptic", "css-ecliptic"],
    ["--aries-astrolabe-equator-label", "css-equator"],
  ]);
  const palette = resolveAstrolabeRenderPalette((name) => values.get(name) ?? "", PAYLOAD_COLORS);
  assert.equal(palette.horizon, "css-horizon");
  assert.equal(palette.ecliptic, "css-ecliptic");
  assert.equal(palette.equatorLabel, "css-equator");

  const style = createAstrolabeRenderStyle({ palette, payloadColors: PAYLOAD_COLORS });
  assert.deepEqual(style.data.atmospheric, PAYLOAD_COLORS.atmospheric);
  assertDeepFrozen(style);
});

test("stroke helper preserves exact min and rounded viewport formulas", () => {
  const style = createAstrolabeRenderStyle();
  assert.deepEqual(resolveAstrolabeStrokeWidths(style, 200), { fine: 1, medium: 1, main: 2 });
  assert.deepEqual(resolveAstrolabeStrokeWidths(style, 720), { fine: 2, medium: 3, main: 3 });
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
      payloadColors: PAYLOAD_COLORS,
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

test("one style feeds Astrolabe paint while payload colors and interaction mechanics stay intact", async () => {
  const source = await readFile(
    new URL("../src/components/workshell/astrolabe-view.tsx", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/resolveAstrolabeRenderStyle\(/g) ?? []).length, 1);
  assert.match(source, /const renderStyle = resolveAstrolabeRenderStyle\(wrap,/);
  assert.match(source, /render\(canvas, geo, toggles, rect\.width, rect\.height, renderStyle, t\)/);
  assert.match(source, /resolveAstrolabeStrokeWidths\(style, size\)/);
  assert.match(source, /style\.data\.atmospheric\.ground/);
  assert.match(source, /style\.data\.atmospheric\.sky/);
  assert.match(source, /createResolvedSemanticChartColorResolver\(\)/);
  assert.match(source, /fill: resolveColor\(g\.colorRole, g\.color\) \?\? g\.color/);
  assert.match(source, /color: resolveColor\(b\.colorRole, b\.color\) \?\? b\.color/);
  assert.doesNotMatch(source, /const CLR_|const CAPRICORN_FILL/);

  assert.match(source, /const degPerPx = 360 \/ \(ds\.w \|\| 1\)/);
  assert.match(source, /Math\.max\(0, Math\.round\(next \* 4\) \/ 4\)/);
  assert.match(source, /const snap = geo\.pd\.snapArcs/);
  assert.match(source, /if \(a > d \+ 0\.001\) return a/);

  const fetchBlock = source.slice(
    source.indexOf("// Geometry fetch"),
    source.indexOf("// Draw on geometry"),
  );
  assert.match(source, /const geometryRevision = String\(sessionRefreshSeq\)/);
  assert.match(fetchBlock, /\}, \[sourceName, source, documentId\]\);/);
  assert.match(fetchBlock, /\}, \[delta, geometryRevision, pumpFetch\]\);/);
  assert.doesNotMatch(fetchBlock, /\bstyleRevision\b/);

  const paintBlock = source.slice(
    source.indexOf("// Draw on geometry"),
    source.indexOf("const toggle", source.indexOf("// Draw on geometry")),
  );
  assert.match(paintBlock, /revision: styleRevision/);
  assert.match(
    paintBlock,
    /\}, \[chartTextFont, geo, fontsReady, toggles, t, styleRevision\]\);/,
  );
});
