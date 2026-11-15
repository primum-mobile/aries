// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { compositionModuleUrl } from "./wheel-composition-test-loader.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const { outerLabelCandidates } = await import(`data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(await readSource(new URL("../src/lib/chart/outer-label-names.ts", import.meta.url)),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
).toString("base64")}`);

const chartFontJavascript = ts.transpileModule(
  await readSource(new URL("../src/lib/chart/chart-fonts.ts", import.meta.url)),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const { bundledGlyphInkBounds } = await import(
  `data:text/javascript;base64,${Buffer.from(chartFontJavascript).toString("base64")}`,
);

const layoutModelJavascript = ts.transpileModule(
  await readSource(new URL("../src/lib/chart/wheel-layout-model.ts", import.meta.url)),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText.replaceAll('"./wheel-composition"', `"${compositionModuleUrl}"`).replaceAll('"../chart/wheel-composition"', `"${compositionModuleUrl}"`);
const layoutModelUrl = `data:text/javascript;base64,${Buffer.from(layoutModelJavascript).toString("base64")}`;
const wheelStyleSource = (
  await readSource(new URL("../src/lib/chart/wheel-render-style.ts", import.meta.url))
).replaceAll('"./wheel-layout-model"', `"${layoutModelUrl}"`);
const workspaceContentSource = await readFile(
  new URL("../src/components/workshell/workspace-content.tsx", import.meta.url),
  "utf8",
);
// Chart-corner text blocks shared by the wheel and the astrolabe.
const chartCornerLinesSource = await readFile(
  new URL("../src/components/workshell/chart-corner-lines.tsx", import.meta.url),
  "utf8",
);
const homeClientSource = await readFile(
  new URL("../src/components/workshell/home-client.tsx", import.meta.url),
  "utf8",
);
const wheelStyleJavascript = ts.transpileModule(wheelStyleSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText.replaceAll('"./wheel-composition"', `"${compositionModuleUrl}"`).replaceAll('"../chart/wheel-composition"', `"${compositionModuleUrl}"`);
const {
  resolveWheelPaintedRingReferenceRange,
  resolveWheelPaintedRingRadiusRange,
  paintedRingFieldFor,
  activePaintedRingRoles,
  DEFAULT_WHEEL_RENDER_STYLE,
  DEFAULT_WHEEL_RENDER_TOKENS,
  DEFAULT_WHEEL_LINE_PAINT,
  WHEEL_LINE_PAINT_ROLES,
  WHEEL_PAINTED_RING_ROLES,
  WHEEL_RENDER_FONT_SPECS,
  WHEEL_RENDER_PALETTE_SPECS,
  WHEEL_RENDER_DEPRECATED_TOKEN_ALIASES,
  WHEEL_RENDER_TOKEN_RANGES,
  WHEEL_RENDER_TOKEN_SPECS,
  WHEEL_SCALE_RANGE,
  resolveWheelScale,
  createTokenizedWheelRenderStyle,
  createWheelRenderStyle,
  resolveWheelRenderStyleFromTokens,
  resolveWheelRenderTokens,
  resolveWheelLinePaint,
  resolveWheelArrowGeometry,
  resolveWheelFillPaint,
  resolveWheelRenderStyle,
  resolveWheelRingSet,
  resolveWheelStrokeMetrics,
  resolveMorinusStroke,
  resolveWheelTypographyMetrics,
  wheelRingRadiusTokenKey,
} = await import(
  `data:text/javascript;base64,${Buffer.from(wheelStyleJavascript).toString("base64")}`
);

const { HISTORICAL_WHEEL_FACTORY_SETTINGS } = await import(compositionModuleUrl);

// The band model behind glyph containment, imported from production so the
// test cannot carry its own drifting copy of the ceiling rule.
const {
  resolveWheelBandLayout,
} = await import(layoutModelUrl);

function assertDeepFrozen(value) {
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") assertDeepFrozen(child);
  }
}

test("default wheel profile preserves classic, compact, and Anglo metrics", () => {
  const classic = resolveWheelTypographyMetrics(DEFAULT_WHEEL_RENDER_STYLE, "classic", 400);
  const compact = resolveWheelTypographyMetrics(DEFAULT_WHEEL_RENDER_STYLE, "compact", 400);
  const anglo = resolveWheelTypographyMetrics(DEFAULT_WHEEL_RENDER_STYLE, "anglo", 400);
  const secondaryRing = (label, projected, motion) => ({
    "secondaryRing.fixedStar.label": label,
    "secondaryRing.asteroid.label": label,
    "secondaryRing.asteroid.motion": label,
    "secondaryRing.midpoint.glyph": label,
    "secondaryRing.midpoint.text": label,
    "secondaryRing.antiscia.glyph": projected,
    "secondaryRing.antiscia.text": projected,
    "secondaryRing.contraAntiscia.glyph": projected,
    "secondaryRing.contraAntiscia.text": projected,
    "secondaryRing.dodecatemoria.glyph": projected,
    "secondaryRing.dodecatemoria.text": projected,
    "secondaryRing.arabicPart.label": label,
    "secondaryRing.parallelTransit.glyph": projected,
    "secondaryRing.parallelTransit.motion": motion,
  });

  const shared = {
    layoutUnit: 25,
    bodySize: 25,
    angleLabelScale: 0.75,
    angleLabelSize: 18.75,
    angleLabelWeight: 500,
    syzygyScale: 0.58,
    houseLabelSize: 12.5,
    bodyPosition: { degreeSize: 12.5, signSize: 14.000000000000002, minuteSize: 6.25 },
    anglePosition: { degreeSize: 12.5, signSize: 13, minuteSize: 6.25 },
    housePosition: { degreeSize: 12.5, signSize: 13, minuteSize: 6.25 },
    angloBodyPosition: {
      degreeSize: 11.5,
      signSize: 14.000000000000002,
      minuteSize: 9,
    },
    angloAnglePosition: { degreeSize: 10, signSize: 13, minuteSize: 8.5, gap: 2 },
    angloHousePosition: { degreeSize: 10, signSize: 13, minuteSize: 8.5, gap: 2 },
    aspectGlyphSize: 12.5,
    interchartAspectGlyphSize: 12.5,
    aspectGlyphOffset: 6.25,
    motionSize: 6.25,
  };
  assert.deepEqual(classic, {
    ...shared,
    outerLayoutUnit: 25,
    outerSize: 25,
    signSize: 20,
    subdivisionSize: 400 / 24,
    termSize: 400 / 24,
    decanSize: 400 / 24,
    outerAngleLabelSize: 18.75,
    outerHouseLabelSize: 12.5,
    outerMotionSize: 8.333333333333332,
    outerPositionSize: 12.5,
    outerPositionMinuteSize: 10,
    outerLabelSize: 12.5,
    outerProjectedGlyphSize: 25,
    secondaryRing: secondaryRing(12.5, 25, 8.333333333333332),
  });
  assert.deepEqual(compact, {
    ...shared,
    motionSize: 12.5,
    outerLayoutUnit: 25,
    outerSize: 25,
    signSize: 20,
    subdivisionSize: 400 / 24,
    termSize: 400 / 24,
    decanSize: 400 / 24,
    outerAngleLabelSize: 18.75,
    outerHouseLabelSize: 12.5,
    outerMotionSize: 6.25,
    outerPositionSize: 12.5,
    outerPositionMinuteSize: 10,
    outerLabelSize: 12.5,
    outerProjectedGlyphSize: 25,
    secondaryRing: secondaryRing(12.5, 25, 6.25),
  });
  assert.deepEqual(anglo, {
    ...shared,
    outerLayoutUnit: 20,
    outerSize: 20,
    signSize: 16,
    subdivisionSize: 12.5,
    termSize: 12.5,
    decanSize: 12.5,
    outerAngleLabelSize: 15,
    outerHouseLabelSize: 10,
    outerMotionSize: 5,
    outerPositionSize: 10,
    outerPositionMinuteSize: 8,
    outerLabelSize: 10,
    outerProjectedGlyphSize: 20,
    secondaryRing: secondaryRing(10, 20, 5),
  });
});

test("default stroke profile preserves reference scaling and degree breakpoint", () => {
  assert.deepEqual(resolveWheelStrokeMetrics(DEFAULT_WHEEL_RENDER_STYLE, 600), {
    medium: 2,
    degreeTick: 1,
    ascMc: 4,
  });
  assert.deepEqual(resolveWheelStrokeMetrics(DEFAULT_WHEEL_RENDER_STYLE, 601), {
    medium: 2,
    degreeTick: 2,
    ascMc: 4,
  });
  assert.deepEqual(resolveWheelStrokeMetrics(DEFAULT_WHEEL_RENDER_STYLE, 720), {
    medium: 2,
    degreeTick: 2,
    ascMc: 5,
  });
});

test("semantic line paint roles preserve defaults and isolate width, pattern, and opacity", () => {
  assert.deepEqual(WHEEL_LINE_PAINT_ROLES, [
    "majorRing",
    "minorRing",
    "outerMaximumRing",
    "outerHouseRing",
    "outerDegreeRing",
    "zodiacOuterRing",
    "innerDegreeRing",
    "zodiacInnerRing",
    "termRing",
    "cuspOuterRing",
    "innerBoundaryRing",
    "aspectBoundaryRing",
    "houseBoundaryRing",
    "baseRing",
    "degreeTick",
    "subdivision",
    "zodiacSpoke",
    "termBoundary",
    "decanBoundary",
    "houseCusp",
    "angle",
    "bodyLeader",
    "outerLeader",
    "aspect",
  ]);
  const defaultAspect = resolveWheelLinePaint(
    DEFAULT_WHEEL_RENDER_STYLE,
    "aspect",
    2,
    { dash: [10, 10], opacity: 0.5 },
  );
  assert.deepEqual(defaultAspect, {
    width: 2,
    dash: [10, 10],
    opacity: 0.5,
    lineCap: undefined,
    lineJoin: undefined,
  });

  const custom = createTokenizedWheelRenderStyle({
    tokens: {
      ...DEFAULT_WHEEL_RENDER_TOKENS,
      houseCuspWidthScale: 1.5,
      houseCuspPattern: 2,
      houseCuspDashOn: 7,
      houseCuspDashOff: 3,
      houseCuspOpacity: 0.4,
      zodiacSpokeWidthScale: 1.25,
      termBoundaryPattern: 2,
      termBoundaryDashOn: 6,
      termBoundaryDashOff: 2,
      decanBoundaryOpacity: 0.35,
      outerLeaderPattern: 3,
      outerLeaderDashOff: 5,
      aspectPattern: 1,
    },
  });
  assert.deepEqual(resolveWheelLinePaint(custom, "houseCusp", 2), {
    width: 3,
    dash: [7, 3],
    opacity: 0.4,
    lineCap: undefined,
    lineJoin: undefined,
  });
  assert.deepEqual(resolveWheelLinePaint(custom, "outerLeader", 1), {
    width: 1,
    dash: [0, 5],
    opacity: 1,
    lineCap: "round",
    lineJoin: undefined,
  });
  assert.equal(resolveWheelLinePaint(custom, "zodiacSpoke", 2).width, 2.5);
  assert.deepEqual(resolveWheelLinePaint(custom, "termBoundary", 1).dash, [6, 2]);
  assert.equal(resolveWheelLinePaint(custom, "decanBoundary", 1).opacity, 0.35);
  assert.equal(resolveWheelLinePaint(custom, "aspect", 1, { dash: [8, 8] }).dash, undefined);
  assert.deepEqual(custom.linePaint.majorRing, DEFAULT_WHEEL_LINE_PAINT.majorRing);
  assert.deepEqual(custom.linePaint.minorRing, DEFAULT_WHEEL_LINE_PAINT.minorRing);
});

test("authored ring stroke colors never fill the circle interior", () => {
  for (const profile of ["classic", "compact", "anglo", "houses", "cusps"]) {
    const style = {
      ...DEFAULT_WHEEL_RENDER_STYLE,
      authoringTargetProfile: profile,
      authoringOverrides: {
        ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
        linePaint: { [profile]: { "rings.zodiacOuter": { color: "#123456" } } },
      },
    };
    for (const role of WHEEL_PAINTED_RING_ROLES) {
      for (const authored of [false, true]) {
        const paint = resolveWheelLinePaint(style, role, 1, { color: "#abcdef" },
          authored ? "rings.zodiacOuter" : undefined);
        assert.equal(paint.fill, undefined, `${profile}/${role}: stroke must not fill`);
        assert.equal(paint.outline,
          authored || role === "zodiacOuterRing" ? "#123456" : "#abcdef");
      }
    }
    assert.equal(resolveWheelLinePaint(style, "zodiacSpoke", 1, { color: "#abcdef" }).fill,
      "#abcdef", "straight lines still receive their stroke color");
  }
});

test("Canvas line and circle paints retain subpixel widths and circle dash semantics", async () => {
  const source = await readSource(
    new URL("../src/lib/chart/canvas-draw.ts", import.meta.url),
  );
  assert.equal((source.match(/Math\.max\(0\.25, opts\?\.width \?\? 1\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /Math\.(?:round|floor)\(opts\?\.width/);
  assert.match(source, /if \(opts\.dash\) ctx\.setLineDash\(opts\.dash\)/);
  assert.match(source, /ctx\.lineCap = opts\.lineCap \?\? "butt"/);
});

test("authorable wheel token defaults reproduce the exact internal visual profile", () => {
  // +24 for the two independently authored cusp-band wheel profiles.
  assert.equal(Object.keys(WHEEL_RENDER_TOKEN_SPECS).length, 348);
  assert.ok(
    Object.values(WHEEL_RENDER_TOKEN_SPECS).every(([cssVar]) =>
      cssVar.startsWith("--aries-wheel-"),
    ),
  );
  assert.ok(
    Object.values(WHEEL_RENDER_TOKEN_SPECS).every(([cssVar]) =>
      !/(?:geometry|collision|hit|priority)/.test(cssVar),
    ),
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(WHEEL_RENDER_TOKEN_SPECS).map(([key, [, fallback]]) => [key, fallback]),
    ),
    DEFAULT_WHEEL_RENDER_TOKENS,
  );
  const tokenized = createTokenizedWheelRenderStyle();
  assert.deepEqual(tokenized.typography, DEFAULT_WHEEL_RENDER_STYLE.typography);
  assert.deepEqual(tokenized.strokes, DEFAULT_WHEEL_RENDER_STYLE.strokes);
  assert.deepEqual(tokenized.linePaint, DEFAULT_WHEEL_LINE_PAINT);
  assert.deepEqual(
    tokenized.ringRadiusOverrides,
    DEFAULT_WHEEL_RENDER_STYLE.ringRadiusOverrides,
  );
  assert.deepEqual(tokenized.labels, DEFAULT_WHEEL_RENDER_STYLE.labels);
  assert.deepEqual(tokenized.overlays, DEFAULT_WHEEL_RENDER_STYLE.overlays);
  assert.deepEqual(tokenized.outerLabels, DEFAULT_WHEEL_RENDER_STYLE.outerLabels);
  assert.deepEqual(tokenized.geometry, DEFAULT_WHEEL_RENDER_STYLE.geometry);
  assert.deepEqual(tokenized.collision, DEFAULT_WHEEL_RENDER_STYLE.collision);
  assert.deepEqual(tokenized.hit, DEFAULT_WHEEL_RENDER_STYLE.hit);
  assertDeepFrozen(DEFAULT_WHEEL_RENDER_TOKENS);
  assertDeepFrozen(WHEEL_RENDER_TOKEN_SPECS);
  assertDeepFrozen(tokenized);
});

test("canonical position-sign tokens preserve Anglo paint and own sign sizing", () => {
  assert.deepEqual(WHEEL_RENDER_DEPRECATED_TOKEN_ALIASES, {
    angloBodySignScale: "bodyPositionSignScale",
    angloAnglePositionSignScale: "anglePositionSignScale",
    angloHousePositionSignScale: "housePositionSignScale",
  });
  assert.deepEqual(WHEEL_RENDER_TOKEN_RANGES.get("bodyPositionSignScale"), [0.14, 1.69]);
  assert.deepEqual(WHEEL_RENDER_TOKEN_RANGES.get("anglePositionSignScale"), [0.13, 1.56]);
  assert.deepEqual(WHEEL_RENDER_TOKEN_RANGES.get("housePositionSignScale"), [0.13, 1.56]);

  const style = createTokenizedWheelRenderStyle({
    tokens: {
      ...DEFAULT_WHEEL_RENDER_TOKENS,
      bodyPositionSignScale: 0.7,
      anglePositionSignScale: 0.6,
      housePositionSignScale: 0.65,
      // Deprecated aliases remain readable for sparse-profile migration but
      // cannot become a second runtime authority.
      angloBodySignScale: 1.2,
      angloAnglePositionSignScale: 1.1,
      angloHousePositionSignScale: 1,
    },
  });
  const metrics = resolveWheelTypographyMetrics(style, "anglo", 400);
  assert.equal(metrics.bodyPosition.signSize, 17.5);
  assert.equal(metrics.angloBodyPosition.signSize, 17.5);
  assert.equal(metrics.anglePosition.signSize, 15);
  assert.equal(metrics.angloAnglePosition.signSize, 15);
  assert.equal(metrics.housePosition.signSize, 16.25);
  assert.equal(metrics.angloHousePosition.signSize, 16.25);

  const legacyOnly = resolveWheelRenderTokens((cssVar) => ({
    "--aries-wheel-anglo-body-sign-scale": "0.72",
    "--aries-wheel-anglo-angle-position-sign-scale": "0.62",
    "--aries-wheel-anglo-house-position-sign-scale": "0.67",
  })[cssVar]);
  assert.equal(legacyOnly.bodyPositionSignScale, 0.72);
  assert.equal(legacyOnly.anglePositionSignScale, 0.62);
  assert.equal(legacyOnly.housePositionSignScale, 0.67);

  const canonicalWins = resolveWheelRenderTokens((cssVar) => ({
    "--aries-wheel-body-position-sign-scale": "0.74",
    "--aries-wheel-anglo-body-sign-scale": "0.72",
    "--aries-wheel-angle-position-sign-scale": "0.64",
    "--aries-wheel-anglo-angle-position-sign-scale": "0.62",
    "--aries-wheel-house-position-sign-scale": "0.69",
    "--aries-wheel-anglo-house-position-sign-scale": "0.67",
  })[cssVar]);
  assert.equal(canonicalWins.bodyPositionSignScale, 0.74);
  assert.equal(canonicalWins.anglePositionSignScale, 0.64);
  assert.equal(canonicalWins.housePositionSignScale, 0.69);
  assertDeepFrozen(WHEEL_RENDER_DEPRECATED_TOKEN_ALIASES);
});

test("Anglo arrow tokens own bounded arrow geometry and reject an inner cap", () => {
  assert.deepEqual(WHEEL_RENDER_TOKEN_RANGES.get("angloArrowInset"), [0.005, 0.1]);
  assert.deepEqual(WHEEL_RENDER_TOKEN_RANGES.get("angloArrowMaximum"), [0.9, 1]);
  const input = {
    profile: "anglo",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: false,
    showDecans: false,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const custom = createTokenizedWheelRenderStyle({
    tokens: {
      ...DEFAULT_WHEEL_RENDER_TOKENS,
      angloArrowInset: 0.06,
      angloArrowMaximum: 0.95,
    },
  });
  assert.equal(resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, input).rArrow, 372);
  assert.equal(resolveWheelRingSet(custom, input).rArrow, 380);

  const rejected = resolveWheelRenderTokens((cssVar) => ({
    "--aries-wheel-anglo-zodiac-single": "0.98",
    "--aries-wheel-anglo-arrow-maximum": "0.95",
  })[cssVar]);
  assert.equal(rejected.angloZodiacSingle, DEFAULT_WHEEL_RENDER_TOKENS.angloZodiacSingle);
  assert.equal(rejected.angloArrowMaximum, DEFAULT_WHEEL_RENDER_TOKENS.angloArrowMaximum);
});

test("exact glyph families and subdivision scales are independently authorable", () => {
  assert.deepEqual(WHEEL_RENDER_FONT_SPECS, {
    text: ["--aries-wheel-font-text", "var(--aries-font-ui)"],
    symbols: ["--aries-wheel-font-symbols", "var(--aries-font-symbols)"],
    bodySymbols: ["--aries-wheel-font-body-symbols", "var(--aries-wheel-font-symbols)"],
    signSymbols: ["--aries-wheel-font-sign-symbols", "var(--aries-wheel-font-symbols)"],
    termSymbols: ["--aries-wheel-font-term-symbols", "var(--aries-wheel-font-symbols)"],
    decanSymbols: ["--aries-wheel-font-decan-symbols", "var(--aries-wheel-font-symbols)"],
    aspectSymbols: ["--aries-wheel-font-aspect-symbols", "var(--aries-wheel-font-symbols)"],
  });
  const style = createTokenizedWheelRenderStyle({
    fontSymbols: "Shared symbols",
    fontBodySymbols: "Body symbols",
    fontSignSymbols: "Sign symbols",
    fontTermSymbols: "Term symbols",
    fontDecanSymbols: "Decan symbols",
    fontAspectSymbols: "Aspect symbols",
    tokens: {
      ...DEFAULT_WHEEL_RENDER_TOKENS,
      termGlyphScale: 1.4,
      decanGlyphScale: 0.8,
    },
  });
  assert.deepEqual(style.typography.families, {
    ui: DEFAULT_WHEEL_RENDER_STYLE.typography.families.ui,
    symbols: "Shared symbols",
    bodySymbols: "Body symbols",
    signSymbols: "Sign symbols",
    termSymbols: "Term symbols",
    decanSymbols: "Decan symbols",
    aspectSymbols: "Aspect symbols",
  });
  assert.equal(resolveWheelTypographyMetrics(style, "classic", 240).termSize, 14);
  assert.equal(resolveWheelTypographyMetrics(style, "classic", 240).decanSize, 8);
});

test("exact wheel primitives own independent colors with retained palette fallbacks", () => {
  assert.deepEqual(Object.keys(WHEEL_RENDER_PALETTE_SPECS), [
    "outerMaximumRing",
    "outerHouseRing",
    "outerDegreeRing",
    "zodiacOuterRing",
    "innerDegreeRing",
    "zodiacInnerRing",
    "termRing",
    "cuspOuterRing",
    "innerBoundaryRing",
    "aspectBoundaryRing",
    "houseBoundaryRing",
    "angloHouseBoundaryRing",
    "baseRing",
    "angloBaseRing",
    "zodiacSpoke",
    "houseCusp",
    "houseLabel",
    "angloHouseLabel",
    "termBoundary",
    "termGlyph",
    "decanBoundary",
    "decanGlyph",
    "bodyLeader",
    "angloBodyLeader",
    "outerLeader",
    "angloOuterLeader",
    "angleRay",
    "angleLabel",
    "surveilAccent",
  ]);
  const palette = {
    ...DEFAULT_WHEEL_RENDER_STYLE.palette,
    frame: "frame-fallback",
    signs: "sign-fallback",
    houses: "house-fallback",
    houseNums: "house-number-fallback",
    textDim: "anglo-house-number-fallback",
    angles: "angle-fallback",
    planets: [...DEFAULT_WHEEL_RENDER_STYLE.palette.planets],
    aspects: [...DEFAULT_WHEEL_RENDER_STYLE.palette.aspects],
  };
  const overrides = {
    "--aries-wheel-term-glyph-color": "term-only",
    "--aries-wheel-decan-boundary-color": "decan-line-only",
    "--aries-wheel-body-leader-color": "body-line-only",
  };
  const style = resolveWheelRenderStyleFromTokens(
    (cssVar) => overrides[cssVar],
    { palette },
  );
  assert.equal(style.elementColors.termGlyph, "term-only");
  assert.equal(style.elementColors.decanGlyph, "currentColor");
  assert.equal(style.elementColors.decanBoundary, "decan-line-only");
  assert.equal(style.elementColors.termBoundary, "frame-fallback");
  assert.equal(style.elementColors.bodyLeader, "body-line-only");
  assert.equal(style.elementColors.outerLeader, "frame-fallback");
  assert.equal(style.elementColors.houseCusp, "house-fallback");
  assert.equal(style.elementColors.houseLabel, "house-number-fallback");
  assert.equal(style.elementColors.angloHouseLabel, "anglo-house-number-fallback");
  assert.equal(style.elementColors.angleRay, "angle-fallback");
  assert.ok(Object.isFrozen(style.elementColors));
});

test("every painted circle owns profile radius, paint, opacity, and color tokens", () => {
  assert.deepEqual(WHEEL_PAINTED_RING_ROLES, [
    "outerMaximumRing",
    "outerHouseRing",
    "outerDegreeRing",
    "zodiacOuterRing",
    "innerDegreeRing",
    "zodiacInnerRing",
    "termRing",
    "cuspOuterRing",
    "innerBoundaryRing",
    "aspectBoundaryRing",
    "houseBoundaryRing",
    "baseRing",
  ]);

  for (const role of WHEEL_PAINTED_RING_ROLES) {
    for (const suffix of ["WidthScale", "Pattern", "DashOn", "DashOff", "Opacity"]) {
      assert.ok(WHEEL_RENDER_TOKEN_SPECS[`${role}${suffix}`], `${role}${suffix}`);
    }
    assert.ok(WHEEL_RENDER_PALETTE_SPECS[role], `${role} color`);
    for (const profile of ["classic", "compact", "anglo"]) {
      const key = wheelRingRadiusTokenKey(profile, role);
      assert.deepEqual(WHEEL_RENDER_TOKEN_SPECS[key][1], 0, key);
      assert.deepEqual(WHEEL_RENDER_TOKEN_RANGES.get(key), [0, 1], key);
    }
  }

  const custom = createTokenizedWheelRenderStyle({
    tokens: {
      ...DEFAULT_WHEEL_RENDER_TOKENS,
      classicZodiacOuterRingRadius: 0.94,
      zodiacOuterRingWidthScale: 2,
      zodiacOuterRingOpacity: 0.35,
    },
  });
  const input = {
    profile: "classic",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const baseline = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, input);
  const edited = resolveWheelRingSet(custom, input);
  assert.equal(edited.r30, 376);
  for (const field of ["r10", "r0", "rDecans", "rInner", "rAsp", "rHouse", "rBase"]) {
    assert.equal(edited[field], baseline[field], field);
  }
  assert.equal(custom.linePaint.zodiacOuterRing.widthScale, 2);
  assert.equal(custom.linePaint.zodiacOuterRing.opacity, 0.35);
  assert.deepEqual(custom.linePaint.innerDegreeRing, DEFAULT_WHEEL_LINE_PAINT.innerDegreeRing);

  const crossed = createTokenizedWheelRenderStyle({
    tokens: {
      ...DEFAULT_WHEEL_RENDER_TOKENS,
      classicZodiacOuterRingRadius: 0.2,
      classicInnerDegreeRingRadius: 0.95,
      classicZodiacInnerRingRadius: 0.99,
      classicTermRingRadius: 0.98,
      classicInnerBoundaryRingRadius: 0.97,
      classicAspectBoundaryRingRadius: 0.96,
      classicHouseBoundaryRingRadius: 0.95,
      classicBaseRingRadius: 0.94,
    },
  });
  const guarded = resolveWheelRingSet(crossed, input);
  const ordered = [
    guarded.r30,
    guarded.r10,
    guarded.r0,
    guarded.rDecans,
    guarded.rInner,
    guarded.rAsp,
    guarded.rHouse,
    guarded.rBase,
  ];
  assert.ok(ordered.every(Number.isFinite));
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(ordered[index - 1] >= ordered[index], `${index - 1} > ${index}`);
  }
});

test("wheel authoring rejects invalid values and broken relational groups", () => {
  const values = {
    "--aries-wheel-body-scale": "NaN",
    "--aries-wheel-body-position-minute-scale": "-1",
    "--aries-wheel-angle-label-weight": "1001",
    "--aries-wheel-degree-tick-stroke-small": "5",
    "--aries-wheel-degree-tick-stroke-large": "2",
    "--aries-wheel-chart-ring-stroke-fallback": "9",
    "--aries-wheel-chart-ring-stroke-min": "4",
    "--aries-wheel-chart-ring-stroke-max": "3",
    "--aries-wheel-aspect-classic-thickness-min": "4",
    "--aries-wheel-aspect-classic-thickness-max": "2",
    "--aries-wheel-aspect-classic-thickness-default": "3",
    "--aries-wheel-aspect-anglo-thickness-min": "2",
    "--aries-wheel-aspect-anglo-thickness-max": "1",
    "--aries-wheel-aspect-anglo-thickness-default": "1.5",
    "--aries-wheel-outer-radius-offset-scale": "0.31",
    "--aries-wheel-overlay-compact-breakpoint": "120",
    "--aries-wheel-overlay-row-height-factor": "0",
    "--aries-wheel-overlay-info-gap": "6",
    "--aries-wheel-major-ring-width-scale": "0.1",
    "--aries-wheel-minor-ring-pattern": "1.5",
    "--aries-wheel-degree-tick-dash-on": "0",
    "--aries-wheel-subdivision-opacity": "1.1",
    "--aries-wheel-house-cusp-opacity": "0",
  };
  const tokens = resolveWheelRenderTokens((cssVar) => values[cssVar]);
  assert.equal(tokens.bodyScale, DEFAULT_WHEEL_RENDER_TOKENS.bodyScale);
  assert.equal(
    tokens.bodyPositionMinuteScale,
    DEFAULT_WHEEL_RENDER_TOKENS.bodyPositionMinuteScale,
  );
  assert.equal(tokens.angleLabelWeight, DEFAULT_WHEEL_RENDER_TOKENS.angleLabelWeight);
  assert.equal(
    tokens.overlayCompactBreakpoint,
    DEFAULT_WHEEL_RENDER_TOKENS.overlayCompactBreakpoint,
  );
  assert.equal(
    tokens.overlayRowHeightFactor,
    DEFAULT_WHEEL_RENDER_TOKENS.overlayRowHeightFactor,
  );
  assert.equal(tokens.overlayInfoGap, 6);
  assert.equal(tokens.majorRingWidthScale, DEFAULT_WHEEL_RENDER_TOKENS.majorRingWidthScale);
  assert.equal(tokens.minorRingPattern, DEFAULT_WHEEL_RENDER_TOKENS.minorRingPattern);
  assert.equal(tokens.degreeTickDashOn, DEFAULT_WHEEL_RENDER_TOKENS.degreeTickDashOn);
  assert.equal(tokens.subdivisionOpacity, DEFAULT_WHEEL_RENDER_TOKENS.subdivisionOpacity);
  assert.equal(tokens.houseCuspOpacity, 0);
  for (const key of [
    "degreeTickStrokeSmall",
    "degreeTickStrokeLarge",
    "chartRingStrokeFallback",
    "chartRingStrokeMin",
    "chartRingStrokeMax",
    "aspectClassicThicknessMin",
    "aspectClassicThicknessMax",
    "aspectClassicThicknessDefault",
    "aspectAngloThicknessMin",
    "aspectAngloThicknessMax",
    "aspectAngloThicknessDefault",
  ]) {
    assert.equal(tokens[key], DEFAULT_WHEEL_RENDER_TOKENS[key]);
  }
  assert.equal(tokens.outerRadiusOffsetScale, 0.31);
  assertDeepFrozen(tokens);
});

test("profile activation and deactivation resolve directly from the live theme map", () => {
  const activeThemeChartPalette = {
    "--aries-wheel-body-scale": "0.08",
    "--aries-wheel-hairline-stroke": "1.5",
    "--aries-wheel-aspect-anglo-dash-on": "7",
    "--aries-wheel-outer-label-edge-pad-factor": "0.22",
    "--aries-wheel-overlay-label-scale": "0.48",
  };
  const palette = {
    ...DEFAULT_WHEEL_RENDER_STYLE.palette,
    planets: [...DEFAULT_WHEEL_RENDER_STYLE.palette.planets],
    aspects: [...DEFAULT_WHEEL_RENDER_STYLE.palette.aspects],
  };
  const active = resolveWheelRenderStyleFromTokens(
    (cssVar) => activeThemeChartPalette[cssVar],
    { palette, revision: "active" },
  );
  assert.equal(active.typography.ratios.body, 0.08);
  assert.equal(active.strokes.hairline, 1.5);
  assert.deepEqual(active.strokes.aspects.angloDash, [7, 5]);
  assert.equal(active.outerLabels.edgePadFactor, 0.22);
  assert.equal(active.overlays.labelScale, 0.48);

  const deactivated = resolveWheelRenderStyleFromTokens(
    (cssVar) => ({}[cssVar]),
    { palette, revision: "deactivated" },
  );
  assert.equal(deactivated.typography.ratios.body, DEFAULT_WHEEL_RENDER_STYLE.typography.ratios.body);
  assert.equal(deactivated.strokes.hairline, DEFAULT_WHEEL_RENDER_STYLE.strokes.hairline);
  assert.deepEqual(
    deactivated.strokes.aspects.angloDash,
    DEFAULT_WHEEL_RENDER_STYLE.strokes.aspects.angloDash,
  );
  assert.equal(
    deactivated.outerLabels.edgePadFactor,
    DEFAULT_WHEEL_RENDER_STYLE.outerLabels.edgePadFactor,
  );
  assert.deepEqual(deactivated.overlays, DEFAULT_WHEEL_RENDER_STYLE.overlays);
  assertDeepFrozen(active);
  assertDeepFrozen(deactivated);
});

test("wheel DOM corner overlays consume the same typed profile style", () => {
  assert.match(workspaceContentSource, /const overlayStyle = wheelStyle\.overlays/);
  assert.match(workspaceContentSource, /resolveWheelOverlayMetrics\(overlayStyle, viewport\)/);
  assert.match(workspaceContentSource, /from "@\/components\/workshell\/chart-corner-lines"/);
  assert.match(chartCornerLinesSource, /resolveWheelTypographyPaint\(/);
  assert.match(chartCornerLinesSource, /data-aries-style-class=\{semanticClassId\}/);
  assert.match(workspaceContentSource, /readPaletteProfileOverrides\(theme\)/);
  assert.doesNotMatch(workspaceContentSource, /WX_OVERLAY_|DOM_OVERLAY_FONT_BOX_SCALE/);
});

test("wheel overlay hit regions expose all twelve exact semantic text classes", async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const chart = {
    meta: {
      dateDisplay: "2026.July.26",
      timeDisplay: "12:34:56",
      place: "Berlin",
      placeCoords: "13E 52N",
      cornerLines: {
        topLeft: ["2026.July.26", "12:34:56"],
        bottomLeft: ["Berlin", "13E 52N"],
      },
      houseSystemLines: ["Placidus"],
    },
    planets: [{
      id: "sun",
      seId: 0,
      longitude: 10,
      latitude: 0,
      speed: 1,
      glyph: "A",
      color: "#ffaa00",
    }],
    eclipse: {
      longitude: 55,
      house: 2,
      label: "Total Solar Eclipse",
      glyph: "Ec",
      glyphFont: "text",
      eventJd: 2460000,
      isSolar: true,
      coincidesWithSyzygy: false,
    },
    angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
    houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30) },
    aspects: [],
    overlay: {
      rows: [
        {
          group: "dayhour",
          label: "Day",
          glyphs: [{ char: "A", kind: "planet", seId: 0 }],
          trailing: "+1d",
        },
        {
          group: "header",
          label: "Term lord",
          glyphs: [
            { char: "A", kind: "planet", seId: 0 },
            { char: "B", kind: "sign" },
          ],
        },
        {
          group: "signal",
          label: "Morning rise",
          glyphs: [{ char: "A", kind: "planet", seId: 0 }],
          trailing: "-5d",
        },
      ],
    },
    options: {
      theme: 0,
      signVariant: 1,
      showHouses: false,
      showPositions: false,
      showAspects: false,
      showSymbols: false,
      showTerms: false,
      showDecans: false,
      showInformation: true,
      showHouseSystem: true,
    },
  };
  const regions = drawChart.computeHitRegions(
    {
      primaryChart: chart,
      displayDatetime: "2026-07-26T12:34:56+02:00",
      renderVariant: "round",
      overlayRenderMode: "full",
      outerRingMode: "none",
    },
    {
      width: 800,
      height: 800,
      renderStyle: DEFAULT_WHEEL_RENDER_STYLE,
      includeStyleTargets: true,
      textsize: (text, opts) => {
        const size = opts?.size ?? 14;
        const tracking = opts?.tracking ?? 0;
        return [
          String(text).length * size * 0.5
            + Math.max(0, String(text).length - 1) * tracking,
          size,
        ];
      },
    },
  );
  const eclipseRegion = regions.find((region) => region.kind === "eclipse");
  assert.ok(eclipseRegion);
  assert.equal(eclipseRegion.longitude, 55);
  assert.equal(eclipseRegion.house, 2);
  assert.equal(eclipseRegion.label, "Total Solar Eclipse");
  const overlayTargets = regions.filter(
    (region) =>
      region.kind === "style_target"
      && region.classId.startsWith("chartOverlay."),
  );
  assert.deepEqual(
    [...new Set(overlayTargets.map((region) => region.classId))].sort(),
    [
      "chartOverlay.events.dayHour.glyph",
      "chartOverlay.events.dayHour.label",
      "chartOverlay.events.dayHour.trailing",
      "chartOverlay.events.header.glyph",
      "chartOverlay.events.header.label",
      "chartOverlay.events.header.trailing",
      "chartOverlay.events.signal.glyph",
      "chartOverlay.events.signal.label",
      "chartOverlay.events.signal.trailing",
      "chartOverlay.houseSystem.bottomRight",
      "chartOverlay.information.bottomLeft",
      "chartOverlay.information.topLeft",
    ],
  );
  assert.ok(
    overlayTargets.every(
      (region) =>
        region.shape === "rect"
        && region.width > 0
        && region.height > 0,
    ),
  );
  assert.ok(
    overlayTargets.some(
      (region) =>
        region.classId === "chartOverlay.events.dayHour.glyph"
        && region.bodyId === "sun"
        && region.colorValue === DEFAULT_WHEEL_RENDER_STYLE.palette.planets[0],
    ),
  );
});

test("comparison house-cusp style targets match the twelve painted cusps exactly", async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const chart = {
    meta: {
      dateDisplay: "2026.July.26",
      timeDisplay: "12:34:56",
      place: "Berlin",
      placeCoords: "13E 52N",
    },
    planets: [],
    angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
    houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30) },
    aspects: [],
    options: {
      theme: 0,
      signVariant: 1,
      showHouses: true,
      showOuterHouseLines: true,
      showPositions: false,
      showAspects: false,
      showSymbols: false,
      showTerms: false,
      showDecans: false,
      showInformation: false,
      showHouseSystem: false,
    },
  };
  const regions = drawChart.computeHitRegions(
    {
      primaryChart: chart,
      comparisonChart: {
        ...chart,
        angles: { asc: 12, dsc: 192, mc: 101, ic: 281 },
        houses: {
          cusps: Array.from(
            { length: 12 },
            (_, index) => index * 30 + 7,
          ),
        },
      },
      displayDatetime: "2026-07-26T12:34:56+02:00",
      renderVariant: "round",
      overlayRenderMode: "full",
      outerRingMode: "none",
    },
    {
      width: 800,
      height: 800,
      renderStyle: DEFAULT_WHEEL_RENDER_STYLE,
      includeStyleTargets: true,
      textsize: (text, opts) => [
        String(text).length * (opts?.size ?? 14) * 0.5,
        opts?.size ?? 14,
      ],
    },
  );
  const outerCusps = regions.filter(
    (region) =>
      region.kind === "style_target"
      && region.classId === "houses.outer.cusp",
  );
  assert.equal(outerCusps.length, 12);
  assert.equal(new Set(outerCusps.map((region) => region.itemId)).size, 12);
});

test("body collision measurement consumes full profile-v2 typography paint", async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const style = createWheelRenderStyle({
    palette: DEFAULT_WHEEL_RENDER_STYLE.palette,
    authoringOverrides: {
      referenceRadius: 400,
      typography: {
        classic: {
          "bodies.inner.glyph": {
            fontRef: {
              cssFamily: "AuditFace",
              weight: 650,
              style: "italic",
            },
            trackingPx: 7,
          },
        },
      },
      linePaint: {},
      fillPaint: {},
      ringRadii: {},
    },
  });
  const typography = resolveWheelTypographyMetrics(style, "classic", 400);
  const measured = [];
  const chart = {
    meta: {
      dateDisplay: "",
      timeDisplay: "",
      place: "",
      placeCoords: "",
    },
    planets: [
      {
        id: "sun",
        seId: 0,
        longitude: 10,
        latitude: 0,
        speed: 1,
        glyph: "A",
      },
      {
        id: "moon",
        seId: 1,
        longitude: 10.1,
        latitude: 0,
        speed: 1,
        glyph: "B",
      },
    ],
    angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
    houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30) },
    aspects: [],
    options: {
      theme: 0,
      signVariant: 1,
      showHouses: false,
      showPositions: false,
      showAspects: false,
      showSymbols: false,
      showTerms: false,
      showDecans: false,
    },
  };
  drawChart.arrangeBodies(
    {
      textsize: (text, opts) => {
        measured.push({ text, opts });
        return [
          String(text).length * 10
            + Math.max(0, String(text).length - 1) * (opts?.tracking ?? 0),
          opts?.size ?? 14,
        ];
      },
    },
    chart,
    [400, 400],
    wheelFrameForTest(chart),
    250,
    "FallbackBody",
    "FallbackUi",
    typography,
    style,
    false,
    false,
    true,
    false,
    false,
    false,
  );
  const bodyMeasures = measured.filter(
    ({ text }) => text === "A" || text === "B",
  );
  assert.ok(bodyMeasures.length >= 2);
  assert.ok(
    bodyMeasures.every(({ opts }) =>
      opts.font === "AuditFace"
      && opts.weight === 650
      && opts.style === "italic"
      && opts.tracking === 7
    ),
  );
});

test("Anglo filled angle arrows consume the resolved semantic class color", async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const style = createWheelRenderStyle({
    palette: DEFAULT_WHEEL_RENDER_STYLE.palette,
    authoringTargetProfile: "anglo",
    authoringOverrides: {
      referenceRadius: 400,
      typography: {},
      linePaint: {
        anglo: {
          "angles.inner.arrowhead": {
            color: "#123456",
            opacity: 0.42,
          },
        },
      },
      fillPaint: {},
      ringRadii: {},
    },
  });
  const fills = [];
  const context = {
    fillStyle: "",
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      fills.push({
        fillStyle: this.fillStyle,
        globalAlpha: this.globalAlpha,
      });
    },
  };
  drawChart.drawAngloCuspArrow(
    { ctx: context },
    [100, 100],
    { rInner: 80, r30: 100 },
    identityFrameForTest(0),
    0,
    "#legacy-angle",
    style,
  );
  assert.deepEqual(fills, [{
    fillStyle: "#123456",
    globalAlpha: 0.42,
  }]);
});

test("motion markers attach to measured glyph bounds and retain the wx size matrix", async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const markerPaint = (profile, theme, marker, fontSizePx, outer = false) => {
    const style = createWheelRenderStyle({
      palette: DEFAULT_WHEEL_RENDER_STYLE.palette,
      authoringOverrides: {
        referenceRadius: 400,
        typography: {
          [profile]: {
            "bodies.inner.glyph": { fontSizePx },
          },
        },
        linePaint: {},
        fillPaint: {},
        ringRadii: {},
      },
    });
    const recordedText = [];
    const draw = new drawChart.CanvasDraw(recordingCanvas(recordedText));
    draw.resize(800, 800, 1);
    const chart = {
      meta: {
        dateDisplay: "",
        timeDisplay: "",
        place: "",
        placeCoords: "",
      },
      planets: [{
        id: "sun",
        seId: 0,
        longitude: 0,
        latitude: 0,
        speed: -1,
        glyph: "A",
        motion: marker,
      }],
      angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
      houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30) },
      aspects: [],
      options: {
        theme,
        signVariant: 1,
        showHouses: false,
        showPositions: false,
        showAspects: false,
        showSymbols: false,
        showTerms: false,
        showDecans: false,
      },
    };
    drawChart.drawPlanets(
      draw,
      [400, 400],
      { rPlanet: 200, rRetr: 190 },
      wheelFrameForTest(chart),
      chart,
      new Map(),
      new Map(),
      style.palette,
      "FallbackBody",
      "FallbackUi",
      resolveWheelTypographyMetrics(style, profile, 400),
      style,
      outer,
    );
    return {
      glyph: recordedText.find(({ text }) => text === "A"),
      marker: recordedText.find(({ text }) => text === marker),
    };
  };
  for (const [profile, theme] of [["classic", 0], ["anglo", 2]]) {
    const baseMotionSize = resolveWheelTypographyMetrics(
      DEFAULT_WHEEL_RENDER_STYLE,
      profile,
      400,
    ).motionSize;
    for (const marker of ["R", "SR", "SD"]) {
      const expectedSize = marker === "R" ? baseMotionSize : baseMotionSize * (4 / 3);
      const defaultPaint = markerPaint(profile, theme, marker, 25);
      const enlargedPaint = markerPaint(profile, theme, marker, 80);
      assert.equal(
        defaultPaint.marker?.fontSize,
        Math.round(expectedSize),
        `${profile} ${marker} uses its wx font ratio`,
      );
      assert.equal(
        defaultPaint.marker?.x,
        defaultPaint.glyph.x + defaultPaint.glyph.w,
        `${profile} ${marker} attaches to the measured glyph right edge`,
      );
      assert.ok(
        Math.abs(
          defaultPaint.marker.y + defaultPaint.marker.fontSize
          - (defaultPaint.glyph.y + defaultPaint.glyph.fontSize)
        ) <= 1,
        `${profile} ${marker} aligns to the glyph font-box bottom edge`,
      );
      assert.equal(
        enlargedPaint.marker?.x,
        enlargedPaint.glyph.x + enlargedPaint.glyph.w,
        `${profile} ${marker} follows an independently authored glyph size`,
      );
    }
  }

  const wxSizeMatrix = [
    ["classic", 0, false, { R: 6.25, S: 6.25, SR: 25 / 3, SD: 25 / 3 }],
    ["compact", 1, false, { R: 12.5, S: 12.5, SR: 25 / 3, SD: 25 / 3 }],
    ["anglo", 2, false, { R: 6.25, S: 6.25, SR: 25 / 3, SD: 25 / 3 }],
    ["classic", 0, true, { R: 25 / 3, S: 25 / 3, SR: 25 / 3, SD: 25 / 3 }],
    ["compact", 1, true, { R: 6.25, S: 6.25, SR: 25 / 3, SD: 25 / 3 }],
    ["anglo", 2, true, { R: 5, S: 5, SR: 20 / 3, SD: 20 / 3 }],
  ];
  for (const [profile, theme, outer, expected] of wxSizeMatrix) {
    for (const [marker, size] of Object.entries(expected)) {
      assert.equal(
        markerPaint(profile, theme, marker, 25, outer).marker?.fontSize,
        Math.round(size),
        `${profile} ${outer ? "outer" : "inner"} ${marker} matches wx sizing`,
      );
    }
  }
});

test("default geometry preserves the full wheel mode and subdivision matrix", () => {
  const matrix = [];
  for (const profile of ["classic", "compact", "anglo"]) {
    for (const mode of ["single", "comparison"]) {
      for (const showTerms of [false, true]) {
        for (const showDecans of [false, true]) {
          for (const showHouses of [false, true]) {
            const rings = resolveWheelRingSet({...DEFAULT_WHEEL_RENDER_STYLE, geometry: HISTORICAL_WHEEL_FACTORY_SETTINGS.geometry}, {
              profile,
              mode,
              maxRadius: 1000,
              hasOuterRing: mode === "comparison",
              showTerms,
              showDecans,
              showHouses,
              showPositions: true,
              comparisonWithOuterHouses: mode === "comparison" && showHouses,
            });
            assert.ok(Object.isFrozen(rings));
            matrix.push({
              key: [
                profile,
                mode,
                Number(showTerms),
                Number(showDecans),
                Number(showHouses),
              ].join(":"),
              // Sorted: the ring set is a frozen record read by property
              // access, so key insertion order is incidental and must not
              // make an internal geometry refactor look like a value change.
              rings: Object.fromEntries(
                Object.entries(rings)
                  .sort(([left], [right]) => (left < right ? -1 : 1))
                  .map(([key, value]) => [
                    key,
                    typeof value === "number" ? Number(value.toFixed(6)) : value,
                  ]),
              ),
            });
          }
        }
      }
    }
  }

  assert.equal(matrix.length, 48);
  assert.equal(
    createHash("sha256").update(JSON.stringify(matrix)).digest("hex"),
    "390190fc6123ba1653d744f55bacec8bee20e377f2335f48c5cee34c50ee4678",
  );
  const selected = Object.fromEntries(
    matrix
      .filter(({ key }) =>
        [
          "classic:single:0:0:0",
          "compact:single:1:1:0",
          "anglo:comparison:1:1:1",
        ].includes(key),
      )
      .map(({ key, rings }) => [
        key,
        {
          r30: rings.r30,
          rInner: rings.rInner,
          rPlanet: rings.rPlanet,
          rAsp: rings.rAsp,
          rPos: rings.rPos,
          rOuterMax: rings.rOuterMax,
          rOuterHouse: rings.rOuterHouse,
        },
      ]),
  );
  assert.deepEqual(selected, {
    "classic:single:0:0:0": {
      r30: 830,
      rInner: 680,
      rPlanet: 605,
      rAsp: 530,
      rPos: 480,
      rOuterMax: undefined,
      rOuterHouse: undefined,
    },
    "compact:single:1:1:0": {
      r30: 830,
      rInner: 520,
      rPlanet: 445,
      rAsp: 370,
      rPos: 370,
      rOuterMax: undefined,
      rOuterHouse: undefined,
    },
    "anglo:comparison:1:1:1": {
      r30: 800,
      rInner: 572.8,
      rPlanet: 518.4,
      rAsp: 244,
      rPos: 452,
      rOuterMax: 990,
      rOuterHouse: 940,
    },
  });
});

test("Anglo projected points use the current outer-body perimeter", () => {
  const single = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
    profile: "anglo",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: true,
    showTerms: false,
    showDecans: false,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  });
  const comparison = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
    profile: "anglo",
    mode: "comparison",
    maxRadius: 400,
    hasOuterRing: true,
    showTerms: false,
    showDecans: false,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: true,
  });

  assert.equal(single.rAntis, 380);
  assert.equal(comparison.rAntis, comparison.rOuterPlanet);
  assert.equal(comparison.rAntis, 344);
});

test("restrained Anglo comparisons reserve a golden-section outer-house number lane", () => {
  const standard = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
    profile: "anglo",
    mode: "comparison",
    maxRadius: 400,
    hasOuterRing: true,
    showTerms: false,
    showDecans: false,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
    restrainedAngloComparison: false,
  });
  const comparison = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
    profile: "anglo",
    mode: "comparison",
    maxRadius: 400,
    hasOuterRing: true,
    showTerms: false,
    showDecans: false,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
    restrainedAngloComparison: true,
  });

  assert.equal(standard.r30, 358);
  assert.equal(standard.rOuterPlanet, 380);
  assert.equal(standard.rOuterHouseName, undefined);
  assert.equal(comparison.r30, 320);
  assert.equal(comparison.rOuterPlanet, 344);
  assert.equal(comparison.rOuterHouse, 376);
  assert.equal(comparison.rOuterHouseName, 364);
  assert.ok(
    Math.abs(
      (comparison.rOuterHouseName - comparison.rOuterPlanet) /
        (comparison.rOuterHouse - comparison.rOuterPlanet) -
        1 / ((1 + Math.sqrt(5)) / 2),
    ) < 0.01,
  );
  assert.equal(comparison.rOuterMax, 396);
});

test("render styles own an immutable snapshot of the dynamic palette", () => {
  const palette = {
    ...DEFAULT_WHEEL_RENDER_STYLE.palette,
    background: "dynamic-background",
    planets: [...DEFAULT_WHEEL_RENDER_STYLE.palette.planets],
    aspects: [...DEFAULT_WHEEL_RENDER_STYLE.palette.aspects],
  };
  const style = createWheelRenderStyle({
    palette,
    revision: 42,
    fontUi: "UI test",
    fontSymbols: "Symbol test",
    fontBodySymbols: "Body test",
    fontSignSymbols: "Sign test",
    fontTermSymbols: "Term test",
    fontDecanSymbols: "Decan test",
    fontAspectSymbols: "Aspect test",
  });

  palette.background = "mutated";
  palette.planets[0] = "mutated";
  assert.equal(style.schemaVersion, 1);
  assert.equal(style.revision, 42);
  assert.equal(style.palette.background, "dynamic-background");
  assert.notEqual(style.palette.planets[0], "mutated");
  assert.deepEqual(style.typography.families, {
    ui: "UI test",
    symbols: "Symbol test",
    bodySymbols: "Body test",
    signSymbols: "Sign test",
    termSymbols: "Term test",
    decanSymbols: "Decan test",
    aspectSymbols: "Aspect test",
  });
  assert.ok(Object.isFrozen(style));
  assert.ok(Object.isFrozen(style.palette));
  assert.ok(Object.isFrozen(style.palette.planets));
  assert.ok(Object.isFrozen(style.typography));
});

test("legacy options and an explicit style resolve to equivalent contracts", () => {
  const palette = {
    ...DEFAULT_WHEEL_RENDER_STYLE.palette,
    planets: [...DEFAULT_WHEEL_RENDER_STYLE.palette.planets],
    aspects: [...DEFAULT_WHEEL_RENDER_STYLE.palette.aspects],
  };
  const legacy = resolveWheelRenderStyle({
    palette,
    styleRevision: 9,
    fontUi: "UI legacy",
    fontSymbols: "Symbols legacy",
  });
  const explicit = createWheelRenderStyle({
    palette,
    revision: 9,
    fontUi: "UI legacy",
    fontSymbols: "Symbols legacy",
  });

  assert.deepEqual(legacy, explicit);
  assert.strictEqual(resolveWheelRenderStyle({ renderStyle: explicit }), explicit);
});

test("ChartCanvas passes one memoized renderStyle to every draw and hit path", async () => {
  const source = await readSource(
    new URL("../src/components/workshell/chart-canvas.tsx", import.meta.url),
  );
  assert.match(source, /const renderStyle = useMemo\(/);
  assert.match(source, /resolveWheelGeometryPresetStyle\(/);
  assert.match(
    source,
    /\(cssVar\) => styleWorkingPreviewActive[\s\S]*?styleCssOverrides\[cssVar\][\s\S]*?effectiveTheme\?\.chartPalette\?\.\[cssVar\]/,
  );
  assert.match(source, /effectiveTheme\?\.chartPalette,/);
  assert.doesNotMatch(source, /getComputedStyle/);
  assert.doesNotMatch(source, /createWheelRenderStyle\(/);
  assert.equal((source.match(/drawSnapshotLayer\(/g) ?? []).length, 4);
  assert.equal((source.match(/\n\s+renderStyle,\n/g) ?? []).length, 6);
  assert.doesNotMatch(source, /\n\s+palette,\n\s+renderStyle,/);
  assert.match(source, /computeHitRegions\([\s\S]*?renderStyle,/);
  assert.match(source, /overlayRenderMode === "step_fast"[\s\S]*?fill: true/);
  assert.match(source, /drawSnapshotLayer\(fillDraw, renderSnapshot, "fill"/);
});

test("zodiac element fields follow the current wheel frame", async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const firstSectorStart = (asc) => {
    const starts = [];
    let fillCount = 0;
    const fillAlphas = [];
    const context = {
      fillStyle: "",
      globalAlpha: 1,
      save() {},
      restore() {},
      beginPath() {},
      moveTo(x, y) {
        starts.push([x, y]);
      },
      lineTo() {},
      arc() {},
      closePath() {},
      fill() {
        fillCount += 1;
        fillAlphas.push(this.globalAlpha);
      },
    };
    const chart = {
      planets: [],
      angles: { asc, dsc: (asc + 180) % 360, mc: 90, ic: 270 },
      houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30) },
      aspects: [],
      options: {
        theme: 0,
        signVariant: 1,
        useZodiacElementFieldColors: true,
        zodiacElementFieldOpacity: 0.65,
      },
    };
    assert.equal(
      drawChart.paintZodiacElementSlices(
        { ctx: context },
        chart,
        DEFAULT_WHEEL_RENDER_STYLE,
        "classic",
        [100, 100],
        80,
        60,
      ),
      true,
    );
    assert.equal(fillCount, 12);
    assert.ok(fillAlphas.every((opacity) => opacity === 0.65));
    return starts[0];
  };

  assert.equal(
    resolveWheelFillPaint(
      DEFAULT_WHEEL_RENDER_STYLE,
      "classic",
      "fills.zodiacElementSlices",
    ).opacity,
    1,
  );
  assert.equal(
    drawChart.zodiacElementTextureFillClass(
      DEFAULT_WHEEL_RENDER_STYLE,
      "classic",
    ),
    "fills.zodiacBand",
  );
  const fieldTextureStyle = {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      fillPaint: {
        classic: {
          "fills.zodiacElementSlices": { fillPattern: "paper" },
        },
      },
    },
  };
  assert.equal(
    drawChart.zodiacElementTextureFillClass(fieldTextureStyle, "classic"),
    "fills.zodiacElementSlices",
  );

  const canonicalZodiacTextureStyle = {
    ...fieldTextureStyle,
    authoringOverrides: {
      ...fieldTextureStyle.authoringOverrides,
      fillPaint: {
        classic: {
          "fills.zodiacBand": { fillPattern: "hatch" },
          "fills.zodiacElementSlices": { fillPattern: "paper" },
        },
      },
    },
  };
  assert.equal(
    drawChart.zodiacElementTextureFillClass(
      canonicalZodiacTextureStyle,
      "classic",
    ),
    "fills.zodiacBand",
  );

  const texturedStyle = {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      fillPaint: {
        classic: {
          "fills.zodiacBand": {
            fillPattern: "hatch",
            patternColor: "#123456",
            opacity: 0.42,
          },
        },
      },
    },
  };
  const texturedFillAlphas = [];
  const texturedContext = {
    fillStyle: "",
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    closePath() {},
    fill() {
      texturedFillAlphas.push(this.globalAlpha);
    },
    getTransform() {
      return { a: 1 };
    },
    createPattern() {
      return {};
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            fillStyle: "",
            fillRect() {},
            createImageData(width, height) {
              return { data: new Uint8ClampedArray(width * height * 4) };
            },
            putImageData() {},
          };
        },
      };
    },
  };
  try {
    assert.equal(
      drawChart.paintZodiacElementSlices(
        { ctx: texturedContext },
        {
          planets: [],
          angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
          houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30) },
          aspects: [],
          options: {
            theme: 0,
            signVariant: 1,
            useZodiacElementFieldColors: true,
            zodiacElementFieldOpacity: 0.65,
          },
        },
        texturedStyle,
        "classic",
        [100, 100],
        80,
        60,
      ),
      true,
    );
  } finally {
    globalThis.document = previousDocument;
  }
  assert.equal(texturedFillAlphas.length, 13);
  assert.ok(texturedFillAlphas.slice(0, 12).every((opacity) => opacity === 0.65));
  assert.equal(texturedFillAlphas[12], 0.42);

  const atAscZero = firstSectorStart(0);
  const atAscFifteen = firstSectorStart(15);
  assert.deepEqual(atAscZero.map(Math.round), [20, 100]);
  assert.notDeepEqual(atAscFifteen.map(Math.round), atAscZero.map(Math.round));
  const radians = (180 - 15) * Math.PI / 180;
  assert.ok(Math.abs(atAscFifteen[0] - (100 + Math.cos(radians) * 80)) < 1e-8);
  assert.ok(Math.abs(atAscFifteen[1] - (100 - Math.sin(radians) * 80)) < 1e-8);
});

test("draw and hit paths resolve the shared metrics instead of private literals", async () => {
  const source = await readSource(
    new URL("../src/lib/chart/draw-chart.ts", import.meta.url),
  );
  // The projected outer-ring adapter shares the production metrics too.
  assert.equal((source.match(/resolveWheelTypographyMetrics\(/g) ?? []).length, 4);
  assert.match(source, /const drawStyle = resolveDrawStyle\(opts\);/);
  assert.match(
    source,
    /const style = projectWheelAuthoringStyle\(\s*drawStyle,/,
  );
  assert.match(source, /return resolveWheelRenderStyle\(opts\)/);
  assert.match(source, /const hitStyle = resolveWheelRenderStyle\(opts\);/);
  assert.match(
    source,
    /const style = projectWheelAuthoringStyle\(\s*hitStyle,/,
  );
  // Paint and hit testing must derive the wheel radius through the same helper.
  // Scaling only one of them would leave a shrunken wheel with hover and click
  // targets still sitting at full size.
  assert.equal((source.match(/scaledWheelRadius\(/g) ?? []).length, 4);
  assert.doesNotMatch(source, /const maxRadius = chartSize \/ 2;/);
  assert.match(source, /style\.outerLabels\.edgePadFactor/);
  assert.equal((source.match(/resolveWheelRingSet\(style, wheelGeometryInputForSnapshot\(snapshot,/g) ?? []).length, 4);
  for (const section of ["geometry", "typography", "strokes", "labels", "collision", "hit"]) {
    assert.match(source, new RegExp(`style\\.${section}`));
  }
  assert.doesNotMatch(source, /function (?:rings|angloRings|angloComparisonRings|compactBaseOffset)\(/);
  assert.doesNotMatch(source, /hasAspectLayer/);
  assert.doesNotMatch(source, /renderVariant !== "round-compact"/);
  assert.doesNotMatch(source, /function chart(?:Outer)?SymbolSize/);
  assert.doesNotMatch(source, /const ANGLO_ANGLE_LABEL_(?:SCALE|WEIGHT)/);
});

test("Anglo comparisons share one restrained outer-house treatment", async () => {
  const drawSource = await readSource(
    new URL("../src/lib/chart/draw-chart.ts", import.meta.url),
  );
  const canvasSource = await readSource(
    new URL("../src/components/workshell/chart-canvas.tsx", import.meta.url),
  );

  assert.match(
    drawSource,
    /function comparisonShowsHouseCusps[\s\S]*?snapshot\.comparisonChart[\s\S]*?hasWheelRing\(chart, "houses"\)[\s\S]*?chart\.options\.showOuterHouseLines !== false/,
  );
  assert.match(
    drawSource,
    /function comparisonUsesOuterHouseBand[\s\S]*?comparisonShowsHouseCusps\(snapshot, chart\) && !isAngloWheel\(chart\)/,
  );
  assert.match(
    drawSource,
    /function usesRestrainedAngloComparison[\s\S]*?snapshot\.document\?\.compoundKind === "synastry"/,
  );
  assert.match(
    drawSource,
    /if \(comparisonChart && showOuterHouseCusps\) \{\s*drawOuterHouses\(/,
  );
  assert.match(
    drawSource,
    /const outerHouseNameRadius =\s*ringset\.rOuterHouseName \?\? ringset\.rOuterArrow \?\? ringset\.rOuterASCMC/,
  );
  assert.match(
    drawSource,
    /function outerHouseCuspRadii[\s\S]*?restrainedAngloComparison \? ringset\.rOuterHouse[\s\S]*?: ringset\.rOuterHouseName \?\? ringset\.rOuterASCMC \?\? ringset\.rOuterArrow/,
  );
  assert.match(
    drawSource,
    /showOuterHouseBand \|\| restrainedAngloComparison/,
  );
  assert.match(
    drawSource,
    /const outerSymbolSize = restrainedAngloComparison[\s\S]*?\? typography\.bodySize[\s\S]*?: typography\.outerSize/,
  );
  assert.match(
    drawSource,
    /outer && !usePrimaryGlyphSize[\s\S]*?\? typography\.outerSize[\s\S]*?: typography\.bodySize/,
  );
  assert.doesNotMatch(drawSource, /comparisonLayout/);
  assert.match(canvasSource, /wheelGeometryInputForSnapshot\(\s*renderSnapshot,/);
  assert.doesNotMatch(canvasSource, /const comparisonWithOuterHouseBand/);
});

test("maximum body glyph size is bounded and isolated from every other typography group", () => {
  const [, maximum] = WHEEL_RENDER_TOKEN_RANGES.get("bodyScale");
  assert.equal(maximum, 0.125);
  const maxStyle = createTokenizedWheelRenderStyle({
    tokens: { ...DEFAULT_WHEEL_RENDER_TOKENS, bodyScale: maximum },
  });
  const baseline = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "classic",
    400,
  );
  const maximumMetrics = resolveWheelTypographyMetrics(maxStyle, "classic", 400);
  assert.equal(maximumMetrics.bodySize, 50);
  const { bodySize: baselineBodySize, ...baselineGroups } = baseline;
  const { bodySize: maximumBodySize, ...maximumGroups } = maximumMetrics;
  assert.notEqual(maximumBodySize, baselineBodySize);
  assert.deepEqual(maximumGroups, baselineGroups);

  const rejected = resolveWheelRenderTokens((cssVar) =>
    cssVar === "--aries-wheel-body-scale" ? "0.126" : undefined
  );
  assert.equal(rejected.bodyScale, DEFAULT_WHEEL_RENDER_TOKENS.bodyScale);
});

test("prenatal syzygy and eclipse points keep their dedicated glyph scale", async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const bodySize = 25;
  const syzygyScale = DEFAULT_WHEEL_RENDER_STYLE.typography.ratios.syzygyScale;

  assert.ok(
    Math.abs(drawChart.bodyGlyphSize("__syzygy", bodySize, syzygyScale) - 14.5) < 1e-9,
  );
  assert.ok(
    Math.abs(drawChart.bodyGlyphSize("__eclipse", bodySize, syzygyScale) - 14.5) < 1e-9,
  );
  assert.equal(drawChart.bodyGlyphSize("sun", bodySize, syzygyScale), bodySize);

  const chart = {
    planets: [],
    syzygy: { longitude: 10, glyph: "Sy" },
    eclipse: { longitude: 10, glyph: "Ec", coincidesWithSyzygy: true },
  };
  assert.deepEqual(drawChart.bodyKeys(chart), ["__eclipse"]);
  chart.eclipse.coincidesWithSyzygy = false;
  assert.deepEqual(drawChart.bodyKeys(chart), ["__syzygy", "__eclipse"]);
});

function relativeBodyGlyphChart(theme, outer = false) {
  return {
    meta: { dateDisplay: "", timeDisplay: "", place: "", placeCoords: "" },
    planets: [{ id: "sun", seId: 0, longitude: 0, latitude: 0, speed: 1,
      glyph: outer ? "B" : "A", degText: "0", minText: "00" }],
    syzygy: { longitude: 120, glyph: outer ? "OSy" : "Sy", glyphFont: "text", degText: "0", minText: "00" },
    eclipse: { longitude: 240, glyph: outer ? "OEc" : "Ec", glyphFont: "text",
      coincidesWithSyzygy: false, degText: "0", minText: "00" },
    angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
    houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30) },
    aspects: [],
    options: { theme, signVariant: 1, showHouses: false, showPositions: false,
      showAspects: false, showSymbols: false, showTerms: false, showDecans: false,
      showCusplessAscMcLabels: false, showPrenatalSyzygy: true, showPrenatalEclipse: true },
  };
}

test("shared object size edits preserve Sy/Ec proportions and anchor offsets in final paint", async () => {
  const renderer = await loadDrawChartCollisionInternals();
  for (const [theme, profile] of ["classic", "compact", "anglo", "houses", "cusps"].entries()) {
    for (const outer of [false, true]) {
      for (const radius of [200, 400]) {
        for (const fontSizePx of [20, 30, 60]) {
          for (const syzygyScale of [0.58, 0.75]) {
            const classId = outer ? "bodies.outer.glyph" : "bodies.inner.glyph";
            // The same serialized appearance data is used after a profile reload.
            const overrides = JSON.parse(JSON.stringify({ ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
              typography: { [profile]: { [classId]: { fontSizePx } } },
            }));
            const style = createTokenizedWheelRenderStyle({ authoringTargetProfile: profile,
              authoringTargetRadius: radius, authoringOverrides: overrides,
              tokens: { ...DEFAULT_WHEEL_RENDER_TOKENS, syzygyScale } });
            const chart = relativeBodyGlyphChart(theme);
            const recorded = [];
            const draw = new renderer.CanvasDraw(recordingCanvas(recorded));
            draw.resize(radius * 2, radius * 2, 1);
            const rings = { rPlanet: radius / 2, rRetr: radius / 2 - 10 };
            const frame = wheelFrameForTest(chart);
            const typography = resolveWheelTypographyMetrics(style, profile, radius);
            renderer.drawPlanets(draw, [radius, radius], rings, frame, chart,
              new Map(), new Map(), style.palette, "AriesMorinus", "FreeSans", typography, style, outer);
            const ordinarySize = fontSizePx * radius / 400;
            for (const glyph of ["A", "Sy", "Ec"]) {
              const painted = recorded.find(row => row.text === glyph);
              assert.ok(painted, `${profile}/${outer}: ${glyph} is painted`);
              const expectedSize = ordinarySize * (glyph === "A" ? 1 : syzygyScale);
              assert.equal(painted.fontSize, Math.round(expectedSize), `${profile}/${outer}/${fontSizePx}: ${glyph} keeps its ratio`);
              const longitude = glyph === "A" ? 0 : glyph === "Sy" ? 120 : 240;
              const center = renderer.polar([radius, radius], rings.rPlanet, longitude, frame);
              assert.ok(Math.abs(painted.x - (center[0] - expectedSize / 2)) <= 1, `${glyph} horizontal offset follows its own size`);
              assert.ok(Math.abs(painted.y - (center[1] - expectedSize / 2)) <= 1, `${glyph} vertical offset follows its own size`);
            }
          }
        }
      }
    }
  }
});

test("body layout, outer readouts and hit measurements retain the same relative glyph sizes", async () => {
  const renderer = await loadDrawChartCollisionInternals();
  for (const [theme, profile] of ["classic", "compact", "anglo", "houses", "cusps"].entries()) {
    const primary = relativeBodyGlyphChart(theme);
    const comparison = relativeBodyGlyphChart(theme, true);
    primary.options.showOuterPositions = true;
    const style = createTokenizedWheelRenderStyle({ authoringTargetProfile: profile,
      authoringOverrides: { ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
        typography: { [profile]: { "bodies.inner.glyph": { fontSizePx: 30 }, "bodies.outer.glyph": { fontSizePx: 40 } } },
      },
    });
    const measured = new Map();
    const regions = renderer.computeHitRegions({ primaryChart: primary, comparisonChart: comparison,
      renderVariant: "round", outerRingMode: "none", overlayRenderMode: "none" }, {
      width: 800, height: 800, renderStyle: style,
      textsize: (text, paint) => {
        if (["A", "B", "Sy", "Ec", "OSy", "OEc"].includes(text)) {
          if (!measured.has(text)) measured.set(text, new Set());
          measured.get(text).add(paint.size);
        }
        return [String(text).length * paint.size * 0.6, paint.size];
      },
    });
    for (const [ordinary, specials] of [["A", ["Sy", "Ec"]], ["B", ["OSy", "OEc"]]]) {
      assert.equal(measured.get(ordinary)?.size, 1, `${profile}: one resolved ${ordinary} size`);
      const ordinarySize = [...measured.get(ordinary)][0];
      for (const glyph of specials) {
        assert.equal(measured.get(glyph)?.size, 1, `${profile}: ${glyph} layout and hits agree`);
        assert.ok(Math.abs([...measured.get(glyph)][0] - ordinarySize * 0.58) < 1e-9,
          `${profile}: ${glyph} measurements retain their proportion`);
      }
    }
    assert.equal(regions.filter(region => region.kind === "syzygy").length, 2);
    assert.equal(regions.filter(region => region.kind === "eclipse").length, 2);
  }
});

test("Surveil targets distinguish Morinus glyphs from text labels", async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
    profile: "classic",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: false,
    showDecans: false,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  });
  const measurer = {
    textsize: (text, opts) => [
      String(text).length * (opts?.size ?? 12) * 0.6,
      opts?.size ?? 12,
    ],
  };
  const layout = (mark) =>
    drawChart.layoutSurveilMark(
      measurer,
      [400, 400],
      rings,
      identityFrameForTest(0),
      mark,
      { surveilAccent: "#ff8800" },
      "Aries UI",
      "Aries Morinus",
      25,
      DEFAULT_WHEEL_RENDER_STYLE,
    );
  assert.equal(
    layout({
      id: "sun",
      longitude: 15,
      label: "Sun",
      glyph: "A",
      glyphFont: "morinus",
    }).marker.classId,
    "surveil.marker.glyph",
  );
  assert.equal(
    layout({
      id: "asc",
      longitude: 30,
      label: "Asc",
      glyph: "Asc",
      glyphFont: "text",
    }).marker.classId,
    "surveil.marker.label",
  );
});

test("maximum body glyph layout terminates with finite shifts", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const [, maximum] = WHEEL_RENDER_TOKEN_RANGES.get("bodyScale");

  const oversizedStyle = createTokenizedWheelRenderStyle({
    tokens: {
      ...DEFAULT_WHEEL_RENDER_TOKENS,
      bodyScale: maximum,
    },
  });
  const maxRadius = 400;
  const typography = resolveWheelTypographyMetrics(
    oversizedStyle,
    "classic",
    maxRadius,
  );
  const chart = {
    planets: [
      { id: "sun", longitude: 0, glyph: "A" },
      { id: "moon", longitude: 180, glyph: "B" },
    ],
    options: {
      theme: 0,
      showHouses: false,
      showPositions: false,
      showCusplessAscMcLabels: false,
    },
    houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30) },
    angles: { asc: 0, mc: 90 },
  };
  const oversizedBodyMeasurer = {
    textsize: () => [typography.bodySize, typography.bodySize],
  };
  const bodyShifts = drawChart.arrangeBodies(
    oversizedBodyMeasurer,
    chart,
    [maxRadius, maxRadius],
    identityFrameForTest(0),
    178,
    "AriesMorinus",
    "sans-serif",
    typography,
    oversizedStyle,
    false,
    false,
    true,
    false,
  );
  assert.equal(typography.bodySize, 50);
  assert.ok([...bodyShifts.values()].every(Number.isFinite));

  const fixedStarLayout = drawChart.prepareFixedStars(
    { textsize: () => [2_000, 10] },
    [maxRadius, maxRadius],
    200,
    identityFrameForTest(0),
    [
      { name: "Alpha", longitude: 0 },
      { name: "Beta", longitude: 180 },
    ],
    178,
    "sans-serif",
    typography.outerLabelSize,
    oversizedStyle,
  );
  assert.ok(fixedStarLayout.shifts.every(Number.isFinite));
  assert.ok(fixedStarLayout.yOffsets.every(Number.isFinite));
});

test("outer-ring title avoidance leaves fitted glyph lanes on their longitude", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const center = [400, 400];
  const labelRadius = 300;
  const measurer = { textsize: () => [100, 18] };
  const typography = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "classic",
    400,
  );
  const titleBounds = { x: 250, y: 75, w: 300, h: 50 };
  const items = [
    {
      id: "outer-alkaid",
      family: "fixed_stars",
      longitude: 260,
      label: "Alkaid 27°18′",
    },
    {
      id: "outer-children",
      family: "arabic_parts",
      longitude: 260,
      label: "Children",
    },
    {
      id: "outer-dodecatemoria-mars",
      family: "dodecatemoria",
      longitude: 260,
      label: "Mars",
      segments: [{ text: "E", kind: "planet", seId: 4 }],
    },
  ];
  for (const item of items) {
    const outerItemArgs = [
      measurer,
      center,
      285,
      identityFrameForTest(0),
      [item],
      labelRadius,
      labelRadius,
      "sans-serif",
      "AriesMorinus",
      typography,
      { planets: [] },
      DEFAULT_WHEEL_RENDER_STYLE.palette,
      DEFAULT_WHEEL_RENDER_STYLE,
    ];
    const unobstructedOuterItem = drawChart.prepareOuterRingItems(
      ...outerItemArgs,
    );
    const obstructedOuterItem = drawChart.prepareOuterRingItems(
      ...outerItemArgs,
      [titleBounds],
    );
    assert.equal(unobstructedOuterItem.shifts[0], 0, item.family);
    assert.equal(unobstructedOuterItem.yOffsets[0], 0, item.family);
    if (item.family === "dodecatemoria") {
      assert.equal(obstructedOuterItem.shifts[0], 0, item.family);
      assert.equal(obstructedOuterItem.yOffsets[0], 0, item.family);
    } else {
      assert.ok(
        Math.abs(obstructedOuterItem.shifts[0]) >= 1.5,
        item.family,
      );
      assert.ok(
        Math.abs(obstructedOuterItem.shifts[0]) < 2,
        item.family,
      );
      assert.ok(obstructedOuterItem.yOffsets[0] > 0, item.family);
    }
  }

  for (const [family, width, height] of [
    ["fixed_stars", 100, 18],
    ["arabic_parts", 240, 18],
    ["dodecatemoria", 42, 42],
  ]) {
    const radial = -Math.PI / 2;
    const x = center[0] - width / 2;
    const y = center[1] - labelRadius + 30;
    const [outsideX, outsideY] = drawChart.ensureTextOutsideOuterWheel(
      center,
      285,
      radial,
      x,
      y,
      width,
      height,
      labelRadius,
      3,
    );
    const minimumCornerRadius = Math.min(
      Math.hypot(outsideX - center[0], outsideY - height / 2 - center[1]),
      Math.hypot(outsideX + width - center[0], outsideY - height / 2 - center[1]),
      Math.hypot(outsideX - center[0], outsideY + height / 2 - center[1]),
      Math.hypot(outsideX + width - center[0], outsideY + height / 2 - center[1]),
    );
    assert.ok(minimumCornerRadius >= 288, family);
  }

  const chart = {
    planets: [],
    angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
    houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30) },
    aspects: [],
    options: {
      uranus: true,
      pluto: 0,
      theme: 0,
      signVariant: 1,
      showHouses: false,
      showPositions: false,
      showInformation: false,
      showHouseSystem: false,
      showAspects: false,
      showSymbols: false,
      showTerms: false,
      showDecans: false,
    },
  };
  const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
    profile: "classic",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: true,
    showTerms: false,
    showDecans: false,
    showHouses: false,
    showPositions: false,
    comparisonWithOuterHouses: false,
  });
  for (const [mode, item] of [
    ["fixstars", items[0]],
    ["arabic_parts", items[1]],
    ["dodecatemoria", items[2]],
  ]) {
    const recordedText = [];
    const draw = new drawChart.CanvasDraw(recordingCanvas(recordedText));
    draw.resize(800, 800, 1);
    drawChart.drawSnapshotLayer(
      draw,
      {
        primaryChart: chart,
        displayDatetime: "2026-07-27T13:16:33+02:00",
        renderVariant: "round-classic",
        overlayRenderMode: "full",
        outerRingMode: mode,
        outerRingItems: { [mode]: [item] },
      },
      "outer-label",
      {
        width: 800,
        height: 800,
        chartSize: 800,
        renderStyle: DEFAULT_WHEEL_RENDER_STYLE,
        outerLabelCollisionBounds: [titleBounds],
      },
    );
    assert.ok(recordedText.length > 0, mode);
    for (const run of recordedText) {
      const minimumCornerRadius = Math.min(
        Math.hypot(run.x - center[0], run.y - center[1]),
        Math.hypot(run.x + run.w - center[0], run.y - center[1]),
        Math.hypot(run.x - center[0], run.y + run.h - center[1]),
        Math.hypot(run.x + run.w - center[0], run.y + run.h - center[1]),
      );
      assert.ok(
        minimumCornerRadius >= rings.rOuterLine,
        `${mode} run ${run.text} crossed the outer wheel`,
      );
    }
  }
});

test("Anglo dense-layout modes distinguish soft house cusps from hard angles", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const typography = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "anglo",
    400,
  );
  const baseChart = {
    planets: [
      { id: "sun", longitude: 0.05, glyph: "S", degText: "0", minText: "03" },
      { id: "moon", longitude: 180, glyph: "M", degText: "0", minText: "00" },
    ],
    angles: { asc: 45, dsc: 225, mc: 135, ic: 315 },
    houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30) },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: true,
      showPositions: true,
      angloDenseLabelLayout: "routed-cusps",
    },
  };
  const measurer = {
    textsize: (text, opts) => {
      const size = opts?.size ?? 14;
      return [Math.max(size, String(text).length * size * 0.6), size];
    },
  };
  const arrange = (chart, includeHouseCuspRays) => drawChart.arrangeBodies(
    measurer,
    chart,
    [400, 400],
    identityFrameForTest(0),
    278,
    "AriesMorinus",
    "sans-serif",
    typography,
    DEFAULT_WHEEL_RENDER_STYLE,
    false,
    true,
    true,
    includeHouseCuspRays,
    false,
  );

  const crossedChart = {
    ...baseChart,
    planets: [
      { ...baseChart.planets[0], longitude: 359.95, degText: "29", minText: "57" },
      baseChart.planets[1],
    ],
  };
  const beforeCusp = arrange(baseChart, true);
  const afterCusp = arrange(crossedChart, true);
  assert.equal(beforeCusp.get("sun"), 0, "a clear routed body stays on its foot");
  assert.equal(afterCusp.get("sun"), 0, "crossing a cusp does not retain an offset");

  const leaderChart = {
    ...baseChart,
    options: { ...baseChart.options, angloDenseLabelLayout: "leader-columns" },
  };
  const crossedLeaderChart = {
    ...crossedChart,
    options: leaderChart.options,
  };
  assert.equal(arrange(leaderChart, true).get("sun"), 0);
  assert.equal(arrange(crossedLeaderChart, true).get("sun"), 0);

  const angleChart = {
    ...baseChart,
    angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
    options: { ...baseChart.options, showHouses: false },
  };
  const crossedAngleChart = {
    ...crossedChart,
    angles: angleChart.angles,
    options: angleChart.options,
  };
  for (const mode of ["leader-columns", "routed-cusps"]) {
    const beforeAngle = arrange({
      ...angleChart,
      options: { ...angleChart.options, angloDenseLabelLayout: mode },
    }, false);
    const afterAngle = arrange({
      ...crossedAngleChart,
      options: { ...crossedAngleChart.options, angloDenseLabelLayout: mode },
    }, false);
    assert.ok(beforeAngle.get("sun") > 0, `${mode} must remain before ASC`);
    assert.ok(afterAngle.get("sun") < 0, `${mode} must remain after ASC`);
  }

  const clusteredCuspsChart = {
    ...baseChart,
    planets: [
      { ...baseChart.planets[0], longitude: 0, degText: "0", minText: "00" },
      baseChart.planets[1],
    ],
    houses: { cusps: [0, 4, 8, 60, 90, 120, 150, 180, 210, 240, 270, 300] },
  };
  const clusteredCuspLayout = arrange(clusteredCuspsChart, true);
  assert.ok(Math.abs(clusteredCuspLayout.get("sun") ?? 0) <= 1e-8);

  const cuspDisplacedMarsChart = {
    ...baseChart,
    planets: [
      { id: "mars", longitude: 0.05, glyph: "R", degText: "0", minText: "03" },
      baseChart.planets[1],
    ],
  };
  const staleCuspLayout = arrange(cuspDisplacedMarsChart, true);
  assert.equal(staleCuspLayout.get("mars"), 0);

  const separatedChart = {
    ...cuspDisplacedMarsChart,
    planets: [
      { ...cuspDisplacedMarsChart.planets[0], longitude: 21, degText: "21", minText: "00" },
      baseChart.planets[1],
    ],
    options: { ...baseChart.options, showHouses: false },
  };
  const releasedLayout = arrange(separatedChart, false);
  assert.equal(releasedLayout.get("mars"), 0);

  const collisionElsewhereChart = {
    ...separatedChart,
    planets: [
      separatedChart.planets[0],
      { id: "sun", longitude: 100, glyph: "S", degText: "10", minText: "00" },
      { id: "mercury", longitude: 100.1, glyph: "E", degText: "10", minText: "06" },
      baseChart.planets[1],
    ],
  };
  const releasedDespiteOtherCollision = arrange(collisionElsewhereChart, false);
  assert.equal(releasedDespiteOtherCollision.get("mars"), 0);
});

test("pair settling cannot jump a narrow glyph completely across an angle", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const typography = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "anglo",
    400,
  );
  const chart = {
    planets: [
      { id: "wide", longitude: 9.7, glyph: "WWWWWW", degText: "9", minText: "42" },
      { id: "narrow", longitude: 9.8, glyph: "n", degText: "9", minText: "48" },
      { id: "moon", longitude: 180, glyph: "m", degText: "0", minText: "00" },
    ],
    angles: { asc: 10, dsc: 190, mc: 100, ic: 280 },
    houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30 + 10) },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: false,
      showPositions: false,
    },
  };
  const layout = drawChart.arrangeBodies(
    {
      textsize: (text, opts) => [
        text === "WWWWWW" ? 120 : 8,
        opts?.size ?? 14,
      ],
    },
    chart,
    [400, 400],
    wheelFrameForTest(chart),
    278,
    "AriesMorinus",
    "sans-serif",
    typography,
    DEFAULT_WHEEL_RENDER_STYLE,
    false,
    false,
    true,
    false,
    false,
  );

  assert.ok((layout.get("wide") ?? 0) < 0);
  assert.ok((layout.get("narrow") ?? 0) < chart.angles.asc - 9.8);
});

test("dense layout keeps a near-angle foot on its true side in both Anglo modes", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const typography = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "anglo",
    400,
  );
  const longitudes = [9.99995, 341, 345, 349, 353, 357, 1, 5];
  const baseChart = {
    planets: longitudes.map((longitude, index) => ({
      id: `p${index}`,
      longitude,
      glyph: String.fromCharCode(65 + index),
      degText: String(Math.floor(((longitude % 30) + 30) % 30)),
      minText: "00",
    })),
    angles: { asc: 10, dsc: 190, mc: 100, ic: 280 },
    houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30 + 10) },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: true,
      showPositions: true,
      showCusplessAscMcLabels: true,
    },
  };
  for (const mode of ["leader-columns", "routed-cusps"]) {
    const chart = {
      ...baseChart,
      options: { ...baseChart.options, angloDenseLabelLayout: mode },
    };
    const layout = drawChart.arrangeBodies(
      {
        textsize: (text, opts = {}) => {
          const size = opts.size ?? 14;
          return [Math.max(size, String(text).length * size * 0.6), size];
        },
      },
      chart,
      [400, 400],
      wheelFrameForTest(chart),
      278,
      "AriesMorinus",
      "sans-serif",
      typography,
      DEFAULT_WHEEL_RENDER_STYLE,
      true,
      true,
      false,
      true,
      false,
    );

    assert.ok(
      longitudes[0] + (layout.get("p0") ?? 0) <= chart.angles.asc + 1e-9,
      `${mode} may not move the body across ASC before its true foot crosses`,
    );
  }
});

test("October 24 2026 Sun and Venus never cross the DSC in either Anglo mode", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const typography = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "anglo",
    400,
  );
  const baseChart = {
    planets: [
      ["sun", 211.2714781004094, "A", "1", "16"],
      ["moon", 11.621273331121776, "B", "11", "37"],
      ["mercury", 230.9694445572411, "C", "20", "58"],
      ["venus", 210.43020313614647, "D", "0", "25"],
      ["mars", 134.85178066264555, "E", "14", "51"],
      ["jupiter", 143.3733467557324, "F", "23", "22"],
      ["saturn", 9.774159249442754, "G", "9", "46"],
      ["uranus", 64.92921077534197, "H", "4", "55"],
      ["neptune", 2.246437335745679, "I", "2", "14"],
      ["pluto", 303.08587395421574, "9", "3", "05"],
      ["nnode", 326.4611312053518, "K", "26", "27"],
      ["snode", 146.46113120535182, "L", "26", "27"],
      ["chiron", 28.41333589330222, "}", "28", "24"],
    ].map(([id, longitude, glyph, degText, minText]) => ({
      id,
      longitude,
      glyph,
      degText,
      minText,
    })),
    fortune: { longitude: 237.18569759741334, glyph: "4", degText: "27", minText: "11" },
    vertex: { longitude: 194.894420321689, glyph: "!", degText: "14", minText: "53" },
    angles: {
      asc: 37.53549282812571,
      dsc: 217.5354928281257,
      mc: 287.5316777795745,
      ic: 107.53167777957452,
    },
    houses: {
      cusps: [
        37.53549282812571,
        73.91537704310657,
        92.73032346122095,
        107.53167777957452,
        125.64888831462508,
        159.716599533847,
        217.5354928281257,
        253.91537704310656,
        272.73032346122096,
        287.5316777795745,
        305.6488883146251,
        339.716599533847,
      ],
    },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: true,
      showPositions: true,
      showTerms: true,
      showDecans: false,
      showCusplessAscMcLabels: true,
    },
  };
  const measurer = {
    textsize: (text, opts) => {
      const size = opts?.size ?? 14;
      return [Math.max(size, String(text).length * size * 0.6), size];
    },
  };
  const arrange = (showHouses, mode) => {
    const chart = {
      ...baseChart,
      options: {
        ...baseChart.options,
        showHouses,
        angloDenseLabelLayout: mode,
      },
    };
    const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
      profile: "anglo",
      mode: "single",
      maxRadius: 400,
      hasOuterRing: false,
      showTerms: chart.options.showTerms,
      showDecans: chart.options.showDecans,
      showHouses,
      showPositions: chart.options.showPositions,
      comparisonWithOuterHouses: false,
    });
    return drawChart.arrangeBodies(
      measurer,
      chart,
      [400, 400],
      wheelFrameForTest(chart),
      rings.rPlanet,
      "AriesMorinus",
      "sans-serif",
      typography,
      DEFAULT_WHEEL_RENDER_STYLE,
      true,
      true,
      !showHouses,
      showHouses,
      false,
    );
  };

  const housesOff = arrange(false, "leader-columns");
  const housesOn = arrange(true, "leader-columns");
  const routedHousesOn = arrange(true, "routed-cusps");
  const dsc = baseChart.angles.dsc;
  const trueSide = (longitude) => Math.sign(((longitude - dsc + 540) % 360) - 180);
  const crossesRay = (longitude, shift, ray) => {
    const direction = Math.sign(shift);
    if (!direction) return false;
    const distance = Math.abs(shift);
    const towardRay = direction > 0
      ? ((ray - longitude + 360) % 360)
      : ((longitude - ray + 360) % 360);
    return towardRay > 1e-9 && towardRay < distance - 1e-9;
  };
  const displayedSide = (id, layout) => {
    const body = baseChart.planets.find((planet) => planet.id === id);
    return trueSide(body.longitude + (layout.get(id) ?? 0));
  };
  for (const [layout, rays] of [
    [housesOff, [baseChart.angles.asc, baseChart.angles.dsc, baseChart.angles.mc, baseChart.angles.ic]],
    [housesOn, [
      baseChart.angles.asc,
      baseChart.angles.dsc,
      baseChart.angles.mc,
      baseChart.angles.ic,
    ]],
    [routedHousesOn, [
      baseChart.angles.asc,
      baseChart.angles.dsc,
      baseChart.angles.mc,
      baseChart.angles.ic,
    ]],
  ]) {
    assert.equal(displayedSide("venus", layout), trueSide(210.43020313614647));
    assert.equal(displayedSide("sun", layout), trueSide(211.2714781004094));
    assert.ok(
      210.43020313614647 + layout.get("venus") <
        211.2714781004094 + layout.get("sun"),
    );
    for (const body of baseChart.planets) {
      for (const ray of rays) {
        assert.equal(crossesRay(body.longitude, layout.get(body.id) ?? 0, ray), false);
      }
    }
  }
  assert.ok(
    Math.abs(housesOn.get("venus") - housesOff.get("venus")) < 0.1,
    JSON.stringify({ housesOff: Object.fromEntries(housesOff), housesOn: Object.fromEntries(housesOn) }),
  );
  assert.ok(Math.abs(housesOn.get("sun") - housesOff.get("sun")) < 0.1);
  assert.deepEqual(
    routedHousesOn,
    housesOn,
    "choosing between straight and routed house lines may not move a body",
  );
});

test("July 21 2026 H round trips preserve each explicit Anglo layout mode", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const typography = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "anglo",
    400,
  );
  const planetValues = [
    ["sun", 118.9104, "A"],
    ["moon", 211.15696, "B"],
    ["mercury", 106.5587, "C"],
    ["venus", 163.10216, "D"],
    ["mars", 76.01808, "E"],
    ["jupiter", 124.67253, "F"],
    ["saturn", 14.72723, "G"],
    ["uranus", 64.63728, "H"],
    ["neptune", 4.3641, "I"],
    ["pluto", 304.41722, "9"],
    ["nnode", 331.49306939174824, "K"],
    ["snode", 151.49306939174824, "L"],
    ["chiron", 30.78918, "}"],
  ];
  const positionText = (longitude) => {
    const withinSign = ((longitude % 30) + 30) % 30;
    return {
      degText: String(Math.floor(withinSign)),
      minText: String(Math.floor((withinSign % 1) * 60)).padStart(2, "0"),
    };
  };
  const baseChart = {
    planets: planetValues.map(([id, longitude, glyph]) => ({
      id,
      longitude,
      glyph,
      ...positionText(longitude),
    })),
    fortune: {
      longitude: 344.896119,
      glyph: "4",
      ...positionText(344.896119),
    },
    vertex: {
      longitude: 116.410141,
      glyph: "!",
      ...positionText(116.410141),
    },
    angles: {
      asc: 252.649597,
      dsc: 72.649597,
      mc: 189.191248,
      ic: 9.191248,
      ascDegMin: { degText: "12", minText: "38" },
      mcDegMin: { degText: "9", minText: "11" },
    },
    houses: {
      cusps: [
        252.649597,
        283.368506,
        329.80666976762274,
        9.191248,
        33.468827,
        52.200662,
        72.649597,
        103.368505,
        149.80667,
        189.191248,
        213.468827,
        232.200662,
      ],
    },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: false,
      showPositions: true,
      showTerms: true,
      showDecans: false,
      showCusplessAscMcLabels: true,
    },
  };
  const measurer = {
    textsize: (text, opts) => {
      const size = opts?.size ?? 14;
      return [Math.max(size, String(text).length * size * 0.6), size];
    },
  };
  const arrange = (showHouses, mode) => {
    const chart = {
      ...baseChart,
      options: {
        ...baseChart.options,
        showHouses,
        angloDenseLabelLayout: mode,
      },
    };
    const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
      profile: "anglo",
      mode: "single",
      maxRadius: 400,
      hasOuterRing: false,
      showTerms: chart.options.showTerms,
      showDecans: chart.options.showDecans,
      showHouses,
      showPositions: chart.options.showPositions,
      comparisonWithOuterHouses: false,
    });
    return drawChart.arrangeBodies(
      measurer,
      chart,
      [400, 400],
      wheelFrameForTest(chart),
      rings.rPlanet,
      "AriesMorinus",
      "sans-serif",
      typography,
      DEFAULT_WHEEL_RENDER_STYLE,
      true,
      true,
      !showHouses,
      showHouses,
      false,
    );
  };

  const bodyIds = new Set(baseChart.planets.map((planet) => planet.id));
  const bodyEntries = (layout) => [...layout].filter(([id]) => bodyIds.has(id));
  const housesOnByMode = new Map();
  for (const mode of ["leader-columns", "routed-cusps"]) {
    const housesOff = arrange(false, mode);
    const housesOn = arrange(true, mode);
    const housesOnAgain = arrange(true, mode);
    const housesOffAgain = arrange(false, mode);
    assert.equal(housesOff.get("nnode"), 0, mode);
    assert.deepEqual(
      bodyEntries(housesOn),
      bodyEntries(housesOff),
      `${mode} body placement must ignore ordinary cusp visibility`,
    );
    assert.deepEqual(bodyEntries(housesOnAgain), bodyEntries(housesOn), `${mode} houses-on solve`);
    assert.deepEqual(bodyEntries(housesOffAgain), bodyEntries(housesOff), `${mode} H round trip`);
    housesOnByMode.set(mode, bodyEntries(housesOn));
  }
  assert.deepEqual(
    housesOnByMode.get("routed-cusps"),
    housesOnByMode.get("leader-columns"),
    "the view mode changes structural line paint, never body placement",
  );
});

test("A keeps transit aspects gated while M reveals only inner-wheel minor aspects", async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const primaryAspects = Array.from({ length: 12 }, (_, type) => ({
    p1: "sun",
    p2: "moon",
    type,
    orb: 0,
    maxOrb: 1,
    exact: true,
  }));
  const chart = {
    aspects: primaryAspects,
    clickAspectFlags: { exclusiveOnClick: true },
  };
  const minorOnlyState = {
    selectedBody: null,
    hideAll: true,
    minorOnly: true,
  };

  assert.deepEqual(
    drawChart.resolveAspectsForDraw(chart, minorOnlyState).map((aspect) => aspect.type),
    [1, 2, 4, 7, 8, 9, 11],
  );
  assert.deepEqual(
    drawChart.resolveInterChartAspectsForDraw(
      chart,
      primaryAspects.map((aspect) => ({
        outer: "mars",
        inner: "sun",
        type: aspect.type,
        orb: aspect.orb,
        maxOrb: aspect.maxOrb,
        exact: aspect.exact,
      })),
      undefined,
      minorOnlyState,
    ),
    [],
  );
  assert.equal(
    drawChart.resolveAspectsForDraw(chart, { ...minorOnlyState, minorOnly: false }),
    null,
  );
});

test("M preserves the active aspect view and toggles its own minor setting", async () => {
  const commandStart = homeClientSource.indexOf('if (command === "toggle-minor-aspects")');
  const commandEnd = homeClientSource.indexOf("const tableId =", commandStart);
  assert.notEqual(commandStart, -1);
  assert.notEqual(commandEnd, -1);
  const commandBlock = homeClientSource.slice(commandStart, commandEnd);
  const run = new Function(
    "command", "aspectViewState", "useWorkspaceStore", "activeDoc", "activeChartRef",
    "toggleMinorOnlyAspects", "supersedePendingStepSettle", "toggleMinorAspects",
    commandBlock,
  );
  for (const exclusive of [true, false]) {
    for (const selected of ["sun", "outer:moon", "cusp2", null]) {
      for (const hidden of [true, false]) {
        const state = { selectedAspectBody: hidden ? null : selected, hideAllAspects: hidden, minorOnlyAspects: false };
        const calls = [];
        const pressM = (showMinorAspects) => run(
          "toggle-minor-aspects", () => state, { getState: () => state }, { id: "doc-1" },
          { current: { primaryChart: { clickAspectFlags: { exclusiveOnClick: exclusive }, options: { showMinorAspects } } } },
          () => { state.minorOnlyAspects = !state.minorOnlyAspects; }, () => {},
          async (_signal, scope = false) => { calls.push(scope); return { minorAspects: true }; },
        );
        pressM(true);
        assert.equal(state.selectedAspectBody, hidden ? null : selected);
        assert.equal(state.hideAllAspects, hidden);
        if (hidden) {
          assert.equal(state.minorOnlyAspects, true);
          pressM(true);
          assert.equal(state.minorOnlyAspects, false);
          assert.deepEqual(calls, []);
          // Enabling unavailable minors keeps A's hide gate during the reply.
          state.toggleMinorOnlyAspects = () => { state.minorOnlyAspects = true; };
          pressM(false);
          await Promise.resolve();
          assert.equal(state.minorOnlyAspects, true);
          assert.equal(state.hideAllAspects, true);
          assert.deepEqual(calls, [false]);
        } else {
          assert.deepEqual(calls, [exclusive && selected !== null]);
        }
      }
    }
  }
});

function angloArrowShaftRadius(rings) {
  const style = DEFAULT_WHEEL_RENDER_STYLE;
  return resolveWheelArrowGeometry(style,
    rings.rInner - rings.r30 * style.strokes.arrows.angloBaseInsetScale,
    rings.rInner, style.strokes.arrows.angloHalfAngleDegrees,
    style.strokes.angloStructural).shaftRadius;
}

test("April 15 2026 dense Aries cluster satisfies both fixed-radius Anglo modes", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const width = 1_632;
  const height = 1_468;
  const chartSize = 1_468;
  const center = [width / 2, height / 2];
  const maxRadius = chartSize / 2;
  const planetValues = [
    ["sun", 25.71934780650184, "A", "25", "43"],
    ["moon", 1.501267377244512, "B", "1", "30"],
    ["mercury", 0.7823526146148406, "C", "0", "46"],
    ["venus", 49.665035695977096, "D", "19", "39"],
    ["mars", 4.5679520376981015, "E", "4", "34"],
    ["jupiter", 107.03607921505649, "F", "17", "02"],
    ["saturn", 7.353811636073798, "G", "7", "21"],
    ["uranus", 59.4551176960122, "H", "29", "27"],
    ["neptune", 2.7429945141727363, "I", "2", "44"],
    ["pluto", 305.40758935288886, "9", "5", "24"],
    ["nnode", 336.6269163427392, "K", "6", "37"],
    ["snode", 156.62691634273915, "L", "6", "37"],
    ["chiron", 26.582701540314147, "}", "26", "34"],
  ];
  const baseChart = {
    planets: planetValues.map(([id, longitude, glyph, degText, minText]) => ({
      id,
      longitude,
      glyph,
      degText,
      minText,
      motion: "",
    })),
    fortune: {
      longitude: 166.69457288729177,
      glyph: "4",
      degText: "16",
      minText: "41",
    },
    vertex: {
      longitude: 25.81648983855602,
      glyph: "!",
      degText: "25",
      minText: "48",
    },
    angles: {
      asc: 190.9126533165491,
      dsc: 10.912653316549097,
      mc: 103.68594373317703,
      ic: 283.68594373317706,
      ascDegMin: { degText: "10", minText: "54" },
      mcDegMin: { degText: "13", minText: "41" },
    },
    houses: {
      cusps: [
        190.9126533165491,
        214.28711886393305,
        244.45059530600906,
        283.68594373317706,
        320.80215644358935,
        348.38207408042945,
        10.912653316549097,
        34.287118863933074,
        64.45059530600906,
        103.68594373317703,
        140.80215644358935,
        168.38207408042942,
      ],
    },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: true,
      showPositions: true,
      showAspects: false,
      showSymbols: false,
      showTerms: true,
      showDecans: false,
      showCusplessAscMcLabels: true,
    },
  };
  const componentCount = 4;
  const clusterIds = new Set(["mercury", "moon", "neptune", "mars", "saturn"]);
  const normalize = (value) => ((value % 360) + 360) % 360;
  const signedDelta = (left, right) => ((left - right + 540) % 360) - 180;
  const longitudeAtPoint = (x, y, asc) => {
    const screenAngle = Math.atan2(center[1] - y, x - center[0]) * 180 / Math.PI;
    return normalize(asc + screenAngle - 180);
  };
  const polarPoint = (radius, longitude, asc) => {
    const rad = ((longitude - asc + 180) * Math.PI) / 180;
    return [center[0] + Math.cos(rad) * radius, center[1] - Math.sin(rad) * radius];
  };
  const samePoint = (left, right, tolerance = 1.5) =>
    Math.hypot(left[0] - right[0], left[1] - right[1]) <= tolerance;
  const hasSegment = (segments, from, to) => segments.some((segment) =>
    (samePoint(segment.from, from) && samePoint(segment.to, to)) ||
    (samePoint(segment.from, to) && samePoint(segment.to, from))
  );
  const sectorIndex = (longitude, rays) => {
    const foot = normalize(longitude);
    const orderedRays = [...new Set(rays.map(normalize))].sort((left, right) => left - right);
    let result = orderedRays.length - 1;
    for (let index = 0; index < orderedRays.length; index += 1) {
      if (orderedRays[index] < foot - 1e-9) result = index;
      else break;
    }
    return result;
  };
  const render = (mode) => {
    const recordedText = [];
    const recordedLines = [];
    const draw = new drawChart.CanvasDraw(recordingCanvas(recordedText, recordedLines));
    draw.resize(width, height, 1);
    const chart = {
      ...baseChart,
      options: { ...baseChart.options, angloDenseLabelLayout: mode },
    };
    const snapshot = {
      primaryChart: chart,
      displayDatetime: "2026-04-15T18:37:42+01:00",
      renderVariant: "round-anglo",
      overlayRenderMode: "full",
      outerRingMode: "none",
    };
    const renderOptions = {
      width,
      height,
      chartSize,
      renderStyle: DEFAULT_WHEEL_RENDER_STYLE,
    };
    drawChart.drawSnapshotLayer(draw, snapshot, "dynamic", renderOptions);
    const dynamicLines = recordedLines.slice();
    const bodyBoxes = chart.planets
      .map((planet, index) => ({
        id: planet.id,
        boxes: recordedText.slice(index * componentCount, (index + 1) * componentCount),
      }));
    const clusterBoxes = bodyBoxes.filter((entry) => clusterIds.has(entry.id));
    const regions = drawChart.computeHitRegions(snapshot, {
      ...renderOptions,
      textsize: (text, opts) => {
        const size = opts?.size ?? 14;
        return [size * Math.max(1, String(text).length * 0.6), size];
      },
    });
    recordedLines.length = 0;
    drawChart.drawSnapshotLayer(draw, snapshot, "geometry", renderOptions);
    return {
      chart,
      snapshot,
      bodyBoxes,
      clusterBoxes,
      regions,
      dynamicLines,
      geometryLines: recordedLines.slice(),
      rings: resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
        profile: "anglo",
        mode: "single",
        maxRadius,
        hasOuterRing: false,
        showTerms: chart.options.showTerms,
        showDecans: chart.options.showDecans,
        showHouses: chart.options.showHouses,
        showPositions: chart.options.showPositions,
        comparisonWithOuterHouses: false,
      }),
      typography: resolveWheelTypographyMetrics(
        DEFAULT_WHEEL_RENDER_STYLE,
        "anglo",
        maxRadius,
      ),
    };
  };

  const results = new Map(
    ["leader-columns", "routed-cusps"].map((mode) => [mode, render(mode)]),
  );
  for (const mode of ["leader-columns", "routed-cusps"]) {
    const result = results.get(mode);
    const { chart, clusterBoxes, regions } = result;
    for (const entry of clusterBoxes) {
      assert.deepEqual(
        entry.boxes.map((box) => box.fontSize),
        [46, 21, 26, 17],
        `${mode}:${entry.id} must retain the authored glyph/degree/sign/minute sizes`,
      );
      const componentLongitudes = entry.boxes.map((box) =>
        longitudeAtPoint(box.x + box.w / 2, box.y + box.h / 2, chart.angles.asc)
      );
      assert.ok(
        componentLongitudes.every((longitude) =>
          Math.abs(signedDelta(longitude, componentLongitudes[0])) <= 0.75
        ),
        `${mode}:${entry.id} components must share one angular column`,
      );
    }

    const overlaps = [];
    for (let leftIndex = 0; leftIndex < clusterBoxes.length - 1; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < clusterBoxes.length; rightIndex += 1) {
        for (const left of clusterBoxes[leftIndex].boxes) {
          for (const right of clusterBoxes[rightIndex].boxes) {
            if (
              left.x < right.x + right.w &&
              left.x + left.w > right.x &&
              left.y < right.y + right.h &&
              left.y + left.h > right.y
            ) {
              overlaps.push(`${clusterBoxes[leftIndex].id}:${clusterBoxes[rightIndex].id}`);
            }
          }
        }
      }
    }
    const clusterRegions = regions.filter(
      (region) => region.kind === "planet" && clusterIds.has(region.planetId),
    );
    const clusterRadii = new Set(
      clusterRegions.map((region) =>
        Math.round(Math.hypot(region.x - center[0], region.y - center[1]))
      ),
    );
    assert.equal(clusterRadii.size, 1, `${mode} may use exactly one glyph radius`);
    const displayedById = new Map(clusterRegions.map((region) => [
      region.planetId,
      longitudeAtPoint(region.x, region.y, chart.angles.asc),
    ]));
    const angleRays = [chart.angles.asc, chart.angles.dsc, chart.angles.mc, chart.angles.ic];
    for (const planet of chart.planets.filter((entry) => clusterIds.has(entry.id))) {
      assert.equal(
        sectorIndex(displayedById.get(planet.id), angleRays),
        sectorIndex(planet.longitude, angleRays),
        `${mode}:${planet.id} may not cross an angle`,
      );
    }

    const crossedCusps = chart.planets
      .filter((entry) => clusterIds.has(entry.id))
      .filter((planet) =>
        sectorIndex(displayedById.get(planet.id), chart.houses.cusps) !==
        sectorIndex(planet.longitude, chart.houses.cusps)
      );
    assert.ok(crossedCusps.length > 0, "fixture must exercise soft ordinary-cusp crossing");
    const shiftedBodies = chart.planets
      .filter((entry) => clusterIds.has(entry.id))
      .filter((planet) => Math.abs(signedDelta(displayedById.get(planet.id), planet.longitude)) > 0.05);
    assert.ok(shiftedBodies.length > 0);
    for (const planet of shiftedBodies) {
      const displayed = displayedById.get(planet.id);
      const outerFoot = polarPoint(result.rings.rInner, planet.longitude, chart.angles.asc);
      const outerTip = polarPoint(result.rings.rLLine, planet.longitude, chart.angles.asc);
      const innerFoot = polarPoint(result.rings.rAsp, planet.longitude, chart.angles.asc);
      const innerTip = polarPoint(result.rings.rLLine2, planet.longitude, chart.angles.asc);
      const rejectedElbow = polarPoint(result.rings.rLLine, displayed, chart.angles.asc);
      const rejectedLabelEdge = polarPoint(
        result.rings.rPlanet + result.typography.bodySize * 0.55,
        displayed,
        chart.angles.asc,
      );
      const leaders = clusterRegions.find(region => region.planetId === planet.id).leaderSegments;
      assert.equal(leaders.length, 2, `${mode}:${planet.id} retains both feet`);
      for (const [index, [foot, tip]] of [[outerFoot, outerTip], [innerFoot, innerTip]].entries()) {
        const segment = leaders[index];
        assert.ok(samePoint(segment.start, foot), `${mode}:${planet.id} true-longitude foot`);
        assert.ok(hasSegment(result.dynamicLines, segment.start, segment.end),
          `${mode}:${planet.id} hit and painted leaders agree`);
        assert.ok(Math.hypot(segment.end[0] - foot[0], segment.end[1] - foot[1])
          <= Math.hypot(tip[0] - foot[0], tip[1] - foot[1]) + 1e-6,
        `${mode}:${planet.id} may shorten a foot, never extend it`);
        assert.ok(Math.abs((segment.end[0] - foot[0]) * (tip[1] - foot[1])
          - (segment.end[1] - foot[1]) * (tip[0] - foot[0])) < 1e-6,
        `${mode}:${planet.id} retains its true-longitude ray`);
      }
      assert.equal(
        hasSegment(result.dynamicLines, outerTip, rejectedElbow),
        false,
        `${mode}:${planet.id} may not draw a tangent elbow`,
      );
      assert.equal(
        hasSegment(result.dynamicLines, rejectedElbow, rejectedLabelEdge),
        false,
        `${mode}:${planet.id} may not connect the foot to the displaced glyph`,
      );
    }

    assert.deepEqual(overlaps, [], mode);
  }

  const leaderResult = results.get("leader-columns");
  const routedResult = results.get("routed-cusps");
  assert.deepEqual(
    routedResult.clusterBoxes,
    leaderResult.clusterBoxes,
    "the view mode changes structural line paint, never the body layout",
  );
  const structuralRays = [
    ...leaderResult.chart.houses.cusps.filter((cusp) =>
      [
        leaderResult.chart.angles.asc,
        leaderResult.chart.angles.dsc,
        leaderResult.chart.angles.mc,
        leaderResult.chart.angles.ic,
      ].every((angle) => Math.abs(signedDelta(cusp, angle)) > 1e-9)
    ),
    leaderResult.chart.angles.asc,
    leaderResult.chart.angles.dsc,
    leaderResult.chart.angles.mc,
    leaderResult.chart.angles.ic,
  ];
  const structuralStart = Math.min(leaderResult.rings.rBase, leaderResult.rings.rInner);
  const structuralEnd = Math.max(leaderResult.rings.rBase, leaderResult.rings.rInner);
  for (const longitude of structuralRays) {
    assert.ok(
      hasSegment(
        leaderResult.geometryLines,
        polarPoint(structuralStart, longitude, leaderResult.chart.angles.asc),
        polarPoint([leaderResult.chart.angles.asc, leaderResult.chart.angles.mc].includes(longitude)
          ? angloArrowShaftRadius(leaderResult.rings) : structuralEnd,
          longitude, leaderResult.chart.angles.asc),
      ),
      `leader mode keeps structural ray ${longitude} straight`,
    );
  }
});

test("occupied Anglo angle rays stay straight in every dense-layout mode", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const center = [400, 400];
  const maxRadius = 400;
  const asc = 0;
  const chartSize = 800;
  const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
    profile: "anglo",
    mode: "single",
    maxRadius,
    hasOuterRing: false,
    showTerms: false,
    showDecans: false,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  });
  const polarPoint = (radius, longitude) => {
    const rad = ((longitude - asc + 180) * Math.PI) / 180;
    return [center[0] + Math.cos(rad) * radius, center[1] - Math.sin(rad) * radius];
  };
  const samePoint = (left, right, tolerance = 1.5) =>
    Math.hypot(left[0] - right[0], left[1] - right[1]) <= tolerance;
  const hasSegment = (segments, from, to) => segments.some((segment) =>
    (samePoint(segment.from, from) && samePoint(segment.to, to)) ||
    (samePoint(segment.from, to) && samePoint(segment.to, from))
  );
  const render = (mode) => {
    const recordedLines = [];
    const draw = new drawChart.CanvasDraw(recordingCanvas([], recordedLines));
    draw.resize(chartSize, chartSize, 1);
    drawChart.drawAscMC(
      draw,
      center,
      rings,
      identityFrameForTest(asc),
      {
        planets: [{ id: "sun", longitude: asc, glyph: "A" }],
        angles: { asc, dsc: 180, mc: 90, ic: 270 },
        houses: { cusps: Array.from({ length: 12 }, (_, index) => 15 + index * 30) },
        aspects: [],
        options: {
          theme: 2,
          showHouses: true,
          showPositions: true,
          angloDenseLabelLayout: mode,
        },
      },
      chartSize,
      {},
      DEFAULT_WHEEL_RENDER_STYLE,
    );
    return recordedLines;
  };

  for (const mode of ["leader-columns", "routed-cusps"]) {
    const lines = render(mode);
    for (const longitude of [asc, 180, 90, 270]) {
      assert.ok(
        hasSegment(
          lines,
          polarPoint(Math.min(rings.rBase, rings.rInner), longitude),
          polarPoint(longitude === asc || longitude === 90
            ? angloArrowShaftRadius(rings) : Math.max(rings.rBase, rings.rInner), longitude),
        ),
        `${mode} keeps the hard ${longitude}° angle ray straight`,
      );
    }
  }
});

function fixturePolarPoint(center, radius, longitude, asc) {
  const angle = (180 + longitude - asc) * Math.PI / 180;
  return [
    center[0] + Math.cos(angle) * radius,
    center[1] - Math.sin(angle) * radius,
  ];
}

function renderScreenshotCuspFixture(
  drawChart,
  columns,
  {
    center = [400, 400],
    asc = 0,
    longitude = 0,
    innerRadius = 100,
    outerRadius = 300,
    previousCusp,
    nextCusp,
    structuralLongitudes,
    lineWidth = 1,
    structuralLineWidth,
    breakAcrossColumns,
    breakGapPx,
  } = {},
) {
  const resolvedPreviousCusp = previousCusp ?? longitude - 30;
  const resolvedNextCusp = nextCusp ?? longitude + 30;
  const recordedLines = [];
  const draw = new drawChart.CanvasDraw(recordingCanvas([], recordedLines));
  draw.resize(800, 800, 1);
  drawChart.drawRoutedRadialLine(
    draw,
    center,
    identityFrameForTest(asc),
    longitude,
    innerRadius,
    outerRadius,
    { fill: "#fff", width: lineWidth },
    {
      columns,
      previousCusp: resolvedPreviousCusp,
      nextCusp: resolvedNextCusp,
      structuralLongitudes: structuralLongitudes ?? [
        resolvedPreviousCusp,
        longitude,
        resolvedNextCusp,
      ],
      structuralLineWidth,
      breakAcrossColumns,
      breakGapPx,
    },
  );
  const exactRay = {
    from: fixturePolarPoint(center, innerRadius, longitude, asc),
    to: fixturePolarPoint(center, outerRadius, longitude, asc),
  };
  return {
    recordedLines,
    exactRay,
    straightRay: {
      from: exactRay.from.map(Math.round),
      to: exactRay.to.map(Math.round),
    },
  };
}

function fixtureSegmentIntersectsBox(segment, box, inset = 0) {
  const minimums = [box.x + inset, box.y + inset];
  const maximums = [box.x + box.w - inset, box.y + box.h - inset];
  let entry = 0;
  let exit = 1;
  for (let axis = 0; axis < 2; axis += 1) {
    const origin = segment.from[axis];
    const direction = segment.to[axis] - origin;
    if (Math.abs(direction) < 1e-9) {
      if (origin < minimums[axis] || origin > maximums[axis]) return false;
      continue;
    }
    const first = (minimums[axis] - origin) / direction;
    const second = (maximums[axis] - origin) / direction;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry > exit) return false;
  }
  return true;
}

function fixtureSegmentsMatch(left, right) {
  const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
  return (
    samePoint(left.from, right.from) && samePoint(left.to, right.to)
  ) || (
    samePoint(left.from, right.to) && samePoint(left.to, right.from)
  );
}

function fixtureSegmentDistance(left, right) {
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const leftVector = [left.to[0] - left.from[0], left.to[1] - left.from[1]];
  const rightVector = [right.to[0] - right.from[0], right.to[1] - right.from[1]];
  const starts = [right.from[0] - left.from[0], right.from[1] - left.from[1]];
  const denominator = cross(leftVector, rightVector);
  if (Math.abs(denominator) > 1e-9) {
    const leftProgress = cross(starts, rightVector) / denominator;
    const rightProgress = cross(starts, leftVector) / denominator;
    if (
      leftProgress >= 0 && leftProgress <= 1 &&
      rightProgress >= 0 && rightProgress <= 1
    ) return 0;
  }
  const pointDistance = (point, segment) => {
    const dx = segment.to[0] - segment.from[0];
    const dy = segment.to[1] - segment.from[1];
    const lengthSquared = dx * dx + dy * dy;
    const progress = lengthSquared > 0
      ? Math.max(0, Math.min(1, (
        (point[0] - segment.from[0]) * dx +
        (point[1] - segment.from[1]) * dy
      ) / lengthSquared))
      : 0;
    return Math.hypot(
      point[0] - (segment.from[0] + dx * progress),
      point[1] - (segment.from[1] + dy * progress),
    );
  };
  return Math.min(
    pointDistance(left.from, right),
    pointDistance(left.to, right),
    pointDistance(right.from, left),
    pointDistance(right.to, left),
  );
}

function projectedFixtureBoxWouldBlock(center, asc, longitude, innerRadius, outerRadius, box) {
  const radialPoint = fixturePolarPoint(center, 1, longitude, asc);
  const tangentPoint = fixturePolarPoint(center, 1, longitude + 90, asc);
  const radial = [radialPoint[0] - center[0], radialPoint[1] - center[1]];
  const tangent = [tangentPoint[0] - center[0], tangentPoint[1] - center[1]];
  const projected = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ].map(([x, y]) => {
    const dx = x - center[0];
    const dy = y - center[1];
    return {
      s: dx * radial[0] + dy * radial[1],
      t: dx * tangent[0] + dy * tangent[1],
    };
  });
  const sMin = Math.min(...projected.map(({ s }) => s));
  const sMax = Math.max(...projected.map(({ s }) => s));
  const tMin = Math.min(...projected.map(({ t }) => t));
  const tMax = Math.max(...projected.map(({ t }) => t));
  return sMax > innerRadius && sMin < outerRadius && tMin <= 0 && tMax >= 0;
}

function fixtureRootedPath(segments, start, center, outerRadius, tolerance = 1.5) {
  const samePoint = (left, right) =>
    Math.hypot(left[0] - right[0], left[1] - right[1]) <= tolerance;
  const queue = [{ point: start, path: [], used: new Set() }];
  while (queue.length) {
    const current = queue.shift();
    if (
      current.path.length > 0 &&
      Math.abs(Math.hypot(
        current.point[0] - center[0],
        current.point[1] - center[1],
      ) - outerRadius) <= tolerance
    ) {
      return current.path;
    }
    if (current.path.length >= 8) continue;
    for (let index = 0; index < segments.length; index += 1) {
      if (current.used.has(index)) continue;
      const segment = segments[index];
      const next = samePoint(current.point, segment.from)
        ? segment.to
        : samePoint(current.point, segment.to)
          ? segment.from
          : null;
      if (!next) continue;
      const used = new Set(current.used);
      used.add(index);
      queue.push({ point: next, path: [...current.path, segment], used });
    }
  }
  return null;
}

test("February 22 1990 screenshot geometry routes the occupied Capricorn-Moon cluster as one dogleg", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  // Renderer-only reconstruction of the reported screenshot's component
  // bounds. The date names the regression; no astrology is reconstructed.
  const componentBounds = new Map([
    ["moon", [
      { x: 230, y: 398, w: 24, h: 32 },
      { x: 228, y: 390, w: 28, h: 8 },
    ]],
    ["mars", [{ x: 215, y: 382, w: 41, h: 8 }]],
    ["saturn", [{ x: 205, y: 382, w: 10, h: 8 }]],
  ]);
  const columns = [...componentBounds.entries()].map(([key, components], index) => ({
    key,
    footLongitude: index + 1,
    displayedLongitude: index + 1,
    components,
  }));
  const allBoxes = [...componentBounds.values()].flat();
  const { recordedLines, straightRay } = renderScreenshotCuspFixture(
    drawChart,
    columns,
  );

  assert.deepEqual(
    allBoxes.filter((box) => fixtureSegmentIntersectsBox(straightRay, box)),
    [componentBounds.get("moon")[0]],
    "only the first Moon component triggers routing",
  );
  assert.equal(
    recordedLines.some((segment) => fixtureSegmentsMatch(segment, straightRay)),
    false,
    "an occupied cusp may not remain one straight segment",
  );
  assert.equal(recordedLines.length, 3, "one rooted turn and one offset shaft avoid the cluster");
  assert.deepEqual(
    [recordedLines[0].from, ...recordedLines.map((segment) => segment.to)],
    [
      [300, 400],
      [259, 400],
      [259, 380],
      [101, 380],
    ],
    "the rooted cusp leaves the exact inner foot once, clears both ink and stroke, and never returns into a bracket",
  );
  assert.ok(
    Math.abs(Math.hypot(
      recordedLines.at(-1).to[0] - 400,
      recordedLines.at(-1).to[1] - 400,
    ) - 300) <= 1,
    "the offset shaft must finish on the outer circle",
  );
  assert.ok(
    recordedLines.every((segment) =>
      allBoxes.every((box) => !fixtureSegmentIntersectsBox(segment, box))
    ),
    "the connected dogleg may not cross any cluster component",
  );
});

test("opposite-house feet use a broken true cusp instead of one cross-house dogleg", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const columns = [
    {
      key: "previous",
      footLongitude: 359,
      displayedLongitude: 359,
      components: [{ x: 250, y: 390, w: 30, h: 20 }],
    },
    {
      key: "next",
      footLongitude: 1,
      displayedLongitude: 1,
      components: [{ x: 230, y: 390, w: 20, h: 20 }],
    },
  ];
  const { recordedLines, straightRay } = renderScreenshotCuspFixture(drawChart, columns);

  assert.equal(recordedLines.length, 2, "mixed house ownership must use the segmented fallback");
  assert.ok(
    recordedLines.every((segment) =>
      Math.abs(segment.from[1] - straightRay.from[1]) < 1e-6 &&
      Math.abs(segment.to[1] - straightRay.to[1]) < 1e-6
    ),
    "the fallback stays on the immutable true cusp ray",
  );
  assert.deepEqual(recordedLines[0].from, straightRay.from, "the inner root remains exact");
  assert.deepEqual(recordedLines.at(-1).to, straightRay.to, "the unobstructed outer tail remains exact");
});

test("a body from a non-adjacent house cannot assign an invented side to a cusp", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const columns = [{
    key: "distant-house-body",
    footLongitude: 90,
    displayedLongitude: 0,
    components: [{ x: 240, y: 390, w: 30, h: 20 }],
  }];
  const { recordedLines, straightRay } = renderScreenshotCuspFixture(drawChart, columns);

  assert.equal(recordedLines.length, 2, "non-adjacent ownership must use the segmented fallback");
  assert.ok(
    recordedLines.every((segment) =>
      segment.from[1] === straightRay.from[1] &&
      segment.to[1] === straightRay.to[1]
    ),
    "the renderer keeps the truthful cusp instead of guessing a house side",
  );
});

test("August 19 2026 Mercury routing ignores a distant historical cluster member", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const mercury = {
    key: "mercury",
    footLongitude: 1,
    displayedLongitude: 1,
    components: [{ x: 238, y: 394, w: 22, h: 20 }],
  };
  const distantJupiter = {
    key: "jupiter",
    footLongitude: 8,
    displayedLongitude: 24,
    components: [{ x: 150, y: 330, w: 30, h: 30 }],
  };
  const local = renderScreenshotCuspFixture(drawChart, [mercury]).recordedLines;
  const withHistoricalMember = renderScreenshotCuspFixture(
    drawChart,
    [mercury, distantJupiter],
  ).recordedLines;

  assert.equal(local.length, 3, "Mercury alone must exercise the rooted route");
  assert.deepEqual(
    withHistoricalMember,
    local,
    "a non-touching old collision member may not enlarge the current Mercury route",
  );
});

test("a subpixel cusp does not route around paint that its actual stroke misses", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const lineWidth = 0.5;
  const box = { x: 220, y: 400.6, w: 20, h: 10 };
  const column = {
    key: "mercury",
    footLongitude: 1,
    displayedLongitude: 1,
    components: [box],
  };
  const { exactRay, recordedLines, straightRay } = renderScreenshotCuspFixture(
    drawChart,
    [column],
    { lineWidth },
  );

  assert.equal(fixtureSegmentIntersectsBox(exactRay, box), false, "the snapped centerline misses");
  assert.ok(box.y - straightRay.from[1] < 1, "the miss is deliberately below one pixel");
  assert.ok(
    box.y - straightRay.from[1] > lineWidth / 2,
    "the authored stroke edge also clears the painted component",
  );
  assert.equal(recordedLines.length, 1, "no fixed one-pixel inflation may trigger routing");
  assert.deepEqual(
    { from: recordedLines[0].from, to: recordedLines[0].to },
    straightRay,
    "the genuinely clear subpixel cusp remains exact and straight",
  );
});

test("thick cusp paint cannot overlap a nearby hard ray whose centerline stays clear", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const center = [400, 400];
  const innerRadius = 100;
  const outerRadius = 300;
  const hardLongitude = 1;
  const column = {
    key: "mercury",
    footLongitude: 5,
    displayedLongitude: 5,
    components: [{ x: 238, y: 394, w: 22, h: 20 }],
  };
  const thin = renderScreenshotCuspFixture(drawChart, [column], {
    center,
    innerRadius,
    outerRadius,
    structuralLongitudes: [hardLongitude],
    lineWidth: 0.5,
    structuralLineWidth: 0.5,
  });
  const thick = renderScreenshotCuspFixture(drawChart, [column], {
    center,
    innerRadius,
    outerRadius,
    structuralLongitudes: [hardLongitude],
    lineWidth: 6,
    structuralLineWidth: 6,
  });
  const hardRay = {
    from: fixturePolarPoint(center, innerRadius, hardLongitude, 0).map(Math.round),
    to: fixturePolarPoint(center, outerRadius, hardLongitude, 0).map(Math.round),
  };
  const centerlineGap = Math.min(
    ...thin.recordedLines.map((segment) => fixtureSegmentDistance(segment, hardRay)),
  );

  assert.equal(thin.recordedLines.length, 3, "thin non-overlapping strokes may use the rooted route");
  assert.ok(centerlineGap > 0, "the candidate and hard-ray centerlines do not cross");
  assert.ok(centerlineGap < 6, "the two thick half-widths would nevertheless overlap");
  assert.equal(thick.recordedLines.length, 2, "stroke overlap must choose the segmented fallback");
  assert.ok(
    thick.recordedLines.every((segment) =>
      Math.abs(segment.from[1] - thick.straightRay.from[1]) < 1e-6 &&
      Math.abs(segment.to[1] - thick.straightRay.to[1]) < 1e-6
    ),
    "the fallback keeps only collinear true-cusp fragments",
  );
});

test("production-layout screenshot pattern routes measured Moon-Mars-Saturn bounds as one cluster", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const width = 800;
  const height = 800;
  const chartSize = 800;
  const center = [width / 2, height / 2];
  const maxRadius = chartSize / 2;
  // Renderer-only density pattern. The values constrain three label columns
  // like the screenshot; they are not an astrology reconstruction.
  const chart = {
    planets: [
      ["moon", 40, "B"],
      ["mars", 40.5, "E"],
      ["saturn", 41, "G"],
    ].map(([id, longitude, glyph]) => ({
      id,
      longitude,
      glyph,
      degText: String(Math.floor(longitude % 30)),
      minText: String(Math.round((longitude % 1) * 60)).padStart(2, "0"),
      motion: "",
    })),
    angles: {
      asc: 0,
      dsc: 180,
      mc: 90,
      ic: 270,
      ascDegMin: { degText: "0", minText: "00" },
      mcDegMin: { degText: "0", minText: "00" },
    },
    houses: {
      cusps: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
    },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: true,
      showPositions: true,
      showAspects: false,
      showSymbols: false,
      showTerms: false,
      showDecans: false,
      showCusplessAscMcLabels: true,
      angloDenseLabelLayout: "routed-cusps",
    },
  };
  const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
    profile: "anglo",
    mode: "single",
    maxRadius,
    hasOuterRing: false,
    showTerms: false,
    showDecans: false,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  });
  const typography = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "anglo",
    maxRadius,
  );
  const snapshot = {
    primaryChart: chart,
    displayDatetime: "production-layout-screenshot-pattern",
    renderVariant: "round-anglo",
    overlayRenderMode: "full",
    outerRingMode: "none",
  };
  const measureDraw = new drawChart.CanvasDraw(recordingCanvas([]));
  measureDraw.resize(width, height, 1);
  const layout = drawChart.getBodyLayout(
    measureDraw,
    chart,
    center,
    wheelFrameForTest(chart),
    rings.rPlanet,
    rings.rPos,
    rings.rRetr,
    DEFAULT_WHEEL_RENDER_STYLE.typography.families.bodySymbols,
    DEFAULT_WHEEL_RENDER_STYLE.typography.families.ui,
    typography,
    DEFAULT_WHEEL_RENDER_STYLE,
  );
  const ownerKeys = ["moon", "mars", "saturn"];
  const ownerBounds = new Map(
    ownerKeys.map((key) => [key, layout.componentBounds.get(key)]),
  );
  assert.ok(
    [...ownerBounds.values()].every((bounds) => bounds?.length === 4),
    "production layout must measure glyph, degree, sign, and minute bounds",
  );
  // Default routing keeps 2px of visible air plus half the 1px cusp stroke.
  // Two such clearance halos form one current painted obstruction at 5px.
  const boundsTouch = (left, right, clearance = 5) =>
    left.x <= right.x + right.w + clearance &&
    left.x + left.w + clearance >= right.x &&
    left.y <= right.y + right.h + clearance &&
    left.y + left.h + clearance >= right.y;
  const physicallyConnected = new Set([ownerKeys[0]]);
  for (let pass = 0; pass < ownerKeys.length; pass += 1) {
    for (const candidate of ownerKeys) {
      if (physicallyConnected.has(candidate)) continue;
      if ([...physicallyConnected].some((member) =>
        ownerBounds.get(member).some((left) =>
          ownerBounds.get(candidate).some((right) => boundsTouch(left, right))
        )
      )) {
        physicallyConnected.add(candidate);
      }
    }
  }
  assert.ok(
    ownerKeys.every((key) => physicallyConnected.has(key)),
    "the measured columns must form one current-frame physical component",
  );

  const moonGlyph = ownerBounds.get("moon")[0];
  const moonCenter = [moonGlyph.x + moonGlyph.w / 2, moonGlyph.y + moonGlyph.h / 2];
  const cusp = (
    chart.angles.asc +
    Math.atan2(center[1] - moonCenter[1], moonCenter[0] - center[0]) * 180 / Math.PI -
    180 +
    360
  ) % 360;
  assert.ok(
    [chart.angles.asc, chart.angles.dsc, chart.angles.mc, chart.angles.ic]
      .every((angle) => Math.abs(((cusp - angle + 540) % 360) - 180) > 1e-6),
    "the measured Moon ray must be an ordinary cusp, not an angle",
  );
  chart.houses.cusps[1] = cusp;
  const routeStart = fixturePolarPoint(
    center,
    Math.min(rings.rBase, rings.rInner),
    cusp,
    chart.angles.asc,
  );
  const routeEnd = fixturePolarPoint(
    center,
    Math.max(rings.rBase, rings.rInner),
    cusp,
    chart.angles.asc,
  );
  const straightRay = { from: routeStart, to: routeEnd };
  assert.ok(
    ownerBounds.get("moon").some((box) => fixtureSegmentIntersectsBox(straightRay, box)),
    "the ordinary cusp must pass through a measured Moon component",
  );

  const directLines = [];
  const directDraw = new drawChart.CanvasDraw(recordingCanvas([], directLines));
  directDraw.resize(width, height, 1);
  const columns = ownerKeys.map((key) => {
    const planet = chart.planets.find((entry) => entry.id === key);
    return {
      key,
      footLongitude: planet.longitude,
      displayedLongitude: planet.longitude + (layout.bodyShifts.get(key) ?? 0),
      components: ownerBounds.get(key),
    };
  });
  drawChart.drawRoutedRadialLine(
    directDraw,
    center,
    wheelFrameForTest(chart),
    cusp,
    rings.rBase,
    rings.rInner,
    { fill: "#fff", width: 1 },
    {
      columns,
      previousCusp: chart.houses.cusps[0],
      nextCusp: chart.houses.cusps[2],
      structuralLongitudes: [
        ...chart.houses.cusps,
        wheelFrameForTest(chart),
        chart.angles.dsc,
        chart.angles.mc,
        chart.angles.ic,
      ],
    },
  );
  const snappedStart = routeStart.map(Math.round);
  const snappedEnd = routeEnd.map(Math.round);
  const outerRadius = Math.max(rings.rBase, rings.rInner);
  const directPath = fixtureRootedPath(
    directLines,
    snappedStart,
    center,
    outerRadius,
  );
  assert.ok(directPath, `direct measured route: ${JSON.stringify(directLines)}`);
  assert.equal(directPath.length, 3, `direct measured route: ${JSON.stringify(directLines)}`);
  assert.equal(
    directPath.some((segment) => fixtureSegmentsMatch(segment, {
      from: snappedStart,
      to: snappedEnd,
    })),
    false,
    "an occupied rooted cusp may not stay straight",
  );
  assert.ok(
    Math.hypot(
      directPath.at(-1).to[0] - snappedEnd[0],
      directPath.at(-1).to[1] - snappedEnd[1],
    ) > 1.5,
    "the rooted route must not return to the original outer endpoint",
  );

  const recordedLines = [];
  const geometryDraw = new drawChart.CanvasDraw(recordingCanvas([], recordedLines));
  geometryDraw.resize(width, height, 1);
  drawChart.drawSnapshotLayer(
    geometryDraw,
    snapshot,
    "geometry",
    { width, height, chartSize, renderStyle: DEFAULT_WHEEL_RENDER_STYLE },
  );
  const routedPath = fixtureRootedPath(recordedLines, snappedStart, center, outerRadius);
  const clusterBoxes = ownerKeys.flatMap((key) => ownerBounds.get(key));
  assert.ok(routedPath, "the measured ordinary cusp must remain rooted at its inner endpoint");
  assert.equal(routedPath.length, 3, "the measured cluster needs one rooted three-segment route");
  assert.ok(
    routedPath.every((segment) =>
      clusterBoxes.every((box) => !fixtureSegmentIntersectsBox(segment, box))
    ),
    "the production geometry dogleg may not cross any measured cluster component",
  );
});

test("July 11 2026 screenshot geometry keeps the clear Mercury-Sun cusp exactly straight", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  // Renderer-only reconstruction of the reported screenshot's component
  // bounds. An oblique projected envelope covers the ray, but every painted member clears it.
  const projectedFalsePositive = { x: 306, y: 446, w: 16, h: 10 };
  const componentBounds = new Map([
    ["mercury", [
      projectedFalsePositive,
      { x: 273, y: 448, w: 12, h: 12 },
    ]],
    ["sun", [
      { x: 288, y: 505, w: 12, h: 12 },
      { x: 264, y: 522, w: 12, h: 12 },
    ]],
  ]);
  const allBoxes = [...componentBounds.values()].flat();
  const center = [400, 400];
  const asc = 0;
  const longitude = 35;
  const innerRadius = 100;
  const outerRadius = 300;
  const columns = [
    {
      key: "mercury",
      footLongitude: 34,
      displayedLongitude: 34,
      components: componentBounds.get("mercury"),
    },
    {
      key: "sun",
      footLongitude: 36,
      displayedLongitude: 36,
      components: componentBounds.get("sun"),
    },
  ];
  const { exactRay, recordedLines, straightRay } = renderScreenshotCuspFixture(
    drawChart,
    columns,
    {
      center,
      asc,
      longitude,
      innerRadius,
      outerRadius,
      previousCusp: 5,
      nextCusp: 65,
      structuralLongitudes: [5, 35, 65, 125, 215, 305],
    },
  );

  assert.ok(
    projectedFixtureBoxWouldBlock(
      center,
      asc,
      longitude,
      innerRadius,
      outerRadius,
      projectedFalsePositive,
    ),
    "the old projected s/t envelope must classify the known component as blocked",
  );
  assert.equal(
    fixtureSegmentIntersectsBox(exactRay, projectedFalsePositive),
    false,
    "the exact oblique segment/AABB test must clear that same component",
  );
  assert.ok(
    allBoxes.every((box) => !fixtureSegmentIntersectsBox(exactRay, box)),
    "the screenshot ray must genuinely clear every Mercury and Sun component",
  );
  assert.equal(recordedLines.length, 1, "nearby columns alone may not cut the cusp");
  assert.deepEqual(
    { from: recordedLines[0].from, to: recordedLines[0].to },
    straightRay,
    "the clear Mercury-Sun cusp remains perfectly straight at its exact endpoints",
  );
});

test("routed Anglo cusps include retrograde and station marker bounds", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const width = 800;
  const height = 800;
  const chartSize = 800;
  const center = [width / 2, height / 2];
  const maxRadius = chartSize / 2;
  const asc = 45;
  const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
    profile: "anglo",
    mode: "single",
    maxRadius,
    hasOuterRing: false,
    showTerms: false,
    showDecans: false,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  });
  const normalize = (value) => ((value % 360) + 360) % 360;
  const longitudeAtPoint = (x, y) => {
    const screenAngle = Math.atan2(center[1] - y, x - center[0]) * 180 / Math.PI;
    return normalize(asc + screenAngle - 180);
  };
  const polarPoint = (radius, longitude) => {
    const rad = ((longitude - asc + 180) * Math.PI) / 180;
    return [center[0] + Math.cos(rad) * radius, center[1] - Math.sin(rad) * radius];
  };
  const samePoint = (left, right, tolerance = 1.5) =>
    Math.hypot(left[0] - right[0], left[1] - right[1]) <= tolerance;
  const segmentIntersectsBox = (segment, box, inset = 0.5) => {
    const minimums = [box.x + inset, box.y + inset];
    const maximums = [box.x + box.w - inset, box.y + box.h - inset];
    let entry = 0;
    let exit = 1;
    for (let axis = 0; axis < 2; axis += 1) {
      const origin = segment.from[axis];
      const direction = segment.to[axis] - origin;
      if (Math.abs(direction) < 1e-9) {
        if (origin < minimums[axis] || origin > maximums[axis]) return false;
        continue;
      }
      const first = (minimums[axis] - origin) / direction;
      const second = (maximums[axis] - origin) / direction;
      entry = Math.max(entry, Math.min(first, second));
      exit = Math.min(exit, Math.max(first, second));
      if (entry > exit) return false;
    }
    return true;
  };
  const makeChart = (motion, markerCusp = 15) => ({
    planets: [
      {
        id: "sun",
        longitude: 0,
        glyph: "A",
        degText: "0",
        minText: "00",
        motion,
      },
    ],
    angles: { asc, dsc: 225, mc: 315, ic: 135 },
    houses: {
      cusps: [45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345, markerCusp],
    },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: true,
      showPositions: true,
      showAspects: false,
      showSymbols: false,
      showTerms: false,
      showDecans: false,
      showCusplessAscMcLabels: true,
      angloDenseLabelLayout: "routed-cusps",
    },
  });
  const render = (chart, layer) => {
    const recordedText = [];
    const recordedLines = [];
    const draw = new drawChart.CanvasDraw(recordingCanvas(recordedText, recordedLines));
    draw.resize(width, height, 1);
    drawChart.drawSnapshotLayer(
      draw,
      {
        primaryChart: chart,
        displayDatetime: "2026-04-15T18:37:42+01:00",
        renderVariant: "round-anglo",
        overlayRenderMode: "full",
        outerRingMode: "none",
      },
      layer,
      { width, height, chartSize, renderStyle: DEFAULT_WHEEL_RENDER_STYLE },
    );
    return { recordedText, recordedLines };
  };

  for (const marker of ["R", "S", "SR", "SD"]) {
    const probe = render(makeChart(marker), "dynamic");
    const probeBody = probe.recordedText.slice(0, 5);
    assert.equal(probeBody[4]?.text, marker, `${marker} fixture must paint its motion marker`);
    const markerLongitude = longitudeAtPoint(
      probeBody[4].x + probeBody[4].w / 2,
      probeBody[4].y + probeBody[4].h / 2,
    );
    const chart = makeChart(marker, markerLongitude);
    const dynamic = render(chart, "dynamic");
    const bodyComponents = dynamic.recordedText.slice(0, 5);
    const paintedMarker = bodyComponents[4];
    assert.equal(paintedMarker?.text, marker);
    const markerBounds = {
      x: paintedMarker.x,
      y: paintedMarker.y,
      w: paintedMarker.w,
      h: paintedMarker.h,
    };
    const start = polarPoint(Math.min(rings.rBase, rings.rInner), markerLongitude);
    const end = polarPoint(Math.max(rings.rBase, rings.rInner), markerLongitude);
    const straightRay = { from: start, to: end };
    assert.ok(segmentIntersectsBox(straightRay, markerBounds), `${marker} must occupy the cusp ray`);

    const measureDraw = new drawChart.CanvasDraw(recordingCanvas([]));
    measureDraw.resize(width, height, 1);
    const measuredLayout = drawChart.getBodyLayout(
      measureDraw,
      chart,
      center,
      identityFrameForTest(asc),
      rings.rPlanet,
      rings.rPos,
      rings.rRetr,
      "AriesMorinus",
      "sans-serif",
      resolveWheelTypographyMetrics(DEFAULT_WHEEL_RENDER_STYLE, "anglo", maxRadius),
      DEFAULT_WHEEL_RENDER_STYLE,
    );
    const measuredComponents = measuredLayout.componentBounds.get("sun");
    assert.equal(measuredComponents.length, 5, `${marker} bounds join the four body components`);
    const measuredMarker = measuredComponents.at(-1);
    assert.ok(
      measuredMarker.x <= markerBounds.x &&
      measuredMarker.y <= markerBounds.y &&
      measuredMarker.x + measuredMarker.w >= markerBounds.x + markerBounds.w &&
      measuredMarker.y + measuredMarker.h >= markerBounds.y + markerBounds.h,
      `${marker} painted bounds must be enclosed by the routed component bounds`,
    );

    const geometry = render(chart, "geometry").recordedLines;
    const rootedPath = fixtureRootedPath(
      geometry,
      start.map(Math.round),
      center,
      Math.max(rings.rBase, rings.rInner),
    );
    assert.ok(rootedPath, `${marker} routed cusp must preserve its inner endpoint`);
    assert.equal(rootedPath.length, 3, `${marker} uses one rooted turn and one offset shaft`);
    assert.equal(
      samePoint(rootedPath.at(-1).to, end),
      false,
      `${marker} route may not return into an outer bracket`,
    );
    assert.ok(
      rootedPath.every((segment) => !segmentIntersectsBox(segment, markerBounds)),
      `${marker} routed cusp may not cross the painted motion marker`,
    );
  }
});

test("Anglo collision solve includes retrograde and station markers", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const maxRadius = 400;
  const markerStyle = createWheelRenderStyle({
    palette: DEFAULT_WHEEL_RENDER_STYLE.palette,
    authoringOverrides: {
      referenceRadius: maxRadius,
      typography: {
        anglo: {
          "bodies.inner.motion": 18,
        },
      },
      linePaint: {},
      fillPaint: {},
      ringRadii: {},
    },
  });
  const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
    profile: "anglo",
    mode: "single",
    maxRadius,
    hasOuterRing: false,
    showTerms: false,
    showDecans: false,
    showHouses: false,
    showPositions: true,
    comparisonWithOuterHouses: false,
  });
  const typography = resolveWheelTypographyMetrics(
    markerStyle,
    "anglo",
    maxRadius,
  );
  const bodyIds = ["mercury", "venus", "sun", "moon"];
  const chart = {
    planets: bodyIds.map((id, index) => ({
      id,
      longitude: index * 0.25,
      glyph: String.fromCharCode(65 + index),
      degText: String(2 + index),
      minText: "00",
      motion: ["R", "SR", "SD", "S"][index],
    })),
    angles: { asc: 45, dsc: 225, mc: 315, ic: 135 },
    houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30) },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: true,
      showPositions: true,
      showCusplessAscMcLabels: true,
      angloDenseLabelLayout: "leader-columns",
    },
  };
  const measurer = new drawChart.CanvasDraw(recordingCanvas([]));
  measurer.resize(800, 800, 1);
  const layout = drawChart.getBodyLayout(
    measurer,
    chart,
    [400, 400],
    wheelFrameForTest(chart),
    rings.rPlanet,
    rings.rPos,
    rings.rRetr,
    "AriesMorinus",
    "sans-serif",
    typography,
    markerStyle,
  );

  const columns = bodyIds.map((id) => [id, layout.componentBounds.get(id)]);
  for (const [id, boxes] of columns) {
    assert.equal(
      boxes.length,
      5,
      `${id} collision column includes glyph, three position rows, and motion marker`,
    );
    assert.ok(boxes.at(-1).w > 0 && boxes.at(-1).h > 0, `${id} motion bounds are measurable`);
  }
  for (let leftIdx = 0; leftIdx < columns.length - 1; leftIdx += 1) {
    for (let rightIdx = leftIdx + 1; rightIdx < columns.length; rightIdx += 1) {
      const [leftId, leftBoxes] = columns[leftIdx];
      const [rightId, rightBoxes] = columns[rightIdx];
      for (const left of leftBoxes) {
        for (const right of rightBoxes) {
          assert.equal(
            left.x < right.x + right.w &&
              left.x + left.w > right.x &&
              left.y < right.y + right.h &&
              left.y + left.h > right.y,
            false,
            `${leftId} and ${rightId} components must remain collision-free`,
          );
        }
      }
    }
  }
});

test("March 24 2029 body cluster has one canonical current-frame layout", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const typography = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "anglo",
    400,
  );
  const longitudes = {
    sun: 3.6922676738,
    moon: 102.5059903479,
    mercury: 1.0613639509,
    venus: 3.7459479975,
    mars: 185.4461303737,
    jupiter: 204.886688595,
    saturn: 39.3729058401,
    uranus: 70.7575387942,
    neptune: 8.3778763794,
    pluto: 309.935344252,
    node: 279.791549305,
  };
  const chart = {
    planets: Object.entries(longitudes).map(([id, longitude], index) => {
      const withinSign = longitude % 30;
      return {
        id,
        longitude,
        glyph: String.fromCharCode(65 + index),
        degText: String(Math.floor(withinSign)),
        minText: String(Math.floor((withinSign % 1) * 60)).padStart(2, "0"),
      };
    }),
    angles: {
      asc: 273.7311670657,
      dsc: 93.7311670657,
      mc: 215.1817948195,
      ic: 35.1817948195,
    },
    houses: {
      cusps: [
        273.7311670657,
        318.6882381373,
        3.7594996348,
        35.1817948195,
        57.3858240457,
        75.6271112319,
        93.7311670657,
        138.6882381373,
        183.7594996348,
        215.1817948195,
        237.3858240457,
        255.6271112319,
      ],
    },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: false,
      showPositions: true,
      angloDenseLabelLayout: "leader-columns",
    },
  };
  const measurer = {
    textsize: (text, opts) => {
      const size = opts?.size ?? 14;
      return [Math.max(size, String(text).length * size * 0.6), size];
    },
  };
  const arrangeChart = (sourceChart, includeHouseCuspRays) => drawChart.arrangeBodies(
    measurer,
    sourceChart,
    [400, 400],
    wheelFrameForTest(sourceChart),
    278,
    "AriesMorinus",
    "sans-serif",
    typography,
    DEFAULT_WHEEL_RENDER_STYLE,
    false,
    true,
    true,
    includeHouseCuspRays,
    false,
  );
  const arrange = () => arrangeChart(chart, false);

  const cluster = ["mercury", "sun", "venus", "neptune"];
  const fresh = arrange();
  const canonical = arrange();

  assert.deepEqual(canonical, fresh);
  assert.ok(
    Math.abs(cluster.reduce((sum, key) => sum + fresh.get(key), 0)) < 1e-9,
  );
  assert.ok(canonical.get("mercury") < canonical.get("sun"));
  assert.ok(canonical.get("sun") < canonical.get("venus"));
  assert.ok(canonical.get("venus") < canonical.get("neptune"));

  let repeated = canonical;
  for (let pass = 0; pass < 8; pass += 1) {
    repeated = arrange();
  }
  assert.deepEqual(repeated, canonical);

  const housesChart = {
    ...chart,
    options: { ...chart.options, showHouses: true },
  };
  const houseLayout = arrangeChart(housesChart, true);
  const canonicalHouseLayout = arrangeChart(housesChart, true);
  assert.deepEqual(canonicalHouseLayout, houseLayout);
});

test("November 25 2026 Anglo cluster is independent of stepping history", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const typography = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "anglo",
    400,
  );
  const chart = {
    planets: [
      ["sun", 243.33024184736908, "A", "3", "19"],
      ["moon", 77.18272379006123, "B", "17", "10"],
      ["mercury", 224.5742900304468, "C", "14", "34"],
      ["venus", 205.36560323721073, "D", "25", "21"],
      ["mars", 149.84786478413514, "E", "29", "50"],
      ["jupiter", 146.53404413582302, "F", "26", "32"],
      ["saturn", 8.144600919515563, "G", "8", "08"],
      ["uranus", 63.6897333887172, "H", "3", "41"],
      ["neptune", 1.6983707473979095, "I", "1", "41"],
      ["pluto", 303.4526785266874, "9", "3", "27"],
      ["nnode", 324.77075080480404, "K", "24", "46"],
      ["snode", 144.77075080480404, "L", "24", "46"],
      ["chiron", 27.05377332961707, "}", "27", "03"],
    ].map(([id, longitude, glyph, degText, minText]) => ({
      id,
      longitude,
      glyph,
      degText,
      minText,
    })),
    angles: {
      asc: 45.16735332680372,
      dsc: 225.16735332680372,
      mc: 291.80832277340716,
      ic: 111.80832277340716,
    },
    houses: {
      cusps: [
        45.16735332680372,
        73.20273352881347,
        92.9216260160137,
        111.80832277340716,
        134.70209052052184,
        169.68256802486303,
        225.16735332680372,
        253.20273352881347,
        272.9216260160137,
        291.80832277340716,
        314.70209052052184,
        349.6825680248631,
      ],
    },
    fortune: {
      longitude: 239.01983526949587,
      glyph: "4",
      degText: "29",
      minText: "01",
    },
    vertex: {
      longitude: 198.4580772550015,
      glyph: "!",
      degText: "18",
      minText: "27",
      house: 6,
    },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: false,
      showPositions: true,
      showCusplessAscMcLabels: true,
    },
  };
  const measurer = {
    textsize: (text, opts) => {
      const size = opts?.size ?? 14;
      return [Math.max(size, String(text).length * size * 0.6), size];
    },
  };
  const arrange = (mode) => {
    const modeChart = {
      ...chart,
      options: { ...chart.options, angloDenseLabelLayout: mode },
    };
    return drawChart.arrangeBodies(
      measurer,
      modeChart,
      [400, 400],
      wheelFrameForTest(modeChart),
      278,
      "AriesMorinus",
      "sans-serif",
      typography,
      DEFAULT_WHEEL_RENDER_STYLE,
      true,
      true,
      true,
      false,
      false,
    );
  };

  // Re-solving the same current frame is the history-free stepping contract.
  for (const mode of ["leader-columns", "routed-cusps"]) {
    const fresh = arrange(mode);
    const afterStepping = arrange(mode);
    assert.deepEqual(afterStepping, fresh, mode);
    assert.ok(144.77075080480404 + afterStepping.get("snode") <
      146.53404413582302 + afterStepping.get("jupiter"));
    assert.ok(146.53404413582302 + afterStepping.get("jupiter") <
      149.84786478413514 + afterStepping.get("mars"));
  }
});

test("step-fast Anglo leader columns are stable across settle and H toggles", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const recordedText = [];
  const canvas = recordingCanvas(recordedText);
  const draw = new drawChart.CanvasDraw(canvas);
  draw.resize(800, 800, 1);

  const ids = ["moon", "uranus", "node", "jupiter", "mars"];
  const glyphs = ["M", "U", "N", "J", "R"];
  const makeChart = (longitudes, showHouses = false) => ({
    planets: ids.map((id, index) => {
      const longitude = longitudes[index];
      const withinSign = ((longitude % 30) + 30) % 30;
      return {
        id,
        longitude,
        glyph: glyphs[index],
        degText: String(Math.floor(withinSign)),
        minText: String(Math.round((withinSign % 1) * 60)).padStart(2, "0"),
        motion: "",
      };
    }),
    angles: {
      asc: 72.083,
      dsc: 252.083,
      mc: 303.433,
      ic: 123.433,
      ascDegMin: { degText: "12", minText: "05" },
      mcDegMin: { degText: "3", minText: "26" },
    },
    houses: {
      system: "W",
      cusps: [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 0, 30],
    },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses,
      showPositions: true,
      showAspects: false,
      showSymbols: false,
      showTerms: false,
      showDecans: false,
      showCusplessAscMcLabels: true,
      angloDenseLabelLayout: "leader-columns",
    },
  });
  const snapshot = (chart, overlayRenderMode) => ({
    primaryChart: chart,
    displayDatetime: "2026-11-24T15:53:00Z",
    renderVariant: "round-anglo",
    overlayRenderMode,
    outerRingMode: "none",
  });
  const drawDynamic = (renderSnapshot) =>
    drawChart.drawSnapshotLayer(draw, renderSnapshot, "dynamic", {
      width: 800,
      height: 800,
      renderStyle: DEFAULT_WHEEL_RENDER_STYLE,
    });

  // Reproduce a live burst, its overlay-only settle, and the H on/off cycle
  // which previously acted as an accidental reset for accumulated offsets.
  drawDynamic(snapshot(makeChart([15, 45, 105, 195, 255]), "full"));
  recordedText.length = 0;
  const denseChart = makeChart([62.95, 63.733, 144.467, 146.483, 149.467]);
  drawDynamic(snapshot(denseChart, "step_fast"));

  const componentCount = 4; // glyph + degree + sign + minute
  const stepBodyCalls = recordedText.slice(0, ids.length * componentCount);
  recordedText.length = 0;
  drawDynamic(snapshot(denseChart, "full"));

  const bodyCalls = recordedText.slice(0, ids.length * componentCount);
  assert.deepEqual(bodyCalls, stepBodyCalls);
  assert.deepEqual(
    bodyCalls.filter((_, index) => index % componentCount === 0).map((call) => call.text),
    glyphs,
  );
  const typography = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "anglo",
    400,
  );
  const bodyPad = Math.max(
    DEFAULT_WHEEL_RENDER_STYLE.collision.bodyPadMin,
    typography.layoutUnit * DEFAULT_WHEEL_RENDER_STYLE.collision.bodyPadScale,
  );
  const boxesByBody = ids.map((id, bodyIndex) => ({
    id,
    boxes: bodyCalls
      .slice(bodyIndex * componentCount, (bodyIndex + 1) * componentCount)
      .map((call, componentIndex) => {
        const pad = componentIndex === 0
          ? bodyPad
          : bodyPad * DEFAULT_WHEEL_RENDER_STYLE.collision.positionRowPadScale;
        return {
          x: call.x - pad,
          y: call.y - pad,
          w: call.w + pad * 2,
          h: call.h + pad * 2,
        };
      }),
  }));
  const collisions = [];
  for (let leftIndex = 0; leftIndex < boxesByBody.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxesByBody.length; rightIndex += 1) {
      for (const left of boxesByBody[leftIndex].boxes) {
        for (const right of boxesByBody[rightIndex].boxes) {
          if (
            left.x < right.x + right.w &&
            left.x + left.w > right.x &&
            left.y < right.y + right.h &&
            left.y + left.h > right.y
          ) {
            collisions.push(`${boxesByBody[leftIndex].id}:${boxesByBody[rightIndex].id}`);
          }
        }
      }
    }
  }
  assert.deepEqual(collisions, []);

  recordedText.length = 0;
  const housesOn = {
    ...makeChart([62.95, 63.733, 144.467, 146.483, 149.467], true),
  };
  drawDynamic(snapshot(housesOn, "full"));
  recordedText.length = 0;
  drawDynamic(snapshot(denseChart, "step_fast"));
  assert.deepEqual(
    recordedText.slice(0, ids.length * componentCount),
    stepBodyCalls,
  );
});

function recordingCanvas(recordedText, recordedLines = [], recordedCircles = []) {
  const stateStack = [];
  let currentPoint = null;
  let currentSegments = [];
  let currentArc = null;
  const context = {
    font: "400 14px sans-serif",
    strokeStyle: "#fff",
    lineWidth: 1,
    save() {
      stateStack.push({
        font: this.font,
        strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth,
      });
    },
    restore() {
      const state = stateStack.pop();
      if (!state) return;
      this.font = state.font;
      this.strokeStyle = state.strokeStyle;
      this.lineWidth = state.lineWidth;
    },
    measureText(text) {
      const size = Number(/([0-9.]+)px/.exec(this.font)?.[1] ?? 14);
      const width = size * Math.max(1, text.length * 0.6);
      return {
        width,
        actualBoundingBoxAscent: size * 0.8,
        actualBoundingBoxDescent: size * 0.2,
      };
    },
    fillText(text, x, y) {
      if (["*", "𝑭", "△"].includes(text)) {
        const spec = /(?:normal )?(\d+) (\d+)px (.+)/.exec(this.font);
        const ink = spec && bundledGlyphInkBounds(text, spec[3], Number(spec[2]), Number(spec[1]));
        if (ink) {
          recordedText.push({ text, x: x + ink.x, y: y + ink.y,
            w: ink.w, h: ink.h, fontSize: Number(spec[2]) });
          return;
        }
      }
      const metrics = this.measureText(text);
      const width = Math.round(metrics.width);
      const height = Math.round(
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
      );
      const left = this.textAlign === "center"
        ? x - width / 2
        : this.textAlign === "right" || this.textAlign === "end"
          ? x - width
          : x;
      const top = this.textBaseline === "alphabetic"
        ? y - metrics.actualBoundingBoxAscent
        : this.textBaseline === "middle"
          ? y - height / 2
          : y;
      recordedText.push({
        text,
        x: left,
        y: top,
        w: width,
        h: height,
        fontSize: Number(/([0-9.]+)px/.exec(this.font)?.[1] ?? 14),
      });
    },
    setTransform() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    setLineDash() {},
    beginPath() {
      currentPoint = null;
      currentSegments = [];
      currentArc = null;
    },
    moveTo(x, y) {
      currentPoint = [x, y];
    },
    lineTo(x, y) {
      const next = [x, y];
      if (currentPoint) currentSegments.push({ from: currentPoint, to: next });
      currentPoint = next;
    },
    arc(x, y, radius) { currentArc = {x, y, radius}; },
    closePath() {},
    stroke() {
      if (currentArc) recordedCircles.push({...currentArc, strokeStyle: this.strokeStyle});
      for (const segment of currentSegments) {
        recordedLines.push({
          ...segment,
          strokeStyle: this.strokeStyle,
          lineWidth: this.lineWidth,
        });
      }
      currentSegments = [];
      currentPoint = null;
      currentArc = null;
    },
    fill() {},
  };
  return {
    width: 800,
    height: 800,
    style: {},
    getContext: () => context,
  };
}

test("resized primary body feet clear painted glyphs in every wheel and match hits", async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  let shortened = 0, intact = 0;
  for (const profile of ["classic", "compact", "anglo", "houses", "cusps"])
    for (const maxRadius of [180, 400]) for (const longitude of [0, 45, 90, 135, 180, 225, 270, 315])
      for (const narrow of [false, true]) for (const fontSizePx of [25, 40]) {
    const factory = WHEEL_FACTORY_SETTINGS.layouts[profile];
    const composition = {...factory.composition, rings: factory.composition.rings.map(ring => ({...ring,
      enabled: ring.archetypeId === "terms" || ring.archetypeId === "decans"
        ? ["classic", "compact", "anglo"].includes(profile)
        : ring.archetypeId === "cuspLabels" || ring.archetypeId === "cuspRuler" ? !narrow : ring.enabled}))};
    const chart = {
      meta: {cornerLines: {}}, aspects: [],
      planets: [0, 2, 150].map((offset, index) => ({id: ["sun", "moon", "mercury"][index],
        longitude: (longitude + offset) % 360, glyph: ["A", "B", "C"][index], motion: index === 2 ? "R" : "",
        degText: "15", minText: "00", minorDignityCount: 1, hasTermDignity: true})),
      angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
      houses: {cusps: Array.from({length: 12}, (_, index) => index * 30)},
      options: {theme: factory.optionValue, wheelComposition: composition, showHouses: true,
        showPositions: false, showAspects: false, showSymbols: false, signVariant: 1,
        showTerms: true, showDecans: true, showCusplessAscMcLabels: false, showTermGlyphs: narrow},
    };
    const style = {...DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      ...(narrow ? {ringWidths: {[profile]: {[`${profile}-bodies`]: 32}}} : {}),
      typography: {[profile]: {"bodies.inner.glyph": {fontSizePx}}},
    }};
    const snapshot = {primaryChart: chart, outerRingMode: "none", overlayRenderMode: "full",
      renderVariant: `round-${profile}`};
    const text = [], lines = [];
    const draw = new renderer.CanvasDraw(recordingCanvas(text, lines));
    draw.resize(800, 800, 1);
    // Body fixtures paint em boxes; dignity marks now paint the source font
    // ink rather than the empty space below the superscript asterisk.
    const trueTextBounds = draw.textbounds.bind(draw);
    draw.textbounds = (value, paint) => {
      if (["*", "𝑭", "△"].includes(value)) return trueTextBounds(value, paint);
      const [w, h] = draw.textsize(value, paint);
      return {x: 0, y: 0, w, h};
    };
    const options = {width: 800, height: 800, chartSize: maxRadius * 2, renderStyle: style};
    renderer.drawSnapshotLayer(draw, snapshot, "dynamic", options);
    const glyphs = text.filter(box => ["A", "B", "C"].includes(box.text));
    assert.equal(glyphs.length, 3, "no body is removed or shrunk to clear its foot");
    assert.ok(glyphs.every(box => box.fontSize === Math.round(fontSizePx * maxRadius / 400)),
      "authored glyph sizes remain intact");
    const glyphAndMarkers = text.filter(box => ["A", "B", "C", "R", "*"].includes(box.text));
    const hits = renderer.computeHitRegions(snapshot, {...options,
      textsize: (value, paint) => draw.textsize(value, paint), textbounds: draw.textbounds});
    const geometry = renderer.wheelGeometryInputForSnapshot(snapshot, maxRadius);
    const rings = resolveWheelRingSet(style, geometry);
    const expectedDepths = [Math.abs(rings.rInner - rings.rLLine), Math.abs(rings.rAsp - rings.rLLine2)];
    for (const hit of hits.filter(hit => hit.kind === "planet")) {
      const glyph = glyphs.find(box => box.text === chart.planets.find(planet => planet.id === hit.planetId).glyph);
      const size = glyph.fontSize;
      assert.ok(Math.hypot(glyph.x + size / 2 - hit.x, glyph.y + size / 2 - hit.y) < 1.5,
        `${profile}: glyph and hit centres agree`);
      for (const [index, segment] of hit.leaderSegments.entries()) {
        const painted = lines.find(line => Math.hypot(line.from[0] - segment.start[0], line.from[1] - segment.start[1]) < 1.5
          && Math.hypot(line.to[0] - segment.end[0], line.to[1] - segment.end[1]) < 1.5);
        assert.ok(painted,
        `${profile}: painted feet and hit metadata agree`);
        const length = Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]);
        if (length < expectedDepths[index] - 1e-6) shortened++; else intact++;
        for (let step = 0; step <= 100; step++) {
          const x = painted.from[0] + (painted.to[0] - painted.from[0]) * step / 100;
          const y = painted.from[1] + (painted.to[1] - painted.from[1]) * step / 100;
          const pad = painted.lineWidth / 2;
          assert.ok(!glyphAndMarkers.some(box => x > box.x - pad && x < box.x + box.w + pad
            && y > box.y - pad && y < box.y + box.h + pad),
          `${profile}/${maxRadius}/${longitude}/${narrow}/${fontSizePx}: foot crosses glyph or marker ink`);
        }
      }
    }
  }
  assert.ok(shortened > 0, "the squeezed cases exercise shortening");
  assert.ok(intact > 0, "clear feet keep their original length");
});

test("traditional Anglo mixed layout ignores symbolic comparison axes", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const center = [400, 400];
  const maxRadius = 400;
  const typography = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "anglo",
    maxRadius,
  );
  const makeChart = (angles, cusps, planets = []) => ({
    planets,
    angles,
    houses: { cusps },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: true,
      showPositions: true,
      showAspects: false,
      showSymbols: false,
      showTerms: false,
      showDecans: false,
      showCusplessAscMcLabels: true,
      angloDenseLabelLayout: "routed-cusps",
    },
  });
  const primaryChart = makeChart(
    {
      asc: 251.303,
      dsc: 71.303,
      mc: 163.781,
      ic: 343.781,
      ascDegMin: { degText: "11", minText: "18" },
      mcDegMin: { degText: "13", minText: "47" },
    },
    [251.303, 285.1, 319.8, 343.781, 9, 40, 71.303, 105.1, 139.8, 163.781, 189, 220],
  );
  const movingBodies = [250.8, 251.5, 252.2].map((longitude, index) => ({
    id: ["sun", "moon", "mercury"][index],
    longitude,
    glyph: String.fromCharCode(65 + index),
    degText: String(Math.floor(longitude % 30)),
    minText: String(Math.round((longitude % 1) * 60)).padStart(2, "0"),
    motion: "",
  }));
  const comparisonChart = makeChart(
    {
      asc: 218.958,
      dsc: 38.958,
      mc: 131.522,
      ic: 311.522,
      ascDegMin: { degText: "8", minText: "57" },
      mcDegMin: { degText: "11", minText: "31" },
    },
    [218.958, 251.6, 285.2, 311.522, 341, 9, 38.958, 71.6, 105.2, 131.522, 161, 189],
    movingBodies,
  );
  const changedSymbolicAxes = makeChart(
    {
      asc: 19,
      dsc: 199,
      mc: 287,
      ic: 107,
      ascDegMin: { degText: "19", minText: "00" },
      mcDegMin: { degText: "17", minText: "00" },
    },
    [19, 57, 98, 107, 131, 163, 199, 237, 278, 287, 311, 343],
    movingBodies,
  );
  const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
    profile: "anglo",
    mode: "comparison",
    maxRadius,
    hasOuterRing: true,
    showTerms: false,
    showDecans: false,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  });
  const measurer = new drawChart.CanvasDraw(recordingCanvas([]));
  measurer.resize(800, 800, 1);
  const layout = (bodyChart, frameworkChart) => drawChart.getBodyLayout(
    measurer,
    bodyChart,
    center,
    wheelFrameForTest(primaryChart),
    rings.rPlanet,
    rings.rPos,
    rings.rRetr,
    "AriesMorinus",
    "sans-serif",
    typography,
    DEFAULT_WHEEL_RENDER_STYLE,
    true,
    true,
    frameworkChart,
    {
      includeAngles: true,
      includePositionStacks: true,
      includeSharedAngles: false,
      includeHouseCuspRays: true,
      outerTypography: false,
      usePrimaryGlyphSize: false,
    },
  );

  const original = layout(comparisonChart, primaryChart);
  const symbolicAxesChanged = layout(changedSymbolicAxes, primaryChart);
  assert.deepEqual(
    symbolicAxesChanged.bodyShifts,
    original.bodyShifts,
    "comparison ASC/MC/cusps cannot move bodies or fixed framework labels",
  );
  assert.deepEqual(
    symbolicAxesChanged.componentBounds,
    original.componentBounds,
    "paint and hit geometry stay on the same fixed-framework solution",
  );
  assert.equal(original.bodyShifts.has("__asc"), false);
  assert.equal(original.bodyShifts.has("__mc"), false);

  const wrongFramework = layout(comparisonChart, comparisonChart);
  assert.notDeepEqual(
    wrongFramework.bodyShifts,
    original.bodyShifts,
    "the fixture detects the formerly mixed symbolic-time framework",
  );

  const cusplessPrimary = {
    ...primaryChart,
    options: {
      ...primaryChart.options,
      showHouses: false,
      showCusplessAscMcLabels: true,
    },
  };
  const cuspless = drawChart.getBodyLayout(
    measurer,
    comparisonChart,
    center,
    wheelFrameForTest(primaryChart),
    rings.rPlanet,
    rings.rPos,
    rings.rRetr,
    "AriesMorinus",
    "sans-serif",
    typography,
    DEFAULT_WHEEL_RENDER_STYLE,
    true,
    true,
    cusplessPrimary,
    {
      includeAngles: true,
      includePositionStacks: true,
      includeSharedAngles: true,
      includeHouseCuspRays: false,
      outerTypography: false,
      usePrimaryGlyphSize: false,
    },
  );
  assert.ok(cuspless.bodyShifts.has("__asc"));
  assert.ok(cuspless.bodyShifts.has("__mc"));
});

// Renderer internals take a WheelFrame (rotation + angular model), not a bare
// ascendant. Tests build it with the renderer's own resolver so a chart whose
// layout is the house wheel gets that projection here too.
let drawChartInternals = null;
const wheelFrameForTest = (chart) => drawChartInternals.wheelFrame(chart);
// Zodiac-fixed frame for the fixtures that pass a bare rotation, not a chart.
const identityFrameForTest = (rotation) => drawChartInternals.identityFrame(rotation);

async function loadDrawChartCollisionInternals() {
  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  };
  const transpile = (source) => ts.transpileModule(source, { compilerOptions }).outputText.replaceAll('"./wheel-composition"', `"${compositionModuleUrl}"`).replaceAll('"../chart/wheel-composition"', `"${compositionModuleUrl}"`);
  const dataUrl = (source) =>
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

  const chartFontsUrl = dataUrl(
    transpile(
      await readSource(new URL("../src/lib/chart/chart-fonts.ts", import.meta.url)),
    ),
  );
  const textInkGapUrl = dataUrl(
    transpile(
      await readSource(new URL("../src/lib/chart/text-ink-gap.ts", import.meta.url)),
    ),
  );
  const canvasDrawUrl = dataUrl(
    transpile(
      await readSource(new URL("../src/lib/chart/canvas-draw.ts", import.meta.url)),
    ).replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`).replaceAll('"./text-ink-gap"', `"${textInkGapUrl}"`),
  );
  const canvasDraw = await import(canvasDrawUrl);
  const wheelStyleUrl = dataUrl(wheelStyleJavascript);
  const glyphsUrl = dataUrl(
    transpile(await readSource(new URL("../src/lib/chart/glyphs.ts", import.meta.url))),
  );
  const ditherPatternUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/render/dither-pattern.ts", import.meta.url),
      ),
    ),
  );
  const outerGlyphLaneUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/outer-glyph-lane.ts", import.meta.url),
      ),
    ),
  );
  const wheelProjectionUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/wheel-projection.ts", import.meta.url),
      ),
    ),
  );
  const chartCoordinatesUrl = dataUrl(transpile(await readSource(
    new URL("../src/lib/chart/chart-coordinates.ts", import.meta.url),
  )).replaceAll('"./wheel-projection"', `"${wheelProjectionUrl}"`));
  const dignityPolicy = await readSource(new URL("../src/lib/chart/dignity-display-policy.json", import.meta.url));
  const paletteUrl = dataUrl(transpile(
    (await readSource(new URL("../src/lib/chart/palette.ts", import.meta.url)))
      .replace('import dignityDisplayPolicy from "./dignity-display-policy.json";',
        `const dignityDisplayPolicy = ${dignityPolicy};`),
  ));
  let drawChartSource = await readSource(
    new URL("../src/lib/chart/draw-chart.ts", import.meta.url),
  );
  drawChartSource = drawChartSource
    .replaceAll('"./palette"', `"${paletteUrl}"`)
    .replace("function bodyKeys(", "export function bodyKeys(")
    .replace("function bodyGlyphSize(", "export function bodyGlyphSize(")
    .replace("function arrangeBodies(", "export function arrangeBodies(")
    .replace("function placeOuterWordLabel(", "export function placeOuterWordLabel(")
    .replace("function outerRingItemPlacement(", "export function outerRingItemPlacement(")
    .replace("function prepareOuterRingItems(", "export function prepareOuterRingItems(")
    .replace("function prepareFixedStars(", "export function prepareFixedStars(")
    .replace(
      "function ensureTextOutsideOuterWheel(",
      "export function ensureTextOutsideOuterWheel(",
    )
    .replace("function getBodyLayout(", "export function getBodyLayout(")
    .replace("function wheelFrame(", "export function wheelFrame(")
    .replace("function layoutSurveilMark(", "export function layoutSurveilMark(")
    .replace("function drawRoutedRadialLine(", "export function drawRoutedRadialLine(")
    .replace("function drawAngloCuspArrow(", "export function drawAngloCuspArrow(")
    .replace("function drawPlanets(", "export function drawPlanets(")
    .replace("function drawAngloHouseCuspTicks(", "export function drawAngloHouseCuspTicks(")
    .replace("function drawAscMC(", "export function drawAscMC(")
    .replace(
      "function paintZodiacElementSlices(",
      "export function paintZodiacElementSlices(",
    )
    .replace(
      "function zodiacElementTextureFillClass(",
      "export function zodiacElementTextureFillClass(",
    )
    .replace("function resolveAspectsForDraw(", "export function resolveAspectsForDraw(")
    .replace(
      "function resolveInterChartAspectsForDraw(",
      "export function resolveInterChartAspectsForDraw(",
    );
  const drawChartJavascript = transpile(drawChartSource)
    .replaceAll('"./chart-coordinates"', `"${chartCoordinatesUrl}"`)
    .replaceAll('"./chart-overlay-lines"', `"${dataUrl(transpile(await readSource(
      new URL("../src/lib/chart/chart-overlay-lines.ts", import.meta.url),
    )))}"`)
    .replaceAll('"./canvas-draw"', `"${canvasDrawUrl}"`)
    .replaceAll('"./wheel-projection"', `"${wheelProjectionUrl}"`)
    .replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`).replaceAll('"./text-ink-gap"', `"${textInkGapUrl}"`)
    .replaceAll('"./vintage-magazine-wheel"', `"${dataUrl(transpile(await readSource(
      new URL("../src/lib/chart/vintage-magazine-wheel.ts", import.meta.url),
    )).replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`).replaceAll('"./text-ink-gap"', `"${textInkGapUrl}"`).replaceAll('"./canvas-draw"', `"${canvasDrawUrl}"`))}"`)
    .replaceAll('"./wheel-render-style"', `"${wheelStyleUrl}"`)
    // draw-chart now imports the band model directly, to cap a glyph at the
    // ring that holds it. Without this rewrite the harness leaves a bare
    // specifier that no loader can resolve.
    .replaceAll('"./wheel-layout-model"', `"${layoutModelUrl}"`)
    .replaceAll('"./outer-label-names"', `"${dataUrl(transpile(await readSource(
      new URL("../src/lib/chart/outer-label-names.ts", import.meta.url),
    )))}"`)
    .replaceAll('"./outer-glyph-lane"', `"${outerGlyphLaneUrl}"`)
    .replaceAll('"./glyphs"', `"${glyphsUrl}"`)
    .replaceAll('"../render/dither-pattern"', `"${ditherPatternUrl}"`)
    .replaceAll('"../render/fill-texture-mipmap"', `"${dataUrl(transpile(await readSource(
      new URL("../src/lib/render/fill-texture-mipmap.ts", import.meta.url),
    )).replaceAll('"./dither-pattern"', `"${ditherPatternUrl}"`))}"`);
  const loaded = {
    ...(await import(dataUrl(drawChartJavascript))),
    ...(await import(wheelProjectionUrl)),
    CanvasDraw: canvasDraw.CanvasDraw,
    polar: canvasDraw.polar,
  };
  drawChartInternals = loaded;
  return loaded;
}

