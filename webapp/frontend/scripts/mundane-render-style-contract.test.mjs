// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const styleSource = await readFile(
  new URL("../src/lib/chart/mundane-render-style.ts", import.meta.url),
  "utf8",
);
const styleJavascript = ts.transpileModule(styleSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  DEFAULT_MUNDANE_RENDER_PALETTE,
  DEFAULT_MUNDANE_RENDER_STYLE,
  DEFAULT_MUNDANE_RENDER_TOKENS,
  MUNDANE_RENDER_TOKEN_SPECS,
  createMundaneRenderStyle,
  resolveMundaneAspectPaint,
  resolveMundaneHitMetrics,
  resolveMundaneLayout,
  resolveMundaneOverlayMetrics,
  resolveMundaneRenderStyle,
  resolveMundaneRenderTokens,
  resolveMundaneStrokeMetrics,
  resolveMundaneTypographyMetrics,
} = await import(
  `data:text/javascript;base64,${Buffer.from(styleJavascript).toString("base64")}`
);

const EXPECTED_DEFAULTS = {
  minimumSide: 120,
  compoundSectorScale: 0.15,
  singleSectorScale: 0.18,
  planetLineScale: 0.03,
  singleHouseOffsetAdjustment: 0.01,
  outerMaxScale: 0.97,
  compoundHouseBandScale: 0.06,
  compoundOuterInsetScale: 0.12,
  singleOuterScale: 0.96,
  singleAscMcScale: 0.88,
  arrowScale: 0.04,
  degreeTickScale: 0.01,
  fiveDegreeTickScale: 0.02,
  tenDegreeTickScale: 0.03,
  motionMarkerScale: 0.01,
  compoundPositionScale: 0.45,
  singlePositionScale: 0.55,
  compoundBaseScale: 0.11,
  singleBaseScale: 0.2,
  glyphCenterDivisor: 2,
  motionCenterDivisor: 8,
  houseLabelOffsetDivisor: 4,
  secondHouseXOffsetDivisor: 8,
  symbolMin: 8,
  compoundSymbolDivisor: 16,
  singleSymbolDivisor: 12,
  fontMin: 6,
  textDivisor: 2,
  smallTextDivisor: 4,
  smallMax: 400,
  mediumMax: 600,
  hairlineWidth: 1,
  heavySmall: 1,
  heavyMedium: 2,
  heavyLarge: 3,
  tenDegreeSmall: 1,
  tenDegreeLarge: 2,
  planetLineSmall: 1,
  planetLineLarge: 2,
  ascMcMinWidth: 1,
  ascMcConfiguredDefault: 5,
  ascMcSmallConfiguredMin: 3,
  ascMcMediumConfiguredMin: 4,
  ascMcConfiguredMax: 5,
  ascMcSmallWidth: 2,
  ascMcMediumWidth: 3,
  aspectWidthMin: 1,
  aspectWidthScale: 2,
  aspectOpacityBase: 0.35,
  aspectOpacityRange: 0.65,
  aspectDashThreshold: 0.25,
  aspectDashOn: 6,
  aspectDashOff: 6,
  collisionStep: 0.1,
  collisionMaxIterations: 5000,
  bodyHitPadMin: 6,
  bodyHitPadScale: 0.45,
  aspectHitToleranceMin: 5,
  aspectHitToleranceScale: 0.32,
  overlayCompactMax: 390,
  overlaySymbolDivisor: 32,
  overlayCompactFontMin: 11,
  overlayRegularFontMin: 10,
  overlayCompactFontScale: 0.86,
  overlayRegularFontScale: 0.75,
  overlayCompactInsetMin: 10,
  overlayRegularInsetMin: 0,
  overlayInsetDivisor: 25,
  overlayTitlebarSafeTop: 14,
  overlayLineHeight: 1.1,
};

const EXPECTED_PALETTE = {
  background: "#232428",
  frame: "#dcdcdd",
  ascmc: "#cdcdd1",
  houses: "#8a8b8d",
  houseNumbers: "#8a8b8d",
  positions: "#ffffff",
};

function assertDeepFrozen(value) {
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") assertDeepFrozen(child);
  }
}

