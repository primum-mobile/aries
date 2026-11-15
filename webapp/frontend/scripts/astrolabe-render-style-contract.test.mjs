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
  divisionSignShare: 0.6,
  termBandScale: 0.034,
  decanBandScale: 0.026,
  divisionGlyphScale: 0.72,
  divisionGlyphMin: 5,
  polarDivisionBandScale: 0.018,
  polarDivisionOpacity: 0.4,
  bareEclipticTickScale: 0.5,
  bareSignGlyphScale: 0.5,
  eclipticScaleTick1: 1,
  eclipticScaleTick5: 1.8,
  eclipticScaleTick10: 2.5,
  eclipticScaleWeight: 0.8,
  eclipticBandWidthSteps: 1,
  eclipticBandBoxDegrees: 5,
  eclipticBandTickShare: 1,
  tickStepScale: 0.008,
  innerRadiusMin: 1,
  starRadiusMin: 1,
  starRadiusDivisor: 590,
  starBrightLimit: 2.5,
  starMagnitudeExponent: 0.3,
  starScaleMin: 0.3,
  starScaleMax: 1.6,
  starFaintOpacity: 0.35,
  signFontDivisor: 24,
  signCullScale: 0.03,
  sphereRadiusMin: 1.5,
  sphereRadiusDivisor: 190,
  planetFontDivisor: 22.22,
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
  polarRimFill: 0.78,
  polarLaneGapScale: 0.012,
  polarRingFontScale: 0.5,
  polarAngleFontScale: 0.62,
  polarStarLabelScale: 0.62,
  polarLeaderOpacity: 0.72,
  zoomRampStart: 2,
  zoomRampEnd: 4,
  zoomLatticeFade: 0.55,
  zoomHouseNumberExponent: 0.5,
  zoomHouseNumberCap: 2.6,
  zoomSphereExponent: 0.5,
  zoomSphereCap: 4,
  zoomGlyphExponent: 0.4,
  zoomGlyphCap: 2.5,
  zoomStarExponent: 0.2,
  zoomStarCap: 1.6,
  zoomStarLabelExponent: 0.12,
  zoomStarLabelCap: 1.3,
  notchHalfLength: 5,
  notchZoomExponent: 0.3,
  notchZoomCap: 1.8,
  notchRampStart: 2,
  notchRampEnd: 3,
  notchWidthScale: 1.6,
  diskThreshold: 1.2,
  diskFillOpacity: 0.14,
  diskOutlineOpacity: 0.55,
  angleTickScale: 0.6,
  angleLabelScale: 0.7,
  contactHalfLength: 40,
  contactGlow: 6,
  notchContactWidthScale: 2.4,
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
  regioZoomed: "rgb(138 139 141 / 86%)",
  contact: "rgb(246 0 206)",
  almucantar: "rgb(138 139 141 / 34%)",
  azimuth: "rgb(138 139 141 / 28%)",
  hour: "rgb(205 205 209 / 25%)",
  capricorn: "rgb(220 220 221)",
  star: "rgb(255 255 255 / 88%)",
  starFaint: "rgb(138 139 141)",
  cardinal: "rgb(205 205 209)",
  sunFill: "rgb(255 215 0)",
  primeVertical: "rgb(138 139 141 / 52%)",
  earth: "rgb(255 255 255 / 40%)",
  declination: "rgb(138 139 141 / 50%)",
  termRing: "rgb(220 220 221)",
  termBoundary: "rgb(220 220 221)",
  decanBoundary: "rgb(220 220 221)",
  subdivisionGlyph: "rgb(215 215 217)",
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
    divisionSignShare: style.layout.divisionSignShare,
    termBandScale: style.layout.termBandScale,
    decanBandScale: style.layout.decanBandScale,
    divisionGlyphScale: style.layout.divisionGlyphScale,
    divisionGlyphMin: style.layout.divisionGlyphMin,
    polarDivisionBandScale: style.layout.polarDivisionBandScale,
    polarDivisionOpacity: style.layout.polarDivisionOpacity,
    bareEclipticTickScale: style.layout.bareEclipticTickScale,
    bareSignGlyphScale: style.layout.bareSignGlyphScale,
    eclipticScaleTick1: style.layout.eclipticScaleTick1,
    eclipticScaleTick5: style.layout.eclipticScaleTick5,
    eclipticScaleTick10: style.layout.eclipticScaleTick10,
    eclipticScaleWeight: style.layout.eclipticScaleWeight,
    eclipticBandWidthSteps: style.layout.eclipticBandWidthSteps,
    eclipticBandBoxDegrees: style.layout.eclipticBandBoxDegrees,
    eclipticBandTickShare: style.layout.eclipticBandTickShare,
    tickStepScale: style.layout.tickStepScale,
    innerRadiusMin: style.layout.innerRadiusMin,
    starRadiusMin: style.markers.starRadiusMin,
    starRadiusDivisor: style.markers.starRadiusDivisor,
    starBrightLimit: style.markers.starBrightLimit,
    starMagnitudeExponent: style.markers.starMagnitudeExponent,
    starScaleMin: style.markers.starScaleMin,
    starScaleMax: style.markers.starScaleMax,
    starFaintOpacity: style.markers.starFaintOpacity,
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
    polarRimFill: style.layout.polarRimFill,
    polarLaneGapScale: style.layout.polarLaneGapScale,
    polarRingFontScale: style.layout.polarRingFontScale,
    polarAngleFontScale: style.layout.polarAngleFontScale,
    polarStarLabelScale: style.layout.polarStarLabelScale,
    polarLeaderOpacity: style.layout.polarLeaderOpacity,
    zoomRampStart: style.zoom.rampStart,
    zoomRampEnd: style.zoom.rampEnd,
    zoomLatticeFade: style.zoom.latticeFade,
    zoomHouseNumberExponent: style.zoom.houseNumber.exponent,
    zoomHouseNumberCap: style.zoom.houseNumber.cap,
    zoomSphereExponent: style.zoom.sphere.exponent,
    zoomSphereCap: style.zoom.sphere.cap,
    zoomGlyphExponent: style.zoom.glyph.exponent,
    zoomGlyphCap: style.zoom.glyph.cap,
    zoomStarExponent: style.zoom.star.exponent,
    zoomStarCap: style.zoom.star.cap,
    zoomStarLabelExponent: style.zoom.starLabel.exponent,
    zoomStarLabelCap: style.zoom.starLabel.cap,
    notchHalfLength: style.zoom.notch.halfLength,
    notchZoomExponent: style.zoom.notch.exponent,
    notchZoomCap: style.zoom.notch.cap,
    notchRampStart: style.zoom.notch.rampStart,
    notchRampEnd: style.zoom.notch.rampEnd,
    notchWidthScale: style.zoom.notch.widthScale,
    diskThreshold: style.zoom.disk.threshold,
    diskFillOpacity: style.zoom.disk.fillOpacity,
    diskOutlineOpacity: style.zoom.disk.outlineOpacity,
    angleTickScale: style.zoom.angle.tickScale,
    angleLabelScale: style.zoom.angle.labelScale,
    contactHalfLength: style.zoom.contact.halfLength,
    contactGlow: style.zoom.contact.glow,
    notchContactWidthScale: style.zoom.contact.notchWidthScale,
  };
}