test('chart font readiness includes the bundled mathematical face glyph and reuses warm loads', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const previousDocument = globalThis.document;
  const calls = [];
  let releaseFace;
  const faceReady = new Promise(resolve => { releaseFace = resolve; });
  globalThis.document = { fonts: { load(font, text) {
    calls.push({font, text});
    return font.includes('AriesDignityFace') ? faceReady : Promise.resolve([]);
  } } };
  try {
    const first = renderer.awaitFonts('DignityFontReadiness', 'DignitySymbolsReadiness');
    const concurrent = renderer.awaitFonts('DignityFontReadiness', 'DignitySymbolsReadiness');
    assert.equal(renderer.chartFontsAreReady('DignityFontReadiness', 'DignitySymbolsReadiness'), false);
    assert.deepEqual(calls.filter(call => call.font.includes('AriesDignityFace')),
      [{font: '14px "AriesDignityFace"', text: '𝑭'}]);
    assert.ok(calls.some(call => call.font === '700 14px "FreeSans"'), 'The five-point asterisk uses the loaded bold face');
    releaseFace([]);
    await Promise.all([first, concurrent]);
    assert.equal(renderer.chartFontsAreReady('DignityFontReadiness', 'DignitySymbolsReadiness'), true);
    const count = calls.length;
    await renderer.awaitFonts('DignityFontReadiness', 'DignitySymbolsReadiness');
    assert.equal(calls.length, count, 'Warm paints perform no additional font requests');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

async function readSource(url) {
  return (await readFile(url, "utf8")).replace(/\r\n?/g, "\n");
}






// --- ring drags are authored in reference space --------------------------

test("no two rings painted in the same layout share a ring-set field", () => {
  // The previous version of this suite carried its own copy of the role→field
  // map and it was off by one — termRing mapped to rInner, colliding with
  // innerBoundaryRing. Tests written against it passed while the code they
  // covered was wrong. The map is now read from production, and the invariant
  // that actually matters is asserted: two rings drawn in the same layout must
  // never write the same field, or a drag on one would resolve as the other.
  const base = {
    maxRadius: 400,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
  };
  let states = 0;
  for (const profile of ["classic", "compact", "anglo"]) {
    for (const mode of ["single", "comparison"]) {
      for (const hasOuterRing of [false, true]) {
        for (const comparisonWithOuterHouses of [false, true]) {
          if (mode === "single" && comparisonWithOuterHouses) continue;
          const input = { ...base, profile, mode, hasOuterRing, comparisonWithOuterHouses };
          const byField = new Map();
          for (const role of activePaintedRingRoles(input)) {
            const field = paintedRingFieldFor(role, profile);
            assert.ok(field, `${role} has no field in ${profile}`);
            const prior = byField.get(field);
            assert.ok(
              prior === undefined,
              `${profile}/${mode}: ${prior} and ${role} both write ${field}`,
            );
            byField.set(field, role);
          }
          states += 1;
        }
      }
    }
  }
  assert.ok(states >= 12, `expected a real matrix, checked ${states}`);
});


test("a ring's legal range is expressed in the space its value is stored in", () => {
  // The bug: the drag produces a reference-space radius, the solver
  // reports its interval in rendered pixels, and clamping one against the
  // other made a ring teleport on the first frame of a grab. The error
  // vanished at exactly one pane size — a 400px wheel radius — so a suite that
  // only ever tested that size could not see it.
  const style = DEFAULT_WHEEL_RENDER_STYLE;
  const base = {
    profile: "classic",
    mode: "single",
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const reference = 400;

  for (const maxRadius of [200, 300, 350, 400, 450, 733.5]) {
    const input = { ...base, maxRadius };
    for (const role of ["zodiacOuterRing", "zodiacInnerRing", "termRing", "baseRing"]) {
      const rendered = resolveWheelPaintedRingRadiusRange(style, input, role);
      const referenceRange = resolveWheelPaintedRingReferenceRange(style, input, role);
      assert.ok(rendered && referenceRange, `${role} unsolvable at ${maxRadius}`);

      // The reference range is the rendered range carried back into reference
      // space, so projecting it forward again must return the rendered one.
      const scale = maxRadius / reference;
      assert.ok(
        Math.abs(referenceRange.min * scale - rendered.min) < 1e-6,
        `${role} @ ${maxRadius}: min not in reference space`,
      );
      assert.ok(
        Math.abs(referenceRange.max * scale - rendered.max) < 1e-6,
        `${role} @ ${maxRadius}: max not in reference space`,
      );
    }
  }
});

test("clamping a drag is stable across repeated grabs at any pane size", () => {
  // The writeback compounded: a rendered-px result stored in a reference-px
  // slot was rescaled on the next paint, so each grab shrank the ring again.
  // Clamping in the stored space must be idempotent — re-applying an already
  // authored radius has to leave it alone, at every pane size.
  const style = DEFAULT_WHEEL_RENDER_STYLE;
  const base = {
    profile: "classic",
    mode: "single",
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  for (const maxRadius of [200, 300, 400, 733.5]) {
    const input = { ...base, maxRadius };
    const range = resolveWheelPaintedRingReferenceRange(style, input, "zodiacInnerRing");
    assert.ok(range);
    const clamp = (value) => Math.min(range.max, Math.max(range.min, value));
    for (const request of [range.min - 50, range.min, 150, 272, range.max, range.max + 50]) {
      const once = clamp(request);
      assert.equal(clamp(once), once, `not idempotent at ${maxRadius} for ${request}`);
      assert.ok(once >= range.min - 1e-9 && once <= range.max + 1e-9);
    }
  }
});

// ---------------------------------------------------------------------------
// Whole-wheel scale.
//
// Scale and resize are separate operations. These pin the difference, because
// the failure that produced them was a scale inferred from a boundary drag: it
// re-authored every ring, so the wheel kept a stale proportion, nothing was
// left free to absorb the next edit, and the gesture could not be undone.
// ---------------------------------------------------------------------------

const SCALE_BASE_INPUT = {
  profile: "classic",
  mode: "single",
  hasOuterRing: false,
  showTerms: true,
  showDecans: true,
  showHouses: true,
  showPositions: true,
  comparisonWithOuterHouses: false,
};

/** A style carrying an authored whole-wheel scale, and nothing else. */
function styleWithWheelScale(scale, profile = "classic") {
  return {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      wheelScale: { [profile]: scale },
    },
  };
}

/** A style carrying one authored ring radius, in reference-space px. */
function styleWithRingPin(role, referenceRadius, profile = "classic") {
  return {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      ringRadii: { [profile]: { [role]: referenceRadius } },
    },
  };
}

/**
 * The wheel radius a paint uses, mirroring `scaledWheelRadius` in draw-chart.
 * Scale is applied by solving for a smaller wheel, never after the solve.
 */
function paintedWheelRadius(style, paneRadius, profile = "classic") {
  return paneRadius * resolveWheelScale(style, profile);
}

test("an unauthored wheel scale is exactly 1 and out-of-range values are clamped", () => {
  assert.equal(resolveWheelScale(DEFAULT_WHEEL_RENDER_STYLE, "classic"), 1);
  assert.equal(resolveWheelScale(styleWithWheelScale(0.5), "classic"), 0.5);
  // Above 1 the outermost ring would grow through the margin the angle arrows
  // live in and clip against the pane; below the floor the handle that scales
  // it back would be out of reach.
  assert.equal(resolveWheelScale(styleWithWheelScale(4), "classic"), WHEEL_SCALE_RANGE.max);
  assert.equal(resolveWheelScale(styleWithWheelScale(0.001), "classic"), WHEEL_SCALE_RANGE.min);
  // A scale authored for one profile must not leak into the others.
  assert.equal(resolveWheelScale(styleWithWheelScale(0.5, "anglo"), "classic"), 1);
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    assert.equal(resolveWheelScale(styleWithWheelScale(bad), "classic"), 1);
  }
});

test("a scaled wheel is the same wheel, geometry and contents together", () => {
  // Item 1 and item 2 of the resize model are one mechanism: a scale gesture
  // moves the geometry and everything drawn inside it by a single factor. If
  // these ever diverge, glyphs stop tracking the bands that hold them.
  for (const paneRadius of [200, 300, 400, 733.5]) {
    for (const scale of [0.3, 0.55, 0.8, 1]) {
      const style = styleWithWheelScale(scale);
      const full = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
        ...SCALE_BASE_INPUT,
        maxRadius: paneRadius,
      });
      const scaled = resolveWheelRingSet(style, {
        ...SCALE_BASE_INPUT,
        maxRadius: paintedWheelRadius(style, paneRadius),
      });
      for (const role of activePaintedRingRoles(SCALE_BASE_INPUT)) {
        const field = paintedRingFieldFor(role, "classic");
        assert.ok(
          Math.abs(scaled[field] - full[field] * scale) < 1e-9,
          `${role} @ pane ${paneRadius} scale ${scale}: `
          + `${scaled[field]} != ${full[field] * scale}`,
        );
      }
      const fullText = resolveWheelTypographyMetrics(
        DEFAULT_WHEEL_RENDER_STYLE, "classic", paneRadius,
      );
      const scaledText = resolveWheelTypographyMetrics(
        style, "classic", paintedWheelRadius(style, paneRadius),
      );
      for (const metric of ["signSize", "bodySize", "termSize", "decanSize"]) {
        if (typeof fullText[metric] !== "number" || fullText[metric] === 0) continue;
        assert.ok(
          Math.abs(scaledText[metric] - fullText[metric] * scale) < 1e-9,
          `${metric} @ pane ${paneRadius} scale ${scale} did not scale with the wheel`,
        );
      }
    }
  }
});

