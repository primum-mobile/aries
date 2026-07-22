// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Exhaustive authoring classes for the production wheel.
 *
 * This manifest describes semantic paint classes, not renderer tokens and not
 * individual hit-test occurrences. Optional/disabled classes remain in this
 * registry so the Style Lab class switcher can always explain how to reveal
 * them in the isolated preview.
 */

export const WHEEL_SEMANTIC_CLASS_MANIFEST_VERSION = "wheel-v2" as const;

export type WheelSemanticVariant = "classic" | "compact" | "anglo";
export type WheelSemanticLayout = "single" | "comparison";
export type WheelSemanticLayer =
  | "geometry"
  | "dynamic"
  | "outer-label"
  | "overlay";
export type WheelSemanticPrimitive =
  | "surface"
  | "group"
  | "circle"
  | "line"
  | "text";
export type WheelSemanticGroupId =
  | "canvas"
  | "layers"
  | "rings"
  | "zodiac"
  | "subdivisions"
  | "houses"
  | "angles"
  | "bodies"
  | "aspects"
  | "secondaryRing"
  | "surveil"
  | "chartOverlay";

/** Profile-v2 property names that an inspector may truthfully expose. */
export type WheelStyleCapability =
  | "radius"
  | "strokeWidth"
  | "strokeStyle"
  | "dashLength"
  | "dashGap"
  | "lineCap"
  | "lineJoin"
  | "fontRef"
  | "fontSize"
  | "tracking"
  | "color"
  | "opacity"
  | "blur"
  | "shadowColor"
  | "shadowX"
  | "shadowY"
  | "shadowBlur"
  | "hueRotate"
  | "brightness"
  | "contrast"
  | "saturation"
  | "grayscale"
  | "invert"
  | "sepia";

export type WheelPreviewFeatureId =
  | "houses"
  | "comparison.outerHouses"
  | "positions"
  | "terms"
  | "decans"
  | "aspects"
  | "aspectGlyphs"
  | "angleArrowheads"
  | "angleLabels"
  | "motionMarkers"
  | "body.fortune"
  | "body.vertex"
  | "body.prenatalSyzygy"
  | "outerRing.fixedStar"
  | "outerRing.asteroid"
  | "outerRing.midpoint"
  | "outerRing.hybridHit"
  | "outerRing.antiscia"
  | "outerRing.contraAntiscia"
  | "outerRing.dodecatemoria"
  | "outerRing.arabicPart"
  | "outerRing.parallelTransit"
  | "surveil"
  | "overlay.information.topLeft"
  | "overlay.information.bottomLeft"
  | "overlay.houseSystem.bottomRight"
  | "overlay.events.dayHour"
  | "overlay.events.header"
  | "overlay.events.signal";

export type WheelPreviewStateId =
  | "classic.single.default"
  | "compact.single.default"
  | "anglo.single.default"
  | "classic.comparison.default"
  | "classic.comparison.outerHouses"
  | "compact.comparison.default"
  | "anglo.comparison.outerHouses"
  | "classic.single.terms"
  | "classic.single.decans"
  | "classic.single.aspects"
  | "classic.comparison.aspects"
  | "classic.single.specialPoints"
  | "classic.single.outer.fixedStar"
  | "classic.single.outer.asteroid"
  | "classic.single.outer.midpoint"
  | "classic.single.outer.hybridHit"
  | "classic.single.outer.antiscia"
  | "classic.single.outer.contraAntiscia"
  | "classic.single.outer.dodecatemoria"
  | "classic.single.outer.arabicPart"
  | "classic.single.outer.parallelTransit"
  | "classic.single.surveil"
  | "classic.single.overlays";

export type WheelClassApplicability = Readonly<{
  variants: readonly WheelSemanticVariant[];
  layouts: readonly WheelSemanticLayout[];
  requiredFeatures: readonly WheelPreviewFeatureId[];
  /** A deterministic state that makes the class visible for coverage/QA. */
  previewStateId: WheelPreviewStateId;
}>;

export type WheelSemanticClassDefinition<Id extends string = string> = Readonly<{
  id: Id;
  labelKey: string;
  groupId: WheelSemanticGroupId;
  layer: WheelSemanticLayer;
  primitive: WheelSemanticPrimitive;
  capabilities: readonly WheelStyleCapability[];
  /** Used where the paint model changes across variants, e.g. arrowheads. */
  variantCapabilities?: Readonly<
    Partial<Record<WheelSemanticVariant, readonly WheelStyleCapability[]>>
  >;
  applicability: WheelClassApplicability;
  fontRole?: "text" | "symbols";
  /** Colour resolves through occurrence palette roles instead of class paint. */
  colorTarget?: "class" | "palette-role";
  /** Visual defaults inherit, while only this class's capabilities may override. */
  inheritsFrom?: string;
}>;