test("schema v3 preserves the refined Astrolabe paint hierarchy", () => {
  assert.equal(Object.keys(ASTROLABE_RENDER_TOKEN_SPECS).length, 100);
  assert.equal(new Set(Object.values(ASTROLABE_RENDER_TOKEN_SPECS).map(([name]) => name)).size, 100);
  assert.equal(Object.keys(ASTROLABE_RENDER_PALETTE_SPECS).length, 25);
  assert.deepEqual(DEFAULT_ASTROLABE_RENDER_TOKENS, EXPECTED_DEFAULTS);
  assert.deepEqual(DEFAULT_ASTROLABE_RENDER_PALETTE, EXPECTED_PALETTE);
  // Chart information and PD rows moved to DOM corner overlays; their canvas
  // tokens are retired rather than left as editable no-ops.
  for (const retired of [
    "infoFontDivisor", "infoFontScale", "infoInsetDivisor", "infoLineHeightScale",
    "pdRowFontDivisor", "pdRowHeightScale", "pdTokenGapScale",
  ]) assert.ok(!(retired in ASTROLABE_RENDER_TOKEN_SPECS), retired);
  for (const retired of ["infoAtmospheric", "infoSchematic"]) {
    assert.ok(!(retired in ASTROLABE_RENDER_PALETTE_SPECS), retired);
  }

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
  const view = await readFile(
    new URL("../src/components/workshell/astrolabe-view.tsx", import.meta.url),
    "utf8",
  );
  const shared = await readFile(
    new URL("../src/components/workshell/astrolabe-canvas.ts", import.meta.url),
    "utf8",
  );
  const polar = await readFile(
    new URL("../src/components/workshell/astrolabe-polar-render.ts", import.meta.url),
    "utf8",
  );
  const source = `${view}\n${shared}`;
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

  // Rete grabs use renderer geometry and continuous angular motion; updates
  // remain frame-batched and cannot turn the directed arc below zero.
  assert.match(source, /!hitAstrolabeRete\(surface, x, y\)/);
  assert.match(source, /ds\.turn \+= astrolabeReteTurn\(ds\.lastAngle, angle\)/);
  assert.match(source, /const clamped = Math\.max\(0, next\)/);
  assert.match(source, /dragFrameRef\.current = window\.requestAnimationFrame\(/);
  assert.match(source, /const snap = geo\.pd\.snapArcs/);
  assert.match(source, /if \(arc > next \+ 0\.001\)/);
  assert.match(source, /drawGraduatedLimb\(/);
  assert.match(source, /const outerR = plateR \+ tickStep \* 3/);
  assert.match(source, /ctx\.moveTo\(cx \+ cos \* plateR, cy \+ sin \* plateR\)/);
  assert.match(source, /ctx\.lineTo\(cx \+ cos \* \(plateR \+ length\), cy \+ sin \* \(plateR \+ length\)\)/);
  assert.match(source, /const limbOuterR = chartRpx \+ tickStep \* 3/);
  // Both plates put their limb on the common chart ring (Anglo outer zodiac).
  assert.match(source, /resolveChartPaintTarget\(cssW, cssH, 1\)/);
  assert.match(source, /--aries-wheel-anglo-zodiac-single/);
  assert.match(source, /ANGLO_WHEEL_GEOMETRY_PROFILE\.zodiacSingle/);
  assert.match(source, /limbFill: capFill \+ style\.layout\.tickStepScale \* 3/);
  assert.match(source, /topBoundary: paintTopBoundary/);
  assert.match(source, /Math\.max\(target\.centerY, top \+ paintR\)/);
  assert.match(source, /cy: plate\.centerY/);
  assert.match(source, /const bodyLabelTop = Math\.max\(paintTopBoundary, 0\) \+ viewportClearance/);
  assert.match(source, /const labelDirection = outwardCrossesLimb \? -1 : 1/);
  assert.match(source, /chartRpx - limbClearance - Math\.hypot\(item\.tw, item\.th\) \/ 2/);
  assert.match(source, /clampBodyLabel\(si\);\s*clampBodyLabel\(sj\);/);
  assert.match(source, /fetchAstrolabeViewState\(documentId/);
  assert.match(source, /storeAstrolabeViewState\(documentId, state\)/);
  // The view menu folds its layers into topic submenus.
  for (const key of ["ecliptic", "plateLines", "fixedStars", "skyAndEarth"]) {
    assert.match(source, new RegExp(`<ContextMenuSubTrigger>\\{t\\("astrolabe\\.${key}"\\)\\}<\/ContextMenuSubTrigger>`));
  }
  assert.match(source, /<ContextMenuLabel>\{t\("astrolabe\.backgroundOpacity"\)\}<\/ContextMenuLabel>/);
  assert.doesNotMatch(source, /function LayerBar/);

  const fetchBlock = source.slice(
    source.indexOf("// Geometry fetch"),
    source.indexOf("// Draw on geometry"),
  );
  assert.match(
    source,
    /const geometryRevision = `\$\{sessionRefreshSeq\}:\$\{projection\}:\$\{lattice \? 1 : 0\}:\$\{fullSphere \? 1 : 0\}`/,
  );
  assert.match(fetchBlock, /\}, \[sourceName, source, documentId\]\);/);
  assert.match(fetchBlock, /\}, \[asterisms, delta, fullSphere, geometryRevision, lattice, markedStars, pdFocus, pdOverlay, projection, pumpFetch,\s+starField\]\);/);
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
    /\}, \[geo, earth, fontsReady, paintToggles, t, resolvePaintStyle, clearInspectorHover\]\);/,
  );
  assert.match(paintBlock, /geo\.projection === "polarEquidistant"/);
  assert.match(paintBlock, /renderPolarAzimuthal\(/);

  // The polar plate paints from the same resolved style and daemon colours.
  assert.match(polar, /resolveAstrolabeStrokeWidths\(style, size\)/);
  assert.match(polar, /style\.layout\.polarRimFill \+ style\.layout\.tickStepScale \* 3/);
  assert.match(polar, /topBoundary: paintTopBoundary/);
  assert.match(polar, /cy: plate\.centerY/);
  assert.match(polar, /ctx\.fillStyle = geo\.atmospheric\.ground/);
  assert.match(polar, /ctx\.fillStyle = geo\.atmospheric\.sky/);
  assert.match(polar, /createResolvedSemanticChartColorResolver\(\)/);
  assert.match(polar, /drawGraduatedLimb\(draw, layout\.cx, layout\.cy, rimPx/);
  assert.match(polar, /drawReteArcSpan\(draw, layout\.cx, layout\.cy, rimPx, tickStep/);
  assert.match(source, /drawReteArcSpan\(draw, layout\.cx, layout\.cy, chartRpx, tickStep/);
  // Hosted in the chart area beside right panes: the canvas stays out of flow
  // so its backing store can never grow the shared row.
  assert.match(source, /className="absolute inset-0 block h-full w-full cursor-grab/);
  // Chart information and PD rows are the wheel's DOM corner overlays.
  assert.match(source, /<AstrolabeCorners/);
  assert.doesNotMatch(polar, /#[0-9a-f]{3,6}\b|rgb\(/i);
  assert.match(source, /state\.liveAppThemePreview \? `live:\$\{state\.revision\}` : "live:off"/);
  assert.match(source, /const observer = new ResizeObserver\(\(\) => requestFrameRef\.current\?\.\(\)\)/);
  assert.match(source, /window\.requestAnimationFrame\(paint\)/);
});
