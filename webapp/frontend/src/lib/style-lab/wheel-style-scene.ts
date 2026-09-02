// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChartHitRegion } from "../chart/draw-chart";
import {
  resolveWheelBandLayout,
  resolveWheelClassFontSizeCeiling,
} from "../chart/wheel-layout-model";
import {
  WHEEL_RENDER_TOKEN_SPECS,
  WHEEL_BAND_SPANS,
  WHEEL_RULER_DEPTH_RANGE,
  WHEEL_SCALE_RANGE,
  WHEEL_TICK_LENGTH_RANGE,
  resolveCanonicalWheelRingSet,
  resolveWheelTickLength,
  projectWheelAuthoringStyle,
  resolveWheelPaintedRingRadiusRange,
  resolveWheelBandSpanFields,
  resolveWheelBandSpanScale,
  resolveWheelBandSpanScaleRange,
  resolveWheelRingSet,
  resolveWheelScale,
  resolveWheelSecondaryRingClassIds,
  resolveWheelTypographyMetrics,
  wheelRingRadiusTokenKey,
  type WheelGeometryInput,
  type WheelLinePaintRole,
  type WheelLinePaintTokenKey,
  type WheelLinePaintTokenSuffix,
  type WheelPaintedRingRole,
  type WheelRenderStyle,
  type WheelRulerId,
  type WheelRenderTokens,
  type WheelRingSet,
  type WheelTypographyProfile,
} from "../chart/wheel-render-style";
import {
  hitTestStyleSceneElements,
  resolveStyleSceneHandleDrag,
  type StyleSceneEditability,
  type StyleSceneAuthoringDefaults,
  type StyleSceneElement,
  type StyleSceneHandle,
  type StyleSceneHandleDrag,
  type StyleSceneHit,
  type StyleSceneHitGeometry,
  type StyleScenePoint,
  type StyleSceneTokenBinding,
  type StyleSceneTokenDragMetadata,
  type StyleSceneTokenPatch,
  type StyleSceneTokenProperty,
} from "./style-scene";
import { AUTHORING_NUMERIC_PROPERTIES } from "./authoring-schema";
import {
  WHEEL_SEMANTIC_CLASS_MANIFEST,
  isWheelSemanticClassId,
  resolveWheelSemanticCapabilities,
  resolveWheelSemanticApplicability,
  type WheelPreviewFeatureId,
  type WheelSemanticClassDefinition,
} from "./semantic-class-manifest";
import {
  WHEEL_AUTHORING_OVERRIDE_PREFIX,
  WHEEL_CHART_CLASS_ID,
  readWheelAuthoringClassDefaults,
  wheelBandSpanClassId,
  wheelRulerClassId,
  wheelAuthoringOverrideId,
  type WheelAuthoringEditScope,
  type WheelAuthoringFlatProperty,
} from "./wheel-authoring-adapter";

export const WHEEL_STYLE_SCENE_SCHEMA_VERSION = 1 as const;

/**
 * Where the chart-scale handle sits, in scene degrees.
 *
 * Ring radius handles all sit at 0° and ring stroke handles at 45°, so the
 * scale handle is given a quadrant of its own: at the wheel's outer edge it can
 * never be mistaken for, or land on top of, a boundary handle.
 */
const CHART_SCALE_HANDLE_ANGLE = 135;

/** Where a band-span diamond sits — a quadrant from the chart-scale one. */
const BAND_SPAN_HANDLE_ANGLE = 225;

export const WHEEL_STYLE_SCENE_ELEMENT_IDS = {
  root: "wheel",
  canvas: "wheel.canvas",
  chartScale: "wheel.chart-scale",
  bandSpan: "wheel.band-span",
  layerGeometry: "wheel.layers.geometry",
  layerDynamic: "wheel.layers.dynamic",
  layerOuterLabel: "wheel.layers.outer-label",
  fills: "wheel.fills",
  rings: "wheel.rings",
  zodiac: "wheel.zodiac",
  houses: "wheel.houses",
  angles: "wheel.angles",
  bodies: "wheel.bodies",
  aspects: "wheel.aspects",
  secondary: "wheel.secondary",
  overlays: "wheel.overlays",
  ringOuterDegree: "wheel.ring.outer-degree",
  ringZodiacOuter: "wheel.ring.zodiac.outer",
  ringZodiacInner: "wheel.ring.zodiac.inner",
  ringTerms: "wheel.ring.terms",
  ringDecans: "wheel.ring.decans",
  ringCuspOuter: "wheel.ring.cusp-outer",
  ringInner: "wheel.ring.inner",
  ringBody: "wheel.ring.body",
  ringPosition: "wheel.ring.position",
  ringAspect: "wheel.ring.aspect",
  ringBase: "wheel.ring.base",
  ringHouse: "wheel.ring.house",
  ringHouseLabel: "wheel.ring.house-label",
  ringOuterMaximum: "wheel.ring.comparison.maximum",
  ringOuterHouse: "wheel.ring.comparison.house",
  ringOuterBody: "wheel.ring.comparison.body",
  ringOuterLine: "wheel.ring.comparison.line",
  ringProjectedLabel: "wheel.ring.projected-label",
} as const;

export type WheelStyleSceneElementId =
  (typeof WHEEL_STYLE_SCENE_ELEMENT_IDS)[keyof typeof WHEEL_STYLE_SCENE_ELEMENT_IDS]
  | `wheel.${string}`;

export interface WheelStyleSceneBuildInput {
  readonly style: WheelRenderStyle;
  /** The same normalized input passed by production draw/hit paths. */
  readonly geometry: WheelGeometryInput;
  readonly center?: StyleScenePoint;
  readonly viewport?: Readonly<{ width: number; height: number }>;
  readonly ascendantDegrees?: number;
  /** Mirrors the daemon option that chooses per-body rather than dignity colours. */
  readonly useIndividualBodyColors?: boolean;
  /** Selects the exact fire/earth/air/water role painted for zodiac glyphs. */
  readonly useZodiacElementColors?: boolean;
  readonly signColors?: readonly string[];
  /** Existing computeHitRegions() output; no editor-only body layout is made. */
  readonly hitRegions?: readonly ChartHitRegion[];
  /** Direct handle writes target shared base or the visible wheel variant. */
  readonly authoringScope?: WheelAuthoringEditScope;
  /**
   * Authoring override ids the *variant* holds, before base is folded into it.
   *
   * Only direct manipulation reads this, and only to answer one question: is
   * the value this handle is about to write the value the wheel is painted
   * from? Compiled overrides cannot answer it — `compileFlatWheelAuthoringOverrides`
   * folds base into all three profiles first, so by the time the renderer sees
   * them a base-only value and a variant value are indistinguishable.
   */
  readonly variantAuthoredOverrideIds?: ReadonlySet<string>;
}

type StyleTargetHitRegion = Extract<
  ChartHitRegion,
  { kind: "style_target" }
>;

function asStyleTargetHitRegion(
  region: ChartHitRegion,
): StyleTargetHitRegion | null {
  return region.kind === "style_target" && region.styleOnly === true
    ? region
    : null;
}

export interface WheelStyleScene {
  readonly schemaVersion: typeof WHEEL_STYLE_SCENE_SCHEMA_VERSION;
  readonly profile: WheelTypographyProfile;
  readonly mode: WheelGeometryInput["mode"];
  readonly center: StyleScenePoint;
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly rings: Readonly<WheelRingSet>;
  readonly elements: readonly StyleSceneElement[];
  readonly handles: readonly StyleSceneHandle[];
}

const EDITABLE: StyleSceneEditability = Object.freeze({
  state: "editable",
  reason: "public-token",
});
const DERIVED_GEOMETRY: StyleSceneEditability = Object.freeze({
  state: "read-only",
  reason: "derived-geometry",
  detail: "Resolved from canonical wheel geometry inputs.",
});
const CODE_OWNED_GEOMETRY: StyleSceneEditability = Object.freeze({
  state: "read-only",
  reason: "code-owned-geometry",
  detail: "This geometry has not been promoted to the bounded public catalog.",
});
const SELECTION_ONLY: StyleSceneEditability = Object.freeze({
  state: "read-only",
  reason: "selection-only",
});

const MANIFEST_PARENT_IDS = Object.freeze({
  canvas: WHEEL_STYLE_SCENE_ELEMENT_IDS.root,
  layers: WHEEL_STYLE_SCENE_ELEMENT_IDS.root,
  rings: WHEEL_STYLE_SCENE_ELEMENT_IDS.rings,
  fills: WHEEL_STYLE_SCENE_ELEMENT_IDS.fills,
  zodiac: WHEEL_STYLE_SCENE_ELEMENT_IDS.zodiac,
  subdivisions: WHEEL_STYLE_SCENE_ELEMENT_IDS.zodiac,
  houses: WHEEL_STYLE_SCENE_ELEMENT_IDS.houses,
  angles: WHEEL_STYLE_SCENE_ELEMENT_IDS.angles,
  bodies: WHEEL_STYLE_SCENE_ELEMENT_IDS.bodies,
  aspects: WHEEL_STYLE_SCENE_ELEMENT_IDS.aspects,
  secondaryRing: WHEEL_STYLE_SCENE_ELEMENT_IDS.secondary,
  surveil: WHEEL_STYLE_SCENE_ELEMENT_IDS.secondary,
  chartOverlay: WHEEL_STYLE_SCENE_ELEMENT_IDS.overlays,
} as const);

const WHEEL_SEMANTIC_CLASS_BY_ID = new Map(
  WHEEL_SEMANTIC_CLASS_MANIFEST.map((definition) => [
    definition.id,
    definition,
  ]),
);

const CHART_COLOR_TOKENS = {
  background: ["chart.color.background", "--morinus-background"],
  frame: ["chart.color.frame", "--morinus-frame"],
  signs: ["chart.color.signs", "--morinus-signs"],
  angles: ["chart.color.angles", "--morinus-angles"],
  houses: ["chart.color.houses", "--morinus-houses"],
  houseNumbers: ["chart.color.houseNumbers", "--morinus-housenums"],
  positions: ["chart.color.positions", "--morinus-positions"],
  fortune: ["chart.color.body.fortune", "--morinus-body-fortune"],
  peregrin: ["chart.color.peregrine", "--morinus-peregrin"],
  textDim: ["chart.color.textDim", "--morinus-text-dim"],
  textBright: ["chart.color.textBright", "--morinus-text-bright"],
} as const;

const ELEMENT_COLOR_TOKENS = [
  ["chart.color.element.fire", "--morinus-element-fire"],
  ["chart.color.element.earth", "--morinus-element-earth"],
  ["chart.color.element.air", "--morinus-element-air"],
  ["chart.color.element.water", "--morinus-element-water"],
] as const;

const WHEEL_COLOR_TOKENS = {
  outerMaximumRing: ["renderer.wheel.color.outerMaximumRing", "--aries-wheel-outer-maximum-ring-color"],
  outerHouseRing: ["renderer.wheel.color.outerHouseRing", "--aries-wheel-outer-house-ring-color"],
  outerDegreeRing: ["renderer.wheel.color.outerDegreeRing", "--aries-wheel-outer-degree-ring-color"],
  zodiacOuterRing: ["renderer.wheel.color.zodiacOuterRing", "--aries-wheel-zodiac-outer-ring-color"],
  innerDegreeRing: ["renderer.wheel.color.innerDegreeRing", "--aries-wheel-inner-degree-ring-color"],
  zodiacInnerRing: ["renderer.wheel.color.zodiacInnerRing", "--aries-wheel-zodiac-inner-ring-color"],
  termRing: ["renderer.wheel.color.termRing", "--aries-wheel-term-ring-color"],
  cuspOuterRing: ["renderer.wheel.color.cuspOuterRing", "--aries-wheel-cusp-outer-ring-color"],
  innerBoundaryRing: ["renderer.wheel.color.innerBoundaryRing", "--aries-wheel-inner-boundary-ring-color"],
  aspectBoundaryRing: ["renderer.wheel.color.aspectBoundaryRing", "--aries-wheel-aspect-boundary-ring-color"],
  houseBoundaryRing: ["renderer.wheel.color.houseBoundaryRing", "--aries-wheel-house-boundary-ring-color"],
  angloHouseBoundaryRing: ["renderer.wheel.color.angloHouseBoundaryRing", "--aries-wheel-anglo-house-boundary-ring-color"],
  baseRing: ["renderer.wheel.color.baseRing", "--aries-wheel-base-ring-color"],
  angloBaseRing: ["renderer.wheel.color.angloBaseRing", "--aries-wheel-anglo-base-ring-color"],
  zodiacSpoke: ["renderer.wheel.color.zodiacSpoke", "--aries-wheel-zodiac-spoke-color"],
  houseCusp: ["renderer.wheel.color.houseCusp", "--aries-wheel-house-cusp-color"],
  houseLabel: ["renderer.wheel.color.houseLabel", "--aries-wheel-house-label-color"],
  angloHouseLabel: ["renderer.wheel.color.angloHouseLabel", "--aries-wheel-anglo-house-label-color"],
  termBoundary: ["renderer.wheel.color.termBoundary", "--aries-wheel-term-boundary-color"],
  termGlyph: ["renderer.wheel.color.termGlyph", "--aries-wheel-term-glyph-color"],
  decanBoundary: ["renderer.wheel.color.decanBoundary", "--aries-wheel-decan-boundary-color"],
  decanGlyph: ["renderer.wheel.color.decanGlyph", "--aries-wheel-decan-glyph-color"],
  bodyLeader: ["renderer.wheel.color.bodyLeader", "--aries-wheel-body-leader-color"],
  angloBodyLeader: ["renderer.wheel.color.angloBodyLeader", "--aries-wheel-anglo-body-leader-color"],
  outerLeader: ["renderer.wheel.color.outerLeader", "--aries-wheel-outer-leader-color"],
  angloOuterLeader: ["renderer.wheel.color.angloOuterLeader", "--aries-wheel-anglo-outer-leader-color"],
  angleRay: ["renderer.wheel.color.angleRay", "--aries-wheel-angle-ray-color"],
  angleLabel: ["renderer.wheel.color.angleLabel", "--aries-wheel-angle-label-color"],
  surveilAccent: ["renderer.wheel.color.surveilAccent", "--aries-wheel-surveil-accent-color"],
} as const;

const APP_FONT_TOKENS = {
  symbols: ["renderer.wheel.font.symbols", "--aries-wheel-font-symbols"],
  bodySymbols: ["renderer.wheel.font.bodySymbols", "--aries-wheel-font-body-symbols"],
  signSymbols: ["renderer.wheel.font.signSymbols", "--aries-wheel-font-sign-symbols"],
  termSymbols: ["renderer.wheel.font.termSymbols", "--aries-wheel-font-term-symbols"],
  decanSymbols: ["renderer.wheel.font.decanSymbols", "--aries-wheel-font-decan-symbols"],
  aspectSymbols: ["renderer.wheel.font.aspectSymbols", "--aries-wheel-font-aspect-symbols"],
  ui: ["renderer.wheel.font.text", "--aries-wheel-font-text"],
} as const;

const ASPECT_COLOR_NAMES = [
  "conjunction",
  "semisextile",
  "semisquare",
  "sextile",
  "quintile",
  "square",
  "trine",
  "sesquisquare",
  "biquintile",
  "quincunx",
  "opposition",
  "septile",
  "parallel",
  "contraparallel",
] as const;

function wheelMetricId(key: keyof WheelRenderTokens): string {
  return `renderer.wheel.metric.${key}`;
}

function metricBinding(
  key: keyof WheelRenderTokens,
  property: StyleSceneTokenProperty,
  value: number,
): StyleSceneTokenBinding {
  return {
    semanticId: wheelMetricId(key),
    cssVar: WHEEL_RENDER_TOKEN_SPECS[key][0],
    property,
    value,
  };
}

function linePaintTokenKey(
  role: WheelLinePaintRole,
  suffix: WheelLinePaintTokenSuffix,
): WheelLinePaintTokenKey {
  return `${role}${suffix}` as WheelLinePaintTokenKey;
}

function linePaintBindings(
  style: WheelRenderStyle,
  role: WheelLinePaintRole,
): readonly StyleSceneTokenBinding[] {
  const paint = style.linePaint[role];
  return Object.freeze([
    metricBinding(
      linePaintTokenKey(role, "WidthScale"),
      "stroke-width",
      paint.widthScale,
    ),
    metricBinding(linePaintTokenKey(role, "Pattern"), "stroke-dash", paint.pattern),
    metricBinding(linePaintTokenKey(role, "DashOn"), "stroke-dash", paint.dashOn),
    metricBinding(linePaintTokenKey(role, "DashOff"), "stroke-dash", paint.dashOff),
    metricBinding(linePaintTokenKey(role, "Opacity"), "opacity", paint.opacity),
  ]);
}

function colorBinding(
  token: readonly [semanticId: string, cssVar: string],
  value?: string,
): StyleSceneTokenBinding {
  return { semanticId: token[0], cssVar: token[1], property: "color", value };
}

function fontBinding(
  token: readonly [semanticId: string, cssVar: string],
  value: string,
): StyleSceneTokenBinding {
  return {
    semanticId: token[0],
    cssVar: token[1],
    property: "font-family",
    value,
  };
}

function directMetricBinding(
  key: keyof WheelRenderTokens,
  property: StyleSceneTokenProperty,
  value: number,
  valuePerPixel: number,
): NonNullable<StyleSceneHandle["binding"]> {
  return { ...metricBinding(key, property, value), value, valuePerPixel };
}

function projectWheelPoint(
  center: StyleScenePoint,
  radius: number,
  longitude: number,
  ascendantDegrees: number,
): StyleScenePoint {
  const radians = (180 + longitude - ascendantDegrees) * (Math.PI / 180);
  return [
    center[0] + Math.cos(radians) * radius,
    center[1] - Math.sin(radians) * radius,
  ];
}

function radialPoint(
  center: StyleScenePoint,
  radius: number,
  angleDegrees = 0,
): StyleScenePoint {
  const radians = angleDegrees * (Math.PI / 180);
  return [
    center[0] + Math.cos(radians) * radius,
    center[1] + Math.sin(radians) * radius,
  ];
}