const ALL_VARIANTS = Object.freeze([
  "classic",
  "compact",
  "anglo",
] as const);
const CLASSIC_COMPACT = Object.freeze(["classic", "compact"] as const);
const CLASSIC_ONLY = Object.freeze(["classic"] as const);
const ANGLO_ONLY = Object.freeze(["anglo"] as const);
const ALL_LAYOUTS = Object.freeze(["single", "comparison"] as const);
const SINGLE_ONLY = Object.freeze(["single"] as const);
const COMPARISON_ONLY = Object.freeze(["comparison"] as const);

export const WHEEL_STYLE_CAPABILITY_SETS = Object.freeze({
  surface: Object.freeze(["color", "opacity"] as const),
  compositor: Object.freeze([
    "opacity",
    "blur",
    "shadowColor",
    "shadowX",
    "shadowY",
    "shadowBlur",
    "hueRotate",
    "brightness",
    "contrast",
    "saturation",
    "grayscale",
    "invert",
    "sepia",
  ] as const),
  ring: Object.freeze([
    "radius",
    "color",
    "strokeWidth",
    "strokeStyle",
    "dashLength",
    "dashGap",
    "opacity",
  ] as const),
  openLine: Object.freeze([
    "color",
    "strokeWidth",
    "strokeStyle",
    "dashLength",
    "dashGap",
    "lineCap",
    "opacity",
  ] as const),
  polyline: Object.freeze([
    "color",
    "strokeWidth",
    "strokeStyle",
    "dashLength",
    "dashGap",
    "lineCap",
    "lineJoin",
    "opacity",
  ] as const),
  text: Object.freeze([
    "fontRef",
    "fontSize",
    "tracking",
    "color",
    "opacity",
  ] as const),
  filledShape: Object.freeze(["color", "opacity"] as const),
  marker: Object.freeze(["radius", "color", "opacity"] as const),
  inheritedPoint: Object.freeze(["color"] as const),
});

type DefinitionInput = Omit<WheelSemanticClassDefinition, "id">;

function applicability(
  previewStateId: WheelPreviewStateId,
  input: Partial<
    Pick<WheelClassApplicability, "variants" | "layouts" | "requiredFeatures">
  > = {},
): WheelClassApplicability {
  return Object.freeze({
    variants: input.variants ?? ALL_VARIANTS,
    layouts: input.layouts ?? ALL_LAYOUTS,
    requiredFeatures: Object.freeze([...(input.requiredFeatures ?? [])]),
    previewStateId,
  });
}

function define(input: DefinitionInput): DefinitionInput {
  return Object.freeze(input);
}

const C = WHEEL_STYLE_CAPABILITY_SETS;