test("scaling the wheel authors no ring, and carries the rings that were authored", () => {
  // Minimal authorship (invariant 6). A scale holds one ratio; every band keeps
  // whatever radius it was given, so scaling commutes with pinning. The version
  // that re-authored each displaced ring pinned the whole stack after one
  // gesture and left nothing free to absorb the next edit.
  const paneRadius = 512;
  // Keep the pin inside the enlarged Morinus wheel's feasible band budget.
  // An over-constrained pin engages the intentional one-CSS-pixel floor.
  const pinned = styleWithRingPin("zodiacInnerRing", 280);
  for (const scale of [0.35, 0.6, 0.9]) {
    const pinnedAndScaled = {
      ...pinned,
      authoringOverrides: {
        ...pinned.authoringOverrides,
        wheelScale: { classic: scale },
      },
    };
    // The authored radius is untouched by the scale: same slot, same number.
    assert.equal(
      pinnedAndScaled.authoringOverrides.ringRadii.classic.zodiacInnerRing,
      pinned.authoringOverrides.ringRadii.classic.zodiacInnerRing,
      "a scale rewrote an authored ring radius",
    );
    const unscaled = resolveWheelRingSet(pinned, {
      ...SCALE_BASE_INPUT,
      maxRadius: paneRadius,
    });
    const scaled = resolveWheelRingSet(pinnedAndScaled, {
      ...SCALE_BASE_INPUT,
      maxRadius: paintedWheelRadius(pinnedAndScaled, paneRadius),
    });
    for (const role of activePaintedRingRoles(SCALE_BASE_INPUT)) {
      const field = paintedRingFieldFor(role, "classic");
      assert.ok(
        Math.abs(scaled[field] - unscaled[field] * scale) < 1e-9,
        `${role} @ scale ${scale}: ${scaled[field]} != ${unscaled[field] * scale}`,
      );
    }
  }
});