function stateTags(input: WheelGeometryInput): readonly string[] {
  return Object.freeze([
    `profile:${input.profile}`,
    `mode:${input.mode}`,
    input.hasOuterRing ? "outer-ring" : "no-outer-ring",
    input.showTerms ? "terms" : "no-terms",
    input.showDecans ? "decans" : "no-decans",
    input.showHouses ? "houses" : "no-houses",
    input.showPositions ? "positions" : "no-positions",
  ]);
}

function previewFeatures(
  geometry: WheelGeometryInput,
  hitRegions: readonly ChartHitRegion[],
): ReadonlySet<WheelPreviewFeatureId> {
  const features = new Set<WheelPreviewFeatureId>();
  if (geometry.showHouses) features.add("houses");
  if (geometry.showPositions) features.add("positions");
  if (geometry.showTerms) features.add("terms");
  if (geometry.showDecans) features.add("decans");
  if (geometry.comparisonWithOuterHouses) {
    features.add("comparison.outerHouses");
  }

  for (const region of hitRegions) {
    const styleTarget = asStyleTargetHitRegion(region);
    if (styleTarget) {
      const { classId } = styleTarget;
      if (classId.includes(".position.")) features.add("positions");
      if (classId.endsWith(".motion")) features.add("motionMarkers");
      if (classId.startsWith("houses.outer.")) {
        features.add("houses");
        features.add("comparison.outerHouses");
      }
      if (classId.startsWith("surveil.")) features.add("surveil");
      if (classId.startsWith("aspects.")) features.add("aspects");
      if (classId === "chartOverlay.information.topLeft") {
        features.add("overlay.information.topLeft");
      } else if (classId === "chartOverlay.information.bottomLeft") {
        features.add("overlay.information.bottomLeft");
      } else if (classId === "chartOverlay.houseSystem.bottomRight") {
        features.add("overlay.houseSystem.bottomRight");
      } else if (classId.startsWith("chartOverlay.events.dayHour.")) {
        features.add("overlay.events.dayHour");
      } else if (classId.startsWith("chartOverlay.events.header.")) {
        features.add("overlay.events.header");
      } else if (classId.startsWith("chartOverlay.events.signal.")) {
        features.add("overlay.events.signal");
      }
      continue;
    }
    if (region.kind === "aspect") {
      features.add("aspects");
      if (region.shape === "glyph") features.add("aspectGlyphs");
      continue;
    }
    if (region.kind === "angle") {
      features.add("angleArrowheads");
      if (
        region.left != null
        && region.top != null
        && region.width != null
        && region.height != null
      ) {
        features.add("angleLabels");
      }
      continue;
    }
    if (region.kind === "planet") {
      if (region.speed < 0) features.add("motionMarkers");
      continue;
    }
    if (region.kind === "fortune") {
      features.add("body.fortune");
      continue;
    }
    if (region.kind === "vertex") {
      features.add("body.vertex");
      continue;
    }
    if (region.kind === "syzygy") {
      features.add("body.prenatalSyzygy");
      continue;
    }
    if (region.kind === "eclipse") {
      features.add("body.prenatalSyzygy");
      continue;
    }
    if (region.kind !== "secondary_ring") continue;

    const family = region.family.trim().toLowerCase().replaceAll("-", "_");
    // `fix`, not `fixed`: the daemon spells the family `fixstar`. See
    // resolveWheelSecondaryRingClassIds, which this list must agree with or a
    // present outer-ring family reads as an absent one.
    if (family.includes("fix")) features.add("outerRing.fixedStar");
    else if (family.includes("asteroid")) features.add("outerRing.asteroid");
    else if (family.includes("midpoint")) features.add("outerRing.midpoint");
    else if (family.includes("contra") && family.includes("antis")) {
      features.add("outerRing.contraAntiscia");
    } else if (family.includes("antis")) features.add("outerRing.antiscia");
    else if (family.includes("dodec")) features.add("outerRing.dodecatemoria");
    else if (family.includes("arab") || family === "lot") {
      features.add("outerRing.arabicPart");
    } else if (family.includes("parallel")) {
      features.add("outerRing.parallelTransit");
      features.add("motionMarkers");
    }
  }
  return features;
}

function hasAuthoringDefaults(
  defaults: StyleSceneAuthoringDefaults,
): boolean {
  return Object.values(defaults).some((value) => value != null);
}

function applicableAuthoringDefaults(
  definition: WheelSemanticClassDefinition,
  profile: WheelTypographyProfile,
  defaults: StyleSceneAuthoringDefaults,
): StyleSceneAuthoringDefaults {
  const capabilities = new Set(
    resolveWheelSemanticCapabilities(definition, profile),
  );
  return Object.freeze({
    ...(capabilities.has("fontRef") && defaults.fontRef != null
      ? { fontRef: defaults.fontRef }
      : {}),
    ...(capabilities.has("fontSize") && defaults.fontSizePx != null
      ? { fontSizePx: defaults.fontSizePx }
      : {}),
    ...(capabilities.has("tracking") && defaults.trackingPx != null
      ? { trackingPx: defaults.trackingPx }
      : {}),
    ...(capabilities.has("color") && defaults.color != null
      ? { color: defaults.color }
      : {}),
    ...(capabilities.has("strokeWidth") && defaults.strokeWidthPx != null
      ? { strokeWidthPx: defaults.strokeWidthPx }
      : {}),
    ...(capabilities.has("strokeStyle") && defaults.strokeStyle != null
      ? { strokeStyle: defaults.strokeStyle }
      : {}),
    ...(capabilities.has("dashLength") && defaults.dashOnPx != null
      ? { dashOnPx: defaults.dashOnPx }
      : {}),
    ...(capabilities.has("dashGap") && defaults.dashOffPx != null
      ? { dashOffPx: defaults.dashOffPx }
      : {}),
    ...(capabilities.has("opacity") && defaults.opacityPercent != null
      ? { opacityPercent: defaults.opacityPercent }
      : {}),
    ...(capabilities.has("fillPattern") && defaults.fillPattern != null
      ? { fillPattern: defaults.fillPattern }
      : {}),
    ...(capabilities.has("cellSize") && defaults.cellSizePx != null
      ? { cellSizePx: defaults.cellSizePx }
      : {}),
    ...(capabilities.has("dotSize") && defaults.dotSizePx != null
      ? { dotSizePx: defaults.dotSizePx }
      : {}),
    ...(capabilities.has("backgroundColor") && defaults.backgroundColor != null
      ? { backgroundColor: defaults.backgroundColor }
      : {}),
    ...(capabilities.has("patternColor") && defaults.patternColor != null
      ? { patternColor: defaults.patternColor }
      : {}),
    ...(capabilities.has("gradientType") && defaults.gradientType != null
      ? { gradientType: defaults.gradientType }
      : {}),
    ...(capabilities.has("gradientDirection") && defaults.gradientDirection != null
      ? { gradientDirection: defaults.gradientDirection }
      : {}),
    ...(capabilities.has("gradientStartColor") && defaults.gradientStartColor != null
      ? { gradientStartColor: defaults.gradientStartColor }
      : {}),
    ...(capabilities.has("gradientEndColor") && defaults.gradientEndColor != null
      ? { gradientEndColor: defaults.gradientEndColor }
      : {}),
    ...(capabilities.has("gradientAngle") && defaults.gradientAngleDegrees != null
      ? { gradientAngleDegrees: defaults.gradientAngleDegrees }
      : {}),
    ...(capabilities.has("textureMask") && defaults.textureMask != null
      ? { textureMask: defaults.textureMask }
      : {}),
    ...(capabilities.has("maskDirection") && defaults.maskDirection != null
      ? { maskDirection: defaults.maskDirection }
      : {}),
    ...(capabilities.has("maskAngle") && defaults.maskAngleDegrees != null
      ? { maskAngleDegrees: defaults.maskAngleDegrees }
      : {}),
    ...(capabilities.has("maskAmount") && defaults.maskAmountPercent != null
      ? { maskAmountPercent: defaults.maskAmountPercent }
      : {}),
    ...(capabilities.has("shadowPattern") && defaults.shadowPattern != null
      ? { shadowPattern: defaults.shadowPattern }
      : {}),
    ...(capabilities.has("shadowColor") && defaults.shadowColor != null
      ? { shadowColor: defaults.shadowColor }
      : {}),
    ...(capabilities.has("shadowX") && defaults.shadowXpx != null
      ? { shadowXpx: defaults.shadowXpx }
      : {}),
    ...(capabilities.has("shadowY") && defaults.shadowYpx != null
      ? { shadowYpx: defaults.shadowYpx }
      : {}),
    ...(capabilities.has("shadowBlur") && defaults.shadowBlurPx != null
      ? { shadowBlurPx: defaults.shadowBlurPx }
      : {}),
    ...(capabilities.has("density") && defaults.densityPercent != null
      ? { densityPercent: defaults.densityPercent }
      : {}),
    ...(capabilities.has("angle") && defaults.angleDegrees != null
      ? { angleDegrees: defaults.angleDegrees }
      : {}),
    ...(capabilities.has("seed") && defaults.seed != null
      ? { seed: defaults.seed }
      : {}),
    ...(capabilities.has("lineCap") && defaults.lineCap != null
      ? { lineCap: defaults.lineCap }
      : {}),
    ...(capabilities.has("lineJoin") && defaults.lineJoin != null
      ? { lineJoin: defaults.lineJoin }
      : {}),
    ...(capabilities.has("radius") && defaults.radiusPx != null
      ? { radiusPx: defaults.radiusPx }
      : {}),
    ...(capabilities.has("radius") && defaults.diameterPx != null
      ? { diameterPx: defaults.diameterPx }
      : {}),
    ...(capabilities.has("rulerDepth") && defaults.rulerDepthPercent != null
      ? { rulerDepthPercent: defaults.rulerDepthPercent }
      : {}),
    ...(capabilities.has("tickLength") && defaults.tickLengthPercent != null
      ? { tickLengthPercent: defaults.tickLengthPercent }
      : {}),
    ...(capabilities.has("spanInner") && defaults.spanInnerPx != null
      ? { spanInnerPx: defaults.spanInnerPx }
      : {}),
    ...(capabilities.has("spanScale") && defaults.spanScalePercent != null
      ? { spanScalePercent: defaults.spanScalePercent }
      : {}),
  });
}

function manifestPlaceholder(
  definition: WheelSemanticClassDefinition,
  defaults: StyleSceneAuthoringDefaults,
  tags: readonly string[],
  applicabilityState: "applicable" | "not-applicable",
  missingFeatures: readonly WheelPreviewFeatureId[],
  editable: boolean,
): StyleSceneElement {
  return element({
    classId: definition.id,
    id: `wheel.manifest.${definition.id}`,
    parentId: MANIFEST_PARENT_IDS[definition.groupId],
    labelKey: definition.labelKey,
    layer: definition.layer,
    primitive: definition.primitive,
    tokenBindings: [],
    authoringDefaults: defaults,
    editability: editable ? EDITABLE : {
      state: "read-only",
      reason: "inactive-state",
    },
    hitGeometry: null,
    handles: [],
    priority: -200,
    stateTags: Object.freeze([
      ...tags,
      "manifest-placeholder",
      editable ? "manifest-editable" : "manifest-not-applicable",
      `manifest-applicability:${applicabilityState}`,
      ...missingFeatures.map((feature) => `manifest-missing:${feature}`),
    ]),
  }, tags);
}

function appendManifestPlaceholders(
  elements: StyleSceneElement[],
  style: WheelRenderStyle,
  geometry: WheelGeometryInput,
  tags: readonly string[],
  hitRegions: readonly ChartHitRegion[],
): void {
  const existingClasses = new Set(elements.map((sceneElement) => sceneElement.classId));
  const features = previewFeatures(geometry, hitRegions);
  for (const definition of WHEEL_SEMANTIC_CLASS_MANIFEST) {
    if (existingClasses.has(definition.id)) continue;
    const defaults = applicableAuthoringDefaults(
      definition,
      geometry.profile,
      readWheelAuthoringClassDefaults(
        style,
        geometry.profile,
        definition.id,
        { geometry, targetWheelRadius: geometry.maxRadius },
      ),
    );
    const applicability = resolveWheelSemanticApplicability(definition, {
      variant: geometry.profile,
      layout: geometry.mode,
      features,
    });
    const supportsCurrentVariant = definition.applicability.variants.includes(
      geometry.profile,
    );
    const supportsCurrentLayout = definition.applicability.layouts.includes(
      geometry.mode,
    );
    // A hidden feature may still be styled through exact profile-v2 defaults.
    // Wrong-variant/layout classes and classes without direct controls stay
    // unavailable until their deterministic reveal state is loaded.
    const editable = supportsCurrentVariant
      && supportsCurrentLayout
      && hasAuthoringDefaults(defaults);
    elements.push(manifestPlaceholder(
      definition,
      defaults,
      tags,
      applicability.state,
      applicability.missingFeatures,
      editable,
    ));
  }
}

function element(
  input: Omit<StyleSceneElement, "stateTags" | "paletteRoleIds"> & {
    readonly stateTags?: readonly string[];
    readonly paletteRoleIds?: readonly string[];
  },
  tags: readonly string[],
): StyleSceneElement {
  const paletteRoleIds = input.paletteRoleIds ?? input.tokenBindings
    .filter((binding) => binding.property === "color")
    .map((binding) => binding.semanticId);
  return Object.freeze({
    ...input,
    paletteRoleIds: Object.freeze([...new Set(paletteRoleIds)]),
    stateTags: input.stateTags ?? tags,
  });
}

function groupElement(
  id: string,
  parentId: string | undefined,
  labelKey: string,
  layer: StyleSceneElement["layer"],
  tags: readonly string[],
  classId = id,
): StyleSceneElement {
  return element(
    {
      classId,
      id,
      parentId,
      labelKey,
      layer,
      primitive: "group",
      tokenBindings: [],
      editability: SELECTION_ONLY,
      hitGeometry: null,
      handles: [],
      priority: -100,
    },
    tags,
  );
}

interface RadiusTokenBinding {
  readonly key: keyof WheelRenderTokens;
  readonly value: number;
  readonly valuePerPixel: number;
  /** Neighbour-aware wall in token units, when the ring has one. */
  readonly min?: number;
  readonly max?: number;
}

const RING_CLASS_IDS: Readonly<Partial<Record<WheelLinePaintRole, string>>> = {
  outerMaximumRing: "rings.outerMaximum",
  outerHouseRing: "rings.outerHouse",
  outerDegreeRing: "rings.outerDegree",
  zodiacOuterRing: "rings.zodiacOuter",
  innerDegreeRing: "rings.innerDegree",
  zodiacInnerRing: "rings.zodiacInner",
  termRing: "rings.term",
  cuspOuterRing: "rings.angloCuspOuter",
  innerBoundaryRing: "rings.innerBoundary",
  aspectBoundaryRing: "rings.aspectBoundary",
  houseBoundaryRing: "rings.houseBoundary",
  baseRing: "rings.base",
};

function ringClassId(
  elementId: string,
  paintRole: WheelLinePaintRole,
  painted: boolean,
): string {
  if (painted && RING_CLASS_IDS[paintRole]) return RING_CLASS_IDS[paintRole]!;
  const lanes: Readonly<Record<string, string>> = {
    [WHEEL_STYLE_SCENE_ELEMENT_IDS.ringBody]: "bodies.inner.lane",
    [WHEEL_STYLE_SCENE_ELEMENT_IDS.ringPosition]: "bodies.inner.positionLane",
    [WHEEL_STYLE_SCENE_ELEMENT_IDS.ringHouseLabel]: "houses.inner.labelLane",
    [WHEEL_STYLE_SCENE_ELEMENT_IDS.ringOuterBody]: "bodies.outer.lane",
    [WHEEL_STYLE_SCENE_ELEMENT_IDS.ringOuterLine]: "secondaryRing.leaderLane",
    [WHEEL_STYLE_SCENE_ELEMENT_IDS.ringProjectedLabel]: "secondaryRing.labelLane",
    // Classic paints this circle and it is `rings.aspectBoundary` there;
    // compact and Anglo place aspects against it without drawing it. Named
    // rather than left to the id fallback below, which produced `ring.aspect`
    // — a top-level `ring` node sitting beside `rings` in the element list.
    [WHEEL_STYLE_SCENE_ELEMENT_IDS.ringAspect]: "aspects.lane",
  };
  return lanes[elementId] ?? elementId.replace(/^wheel\./, "");
}

function paintedRingRadiusToken(
  input: WheelGeometryInput,
  role: WheelPaintedRingRole,
  radius: number,
  style?: WheelRenderStyle,
): RadiusTokenBinding {
  const scale = Math.max(1, input.maxRadius);
  // The solver's legal interval for this ring, normalized into token units so
  // the drag hard-stops exactly where the geometry would otherwise break.
  const range = style ? resolveWheelPaintedRingRadiusRange(style, input, role) : null;
  return {
    key: wheelRingRadiusTokenKey(input.profile, role),
    // Auto tokens are stored as zero, but the direct editor control must show
    // and begin dragging from the exact radius currently painted.
    value: radius / scale,
    valuePerPixel: 1 / scale,
    ...(range ? { min: range.min / scale, max: range.max / scale } : {}),
  };
}

function bodyRadiusToken(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
  rings: Readonly<WheelRingSet>,
): RadiusTokenBinding {
  if (input.profile === "anglo") {
    return {
      key: "angloPlanetScale",
      value: style.geometry.anglo.planetScale,
      valuePerPixel: 1 / Math.max(1, rings.r30),
    };
  }
  return {
    key: "classicPlanetSectorLength",
    value: style.geometry.classic.planetSectorLength,
    valuePerPixel: -2 / input.maxRadius,
  };
}