function legacyLayout(side, compound, showHouses) {
  const maxradius = side / 2;
  const planetsectorlen = compound ? 0.15 : 0.18;
  const housesectorlen = planetsectorlen;
  const planetoffs = (planetsectorlen / 2) * maxradius;
  const planetlinelen = 0.03;
  const houseoffs = (housesectorlen / 2 - (compound ? 0 : 0.01)) * maxradius;
  const rOuterMax = maxradius * 0.97;
  const r30 = compound
    ? (showHouses ? rOuterMax - 0.06 * maxradius : rOuterMax) - 0.12 * maxradius
    : maxradius * 0.96;
  const r0 = r30 - housesectorlen * maxradius;
  const rHouse = r30 - houseoffs;
  const rASCMC = compound ? rHouse : maxradius * 0.88;
  const rAsp = r0 - planetsectorlen * maxradius;
  const rLLine2 = rAsp + planetlinelen * maxradius;
  const rOuterLine = r30 + planetlinelen * maxradius;
  return {
    compound,
    side,
    cx: side / 2,
    cy: side / 2,
    maxradius,
    symbolSize: Math.max(8, maxradius / (compound ? 16 : 12)),
    r30,
    rHouse,
    rASCMC,
    rArrow: rASCMC + 0.04 * maxradius,
    r0,
    r1: r0 + 0.01 * maxradius,
    r5: r0 + 0.02 * maxradius,
    r10: r0 + 0.03 * maxradius,
    rInner: r0,
    rLLine: r0 - planetlinelen * maxradius,
    rPlanet: r0 - planetoffs,
    rAsp,
    rLLine2,
    rRetr: rLLine2 + maxradius * 0.01,
    rPos: maxradius * (compound ? 0.45 : 0.55),
    rBase: maxradius * (compound ? 0.11 : 0.2),
    rOuterPlanet: r30 + planetoffs,
    rOuterLine,
    rOuterRetr: rOuterLine + maxradius * 0.01,
    rOuter0: r30,
    rOuter1: r30 - 0.01 * maxradius,
    rOuter5: r30 - 0.02 * maxradius,
    rOuter10: r30 - 0.03 * maxradius,
  };
}

test("the schema-v1 default preserves all 70 established Mundane values", () => {
  assert.equal(Object.keys(MUNDANE_RENDER_TOKEN_SPECS).length, 70);
  assert.equal(new Set(Object.values(MUNDANE_RENDER_TOKEN_SPECS).map(([name]) => name)).size, 70);
  assert.deepEqual(DEFAULT_MUNDANE_RENDER_TOKENS, EXPECTED_DEFAULTS);
  assert.deepEqual(DEFAULT_MUNDANE_RENDER_PALETTE, EXPECTED_PALETTE);
  assert.equal(DEFAULT_MUNDANE_RENDER_STYLE.schemaVersion, 1);
  assert.equal(DEFAULT_MUNDANE_RENDER_STYLE.strokes.lineCap, "butt");
  assert.equal(DEFAULT_MUNDANE_RENDER_STYLE.strokes.lineJoin, "miter");
  assertDeepFrozen(DEFAULT_MUNDANE_RENDER_STYLE);
  assertDeepFrozen(MUNDANE_RENDER_TOKEN_SPECS);
});

test("CSS resolution preserves parseFloat, zero, and positive-divisor fallbacks", () => {
  const values = new Map([
    ["--aries-mundane-single-sector-scale", "0.21 trailing"],
    ["--aries-mundane-overlay-regular-inset-min", "0"],
    ["--aries-mundane-single-symbol-divisor", "0"],
    ["--aries-mundane-collision-step", "0"],
    ["--aries-mundane-body-hit-pad-scale", "-1"],
  ]);
  const tokens = resolveMundaneRenderTokens((name) => values.get(name) ?? "");
  assert.equal(tokens.singleSectorScale, 0.21);
  assert.equal(tokens.overlayRegularInsetMin, 0);
  assert.equal(tokens.singleSymbolDivisor, EXPECTED_DEFAULTS.singleSymbolDivisor);
  assert.equal(tokens.collisionStep, EXPECTED_DEFAULTS.collisionStep);
  assert.equal(tokens.bodyHitPadScale, EXPECTED_DEFAULTS.bodyHitPadScale);
  assertDeepFrozen(tokens);
});

test("style construction clones palette and deeply freezes every group", () => {
  const palette = { ...EXPECTED_PALETTE, background: "custom-background" };
  const tokens = { ...EXPECTED_DEFAULTS, singleSectorScale: 0.2 };
  const style = createMundaneRenderStyle({
    revision: 19,
    palette,
    tokens,
    fontUi: "Custom UI",
    fontSymbols: "Custom Symbols",
  });
  palette.background = "mutated";
  tokens.singleSectorScale = 0.1;

  assert.equal(style.revision, 19);
  assert.equal(style.palette.background, "custom-background");
  assert.equal(style.layout.singleSectorScale, 0.2);
  assert.equal(style.typography.fontUi, "Custom UI");
  assert.equal(style.typography.fontSymbols, "Custom Symbols");
  assertDeepFrozen(style);
});