test("returning the scale to 1 restores the wheel exactly, in a later gesture", () => {
  // Cross-gesture invertibility, which ring drags cannot offer and scale can,
  // precisely because it authors a ratio instead of a set of radii. "The whole
  // chart can be collapsed with no chance to get it back" was the alternative.
  for (const paneRadius of [240, 400, 619]) {
    const pristine = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
      ...SCALE_BASE_INPUT,
      maxRadius: paneRadius,
    });
    let style = DEFAULT_WHEEL_RENDER_STYLE;
    for (const scale of [0.8, 0.42, WHEEL_SCALE_RANGE.min, 0.65, 1]) {
      style = styleWithWheelScale(scale);
    }
    const restored = resolveWheelRingSet(style, {
      ...SCALE_BASE_INPUT,
      maxRadius: paintedWheelRadius(style, paneRadius),
    });
    for (const role of activePaintedRingRoles(SCALE_BASE_INPUT)) {
      const field = paintedRingFieldFor(role, "classic");
      assert.equal(
        restored[field],
        pristine[field],
        `${role} @ pane ${paneRadius} did not return to its unscaled radius`,
      );
    }
  }
});

test("resizing one band leaves every authored glyph size alone", () => {
  // Typography is independent of boundary edits. Physical paint containment
  // and unchanged surviving fonts are covered through the native preset and
  // actual renderer in wheel-glyph-paint-contract.test.mjs.
  for (const paneRadius of [260, 400, 700]) {
    const pristine = resolveWheelTypographyMetrics(
      DEFAULT_WHEEL_RENDER_STYLE, "classic", paneRadius,
    );
    for (const [role, radius] of [
      ["zodiacInnerRing", 190],
      ["zodiacOuterRing", 330],
      ["termRing", 240],
    ]) {
      const resized = resolveWheelTypographyMetrics(
        styleWithRingPin(role, radius), "classic", paneRadius,
      );
      assert.deepEqual(
        resized,
        pristine,
        `pinning ${role} changed glyph metrics at pane ${paneRadius}`,
      );
    }
  }
});