function aspectRadiusToken(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
  rings: Readonly<WheelRingSet>,
): RadiusTokenBinding {
  if (input.profile === "anglo") {
    return {
      key: "angloAspectScale",
      value: style.geometry.anglo.aspectScale,
      valuePerPixel: 1 / Math.max(1, rings.r30),
    };
  }
  if (input.profile === "compact") {
    return {
      key: "compactPositionInset",
      value: style.geometry.compact.positionInset,
      valuePerPixel: -1 / input.maxRadius,
    };
  }
  return {
    key: "classicPlanetSectorLength",
    value: style.geometry.classic.planetSectorLength,
    valuePerPixel: -1 / input.maxRadius,
  };
}

function positionRadiusToken(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
  rings: Readonly<WheelRingSet>,
): RadiusTokenBinding {
  if (input.profile === "anglo") {
    return {
      key: "angloPositionInsetScale",
      value: style.geometry.anglo.positionInsetScale,
      valuePerPixel: -1 / Math.max(1, rings.r30),
    };
  }
  if (input.profile === "compact") {
    return {
      key: "compactPositionInset",
      value: style.geometry.compact.positionInset,
      valuePerPixel: -1 / input.maxRadius,
    };
  }
  return {
    key: "classicInnerPosition",
    value: style.geometry.classic.inner.position,
    valuePerPixel: 1 / input.maxRadius,
  };
}

function houseLabelRadiusToken(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
): RadiusTokenBinding | null {
  if (input.profile === "anglo") return null;
  if (input.profile === "compact") {
    return {
      key: "compactHouseName",
      value: style.geometry.compact.houseName,
      valuePerPixel: 1 / input.maxRadius,
    };
  }
  return {
    key: "classicInnerHouseName",
    value: style.geometry.classic.inner.houseName,
    valuePerPixel: 1 / input.maxRadius,
  };
}

function addRingElement(
  elements: StyleSceneElement[],
  handles: StyleSceneHandle[],
  tags: readonly string[],
  input: Readonly<{
    id: string;
    labelKey: string;
    radius: number | undefined;
    center: StyleScenePoint;
    maxRadius: number;
    style: WheelRenderStyle;
    colorToken: readonly [string, string];
    color: string;
    paintRole?: WheelLinePaintRole | null;
    painted?: boolean;
    radiusToken?: RadiusTokenBinding | null;
    geometryOwnership?: StyleSceneEditability;
    parentId?: string;
    priority?: number;
  }>,
): void {
  if (input.radius == null || !Number.isFinite(input.radius) || input.radius < 0) return;
  const radiusToken = input.radiusToken ?? null;
  const painted = input.painted ?? true;
  const paintRole = input.paintRole ?? "minorRing";
  const radiusHandle: StyleSceneHandle = {
    id: `${input.id}.handle.radius`,
    elementId: input.id,
    kind: "radial",
    center: input.center,
    radius: input.radius,
    angleDegrees: 0,
    position: radialPoint(input.center, input.radius),
    editability: radiusToken
      ? EDITABLE
      : (input.geometryOwnership ?? DERIVED_GEOMETRY),
    binding: radiusToken
      ? {
          ...directMetricBinding(
            radiusToken.key,
            "radius",
            radiusToken.value,
            radiusToken.valuePerPixel,
          ),
          ...(radiusToken.min != null ? { min: radiusToken.min } : {}),
          ...(radiusToken.max != null ? { max: radiusToken.max } : {}),
        }
      : undefined,
  };
  const strokeHandle: StyleSceneHandle | null = painted
    ? {
        id: `${input.id}.handle.stroke`,
        elementId: input.id,
        kind: "linear",
        origin: radialPoint(input.center, input.radius, 45),
        position: radialPoint(input.center, input.radius, 45),
        axis: [1, 0] as const,
        editability: EDITABLE,
        binding: directMetricBinding(
          linePaintTokenKey(paintRole, "WidthScale"),
          "stroke-width",
          input.style.linePaint[paintRole].widthScale,
          0.05,
        ),
      }
    : null;
  const ringHandles = Object.freeze([
    radiusHandle,
    ...(strokeHandle ? [strokeHandle] : []),
  ]);
  handles.push(...ringHandles);
  elements.push(
    element(
      {
        classId: ringClassId(input.id, paintRole, painted),
        id: input.id,
        parentId: input.parentId ?? WHEEL_STYLE_SCENE_ELEMENT_IDS.rings,
        labelKey: input.labelKey,
        layer: "geometry",
        primitive: "circle",
        tokenBindings: Object.freeze([
          ...(painted
            ? [
                ...linePaintBindings(input.style, paintRole),
                colorBinding(input.colorToken, input.color),
              ]
            : []),
          ...(radiusToken
            ? [metricBinding(radiusToken.key, "radius", radiusToken.value)]
            : []),
        ]),
        editability:
          painted || radiusToken
            ? EDITABLE
            : (input.geometryOwnership ?? DERIVED_GEOMETRY),
        hitGeometry: painted
          ? {
              kind: "circle",
              center: input.center,
              radius: input.radius,
              tolerance: Math.max(4, input.maxRadius * 0.008),
            }
          : null,
        handles: ringHandles,
        priority: input.priority ?? 8,
      },
      tags,
    ),
  );
}

function safeIdPart(value: string | number): string {
  return encodeURIComponent(String(value)).replaceAll(".", "%2E");
}

function signScaleToken(profile: WheelTypographyProfile): keyof WheelRenderTokens {
  if (profile === "anglo") return "angloSignScale";
  if (profile === "compact") return "compactSignScale";
  return "classicSignScale";
}

function outerScaleToken(profile: WheelTypographyProfile): keyof WheelRenderTokens {
  if (profile === "anglo") return "angloOuterScale";
  if (profile === "compact") return "compactOuterScale";
  return "classicOuterScale";
}

function bodyColorToken(planetId: string): readonly [string, string] {
  if (planetId === "nnode" || planetId === "snode") {
    return ["chart.color.body.nodes", "--morinus-body-nodes"];
  }
  return [`chart.color.body.${planetId}`, `--morinus-body-${planetId}`];
}

function dignityColorToken(
  dignity: string | undefined,
): readonly [string, string] | null {
  const names: Readonly<Record<string, readonly [string, string]>> = {
    domicil: ["chart.color.dignity.domicile", "--morinus-dignity-domicil"],
    exil: ["chart.color.dignity.exile", "--morinus-dignity-exil"],
    exal: ["chart.color.dignity.exaltation", "--morinus-dignity-exal"],
    casus: ["chart.color.dignity.fall", "--morinus-dignity-casus"],
    peregrin: ["chart.color.peregrine", "--morinus-peregrin"],
  };
  return dignity ? names[dignity] ?? null : null;
}

function aspectColorToken(aspectType: number): readonly [string, string] {
  const name = ASPECT_COLOR_NAMES[aspectType] ?? "conjunction";
  return [`chart.color.aspect.${name}`, `--morinus-aspect-${name}`];
}

function regionPointGeometry(region: ChartHitRegion): StyleSceneHitGeometry {
  if (
    region.left != null &&
    region.top != null &&
    region.width != null &&
    region.height != null
  ) {
    return {
      kind: "rectangle",
      x: region.left,
      y: region.top,
      width: region.width,
      height: region.height,
    };
  }
  return { kind: "disc", center: [region.x, region.y], radius: region.r };
}

function styleTargetGeometry(
  region: StyleTargetHitRegion,
): StyleSceneHitGeometry | null {
  if (region.shape === "line") {
    return region.x1 != null
      && region.y1 != null
      && region.x2 != null
      && region.y2 != null
        ? {
            kind: "line",
            start: [region.x1, region.y1],
            end: [region.x2, region.y2],
            tolerance: region.tolerance ?? 4,
          }
        : null;
  }
  return (
    region.left != null
    && region.top != null
    && region.width != null
    && region.height != null
  )
    ? {
        kind: "rectangle",
        x: region.left,
        y: region.top,
        width: region.width,
        height: region.height,
      }
    : null;
}

function positionMetric(
  classId: string,
  profile: WheelTypographyProfile,
  style: WheelRenderStyle,
): readonly [key: keyof WheelRenderTokens, value: number] | null {
  const ratios = style.typography.ratios;
  const component = classId.endsWith(".degree")
    ? "degree"
    : classId.endsWith(".sign")
      ? "sign"
      : classId.endsWith(".minute")
        ? "minute"
        : null;
  if (component == null) return null;

  if (classId.startsWith("bodies.")) {
    if (component === "sign") {
      return [
        "bodyPositionSignScale",
        profile === "anglo"
          ? ratios.angloBodyPosition.signScale
          : ratios.bodyPosition.signScale,
      ];
    }
    if (component === "degree") {
      return profile === "anglo"
        ? ["angloBodyDegreeScale", ratios.angloBodyPosition.degreeScale]
        : ["bodyPositionDegreeScale", ratios.bodyPosition.degreeScale];
    }
    return profile === "anglo"
      ? ["angloBodyMinuteScale", ratios.angloBodyPosition.minuteScale]
      : ["bodyPositionMinuteScale", ratios.bodyPosition.minuteScale];
  }

  if (classId.startsWith("angles.")) {
    if (component === "sign") {
      return [
        "anglePositionSignScale",
        profile === "anglo"
          ? ratios.angloAnglePosition.signScale
          : ratios.anglePosition.signScale,
      ];
    }
    if (component === "degree") {
      return profile === "anglo"
        ? [
            "angloAnglePositionDegreeScale",
            ratios.angloAnglePosition.degreeScale,
          ]
        : ["anglePositionDegreeScale", ratios.anglePosition.degreeScale];
    }
    return profile === "anglo"
      ? [
          "angloAnglePositionMinuteScale",
          ratios.angloAnglePosition.minuteScale,
        ]
      : ["anglePositionMinuteScale", ratios.anglePosition.minuteScale];
  }

  if (classId.startsWith("houses.")) {
    if (component === "sign") {
      return [
        "housePositionSignScale",
        profile === "anglo"
          ? ratios.angloHousePosition.signScale
          : ratios.housePosition.signScale,
      ];
    }
    if (component === "degree") {
      return profile === "anglo"
        ? [
            "angloHousePositionDegreeScale",
            ratios.angloHousePosition.degreeScale,
          ]
        : ["housePositionDegreeScale", ratios.housePosition.degreeScale];
    }
    return profile === "anglo"
      ? [
          "angloHousePositionMinuteScale",
          ratios.angloHousePosition.minuteScale,
        ]
      : ["housePositionMinuteScale", ratios.housePosition.minuteScale];
  }
  return null;
}

function bodyMotionColorBindings(
  region: StyleTargetHitRegion,
  hitRegions: readonly ChartHitRegion[],
  useIndividualBodyColors: boolean | undefined,
): readonly StyleSceneTokenBinding[] {
  const match = /body:([^:]+):motion$/.exec(region.itemId);
  const bodyId = match?.[1];
  const outer = region.classId === "bodies.outer.motion";
  const bodyRegion = bodyId == null
    ? undefined
    : hitRegions.find(
        (candidate) =>
          candidate.kind === "planet"
          && candidate.planetId === bodyId
          && (candidate.chartRole === "outer") === outer,
      );
  if (!bodyId || bodyRegion?.kind !== "planet") {
    return Object.freeze([colorBinding(CHART_COLOR_TOKENS.positions)]);
  }

  const primary = bodyColorToken(bodyId);
  if (useIndividualBodyColors === false) {
    return Object.freeze([
      colorBinding(
        dignityColorToken(bodyRegion.dignity) ?? CHART_COLOR_TOKENS.peregrin,
      ),
    ]);
  }
  const dignity = dignityColorToken(bodyRegion.dignity);
  return Object.freeze([
    colorBinding(primary),
    ...(useIndividualBodyColors == null && dignity
      ? [colorBinding(dignity)]
      : []),
  ]);
}

function styleTargetTokenBindings(
  region: StyleTargetHitRegion,
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  hitRegions: readonly ChartHitRegion[],
  useIndividualBodyColors: boolean | undefined,
  useZodiacElementColors: boolean | undefined,
  signColors: readonly string[] | undefined,
): readonly StyleSceneTokenBinding[] {
  const { classId } = region;
  if (
    classId === "angles.inner.ray"
    || classId === "angles.outer.ray"
    || classId === "angles.inner.arrowhead"
    || classId === "angles.outer.arrowhead"
  ) {
    return Object.freeze([
      ...linePaintBindings(style, "angle"),
      colorBinding(
        WHEEL_COLOR_TOKENS.angleRay,
        style.elementColors.angleRay,
      ),
    ]);
  }
  const position = positionMetric(classId, profile, style);
  if (position) {
    const isSign = classId.endsWith(".sign");
    const fontToken = isSign
      ? classId.startsWith("bodies.")
        ? APP_FONT_TOKENS.bodySymbols
        : APP_FONT_TOKENS.signSymbols
      : APP_FONT_TOKENS.ui;
    const fontFamily = isSign
      ? classId.startsWith("bodies.")
        ? style.typography.families.bodySymbols
        : style.typography.families.signSymbols
      : style.typography.families.ui;
    // A position readout — "28° ♏ 33" — is one printed value, so degree, sign
    // and minute share one colour role. Colouring the sign by the zodiac role
    // split one reading across two families purely because that component
    // happens to be a glyph.
    //
    // Font still splits, and must: the sign needs a symbol face with the glyph
    // in its cmap, which a text face does not have. Colour groups by meaning;
    // font is constrained by coverage.
    //
    // Zodiac element colouring stays an explicit opt-in. When it is on the
    // sign is deliberately tinted by element, and that intent outranks the
    // readout's shared role.
    const elementColoured =
      isSign && useZodiacElementColors && region.signIndex != null;
    const colorToken = elementColoured
      ? ELEMENT_COLOR_TOKENS[region.signIndex! % ELEMENT_COLOR_TOKENS.length]
      : CHART_COLOR_TOKENS.positions;
    const colorValue = elementColoured
      ? signColors?.[region.signIndex!] ?? style.palette.signs
      : style.palette.positions;
    return Object.freeze([
      colorBinding(colorToken, colorValue),
      fontBinding(fontToken, fontFamily),
      metricBinding(position[0], "font-size", position[1]),
    ]);
  }

  if (
    classId === "bodies.inner.motion"
    || classId === "bodies.outer.motion"
  ) {
    return Object.freeze([
      ...bodyMotionColorBindings(
        region,
        hitRegions,
        useIndividualBodyColors,
      ),
      fontBinding(APP_FONT_TOKENS.ui, style.typography.families.ui),
      metricBinding(
        "motionScale",
        "font-size",
        style.typography.ratios.motionScale,
      ),
    ]);
  }

  if (classId === "houses.outer.label") {
    const colorKey = profile === "anglo"
      ? "angloHouseLabel"
      : "houseLabel";
    return Object.freeze([
      colorBinding(
        WHEEL_COLOR_TOKENS[colorKey],
        style.elementColors[colorKey],
      ),
      fontBinding(APP_FONT_TOKENS.ui, style.typography.families.ui),
      metricBinding(
        "houseLabelScale",
        "font-size",
        style.typography.ratios.houseLabelScale,
      ),
    ]);
  }

  if (
    classId === "houses.inner.cusp"
    || classId === "houses.outer.cusp"
  ) {
    return Object.freeze([
      ...linePaintBindings(style, "houseCusp"),
      colorBinding(
        WHEEL_COLOR_TOKENS.houseCusp,
        style.elementColors.houseCusp,
      ),
    ]);
  }

  if (classId === "surveil.tick") {
    return Object.freeze([
      ...linePaintBindings(style, "outerLeader"),
      colorBinding(
        WHEEL_COLOR_TOKENS.surveilAccent,
        style.elementColors.surveilAccent,
      ),
      metricBinding(
        "surveilTickLengthMin",
        "offset",
        style.labels.surveil.tickLengthMin,
      ),
      metricBinding(
        "surveilTickLengthScale",
        "offset",
        style.labels.surveil.tickLengthScale,
      ),
    ]);
  }

  if (classId.startsWith("surveil.")) {
    const symbol = classId === "surveil.marker.glyph";
    return Object.freeze([
      colorBinding(
        WHEEL_COLOR_TOKENS.surveilAccent,
        style.elementColors.surveilAccent,
      ),
      fontBinding(
        symbol ? APP_FONT_TOKENS.symbols : APP_FONT_TOKENS.ui,
        symbol
          ? style.typography.families.symbols
          : style.typography.families.ui,
      ),
      metricBinding(
        "surveilGlyphSizeMin",
        "font-size",
        style.labels.surveil.glyphSizeMin,
      ),
      metricBinding(
        "surveilGlyphSizeScale",
        "font-size",
        style.labels.surveil.glyphSizeScale,
      ),
      ...(classId === "surveil.sourceLabel"
        ? [
            metricBinding(
              "surveilLabelGapMin",
              "spacing",
              style.labels.surveil.labelGapMin,
            ),
            metricBinding(
              "surveilLabelGapScale",
              "spacing",
              style.labels.surveil.labelGapScale,
            ),
          ]
        : []),
    ]);
  }

  if (classId.startsWith("secondaryRing.")) {
    if (classId.endsWith(".leader")) {
      return Object.freeze([
        ...linePaintBindings(style, "outerLeader"),
        colorBinding(
          WHEEL_COLOR_TOKENS.outerLeader,
          style.elementColors.outerLeader,
        ),
      ]);
    }
    const symbol = classId.endsWith(".glyph");
    const motion = classId.endsWith(".motion");
    const projected =
      classId.startsWith("secondaryRing.antiscia.")
      || classId.startsWith("secondaryRing.contraAntiscia.")
      || classId.startsWith("secondaryRing.dodecatemoria.")
      || classId === "secondaryRing.parallelTransit.glyph";
    const metricKey: keyof WheelRenderTokens = motion
      ? "motionScale"
      : projected
        ? "outerProjectedGlyphScale"
        : "outerLabelScale";
    const metricValue = motion
      ? style.typography.ratios.motionScale
      : projected
        ? style.typography.ratios.outerProjectedGlyphScale
        : style.typography.ratios.outerLabelScale;
    return Object.freeze([
      // The roles this class actually paints with, and only those. It used to
      // offer positions, signs and bright text; the renderer uses none of the
      // three. `buildOuterItemLabel` paints every text and glyph run with
      // `palette.textDim` (a planet run takes that body's own colour, which is
      // edited from the body role), and the authoring adapter's own fallback
      // for `secondaryRing.*` is textDim as well. Three roles that are not
      // painted is what put three identical, inert "Colour" rows on one label.
      colorBinding(CHART_COLOR_TOKENS.textDim, style.palette.textDim),
      fontBinding(
        symbol ? APP_FONT_TOKENS.symbols : APP_FONT_TOKENS.ui,
        symbol
          ? style.typography.families.symbols
          : style.typography.families.ui,
      ),
      metricBinding(metricKey, "font-size", metricValue),
    ]);
  }

  if (classId.startsWith("chartOverlay.")) {
    const information =
      classId.startsWith("chartOverlay.information.")
      || classId === "chartOverlay.houseSystem.bottomRight";
    const symbol =
      classId.endsWith(".glyph")
      || classId === "chartOverlay.events.header.trailing";
    const compact = region.compactOverlay === true;
    const metricKey: keyof WheelRenderTokens = information
      ? compact
        ? "overlayCompactInfoFontScale"
        : "overlayInfoFontScale"
      : symbol
        ? compact
          ? "overlayCompactIconScale"
          : "overlayIconScale"
        : compact
          ? "overlayCompactLabelScale"
          : "overlayLabelScale";
    const metricValue = information
      ? compact
        ? style.overlays.compactInfoFontScale
        : style.overlays.infoFontScale
      : symbol
        ? compact
          ? style.overlays.compactIconScale
          : style.overlays.iconScale
        : compact
          ? style.overlays.compactLabelScale
          : style.overlays.labelScale;
    const color = region.bodyId
      ? colorBinding(
          bodyColorToken(region.bodyId),
          region.colorValue,
        )
      : colorBinding(
          CHART_COLOR_TOKENS.textDim,
          region.colorValue ?? style.palette.textDim,
        );
    return Object.freeze([
      color,
      fontBinding(
        symbol ? APP_FONT_TOKENS.symbols : APP_FONT_TOKENS.ui,
        symbol
          ? style.typography.families.symbols
          : style.typography.families.ui,
      ),
      metricBinding(metricKey, "font-size", metricValue),
    ]);
  }

  return Object.freeze([]);
}

