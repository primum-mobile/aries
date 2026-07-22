// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChartHitRegion } from "../chart/draw-chart";
import {
  WHEEL_RENDER_TOKEN_SPECS,
  projectWheelAuthoringStyle,
  resolveWheelRingSet,
  resolveWheelTypographyMetrics,
  wheelRingRadiusTokenKey,
  type WheelGeometryInput,
  type WheelLinePaintRole,
  type WheelLinePaintTokenKey,
  type WheelLinePaintTokenSuffix,
  type WheelPaintedRingRole,
  type WheelRenderStyle,
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
  resolveWheelSemanticCapabilities,
  resolveWheelSemanticApplicability,
  type WheelPreviewFeatureId,
  type WheelSemanticClassDefinition,
} from "./semantic-class-manifest";
import {
  WHEEL_AUTHORING_OVERRIDE_PREFIX,
  readWheelAuthoringClassDefaults,
  wheelAuthoringOverrideId,
  type WheelAuthoringEditScope,
  type WheelAuthoringFlatProperty,
} from "./wheel-authoring-adapter";

export const WHEEL_STYLE_SCENE_SCHEMA_VERSION = 1 as const;

export const WHEEL_STYLE_SCENE_ELEMENT_IDS = {
  root: "wheel",
  canvas: "wheel.canvas",
  layerGeometry: "wheel.layers.geometry",
  layerDynamic: "wheel.layers.dynamic",
  layerOuterLabel: "wheel.layers.outer-label",
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
  textBright: ["chart.color.textBright", "--morinus-text-bright"],
} as const;

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
    if (region.kind !== "secondary_ring") continue;

    const family = region.family.trim().toLowerCase().replaceAll("-", "_");
    if (family.includes("fixed")) features.add("outerRing.fixedStar");
    else if (family.includes("asteroid")) features.add("outerRing.asteroid");
    else if (family.includes("midpoint")) features.add("outerRing.midpoint");
    else if (family.includes("hybrid")) features.add("outerRing.hybridHit");
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
    ...(capabilities.has("fontSize") && defaults.fontSizePx != null
      ? { fontSizePx: defaults.fontSizePx }
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
  };
  return lanes[elementId] ?? elementId.replace(/^wheel\./, "");
}