test("a scaled wheel resolves the same however its edits were ordered", () => {
  // Order-independence (invariant 9) has to survive the new value. The stack is
  // solved in one declarative pass against the authored pins, so a profile that
  // was scaled then pinned must equal one that was pinned then scaled.
  const paneRadius = 480;
  const scaleFirst = {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      wheelScale: { classic: 0.7 },
      ringRadii: { classic: { zodiacInnerRing: 205, termRing: 175 } },
    },
  };
  const pinFirst = {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      ringRadii: { classic: { termRing: 175, zodiacInnerRing: 205 } },
      wheelScale: { classic: 0.7 },
    },
  };
  const solve = (style) => resolveWheelRingSet(style, {
    ...SCALE_BASE_INPUT,
    maxRadius: paintedWheelRadius(style, paneRadius),
  });
  assert.deepEqual(solve(scaleFirst), solve(pinFirst));
});

test("sign-locked cusps break across a body column instead of routing around it", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  // The February 22 1990 screenshot geometry, re-rendered under the sign-locked
  // contract. The same obstruction that produces a rooted dogleg there must
  // produce an exact broken cusp here.
  const componentBounds = new Map([
    ["moon", [
      { x: 230, y: 398, w: 24, h: 32 },
      { x: 228, y: 390, w: 28, h: 8 },
    ]],
    ["mars", [{ x: 215, y: 382, w: 41, h: 8 }]],
    ["saturn", [{ x: 205, y: 382, w: 10, h: 8 }]],
  ]);
  const columns = [...componentBounds.entries()].map(([key, components], index) => ({
    key,
    footLongitude: index + 1,
    displayedLongitude: index + 1,
    components,
  }));
  const allBoxes = [...componentBounds.values()].flat();
  const breakGapPx = DEFAULT_WHEEL_RENDER_STYLE.collision.cuspBreakGapPx;
  const { recordedLines, straightRay } = renderScreenshotCuspFixture(
    drawChart,
    columns,
    { breakAcrossColumns: true, breakGapPx },
  );

  assert.ok(recordedLines.length >= 2, "an obstructed sign-locked cusp is broken, not omitted");
  assert.equal(
    recordedLines.some((segment) => fixtureSegmentsMatch(segment, straightRay)),
    false,
    "an occupied cusp may not remain one straight segment",
  );
  // Every surviving piece stays on the exact cusp: sign-locked paint never
  // turns, so the line still reads as one house boundary.
  const rayDirection = [
    straightRay.to[0] - straightRay.from[0],
    straightRay.to[1] - straightRay.from[1],
  ];
  const rayLength = Math.hypot(rayDirection[0], rayDirection[1]);
  const offRay = (point) => {
    const dx = point[0] - straightRay.from[0];
    const dy = point[1] - straightRay.from[1];
    return Math.abs((dx * rayDirection[1] - dy * rayDirection[0]) / rayLength);
  };
  for (const segment of recordedLines) {
    assert.ok(
      offRay(segment.from) <= 0.5 && offRay(segment.to) <= 0.5,
      "a broken cusp piece may not leave the exact cusp ray",
    );
  }
  assert.deepEqual(
    recordedLines[0].from,
    straightRay.from,
    "the cusp still starts at its exact inner foot",
  );
  assert.deepEqual(
    recordedLines.at(-1).to,
    straightRay.to,
    "the cusp still finishes on the outer circle",
  );
  // The break carries the authored clearance, so the glyph reads through it.
  const gapped = allBoxes.map((box) => ({
    x: box.x - breakGapPx,
    y: box.y - breakGapPx,
    w: box.w + breakGapPx * 2,
    h: box.h + breakGapPx * 2,
  }));
  assert.ok(
    recordedLines.every((segment) =>
      // Exact tangency is clearance, not overlap: the carve is measured from
      // the stroke's edge, so a piece may end flush against the halo.
      gapped.every((box) => !fixtureSegmentIntersectsBox(segment, box, 0.01))
    ),
    "no painted piece may enter a column's cleared halo",
  );
  assert.equal(
    fixtureRootedPath(recordedLines, straightRay.from, [400, 400], 300),
    null,
    "sign-locked paint may never form a rooted route",
  );
});