function appendStyleTargetElement(
  elements: StyleSceneElement[],
  tags: readonly string[],
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  hitRegions: readonly ChartHitRegion[],
  useIndividualBodyColors: boolean | undefined,
  useZodiacElementColors: boolean | undefined,
  signColors: readonly string[] | undefined,
  region: StyleTargetHitRegion,
): void {
  // This class is derived once from interchart aspect endpoints below, matching
  // the renderer's longitude deduplication without a second hit-region source.
  if (region.classId === "aspects.interchart.endpointMarker") return;
  if (!isWheelSemanticClassId(region.classId)) return;
  const definition = WHEEL_SEMANTIC_CLASS_BY_ID.get(region.classId);
  if (!definition) return;
  const hitGeometry = styleTargetGeometry(region);
  if (!hitGeometry) return;
  elements.push(element({
    classId: definition.id,
    id: `wheel.style-target.${safeIdPart(region.itemId)}`,
    parentId: MANIFEST_PARENT_IDS[definition.groupId],
    labelKey: definition.labelKey,
    layer: definition.layer,
    primitive: definition.primitive,
    tokenBindings: styleTargetTokenBindings(
      region,
      style,
      profile,
      hitRegions,
      useIndividualBodyColors,
      useZodiacElementColors,
      signColors,
    ),
    editability: EDITABLE,
    hitGeometry,
    handles: [],
    priority: (region.priority ?? 45) + 100,
    stateTags: Object.freeze([
      ...tags,
      "production-style-target",
      `style-target:${region.classId}`,
      `item:${region.itemId}`,
    ]),
  }, tags));
}

/**
 * The authored length of a body leader — the short radial "foot" under a glyph.
 * Classic and Compact author it as a fraction of the wheel radius; Anglo
 * authors it as an inset scaled by the sign ring, which is the base the
 * renderer divides by, so a drag reads as radial pixels either way.
 */
function bodyLeaderLengthToken(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  maxRadius: number,
  rings: Readonly<WheelRingSet>,
): RadiusTokenBinding {
  if (profile === "anglo") {
    return {
      key: "angloLeaderInsetScale",
      value: style.geometry.anglo.leaderInsetScale,
      valuePerPixel: 1 / Math.max(1, rings.r30),
    };
  }
  return {
    key: "classicPlanetLineLength",
    value: style.geometry.classic.planetLineLength,
    valuePerPixel: 1 / Math.max(1, maxRadius),
  };
}

/**
 * The authored length of an angle arrowhead, from its base to its apex.
 *
 * Anglo has no equivalent token: its arrowhead is a filled triangle seated on
 * the inner boundary and sized by `arrowInset`/`arrowMaximum`, neither of which
 * is exposed as a render token, so Anglo returns null until they are.
 */
function angleArrowLengthToken(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  maxRadius: number,
): RadiusTokenBinding | null {
  if (profile === "anglo") return null;
  return {
    key: "classicArrowLength",
    value: style.geometry.classic.arrowLength,
    valuePerPixel: 1 / Math.max(1, maxRadius),
  };
}

function linearHandle(
  elementId: string,
  idSuffix: string,
  position: StyleScenePoint,
  key: keyof WheelRenderTokens,
  property: StyleSceneTokenProperty,
  value: number,
  valuePerPixel: number,
): StyleSceneHandle {
  return Object.freeze({
    id: `${elementId}.handle.${idSuffix}`,
    elementId,
    kind: "linear",
    origin: position,
    position,
    axis: [1, 0] as const,
    editability: EDITABLE,
    binding: directMetricBinding(key, property, value, valuePerPixel),
  });
}

type DirectAuthoringHandleProperty = Extract<
  WheelAuthoringFlatProperty,
  "radius" | "fontSize" | "strokeWidth"
>;

function directAuthoringHandleProperty(
  property: StyleSceneTokenProperty,
): DirectAuthoringHandleProperty | null {
  if (property === "radius") return "radius";
  if (property === "font-size") return "fontSize";
  if (property === "stroke-width") return "strokeWidth";
  return null;
}

function directAuthoringHandleValue(
  defaults: StyleSceneAuthoringDefaults | undefined,
  property: DirectAuthoringHandleProperty,
): number | undefined {
  if (property === "radius") return defaults?.radiusPx;
  if (property === "fontSize") return defaults?.fontSizePx;
  return defaults?.strokeWidthPx;
}

function authoringHandleMetadata(
  semanticId: string,
): StyleSceneTokenDragMetadata | null {
  if (!semanticId.startsWith(WHEEL_AUTHORING_OVERRIDE_PREFIX)) return null;
  const preset = semanticId.endsWith(".radius")
    ? AUTHORING_NUMERIC_PROPERTIES.radius
    : semanticId.endsWith(".fontSize")
      ? AUTHORING_NUMERIC_PROPERTIES.glyphSize
      : semanticId.endsWith(".strokeWidth")
        ? AUTHORING_NUMERIC_PROPERTIES.strokeWidth
        : null;
  return preset == null
    ? null
    : {
        min: preset.hardBounds.min,
        max: preset.hardBounds.max,
        step: preset.fineStep,
      };
}

function appendBodyElement(
  elements: StyleSceneElement[],
  handles: StyleSceneHandle[],
  tags: readonly string[],
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  maxRadius: number,
  useIndividualBodyColors: boolean | undefined,
  region: Extract<ChartHitRegion, { kind: "planet" | "fortune" | "vertex" | "syzygy" | "eclipse" }>,
  // The Anglo leader inset scales by the sign ring, so the leader length
  // handle needs the resolved rings to read as radial pixels.
  rings: Readonly<WheelRingSet>,
): void {
  const role = region.chartRole === "outer" ? "outer" : "primary";
  const bodyId =
    region.kind === "planet" ? region.planetId : region.kind;
  const id = `wheel.body.${role}.${safeIdPart(bodyId)}`;
  const isSpecialPoint = region.kind !== "planet";
  const scaleKey = role === "outer" ? outerScaleToken(profile) : "bodyScale";
  const scaleValue =
    role === "outer"
      ? style.typography.ratios.outer[profile]
      : style.typography.ratios.body;
  const scaleHandle = isSpecialPoint
    ? null
    : linearHandle(
        id,
        "scale",
        [region.x + region.r, region.y],
        scaleKey,
        "font-size",
        scaleValue,
        1 / Math.max(1, maxRadius),
      );
  const primaryColor =
    region.kind === "planet"
      ? bodyColorToken(region.planetId)
      : region.kind === "fortune"
        ? CHART_COLOR_TOKENS.fortune
        : CHART_COLOR_TOKENS.positions;
  const paintRole: WheelLinePaintRole =
    role === "outer" ? "outerLeader" : "bodyLeader";
  const colorTokens: Array<readonly [string, string]> = [primaryColor];
  if (region.kind === "planet" && useIndividualBodyColors === false) {
    colorTokens.splice(
      0,
      colorTokens.length,
      dignityColorToken(region.dignity) ?? CHART_COLOR_TOKENS.peregrin,
    );
  } else if (region.kind === "planet" && useIndividualBodyColors == null) {
    const dignity = dignityColorToken(region.dignity);
    if (dignity) colorTokens.push(dignity);
  } else if (region.kind === "fortune" && useIndividualBodyColors === false) {
    colorTokens.splice(0, colorTokens.length, CHART_COLOR_TOKENS.peregrin);
  } else if (region.kind === "vertex") {
    colorTokens.splice(0, colorTokens.length, CHART_COLOR_TOKENS.peregrin);
  }
  const bindings: StyleSceneTokenBinding[] = [
    ...colorTokens.map((token) => colorBinding(token)),
    fontBinding(APP_FONT_TOKENS.bodySymbols, style.typography.families.bodySymbols),
    ...(isSpecialPoint ? [] : [metricBinding(scaleKey, "font-size", scaleValue)]),
  ];
  // Fortune, the Vertex and the prenatal syzygy are body glyphs and are
  // authored as body glyphs. They used to be three classes of their own that
  // carried a colour and nothing else, so clicking one offered no size, no
  // font and no opacity — those lived on `bodies.inner.glyph`, which the user
  // had no way to know. Their own colours are unchanged: those ride on the
  // occurrence palette roles bound above, not on the class.
  const bodyClassId = role === "outer"
    ? "bodies.outer.glyph"
    : "bodies.inner.glyph";
  if (scaleHandle) handles.push(scaleHandle);
  elements.push(
    element(
      {
        classId: bodyClassId,
        id,
        parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.bodies,
        labelKey: "styleLab.scene.bodyGlyphs",
        layer: role === "outer" ? "outer-label" : "dynamic",
        primitive: "text",
        tokenBindings: Object.freeze(bindings),
        editability: EDITABLE,
        hitGeometry: regionPointGeometry(region),
        handles: Object.freeze(scaleHandle ? [scaleHandle] : []),
        priority: (region.priority ?? 40) + 100,
      },
      Object.freeze([...tags, `role:${role}`, `body:${bodyId}`]),
    ),
  );
  if (region.leaderSegments?.length) {
    const leaderId = `${id}.leader`;
    const geometries = region.leaderSegments.map((segment) => ({
      kind: "line" as const,
      start: segment.start,
      end: segment.end,
      tolerance: Math.max(4, maxRadius * 0.008),
    }));
    const first = region.leaderSegments[0];
    const midpoint: StyleScenePoint = [
      (first.start[0] + first.end[0]) / 2,
      (first.start[1] + first.end[1]) / 2,
    ];
    const leaderHandle = linearHandle(
      leaderId,
      "stroke",
      midpoint,
      linePaintTokenKey(paintRole, "WidthScale"),
      "stroke-width",
      style.linePaint[paintRole].widthScale,
      0.05,
    );
    const leaderColorKey = role === "outer"
      ? profile === "anglo" ? "angloOuterLeader" : "outerLeader"
      : profile === "anglo" ? "angloBodyLeader" : "bodyLeader";
    const leaderLength = bodyLeaderLengthToken(style, profile, maxRadius, rings);
    const leaderLengthHandle = linearHandle(
      leaderId,
      "length",
      first.end,
      leaderLength.key,
      "offset",
      leaderLength.value,
      leaderLength.valuePerPixel,
    );
    handles.push(leaderHandle, leaderLengthHandle);
    elements.push(element({
      classId: role === "outer" ? "bodies.outer.leader" : "bodies.inner.leader",
      id: leaderId,
      parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.bodies,
      labelKey: role === "outer"
        ? "styleLab.scene.outerLeader"
        : "styleLab.scene.bodyLeader",
      layer: "dynamic",
      primitive: "line",
      tokenBindings: Object.freeze([
        ...linePaintBindings(style, paintRole),
        colorBinding(WHEEL_COLOR_TOKENS[leaderColorKey], style.elementColors[leaderColorKey]),
        metricBinding(leaderLength.key, "offset", leaderLength.value),
      ]),
      editability: EDITABLE,
      hitGeometry: geometries.length === 1
        ? geometries[0]
        : { kind: "compound", geometries: Object.freeze(geometries) },
      handles: Object.freeze([leaderHandle, leaderLengthHandle]),
      priority: (region.priority ?? 40) + 99,
    }, Object.freeze([
      ...tags,
      `role:${role}`,
      `body:${bodyId}`,
      "component:leader",
    ])));
  }
}

function appendHouseElements(
  elements: StyleSceneElement[],
  handles: StyleSceneHandle[],
  tags: readonly string[],
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  center: StyleScenePoint,
  ascendantDegrees: number,
  rings: Readonly<WheelRingSet>,
  maxRadius: number,
  region: Extract<ChartHitRegion, { kind: "house" }>,
  includeCusp: boolean,
): void {
  const layoutUnit = resolveWheelTypographyMetrics(style, profile, maxRadius).layoutUnit;
  const suffix = safeIdPart(region.houseIndex);
  if (includeCusp) {
    const cuspId = `wheel.house.cusp.${suffix}`;
    const start = projectWheelPoint(center, rings.rBase, region.longitude, ascendantDegrees);
    const end = projectWheelPoint(center, rings.rInner, region.longitude, ascendantDegrees);
    const cuspHandle = linearHandle(
      cuspId,
      "stroke",
      end,
      linePaintTokenKey("houseCusp", "WidthScale"),
      "stroke-width",
      style.linePaint.houseCusp.widthScale,
      0.05,
    );
    handles.push(cuspHandle);
    elements.push(
      element(
        {
          classId: "houses.inner.cusp",
          id: cuspId,
          parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.houses,
          labelKey: "styleLab.scene.houseCusp",
          layer: "geometry",
          primitive: "line",
          tokenBindings: Object.freeze([
            ...linePaintBindings(style, "houseCusp"),
            colorBinding(WHEEL_COLOR_TOKENS.houseCusp, style.elementColors.houseCusp),
          ]),
          editability: EDITABLE,
          hitGeometry: { kind: "line", start, end, tolerance: Math.max(5, maxRadius * 0.01) },
          handles: Object.freeze([cuspHandle]),
          priority: (region.priority ?? 22) + 100,
        },
        Object.freeze([...tags, `house:${region.houseIndex}`]),
      ),
    );
  }

  const labelId = `wheel.house.label.${suffix}`;
  const labelHandle = linearHandle(
    labelId,
    "scale",
    [region.x + region.r, region.y],
    "houseLabelScale",
    "font-size",
    style.typography.ratios.houseLabelScale,
    1 / Math.max(1, layoutUnit),
  );
  handles.push(labelHandle);
  elements.push(
    element(
      {
        classId: "houses.inner.label",
        id: labelId,
        parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.houses,
        labelKey: "styleLab.scene.houseLabel",
        layer: "geometry",
        primitive: "text",
        tokenBindings: Object.freeze([
          colorBinding(
            profile === "anglo"
              ? WHEEL_COLOR_TOKENS.angloHouseLabel
              : WHEEL_COLOR_TOKENS.houseLabel,
            profile === "anglo"
              ? style.elementColors.angloHouseLabel
              : style.elementColors.houseLabel,
          ),
          fontBinding(APP_FONT_TOKENS.ui, style.typography.families.ui),
          metricBinding(
            "houseLabelScale",
            "font-size",
            style.typography.ratios.houseLabelScale,
          ),
        ]),
        editability: EDITABLE,
        hitGeometry: regionPointGeometry(region),
        handles: Object.freeze([labelHandle]),
        priority: (region.priority ?? 22) + 101,
      },
      Object.freeze([...tags, `house:${region.houseIndex}`]),
    ),
  );
}

function appendSignElement(
  elements: StyleSceneElement[],
  handles: StyleSceneHandle[],
  tags: readonly string[],
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  maxRadius: number,
  useZodiacElementColors: boolean | undefined,
  signColor: string | undefined,
  region: Extract<ChartHitRegion, { kind: "sign" }>,
): void {
  const id = `wheel.zodiac.sign.${safeIdPart(region.signIndex)}`;
  const scaleKey = signScaleToken(profile);
  const scaleValue = style.typography.ratios.sign[profile];
  const scaleHandle = linearHandle(
    id,
    "scale",
    [region.x + Math.max(4, region.outerRadius - region.innerRadius), region.y],
    scaleKey,
    "font-size",
    scaleValue,
    1 / Math.max(1, maxRadius),
  );
  handles.push(scaleHandle);
  const signColorToken = useZodiacElementColors
    ? ELEMENT_COLOR_TOKENS[region.signIndex % ELEMENT_COLOR_TOKENS.length]
    : CHART_COLOR_TOKENS.signs;
  elements.push(
    element(
      {
        classId: "zodiac.signGlyph",
        id,
        parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.zodiac,
        labelKey: "styleLab.scene.zodiacSign",
        layer: "geometry",
        primitive: "text",
        tokenBindings: Object.freeze([
          colorBinding(signColorToken, signColor ?? style.palette.signs),
          fontBinding(APP_FONT_TOKENS.signSymbols, style.typography.families.signSymbols),
          metricBinding(scaleKey, "font-size", scaleValue),
        ]),
        editability: EDITABLE,
        hitGeometry: {
          kind: "rectangle",
          x: region.x - (maxRadius * scaleValue) / 2,
          y: region.y - (maxRadius * scaleValue) / 2,
          width: maxRadius * scaleValue,
          height: maxRadius * scaleValue,
          tolerance: Math.max(2, maxRadius * 0.004),
        },
        handles: Object.freeze([scaleHandle]),
        priority: (region.priority ?? 10) + 100,
      },
      Object.freeze([...tags, `sign:${region.signIndex}`]),
    ),
  );
}