test("single and compound layout profiles preserve every established radius", () => {
  const style = DEFAULT_MUNDANE_RENDER_STYLE;
  const single = resolveMundaneLayout(style, 600, false, false);
  assert.deepEqual(single, {
    compound: false,
    side: 600,
    cx: 300,
    cy: 300,
    maxradius: 300,
    symbolSize: 25,
    r30: 288,
    rHouse: 264,
    rASCMC: 264,
    rArrow: 276,
    r0: 234,
    r1: 237,
    r5: 240,
    r10: 243,
    rInner: 234,
    rLLine: 225,
    rPlanet: 207,
    rAsp: 180,
    rLLine2: 189,
    rRetr: 192,
    rPos: 165,
    rBase: 60,
    rOuterPlanet: 315,
    rOuterLine: 297,
    rOuterRetr: 300,
    rOuter0: 288,
    rOuter1: 285,
    rOuter5: 282,
    rOuter10: 279,
  });

  const compound = resolveMundaneLayout(style, 600, true, true);
  assert.equal(compound.symbolSize, 18.75);
  assert.equal(compound.r30, 237);
  assert.equal(compound.rHouse, 214.5);
  assert.equal(compound.rASCMC, 214.5);
  assert.equal(compound.rArrow, 226.5);
  assert.equal(compound.r0, 192);
  assert.equal(compound.rPlanet, 169.5);
  assert.equal(compound.rAsp, 147);
  assert.equal(compound.rPos, 135);
  assert.equal(compound.rBase, 33);
  assertDeepFrozen(single);
  assertDeepFrozen(compound);
});

test("default layout remains operation-for-operation identical at renderer breakpoints", () => {
  const style = DEFAULT_MUNDANE_RENDER_STYLE;
  for (const side of [120, 399, 400, 401, 599, 600, 601, 777]) {
    for (const compound of [false, true]) {
      for (const showHouses of [false, true]) {
        assert.deepEqual(
          resolveMundaneLayout(style, side, compound, showHouses),
          legacyLayout(side, compound, showHouses),
        );
      }
    }
  }
});

test("typography, strokes, aspects, hits, and overlays preserve parity", () => {
  const style = DEFAULT_MUNDANE_RENDER_STYLE;
  const single = resolveMundaneLayout(style, 600, false, false);
  const compound = resolveMundaneLayout(style, 600, true, true);
  assert.deepEqual(resolveMundaneTypographyMetrics(style, single), {
    symbol: 25,
    text: 13,
    smallText: 6,
  });
  assert.deepEqual(resolveMundaneTypographyMetrics(style, compound), {
    symbol: 19,
    text: 10,
    smallText: 6,
  });

  assert.deepEqual(resolveMundaneStrokeMetrics(style, 400, 5), {
    heavy: 1,
    tenDegree: 1,
    planetLine: 1,
    ascMc: 2,
  });
  assert.deepEqual(resolveMundaneStrokeMetrics(style, 401, 5), {
    heavy: 2,
    tenDegree: 1,
    planetLine: 1,
    ascMc: 3,
  });
  assert.deepEqual(resolveMundaneStrokeMetrics(style, 601, 5), {
    heavy: 3,
    tenDegree: 2,
    planetLine: 2,
    ascMc: 5,
  });

  assert.deepEqual(resolveMundaneAspectPaint(style, 0, 0), {
    width: 2,
    opacity: 1,
  });
  assert.deepEqual(resolveMundaneAspectPaint(style, 0.5, 0.5), {
    width: 1,
    opacity: 0.675,
    dash: [6, 6],
  });
  assert.deepEqual(resolveMundaneAspectPaint(style, 1, 1), {
    width: 1,
    opacity: 0.35,
    dash: [6, 6],
  });
  const saturatedOpacityStyle = createMundaneRenderStyle({
    tokens: {
      ...DEFAULT_MUNDANE_RENDER_TOKENS,
      aspectOpacityBase: 1,
      aspectOpacityRange: 1,
    },
  });
  assert.deepEqual(resolveMundaneAspectPaint(saturatedOpacityStyle, 0, 0), {
    width: 2,
    opacity: 1,
  });
  assert.deepEqual(resolveMundaneHitMetrics(style, 25), {
    bodyPad: 11,
    aspectTolerance: 8,
  });

  assert.deepEqual(resolveMundaneOverlayMetrics(style, 390), {
    compact: true,
    fontSize: 11,
    edgeInset: 15.6,
    topEdgeInset: 15.6,
    lineHeight: 1.1,
  });
  assert.deepEqual(resolveMundaneOverlayMetrics(style, 600), {
    compact: false,
    fontSize: 14.0625,
    edgeInset: 24,
    topEdgeInset: 38,
    lineHeight: 1.1,
  });
});