test("sign-locked packing holds a boundary-straddling cluster inside its own sign", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const typography = resolveWheelTypographyMetrics(
    DEFAULT_WHEEL_RENDER_STYLE,
    "anglo",
    400,
  );
  // A four-body cluster tight against 0 Aries, with every angle far away, so
  // only the sign wall can decide whether a body crosses the boundary.
  const planetValues = [
    ["sun", 358.2, "A", "28", "12"],
    ["mercury", 359.1, "C", "29", "06"],
    ["venus", 359.7, "D", "29", "42"],
    ["mars", 0.4, "E", "0", "24"],
  ];
  const baseChart = {
    planets: planetValues.map(([id, longitude, glyph, degText, minText]) => ({
      id,
      longitude,
      glyph,
      degText,
      minText,
    })),
    angles: { asc: 120, dsc: 300, mc: 210, ic: 30 },
    houses: {
      cusps: Array.from({ length: 12 }, (_, index) => (120 + index * 30) % 360),
    },
    aspects: [],
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: true,
      showPositions: true,
      showTerms: true,
      showDecans: false,
      showCusplessAscMcLabels: true,
    },
  };
  const measurer = {
    textsize: (text, opts) => {
      const size = opts?.size ?? 14;
      return [Math.max(size, String(text).length * size * 0.6), size];
    },
  };
  const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
    profile: "anglo",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: true,
    showDecans: false,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  });
  const arrange = (mode) =>
    drawChart.arrangeBodies(
      measurer,
      { ...baseChart, options: { ...baseChart.options, angloDenseLabelLayout: mode } },
      [400, 400],
      wheelFrameForTest(baseChart),
      rings.rPlanet,
      "AriesMorinus",
      "sans-serif",
      typography,
      DEFAULT_WHEEL_RENDER_STYLE,
      true,
      true,
      false,
      true,
      false,
    );

  const signOf = (longitude) => Math.floor(((longitude % 360) + 360) % 360 / 30);
  const displayed = (layout, id) => {
    const body = baseChart.planets.find((planet) => planet.id === id);
    return body.longitude + (layout.get(id) ?? 0);
  };

  const signLocked = arrange("sign-locked");
  const routed = arrange("routed-cusps");

  for (const body of baseChart.planets) {
    assert.equal(
      signOf(displayed(signLocked, body.id)),
      signOf(body.longitude),
      `${body.id} may not be displayed outside its own sign`,
    );
  }
  // The cluster must actually have been under pressure, otherwise the sign wall
  // proved nothing. Routed packing, which knows only the angles, spills it.
  assert.ok(
    baseChart.planets.some(
      (body) => signOf(displayed(routed, body.id)) !== signOf(body.longitude),
    ),
    "the fixture must be dense enough that angle-only packing crosses the sign",
  );
  assert.notDeepEqual(
    signLocked,
    routed,
    "sign-locked is the one presentation mode that also changes body layout",
  );
  // Order and true feet are untouched: locking a sign spaces a stellium, it
  // never reorders or re-signs it.
  const fromClusterStart = (longitude) => ((longitude - 330) % 360 + 360) % 360;
  const order = (layout) =>
    [...baseChart.planets]
      .sort((left, right) =>
        fromClusterStart(displayed(layout, left.id)) -
          fromClusterStart(displayed(layout, right.id))
      )
      .map((body) => body.id);
  assert.deepEqual(order(signLocked), ["sun", "mercury", "venus", "mars"]);
});

test("a sign-locked angle notches for a glyph on it and stays whole otherwise", { timeout: 5_000 }, async () => {
  const drawChart = await loadDrawChartCollisionInternals();
  const size = 1200;
  const centre = [size / 2, size / 2];
  const asc = 100;
  // The IC carries no label of its own, so a body can genuinely stand on it.
  // On a labelled angle the label itself holds bodies off the line.
  const ic = (asc + 90) % 360;
  const axisPieces = (longitude, mode) => {
    const recordedLines = [];
    const draw = new drawChart.CanvasDraw(recordingCanvas([], recordedLines));
    draw.resize(size, size, 1);
    drawChart.drawSnapshotLayer(
      draw,
      {
        primaryChart: {
          planets: [
            { id: "sun", longitude, glyph: "A", degText: "10", minText: "54" },
            { id: "saturn", longitude: 250.4, glyph: "G", degText: "10", minText: "24" },
          ],
          angles: { asc, dsc: asc + 180, mc: (asc + 270) % 360, ic },
          houses: { cusps: Array.from({ length: 12 }, (_, index) => (asc + index * 30) % 360) },
          aspects: [],
          options: {
            theme: 2, signVariant: 1, showHouses: true, showPositions: true,
            showTerms: true, showDecans: false, showCusplessAscMcLabels: true,
            angloDenseLabelLayout: mode,
          },
        },
        displayDatetime: "2026-04-15T18:37:42+01:00",
        renderVariant: "round-anglo",
        overlayRenderMode: "full",
        outerRingMode: "none",
      },
      "geometry",
      { width: size, height: size, chartSize: size, renderStyle: DEFAULT_WHEEL_RENDER_STYLE },
    );
    const bearingOf = (point) =>
      (((Math.atan2(centre[1] - point[1], point[0] - centre[0]) * 180) / Math.PI) + 360) % 360;
    const radiusOf = (point) => Math.hypot(point[0] - centre[0], point[1] - centre[1]);
    const axis = ((180 + (ic - asc)) % 360 + 360) % 360;
    const onAxis = (point) => {
      const delta = Math.abs(bearingOf(point) - axis);
      return Math.min(delta, 360 - delta) < 0.8;
    };
    return recordedLines
      .filter((line) =>
        onAxis(line.from) &&
        onAxis(line.to) &&
        Math.abs(radiusOf(line.from) - radiusOf(line.to)) > 3
      )
      .map((line) => [
        Math.min(radiusOf(line.from), radiusOf(line.to)),
        Math.max(radiusOf(line.from), radiusOf(line.to)),
      ])
      .sort((left, right) => left[0] - right[0]);
  };
  // The axis already carries structural gaps that exist with nothing on it.
  // Only the gaps the body introduced are the notch.
  const gapsOf = (pieces) => {
    const gaps = [];
    for (let index = 1; index < pieces.length; index += 1) {
      const gap = pieces[index][0] - pieces[index - 1][1];
      if (gap > 0.5) gaps.push(Number(gap.toFixed(1)));
    }
    return gaps;
  };

  const clear = axisPieces(ic + 12, "sign-locked");
  const occupied = axisPieces(ic + 0.1, "sign-locked");
  assert.ok(
    occupied.length > clear.length,
    `a glyph standing on an angle must notch it (clear ${clear.length}, occupied ${occupied.length})`,
  );
  assert.deepEqual(
    axisPieces(ic + 12, "routed-cusps"),
    clear,
    "an angle with nothing on it is painted identically in both modes",
  );
  // The notch is the glyph's own extent, not the label column's. A column-wide
  // hole reads as broken paint on a line that carries an arrowhead.
  const structural = gapsOf(clear);
  const notch = gapsOf(occupied).filter((gap) => !structural.includes(gap));
  assert.ok(notch.length >= 1, "the notch must be measurable");
  const widest = Math.max(...notch);
  assert.ok(
    widest < 70,
    `the notch must stay near the glyph's own size, measured ${widest.toFixed(1)}px`,
  );
});

test('factory and custom Cusp subdivisions paint and hit the same allocated bands', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  for (const {ids, customized} of [
    {ids: ['terms','decans','cuspLabels','bodies','houses','hub'], customized: false},
    {ids: ['terms','decans','cuspLabels','bodies','houses','hub'], customized: true},
    {ids: ['decans','terms','cuspLabels','bodies','houses','hub'], customized: true},
  ]) {
    const composition = {schemaVersion: 1, customized, projection: 'zodiac',
      rings: ids.map(archetypeId => ({archetypeId, instanceId: `cusps-${archetypeId}`, enabled: true, chartRole: 'primary'}))};
    const chart = {
      meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 17, dsc: 197, mc: 102, ic: 282},
      houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
      options: {theme: 4, wheelComposition: composition, showPositions: false, showHouses: true,
        showTerms: false, showDecans: false, showAspects: false, signVariant: 1,
        terms: [[{size: 8, boundaryLon: 8, rulerLon: 4, rulerGlyph: 'T'}]],
        decans: [{rulers: [{rulerLon: 15, rulerGlyph: 'D'}]}]},
    };
    const snapshot = {primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full', renderVariant: 'round-cusps'};
    const style = !customized ? DEFAULT_WHEEL_RENDER_STYLE : {...DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      ringWidths: {cusps: {'cusps-terms': 14, 'cusps-decans': 18}},
    }};
    const text = [], lines = [];
    const draw = new renderer.CanvasDraw(recordingCanvas(text, lines));
    draw.resize(800, 800, 1);
    const options = {width: 800, height: 800, chartSize: 800, renderStyle: style};
    renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', options);
    renderer.drawSnapshotLayer(draw, snapshot, 'geometry', options);
    const regions = renderer.computeHitRegions(snapshot, {...options, includeStyleTargets: true,
      textsize: (value, opts) => draw.textsize(value, opts)});
    for (const [family, glyph] of [['term', 'T'], ['decan', 'D']]) {
      const paint = text.find(item => item.text === glyph);
      const target = regions.find(item => item.kind === 'subdivision' && item.family === family && item.component === 'glyph');
      assert.ok(paint, `${family} paints on the identity-projected Cusp wheel`);
      assert.ok(target, `${family} has a style hit target`);
      const pad = Math.max(2, paint.fontSize * .12);
      assert.ok(Math.abs(target.left - (paint.x - pad)) < 1);
      assert.ok(Math.abs(target.top - (paint.y - pad)) < 1);
      assert.ok(Math.abs(target.width - (paint.w + 2 * pad)) < 1);
      const boundary = regions.find(item => item.kind === 'subdivision' && item.family === family && item.component === 'boundary');
      assert.ok(Math.hypot(boundary.x2-boundary.x1, boundary.y2-boundary.y1) > 1,
        `${family} has a real radial band rather than a collapsed outer-circle target`);
      // CanvasDraw snaps each coordinate to a device pixel at DPR 1.
      const samePoint = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]) <= Math.SQRT1_2;
      assert.ok(lines.some(line =>
        (samePoint(line.from, [boundary.x1, boundary.y1]) && samePoint(line.to, [boundary.x2, boundary.y2])) ||
        (samePoint(line.to, [boundary.x1, boundary.y1]) && samePoint(line.from, [boundary.x2, boundary.y2]))));
    }
    const hidden = {...chart, options: {...chart.options, wheelComposition: {...composition,
      rings: composition.rings.map(r => r.archetypeId === 'terms' ? {...r, enabled: false} : r)}}};
    const hiddenRegions = renderer.computeHitRegions({...snapshot, primaryChart: hidden}, {...options, includeStyleTargets: true});
    assert.ok(!hiddenRegions.some(item => item.kind === 'subdivision' && item.family === 'term'));
  }
});

test('edited Anglo transit composition keeps paint, hit targets and outer-house visibility coherent', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  for (const width of [4, 28, 100]) for (const showOuterHouses of [false,true])
  for (const showOuterBodies of [false,true]) {
    const composition = {schemaVersion: 1, customized: true, projection: 'zodiac',
      rings: ['outerBodies','outerHouses','zodiac','degree','bodies','houses','hub'].map(archetypeId => ({
        archetypeId, instanceId: `anglo-${archetypeId}`,
        enabled: archetypeId !== 'outerBodies' || showOuterBodies,
        chartRole: archetypeId.startsWith('outer') ? 'outer' : 'primary',
      }))};
    const primary = {
      meta: {cornerLines: {}}, aspects: [],
      planets: [{id: 'sun', longitude: 45, glyph: 'A', motion: '', degText: '15', minText: '00'}],
      angles: {asc: 0, dsc: 180, mc: 90, ic: 270},
      houses: {cusps: Array.from({length: 12}, (_, i) => i*30)},
      options: {theme: 2, wheelComposition: composition, showHouses: true, showPositions: true,
        showOuterHouseLines: showOuterHouses, showAspects: false, signVariant: 1,
        showTerms: false, showDecans: false},
    };
    // The framework owns presentation even if the source chart carries an older recipe.
    const secondary = {...primary, planets: [{id: 'moon', longitude: 220, glyph: 'B', motion: '', degText: '10', minText: '00'}],
      options: {...primary.options, wheelComposition: undefined}};
    const snapshot = {primaryChart: primary, comparisonChart: secondary, outerRingMode: 'none',
      overlayRenderMode: 'full', renderVariant: 'round-anglo'};
    const style = {...DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      ringWidths: {anglo: {'anglo-degree': width}},
    }};
    const geometry = renderer.wheelGeometryInputForSnapshot(snapshot,400);
    assert.equal(geometry.showOuterHouses, showOuterHouses);
    const rings = resolveWheelRingSet(style, geometry);
    const layout = resolveWheelBandLayout(style, geometry, rings);
    const text=[], lines=[];
    const draw = new renderer.CanvasDraw(recordingCanvas(text,lines));
    draw.resize(800,800,1);
    const renderOptions={width:800,height:800,chartSize:800,renderStyle:style};
    renderer.drawSnapshotLayer(draw,snapshot,'dynamic',renderOptions);
    const targets=renderer.computeHitRegions(snapshot,{...renderOptions,includeStyleTargets:true,
      textsize:(text,opts)=>draw.textsize(text,opts)});
    for (const [id,glyph,outerTrack] of [['sun','A',false],['moon','B',true]]) {
      const expected=!outerTrack || showOuterBodies;
      const painted=text.find(item=>item.text===glyph);
      const target=targets.find(item=>item.kind==='planet' && item.planetId===id);
      assert.equal(Boolean(painted),expected,`paint ${id}, outer=${showOuterBodies}`);
      assert.equal(Boolean(target),expected,`hit ${id}, outer=${showOuterBodies}`);
      if (painted) {
        assert.ok(painted.x>=0 && painted.y>=0 && painted.x+painted.w<=800 && painted.y+painted.h<=800);
        assert.ok(Math.abs(target.x-(painted.x+painted.fontSize/2))<1);
        assert.ok(Math.abs(target.y-(painted.y+painted.fontSize/2))<1);
      }
    }
    const houseBand=layout.bands.find(b=>b.id==='outerHouses');
    const houseTargets=targets.filter(item=>item.kind==='style_target' && item.classId==='houses.outer.cusp');
    assert.equal(houseTargets.length,houseBand?12:0);
    if (houseBand) for (const target of houseTargets) {
      assert.ok(Math.abs(Math.hypot(target.x1-400,target.y1-400)-houseBand.inner)<1e-6);
      assert.ok(Math.abs(Math.hypot(target.x2-400,target.y2-400)-houseBand.outer)<1e-6,
        `${width}/${showOuterHouses}/${showOuterBodies}: outer-house target must end at its band`);
    }
  }
});

test('Anglo rulers and annotation paint and hits remain independent of each other and houses', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const rulerColor = '#246abc', markerColor = '#b7236c', degreeColor = '#51bca4';
  for (const profile of ['anglo', 'houses', 'cusps']) {
    const style = createWheelRenderStyle({
      palette: DEFAULT_WHEEL_RENDER_STYLE.palette,
      authoringTargetProfile: profile,
      authoringOverrides: {...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides, linePaint: {
        [profile]: {
          'zodiac.tick.inner.1deg': {color: degreeColor},
          'zodiac.tick.inner.5deg': {color: degreeColor},
          'zodiac.tick.inner.10deg': {color: degreeColor},
          'zodiac.tick.outer.1deg': {color: degreeColor},
          'zodiac.tick.outer.5deg': {color: degreeColor},
          'zodiac.tick.outer.10deg': {color: degreeColor},
          'zodiac.tick.angloCuspRuler.1deg': {color: rulerColor},
          'zodiac.tick.angloCuspRuler.5deg': {color: rulerColor},
          'zodiac.tick.angloCuspRuler.10deg': {color: rulerColor},
          'zodiac.tick.angloHouseCusp': {color: markerColor},
        },
      }},
    });
    for (const houses of [false, true]) for (const labels of [false, true])
    for (const ruler of profile === 'houses' ? [false] : [false, true])
    for (const degree of profile === 'anglo' ? [false, true] : [false])
    for (const arrangement of ['single', 'transit', 'synastry']) {
      const original = WHEEL_FACTORY_SETTINGS.layouts[profile].composition;
      const composition = {...original, rings: original.rings.map(ring => ({...ring,
        enabled: ring.archetypeId === 'degree' ? degree : ring.archetypeId === 'houses' ? houses
          : ring.archetypeId === 'cuspLabels' ? labels
          : ring.archetypeId === 'cuspRuler' ? ruler : ring.enabled,
      }))};
      const chart = {
        meta: {cornerLines: {}}, planets: [], aspects: [],
        angles: {asc: 11.5, dsc: 191.5, mc: 281.5, ic: 101.5},
        houses: {cusps: Array.from({length: 12}, (_, index) => 11.5 + index * 30),
          cuspDegMin: Array.from({length: 12}, () => ({degText: '11', minText: '30'}))},
        options: {theme: WHEEL_FACTORY_SETTINGS.layouts[profile].optionValue,
          wheelComposition: composition, showHouses: houses, showPositions: false,
          showTerms: false, showDecans: false, showAspects: false, showSymbols: false,
          showCusplessAscMcLabels: false, showOuterHouseLines: true, signVariant: 1},
      };
      const snapshot = {primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full',
        renderVariant: `round-${profile}`,
        ...(arrangement === 'single' ? {} : {comparisonChart: chart,
          document: {compoundKind: arrangement}}),
      };
      const text = [], lines = [];
      const draw = new renderer.CanvasDraw(recordingCanvas(text, lines));
      draw.resize(800, 800, 1);
      const options = {width: 800, height: 800, chartSize: 800, renderStyle: style};
      renderer.drawSnapshotLayer(draw, snapshot, 'geometry', options);
      renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', options);
      const regions = renderer.computeHitRegions(snapshot, {...options, includeStyleTargets: true,
        textsize: (value, paint) => draw.textsize(value, paint)});
      const context = `${profile}/${arrangement}/houses=${houses}/labels=${labels}/ruler=${ruler}/degree=${degree}`;
      assert.equal(text.filter(item => item.text === '11°').length, labels ? 12 : 0,
        `${context}: cusp annotations paint independently`);
      assert.equal(regions.filter(item => item.kind === 'style_target'
        && item.classId === 'houses.inner.position.degree').length, labels ? 12 : 0,
      `${context}: annotation hits follow the painted annotations`);
      assert.equal(lines.some(item => item.strokeStyle === rulerColor), ruler,
        `${context}: zodiac ruler paint follows its own band`);
      if (profile === 'anglo') {
        const degreeLines = lines.filter(item => item.strokeStyle === degreeColor);
        assert.equal(degreeLines.length, degree ? 360 : 0,
          `${context}: the degree ruler obeys its checkbox independently of the cusp ruler`);
        for (const line of lines.filter(item => item.strokeStyle === rulerColor)) {
          assert.ok(Math.hypot(line.to[0] - 400, line.to[1] - 400)
            < Math.hypot(line.from[0] - 400, line.from[1] - 400),
          `${context}: allocated cusp ticks retain their inward direction when other instruments hide`);
        }
      }
      const markers = ruler || (profile !== 'anglo' && labels);
      assert.equal(lines.filter(item => item.strokeStyle === markerColor).length, markers ? 8 : 0,
        `${context}: non-angular cusp markers follow their ruler or cusp-only annotation band`);
    }
  }
});

test('Classic and Compact cusp annotations retain their existing houses visibility gate', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  for (const profile of ['classic', 'compact']) for (const houses of [false, true]) {
    const original = WHEEL_FACTORY_SETTINGS.layouts[profile].composition;
    const chart = {
      meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 11.5, dsc: 191.5, mc: 281.5, ic: 101.5},
      houses: {cusps: Array.from({length: 12}, (_, index) => 11.5 + index * 30),
        cuspDegMin: Array.from({length: 12}, () => ({degText: '11', minText: '30'}))},
      options: {theme: WHEEL_FACTORY_SETTINGS.layouts[profile].optionValue,
        wheelComposition: {...original, rings: original.rings.map(ring => ring.archetypeId === 'houses'
          ? {...ring, enabled: houses} : ring)}, showHouses: houses, showPositions: true,
        showTerms: false, showDecans: false, showAspects: false, showSymbols: false, signVariant: 1},
    };
    const text = [];
    const draw = new renderer.CanvasDraw(recordingCanvas(text));
    draw.resize(800, 800, 1);
    const snapshot = {primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full', renderVariant: `round-${profile}`};
    const options = {width: 800, height: 800, chartSize: 800, renderStyle: DEFAULT_WHEEL_RENDER_STYLE};
    renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', options);
    const regions = renderer.computeHitRegions(snapshot, {...options, includeStyleTargets: true,
      textsize: (value, paint) => draw.textsize(value, paint)});
    assert.equal(text.filter(item => item.text === (profile === 'compact' ? '11°' : '11')).length,
      houses ? 4 : 0, `${profile}: annotation paint follows houses visibility`);
    assert.equal(regions.filter(item => item.kind === 'style_target'
      && item.classId === 'houses.inner.position.degree').length, houses ? 4 : 0);
  }
});

test('saving an original band at its current width preserves production paint and hits', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps']) {
    for (const arrangement of ['single', 'transit', 'synastry']) {
      const composition = WHEEL_FACTORY_SETTINGS.layouts[profile].composition;
      const primary = {
        meta: {cornerLines: {}}, aspects: [],
        planets: [{id: 'sun', longitude: 45, glyph: 'A', motion: '', degText: '15', minText: '00'},
          {id: 'moon', longitude: 220, glyph: 'B', motion: 'R', degText: '10', minText: '00'}],
        angles: {asc: 11.5, dsc: 191.5, mc: 281.5, ic: 101.5},
        houses: {cusps: Array.from({length: 12}, (_, index) => 11.5 + index * 30),
          cuspDegMin: Array.from({length: 12}, () => ({degText: '11', minText: '30'}))},
        options: {theme: WHEEL_FACTORY_SETTINGS.layouts[profile].optionValue,
          wheelComposition: composition, showHouses: true, showPositions: true,
          showOuterHouseLines: true, showTerms: false, showDecans: false,
          showAspects: false, showSymbols: false, signVariant: 1},
      };
      const snapshot = {primaryChart: primary, outerRingMode: 'none', overlayRenderMode: 'full',
        renderVariant: `round-${profile}`,
        ...(arrangement === 'single' ? {} : {comparisonChart: {...primary,
          planets: [{id: 'mercury', longitude: 130, glyph: 'C', motion: '', degText: '10', minText: '00'}]},
        document: {compoundKind: arrangement}}),
      };
      const geometry = renderer.wheelGeometryInputForSnapshot(snapshot, 400);
      const original = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, geometry);
      const bands = resolveWheelBandLayout(DEFAULT_WHEEL_RENDER_STYLE, geometry, original).bands;
      const record = style => {
        const text = [], lines = [];
        const draw = new renderer.CanvasDraw(recordingCanvas(text, lines));
        draw.resize(800, 800, 1);
        const options = {width: 800, height: 800, chartSize: 800, renderStyle: style};
        renderer.drawSnapshotLayer(draw, snapshot, 'geometry', options);
        renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', options);
        const hits = renderer.computeHitRegions(snapshot, {...options, includeStyleTargets: true,
          textsize: (value, paint) => draw.textsize(value, paint)});
        return {paint: fingerprint({text, lines}), hits: fingerprint(hits)};
      };
      const expected = record(DEFAULT_WHEEL_RENDER_STYLE);
      for (const instance of composition.rings) {
        const band = bands.find(item => item.id === instance.archetypeId);
        if (!instance.enabled || instance.archetypeId === 'hub' || !band?.visible || band.outer <= band.inner) continue;
        const style = {...DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
          ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
          ringWidths: {[profile]: {[instance.instanceId]: band.outer - band.inner}},
        }};
        assert.deepEqual(record(style), expected,
          `${profile}/${arrangement}/${instance.archetypeId}: a no-op width must preserve every line, glyph, and hit target`);
      }
    }
  }
});

test('open transit body and house width controls move their production paint and matching hits', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for (const profile of ['anglo', 'houses', 'cusps']) for (const customized of [false, true]) {
    const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts[profile].composition);
    if (customized) {
      [composition.rings[0], composition.rings[1]] = [composition.rings[1], composition.rings[0]];
      composition.customized = true;
    }
    const primary = {
      meta: {cornerLines: {}}, aspects: [],
      planets: [{id: 'sun', longitude: 45, glyph: 'A', motion: '', degText: '15', minText: '00'}],
      angles: {asc: 11.5, dsc: 191.5, mc: 281.5, ic: 101.5},
      houses: {cusps: Array.from({length: 12}, (_, index) => 11.5 + index * 30)},
      options: {theme: WHEEL_FACTORY_SETTINGS.layouts[profile].optionValue,
        wheelComposition: composition, showHouses: true, showPositions: false,
        showOuterHouseLines: true, showTerms: false, showDecans: false,
        showAspects: false, showSymbols: false, signVariant: 1},
    };
    const snapshot = {primaryChart: primary, comparisonChart: {...primary,
      planets: [{id: 'mercury', longitude: 130, glyph: 'C', motion: 'R', degText: '10', minText: '00'}]},
    document: {compoundKind: 'transit'}, outerRingMode: 'none', overlayRenderMode: 'full', renderVariant: `round-${profile}`};
    const geometry = renderer.wheelGeometryInputForSnapshot(snapshot, 400);
    const original = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, geometry);
    const bands = resolveWheelBandLayout(DEFAULT_WHEEL_RENDER_STYLE, geometry, original).bands;
    const record = style => {
      const text = [], lines = [];
      const draw = new renderer.CanvasDraw(recordingCanvas(text, lines));
      draw.resize(800, 800, 1);
      const options = {width: 800, height: 800, chartSize: 800, renderStyle: style};
      renderer.drawSnapshotLayer(draw, snapshot, 'geometry', options);
      renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', options);
      const hits = renderer.computeHitRegions(snapshot, {...options, includeStyleTargets: true,
        textsize: (value, paint) => draw.textsize(value, paint)});
      return {fingerprint: fingerprint({text, lines, hits}), lines,
        primary: text.find(item => item.text === 'A'), outer: text.find(item => item.text === 'C'),
        primaryHit: hits.find(item => item.kind === 'planet' && item.planetId === 'sun'),
        outerHit: hits.find(item => item.kind === 'planet' && item.planetId === 'mercury'),
        houseHits: hits.filter(item => item.kind === 'style_target' && item.classId === 'houses.outer.cusp')};
    };
    const before = record(DEFAULT_WHEEL_RENDER_STYLE);
    assert.ok(before.primary && before.outer && before.primaryHit && before.outerHit);
    assert.equal(before.houseHits.length, 12);
    for (const kind of ['outerBodies', 'outerHouses']) {
      const band = bands.find(item => item.id === kind);
      const instance = composition.rings.find(ring => ring.archetypeId === kind);
      const makeStyle = width => ({...DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
        ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides, ringWidths: {[profile]: {[instance.instanceId]: width}},
      }});
      const context = `${profile}/${customized ? 'custom' : 'original'}/${kind}`;
      assert.equal(record(makeStyle(band.outer - band.inner)).fingerprint, before.fingerprint,
        `${context}: current width preserves paint and hits`);
      const after = record(makeStyle(band.outer - band.inner - 5));
      assert.deepEqual(after.primary, before.primary, `${context}: radix glyph does not move`);
      assert.deepEqual(after.primaryHit, before.primaryHit, `${context}: radix hit target does not move`);
      if (kind === 'outerBodies') {
        assert.notDeepEqual(after.outer, before.outer, `${context}: the body glyph moves with its lane`);
        assert.notDeepEqual(after.outerHit, before.outerHit, `${context}: the body hit target moves with its lane`);
        assert.ok(Math.abs(after.outerHit.x - (after.outer.x + after.outer.fontSize / 2)) < 1);
        assert.ok(Math.abs(after.outerHit.y - (after.outer.y + after.outer.fontSize / 2)) < 1);
        assert.deepEqual(after.houseHits, before.houseHits, `${context}: outer house rays do not move`);
      } else {
        assert.deepEqual(after.outer, before.outer, `${context}: outer body glyph does not move`);
        assert.deepEqual(after.outerHit, before.outerHit, `${context}: outer body hit target does not move`);
        assert.notDeepEqual(after.houseHits, before.houseHits, `${context}: house-cusp endpoints move`);
        const samePoint = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= Math.SQRT1_2;
        for (const hit of after.houseHits) {
          assert.ok(after.lines.some(line => samePoint(line.from, [hit.x1, hit.y1])
            && samePoint(line.to, [hit.x2, hit.y2])), `${context}: each moved house hit matches a painted ray`);
        }
      }
    }
  }
});

test('projected outer rings paint exactly the normal outer-ring labels', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const families = [['dodecatemoria', 'dodecatemoria'], ['antiscia', 'antiscia'],
    ['contra_antiscia', 'contra_antiscia'], ['asteroids', 'asteroid'],
    ['arabic_parts', 'arabic_part'], ['midpoints', 'midpoint'], ['fixstars', 'fixstar']];
  for (const theme of [0, 1, 2, 3, 4]) for (const comparison of [false, true])
  for (const showOuterPositions of [false, true]) for (const [mode, family] of families) {
    const chart = {
      meta: { cornerLines: {} }, planets: [], aspects: [],
      angles: { asc: 0, dsc: 180, mc: 270, ic: 90 },
      houses: { system: 'P', cusps: Array.from({length: 12}, (_, i) => i * 30) },
      options: { theme, showHouses: true, showPositions: false, showOuterPositions,
        showTerms: false, showDecans: false, showAspects: false, showSymbols: false, signVariant: 1 },
    };
    const glyphs = ['dodecatemoria', 'antiscia', 'contra_antiscia'].includes(family);
    const items = [0, 1, 89, 180, 269, 359].map((longitude, index) => ({
      id: `point-${index}`, family, longitude, label: `Point ${index}`, role: comparison ? 'outer' : 'primary',
      degText: '12', minText: '34',
      segments: glyphs ? [{text: 'A', kind: 'glyph'}] : family === 'midpoint'
        ? [{text: 'A', kind: 'glyph'}, {text: '/', kind: 'text'}, {text: 'B', kind: 'glyph'}] : undefined,
    }));
    const snapshot = { primaryChart: chart, comparisonChart: comparison ? chart : undefined,
      outerRingMode: mode, outerRingItems: {[mode]: items}, overlayRenderMode: 'full' };
    const opts = {width: 1000, height: 800, chartSize: 700, renderStyle: DEFAULT_WHEEL_RENDER_STYLE};
    const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, renderer.wheelGeometryInputForSnapshot(snapshot, 350));
    const scene = renderer.resolveProjectedOuterRing(snapshot, opts,
      { chart, items, frame: renderer.identityFrame(0), boundaryRadius: rings.r30 });
    const expected = [], actual = [], hits = [];
    const normalDraw = new renderer.CanvasDraw(recordingCanvas(expected));
    const projectedDraw = new renderer.CanvasDraw(recordingCanvas(actual));
    normalDraw.resize(opts.width, opts.height, 1);
    projectedDraw.resize(opts.width, opts.height, 1);
    renderer.drawSnapshotLayer(normalDraw, snapshot, 'outer-label', opts);
    renderer.paintProjectedOuterRing(projectedDraw, scene, (item, box) => hits.push({id: item.id, box}));
    assert.deepEqual(actual, expected, `theme=${theme} comparison=${comparison} positions=${showOuterPositions} family=${family}`);
    assert.equal(hits.length, items.length);
    assert.ok(hits.every(({box}) => Object.values(box).every(Number.isFinite)));
    const moved = renderer.resolveProjectedOuterRing(snapshot, opts,
      { chart, items: items.map(item => ({...item, longitude: item.longitude + 11})),
        frame: renderer.identityFrame(0), boundaryRadius: rings.r30 });
    assert.equal(moved.paintRadius, scene.paintRadius, 'stepping cannot change the fit budget');
  }
});

test('outermost cusp annotations leave the zodiac rim open without losing labels or hits', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  for (const [profile, theme] of [['anglo', 2], ['houses', 3], ['cusps', 4]]) {
    for (const arrangement of ['single', 'transit', 'synastry']) for (const outside of [false, true]) {
      const primaryIds = outside ? ['cuspLabels', 'zodiac'] : ['zodiac', 'cuspLabels'];
      const composition = {schemaVersion: 1, customized: true, projection: profile === 'houses' ? 'houses' : 'zodiac',
        rings: ['outerBodies', 'outerHouses', ...primaryIds, 'bodies', 'houses', 'hub'].map(archetypeId => ({
          archetypeId, instanceId: `test-${archetypeId}`, enabled: true,
          chartRole: archetypeId.startsWith('outer') ? 'outer' : 'primary',
        }))};
      const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
        angles: {asc: 11.5, dsc: 191.5, mc: 281.5, ic: 101.5},
        houses: {cusps: Array.from({length: 12}, (_, i) => 11.5 + i * 30),
          cuspDegMin: Array.from({length: 12}, () => ({degText: '11', minText: '30'}))},
        options: {theme, wheelComposition: composition, showHouses: true, showPositions: true,
          showTerms: false, showDecans: false, showAspects: false, showSymbols: false,
          showOuterHouseLines: true, signVariant: 1}};
      const snapshot = {primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full',
        renderVariant: `round-${profile}`, ...(arrangement === 'single' ? {} : {
          comparisonChart: chart, document: {compoundKind: arrangement}})};
      const style = DEFAULT_WHEEL_RENDER_STYLE;
      const geometry = renderer.wheelGeometryInputForSnapshot(snapshot, 400);
      const rings = resolveWheelRingSet(style, geometry);
      const bands = resolveWheelBandLayout(style, geometry, rings).bands;
      const labels = bands.find(b => b.id === 'cuspLabels');
      const zodiac = bands.find(b => b.id === 'zodiac');
      const text = [], circles = [];
      const draw = new renderer.CanvasDraw(recordingCanvas(text));
      draw.resize(800, 800, 1);
      const circle = draw.circle.bind(draw);
      draw.circle = (center, radius, paint) => { circles.push(radius); circle(center, radius, paint); };
      const options = {width: 800, height: 800, chartSize: 800, renderStyle: style};
      renderer.drawSnapshotLayer(draw, snapshot, 'geometry', options);
      renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', options);
      const hits = renderer.computeHitRegions(snapshot, {...options, includeStyleTargets: true,
        textsize: (value, paint) => draw.textsize(value, paint)});
      const context = `${profile}/${arrangement}/outside=${outside}`;
      assert.equal(circles.includes(labels.outer), !outside || arrangement === 'synastry', context);
      assert.ok(circles.includes(zodiac.outer), `${context}: zodiac rim remains painted`);
      assert.equal(text.filter(item => item.text === '11°').length, 12, `${context}: annotations remain painted`);
      assert.equal(hits.filter(item => item.kind === 'style_target'
        && item.classId === 'houses.inner.position.degree').length, 12, `${context}: annotations remain selectable`);
    }
  }
});

