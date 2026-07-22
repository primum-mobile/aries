// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const styleSource = await readFile(
  new URL("../src/lib/chart/square-render-style.ts", import.meta.url),
  "utf8",
);
const styleJavascript = ts.transpileModule(styleSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  DEFAULT_SQUARE_RENDER_PALETTE,
  DEFAULT_SQUARE_RENDER_TOKENS,
  SQUARE_RENDER_TOKEN_SPECS,
  createSquareRenderStyle,
  resolveSquareFrameWidths,
  resolveSquareRenderStyle,
  resolveSquareRenderTokens,
  resolveSquareTypographyMetrics,
} = await import(
  `data:text/javascript;base64,${Buffer.from(styleJavascript).toString("base64")}`
);

const EXPECTED_DEFAULTS = {
  radiusScale: 0.9,
  symbolFontDivisor: 16,
  symbolFontMin: 8,
  smallSymbolFontDivisor: 18,
  smallSymbolFontMin: 6,
  textFontMin: 6,
  smallTextScale: 0.75,
  smallerTextScale: 0.5,
  spaceFontDivisor: 5,
  frameSmallMax: 400,
  frameMediumMax: 600,
  frameOuterWidthSmall: 2,
  frameOuterWidthMedium: 3,
  frameOuterWidthLarge: 4,
  frameInnerWidthSmall: 1,
  frameInnerWidthMedium: 2,
  frameInnerWidthLarge: 3,
  infoRadiusDivisor: 3,
  innerFramePixelAdjustment: 1,
  motionBaselineScale: 0.5,
};

function flattenStyle(style) {
  return {
    radiusScale: style.layout.radiusScale,
    symbolFontDivisor: style.typography.symbolFontDivisor,
    symbolFontMin: style.typography.symbolFontMin,
    smallSymbolFontDivisor: style.typography.smallSymbolFontDivisor,
    smallSymbolFontMin: style.typography.smallSymbolFontMin,
    textFontMin: style.typography.textFontMin,
    smallTextScale: style.typography.smallTextScale,
    smallerTextScale: style.typography.smallerTextScale,
    spaceFontDivisor: style.layout.spaceFontDivisor,
    frameSmallMax: style.strokes.smallMax,
    frameMediumMax: style.strokes.mediumMax,
    frameOuterWidthSmall: style.strokes.outerSmall,
    frameOuterWidthMedium: style.strokes.outerMedium,
    frameOuterWidthLarge: style.strokes.outerLarge,
    frameInnerWidthSmall: style.strokes.innerSmall,
    frameInnerWidthMedium: style.strokes.innerMedium,
    frameInnerWidthLarge: style.strokes.innerLarge,
    infoRadiusDivisor: style.layout.infoRadiusDivisor,
    innerFramePixelAdjustment: style.layout.innerFramePixelAdjustment,
    motionBaselineScale: style.layout.motionBaselineScale,
  };
}

test("the schema-v1 default preserves all 20 established Square values", () => {
  assert.equal(Object.keys(SQUARE_RENDER_TOKEN_SPECS).length, 20);
  assert.equal(new Set(Object.values(SQUARE_RENDER_TOKEN_SPECS).map(([name]) => name)).size, 20);
  assert.deepEqual(DEFAULT_SQUARE_RENDER_TOKENS, EXPECTED_DEFAULTS);
  assert.ok(Object.isFrozen(SQUARE_RENDER_TOKEN_SPECS));
  assert.ok(Object.values(SQUARE_RENDER_TOKEN_SPECS).every(Object.isFrozen));
  assert.ok(Object.isFrozen(DEFAULT_SQUARE_RENDER_TOKENS));

  const style = createSquareRenderStyle();
  assert.equal(style.schemaVersion, 1);
  assert.deepEqual(flattenStyle(style), EXPECTED_DEFAULTS);
  for (const group of [style, style.palette, style.typography, style.strokes, style.layout]) {
    assert.ok(Object.isFrozen(group));
  }
  assert.equal("tokens" in style, false);
});

test("the stroke profile preserves both inclusive responsive breakpoints", () => {
  const style = createSquareRenderStyle();
  assert.deepEqual(resolveSquareFrameWidths(style, 400), { outer: 2, inner: 1 });
  assert.deepEqual(resolveSquareFrameWidths(style, 401), { outer: 3, inner: 2 });
  assert.deepEqual(resolveSquareFrameWidths(style, 600), { outer: 3, inner: 2 });
  assert.deepEqual(resolveSquareFrameWidths(style, 601), { outer: 4, inner: 3 });
});