function appendSubdivisionElement(
  elements: StyleSceneElement[],
  handles: StyleSceneHandle[],
  tags: readonly string[],
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  maxRadius: number,
  region: Extract<ChartHitRegion, { kind: "subdivision" }>,
): void {
  const id = `wheel.${region.family}.${region.component}.${safeIdPart(region.itemId)}`;
  if (region.component === "boundary") {
    const paintRole: WheelLinePaintRole = region.family === "term"
      ? "termBoundary"
      : "decanBoundary";
    const start: StyleScenePoint = [region.x1 ?? region.x, region.y1 ?? region.y];
    const end: StyleScenePoint = [region.x2 ?? region.x, region.y2 ?? region.y];
    const strokeHandle = linearHandle(
      id,
      "stroke",
      [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
      linePaintTokenKey(paintRole, "WidthScale"),
      "stroke-width",
      style.linePaint[paintRole].widthScale,
      0.05,
    );
    handles.push(strokeHandle);
    elements.push(element({
      classId: region.family === "term"
        ? "subdivisions.term.boundary"
        : "subdivisions.decan.boundary",
      id,
      parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.zodiac,
      labelKey: region.family === "term"
        ? "styleLab.scene.termBoundary"
        : "styleLab.scene.decanBoundary",
      layer: "geometry",
      primitive: "line",
      tokenBindings: Object.freeze([
        ...linePaintBindings(style, paintRole),
        colorBinding(
          region.family === "term"
            ? WHEEL_COLOR_TOKENS.termBoundary
            : WHEEL_COLOR_TOKENS.decanBoundary,
          region.family === "term"
            ? style.elementColors.termBoundary
            : style.elementColors.decanBoundary,
        ),
      ]),
      editability: EDITABLE,
      hitGeometry: {
        kind: "line",
        start,
        end,
        tolerance: region.tolerance ?? Math.max(4, maxRadius * 0.008),
      },
      handles: Object.freeze([strokeHandle]),
      priority: (region.priority ?? 14) + 100,
    }, Object.freeze([
      ...tags,
      `subdivision:${region.family}`,
      "component:boundary",
    ])));
    return;
  }

  const scaleKey: keyof WheelRenderTokens = region.family === "term"
    ? "termGlyphScale"
    : "decanGlyphScale";
  const scaleValue = region.family === "term"
    ? style.typography.ratios.termGlyphScale
    : style.typography.ratios.decanGlyphScale;
  const scaleHandle = linearHandle(
    id,
    "scale",
    [region.x + Math.max(4, region.r), region.y],
    scaleKey,
    "font-size",
    scaleValue,
    1 / Math.max(1, maxRadius * style.typography.ratios.subdivision[profile]),
  );
  handles.push(scaleHandle);
  elements.push(element({
    classId: region.family === "term"
      ? "subdivisions.term.glyph"
      : "subdivisions.decan.glyph",
    id,
    parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.zodiac,
    labelKey: region.family === "term"
      ? "styleLab.scene.termGlyph"
      : "styleLab.scene.decanGlyph",
    layer: "dynamic",
    primitive: "text",
    tokenBindings: Object.freeze([
      colorBinding(
        region.family === "term"
          ? WHEEL_COLOR_TOKENS.termGlyph
          : WHEEL_COLOR_TOKENS.decanGlyph,
        region.family === "term"
          ? style.elementColors.termGlyph
          : style.elementColors.decanGlyph,
      ),
      fontBinding(
        region.family === "term" ? APP_FONT_TOKENS.termSymbols : APP_FONT_TOKENS.decanSymbols,
        region.family === "term"
          ? style.typography.families.termSymbols
          : style.typography.families.decanSymbols,
      ),
      metricBinding(scaleKey, "font-size", scaleValue),
    ]),
    editability: EDITABLE,
    hitGeometry: regionPointGeometry(region),
    handles: Object.freeze([scaleHandle]),
    priority: (region.priority ?? 15) + 100,
  }, Object.freeze([
    ...tags,
    `subdivision:${region.family}`,
    "component:glyph",
  ])));
}

function appendAngleElement(
  elements: StyleSceneElement[],
  handles: StyleSceneHandle[],
  tags: readonly string[],
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  center: StyleScenePoint,
  rings: Readonly<WheelRingSet>,
  maxRadius: number,
  ascendantDegrees: number,
  region: Extract<ChartHitRegion, { kind: "angle" }>,
  includeRay: boolean,
): void {
  const role = region.chartRole === "outer" ? "outer" : "primary";
  const typography = resolveWheelTypographyMetrics(style, profile, maxRadius);
  const labelUnit = role === "outer"
    ? typography.outerLayoutUnit
    : typography.layoutUnit;
  const id = `wheel.angle.${role}.${safeIdPart(region.angleId)}`;
  const startRadius =
    role === "outer" ? (rings.rOuterMin ?? rings.r30) : rings.rBase;
  const start = projectWheelPoint(center, startRadius, region.longitude, ascendantDegrees);
  const end: StyleScenePoint = [region.x, region.y];
  if (includeRay) {
    const strokeHandle = linearHandle(
      id,
      "stroke",
      end,
      linePaintTokenKey("angle", "WidthScale"),
      "stroke-width",
      style.linePaint.angle.widthScale,
      0.05,
    );
    handles.push(strokeHandle);
    elements.push(
      element(
        {
          classId: role === "outer" ? "angles.outer.ray" : "angles.inner.ray",
          id,
          parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.angles,
          labelKey: "styleLab.scene.angle",
          layer: "geometry",
          primitive: "line",
          tokenBindings: Object.freeze([
            ...linePaintBindings(style, "angle"),
            colorBinding(WHEEL_COLOR_TOKENS.angleRay, style.elementColors.angleRay),
          ]),
          editability: EDITABLE,
          hitGeometry: {
            kind: "line",
            start,
            end,
            tolerance: Math.max(5, maxRadius * 0.01),
          },
          handles: Object.freeze([strokeHandle]),
          priority: (region.priority ?? 30) + 100,
        },
        Object.freeze([...tags, `role:${role}`, `angle:${region.angleId}`]),
      ),
    );
  }
  if (
    region.left != null &&
    region.top != null &&
    region.width != null &&
    region.height != null
  ) {
    const labelId = `${id}.label`;
    const labelHandle = linearHandle(
      labelId,
      "scale",
      [region.x + region.r, region.y],
      "angleLabelScale",
      "font-size",
      style.typography.ratios.angleLabelScale,
      1 / Math.max(1, labelUnit),
    );
    handles.push(labelHandle);
    elements.push(element({
      classId: role === "outer" ? "angles.outer.label" : "angles.inner.label",
      id: labelId,
      parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.angles,
      labelKey: "styleLab.scene.angleLabel",
      layer: role === "outer" ? "outer-label" : "geometry",
      primitive: "text",
      tokenBindings: Object.freeze([
        colorBinding(WHEEL_COLOR_TOKENS.angleLabel, style.elementColors.angleLabel),
        fontBinding(APP_FONT_TOKENS.ui, style.typography.families.ui),
        metricBinding(
          "angleLabelScale",
          "font-size",
          style.typography.ratios.angleLabelScale,
        ),
        metricBinding(
          "angleLabelWeight",
          "font-weight",
          style.typography.ratios.angleLabelWeight,
        ),
      ]),
      editability: EDITABLE,
      hitGeometry: regionPointGeometry(region),
      handles: Object.freeze([labelHandle]),
      priority: (region.priority ?? 30) + 101,
    }, Object.freeze([
      ...tags,
      `role:${role}`,
      `angle:${region.angleId}`,
      "component:label",
    ])));
  }
}

function appendAspectElement(
  elements: StyleSceneElement[],
  handles: StyleSceneHandle[],
  tags: readonly string[],
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  region: Extract<ChartHitRegion, { kind: "aspect" }>,
): void {
  const shape = region.shape === "glyph" ? "glyph" : "line";
  const scope = region.scope ?? "primary";
  const id = `wheel.aspect.${scope}.${safeIdPart(region.p1)}.${safeIdPart(region.p2)}.${region.aspectType}.${shape}`;
  const widthKey = profile === "anglo" ? "aspectAngloWidth" : "aspectClassicWidth";
  const widthValue =
    profile === "anglo"
      ? style.strokes.aspects.angloWidth
      : style.strokes.aspects.classicWidth;
  const handleKey =
    shape === "glyph"
      ? "aspectGlyphScale"
      : linePaintTokenKey("aspect", "WidthScale");
  const handleValue =
    shape === "glyph"
      ? style.typography.ratios.aspectGlyphScale
      : style.linePaint.aspect.widthScale;
  const property: StyleSceneTokenProperty =
    shape === "glyph" ? "font-size" : "stroke-width";
  const directHandle = linearHandle(
    id,
    property,
    [region.x + Math.max(4, region.r), region.y],
    handleKey,
    property,
    handleValue,
    shape === "glyph" ? 0.01 : 0.05,
  );
  const geometry: StyleSceneHitGeometry =
    shape === "line"
      ? {
          kind: "line",
          start: [region.x1 ?? region.x, region.y1 ?? region.y],
          end: [region.x2 ?? region.x, region.y2 ?? region.y],
          tolerance: region.tolerance ?? 4,
        }
      : regionPointGeometry(region);
  handles.push(directHandle);
  elements.push(
    element(
      {
        classId: shape === "glyph"
          ? `aspects.${scope}.glyph`
          : `aspects.${scope}.line`,
        id,
        parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.aspects,
        labelKey:
          shape === "glyph" ? "styleLab.scene.aspectGlyph" : "styleLab.scene.aspectLine",
        layer: "dynamic",
        primitive: shape === "glyph" ? "text" : "line",
        tokenBindings: Object.freeze([
          ...(shape === "line"
            ? [
                ...linePaintBindings(style, "aspect"),
                metricBinding(widthKey, "stroke-width", widthValue),
              ]
            : []),
          colorBinding(aspectColorToken(region.aspectType)),
          ...(shape === "glyph"
            ? [
                fontBinding(APP_FONT_TOKENS.aspectSymbols, style.typography.families.aspectSymbols),
                metricBinding(
                  "aspectGlyphScale",
                  "font-size",
                  style.typography.ratios.aspectGlyphScale,
                ),
              ]
            : []),
        ]),
        editability: EDITABLE,
        hitGeometry: geometry,
        handles: Object.freeze([directHandle]),
        priority: (region.priority ?? (shape === "glyph" ? 32 : 18)) + 100,
      },
      Object.freeze([
        ...tags,
        `scope:${scope}`,
        `aspect:${region.aspectType}`,
        `shape:${shape}`,
      ]),
    ),
  );
}

function appendInterchartEndpointMarker(
  elements: StyleSceneElement[],
  handles: StyleSceneHandle[],
  tags: readonly string[],
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  center: StyleScenePoint,
  rings: Readonly<WheelRingSet>,
  maxRadius: number,
  region: Extract<ChartHitRegion, { kind: "aspect" }>,
  seenEndpoints: Set<string>,
): void {
  if (region.scope !== "interchart" || region.shape === "glyph") return;
  const endpoint: StyleScenePoint = [
    region.x2 ?? region.x,
    region.y2 ?? region.y,
  ];
  const dx = endpoint[0] - center[0];
  const dy = endpoint[1] - center[1];
  const distance = Math.hypot(dx, dy);
  if (distance <= 0) return;
  const unitX = dx / distance;
  const unitY = dy / distance;
  const endpointKey = `${unitX.toFixed(6)}:${unitY.toFixed(6)}`;
  if (seenEndpoints.has(endpointKey)) return;
  seenEndpoints.add(endpointKey);

  const start: StyleScenePoint = [
    center[0] + unitX * rings.rAsp,
    center[1] + unitY * rings.rAsp,
  ];
  const end: StyleScenePoint = [
    center[0] + unitX * rings.rLLine2,
    center[1] + unitY * rings.rLLine2,
  ];
  const id = `wheel.aspect.interchart.endpoint.${safeIdPart(region.p2)}`;
  const midpoint: StyleScenePoint = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
  ];
  const strokeHandle = linearHandle(
    id,
    "stroke",
    midpoint,
    linePaintTokenKey("bodyLeader", "WidthScale"),
    "stroke-width",
    style.linePaint.bodyLeader.widthScale,
    0.05,
  );
  const colorKey = profile === "anglo"
    ? "angloBodyLeader"
    : "bodyLeader";
  handles.push(strokeHandle);
  elements.push(element({
    classId: "aspects.interchart.endpointMarker",
    id,
    parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.aspects,
    labelKey: "styleLab.class.interchartEndpointMarker",
    layer: "dynamic",
    primitive: "line",
    tokenBindings: Object.freeze([
      ...linePaintBindings(style, "bodyLeader"),
      colorBinding(
        WHEEL_COLOR_TOKENS[colorKey],
        style.elementColors[colorKey],
      ),
    ]),
    editability: EDITABLE,
    hitGeometry: {
      kind: "line",
      start,
      end,
      tolerance: Math.max(region.tolerance ?? 4, maxRadius * 0.008),
    },
    handles: Object.freeze([strokeHandle]),
    priority: (region.priority ?? 18) + 101,
    stateTags: Object.freeze([
      ...tags,
      "scope:interchart",
      "component:endpoint-marker",
      `endpoint:${region.p2}`,
    ]),
  }, tags));
}

/**
 * The class an outer-ring item is authored through, or null when its family is
 * not one the manifest knows.
 *
 * It used to invent `secondaryRing.<family>.label` for an unknown family. That
 * id is not a manifest class, so the adapter reported nothing for it and the
 * inspector fell through to the item's raw renderer tokens — editing a fixed
 * star's colour there rewrote `chart.color.positions` for all twenty-five
 * classes that paint through it. Returning null instead means an item whose
 * family we cannot name is still drawn, but is not offered as something to
 * style; the contract test keeps every family the daemon actually ships
 * resolvable, so in practice this is unreachable.
 */
function secondaryClassId(
  family: string,
  projectedGlyph: boolean,
  segments?: readonly { kind: "text" | "planet" | "glyph" }[],
): string | null {
  const classes = resolveWheelSecondaryRingClassIds(family);
  if (!classes) return null;
  if (classes.label) return classes.label;
  const hasText = segments?.some((segment) => segment.kind === "text") ?? false;
  const hasGlyph = segments?.some((segment) => segment.kind !== "text") ?? false;
  if (hasText && !hasGlyph && classes.text) return classes.text;
  if (projectedGlyph && classes.glyph) return classes.glyph;
  return classes.glyph ?? classes.text ?? classes.motion ?? classes.leader;
}

function appendSecondaryElement(
  elements: StyleSceneElement[],
  handles: StyleSceneHandle[],
  tags: readonly string[],
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  maxRadius: number,
  region: Extract<ChartHitRegion, { kind: "secondary_ring" }>,
): void {
  const role = region.chartRole === "outer" ? "outer" : "primary";
  const id = `wheel.secondary.${safeIdPart(region.family)}.${safeIdPart(region.itemId)}.${role}`;
  const projectedGlyph = new Set([
    "antiscia",
    "contra_antiscia",
    "dodecatemoria",
    "parallel_transits",
  ]).has(region.family);
  const scaleKey: keyof WheelRenderTokens = projectedGlyph
    ? "outerProjectedGlyphScale"
    : "outerLabelScale";
  const scaleValue = projectedGlyph
    ? style.typography.ratios.outerProjectedGlyphScale
    : style.typography.ratios.outerLabelScale;
  const outerLayoutUnit = resolveWheelTypographyMetrics(
    style,
    profile,
    maxRadius,
  ).outerLayoutUnit;
  const scaleHandle = linearHandle(
    id,
    "scale",
    [region.x + Math.max(4, region.r), region.y],
    scaleKey,
    "font-size",
    scaleValue,
    1 / Math.max(1, outerLayoutUnit),
  );
  handles.push(scaleHandle);
  const labelGeometry = regionPointGeometry(region);
  const labelClassId = secondaryClassId(
    region.family,
    projectedGlyph,
    region.segments,
  );
  if (!labelClassId) return;
  const symbolClass = labelClassId.endsWith(".glyph");
  elements.push(
    element(
      {
        classId: labelClassId,
        id,
        parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.secondary,
        labelKey: "styleLab.scene.secondaryLabel",
        layer: "outer-label",
        primitive: "text",
        tokenBindings: Object.freeze([
          // Matches `styleTargetTokenBindings` above and the renderer: one
          // role, the one an outer-ring label is painted with.
          colorBinding(CHART_COLOR_TOKENS.textDim, style.palette.textDim),
          fontBinding(
            symbolClass ? APP_FONT_TOKENS.symbols : APP_FONT_TOKENS.ui,
            symbolClass
              ? style.typography.families.symbols
              : style.typography.families.ui,
          ),
          metricBinding(scaleKey, "font-size", scaleValue),
        ]),
        editability: EDITABLE,
        hitGeometry: labelGeometry,
        handles: Object.freeze([scaleHandle]),
        priority: (region.priority ?? 46) + 100,
      },
      Object.freeze([...tags, `family:${region.family}`, `role:${role}`]),
    ),
  );
  if (region.leader) {
    const leaderClassId =
      resolveWheelSecondaryRingClassIds(region.family)?.leader;
    if (!leaderClassId) return;
    const leaderId = `${id}.leader`;
    const leaderMidpoint: StyleScenePoint = [
      (region.leader.start[0] + region.leader.end[0]) / 2,
      (region.leader.start[1] + region.leader.end[1]) / 2,
    ];
    const leaderHandle = linearHandle(
      leaderId,
      "stroke",
      leaderMidpoint,
      linePaintTokenKey("outerLeader", "WidthScale"),
      "stroke-width",
      style.linePaint.outerLeader.widthScale,
      0.05,
    );
    handles.push(leaderHandle);
    elements.push(element({
      classId: leaderClassId,
      id: leaderId,
      parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.secondary,
      labelKey: "styleLab.scene.outerLeader",
      layer: "dynamic",
      primitive: "line",
      tokenBindings: Object.freeze([
        ...linePaintBindings(style, "outerLeader"),
        colorBinding(WHEEL_COLOR_TOKENS.outerLeader, style.elementColors.outerLeader),
      ]),
      editability: EDITABLE,
      hitGeometry: {
        kind: "line",
        start: region.leader.start,
        end: region.leader.end,
        tolerance: Math.max(4, maxRadius * 0.008),
      },
      handles: Object.freeze([leaderHandle]),
      priority: (region.priority ?? 46) + 99,
    }, Object.freeze([
      ...tags,
      `family:${region.family}`,
      `role:${role}`,
      "component:leader",
    ])));
  }
}