test('Paper radii reserve secondary glyph and house lanes in transit and synastry', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const factoryComposition = profile => structuredClone(WHEEL_FACTORY_SETTINGS.layouts[profile].composition);
  const paper = {zodiacOuterRing: 379.1, zodiacInnerRing: 348.1, termRing: 335.1,
    cuspOuterRing: 321.4, innerBoundaryRing: 299.1, houseBoundaryRing: 211, baseRing: 190.6};
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps'])
  for (const maxRadius of [180, 400, 650]) for (const arrangement of ['transit', 'synastry'])
  for (const subdivisions of [false, true]) {
    const composition = factoryComposition(profile);
    for (const ring of composition.rings) if (['terms', 'decans'].includes(ring.archetypeId)) ring.enabled = subdivisions;
    const style = {...DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides, ringRadii: {[profile]: paper},
    }};
    const primary = {meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, dsc: 180, mc: 90, ic: 270},
      houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
      options: {theme: ['classic','compact','anglo','houses','cusps'].indexOf(profile),
        wheelComposition: composition, showHouses: true, showPositions: false,
        showOuterHouseLines: true, showTerms: subdivisions, showDecans: subdivisions,
        showAspects: false, signVariant: 1}};
    const snapshot = {primaryChart: primary, comparisonChart: primary, outerRingMode: 'none',
      document: {compoundKind: arrangement}, renderVariant: `round-${profile}`, overlayRenderMode: 'full'};
    const input = renderer.wheelGeometryInputForSnapshot(snapshot, maxRadius);
    const saved = JSON.stringify(style);
    const rings = resolveWheelRingSet(style, input);
    const bands = resolveWheelBandLayout(style, input, rings).bands;
    const rim = Math.max(...bands.filter(b => b.visible && !b.overlay && b.id !== 'margin'
      && !b.id.startsWith('outer')).map(b => b.outer));
    const typography = resolveWheelTypographyMetrics(style, profile, maxRadius);
    const size = input.restrainedAngloComparison ? Math.max(typography.bodySize, typography.outerSize) : typography.outerSize;
    const label = `${profile}/${maxRadius}/${arrangement}/${subdivisions}`;
    assert.ok(rings.rOuterPlanet - size / Math.SQRT2 >= rim - 1e-7, `${label}: glyph box clears primary rim`);
    if (rings.rOuterHouseName != null) {
      assert.ok(rings.rOuterHouseName - typography.outerHouseLabelSize / 2
        >= rings.rOuterPlanet + size / 2 - 1e-7, `${label}: house numbers clear bodies`);
    }
    for (const band of bands) assert.ok(band.outer >= band.inner, `${label}: ${band.id} is not inverted`);
    const bodyBand = bands.find(b => b.id === 'outerBodies');
    assert.ok(bodyBand && rings.rOuterPlanet > bodyBand.inner && rings.rOuterPlanet < bodyBand.outer, label);
    assert.equal(JSON.stringify(style), saved, 'rendering never rewrites saved geometry');
    const sameWidthStyle = {...style, authoringOverrides: {...style.authoringOverrides,
      ringWidths: {[profile]: {[bodyBand.instanceId]: (bodyBand.outer - bodyBand.inner) * 400 / maxRadius}}}};
    const sameWidth = resolveWheelRingSet(sameWidthStyle, input);
    for (const [field, value] of Object.entries(rings)) if (typeof value === 'number') {
      assert.ok(Math.abs(sameWidth[field] - value) < 1e-6, `${label}: saving current outer width moves ${field}`);
    }
    if (profile === 'anglo' && maxRadius === 400 && subdivisions) {
      for (const scale of [0.899149, 0.942016]) for (const longitude of [0,45,90,135,180,225,270,315]) {
        const paintStyle = {...style, authoringOverrides: {...style.authoringOverrides, wheelScale: {anglo: scale}}};
        const paintedSnapshot = {...snapshot, comparisonChart: {...primary, planets: [
          {id: 'moon', longitude, glyph: 'B', motion: '', degText: '15', minText: '00'},
        ]}};
        const envelope = renderer.resolveChartOuterPaintEnvelope(paintedSnapshot, paintStyle);
        const chartSize = 800 / Math.max(1, envelope.paintRadiusScale);
        const options = {width: 800, height: 800, chartSize, renderStyle: paintStyle};
        const actualRadius = chartSize * scale / 2;
        const actualRings = resolveWheelRingSet(paintStyle, {...input, maxRadius: actualRadius});
        const text = [];
        const draw = new renderer.CanvasDraw(recordingCanvas(text));
        draw.resize(800, 800, 1);
        renderer.drawSnapshotLayer(draw, paintedSnapshot, 'dynamic', options);
        const glyph = text.find(item => item.text === 'B');
        assert.ok(glyph, `${label}: outer body is painted`);
        const dx = Math.max(glyph.x - 400, 0, 400 - glyph.x - glyph.w);
        const dy = Math.max(glyph.y - 400, 0, 400 - glyph.y - glyph.h);
        assert.ok(Math.hypot(dx, dy) >= actualRings.r30 - 1, `${label}: painted glyph overlaps rim at ${longitude}`);
        assert.ok(glyph.x >= 0 && glyph.y >= 0 && glyph.x + glyph.w <= 800 && glyph.y + glyph.h <= 800,
          `${label}: fitted glyph clips canvas at ${longitude}`);
        const hit = renderer.computeHitRegions(paintedSnapshot, {...options,
          textsize: (value, paint) => draw.textsize(value, paint)}).find(item => item.kind === 'planet' && item.planetId === 'moon');
        assert.ok(hit && Math.abs(hit.x - glyph.x - glyph.fontSize / 2) <= 1
          && Math.abs(hit.y - glyph.y - glyph.fontSize / 2) <= 1, `${label}: paint and selection agree`);
      }
    }
  }
});

test('exterior leaders attach to the visible rim in paint, hits, and projected views', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const {wheelOuterAttachmentRadius} = await import(layoutModelUrl);
  for (const [profile, theme] of [['anglo', 2], ['houses', 3], ['cusps', 4]])
  for (const arrangement of ['auxiliary', 'transit', 'synastry'])
  for (const family of ['fallback', 'fixstar', 'antiscia']) {
    const composition = {schemaVersion: 1, customized: true, projection: profile === 'houses' ? 'houses' : 'zodiac',
      rings: ['outerHouses', 'outerBodies', 'cuspLabels', 'zodiac', 'bodies', 'houses', 'hub'].map(archetypeId => ({
        archetypeId, instanceId: `${profile}-${archetypeId}`, enabled: true,
        chartRole: archetypeId.startsWith('outer') ? 'outer' : 'primary',
      }))};
    const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
      houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
      fixedStars: family === 'fallback' ? [{name: 'Reference star', longitude: 125}] : [],
      options: {theme, wheelComposition: composition, showHouses: true, showPositions: false,
        showOuterHouseLines: true, showTerms: false, showDecans: false, showAspects: false,
        showSymbols: false, signVariant: 1}};
    const mode = family === 'antiscia' ? 'antiscia' : 'fixstars';
    const items = family === 'fallback' ? [] : [{id: 'reference', family, longitude: 125, label: 'Reference',
      segments: family === 'antiscia' ? [{text: 'A', kind: 'glyph'}] : undefined}];
    const snapshot = {primaryChart: chart, outerRingMode: mode, outerRingItems: {[mode]: items},
      overlayRenderMode: 'full', renderVariant: `round-${profile}`,
      ...(arrangement === 'auxiliary' ? {} : {comparisonChart: chart, document: {compoundKind: arrangement}})};
    const style = DEFAULT_WHEEL_RENDER_STYLE;
    const rings = resolveWheelRingSet(style, renderer.wheelGeometryInputForSnapshot(snapshot, 400));
    const support = wheelOuterAttachmentRadius(rings);
    assert.ok(rings.rPosHouses > rings.r30, 'fixture must put cusp annotations outside zodiac');
    assert.equal(support, arrangement === 'synastry' ? resolveWheelBandLayout(style,
      renderer.wheelGeometryInputForSnapshot(snapshot, 400), rings).bands.find(b => b.id === 'cuspLabels').outer : rings.r30,
      'leaders attach to the visible rim; enclosed synastry retains its enclosing band');
    const lines = [], draw = new renderer.CanvasDraw(recordingCanvas([], lines));
    draw.resize(800, 800, 1);
    const opts = {width: 800, height: 800, chartSize: 800, renderStyle: style};
    renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', opts);
    const hits = renderer.computeHitRegions(snapshot, {...opts, includeStyleTargets: true,
      textsize: (value, paint) => draw.textsize(value, paint)});
    const leaders = hits.filter(hit => hit.kind === 'style_target'
      && hit.classId.startsWith('secondaryRing.') && hit.classId.endsWith('.leader'));
    assert.equal(leaders.length, 1, `${profile}/${arrangement}/${family}: selectable leader`);
    for (const hit of leaders) {
      assert.ok(Math.abs(Math.hypot(hit.x1 - 400, hit.y1 - 400) - support) < 1e-7,
        'leader starts on the visible rim');
      assert.ok(lines.some(line => Math.hypot(line.from[0] - hit.x1, line.from[1] - hit.y1) <= Math.SQRT1_2
        && Math.hypot(line.to[0] - hit.x2, line.to[1] - hit.y2) <= Math.SQRT1_2),
        `${profile}/${arrangement}/${family}: selection matches pixel-snapped painted leader`);
    }
    const projected = renderer.resolveProjectedOuterRing(snapshot, opts,
      {chart, items, frame: renderer.identityFrame(0), boundaryRadius: 250});
    assert.ok(Math.abs(projected.ringset.rOuterLine - 250 - (rings.rOuterLine - support)) < 1e-7,
      'projection preserves the actual exterior gap without adding annotation width');
  }
});


test('exterior cusp anchors stay fixed across outer families and retain tiny ticks', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const {wheelExteriorCuspTickRadii, wheelOpenCuspLabelBand} = await import(layoutModelUrl);
  for (const [profile, theme] of [['anglo', 2], ['houses', 3], ['cusps', 4]])
  for (const maxRadius of [200, 400]) for (const family of ['fallback', 'fixstar', 'arabic_parts', 'midpoints', 'asteroids', 'antiscia', 'contra_antiscia', 'dodecatemoria', 'parallel_transits']) {
    const fallback = family === 'fallback';
    const glyphFamily = ['antiscia', 'contra_antiscia', 'dodecatemoria', 'parallel_transits'].includes(family);
    const composition = {schemaVersion: 1, customized: true, projection: profile === 'houses' ? 'houses' : 'zodiac',
      rings: ['outerBodies', 'cuspLabels', 'zodiac', 'bodies', 'houses', 'hub'].map(archetypeId => ({
        archetypeId, instanceId: `open-${archetypeId}`, enabled: true,
        chartRole: archetypeId === 'outerBodies' ? 'outer' : 'primary',
      }))};
    const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
      houses: {cusps: Array.from({length: 12}, (_, i) => i * 30),
        cuspDegMin: Array.from({length: 12}, () => ({degText: '00', minText: '00'}))},
      fixedStars: fallback ? [{name: 'Nearby star', longitude: 0}, {name: 'Free star', longitude: 15}] : [],
      options: {theme, wheelComposition: composition, showHouses: false, showPositions: false,
        showTerms: false, showDecans: false, showAspects: false, showSymbols: false, signVariant: 1}};
    const snapshot = {primaryChart: chart, outerRingMode: 'fixstars', overlayRenderMode: 'full',
      renderVariant: `round-${profile}`, outerRingItems: {fixstars: fallback ? [] : [
        {id: 'near', family, longitude: 0, label: 'Nearby star', fitPolicy: 'none', segments: glyphFamily ? [{text: 'A', kind: 'glyph'}] : undefined},
        {id: 'free', family, longitude: 15, label: 'Free star', fitPolicy: 'none', segments: glyphFamily ? [{text: 'B', kind: 'glyph'}] : undefined},
      ]}};
    const opts = {width: maxRadius * 4, height: maxRadius * 4, chartSize: maxRadius * 2,
      renderStyle: DEFAULT_WHEEL_RENDER_STYLE};
    const geometry = renderer.wheelGeometryInputForSnapshot(snapshot, maxRadius);
    const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, geometry);
    const bands = wheelOpenCuspLabelBand(rings);
    assert.ok(bands);
    const text = [], lines = [];
    const draw = new renderer.CanvasDraw(recordingCanvas(text, lines));
    draw.resize(opts.width, opts.height, 1);
    for (const layer of ['geometry', 'dynamic', 'outer-label']) renderer.drawSnapshotLayer(draw, snapshot, layer, opts);
    const hits = renderer.computeHitRegions(snapshot, {...opts, includeStyleTargets: true,
      textsize: (value, paint) => draw.textsize(value, paint)});
    const cusps = hits.filter(hit => hit.kind === 'style_target' && hit.classId.startsWith('houses.inner.position.'))
      .map(hit => ({x: hit.left, y: hit.top, w: hit.width, h: hit.height}));
    const stars = text.filter(item => glyphFamily ? ['A', 'B'].includes(item.text) : item.text.includes('star'));
    assert.equal(stars.length, 2, `${profile}/${maxRadius}/${fallback}: both exterior labels paint`);
    for (const star of stars) {
      const target = hits.find(hit => hit.classId?.startsWith('secondaryRing.') && !hit.classId.endsWith('.leader')
        && Math.abs(hit.left - star.x) < 1 && Math.abs(hit.top - star.y) < 1);
      assert.ok(target, 'label remains selectable at its painted location');
    }
    const quietSnapshot = {...snapshot, primaryChart: {...chart, fixedStars: []}, outerRingItems: {fixstars: []}};
    const quietCusps = renderer.computeHitRegions(quietSnapshot, {...opts, includeStyleTargets: true,
      textsize: (value, paint) => draw.textsize(value, paint)})
      .filter(hit => hit.classId?.startsWith('houses.inner.position.'))
      .map(hit => ({x: hit.left, y: hit.top, w: hit.width, h: hit.height}));
    assert.deepEqual(cusps, quietCusps, `${profile}/${family}: exterior objects cannot push cusp labels away`);
    const ticks = [];
    draw.line = (points) => ticks.push(points);
    renderer.drawAngloHouseCuspTicks(draw, [maxRadius, maxRadius], rings, renderer.identityFrame(0),
      chart, DEFAULT_WHEEL_RENDER_STYLE.palette, DEFAULT_WHEEL_RENDER_STYLE);
    assert.equal(ticks.length, 12, 'even angle cusps get their tiny exterior marker, independently of houses visibility');
    const radii = wheelExteriorCuspTickRadii(rings, rings.r30 * DEFAULT_WHEEL_RENDER_STYLE.geometry.anglo.houseCuspTickScale);
    for (const [from, to] of ticks) {
      assert.ok(Math.abs(Math.hypot(from[0] - maxRadius, from[1] - maxRadius) - rings.r30) < 1e-7);
      assert.ok(Math.abs(Math.hypot(to[0] - maxRadius, to[1] - maxRadius) - radii[1]) < 1e-7);
      assert.ok(Math.hypot(to[0] - from[0], to[1] - from[1]) < maxRadius * .01);
    }
  }
});

test('open wheels retain size and cusp anchors through moving bodies, time steps, and settle', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  for (const [profile, theme] of [['anglo', 2], ['houses', 3], ['cusps', 4]])
  for (const positions of [false, true]) for (const radius of [200, 400]) {
    const composition = {schemaVersion: 1, customized: true, projection: profile === 'houses' ? 'houses' : 'zodiac',
      rings: ['outerBodies', 'cuspLabels', 'zodiac', 'bodies', 'houses', 'hub'].map(archetypeId => ({
        archetypeId, instanceId: `open-${archetypeId}`, enabled: true,
        chartRole: archetypeId === 'outerBodies' ? 'outer' : 'primary',
      }))};
    const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
      houses: {cusps: Array.from({length: 12}, (_, i) => i * 30),
        cuspDegMin: Array.from({length: 12}, () => ({degText: '00', minText: '00'}))},
      options: {theme, wheelComposition: composition, showHouses: false, showPositions: true,
        showOuterPositions: positions, showTerms: false, showDecans: false,
        showAspects: false, showSymbols: false, signVariant: 1}};
    const comparison = {...chart, planets: [
      {id: 'moon', longitude: 0, glyph: 'B', motion: 'R', degText: '12', minText: '34'},
      {id: 'sun', longitude: 90, glyph: 'A', motion: '', degText: '23', minText: '45'},
    ]};
    const snapshot = {primaryChart: chart, comparisonChart: comparison, document: {compoundKind: 'transit'},
      outerRingMode: 'none', renderVariant: `round-${profile}`, overlayRenderMode: 'full'};
    const options = {width: radius * 4, height: radius * 4, chartSize: radius * 2,
      renderStyle: DEFAULT_WHEEL_RENDER_STYLE};
    const text = [], draw = new renderer.CanvasDraw(recordingCanvas(text));
    draw.resize(options.width, options.height, 1);
    renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', options);
    const hits = renderer.computeHitRegions(snapshot, {...options, includeStyleTargets: true,
      textsize: (value, paint) => draw.textsize(value, paint)});
    const cusps = hits.filter(hit => hit.classId?.startsWith('houses.inner.position.'));
    const objects = text.filter(item => ['A', 'B', 'R', '12°34′', '23°45′'].includes(item.text));
    assert.ok(objects.length >= 3);
    assert.equal(cusps.length, 36);
    for (const cusp of cusps) {
      const box = {x: cusp.left, y: cusp.top, w: cusp.width, h: cusp.height};
      assert.ok(text.some(item => Math.abs(item.x - box.x) < 1 && Math.abs(item.y - box.y) < 1),
        'cusp selection follows its painted text');
    }
    const envelope = renderer.resolveChartOuterPaintEnvelope(snapshot, DEFAULT_WHEEL_RENDER_STYLE);
    assert.ok(Number.isFinite(envelope.paintRadiusScale) && envelope.paintRadiusScale > 0);
    const cuspRects = rows => rows.filter(hit => hit.classId?.startsWith('houses.inner.position.'))
      .map(hit => [hit.itemId, hit.left, hit.top, hit.width, hit.height]);
    const baselineCusps = cuspRects(hits);
    for (const step of [0, 1, 5, 15, 29, 30, 59, 90, 179, 270, 359, 0]) {
      const moving = {...snapshot, overlayRenderMode: step % 2 ? 'step_fast' : 'full',
        comparisonChart: {...comparison, planets: comparison.planets.map(body => ({...body,
          longitude: (body.longitude + step) % 360, degText: String(step % 30), minText: String(step % 60)}))}};
      assert.deepEqual(renderer.resolveChartOuterPaintEnvelope(moving, DEFAULT_WHEEL_RENDER_STYLE), envelope,
        `${profile}/${positions}: moving content and settle must not change wheel size`);
      const movingHits = renderer.computeHitRegions(moving, {...options, includeStyleTargets: true,
        textsize: (value, paint) => draw.textsize(value, paint)});
      assert.deepEqual(cuspRects(movingHits), baselineCusps,
        `${profile}/${positions}: a moving outer object cannot displace a radix cusp annotation`);
      const rotating = {...moving, primaryChart: {...chart,
        angles: {asc: step, dsc: (step + 180) % 360, mc: (step + 270) % 360, ic: (step + 90) % 360},
        houses: {...chart.houses, cusps: chart.houses.cusps.map(lon => (lon + step) % 360),
          cuspDegMin: chart.houses.cuspDegMin.map(() => ({degText: String(step % 30), minText: String(step % 60)}))}}};
      assert.deepEqual(renderer.resolveChartOuterPaintEnvelope(rotating, DEFAULT_WHEEL_RENDER_STYLE), envelope,
        `${profile}: changing houses, rotation, and degree text must not change wheel size`);
    }

  }
});

test('degree ruler visibility survives moving its row away and back to original order', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  for (const [profile, theme] of [['anglo', 2], ['houses', 3], ['cusps', 4]])
  for (const arrangement of ['single', 'transit', 'synastry']) for (const enabled of [true, false]) {
    const original = structuredClone(WHEEL_FACTORY_SETTINGS.layouts[profile].composition);
    original.rings = original.rings.map(ring => ({...ring,
      enabled: ring.archetypeId === 'degree' ? enabled
        : ['terms', 'decans', 'cuspRuler', 'cuspLabels'].includes(ring.archetypeId) ? false : ring.enabled}));
    const moved = structuredClone(original);
    const index = moved.rings.findIndex(ring => ring.archetypeId === 'degree');
    [moved.rings[index], moved.rings[index - 1]] = [moved.rings[index - 1], moved.rings[index]];
    for (const composition of [original, moved, structuredClone(original)]) {
      const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
        angles: {asc: 0, mc: 270, dsc: 180, ic: 90}, houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
        options: {theme, wheelComposition: composition, showHouses: true, showOuterHouseLines: true,
          showTerms: false, showDecans: false, showPositions: false, showAspects: false}};
      const snapshot = {primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full',
        ...(arrangement === 'single' ? {} : {comparisonChart: chart, document: {compoundKind: arrangement}})};
      const lines = [], draw = new renderer.CanvasDraw(recordingCanvas([], lines));
      draw.resize(800, 800, 1);
      const style = {...DEFAULT_WHEEL_RENDER_STYLE, elementColors: {...DEFAULT_WHEEL_RENDER_STYLE.elementColors},
        linePaint: {...DEFAULT_WHEEL_RENDER_STYLE.linePaint}};
      // Degree ticks are the only 360-line sweep with both cusp instruments off.
      renderer.drawSnapshotLayer(draw, snapshot, 'geometry', {width: 800, height: 800, renderStyle: style});
      assert.equal(lines.length >= 360, enabled, `${profile}/${arrangement}: row order cannot change the toggle's meaning`);
    }
  }
});

test('Anglo Degree attaches to either side of Signs without a terminal circle', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const tickColor = '#ec2359', terminalColor = '#2468aa';
  const style = createWheelRenderStyle({
    palette: DEFAULT_WHEEL_RENDER_STYLE.palette,
    elementColors: {...DEFAULT_WHEEL_RENDER_STYLE.elementColors, outerDegreeRing: terminalColor},
    authoringTargetProfile: 'anglo',
    authoringOverrides: {...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides, linePaint: {anglo: {
      ...Object.fromEntries(['1deg', '5deg', '10deg'].map(size =>
        [`zodiac.tick.outer.${size}`, {color: tickColor}])),
    }}},
  });
  const radius = point => Math.hypot(point[0] - 400, point[1] - 400);
  for (const arrangement of ['single', 'transit', 'synastry']) for (const above of [false, true]) {
    const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts.anglo.composition);
    composition.rings.find(ring => ring.archetypeId === 'degree').enabled = true;
    if (above) {
      const index = composition.rings.findIndex(ring => ring.archetypeId === 'degree');
      [composition.rings[index], composition.rings[index - 1]] = [composition.rings[index - 1], composition.rings[index]];
    }
    const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, mc: 270, dsc: 180, ic: 90},
      houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
      options: {theme: 2, wheelComposition: composition, showHouses: true,
        showOuterHouseLines: true, showTerms: false, showDecans: false,
        showPositions: false, showAspects: false}};
    const snapshot = {primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full',
      ...(arrangement === 'single' ? {} : {comparisonChart: chart, document: {compoundKind: arrangement}})};
    const lines = [], circles = [];
    const draw = new renderer.CanvasDraw(recordingCanvas([], lines, circles));
    draw.resize(800, 800, 1);
    renderer.drawSnapshotLayer(draw, snapshot, 'geometry', {width: 800, height: 800, renderStyle: style});
    const ticks = lines.filter(line => line.strokeStyle === tickColor);
    const where = `${arrangement}/${above ? 'above' : 'below'} Signs`;
    assert.equal(ticks.length, 360, `${where}: every degree tick paints`);
    assert.ok(ticks.every(line => above ? radius(line.to) < radius(line.from)
      : radius(line.to) > radius(line.from)), `${where}: ticks point into Signs`);
    const tickInner = Math.min(...ticks.flatMap(line => [radius(line.from), radius(line.to)]));
    const tickOuter = Math.max(...ticks.flatMap(line => [radius(line.from), radius(line.to)]));
    assert.equal(circles.filter(circle => circle.strokeStyle === terminalColor
      && circle.radius >= tickInner - 1 && circle.radius <= tickOuter + 1).length, 0,
      `${where}: no terminal circle crosses the sign glyphs`);
  }
});

test('explicitly adjacent Anglo Cusp ruler paints inside Signs while original allocation retains its rim', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const tickColor = '#e42a65', terminalColor = '#214aa8';
  const style = createWheelRenderStyle({
    palette: DEFAULT_WHEEL_RENDER_STYLE.palette,
    elementColors: {...DEFAULT_WHEEL_RENDER_STYLE.elementColors, cuspOuterRing: terminalColor},
    authoringTargetProfile: 'anglo',
    authoringOverrides: {...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides, linePaint: {anglo: {
      ...Object.fromEntries(['1deg', '5deg', '10deg'].map(size =>
        [`zodiac.tick.angloCuspRuler.${size}`, {color: tickColor}])),
    }}},
  });
  const radius = point => Math.hypot(point[0] - 400, point[1] - 400);
  for (const arrangement of ['single', 'transit', 'synastry'])
  for (const placement of ['original', 'inside', 'outside']) for (const showHouses of [true, false]) {
    const outside = placement === 'outside';
    const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts.anglo.composition);
    composition.rings = composition.rings.map(ring => ['degree', 'terms', 'decans', 'cuspLabels'].includes(ring.archetypeId)
      ? {...ring, enabled: false} : ring.archetypeId === 'houses' ? {...ring, enabled: showHouses} : ring);
    if (placement !== 'original') {
      const cusp = composition.rings.splice(composition.rings.findIndex(r => r.archetypeId === 'cuspRuler'), 1)[0];
      const signIndex = composition.rings.findIndex(r => r.archetypeId === 'zodiac');
      composition.rings.splice(signIndex + Number(!outside), 0, cusp);
    }
    const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, mc: 270, dsc: 180, ic: 90},
      houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
      options: {theme: 2, wheelComposition: composition, showHouses,
        showOuterHouseLines: true, showTerms: false, showDecans: false,
        showPositions: false, showAspects: false}};
    const snapshot = {primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full',
      ...(arrangement === 'single' ? {} : {comparisonChart: chart, document: {compoundKind: arrangement}})};
    const lines = [], circles = [];
    const draw = new renderer.CanvasDraw(recordingCanvas([], lines, circles));
    draw.resize(800, 800, 1);
    renderer.drawSnapshotLayer(draw, snapshot, 'geometry', {width: 800, height: 800, renderStyle: style});
    const ticks = lines.filter(line => line.strokeStyle === tickColor);
    const where = `${arrangement}/${placement} Signs/houses ${showHouses}`;
    const inward = placement !== 'inside';
    assert.equal(ticks.length, inward ? 360 : 348, `${where}: Cusp ticks paint`);
    assert.ok(ticks.every(line => inward ? radius(line.to) < radius(line.from)
      : radius(line.to) > radius(line.from)), `${where}: ticks follow the explicit host or allocated band`);
    const tickInner = Math.min(...ticks.flatMap(line => [radius(line.from), radius(line.to)]));
    const tickOuter = Math.max(...ticks.flatMap(line => [radius(line.from), radius(line.to)]));
    assert.equal(circles.some(circle => circle.strokeStyle === terminalColor
      && circle.radius >= tickInner - 1 && circle.radius <= tickOuter + 1), placement === 'original',
      `${where}: only the allocated ruler retains a separate Cusp circle`);
  }
});

test('reordered Anglo rulers paint one boundary per allocated lane without phantom cusp circles', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const expected = ['zodiacOuterRing', 'zodiacInnerRing', 'innerDegreeRing', 'termRing',
    'innerBoundaryRing', 'houseBoundaryRing', 'baseRing'];
  const roles = [...expected, 'cuspOuterRing', 'outerDegreeRing'];
  const colors = Object.fromEntries(roles.map((role, index) => [role, `#01${String(index).padStart(4, '0')}`]));
  const style = createWheelRenderStyle({palette: DEFAULT_WHEEL_RENDER_STYLE.palette,
    elementColors: {...DEFAULT_WHEEL_RENDER_STYLE.elementColors, ...colors}, authoringTargetProfile: 'anglo',
    authoringOverrides: {...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides, ringRadii: {anglo: {
      zodiacOuterRing: 379.1, zodiacInnerRing: 348.1, termRing: 335.1,
      cuspOuterRing: 321.4, innerBoundaryRing: 299.1, houseBoundaryRing: 211, baseRing: 190.6,
    }}}});
  for (const outside of [false, true]) {
    // Degree occupies its own lane between Terms and Decans; Cusp ruler is
    // hosted on either Signs edge. Disabled annotations paint no boundary.
    const composition = {schemaVersion: 1, customized: true, projection: 'zodiac', rings:
      [...(outside ? ['cuspRuler', 'zodiac'] : ['zodiac', 'cuspRuler']),
        'terms', 'degree', 'decans', 'cuspLabels', 'bodies', 'houses', 'hub'].map(archetypeId => ({
        instanceId: `anglo-${archetypeId}`, archetypeId,
        enabled: archetypeId !== 'cuspLabels', chartRole: 'primary',
      }))};
    const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, mc: 270, dsc: 180, ic: 90},
      houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
      options: {theme: 2, wheelComposition: composition, showHouses: true,
        showTerms: true, showDecans: true, showPositions: false, showAspects: false}};
    const snapshot = {primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full'};
    const circles = [], draw = new renderer.CanvasDraw(recordingCanvas([]));
    draw.resize(800, 800, 1);
    draw.circle = (_center, radius, paint) => circles.push({radius, outline: paint.outline});
    renderer.drawSnapshotLayer(draw, snapshot, 'geometry', {width: 800, height: 800, renderStyle: style});
    const painted = circles.filter(circle => Object.values(colors).includes(circle.outline));
    assert.deepEqual(painted.map(circle => circle.outline).sort(), expected.map(role => colors[role]).sort());
    assert.equal(new Set(painted.map(circle => circle.radius)).size, expected.length,
      'adjacent lanes share one circle; hosted/disabled cusp instruments add none');
  }
});

test('a detached Degree lane does not split the adjoining cusp ruler and annotations with another circle', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const tickColor = '#e42a65', rimColor = '#214aa8', seamColor = '#8a6ae3';
  const style = createWheelRenderStyle({palette: DEFAULT_WHEEL_RENDER_STYLE.palette,
    elementColors: {...DEFAULT_WHEEL_RENDER_STYLE.elementColors,
      cuspOuterRing: rimColor, outerDegreeRing: seamColor}, authoringTargetProfile: 'anglo',
    authoringOverrides: {...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      wheelScale: {anglo: 0.942016},
      recipeRadii: {anglo: {zodiacOuterRing: 379.1, zodiacInnerRing: 348.1, termRing: 335.1,
        cuspOuterRing: 321.4, innerBoundaryRing: 299.1, houseBoundaryRing: 211, baseRing: 190.6}},
      linePaint: {anglo: Object.fromEntries(['1deg', '5deg', '10deg'].map(size =>
        [`zodiac.tick.angloCuspRuler.${size}`, {color: tickColor}]))}}});
  const composition = {schemaVersion: 1, customized: true, projection: 'zodiac', rings:
    ['zodiac', 'terms', 'degree', 'decans', 'cuspRuler', 'cuspLabels', 'bodies', 'houses', 'hub']
      .map(archetypeId => ({instanceId: `anglo-${archetypeId}`, archetypeId, enabled: true, chartRole: 'primary'}))};
  const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
    angles: {asc: 0, mc: 270, dsc: 180, ic: 90},
    houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
    options: {theme: 2, wheelComposition: composition, showHouses: true,
      showTerms: true, showDecans: true, showPositions: true, showAspects: false}};
  const snapshot = {primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full'};
  const circles = [], lines = [], draw = new renderer.CanvasDraw(recordingCanvas([], lines));
  draw.resize(800, 800, 1);
  draw.circle = (_center, radius, paint) => circles.push({radius, outline: paint.outline});
  renderer.drawSnapshotLayer(draw, snapshot, 'geometry', {width: 800, height: 800, renderStyle: style});
  assert.equal(circles.filter(circle => circle.outline === seamColor).length, 0,
    'the original combined cusp-degree material has no interior terminal circle');
  const rim = circles.find(circle => circle.outline === rimColor);
  assert.ok(rim, 'the cusp ruler retains its semantic outer rim');
  const ticks = lines.filter(line => line.strokeStyle === tickColor);
  assert.equal(ticks.length, 360);
  const radius = point => Math.hypot(point[0] - 400, point[1] - 400);
  assert.ok(ticks.every(tick => Math.abs(radius(tick.from) - rim.radius) < 1.1),
    'the cusp rim is the tick base rather than an extra circle through the tick lane');
  assert.ok(ticks.every(tick => radius(tick.to) < radius(tick.from)), 'allocated cusp ticks point inward');
});

test('composition cusp ticks follow their allocated material or explicit Signs attachment through visibility toggles', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const {resolvedWheelLayout, wheelCuspRulerTickEnds} = await import(layoutModelUrl);
  const tickColor = '#e42a65', houseColor = '#516de4', angleColor = '#7f186d';
  const style = createWheelRenderStyle({palette: DEFAULT_WHEEL_RENDER_STYLE.palette,
    authoringTargetProfile: 'anglo', authoringOverrides: {...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      recipeRadii: {anglo: {zodiacOuterRing: 379.1, zodiacInnerRing: 348.1, termRing: 335.1,
        cuspOuterRing: 321.4, innerBoundaryRing: 299.1, houseBoundaryRing: 211, baseRing: 190.6}},
      linePaint: {anglo: {...Object.fromEntries(['1deg', '5deg', '10deg'].map(size =>
        [`zodiac.tick.angloCuspRuler.${size}`, {color: tickColor}])),
      'zodiac.tick.angloHouseCusp': {color: houseColor},
      'zodiac.tick.angloAngleRuler': {color: angleColor}}}}});
  const orders = {
    allocated: ['degree', 'zodiac', 'terms', 'decans', 'cuspRuler', 'cuspLabels', 'bodies', 'houses', 'hub'],
    outside: ['cuspRuler', 'zodiac', 'terms', 'degree', 'decans', 'cuspLabels', 'bodies', 'houses', 'hub'],
    inside: ['zodiac', 'cuspRuler', 'terms', 'degree', 'decans', 'cuspLabels', 'bodies', 'houses', 'hub'],
  };
  const radius = point => Math.hypot(point[0] - 400, point[1] - 400);
  for (const [placement, order] of Object.entries(orders)) for (const subdivisions of [true, false])
  for (const degreeEnabled of [true, false]) {
    const composition = {schemaVersion: 1, customized: true, projection: 'zodiac', rings:
      ['outerHouses', 'outerBodies', ...order].map(archetypeId => ({archetypeId,
        instanceId: `anglo-${archetypeId}`, chartRole: archetypeId.startsWith('outer') ? 'outer' : 'primary',
        enabled: archetypeId === 'degree' ? degreeEnabled
          : ['terms', 'decans'].includes(archetypeId) ? subdivisions : true}))};
    const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, mc: 270, dsc: 180, ic: 90},
      houses: {cusps: Array.from({length: 12}, (_, i) => 3 + i * 30)},
      options: {theme: 2, wheelComposition: composition, showHouses: true,
        showTerms: subdivisions, showDecans: subdivisions, showPositions: true, showAspects: false}};
    const snapshot = {primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full'};
    const rings = resolveWheelRingSet(style, renderer.wheelGeometryInputForSnapshot(snapshot, 400));
    const bands = resolvedWheelLayout(rings).bands;
    const band = bands.find(band => band.id === 'cuspRuler' && band.visible);
    const labels = bands.find(band => band.id === 'cuspLabels' && band.visible);
    const materialInner = !band.overlay && labels && Math.abs(labels.outer - band.inner) < 1e-7 ? labels.inner : band.inner;
    assert.equal(Boolean(band.overlay), placement !== 'allocated', 'hidden subdivisions retain authored separators');
    const ends = wheelCuspRulerTickEnds(composition, band);
    const inward = ends.tip < ends.base;
    const lines = [], draw = new renderer.CanvasDraw(recordingCanvas([], lines));
    draw.resize(800, 800, 1);
    renderer.drawSnapshotLayer(draw, snapshot, 'geometry', {width: 800, height: 800, renderStyle: style});
    renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', {width: 800, height: 800, renderStyle: style});
    const ticks = lines.filter(line => line.strokeStyle === tickColor);
    const houseTicks = lines.filter(line => line.strokeStyle === houseColor);
    const angleTicks = lines.filter(line => line.strokeStyle === angleColor);
    const context = `${placement}/subdivisions ${subdivisions}/Degree ${degreeEnabled}`;
    assert.equal(ticks.length, inward ? 360 : 348, context);
    assert.equal(houseTicks.length, 12, context);
    assert.equal(angleTicks.length, 2, context);
    for (const tick of [...ticks, ...houseTicks, ...angleTicks]) {
      assert.ok(Math.abs(radius(tick.from) - ends.base) < 1.1, `${context}: tick base matches own band`);
      assert.ok(inward ? radius(tick.to) < radius(tick.from) : radius(tick.to) > radius(tick.from), context);
      assert.ok(radius(tick.to) >= materialInner - 1.1 && radius(tick.to) <= band.outer + 1.1,
        `${context}: tick remains within contiguous Cusp material or its hosted instrument`);
    }
  }
});