const WHEEL_SEMANTIC_CLASS_INPUTS = {
  "canvas.background": define({
    labelKey: "styleLab.scene.canvas", groupId: "canvas", layer: "geometry",
    primitive: "surface", capabilities: C.surface,
    applicability: applicability("classic.single.default"), colorTarget: "class",
  }),

  "layers.geometry": define({
    labelKey: "styleLab.scene.geometryLayer", groupId: "layers", layer: "geometry",
    primitive: "group", capabilities: C.compositor,
    applicability: applicability("classic.single.default"), colorTarget: "class",
  }),
  "layers.dynamic": define({
    labelKey: "styleLab.scene.dynamicLayer", groupId: "layers", layer: "dynamic",
    primitive: "group", capabilities: C.compositor,
    applicability: applicability("classic.single.default"), colorTarget: "class",
  }),
  "layers.outerLabel": define({
    labelKey: "styleLab.scene.outerLabelLayer", groupId: "layers", layer: "outer-label",
    primitive: "group", capabilities: C.compositor,
    applicability: applicability("classic.single.outer.fixedStar"), colorTarget: "class",
  }),

  "rings.outerMaximum": define({
    labelKey: "styleLab.scene.outerMaximum", groupId: "rings", layer: "geometry",
    primitive: "circle", capabilities: C.ring,
    applicability: applicability("classic.comparison.default", { layouts: COMPARISON_ONLY }), colorTarget: "class",
  }),
  "rings.outerHouse": define({
    labelKey: "styleLab.scene.outerHouseRing", groupId: "rings", layer: "geometry",
    primitive: "circle", capabilities: C.ring,
    applicability: applicability("classic.comparison.outerHouses", { layouts: COMPARISON_ONLY, requiredFeatures: ["houses", "comparison.outerHouses"] }), colorTarget: "class",
  }),
  "rings.outerDegree": define({
    labelKey: "styleLab.class.ringsOuterDegree", groupId: "rings", layer: "geometry",
    primitive: "circle", capabilities: C.ring,
    applicability: applicability("classic.comparison.default", { variants: CLASSIC_COMPACT, layouts: COMPARISON_ONLY }), colorTarget: "class",
  }),
  "rings.zodiacOuter": define({
    labelKey: "styleLab.scene.zodiacOuter", groupId: "rings", layer: "geometry",
    primitive: "circle", capabilities: C.ring,
    applicability: applicability("classic.single.default"), colorTarget: "class",
  }),
  "rings.innerDegree": define({
    labelKey: "styleLab.class.ringsInnerDegree", groupId: "rings", layer: "geometry",
    primitive: "circle", capabilities: C.ring,
    applicability: applicability("classic.single.default", { variants: CLASSIC_COMPACT }), colorTarget: "class",
  }),
  "rings.zodiacInner": define({
    labelKey: "styleLab.scene.zodiacInner", groupId: "rings", layer: "geometry",
    primitive: "circle", capabilities: C.ring,
    applicability: applicability("classic.single.default"), colorTarget: "class",
  }),
  "rings.term": define({
    labelKey: "styleLab.class.ringsTerm", groupId: "rings", layer: "geometry",
    primitive: "circle", capabilities: C.ring,
    applicability: applicability("classic.single.terms", { requiredFeatures: ["terms"] }), colorTarget: "class",
  }),
  "rings.angloCuspOuter": define({
    labelKey: "styleLab.scene.cuspOuterRing", groupId: "rings", layer: "geometry",
    primitive: "circle", capabilities: C.ring,
    applicability: applicability("anglo.single.default", { variants: ANGLO_ONLY }), colorTarget: "class",
  }),
  "rings.innerBoundary": define({
    labelKey: "styleLab.scene.innerBoundary", groupId: "rings", layer: "geometry",
    primitive: "circle", capabilities: C.ring,
    applicability: applicability("classic.single.default"), colorTarget: "class",
  }),
  "rings.aspectBoundary": define({
    labelKey: "styleLab.scene.aspectBoundary", groupId: "rings", layer: "geometry",
    primitive: "circle", capabilities: C.ring,
    applicability: applicability("classic.single.aspects", { variants: CLASSIC_ONLY, requiredFeatures: ["aspects"] }), colorTarget: "class",
  }),
  "rings.houseBoundary": define({
    labelKey: "styleLab.scene.houseRing", groupId: "rings", layer: "geometry",
    primitive: "circle", capabilities: C.ring,
    applicability: applicability("classic.single.default", { requiredFeatures: ["houses"] }), colorTarget: "class",
  }),
  "rings.base": define({
    labelKey: "styleLab.scene.baseRing", groupId: "rings", layer: "geometry",
    primitive: "circle", capabilities: C.ring,
    applicability: applicability("classic.single.default"), colorTarget: "class",
  }),

  "zodiac.spoke": define({
    labelKey: "styleLab.scene.zodiacSpokes", groupId: "zodiac", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.single.default"), colorTarget: "class",
  }),
  "zodiac.tick.inner.10deg": define({
    labelKey: "styleLab.scene.tickInner10", groupId: "zodiac", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.single.default", { variants: CLASSIC_COMPACT }), colorTarget: "class",
  }),
  "zodiac.tick.inner.5deg": define({
    labelKey: "styleLab.scene.tickInner5", groupId: "zodiac", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.single.default", { variants: CLASSIC_COMPACT }), colorTarget: "class",
  }),
  "zodiac.tick.inner.1deg": define({
    labelKey: "styleLab.scene.tickInner1", groupId: "zodiac", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.single.default", { variants: CLASSIC_COMPACT }), colorTarget: "class",
  }),
  "zodiac.tick.outer.10deg": define({
    labelKey: "styleLab.scene.tickOuter10", groupId: "zodiac", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.comparison.default", { variants: CLASSIC_COMPACT, layouts: COMPARISON_ONLY }), colorTarget: "class",
  }),
  "zodiac.tick.outer.5deg": define({
    labelKey: "styleLab.scene.tickOuter5", groupId: "zodiac", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.comparison.default", { variants: CLASSIC_COMPACT, layouts: COMPARISON_ONLY }), colorTarget: "class",
  }),
  "zodiac.tick.outer.1deg": define({
    labelKey: "styleLab.scene.tickOuter1", groupId: "zodiac", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.comparison.default", { variants: CLASSIC_COMPACT, layouts: COMPARISON_ONLY }), colorTarget: "class",
  }),
  "zodiac.tick.angloCuspRuler.10deg": define({
    labelKey: "styleLab.class.zodiacTickAngloCusp10Degree", groupId: "zodiac", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("anglo.single.default", { variants: ANGLO_ONLY }), colorTarget: "class",
  }),
  "zodiac.tick.angloCuspRuler.5deg": define({
    labelKey: "styleLab.class.zodiacTickAngloCusp5Degree", groupId: "zodiac", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("anglo.single.default", { variants: ANGLO_ONLY }), colorTarget: "class",
  }),
  "zodiac.tick.angloCuspRuler.1deg": define({
    labelKey: "styleLab.class.zodiacTickAngloCusp1Degree", groupId: "zodiac", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("anglo.single.default", { variants: ANGLO_ONLY }), colorTarget: "class",
  }),
  "zodiac.tick.angloHouseCusp": define({
    labelKey: "styleLab.class.zodiacTickAngloHouseCusp", groupId: "zodiac", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("anglo.single.default", { variants: ANGLO_ONLY, requiredFeatures: ["houses"] }), colorTarget: "class",
  }),
  "zodiac.tick.angloAngleRuler": define({
    labelKey: "styleLab.class.zodiacTickAngloAngleRuler", groupId: "zodiac", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("anglo.single.default", { variants: ANGLO_ONLY }), colorTarget: "class",
  }),
  "zodiac.signGlyph": define({
    labelKey: "styleLab.scene.zodiacSign", groupId: "zodiac", layer: "geometry",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.default"), fontRole: "symbols", colorTarget: "palette-role",
  }),

  "subdivisions.term.boundary": define({
    labelKey: "styleLab.scene.termBoundary", groupId: "subdivisions", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.single.terms", { requiredFeatures: ["terms"] }), colorTarget: "class",
  }),
  "subdivisions.term.glyph": define({
    labelKey: "styleLab.scene.termGlyph", groupId: "subdivisions", layer: "geometry",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.terms", { requiredFeatures: ["terms"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "subdivisions.decan.boundary": define({
    labelKey: "styleLab.scene.decanBoundary", groupId: "subdivisions", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.single.decans", { requiredFeatures: ["decans"] }), colorTarget: "class",
  }),
  "subdivisions.decan.glyph": define({
    labelKey: "styleLab.scene.decanGlyph", groupId: "subdivisions", layer: "geometry",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.decans", { requiredFeatures: ["decans"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),

  "houses.inner.cusp": define({
    labelKey: "styleLab.scene.houseCusp", groupId: "houses", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.single.default", { requiredFeatures: ["houses"] }), colorTarget: "class",
  }),
  "houses.inner.label": define({
    labelKey: "styleLab.scene.houseLabel", groupId: "houses", layer: "geometry",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.default", { requiredFeatures: ["houses"] }), fontRole: "text", colorTarget: "class",
  }),
  "houses.inner.position.degree": define({
    labelKey: "styleLab.class.housePositionDegree", groupId: "houses", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.default", { requiredFeatures: ["houses", "positions"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "houses.inner.position.sign": define({
    labelKey: "styleLab.class.housePositionSign", groupId: "houses", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("anglo.single.default", { variants: ANGLO_ONLY, requiredFeatures: ["houses", "positions"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "houses.inner.position.minute": define({
    labelKey: "styleLab.class.housePositionMinute", groupId: "houses", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.default", { requiredFeatures: ["houses", "positions"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "houses.outer.cusp": define({
    labelKey: "styleLab.class.outerHouseCusp", groupId: "houses", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.comparison.outerHouses", { layouts: COMPARISON_ONLY, requiredFeatures: ["houses", "comparison.outerHouses"] }), colorTarget: "class",
  }),
  "houses.outer.label": define({
    labelKey: "styleLab.class.outerHouseLabel", groupId: "houses", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.comparison.outerHouses", { layouts: COMPARISON_ONLY, requiredFeatures: ["houses", "comparison.outerHouses"] }), fontRole: "text", colorTarget: "class",
  }),

  "angles.inner.ray": define({
    labelKey: "styleLab.scene.angle", groupId: "angles", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.single.default"), colorTarget: "class",
  }),
  "angles.inner.arrowhead": define({
    labelKey: "styleLab.class.innerAngleArrowhead", groupId: "angles", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    variantCapabilities: { classic: C.openLine, compact: C.openLine, anglo: C.filledShape },
    applicability: applicability("classic.single.default", { requiredFeatures: ["angleArrowheads"] }), colorTarget: "class",
  }),
  "angles.inner.label": define({
    labelKey: "styleLab.scene.angleLabel", groupId: "angles", layer: "geometry",
    primitive: "text", capabilities: C.text,
    applicability: applicability("anglo.single.default", { variants: ANGLO_ONLY, requiredFeatures: ["angleLabels"] }), fontRole: "text", colorTarget: "class",
  }),
  "angles.inner.position.degree": define({
    labelKey: "styleLab.class.anglePositionDegree", groupId: "angles", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.default", { requiredFeatures: ["positions"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "angles.inner.position.sign": define({
    labelKey: "styleLab.class.anglePositionSign", groupId: "angles", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("anglo.single.default", { variants: ANGLO_ONLY, requiredFeatures: ["positions"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "angles.inner.position.minute": define({
    labelKey: "styleLab.class.anglePositionMinute", groupId: "angles", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.default", { requiredFeatures: ["positions"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "angles.outer.ray": define({
    labelKey: "styleLab.class.outerAngleRay", groupId: "angles", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.comparison.default", { layouts: COMPARISON_ONLY }), colorTarget: "class",
  }),
  "angles.outer.arrowhead": define({
    labelKey: "styleLab.class.outerAngleArrowhead", groupId: "angles", layer: "geometry",
    primitive: "line", capabilities: C.openLine,
    variantCapabilities: { classic: C.openLine, compact: C.openLine, anglo: C.filledShape },
    applicability: applicability("classic.comparison.default", { layouts: COMPARISON_ONLY, requiredFeatures: ["angleArrowheads"] }), colorTarget: "class",
  }),
  "angles.outer.label": define({
    labelKey: "styleLab.class.outerAngleLabel", groupId: "angles", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("anglo.comparison.outerHouses", { variants: ANGLO_ONLY, layouts: COMPARISON_ONLY, requiredFeatures: ["angleLabels"] }), fontRole: "text", colorTarget: "class",
  }),

  "bodies.inner.leader": define({
    labelKey: "styleLab.scene.bodyLeader", groupId: "bodies", layer: "dynamic",
    primitive: "line", capabilities: C.polyline,
    applicability: applicability("classic.single.default"), colorTarget: "class",
  }),
  "bodies.inner.glyph": define({
    labelKey: "styleLab.scene.bodyGlyphs", groupId: "bodies", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.default"), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "bodies.inner.motion": define({
    labelKey: "styleLab.class.innerBodyMotion", groupId: "bodies", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.default", { requiredFeatures: ["motionMarkers"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "bodies.inner.position.degree": define({
    labelKey: "styleLab.class.bodyPositionDegree", groupId: "bodies", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.default", { requiredFeatures: ["positions"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "bodies.inner.position.sign": define({
    labelKey: "styleLab.class.bodyPositionSign", groupId: "bodies", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("anglo.single.default", { variants: ANGLO_ONLY, requiredFeatures: ["positions"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "bodies.inner.position.minute": define({
    labelKey: "styleLab.class.bodyPositionMinute", groupId: "bodies", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.default", { requiredFeatures: ["positions"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "bodies.outer.leader": define({
    labelKey: "styleLab.scene.outerLeader", groupId: "bodies", layer: "dynamic",
    primitive: "line", capabilities: C.polyline,
    applicability: applicability("classic.comparison.default", { layouts: COMPARISON_ONLY }), colorTarget: "class",
  }),
  "bodies.outer.glyph": define({
    labelKey: "styleLab.class.outerBodyGlyph", groupId: "bodies", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.comparison.default", { layouts: COMPARISON_ONLY }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "bodies.outer.motion": define({
    labelKey: "styleLab.class.outerBodyMotion", groupId: "bodies", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.comparison.default", { layouts: COMPARISON_ONLY, requiredFeatures: ["motionMarkers"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "bodies.fortune": define({
    labelKey: "quickopt.fortuna", groupId: "bodies", layer: "dynamic",
    primitive: "text", capabilities: C.inheritedPoint,
    applicability: applicability("classic.single.specialPoints", { requiredFeatures: ["body.fortune"] }), fontRole: "symbols", colorTarget: "palette-role", inheritsFrom: "bodies.inner.glyph",
  }),
  "bodies.vertex": define({
    labelKey: "quickopt.vertex", groupId: "bodies", layer: "dynamic",
    primitive: "text", capabilities: C.inheritedPoint,
    applicability: applicability("classic.single.specialPoints", { requiredFeatures: ["body.vertex"] }), fontRole: "symbols", colorTarget: "palette-role", inheritsFrom: "bodies.inner.glyph",
  }),
  "bodies.prenatalSyzygy": define({
    labelKey: "quickopt.prenatalSyzygy", groupId: "bodies", layer: "dynamic",
    primitive: "text", capabilities: C.inheritedPoint,
    applicability: applicability("classic.single.specialPoints", { requiredFeatures: ["body.prenatalSyzygy"] }), fontRole: "symbols", colorTarget: "palette-role", inheritsFrom: "bodies.inner.glyph",
  }),

  "aspects.primary.line": define({
    labelKey: "styleLab.scene.aspectLine", groupId: "aspects", layer: "dynamic",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.single.aspects", { layouts: SINGLE_ONLY, requiredFeatures: ["aspects"] }), colorTarget: "palette-role",
  }),
  "aspects.primary.glyph": define({
    labelKey: "styleLab.scene.aspectGlyph", groupId: "aspects", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.aspects", { layouts: SINGLE_ONLY, requiredFeatures: ["aspects", "aspectGlyphs"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "aspects.interchart.endpointMarker": define({
    labelKey: "styleLab.class.interchartEndpointMarker", groupId: "aspects", layer: "dynamic",
    primitive: "circle", capabilities: C.marker,
    applicability: applicability("classic.comparison.aspects", { layouts: COMPARISON_ONLY, requiredFeatures: ["aspects"] }), colorTarget: "palette-role",
  }),
  "aspects.interchart.line": define({
    labelKey: "styleLab.class.interchartAspectLine", groupId: "aspects", layer: "dynamic",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.comparison.aspects", { layouts: COMPARISON_ONLY, requiredFeatures: ["aspects"] }), colorTarget: "palette-role",
  }),
  "aspects.interchart.glyph": define({
    labelKey: "styleLab.class.interchartAspectGlyph", groupId: "aspects", layer: "dynamic",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.comparison.aspects", { layouts: COMPARISON_ONLY, requiredFeatures: ["aspects", "aspectGlyphs"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),

  "secondaryRing.fixedStar.leader": define({
    labelKey: "styleLab.class.fixedStarLeader", groupId: "secondaryRing", layer: "dynamic",
    primitive: "line", capabilities: C.polyline,
    applicability: applicability("classic.single.outer.fixedStar", { requiredFeatures: ["outerRing.fixedStar"] }), colorTarget: "class",
  }),
  "secondaryRing.fixedStar.label": define({
    labelKey: "styleLab.class.fixedStarLabel", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.fixedStar", { requiredFeatures: ["outerRing.fixedStar"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "secondaryRing.asteroid.leader": define({
    labelKey: "styleLab.class.asteroidLeader", groupId: "secondaryRing", layer: "dynamic",
    primitive: "line", capabilities: C.polyline,
    applicability: applicability("classic.single.outer.asteroid", { requiredFeatures: ["outerRing.asteroid"] }), colorTarget: "class",
  }),
  "secondaryRing.asteroid.label": define({
    labelKey: "styleLab.class.asteroidLabel", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.asteroid", { requiredFeatures: ["outerRing.asteroid"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "secondaryRing.midpoint.leader": define({
    labelKey: "styleLab.class.midpointLeader", groupId: "secondaryRing", layer: "dynamic",
    primitive: "line", capabilities: C.polyline,
    applicability: applicability("classic.single.outer.midpoint", { requiredFeatures: ["outerRing.midpoint"] }), colorTarget: "class",
  }),
  "secondaryRing.midpoint.glyph": define({
    labelKey: "styleLab.class.midpointGlyph", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.midpoint", { requiredFeatures: ["outerRing.midpoint"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "secondaryRing.midpoint.text": define({
    labelKey: "styleLab.class.midpointText", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.midpoint", { requiredFeatures: ["outerRing.midpoint"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "secondaryRing.hybridHit.leader": define({
    labelKey: "styleLab.class.hybridHitLeader", groupId: "secondaryRing", layer: "dynamic",
    primitive: "line", capabilities: C.polyline,
    applicability: applicability("classic.single.outer.hybridHit", { requiredFeatures: ["outerRing.hybridHit"] }), colorTarget: "class",
  }),
  "secondaryRing.hybridHit.label": define({
    labelKey: "styleLab.class.hybridHitLabel", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.hybridHit", { requiredFeatures: ["outerRing.hybridHit"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "secondaryRing.antiscia.leader": define({
    labelKey: "styleLab.class.antisciaLeader", groupId: "secondaryRing", layer: "dynamic",
    primitive: "line", capabilities: C.polyline,
    applicability: applicability("classic.single.outer.antiscia", { requiredFeatures: ["outerRing.antiscia"] }), colorTarget: "class",
  }),
  "secondaryRing.antiscia.glyph": define({
    labelKey: "styleLab.class.antisciaGlyph", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.antiscia", { requiredFeatures: ["outerRing.antiscia"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "secondaryRing.antiscia.text": define({
    labelKey: "styleLab.class.antisciaText", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.antiscia", { requiredFeatures: ["outerRing.antiscia"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "secondaryRing.contraAntiscia.leader": define({
    labelKey: "styleLab.class.contraAntisciaLeader", groupId: "secondaryRing", layer: "dynamic",
    primitive: "line", capabilities: C.polyline,
    applicability: applicability("classic.single.outer.contraAntiscia", { requiredFeatures: ["outerRing.contraAntiscia"] }), colorTarget: "class",
  }),
  "secondaryRing.contraAntiscia.glyph": define({
    labelKey: "styleLab.class.contraAntisciaGlyph", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.contraAntiscia", { requiredFeatures: ["outerRing.contraAntiscia"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "secondaryRing.contraAntiscia.text": define({
    labelKey: "styleLab.class.contraAntisciaText", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.contraAntiscia", { requiredFeatures: ["outerRing.contraAntiscia"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "secondaryRing.dodecatemoria.leader": define({
    labelKey: "styleLab.class.dodecatemoriaLeader", groupId: "secondaryRing", layer: "dynamic",
    primitive: "line", capabilities: C.polyline,
    applicability: applicability("classic.single.outer.dodecatemoria", { requiredFeatures: ["outerRing.dodecatemoria"] }), colorTarget: "class",
  }),
  "secondaryRing.dodecatemoria.glyph": define({
    labelKey: "styleLab.class.dodecatemoriaGlyph", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.dodecatemoria", { requiredFeatures: ["outerRing.dodecatemoria"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "secondaryRing.dodecatemoria.text": define({
    labelKey: "styleLab.class.dodecatemoriaText", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.dodecatemoria", { requiredFeatures: ["outerRing.dodecatemoria"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "secondaryRing.arabicPart.leader": define({
    labelKey: "styleLab.class.arabicPartLeader", groupId: "secondaryRing", layer: "dynamic",
    primitive: "line", capabilities: C.polyline,
    applicability: applicability("classic.single.outer.arabicPart", { requiredFeatures: ["outerRing.arabicPart"] }), colorTarget: "class",
  }),
  "secondaryRing.arabicPart.label": define({
    labelKey: "styleLab.class.arabicPartLabel", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.arabicPart", { requiredFeatures: ["outerRing.arabicPart"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "secondaryRing.parallelTransit.leader": define({
    labelKey: "styleLab.class.parallelTransitLeader", groupId: "secondaryRing", layer: "dynamic",
    primitive: "line", capabilities: C.polyline,
    applicability: applicability("classic.single.outer.parallelTransit", { requiredFeatures: ["outerRing.parallelTransit"] }), colorTarget: "class",
  }),
  "secondaryRing.parallelTransit.glyph": define({
    labelKey: "styleLab.class.parallelTransitGlyph", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.parallelTransit", { requiredFeatures: ["outerRing.parallelTransit"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "secondaryRing.parallelTransit.motion": define({
    labelKey: "styleLab.class.parallelTransitMotion", groupId: "secondaryRing", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.outer.parallelTransit", { requiredFeatures: ["outerRing.parallelTransit", "motionMarkers"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),

  "surveil.tick": define({
    labelKey: "styleLab.class.surveilTick", groupId: "surveil", layer: "outer-label",
    primitive: "line", capabilities: C.openLine,
    applicability: applicability("classic.single.surveil", { requiredFeatures: ["surveil"] }), colorTarget: "class",
  }),
  "surveil.marker.glyph": define({
    labelKey: "styleLab.class.surveilMarkerGlyph", groupId: "surveil", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.surveil", { requiredFeatures: ["surveil"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "surveil.marker.label": define({
    labelKey: "styleLab.class.surveilMarkerLabel", groupId: "surveil", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.surveil", { requiredFeatures: ["surveil"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "surveil.sourceLabel": define({
    labelKey: "styleLab.class.surveilSourceLabel", groupId: "surveil", layer: "outer-label",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.surveil", { requiredFeatures: ["surveil"] }), fontRole: "text", colorTarget: "palette-role",
  }),

  "chartOverlay.information.topLeft": define({
    labelKey: "styleLab.class.overlayInformationTopLeft", groupId: "chartOverlay", layer: "overlay",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.overlays", { requiredFeatures: ["overlay.information.topLeft"] }), fontRole: "text", colorTarget: "class",
  }),
  "chartOverlay.information.bottomLeft": define({
    labelKey: "styleLab.class.overlayInformationBottomLeft", groupId: "chartOverlay", layer: "overlay",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.overlays", { requiredFeatures: ["overlay.information.bottomLeft"] }), fontRole: "text", colorTarget: "class",
  }),
  "chartOverlay.houseSystem.bottomRight": define({
    labelKey: "styleLab.class.overlayHouseSystemBottomRight", groupId: "chartOverlay", layer: "overlay",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.overlays", { requiredFeatures: ["overlay.houseSystem.bottomRight"] }), fontRole: "text", colorTarget: "class",
  }),
  "chartOverlay.events.dayHour.label": define({
    labelKey: "styleLab.class.eventDayHourLabel", groupId: "chartOverlay", layer: "overlay",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.overlays", { requiredFeatures: ["overlay.events.dayHour"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "chartOverlay.events.dayHour.glyph": define({
    labelKey: "styleLab.class.eventDayHourGlyph", groupId: "chartOverlay", layer: "overlay",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.overlays", { requiredFeatures: ["overlay.events.dayHour"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "chartOverlay.events.dayHour.trailing": define({
    labelKey: "styleLab.class.eventDayHourTrailing", groupId: "chartOverlay", layer: "overlay",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.overlays", { requiredFeatures: ["overlay.events.dayHour"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "chartOverlay.events.header.label": define({
    labelKey: "styleLab.class.eventHeaderLabel", groupId: "chartOverlay", layer: "overlay",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.overlays", { requiredFeatures: ["overlay.events.header"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "chartOverlay.events.header.glyph": define({
    labelKey: "styleLab.class.eventHeaderGlyph", groupId: "chartOverlay", layer: "overlay",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.overlays", { requiredFeatures: ["overlay.events.header"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "chartOverlay.events.header.trailing": define({
    labelKey: "styleLab.class.eventHeaderTrailing", groupId: "chartOverlay", layer: "overlay",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.overlays", { requiredFeatures: ["overlay.events.header"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "chartOverlay.events.signal.label": define({
    labelKey: "styleLab.class.eventSignalLabel", groupId: "chartOverlay", layer: "overlay",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.overlays", { requiredFeatures: ["overlay.events.signal"] }), fontRole: "text", colorTarget: "palette-role",
  }),
  "chartOverlay.events.signal.glyph": define({
    labelKey: "styleLab.class.eventSignalGlyph", groupId: "chartOverlay", layer: "overlay",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.overlays", { requiredFeatures: ["overlay.events.signal"] }), fontRole: "symbols", colorTarget: "palette-role",
  }),
  "chartOverlay.events.signal.trailing": define({
    labelKey: "styleLab.class.eventSignalTrailing", groupId: "chartOverlay", layer: "overlay",
    primitive: "text", capabilities: C.text,
    applicability: applicability("classic.single.overlays", { requiredFeatures: ["overlay.events.signal"] }), fontRole: "text", colorTarget: "palette-role",
  }),
} as const satisfies Record<string, DefinitionInput>;

export type WheelSemanticClassId = keyof typeof WHEEL_SEMANTIC_CLASS_INPUTS;

export const WHEEL_SEMANTIC_CLASS_MANIFEST = Object.freeze(
  Object.entries(WHEEL_SEMANTIC_CLASS_INPUTS).map(([id, input]) =>
    Object.freeze({ id, ...input }),
  ),
) as readonly WheelSemanticClassDefinition<WheelSemanticClassId>[];

export const WHEEL_SEMANTIC_CLASS_IDS = Object.freeze(
  WHEEL_SEMANTIC_CLASS_MANIFEST.map((definition) => definition.id),
) as readonly WheelSemanticClassId[];

export const WHEEL_SEMANTIC_CLASS_BY_ID = Object.freeze(
  Object.fromEntries(
    WHEEL_SEMANTIC_CLASS_MANIFEST.map((definition) => [definition.id, definition]),
  ),
) as Readonly<
  Record<WheelSemanticClassId, WheelSemanticClassDefinition<WheelSemanticClassId>>
>;

export function isWheelSemanticClassId(value: string): value is WheelSemanticClassId {
  return Object.prototype.hasOwnProperty.call(WHEEL_SEMANTIC_CLASS_BY_ID, value);
}

export function getWheelSemanticClass(
  classId: string,
): WheelSemanticClassDefinition<WheelSemanticClassId> | undefined {
  return isWheelSemanticClassId(classId)
    ? WHEEL_SEMANTIC_CLASS_BY_ID[classId]
    : undefined;
}

export function resolveWheelSemanticCapabilities(
  definition: WheelSemanticClassDefinition,
  variant: WheelSemanticVariant,
): readonly WheelStyleCapability[] {
  return definition.variantCapabilities?.[variant] ?? definition.capabilities;
}

export type WheelSemanticApplicabilityContext = Readonly<{
  variant: WheelSemanticVariant;
  layout: WheelSemanticLayout;
  features: ReadonlySet<WheelPreviewFeatureId> | readonly WheelPreviewFeatureId[];
}>;

export type WheelSemanticApplicabilityResult = Readonly<{
  state: "applicable" | "not-applicable";
  missingFeatures: readonly WheelPreviewFeatureId[];
  requiredPreviewStateId: WheelPreviewStateId;
}>;

function featureSet(
  features: WheelSemanticApplicabilityContext["features"],
): ReadonlySet<WheelPreviewFeatureId> {
  return features instanceof Set ? features : new Set(features);
}

export function resolveWheelSemanticApplicability(
  definition: WheelSemanticClassDefinition,
  context: WheelSemanticApplicabilityContext,
): WheelSemanticApplicabilityResult {
  const features = featureSet(context.features);
  const missingFeatures = definition.applicability.requiredFeatures.filter(
    (feature) => !features.has(feature),
  );
  const applicable =
    definition.applicability.variants.includes(context.variant) &&
    definition.applicability.layouts.includes(context.layout) &&
    missingFeatures.length === 0;
  return Object.freeze({
    state: applicable ? "applicable" : "not-applicable",
    missingFeatures: Object.freeze(missingFeatures),
    requiredPreviewStateId: definition.applicability.previewStateId,
  });
}