export function buildWheelStyleScene(
  input: WheelStyleSceneBuildInput,
): WheelStyleScene {
  const { geometry } = input;
  const style = projectWheelAuthoringStyle(
    input.style,
    geometry.maxRadius,
    geometry.profile,
  );
  const viewport = input.viewport ?? {
    width: geometry.maxRadius * 2,
    height: geometry.maxRadius * 2,
  };
  const center: StyleScenePoint = input.center ?? [viewport.width / 2, viewport.height / 2];
  const ascendantDegrees = input.ascendantDegrees ?? 0;
  const rings = resolveWheelRingSet(style, geometry);
  const tags = stateTags(geometry);
  const elements: StyleSceneElement[] = [];
  const handles: StyleSceneHandle[] = [];

  /**
   * The scope a handle drag must write to.
   *
   * Dragging the visible thing has to change the visible thing. A variant
   * value outranks the shared base one, so with the Edit scope on "All wheel
   * styles" a drag on a wheel whose variant already authors that property
   * accumulated into a base value nothing painted — the handle tracked the
   * pointer, the wheel stood still, and the change appeared all at once later,
   * when switching wheel style or resetting the variant made base govern
   * again. That is the diamond scaler's jump.
   *
   * The precedence is right; the write was aimed at the wrong shelf. So a
   * handle writes to base only while base is what governs, and to the variant
   * the moment the variant has a say. The inspector still edits whatever the
   * Edit scope names — this rule is for direct manipulation only, where the
   * gesture's whole promise is that the thing under the pointer moves.
   */
  const handleScope = (
    classId: string,
    property: WheelAuthoringFlatProperty,
  ): WheelAuthoringEditScope => {
    const scope = input.authoringScope ?? geometry.profile;
    if (scope !== "base") return scope;
    return input.variantAuthoredOverrideIds?.has(
      wheelAuthoringOverrideId(geometry.profile, classId, property),
    ) ? geometry.profile : scope;
  };

  /**
   * The whole-wheel scale handle.
   *
   * Its own affordance, sitting outside every ring, because scale and resize
   * are different operations and the tool must say which one it is doing
   * rather than infer it from the ring that happened to be grabbed. Inference
   * is what shipped before and it has no answer at all in the layouts where no
   * painted ring is outermost — a classic biwheel with houses hidden, or anglo
   * synastry — where the gesture silently did something else.
   *
   * Grabbing it authors one ratio and no radius, so every band keeps whatever
   * it was authored to be and returning the handle to 1 restores the wheel
   * exactly, even in a later gesture.
   */
  const chartScaleElement = (): StyleSceneElement => {
    const scale = resolveWheelScale(style, geometry.profile);
    // The wheel radius the pane would give at scale 1. The geometry arrives
    // already scaled, so the handle's own travel has to be measured against the
    // unscaled pane or a shrunken wheel would drag at a shrunken rate.
    const paneRadius = scale > 0 ? geometry.maxRadius / scale : geometry.maxRadius;
    const radius = geometry.maxRadius;
    const scaleHandle: StyleSceneHandle = {
      id: `${WHEEL_STYLE_SCENE_ELEMENT_IDS.chartScale}.handle.scale`,
      elementId: WHEEL_STYLE_SCENE_ELEMENT_IDS.chartScale,
      kind: "radial",
      center,
      radius,
      angleDegrees: CHART_SCALE_HANDLE_ANGLE,
      position: radialPoint(center, radius, CHART_SCALE_HANDLE_ANGLE),
      editability: EDITABLE,
      binding: {
        semanticId: wheelAuthoringOverrideId(
          handleScope(WHEEL_CHART_CLASS_ID, "scale"),
          WHEEL_CHART_CLASS_ID,
          "scale",
        ),
        cssVar: "",
        property: "scale",
        value: scale,
        // One rendered pixel of outward travel is one pixel of unscaled wheel
        // radius, so the handle tracks the pointer exactly at any scale.
        valuePerPixel: 1 / Math.max(1, paneRadius),
        min: WHEEL_SCALE_RANGE.min,
        max: WHEEL_SCALE_RANGE.max,
      },
    };
    handles.push(scaleHandle);
    return element(
      {
        classId: WHEEL_CHART_CLASS_ID,
        id: WHEEL_STYLE_SCENE_ELEMENT_IDS.chartScale,
        parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.root,
        labelKey: "styleLab.scene.chartScale",
        layer: "geometry",
        primitive: "circle",
        // Authoring-only: scale has no CSS variable behind it, and
        // `tokenBindings` is the channel for values that do. The handle carries
        // the binding instead.
        tokenBindings: [],
        editability: EDITABLE,
        // Selectable only through its handle. Giving it a hit circle at the
        // wheel's edge would put a chart-wide control in the path of every
        // click near the rim.
        hitGeometry: null,
        handles: Object.freeze([scaleHandle]),
        priority: -40,
      },
      tags,
    );
  };

  /**
   * A diamond on each band span's inner edge — the circle it drags.
   *
   * The handle IS that boundary: it tracks the pointer, and the ring above
   * redistributes to follow. That is the difference from the disc on the same
   * circle, which moves the line alone and lets neighbours merely yield.
   */
  const bandSpanElements = (): StyleSceneElement[] => {
    const built: StyleSceneElement[] = [];
    // No reference-space conversion here any more: the span authors a factor,
    // which means the same thing at every wheel radius.
    for (const spanId of Object.keys(WHEEL_BAND_SPANS)) {
      const span = resolveWheelBandSpanFields(geometry, spanId);
      if (!span) continue;
      const inner = rings[span.innerField];
      if (typeof inner !== "number" || !(inner > 0)) continue;
      const range = resolveWheelBandSpanScaleRange(style, geometry, spanId);
      const anchorRadius = span.outerField === null
        ? geometry.maxRadius
        : rings[span.outerField];
      if (typeof anchorRadius !== "number") continue;
      const depth = anchorRadius - inner;
      if (!(depth > 1e-9)) continue;
      const currentScale = resolveWheelBandSpanScale(
        style, geometry.profile, spanId, anchorRadius, inner, geometry.maxRadius,
      ) ?? 1;
      const elementId = `${WHEEL_STYLE_SCENE_ELEMENT_IDS.bandSpan}.${spanId}`;
      const spanHandle: StyleSceneHandle = {
        id: `${elementId}.handle.inner`,
        elementId,
        kind: "radial",
        center,
        radius: inner,
        angleDegrees: BAND_SPAN_HANDLE_ANGLE,
        position: radialPoint(center, inner, BAND_SPAN_HANDLE_ANGLE),
        editability: EDITABLE,
        binding: {
          semanticId: wheelAuthoringOverrideId(
            handleScope(wheelBandSpanClassId(spanId), "spanScale"),
            wheelBandSpanClassId(spanId),
            "spanScale",
          ),
          cssVar: "",
          property: "spanScale",
          // A factor, not a radius. The diamond still tracks the pointer
          // exactly: one rendered pixel outward is one pixel of the unscaled
          // run, and the run shortens as the factor falls.
          value: currentScale * 100,
          valuePerPixel: -(currentScale / depth) * 100,
          ...(range ? { min: range.min * 100, max: range.max * 100 } : {}),
        },
      };
      handles.push(spanHandle);
      built.push(element(
        {
          classId: wheelBandSpanClassId(spanId),
          id: elementId,
          parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.root,
          labelKey: `styleLab.scene.bandSpan.${spanId}`,
          layer: "geometry",
          primitive: "circle",
          tokenBindings: [],
          editability: EDITABLE,
          // Handle only: a hit ring here would sit on the painted boundary and
          // steal clicks meant for that line's own disc.
          hitGeometry: null,
          handles: Object.freeze([spanHandle]),
          priority: -45,
        },
        tags,
      ));
    }
    return built;
  };

  elements.push(
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.root, undefined, "styleLab.scene.wheel", "geometry", tags),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.layerGeometry, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.geometryLayer", "geometry", tags, "layers.geometry"),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.layerDynamic, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.dynamicLayer", "dynamic", tags, "layers.dynamic"),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.layerOuterLabel, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.outerLabelLayer", "outer-label", tags, "layers.outerLabel"),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.fills, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.fills", "geometry", tags),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.rings, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.rings", "geometry", tags),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.zodiac, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.zodiac", "geometry", tags),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.houses, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.houses", "geometry", tags),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.angles, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.angles", "geometry", tags),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.bodies, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.bodies", "dynamic", tags),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.aspects, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.aspects", "dynamic", tags),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.secondary, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.secondary", "outer-label", tags),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.overlays, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.overlays", "overlay", tags),
    element(
      {
        classId: "canvas.background",
        id: WHEEL_STYLE_SCENE_ELEMENT_IDS.canvas,
        parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.root,
        labelKey: "styleLab.scene.canvas",
        layer: "geometry",
        primitive: "surface",
        tokenBindings: [],
        authoringDefaults: readWheelAuthoringClassDefaults(
          style,
          geometry.profile,
          "canvas.background",
          { geometry, targetWheelRadius: geometry.maxRadius },
        ),
        editability: EDITABLE,
        hitGeometry: { kind: "rectangle", x: 0, y: 0, width: viewport.width, height: viewport.height },
        handles: [],
        priority: -50,
      },
      tags,
    ),
    chartScaleElement(),
    ...bandSpanElements(),
  );

  const addFillRegion = (
    classId:
      | "fills.chartField"
      | "fills.houseField"
      | "fills.centerField"
      | "fills.zodiacBand"
      | "fills.subdivisionBand",
    id: string,
    labelKey: string,
    hitGeometry: StyleSceneHitGeometry,
    priority = 2,
  ) => {
    elements.push(element({
      classId,
      id,
      parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.fills,
      labelKey,
      layer: "geometry",
      primitive: "surface",
      tokenBindings: [],
      authoringDefaults: readWheelAuthoringClassDefaults(
        style,
        geometry.profile,
        classId,
        { geometry, targetWheelRadius: geometry.maxRadius },
      ),
      editability: EDITABLE,
      hitGeometry,
      handles: [],
      priority,
    }, tags));
  };
  addFillRegion(
    "fills.chartField",
    "wheel.fill.chart-field",
    "styleLab.scene.chartField",
    { kind: "disc", center, radius: rings.rOuterMax ?? rings.r30 },
    -25,
  );
  addFillRegion(
    "fills.houseField",
    "wheel.fill.house-field",
    "styleLab.scene.houseField",
    {
      kind: "annulus",
      center,
      innerRadius: rings.rAsp,
      outerRadius: rings.rInner,
    },
    -5,
  );
  addFillRegion(
    "fills.centerField",
    "wheel.fill.center-field",
    "styleLab.scene.centerField",
    { kind: "disc", center, radius: rings.rAsp },
  );
  addFillRegion(
    "fills.zodiacBand",
    "wheel.fill.zodiac-band",
    "styleLab.scene.zodiacBand",
    { kind: "annulus", center, innerRadius: rings.r0, outerRadius: rings.r30 },
  );
  if (geometry.showTerms || geometry.showDecans) {
    addFillRegion(
      "fills.subdivisionBand",
      "wheel.fill.subdivision-band",
      "styleLab.scene.subdivisionBand",
      { kind: "annulus", center, innerRadius: rings.rInner, outerRadius: rings.r0 },
    );
  }

  const ring = (
    id: string,
    labelKey: string,
    radius: number | undefined,
    radiusToken?: RadiusTokenBinding | null,
    ownership?: StyleSceneEditability,
    priority?: number,
    paintRole: WheelLinePaintRole = "minorRing",
    painted = true,
    colorToken: readonly [string, string] = CHART_COLOR_TOKENS.frame,
    color = style.palette.frame,
  ) => addRingElement(elements, handles, tags, {
    id,
    labelKey,
    radius,
    center,
    maxRadius: geometry.maxRadius,
    style,
    colorToken,
    color,
    paintRole,
    painted,
    radiusToken,
    geometryOwnership: ownership,
    priority,
  });

  ring(
    WHEEL_STYLE_SCENE_ELEMENT_IDS.ringZodiacOuter,
    "styleLab.scene.zodiacOuter",
    rings.r30,
    paintedRingRadiusToken(geometry, "zodiacOuterRing", rings.r30, style),
    undefined,
    14,
    "zodiacOuterRing",
    true,
    WHEEL_COLOR_TOKENS.zodiacOuterRing,
    style.elementColors.zodiacOuterRing,
  );
  ring(
    WHEEL_STYLE_SCENE_ELEMENT_IDS.ringZodiacInner,
    "styleLab.scene.zodiacInner",
    rings.r0,
    paintedRingRadiusToken(geometry, "zodiacInnerRing", rings.r0, style),
    undefined,
    14,
    "zodiacInnerRing",
    geometry.showTerms || geometry.showDecans,
    WHEEL_COLOR_TOKENS.zodiacInnerRing,
    style.elementColors.zodiacInnerRing,
  );

  const zodiacSpokeInnerRadius = geometry.profile === "anglo"
    ? (rings.rCuspOuter ?? rings.rInner)
    : rings.rInner;
  const zodiacSpokes = Array.from({ length: 12 }, (_, index): StyleSceneHitGeometry => ({
    kind: "line",
    start: projectWheelPoint(center, zodiacSpokeInnerRadius, index * 30, ascendantDegrees),
    end: projectWheelPoint(center, rings.r30, index * 30, ascendantDegrees),
    tolerance: Math.max(4, geometry.maxRadius * 0.008),
  }));
  elements.push(element({
    classId: "zodiac.spoke",
    id: "wheel.zodiac.spokes",
    parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.zodiac,
    labelKey: "styleLab.scene.zodiacSpokes",
    layer: "geometry",
    primitive: "line",
    tokenBindings: Object.freeze([
      ...linePaintBindings(style, "zodiacSpoke"),
      colorBinding(WHEEL_COLOR_TOKENS.zodiacSpoke, style.elementColors.zodiacSpoke),
    ]),
    editability: EDITABLE,
    hitGeometry: { kind: "compound", geometries: Object.freeze(zodiacSpokes) },
    handles: [],
    priority: 125,
  }, tags));

  if (geometry.profile !== "anglo") {
    ring(
      "wheel.ring.degree.inner.10",
      "styleLab.scene.degreeTickRing",
      rings.r10,
      paintedRingRadiusToken(geometry, "innerDegreeRing", rings.r10, style),
      undefined,
      9,
      "innerDegreeRing",
      true,
      WHEEL_COLOR_TOKENS.innerDegreeRing,
      style.elementColors.innerDegreeRing,
    );
  }
  const outerDegreePainted = geometry.hasOuterRing &&
    (geometry.profile !== "anglo" || geometry.comparisonWithOuterHouses);
  if (outerDegreePainted) {
    ring(
      "wheel.ring.degree.outer.10",
      "styleLab.scene.degreeTickRing",
      rings.rOuter10,
      paintedRingRadiusToken(geometry, "outerDegreeRing", rings.rOuter10, style),
      undefined,
      9,
      "outerDegreeRing",
      true,
      WHEEL_COLOR_TOKENS.outerDegreeRing,
      style.elementColors.outerDegreeRing,
    );
  }

  if (geometry.showTerms) {
    ring(
      WHEEL_STYLE_SCENE_ELEMENT_IDS.ringTerms,
      "styleLab.scene.termBoundary",
      rings.rDecans,
      paintedRingRadiusToken(geometry, "termRing", rings.rDecans, style),
      undefined,
      13,
      "termRing",
      true,
      WHEEL_COLOR_TOKENS.termRing,
      style.elementColors.termRing,
    );
  }
  // Ruler depth is one authored length shared by the 1/5/10-degree ticks, which
  // the renderer draws at one, two and three times that value. Selecting any
  // tick group therefore edits the depth of the whole ruler, which is how the
  // geometry is authored — there is no separate per-length token to bind.
  const degreeTickLengthToken = geometry.profile === "anglo"
    ? null
    : {
        key: "classicDegreeTickLength" as keyof WheelRenderTokens,
        value: style.geometry.classic.degreeTickLength,
        valuePerPixel: 1 / Math.max(1, geometry.maxRadius),
      };
  // The rulers themselves. A ruler is a sub-band of the zodiac band, authored
  // as a share of it, and it owns the ticks that used to *be* it. Emitted
  // before its ticks so the tick elements can name it as their parent.
  const zodiacBand = rings.r30 - rings.r0;
  const rulerElementIds: Partial<Record<WheelRulerId, string>> = {};
  const addRulerClass = (
    rulerId: WheelRulerId,
    labelKey: string,
    baseRadius: number,
    terminalRadius: number,
    hosted: boolean,
    hostBand = zodiacBand,
  ) => {
    const classId = wheelRulerClassId(rulerId);
    const elementId = `wheel.${classId}`;
    rulerElementIds[rulerId] = elementId;
    const depth = Math.abs(terminalRadius - baseRadius);
    // Outward from its base for the inner ruler, inward for the outer one, so
    // a drag away from the base always deepens the ruler.
    const sign = terminalRadius >= baseRadius ? 1 : -1;
    const rulerHandles: StyleSceneHandle[] = [];
    // A ruler with no host band has no share to author. Anglo's outer ruler on
    // an outer ring is that case: it sits outside the zodiac band entirely, so
    // it is shown and selectable but carries no depth handle.
    if (hosted && hostBand > 0) {
      const handle: StyleSceneHandle = {
        id: `${elementId}.handle.depth`,
        elementId,
        kind: "radial",
        center,
        radius: terminalRadius,
        angleDegrees: BAND_SPAN_HANDLE_ANGLE,
        position: radialPoint(center, terminalRadius, BAND_SPAN_HANDLE_ANGLE),
        editability: EDITABLE,
        binding: {
          semanticId: wheelAuthoringOverrideId(
            handleScope(classId, "rulerDepth"),
            classId,
            "rulerDepth",
          ),
          cssVar: "",
          property: "rulerDepth",
          // Percent, matching the flat channel and the inspector row; the
          // compile step divides it back to a fraction.
          value: (depth / hostBand) * 100,
          // A share of the band, so a pixel of drag is worth a pixel's share of
          // it — negated for the inward ruler, whose depth grows as its
          // terminal radius falls.
          valuePerPixel: (sign / hostBand) * 100,
          min: WHEEL_RULER_DEPTH_RANGE.min * 100,
          max: WHEEL_RULER_DEPTH_RANGE.max * 100,
        },
      };
      rulerHandles.push(handle);
      handles.push(handle);
    }
    elements.push(element({
      classId,
      id: elementId,
      parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.zodiac,
      labelKey,
      layer: "geometry",
      primitive: "circle",
      tokenBindings: [],
      editability: EDITABLE,
      // The band the ticks stand in. Lower priority than the ticks themselves,
      // so a click on a tick still reports the tick and the family-owner
      // resolution decides that the ruler is the reading; a click in the gaps
      // between ticks lands on the ruler directly.
      hitGeometry: {
        kind: "annulus",
        center,
        innerRadius: Math.min(baseRadius, terminalRadius),
        outerRadius: Math.max(baseRadius, terminalRadius),
      },
      handles: Object.freeze(rulerHandles),
      priority: 8,
    }, tags));
  };

  const addDegreeTickClass = (
    classId: string,
    labelKey: string,
    startRadius: number,
    endRadius: number,
    matchesDegree: (degree: number) => boolean,
    rulerId?: WheelRulerId,
  ) => {
    const geometries: StyleSceneHitGeometry[] = [];
    for (let degree = 0; degree < 360; degree += 1) {
      if (!matchesDegree(degree)) continue;
      geometries.push({
        kind: "line",
        start: projectWheelPoint(center, startRadius, degree, ascendantDegrees),
        end: projectWheelPoint(center, endRadius, degree, ascendantDegrees),
        tolerance: Math.max(3, geometry.maxRadius * 0.006),
      });
    }
    const tickHandles: StyleSceneHandle[] = [];
    if (degreeTickLengthToken && geometries.length) {
      const handle = linearHandle(
        `wheel.${classId}`,
        "length",
        projectWheelPoint(center, endRadius, 0, ascendantDegrees),
        degreeTickLengthToken.key,
        "offset",
        degreeTickLengthToken.value,
        degreeTickLengthToken.valuePerPixel,
      );
      tickHandles.push(handle);
      handles.push(handle);
    }
    elements.push(element({
      classId,
      id: `wheel.${classId}`,
      parentId: (rulerId && rulerElementIds[rulerId])
        ?? WHEEL_STYLE_SCENE_ELEMENT_IDS.zodiac,
      labelKey,
      layer: "geometry",
      primitive: "line",
      tokenBindings: Object.freeze([
        ...linePaintBindings(style, "degreeTick"),
        colorBinding(CHART_COLOR_TOKENS.frame, style.palette.frame),
        ...(degreeTickLengthToken
          ? [metricBinding(degreeTickLengthToken.key, "offset", degreeTickLengthToken.value)]
          : []),
      ]),
      editability: EDITABLE,
      hitGeometry: { kind: "compound", geometries: Object.freeze(geometries) },
      handles: Object.freeze(tickHandles),
      priority: 9,
    }, tags));
  };

  if (geometry.profile !== "anglo") {
    addRulerClass(
      "zodiacInner",
      "styleLab.class.zodiacRulerInner",
      rings.r0,
      rings.r10,
      true,
    );
    addDegreeTickClass(
      "zodiac.tick.inner.10deg",
      "styleLab.scene.tickInner10",
      rings.r0,
      rings.r10,
      (degree) => degree % 10 === 0,
      "zodiacInner",
    );
    addDegreeTickClass(
      "zodiac.tick.inner.5deg",
      "styleLab.scene.tickInner5",
      rings.r0,
      rings.r5,
      (degree) => degree % 5 === 0,
      "zodiacInner",
    );
    addDegreeTickClass(
      "zodiac.tick.inner.1deg",
      "styleLab.scene.tickInner1",
      rings.r0,
      rings.r1,
      () => true,
      "zodiacInner",
    );
  }
  if (outerDegreePainted) {
    // On anglo this ruler stands on the outer ring, so its host is the margin
    // rather than the zodiac band. It is the only degree ruler anglo draws.
    addRulerClass(
      "zodiacOuter",
      "styleLab.class.zodiacRulerOuter",
      rings.rOuter0,
      rings.rOuter10,
      true,
      geometry.profile === "anglo" ? geometry.maxRadius - rings.r30 : undefined,
    );
    addDegreeTickClass(
      "zodiac.tick.outer.10deg",
      "styleLab.scene.tickOuter10",
      rings.rOuter0,
      rings.rOuter10,
      (degree) => degree % 10 === 0,
      "zodiacOuter",
    );
    addDegreeTickClass(
      "zodiac.tick.outer.5deg",
      "styleLab.scene.tickOuter5",
      rings.rOuter0,
      rings.rOuter5,
      geometry.profile === "anglo"
        ? (degree) => degree % 10 === 5
        : (degree) => degree % 5 === 0,
      "zodiacOuter",
    );
    addDegreeTickClass(
      "zodiac.tick.outer.1deg",
      "styleLab.scene.tickOuter1",
      rings.rOuter0,
      rings.rOuter1,
      geometry.profile === "anglo"
        ? (degree) => degree % 5 !== 0
        : () => true,
      "zodiacOuter",
    );
  }
  // Anglo cusp ruler. Every tick of one length is one selectable group, which
  // matches how the ruler is authored and is the only practical target: a
  // single 1-degree tick is well under a pixel wide.
  if (geometry.profile === "anglo" && rings.rCuspOuter != null) {
    const cuspOuter = rings.rCuspOuter;
    const canonicalRings = resolveCanonicalWheelRingSet(style, geometry);
    const inward = geometry.showTerms || geometry.showDecans;
    const direction = inward ? -1 : 1;
    const rulerTicks = style.geometry.anglo.cuspRulerTicks;
    const addCuspRulerTickClass = (
      classId: string,
      labelKey: string,
      lengthScale: number,
      matchesDegree: (degree: number) => boolean,
    ) => {
      // Resolved through the same authored share the renderer paints, so the
      // hit shape and the handle sit on the tick actually drawn.
      const rulerBand = cuspOuter - (rings.rCuspLabelOuter ?? cuspOuter);
      const canonicalRulerBand = (canonicalRings.rCuspOuter ?? cuspOuter)
        - (canonicalRings.rCuspLabelOuter ?? cuspOuter);
      const length = resolveWheelTickLength(
        style,
        "anglo",
        classId,
        rulerBand,
        canonicalRulerBand,
        rings.r30 * lengthScale,
      );
      const end = cuspOuter + direction * length;
      const geometries: StyleSceneHitGeometry[] = [];
      for (let degree = 0; degree < 360; degree += 1) {
        // The renderer suppresses the sign-boundary tick when the ruler points
        // outward, because the sign spoke already marks it.
        if (!inward && degree % 30 === 0) continue;
        if (!matchesDegree(degree)) continue;
        geometries.push({
          kind: "line",
          start: projectWheelPoint(center, cuspOuter, degree, ascendantDegrees),
          end: projectWheelPoint(center, end, degree, ascendantDegrees),
          tolerance: Math.max(3, geometry.maxRadius * 0.006),
        });
      }
      if (!geometries.length) return;
      const elementId = `wheel.${classId}`;
      const tickHandles: StyleSceneHandle[] = [];
      if (rulerBand > 0) {
        const handle: StyleSceneHandle = {
          id: `${elementId}.handle.tickLength`,
          elementId,
          kind: "radial",
          center,
          radius: end,
          angleDegrees: BAND_SPAN_HANDLE_ANGLE,
          position: radialPoint(center, end, BAND_SPAN_HANDLE_ANGLE),
          editability: EDITABLE,
          binding: {
            semanticId: wheelAuthoringOverrideId(
              handleScope(classId, "tickLength"),
              classId,
              "tickLength",
            ),
            cssVar: "",
            property: "tickLength",
            value: (length / rulerBand) * 100,
            // Percent of the ruler band, negated when the ruler points inward
            // so dragging away from the base always lengthens the tick.
            valuePerPixel: (direction / rulerBand) * 100,
            min: WHEEL_TICK_LENGTH_RANGE.min * 100,
            max: WHEEL_TICK_LENGTH_RANGE.max * 100,
          },
        };
        tickHandles.push(handle);
        handles.push(handle);
      }
      elements.push(element({
        classId,
        id: elementId,
        parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.zodiac,
        labelKey,
        layer: "geometry",
        primitive: "line",
        tokenBindings: Object.freeze([
          ...linePaintBindings(style, "subdivision"),
          colorBinding(CHART_COLOR_TOKENS.frame, style.palette.frame),
        ]),
        editability: EDITABLE,
        hitGeometry: { kind: "compound", geometries: Object.freeze(geometries) },
        handles: Object.freeze(tickHandles),
        priority: 9,
      }, tags));
    };
    addCuspRulerTickClass(
      "zodiac.tick.angloCuspRuler.10deg",
      "styleLab.scene.tickAngloCuspRuler10",
      rulerTicks.long,
      (degree) => degree % 10 === 0,
    );
    addCuspRulerTickClass(
      "zodiac.tick.angloCuspRuler.5deg",
      "styleLab.scene.tickAngloCuspRuler5",
      rulerTicks.medium,
      (degree) => degree % 10 !== 0 && degree % 5 === 0,
    );
    addCuspRulerTickClass(
      "zodiac.tick.angloCuspRuler.1deg",
      "styleLab.scene.tickAngloCuspRuler1",
      rulerTicks.short,
      (degree) => degree % 5 !== 0,
    );
  }
  // Grouped ruler marks and arrowheads. Each is one target for the whole
  // family: these are hairline ticks and sub-degree triangles, so a
  // per-instance target would be unhittable.
  const addGroupedLineClass = (
    classId: string,
    labelKey: string,
    paintRole: WheelLinePaintRole,
    geometries: readonly StyleSceneHitGeometry[],
    colorToken: readonly [string, string],
    color: string,
    parentId: string,
    priority = 10,
    extraHandles: readonly StyleSceneHandle[] = [],
    extraBindings: readonly StyleSceneTokenBinding[] = [],
  ) => {
    if (!geometries.length) return;
    elements.push(element({
      classId,
      id: `wheel.${classId}`,
      parentId,
      labelKey,
      layer: "geometry",
      primitive: "line",
      tokenBindings: Object.freeze([
        ...linePaintBindings(style, paintRole),
        colorBinding(colorToken, color),
        ...extraBindings,
      ]),
      editability: EDITABLE,
      hitGeometry: { kind: "compound", geometries: Object.freeze([...geometries]) },
      handles: Object.freeze([...extraHandles]),
      priority,
    }, tags));
  };

  const sceneRegions = input.hitRegions ?? [];
  const angleRegions = sceneRegions.flatMap((region) =>
    region.kind === "angle" ? [region] : [],
  );
  const houseRegions = sceneRegions.flatMap((region) =>
    region.kind === "house" ? [region] : [],
  );
  const sameLongitude = (left: number, right: number) => {
    const delta = Math.abs(((left - right) % 360 + 540) % 360 - 180);
    return Math.abs(180 - delta) < 1e-6;
  };
  const rulerDirection = geometry.showTerms || geometry.showDecans ? -1 : 1;

  if (geometry.profile === "anglo" && rings.rCuspOuter != null) {
    const cuspOuter = rings.rCuspOuter;
    // A cusp that coincides with an angle is already marked by its heavier
    // structural ray; the renderer skips it and so does the target.
    const angleLongitudes = angleRegions.map((region) => region.longitude);
    const tick = rings.r30 * style.geometry.anglo.houseCuspTickScale;
    addGroupedLineClass(
      "zodiac.tick.angloHouseCusp",
      "styleLab.scene.tickAngloHouseCusp",
      "subdivision",
      houseRegions
        .filter((region) =>
          !angleLongitudes.some((angle) => sameLongitude(region.longitude, angle)),
        )
        .map((region) => ({
          kind: "line" as const,
          start: projectWheelPoint(center, cuspOuter, region.longitude, ascendantDegrees),
          end: projectWheelPoint(
            center,
            cuspOuter + rulerDirection * tick,
            region.longitude,
            ascendantDegrees,
          ),
          tolerance: Math.max(4, geometry.maxRadius * 0.008),
        })),
      WHEEL_COLOR_TOKENS.angleRay,
      style.elementColors.angleRay,
      WHEEL_STYLE_SCENE_ELEMENT_IDS.zodiac,
    );
  }

  if (geometry.profile === "anglo") {
    const rulerRadius = rings.rCuspOuter ?? rings.r0;
    const tick = rings.r30 * style.geometry.anglo.angleRulerTickScale;
    addGroupedLineClass(
      "zodiac.tick.angloAngleRuler",
      "styleLab.scene.tickAngloAngleRuler",
      "angle",
      angleRegions
        .filter((region) => region.chartRole !== "outer")
        .map((region) => ({
          kind: "line" as const,
          start: projectWheelPoint(center, rulerRadius, region.longitude, ascendantDegrees),
          end: projectWheelPoint(
            center,
            rulerRadius + rulerDirection * tick,
            region.longitude,
            ascendantDegrees,
          ),
          tolerance: Math.max(4, geometry.maxRadius * 0.008),
        })),
      WHEEL_COLOR_TOKENS.angleRay,
      style.elementColors.angleRay,
      WHEEL_STYLE_SCENE_ELEMENT_IDS.angles,
    );
  }

  // Arrowheads exist on the Ascendant and Midheaven only.
  const arrowAngle = (region: { angleId: string }) =>
    region.angleId === "asc" || region.angleId === "mc";
  const arrowTriangle = (
    longitude: number,
    baseRadius: number,
    apexRadius: number,
    halfAngle: number,
  ): readonly StyleSceneHitGeometry[] => {
    const tolerance = Math.max(4, geometry.maxRadius * 0.008);
    const left = projectWheelPoint(center, baseRadius, longitude - halfAngle, ascendantDegrees);
    const right = projectWheelPoint(center, baseRadius, longitude + halfAngle, ascendantDegrees);
    const apex = projectWheelPoint(center, apexRadius, longitude, ascendantDegrees);
    return [
      { kind: "line", start: left, end: right, tolerance },
      { kind: "line", start: right, end: apex, tolerance },
      { kind: "line", start: apex, end: left, tolerance },
    ];
  };
  const arrows = style.strokes.arrows;
  const arrowLength = angleArrowLengthToken(style, geometry.profile, geometry.maxRadius);
  const arrowLengthHandles: StyleSceneHandle[] = [];
  if (arrowLength) {
    const apexAngle = angleRegions.find(
      (region) => region.chartRole !== "outer" && arrowAngle(region),
    );
    if (apexAngle) {
      const handle = linearHandle(
        "wheel.angles.inner.arrowhead",
        "length",
        projectWheelPoint(center, rings.rArrow, apexAngle.longitude, ascendantDegrees),
        arrowLength.key,
        "offset",
        arrowLength.value,
        arrowLength.valuePerPixel,
      );
      arrowLengthHandles.push(handle);
      handles.push(handle);
    }
  }
  addGroupedLineClass(
    "angles.inner.arrowhead",
    "styleLab.scene.arrowheadInner",
    "angle",
    angleRegions
      .filter((region) => region.chartRole !== "outer" && arrowAngle(region))
      .flatMap((region) =>
        geometry.profile === "anglo"
          // The Anglo arrowhead is a filled triangle seated on the inner
          // boundary rather than a stroked chevron on the sign ring.
          ? arrowTriangle(
              region.longitude,
              rings.rInner - rings.r30 * arrows.angloBaseInsetScale,
              rings.rInner,
              arrows.angloHalfAngleDegrees,
            )
          : arrowTriangle(
              region.longitude,
              rings.rASCMC,
              rings.rArrow,
              arrows.halfAngleDegrees,
            ),
      ),
    WHEEL_COLOR_TOKENS.angleRay,
    style.elementColors.angleRay,
    WHEEL_STYLE_SCENE_ELEMENT_IDS.angles,
    11,
    arrowLengthHandles,
    arrowLength
      ? [metricBinding(arrowLength.key, "offset", arrowLength.value)]
      : [],
  );
  if (geometry.mode === "comparison" && rings.rOuterASCMC != null && rings.rOuterArrow != null) {
    const outerBase = rings.rOuterASCMC;
    const outerApex = rings.rOuterArrow;
    addGroupedLineClass(
      "angles.outer.arrowhead",
      "styleLab.scene.arrowheadOuter",
      "angle",
      angleRegions
        .filter((region) => region.chartRole === "outer" && arrowAngle(region))
        .flatMap((region) =>
          arrowTriangle(region.longitude, outerBase, outerApex, arrows.halfAngleDegrees),
        ),
      WHEEL_COLOR_TOKENS.angleRay,
      style.elementColors.angleRay,
      WHEEL_STYLE_SCENE_ELEMENT_IDS.angles,
      11,
    );
  }

  if (geometry.profile === "anglo" && rings.rCuspOuter != null) {
    ring(
      WHEEL_STYLE_SCENE_ELEMENT_IDS.ringCuspOuter,
      "styleLab.scene.cuspOuterRing",
      rings.rCuspOuter,
      paintedRingRadiusToken(geometry, "cuspOuterRing", rings.rCuspOuter, style),
      undefined,
      16,
      "cuspOuterRing",
      true,
      WHEEL_COLOR_TOKENS.cuspOuterRing,
      style.elementColors.cuspOuterRing,
    );
  }
  ring(
    WHEEL_STYLE_SCENE_ELEMENT_IDS.ringInner,
    "styleLab.scene.innerBoundary",
    rings.rInner,
    paintedRingRadiusToken(geometry, "innerBoundaryRing", rings.rInner, style),
    undefined,
    15,
    "innerBoundaryRing",
    true,
    WHEEL_COLOR_TOKENS.innerBoundaryRing,
    style.elementColors.innerBoundaryRing,
  );
  ring(WHEEL_STYLE_SCENE_ELEMENT_IDS.ringBody, "styleLab.scene.bodyLane", rings.rPlanet, bodyRadiusToken(style, geometry, rings), undefined, 12, "minorRing", false);
  ring(WHEEL_STYLE_SCENE_ELEMENT_IDS.ringPosition, "styleLab.scene.positionLane", rings.rPos, positionRadiusToken(style, geometry, rings), undefined, 12, "minorRing", false);
  ring(
    WHEEL_STYLE_SCENE_ELEMENT_IDS.ringAspect,
    "styleLab.scene.aspectBoundary",
    rings.rAsp,
    geometry.profile === "classic"
      ? paintedRingRadiusToken(geometry, "aspectBoundaryRing", rings.rAsp, style)
      : aspectRadiusToken(style, geometry, rings),
    undefined,
    12,
    geometry.profile === "classic" ? "aspectBoundaryRing" : "minorRing",
    geometry.profile === "classic",
    WHEEL_COLOR_TOKENS.aspectBoundaryRing,
    style.elementColors.aspectBoundaryRing,
  );
  ring(
    WHEEL_STYLE_SCENE_ELEMENT_IDS.ringBase,
    "styleLab.scene.baseRing",
    rings.rBase,
    paintedRingRadiusToken(geometry, "baseRing", rings.rBase, style),
    undefined,
    12,
    "baseRing",
    true,
    geometry.profile === "anglo"
      ? WHEEL_COLOR_TOKENS.angloBaseRing
      : WHEEL_COLOR_TOKENS.baseRing,
    geometry.profile === "anglo"
      ? style.elementColors.angloBaseRing
      : style.elementColors.baseRing,
  );
  ring(
    WHEEL_STYLE_SCENE_ELEMENT_IDS.ringHouse,
    "styleLab.scene.houseRing",
    rings.rHouse,
    paintedRingRadiusToken(geometry, "houseBoundaryRing", rings.rHouse, style),
    undefined,
    12,
    "houseBoundaryRing",
    geometry.showHouses,
    geometry.profile === "anglo"
      ? WHEEL_COLOR_TOKENS.angloHouseBoundaryRing
      : WHEEL_COLOR_TOKENS.houseBoundaryRing,
    geometry.profile === "anglo"
      ? style.elementColors.angloHouseBoundaryRing
      : style.elementColors.houseBoundaryRing,
  );
  ring(WHEEL_STYLE_SCENE_ELEMENT_IDS.ringHouseLabel, "styleLab.scene.houseLabelLane", rings.rHouseName, houseLabelRadiusToken(style, geometry), geometry.profile === "anglo" ? DERIVED_GEOMETRY : undefined, 11, "minorRing", false);

  if (geometry.mode === "comparison") {
    ring(
      WHEEL_STYLE_SCENE_ELEMENT_IDS.ringOuterMaximum,
      "styleLab.scene.outerMaximum",
      rings.rOuterMax,
      rings.rOuterMax == null
        ? null
        : paintedRingRadiusToken(geometry, "outerMaximumRing", rings.rOuterMax, style),
      undefined,
      13,
      "outerMaximumRing",
      geometry.comparisonWithOuterHouses,
      WHEEL_COLOR_TOKENS.outerMaximumRing,
      style.elementColors.outerMaximumRing,
    );
    ring(
      WHEEL_STYLE_SCENE_ELEMENT_IDS.ringOuterHouse,
      "styleLab.scene.outerHouseRing",
      rings.rOuterHouse,
      rings.rOuterHouse == null
        ? null
        : paintedRingRadiusToken(geometry, "outerHouseRing", rings.rOuterHouse, style),
      undefined,
      12,
      "outerHouseRing",
      geometry.comparisonWithOuterHouses,
      WHEEL_COLOR_TOKENS.outerHouseRing,
      style.elementColors.outerHouseRing,
    );
    const nonAnglo = geometry.profile !== "anglo";
    ring(WHEEL_STYLE_SCENE_ELEMENT_IDS.ringOuterBody, "styleLab.scene.outerBodyLane", rings.rOuterPlanet, nonAnglo ? {
      key: "biwheelOuterPlanetSector", value: style.geometry.biwheel.outerPlanetSector, valuePerPixel: 2 / geometry.maxRadius,
    } : null, nonAnglo ? undefined : CODE_OWNED_GEOMETRY, 12, "minorRing", false);
    ring(WHEEL_STYLE_SCENE_ELEMENT_IDS.ringOuterLine, "styleLab.scene.outerLine", rings.rOuterLine, nonAnglo ? {
      key: "biwheelOuterLineOffset", value: style.geometry.biwheel.outerLineOffset, valuePerPixel: 1 / geometry.maxRadius,
    } : null, nonAnglo ? undefined : CODE_OWNED_GEOMETRY, 11, "minorRing", false);
    ring(WHEEL_STYLE_SCENE_ELEMENT_IDS.ringProjectedLabel, "styleLab.scene.projectedLabelLane", rings.rAntis, nonAnglo ? {
      key: "biwheelProjectedLabel", value: style.geometry.biwheel.projectedLabel, valuePerPixel: 1 / geometry.maxRadius,
    } : null, nonAnglo ? undefined : CODE_OWNED_GEOMETRY, 10, "minorRing", false);
  } else {
    ring(WHEEL_STYLE_SCENE_ELEMENT_IDS.ringOuterLine, "styleLab.scene.outerLine", rings.rOuterLine, geometry.profile === "anglo" ? null : {
      key: "classicOuterLine", value: style.geometry.classic.outer.line, valuePerPixel: 1 / geometry.maxRadius,
    }, geometry.profile === "anglo" ? CODE_OWNED_GEOMETRY : undefined, 11, "minorRing", false);
    ring(WHEEL_STYLE_SCENE_ELEMENT_IDS.ringProjectedLabel, "styleLab.scene.projectedLabelLane", rings.rAntis, geometry.profile === "anglo" ? null : {
      key: "classicOuterProjectedLabel", value: style.geometry.classic.outer.projectedLabel, valuePerPixel: 1 / geometry.maxRadius,
    }, geometry.profile === "anglo" ? CODE_OWNED_GEOMETRY : undefined, 10, "minorRing", false);
  }

  // Manifest-backed fallbacks keep direct controls available before exact
  // fixture hit regions arrive. Exact production occurrences below outrank
  // these hidden placeholders in the class switcher.
  //
  // Each one declares the primitive its manifest class declares. They used to
  // say "group", and the inspector reads the primitive to decide which section
  // a property belongs to — so the same class showed its colour under Stroke
  // or Typography with a live occurrence on screen and under Appearance
  // without one, and the rows changed order with it.
  elements.push(
    element({
      classId: "houses.inner.cusp",
      id: "wheel.house.cusps", parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.houses,
      labelKey: "styleLab.scene.houseCusps", layer: "geometry", primitive: "line",
      tokenBindings: [...linePaintBindings(style, "houseCusp"), colorBinding(CHART_COLOR_TOKENS.houses, style.palette.houses)],
      editability: EDITABLE, hitGeometry: null, handles: [], priority: 2,
      stateTags: Object.freeze([...tags, "manifest-placeholder", "manifest-editable"]),
    }, tags),
    element({
      classId: "bodies.inner.glyph",
      id: "wheel.body.glyphs", parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.bodies,
      labelKey: "styleLab.scene.bodyGlyphs", layer: "dynamic", primitive: "text",
      tokenBindings: [
        colorBinding(CHART_COLOR_TOKENS.positions, style.palette.positions),
        fontBinding(APP_FONT_TOKENS.bodySymbols, style.typography.families.bodySymbols),
        metricBinding("bodyScale", "font-size", style.typography.ratios.body),
      ],
      editability: EDITABLE, hitGeometry: null, handles: [], priority: 2,
      stateTags: Object.freeze([...tags, "manifest-placeholder", "manifest-editable"]),
    }, tags),
    element({
      classId: geometry.mode === "comparison" ? "aspects.interchart.line" : "aspects.primary.line",
      id: "wheel.aspect.lines", parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.aspects,
      labelKey: "styleLab.scene.aspectLines", layer: "dynamic", primitive: "line",
      tokenBindings: [...linePaintBindings(style, "aspect"), metricBinding(geometry.profile === "anglo" ? "aspectAngloWidth" : "aspectClassicWidth", "stroke-width", geometry.profile === "anglo" ? style.strokes.aspects.angloWidth : style.strokes.aspects.classicWidth)],
      editability: EDITABLE, hitGeometry: null, handles: [], priority: 1,
      stateTags: Object.freeze([...tags, "manifest-placeholder", "manifest-editable"]),
    }, tags),
  );

  const hitRegions = input.hitRegions ?? [];
  const interchartEndpointMarkers = new Set<string>();
  const exactSecondaryOwners = new Set(
    hitRegions.flatMap((region) => {
      const target = asStyleTargetHitRegion(region);
      return target?.ownerId?.startsWith("secondary:")
        ? [target.ownerId]
        : [];
    }),
  );
  const hasExactInnerCusps = hitRegions.some(
    (region) =>
      asStyleTargetHitRegion(region)?.classId === "houses.inner.cusp",
  );
  const hasExactAngleRays = hitRegions.some((region) => {
    const classId = asStyleTargetHitRegion(region)?.classId;
    return classId === "angles.inner.ray" || classId === "angles.outer.ray";
  });
  for (const region of hitRegions) {
    const styleTarget = asStyleTargetHitRegion(region);
    if (styleTarget) {
      appendStyleTargetElement(
        elements,
        tags,
        style,
        geometry.profile,
        hitRegions,
        input.useIndividualBodyColors,
        input.useZodiacElementColors,
        input.signColors,
        styleTarget,
      );
    } else if (region.kind === "planet" || region.kind === "fortune" || region.kind === "vertex" || region.kind === "syzygy" || region.kind === "eclipse") {
      appendBodyElement(
        elements,
        handles,
        tags,
        style,
        geometry.profile,
        geometry.maxRadius,
        input.useIndividualBodyColors,
        region,
        rings,
      );
    } else if (region.kind === "house") {
      appendHouseElements(
        elements,
        handles,
        tags,
        style,
        geometry.profile,
        center,
        ascendantDegrees,
        rings,
        geometry.maxRadius,
        region,
        !hasExactInnerCusps,
      );
    } else if (region.kind === "sign") {
      appendSignElement(
        elements,
        handles,
        tags,
        style,
        geometry.profile,
        geometry.maxRadius,
        input.useZodiacElementColors,
        input.signColors?.[region.signIndex],
        region,
      );
    } else if (region.kind === "subdivision") {
      appendSubdivisionElement(
        elements,
        handles,
        tags,
        style,
        geometry.profile,
        geometry.maxRadius,
        region,
      );
    } else if (region.kind === "angle") {
      appendAngleElement(
        elements,
        handles,
        tags,
        style,
        geometry.profile,
        center,
        rings,
        geometry.maxRadius,
        ascendantDegrees,
        region,
        !hasExactAngleRays,
      );
    } else if (region.kind === "aspect") {
      appendAspectElement(elements, handles, tags, style, geometry.profile, region);
      appendInterchartEndpointMarker(
        elements,
        handles,
        tags,
        style,
        geometry.profile,
        center,
        rings,
        geometry.maxRadius,
        region,
        interchartEndpointMarkers,
      );
    } else if (
      region.kind === "secondary_ring"
      && !exactSecondaryOwners.has(
        `secondary:${region.family}:${region.itemId}`,
      )
    ) {
      appendSecondaryElement(elements, handles, tags, style, geometry.profile, geometry.maxRadius, region);
    }
  }

  appendManifestPlaceholders(
    elements,
    style,
    geometry,
    tags,
    hitRegions,
  );

  const referencePxPerRendered =
    style.authoringOverrides.referenceRadius / Math.max(1, geometry.maxRadius);
  // Resolved once here rather than only for the handles below, because the
  // band ceiling has to reach the inspector row as well. A glyph that caps
  // when dragged but not when typed is one property with two different limits.
  const bandsForCeilings = resolveWheelBandLayout(style, geometry, rings).bands;

  const elementsWithAuthoringDefaults = elements.map((sceneElement) => {
    const defaults = sceneElement.authoringDefaults
      ?? readWheelAuthoringClassDefaults(
        style,
        geometry.profile,
        sceneElement.classId,
        { geometry, targetWheelRadius: geometry.maxRadius },
      );
    const definition = isWheelSemanticClassId(sceneElement.classId)
      ? WHEEL_SEMANTIC_CLASS_BY_ID.get(sceneElement.classId)
      : undefined;
    const applicable = definition
      ? applicableAuthoringDefaults(definition, geometry.profile, defaults)
      : defaults;
    // The largest this run may be made, whether it is dragged on the wheel or
    // typed in the inspector. Reported in reference space beside the size it
    // limits, so the row can both clamp and say that it is clamping.
    const ceiling = applicable.fontSizePx == null
      ? null
      : resolveWheelClassFontSizeCeiling(
        sceneElement.classId,
        bandsForCeilings,
        applicable.fontSizePx / referencePxPerRendered,
      );
    return Object.freeze({
      ...sceneElement,
      authoringDefaults: ceiling == null
        ? applicable
        : Object.freeze({
          ...applicable,
          fontSizeCeilingPx: ceiling * referencePxPerRendered,
        }),
    });
  });
  const elementsById = new Map(
    elementsWithAuthoringDefaults.map((sceneElement) => [sceneElement.id, sceneElement]),
  );
  const referencePxPerRenderedPx = referencePxPerRendered;
  const resolvedBands = bandsForCeilings;
  const authoringHandles = handles.map((handle) => {
    const sceneElement = elementsById.get(handle.elementId);
    const property = handle.binding
      ? directAuthoringHandleProperty(handle.binding.property)
      : null;
    const value = property && sceneElement
      ? directAuthoringHandleValue(sceneElement.authoringDefaults, property)
      : undefined;
    if (!handle.binding || !sceneElement || !property || value == null) return handle;
    const valuePerPixel = property === "strokeWidth"
      ? referencePxPerRenderedPx * AUTHORING_NUMERIC_PROPERTIES.strokeWidth.fineStep
      : referencePxPerRenderedPx;
    // A radius handle carries its neighbour-aware wall in normalized token
    // units; this channel authors in reference-space px, so the wall has to be
    // converted with the value or the clamp silently collapses the drag.
    const referenceRadius = style.authoringOverrides.referenceRadius;
    const toReference = (bound: number | undefined) =>
      property === "radius" && bound != null ? bound * referenceRadius : undefined;
    const min = toReference(handle.binding.min);
    let max = toReference(handle.binding.max);
    if (property === "fontSize") {
      const ceiling = resolveWheelClassFontSizeCeiling(
        sceneElement.classId,
        resolvedBands,
        // Rendered px: the wall must never force a shrink of what is painted.
        value / referencePxPerRenderedPx,
      );
      if (ceiling != null) {
        const referenceCeiling = ceiling * referencePxPerRenderedPx;
        max = max == null ? referenceCeiling : Math.min(max, referenceCeiling);
      }
    }
    return Object.freeze({
      ...handle,
      binding: Object.freeze({
        ...handle.binding,
        semanticId: wheelAuthoringOverrideId(
          handleScope(sceneElement.classId, property),
          sceneElement.classId,
          property,
        ),
        cssVar: "",
        value,
        valuePerPixel,
        ...(min != null ? { min } : { min: undefined }),
        ...(max != null ? { max } : { max: undefined }),
      }),
    });
  });
  const authoringHandleById = new Map(
    authoringHandles.map((handle) => [handle.id, handle]),
  );
  const authoringElements = elementsWithAuthoringDefaults.map((sceneElement) =>
    Object.freeze({
      ...sceneElement,
      handles: Object.freeze(
        sceneElement.handles.map(
          (handle) => authoringHandleById.get(handle.id) ?? handle,
        ),
      ),
    }),
  );

  return Object.freeze({
    schemaVersion: WHEEL_STYLE_SCENE_SCHEMA_VERSION,
    profile: geometry.profile,
    mode: geometry.mode,
    center,
    viewport: Object.freeze(viewport),
    rings,
    elements: Object.freeze(authoringElements),
    handles: Object.freeze(authoringHandles),
  });
}

export function hitTestWheelStyleScene(
  scene: WheelStyleScene,
  x: number,
  y: number,
  options: Readonly<{ includeReadOnly?: boolean }> = { includeReadOnly: true },
): StyleSceneHit | null {
  return hitTestStyleSceneElements(scene.elements, x, y, options);
}

export function resolveWheelStyleHandleDrag(
  handle: StyleSceneHandle,
  drag: StyleSceneHandleDrag,
  resolveMetadata?: (semanticId: string) => StyleSceneTokenDragMetadata | null | undefined,
): StyleSceneTokenPatch | null {
  return resolveStyleSceneHandleDrag(
    handle,
    drag,
    (semanticId) => resolveMetadata?.(semanticId) ?? authoringHandleMetadata(semanticId),
  );
}

export type {
  StyleSceneElement,
  StyleSceneHandle,
  StyleSceneHit,
  StyleSceneHitGeometry,
  StyleSceneTokenPatch,
} from "./style-scene";