test('raw historical cusp ticks preserve their visibility-based direction without a composition', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const tickColor = '#e42a65';
  const style = createWheelRenderStyle({palette: DEFAULT_WHEEL_RENDER_STYLE.palette,
    authoringTargetProfile: 'anglo', authoringOverrides: {...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      linePaint: {anglo: Object.fromEntries(['1deg', '5deg', '10deg'].map(size =>
        [`zodiac.tick.angloCuspRuler.${size}`, {color: tickColor}]))}}});
  for (const subdivisions of [true, false]) {
    const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, mc: 270, dsc: 180, ic: 90},
      houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
      options: {theme: 2, showHouses: true, showTerms: subdivisions, showDecans: subdivisions,
        showPositions: false, showAspects: false}};
    const lines = [], draw = new renderer.CanvasDraw(recordingCanvas([], lines));
    draw.resize(800, 800, 1);
    renderer.drawSnapshotLayer(draw, {primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full'},
      'geometry', {width: 800, height: 800, renderStyle: style});
    const ticks = lines.filter(line => line.strokeStyle === tickColor);
    assert.equal(ticks.length, subdivisions ? 360 : 348);
    const radius = point => Math.hypot(point[0] - 400, point[1] - 400);
    assert.ok(ticks.every(tick => subdivisions ? radius(tick.to) < radius(tick.from)
      : radius(tick.to) > radius(tick.from)));
  }
});

test('Traditional Morinus paints selectable center data and honors information/export switches', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const centerLines = ['24 November 1946', '22:35:00 ZN', 'Burlington', '73°12 W 44°28 N',
    'Complete chart name', 'Radix', 'Tropical', 'Alcabitius'];
  const style = {...DEFAULT_WHEEL_RENDER_STYLE, presentation: 'traditional-morinus',
    strokes: {...DEFAULT_WHEEL_RENDER_STYLE.strokes, ascMcDefaultBase: 3}};
  for (const showTerms of [false, true]) for (const showDecans of [false, true]) {
    const chart = {meta: {name: 'Complete chart name', centerLines, cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
      houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
      options: {theme: 1, showInformation: true, showHouses: true, showPositions: false,
        showTerms, showDecans, showAspects: false, showSymbols: false, signVariant: 1}};
    const snapshot = {primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full', renderVariant: 'round-compact'};
    const opts = {width: 800, height: 800, renderStyle: style};
    const text = [], clips = [];
    const canvas = recordingCanvas(text);
    const ctx = canvas.getContext();
    ctx.rect = () => {};
    ctx.clip = rule => clips.push(rule);
    const draw = new renderer.CanvasDraw(canvas);
    draw.resize(800, 800, 1);
    renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', opts);
    assert.deepEqual(text.filter(item => centerLines.includes(item.text)).map(item => item.text), centerLines);
    assert.deepEqual(clips, ['evenodd']);
    const hits = renderer.computeHitRegions(snapshot, {...opts, includeStyleTargets: true,
      textsize: (value, paint) => draw.textsize(value, paint)});
    assert.equal(hits.filter(hit => hit.kind === 'style_target' && hit.itemId?.startsWith('chart-center:information:')).length, centerLines.length);
    text.length = 0; clips.length = 0;
    renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', {...opts, includeCenterInformation: false});
    assert.equal(text.filter(item => centerLines.includes(item.text)).length, 0);
    assert.equal(clips.length, 0);
    chart.options.showInformation = false;
    renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', opts);
    assert.equal(text.filter(item => centerLines.includes(item.text)).length, 0);
    assert.equal(renderer.findHitRegion([{kind: 'aspect', p1: 'sun', p2: 'moon', aspectType: 0,
      x: 400, y: 400, r: 10, excludedDisc: {x: 400, y: 400, r: 100}}], 400, 400), null);
  }
});


test('Traditional single-wheel proportions and typography stay stable across outer families', () => {
  const style = {...DEFAULT_WHEEL_RENDER_STYLE, presentation: 'traditional-morinus'};
  for (const showTerms of [false, true]) for (const showDecans of [false, true]) {
    const input = {profile: 'compact', mode: 'single', maxRadius: 400,
      showTerms, showDecans, showHouses: true, showPositions: true,
      hasOuterRing: false, outerRingMode: 'none'};
    const baseline = resolveWheelRingSet(style, input);
    const typography = resolveWheelTypographyMetrics(style, 'compact', 400, input);
    assert.equal(baseline.r30, 340);
    assert.equal(baseline.rBase, 400 * (0.30 - (showTerms && showDecans ? 0.08 : 0)));
    for (const outerRingMode of ['fixstars', 'arabic_parts', 'asteroids', 'dodecatemoria', 'antiscia', 'parallel_transits']) {
      const outer = {...input, hasOuterRing: true, outerRingMode};
      assert.deepEqual(resolveWheelRingSet(style, outer), baseline, outerRingMode);
      assert.deepEqual(resolveWheelTypographyMetrics(style, 'compact', 400, outer), typography, outerRingMode);
    }
  }
});

test('Traditional empty and fixed-star wheels share exterior reserve and titlebar clearance', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const style = {...DEFAULT_WHEEL_RENDER_STYLE, presentation: 'traditional-morinus'};
  const snapshot = {primaryChart: {meta: {}, planets: [], aspects: [],
    angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
    houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
    options: {theme: 1, showHouses: true, showTerms: true, showDecans: true}},
    outerRingMode: 'none', renderVariant: 'round-compact', overlayRenderMode: 'full'};
  const empty = renderer.resolveChartOuterPaintEnvelope(snapshot, style);
  const stars = renderer.resolveChartOuterPaintEnvelope({...snapshot, outerRingMode: 'fixstars'}, style);
  assert.equal(empty.avoidTitlebar, true);
  assert.deepEqual(stars, empty);
});


test('Traditional omits cusp and angle degrees in paint and selection while retaining planet degrees', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const chart = {meta: {}, aspects: [],
    planets: [{id: 'sun', longitude: 120, glyph: 'A', motion: '', degText: '17', minText: '41'}],
    angles: {asc: 0, dsc: 180, mc: 270, ic: 90,
      ascDegMin: {degText: '11', minText: '22'}, mcDegMin: {degText: '12', minText: '23'}},
    houses: {cusps: Array.from({length: 12}, (_, i) => i * 30),
      cuspDegMin: Array.from({length: 12}, () => ({degText: '13', minText: '24'}))},
    options: {theme: 1, showHouses: true, showPositions: true, showInformation: false,
      showTerms: false, showDecans: false, showSymbols: false, showAspects: false}};
  for (const outerRingMode of ['none', 'fixstars', 'asteroids']) {
    const snapshot = {primaryChart: chart, outerRingMode, renderVariant: 'round-compact', overlayRenderMode: 'full'};
    for (const traditional of [false, true]) {
      const text = [], draw = new renderer.CanvasDraw(recordingCanvas(text));
      draw.resize(800, 800, 1);
      const style = {...DEFAULT_WHEEL_RENDER_STYLE,
        ...(traditional ? {presentation: 'traditional-morinus'} : {})};
      const opts = {width: 800, height: 800, renderStyle: style};
      renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', opts);
      const hits = renderer.computeHitRegions(snapshot, {...opts, includeStyleTargets: true,
        textsize: (value, paint) => draw.textsize(value, paint)});
      const cuspHits = hits.filter(hit => hit.classId?.startsWith('houses.inner.position.')
        || hit.classId?.startsWith('angles.inner.position.'));
      assert.equal(cuspHits.length > 0, !traditional);
      assert.equal(text.some(item => item.text === '13°'), !traditional);
      assert.ok(text.some(item => item.text === '17°'), 'planet degrees remain visible');
    }
  }
});

test('Traditional omits single and comparison aspect paint and hit targets without changing options', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const aspect = {p1: 'sun', p2: 'moon', type: 5, orb: 0};
  const chart = {meta: {}, aspects: [aspect],
    planets: [{id: 'sun', longitude: 30, glyph: 'A', motion: '', degText: '0', minText: '0'},
      {id: 'moon', longitude: 150, glyph: 'B', motion: '', degText: '0', minText: '0'}],
    angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
    houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
    options: {theme: 1, showHouses: true, showPositions: false, showInformation: false,
      showTerms: false, showDecans: false, showSymbols: true, showAspects: true}};
  for (const comparison of [false, true]) {
    const snapshot = {primaryChart: chart, outerRingMode: 'none', renderVariant: 'round-compact',
      overlayRenderMode: 'full', ...(comparison ? {comparisonChart: chart,
        document: {compoundKind: 'transit'}, interChartAspects: [{inner: 'sun', outer: 'moon', type: 5, orb: 0}]} : {})};
    const paint = (traditional, showAspects) => {
      const text = [], lines = [], draw = new renderer.CanvasDraw(recordingCanvas(text));
      draw.resize(800, 800, 1);
      draw.line = (...args) => lines.push(args);
      const opts = {width: 800, height: 800, renderStyle: {...DEFAULT_WHEEL_RENDER_STYLE,
        ...(traditional ? {presentation: 'traditional-morinus'} : {})}};
      const displayed = {...snapshot, primaryChart: {...chart, options: {...chart.options, showAspects}}};
      renderer.drawSnapshotLayer(draw, displayed, 'dynamic', opts);
      const hits = renderer.computeHitRegions(displayed, opts).filter(hit => hit.kind === 'aspect');
      return {text, lines, hits};
    };
    assert.deepEqual(paint(true, true), paint(true, false), 'aspect visibility cannot add paint or targets to Traditional');
    assert.ok(paint(false, true).hits.length > 0, 'other styles retain aspect selection');
    assert.equal(chart.options.showAspects, true, 'canonical option remains enabled');
    assert.equal(chart.aspects.length, 1, 'semantic aspects remain available');
  }
});

test('Traditional ring and angle strokes use shared controls with original default bases', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const style = {...DEFAULT_WHEEL_RENDER_STYLE, presentation: 'traditional-morinus',
    strokes: {...DEFAULT_WHEEL_RENDER_STYLE.strokes, ascMcDefaultBase: 3}};
  const chart = {meta: {}, planets: [], aspects: [],
    angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
    houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
    options: {theme: 1, showHouses: true, showTerms: false, showDecans: false}};
  const paint = (options, size) => {
    const circles = [], lines = [], draw = new renderer.CanvasDraw(recordingCanvas([]));
    draw.resize(size, size, 1);
    draw.circle = (center, radius, paint) => circles.push({radius, width: paint.width});
    draw.line = (points, paint) => lines.push({points, width: paint.width});
    const primaryChart = {...chart, options: {...chart.options, ...options}};
    renderer.drawSnapshotLayer(draw, {primaryChart, outerRingMode: 'none', renderVariant: 'round-compact',
      overlayRenderMode: 'full'}, 'geometry', {width: size, height: size, renderStyle: style});
    return {rim: circles.find(item => Math.abs(item.radius - size / 2 * .85) < 1e-8)?.width,
      hub: circles.find(item => Math.abs(item.radius - size / 2 * .30) < 1e-8)?.width, lines};
  };
  for (const size of [400, 600, 1200]) {
    const defaults = paint({}, size);
    const standard = paint({chartRingThickness: 3, ascmcSize: 3}, size);
    assert.deepEqual(defaults, standard, 'missing options preserve original defaults');
    for (const ring of [1, 2, 3]) for (const angle of [2, 3, 4, 5]) {
      const actual = paint({chartRingThickness: ring, ascmcSize: angle}, size);
      assert.equal(actual.rim, resolveMorinusStroke(size, ring, 'ring'));
      assert.equal(actual.hub, resolveMorinusStroke(size, angle, 'angle'));
      assert.ok(actual.lines.some(line => line.width === resolveMorinusStroke(size, angle, 'angle')),
        'angle shafts use the same resolved base as the hub');
    }
  }
});


test('Traditional centre follows subchart metadata and day/hour rows with matching selection targets', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const style = {...DEFAULT_WHEEL_RENDER_STYLE, presentation: 'traditional-morinus'};
  const base = {planets: [], aspects: [], angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
    houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
    options: {theme: 1, showInformation: true, showHouses: true,
      showPositions: false, showTerms: false, showDecans: false, showSymbols: false, showAspects: false}};
  const radix = {...base, meta: {centerLines: ['Radix date', 'Radix time', 'Radix place', 'Radix coordinates', 'Radix name', 'Radix']},
    overlay: {rows: [{group: 'dayhour', label: 'Radix day', glyphs: []}]}};
  const child = {...base, meta: {centerLines: ['Eclipse date', 'Eclipse time', 'Eclipse place', 'Eclipse coordinates', 'Eclipse name', 'Solar eclipse']},
    overlay: {rows: [{group: 'dayhour', label: 'Eclipse day', glyphs: []}]}};
  for (const mode of ['singleton', 'derived', 'synastry']) {
    const snapshot = {primaryChart: mode === 'singleton' ? child : radix,
      ...(mode === 'singleton' ? {} : {comparisonChart: child}),
      document: {compoundKind: mode === 'synastry' ? 'synastry' : 'transit'},
      outerRingMode: 'none', renderVariant: 'round-compact', overlayRenderMode: 'full'};
    const expected = mode === 'synastry' ? radix : child;
    const other = mode === 'synastry' ? child : radix;
    const text = [], draw = new renderer.CanvasDraw(recordingCanvas(text));
    draw.resize(800, 800, 1);
    const ctx = draw.ctx; ctx.rect = () => {}; ctx.clip = () => {};
    const opts = {width: 800, height: 800, renderStyle: style};
    renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', opts);
    assert.deepEqual(text.filter(item => expected.meta.centerLines.includes(item.text)).map(item => item.text), expected.meta.centerLines);
    assert.ok(!text.some(item => other.meta.centerLines.includes(item.text)));
    assert.ok(text.some(item => item.text === expected.overlay.rows[0].label));
    assert.ok(!text.some(item => item.text === other.overlay.rows[0].label));
    const measured = [];
    const hits = renderer.computeHitRegions(snapshot, {...opts, includeStyleTargets: true,
      textsize: (value, paint) => {measured.push(value); return draw.textsize(value, paint);}});
    assert.equal(hits.filter(hit => hit.itemId?.startsWith('chart-center:information:')).length, expected.meta.centerLines.length);
    assert.ok(expected.meta.centerLines.every(line => measured.includes(line)));
    assert.ok(other.meta.centerLines.every(line => !measured.includes(line)));
  }
});


test('Classic and Compact simple wheels match Traditional footprint, preserve proportions and remain larger than outer wheels', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const laneSource = await readFile(new URL('../src/lib/chart/outer-glyph-lane.ts', import.meta.url), 'utf8');
  const laneCode = ts.transpileModule(laneSource, {
    compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
  }).outputText;
  const {resolveChartPaintTarget} = await import(`data:text/javascript;base64,${Buffer.from(laneCode).toString('base64')}`);
  for (const [profile, theme] of [['classic', 0], ['compact', 1]])
    for (const [width, height] of [[1344, 1200], [1200, 900], [600, 1000], [800, 800]])
    for (const [showTerms, showDecans] of [[false, false], [true, false], [false, true], [true, true]])
    for (const topBoundary of [0, 20, 50]) {
      const chart = {meta: {}, planets: [], aspects: [],
        angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
        houses: {cusps: Array.from({length: 12}, (_, i) => i * 30)},
        options: {theme, showHouses: true, showPositions: true, showTerms, showDecans}};
      const style = DEFAULT_WHEEL_RENDER_STYLE;
      const originalInput = {profile, mode: 'single', maxRadius: 400, hasOuterRing: false,
        showTerms, showDecans, showHouses: true, showPositions: true};
      const original = resolveWheelRingSet(style, originalInput);
      const fitted = outerRingMode => {
        const snapshot = {primaryChart: chart, outerRingMode, renderVariant: `round-${profile}`, overlayRenderMode: 'full'};
        const envelope = renderer.resolveChartOuterPaintEnvelope(snapshot, style);
        assert.equal(envelope.avoidTitlebar, true);
        const target = resolveChartPaintTarget(width, height, envelope.paintRadiusScale,
          topBoundary, envelope.avoidTitlebar, 'center', envelope.targetScale);
        const rings = resolveWheelRingSet(style, {...originalInput,
          maxRadius: target.side / 2, hasOuterRing: outerRingMode !== 'none', outerRingMode});
        return {envelope, target, rings};
      };
      const simple = fitted('none');
      assert.equal(simple.envelope.paintRadiusScale, .96);
      assert.equal(simple.envelope.targetScale, .96 / .85);
      const traditionalStyle = {...style, presentation: 'traditional-morinus'};
      const traditionalSnapshot = {primaryChart: {...chart, options: {...chart.options, theme: 1}},
        outerRingMode: 'none', renderVariant: 'round-compact', overlayRenderMode: 'full'};
      const traditionalEnvelope = renderer.resolveChartOuterPaintEnvelope(traditionalSnapshot, traditionalStyle);
      assert.equal(traditionalEnvelope.targetScale, 1, 'working Traditional framing is unchanged');
      const traditionalRings = resolveWheelRingSet(traditionalStyle, {...originalInput, profile: 'compact',
        maxRadius: Math.min(width, height) / 2});
      if (topBoundary === 0) {
        assert.ok(Math.abs(simple.rings.r30 - traditionalRings.r30) < 1e-8,
          'bare wheel matches the accepted Traditional footprint');
        assert.ok(Math.abs(simple.rings.r30 / (Math.min(width, height) / 2) - .85) < 1e-8,
          'absolute footprint leaves the accepted margin even without a titlebar');
        assert.ok(Math.abs(simple.target.side - Math.min(width, height) / simple.envelope.targetScale) < 1e-8,
          'live target agrees with export sizing');
      }
      for (const radius of ['rBase', 'rHouse', 'rInner', 'rPlanet', 'rASCMC']) {
        assert.ok(Math.abs(simple.rings[radius] / simple.rings.r30 - original[radius] / original.r30) < 1e-8,
          `${profile}/${radius}: original internal proportions are retained`);
      }
      for (const mode of ['fixstars', 'arabic_parts', 'asteroids', 'antiscia', 'dodecatemoria', 'parallel_transits']) {
        const outer = fitted(mode);
        assert.ok(simple.rings.r30 > outer.rings.r30, `${profile}/${mode}: simple zodiac rim remains larger`);
      }
    }
});

test('Lot abbreviations retain qualifiers and reject ambiguous short names', () => {
  const names = [
    {label: 'Marriage', shortLabel: 'Marr.'}, {label: 'Children', shortLabel: 'Child.'},
    {label: 'Child'}, {label: 'Marriage of men', shortLabel: 'Marr. of men'},
    {label: 'Marriage of women', shortLabel: 'Marr. of women'}, {label: 'Eros'},
    {label: 'Journeys', shortLabel: 'Journ.'}, {label: 'Journeyman'},
    {label: 'A\u0301bcdefghijk'}, {label: 'A\u0301bcdefghijl'},
  ];
  const candidates = outerLabelCandidates(names);
  assert.ok(candidates.get('Marriage').includes('Marr.'));
  assert.ok(!candidates.get('Children').includes('Child.'), 'a full peer name reserves its abbreviation');
  assert.deepEqual(candidates.get('Eros'), ['Eros']);
  assert.ok(candidates.get('Marriage of men').every(text => text.endsWith(' men')));
  assert.ok(candidates.get('Marriage of women').every(text => / wom(?:\.|en)$/.test(text)));
  assert.ok(candidates.get('Journeys').every(text => !['Jou.', 'Jour.', 'Journ.'].includes(text)));
  assert.ok(candidates.get('A\u0301bcdefghijk').every(text => text.startsWith('A\u0301')));
  assert.equal(outerLabelCandidates([...names].reverse()), candidates, 'name cache survives moving/reordered points');
});

test('edge names drop degrees before losing their identity at the original radial anchors', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const draw = {textsize: text => [text.length * 6, 12]};
  const name = {text: 'Children', font: 'ui', fontFamily: 'test', size: 12,
    weight: 400, style: 'normal', tracking: 0, opacity: 1, color: '#000',
    classId: 'secondaryRing.arabicPart.label'};
  const position = {...name, text: ' 16°', classId: 'bodies.outer.position'};
  for (const [leftSide, rad] of [[true, Math.PI], [false, 0]]) {
    for (const [margin, radius, hasPosition] of [[63, 330, true], [38, 355, false], [13, 380, false]]) {
      const x = leftSide ? margin : 800 - margin;
      const box = renderer.placeOuterWordLabel(draw, [name, position], ['Children', 'Child.', 'Chil.'],
        [400, 400], radius, rad, [x, 400], 0, radius + 7, 800, 24, DEFAULT_WHEEL_RENDER_STYLE);
      assert.equal(box.runs.filter(run => run.classId === name.classId).map(run => run.text).join(''),
      margin === 13 ? 'C' : 'Chil.');
      assert.equal(box.runs.some(run => run.classId === position.classId), hasPosition);
      if (hasPosition) {
        assert.equal(box.runs[leftSide ? 1 : 0].text.trim(), '16°');
      }
      if (margin > 13) assert.ok(box.x >= 4 && box.x + box.w <= 796, 'the whole label fits');
      assert.ok(Math.abs(box.y - 400) < 0.01, "name fitting cannot relocate labels around the wheel");
      for (const px of [box.x, box.x + box.w]) for (const py of [box.y - box.h / 2, box.y + box.h / 2])
        assert.ok(Math.hypot(px - 400, py - 400) >= radius);
      assert.equal(name.text, 'Children', 'fitting never replaces the full semantic label');
    }
  }
});

test('crowded Lot labels retain original short leaders and full hover identities', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  for (const theme of [0, 1, 2, 3, 4]) for (const showOuterPositions of [false, true]) {
    const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
      houses: {system: 'P', cusps: Array.from({length: 12}, (_, i) => i * 30)},
      options: {theme, showHouses: false, showPositions: false, showOuterPositions,
        showOuterMinutes: false, showTerms: false, showDecans: false,
        showAspects: false, showSymbols: false, signVariant: 1}};
    const items = ['Marriage of men', 'Marriage of women', 'Children', 'Journeys',
      'Hot Sauce', 'Eros', 'Union', 'Spirit'].map((label, index) => ({
      id: `lot-${index}`, family: 'arabic_part', label, longitude: index < 4 ? index : 180 + index,
      shortLabel: label.startsWith('Marriage') ? label.replace('Marriage', 'Marr.')
        : label === 'Children' ? 'Child.' : label === 'Journeys' ? 'Journ.' : undefined,
      degText: '16', minText: '00',
    }));
    const snapshot = {primaryChart: chart, outerRingMode: 'arabic_parts',
      outerRingItems: {arabic_parts: items}, overlayRenderMode: 'full'};
    const opts = {width: 800, height: 800, chartSize: 760, renderStyle: DEFAULT_WHEEL_RENDER_STYLE};
    const text = [], lines = [], draw = new renderer.CanvasDraw(recordingCanvas(text));
    draw.resize(800, 800, 1);
    draw.line = points => lines.push(points);
    renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', opts);
    renderer.drawSnapshotLayer(draw, snapshot, 'outer-label', opts);
    const hits = renderer.computeHitRegions(snapshot, {...opts, includeStyleTargets: true,
      textsize: (value, paint) => draw.textsize(value, paint)});
    const lots = hits.filter(hit => hit.kind === 'secondary_ring');
    assert.equal(lots.length, items.length);
    for (const item of items) {
      const hit = lots.find(hit => hit.itemId === item.id);
      assert.equal(hit.label, item.label);
      assert.equal(hit.longitude, item.longitude);
      assert.ok(hit.top >= 0 && hit.top + hit.height <= 800);
      assert.ok(lines.some(line => line.every((point, index) => point.every((value, axis) =>
        Math.abs(value - [hit.leader.start, hit.leader.end][index][axis]) < 0.01))),
      'leader hit matches the original painted tick');
    }
    for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) {
      const a = lots[i], b = lots[j];
      // Hover padding can touch; the actual text rectangles must be separate.
      assert.ok(a.left + a.width - 4 <= b.left + 4 || b.left + b.width - 4 <= a.left + 4
        || a.top + a.height - 4 <= b.top + 4 || b.top + b.height - 4 <= a.top + 4,
      `${theme}/${showOuterPositions}: ${a.label} overlaps ${b.label}`);
    }
  }
});

test('shared outer-name fitting retains asteroid motion and glyph typography without moving ticks', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const name = {text: 'Astronomia', font: 'ui', fontFamily: 'test', size: 12,
    weight: 400, style: 'normal', tracking: 0, opacity: 1, color: '#000',
    classId: 'secondaryRing.asteroid.label'};
  const position = {...name, text: ' 27°', classId: 'bodies.outer.position'};
  const motion = {...name, text: ' R', weight: 600, classId: 'secondaryRing.asteroid.motion'};
  const draw = {textsize: text => [text.length * 6, 12]};
  for (const [leftSide, rad] of [[true, Math.PI], [false, 0]]) {
    for (const [margin, radius, hasPosition] of [[80, 310, true], [55, 335, false]]) {
      const x = leftSide ? margin : 800 - margin;
      const expected = leftSide ? ['name', 'motion', ...(hasPosition ? ['position'] : [])]
        : [...(hasPosition ? ['position'] : []), 'motion', 'name'];
      const box = renderer.placeOuterWordLabel(draw, [name, position, motion], ['Astronomia', 'Astro.'],
        [400, 400], radius, rad, [x, 400], 0, radius + 7, 800, 24, DEFAULT_WHEEL_RENDER_STYLE);
      assert.ok(Math.abs(box.y - 400) < 0.01);
      assert.ok(box.x >= 4 && box.x + box.w <= 796);
      assert.deepEqual(box.runs.map(run => run.classId === name.classId ? 'name'
        : run.classId === motion.classId ? 'motion' : 'position'), expected);
      assert.equal(box.runs.find(run => run.classId === motion.classId).text.trim(), 'R');
      assert.equal(box.runs.find(run => run.classId === motion.classId).weight, 600);
      assert.equal(box.runs.find(run => run.classId === name.classId).text, 'Astro.');
    }
  }
  const glyphs = [{...name, text: 'A', font: 'symbols'}, {...name, text: '/'},
    {...name, text: 'B', font: 'symbols'}];
  const mixed = renderer.placeOuterWordLabel(draw, [...glyphs, position], ['A/B'],
    [400, 400], 330, 0, [740, 400], 0, 337, 800, 24, DEFAULT_WHEEL_RENDER_STYLE);
  assert.deepEqual(mixed.runs.filter(run => run.classId === name.classId), glyphs);
});

test('fixed-star degrees fit only with a recognizable name in both payload paths', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  for (const theme of [0, 1, 2, 3, 4]) for (const fallback of [false, true]) for (const chartSize of [600, 800]) {
    const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
      houses: {system: 'P', cusps: Array.from({length: 12}, (_, i) => i * 30)},
      fixedStars: fallback ? [{name: 'Fomalhaut', longitude: 17.1}, {name: 'Aldebaran', longitude: 197.1}] : [],
      options: {theme, showHouses: false, showPositions: false, showOuterPositions: false,
        showTerms: false, showDecans: false, showAspects: false, showSymbols: false, signVariant: 1}};
    const items = ['Fomalhaut', 'Aldebaran'].map((listLabel, index) => ({
      id: `star-${index}`, family: 'fixstar', label: `${listLabel} 17°06'`, listLabel,
      longitude: 17.1 + index * 180, positionInLabel: true,
      segments: [{text: `${listLabel} 17°06'`, kind: 'text'}],
    }));
    const snapshot = {primaryChart: chart, outerRingMode: 'fixstars',
      outerRingItems: {fixstars: fallback ? [] : items}, overlayRenderMode: 'full'};
    const opts = {width: 800, height: 800, chartSize, renderStyle: DEFAULT_WHEEL_RENDER_STYLE};
    const text = [], draw = new renderer.CanvasDraw(recordingCanvas(text));
    draw.resize(800, 800, 1);
    renderer.drawSnapshotLayer(draw, snapshot, 'outer-label', opts);
    const printed = text.map(run => run.text).join(' ');
    assert.equal((printed.match(/17°06'/g) ?? []).length, chartSize === 600 ? 2 : 0,
      'positions are omitted when they leave no room for the name');
    assert.match(printed, /Fom/);
    assert.match(printed, /Ald/);
    assert.ok(text.every(run => !/^\.+$/.test(run.text.trim())), 'names never become ellipsis-only runs');
    if (!fallback) {
      const hits = renderer.computeHitRegions(snapshot, {...opts, textsize: (value, paint) => draw.textsize(value, paint)});
      assert.deepEqual(hits.filter(hit => hit.kind === 'secondary_ring').map(hit => hit.label).sort(),
        items.map(item => item.label).sort());
    }
  }
});

test('asteroid and hybrid rings fit names and positions together without changing leaders', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  for (const mode of ['asteroids', 'hybrid_hits']) for (const theme of [0, 1, 2, 3, 4]) {
    const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
      angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
      houses: {system: 'P', cusps: Array.from({length: 12}, (_, i) => i * 30)},
      options: {theme, showHouses: false, showPositions: false, showOuterPositions: true,
        showOuterMinutes: true, showTerms: false, showDecans: false,
        showAspects: false, showSymbols: false, signVariant: 1}};
    const items = ['Astronomia', 'Astraea'].map((label, index) => ({
      id: `asteroid-${index}`, family: 'asteroid', label, longitude: 17.1 + index * 180,
      degText: '17', minText: '06', motion: 'R',
      segments: [{text: label, kind: 'text'}],
    }));
    const snapshot = {primaryChart: chart, outerRingMode: mode,
      outerRingItems: {[mode]: items}, overlayRenderMode: 'full'};
    const opts = {width: 800, height: 800, chartSize: 800, renderStyle: DEFAULT_WHEEL_RENDER_STYLE};
    const text = [], lines = [], draw = new renderer.CanvasDraw(recordingCanvas(text));
    draw.resize(800, 800, 1);
    draw.line = points => lines.push(points);
    renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', opts);
    renderer.drawSnapshotLayer(draw, snapshot, 'outer-label', opts);
    const hits = renderer.computeHitRegions(snapshot, {...opts, textsize: (value, paint) => draw.textsize(value, paint)});
    const printed = text.map(run => run.text).join(' ');
    assert.equal(text.filter(run => run.text.startsWith('A')).length, 2,
      'both asteroid identities survive, even when the last-resort prefix is ambiguous');
    assert.equal(text.filter(run => run.text.trim() === 'R').length, 2);
    assert.ok(!printed.includes('17°'), 'no orphan positions on a narrow asteroid ring');
    for (const item of items) {
      const hit = hits.find(hit => hit.kind === 'secondary_ring' && hit.itemId === item.id);
      assert.equal(hit.label, item.label);
      assert.equal(hit.longitude, item.longitude);
      assert.ok(lines.some(line => line.every((point, index) => point.every((value, axis) =>
        Math.abs(value - [hit.leader.start, hit.leader.end][index][axis]) < 0.01))),
      'each asteroid keeps its original tick');
    }
  }
});


test('close asteroid names retain distinguishing endings instead of overflowing as full names', async () => {
  const names = [{label: 'Maximiliandu'}, {label: 'Maximiliana'}];
  const choices = outerLabelCandidates(names);
  assert.ok(choices.get('Maximiliandu').includes('Max…u'));
  assert.ok(choices.get('Maximiliana').includes('Max…na'));
  const reserved = outerLabelCandidates([...names, {label: 'Max…du'}]);
  assert.ok(!reserved.get('Maximiliandu').includes('Max…du'), 'full names reserve matching abbreviations');
  assert.ok(!choices.get('Maximiliandu').includes('Max.'), 'shared prefixes remain ambiguous');
  const renderer = await loadDrawChartCollisionInternals();
  const draw = {textsize: text => [Array.from(text).length * 6, 12]};
  for (const [label, x, rad] of [['Maximiliandu', 45, Math.PI], ['Maximiliana', 755, 0]]) {
    const name = {text: label, font: 'ui', fontFamily: 'test', size: 12,
      weight: 400, style: 'normal', tracking: 0, opacity: 1, color: '#000',
      classId: 'secondaryRing.asteroid.label'};
    const degree = {...name, text: ' 17°42′', classId: 'bodies.outer.position'};
    const fitted = renderer.placeOuterWordLabel(draw, [name, degree], choices.get(label),
      [400, 400], 345, rad, [x, 400], 0, 352, 800, 24, DEFAULT_WHEEL_RENDER_STYLE);
    assert.ok(fitted.x >= 4 && fitted.x + fitted.w <= 796, 'the whole name stays inside the pane');
    assert.equal(fitted.runs.length, 1, 'degrees yield to the recognizable name');
    assert.ok(fitted.runs[0].text.startsWith('Max'));
    assert.ok(fitted.runs[0].text.endsWith(label.slice(-1)), 'the distinguishing ending survives');
    assert.equal(fitted.y, 400);
  }
});


test('final outer-name fallback bounds every text family and permits ambiguous prefixes', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const draw = {textsize: text => [Array.from(text).length * 6, 12]};
  for (const family of ['asteroid', 'arabicPart', 'fixedStar', 'midpoint', 'hybridHit']) {
    const name = {text: 'Maximiliandu', font: 'ui', fontFamily: 'test', size: 12,
      weight: 400, style: 'normal', tracking: 0, opacity: 1, color: '#000',
      classId: `secondaryRing.${family}.label`};
    const degree = {...name, text: " 17°42′", classId: 'bodies.outer.position'};
    for (const left of [true, false]) for (const margin of [45, 28, 13, 5, 0]) {
      const x = left ? margin : 800 - margin;
      const box = renderer.placeOuterWordLabel(draw, [name, degree], [name.text],
        [400, 400], 340, left ? Math.PI : 0, [x, 400], 0, 347, 800, 24, DEFAULT_WHEEL_RENDER_STYLE);
      assert.ok(box.x >= 0 && box.x + box.w <= 800, `${family}/${margin}: no overflow`);
      const printed = box.runs.map(run => run.text).join('');
      assert.ok(!printed.includes('°'), 'a position never survives without its name');
      if (margin >= 13) assert.match(printed, /^M/, 'the fallback keeps the name prefix');
      assert.notEqual(printed, '.', 'never replace the whole identity with punctuation');
      assert.equal(box.y, 400, 'no label relocation or leader rerouting');
    }
  }
  const name = {text: 'Maximiliana', font: 'ui', fontFamily: 'test', size: 12,
    weight: 400, style: 'normal', tracking: 0, opacity: 1, color: '#000',
    classId: 'secondaryRing.asteroid.label'};
  const box = renderer.placeOuterWordLabel(draw, [name], [name.text],
    [400, 400], 340, Math.PI, [28, 400], 0, 347, 800, 24, DEFAULT_WHEEL_RENDER_STYLE);
  assert.equal(box.runs.map(run => run.text).join(''), 'Max.');
});

test('last-resort prefixes preserve graphemes, motion and mixed glyph typography', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
  const draw = {textsize: text => [Array.from(segmenter.segment(text)).length * 6, 12]};
  const name = {text: 'A\u0301bcdefghijklmnop', font: 'ui', fontFamily: 'test', size: 12,
    weight: 400, style: 'normal', tracking: 0, opacity: 1, color: '#000',
    classId: 'secondaryRing.asteroid.label'};
  const motion = {...name, text: ' R', classId: 'secondaryRing.asteroid.motion', weight: 600};
  const fitted = renderer.placeOuterWordLabel(draw, [name, motion], [name.text],
    [400, 400], 340, Math.PI, [40, 400], 0, 347, 800, 24, DEFAULT_WHEEL_RENDER_STYLE);
  assert.equal(fitted.runs.map(run => run.text).join(''), 'A\u0301bc. R');
  assert.equal(fitted.runs.at(-1).weight, 600);
  const tight = renderer.placeOuterWordLabel(draw, [name, motion], [name.text],
    [400, 400], 340, Math.PI, [13, 400], 0, 347, 800, 24, DEFAULT_WHEEL_RENDER_STYLE);
  assert.equal(tight.runs.map(run => run.text).join(''), 'A\u0301');
  const glyphs = [{...name, text: 'A', font: 'symbols', fontFamily: 'glyphs'},
    {...name, text: '/'}, {...name, text: 'B', font: 'symbols', fontFamily: 'glyphs'}];
  const mixed = renderer.placeOuterWordLabel(draw, glyphs, ['A/B'],
    [400, 400], 340, Math.PI, [13, 400], 0, 347, 800, 24, DEFAULT_WHEEL_RENDER_STYLE);
  assert.equal(mixed.runs[0].text, 'A');
  assert.equal(mixed.runs[0].fontFamily, 'glyphs');
});

test('projected outer points retain hover identities when no text can fit', async () => {
  const renderer = await loadDrawChartCollisionInternals();
  const chart = {meta: {cornerLines: {}}, planets: [], aspects: [],
    angles: {asc: 0, dsc: 180, mc: 270, ic: 90},
    houses: {system: 'P', cusps: Array.from({length: 12}, (_, i) => i * 30)},
    options: {theme: 2, showHouses: false, showPositions: false, showOuterPositions: true,
      showTerms: false, showDecans: false, showAspects: false, showSymbols: false}};
  const item = {id: 'long-name', family: 'arabic_part', label: 'Marriage of women',
    longitude: 0, degText: '0', minText: '00'};
  const snapshot = {primaryChart: chart, outerRingMode: 'arabic_parts',
    outerRingItems: {arabic_parts: [item]}, overlayRenderMode: 'full'};
  const opts = {width: 800, height: 800, chartSize: 800, renderStyle: DEFAULT_WHEEL_RENDER_STYLE};
  const scene = renderer.resolveProjectedOuterRing(snapshot, opts,
    {chart, items: [item], frame: renderer.identityFrame(0), boundaryRadius: 460});
  const text = [], hits = [], draw = new renderer.CanvasDraw(recordingCanvas(text));
  draw.resize(800, 800, 1);
  renderer.paintProjectedOuterRing(draw, scene, (point, box) => hits.push({point, box}));
  assert.equal(text.length, 0, 'no off-canvas text or orphan degree');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].point.label, item.label);
  assert.equal(hits[0].point.longitude, item.longitude);
  assert.ok(hits[0].box.x >= 0 && hits[0].box.x <= 800);
});
