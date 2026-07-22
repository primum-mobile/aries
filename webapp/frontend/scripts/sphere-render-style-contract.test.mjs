// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const styleSource = await readFile(
  new URL("../src/lib/chart/sphere-render-style.ts", import.meta.url),
  "utf8",
);
const styleJavascript = ts.transpileModule(styleSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  DEFAULT_SPHERE_RENDER_PALETTE,
  DEFAULT_SPHERE_RENDER_TOKENS,
  SPHERE_RENDER_PALETTE_SPECS,
  SPHERE_RENDER_TOKEN_SPECS,
  createSphereRenderStyle,
  resolveSphereDotRadius,
  resolveSphereFontSize,
  resolveSphereFrameWidth,
  resolveSpherePolylineWidth,
  resolveSphereRadius,
  resolveSphereRenderPalette,
  resolveSphereRenderStyle,
  resolveSphereRenderTokens,
} = await import(
  `data:text/javascript;base64,${Buffer.from(styleJavascript).toString("base64")}`
);

const EXPECTED_DEFAULTS = {
  radiusScale: 0.43,
  frameWidthMin: 0.75,
  frameWidthDivisor: 520,
  polylineWidthMin: 0.35,
  widthScaleMin: 0.55,
  widthScaleDivisor: 440,
  dotRadiusMin: 0.75,
  dotRadiusDivisor: 360,
  bodyFontMin: 10,
  bodyFontMax: 16,
  bodyFontDivisor: 21,
  signFontMin: 8,
  signFontMax: 12,
  signFontDivisor: 31,
  houseFontMin: 6,
  houseFontMax: 9,
  houseFontDivisor: 44,
  decanFontMin: 5,
  decanFontMax: 7,
  decanFontDivisor: 68,
  boundFontMin: 4,
  boundFontMax: 6,
  boundFontDivisor: 78,
  referenceTickFrontOpacity: 0.72,
  referenceTickBackOpacity: 0.08,
  referenceFrontOpacity: 0.9,
  referenceBackOpacity: 0.12,
  signBoundaryFrontOpacity: 0.9,
  signBoundaryBackOpacity: 0.1,
  decanBoundaryFrontOpacity: 0.25,
  decanBoundaryBackOpacity: 0.04,
  houseBoundaryFrontOpacity: 0.9,
  houseBoundaryBackOpacity: 0.1,
  boundTickFrontOpacity: 0.55,
  boundTickBackOpacity: 0.05,
  bodyFrontOpacity: 0.94,
  bodyBackOpacity: 0.16,
  signLabelFrontOpacity: 0.76,
  signLabelBackOpacity: 0.08,
  houseLabelFrontOpacity: 0.66,
  houseLabelBackOpacity: 0.08,
  decanLabelOpacity: 0.35,
  boundLabelOpacity: 0.32,
};

const EXPECTED_PALETTE = {
  background: "#000000",
  wire: "#ffffff",
  faintWire: "rgba(255,255,255,0.22)",
};

function flattenStyle(style) {
  return {
    radiusScale: style.layout.radiusScale,
    frameWidthMin: style.strokes.frameWidthMin,
    frameWidthDivisor: style.strokes.frameWidthDivisor,
    polylineWidthMin: style.strokes.polylineWidthMin,
    widthScaleMin: style.strokes.widthScaleMin,
    widthScaleDivisor: style.strokes.widthScaleDivisor,
    dotRadiusMin: style.strokes.dotRadiusMin,
    dotRadiusDivisor: style.strokes.dotRadiusDivisor,
    bodyFontMin: style.typography.body.min,
    bodyFontMax: style.typography.body.max,
    bodyFontDivisor: style.typography.body.divisor,
    signFontMin: style.typography.sign.min,
    signFontMax: style.typography.sign.max,
    signFontDivisor: style.typography.sign.divisor,
    houseFontMin: style.typography.house.min,
    houseFontMax: style.typography.house.max,
    houseFontDivisor: style.typography.house.divisor,
    decanFontMin: style.typography.decan.min,
    decanFontMax: style.typography.decan.max,
    decanFontDivisor: style.typography.decan.divisor,
    boundFontMin: style.typography.bound.min,
    boundFontMax: style.typography.bound.max,
    boundFontDivisor: style.typography.bound.divisor,
    referenceTickFrontOpacity: style.opacities.referenceTick.front,
    referenceTickBackOpacity: style.opacities.referenceTick.back,
    referenceFrontOpacity: style.opacities.reference.front,
    referenceBackOpacity: style.opacities.reference.back,
    signBoundaryFrontOpacity: style.opacities.signBoundary.front,
    signBoundaryBackOpacity: style.opacities.signBoundary.back,
    decanBoundaryFrontOpacity: style.opacities.decanBoundary.front,
    decanBoundaryBackOpacity: style.opacities.decanBoundary.back,
    houseBoundaryFrontOpacity: style.opacities.houseBoundary.front,
    houseBoundaryBackOpacity: style.opacities.houseBoundary.back,
    boundTickFrontOpacity: style.opacities.boundTick.front,
    boundTickBackOpacity: style.opacities.boundTick.back,
    bodyFrontOpacity: style.opacities.body.front,
    bodyBackOpacity: style.opacities.body.back,
    signLabelFrontOpacity: style.opacities.signLabel.front,
    signLabelBackOpacity: style.opacities.signLabel.back,
    houseLabelFrontOpacity: style.opacities.houseLabel.front,
    houseLabelBackOpacity: style.opacities.houseLabel.back,
    decanLabelOpacity: style.opacities.decanLabel,
    boundLabelOpacity: style.opacities.boundLabel,
  };
}