test("host resolution produces one immutable style from the supplied live palette", () => {
  const originalWindow = globalThis.window;
  let computedStyleReads = 0;
  globalThis.window = {
    getComputedStyle: () => {
      computedStyleReads += 1;
      return {
        getPropertyValue: (name) => name === "--aries-mundane-single-sector-scale" ? "0.2" : "",
      };
    },
  };
  try {
    const palette = { ...EXPECTED_PALETTE, frame: "live-frame" };
    const style = resolveMundaneRenderStyle({}, { revision: 22, palette, fontUi: "UI" });
    assert.equal(computedStyleReads, 1);
    assert.equal(style.revision, 22);
    assert.equal(style.palette.frame, "live-frame");
    assert.equal(style.layout.singleSectorScale, 0.2);
    assertDeepFrozen(style);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("one resolved object feeds paint, collision, hover geometry, and overlays", async () => {
  const source = await readFile(
    new URL("../src/components/workshell/mundane-chart-view.tsx", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/resolveMundaneRenderStyle\(/g) ?? []).length, 1);
  assert.match(
    source,
    /drawMundaneChart\([\s\S]*?canvasRef\.current,[\s\S]*?resolveMundanePaintColors\(data\),[\s\S]*?side,[\s\S]*?renderStyle,/,
  );
  assert.match(source, /resolveMundaneLayout\(style, side, compound, data\.showHouses\)/);
  assert.match(source, /arrangeBodies\([\s\S]*?layout\.rPlanet,[\s\S]*?style,/);
  assert.match(source, /collectAspectHoverTargets\(data, layout, style\)/);
  assert.match(source, /collectBodyHoverTargets\([\s\S]*?"primary",[\s\S]*?style,/);
  assert.match(source, /resolveMundaneOverlayMetrics\(renderStyle, side\)/);

  assert.match(source, /const palette = readPalette\(host\)/);
  assert.match(source, /background: palette\.background/);
  assert.match(source, /ascmc: palette\.angles/);
  assert.match(source, /houseNumbers: palette\.houseNums/);
  assert.match(source, /createResolvedSemanticChartColorResolver\(\)/);
  assert.match(source, /resolveColor\(body\.colorRole, body\.color\) \?\? body\.color/);
  assert.match(source, /resolveColor\(aspect\.colorRole, aspect\.color\) \?\? aspect\.color/);
  assert.match(source, /drawText\([\s\S]*?body\.color/);
  assert.match(source, /ctx\.strokeStyle = aspect\.color/);
  assert.doesNotMatch(source, /data\.colors/);
  assert.doesNotMatch(source, /const DEFAULT_COLORS/);
  assert.doesNotMatch(source, /function buildLayout/);

  const fetchCall = source.indexOf("fetchMundaneChart(sourceName");
  const fetchBlock = source.slice(
    source.lastIndexOf("React.useEffect", fetchCall),
    source.indexOf("React.useLayoutEffect", fetchCall),
  );
  assert.match(
    fetchBlock,
    /\}, \[documentId, sourceName, source, sessionRefreshSeq, pushedSnapshotSeq, refreshKey\]\);/,
  );
  assert.doesNotMatch(fetchBlock, /\bstyleRevision\b/);

  const styleBlock = source.slice(
    source.indexOf("React.useLayoutEffect", fetchCall),
    source.indexOf("React.useEffect", source.indexOf("React.useLayoutEffect", fetchCall)),
  );
  assert.match(styleBlock, /revision: styleRevision/);
  assert.match(styleBlock, /\}, \[styleRevision\]\);/);

  assert.match(source, /semanticAlphaColor\(payload\.accentRole, payload\.accent, 0\.55\)/);
  assert.match(
    source,
    /semanticChartColor\(payload\.accentRole, rgbCss\(payload\.accent\)\)/,
  );
  assert.match(source, /semanticChartColor\(span\.colourRole, rgbCss\(span\.colour\)\)/);
  assert.match(source, /semanticChartColor\(colourRole, rgbCss\(colour\)\)/);
});