test("radius-relative typography preserves its established minima and rounding", () => {
  const style = createSquareRenderStyle();
  assert.deepEqual(resolveSquareTypographyMetrics(style, 60), {
    fontSize: 8,
    smallSymbolSize: 6,
    smallTextSize: 6,
    smallerTextSize: 6,
    space: 1.6,
    lineHeight: 11.2,
  });
  assert.deepEqual(resolveSquareTypographyMetrics(style, 300), {
    fontSize: 19,
    smallSymbolSize: 17,
    smallTextSize: 14,
    smallerTextSize: 10,
    space: 3.8,
    lineHeight: 26.6,
  });
});

test("CSS resolution accepts units and zero where safe, but rejects broken divisors", () => {
  const values = new Map([
    ["--aries-square-frame-small-max", "420px"],
    ["--aries-square-inner-frame-pixel-adjustment", "0"],
    ["--aries-square-radius-scale", "0"],
    ["--aries-square-space-font-divisor", "not-a-number"],
  ]);
  const tokens = resolveSquareRenderTokens((name) => values.get(name) ?? "");
  assert.equal(tokens.frameSmallMax, 420);
  assert.equal(tokens.innerFramePixelAdjustment, 0);
  assert.equal(tokens.radiusScale, EXPECTED_DEFAULTS.radiusScale);
  assert.equal(tokens.spaceFontDivisor, EXPECTED_DEFAULTS.spaceFontDivisor);
  assert.ok(Object.isFrozen(tokens));
});

test("host resolution produces one immutable palette and metric snapshot", () => {
  const originalWindow = globalThis.window;
  const cssValues = new Map([
    ["--aries-square-symbol-font-divisor", "20"],
    ["--aries-square-frame-outer-width-large", "5px"],
  ]);
  globalThis.window = {
    getComputedStyle: () => ({
      getPropertyValue: (name) => cssValues.get(name) ?? "",
    }),
  };
  try {
    const palette = { ...DEFAULT_SQUARE_RENDER_PALETTE, frame: "live-frame" };
    const style = resolveSquareRenderStyle({}, {
      revision: 12,
      palette,
      fontUi: "UI test",
      fontSymbols: "Symbols test",
    });
    palette.frame = "mutated";
    assert.equal(style.revision, 12);
    assert.equal(style.palette.frame, "live-frame");
    assert.equal(style.typography.symbolFontDivisor, 20);
    assert.equal(style.strokes.outerLarge, 5);
    assert.equal(style.typography.fontUi, "UI test");
    assert.equal(style.typography.fontSymbols, "Symbols test");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("Square paint consumes one resolved style and resolves retained body roles without refetch", async () => {
  const source = await readFile(
    new URL("../src/components/workshell/square-chart-view.tsx", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/resolveSquareRenderStyle\(/g) ?? []).length, 1);
  assert.match(source, /const renderStyle = resolveSquareRenderStyle\(canvas,/);
  assert.match(source, /drawSquareChart\(canvas, data, side, renderStyle\)/);
  assert.match(source, /const colors = style\.palette/);
  assert.match(source, /resolveSquareTypographyMetrics\(style, maxradius\)/);
  assert.match(source, /drawFrame\(ctx, side, cx, cy, radius, style\)/);
  assert.match(
    source,
    /drawPlanetRow\([\s\S]*?fonts,[\s\S]*?fontSize,[\s\S]*?style,[\s\S]*?resolveColor,/,
  );
  assert.match(source, /createResolvedSemanticChartColorResolver\(\)/);
  assert.match(source, /resolveColor\(p\.colorRole, p\.color\) \?\? p\.color/);
  assert.match(source, /drawText\(ctx, p\.glyph, x, y, fonts\.morinusSmall, color\)/);
  assert.doesNotMatch(source, /data\.colors\s*\?\?|data\.colors\.background/);
  assert.doesNotMatch(source, /const SMALL_SIZE|const MEDIUM_SIZE|function lineWidth/);

  const fetchCall = source.indexOf("fetchSquareChart(sourceName");
  const fetchBlock = source.slice(
    source.lastIndexOf("React.useEffect", fetchCall),
    source.indexOf("React.useEffect", fetchCall),
  );
  assert.match(
    fetchBlock,
    /\}, \[documentId, sourceName, source, parentSessionSeq\]\);/,
  );
  assert.doesNotMatch(fetchBlock, /\bstyleRevision\b/);

  const paintCall = source.indexOf("resolveSquareRenderStyle(canvas");
  const paintBlock = source.slice(
    source.lastIndexOf("React.useEffect", paintCall),
    source.indexOf("\n\n  return (", paintCall),
  );
  assert.match(paintBlock, /revision: styleRevision/);
  assert.match(paintBlock, /\}, \[data, side, styleRevision\]\);/);
  assert.match(
    source,
    /style=\{data \? \{ backgroundColor: "var\(--morinus-background\)" \} : undefined\}/,
  );
});