function assertDeepFrozen(value) {
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") assertDeepFrozen(child);
  }
}

test("the default style preserves all established Sphere paint values", () => {
  assert.equal(Object.keys(SPHERE_RENDER_TOKEN_SPECS).length, 43);
  assert.equal(new Set(Object.values(SPHERE_RENDER_TOKEN_SPECS).map(([name]) => name)).size, 43);
  assert.equal(Object.keys(SPHERE_RENDER_PALETTE_SPECS).length, 3);
  assert.deepEqual(DEFAULT_SPHERE_RENDER_TOKENS, EXPECTED_DEFAULTS);
  assert.deepEqual(DEFAULT_SPHERE_RENDER_PALETTE, EXPECTED_PALETTE);

  const style = createSphereRenderStyle();
  assert.equal(style.schemaVersion, 1);
  assert.deepEqual(flattenStyle(style), EXPECTED_DEFAULTS);
  assert.deepEqual(style.palette, EXPECTED_PALETTE);
  assert.equal(style.strokes.lineCap, "butt");
  assert.equal(style.strokes.lineJoin, "miter");
  assertDeepFrozen(style);
  assertDeepFrozen(SPHERE_RENDER_TOKEN_SPECS);
  assertDeepFrozen(SPHERE_RENDER_PALETTE_SPECS);
});

test("CSS resolution preserves parseFloat, zero, palette strings, and fallbacks", () => {
  const values = new Map([
    ["--aries-sphere-radius-scale", "0.51 trailing"],
    ["--aries-sphere-frame-width-min", "0"],
    ["--aries-sphere-frame-width-divisor", "0"],
    ["--aries-sphere-body-font-max", "-2"],
    ["--aries-sphere-sign-label-front-opacity", "not-a-number"],
    ["--aries-sphere-background", "rgb(1, 2, 3)"],
    ["--aries-sphere-wire", "  #abcdef  "],
  ]);
  const read = (name) => values.get(name) ?? "";
  const tokens = resolveSphereRenderTokens(read);
  const palette = resolveSphereRenderPalette(read);

  assert.equal(tokens.radiusScale, 0.51);
  assert.equal(tokens.frameWidthMin, 0);
  assert.equal(tokens.frameWidthDivisor, EXPECTED_DEFAULTS.frameWidthDivisor);
  assert.equal(tokens.bodyFontMax, EXPECTED_DEFAULTS.bodyFontMax);
  assert.equal(tokens.signLabelFrontOpacity, EXPECTED_DEFAULTS.signLabelFrontOpacity);
  assert.deepEqual(palette, {
    ...EXPECTED_PALETTE,
    background: "rgb(1, 2, 3)",
    wire: "#abcdef",
  });
  assertDeepFrozen(tokens);
  assertDeepFrozen(palette);
});

test("the grouped style owns an immutable copy of supplied values", () => {
  const palette = { ...EXPECTED_PALETTE, background: "custom-background" };
  const tokens = { ...EXPECTED_DEFAULTS, radiusScale: 0.5 };
  const style = createSphereRenderStyle({
    revision: 17,
    palette,
    tokens,
    fontUi: "Custom UI",
    fontSymbols: "Custom Symbols",
  });

  palette.background = "mutated";
  tokens.radiusScale = 0.2;
  assert.equal(style.revision, 17);
  assert.equal(style.palette.background, "custom-background");
  assert.equal(style.layout.radiusScale, 0.5);
  assert.equal(style.typography.fontUi, "Custom UI");
  assert.equal(style.typography.fontSymbols, "Custom Symbols");
  assertDeepFrozen(style);
});

