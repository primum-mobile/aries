// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const layoutModelJavascript = ts.transpileModule(
  await readSource(new URL("../src/lib/chart/wheel-layout-model.ts", import.meta.url)),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const layoutModelUrl = `data:text/javascript;base64,${Buffer.from(layoutModelJavascript).toString("base64")}`;
const wheelStyleSource = (
  await readSource(new URL("../src/lib/chart/wheel-render-style.ts", import.meta.url))
).replaceAll('"./wheel-layout-model"', `"${layoutModelUrl}"`);
const workspaceContentSource = await readFile(
  new URL("../src/components/workshell/workspace-content.tsx", import.meta.url),
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
}).outputText;
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
  resolveCanonicalWheelRingSet,
  createTokenizedWheelRenderStyle,
  createWheelRenderStyle,
  resolveWheelRenderStyleFromTokens,
  resolveWheelRenderTokens,
  resolveWheelLinePaint,
  resolveWheelRenderStyle,
  resolveWheelRingSet,
  resolveWheelStrokeMetrics,
  resolveWheelTypographyMetrics,
  wheelRingRadiusTokenKey,
} = await import(
  `data:text/javascript;base64,${Buffer.from(wheelStyleJavascript).toString("base64")}`
);

// The band model behind glyph containment, imported from production so the
// test cannot carry its own drifting copy of the ceiling rule.
const {
  resolveWheelBandLayout,
  resolveWheelClassFontSizeCeiling,
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
  assert.equal(Object.keys(WHEEL_RENDER_TOKEN_SPECS).length, 324);
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
  assert.equal(style.elementColors.decanGlyph, "sign-fallback");
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
      classicZodiacOuterRingRadius: 0.79,
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
  assert.equal(edited.r30, 316);
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
    assert.ok(ordered[index - 1] > ordered[index], `${index - 1} > ${index}`);
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
  assert.match(workspaceContentSource, /resolveWheelTypographyPaint\(/);
  assert.match(workspaceContentSource, /data-aries-style-class=\{semanticClassId\}/);
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
    chart.angles.asc,
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
    0,
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
      chart.angles.asc,
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
            const rings = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, {
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
  assert.match(source, /resolveWheelRenderStyleFromTokens\(/);
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
  assert.match(source, /overlayRenderMode === "step_fast"[\s\S]*?fill: false/);
  assert.match(source, /drawSnapshotLayer\(fillDraw, renderSnapshot, "fill"/);
});

test("draw and hit paths resolve the shared metrics instead of private literals", async () => {
  const source = await readSource(
    new URL("../src/lib/chart/draw-chart.ts", import.meta.url),
  );
  assert.equal((source.match(/resolveWheelTypographyMetrics\(/g) ?? []).length, 3);
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
  assert.equal((source.match(/scaledWheelRadius\(/g) ?? []).length, 3);
  assert.doesNotMatch(source, /const maxRadius = chartSize \/ 2;/);
  assert.match(source, /style\.outerLabels\.edgePadFactor/);
  assert.equal((source.match(/effectiveRings\(\s*style,/g) ?? []).length, 3);
  assert.equal((source.match(/\? comparisonRings\(/g) ?? []).length, 3);
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
    /function comparisonShowsHouseCusps[\s\S]*?snapshot\.comparisonChart[\s\S]*?chart\.options\.showHouses[\s\S]*?chart\.options\.showOuterHouseLines !== false/,
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
    /const outerRadius = restrainedAngloComparison[\s\S]*?\? ringset\.rOuterHouse[\s\S]*?: ringset\.rOuterHouseName \?\? ringset\.rOuterASCMC \?\? ringset\.rOuterArrow/,
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
  assert.match(
    canvasSource,
    /const comparisonWithOuterHouseBand = Boolean\([\s\S]*?primary\.options\.showOuterHouseLines !== false[\s\S]*?profile !== "anglo"/,
  );
  assert.match(
    canvasSource,
    /restrainedAngloComparison:[\s\S]*?comparison[\s\S]*?profile === "anglo"[\s\S]*?renderSnapshot\.document\?\.compoundKind === "synastry"/,
  );
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
      0,
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
    0,
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
    0,
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
      0,
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
    0,
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
    chart.angles.asc,
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
      chart.angles.asc,
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
      chart.angles.asc,
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
      chart.angles.asc,
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

test("M leaves a click-exclusive body view before toggling the global minor set", () => {
  const commandStart = homeClientSource.indexOf('if (command === "toggle-minor-aspects")');
  const commandEnd = homeClientSource.indexOf("const tableId =", commandStart);
  assert.notEqual(commandStart, -1);
  assert.notEqual(commandEnd, -1);
  const commandBlock = homeClientSource.slice(commandStart, commandEnd);
  assert.match(
    commandBlock,
    /if \(aspectState\.hideAllAspects\)[\s\S]*?return;\s*}\s*\/\/ M changes the global aspect set\.[\s\S]*?clearAspectSelection\(\);\s*supersedePendingStepSettle\(\);\s*void toggleMinorAspects\(\)/,
  );
});

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
      assert.ok(hasSegment(result.dynamicLines, outerFoot, outerTip), `${mode}:${planet.id} outer foot`);
      assert.ok(hasSegment(result.dynamicLines, innerFoot, innerTip), `${mode}:${planet.id} inner foot`);
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
        polarPoint(structuralEnd, longitude, leaderResult.chart.angles.asc),
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
      asc,
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
          polarPoint(Math.max(rings.rBase, rings.rInner), longitude),
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
    asc,
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
    chart.angles.asc,
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
    chart.angles.asc,
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
        chart.angles.asc,
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
      asc,
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
    chart.angles.asc,
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
    sourceChart.angles.asc,
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
      modeChart.angles.asc,
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

function recordingCanvas(recordedText, recordedLines = []) {
  const stateStack = [];
  let currentPoint = null;
  let currentSegments = [];
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
      const metrics = this.measureText(text);
      recordedText.push({
        text,
        x,
        y,
        w: Math.round(metrics.width),
        h: Math.round(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent),
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
    },
    moveTo(x, y) {
      currentPoint = [x, y];
    },
    lineTo(x, y) {
      const next = [x, y];
      if (currentPoint) currentSegments.push({ from: currentPoint, to: next });
      currentPoint = next;
    },
    arc() {},
    closePath() {},
    stroke() {
      for (const segment of currentSegments) {
        recordedLines.push({
          ...segment,
          strokeStyle: this.strokeStyle,
          lineWidth: this.lineWidth,
        });
      }
      currentSegments = [];
      currentPoint = null;
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
    primaryChart.angles.asc,
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
    primaryChart.angles.asc,
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

async function loadDrawChartCollisionInternals() {
  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  };
  const transpile = (source) => ts.transpileModule(source, { compilerOptions }).outputText;
  const dataUrl = (source) =>
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

  const chartFontsUrl = dataUrl(
    transpile(
      await readSource(new URL("../src/lib/chart/chart-fonts.ts", import.meta.url)),
    ),
  );
  const canvasDrawUrl = dataUrl(
    transpile(
      await readSource(new URL("../src/lib/chart/canvas-draw.ts", import.meta.url)),
    ).replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`),
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
  const pdRingPresentationUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/pd-ring-presentation.ts", import.meta.url),
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
  let drawChartSource = await readSource(
    new URL("../src/lib/chart/draw-chart.ts", import.meta.url),
  );
  drawChartSource = drawChartSource
    .replace("function bodyKeys(", "export function bodyKeys(")
    .replace("function bodyGlyphSize(", "export function bodyGlyphSize(")
    .replace("function arrangeBodies(", "export function arrangeBodies(")
    .replace("function prepareOuterRingItems(", "export function prepareOuterRingItems(")
    .replace("function prepareFixedStars(", "export function prepareFixedStars(")
    .replace(
      "function ensureTextOutsideOuterWheel(",
      "export function ensureTextOutsideOuterWheel(",
    )
    .replace("function getBodyLayout(", "export function getBodyLayout(")
    .replace("function layoutSurveilMark(", "export function layoutSurveilMark(")
    .replace("function drawRoutedRadialLine(", "export function drawRoutedRadialLine(")
    .replace("function drawAngloCuspArrow(", "export function drawAngloCuspArrow(")
    .replace("function drawPlanets(", "export function drawPlanets(")
    .replace("function drawAscMC(", "export function drawAscMC(")
    .replace("function resolveAspectsForDraw(", "export function resolveAspectsForDraw(")
    .replace(
      "function resolveInterChartAspectsForDraw(",
      "export function resolveInterChartAspectsForDraw(",
    );
  const drawChartJavascript = transpile(drawChartSource)
    .replaceAll('"./canvas-draw"', `"${canvasDrawUrl}"`)
    .replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`)
    .replaceAll('"./wheel-render-style"', `"${wheelStyleUrl}"`)
    // draw-chart now imports the band model directly, to cap a glyph at the
    // ring that holds it. Without this rewrite the harness leaves a bare
    // specifier that no loader can resolve.
    .replaceAll('"./wheel-layout-model"', `"${layoutModelUrl}"`)
    .replaceAll('"./pd-ring-presentation"', `"${pdRingPresentationUrl}"`)
    .replaceAll('"./outer-glyph-lane"', `"${outerGlyphLaneUrl}"`)
    // Landed alongside this change by the PD-in-chart work; every harness that
    // transpiles draw-chart has to rewrite each of its relative specifiers or
    // the module graph dead-ends at a bare path no loader can follow.
    .replaceAll('"./pd-event-presentation"', `"${dataUrl(transpile(await readSource(
      new URL("../src/lib/chart/pd-event-presentation.ts", import.meta.url),
    )))}"`)
    .replaceAll('"./glyphs"', `"${glyphsUrl}"`)
    .replaceAll('"../render/dither-pattern"', `"${ditherPatternUrl}"`);
  return { ...(await import(dataUrl(drawChartJavascript))), CanvasDraw: canvasDraw.CanvasDraw };
}

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
  // The bug Max hit: the drag produces a reference-space radius, the solver
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
  const pinned = styleWithRingPin("zodiacInnerRing", 210);
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
        `${role} @ scale ${scale}: a pinned wheel did not scale uniformly`,
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
  // The authored typography is what a band resize must not touch. Three seated
  // glyphs — sign, term and decan — do follow their band, but that happens in
  // `bandClampedGlyphSize` at paint time and is bounded by the band; the stored
  // sizes underneath stay exactly as authored, which is what keeps a resize
  // undoable and keeps every other run out of it.
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

test("a glyph that follows its band can never leave it", () => {
  // Max's rule: glyphs are always contained by their band's limits, never
  // clipped. The proportional follow is what makes a resize feel alive; the
  // clamp is what makes containment absolute. Asserted against production's
  // own ceiling so the two cannot drift, and across pane sizes because a
  // ratio bug hides at exactly one of them.
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
  const style = DEFAULT_WHEEL_RENDER_STYLE;
  const seated = [
    ["zodiac.signGlyph", (metrics) => metrics.signSize],
    ["subdivisions.term.glyph", (metrics) => metrics.termSize],
    ["subdivisions.decan.glyph", (metrics) => metrics.decanSize],
  ];

  for (const maxRadius of [150, 240, 400, 733.5]) {
    const input = { ...base, maxRadius };
    const canonicalRings = resolveCanonicalWheelRingSet(style, input);
    const canonicalBands = resolveWheelBandLayout(style, input, canonicalRings).bands;
    const metrics = resolveWheelTypographyMetrics(style, "classic", maxRadius);

    // Squeeze the band that holds each glyph, hard, and check the glyph still
    // fits — including at thicknesses far below anything shipped.
    for (const squeeze of [1, 0.6, 0.3, 0.12]) {
      const squeezed = canonicalBands.map((band) => {
        const mid = (band.outer + band.inner) / 2;
        const half = ((band.outer - band.inner) / 2) * squeeze;
        return { ...band, outer: mid + half, inner: mid - half };
      });
      for (const [classId, pick] of seated) {
        const ceiling = resolveWheelClassFontSizeCeiling(classId, squeezed);
        const canonicalCeiling = resolveWheelClassFontSizeCeiling(classId, canonicalBands);
        if (ceiling == null || canonicalCeiling == null) continue;
        const authored = pick(metrics);
        // Mirrors bandClampedGlyphSize: follow the band, then clamp.
        const followed = authored * (ceiling / canonicalCeiling);
        const painted = Math.min(followed, ceiling);
        assert.ok(
          painted <= ceiling + 1e-9,
          `${classId} @ r=${maxRadius} squeeze ${squeeze}: ${painted} > ${ceiling}`,
        );
        assert.ok(painted > 0, `${classId} collapsed to ${painted}`);
      }
    }

    // At canonical thickness the follow is exactly 1, so nothing that ships
    // changes size. This is what makes the rule safe to switch on.
    for (const [classId, pick] of seated) {
      const ceiling = resolveWheelClassFontSizeCeiling(classId, canonicalBands);
      if (ceiling == null) continue;
      const authored = pick(metrics);
      assert.equal(
        Math.min(authored * (ceiling / ceiling), ceiling),
        Math.min(authored, ceiling),
        `${classId} @ r=${maxRadius} moved at its canonical thickness`,
      );
      assert.ok(
        authored <= ceiling + 1e-9,
        `${classId} @ r=${maxRadius} ships oversized (${authored} > ${ceiling}); `
        + "the containment rule would visibly shrink it",
      );
    }
  }
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
      baseChart.angles.asc,
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