function paintedRingRadiusToken(
  input: WheelGeometryInput,
  role: WheelPaintedRingRole,
  radius: number,
): RadiusTokenBinding {
  return {
    key: wheelRingRadiusTokenKey(input.profile, role),
    // Auto tokens are stored as zero, but the direct editor control must show
    // and begin dragging from the exact radius currently painted.
    value: radius / Math.max(1, input.maxRadius),
    valuePerPixel: 1 / Math.max(1, input.maxRadius),
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
      ? directMetricBinding(
          radiusToken.key,
          "radius",
          radiusToken.value,
          radiusToken.valuePerPixel,
        )
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
  region: Extract<ChartHitRegion, { kind: "planet" | "fortune" | "vertex" | "syzygy" }>,
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
  const bodyClassId = region.kind === "fortune"
    ? "bodies.fortune"
    : region.kind === "vertex"
      ? "bodies.vertex"
      : region.kind === "syzygy"
        ? "bodies.prenatalSyzygy"
        : role === "outer"
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
    handles.push(leaderHandle);
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
      ]),
      editability: EDITABLE,
      hitGeometry: geometries.length === 1
        ? geometries[0]
        : { kind: "compound", geometries: Object.freeze(geometries) },
      handles: Object.freeze([leaderHandle]),
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
): void {
  const layoutUnit = resolveWheelTypographyMetrics(style, profile, maxRadius).layoutUnit;
  const suffix = safeIdPart(region.houseIndex);
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
  const elementColorTokens = [
    ["chart.color.element.fire", "--morinus-element-fire"],
    ["chart.color.element.earth", "--morinus-element-earth"],
    ["chart.color.element.air", "--morinus-element-air"],
    ["chart.color.element.water", "--morinus-element-water"],
  ] as const;
  const signColorToken = useZodiacElementColors
    ? elementColorTokens[region.signIndex % elementColorTokens.length]
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
        layer: role === "outer" ? "outer-label" : "geometry",
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

function secondaryClassId(
  family: string,
  projectedGlyph: boolean,
  segments?: readonly { kind: "text" | "planet" | "glyph" }[],
): string {
  const normalized = family.trim().toLowerCase().replaceAll("-", "_");
  const base = normalized.includes("fixed")
    ? "fixedStar"
    : normalized.includes("asteroid")
      ? "asteroid"
      : normalized.includes("midpoint")
        ? "midpoint"
        : normalized.includes("hybrid")
          ? "hybridHit"
          : normalized.includes("contra") && normalized.includes("antis")
            ? "contraAntiscia"
            : normalized.includes("antis")
              ? "antiscia"
              : normalized.includes("dodec")
                ? "dodecatemoria"
                : normalized.includes("arab") || normalized === "lot"
                  ? "arabicPart"
                  : normalized.includes("parallel")
                    ? "parallelTransit"
                    : normalized.replaceAll("_", "-") || "other";
  if (base === "hybridHit" || base === "fixedStar" || base === "asteroid" || base === "arabicPart") {
    return `secondaryRing.${base}.label`;
  }
  const hasText = segments?.some((segment) => segment.kind === "text") ?? false;
  const hasGlyph = segments?.some((segment) => segment.kind !== "text") ?? false;
  const component = hasText && !hasGlyph ? "text" : projectedGlyph ? "glyph" : "label";
  return `secondaryRing.${base}.${component}`;
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
  elements.push(
    element(
      {
        classId: secondaryClassId(region.family, projectedGlyph, region.segments),
        id,
        parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.secondary,
        labelKey: "styleLab.scene.secondaryLabel",
        layer: "outer-label",
        primitive: "text",
        tokenBindings: Object.freeze([
          colorBinding(CHART_COLOR_TOKENS.positions, style.palette.positions),
          colorBinding(CHART_COLOR_TOKENS.signs, style.palette.signs),
          colorBinding(CHART_COLOR_TOKENS.textBright, style.palette.textBright),
          fontBinding(APP_FONT_TOKENS.ui, style.typography.families.ui),
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
      classId: `${secondaryClassId(region.family, projectedGlyph, region.segments).replace(/\.(glyph|label|text)$/, "")}.leader`,
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

  elements.push(
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.root, undefined, "styleLab.scene.wheel", "geometry", tags),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.layerGeometry, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.geometryLayer", "geometry", tags, "layers.geometry"),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.layerDynamic, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.dynamicLayer", "dynamic", tags, "layers.dynamic"),
    groupElement(WHEEL_STYLE_SCENE_ELEMENT_IDS.layerOuterLabel, WHEEL_STYLE_SCENE_ELEMENT_IDS.root, "styleLab.scene.outerLabelLayer", "outer-label", tags, "layers.outerLabel"),
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
        tokenBindings: [colorBinding(CHART_COLOR_TOKENS.background, style.palette.background)],
        editability: EDITABLE,
        hitGeometry: { kind: "rectangle", x: 0, y: 0, width: viewport.width, height: viewport.height },
        handles: [],
        priority: -50,
      },
      tags,
    ),
  );

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
    paintedRingRadiusToken(geometry, "zodiacOuterRing", rings.r30),
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
    paintedRingRadiusToken(geometry, "zodiacInnerRing", rings.r0),
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
      paintedRingRadiusToken(geometry, "innerDegreeRing", rings.r10),
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
      paintedRingRadiusToken(geometry, "outerDegreeRing", rings.rOuter10),
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
      paintedRingRadiusToken(geometry, "termRing", rings.rDecans),
      undefined,
      13,
      "termRing",
      true,
      WHEEL_COLOR_TOKENS.termRing,
      style.elementColors.termRing,
    );
  }
  const addDegreeTickClass = (
    classId: string,
    labelKey: string,
    startRadius: number,
    endRadius: number,
    matchesDegree: (degree: number) => boolean,
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
    elements.push(element({
      classId,
      id: `wheel.${classId}`,
      parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.zodiac,
      labelKey,
      layer: "geometry",
      primitive: "line",
      tokenBindings: Object.freeze([
        ...linePaintBindings(style, "degreeTick"),
        colorBinding(CHART_COLOR_TOKENS.frame, style.palette.frame),
      ]),
      editability: EDITABLE,
      hitGeometry: { kind: "compound", geometries: Object.freeze(geometries) },
      handles: [],
      priority: 9,
    }, tags));
  };

  if (geometry.profile !== "anglo") {
    addDegreeTickClass(
      "zodiac.tick.inner.10deg",
      "styleLab.scene.tickInner10",
      rings.r0,
      rings.r10,
      (degree) => degree % 10 === 0,
    );
    addDegreeTickClass(
      "zodiac.tick.inner.5deg",
      "styleLab.scene.tickInner5",
      rings.r0,
      rings.r5,
      (degree) => degree % 10 === 5,
    );
    addDegreeTickClass(
      "zodiac.tick.inner.1deg",
      "styleLab.scene.tickInner1",
      rings.r0,
      rings.r1,
      (degree) => degree % 5 !== 0,
    );
  }
  if (outerDegreePainted) {
    addDegreeTickClass(
      "zodiac.tick.outer.10deg",
      "styleLab.scene.tickOuter10",
      rings.rOuter0,
      rings.rOuter10,
      (degree) => degree % 10 === 0,
    );
    addDegreeTickClass(
      "zodiac.tick.outer.5deg",
      "styleLab.scene.tickOuter5",
      rings.rOuter0,
      rings.rOuter5,
      (degree) => degree % 10 === 5,
    );
    addDegreeTickClass(
      "zodiac.tick.outer.1deg",
      "styleLab.scene.tickOuter1",
      rings.rOuter0,
      rings.rOuter1,
      (degree) => degree % 5 !== 0,
    );
  }
  if (geometry.profile === "anglo" && rings.rCuspOuter != null) {
    ring(
      WHEEL_STYLE_SCENE_ELEMENT_IDS.ringCuspOuter,
      "styleLab.scene.cuspOuterRing",
      rings.rCuspOuter,
      paintedRingRadiusToken(geometry, "cuspOuterRing", rings.rCuspOuter),
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
    paintedRingRadiusToken(geometry, "innerBoundaryRing", rings.rInner),
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
      ? paintedRingRadiusToken(geometry, "aspectBoundaryRing", rings.rAsp)
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
    paintedRingRadiusToken(geometry, "baseRing", rings.rBase),
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
    paintedRingRadiusToken(geometry, "houseBoundaryRing", rings.rHouse),
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
        : paintedRingRadiusToken(geometry, "outerMaximumRing", rings.rOuterMax),
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
        : paintedRingRadiusToken(geometry, "outerHouseRing", rings.rOuterHouse),
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
  elements.push(
    element({
      classId: "houses.inner.cusp",
      id: "wheel.house.cusps", parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.houses,
      labelKey: "styleLab.scene.houseCusps", layer: "geometry", primitive: "group",
      tokenBindings: [...linePaintBindings(style, "houseCusp"), colorBinding(CHART_COLOR_TOKENS.houses, style.palette.houses)],
      editability: EDITABLE, hitGeometry: null, handles: [], priority: 2,
      stateTags: Object.freeze([...tags, "manifest-placeholder", "manifest-editable"]),
    }, tags),
    element({
      classId: "bodies.inner.glyph",
      id: "wheel.body.glyphs", parentId: WHEEL_STYLE_SCENE_ELEMENT_IDS.bodies,
      labelKey: "styleLab.scene.bodyGlyphs", layer: "dynamic", primitive: "group",
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
      labelKey: "styleLab.scene.aspectLines", layer: "dynamic", primitive: "group",
      tokenBindings: [...linePaintBindings(style, "aspect"), metricBinding(geometry.profile === "anglo" ? "aspectAngloWidth" : "aspectClassicWidth", "stroke-width", geometry.profile === "anglo" ? style.strokes.aspects.angloWidth : style.strokes.aspects.classicWidth)],
      editability: EDITABLE, hitGeometry: null, handles: [], priority: 1,
      stateTags: Object.freeze([...tags, "manifest-placeholder", "manifest-editable"]),
    }, tags),
  );

  for (const region of input.hitRegions ?? []) {
    if (region.kind === "planet" || region.kind === "fortune" || region.kind === "vertex" || region.kind === "syzygy") {
      appendBodyElement(
        elements,
        handles,
        tags,
        style,
        geometry.profile,
        geometry.maxRadius,
        input.useIndividualBodyColors,
        region,
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
      );
    } else if (region.kind === "aspect") {
      appendAspectElement(elements, handles, tags, style, geometry.profile, region);
    } else if (region.kind === "secondary_ring") {
      appendSecondaryElement(elements, handles, tags, style, geometry.profile, geometry.maxRadius, region);
    }
  }

  appendManifestPlaceholders(
    elements,
    style,
    geometry,
    tags,
    input.hitRegions ?? [],
  );

  const elementsWithAuthoringDefaults = elements.map((sceneElement) => Object.freeze({
    ...sceneElement,
    authoringDefaults: sceneElement.authoringDefaults
      ?? readWheelAuthoringClassDefaults(
        style,
        geometry.profile,
        sceneElement.classId,
        { geometry, targetWheelRadius: geometry.maxRadius },
      ),
  }));
  const elementsById = new Map(
    elementsWithAuthoringDefaults.map((sceneElement) => [sceneElement.id, sceneElement]),
  );
  const referencePxPerRenderedPx =
    style.authoringOverrides.referenceRadius / Math.max(1, geometry.maxRadius);
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
    return Object.freeze({
      ...handle,
      binding: Object.freeze({
        ...handle.binding,
        semanticId: wheelAuthoringOverrideId(
          input.authoringScope ?? geometry.profile,
          sceneElement.classId,
          property,
        ),
        cssVar: "",
        value,
        valuePerPixel,
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