test("geometry, typography, and payload-width helpers preserve exact formulas", () => {
  const style = createSphereRenderStyle();
  assert.equal(resolveSphereRadius(style, 1000, 800, 1), 344);
  assert.equal(resolveSphereRadius(style, 1000, 800, 2), 688);

  assert.equal(resolveSphereFrameWidth(style, 220), 0.75);
  assert.equal(resolveSphereFrameWidth(style, 520), 1);
  assert.equal(resolveSpherePolylineWidth(style, 220, 0.5), 0.35);
  assert.equal(resolveSpherePolylineWidth(style, 220, 0.7), 0.7 * 0.55);
  assert.equal(resolveSpherePolylineWidth(style, 440, 1.6), 1.6);
  assert.equal(resolveSphereDotRadius(style, 220), 0.75);
  assert.equal(resolveSphereDotRadius(style, 360), 1);

  const radius = 420;
  assert.equal(resolveSphereFontSize(style.typography.body, radius), 16);
  assert.equal(resolveSphereFontSize(style.typography.sign, radius), 12);
  assert.equal(resolveSphereFontSize(style.typography.house, radius), 9);
  assert.equal(resolveSphereFontSize(style.typography.decan, radius), radius / 68);
  assert.equal(resolveSphereFontSize(style.typography.bound, radius), radius / 78);
});

test("host resolution reads computed style once and resolves one paint snapshot", () => {
  const originalWindow = globalThis.window;
  let computedStyleReads = 0;
  const values = new Map([
    ["--aries-sphere-radius-scale", "0.48"],
    ["--aries-sphere-wire", "custom-wire"],
  ]);
  globalThis.window = {
    getComputedStyle: () => {
      computedStyleReads += 1;
      return { getPropertyValue: (name) => values.get(name) ?? "" };
    },
  };
  try {
    const style = resolveSphereRenderStyle({}, {
      revision: "test-revision",
      fontUi: "UI",
      fontSymbols: "Symbols",
    });
    assert.equal(computedStyleReads, 1);
    assert.equal(style.layout.radiusScale, 0.48);
    assert.equal(style.palette.wire, "custom-wire");
    assert.equal(style.revision, "test-revision");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("one resolved style feeds Sphere paint while projection and interaction stay unchanged", async () => {
  const source = await readFile(
    new URL("../src/components/workshell/astrolog-sphere-view.tsx", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/resolveSphereRenderStyle\(/g) ?? []).length, 1);
  assert.match(source, /const renderStyle = resolveSphereRenderStyle\(wrap,/);
  assert.match(source, /render\(canvas, geo, layers, rect\.width, rect\.height, renderStyle, view\)/);
  assert.match(source, /resolveSpherePolylineWidth\(style, layout\.r, line\.width\)/);
  assert.match(source, /if \(line\.dash\.length\) ctx\.setLineDash\(line\.dash\)/);
  assert.doesNotMatch(source, /const WIRE\s*=/);

  assert.match(source, /const MIN_ZOOM = 0\.55;/);
  assert.match(source, /const MAX_ZOOM = 4\.5;/);
  assert.match(source, /Math\.min\(rect\.width, rect\.height\) \* 0\.5/);
  assert.match(source, /Math\.exp\(-event\.deltaY \* 0\.001\)/);
  assert.match(source, /clamp\(current\.zoom \* factor, MIN_ZOOM, MAX_ZOOM\)/);

  const fetchCall = source.indexOf("void fetchAstrologSphere(");
  const fetchBlock = source.slice(
    source.lastIndexOf("React.useEffect", fetchCall),
    source.indexOf("React.useEffect", fetchCall),
  );
  assert.match(
    fetchBlock,
    /\}, \[sourceName, source, documentId, sessionRefreshSeq\]\);/,
  );
  assert.doesNotMatch(fetchBlock, /\bstyleRevision\b/);

  const paintCall = source.indexOf("resolveSphereRenderStyle(wrap");
  const paintBlock = source.slice(
    source.lastIndexOf("React.useEffect", paintCall),
    source.indexOf("const toggle", paintCall),
  );
  assert.match(paintBlock, /revision: styleRevision/);
  assert.match(
    paintBlock,
    /\}, \[chartTextFont, fontsReady, geo, layers, view, styleRevision\]\);/,
  );
});
